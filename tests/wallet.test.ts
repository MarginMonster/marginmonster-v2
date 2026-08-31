/* The wallet's safety properties, asserted against the source.
 *
 * tokens.server.ts pulls in the database, so it cannot be imported here. These
 * are structural assertions instead — and structure is the right level, because
 * every wallet defect this file has had was a shape problem, not an arithmetic
 * one: a read, then a decision, then a write that assumed nothing had moved.
 *
 * Three have shipped and been fixed:
 *   1. spendTokens read-then-write — two spends both passed the affordability
 *      check and one wallet paid for two renders.
 *   2. refreshPeriod's blind `tokensUsed: 0` at the period boundary — the second
 *      caller's reset erased the first caller's committed spend.
 *   3. refundTokens' unconditional decrement — two concurrent refunds both
 *      clamped against the same stale value, drove tokensUsed negative, and a
 *      negative there MINTS tokens because allowance is included - used.
 *
 * Each test below is the property that, had it held, would have prevented one
 * of those. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app/lib/tokens.server.ts", import.meta.url), "utf8");

/** The body of a top-level exported or plain function, by name. */
function fnBody(name: string): string {
  const start = src.search(new RegExp(`(export )?(async )?function ${name}\\b`));
  assert.ok(start >= 0, `${name} not found — did it move or get renamed?`);
  const rest = src.slice(start);
  // The body opens at the first "{" that ENDS a line. Taking the first "{" of
  // any kind picks up an inline return type such as
  // Promise<{ remaining: number; fromExtra: number }>.
  const open = rest.search(/[{][ \t]*[\r]?[\n]/);
  assert.ok(open >= 0, `could not find the body of ${name}`);
  let depth = 0;
  for (let i = open; i < rest.length; i++) {
    if (rest[i] === "{") depth++;
    else if (rest[i] === "}" && --depth === 0) return rest.slice(open, i + 1);
  }
  throw new Error(`could not find the end of ${name}`);
}

/** Source with // and /* *\/ comments removed, so a rule is never satisfied or
 *  broken by prose describing the bug it guards against. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("the period roll is conditional, so two callers cannot both reset the wallet", () => {
  const body = stripComments(fnBody("refreshPeriod"));
  assert.match(
    body,
    /updateMany\(\{[\s\S]*periodStart:\s*plan\.periodStart/,
    "refreshPeriod must write through updateMany guarded on the periodStart it decided from"
  );
  assert.doesNotMatch(
    body,
    /db\.plan\.update\(\{/,
    "an unconditional plan.update here is the blind reset that erased a concurrent spend"
  );
});

test("the period roll re-reads, so the caller continues from the real row", () => {
  const body = stripComments(fnBody("refreshPeriod"));
  assert.match(body, /findUnique/, "after a contended roll the caller must re-read, not assume it won");
});

test("a spend is written only if the wallet still holds what it was measured against", () => {
  const body = stripComments(fnBody("deductFromWallet"));
  assert.match(
    body,
    /updateMany\(\{[\s\S]*tokensUsed:\s*plan\.tokensUsed[\s\S]*tokensExtra:\s*plan\.tokensExtra/,
    "the spend's compare-and-swap must pin BOTH counters — tokensUsed is also the trial ceiling's counter"
  );
});

test("a spend that loses the race retries rather than writing through", () => {
  const body = stripComments(fnBody("deductFromWallet"));
  assert.match(body, /for \(let attempt/, "the loser of a compare-and-swap must re-read and re-decide");
  assert.match(body, /applied\.count === 1/, "the write's success has to be checked");
});

test("a refund never decrements tokensUsed through a stale read", () => {
  const body = stripComments(fnBody("refundTokens"));
  // The decrement must be guarded. An unguarded plan.update carrying a
  // tokensUsed decrement is precisely the shape that went negative.
  const unguarded = /db\.plan\.update\(\{[^}]*\}[\s\S]{0,200}?tokensUsed:\s*\{\s*decrement/.test(body);
  assert.equal(unguarded, false, "the tokensUsed decrement must not ride on an unconditional plan.update");
  assert.match(
    body,
    /updateMany\(\{[\s\S]*tokensUsed:\s*cur\.tokensUsed[\s\S]*decrement/,
    "the decrement must be conditional on the value it was clamped against"
  );
});

test("a refund clamps at zero, so it can never conjure allowance", () => {
  const body = stripComments(fnBody("refundTokens"));
  assert.match(body, /Math\.max\(0,\s*cur\.tokensUsed\)|Math\.max\(0,\s*plan\.tokensUsed\)/,
    "what a refund unwinds must be clamped to what the period actually spent");
});

test("the purchased bucket is credited without waiting on a contended guard", () => {
  // tokensExtra only ever increments on a refund — atomic, no floor to breach.
  // Making it wait on the tokensUsed race could drop tokens the merchant paid
  // cash for.
  const body = stripComments(fnBody("refundTokens"));
  assert.match(body, /tokensExtra:\s*\{\s*increment:\s*toExtra/, "the purchased refund leg must still be applied");
});

test("both counters are clamped before a balance is computed from them", () => {
  // A negative tokensUsed inflates the wallet (included - (-n)); a negative
  // tokensExtra silently taxes a fresh allowance every month. Neither is a
  // state to transact on, whatever produced it.
  const remaining = stripComments(fnBody("tokensRemaining"));
  assert.match(remaining, /Math\.max\(0,\s*plan\.tokensUsed\)/, "tokensRemaining must clamp tokensUsed");
  assert.match(remaining, /Math\.max\(0,\s*plan\.tokensExtra\)/, "tokensRemaining must clamp tokensExtra");

  const spendable = stripComments(fnBody("spendableNow"));
  assert.match(spendable, /Math\.max\(0,\s*plan\.tokensUsed\)/, "spendableNow must clamp tokensUsed");
  assert.match(spendable, /Math\.max\(0,\s*plan\.tokensExtra\)/, "spendableNow must clamp tokensExtra");
});

test("the trial ceiling counts from the clamped figure", () => {
  // TRIAL_TOKEN_CAP - tokensUsed with a negative tokensUsed RAISES the ceiling.
  const spendable = stripComments(fnBody("spendableNow"));
  assert.match(
    spendable,
    /TRIAL_TOKEN_CAP\s*-\s*used/,
    "the trial cap must subtract the clamped value, not the raw column"
  );
});
