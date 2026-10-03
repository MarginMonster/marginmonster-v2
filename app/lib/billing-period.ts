/* When an activation starts a NEW billing period — the pure half of
 * activateStripePlan's wallet roll.
 *
 * THE BUG THIS EXISTS FOR. activateStripePlan's upsert set periodStart and
 * tokensUsed:0 on its CREATE branch only. Every account that already had a Plan
 * row — i.e. every returning customer, and every trial converting on Stripe's
 * own schedule — went down the UPDATE branch, which set active:true and
 * tokensIncluded but left periodStart and tokensUsed alone. So a merchant who
 * burned a 900-token month, lapsed, and resubscribed three days later paid full
 * price and inherited tokensUsed: 900 against a periodStart still 30+ days from
 * rolling. Their balance was max(0, 900 - 900) = 0, for up to twenty days of a
 * month they had just paid for.
 *
 * WHY THE OBVIOUS FIX IS WRONG, and why this file is a decision rather than a
 * one-line edit. The original comment on that branch is correct: it runs on
 * EVERY customer.subscription.updated, not just on activation. Rolling there
 * unconditionally hands back a full monthly allowance on any subscription edit
 * — toggling cancel-at-period-end, a card update, a portal plan change — which
 * is repeatable by the merchant and costs real COGS.
 *
 * So the question is not "did activateStripePlan run" but "does Stripe say we
 * are in a period we have not yet granted". Stripe answers that directly with
 * the subscription's current_period_start, so that becomes the anchor, and a
 * mid-period edit (same anchor) rolls nothing. A fresh paid checkout is the one
 * case with no anchor to read — the webhook carries a session, not a
 * subscription — but it cannot be farmed either, because reaching it required
 * payment_status "paid" on a brand-new full-price session.
 *
 * The DEFAULT is deliberately the conservative one: a caller that says nothing
 * about the period rolls nothing. */

/** Which billing period an activation belongs to. */
export type ActivationPeriod =
  /** A brand-new paid checkout session. Always a period the merchant just
   *  bought — first subscription, resubscribe after a lapse, or a tier change
   *  (which opens a fresh subscription and cancels the old one). */
  | { kind: "fresh-payment" }
  /** A subscription sync. `startsAt` is Stripe's current_period_start; roll
   *  only when it is genuinely newer than what we granted. */
  | { kind: "stripe-anchor"; startsAt: Date | null };

/** Is a Checkout Session one we should fulfil, or one to discard?
 *
 *  The pure half of resolvePendingCheckout. Asked when a merchant clicks
 *  "subscribe" while an earlier session of theirs is still unresolved, which is
 *  the double-charge window: Stripe redirects back the instant checkout
 *  completes, but only the webhook writes plan state, so the dashboard still
 *  reads "no plan" for a few seconds and a second click bought a second
 *  full-price subscription.
 *
 *  "paid" must be fulfilled rather than re-charged. Everything else — open,
 *  expired, or complete but still settling on a delayed bank method — is
 *  discarded so the merchant can start a fresh checkout immediately. Locking
 *  them out for a fixed window instead would punish anyone who merely abandoned
 *  one, and refusing to sell is worse than the narrow window we are closing.
 *
 *  A delayed method that later settles is fulfilled by
 *  checkout.session.async_payment_succeeded, not here — which is why
 *  complete-but-unpaid is "stale" and not an error. */
export function checkoutSessionVerdict(
  session: unknown,
): { state: "paid"; tierKey: string } | { state: "stale"; why: string } {
  if (!session || typeof session !== "object") return { state: "stale", why: "no session" };
  const s = session as Record<string, unknown>;
  const meta = (s.metadata as Record<string, string> | null) || {};
  const paid = s.payment_status === "paid" || s.payment_status === "no_payment_required";

  if (s.status !== "complete") return { state: "stale", why: `status ${String(s.status)}` };
  if (!paid) return { state: "stale", why: `payment_status ${String(s.payment_status)} — a delayed method still settling` };
  // Paid but unattributable: fulfilling it would mean guessing a tier, and the
  // webhook's own handler refuses the same case loudly rather than guess.
  if (!meta.tierKey) return { state: "stale", why: "paid but carries no tierKey" };
  return { state: "paid", tierKey: meta.tierKey };
}

/** Did this Checkout Session actually collect money?
 *
 *  THE TRIAL-SWITCH LEAK. A completed checkout is normally "fresh-payment",
 *  which rolls the wallet to a clean period — right for a first paid plan or a
 *  resubscribe. But a trialist who SWITCHES tiers also completes a checkout,
 *  and no money moves during a trial. Treating that as fresh-payment rolled
 *  tokensUsed back to 0, so a merchant could reset the 400-token trial ceiling
 *  simply by flipping Starter ⇄ Studio ⇄ Legend, over and over, inside the one
 *  free week — unlimited trial generation, which is real COGS.
 *
 *  A trial checkout completes with payment_status "no_payment_required" and a
 *  zero (or absent) amount_total; a genuine charge is "paid" with a positive
 *  amount. So only a session that actually took money is fresh-payment. A
 *  brand-new trial still starts clean because it has no prior plan row to roll
 *  (the create branch owns its period); a trial tier-switch now carries its
 *  existing spend; and the real conversion rolls later via subscription.updated
 *  when Stripe's period anchor advances. */
