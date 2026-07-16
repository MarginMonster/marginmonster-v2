/* Marketing Campaigns — the catalog is 4 marketing FOCUSES (plain-words
 * headlines) x 3 tiers (BRONZE/SILVER/GOLD = intensity AND journey length:
 * 1 world / 2 worlds / the full four-world panorama). Marketing-first labels,
 * game-flavored presentation. Every campaign is a monthly segment.
 * Client-safe: no server imports. */

import { TOKEN_COST } from "./plan-config";

export type ObjectiveType = "video" | "image" | "blog" | "post";
export type TierKey = "BRONZE" | "SILVER" | "GOLD" | "DIAMOND";

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
  diamond?: true; // premium daily-autopilot shelf (single DIAMOND SKU)
};

export const CAMPAIGNS: CampaignDef[] = [
  {
    key: "GET_SEEN", headline: "CENTER STAGE", label: "Brand Awareness", icon: "🎪", homeWorld: 0,
    desc: "Video-heavy social presence — your Brand Face in front of new eyes, week after week.",
    lore: "Your companion takes the brand on tour: fresh faces, fresh takes, and your name echoing through every square along the road.",
    recurring: true,
  },
  {
    key: "LAUNCH_IT", headline: "LIGHT THE BEACON", label: "Product Launch", icon: "🚀", homeWorld: 3,
    desc: "A loud month for a big drop — front-loaded hype videos, then a rolling echo.",
    lore: "Light the beacon. A heavy first-week barrage announces the drop, and the echo keeps it burning all month.",
    recurring: false,
  },
  {
    key: "STAY_STEADY", headline: "FOUR SEASONS", label: "Always-On Growth", icon: "⚙️", homeWorld: 2,
    desc: "The consistent monthly drumbeat — content posted at peak times while you do anything else.",
    lore: "Empires are built every few days, for a month straight. The road is long, the pace is calm, the fire never goes out.",
    recurring: true,
  },
  {
    key: "OWN_THE_SEARCH", headline: "TREASURE HUNT", label: "SEO & Discovery", icon: "🗺️", homeWorld: 1,
    desc: "Blogs and image ads that compound in Google — traffic that keeps arriving after the month ends.",
    lore: "Real treasure is buried in the search results. Your companion digs where the maps say X: keywords, articles, and ads that pay out for seasons.",
    recurring: false,
  },
];
/* Where each campaign's month-long road ends (its set's finale world). */
export const CAMPAIGN_DEST: Record<string, string> = {
  GET_SEEN: 'THE GRAND BAZAAR',
  LAUNCH_IT: 'THE LAUNCH BEACON',
  STAY_STEADY: 'THE EVERGREEN HOLD',
  OWN_THE_SEARCH: 'THE GOLDEN OASIS',
};

/* CAMPAIGN_BY_KEY is defined below the DIAMOND shelf (declaration order). */

/* Tier = intensity + journey length + package gate. One legible axis. */
export const TIERS: { key: TierKey; worlds: number; minTier: "GROWTH" | "PRO" | "SCALE"; bagSize: number; blurb: string }[] = [
  { key: "BRONZE", worlds: 1, minTier: "GROWTH", bagSize: 3, blurb: "A light month, gently paced" },
  { key: "SILVER", worlds: 2, minTier: "PRO", bagSize: 6, blurb: "The standard month" },
  { key: "GOLD", worlds: 4, minTier: "SCALE", bagSize: 10, blurb: "Full assault" },
];

