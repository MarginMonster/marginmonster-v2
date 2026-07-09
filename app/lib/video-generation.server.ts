// Video ad generation. Two user-selectable styles:
//   PRODUCT_HIGHLIGHT — dynamic AI product showcase (cheaper ~$2)
//   AI_AVATAR         — UGC-style AI spokesperson (~$3-4)
// Both run through Replicate. Video is the only high-cost deliverable, so
// it is always metered against the plan quota / video credits by the caller.

import { db } from "../db.server";
import type { BrandProfile, Plan } from "@prisma/client";
import { AVATAR_BY_ID } from "./avatars";

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
  customPrompt?: string; // merchant direction, appended to the base prompt
  avatarId?: string; // cast member (avatars.ts) — portrait seeds the first frame
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

  // Build the base prompt per style; the chosen cast member's descriptor keeps
  // the presenter's identity, and merchant direction is APPENDED (not a
  // replacement) so custom control never loses the quality floor.
  const avatar = params.avatarId ? AVATAR_BY_ID[params.avatarId] : undefined;
  const basePrompt =
    style === "AI_AVATAR" && avatar
      ? `UGC-style spokesperson video: ${avatar.desc}, enthusiastically presenting ${productTitle} to the camera. ${voice.tone} tone. Authentic hand-held creator feel, natural gestures, vertical.`
      : style === "AI_AVATAR"
        ? `UGC-style spokesperson enthusiastically presenting ${productTitle}. ${voice.tone} tone. Authentic, hand-held feel, vertical.`
        : `Dynamic product showcase video for ${productTitle}. ${visual.imageStyle || "clean, vibrant"}. Smooth camera motion, professional advertising quality, vertical, no text overlay.`;
  const direction = params.customPrompt?.trim();
  const prompt = direction ? `${basePrompt} Direction: ${direction}` : basePrompt;

  const input: Record<string, unknown> = { prompt, prompt_optimizer: true };
  if (style === "AI_AVATAR" && avatar) {
    // Seed the video with the cast member's portrait — the presenter you pick
    // is the presenter who appears.
    const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    if (base) input.first_frame_image = `${base}/avatars/${avatar.id}.jpg`;
  } else if (style === "PRODUCT_HIGHLIGHT" && productImageUrl) {
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
      title: `${style === "AI_AVATAR" ? (avatar ? `${avatar.name} presents` : "Avatar video") : "Product video"} — ${productTitle}`,
      bodyJson: JSON.stringify({ style, videoUrl, prompt }),
      metaJson: JSON.stringify({ style, productTitle, avatarId: avatar?.id || null }),
    },
  });
  return asset.id;
}
