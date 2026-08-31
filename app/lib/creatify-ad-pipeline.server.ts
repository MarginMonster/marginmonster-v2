/* Commercial (Cinematic) — the high-budget-commercial format, rendered by
 * Creatify's link-to-video engine: multi-scene filmic story ads with a
 * product packshot finale, the class of output our in-house UGC pipelines
 * deliberately do not attempt.
 *
 * Why a third-party engine here and nowhere else: cinematic multi-scene
 * generation is a whole studio discipline (shot lists, scene-to-scene
 * continuity, grade). Creatify sells exactly that, we hold an account, and
 * one clean adapter beats a year of rebuilding it. Everything the rest of
 * the app relies on stays ours: the Asset record, the render mirror, the
 * job-queue checkpointing, the token pricing.
 *
 * API surface (api.creatify.ai, X-API-ID/X-API-KEY headers):
 *   POST /api/links/link_with_params/  product facts -> link id (no scraping)
 *   POST /api/links/                   { url } fallback when only a URL exists
 *   POST /api/link_to_videos/          link + style/length/ratio -> render task
 *   GET  /api/link_to_videos/{id}/     poll: status done|error, video_output
 *   GET  /api/remaining_credits/       health + budget guard
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "../db.server";
import { mirrorRender } from "./object-storage.server";
import { checkpointJob, download } from "./ugc-ad-pipeline.server";
import type { BrandProfile } from "@prisma/client";

export function creatifyEnabled(): boolean {
  return !!(process.env.CREATIFY_API_ID?.trim() && process.env.CREATIFY_API_KEY?.trim());
}

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-API-ID": process.env.CREATIFY_API_ID!.trim(),
    "X-API-KEY": process.env.CREATIFY_API_KEY!.trim(),
  };
}

const BASE = "https://api.creatify.ai";

async function creatify<T>(method: "GET" | "POST", p: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`creatify ${method} ${p} ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text) as T; } catch { throw new Error(`creatify ${method} ${p}: unparseable response`); }
}

/** Credits left on the account — the health check, and the guard that stops
 *  a merchant's paid job from entering a queue the account cannot pay for. */
export async function creatifyCredits(): Promise<number | null> {
  try {
    const r = await creatify<{ remaining_credits?: number }>("GET", "/api/remaining_credits/");
    return typeof r.remaining_credits === "number" ? r.remaining_credits : null;
  } catch {
    return null;
  }
}

export interface CommercialAdParams {
  shopId: string;
  brandProfile: BrandProfile;
  productTitle: string;
  productDescription?: string;
  productImageUrl?: string;
  /** More angles help the scene generator; first entry doubles as the still. */
  productImageUrls?: string[];
  /** Merchant's product page — fallback link source when we have no images. */
  productPageUrl?: string;
  /** Merchant direction (Studio prompt) → steers the script. */
  direction?: string;
  /** 15 | 30 | 60 — Creatify renders fixed lengths. */
  lengthSec?: number;
  /** e.g. "9x16" (default), "16x9", "1x1" */
  aspectRatio?: string;
  origin?: string;
  jobId?: string;
  resume?: { creatifyLinkId?: string; creatifyVideoId?: string };
}

/** Full commercial: link -> render task -> poll -> mirror -> Asset id.
 *  Checkpoints both paid ids so a queue restart re-attaches instead of
 *  re-buying — same money rule as every other pipeline here. */
