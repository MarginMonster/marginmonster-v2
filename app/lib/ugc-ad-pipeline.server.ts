/* Zeely-class UGC ad pipeline. A "UGC ad" is an assembled performance, not a
 * raw video generation:
 *   1. SCRIPT  — Claude writes a ~13s hook-driven spoken script (AIDA/PAS) in
 *                the brand's voice
 *   2. VOICE   — minimax speech-02-turbo reads it (voice matched to presenter)
 *   3. TALKING — bytedance/omni-human: cast portrait + audio → lip-synced
 *                presenter performance ($0.14/s, ≤15s sweet spot)
 *   4. ASSEMBLY— ffmpeg: vertical 720x1280 canvas, product b-roll cut-in,
 *                bold burned-in captions (UGC style)
 * Total COGS ≈ $2-3 per finished ad. Output saved to data/renders and served
 * via the /renders/:file resource route. */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { db } from "../db.server";
import { anthropicText } from "./anthropic.server";
import { AVATAR_BY_ID, OUTFITS } from "./avatars";
import type { BrandProfile } from "@prisma/client";

/** Merge stage checkpoints into the job payload (kept local to avoid a
 *  circular import with job-queue.server). Never fatal. */
async function checkpointJob(jobId: string, patch: Record<string, unknown>): Promise<void> {
  try {
    const job = await db.job.findUnique({ where: { id: jobId } });
    if (!job) return;
    const payload = { ...JSON.parse(job.payload || "{}"), ...patch };
    await db.job.update({ where: { id: jobId }, data: { payload: JSON.stringify(payload) } });
  } catch (e) {
    console.error("[ugc] checkpoint failed (non-fatal):", e);
  }
}

const REP = "https://api.replicate.com/v1";

interface UgcAdParams {
  shopId: string;
  brandProfile: BrandProfile;
  productTitle: string;
  productDescription?: string;
  productImageUrl?: string;
  avatarId: string;
  avatarVariant?: number;
  direction?: string; // merchant's custom prompt
  jobId?: string; // enables stage checkpointing
  resume?: {
    // stage checkpoints from a previous interrupted attempt — restarts must
    // NEVER re-spend on completed stages or abandon a live omni prediction
    script?: string;
    audioUrl?: string;
    omniPredictionId?: string;
    talkingUrl?: string;
  };
}

/* ---------- Replicate helpers (model endpoint, 429-tolerant) ---------- */

function repToken(): string {
  const t = process.env.REPLICATE_API_TOKEN;
  if (!t) throw new Error("[ugc] REPLICATE_API_TOKEN not set");
  return t;
}

async function repCreate(model: string, input: Record<string, unknown>): Promise<string> {
  for (let a = 0; a < 12; a++) {
    const res = await fetch(`${REP}/models/${model}/predictions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${repToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });
    if (res.status === 429) {
      const j = (await res.json().catch(() => ({}))) as { retry_after?: number };
      await new Promise((r) => setTimeout(r, (j.retry_after || 12) * 1000 + 1500));
      continue;
    }
    if (!res.ok) throw new Error(`[ugc] ${model} create ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { id: string };
    return j.id;
  }
  throw new Error(`[ugc] ${model}: rate-limited too long`);
}

async function repPoll(id: string, maxMs: number, stage: string): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 4000));
    const res = await fetch(`${REP}/predictions/${id}`, {
      headers: { Authorization: `Bearer ${repToken()}` },
    });
    const j = (await res.json()) as { status: string; output?: string | string[]; error?: string };
    if (j.status === "succeeded" && j.output) {
      return Array.isArray(j.output) ? j.output[0] : j.output;
    }
    if (j.status === "failed" || j.status === "canceled") {
      throw new Error(`[ugc:${stage}] ${j.error || j.status}`);
    }
  }
  throw new Error(`[ugc:${stage}] timed out after ${Math.round(maxMs / 1000)}s`);
}

