/* Owner-only members view — shows every web account that has signed up: who
 * they are, when they joined, what plan they're on, and their token/level
 * standing. This page shows real people's emails, so it is NEVER reachable
 * without proof you're the owner. Two ways in, EITHER of which unlocks it:
 *
 *   1. Be logged in on easymodeapp.com with an email listed in ADMIN_EMAILS
 *      (comma-separated). This is the easy path — log in, visit /admin/members.
 *   2. Append ?key=<PURGE_KEY> — the same shared diagnostics secret that gates
 *      /art-status and /api/diag.
 *
 * With NEITHER env set the route 404s for everyone, so its very existence
 * stays hidden by default. Read-only. */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { db } from "../db.server";
import { getWebIdentity } from "../lib/web-auth.server";
import type { PlanType } from "@prisma/client";

export const meta = () => [{ title: "Members · EasyMode" }];

/** True only for the owner: a logged-in session whose email is allow-listed in
 *  ADMIN_EMAILS, OR the shared PURGE_KEY secret in the URL. Both env values are
 *  unset by default, so the page is unreachable until one is configured. */
async function isOwner(request: Request): Promise<boolean> {
  const admins = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (admins.length) {
    const id = await getWebIdentity(request);
    if (id && admins.includes(id.account.email.toLowerCase())) return true;
  }
  const key = process.env.PURGE_KEY;
  if (key && new URL(request.url).searchParams.get("key") === key) return true;
  return false;
}

/** "Oct 11, 2026" — formatted on the server so SSR and the client agree. */
function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

type Row = {
  email: string;
  name: string;
  joined: string;
  joinedAt: number; // epoch ms, for the "new this week" tally only
  plan: string;
  planActive: boolean;
  trialing: boolean;
  paid: boolean;
  tokensUsed: number | null;
  tokensIncluded: number | null;
  tokensExtra: number | null;
  level: number | null;
  lifetimeSpent: number | null;
  store: string | null;
  lang: string | null;
  tz: string | null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Pure PII — reveal nothing (not even that the route exists) to non-owners.
  if (!(await isOwner(request))) throw new Response("Not Found", { status: 404 });

  // Every hub account, newest first, with its connections so we can find the
  // companion web Shop (Connection.externalId for kind "web" == Shop.id).
  const accounts = await db.account.findMany({
    orderBy: { createdAt: "desc" },
    include: { connections: true },
  });

  // Batch-load the shops (one query, not N) and their active plan.
  const shopIds = accounts
    .map((a) => a.connections.find((c) => c.kind === "web")?.externalId)
    .filter((x): x is string => !!x);
  const shops = await db.shop.findMany({
    where: { id: { in: shopIds } },
    include: { activePlan: true },
  });
  const shopById = new Map(shops.map((s) => [s.id, s]));

  const now = Date.now();
  const rows: Row[] = accounts.map((a) => {
    const shopId = a.connections.find((c) => c.kind === "web")?.externalId;
    const shop = shopId ? shopById.get(shopId) : undefined;
    const plan = shop?.activePlan ?? null;
    const trialing = !!(plan?.trialEndsAt && plan.trialEndsAt.getTime() > now);
    const planLabel = plan
      ? planName(plan.type) + (plan.active ? "" : " (inactive)")
      : "Free";
    return {
      email: a.email,
      name: a.name || "—",
      joined: fmtDate(a.createdAt),
      joinedAt: a.createdAt.getTime(),
      plan: planLabel,
      planActive: !!plan?.active,
      trialing,
      paid: !!a.stripeSubId,
      tokensUsed: plan ? plan.tokensUsed : null,
      tokensIncluded: plan ? plan.tokensIncluded : null,
      tokensExtra: plan ? plan.tokensExtra : null,
      level: shop ? shop.level : null,
      lifetimeSpent: shop ? shop.tokensSpent : null,
      store: shop?.storeUrl ?? null,
      lang: shop?.contentLang ?? null,
      tz: shop?.timezone ?? null,
    };
  });

  const weekAgo = now - 7 * 24 * 60 * 60_000;
  const summary = {
    total: rows.length,
    paid: rows.filter((r) => r.paid).length,
    trialing: rows.filter((r) => r.trialing).length,
    newThisWeek: rows.filter((r) => r.joinedAt >= weekAgo).length,
    generatedAt: fmtDate(new Date(now)),
  };

  return json({ rows, summary });
};

/** Human labels for the PlanType enum. */
function planName(t: PlanType): string {
  switch (t) {
    case "STARTER": return "Starter";
    case "STUDIO": return "Studio";
    case "ANTHEM": return "Legend";
    case "CREATOR": return "Creator";
    // Legacy ladder values still carried by some live rows.
    case "GROWTH": return "Growth (legacy)";
    case "PRO": return "Pro (legacy)";
    case "SCALE": return "Scale (legacy)";
    default: return String(t);
  }
}

