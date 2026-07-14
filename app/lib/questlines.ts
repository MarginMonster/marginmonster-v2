/* Marketing Campaigns — the catalog is 4 marketing FOCUSES (plain-words
 * headlines) x 3 tiers (BRONZE/SILVER/GOLD = intensity AND journey length:
 * 1 world / 2 worlds / the full four-world panorama). Marketing-first labels,
 * game-flavored presentation. Every campaign is a monthly segment.
 * Client-safe: no server imports. */

import { TOKEN_COST } from "./plan-config";

export type ObjectiveType = "video" | "image" | "blog" | "post";
export type TierKey = "BRONZE" | "SILVER" | "GOLD";

export type QuestObjectiveDef = { type: ObjectiveType; label: string; target: number };

export const QUEST_DURATION_DAYS = 30; // every campaign is a monthly segment

/* The worlds, in panorama order (must match TrailMap's WORLDS). Each ends at
 * a landmark that serves as a journey destination. */
export const WORLD_META = [
  { name: "Blossom Meadows", icon: "🌸", destination: "THE GRAND BAZAAR" },
  { name: "Red Rock Canyon", icon: "🏜️", destination: "THE GOLDEN OASIS" },
  { name: "Frostpine Tundra", icon: "❄️", destination: "THE EVERGREEN HOLD" },
  { name: "Ember Isles", icon: "🌋", destination: "THE LAUNCH BEACON" },
];

export type CampaignDef = {
  key: string;
  headline: string; // punchy imperative — the thing the merchant wants
  label: string; // the marketing term, as subtitle
  icon: string;
  homeWorld: number; // index into WORLD_META — the campaign's own map
  desc: string; // one plain sentence: what this campaign does
  lore: string; // the flavor, one notch below the facts
  recurring: boolean;
};

export const CAMPAIGNS: CampaignDef[] = [
  {
    key: "GET_SEEN", headline: "GET SEEN", label: "Brand Awareness", icon: "📣", homeWorld: 0,
    desc: "Video-heavy social presence — your Brand Face in front of new eyes, week after week.",
    lore: "Your companion takes the brand on tour: fresh faces, fresh takes, and your name echoing through every square along the road.",
    recurring: true,
  },
  {
    key: "LAUNCH_IT", headline: "LAUNCH IT", label: "Product Launch", icon: "🚀", homeWorld: 3,
    desc: "A loud month for a big drop — front-loaded hype videos, then a rolling echo.",
    lore: "Light the beacon. A heavy first-week barrage announces the drop, and the echo keeps it burning all month.",
    recurring: false,
  },
  {
    key: "STAY_STEADY", headline: "STAY STEADY", label: "Always-On Growth", icon: "⚙️", homeWorld: 2,
    desc: "The consistent monthly drumbeat — content posted at peak times while you do anything else.",
    lore: "Empires are built every few days, for a month straight. The road is long, the pace is calm, the fire never goes out.",
    recurring: true,
  },
  {
    key: "OWN_THE_SEARCH", headline: "OWN THE SEARCH", label: "SEO & Discovery", icon: "🔎", homeWorld: 1,
    desc: "Blogs and image ads that compound in Google — traffic that keeps arriving after the month ends.",
    lore: "Real treasure is buried in the search results. Your companion digs where the maps say X: keywords, articles, and ads that pay out for seasons.",
    recurring: false,
  },
];
export const CAMPAIGN_BY_KEY: Record<string, CampaignDef> = Object.fromEntries(CAMPAIGNS.map((c) => [c.key, c]));

/* Tier = intensity + journey length + package gate. One legible axis. */
export const TIERS: { key: TierKey; worlds: number; minTier: "GROWTH" | "PRO" | "SCALE"; bagSize: number; blurb: string }[] = [
  { key: "BRONZE", worlds: 1, minTier: "GROWTH", bagSize: 3, blurb: "A light month — one world" },
  { key: "SILVER", worlds: 2, minTier: "PRO", bagSize: 6, blurb: "The standard month — two worlds" },
  { key: "GOLD", worlds: 4, minTier: "SCALE", bagSize: 10, blurb: "Full assault — the whole panorama" },
];

