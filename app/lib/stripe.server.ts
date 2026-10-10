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
import { checkoutSessionVerdict, decidePeriodRoll, type ActivationPeriod } from "./billing-period";
import { PLAN_BY_KEY, TOKEN_PACKS, CREATOR_PRICE, annualPrice, type PlanKey } from "./plan-config";

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
// async_payment_succeeded is what fulfils a delayed method (ACH, SEPA, Bacs):
// those complete the session unpaid and settle later, so without it a bank
// transfer would pay and never be granted anything.
const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];
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
  /** Bolt the $6.99 Creator add-on onto this (marketing) plan — a second
   *  subscription line item + a creator flag on the subscription metadata. */
  withCreator?: boolean;
}): Promise<string> {
  const tier = PLAN_BY_KEY[opts.tierKey];
  // Round to integer cents: a fractional price (Creator $6.99 → $69.90 annual →
  // 6990.000000000001 in IEEE-754) would be sent as a non-integer unit_amount
  // and Stripe 400s the whole checkout.
  const amount = Math.round((opts.annual ? annualPrice(tier) : tier.price) * 100);
  // The add-on rides the same subscription (same interval), so a flag on the
  // subscription metadata persists across renewals — every subscription.* event
  // re-reads it, so it is never clobbered. Not added onto the CREATOR tier
  // itself (that IS the Creator plan).
  const withCreator = !!opts.withCreator && opts.tierKey !== "CREATOR";
  const creatorAmount = Math.round((opts.annual ? CREATOR_PRICE * 10 : CREATOR_PRICE) * 100);

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
    // PIN THE TRIAL CARD GATE. 'always' is Stripe's current subscription-mode
    // default, but default is not the same as pinned: Stripe collects no card
    // when the amount due today is 0, which is EXACTLY the trial case — the
    // trial_period_days / trial_end params above make today's total $0. If this
    // were ever flipped to 'if_required' (or Stripe changed its default), the
    // 400-token free trial would go cardless and the whole trial-abuse story
    // this file guards against reopens. State it explicitly so no future tweak
    // can silently make the trial cardless. Valid only in subscription mode.
    payment_method_collection: "always",
    // Reuse the account's Stripe customer when we have one. A new customer per
    // checkout scattered one merchant's subscriptions across several records
    // and hid the duplicate from Stripe's own trial handling.
    ...(opts.customerId ? { customer: opts.customerId } : { customer_email: opts.email }),
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(amount),
    "line_items[0][price_data][recurring][interval]": opts.annual ? "year" : "month",
    "line_items[0][price_data][product_data][name]": `EasyMode ${tier.name} plan${opts.annual ? " (annual)" : ""}`,
    // Say what the TIER actually makes. Starter is videoQuota 0 — it cannot
    // make videos — so a fixed "AI videos, image ads, articles & auto-posting"
    // string promised video on the Stripe checkout page for a plan that does
    // not include it. Lead with video only when the tier has it.
    "line_items[0][price_data][product_data][description]": `${tier.monthlyTokens.toLocaleString()} tokens every month — ${tier.videoQuota > 0 ? "AI videos, image ads, articles & auto-posting" : "image ads, SEO articles, ad copy & auto-posting"} for your store.`,
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
    // The Creator add-on: a second recurring line item (same interval) + a
    // `creator` flag on the subscription metadata so every renewal re-grants it.
    ...(withCreator ? {
      "line_items[1][quantity]": "1",
      "line_items[1][price_data][currency]": "usd",
      "line_items[1][price_data][unit_amount]": String(creatorAmount),
      "line_items[1][price_data][recurring][interval]": opts.annual ? "year" : "month",
      "line_items[1][price_data][product_data][name]": `EasyMode Creator add-on${opts.annual ? " (annual)" : ""}`,
      "line_items[1][price_data][product_data][description]": "The Creator section — edit & restyle your own photos, ~100 a month.",
      "subscription_data[metadata][creator]": "1",
      "metadata[creator]": "1",
    } : {}),
    success_url: `${opts.baseUrl}/web?welcome=${opts.tierKey}`,
    cancel_url: `${opts.baseUrl}/web`,
  });
  // Record the session BEFORE the merchant leaves for Stripe. Nothing else
  // marks a purchase as in flight until the webhook lands, which is what made
  // the return-leg a double-charge window — see pendingCheckoutId on Account
  // and resolvePendingCheckout below. Non-fatal: failing to record it must not
  // cost the merchant a checkout they are trying to start.
  await db.account
    .update({
      where: { id: opts.accountId },
      data: { pendingCheckoutId: (session.id as string) || null, pendingCheckoutAt: new Date() },
    })
    .catch((e) => console.error("[stripe] could not record the pending checkout (non-fatal):", e));
  return session.url as string;
}

