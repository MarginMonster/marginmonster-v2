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

type Window = { count: number; resetAt: number };

const buckets = new Map<string, Window>();
const MAX_KEYS = 20_000; // a hard ceiling so the limiter cannot itself leak

/* THE SITE-WIDE LOCKOUT THIS AVOIDS.
 *
 * When the table was full and a sweep freed nothing — every window still live —
 * this REFUSED the incoming key. That is fail-closed on memory and fail-closed
 * on the front door at the same time: whoever fills the table denies service to
 * every key not already in it, which is every fresh signup, login, password
 * reset and reset-link visit.
 *
 * The "nothing that is not an IP is ever used as a bucket key" test below
 * already closed half of this, and names this exact risk: clientIp() can only
 * return a real address or "unknown", so the IP half of a key is not
 * attacker-chosen. The other half stayed open. /go and /lp build their keys
 * from URL PATH SEGMENTS — `click:<ip>:q:<qid>:<idx>`, `lpview:<ip>:<slug>` —
 * and neither is validated before the key is made, so one machine on one
 * address can mint unlimited distinct keys.
 *
 * The fix is to bound each PURPOSE separately. Key prefixes are literals in the
 * calling code (click, lpview, signup, login, forgot, reset), so the set of
 * purposes is fixed by this repo and not by callers. A flood of click: keys now
 * evicts click: keys and can never starve signup:.
 *
 * Within one purpose, a flood now degrades the limit toward "stops counting"
 * instead of "refuses everyone". That is the right direction for something this
 * file already calls a floor rather than a substitute for a WAF: the worst case
 * becomes the behaviour from before the limiter existed, not an outage of the
 * two paths that take the money. */
const MAX_KEYS_PER_PURPOSE = 4_000;

/** Live bucket count per purpose. Kept in step with `buckets` by routing every
 *  removal through drop() and every insert through add(). */
const nsCounts = new Map<string, number>();

/** The purpose half of a key — the literal prefix the calling code chose.
 *  Keys with no prefix (only tests have these) share one bucket, so they
 *  cannot grow the set of purposes without bound either. */
function nsOf(key: string): string {
  const i = key.indexOf(":");
  return i > 0 ? key.slice(0, i) : "-";
}

function drop(key: string): void {
  if (!buckets.delete(key)) return;
  const ns = nsOf(key);
  const n = (nsCounts.get(ns) || 0) - 1;
  if (n > 0) nsCounts.set(ns, n);
  else nsCounts.delete(ns);
}

function add(key: string, w: Window): void {
  buckets.set(key, w);
  const ns = nsOf(key);
  nsCounts.set(ns, (nsCounts.get(ns) || 0) + 1);
}

/** Evict one bucket of a purpose to make room, preferring an EXPIRED one.
 *
 *  Map iteration is insertion-ordered, so the first match is the oldest. But
 *  evicting a still-LIVE bucket throws away a count that is actively limiting
 *  someone — under a flood on a shared purpose (e.g. many login:acct keys) that
 *  could drop the very bucket holding a brute-force attempt back at zero. So
 *  take an expired bucket of this purpose first; only when none has expired
 *  (a genuine live flood) fall back to the oldest, which is the documented
 *  degradation — a floor, not a WAF. */
function evictOldestOf(ns: string, now: number): boolean {
  let oldestLive: string | null = null;
  for (const [k, w] of buckets) {
    if (nsOf(k) !== ns) continue;
    if (w.resetAt <= now) { drop(k); return true; } // expired — free it, cost nobody
    if (oldestLive === null) oldestLive = k;
  }
  if (oldestLive !== null) { drop(oldestLive); return true; }
  return false;
}

function sweep(now: number): void {
  for (const [k, w] of buckets) if (w.resetAt <= now) drop(k);
}

/** Count one hit against `key`. Returns whether it is allowed and how long the
 *  caller should wait if not. Fixed window — simple, and the imprecision at a
 *  window boundary does not matter at these thresholds. */
