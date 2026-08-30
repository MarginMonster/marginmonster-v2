// Video ad generation. Two user-selectable styles:
//   PRODUCT_HIGHLIGHT — dynamic AI product showcase (cheaper ~$2)
//   AI_AVATAR         — UGC-style AI spokesperson (~$3-4)
// Both run through Replicate. Video is the only high-cost deliverable, so
// it is always metered against the plan quota / video credits by the caller.

import { db } from "../db.server";
import type { BrandProfile, Plan } from "@prisma/client";
import { AVATAR_BY_ID, OUTFITS } from "./avatars";
import { trimToWord } from "./text-trim";
import { animateCreate, animatePoll, checkpointJob, DEFAULT_ANIMATE_MODEL, repCreate, repPoll, runFfmpeg } from "./ugc-ad-pipeline.server";
import fs from "node:fs";
import path from "node:path";
import { mirrorRender } from "./object-storage.server";
import { checkpointUrlAlive } from "./cartoon-ad-pipeline.server";

export type VideoStyle = "PRODUCT_HIGHLIGHT" | "AI_AVATAR";

/** The provider handed back nothing usable — an expired delivery link, or a
 *  body too small to be a video. Distinct from "we could not write it to
 *  disk", because that one still has bytes worth keeping. */
class DeadRenderError extends Error {}

/** Every finished video EasyMode ships is 720x1280.
 *
 *  This pipeline was the one exception, and it never re-encoded anything — it
 *  wrote the provider's clip to disk byte for byte. Image-to-video engines
 *  return the aspect ratio of the SEED FRAME, and the seed frame here is the
 *  merchant's own product photo, so the output shape was whatever shape their
 *  storefront images happen to be. Measured across a real account: seven of
 *  eight pipelines produced 720x1280, and Product Highlight produced
 *  1440x1440 — a square video, auto-posted to TikTok, Reels and Shorts, which
 *  the landing page sells as "vertical-formatted". Only the Veo branch of
 *  animateInputFor passes aspect_ratio at all; every Kling branch (including
 *  the current default engine) passes none, and the word "vertical" in the
 *  prompt is a hint the model is free to ignore.
 *
 *  Pad, never crop. Cropping 1440x1440 down to 9:16 throws away 44% of the
 *  width, and the thing sitting in that width is the product the ad exists to
 *  show. The frame is fitted whole and the bars are filled with a blurred,
 *  zoomed copy of the footage — the standard social treatment, which reads as
 *  deliberate rather than as a letterboxed mistake.
 *
 *  Returns false if it could not produce a file, so the caller falls back to
 *  the untouched bytes: a wrongly-shaped video the merchant paid for still
 *  beats no video at all. */
