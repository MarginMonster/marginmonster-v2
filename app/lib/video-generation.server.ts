// Video ad generation. Two user-selectable styles:
//   PRODUCT_HIGHLIGHT — dynamic AI product showcase (cheaper ~$2)
//   AI_AVATAR         — UGC-style AI spokesperson (~$3-4)
// Both run through Replicate. Video is the only high-cost deliverable, so
// it is always metered against the plan quota / video credits by the caller.

import { db } from "../db.server";
import type { BrandProfile, Plan } from "@prisma/client";

export type VideoStyle = "PRODUCT_HIGHLIGHT" | "AI_AVATAR";

// Replicate model versions. Swap these for whichever provider you standardize on.
const MODELS = {
  // Image-to-video product highlight (e.g. Kling / Stable Video Diffusion family)
  PRODUCT_HIGHLIGHT: {
    version: "REPLACE_WITH_KLING_OR_SVD_VERSION",
  },
  // Talking AI avatar / UGC (e.g. an avatar TTS+lipsync model)
  AI_AVATAR: {
    version: "REPLACE_WITH_AVATAR_MODEL_VERSION",
  },
};

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

  const model = MODELS[style];

  // Build the input per style — a merchant-written prompt overrides the default.
  const defaultPrompt =
    style === "PRODUCT_HIGHLIGHT"
      ? `Dynamic product showcase video for ${productTitle}. ${visual.imageStyle || "clean, vibrant"}. Smooth camera motion, professional advertising quality, 9:16 vertical, no text overlay.`
      : `UGC-style spokesperson enthusiastically presenting ${productTitle}. ${voice.tone} tone. Authentic, hand-held feel, 9:16 vertical.`;
  const prompt = params.customPrompt?.trim() || defaultPrompt;

  // If the model versions aren't configured yet, create a PENDING asset that
  // records the request so the flow works end-to-end and video wiring is a
  // drop-in later (swap the MODELS versions above and this branch is skipped).
  if (model.version.startsWith("REPLACE_WITH")) {
    const asset = await db.asset.create({
      data: {
        shopId,
        type: "VIDEO_AD",
        status: "PENDING",
        title: `${style === "AI_AVATAR" ? "Avatar" : "Product"} video — ${productTitle}`,
        bodyJson: JSON.stringify({ style, prompt, status: "awaiting_video_provider" }),
        metaJson: JSON.stringify({ style, productTitle }),
      },
    });
    return asset.id;
  }

  // Real generation path.
  const createRes = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${replicateToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: model.version,
      input: {
        prompt,
        ...(productImageUrl ? { image: productImageUrl } : {}),
      },
    }),
  });
  if (!createRes.ok) throw new Error(`Replicate video create failed: ${createRes.status}`);

  const prediction = (await createRes.json()) as { id: string };

  let videoUrl: string | null = null;
  for (let i = 0; i < 90; i++) {
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
    if (data.status === "failed") throw new Error(`Replicate video failed: ${data.error}`);
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
