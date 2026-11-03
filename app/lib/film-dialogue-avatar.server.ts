// AUDIO-DRIVEN DIALOGUE (Film Pipeline 2) — kept SEPARATE from the Veo "Test Movie"
// engine (film-dialogue.server.ts) and the main Film engine, so none of them can
// break each other.
//
// Why it exists: Veo generates each clip independently, so faces, wardrobe, hair and
// voices DRIFT and MORPH across cuts. This pipeline SOLVES that by building each
// character as a LOCKED "actor": ONE consistent portrait + ONE fixed voice. For each
// line we TTS the voice (same voice every time → zero drift) and lip-sync that actor's
// portrait with HeyGen Avatar 4 (purpose-built talking head → clean sync, no morph).
// Lines intercut shot/reverse-shot (Mara's portrait talks, then Eli's). HeyGen clips
// run exactly as long as the audio, so there is no dead air to trim.
//
// Reuses proven, integrated engines behind a clean seam (VOICE / PORTRAIT / LIPSYNC):
//   VOICE   = falTts (fal MiniMax speech-02-hd, a fixed voice id per character)
//   PORTRAIT= renderCreativeSeed (nano-banana photoreal portrait, generated once)
//   LIPSYNC = animateAvatar (fal HeyGen Avatar 4, 9:16 1080p)
// Research may name a better backend (InfiniteTalk, ElevenLabs, …) — swapping it is a
// one-function change at each seam, no structural rewrite.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db.server";
import { renderCreativeSeed } from "./image-generation.server";
import { checkpointJob, download, ffprobeDuration, runFfmpeg } from "./ugc-ad-pipeline.server";
import { animateAvatar, falEnabled, falTts } from "./fal-video.server";
import { AVATAR_VOICES } from "./avatar-voice-catalog";
import { mirrorRender } from "./object-storage.server";
import { filmTemplate, previewFilmTreatment, type FilmTreatment } from "./film-engine.server";

const RENDERS = () => path.join(process.cwd(), "data", "renders");

/** "NAME: line" (robust to run-together turns) → the FIRST turn's speaker + line.
 *  One speaker per shot, so the first turn is the whole line. */
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

/** Concat the talking clips with a short crossfade at each cut (same approach as the
 *  Veo pipeline). Degrade ladder: xfade+audio → concat+audio → concat+silent. */
async function assembleAvatarDialogue(clips: string[], outPath: string, jobId?: string): Promise<void> {
  const N = clips.length;
  if (!N) throw new Error("[avatardialogue] no clips");
  const beat = async () => { if (jobId) await checkpointJob(jobId, { ckBeat: Date.now() }); };
  const produced = (): boolean => { try { return fs.existsSync(outPath) && ffprobeDuration(outPath) > 1; } catch { return false; } };
  const SCALE = "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30";
  const TAIL = ["-threads", "2", "-filter_complex_threads", "2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outPath];

  const buildXfade = (): string[] | null => {
    if (N < 2) return null;
    const FADE = 0.2;
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
  resume?: { ckTreatment?: string; ckVoices?: string; ckPortraits?: string; ckClips?: string[] };
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
  const location = (treatment.scenes[0]?.visual || opts.topic || "a cinematic interior").slice(0, 220);

  // 2) VOICES — a fixed, distinct voice per character (zero drift).
  const voices: Record<string, string> = resume.ckVoices ? JSON.parse(resume.ckVoices) : assignVoices(cast, speakers);
  await ckpt({ ckVoices: JSON.stringify(voices) });

  // 3) PORTRAITS — one LOCKED photoreal actor per character, with shot/reverse-shot
  //    eyelines (first speaker looks right, next looks left) so intercutting reads as
  //    a conversation. Generated once, reused for every line → identical face, no morph.
  const portraits: Record<string, string> = resume.ckPortraits ? JSON.parse(resume.ckPortraits) : {};
  for (let s = 0; s < speakers.length; s++) {
    const sp = speakers[s];
    if (portraits[sp]) continue;
    const bible = cast.find((c) => sp && c.toLowerCase().includes(sp.toLowerCase())) || `${sp || "a character"}, a person`;
    const side = s % 2 === 0 ? "to their right" : "to their left";
    const pPrompt =
      `Photorealistic cinematic PORTRAIT of ${bible}. Head-and-shoulders, set in this location: ${location}. ` +
      `Three-quarter angle, looking slightly ${side} as if speaking to someone just off camera (NOT straight at the viewer). ` +
      `Natural film lighting, shallow depth of field, filmic and real. Absolutely no text, letters, captions, signage or screens anywhere. Vertical 9:16 framing.`;
    let url: string | null = null;
    try { url = await renderCreativeSeed(pPrompt, "9:16"); } catch { url = null; }
    if (!url) throw new Error(`[avatardialogue] no portrait for ${sp || "speaker"}`);
    portraits[sp] = url;
    await ckpt({ ckPortraits: JSON.stringify(portraits) });
  }
  const firstPortrait = Object.values(portraits)[0];

  // 4) Per beat: TTS the line in that character's FIXED voice → HeyGen lip-syncs the
  //    character's locked portrait. HeyGen clip length == audio length, so no dead air.
  const clips: string[] = (resume.ckClips || []).filter((p) => p && fs.existsSync(p));
  for (let i = clips.length; i < beats.length; i++) {
    const { speaker, line } = beats[i];
    const voiceId = voices[speaker] || AVATAR_VOICES[0].id;
    const portraitAbs = abs(portraits[speaker]) || abs(firstPortrait);
    if (!portraitAbs) throw new Error(`[avatardialogue] scene ${i + 1}: no portrait`);
    const audioUrl = await falTts(line || "…", voiceId, 1, { lang: null, emotion: "neutral" });
    const clipUrl = await animateAvatar(portraitAbs, audioUrl);
    const outClip = path.join(RENDERS(), `ad-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp4`);
    await download(clipUrl, outClip);
    if (!(fs.existsSync(outClip) && ffprobeDuration(outClip) > 0.5)) throw new Error(`[avatardialogue] scene ${i + 1}: clip did not download`);
    clips.push(outClip);
    await ckpt({ ckClips: clips });
  }
  if (!clips.length) throw new Error("[avatardialogue] no clips rendered");

  // 5) ASSEMBLE — intercut the talking clips with a short crossfade, keep the dialogue audio.
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
