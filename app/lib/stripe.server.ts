/* Stripe billing for the web front door — thin fetch client, no SDK dep.
 * Subscriptions mirror the SAME 3-tier ladder as Shopify Billing (one source
 * of truth: plan-config.ts) and land on the SAME Plan wallet; only the payer
 * differs. Token packs are one-time payments credited to tokensExtra.
 *
 * Env: STRIPE_SECRET_KEY (sk_…), STRIPE_WEBHOOK_SECRET (whsec_…).
 * Both unset → billing UI shows "coming online" and nothing charges. */

import crypto from "node:crypto";
import { db } from "../db.server";
import { PLAN_BY_KEY, TOKEN_PACKS, annualPrice, type PlanKey } from "./plan-config";

const API = "https://api.stripe.com/v1";

export function stripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

async function stripePost(path: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
  });
  const j = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = (j.error as { message?: string })?.message || `Stripe ${res.status}`;
    throw new Error(err);
  }
  return j;
}

/** Subscription checkout for a tier (monthly or annual), 7-day trial. */
export async function createPlanCheckout(opts: {
  accountId: string;
  email: string;
  tierKey: PlanKey;
  annual: boolean;
  baseUrl: string;
}): Promise<string> {
  const tier = PLAN_BY_KEY[opts.tierKey];
  const amount = (opts.annual ? annualPrice(tier) : tier.price) * 100;
  const session = await stripePost("/checkout/sessions", {
    mode: "subscription",
    customer_email: opts.email,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(amount),
    "line_items[0][price_data][recurring][interval]": opts.annual ? "year" : "month",
    "line_items[0][price_data][product_data][name]": `EasyMode ${tier.name} plan${opts.annual ? " (annual)" : ""}`,
    "subscription_data[trial_period_days]": "7",
    "subscription_data[metadata][accountId]": opts.accountId,
    "subscription_data[metadata][tierKey]": opts.tierKey,
    "metadata[accountId]": opts.accountId,
    "metadata[tierKey]": opts.tierKey,
    success_url: `${opts.baseUrl}/web?welcome=${opts.tierKey}`,
    cancel_url: `${opts.baseUrl}/web`,
  });
  return session.url as string;
}

/** One-time token pack checkout. */
export async function createPackCheckout(opts: {
  accountId: string;
  email: string;
  tokens: number;
  baseUrl: string;
}): Promise<string> {
  const pack = TOKEN_PACKS.find((p) => p.tokens === opts.tokens);
  if (!pack) throw new Error("Unknown token pack");
  const session = await stripePost("/checkout/sessions", {
    mode: "payment",
    customer_email: opts.email,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(pack.price * 100),
    "line_items[0][price_data][product_data][name]": `EasyMode ${pack.tokens.toLocaleString()} token pack`,
    "metadata[accountId]": opts.accountId,
    "metadata[packTokens]": String(pack.tokens),
    success_url: `${opts.baseUrl}/web?topped=${pack.tokens}`,
    cancel_url: `${opts.baseUrl}/web`,
  });
  return session.url as string;
}

/** Verify the Stripe-Signature header (t=…,v1=…) against the raw body. */
export function verifyStripeSignature(rawBody: string, sigHeader: string | null): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=") as [string, string]));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  // 5-minute tolerance against replay
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function webShopIdFor(accountId: string): Promise<string | null> {
  const conn = await db.connection.findFirst({ where: { accountId, kind: "web" } });
  return conn?.externalId ?? null;
}

/** Activate/refresh the account's plan from a Stripe subscription event. */
export async function activateStripePlan(accountId: string, tierKey: string, subId: string | null, customerId: string | null): Promise<void> {
  const tier = PLAN_BY_KEY[tierKey as PlanKey];
  if (!tier) return;
  const shopId = await webShopIdFor(accountId);
  if (!shopId) return;
  await db.account.update({
    where: { id: accountId },
    data: { stripeSubId: subId, stripeCustomerId: customerId },
  }).catch(() => { /* non-fatal */ });
  await db.plan.upsert({
    where: { shopId },
    create: {
      shopId, type: tier.key, reviewMode: "REVIEW_FIRST",
      blogQuota: tier.blogQuota, videoQuota: tier.videoQuota, imageQuota: tier.imageQuota,
      adCreativePack: tier.imageQuota > 0, campaignAutopilot: tier.campaignAutopilot,
      periodStart: new Date(), tokensIncluded: tier.monthlyTokens, tokensUsed: 0,
      trialEndsAt: new Date(Date.now() + 7 * 86_400_000),
    },
    update: {
      type: tier.key, active: true,
      blogQuota: tier.blogQuota, videoQuota: tier.videoQuota, imageQuota: tier.imageQuota,
      adCreativePack: tier.imageQuota > 0, campaignAutopilot: tier.campaignAutopilot,
      tokensIncluded: tier.monthlyTokens, tokensUsed: 0, periodStart: new Date(),
    },
  });
}

export async function deactivateStripePlan(accountId: string): Promise<void> {
  const shopId = await webShopIdFor(accountId);
  if (!shopId) return;
  await db.plan.updateMany({ where: { shopId }, data: { active: false } });
}

export async function creditStripePack(accountId: string, tokens: number): Promise<void> {
  const shopId = await webShopIdFor(accountId);
  if (!shopId || tokens <= 0) return;
  await db.plan.updateMany({ where: { shopId }, data: { tokensExtra: { increment: tokens } } });
}