async function download(url: string, file: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[ugc] download ${res.status} for ${file}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[ugc] download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/* ---------- Voice casting ---------- */

function pickVoice(desc: string): string {
  // Only ids documented in the model schema — guaranteed valid. Expand later.
  return /\b(woman|girl|lady|abuela|grandma|mom)\b/i.test(desc)
    ? "English_Wiselady"
    : "English_Deep-VoicedGentleman";
}

/* ---------- Caption + assembly helpers ---------- */

/** Prefer the system ffmpeg (Docker image ships Debian's full build — the npm
 *  static Linux binary is missing drawtext, which broke captioning in prod). */
function ffmpegBin(): string {
  for (const p of ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", path.join(process.cwd(), "bin", "ffmpeg")]) {
    if (fs.existsSync(p)) return p;
  }
  if (!ffmpegPath) throw new Error("[ugc:assemble] no ffmpeg binary available");
  return ffmpegPath as unknown as string;
}
function ffprobeBin(): string {
  for (const p of ["/usr/bin/ffprobe", "/usr/local/bin/ffprobe", path.join(process.cwd(), "bin", "ffprobe")]) {
    if (fs.existsSync(p)) return p;
  }
  return (ffprobeStatic as unknown as { path: string }).path;
}

function ffprobeDuration(file: string): number {
  const out = spawnSync(ffprobeBin(), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], {
    encoding: "utf8",
  });
  const d = parseFloat((out.stdout || "").trim());
  if (!d || Number.isNaN(d)) throw new Error(`[ugc:assemble] couldn't probe duration (${out.stderr?.slice(0, 120)})`);
  return d;
}

/** Caption-safe text: bold UGC style is ALL CAPS; strip anything that fights
 *  drawtext's escaping rules. */
function captionSafe(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9 .!?$-]/g, "").replace(/\s+/g, " ").trim();
}

function buildCaptionFilters(script: string, duration: number, fontFile: string): string[] {
  const words = captionSafe(script).split(" ").filter(Boolean);
  if (!words.length) return [];
  // 3-word chunks: fits 720px at this size, and short bursts read more "UGC"
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 3) chunks.push(words.slice(i, i + 3).join(" "));
  const capped = chunks.slice(0, 16);
  const per = duration / capped.length;
  // fontfile path needs forward slashes + escaped colon for the filter parser
  const font = fontFile.replace(/\\/g, "/").replace(/:/g, "\\:");
  return capped.map((text, i) => {
    const t0 = (i * per).toFixed(2);
    const t1 = ((i + 1) * per).toFixed(2);
    // gte*lt (not between) — between is inclusive on both ends, which
    // double-draws two captions on the shared boundary frame
    return (
      `drawtext=fontfile='${font}':text='${text}':fontsize=50:fontcolor=white:` +
      `borderw=7:bordercolor=black:x=(w-text_w)/2:y=h-330:enable='gte(t,${t0})*lt(t,${t1})'`
    );
  });
}

function assemble(opts: {
  talkingPath: string;
  audioPath: string;
  productImagePath: string | null;
  script: string;
  outPath: string;
  /** true = the talking video already carries lip-synced audio (omni-human):
   *  keep its OWN audio, DON'T loop or re-mux — that's what was breaking sync.
   *  false = silent/generic motion (kling fallback): loop the clip and lay our
   *  TTS narration over it. */
  lipSynced: boolean;
}): void {
  const fontFile = path.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");
  // The performance defines the ad when it's lip-synced (never trim/loop the
  // synced clip); the narration defines it only for the silent fallback.
  const duration = opts.lipSynced ? ffprobeDuration(opts.talkingPath) : ffprobeDuration(opts.audioPath);

  const args: string[] = ["-y"];
  if (!opts.lipSynced) args.push("-stream_loop", "-1"); // loop only the silent clip
  args.push("-i", opts.talkingPath);
  if (!opts.lipSynced) args.push("-i", opts.audioPath); // external narration only for fallback
  const audioInputIndex = opts.lipSynced ? 0 : 1; // omni: video's own audio; kling: the mp3

  const filters: string[] = [];
  let vLabel = "[v0]";
  filters.push(`[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=30[v0]`);

  if (opts.productImagePath) {
    // b-roll product image = the next input. Lip-synced has [0]=video only, so
    // it's input 1; fallback has [0]=video [1]=audio, so it's input 2.
    const brIdx = opts.lipSynced ? 1 : 2;
    args.push("-loop", "1", "-framerate", "30", "-t", String(Math.ceil(duration)), "-i", opts.productImagePath);
    // during a lip-synced clip keep the cutaway short (hides the mouth briefly —
    // reads as an intentional UGC cut, not a glitch)
    const cutLen = opts.lipSynced ? 1.6 : 2.2;
    const bs = Math.max(1.2, duration * 0.5).toFixed(2);
    const be = Math.min(duration - 0.8, duration * 0.5 + cutLen).toFixed(2);
    filters.push(`[${brIdx}:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280[br]`);
    filters.push(`[v0][br]overlay=enable='between(t,${bs},${be})'[v1]`);
    vLabel = "[v1]";
  }

  const captions = buildCaptionFilters(opts.script, duration, fontFile);
  if (captions.length) {
    filters.push(`${vLabel}${captions.join(",")}[vf]`);
    vLabel = "[vf]";
  }

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", vLabel, "-map", `${audioInputIndex}:a`,
    "-t", duration.toFixed(2),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
    opts.outPath
  );

  const run = spawnSync(ffmpegBin(), args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (run.status !== 0 || !fs.existsSync(opts.outPath)) {
    throw new Error(`[ugc:assemble] ffmpeg failed: ${(run.stderr || "").slice(-400)}`);
  }
}

