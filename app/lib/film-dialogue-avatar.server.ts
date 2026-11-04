// AUDIO-DRIVEN DIALOGUE (Film Pipeline 2) — kept SEPARATE from the Veo "Test Movie"
// engine (film-dialogue.server.ts) and the main Film engine, so none of them can
// break each other.
//
// Owner's requirement: BOTH characters present in a CONTINUOUS scene, each talking
// in turn with their own voice, and NO noticeable cut — the scene must carry.
//
// How it works:
//   • ONE consistent TWO-SHOT image (both characters, A on the LEFT, B on the RIGHT)
//     is generated once and REUSED for every line. The framing never changes, so
//     there is no scene cut to notice — continuity is carried by construction.
//   • For each line we TTS the speaker's FIXED voice (zero drift) and animate the
//     shared two-shot with OmniHuman 1.5, passing a MASK whose white area covers the
//     SPEAKER — so only that person's mouth moves, with the correct voice. (HeyGen,
//     a single-face model, animated the wrong/both faces on a two-shot, which made
//     the woman appear to speak in the man's voice and both seem to talk at once.)
//   • Clips are stitched with a short crossfade; because every clip is the SAME
//     frame, the joins are invisible.
//
// Seams (swap a backend without a structural rewrite):
//   VOICE   = falTts (fal MiniMax speech-02-hd, a fixed voice id per character)
//   STAGE   = renderCreativeSeed (nano-banana two-shot) + ffmpeg speaker masks
//   LIPSYNC = animateOmniHuman (fal OmniHuman 1.5, mask-driven)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db.server";
import { renderCreativeSeed } from "./image-generation.server";
import { checkpointJob, download, ffprobeDuration, runFfmpeg } from "./ugc-ad-pipeline.server";
import { animateAvatar, animateOmniHuman, falEnabled, falTts } from "./fal-video.server";
import { AVATAR_VOICES } from "./avatar-voice-catalog";
import { mirrorRender } from "./object-storage.server";
import { filmTemplate, previewFilmTreatment, type FilmTreatment } from "./film-engine.server";

const RENDERS = () => path.join(process.cwd(), "data", "renders");

