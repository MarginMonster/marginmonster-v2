import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { Fragment, useEffect, useRef, useState } from "react";
import fs from "node:fs";
import path from "node:path";
import { Page, Banner, Box } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { tokensRemaining } from "../lib/tokens.server";
import { acceptQuestline, rescheduleSlot, abandonQuestline, swapQuestlineItem, addDrop } from "../lib/questlines.server";
import {
  QUESTLINES, QUESTLINE_BY_KEY, DESTINATION_BY_KEY, CAMPAIGNS, DIAMOND_CAMPAIGNS, CAMPAIGN_DEST, TIERS, WORLD_META, questlineTokenCost, questlineCostFor, parseSchedule, spotName,
  QUEST_DURATION_DAYS, type QuestSlot, type ObjectiveType,
} from "../lib/questlines";
import { AVATARS, AVATAR_BY_ID, avatarImg } from "../lib/avatars";
import { Partner } from "../components/Partner";
import { getCompanion } from "../lib/companion.server";
import { linkedFromCache } from "../lib/social-provider.server";

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
    products: [] as { id: string; title: string; image: string | null; url: string | null }[],
    tokens: 0, tier: "STARTER",
    brandFace: null as { id: string; variant: number } | null,
    castAvail: {} as Record<string, boolean>,
    partner: null as { img: string; accent: string; name: string; srcs?: { a: string; b?: string; c?: string } } | null,
    feed: [] as { ts: number; t: string; msg: string; tone: string; href?: string }[],
    renderingIds: [] as string[], working: false,
    socials: { meta: false, tiktok: false },
  };
  if (!shop) return json(empty);

  let products: { id: string; title: string; image: string | null; url: string | null }[] = [];
  try {
    const res = await admin.graphql(
      `{ products(first: 32, sortKey: UPDATED_AT, reverse: true) { edges { node { id title handle onlineStoreUrl featuredImage { url } } } } }`
    );
    const j = (await res.json()) as { data?: { products?: { edges?: { node: { id: string; title: string; featuredImage?: { url?: string } } }[] } } };
    products = (j.data?.products?.edges || []).map((e) => ({ id: e.node.id, title: e.node.title, image: e.node.featuredImage?.url || null, url: (e.node as { onlineStoreUrl?: string; handle?: string }).onlineStoreUrl || ((e.node as { handle?: string }).handle ? `https://${session.shop}/products/${(e.node as { handle?: string }).handle}` : null) }));
  } catch { /* picker just renders empty */ }

  const castAvail: Record<string, boolean> = {};
  try {
    const files = new Set(fs.readdirSync(path.join(process.cwd(), "public", "avatars")));
    for (const a of AVATARS) if (files.has(`${a.id}_0.jpg`) || files.has(`${a.id}.jpg`)) castAvail[a.id] = true;
  } catch { /* empty roster */ }

  // connected social platforms (via the auto-posting provider) — gates the
  // auto-post messaging honestly
  const socials = { meta: false, tiktok: false };
  try {
    const linked = linkedFromCache(shop.socialsJson);
    socials.meta = linked.includes("facebook") || linked.includes("instagram");
    socials.tiktok = linked.includes("tiktok");
  } catch { /* chip just shows the connect prompt */ }

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
    let bag: { title: string; image: string | null; url?: string | null }[] = [];
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

  if (intent === "addDrop") {
    const res = await addDrop(
      shop.id,
      (form.get("questlineId") as string) || "",
      parseInt((form.get("day") as string) || "0", 10),
      ((form.get("dropType") as string) || "video") as "video" | "image" | "blog",
      {
        instant: form.get("instant") === "1",
        productTitle: ((form.get("dropProduct") as string) || "").trim() || undefined,
        direction: ((form.get("dropTopic") as string) || "").trim() || undefined,
      }
    );
    return json(res.ok ? { dropAdded: res.cost, instant: form.get("instant") === "1" } : { error: res.error });
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

/* Each campaign's banner wears its finale world. */
const BANNER_ART: Record<string, string> = {
  GET_SEEN: "/quests/w-gs4.jpg",
  LAUNCH_IT: "/quests/w-li4.jpg",
  STAY_STEADY: "/quests/w-ss4.jpg",
  OWN_THE_SEARCH: "/quests/w-os4.jpg",
  // diamond shelf — distinct art per line (own painted sets on the art backlog)
  DAILY_FEED: "/quests/w-gs2.jpg",
  VIDEO_STORM: "/quests/w-li3.jpg",
  AD_BLITZ: "/quests/w-os2.jpg",
  OMNIPRESENCE: "/quests/w-ss3.jpg",
};

/* Benefit meters — the "difficulty bar" of a questline, but for what it pays
 * out: posting pace + what the line is rich in. 5 segments each. */
function meterSegs(sku: { objectives: { type: string; target: number }[] }) {
  const g = (t: string) => sku.objectives.find((o) => o.type === t)?.target || 0;
  const v = g("video"), i = g("image"), b = g("blog");
  const perWeek = ((v + i + b) / 30) * 7;
  return {
    pace: Math.max(1, Math.min(5, Math.round(perWeek / 1.6))),
    video: v === 0 ? 0 : Math.max(1, Math.min(5, Math.ceil(v / 5))),
    ads: i === 0 ? 0 : Math.max(1, Math.min(5, Math.ceil(i / 6))),
    seo: b === 0 ? 0 : Math.max(1, Math.min(5, Math.ceil(b / 3))),
    perWeek,
  };
}

function Meter({ label, val, color, hint }: { label: string; val: number; color: string; hint: string }) {
  if (val <= 0) return null;
  return (
    <span className="qh-meter" title={hint}>
      <span className="lb">{label}</span>
      <span className="segs">
        {[1, 2, 3, 4, 5].map((n) => (
          <i key={n} className={`sg${n <= val ? " on" : ""}`} style={n <= val ? { background: color } : undefined} />
        ))}
      </span>
    </span>
  );
}

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

/* ---- The painted panorama, world-set edition ----
 * Every campaign owns a themed 4-world map set; the CLASSIC set serves legacy
 * expeditions. Life is data-driven: weather + critters + folk come from each
 * world's BIOME tag, and art-specific set-pieces (water, smoke, perches, ice
 * holes, the ship) come from per-world ANCHORS — so any new painting can be
 * brought to life by tagging it, not by rewriting the map. */

const MAP_W = 1536;
const MAP_H = 640;
const SEAM = 140;
const STEP = MAP_W - SEAM;
const PANO_WORLDS = 4;
const PANO_W = STEP * (PANO_WORLDS - 1) + MAP_W;

type Biome = "meadow" | "desert" | "tundra" | "volcano";
type Anchor =
  | { kind: "ripple" | "wave" | "boat" | "whale" | "nessie" | "hole" | "smoke" | "glow" | "perch"; x: number; y: number }
  | { kind: "shark" | "ship"; x: number; y: number; dist?: number };
type WorldDef = { src: string; biome: Biome; route: [number, number][]; anchors: Anchor[] };

const CLASSIC: WorldDef[] = [
  {
    src: "/quests/worldmap.jpg", biome: "meadow",
    route: [[355, 390], [480, 315], [620, 250], [770, 340], [930, 285], [1075, 320], [1250, 245], [1470, 300]],
    anchors: [
      { kind: "ripple", x: 1150, y: 430 }, { kind: "ripple", x: 640, y: 610 }, { kind: "wave", x: 1000, y: 392 },
      { kind: "boat", x: 1035, y: 398 }, { kind: "shark", x: 320, y: 614, dist: 390 },
      { kind: "nessie", x: 630, y: 618 }, { kind: "perch", x: 1248, y: 194 },
    ],
  },
  {
    src: "/quests/world-desert.jpg", biome: "desert",
    route: [[70, 470], [430, 480], [450, 400], [640, 360], [875, 335], [1040, 470], [1185, 415], [1470, 430]],
    anchors: [{ kind: "ripple", x: 780, y: 480 }, { kind: "wave", x: 830, y: 420 }],
  },
  {
    src: "/quests/world-tundra.jpg", biome: "tundra",
    route: [[70, 430], [470, 390], [700, 330], [940, 300], [1150, 345], [1470, 360]],
    anchors: [
      { kind: "smoke", x: 738, y: 92 }, { kind: "smoke", x: 972, y: 152 },
      { kind: "hole", x: 800, y: 516 }, { kind: "hole", x: 630, y: 548 }, { kind: "hole", x: 930, y: 556 },
      { kind: "ripple", x: 800, y: 520 }, { kind: "wave", x: 760, y: 545 },
    ],
  },
  {
    src: "/quests/world-volcano.jpg", biome: "volcano",
    route: [[70, 480], [300, 520], [560, 470], [770, 430], [930, 400], [865, 330]],
    anchors: [
      { kind: "glow", x: 748, y: 96 }, { kind: "ship", x: 265, y: 572, dist: 230 },
      { kind: "shark", x: 110, y: 612, dist: 500 }, { kind: "whale", x: 1270, y: 596 },
      { kind: "boat", x: 210, y: 592 }, { kind: "ripple", x: 380, y: 545 }, { kind: "ripple", x: 1180, y: 560 },
      { kind: "wave", x: 350, y: 570 },
    ],
  },
];

/* Campaign world sets — every campaign owns a themed, tuned 4-world map.
 * GET SEEN: a celebration tour. LAUNCH IT: jungle camp to the beacon.
 * STAY STEADY: the four seasons. OWN THE SEARCH: an archaeology expedition. */
const WORLD_SETS: Record<string, WorldDef[]> = {
  CLASSIC,
  GET_SEEN: [
    {
      src: "/quests/w-gs1.jpg", biome: "meadow",
      route: [[80, 460], [320, 420], [560, 360], [800, 320], [1040, 360], [1260, 410], [1470, 400]],
      anchors: [{ kind: "smoke", x: 163, y: 80 }, { kind: "smoke", x: 1408, y: 60 }, { kind: "perch", x: 1250, y: 128 }],
    },
    {
      src: "/quests/w-gs2.jpg", biome: "meadow",
      route: [[70, 420], [260, 380], [430, 440], [600, 520], [720, 560], [880, 540], [1050, 480], [1250, 440], [1470, 470]],
      anchors: [{ kind: "ripple", x: 700, y: 400 }, { kind: "ripple", x: 660, y: 560 }, { kind: "wave", x: 690, y: 470 }],
    },
    {
      src: "/quests/w-gs3.jpg", biome: "meadow",
      route: [[70, 520], [300, 470], [520, 440], [700, 420], [880, 430], [1100, 420], [1300, 380], [1470, 420]],
      anchors: [{ kind: "ripple", x: 755, y: 455 }],
    },
    {
      src: "/quests/w-gs4.jpg", biome: "desert",
      route: [[70, 560], [300, 520], [560, 470], [770, 420], [990, 380], [1200, 330], [1420, 320]],
      anchors: [{ kind: "ripple", x: 770, y: 350 }],
    },
  ],
  LAUNCH_IT: [
    {
      src: "/quests/w-li1.jpg", biome: "volcano",
      route: [[90, 420], [330, 440], [560, 430], [790, 428], [1010, 400], [1200, 360], [1470, 380]],
      anchors: [{ kind: "ripple", x: 830, y: 300 }, { kind: "ripple", x: 700, y: 540 }, { kind: "wave", x: 950, y: 250 }],
    },
    {
      src: "/quests/w-li2.jpg", biome: "volcano",
      route: [[70, 300], [300, 340], [520, 300], [760, 340], [980, 300], [1200, 340], [1470, 300]],
      anchors: [],
    },
    {
      src: "/quests/w-li3.jpg", biome: "volcano",
      route: [[70, 540], [300, 560], [560, 540], [760, 520], [980, 480], [1200, 440], [1470, 420]],
      anchors: [{ kind: "ripple", x: 745, y: 510 }, { kind: "smoke", x: 455, y: 155 }, { kind: "smoke", x: 965, y: 205 }],
    },
    {
      src: "/quests/w-li4.jpg", biome: "volcano",
      route: [[70, 560], [300, 540], [520, 520], [760, 500], [980, 440], [1130, 330], [1160, 270]],
      anchors: [{ kind: "glow", x: 1132, y: 95 }],
    },
  ],
  STAY_STEADY: [
    {
      src: "/quests/w-ss1.jpg", biome: "meadow",
      route: [[90, 430], [330, 460], [560, 400], [700, 330], [900, 330], [1080, 330], [1300, 300], [1470, 320]],
      anchors: [{ kind: "ripple", x: 1000, y: 420 }, { kind: "ripple", x: 880, y: 560 }, { kind: "smoke", x: 600, y: 95 }],
    },
    {
      src: "/quests/w-ss2.jpg", biome: "meadow",
      route: [[200, 600], [320, 480], [380, 380], [520, 330], [700, 300], [900, 290], [1100, 300], [1300, 320], [1470, 340]],
      anchors: [{ kind: "ripple", x: 1050, y: 300 }, { kind: "ripple", x: 1200, y: 380 }, { kind: "wave", x: 1000, y: 270 }],
    },
    {
      src: "/quests/w-ss3.jpg", biome: "meadow",
      route: [[70, 170], [350, 180], [620, 260], [820, 360], [1040, 470], [1300, 540], [1470, 560]],
      anchors: [{ kind: "smoke", x: 835, y: 35 }, { kind: "smoke", x: 1235, y: 180 }],
    },
    {
      src: "/quests/w-ss4.jpg", biome: "tundra",
      route: [[70, 420], [300, 430], [520, 340], [700, 300], [880, 310], [1060, 340], [1240, 420], [1400, 470]],
      anchors: [
        { kind: "hole", x: 700, y: 480 }, { kind: "hole", x: 950, y: 500 }, { kind: "ripple", x: 820, y: 520 },
        { kind: "smoke", x: 795, y: 75 }, { kind: "smoke", x: 1165, y: 150 },
      ],
    },
  ],
  OWN_THE_SEARCH: [
    {
      src: "/quests/w-os1.jpg", biome: "desert",
      route: [[80, 560], [300, 500], [480, 420], [560, 330], [700, 380], [850, 440], [1000, 480], [1200, 500], [1470, 520]],
      anchors: [],
    },
    {
      src: "/quests/w-os2.jpg", biome: "desert",
      route: [[70, 560], [300, 530], [560, 470], [760, 420], [950, 330], [1100, 260], [1300, 220], [1470, 200]],
      anchors: [],
    },
    {
      src: "/quests/w-os3.jpg", biome: "desert",
      route: [[70, 520], [300, 480], [560, 420], [790, 380], [1000, 330], [1200, 280], [1400, 260]],
      anchors: [{ kind: "ripple", x: 640, y: 520 }, { kind: "wave", x: 600, y: 560 }],
    },
    {
      src: "/quests/w-os4.jpg", biome: "desert",
      route: [[70, 540], [300, 560], [560, 540], [780, 470], [960, 420], [1150, 380], [1300, 340]],
      anchors: [{ kind: "ripple", x: 700, y: 450 }, { kind: "ripple", x: 850, y: 560 }, { kind: "boat", x: 720, y: 500 }, { kind: "wave", x: 600, y: 430 }],
    },
  ],
};

function worldsFor(setKey: string): WorldDef[] {
  return WORLD_SETS[setKey] || CLASSIC;
}
function routeFor(worlds: WorldDef[], w0: number, w1: number): [number, number][] {
  return worlds.slice(w0, w1 + 1).flatMap((w, i) =>
    w.route.map(([x, y]) => [x + (w0 + i) * STEP, y] as [number, number])
  );
}
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
function dayT(day: number, duration: number): number {
  return 0.03 + (Math.max(0, Math.min(duration, day)) / duration) * 0.94;
}

const BIRD_LANES = [
  { y: 60, dur: 34, delay: 0, size: 1 },
  { y: 96, dur: 46, delay: 12, size: 0.8 },
  { y: 42, dur: 55, delay: 26, size: 1.2 },
];

/* ===== biome life bundles (dx = world offset in panorama coords) ===== */

function WeatherLife({ biome, dx }: { biome: Biome; dx: number }) {
  if (biome === "meadow") {
    return (
      <>
        {Array.from({ length: 8 }).map((_, i) => (
          <circle key={`pt${i}`} r={2.5 + (i % 2)} fill="#f2a3c4" opacity="0.85">
            <animate attributeName="cy" values="-8;648" dur={`${9 + (i % 5)}s`} begin={`${i * 1.4}s`} repeatCount="indefinite" />
            <animate attributeName="cx" values={`${dx + 250 + ((i * 160) % 900)};${dx + 310 + ((i * 160) % 900)}`} dur={`${9 + (i % 5)}s`} begin={`${i * 1.4}s`} repeatCount="indefinite" />
          </circle>
        ))}
        <g opacity="0.8">
          <circle r="4" fill="#f2a3c4"><animateMotion dur="11s" repeatCount="indefinite" path={`M ${dx + 500} 300 q 40 -30 80 0 q 40 30 80 0 q -60 40 -160 0 Z`} /></circle>
          <circle r="4" fill="#8fd4f2"><animateMotion dur="14s" begin="3s" repeatCount="indefinite" path={`M ${dx + 900} 320 q -30 -40 -70 -10 q -30 30 10 50 q 50 10 60 -40 Z`} /></circle>
        </g>
      </>
    );
  }
  if (biome === "desert") {
    return (
      <>
        {Array.from({ length: 7 }).map((_, i) => (
          <circle key={`sm${i}`} r="2.5" fill="#e8d9a0" opacity="0.6">
            <animate attributeName="cx" values={`${dx + 60 + ((i * 190) % 1200)};${dx + 360 + ((i * 190) % 1200)}`} dur={`${11 + (i % 6)}s`} begin={`${i * 1.1}s`} repeatCount="indefinite" />
            <animate attributeName="cy" values={`${340 + ((i * 41) % 240)};${330 + ((i * 41) % 240)}`} dur={`${11 + (i % 6)}s`} begin={`${i * 1.1}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;.6;0" dur={`${11 + (i % 6)}s`} begin={`${i * 1.1}s`} repeatCount="indefinite" />
          </circle>
        ))}
      </>
    );
  }
  if (biome === "tundra") {
    return (
      <>
        {Array.from({ length: 14 }).map((_, i) => (
          <circle key={`sn${i}`} r={1.8 + (i % 3) * 0.8} fill="#ffffff" opacity="0.85">
            <animate attributeName="cy" values="-8;648" dur={`${8 + (i % 6)}s`} begin={`${i * 0.7}s`} repeatCount="indefinite" />
            <animate attributeName="cx" values={`${dx + 30 + ((i * 117) % 1460)};${dx + 70 + ((i * 117) % 1460)}`} dur={`${8 + (i % 6)}s`} begin={`${i * 0.7}s`} repeatCount="indefinite" />
          </circle>
        ))}
      </>
    );
  }
  // volcano: rising embers (the glow itself is an anchor)
  return (
    <>
      {Array.from({ length: 7 }).map((_, i) => (
        <circle key={`em${i}`} r="2.5" fill="#ffb03a" opacity="0">
          <animate attributeName="cx" values={`${dx + 700 + ((i * 23) % 110)};${dx + 690 + ((i * 31) % 130)}`} dur={`${5 + (i % 4)}s`} begin={`${i * 0.9}s`} repeatCount="indefinite" />
          <animate attributeName="cy" values="160;36" dur={`${5 + (i % 4)}s`} begin={`${i * 0.9}s`} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.9;0" dur={`${5 + (i % 4)}s`} begin={`${i * 0.9}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </>
  );
}

function CritterLife({ biome, dx }: { biome: Biome; dx: number }) {
  if (biome === "meadow") {
    return (
      <>
        <g transform={`translate(${dx + 545}, 328)`}>
          <g className="qh-walker" style={{ ["--px" as string]: "110px", ["--pd" as string]: "18s" }}>
            <g className="qh-stepbob">
              <ellipse cx="0" cy="0" rx="7" ry="5" fill="#f4f0e6" />
              <rect x="-4" y="-9" width="2.5" height="6" rx="1" fill="#f4f0e6" /><rect x="1" y="-9" width="2.5" height="6" rx="1" fill="#f4f0e6" />
              <circle cx="-4.5" cy="-1" r="1" fill="#2a2020" />
            </g>
          </g>
        </g>
        <g transform={`translate(${dx + 165}, 330)`} shapeRendering="crispEdges">
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
        <g transform={`translate(${dx + 292}, 252)`} shapeRendering="crispEdges">
          <g className="qh-walker" style={{ ["--px" as string]: "90px", ["--pd" as string]: "48s" }}>
            <g className="qh-stepbob">
              <rect x="0" y="-3" width="22" height="12" rx="4" fill="#8a5f38" />
              <rect x="18" y="-9" width="8" height="8" rx="2" fill="#8a5f38" />
              <circle cx="19" cy="-9" r="1.8" fill="#8a5f38" /><circle cx="24.5" cy="-9" r="1.8" fill="#8a5f38" />
              <rect x="25" y="-5" width="2.5" height="2" fill="#6d4a2a" />
              <circle cx="22" cy="-6" r="0.9" fill="#14102a" />
              <g className="qh-fA"><rect x="2" y="9" width="3.5" height="6" fill="#6d4a2a" /><rect x="15" y="9" width="3.5" height="6" fill="#6d4a2a" /></g>
              <g className="qh-fB"><rect x="6" y="9" width="3.5" height="6" fill="#6d4a2a" /><rect x="11.5" y="9" width="3.5" height="6" fill="#6d4a2a" /></g>
            </g>
          </g>
        </g>
        <g transform={`translate(${dx + 1040}, 300)`} opacity="0.75">
          <g>
            <path d="M 0 0 q 5 -6 10 0 q 5 -6 10 0" stroke="#f4f0e6" strokeWidth="2.5" fill="none">
              <animate attributeName="d" values="M 0 0 q 5 -6 10 0 q 5 -6 10 0; M 0 0 q 5 4 10 0 q 5 4 10 0; M 0 0 q 5 -6 10 0 q 5 -6 10 0" dur="0.5s" repeatCount="indefinite" />
            </path>
            <animateMotion dur="16s" repeatCount="indefinite" path="M 0 0 a 62 24 0 1 0 124 0 a 62 24 0 1 0 -124 0" />
          </g>
        </g>
      </>
    );
  }
  if (biome === "desert") {
    return (
      <>
        <g transform={`translate(${dx + 990}, 512)`} shapeRendering="crispEdges">
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
        <g transform={`translate(${dx + 330}, 112)`} opacity="0.65">
          <g>
            <path d="M 0 0 q 6 -7 12 0 q 6 -7 12 0" stroke="#3d2b16" strokeWidth="2.5" fill="none">
              <animate attributeName="d" values="M 0 0 q 6 -7 12 0 q 6 -7 12 0; M 0 0 q 6 5 12 0 q 6 5 12 0; M 0 0 q 6 -7 12 0 q 6 -7 12 0" dur="0.7s" repeatCount="indefinite" />
            </path>
            <animateMotion dur="21s" repeatCount="indefinite" path="M 0 0 a 95 32 0 1 0 190 0 a 95 32 0 1 0 -190 0" />
          </g>
        </g>
      </>
    );
  }
  if (biome === "tundra") {
    return (
      <>
        <g transform={`translate(${dx + 480}, 296)`} shapeRendering="crispEdges">
          <g className="qh-walker" style={{ ["--px" as string]: "170px", ["--pd" as string]: "30s" }}>
            <g className="qh-stepbob">
              <rect x="0" y="0" width="15" height="7" rx="2" fill="#d97f3e" />
              <rect x="13" y="-5" width="5" height="6" fill="#d97f3e" /><path d="M 0 2 q -9 -2 -12 4 q 6 4 12 0 Z" fill="#e89a5e" />
              <g className="qh-fA"><rect x="2" y="7" width="2" height="5" fill="#a85f2e" /><rect x="11" y="7" width="2" height="5" fill="#a85f2e" /></g>
              <g className="qh-fB"><rect x="4.5" y="7" width="2" height="5" fill="#a85f2e" /><rect x="8.5" y="7" width="2" height="5" fill="#a85f2e" /></g>
            </g>
          </g>
        </g>
        <g transform={`translate(${dx + 850}, 448)`} shapeRendering="crispEdges">
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
        <g transform={`translate(${dx + 240}, 384)`} shapeRendering="crispEdges">
          <g className="qh-walker" style={{ ["--px" as string]: "110px", ["--pd" as string]: "52s" }}>
            <g className="qh-stepbob">
              <rect x="0" y="-3" width="22" height="12" rx="4" fill="#eef2fa" />
              <rect x="18" y="-9" width="8" height="8" rx="2" fill="#eef2fa" />
              <circle cx="19" cy="-9" r="1.8" fill="#eef2fa" /><circle cx="24.5" cy="-9" r="1.8" fill="#eef2fa" />
              <rect x="25" y="-5" width="2.5" height="2" fill="#c9d2e8" />
              <circle cx="22" cy="-6" r="0.9" fill="#14102a" />
              <g className="qh-fA"><rect x="2" y="9" width="3.5" height="6" fill="#c9d2e8" /><rect x="15" y="9" width="3.5" height="6" fill="#c9d2e8" /></g>
              <g className="qh-fB"><rect x="6" y="9" width="3.5" height="6" fill="#c9d2e8" /><rect x="11.5" y="9" width="3.5" height="6" fill="#c9d2e8" /></g>
            </g>
          </g>
        </g>
      </>
    );
  }
  // volcano
  return (
    <>
      <g transform={`translate(${dx + 790}, 298)`}>
        <g>
          <circle r="4.5" fill="#e24b4a" />
          <path d="M -2 -2 q -8 -7 -14 -2 M 2 -2 q 8 -7 14 -2" stroke="#e24b4a" strokeWidth="2.5" fill="none">
            <animate attributeName="d" values="M -2 -2 q -8 -7 -14 -2 M 2 -2 q 8 -7 14 -2; M -2 0 q -8 5 -14 2 M 2 0 q 8 5 14 2; M -2 -2 q -8 -7 -14 -2 M 2 -2 q 8 -7 14 -2" dur="0.6s" repeatCount="indefinite" />
          </path>
          <animateMotion dur="15s" repeatCount="indefinite" path="M 0 0 a 84 44 0 1 0 168 0 a 84 44 0 1 0 -168 0" />
        </g>
      </g>
      <g transform={`translate(${dx + 430}, 432)`} shapeRendering="crispEdges">
        <g className="qh-walker" style={{ ["--px" as string]: "80px", ["--pd" as string]: "44s" }}>
          <g className="qh-stepbob">
            <rect x="0" y="-3" width="22" height="12" rx="4" fill="#3d3028" />
            <rect x="18" y="-9" width="8" height="8" rx="2" fill="#3d3028" />
            <circle cx="19" cy="-9" r="1.8" fill="#3d3028" /><circle cx="24.5" cy="-9" r="1.8" fill="#3d3028" />
            <rect x="25" y="-5" width="2.5" height="2" fill="#2a201a" />
            <circle cx="22" cy="-6" r="0.9" fill="#e8e8f0" />
            <g className="qh-fA"><rect x="2" y="9" width="3.5" height="6" fill="#2a201a" /><rect x="15" y="9" width="3.5" height="6" fill="#2a201a" /></g>
            <g className="qh-fB"><rect x="6" y="9" width="3.5" height="6" fill="#2a201a" /><rect x="11.5" y="9" width="3.5" height="6" fill="#2a201a" /></g>
          </g>
        </g>
      </g>
      <g transform={`translate(${dx + 1000}, 400)`} opacity="0.75">
        <g>
          <path d="M 0 0 q 5 -6 10 0 q 5 -6 10 0" stroke="#f4f0e6" strokeWidth="2.5" fill="none">
            <animate attributeName="d" values="M 0 0 q 5 -6 10 0 q 5 -6 10 0; M 0 0 q 5 4 10 0 q 5 4 10 0; M 0 0 q 5 -6 10 0 q 5 -6 10 0" dur="0.5s" begin="0.2s" repeatCount="indefinite" />
          </path>
          <animateMotion dur="20s" begin="2s" repeatCount="indefinite" path="M 0 0 a 62 24 0 1 0 124 0 a 62 24 0 1 0 -124 0" />
        </g>
      </g>
    </>
  );
}

function FolkLife({ biome, dx, pName }: { biome: Biome; dx: number; pName: string }) {
  if (biome === "meadow") {
    return (
      <>
        <g transform={`translate(${dx + 450}, 372)`}>
          <g className="qh-walker" style={{ ["--px" as string]: "140px", ["--pd" as string]: "30s" }}>
            <g className="qh-stepbob"><NpcBody tunic="#5d8a4a" hat={<rect x="-1" y="-16" width="10" height="3" fill="#e8c15a" />} /></g>
          </g>
        </g>
        <g transform={`translate(${dx + 585}, 292)`}>
          <NpcBody tunic="#7a5a8a" walking={false} hat={<rect x="0" y="-16" width="8" height="3" fill="#c9955a" />} />
          <g className="qh-swing">
            <rect x="8" y="-14" width="2.5" height="16" fill="#8a5f33" />
            <rect x="7" y="1" width="5" height="3" fill="#9aa3ad" />
          </g>
        </g>
        <g transform={`translate(${dx + 915}, 262)`}>
          <NpcBody tunic="#a83a4a" walking={false} hat={<rect x="1" y="-16" width="6" height="2.5" fill="#5a3d20" />} />
          <Bubble delay={0} />
        </g>
        <g transform={`translate(${dx + 944}, 262)`}>
          <g transform="scale(-1, 1)"><NpcBody tunic="#3a6ea8" walking={false} /></g>
          <Bubble delay={5.5} />
        </g>
        <g transform={`translate(${dx + 700}, 352)`}>
          <g className="qh-walker" style={{ ["--px" as string]: "110px", ["--pd" as string]: "11s" }}>
            <g className="qh-stepbob" transform="scale(0.8)"><NpcBody tunic="#e8842a" hat={<rect x="1" y="-16" width="6" height="2.5" fill="#a83a4a" />} /></g>
          </g>
        </g>
        <g transform={`translate(${dx + 238}, 302)`}>
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
        <g transform={`translate(${dx + 858}, 300)`}>
          <g className="qh-walker" style={{ ["--px" as string]: "85px", ["--pd" as string]: "24s" }}>
            <g className="qh-stepbob">
              <NpcBody tunic="#8a5a3a" hat={<rect x="0" y="-17" width="8" height="4" rx="2" fill="#f4f0e6" />} />
              <rect x="1.5" y="-7" width="5" height="6" fill="#f4f0e6" />
              <rect x="8" y="-11" width="8" height="3" rx="1.5" fill="#d9a04e" shapeRendering="crispEdges" />
            </g>
          </g>
        </g>
        <g transform={`translate(${dx + 520}, 362)`}>
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
        <g transform={`translate(${dx + 348}, 344)`}>
          <g className="qh-walker" style={{ ["--px" as string]: "120px", ["--pd" as string]: "30s" }}>
            <g className="qh-stepbob">
              <NpcBody tunic="#b8c4dd" skin="#b8c4dd" hat={<g><rect x="0" y="-17" width="8" height="4" rx="2" fill="#8a94b8" /><path d="M 3 -17 q 2 -6 5 -7 q 1 4 -1 7 Z" fill="#e24b4a" /></g>} />
              <rect x="10" y="-18" width="2" height="22" fill="#8a94b8" shapeRendering="crispEdges" />
              <path d="M 9.5 -18 l 3 -5 l 2 5 Z" fill="#d8deea" />
            </g>
          </g>
        </g>
        <g transform={`translate(${dx + 958}, 292)`}>
          <g className="qh-stepbob">
            <NpcBody tunic="#e8c15a" walking={false} hat={<g><path d="M 0 -14 l -3 -6 l 4 2 Z M 4 -14 l 0 -8 l 3 4 Z M 8 -14 l 4 -5 l 0 6 Z" fill="#a83a4a" /><circle cx="-3" cy="-19" r="1" fill="#ffd76a" /><circle cx="6" cy="-21.5" r="1" fill="#ffd76a" /><circle cx="12" cy="-18.5" r="1" fill="#ffd76a" /></g>} />
            <rect x="0" y="-8" width="4" height="8" fill="#a83a4a" />
          </g>
          <Bubble delay={3.5} char="★" />
        </g>
        <g transform={`translate(${dx + 1002}, 288)`}>
          <NpcBody tunic="#3a8a6a" walking={false} hat={<rect x="0" y="-16" width="8" height="3" fill="#2a6a4e" />} />
          <g className="qh-swing" style={{ transformOrigin: "50% 50%" }}>
            <ellipse cx="11" cy="-4" rx="4.5" ry="3" fill="#c9955a" transform="rotate(-30 11 -4)" />
            <rect x="13" y="-11" width="1.5" height="7" fill="#8a5f33" />
          </g>
          <Bubble delay={7.5} char="♪" />
        </g>
      </>
    );
  }
  if (biome === "desert") {
    return (
      <>
        <g transform={`translate(${dx + 715}, 326)`}>
          <g className="qh-walker" style={{ ["--px" as string]: "290px", ["--pd" as string]: "42s" }}>
            <g className="qh-stepbob">
              <NpcBody tunic="#c9764a" skin="#c98a5a" hat={<rect x="1" y="-19" width="6" height="5" rx="1" fill="#d9a04e" />} />
            </g>
          </g>
        </g>
        <g transform={`translate(${dx + 1120}, 428)`}>
          <g className="qh-walker" style={{ ["--px" as string]: "115px", ["--pd" as string]: "26s" }}>
            <g className="qh-stepbob">
              <NpcBody tunic="#f4ead0" skin="#c98a5a" hat={<rect x="0" y="-17" width="8" height="4" rx="2" fill="#fdfdf4" />} />
            </g>
          </g>
        </g>
        <g transform={`translate(${dx + 470}, 402)`}>
          <NpcBody tunic="#a83a4a" skin="#c98a5a" walking={false} hat={<rect x="0" y="-17" width="8" height="4" rx="2" fill="#e8c15a" />} />
          <g className="qh-swing">
            <rect x="8" y="-12" width="2.5" height="12" fill="#8a5f33" />
            <rect x="6.5" y="-14" width="5.5" height="4" fill="#9aa3ad" />
          </g>
          <Bubble delay={8} shout />
        </g>
        <g transform={`translate(${dx + 540}, 330)`}>
          <NpcBody tunic="#8a6a3a" skin="#c98a5a" walking={false} hat={<rect x="0" y="-17" width="8" height="4" rx="2" fill="#e8c15a" />} />
          <g className="qh-swing">
            <rect x="8" y="-13" width="2.5" height="13" fill="#8a5f33" />
            <path d="M 6 -15 q 3 -3 7 -2 q -1 3 -4 4 Z" fill="#9aa3ad" />
          </g>
        </g>
        <g transform={`translate(${dx + 420}, 472)`}>
          <NpcBody tunic="#e8842a" skin="#c98a5a" walking={false} hat={<rect x="0" y="-17" width="8" height="4" rx="2" fill="#a83a4a" />} />
          <rect x="9" y="-6" width="2" height="6" fill="#8a5f33" transform="rotate(-32 9 -6)" shapeRendering="crispEdges" />
          <ellipse cx="16" cy="2" rx="5" ry="2.5" fill="#8a6a3a" />
          <g className="qh-surface" style={{ ["--sd" as string]: "3s" }}>
            <path d="M 16 0 q -3 -8 2 -12 q 4 -3 3 -7" stroke="#3a8a4a" strokeWidth="3" fill="none" strokeLinecap="round" />
            <circle cx="21" cy="-19" r="1.8" fill="#3a8a4a" />
          </g>
        </g>
        <g transform={`translate(${dx + 900}, 482)`}>
          <NpcBody tunic="#c9b98f" skin="#c98a5a" walking={false} hat={<g><rect x="-2" y="-16" width="12" height="3" fill="#8a6a3a" /><rect x="1" y="-19" width="6" height="3" fill="#8a6a3a" /></g>} />
          <g className="qh-swing">
            <rect x="8" y="-12" width="2" height="14" fill="#8a5f33" />
            <rect x="6.5" y="1" width="5" height="4" fill="#9aa3ad" />
          </g>
          <ellipse cx="18" cy="4" rx="6" ry="2.5" fill="#c9a25e" />
        </g>
      </>
    );
  }
  if (biome === "tundra") {
    return (
      <>
        <g transform={`translate(${dx + 600}, 348)`}>
          <g className="qh-walker" style={{ ["--px" as string]: "130px", ["--pd" as string]: "32s" }}>
            <g className="qh-stepbob">
              <NpcBody tunic="#3a6ea8" hat={<rect x="0" y="-16" width="8" height="3" fill="#f4f0e6" />} />
            </g>
          </g>
        </g>
        <g transform={`translate(${dx + 830}, 322)`}>
          <NpcBody tunic="#a83232" walking={false} hat={<rect x="1" y="-16" width="6" height="2.5" fill="#2a2438" />} />
          <rect x="12" y="1" width="9" height="4" fill="#6b4420" shapeRendering="crispEdges" />
          <g className="qh-swing">
            <rect x="8" y="-14" width="2.5" height="15" fill="#8a5f33" />
            <path d="M 7 -16 h 6 l 2 4 h -8 Z" fill="#9aa3ad" />
          </g>
        </g>
        <g transform={`translate(${dx + 380}, 420)`}>
          <g className="qh-walker" style={{ ["--px" as string]: "220px", ["--pd" as string]: "16s" }}>
            <g>
              <NpcBody tunic="#e24b8a" walking={false} hat={<rect x="0" y="-16" width="8" height="3" fill="#f4f0e6" />} />
              <rect x="-4" y="5" width="16" height="2" rx="1" fill="#5a8ac9" shapeRendering="crispEdges" />
              <line x1="-3" y1="-6" x2="-6" y2="6" stroke="#8a5f33" strokeWidth="1.5" />
              <line x1="11" y1="-6" x2="14" y2="6" stroke="#8a5f33" strokeWidth="1.5" />
            </g>
          </g>
        </g>
        <g transform={`translate(${dx + 700}, 402)`}>
          <g transform="scale(0.8)"><NpcBody tunic="#3a6ea8" walking={false} hat={<rect x="1" y="-16" width="6" height="2.5" fill="#e24b4a" />} /></g>
          <Bubble delay={2} shout />
        </g>
        <g transform={`translate(${dx + 732}, 402)`}>
          <g transform="scale(-0.8, 0.8)"><NpcBody tunic="#2fa86a" walking={false} hat={<rect x="1" y="-16" width="6" height="2.5" fill="#e8c15a" />} /></g>
          <circle cx="-14" cy="-10" r="2.5" fill="#ffffff">
            <animate attributeName="cx" values="-14;-26" dur="2.6s" repeatCount="indefinite" />
            <animate attributeName="cy" values="-10;-16;-6" keyTimes="0;.5;1" dur="2.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="1;1;0" keyTimes="0;.8;1" dur="2.6s" repeatCount="indefinite" />
          </circle>
        </g>
        <g transform={`translate(${dx + 1060}, 330)`}>
          <NpcBody tunic="#2fa86a" walking={false} hat={<g><circle cx="2" cy="-12" r="2" fill="#8ee89c" stroke="#1c5a2e" strokeWidth="0.8" /><circle cx="6.5" cy="-12" r="2" fill="#8ee89c" stroke="#1c5a2e" strokeWidth="0.8" /></g>} />
          <path d="M 10 -2 l 5 0 l 1.5 4 q -4 3 -8 0 Z" fill="#b77bff" opacity="0.9" />
          {[0, 1].map((k) => (
            <circle key={k} cx={13 + k * 2} r="1.2" fill="#b77bff" opacity="0">
              <animate attributeName="cy" values="-3;-14" dur="2.8s" begin={`${k * 1.3}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.9;0" dur="2.8s" begin={`${k * 1.3}s`} repeatCount="indefinite" />
            </circle>
          ))}
        </g>
      </>
    );
  }
  // volcano folk
  return (
    <>
      <g transform={`translate(${dx + 930}, 470)`}>
        <g className="qh-walker" style={{ ["--px" as string]: "150px", ["--pd" as string]: "30s" }}>
          <g className="qh-stepbob">
            <NpcBody tunic="#2fa86a" skin="#b8763a" hat={<rect x="0" y="-11" width="8" height="2" fill="#e24b8a" />} />
          </g>
        </g>
      </g>
      <g transform={`translate(${dx + 540}, 520)`}>
        <NpcBody tunic="#d9a04e" skin="#b8763a" walking={false} hat={<rect x="-1" y="-16" width="10" height="3" fill="#8a6a3a" />} />
        <path d="M 8 -10 q 12 -6 18 2" stroke="#5a3d20" strokeWidth="1.5" fill="none" />
        <g className="qh-bobline">
          <line x1="26" y1="-8" x2="26" y2="6" stroke="#dff2ff" strokeWidth="1" opacity="0.7" />
          <circle cx="26" cy="7" r="1.5" fill="#e24b4a" />
        </g>
      </g>
      <g transform={`translate(${dx + 880}, 442)`}>
        <NpcBody tunic="#e24b4a" skin="#b8763a" walking={false} hat={<rect x="0" y="-11" width="8" height="2" fill="#ffd76a" />} />
        <rect x="10" y="-4" width="9" height="7" rx="1" fill="#8a5a3a" shapeRendering="crispEdges" />
        <g className="qh-swing"><rect x="11" y="-10" width="1.5" height="7" fill="#f4ead0" /></g>
        <Bubble delay={5} char="♪" />
      </g>
      <g transform={`translate(${dx + 1055}, 428)`}>
        <g className="qh-walker" style={{ ["--px" as string]: "120px", ["--pd" as string]: "26s" }}>
          <g className="qh-stepbob">
            <NpcBody tunic="#d9a04e" skin="#b8763a" hat={<g><rect x="0" y="-19" width="8" height="5" rx="1" fill="#8a6a3a" /><circle cx="2" cy="-20" r="1.4" fill="#e24b4a" /><circle cx="6" cy="-20" r="1.4" fill="#ffd76a" /></g>} />
          </g>
        </g>
      </g>
      <g transform={`translate(${dx + 848}, 372)`}>
        <g>
          <NpcBody tunic="#e8842a" skin="#b8763a" walking={false} />
          <animateTransform attributeName="transform" type="translate" additive="sum" values="0 0; 0 -4; 0 0" dur="4.2s" repeatCount="indefinite" />
        </g>
        <ellipse cx="4" cy="7" rx="7" ry="2" fill="#14102a" opacity="0.3">
          <animate attributeName="rx" values="7;5;7" dur="4.2s" repeatCount="indefinite" />
        </ellipse>
      </g>
      <g transform={`translate(${dx + 985}, 458)`}>
        <g className="qh-shiprock">
          <NpcBody tunic="#2fa86a" skin="#b8763a" walking={false} hat={<rect x="0" y="-11" width="8" height="2" fill="#e24b8a" />} />
          <g fill="#3a8a4a" shapeRendering="crispEdges">
            {[0, 2, 4, 6].map((k) => <rect key={k} x={k * 2 - 1} y="0" width="1.5" height="5" />)}
          </g>
        </g>
      </g>
    </>
  );
}

function CryptidLife({ biome, dx }: { biome: Biome; dx: number }) {
  if (biome === "tundra") {
    return (
      <g transform={`translate(${dx + 56}, 296)`}>
        <g className="qh-peek">
          <ellipse cx="0" cy="0" rx="9" ry="12" fill="#eef2fa" stroke="#b8c4dd" strokeWidth="1.5" />
          <ellipse cx="1" cy="-4" rx="5" ry="4.5" fill="#8a94b8" />
          <circle cx="-0.5" cy="-5" r="1" fill="#1c1c2e" /><circle cx="3" cy="-5" r="1" fill="#1c1c2e" />
          <path d="M -8 4 q -5 2 -6 6" stroke="#eef2fa" strokeWidth="4" fill="none" strokeLinecap="round" />
        </g>
      </g>
    );
  }
  if (biome === "desert") {
    return (
      <>
        {[
          { x: 560, y: 305, sd: 0 },
          { x: 1080, y: 480, sd: 9 },
          { x: 350, y: 468, sd: 18 },
        ].map((w, wi) => (
          <g key={`wm${wi}`} transform={`translate(${dx + w.x}, ${w.y})`}>
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
                <path key={a} d="M 0 -37.5 l 2.2 4 l -4.4 0 Z" fill="#f4f0e6" transform={`rotate(${a} 0 -31)`} />
              ))}
              {[[-16, -6], [17, -10], [-20, -16]].map(([sx, sy], k) => (
                <circle key={k} cx={sx} cy={sy} r="2" fill="#e8d9a0" opacity="0.85" />
              ))}
            </g>
          </g>
        ))}
      </>
    );
  }
  if (biome === "volcano") {
    return (
      <g transform={`translate(${dx + 620}, 150)`}>
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
    );
  }
  return null; // meadow cryptids (dragon, nessie) live on anchors
}

function AnchorLife({ a, dx }: { a: Anchor; dx: number }) {
  const x = dx + a.x;
  switch (a.kind) {
    case "ripple":
      return (
        <circle cx={x} cy={a.y} fill="none" stroke="#eaf8ff" strokeWidth="2.5" opacity="0.7">
          <animate attributeName="r" values="2;16" dur="4.5s" begin={`${(a.x % 5)}s`} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.7;0" dur="4.5s" begin={`${(a.x % 5)}s`} repeatCount="indefinite" />
        </circle>
      );
    case "wave":
      return (
        <path d={`M ${x} ${a.y} q 9 -5 18 0 q 9 5 18 0`} stroke="#dff2ff" strokeWidth="2" fill="none" opacity="0.5">
          <animate attributeName="opacity" values="0.15;0.6;0.15" dur="3.4s" begin={`${(a.x % 3)}s`} repeatCount="indefinite" />
          <animateTransform attributeName="transform" type="translate" values="0 0; 14 0; 0 0" dur="6s" repeatCount="indefinite" />
        </path>
      );
    case "boat":
      return (
        <g>
          <g shapeRendering="crispEdges">
            <path d="M -16 0 h32 l-6 9 h-20 Z" fill="#6b4420" />
            <rect x="-1.5" y="-22" width="3" height="22" fill="#4a3323" />
            <path d="M 1.5 -22 q 16 6 0 14 Z" fill="#f4ead0" />
            <animateTransform attributeName="transform" type="translate" values={`${x} ${a.y}; ${x + 50} ${a.y}; ${x} ${a.y}`} dur="34s" repeatCount="indefinite" />
          </g>
        </g>
      );
    case "shark":
      return (
        <g>
          <g>
            <path d="M 0 0 q 2 -13 11 -16 q -1 9 3 16 Z" fill="#46586b" stroke="#2c3a4a" strokeWidth="1.5" />
            <path d="M -6 2 q -10 3 -20 1" stroke="#dff2ff" strokeWidth="2" fill="none" opacity="0.5" />
            <animateMotion dur="26s" repeatCount="indefinite" path={`M ${x} ${a.y} q ${(a.dist || 300) / 2} -8 ${a.dist || 300} 0 q -${(a.dist || 300) / 2} 8 -${a.dist || 300} 0`} rotate="auto" />
          </g>
        </g>
      );
    case "ship":
      return (
        <g transform={`translate(${x}, ${a.y})`}>
          <g className="qh-walker" style={{ ["--px" as string]: `${a.dist || 230}px`, ["--pd" as string]: "85s" }}>
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
      );
    case "whale":
      return (
        <g transform={`translate(${x}, ${a.y})`}>
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
      );
    case "nessie":
      return (
        <g transform={`translate(${x}, ${a.y})`}>
          <g className="qh-surface">
            <path d="M -6 0 q 2 -18 10 -20 q 8 -2 8 6" stroke="#2f7a68" strokeWidth="6" fill="none" strokeLinecap="round" />
            <ellipse cx="13" cy="-15" rx="5" ry="3.5" fill="#2f7a68" />
            <circle cx="15" cy="-16" r="1" fill="#0b2b2a" />
            <path d="M -26 2 a 8 6 0 0 1 14 0 Z M -44 3 a 7 5 0 0 1 12 0 Z" fill="#2f7a68" />
          </g>
        </g>
      );
    case "hole":
      return (
        <g transform={`translate(${x}, ${a.y})`}>
          <ellipse cx="14" cy="6" rx="7" ry="3" fill="#0e4a6a" />
          <NpcBody tunic={["#5a4a8a", "#a83a4a", "#2a6a4e"][a.x % 3]} walking={false} hat={<rect x="0" y="-16" width="8" height="3" fill={["#e8842a", "#3a6ea8", "#e8c15a"][a.x % 3]} />} />
          <path d="M 8 -10 q 8 -4 12 4" stroke="#5a3d20" strokeWidth="1.5" fill="none" />
          <g className="qh-bobline" style={{ animationDelay: `${a.x % 4}s` }}>
            <line x1="18" y1="-4" x2="18" y2="5" stroke="#dff2ff" strokeWidth="1" opacity="0.7" />
          </g>
        </g>
      );
    case "smoke":
      return (
        <>
          {Array.from({ length: 3 }).map((_, i) => (
            <circle key={i} cx={x} fill="#cfc9dd" opacity="0">
              <animate attributeName="cy" values={`${a.y};${a.y - 46}`} dur="4.2s" begin={`${i * 1.4}s`} repeatCount="indefinite" />
              <animate attributeName="r" values="2.5;8" dur="4.2s" begin={`${i * 1.4}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.55;0" dur="4.2s" begin={`${i * 1.4}s`} repeatCount="indefinite" />
            </circle>
          ))}
        </>
      );
    case "glow":
      return (
        <circle cx={x} cy={a.y} r="46" fill="#ff6b35" opacity="0.25">
          <animate attributeName="opacity" values="0.18;0.42;0.18" dur="3.2s" repeatCount="indefinite" />
          <animate attributeName="r" values="40;54;40" dur="3.2s" repeatCount="indefinite" />
        </circle>
      );
    case "perch":
      // the dragon
      return (
        <g transform={`translate(${x + 4}, ${a.y - 2})`}>
          <path d="M 12 0 q 20 3 26 12 q 3 6 -4 8" stroke="#2f9152" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M 34 22 l 7 -1 l -3 6 Z" fill="#2f9152" />
          <g className="qh-wingR">
            <path d="M 4 -6 q 8 -24 30 -24 q -8 8 -9 16 q -10 -1 -21 8 Z" fill="#1f7a42" stroke="#144d29" strokeWidth="1.5" />
            <path d="M 8 -9 q 10 -14 22 -18 M 9 -8 q 12 -8 16 -7" stroke="#144d29" strokeWidth="1" fill="none" opacity="0.7" />
          </g>
          <ellipse cx="2" cy="0" rx="13" ry="7.5" fill="#2f9152" stroke="#144d29" strokeWidth="1.5" />
          <ellipse cx="0" cy="3.5" rx="9" ry="3.5" fill="#a8d9a0" />
          <path d="M -8 -6 l 3 -4 l 3 4 l 3 -4 l 3 4 l 3 -4 l 3 4 Z" fill="#144d29" />
          <path d="M -10 -2 q -8 -8 -7 -20" stroke="#2f9152" strokeWidth="6" fill="none" strokeLinecap="round" />
          <g>
            <path d="M -24 -26 q 0 -5 6 -5 l 6 0 q 5 0 5 5 q 0 4 -5 4 l -7 0 q -5 0 -5 -4 Z" fill="#2f9152" stroke="#144d29" strokeWidth="1.3" />
            <rect x="-29" y="-27" width="6" height="4" rx="1.5" fill="#2f9152" stroke="#144d29" strokeWidth="1" />
            <path d="M -12 -31 l 2 -6 l 3 4 Z M -18 -31 l 1 -6 l 4 4 Z" fill="#e8c15a" />
            <circle cx="-19" cy="-27" r="1.4" fill="#ffd76a" />
            <circle cx="-27" cy="-24.6" r="0.7" fill="#144d29" />
          </g>
          <rect x="-7" y="6" width="4" height="4" rx="1" fill="#1f7a42" />
          <rect x="4" y="6" width="4" height="4" rx="1" fill="#1f7a42" />
          {[0, 1].map((k) => (
            <circle key={k} cx="-30" fill="#b8b2cc" opacity="0">
              <animate attributeName="cy" values="-28;-44" dur="5.5s" begin={`${k * 2.6}s`} repeatCount="indefinite" />
              <animate attributeName="r" values="1.5;4.5" dur="5.5s" begin={`${k * 2.6}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.6;0" dur="5.5s" begin={`${k * 2.6}s`} repeatCount="indefinite" />
            </circle>
          ))}
        </g>
      );
    default:
      return null;
  }
}

function TrailMap({ slots, xpReward, rendering, partner, cargo, onPick, onPickDay, onOpenBag, selectedIdx, selectedDay, destination, dayOf, duration, worldWindow, worldSet }: {
  slots: QuestSlot[]; xpReward: number; rendering: boolean;
  partner: { img: string; accent: string; name: string; srcs?: { a: string; b?: string; c?: string } } | null;
  cargo: { title: string; image: string | null }[];
  onPick: (idx: number) => void; onPickDay: (day: number) => void; onOpenBag: () => void;
  selectedIdx: number | null; selectedDay: number | null;
  destination: string; dayOf: number; duration: number;
  worldWindow: [number, number]; worldSet: string;
}) {
  const WORLDS = worldsFor(worldSet);
  const ROUTE = routeFor(WORLDS, worldWindow[0], worldWindow[1]);
  const start = routePoint(ROUTE, 0);
  const end = routePoint(ROUTE, 1);
  const RENDER_W = 3200;

  // several drops on one day fan out along the road instead of stacking
  const dayCounts = new Map<number, number>();
  for (const s of slots) dayCounts.set(s.day, (dayCounts.get(s.day) || 0) + 1);
  const dayRank = new Map<number, number>();
  const stopPts = slots.map((s) => {
    const n = dayCounts.get(s.day) || 1;
    const r = dayRank.get(s.day) || 0;
    dayRank.set(s.day, r + 1);
    const effDay = n > 1 ? s.day - 0.3 + (0.6 * (r + 0.5)) / n : s.day;
    return { slot: s, ...routePoint(ROUTE, dayT(effDay, duration)) };
  });
  const slotDays = new Set(slots.map((s) => s.day));
  const waypointDays = Array.from({ length: duration }, (_, i) => i + 1).filter((d) => !slotDays.has(d));

  const contentDone = slots.every((s) => s.status === "READY" || s.status === "POSTED");
  const here = contentDone ? end : routePoint(ROUTE, dayT(Math.min(dayOf, duration), duration));
  const nextStop = stopPts.find((p) => p.slot.status === "FORGING" || p.slot.status === "SCHEDULED" || p.slot.status === "FAILED");
  const curSpot = contentDone ? destination : rendering && nextStop ? nextStop.slot.spot : `DAY ${dayOf}`;

  const routeD = ROUTE.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ");

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
            key={`${w.src}-${k}`} href={w.src} x={k * STEP} y="0" width={MAP_W} height={MAP_H}
            mask={k > 0 ? `url(#qh-fade-${k})` : undefined}
          />
        ))}

        {/* the road */}
        <path d={routeD} fill="none" stroke="#1a1206" strokeWidth="11" opacity="0.35" strokeLinejoin="round" strokeLinecap="round" />
        <path d={routeD} fill="none" stroke="#ffd76a" strokeWidth="5" strokeDasharray="2 16" strokeLinecap="round" opacity="0.95" />

        {/* quiet-day waypoints */}
        {waypointDays.map((d) => {
          const p = routePoint(ROUTE, dayT(d, duration));
          const passed = d < dayOf;
          const today = d === dayOf;
          const sel = selectedDay === d;
          return (
            <g key={`wp${d}`} data-day={d} style={{ cursor: "pointer" }}>
              <circle cx={p.x} cy={p.y} r="20" fill="transparent" />
              {sel && <circle cx={p.x} cy={p.y} r="17" fill="none" stroke="#34E7E4" strokeWidth="3" />}
              <circle cx={p.x} cy={p.y} r={today ? 12 : 9} fill={passed || today ? "#ffd76a" : "#2b2650"} stroke={passed || today ? "#7a4c08" : "#171430"} strokeWidth="3" opacity={passed ? 0.9 : 0.85} />
              {!passed && !today && <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize="11" fontFamily="monospace" fill="#8a84b8" style={{ pointerEvents: "none" }}>+</text>}
              <text x={p.x} y={p.y + 26} textAnchor="middle" fontSize="12" fontFamily="monospace" fill="#8a84b8" opacity="0.85" stroke="#0b0918" strokeWidth="4" paintOrder="stroke" style={{ pointerEvents: "none" }}>{d}</text>
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
          // GOLD STOP: this post is pulling real shoppers — the receipt on the map
          const earning = (s.clicks || 0) > 0;
          const activeHere = !contentDone && nextStop && s.idx === nextStop.slot.idx;
          const sel = selectedIdx === s.idx;
          const fill = earning ? "#f5b83d" : done ? "#2fbf8a" : failed ? "#d24b4b" : activeHere ? "#ffd76a" : "#3a3560";
          const ring = earning ? "#7a4c08" : done ? "#0d4a33" : failed ? "#571414" : activeHere ? "#7a4c08" : "#171430";
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
              {earning && (
                <circle cx={p.x} cy={p.y} fill="none" stroke="#f5b83d" strokeWidth="3">
                  <animate attributeName="r" values="16;34" dur="2.4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.8;0" dur="2.4s" repeatCount="indefinite" />
                </circle>
              )}
              {sel && <circle cx={p.x} cy={p.y} r="24" fill="none" stroke="#34E7E4" strokeWidth="4" />}
              <circle cx={p.x} cy={p.y} r={activeHere ? 17 : 13} fill={fill} stroke={ring} strokeWidth="4" />
              <text x={p.x} y={p.y + 6} textAnchor="middle" fontSize={activeHere ? 17 : 14}>
                {earning ? "💰" : done ? "✓" : failed ? "✕" : NODE_ICON[s.type] || "•"}
              </text>
              {earning && (
                <text x={p.x + 18} y={p.y - 14} textAnchor="start" fontSize="15" fontFamily="monospace" fontWeight="bold"
                  fill="#ffe9b0" stroke="#14102a" strokeWidth="5" paintOrder="stroke">{s.clicks}</text>
              )}
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

        {/* ===== LIFE — global sky, then per-world biome bundles + anchors ===== */}
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
        {WORLDS.map((w, k) => (
          <g key={`life-${k}`}>
            <WeatherLife biome={w.biome} dx={k * STEP} />
            <CritterLife biome={w.biome} dx={k * STEP} />
            <FolkLife biome={w.biome} dx={k * STEP} pName={partner?.name || "PARTNER"} />
            <CryptidLife biome={w.biome} dx={k * STEP} />
            {w.anchors.map((a, ai) => <AnchorLife key={`a${k}-${ai}`} a={a} dx={k * STEP} />)}
          </g>
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
  const { questlines, products, tokens, tier, brandFace, castAvail, partner, feed, renderingIds, working, socials } = useLoaderData<typeof loader>();
  const socialsArmed = socials.meta || socials.tiktok;
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
  const [bag, setBag] = useState<{ id: string; title: string; image: string | null; url?: string | null }[]>([]);
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
  const selCost = questlineCostFor(sel, tier);
  const selLocked = false; // tokens are the gate now — Scale membership is a DISCOUNT, not a wall
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
  const pName = partner?.name || "OG";
  const upcoming = active
    .flatMap((q) => q.slots)
    .filter((s) => s.status === "SCHEDULED" || s.status === "FORGING")
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const nextDropLabel = upcoming.length ? `${fmtDow(upcoming[0].date)} ${fmtTime(upcoming[0].time)}` : "—";
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
    dialog = "Your token balance won't cover a quest yet — hit INSERT TOKENS in the HUD and I'll get to work the second we're funded.";
  } else {
    dialog = "No expedition running. Pick a monthly quest below — I plan the calendar, forge every piece a day early, and man every stop on the map.";
  }

  const startQuest = () => {
    submit(
      {
        intent: "accept", template: sel.key,
        bag: JSON.stringify(bagCapped.map((b) => ({ title: b.title, image: b.image, url: b.url || null }))),
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
  const bagContents = (slots: QuestSlot[]): { title: string; image: string | null; drops: number; future: number; clicks: number }[] => {
    const m = new Map<string, { title: string; image: string | null; drops: number; future: number; clicks: number }>();
    for (const s of slots) {
      if (!s.productTitle) continue;
      const swappable = s.status === "SCHEDULED" || s.status === "FAILED" ? 1 : 0;
      const cur = m.get(s.productTitle);
      if (cur) { cur.drops++; cur.future += swappable; cur.clicks += s.clicks || 0; }
      else m.set(s.productTitle, { title: s.productTitle, image: s.productImageUrl, drops: 1, future: swappable, clicks: s.clicks || 0 });
    }
    return Array.from(m.values());
  };
  const [swapSel, setSwapSel] = useState<{ qid: string; fromTitle: string } | null>(null);
  const [dropProduct, setDropProduct] = useState("");
  const [dropTopic, setDropTopic] = useState("");
  const [dropInstant, setDropInstant] = useState(false);

  return (
    <Page backAction={{ content: "Home", url: "/app" }}>
      {/* the cabinet's marquee — automation is the headline, not the fine print */}
      <div className="mm-hero" style={{ marginBottom: 16 }}>
        <span className="mm-eyebrow">▶ MARKETING CAMPAIGNS · AI AUTOPILOT</span>
        <h1><span className="mm-marquee">Marketing that runs itself.</span></h1>
        <p>
          Pick a campaign once — {pName} handles the rest. Every video and ad is created with
          your Brand Face, scheduled for the days and peak times that perform, and auto-posted
          to <b>TikTok + Meta</b>. You approve, adjust, or simply watch it work.
        </p>
        <div className="mm-hero-stats">
          <div className="mm-hero-stat"><div className="k">ACTIVE CAMPAIGNS</div><div className="v cyan">{active.length}</div></div>
          <div className="mm-hero-stat"><div className="k">DROPS THIS MONTH</div><div className="v">{active.reduce((s, q) => s + q.slots.length, 0)}</div></div>
          <div className="mm-hero-stat"><div className="k">NEXT AUTO-DROP</div><div className="v">{nextDropLabel}</div></div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <span className="qh-chip" title="The AI autopilot plans the month, forges content on schedule, and posts it">
            <span className="dot" />AI AUTOPILOT · {working ? "WORKING" : "ONLINE"}
          </span>
          <span className="qh-chip idle"><span className="dot" />🪙 {tokens.toLocaleString()}</span>
          {socialsArmed ? (
            <span className="qh-chip">📲 AUTO-POST ARMED · {[socials.tiktok && "TIKTOK", socials.meta && "META"].filter(Boolean).join(" + ")}</span>
          ) : (
            <Link to="/app/connect" className="qh-chip" style={{ borderColor: "#4d3a1d", background: "#201a0c", color: "#e8cf8c", textDecoration: "none" }}>
              ⚠ CONNECT TIKTOK + META — one click to full hands-off
            </Link>
          )}
        </div>
      </div>

      {err && (
        <Box paddingBlockEnd="300"><Banner tone="critical" title="Couldn't do that"><p>{err}</p></Banner></Box>
      )}
      {refunded > 0 && (
        <Box paddingBlockEnd="300"><Banner tone="success" title="Quest abandoned"><p>{refunded} tokens refunded for content that hadn't been forged yet. Finished content stays in your library.</p></Banner></Box>
      )}
      {actionData && "dropAdded" in actionData && (
        <Box paddingBlockEnd="300"><Banner tone="success" title="🗓 Drop scheduled"><p>{actionData.dropAdded as number} tokens charged. {pName} will forge it about a day early and it posts automatically at peak time. It's on the map.</p></Banner></Box>
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
              {(() => { const c = q.slots.reduce((n, s) => n + (s.clicks || 0), 0); return c > 0 ? ` · 💰 ${c} CLICKS` : ""; })()}
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
            worldSet={QUESTLINE_BY_KEY[q.template]?.campaign || "CLASSIC"}
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
                  <div className="spot">{NODE_ICON[s.type]} {s.spot} — DAY {s.day}{(s.clicks || 0) > 0 && <span style={{ color: "#f5b83d" }}> · 💰 {s.clicks} shopper{s.clicks === 1 ? "" : "s"} clicked through</span>}</div>
                  <div className="meta">
                    {s.status === "POSTED"
                      ? `LIVE. ${pName} posted this ${kind}${s.productTitle ? ` starring ${s.productTitle}` : ""} — ${(s.clicks || 0) > 0 ? `it's pulling shoppers to your store (${s.clicks} so far).` : "the click counter starts the moment a shopper taps its link."}`
                      : locked
                      ? `${pName} already forged this ${kind}${s.productTitle ? ` starring ${s.productTitle}` : ""} — it's waiting in your library. ✓`
                      : `${pName} forges a ${kind} here${s.productTitle ? ` starring ${s.productTitle}` : ""}${s.topic ? ` about "${s.topic}"` : ""}, ready for ${fmtDow(s.date)} at ${fmtTime(s.time)}. Change the plan below — the whole schedule obeys.`}
                  </div>
                  {s.postedUrls && Object.keys(s.postedUrls).length > 0 && (
                    <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                      {Object.entries(s.postedUrls).map(([plat, url]) => (
                        <a key={plat} className="qh-mini-btn" href={url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                          ▶ View on {plat === "facebook" ? "Facebook" : plat === "instagram" ? "Instagram" : plat === "tiktok" ? "TikTok" : plat}
                        </a>
                      ))}
                    </div>
                  )}
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
                {!passed && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 260, flex: 1 }}>
                    <div className="qh-field-label" style={{ marginBottom: 0 }}>Schedule another drop here — auto-posted to TikTok + Meta at peak time:</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <select className="qh-select" style={{ width: "auto", minWidth: 150 }} value={dropProduct} onChange={(e) => setDropProduct(e.target.value)}>
                        <option value="">Star item: auto-rotate</option>
                        {bagContents(q.slots).map((it) => <option key={it.title} value={it.title}>{it.title}</option>)}
                      </select>
                      <input
                        className="qh-input" style={{ flex: 1, minWidth: 180 }} maxLength={160}
                        placeholder="What should it be about? (optional — e.g. 'holiday gift angle')"
                        value={dropTopic} onChange={(e) => setDropTopic(e.target.value)}
                      />
                    </div>
                    <label className="qh-field-label" style={{ marginBottom: 0, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input type="checkbox" checked={dropInstant} onChange={(e) => setDropInstant(e.target.checked)} />
                      ⚡ Instant drop — forge it right now instead of waiting for the schedule
                    </label>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="qh-mini-btn" disabled={busy} onClick={() => submit({ intent: "addDrop", questlineId: q.id, day: String(d), dropType: "video", instant: dropInstant ? "1" : "", dropProduct, dropTopic }, { method: "post" })}>🎬 Video · 60🪙</button>
                      <button type="button" className="qh-mini-btn" disabled={busy} onClick={() => submit({ intent: "addDrop", questlineId: q.id, day: String(d), dropType: "image", instant: dropInstant ? "1" : "", dropProduct, dropTopic }, { method: "post" })}>🖼 Image ad · 5🪙</button>
                      <button type="button" className="qh-mini-btn" disabled={busy} onClick={() => submit({ intent: "addDrop", questlineId: q.id, day: String(d), dropType: "blog", instant: dropInstant ? "1" : "", dropProduct, dropTopic }, { method: "post" })}>📝 Blog · 10🪙</button>
                      {!today && next && (
                        <button
                          type="button" className="qh-mini-btn" disabled={busy}
                          title={`Moves the ${next.spot} drop to this day`}
                          onClick={() => submit({ intent: "reschedule", questlineId: q.id, slotIdx: String(next.idx), date, time: next.time }, { method: "post" })}
                        >
                          📦 Move next drop here
                        </button>
                      )}
                    </div>
                  </div>
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
                              <span className="nm">{it.title}{it.clicks > 0 && it.clicks === Math.max(...items.map((x) => x.clicks)) && <span style={{ color: "#f5b83d", fontWeight: 800 }}> ★ TOP PERFORMER</span>}</span>
                              <span className="ct">{it.drops} DROP{it.drops === 1 ? "" : "S"}{it.future > 0 ? ` · ${it.future} TO FORGE` : " · ALL FORGED"}{it.clicks > 0 ? ` · 💰 ${it.clicks} CLICK${it.clicks === 1 ? "" : "S"}` : ""}</span>
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
          <div className="step"><span className="n">1</span><span className="t">Pick a campaign and how hard to push</span></div>
          <div className="step"><span className="n">2</span><span className="t">Pack your products, pick your presenter</span></div>
          <div className="step"><span className="n">3</span><span className="t">{pName} journeys the map — creating and scheduling your content all month</span></div>
        </div>
        {[
          ...[...CAMPAIGNS].sort((a, b) => {
            // catalog reads cheapest → priciest (entry cost of each focus)
            const costOf = (c: typeof a) =>
              Math.min(...TIERS.map((t) => QUESTLINE_BY_KEY[`${c.key}_${t.key}`]).filter(Boolean).map((s) => questlineTokenCost(s)));
            return costOf(a) - costOf(b);
          }),
          // the DIAMOND shelf renders after the standard catalog, behind its own divider
          ...[...DIAMOND_CAMPAIGNS].sort(
            (a, b) => questlineTokenCost(QUESTLINE_BY_KEY[`${a.key}_DIAMOND`]) - questlineTokenCost(QUESTLINE_BY_KEY[`${b.key}_DIAMOND`])
          ),
        ].map((c, ci, arr) => {
          const skus = c.diamond
            ? [QUESTLINE_BY_KEY[`${c.key}_DIAMOND`]].filter(Boolean)
            : TIERS.map((t) => QUESTLINE_BY_KEY[`${c.key}_${t.key}`]).filter(Boolean);
          const firstDiamond = !!c.diamond && (ci === 0 || !arr[ci - 1].diamond);
          const activeQ = active.find((a) => QUESTLINE_BY_KEY[a.template]?.campaign === c.key || a.template.startsWith(c.key));
          const open = openKey === c.key;
          const cheapest = Math.min(...skus.map((s) => questlineTokenCost(s)));
          const world = WORLD_META[c.homeWorld];
          // banner subtitle = WHAT'S INSIDE, not where the road ends
          const rng = (type: string) => {
            const ns = skus.map((s) => s.objectives.find((o) => o.type === type)?.target || 0);
            const lo = Math.min(...ns), hi = Math.max(...ns);
            return hi === 0 ? null : lo === hi ? `${hi}` : `${lo}–${hi}`;
          };
          const inside = [
            rng("video") && `🎬 ${rng("video")} videos`,
            rng("image") && `🖼 ${rng("image")} image ads`,
            rng("blog") && `📝 ${rng("blog")} blogs`,
          ].filter(Boolean).join(" · ");
          const selSku = skus.find((s) => s.key === selKey) || skus.find((s) => canRun(s.minTier)) || skus[0];
          return (
            <Fragment key={c.key}>
            {firstDiamond && (
              <div className="qh-diamond-divider">
                <span className="dt">◆ DIAMOND AUTOPILOT</span>
                <span className="ds">Daily social presence, fully hands off — a drop lands every single day. Scale exclusive.</span>
              </div>
            )}
            <div className={`qh-quest-entry${open ? " open" : ""}`}>
              <button
                type="button"
                className={`qh-camp-banner${open ? " on" : ""}${c.diamond ? " diamond" : ""}`}
                style={{ backgroundImage: `url(${BANNER_ART[c.key] || ""})` }}
                onClick={() => { setOpenKey(open ? null : c.key); if (!open && selSku) setSelKey(selSku.key); }}
              >
                <span className="head">
                  <span className="hl"><span className="ico">{c.icon}</span>{c.headline}</span>
                  <span className="sub">{c.label} · {inside} · 📲 auto-posted all month</span>
                </span>
                <span className="side">
                  {activeQ ? <span className="run">⚑ Running · Day {activeQ.dayOf}</span> : (
                    <span className="price">from {cheapest.toLocaleString()} 🪙</span>
                  )}
                </span>
              </button>
              {open && (
                <div className="qh-qbody">
                  <p className="qh-desc">{c.desc}</p>
                  <p className="qh-lore">{c.lore}</p>

                  {/* tier picker — one legible axis: how hard to push */}
                  <div className="qh-tier-row">
                    {skus.map((sku) => {
                      const locked = false; // every tier runnable — tokens (top-ups welcome) are the gate
                      const cost = questlineCostFor(sku, tier);
                      const baseCost = questlineTokenCost(sku);
                      const scalePrice = questlineCostFor(sku, "SCALE");
                      const isScaleTier = sku.minTier === "SCALE";
                      const on = selKey === sku.key;
                      const v = sku.objectives.find((o) => o.type === "video")?.target || 0;
                      const im = sku.objectives.find((o) => o.type === "image")?.target || 0;
                      const b = sku.objectives.find((o) => o.type === "blog")?.target || 0;
                      const tierMeta = TIERS.find((t) => t.key === sku.tier)!;
                      return (
                        <button
                          key={sku.key} type="button"
                          className={`qh-tier${on ? " on" : ""}${locked ? " locked" : ""} t-${sku.tier.toLowerCase()}`}
                          onClick={() => setSelKey(sku.key)}
                        >
                          <span className="tname">{sku.tier}</span>
                          {sku.tier === "SILVER" && !locked && <span className="tpop">★ Most popular</span>}
                          {sku.tier === "DIAMOND" && <span className="tpop tdaily">◆ DAILY DROPS</span>}
                          <span className="tblurb">{tierMeta?.blurb || "The daily engine"}</span>
                          <span className="trec">
                            {v > 0 && <span>🎬 {v} videos</span>}
                            {im > 0 && <span>🖼 {im} image ads</span>}
                            {b > 0 && <span>📝 {b} blog posts</span>}
                          </span>
                          {(() => {
                            const mt = meterSegs(sku);
                            return (
                              <span className="qh-meters">
                                <Meter label="PACE" val={mt.pace} color="#7ff5f2" hint={`~${mt.perWeek.toFixed(1)} posts a week, auto-scheduled`} />
                                <Meter label="VIDEO" val={mt.video} color="#ffd76a" hint={`${v} UGC videos this month`} />
                                <Meter label="ADS" val={mt.ads} color="#ff7ac8" hint={`${im} image ads this month`} />
                                <Meter label="SEO" val={mt.seo} color="#8ee89c" hint={`${b} blog posts this month`} />
                              </span>
                            );
                          })()}
                          <span className="tjourney">📲 auto-posted to TikTok + Meta</span>
                          <span className="tjourney" style={{ color: "#9a94c2" }}>🗓 {sku.cadence}</span>
                          <span className="tcost">
                            {cost.toLocaleString()}🪙 · +{sku.xpReward.toLocaleString()} XP{sku.recurring ? " · renews monthly" : ""}
                            {isScaleTier && (cost < baseCost
                              ? <em className="tsave"> ◆ Scale price — you save {(baseCost - cost).toLocaleString()}🪙</em>
                              : <em className="tsave"> ◆ Scale members pay {scalePrice.toLocaleString()}🪙</em>)}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {activeQ ? (
                    <div className="qh-hint" style={{ textAlign: "left" }}>⚑ This campaign is already running — day {activeQ.dayOf} of {activeQ.duration}. Follow it on the board above.</div>
                  ) : selSku ? (
                    <>
                      <div className="qh-auto">
                        <div className="qh-auto-title">⚡ Fully automated after launch</div>
                        <div className="qh-auto-grid">
                          <span>🎬 Creates every video & image ad — starring your Brand Face</span>
                          <span>🗓 Picks posting days & peak times for you ({selSku.cadence})</span>
                          <span>{socialsArmed ? "📲 Auto-posts to TikTok + Meta — armed and hands off" : "📲 Auto-posts to TikTok + Meta — connect your accounts once (Ad Accounts tab) to arm it"}</span>
                          <span>🎛 You stay in control: review anything, move any drop on the map</span>
                        </div>
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
                          bagCapped.length >= selSku.bagSize ? `Fully loaded (${selSku.bagSize} items)! Want more products in the rotation? ${selSku.tier === "GOLD" ? "GOLD carries the biggest bag — upgrade your package for more monthly firepower." : selSku.tier === "SILVER" ? "GOLD carries 10 pouches." : "SILVER carries 6 pouches, GOLD carries 10."}` :
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
                        disabled={busy || bagCapped.length === 0 || tokens < questlineCostFor(selSku, tier) || !starId}
                        onClick={startQuest}
                      >
                        {busy ? "SIGNING THE CONTRACT…" : `▶ START ${c.headline} · ${selSku.tier} — ${questlineCostFor(selSku, tier).toLocaleString()} 🪙`}
                      </button>
                      <div className="qh-hint">
                        {bagCapped.length === 0 ? `Pack the bag first — ${pName} won't march empty-handed.` :
                          tokens < questlineCostFor(selSku, tier) ? `This tier costs ${questlineCostFor(selSku, tier).toLocaleString()} tokens — you carry ${tokens.toLocaleString()}. INSERT TOKENS in the HUD to top up.` :
                          "Tokens cover the month's content. Abandon anytime — unforged pieces are refunded. Ad spend always stays on your own connected accounts."}
                      </div>
                    </>
                  ) : (
                    <div className="qh-hint" style={{ textAlign: "left" }}>Pick a tier above to gear up.</div>
                  )}
                </div>
              )}
            </div>
            </Fragment>
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
