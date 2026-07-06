// DB-backed job queue. Worker calls processNextJob() in a loop.
// Jobs are claimed with status=IN_PROGRESS to prevent double-processing.

import { db } from "../db.server";
import { generateBrandProfile } from "./brand-voice.server";
import { generateBlogPost } from "./blog-generation.server";
import { generateImageAd } from "./image-generation.server";
import { generateVideoAd } from "./video-generation.server";
import { generateAdCopy } from "./ad-copy-generation.server";
import { launchCampaign } from "./campaign-launch.server";
import { runDecisioningPass } from "./decisioning-engine.server";

const MAX_ATTEMPTS = 3;

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
      const graphql = async (query: string) => {
        const res = await fetch(
          `https://${shop.domain}/admin/api/2025-01/graphql.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": shop.accessToken,
            },
            body: JSON.stringify({ query }),
          }
        );
        if (!res.ok) throw new Error(`Shopify API HTTP ${res.status}`);
        const j = await res.json();
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
      await generateVideoAd({
        shopId,
        brandProfile: shop.brandProfile,
        plan: shop.activePlan,
        productTitle: payload.productTitle as string,
        productDescription: payload.productDescription as string | undefined,
        productImageUrl: payload.productImageUrl as string | undefined,
        style: (payload.style as "PRODUCT_HIGHLIGHT" | "AI_AVATAR") || "PRODUCT_HIGHLIGHT",
        customPrompt: payload.customPrompt as string | undefined,
      });
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
