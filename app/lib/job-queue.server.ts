// DB-backed job queue. Worker calls processNextJob() in a loop.
// Jobs are claimed with status=IN_PROGRESS to prevent double-processing.

import { db } from "../db.server";
import { generateBrandProfile } from "./brand-voice.server";
import { generateBlogPost } from "./blog-generation.server";
import { generateImageAd } from "./image-generation.server";
import { generateVideoAd } from "./video-generation.server";
import { generateUgcAd } from "./ugc-ad-pipeline.server";
import { awardXp, checkLevelAchievements } from "./xp.server";
import { XP_EVENTS } from "./achievements";
import { generateAdCopy } from "./ad-copy-generation.server";
import { launchCampaign } from "./campaign-launch.server";
import { runDecisioningPass } from "./decisioning-engine.server";

const MAX_ATTEMPTS = 3;

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
    await db.job.update({
      where: { id: j.id },
      data:
        j.attempts >= MAX_ATTEMPTS
          ? { status: "FAILED", lastError: "Interrupted by a server restart — hit ROLL CAMERA to try again." }
          : { status: "PENDING" },
    });
  }
  if (stuck.length) console.log(`[worker] reclaimed ${stuck.length} orphaned job(s)`);
}

export async function enqueueJob(
  shopId: string,
  type: string,
  payload: Record<string, unknown>
): Promise<string> {
  const job = await db.job.create({
    data: {
      shopId,
      type: type as any,
      payload: JSON.stringify(payload),
    },
  });
  return job.id;
}


export async function processNextJob(): Promise<boolean> {
  // Claim one pending job atomically
  const jobs = await db.job.findMany({
    where: { status: "PENDING", attempts: { lt: MAX_ATTEMPTS } },
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
      await generateBlogPost(
        shopId,
        shop.brandProfile,
        shop.activePlan,
        payload.productTitle as string,
        payload.productDescription as string
      );
      break;
    }

    case "GENERATE_IMAGE_AD": {
      if (!shop?.brandProfile || !shop?.activePlan) {
        throw new Error("Shop missing brand profile or active plan");
      }
      await generateImageAd(
        shopId,
        shop.brandProfile,
        shop.activePlan,
        payload.productTitle as string,
        payload.productImageUrl as string | undefined
      );
      break;
    }

    case "GENERATE_VIDEO_AD": {
      if (!shop?.brandProfile || !shop?.activePlan) {
        throw new Error("Shop missing brand profile or active plan");
      }
      if (payload.avatarId) {
        // Presenter cast → full UGC ad pipeline (script → voice → talking
        // performance → captioned assembly). Zeely-class output.
        await generateUgcAd({
          shopId,
          brandProfile: shop.brandProfile,
          productTitle: payload.productTitle as string,
          productDescription: payload.productDescription as string | undefined,
          productImageUrl: payload.productImageUrl as string | undefined,
          avatarId: payload.avatarId as string,
          avatarVariant: payload.avatarVariant != null ? Number(payload.avatarVariant) : 0,
          direction: payload.customPrompt as string | undefined,
          captions: payload.captions !== false,
          jobId: payload.__jobId as string | undefined,
          resume: {
            script: payload.ckScript as string | undefined,
            audioUrl: payload.ckAudioUrl as string | undefined,
            omniPredictionId: payload.ckOmniId as string | undefined,
            talkingUrl: payload.ckTalkingUrl as string | undefined,
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
          customPrompt: payload.customPrompt as string | undefined,
        });
      }
      // Success → burn one take from the plan allowance + pay video XP.
      // (Non-fatal: economics must never un-render a finished video.)
      try {
        await db.plan.update({
          where: { id: shop.activePlan.id },
          data: { videoUsed: { increment: 1 } },
        });
        const xp = await awardXp(shopId, XP_EVENTS.videoGenerated);
        if (xp?.leveledUp) await checkLevelAchievements(shopId, xp.level);
      } catch (e) {
        console.error("[job] video accounting failed (non-fatal):", e);
      }
      break;
    }

    case "GENERATE_AD_COPY": {
      if (!shop?.brandProfile || !shop?.activePlan) {
        throw new Error("Shop missing brand profile or active plan");
      }
      await generateAdCopy(
        shopId,
        shop.brandProfile,
        shop.activePlan,
        payload.productTitle as string,
        payload.productDescription as string
      );
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
