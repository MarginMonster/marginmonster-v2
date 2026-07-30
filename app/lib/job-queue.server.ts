// DB-backed job queue. Worker calls processNextJob() in a loop.
// Jobs are claimed with status=IN_PROGRESS to prevent double-processing.

import { db } from "../db.server";
import { generateBrandProfile } from "./brand-voice.server";
import { generateBlogPost } from "./blog-generation.server";
import { generateImageAd } from "./image-generation.server";
import { generateVideoAd } from "./video-generation.server";
import { generateUgcAd } from "./ugc-ad-pipeline.server";
import { awardXp, checkLevelAchievements, unlockAchievement } from "./xp.server";
import { XP_EVENTS } from "./achievements";
import { refundTokens } from "./tokens.server";
import { TOKEN_COST } from "./plan-config";
import { launchCampaign } from "./campaign-launch.server";
import { runDecisioningPass } from "./decisioning-engine.server";

const MAX_ATTEMPTS = 3;

// Pre-paid generations (tokens spent at enqueue — Studio pieces AND questline
// drops, which are charged per-piece on accept) get their tokens BACK if the
// job burns through every retry — a server-side failure is never the
// merchant's bill. Retrying a refunded piece re-charges (Studio retry button
// and questline retrySlot both), so it's always one spend per piece.
export const REFUND_BY_TYPE: Record<string, number> = {
  GENERATE_VIDEO_AD: TOKEN_COST.video,
  GENERATE_IMAGE_AD: TOKEN_COST.image,
  GENERATE_BLOG_POST: TOKEN_COST.blog,
};

/** Refund a terminally-failed pre-paid job EXACTLY ONCE. The payload is
 *  rewritten first (prePaid→false, refunded→true) so a second terminal
 *  failure — or the archive's free retry failing again — can never mint
 *  tokens, and so the archive knows a re-run must be re-charged. */
async function refundPrepaidOnce(job: { id: string; shopId: string; type: string; payload: string }): Promise<void> {
  try {
    // Re-fetch: the claimed copy is stale — pipelines checkpoint ck* keys into
    // the payload mid-run, and rewriting from the stale copy would erase them.
    const fresh = await db.job.findUnique({ where: { id: job.id }, select: { payload: true } });
    const p = JSON.parse((fresh ?? job).payload) as Record<string, unknown>;
    if (!p.prePaid || !REFUND_BY_TYPE[job.type]) return;
    p.prePaid = false;
    p.refunded = true;
    await db.job.update({ where: { id: job.id }, data: { payload: JSON.stringify(p) } });
    // Refund what was ACTUALLY charged (engine surcharges ride in chargedTokens).
    const amount = typeof p.chargedTokens === "number" && p.chargedTokens > 0 ? p.chargedTokens : REFUND_BY_TYPE[job.type];
    await refundTokens(job.shopId, amount);
    console.log(`[worker] refunded ${amount} tokens for failed ${job.type} (${job.id})`);
  } catch { /* refund is best-effort, never fatal */ }
}

/** Advance the questline that spawned this job, if any. Lazy import avoids a
 *  circular dependency (questlines.server → job-queue for enqueueJob). */
async function maybeTickQuestline(payload: Record<string, unknown>, shopId: string, ok = true, assetId?: string): Promise<void> {
  const qid = payload.questlineId as string | undefined;
  const okey = payload.objectiveKey as string | undefined;
  if (!qid) return;
  const slotIdx = typeof payload.slotIdx === "number" ? (payload.slotIdx as number) : undefined;
  const { onQuestlineObjectiveDone } = await import("./questlines.server");
  await onQuestlineObjectiveDone(qid, okey, shopId, slotIdx, ok, assetId);
}

/** Jobs claimed by a process that died (deploy/restart) stay IN_PROGRESS
 *  forever and look "stuck rendering" to the merchant. Reclaim them: back to
 *  PENDING if they have attempts left, else FAILED with a clear reason.
 *  Called at worker boot (nothing can genuinely be running then) and each tick
 *  for anything stuck past the hard ceiling. */
