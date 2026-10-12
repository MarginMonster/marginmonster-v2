/* Owner-only dev dashboard — /admin/dashboard (ADMIN_EMAILS session or
 * ?key=PURGE_KEY). The at-a-glance health of easymodeapp.com: users, active
 * users, recurring revenue, token-pack revenue, an ESTIMATED AI cost, and what
 * people are actually making. Read-only; 404s for everyone who isn't the owner.
 *
 * Revenue figures are real (plan tiers + pack prices). The AI-cost figure is a
 * rough ESTIMATE (per-asset blended COGS) and is labeled as such — actual spend
 * lives with the providers, not in our DB. */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { db } from "../db.server";
import { isOwner } from "../lib/admin.server";
import { PLAN_BY_KEY, resolveTierKey } from "../lib/plan-config";

export const meta = () => [{ title: "Dev dashboard · EasyMode" }];

// Rough blended AI cost per generated asset, in USD. ESTIMATES from provider
// pricing (image models, HeyGen/Kling video, musicgen, text) — tune freely.
const COGS: Record<string, number> = {
  IMAGE_AD: 0.06,
  VIDEO_AD: 1.2,
  AUDIO: 0.03,
  BLOG_POST: 0.02,
  AD_COPY: 0.004,
  EMAIL: 0.004,
};
// tokens bought → what that pack costs (web packs store amountUsd:0, so we
// price by size instead). Mirrors TOKEN_PACKS in plan-config.
const PACK_PRICE: Record<number, number> = { 50: 4.99, 250: 25, 750: 60, 2000: 140 };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!(await isOwner(request))) throw new Response("Not Found", { status: 404 });

  const now = Date.now();
  const d1 = new Date(now - 1 * 86_400_000);
  const d7 = new Date(now - 7 * 86_400_000);
  const d30 = new Date(now - 30 * 86_400_000);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  // Web user universe: accounts + their companion web shops (with the plan).
  const accounts = await db.account.findMany({ include: { connections: true } });
  const shopIds = accounts
    .map((a) => a.connections.find((c) => c.kind === "web")?.externalId)
    .filter((x): x is string => !!x);
  const shops = await db.shop.findMany({ where: { id: { in: shopIds } }, include: { activePlan: true } });
  const shopById = new Map(shops.map((s) => [s.id, s]));

  let paying = 0, trialing = 0, active7 = 0, active30 = 0, lifetimeTokensSpent = 0;
  let mrr = 0;
  const planCounts: Record<string, number> = {};
  for (const a of accounts) {
    const shopId = a.connections.find((c) => c.kind === "web")?.externalId;
    const shop = shopId ? shopById.get(shopId) : undefined;
    if (shop) {
      lifetimeTokensSpent += shop.tokensSpent;
      if (shop.updatedAt >= d7) active7++;
      if (shop.updatedAt >= d30) active30++;
    }
    const plan = shop?.activePlan;
    const tier = plan?.active ? resolveTierKey(plan.type) : null;
    const trial = !!(plan?.trialEndsAt && plan.trialEndsAt.getTime() > now);
    // Paying = a real Stripe subscription on an active, non-trial plan.
    if (a.stripeSubId && plan?.active && !trial && tier) {
      paying++;
      mrr += PLAN_BY_KEY[tier].price;
      planCounts[PLAN_BY_KEY[tier].name] = (planCounts[PLAN_BY_KEY[tier].name] || 0) + 1;
    } else if (trial) {
      trialing++;
    }
  }

  // Token-pack revenue (priced by pack size). Lifetime + this month.
  const packs = await db.tokenPurchase.findMany({ select: { tokens: true, amountUsd: true, createdAt: true } });
  const priceOf = (p: { tokens: number; amountUsd: number }) => PACK_PRICE[p.tokens] ?? p.amountUsd ?? 0;
  const packRevLifetime = packs.reduce((s, p) => s + priceOf(p), 0);
  const packRevMonth = packs.filter((p) => p.createdAt >= monthStart).reduce((s, p) => s + priceOf(p), 0);

  // Content made — counts by type, lifetime + this month, + estimated cost.
  const byType = await db.asset.groupBy({ by: ["type"], _count: { _all: true } });
  const byTypeMonth = await db.asset.groupBy({ by: ["type"], _count: { _all: true }, where: { createdAt: { gte: monthStart } } });
  const monthCount: Record<string, number> = {};
  for (const r of byTypeMonth) monthCount[r.type] = r._count._all;
  const content = byType
    .map((r) => ({ type: r.type, total: r._count._all, month: monthCount[r.type] || 0, cost: (COGS[r.type] ?? 0) }))
    .sort((a, b) => b.total - a.total);
  const totalAssets = content.reduce((s, c) => s + c.total, 0);
  const estCostLifetime = content.reduce((s, c) => s + c.total * c.cost, 0);
  const estCostMonth = content.reduce((s, c) => s + c.month * c.cost, 0);

  const [activeQuestlines, activeSeries] = await Promise.all([
    db.questline.count({ where: { status: "ACTIVE" } }),
    db.creatorSeries.count({ where: { status: "ACTIVE" } }),
  ]);

  const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  return json({
    users: {
      total: accounts.length,
      new1: accounts.filter((a) => a.createdAt >= d1).length,
      new7: accounts.filter((a) => a.createdAt >= d7).length,
      new30: accounts.filter((a) => a.createdAt >= d30).length,
      paying,
      trialing,
      active7,
      active30,
    },
    money: {
      mrr,
      arr: mrr * 12,
      packRevMonth,
      packRevLifetime,
      revThisMonth: mrr + packRevMonth, // recurring + packs bought this month
      estCostMonth,
      estCostLifetime,
      netMonthEst: mrr + packRevMonth - estCostMonth,
      planCounts,
    },
    usage: { totalAssets, content, lifetimeTokensSpent, activeQuestlines, activeSeries },
    generatedAt: fmtDate(new Date(now)),
  });
};