export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (existing) drop(key); // expired: re-insert so the per-purpose count stays exact
    const ns = nsOf(key);
    if (buckets.size >= MAX_KEYS) sweep(now);
    // Keep this purpose inside its own allowance, so a flood against one public
    // route evicts that route's buckets and never the front door's.
    while ((nsCounts.get(ns) || 0) >= MAX_KEYS_PER_PURPOSE) {
      if (!evictOldestOf(ns, now)) break;
    }
    // Global backstop. Make room — preferably from this purpose, otherwise from
    // the oldest bucket there is — but never answer "refused" just because the
    // table is full, which is what turned a memory guard into a lockout.
    if (buckets.size >= MAX_KEYS && !evictOldestOf(ns, now)) {
      const oldest = buckets.keys().next();
      if (!oldest.done) drop(oldest.value);
    }
    add(key, { count: 1, resetAt: now + windowMs });
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

/** How many proxies sit in front of this app and APPEND to x-forwarded-for.
 *
 *  Render's edge adds exactly one entry, so the client is the second from the
 *  right. This is not a guess that can be left to rot — it is checkable from
 *  outside in one minute, with no access to any log:
 *
 *    25 POSTs to /web/reset/anything with no forwarded header should start
 *    answering 429 at the 21st. Then 25 more, each claiming a DIFFERENT
 *    X-Forwarded-For, should stay 429 — a forged entry can only be added on
 *    the left, so it cannot buy a fresh bucket.
 *
 *  If the first run never reaches 429, the count is too low (the key is
 *  landing on a proxy address that rotates). If the second run answers 200,
 *  it is too high (the key is landing on the forged entry).
 *
 *  Override with TRUSTED_PROXY_HOPS if the topology ever changes.
 */
const TRUSTED_PROXY_HOPS = (() => {
  const n = Number.parseInt(process.env.TRUSTED_PROXY_HOPS || "", 10);
  return Number.isInteger(n) && n >= 0 && n <= 8 ? n : 1;
})();

/** The client address.
 *
 *  Two wrong answers were tried before this one, and both were caught by the
 *  same probe against the live site, so the reasoning is worth keeping.
 *
 *  FIRST ENTRY (the original) is the part of the header a caller writes
 *  themselves. 22 POSTs to /web/reset claiming "X-Forwarded-For: 9.9.9.9"
 *  tripped the limit and answered 429; the next request, identical but
 *  claiming 8.8.8.8, got a 200. Every IP limit on the public surface was one
 *  header away from unlimited: signup, login, password reset, the /go click
 *  counters that pay out achievement tokens, landing-page view counting.
 *
 *  RIGHTMOST PUBLIC ENTRY closed that, and opened a worse hole: 25 requests
 *  from one machine with no forged header were never limited either. The
 *  entry our edge appends is itself a public address that varies between
 *  requests, so every caller got a fresh bucket and the limiter was off.
 *
 *  COUNTING FROM THE RIGHT is what actually works. Each proxy appends the
 *  address it saw, so with a known number of appending hops the client sits
 *  at a fixed offset from the end — and a forged entry, which can only be
 *  prepended, shifts nothing at that offset.
 */
export function clientIp(request: Request): string {
  const chain = (request.headers.get("x-forwarded-for") || "").split(",").map(asIp).filter(Boolean);

  if (chain.length) {
    const idx = chain.length - 1 - TRUSTED_PROXY_HOPS;
    // A chain shorter than the expected hop count means the request did not
    // come through the usual path. The leftmost entry is then the closest
    // thing to a client we have, and it is no more forgeable than the whole
    // header already is in that situation.
    return idx >= 0 ? chain[idx] : chain[0];
  }

  const real = asIp(request.headers.get("x-real-ip") || "");
  if (real) return real;

  // One shared bucket: throttles rather than waves through, which is the
  // safer direction when we cannot tell callers apart.
  return "unknown";
}
export function rateLimitReset(key: string): void {
  drop(key);
}

/** Test/diagnostic view of the per-purpose occupancy. Not used in app code. */
export function rateLimitStats(): { total: number; perPurpose: Record<string, number>; maxPerPurpose: number } {
  return { total: buckets.size, perPurpose: Object.fromEntries(nsCounts), maxPerPurpose: MAX_KEYS_PER_PURPOSE };
}
