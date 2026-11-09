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
async function veoDialogueClip(seedAbs: string, prompt: string, stage: string): Promise<string> {
  if (falEnabled()) {
    try {
      const rid = await falVideoSubmit(FAL_VEO, { startImage: seedAbs, prompt, generateAudio: true });
      return await falVideoPoll(FAL_VEO, rid, VEO_POLL_MS);
    } catch (e) {
      console.error(`[testmovie] fal veo failed, trying Replicate: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    }
  }
  const id = await repCreate(REP_VEO, { prompt, image: seedAbs, aspect_ratio: "9:16", generate_audio: true });
  return await repPoll(id, VEO_POLL_MS, stage);
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
    const lastStart = starts.length ? starts[starts.length - 1] : NaN;
    const lastEnd = ends.length ? ends[ends.length - 1] : NaN;
    // Trailing silence = a silence_start that runs to EOF (no later silence_end).
    const trailing = !Number.isNaN(lastStart) && (Number.isNaN(lastEnd) || lastEnd < lastStart);
    if (trailing && lastStart > 1.2 && lastStart < dur - 0.5) {
      const end = Math.min(dur, lastStart + 0.45);
      const out = inPath.replace(/\.mp4$/i, "-trim.mp4");
      const r = await runFfmpeg(["-y", "-i", inPath, "-t", end.toFixed(2), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out]);
      if (r.status === 0 && fs.existsSync(out) && ffprobeDuration(out) > 0.8) return out;
    }
  } catch { /* keep the original clip */ }
  return inPath;
}

/** Concatenate the Veo clips, KEEPING their dialogue audio (unlike the main
 *  engine, which strips clip audio for a narrator/music bed). Degrade ladder:
 *  with audio → silent, so a clip that came back without an audio stream can't
 *  sink the whole render. */
async function assembleTestMovie(clips: string[], outPath: string, jobId?: string): Promise<void> {
  const N = clips.length;
  if (!N) throw new Error("[testmovie] no clips");
  const beat = async () => { if (jobId) await checkpointJob(jobId, { ckBeat: Date.now() }); };
  const produced = (): boolean => { try { return fs.existsSync(outPath) && ffprobeDuration(outPath) > 1; } catch { return false; } };
  const SCALE = "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30";
  const TAIL = ["-threads", "2", "-filter_complex_threads", "2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outPath];

  // PREFERRED: a short CROSSFADE at each cut (video xfade + audio acrossfade) so the
  // clip change reads as a smooth dissolve, not a clunky hard jump. Because clip N is
  // seeded from clip N-1's last frame, the two frames are nearly identical, so the
  // dissolve is almost invisible — it just softens the re-animation hitch. Needs each
  // clip's duration for the offsets; if anything is off we fall back to concat below.
  const buildXfade = (): string[] | null => {
    if (N < 2) return null;
    const FADE = 0.18;
    const durs = clips.map((c) => { try { return ffprobeDuration(c); } catch { return 0; } });
    if (durs.some((d) => !(d > FADE + 0.3))) return null;
    const a: string[] = ["-y"];
    clips.forEach((c) => a.push("-i", c));
    const f: string[] = [];
    clips.forEach((_, i) => {
      f.push(`[${i}:v]${SCALE},setpts=PTS-STARTPTS[v${i}]`);
      f.push(`[${i}:a]aresample=44100,asetpts=PTS-STARTPTS[a${i}]`);
    });
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
const NO_TEXT = "Absolutely NO on-screen text of any kind: no subtitles, no captions, no titles, and no readable writing on any paper, document, folder, bulletin board, whiteboard, sign, poster or screen anywhere in the frame — keep every surface clean and text-free.";
const HOLD_STILL = "The characters STAY in their positions — no standing up, sitting down, walking or crossing the room, only natural small gestures, head turns and talking. Keep every character's face, hair, hairstyle, clothing and wardrobe EXACTLY the same the whole time — no morphing, melting or changing of anyone's appearance.";
// Keep both faces in the shot (continuity) WITHOUT forcing them into the same
// space — "two-shot in the room" overrode scenes that place the characters apart
// (one inside, one outside a window), collapsing them onto the same side. Honour
// the scene's own staging instead.
const STAGING = "Frame it as a TWO-SHOT that keeps BOTH characters visible in the shot, but place each one EXACTLY where the scene describes: if they are apart — one indoors and one outdoors, on opposite sides of a window, door, wall or other barrier, or separated by glass — KEEP that separation with the barrier clearly between them; never merge them into the same space or onto the same side.";

/** Build + render ONE scene's photo seed (the storyboard frame). Shared by the
 *  render loop and the web "preview frame" action so the preview is WYSIWYG.
 *  Returns a relative /renders URL, or null on failure (caller decides fallback). */
export async function renderSceneFrame(opts: { sceneVisual: string; sceneHint: string; castText?: string; styleRefUrl?: string | null; castRefUrls?: (string | null | undefined)[]; roomRefUrl?: string | null }): Promise<string | null> {
  const framed = `${opts.sceneVisual}. ${opts.sceneHint}. ${STAGING} ${opts.castText || ""} ${NO_TEXT}`.replace(/\s+/g, " ").trim();
  try {
    const castRefs = (opts.castRefUrls || []).filter((u): u is string => !!u);
    // CONTINUITY path first: when we have the PREVIOUS shot's frame AND the locked
    // cast faces, chain them — the prior frame anchors the room/lighting/angle while
    // the faces lock identity. Without this the room was reinvented every shot and the
    // clips cut between unrelated sets (the "four different rooms" bug).
    if (opts.roomRefUrl && castRefs.length) {
      const chained = await renderSceneSeedChained(framed, opts.roomRefUrl, castRefs, "9:16");
      if (chained) return chained;
    }
    // CAST path: when the shot's actors are locked (but no prior frame to chain from,
    // e.g. the opening shot), compose from their faces so identity holds shot-to-shot.
    if (castRefs.length) {
      const multi = await renderStyledSeedMulti(framed, castRefs, "9:16");
      if (multi) return multi;
    }
    return opts.styleRefUrl
      ? ((await renderStyledSeed(framed, opts.styleRefUrl, "9:16")) || (await renderCreativeSeed(framed, "9:16")))
      : await renderCreativeSeed(framed, "9:16");
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
}): Promise<string> {
  const tmpl = filmTemplate(opts.template); // "testmovie"
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
      const ref = await renderCreativeSeed(`${tmpl.sceneHint}. A photorealistic group shot of the characters together in the scene, clear faces, cinematic. ${castBible}`, "9:16");
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
    const url = await renderSideBySideTwoShot({ roomRefUrl: roomRef, faceA: faceFor(spkA), faceB: faceFor(spkB), descA: bibleFor(spkA), descB: bibleFor(spkB), setting: cleanSetting(where) });
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
  let prevFrameUrl: string | undefined = resume.ckLastStill; // prior clip's last frame (relative /renders URL)
  for (let i = clips.length; i < treatment.scenes.length; i++) {
    const scene = treatment.scenes[i];
    const turns = splitExchange(scene.caption || "");
    const speaker = turns.find((t) => t.speaker)?.speaker || "";
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
        seedAbs = abs(master.url);
      } else if (tr === "angle") {
        const reangled = await renderSceneSeedChained(
          `${whereAt[i]}. A ${shotAt[i]} of the same scene — the identical room, lighting, wardrobe and people, only the camera angle changes. ${NO_TEXT}`,
          abs(master.url)!, [faceFor(spkA), faceFor(spkB)].filter((u): u is string => !!u), "9:16",
        );
        seedAbs = abs(reangled) || abs(prevFrameUrl) || abs(master.url);
      } else {
        seedAbs = abs(prevFrameUrl) || abs(master.url);
      }
    }
    if (!seedAbs) {
      // Non-two-hander (or the master couldn't render): chain if we can, else compose the
      // seed from the locked faces of the cast in THIS shot so the actors hold shot-to-shot.
      seedAbs = abs(prevFrameUrl);
      if (!seedAbs) {
        const shotCastRefs = actorsInScene(castActors, scene).map((c) => abs(c.faceUrl)).filter((u): u is string => !!u);
        seedAbs = abs(await renderSceneFrame({ sceneVisual: scene.visual, sceneHint: tmpl.sceneHint, castText: castBible, styleRefUrl: castRefAbs, castRefUrls: shotCastRefs }));
      }
    }
    if (!seedAbs) throw new Error(`[testmovie] scene ${i + 1}: no seed frame`);

    // Veo prompt: ONE speaker talks a full beat (clean single voice), the other
    // present and reacting; two-shot; voice pinned consistent; NO on-screen text.
    // Pin the speaker's voice to the timbre the merchant cast (Veo has no voice
    // reference, so a concrete described timbre is the lever that holds it steady).
    const speakerVoiceDesc = (() => {
      if (!speaker) return "";
      const key = speaker.toLowerCase().split(/[\s,]/)[0];
      const a = castActors.find((c) => (c.name || "").toLowerCase().split(/[\s,]/)[0] === key);
      const v = a && a.voiceId ? AVATAR_VOICES.find((x) => x.id === a.voiceId) : undefined;
      return v ? ` ${speaker}'s voice is ${v.blurb.toLowerCase()} (a ${v.label.toLowerCase()} ${v.gender === "f" ? "female" : "male"} voice); keep this exact voice in every shot.` : "";
    })();
    // Point Veo at the RIGHT face: in the two-shot both people are visible, so name the
    // speaker by their SIDE of the frame (detected above) — otherwise Veo animates the
    // wrong brother's mouth and the line comes out of the wrong person (owner's bug).
    const sSide = sideFor(speaker);
    const oSide = sSide === "left" ? "right" : sSide === "right" ? "left" : "";
    const voiceLine = speaker
      ? `${sSide ? `In this two-shot BOTH people are visible, but the ONLY one who speaks is the person seated on the ${sSide.toUpperCase()} side of the frame — that is ${speaker}. The person on the ${oSide.toUpperCase()} does NOT speak. ` : ""}There is ONLY ONE voice in this entire clip — ${speaker}'s. ${speaker}${sSide ? ` (the person on the ${sSide})` : ""} says this one line, clearly and naturally with accurate lip-sync, and nothing else is spoken: "${line}". ONLY ${speaker}'s mouth moves. The OTHER character${oSide ? ` (the person on the ${oSide})` : ""} is COMPLETELY SILENT the whole time — absolutely no talking, no murmuring, no mumbling, no whispering, no muttering and no background speech of any kind; their mouth stays closed and still, only listening and reacting. Do NOT generate any second voice, murmur, or gibberish anywhere in the clip — one voice only. Keep ${speaker}'s voice natural and the SAME as in every other shot.${speakerVoiceDesc}`
      : `Exactly ONE voice in the whole clip: one character says this line clearly with accurate lip-sync: "${line}". The other character is completely silent — no talking, murmuring or mumbling at all, mouth closed, only listening.`;
    // LIGHT PROMPT — the SEED frame already carries the faces, room and staging, so the
    // prompt only drives the TALKING and tells Veo to HOLD the frame. Re-describing the
    // scene + both characters in text (scene.visual / STAGING / castBible) made Veo redraw
    // the faces from the WORDS and drift them; stripping that lets the seed drive the look
    // ("use the seed like you're supposed to" — owner). voiceLine = the single-speaker line.
    void STAGING; void HOLD_STILL; // (kept defined for the seed/scene-frame paths; not in the clip prompt)
    const prompt =
      `${voiceLine} ` +
      `Keep EVERYONE and the entire setting EXACTLY as in the provided starting image — identical faces, hair, skin tone, facial hair, clothing, lighting and background, unchanged throughout; do NOT morph, age or redraw anyone into a different person. The camera holds steady and nobody moves except natural talking and small, subtle head and expression shifts. Photorealistic live-action, clean natural spoken-dialogue audio. ${NO_TEXT}`;

    const clipUrl = await veoDialogueClip(seedAbs, prompt, `testmovie-${i}`);
    const rawPath = path.join(RENDERS(), `tm-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp4`);
    await download(clipUrl, rawPath);
    if (!(fs.existsSync(rawPath) && ffprobeDuration(rawPath) > 1)) throw new Error(`[testmovie] scene ${i + 1}: clip did not download`);
    const outPath = await trimTrailingSilence(rawPath); // cut the dead air after the last word
    clips.push(outPath);
    // Advance the seamless chain: the trimmed clip's ACTUAL last frame seeds the next.
    prevFrameUrl = (await extractLastFrame(outPath)) || undefined;
    await ckpt({ ckClips: clips, ckLastStill: prevFrameUrl });
  }
  if (!clips.length) throw new Error("[testmovie] no clips rendered");

  // 4) ASSEMBLE — concat the clips keeping the dialogue audio.
  const outName = `tm-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp4`;
  const outPath = path.join(RENDERS(), outName);
  await assembleTestMovie(clips, outPath, jobId);
  const outBuf = fs.readFileSync(outPath);
  try { await mirrorRender(outName, outBuf); } catch { /* non-fatal */ }
  const storedUrl = `/renders/${outName}`;

  const asset = await db.asset.create({
    data: {
      shopId: opts.shopId,
      type: "VIDEO_AD",
      status: "PENDING",
      title: `Test Movie — ${(treatment.title || opts.topic || "dialogue test").slice(0, 60)}`,
      bodyJson: JSON.stringify({ style: "TESTMOVIE", videoUrl: storedUrl, prompt: opts.topic || "", treatment }),
      metaJson: JSON.stringify({ kind: "testmovie", template: tmpl.key, section: opts.section || "creator", scenes: clips.length, aspect: "vertical" }),
    },
  });
  return asset.id;
}
