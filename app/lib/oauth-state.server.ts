/* Signed OAuth `state` for the ad-platform connect flows.
 *
 * Both callbacks used to read the shop domain straight out of `state` and
 * write an AdAccount row — with a live Meta/TikTok access token — for whatever
 * shop that string named. Neither route authenticates, and `state` is a plain
 * query parameter the person completing the OAuth controls.
 *
 * So a link crafted with someone else's shop domain in `state`, handed to a
 * merchant who then approves it at Meta, stores THEIR ad-account token against
 * the attacker's shop — and the attacker's EasyMode can then launch campaigns
 * that spend the victim's advertising budget. The same trick in reverse
 * overwrites a victim's binding and points their campaigns at an account they
 * do not own.
 *
 * `state` therefore has to be something only we can mint. It carries the shop
 * and an issue time, signed with the server secret and rejected after fifteen
 * minutes — long enough for a person to finish an OAuth screen, short enough
 * that a captured URL stops working.
 */

// Signing goes through signing-secrets.ts so a key rotation does not kill a
// handshake that is mid-flight: [0] signs, every listed key verifies.
import { signInput, verifyInput } from "./signing-secrets.ts";

const STATE_TTL_MS = 15 * 60_000;

export function signOAuthState(shop: string): string {
  const payload = `${shop}|${Date.now().toString(36)}`;
  // Throws if no secret is configured — refuse rather than fall back to a
  // constant: an unsigned or predictably-signed state is the whole vulnerability.
  const mac = signInput(payload);
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${mac}`;
}

/** The shop this state was minted for, or null if it was not minted by us,
 *  has been tampered with, or has expired. */
export function verifyOAuthState(state: string | null): string | null {
  if (!state) return null;
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = state.slice(0, dot);
  const mac = state.slice(dot + 1);

  let payload: string;
  try {
    payload = Buffer.from(body, "base64url").toString("utf8");
  } catch {
    return null;
  }

  // Against every current signing key, timing-safe — see signing-secrets.ts.
  // No secret configured makes this throw: nothing can be trusted then.
  let ok = false;
  try {
    ok = verifyInput(payload, mac);
  } catch {
    return null;
  }
  if (!ok) return null;

  const sep = payload.lastIndexOf("|");
  if (sep <= 0) return null;
  const shop = payload.slice(0, sep);
  const issuedAt = parseInt(payload.slice(sep + 1), 36);
  if (!shop || !Number.isFinite(issuedAt)) return null;
  if (Date.now() - issuedAt > STATE_TTL_MS) return null;
  return shop;
}
