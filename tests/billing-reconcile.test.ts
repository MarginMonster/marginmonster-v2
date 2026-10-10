import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/* reconcileBilling scans Stripe for customers billed for 2+ plans at once and
 * alerts the operator. It lives in stripe.server.ts (which imports the DB and
 * much else node --test can't load), so — like no-blind-writes.test.ts — we
 * assert its contract against the SOURCE. The properties that matter:
 *   - it no-ops when Stripe is off (never calls Stripe with no key),
 *   - it flags TWO OR MORE active subscriptions (the double-bill),
 *   - it alerts the operator, and
 *   - it NEVER cancels a subscription itself (picking which paid sub to kill is
 *     a human judgement; an auto-cancel could refund/cut the wrong one). */

const SRC = fs.readFileSync(new URL("../app/lib/stripe.server.ts", import.meta.url), "utf8");

function reconcileBody(): string {
  const at = SRC.indexOf("export async function reconcileBilling");
  assert.notEqual(at, -1, "reconcileBilling was renamed or removed");
  // Up to the next top-level export (its end) — generous, but bounded.
  const next = SRC.indexOf("\nexport ", at + 1);
  return SRC.slice(at, next === -1 ? undefined : next);
}

test("reconcileBilling no-ops when Stripe is off", () => {
  assert.match(reconcileBody(), /if\s*\(\s*!stripeEnabled\(\)\s*\)\s*return/, "must no-op when STRIPE_SECRET_KEY is unset");
});

test("reconcileBilling flags two-or-more active subscriptions", () => {
  const body = reconcileBody();
  assert.match(body, /status=active/, "must query ACTIVE subscriptions only");
  assert.match(body, /subs\.length\s*>=\s*2/, "must flag when a customer has >= 2 active subs");
  assert.match(body, /alertOps/, "must alert the operator on a double-bill");
});

test("reconcileBilling NEVER cancels a subscription itself", () => {
  const body = reconcileBody();
  assert.doesNotMatch(body, /stripeDelete/, "reconcile must not delete/cancel subscriptions — it only reports");
  assert.doesNotMatch(body, /"DELETE"|'DELETE'/, "reconcile must make no DELETE calls to Stripe");
});
