/* Owner-only beta-tester provisioning — /admin/seed-beta (ADMIN_EMAILS session
 * or ?key=PURGE_KEY). Creates (or resets) one or MANY private beta logins at
 * once: each gets its own account + shop (fully private — separate gallery,
 * tokens, everything), an active Legend plan, a huge non-expiring token balance
 * (effectively unlimited for testing), and a chosen content language.
 *
 * Beta testers log in with their OWN email + password, so they can never see
 * another tester's work — and because their email isn't in ADMIN_EMAILS, every
 * /admin/* page 404s for them. Passwords are auto-generated per account (or a
 * shared one, your choice) and shown ONCE here for you to distribute. 404s for
 * everyone who isn't the owner. */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import crypto from "node:crypto";
import { db } from "../db.server";
import { isOwner } from "../lib/admin.server";
import { createWebAccount, hashPassword } from "../lib/web-auth.server";
import { PLAN_BY_KEY } from "../lib/plan-config";
import { normalizeContentLang, CONTENT_LANG_NATIVE } from "../lib/content-lang";
import type { PlanType } from "@prisma/client";

export const meta = () => [{ title: "Seed beta · EasyMode" }];

// Effectively unlimited for a beta run — thousands of generations at 5–150
// tokens each. Re-run for a tester to top back up if they ever drain it.
const BETA_TOKENS = 10_000_000;
const MAX_BATCH = 50;

// Readable random password, no ambiguous characters (0/O, 1/l/I).
const PW_ALPHA = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
function genPassword(len = 12): string {
  const b = crypto.randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += PW_ALPHA[b[i] % PW_ALPHA.length];
  return s;
}

// forceLang: a language code to pre-set the tester's content language to, or
// null to leave it unset — the tester then picks their own UI language (globe
// pill, on the login page and the app) and output language ("Writing in" chip).
async function provisionBeta(email: string, password: string, forceLang: string | null): Promise<boolean> {
  let account = await db.account.findUnique({ where: { email } });
  let created = false;
  if (!account) {
    account = await createWebAccount(email, password, "Beta Tester", forceLang || undefined, undefined);
    created = true;
  } else {
    await db.account.update({ where: { id: account.id }, data: { passwordHash: await hashPassword(password) } });
  }
  const conn = await db.connection.findFirst({ where: { accountId: account.id, kind: "web" } });
  if (!conn) throw new Error("account has no web shop");
  const shopId = conn.externalId;
  if (forceLang) await db.shop.update({ where: { id: shopId }, data: { contentLang: forceLang } });

  const tier = PLAN_BY_KEY["ANTHEM"];
  const planFields = {
    type: "ANTHEM" as PlanType,
    active: true,
    creatorAddon: true,
    cancelAtPeriodEnd: false,
    blogQuota: tier.blogQuota,
    videoQuota: tier.videoQuota,
    imageQuota: tier.imageQuota,
    adCreativePack: true,
    campaignAutopilot: tier.campaignAutopilot,
    tokensIncluded: tier.monthlyTokens,
    tokensUsed: 0,
    tokensExtra: BETA_TOKENS,
    trialEndsAt: null,
  };
  await db.plan.upsert({
    where: { shopId },
    create: { shopId, reviewMode: "REVIEW_FIRST", periodStart: new Date(), ...planFields },
    update: planFields,
  });
  return created;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!(await isOwner(request))) throw new Response("Not Found", { status: 404 });
  return json({ origin: new URL(request.url).origin });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!(await isOwner(request))) throw new Response("Not Found", { status: 404 });
  const origin = new URL(request.url).origin;
  const form = await request.formData();
  const raw = ((form.get("emails") as string) || "");
  const sharedPw = ((form.get("password") as string) || "").trim();
  // Empty = "let the tester choose" (don't force a language). Otherwise a code.
  const rawLang = ((form.get("lang") as string) || "").trim();
  const forceLang = rawLang === "" ? null : normalizeContentLang(rawLang);

  if (sharedPw && sharedPw.length < 8) {
    return json({ ok: false as const, error: "A shared password needs at least 8 characters (or leave it blank to auto-generate)." });
  }

  // Parse + validate + dedupe the email list.
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const line of raw.split(/[\r\n,]+/)) {
    const e = line.trim().toLowerCase();
    if (!e) continue;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return json({ ok: false as const, error: `Not a valid email: "${e}"` });
    if (!seen.has(e)) { seen.add(e); emails.push(e); }
  }
  if (emails.length === 0) return json({ ok: false as const, error: "Add at least one email (one per line)." });
  if (emails.length > MAX_BATCH) return json({ ok: false as const, error: `That's ${emails.length} emails — cap is ${MAX_BATCH} at a time.` });

  const results: Array<{ email: string; password: string; created: boolean; error?: string }> = [];
  for (const email of emails) {
    const password = sharedPw || genPassword();
    try {
      const created = await provisionBeta(email, password, forceLang);
      results.push({ email, password, created });
    } catch (e) {
      results.push({ email, password: "", created: false, error: e instanceof Error ? e.message : "failed" });
    }
  }

  // Audit trail / abuse tripwire: this page is owner-gated, so the only person
  // who can ever reach it is you — but alert on every provisioning anyway. If
  // one of these ever lands in your inbox that you did NOT trigger, your admin
  // access has been compromised and you should rotate ADMIN_EMAILS + password.
  const okEmails = results.filter((r) => !r.error).map((r) => r.email);
  if (okEmails.length) {
    try {
      const { alertOps } = await import("../lib/ops-alert.server");
      const who = (await isOwner(request)) ? "an admin" : "someone"; // always "an admin" — gate above guarantees it
      await alertOps(
        "beta-provision",
        `Beta logins provisioned (${okEmails.length})`,
        [
          `${okEmails.length} unlimited beta account(s) were provisioned via /admin/seed-beta by ${who}.`,
          `Emails: ${okEmails.join(", ")}`,
          `Language: ${forceLang || "tester's choice"}`,
          "If you did NOT just do this, your admin access may be compromised — rotate ADMIN_EMAILS and your login immediately.",
          `When: ${new Date().toISOString()}`,
        ],
      );
    } catch { /* an alert must never fail the provisioning */ }
  }

  return json({
    ok: true as const,
    results,
    forced: !!forceLang,
    langName: forceLang ? (CONTENT_LANG_NATIVE[forceLang] || forceLang) : null,
    loginUrl: `${origin}/web/login`,
    entryLink: forceLang ? `${origin}/set-ui-lang?lang=${forceLang}&to=/web/login` : `${origin}/web/login`,
    sharedPw: !!sharedPw,
  });
};

