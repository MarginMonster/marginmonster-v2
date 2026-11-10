// TEST MOVIE — the dialogue experiment, kept SEPARATE from the main Film engine
// (film-engine.server.ts generateFilm is untouched) so the working pipeline is
// never at risk. Owner's spec: characters that actually SPEAK plot dialogue +
// scenes that FLOW, instead of a narrator talking over disconnected clips.
//
// Design (tuned from owner feedback on real renders):
//   1. ONE SPEAKER PER CLIP — each Veo clip is a TWO-SHOT (both characters in
//      frame) where ONE character speaks a full 1-2 sentence beat and the other
//      listens/reacts; the speaker ALTERNATES clip to clip. Veo's single-voice
//      output is clean, but it DISTORTS when asked to voice two characters inside
//      one clip — so we keep it to one voice per clip and pin that voice.
//   2. SEAMLESS CUTS — clip N>0 is seeded DIRECTLY from clip N-1's ACTUAL last
//      frame (the owner's "use the last frame" idea), so positions carry over
//      exactly instead of teleporting. Safe now because it's a two-shot: the next
//      speaker is already in frame, so Veo voices them without wrong-speaker
//      gibberish. Clip 0 seeds from the cast reference.
//   3. NO ON-SCREEN TEXT — Veo hallucinates garbled "captions"/documents, so both
//      the seed and Veo prompts hard-ban text and we keep the set clean; trailing
//      silence is trimmed so clips end on the last word (no dead-air pause).
//
// Sequential by necessity (each clip seeds from the last) — the price of flow.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db.server";
import { renderCreativeSeed, renderStyledSeed, renderStyledSeedMulti, renderSceneSeedChained, renderSideBySideTwoShot } from "./image-generation.server";
import { AVATAR_VOICES } from "./avatar-voice-catalog";
import { checkpointJob, download, ffprobeDuration, repCreate, repPoll, runFfmpeg } from "./ugc-ad-pipeline.server";
import { falEnabled, falVideoPoll, falVideoSubmit } from "./fal-video.server";
import { mirrorRender } from "./object-storage.server";
import { filmTemplate, previewFilmTreatment, type FilmTreatment } from "./film-engine.server";
import { clipSecondsFor } from "./speech-meter";

const RENDERS = () => path.join(process.cwd(), "data", "renders");
const VEO_POLL_MS = 10 * 60_000;
// FULL Veo-3 (not the "fast" tier) for the Test Movie: better multi-speaker
// dialogue, lip-sync and VOICE consistency. Film is free during build, so we
// trade cost/time for quality here. fal veo3.1 → Replicate google/veo-3 fallback.
const FAL_VEO = "fal-ai/veo3.1/image-to-video";
const REP_VEO = "google/veo-3";

/** Parse a caption into ordered { speaker, line } turns. A shot is normally ONE
 *  speaker ("NAME: the line"), but this stays robust if the writer runs extra
 *  turns together ("MARA: ...I know it.ELI: Careful...") — the editable field is a
 *  single-line <input> that strips newlines, so we split on the speaker LABELS (a
 *  capitalized name + colon), not on newlines. The caller takes the first speaker
 *  and joins the lines, so a clip always voices a single character. */
