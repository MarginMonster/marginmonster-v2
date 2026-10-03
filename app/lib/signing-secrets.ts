/* The keys that sign and verify everything HMAC-shaped on the web surface:
 * session cookies, password-reset links, unsubscribe links, OAuth state.
 *
 * THE TRAP THIS REMOVES. Four modules each did
 *   process.env.SESSION_SECRET || process.env.SHOPIFY_API_SECRET
 * and used the single result for both signing and verifying. SESSION_SECRET is
 * unset in production, so SHOPIFY_API_SECRET — the Shopify app's client secret,
 * a value also held by Shopify and copied into local .env files — has been the
 * signing key for all four. That is a key-separation smell, not an exploit
 * (production refuses to boot with neither set). But it left the owner with no
 * safe move: SETTING SESSION_SECRET, the obvious hygiene fix, would instantly
 * invalidate every live session (every merchant logged out), every reset link
 * in flight, every OAuth handshake mid-flow, and — permanently, because they are
 * HMAC-only with no token table — every unsubscribe link in every marketing
 * email ever sent. A routine Shopify-side secret rotation would do the same
 * thing by surprise.
 *
 * So: an ORDERED LIST. Index 0 signs. Every entry verifies. Remix's cookie
 * session storage already works this way (`secrets: [...]`); the three
 * hand-rolled HMAC modules now do too. Set SESSION_SECRET in Render and the
 * next deploy signs with it while still honouring everything signed with the
 * old key; drop SHOPIFY_API_SECRET from the list whenever that is convenient,
 * or never.
 *
 * Pure (crypto + env only) so the tested token modules can import it with the
 * explicit .ts extension the test runner needs. */

import crypto from "node:crypto";

const DEV_ONLY_SECRET = "em-dev-secret";

/** Ordered: [0] is the signing key, every entry is a verifying key. */
export function signingSecrets(): string[] {
  const list = [process.env.SESSION_SECRET, process.env.SHOPIFY_API_SECRET]
    .map((s) => (s || "").trim())
    .filter((s) => s.length > 0);
  // The same value under both names is one key, not two.
  const uniq = Array.from(new Set(list));
  if (uniq.length) return uniq;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to start: neither SESSION_SECRET nor SHOPIFY_API_SECRET is set, so session cookies and " +
        "signed links would use a key that is published in the source. Set SESSION_SECRET in the environment.",
    );
  }
  return [DEV_ONLY_SECRET]; // local development only — never reached in production
}

export function hmacB64url(secret: string, input: string): string {
  return crypto.createHmac("sha256", secret).update(input).digest("base64url");
}

/** Sign with the CURRENT key. */
export function signInput(input: string): string {
  return hmacB64url(signingSecrets()[0], input);
}

/** Verify against EVERY current key, timing-safe, without short-circuiting —
 *  so the comparison takes the same time whichever key (if any) matches, and
 *  rotating the signing key never invalidates what the previous one signed. */
export function verifyInput(input: string, mac: string | null | undefined): boolean {
  if (!mac) return false;
  const got = Buffer.from(mac);
  let ok = false;
  for (const s of signingSecrets()) {
    const want = Buffer.from(hmacB64url(s, input));
    if (got.length === want.length && crypto.timingSafeEqual(got, want)) ok = true;
  }
  return ok;
}
