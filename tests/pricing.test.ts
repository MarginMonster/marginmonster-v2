/* The price a merchant is SHOWN and the price Shopify CHARGES drifted apart:
 * the plans page rendered $39 and $69 while BILLING_PLANS charged $59 and $99,
 * under a comment saying the two "must match". Merchants were billed 51% more
 * than the number they approved.
 *
 * shopify.server.ts cannot be imported here — it pulls in the Shopify SDK and
 * the database — so this reads the source and asserts the amounts are DERIVED
 * rather than restated. That is the property that makes the drift impossible,
 * and it is exactly what regressed. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLAN_BY_KEY, PLAN_TIERS, TOKEN_COST, TOKEN_ACTION_LABEL, annualPrice } from "../app/lib/plan-config.ts";

const src = readFileSync(new URL("../app/shopify.server.ts", import.meta.url), "utf8");
const TIERS = ["STARTER", "STUDIO", "ANTHEM"] as const;

test("Shopify's monthly amounts are derived from plan-config, never typed out", () => {
  for (const key of TIERS) {
    const line = src.split("\n").find((l) => l.trim().startsWith(`${key}: {`));
    assert.ok(line, `no BILLING_PLANS entry for ${key}`);
    assert.match(line!, /amount: tierPrice\(/, `${key} must derive its amount from PLAN_TIERS`);
    assert.doesNotMatch(line!, /amount:\s*\d/, `${key} has a hardcoded amount — this is the drift that overcharged merchants`);
  }
});

test("Shopify's annual amounts are derived too", () => {
  for (const key of TIERS) {
    const line = src.split("\n").find((l) => l.trim().startsWith(`${key}_ANNUAL: {`));
    assert.ok(line, `no annual entry for ${key}`);
    assert.match(line!, /amount: annualPrice\(/, `${key}_ANNUAL must derive its amount`);
    assert.doesNotMatch(line!, /amount:\s*\d/, `${key}_ANNUAL has a hardcoded amount`);
  }
});

test("annual is ten months, so a year costs less than twelve months", () => {
  for (const tier of PLAN_TIERS) {
    assert.equal(annualPrice(tier), tier.price * 10);
    assert.ok(annualPrice(tier) < tier.price * 12, `${tier.key} annual is not a saving`);
  }
});

test("every tier has a price and a token allowance", () => {
  for (const key of TIERS) {
    const tier = PLAN_BY_KEY[key];
    assert.ok(tier, `${key} missing from PLAN_BY_KEY`);
    assert.ok(tier.price > 0, `${key} has no price`);
    assert.ok(tier.monthlyTokens > 0, `${key} grants no tokens`);
  }
});

test("the tier ladder climbs — a dearer plan never grants fewer tokens", () => {
  const ladder = TIERS.map((k) => PLAN_BY_KEY[k]);
  for (let i = 1; i < ladder.length; i++) {
    assert.ok(ladder[i].price > ladder[i - 1].price, `${ladder[i].key} is not dearer than ${ladder[i - 1].key}`);
    assert.ok(ladder[i].monthlyTokens >= ladder[i - 1].monthlyTokens, `${ladder[i].key} grants fewer tokens than a cheaper tier`);
  }
});

test("every charged action has a cost and a human label", () => {
  for (const [action, cost] of Object.entries(TOKEN_COST)) {
    assert.ok(cost > 0, `${action} costs nothing — it would be free to run`);
    assert.ok(TOKEN_ACTION_LABEL[action as keyof typeof TOKEN_COST], `${action} has no label to show the merchant`);
  }
});

test("a video costs more than an image, which costs more than a description", () => {
  // Guards against an edit that silently makes the most expensive thing cheap.
  assert.ok(TOKEN_COST.video > TOKEN_COST.image);
  assert.ok(TOKEN_COST.image > TOKEN_COST.description);
});
