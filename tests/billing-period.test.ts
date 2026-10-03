import { test } from "node:test";
import assert from "node:assert/strict";
import { checkoutSessionVerdict, checkoutActivationPeriod, sessionCollectedMoney, decidePeriodRoll, stripeAnchorFrom, ANCHOR_EPSILON_MS } from "../app/lib/billing-period.ts";

/* activateStripePlan's UPDATE branch never rolled the wallet, so every
 * RETURNING customer inherited the previous period's spend. The fix must roll
 * for them without rolling on an ordinary subscription edit, which lands on the
 * same code path and would otherwise hand back an allowance on demand. */

const DAY = 86_400_000;
const now = new Date("2026-10-03T12:00:00Z");

test("THE BUG: a lapsed merchant resubscribes and must get a fresh period", () => {
  // Burned the 900-token month starting day 30, lapsed day 37, pays again day 40.
  const stored = new Date(now.getTime() - 10 * DAY);
  const d = decidePeriodRoll(stored, { kind: "fresh-payment" }, now);
  assert.equal(d.roll, true);
  assert.ok(d.roll && d.rollTo.getTime() === now.getTime());
  // ...and the write is pinned to what we read, not blindly applied.
  assert.ok(d.roll && d.pinnedTo.getTime() === stored.getTime());
});

test("a plain subscription edit rolls NOTHING — this is the farm the old comment protected", () => {
  const stored = new Date(now.getTime() - 10 * DAY);
  // cancel_at_period_end toggled, card updated, portal plan change: Stripe
  // reports the SAME current_period_start.
  const d = decidePeriodRoll(stored, { kind: "stripe-anchor", startsAt: stored }, now);
  assert.equal(d.roll, false);
  // Repeatable abuse would show up here as a roll; assert it stays false
  // however many times the event is redelivered.
  for (let i = 0; i < 5; i++) {
    assert.equal(decidePeriodRoll(stored, { kind: "stripe-anchor", startsAt: stored }, now).roll, false);
  }
});

test("a renewal rolls, because Stripe's anchor advanced", () => {
  const stored = new Date(now.getTime() - 30 * DAY);
  const anchor = new Date(now.getTime() - 1 * DAY);
  const d = decidePeriodRoll(stored, { kind: "stripe-anchor", startsAt: anchor }, now);
  assert.equal(d.roll, true);
  // The new period starts when STRIPE says it did, not when the webhook landed.
  assert.ok(d.roll && d.rollTo.getTime() === anchor.getTime());
  assert.ok(d.roll && d.pinnedTo.getTime() === stored.getTime());
});

test("a trial converting on Stripe's own schedule rolls — the other half of the same defect", () => {
  // Trial period started 7 days ago; the paid period starts now.
  const stored = new Date(now.getTime() - 7 * DAY);
  const d = decidePeriodRoll(stored, { kind: "stripe-anchor", startsAt: now }, now);
  assert.equal(d.roll, true);
  // Previously only the Studio's own end-trial button did this (endTrialNow),
  // so two merchants paying the same invoice got different allowances.
});

test("an out-of-order delivery for an OLD period never rolls backwards", () => {
  const stored = new Date(now.getTime() - 1 * DAY);
  const stale = new Date(now.getTime() - 40 * DAY);
  assert.equal(decidePeriodRoll(stored, { kind: "stripe-anchor", startsAt: stale }, now).roll, false);
});

test("anchors inside the epsilon are the same period", () => {
  const stored = new Date(now.getTime() - 10 * DAY);
  const jitter = new Date(stored.getTime() + ANCHOR_EPSILON_MS - 1);
  assert.equal(decidePeriodRoll(stored, { kind: "stripe-anchor", startsAt: jitter }, now).roll, false);
  const past = new Date(stored.getTime() + ANCHOR_EPSILON_MS + 1);
  assert.equal(decidePeriodRoll(stored, { kind: "stripe-anchor", startsAt: past }, now).roll, true);
});

test("the conservative default: say nothing about the period and nothing rolls", () => {
  const stored = new Date(now.getTime() - 10 * DAY);
  assert.equal(decidePeriodRoll(stored, { kind: "stripe-anchor", startsAt: null }, now).roll, false);
});

