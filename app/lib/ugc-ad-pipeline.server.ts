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
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn, spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { db } from "../db.server";
import { anthropicText } from "./anthropic.server";
import { animateAvatar, falEnabled } from "./fal-video.server";
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
  captions?: boolean; // burn in on-screen captions (default true)
  origin?: string; // provenance label ("⚔ QUEST · FIRST BLOOD" / "🎬 BY DANIEL")
  jobId?: string; // enables stage checkpointing
  // Product-in-hand: an already-approved composed frame (Studio flow), or a
  // flag to auto-compose one in-pipeline (campaign drips — hands-off). Compose
  // failure NEVER blocks a render; it just falls back to the plain portrait.
  composedFrameUrl?: string;
  holdProduct?: boolean;
  resume?: {
    // stage checkpoints from a previous interrupted attempt — restarts must
    // NEVER re-spend on completed stages or abandon a live omni prediction
    script?: string;
    audioUrl?: string;
    composedUrl?: string;
    omniPredictionId?: string;
    talkingUrl?: string;
    engine?: string;
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

/* STREAM to disk — never buffer whole videos in memory. Render starter has a
 * 512MB ceiling; arrayBuffer()-ing a big clip mid-render was OOM-killing the
 * instance (crash → worker retry → crash loop). */
async function download(url: string, file: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`[ugc] download ${res.status} for ${file}`);
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), fs.createWriteStream(file));
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[ugc] download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/* ---------- Voice casting ---------- */

// Verified-working MiniMax speech-02 system voices (each render-tested), now
// TAGGED with the age band + character each one reads as — so the picked voice
// FITS the avatar's face and vibe, not just their gender. Keeps a stable
// per-avatar pick (same presenter → same voice across all their videos).
type VoiceTag = { id: string; gender: "f" | "m"; age: "young" | "mid" | "mature"; energy: "hype" | "warm" | "calm" };
const VOICES: VoiceTag[] = [
  // female
  { id: "English_PlayfulGirl", gender: "f", age: "young", energy: "hype" },
  { id: "English_UpsetGirl", gender: "f", age: "young", energy: "hype" },
  { id: "English_Kind-heartedGirl", gender: "f", age: "young", energy: "warm" },
  { id: "English_Soft-spokenGirl", gender: "f", age: "young", energy: "calm" },
  { id: "English_Whispering_girl", gender: "f", age: "young", energy: "calm" },
  { id: "English_ConfidentWoman", gender: "f", age: "mid", energy: "hype" },
  { id: "English_FriendlyPerson", gender: "f", age: "mid", energy: "warm" },
  { id: "English_captivating_female1", gender: "f", age: "mid", energy: "warm" },
  { id: "English_CalmWoman", gender: "f", age: "mid", energy: "calm" },
  { id: "English_SereneWoman", gender: "f", age: "mid", energy: "calm" },
  { id: "English_Wiselady", gender: "f", age: "mature", energy: "warm" },
  { id: "English_Graceful_Lady", gender: "f", age: "mature", energy: "calm" },
  // male
  { id: "English_Comedian", gender: "m", age: "young", energy: "hype" },
  { id: "English_ReservedYoungMan", gender: "m", age: "young", energy: "calm" },
  { id: "English_Aussie_Bloke", gender: "m", age: "mid", energy: "hype" },
  { id: "English_magnetic_voiced_man", gender: "m", age: "mid", energy: "hype" },
  { id: "English_Trustworth_Man", gender: "m", age: "mid", energy: "warm" },
  { id: "English_Diligent_Man", gender: "m", age: "mid", energy: "warm" },
  { id: "English_PatientMan", gender: "m", age: "mid", energy: "calm" },
  { id: "English_Gentle-voiced_man", gender: "m", age: "mid", energy: "calm" },
  { id: "English_MaturePartner", gender: "m", age: "mature", energy: "warm" },
  { id: "English_Deep-VoicedGentleman", gender: "m", age: "mature", energy: "calm" },
  { id: "English_ManWithDeepVoice", gender: "m", age: "mature", energy: "calm" },
];

function hashId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  return h;
}

const AGE_ORDER: Record<string, number> = { young: 0, mid: 1, mature: 2 };

/** Hand-tuned pins — when a presenter's scored voice doesn't sit right on the
 *  ear, pin the exact voice here and it wins over the scorer. Curate from
 *  real takes (each take records bodyJson.voiceId; /api/diag?mode=voices
 *  shows the full assignment table). */
const VOICE_OVERRIDES: Record<string, string> = {
  // e.g. maya: "English_PlayfulGirl",
};

