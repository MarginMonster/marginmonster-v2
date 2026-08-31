/* Dependency-free HTTP retry helper.
 *
 * WHY: every paid provider we talk to (Replicate, Anthropic, fal) answers 429
 * under load and 5xx during their own deploys. A single un-retried call there
 * kills a job that has ALREADY spent money upstream (script → TTS → render), so
 * the merchant gets a refund and no video. One helper, used everywhere, so the
 * retry semantics (and the honouring of provider-supplied retry-after hints)
 * can't drift between call sites.
 *
 * Contract:
 *   - retries on HTTP 429, on any 5xx, and on a network-level rejection
 *   - honours the `retry-after` response header (seconds OR an HTTP-date) and a
 *     JSON `retry_after` body field (Replicate sends the latter)
 *   - otherwise backs off exponentially: 2^n seconds, capped (default 60s)
 *   - NEVER throws for an HTTP status — the final Response is returned as-is so
 *     the caller keeps its own error formatting/parsing. Only a network error
 *     that survives every attempt is rethrown.
 */

export interface FetchRetryOptions {
  /** Total tries, including the first one. Default 6. */
  attempts?: number;
  /** Ceiling for a single backoff sleep, in ms. Default 60s. */
  capMs?: number;
  /** Ceiling for the SUM of all backoff sleeps, in ms. The worker is serial, so
   *  an unbounded sleep stalls the queue for every merchant; when this is hit we
   *  stop retrying and hand the caller whatever the last response/error was.
   *  Default 120s. */
  totalCapMs?: number;
  /** Log prefix so a retry storm is attributable in the logs. */
  label?: string;
  /** Ceiling for ONE attempt's request, in ms. Default 120s.
   *
   *  The caps above bound only the SLEEPS between attempts; the request itself
   *  had no bound at all. A host that accepts the TCP connection and then goes
   *  quiet — the ordinary load-balancer drain — parked this await forever, and
   *  since Anthropic is the first step of every paid pipeline, that is the
   *  serial worker stopped for every merchant. */
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* Run one fetch under a deadline that is DISARMED the moment it resolves.
 *
 * The obvious version — passing AbortSignal.timeout(n) straight through — is
 * wrong twice over. It stays armed after fetch returns, so it can abort the
 * caller's body read (every caller here reads .text() or .json() afterwards);
 * and one signal shared across attempts means attempt two starts already
 * aborted. A controller cleared in a finally has neither problem, and a fresh
 * one per attempt gives each retry its full window.
 *
 * The caller's own signal is composed in, never replaced: where one is passed
 * it is the budget for the WHOLE operation and must survive the composition.
 */
async function fetchOnce(url: string, init: RequestInit | undefined, ms: number): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`request exceeded ${Math.round(ms / 1000)}s`)), ms);
  const signal = init?.signal ? AbortSignal.any([init.signal, ac.signal]) : ac.signal;
  try {
    return await fetch(url, { ...init, signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Parse a `retry-after` header — the spec allows delta-seconds or an HTTP-date.
 *  Returns ms, or 0 when the header is absent/unparseable. */
function retryAfterHeaderMs(res: Response): number {
  const raw = res.headers.get("retry-after");
  if (!raw) return 0;
  const secs = Number(raw.trim());
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const when = Date.parse(raw);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return 0;
}

/** Some providers (Replicate) put the hint in the JSON body instead of the
 *  header. Read it off a CLONE so the caller's copy of the body is untouched. */
async function retryAfterBodyMs(res: Response): Promise<number> {
  try {
    const j = (await res.clone().json()) as { retry_after?: unknown };
    const secs = Number(j?.retry_after);
    if (Number.isFinite(secs) && secs > 0) return secs * 1000;
  } catch {
    /* not JSON / already consumed — fall back to exponential backoff */
  }
  return 0;
}

/** true for the statuses that are worth trying again (transient by definition).
 *  4xx other than 429 are the caller's fault and never get retried. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function fetchRetry(
  url: string,
  init?: RequestInit,
  opts: FetchRetryOptions = {}
): Promise<Response> {
  const attempts = Math.max(1, opts.attempts ?? 6);
  const capMs = opts.capMs ?? 60_000;
  const totalCapMs = opts.totalCapMs ?? 120_000;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const label = opts.label ? `[${opts.label}] ` : "";

  let slept = 0;
  let lastNetworkError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    // exponential backoff for THIS attempt: 1s, 2s, 4s, 8s… capped
    const backoffMs = Math.min(capMs, 2 ** attempt * 1000);
    const isLast = attempt === attempts - 1;

    let res: Response;
    try {
      res = await fetchOnce(url, init, timeoutMs);
    } catch (e) {
      // network-level failure (DNS, reset, TLS): no Response to hand back, so
      // this is the one case where we can end up throwing.
      lastNetworkError = e;
      if (isLast) break;
      const wait = Math.min(backoffMs, totalCapMs - slept);
      if (wait <= 0) break;
      console.warn(`${label}network error, retry ${attempt + 1}/${attempts - 1} in ${Math.round(wait / 1000)}s:`, e instanceof Error ? e.message.slice(0, 160) : e);
      slept += wait;
      await sleep(wait);
      continue;
    }

    if (!isRetryableStatus(res.status) || isLast) return res;

    // Provider-supplied hint wins over our exponential guess — it's the only
    // number that actually knows when the rate limit window reopens.
    const hinted = retryAfterHeaderMs(res) || (await retryAfterBodyMs(res));
    let wait = Math.min(capMs, hinted || backoffMs);
    if (slept + wait > totalCapMs) wait = totalCapMs - slept;
    // Out of patience: return the transient response and let the caller decide
    // (for queue jobs that means failing this attempt and requeueing, which is
    // far cheaper than blocking the single worker for minutes).
    if (wait <= 0) return res;
    console.warn(`${label}HTTP ${res.status}, retry ${attempt + 1}/${attempts - 1} in ${Math.round(wait / 1000)}s`);
    slept += wait;
    await sleep(wait);
  }

  throw lastNetworkError instanceof Error
    ? lastNetworkError
    : new Error(`${label}request failed: ${String(lastNetworkError)}`);
}