/** Add or remove the $6.99 Creator add-on on an EXISTING subscription, in place.
 *
 *  This is the correct alternative to re-running createPlanCheckout for an
 *  add-on toggle: a fresh checkout opens a NEW full-price subscription and then
 *  cancels the incumbent with no refund, so the merchant re-pays the whole plan
 *  and forfeits the month they'd already bought. Instead we modify the live
 *  subscription — keeping the plan item EXPLICITLY by id (so this can never drop
 *  it) and adding/removing only the Creator item — and let Stripe prorate.
 *
 *  It does not write plan.creatorAddon itself: the subscription.updated webhook
 *  this edit triggers re-reads metadata.creator and flips the flag there, the
 *  single source of truth. */
export async function setSubscriptionCreatorAddon(opts: {
  subId: string;
  on: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sub = (await stripeReq("GET", `/subscriptions/${encodeURIComponent(opts.subId)}`)) as {
      items?: { data?: Array<{ id?: string; price?: { unit_amount?: number; recurring?: { interval?: string } } }> };
    };
    const items = (sub.items?.data || []).filter((it) => !!it.id);
    if (items.length === 0) return { ok: false, error: "Couldn't read your subscription — manage it from the dashboard." };
    // Every item in one subscription shares the interval — match the add-on to it.
    const interval = items[0].price?.recurring?.interval === "year" ? "year" : "month";
    const creatorAmount = Math.round((interval === "year" ? CREATOR_PRICE * 10 : CREATOR_PRICE) * 100);
    const creatorItem = items.find((it) => it.price?.unit_amount === creatorAmount);
    // The plan item(s) — everything that isn't the Creator add-on. Always passed
    // back by id, unchanged, so a merge quirk can never remove the plan.
    const planItems = items.filter((it) => it !== creatorItem);
    if (planItems.length === 0) return { ok: false, error: "Couldn't read your plan — manage it from the dashboard." };

    const body: Record<string, string> = { proration_behavior: "create_prorations" };
    planItems.forEach((it, i) => { body[`items[${i}][id]`] = it.id!; });
    const n = planItems.length;

    if (opts.on) {
      if (creatorItem) return { ok: true }; // already has it
      // The subscription-UPDATE items param accepts a price ID or price_data
      // WITH an existing `product` id — it rejects inline `product_data` (that
      // only works on Checkout line_items and the /prices endpoint, which is
      // why createPlanCheckout can use it but this can't). So mint the add-on
      // price first (product created inline there) and attach it by id.
      const price = (await stripePost("/prices", {
        currency: "usd",
        unit_amount: String(creatorAmount),
        "recurring[interval]": interval,
        "product_data[name]": `EasyMode Creator add-on${interval === "year" ? " (annual)" : ""}`,
      })) as { id?: string };
      if (!price.id) return { ok: false, error: "Couldn't set up the add-on price — try again in a moment." };
      body[`items[${n}][price]`] = price.id;
      body["metadata[creator]"] = "1";
    } else {
      if (!creatorItem?.id) { body["metadata[creator]"] = ""; }
      else {
        body[`items[${n}][id]`] = creatorItem.id;
        body[`items[${n}][deleted]`] = "true";
        body["metadata[creator]"] = "";
      }
    }
    await stripePost(`/subscriptions/${encodeURIComponent(opts.subId)}`, body);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[stripe] setSubscriptionCreatorAddon failed:", msg);
    // Surface the real Stripe reason (it's the merchant's own subscription) so
    // a failure is actionable instead of a dead "try again" loop.
    return { ok: false, error: `Couldn't update your Creator add-on: ${msg.slice(0, 180)}` };
  }
}

