/* Owner-only beta-tester provisioning — /admin/seed-beta (ADMIN_EMAILS session
 * or ?key=PURGE_KEY). Creates (or updates) ONE shared login the owner can hand
 * to beta testers: an active Legend plan, a huge non-expiring token balance
 * (effectively unlimited for testing), and a chosen content language. The owner
 * types the password into the form — it is sent in the POST body, never a URL,
 * and never echoed back. 404s for everyone who isn't the owner. */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { db } from "../db.server";
import { isOwner } from "../lib/admin.server";
import { createWebAccount, hashPassword } from "../lib/web-auth.server";
import { PLAN_BY_KEY } from "../lib/plan-config";
import { normalizeContentLang, CONTENT_LANG_NATIVE } from "../lib/content-lang";
import type { PlanType } from "@prisma/client";

export const meta = () => [{ title: "Seed beta · EasyMode" }];

// Effectively unlimited for a beta run — thousands of generations at 5–150
// tokens each. Re-run the form to top back up if a tester ever drains it.
const BETA_TOKENS = 10_000_000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!(await isOwner(request))) throw new Response("Not Found", { status: 404 });
  const origin = new URL(request.url).origin;
  return json({ origin });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!(await isOwner(request))) throw new Response("Not Found", { status: 404 });
  const origin = new URL(request.url).origin;
  const form = await request.formData();
  const email = ((form.get("email") as string) || "").trim().toLowerCase();
  const password = (form.get("password") as string) || "";
  const name = ((form.get("name") as string) || "").trim();
  const lang = normalizeContentLang((form.get("lang") as string) || "zh");

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false as const, error: "Enter a valid email." });
  if (password.length < 8) return json({ ok: false as const, error: "Password needs at least 8 characters." });

  try {
    // Create the account if new; otherwise reset its password to the one typed.
    let account = await db.account.findUnique({ where: { email } });
    let created = false;
    if (!account) {
      account = await createWebAccount(email, password, name || "Beta Tester", lang, undefined);
      created = true;
    } else {
      await db.account.update({ where: { id: account.id }, data: { passwordHash: await hashPassword(password), ...(name ? { name } : {}) } });
    }

    const conn = await db.connection.findFirst({ where: { accountId: account.id, kind: "web" } });
    if (!conn) return json({ ok: false as const, error: "Account has no web shop — unexpected." });
    const shopId = conn.externalId;
    await db.shop.update({ where: { id: shopId }, data: { contentLang: lang } });

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
      trialEndsAt: null, // no trial ceiling — full access for testing
    };
    await db.plan.upsert({
      where: { shopId },
      create: { shopId, reviewMode: "REVIEW_FIRST", periodStart: new Date(), ...planFields },
      update: planFields,
    });

    const entryLink = `${origin}/set-ui-lang?lang=${lang}&to=/web/login`;
    return json({
      ok: true as const,
      created,
      email,
      lang,
      langName: CONTENT_LANG_NATIVE[lang] || lang,
      tokens: BETA_TOKENS,
      entryLink,
    });
  } catch (e) {
    return json({ ok: false as const, error: e instanceof Error ? e.message : "Couldn't provision that account." });
  }
};

export default function SeedBeta() {
  const { origin } = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  return (
    <div className="sb-wrap">
      <style>{CSS}</style>
      <h1 className="sb-h1">Beta tester login</h1>
      <p className="sb-sub">
        Creates (or resets) one shared account with an active <b>Legend</b> plan and{" "}
        {BETA_TOKENS.toLocaleString()} tokens — effectively unlimited for testing. Share the login + the
        entry link below with your testers. Re-run anytime to reset the password or top the tokens back up.
      </p>

      {res && res.ok && (
        <div className="sb-ok">
          <div className="sb-ok-h">✓ {res.created ? "Account created" : "Account updated"} — ready to share</div>
          <table className="sb-tbl">
            <tbody>
              <tr><td>Login page</td><td><code>{origin}/web/login</code></td></tr>
              <tr><td>Email</td><td><code>{res.email}</code></td></tr>
              <tr><td>Password</td><td>the one you just typed (not shown here)</td></tr>
              <tr><td>Language</td><td>{res.langName}</td></tr>
              <tr><td>Tokens</td><td>{res.tokens.toLocaleString()} (unlimited for testing)</td></tr>
              <tr><td>Entry link (opens in {res.langName})</td><td><code>{res.entryLink}</code></td></tr>
            </tbody>
          </table>
          <p className="sb-tip">Send testers the <b>Entry link</b> — it sets the interface to {res.langName} and drops them on the login page. They can still switch languages anytime with the globe.</p>
        </div>
      )}
      {res && !res.ok && <div className="sb-err">{res.error}</div>}

      <Form method="post" className="sb-form">
        <label className="sb-lbl">Email
          <input className="sb-in" name="email" type="email" required placeholder="beta-zh@easymode.app" defaultValue="beta-zh@easymode.app" />
        </label>
        <label className="sb-lbl">Password (share this with testers)
          <input className="sb-in" name="password" type="text" required minLength={8} placeholder="8+ characters" autoComplete="off" />
        </label>
        <label className="sb-lbl">Display name (optional)
          <input className="sb-in" name="name" placeholder="Beta Tester" />
        </label>
        <label className="sb-lbl">Language
          <select className="sb-in" name="lang" defaultValue="zh">
            <option value="zh">中文 (Chinese)</option>
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="fr">Français</option>
            <option value="de">Deutsch</option>
          </select>
        </label>
        <button className="sb-btn" type="submit">Create / update beta login</button>
      </Form>
    </div>
  );
}

const CSS = `
.sb-wrap{max-width:620px;margin:0 auto;padding:32px 20px 64px;color:#14201A;font-family:Poppins,system-ui,sans-serif}
.sb-h1{font-size:26px;font-weight:700;margin:0 0 6px}
.sb-sub{color:#5a6b61;font-size:14px;line-height:1.6;margin:0 0 22px}
.sb-form{display:flex;flex-direction:column;gap:14px;background:#fff;border:1px solid #e3e9e4;border-radius:16px;padding:20px}
.sb-lbl{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600;color:#14201A}
.sb-in{font:inherit;font-weight:400;font-size:15px;padding:10px 12px;border:1px solid #d7ded8;border-radius:10px;background:#fff;color:#14201A}
.sb-in:focus{outline:none;border-color:#0C7A46;box-shadow:0 0 0 3px rgba(12,122,70,.12)}
.sb-btn{margin-top:4px;background:#0C7A46;color:#fff;border:0;border-radius:11px;padding:12px 18px;font:inherit;font-weight:700;font-size:15px;cursor:pointer}
.sb-btn:hover{background:#0a6a3c}
.sb-ok{background:#f0faf4;border:1px solid #bfe6cf;border-radius:14px;padding:16px 18px;margin-bottom:20px}
.sb-ok-h{font-weight:700;color:#0C7A46;margin-bottom:10px}
.sb-tbl{width:100%;border-collapse:collapse;font-size:13.5px}
.sb-tbl td{padding:5px 8px;vertical-align:top;border-bottom:1px solid #e0efe6}
.sb-tbl td:first-child{color:#5a6b61;white-space:nowrap;width:40%}
.sb-tbl code{background:#fff;border:1px solid #d7ded8;border-radius:6px;padding:1px 6px;font-size:12.5px;word-break:break-all}
.sb-tip{font-size:12.5px;color:#5a6b61;line-height:1.55;margin:10px 0 0}
.sb-err{background:#fdeceb;border:1px solid #f3c6c0;color:#a33;border-radius:12px;padding:12px 16px;margin-bottom:18px;font-size:14px}
`;
