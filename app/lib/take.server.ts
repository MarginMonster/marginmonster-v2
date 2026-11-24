/* A TAKE, MADE — one continuous ten-second shot of found footage, start to Archive.
 *
 * What it is and why it is built the way it is: take.ts (the recipe) and camera-dress.ts (the camera it was
 * "shot on"). This file is the making:
 *
 *   1. THE TAKE'S PARTS  a ready-made scare, or the member's own idea written into the same five parts
 *                        (a writer that fails or half-answers falls back to the first ready-made one — a
 *                        take is never made from half a direction).
 *   2. THE FIRST FRAME   drawn by the creature recipe on the everyday picture model.
 *   3. THE TAKE          Kling 3 Omni, with its own sound: the same model the acted films use, on the same
 *                        host order (the owner picked fal's standard tier by ear — film-dialogue.server.ts).
 *   4. WHAT WAS SAID     heard by the listening model and kept on the piece: the engine speaks the
 *                        cameraman's lines itself, and nothing is ever laid over a take unheard.
 *   5. THE CAMERA        the take is dressed as a phone, a camcorder, or nothing (camera-dress.ts), at a
 *                        capped bit-rate — grain is incompressible, and an uncapped camcorder take was 130 MB.
 *   6. THE PIECE         a VIDEO_AD in the Archive, named for what it is.
 *
 * Every step after the take itself degrades instead of failing: not heard → kept unheard; a look that will
 * not render → the plain take is the piece. The ten seconds that cost money are never thrown away.
 *
 * NOT WIRED YET (2026-11-24): nothing queues this. It waits on the owner's name and price for the paid tier
 * ("Red Carpet" / "Premium Takes"), and on a place in the Movie Maker. */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { db } from "../db.server";
import { anthropicText } from "./anthropic.server";
import { cameraLookOf, dressFilter, type CameraLook } from "./camera-dress";
import { createWhisperx, wordsFromWhisperx } from "./faceless-video.server";
import { falEnabled, falVideoPoll, falVideoSubmit } from "./fal-video.server";
import { persistRemote, repRun } from "./image-generation.server";
import { mirrorRender } from "./object-storage.server";
import { overlayFonts } from "./overlay-fonts.server";
import { TAKE_IDEAS, TAKE_SECONDS, parseTake, takeIdea, takePrompt, takeStillPrompt, takeWriterBrief, type Take } from "./take";
import { checkpointJob, repCreate, repPoll } from "./ugc-ad-pipeline.server";

// (the same model, three hosts — the ids and the order are film-dialogue.server.ts's own)
const FAL_OMNI_STD = "fal-ai/kling-video/o3/standard/image-to-video";
const FAL_OMNI = "fal-ai/kling-video/o3/pro/image-to-video";
const REP_OMNI = "kwaivgi/kling-v3-omni-video";
const TAKE_POLL_MS = 14 * 60_000;

