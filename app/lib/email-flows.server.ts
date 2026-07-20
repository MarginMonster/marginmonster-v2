/* 📨 Shared send path for every automated email flow (welcome / post-purchase /
 * win-back / abandoned-cart). Loads the shop's brand voice, writes the email
 * with AI, and sends — but only when email is actually connected. Everything
 * short-circuits gracefully when it isn't, so flows are inert-safe pre-launch. */

import { db } from "../db.server";
import { emailEnabled, sendEmail } from "./email-provider.server";
import { writeMarketingEmail } from "./email-writer.server";
import type { EmailKind } from "./email-kinds";

export async function sendBrandEmail(
  shopId: string,
  opts: { to: string | null | undefined; kind: EmailKind; productTitle?: string; ctaUrl?: string }
): Promise<{ ok: boolean; reason?: string }> {
  if (!opts.to) return { ok: false, reason: "no-email" };
  if (!emailEnabled()) return { ok: false, reason: "not-connected" };
  const shop = await db.shop.findUnique({ where: { id: shopId }, include: { brandProfile: true } });
  if (!shop?.brandProfile) return { ok: false, reason: "no-brand" };
  try {
    const email = await writeMarketingEmail(shop.brandProfile, {
      kind: opts.kind,
      productTitle: opts.productTitle,
      storeName: shop.domain.replace(/\.myshopify\.com$/, ""),
      ctaUrl: opts.ctaUrl,
    });
    const res = await sendEmail({ to: opts.to, subject: email.subject, html: email.html });
    return { ok: res.ok, reason: res.ok ? undefined : "send-failed" };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
