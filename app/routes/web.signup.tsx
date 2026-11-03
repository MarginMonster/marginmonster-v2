import { json, type ActionFunctionArgs, type LoaderFunctionArgs, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { clientIp, rateLimit } from "../lib/rate-limit.server";
import { createWebAccount, getWebIdentity, webSessionRedirect, SignupError } from "../lib/web-auth.server";
import { isValidTimeZone } from "../lib/timezone";
import { authCopy, authLang } from "../lib/auth-i18n";
import { Ico } from "../lib/icons";

// Merchants keep several of these open at once; an untitled tab is just a URL.
export const meta = () => [{ title: "Start free · EasyMode" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (await getWebIdentity(request)) throw redirect("/web");
  // Seed the display language from the uiLang cookie SERVER-SIDE so the first
  // paint is already localized — no English-then-swap flash (and no Urdu
  // LTR→RTL flip) on a visitor who picked a language on the landing page.
  // Same cookie + inline parse the landing loader uses.
  const m = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)uiLang=([^;]+)/);
  return json({ lang: authLang(m ? decodeURIComponent(m[1]) : "") });
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
    // Tell the operator a new account signed up. Best-effort and never throws
    // (alertOps swallows its own failures), so it can't break or slow the
    // signup itself. One email per new email address per 30-min window.
    try {
      const { alertOps } = await import("../lib/ops-alert.server");
      await alertOps(`signup:${email}`, `New signup — ${email}`, [
        "A new account just signed up on EasyMode.",
        `Email: ${email}`,
        `Name: ${name || "(not given)"}`,
        `Language: ${lang || "en"}`,
        `When: ${new Date().toISOString()}`,
      ]);
    } catch { /* a notification must never fail a signup */ }
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
  const { lang: cookieLang } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  // Seeded SERVER-SIDE from the uiLang cookie (loader) so SSR paints the right
  // language; the effect then refines it from an explicit localStorage pick /
  // browser language if that disagrees — same shape as the landing page.
  const [lang, setLang] = useState<string>(cookieLang);
  const [tz, setTz] = useState("");
  useEffect(() => { try { const m = document.cookie.match(/(?:^|;\s*)uiLang=([^;]+)/); setLang((m && decodeURIComponent(m[1])) || localStorage.getItem("emLang") || (navigator.language || "en").slice(0, 2)); } catch { /* private mode */ } }, []);
  // Same idea as the language above: ask the browser once, at signup.
  useEffect(() => { try { setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || ""); } catch { /* older browser */ } }, []);
  // The copy swaps client-side, so the DOCUMENT has to follow it: a screen
  // reader given Spanish text inside lang="en" reads it with English rules,
  // and the tab kept the English title. The landing already does this.
  useEffect(() => { try { document.documentElement.lang = lang; document.documentElement.dir = lang === "ur" ? "rtl" : "ltr"; document.title = authCopy(lang).signupTitle; } catch { /* SSR */ } }, [lang]);
  // Same language the landing page was read in — see auth-i18n.
  const c = authCopy(lang);

  const busy = nav.state !== "idle";
  const error = actionData && "error" in actionData ? actionData.error : null;

  // Move focus to the error so a screen reader announces it, and so the
  // autoFocus on the first field doesn't fight the announcement.
  const errRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errRef.current?.focus(); }, [error]);

  const [showPw, setShowPw] = useState(false);
  // Light client-side hints, shown onBlur only (never while typing), so the
  // server stays the source of truth — these just save a round-trip.
  const [emailHint, setEmailHint] = useState<string | null>(null);
  const [pwHint, setPwHint] = useState<string | null>(null);

  return (
    <div className="wb-auth wb-card">
      <style dangerouslySetInnerHTML={{ __html: AUTH_FX }} />
      <h1 className="wb-h1" style={{ marginTop: 0 }}>{c.signupH1}</h1>
      <p className="wb-sub" style={{ marginBottom: 6 }}>{c.signupSub}</p>
      {error && <div className="wb-err" role="alert" tabIndex={-1} ref={errRef}>{error}</div>}
      <Form method="post">
        <input type="hidden" name="lang" value={lang} />
        <input type="hidden" name="tz" value={tz} />
        <label className="wb-lbl" htmlFor="su-name">{c.nameLabel} <span className="wb-opt">({c.nameOptional})</span></label>
        <input className="wb-in" id="su-name" name="name" autoComplete="organization" placeholder={c.namePlaceholder} autoFocus={!error} />
        <label className="wb-lbl" htmlFor="su-email">{c.emailLabel}</label>
        <input
          className="wb-in" id="su-email" name="email" type="email" required autoComplete="email" placeholder={c.emailPlaceholder}
          aria-invalid={emailHint ? true : undefined} aria-describedby={emailHint ? "su-email-hint" : undefined}
          onChange={() => emailHint && setEmailHint(null)}
          onBlur={(e) => setEmailHint(e.currentTarget.value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.currentTarget.value) ? c.errEmail : null)}
        />
        {emailHint && <div className="wb-hint" id="su-email-hint">{emailHint}</div>}
        <label className="wb-lbl" htmlFor="su-pw">{c.passwordLabel}</label>
        <div className="wb-pw">
          <input
            className="wb-in" id="su-pw" name="password" type={showPw ? "text" : "password"} required minLength={8} autoComplete="new-password" placeholder={c.passwordPlaceholder}
            aria-invalid={pwHint ? true : undefined} aria-describedby={pwHint ? "su-pw-hint" : undefined}
            onChange={() => pwHint && setPwHint(null)}
            onBlur={(e) => setPwHint(e.currentTarget.value && e.currentTarget.value.length < 8 ? c.errPassword : null)}
          />
          <button type="button" className="wb-pw-eye" aria-label={showPw ? c.hidePw : c.showPw} aria-pressed={showPw} onClick={() => setShowPw((v) => !v)}>
            <Ico n="eye" size={18} />
          </button>
        </div>
        {pwHint && <div className="wb-hint" id="su-pw-hint">{pwHint}</div>}
        <div style={{ marginTop: 18 }}>
          <button className="wb-btn" type="submit" disabled={busy} aria-busy={busy}>
            {busy ? <span className="wb-busy"><span className="wb-busy-dot" aria-hidden="true" />{c.creating}</span> : c.createBtn}
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

/* Scoped bits the shared /web stylesheet doesn't carry: the password eye, the
 * "(optional)" dimmer, the onBlur hint line, and the button busy dot. Kept
 * inline so these auth screens stay self-contained. */
const AUTH_FX = `
.wb-opt{font-weight:600;font-size:11.5px;color:var(--ink2);}
.wb-pw{position:relative;}
.wb-pw .wb-in{padding-right:44px;}
.wb-pw-eye{position:absolute;top:0;right:0;height:100%;width:42px;display:grid;place-items:center;
  border:0;background:none;cursor:pointer;color:var(--ink2);border-radius:0 11px 11px 0;}
.wb-pw-eye:hover{color:var(--green);}
[dir=rtl] .wb-pw .wb-in{padding-right:13px;padding-left:44px;}
[dir=rtl] .wb-pw-eye{right:auto;left:0;border-radius:11px 0 0 11px;}
.wb-hint{margin-top:6px;font-size:12.5px;color:#7A2E1D;}
.wb-busy{display:inline-flex;align-items:center;gap:8px;}
.wb-busy-dot{width:13px;height:13px;border-radius:50%;border:2px solid rgba(255,255,255,.4);
  border-top-color:#fff;animation:wbBusySpin .7s linear infinite;}
@keyframes wbBusySpin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.wb-busy-dot{animation:none}}
`;
