import fs from "node:fs";
import path from "node:path";
import { db } from "../db.server";
import type { BrandProfile, Plan } from "@prisma/client";

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
  stylePrompt?: string
): Promise<string> {
  const visual = JSON.parse(brandProfile.visualJson);
  const direction =
    PLAN_VISUAL_DIRECTION[plan.campaignGoal] || PLAN_VISUAL_DIRECTION.GROW_SALES;

  const replicateToken = process.env.REPLICATE_API_TOKEN;
  if (!replicateToken) throw new Error("REPLICATE_API_TOKEN not set");

  const jsonHeaders = { Authorization: `Bearer ${replicateToken}`, "Content-Type": "application/json" };
  const hasProductImg = !!productImageUrl && /^https?:\/\//.test(productImageUrl);

  // WHEN WE HAVE THE REAL PRODUCT PHOTO → flux-KONTEXT rebuilds a premium scene
  // AROUND the actual product (keeps its exact shape/color/logo). Without it,
  // fall back to flux-DEV text2img from the title (schnell at 4 steps mangled
  // faces into "monsters" — dev at 30 steps is the quality tier).
  let createRes: Response;
  if (hasProductImg) {
    const scenePrompt = `Place this exact product, unchanged, as the hero of a premium advertising photograph. ${stylePrompt ? `${stylePrompt}. ` : ""}${direction}. ${visual.imageStyle || "clean professional product photography"}. Keep the product identical in shape, color, materials, logos and every detail. Photorealistic, magazine-quality commercial photography, sharp focus, natural realistic proportions, no added text or watermark.`;
    createRes = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ input: { prompt: scenePrompt, input_image: productImageUrl, aspect_ratio: "1:1", output_format: "jpg" } }),
    });
  } else {
    const prompt = `${stylePrompt ? `${stylePrompt}. ` : ""}Premium advertising photograph of ${productTitle}. ${direction}. ${visual.imageStyle || "clean professional product photography"}. Photorealistic, ultra high resolution, sharp focus, professional studio lighting, natural realistic human anatomy and faces, flawless proportions, magazine-quality commercial photography, no text, no watermark, no logo, no distortion.`;
    createRes = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-dev/predictions", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ input: { prompt, num_inference_steps: 30, guidance: 3, aspect_ratio: "1:1", output_format: "jpg", output_quality: 92 } }),
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
        localUrl = `/renders/${fileName}`;
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
      bodyJson: JSON.stringify({ imageUrl: localUrl, sourceUrl: imageUrl, prompt }),
      metaJson: JSON.stringify({ campaignGoal: plan.campaignGoal, productTitle }),
    },
  });

  return asset.id;
}