/* Content mixes per campaign x tier (v=video, i=image, b=blog). */
const MIX: Record<string, Record<"BRONZE" | "SILVER" | "GOLD", { v: number; i: number; b: number; xp: number; cadence: string }>> = {
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

/* ---- DIAMOND AUTOPILOT — the segregated premium shelf ----
 * Dedicated daily questlines (not a 4th tier): every line posts to socials
 * EVERY day of the month, hands off. Titles name what each one is rich in;
 * all Scale-gated, all with their own map flavor. */
export const DIAMOND_CAMPAIGNS: CampaignDef[] = [
  {
    key: "DAILY_FEED", headline: "THE DAILY FEED", label: "Daily Social Autopilot", icon: "📆", homeWorld: 0,
    desc: "One polished post every single day — video, ad, or article — your feed never goes quiet.",
    lore: "Thirty days, thirty drops. The algorithm learns your name.",
    recurring: true, diamond: true,
  },
  {
    key: "VIDEO_STORM", headline: "VIDEO STORM", label: "Video-First Autopilot", icon: "🎬", homeWorld: 3,
    desc: "Rich in video — your Brand Face posting reels daily, with fresh ads between.",
    lore: "A storm doesn't ask permission for the feed. It takes it.",
    recurring: true, diamond: true,
  },
  {
    key: "AD_BLITZ", headline: "AD BLITZ", label: "Creative-Volume Autopilot", icon: "🖼", homeWorld: 1,
    desc: "Rich in ad creative — a fresh scroll-stopper every day to feed the algorithm variety.",
    lore: "Volume finds winners. The blitz never repeats itself.",
    recurring: true, diamond: true,
  },
  {
    key: "OMNIPRESENCE", headline: "OMNIPRESENCE", label: "Everywhere Autopilot", icon: "👑", homeWorld: 2,
    desc: "Rich in everything — videos, ads AND articles with double-drop days. Total feed domination.",
    lore: "Some brands post. Yours is simply always there.",
    recurring: true, diamond: true,
  },
];

const DIAMOND_MIX: Record<string, { v: number; i: number; b: number; xp: number; cadence: string }> = {
  DAILY_FEED: { v: 14, i: 14, b: 2, xp: 4200, cadence: "1 drop every day · posted at peak times" },
  VIDEO_STORM: { v: 22, i: 8, b: 0, xp: 5500, cadence: "video daily · reels & TikTok prime slots" },
  AD_BLITZ: { v: 6, i: 26, b: 0, xp: 3400, cadence: "a fresh ad every day · relentless variety" },
  OMNIPRESENCE: { v: 22, i: 16, b: 6, xp: 6500, cadence: "double-drop days · everywhere at once" },
};

export const DIAMOND_DEST: Record<string, string> = {
  DAILY_FEED: "THE ENDLESS SCROLL",
  VIDEO_STORM: "THE STORM'S EYE",
  AD_BLITZ: "THE THOUSAND BANNERS",
  OMNIPRESENCE: "THE EVERYWHERE THRONE",
};

export const CAMPAIGN_BY_KEY: Record<string, CampaignDef> = Object.fromEntries(
  [...CAMPAIGNS, ...DIAMOND_CAMPAIGNS].map((c) => [c.key, c])
);

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


function buildSku(c: CampaignDef, t: (typeof TIERS)[number]): QuestlineDef {
  const m = MIX[c.key][t.key as "BRONZE" | "SILVER" | "GOLD"]; // standard shelf only — diamonds build in DIAMOND_LINES
  const objectives: QuestObjectiveDef[] = [];
  if (m.v) objectives.push({ type: "video", label: "UGC videos with your Brand Face", target: m.v });
  if (m.i) objectives.push({ type: "image", label: "Scroll-stopping image ads", target: m.i });
  if (m.b) objectives.push({ type: "blog", label: "SEO blog posts", target: m.b });
  objectives.push({ type: "post", label: "Scheduled drops at peak times", target: m.v + m.i + m.b });
  const win: [number, number] = [0, 3]; // the route spans the campaign's whole panorama
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
    destination: CAMPAIGN_DEST[c.key],
  };
}

/* Diamond shelf SKUs — one DIAMOND line per premium campaign. */
export const DIAMOND_LINES: QuestlineDef[] = DIAMOND_CAMPAIGNS.map((c) => {
  const m = DIAMOND_MIX[c.key];
  const objectives: QuestObjectiveDef[] = [];
  if (m.v) objectives.push({ type: "video", label: "UGC videos with your Brand Face", target: m.v });
  if (m.i) objectives.push({ type: "image", label: "Scroll-stopping image ads", target: m.i });
  if (m.b) objectives.push({ type: "blog", label: "SEO blog posts", target: m.b });
  objectives.push({ type: "post", label: "Auto-posted — one drop (or more) every day", target: m.v + m.i + m.b });
  return {
    key: `${c.key}_DIAMOND`,
    campaign: c.key,
    tier: "DIAMOND" as TierKey,
    name: `${c.headline} · DIAMOND`,
    icon: c.icon,
    tagline: c.desc,
    lore: c.lore,
    objectives,
    platforms: ["TIKTOK", "META"],
    recurring: c.recurring,
    minTier: "SCALE" as const,
    xpReward: m.xp,
    bagSize: 14,
    cadence: m.cadence,
    worldWindow: [0, 3] as [number, number],
    destination: DIAMOND_DEST[c.key],
  };
});

export const QUESTLINES: QuestlineDef[] = [
  ...CAMPAIGNS.flatMap((c) => TIERS.map((t) => buildSku(c, t))),
  ...DIAMOND_LINES,
];

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
  topic?: string; // merchant-directed subject for this drop
  assetId?: string; // the forged Asset — the media the auto-poster publishes
};

export type QuestSchedule = { slots: QuestSlot[]; weeksAwarded: number[] };

export function parseSchedule(json: string | null | undefined): QuestSchedule {
  try {
    const s = JSON.parse(json || "{}");
    if (Array.isArray(s?.slots)) return { slots: s.slots, weeksAwarded: s.weeksAwarded || [] };
  } catch { /* fall through */ }
  return { slots: [], weeksAwarded: [] };
}
