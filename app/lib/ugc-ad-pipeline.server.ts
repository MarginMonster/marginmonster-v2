/* Zeely-class UGC ad pipeline. A "UGC ad" is an assembled performance, not a
 * raw video generation:
 *   1. SCRIPT  — Claude writes a ~13s hook-driven spoken script (AIDA/PAS) in
 *                the brand's voice
 *   2. VOICE   — minimax speech-02-hd reads it with the presenter's own cast
 *                signature (voice + pitch + speed + emotion; avatar-voices.json)
 *   3. TALKING — bytedance/omni-human: cast portrait + audio → lip-synced
 *                presenter performance ($0.14/s, ≤15s sweet spot)
 *   4. ASSEMBLY— ffmpeg: vertical 720x1280 canvas, product b-roll cut-in,
 *                bold burned-in captions (UGC style)
 * Total COGS ≈ $2-3 per finished ad. Output saved to data/renders and served
 * via the /renders/:file resource route. */

import crypto from "node:crypto";
import { withBrandFallback } from "./ad-copy-retry.server";
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
import { mirrorRender } from "./object-storage.server";
import { falEnabled, falQueueHandleFor, falTts, pollAvatar, submitAvatar, FalRenderFailed } from "./fal-video.server";
import { AVATAR_BY_ID, OUTFITS } from "./avatars";
import { hasCJK, langDirective, voiceLangOpts } from "./content-lang";
import { scriptTooShort, capScript, endStop } from "./script-length";
import AVATAR_CAST_RAW from "./avatar-voices.json";
import type { BrandProfile } from "@prisma/client";
import { captionChunks, CJK_OPTS, LATIN_OPTS } from "./caption-chunks";

/** Merge stage checkpoints into the job payload (kept local to avoid a
 *  circular import with job-queue.server). Never fatal. Shared by the cartoon
 *  and jingle pipelines too. */
