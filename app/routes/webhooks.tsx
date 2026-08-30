import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { enqueueJob } from "../lib/job-queue.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload, admin } = await authenticate.webhook(request);

  switch (topic) {
    case "APP_UNINSTALLED": {
      // Clean up shop data AND the SDK session on uninstall. Deleting the
      // session is critical: otherwise a reinstall reuses the stale grant
      // (old scopes / deprecated token), which 403-gates the Admin API.
      await db.session.deleteMany({ where: { shop } });

      // THE SHOP ROW STAYS. This used to be db.shop.delete(), which cascades
      // through eighteen relations — the Plan (including tokensExtra, top-up
      // tokens the merchant paid cash for and which never expire), every Asset
      // in the Archive, the brand profile, the subscriber list, the questlines.
      // Uninstalling is not a request to be erased, and it is routinely done
      // for reasons that end in a reinstall — including the stale-scope fix
      // the session cleanup above exists to support. Shopify's own retention
      // window is 48 hours, after which the mandatory shop/redact webhook
      // fires and erases everything for real. That is the right place for
      // deletion; this is the right place to switch the app off.
      const shopRecord = await db.shop.findUnique({ where: { domain: shop } });
      if (shopRecord) {
        await db.shop.update({ where: { id: shopRecord.id }, data: { uninstalledAt: new Date() } });
        // Billing stops at uninstall, so the plan must too.
        await db.plan.updateMany({ where: { shopId: shopRecord.id }, data: { active: false } });
        // Nothing queued can succeed without an access token, and the queue
        // runs one job at a time for every tenant. Drop the backlog rather
        // than let it fail its way through in front of paying work.
        await db.job.updateMany({
          where: { shopId: shopRecord.id, status: "PENDING" },
          data: { status: "FAILED", lastError: "Shop uninstalled the app." },
        });
      }
      break;
    }

    case "PRODUCTS_CREATE": {
      const shopRecord = await db.shop.findUnique({
        where: { domain: shop },
        include: { activePlan: true, brandProfile: true },
      });

      // `activePlan` is only the RELATION NAME — Prisma does not filter it by
      // `active`, so a cancelled shop still has one and kept receiving free
      // auto-generated content after they stopped paying.
      if (shopRecord?.activePlan?.active && shopRecord?.brandProfile) {
        const plan = shopRecord.activePlan;
        const product = payload as { title: string; body_html: string; images: { src: string }[] };
        const desc = product.body_html?.replace(/<[^>]+>/g, "") || "";

        // AUTO-GENERATION IS SPENDING, AND IT HAS TO BE METERED.
        //
        // This handler used to enqueue up to three renders per product with no
        // charge of any kind — no spendTokens, no quota arithmetic, gated only
        // on quota fields being non-zero. A merchant bulk-importing a catalogue
        // (CSV, DSers, a migration app) fires one of these per product: 200
        // products became 600 free jobs, 200 of them videos, each costing us
        // real provider money. The trial ceiling does not apply either, because
        // it lives inside the wallet and this path never touched the wallet.
        //
        // Charged the same way every other enqueue in the app is: spend first,
        // then record prePaid/chargedTokens so a terminal failure refunds. A
        // wallet that cannot cover a piece simply skips it — this is a courtesy
        // the app performs unasked, so it must never fail the webhook or leave
        // the merchant owing anything.
        const { spendTokens } = await import("../lib/tokens.server");
        const { TOKEN_COST } = await import("../lib/plan-config");

        // A second ceiling, on top of the wallet: a bulk import should not be
        // able to drain a month of tokens in one afternoon just because the
        // merchant moved their catalogue in.
        const AUTO_DAILY_CAP = 9; // ~3 products a day across the three types
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const autoToday = await db.job.count({
          where: {
            shopId: shopRecord.id,
            createdAt: { gte: since },
            payload: { contains: '"autoFromProduct":true' },
          },
        });
        if (autoToday >= AUTO_DAILY_CAP) {
          console.log(`[auto-content] ${shop}: daily cap reached (${autoToday}) — skipping`);
          break;
        }

        const queue = async (type: string, cost: number, extra: Record<string, unknown>) => {
          let chargedFromExtra = 0;
          try {
            chargedFromExtra = (await spendTokens(shopRecord.id, cost)).fromExtra;
          } catch {
            return; // wallet cannot cover it — skip quietly, nothing is owed
          }
          await enqueueJob(shopRecord.id, type, {
            ...extra,
            autoFromProduct: true,
            prePaid: true,
            chargedTokens: cost,
            chargedFromExtra,
          });
        };

        // Enqueue whatever the plan's quotas include.
        if (plan.blogQuota > 0) {
          await queue("GENERATE_BLOG_POST", TOKEN_COST.blog, {
            productTitle: product.title,
            productDescription: desc.slice(0, 500),
          });
        }
        if (plan.videoQuota > 0) {
          await queue("GENERATE_VIDEO_AD", TOKEN_COST.video, {
            productTitle: product.title,
            productDescription: desc.slice(0, 300),
            productImageUrl: product.images?.[0]?.src,
            style: "PRODUCT_HIGHLIGHT",
          });
        }
        if (plan.imageQuota > 0) {
          await queue("GENERATE_IMAGE_AD", TOKEN_COST.image, {
            productTitle: product.title,
            productImageUrl: product.images?.[0]?.src,
          });
          // (Ad-copy auto-gen removed: it only ever surfaced in the retired
          //  Content Queue and nothing in the current flow consumes it — Boost
          //  uses the image/video asset and captions are written at post time.)
        }

      }
      break;
    }

    case "APP_SUBSCRIPTIONS_UPDATE": {
      // Billing truth stays synced: cancelled/expired/declined/frozen
      // subscriptions switch the plan OFF; a (re)activated one switches it on.
      // The plan row keeps its type/quotas so a reactivation restores cleanly.
      const sub = (payload as {
        app_subscription?: { status?: string; admin_graphql_api_id?: string };
      }).app_subscription;
      const status = sub?.status?.toUpperCase() || "";
      // gid://shopify/AppSubscription/1234567890 -> "1234567890", the same
      // shape app.plans.tsx stores in Plan.activationChargeId.
      const subId = (sub?.admin_graphql_api_id || "").replace(/[^0-9]/g, "");
      const shopRecord = await db.shop.findUnique({ where: { domain: shop }, include: { activePlan: true } });
      if (shopRecord?.activePlan && status) {
        const plan = shopRecord.activePlan;
        const nowActive = status === "ACTIVE";

        // WHICH subscription this is about is the whole question, and the
        // handler used to ignore it. Changing tier does not edit a subscription
        // on Shopify — it creates a new one and cancels the old, and the
        // cancellation fires this webhook. So a merchant who upgraded and paid
        // MORE got their plan switched off by the CANCELLED event for the
        // subscription they had just left. Delivery order is not guaranteed
        // either, so even a well-ordered pair could land the wrong way round
        // and lock a paying merchant out of what they just bought.
        //
        // Plan.activationChargeId records the charge that actually granted this
        // plan. When it is known and this event is about some other
        // subscription, that subscription ending says nothing about the plan.
        const knownOther = !!plan.activationChargeId && !!subId && subId !== plan.activationChargeId;
        if (knownOther && !nowActive) {
          console.log(`[billing] ${shop} ignoring ${status} for superseded subscription ${subId}`);
          break;
        }

        // With no recorded charge id there is nothing to match against, so ask
        // Shopify rather than switch a paying merchant off on a guess. Only a
        // confirmed absence of any live subscription counts as cancelled.
        if (!nowActive && !plan.activationChargeId && admin) {
          try {
            const res = await admin.graphql(
              `{ currentAppInstallation { activeSubscriptions { id status } } }`
            );
            const j = (await res.json()) as {
              data?: { currentAppInstallation?: { activeSubscriptions?: { status?: string }[] } };
            };
            const live = (j.data?.currentAppInstallation?.activeSubscriptions || []).some(
              (x) => x.status?.toUpperCase() === "ACTIVE"
            );
            if (live) {
              console.log(`[billing] ${shop} ${status} received but a live subscription remains — plan stays ON`);
              break;
            }
          } catch (e) {
            // No usable admin client or a query hiccup. Fall through to the
            // old behaviour; the plans page re-activates on the next visit.
            console.error("[billing] could not confirm remaining subscriptions:", e);
          }
        }

        if (plan.active !== nowActive) {
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
      const o = payload as { email?: string; checkout_token?: string; line_items?: { title?: string }[] };
      const shopRecord = await db.shop.findUnique({ where: { domain: shop } });
      if (!shopRecord) break;

      // 1) a purchase closes the abandoned-cart loop — mark it recovered
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

        // 2) POST-PURCHASE thank-you
        await enqueueJob(shopRecord.id, "SEND_POST_PURCHASE", {
          email: o.email,
          productTitle: o.line_items?.[0]?.title,
        });

        // 3) WIN-BACK timer — record the order and schedule a nudge +45d that only
        // fires if they don't order again (see CustomerLifecycle in the job).
        const now = new Date();
        await db.customerLifecycle.upsert({
          where: { shopId_email: { shopId: shopRecord.id, email: o.email } },
          create: { shopId: shopRecord.id, email: o.email, lastOrderAt: now },
          update: { lastOrderAt: now },
        });
        await enqueueJob(
          shopRecord.id,
          "SEND_WINBACK",
          { email: o.email, orderAt: now.toISOString() },
          new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000)
        );
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