export async function reclaimOrphanJobs(olderThanMs = 0): Promise<void> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const stuck = await db.job.findMany({
    where: { status: "IN_PROGRESS", updatedAt: { lt: cutoff } },
  });
  for (const j of stuck) {
    const dead = j.attempts >= MAX_ATTEMPTS;
    await db.job.update({
      where: { id: j.id },
      data: dead
        ? { status: "FAILED", lastError: "Interrupted by a server restart — hit ROLL CAMERA to try again." }
        : { status: "PENDING" },
    });
    // Terminal death via orphan-reclaim refunds exactly like a terminal
    // failure inside processNextJob — the merchant never pays for a
    // restart-killed render (companion forges included).
    if (dead) {
      await refundPrepaidOnce(j);
      if (j.type === "FORGE_COMPANION") {
        try { await refundTokens(j.shopId, 1); } catch { /* non-fatal */ }
      }
    }
  }
  if (stuck.length) console.log(`[worker] reclaimed ${stuck.length} orphaned job(s)`);
}

export async function enqueueJob(
  shopId: string,
  type: string,
  payload: Record<string, unknown>,
  runAt?: Date // scheduled drip jobs (campaign calendar) wait until this time
): Promise<string> {
  const job = await db.job.create({
    data: {
      shopId,
      type: type as any,
      payload: JSON.stringify(payload),
      runAt: runAt ?? null,
    },
  });
  return job.id;
}


export async function processNextJob(): Promise<boolean> {
  // Claim one DUE pending job atomically (scheduled jobs sleep until runAt)
  const jobs = await db.job.findMany({
    where: {
      status: "PENDING",
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ runAt: null }, { runAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: "asc" },
    take: 1,
  });

  const job = jobs[0];
  if (!job) return false;

  await db.job.update({
    where: { id: job.id },
    data: { status: "IN_PROGRESS", attempts: { increment: 1 } },
  });

  try {
    const payload = JSON.parse(job.payload);
    payload.__jobId = job.id; // lets long pipelines checkpoint their progress
    await runJob(job.type, job.shopId, payload);

    await db.job.update({
      where: { id: job.id },
      data: { status: "COMPLETED", processedAt: new Date() },
    });
  } catch (e: unknown) {
    const lastError = e instanceof Error ? e.message : String(e);
    const nextStatus = job.attempts + 1 >= MAX_ATTEMPTS ? "FAILED" : "PENDING";
    await db.job.update({
      where: { id: job.id },
      data: { status: nextStatus, lastError },
    });
    console.error(`Job ${job.id} (${job.type}) failed:`, lastError);
    // Out of retries → mark the questline slot FAILED (non-fatal), and refund
    // the token a custom companion cost so a server-busy failure is free.
    if (nextStatus === "FAILED") {
      try { await maybeTickQuestline(JSON.parse(job.payload), job.shopId, false); } catch { /* skip */ }
      if (job.type === "FORGE_COMPANION") {
        try { await refundTokens(job.shopId, 1); } catch { /* non-fatal */ }
      }
      await refundPrepaidOnce(job);
    }
  }

  return true;
}