export async function checkpointJob(jobId: string, patch: Record<string, unknown>): Promise<void> {
  try {
    // MERGE ONTO WHAT IS THERE AT WRITE TIME, NOT WHAT WAS THERE AT READ TIME.
    //
    // A checkpoint used to read the payload, merge, and write the whole blob
    // back. The payload is also where prePaid lives — the flag that says a
    // failed job still owes the merchant a refund — and refundPrepaidOnce
    // clears it from the ORPHAN REAPER, which runs on its own timer alongside
    // this render. So: the reaper decides a 26-minute render is a corpse,
    // refunds 150 tokens and clears prePaid; the render, still alive, finishes
    // a stage and writes back a payload it read a moment earlier — with
    // prePaid true again. The next terminal failure refunds a second time.
    //
    // Re-reading inside the loop is what fixes it: after the reaper commits,
    // the retry merges onto the CLEARED flag and the refund stays spent.
    for (let attempt = 0; attempt < 4; attempt++) {
      const job = await db.job.findUnique({ where: { id: jobId }, select: { payload: true } });
      if (!job) return;
      const merged = { ...JSON.parse(job.payload || "{}"), ...patch };
      const done = await db.job.updateMany({
        where: { id: jobId, payload: job.payload },
        data: { payload: JSON.stringify(merged) },
      });
      if (done.count === 1) return;
    }
    // Losing four races means this stage re-runs if the job resumes. That
    // costs a re-render; writing through a stale payload costs a double refund.
    console.warn(`[ugc] checkpoint for ${jobId} could not commit — the stage will re-run on resume`);
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
  wearProduct?: boolean; // apparel → presenter models (wears) the item instead of holding it
  serviceMode?: boolean; // intangible offering — no product to hold; presenter EXPLAINS and sells the outcome
  scene?: string; // merchant's setting/action → shapes the composed opening frame
  productSize?: string; // merchant's explicit size class — beats inference

  resume?: {
    // stage checkpoints from a previous interrupted attempt — restarts must
    // NEVER re-spend on completed stages or abandon a live omni prediction
    script?: string;
    audioUrl?: string;
    composedUrl?: string;
    omniPredictionId?: string;
    /** Kling gets its OWN key: a kling clip is SILENT, and re-attaching to one
     *  under the omni key made resume label it "omni-human" → lipSynced:true →
     *  assemble maps an audio stream that doesn't exist → ffmpeg hard-fails
     *  identically on every retry until the job refunds. */
    klingPredictionId?: string;
    /** fal/HeyGen queue id — re-attach instead of re-paying ~$1.50. */
    falRequestId?: string;
    /** a fal render that already failed once: don't re-buy the 10-min attempt. */
    falError?: string;
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

/** How long a single create may spend SLEEPING on 429s before it gives up.
 *  The worker drains jobs serially, so every second slept here is a second no
 *  other merchant's job can run. Past this we fail the attempt and let the job
 *  requeue (it keeps its checkpoints, so nothing already paid for is lost) —
 *  that's strictly cheaper than blocking the queue for minutes. */
const CREATE_RATE_LIMIT_BUDGET_MS = 90_000;

export async function repCreate(model: string, input: Record<string, unknown>): Promise<string> {
  let slept = 0;
  for (let a = 0; a < 12; a++) {
    const res = await fetch(`${REP}/models/${model}/predictions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${repToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });
    if (res.status === 429) {
      const j = (await res.json().catch(() => ({}))) as { retry_after?: number };
      const header = Number(res.headers.get("retry-after"));
      const hinted = (Number.isFinite(header) && header > 0 ? header : j.retry_after || 12) * 1000 + 1500;
      const wait = Math.min(hinted, CREATE_RATE_LIMIT_BUDGET_MS - slept);
      if (wait <= 0) break; // out of in-process patience → requeue instead
      slept += wait;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`[ugc] ${model} create ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { id: string };
    return j.id;
  }
  throw new Error(`[ugc] ${model}: rate-limited too long`);
}

/* ---- Multi-engine image-to-video (the Arcads-style engine picker) ----
 * One adapter, per-model input mapping, and a HARD RULE: a premium engine
 * that rejects for any reason (schema drift, capacity, region) falls back to
 * the default engine instead of failing a paid generation. */
/* The default sat on kling-v1.6-standard for months while kling shipped 2.0,
 * 2.1, 2.5 and 2.6 — every merchant video rendered on a two-generation-old
 * standard tier. A same-keyframe bake-off across eight engines on both
 * providers put kling 2.6 pro clearly ahead, and it is published on fal but
 * NOT on Replicate. So the default is fal-backed with the best Replicate
 * engine as the fallback: no key, no fal, or a fal reject still renders. */
export const DEFAULT_FAL_ANIMATE_MODEL = "fal-ai/kling-video/v2.6/pro/image-to-video";
export const DEFAULT_ANIMATE_MODEL = "kwaivgi/kling-v2.5-turbo-pro";

/** fal-hosted engines, keyed the same way as the Replicate ones. */
function falAnimateModelFor(engineKey: string | undefined): string | null {
  switch (engineKey) {
    case undefined: case "": case "kling": case "kling26": return DEFAULT_FAL_ANIMATE_MODEL;
    case "kling25fal": return "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";
    case "veo31": return "fal-ai/veo3.1/fast/image-to-video";
    default: return null; // an explicitly-named Replicate engine
  }
}

/** A prediction id that carries its provider, so resume can re-attach to the
 *  right one instead of polling Replicate for a fal request. */
const FAL_ID = "fal|";
export function isFalAnimateId(id: string): boolean { return id.startsWith(FAL_ID); }

function animateModelFor(engineKey: string | undefined): string {
  switch (engineKey) {
    case "veo": return "google/veo-3-fast";
    case "kling26": return "kwaivgi/kling-v2.6-pro";
    case "kling21": return "kwaivgi/kling-v2.1-master";
    case "kling16": return "kwaivgi/kling-v1.6-standard";
    case "seedance": return "bytedance/seedance-1-pro";
    case "hailuo": return "minimax/hailuo-02";
    case "kling":
    default: return DEFAULT_ANIMATE_MODEL;
  }
}

function animateInputFor(model: string, opts: { startImage: string; prompt: string; negativePrompt?: string }): Record<string, unknown> {
  // 9:16 explicitly: Veo defaults to 16:9 landscape, and a landscape clip
  // cover-cropped into our vertical assembler loses two-thirds of the frame.
  if (model === "google/veo-3-fast") return { prompt: opts.prompt, image: opts.startImage, aspect_ratio: "9:16" };
  if (model === "bytedance/seedance-1-pro") return { prompt: opts.prompt, image: opts.startImage, duration: 10, resolution: "720p" };
  if (model === "minimax/hailuo-02") return { prompt: opts.prompt, first_frame_image: opts.startImage, duration: 10 };
  const neg = opts.negativePrompt || "object disappearing, product vanishing, flickering, fading in and out, morphing, distortion, extra objects, text, watermark, blur";
  // kling 2.x dropped cfg_scale and caps at 5s/10s per tier; 1.6 still takes it.
  if (/kling-v2/.test(model)) return { start_image: opts.startImage, prompt: opts.prompt, negative_prompt: neg, duration: 5 };
  return { start_image: opts.startImage, prompt: opts.prompt, negative_prompt: neg, duration: 10, cfg_scale: 0.5 };
}

/** Start an image-to-video prediction on the chosen engine; falls back to the
 *  default engine if the premium one rejects. Returns the prediction id and
 *  which model ACTUALLY ran (for honest asset metadata). */
export async function animateCreate(
  engineKey: string | undefined,
  opts: { startImage: string; prompt: string; negativePrompt?: string }
): Promise<{ id: string; model: string }> {
  // fal first when the engine lives there (kling 2.6 pro is fal-only).
  const falModel = falAnimateModelFor(engineKey);
  if (falModel && falEnabled()) {
    try {
      const { falVideoSubmit } = await import("./fal-video.server");
      const rid = await falVideoSubmit(falModel, opts);
      return { id: `${FAL_ID}${falModel}|${rid}`, model: falModel };
    } catch (e) {
      console.error(`[animate] ${falModel} rejected — falling back to Replicate:`, e instanceof Error ? e.message.slice(0, 160) : e);
    }
  }
  const model = animateModelFor(engineKey);
  try {
    return { id: await repCreate(model, animateInputFor(model, opts)), model };
  } catch (e) {
    if (model === DEFAULT_ANIMATE_MODEL) throw e;
    console.error(`[animate] ${model} rejected — falling back to default:`, e instanceof Error ? e.message.slice(0, 160) : e);
    return { id: await repCreate(DEFAULT_ANIMATE_MODEL, animateInputFor(DEFAULT_ANIMATE_MODEL, opts)), model: DEFAULT_ANIMATE_MODEL };
  }
}

/** A poll that can't read the prediction is NOT a failed prediction. The old
 *  version called res.json() blind: a 5xx or an HTML error page threw straight
 *  out of the loop and killed a PAID, still-running render, and a 429 left
 *  j.status undefined so the loop burned its whole budget and then reported
 *  "timed out" on a prediction that had actually succeeded. Only this many
 *  CONSECUTIVE unreadable polls count as a real outage; one good poll resets it. */
const POLL_MAX_CONSECUTIVE_FAILURES = 10;

/** Poll an animate prediction from EITHER provider. Every caller of
 *  animateCreate must use this instead of repPoll — a fal request id polled
 *  against Replicate 404s forever and burns the whole budget. */
export async function animatePoll(id: string, maxMs: number, stage: string): Promise<string> {
  if (isFalAnimateId(id)) {
    const [, model, rid] = id.split("|");
    const { falVideoPoll } = await import("./fal-video.server");
    return falVideoPoll(model, rid, maxMs);
  }
  return repPoll(id, maxMs, stage);
}

export async function repPoll(id: string, maxMs: number, stage: string): Promise<string> {
  const start = Date.now();
  let consecutiveFailures = 0;
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 4000));
    // Never abandon a live prediction over a bad poll: transport errors, non-2xx
    // responses and unparseable bodies all fall through to skip-and-continue.
    let j: { status?: string; output?: string | string[]; error?: string } | null = null;
    let extraWaitMs = 0;
    try {
      const res = await fetch(`${REP}/predictions/${id}`, {
        headers: { Authorization: `Bearer ${repToken()}` },
      });
      if (res.ok) {
        j = (await res.json()) as { status?: string; output?: string | string[]; error?: string };
      } else {
        // honour the rate-limit hint so we stop making the throttling worse
        const header = Number(res.headers.get("retry-after"));
        if (res.status === 429) extraWaitMs = (Number.isFinite(header) && header > 0 ? header : 10) * 1000;
        await res.text().catch(() => ""); // drain so the socket is reusable
      }
    } catch {
      /* network/parse failure — treated exactly like a non-2xx below */
    }

    if (!j || typeof j.status !== "string") {
      consecutiveFailures++;
      if (consecutiveFailures >= POLL_MAX_CONSECUTIVE_FAILURES) {
        throw new Error(`[ugc:${stage}] prediction unreadable ${consecutiveFailures}x in a row (provider outage)`);
      }
      // short capped backoff on top of the 4s tick; the loop's own deadline
      // still bounds the total wait
      await new Promise((r) => setTimeout(r, Math.min(30_000, extraWaitMs || consecutiveFailures * 2000)));
      continue;
    }
    consecutiveFailures = 0;

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
/* A provider CDN that accepts the connection and then goes quiet used to park
 * the worker forever: fetch has no default timeout, this runs on the single
 * in-process job worker, and the stretch it sits in writes no checkpoint, so
 * nothing upstream could tell a stalled download from a slow render. Ten
 * minutes is far longer than any of these files legitimately take and far
 * shorter than "never". */
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

export async function download(url: string, file: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok || !res.body) throw new Error(`[ugc] download ${res.status} for ${file}`);
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), fs.createWriteStream(file));
}

export async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
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

/** Hand-cast voice signatures — every presenter gets their OWN (voice, pitch,
 *  speed) so no two avatars sound like the same person, and the base voice is
 *  chosen to FIT the persona (not just gender/age buckets). Authored via the
 *  audition board; pitch is MiniMax-native semitones (kept within ±3 so reads
 *  stay natural). Precedence: VOICE_OVERRIDES pin > cast entry > scorer. */
type VoiceCast = { voice: string; pitch: number; speed: number };
const AVATAR_CAST = AVATAR_CAST_RAW as Record<string, VoiceCast>;

