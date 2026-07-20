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
    await db.subscriber.upsert({
      where: { shopId_email: { shopId: shop.id, email } },
      create: { shopId: shop.id, email, source: "popup", status: "subscribed" },
      update: { status: "subscribed" },
    });
  } catch (e) {
    console.error("[subscribe] failed:", e);
    return json({ ok: false, error: "Could not save right now." }, { status: 500 });
  }

  return json({ ok: true });
};

// A GET here (someone hitting the URL directly) shouldn't error the storefront.
export const loader = () => json({ ok: true });
