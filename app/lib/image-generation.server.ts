import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { db } from "../db.server";
import type { BrandProfile, Plan } from "@prisma/client";
import { mirrorRender } from "./object-storage.server";
import { anthropicText } from "./anthropic.server";

/* ── On-image ad copy ──────────────────────────────────────────────────────
 * A high-quality still isn't a finished ad — real creatives carry a headline
 * and a call to action. Diffusion models garble text, so we generate the words
 * with Claude and composite them onto the image with ffmpeg (same font/engine
 * the video captions use). Everything here is best-effort: any failure falls
 * back to the clean image, never blocking generation. */

/** ≤5-word headline + ≤3-word CTA, written to sell the product/offer. */
async function adCopy(productTitle: string, tone: string | undefined, direction: string | undefined, serviceMode: boolean): Promise<{ headline: string; cta: string } | null> {
  try {
    const prompt = [
      `Write ad-creative text to overlay on a ${serviceMode ? "service/offer" : "product"} image ad.`,
      `${serviceMode ? "Offer" : "Product"}: "${productTitle}".`,
      tone ? `Brand tone: ${tone}.` : "",
      direction ? `Angle: ${direction.slice(0, 160)}.` : "",
      `Return ONLY JSON: {"headline":"...","cta":"..."}.`,
      `headline: MAX 5 words, punchy, benefit-first, no end punctuation. cta: MAX 3 words (e.g. "Shop now", "Get yours", "Start free").`,
      `No quotes, emoji, or hashtags inside the values.`,
    ].filter(Boolean).join("\n");
    const raw = await anthropicText(prompt, { model: "claude-sonnet-5", maxTokens: 120 });
    const m = raw && raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]) as { headline?: string; cta?: string };
    const clean = (s: string | undefined, n: number) => (s || "").replace(/["'“”]/g, "").trim().split(/\s+/).slice(0, n).join(" ");
    const headline = clean(j.headline, 6);
    const cta = clean(j.cta, 3);
    if (!headline) return null;
    return { headline, cta };
  } catch { return null; }
}

