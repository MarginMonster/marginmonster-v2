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
import { acceptQuestline, rescheduleSlot, abandonQuestline } from "../lib/questlines.server";
import {
  QUESTLINES, QUESTLINE_BY_KEY, questlineTokenCost, parseSchedule, spotName,
  QUEST_DURATION_DAYS, type QuestSlot, type ObjectiveType,
} from "../lib/questlines";
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

/* Deterministic date labels (UTC math on the date string — identical output
 * on server and client, no hydration mismatch). */
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
function fmtDow(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return "";
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
function fmtTime(t: string): string {
  const h = parseInt(t.slice(0, 2), 10);
  const mm = t.slice(3, 5);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return mm === "00" ? `${h12}${ap}` : `${h12}:${mm}${ap}`;
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
  return { msg: `${kind} scheduled — waiting for its calendar slot`, tone: "" };
}

/** Legacy quests predate the calendar — synthesize a display schedule from
 *  their objectives so the board still renders. */
function synthSlots(objectives: { type: string; target: number; done: number }[], createdAt: string): QuestSlot[] {
  const pieces: { type: ObjectiveType; done: boolean }[] = [];
  for (const o of objectives) {
    if (o.type === "post") continue;
    for (let i = 0; i < o.target; i++) pieces.push({ type: o.type as ObjectiveType, done: i < o.done });
  }
  const start = new Date(createdAt).getTime();
  const spotCounters: Record<string, number> = {};
  return pieces.map((p, i) => {
    const day = Math.min(QUEST_DURATION_DAYS - 1, Math.max(2, Math.round(2 + (i * (QUEST_DURATION_DAYS - 4)) / Math.max(1, pieces.length - 1))));
    const sn = spotCounters[p.type] = spotCounters[p.type] || 0;
    spotCounters[p.type]++;
    return {
      idx: i, day,
      date: new Date(start + (day - 1) * 86400000).toISOString().slice(0, 10),
      time: p.type === "video" ? "19:00" : p.type === "blog" ? "09:00" : "12:00",
      type: p.type, spot: spotName(p.type, sn),
      productTitle: "", productImageUrl: null,
      status: p.done ? ("READY" as const) : ("SCHEDULED" as const),
    };
  });
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
      slots: QuestSlot[]; dayOf: number; duration: number;
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
      `{ products(first: 32, sortKey: UPDATED_AT, reverse: true) { edges { node { id title featuredImage { url } } } } }`
    );
    const j = (await res.json()) as { data?: { products?: { edges?: { node: { id: string; title: string; featuredImage?: { url?: string } } }[] } } };
    products = (j.data?.products?.edges || []).map((e) => ({ id: e.node.id, title: e.node.title, image: e.node.featuredImage?.url || null }));
  } catch { /* picker just renders empty */ }

  const castAvail: Record<string, boolean> = {};
  try {
    const files = new Set(fs.readdirSync(path.join(process.cwd(), "public", "avatars")));
    for (const a of AVATARS) if (files.has(`${a.id}_0.jpg`) || files.has(`${a.id}.jpg`)) castAvail[a.id] = true;
  } catch { /* empty roster */ }

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
      if (j.status !== "IN_PROGRESS") continue;
      working = true;
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
    questlines: shop.questlines.map((q) => {
      const objectives = JSON.parse(q.objectivesJson) as { key: string; label: string; type: string; target: number; done: number }[];
      const sched = parseSchedule(q.scheduleJson);
      const slots = sched.slots.length > 0 ? sched.slots : synthSlots(objectives, q.createdAt.toISOString());
      const duration = q.durationDays || QUEST_DURATION_DAYS;
      const dayOf = Math.max(1, Math.min(duration, Math.floor((now - q.createdAt.getTime()) / 86400000) + 1));
      return {
        id: q.id, name: q.name, template: q.template, status: q.status,
        avatarId: q.avatarId, avatarVariant: q.avatarVariant, productTitle: q.productTitle,
        productImageUrl: q.productImageUrl,
        objectives, slots, dayOf, duration,
        tokenCost: q.tokenCost, xpReward: q.xpReward, progress: q.progress, reviewMode: q.reviewMode,
      };
    }),
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
    let bag: { title: string; image: string | null }[] = [];
    try { bag = JSON.parse((form.get("bag") as string) || "[]"); } catch { /* empty */ }
    const res = await acceptQuestline({
      shopId: shop.id,
      templateKey: (form.get("template") as string) || "",
      avatarId: ((form.get("avatarId") as string) || "").trim() || null,
      avatarVariant: parseInt((form.get("avatarVariant") as string) || "0", 10) || 0,
      reviewMode: (form.get("reviewMode") as "REVIEW_FIRST" | "SET_AND_FORGET") || "REVIEW_FIRST",
      bag,
    });
    return json(res.ok ? { accepted: true } : { error: res.error });
  }

  if (intent === "reschedule") {
    const res = await rescheduleSlot(
      shop.id,
      (form.get("questlineId") as string) || "",
      parseInt((form.get("slotIdx") as string) || "-1", 10),
      (form.get("date") as string) || "",
      (form.get("time") as string) || ""
    );
    return json(res.ok ? { rescheduled: true } : { error: res.error });
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
    const res = await abandonQuestline(shop.id, (form.get("questlineId") as string) || "");
    return json({ ok: true, refunded: res.refunded });
  }

  return json({ ok: true });
};