/** Pick the best-fitting voice for an avatar's gender + age + energy. Scores
 *  every same-gender voice (exact age = big win, adjacent age = partial;
 *  matching energy = win) and takes the top; a stable per-avatar hash breaks
 *  ties so the same presenter always sounds the same. */
export function pickVoice(avatar: { id: string; gender: "f" | "m"; ageBand: "young" | "mid" | "mature"; energy: "hype" | "warm" | "calm" }): string {
  if (VOICE_OVERRIDES[avatar.id]) return VOICE_OVERRIDES[avatar.id];
  const h = hashId(avatar.id);
  const pool = VOICES.filter((v) => v.gender === avatar.gender);
  const scored = pool.map((v, i) => {
    const ageGap = Math.abs(AGE_ORDER[v.age] - AGE_ORDER[avatar.ageBand]);
    const ageScore = ageGap === 0 ? 4 : ageGap === 1 ? 2 : 0;
    const energyScore = v.energy === avatar.energy ? 3 : v.energy === "warm" || avatar.energy === "warm" ? 1 : 0;
    // deterministic jitter so equally-good voices still spread across avatars
    const jitter = ((h + i * 2654435761) % 1000) / 1000;
    return { id: v.id, score: ageScore + energyScore + jitter };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.id || "English_FriendlyPerson";
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

/** ffmpeg runs ASYNC (spawn, not spawnSync) — spawnSync froze the whole Node
 *  process for the entire encode, so Render's 5s health checks timed out
 *  mid-render and the platform killed the instance ("app crashed" with no
 *  deploy). 1080p encodes are long enough to guarantee it. */
function runFfmpeg(args: string[]): Promise<{ status: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegBin(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (c: Buffer) => {
      err += c.toString();
      if (err.length > 65536) err = err.slice(-32768); // keep the tail
    });
    p.on("error", reject);
    p.on("close", (code) => resolve({ status: code ?? -1, stderr: err }));
  });
}

async function assemble(opts: {
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
}): Promise<void> {
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
    // -threads 2: x264 memory scales with thread count, and containers report
    // the HOST's cores (16+ on Render) — uncapped, the encode alone can blow
    // the 512MB instance. 2 threads keeps a 15s 720x1280 encode well inside it.
    "-threads", "2", "-filter_complex_threads", "2",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
    opts.outPath
  );

  const run = await runFfmpeg(args);
  if (run.status !== 0 || !fs.existsSync(opts.outPath)) {
    throw new Error(`[ugc:assemble] ffmpeg failed: ${(run.stderr || "").slice(-400)}`);
  }
}

/* ---------- The pipeline ---------- */

/** Portrait file that actually exists on this deploy — wardrobe variant first,
 *  then that avatar's default, then the legacy flat portrait. Returned as a
 *  local path so we can send inline bytes (no cross-provider URL fetching to
 *  flake out on). */
