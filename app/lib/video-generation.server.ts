// Video ad generation. Two user-selectable styles:
//   PRODUCT_HIGHLIGHT — dynamic AI product showcase (cheaper ~$2)
//   AI_AVATAR         — UGC-style AI spokesperson (~$3-4)
// Both run through Replicate. Video is the only high-cost deliverable, so
// it is always metered against the plan quota / video credits by the caller.

import { db } from "../db.server";
import type { BrandProfile, Plan } from "@prisma/client";

export type VideoStyle = "PRODUCT_HIGHLIGHT" | "AI_AVATAR";

// Replicate model slugs (using the model-predictions endpoint so we never
// have to chase version hashes). minimax/video-01 is a strong text+image →
// video model that works for both styles.
//   PRODUCT_HIGHLIGHT — seeds with the product image when available.
//   AI_AVATAR         — presenter-style prompt. (True script lip-sync needs a
//                       dedicated avatar provider like HeyGen; drop it in here.)
const VIDEO_MODEL = "minimax/video-01";

interface GenerateVideoParams {
  shopId: string;
  brandProfile: BrandProfile;
  plan: Plan;
  productTitle: string;
  productDescription?: string;
  productImageUrl?: string;
  style: VideoStyle;
  script?: string; // for AI_AVATAR; auto-written if omitted
  customPrompt?: string; // merchant-written prompt override
}

export async function generateVideoAd(params: GenerateVideoParams): Promise<string> {
  const {
    shopId,
    brandProfile,
    plan,
    productTitle,
    productDescription,
    productImageUrl,
    style,
  } = params;

  const visual = JSON.parse(brandProfile.visualJson);
  const voice = JSON.parse(brandProfile.voiceJson);

  const replicateToken = process.env.REPLICATE_API_TOKEN;
  if (!replicateToken) throw new Error("REPLICATE_API_TOKEN not set");

  // Build the input per style — a merchant-written prompt overrides the default.
  const defaultPrompt =
    style === "PRODUCT_HIGHLIGHT"
      ? `Dynamic product showcase video for ${productTitle}. ${visual.imageStyle || "clean, vibrant"}. Smooth camera motion, professional advertising quality, vertical, no text overlay.`
      : `UGC-style spokesperson enthusiastically presenting ${productTitle}. ${voice.tone} tone. Authentic, hand-held feel, vertical.`;
  const prompt = params.customPrompt?.trim() || defaultPrompt;

  // Only seed with the product image for the highlight style.
  const input: Record<string, unknown> = { prompt, prompt_optimizer: true };
  if (style === "PRODUCT_HIGHLIGHT" && productImageUrl) {
    input.first_frame_image = productImageUrl;
  }

  // Create the prediction via the model endpoint (no version hash needed).
  const createRes = await fetch(
    `https://api.replicate.com/v1/models/${VIDEO_MODEL}/predictions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${replicateToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input }),
    }
  );
  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Replicate video create failed (${createRes.status}): ${errText.slice(0, 200)}`);
  }

  const prediction = (await createRes.json()) as { id: string };

  // Video gen can take a couple minutes — poll up to ~5 min.
  let videoUrl: string | null = null;
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const poll = await fetch(
      `https://api.replicate.com/v1/predictions/${prediction.id}`,
      { headers: { Authorization: `Bearer ${replicateToken}` } }
    );
    const data = (await poll.json()) as { status: string; output?: string | string[]; error?: string };
    if (data.status === "succeeded" && data.output) {
      videoUrl = Array.isArray(data.output) ? data.output[0] : data.output;
      break;
    }
    if (data.status === "failed" || data.status === "canceled") {
      throw new Error(`Replicate video ${data.status}: ${data.error || "unknown"}`);
    }
  }
  if (!videoUrl) throw new Error("Replicate video timed out");

  const asset = await db.asset.create({
    data: {
      shopId,
      type: "VIDEO_AD",
      status: "PENDING",
      title: `${style === "AI_AVATAR" ? "Avatar" : "Product"} video — ${productTitle}`,
      bodyJson: JSON.stringify({ style, videoUrl, prompt }),
      metaJson: JSON.stringify({ style, productTitle }),
    },
  });
  return asset.id;
}