test("no plan row yet — the upsert's create branch owns the period", () => {
  assert.equal(decidePeriodRoll(null, { kind: "fresh-payment" }, now).roll, false);
  assert.equal(decidePeriodRoll(undefined, { kind: "fresh-payment" }, now).roll, false);
});

test("an unreadable stored value cannot be pinned, so it is left alone", () => {
  assert.equal(decidePeriodRoll("not-a-date", { kind: "fresh-payment" }, now).roll, false);
  const stored = new Date(now.getTime() - 10 * DAY);
  assert.equal(decidePeriodRoll(stored, { kind: "stripe-anchor", startsAt: new Date("nope") }, now).roll, false);
});

test("a stored ISO string works as well as a Date — Prisma hands back either", () => {
  const stored = new Date(now.getTime() - 30 * DAY);
  const d = decidePeriodRoll(stored.toISOString(), { kind: "fresh-payment" }, now);
  assert.equal(d.roll, true);
  assert.ok(d.roll && d.pinnedTo.getTime() === stored.getTime());
});

/* THE DOUBLE-CHARGE WINDOW. Stripe redirects back the instant checkout
 * completes, but only the webhook writes plan state — so for a few seconds the
 * dashboard reads "no plan" under a modal saying the plan is live, and a second
 * click bought a second full-price subscription whose invoice nothing refunds.
 * This is the decision made before opening another checkout. */

test("a paid, complete session is fulfilled rather than charged again", () => {
  const v = checkoutSessionVerdict({
    status: "complete", payment_status: "paid", metadata: { accountId: "a1", tierKey: "STUDIO" },
  });
  assert.equal(v.state, "paid");
  assert.ok(v.state === "paid" && v.tierKey === "STUDIO");
});

test("no_payment_required counts as paid — a 100%-off or trial-only session", () => {
  const v = checkoutSessionVerdict({
    status: "complete", payment_status: "no_payment_required", metadata: { tierKey: "STARTER" },
  });
  assert.equal(v.state, "paid");
});

test("an ABANDONED session never blocks a new checkout", () => {
  // The whole reason this is not a timed lockout: someone who closed the Stripe
  // tab must be able to try again immediately.
  const v = checkoutSessionVerdict({ status: "open", payment_status: "unpaid", metadata: { tierKey: "STUDIO" } });
  assert.equal(v.state, "stale");
  assert.equal(checkoutSessionVerdict({ status: "expired", payment_status: "unpaid", metadata: {} }).state, "stale");
});

test("a delayed bank method still settling is left to the async webhook", () => {
  // checkout.session.async_payment_succeeded fulfils these. Granting here on an
  // unpaid session is how a plan gets handed out before money lands.
  const v = checkoutSessionVerdict({ status: "complete", payment_status: "unpaid", metadata: { tierKey: "STUDIO" } });
  assert.equal(v.state, "stale");
  assert.ok(v.state === "stale" && /settling/.test(v.why));
});

test("paid but carrying no tierKey is never fulfilled on a guess", () => {
  const v = checkoutSessionVerdict({ status: "complete", payment_status: "paid", metadata: {} });
  assert.equal(v.state, "stale");
  assert.ok(v.state === "stale" && /no tierKey/.test(v.why));
  assert.equal(checkoutSessionVerdict({ status: "complete", payment_status: "paid" }).state, "stale");
});

test("junk is stale, never paid", () => {
  for (const junk of [null, undefined, "", 0, "complete", [], {}]) {
    assert.equal(checkoutSessionVerdict(junk).state, "stale", JSON.stringify(junk));
  }
});

/* THE TRIAL-SWITCH LEAK. A completed checkout is fresh-payment and rolls the
 * wallet clean — but a trialist switching tiers also completes a checkout, with
 * no charge. Rolling there reset the 400-token trial ceiling, so flipping tiers
 * all week was unlimited free generation. Only a session that took money rolls. */

test("a real paid checkout collected money → fresh-payment → rolls", () => {
  const s = { payment_status: "paid", amount_total: 3900 };
  assert.equal(sessionCollectedMoney(s), true);
  assert.equal(checkoutActivationPeriod(s).kind, "fresh-payment");
});

