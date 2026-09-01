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
  const shop = await db.shop.findUnique({
    where: { id: shopId },
    include: { brandProfile: true, activePlan: true },
  });
  if (!shop?.brandProfile) return { ok: false, reason: "no-brand" };

  // AUTOMATED EMAIL IS GENERATION, AND GENERATION IS METERED.
  //
  // Every flow that reaches here writes a fresh email with Anthropic. None of
  // them charged for it, and the plan check that did exist elsewhere was
  // missing entirely — so a cancelled shop kept sending, and the welcome flow
  // in particular is reachable from a PUBLIC storefront form: one AI call per
  // address anyone chose to type in, on a worker that runs one job at a time.
  //
  // Same rule the PRODUCTS_CREATE auto-generation follows: spend first, and a
  // wallet that cannot cover it simply skips. These are emails the app sends
  // on the merchant's behalf, so they must never fail loudly or leave the
  // merchant owing anything.
  if (!shop.activePlan?.active) return { ok: false, reason: "no-plan" };

  const { spendTokens, refundTokens } = await import("./tokens.server");
  const { TOKEN_COST } = await import("./plan-config");
  let fromExtra = 0;
  try {
    fromExtra = (await spendTokens(shopId, TOKEN_COST.email)).fromExtra;
  } catch {
    return { ok: false, reason: "no-tokens" };
  }

  const refund = async () => {
    try { await refundTokens(shopId, TOKEN_COST.email, fromExtra); }
    catch (e) { console.error("[email] refund failed:", e); }
  };

  try {
    const email = await writeMarketingEmail(shop.brandProfile, {
      kind: opts.kind,
      productTitle: opts.productTitle,
      storeName: shop.domain.replace(/\.myshopify\.com$/, ""),
      ctaUrl: opts.ctaUrl,
      unsubscribeUrl: optOutLink,
      contentLang: shop.contentLang,
    });
    const res = await sendEmail({
      to,
      subject: email.subject,
      html: email.html,
      unsubscribeUrl: optOutLink,
    });
    if (!res.ok) await refund(); // nothing was delivered, so nothing is owed
    return { ok: res.ok, reason: res.ok ? undefined : "send-failed" };
  } catch (e) {
    await refund();
    return { ok: false, reason: (e as Error).message };
  }
}
