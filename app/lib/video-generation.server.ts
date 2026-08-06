// Video ad generation. Two user-selectable styles:
//   PRODUCT_HIGHLIGHT — dynamic AI product showcase (cheaper ~$2)
//   AI_AVATAR         — UGC-style AI spokesperson (~$3-4)
// Both run through Replicate. Video is the only high-cost deliverable, so
// it is always metered against the plan quota / video credits by the caller.

import { db } from "../db.server";
import type { BrandProfile, Plan } from "@prisma/client";
import { AVATAR_BY_ID, OUTFITS } from "./avatars";
import { animateCreate, animatePoll, checkpointJob, DEFAULT_ANIMATE_MODEL, repCreate, repPoll } from "./ugc-ad-pipeline.server";

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
  serviceMode?: boolean; // intangible offer — sell the outcome, not a product on screen
  script?: string; // for AI_AVATAR; auto-written if omitted
  customPrompt?: string; // merchant direction, appended to the base prompt
  avatarId?: string; // cast member (avatars.ts) — portrait seeds the first frame
  avatarVariant?: number; // wardrobe variant 0-3 (see OUTFITS)
  videoEngine?: string; // engine-picker key (video-engines.ts); undefined = default
  commercial?: boolean; // big-budget studio-commercial look (color-block cyc, hero lighting)
  breakout?: boolean; // the product bursts OUT of a mock social post card, in motion
  jobId?: string; // enables prediction checkpointing (see resume)
  resume?: {
    /** A prediction that a previous attempt already CREATED — and therefore
     *  already paid for. Without this, a restart (or any retry) mid-poll bought
     *  a brand-new video every time: three attempts, three bills, one asset. */
    predictionId?: string;
  };
}

