/* Earworm pipeline — an AI-SUNG ad with early-2000s commercial energy:
 *   1. LYRICS — Claude writes a short, catchy jingle (product name repeated,
 *               tagline close) in the brand's voice
 *   2. SONG   — minimax music-01 sings it (tolerant input variants, then a
 *               bark sing-song fallback) — the jingle IS the ad
 *   3. VISUAL — product keyframe → kling hero-motion clip (flux-dev paints
 *               the scene when there's no photo / service mode)
 *   4. ASSEMBLY — shared ffmpeg assembler: loop the clip under the song,
 *                 burn the lyrics as karaoke-style captions
 * Music models are the newest piece of the stack, so every failure path is
 * graceful: the job errors cleanly and the queue refunds the tokens. */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { db } from "../db.server";
import { anthropicText } from "./anthropic.server";
import { mirrorRender } from "./object-storage.server";
import {
  assemble,
  checkpointJob,
  download,
  ffprobeDuration,
  repCreate,
  repPoll,
  runFfmpeg,
} from "./ugc-ad-pipeline.server";
import type { BrandProfile } from "@prisma/client";

const MAX_AD_SECONDS = 30; // jingles can run long — ads shouldn't

interface JingleAdParams {
  shopId: string;
  brandProfile: BrandProfile;
  productTitle: string;
  productDescription?: string;
  productImageUrl?: string;
  direction?: string; // merchant's custom prompt
  serviceMode?: boolean;
  origin?: string;
  jobId?: string;
  resume?: {
    lyrics?: string;
    songUrl?: string;
    engine?: string; // which music engine actually sang the checkpointed song
    keyframeUrl?: string;
    klingPredictionId?: string; // re-attach to a live animate run — never re-buy it
    animUrl?: string;
  };
}

/** Community models can't use the official-models endpoint repCreate posts
 *  to — they need /v1/predictions with a pinned version hash. */
