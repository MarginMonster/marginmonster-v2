/* Owner-only token grant, for testing against the real pipelines.
 *
 * DORMANT BY DEFAULT: with DEV_GRANT_KEY unset this route 404s, so it does not
 * exist in production unless someone deliberately turns it on. When it is set,
 * the request must carry the key AND be a logged-in web session — a grant can
 * only ever touch the wallet of the account making the request, never anyone
 * else's. Every grant is logged.
 *
 * The trial cap is the reason this needs real code rather than a SQL one-liner:
 * tokensRemainingLive() hard-caps the wallet at TRIAL_TOKEN_CAP while
 * trialEndsAt is in the future, so topping up tokensExtra during a trial
 * changes nothing visible. Granting therefore ends the trial window too. */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { requireWebIdentity } from "../lib/web-auth.server";
import crypto from "node:crypto";
import { db } from "../db.server";
import { tokensRemainingLive, planTrialing } from "../lib/tokens.server";

/** Constant-time compare, so the 404 tells an attacker nothing about how much
 *  of the key they guessed right. Same reasoning as the DUMMY_HASH in
 *  web-auth.server.ts — this codebase already closed one timing oracle. */
function keyMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function assertEnabled(request: Request): void {
  const key = process.env.DEV_GRANT_KEY;
  // Not configured → this route genuinely does not exist.
  if (!key) throw new Response("Not Found", { status: 404 });
  // A header is preferred over ?key= because query strings are recorded by
  // access logs, proxies and browser history, and leak through Referer on any
  // outbound link. The query form stays so opening the page in a browser still
  // works, which is the whole point of this route.
  const given = request.headers.get("x-dev-grant-key") || new URL(request.url).searchParams.get("key") || "";
  if (!keyMatches(given, key)) throw new Response("Not Found", { status: 404 });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  assertEnabled(request);
  const { account, shop } = await requireWebIdentity(request);
  const plan = shop.activePlan;
  return json({
    email: account.email,
    hasPlan: !!plan,
    planType: plan?.type ?? null,
    trialing: planTrialing(plan),
    balance: tokensRemainingLive(plan),
    raw: plan
      ? { included: plan.tokensIncluded, used: plan.tokensUsed, extra: plan.tokensExtra }
      : null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  assertEnabled(request);
  const { account, shop } = await requireWebIdentity(request);
  const form = await request.formData();
  const amount = Math.max(0, Math.min(100_000, Number(form.get("amount") || 0)));
  if (!amount) return json({ error: "Pick an amount." });

  const plan = await db.plan.findUnique({ where: { shopId: shop.id } });
  if (!plan) {
    return json({ error: "No plan on this account yet — pick one on the Dashboard first, then grant." });
  }

  await db.plan.update({
    where: { id: plan.id },
    data: {
      tokensExtra: { increment: amount },
      // Without this the grant is invisible: the trial cap ignores tokensExtra.
      ...(planTrialing(plan) ? { trialEndsAt: null } : {}),
      active: true,
    },
  });
  console.log(`[dev-grant] +${amount} tokens to ${account.email} (shop ${shop.id})`);

  const after = await db.plan.findUnique({ where: { shopId: shop.id } });
  return json({ ok: `Granted ${amount.toLocaleString("en-US")} tokens.`, balance: tokensRemainingLive(after) });
};

export default function WebDev() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>() as { ok?: string; error?: string; balance?: number } | undefined;
  return (
    <div className="wb-card" style={{ maxWidth: 520, margin: "18px auto" }}>
      <h1 className="wb-h1" style={{ fontSize: 22, marginTop: 0 }}>🔧 Token grant</h1>
      <p className="wb-sub" style={{ marginBottom: 14 }}>
        Testing tool for <b>{d.email}</b>. Grants land on this account only.
      </p>

      {a?.ok && <div className="wb-ok">{a.ok} New balance: <b>{a.balance?.toLocaleString("en-US")}</b></div>}
      {a?.error && <div className="wb-err">{a.error}</div>}

      <div className="ws-note" style={{ marginBottom: 12 }}>
        Balance <b>{d.balance.toLocaleString("en-US")}</b>
        {d.raw && <> · allowance {d.raw.included.toLocaleString("en-US")}, used {d.raw.used.toLocaleString("en-US")}, top-up {d.raw.extra.toLocaleString("en-US")}</>}
        <br />
        Plan: {d.hasPlan ? d.planType : "none"}{d.trialing ? " · trialing (wallet is capped — granting ends the trial)" : ""}
      </div>

      <Form method="post" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[500, 1000, 5000, 20000].map((n) => (
          <button key={n} className="wb-btn" name="amount" value={n} style={{ padding: "11px 16px", fontSize: 13 }}>
            +{n.toLocaleString("en-US")}
          </button>
        ))}
      </Form>

      <p className="wb-note" style={{ marginTop: 14 }}>
        This page only exists while <code>DEV_GRANT_KEY</code> is set in the environment and the
        matching <code>?key=</code> is present. Unset the variable to make it 404 again.
      </p>
    </div>
  );
}