export function castFor(avatar: { id: string; gender: "f" | "m"; ageBand: "young" | "mid" | "mature"; energy: "hype" | "warm" | "calm" }): VoiceCast & { emotion: string } {
  const emotion = avatar.energy === "calm" ? "neutral" : "happy";
  const pinned = VOICE_OVERRIDES[avatar.id];
  const entry = AVATAR_CAST[avatar.id];
  if (pinned) return { voice: pinned, pitch: entry?.pitch ?? 0, speed: entry?.speed ?? 1.0, emotion };
  if (entry) return { ...entry, emotion };
  const fallbackSpeed = avatar.energy === "hype" ? 1.08 : avatar.energy === "calm" ? 0.95 : 1.0;
  return { voice: pickVoice(avatar), pitch: 0, speed: fallbackSpeed, emotion };
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

/** Does this file carry an audio stream? Guard rail for the assemble step:
 *  mapping "N:a" on a SILENT clip makes ffmpeg fail hard, and the only way that
 *  happens is a mislabelled engine on a resumed job (a kling clip resumed as
 *  omni-human). Cheap probe beats burning a paid render on every retry. */
function hasAudioStream(file: string): boolean {
  const out = spawnSync(
    ffprobeBin(),
    ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file],
    // spawnSync BLOCKS THE WHOLE PROCESS, so an unbounded one is not a slow
    // probe, it is a dead server: the event loop stops, every merchant's
    // request stops, and the worker tick that would have recovered it never
    // gets to run. These read a local file that is already on disk; anything
    // past these limits is a wedge, not work. (anthropic.server.ts:150 has
    // carried a timeout on its ffmpeg call all along — these four missed it.)
    { encoding: "utf8", timeout: 15_000 }
  );
  return !!(out.stdout || "").trim();
}

/** Find the real picture inside a padded frame. HeyGen letterboxes a portrait
 *  that is not natively 9:16 with WHITE bars, and our fill-crop preserved them
 *  — merchants got finished ads with white bands top and bottom. cropdetect
 *  over the first couple of seconds finds the content box on ANY engine's
 *  padding (white, black, whatever) instead of hard-coding one aspect.
 *  Returns a crop filter, or null when the frame is already full-bleed. */
function detectContentCrop(file: string): string | null {
  try {
    const out = spawnSync(ffmpegBin(), [
      "-hide_banner", "-t", "2", "-i", file,
      // NEGATE FIRST. cropdetect's `limit` is a BLACK threshold — a row counts
      // as picture only when its luma EXCEEDS it — so it can only ever find
      // DARK borders. The bars this function exists to remove are WHITE, and
      // the original filter tried to reach them by raising limit to 250. That
      // cannot work in the direction intended: 8-bit limited-range luma tops
      // out at 235, so at 250 NOTHING qualifies as picture and ffmpeg emits a
      // degenerate box — verified against this repo's own binary on a 720x960
      // clip padded to 720x1280 with white bars:
      //
      //   cropdetect=limit=250        -> crop=-718:-1278:720:1280   (degenerate)
      //   cropdetect=limit=24         -> crop=720:1280:0:0          (bars kept)
      //   negate,cropdetect=limit=24  -> crop=720:960:0:160         (correct)
      //
      // The regex below reads \d+, which cannot match "-718", so the match set
      // came back empty and this returned null on EVERY clip. The letterbox
      // detection has never once fired: white bands have been shipping in
      // finished ads the whole time, on the very path written to remove them.
      //
      // Inverting first turns those white bars black, where cropdetect can see
      // them at its normal threshold.
      "-vf", "negate,cropdetect=limit=24:round=2:reset=0", "-f", "null", "-",
    ], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 60_000 });
    // Tolerate the negative form so a no-detect is explicit rather than an
    // accident of the pattern not matching.
    const hits = [...String(out.stderr || "").matchAll(/crop=(-?\d+):(-?\d+):(-?\d+):(-?\d+)/g)];
    const last = hits[hits.length - 1];
    if (!last) return null;
    const [w, h, x, y] = last.slice(1, 5).map(Number);
    if (!(w > 0) || !(h > 0) || x < 0 || y < 0) return null;
    const probe = spawnSync(ffprobeBin(), ["-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file], { encoding: "utf8", timeout: 15_000 });
    const [fw, fh] = String(probe.stdout || "").trim().split("x").map(Number);
    if (!fw || !fh) return null;
    // Only act on real letterboxing, and never crop away more than a third of
    // the frame — a bright scene can now fool cropdetect the same way a dark
    // one used to, since we inverted it.
    const trimmed = (fh - h) / fh;
    if (trimmed < 0.04 || trimmed > 0.34 || w < fw * 0.9) return null;
    // LETTERBOXING IS SYMMETRIC AND FULL-WIDTH. Padding puts equal bars top
    // and bottom across the whole frame; a bright ceiling or a white wall at
    // the top of a real shot does not. Requiring that shape is what keeps the
    // inverted probe from cropping picture out of a legitimately bright clip.
    if (x !== 0 || w !== fw) return null;
    if (Math.abs(y - (fh - h) / 2) > 8) return null;
    console.log(`[ugc:assemble] letterbox detected — cropping ${fw}x${fh} to ${w}x${h}`);
    return `crop=${w}:${h}:${x}:${y}`;
  } catch (e) {
    console.error("[ugc:assemble] cropdetect failed (keeping full frame):", e instanceof Error ? e.message.slice(0, 120) : e);
    return null;
  }
}

export function ffprobeDuration(file: string): number {
  const out = spawnSync(ffprobeBin(), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], {
    encoding: "utf8",
    timeout: 15_000,
  });
  const d = parseFloat((out.stdout || "").trim());
  if (!d || Number.isNaN(d)) throw new Error(`[ugc:assemble] couldn't probe duration (${out.stderr?.slice(0, 120)})`);
  return d;
}

/** Caption-safe text: bold UGC style is ALL CAPS; strip anything that fights
 *  drawtext's escaping rules. Unicode-aware so Spanish accents, German
 *  umlauts and Chinese characters survive (the old A-Z filter erased them).
 *
 *  THE APOSTROPHE IS KEPT, AS A CURLY ONE.
 *
 *  It used to be deleted outright, so every burned-in caption read WONT,
 *  DONT, THATS, YOURE — on the merchant's finished video, where it cannot be
 *  edited. The reason was real: the filtergraph passes the string as
 *  text='...', and a straight apostrophe closes that quote early.
 *
 *  U+2019 solves it without any escaping at all. It is a letter to ffmpeg,
 *  not punctuation in the filter syntax; Poppins and Noto both carry it; and
 *  it is the typographically correct mark for a contraction anyway, so the
 *  caption also just looks better. Straight quotes from the writer are folded
 *  into it rather than dropped.
 */