/** Has the checkout this account last opened already been paid for?
 *
 *  The duplicate-subscription guard on the dashboard can only read state the
 *  WEBHOOK writes, so for the first seconds after Stripe redirects back it
 *  still reports "no plan" — and a merchant who re-reads that screen and clicks
 *  again buys a second full-price subscription. The superseded one is then
 *  cancelled, but Stripe has already raised its invoice and nothing refunds it.
 *
 *  So before opening another checkout, ask Stripe about the one in flight. This
 *  deliberately does NOT lock the merchant out for a fixed window: someone who
 *  simply abandoned a checkout must be able to start another immediately, so an
 *  unpaid or expired session is cleared and reported as stale.
 *
 *  It also repairs a webhook that never arrives at all: a completed, paid
 *  session activates the plan here, on the merchant's own next click. */
export async function resolvePendingCheckout(
  accountId: string,
): Promise<{ state: "none" | "stale" | "paid"; tierKey?: string }> {
  if (!stripeEnabled()) return { state: "none" };
  const acct = await db.account
    .findUnique({ where: { id: accountId }, select: { pendingCheckoutId: true } })
    .catch(() => null);
  const id = acct?.pendingCheckoutId;
  if (!id) return { state: "none" };

  const clear = () =>
    db.account
      .updateMany({ where: { id: accountId, pendingCheckoutId: id }, data: { pendingCheckoutId: null, pendingCheckoutAt: null } })
      .catch(() => { /* non-fatal */ });

  let session: Record<string, unknown>;
  try {
    session = await stripeReq("GET", `/checkout/sessions/${encodeURIComponent(id)}`);
  } catch (e) {
    // A session Stripe will not tell us about (deleted, wrong mode, a key
    // rotation) must not wedge the merchant out of subscribing. Treat it as
    // stale and let them proceed — the worst case is the window we already had.
    console.error(`[stripe] could not read pending session ${id} — treating as stale:`, e instanceof Error ? e.message : e);
    await clear();
    return { state: "stale" };
  }

  const verdict = checkoutSessionVerdict(session);
  if (verdict.state === "paid") {
    console.log(`[stripe] account ${accountId}: pending session ${id} is already paid — activating here instead of charging again`);
    // Idempotent: activateStripePlan upserts the plan and the period roll is a
    // conditional write, so this and a late webhook cannot both grant.
    await activateStripePlan(accountId, verdict.tierKey, (session.subscription as string) || null, (session.customer as string) || null, false, {
      kind: "fresh-payment",
    }, ((session.metadata as Record<string, string> | undefined)?.creator) === "1");
    await clear();
    return { state: "paid", tierKey: verdict.tierKey };
  }

  console.log(`[stripe] account ${accountId}: pending session ${id} discarded — ${verdict.why}`);
  await clear();
  return { state: "stale" };
}

/** PROACTIVE billing reconciliation. The at-the-moment alerts in
 *  activate/deactivateStripePlan catch a double-charge WHEN a tier change
 *  happens, but can't see one that already happened — e.g. a past tier change
 *  whose superseded-sub cancel failed before alerting existed, or a charge a
 *  missed webhook left behind. This scans every account that has a Stripe
 *  customer and asks Stripe directly how many ACTIVE subscriptions it has; two
 *  or more means the customer is being billed for multiple plans at once, which
 *  we alert on (once per account per throttle window) so it's cancelled by hand.
 *
 *  Read-only against Stripe — it NEVER cancels anything itself. Choosing which
 *  of two paid subscriptions to kill (proration, which plan they actually meant)
 *  is a judgement a human must make; an automated cancel could refund the wrong
 *  one or cut off the plan they want. Safe to run on a timer; no-ops when Stripe
 *  is off. */
