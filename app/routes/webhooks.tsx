import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { enqueueJob } from "../lib/job-queue.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "APP_UNINSTALLED": {
      // Clean up shop data on uninstall
      const shopRecord = await db.shop.findUnique({ where: { domain: shop } });
      if (shopRecord) {
        await db.shop.delete({ where: { id: shopRecord.id } });
      }
      break;
    }

    case "PRODUCTS_CREATE": {
      const shopRecord = await db.shop.findUnique({
        where: { domain: shop },
        include: { activePlan: true, brandProfile: true },
      });

      if (shopRecord?.activePlan && shopRecord?.brandProfile) {
        const plan = shopRecord.activePlan;
        const product = payload as { title: string; body_html: string; images: { src: string }[] };
        const desc = product.body_html?.replace(/<[^>]+>/g, "") || "";
        const jobs: Promise<string>[] = [];

        // Core deliverable follows the selected plan.
        if (plan.type === "SEO_AUTOPILOT") {
          jobs.push(
            enqueueJob(shopRecord.id, "GENERATE_BLOG_POST", {
              productTitle: product.title,
              productDescription: desc.slice(0, 500),
            })
          );
        } else if (plan.type === "VIDEO_AUTOPILOT") {
          jobs.push(
            enqueueJob(shopRecord.id, "GENERATE_VIDEO_AD", {
              productTitle: product.title,
              productDescription: desc.slice(0, 300),
              productImageUrl: product.images?.[0]?.src,
              style: "PRODUCT_HIGHLIGHT",
            })
          );
        }

        // Ad Creative Pack add-on: also generate image ads + copy.
        if (plan.adCreativePack) {
          jobs.push(
            enqueueJob(shopRecord.id, "GENERATE_IMAGE_AD", {
              productTitle: product.title,
              productImageUrl: product.images?.[0]?.src,
            }),
            enqueueJob(shopRecord.id, "GENERATE_AD_COPY", {
              productTitle: product.title,
              productDescription: desc.slice(0, 300),
            })
          );
        }

        await Promise.all(jobs);
      }
      break;
    }

    default:
      console.log(`Unhandled webhook topic: ${topic}`);
  }

  return new Response(null, { status: 200 });
};