async function toVerticalFrame(buf: Buffer, dir: string, outPath: string): Promise<boolean> {
  const raw = path.join(dir, `.vid-src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`);
  try {
    fs.writeFileSync(raw, buf);
    const { status, stderr } = await runFfmpeg([
      "-y", "-i", raw,
      "-filter_complex",
      // The blur is heavy and the fill is darkened on purpose: at a gentler
      // sigma the background is still a readable copy of the footage, so any
      // caption near the frame edge reappears as a ghost of itself in the bar.
      "[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280," +
        "gblur=sigma=42,eq=brightness=-0.16:saturation=0.85[bg];" +
        "[0:v]scale=720:1280:force_original_aspect_ratio=decrease[fg];" +
        "[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=30,format=yuv420p[v]",
      "-map", "[v]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      outPath,
    ]);
    if (status !== 0 || !fs.existsSync(outPath) || fs.statSync(outPath).size < 1024) {
      console.warn(`[video] vertical normalisation failed (status ${status}) — keeping the provider frame: ${stderr.slice(-400)}`);
      try { fs.rmSync(outPath, { force: true }); } catch { /* nothing to remove */ }
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[video] vertical normalisation unavailable — keeping the provider frame: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  } finally {
    try { fs.rmSync(raw, { force: true }); } catch { /* best effort */ }
  }
}

/** Download a provider render onto our own disk (and durable object storage)
 *  and return the /renders/ URL we serve it from.
 *
 *  Two different failures, two different answers. If we HAVE the bytes and only
 *  the local step failed, the provider URL is returned — it expires in about an
 *  hour, which is worse than durable storage but far better than failing a
 *  render the merchant paid for. If the provider gave us nothing at all, that
 *  URL is already dead, so returning it would mint a COMPLETED, fully-charged
 *  asset pointing at a broken link no healer can repair. That throws instead,
 *  and the queue retries or refunds. */
async function persistRemoteVideo(url: string): Promise<string> {
  try {
    if (url.startsWith("/renders/")) return url; // already ours
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    // NOTHING CAME BACK means the provider link is already dead, and handing
    // that same dead link to the caller creates a COMPLETED, fully-charged
    // asset pointing at nothing — a broken player, a drop that can never post,
    // no healer and no refund. Rethrown as fatal below rather than swallowed.
    if (!res.ok) throw new DeadRenderError(`fetch ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) throw new DeadRenderError(`suspiciously small (${buf.length}B)`);

    const rendersDir = path.join(process.cwd(), "data", "renders");
    fs.mkdirSync(rendersDir, { recursive: true });
    const fileName = `vid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
    const finalPath = path.join(rendersDir, fileName);

    const framed = await toVerticalFrame(buf, rendersDir, finalPath);
    if (!framed) fs.writeFileSync(finalPath, buf); // normalisation failed — ship what we paid for

    const bytes = fs.readFileSync(finalPath);
    try { await mirrorRender(fileName, bytes); } catch { /* non-fatal — disk copy still serves */ }
    return `/renders/${fileName}`;
  } catch (e) {
    // The provider gave us nothing — there is no deliverable to store, and
    // pretending otherwise bills the merchant for a dead link. Let it out so
    // the queue retries and, on the last attempt, refunds.
    if (e instanceof DeadRenderError) throw e;
    // We DID have bytes and only the local step failed (a full disk, a bad
    // temp write). The provider URL still works for about an hour, which is
    // worse than durable storage but far better than failing a paid render.
    console.warn(
      `[video] could not persist provider render — storing the expiring URL instead: ${e instanceof Error ? e.message : String(e)}`
    );
    return url;
  }
}

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
    ? ` Product context: ${trimToWord(productDescription, 200)}.`
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
      // A checkpoint outlives the thing it points at. Provider delivery links
      // die after about an hour, and a retry can easily start later than that:
      // a paused campaign defers its job indefinitely, and three attempts with
      // a 25-minute stuck window already reach past it. The prediction still
      // reports "succeeded" and hands back its stored output URL, so without a
      // probe we would sail on and build an asset around a dead link.
      if (videoUrl && !(await checkpointUrlAlive(videoUrl))) {
        console.log("[video] resumed prediction output has expired — re-rendering");
        videoUrl = null;
        // Clear it first, or every remaining attempt re-attaches to the same
        // corpse and fails the same way.
        await ckpt({ ckVideoPredId: "" });
      }
    } catch (e) {
      console.error("[video] resumed prediction unusable — starting a fresh one:", e instanceof Error ? e.message.slice(0, 200) : e);
    }
  }

  if (!videoUrl) {
    // Engine-picker path: a chosen engine (with a seed frame) runs through the
    // multi-engine adapter, which falls back to the default engine on rejection.
    let predictionId: string;
    let ranModel: string;
    // ANY seed frame goes through the engine adapter — including "Auto".
    //
    // This used to read `params.videoEngine && seedImage`, and "Auto"
    // normalizes to undefined, so the DEFAULT choice fell through to the
    // legacy minimax/video-01 path while only an explicit non-auto pick got
    // the modern engines. Exactly backwards: Product Highlight and Satisfying
    // Close-Up sat on a superseded model for every merchant who never touched
    // the picker, and they silently missed the Kling 2.6 upgrade that lifted
    // every other content type.
    //
    // animateCreate already treats undefined as "the default engine", so
    // passing it through is all this needs.
    if (seedImage) {
      const created = await animateCreate(params.videoEngine, { startImage: seedImage, prompt });
      predictionId = created.id;
      ranModel = created.model;
    } else {
      // No seed frame — service mode with no photo, or an avatar path with no
      // portrait. The image-to-video engines have nothing to start from, so
      // this stays on the text-to-video model.
      predictionId = await repCreate(VIDEO_MODEL, { prompt, prompt_optimizer: true });
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

  // PERSIST THE BYTES. The provider hands back a CDN URL that expires — fal and
  // Replicate both reap render output. Storing that URL means a merchant's
  // 150-token video quietly becomes a dead link days later, and the Asset row
  // outlives the file it points at. Every other pipeline (ugc, cartoon, jingle)
  // writes to data/renders and serves via /renders/:file; this one did not.
  //
  // A download failure must NOT fail the job: the merchant has already been
  // charged and a possibly-expiring video beats no video, so we fall back to
  // the provider URL and log it loudly.
  const storedUrl = await persistRemoteVideo(videoUrl);

  const asset = await db.asset.create({
    data: {
      shopId,
      type: "VIDEO_AD",
      status: "PENDING",
      title: `${style === "AI_AVATAR" ? (avatar ? `${avatar.name} presents` : "Avatar video") : "Product video"} — ${productTitle}`,
      // sourceUrl keeps the provider link for debugging/remix; videoUrl is ours.
      bodyJson: JSON.stringify({ style, videoUrl: storedUrl, sourceUrl: videoUrl, prompt }),
      // productImageUrl is what a REMIX rebuilds from. Without it the remix
      // regenerates the product from its name — 150 tokens of something else.
      metaJson: JSON.stringify({ style, productTitle, avatarId: avatar?.id || null, avatarVariant: avatar ? variant : null, direction: params.customPrompt || null, productImageUrl: params.productImageUrl || null, serviceMode: !!params.serviceMode }),
    },
  });
  return asset.id;
}
