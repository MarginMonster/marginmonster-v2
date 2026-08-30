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

import crypto from "node:crypto";

const STATE_TTL_MS = 15 * 60_000;

function stateSecret(): string {
  const s = process.env.SESSION_SECRET || process.env.SHOPIFY_API_SECRET;
  if (!s) {
    // Refuse rather than fall back to a constant: an unsigned or
    // predictably-signed state is the whole vulnerability.
    throw new Error("Cannot sign an OAuth state: set SESSION_SECRET or SHOPIFY_API_SECRET.");
  }
  return s;
}

export function signOAuthState(shop: string): string {
  const payload = `${shop}|${Date.now().toString(36)}`;
  const mac = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
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

  let expected: string;
  try {
    expected = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  } catch {
    return null; // no secret configured — nothing can be trusted
  }

  const got = Buffer.from(mac);
  const want = Buffer.from(expected);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;

  const sep = payload.lastIndexOf("|");
  if (sep <= 0) return null;
  const shop = payload.slice(0, sep);
  const issuedAt = parseInt(payload.slice(sep + 1), 36);
  if (!shop || !Number.isFinite(issuedAt)) return null;
  if (Date.now() - issuedAt > STATE_TTL_MS) return null;
  return shop;
}
