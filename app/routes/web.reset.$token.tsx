/* Choosing the new password.
 *
 * The GET only validates and renders. All mutation lives in the POST, because
 * mail-security scanners (Outlook Safe Links, Proofpoint) fetch every URL in
 * every message — a design that resets on GET is silently broken by them, and
 * the merchant's link is spent before they ever click it.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { db } from "../db.server";
import { verifyPasswordReset } from "../lib/password-reset.server";
import { clientIp, rateLimit, rateLimitReset } from "../lib/rate-limit.server";
import { hashPassword, webSessionRedirect } from "../lib/web-auth.server";

export const meta = () => [
  { title: "Choose a new password · EasyMode" },
  // The token is in the path, so keep it out of the Referer header on any
  // outbound click from this page.
  { name: "referrer", content: "no-referrer" },
];

const DEAD = "This link is no longer valid — it may have expired, or already been used.";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  // Deliberately returns nothing about the account: not the email, not the
  // name. A leaked link must not double as a profile lookup, and expiry must
  // look exactly like forgery so neither confirms an account exists.
  return json({ valid: !!(await verifyPasswordReset(params.token)) });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  // The MAC is 256-bit, so this is not the real defence — it is here because
  // the POST runs scrypt on libuv's four-thread pool, which the render
  // pipeline's file work shares.
  const gate = rateLimit(`reset:ip:${clientIp(request)}`, 20, 10 * 60_000);
  if (!gate.ok) {
    return json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }

  // Re-verified from the path, never from anything the form supplied.
  const account = await verifyPasswordReset(params.token);
  if (!account) return json({ error: DEAD });

  const form = await request.formData();
  const password = (form.get("password") as string) || "";
  // Same rule as signup, so the two doors cannot disagree.
  if (password.length < 8) return json({ error: "Password needs at least 8 characters." });

  const newHash = await hashPassword(password);
  // COMPARE-AND-SWAP, not read-then-write. Routes and the worker share one
  // event loop, so two submissions of the same link — a double click, or a
  // scanner racing the merchant — can both pass a findUnique check before
  // either writes. Pinning the hash the token was signed against makes the
  // single-use property a single atomic statement.
  const applied = await db.account.updateMany({
    where: { id: account.id, passwordHash: account.passwordHash },
    data: { passwordHash: newHash },
  });
  if (applied.count !== 1) return json({ error: DEAD });

  // The failed attempts that drove them here must not lock them out of the
  // account they just recovered.
  rateLimitReset(`login:acct:${account.email}`);

  // An account with no web Connection cannot load /web — getWebIdentity returns
  // null and the redirect bounces straight back to the login page, so the reset
  // would look like it silently failed. Rare (the signup transaction prevents
  // new orphans) but reachable in rows created before that transaction existed.
  const conn = await db.connection.findFirst({ where: { accountId: account.id, kind: "web" } });
  if (!conn) return json({ orphaned: true });

  // The new hash, not the account object we verified against — that still
  // holds the OLD hash, and a cookie fingerprinted with it would be rejected
  // on the very next request, bouncing the merchant back to the login page
  // seconds after a successful reset.
  return webSessionRedirect({ id: account.id, passwordHash: newHash });
};

export default function ResetPassword() {
  const { valid } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const error = actionData && "error" in actionData ? actionData.error : null;
  const orphaned = actionData && "orphaned" in actionData;

  if (orphaned) {
    return (
      <div className="wb-auth wb-card">
        <h1 className="wb-h1" style={{ marginTop: 0 }}>Password changed</h1>
        <p className="wb-sub">
          Your new password is saved, but this account isn't linked to a workspace yet, so there's nothing
          to sign in to. Email <a href="mailto:hello@easymodeapp.com">hello@easymodeapp.com</a> and we'll
          connect it.
        </p>
      </div>
    );
  }

  if (!valid) {
    return (
      <div className="wb-auth wb-card">
        <h1 className="wb-h1" style={{ marginTop: 0 }}>That link has expired</h1>
        <p className="wb-sub">{DEAD}</p>
        <p className="wb-note" style={{ marginTop: 16 }}>
          <Link to="/web/forgot">Send me a new one</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="wb-auth wb-card">
      <h1 className="wb-h1" style={{ marginTop: 0 }}>Choose a new password</h1>
      {error && <div className="wb-err">{error}</div>}
      <Form method="post">
        <label className="wb-lbl">New password</label>
        <input
          className="wb-in"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="8+ characters"
        />
        <div style={{ marginTop: 18 }}>
          <button className="wb-btn" type="submit" disabled={nav.state !== "idle"}>
            {nav.state !== "idle" ? "Saving…" : "Save and log in →"}
          </button>
        </div>
      </Form>
    </div>
  );
}