export async function reconcileBilling(opts?: { limit?: number }): Promise<{ scanned: number; doubleBilled: number; errors: number }> {
  if (!stripeEnabled()) return { scanned: 0, doubleBilled: 0, errors: 0 };
  const accounts = await db.account.findMany({
    where: { stripeCustomerId: { not: null } },
    select: { id: true, email: true, stripeCustomerId: true, stripeSubId: true },
    take: opts?.limit ?? 1000,
  });
  let doubleBilled = 0;
  let errors = 0;
  for (const a of accounts) {
    try {
      const res = await stripeReq(
        "GET",
        `/subscriptions?customer=${encodeURIComponent(a.stripeCustomerId!)}&status=active&limit=100`
      );
      const subs = (Array.isArray(res.data) ? res.data : []) as Array<{ id: string }>;
      if (subs.length >= 2) {
        doubleBilled++;
        const ids = subs.map((s) => s.id).join(", ");
        console.warn(`[reconcile] account ${a.id} (${a.email || "?"}) has ${subs.length} active subs: ${ids}`);
        const { alertOps } = await import("./ops-alert.server");
        await alertOps(
          `double-bill-reconcile:${a.id}`,
          `Double charge — ${a.email || a.id} has ${subs.length} active subscriptions`,
          [
            `Account ${a.id} (${a.email || "no email on file"}) has ${subs.length} ACTIVE Stripe subscriptions: ${ids}.`,
            `We track only ${a.stripeSubId || "none"} as the live one — the extra(s) are billing this customer for a plan they shouldn't have.`,
            `Cancel the superfluous subscription(s) in the Stripe dashboard (keep the one they meant to be on). This scan never cancels anything automatically.`,
          ]
        );
      }
      // Gentle on the Stripe API — this is the same box that serves merchants.
      await new Promise((r) => setTimeout(r, 120));
    } catch (e) {
      errors++;
      console.error(`[reconcile] ${a.id}: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    }
  }
  console.log(`[reconcile] scanned ${accounts.length} Stripe customers — ${doubleBilled} double-billed, ${errors} errors`);
  return { scanned: accounts.length, doubleBilled, errors };
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
    // "any generator your plan includes" — tokens meter HOW MUCH you make, the
    // plan gates WHICH generators, and the app enforces exactly that. The bare
    // "any generator" promised video to a Starter buyer topping up.
    "line_items[0][price_data][product_data][description]": "Tokens land in your balance instantly — spend them on any generator your plan includes.",
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
/** @param cancelAtPeriodEnd  What STRIPE currently says about renewal. Only
 *  the subscription.updated path has an opinion here; a fresh checkout never
 *  does, so it keeps the default. */
export async function activateStripePlan(
  accountId: string,
  tierKey: string,
  subId: string | null,
  customerId: string | null,
  cancelAtPeriodEnd = false,
  /** Which billing period this activation belongs to. Defaults to the
   *  conservative case — an unknown anchor rolls nothing. See billing-period.ts
   *  for why this is a decision and not a one-line reset. */
  period: ActivationPeriod = { kind: "stripe-anchor", startsAt: null },
  /** The $6.99 Creator add-on, read from the subscription metadata on EVERY
   *  event — so a renewal re-grants it rather than clobbering it to false. */
  creatorAddon = false,
): Promise<void> {
  const tier = PLAN_BY_KEY[tierKey as PlanKey];
  if (!tier) return;
  const shopId = await webShopIdFor(accountId);
  if (!shopId) return;
  // Read the period we last granted BEFORE the upsert touches the row, so the
  // roll below can be pinned to it. trialEndsAt distinguishes a trial
  // CONVERSION (must roll, to clear the trial's spend) from an ordinary renewal
  // (defers to refreshPeriod) — a conversion is an advance whose prior plan was
  // still in, or has only just left, its trial window.
  const priorPlan = await db.plan
    .findUnique({ where: { shopId }, select: { periodStart: true, trialEndsAt: true } })
    .catch(() => null);
  const trialEndsMs = priorPlan?.trialEndsAt ? new Date(priorPlan.trialEndsAt).getTime() : null;
  // "Was trialing" = the trial is in the future or ended within the last couple
  // of days (the conversion event can arrive a touch after trial_end). An
  // ordinary renewal months later has a trialEndsAt long past, so this is false.
  const wasTrialing = trialEndsMs != null && trialEndsMs > Date.now() - 2 * 24 * 60 * 60 * 1000;
  const rollDecision = decidePeriodRoll(priorPlan?.periodStart ?? null, period, new Date(), { wasTrialing });
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
      // NOTE: pendingCheckoutId is deliberately NOT cleared here. This runs for
      // ordinary subscription.updated events too (a renewal, a cancel toggle),
      // and clearing on those would drop the guard on a DIFFERENT checkout the
      // merchant has open right now — re-opening the very double-charge window
      // this field closes. The pending marker is cleared by the two things that
      // actually resolve a checkout: resolvePendingCheckout (reads the session)
      // and the webhook's checkout.session.completed handler (clears the exact
      // session id it just fulfilled).
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
      const reason = e instanceof Error ? e.message : String(e);
      console.error(
        `[stripe] account ${accountId}: FAILED to cancel superseded subscription ${prior.stripeSubId} — ` +
        `this account is now billed for TWO plans until it is cancelled by hand: ` + reason
      );
      // This is a live DOUBLE CHARGE — email the operator so it's fixed by hand
      // before the next cycle, not discovered when the customer disputes it.
      const { alertOps } = await import("./ops-alert.server");
      await alertOps(
        `double-bill:${accountId}`,
        `Double charge — account ${accountId} billed for two plans`,
        [
          `Account ${accountId}'s old subscription ${prior.stripeSubId} FAILED to cancel after it moved to a new plan.`,
          `Until you cancel ${prior.stripeSubId} by hand in Stripe, this account is charged for BOTH plans every cycle.`,
          `Stripe said: ${reason}`,
        ]
      );
    }
  }
  await db.plan.upsert({
    where: { shopId },
    create: {
      shopId, type: tier.key, reviewMode: "REVIEW_FIRST",
      blogQuota: tier.blogQuota, videoQuota: tier.videoQuota, imageQuota: tier.imageQuota,
      adCreativePack: tier.imageQuota > 0, campaignAutopilot: tier.campaignAutopilot,
      creatorAddon,
      periodStart: new Date(), tokensIncluded: tier.monthlyTokens, tokensUsed: 0,
      cancelAtPeriodEnd: false,
      trialEndsAt: new Date(Date.now() + 7 * 86_400_000),
    },
    update: {
      type: tier.key, active: true, creatorAddon,
      // A new activation is not a cancelled one — otherwise a merchant who
      // cancelled and then subscribed again would still be told their plan
      // will not renew. But this was HARDCODED false, and every
      // subscription.updated event routes through here: cancelling set
      // cancel_at_period_end at Stripe, Stripe immediately emitted an
      // updated event with status still "active", and this line wiped the
      // local mirror seconds later. The dashboard then showed "Cancel plan"
      // again with no "won't renew" notice — and, worse, no "Keep my plan",
      // which is the only undo in the app and renders only inside that
      // branch. A merchant who cancelled by accident had no way back, while
      // being told the plan still renews. It does not; Stripe still holds
      // the cancellation.
      cancelAtPeriodEnd,
      blogQuota: tier.blogQuota, videoQuota: tier.videoQuota, imageQuota: tier.imageQuota,
      adCreativePack: tier.imageQuota > 0, campaignAutopilot: tier.campaignAutopilot,
      tokensIncluded: tier.monthlyTokens,
      // trialEndsAt is deliberately NOT rewritten here. It belongs to the
      // account's one trial, createPlanCheckout carries the same date onto
      // any later subscription, and moving it forward on a plan edit is
      // exactly how the trial ceiling used to come unstuck.
      // STILL NOT tokensUsed:0 / periodStart:now HERE. This runs on every
      // customer.subscription.updated, not just on first activation, so
      // resetting unconditionally handed back a full monthly allowance on any
      // subscription edit — repeatable, and real COGS. The roll is done below
      // instead, as a CONDITIONAL write, and only when the period actually
      // changed; see billing-period.ts.
    },
  });
  // THE RETURNING CUSTOMER'S WALLET.
  //
  // Everything above is the same for a first subscription and a resubscribe,
  // and that was the bug: only the create branch ever set periodStart /
  // tokensUsed, so a merchant who spent a month, lapsed and paid again
  // inherited the old period's spend and could start a month they had just
  // bought with a zero balance. The same gap made a trial converting on
  // Stripe's schedule worth less than clicking the Studio's own end-trial
  // button, which has always rolled the period (endTrialNow, below).
  //
  // Conditional on the value we read: pinning `periodStart` means a concurrent
  // refreshPeriod, or Stripe redelivering this webhook, matches zero rows and
  // re-reads rather than granting a second allowance. That is the house rule
  // from tests/no-blind-writes.test.ts.
  if (rollDecision.roll) {
    const rolled = await db.plan.updateMany({
      where: { shopId, periodStart: rollDecision.pinnedTo },
      data: {
        periodStart: rollDecision.rollTo,
        tokensUsed: 0,
        tokensIncluded: tier.monthlyTokens,
        blogUsed: 0,
        videoUsed: 0,
      },
    });
    if (rolled.count) {
      console.log(`[stripe] account ${accountId}: new billing period (${rollDecision.reason}) — wallet rolled to ${tier.monthlyTokens} tokens`);
    } else {
      // Not an error: something else rolled it first, which is the outcome we
      // wanted anyway. Logged because a persistent miss would mean the pin is
      // wrong rather than contended.
      console.log(`[stripe] account ${accountId}: period roll skipped — the row moved under us (${rollDecision.reason})`);
    }
  }
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
      // Deliberately keep the plan ON (never cut off a payer on a sub-id
      // mismatch) — but if the mismatch is wrong, this is a churned account
      // still getting the product free, so flag it for a human to check.
      const { alertOps } = await import("./ops-alert.server");
      await alertOps(
        `churn-mismatch:${accountId}`,
        `Churn sub-id mismatch — account ${accountId} plan kept active`,
        [
          `A cancellation came in for subscription ${subId}, but account ${accountId}'s live subscription is ${account.stripeSubId}.`,
          `The plan was LEFT ACTIVE (we never cut off a payer on a mismatch). If the cancellation was genuine, this account now has the product for free — check it in Stripe.`,
        ]
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
/** Cancel at the end of the paid period, or undo that.
 *
 * The Stripe checkout page tells the merchant "cancel anytime", and the terms
 * say "cancel any time and everything you generated stays yours" — and there
 * was no way to do it anywhere in the web app. Not a hidden one: none. The
 * only exits were emailing support or a chargeback, which is the outcome the
 * checkout copy exists to avoid. The single billing lever the app did expose,
 * endTrialNow below, runs the other way and starts charging sooner.
 *
 * cancel_at_period_end, NOT a delete. Deleting the subscription would end it
 * immediately and confiscate the remainder of a month the merchant has
 * already paid for. They keep everything until the period they bought runs
 * out, then Stripe's customer.subscription.deleted arrives and
 * deactivateStripePlan switches the plan off — which is why this must target
 * account.stripeSubId specifically: that function deliberately ignores a
 * cancellation for any subscription that is not the live one. */
export async function setPlanCancellation(
  accountId: string,
  cancel: boolean
): Promise<{ ok: boolean; error?: string }> {
  if (!stripeEnabled()) return { ok: false, error: "Billing isn't configured on this server yet." };
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account?.stripeSubId) return { ok: false, error: "No live subscription on this account." };
  const shopId = await webShopIdFor(accountId);
  if (!shopId) return { ok: false, error: "This account isn't linked to a workspace yet." };

  try {
    await stripePost(`/subscriptions/${account.stripeSubId}`, {
      cancel_at_period_end: cancel ? "true" : "false",
    });
  } catch (e) {
    console.error("[stripe] cancel toggle failed:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Stripe wouldn't accept that just now." };
  }

  // Local mirror so the dashboard can say what is happening on the next load.
  // Non-fatal: Stripe is the source of truth and its webhook still decides
  // when the plan actually switches off.
  await db.plan
    .updateMany({ where: { shopId }, data: { cancelAtPeriodEnd: cancel } })
    .catch((e) => console.error("[stripe] cancel mirror failed (non-fatal):", e));
  return { ok: true };
}

