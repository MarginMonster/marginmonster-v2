import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import fs from "node:fs";
import path from "node:path";
import { Page, Banner, Box } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { tokensRemaining } from "../lib/tokens.server";
import { acceptQuestline, rescheduleSlot, abandonQuestline, swapQuestlineItem } from "../lib/questlines.server";
import {
  QUESTLINES, QUESTLINE_BY_KEY, DESTINATION_BY_KEY, questlineTokenCost, parseSchedule, spotName,
  QUEST_DURATION_DAYS, type QuestSlot, type ObjectiveType,
} from "../lib/questlines";
import { AVATARS, AVATAR_BY_ID, avatarImg } from "../lib/avatars";
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
    feed: [] as { ts: number; t: string; msg: string; tone: string; href?: string }[],
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

  const planType = (shop.activePlan?.type || "STARTER") as PlanKey;
  const pd = PARTNER_BY_PLAN[planType] || PARTNER_BY_PLAN.STARTER;

  /* Quest Journal — tales from the road. Only about ACTIVE questlines; every
   * entry maps a real pipeline event into the partner's voice, with a link to
   * the true reward where one exists. */
  const now = Date.now();
  const activeQls = shop.questlines.filter((q) => q.status !== "COMPLETE");
  const qlById = new Map(activeQls.map((q) => [q.id, { name: q.name, slots: parseSchedule(q.scheduleJson).slots }]));
  let feed: { ts: number; t: string; msg: string; tone: string; href?: string }[] = [];
  const renderingIds: string[] = [];
  let working = false;
  try {
    const jobs = await db.job.findMany({
      where: { shopId: shop.id, type: { in: ["GENERATE_VIDEO_AD", "GENERATE_IMAGE_AD", "GENERATE_BLOG_POST"] } },
      orderBy: { updatedAt: "desc" },
      take: 40,
    });
    for (const j of jobs) {
      let p: Record<string, unknown> = {};
      try { p = JSON.parse(j.payload); } catch { /* skip */ }
      const qid = p.questlineId as string | undefined;
      if (!qid || !qlById.has(qid)) continue;
      if (j.status === "IN_PROGRESS") { working = true; renderingIds.push(qid); }
      const ql = qlById.get(qid)!;
      const slot = typeof p.slotIdx === "number" ? ql.slots.find((s) => s.idx === p.slotIdx) : undefined;
      const spot = slot?.spot || "the trail";
      const kind = j.type === "GENERATE_IMAGE_AD" ? "image ad" : j.type === "GENERATE_BLOG_POST" ? "blog post" : "video take";
      const ts = j.updatedAt.getTime();
      const t = rel(ts, now);
      if (j.status === "COMPLETED") {
        feed.push({
          ts, t, tone: "ok",
          msg: `${pd.name} delivered the ${spot} ${kind} — +25 XP found! ✨`,
          href: j.type === "GENERATE_VIDEO_AD" ? "/app/videos" : "/app/assets",
        });
      } else if (j.status === "FAILED") {
        feed.push({ ts, t, tone: "bad", msg: `A goblin ambushed ${pd.name} at ${spot}! Retry to drive it off`, href: "/app/videos" });
      } else if (j.status === "IN_PROGRESS") {
        const msg =
          p.ckTalkingUrl ? `${pd.name} is stitching the final cut at ${spot} 🎬` :
          p.ckOmniId ? `${pd.name} is forging the ${spot} take at the anvil ⚒️` :
          p.ckAudioUrl ? `A voice echoes through ${spot} — the recording is done 🎙️` :
          p.ckScript ? `${pd.name} penned a script by the ${spot} campfire ✍️` :
          `${pd.name} is hard at work at ${spot}`;
        feed.push({ ts, t, tone: "hot", msg });
      } else if (slot) {
        feed.push({ ts, t, tone: "", msg: `${pd.name} camps until DAY ${slot.day} — the ${spot} ${kind} drops ${fmtDow(slot.date)} ${fmtTime(slot.time)}` });
      }
    }
    // The day the contract was signed is a tale too.
    for (const q of activeQls) {
      feed.push({ ts: q.createdAt.getTime(), t: rel(q.createdAt.getTime(), now), tone: "hot", msg: `${pd.name} signed the ${q.name} contract — the expedition begins! 📜` });
    }
    feed.sort((a, b) => b.ts - a.ts);
    feed = feed.slice(0, 8);
  } catch (e) {
    console.error("[quests] journal load failed (non-fatal):", e);
  }

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

  if (intent === "swapItem") {
    const res = await swapQuestlineItem(
      shop.id,
      (form.get("questlineId") as string) || "",
      (form.get("fromTitle") as string) || "",
      { title: (form.get("toTitle") as string) || "", image: ((form.get("toImage") as string) || "").trim() || null }
    );
    return json(res.ok ? { swapped: res.swapped } : { error: res.error });
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

/* Tiny pixel villagers — biome-dressed locals who walk, work, and gossip so
 * the world never feels lonely. Two-frame gait, mirrored patrols. */
function NpcBody({ tunic, skin = "#e8b48a", hat, walking = true }: { tunic: string; skin?: string; hat?: React.ReactNode; walking?: boolean }) {
  return (
    <g shapeRendering="crispEdges">
      <rect x="1" y="-14" width="6" height="6" fill={skin} />
      {hat}
      <rect x="0" y="-8" width="8" height="8" fill={tunic} />
      {walking ? (
        <>
          <g className="qh-fA"><rect x="1" y="0" width="2.5" height="5" fill="#2a2438" /><rect x="4.5" y="0" width="2.5" height="5" fill="#2a2438" /></g>
          <g className="qh-fB"><rect x="2.8" y="0" width="2.5" height="5" fill="#2a2438" /></g>
        </>
      ) : (
        <><rect x="1" y="0" width="2.5" height="5" fill="#2a2438" /><rect x="4.5" y="0" width="2.5" height="5" fill="#2a2438" /></>
      )}
    </g>
  );
}
function Bubble({ delay, shout = false }: { delay: number; shout?: boolean }) {
  return (
    <g className="qh-bubble" style={{ ["--bd" as string]: `${delay}s` }}>
      <rect x="-8" y="-31" width="21" height="12" rx="4" fill="#fdfdf4" stroke="#2a2438" strokeWidth="1.2" />
      <path d="M 0 -19 l 3 4 l 2 -4 Z" fill="#fdfdf4" />
      {shout ? (
        <text x="2.5" y="-21.5" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#2a2438">!</text>
      ) : (
        <g fill="#2a2438"><circle cx="-2.5" cy="-25" r="1.2" /><circle cx="2.5" cy="-25" r="1.2" /><circle cx="7.5" cy="-25" r="1.2" /></g>
      )}
    </g>
  );
}

/* ---- The painted panorama ----
 * The month is a journey across FOUR stitched pixel-art worlds (meadow ->
 * desert -> tundra -> volcano), blended at the seams with gradient masks.
 * Every day of the quest is a destination on the road: content days are
 * named landmark stops, quiet days are small waypoints the partner still
 * travels through. Grab-and-drag to pan; auto-centers on the partner. */

const MAP_W = 1536;
const MAP_H = 640;
const SEAM = 140; // px of gradient overlap where one world fades into the next
const STEP = MAP_W - SEAM; // x offset between consecutive worlds

type World = { src: string; route: [number, number][] };
const WORLDS: World[] = [
  {
    src: "/quests/worldmap.jpg", // spring meadow & cove
    route: [[355, 390], [480, 315], [620, 250], [770, 340], [930, 285], [1075, 320], [1250, 245], [1470, 300]],
  },
  {
    src: "/quests/world-desert.jpg", // red canyon: oasis -> bridge -> caravan tents
    route: [[70, 470], [430, 480], [450, 400], [640, 360], [875, 335], [1040, 470], [1185, 415], [1470, 430]],
  },
  {
    src: "/quests/world-tundra.jpg", // snow: bridge -> cabin village road
    route: [[70, 430], [470, 390], [700, 330], [940, 300], [1150, 345], [1470, 360]],
  },
  {
    src: "/quests/world-volcano.jpg", // jungle isles -> waterfall cove -> the golden temple
    route: [[70, 480], [300, 520], [560, 470], [770, 430], [930, 400], [865, 330]],
  },
];
const PANO_W = STEP * (WORLDS.length - 1) + MAP_W;

/* Combined route across all worlds (each world's local xs shifted right). */
const ROUTE: [number, number][] = WORLDS.flatMap((w, k) =>
  w.route.map(([x, y]) => [x + k * STEP, y] as [number, number])
);

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

/** Day -> position along the month-long road (day 0 = the shop, last = goal). */
function dayT(day: number, duration: number): number {
  return 0.03 + (Math.max(0, Math.min(duration, day)) / duration) * 0.94;
}

/* Ambient life — birds in every sky, per-world ground critters. Positions are
 * in local world coords; rendered offset per world. Slow, sparse, gentle. */
const BIRD_LANES = [
  { y: 60, dur: 34, delay: 0, size: 1 },
  { y: 96, dur: 46, delay: 12, size: 0.8 },
  { y: 42, dur: 55, delay: 26, size: 1.2 },
];

function TrailMap({ slots, xpReward, rendering, partner, cargo, onPick, onPickDay, onOpenBag, selectedIdx, selectedDay, destination, dayOf, duration }: {
  slots: QuestSlot[]; xpReward: number; rendering: boolean;
  partner: { img: string; accent: string; name: string } | null;
  cargo: { title: string; image: string | null }[];
  onPick: (idx: number) => void; onPickDay: (day: number) => void; onOpenBag: () => void;
  selectedIdx: number | null; selectedDay: number | null;
  destination: string; dayOf: number; duration: number;
}) {
  const start = routePoint(0);
  const end = routePoint(1);
  const RENDER_W = 3200; // panorama pixels on screen (scrolls)

  // Content stops sit on their scheduled day; quiet days are small waypoints.
  const stopPts = slots.map((s) => ({ slot: s, ...routePoint(dayT(s.day, duration)) }));
  const slotDays = new Set(slots.map((s) => s.day));
  const waypointDays = Array.from({ length: duration }, (_, i) => i + 1).filter((d) => !slotDays.has(d));

  const contentDone = slots.every((s) => s.status === "READY" || s.status === "POSTED");
  const here = contentDone ? end : routePoint(dayT(Math.min(dayOf, duration), duration));
  // What the partner is up to: the closest content stop ahead (or the goal).
  const nextStop = stopPts.find((p) => p.slot.status === "FORGING" || p.slot.status === "SCHEDULED" || p.slot.status === "FAILED");
  const curSpot = contentDone ? destination : rendering && nextStop ? nextStop.slot.spot : `DAY ${dayOf} · EN ROUTE`;

  const routeD = ROUTE.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ");

  // Grab-and-drag panning. Pointer capture retargets clicks at the container,
  // so pin taps are resolved manually on release: remember what was pressed,
  // and if the pointer never really moved, treat it as a tap on that pin.
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ on: boolean; x: number; left: number; moved: boolean; tgt: EventTarget | null }>({ on: false, x: 0, left: 0, moved: false, tgt: null });
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = (here.x / PANO_W) * RENDER_W - el.clientWidth / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    drag.current = { on: true, x: e.clientX, left: el.scrollLeft, moved: false, tgt: e.target };
    el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || !drag.current.on) return;
    const dx = e.clientX - drag.current.x;
    if (Math.abs(dx) > 5) drag.current.moved = true;
    el.scrollLeft = drag.current.left - dx;
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = { ...d, on: false };
    if (d.moved || !d.tgt) return;
    const hit = (d.tgt as Element).closest?.("[data-slot],[data-day]");
    if (!hit) return;
    const slotAttr = hit.getAttribute("data-slot");
    const dayAttr = hit.getAttribute("data-day");
    if (slotAttr != null) onPick(parseInt(slotAttr, 10));
    else if (dayAttr != null) onPickDay(parseInt(dayAttr, 10));
  };

  return (
    <div className="qh-mapwrap">
    <div
      className="qh-map grabby"
      ref={scrollRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
    <div className="qh-map-inner" style={{ width: RENDER_W }}>
      <svg viewBox={`0 0 ${PANO_W} ${MAP_H}`} style={{ width: RENDER_W }} role="img" aria-label="Campaign world panorama">
        <defs>
          <linearGradient id="qh-seam" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#fff" stopOpacity="1" />
          </linearGradient>
          {WORLDS.map((_, k) => k > 0 && (
            <mask id={`qh-fade-${k}`} key={k} maskUnits="userSpaceOnUse" x={k * STEP} y="0" width={MAP_W} height={MAP_H}>
              <rect x={k * STEP} y="0" width={SEAM} height={MAP_H} fill="url(#qh-seam)" />
              <rect x={k * STEP + SEAM} y="0" width={MAP_W - SEAM} height={MAP_H} fill="#fff" />
            </mask>
          ))}
        </defs>

        {WORLDS.map((w, k) => (
          <image
            key={w.src} href={w.src} x={k * STEP} y="0" width={MAP_W} height={MAP_H}
            mask={k > 0 ? `url(#qh-fade-${k})` : undefined}
          />
        ))}

        {/* the road */}
        <path d={routeD} fill="none" stroke="#1a1206" strokeWidth="11" opacity="0.35" strokeLinejoin="round" strokeLinecap="round" />
        <path d={routeD} fill="none" stroke="#ffd76a" strokeWidth="5" strokeDasharray="2 16" strokeLinecap="round" opacity="0.95" />

        {/* quiet-day waypoints — every day of the month is a place, and every
            one answers when you knock */}
        {waypointDays.map((d) => {
          const p = routePoint(dayT(d, duration));
          const passed = d < dayOf;
          const today = d === dayOf;
          const sel = selectedDay === d;
          return (
            <g key={`wp${d}`} data-day={d} style={{ cursor: "pointer" }}>
              <circle cx={p.x} cy={p.y} r="15" fill="transparent" />
              {sel && <circle cx={p.x} cy={p.y} r="13" fill="none" stroke="#34E7E4" strokeWidth="3" />}
              <circle cx={p.x} cy={p.y} r={today ? 8 : 5} fill={passed || today ? "#ffd76a" : "#2b2650"} stroke={passed || today ? "#7a4c08" : "#171430"} strokeWidth="2.5" opacity={passed ? 0.9 : 0.8} />
              {today && (
                <text x={p.x} y={p.y - 18} textAnchor="middle" fontSize="17" fontFamily="monospace" fill="#ffe9b0" stroke="#14102a" strokeWidth="5" paintOrder="stroke">TODAY</text>
              )}
            </g>
          );
        })}

        {/* YOUR SHOP */}
        <g style={{ paintOrder: "stroke" }}>
          <circle cx={start.x} cy={start.y} r="15" fill="#7c5cff" stroke="#241a4d" strokeWidth="4" />
          <text x={start.x} y={start.y + 7} textAnchor="middle" fontSize="18">🏪</text>
          <text x={start.x} y={start.y + 44} textAnchor="middle" fontSize="21" fontFamily="monospace" fontWeight="bold"
            fill="#e8e2ff" stroke="#14102a" strokeWidth="5" paintOrder="stroke">YOUR SHOP</text>
        </g>

        {stopPts.map((p, i) => {
          const s = p.slot;
          const done = s.status === "READY" || s.status === "POSTED";
          const failed = s.status === "FAILED";
          const activeHere = !contentDone && nextStop && s.idx === nextStop.slot.idx;
          const sel = selectedIdx === s.idx;
          const fill = done ? "#2fbf8a" : failed ? "#d24b4b" : activeHere ? "#ffd76a" : "#3a3560";
          const ring = done ? "#0d4a33" : failed ? "#571414" : activeHere ? "#7a4c08" : "#171430";
          const labelUp = p.y > 330;
          const lane = (i % 2) * 26;
          const ly = labelUp ? p.y - 34 - lane : p.y + 44 + lane;
          const ly2 = labelUp ? p.y - 58 - lane : p.y + 68 + lane;
          return (
            <g key={s.idx} data-slot={s.idx} style={{ cursor: "pointer" }}>
              <circle cx={p.x} cy={p.y} r="22" fill="transparent" />
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
                <text x={p.x} y={ly} textAnchor="middle" fontSize="19" fontFamily="monospace" fontWeight="bold"
                  fill={done ? "#c9f5e2" : failed ? "#ffb8b8" : "#f2f0ff"}
                  stroke="#0b0918" strokeWidth="6" paintOrder="stroke">
                  {failed ? `${s.spot} · GOBLIN!` : done ? `${s.spot} ✓` : `${s.spot} · D${s.day}`}
                </text>
              )}
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

        {/* the destination */}
        <g style={{ paintOrder: "stroke" }}>
          {contentDone && (
            <circle cx={end.x} cy={end.y} fill="none" stroke="#ffd76a" strokeWidth="4">
              <animate attributeName="r" values="20;50" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.9;0" dur="2s" repeatCount="indefinite" />
            </circle>
          )}
          <circle cx={end.x} cy={end.y} r="16" fill={contentDone ? "#ffd76a" : "#8a6a2e"} stroke="#3d2b12" strokeWidth="4" />
          <text x={end.x} y={end.y + 7} textAnchor="middle" fontSize="18">{contentDone ? "🏆" : "🏁"}</text>
          <text x={end.x} y={end.y - 30} textAnchor="middle" fontSize="22" fontFamily="monospace" fontWeight="bold"
            fill="#ffe9b0" stroke="#14102a" strokeWidth="6" paintOrder="stroke">{destination}</text>
          <text x={end.x} y={end.y - 56} textAnchor="middle" fontSize="18" fontFamily="monospace"
            fill="#ffd76a" stroke="#14102a" strokeWidth="5" paintOrder="stroke">+{xpReward.toLocaleString()} XP</text>
        </g>

        {/* ===== LIFE — the world breathes ===== */}
        {/* drifting clouds with the whole sky to cross */}
        {[{ y: 46, dur: 150, s: 1.3, b: 0 }, { y: 84, dur: 210, s: 1, b: 40 }].map((c, i) => (
          <g key={`cl${i}`} opacity="0.2" transform={`scale(${c.s})`}>
            <g>
              <ellipse cx="0" cy={c.y} rx="52" ry="15" fill="#ffffff" />
              <ellipse cx="34" cy={c.y - 8} rx="34" ry="12" fill="#ffffff" />
              <ellipse cx="-30" cy={c.y - 5} rx="28" ry="10" fill="#ffffff" />
              <animateTransform attributeName="transform" type="translate" values={`-120 0; ${PANO_W + 150} 0`} dur={`${c.dur}s`} begin={`-${c.b}s`} repeatCount="indefinite" />
            </g>
          </g>
        ))}
        {/* birds riding three sky lanes */}
        {BIRD_LANES.map((b, i) => (
          <g key={`bd${i}`} opacity="0.55" transform={`scale(${b.size})`}>
            <path d={`M0 ${b.y} q7 -8 14 0 q7 -8 14 0`} stroke="#14102a" strokeWidth="3" fill="none">
              <animateTransform attributeName="transform" type="translate" values={`-60 0; ${PANO_W + 100} -30`} dur={`${b.dur}s`} begin={`${b.delay}s`} repeatCount="indefinite" />
            </path>
          </g>
        ))}
        {/* MEADOW: cherry petals on the wind, butterflies, a bunny, a lagoon boat */}
        {Array.from({ length: 8 }).map((_, i) => (
          <circle key={`pt${i}`} r={2.5 + (i % 2)} fill="#f2a3c4" opacity="0.85">
            <animate attributeName="cy" values="-8;648" dur={`${9 + (i % 5)}s`} begin={`${i * 1.4}s`} repeatCount="indefinite" />
            <animate attributeName="cx" values={`${250 + ((i * 160) % 900)};${250 + ((i * 160) % 900) + 60}`} dur={`${9 + (i % 5)}s`} begin={`${i * 1.4}s`} repeatCount="indefinite" />
          </circle>
        ))}
        <g opacity="0.8">
          <circle r="4" fill="#f2a3c4"><animateMotion dur="11s" repeatCount="indefinite" path="M 500 300 q 40 -30 80 0 q 40 30 80 0 q -60 40 -160 0 Z" /></circle>
          <circle r="4" fill="#8fd4f2"><animateMotion dur="14s" begin="3s" repeatCount="indefinite" path="M 900 320 q -30 -40 -70 -10 q -30 30 10 50 q 50 10 60 -40 Z" /></circle>
        </g>
        <g transform="translate(545, 328)">
          <g className="qh-walker" style={{ ["--px" as string]: "110px", ["--pd" as string]: "18s" }}>
            <g className="qh-stepbob">
              <ellipse cx="0" cy="0" rx="7" ry="5" fill="#f4f0e6" />
              <rect x="-4" y="-9" width="2.5" height="6" rx="1" fill="#f4f0e6" /><rect x="1" y="-9" width="2.5" height="6" rx="1" fill="#f4f0e6" />
              <circle cx="-4.5" cy="-1" r="1" fill="#2a2020" />
            </g>
          </g>
        </g>
        {/* meadow deer on patrol — walks out, turns around, walks home */}
        <g transform="translate(165, 330)" shapeRendering="crispEdges">
          <g className="qh-walker" style={{ ["--px" as string]: "130px", ["--pd" as string]: "40s" }}>
            <g className="qh-stepbob">
              <rect x="0" y="0" width="17" height="9" rx="2" fill="#a87848" />
              <rect x="15" y="-8" width="5" height="9" fill="#a87848" />
              <path d="M 17 -8 l 3 -6 M 20 -8 l 4 -5" stroke="#8a5f38" strokeWidth="1.5" fill="none" />
              <g className="qh-fA"><rect x="2" y="9" width="2.5" height="7" fill="#8a5f38" /><rect x="12" y="9" width="2.5" height="7" fill="#8a5f38" /></g>
              <g className="qh-fB"><rect x="4.5" y="9" width="2.5" height="7" fill="#8a5f38" /><rect x="9.5" y="9" width="2.5" height="7" fill="#8a5f38" /></g>
            </g>
          </g>
        </g>
        <g>
          <g shapeRendering="crispEdges">
            <path d="M -16 0 h32 l-6 9 h-20 Z" fill="#6b4420" />
            <rect x="-1.5" y="-22" width="3" height="22" fill="#4a3323" />
            <path d="M 1.5 -22 q 16 6 0 14 Z" fill="#f4ead0" />
            <animateTransform attributeName="transform" type="translate" values="1035 398; 1085 398; 1035 398" dur="34s" repeatCount="indefinite" additive="replace" />
          </g>
        </g>
        {/* DESERT: drifting sand motes + a camel patrolling the dunes */}
        {Array.from({ length: 7 }).map((_, i) => (
          <circle key={`sm${i}`} r="2.5" fill="#e8d9a0" opacity="0.6">
            <animate attributeName="cx" values={`${STEP + 60 + ((i * 190) % 1200)};${STEP + 60 + ((i * 190) % 1200) + 300}`} dur={`${11 + (i % 6)}s`} begin={`${i * 1.1}s`} repeatCount="indefinite" />
            <animate attributeName="cy" values={`${340 + ((i * 41) % 240)};${330 + ((i * 41) % 240)}`} dur={`${11 + (i % 6)}s`} begin={`${i * 1.1}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;.6;0" dur={`${11 + (i % 6)}s`} begin={`${i * 1.1}s`} repeatCount="indefinite" />
          </circle>
        ))}
        <g transform={`translate(${STEP + 990}, 512)`} shapeRendering="crispEdges">
          <g className="qh-walker" style={{ ["--px" as string]: "200px", ["--pd" as string]: "46s" }}>
            <g className="qh-stepbob">
              <rect x="0" y="0" width="20" height="9" rx="3" fill="#8a6a3a" />
              <path d="M 4 0 q 4 -6 9 -2 q 4 -6 8 -1" stroke="#8a6a3a" strokeWidth="4" fill="none" />
              <rect x="18" y="-9" width="4" height="9" fill="#8a6a3a" /><rect x="18" y="-12" width="6" height="4" fill="#8a6a3a" />
              <g className="qh-fA"><rect x="3" y="9" width="2.5" height="7" fill="#6d5230" /><rect x="14" y="9" width="2.5" height="7" fill="#6d5230" /></g>
              <g className="qh-fB"><rect x="6" y="9" width="2.5" height="7" fill="#6d5230" /><rect x="11" y="9" width="2.5" height="7" fill="#6d5230" /></g>
            </g>
          </g>
        </g>
        {/* a hawk circling the mesas */}
        <g transform={`translate(${STEP + 330}, 112)`} opacity="0.65">
          <g>
            <path d="M 0 0 q 6 -7 12 0 q 6 -7 12 0" stroke="#3d2b16" strokeWidth="2.5" fill="none" />
            <animateMotion dur="21s" repeatCount="indefinite" path="M 0 0 a 95 32 0 1 0 190 0 a 95 32 0 1 0 -190 0" />
          </g>
        </g>
        {/* TUNDRA: falling snow, chimney smoke that actually rises, a fox on patrol */}
        {Array.from({ length: 14 }).map((_, i) => (
          <circle key={`sn${i}`} r={1.8 + (i % 3) * 0.8} fill="#ffffff" opacity="0.85">
            <animate attributeName="cy" values="-8;648" dur={`${8 + (i % 6)}s`} begin={`${i * 0.7}s`} repeatCount="indefinite" />
            <animate attributeName="cx" values={`${STEP * 2 + 30 + ((i * 117) % 1460)};${STEP * 2 + 70 + ((i * 117) % 1460)}`} dur={`${8 + (i % 6)}s`} begin={`${i * 0.7}s`} repeatCount="indefinite" />
          </circle>
        ))}
        {[{ x: STEP * 2 + 738, y: 92 }, { x: STEP * 2 + 972, y: 152 }].map((ch, ci) =>
          Array.from({ length: 3 }).map((_, i) => (
            <circle key={`sk${ci}-${i}`} cx={ch.x} fill="#cfc9dd" opacity="0">
              <animate attributeName="cy" values={`${ch.y};${ch.y - 46}`} dur="4.2s" begin={`${ci * 0.8 + i * 1.4}s`} repeatCount="indefinite" />
              <animate attributeName="r" values="2.5;8" dur="4.2s" begin={`${ci * 0.8 + i * 1.4}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.55;0" dur="4.2s" begin={`${ci * 0.8 + i * 1.4}s`} repeatCount="indefinite" />
            </circle>
          ))
        )}
        <g transform={`translate(${STEP * 2 + 480}, 296)`} shapeRendering="crispEdges">
          <g className="qh-walker" style={{ ["--px" as string]: "170px", ["--pd" as string]: "30s" }}>
            <g className="qh-stepbob">
              <rect x="0" y="0" width="15" height="7" rx="2" fill="#d97f3e" />
              <rect x="13" y="-5" width="5" height="6" fill="#d97f3e" /><path d="M 0 2 q -9 -2 -12 4 q 6 4 12 0 Z" fill="#e89a5e" />
              <g className="qh-fA"><rect x="2" y="7" width="2" height="5" fill="#a85f2e" /><rect x="11" y="7" width="2" height="5" fill="#a85f2e" /></g>
              <g className="qh-fB"><rect x="4.5" y="7" width="2" height="5" fill="#a85f2e" /><rect x="8.5" y="7" width="2" height="5" fill="#a85f2e" /></g>
            </g>
          </g>
        </g>
        {/* a penguin waddling the snowy lakeshore */}
        <g transform={`translate(${STEP * 2 + 850}, 448)`} shapeRendering="crispEdges">
          <g className="qh-walker" style={{ ["--px" as string]: "90px", ["--pd" as string]: "28s" }}>
            <g className="qh-stepbob">
              <rect x="0" y="-10" width="8" height="12" rx="3" fill="#1c1c2e" />
              <rect x="2" y="-6" width="4" height="7" fill="#f4f0e6" />
              <rect x="2.5" y="-12" width="3" height="2" fill="#e8a33a" />
              <g className="qh-fA"><rect x="1" y="2" width="2.5" height="3" fill="#e8a33a" /><rect x="4.5" y="2" width="2.5" height="3" fill="#e8a33a" /></g>
              <g className="qh-fB"><rect x="2.5" y="2" width="3" height="3" fill="#e8a33a" /></g>
            </g>
          </g>
        </g>
        {/* VOLCANO: pulsing summit glow, rising embers, a parrot circling the temple, a sailboat */}
        <circle cx={STEP * 3 + 748} cy={96} r="46" fill="#ff6b35" opacity="0.25">
          <animate attributeName="opacity" values="0.18;0.42;0.18" dur="3.2s" repeatCount="indefinite" />
          <animate attributeName="r" values="40;54;40" dur="3.2s" repeatCount="indefinite" />
        </circle>
        {Array.from({ length: 7 }).map((_, i) => (
          <circle key={`em${i}`} r="2.5" fill="#ffb03a" opacity="0">
            <animate attributeName="cx" values={`${STEP * 3 + 700 + ((i * 23) % 110)};${STEP * 3 + 690 + ((i * 31) % 130)}`} dur={`${5 + (i % 4)}s`} begin={`${i * 0.9}s`} repeatCount="indefinite" />
            <animate attributeName="cy" values="160;36" dur={`${5 + (i % 4)}s`} begin={`${i * 0.9}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9;0" dur={`${5 + (i % 4)}s`} begin={`${i * 0.9}s`} repeatCount="indefinite" />
          </circle>
        ))}
        <g transform={`translate(${STEP * 3 + 790}, 298)`}>
          <g>
            <circle r="4.5" fill="#e24b4a" />
            <path d="M -2 -2 q -8 -7 -14 -2 M 2 -2 q 8 -7 14 -2" stroke="#e24b4a" strokeWidth="2.5" fill="none">
              <animate attributeName="d" values="M -2 -2 q -8 -7 -14 -2 M 2 -2 q 8 -7 14 -2; M -2 0 q -8 5 -14 2 M 2 0 q 8 5 14 2; M -2 -2 q -8 -7 -14 -2 M 2 -2 q 8 -7 14 -2" dur="0.6s" repeatCount="indefinite" />
            </path>
            <animateMotion dur="15s" repeatCount="indefinite" path="M 0 0 a 84 44 0 1 0 168 0 a 84 44 0 1 0 -168 0" />
          </g>
        </g>
        <g>
          <g shapeRendering="crispEdges">
            <path d="M -16 0 h32 l-6 9 h-20 Z" fill="#5a3d20" />
            <rect x="-1.5" y="-24" width="3" height="24" fill="#3d2b16" />
            <path d="M -1.5 -24 q -17 7 0 15 Z" fill="#ffd9a0" />
            <animateTransform attributeName="transform" type="translate" values={`${STEP * 3 + 210} 592; ${STEP * 3 + 300} 588; ${STEP * 3 + 210} 592`} dur="44s" repeatCount="indefinite" />
          </g>
        </g>
        {/* ===== VILLAGERS — every biome has locals with jobs and gossip ===== */}
        {/* meadow: a farmer on his rounds, a hoeing field hand, two gossips in the village */}
        <g transform="translate(450, 372)">
          <g className="qh-walker" style={{ ["--px" as string]: "140px", ["--pd" as string]: "30s" }}>
            <g className="qh-stepbob">
              <NpcBody tunic="#5d8a4a" hat={<rect x="-1" y="-16" width="10" height="3" fill="#e8c15a" />} />
            </g>
          </g>
        </g>
        <g transform="translate(585, 292)">
          <NpcBody tunic="#7a5a8a" walking={false} hat={<rect x="0" y="-16" width="8" height="3" fill="#c9955a" />} />
          <g className="qh-swing">
            <rect x="8" y="-14" width="2.5" height="16" fill="#8a5f33" />
            <rect x="7" y="1" width="5" height="3" fill="#9aa3ad" />
          </g>
        </g>
        <g transform="translate(915, 262)">
          <NpcBody tunic="#a83a4a" walking={false} hat={<rect x="1" y="-16" width="6" height="2.5" fill="#5a3d20" />} />
          <Bubble delay={0} />
        </g>
        <g transform="translate(944, 262)">
          <g transform="scale(-1, 1)"><NpcBody tunic="#3a6ea8" walking={false} /></g>
          <Bubble delay={5.5} />
        </g>
        {/* desert: a robed trader on patrol, a smith hammering at the market tent */}
        <g transform={`translate(${STEP + 1120}, 428)`}>
          <g className="qh-walker" style={{ ["--px" as string]: "115px", ["--pd" as string]: "26s" }}>
            <g className="qh-stepbob">
              <NpcBody tunic="#f4ead0" skin="#c98a5a" hat={<rect x="0" y="-17" width="8" height="4" rx="2" fill="#fdfdf4" />} />
            </g>
          </g>
        </g>
        <g transform={`translate(${STEP + 470}, 402)`}>
          <NpcBody tunic="#a83a4a" skin="#c98a5a" walking={false} hat={<rect x="0" y="-17" width="8" height="4" rx="2" fill="#e8c15a" />} />
          <g className="qh-swing">
            <rect x="8" y="-12" width="2.5" height="12" fill="#8a5f33" />
            <rect x="6.5" y="-14" width="5.5" height="4" fill="#9aa3ad" />
          </g>
          <Bubble delay={8} shout />
        </g>
        {/* tundra: a bundled walker, a lumberjack who never runs out of logs */}
        <g transform={`translate(${STEP * 2 + 600}, 348)`}>
          <g className="qh-walker" style={{ ["--px" as string]: "130px", ["--pd" as string]: "32s" }}>
            <g className="qh-stepbob">
              <NpcBody tunic="#3a6ea8" hat={<rect x="0" y="-16" width="8" height="3" fill="#f4f0e6" />} />
            </g>
          </g>
        </g>
        <g transform={`translate(${STEP * 2 + 830}, 322)`}>
          <NpcBody tunic="#a83232" walking={false} hat={<rect x="1" y="-16" width="6" height="2.5" fill="#2a2438" />} />
          <rect x="12" y="1" width="9" height="4" fill="#6b4420" shapeRendering="crispEdges" />
          <g className="qh-swing">
            <rect x="8" y="-14" width="2.5" height="15" fill="#8a5f33" />
            <path d="M 7 -16 h 6 l 2 4 h -8 Z" fill="#9aa3ad" />
          </g>
        </g>
        {/* volcano: an islander strolling the beach, a fisherman working the cove */}
        <g transform={`translate(${STEP * 3 + 930}, 470)`}>
          <g className="qh-walker" style={{ ["--px" as string]: "150px", ["--pd" as string]: "30s" }}>
            <g className="qh-stepbob">
              <NpcBody tunic="#2fa86a" skin="#b8763a" hat={<rect x="0" y="-11" width="8" height="2" fill="#e24b8a" />} />
            </g>
          </g>
        </g>
        <g transform={`translate(${STEP * 3 + 540}, 520)`}>
          <NpcBody tunic="#d9a04e" skin="#b8763a" walking={false} hat={<rect x="-1" y="-16" width="10" height="3" fill="#8a6a3a" />} />
          <path d="M 8 -10 q 12 -6 18 2" stroke="#5a3d20" strokeWidth="1.5" fill="none" />
          <g className="qh-bobline">
            <line x1="26" y1="-8" x2="26" y2="6" stroke="#dff2ff" strokeWidth="1" opacity="0.7" />
            <circle cx="26" cy="7" r="1.5" fill="#e24b4a" />
          </g>
        </g>
        {/* ===== THE PIRATE SHIP — crew included, sails the volcano sea ===== */}
        <g transform={`translate(${STEP * 3 + 150}, 566)`}>
          <g className="qh-walker" style={{ ["--px" as string]: "300px", ["--pd" as string]: "85s" }}>
            <g className="qh-shiprock">
              <path d="M -30 0 h 62 q 4 12 -10 15 h -44 q -12 -3 -8 -15 Z" fill="#5a3a20" stroke="#3d2712" strokeWidth="2" />
              <rect x="-30" y="3" width="62" height="3" fill="#8a5f33" shapeRendering="crispEdges" />
              <rect x="-8" y="-34" width="3" height="34" fill="#3d2712" />
              <rect x="16" y="-26" width="2.5" height="26" fill="#3d2712" />
              <path d="M -5 -32 q 14 4 0 22 Z" fill="#e8e0cc" />
              <path d="M 18.5 -24 q 11 3 0 16 Z" fill="#e8e0cc" />
              <g shapeRendering="crispEdges">
                <rect x="-8" y="-40" width="11" height="7" fill="#1c1c2e" />
                <circle cx="-3.5" cy="-37" r="1.6" fill="#f4f0e6" />
                <path d="M -6 -35.4 h 5 M -3.5 -36.8 v 2.8" stroke="#f4f0e6" strokeWidth="0.8" />
              </g>
              <g transform="translate(-18, -5)">
                <g className="qh-walker" style={{ ["--px" as string]: "16px", ["--pd" as string]: "7s" }}>
                  <g className="qh-stepbob"><NpcBody tunic="#a83a4a" hat={<rect x="0" y="-16" width="8" height="2.5" fill="#e24b4a" />} /></g>
                </g>
              </g>
              <g transform="translate(6, -5)">
                <g className="qh-walker" style={{ ["--px" as string]: "14px", ["--pd" as string]: "9s" }}>
                  <g className="qh-stepbob"><NpcBody tunic="#2a2438" hat={<rect x="0" y="-16" width="8" height="2.5" fill="#f4f0e6" />} /></g>
                </g>
              </g>
              <Bubble delay={3} shout />
            </g>
          </g>
        </g>
        {/* ===== CRYPTIDS & FOLKLORE — the world has legends ===== */}
        {/* a dragon perched on the tower town, wings stretching, chuffing smoke */}
        <g transform="translate(1248, 194)">
          <g className="qh-wingL"><path d="M -4 -2 q -16 -14 -26 -6 q 8 2 10 8 q 8 -4 16 2 Z" fill="#2f8a4a" stroke="#1c5a2e" strokeWidth="1.5" /></g>
          <g className="qh-wingR"><path d="M 12 -2 q 16 -14 26 -6 q -8 2 -10 8 q -8 -4 -16 2 Z" fill="#2f8a4a" stroke="#1c5a2e" strokeWidth="1.5" /></g>
          <ellipse cx="4" cy="0" rx="10" ry="6.5" fill="#3aa85e" stroke="#1c5a2e" strokeWidth="1.5" />
          <path d="M 12 -1 q 10 3 16 10" stroke="#3aa85e" strokeWidth="4" fill="none" strokeLinecap="round" />
          <g>
            <rect x="-9" y="-10" width="8" height="7" rx="2" fill="#3aa85e" stroke="#1c5a2e" strokeWidth="1.2" />
            <path d="M -8 -10 l -1.5 -4 l 3 1 Z M -4 -10 l -1 -4 l 3 1 Z" fill="#e8c15a" />
            <circle cx="-6.5" cy="-7" r="1.1" fill="#ffd76a" />
          </g>
          {[0, 1].map((k) => (
            <circle key={k} cx="-12" fill="#b8b2cc" opacity="0">
              <animate attributeName="cy" values="-9;-22" dur="5.5s" begin={`${k * 2.4}s`} repeatCount="indefinite" />
              <animate attributeName="r" values="1.5;4" dur="5.5s" begin={`${k * 2.4}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.6;0" dur="5.5s" begin={`${k * 2.4}s`} repeatCount="indefinite" />
            </circle>
          ))}
        </g>
        {/* something old lives in the meadow's southern sea */}
        <g transform="translate(630, 618)">
          <g className="qh-surface">
            <path d="M -6 0 q 2 -18 10 -20 q 8 -2 8 6" stroke="#2f7a68" strokeWidth="6" fill="none" strokeLinecap="round" />
            <ellipse cx="13" cy="-15" rx="5" ry="3.5" fill="#2f7a68" />
            <circle cx="15" cy="-16" r="1" fill="#0b2b2a" />
            <path d="M -26 2 a 8 6 0 0 1 14 0 Z M -44 3 a 7 5 0 0 1 12 0 Z" fill="#2f7a68" />
          </g>
        </g>
        {/* a yeti peeks from the tundra treeline, then thinks better of it */}
        <g transform={`translate(${STEP * 2 + 56}, 296)`}>
          <g className="qh-peek">
            <ellipse cx="0" cy="0" rx="9" ry="12" fill="#eef2fa" stroke="#b8c4dd" strokeWidth="1.5" />
            <ellipse cx="1" cy="-4" rx="5" ry="4.5" fill="#8a94b8" />
            <circle cx="-0.5" cy="-5" r="1" fill="#1c1c2e" /><circle cx="3" cy="-5" r="1" fill="#1c1c2e" />
            <path d="M -8 4 q -5 2 -6 6" stroke="#eef2fa" strokeWidth="4" fill="none" strokeLinecap="round" />
          </g>
        </g>
        {/* the great sandworm breaches the dunes */}
        <g transform={`translate(${STEP + 640}, 215)`}>
          <g className="qh-surface" style={{ ["--sd" as string]: "6s" }}>
            <path d="M -22 0 a 22 20 0 0 1 44 0" fill="none" stroke="#b8905a" strokeWidth="11" strokeLinecap="round" />
            <path d="M -22 0 a 22 20 0 0 1 44 0" fill="none" stroke="#8a6a3a" strokeWidth="11" strokeLinecap="round" strokeDasharray="6 6" />
            {[[-28, -2], [30, -4], [0, -26]].map(([sx, sy], k) => (
              <circle key={k} cx={sx} cy={sy} r="2" fill="#e8d9a0" opacity="0.8" />
            ))}
          </g>
        </g>
        {/* the phoenix rides the volcano thermals, embers trailing */}
        <g transform={`translate(${STEP * 3 + 620}, 150)`}>
          <g>
            <path d="M 0 0 q 8 -9 16 0 q 8 -9 16 0" stroke="#ff9d4d" strokeWidth="4" fill="none" strokeLinecap="round" />
            <circle cx="16" cy="-2" r="4" fill="#ffb03a" />
            <path d="M 12 2 q -10 8 -18 6" stroke="#e24b4a" strokeWidth="3" fill="none" strokeLinecap="round" />
            <animateMotion dur="22s" repeatCount="indefinite" path="M 0 0 q 90 -50 220 -10 q 90 30 180 -20 q -120 -40 -220 -10 q -100 26 -180 40 Z" />
          </g>
          {[0, 1].map((k) => (
            <circle key={k} r="2" fill="#ffb03a" opacity="0.7">
              <animateMotion dur="22s" begin={`${0.4 + k * 0.4}s`} repeatCount="indefinite" path="M 0 0 q 90 -50 220 -10 q 90 30 180 -20 q -120 -40 -220 -10 q -100 26 -180 40 Z" />
              <animate attributeName="opacity" values="0.7;0.15;0.7" dur="1.4s" repeatCount="indefinite" />
            </circle>
          ))}
        </g>
        {/* SHARKS — fins cruising the open water, wakes trailing */}
        {[
          { path: "M 320 614 q 100 -8 200 0 q 100 8 190 -2", dur: 24 },
          { path: `M ${STEP * 3 + 110} 612 q 130 -10 260 0 q 130 10 250 -4`, dur: 28 },
          { path: `M ${STEP * 3 + 1120} 560 a 70 26 0 1 0 140 0 a 70 26 0 1 0 -140 0`, dur: 15 },
        ].map((s, i) => (
          <g key={`sh${i}`}>
            <g>
              <path d="M 0 0 q 2 -13 11 -16 q -1 9 3 16 Z" fill="#46586b" stroke="#2c3a4a" strokeWidth="1.5" />
              <path d="M -6 2 q -10 3 -20 1" stroke="#dff2ff" strokeWidth="2" fill="none" opacity="0.5" />
              <animateMotion dur={`${s.dur}s`} begin={`${i * 3}s`} repeatCount="indefinite" path={s.path} rotate="auto" />
              <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.05;.95;1" dur={`${s.dur}s`} begin={`${i * 3}s`} repeatCount="indefinite" />
            </g>
          </g>
        ))}
        {/* seagulls wheeling over the coves */}
        {[{ x: 1040, y: 300 }, { x: STEP * 3 + 1000, y: 400 }].map((sg, i) => (
          <g key={`sg${i}`} transform={`translate(${sg.x}, ${sg.y})`} opacity="0.75">
            <g>
              <path d="M 0 0 q 5 -6 10 0 q 5 -6 10 0" stroke="#f4f0e6" strokeWidth="2.5" fill="none" />
              <animateMotion dur={`${16 + i * 4}s`} begin={`${i * 2}s`} repeatCount="indefinite" path="M 0 0 a 62 24 0 1 0 124 0 a 62 24 0 1 0 -124 0" />
            </g>
          </g>
        ))}
        {/* a whale surfacing off the volcano coast, spout and all */}
        <g transform={`translate(${STEP * 3 + 1270}, 596)`}>
          <g>
            <path d="M -26 0 q 26 -20 52 0 Z" fill="#5a6b80" />
            <path d="M 20 -4 q 8 -8 12 -2 q -6 1 -8 6 Z" fill="#5a6b80" />
            <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;.55;.62;.85;.92;1" dur="13s" repeatCount="indefinite" />
          </g>
          <g>
            {[0, 1, 2].map((k) => (
              <circle key={k} cx={-8 + k * 4} r={2.2 - k * 0.4} fill="#dff2ff" opacity="0">
                <animate attributeName="cy" values="-16;-16;-36;-36" keyTimes={`0;${0.6 + k * 0.015};${0.76 + k * 0.015};1`} dur="13s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0;0;0.85;0;0" keyTimes={`0;${0.6 + k * 0.015};${0.66 + k * 0.015};${0.78 + k * 0.015};1`} dur="13s" repeatCount="indefinite" />
              </circle>
            ))}
          </g>
        </g>
        {/* waves & ripples in every water */}
        {[
          { x: STEP + 780, y: 480, d: 0 }, { x: STEP * 2 + 800, y: 520, d: 2.1 },
          { x: STEP * 3 + 380, y: 545, d: 1.2 }, { x: 1150, y: 430, d: 3.4 },
          { x: STEP * 3 + 1180, y: 560, d: 4.2 }, { x: 640, y: 610, d: 1.9 },
        ].map((r, i) => (
          <circle key={`rp${i}`} cx={r.x} cy={r.y} fill="none" stroke="#eaf8ff" strokeWidth="2.5" opacity="0.7">
            <animate attributeName="r" values="2;16" dur="4.5s" begin={`${r.d}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.7;0" dur="4.5s" begin={`${r.d}s`} repeatCount="indefinite" />
          </circle>
        ))}
        {[{ x: 1000, y: 392 }, { x: STEP + 830, y: 420 }, { x: STEP * 2 + 760, y: 545 }, { x: STEP * 3 + 350, y: 570 }].map((w, i) => (
          <path key={`wv${i}`} d={`M ${w.x} ${w.y} q 9 -5 18 0 q 9 5 18 0`} stroke="#dff2ff" strokeWidth="2" fill="none" opacity="0.5">
            <animate attributeName="opacity" values="0.15;0.6;0.15" dur={`${3 + (i % 3)}s`} begin={`${i * 0.8}s`} repeatCount="indefinite" />
            <animateTransform attributeName="transform" type="translate" values="0 0; 14 0; 0 0" dur={`${5 + i}s`} repeatCount="indefinite" />
          </path>
        ))}
      </svg>
      {partner && (
        <div className="qh-partner" style={{ left: `${(here.x / PANO_W) * 100}%`, top: `${(here.y / MAP_H) * 100}%` }}>
          <Partner img={partner.img} accent={partner.accent} />
          {rendering && <span className="qh-work-tool" aria-hidden="true">⚒️</span>}
          <span className={`tag${rendering ? " working" : ""}`}>
            {rendering ? `FORGING AT ${curSpot}` : `${partner.name} · ${curSpot}`}
          </span>
        </div>
      )}
    </div>
    </div>
    {cargo.length > 0 && (
      <button type="button" className="qh-cargo bagbtn" onClick={onOpenBag} title="Open the bag — see everything auto-posting this month">
        <img className="bagimg" src="/quests/backpack.png" alt="" />
        <span>
          <span className="l1">IN THE BAG · ×{cargo.length}</span>
          <span className="l2">auto-posting this month — tap to peek</span>
        </span>
      </button>
    )}
    <span className="qh-map-hint">✋ grab + drag to travel the world</span>
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
  const [daySel, setDaySel] = useState<{ qid: string; day: number } | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");

  const canRun = (minTier: string) => (TIER_RANK[tier] ?? 0) >= (TIER_RANK[minTier] ?? 1);
  const firstUnlocked = QUESTLINES.find((q) => canRun(q.minTier)) || QUESTLINES[0];
  const [selKey, setSelKey] = useState(firstUnlocked.key);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const sel = QUESTLINE_BY_KEY[selKey] || firstUnlocked;

  /** Calendar date for an arbitrary day of a quest (UTC math — hydration-safe). */
  const dateForDay = (slots: QuestSlot[], day: number): string => {
    const ref = slots[0];
    if (!ref) return "";
    const [y, m, d] = ref.date.split("-").map(Number);
    const base = Date.UTC(y, m - 1, d) - (ref.day - 1) * 86400000;
    return new Date(base + (day - 1) * 86400000).toISOString().slice(0, 10);
  };
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
    setDaySel(null);
    setEditSel({ qid, idx });
    setEditDate(s.date);
    setEditTime(s.time);
  };
  const openDay = (qid: string, day: number) => {
    setEditSel(null);
    setDaySel({ qid, day });
    setBagView(null);
  };
  const [bagView, setBagView] = useState<string | null>(null);

  /** Unique items riding in a quest's bag: total drops + how many are still
   *  swappable (not yet forged). */
  const bagContents = (slots: QuestSlot[]): { title: string; image: string | null; drops: number; future: number }[] => {
    const m = new Map<string, { title: string; image: string | null; drops: number; future: number }>();
    for (const s of slots) {
      if (!s.productTitle) continue;
      const swappable = s.status === "SCHEDULED" || s.status === "FAILED" ? 1 : 0;
      const cur = m.get(s.productTitle);
      if (cur) { cur.drops++; cur.future += swappable; }
      else m.set(s.productTitle, { title: s.productTitle, image: s.productImageUrl, drops: 1, future: swappable });
    }
    return Array.from(m.values());
  };
  const [swapSel, setSwapSel] = useState<{ qid: string; fromTitle: string } | null>(null);

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
      {actionData && "swapped" in actionData && (
        <Box paddingBlockEnd="300"><Banner tone="success" title="⇄ Cargo swapped"><p>{actionData.swapped as number} upcoming drop{(actionData.swapped as number) === 1 ? "" : "s"} now star the new item. Already-forged content keeps its original star.</p></Banner></Box>
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
            cargo={bagContents(q.slots)}
            onPick={(idx) => openEditor(q.id, q.slots, idx)}
            onPickDay={(day) => openDay(q.id, day)}
            onOpenBag={() => { setEditSel(null); setDaySel(null); setBagView(bagView === q.id ? null : q.id); }}
            selectedIdx={editSel?.qid === q.id ? editSel.idx : null}
            selectedDay={daySel?.qid === q.id ? daySel.day : null}
            destination={DESTINATION_BY_KEY[q.template] || "JOURNEY'S END"}
            dayOf={q.dayOf}
            duration={q.duration}
          />
          {/* a content stop was clicked — what happens here, and when */}
          {editSel?.qid === q.id && (() => {
            const s = q.slots.find((x) => x.idx === editSel.idx);
            if (!s) return null;
            const locked = s.status === "READY" || s.status === "POSTED";
            const kind = s.type === "video" ? "video take" : s.type === "image" ? "image ad" : "blog post";
            return (
              <div className="qh-slot-editor">
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div className="spot">{NODE_ICON[s.type]} {s.spot} — DAY {s.day}</div>
                  <div className="meta">
                    {locked
                      ? `${pName} already forged this ${kind}${s.productTitle ? ` starring ${s.productTitle}` : ""} — it's waiting in your library. ✓`
                      : `${pName} forges a ${kind} here${s.productTitle ? ` starring ${s.productTitle}` : ""}, ready for ${fmtDow(s.date)} at ${fmtTime(s.time)}. Change the plan below — the whole schedule obeys.`}
                  </div>
                </div>
                {!locked && (
                  <>
                    <div>
                      <label className="qh-field-label" htmlFor="qh-edit-date">Drop date</label>
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
                      💾 Save the plan
                    </button>
                  </>
                )}
                <button type="button" className="qh-mini-btn" onClick={() => setEditSel(null)}>Close</button>
              </div>
            );
          })()}
          {/* a quiet day was clicked — tell the merchant what happens (nothing) and offer action */}
          {daySel?.qid === q.id && (() => {
            const d = daySel.day;
            const date = dateForDay(q.slots, d);
            const next = q.slots.find((s) => s.status === "SCHEDULED" || s.status === "FORGING");
            const passed = d < q.dayOf;
            const today = d === q.dayOf;
            const msg = passed
              ? `${pName} passed through here on DAY ${d} — a quiet stretch of road, nothing dropped.`
              : today
                ? `${pName} is camped here right now — DAY ${d} of ${q.duration}.${next ? ` Next drop ahead: ${next.spot} on ${fmtDow(next.date)} at ${fmtTime(next.time)}.` : ""}`
                : `DAY ${d} · ${fmtDow(date)} — a travel day. Nothing is scheduled to drop here${next ? `; the next drop is ${next.spot} on DAY ${next.day}` : ""}.`;
            return (
              <div className="qh-slot-editor">
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div className="spot">🏕 DAY {d} — ON THE ROAD</div>
                  <div className="meta">{msg}</div>
                </div>
                {!passed && !today && next && (
                  <button
                    type="button" className="qh-mini-btn" disabled={busy}
                    title={`Moves the ${next.spot} drop to this day`}
                    onClick={() => submit({ intent: "reschedule", questlineId: q.id, slotIdx: String(next.idx), date, time: next.time }, { method: "post" })}
                  >
                    📦 Move next drop here
                  </button>
                )}
                <button type="button" className="qh-mini-btn" onClick={() => setDaySel(null)}>Close</button>
              </div>
            );
          })()}
          {/* the bag was tapped — everything auto-posting this month, swappable */}
          {bagView === q.id && (() => {
            const items = bagContents(q.slots);
            const swapping = swapSel?.qid === q.id ? swapSel.fromTitle : null;
            const inBagTitles = new Set(items.map((it) => it.title));
            return (
              <div className="qh-slot-editor">
                <div style={{ flex: 1, minWidth: 220 }}>
                  {swapping ? (
                    <>
                      <div className="spot">⇄ SWAP OUT: {swapping}</div>
                      <div className="meta" style={{ margin: "6px 0 10px" }}>
                        Pick the new star from your catalog. Every drop of {swapping} that isn't forged yet switches over — finished content keeps its original star.
                      </div>
                      <div className="qh-bag" style={{ maxHeight: 200 }}>
                        {products.filter((p) => !inBagTitles.has(p.title)).map((p) => (
                          <button
                            key={p.id} type="button" className="qh-slot" title={`Swap in ${p.title}`}
                            disabled={busy}
                            onClick={() => {
                              submit({ intent: "swapItem", questlineId: q.id, fromTitle: swapping, toTitle: p.title, toImage: p.image || "" }, { method: "post" });
                              setSwapSel(null);
                            }}
                          >
                            {p.image ? <img src={p.image} alt={p.title} loading="lazy" /> : <span className="ph">🛍️</span>}
                            <span className="qh-slot-name">{p.title}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="spot">🎒 IN THE BAG — AUTO-POSTING THIS MONTH</div>
                      <div className="meta" style={{ margin: "6px 0 10px" }}>
                        {pName} carries {items.length === 1 ? "this item" : `these ${items.length} items`} the whole expedition, starring them across the month's drops.
                      </div>
                      <div className="qh-bagpanel-items">
                        {items.map((it, i) => (
                          <div key={i} className="qh-bagpanel-item">
                            {it.image ? <img src={it.image} alt="" /> : <span style={{ fontSize: 22 }}>🛍️</span>}
                            <span>
                              <span className="nm">{it.title}</span>
                              <span className="ct">{it.drops} DROP{it.drops === 1 ? "" : "S"}{it.future > 0 ? ` · ${it.future} TO FORGE` : " · ALL FORGED"}</span>
                            </span>
                            <button
                              type="button" className="qh-mini-btn" style={{ marginLeft: 6 }}
                              disabled={it.future === 0 || busy}
                              title={it.future === 0 ? "All of this item's drops are already forged" : `Swap ${it.title} out of the remaining ${it.future} drop${it.future === 1 ? "" : "s"}`}
                              onClick={() => setSwapSel({ qid: q.id, fromTitle: it.title })}
                            >
                              ⇄ Swap
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <button type="button" className="qh-mini-btn" onClick={() => { if (swapping) setSwapSel(null); else setBagView(null); }}>
                  {swapping ? "← Back" : "Close"}
                </button>
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

      {/* Quest Journal — tales from the road, real events in the partner's voice */}
      <div className="qh-win" style={{ marginBottom: 16 }}>
        <span className="qh-label">📖 QUEST JOURNAL<span className="r">tales from the road</span></span>
        {feed.length === 0 ? (
          <div className="qh-feed"><div><span className="t">--</span>The journal is blank — sign a questline below and {pName} starts writing.</div></div>
        ) : (
          <div className="qh-feed">
            {feed.map((f, i) => (
              <div key={i}>
                <span className="t">{f.t}</span>
                <span className={f.tone}>{f.msg}</span>
                {f.href && <Link to={f.href} className="qh-journal-link"> → see it</Link>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active Questlines — the quest book. Click a title to read the tale. */}
      <div className="qh-win gold" style={{ marginBottom: 16 }}>
        <span className="qh-label gold">⚔ QUESTLINES<span className="r">monthly expeditions · click a title to open the tale</span></span>
        {QUESTLINES.map((q) => {
          const locked = !canRun(q.minTier);
          const cost = questlineTokenCost(q);
          const activeQ = active.find((a) => a.template === q.key);
          const open = openKey === q.key;
          const isSel = open;
          return (
            <div key={q.key} className={`qh-quest-entry${open ? " open" : ""}`}>
              <button
                type="button"
                className={`qh-qrow${isSel ? " on" : ""}${locked ? " locked" : ""}`}
                onClick={() => { setOpenKey(open ? null : q.key); if (!locked) setSelKey(q.key); }}
              >
                <span style={{ display: "inline-flex", gap: 4, alignItems: "center", minWidth: 0 }}>
                  <span className="ptr">▶</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {q.icon} {q.name.toUpperCase()} <span style={{ color: "#7d7da8" }}>→ {DESTINATION_BY_KEY[q.key]}</span>
                  </span>
                </span>
                {activeQ ? <span style={{ color: "#8ee89c" }}>⚑ ON EXPEDITION · DAY {activeQ.dayOf}</span> :
                  locked ? <span>🔒 {q.minTier}</span> : (
                    <span className="cost">{cost.toLocaleString()}🪙 <span className="xp">+{q.xpReward.toLocaleString()}XP</span></span>
                  )}
              </button>
              {open && (
                <div className="qh-qbody">
                  <p className="qh-lore">{q.lore}</p>
                  <div className="qh-detail-objs">
                    <div style={{ color: "#e0d9b8" }}>🗺 The plan: a 30-day march from YOUR SHOP to {DESTINATION_BY_KEY[q.key]}. {q.cadence}.</div>
                    {q.objectives.map((o, i) => (
                      <div key={i}>{NODE_ICON[o.type]} {o.target}× {o.label}</div>
                    ))}
                    <div style={{ color: "#8ee89c" }}>🏆 The spoils: {q.xpReward.toLocaleString()} XP at {DESTINATION_BY_KEY[q.key]} + 100 XP per perfect week{q.recurring ? " · the contract renews monthly" : ""}</div>
                  </div>

                  {activeQ ? (
                    <div className="qh-hint" style={{ textAlign: "left" }}>⚑ Already on the road — day {activeQ.dayOf} of {activeQ.duration}. Follow the journey on the board above.</div>
                  ) : locked ? (
                    <div className="qh-hint" style={{ textAlign: "left" }}>🔒 This contract needs the {q.minTier[0] + q.minTier.slice(1).toLowerCase()} plan. Level up your plan to unlock it.</div>
                  ) : (
                    <>
                      <div className="qh-loadout-grid">
                        <div>
                          <label className="qh-field-label" htmlFor="qh-star">Star presenter (your Brand Face)</label>
                          <div className="qh-star-row">
                            {starId && (
                              <img
                                className="qh-star-face"
                                src={avatarImg(starId, starVariant)}
                                alt={AVATAR_BY_ID[starId]?.name || "Presenter"}
                                title={AVATAR_BY_ID[starId] ? `${AVATAR_BY_ID[starId].name} — ${AVATAR_BY_ID[starId].vibe}` : undefined}
                              />
                            )}
                            <select id="qh-star" className="qh-select" value={starId} onChange={(e) => setStarId(e.target.value)}>
                              {available.length === 0 && <option value="">The cast is still arriving…</option>}
                              {available.map((a) => (
                                <option key={a.id} value={a.id}>{a.name}{brandFace?.id === a.id ? " ★" : ""} — {a.vibe}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="qh-field-label" htmlFor="qh-mode">Publishing style</label>
                          <select id="qh-mode" className="qh-select" value={reviewMode} onChange={(e) => setReviewMode(e.target.value as "REVIEW_FIRST" | "SET_AND_FORGET")}>
                            <option value="REVIEW_FIRST">Scout ahead — {pName} stages, you approve</option>
                            <option value="SET_AND_FORGET">Charge in — full autopilot</option>
                          </select>
                        </div>
                      </div>

                      {products.length > 0 && (() => {
                        const drops = q.objectives.filter((o) => o.type !== "post").reduce((s, o) => s + o.target, 0);
                        const say =
                          bagCapped.length === 0 ? "Pack at least 1 item to march." :
                          bagCapped.length >= q.bagSize ? `Fully loaded! Each item stars in ~${Math.round((drops / q.bagSize) * 10) / 10} drops this month.` :
                          `${bagCapped.length} packed — ${pName} rotates ${bagCapped.length === 1 ? "it" : "them"} across the month's ${drops} drops.`;
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
                              <span className="qh-field-label">🎒 YOUR PACK — {q.bagSize} pouches · click a pouch to unpack</span>
                              <div key={bagCapped.length} className="qh-bagart" style={{ animation: bagCapped.length ? "qh-bag-wiggle .4s ease" : undefined }}>
                                <img src="/quests/backpack.png" alt="Merchant's treasure pack" />
                                <div className={`qh-pouches${q.bagSize > 6 ? " big" : ""}`}>
                                  {Array.from({ length: q.bagSize }).map((_, i) => {
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
                              <div className="qh-load-row"><span>PACK LOAD</span><span>{bagCapped.length}/{q.bagSize}</span></div>
                              <div className="qh-load-bar"><i style={{ width: `${(bagCapped.length / q.bagSize) * 100}%` }} /></div>
                              <div className="qh-pack-say">{say}</div>
                            </div>
                          </div>
                        );
                      })()}

                      <button
                        type="button" className="qh-start"
                        disabled={busy || bagCapped.length === 0 || !selAffordable || !starId}
                        onClick={startQuest}
                      >
                        {busy ? "SIGNING THE CONTRACT…" : `⚔ SIGN THE CONTRACT — ${cost.toLocaleString()} 🪙`}
                      </button>
                      <div className="qh-hint">
                        {bagCapped.length === 0 ? `Pack the bag first — ${pName} won't march empty-handed.` :
                          !selAffordable ? `The contract costs ${cost.toLocaleString()} tokens — you carry ${tokens.toLocaleString()}. INSERT COINS in the HUD to top up.` :
                          "Tokens cover the month's content. Abandon anytime — unforged pieces are refunded. Ad spend always stays on your own connected accounts."}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
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
