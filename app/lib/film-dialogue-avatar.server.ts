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
import { animateOmniHuman, falEnabled, falTts } from "./fal-video.server";
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

/** Best-effort gender from a character's cast-bible description. */
function inferGender(bible: string, fallback: "f" | "m"): "f" | "m" {
  if (/\b(woman|female|girl|she|her|hers|lady|mother|daughter|sister|wife|queen|mrs|ms|actress|waitress)\b/i.test(bible)) return "f";
  if (/\b(man|male|boy|he|his|him|guy|father|son|brother|husband|king|mr|sir|gentleman|waiter)\b/i.test(bible)) return "m";
  return fallback;
}

/** Give each speaker a DISTINCT, fixed voice (consistent across the whole film). */
function assignVoices(cast: string[], speakers: string[]): Record<string, string> {
  const females = AVATAR_VOICES.filter((v) => v.gender === "f").map((v) => v.id);
  const males = AVATAR_VOICES.filter((v) => v.gender === "m").map((v) => v.id);
  const out: Record<string, string> = {};
  let fi = 0, mi = 0, k = 0;
  for (const sp of speakers) {
    const bible = (cast || []).find((c) => sp && c.toLowerCase().includes(sp.toLowerCase())) || "";
    const g = inferGender(bible, k % 2 === 0 ? "f" : "m");
    out[sp] = g === "f" ? females[fi++ % females.length] : males[mi++ % males.length];
    k++;
  }
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
  } catch { /* no mask → OmniHuman animates the most prominent face */ }
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

  // 4) Per line: TTS the speaker's fixed voice → OmniHuman animates the SHARED two-shot
  //    with the SPEAKER's mask, so only they talk. Same image every time = no visible cut.
  const clips: string[] = (resume.ckClips || []).filter((p) => p && fs.existsSync(p));
  for (let i = clips.length; i < beats.length; i++) {
    const { speaker, line } = beats[i];
    const voiceId = voices[speaker] || AVATAR_VOICES[0].id;
    const maskRel = speakerRight ? (speaker === speakerLeft ? masks.left : masks.right) : undefined;
    const maskUrl = maskRel ? abs(maskRel) : undefined;
    const audioUrl = await falTts(line || "…", voiceId, 1, { lang: null, emotion: "neutral" });
    const clipUrl = await animateOmniHuman({
      imageUrl: stageAbs,
      audioUrl,
      maskUrl,
      prompt: "The speaking person talks naturally with accurate lip-sync; the other person listens quietly without speaking. Cinematic, photorealistic, no on-screen text.",
      resolution: "720p",
      turbo: true, // build-phase: faster iteration, slight quality trade-off
    });
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
