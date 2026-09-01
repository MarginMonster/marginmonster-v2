import { json, type ActionFunctionArgs, type LoaderFunctionArgs, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";
import { useEffect, useState } from "react";
import { clientIp, rateLimit } from "../lib/rate-limit.server";
import { createWebAccount, getWebIdentity, webSessionRedirect, SignupError } from "../lib/web-auth.server";
import { isValidTimeZone } from "../lib/timezone";
import { authCopy } from "../lib/auth-i18n";

// Merchants keep several of these open at once; an untitled tab is just a URL.
export const meta = () => [{ title: "Start free · EasyMode" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (await getWebIdentity(request)) throw redirect("/web");
  return json({});
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const email = ((form.get("email") as string) || "").trim().toLowerCase();
  const password = (form.get("password") as string) || "";
  const name = ((form.get("name") as string) || "").trim();
  const lang = ((form.get("lang") as string) || "").trim() || undefined;
  // The merchant's own zone, so a drop scheduled for 7pm posts at 7pm where
  // they are rather than 7pm UTC. Validated server-side — this arrives from
  // the browser and is used to build instants.
  const rawTz = ((form.get("tz") as string) || "").trim();
  const timezone = isValidTimeZone(rawTz) ? rawTz : undefined;
  // The form posts the visitor's language, so a Spanish signup fails in Spanish.
  const c = authCopy(lang);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: c.errEmail });
  if (password.length < 8) return json({ error: c.errPassword });

  // Signing up is free and unverified, and each one creates an Account, a
  // Shop and a Connection, hashes a password on the shared thread pool, and
  // yields a session that can queue a sitemap crawl on the single serial
  // worker. Ten a day from one address is far beyond anything a real person
  // does and far below what an abuser needs.
  const gate = rateLimit(`signup:ip:${clientIp(request)}`, 10, 60 * 60_000);
  if (!gate.ok) {
    return json(
      { error: c.errRate },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } }
    );
  }
  try {
    const account = await createWebAccount(email, password, name || undefined, lang, timezone);
    return webSessionRedirect(account);
  } catch (e) {
    // Only messages we wrote go to the browser. Anything else — a Prisma
    // fault, a connection drop — is logged and answered generically, because
    // this endpoint is open to the internet.
    if (e instanceof SignupError) return json({ error: e.message });
    console.error("[signup] failed:", e);
    return json({ error: c.errGeneric });
  }
};

export default function WebSignup() {
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  // Seed the account's AI content language from the landing-page toggle.
  const [lang, setLang] = useState("en");
  const [tz, setTz] = useState("");
  useEffect(() => { try { setLang(localStorage.getItem("emLang") || (navigator.language || "en").slice(0, 2)); } catch { /* private mode */ } }, []);
  // Same idea as the language above: ask the browser once, at signup.
  useEffect(() => { try { setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || ""); } catch { /* older browser */ } }, []);
  // Same language the landing page was read in — see auth-i18n.
  const c = authCopy(lang);
  return (
    <div className="wb-auth wb-card">
      <h1 className="wb-h1" style={{ marginTop: 0 }}>{c.signupH1}</h1>
      <p className="wb-sub" style={{ marginBottom: 6 }}>{c.signupSub}</p>
      {actionData && "error" in actionData && <div className="wb-err">{actionData.error}</div>}
      <Form method="post">
        <input type="hidden" name="lang" value={lang} />
        <input type="hidden" name="tz" value={tz} />
        <label className="wb-lbl" htmlFor="su-name">{c.nameLabel}</label>
        <input className="wb-in" id="su-name" name="name" autoComplete="organization" placeholder={c.namePlaceholder} />
        <label className="wb-lbl" htmlFor="su-email">{c.emailLabel}</label>
        <input className="wb-in" id="su-email" name="email" type="email" required autoComplete="email" placeholder={c.emailPlaceholder} />
        <label className="wb-lbl" htmlFor="su-pw">{c.passwordLabel}</label>
        <input className="wb-in" id="su-pw" name="password" type="password" required minLength={8} autoComplete="new-password" placeholder={c.passwordPlaceholder} />
        <div style={{ marginTop: 18 }}>
          <button className="wb-btn" type="submit" disabled={nav.state !== "idle"}>
            {nav.state !== "idle" ? c.creating : c.createBtn}
          </button>
        </div>
      </Form>
      <p className="wb-note" style={{ marginTop: 14 }}>
        {c.consentPre}
        <a href="/terms" target="_blank" rel="noreferrer">{c.consentTerms}</a>
        {c.consentMid}
        <a href="/privacy" target="_blank" rel="noreferrer">{c.consentPrivacy}</a>.
      </p>
      <p className="wb-note" style={{ marginTop: 10 }}>
        {c.haveOne}<Link to="/web/login">{c.logInLink}</Link>
      </p>
    </div>
  );
}
