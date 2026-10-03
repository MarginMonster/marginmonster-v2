import { test } from "node:test";
import assert from "node:assert/strict";
import { decidePeriodRoll, stripeAnchorFrom, ANCHOR_EPSILON_MS } from "../app/lib/billing-period.ts";

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