export default function AdminMembers() {
  const { rows, summary } = useLoaderData<typeof loader>();
  return (
    <div className="am-wrap">
      <style>{CSS}</style>
      <header className="am-head">
        <h1 className="am-title">Members</h1>
        <p className="am-sub">Everyone who's signed up on EasyMode · as of {summary.generatedAt}</p>
      </header>

      <div className="am-cards">
        <Card label="Total members" value={summary.total} />
        <Card label="Paid" value={summary.paid} accent />
        <Card label="Trialing" value={summary.trialing} />
        <Card label="New this week" value={summary.newThisWeek} />
      </div>

      {rows.length === 0 ? (
        <p className="am-empty">No members yet.</p>
      ) : (
        <div className="am-tablewrap">
          <table className="am-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Email</th>
                <th>Name</th>
                <th>Joined</th>
                <th>Plan</th>
                <th>Tokens</th>
                <th>Lvl</th>
                <th>Lifetime</th>
                <th>Store</th>
                <th>Lang</th>
                <th>Timezone</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.email}>
                  <td className="am-num">{i + 1}</td>
                  <td className="am-email">{r.email}</td>
                  <td>{r.name}</td>
                  <td className="am-nowrap">{r.joined}</td>
                  <td>
                    <span className="am-plan">{r.plan}</span>
                    {r.paid && <span className="am-badge am-badge-paid">paid</span>}
                    {r.trialing && <span className="am-badge am-badge-trial">trial</span>}
                  </td>
                  <td className="am-nowrap">
                    {r.tokensIncluded == null ? (
                      "—"
                    ) : (
                      <>
                        {r.tokensUsed}/{r.tokensIncluded}
                        {r.tokensExtra ? <span className="am-extra"> +{r.tokensExtra}</span> : null}
                      </>
                    )}
                  </td>
                  <td className="am-num">{r.level ?? "—"}</td>
                  <td className="am-num">{r.lifetimeSpent ?? "—"}</td>
                  <td className="am-store">
                    {r.store ? (
                      <a href={r.store} target="_blank" rel="noreferrer">{hostOf(r.store)}</a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="am-nowrap">{(r.lang || "—").toUpperCase()}</td>
                  <td className="am-nowrap am-tz">{r.tz || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Card({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={"am-card" + (accent ? " am-card-accent" : "")}>
      <div className="am-card-val">{value}</div>
      <div className="am-card-lbl">{label}</div>
    </div>
  );
}

/** "example.com" from a URL, falling back to the raw string. */
function hostOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return url; }
}

const CSS = `
.am-wrap{max-width:1100px;margin:0 auto;padding:28px 18px 64px;color:#14201A;font-family:Poppins,system-ui,sans-serif}
.am-head{margin-bottom:18px}
.am-title{font-size:30px;font-weight:700;margin:0;letter-spacing:-.01em}
.am-sub{margin:4px 0 0;color:#5a6b61;font-size:14px}
.am-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px}
.am-card{background:#fff;border:1px solid #e3e9e4;border-radius:14px;padding:16px 18px}
.am-card-accent{background:#0C7A46;border-color:#0C7A46}
.am-card-accent .am-card-val,.am-card-accent .am-card-lbl{color:#fff}
.am-card-val{font-size:28px;font-weight:700;line-height:1}
.am-card-lbl{margin-top:6px;font-size:12px;color:#5a6b61;font-weight:500}
.am-tablewrap{background:#fff;border:1px solid #e3e9e4;border-radius:14px;overflow:auto}
.am-table{width:100%;border-collapse:collapse;font-size:13px}
.am-table th{text-align:left;padding:11px 12px;background:#f4f7f4;color:#5a6b61;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;border-bottom:1px solid #e3e9e4}
.am-table td{padding:10px 12px;border-bottom:1px solid #eef2ee;vertical-align:middle}
.am-table tr:last-child td{border-bottom:none}
.am-table tbody tr:hover{background:#fafcfa}
.am-num{text-align:right;font-variant-numeric:tabular-nums;color:#5a6b61}
.am-nowrap{white-space:nowrap}
.am-email{font-weight:600}
.am-plan{font-weight:600}
.am-extra{color:#0C7A46;font-weight:600}
.am-tz{color:#5a6b61;font-size:12px}
.am-store a{color:#0C7A46;text-decoration:none}
.am-store a:hover{text-decoration:underline}
.am-badge{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;vertical-align:middle}
.am-badge-paid{background:#0C7A46;color:#fff}
.am-badge-trial{background:#fdecc8;color:#8a5a00}
.am-empty{color:#5a6b61;font-size:15px;padding:40px 0;text-align:center}
@media (max-width:720px){.am-cards{grid-template-columns:repeat(2,1fr)}}
`;
