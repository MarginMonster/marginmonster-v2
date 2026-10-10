/* 🚨 OPS ALERTS — email the operator when MONEY breaks.
 *
 * Several money anomalies (a superseded Stripe subscription that wouldn't
 * cancel → double-billing; a churn whose sub-ids disagree → plan stays on; a
 * refund the wallet kept moving under → merchant under-refunded) were only ever
 * written to console.warn/error. On a single Render instance "we logged it
 * loudly" means nobody sees it until a customer complains. This turns those
 * loud logs into an actual email so the operator can fix it by hand before it
 * compounds.
 *
 * Contract: best-effort and SILENT on its own failure — an alert must never add
 * latency that matters or throw back into the money path it's reporting on. It
 * no-ops cleanly when email isn't configured (the console log is still there).
 *
 * Routing: OPS_ALERT_EMAIL, or EMAIL_FROM as a sane default (alerts land in the
 * sending mailbox). Throttled per key so a bug that fires in a loop sends one
 * email per window, not a thousand. */

import { sendEmail, emailEnabled } from "./email-provider.server";

const WINDOW_MS = 30 * 60 * 1000; // one email per key per 30 min
const lastSent = new Map<string, number>();

function opsAddress(): string {
  return process.env.OPS_ALERT_EMAIL || process.env.EMAIL_FROM || "";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Fire an operator alert. Returns a boolean (sent / skipped) but NEVER throws —
 * callers `await` it inside a catch block and keep going regardless.
 *
 * @param key    stable throttle key (include the account id so each account can
 *               alert once per window, e.g. `double-bill:${accountId}`)
 * @param subject one-line summary (gets an [EASYMODE OPS] prefix)
 * @param lines  the detail body, one string per line
 */
export async function alertOps(key: string, subject: string, lines: string[]): Promise<boolean> {
  try {
    if (!emailEnabled()) return false;
    const to = opsAddress();
    if (!to) return false;

    const now = Date.now();
    const prev = lastSent.get(key) || 0;
    if (now - prev < WINDOW_MS) return false; // throttled
    lastSent.set(key, now);
    // Keep the map from growing without bound on a long-lived process.
    if (lastSent.size > 500) {
      for (const [k, t] of lastSent) if (now - t > WINDOW_MS) lastSent.delete(k);
    }

    const html =
      `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#14201A">` +
      `<p style="font-weight:700;color:#A11C10">🚨 EASYMODE ops alert</p>` +
      lines.map((l) => `<p>${esc(l)}</p>`).join("") +
      `<p style="color:#7a7a7a;font-size:12px">${esc(new Date(now).toISOString())} · you're getting this because a money-critical path logged a failure. Throttled to one per 30&nbsp;min per issue.</p>` +
      `</div>`;

    const r = await sendEmail({ to, subject: `[EASYMODE OPS] ${subject}`, html });
    return r.ok;
  } catch {
    return false; // an alert must never break the thing it's reporting on
  }
}
