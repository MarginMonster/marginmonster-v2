/* Working unsubscribe links.
 *
 * Every automated email this app sends ended with
 *   Sent with EasyMode · <a href="#">Unsubscribe</a>
 * — a dead anchor. No unsubscribe route existed anywhere in the app, and
 * nothing ever set Subscriber.status to "unsubscribed" even though the column
 * has always allowed it.
 *
 * That is not a missing nicety. A functioning opt-out is a legal requirement
 * for commercial email in most of the places these merchants sell (CAN-SPAM in
 * the US, PECR/GDPR in the UK and EU), and it is the recipient's only defence
 * against a shop that keeps mailing them.
 *
 * The token is HMAC-signed so one recipient cannot unsubscribe another by
 * editing a URL, and deliberately does NOT expire: an unsubscribe link has to
 * keep working in a mailbox for as long as the mail sits there.
 */

// Unsubscribe tokens never expire and there is no token table, so these are
// the links a key rotation would have killed PERMANENTLY. signing-secrets.ts
// verifies against every listed key, so rotating the signer keeps every link
// in every mailbox working.
import { signInput, verifyInput } from "./signing-secrets.ts";

export function signUnsubscribe(shopId: string, email: string): string {
  const payload = `${shopId}|${email.toLowerCase()}`;
  const mac = signInput(payload); // throws if no secret is configured
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${mac}`;
}

/** The shop and address this token unsubscribes, or null if it was not minted
 *  by us or has been tampered with. */
export function verifyUnsubscribe(token: string | null | undefined): { shopId: string; email: string } | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  let payload: string;
  try {
    payload = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
  } catch {
    return null;
  }

  // Checked against EVERY current key (timing-safe, no short-circuit) so a
  // rotation of the signing key does not kill a link sitting in a mailbox.
  // No secret configured makes this throw — trust nothing in that case.
  let ok = false;
  try {
    ok = verifyInput(payload, token.slice(dot + 1));
  } catch {
    return null;
  }
  if (!ok) return null;

  const sep = payload.indexOf("|");
  if (sep <= 0) return null;
  const shopId = payload.slice(0, sep);
  const email = payload.slice(sep + 1);
  if (!shopId || !email) return null;
  return { shopId, email };
}

/** The absolute link that goes in the footer. */
export function unsubscribeUrl(baseUrl: string, shopId: string, email: string): string {
  return `${baseUrl.replace(/\/$/, "")}/u/${signUnsubscribe(shopId, email)}`;
}