function splitExchange(caption: string): Array<{ speaker: string; line: string }> {
  const c = (caption || "").replace(/\s+/g, " ").trim();
  if (!c) return [{ speaker: "", line: "" }];
  // A speaker label = one capitalized word (any script) + colon. Single-word +
  // uppercase-start avoids matching dialogue clauses (which have spaces/no colon).
  const re = /(\p{Lu}[\p{L}'’-]{1,20}):/gu;
  const marks: Array<{ name: string; idx: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(c)) !== null) marks.push({ name: m[1], idx: m.index, end: re.lastIndex });
  if (!marks.length) return [{ speaker: "", line: c }];
  const turns: Array<{ speaker: string; line: string }> = [];
  for (let k = 0; k < marks.length; k++) {
    const line = c.slice(marks[k].end, k + 1 < marks.length ? marks[k + 1].idx : c.length).trim();
    if (line) turns.push({ speaker: marks[k].name.trim(), line });
  }
  return turns.length ? turns : [{ speaker: "", line: c }];
}

/** A Veo clip where the characters SPEAK an exchange (audio on). FULL Veo-3:
 *  fal veo3.1 → Replicate google/veo-3 fallback. Returns the clip URL. */
async function veoDialogueClip(seedAbs: string, prompt: string, stage: string, aspect: "9:16" | "16:9" | "1:1" = "9:16"): Promise<string> {
  if (falEnabled()) {
    try {
      // fal Veo inherits the start image's aspect, so the seed shape carries the frame.
      const rid = await falVideoSubmit(FAL_VEO, { startImage: seedAbs, prompt, generateAudio: true });
      return await falVideoPoll(FAL_VEO, rid, VEO_POLL_MS);
    } catch (e) {
      console.error(`[testmovie] fal veo failed, trying Replicate: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    }
  }
  const id = await repCreate(REP_VEO, { prompt, image: seedAbs, aspect_ratio: aspect, generate_audio: true });
  return await repPoll(id, VEO_POLL_MS, stage);
}

// Kling 3 Omni — the CHEAPER native-dialogue renderer, wired as a SWAPPABLE engine so
// the merchant can run the IDENTICAL pipeline (same seed, chain, re-anchor, tone prompt,
// assembly) on a different model and A/B the quality-per-dollar. 10s holds lip-sync
// better than 15s. fal kling-video/v3/pro → Replicate kwaivgi/kling-v3-omni fallback.
const FAL_KLING3 = "fal-ai/kling-video/v3/pro/image-to-video";
const REP_KLING3 = "kwaivgi/kling-v3-omni-video";
const KLING_DUR = 10;

/** A Kling 3 Omni dialogue clip (native lip-synced audio) — byte-for-byte the same role
 *  as veoDialogueClip, only the renderer differs. Returns the clip URL. */
async function klingDialogueClip(seedAbs: string, prompt: string, stage: string, durationSec = KLING_DUR): Promise<string> {
  const dur = Math.max(5, Math.min(KLING_DUR, Math.round(durationSec) || KLING_DUR));
  if (falEnabled()) {
    try {
      const rid = await falVideoSubmit(FAL_KLING3, { startImage: seedAbs, prompt, generateAudio: true, durationSec: dur });
      return await falVideoPoll(FAL_KLING3, rid, VEO_POLL_MS);
    } catch (e) {
      console.error(`[testmovie] fal kling failed, trying Replicate: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    }
  }
  const id = await repCreate(REP_KLING3, { prompt, start_image: seedAbs, generate_audio: true, duration: dur });
  return await repPoll(id, VEO_POLL_MS, stage);
}

/** Route a dialogue clip to the chosen engine — the ONE line that differs between the
 *  identical Veo and Kling pipelines. */
async function dialogueClip(engine: string, seedAbs: string, prompt: string, stage: string, durationSec?: number, aspect?: "9:16" | "16:9" | "1:1"): Promise<string> {
  // Only Kling takes a per-clip length; Veo keeps its native clip. Kling inherits the seed's
  // aspect (the seed is rendered at the chosen ratio); Veo-Replicate takes it explicitly.
  return engine === "kling3" ? klingDialogueClip(seedAbs, prompt, stage, durationSec) : veoDialogueClip(seedAbs, prompt, stage, aspect);
}

/** Render ONE dialogue clip end-to-end (render + download + head/tail + interior-pause trims)
 *  → a local file path. The render loop does this inline; the SECTION EDITOR's regenerate
 *  reuses it to re-roll a single shot from its stored seed + prompt. */
export async function renderDialogueClipTo(engine: "veo" | "kling3", seedAbs: string, prompt: string, durSec: number, aspect: "9:16" | "16:9" | "1:1", stage: string): Promise<string> {
  const clipUrl = await dialogueClip(engine, seedAbs, prompt, stage, durSec, aspect);
  const rawPath = path.join(RENDERS(), `tm-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp4`);
  await download(clipUrl, rawPath);
  if (!(fs.existsSync(rawPath) && ffprobeDuration(rawPath) > 1)) throw new Error("[regen] clip did not download");
  const trimmed = await trimTrailingSilence(rawPath);
  return await collapseInteriorPause(trimmed);
}

/** Grab the ACTUAL last frame of a rendered clip as a clean still (served from
 *  /renders). Used as the continuity REFERENCE for the next scene's seed — so the
 *  room and everyone's FINAL positions carry forward (the owner's "reuse the last
 *  frame" idea) — without feeding the blurry frame straight into Veo (which, on a
 *  speaker switch, made the audio gibberish). Returns a relative /renders URL. */
async function extractLastFrame(videoPath: string): Promise<string | null> {
  try {
    const name = `tmf-${Date.now()}-${crypto.randomBytes(5).toString("hex")}.jpg`;
    const out = path.join(RENDERS(), name);
    const r = await runFfmpeg(["-y", "-sseof", "-0.2", "-i", videoPath, "-frames:v", "1", "-q:v", "2", out]);
    if (r.status === 0 && fs.existsSync(out)) return `/renders/${name}`;
  } catch { /* fall through — chain falls back to the scene's own seed still */ }
  return null;
}

/** Crop one half (left or right panel) out of the two-panel shot/reverse image → a
 *  single over-the-shoulder seed for that speaker. Persists to /renders (+ S3 mirror)
 *  so Veo can fetch it. Returns the relative URL, or null. */
async function cropPanelSeed(panelRelUrl: string, side: "left" | "right"): Promise<string | null> {
  try {
    const local = panelRelUrl.startsWith("/renders/") ? path.join(RENDERS(), path.basename(panelRelUrl)) : "";
    if (!local || !fs.existsSync(local)) return null;
    const name = `panel-${side}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.jpg`;
    const out = path.join(RENDERS(), name);
    const x = side === "left" ? "0" : "iw/2";
    const r = await runFfmpeg(["-y", "-i", local, "-vf", `crop=iw/2:ih:${x}:0`, "-frames:v", "1", "-q:v", "2", out]);
    if (r.status === 0 && fs.existsSync(out)) {
      try { await mirrorRender(name, fs.readFileSync(out)); } catch { /* non-fatal */ }
      return `/renders/${name}`;
    }
  } catch { /* fall through — caller uses the chain seed instead */ }
  return null;
}

/** Trim the trailing silence (dead air after the last spoken word) so a clip ends
 *  on the line, not on a long pause before the cut. Detects the final silence run
 *  with ffmpeg silencedetect and cuts there (+ a short tail), re-encoding for a
 *  frame-accurate cut. Returns a NEW path, or the original if nothing to trim. */
async function trimTrailingSilence(inPath: string): Promise<string> {
  try {
    const dur = ffprobeDuration(inPath);
    if (!(dur > 2)) return inPath;
    const probe = await runFfmpeg(["-i", inPath, "-af", "silencedetect=noise=-33dB:d=0.6", "-f", "null", "-"]);
    const err = probe.stderr || "";
    const starts = [...err.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => parseFloat(m[1]));
    const ends = [...err.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
    // LEADING silence: a silence that starts at/near 0 and ends → the actor stands there
    // before talking, which reads as an awkward pause before the reply. Trim the clip to
    // start right as the speech does (leave a hair of lead-in). The clip's LAST frame is
    // unchanged, so the seamless chain is unaffected.
    let startAt = 0;
    if (starts.length && starts[0] <= 0.3 && ends.length && ends[0] > 0.35) {
      startAt = Math.max(0, ends[0] - 0.12);
    }
    // Trailing silence = a silence_start that runs to EOF (no later silence_end).
    const lastStart = starts.length ? starts[starts.length - 1] : NaN;
    const lastEnd = ends.length ? ends[ends.length - 1] : NaN;
    const trailing = !Number.isNaN(lastStart) && (Number.isNaN(lastEnd) || lastEnd < lastStart);
    let endAt = dur;
    if (trailing && lastStart > startAt + 1.0 && lastStart < dur - 0.3) {
      endAt = Math.min(dur, lastStart + 0.45);
    }
    if (startAt > 0.15 || endAt < dur - 0.2) {
      const out = inPath.replace(/\.mp4$/i, "-trim.mp4");
      const args = ["-y", "-i", inPath];
      if (startAt > 0.15) args.push("-ss", startAt.toFixed(2));
      args.push("-t", Math.max(0.8, endAt - startAt).toFixed(2), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out);
      const r = await runFfmpeg(args);
      if (r.status === 0 && fs.existsSync(out) && ffprobeDuration(out) > 0.8) return out;
    }
  } catch { /* keep the original clip */ }
  return inPath;
}

/** Collapse ONE long pause in the MIDDLE of a clip (dead air between words where the
 *  speaker just stands there) — the head/tail trim above never touches interior gaps, which
 *  is what reads as "a somewhat long awkward pause". Detects the longest fully-interior
 *  silence with silencedetect and excises most of it (keeping a short natural beat), cutting
 *  BOTH video and audio at the same points so lip-sync holds. The clip's LAST frame is
 *  unchanged (the span removed is in the middle), so the seamless chain is unaffected.
 *  Conservative on purpose: one clearly-long (>1s) interior pause per clip, and only if the
 *  result stays valid. Returns a NEW path, or the original if there's nothing to do. */
async function collapseInteriorPause(inPath: string): Promise<string> {
  try {
    const dur = ffprobeDuration(inPath);
    if (!(dur > 3)) return inPath; // too short for a mid-clip pause to matter
    const probe = await runFfmpeg(["-i", inPath, "-af", "silencedetect=noise=-33dB:d=0.7", "-f", "null", "-"]);
    const err = probe.stderr || "";
    // silencedetect prints "silence_end: <end> | silence_duration: <len>" for each COMPLETE
    // silence run; start = end - len. (A run with no end ran to EOF = trailing — not here.)
    const runs = [...err.matchAll(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g)]
      .map((m) => { const end = parseFloat(m[1]); const len = parseFloat(m[2]); return { start: end - len, end, len }; })
      // interior only: clear of the head and tail (those are trimTrailingSilence's job)
      .filter((r) => r.len > 1.0 && r.start > 0.8 && r.end < dur - 0.8)
      .sort((a, b) => b.len - a.len);
    if (!runs.length) return inPath;
    const { start, end } = runs[0];
    const keep1 = +(start + 0.22).toFixed(2); // leave a short natural beat of the pause
    const start2 = +end.toFixed(2);
    // Both kept halves must be substantial, and the excised span worth cutting.
    if (keep1 < 0.6 || dur - start2 < 0.6 || start2 - keep1 < 0.5) return inPath;
    const out = inPath.replace(/\.mp4$/i, "-nogap.mp4");
    const fc = [
      `[0:v]trim=0:${keep1},setpts=PTS-STARTPTS[v0]`,
      `[0:a]atrim=0:${keep1},asetpts=PTS-STARTPTS[a0]`,
      `[0:v]trim=start=${start2},setpts=PTS-STARTPTS[v1]`,
      `[0:a]atrim=start=${start2},asetpts=PTS-STARTPTS[a1]`,
      `[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`,
    ].join(";");
    const r = await runFfmpeg(["-y", "-i", inPath, "-filter_complex", fc, "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out]);
    if (r.status === 0 && fs.existsSync(out) && ffprobeDuration(out) > 1) return out;
  } catch { /* keep the original clip */ }
  return inPath;
}

/** Concatenate the Veo clips, KEEPING their dialogue audio (unlike the main
 *  engine, which strips clip audio for a narrator/music bed). Degrade ladder:
 *  with audio → silent, so a clip that came back without an audio stream can't
 *  sink the whole render. */
export async function assembleTestMovie(clips: string[], outPath: string, jobId?: string, softSeams?: Set<number>, aspect: "9:16" | "16:9" | "1:1" = "9:16"): Promise<void> {
  const N = clips.length;
  if (!N) throw new Error("[testmovie] no clips");
  const beat = async () => { if (jobId) await checkpointJob(jobId, { ckBeat: Date.now() }); };
  const produced = (): boolean => { try { return fs.existsSync(outPath) && ffprobeDuration(outPath) > 1; } catch { return false; } };
  // Trim the bottom ~10% before scaling — a safety net against Veo's stochastic
  // hallucinated subtitles/captions, which sit along the bottom edge (the prompt ban
  // reduces but doesn't fully stop them). Heads stay (crop is anchored at the top);
  // only lower-chest/background is lost, which also tightens the faces slightly.
  const [W, H] = aspect === "16:9" ? [1280, 720] : aspect === "1:1" ? [720, 720] : [720, 1280];
  const SCALE = `crop=iw:ih*0.90:0:0,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30`;
  const TAIL = ["-threads", "2", "-filter_complex_threads", "2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outPath];

  // PREFERRED: a short CROSSFADE at each cut (video xfade + audio acrossfade) so the
  // clip change reads as a smooth dissolve, not a clunky hard jump. Because clip N is
  // seeded from clip N-1's last frame, the two frames are nearly identical, so the
  // dissolve is almost invisible — it just softens the re-animation hitch. Needs each
  // clip's duration for the offsets; if anything is off we fall back to concat below.
  const buildXfade = (): string[] | null => {
    if (N < 2) return null;
    // Chained cuts (clip N seeded from clip N-1's real last frame) are near-identical, so a
    // tiny 0.18s dissolve is effectively invisible. A REFRAME seam (new location / camera
    // angle / re-anchor) jumps more, so it gets a longer, softer 0.32s dissolve that reads
    // as a deliberate cut to a new camera instead of a hitch. softSeams holds those indices.
    const fadeFor = (i: number) => (softSeams?.has(i) ? 0.32 : 0.18);
    const durs = clips.map((c) => { try { return ffprobeDuration(c); } catch { return 0; } });
    if (durs.some((d) => !(d > 0.62))) return null; // every clip must outlast the longest fade + margin
    const a: string[] = ["-y"];
    clips.forEach((c) => a.push("-i", c));
    const f: string[] = [];
    clips.forEach((_, i) => {
      f.push(`[${i}:v]${SCALE},setpts=PTS-STARTPTS[v${i}]`);
      f.push(`[${i}:a]aresample=44100,asetpts=PTS-STARTPTS[a${i}]`);
    });
    let vPrev = "v0", aPrev = "a0", running = durs[0];
    for (let i = 1; i < N; i++) {
      const FADE = fadeFor(i);
      const vOut = i === N - 1 ? "vc" : `vx${i}`;
      const aOut = i === N - 1 ? "ac" : `ax${i}`;
      f.push(`[${vPrev}][v${i}]xfade=transition=fade:duration=${FADE}:offset=${Math.max(0, running - FADE).toFixed(3)}[${vOut}]`);
      f.push(`[${aPrev}][a${i}]acrossfade=d=${FADE}[${aOut}]`);
      vPrev = vOut; aPrev = aOut; running = running + durs[i] - FADE;
    }
    return [...a, "-filter_complex", f.join(";"), "-map", "[vc]", "-map", "[ac]", ...TAIL];
  };

  // FALLBACK: plain hard-cut concat. Degrade ladder: with audio → silent.
  const buildConcat = (useAudio: boolean): string[] => {
    const a: string[] = ["-y"];
    clips.forEach((c) => a.push("-i", c));
    const f: string[] = [];
    clips.forEach((_, i) => {
      f.push(`[${i}:v]${SCALE},setpts=PTS-STARTPTS[v${i}]`);
      if (useAudio) f.push(`[${i}:a]aresample=44100,asetpts=PTS-STARTPTS[a${i}]`);
    });
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
  throw new Error(`[testmovie] ffmpeg failed: ${lastErr}`);
}

// Shared prompt fragments for the dialogue seed frames + Veo clips. Module-scope
// so the web "preview frame" action renders a WYSIWYG storyboard frame with the
// SAME prompt the render uses.
const NO_TEXT = "Absolutely NO on-screen text of any kind: no subtitles, no captions, no karaoke text, no titles, no lower-thirds, and no readable writing on any paper, document, folder, bulletin board, whiteboard, sign, poster or screen anywhere in the frame. Do NOT display the spoken dialogue as text, and keep the BOTTOM edge of the frame completely clean and text-free. Every surface is blank.";
const HOLD_STILL = "The characters STAY in their positions — no standing up, sitting down, walking or crossing the room, only natural small gestures, head turns and talking. Keep every character's face, hair, hairstyle, clothing and wardrobe EXACTLY the same the whole time — no morphing, melting or changing of anyone's appearance.";
// Keep both faces in the shot (continuity) WITHOUT forcing them into the same
// space — "two-shot in the room" overrode scenes that place the characters apart
// (one inside, one outside a window), collapsing them onto the same side. Honour
// the scene's own staging instead.
const STAGING = "Frame it as a TWO-SHOT that keeps BOTH characters visible in the shot, but place each one EXACTLY where the scene describes: if they are apart — one indoors and one outdoors, on opposite sides of a window, door, wall or other barrier, or separated by glass — KEEP that separation with the barrier clearly between them; never merge them into the same space or onto the same side.";

/** Build + render ONE scene's photo seed (the storyboard frame). Shared by the
 *  render loop and the web "preview frame" action so the preview is WYSIWYG.
 *  Returns a relative /renders URL, or null on failure (caller decides fallback). */
export async function renderSceneFrame(opts: { sceneVisual: string; sceneHint: string; castText?: string; styleRefUrl?: string | null; castRefUrls?: (string | null | undefined)[]; roomRefUrl?: string | null; aspect?: "9:16" | "16:9" | "1:1" }): Promise<string | null> {
  const ar = opts.aspect || "9:16";
  const framed = `${opts.sceneVisual}. ${opts.sceneHint}. ${STAGING} ${opts.castText || ""} ${NO_TEXT}`.replace(/\s+/g, " ").trim();
  try {
    const castRefs = (opts.castRefUrls || []).filter((u): u is string => !!u);
    // CONTINUITY path first: when we have the PREVIOUS shot's frame AND the locked
    // cast faces, chain them — the prior frame anchors the room/lighting/angle while
    // the faces lock identity. Without this the room was reinvented every shot and the
    // clips cut between unrelated sets (the "four different rooms" bug).
    if (opts.roomRefUrl && castRefs.length) {
      const chained = await renderSceneSeedChained(framed, opts.roomRefUrl, castRefs, ar);
      if (chained) return chained;
    }
    // CAST path: when the shot's actors are locked (but no prior frame to chain from,
    // e.g. the opening shot), compose from their faces so identity holds shot-to-shot.
    if (castRefs.length) {
      const multi = await renderStyledSeedMulti(framed, castRefs, ar);
      if (multi) return multi;
    }
    return opts.styleRefUrl
      ? ((await renderStyledSeed(framed, opts.styleRefUrl, ar)) || (await renderCreativeSeed(framed, ar)))
      : await renderCreativeSeed(framed, ar);
  } catch { return null; }
}

/** Template-resolving wrapper for the web action (which has the template key, not
 *  the sceneHint). */
export async function previewFilmSceneFrame(opts: { template?: string; sceneVisual: string; castText?: string; styleRefUrl?: string | null; castRefUrls?: (string | null | undefined)[] }): Promise<string | null> {
  const tmpl = filmTemplate(opts.template);
  // In the storyboard, styleRefUrl IS the previous shot's frame — use it as the ROOM
  // anchor so each new shot is "same room, new angle, same characters" (owner's fix for
  // clips that cut between unrelated sets). renderSceneFrame only chains when BOTH a
  // room ref and cast faces are present; otherwise it falls back to the old behaviour.
  return renderSceneFrame({ sceneVisual: opts.sceneVisual, sceneHint: tmpl.sceneHint, castText: opts.castText, styleRefUrl: opts.styleRefUrl, roomRefUrl: opts.styleRefUrl, castRefUrls: opts.castRefUrls });
}

/** Cast an actor: a clean, reusable casting PORTRAIT of one character, locked once
 *  and reused as the face reference for every shot they appear in. This is the
 *  "cast member" primitive — the same move as a Runway Reference / Kling Element. */
export async function renderActorPortrait(description: string): Promise<string | null> {
  const desc = (description || "").trim().slice(0, 400);
  const prompt = `A clean, photorealistic 3/4 casting-portrait headshot of ${desc}. One person only, natural soft studio lighting, plain neutral background, sharp focus on the face, looking just off camera, cinematic, photoreal. No readable text.`;
  return renderCreativeSeed(prompt, "9:16");
}

/** The cast members whose name appears in a scene (speaker always counts). Used to
 *  condition each shot's seed frame on the right locked faces. */
function actorsInScene(cast: Array<{ name: string; faceUrl?: string | null; voiceId?: string | null }>, scene: { visual?: string; caption?: string }): Array<{ name: string; faceUrl?: string | null; voiceId?: string | null }> {
  const hay = `${scene.visual || ""} ${scene.caption || ""}`.toLowerCase();
  return cast.filter((c) => { const key = (c.name || "").toLowerCase().split(/[\s,]/)[0]; return key && hay.includes(key); });
}

export async function generateTestMovie(opts: {
  shopId: string;
  template?: string;
  topic?: string;
  treatment?: FilmTreatment;
  sceneCount?: number;
  section?: string;
  jobId?: string;
  resume?: { ckTreatment?: string; ckCastRef?: string; ckClips?: string[]; ckLastStill?: string; ckPanels?: string; ckSideShot?: string; ckMasters?: string };
  /** Per-scene APPROVED storyboard frames (relative /renders URLs), index-aligned
   *  with the treatment's scenes. A present entry overrides the auto-seed/chain for
   *  that scene so it lands exactly as the merchant staged it. */
  approvedFrames?: (string | null)[];
  /** Cast the merchant locked in the UI: each character's name + face reference +
   *  pinned voice id. Every shot's auto-seed is composed from the faces of the cast
   *  present in it (locked identity), and the speaker's voice timbre is pinned into
   *  the Veo prompt so the voice stays consistent across shots. */
  cast?: Array<{ name: string; faceUrl?: string | null; voiceId?: string | null }>;
  /** Which renderer runs the dialogue clips — the ONE thing that differs between the
   *  otherwise-identical engine pipelines. "kling3" (default, cheaper) or "veo" (premium,
   *  native audio). Recorded on the asset so the Archive shows which model made the film. */
  dialogueEngine?: "veo" | "kling3";
  /** Output aspect ratio: "9:16" vertical (Shorts/TikTok, default), "16:9" landscape
   *  (YouTube/TV/film — horizontal room for groups + cinematic blocking), or "1:1". */
  aspect?: "9:16" | "16:9" | "1:1";
}): Promise<string> {
  const tmpl = filmTemplate(opts.template); // "testmovie"
  // Style/mode switches so the ONE dialogue pipeline serves photoreal talking films
  // (Short Film / Moral / Horror), cartoon talking films (Kids Cartoon · Peppa/Bluey) and
  // sung films (Music Video, Kids Music Video · CoComelon). Everything else is identical.
  const cartoon = !!tmpl.cartoon;
  const sing = !!tmpl.sing;
  const twoStyle: "photoreal" | "cartoon" = cartoon ? "cartoon" : "photoreal";
  // Output aspect: 9:16 vertical (default, validated), 16:9 landscape (YouTube/TV/film —
  // room for groups + cinematic blocking), or 1:1. Threaded to EVERY seed render + the
  // clip render + the assembly crop so the whole film is natively that shape (not cropped).
  const aspect: "9:16" | "16:9" | "1:1" = opts.aspect === "16:9" || opts.aspect === "1:1" ? opts.aspect : "9:16";
  const [AW, AH] = aspect === "16:9" ? [1280, 720] : aspect === "1:1" ? [720, 720] : [720, 1280];
  const dialogueEngine = opts.dialogueEngine === "veo" ? "veo" : "kling3";
  const jobId = opts.jobId;
  const resume = opts.resume || {};
  const approvedFrames = opts.approvedFrames || [];
  const ckpt = async (patch: Record<string, unknown>) => { if (jobId) await checkpointJob(jobId, patch); };
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const abs = (u: string | null | undefined): string | undefined => (u ? (u.startsWith("http") ? u : `${base}${u}`) : undefined);

  // 1) SCRIPT — dialogue beats (caption = "NAME: line"). Approved words win.
  let treatment: FilmTreatment;
  if (resume.ckTreatment) treatment = JSON.parse(resume.ckTreatment);
  else if (opts.treatment && opts.treatment.scenes?.length) treatment = opts.treatment;
  else treatment = await previewFilmTreatment({ shopId: opts.shopId, template: tmpl.key, topic: opts.topic, sceneCount: opts.sceneCount });
  const want = Math.max(tmpl.minScenes, Math.min(tmpl.maxScenes, opts.sceneCount ?? treatment.scenes.length));
  treatment.scenes = treatment.scenes.slice(0, want);
  await ckpt({ ckTreatment: JSON.stringify(treatment) });

  const castBible = treatment.cast && treatment.cast.length ? `The recurring cast (keep them identical in every shot): ${treatment.cast.join("; ")}.` : "";
  // Locked cast (faces + voices) the merchant cast in the UI — drives per-shot
  // identity conditioning and the Veo voice pin.
  const castActors = (opts.cast || []).filter((c) => c && c.name && c.name.trim());

  // 2) CAST REFERENCE still (photoreal) — establishes the characters' look; the
  //    first scene seeds from it, then the chain carries continuity.
  let castRefAbs = abs(resume.ckCastRef);
  if (!castRefAbs && castBible) {
    try {
      const ref = await renderCreativeSeed(`${tmpl.sceneHint}. A ${cartoon ? "bright, glossy 3D-animated cartoon" : "photorealistic cinematic"} group shot of the characters together in the scene, clear faces. ${castBible}`, aspect);
      if (ref) { await ckpt({ ckCastRef: ref }); castRefAbs = abs(ref); }
    } catch { /* fall through to text seeds */ }
  }

  // 2b) SIDE-BY-SIDE TWO-SHOT (the owner's "side by side thing"). Render ONE wide
  //     master where BOTH characters are fully in frame at once — seated across the
  //     table, filmed from the side — and seed EVERY clip from it. This REPLACES the
  //     over-the-shoulder shot/reverse panels: their blurred foreground head was
  //     generated independently of the reverse angle and so mismatched it (the owner's
  //     "back of the head has hair, then he's bald on the cut" continuity bug). With
  //     both people always fully framed there is nothing to mismatch, and because both
  //     faces are born from one generation the two people + the room are identical by
  //     construction and never drift. Gated on exactly two recurring speakers; anything
  //     else falls back to the existing chain untouched.
  const firstName = (n: string) => (n || "").toLowerCase().split(/[\s,]/)[0];
  const allSpeakers = Array.from(new Set(treatment.scenes.map((s) => splitExchange(s.caption || "").find((t) => t.speaker)?.speaker || "").filter(Boolean)));
  const isTwoHander = allSpeakers.length === 2;
  const [spkA, spkB] = allSpeakers;
  const bibleFor = (n: string) => (treatment.cast || []).find((c) => firstName(n) && c.toLowerCase().includes(firstName(n))) || `${n}, a person`;
  const faceFor = (n: string) => { const k = firstName(n); return abs(castActors.find((c) => { const nm = (c.name || "").toLowerCase(); return firstName(c.name) === k || (!!k && nm.split(/[\s,]/).includes(k)); })?.faceUrl); };
  const cleanSetting = (s: string) => (((s || "").split(/[.;]/)[0] || "")
    .replace(/\b(two[- ]?shot|wide shot|close[- ]?up|medium shot|over[- ]the[- ]shoulder|establishing|shot)\b/gi, "")
    .replace(/^\s*(across|of)\s+/i, "a ").replace(/\s+/g, " ").trim().slice(0, 130) || "a cinematic interior");

  // LOCATION MASTERS. Each distinct LOCATION (scene.where, else the opening visual) gets ONE
  // side-by-side master two-shot, built once + cached. Within a location every clip seeds
  // from (or chains off) its master, so the room + faces are identical; a NEW location builds
  // a NEW master (the deliberate scene-change cut, cast carried via the same faces); a NEW
  // camera angle in the SAME location re-frames that master (a cinematic cut that holds room
  // + faces). A flat treatment (no scene.where) collapses to a SINGLE location = the
  // validated seamless behaviour, byte-for-byte. Two-handers only; else the chain fallback.
  type Master = { url: string; aOnLeft: boolean; a: string; b: string };
  const masters: Record<string, Master> = {};
  try { const r = resume.ckMasters ? JSON.parse(resume.ckMasters) : null; if (r && typeof r === "object") Object.assign(masters, r); } catch { /* ignore */ }
  const masterFor = async (locKey: string, where: string, roomRef?: string): Promise<Master | undefined> => {
    if (!isTwoHander) return undefined;
    if (masters[locKey]?.url) return masters[locKey];
    // The master two-shot is the WHOLE film's seed — nano-banana occasionally returns null,
    // which hard-killed the render with "no seed frame". Retry a few times before giving up.
    let url: string | null = null;
    for (let attempt = 0; attempt < 3 && !url; attempt++) {
      url = await renderSideBySideTwoShot({ roomRefUrl: roomRef, faceA: faceFor(spkA), faceB: faceFor(spkB), descA: bibleFor(spkA), descB: bibleFor(spkB), setting: cleanSetting(where), style: twoStyle, aspect });
    }
    if (!url) return undefined;
    // DETECT which side each character landed on — nano-banana doesn't reliably honour
    // left/right, and the clip prompt needs the real side to point Veo at the speaker.
    let aOnLeft = true;
    try {
      const { anthropicVision } = await import("./anthropic.server");
      const twoAbs = abs(url);
      if (twoAbs) {
        const v = await anthropicVision(
          `Two people are together in this image. Person A is: ${bibleFor(spkA)}. Person B is: ${bibleFor(spkB)}. Which of them is on the LEFT side of the frame? Answer with a single letter, A or B, and nothing else.`,
          [twoAbs], { maxTokens: 4 }
        );
        if ((v || "").trim().toUpperCase().startsWith("B")) aOnLeft = false;
      }
    } catch { /* keep default A-on-left */ }
    masters[locKey] = { url, aOnLeft, a: firstName(spkA), b: firstName(spkB) };
    await ckpt({ ckMasters: JSON.stringify(masters) });
    return masters[locKey];
  };
  const sideForMaster = (m: Master | undefined) => (sp: string): "left" | "right" | "" => {
    if (!m) return "";
    const k = firstName(sp);
    if (k && k === m.a) return m.aOnLeft ? "left" : "right";
    if (k && k === m.b) return m.aOnLeft ? "right" : "left";
    return "";
  };

  // Per-scene LOCATION + ANGLE, and the transition that opens each beat. `where` defaults to
  // the prior beat's location (else the opening visual); `shot` defaults to the wide two-shot.
  const scenesArr = treatment.scenes;
  const whereAt: string[] = [];
  const shotAt: string[] = [];
  for (let i = 0; i < scenesArr.length; i++) {
    whereAt[i] = (scenesArr[i].where || "").trim() || (i > 0 ? whereAt[i - 1] : ((scenesArr[0]?.visual || opts.topic || "a cinematic interior")));
    shotAt[i] = (scenesArr[i].shot || "").trim() || "wide two-shot";
  }
  const locKeyAt = (i: number) => whereAt[i].toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60) || "loc";
  const transitionAt = (i: number): "location" | "angle" | "continue" => {
    if (i === 0) return "location";
    if (locKeyAt(i) !== locKeyAt(i - 1)) return "location";
    if (shotAt[i] !== shotAt[i - 1]) return "angle";
    return "continue";
  };

  // 3) Veo DIALOGUE clips (sequential) — see the design notes atop this file: one
  //    speaker per clip, seamless cuts from the prior clip's real last frame, no
  //    on-screen text, trailing silence trimmed.
  const clips: string[] = (resume.ckClips || []).filter((p) => p && fs.existsSync(p));
  // Per-shot render inputs recorded for the section editor's Phase-3 regenerate (each shot's
  // seed + clip prompt + duration). Pre-filled null for any clips restored from a resume.
  const shotSeeds: (string | null)[] = clips.map(() => null);
  const shotPrompts: (string | null)[] = clips.map(() => null);
  const shotDurs: number[] = clips.map(() => 0);
  let prevFrameUrl: string | undefined = resume.ckLastStill; // prior clip's last frame (relative /renders URL)
  // Chaining from each clip's last frame gives seamless cuts but lets faces (esp. facial
  // hair) DRIFT over a long film. Re-anchor to the pristine master after this many chained
  // clips so drift can't accumulate (owner: "mustache disappearing and reappearing").
  // Owner's call: push the re-anchor FARTHER apart (Kling holds faces far better than Veo
  // did, so drift accumulates slower) AND render each re-anchor as an intentional CAMERA-
  // ANGLE change, so the drift-reset reads as a deliberate cut to a new camera rather than a
  // snap back to the same frame. softSeams = clip indices whose seam-before is a reframe
  // (location / angle / re-anchor) → the assembler gives those a longer, softer dissolve.
  const ANCHOR_EVERY = 3;
  const ANCHOR_ANGLES = [
    "a slightly tighter two-shot",
    "a medium two-shot from a subtly lower angle",
    "a closer two-shot of the same two people",
    "a slightly wider two-shot",
  ];
  let anchorCount = 0;
  const softSeams = new Set<number>();
  let sinceAnchor = clips.length; // resume-safe-ish: force an early re-anchor after a restart
  for (let i = clips.length; i < treatment.scenes.length; i++) {
    const scene = treatment.scenes[i];
    const turns = splitExchange(scene.caption || "");
    // EXCHANGE-PER-CLIP: a shot now holds a short back-and-forth — turnA speaks, turnB
    // replies — so the clip is FULL of dialogue (Kling speaks ~0.28s/word, so a single line
    // only half-filled a clip and left it to pad with dead ambient standing-around). turnB is
    // the first LATER turn by a DIFFERENT speaker; absent it, we fall back to the single
    // validated speaker. `line` joins both turns so the clip is sized to the whole exchange.
    const fnm = (s: string) => (s || "").toLowerCase().split(/[\s,]/)[0];
    const turnA = turns[0] || { speaker: "", line: "" };
    const turnB = turns.find((t, k) => k > 0 && !!t.speaker && !!t.line && fnm(t.speaker) !== fnm(turnA.speaker)) || null;
    const speaker = turnA.speaker; // leads the shot — drives the seed continuity + voice pin
    const line = turns.map((t) => t.line).join(" ").replace(/\s+/g, " ").trim();

    // SEED by transition (see the LOCATION MASTERS note above):
    //  • location (clip 0 / scene change): the location's side-by-side MASTER — a clean cut
    //    to the place, the cast carried via the same locked faces.
    //  • angle (same location, new camera): RE-FRAME the master to this shot's angle — a
    //    cinematic cut that holds the identical room, lighting, wardrobe and faces.
    //  • continue (same shot): CHAIN from the prior clip's REAL last frame, so the clip
    //    continues exactly where the last ended and the 0.18s crossfade is invisible.
    // The merchant's APPROVED storyboard frame always wins. A flat treatment is one
    // location of "continue" beats → beat 0 = master, the rest chain (validated behaviour).
    const tr = transitionAt(i);
    const master = await masterFor(locKeyAt(i), whereAt[i], i === 0 ? abs(approvedFrames[0]) : undefined);
    const sideFor = sideForMaster(master);
    let seedAbs = abs(approvedFrames[i]);
    if (!seedAbs && master?.url) {
      if (tr === "location") {
        seedAbs = abs(master.url); sinceAnchor = 0; if (i > 0) softSeams.add(i);
      } else if (tr === "angle") {
        const reangled = await renderSceneSeedChained(
          `${whereAt[i]}. A ${shotAt[i]} of the same scene — the identical room, lighting, wardrobe and people, only the camera angle changes. ${NO_TEXT}`,
          abs(master.url)!, [faceFor(spkA), faceFor(spkB)].filter((u): u is string => !!u), aspect,
        );
        seedAbs = abs(reangled) || abs(prevFrameUrl) || abs(master.url); sinceAnchor = 0; softSeams.add(i);
      } else if (sinceAnchor >= ANCHOR_EVERY) {
        // RE-ANCHOR as an INTENTIONAL camera move (owner's call): still reseed from the
        // pristine master so faces / facial hair can't drift across a long film — but route
        // it through a FRESH ANGLE so the reset reads as a deliberate cut to a new camera,
        // not a snap back to the same frame. The generic framings (tighter / wider / lower)
        // fit ANY setting, and the master image keeps the identical room, lighting,
        // wardrobe and faces, so the angle change is grounded in the real scene.
        const ang = ANCHOR_ANGLES[anchorCount++ % ANCHOR_ANGLES.length];
        const reangled = await renderSceneSeedChained(
          `${whereAt[i]}. ${ang} of the same scene — the identical room, lighting, wardrobe and the same two people in the same positions, ONLY the camera angle changes. ${NO_TEXT}`,
          abs(master.url)!, [faceFor(spkA), faceFor(spkB)].filter((u): u is string => !!u), aspect,
        );
        seedAbs = abs(reangled) || abs(master.url); sinceAnchor = 0; softSeams.add(i);
      } else {
        seedAbs = abs(prevFrameUrl) || abs(master.url); sinceAnchor++;
      }
    }
    if (!seedAbs) {
      // Non-two-hander (or the master couldn't render): chain if we can, else compose the
      // seed from the locked faces of the cast in THIS shot so the actors hold shot-to-shot.
      seedAbs = abs(prevFrameUrl);
      if (!seedAbs) {
        const shotCastRefs = actorsInScene(castActors, scene).map((c) => abs(c.faceUrl)).filter((u): u is string => !!u);
        seedAbs = abs(await renderSceneFrame({ sceneVisual: scene.visual, sceneHint: tmpl.sceneHint, castText: castBible, styleRefUrl: castRefAbs, castRefUrls: shotCastRefs, aspect }));
      }
    }
    if (!seedAbs) throw new Error(`[testmovie] scene ${i + 1}: no seed frame`);

    // Veo prompt: ONE speaker talks a full beat (clean single voice), the other
    // present and reacting; two-shot; voice pinned consistent; NO on-screen text.
    // Pin the speaker's voice to the timbre the merchant cast (Veo has no voice
    // reference, so a concrete described timbre is the lever that holds it steady).
    const voiceDescFor = (name: string): string => {
      if (!name) return "";
      const key = fnm(name);
      const a = castActors.find((c) => fnm(c.name) === key);
      const v = a && a.voiceId ? AVATAR_VOICES.find((x) => x.id === a.voiceId) : undefined;
      return v ? ` ${name}'s voice is ${v.blurb.toLowerCase()} (a ${v.label.toLowerCase()} ${v.gender === "f" ? "female" : "male"} voice); keep this exact voice in every shot.` : "";
    };
    const speakerVoiceDesc = voiceDescFor(speaker);
    // Point Veo at the RIGHT face: in the two-shot both people are visible, so name the
    // speaker by their SIDE of the frame (detected above) — otherwise Veo animates the
    // wrong brother's mouth and the line comes out of the wrong person (owner's bug).
    const sSide = sideFor(speaker);
    const oSide = sSide === "left" ? "right" : sSide === "right" ? "left" : "";
    const sideB = turnB ? (sideFor(turnB.speaker) || oSide) : "";
    // HOW to say it — Veo reads flat unless told the emotion. Use the scripter's per-beat
    // tone if present, else infer from the words, and hard-ban mumbling + dead air.
    const tone = (scene.tone || "").trim();
    const deliver = tone
      ? `Deliver it ${tone} — put that exact emotion and energy into the voice, expressively, NEVER flat or monotone.`
      : `Deliver it with the REAL emotion the words carry — an angry line sounds angry, a threat sounds menacing, hurt shows as hurt — with natural intonation and emphasis, NEVER flat or monotone.`;
    const voiceLine = (turnB && turnB.speaker && turnB.line)
      ? `This two-shot is a short back-and-forth between TWO people, one speaking at a time. FIRST, ${turnA.speaker}${sSide ? ` (on the ${sSide} side of the frame)` : ""} says, in accurate lip-sync: "${turnA.line}". THEN ${turnB.speaker}${sideB ? ` (on the ${sideB} side)` : ""} replies, in accurate lip-sync: "${turnB.line}". ONLY ONE person speaks at a time: ${turnA.speaker} goes FIRST — only ${turnA.speaker}'s mouth moves while ${turnB.speaker} stays silent, listening and reacting — THEN ${turnB.speaker} answers — only ${turnB.speaker}'s mouth moves while ${turnA.speaker} stays silent, listening. There are exactly TWO distinct voices: ${turnA.speaker}'s voice on the first line and ${turnB.speaker}'s voice on the second — they NEVER talk at the same time, never overlap, and NO third voice, murmur or gibberish appears anywhere. Each person says their line exactly ONCE, word for word, clearly and articulately, beginning right away with no long pauses, so the two lines fill the whole shot back-to-back. ${deliver}${voiceDescFor(turnA.speaker)}${voiceDescFor(turnB.speaker)}`
      : speaker
      ? `${sSide ? `In this two-shot BOTH people are visible, but the ONLY one who speaks is the person on the ${sSide.toUpperCase()} side of the frame — that is ${speaker}. The person on the ${oSide.toUpperCase()} does NOT speak. ` : ""}There is ONLY ONE voice in this entire clip — ${speaker}'s. ${speaker}${sSide ? ` (on the ${sSide})` : ""} says exactly this one line and nothing else: "${line}". Say it through exactly ONCE, word for word — do NOT repeat, echo, loop or restate any word or phrase, and add no words that are not in the line. The MOMENT the line is finished, ${speaker} stops speaking and simply holds a natural, quiet expression for the rest of the shot — no extra, improvised or filler words. ${deliver} Speak CLEARLY and crisply — every word fully articulated and intelligible, no mumbling, slurring or trailing off — BEGIN speaking right away and keep a natural, connected pace, in accurate lip-sync. ONLY ${speaker}'s mouth moves. The OTHER character${oSide ? ` (on the ${oSide})` : ""} is COMPLETELY SILENT the whole time — absolutely no talking, murmuring, mumbling, whispering, muttering or background speech of any kind; their mouth stays closed and still, only listening and reacting. Do NOT generate any second voice, murmur or gibberish anywhere in the clip — one clear voice only. Keep ${speaker}'s voice the SAME as in every other shot.${speakerVoiceDesc}`
      : `Exactly ONE voice in the whole clip saying this line clearly and expressively (never monotone), every word articulate, no mumbling, beginning right away: "${line}". Say it through ONCE only — do NOT repeat, loop or restate any word, and add no words not in the line; the instant it is finished, stop speaking and hold a natural quiet expression for the rest of the shot. ${deliver} The other character is completely silent — mouth closed, only listening.`;
    // LIGHT PROMPT — the SEED frame already carries the faces, room and staging, so the
    // prompt only drives the TALKING and tells Veo to HOLD the frame. Re-describing the
    // scene + both characters in text (scene.visual / STAGING / castBible) made Veo redraw
    // the faces from the WORDS and drift them; stripping that lets the seed drive the look
    // ("use the seed like you're supposed to" — owner). voiceLine = the single-speaker line.
    void STAGING; void HOLD_STILL; // (kept defined for the seed/scene-frame paths; not in the clip prompt)
    const lookNote = cartoon
      ? `Keep EVERYONE and the entire setting EXACTLY as in the provided starting image — identical character designs, colors, outfits, lighting and background, unchanged throughout; keep each character's exact cartoon design fixed, and do NOT morph or redraw anyone into a different character. The camera holds steady and nobody moves except natural talking and small, subtle head and expression shifts. Do NOT introduce any object that is not already in the starting image.`
      : `Keep EVERYONE and the entire setting EXACTLY as in the provided starting image — identical faces, hair, skin tone, clothing, lighting and background, unchanged throughout; and keep each person's EXACT facial hair fixed the whole time — every beard, mustache and bit of stubble stays precisely the same and never fades, thins, grows, appears or disappears. Do NOT morph, age or redraw anyone into a different person. The camera holds steady and nobody moves except natural talking and small, subtle head and expression shifts. Do NOT introduce any object that is not already in the starting image — no new cigarette, glass or prop appears; and if a person IS already holding something, keep it EXACTLY the same size and shape, held steady in the same hand — it must never morph, grow, shrink, drift, multiply or flicker.`;
    const styleNote = sing
      ? (cartoon ? "Bright 3D-animated cartoon style (not live-action); clean, clear SUNG vocal audio with a catchy melody, lip-synced to the words." : "Photorealistic live-action; clean, clear SUNG vocal audio with a catchy melody, lip-synced to the words.")
      : (cartoon ? "Bright, glossy 3D-animated cartoon style (not live-action), clean clear spoken-dialogue audio." : "Photorealistic live-action, clean natural spoken-dialogue audio.");
    const prompt = `${voiceLine} ${lookNote} ${styleNote} ${NO_TEXT}`;

    // Size the clip to the SPOKEN LINE (word-metered) instead of a flat 10s. A clip that
    // outlasts its line is exactly what makes Kling pad the dead air — with silence (a
    // pause) or by looping words — so matching the length to the words starves both.
    const clipSecs = clipSecondsFor(line);
    const clipUrl = await dialogueClip(dialogueEngine, seedAbs, prompt, `testmovie-${i}`, clipSecs, aspect);
    const rawPath = path.join(RENDERS(), `tm-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp4`);
    await download(clipUrl, rawPath);
    if (!(fs.existsSync(rawPath) && ffprobeDuration(rawPath) > 1)) throw new Error(`[testmovie] scene ${i + 1}: clip did not download`);
    const trimmed = await trimTrailingSilence(rawPath); // cut dead air at the head/tail
    const outPath = await collapseInteriorPause(trimmed); // and collapse a long mid-line pause
    clips.push(outPath);
    shotSeeds.push(seedAbs); shotPrompts.push(prompt); shotDurs.push(clipSecs);
    // Advance the seamless chain: the trimmed clip's ACTUAL last frame seeds the next.
    prevFrameUrl = (await extractLastFrame(outPath)) || undefined;
    await ckpt({ ckClips: clips, ckLastStill: prevFrameUrl });
  }
  if (!clips.length) throw new Error("[testmovie] no clips rendered");

  // 4) ASSEMBLE — concat the clips keeping the dialogue audio.
  const outName = `tm-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp4`;
  const outPath = path.join(RENDERS(), outName);
  await assembleTestMovie(clips, outPath, jobId, softSeams, aspect);
  const outBuf = fs.readFileSync(outPath);
  try { await mirrorRender(outName, outBuf); } catch { /* non-fatal */ }
  const storedUrl = `/renders/${outName}`;

  const asset = await db.asset.create({
    data: {
      shopId: opts.shopId,
      type: "VIDEO_AD",
      status: "PENDING",
      title: `${tmpl.name} — ${(treatment.title || opts.topic || "dialogue scene").slice(0, 60)}`,
      bodyJson: JSON.stringify({ style: "TESTMOVIE", videoUrl: storedUrl, prompt: opts.topic || "", treatment }),
      metaJson: JSON.stringify({
        kind: "testmovie", template: tmpl.key, section: opts.section || "creator",
        scenes: clips.length, aspect, engine: dialogueEngine,
        // Per-shot timeline for the section editor: each rendered shot's /renders URL +
        // the line it speaks, so the editor can list, preview and (later) re-edit each one.
        shots: clips.map((c, i) => ({
          url: `/renders/${path.basename(c)}`,
          caption: (treatment.scenes[i]?.caption || "").slice(0, 200),
          // Regenerate inputs (section editor Phase 3): re-roll this one shot from its seed.
          seed: shotSeeds[i] || undefined,
          prompt: shotPrompts[i] || undefined,
          dur: shotDurs[i] || undefined,
        })),
      }),
    },
  });
  return asset.id;
}
