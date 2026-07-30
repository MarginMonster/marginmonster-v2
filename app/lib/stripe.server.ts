/* Stripe billing for the web front door — thin fetch client, no SDK dep.
 * Subscriptions mirror the SAME 3-tier ladder as Shopify Billing (one source
 * of truth: plan-config.ts) and land on the SAME Plan wallet; only the payer
 * differs. Token packs are one-time payments credited to tokensExtra.
 *
 * Env: STRIPE_SECRET_KEY (sk_…) is the only required var — the webhook
 * endpoint self-provisions via the Stripe API at boot and its signing secret
 * is stored in the Setting table (STRIPE_WEBHOOK_SECRET env, if set, wins).
 * Key unset → billing UI shows "coming online" and nothing charges. */

import crypto from "node:crypto";
import { db } from "../db.server";
import { artLog } from "./art-log.server";
import { PLAN_BY_KEY, TOKEN_PACKS, annualPrice, type PlanKey } from "./plan-config";

const API = "https://api.stripe.com/v1";

export function stripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

async function stripeReq(method: string, path: string, form?: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const j = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = (j.error as { message?: string })?.message || `Stripe ${res.status}`;
    throw new Error(err);
  }
  return j;
}

const stripePost = (path: string, form: Record<string, string>) => stripeReq("POST", path, form);

/* ---- Webhook self-provisioning ------------------------------------------ */

const WEBHOOK_SECRET_SETTING = "stripe_webhook_secret";
const WEBHOOK_EVENTS = ["checkout.session.completed", "customer.subscription.updated", "customer.subscription.deleted"];
let cachedWebhookSecret: string | null | undefined;
let webhookProvisionInFlight = false;

function webhookUrl(): string {
  const base = (process.env.STRIPE_WEBHOOK_URL_BASE || process.env.SHOPIFY_APP_URL || "https://easymodeapp.com").replace(/\/$/, "");
  return `${base}/api/stripe-webhook`;
}

async function webhookSecret(): Promise<string | null> {
  if (process.env.STRIPE_WEBHOOK_SECRET) return process.env.STRIPE_WEBHOOK_SECRET;
  if (cachedWebhookSecret !== undefined) return cachedWebhookSecret;
  const row = await db.setting.findUnique({ where: { key: WEBHOOK_SECRET_SETTING } }).catch(() => null);
  cachedWebhookSecret = row?.value || null;
  return cachedWebhookSecret;
}

/** True once webhook events can be verified (env secret or self-provisioned). */
export async function stripeWebhookReady(): Promise<boolean> {
  return stripeEnabled() && !!(await webhookSecret());
}

/** Create our webhook endpoint via the Stripe API if we don't have one yet.
 * Stripe returns the signing secret only at creation time — it's stored in
 * the DB (never logged). Endpoints at our URL whose secret we don't hold are
 * deleted first so events aren't double-delivered. Fire-and-forget at boot. */
export function ensureStripeWebhook(): void {
  if (!stripeEnabled() || webhookProvisionInFlight) return;
  webhookProvisionInFlight = true;
  (async () => {
    try {
      if (await webhookSecret()) return; // already configured
      const url = webhookUrl();
      const existing = await stripeReq("GET", "/webhook_endpoints?limit=100");
      const stale = ((existing.data as { id: string; url: string }[]) || []).filter((e) => e.url === url);
      for (const e of stale) {
        await stripeReq("DELETE", `/webhook_endpoints/${e.id}`).catch(() => { /* best-effort */ });
      }
      const form: Record<string, string> = { url, description: "EasyMode web billing (auto-provisioned)" };
      WEBHOOK_EVENTS.forEach((ev, i) => { form[`enabled_events[${i}]`] = ev; });
      const created = await stripeReq("POST", "/webhook_endpoints", form);
      const secret = created.secret as string | undefined;
      if (!secret) throw new Error("no signing secret in create response");
      await db.setting.upsert({
        where: { key: WEBHOOK_SECRET_SETTING },
        create: { key: WEBHOOK_SECRET_SETTING, value: secret },
        update: { value: secret },
      });
      cachedWebhookSecret = secret;
      artLog("stripe", `webhook endpoint provisioned at ${url}${stale.length ? ` (replaced ${stale.length} stale)` : ""}`);
    } catch (e) {
      artLog("stripe", `webhook provisioning FAILED — ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    } finally {
      webhookProvisionInFlight = false;
    }
  })();
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
    "line_items[0][price_data][product_data][description]": `${tier.monthlyTokens.toLocaleString()} tokens every month — AI videos, image ads, articles & auto-posting for your store.`,
    "line_items[0][price_data][product_data][images][0]": `${opts.baseUrl}/ad-templates/phcover.jpg`,
    "custom_text[submit][message]": "🚀 7 days free — you won't be charged today, and you can cancel anytime before day 7. Your store's marketing goes on autopilot the moment you're in.",
    "custom_text[after_submit][message]": "Welcome to EasyMode. Head back to your dashboard — your Studio is already unlocked.",
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
    "line_items[0][price_data][product_data][description]": "Tokens land in your balance instantly — spend them on any generator.",
    "line_items[0][price_data][product_data][images][0]": `${opts.baseUrl}/ad-templates/phcover.jpg`,
    "custom_text[submit][message]": "⚡ Instant top-up — your tokens hit the balance the second this clears. Straight back to creating.",
    "metadata[accountId]": opts.accountId,
    "metadata[packTokens]": String(pack.tokens),
    success_url: `${opts.baseUrl}/web?topped=${pack.tokens}`,
    cancel_url: `${opts.baseUrl}/web`,
  });
  return session.url as string;
}

/** Verify the Stripe-Signature header (t=…,v1=…) against the raw body. */
export async function verifyStripeSignature(rawBody: string, sigHeader: string | null): Promise<boolean> {
  const secret = await webhookSecret();
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