export function resolvePortraitFile(id: string, variant: number): string {
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
  const portraitFile = resolvePortraitFile(avatar.id, variant);
  // inline bytes: omni-human never has to fetch our server or another
  // provider's expiring URL (both have flaked in production)
  const portraitDataUri =
    "data:image/jpeg;base64," + fs.readFileSync(portraitFile).toString("base64");
  // hosted URL for partner-routed engines: fal forwards to HeyGen's servers,
  // which fetch inputs by URL — data URIs get rejected there
  const portraitPublicUrl = process.env.SHOPIFY_APP_URL
    ? `${process.env.SHOPIFY_APP_URL.replace(/\/$/, "")}/avatars/${path.basename(portraitFile)}`
    : "";

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
      voice_id: pickVoice(avatar),
    });
    return repPoll(ttsId, 3 * 60_000, "tts");
  };
  let audioBuf: Buffer | null = null;
  let audioHostedUrl = resume.audioUrl || ""; // hosted mp3 (Replicate CDN) — what fal/HeyGen fetches
  if (resume.audioUrl) {
    try { audioBuf = await downloadBuffer(resume.audioUrl); } catch { audioBuf = null; }
  }
  if (!audioBuf || audioBuf.length < 10_000) {
    audioHostedUrl = await freshTts();
    await ckpt({ ckAudioUrl: audioHostedUrl });
    audioBuf = await downloadBuffer(audioHostedUrl);
  }
  if (audioBuf.length < 10_000) throw new Error("[ugc:tts] audio came back empty");
  const audioDataUri = "data:audio/mpeg;base64," + audioBuf.toString("base64");

  // 3) TALKING PERFORMANCE — on resume, re-attach to the SAME prediction
  // instead of paying for a duplicate render; transient provider failures
  // ("Failed to upload…") get one cheap in-attempt retry with a new prediction
  // 2.5) PRODUCT-IN-HAND FRAME — the animation source decides the scene, so a
  // composed "presenter holding the product" frame makes the whole ad an
  // in-hand demo. Studio passes an approved frame; campaign drips auto-compose
  // (checkpointed — restarts never re-spend). Failure → plain portrait.
  let heldProduct = false;
  let animSourceUrl = portraitPublicUrl; // what HeyGen fetches
  let animSourceDataUri = portraitDataUri; // what omni/kling get inline
  {
    let composedUrl = params.composedFrameUrl || resume.composedUrl || "";
    if (!composedUrl && params.holdProduct && params.productImageUrl && portraitPublicUrl) {
      try {
        const { composeHoldingFrames } = await import("./fal-image.server");
        const frames = await composeHoldingFrames(portraitPublicUrl, params.productImageUrl, params.productTitle, 1);
        composedUrl = frames[0] || "";
        if (composedUrl) await ckpt({ ckComposedUrl: composedUrl });
      } catch (e) {
        console.error(`[ugc] compose failed (falling back to plain portrait): ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
      }
    }
    if (composedUrl) {
      try {
        const buf = await downloadBuffer(composedUrl);
        if (buf.length > 10_000) {
          animSourceUrl = composedUrl;
          animSourceDataUri = "data:image/jpeg;base64," + buf.toString("base64");
          heldProduct = true;
        }
      } catch { /* composed frame unreachable → plain portrait */ }
    }
  }

  let talkingUrl = resume.talkingUrl || "";
  // resumed jobs must keep the TRUE engine of the checkpointed render —
  // without this, a deploy-interrupted heygen take got relabeled omni-human
  let engine = (talkingUrl && resume.engine) || "omni-human";
  if (!talkingUrl) {
    // PRIMARY: fal.ai HeyGen Avatar 4 (photorealistic) when FAL_KEY is set.
    // HOSTED urls only (portrait from our /avatars, TTS from Replicate's CDN) —
    // fal forwards to HeyGen, whose servers fetch by URL; data URIs bounce.
    // Any failure falls through to the omni-human → kling chain, and the exact
    // fal error is checkpointed so diag can show why.
    if (falEnabled() && animSourceUrl && audioHostedUrl) {
      try {
        talkingUrl = await animateAvatar(animSourceUrl, audioHostedUrl);
        engine = "heygen-fal";
      } catch (e) {
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 180);
        console.error(`[ugc] fal heygen failed, falling back: ${msg}`);
        await ckpt({ ckFalError: msg });
      }
    }
    if (!talkingUrl && resume.omniPredictionId) {
      try {
        talkingUrl = await repPoll(resume.omniPredictionId, 12 * 60_000, "omni-human(resumed)");
      } catch { /* old prediction died — fall through to a fresh one */ }
    }
    for (let attempt = 0; attempt < 2 && !talkingUrl; attempt++) {
      try {
        const omniId = await repCreate("bytedance/omni-human", { image: animSourceDataUri, audio: audioDataUri });
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
        start_image: animSourceDataUri,
        prompt: `${avatar.desc}, talking directly to the camera with natural hand gestures and subtle head movement, enthusiastic friendly energy, static camera, plain studio background, vertical video`,
        negative_prompt: "camera movement, zoom, pan, morphing, distortion, extra people, text, watermark",
        duration: 10,
        cfg_scale: 0.5,
      });
      await ckpt({ ckOmniId: klingId });
      talkingUrl = await repPoll(klingId, 12 * 60_000, "kling-fallback");
    }
    await ckpt({ ckTalkingUrl: talkingUrl, ckEngine: engine });
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

    await assemble({
      talkingPath, audioPath, productImagePath, outPath,
      script: params.captions === false ? "" : script, // "" = no captions
      // omni-human AND fal HeyGen bake the lip-synced audio into their output;
      // only the silent kling fallback needs the TTS muxed over a looped clip.
      lipSynced: engine === "omni-human" || engine === "heygen-fal",
    });

    const asset = await db.asset.create({
      data: {
        shopId: params.shopId,
        type: "VIDEO_AD",
        status: "PENDING",
        title: `${avatar.name} presents — ${params.productTitle}`,
        bodyJson: JSON.stringify({
          style: "AI_AVATAR",
          engine,
          heldProduct, // the presenter is holding the product in-frame
          voiceId: pickVoice(avatar), // which voice spoke — curation data
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
          origin: params.origin || null,
        }),
      },
    });
    return asset.id;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* tmp cleanup best-effort */ }
  }
}