/* Content mixes per campaign x tier (v=video, i=image, b=blog). */
const MIX: Record<string, Record<TierKey, { v: number; i: number; b: number; xp: number; cadence: string }>> = {
  GET_SEEN: {
    BRONZE: { v: 2, i: 2, b: 0, xp: 400, cadence: "~1 drop a week · evening video slots" },
    SILVER: { v: 6, i: 2, b: 0, xp: 1200, cadence: "~2 drops a week · Tue/Thu/Sat evenings" },
    GOLD: { v: 12, i: 4, b: 0, xp: 2400, cadence: "~4 drops a week · your face everywhere" },
  },
  LAUNCH_IT: {
    BRONZE: { v: 3, i: 3, b: 0, xp: 500, cadence: "~1–2 drops a week · heavier at the start" },
    SILVER: { v: 8, i: 3, b: 0, xp: 1800, cadence: "~3 drops a week · weeks 1–2 hit hardest" },
    GOLD: { v: 14, i: 6, b: 0, xp: 3000, cadence: "~5 drops a week · a launch nobody misses" },
  },
  STAY_STEADY: {
    BRONZE: { v: 2, i: 4, b: 0, xp: 450, cadence: "~1–2 drops a week · steady and calm" },
    SILVER: { v: 6, i: 4, b: 1, xp: 1300, cadence: "~2–3 drops a week · the reliable drumbeat" },
    GOLD: { v: 10, i: 6, b: 2, xp: 2200, cadence: "~4 drops a week · always-on, everywhere" },
  },
  OWN_THE_SEARCH: {
    BRONZE: { v: 1, i: 4, b: 2, xp: 350, cadence: "~1–2 drops a week · blogs Monday mornings" },
    SILVER: { v: 3, i: 6, b: 4, xp: 900, cadence: "~2–3 drops a week · compounding steadily" },
    GOLD: { v: 6, i: 8, b: 6, xp: 1600, cadence: "~4 drops a week · own the results page" },
  },
};

export type QuestlineDef = {
  key: string; // "GET_SEEN_SILVER"
  campaign: string;
  tier: TierKey;
  name: string; // display: "GET SEEN · SILVER"
  icon: string;
  tagline: string;
  lore: string;
  objectives: QuestObjectiveDef[];
  platforms: string[];
  recurring: boolean;
  minTier: "GROWTH" | "PRO" | "SCALE";
  xpReward: number;
  bagSize: number;
  cadence: string;
  worldWindow: [number, number]; // panorama worlds this journey crosses
  destination: string;
};

/** Journey window: ends where it can showcase the home world; GOLD is always
 *  the full panorama. */
function windowFor(home: number, worlds: number): [number, number] {
  if (worlds >= 4) return [0, 3];
  const start = Math.max(0, Math.min(home - worlds + 1, 4 - worlds));
  return [start, start + worlds - 1];
}

function buildSku(c: CampaignDef, t: (typeof TIERS)[number]): QuestlineDef {
  const m = MIX[c.key][t.key];
  const objectives: QuestObjectiveDef[] = [];
  if (m.v) objectives.push({ type: "video", label: "UGC videos with your Brand Face", target: m.v });
  if (m.i) objectives.push({ type: "image", label: "Scroll-stopping image ads", target: m.i });
  if (m.b) objectives.push({ type: "blog", label: "SEO blog posts", target: m.b });
  objectives.push({ type: "post", label: "Scheduled drops at peak times", target: m.v + m.i + m.b });
  const win = windowFor(c.homeWorld, t.worlds);
  return {
    key: `${c.key}_${t.key}`,
    campaign: c.key,
    tier: t.key,
    name: `${c.headline} · ${t.key}`,
    icon: c.icon,
    tagline: c.desc,
    lore: c.lore,
    objectives,
    platforms: ["TIKTOK", "META"],
    recurring: c.recurring,
    minTier: t.minTier,
    xpReward: m.xp,
    bagSize: t.bagSize,
    cadence: m.cadence,
    worldWindow: win,
    destination: WORLD_META[win[1]].destination,
  };
}

export const QUESTLINES: QuestlineDef[] = CAMPAIGNS.flatMap((c) => TIERS.map((t) => buildSku(c, t)));

/* Legacy questlines (pre-catalog) — kept so active expeditions and their
 * journals keep resolving. Not shown in the new catalog. */
