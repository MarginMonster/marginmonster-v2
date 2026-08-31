/* A small in-process rate limiter for the public front door.
 *
 * WHY IT EXISTS. /web/signup and /web/login are open to the internet, and both
 * do real work per request. Login and signup each run scrypt — deliberately
 * expensive, and deliberately async so it does not block the event loop, which
 * means it runs on libuv's thread pool. That pool defaults to four threads and
 * is the same pool every fs operation uses, including the render pipeline's.
 * A few dozen concurrent password attempts therefore stall file work for every
 * tenant on the instance, without a single line of application code looking
 * slow. Signup additionally writes an Account, a Shop and a Connection, and an
 * unverified account can queue a sitemap crawl on a worker that runs one job at
 * a time.
 *
 * WHAT IT IS NOT. This is per-process memory: it resets on deploy and does not
 * span instances. That is honest for what it defends against — a burst from one
 * source — and not a substitute for a real WAF. It is a floor, not a ceiling.
 */

import net from "node:net";
// .ts extension so node --test can load this module directly — the repo
// convention for a tested lib importing a sibling (see password-reset.server.ts).
import { isBlockedIp } from "./blocked-host.ts";

type Window = { count: number; resetAt: number };

const buckets = new Map<string, Window>();
const MAX_KEYS = 20_000; // a hard ceiling so the limiter cannot itself leak

function sweep(now: number): void {
  for (const [k, w] of buckets) if (w.resetAt <= now) buckets.delete(k);
}

/** Count one hit against `key`. Returns whether it is allowed and how long the
 *  caller should wait if not. Fixed window — simple, and the imprecision at a
 *  window boundary does not matter at these thresholds. */
export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) sweep(now);
    // Still full after a sweep: every key is live, which means we are under a
    // distributed flood. Refuse rather than grow without bound.
    if (buckets.size >= MAX_KEYS) return { ok: false, retryAfterSec: Math.ceil(windowMs / 1000) };
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfterSec: 0 };
}

/** Strip the brackets off an IPv6 literal and any :port off an IPv4 one,
 *  then confirm it is actually an address. Returns "" for anything else. */
function asIp(raw: string): string {
  let v = (raw || "").trim();
  if (!v) return "";
  if (v.startsWith("[")) v = v.slice(1, v.indexOf("]") === -1 ? undefined : v.indexOf("]"));
  else if ((v.match(/:/g) || []).length === 1) v = v.split(":")[0]; // 1.2.3.4:5678
  return net.isIP(v) ? v.toLowerCase() : "";
}

/** The client address, read RIGHT TO LEFT.
 *
 *  This used to take the FIRST entry of x-forwarded-for, which is the one
 *  part of that header a caller writes themselves. Verified against the live
 *  site: 22 POSTs to /web/reset carrying "X-Forwarded-For: 9.9.9.9" tripped
 *  the 20-per-10-minutes limit and started answering 429 — and the very next
 *  request, identical but claiming 8.8.8.8, got a 200. Every IP limit on the
 *  public surface was one header away from unlimited: signup (10/hr — free
 *  Account+Shop+Connection creation, each able to queue a sitemap crawl onto
 *  the one serial worker every merchant's renders share), login and reset
 *  (scrypt on libuv's four-thread pool, which is the stall the note at the
 *  top of this file exists to prevent), the /go click counters that pay out
 *  achievement tokens, and landing-page view counting.
 *
 *  A proxy APPENDS the address it observed, so entries can only be forged to
 *  the LEFT of the truth. Walking from the right and taking the first public
 *  address therefore lands on the hop our edge actually saw, and needs no
 *  guess about how many proxies are in front of us: with one entry the rule
 *  degenerates to the old behaviour, and with a forged prefix it skips it.
 *
 *  Nothing that is not a valid IP literal is ever returned. An arbitrary
 *  header string used as a Map key is how MAX_KEYS above gets exhausted on
 *  purpose, which would turn the limiter into a global lockout.
 */
export function clientIp(request: Request): string {
  const chain = (request.headers.get("x-forwarded-for") || "").split(",").map(asIp).filter(Boolean);

  // Right to left: the first PUBLIC address is the one our edge observed.
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!isBlockedIp(chain[i])) return chain[i];
  }
  // Every hop was private — a purely internal call, or a forged chain with no
  // public entry. The rightmost is still the closest thing to the truth.
  if (chain.length) return chain[chain.length - 1];

  const real = asIp(request.headers.get("x-real-ip") || "");
  if (real) return real;

  // One shared bucket: throttles rather than waves through, which is the
  // safer direction when we cannot tell callers apart.
  return "unknown";
}

/** Clear a key — used after a successful login so one person fat-fingering
 *  their password three times is not then locked out by their own retries. */
export function rateLimitReset(key: string): void {
  buckets.delete(key);
}
