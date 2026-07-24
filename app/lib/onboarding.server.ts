import { db } from "../db.server";
import { enqueueJob } from "./job-queue.server";

/* Time-to-first-value: the moment a merchant has BOTH a brand profile and an
 * active plan, forge their first blog + image ad automatically from their top
 * product — so they open the Archive to finished content in minutes, before
 * they've lifted a finger. First impressions drive week-one retention.
 *
 * Fires exactly once (onboardKickAt guard). Runs off the plan's own quota (the
 * job handlers don't charge tokens — same path as the product-create webhook),
 * so the welcome content is free. Never throws. */

type GraphQL = (query: string) => Promise<any>;

export async function kickstartFirstContent(shopId: string, graphql: GraphQL): Promise<void> {
  try {
    const shop = await db.shop.findUnique({
      where: { id: shopId },
      include: { brandProfile: true, activePlan: true },
    });
    // Need both halves of onboarding done, and not already kicked.
    if (!shop || shop.onboardKickAt || !shop.brandProfile || !shop.activePlan?.active) return;

    // Feature the most recently updated product (the one they're working on).
    let product: { title: string; description: string; image?: string } | null = null;
    try {
      const data = await graphql(
        `{ products(first: 1, sortKey: UPDATED_AT, reverse: true) { edges { node { title description(truncateAt: 300) featuredImage { url } } } } }`
      );
      const n = data?.products?.edges?.[0]?.node;
      if (n?.title) product = { title: n.title, description: n.description || "", image: n.featuredImage?.url };
    } catch { /* store not readable yet */ }
    if (!product) return; // no products to feature — leave the flag unset, retry next time

    // Claim the one-shot BEFORE enqueuing so a double trigger can't double-fire.
    await db.shop.update({ where: { id: shopId }, data: { onboardKickAt: new Date() } });

    const jobs: Promise<unknown>[] = [];
    if (shop.activePlan.blogQuota > 0) {
      jobs.push(enqueueJob(shopId, "GENERATE_BLOG_POST", { productTitle: product.title, productDescription: product.description, welcome: true }));
    }
    if (shop.activePlan.imageQuota > 0 && product.image) {
      jobs.push(enqueueJob(shopId, "GENERATE_IMAGE_AD", { productTitle: product.title, productImageUrl: product.image, welcome: true }));
    }
    await Promise.all(jobs);
    console.log(`[onboarding] kicked first content for ${shopId} (${jobs.length} piece${jobs.length === 1 ? "" : "s"})`);
  } catch (e) {
    console.error("[onboarding] first-content kick failed (non-fatal):", e);
  }
}