// minimax/video-01 routinely runs past 5 minutes; the old ~5-min ceiling threw
// "timed out" on predictions that went on to succeed — a paid render thrown
// away, and the retry paid for another one.
const VIDEO_POLL_MS = 12 * 60_000;

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

  // `|| "{}"`: a half-built brand profile (null/empty column) must not throw a
  // SyntaxError here — that terminal-fails a pre-paid job before a single
  // provider call, on every retry.
  const visual = JSON.parse(brandProfile.visualJson || "{}");
  const voice = JSON.parse(brandProfile.voiceJson || "{}");

  // fail fast with a clear message before building any prompt (repCreate/
  // repPoll read the token themselves)
  if (!process.env.REPLICATE_API_TOKEN) throw new Error("REPLICATE_API_TOKEN not set");

  // Build the base prompt per style; the chosen cast member's descriptor keeps
  // the presenter's identity, and merchant direction is APPENDED (not a
  // replacement) so custom control never loses the quality floor.
  const avatar = params.avatarId ? AVATAR_BY_ID[params.avatarId] : undefined;
  const variant = Math.max(0, Math.min(OUTFITS.length - 1, params.avatarVariant ?? 0));
  const outfit = OUTFITS[variant];
  // The COMMERCIAL look — big-budget studio spot: seamless color-block cyc
  // matched to the product's palette, hero lighting, confident camera.
  // BREAKOUT in motion: the still already composes the product bursting out of
  // a generic post card, so the motion brief only has to sell the DEPTH — the
  // product pushing further toward camera while the card holds still behind it.
  const breakoutLook = `The product bursts OUT of a flat social-post card that sits behind it: the card stays static and flat while the product pushes further toward the camera in true 3D, its shadow sliding across the card as it emerges. Subtle parallax between the product, the card and the background, gentle float, premium product-commercial finish, vertical, no text overlay, no new lettering.`;
  const commercialLook = `High-budget television commercial: the product hero-lit on a seamless single-color studio cyc wall and floor in a bold saturated color that complements the product's palette, crisp professional three-point lighting, subtle floor reflection, confident slow camera push-in and orbit, premium big-brand energy, vertical, no text overlay.`;
  const basePrompt =
    style === "AI_AVATAR" && avatar
      // This path has NO lip-sync (see VIDEO_MODEL note above), so a presenter
      // animated mid-speech is guaranteed to look out of time with whatever
      // audio plays over it — the same fault found in the cartoon pipeline.
      // Gestures and presence, not talking.
      ? `UGC-style spokesperson video: ${avatar.desc}, wearing ${outfit.desc}, warmly showing ${productTitle} to the camera with natural gestures. ${voice.tone} tone. The presenter does NOT speak — no mouth movement, no lip movement, mouth closed or in a natural smile. Authentic hand-held creator feel, vertical.`
      : style === "AI_AVATAR"
        ? `UGC-style spokesperson warmly showing ${productTitle} to camera with natural gestures. ${voice.tone} tone. The presenter does NOT speak — no mouth movement, mouth closed or smiling. Authentic, hand-held feel, vertical.`
        : params.breakout
          ? `${breakoutLook} The product: ${productTitle}.`
          : params.commercial
          ? `${commercialLook} The product: ${productTitle}.`
          : params.serviceMode
          ? `Cinematic promotional video that conveys the BENEFIT and outcome of "${productTitle}" (a service/offer, not a physical product). ${visual.imageStyle || "clean, vibrant"}. Aspirational lifestyle moments of someone enjoying the result, smooth camera motion, professional advertising quality, vertical, no text overlay.`
          : `Dynamic product showcase video for ${productTitle}. ${visual.imageStyle || "clean, vibrant"}. Smooth camera motion, professional advertising quality, vertical, no text overlay.`;
  const direction = params.customPrompt?.trim();
  const context = productDescription?.trim()
    ? ` Product context: ${productDescription.trim().slice(0, 200)}.`
    : "";
  const prompt = `${basePrompt}${context}${direction ? ` Direction: ${direction}` : ""}`;

  // Seed frame: the presenter portrait (avatar) or the product photo.
  let seedImage: string | undefined;
  if (style === "AI_AVATAR" && avatar) {
    const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    if (base) seedImage = `${base}/avatars/${avatar.id}_${variant}.jpg`;
  } else if (style === "PRODUCT_HIGHLIGHT" && productImageUrl) {
    seedImage = productImageUrl;
    // Breakout animates a COMPOSED frame, not the bare product photo: the
    // still renderer already knows how to build the mock card + pop-out, so
    // the video and image versions of this style stay identical. Any failure
    // falls back to the plain photo rather than losing the render.
    if (params.breakout) {
      try {
        const { renderFormatFrame } = await import("./image-generation.server");
        const framed = await renderFormatFrame(
          "breakout", productTitle, productImageUrl,
          voice.tone as string | undefined, params.customPrompt,
          (await db.shop.findUnique({ where: { id: shopId }, select: { contentLang: true } }))?.contentLang
        );
        if (framed) seedImage = framed;
      } catch { /* keep the plain product photo */ }
    }
  }

  // Create + poll go through the shared Replicate helpers (repCreate/repPoll):
  // the hand-rolled versions here threw on ANY non-2xx — including a 429 — and
  // polled with no res.ok check at all, so one bad poll response killed a paid,
  // still-running prediction.
  const ckpt = (patch: Record<string, unknown>) =>
    params.jobId ? checkpointJob(params.jobId, patch) : Promise.resolve();

  let videoUrl: string | null = null;

  // RE-ATTACH first: a prediction a previous attempt created is already billed.
  if (params.resume?.predictionId) {
    try {
      videoUrl = await animatePoll(params.resume.predictionId, VIDEO_POLL_MS, "video(resumed)");
    } catch (e) {
      console.error("[video] resumed prediction unusable — starting a fresh one:", e instanceof Error ? e.message.slice(0, 200) : e);
    }
  }

  if (!videoUrl) {
    // Engine-picker path: a chosen engine (with a seed frame) runs through the
    // multi-engine adapter, which falls back to the default engine on rejection.
    let predictionId: string;
    let ranModel: string;
    if (params.videoEngine && seedImage) {
      const created = await animateCreate(params.videoEngine, { startImage: seedImage, prompt });
      predictionId = created.id;
      ranModel = created.model;
    } else {
      const input: Record<string, unknown> = { prompt, prompt_optimizer: true };
      if (seedImage) input.first_frame_image = seedImage;
      predictionId = await repCreate(VIDEO_MODEL, input);
      ranModel = VIDEO_MODEL;
    }
    // Checkpoint BEFORE polling — the render is live and billing from here, so
    // a restart must re-attach to it rather than buy another one.
    await ckpt({ ckVideoPredId: predictionId });

    try {
      videoUrl = await animatePoll(predictionId, VIDEO_POLL_MS, "video");
    } catch (e) {
      // animateCreate only falls back when the premium engine rejects at CREATE
      // time; a premium engine that accepts and then fails at inference used to
      // surface here and kill the job. Give it the same one-shot fallback to the
      // default engine that a create-time rejection gets.
      if (!seedImage || ranModel === DEFAULT_ANIMATE_MODEL) throw e;
      // "kling25" forces the Replicate path: retrying the default would go
      // straight back to the fal engine that just failed at inference.
      console.error(`[video] ${ranModel} failed at inference — retrying on ${DEFAULT_ANIMATE_MODEL}:`, e instanceof Error ? e.message.slice(0, 200) : e);
      const retry = await animateCreate("kling25", { startImage: seedImage, prompt });
      await ckpt({ ckVideoPredId: retry.id });
      videoUrl = await animatePoll(retry.id, VIDEO_POLL_MS, "video(default-engine)");
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
      // productImageUrl is what a REMIX rebuilds from. Without it the remix
      // regenerates the product from its name — 150 tokens of something else.
      metaJson: JSON.stringify({ style, productTitle, avatarId: avatar?.id || null, avatarVariant: avatar ? variant : null, direction: params.customPrompt || null, productImageUrl: params.productImageUrl || null, serviceMode: !!params.serviceMode }),
    },
  });
  return asset.id;
}