/** "NAME: line" (robust to run-together turns) → the FIRST turn's speaker + line. */
function firstTurn(caption: string): { speaker: string; line: string } {
  const c = (caption || "").replace(/\s+/g, " ").trim();
  if (!c) return { speaker: "", line: "" };
  const re = /(\p{Lu}[\p{L}'’-]{1,20}):/gu;
  const marks: Array<{ name: string; idx: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(c)) !== null) marks.push({ name: m[1], idx: m.index, end: re.lastIndex });
  if (!marks.length) return { speaker: "", line: c };
  const end1 = marks.length > 1 ? marks[1].idx : c.length;
  return { speaker: marks[0].name.trim(), line: c.slice(marks[0].end, end1).trim() || c };
}

/** Best-effort gender from text (a speaker name and/or its cast-bible). Returns null when
 *  nothing in the text indicates gender, so the caller can resolve it smartly rather than
 *  coin-flip. The name alone often tells us ("Mother", "Dad"); the keyword lists are broad
 *  so a bible that describes the character catches too. */
function inferGender(text: string): "f" | "m" | null {
  if (/\b(woman|women|female|girl|she|her|hers|lady|ladies|mother|mom|mum|mama|mommy|grandma|grandmother|granny|nana|nonna|aunt|auntie|niece|daughter|sister|wife|queen|princess|witch|nurse|waitress|actress|mrs|miss|madam|bride|widow|girlfriend)\b/i.test(text)) return "f";
  if (/\b(man|men|male|boy|he|his|him|guy|gentleman|father|dad|daddy|papa|grandpa|grandfather|uncle|nephew|son|brother|husband|king|prince|wizard|waiter|mr|sir|mister|groom|lad|bloke|boyfriend)\b/i.test(text)) return "m";
  return null;
}

/** Give each speaker a DISTINCT, fixed voice whose GENDER matches the character. The old
 *  version inferred gender from the bible only, then fell back to alternating f/m by turn
 *  order — which is how a "mother" who spoke second drew a MALE voice. Now: read the name
 *  AND the bible, and in a two-hander give an unknown speaker the OPPOSITE of the known one
 *  (mixed-gender is the overwhelming default) instead of a coin-flip. */
function assignVoices(cast: string[], speakers: string[]): Record<string, string> {
  const females = AVATAR_VOICES.filter((v) => v.gender === "f").map((v) => v.id);
  const males = AVATAR_VOICES.filter((v) => v.gender === "m").map((v) => v.id);
  const bibleOf = (sp: string) => (cast || []).find((c) => sp && c.toLowerCase().includes(sp.toLowerCase())) || "";
  // 1) Detect what we can from name + bible.
  const detected = speakers.map((sp) => inferGender(`${sp} ${bibleOf(sp)}`));
  // 2) Resolve the unknowns. In a 2-hander opposite a known speaker, take the OTHER gender.
  const known = detected.find((g): g is "f" | "m" => g != null);
  const genders: ("f" | "m")[] = detected.map((g, i) =>
    g ? g : speakers.length === 2 && known ? (known === "f" ? "m" : "f") : i % 2 === 0 ? "f" : "m"
  );
  // 3) Fixed, distinct voice per speaker (guard against an empty gender pool in the catalog).
  let fi = 0, mi = 0;
  const pickF = () => (females.length ? females[fi++ % females.length] : males[mi++ % Math.max(1, males.length)]);
  const pickM = () => (males.length ? males[mi++ % males.length] : females[fi++ % Math.max(1, females.length)]);
  const out: Record<string, string> = {};
  speakers.forEach((sp, i) => { out[sp] = genders[i] === "f" ? pickF() : pickM(); });
  return out;
}

/** A black 9:16 image with the SPEAKER's half painted white. OmniHuman animates only
 *  the person under the white area; the mask is resized onto the input image, so a
 *  proportional half works regardless of the image's exact pixels. */
async function makeHalfMask(side: "left" | "right"): Promise<string | null> {
  try {
    const W = 720, H = 1280, half = 360;
    const x = side === "left" ? 0 : half;
    const name = `mask-${side}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`;
    const out = path.join(RENDERS(), name);
    const r = await runFfmpeg(["-y", "-f", "lavfi", "-i", `color=c=black:s=${W}x${H}`, "-vf", `drawbox=x=${x}:y=0:w=${half}:h=${H}:color=white:t=fill`, "-frames:v", "1", out]);
    if (r.status === 0 && fs.existsSync(out)) return `/renders/${name}`;
  } catch { /* no mask → caller falls back to a single-face crop, never the two-shot */ }
  return null;
}

const AVATAR_TALK_PROMPT =
  "The speaking person talks naturally with accurate lip-sync; the other person listens quietly without speaking. Cinematic, photorealistic, no on-screen text.";

/** Crop ONE side (the speaker's half) out of the shared two-shot, giving a SINGLE-FACE
 *  image. A single-face lip-sync model fed one face can ONLY animate that one face — the
 *  safe way to render a turn when the masked two-shot animation is unavailable, with no
 *  risk of both mouths moving to one voice. Proportional (iw/2), so any image size works. */
async function cropHalf(localImage: string, side: "left" | "right"): Promise<string | null> {
  try {
    if (!fs.existsSync(localImage)) return null;
    const name = `half-${side}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`;
    const out = path.join(RENDERS(), name);
    const x = side === "left" ? "0" : "iw/2";
    const r = await runFfmpeg(["-y", "-i", localImage, "-vf", `crop=iw/2:ih:${x}:0`, "-frames:v", "1", out]);
    if (r.status === 0 && fs.existsSync(out)) return `/renders/${name}`;
  } catch { /* fall through to null */ }
  return null;
}

/** Concat the clips with a short crossfade. Every clip is the SAME two-shot, so the
 *  joins are invisible. Degrade ladder: xfade+audio → concat+audio → concat+silent. */
async function assembleAvatarDialogue(clips: string[], outPath: string, jobId?: string): Promise<void> {
  const N = clips.length;
  if (!N) throw new Error("[avatardialogue] no clips");
  const beat = async () => { if (jobId) await checkpointJob(jobId, { ckBeat: Date.now() }); };
  const produced = (): boolean => { try { return fs.existsSync(outPath) && ffprobeDuration(outPath) > 1; } catch { return false; } };
  const SCALE = "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30";
  const TAIL = ["-threads", "2", "-filter_complex_threads", "2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outPath];

  const buildXfade = (): string[] | null => {
    if (N < 2) return null;
    const FADE = 0.25;
    const durs = clips.map((c) => { try { return ffprobeDuration(c); } catch { return 0; } });
    if (durs.some((d) => !(d > FADE + 0.3))) return null;
    const a: string[] = ["-y"];
    clips.forEach((c) => a.push("-i", c));
    const f: string[] = [];
    clips.forEach((_, i) => { f.push(`[${i}:v]${SCALE},setpts=PTS-STARTPTS[v${i}]`); f.push(`[${i}:a]aresample=44100,asetpts=PTS-STARTPTS[a${i}]`); });
    let vPrev = "v0", aPrev = "a0", running = durs[0];
    for (let i = 1; i < N; i++) {
      const vOut = i === N - 1 ? "vc" : `vx${i}`;
      const aOut = i === N - 1 ? "ac" : `ax${i}`;
      f.push(`[${vPrev}][v${i}]xfade=transition=fade:duration=${FADE}:offset=${Math.max(0, running - FADE).toFixed(3)}[${vOut}]`);
      f.push(`[${aPrev}][a${i}]acrossfade=d=${FADE}[${aOut}]`);
      vPrev = vOut; aPrev = aOut; running = running + durs[i] - FADE;
    }
    return [...a, "-filter_complex", f.join(";"), "-map", "[vc]", "-map", "[ac]", ...TAIL];
  };

  const buildConcat = (useAudio: boolean): string[] => {
    const a: string[] = ["-y"];
    clips.forEach((c) => a.push("-i", c));
    const f: string[] = [];
    clips.forEach((_, i) => { f.push(`[${i}:v]${SCALE},setpts=PTS-STARTPTS[v${i}]`); if (useAudio) f.push(`[${i}:a]aresample=44100,asetpts=PTS-STARTPTS[a${i}]`); });
    if (useAudio) {
      f.push(`${clips.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${N}:v=1:a=1[vc][ac]`);
      return [...a, "-filter_complex", f.join(";"), "-map", "[vc]", "-map", "[ac]", ...TAIL];
    }
    f.push(`${clips.map((_, i) => `[v${i}]`).join("")}concat=n=${N}:v=1:a=0[vc]`);
    return [...a, "-filter_complex", f.join(";"), "-map", "[vc]", ...TAIL];
  };

  await beat();
  let lastErr = "";
  for (const args of [buildXfade(), buildConcat(true), buildConcat(false)]) {
    if (!args) continue;
    const run = await runFfmpeg(args);
    if (run.status === 0 && produced()) return;
    lastErr = (run.stderr || "").slice(-240);
    await beat();
  }
  throw new Error(`[avatardialogue] ffmpeg failed: ${lastErr}`);
}

export async function generateAvatarDialogue(opts: {
  shopId: string;
  template?: string;
  topic?: string;
  treatment?: FilmTreatment;
  sceneCount?: number;
  section?: string;
  jobId?: string;
  resume?: { ckTreatment?: string; ckVoices?: string; ckImage?: string; ckMasks?: string; ckClips?: string[] };
}): Promise<string> {
  const tmpl = filmTemplate(opts.template); // "avatardialogue"
  if (!falEnabled()) throw new Error("[avatardialogue] FAL_KEY not set");
  const jobId = opts.jobId;
  const resume = opts.resume || {};
  const ckpt = async (patch: Record<string, unknown>) => { if (jobId) await checkpointJob(jobId, patch); };
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const abs = (u: string | null | undefined): string | undefined => (u ? (u.startsWith("http") ? u : `${base}${u}`) : undefined);

  // 1) SCRIPT — the same dialogue treatment (one speaker per shot). Approved words win.
  let treatment: FilmTreatment;
  if (resume.ckTreatment) treatment = JSON.parse(resume.ckTreatment);
  else if (opts.treatment && opts.treatment.scenes?.length) treatment = opts.treatment;
  else treatment = await previewFilmTreatment({ shopId: opts.shopId, template: tmpl.key, topic: opts.topic, sceneCount: opts.sceneCount });
  const want = Math.max(tmpl.minScenes, Math.min(tmpl.maxScenes, opts.sceneCount ?? treatment.scenes.length));
  treatment.scenes = treatment.scenes.slice(0, want);
  await ckpt({ ckTreatment: JSON.stringify(treatment) });

  const cast = treatment.cast || [];
  const beats = treatment.scenes.map((s) => firstTurn(s.caption || ""));
  const speakers = Array.from(new Set(beats.map((b) => b.speaker).filter(Boolean)));
  const bibleFor = (sp: string) => cast.find((c) => sp && c.toLowerCase().includes(sp.toLowerCase())) || `${sp || "a character"}, a person`;
  const speakerLeft = speakers[0] || "";
  const speakerRight = speakers[1] || "";

  // Character-FREE setting (the full scene visual names BOTH characters). Used as the
  // backdrop of the shared two-shot. Take only the environment clause.
  const setting = ((treatment.scenes[0]?.visual || opts.topic || "").split(/[.;]/)[0] || "")
    .replace(/\b(two[- ]?shot|wide shot|close[- ]?up|medium shot|shot)\b/gi, "")
    .replace(/^\s*across\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || "a moody cinematic interior at night";

  // 2) VOICES — a fixed, distinct voice per character (zero drift).
  const voices: Record<string, string> = resume.ckVoices ? JSON.parse(resume.ckVoices) : assignVoices(cast, speakers);
  await ckpt({ ckVoices: JSON.stringify(voices) });

  // 3) ONE shared TWO-SHOT image (both characters) — generated ONCE, reused for every
  //    line, so the framing never changes and the scene carries continuously.
  let stageImage = resume.ckImage || "";
  if (!stageImage) {
    const prompt = speakerRight
      ? `Photorealistic cinematic TWO-SHOT, both people fully in frame and in sharp focus: on the LEFT, ${bibleFor(speakerLeft)}; on the RIGHT, ${bibleFor(speakerRight)}. They face each other in a tense conversation in ${setting}. Natural film lighting, shallow depth of field, filmic and real. No text, letters, captions, signage or screens anywhere in frame. Vertical 9:16.`
      : `Photorealistic cinematic close-up of ${bibleFor(speakerLeft)} in ${setting}. Head and shoulders, natural film lighting, shallow depth of field. No text anywhere. Vertical 9:16.`;
    const url = await renderCreativeSeed(prompt, "9:16");
    if (!url) throw new Error("[avatardialogue] no stage image");
    stageImage = url;
    await ckpt({ ckImage: stageImage });
  }
  const stageAbs = abs(stageImage);
  if (!stageAbs) throw new Error("[avatardialogue] no stage image");

  // Per-speaker masks so OmniHuman animates only the one who is talking (left vs right).
  const masks: { left?: string; right?: string } = resume.ckMasks ? JSON.parse(resume.ckMasks) : {};
  if (speakerRight && (!masks.left || !masks.right)) {
    if (!masks.left) masks.left = (await makeHalfMask("left")) || "";
    if (!masks.right) masks.right = (await makeHalfMask("right")) || "";
    await ckpt({ ckMasks: JSON.stringify(masks) });
  }

  // 4) Per line: TTS the speaker's fixed voice → animate the SHARED two-shot so ONLY the
  //    speaker talks. Same image every time = no visible cut.
  const clips: string[] = (resume.ckClips || []).filter((p) => p && fs.existsSync(p));
  // A LOCAL copy of the two-shot, so a single-face fallback can crop one speaker out of it.
  // (The stage is usually a /renders/ file already; download it if it's a remote URL.)
  let stageLocal = stageImage.startsWith("/renders/") ? path.join(RENDERS(), path.basename(stageImage)) : "";
  if (speakerRight && (!stageLocal || !fs.existsSync(stageLocal))) {
    try {
      const tmp = path.join(RENDERS(), `stage-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`);
      await download(stageAbs, tmp);
      stageLocal = fs.existsSync(tmp) ? tmp : "";
    } catch { stageLocal = ""; }
  }
  for (let i = clips.length; i < beats.length; i++) {
    const { speaker, line } = beats[i];
    const voiceId = voices[speaker] || AVATAR_VOICES[0].id;
    const onLeft = !speakerRight || speaker === speakerLeft;
    const maskRel = speakerRight ? (onLeft ? masks.left : masks.right) : undefined;
    const maskUrl = maskRel ? abs(maskRel) : undefined;
    const audioUrl = await falTts(line || "…", voiceId, 1, { lang: null, emotion: "neutral" });

    let clipUrl: string | null = null;
    // PRIMARY — OmniHuman animates the two-shot masked to the speaker, so only they move.
    // One retry: now that renders run one at a time (no memory contention), a clip that
    // used to time out and fall through should finish on a second try. A two-shot with NO
    // mask is never sent to OmniHuman — without a mask it animates both faces, so that goes
    // straight to the single-face crop below.
    const tries = speakerRight ? 2 : 1;
    for (let attempt = 0; attempt < tries && !clipUrl; attempt++) {
      if (speakerRight && !maskUrl) break;
      try {
        clipUrl = await animateOmniHuman({ imageUrl: stageAbs, audioUrl, maskUrl, prompt: AVATAR_TALK_PROMPT, resolution: "720p" });
      } catch (e) {
        console.error(`[avatardialogue] omnihuman attempt ${attempt + 1}/${tries} failed on scene ${i + 1}: ${e instanceof Error ? e.message.slice(0, 180) : e}`);
      }
    }
    // FALLBACK that CANNOT both-talk. The old code fell back to HeyGen on the WHOLE
    // two-shot — HeyGen is single-face, so it lip-synced the wrong/both faces to one
    // voice: exactly the "both talking at once" bug. Instead, give the single-face model
    // ONE face — crop the speaker's half out of the two-shot and animate that alone. A
    // solo close-up for this line is a visible tell that OmniHuman failed, but it is never
    // two mouths moving to one voice. If we can't get a single face, we REFUSE the clip
    // rather than emit the bug.
    if (!clipUrl) {
      if (speakerRight) {
        const crop = stageLocal ? await cropHalf(stageLocal, onLeft ? "left" : "right") : null;
        if (!crop) throw new Error(`[avatardialogue] scene ${i + 1}: omnihuman failed and a single-face crop was unavailable — refusing to lip-sync both faces`);
        clipUrl = await animateAvatar(abs(crop)!, audioUrl);
      } else {
        // Single-character scene: the stage is already one face, so HeyGen is safe.
        clipUrl = await animateAvatar(stageAbs, audioUrl);
      }
    }
    const outClip = path.join(RENDERS(), `ad-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp4`);
    await download(clipUrl, outClip);
    if (!(fs.existsSync(outClip) && ffprobeDuration(outClip) > 0.5)) throw new Error(`[avatardialogue] scene ${i + 1}: clip did not download`);
    clips.push(outClip);
    await ckpt({ ckClips: clips });
  }
  if (!clips.length) throw new Error("[avatardialogue] no clips rendered");

  // 5) ASSEMBLE — stitch the (identically-framed) clips with a soft crossfade.
  const outName = `ad-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp4`;
  const outPath = path.join(RENDERS(), outName);
  await assembleAvatarDialogue(clips, outPath, jobId);
  const outBuf = fs.readFileSync(outPath);
  try { await mirrorRender(outName, outBuf); } catch { /* non-fatal */ }
  const storedUrl = `/renders/${outName}`;

  const asset = await db.asset.create({
    data: {
      shopId: opts.shopId,
      type: "VIDEO_AD",
      status: "PENDING",
      title: `Dialogue (Actors) — ${(treatment.title || opts.topic || "dialogue").slice(0, 55)}`,
      bodyJson: JSON.stringify({ style: "AVATARDIALOGUE", videoUrl: storedUrl, prompt: opts.topic || "", treatment }),
      metaJson: JSON.stringify({ kind: "avatardialogue", template: tmpl.key, section: opts.section || "creator", scenes: clips.length, aspect: "vertical" }),
    },
  });
  return asset.id;
}
