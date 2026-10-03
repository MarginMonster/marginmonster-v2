/* The address a MERCHANT sees — for links that land in a human's inbox or on
 * their screen.
 *
 * Two wrong answers, both already rejected elsewhere in this codebase for good
 * reasons, and one that was still in use:
 *
 *  - The request's Host / x-forwarded-host. Forgeable by the caller, which for
 *    a password-reset link means the token is delivered to whatever host the
 *    attacker named. password-reset.ts says exactly this and is right.
 *  - request.url. Render terminates TLS at the edge, so it reads http://, and
 *    an http:// link in an email is a mixed-content and phishing-filter problem
 *    (see origin.server.ts).
 *  - SHOPIFY_APP_URL — what every email link was actually built from. That
 *    variable is the Shopify app's REGISTERED application URL and has to match
 *    shopify.app.toml, which says application_url =
 *    "https://marginmonster-fiew.onrender.com". So on the day email is switched
 *    on, every reset, unsubscribe and digest link would have pointed merchants
 *    at a Render hostname that is not the brand — and the session cookie a
 *    password reset sets on that host does not apply on easymodeapp.com, so a
 *    merchant who reset their password landed "logged in" on the wrong site and
 *    found themselves logged out on the right one.
 *
 * The product has exactly one public address. It is not a secret and it does
 * not vary by request, so it is a constant with an env override for staging.
 *
 * Provider-fetch URLs — the /renders/* links handed to fal and Replicate so a
 * machine can download a frame — are a different question. Any reachable host
 * works for those and they may keep using SHOPIFY_APP_URL; this is only for
 * links a person will click. */

export const CANONICAL_WEB_URL = "https://easymodeapp.com";

/** Trailing slash stripped, so callers can append a path without doubling it. */
export function publicWebUrl(): string {
  const raw = (process.env.PUBLIC_WEB_URL || "").trim();
  const chosen = raw || CANONICAL_WEB_URL;
  return chosen.replace(/\/+$/, "");
}

/** Absolute URL for a merchant-facing path. `path` may or may not begin with a slash. */
export function publicWebHref(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${publicWebUrl()}${p}`;
}