async function repCreateVersion(version: string, input: Record<string, unknown>): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("[jingle] REPLICATE_API_TOKEN not set");
  const res = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ version, input }),
  });
  if (!res.ok) throw new Error(`[jingle] versioned create ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = (await res.json()) as { id: string };
  return j.id;
}

/** Music model outputs vary: bare url string, array, or an object keyed
 *  audio/audio_out/audio_url. Normalize to a url or throw. */
function audioUrlOf(raw: unknown, stage: string): string {
  if (typeof raw === "string" && raw) return raw;
  const o = raw as { audio_out?: string; audio?: string | { url?: string }; audio_url?: string } | null;
  const url = o?.audio_out || o?.audio_url || (typeof o?.audio === "string" ? o.audio : o?.audio?.url);
  if (url) return url;
  throw new Error(`[jingle:${stage}] no audio url in result`);
}

// suno-ai/bark is a community model — pinned to its long-stable version.
const BARK_VERSION = "b76242b40d67c76ab6742e987628a2a9ac019e11d56ab96c4e91ce03b79b2787";

/** Sing the lyrics. Engine chain: minimax music-1.5 (text-to-music with
 *  vocals, no reference audio needed) → music-01 → bark's ♪-wrapped sing-song
 *  read of the hook (lo-fi, but fits the retro-commercial brief). Every step
 *  is schema-drift tolerant; total failure throws and the queue refunds. */
async function singJingle(lyrics: string): Promise<{ url: string; engine: string }> {
  const errors: string[] = [];
  const style = "upbeat catchy retro TV-commercial jingle, early 2000s advertising energy, bright cheerful vocals, short and punchy";
  const attempts: { model: string; input: Record<string, unknown>; engine: string }[] = [
    { model: "minimax/music-1.5", input: { lyrics, prompt: style }, engine: "minimax-music-1.5" },
    { model: "minimax/music-1.5", input: { lyrics }, engine: "minimax-music-1.5" },
    { model: "minimax/music-01", input: { lyrics }, engine: "minimax-music-01" },
  ];
  for (const a of attempts) {
    try {
      const id = await repCreate(a.model, a.input);
      const raw = (await repPoll(id, 6 * 60_000, "jingle-music")) as unknown;
      return { url: audioUrlOf(raw, "music"), engine: a.engine };
    } catch (e) {
      errors.push((e as Error).message.slice(0, 120));
    }
  }
  try {
    const hook = lyrics.split("\n").filter(Boolean).slice(0, 3).join(". ");
    const id = await repCreateVersion(BARK_VERSION, {
      prompt: `♪ ${hook} ♪`,
      history_prompt: "announcer",
      text_temp: 0.7,
    });
    const raw = (await repPoll(id, 6 * 60_000, "jingle-bark")) as unknown;
    return { url: audioUrlOf(raw, "bark"), engine: "bark" };
  } catch (e) {
    errors.push((e as Error).message.slice(0, 120));
  }
  throw new Error(`[jingle:music] every engine failed: ${errors.join(" | ")}`);
}

export async function generateJingleAd(params: JingleAdParams): Promise<string> {
  const voiceJson = JSON.parse(params.brandProfile.voiceJson || "{}");
  const resume = params.resume || {};
  const ckpt = (patch: Record<string, unknown>) =>
    params.jobId ? checkpointJob(params.jobId, patch) : Promise.resolve();

  // 1) LYRICS — short and sticky. ≤45 words so the whole lyric fits the
  // caption budget and the song stays ad-length.
  let lyrics = resume.lyrics || "";
  if (!lyrics) {
    const lyricsPrompt = [
      `You write short advertising JINGLES — early-2000s TV-commercial energy, the kind that gets stuck in your head.`,
      params.serviceMode
        ? `The offer (a service, not a physical product): "${params.productTitle}". Sing the RESULT the customer gets.`
        : `The product: "${params.productTitle}".`,
      params.productDescription ? `Context: ${params.productDescription.slice(0, 250)}` : "",
      voiceJson.tone ? `Brand voice/tone: ${voiceJson.tone}.` : "",
      params.direction ? `Merchant direction (follow it): ${params.direction}` : "",
      ``,
      `Rules: 5 or 6 SHORT lines, 45 words maximum total. Simple rhymes, a`,
      `bouncy singable rhythm, and the product name sung at least twice. The`,
      `last line is a tagline that lands like a hook. No emoji, no hashtags,`,
      `no quotes, no stage directions — output ONLY the lyric lines, one per line.`,
    ]
      .filter(Boolean)
      .join("\n");
    lyrics = ((await anthropicText(lyricsPrompt, { model: "claude-sonnet-5", maxTokens: 250 })) || "")
      .replace(/["“”]+/g, "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 6)
      .join("\n")
      .trim();
    if (!lyrics) throw new Error("[jingle:lyrics] empty lyrics from model");
    const words = lyrics.split(/\s+/);
    if (words.length > 48) lyrics = words.slice(0, 48).join(" ");
    await ckpt({ ckLyrics: lyrics });
  }

  // 2) SONG — a resumed job keeps the TRUE engine of the checkpointed song.
  let songUrl = resume.songUrl || "";
  let engine = (songUrl && resume.engine) || "minimax-music-1.5";
  if (!songUrl) {
    const sung = await singJingle(lyrics);
    songUrl = sung.url;
    engine = sung.engine;
    await ckpt({ ckSongUrl: songUrl, ckEngine: engine });
  }

  // 3) VISUAL — hero-motion product clip the song plays over.
  let keyframeUrl = resume.keyframeUrl || "";
  if (!keyframeUrl) {
    if (!params.serviceMode && params.productImageUrl) {
      keyframeUrl = params.productImageUrl; // the real photo IS the keyframe
    } else {
      const prompt =
        `Bright joyful retro TV-commercial scene for "${params.productTitle}"` +
        `${params.serviceMode ? " (a service — show the happy outcome, delighted people)" : ""}, ` +
        `sunny saturated colors, clean advertising composition, nostalgic early-2000s optimism, ` +
        `vertical 9:16, no text, no watermark.`;
      const id = await repCreate("black-forest-labs/flux-dev", {
        prompt,
        num_inference_steps: 30,
        guidance: 3,
        aspect_ratio: "9:16",
        output_format: "jpg",
        output_quality: 92,
      });
      keyframeUrl = await repPoll(id, 5 * 60_000, "jingle-keyframe");
    }
    await ckpt({ ckKeyframeUrl: keyframeUrl });
  }

  // Hosted URLs (Shopify CDN photo or replicate.delivery frame) go straight
  // to kling — no multi-MB base64 body, no size floor to trip on small legit
  // images. Restarts mid-poll re-attach to the SAME paid prediction.
  let animUrl = resume.animUrl || "";
  if (!animUrl && resume.klingPredictionId) {
    try {
      animUrl = await repPoll(resume.klingPredictionId, 12 * 60_000, "jingle-animate(resumed)");
      await ckpt({ ckAnimUrl: animUrl });
    } catch { /* old prediction died — fall through to a fresh one */ }
  }
  if (!animUrl) {
    const klingId = await repCreate("kwaivgi/kling-v1.6-standard", {
      start_image: keyframeUrl,
      prompt: `Upbeat retro TV-commercial hero shot: the product stays the clear star, slow confident camera push-in, gentle sparkle and shine sweeps, bright cheerful energy, vertical video.`,
      negative_prompt: "morphing, distortion, extra objects, people appearing, text, watermark, blur, style change",
      duration: 10,
      cfg_scale: 0.5,
    });
    await ckpt({ ckKlingId: klingId });
    animUrl = await repPoll(klingId, 12 * 60_000, "jingle-animate");
    await ckpt({ ckAnimUrl: animUrl });
  }

  // 4) ASSEMBLY — trim long songs to ad length (with a fade), then loop the
  // clip under the song and burn the lyrics as captions.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jingle-"));
  try {
    const animPath = path.join(tmp, "anim.mp4");
    await download(animUrl, animPath);
    const rawSongPath = path.join(tmp, "song-raw.audio");
    await download(songUrl, rawSongPath);

    let songPath = rawSongPath;
    const songDur = ffprobeDuration(rawSongPath);
    if (songDur > MAX_AD_SECONDS) {
      const trimmed = path.join(tmp, "song.mp3");
      const fadeStart = MAX_AD_SECONDS - 1.5;
      const run = await runFfmpeg([
        "-y", "-i", rawSongPath,
        "-t", String(MAX_AD_SECONDS),
        "-af", `afade=t=out:st=${fadeStart}:d=1.5`,
        "-c:a", "libmp3lame", "-b:a", "192k",
        trimmed,
      ]);
      if (run.status === 0 && fs.existsSync(trimmed)) songPath = trimmed;
      else console.error(`[jingle] trim failed — shipping full-length song (${Math.round(songDur)}s): ${(run.stderr || "").slice(-200)}`);
    }

    const rendersDir = path.join(process.cwd(), "data", "renders");
    fs.mkdirSync(rendersDir, { recursive: true });
    const fileName = `jingle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
    const outPath = path.join(rendersDir, fileName);

    await assemble({
      talkingPath: animPath,
      audioPath: songPath,
      productImagePath: null,
      script: lyrics.replace(/\n/g, " "), // karaoke-style caption feed
      outPath,
      lipSynced: false, // silent clip looped under the song
    });

    try { await mirrorRender(fileName, fs.readFileSync(outPath)); } catch { /* non-fatal */ }

    const asset = await db.asset.create({
      data: {
        shopId: params.shopId,
        type: "VIDEO_AD",
        status: "PENDING",
        title: `Earworm jingle — ${params.productTitle}`,
        bodyJson: JSON.stringify({
          style: "JINGLE",
          engine,
          videoUrl: `/renders/${fileName}`,
          lyrics,
          prompt: lyrics,
          script: lyrics,
        }),
        metaJson: JSON.stringify({
          style: "JINGLE",
          productTitle: params.productTitle,
          direction: params.direction || null,
          origin: params.origin || null,
        }),
      },
    });
    return asset.id;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}