const NODE_ICON: Record<string, string> = { video: "🎬", image: "🖼", blog: "📝", post: "📣" };

/** Spread n points between a and b (inclusive). */
function spread(a: number, b: number, n: number): number[] {
  if (n <= 1) return [Math.round((a + b) / 2)];
  return Array.from({ length: n }, (_, i) => Math.round(a + (i * (b - a)) / (n - 1)));
}

/** The overworld v2 — a vivid two-row adventure board. Every destination is a
 *  named, dated, labeled stop; the plan partner physically works the current
 *  one. Clicking a stop opens the schedule editor. */
function TrailMap({ slots, xpReward, rendering, partner, cargo, onPick, selectedIdx }: {
  slots: QuestSlot[]; xpReward: number; rendering: boolean;
  partner: { img: string; accent: string; name: string } | null;
  cargo: { title: string; image: string | null }[];
  onPick: (idx: number) => void; selectedIdx: number | null;
}) {
  type Pt = { kind: "start" | "slot" | "vault"; slot?: QuestSlot; x: number; y: number };
  const items: Omit<Pt, "x" | "y">[] = [
    { kind: "start" },
    ...slots.map((s) => ({ kind: "slot" as const, slot: s })),
    { kind: "vault" },
  ];
  const T = items.length;
  const r1 = Math.ceil(T / 2);
  const r2 = T - r1;
  const y1 = 74, y2 = 196;
  const xs1 = spread(52, 608, r1);
  const xs2 = spread(608, 52, Math.max(1, r2));
  const pts: Pt[] = items.map((it, i) => (
    i < r1 ? { ...it, x: xs1[i], y: y1 } : { ...it, x: xs2[i - r1], y: y2 }
  ));
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i], prev = pts[i - 1];
    d += p.y === prev.y ? ` H ${p.x}` : ` V ${p.y}`;
    if (p.y !== prev.y) d += ` H ${p.x}`;
  }
  // The partner stands at the stop it's currently working / traveling toward.
  let curIdx = pts.findIndex((p) => p.kind === "slot" && p.slot && (p.slot.status === "FORGING" || p.slot.status === "SCHEDULED" || p.slot.status === "FAILED"));
  if (curIdx === -1) curIdx = pts.length - 1; // everything forged → the vault
  const cur = pts[curIdx];
  const curSpot = cur.kind === "slot" ? cur.slot?.spot : cur.kind === "vault" ? "THE VAULT" : "BASE CAMP";

  return (
    <div className="qh-map">
      <svg viewBox="0 0 660 268" role="img" aria-label="Campaign adventure board">
        {/* biomes: lush grass, a river across the middle, sand cove, mountains */}
        <rect width="660" height="268" fill="#1f9152" />
        <g fill="#1a7d46" shapeRendering="crispEdges">
          {[30, 110, 240, 330, 470, 590].map((x, i) => <rect key={i} x={x} y={(i % 2) * 30 + 14} width="16" height="16" />)}
          {[70, 200, 380, 520, 620].map((x, i) => <rect key={`b${i}`} x={x} y={230 - (i % 2) * 26} width="16" height="16" />)}
        </g>
        {/* river */}
        <rect y="122" width="660" height="30" fill="#2f6fc0" shapeRendering="crispEdges" />
        <g fill="#4b8bd8" shapeRendering="crispEdges">
          {[20, 90, 170, 260, 350, 440, 530, 610].map((x, i) => <rect key={i} x={x} y={130 + (i % 2) * 8} width="22" height="4" />)}
        </g>
        {/* sand cove bottom-left */}
        <path d="M0 240 h130 v28 H0 Z" fill="#d9b36a" shapeRendering="crispEdges" />
        <rect x="24" y="246" width="8" height="8" fill="#c49a4e" shapeRendering="crispEdges" />
        <rect x="70" y="252" width="8" height="8" fill="#c49a4e" shapeRendering="crispEdges" />
        {/* mountains top-right with snow caps */}
        <g shapeRendering="crispEdges">
          <path d="M560 44 l24 -30 24 30 Z" fill="#5f5390" /><path d="M578 22 l6 -8 6 8 Z" fill="#e8ecf5" />
          <path d="M600 44 l20 -24 20 24 Z" fill="#524777" /><path d="M615 26 l5 -6 5 6 Z" fill="#e8ecf5" />
        </g>
        {/* trees + flowers */}
        <g shapeRendering="crispEdges">
          {[[96, 20], [268, 26], [430, 16]].map(([x, y], i) => (
            <g key={i}><rect x={x} y={y} width="22" height="26" fill="#0f5c33" /><rect x={x + 7} y={y + 22} width="8" height="10" fill="#6b4420" /></g>
          ))}
          {[[150, 236], [420, 240], [560, 232]].map(([x, y], i) => (
            <g key={`t${i}`}><rect x={x} y={y} width="22" height="26" fill="#0f5c33" /><rect x={x + 7} y={y + 22} width="8" height="10" fill="#6b4420" /></g>
          ))}
          {[[40, 100], [210, 40], [500, 96], [340, 232], [620, 210]].map(([x, y], i) => (
            <rect key={`f${i}`} x={x} y={y} width="6" height="6" fill={i % 2 ? "#f2c14e" : "#e24b4a"} />
          ))}
        </g>
        {/* the road (with a bridge over the river) */}
        <path d={d} fill="none" stroke="#b98d4f" strokeWidth="18" shapeRendering="crispEdges" />
        <path d={d} fill="none" stroke="#e0c088" strokeWidth="12" shapeRendering="crispEdges" />
        <path d={d} fill="none" stroke="#34E7E4" strokeWidth="2" strokeDasharray="6 10" opacity="0.65" />
        <rect x={pts[r1 - 1].x - 13} y="120" width="26" height="34" fill="#8a5a22" shapeRendering="crispEdges" />
        <g fill="#6b4420" shapeRendering="crispEdges">
          <rect x={pts[r1 - 1].x - 13} y="126" width="26" height="3" /><rect x={pts[r1 - 1].x - 13} y="138" width="26" height="3" />
        </g>

        {pts.map((p, i) => {
          if (p.kind === "start") {
            return (
              <g key={i} shapeRendering="crispEdges">
                <rect x={p.x - 12} y={p.y - 12} width="24" height="24" fill="#1D9E75" stroke="#04342C" strokeWidth="3" />
                <text x={p.x} y={p.y + 5} textAnchor="middle" fontSize="12" fill="#04342C">⚑</text>
                <text x={p.x} y={p.y - 22} textAnchor="middle" fontSize="10" fontFamily="monospace" fill="#bff3d4" fontWeight="bold">BASE CAMP</text>
                <text x={p.x} y={p.y + 34} textAnchor="middle" fontSize="9.5" fontFamily="monospace" fill="#7dd8b8">QUEST SIGNED ✓</text>
              </g>
            );
          }
          if (p.kind === "vault") {
            return (
              <g key={i} shapeRendering="crispEdges">
                <rect x={p.x - 20} y={p.y - 20} width="40" height="34" fill="#6e6a8a" stroke="#3a3752" strokeWidth="3" />
                <rect x={p.x - 20} y={p.y - 26} width="8" height="8" fill="#6e6a8a" /><rect x={p.x + 12} y={p.y - 26} width="8" height="8" fill="#6e6a8a" />
                <rect x={p.x - 2} y={p.y - 30} width="4" height="10" fill="#8a5a22" /><path d={`M${p.x + 2} ${p.y - 30} h12 l-12 6 Z`} fill="#e24b4a" />
                <rect x={p.x - 6} y={p.y - 4} width="12" height="18" fill="#3d2b12" />
                <rect x={p.x - 3} y={p.y + 2} width="6" height="6" fill="#ffd76a" />
                <text x={p.x} y={p.y - 38} textAnchor="middle" fontSize="10" fontFamily="monospace" fill="#ffd76a" fontWeight="bold">THE VAULT</text>
                <text x={p.x} y={p.y + 32} textAnchor="middle" fontSize="9.5" fontFamily="monospace" fill="#ffd76a">+{xpReward.toLocaleString()} XP</text>
              </g>
            );
          }
          const s = p.slot!;
          const done = s.status === "READY" || s.status === "POSTED";
          const failed = s.status === "FAILED";
          const activeHere = i === curIdx;
          const fill = done ? "#1D9E75" : failed ? "#8a2f2f" : activeHere ? "#ffd76a" : "#26264a";
          const stroke = done ? "#04342C" : failed ? "#4a1414" : activeHere ? "#854f0b" : "#3e3e66";
          const top = p.y === y1;
          const statusTxt =
        s.status === "READY" ? "READY ✓" :
        s.status === "POSTED" ? "POSTED ✓" :
        s.status === "FAILED" ? "FAILED" :
        s.status === "FORGING" || (activeHere && rendering) ? "FORGING…" :
        `${fmtDow(s.date)} ${fmtTime(s.time)}`;
          const statusFill = done ? "#7dd8b8" : failed ? "#f09595" : activeHere ? "#fff3c9" : "#cfd0ee";
          const sel = selectedIdx === s.idx;
          return (
            <g key={i} onClick={() => onPick(s.idx)} style={{ cursor: "pointer" }}>
              {activeHere && (
                <circle cx={p.x} cy={p.y} fill="none" stroke="#34E7E4" strokeWidth="2">
                  <animate attributeName="r" values="15;30" dur="1.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.8;0" dur="1.6s" repeatCount="indefinite" />
                </circle>
              )}
              {sel && <rect x={p.x - 18} y={p.y - 18} width="36" height="36" fill="none" stroke="#34E7E4" strokeWidth="2" shapeRendering="crispEdges" />}
              <rect x={p.x - 13} y={p.y - 13} width="26" height="26" fill={fill} stroke={stroke} strokeWidth="3" shapeRendering="crispEdges" />
              <text x={p.x} y={p.y + 5} textAnchor="middle" fontSize="12" fill={done ? "#04342C" : "#e8e8f0"}>{done ? "✓" : NODE_ICON[s.type] || "⬜"}</text>
              <text x={p.x} y={top ? p.y - 34 : p.y + 30} textAnchor="middle" fontSize="9.5" fontFamily="monospace" fill="#ffe9b0" fontWeight="bold">{s.spot}</text>
              <text x={p.x} y={top ? p.y - 22 : p.y + 42} textAnchor="middle" fontSize="9.5" fontFamily="monospace" fill={statusFill}>
                DAY {s.day} · {statusTxt}
              </text>
            </g>
          );
        })}
      </svg>
      {partner && (
        <div className="qh-partner" style={{ left: `${(cur.x / 660) * 100}%`, top: `${(cur.y / 268) * 100}%` }}>
          <Partner img={partner.img} accent={partner.accent} />
          {rendering && <span className="qh-work-tool" aria-hidden="true">⚒️</span>}
          <span className={`tag${rendering ? " working" : ""}`}>
            {rendering ? `FORGING AT ${curSpot}` : `${partner.name} · ${curSpot}`}
          </span>
        </div>
      )}
      {cargo.length > 0 && (
        <div className="qh-cargo" title={cargo.map((c) => c.title).join(", ")}>
          {cargo.slice(0, 3).map((c, i) => (c.image ? <img key={i} src={c.image} alt="" /> : null))}
          <span className="lb">CARGO ×{cargo.length}</span>
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
  const refunded = actionData && "refunded" in actionData ? (actionData.refunded as number) : 0;

  const available = AVATARS.filter((a) => castAvail[a.id]);
  const [starId, setStarId] = useState<string>(brandFace?.id && castAvail[brandFace.id] ? brandFace.id : available[0]?.id || "");
  const starVariant = brandFace?.id === starId ? brandFace.variant : 0;
  const [bag, setBag] = useState<{ id: string; title: string; image: string | null }[]>([]);
  const [reviewMode, setReviewMode] = useState<"REVIEW_FIRST" | "SET_AND_FORGET">("REVIEW_FIRST");
  const [editSel, setEditSel] = useState<{ qid: string; idx: number } | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");

  const canRun = (minTier: string) => (TIER_RANK[tier] ?? 0) >= (TIER_RANK[minTier] ?? 1);
  const firstUnlocked = QUESTLINES.find((q) => canRun(q.minTier)) || QUESTLINES[0];
  const [selKey, setSelKey] = useState(firstUnlocked.key);
  const sel = QUESTLINE_BY_KEY[selKey] || firstUnlocked;
  const selCost = questlineTokenCost(sel);
  const selLocked = !canRun(sel.minTier);
  const selAffordable = tokens >= selCost;
  const bagCapped = bag.slice(0, sel.bagSize);

  const active = questlines.filter((q) => q.status !== "COMPLETE");
  const done = questlines.filter((q) => q.status === "COMPLETE");

  const toggleItem = (p: { id: string; title: string; image: string | null }) => {
    setBag((cur) => {
      if (cur.some((b) => b.id === p.id)) return cur.filter((b) => b.id !== p.id);
      if (cur.length >= sel.bagSize) return cur; // bag full
      return [...cur, p];
    });
  };

  // The partner never bluffs — every line below derives from real state.
  const pName = partner?.name || "BYTE";
  let dialog: string;
  if (accepted) {
    dialog = "Contract signed. I've mapped the whole month — every stop has a date, a time, and an item from the bag. First forge fires a day before its slot. Check the board.";
  } else if (active.length > 0) {
    const q = active[0];
    const isRendering = renderingIds.includes(q.id);
    const next = q.slots.find((s) => s.status === "SCHEDULED" || s.status === "FORGING");
    if (q.status === "PAUSED") {
      dialog = `"${q.name}" is paused — the calendar holds its dates. Resume whenever you're ready.`;
    } else if (isRendering && next) {
      dialog = `Working at ${next.spot} right now — the DAY ${next.day} ${next.type} drop${next.productTitle ? ` starring ${next.productTitle}` : ""}. It'll be READY before its ${fmtDow(next.date)} ${fmtTime(next.time)} slot.`;
    } else if (next) {
      dialog = `Day ${q.dayOf} of ${q.duration}. Next stop: ${next.spot} — a ${next.type} drop on ${fmtDow(next.date)} at ${fmtTime(next.time)}${next.productTitle ? ` featuring ${next.productTitle}` : ""}. Click any stop on the board to move its date.`;
    } else {
      dialog = `Every stop on "${q.name}" is forged. The vault opens — check the completed log.`;
    }
  } else if (done.length > 0) {
    dialog = `Quest complete — ${done[0].xpReward.toLocaleString()} XP banked. Pick next month's mission and I'm back on the road.`;
  } else if (tokens < questlineTokenCost(firstUnlocked)) {
    dialog = "Your token balance won't cover a quest yet — hit INSERT COINS in the HUD and I'll get to work the second we're funded.";
  } else {
    dialog = "No expedition running. Pick a monthly quest below — I plan the calendar, forge every piece a day early, and man every stop on the map.";
  }

  const startQuest = () => {
    submit(
      {
        intent: "accept", template: sel.key,
        bag: JSON.stringify(bagCapped.map((b) => ({ title: b.title, image: b.image }))),
        avatarId: starId, avatarVariant: String(starVariant), reviewMode,
      },
      { method: "post" }
    );
  };

  const openEditor = (qid: string, slots: QuestSlot[], idx: number) => {
    const s = slots.find((x) => x.idx === idx);
    if (!s) return;
    setEditSel({ qid, idx });
    setEditDate(s.date);
    setEditTime(s.time);
  };

  return (
    <Page backAction={{ content: "Home", url: "/app" }}>
      <div className="qh-head">
        <span className="qh-title">CAMPAIGN <em>QUESTS</em></span>
        <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
          <span className="qh-chip" title="The AI autopilot plans the month, forges content on schedule, and reports here">
            <span className="dot" />AI AUTOPILOT · {working ? "WORKING" : "ONLINE"}
          </span>
          <span className="qh-chip idle"><span className="dot" />🪙 {tokens.toLocaleString()}</span>
        </span>
      </div>

      {err && (
        <Box paddingBlockEnd="300"><Banner tone="critical" title="Couldn't do that"><p>{err}</p></Banner></Box>
      )}
      {refunded > 0 && (
        <Box paddingBlockEnd="300"><Banner tone="success" title="Quest abandoned"><p>{refunded} tokens refunded for content that hadn't been forged yet. Finished content stays in your library.</p></Banner></Box>
      )}

      {/* Active expeditions — the adventure boards */}
      {active.map((q) => (
        <div key={q.id} className="qh-win" style={{ marginBottom: 16 }}>
          <span className="qh-label">
            ▶ {q.name.toUpperCase()}
            <span className="r">
              DAY {q.dayOf} OF {q.duration} · {q.slots.filter((s) => s.status === "READY" || s.status === "POSTED").length} FORGED · {q.slots.filter((s) => s.status === "SCHEDULED" || s.status === "FORGING").length} SCHEDULED
              {q.avatarId && AVATAR_BY_ID[q.avatarId] ? ` · ★ ${AVATAR_BY_ID[q.avatarId].name}` : ""}
            </span>
          </span>
          <TrailMap
            slots={q.slots}
            xpReward={q.xpReward}
            rendering={q.status === "ACTIVE" && renderingIds.includes(q.id)}
            partner={partner}
            cargo={q.productImageUrl ? [{ title: q.productTitle || "", image: q.productImageUrl }] : []}
            onPick={(idx) => openEditor(q.id, q.slots, idx)}
            selectedIdx={editSel?.qid === q.id ? editSel.idx : null}
          />
          {editSel?.qid === q.id && (() => {
            const s = q.slots.find((x) => x.idx === editSel.idx);
            if (!s) return null;
            const locked = s.status === "READY" || s.status === "POSTED";
            return (
              <div className="qh-slot-editor">
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div className="spot">{NODE_ICON[s.type]} {s.spot}</div>
                  <div className="meta">DAY {s.day} · {s.type} drop{s.productTitle ? ` · ${s.productTitle}` : ""} · {s.status}</div>
                </div>
                {locked ? (
                  <div className="meta" style={{ color: "#8ee89c" }}>Already forged ✓ — find it in the library</div>
                ) : (
                  <>
                    <div>
                      <label className="qh-field-label" htmlFor="qh-edit-date">Post date</label>
                      <input id="qh-edit-date" className="qh-input" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                    </div>
                    <div>
                      <label className="qh-field-label" htmlFor="qh-edit-time">Time</label>
                      <input id="qh-edit-time" className="qh-input" type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} />
                    </div>
                    <button
                      type="button" className="qh-mini-btn" disabled={busy}
                      onClick={() => submit({ intent: "reschedule", questlineId: q.id, slotIdx: String(editSel.idx), date: editDate, time: editTime }, { method: "post" })}
                    >
                      💾 Save stop
                    </button>
                  </>
                )}
                <button type="button" className="qh-mini-btn" onClick={() => setEditSel(null)}>Close</button>
              </div>
            );
          })()}
          <div className="qh-quest-foot">
            <span className="xp">🏆 {q.xpReward.toLocaleString()} XP IN THE VAULT · +100 XP PER PERFECT WEEK</span>
            <span style={{ display: "inline-flex", gap: 8 }}>
              <button type="button" className="qh-mini-btn" onClick={() => submit({ intent: "pauseToggle", questlineId: q.id }, { method: "post" })}>
                {q.status === "PAUSED" ? "▶ Resume" : "⏸ Pause"}
              </button>
              <button
                type="button" className="qh-mini-btn danger"
                onClick={() => { if (confirm("Abandon this expedition? Tokens for unforged content are refunded; finished content stays in your library.")) submit({ intent: "delete", questlineId: q.id }, { method: "post" }); }}
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

        <div className="qh-win gold">
          <span className="qh-label gold">NEW QUESTS<span className="r">monthly expeditions</span></span>
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
          <span className="r">30-day expedition{sel.recurring ? " · renews monthly" : ""}</span>
        </span>
        <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, color: "#a8a8cc", margin: "0 0 12px", lineHeight: 1.6 }}>
          {sel.tagline} Posting rhythm: {sel.cadence}.
        </p>
        <div className="qh-detail-objs">
          {sel.objectives.map((o, i) => (
            <div key={i}>{NODE_ICON[o.type]} {o.target}× {o.label}</div>
          ))}
          <div style={{ color: "#8ee89c" }}>🏆 Reward: {sel.xpReward.toLocaleString()} XP + 100 XP per perfect week</div>
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
              🎒 BACKPACK — equip up to {sel.bagSize} items; the AI rotates them across the month{" "}
              <span className={bagCapped.length > 0 ? "qh-equipped-line" : ""} style={bagCapped.length === 0 ? { color: "#7d7da8" } : undefined}>
                — {bagCapped.length}/{sel.bagSize} equipped
              </span>
            </span>
            <div className="qh-bag">
              {products.map((p) => {
                const inBag = bag.some((b) => b.id === p.id);
                return (
                  <button
                    key={p.id} type="button"
                    className={`qh-slot${inBag ? " on" : ""}`}
                    title={p.title}
                    onClick={() => toggleItem(p)}
                  >
                    {p.image ? <img src={p.image} alt={p.title} loading="lazy" /> : <span className="ph">🛍️</span>}
                    <span className="qh-slot-name">{p.title}</span>
                  </button>
                );
              })}
              {Array.from({ length: Math.max(0, (8 - (products.length % 8)) % 8) }).map((_, i) => (
                <div key={`e${i}`} className="qh-slot empty" aria-hidden="true">·</div>
              ))}
            </div>
          </div>
        )}

        <button
          type="button" className="qh-start"
          disabled={busy || selLocked || bagCapped.length === 0 || !selAffordable || !starId}
          onClick={startQuest}
        >
          {selLocked ? `🔒 ${sel.minTier} PLAN REQUIRED` : busy ? "SIGNING…" : `▶ START 30-DAY QUEST — ${selCost.toLocaleString()} 🪙`}
        </button>
        {!selLocked && (
          <div className="qh-hint">
            {bagCapped.length === 0 ? "Equip at least one item from your backpack to unlock the mission" :
              !selAffordable ? `Needs ${selCost.toLocaleString()} tokens — you have ${tokens.toLocaleString()}. INSERT COINS in the HUD to top up.` :
              "Tokens cover the month's content. Abandoning refunds unforged pieces. Ad spend always runs on your own connected accounts."}
          </div>
        )}
      </div>

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
