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

/** Best-effort client address. Render (and every other proxy in front of this
 *  app) sets x-forwarded-for; the first entry is the original client. Falls
 *  back to a single shared bucket, which throttles rather than waves through —
 *  the safer direction when we cannot tell callers apart. */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Clear a key — used after a successful login so one person fat-fingering
 *  their password three times is not then locked out by their own retries. */
export function rateLimitReset(key: string): void {
  buckets.delete(key);
}
