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

/**
 * Boot-time config health check. Catches the class of silent misconfiguration
 * that bit us once already: SESSION_SECRET was effectively unset in prod for who
 * knows how long and nobody noticed, because the only place it showed was a
 * diagnostics page nobody opens. This runs once at boot and — only if there's a
 * real money/security issue — logs it AND emails the operator. A healthy deploy
 * is silent. Never throws (boot must not depend on it).
 */
export async function checkConfigHealth(): Promise<void> {
  try {
    if (process.env.NODE_ENV !== "production") return;
    const issues: string[] = [];
    if (!process.env.SESSION_SECRET) {
      issues.push("SESSION_SECRET is unset/empty — cookie & link signing is falling back to the Shopify client secret. Set a strong random value and redeploy.");
    }
    if (process.env.DEV_GRANT_KEY) {
      issues.push("DEV_GRANT_KEY is SET — the token-granting /web/dev route is ARMED. Unset it in prod.");
    }
    if (!process.env.STRIPE_SECRET_KEY) {
      issues.push("STRIPE_SECRET_KEY is unset — billing/checkout is offline; nothing can be charged.");
    }
    if (!issues.length) return;
    // Log even if email is off (an email-off issue can't be emailed anyway).
    console.warn(`[config-health] ${issues.length} issue(s) at boot:\n` + issues.map((s, i) => `  ${i + 1}. ${s}`).join("\n"));
    // PERSISTENT dedupe for the EMAIL (not the log). alertOps's throttle lives in
    // memory, so every deploy is a fresh process that re-emails the same config
    // warning — which spammed the operator once per deploy during an active push
    // burst. Persist the last-alert time in the DB and stay quiet for 24h on an
    // UNCHANGED issue set. (Money alerts deliberately DON'T do this — you want to
    // be reminded of a double-charge; a standing config warning you don't.)
    const sig = issues.join("|");
    try {
      const { db } = await import("../db.server");
      const row = await db.setting.findUnique({ where: { key: "config_health_last_alert" } }).catch(() => null);
      if (row) {
        try {
          const prev = JSON.parse(row.value) as { at: number; sig: string };
          if (prev.sig === sig && Date.now() - prev.at < 24 * 3600_000) return; // same issues, alerted within 24h → stay quiet
        } catch { /* malformed row → fall through and re-alert */ }
      }
      const payload = JSON.stringify({ at: Date.now(), sig });
      await db.setting.upsert({
        where: { key: "config_health_last_alert" },
        create: { key: "config_health_last_alert", value: payload },
        update: { value: payload },
      });
    } catch { /* DB unavailable → fail toward informing: fall through and alert */ }
    await alertOps(
      "config-health",
      `Config health — ${issues.length} money/security issue${issues.length > 1 ? "s" : ""} at boot`,
      ["EASYMODE started with env issues that affect money or security:", ...issues.map((s, i) => `${i + 1}. ${s}`)]
    );
  } catch {
    /* boot must never depend on the health check */
  }
}
