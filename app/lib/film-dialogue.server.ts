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
import { renderCreativeSeed, renderStyledSeed } from "./image-generation.server";
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

export async function generateTestMovie(opts: {
  shopId: string;
  template?: string;
  topic?: string;
  treatment?: FilmTreatment;
  sceneCount?: number;
  section?: string;
  jobId?: string;
  resume?: { ckTreatment?: string; ckCastRef?: string; ckClips?: string[]; ckLastStill?: string };
}): Promise<string> {
  const tmpl = filmTemplate(opts.template); // "testmovie"
  const jobId = opts.jobId;
  const resume = opts.resume || {};
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

  // 2) CAST REFERENCE still (photoreal) — establishes the characters' look; the
  //    first scene seeds from it, then the chain carries continuity.
  let castRefAbs = abs(resume.ckCastRef);
  if (!castRefAbs && castBible) {
    try {
      const ref = await renderCreativeSeed(`${tmpl.sceneHint}. A photorealistic group shot of the characters together in the scene, clear faces, cinematic. ${castBible}`, "9:16");
      if (ref) { await ckpt({ ckCastRef: ref }); castRefAbs = abs(ref); }
    } catch { /* fall through to text seeds */ }
  }

  // 3) Veo DIALOGUE clips (sequential) — see the design notes atop this file: one
  //    speaker per clip, seamless cuts from the prior clip's real last frame, no
  //    on-screen text, trailing silence trimmed.
  const clips: string[] = (resume.ckClips || []).filter((p) => p && fs.existsSync(p));
  let prevFrameUrl: string | undefined = resume.ckLastStill; // prior clip's last frame (relative /renders URL)
  const NO_TEXT = "Absolutely NO on-screen text of any kind: no subtitles, no captions, no titles, and no readable writing on any paper, document, folder, bulletin board, whiteboard, sign, poster or screen anywhere in the frame — keep every surface clean and text-free.";
  const HOLD_STILL = "The characters STAY in their positions — no standing up, sitting down, walking or crossing the room, only natural small gestures, head turns and talking. Keep every character's face, hair, hairstyle, clothing and wardrobe EXACTLY the same the whole time — no morphing, melting or changing of anyone's appearance.";
  // Keep both faces in the shot (continuity) WITHOUT forcing them into the same
  // space — the old "two-shot in the room" line overrode scenes that place the
  // characters apart (e.g. one inside, one outside a window), collapsing them
  // onto the same side. Honour the scene's own staging instead.
  const STAGING = "Frame it as a TWO-SHOT that keeps BOTH characters visible in the shot, but place each one EXACTLY where the scene describes: if they are apart — one indoors and one outdoors, on opposite sides of a window, door, wall or other barrier, or separated by glass — KEEP that separation with the barrier clearly between them; never merge them into the same space or onto the same side.";
  for (let i = clips.length; i < treatment.scenes.length; i++) {
    const scene = treatment.scenes[i];
    const turns = splitExchange(scene.caption || "");
    const speaker = turns.find((t) => t.speaker)?.speaker || "";
    const line = turns.map((t) => t.line).join(" ").replace(/\s+/g, " ").trim();

    // SEED. Clip N>0: the previous clip's EXACT last frame, fed straight to Veo, so
    // the cut is seamless (positions carried over — the two-shot keeps the next
    // speaker in frame, so no wrong-speaker gibberish). Clip 0 / fallback: a clean
    // two-shot generated from the cast reference.
    let seedAbs = abs(prevFrameUrl);
    if (!seedAbs) {
      const framed = `${scene.visual}. ${tmpl.sceneHint}. ${STAGING} ${castBible} ${NO_TEXT}`.replace(/\s+/g, " ").trim();
      let seedUrl: string | null = null;
      try { seedUrl = castRefAbs ? ((await renderStyledSeed(framed, castRefAbs, "9:16")) || (await renderCreativeSeed(framed, "9:16"))) : await renderCreativeSeed(framed, "9:16"); }
      catch { seedUrl = null; }
      seedAbs = abs(seedUrl);
    }
    if (!seedAbs) throw new Error(`[testmovie] scene ${i + 1}: no seed frame`);

    // Veo prompt: ONE speaker talks a full beat (clean single voice), the other
    // present and reacting; two-shot; voice pinned consistent; NO on-screen text.
    const voiceLine = speaker
      ? `ONLY ${speaker} speaks — a clear, natural, unhurried delivery with accurate lip-sync: "${line}". The other character stays silent, listening and reacting, not moving their lips. Keep ${speaker}'s voice natural and the SAME as in every other shot of the film.`
      : `One character speaks clearly and unhurried, lips in sync: "${line}". The other listens in silence.`;
    const prompt =
      `${scene.visual}. ${tmpl.sceneHint}. ${STAGING} ` +
      `${voiceLine} ${castBible} ${HOLD_STILL} ` +
      `Photorealistic live-action film, cinematic lighting, shallow depth of field, clean natural spoken-dialogue audio. ${NO_TEXT}`;

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
