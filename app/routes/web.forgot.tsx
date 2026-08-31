/* "I forgot my password" — the door that did not exist.
 *
 * Every response is identical whether or not the address has an account. The
 * app already closed the message oracle on login (web-auth.server.ts burns a
 * dummy hash on a miss so timing matches); this must not reopen it, so the send
 * is fired without awaiting and both branches return the same body in the same
 * time.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { db } from "../db.server";
import { emailEnabled, sendEmail } from "../lib/email-provider.server";
import { resetEmailHtml, resetUrl, signPasswordReset } from "../lib/password-reset.server";
import { clientIp, rateLimit } from "../lib/rate-limit.server";
import { getWebIdentity } from "../lib/web-auth.server";

export const meta = () => [
  { title: "Reset your password · EasyMode" },
  // The token never reaches this page, but the habit belongs on both halves.
  { name: "referrer", content: "no-referrer" },
];

const CONTACT = "hello@easymodeapp.com";

// Said on every path, so it can never become a signal.
const NEUTRAL =
  `If an account exists for that address, a reset link is on its way. It expires in 60 minutes. ` +
  `Nothing within 10 minutes? Email ${CONTACT} from the address on your account.`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (await getWebIdentity(request)) throw redirect("/web");
  // Decided BEFORE any address is seen, so the not-connected state leaks nothing.
  return json({ emailReady: emailEnabled() });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!emailEnabled()) {
    return json({ error: `Password reset by email isn't switched on yet. Email ${CONTACT} from the address on your account and we'll restore access by hand.` });
  }

  const form = await request.formData();
  const email = ((form.get("email") as string) || "").trim().toLowerCase();

  // Per-source may answer 429 — it says nothing about any address. Per-address
  // must NOT: a 429 that only fires for real accounts is itself an enumeration
  // oracle, so a tripped address bucket gets the neutral reply and no email.
  const byIp = rateLimit(`forgot:ip:${clientIp(request)}`, 5, 60 * 60_000);
  if (!byIp.ok) {
    return json({ error: "Too many reset requests from here. Try again a little later." }, { status: 429 });
  }
  const byEmail = email ? rateLimit(`forgot:acct:${email}`, 3, 60 * 60_000) : { ok: false };

  if (email && byEmail.ok) {
    const account = await db.account.findUnique({ where: { email } });
    if (account) {
      try {
        const link = resetUrl(signPasswordReset(account));
        // Not awaited: awaiting in the found branch and not the other is a
        // timing oracle. Failures are logged, never shown — reporting a send
        // failure specifically would confirm the address exists.
        void sendEmail({ to: account.email, subject: "Reset your EasyMode password", html: resetEmailHtml(link) })
          .then((r) => { if (!r.ok) console.error(`[reset] send failed for ${account.id}: ${r.error}`); })
          .catch((e) => console.error(`[reset] send threw for ${account.id}:`, e));
      } catch (e) {
        // Missing SESSION_SECRET or SHOPIFY_APP_URL — a misconfiguration, not
        // something to tell the visitor about.
        console.error("[reset] could not mint a reset link:", e instanceof Error ? e.message : e);
      }
    }
  }

  return json({ sent: NEUTRAL });
};

export default function Forgot() {
  const { emailReady } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const sent = actionData && "sent" in actionData ? actionData.sent : null;
  const error = actionData && "error" in actionData ? actionData.error : null;

  return (
    <div className="wb-auth wb-card">
      <h1 className="wb-h1" style={{ marginTop: 0 }}>Reset your password</h1>

      {!emailReady ? (
        <p className="wb-sub">
          Password reset by email isn't switched on yet. Email{" "}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a> from the address on your account and we'll restore
          access by hand.
        </p>
      ) : sent ? (
        <p className="wb-sub">{sent}</p>
      ) : (
        <>
          <p className="wb-sub" style={{ marginBottom: 6 }}>
            We'll email you a link to choose a new one.
          </p>
          {error && <div className="wb-err">{error}</div>}
          <Form method="post">
            <label className="wb-lbl">Email</label>
            <input className="wb-in" name="email" type="email" required autoComplete="email" />
            <div style={{ marginTop: 18 }}>
              <button className="wb-btn" type="submit" disabled={nav.state !== "idle"}>
                {nav.state !== "idle" ? "Sending…" : "Send the link →"}
              </button>
            </div>
          </Form>
        </>
      )}

      <p className="wb-note" style={{ marginTop: 16 }}>
        <Link to="/web/login">Back to log in</Link>
      </p>
    </div>
  );
}
