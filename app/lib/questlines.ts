/* Questline templates — client-safe (no server imports) so the route can render
 * the quest gallery + cost/reward chips. Every questline is a MONTHLY segment
 * (30-day expedition); what varies per quest is the content mix and posting
 * frequency. Token cost derives from TOKEN_COST so it always matches real
 * economics. Autopilot posting is gated by plan tier. */

import { TOKEN_COST } from "./plan-config";

export type ObjectiveType = "video" | "image" | "blog" | "post";

export type QuestObjectiveDef = {
  type: ObjectiveType;
  label: string;
  target: number;
};

export type QuestlineDef = {
  key: string;
  name: string; // game name
  icon: string;
  tagline: string;
  objectives: QuestObjectiveDef[];
  platforms: string[]; // where content auto-posts (when connected)
  recurring: boolean; // renews monthly vs one-and-done segment
  minTier: "GROWTH" | "PRO" | "SCALE"; // plan gate
  xpReward: number;
  bagSize: number; // backpack capacity — generous; more items = richer calendar
  cadence: string; // human-readable posting rhythm, shown in the briefing
};

export const QUEST_DURATION_DAYS = 30; // every questline is a monthly segment

/* Token cost of the content in a questline (posting itself is free —
 * merchant funds ad spend on their own connected account). */
export function questlineTokenCost(q: QuestlineDef): number {
  return q.objectives.reduce((sum, o) => {
    const per =
      o.type === "video" ? TOKEN_COST.video :
      o.type === "image" ? TOKEN_COST.image :
      o.type === "blog" ? TOKEN_COST.blog : 0; // "post" is free
    return sum + per * o.target;
  }, 0);
}

export const QUESTLINES: QuestlineDef[] = [
  {
    key: "FIRST_BLOOD",
    name: "First Blood",
    icon: "🩸",
    tagline: "Your opening month — a light, steady introduction to the battlefield.",
    objectives: [
      { type: "image", label: "Scroll-stopping image ads", target: 2 },
      { type: "video", label: "UGC videos with your Brand Face", target: 2 },
      { type: "post", label: "Scheduled drops to TikTok", target: 4 },
    ],
    platforms: ["TIKTOK"],
    recurring: false,
    minTier: "GROWTH",
    xpReward: 400,
    bagSize: 3,
    cadence: "~1 drop a week · videos in the evening slot",
  },
  {
    key: "STEADY_GRIND",
    name: "The Steady Grind",
    icon: "⚙️",
    tagline: "Always-on presence — a content drop every few days, all month long.",
    objectives: [
      { type: "image", label: "Image ads", target: 2 },
      { type: "video", label: "UGC videos", target: 6 },
      { type: "post", label: "Scheduled drops to TikTok + Meta", target: 8 },
    ],
    platforms: ["TIKTOK", "META"],
    recurring: true,
    minTier: "PRO",
    xpReward: 1200,
    bagSize: 5,
    cadence: "~2 drops a week · Tue/Thu/Sat evening videos",
  },
  {
    key: "LAUNCH_BLITZ",
    name: "Launch Blitz",
    icon: "🚀",
    tagline: "A loud month for a big drop — front-loaded hype, then a steady echo.",
    objectives: [
      { type: "video", label: "UGC hype videos", target: 8 },
      { type: "image", label: "Announcement image ads", target: 3 },
      { type: "post", label: "Blitz drops across TikTok + Meta", target: 11 },
    ],
    platforms: ["TIKTOK", "META"],
    recurring: false,
    minTier: "PRO",
    xpReward: 1800,
    bagSize: 6,
    cadence: "~3 drops a week · heavier in weeks 1–2",
  },
  {
    key: "OMNICHANNEL",
    name: "Omnichannel Onslaught",
    icon: "🌐",
    tagline: "Everything, everywhere, all month — blogs, ads, and videos on every channel.",
    objectives: [
      { type: "blog", label: "SEO blog posts", target: 3 },
      { type: "image", label: "Image ads", target: 4 },
      { type: "video", label: "UGC videos", target: 8 },
      { type: "post", label: "Scheduled drops everywhere", target: 15 },
    ],
    platforms: ["TIKTOK", "META"],
    recurring: true,
    minTier: "SCALE",
    xpReward: 2600,
    bagSize: 10,
    cadence: "~4 drops a week · videos evenings, blogs Monday mornings",
  },
];

export const QUESTLINE_BY_KEY: Record<string, QuestlineDef> = Object.fromEntries(
  QUESTLINES.map((q) => [q.key, q])
);

/* Each quest journeys from YOUR SHOP to a destination that pays off its story
 * (the reward chest opens on arrival — no bank vaults out here). */
export const DESTINATION_BY_KEY: Record<string, string> = {
  FIRST_BLOOD: "FIRST VICTORY HILL",
  STEADY_GRIND: "THE GRAND BAZAAR",
  LAUNCH_BLITZ: "THE LAUNCH BEACON",
  OMNICHANNEL: "THE SIGNAL CITADEL",
};

/* ---- Map destinations ----
 * Every stop on the board is a named place, Candy Land style. Pools per
 * content type; assignment cycles deterministically so a quest's board is
 * stable across reloads. */
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
  day: number; // 1-based day within the segment
  date: string; // ISO date
  time: string; // "19:00"
  type: ObjectiveType;
  spot: string; // named destination
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