async function runJob(
  type: string,
  shopId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const shop = await db.shop.findUnique({
    where: { id: shopId },
    include: { brandProfile: true, activePlan: true },
  });

  switch (type) {
    case "GENERATE_BRAND_PROFILE": {
      if (!shop) throw new Error("Shop not found");
      // Use the SDK's session-managed admin client (token exchange) instead of
      // the raw stored offline token — Shopify now 403-rejects deprecated
      // offline tokens. Lazy import avoids a circular dependency with the worker.
      const { unauthenticated } = await import("../shopify.server");
      const { admin } = await unauthenticated.admin(shop.domain);
      const graphql = async (query: string) => {
        const res = await admin.graphql(query);
        const j = (await res.json()) as { data?: unknown; errors?: unknown };
        if (j.errors) throw new Error("Shopify API: " + JSON.stringify(j.errors));
        return j.data;
      };
      await generateBrandProfile(shopId, graphql);
      break;
    }

    case "GENERATE_BLOG_POST": {
      if (!shop?.brandProfile || !shop?.activePlan) {
        throw new Error("Shop missing brand profile or active plan");
      }
      const blogAssetId = await generateBlogPost(
        shopId,
        shop.brandProfile,
        shop.activePlan,
        payload.productTitle as string,
        payload.productDescription as string
      );
      if (payload.prePaid) await maybeTickQuestline(payload, shopId, true, typeof blogAssetId === "string" ? blogAssetId : undefined);
      break;
    }

    case "GENERATE_IMAGE_AD": {
      if (!shop?.brandProfile || !shop?.activePlan) {
        throw new Error("Shop missing brand profile or active plan");
      }
      const imgAssetId = await generateImageAd(
        shopId,
        shop.brandProfile,
        shop.activePlan,
        payload.productTitle as string,
        payload.productImageUrl as string | undefined,
        payload.stylePrompt as string | undefined,
        payload.avatarId as string | undefined,
        payload.avatarVariant as number | undefined,
        payload.wear === true,
        payload.scene as string | undefined,
        payload.serviceMode === true,
        payload.styleMode === "scene" || payload.styleMode === "backdrop" ? payload.styleMode : undefined,
        typeof payload.templateKey === "string" ? payload.templateKey : undefined,
        typeof payload.formatKey === "string" ? payload.formatKey : undefined
      );
      if (payload.prePaid) await maybeTickQuestline(payload, shopId, true, typeof imgAssetId === "string" ? imgAssetId : undefined);
      // still-count achievements
      try {
        const stills = await db.asset.count({ where: { shopId, type: "IMAGE_AD" } });
        if (stills >= 1) await unlockAchievement(shopId, "STILL_LIFE");
        if (stills >= 15) await unlockAchievement(shopId, "GALLERY_WALL");
      } catch { /* non-fatal */ }
      break;
    }

    case "GENERATE_VIDEO_AD": {
      if (!shop?.brandProfile || !shop?.activePlan) {
        throw new Error("Shop missing brand profile or active plan");
      }
      // Belt-and-braces tier gate: the route already checked, but a downgrade
      // between enqueue and run must not slip a locked generator through. A
      // throw here terminal-fails the job → refundPrepaidOnce returns tokens.
      {
        const { assertCapability, videoCapabilityFor } = await import("./capabilities.server");
        assertCapability(shop.activePlan, videoCapabilityFor((payload.contentType as string) || undefined));
      }
      // Provenance label for the finished take's card in the Studio.
      let origin: string | undefined;
      if (payload.questlineId) {
        try {
          const ql = await db.questline.findUnique({ where: { id: payload.questlineId as string }, select: { name: true } });
          origin = `⚔ QUEST · ${(ql?.name || "CAMPAIGN").toUpperCase()}`;
        } catch { origin = "⚔ QUEST"; }
      } else if (payload.initiator) {
        origin = `🎬 BY ${(payload.initiator as string).toUpperCase()}`;
      }
      let forgedAssetId: string | undefined;
      if (payload.contentType === "cartoon") {
        // CARTOON → illustrated keyframe (style-locked) animated by kling,
        // with a style-cast narrator. Lazy import keeps the pipeline cold
        // until the first cartoon job.
        const { generateCartoonAd } = await import("./cartoon-ad-pipeline.server");
        forgedAssetId = await generateCartoonAd({
          shopId,
          brandProfile: shop.brandProfile,
          productTitle: payload.productTitle as string,
          productDescription: payload.productDescription as string | undefined,
          productImageUrl: payload.productImageUrl as string | undefined,
          styleKey: (payload.cartoonStyle as string) || "dreamanime",
          avatarId: payload.avatarId as string | undefined,
          avatarVariant: payload.avatarVariant != null ? Number(payload.avatarVariant) : 0,
          direction: payload.customPrompt as string | undefined,
          serviceMode: payload.serviceMode === true,
          videoEngine: payload.videoEngine as string | undefined,
          origin,
          jobId: payload.__jobId as string | undefined,
          resume: {
            script: payload.ckScript as string | undefined,
            composedUrl: payload.ckComposedUrl as string | undefined,
            keyframeUrl: payload.ckKeyframeUrl as string | undefined,
            klingPredictionId: payload.ckKlingId as string | undefined,
            animUrl: payload.ckAnimUrl as string | undefined,
            audioUrl: payload.ckAudioUrl as string | undefined,
          },
        });
      } else if (payload.contentType === "jingle") {
        // ANTHEM → sung theme song, lipsynced by the cast singer (photoreal
        // or cartoon-styled), or played over a hero product clip.
        const { generateJingleAd } = await import("./jingle-ad-pipeline.server");
        forgedAssetId = await generateJingleAd({
          shopId,
          brandProfile: shop.brandProfile,
          productTitle: payload.productTitle as string,
          productDescription: payload.productDescription as string | undefined,
          productImageUrl: payload.productImageUrl as string | undefined,
          avatarId: payload.avatarId as string | undefined,
          avatarVariant: payload.avatarVariant != null ? Number(payload.avatarVariant) : 0,
          cartoonStyle: payload.cartoonStyle as string | undefined,
          direction: payload.customPrompt as string | undefined,
          serviceMode: payload.serviceMode === true,
          videoEngine: payload.videoEngine as string | undefined,
          origin,
          jobId: payload.__jobId as string | undefined,
          resume: {
            lyrics: payload.ckLyrics as string | undefined,
            songUrl: payload.ckSongUrl as string | undefined,
            engine: payload.ckEngine as string | undefined,
            styledUrl: payload.ckStyledUrl as string | undefined,
            omniPredictionId: payload.ckOmniId as string | undefined,
            talkingUrl: payload.ckTalkingUrl as string | undefined,
            singEngine: payload.ckSingEngine as string | undefined,
            keyframeUrl: payload.ckKeyframeUrl as string | undefined,
            klingPredictionId: payload.ckKlingId as string | undefined,
            animUrl: payload.ckAnimUrl as string | undefined,
          },
        });
      } else if (payload.avatarId) {
        // Presenter cast → full UGC ad pipeline (script → voice → talking
        // performance → captioned assembly). Zeely-class output.
        forgedAssetId = await generateUgcAd({
          shopId,
          brandProfile: shop.brandProfile,
          productTitle: payload.productTitle as string,
          productDescription: payload.productDescription as string | undefined,
          productImageUrl: payload.productImageUrl as string | undefined,
          avatarId: payload.avatarId as string,
          avatarVariant: payload.avatarVariant != null ? Number(payload.avatarVariant) : 0,
          direction: payload.customPrompt as string | undefined,
          captions: payload.captions !== false,
          origin,
          jobId: payload.__jobId as string | undefined,
          composedFrameUrl: payload.composedFrameUrl as string | undefined,
          holdProduct: payload.holdProduct === true,
          wearProduct: payload.wearProduct === true,
          serviceMode: payload.serviceMode === true,
          scene: payload.scene as string | undefined,
          resume: {
            script: payload.ckScript as string | undefined,
            audioUrl: payload.ckAudioUrl as string | undefined,
            composedUrl: payload.ckComposedUrl as string | undefined,
            omniPredictionId: payload.ckOmniId as string | undefined,
            talkingUrl: payload.ckTalkingUrl as string | undefined,
            engine: payload.ckEngine as string | undefined,
          },
        });
      } else {
        // PRODUCT ONLY → showcase reel (minimax i2v seeded with product image)
        await generateVideoAd({
          shopId,
          brandProfile: shop.brandProfile,
          plan: shop.activePlan,
          productTitle: payload.productTitle as string,
          productDescription: payload.productDescription as string | undefined,
          productImageUrl: payload.productImageUrl as string | undefined,
          style: "PRODUCT_HIGHLIGHT",
          serviceMode: payload.serviceMode === true,
          customPrompt: payload.customPrompt as string | undefined,
          videoEngine: payload.videoEngine as string | undefined,
          commercial: payload.commercial === true,
        });
      }
      // Accounting. Questline videos were pre-paid on accept (tokens) and don't
      // touch the manual video quota; standalone Studio videos burn a take.
      try {
        if (payload.prePaid) {
          await maybeTickQuestline(payload, shopId, true, forgedAssetId);
        } else {
          await db.plan.update({
            where: { id: shop.activePlan.id },
            data: { videoUsed: { increment: 1 } },
          });
          const xp = await awardXp(shopId, XP_EVENTS.videoGenerated);
          if (xp?.leveledUp) await checkLevelAchievements(shopId, xp.level);
        }
      } catch (e) {
        console.error("[job] video accounting failed (non-fatal):", e);
      }
      // take-count achievements (campaign + studio takes both count)
      try {
        const takes = await db.asset.count({ where: { shopId, type: "VIDEO_AD" } });
        if (takes >= 1) await unlockAchievement(shopId, "FIRST_TAKE");
        if (takes >= 10) await unlockAchievement(shopId, "SHOW_RUNNER");
      } catch { /* non-fatal */ }
      break;
    }

    case "SEND_ABANDONED_CART": {
      // Fires ~1h after a checkout was abandoned. Send only if still pending
      // (no order came through), we have an email, and email is connected.
      const id = payload.abandonedCheckoutId as string;
      const ac = await db.abandonedCheckout.findUnique({ where: { id } });
      if (!ac || ac.status !== "pending") break; // recovered / already handled
      const { emailEnabled, sendEmail } = await import("./email-provider.server");
      if (!ac.email || !emailEnabled()) {
        await db.abandonedCheckout.update({ where: { id }, data: { status: "skipped" } });
        break;
      }
      const s = await db.shop.findUnique({ where: { id: shopId }, include: { brandProfile: true } });
      if (!s?.brandProfile) {
        await db.abandonedCheckout.update({ where: { id }, data: { status: "skipped" } });
        break;
      }
      let items: { title?: string }[] = [];
      try { items = JSON.parse(ac.itemsJson); } catch { /* empty */ }
      const { writeMarketingEmail } = await import("./email-writer.server");
      const email = await writeMarketingEmail(s.brandProfile, {
        kind: "abandoned_cart",
        productTitle: items[0]?.title,
        storeName: s.domain.replace(/\.myshopify\.com$/, ""),
        ctaUrl: ac.recoveryUrl || undefined,
      });
      const res = await sendEmail({ to: ac.email, subject: email.subject, html: email.html });
      await db.abandonedCheckout.update({ where: { id }, data: { status: res.ok ? "emailed" : "skipped" } });
      break;
    }

    case "SEND_WELCOME": {
      const { sendBrandEmail } = await import("./email-flows.server");
      await sendBrandEmail(shopId, { to: payload.email as string, kind: "welcome" });
      break;
    }

    case "SEND_POST_PURCHASE": {
      const { sendBrandEmail } = await import("./email-flows.server");
      await sendBrandEmail(shopId, { to: payload.email as string, kind: "post_purchase", productTitle: payload.productTitle as string | undefined });
      break;
    }

    case "SEND_WINBACK": {
      // fires +45d after an order — but only if they haven't ordered AGAIN since
      // (a newer order advances lastOrderAt past this timer's snapshot → skip).
      const email = payload.email as string;
      const orderAt = payload.orderAt as string;
      const lc = await db.customerLifecycle.findUnique({ where: { shopId_email: { shopId, email } } });
      if (!lc || (orderAt && lc.lastOrderAt.getTime() > new Date(orderAt).getTime())) break;
      const { sendBrandEmail } = await import("./email-flows.server");
      await sendBrandEmail(shopId, { to: email, kind: "winback" });
      break;
    }

    case "FORGE_COMPANION": {
      // Free custom companion: base + blink + cheer frames, cut out, stored
      // in the DB, installed as the shop's active partner. Lazy import keeps
      // the replicate helpers out of the hot path.
      const { forgeCompanion } = await import("./companion.server");
      await forgeCompanion(shopId, payload.prompt as string, payload.name as string);
      break;
    }


    case "LAUNCH_CAMPAIGN": {
      await launchCampaign({
        assetId: payload.assetId as string,
        shopId,
        platform: payload.platform as "META" | "TIKTOK",
        weeklyBudgetCents: payload.weeklyBudgetCents as number,
      });
      break;
    }

    case "DECISIONING_PASS": {
      await runDecisioningPass();
      break;
    }

    default:
      throw new Error(`Unknown job type: ${type}`);
  }
}
