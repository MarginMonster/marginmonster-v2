import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/* ops-alert fires from inside catch blocks on money-critical paths (double
 * billing, churn mismatch, owed refund). It imports email-provider.server
 * (a relative import node --test's type-stripping can't resolve), so — like
 * no-blind-writes.test.ts — we verify its contract against the SOURCE rather
 * than importing it. The contract that actually matters: an alert must NEVER
 * throw back into the money path, and must throttle so a looping failure can't
 * storm the inbox. If someone removes those, this test fails. */

const SRC = fs.readFileSync(new URL("../app/lib/ops-alert.server.ts", import.meta.url), "utf8");

/** The body of `export async function alertOps(...)`. */
function alertOpsBody(): string {
  const at = SRC.indexOf("export async function alertOps");
  assert.notEqual(at, -1, "alertOps was renamed or removed — update this test");
  return SRC.slice(at);
}

test("alertOps can never throw back into the money path", () => {
  const body = alertOpsBody();
  // A top-level try whose catch returns (does not rethrow) — the whole body is
  // guarded. Matching the return-in-catch is what distinguishes a swallow from
  // a `catch { throw }`.
  assert.match(body, /\btry\s*\{/, "alertOps body must be wrapped in try/catch");
  assert.match(body, /catch\s*\{[\s\S]*return false/, "the catch must swallow (return false), never rethrow");
  assert.doesNotMatch(body, /catch\s*\([\s\S]*?\)\s*\{[\s\S]*?throw\b/, "alertOps must not rethrow from its catch");
});

test("alertOps throttles per key so a looping failure can't storm the inbox", () => {
  const body = alertOpsBody();
  assert.match(SRC, /WINDOW_MS\s*=/, "a throttle window must be defined");
  assert.match(body, /lastSent\.get\(key\)/, "it must look up the last-sent time for the key");
  assert.match(body, /return false;\s*\/\/\s*throttled/i, "a repeat within the window must be throttled (return false)");
});

test("alertOps no-ops cleanly when email is not configured", () => {
  const body = alertOpsBody();
  assert.match(body, /if\s*\(\s*!emailEnabled\(\)\s*\)\s*return false/, "must no-op when email is off");
});