export async function generateCommercialAd(params: CommercialAdParams): Promise<string> {
  if (!creatifyEnabled()) throw new Error("Creatify is not configured (CREATIFY_API_ID / CREATIFY_API_KEY)");
  const ckpt = (patch: Record<string, unknown>) =>
    params.jobId ? checkpointJob(params.jobId, patch) : Promise.resolve();

  // 1) LINK — the product facts Creatify plans scenes from. Facts we already
  // hold go straight in; scraping the merchant's page is the fallback, not
  // the default, because catalogue data is cleaner than any scraper.
  let linkId = params.resume?.creatifyLinkId || "";
  if (!linkId) {
    const images = (params.productImageUrls?.length ? params.productImageUrls : [params.productImageUrl]).filter(
      (u): u is string => !!u
    );
    try {
      if (!images.length) throw new Error("no product images — trying page URL");
      const link = await creatify<{ id: string }>("POST", "/api/links/link_with_params/", {
        title: params.productTitle,
        description: (params.productDescription || params.productTitle).slice(0, 1000),
        image_urls: images.slice(0, 6),
      });
      linkId = link.id;
    } catch (e) {
      if (!params.productPageUrl) throw e;
      const link = await creatify<{ id: string }>("POST", "/api/links/", { url: params.productPageUrl });
      linkId = link.id;
    }
    await ckpt({ ckCreatifyLinkId: linkId });
  }

  // 2) RENDER TASK. Style knobs are env-tunable while we learn which of
  // Creatify's looks reads most "high-budget" — no redeploy per experiment.
  let videoId = params.resume?.creatifyVideoId || "";
  if (!videoId) {
    const body: Record<string, unknown> = {
      link: linkId,
      name: `EasyMode commercial — ${params.productTitle}`.slice(0, 80),
      video_length: params.lengthSec === 30 || params.lengthSec === 60 ? params.lengthSec : 15,
      aspect_ratio: params.aspectRatio || "9x16",
      language: "en",
      target_audience: params.direction ? undefined : "online shoppers",
      override_script: undefined,
    };
    if (params.direction) body.target_audience = params.direction.slice(0, 300);
    const vs = process.env.CREATIFY_VISUAL_STYLE?.trim();
    if (vs) body.visual_style = vs;
    const ss = process.env.CREATIFY_SCRIPT_STYLE?.trim();
    if (ss) body.script_style = ss;
    const task = await creatify<{ id: string }>("POST", "/api/link_to_videos/", body);
    videoId = task.id;
    await ckpt({ ckCreatifyVideoId: videoId });
  }

  // 3) POLL. Cinematic renders take minutes; 10s x 120 = 20 min ceiling.
  let videoUrl = "";
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const v = await creatify<{ status?: string; video_output?: string; failed_reason?: string; error_message?: string }>(
      "GET",
      `/api/link_to_videos/${videoId}/`
    );
    const status = (v.status || "").toLowerCase();
    if (status === "done" && v.video_output) { videoUrl = v.video_output; break; }
    if (status === "error" || status === "failed") {
      throw new Error(`creatify render failed: ${(v.failed_reason || v.error_message || "no reason given").slice(0, 200)}`);
    }
  }
  if (!videoUrl) throw new Error(`creatify render ${videoId} did not finish within 20 minutes`);

  // 4) OWN THE BYTES. Provider URLs expire; /renders + the mirror do not.
  const rendersDir = path.join(process.cwd(), "data", "renders");
  fs.mkdirSync(rendersDir, { recursive: true });
  const fileName = `commercial-${Date.now()}-${crypto.randomBytes(9).toString("hex")}.mp4`;
  const outPath = path.join(rendersDir, fileName);
  await download(videoUrl, outPath);
  try { await mirrorRender(fileName, fs.readFileSync(outPath)); } catch { /* non-fatal */ }

  const asset = await db.asset.create({
    data: {
      shopId: params.shopId,
      type: "VIDEO_AD",
      status: "PENDING",
      title: `Commercial — ${params.productTitle}`,
      bodyJson: JSON.stringify({
        style: "COMMERCIAL",
        engine: "creatify",
        videoUrl: `/renders/${fileName}`,
        creatifyVideoId: videoId,
        sourceUrl: videoUrl,
      }),
      metaJson: JSON.stringify({
        style: "COMMERCIAL",
        productTitle: params.productTitle,
        direction: params.direction || null,
        origin: params.origin || null,
        productImageUrl: params.productImageUrl || null,
        lengthSec: params.lengthSec || 15,
        aspectRatio: params.aspectRatio || "9x16",
      }),
    },
  });
  return asset.id;
}