export async function endTrialNow(accountId: string): Promise<{ ok: boolean; error?: string }> {
  if (!stripeEnabled()) return { ok: false, error: "Billing isn't configured on this server yet." };
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account?.stripeSubId) {
    return { ok: false, error: "No live subscription on this account — pick a plan first." };
  }
  const conn = await db.connection.findFirst({ where: { accountId, kind: "web" } });
  if (!conn) return { ok: false, error: "This account isn't linked to a workspace yet." };

  // THERE HAS TO BE A TRIAL TO END, AND ONLY ONE CALLER MAY END IT.
  //
  // This checked for a stripeSubId and a web connection and nothing else,
  // then wrote periodStart: new Date() and tokensUsed: 0. On an account with
  // no trial that is a free wallet reset — repeatable, from a public intent,
  // by anyone logged in. It also restarted the billing period out from under
  // Stripe, so the merchant's month and ours drifted apart.
  //
  // The claim is a compare-and-swap on the date we just read, not a check
  // followed by a write: two clicks in the same second both pass a check.
  // Clearing trialEndsAt IS the claim, and it is put back if Stripe refuses,
  // so a declined card does not cost the merchant the rest of their trial.
  const { planTrialing } = await import("./tokens.server");
  const plan = await db.plan.findUnique({ where: { shopId: conn.externalId } });
  if (!planTrialing(plan)) return { ok: false, error: "You're not on a trial — your plan is already running." };
  const trialWas = plan!.trialEndsAt;
  const claimed = await db.plan.updateMany({
    where: { shopId: conn.externalId, trialEndsAt: trialWas },
    data: { trialEndsAt: null },
  });
  if (claimed.count !== 1) return { ok: false, error: "That's already done — refresh the page." };

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
    // Give the trial back — the claim above took it, and Stripe said no.
    await db.plan.updateMany({
      where: { shopId: conn.externalId, trialEndsAt: null },
      data: { trialEndsAt: trialWas },
    }).catch((err) => console.error("[stripe] could not restore the trial after a failed end-trial:", err));
    // Card declines are the common case and the merchant can act on them.
    return {
      ok: false,
      error: /card|declin|payment|insufficient/i.test(msg)
        ? "Your card was declined — update it and try again."
        : "Couldn't start the plan just now. Try again in a moment.",
    };
  }

  // trialEndsAt is already null — that was the claim.
  await db.plan.updateMany({
    where: { shopId: conn.externalId },
    data: { periodStart: new Date(), tokensUsed: 0, active: true },
  });
  console.log(`[stripe] trial ended early by request for account ${accountId}`);
  return { ok: true };
}
