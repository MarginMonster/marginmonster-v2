// TEST MOVIE — the dialogue experiment, kept SEPARATE from the main Film engine
// (film-engine.server.ts generateFilm is untouched) so the working pipeline is
// never at risk. Owner's spec: characters that actually SPEAK plot dialogue +
// scenes that FLOW, instead of a narrator talking over disconnected clips.
//
// Two ideas combined:
//   1. DIALOGUE — each scene is a Veo clip where the character speaks their line,
//      with Veo's native audio/lip-sync (generate_audio). The script writes real
//      character dialogue, not narration.
//   2. CHAINING (the owner's seamlessness idea) — the LAST FRAME of each clip
//      becomes the SEED for the next, so scene N continues scene N-1: same cast,
//      same room, continuous action. Sequential by necessity (so no parallel
//      speed-up here), which is the price of real flow.
//
// This is a TEST: short (2-6 beats), one continuous scene, fully chained. Cuts
// between beats + the full movie pipeline come after it proves out.
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
const VEO_POLL_MS = 8 * 60_000;
const FAL_VEO = "fal-ai/veo3.1/fast/image-to-video";
const REP_VEO = "google/veo-3-fast";

/** "NAME: the line" → { speaker, line }. */
function splitDialogue(caption: string): { speaker: string; line: string } {
  const c = (caption || "").trim();
  const m = c.match(/^([^:]{1,40}):\s*(.+)$/s);
  if (m) return { speaker: m[1].trim(), line: m[2].trim() };
  return { speaker: "", line: c };
}

/** A Veo clip where the character SPEAKS the line (audio on). fal veo3.1-fast →
 *  Replicate google/veo-3-fast fallback. Returns the clip URL. */
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

/** Concatenate the Veo clips, KEEPING their dialogue audio (unlike the main
 *  engine, which strips clip audio for a narrator/music bed). Degrade ladder:
 *  with audio → silent, so a clip that came back without an audio stream can't
 *  sink the whole render. */
async function assembleTestMovie(clips: string[], outPath: string, jobId?: string): Promise<void> {
  const N = clips.length;
  if (!N) throw new Error("[testmovie] no clips");
  const beat = async () => { if (jobId) await checkpointJob(jobId, { ckBeat: Date.now() }); };

  const buildArgs = (useAudio: boolean): string[] => {
    const a: string[] = ["-y"];
    clips.forEach((c) => a.push("-i", c));
    const f: string[] = [];
    clips.forEach((_, i) => {
      f.push(`[${i}:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30,setpts=PTS-STARTPTS[v${i}]`);
      if (useAudio) f.push(`[${i}:a]aresample=44100,asetpts=PTS-STARTPTS[a${i}]`);
    });
    if (useAudio) {
      const inter = clips.map((_, i) => `[v${i}][a${i}]`).join("");
      f.push(`${inter}concat=n=${N}:v=1:a=1[vc][ac]`);
      a.push("-filter_complex", f.join(";"), "-map", "[vc]", "-map", "[ac]");
    } else {
      const vlabels = clips.map((_, i) => `[v${i}]`).join("");
      f.push(`${vlabels}concat=n=${N}:v=1:a=0[vc]`);
      a.push("-filter_complex", f.join(";"), "-map", "[vc]");
    }
    a.push(
      "-threads", "2", "-filter_complex_threads", "2",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
      outPath,
    );
    return a;
  };

  const produced = (): boolean => { try { return fs.existsSync(outPath) && ffprobeDuration(outPath) > 1; } catch { return false; } };
  await beat();
  let lastErr = "";
  for (const useAudio of [true, false]) {
    const run = await runFfmpeg(buildArgs(useAudio));
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
  resume?: { ckTreatment?: string; ckCastRef?: string; ckClips?: string[]; ckLastFrame?: string };
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

  // 3) CHAINED Veo DIALOGUE clips (sequential — each seeds from the previous
  //    clip's last frame for continuity).
  const clips: string[] = (resume.ckClips || []).filter((p) => p && fs.existsSync(p));
  for (let i = clips.length; i < treatment.scenes.length; i++) {
    const scene = treatment.scenes[i];
    const { speaker, line } = splitDialogue(scene.caption || "");

    // SEED: a CLEAN still per beat, framing the SPEAKER, conditioned on the cast
    // reference for character + set consistency (shot/reverse-shot — how real
    // dialogue is shot). We deliberately do NOT seed from the previous clip's
    // video frame: that was the gibberish culprit — a motion-blurred frame of the
    // OTHER character made Veo mangle the new speaker's lip-sync/audio. A clean
    // still of the right speaker gives Veo a clear subject to voice.
    const framed = `${scene.visual}. ${tmpl.sceneHint}. ${speaker ? `${speaker} is the clear foreground subject, facing the other character.` : ""} ${castBible}`.replace(/\s+/g, " ").trim();
    let seedUrl: string | null = null;
    try { seedUrl = castRefAbs ? ((await renderStyledSeed(framed, castRefAbs, "9:16")) || (await renderCreativeSeed(framed, "9:16"))) : await renderCreativeSeed(framed, "9:16"); }
    catch { seedUrl = null; }
    const seedAbs = abs(seedUrl);
    if (!seedAbs) throw new Error(`[testmovie] scene ${i + 1}: no seed frame`);

    // Veo prompt: ONE speaker talks (the other listens in silence), lines clear,
    // and NO AI gibberish text on props/signs/screens.
    const prompt =
      `${scene.visual}. ${tmpl.sceneHint}. ` +
      (speaker
        ? `ONLY ${speaker} speaks — clearly, lips in sync, enunciating: "${line}". The other character listens in silence, not speaking or moving their lips.`
        : `One character speaks clearly, lips in sync: "${line}". The other listens silently.`) +
      ` Photorealistic live-action film, clean natural spoken-dialogue audio, shallow depth of field. No readable text, captions, signage or screen text anywhere in frame.`;

    const clipUrl = await veoDialogueClip(seedAbs, prompt, `testmovie-${i}`);
    const outPath = path.join(RENDERS(), `tm-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp4`);
    await download(clipUrl, outPath);
    if (!(fs.existsSync(outPath) && ffprobeDuration(outPath) > 1)) throw new Error(`[testmovie] scene ${i + 1}: clip did not download`);
    clips.push(outPath);
    await ckpt({ ckClips: clips });
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
