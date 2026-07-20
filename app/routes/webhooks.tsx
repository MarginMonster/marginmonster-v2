import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { enqueueJob } from "../lib/job-queue.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "APP_UNINSTALLED": {
      // Clean up shop data AND the SDK session on uninstall. Deleting the
      // session is critical: otherwise a reinstall reuses the stale grant
      // (old scopes / deprecated token), which 403-gates the Admin API.
      await db.session.deleteMany({ where: { shop } });
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

        // Enqueue whatever the plan's quotas include.
        if (plan.blogQuota > 0) {
          jobs.push(
            enqueueJob(shopRecord.id, "GENERATE_BLOG_POST", {
              productTitle: product.title,
              productDescription: desc.slice(0, 500),
            })
          );
        }
        if (plan.videoQuota > 0) {
          jobs.push(
            enqueueJob(shopRecord.id, "GENERATE_VIDEO_AD", {
              productTitle: product.title,
              productDescription: desc.slice(0, 300),
              productImageUrl: product.images?.[0]?.src,
              style: "PRODUCT_HIGHLIGHT",
            })
          );
        }
        if (plan.imageQuota > 0) {
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

    case "APP_SUBSCRIPTIONS_UPDATE": {
      // Billing truth stays synced: cancelled/expired/declined/frozen
      // subscriptions switch the plan OFF; a (re)activated one switches it on.
      // The plan row keeps its type/quotas so a reactivation restores cleanly.
      const sub = (payload as { app_subscription?: { status?: string } }).app_subscription;
      const status = sub?.status?.toUpperCase() || "";
      const shopRecord = await db.shop.findUnique({ where: { domain: shop }, include: { activePlan: true } });
      if (shopRecord?.activePlan && status) {
        const nowActive = status === "ACTIVE";
        if (shopRecord.activePlan.active !== nowActive) {
          await db.plan.update({ where: { shopId: shopRecord.id }, data: { active: nowActive } });
          console.log(`[billing] ${shop} subscription ${status} → plan ${nowActive ? "ON" : "OFF"}`);
        }
      }
      break;
    }

    // ---- Abandoned-cart flow. A left-behind checkout is stored and a delayed
    // SEND_ABANDONED_CART job fires ~1h later; a matching order marks it
    // recovered so no email sends. Checkout/order payloads carry customer email
    // → these only deliver once Protected Customer Data approval lands. ----
    case "CHECKOUTS_CREATE":
    case "CHECKOUTS_UPDATE": {
      const c = payload as {
        token?: string; id?: number; email?: string; abandoned_checkout_url?: string;
        line_items?: { title?: string; quantity?: number; image_url?: string }[]; total_price?: string;
      };
      const token = c.token || (c.id ? String(c.id) : "");
      if (!token) break;
      const shopRecord = await db.shop.findUnique({ where: { domain: shop } });
      if (!shopRecord) break;
      const items = (c.line_items || []).slice(0, 6).map((li) => ({ title: li.title || "Item", qty: li.quantity || 1, image: li.image_url || null }));
      const existing = await db.abandonedCheckout.findUnique({
        where: { shopId_checkoutToken: { shopId: shopRecord.id, checkoutToken: token } },
      });
      if (existing) {
        // refresh the cart contents; keep status + the single scheduled job
        await db.abandonedCheckout.update({
          where: { id: existing.id },
          data: {
            email: c.email || existing.email,
            recoveryUrl: c.abandoned_checkout_url || existing.recoveryUrl,
            itemsJson: JSON.stringify(items),
            totalPrice: c.total_price || existing.totalPrice,
          },
        });
      } else {
        const rec = await db.abandonedCheckout.create({
          data: {
            shopId: shopRecord.id, checkoutToken: token, email: c.email || null,
            recoveryUrl: c.abandoned_checkout_url || null, itemsJson: JSON.stringify(items),
            totalPrice: c.total_price || null, status: "pending",
          },
        });
        await enqueueJob(shopRecord.id, "SEND_ABANDONED_CART", { abandonedCheckoutId: rec.id }, new Date(Date.now() + 60 * 60 * 1000));
      }
      break;
    }

    case "ORDERS_CREATE": {
      // a purchase closes the loop — mark that shopper's pending checkouts recovered
      const o = payload as { email?: string; checkout_token?: string };
      const shopRecord = await db.shop.findUnique({ where: { domain: shop } });
      if (!shopRecord) break;
      if (o.checkout_token) {
        await db.abandonedCheckout.updateMany({
          where: { shopId: shopRecord.id, checkoutToken: o.checkout_token, status: "pending" },
          data: { status: "recovered" },
        });
      }
      if (o.email) {
        await db.abandonedCheckout.updateMany({
          where: { shopId: shopRecord.id, email: o.email, status: "pending" },
          data: { status: "recovered" },
        });
      }
      break;
    }

    // ---- Mandatory GDPR / privacy compliance webhooks (required for App Store
    // approval). This app requests NO protected customer data — scopes are
    // read/write_products + write_marketing_events only, so we never store
    // customer PII. The data-request / customer-redact handlers therefore have
    // nothing to return or erase; shop/redact wipes every trace of the shop. ----
    case "CUSTOMERS_DATA_REQUEST": {
      console.log(`[gdpr] customers/data_request for ${shop} — app stores no customer personal data`);
      break;
    }

    case "CUSTOMERS_REDACT": {
      console.log(`[gdpr] customers/redact for ${shop} — no customer personal data to erase`);
      break;
    }

    case "SHOP_REDACT": {
      // Fires ~48h after uninstall — the guaranteed final erasure. Uninstall
      // already clears most of this; repeat it idempotently so nothing lingers.
      await db.session.deleteMany({ where: { shop } });
      const shopRecord = await db.shop.findUnique({ where: { domain: shop } });
      if (shopRecord) await db.shop.delete({ where: { id: shopRecord.id } });
      console.log(`[gdpr] shop/redact complete for ${shop} — all shop data erased`);
      break;
    }

    default:
      console.log(`Unhandled webhook topic: ${topic}`);
  }

  return new Response(null, { status: 200 });
};
