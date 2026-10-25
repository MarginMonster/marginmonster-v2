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
import { useEffect, useState } from "react";
import { db } from "../db.server";
import { emailEnabled, sendEmail } from "../lib/email-provider.server";
import { resetEmailHtml, resetUrl, signPasswordReset } from "../lib/password-reset.server";
import { clientIp, rateLimit } from "../lib/rate-limit.server";
import { getWebIdentity } from "../lib/web-auth.server";
import { authCopy } from "../lib/auth-i18n";

export const meta = () => [
  { title: "Reset your password · EasyMode" },
  // The token never reaches this page, but the habit belongs on both halves.
  { name: "referrer", content: "no-referrer" },
];

const CONTACT = "hello@easymodeapp.com";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (await getWebIdentity(request)) throw redirect("/web");
  // Decided BEFORE any address is seen, so the not-connected state leaks nothing.
  return json({ emailReady: emailEnabled() });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const email = ((form.get("email") as string) || "").trim().toLowerCase();
  // Localise to the posted language, same as login/signup. Chosen the same way
  // on every path, so it is never itself a signal.
  const c = authCopy(form.get("lang"));

  if (!emailEnabled()) {
    return json({ error: c.forgotOff.replace("{contact}", CONTACT) });
  }

  // Said on every path, so it can never become a signal.
  const NEUTRAL = c.forgotNeutral.replace("{contact}", CONTACT);

  // Per-source may answer 429 — it says nothing about any address. Per-address
  // must NOT: a 429 that only fires for real accounts is itself an enumeration
  // oracle, so a tripped address bucket gets the neutral reply and no email.
  const byIp = rateLimit(`forgot:ip:${clientIp(request)}`, 5, 60 * 60_000);
  if (!byIp.ok) {
    return json({ error: c.forgotRate }, { status: 429 });
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

  // Same uiLang-cookie read as login/signup, so a visitor who picked Spanish on
  // the landing or login page keeps it here.
  const [lang, setLang] = useState("en");
  useEffect(() => { try { const m = document.cookie.match(/(?:^|;\s*)uiLang=([^;]+)/); setLang((m && decodeURIComponent(m[1])) || localStorage.getItem("emLang") || (navigator.language || "en").slice(0, 2)); } catch { /* private mode */ } }, []);
  // The copy swaps client-side, so the DOCUMENT follows it — see login/signup.
  useEffect(() => { try { document.documentElement.lang = lang; document.documentElement.dir = lang === "ur" ? "rtl" : "ltr"; document.title = authCopy(lang).forgotTitle; } catch { /* SSR */ } }, [lang]);
  const c = authCopy(lang);

  // Kept so the success state can offer a one-tap "Resend link" (the form is
  // replaced by the confirmation, so the address would otherwise be lost).
  const [email, setEmail] = useState("");
  const busy = nav.state !== "idle";

  return (
    <div className="wb-auth wb-card">
      <style dangerouslySetInnerHTML={{ __html: AUTH_FX }} />
      <h1 className="wb-h1" style={{ marginTop: 0 }}>{sent ? c.forgotSentH1 : c.forgotH1}</h1>

      {!emailReady ? (
        <p className="wb-sub">{c.forgotOff.replace("{contact}", CONTACT)}</p>
      ) : sent ? (
        <>
          <p className="wb-sub">{sent}</p>
          <Form method="post">
            <input type="hidden" name="lang" value={lang} />
            <input type="hidden" name="email" value={email} />
            <button className="wb-btn ghost" type="submit" disabled={busy} aria-busy={busy}>
              {busy ? <span className="wb-busy"><span className="wb-busy-dot wb-busy-dot-dark" aria-hidden="true" />{c.forgotSending}</span> : c.forgotResend}
            </button>
          </Form>
        </>
      ) : (
        <>
          <p className="wb-sub" style={{ marginBottom: 6 }}>{c.forgotSub}</p>
          {error && <div className="wb-err" role="alert">{error}</div>}
          <Form method="post">
            <input type="hidden" name="lang" value={lang} />
            <label className="wb-lbl" htmlFor="fg-email">{c.emailLabel}</label>
            <input className="wb-in" id="fg-email" name="email" type="email" required autoComplete="email" placeholder={c.emailPlaceholder} value={email} onChange={(e) => setEmail(e.currentTarget.value)} autoFocus />
            <div style={{ marginTop: 18 }}>
              <button className="wb-btn" type="submit" disabled={busy} aria-busy={busy}>
                {busy ? <span className="wb-busy"><span className="wb-busy-dot" aria-hidden="true" />{c.forgotSending}</span> : c.forgotBtn}
              </button>
            </div>
          </Form>
        </>
      )}

      <p className="wb-note" style={{ marginTop: 16 }}>
        <Link to="/web/login">{c.backToLogin}</Link>
      </p>
    </div>
  );
}

/* Scoped bits the shared /web stylesheet doesn't carry: the button busy dot. */
const AUTH_FX = `
.wb-busy{display:inline-flex;align-items:center;gap:8px;}
.wb-busy-dot{width:13px;height:13px;border-radius:50%;border:2px solid rgba(255,255,255,.4);
  border-top-color:#fff;animation:wbBusySpin .7s linear infinite;}
.wb-busy-dot-dark{border-color:rgba(20,32,26,.25);border-top-color:var(--ink);}
@keyframes wbBusySpin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.wb-busy-dot{animation:none}}
`;