const renders = () => path.join(process.cwd(), "data", "renders");
const stamp = () => `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;

function run(cmd: string, args: string[], maxMs = 180_000): Promise<{ code: number; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err = (err + String(d)).slice(-2000); });
    const timer = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* gone */ } }, maxMs);
    p.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, err }); });
    p.on("error", (e) => { clearTimeout(timer); resolve({ code: 1, err: String(e) }); });
  });
}

/** The take itself: fal's standard tier first (what the acted films render on), then the same model
 *  elsewhere. A refused or failed render is not billed, so falling through never pays twice. */
async function rollTake(stillAbs: string, prompt: string): Promise<{ url: string; host: string }> {
  const order: Array<{ host: string; fal: boolean; go: () => Promise<string> }> = [
    { host: "fal kling 3 omni standard", fal: true, go: async () => falVideoPoll(FAL_OMNI_STD, await falVideoSubmit(FAL_OMNI_STD, { startImage: stillAbs, prompt, generateAudio: true, durationSec: TAKE_SECONDS }), TAKE_POLL_MS) },
    { host: "fal kling 3 omni", fal: true, go: async () => falVideoPoll(FAL_OMNI, await falVideoSubmit(FAL_OMNI, { startImage: stillAbs, prompt, generateAudio: true, durationSec: TAKE_SECONDS }), TAKE_POLL_MS) },
    { host: "replicate kling 3 omni", fal: false, go: async () => repPoll(await repCreate(REP_OMNI, { prompt, start_image: stillAbs, generate_audio: true, duration: TAKE_SECONDS, mode: "pro" }), TAKE_POLL_MS, "take") },
  ];
  let last = "no host";
  for (const h of order) {
    if (h.fal && !falEnabled()) continue;
    if (!h.fal && !process.env.REPLICATE_API_TOKEN) continue;
    try { return { url: await h.go(), host: h.host }; }
    catch (e) { last = `${h.host}: ${e instanceof Error ? e.message.slice(0, 160) : e}`; console.error(`[take] ${last}`); }
  }
  throw new Error(`[take] the take could not be rolled — ${last}`);
}

/** What is said in the take, as lines with their times — or null when it could not be heard. */
async function heard(base: string, fileName: string): Promise<Array<{ at: number; text: string }> | null> {
  if (!base || !process.env.REPLICATE_API_TOKEN) return null;
  try {
    const words = wordsFromWhisperx(await repPoll(await createWhisperx(`${base}/renders/${fileName}`, "en"), 60_000, "take-words")) as Array<{ start: number; end: number; word?: string; text?: string }>;
    const lines: Array<{ at: number; text: string }> = [];
    let prevEnd = -9;
    for (const w of words) {
      const t = String(w.word ?? w.text ?? "").trim();
      if (!t) continue;
      if (lines.length && w.start - prevEnd < 0.7) lines[lines.length - 1].text += ` ${t}`;
      else lines.push({ at: Math.round(w.start * 10) / 10, text: t });
      prevEnd = w.end;
    }
    return lines.slice(0, 12);
  } catch (e) {
    console.error(`[take] not heard: ${e instanceof Error ? e.message.slice(0, 140) : e}`);
    return null;
  }
}

/** The take dressed as its camera, beside the raw one. Null when the look would not render — the caller
 *  then ships the plain take. */
async function dress(rawPath: string, look: CameraLook, w: number, h: number): Promise<string | null> {
  try {
    const fonts = await overlayFonts(8_000);
    const d = dressFilter({ look, w, h, font: fonts.font, fontThin: fonts.thin, fontMono: fonts.mono });
    const dir = renders(), id = stamp();
    const inputs = ["-i", rawPath];
    if (d.chrome) {
      const cs = path.join(dir, `take-${id}-chrome.txt`), png = path.join(dir, `take-${id}-chrome.png`);
      fs.writeFileSync(cs, d.chrome);
      const c = await run("ffmpeg", ["-v", "error", "-y", "-filter_complex_script", cs, "-map", "[c]", "-frames:v", "1", png], 60_000);
      fs.rmSync(cs, { force: true });
      if (c.code !== 0) throw new Error(`chrome: ${c.err.slice(-200)}`);
      inputs.push("-i", png);
    }
    const script = path.join(dir, `take-${id}-graph.txt`), out = path.join(dir, `take-${id}.mp4`);
    fs.writeFileSync(script, d.filter);
    const r = await run("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex_script", script, "-map", "[v]", "-map", "0:a?", ...(d.audio ? ["-af", d.audio] : []),
      "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-maxrate", "7M", "-bufsize", "14M", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out], 240_000);
    fs.rmSync(script, { force: true });
    for (const f of fs.readdirSync(dir)) if (f.startsWith(`take-${id}-chrome`)) fs.rmSync(path.join(dir, f), { force: true });
    if (r.code !== 0 || !fs.existsSync(out) || fs.statSync(out).size < 50_000) throw new Error(r.err.slice(-240) || "no file");
    return out;
  } catch (e) {
    console.error(`[take] the ${look} look did not render — shipping the plain take: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
    return null;
  }
}

export type TakeOptions = {
  shopId: string;
  /** a ready-made scare (take.ts → TAKE_IDEAS)… */
  ideaKey?: string;
  /** …or the member's own idea, in a line */
  idea?: string;
  camera?: string;
  aspect?: string;
  section?: string;
  jobId?: string;
  resume?: { ckTake?: string; ckStill?: string; ckRaw?: string };
};

