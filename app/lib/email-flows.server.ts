/* 📨 Shared send path for every automated email flow (welcome / post-purchase /
 * win-back / abandoned-cart). Loads the shop's brand voice, writes the email
 * with AI, and sends — but only when email is actually connected. Everything
 * short-circuits gracefully when it isn't, so flows are inert-safe pre-launch. */

import { db } from "../db.server";
import { emailEnabled, sendEmail } from "./email-provider.server";
import { writeMarketingEmail } from "./email-writer.server";
import { unsubscribeUrl } from "./unsubscribe.server";
import type { EmailKind } from "./email-kinds";

export async function sendBrandEmail(
  shopId: string,
  opts: { to: string | null | undefined; kind: EmailKind; productTitle?: string; ctaUrl?: string }
): Promise<{ ok: boolean; reason?: string }> {
  if (!opts.to) return { ok: false, reason: "no-email" };
  if (!emailEnabled()) return { ok: false, reason: "not-connected" };

  const to = opts.to.trim().toLowerCase();

  // Never mail an address that has opted out. Every flow funnels through here,
  // so this one check covers welcome, post-purchase and win-back alike.
  const optedOut = await db.subscriber.findUnique({
    where: { shopId_email: { shopId, email: to } },
    select: { status: true },
  });
  if (optedOut && optedOut.status !== "subscribed") return { ok: false, reason: "unsubscribed" };

  // An email that cannot carry a working opt-out must not go out at all. If
  // the signing secret or the public URL is missing, that is a misconfiguration
  // to fix, not a reason to send unlawful mail.
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  let optOutLink = "";
  try {
    if (!base) throw new Error("SHOPIFY_APP_URL unset");
    optOutLink = unsubscribeUrl(base, shopId, to);
  } catch (e) {
    console.error("[email] refusing to send without a working unsubscribe link:", (e as Error).message);
    return { ok: false, reason: "no-optout" };
  }
  const shop = await db.shop.findUnique({ where: { id: shopId }, include: { brandProfile: true } });
  if (!shop?.brandProfile) return { ok: false, reason: "no-brand" };
  try {
    const email = await writeMarketingEmail(shop.brandProfile, {
      kind: opts.kind,
      productTitle: opts.productTitle,
      storeName: shop.domain.replace(/\.myshopify\.com$/, ""),
      ctaUrl: opts.ctaUrl,
      unsubscribeUrl: optOutLink,
    });
    const res = await sendEmail({
      to,
      subject: email.subject,
      html: email.html,
      unsubscribeUrl: optOutLink,
    });
    return { ok: res.ok, reason: res.ok ? undefined : "send-failed" };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
