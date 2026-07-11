import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import fs from "node:fs";
import path from "node:path";
import { Page, Banner, Box } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { tokensRemaining } from "../lib/tokens.server";
import { acceptQuestline, rescheduleSlot, abandonQuestline } from "../lib/questlines.server";
import {
  QUESTLINES, QUESTLINE_BY_KEY, DESTINATION_BY_KEY, questlineTokenCost, parseSchedule, spotName,
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

/* ---- The painted overworld ----
 * Background is real generated pixel-art (public/quests/worldmap.jpg,
 * 1536x640). The journey follows a hand-tuned waypoint route across its
 * terrain; stops are spaced evenly along that route by arc length (pure
 * math — SSR-safe). Label restraint: the current stop speaks at full
 * volume, everything else whispers until hovered/clicked. */

const MAP_W = 1536;
const MAP_H = 640;

/* Waypoints trace the art's own roads: shop meadow -> cherry grove -> pond ->
 * palm grove -> village row -> beach cove -> headland -> the tower town. */
const ROUTE: [number, number][] = [
  [355, 390], [480, 315], [620, 250], [770, 340],
  [930, 285], [1075, 320], [1160, 285], [1250, 240],
];

/** Even points along the waypoint polyline (t in 0..1 by arc length). */
function routePoint(t: number): { x: number; y: number } {
  const segs: number[] = [];
  let total = 0;
  for (let i = 1; i < ROUTE.length; i++) {
    const d = Math.hypot(ROUTE[i][0] - ROUTE[i - 1][0], ROUTE[i][1] - ROUTE[i - 1][1]);
    segs.push(d);
    total += d;
  }
  let target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i]) {
      const f = segs[i] === 0 ? 0 : target / segs[i];
      return {
        x: ROUTE[i][0] + (ROUTE[i + 1][0] - ROUTE[i][0]) * f,
        y: ROUTE[i][1] + (ROUTE[i + 1][1] - ROUTE[i][1]) * f,
      };
    }
    target -= segs[i];
  }
  return { x: ROUTE[ROUTE.length - 1][0], y: ROUTE[ROUTE.length - 1][1] };
}

