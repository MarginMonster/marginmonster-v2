/* The only thing standing between the public front door and a burst.
 *
 * Both endpoints it guards run scrypt, which is expensive by design and runs on
 * libuv's four-thread pool — the same pool the render pipeline's file work uses.
 * So a limiter that quietly stops counting, or one that never lets a legitimate
 * user back in, both cost real money. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { rateLimit, rateLimitReset, clientIp } from "../app/lib/rate-limit.server.ts";

// Every test uses its own key prefix — the buckets are module state.
let n = 0;
const key = () => `test-${++n}`;

test("requests up to the limit are allowed, and the next one is not", () => {
  const k = key();
  for (let i = 1; i <= 5; i++) {
    assert.equal(rateLimit(k, 5, 60_000).ok, true, `attempt ${i} should have been allowed`);
  }
  assert.equal(rateLimit(k, 5, 60_000).ok, false, "the sixth attempt should have been refused");
});

test("a refusal says how long to wait", () => {
  const k = key();
  rateLimit(k, 1, 60_000);
  const r = rateLimit(k, 1, 60_000);
  assert.equal(r.ok, false);
  assert.ok(r.retryAfterSec > 0 && r.retryAfterSec <= 60, `implausible retry: ${r.retryAfterSec}`);
});

test("keys do not bleed into each other", () => {
  const a = key();
  const b = key();
  for (let i = 0; i < 5; i++) rateLimit(a, 5, 60_000);
  assert.equal(rateLimit(a, 5, 60_000).ok, false);
  assert.equal(rateLimit(b, 5, 60_000).ok, true, "a different address was punished for another's attempts");
});

test("the window expires and the caller is let back in", async () => {
  const k = key();
  assert.equal(rateLimit(k, 1, 40).ok, true);
  assert.equal(rateLimit(k, 1, 40).ok, false);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(rateLimit(k, 1, 40).ok, true, "the window never reopened");
});

test("a reset clears the count — someone who got in is not the threat", () => {
  const k = key();
  for (let i = 0; i < 8; i++) rateLimit(k, 8, 60_000);
  assert.equal(rateLimit(k, 8, 60_000).ok, false);
  rateLimitReset(k);
  assert.equal(rateLimit(k, 8, 60_000).ok, true, "a successful login left the user locked out by their own typos");
});

test("staying under the limit forever is never refused", () => {
  const k = key();
  for (let i = 0; i < 200; i++) {
    assert.equal(rateLimit(k, 200, 60_000).ok, true, `refused at ${i}, under the limit`);
  }
});

test("the client address comes from the proxy header, first entry", () => {
  const req = (h: Record<string, string>) => new Request("https://x.test/", { headers: h });
  assert.equal(clientIp(req({ "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
  // Render appends its own hops; the original client is first.
  assert.equal(clientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" })), "203.0.113.7");
  assert.equal(clientIp(req({ "x-forwarded-for": "  203.0.113.7  " })), "203.0.113.7");
  assert.equal(clientIp(req({ "x-real-ip": "198.51.100.4" })), "198.51.100.4");
});

test("an unidentifiable caller is throttled, not waved through", () => {
  // One shared bucket is the safe direction: we would rather slow an
  // unknown caller than exempt them.
  assert.equal(clientIp(new Request("https://x.test/")), "unknown");
});

test("an empty forwarded-for falls through rather than keying on nothing", () => {
  const r = new Request("https://x.test/", { headers: { "x-forwarded-for": "", "x-real-ip": "198.51.100.9" } });
  assert.equal(clientIp(r), "198.51.100.9");
});
