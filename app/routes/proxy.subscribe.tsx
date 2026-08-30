/* 📥 Public email-capture endpoint — the storefront signup popup POSTs here
 * through the Shopify app proxy (/apps/easymode/subscribe → /proxy/subscribe).
 * authenticate.public.appProxy verifies the request's Shopify signature, so
 * only the merchant's own storefront can add subscribers.
 *
 * These opt-ins are OURS (the shopper consented on EasyMode's form), so we can
 * email them WITHOUT Shopify Protected Customer Data approval — the whole point
 * of building the list this way. */

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { enqueueJob } from "../lib/job-queue.server";

/* Intake limits. The proxy signature proves a request came through the
 * merchant's storefront — it says nothing about WHO submitted the form, and
 * the popup is public by design. Left unbounded, a script could post ten
 * thousand distinct addresses and enqueue ten thousand SEND_WELCOME jobs onto
 * a queue that runs one job at a time and is shared with video rendering, for
 * every merchant on the instance.
 *
 * Two thresholds, because losing a real opt-in is its own harm:
 *   SOFT — save the subscriber, skip the welcome job. Consent is kept, the
 *          queue is not fed. A genuine storefront never reaches this.
 *   HARD — refuse outright. Past this point it is not a signup rush. */
const WINDOW_MS = 10 * 60 * 1000;
const SOFT_LIMIT = 60;
const HARD_LIMIT = 500;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const action = async ({ request }: ActionFunctionArgs) => {
  // verifies the proxy signature — throws (→ 401) if the request isn't a genuine
  // Shopify storefront proxy call.
  await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shop") || "";
  if (!shopDomain) return json({ ok: false, error: "Missing shop." }, { status: 400 });

  let email = "";
  try {
    const form = await request.formData();
    email = String(form.get("email") || "").trim().toLowerCase();
  } catch {
    return json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return json({ ok: false, error: "Please enter a valid email." }, { status: 422 });
  }

  const shop = await db.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) return json({ ok: false }, { status: 404 });

  try {
    const existing = await db.subscriber.findUnique({
      where: { shopId_email: { shopId: shop.id, email } },
    });
    if (existing) {
      if (existing.status !== "subscribed") {
        await db.subscriber.update({ where: { id: existing.id }, data: { status: "subscribed" } });
      }
    } else {
      const recent = await db.subscriber.count({
        where: { shopId: shop.id, createdAt: { gte: new Date(Date.now() - WINDOW_MS) } },
      });
      if (recent >= HARD_LIMIT) {
        console.warn(`[subscribe] hard limit hit for ${shopDomain}: ${recent} signups in the window`);
        return json({ ok: false, error: "Too many signups right now. Please try again shortly." }, { status: 429 });
      }
      await db.subscriber.create({ data: { shopId: shop.id, email, source: "popup", status: "subscribed" } });
      // WELCOME flow — fires for brand-new subscribers only. PCD-free: this is
      // our own consented opt-in. Inert-safe (job no-ops if email not connected).
      if (recent < SOFT_LIMIT) {
        await enqueueJob(shop.id, "SEND_WELCOME", { email });
      } else {
        console.warn(`[subscribe] ${shopDomain} past ${SOFT_LIMIT} signups in the window — saved without a welcome email`);
      }
    }
  } catch (e) {
    console.error("[subscribe] failed:", e);
    return json({ ok: false, error: "Could not save right now." }, { status: 500 });
  }

  return json({ ok: true });
};

// A GET here (someone hitting the URL directly) shouldn't error the storefront.
export const loader = () => json({ ok: true });