function captionSafe(s: string): string {
  return s
    .toUpperCase()
    .replace(/[']/g, "’")
    .replace(/[^\p{L}\p{N} .,!?$’-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Font for burned-in text. Poppins covers Latin; CJK needs Noto, which we
 *  fetch ONCE to the persistent disk (too heavy to ship in the repo). Throws
 *  if CJK text can't get a CJK font — callers then skip captions rather than
 *  burning tofu boxes. */
export async function resolveTextFont(text: string): Promise<string> {
  const poppins = path.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");
  if (!hasCJK(text)) return poppins;
  const dir = path.join(process.cwd(), "data", "renders", "fonts");
  const f = path.join(dir, "NotoSansSC-Bold.otf");
  if (fs.existsSync(f) && fs.statSync(f).size > 1_000_000) return f;
  fs.mkdirSync(dir, { recursive: true });
  const url = "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansSC-Bold.otf";
  const r = await fetch(url);
  if (!r.ok) throw new Error(`[fonts] Noto CJK download failed (${r.status})`);
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  console.log("[fonts] Noto Sans SC fetched to persistent disk");
  return f;
}

function buildCaptionFilters(script: string, duration: number, fontFile: string): string[] {
  // GRAMMAR FIRST, THEN WIDTH.
  //
  // The chunker used to be a character/word budget and nothing else, so it cut
  // wherever the count ran out. A real video in the Archive captions as
  //
  //     EVER SEEN | POKEMON LOOK | THE WILD. THIS | NATURAL | BRINGS SIX
  //
  // "THE WILD. THIS" carries a full stop through its middle with the next
  // sentence's first word stuck on the end. These are burned into the
  // merchant's finished video — there is no editing them afterwards.
  //
  // captionChunks splits on sentences, then on clause boundaries inside a
  // long sentence, and only then packs to width; it also rebalances rather
  // than truncating, which is what used to make the captions stop while the
  // voice-over kept talking. It is pure — see tests/caption-chunks.test.ts.
  const capped = captionChunks(captionSafe(script), hasCJK(script) ? CJK_OPTS : LATIN_OPTS);
  if (!capped.length) return [];
  const per = duration / capped.length;
  // fontfile path needs forward slashes + escaped colon for the filter parser
  const font = fontFile.replace(/\\/g, "/").replace(/:/g, "\\:");
  return capped.map((text, i) => {
    const t0 = (i * per).toFixed(2);
    const t1 = ((i + 1) * per).toFixed(2);
    // Latin caps run ~0.62×fontsize wide, CJK ~1.05×; keep every line inside
    // ~94% of the 720px frame so no caption ever bleeds off the edge.
    const glyph = hasCJK(text) ? 1.05 : 0.62;
    const size = Math.max(30, Math.min(50, Math.floor((720 * 0.94) / (text.length * glyph))));
    // gte*lt (not between) — between is inclusive on both ends, which
    // double-draws two captions on the shared boundary frame
    return (
      `drawtext=fontfile='${font}':text='${text}':fontsize=${size}:fontcolor=white:` +
      `borderw=7:bordercolor=black:x=(w-text_w)/2:y=h-330:enable='gte(t,${t0})*lt(t,${t1})'`
    );
  });
}

/** Hard ceiling for one encode. A wedged ffmpeg (bad input stream, stalled
 *  filter graph) never emits "close", so the promise never settles: the job
 *  sits IN_PROGRESS and the SERIAL drain loop stops draining for every merchant
 *  until orphan-reclaim notices ~25 min later. SIGKILL and resolve down the
 *  normal failure path instead. 10 min is far beyond any 15s 720x1280 encode. */
const FFMPEG_TIMEOUT_MS = 10 * 60_000;

/** ffmpeg runs ASYNC (spawn, not spawnSync) — spawnSync froze the whole Node
 *  process for the entire encode, so Render's 5s health checks timed out
 *  mid-render and the platform killed the instance ("app crashed" with no
 *  deploy). 1080p encodes are long enough to guarantee it. */
export function runFfmpeg(args: string[]): Promise<{ status: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegBin(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { p.kill("SIGKILL"); } catch { /* already gone */ }
    }, FFMPEG_TIMEOUT_MS);
    p.stderr.on("data", (c: Buffer) => {
      err += c.toString();
      if (err.length > 65536) err = err.slice(-32768); // keep the tail
    });
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ status: -1, stderr: `${err}\n[ugc:assemble] ffmpeg killed after ${FFMPEG_TIMEOUT_MS / 60_000} min (wedged)` });
        return;
      }
      resolve({ status: code ?? -1, stderr: err });
    });
  });
}

