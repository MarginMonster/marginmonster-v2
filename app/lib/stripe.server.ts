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
const stripeDelete = (path: string) => stripeReq("DELETE", path);

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

/** Has this account already had its one free trial?
 *
 *  trialUsedAt was added after the first web accounts existed, so it is null
 *  for them. A recorded subscription id is proof enough on its own — you do
 *  not get one without having gone through checkout. */
export function trialAlreadyTaken(a: { trialUsedAt?: Date | string | null; stripeSubId?: string | null } | null | undefined): boolean {
  return !!a?.trialUsedAt || !!a?.stripeSubId;
}

/** Subscription checkout for a tier (monthly or annual).
 *
 * THE FREE TRIAL IS GRANTED ONCE PER ACCOUNT, AND ITS END DATE NEVER MOVES.
 *
 * This used to attach `trial_period_days: 7` unconditionally, and every tier
 * change opens a brand-new checkout session (that is what the cancel-the-old
 * -subscription block in activateStripePlan exists to clean up after). So a
 * merchant could switch tier on day 6, get another seven free days, and have
 * the superseded subscription cancelled inside its own trial — never invoiced.
 * Repeat weekly and the plan stays active forever without a cent being
 * charged. Each session also passed customer_email rather than a customer id,
 * minting a fresh Stripe Customer every time, so Stripe's own trial-
 * eligibility tracking never had a chance to notice either.
 *
 * It also disarmed the token cap. Plan.trialEndsAt is written only on the
 * upsert's create branch, so it stayed frozen at the ORIGINAL date while
 * Stripe ran a fresh unpaid trial — and once that stale date passed,
 * planTrialing() went false and the 400-token trial ceiling stopped applying
 * to an account that had still never paid.
 *
 * Now: the first subscription gets seven days. A later one carries the
 * ORIGINAL trial end forward (so switching tier mid-trial is not punished by
 * an immediate charge) and can never push it back. Once that date is behind
 * us, no trial parameters are sent at all and Stripe bills straight away. */