/** Make one take. Returns the new piece's id. */
export async function generateTake(opts: TakeOptions): Promise<string> {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const camera: CameraLook = cameraLookOf(opts.camera) || "phone";
  const aspect: "9:16" | "16:9" = opts.aspect === "16:9" ? "16:9" : "9:16";
  const resume = opts.resume || {};
  const ckpt = async (patch: Record<string, unknown>) => { if (opts.jobId) await checkpointJob(opts.jobId, patch); };

  // 1) the take's parts
  let take: Take & { title: string; key?: string };
  const ready = takeIdea(opts.ideaKey);
  if (resume.ckTake) take = JSON.parse(resume.ckTake);
  else if (ready) take = { ...ready, title: ready.name };
  else {
    let written: (Take & { title: string }) | null = null;
    try {
      written = parseTake(await anthropicText(takeWriterBrief(opts.idea || ""), {
        maxTokens: 1200,
        jsonSchema: { name: "take", schema: { type: "object", additionalProperties: false, required: ["title", "who", "still", "beats", "says", "sound"], properties: { title: { type: "string" }, who: { type: "string" }, still: { type: "string" }, beats: { type: "array", items: { type: "string" } }, says: { type: "array", items: { type: "string" } }, sound: { type: "string" } } } },
      }));
    } catch (e) { console.error(`[take] the writer did not answer — a ready-made scare is used: ${e instanceof Error ? e.message.slice(0, 140) : e}`); }
    take = written || { ...TAKE_IDEAS[0], title: TAKE_IDEAS[0].name };
  }
  await ckpt({ ckTake: JSON.stringify(take) });

  // 2) the first frame
  let still = resume.ckStill || "";
  if (!still) {
    still = await persistRemote(await repRun("google/nano-banana", { prompt: takeStillPrompt(take, aspect), aspect_ratio: aspect, output_format: "jpg" }), "jpg");
    await ckpt({ ckStill: still });
  }

  // 3) the take (the ten seconds that cost money: kept on the disk the moment they exist)
  const dir = renders();
  fs.mkdirSync(dir, { recursive: true });
  let rawName = resume.ckRaw && fs.existsSync(path.join(dir, resume.ckRaw)) ? resume.ckRaw : "";
  let host = "";
  const direction = takePrompt(take, camera);
  if (!rawName) {
    const rolled = await rollTake(`${base}${still}`, direction);
    host = rolled.host;
    const res = await fetch(rolled.url);
    if (!res.ok) throw new Error(`[take] the take could not be fetched: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100_000) throw new Error("[take] the take came back empty");
    rawName = `takeraw-${stamp()}.mp4`;
    fs.writeFileSync(path.join(dir, rawName), buf);
    try { await mirrorRender(rawName, buf); } catch { /* the disk copy is what is used */ }
    await ckpt({ ckRaw: rawName });
  }
  const rawPath = path.join(dir, rawName);

  // 4) what was said
  const said = await heard(base, rawName);

  // 5) the camera
  const size = aspect === "16:9" ? { w: 1280, h: 720 } : { w: 720, h: 1280 };
  const dressed = await dress(rawPath, camera, size.w, size.h);
  const outPath = dressed || rawPath;
  const outName = path.basename(outPath);
  if (dressed) { try { await mirrorRender(outName, fs.readFileSync(outPath)); } catch { /* non-fatal */ } }

  // 6) the piece
  const asset = await db.asset.create({
    data: {
      shopId: opts.shopId,
      type: "VIDEO_AD",
      status: "PENDING",
      title: `Found Footage — ${String(take.title || "a take").slice(0, 60)}`,
      bodyJson: JSON.stringify({ style: "TAKE", videoUrl: `/renders/${outName}`, prompt: opts.idea || take.title || "", script: take.says.filter(Boolean).join(" … ") }),
      metaJson: JSON.stringify({
        kind: "take", template: "foundfootage", section: opts.section || "creator", aspect, seconds: TAKE_SECONDS,
        // what it was made from, so a take can be looked into (and rolled again) later
        take: { ...(take.key ? { idea: take.key } : {}), camera, dressed: !!dressed, host, still, raw: `/renders/${rawName}`, direction: direction.slice(0, 2400) },
        // what the listening model heard in it (null = it could not be heard)
        heard: said,
      }),
    },
  });
  return asset.id;
}
