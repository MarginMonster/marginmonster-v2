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
//   4. STAGED, AND SOMETHING HAPPENS (2026-11-24 — acted-staging.ts). Each location's
//      master is drawn in a STAGING dealt for it (a natural distance, a medium shot with
//      the room around them — both faces still readable, still ONE picture per place),
//      and each clip is told how the two move in that staging and the one thing its
//      scene says is DONE while the line is spoken. ACTED_STAGING=off: as before.
//
// Sequential by necessity (each clip seeds from the last) — the price of flow.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db.server";
import { persistRemote, renderCreativeSeed, renderStyledSeed, renderStyledSeedMulti, renderSceneSeedChained, renderSideBySideTwoShot, repRun } from "./image-generation.server";
import { AVATAR_VOICES, isPersonalVoice } from "./avatar-voice-catalog";
import { characterVoice, isCharacterVoice } from "./character-voices";
import { chainClipVoice } from "./character-voice.server";
import { ensureVoiceModel, revoiceClip } from "./singing-voice.server";
import { checkpointJob, download, ffprobeDuration, repCreate, repPoll, runFfmpeg } from "./ugc-ad-pipeline.server";
import { joinWhole, pictureFrames, streamSeconds } from "./film-join.server";
import { falEnabled, falVideoPoll, falVideoSubmit } from "./fal-video.server";
import { clampKlingPrompt, clipRules, fitClipPrompt } from "./clip-prompt";
import { interiorCutFromWords, isNoopTrim, parseSilences, planClipTrim, planFromWords, planShift, SILENCE_FILTER, type TimedWord } from "./clip-trim";
import { createWhisperx, wordsFromWhisperx } from "./faceless-video.server";
import { letterboxCrop, parseCropdetect } from "./letterbox";
import { mirrorRender } from "./object-storage.server";
import { filmTemplate, previewFilmTreatment, type FilmTreatment } from "./film-engine.server";
import { castForMeta, episodeTitle, seriesMeta, type SeriesBrief } from "./film-series";
import { clipSecondsFor } from "./speech-meter";
import { captionStyleOf } from "./narrated-core";
import { MIXED_CAST_LOCK, nameTok } from "./character-prompts";
import { normalizeContentLang } from "./content-lang";
import { heroName } from "./film-heroes";
import { makeCastPoster } from "./story-poster.server";
import { castForWriter } from "./dialogue-cast";
import { trimTitle } from "./text-trim";
import { parseStoryCast, storyCastPrompt } from "./story-picture";
import { EVENT_MAX, EVENT_MAX_LAST, FILM_FPS, HEARD_NOT_DRAWN, NOBODY_SPEAKS, SILENT_SHOT_SECONDS, clipEvent, clipHearsFirst, clipMoves, clipSilent, dealStagings, faceNote, heardIn, heardSeconds, heardTalk, isActedStaging, joinCheck, kinLooks, revealPicture, sceneEvent, silentRules, stagedRules, twoOnScreen, wordless, type ActedStaging, type SeamKind } from "./acted-staging";

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
export function splitExchange(caption: string): Array<{ speaker: string; line: string }> {
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
// better than 15s. Replicate kwaivgi/kling-v3-omni (pro) → fal kling-video/v3/pro fallback.
const FAL_KLING3 = "fal-ai/kling-video/v3/pro/image-to-video";
const REP_KLING3 = "kwaivgi/kling-v3-omni-video";
const KLING_DUR = 10;
// The SAME Kling 3 Omni model on fal, where it is called "O3". Read off the providers' own pages
// 2026-11-18, per second of video with audio: Replicate pro $0.28 · fal O3 pro $0.14 · fal O3 standard
// (720p) $0.112. Replicate is 95% of what an acted film costs us, so the host is the biggest money lever
// in Movie Maker — and it is the owner's call by ear, not a silent swap (see filmKlingHost).
const FAL_KLING3_OMNI = "fal-ai/kling-video/o3/pro/image-to-video";
const FAL_KLING3_OMNI_STD = "fal-ai/kling-video/o3/standard/image-to-video";
/** Where a Kling 3 Omni dialogue shot is rendered. */
export type KlingHost = "replicate" | "fal" | "fal-std";
export const KLING_HOST_LABEL: Record<KlingHost, string> = {
  replicate: "Replicate · Kling 3 Omni pro ($0.28/s)",
  fal: "fal · Kling 3 Omni pro ($0.14/s)",
  "fal-std": "fal · Kling 3 Omni standard ($0.112/s)",
};
/** The host acted films render on: fal "standard" — the same Kling 3 Omni, 720p (films are cut at 720p
 *  anyway), $0.112/s, 60% under Replicate. The owner picked it by ear on 2026-11-19 from one shot rendered
 *  on all three hosts ("C sounded the best"), and a whole film re-made on it then spoke every scripted word
 *  with no extras, kept each voice where it belongs (girl 222–246 Hz, old man 111 Hz), levelled the same
 *  and cut a little smoother than Replicate's (SSIM 0.967 / 0.924 against 0.947 / 0.910).
 *  FILM_KLING_HOST=replicate (or fal, for fal's pro tier) moves every film back; whichever host leads, the
 *  others stay behind it as the fallback. */
/*  …and fal's PRO tier since 2026-11-25: the same Kling 3 Omni at 1080p for $0.14/s (standard is 720p) — the owner,
 *  of the films' "rough" look: "yes obviously upgrade the best image possible". FILM_KLING_HOST=fal-std moves every
 *  film back to the standard tier he picked by ear; standard is still the pro tier's first fallback. */
export function filmKlingHost(): KlingHost {
  const v = (process.env.FILM_KLING_HOST || "").trim().toLowerCase();
  return v === "replicate" ? "replicate" : v === "fal-std" ? "fal-std" : "fal";
}

/** A Kling 3 Omni dialogue clip (native lip-synced audio) — byte-for-byte the same role
 *  as veoDialogueClip, only the renderer differs. Returns the clip URL.
 *
 *  The host comes from filmKlingHost() (fal standard since the owner's pick). History: fal's Kling 3 Pro
 *  — a DIFFERENT model — was once listed first and refused every shot (the prompt was over its 2,500-
 *  character cap), so every approved film really came from Replicate's Kling 3 Omni; the same Omni model
 *  on fal ("O3") was then A/B'd by ear before it was allowed to lead. On Replicate `mode` stays pinned to
 *  the default the approved films used, so a provider-side default change can't alter the look. */
async function klingDialogueClip(seedAbs: string, rawPrompt: string, stage: string, durationSec = KLING_DUR, host: KlingHost = filmKlingHost()): Promise<string> {
  const dur = Math.max(5, Math.min(KLING_DUR, Math.round(durationSec) || KLING_DUR));
  const prompt = clampKlingPrompt(rawPrompt);
  const viaReplicate = async () => {
    const id = await repCreate(REP_KLING3, { prompt, start_image: seedAbs, generate_audio: true, duration: dur, mode: "pro" });
    return await repPoll(id, VEO_POLL_MS, stage);
  };
  const viaFal = async (model: string) => {
    const rid = await falVideoSubmit(model, { startImage: seedAbs, prompt, generateAudio: true, durationSec: dur });
    return await falVideoPoll(model, rid, VEO_POLL_MS);
  };
  // The picked host first; then the SAME model elsewhere, cheapest first; fal's Kling 3 Pro (a different
  // model) only as the last resort, as before. A refused or failed render is not billed, so a fallback
  // never pays twice for one shot.
  const order: Array<{ name: string; fal: boolean; run: () => Promise<string> }> = host === "replicate"
    ? [
        { name: "replicate kling 3 omni", fal: false, run: viaReplicate },
        { name: "fal kling 3 omni", fal: true, run: () => viaFal(FAL_KLING3_OMNI) },
        { name: "fal kling 3 pro", fal: true, run: () => viaFal(FAL_KLING3) },
      ]
    : host === "fal-std"
    ? [
        { name: "fal kling 3 omni standard", fal: true, run: () => viaFal(FAL_KLING3_OMNI_STD) },
        // the same model's pro tier on fal is still half of Replicate's price
        { name: "fal kling 3 omni", fal: true, run: () => viaFal(FAL_KLING3_OMNI) },
        { name: "replicate kling 3 omni", fal: false, run: viaReplicate },
        { name: "fal kling 3 pro", fal: true, run: () => viaFal(FAL_KLING3) },
      ]
    : [
        { name: "fal kling 3 omni", fal: true, run: () => viaFal(FAL_KLING3_OMNI) },
        // (the same model's standard tier on fal next — 720p, but the same film, and the cheapest)
        { name: "fal kling 3 omni standard", fal: true, run: () => viaFal(FAL_KLING3_OMNI_STD) },
        { name: "replicate kling 3 omni", fal: false, run: viaReplicate },
        { name: "fal kling 3 pro", fal: true, run: () => viaFal(FAL_KLING3) },
      ];
  let lastErr: unknown = new Error("[testmovie] no Kling host is configured");
  for (const step of order) {
    if (step.fal && !falEnabled()) continue;
    try { return await step.run(); }
    catch (e) {
      lastErr = e;
      console.error(`[testmovie] ${step.name} failed (${stage}): ${e instanceof Error ? e.message.slice(0, 360) : e}`);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Route a dialogue clip to the chosen engine — the ONE line that differs between the
 *  identical Veo and Kling pipelines. */
async function dialogueClip(engine: string, seedAbs: string, prompt: string, stage: string, durationSec?: number, aspect?: "9:16" | "16:9" | "1:1", host?: KlingHost): Promise<string> {
  // Only Kling takes a per-clip length; Veo keeps its native clip. Kling inherits the seed's
  // aspect (the seed is rendered at the chosen ratio); Veo-Replicate takes it explicitly.
  // RETRY the whole render a few times: each clip already falls back fal→Replicate, but when
  // BOTH hiccup on the same beat (a transient provider blip) the clip throws — and that single
  // failure used to nuke a multi-minute film that had already rendered every other beat. A
  // couple of fresh attempts clears a transient blip; a truly broken beat still surfaces.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return engine === "kling3"
        ? await klingDialogueClip(seedAbs, prompt, stage, durationSec, host)
        : await veoDialogueClip(seedAbs, prompt, stage, aspect);
    } catch (e) {
      lastErr = e;
      console.error(`[testmovie] clip ${stage} attempt ${attempt + 1}/3 failed: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`[testmovie] clip ${stage} failed after retries`);
}

/** Render ONE dialogue clip end-to-end (render + download + head/tail + interior-pause trims)
 *  → a local file path. The render loop does this inline; the SECTION EDITOR's regenerate
 *  reuses it to re-roll a single shot from its stored seed + prompt. `last` = the film's final
 *  shot, which keeps a beat of quiet after its line exactly as in the first render.
 *  WHAT KIND OF SHOT IT WAS is read off the prompt it was made from (acted-staging.ts), so a re-rolled
 *  shot is trimmed exactly as its first take was: one nobody speaks in is kept whole (clipSilent), one that
 *  opens on a sound keeps its head (clipHearsFirst), one in which something is done keeps its pause
 *  (clipMoves). Its length is the stored one (`durSec`): a wordless shot's SILENT_SHOT_SECONDS, a sound
 *  shot's heardSeconds — never re-measured from a line it does not have. */
export async function renderDialogueClipTo(engine: "veo" | "kling3", seedAbs: string, prompt: string, durSec: number, aspect: "9:16" | "16:9" | "1:1", stage: string, chained = false, host?: KlingHost, opts: { last?: boolean } = {}): Promise<string> {
  const clipUrl = await dialogueClip(engine, seedAbs, prompt, stage, durSec, aspect, host);
  const rawPath = path.join(RENDERS(), `tm-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp4`);
  await download(clipUrl, rawPath);
  if (!(fs.existsSync(rawPath) && ffprobeDuration(rawPath) > 1)) throw new Error("[regen] clip did not download");
  return trimClip(rawPath, { chained, last: !!opts.last, moves: clipMoves(prompt), silent: clipSilent(prompt), keepHead: clipHearsFirst(prompt) });
}

/** What a rendered take SAYS, word by word with times — heard by whisperx (it hears the language too), so
 *  the trims below cut on the line itself rather than guessing from silence. Null when it can't be heard
 *  in time (the trims then fall back to silence, exactly as before); a third of a cent a take. */
async function heardWords(clipPath: string): Promise<TimedWord[] | null> {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  if (!base || !process.env.REPLICATE_API_TOKEN) return null;
  try {
    const words = wordsFromWhisperx(await repPoll(await createWhisperx(`${base}/renders/${path.basename(clipPath)}`, null), 45_000, "clip-words"));
    return words.length >= 2 ? words : null;
  } catch (e) {
    console.error(`[testmovie] words not heard — trimming on silence: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
    return null;
  }
}

/** A raw take → the clip that goes in the film: dead air off both ends, then the one long mid-line pause
 *  taken down to a beat — both decided on the heard words where they come back. */
async function trimClip(rawPath: string, opts: { chained: boolean; last: boolean; /** something is DONE in this shot (acted-staging.ts → clipMoves) */ moves?: boolean; /** nobody speaks in this shot (acted-staging.ts → clipSilent) */ silent?: boolean; /** the shot OPENS ON A SOUND (acted-staging.ts → clipHearsFirst) */ keepHead?: boolean }): Promise<string> {
  // A SHOT NOBODY SPEAKS IN IS KEPT WHOLE. Every trim below looks for where the SPEECH starts and stops: the
  // listen (there are no words to hear), the lead-in before "the first word" (cut, or played fast), the tail
  // after "the last word", the hold after a last line, the pause in the middle of a line. With no line, the
  // first sound in the take would pass for its first word — and the quiet before the thing moves, which is
  // the shot, would be cut away.
  if (opts.silent) return rawPath;
  const words = await heardWords(rawPath);
  // (a shot that OPENS ON A SOUND keeps everything before its first word: that is where the sound is. Cut,
  //  the knock is gone; played fast, three slow knocks become three quick ones — the owner's "knocking fast")
  const t = await trimTrailingSilence(rawPath, { ...opts, words });
  // A shot in which something HAPPENS keeps its mid-line pause. Taking a pause out of the middle of a take
  // cannot be seen while two people stand still — which is what every shot was when that cut was written;
  // with a door being pulled open, or the two of them walking, it would make them jump.
  if (opts.moves) return t.path;
  const moved = words ? words.map((w) => ({ start: w.start - t.shift, end: w.end - t.shift })).filter((w) => w.end > 0) : null;
  return collapseInteriorPause(t.path, moved);
}

/** An image model asked for a "cinematic" frame sometimes returns it with black bars baked in, and a
 *  film seeded from that frame carries the bars through every shot. If `relUrl` (a /renders still) is
 *  letterboxed, crop to the picture and scale back to the frame's own size — a slight zoom, no bars.
 *  Returns the same URL when there is nothing to fix or anything goes wrong. */
async function removeLetterbox(relUrl: string | null): Promise<string | null> {
  if (!relUrl) return relUrl;
  try {
    const local = relUrl.startsWith("/renders/") ? path.join(RENDERS(), path.basename(relUrl)) : "";
    if (!local || !fs.existsSync(local)) return relUrl;
    const probe = await runFfmpeg(["-loop", "1", "-i", local, "-frames:v", "3", "-vf", "cropdetect=limit=24:round=2:reset=0", "-f", "null", "-"]);
    const found = parseCropdetect(probe.stderr || "");
    const crop = found ? letterboxCrop(found.frame, found.crop) : null;
    if (!found || !crop) return relUrl;
    const { w: W, h: H } = found.frame;
    const name = `img-${Date.now()}-${crypto.randomBytes(9).toString("hex")}.jpg`;
    const out = path.join(RENDERS(), name);
    const vf = `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;
    const r = await runFfmpeg(["-y", "-i", local, "-vf", vf, "-frames:v", "1", "-q:v", "2", out]);
    if (r.status !== 0 || !fs.existsSync(out) || fs.statSync(out).size < 5_000) return relUrl;
    try { await mirrorRender(name, fs.readFileSync(out)); } catch { /* non-fatal */ }
    console.log(`[testmovie] seed frame came back with black bars (${found.frame.h - crop.h}px top+bottom, ${found.frame.w - crop.w}px sides) — cropped out`);
    return `/renders/${name}`;
  } catch { return relUrl; }
}

/** Grab the ACTUAL last frame of a rendered clip as a clean still (served from
 *  /renders). Used as the continuity REFERENCE for the next scene's seed — so the
 *  room and everyone's FINAL positions carry forward (the owner's "reuse the last
 *  frame" idea) — without feeding the blurry frame straight into Veo (which, on a
 *  speaker switch, made the audio gibberish). Returns a relative /renders URL. */
export async function extractLastFrame(videoPath: string): Promise<string | null> {
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

/** Take the dead air off a rendered clip: the pause before the line starts and the hold after it
 *  ends (see clip-trim.ts for the rules and why). `chained` = this clip was seeded from the previous
 *  clip's last frame — its first frames are what makes that cut invisible, so its lead-in is played
 *  FAST rather than cut off; a clip that opens on a new picture just has the lead-in cut. `last` = the
 *  film's final shot: it keeps a full beat after its line, holding its last frame if the take ran out
 *  first. `keepHead` = the shot OPENS ON A SOUND (acted-staging.ts → clipHearsFirst): everything before its
 *  first word is kept, at its own speed — only the dead tail goes. Re-encodes for frame-accurate edits.
 *  Returns a NEW path, or the original if nothing changes. */
async function trimTrailingSilence(inPath: string, opts: { chained?: boolean; last?: boolean; words?: TimedWord[] | null; keepHead?: boolean } = {}): Promise<{ path: string; shift: number }> {
  const ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"];
  const usable = (p: string) => { try { return fs.existsSync(p) && ffprobeDuration(p) > 0.8; } catch { return false; } };
  let result = inPath;
  let holdEnd = 0;
  // how far the line moved earlier in the clip (the cut head, or what the sped-up lead-in saved)
  let shift = 0;
  try {
    const dur = ffprobeDuration(inPath);
    if (!(dur > 2)) return { path: inPath, shift: 0 };
    const probe = await runFfmpeg(["-i", inPath, "-af", SILENCE_FILTER, "-f", "null", "-"]);
    const err = probe.stderr || "";
    const measured = parseSilences(err);
    const how = { chained: !!opts.chained, last: !!opts.last };
    // the heard words decide where the line is, when the measured quiet backs them up; else silence alone
    const planned = (opts.words && planFromWords(opts.words, measured, dur, how)) || planClipTrim(measured, dur, how);
    // (a shot that opens on a sound: nothing before the line is cut or sped up — the sound is there)
    const plan = opts.keepHead ? { ...planned, cutHead: 0, retime: null } : planned;
    holdEnd = plan.holdEnd;
    if (isNoopTrim(plan, dur)) return { path: inPath, shift: 0 };
    const out = inPath.replace(/\.mp4$/i, "-trim.mp4");
    let done = false;
    if (plan.retime) {
      // keep the opening frames, play the rest of the lead-in fast, then the line at normal speed
      const { hold, leadEnd, speed } = plan.retime;
      const fps = Number((err.match(/,\s*(\d+(?:\.\d+)?)\s*fps/) || [])[1]) || 24;
      const tempo = speed > 2 ? `atempo=2.0,atempo=${(speed / 2).toFixed(3)}` : `atempo=${speed.toFixed(3)}`;
      const a = hold.toFixed(3), b = leadEnd.toFixed(3), e = plan.endAt.toFixed(3);
      const fc = [
        `[0:v]trim=0:${a},setpts=PTS-STARTPTS[v0]`,
        `[0:v]trim=${a}:${b},setpts=(PTS-STARTPTS)/${speed.toFixed(3)}[v1]`,
        `[0:v]trim=${b}:${e},setpts=PTS-STARTPTS[v2]`,
        `[0:a]atrim=0:${a},asetpts=PTS-STARTPTS[a0]`,
        `[0:a]atrim=${a}:${b},asetpts=PTS-STARTPTS,${tempo}[a1]`,
        `[0:a]atrim=${b}:${e},asetpts=PTS-STARTPTS[a2]`,
        `[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[vc][a]`,
        `[vc]fps=${fps}[v]`,
      ].join(";");
      const r = await runFfmpeg(["-y", "-i", inPath, "-filter_complex", fc, "-map", "[v]", "-map", "[a]", ...ENC, out]);
      done = r.status === 0 && usable(out);
      if (done) shift = planShift(plan);
      // couldn't re-time it: still never cut the head of a continuing clip — fall through to the tail only
    }
    const startAt = plan.cutHead;
    if (!done && (startAt > 0.15 || plan.endAt < dur - 0.2)) {
      const args = ["-y", "-i", inPath];
      if (startAt > 0.15) args.push("-ss", startAt.toFixed(2));
      args.push("-t", Math.max(0.8, plan.endAt - startAt).toFixed(2), ...ENC, out);
      const r = await runFfmpeg(args);
      done = r.status === 0 && usable(out);
      if (done) shift = startAt > 0.15 ? startAt : 0;
    }
    if (done) result = out;
  } catch { /* keep the original clip */ }
  // The film's last shot: hold its final frame so the film doesn't stop on the last syllable. (A player
  // freezes on the last frame anyway — what this buys is the beat of quiet after the line.)
  if (holdEnd > 0.15) {
    try {
      const d = ffprobeDuration(result);
      const held = result.replace(/\.mp4$/i, "-hold.mp4");
      const h = holdEnd.toFixed(2);
      const fc = `[0:v]tpad=stop_mode=clone:stop_duration=${h}[v];[0:a]afade=t=out:st=${Math.max(0, d - 0.12).toFixed(2)}:d=0.12,apad=pad_dur=${h}[a]`;
      const r = await runFfmpeg(["-y", "-i", result, "-filter_complex", fc, "-map", "[v]", "-map", "[a]", ...ENC, held]);
      if (r.status === 0 && usable(held) && ffprobeDuration(held) > d + 0.1) result = held;
    } catch { /* the film just ends where the take does */ }
  }
  return { path: result, shift };
}

/** Collapse ONE long pause in the MIDDLE of a clip (dead air between words where the
 *  speaker just stands there) — the head/tail trim above never touches interior gaps, which
 *  is what reads as "a somewhat long awkward pause". Detects the longest fully-interior
 *  silence with silencedetect and excises most of it (keeping a short natural beat), cutting
 *  BOTH video and audio at the same points so lip-sync holds. The clip's LAST frame is
 *  unchanged (the span removed is in the middle), so the seamless chain is unaffected.
 *  Conservative on purpose: one clearly-long (>1s) interior pause per clip, and only if the
 *  result stays valid. Returns a NEW path, or the original if there's nothing to do.
 *  `words` = the line's heard words on THIS clip's timeline: the pause is then the longest gap between
 *  two words (a breath or a click inside it no longer splits it into two "short" pauses). */
async function collapseInteriorPause(inPath: string, words?: TimedWord[] | null): Promise<string> {
  try {
    const dur = ffprobeDuration(inPath);
    if (!(dur > 3)) return inPath; // too short for a mid-clip pause to matter
    let cut = words && words.length >= 2
      ? interiorCutFromWords(words, parseSilences((await runFfmpeg(["-i", inPath, "-af", SILENCE_FILTER, "-f", "null", "-"])).stderr || ""), dur)
      : null;
    if (!cut) {
      const probe = await runFfmpeg(["-i", inPath, "-af", "silencedetect=noise=-33dB:d=0.7", "-f", "null", "-"]);
      const err = probe.stderr || "";
      // silencedetect prints "silence_end: <end> | silence_duration: <len>" for each COMPLETE
      // silence run; start = end - len. (A run with no end ran to EOF = trailing — not here.)
      const runs = [...err.matchAll(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g)]
        .map((m) => { const end = parseFloat(m[1]); const len = parseFloat(m[2]); return { start: end - len, end, len }; })
        // interior only: clear of the head and tail (those are trimTrailingSilence's job)
        .filter((r) => r.len > 1.0 && r.start > 0.8 && r.end < dur - 0.8)
        .sort((a, b) => b.len - a.len);
      if (runs.length) cut = { keep1: +(runs[0].start + 0.22).toFixed(2), start2: +runs[0].end.toFixed(2) }; // a short natural beat of the pause stays
    }
    if (!cut) return inPath;
    const { keep1, start2 } = cut;
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

/** Join the shots into the film, KEEPING their dialogue audio (unlike the main engine, which strips clip audio
 *  for a narrator/music bed) — acted-staging.ts → THE JOIN, which says how and why; film-join.server.ts runs it.
 *  Every clip is made exactly as long as its PICTURE (pictureFrames), its sound cut or padded to match, a clip with no sound given silence; the
 *  shots are joined with dissolves of whole frames, and a STRAIGHT CUT (`hardSeams`: a cut to ANOTHER PLACE, and
 *  a horror film's last shot drawn into its place's own picture — the owner's knocking film reached it through a
 *  half-second double exposure of two rooms) is a join; a REFRAME (`softSeams`: a new angle in the same place)
 *  dissolves longer than a shot that continues the last. THE FINISHED FILE IS MEASURED (joinCheck): its picture
 *  and its sound the same length, and the length the shots add up to. Not whole → joined again the plain way
 *  (every seam a straight join); still not → it THROWS: the job fails, and a film whose picture ends before its
 *  sound — knock4, the reveal gone, 5 s of its sound over the last frame of the shot before — is never shipped.
 *  Returns the film's length in frames. */
export async function assembleTestMovie(clips: string[], outPath: string, jobId?: string, softSeams?: Set<number>, aspect: "9:16" | "16:9" | "1:1" = "9:16", hardSeams?: Set<number>): Promise<number> {
  const N = clips.length;
  if (!N) throw new Error("[testmovie] no clips");
  const beat = async () => { if (jobId) await checkpointJob(jobId, { ckBeat: Date.now() }); };
  // Trim the bottom ~10% before scaling — a safety net against Veo's stochastic
  // hallucinated subtitles/captions, which sit along the bottom edge (the prompt ban
  // reduces but doesn't fully stop them). Heads stay (crop is anchored at the top);
  // only lower-chest/background is lost, which also tightens the faces slightly.
  // (FULL HD, and a finer encode: 720p at veryfast/CRF 21 until the owner, 2026-11-25, of the night-time films'
  //  "rough" look: "yes obviously upgrade the best image possible" — the clips themselves are 1080p now, fal's pro tier)
  const [W, H] = aspect === "16:9" ? [1920, 1080] : aspect === "1:1" ? [1080, 1080] : [1080, 1920];
  const SCALE = `crop=iw:ih*0.90:0:0,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30`;
  const ENCODE = ["-threads", "2", "-filter_complex_threads", "2", "-c:v", "libx264", "-preset", "fast", "-tune", "film", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"];

  // each shot as long as its PICTURE (its sound cut or padded to it); how each is joined to the one before: a shot
  // that continues the last (seeded from its real last frame) dissolves in 5 frames — near-identical frames, so it
  // is all but invisible; a new angle in the same place in 10; another place, or the reveal, is a straight cut
  // (2026-11-24: a dissolve between two rooms read as a ghost)
  const seams: SeamKind[] = clips.map((_, i) => (hardSeams?.has(i) ? "hard" : softSeams?.has(i) ? "reframe" : "soft"));
  await beat();
  return joinWhole({ clips, outPath, prep: SCALE, seams, length: "picture", encode: ENCODE, label: "[testmovie]", beat });
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
export async function renderSceneFrame(opts: { sceneVisual: string; sceneHint: string; castText?: string; styleRefUrl?: string | null; castRefUrls?: (string | null | undefined)[]; roomRefUrl?: string | null; aspect?: "9:16" | "16:9" | "1:1"; /** the cast pictures include a cartoon character or a monster: lock them as what they are, not as people */ creatureCast?: boolean }): Promise<string | null> {
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
      const multi = await renderStyledSeedMulti(framed, castRefs, ar, opts.creatureCast ? MIXED_CAST_LOCK : undefined);
      if (multi) return multi;
    }
    return opts.styleRefUrl
      ? ((await renderStyledSeed(framed, opts.styleRefUrl, ar)) || (await renderCreativeSeed(framed, ar)))
      : await renderCreativeSeed(framed, ar);
  } catch { return null; }
}

/** Template-resolving wrapper for the web action (which has the template key, not
 *  the sceneHint). */
export async function previewFilmSceneFrame(opts: { template?: string; sceneVisual: string; castText?: string; styleRefUrl?: string | null; castRefUrls?: (string | null | undefined)[]; creatureCast?: boolean }): Promise<string | null> {
  const tmpl = filmTemplate(opts.template);
  // In the storyboard, styleRefUrl IS the previous shot's frame — use it as the ROOM
  // anchor so each new shot is "same room, new angle, same characters" (owner's fix for
  // clips that cut between unrelated sets). renderSceneFrame only chains when BOTH a
  // room ref and cast faces are present; otherwise it falls back to the old behaviour.
  return renderSceneFrame({ sceneVisual: opts.sceneVisual, sceneHint: tmpl.sceneHint, castText: opts.castText, styleRefUrl: opts.styleRefUrl, roomRefUrl: opts.styleRefUrl, castRefUrls: opts.castRefUrls, creatureCast: opts.creatureCast });
}

/** Cast an actor: a clean, reusable casting PORTRAIT of one character, locked once
 *  and reused as the face reference for every shot they appear in. This is the
 *  "cast member" primitive — the same move as a Runway Reference / Kling Element. */
export async function renderActorPortrait(description: string, style?: "cartoon" | "realistic"): Promise<string | null> {
  const desc = (description || "").trim().slice(0, 400);
  // Cartoon templates (Kids Cartoon / Kids TV) cast CARTOON characters, not realistic people — so the
  // portrait is rendered in the same bright glossy 3D-animated style the scenes use.
  const prompt = style === "cartoon"
    ? `A bright, glossy 3D-animated CARTOON character portrait of ${desc}. Rounded friendly character design, big expressive eyes, soft candy colors, wholesome child-safe (G-rated) preschool-cartoon look; ONE character only, centered, simple plain background, no readable text.`
    : `A clean, photorealistic 3/4 casting-portrait headshot of ${desc}. One person only, natural soft studio lighting, plain neutral background, sharp focus on the face, looking just off camera, cinematic, photoreal. No readable text.`;
  return renderCreativeSeed(prompt, "9:16");
}

/** The cast members whose name appears in a scene (speaker always counts). Used to
 *  condition each shot's seed frame on the right locked faces. */
function actorsInScene(cast: Array<{ name: string; faceUrl?: string | null; voiceId?: string | null }>, scene: { visual?: string; caption?: string }): Array<{ name: string; faceUrl?: string | null; voiceId?: string | null }> {
  const hay = `${scene.visual || ""} ${scene.caption || ""}`.toLowerCase();
  return cast.filter((c) => { const key = nameTok(c.name); return key && hay.includes(key); });
}

export async function generateTestMovie(opts: {
  shopId: string;
  template?: string;
  topic?: string;
  treatment?: FilmTreatment;
  sceneCount?: number;
  section?: string;
  jobId?: string;
  resume?: { ckTreatment?: string; ckCastRef?: string; ckClips?: string[]; ckLastStill?: string; ckPanels?: string; ckSideShot?: string; ckMasters?: string; ckCastLooks?: string };
  /** Per-scene APPROVED storyboard frames (relative /renders URLs), index-aligned
   *  with the treatment's scenes. A present entry overrides the auto-seed/chain for
   *  that scene so it lands exactly as the merchant staged it. */
  approvedFrames?: (string | null)[];
  /** Cast the merchant locked in the UI: each character's name + face reference +
   *  pinned voice id. Every shot's auto-seed is composed from the faces of the cast
   *  present in it (locked identity), and the speaker's voice timbre is pinned into
   *  the Veo prompt so the voice stays consistent across shots. */
  cast?: Array<{ name: string; faceUrl?: string | null; voiceId?: string | null; kind?: "person" | "cartoon" | "monster"; look?: string }>;
  /** Which renderer runs the dialogue clips — the ONE thing that differs between the
   *  otherwise-identical engine pipelines. "kling3" (default, cheaper) or "veo" (premium,
   *  native audio). Recorded on the asset so the Archive shows which model made the film. */
  dialogueEngine?: "veo" | "kling3";
  /** Output aspect ratio: "9:16" vertical (Shorts/TikTok, default), "16:9" landscape
   *  (YouTube/TV/film — horizontal room for groups + cinematic blocking), or "1:1". */
  aspect?: "9:16" | "16:9" | "1:1";
  /** LOCK THE CAST'S VOICES (opt-in beta): every character speaks in EXACTLY the voice the merchant gave
   *  them, in every shot. The video model acts each line in a voice of its own (the cast voice was only a
   *  text hint, and it drifted shot to shot); with this on, each one-speaker clip is re-voiced with that
   *  character's trained voice model — same performance, same lip-sync, their voice. A character on the
   *  merchant's OWN cloned voice is re-voiced regardless of this flag (that is why they picked it). */
  lockVoices?: boolean;
  /** CAPTIONS: put the spoken lines on screen ("bold" big words in time, or "subtitles" along the
   *  bottom) — exactly as written, timed to each voice. Unset / "off" = none. */
  captions?: string;
  /** NEXT EPISODE (film-series.ts): the series this film continues — told to the writer when the script
   *  is written here, and stored on the asset as meta.series. */
  series?: SeriesBrief | null;
}): Promise<string> {
  const tmpl = filmTemplate(opts.template); // "testmovie"
  // Style/mode switches so the ONE dialogue pipeline serves photoreal talking films
  // (Short Film / Moral / Horror), cartoon talking films (Kids Cartoon) and
  // sung films (Music Video, Kids Music Video). Everything else is identical.
  const cartoon = !!tmpl.cartoon;
  const sing = !!tmpl.sing;
  const twoStyle: "photoreal" | "cartoon" = cartoon ? "cartoon" : "photoreal";
  // Output aspect: 9:16 vertical (default, validated), 16:9 landscape (YouTube/TV/film —
  // room for groups + cinematic blocking), or 1:1. Threaded to EVERY seed render + the
  // clip render + the assembly crop so the whole film is natively that shape (not cropped).
  const aspect: "9:16" | "16:9" | "1:1" = opts.aspect === "16:9" || opts.aspect === "1:1" ? opts.aspect : "9:16";
  const [AW, AH] = aspect === "16:9" ? [1920, 1080] : aspect === "1:1" ? [1080, 1080] : [1080, 1920];
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
  // (written here = made in one press: the writer is told who the maker CAST, so the script is for them —
  //  untold, it invented two people of its own and the picked cast matched nobody: dialogue-cast.ts)
  else treatment = await previewFilmTreatment({ shopId: opts.shopId, template: tmpl.key, topic: opts.topic, sceneCount: opts.sceneCount, ...(castForWriter(opts.cast).length ? { cast: castForWriter(opts.cast) } : {}), series: opts.series });
  // an episode is called "<Series> — Episode <N>", however its script was written (film-series.ts)
  if (opts.series) treatment.title = episodeTitle(opts.series.title, opts.series.episode, treatment.title);
  const want = Math.max(tmpl.minScenes, Math.min(tmpl.maxScenes, opts.sceneCount ?? treatment.scenes.length));
  treatment.scenes = treatment.scenes.slice(0, want);
  await ckpt({ ckTreatment: JSON.stringify(treatment) });

  // Locked cast (faces + voices) the merchant cast in the UI — drives per-shot
  // identity conditioning and the Veo voice pin.
  const castActors = (opts.cast || []).filter((c) => c && c.name && c.name.trim());
  // The script writer invents a look for every name without seeing who the merchant cast. For a
  // character who HAS a cast photo that written look is wrong by construction, so it is kept out of
  // every prompt: the photo is the look. What the photo actually shows is READ once per film, in words
  // ("a girl of about ten with shoulder-length wavy dark-blonde hair, a grey shirt over a blue tee"),
  // so that everything that works from a description — who is standing on which side, is the cast in
  // the frame at all — works from a TRUE one.
  const nameKey = nameTok;
  /** A cast member who is not a person — a cartoon character or a monster. */
  const isCreature = (c: { kind?: string } | undefined | null): boolean => !!c && (c.kind === "cartoon" || c.kind === "monster");
  const creatureNamed = (n: string): boolean => isCreature(castActors.find((c) => !!c.faceUrl && nameTok(c.name) === nameTok(n)));
  const castHasCreature = castActors.some((c) => !!c.faceUrl && isCreature(c));
  const castLooks: Record<string, string> = {};
  try { const r = resume.ckCastLooks ? JSON.parse(resume.ckCastLooks) : null; if (r && typeof r === "object") Object.assign(castLooks, r); } catch { /* ignore */ }
  await Promise.all(castActors.filter((c) => !!c.faceUrl).map(async (c) => {
    const k = nameKey(c.name);
    const faceAbs = abs(c.faceUrl);
    if (!k || !faceAbs || castLooks[k]) return;
    // a cartoon character or a monster: what it was DESIGNED as is its look (no reading needed)
    if (isCreature(c) && (c.look || "").trim().length > 12) { castLooks[k] = (c.look || "").replace(/\s+/g, " ").trim().slice(0, 220); return; }
    try {
      const { anthropicVision } = await import("./anthropic.server");
      const v = await anthropicVision(
        isCreature(c)
          ? "Describe this character's visible look in ONE short phrase for a film's casting sheet: what kind of creature or cartoon character it is, its fur or skin and colours, its eyes, anything it wears. Begin with 'a' or 'an'. No name, nothing about the picture itself. Example: a huge upright werewolf with shaggy dark-grey fur, glowing yellow eyes and bared fangs, in the torn remains of a red plaid shirt"
          : "Describe this person's visible look in ONE short phrase for a film's casting sheet: apparent age range, hair colour, hair length and style, any facial hair or glasses, and what they are wearing. Begin with 'a' or 'an'. No name, no guess at who they are, nothing about the photo itself. Example: a man in his forties with short grey hair and a trimmed beard, wearing a navy blazer over a white shirt",
        [faceAbs], { maxTokens: 90 }
      );
      const look = (v || "").replace(/\s+/g, " ").replace(/^["'\s]+|["'.\s]+$/g, "").slice(0, 220);
      if (look.length > 12) castLooks[k] = look;
    } catch (e) {
      console.error(`[testmovie] couldn't read ${c.name}'s cast photo — their side is assumed, not checked: ${e instanceof Error ? e.message.slice(0, 140) : e}`);
    }
  }));
  if (Object.keys(castLooks).length) {
    await ckpt({ ckCastLooks: JSON.stringify(castLooks) });
    console.log(`[testmovie] cast looks — ${Object.entries(castLooks).map(([k, v]) => `${k}: ${v}`).join(" | ").slice(0, 400)}`);
  }
  const actorOfEntry = (entry: string) => {
    const head = ((entry || "").split(/[,:—–]/)[0] || "").toLowerCase().split(/\s+/).filter(Boolean);
    return castActors.find((c) => !!c.faceUrl && head.includes(nameKey(c.name)));
  };
  // RELATED PEOPLE LOOK IT (acted-staging.ts → kinLooks). The third live film of the sisters' idea drew them
  // fifteen to twenty years apart — about forty with dark hair, about sixty with grey hair in a bun — each one
  // drawn from her own words alone. So when the writer invented both of the two, and the idea, the cast or the
  // lines make them related, every picture is told whose sister (brother, mother…) each one is and her age as a
  // number — sisters, brothers, twins and cousins the SAME age — with no grey hair on a sister under sixty, and
  // the picture of the two of them says it in so many words (kinNote). Only the pictures: the cast stays as
  // written. Anybody with a cast photo is drawn from the photo, and then nothing here is changed.
  const kin = (treatment.cast || []).some((e) => !!actorOfEntry(e)) ? null : kinLooks({ idea: opts.topic, cast: treatment.cast, lines: treatment.scenes.map((s) => s.caption || "") });
  if (kin) console.log(`[testmovie] the two are ${kin.relation}: drawn as "${kin.entries.join('" and "')}"`);
  const pictureEntry = (entry: string): string => { const k = kin && entry ? (treatment.cast || []).indexOf(entry) : -1; return kin && k >= 0 && k < 2 ? kin.entries[k] : entry; };
  const castNote = (entry: string) => { const a = actorOfEntry(entry); return a ? `${a.name.trim()}, ${castLooks[nameKey(a.name)] || "exactly as in their reference photo"}` : pictureEntry(entry); };
  const castBible = treatment.cast && treatment.cast.length ? `The recurring cast (keep them identical in every shot): ${treatment.cast.map(castNote).join("; ")}.${kin?.note ? ` ${kin.note}` : ""}` : "";

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
  //     (2026-11-24: HOW the two are placed in a master — how far apart, where the camera
  //     is — is its location's STAGING, dealt below: acted-staging.ts. One master per
  //     location is still the seed of every clip there, and both faces are still in it.)
  const firstName = nameTok;
  // WHO SPEAKS (acted-staging.ts → twoOnScreen). A SHOT NOBODY SPEAKS IN — a horror film's last shot has no
  // line; a maker can empty one in the storyboard — names nobody (null), so it does not change who the two
  // are: a film whose only wordless shot is the last is the two-hander it would be without it. And when the
  // other one's only shot IS the silent one (a two-shot horror film: a line, then the scare), the second
  // person is the other name on the cast list, when that list is exactly two. A film with no wordless shot
  // is read exactly as it always was.
  const leads = treatment.scenes.map((s) => (wordless(s.caption) ? null : splitExchange(s.caption || "").find((t) => t.speaker)?.speaker || ""));
  const allSpeakers = twoOnScreen(leads, treatment.cast, castActors.map((c) => c.name));
  const isTwoHander = allSpeakers.length === 2;
  const [spkA, spkB] = allSpeakers;
  // A character's look in words: the TRUE one read off their cast photo when they have one, else the
  // script writer's. (The writer's look for a cast presenter is an invention and matches nobody.)
  const bibleFor = (n: string) => {
    const actor = castActors.find((c) => !!c.faceUrl && firstName(c.name) === firstName(n));
    if (actor) return `${actor.name.trim()}, ${castLooks[firstName(actor.name)] || (isCreature(actor) ? "the character in their reference picture" : "the person in their reference photo")}`;
    return pictureEntry((treatment.cast || []).find((c) => firstName(n) && c.toLowerCase().includes(firstName(n))) || "") || `${n}, a person`;
  };
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
  /** Is a cast member who looks like `look` (read off their photo) one of the two people in the
   *  two-shot? Judged on what a viewer would notice — hair colour / length / style and clothing — not on
   *  pose or lighting. One image, one question: the form of check this pipeline's other gates use.
   *  Can't be checked (no description, no key, a blip) → true: the check may ask for a redraw, never
   *  block a film. */
  const castIsIn = async (twoShotAbs: string | undefined, look: string, creature = false): Promise<boolean> => {
    if (!twoShotAbs || !look) return true;
    try {
      const { anthropicVision } = await import("./anthropic.server");
      const v = await anthropicVision(
        creature
          ? `Two characters are in this image. Is ONE of them ${look}? Judge by what kind of creature it is, its fur or skin and colours, and what it wears — a human being is NOT it; ignore pose, camera angle, lighting and expression. Answer YES or NO and nothing else.`
          : `Two people are in this image. Is ONE of them ${look}? Judge by hair colour, hair length and style, and clothing; ignore pose, camera angle, lighting and expression. Answer YES or NO and nothing else.`,
        [twoShotAbs], { maxTokens: 4 }
      );
      return !/^\s*no\b/i.test(v || "");
    } catch (e) {
      console.error(`[testmovie] cast check skipped: ${e instanceof Error ? e.message.slice(0, 140) : e}`);
      return true;
    }
  };
  /** A CHARACTER — a cartoon, a monster — is checked against its OWN PICTURE, not against a description of
   *  it: "a marigold-yellow cartoon puppy in a red bandana" also fits an orange fox-eared dog in a bandana,
   *  and that is who one scene of a Kids Cartoon had (the same puppy, round and floppy-eared, in the scene
   *  before it — 2026-11-22). The question is the narrated stories' own (story-picture.ts): write down the
   *  kind of creature, its colours, its ears and its markings for both, compare, then answer. On the real
   *  reader it passed a werewolf as himself and refused him as a puppy. Can't be checked → true, as above. */
  const characterIsIn = async (twoShotAbs: string | undefined, picture: string | undefined): Promise<boolean> => {
    if (!twoShotAbs || !picture) return true;
    try {
      const { anthropicVision } = await import("./anthropic.server");
      const said = parseStoryCast(String((await anthropicVision(storyCastPrompt(1), [twoShotAbs, picture], { maxTokens: 400, model: "claude-sonnet-4-6" })) || ""), 1);
      return said ? said[0] : true;
    } catch (e) {
      console.error(`[testmovie] character check skipped: ${e instanceof Error ? e.message.slice(0, 140) : e}`);
      return true;
    }
  };
  type Master = { url: string; aOnLeft: boolean; a: string; b: string; /** how the two are staged in this picture (acted-staging.ts) — absent where nothing fitted, and on every master drawn before 2026-11-24 */ staging?: string };
  const masters: Record<string, Master> = {};
  try { const r = resume.ckMasters ? JSON.parse(resume.ckMasters) : null; if (r && typeof r === "object") Object.assign(masters, r); } catch { /* ignore */ }
  /** THE STAGING each location is dealt (acted-staging.ts) — filled in below, once the film's locations are
   *  known; read here when a location's master is drawn. A location with none is drawn as it always was. */
  const stagingAt = new Map<string, ActedStaging | null>();
  const stagingOf = (m: Master | undefined): ActedStaging | null => (m && isActedStaging(m.staging) ? m.staging : null);
  const masterFor = async (locKey: string, where: string, roomRef?: string, action?: string): Promise<Master | undefined> => {
    if (!isTwoHander) return undefined;
    if (masters[locKey]?.url) return masters[locKey];
    // The master two-shot is the WHOLE film's seed — nano-banana occasionally returns null,
    // which hard-killed the render with "no seed frame". Retry a few times before giving up.
    // …and a master that doesn't LOOK like the people who were cast is the wrong film from its first
    // frame (owner: "the avatar is not Madalynn"). So each try is checked against the cast photos and
    // re-drawn if a cast member isn't recognisably there; the last try is kept either way, so a picky
    // check can never stop a film.
    const faceA = faceFor(spkA), faceB = faceFor(spkB);
    const nameOf = (sp: string) => (castActors.find((c) => firstName(c.name) === firstName(sp))?.name || sp || "").trim() || sp;
    // THE STAGING this location was dealt (acted-staging.ts): how far apart the two are, where the camera is.
    // A new way of asking must never cost a film its seed — so when the staged tries drew NOTHING, the last
    // try asks for the picture the way it always was asked for; and the master remembers what it was drawn as.
    const dealt = stagingAt.get(locKey) || undefined;
    let url: string | null = null;
    let drawnAs: ActedStaging | undefined;
    let castOk = true;
    for (let attempt = 0; attempt < 3; attempt++) {
      const staging = attempt === 2 && !url ? undefined : dealt;
      const tryUrl = await removeLetterbox(await renderSideBySideTwoShot({ roomRefUrl: roomRef, faceA, faceB, descA: bibleFor(spkA), descB: bibleFor(spkB), nameA: nameOf(spkA), nameB: nameOf(spkB), lookA: faceA ? castLooks[firstName(spkA)] : undefined, lookB: faceB ? castLooks[firstName(spkB)] : undefined, creatureA: creatureNamed(spkA), creatureB: creatureNamed(spkB), staging, action, mood: tmpl.faceMood, setting: cleanSetting(where), style: twoStyle, aspect }));
      if (!tryUrl) continue;
      url = tryUrl;
      drawnAs = staging;
      castOk = true;
      for (const sp of [spkA, spkB]) {
        if (!faceFor(sp)) continue;
        // a person by their look in words (the check every approved film was made with); a character by its picture
        const there = creatureNamed(sp) ? await characterIsIn(abs(tryUrl), faceFor(sp)) : await castIsIn(abs(tryUrl), castLooks[firstName(sp)] || "", false);
        if (!there) castOk = false;
      }
      if (castOk) break;
      console.log(`[testmovie] master two-shot try ${attempt + 1}: a cast member doesn't match their photo — redrawing`);
    }
    if (!url) return undefined;
    if (!castOk) console.error("[testmovie] master two-shot: cast still not a clear match after 3 tries — keeping the last");
    // DETECT which side each character landed on — nano-banana doesn't reliably honour
    // left/right, and the clip prompt needs the real side to point Veo at the speaker.
    let aOnLeft = true;
    try {
      const { anthropicVision } = await import("./anthropic.server");
      const twoAbs = abs(url);
      if (twoAbs) {
        // One image, two descriptions, "A or B" — the question every approved film was built on. What
        // changed is the descriptions: bibleFor() now gives a cast presenter's REAL look (read off their
        // photo) instead of the script writer's invention, which matched nobody in the frame.
        // (A two-image "which side is the person in this photo on" version shipped for one deploy and
        // silently answered nothing: the film then put each line in the wrong mouth.)
        const ask = () => anthropicVision(
          (creatureNamed(spkA) || creatureNamed(spkB))
            ? `Two characters are together in this image. Character A is: ${bibleFor(spkA)}. Character B is: ${bibleFor(spkB)}. Which of them is on the LEFT side of the frame? Answer with a single letter, A or B, and nothing else.`
            : `Two people are together in this image. Person A is: ${bibleFor(spkA)}. Person B is: ${bibleFor(spkB)}. Which of them is on the LEFT side of the frame? Answer with a single letter, A or B, and nothing else.`,
          [twoAbs], { maxTokens: 4 }
        );
        let ans = ((await ask()) || "").trim().toUpperCase();
        // anything but a clear A or B is asked once more — guessing here is a coin flip on the whole film
        if (!/^[AB]\b/.test(ans)) ans = ((await ask()) || "").trim().toUpperCase();
        if (ans.startsWith("B")) aOnLeft = false;
        console.log(`[testmovie] sides — ${spkA} is on the ${aOnLeft ? "LEFT" : "RIGHT"}, ${spkB} on the ${aOnLeft ? "RIGHT" : "LEFT"} (answer "${ans.slice(0, 12)}"${ans.startsWith("A") || ans.startsWith("B") ? "" : " — NOT a clear answer, left assumed"})`);
      }
    } catch (e) {
      // keep default A-on-left — but say so: a wrong side puts every line in the wrong mouth
      console.error(`[testmovie] couldn't tell who is on which side (assuming ${spkA} is on the left): ${e instanceof Error ? e.message.slice(0, 140) : e}`);
    }
    // (the staging is kept WITH the picture — in the checkpoint too: a film picked up after a restart plays
    //  each place in the staging its picture was drawn in, not in one dealt afresh)
    masters[locKey] = { url, aOnLeft, a: firstName(spkA), b: firstName(spkB), ...(drawnAs ? { staging: drawnAs } : {}) };
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

  // THE STAGING (acted-staging.ts). The owner, 2026-11-24, of a Horror Film made on the live site: "Unrealistic
  // for them to stand this close bro, and aside from them on screen there is no actual things occurring, it's
  // just them speaking". Every master was the same picture — chest up, close together, both faces to the lens.
  // So each LOCATION is dealt one staging, no two neighbours alike, by what fits its frame, its place and the
  // first scene set there (somebody walking, something to handle, a table to sit at): its master is drawn in
  // it, its clips are told how the two move in it, and the piece keeps which one it got. A location whose
  // master already exists (a film picked up after a restart) keeps what that picture was drawn as; one that
  // fits no staging — the inside of a car — is drawn as it always was, and so is one whose first scene the
  // maker drew and approved in the storyboard (that frame IS how the place looks; a master staged another way
  // would be a second look for it). ACTED_STAGING=off: every film as before.
  const locOrder: string[] = [];
  const locFirst = new Map<string, number>();
  for (let i = 0; i < scenesArr.length; i++) { const k = locKeyAt(i); if (!locFirst.has(k)) { locFirst.set(k, i); locOrder.push(k); } }
  if (isTwoHander && process.env.ACTED_STAGING !== "off") {
    try {
      const dealt = dealStagings(locOrder.map((k) => {
        const first = locFirst.get(k) ?? 0;
        return { where: whereAt[first], scene: scenesArr[first]?.visual || "", ...(masters[k]?.url ? { has: stagingOf(masters[k]) } : approvedFrames[first] ? { has: null } : {}) };
      }), { aspect });
      locOrder.forEach((k, n) => stagingAt.set(k, dealt[n] ?? null));
      console.log(`[testmovie] staging — ${locOrder.map((k) => `${k.slice(0, 40)}: ${stagingAt.get(k) || "as it always was"}`).join(" | ").slice(0, 400)}`);
    } catch (e) {
      // (a film is never lost to its staging: with none dealt, every place is drawn as it always was)
      stagingAt.clear();
      console.error(`[testmovie] staging not dealt — every place as before: ${e instanceof Error ? e.message.slice(0, 140) : e}`);
    }
  }
  /** WHAT HAPPENS in shot i, in its scene's own words — only in a film whose script was written as things
   *  that happen (treatment.events), and only where the words ARE one: not the place's name, not a copy of an
   *  earlier scene's in the same place (acted-staging.ts → sceneEvent). "" = nothing is said to happen.
   *  (Against each scene's OWN `where`, not whereAt: with no place named at all, whereAt borrows the first
   *  scene's words — and they would then look like "only the place's name".) */
  const eventAt = (i: number): string => (treatment.events ? sceneEvent(scenesArr.map((s) => s.visual), scenesArr.map((_, j) => locKeyAt(j)), scenesArr.map((s) => s.where || ""), i) : "");

  // 3) Veo DIALOGUE clips (sequential) — see the design notes atop this file: one
  //    speaker per clip, seamless cuts from the prior clip's real last frame, no
  //    on-screen text, trailing silence trimmed.
  const clips: string[] = (resume.ckClips || []).filter((p) => p && fs.existsSync(p));

  // CAST VOICES — give each character the voice the merchant picked for them (see `lockVoices`).
  // Kling/Veo act every line in a voice of their own; a one-speaker clip is then RE-VOICED with the
  // character's trained voice model (the same models the Music Video sings with), which keeps the
  // performance, the timing and the lip-sync and changes only whose voice it is. Models are trained once
  // per voice and reused; training starts NOW, alongside the first shots, and each clip's re-voice runs
  // in the background while later shots render — so it costs little extra time. Everything here fails
  // open: a voice that can't be applied leaves that clip with the voice the video model gave it.
  const castVoiceOf = (speakerName: string): string | null => {
    const key = firstName(speakerName);
    const v = key ? castActors.find((c) => firstName(c.name) === key)?.voiceId || "" : "";
    // A PERFORMED character voice is not re-voiced this way: the trainer learns a voice from the stock
    // speech model, which has no such voice. It is described to the video model instead (voiceDescFor)
    // and a creature's chain is laid over its lines (below).
    return v && !v.startsWith("ttv-") && !isCharacterVoice(v) && (opts.lockVoices || isPersonalVoice(v)) ? v : null;
  };
  /** The voice to put on shot i, or null: only clips where ONE person speaks (re-voicing an exchange
   *  would give both people the same voice). */
  const clipVoiceAt = (i: number): string | null => {
    // (a shot nobody speaks in has no voice to give anybody — whatever name its emptied caption still carries)
    if (wordless(treatment.scenes[i]?.caption)) return null;
    const t = splitExchange(treatment.scenes[i]?.caption || "");
    const lead = t[0]?.speaker || "";
    if (!lead) return null;
    if (t.some((x, k) => k > 0 && !!x.speaker && !!x.line && firstName(x.speaker) !== firstName(lead))) return null;
    return castVoiceOf(lead);
  };
  const voiceModels = new Map<string, Promise<string | null>>();
  const voiceModelFor = (voiceId: string): Promise<string | null> => {
    let job = voiceModels.get(voiceId);
    if (!job) {
      job = ensureVoiceModel(voiceId, base).then((m) => m.url).catch((e) => {
        console.error(`[testmovie] couldn't prepare a cast voice — those lines keep the generated voice: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
        return null;
      });
      voiceModels.set(voiceId, job);
    }
    return job;
  };
  const revoiceTried = new Set<number>();
  const shotVoice: Record<number, string> = {}; // shot index → the cast voice that was put on it
  let voicesLocked = 0;
  const revoiceAt = async (idx: number): Promise<void> => {
    const voiceId = clipVoiceAt(idx);
    if (!voiceId || revoiceTried.has(idx) || path.basename(clips[idx] || "").startsWith("tmv-")) return;
    revoiceTried.add(idx);
    try {
      const modelUrl = await voiceModelFor(voiceId);
      if (!modelUrl) return;
      clips[idx] = await revoiceClip(clips[idx], modelUrl, base, { voiceId });
      shotVoice[idx] = voiceId;
      voicesLocked++;
      await ckpt({ ckClips: clips });
    } catch (e) {
      console.error(`[testmovie] shot ${idx + 1}: cast voice not applied, keeping the generated voice: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    }
  };
  const revoiceJobs: Promise<void>[] = [];
  // start learning any new voices right away (a first-time voice takes ~6 minutes)
  for (let i = 0; i < treatment.scenes.length; i++) { const v = clipVoiceAt(i); if (v) void voiceModelFor(v); }

  // Per-shot render inputs recorded for the section editor's Phase-3 regenerate (each shot's
  // seed + clip prompt + duration). Pre-filled null for any clips restored from a resume.
  const shotSeeds: (string | null)[] = clips.map(() => null);
  const shotPrompts: (string | null)[] = clips.map(() => null);
  const shotDurs: number[] = clips.map(() => 0);
  const shotChained: boolean[] = clips.map(() => false);
  // …and the staging each shot was played in (acted-staging.ts), for the piece's own record.
  const shotStaged: (ActedStaging | null)[] = clips.map(() => null);
  // WHICH STAGING THE PICTURE A SHOT GROWS OUT OF WAS DRAWN IN — null when it is not a staged picture. (After
  // a restart the next shot may continue the last finished one: it is in that location's staging, unless a
  // frame the maker approved was among the finished shots.)
  let chainStaging: ActedStaging | null = clips.length && !approvedFrames.slice(0, clips.length).some(Boolean) ? stagingOf(masters[locKeyAt(clips.length - 1)]) : null;
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
  // …and the seams that are a STRAIGHT CUT: a cut to another place, and a horror film's reveal
  // (assembleTestMovie → hardSeams). Kept on the piece as `cut: "hard"`, so a re-cut can keep them.
  const hardSeams = new Set<number>();
  let sinceAnchor = clips.length; // resume-safe-ish: force an early re-anchor after a restart
  // What changes a picture or a clip today rides the one switch the staging does (ACTED_STAGING=off: every
  // film as before) — the reveal drawn into its place, the shot that opens on a sound, the face that does not
  // smile at what frightens it (acted-staging.ts).
  const staged = process.env.ACTED_STAGING !== "off";
  const horror = tmpl.key === "horror";
  for (let i = clips.length; i < treatment.scenes.length; i++) {
    const scene = treatment.scenes[i];
    // A SHOT NOBODY SPEAKS IN (acted-staging.ts → wordless): a horror film's last shot has no line, and a
    // maker can empty one in the storyboard. It has no speaker and no words — whatever name its caption may
    // still carry — and below it gets its own prompt, its own length, and none of the steps that need a line.
    const silent = wordless(scene.caption);
    const turns = silent ? [{ speaker: "", line: "" }] : splitExchange(scene.caption || "");
    // EXCHANGE-PER-CLIP: a shot now holds a short back-and-forth — turnA speaks, turnB
    // replies — so the clip is FULL of dialogue (Kling speaks ~0.28s/word, so a single line
    // only half-filled a clip and left it to pad with dead ambient standing-around). turnB is
    // the first LATER turn by a DIFFERENT speaker; absent it, we fall back to the single
    // validated speaker. `line` joins both turns so the clip is sized to the whole exchange.
    const fnm = nameTok;
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
    const lastHorror = staged && horror && i > 0 && i === treatment.scenes.length - 1 && !!eventAt(i);
    // the master of a location is drawn from the first scene set there: that scene's picture says what the shot shows
    // — EXCEPT a horror film's last shot in a place of its own: that place is drawn with only the two in it, and the
    // thing is added to it by THE REVEAL below. (Drawn from the scene's words, the boy's parents' bedroom came with
    // the werewolf already in it, half out of the wall — the owner: "what the fuck is that plot?", 2026-11-24.)
    const master = await masterFor(locKeyAt(i), whereAt[i], i === 0 ? abs(approvedFrames[0]) : undefined, lastHorror && tr === "location" ? undefined : scene.visual);
    const sideFor = sideForMaster(master);
    let seedAbs = abs(approvedFrames[i]);
    // THE REVEAL (acted-staging.ts → revealPicture). A horror film's last shot is in the SAME place as the shot
    // before it, and the thing the story has been circling is drawn INTO that place's own picture: its master,
    // edited — the same room, camera, light and two people — with the thing added by the creature recipe the
    // horror stories use (photographed, a practical effect, mostly in shadow, as slightly wrong as the scene
    // says). It used to be given a place of its own and drawn whole: a different bedroom, reached through a
    // dissolve, with a mannequin's arm in its wall (the owner: "more odd than actual realism"). A picture that
    // will not come leaves the shot to be seeded as any other; a frame the maker approved is never drawn over.
    let revealed = false;
    let revealedCreature = false;
    if (!seedAbs && lastHorror && master?.url && stagingOf(master)) {
      // THE CHOSEN CREATURE AS THE THING (premise-rules.ts → chosenThreat): a creature the maker chose that is not
      // one of the two who talk, and that this last shot finds, is drawn FROM ITS OWN PICTURE — that creature, not
      // one made up from the words (the stronger editor takes it as a second picture; the permissive one cannot).
      const thing = castActors.find((c) => !!c.faceUrl && isCreature(c) && ![spkA, spkB].some((s) => !!s && nameTok(s) === nameTok(c.name)) && (scene.visual || "").toLowerCase().includes(c.name.trim().toLowerCase()));
      const thingFace = thing ? abs(thing.faceUrl) : undefined;
      const askOne = revealPicture({ moment: eventAt(i), mood: tmpl.faceMood, sides: [spkA, spkB].filter((n): n is string => !!n).map((n) => ({ name: n, side: sideFor(n) })), creature: !!(thing && thingFace) });
      const ask = askOne && thing && thingFace
        ? `${askOne} What is found is ${thing.name.trim()}: the creature in the SECOND picture — that exact creature, its face, its fur or skin and its colours and whatever it wears — drawn INTO the first picture the way this says; everything else in the first picture stays exactly as it is.`
        : askOne;
      // ON THE STRONGER EDITOR. Drawn from a frame of the owner's second film, nine rounds of it and looked at:
      // the everyday picture model (the one this used, and the one that drew the mannequin's arm) made every
      // thing it added look stuck on — a white bony claw, a cartoon eyeball, a face in a black cut-out over the
      // window — and refused a third of them; nano-banana-pro kept the room and both faces and broke a real hole
      // in real plaster with the face or the fingers in it, photographed. flux-kontext-pro is the more
      // permissive editor when that one refuses (horror is refused now and then). About 15 cents a film.
      for (const [model, input] of [
        ["google/nano-banana-pro", { prompt: ask, image_input: [abs(master.url), ...(thing && thingFace ? [thingFace] : [])], aspect_ratio: aspect, output_format: "jpg", resolution: "2K" }],
        ["black-forest-labs/flux-kontext-pro", { prompt: askOne, input_image: abs(master.url), aspect_ratio: aspect, output_format: "jpg", output_quality: 92 }],
      ] as Array<[string, Record<string, unknown>]>) {
        if (!ask || seedAbs) break;
        try { seedAbs = abs(await removeLetterbox(await persistRemote(await repRun(model, input, 180_000), "jpg"))); }
        catch (e) { console.error(`[testmovie] shot ${i + 1}: the reveal on ${model} did not come: ${e instanceof Error ? e.message.slice(0, 160) : e}`); }
      }
      if (seedAbs) { revealed = true; revealedCreature = !!(thing && thingFace); sinceAnchor = 0; console.log(`[testmovie] shot ${i + 1}: the reveal — drawn into the place's own picture (${locKeyAt(i).slice(0, 40)})`); }
      else console.error(`[testmovie] shot ${i + 1}: the reveal's picture did not come — the shot is seeded as any other, and the clip is not told what the thing is (the two react to something never seen)`);
    }
    // THE REVEAL THAT COULD NOT BE DRAWN — in its place, with no picture of it: its clip is not told what the thing
    // is (a clip told to show a thing that is not in its picture draws one of its own), and the two react to
    // something never seen (acted-staging.ts → REVEAL_UNSEEN_REACT). A last shot in a place of its own (a script
    // written before the reveal moved into the room) has its thing in that place's own picture, and keeps it.
    const implied = lastHorror && !revealed && !approvedFrames[i];
    if (!seedAbs && master?.url) {
      if (tr === "location") {
        seedAbs = abs(master.url); sinceAnchor = 0; if (i > 0) softSeams.add(i);
      } else if (tr === "angle") {
        const reangled = await removeLetterbox(await renderSceneSeedChained(
          `${whereAt[i]}. A ${shotAt[i]} of the same scene — the identical room, lighting, wardrobe and people, only the camera angle changes. ${NO_TEXT}`,
          abs(master.url)!, [faceFor(spkA), faceFor(spkB)].filter((u): u is string => !!u), aspect,
        ));
        seedAbs = abs(reangled) || abs(prevFrameUrl) || abs(master.url); sinceAnchor = 0; softSeams.add(i);
      } else if (sinceAnchor >= ANCHOR_EVERY) {
        // RE-ANCHOR as an INTENTIONAL camera move (owner's call): still reseed from the
        // pristine master so faces / facial hair can't drift across a long film — but route
        // it through a FRESH ANGLE so the reset reads as a deliberate cut to a new camera,
        // not a snap back to the same frame. The generic framings (tighter / wider / lower)
        // fit ANY setting, and the master image keeps the identical room, lighting,
        // wardrobe and faces, so the angle change is grounded in the real scene.
        const ang = ANCHOR_ANGLES[anchorCount++ % ANCHOR_ANGLES.length];
        // (In a staged film whose shots HAPPEN, the master is the place as it was BEFORE anything was done in
        //  it. So the fresh seed is asked for at THIS shot's moment — the two doing what the scene now has
        //  them doing — not "in the same positions"; each still on the SIDE of the frame the master has them
        //  on, which is how a line finds its mouth. Any other film: the words it always had.)
        const now = stagingOf(master) ? clipEvent(eventAt(i), 110) : "";
        // (a moment that is a sound from out of sight is HEARD, not drawn — acted-staging.ts → HEARD_NOT_DRAWN)
        const unheard = now && heardIn(eventAt(i), [spkA, spkB, ...castActors.map((c) => c.name)])?.unseen ? ` ${HEARD_NOT_DRAWN}` : "";
        const reangled = await removeLetterbox(await renderSceneSeedChained(
          now
            ? `${whereAt[i]}. ${ang} of the same scene — the identical room, lighting, wardrobe and the same two people on the same sides of the frame, ONLY the camera angle changes. At this moment: ${now}${unheard} ${NO_TEXT}`
            : `${whereAt[i]}. ${ang} of the same scene — the identical room, lighting, wardrobe and the same two people in the same positions, ONLY the camera angle changes. ${NO_TEXT}`,
          abs(master.url)!, [faceFor(spkA), faceFor(spkB)].filter((u): u is string => !!u), aspect,
        ));
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
        seedAbs = abs(await renderSceneFrame({ sceneVisual: scene.visual, sceneHint: tmpl.sceneHint, castText: castBible, styleRefUrl: castRefAbs, castRefUrls: shotCastRefs, aspect, creatureCast: castHasCreature }));
      }
    }
    if (!seedAbs) throw new Error(`[testmovie] scene ${i + 1}: no seed frame`);
    // Does this shot CONTINUE the last one (seeded from its final frame)? Then its opening frames are
    // what makes the cut invisible and must survive the trim. Any other seed is a new picture: that seam
    // gets the softer dissolve, and the shot may simply start on its line.
    const chained = i > 0 && !!prevFrameUrl && seedAbs === abs(prevFrameUrl);
    if (i > 0 && !chained) softSeams.add(i);
    // …and a cut to ANOTHER PLACE, or to the reveal, is a straight cut — never a dissolve
    if (i > 0 && !chained && (tr === "location" || revealed)) hardSeams.add(i);
    // THE STAGING THIS SHOT IS PLAYED IN (acted-staging.ts) is that of the PICTURE it grows out of: the
    // location's own master, or a re-anchor on it. A frame the maker approved, an angle they added by hand,
    // a seed composed without a master — none of those is a staged picture, and its shot is told what a shot
    // was always told. A shot that continues the last one keeps the staging of the picture before it.
    if (!chained) chainStaging = approvedFrames[i] || !master?.url || tr === "angle" ? null : stagingOf(master);

    // Veo prompt: ONE speaker talks a full beat (clean single voice), the other
    // present and reacting; two-shot; voice pinned consistent; NO on-screen text.
    // Pin the speaker's voice to the timbre the merchant cast (Veo has no voice
    // reference, so a concrete described timbre is the lever that holds it steady).
    const voiceDescFor = (name: string): string => {
      if (!name) return "";
      const key = fnm(name);
      const a = castActors.find((c) => fnm(c.name) === key);
      // a cartoon's or a creature's voice, in the words it was designed in — the video model acts it
      const acted = a ? characterVoice(a.voiceId) : null;
      if (acted) return ` ${name}'s voice is ${acted.style}; keep this exact voice in every shot.`;
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
    // …and THE FACE it is said with (acted-staging.ts → faceNote): in a horror film neither of the two smiles,
    // in any film the one who says a frightened line does not — unless the script makes the smile the horror.
    // (The owner's knocking film: the older sister smiled through its most frightening line. The delivery said
    // how the line SOUNDS; nothing said what her face does.)
    const otherName = [spkA, spkB].find((n) => !!n && fnm(n) !== fnm(speaker)) || "";
    const face = staged && !silent ? faceNote({ horror, tone, visual: scene.visual, speaker, other: turnB ? turnB.speaker : otherName }) : "";
    const deliver = `${tone
      ? `Deliver it ${tone} — put that exact emotion and energy into the voice, expressively, NEVER flat or monotone.`
      : `Deliver it with the REAL emotion the words carry — an angry line sounds angry, a threat sounds menacing, hurt shows as hurt — with natural intonation and emphasis, NEVER flat or monotone.`}${face ? ` ${face}` : ""}`;
    // A SOUND THEY HEAR (acted-staging.ts → heardIn). When this shot's scene is a sound — a knock, footsteps, a
    // voice — the shot OPENS on it, heard alone, and its line answers it (heardTalk): the owner's knocking film
    // had "Tell me you heard that too" a whole shot before the knock was heard. Its sound rule lets that sound
    // be made, exactly as described; one from out of sight is made by nothing in the picture; the take is
    // longer by it (heardSeconds) and keeps its head (clipHearsFirst). Only where the scene is told to the clip
    // at all: a staged picture, in a film whose shots happen. (Never a reveal this film drew: its clip is told what
    // is in its picture instead of the scene's words — acted-staging.ts → revealClip.)
    const heard = !silent && chainStaging && !implied && !revealed ? heardIn(eventAt(i), [spkA, spkB, ...castActors.map((c) => c.name)]) : null;
    const voiceLine = heard
      ? heardTalk({
          event: clipEvent(eventAt(i), i === treatment.scenes.length - 1 ? EVENT_MAX_LAST : EVENT_MAX), unseen: heard.unseen,
          speaker, side: sSide, line: turnB && turnB.speaker && turnB.line ? turnA.line : line, other: otherName, otherSide: oSide, deliver,
          reply: turnB && turnB.speaker && turnB.line ? { speaker: turnB.speaker, side: sideB, line: turnB.line } : null,
        })
      : (turnB && turnB.speaker && turnB.line)
      ? `This two-shot is a short back-and-forth between TWO people, one speaking at a time. FIRST, ${turnA.speaker}${sSide ? ` (on the ${sSide} side of the frame)` : ""} says, in accurate lip-sync: "${turnA.line}". THEN ${turnB.speaker}${sideB ? ` (on the ${sideB} side)` : ""} replies, in accurate lip-sync: "${turnB.line}". ONLY ONE person speaks at a time: ${turnA.speaker} goes FIRST — only ${turnA.speaker}'s mouth moves while ${turnB.speaker} stays silent, listening and reacting — THEN ${turnB.speaker} answers — only ${turnB.speaker}'s mouth moves while ${turnA.speaker} stays silent, listening. There are exactly TWO distinct voices: ${turnA.speaker}'s voice on the first line and ${turnB.speaker}'s voice on the second — they NEVER talk at the same time, never overlap, and NO third voice, murmur or gibberish appears anywhere. Each person says their line exactly ONCE, word for word, clearly and articulately, beginning right away with no long pauses, so the two lines fill the whole shot back-to-back. ${deliver}`
      : speaker
      ? `${sSide ? `In this two-shot BOTH people are visible, but the ONLY one who speaks is the person on the ${sSide.toUpperCase()} side of the frame — that is ${speaker}. The person on the ${oSide.toUpperCase()} does NOT speak. ` : ""}There is ONLY ONE voice in this entire clip — ${speaker}'s. ${speaker}${sSide ? ` (on the ${sSide})` : ""} says exactly this one line and nothing else: "${line}". Say it through exactly ONCE, word for word — do NOT repeat, echo, loop or restate any word or phrase, and add no words that are not in the line. The MOMENT the line is finished, ${speaker} stops speaking and simply holds a natural, quiet expression for the rest of the shot — no extra, improvised or filler words. ${deliver} Speak CLEARLY and crisply — every word fully articulated and intelligible, no mumbling, slurring or trailing off — BEGIN speaking right away and keep a natural, connected pace, in accurate lip-sync. ONLY ${speaker}'s mouth moves. The OTHER character${oSide ? ` (on the ${oSide})` : ""} is COMPLETELY SILENT the whole time — absolutely no talking, murmuring, mumbling, whispering, muttering or background speech of any kind; their mouth stays closed and still, only listening and reacting. Do NOT generate any second voice, murmur or gibberish anywhere in the clip — one clear voice only. Keep ${speaker}'s voice the SAME as in every other shot.`
      : `Exactly ONE voice in the whole clip saying this line clearly and expressively (never monotone), every word articulate, no mumbling, beginning right away: "${line}". Say it through ONCE only — do NOT repeat, loop or restate any word, and add no words not in the line; the instant it is finished, stop speaking and hold a natural quiet expression for the rest of the shot. ${deliver} The other character is completely silent — mouth closed, only listening.`;
    // LIGHT PROMPT — the SEED frame already carries the faces, room and staging, so the
    // prompt only drives the TALKING and tells Veo to HOLD the frame. Re-describing the
    // scene + both characters in text (scene.visual / STAGING / castBible) made Veo redraw
    // the faces from the WORDS and drift them; stripping that lets the seed drive the look
    // ("use the seed like you're supposed to" — owner). voiceLine = the single-speaker line.
    void STAGING; void HOLD_STILL; // (kept defined for the seed/scene-frame paths; not in the clip prompt)
    // The standing rules (look / style / camera+audio / no-text) come from clipRules — written short so
    // the whole prompt fits what Kling reads. (The long NO_TEXT above stays for the image prompts.)
    const rules = clipRules({ cartoon, sing });
    // IN A STAGING (acted-staging.ts) the look-note no longer ends "The speakers hold their places": it says
    // how the two move in that staging and — in a film written as things that HAPPEN (treatment.events) — the
    // ONE thing this scene's own words say is done while the line is spoken. (The owner, 2026-11-24: "there
    // is no actual things occurring, it's just them speaking".) Nothing is named that the scene does not name:
    // a clip prompt that names a thing can ADD it (story-motion.ts), so the thing itself is in the picture the
    // shot grows out of, put there by the writer's scene. Not a staged picture → the rules as they always were.
    let playRules = rules;
    if (silent) {
      // NOBODY SPEAKS IN THIS SHOT (acted-staging.ts → silentRules). The rules say how the two stand (in the
      // staging of the picture, when it has one), the ONE thing the scene's own words say happens — in a
      // horror ending that IS the shot — and nothing about talking: no "spoken-dialogue audio", no "the ONLY
      // audio is the spoken voice". No talking directions place anybody in such a shot, so each of the two is
      // said to be on their side when what happens names them. (And: a sound in it from out of sight is made
      // by nothing in the picture; a horror film's last shot moves SLOWLY; neither of them grins at it.)
      // THE REVEAL THIS FILM DREW (`revealed`): its clip is told what is in its picture and the one small thing it
      // does there, in place — never the scene's own words: the third live film's were "nearer", and the engine
      // pushed the fingers out into a big hand reaching at the lens (acted-staging.ts → revealClip).
      const sides = [spkA, spkB].filter((n): n is string => !!n).map((n) => ({ name: n, side: sideFor(n) })).filter((p) => !!p.side);
      const unseen = staged && !!heardIn(eventAt(i), [spkA, spkB, ...castActors.map((c) => c.name)])?.unseen;
      const scared = staged ? faceNote({ horror, visual: scene.visual, speaker: spkA, other: spkB }) : "";
      try {
        playRules = silentRules(rules, { staging: chainStaging, event: eventAt(i), eventMax: i === treatment.scenes.length - 1 ? EVENT_MAX_LAST : undefined, sides, unseen, reveal: lastHorror, drawn: revealed, creature: revealedCreature, implied, face: scared });
      } catch (e) {
        // (never a shot lost to its words: it is a held, quiet beat — and still told that nobody speaks)
        console.error(`[testmovie] shot ${i + 1}: the wordless shot's rules were not built — it is told to hold: ${e instanceof Error ? e.message.slice(0, 140) : e}`);
        try { playRules = silentRules(rules); } catch { /* the rules as they came: the prompt still opens on NOBODY SPEAKS */ }
      }
    } else if (chainStaging) {
      try {
        playRules = stagedRules(rules, { staging: chainStaging, event: eventAt(i), eventMax: i === treatment.scenes.length - 1 ? EVENT_MAX_LAST : undefined, others: !turnB && otherName && oSide ? [{ name: otherName, side: oSide }] : [], heard: !!heard, reveal: lastHorror, drawn: revealed, creature: revealedCreature, implied });
      } catch (e) {
        // (never a shot lost to its staging: it is told what a shot was always told)
        console.error(`[testmovie] shot ${i + 1}: staging words not built — the shot is told to hold, as before: ${e instanceof Error ? e.message.slice(0, 140) : e}`);
      }
    }
    // Voice timbre ("X's voice is warm…") rides separately so the fitter can drop it last of all.
    const voiceDesc = (turnB && turnB.speaker && turnB.line) ? `${voiceDescFor(turnA.speaker)}${voiceDescFor(turnB.speaker)}` : speaker ? speakerVoiceDesc : "";
    // (A SHOT NOBODY SPEAKS IN opens on NOBODY SPEAKS instead of the talking directions — which would have
    //  told the engine to say `""` — and carries no voice timbre: this engine speaks any quoted text it is
    //  handed and moves whatever mouth it can see to it, so such a prompt has no quotation in it at all.)
    const fitted = fitClipPrompt({ voice: silent ? NOBODY_SPEAKS : voiceLine, voiceDesc: silent ? "" : voiceDesc, ...playRules });
    const prompt = fitted.prompt;
    if (fitted.gaveUp) console.log(`[testmovie] shot ${i + 1}: prompt fitted to ${prompt.length} chars by giving up: ${fitted.gaveUp}`);
    if (silent) console.log(`[testmovie] shot ${i + 1}: nobody speaks in it — ${SILENT_SHOT_SECONDS} s of what happens, kept whole`);
    if (heard) console.log(`[testmovie] shot ${i + 1}: opens on a sound${heard.unseen ? " from out of sight" : ""} (${heard.sound.slice(0, 90)}) — ${heardSeconds(line)} s, its head kept`);

    // Size the clip to the SPOKEN LINE (word-metered) instead of a flat 10s. A clip that
    // outlasts its line is exactly what makes Kling pad the dead air — with silence (a
    // pause) or by looping words — so matching the length to the words starves both.
    // (A shot nobody speaks in has no words to be sized by: it is SILENT_SHOT_SECONDS long. One that opens on
    //  a sound is its line's length and the sound's — acted-staging.ts → heardSeconds.)
    const clipSecs = silent ? SILENT_SHOT_SECONDS : heard ? heardSeconds(line) : clipSecondsFor(line);
    const clipUrl = await dialogueClip(dialogueEngine, seedAbs, prompt, `testmovie-${i}`, clipSecs, aspect);
    const rawPath = path.join(RENDERS(), `tm-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp4`);
    await download(clipUrl, rawPath);
    if (!(fs.existsSync(rawPath) && ffprobeDuration(rawPath) > 1)) throw new Error(`[testmovie] scene ${i + 1}: clip did not download`);
    // dead air off both ends (a continuing shot keeps its opening frames; the film's last shot holds a beat
    // longer), and a long mid-line pause taken down to a beat — on the heard words where they come back
    // (a shot nobody speaks in is kept whole: there is no line to find the ends of; one that opens on a sound
    //  keeps everything before its line — read off the prompt, as a re-roll reads it)
    const dry = await trimClip(rawPath, { chained, last: i === treatment.scenes.length - 1, moves: clipMoves(prompt), silent, keepHead: clipHearsFirst(prompt) });
    // A CREATURE'S LINES get its creature chain — the same one its voice-over goes through — laid over
    // this clip's own audio, in sync with the picture. Only on a shot where the creature is the ONE who
    // speaks: the chain is over the whole track, and a second speaker would be dragged through it too.
    // (…and never on a shot nobody speaks in: it has no line to lay a voice over.)
    const soloVoice = turnB || silent ? null : characterVoice(castActors.find((c) => fnm(c.name) === fnm(speaker))?.voiceId);
    const outPath = soloVoice?.acting.chain ? await chainClipVoice(dry, soloVoice.acting.chain) : dry;
    if (outPath !== dry && soloVoice) { shotVoice[clips.length] = soloVoice.id; voicesLocked++; }
    clips.push(outPath);
    shotSeeds.push(seedAbs); shotPrompts.push(prompt); shotDurs.push(clipSecs); shotChained.push(chained); shotStaged.push(chainStaging);
    // Advance the seamless chain: the trimmed clip's ACTUAL last frame seeds the next.
    prevFrameUrl = (await extractLastFrame(outPath)) || undefined;
    await ckpt({ ckClips: clips, ckLastStill: prevFrameUrl });
    // put the character's own voice on this shot in the background while the next one renders
    // (the next shot chains off this one's last FRAME, which re-voicing doesn't touch)
    revoiceJobs.push(revoiceAt(clips.length - 1));
  }
  if (!clips.length) throw new Error("[testmovie] no clips rendered");
  // every cast voice lands before the cut: the ones started above, then any shot that was restored from
  // a checkpoint before its voice was applied (a re-voiced clip is named tmv-…, so it's never done twice)
  await Promise.all(revoiceJobs);
  for (let i = 0; i < clips.length; i++) await revoiceAt(i);
  if (voicesLocked) console.log(`[testmovie] cast voices applied to ${voicesLocked} of ${clips.length} shots`);

  // 4) ASSEMBLE — concat the clips keeping the dialogue audio.
  const outName = `tm-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp4`;
  const outPath = path.join(RENDERS(), outName);
  const filmFrames = await assembleTestMovie(clips, outPath, jobId, softSeams, aspect, hardSeams);
  // 4a) LOUDNESS — an acted film's sound is whatever the video model performed, and it came out much
  // quieter than a narrated story (-24 dB against -18 on the first two made side by side). Levelled to
  // the same loudness; never fatal.
  try { const { levelFilm } = await import("./film-loudness.server"); await levelFilm(outPath); } catch (e) { console.error(`[testmovie] loudness not levelled: ${e instanceof Error ? e.message.slice(0, 120) : e}`); }
  // 4b) CAPTIONS (the maker's choice): each shot's line, as written, in time with its voice. A sung
  // film has its own lyric treatment; this is for spoken ones. It can never cost the film.
  let captioned: string = "off";
  const wantCaptions = captionStyleOf(opts.captions, "off");
  if (wantCaptions !== "off" && !sing) {
    const { captionFilm } = await import("./film-captions.server");
    const lang = (await db.shop.findUnique({ where: { id: opts.shopId }, select: { contentLang: true } }))?.contentLang;
    captioned = await captionFilm({
      filmPath: outPath, style: wantCaptions, jobId, lang: normalizeContentLang(lang),
      // (a shot nobody speaks in has no card: an emptied line must not leave its speaker's name on screen)
      lines: treatment.scenes.slice(0, clips.length).map((sc) => (wordless(sc.caption) ? "" : splitExchange(sc.caption || "").map((t) => t.line).join(" "))),
      // (each shot as long as the join made it: its picture's length)
      clipDurs: clips.map((c) => { try { return pictureFrames(c) / FILM_FPS; } catch { return 0; } }),
    });
  }
  // THE FINISHED FILE, MEASURED ONCE MORE — its sound levelled and its captions drawn since the join measured it:
  // picture and sound the same length, and the length its shots add up to. Not whole: the job fails, never ships.
  const finished = joinCheck({ ...streamSeconds(outPath), frames: filmFrames });
  if (!finished.ok) throw new Error(`[testmovie] the finished film is not whole after its sound and captions — ${finished.why}`);
  const outBuf = fs.readFileSync(outPath);
  try { await mirrorRender(outName, outBuf); } catch { /* non-fatal */ }
  const storedUrl = `/renders/${outName}`;

  // THE POSTER (story-poster.server.ts): an acted film is billed with its cast's OWN portraits — the leads
  // side by side under the title — as its cover on the shelf. Only a cast the maker PICKED has portraits.
  // It never fails the film: without one the shelf shows the first frame, as it always did.
  let poster: string | null = null;
  if (process.env.STORY_POSTER !== "off") {
    try { poster = await makeCastPoster({ cast: opts.cast, title: treatment.title || opts.topic || "", videoName: outName }); }
    catch (e) { console.error(`[testmovie] no poster (the shelf shows the first frame): ${e instanceof Error ? e.message.slice(0, 160) : e}`); }
  }

  const asset = await db.asset.create({
    data: {
      shopId: opts.shopId,
      type: "VIDEO_AD",
      status: "PENDING",
      // (named after the HERO it was made as — an acted horror story is a "Horror Film": film-heroes.ts)
      title: `${heroName(tmpl.key, false, tmpl.name)} — ${trimTitle(treatment.title || opts.topic || "dialogue scene", 60)}`,
      bodyJson: JSON.stringify({ style: "TESTMOVIE", videoUrl: storedUrl, prompt: opts.topic || "", treatment }),
      metaJson: JSON.stringify({
        kind: "testmovie", template: tmpl.key, section: opts.section || "creator",
        scenes: clips.length, aspect, engine: dialogueEngine, voicesLocked, captions: captioned,
        ...(dialogueEngine === "kling3" ? { host: filmKlingHost() } : {}),
        // NEXT EPISODE (film-series.ts): who was cast — face and voice — so the next episode casts them
        // again, and the series this film is an episode of (an ordinary film has no `series`)
        cast: castForMeta(opts.cast),
        ...(opts.series ? { series: seriesMeta(opts.series) } : {}),
        // THE POSTER: its cover on the shelf — the cast's portraits under the title (story-poster.ts)
        ...(poster ? { poster } : {}),
        // THE STAGING (acted-staging.ts): how the two were placed in each location, in the order the film
        // first visits them — what each place's picture was ASKED for (null: the close two-shot, as before).
        // A film with no staged place at all carries no such list.
        ...(locOrder.some((k) => stagingOf(masters[k])) ? { staging: locOrder.map((k) => ({ where: (whereAt[locFirst.get(k) ?? 0] || "").slice(0, 120), as: stagingOf(masters[k]) })) } : {}),
        // Per-shot timeline for the section editor: each rendered shot's /renders URL +
        // the line it speaks, so the editor can list, preview and (later) re-edit each one.
        shots: clips.map((c, i) => ({
          url: `/renders/${path.basename(c)}`,
          // (a shot nobody speaks in is recorded as that — and with no caption, so that a later re-cut of the
          //  film, which draws each shot's caption again, draws nothing over it)
          caption: wordless(treatment.scenes[i]?.caption) ? "" : (treatment.scenes[i]?.caption || "").slice(0, 200),
          ...(wordless(treatment.scenes[i]?.caption) ? { wordless: true } : {}),
          // Regenerate inputs (section editor Phase 3): re-roll this one shot from its seed.
          seed: shotSeeds[i] || undefined,
          prompt: shotPrompts[i] || undefined,
          dur: shotDurs[i] || undefined,
          // continues the previous shot (seeded from its last frame) → a re-roll must keep its opening frames
          chained: shotChained[i] || undefined,
          // the cast voice on this shot ("Lock these voices") → a re-roll of it gets the same voice
          voice: shotVoice[i] || undefined,
          // the staging this shot was played in (acted-staging.ts) — its prompt, above, has the words
          staging: shotStaged[i] || undefined,
          // the cut INTO this shot is a straight one (another place, or a horror film's reveal) — so that a
          // re-cut of the film (film-edit.server.ts → finishCut) can keep it one instead of dissolving
          ...(hardSeams.has(i) ? { cut: "hard" } : {}),
        })),
      }),
    },
  });
  return asset.id;
}