const LEGACY: QuestlineDef[] = [
  { key: "FIRST_BLOOD", campaign: "GET_SEEN", tier: "BRONZE", name: "First Blood", icon: "🩸", tagline: "Opening month.", lore: "Every legend starts with a first swing.", objectives: [{ type: "image", label: "Image ads", target: 2 }, { type: "video", label: "UGC videos", target: 2 }, { type: "post", label: "Drops", target: 4 }], platforms: ["TIKTOK"], recurring: false, minTier: "GROWTH", xpReward: 400, bagSize: 3, cadence: "~1 drop a week", worldWindow: [0, 3], destination: "FIRST VICTORY HILL" },
  { key: "STEADY_GRIND", campaign: "STAY_STEADY", tier: "SILVER", name: "The Steady Grind", icon: "⚙️", tagline: "Always-on.", lore: "Built every few days, for a month straight.", objectives: [{ type: "image", label: "Image ads", target: 2 }, { type: "video", label: "UGC videos", target: 6 }, { type: "post", label: "Drops", target: 8 }], platforms: ["TIKTOK", "META"], recurring: true, minTier: "PRO", xpReward: 1200, bagSize: 5, cadence: "~2 drops a week", worldWindow: [0, 3], destination: "THE GRAND BAZAAR" },
  { key: "LAUNCH_BLITZ", campaign: "LAUNCH_IT", tier: "SILVER", name: "Launch Blitz", icon: "🚀", tagline: "Loud month.", lore: "The whole realm should hear about it.", objectives: [{ type: "video", label: "UGC hype videos", target: 8 }, { type: "image", label: "Image ads", target: 3 }, { type: "post", label: "Drops", target: 11 }], platforms: ["TIKTOK", "META"], recurring: false, minTier: "PRO", xpReward: 1800, bagSize: 6, cadence: "~3 drops a week", worldWindow: [0, 3], destination: "THE LAUNCH BEACON" },
  { key: "OMNICHANNEL", campaign: "OWN_THE_SEARCH", tier: "GOLD", name: "Omnichannel Onslaught", icon: "🌐", tagline: "Everything everywhere.", lore: "The full war machine.", objectives: [{ type: "blog", label: "SEO blog posts", target: 3 }, { type: "image", label: "Image ads", target: 4 }, { type: "video", label: "UGC videos", target: 8 }, { type: "post", label: "Drops", target: 15 }], platforms: ["TIKTOK", "META"], recurring: true, minTier: "SCALE", xpReward: 2600, bagSize: 10, cadence: "~4 drops a week", worldWindow: [0, 3], destination: "THE SIGNAL CITADEL" },
];

export const QUESTLINE_BY_KEY: Record<string, QuestlineDef> = Object.fromEntries(
  [...QUESTLINES, ...LEGACY].map((q) => [q.key, q])
);

/* Back-compat destination lookup (route code uses this). */
export const DESTINATION_BY_KEY: Record<string, string> = Object.fromEntries(
  [...QUESTLINES, ...LEGACY].map((q) => [q.key, q.destination])
);

/* Token cost of a campaign month (posting itself is free — merchants fund ad
 * spend on their own connected accounts). */
export function questlineTokenCost(q: QuestlineDef): number {
  return q.objectives.reduce((sum, o) => {
    const per =
      o.type === "video" ? TOKEN_COST.video :
      o.type === "image" ? TOKEN_COST.image :
      o.type === "blog" ? TOKEN_COST.blog : 0;
    return sum + per * o.target;
  }, 0);
}

/* ---- Map destinations ----
 * Every stop on the board is a named place. Pools per content type;
 * assignment cycles deterministically so a board is stable across reloads. */
export const SPOTS: Record<ObjectiveType | "start" | "chest", string[]> = {
  start: ["BASE CAMP"],
  video: ["VIRAL FALLS", "HOOK RIDGE", "ECHO CANYON", "TREND SUMMIT", "LOOP LAGOON", "CLIP CLIFFS", "REEL REEF", "FYP PEAK"],
  image: ["PIXEL PLAINS", "GLIMMER GROVE", "SNAPSHOT SHORES", "BANNER BLUFFS", "SCROLLSTOP SPRINGS"],
  blog: ["INKWOOD FOREST", "SCROLL TEMPLE", "KEYWORD KEEP"],
  post: ["MERCHANT'S CROSSING", "SIGNAL TOWER", "BROADCAST BAY"],
  chest: ["THE VAULT"],
};

export function spotName(type: ObjectiveType, n: number): string {
  const pool = SPOTS[type] || SPOTS.post;
  return pool[n % pool.length];
}

export type QuestSlot = {
  idx: number;
  day: number;
  date: string;
  time: string;
  type: ObjectiveType;
  spot: string;
  productTitle: string;
  productImageUrl: string | null;
  status: "SCHEDULED" | "FORGING" | "READY" | "POSTED" | "FAILED";
};

export type QuestSchedule = { slots: QuestSlot[]; weeksAwarded: number[] };

export function parseSchedule(json: string | null | undefined): QuestSchedule {
  try {
    const s = JSON.parse(json || "{}");
    if (Array.isArray(s?.slots)) return { slots: s.slots, weeksAwarded: s.weeksAwarded || [] };
  } catch { /* fall through */ }
  return { slots: [], weeksAwarded: [] };
}