export async function createPlanCheckout(opts: {
  accountId: string;
  email: string;
  tierKey: PlanKey;
  annual: boolean;
  baseUrl: string;
  /** Account.trialUsedAt — null means the trial has never been taken. */
  trialUsedAt?: Date | string | null;
  /** Plan.trialEndsAt — the trial window already in flight, if any. */
  trialEndsAt?: Date | string | null;
  /** Account.stripeCustomerId, so Stripe sees one customer per account. */
  customerId?: string | null;
}): Promise<string> {
  const tier = PLAN_BY_KEY[opts.tierKey];
  const amount = (opts.annual ? annualPrice(tier) : tier.price) * 100;

  // Trial parameters, or none.
  let trialParams: Record<string, string> = {};
  if (!opts.trialUsedAt) {
    trialParams = { "subscription_data[trial_period_days]": "7" };
  } else if (opts.trialEndsAt) {
    const endsMs = new Date(opts.trialEndsAt).getTime();
    // Stripe rejects a trial_end that is not comfortably in the future, so
    // below roughly two days we simply bill now rather than risk a 400 that
    // would leave the merchant staring at a dead checkout button.
    if (Number.isFinite(endsMs) && endsMs - Date.now() > 49 * 3_600_000) {
      trialParams = { "subscription_data[trial_end]": String(Math.floor(endsMs / 1000)) };
    }
  }
  const trialing = Object.keys(trialParams).length > 0;

  const session = await stripePost("/checkout/sessions", {
    mode: "subscription",
    // Reuse the account's Stripe customer when we have one. A new customer per
    // checkout scattered one merchant's subscriptions across several records
    // and hid the duplicate from Stripe's own trial handling.
    ...(opts.customerId ? { customer: opts.customerId } : { customer_email: opts.email }),
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(amount),
    "line_items[0][price_data][recurring][interval]": opts.annual ? "year" : "month",
    "line_items[0][price_data][product_data][name]": `EasyMode ${tier.name} plan${opts.annual ? " (annual)" : ""}`,
    "line_items[0][price_data][product_data][description]": `${tier.monthlyTokens.toLocaleString()} tokens every month — AI videos, image ads, articles & auto-posting for your store.`,
    "line_items[0][price_data][product_data][images][0]": `${opts.baseUrl}/ad-templates/phcover.jpg`,
    // Say what will actually happen. Promising "7 days free" to someone who
    // has already used the trial and is about to be charged today is the kind
    // of surprise that becomes a chargeback.
    "custom_text[submit][message]": trialing
      ? "🚀 Your free trial is on — you won't be charged today, and you can cancel anytime before it ends. Your store's marketing goes on autopilot the moment you're in."
      : "🚀 Your plan starts today. Cancel anytime — your store's marketing goes on autopilot the moment you're in.",
    "custom_text[after_submit][message]": "Welcome to EasyMode. Head back to your dashboard — your Studio is already unlocked.",
    ...trialParams,
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
  // A TIER CHANGE MUST END THE OLD SUBSCRIPTION.
  //
  // createPlanCheckout always opens a FRESH subscription session — no
  // `customer`, no reference to the incumbent — and this function then
  // overwrote stripeSubId with the new id. The previous subscription stayed
  // live at Stripe with nothing pointing at it: no cancel call exists
  // anywhere in this file, and there is no billing-portal link, so neither
  // the app nor the merchant could end it. From the next cycle the card was
  // charged for BOTH plans, every month, for one plan's service. Downgrades
  // did the same, and each switch handed out another 7-day trial.
  //
  // Order is load-bearing. The new id is recorded FIRST, so when Stripe
  // sends customer.subscription.deleted for the one we just cancelled,
  // deactivateStripePlan sees it does not match the live subscription and
  // ignores it — otherwise cancelling the old plan would switch off the plan
  // the merchant just bought.
  const prior = await db.account.findUnique({
    where: { id: accountId },
    select: { stripeSubId: true, trialUsedAt: true },
  }).catch(() => null);

  // The first activation is the one that consumes the trial. Recording it
  // here — not at checkout — means an abandoned checkout never burns it.
  const firstEver = !trialAlreadyTaken(prior);
  await db.account.update({
    where: { id: accountId },
    data: {
      stripeSubId: subId,
      stripeCustomerId: customerId,
      ...(firstEver ? { trialUsedAt: new Date() } : {}),
    },
  }).catch(() => { /* non-fatal */ });

  if (prior?.stripeSubId && subId && prior.stripeSubId !== subId) {
    try {
      await stripeDelete(`/subscriptions/${prior.stripeSubId}`);
      console.log(`[stripe] account ${accountId}: cancelled superseded subscription ${prior.stripeSubId}`);
    } catch (e) {
      // Loud, and deliberately not fatal: the merchant has already paid for
      // the new plan and must get it. But this is a live duplicate charge",
      // so it needs a human.
      console.error(
        `[stripe] account ${accountId}: FAILED to cancel superseded subscription ${prior.stripeSubId} — ` +
        `this account is now billed for TWO plans until it is cancelled by hand: ` +
        (e instanceof Error ? e.message : String(e))
      );
    }
  }
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
      tokensIncluded: tier.monthlyTokens,
      // trialEndsAt is deliberately NOT rewritten here. It belongs to the
      // account's one trial, createPlanCheckout carries the same date onto
      // any later subscription, and moving it forward on a plan edit is
      // exactly how the trial ceiling used to come unstuck.
      // NOT tokensUsed:0 / periodStart:now. This runs on every
      // customer.subscription.updated (api.stripe-webhook.tsx:38), not just on
      // first activation, so resetting here handed back a full monthly
      // allowance on any subscription edit — repeatable, and real COGS.
      // refreshPeriod() in tokens.server.ts owns the monthly roll and is
      // correctly guarded on PERIOD_MS having actually elapsed.
    },
  });
  // Post-activation hooks — same rituals the Shopify billing return-leg runs
  // (app.plans loader). All shop-keyed, all idempotent, all non-fatal:
  // INSERT_COIN unlocks once (unique key), referral credit is one-shot
  // guarded, and the first-content kick claims onboardKickAt before firing.
  try {
    const { unlockAchievement } = await import("./xp.server");
    await unlockAchievement(shopId, "INSERT_COIN");
  } catch (e) { console.error("[stripe] achievement unlock failed (non-fatal):", e); }
  try {
    const { creditReferralOnConversion } = await import("./referral.server");
    await creditReferralOnConversion(shopId);
  } catch (e) { console.error("[stripe] referral credit failed (non-fatal):", e); }
  try {
    // Web shops have no Shopify catalog — pass a null graphql. kickstart
    // no-ops safely (no product → no jobs, flag left unset) today and starts
    // working the moment web accounts grow a product source.
    const { kickstartFirstContent } = await import("./onboarding.server");
    await kickstartFirstContent(shopId, async () => null);
  } catch (e) { console.error("[stripe] first-content kick failed (non-fatal):", e); }
}

