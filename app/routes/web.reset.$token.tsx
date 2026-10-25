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
import { useEffect, useState } from "react";
import { db } from "../db.server";
import { verifyPasswordReset } from "../lib/password-reset.server";
import { clientIp, rateLimit, rateLimitReset } from "../lib/rate-limit.server";
import { hashPassword, webSessionRedirect } from "../lib/web-auth.server";
import { authCopy, authLang } from "../lib/auth-i18n";
import { Ico } from "../lib/icons";

export const meta = () => [
  { title: "Choose a new password · EasyMode" },
  // The token is in the path, so keep it out of the Referer header on any
  // outbound click from this page.
  { name: "referrer", content: "no-referrer" },
];

const CONTACT = "hello@easymodeapp.com";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  // Seed the display language from the uiLang cookie SERVER-SIDE so the first
  // paint is already localized — no English-then-swap flash (and no Urdu
  // LTR→RTL flip). Same cookie + inline parse the landing loader uses, and it
  // reveals nothing about any account.
  const m = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)uiLang=([^;]+)/);
  // Otherwise returns nothing about the account: not the email, not the name.
  // A leaked link must not double as a profile lookup, and expiry must look
  // exactly like forgery so neither confirms an account exists.
  return json({ valid: !!(await verifyPasswordReset(params.token)), lang: authLang(m ? decodeURIComponent(m[1]) : "") });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const form = await request.formData();
  // Localise errors to the posted language, same as login/signup.
  const c = authCopy(form.get("lang"));
  // The MAC is 256-bit, so this is not the real defence — it is here because
  // the POST runs scrypt on libuv's four-thread pool, which the render
  // pipeline's file work shares.
  const gate = rateLimit(`reset:ip:${clientIp(request)}`, 20, 10 * 60_000);
  if (!gate.ok) {
    return json({ error: c.resetRate }, { status: 429 });
  }

  // Re-verified from the path, never from anything the form supplied.
  const account = await verifyPasswordReset(params.token);
  if (!account) return json({ error: c.resetDead });

  const password = (form.get("password") as string) || "";
  // Same rule as signup, so the two doors cannot disagree.
  if (password.length < 8) return json({ error: c.resetShortPw });

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
  if (applied.count !== 1) return json({ error: c.resetDead });

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
  const { valid, lang: cookieLang } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const error = actionData && "error" in actionData ? actionData.error : null;
  const orphaned = actionData && "orphaned" in actionData;

  // Seeded SERVER-SIDE from the uiLang cookie (loader) so SSR paints the right
  // language — this page is no longer stranded in English; the effect then
  // refines it from an explicit localStorage pick / browser language.
  const [lang, setLang] = useState<string>(cookieLang);
  useEffect(() => { try { const m = document.cookie.match(/(?:^|;\s*)uiLang=([^;]+)/); setLang((m && decodeURIComponent(m[1])) || localStorage.getItem("emLang") || (navigator.language || "en").slice(0, 2)); } catch { /* private mode */ } }, []);
  useEffect(() => { try { document.documentElement.lang = lang; document.documentElement.dir = lang === "ur" ? "rtl" : "ltr"; document.title = authCopy(lang).resetTitle; } catch { /* SSR */ } }, [lang]);
  const c = authCopy(lang);

  const busy = nav.state !== "idle";
  const [showPw, setShowPw] = useState(false);
  // Live length hint — this is the one password a merchant types blind, with
  // the account on the line, so unlike signup's onBlur hint it updates AS they
  // type: it appears only once they've started and clears the moment the 8th
  // character lands. Advisory; the server stays the source of truth.
  const [pwShort, setPwShort] = useState(false);

  if (orphaned) {
    return (
      <div className="wb-auth wb-card">
        <h1 className="wb-h1" style={{ marginTop: 0 }}>{c.resetChangedH1}</h1>
        <p className="wb-sub">{c.resetOrphan.replace("{contact}", CONTACT)}</p>
        <p className="wb-note" style={{ marginTop: 16 }}>
          <Link to="/web/login">{c.backToLogin}</Link>
        </p>
      </div>
    );
  }

  if (!valid) {
    return (
      <div className="wb-auth wb-card">
        <h1 className="wb-h1" style={{ marginTop: 0 }}>{c.resetExpiredH1}</h1>
        <p className="wb-sub">{c.resetDead}</p>
        <p className="wb-note" style={{ marginTop: 16 }}>
          <Link to="/web/forgot">{c.resetNewLink}</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="wb-auth wb-card">
      <style dangerouslySetInnerHTML={{ __html: AUTH_FX }} />
      <h1 className="wb-h1" style={{ marginTop: 0 }}>{c.resetH1}</h1>
      {error && <div className="wb-err" role="alert">{error}</div>}
      <Form method="post">
        <input type="hidden" name="lang" value={lang} />
        <label className="wb-lbl" htmlFor="rp-pw">{c.resetPwLabel}</label>
        <div className="wb-pw">
          <input
            className="wb-in"
            id="rp-pw"
            name="password"
            type={showPw ? "text" : "password"}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder={c.passwordPlaceholder}
            aria-invalid={pwShort ? true : undefined}
            aria-describedby={pwShort ? "rp-pw-hint" : undefined}
            onChange={(e) => setPwShort(e.currentTarget.value.length > 0 && e.currentTarget.value.length < 8)}
            autoFocus
          />
          <button type="button" className="wb-pw-eye" aria-label={showPw ? c.hidePw : c.showPw} aria-pressed={showPw} onClick={() => setShowPw((v) => !v)}>
            <Ico n="eye" size={18} />
          </button>
        </div>
        {pwShort && <div className="wb-hint" id="rp-pw-hint">{c.resetShortPw}</div>}
        <div style={{ marginTop: 18 }}>
          <button className="wb-btn" type="submit" disabled={busy} aria-busy={busy}>
            {busy ? <span className="wb-busy"><span className="wb-busy-dot" aria-hidden="true" />{c.resetSaving}</span> : c.resetBtn}
          </button>
        </div>
      </Form>
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
.wb-hint{margin-top:6px;font-size:12.5px;color:#7A2E1D;}
.wb-busy{display:inline-flex;align-items:center;gap:8px;}
.wb-busy-dot{width:13px;height:13px;border-radius:50%;border:2px solid rgba(255,255,255,.4);
  border-top-color:#fff;animation:wbBusySpin .7s linear infinite;}
@keyframes wbBusySpin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.wb-busy-dot{animation:none}}
`;