function TrailMap({ slots, xpReward, rendering, partner, cargo, onPick, selectedIdx, destination }: {
  slots: QuestSlot[]; xpReward: number; rendering: boolean;
  partner: { img: string; accent: string; name: string } | null;
  cargo: { title: string; image: string | null }[];
  onPick: (idx: number) => void; selectedIdx: number | null;
  destination: string;
}) {
  const n = slots.length;
  const start = routePoint(0);
  const end = routePoint(1);
  const pts = slots.map((s, i) => ({ slot: s, ...routePoint(0.09 + (i * 0.82) / Math.max(1, n - 1)) }));

  // The partner stands at the stop it's working / traveling toward.
  let curI = pts.findIndex((p) => p.slot.status === "FORGING" || p.slot.status === "SCHEDULED" || p.slot.status === "FAILED");
  const allDone = curI === -1;
  const cur = allDone ? end : pts[curI];
  const curSpot = allDone ? destination : pts[curI].slot.spot;

  const routeD = [start, ...pts, end].map((p, i) => `${i === 0 ? "M" : "L"} ${Math.round(p.x)} ${Math.round(p.y)}`).join(" ");

  // Panorama: the world renders wide and scrolls; open centered on the partner.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = (cur.x / MAP_W) * 1280 - el.clientWidth / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="qh-mapwrap">
    <div className="qh-map" ref={scrollRef}>
    <div className="qh-map-inner">
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label="Campaign world map">
        <image href="/quests/worldmap.jpg" width={MAP_W} height={MAP_H} />
        {/* route: soft shadow + golden dashes */}
        <path d={routeD} fill="none" stroke="#1a1206" strokeWidth="11" opacity="0.35" strokeLinejoin="round" strokeLinecap="round" />
        <path d={routeD} fill="none" stroke="#ffd76a" strokeWidth="5" strokeDasharray="2 16" strokeLinecap="round" opacity="0.95" />

        {/* YOUR SHOP — the journey starts at the merchant's own storefront */}
        <g style={{ paintOrder: "stroke" }}>
          <circle cx={start.x} cy={start.y} r="15" fill="#7c5cff" stroke="#241a4d" strokeWidth="4" />
          <text x={start.x} y={start.y + 7} textAnchor="middle" fontSize="18">🏪</text>
          <text x={start.x} y={start.y + 44} textAnchor="middle" fontSize="21" fontFamily="monospace" fontWeight="bold"
            fill="#e8e2ff" stroke="#14102a" strokeWidth="5" paintOrder="stroke">YOUR SHOP</text>
        </g>

        {pts.map((p, i) => {
          const s = p.slot;
          const done = s.status === "READY" || s.status === "POSTED";
          const failed = s.status === "FAILED";
          const activeHere = i === curI && !allDone;
          const sel = selectedIdx === s.idx;
          const fill = done ? "#2fbf8a" : failed ? "#d24b4b" : activeHere ? "#ffd76a" : "#3a3560";
          const ring = done ? "#0d4a33" : failed ? "#571414" : activeHere ? "#7a4c08" : "#171430";
          const labelUp = p.y > 330; // keep labels off the water/edges
          // stagger alternate stops onto a second lane so neighbors never collide
          const lane = (i % 2) * 26;
          const ly = labelUp ? p.y - 34 - lane : p.y + 44 + lane;
          const ly2 = labelUp ? p.y - 58 - lane : p.y + 68 + lane;
          return (
            <g key={s.idx} onClick={() => onPick(s.idx)} style={{ cursor: "pointer" }}>
              {activeHere && (
                <circle cx={p.x} cy={p.y} fill="none" stroke="#34E7E4" strokeWidth="4">
                  <animate attributeName="r" values="20;46" dur="1.7s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.9;0" dur="1.7s" repeatCount="indefinite" />
                </circle>
              )}
              {sel && <circle cx={p.x} cy={p.y} r="24" fill="none" stroke="#34E7E4" strokeWidth="4" />}
              <circle cx={p.x} cy={p.y} r={activeHere ? 17 : 13} fill={fill} stroke={ring} strokeWidth="4" />
              <text x={p.x} y={p.y + 6} textAnchor="middle" fontSize={activeHere ? 17 : 14}>
                {done ? "✓" : failed ? "✕" : NODE_ICON[s.type] || "•"}
              </text>
              {/* label discipline: current stop full voice, others a whisper */}
              {activeHere ? (
                <g>
                  <text x={p.x} y={ly} textAnchor="middle" fontSize="23" fontFamily="monospace" fontWeight="bold"
                    fill="#fff3c9" stroke="#14102a" strokeWidth="6" paintOrder="stroke">{s.spot}</text>
                  <text x={p.x} y={labelUp ? ly2 + 46 : ly2} textAnchor="middle" fontSize="19" fontFamily="monospace"
                    fill={rendering ? "#7ff5f2" : "#e0d9b8"} stroke="#14102a" strokeWidth="5" paintOrder="stroke">
                    {`DAY ${s.day} · ${rendering ? "FORGING…" : `${fmtDow(s.date)} ${fmtTime(s.time)}`}`}
                  </text>
                </g>
              ) : (
                <text x={p.x} y={ly} textAnchor="middle" fontSize="18" fontFamily="monospace"
                  fill={done ? "#bfe9d6" : failed ? "#f0a8a8" : "#cfc9ea"} opacity={done || failed ? 0.95 : 0.75}
                  stroke="#14102a" strokeWidth="5" paintOrder="stroke">
                  {failed ? `${s.spot} · GOBLIN!` : done ? `${s.spot} ✓` : `${s.spot} · D${s.day}`}
                </text>
              )}
              {/* a goblin squats on failed stops until the merchant retries */}
              {failed && (
                <g transform={`translate(${p.x + 20}, ${p.y - 34}) scale(2)`} shapeRendering="crispEdges">
                  <rect width="13" height="11" fill="#5d8a4a" />
                  <rect x="3" y="-4" width="3" height="4" fill="#5d8a4a" /><rect x="8" y="-4" width="3" height="4" fill="#5d8a4a" />
                  <rect x="3" y="3" width="2" height="2" fill="#e8d44a" /><rect x="8" y="3" width="2" height="2" fill="#e8d44a" />
                  <animateTransform attributeName="transform" type="translate" additive="sum" values="0 0; 0 -6; 0 0" keyTimes="0;0.5;1" dur="0.9s" repeatCount="indefinite" />
                </g>
              )}
            </g>
          );
        })}

        {/* destination — the quest's own landmark; the chest opens on arrival */}
        <g style={{ paintOrder: "stroke" }}>
          {allDone && (
            <circle cx={end.x} cy={end.y} fill="none" stroke="#ffd76a" strokeWidth="4">
              <animate attributeName="r" values="20;50" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.9;0" dur="2s" repeatCount="indefinite" />
            </circle>
          )}
          <circle cx={end.x} cy={end.y} r="16" fill={allDone ? "#ffd76a" : "#8a6a2e"} stroke="#3d2b12" strokeWidth="4" />
          <text x={end.x} y={end.y + 7} textAnchor="middle" fontSize="18">{allDone ? "🏆" : "🏁"}</text>
          <text x={end.x} y={end.y - 30} textAnchor="middle" fontSize="22" fontFamily="monospace" fontWeight="bold"
            fill="#ffe9b0" stroke="#14102a" strokeWidth="6" paintOrder="stroke">{destination}</text>
          <text x={end.x} y={end.y - 56} textAnchor="middle" fontSize="18" fontFamily="monospace"
            fill="#ffd76a" stroke="#14102a" strokeWidth="5" paintOrder="stroke">+{xpReward.toLocaleString()} XP</text>
        </g>

        {/* a bird crossing the sky, slow and rare */}
        <g opacity="0.55">
          <path d="M0 70 q7 -8 14 0 q7 -8 14 0" stroke="#14102a" strokeWidth="3" fill="none">
            <animateTransform attributeName="transform" type="translate" values="-60 0; 1600 -40" dur="26s" repeatCount="indefinite" />
          </path>
        </g>
      </svg>
      {partner && (
        <div className="qh-partner" style={{ left: `${(cur.x / MAP_W) * 100}%`, top: `${(cur.y / MAP_H) * 100}%` }}>
          <Partner img={partner.img} accent={partner.accent} />
          {rendering && <span className="qh-work-tool" aria-hidden="true">⚒️</span>}
          <span className={`tag${rendering ? " working" : ""}`}>
            {rendering ? `FORGING AT ${curSpot}` : `${partner.name} · ${curSpot}`}
          </span>
        </div>
      )}
    </div>
    </div>
    {/* pinned chrome — stays put while the world scrolls underneath */}
    {cargo.length > 0 && (
      <div className="qh-cargo" title={cargo.map((c) => c.title).join(", ")}>
        {cargo.slice(0, 3).map((c, i) => (c.image ? <img key={i} src={c.image} alt="" /> : null))}
        <span className="lb">CARGO ×{cargo.length}</span>
      </div>
    )}
    <span className="qh-map-hint">⟷ drag to explore the world</span>
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
            ▶ {q.name.toUpperCase()} → {DESTINATION_BY_KEY[q.template] || "JOURNEY'S END"}
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
            destination={DESTINATION_BY_KEY[q.template] || "JOURNEY'S END"}
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

        {products.length > 0 && (() => {
          const drops = sel.objectives.filter((o) => o.type !== "post").reduce((s, o) => s + o.target, 0);
          const pouchCols = 3; // pockets sewn onto the bag art's front panel
          const say =
            bagCapped.length === 0 ? "Pack at least 1 item to march." :
            bagCapped.length >= sel.bagSize ? `Fully loaded! Each item gets ~${Math.round((drops / sel.bagSize) * 10) / 10} drops this month.` :
            `${bagCapped.length} packed — the AI rotates ${bagCapped.length === 1 ? "it" : "them"} across the month's ${drops} drops.`;
          return (
            <div className="qh-packgrid" style={{ marginBottom: 14 }}>
              <div>
                <span className="qh-field-label">SUPPLY SHELF — your store catalog · click an item to pack it</span>
                <div className="qh-bag">
                  {products.map((p) => {
                    const inBag = bag.some((b) => b.id === p.id);
                    return (
                      <button
                        key={p.id} type="button"
                        className={`qh-slot${inBag ? " ghost" : ""}`}
                        title={inBag ? `${p.title} — already packed` : p.title}
                        onClick={() => { if (!inBag) toggleItem(p); }}
                      >
                        {p.image ? <img src={p.image} alt={p.title} loading="lazy" /> : <span className="ph">🛍️</span>}
                        <span className="qh-slot-name">{p.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="qh-bagcol">
                <span className="qh-field-label">🎒 YOUR PACK — {sel.bagSize} pouches · click a pouch to unpack</span>
                <div key={bagCapped.length} className="qh-bagart" style={{ animation: bagCapped.length ? "qh-bag-wiggle .4s ease" : undefined }}>
                  <img src="/quests/backpack.jpg" alt="Adventurer's backpack" />
                  <div className="qh-pouches" style={{ gridTemplateColumns: `repeat(${pouchCols}, 1fr)` }}>
                    {Array.from({ length: sel.bagSize }).map((_, i) => {
                      const item = bagCapped[i];
                      return item ? (
                        <button key={i} type="button" className="qh-pouch full" title={`${item.title} — click to unpack`} onClick={() => toggleItem(item)}>
                          {item.image ? <img src={item.image} alt={item.title} /> : <span style={{ fontSize: 22 }}>🛍️</span>}
                        </button>
                      ) : (
                        <div key={i} className="qh-pouch">+</div>
                      );
                    })}
                  </div>
                </div>
                <div className="qh-load-row"><span>PACK LOAD</span><span>{bagCapped.length}/{sel.bagSize}</span></div>
                <div className="qh-load-bar"><i style={{ width: `${(bagCapped.length / sel.bagSize) * 100}%` }} /></div>
                <div className="qh-pack-say">{say}</div>
              </div>
            </div>
          );
        })()}

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