test("THE LEAK: a $0 trial checkout did NOT collect money → no roll", () => {
  // Stripe completes a trialing subscription checkout with no_payment_required
  // and a zero total.
  for (const s of [
    { payment_status: "no_payment_required", amount_total: 0 },
    { payment_status: "no_payment_required" },
    { payment_status: "paid", amount_total: 0 },
    { payment_status: "paid", amount_total: null },
  ]) {
    assert.equal(sessionCollectedMoney(s), false, JSON.stringify(s));
    const period = checkoutActivationPeriod(s);
    assert.equal(period.kind, "stripe-anchor");
    assert.ok(period.kind === "stripe-anchor" && period.startsAt === null);
  }
});

test("a trial tier-switch preserves the trialist's spend (no roll on a prior plan)", () => {
  // prior plan exists (a switch, not a first signup), $0 trial checkout.
  const stored = new Date("2026-10-01T00:00:00Z");
  const period = checkoutActivationPeriod({ payment_status: "no_payment_required", amount_total: 0 });
  assert.equal(decidePeriodRoll(stored, period).roll, false);
});

test("a first-time trial still starts clean — no prior plan, the create branch owns the period", () => {
  const period = checkoutActivationPeriod({ payment_status: "no_payment_required", amount_total: 0 });
  assert.equal(decidePeriodRoll(null, period).roll, false); // create branch sets tokensUsed:0 itself
});

test("junk sessions never count as a payment", () => {
  for (const j of [null, undefined, "", 0, [], {}, { amount_total: 3900 }]) {
    assert.equal(sessionCollectedMoney(j), false, JSON.stringify(j));
  }
});

/* Stripe moved current_period_start onto subscription items in the 2025 API
 * versions, and this client pins no version — so both shapes must work or the
 * renewal roll silently stops happening. */

test("the anchor is read from the OLD subscription-level shape", () => {
  const sec = Math.floor(new Date("2026-09-03T00:00:00Z").getTime() / 1000);
  const got = stripeAnchorFrom({ id: "sub_1", current_period_start: sec });
  assert.ok(got);
  assert.equal(got.toISOString(), "2026-09-03T00:00:00.000Z");
});

test("the anchor is read from the NEW item-level shape", () => {
  const sec = Math.floor(new Date("2026-09-03T00:00:00Z").getTime() / 1000);
  const got = stripeAnchorFrom({ id: "sub_1", items: { data: [{ current_period_start: sec }] } });
  assert.ok(got);
  assert.equal(got.toISOString(), "2026-09-03T00:00:00.000Z");
});

test("with several items the EARLIEST wins, so no allowance is skipped", () => {
  const a = Math.floor(new Date("2026-09-03T00:00:00Z").getTime() / 1000);
  const b = Math.floor(new Date("2026-09-20T00:00:00Z").getTime() / 1000);
  const got = stripeAnchorFrom({ items: { data: [{ current_period_start: b }, { current_period_start: a }] } });
  assert.ok(got);
  assert.equal(got.toISOString(), "2026-09-03T00:00:00.000Z");
});

test("a subscription with no anchor anywhere yields null, which rolls nothing", () => {
  for (const shape of [null, undefined, {}, { items: {} }, { items: { data: [] } }, { items: { data: [{}] } },
                       { current_period_start: 0 }, { current_period_start: "nope" }, "not-an-object"]) {
    assert.equal(stripeAnchorFrom(shape), null);
  }
  // ...and that null is the conservative branch end to end.
  assert.equal(decidePeriodRoll(new Date(), { kind: "stripe-anchor", startsAt: stripeAnchorFrom({}) }).roll, false);
});

test("every roll carries a pin, so no caller can write unconditionally", () => {
  const stored = new Date(now.getTime() - 30 * DAY);
  const cases = [
    decidePeriodRoll(stored, { kind: "fresh-payment" }, now),
    decidePeriodRoll(stored, { kind: "stripe-anchor", startsAt: now }, now),
  ];
  for (const d of cases) {
    assert.equal(d.roll, true);
    assert.ok(d.roll && d.pinnedTo instanceof Date);
    assert.ok(d.roll && d.rollTo instanceof Date);
  }
});