export async function assemble(opts: {
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
  /** Where the product b-roll lands. "mid" (default) is the UGC-style cutaway
   *  partway through — it's how the viewer first SEES the product. "end" is a
   *  short closing beat instead, for ads where the presenter already holds the
   *  product throughout: there the cut-in isn't revealing anything, so cutting
   *  away mid-song just interrupts the performance. At the end it lands the
   *  last line on a clean shot. */
  productCutAt?: "mid" | "end";
  /** The creator-style cutaway format: the product b-roll becomes moving
   *  Ken Burns beats (slow push-in mid-ad, pull-back on the close) built
   *  deterministically from the merchant's REAL photo, with the narration
   *  running underneath uncut. This is how the big UGC shops shoot product
   *  reveals — the presenter talks, the product gets its own moving shots.
   *  Falls back to the static cut-in if the zoompan graph fails. */
  cutaway?: boolean;
  /** The job this assembly belongs to, so it can keep its own heartbeat.
   *
   *  Job.updatedAt only moves on a write, and the orphan reaper treats a row
   *  untouched for 25 minutes as a corpse: it marks the job FAILED and refunds
   *  the merchant. Assembly is the longest checkpoint-free stretch in the whole
   *  app — up to five serial ffmpeg rungs, each allowed ten minutes — so a
   *  render that fell down the recovery ladder got refunded WHILE STILL
   *  ENCODING, and then finished and put the finished ad in the merchant's
   *  Archive anyway. They keep the video and the 150 tokens; the provider bill
   *  is ours. Below MAX_ATTEMPTS it is worse: the row goes back to PENDING and
   *  a second assembly starts alongside the first.
   *
   *  Beating between rungs makes the row's age mean what the reaper thinks it
   *  means — time since anything actually happened. */
  jobId?: string;
}): Promise<void> {
  // Non-fatal by construction: checkpointJob swallows its own errors, and a
  // missed beat costs at worst a wrongly-reclaimed job, never the render.
  const beat = async () => { if (opts.jobId) await checkpointJob(opts.jobId, { ckBeat: Date.now() }); };
  // CJK scripts need the Noto font (fetched once); if it can't be had, ship
  // the video without burned captions instead of burning tofu boxes.
  let fontFile = path.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");
  let script = opts.script;
  try { fontFile = await resolveTextFont(script); }
  catch (e) { if (hasCJK(script)) { console.error("[assemble] no CJK font — skipping captions:", e instanceof Error ? e.message : e); script = ""; } }
  // TRUST BUT VERIFY the caller's lipSynced flag: mapping the clip's own audio
  // when the clip has none makes ffmpeg fail hard and IDENTICALLY on every
  // retry (the paid-render-that-can-never-assemble bug — a silent kling clip
  // resumed under the wrong engine label). One cheap probe converts that into a
  // normal narrated fallback.
  let lipSynced = opts.lipSynced;
  if (lipSynced && !hasAudioStream(opts.talkingPath)) {
    console.error("[ugc:assemble] clip is SILENT but was labelled lip-synced — muxing the narration instead");
    lipSynced = false;
  }
  // The performance defines the ad when it's lip-synced (never trim/loop the
  // synced clip); the narration defines it only for the silent fallback.
  const talkingDur = ffprobeDuration(opts.talkingPath);
  const audioDur = ffprobeDuration(opts.audioPath);
  // If a lip-sync engine truncated the clip shorter than the narration, using
  // its (short) baked audio cuts the sentence. Detect it, freeze-extend the
  // last frame to the full narration length, and play the complete TTS audio —
  // a hair of lip drift at the tail beats a mid-word cut. Un-truncated clips are
  // untouched (identical to before).
  const truncated = lipSynced && audioDur > talkingDur + 0.4;
  const useBakedAudio = lipSynced && !truncated;
  const duration = useBakedAudio ? talkingDur : audioDur;

  // NORMALIZE THE B-ROLL INPUT. Shopify's CDN serves WebP bytes from .jpg
  // URLs, and image2's -loop option (the static cut-in) rejects webp_pipe
  // input outright ("Option loop not found") — so the product cut-in was
  // silently dying on the recovery ladder for any merchant whose CDN sent
  // WebP. One cheap re-encode up front makes the input format boring for
  // every caller of assemble (UGC, cartoon, jingle alike).
  let bRollPath = opts.productImagePath;
  if (bRollPath) {
    const norm = `${bRollPath}.norm.jpg`;
    await beat();
    const conv = await runFfmpeg(["-y", "-i", bRollPath, "-frames:v", "1", norm]);
    if (conv.status === 0 && fs.existsSync(norm)) bRollPath = norm;
    else console.error(`[ugc:assemble] product image re-encode failed — using original: ${(conv.stderr || "").slice(-200)}`);
  }

  // Strip any letterbox the talking engine baked in before we fill the canvas.
  const letterbox = detectContentCrop(opts.talkingPath);

  /** One encode pass. captionText === "" builds ZERO drawtext filters — that's
   *  the recovery pass below, and the reason the caption filters are built here
   *  rather than once up front. */
  const encode = async (captionText: string, withBroll = true, kenBurns = !!opts.cutaway) => {
    const args: string[] = ["-y"];
    if (!lipSynced) args.push("-stream_loop", "-1"); // loop only the silent kling fallback
    args.push("-i", opts.talkingPath);
    if (!useBakedAudio) args.push("-i", opts.audioPath); // external narration for fallback + truncated recovery
    const audioInputIndex = useBakedAudio ? 0 : 1; // omni/heygen: video's own audio; else: the mp3

    const filters: string[] = [];
    let vLabel = "[v0]";
    let base = `[0:v]${letterbox ? `${letterbox},` : ""}scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=30`;
    if (truncated) base += `,tpad=stop_mode=clone:stop_duration=${(audioDur - talkingDur + 0.1).toFixed(2)}`;
    filters.push(`${base}[v0]`);

    if (bRollPath && withBroll && kenBurns) {
      // KEN BURNS CUTAWAYS. The still is scaled to 2x the canvas first so the
      // zoom samples from real pixels instead of jittering on upscale, then
      // each beat gets its own zoompan branch: a push-in for the mid-ad reveal
      // and a pull-back for the close. setpts shifts each branch to its window
      // and overlay+enable drops it onto the performance; the audio track is
      // untouched, so the narration runs continuously under the cuts — the
      // grammar of every real creator ad.
      const brIdx = useBakedAudio ? 1 : 2;
      args.push("-i", bRollPath); // single frame — zoompan makes the motion
      const cutLen = 1.8;
      const beats: { bs: number; out: boolean }[] = duration >= 8.5
        ? [{ bs: Math.max(1.6, duration * 0.38), out: false }, { bs: duration - cutLen - 0.1, out: true }]
        : [{ bs: Math.max(1.4, duration * 0.5), out: false }]; // short clip → one beat
      filters.push(`[${brIdx}:v]scale=1440:2560:force_original_aspect_ratio=decrease,pad=1440:2560:(ow-iw)/2:(oh-ih)/2:color=0x0B0F0D[bsrc]`);
      filters.push(`[bsrc]split=${beats.length}${beats.map((_, i) => `[bp${i}]`).join("")}`);
      beats.forEach((b, i) => {
        const frames = Math.round(cutLen * 30);
        const z = b.out ? `max(1.12-0.12*on/${frames - 1},1.001)` : `1+0.12*on/${frames - 1}`;
        filters.push(
          `[bp${i}]zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=720x1280:fps=30,` +
          `setpts=PTS-STARTPTS+${b.bs.toFixed(2)}/TB[cut${i}]`
        );
        filters.push(`${vLabel}[cut${i}]overlay=enable='between(t,${b.bs.toFixed(2)},${(b.bs + cutLen).toFixed(2)})':eof_action=pass[vb${i}]`);
        vLabel = `[vb${i}]`;
      });
    } else if (bRollPath && withBroll) {
      // b-roll product image = the next input. Lip-synced has [0]=video only, so
      // it's input 1; fallback has [0]=video [1]=audio, so it's input 2.
      const brIdx = useBakedAudio ? 1 : 2;
      args.push("-loop", "1", "-framerate", "30", "-t", String(Math.ceil(duration)), "-i", bRollPath);
      // during a lip-synced clip keep the cutaway short (hides the mouth briefly —
      // reads as an intentional UGC cut, not a glitch)
      const atEnd = opts.productCutAt === "end";
      const cutLen = atEnd ? 1.4 : lipSynced ? 1.6 : 2.2;
      const bs = (atEnd ? Math.max(0.8, duration - cutLen) : Math.max(1.2, duration * 0.5)).toFixed(2);
      const be = (atEnd ? duration : Math.min(duration - 0.8, duration * 0.5 + cutLen)).toFixed(2);
      // FIT the product shot, don't crop it. Product photos are square or
      // landscape far more often than 9:16, and cover-cropping one into a
      // vertical frame amputates it — a booster box came out with its own name
      // sliced off both edges. The whole point of this beat is that the viewer
      // sees the product, so letterbox it onto the brand's near-black instead.
      filters.push(`[${brIdx}:v]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=0x0B0F0D[br]`);
      filters.push(`[v0][br]overlay=enable='between(t,${bs},${be})'[v1]`);
      vLabel = "[v1]";
    }

    const captions = buildCaptionFilters(captionText, duration, fontFile);
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

    return runFfmpeg(args);
  };

  await beat();
  let run = await encode(script);
  // CAPTIONS ARE A NICE-TO-HAVE; THE VIDEO IS THE PRODUCT. By the time we get
  // here the render is fully paid (kling/omni + TTS/song), and this free last
  // step used to hard-fail the whole job on anything drawtext-shaped: an ffmpeg
  // build without the drawtext filter (the npm static Linux binary ships
  // without it — see ffmpegBin above), a missing font, or a caption string that
  // trips the filter parser. Every retry then died the same way → merchant
  // refunded, no video. Retry ONCE with no captions before giving up.
  if ((run.status !== 0 || !fs.existsSync(opts.outPath)) && script) {
    console.error(`[ugc:assemble] encode failed — retrying WITHOUT burned captions: ${(run.stderr || "").slice(-300)}`);
    await beat();
    run = await encode("");
    if (run.status === 0) console.log("[ugc:assemble] recovered — shipped without burned captions");
  }
  // THE MOTION IS A NICE-TO-HAVE TOO. zoompan/split are exactly the kind of
  // filters a thin ffmpeg build ships without, and the cutaway beats must
  // never cost an ad the static cut-in could still deliver. One rung down.
  if ((run.status !== 0 || !fs.existsSync(opts.outPath)) && opts.cutaway && opts.productImagePath) {
    console.error(`[ugc:assemble] still failing — retrying with a STATIC product cut instead of Ken Burns: ${(run.stderr || "").slice(-300)}`);
    await beat();
    run = await encode("", true, false);
    if (run.status === 0) console.log("[ugc:assemble] recovered — shipped with the static cut-in");
  }
  // THE B-ROLL IS ALSO A NICE-TO-HAVE. Same reasoning as the captions above:
  // by now the song and the lipsync are bought and paid for, and the product
  // cut-in is two filters (overlay + pad) that a thin ffmpeg build can be
  // missing. Losing the closing beat beats losing the ad and refunding.
  if ((run.status !== 0 || !fs.existsSync(opts.outPath)) && opts.productImagePath) {
    console.error(`[ugc:assemble] still failing — retrying WITHOUT the product cut-in: ${(run.stderr || "").slice(-300)}`);
    await beat();
    run = await encode("", false);
    if (run.status === 0) console.log("[ugc:assemble] recovered — shipped without the product cut-in");
  }
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
  // resolvePresenter covers the public cast AND this shop's private/custom
  // presenters ("cav..." ids) — the avatar-maker seam.
  const { resolvePresenter } = await import("./custom-avatars.server");
  const variant = Math.max(0, Math.min(OUTFITS.length - 1, params.avatarVariant ?? 0));
  const { avatar, portraitFile, portraitPublicPath } = await resolvePresenter(params.shopId, params.avatarId, variant);
  // inline bytes: omni-human never has to fetch our server or another
  // provider's expiring URL (both have flaked in production)
  const portraitDataUri =
    "data:image/jpeg;base64," + fs.readFileSync(portraitFile).toString("base64");
  // hosted URL for partner-routed engines: fal forwards to HeyGen's servers,
  // which fetch inputs by URL — data URIs get rejected there
  const portraitPublicUrl = process.env.SHOPIFY_APP_URL
    ? `${process.env.SHOPIFY_APP_URL.replace(/\/$/, "")}${portraitPublicPath}`
    : "";

  const voiceJson = JSON.parse(params.brandProfile.voiceJson || "{}");
  // Generate in the shop's content language (web toggle / store locale).
  const contentLang = (await db.shop.findUnique({ where: { id: params.shopId }, select: { contentLang: true } }))?.contentLang;

  // 1) SCRIPT — hook-first, ~13s spoken. Services sell the OUTCOME, not an
  // object the presenter holds up.
  const buildScriptPrompt = (productRef: string, debranded: boolean) => [
    `You write spoken scripts for short-form UGC video ads (TikTok/Reels/Shorts).${langDirective(contentLang)}`,
    `Presenter: ${avatar.name}, ${avatar.desc}.`,
    params.serviceMode
      ? `This is a SERVICE / offer (not a physical product): "${productRef}". The presenter is a spokesperson talking to camera — they do NOT hold a product. Sell the RESULT the customer gets, the pain it removes, and why it's worth it.`
      : `Product: "${productRef}".`,
    debranded ? `Talk about what the item IS and what owning it feels like. Do not name any brand, franchise or character.` : "",
    params.productDescription ? `${params.serviceMode ? "What it does / the outcome" : "Product details"}: ${params.productDescription.slice(0, 300)}` : "",
    voiceJson.tone ? `Brand voice/tone: ${voiceJson.tone}.` : "",
    params.direction ? `Merchant direction (follow it): ${params.direction}` : "",
    ``,
    `Rules: The FIRST sentence must be a scroll-stopping hook. Use PAS or AIDA.`,
    `26 to 32 words TOTAL (about 12 seconds spoken) — a punchy hook plus ONE clear point. Do NOT exceed 32 words. Conversational, first person,`,
    `like recommending to a friend. End with a short call to action.`,
    `SPEECH PACING (critical — a voice model reads this aloud): put a comma wherever a person naturally breathes, and a period at the END of every sentence, so it paces naturally and NEVER runs words together. Use short, varied, complete sentences — no run-ons, no missing punctuation.`,
    `Output ONLY the spoken words — no stage directions, quotes, emoji, or hashtags.`,
  ]
    .filter(Boolean)
    .join("\n");

  const resume = params.resume || {};
  const ckpt = (patch: Record<string, unknown>) =>
    params.jobId ? checkpointJob(params.jobId, patch) : Promise.resolve();

  let script = resume.script || "";
  if (!script) {
    // A branded product title can be refused outright, returning nothing —
    // retry, then drop the brand and sell the category. See
    // ad-copy-retry.server.ts for what the sweep showed.
    script = await withBrandFallback(async (productRef, debranded) => {
      const raw = ((await anthropicText(buildScriptPrompt(productRef, debranded), { model: "claude-sonnet-5", maxTokens: 200 })) || "")
        .replace(/["“”\n]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      // A truncated fragment is worse than empty — the spec is 26-32 words,
      // so a fragment is a mangled output. Return "" so the fallback ladder
      // treats it as a refusal and retries instead of shipping it.
      // Measured per writing system: `split(/\s+/)` scored a perfect
      // 35-character Chinese script as ONE word, so every zh shop failed
      // this check forever and could not make a UGC ad at all.
      return scriptTooShort(raw) ? "" : raw;
    }, params.productTitle, "ugc:script", params.productDescription);
    // 12s budget — hard cap so it never runs past the lip-sync sweet spot.
    // In characters for CJK, where the old word cap could never fire.
    script = capScript(script, 34);
    // give the voice model a clean final stop so it doesn't rush/trail the
    // ending — 。for CJK, where a Latin full stop reads as a typo
    script = endStop(script);
    await ckpt({ ckScript: script });
  }

  // 2) VOICE — TTS is 3s/$0.001, so regenerating on a dead resume URL is fine.
  // We always end up with the audio BYTES (validated), sent inline downstream.
  // speech-02-hd + the presenter's OWN cast signature (voice + pitch + speed +
  // emotion): every avatar is a distinct, fitting speaker. Same mp3 feeds every
  // engine (fal/HeyGen lip-sync, omni-human, kling voiceover) — lifts all takes.
  const delivery = castFor(avatar);
  // WHICH VOICE ACTUALLY SPOKE. The asset used to record delivery.voice — the
  // voice we INTENDED — so after a silent fallback the data said "premium
  // designed voice" while the ad played a generic stock read. That made the
  // "why does this presenter sound wrong?" bug undiagnosable from the record.
  // These three track the truth and ride out to the asset below.
  let spokenVoice = delivery.voice;
  let voiceFellBack = false;
  let voiceFallbackReason = "";
  const downgrade = (reason: string, to: string) => {
    voiceFellBack = true;
    voiceFallbackReason = reason.slice(0, 200);
    spokenVoice = to;
    console.error(`[ugc:tts] VOICE DOWNGRADE — ${avatar.id} lost ${delivery.voice} → ${to}: ${voiceFallbackReason}`);
  };
  const freshTts = async (): Promise<string> => {
    // designed voices (ttv-voice-*) live on the fal MiniMax account — they can
    // ONLY be spoken there.
    if (delivery.voice.startsWith("ttv-")) {
      try {
        // the FULL cast signature — a designed voice read flat is a different
        // performance from the one we auditioned and approved
        return await falTts(script, delivery.voice, delivery.speed, {
          pitch: delivery.pitch,
          emotion: delivery.emotion,
          // the fal path is the same take as the Replicate path above and
          // needs the same language, or half the routes speak English anyway
          lang: contentLang,
        });
      } catch (e) {
        // A DESIGNED VOICE IS PAID-FOR AND IS NOT SUBSTITUTABLE. This used to
        // drop to a generic scored stock voice so "a take never dies over
        // casting" — but that trade was wrong. Shipping a stranger in a paid
        // presenter's place is worse than shipping nothing: the merchant can't
        // tell it happened, and neither could we.
        //
        // Throwing is SAFE and is the better failure. falTts has already
        // retried 3× with backoff; the worker gives the job 3 attempts, so the
        // voice gets ~9 chances. Only if it still can't speak does the job go
        // terminal — and terminal failure REFUNDS the tokens (refundPrepaidOnce
        // in job-queue.server.ts). So the merchant gets their paid voice or
        // their money back, never a substitute.
        //
        // UGC_VOICE_STRICT=0 restores the old substitute-and-continue behaviour
        // if an extended fal outage ever makes shipping something preferable.
        const why = (e as Error).message;
        if (process.env.UGC_VOICE_STRICT !== "0") {
          console.error(`[ugc:tts] REFUSING to substitute ${avatar.id}'s paid voice ${delivery.voice}: ${why}`);
          throw new Error(`[ugc:tts] designed voice ${delivery.voice} (${avatar.id}) could not speak and will not be substituted: ${why}`);
        }
        const stock = pickVoice(avatar);
        downgrade(why, stock);
        const ttsId = await repCreate("minimax/speech-02-turbo", { text: script, voice_id: stock });
        return await repPoll(ttsId, 3 * 60_000, "tts");
      }
    }
    try {
      const ttsId = await repCreate("minimax/speech-02-hd", {
        text: script,
        voice_id: delivery.voice,
        emotion: delivery.emotion,
        speed: delivery.speed,
        pitch: delivery.pitch,
        // The script above was written in the shop language by langDirective;
        // telling the voice model to expect English mispronounced it and applied
        // English number/date normalisation to text that is not English.
        ...voiceLangOpts(contentLang),
      });
      return await repPoll(ttsId, 3 * 60_000, "tts");
    } catch (e) {
      // input-schema drift or hd outage must never kill a take — bare turbo read.
      // Use the SCORED STOCK voice, not delivery.voice: the commonest hd failure
      // is an unknown/unavailable voice_id, and re-sending the same id to turbo
      // reproduced it exactly (same failure, twice the latency, take still dead).
      const stock = pickVoice(avatar);
      downgrade((e as Error).message, stock);
      const ttsId = await repCreate("minimax/speech-02-turbo", {
        text: script,
        voice_id: stock,
      });
      return await repPoll(ttsId, 3 * 60_000, "tts");
    }
  };
  let audioBuf: Buffer | null = null;
  let audioHostedUrl = resume.audioUrl || ""; // hosted mp3 (Replicate CDN) — what fal/HeyGen fetches
  if (resume.audioUrl) {
    try { audioBuf = await downloadBuffer(resume.audioUrl); } catch { audioBuf = null; }
    // resumed audio was rendered in an earlier attempt — we cannot know from
    // here whether that attempt downgraded, so don't claim the designed voice
    if (audioBuf) spokenVoice = `${delivery.voice}?resumed`;
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
  // THE CUTAWAY FORMAT — the product gets its own moving b-roll beats cut
  // deterministically from the merchant's REAL photo, narration running
  // underneath. Cutaways used to ALSO suppress the product-in-hand compose,
  // on the theory that the compose was the pipeline's one risky generative
  // step. It is not any more: the compose engine holds product fidelity
  // reliably, and a presenter talking about something they are not holding
  // reads as stock footage. So we now do BOTH — the presenter performs
  // holding the real product, and the b-roll beats still cut in.
  //
  // A Studio-approved composed frame is human-gated, so it is always
  // respected; apparel still needs the presenter wearing the item; services
  // have no product to cut to. UGC_CUTAWAY=0 restores the product-in-frame
  // pipeline everywhere — the backburner switch, same as every other one.
  const cutawayMode = process.env.UGC_CUTAWAY !== "0"
    && !params.serviceMode && !params.wearProduct && !params.composedFrameUrl
    && !!params.productImageUrl;

  let heldProduct = false;
  let animSourceUrl = portraitPublicUrl; // what HeyGen fetches
  let animSourceDataUri = portraitDataUri; // what omni/kling get inline
  {
    let composedUrl = params.composedFrameUrl || resume.composedUrl || "";
    // Compose regardless of cutaway mode: hands hold the product, b-roll
    // still flashes to it. Apparel (wear) and services keep their own paths,
    // and any compose failure falls through to the plain portrait untouched.
    if (!composedUrl && !params.serviceMode && params.holdProduct && params.productImageUrl && portraitPublicUrl) {
      try {
        const { composeHoldingFrames } = await import("./fal-image.server");
        // A cutout carries no scale, so tell the composer how big this
        // actually is — otherwise a 12-box case comes out palm-sized.
        const { resolveProductScale } = await import("./product-scale.server");
        const hint = await resolveProductScale({
          productTitle: params.productTitle,
          productDescription: params.productDescription,
          productImageUrl: params.productImageUrl,
          productSize: params.productSize,
        });
        const frames = await composeHoldingFrames(portraitPublicUrl, params.productImageUrl, params.productTitle, 1, params.wearProduct ? "wear" : "hold", params.scene, hint?.phrase, avatar.continuity);
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

  /** Produce the talking performance. Split into a closure so it can be run a
   *  SECOND time with every checkpoint ignored (`useCheckpoints: false`) — see
   *  the download recovery below: provider URLs expire in ~1h, and a job queued
   *  behind a backlog would otherwise 403 on the same dead checkpointed URL on
   *  every remaining attempt until it refunded.
   *
   *  ORDER MATTERS AND IS ABOUT MONEY: everything already submitted (and
   *  therefore already billed) is re-attached FIRST, before a single new render
   *  is bought. The old order ran the fal/HeyGen render before the omni
   *  re-attach, so a job killed mid-omni-poll paid ~$1.50 for a whole HeyGen
   *  take and abandoned the live omni one it had already paid for. */
  const acquireTalking = async (useCheckpoints: boolean): Promise<{ url: string; engine: string }> => {
    let talkingUrl = useCheckpoints ? resume.talkingUrl || "" : "";
    // resumed jobs must keep the TRUE engine of the checkpointed render —
    // without this, a deploy-interrupted heygen take got relabeled omni-human
    let engine = (talkingUrl && resume.engine) || "omni-human";
    if (talkingUrl) return { url: talkingUrl, engine };

    // RE-ATTACH #1 — a live omni prediction is already paid for.
    if (useCheckpoints && resume.omniPredictionId) {
      engine = "omni-human";
      try {
        talkingUrl = await repPoll(resume.omniPredictionId, 12 * 60_000, "omni-human(resumed)");
      } catch { /* old prediction died — fall through to a fresh one */ }
    }
    // RE-ATTACH #2 — a live KLING prediction, under its own key. Sharing
    // ckOmniId made resume label a SILENT clip "omni-human", which set
    // lipSynced:true and pointed assemble at an audio stream that doesn't
    // exist: ffmpeg then failed identically on every retry until refund.
    if (!talkingUrl && useCheckpoints && resume.klingPredictionId) {
      engine = "kling-voiceover";
      try {
        talkingUrl = await animatePoll(resume.klingPredictionId, 12 * 60_000, "kling-fallback(resumed)");
      } catch { engine = "omni-human"; /* dead → fresh chain below */ }
    }
    // RE-ATTACH #3 — a submitted fal/HeyGen render (~$1.50) survives a restart.
    if (!talkingUrl && useCheckpoints && resume.falRequestId) {
      engine = "heygen-fal";
      try {
        talkingUrl = await pollAvatar(falQueueHandleFor(resume.falRequestId));
      } catch (e) {
        engine = "omni-human";
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 160);
        // "WE STOPPED WATCHING" IS NOT "IT DIED" — the distinction the
        // in-attempt path below already draws, and this one threw away.
        //
        // pollAvatar throws FalRenderFailed only when the queue reports a real
        // failure. Running out of time, or ten unreadable status polls (about
        // fifty seconds of fal flakiness), throws a PLAIN Error while the
        // render is alive and already billed. Treating both as dead meant the
        // next block submitted a SECOND HeyGen performance and overwrote the
        // only handle to the first, which then completed, was billed, and
        // became unreachable forever.
        if (e instanceof FalRenderFailed) {
          console.error(`[ugc] fal re-attach: the render failed in the queue — retiring it: ${msg}`);
          await ckpt({ ckFalError: msg, ckFalRequestId: "" });
        } else {
          // Keep the handle. This attempt goes on without it, but a later one
          // can still collect the render we have already paid for.
          console.error(`[ugc] fal re-attach: still running, keeping the handle: ${msg}`);
        }
      }
    }

    // PRIMARY: fal.ai HeyGen Avatar 4 (photorealistic) when FAL_KEY is set.
    // HOSTED urls only (portrait from our /avatars, TTS from Replicate's CDN) —
    // fal forwards to HeyGen, whose servers fetch by URL; data URIs bounce.
    // Any failure falls through to the omni-human → kling chain, and the exact
    // fal error is checkpointed so diag can show why — and so THIS attempt is
    // skipped next time round: a job that already burned 10 minutes proving fal
    // can't render it must not re-buy that proof on every retry.
    if (!talkingUrl && falEnabled() && !resume.falError && animSourceUrl && audioHostedUrl) {
      let falHandle: Awaited<ReturnType<typeof submitAvatar>> | null = null;
      try {
        // checkpoint the queue id the instant it exists — BEFORE the 10-min
        // poll — so a restart re-attaches above instead of paying twice
        const h = await submitAvatar(animSourceUrl, audioHostedUrl);
        falHandle = h;
        await ckpt({ ckFalRequestId: h.requestId, ckEngine: "heygen-fal" });
        talkingUrl = await pollAvatar(h);
        engine = "heygen-fal";
      } catch (e) {
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 180);
        // A RENDER THAT DIED AND A RENDER WE STOPPED WATCHING ARE NOT THE SAME.
        //
        // Both used to land here and both cleared ckFalRequestId — the only
        // place the queue id was ever stored — and set ckFalError, which is a
        // permanent kill-switch for fal on this job. So a poll that merely ran
        // out of time threw away the handle to a live, ALREADY BILLED HeyGen
        // render, immediately bought a second performance on omni-human, and
        // made sure no later attempt could ever re-attach to the first. Two
        // renders paid for, one delivered, every time HeyGen was slow.
        const dead = e instanceof FalRenderFailed;
        if (dead) {
          console.error(`[ugc] fal heygen failed, falling back: ${msg}`);
          await ckpt({ ckFalError: msg, ckFalRequestId: "" });
        } else {
          // Still rendering. Watch a little longer before paying for a second
          // performance — HeyGen being slow is the common case, and buying omni
          // now means two renders billed and one delivered.
          if (falHandle) {
            try {
              talkingUrl = await pollAvatar(falHandle, 4 * 60_000);
              engine = "heygen-fal";
            } catch (again) {
              console.warn(`[ugc] fal heygen still not done after a second window: ${(again instanceof Error ? again.message : String(again)).slice(0, 140)}`);
            }
          }
          // Keep the handle either way, and do NOT set ckFalError — this attempt
          // proved nothing about whether fal can do the job, and RE-ATTACH #3
          // keys on the request id alone, so a retry can still collect the
          // render we have already paid for.
          if (!talkingUrl) {
            console.warn(`[ugc] fal heygen still rendering, falling back for now (handle kept): ${msg}`);
            await ckpt({ ckFalWaited: msg });
          }
        }
      }
    }
    for (let attempt = 0; attempt < 2 && !talkingUrl; attempt++) {
      try {
        // the engine is checkpointed at the moment it's CHOSEN, not after the
        // poll — a process that dies mid-poll must resume knowing what kind of
        // clip (lip-synced or silent) it is re-attaching to
        await ckpt({ ckEngine: "omni-human" });
        engine = "omni-human";
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
      await ckpt({ ckEngine: engine }); // written BEFORE the create — see above
      const klingId = await repCreate("kwaivgi/kling-v1.6-standard", {
        start_image: animSourceDataUri,
        prompt: `${avatar.desc}, talking directly to the camera with natural hand gestures and subtle head movement, enthusiastic friendly energy, static camera, plain studio background, vertical video. Anything held in frame stays SOLID and fully visible for the entire clip — same object, same size, same position in the hands, never fading, never vanishing, never re-forming.`,
        // "glitching in and out of his hands" — the motion brief never
        // mentioned the product, so nothing anchored it and the model treated
        // it as scenery it could drop between frames.
        negative_prompt: "object disappearing, product vanishing, flickering, fading in and out, object changing shape, hands passing through the product, camera movement, zoom, pan, morphing, distortion, extra people, text, watermark",
        duration: 10,
        cfg_scale: 0.5,
      });
      await ckpt({ ckKlingId: klingId }); // DISTINCT from ckOmniId — silent clip
      talkingUrl = await animatePoll(klingId, 12 * 60_000, "kling-fallback");
    }
    await ckpt({ ckTalkingUrl: talkingUrl, ckEngine: engine });
    return { url: talkingUrl, engine };
  };

  // 3) TALKING PERFORMANCE
  const acquired = await acquireTalking(true);
  let talkingUrl = acquired.url;
  let engine = acquired.engine;
  const fromCheckpointedUrl = !!resume.talkingUrl && talkingUrl === resume.talkingUrl;

  // 4) ASSEMBLY
  // From here to the asset write was the longest checkpoint-free stretch in the
  // app, and Job.updatedAt only moves on a write — so the reaper measured this
  // whole phase as "nothing has happened" and reclaimed live renders. On a
  // RESUMED job it is the entire attempt, because acquireTalking returns from
  // the checkpointed url without writing anything.
  await ckpt({ ckBeat: Date.now() });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ugc-"));
  try {
    const talkingPath = path.join(tmp, "talking.mp4");
    try {
      await download(talkingUrl, talkingPath);
    } catch (e) {
      // A checkpointed talking URL is a PROVIDER url and expires (~1h). Once it
      // dies, every remaining attempt used to fail on the same dead link and the
      // job refunded without ever shipping. Clear the checkpoint and render a
      // fresh performance instead — the merchant gets a video.
      if (!fromCheckpointedUrl) throw e;
      console.error(`[ugc] checkpointed talking url is dead (${(e instanceof Error ? e.message : String(e)).slice(0, 120)}) — re-rendering`);
      // The whole checkpoint generation is stale, not just the URL: re-polling
      // those predictions would hand back the same expired links. Clear them so
      // a later attempt doesn't re-attach to a corpse.
      await ckpt({ ckTalkingUrl: "", ckOmniId: "", ckKlingId: "", ckFalRequestId: "" });
      const fresh = await acquireTalking(false);
      talkingUrl = fresh.url;
      engine = fresh.engine;
      await download(talkingUrl, talkingPath);
    }
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
    const fileName = `ugc-${Date.now()}-${crypto.randomBytes(9).toString("hex")}.mp4`;
    const outPath = path.join(rendersDir, fileName);

    await assemble({
      jobId: params.jobId,
      talkingPath, audioPath, productImagePath, outPath,
      script: params.captions === false ? "" : script, // "" = no captions
      // omni-human AND fal HeyGen bake the lip-synced audio into their output;
      // only the silent kling fallback needs the TTS muxed over a looped clip.
      lipSynced: engine === "omni-human" || engine === "heygen-fal",
      cutaway: cutawayMode,
    });

    // Mirror to durable object storage (no-op unless configured) so the clip
    // survives disk resizes/instance changes.
    try { await mirrorRender(fileName, fs.readFileSync(outPath)); } catch { /* non-fatal */ }

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
          cutaway: cutawayMode, // plain-portrait A-roll + Ken Burns product beats
          voiceId: spokenVoice, // which voice ACTUALLY spoke — curation data
          voiceCast: delivery.voice, // which voice we intended to cast
          voiceFellBack, // true = premium designed voice was lost on this take
          voiceFallbackReason: voiceFallbackReason || undefined,
          voiceDelivery: delivery, // full cast signature: pitch/speed/emotion
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
          productImageUrl: params.productImageUrl || null,
          serviceMode: !!params.serviceMode,
        }),
      },
    });
    return asset.id;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* tmp cleanup best-effort */ }
  }
}