/** Turn the plan off when a subscription ends.
 *
 *  `subId` is the subscription that actually cancelled. It matters because an
 *  upgrade opens a SECOND Stripe subscription rather than editing the first, so
 *  a cancellation event for the superseded one used to switch off the plan the
 *  merchant had just upgraded to and is actively paying for.
 *
 *  When the ids disagree we keep the plan ON and say so loudly. Of the two ways
 *  to be wrong, leaving a cancelled merchant with access for a while is a
 *  revenue leak that shows up in the log; cutting off a paying merchant is an
 *  outage they feel immediately and blame us for. */
export async function deactivateStripePlan(accountId: string, subId?: string | null): Promise<void> {
  const shopId = await webShopIdFor(accountId);
  if (!shopId) return;

  if (subId) {
    const account = await db.account.findUnique({ where: { id: accountId }, select: { stripeSubId: true } });
    if (account?.stripeSubId && account.stripeSubId !== subId) {
      console.warn(
        `[stripe] account ${accountId}: ignoring cancellation of ${subId} — the live subscription is ` +
          `${account.stripeSubId}. If that is wrong the plan will stay active, so check this account.`
      );
      return;
    }
  }

  await db.plan.updateMany({ where: { shopId }, data: { active: false } });
}

/** Credit a purchased token pack — EXACTLY ONCE per Stripe charge.
 *
 *  Stripe retries a webhook whenever the endpoint doesn't 200 (and our handler
 *  deliberately 500s so it will), and the dashboard can Resend by hand. A bare
 *  `increment` keyed only on shopId therefore paid out twice for one purchase.
 *  TokenPurchase.chargeId is unique precisely for this — the Shopify billing
 *  leg already guards the same feature this way. Write the receipt FIRST: if
 *  the insert collides, this charge was already credited and we stop. */
export async function creditStripePack(accountId: string, tokens: number, chargeId?: string | null): Promise<void> {
  const shopId = await webShopIdFor(accountId);
  if (!shopId || tokens <= 0) return;

  if (chargeId) {
    try {
      await db.tokenPurchase.create({ data: { shopId, chargeId, tokens, amountUsd: 0 } });
    } catch {
      // Unique violation on chargeId = replayed webhook. Anything else failing
      // here would also be unsafe to credit blind, so stop either way.
      console.log(`[stripe] pack ${chargeId} already credited — ignoring replay`);
      return;
    }
  } else {
    console.warn("[stripe] crediting a token pack with no chargeId — cannot guard against a replayed webhook");
  }

  await db.plan.updateMany({ where: { shopId }, data: { tokensExtra: { increment: tokens } } });
}

/** End a free trial NOW, at the merchant's request.
 *
 *  A trial is capped at TRIAL_TOKEN_CAP tokens. Burn through those on day one
 *  and the old behaviour was to sit idle until day seven — a merchant who
 *  WANTS to start paying being told to wait. This bills them immediately:
 *  Stripe closes the trial and raises the first invoice, and we drop the local
 *  trial flag so the full allowance (and any purchased top-up, which the trial
 *  holds back) unlocks the moment they land back on the page.
 *
 *  Returns a human-readable reason on failure — never throws at the caller. */
export async function endTrialNow(accountId: string): Promise<{ ok: boolean; error?: string }> {
  if (!stripeEnabled()) return { ok: false, error: "Billing isn't configured on this server yet." };
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account?.stripeSubId) {
    return { ok: false, error: "No live subscription on this account — pick a plan first." };
  }
  const conn = await db.connection.findFirst({ where: { accountId, kind: "web" } });
  if (!conn) return { ok: false, error: "This account isn't linked to a workspace yet." };

  try {
    // trial_end=now closes the trial and invoices immediately. Stripe's
    // customer.subscription.updated webhook follows, but we don't wait on it:
    // the merchant is standing on the page expecting their tokens.
    await stripePost(`/subscriptions/${account.stripeSubId}`, {
      trial_end: "now",
      proration_behavior: "none",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[stripe] end-trial failed:", msg.slice(0, 200));
    // Card declines are the common case and the merchant can act on them.
    return {
      ok: false,
      error: /card|declin|payment|insufficient/i.test(msg)
        ? "Your card was declined — update it and try again."
        : "Couldn't start the plan just now. Try again in a moment.",
    };
  }

  await db.plan.updateMany({
    where: { shopId: conn.externalId },
    data: { trialEndsAt: null, periodStart: new Date(), tokensUsed: 0, active: true },
  });
  console.log(`[stripe] trial ended early by request for account ${accountId}`);
  return { ok: true };
}