const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const LABEL: Record<string, string> = {
  IMAGE_AD: "Image ads", VIDEO_AD: "Videos", AUDIO: "Music", BLOG_POST: "Articles", AD_COPY: "Ad copy", EMAIL: "Emails",
};

export default function DevDashboard() {
  const { users, money: m, usage, generatedAt } = useLoaderData<typeof loader>();
  return (
    <div className="dd-wrap">
      <style>{CSS}</style>
      <header className="dd-head">
        <h1 className="dd-title">Dev dashboard</h1>
        <p className="dd-sub">easymodeapp.com · as of {generatedAt} · <Link to="/admin/members">members →</Link></p>
      </header>

      <div className="dd-cards">
        <Card label="Users" value={users.total.toLocaleString()} sub={`+${users.new7} this week`} />
        <Card label="Active (7d)" value={users.active7.toLocaleString()} sub={`${users.active30} in 30d`} />
        <Card label="Paying" value={users.paying.toLocaleString()} sub={`${users.trialing} on trial`} accent />
        <Card label="MRR" value={money(m.mrr)} sub={`${money(m.arr)}/yr`} accent />
        <Card label="Revenue this month" value={money(m.revThisMonth)} sub={`incl. ${money(m.packRevMonth)} packs`} />
        <Card label="Est. AI cost (mo)" value={money(m.estCostMonth)} sub="estimate" warn />
      </div>

      <div className="dd-grid">
        <section className="dd-panel">
          <h2 className="dd-h2">Money</h2>
          <Row k="Recurring revenue (MRR)" v={money(m.mrr)} />
          <Row k="Annual run-rate (ARR)" v={money(m.arr)} />
          <Row k="Token packs — this month" v={money(m.packRevMonth)} />
          <Row k="Token packs — lifetime" v={money(m.packRevLifetime)} />
          <Row k="Est. AI cost — this month" v={money(m.estCostMonth)} sub />
          <Row k="Est. AI cost — lifetime" v={money(m.estCostLifetime)} sub />
          <Row k="Est. net this month" v={money(m.netMonthEst)} strong={m.netMonthEst >= 0} neg={m.netMonthEst < 0} />
          <p className="dd-note">Revenue is real (plan tiers + pack prices). AI cost is a rough estimate from per-asset provider pricing — actual spend lives with the providers.</p>
        </section>

        <section className="dd-panel">
          <h2 className="dd-h2">Plans</h2>
          {Object.keys(m.planCounts).length === 0
            ? <p className="dd-empty">No paying plans yet.</p>
            : Object.entries(m.planCounts).sort((a, b) => b[1] - a[1]).map(([name, n]) => <Row key={name} k={name} v={String(n)} />)}
          <h2 className="dd-h2" style={{ marginTop: 18 }}>Automations running</h2>
          <Row k="Campaign questlines" v={String(usage.activeQuestlines)} />
          <Row k="Creator channels" v={String(usage.activeSeries)} />
        </section>

        <section className="dd-panel dd-wide">
          <h2 className="dd-h2">Content made — {usage.totalAssets.toLocaleString()} total · {usage.lifetimeTokensSpent.toLocaleString()} tokens spent</h2>
          <table className="dd-tbl">
            <thead><tr><th>Type</th><th>This month</th><th>Lifetime</th><th>~Cost each</th></tr></thead>
            <tbody>
              {usage.content.length === 0
                ? <tr><td colSpan={4} className="dd-empty">Nothing made yet.</td></tr>
                : usage.content.map((c) => (
                  <tr key={c.type}>
                    <td>{LABEL[c.type] || c.type}</td>
                    <td className="dd-num">{c.month.toLocaleString()}</td>
                    <td className="dd-num">{c.total.toLocaleString()}</td>
                    <td className="dd-num dd-dim">{money(c.cost)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function Card({ label, value, sub, accent, warn }: { label: string; value: string; sub?: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className={"dd-card" + (accent ? " dd-card-accent" : "") + (warn ? " dd-card-warn" : "")}>
      <div className="dd-card-val">{value}</div>
      <div className="dd-card-lbl">{label}</div>
      {sub && <div className="dd-card-sub">{sub}</div>}
    </div>
  );
}
function Row({ k, v, sub, strong, neg }: { k: string; v: string; sub?: boolean; strong?: boolean; neg?: boolean }) {
  return (
    <div className="dd-row">
      <span className={"dd-row-k" + (sub ? " dd-dim" : "")}>{k}</span>
      <span className={"dd-row-v" + (strong ? " dd-pos" : "") + (neg ? " dd-neg" : "")}>{v}</span>
    </div>
  );
}

const CSS = `
.dd-wrap{max-width:1100px;margin:0 auto;padding:28px 18px 64px;color:#14201A;font-family:Poppins,system-ui,sans-serif}
.dd-head{margin-bottom:18px}
.dd-title{font-size:30px;font-weight:700;margin:0;letter-spacing:-.01em}
.dd-sub{margin:4px 0 0;color:#5a6b61;font-size:14px}
.dd-sub a{color:#0C7A46;text-decoration:none;font-weight:600}
.dd-cards{display:grid;grid-template-columns:repeat(6,1fr);gap:11px;margin-bottom:22px}
.dd-card{background:#fff;border:1px solid #e3e9e4;border-radius:14px;padding:15px 16px}
.dd-card-accent{background:#0C7A46;border-color:#0C7A46}
.dd-card-accent .dd-card-val,.dd-card-accent .dd-card-lbl,.dd-card-accent .dd-card-sub{color:#fff}
.dd-card-accent .dd-card-sub{opacity:.85}
.dd-card-warn{background:#fdf6e3;border-color:#f0e2bf}
.dd-card-val{font-size:25px;font-weight:700;line-height:1.05;letter-spacing:-.01em}
.dd-card-lbl{margin-top:6px;font-size:12px;color:#5a6b61;font-weight:600}
.dd-card-sub{margin-top:3px;font-size:11px;color:#8a978f}
.dd-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.dd-panel{background:#fff;border:1px solid #e3e9e4;border-radius:16px;padding:18px 20px}
.dd-wide{grid-column:1 / -1}
.dd-h2{font-size:14px;font-weight:700;margin:0 0 12px;color:#14201A}
.dd-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:7px 0;border-bottom:1px solid #f0f3f0;font-size:14px}
.dd-row:last-child{border-bottom:none}
.dd-row-k{color:#4a554e}
.dd-row-v{font-weight:700;font-variant-numeric:tabular-nums}
.dd-dim{color:#8a978f}
.dd-pos{color:#0C7A46}
.dd-neg{color:#c0392b}
.dd-note{font-size:12px;color:#8a978f;line-height:1.5;margin:12px 0 0}
.dd-tbl{width:100%;border-collapse:collapse;font-size:13.5px}
.dd-tbl th{text-align:left;padding:8px 10px;background:#f4f7f4;color:#5a6b61;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid #e3e9e4}
.dd-tbl th:not(:first-child){text-align:right}
.dd-tbl td{padding:8px 10px;border-bottom:1px solid #eef2ee}
.dd-tbl tr:last-child td{border-bottom:none}
.dd-num{text-align:right;font-variant-numeric:tabular-nums}
.dd-empty{color:#8a978f;text-align:center;padding:14px 0}
@media (max-width:860px){.dd-cards{grid-template-columns:repeat(3,1fr)}.dd-grid{grid-template-columns:1fr}}
@media (max-width:520px){.dd-cards{grid-template-columns:repeat(2,1fr)}}
`;
