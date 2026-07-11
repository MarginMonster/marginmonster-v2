import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { useState } from "react";
import fs from "node:fs";
import path from "node:path";
import { Page, Banner, Box } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { tokensRemaining } from "../lib/tokens.server";
import { acceptQuestline } from "../lib/questlines.server";
import { QUESTLINES, QUESTLINE_BY_KEY, questlineTokenCost } from "../lib/questlines";
import { AVATARS, AVATAR_BY_ID } from "../lib/avatars";
import { Partner, PARTNER_BY_PLAN, type PlanKey } from "../components/Partner";

const TIER_RANK: Record<string, number> = { STARTER: 0, GROWTH: 1, PRO: 2, SCALE: 3 };

/** Relative timestamp for the live feed — timezone-proof. */
function rel(ms: number, now: number): string {
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

/** Translate a pipeline job into a mission-control feed line. Every line maps
 *  to a true state — the AI never bluffs. */
function feedLine(j: { type: string; status: string; payload: string }): { msg: string; tone: string } {
  let p: Record<string, unknown> = {};
  try { p = JSON.parse(j.payload); } catch { /* raw */ }
  const kind = j.type === "GENERATE_IMAGE_AD" ? "Image ad" : j.type === "GENERATE_BLOG_POST" ? "Blog post" : "Video take";
  if (j.status === "FAILED") return { msg: `${kind} failed — retry available`, tone: "bad" };
  if (j.status === "SUCCESS") return { msg: `${kind} delivered`, tone: "ok" };
  if (j.status === "IN_PROGRESS") {
    if (p.ckTalkingUrl) return { msg: "Assembling final cut — captions burning in", tone: "hot" };
    if (p.ckOmniId) return { msg: "Performance rendering — lip-sync in progress", tone: "hot" };
    if (p.ckAudioUrl) return { msg: "Voice recorded — animating the performance", tone: "hot" };
    if (p.ckScript) return { msg: "Script forged — casting the voice", tone: "hot" };
    return { msg: `${kind} in production`, tone: "hot" };
  }
  return { msg: `${kind} queued — waiting for a free stage`, tone: "" };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true, questlines: { orderBy: { createdAt: "desc" }, take: 20 } },
  });
  const empty = {
    questlines: [] as {
      id: string; name: string; template: string; status: string; avatarId: string | null;
      avatarVariant: number; productTitle: string | null; productImageUrl: string | null;
      objectives: { key: string; label: string; type: string; target: number; done: number }[];
      tokenCost: number; xpReward: number; progress: number; reviewMode: string;
    }[],
    products: [] as { id: string; title: string; image: string | null }[],
    tokens: 0, tier: "STARTER",
    brandFace: null as { id: string; variant: number } | null,
    castAvail: {} as Record<string, boolean>,
    partner: null as { img: string; accent: string; name: string } | null,
    feed: [] as { t: string; msg: string; tone: string }[],
    renderingIds: [] as string[], working: false,
  };
  if (!shop) return json(empty);

  let products: { id: string; title: string; image: string | null }[] = [];
  try {
    const res = await admin.graphql(
      `{ products(first: 24, sortKey: UPDATED_AT, reverse: true) { edges { node { id title featuredImage { url } } } } }`
    );
    const j = (await res.json()) as { data?: { products?: { edges?: { node: { id: string; title: string; featuredImage?: { url?: string } } }[] } } };
    products = (j.data?.products?.edges || []).map((e) => ({ id: e.node.id, title: e.node.title, image: e.node.featuredImage?.url || null }));
  } catch { /* picker just renders empty */ }

  const castAvail: Record<string, boolean> = {};
  try {
    const files = new Set(fs.readdirSync(path.join(process.cwd(), "public", "avatars")));
    for (const a of AVATARS) if (files.has(`${a.id}_0.jpg`) || files.has(`${a.id}.jpg`)) castAvail[a.id] = true;
  } catch { /* empty roster */ }

  // Live feed + which questlines have content actively cooking.
  const now = Date.now();
  let feed: { t: string; msg: string; tone: string }[] = [];
  const renderingIds: string[] = [];
  let working = false;
  try {
    const jobs = await db.job.findMany({
      where: { shopId: shop.id, type: { in: ["GENERATE_VIDEO_AD", "GENERATE_IMAGE_AD", "GENERATE_BLOG_POST"] } },
      orderBy: { updatedAt: "desc" },
      take: 8,
    });
    feed = jobs.map((j) => ({ t: rel(j.updatedAt.getTime(), now), ...feedLine(j) }));
    for (const j of jobs) {
      if (j.status !== "IN_PROGRESS" && j.status !== "PENDING") continue;
      working = working || j.status === "IN_PROGRESS";
      try {
        const p = JSON.parse(j.payload);
        if (p.questlineId) renderingIds.push(p.questlineId as string);
      } catch { /* skip */ }
    }
  } catch (e) {
    console.error("[quests] feed load failed (non-fatal):", e);
  }

  const planType = (shop.activePlan?.type || "STARTER") as PlanKey;
  const pd = PARTNER_BY_PLAN[planType] || PARTNER_BY_PLAN.STARTER;

  return json({
    ...empty,
    questlines: shop.questlines.map((q) => ({
      id: q.id, name: q.name, template: q.template, status: q.status,
      avatarId: q.avatarId, avatarVariant: q.avatarVariant, productTitle: q.productTitle,
      productImageUrl: q.productImageUrl,
      objectives: JSON.parse(q.objectivesJson) as { key: string; label: string; type: string; target: number; done: number }[],
      tokenCost: q.tokenCost, xpReward: q.xpReward, progress: q.progress, reviewMode: q.reviewMode,
    })),
    products,
    tokens: shop.activePlan ? tokensRemaining(shop.activePlan) : 0,
    tier: shop.activePlan?.type || "STARTER",
    brandFace: shop.brandAvatarId ? { id: shop.brandAvatarId, variant: shop.brandAvatarVariant ?? 0 } : null,
    castAvail,
    partner: { img: pd.img, accent: pd.accent, name: pd.name },
    feed,
    renderingIds,
    working,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent") as string;
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return json({ error: "Shop not found" });

  if (intent === "accept") {
    const res = await acceptQuestline({
      shopId: shop.id,
      templateKey: (form.get("template") as string) || "",
      avatarId: ((form.get("avatarId") as string) || "").trim() || null,
      avatarVariant: parseInt((form.get("avatarVariant") as string) || "0", 10) || 0,
      reviewMode: (form.get("reviewMode") as "REVIEW_FIRST" | "SET_AND_FORGET") || "REVIEW_FIRST",
      productTitle: (form.get("productTitle") as string) || "",
      productImageUrl: ((form.get("productImageUrl") as string) || "").trim() || null,
    });
    return json(res.ok ? { accepted: true } : { error: res.error });
  }

  if (intent === "pauseToggle") {
    const id = (form.get("questlineId") as string) || "";
    const q = await db.questline.findFirst({ where: { id, shopId: shop.id } });
    if (q && q.status !== "COMPLETE") {
      await db.questline.update({ where: { id }, data: { status: q.status === "ACTIVE" ? "PAUSED" : "ACTIVE" } });
    }
    return json({ ok: true });
  }

  if (intent === "delete") {
    await db.questline.deleteMany({ where: { id: (form.get("questlineId") as string) || "", shopId: shop.id } });
    return json({ ok: true });
  }

  return json({ ok: true });
};

const NODE_LBL: Record<string, string> = { video: "VIDEOS", image: "IMAGES", blog: "BLOGS", post: "POSTS" };
const NODE_ICON: Record<string, string> = { video: "🎬", image: "🖼", blog: "📝", post: "📣" };

type Objective = { key: string; label: string; type: string; target: number; done: number };

/** The overworld: pixel tile map with a telemetry overlay. Nodes are the
 *  quest's objectives; the plan partner walks the trail as they complete. */
function TrailMap({ objectives, xpReward, rendering, partner, cargo }: {
  objectives: Objective[]; xpReward: number; rendering: boolean;
  partner: { img: string; accent: string; name: string } | null;
  cargo: { title: string; image: string | null } | null;
}) {
  const nodes = [
    { icon: "✓", lbl: "SIGNED", count: "", done: true },
    ...objectives.map((o) => ({
      icon: NODE_ICON[o.type] || "⬜", lbl: NODE_LBL[o.type] || o.type.toUpperCase(),
      count: `${o.done}/${o.target}`, done: o.done >= o.target,
    })),
  ];
  const N = nodes.length;
  const xs = nodes.map((_, i) => Math.round(46 + (i * 474) / Math.max(1, N - 1)));
  const ys = nodes.map((_, i) => (i % 2 === 0 ? 100 : 52));
  const chest = { x: 592, y: 74 };
  let d = `M ${xs[0]} ${ys[0]}`;
  for (let i = 1; i < N; i++) d += ` H ${xs[i]} V ${ys[i]}`;
  d += ` H ${chest.x - 4} V ${chest.y}`;
  let activeIdx = nodes.findIndex((n) => !n.done);
  const allDone = activeIdx === -1;
  if (allDone) activeIdx = N; // partner reaches the chest
  const px = allDone ? chest.x : xs[activeIdx];
  const py = allDone ? chest.y : ys[activeIdx];

  return (
    <div className="qh-map">
      <svg viewBox="0 0 640 158" role="img" aria-label="Quest progress map">
        <rect width="640" height="158" fill="#173a2a" />
        <g fill="#1e4a35" shapeRendering="crispEdges">
          <rect x="20" y="18" width="14" height="14" /><rect x="150" y="120" width="14" height="14" />
          <rect x="300" y="20" width="14" height="14" /><rect x="450" y="126" width="14" height="14" />
          <rect x="80" y="78" width="14" height="14" /><rect x="520" y="24" width="14" height="14" />
        </g>
        <g shapeRendering="crispEdges">
          <g fill="#0f5c33">
            <rect x="62" y="24" width="20" height="24" /><rect x="228" y="108" width="20" height="24" />
            <rect x="412" y="18" width="20" height="24" /><rect x="556" y="112" width="20" height="24" />
          </g>
          <g fill="#6b4420">
            <rect x="68" y="44" width="8" height="10" /><rect x="234" y="128" width="8" height="10" />
            <rect x="418" y="38" width="8" height="10" /><rect x="562" y="132" width="8" height="10" />
          </g>
        </g>
        <path d={d} fill="none" stroke="#c9a26b" strokeWidth="16" shapeRendering="crispEdges" />
        <path d={d} fill="none" stroke="#34E7E4" strokeWidth="2" strokeDasharray="6 10" opacity="0.7" />
        {nodes.map((n, i) => {
          const x = xs[i], y = ys[i];
          const isActive = i === activeIdx;
          const fill = n.done ? "#1D9E75" : isActive ? "#ffd76a" : "#1c1c38";
          const stroke = n.done ? "#04342C" : isActive ? "#854f0b" : "#3e3e66";
          const labelY = y === 100 ? 144 : 28;
          return (
            <g key={i}>
              {isActive && (
                <circle cx={x} cy={y} fill="none" stroke="#34E7E4" strokeWidth="2">
                  <animate attributeName="r" values="15;32" dur="1.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.8;0" dur="1.6s" repeatCount="indefinite" />
                </circle>
              )}
              <rect x={x - 13} y={y - 13} width="26" height="26" fill={fill} stroke={stroke} strokeWidth="3" shapeRendering="crispEdges" />
              <text x={x} y={y + 5} textAnchor="middle" fontSize="13" fill={n.done ? "#04342C" : isActive ? "#412402" : "#5d5d8a"}>{n.done ? "✓" : n.icon}</text>
              <text x={x} y={labelY} textAnchor="middle" fontSize="11" fontFamily="monospace" fill={n.done ? "#7dd8b8" : isActive ? "#fff3c9" : "#5d5d8a"}>
                {n.lbl}{n.count ? ` ${n.count}` : ""}
              </text>
              {isActive && (
                <g>
                  <rect x={x - 50} y={y === 52 ? y + 22 : y - 42} width="100" height="18" rx="3" fill="#0c0c20" stroke="#2e2e52" />
                  <text x={x} y={y === 52 ? y + 35 : y - 29} textAnchor="middle" fontSize="11" fontFamily="monospace" fill={rendering ? "#34E7E4" : "#7d7da8"}>
                    {rendering ? "● FORGING" : "QUEUED"}
                  </text>
                </g>
              )}
            </g>
          );
        })}
        <g shapeRendering="crispEdges">
          <rect x={chest.x - 17} y={chest.y - 13} width="34" height="26" fill="#8a5a22" stroke="#3d2b12" strokeWidth="3" />
          <rect x={chest.x - 17} y={chest.y - 13} width="34" height="10" fill="#a8752f" />
          <rect x={chest.x - 3} y={chest.y - 5} width="6" height="8" fill="#ffd76a">
            {allDone && <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" />}
          </rect>
        </g>
        <text x={chest.x} y={chest.y + 34} textAnchor="middle" fontSize="11" fontFamily="monospace" fill="#ffd76a">+{xpReward.toLocaleString()} XP</text>
      </svg>
      {partner && (
        <div className="qh-partner" style={{ left: `${(px / 640) * 100}%`, top: `${(py / 158) * 100}%` }}>
          <Partner img={partner.img} accent={partner.accent} />
          <span className="tag">{partner.name}</span>
        </div>
      )}
      {cargo && cargo.image && (
        <div className="qh-cargo" title={`Carrying: ${cargo.title}`}>
          <img src={cargo.image} alt="" />
          <span className="lb">CARGO</span>
        </div>
      )}
    </div>
  );
}

export default function Campaigns() {
  const { questlines, products, tokens, tier, brandFace, castAvail, partner, feed, renderingIds, working } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const err = actionData && "error" in actionData ? (actionData.error as string) : null;
  const accepted = !!(actionData && "accepted" in actionData);

  const available = AVATARS.filter((a) => castAvail[a.id]);
  const [starId, setStarId] = useState<string>(brandFace?.id && castAvail[brandFace.id] ? brandFace.id : available[0]?.id || "");
  const starVariant = brandFace?.id === starId ? brandFace.variant : 0;
  const [pick, setPick] = useState<{ id: string; title: string; image: string | null } | null>(null);
  const [reviewMode, setReviewMode] = useState<"REVIEW_FIRST" | "SET_AND_FORGET">("REVIEW_FIRST");
  const canRun = (minTier: string) => (TIER_RANK[tier] ?? 0) >= (TIER_RANK[minTier] ?? 1);
  const firstUnlocked = QUESTLINES.find((q) => canRun(q.minTier)) || QUESTLINES[0];
  const [selKey, setSelKey] = useState(firstUnlocked.key);
  const sel = QUESTLINE_BY_KEY[selKey] || firstUnlocked;
  const selCost = questlineTokenCost(sel);
  const selLocked = !canRun(sel.minTier);
  const selAffordable = tokens >= selCost;

  const active = questlines.filter((q) => q.status !== "COMPLETE");
  const done = questlines.filter((q) => q.status === "COMPLETE");

  // The partner never bluffs — every line below derives from real state.
  const pName = partner?.name || "BYTE";
  let dialog: string;
  if (accepted) {
    dialog = "Quest accepted. Everything's queued — watch the trail light up as each piece lands. I'll report every delivery in the live feed.";
  } else if (active.length > 0) {
    const q = active[0];
    const isRendering = renderingIds.includes(q.id);
    const remaining = q.objectives.filter((o) => o.type !== "post").reduce((s, o) => s + Math.max(0, o.target - o.done), 0);
    if (q.status === "PAUSED") {
      dialog = `"${q.name}" is paused — everything's saved right where we left it. Resume whenever you're ready.`;
    } else if (isRendering) {
      dialog = `On it — content for "${q.name}" is rendering now. ${remaining} piece${remaining === 1 ? "" : "s"} to go until the chest. I'll keep marching down the trail as takes land.`;
    } else if (remaining > 0) {
      dialog = `"${q.name}" is underway — the next objective is queued and I'll pick it up shortly. ${remaining} piece${remaining === 1 ? "" : "s"} between us and that chest.`;
    } else {
      dialog = `All content for "${q.name}" is forged. Cracking the chest open — check the completed log below.`;
    }
  } else if (done.length > 0) {
    dialog = `Quest complete — ${done[0].xpReward.toLocaleString()} XP banked. Pick the next mission and I'm back to work.`;
  } else if (tokens < questlineTokenCost(firstUnlocked)) {
    dialog = "Your token balance won't cover a quest yet — hit INSERT COINS in the HUD and I'll get to work the second we're funded.";
  } else {
    dialog = "No active quests. Pick a mission below — I handle scripting, casting, rendering, and delivery end to end. You just watch the trail.";
  }

  const startQuest = () => {
    submit(
      {
        intent: "accept", template: sel.key, productTitle: pick?.title || "",
        productImageUrl: pick?.image || "", avatarId: starId, avatarVariant: String(starVariant), reviewMode,
      },
      { method: "post" }
    );
  };

  return (
    <Page backAction={{ content: "Home", url: "/app" }}>
      <div className="qh-head">
        <span className="qh-title">CAMPAIGN <em>QUESTS</em></span>
        <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
          <span className="qh-chip" title="The AI autopilot generates, tracks, and delivers your campaign content">
            <span className="dot" />AI AUTOPILOT · {working ? "WORKING" : "ONLINE"}
          </span>
          <span className="qh-chip idle"><span className="dot" />🪙 {tokens.toLocaleString()}</span>
        </span>
      </div>

      {err && (
        <Box paddingBlockEnd="300"><Banner tone="critical" title="Couldn't start that quest"><p>{err}</p></Banner></Box>
      )}

      {/* Active quests — the overworld */}
      {active.map((q) => (
        <div key={q.id} className="qh-win" style={{ marginBottom: 16 }}>
          <span className="qh-label">
            ▶ {q.name.toUpperCase()}
            <span className="r">
              {q.productTitle}{q.avatarId && AVATAR_BY_ID[q.avatarId] ? ` × ${AVATAR_BY_ID[q.avatarId].name}` : ""} — {q.progress}%
            </span>
          </span>
          <TrailMap
            objectives={q.objectives}
            xpReward={q.xpReward}
            rendering={q.status === "ACTIVE" && renderingIds.includes(q.id)}
            partner={partner}
            cargo={q.productTitle ? { title: q.productTitle, image: q.productImageUrl } : null}
          />
          <div className="qh-quest-foot">
            <span className="xp">🏆 {q.xpReward.toLocaleString()} XP AT THE CHEST</span>
            <span style={{ display: "inline-flex", gap: 8 }}>
              <button type="button" className="qh-mini-btn" onClick={() => submit({ intent: "pauseToggle", questlineId: q.id }, { method: "post" })}>
                {q.status === "PAUSED" ? "▶ Resume" : "⏸ Pause"}
              </button>
              <button
                type="button" className="qh-mini-btn danger"
                onClick={() => { if (confirm("Abandon this quest? Content already created stays in your library.")) submit({ intent: "delete", questlineId: q.id }, { method: "post" }); }}
              >
                ✕ Abandon
              </button>
            </span>
          </div>
        </div>
      ))}

      {/* Partner dialog — state-aware, always true */}
      <div className="qh-win qh-dialog" style={{ marginBottom: 16 }}>
        <div className="art">{partner && <Partner img={partner.img} accent={partner.accent} />}</div>
        <p><span className="nm">{pName}:</span> {dialog}<span className="qh-curs">▊</span></p>
      </div>

      <div className="qh-grid2" style={{ marginBottom: 16 }}>
        {/* Live feed — the AI's real activity stream */}
        <div className="qh-win">
          <span className="qh-label">LIVE FEED<span className="r">pipeline telemetry</span></span>
          {feed.length === 0 ? (
            <div className="qh-feed"><div><span className="t">--</span>Standing by — no production activity yet</div></div>
          ) : (
            <div className="qh-feed">
              {feed.map((f, i) => (
                <div key={i}><span className="t">{f.t}</span><span className={f.tone}>{f.msg}</span></div>
              ))}
            </div>
          )}
        </div>

        {/* Quest select — RPG menu */}
        <div className="qh-win gold">
          <span className="qh-label gold">NEW QUESTS</span>
          {QUESTLINES.map((q) => {
            const locked = !canRun(q.minTier);
            const cost = questlineTokenCost(q);
            return (
              <button
                key={q.key} type="button"
                className={`qh-qrow${selKey === q.key ? " on" : ""}${locked ? " locked" : ""}`}
                onClick={() => setSelKey(q.key)}
              >
                <span style={{ display: "inline-flex", gap: 4, alignItems: "center", minWidth: 0 }}>
                  <span className="ptr">▶</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.icon} {q.name.toUpperCase()}</span>
                </span>
                {locked ? <span>🔒 {q.minTier}</span> : (
                  <span className="cost">{cost.toLocaleString()}🪙 <span className="xp">+{q.xpReward.toLocaleString()}XP</span></span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Mission briefing + loadout */}
      <div className="qh-win" style={{ marginBottom: 16 }}>
        <span className="qh-label">
          MISSION BRIEFING — {sel.icon} {sel.name.toUpperCase()}
          {sel.recurring && <span className="r">repeats monthly</span>}
        </span>
        <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, color: "#a8a8cc", margin: "0 0 12px", lineHeight: 1.6 }}>{sel.tagline}</p>
        <div className="qh-detail-objs">
          {sel.objectives.map((o, i) => (
            <div key={i}>{NODE_ICON[o.type]} {o.target}× {o.label}</div>
          ))}
          <div style={{ color: "#8ee89c" }}>🏆 Reward: {sel.xpReward.toLocaleString()} XP{sel.recurring ? " every cycle" : ""}</div>
        </div>

        <div className="qh-loadout-grid">
          <div>
            <label className="qh-field-label" htmlFor="qh-star">Star presenter (Brand Face)</label>
            <select id="qh-star" className="qh-select" value={starId} onChange={(e) => setStarId(e.target.value)}>
              {available.length === 0 && <option value="">Cast still loading…</option>}
              {available.map((a) => (
                <option key={a.id} value={a.id}>{a.name}{brandFace?.id === a.id ? " ★" : ""} — {a.vibe}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="qh-field-label" htmlFor="qh-mode">Publishing mode</label>
            <select id="qh-mode" className="qh-select" value={reviewMode} onChange={(e) => setReviewMode(e.target.value as "REVIEW_FIRST" | "SET_AND_FORGET")}>
              <option value="REVIEW_FIRST">Review first — AI stages, you approve</option>
              <option value="SET_AND_FORGET">Set & forget — full autopilot</option>
            </select>
          </div>
        </div>

        {products.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <span className="qh-field-label">
              🎒 BACKPACK — equip the item this quest promotes{" "}
              {pick && <span className="qh-equipped-line">— {pick.title} equipped</span>}
            </span>
            <div className="qh-bag">
              {products.map((p) => (
                <button
                  key={p.id} type="button"
                  className={`qh-slot${pick?.id === p.id ? " on" : ""}`}
                  title={p.title}
                  onClick={() => setPick(pick?.id === p.id ? null : p)}
                >
                  {p.image ? <img src={p.image} alt={p.title} loading="lazy" /> : <span className="ph">🛍️</span>}
                  <span className="qh-slot-name">{p.title}</span>
                </button>
              ))}
              {/* pad the bag to a full row so it reads as an inventory, not a list */}
              {Array.from({ length: Math.max(0, (8 - (products.length % 8)) % 8) }).map((_, i) => (
                <div key={`e${i}`} className="qh-slot empty" aria-hidden="true">·</div>
              ))}
            </div>
          </div>
        )}

        <button
          type="button" className="qh-start"
          disabled={busy || selLocked || !pick || !selAffordable || !starId}
          onClick={startQuest}
        >
          {selLocked ? `🔒 ${sel.minTier} PLAN REQUIRED` : busy ? "SIGNING…" : `▶ START QUEST — ${selCost.toLocaleString()} 🪙`}
        </button>
        {!selLocked && (
          <div className="qh-hint">
            {!pick ? "Equip an item from your backpack to unlock the mission" :
              !selAffordable ? `Needs ${selCost.toLocaleString()} tokens — you have ${tokens.toLocaleString()}. INSERT COINS in the HUD to top up.` :
              "Tokens cover content creation. Ad spend always runs on your own connected accounts — never ours to touch."}
          </div>
        )}
      </div>

      {/* Completed log */}
      {done.length > 0 && (
        <div className="qh-win" style={{ marginBottom: 16 }}>
          <span className="qh-label">COMPLETED QUESTS</span>
          {done.map((q) => (
            <div key={q.id} className="qh-done-row">
              <span>✓ {q.name.toUpperCase()} — {q.productTitle}</span>
              <span className="xp">+{q.xpReward.toLocaleString()} XP</span>
            </div>
          ))}
        </div>
      )}
      <Box paddingBlockEnd="600" />
    </Page>
  );
}
