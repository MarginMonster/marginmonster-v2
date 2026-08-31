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

const req = (h: Record<string, string>) => new Request("https://x.test/", { headers: h });

const EDGE = "198.51.100.200"; // the entry our edge appends; it varies per request

test("the client is the entry one hop from the right", () => {
  assert.equal(clientIp(req({ "x-forwarded-for": `203.0.113.7, ${EDGE}` })), "203.0.113.7");
  assert.equal(clientIp(req({ "x-forwarded-for": `  203.0.113.7 ,  ${EDGE} ` })), "203.0.113.7");
  assert.equal(clientIp(req({ "x-real-ip": "198.51.100.4" })), "198.51.100.4");
});

test("the appended entry is never the key, because it changes every request", () => {
  // This is the second wrong answer, caught by the same live probe as the
  // first: keying on the rightmost entry meant 25 requests from one machine
  // with no forged header were never limited, because our edge appends a
  // public address that rotates. Every caller got a fresh bucket.
  const client = "203.0.113.7";
  const keys = ["198.51.100.1", "198.51.100.2", "198.51.100.3"].map((edge) =>
    clientIp(req({ "x-forwarded-for": `${client}, ${edge}` })));
  assert.deepEqual(keys, [client, client, client]);
});

test("a forged prefix cannot buy a fresh bucket", () => {
  // Verified against the live site before any of this changed: 22 POSTs
  // claiming "X-Forwarded-For: 9.9.9.9" tripped the limit and answered 429,
  // and the next request claiming 8.8.8.8 got a 200. A proxy APPENDS what it
  // saw, so a forged entry can only land to the LEFT of the truth — and the
  // offset counted from the RIGHT does not move when one is added.
  const real = "203.0.113.7";
  const spoofs = [
    `9.9.9.9, ${real}, ${EDGE}`,
    `8.8.8.8, ${real}, ${EDGE}`,
    `1.1.1.1, 2.2.2.2, 3.3.3.3, ${real}, ${EDGE}`,
    `not-an-ip, ${real}, ${EDGE}`,
  ];
  for (const xff of spoofs) assert.equal(clientIp(req({ "x-forwarded-for": xff })), real, xff);
});

test("nothing that is not an IP is ever used as a bucket key", () => {
  // An arbitrary header string as a Map key is how MAX_KEYS gets exhausted on
  // purpose, which would turn the limiter into a site-wide lockout.
  for (const junk of [
    "not-an-ip", "999.999.999.999", "1.2.3", "<script>", "a".repeat(5000),
    "", ",,,", "  ,  ,  ",
  ]) {
    assert.equal(clientIp(req({ "x-forwarded-for": junk })), "unknown", JSON.stringify(junk.slice(0, 20)));
  }
  // Junk to the left of a real address does not stop the real one being found.
  assert.equal(clientIp(req({ "x-forwarded-for": `not-an-ip, 203.0.113.7, ${EDGE}` })), "203.0.113.7");
  assert.equal(clientIp(req({ "x-real-ip": "still-not-an-ip" })), "unknown");
});

test("address forms a proxy actually emits are understood", () => {
  // Ports and bracketed IPv6 both appear in real chains.
  assert.equal(clientIp(req({ "x-forwarded-for": `203.0.113.7:41234, ${EDGE}` })), "203.0.113.7");
  assert.equal(clientIp(req({ "x-forwarded-for": `[2001:db8::1]:443, ${EDGE}` })), "2001:db8::1");
  assert.equal(clientIp(req({ "x-forwarded-for": `2001:db8::1, ${EDGE}` })), "2001:db8::1");
});

test("a chain shorter than the expected hop count still yields a stable key", () => {
  // A request that did not come through the usual path. The leftmost entry is
  // the closest thing to a client there is, and it is no more forgeable than
  // the whole header already is in that situation.
  assert.equal(clientIp(req({ "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
});

test("an all-private chain still yields a stable key, never junk", () => {
  // A purely internal call: still a valid literal, still stable, never a
  // string an attacker chose.
  assert.equal(clientIp(req({ "x-forwarded-for": "10.0.0.1, 10.0.0.2" })), "10.0.0.1");
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