export function sessionCollectedMoney(session: unknown): boolean {
  if (!session || typeof session !== "object") return false;
  const s = session as Record<string, unknown>;
  if (s.payment_status !== "paid") return false;
  const total = typeof s.amount_total === "number" ? s.amount_total : Number(s.amount_total ?? 0);
  return Number.isFinite(total) && total > 0;
}

/** The ActivationPeriod a completed checkout session implies: a real payment
 *  opens a fresh period; a $0 trial checkout rolls nothing. */
export function checkoutActivationPeriod(session: unknown): ActivationPeriod {
  return sessionCollectedMoney(session) ? { kind: "fresh-payment" } : { kind: "stripe-anchor", startsAt: null };
}

/** Read Stripe's current_period_start off a subscription object, in seconds,
 *  from EITHER place it lives.
 *
 *  Stripe moved current_period_start / current_period_end off the subscription
 *  and onto its items in the 2025 API versions. This client pins no version
 *  (see the fetch helper in stripe.server.ts), so it gets whatever the account
 *  default is, and that can change under us without a deploy. Reading both
 *  shapes costs nothing; guessing one and being wrong silently disables the
 *  renewal roll, which is the defect this whole file exists to fix.
 *
 *  Returns null when neither is present — which `decidePeriodRoll` treats as
 *  "no anchor, roll nothing", the safe direction. */
export function stripeAnchorFrom(sub: unknown): Date | null {
  if (!sub || typeof sub !== "object") return null;
  const o = sub as Record<string, unknown>;

  const fromSub = o.current_period_start;
  if (typeof fromSub === "number" && Number.isFinite(fromSub) && fromSub > 0) return new Date(fromSub * 1000);

  // 2025+ shape: subscription.items.data[].current_period_start. A subscription
  // here always has exactly one item (one tier price), but take the EARLIEST if
  // several ever appear — the period the merchant is in started at the first of
  // them, and rolling from the latest would skip an allowance.
  const items = o.items as Record<string, unknown> | undefined;
  const data = items && Array.isArray(items.data) ? (items.data as unknown[]) : null;
  if (!data) return null;
  const secs = data
    .map((it) => (it && typeof it === "object" ? (it as Record<string, unknown>).current_period_start : null))
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0);
  if (!secs.length) return null;
  return new Date(Math.min(...secs) * 1000);
}

/** Anchors within this of each other are the SAME period. Stripe's timestamps
 *  are whole seconds and our stored value is whatever we wrote, so an exact
 *  compare would roll on sub-second skew. A minute is far below any real
 *  billing period and far above any clock noise. */
export const ANCHOR_EPSILON_MS = 60_000;

/** The roll decision.
 *
 *  `rollTo` is the periodStart to write. `pinnedTo` is the value the write must
 *  be CONDITIONAL on — the caller pins its updateMany `where` to it, so a
 *  concurrent refreshPeriod (or a Stripe webhook retry) matches zero rows and
 *  re-reads instead of granting a second allowance. */
export type PeriodRoll =
  | { roll: false; reason: string }
  | { roll: true; rollTo: Date; pinnedTo: Date; reason: string };

/** Decide whether this activation opens a new billing period.
 *
 *  @param storedPeriodStart the Plan row's current periodStart, or null when
 *         there is no Plan row yet (the create branch writes its own).
 *  @param period           what the caller knows about Stripe's period.
 *  @param now              injected for tests. */
export function decidePeriodRoll(
  storedPeriodStart: Date | string | null | undefined,
  period: ActivationPeriod,
  now: Date = new Date(),
): PeriodRoll {
  // No existing row: the upsert's create branch sets the period itself.
  if (storedPeriodStart == null) return { roll: false, reason: "no existing plan row — create branch owns the period" };

  const stored = new Date(storedPeriodStart);
  if (Number.isNaN(stored.getTime())) {
    // An unreadable stored value cannot be pinned, so it cannot be rolled
    // safely. Leave it; refreshPeriod's own guard will treat it the same way.
    return { roll: false, reason: "stored periodStart is not a date" };
  }

  if (period.kind === "fresh-payment") {
    return { roll: true, rollTo: now, pinnedTo: stored, reason: "fresh paid checkout — the merchant bought this period" };
  }

  if (!period.startsAt) return { roll: false, reason: "no Stripe anchor on this event — nothing to compare" };
  const anchor = new Date(period.startsAt);
  if (Number.isNaN(anchor.getTime())) return { roll: false, reason: "Stripe anchor is not a date" };

  // Strictly newer, past the epsilon. Equal (a plain edit) or older (an
  // out-of-order delivery for a period we already moved past) rolls nothing.
  if (anchor.getTime() > stored.getTime() + ANCHOR_EPSILON_MS) {
    return { roll: true, rollTo: anchor, pinnedTo: stored, reason: "Stripe's current_period_start advanced" };
  }
  return { roll: false, reason: "same billing period — a subscription edit, not a renewal" };
}
