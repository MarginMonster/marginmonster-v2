/* Password reset for web (non-Shopify) accounts — the parts with no database.
 *
 * Split out so the signing half can be tested directly (tests/password-reset.test.ts);
 * verifyPasswordReset needs a row and lives in password-reset.server.ts.
 *
 * Until now there was none. A merchant who forgot their password was locked out
 * of a PAID account with no way back: /web/login offered nothing, and signing up
 * again is refused because the email is taken.
 *
 * Third member of the HMAC-token family alongside oauth-state.server.ts and
 * unsubscribe.server.ts, with the two differences that matter for this one:
 *
 *   IT EXPIRES. An unsubscribe link must keep working for years; a reset link
 *   is a key to the account and lives 60 minutes.
 *
 *   IT IS SINGLE USE, without a token table. The signature is computed over the
 *   account's CURRENT password hash, so the moment a reset succeeds the hash
 *   changes and every outstanding link signed against the old one stops
 *   verifying. That also covers the case a table would not get for free: a link
 *   issued before the owner recovered the account by other means cannot be used
 *   to take it back afterwards. hashPassword salts randomly, so this holds even
 *   when someone resets to the same password they had.
 *
 *   The hash is MAC INPUT ONLY and never appears in the token. It is
 *   password-equivalent material and must not travel through a URL, a mailbox,
 *   or an access log.
 */

import crypto from "node:crypto";

export const RESET_TTL_MS = 60 * 60_000;

function secret(): string {
  const s = process.env.SESSION_SECRET || process.env.SHOPIFY_API_SECRET;
  if (!s) throw new Error("Cannot sign a password-reset link: set SESSION_SECRET or SHOPIFY_API_SECRET.");
  return s;
}

export const resetMac = (payload: string, passwordHash: string | null): string =>
  crypto.createHmac("sha256", secret()).update(`${payload}|${passwordHash ?? ""}`).digest("base64url");

export function signPasswordReset(account: { id: string; passwordHash: string | null }): string {
  const payload = `${account.id}|${Date.now().toString(36)}`;
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${resetMac(payload, account.passwordHash)}`;
}

/** The absolute link that goes in the email.
 *
 *  Built from SHOPIFY_APP_URL and NOT from the request's headers. The obvious
 *  thing — reusing externalOrigin() — reads x-forwarded-host, which the client
 *  controls: a forged header would mint a reset email whose link points at
 *  someone else's host and hand them the token the moment the real merchant
 *  clicked it. Same rule email-flows.server.ts and digest.server.ts already
 *  follow for the same reason. */
export function resetUrl(token: string): string {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("Cannot build a password-reset link: SHOPIFY_APP_URL is unset.");
  return `${base}/web/reset/${token}`;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain transactional copy. Deliberately NOT routed through the marketing
 *  writer or sendBrandEmail: a security email is not marketing, it must not
 *  carry an unsubscribe footer, and it must never be suppressed by a Subscriber
 *  opt-out — the person locked out of their account still needs the key. */
export function resetEmailHtml(link: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reset your EasyMode password</title></head>
<body style="margin:0;padding:0;background:#F4F0E6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F0E6;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(20,18,31,.08);">
      <tr><td style="padding:30px 32px 10px;font:800 22px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14121F;">Reset your password</td></tr>
      <tr><td style="padding:0 32px 18px;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#4A4664;">
        Choose a new password for your EasyMode account. This link expires in 60 minutes and stops working once it has been used.
      </td></tr>
      <tr><td style="padding:0 32px 26px;">
        <a href="${esc(link)}" style="display:inline-block;background:#14121F;color:#FFD778;text-decoration:none;font:800 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:14px 26px;border-radius:10px;">Choose a new password</a>
      </td></tr>
      <tr><td style="padding:0 32px 30px;font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#8A8598;">
        Didn't ask for this? Ignore this email — nothing changes until the link is used.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}