export default function SeedBeta() {
  const { origin } = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  return (
    <div className="sb-wrap">
      <style>{CSS}</style>
      <h1 className="sb-h1">Beta tester logins</h1>
      <p className="sb-sub">
        Each email below becomes its own <b>private</b> account — separate gallery, tokens and work — with an active
        <b> Legend</b> plan and {BETA_TOKENS.toLocaleString()} tokens (unlimited for testing). Testers log in with their own
        email + password, so they never see each other's work. And because their email isn't on the admin list, every
        <code> /admin</code> page simply 404s for them — they can't reach this dashboard. Re-run any email to reset its
        password or refill its tokens.
      </p>
      <p className="sb-sub" style={{ marginTop: -12 }}>
        Each tester uses <b>whatever language they want</b> — the globe at the top of the login page and the app
        switches the whole interface, and the “Writing in” chip in the Studio sets what the AI writes. Pick a
        starting language below, or leave it on “let each tester choose”.
      </p>

      {res && res.ok && (
        <div className="sb-ok">
          <div className="sb-ok-h">✓ {res.results.filter((r) => !r.error).length} account(s) ready — copy the logins below</div>
          <div className="sb-links">
            <div><span>Login page</span><code>{res.loginUrl}</code></div>
            <div><span>Entry link{res.forced ? ` (opens in ${res.langName})` : ""}</span><code>{res.entryLink}</code></div>
          </div>
          <table className="sb-tbl">
            <thead><tr><th>Email</th><th>Password</th><th>Status</th></tr></thead>
            <tbody>
              {res.results.map((r) => (
                <tr key={r.email} className={r.error ? "sb-row-err" : ""}>
                  <td><code>{r.email}</code></td>
                  <td>{r.error ? "—" : <code>{r.password}</code>}</td>
                  <td>{r.error ? `failed: ${r.error}` : r.created ? "created" : "reset"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="sb-copylbl">Copy-and-send block (one tester per line):</p>
          <pre className="sb-pre">{res.results.filter((r) => !r.error).map((r) => `${r.email}  —  ${r.password}`).join("\n")}
{"\n"}Sign in: {res.loginUrl}{res.forced ? `\nOr open straight into ${res.langName}: ${res.entryLink}` : ""}</pre>
          <p className="sb-tip">Send each tester their own email + password. {res.forced ? `The entry link opens in ${res.langName}, but ` : "On the login page "}they can pick any language with the globe at the top, and the “Writing in” chip in the Studio sets what the AI writes.</p>
        </div>
      )}
      {res && !res.ok && <div className="sb-err">{res.error}</div>}

      <Form method="post" className="sb-form">
        <label className="sb-lbl">Tester emails — one per line
          <textarea className="sb-in sb-ta" name="emails" rows={6} required placeholder={"tester1@example.com\ntester2@example.com\ntester3@example.com"} />
        </label>
        <label className="sb-lbl">Shared password (optional)
          <input className="sb-in" name="password" type="text" autoComplete="off" placeholder="leave blank to auto-generate a unique password per tester" />
        </label>
        <label className="sb-lbl">Starting language
          <select className="sb-in" name="lang" defaultValue="">
            <option value="">Let each tester choose (recommended)</option>
            <option value="zh">中文 (Chinese)</option>
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="fr">Français</option>
            <option value="de">Deutsch</option>
          </select>
        </label>
        <button className="sb-btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create / reset beta logins"}</button>
      </Form>
    </div>
  );
}

const CSS = `
.sb-wrap{max-width:680px;margin:0 auto;padding:32px 20px 64px;color:#14201A;font-family:Poppins,system-ui,sans-serif}
.sb-h1{font-size:26px;font-weight:700;margin:0 0 6px}
.sb-sub{color:#5a6b61;font-size:13.5px;line-height:1.6;margin:0 0 22px}
.sb-sub code{background:#eef2ee;border-radius:5px;padding:1px 5px;font-size:12.5px}
.sb-form{display:flex;flex-direction:column;gap:14px;background:#fff;border:1px solid #e3e9e4;border-radius:16px;padding:20px}
.sb-lbl{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600;color:#14201A}
.sb-in{font:inherit;font-weight:400;font-size:15px;padding:10px 12px;border:1px solid #d7ded8;border-radius:10px;background:#fff;color:#14201A}
.sb-ta{resize:vertical;line-height:1.5;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13.5px}
.sb-in:focus{outline:none;border-color:#0C7A46;box-shadow:0 0 0 3px rgba(12,122,70,.12)}
.sb-btn{margin-top:4px;background:#0C7A46;color:#fff;border:0;border-radius:11px;padding:12px 18px;font:inherit;font-weight:700;font-size:15px;cursor:pointer}
.sb-btn:hover{background:#0a6a3c}.sb-btn:disabled{opacity:.6;cursor:default}
.sb-ok{background:#f0faf4;border:1px solid #bfe6cf;border-radius:14px;padding:16px 18px;margin-bottom:20px}
.sb-ok-h{font-weight:700;color:#0C7A46;margin-bottom:12px}
.sb-links{display:flex;flex-direction:column;gap:6px;margin-bottom:12px;font-size:13px}
.sb-links span{color:#5a6b61;margin-right:8px}
.sb-links code,.sb-tbl code{background:#fff;border:1px solid #d7ded8;border-radius:6px;padding:1px 6px;font-size:12.5px;word-break:break-all}
.sb-tbl{width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:12px}
.sb-tbl th{text-align:left;padding:6px 8px;background:#e8f4ec;color:#5a6b61;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.sb-tbl td{padding:6px 8px;border-bottom:1px solid #e0efe6;vertical-align:top}
.sb-row-err{color:#a33}
.sb-copylbl{font-size:12px;font-weight:600;color:#5a6b61;margin:4px 0 6px}
.sb-pre{background:#14201A;color:#e8f0ea;border-radius:10px;padding:12px 14px;font-size:12.5px;line-height:1.6;white-space:pre-wrap;word-break:break-all;overflow-x:auto;margin:0}
.sb-tip{font-size:12.5px;color:#5a6b61;line-height:1.55;margin:10px 0 0}
.sb-err{background:#fdeceb;border:1px solid #f3c6c0;color:#a33;border-radius:12px;padding:12px 16px;margin-bottom:18px;font-size:14px}
`;