// drawtext is picky: escape the characters that break its filter parser.
const dt = (s: string) => s.replace(/\\/g, "").replace(/[':%]/g, "").replace(/[^\w \-!?.&]/g, "").trim();

/**
 * Composite a headline + CTA onto a square still with ffmpeg — a NEUTRAL
 * bottom fade-to-dark scrim with white type, the universal ad-creative look.
 * These images belong to the MERCHANT's brand, so no EasyMode colors ever
 * appear on them. Writes a new file and returns its name, or null if anything
 * goes wrong (caller keeps the clean image). Assumes ~1024px square output.
 */
function ffmpegBin(): string | null {
  // System ffmpeg first — the ffmpeg-static Linux build ships WITHOUT drawtext,
  // which is exactly what we need here (same reason the video pipeline does this).
  for (const p of ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", path.join(process.cwd(), "bin", "ffmpeg")]) {
    if (fs.existsSync(p)) return p;
  }
  return (ffmpegPath as unknown as string) || null;
}
async function overlayAdText(dir: string, srcName: string, headline: string, cta: string): Promise<string | null> {
  const bin = ffmpegBin();
  if (!bin) return null;
  const src = path.join(dir, srcName);
  if (!fs.existsSync(src)) return null;
  const outName = srcName.replace(/\.jpg$/, "") + "-ad.jpg";
  const out = path.join(dir, outName);
  const fontFile = path.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");
  if (!fs.existsSync(fontFile)) return null;
  const font = fontFile.replace(/\\/g, "/").replace(/:/g, "\\:");
  const hl = dt(headline).toUpperCase();
  const ct = dt(cta).toUpperCase();
  if (!hl) return null;
  // headline auto-shrinks to fit width via ffmpeg's text_w-aware fontsize isn't
  // available, so we pick a size that fits ~18 chars and rely on short copy.
  const hlSize = hl.length > 22 ? 46 : hl.length > 15 ? 58 : 70;
  const filters = [
    // stacked translucent black boxes fake a bottom fade — brand-neutral scrim
    // for legibility on ANY merchant's imagery (never EasyMode colors here)
    `drawbox=x=0:y=ih-330:w=iw:h=330:color=black@0.16:t=fill`,
    `drawbox=x=0:y=ih-250:w=iw:h=250:color=black@0.22:t=fill`,
    `drawbox=x=0:y=ih-165:w=iw:h=165:color=black@0.28:t=fill`,
    `drawtext=fontfile='${font}':text='${hl}':fontsize=${hlSize}:fontcolor=white:borderw=2:bordercolor=black@0.4:x=(w-text_w)/2:y=h-200`,
    ct ? `drawtext=fontfile='${font}':text='${ct}  >':fontsize=30:fontcolor=white@0.92:borderw=1:bordercolor=black@0.3:x=(w-text_w)/2:y=h-105` : "",
  ].filter(Boolean).join(",");
  const args = ["-y", "-i", src, "-vf", filters, "-frames:v", "1", "-q:v", "3", out];
  const ok = await new Promise<boolean>((resolve) => {
    try {
      const p = spawn(bin, args, { stdio: ["ignore", "ignore", "ignore"] });
      p.on("error", () => resolve(false));
      p.on("close", (code) => resolve(code === 0));
    } catch { resolve(false); }
  });
  if (ok && fs.existsSync(out) && fs.statSync(out).size > 5000) return outName;
  return null;
}

/** SELF-HEALING BACKFILL — image ads forged before durable storage carry
 *  replicate.delivery URLs that expired (~1h), leaving blank cards. Re-forge
 *  a few per worker tick from their stored prompts (~$0.003 each) and point
 *  them at the durable disk. Runs until no dead images remain. */
let lastBackfillScan = 0;
const BACKFILL_EVERY_MS = 10 * 60 * 1000; // worker ticks every ~8s — heal gently

export async function backfillDeadImages(): Promise<void> {
  if (Date.now() - lastBackfillScan < BACKFILL_EVERY_MS) return;
  lastBackfillScan = Date.now();
  const candidates = await db.asset.findMany({
    where: { type: "IMAGE_AD", bodyJson: { contains: "replicate.delivery" } },
    orderBy: { createdAt: "desc" },
    take: 3, // gentle per tick — burst-limits stay happy
  });
  for (const a of candidates) {
    try {
      const body = JSON.parse(a.bodyJson) as { imageUrl?: string; prompt?: string; sourceUrl?: string };
      if (!body.imageUrl?.includes("replicate.delivery")) {
        // contains() matched sourceUrl only — already healed; strip the marker
        await db.asset.update({ where: { id: a.id }, data: { bodyJson: JSON.stringify({ ...body, sourceUrl: undefined }) } });
        continue;
      }
      const prompt = body.prompt || "clean product photography, professional advertising quality, 1:1, vibrant colors";
      const localUrl = await fluxToDisk(prompt);
      await db.asset.update({
        where: { id: a.id },
        data: { bodyJson: JSON.stringify({ ...body, imageUrl: localUrl, sourceUrl: undefined, healed: true }) },
      });
      console.log(`[image-backfill] healed asset ${a.id}`);
    } catch (e) {
      console.error(`[image-backfill] asset ${a.id} failed (will retry next tick):`, e instanceof Error ? e.message : e);
    }
  }
}

/** Generate with flux-schnell and persist straight to the durable disk. */
async function fluxToDisk(prompt: string): Promise<string> {
  const replicateToken = process.env.REPLICATE_API_TOKEN;
  if (!replicateToken) throw new Error("REPLICATE_API_TOKEN not set");
  const createRes = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: { Authorization: `Bearer ${replicateToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      version: "5f24084160c9089501c1b3545d9be3c27883ae2239b6f412990e82d4a6210f8f",
      input: { prompt, num_inference_steps: 4, width: 1024, height: 1024 },
    }),
  });
  if (!createRes.ok) throw new Error(`Replicate create failed: ${createRes.status}`);
  const prediction = (await createRes.json()) as { id: string };
  let imageUrl: string | null = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: { Authorization: `Bearer ${replicateToken}` },
    });
    const pollData = (await pollRes.json()) as { status: string; output?: string[] | null; error?: string };
    if (pollData.status === "succeeded" && pollData.output) {
      imageUrl = Array.isArray(pollData.output) ? pollData.output[0] : pollData.output;
      break;
    }
    if (pollData.status === "failed") throw new Error(`Replicate generation failed: ${pollData.error}`);
  }
  if (!imageUrl) throw new Error("Replicate timed out");
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5_000) throw new Error("image too small");
  const dir = path.join(process.cwd(), "data", "renders");
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  fs.writeFileSync(path.join(dir, fileName), buf);
  try { await mirrorRender(fileName, buf); } catch { /* non-fatal */ }
  return `/renders/${fileName}`;
}

const PLAN_VISUAL_DIRECTION: Record<string, string> = {
  GROW_SALES: "lifestyle product shot, natural lighting, aspirational mood, conversion-optimized",
  LAUNCH_PRODUCT: "bold hero shot, dramatic lighting, excitement and novelty, launch energy",
  CLEAR_INVENTORY: "clean product on white, urgency cues, sale badge aesthetic",
  BUILD_AWARENESS: "brand story visual, emotional resonance, people + product, editorial style",
};

export async function generateImageAd(
  shopId: string,
  brandProfile: BrandProfile,
  plan: Plan,
  productTitle: string,
  productImageUrl?: string,
  stylePrompt?: string,
  avatarId?: string,
  avatarVariant?: number,
  wear?: boolean,
  scene?: string,
  serviceMode?: boolean
): Promise<string> {
  // PRESENTER STILL — an avatar holding the product (Content Studio presenter
  // path). Uses the same two-image compose engine as UGC video frames. Needs a
  // real product photo; falls through to the product still if unavailable.
  // Services have nothing to hold → skip straight to the outcome scene.
  if (!serviceMode && avatarId && productImageUrl && /^https?:\/\//.test(productImageUrl)) {
    try {
      const { submitCompose, pollCompose, falImageEnabled } = await import("./fal-image.server");
      if (falImageEnabled()) {
        const { resolvePortraitFile } = await import("./ugc-ad-pipeline.server");
        const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
        const portraitUrl = `${base}/avatars/${path.basename(resolvePortraitFile(avatarId, avatarVariant || 0))}`;
        const q = await submitCompose(portraitUrl, productImageUrl, productTitle, 1, wear ? "wear" : "hold", scene);
        let composed: string | undefined;
        for (let i = 0; i < 45; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const p = await pollCompose(q.statusUrl, q.responseUrl);
          if (p.done) { composed = p.urls?.[0]; break; }
        }
        if (composed) {
          let localUrl = composed;
          try {
            const res = await fetch(composed);
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer());
              if (buf.length > 5_000) {
                const dir = path.join(process.cwd(), "data", "renders");
                fs.mkdirSync(dir, { recursive: true });
                const fileName = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
                fs.writeFileSync(path.join(dir, fileName), buf);
                try { await mirrorRender(fileName, buf); } catch { /* non-fatal */ }
                localUrl = `/renders/${fileName}`;
                // Overlay headline + CTA (best-effort) so the presenter still is a real ad.
                try {
                  const voiceTone = (() => { try { return JSON.parse(brandProfile.voiceJson || "{}").tone as string | undefined; } catch { return undefined; } })();
                  const copy = await adCopy(productTitle, voiceTone, stylePrompt, false);
                  if (copy) {
                    const adName = await overlayAdText(dir, fileName, copy.headline, copy.cta);
                    if (adName) { localUrl = `/renders/${adName}`; try { await mirrorRender(adName, fs.readFileSync(path.join(dir, adName))); } catch { /* non-fatal */ } }
                  }
                } catch (e) { console.error("[image-ad] presenter overlay skipped:", e instanceof Error ? e.message : e); }
              }
            }
          } catch (e) { console.error("[image-ad] presenter still persist failed:", e); }
          const asset = await db.asset.create({
            data: {
              shopId, type: "IMAGE_AD", status: "PENDING",
              title: `${productTitle} — held by presenter`,
              bodyJson: JSON.stringify({ imageUrl: localUrl, sourceUrl: composed, prompt: `presenter holding ${productTitle}`, avatarId }),
              metaJson: JSON.stringify({ campaignGoal: plan.campaignGoal, productTitle, avatarId }),
            },
          });
          return asset.id;
        }
      }
    } catch (e) {
      console.error("[image-ad] presenter compose failed, falling back to product still:", e instanceof Error ? e.message : e);
    }
    // fall through to a normal product still if compose is unavailable/failed
  }

  const visual = JSON.parse(brandProfile.visualJson);
  const direction =
    PLAN_VISUAL_DIRECTION[plan.campaignGoal] || PLAN_VISUAL_DIRECTION.GROW_SALES;

  const replicateToken = process.env.REPLICATE_API_TOKEN;
  if (!replicateToken) throw new Error("REPLICATE_API_TOKEN not set");

  const jsonHeaders = { Authorization: `Bearer ${replicateToken}`, "Content-Type": "application/json" };
  const hasProductImg = !serviceMode && !!productImageUrl && /^https?:\/\//.test(productImageUrl);

  // SERVICE / offer → there's no product to photograph, so we sell the OUTCOME:
  // an aspirational lifestyle scene of someone enjoying the result. Text-heavy
  // "offer cards" render as garbled glyphs in diffusion models, so we stay
  // photoreal and let the caption carry the words.
  // The prompt actually used, captured across branches so it can be stored on
  // the asset. (A prior version referenced a block-scoped `prompt` at asset
  // creation, which threw ReferenceError in the Node worker and failed every
  // non-presenter image ad.)
  let usedPrompt = "";
  let createRes: Response;
  if (serviceMode) {
    usedPrompt = `${stylePrompt ? `${stylePrompt}. ` : ""}Premium lifestyle advertising photograph that sells the OUTCOME of "${productTitle}". ${stylePrompt ? "" : `${direction}. `}Show a happy, successful person clearly enjoying the benefit or result — aspirational, authentic, relatable, warm natural lighting. ${visual.imageStyle || "clean modern commercial photography"}. Photorealistic, sharp focus, natural realistic human anatomy and faces, flawless proportions, magazine-quality. Absolutely NO text, letters, words, watermarks, logos, charts, graphs or app screenshots.`;
    createRes = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-dev/predictions", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ input: { prompt: usedPrompt, num_inference_steps: 30, guidance: 3, aspect_ratio: "1:1", output_format: "jpg", output_quality: 92 } }),
    });
  } else if (hasProductImg) {
    usedPrompt = `Place this exact product, unchanged, as the hero of a premium advertising photograph. ${stylePrompt ? `${stylePrompt}. ` : ""}${direction}. ${visual.imageStyle || "clean professional product photography"}. Keep the product identical in shape, color, materials, logos and every detail. Photorealistic, magazine-quality commercial photography, sharp focus, natural realistic proportions, no added text or watermark.`;
    createRes = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ input: { prompt: usedPrompt, input_image: productImageUrl, aspect_ratio: "1:1", output_format: "jpg" } }),
    });
  } else {
    usedPrompt = `${stylePrompt ? `${stylePrompt}. ` : ""}Premium advertising photograph of ${productTitle}. ${direction}. ${visual.imageStyle || "clean professional product photography"}. Photorealistic, ultra high resolution, sharp focus, professional studio lighting, natural realistic human anatomy and faces, flawless proportions, magazine-quality commercial photography, no text, no watermark, no logo, no distortion.`;
    createRes = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-dev/predictions", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ input: { prompt: usedPrompt, num_inference_steps: 30, guidance: 3, aspect_ratio: "1:1", output_format: "jpg", output_quality: 92 } }),
    });
  }

  if (!createRes.ok) {
    throw new Error(`Replicate create failed: ${createRes.status}`);
  }

  const prediction = await createRes.json() as { id: string };

  // Poll until done (max 60s)
  let imageUrl: string | null = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(
      `https://api.replicate.com/v1/predictions/${prediction.id}`,
      { headers: { Authorization: `Bearer ${replicateToken}` } }
    );
    const pollData = await pollRes.json() as { status: string; output?: string[] | null; error?: string };
    if (pollData.status === "succeeded" && pollData.output) {
      imageUrl = Array.isArray(pollData.output)
        ? pollData.output[0]
        : pollData.output;
      break;
    }
    if (pollData.status === "failed") {
      throw new Error(`Replicate generation failed: ${pollData.error}`);
    }
  }

  if (!imageUrl) throw new Error("Replicate timed out");

  // Replicate delivery URLs EXPIRE (~1h) — ads were going blank in the queue
  // and auto-posting would fetch a dead link days later. Persist the bytes to
  // the durable renders disk and serve our own URL, like videos.
  let localUrl = imageUrl;
  try {
    const res = await fetch(imageUrl);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 5_000) {
        const dir = path.join(process.cwd(), "data", "renders");
        fs.mkdirSync(dir, { recursive: true });
        const fileName = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        fs.writeFileSync(path.join(dir, fileName), buf);
        try { await mirrorRender(fileName, buf); } catch { /* non-fatal */ }
        localUrl = `/renders/${fileName}`;

        // Make it an actual AD: overlay a headline + CTA. Best-effort — if the
        // copy or the ffmpeg composite fails, we keep the clean still.
        try {
          const voiceTone = (() => { try { return JSON.parse(brandProfile.voiceJson || "{}").tone as string | undefined; } catch { return undefined; } })();
          const copy = await adCopy(productTitle, voiceTone, stylePrompt, !!serviceMode);
          if (copy) {
            const adName = await overlayAdText(dir, fileName, copy.headline, copy.cta);
            if (adName) {
              localUrl = `/renders/${adName}`;
              try { await mirrorRender(adName, fs.readFileSync(path.join(dir, adName))); } catch { /* non-fatal */ }
            }
          }
        } catch (e) { console.error("[image-ad] text overlay skipped:", e instanceof Error ? e.message : e); }
      }
    }
  } catch (e) {
    console.error("[image-ad] persist failed, keeping remote url:", e);
  }

  const asset = await db.asset.create({
    data: {
      shopId,
      type: "IMAGE_AD",
      status: "PENDING",
      title: `Ad image for ${productTitle}`,
      bodyJson: JSON.stringify({ imageUrl: localUrl, sourceUrl: imageUrl, prompt: usedPrompt }),
      metaJson: JSON.stringify({ campaignGoal: plan.campaignGoal, productTitle }),
    },
  });

  return asset.id;
}