/* ---------- The pipeline ---------- */

/** Portrait file that actually exists on this deploy — wardrobe variant first,
 *  then that avatar's default, then the legacy flat portrait. Returned as a
 *  local path so we can send inline bytes (no cross-provider URL fetching to
 *  flake out on). */
function resolvePortraitFile(id: string, variant: number): string {
  const dir = path.join(process.cwd(), "public", "avatars");
  for (const candidate of [`${id}_${variant}.jpg`, `${id}_0.jpg`, `${id}.jpg`]) {
    const p = path.join(dir, candidate);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`[ugc] no portrait on disk for presenter "${id}"`);
}

export async function generateUgcAd(params: UgcAdParams): Promise<string> {
  const avatar = AVATAR_BY_ID[params.avatarId];
  if (!avatar) throw new Error(`[ugc] unknown avatar ${params.avatarId}`);
  const variant = Math.max(0, Math.min(OUTFITS.length - 1, params.avatarVariant ?? 0));
  // inline bytes: omni-human never has to fetch our server or another
  // provider's expiring URL (both have flaked in production)
  const portraitDataUri =
    "data:image/jpeg;base64," + fs.readFileSync(resolvePortraitFile(avatar.id, variant)).toString("base64");

  const voiceJson = JSON.parse(params.brandProfile.voiceJson || "{}");

  // 1) SCRIPT — hook-first, ~13s spoken
  const scriptPrompt = [
    `You write spoken scripts for short-form UGC video ads (TikTok/Reels/Shorts).`,
    `Presenter: ${avatar.name}, ${avatar.desc}.`,
    `Product: "${params.productTitle}".`,
    params.productDescription ? `Product details: ${params.productDescription.slice(0, 300)}` : "",
    voiceJson.tone ? `Brand voice/tone: ${voiceJson.tone}.` : "",
    params.direction ? `Merchant direction (follow it): ${params.direction}` : "",
    ``,
    `Rules: The FIRST sentence must be a scroll-stopping hook. Use PAS or AIDA.`,
    `30 to 40 words TOTAL (about 13 seconds spoken). Conversational, first person,`,
    `like recommending to a friend. End with a short call to action.`,
    `Output ONLY the spoken words — no stage directions, quotes, emoji, or hashtags.`,
  ]
    .filter(Boolean)
    .join("\n");

  const resume = params.resume || {};
  const ckpt = (patch: Record<string, unknown>) =>
    params.jobId ? checkpointJob(params.jobId, patch) : Promise.resolve();

  let script = resume.script || "";
  if (!script) {
    script = ((await anthropicText(scriptPrompt, { model: "claude-sonnet-5", maxTokens: 200 })) || "")
      .replace(/["“”\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!script) throw new Error("[ugc:script] empty script from model");
    const w = script.split(" ");
    if (w.length > 45) script = w.slice(0, 45).join(" ");
    await ckpt({ ckScript: script });
  }

  // 2) VOICE — TTS is 3s/$0.001, so regenerating on a dead resume URL is fine.
  // We always end up with the audio BYTES (validated), sent inline downstream.
  const freshTts = async (): Promise<string> => {
    const ttsId = await repCreate("minimax/speech-02-turbo", {
      text: script,
      voice_id: pickVoice(avatar.desc),
    });
    return repPoll(ttsId, 3 * 60_000, "tts");
  };
  let audioBuf: Buffer | null = null;
  if (resume.audioUrl) {
    try { audioBuf = await downloadBuffer(resume.audioUrl); } catch { audioBuf = null; }
  }
  if (!audioBuf || audioBuf.length < 10_000) {
    const audioUrl = await freshTts();
    await ckpt({ ckAudioUrl: audioUrl });
    audioBuf = await downloadBuffer(audioUrl);
  }
  if (audioBuf.length < 10_000) throw new Error("[ugc:tts] audio came back empty");
  const audioDataUri = "data:audio/mpeg;base64," + audioBuf.toString("base64");

  // 3) TALKING PERFORMANCE — on resume, re-attach to the SAME prediction
  // instead of paying for a duplicate render; transient provider failures
  // ("Failed to upload…") get one cheap in-attempt retry with a new prediction
  let talkingUrl = resume.talkingUrl || "";
  let engine = "omni-human";
  if (!talkingUrl) {
    if (resume.omniPredictionId) {
      try {
        talkingUrl = await repPoll(resume.omniPredictionId, 12 * 60_000, "omni-human(resumed)");
      } catch { /* old prediction died — fall through to a fresh one */ }
    }
    for (let attempt = 0; attempt < 2 && !talkingUrl; attempt++) {
      try {
        const omniId = await repCreate("bytedance/omni-human", { image: portraitDataUri, audio: audioDataUri });
        await ckpt({ ckOmniId: omniId });
        talkingUrl = await repPoll(omniId, 12 * 60_000, "omni-human");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[ugc] omni-human attempt ${attempt + 1} failed: ${msg.slice(0, 200)}`);
        if (attempt === 0 && /upload|internal|signature|timestamp|try (running|again)|temporar|E\d{3,}/i.test(msg)) {
          await new Promise((r) => setTimeout(r, 5000));
          continue; // transient provider-side flakes get one immediate retry
        }
        break; // hard failure → fall back to Kling below
      }
    }
    // FALLBACK: Kling voiceover-style — the presenter moves naturally to camera
    // while the TTS narration carries the ad. Not lip-synced, but a legitimate
    // UGC format, and Kling has been rock-solid on this account.
    if (!talkingUrl) {
      console.log("[ugc] falling back to kling voiceover style");
      engine = "kling-voiceover";
      const klingId = await repCreate("kwaivgi/kling-v1.6-standard", {
        start_image: portraitDataUri,
        prompt: `${avatar.desc}, talking directly to the camera with natural hand gestures and subtle head movement, enthusiastic friendly energy, static camera, plain studio background, vertical video`,
        negative_prompt: "camera movement, zoom, pan, morphing, distortion, extra people, text, watermark",
        duration: 10,
        cfg_scale: 0.5,
      });
      await ckpt({ ckOmniId: klingId });
      talkingUrl = await repPoll(klingId, 12 * 60_000, "kling-fallback");
    }
    await ckpt({ ckTalkingUrl: talkingUrl });
  }

  // 4) ASSEMBLY
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ugc-"));
  try {
    const talkingPath = path.join(tmp, "talking.mp4");
    await download(talkingUrl, talkingPath);
    const audioPath = path.join(tmp, "voice.mp3");
    fs.writeFileSync(audioPath, audioBuf);

    let productImagePath: string | null = null;
    if (params.productImageUrl) {
      try {
        productImagePath = path.join(tmp, "product.img");
        await download(params.productImageUrl, productImagePath);
      } catch {
        productImagePath = null; // b-roll is a bonus, never a blocker
      }
    }

    const rendersDir = path.join(process.cwd(), "data", "renders");
    fs.mkdirSync(rendersDir, { recursive: true });
    const fileName = `ugc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
    const outPath = path.join(rendersDir, fileName);

    assemble({ talkingPath, audioPath, productImagePath, script, outPath, lipSynced: engine === "omni-human" });

    const asset = await db.asset.create({
      data: {
        shopId: params.shopId,
        type: "VIDEO_AD",
        status: "PENDING",
        title: `${avatar.name} presents — ${params.productTitle}`,
        bodyJson: JSON.stringify({
          style: "AI_AVATAR",
          engine,
          videoUrl: `/renders/${fileName}`,
          prompt: script,
          script,
        }),
        metaJson: JSON.stringify({
          style: "AI_AVATAR",
          productTitle: params.productTitle,
          avatarId: avatar.id,
          avatarVariant: variant,
          direction: params.direction || null,
        }),
      },
    });
    return asset.id;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* tmp cleanup best-effort */ }
  }
}
