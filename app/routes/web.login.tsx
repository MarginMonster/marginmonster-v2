import { json, type ActionFunctionArgs, type LoaderFunctionArgs, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { db } from "../db.server";
import { clientIp, rateLimit, rateLimitReset } from "../lib/rate-limit.server";
import { isValidTimeZone } from "../lib/timezone";
import { getWebIdentity, loginWebAccount, webSessionRedirect } from "../lib/web-auth.server";
import { authCopy } from "../lib/auth-i18n";
import { Ico } from "../lib/icons";

// Merchants keep several of these open at once; an untitled tab is just a URL.
export const meta = () => [{ title: "Log in · EasyMode" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (await getWebIdentity(request)) throw redirect("/web");
  return json({});
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const email = ((form.get("email") as string) || "").trim().toLowerCase();
  const password = (form.get("password") as string) || "";

  // Two limits, because they stop different things.
  //
  // Per address: credential stuffing works by trying many passwords against
  // one account, and nothing here slowed that down.
  //
  // Per source: verifying a password runs scrypt, which is expensive on
  // purpose and runs on libuv's four-thread pool — the same pool the render
  // pipeline's file work uses. A burst of login attempts was therefore enough
  // to stall every other tenant's jobs without any code looking slow.
  const ip = clientIp(request);
  const byIp = rateLimit(`login:ip:${ip}`, 20, 10 * 60_000);
  const byEmail = email ? rateLimit(`login:acct:${email}`, 8, 10 * 60_000) : { ok: true, retryAfterSec: 0 };
  if (!byIp.ok || !byEmail.ok) {
    const wait = Math.max(byIp.retryAfterSec, byEmail.retryAfterSec);
    const mins = Math.ceil(wait / 60);
    // Localised to the posted language, same as the bad-login message below.
    const msg = authCopy(form.get("lang")).errLoginRate
      .replace("{n}", String(mins))
      .replace("{s}", mins > 1 ? "s" : "");
    return json(
      { error: msg },
      { status: 429, headers: { "Retry-After": String(wait) } }
    );
  }

  const account = await loginWebAccount(email, password);
  // the form posts the browser's language so the failure speaks it too
  if (!account) return json({ error: authCopy(form.get("lang")).errBadLogin });
  // Someone who got in was never the threat — don't leave them throttled by
  // their own mistyped attempts.
  rateLimitReset(`login:acct:${email}`);

  // BACKFILL THE TIMEZONE, ONCE.
  //
  // Everyone who signed up before the scheduler learned about timezones has
  // none stored, and would sit on the UTC fallback forever with nothing in the
  // UI to change it. The browser knows, and login is the one moment we hear
  // from it. Written ONLY when the column is null — overwriting on every
  // login would move a merchant's whole posting schedule the first time they
  // opened the app from an airport.
  const rawTz = ((form.get("tz") as string) || "").trim();
  if (isValidTimeZone(rawTz)) {
    try {
      const conn = await db.connection.findFirst({ where: { accountId: account.id, kind: "web" } });
      if (conn) {
        await db.shop.updateMany({
          where: { id: conn.externalId, timezone: null },
          data: { timezone: rawTz },
        });
      }
    } catch (e) {
      console.error("[login] timezone backfill failed (non-fatal):", e);
    }
  }
  return webSessionRedirect(account);
};

export default function WebLogin() {
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  // Same one-line ask as signup — see the backfill in the action.
  const [tz, setTz] = useState("");
  useEffect(() => { try { setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || ""); } catch { /* older browser */ } }, []);
  // The landing page stores the visitor's choice; honour it here too.
  const [lang, setLang] = useState("en");
  useEffect(() => { try { const m = document.cookie.match(/(?:^|;\s*)uiLang=([^;]+)/); setLang((m && decodeURIComponent(m[1])) || localStorage.getItem("emLang") || (navigator.language || "en").slice(0, 2)); } catch { /* private mode */ } }, []);
  // The copy swaps client-side, so the DOCUMENT has to follow it: a screen
  // reader given Spanish text inside lang="en" reads it with English rules,
  // and the tab kept the English title. The landing already does this.
  useEffect(() => { try { document.documentElement.lang = lang; document.documentElement.dir = lang === "ur" ? "rtl" : "ltr"; document.title = authCopy(lang).loginTitle; } catch { /* SSR */ } }, [lang]);
  const c = authCopy(lang);

  const busy = nav.state !== "idle";
  const error = actionData && "error" in actionData ? actionData.error : null;

  // Move focus to the error so a screen reader announces it, and so the
  // autoFocus on the email field doesn't fight the announcement.
  const errRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errRef.current?.focus(); }, [error]);

  const [showPw, setShowPw] = useState(false);

  return (
    <div className="wb-auth wb-card">
      <style dangerouslySetInnerHTML={{ __html: AUTH_FX }} />
      <h1 className="wb-h1" style={{ marginTop: 0 }}>{c.loginH1}</h1>
      <p className="wb-sub" style={{ marginBottom: 6 }}>{c.loginSub}</p>
      {error && <div className="wb-err" role="alert" tabIndex={-1} ref={errRef}>{error}</div>}
      <Form method="post">
        <input type="hidden" name="tz" value={tz} />
        <input type="hidden" name="lang" value={lang} />
        <label className="wb-lbl" htmlFor="li-email">{c.emailLabel}</label>
        <input className="wb-in" id="li-email" name="email" type="email" required autoComplete="email" placeholder={c.emailPlaceholder} autoFocus={!error} />
        <label className="wb-lbl" htmlFor="li-pw">{c.passwordLabel}</label>
        <div className="wb-pw">
          <input className="wb-in" id="li-pw" name="password" type={showPw ? "text" : "password"} required autoComplete="current-password" placeholder={c.passwordPlaceholder} />
          <button type="button" className="wb-pw-eye" aria-label={showPw ? c.hidePw : c.showPw} aria-pressed={showPw} onClick={() => setShowPw((v) => !v)}>
            <Ico n="eye" size={18} />
          </button>
        </div>
        <div style={{ marginTop: 18 }}>
          <button className="wb-btn" type="submit" disabled={busy} aria-busy={busy}>
            {busy ? <span className="wb-busy"><span className="wb-busy-dot" aria-hidden="true" />{c.loggingIn}</span> : c.loginBtn}
          </button>
        </div>
      </Form>
      <p className="wb-note" style={{ marginTop: 16 }}>
        <Link to="/web/forgot">{c.forgot}</Link>
      </p>
      <p className="wb-note" style={{ marginTop: 8 }}>
        {c.newHere}<Link to="/web/signup">{c.createLink}</Link>
      </p>
    </div>
  );
}

/* Scoped bits the shared /web stylesheet doesn't carry: the password eye and
 * the button busy dot. Kept inline so these auth screens stay self-contained. */
const AUTH_FX = `
.wb-pw{position:relative;}
.wb-pw .wb-in{padding-right:44px;}
.wb-pw-eye{position:absolute;top:0;right:0;height:100%;width:42px;display:grid;place-items:center;
  border:0;background:none;cursor:pointer;color:var(--ink2);border-radius:0 11px 11px 0;}
.wb-pw-eye:hover{color:var(--green);}
[dir=rtl] .wb-pw .wb-in{padding-right:13px;padding-left:44px;}
[dir=rtl] .wb-pw-eye{right:auto;left:0;border-radius:11px 0 0 11px;}
.wb-busy{display:inline-flex;align-items:center;gap:8px;}
.wb-busy-dot{width:13px;height:13px;border-radius:50%;border:2px solid rgba(255,255,255,.4);
  border-top-color:#fff;animation:wbBusySpin .7s linear infinite;}
@keyframes wbBusySpin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.wb-busy-dot{animation:none}}
`;
