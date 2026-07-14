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
  QUESTLINES, QUESTLINE_BY_KEY, DESTINATION_BY_KEY, CAMPAIGNS, TIERS, WORLD_META, questlineTokenCost, parseSchedule, spotName,
  QUEST_DURATION_DAYS, type QuestSlot, type ObjectiveType,
} from "../lib/questlines";
import { AVATARS, AVATAR_BY_ID, avatarImg } from "../lib/avatars";
import { Partner } from "../components/Partner";
import { getCompanion } from "../lib/companion.server";

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
    partner: null as { img: string; accent: string; name: string; srcs?: { a: string; b?: string; c?: string } } | null,
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

  const pd = getCompanion({
    id: shop.id, companionId: shop.companionId, companionName: shop.companionName,
    companionArt: shop.companionArt, planType: shop.activePlan?.type,
  });

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
    partner: { img: pd.img, accent: pd.accent, name: pd.name, srcs: pd.srcs },
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
function Bubble({ delay, shout = false, char }: { delay: number; shout?: boolean; char?: string }) {
  return (
    <g className="qh-bubble" style={{ ["--bd" as string]: `${delay}s` }}>
      <rect x="-8" y="-31" width="21" height="12" rx="4" fill="#fdfdf4" stroke="#2a2438" strokeWidth="1.2" />
      <path d="M 0 -19 l 3 4 l 2 -4 Z" fill="#fdfdf4" />
      {char || shout ? (
        <text x="2.5" y="-21.5" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#2a2438">{char || "!"}</text>
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
/* Journeys can span a WINDOW of worlds (tier = journey length) — the whole
 * panorama always renders as scenery, but the road only crosses the window. */
function routeFor(w0: number, w1: number): [number, number][] {
  return WORLDS.slice(w0, w1 + 1).flatMap((w, i) =>
    w.route.map(([x, y]) => [x + (w0 + i) * STEP, y] as [number, number])
  );
}

/** Even points along the waypoint polyline (t in 0..1 by arc length). */
function routePoint(ROUTE: [number, number][], t: number): { x: number; y: number } {
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

function TrailMap({ slots, xpReward, rendering, partner, cargo, onPick, onPickDay, onOpenBag, selectedIdx, selectedDay, destination, dayOf, duration, worldWindow }: {
  slots: QuestSlot[]; xpReward: number; rendering: boolean;
  partner: { img: string; accent: string; name: string; srcs?: { a: string; b?: string; c?: string } } | null;
  cargo: { title: string; image: string | null }[];
  onPick: (idx: number) => void; onPickDay: (day: number) => void; onOpenBag: () => void;
  worldWindow: [number, number];
  selectedIdx: number | null; selectedDay: number | null;
  destination: string; dayOf: number; duration: number;
}) {
  const ROUTE = routeFor(worldWindow[0], worldWindow[1]);
  const start = routePoint(ROUTE, 0);
  const end = routePoint(ROUTE, 1);
  const RENDER_W = 3200; // panorama pixels on screen (scrolls)

  // Content stops sit on their scheduled day; quiet days are small waypoints.
  const stopPts = slots.map((s) => ({ slot: s, ...routePoint(ROUTE, dayT(s.day, duration)) }));
  const slotDays = new Set(slots.map((s) => s.day));
  const waypointDays = Array.from({ length: duration }, (_, i) => i + 1).filter((d) => !slotDays.has(d));

  const contentDone = slots.every((s) => s.status === "READY" || s.status === "POSTED");
  const here = contentDone ? end : routePoint(ROUTE, dayT(Math.min(dayOf, duration), duration));
  // What the partner is up to: the closest content stop ahead (or the goal).
  const nextStop = stopPts.find((p) => p.slot.status === "FORGING" || p.slot.status === "SCHEDULED" || p.slot.status === "FAILED");
  const curSpot = contentDone ? destination : rendering && nextStop ? nextStop.slot.spot : `DAY ${dayOf}`;

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
          const p = routePoint(ROUTE, dayT(d, duration));
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
        {/* birds riding three sky lanes — wings actually beat */}
        {BIRD_LANES.map((b, i) => (
          <g key={`bd${i}`} opacity="0.55" transform={`scale(${b.size})`}>
            <g>
              <path d={`M0 ${b.y} q7 -8 14 0 q7 -8 14 0`} stroke="#14102a" strokeWidth="3" fill="none">
                <animate
                  attributeName="d"
                  values={`M0 ${b.y} q7 -8 14 0 q7 -8 14 0; M0 ${b.y} q7 6 14 0 q7 6 14 0; M0 ${b.y} q7 -8 14 0 q7 -8 14 0`}
                  dur="0.55s" begin={`${i * 0.15}s`} repeatCount="indefinite"
                />
              </path>
              <animateTransform attributeName="transform" type="translate" values={`-60 0; ${PANO_W + 100} -30`} dur={`${b.dur}s`} begin={`${b.delay}s`} repeatCount="indefinite" />
            </g>
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
            <path d="M 0 0 q 6 -7 12 0 q 6 -7 12 0" stroke="#3d2b16" strokeWidth="2.5" fill="none">
              <animate attributeName="d" values="M 0 0 q 6 -7 12 0 q 6 -7 12 0; M 0 0 q 6 5 12 0 q 6 5 12 0; M 0 0 q 6 -7 12 0 q 6 -7 12 0" dur="0.7s" repeatCount="indefinite" />
            </path>
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
        {/* ===== MORE LOCALS — kids, tradesfolk, and the town characters ===== */}
        {/* meadow: a sprinting kid, a shepherd & sheep, a baker on delivery */}
        <g transform="translate(700, 352) scale(0.8)">
          <g className="qh-walker" style={{ ["--px" as string]: "110px", ["--pd" as string]: "11s" }}>
            <g className="qh-stepbob"><NpcBody tunic="#e8842a" hat={<rect x="1" y="-16" width="6" height="2.5" fill="#a83a4a" />} /></g>
          </g>
        </g>
        <g transform="translate(238, 302)">
          <g className="qh-walker" style={{ ["--px" as string]: "100px", ["--pd" as string]: "38s" }}>
            <g className="qh-stepbob">
              <NpcBody tunic="#8a6a3a" hat={<rect x="-1" y="-16" width="10" height="3" fill="#c9955a" />} />
              <rect x="10" y="-14" width="2" height="19" fill="#8a5f33" shapeRendering="crispEdges" />
              <path d="M 12 -14 q 4 1 3 5" stroke="#8a5f33" strokeWidth="2" fill="none" />
              <g transform="translate(-16, 0)">
                <ellipse cx="0" cy="0" rx="6" ry="4.5" fill="#f4f0e6" /><circle cx="-5" cy="-2" r="2.5" fill="#d8d2c4" />
                <g className="qh-fA"><rect x="-3" y="4" width="2" height="3" fill="#8a8478" /><rect x="1.5" y="4" width="2" height="3" fill="#8a8478" /></g>
                <g className="qh-fB"><rect x="-1" y="4" width="2" height="3" fill="#8a8478" /></g>
              </g>
            </g>
          </g>
        </g>
        <g transform="translate(858, 300)">
          <g className="qh-walker" style={{ ["--px" as string]: "85px", ["--pd" as string]: "24s" }}>
            <g className="qh-stepbob">
              <NpcBody tunic="#8a5a3a" hat={<rect x="0" y="-17" width="8" height="4" rx="2" fill="#f4f0e6" />} />
              <rect x="1.5" y="-7" width="5" height="6" fill="#f4f0e6" />
              <rect x="8" y="-11" width="8" height="3" rx="1.5" fill="#d9a04e" shapeRendering="crispEdges" />
            </g>
          </g>
        </g>
        {/* SPECIALS: the wizard, the knight, the jester, the bard */}
        <g transform="translate(520, 362)">
          <g className="qh-walker" style={{ ["--px" as string]: "70px", ["--pd" as string]: "44s" }}>
            <g className="qh-stepbob">
              <NpcBody tunic="#7a5cff" hat={<g><path d="M 4 -14 l 5 -10 l 3 10 Z" fill="#5b3fd4" /><rect x="-1" y="-15" width="11" height="2.5" fill="#5b3fd4" /><circle cx="8" cy="-19" r="1.1" fill="#ffd76a" /></g>} />
              <rect x="10" y="-16" width="2" height="21" fill="#8a5f33" shapeRendering="crispEdges" />
              <circle cx="11" cy="-18" r="2.5" fill="#34E7E4">
                <animate attributeName="opacity" values="0.5;1;0.5" dur="2.2s" repeatCount="indefinite" />
                <animate attributeName="r" values="2.2;3;2.2" dur="2.2s" repeatCount="indefinite" />
              </circle>
            </g>
          </g>
        </g>
        <g transform="translate(348, 344)">
          <g className="qh-walker" style={{ ["--px" as string]: "120px", ["--pd" as string]: "30s" }}>
            <g className="qh-stepbob">
              <NpcBody tunic="#b8c4dd" skin="#b8c4dd" hat={<g><rect x="0" y="-17" width="8" height="4" rx="2" fill="#8a94b8" /><path d="M 3 -17 q 2 -6 5 -7 q 1 4 -1 7 Z" fill="#e24b4a" /></g>} />
              <rect x="10" y="-18" width="2" height="22" fill="#8a94b8" shapeRendering="crispEdges" />
              <path d="M 9.5 -18 l 3 -5 l 2 5 Z" fill="#d8deea" />
            </g>
          </g>
        </g>
        <g transform="translate(958, 292)">
          <g className="qh-stepbob">
            <NpcBody tunic="#e8c15a" walking={false} hat={<g><path d="M 0 -14 l -3 -6 l 4 2 Z M 4 -14 l 0 -8 l 3 4 Z M 8 -14 l 4 -5 l 0 6 Z" fill="#a83a4a" /><circle cx="-3" cy="-19" r="1" fill="#ffd76a" /><circle cx="6" cy="-21.5" r="1" fill="#ffd76a" /><circle cx="12" cy="-18.5" r="1" fill="#ffd76a" /></g>} />
            <rect x="0" y="-8" width="4" height="8" fill="#a83a4a" />
          </g>
          <Bubble delay={3.5} char="★" />
        </g>
        <g transform="translate(1002, 288)">
          <NpcBody tunic="#3a8a6a" walking={false} hat={<rect x="0" y="-16" width="8" height="3" fill="#2a6a4e" />} />
          <g className="qh-swing" style={{ transformOrigin: "50% 50%" }}>
            <ellipse cx="11" cy="-4" rx="4.5" ry="3" fill="#c9955a" transform="rotate(-30 11 -4)" />
            <rect x="13" y="-11" width="1.5" height="7" fill="#8a5f33" />
          </g>
          <Bubble delay={7.5} char="♪" />
        </g>
        {/* desert: the water carrier crosses the RIVER BY THE BRIDGE, like a person */}
        <g transform={`translate(${STEP + 715}, 326)`}>
          <g className="qh-walker" style={{ ["--px" as string]: "290px", ["--pd" as string]: "42s" }}>
            <g className="qh-stepbob">
              <NpcBody tunic="#c9764a" skin="#c98a5a" hat={<rect x="1" y="-19" width="6" height="5" rx="1" fill="#d9a04e" />} />
            </g>
          </g>
        </g>
        <g transform={`translate(${STEP + 540}, 330)`}>
          <NpcBody tunic="#8a6a3a" skin="#c98a5a" walking={false} hat={<rect x="0" y="-17" width="8" height="4" rx="2" fill="#e8c15a" />} />
          <g className="qh-swing">
            <rect x="8" y="-13" width="2.5" height="13" fill="#8a5f33" />
            <path d="M 6 -15 q 3 -3 7 -2 q -1 3 -4 4 Z" fill="#9aa3ad" />
          </g>
        </g>
        <g transform={`translate(${STEP + 420}, 472)`}>
          <NpcBody tunic="#e8842a" skin="#c98a5a" walking={false} hat={<rect x="0" y="-17" width="8" height="4" rx="2" fill="#a83a4a" />} />
          <rect x="9" y="-6" width="2" height="6" fill="#8a5f33" transform="rotate(-32 9 -6)" shapeRendering="crispEdges" />
          <ellipse cx="16" cy="2" rx="5" ry="2.5" fill="#8a6a3a" />
          <g className="qh-surface" style={{ ["--sd" as string]: "3s" }}>
            <path d="M 16 0 q -3 -8 2 -12 q 4 -3 3 -7" stroke="#3a8a4a" strokeWidth="3" fill="none" strokeLinecap="round" />
            <circle cx="21" cy="-19" r="1.8" fill="#3a8a4a" />
          </g>
        </g>
        <g transform={`translate(${STEP + 900}, 482)`}>
          <NpcBody tunic="#c9b98f" skin="#c98a5a" walking={false} hat={<g><rect x="-2" y="-16" width="12" height="3" fill="#8a6a3a" /><rect x="1" y="-19" width="6" height="3" fill="#8a6a3a" /></g>} />
          <g className="qh-swing">
            <rect x="8" y="-12" width="2" height="14" fill="#8a5f33" />
            <rect x="6.5" y="1" width="5" height="4" fill="#9aa3ad" />
          </g>
          <ellipse cx="18" cy="4" rx="6" ry="2.5" fill="#c9a25e" />
        </g>
        {/* tundra: a skier, snowball kids, the ice fisherman, the alchemist */}
        <g transform={`translate(${STEP * 2 + 380}, 420)`}>
          <g className="qh-walker" style={{ ["--px" as string]: "220px", ["--pd" as string]: "16s" }}>
            <g>
              <NpcBody tunic="#e24b8a" walking={false} hat={<rect x="0" y="-16" width="8" height="3" fill="#f4f0e6" />} />
              <rect x="-4" y="5" width="16" height="2" rx="1" fill="#5a8ac9" shapeRendering="crispEdges" />
              <line x1="-3" y1="-6" x2="-6" y2="6" stroke="#8a5f33" strokeWidth="1.5" />
              <line x1="11" y1="-6" x2="14" y2="6" stroke="#8a5f33" strokeWidth="1.5" />
            </g>
          </g>
        </g>
        <g transform={`translate(${STEP * 2 + 700}, 402) scale(0.8)`}>
          <NpcBody tunic="#3a6ea8" walking={false} hat={<rect x="1" y="-16" width="6" height="2.5" fill="#e24b4a" />} />
          <Bubble delay={2} shout />
        </g>
        <g transform={`translate(${STEP * 2 + 732}, 402) scale(0.8)`}>
          <g transform="scale(-1, 1)"><NpcBody tunic="#2fa86a" walking={false} hat={<rect x="1" y="-16" width="6" height="2.5" fill="#e8c15a" />} /></g>
          <circle cx="-14" cy="-10" r="2.5" fill="#ffffff">
            <animate attributeName="cx" values="-14;-26" dur="2.6s" repeatCount="indefinite" />
            <animate attributeName="cy" values="-10;-16;-6" keyTimes="0;.5;1" dur="2.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="1;1;0" keyTimes="0;.8;1" dur="2.6s" repeatCount="indefinite" />
          </circle>
        </g>
        {/* the ice-fishing club — three regulars, three holes, zero fish */}
        {[
          { x: STEP * 2 + 800, y: 516, tunic: "#5a4a8a", hat: "#e8842a", flip: false },
          { x: STEP * 2 + 630, y: 548, tunic: "#a83a4a", hat: "#3a6ea8", flip: true },
          { x: STEP * 2 + 930, y: 556, tunic: "#2a6a4e", hat: "#e8c15a", flip: false },
        ].map((f, fi) => (
          <g key={`if${fi}`} transform={`translate(${f.x}, ${f.y})${f.flip ? " scale(-1, 1)" : ""}`}>
            <ellipse cx="14" cy="6" rx="7" ry="3" fill="#0e4a6a" />
            <NpcBody tunic={f.tunic} walking={false} hat={<rect x="0" y="-16" width="8" height="3" fill={f.hat} />} />
            <path d="M 8 -10 q 8 -4 12 4" stroke="#5a3d20" strokeWidth="1.5" fill="none" />
            <g className="qh-bobline" style={{ animationDelay: `${fi * 1.1}s` }}>
              <line x1="18" y1="-4" x2="18" y2="5" stroke="#dff2ff" strokeWidth="1" opacity="0.7" />
            </g>
          </g>
        ))}
        {/* bears — one per wilderness, minding their own business */}
        {[
          { x: 292, y: 252, fur: "#8a5f38", dark: "#6d4a2a", px: "90px", pd: "48s" },
          { x: STEP * 2 + 240, y: 384, fur: "#eef2fa", dark: "#c9d2e8", px: "110px", pd: "52s" },
          { x: STEP * 3 + 430, y: 432, fur: "#3d3028", dark: "#2a201a", px: "80px", pd: "44s" },
        ].map((b, bi) => (
          <g key={`br${bi}`} transform={`translate(${b.x}, ${b.y})`} shapeRendering="crispEdges">
            <g className="qh-walker" style={{ ["--px" as string]: b.px, ["--pd" as string]: b.pd }}>
              <g className="qh-stepbob">
                <rect x="0" y="-3" width="22" height="12" rx="4" fill={b.fur} />
                <rect x="18" y="-9" width="8" height="8" rx="2" fill={b.fur} />
                <circle cx="19" cy="-9" r="1.8" fill={b.fur} /><circle cx="24.5" cy="-9" r="1.8" fill={b.fur} />
                <rect x="25" y="-5" width="2.5" height="2" fill={b.dark} />
                <circle cx="22" cy="-6" r="0.9" fill="#14102a" />
                <g className="qh-fA"><rect x="2" y="9" width="3.5" height="6" fill={b.dark} /><rect x="15" y="9" width="3.5" height="6" fill={b.dark} /></g>
                <g className="qh-fB"><rect x="6" y="9" width="3.5" height="6" fill={b.dark} /><rect x="11.5" y="9" width="3.5" height="6" fill={b.dark} /></g>
              </g>
            </g>
          </g>
        ))}
        <g transform={`translate(${STEP * 2 + 1060}, 330)`}>
          <NpcBody tunic="#2fa86a" walking={false} hat={<g><circle cx="2" cy="-12" r="2" fill="#8ee89c" stroke="#1c5a2e" strokeWidth="0.8" /><circle cx="6.5" cy="-12" r="2" fill="#8ee89c" stroke="#1c5a2e" strokeWidth="0.8" /></g>} />
          <path d="M 10 -2 l 5 0 l 1.5 4 q -4 3 -8 0 Z" fill="#b77bff" opacity="0.9" />
          {[0, 1].map((k) => (
            <circle key={k} cx={13 + k * 2} r="1.2" fill="#b77bff" opacity="0">
              <animate attributeName="cy" values="-3;-14" dur="2.8s" begin={`${k * 1.3}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.9;0" dur="2.8s" begin={`${k * 1.3}s`} repeatCount="indefinite" />
            </circle>
          ))}
        </g>
        {/* volcano: a drummer, a fruit carrier, the levitating monk, the hula dancer */}
        <g transform={`translate(${STEP * 3 + 880}, 442)`}>
          <NpcBody tunic="#e24b4a" skin="#b8763a" walking={false} hat={<rect x="0" y="-11" width="8" height="2" fill="#ffd76a" />} />
          <rect x="10" y="-4" width="9" height="7" rx="1" fill="#8a5a3a" shapeRendering="crispEdges" />
          <g className="qh-swing"><rect x="11" y="-10" width="1.5" height="7" fill="#f4ead0" /></g>
          <Bubble delay={5} char="♪" />
        </g>
        <g transform={`translate(${STEP * 3 + 1055}, 428)`}>
          <g className="qh-walker" style={{ ["--px" as string]: "120px", ["--pd" as string]: "26s" }}>
            <g className="qh-stepbob">
              <NpcBody tunic="#d9a04e" skin="#b8763a" hat={<g><rect x="0" y="-19" width="8" height="5" rx="1" fill="#8a6a3a" /><circle cx="2" cy="-20" r="1.4" fill="#e24b4a" /><circle cx="6" cy="-20" r="1.4" fill="#ffd76a" /></g>} />
            </g>
          </g>
        </g>
        <g transform={`translate(${STEP * 3 + 848}, 372)`}>
          <g>
            <NpcBody tunic="#e8842a" skin="#b8763a" walking={false} />
            <animateTransform attributeName="transform" type="translate" additive="sum" values="0 0; 0 -4; 0 0" dur="4.2s" repeatCount="indefinite" />
          </g>
          <ellipse cx="4" cy="7" rx="7" ry="2" fill="#14102a" opacity="0.3">
            <animate attributeName="rx" values="7;5;7" dur="4.2s" repeatCount="indefinite" />
          </ellipse>
        </g>
        <g transform={`translate(${STEP * 3 + 985}, 458)`}>
          <g className="qh-shiprock">
            <NpcBody tunic="#2fa86a" skin="#b8763a" walking={false} hat={<rect x="0" y="-11" width="8" height="2" fill="#e24b8a" />} />
            <g fill="#3a8a4a" shapeRendering="crispEdges">
              {[0, 2, 4, 6].map((k) => <rect key={k} x={k * 2 - 1} y="0" width="1.5" height="5" />)}
            </g>
          </g>
        </g>
        {/* ===== THE PIRATE SHIP — crew included, sails the volcano sea ===== */}
        <g transform={`translate(${STEP * 3 + 265}, 572)`}>
          <g className="qh-walker" style={{ ["--px" as string]: "230px", ["--pd" as string]: "85s" }}>
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
        {/* a dragon perched on the tower town — long neck, raised wing, spiked tail */}
        <g transform="translate(1252, 192)">
          {/* tail curling off the roofline, arrow tip */}
          <path d="M 12 0 q 20 3 26 12 q 3 6 -4 8" stroke="#2f9152" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M 34 22 l 7 -1 l -3 6 Z" fill="#2f9152" />
          {/* raised wing, membrane ribs, gentle flap */}
          <g className="qh-wingR">
            <path d="M 4 -6 q 8 -24 30 -24 q -8 8 -9 16 q -10 -1 -21 8 Z" fill="#1f7a42" stroke="#144d29" strokeWidth="1.5" />
            <path d="M 8 -9 q 10 -14 22 -18 M 9 -8 q 12 -8 16 -7" stroke="#144d29" strokeWidth="1" fill="none" opacity="0.7" />
          </g>
          {/* body + pale belly + back spikes */}
          <ellipse cx="2" cy="0" rx="13" ry="7.5" fill="#2f9152" stroke="#144d29" strokeWidth="1.5" />
          <ellipse cx="0" cy="3.5" rx="9" ry="3.5" fill="#a8d9a0" />
          <path d="M -8 -6 l 3 -4 l 3 4 l 3 -4 l 3 4 l 3 -4 l 3 4 Z" fill="#144d29" />
          {/* neck reaching up, head with snout, horns, golden eye */}
          <path d="M -10 -2 q -8 -8 -7 -20" stroke="#2f9152" strokeWidth="6" fill="none" strokeLinecap="round" />
          <g>
            <path d="M -24 -26 q 0 -5 6 -5 l 6 0 q 5 0 5 5 q 0 4 -5 4 l -7 0 q -5 0 -5 -4 Z" fill="#2f9152" stroke="#144d29" strokeWidth="1.3" />
            <rect x="-29" y="-27" width="6" height="4" rx="1.5" fill="#2f9152" stroke="#144d29" strokeWidth="1" />
            <path d="M -12 -31 l 2 -6 l 3 4 Z M -18 -31 l 1 -6 l 4 4 Z" fill="#e8c15a" />
            <circle cx="-19" cy="-27" r="1.4" fill="#ffd76a" />
            <circle cx="-27" cy="-24.6" r="0.7" fill="#144d29" />
          </g>
          {/* claws gripping the roof */}
          <rect x="-7" y="6" width="4" height="4" rx="1" fill="#1f7a42" />
          <rect x="4" y="6" width="4" height="4" rx="1" fill="#1f7a42" />
          {/* smoke chuffs from the nostrils */}
          {[0, 1].map((k) => (
            <circle key={k} cx="-30" fill="#b8b2cc" opacity="0">
              <animate attributeName="cy" values="-28;-44" dur="5.5s" begin={`${k * 2.6}s`} repeatCount="indefinite" />
              <animate attributeName="r" values="1.5;4.5" dur="5.5s" begin={`${k * 2.6}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.6;0" dur="5.5s" begin={`${k * 2.6}s`} repeatCount="indefinite" />
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
        {/* the great sandworm — heads erupt across the valley, one at a time */}
        {[
          { x: STEP + 560, y: 305, sd: 0 },
          { x: STEP + 1080, y: 480, sd: 9 },
          { x: STEP + 350, y: 468, sd: 18 },
        ].map((w, wi) => (
          <g key={`wm${wi}`} transform={`translate(${w.x}, ${w.y})`}>
            <ellipse cx="0" cy="0" rx="16" ry="4.5" fill="#c9a25e" opacity="0.9" />
            <g className="qh-wormpop" style={{ ["--sd" as string]: `${w.sd}s` }}>
              <g shapeRendering="crispEdges">
                <rect x="-9" y="-34" width="18" height="34" rx="7" fill="#b8905a" />
                <rect x="-9" y="-12" width="18" height="3.5" fill="#8a6a3a" />
                <rect x="-9" y="-21" width="18" height="3.5" fill="#8a6a3a" />
                <rect x="-9" y="-30" width="18" height="3" fill="#8a6a3a" />
              </g>
              <circle cx="0" cy="-31" r="6.5" fill="#3d2712" />
              {[0, 60, 120, 180, 240, 300].map((a) => (
                <path
                  key={a}
                  d="M 0 -37.5 l 2.2 4 l -4.4 0 Z"
                  fill="#f4f0e6"
                  transform={`rotate(${a} 0 -31)`}
                />
              ))}
              {[[-16, -6], [17, -10], [-20, -16]].map(([sx, sy], k) => (
                <circle key={k} cx={sx} cy={sy} r="2" fill="#e8d9a0" opacity="0.85" />
              ))}
            </g>
          </g>
        ))}
        {/* the phoenix rides the volcano thermals, embers trailing */}
        <g transform={`translate(${STEP * 3 + 620}, 150)`}>
          <g>
            <path d="M 0 0 q 8 -9 16 0 q 8 -9 16 0" stroke="#ff9d4d" strokeWidth="4" fill="none" strokeLinecap="round">
              <animate attributeName="d" values="M 0 0 q 8 -9 16 0 q 8 -9 16 0; M 0 0 q 8 7 16 0 q 8 7 16 0; M 0 0 q 8 -9 16 0 q 8 -9 16 0" dur="0.6s" repeatCount="indefinite" />
            </path>
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
          { path: `M ${STEP * 3 + 1120} 606 a 70 18 0 1 0 140 0 a 70 18 0 1 0 -140 0`, dur: 16 },
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
              <path d="M 0 0 q 5 -6 10 0 q 5 -6 10 0" stroke="#f4f0e6" strokeWidth="2.5" fill="none">
                <animate attributeName="d" values="M 0 0 q 5 -6 10 0 q 5 -6 10 0; M 0 0 q 5 4 10 0 q 5 4 10 0; M 0 0 q 5 -6 10 0 q 5 -6 10 0" dur="0.5s" begin={`${i * 0.2}s`} repeatCount="indefinite" />
              </path>
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
          <Partner img={partner.img} accent={partner.accent} srcs={partner.srcs} />
          {rendering && <span className="qh-work-tool" aria-hidden="true">⚒️</span>}
          <span className={`tag${rendering ? " working" : ""}`}>
            {rendering ? `FORGING AT ${curSpot}` : curSpot}
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
  const [openKey, setOpenKey] = useState<string | null>(null); // campaign key
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
        <span className="qh-title">MARKETING <em>CAMPAIGNS</em></span>
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
            worldWindow={QUESTLINE_BY_KEY[q.template]?.worldWindow || [0, 3]}
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
        <div className="art">{partner && <Partner img={partner.img} accent={partner.accent} srcs={partner.srcs} />}</div>
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

      {/* The campaign catalog — marketing-first headlines, three tiers each.
          Tier = intensity AND journey length across the panorama. */}
      <div className="qh-win gold" style={{ marginBottom: 16 }}>
        <span className="qh-label gold">📣 MARKETING CAMPAIGNS<span className="r">pick a focus · pick how hard to push</span></span>
        <div className="qh-howto">
          <span><b>1.</b> Pick a campaign & tier</span>
          <span><b>2.</b> Pack products, pick your presenter</span>
          <span><b>3.</b> {pName} journeys the map — creating & scheduling your content all month</span>
        </div>
        {CAMPAIGNS.map((c) => {
          const skus = TIERS.map((t) => QUESTLINE_BY_KEY[`${c.key}_${t.key}`]).filter(Boolean);
          const activeQ = active.find((a) => QUESTLINE_BY_KEY[a.template]?.campaign === c.key || a.template.startsWith(c.key));
          const open = openKey === c.key;
          const cheapest = Math.min(...skus.map((s) => questlineTokenCost(s)));
          const world = WORLD_META[c.homeWorld];
          const selSku = skus.find((s) => s.key === selKey) || skus.find((s) => canRun(s.minTier)) || skus[0];
          return (
            <div key={c.key} className={`qh-quest-entry${open ? " open" : ""}`}>
              <button
                type="button"
                className={`qh-qrow${open ? " on" : ""}`}
                onClick={() => { setOpenKey(open ? null : c.key); if (!open && selSku) setSelKey(selSku.key); }}
              >
                <span style={{ display: "inline-flex", gap: 4, alignItems: "center", minWidth: 0 }}>
                  <span className="ptr">▶</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.icon} {c.headline} <span style={{ color: "#7d7da8" }}>— {c.label} · {world.icon} {world.name}</span>
                  </span>
                </span>
                {activeQ ? <span style={{ color: "#8ee89c" }}>⚑ RUNNING · DAY {activeQ.dayOf}</span> : (
                  <span className="cost">from {cheapest.toLocaleString()}🪙</span>
                )}
              </button>
              {open && (
                <div className="qh-qbody">
                  <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 13.5, color: "#e0dcf2", margin: "0 0 4px", lineHeight: 1.65 }}>{c.desc}</p>
                  <p className="qh-lore">{c.lore}</p>

                  {/* tier picker — one legible axis: how hard to push */}
                  <div className="qh-tier-row">
                    {skus.map((sku) => {
                      const locked = !canRun(sku.minTier);
                      const cost = questlineTokenCost(sku);
                      const on = selKey === sku.key;
                      const v = sku.objectives.find((o) => o.type === "video")?.target || 0;
                      const im = sku.objectives.find((o) => o.type === "image")?.target || 0;
                      const b = sku.objectives.find((o) => o.type === "blog")?.target || 0;
                      const tierMeta = TIERS.find((t) => t.key === sku.tier)!;
                      const nWorlds = sku.worldWindow[1] - sku.worldWindow[0] + 1;
                      return (
                        <button
                          key={sku.key} type="button"
                          className={`qh-tier${on ? " on" : ""}${locked ? " locked" : ""} t-${sku.tier.toLowerCase()}`}
                          onClick={() => setSelKey(sku.key)}
                        >
                          <span className="tname">{sku.tier}</span>
                          <span className="tblurb">{tierMeta.blurb}</span>
                          <span className="trec">
                            {v > 0 && <span>🎬 {v} videos</span>}
                            {im > 0 && <span>🖼 {im} image ads</span>}
                            {b > 0 && <span>📝 {b} blog posts</span>}
                          </span>
                          <span className="tjourney">🗺 {nWorlds === 4 ? "the full panorama" : `${nWorlds} world${nWorlds > 1 ? "s" : ""}`} → {sku.destination}</span>
                          <span className="tcost">{locked ? `🔒 ${sku.minTier[0] + sku.minTier.slice(1).toLowerCase()} package` : <>{cost.toLocaleString()}🪙 · +{sku.xpReward.toLocaleString()} XP{sku.recurring ? " · renews monthly" : ""}</>}</span>
                        </button>
                      );
                    })}
                  </div>

                  {activeQ ? (
                    <div className="qh-hint" style={{ textAlign: "left" }}>⚑ This campaign is already running — day {activeQ.dayOf} of {activeQ.duration}. Follow it on the board above.</div>
                  ) : selSku && canRun(selSku.minTier) ? (
                    <>
                      <div className="qh-detail-objs" style={{ marginTop: 12 }}>
                        <div style={{ color: "#e0d9b8" }}>📅 {selSku.cadence} · content forges ~a day before each drop · you can move any stop on the map</div>
                      </div>
                      <div className="qh-loadout-grid">
                        <div>
                          <label className="qh-field-label" htmlFor="qh-star">Star presenter (your Brand Face)</label>
                          <div className="qh-star-row">
                            {starId && (
                              <img
                                className="qh-star-face"
                                src={avatarImg(starId, starVariant)}
                                alt={AVATAR_BY_ID[starId]?.name || "Presenter"}
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
                        const drops = selSku.objectives.filter((o) => o.type !== "post").reduce((s, o) => s + o.target, 0);
                        const say =
                          bagCapped.length === 0 ? "Pack at least 1 item to march." :
                          bagCapped.length >= selSku.bagSize ? `Fully loaded! Each item stars in ~${Math.round((drops / selSku.bagSize) * 10) / 10} drops this month.` :
                          `${bagCapped.length} packed — ${pName} rotates ${bagCapped.length === 1 ? "it" : "them"} across the month's ${drops} drops.`;
                        return (
                          <div className="qh-packgrid" style={{ marginBottom: 14 }}>
                            <div>
                              <span className="qh-field-label">SUPPLY SHELF — your store catalog · click an item to pack it</span>
                              <div className="qh-bag">
                                {products.map((p) => {
                                  const inBag = bag.some((bi) => bi.id === p.id);
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
                              <span className="qh-field-label">🎒 YOUR PACK — {selSku.bagSize} pouches · click a pouch to unpack</span>
                              <div key={bagCapped.length} className="qh-bagart" style={{ animation: bagCapped.length ? "qh-bag-wiggle .4s ease" : undefined }}>
                                <img src="/quests/backpack.png" alt="Merchant's treasure pack" />
                                <div className={`qh-pouches${selSku.bagSize > 6 ? " big" : ""}`}>
                                  {Array.from({ length: selSku.bagSize }).map((_, i) => {
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
                              <div className="qh-load-row"><span>PACK LOAD</span><span>{bagCapped.length}/{selSku.bagSize}</span></div>
                              <div className="qh-load-bar"><i style={{ width: `${(bagCapped.length / selSku.bagSize) * 100}%` }} /></div>
                              <div className="qh-pack-say">{say}</div>
                            </div>
                          </div>
                        );
                      })()}

                      <button
                        type="button" className="qh-start"
                        disabled={busy || bagCapped.length === 0 || tokens < questlineTokenCost(selSku) || !starId}
                        onClick={startQuest}
                      >
                        {busy ? "SIGNING THE CONTRACT…" : `▶ START ${c.headline} · ${selSku.tier} — ${questlineTokenCost(selSku).toLocaleString()} 🪙`}
                      </button>
                      <div className="qh-hint">
                        {bagCapped.length === 0 ? `Pack the bag first — ${pName} won't march empty-handed.` :
                          tokens < questlineTokenCost(selSku) ? `This tier costs ${questlineTokenCost(selSku).toLocaleString()} tokens — you carry ${tokens.toLocaleString()}. INSERT COINS in the HUD to top up.` :
                          "Tokens cover the month's content. Abandon anytime — unforged pieces are refunded. Ad spend always stays on your own connected accounts."}
                      </div>
                    </>
                  ) : (
                    <div className="qh-hint" style={{ textAlign: "left" }}>🔒 {selSku ? `${selSku.tier} needs the ${selSku.minTier[0] + selSku.minTier.slice(1).toLowerCase()} package — pick an unlocked tier above or level up your package.` : ""}</div>
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
