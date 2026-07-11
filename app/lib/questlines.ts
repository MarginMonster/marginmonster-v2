/* Questline templates — client-safe (no server imports) so the route can render
 * the quest gallery + cost/reward chips. Each questline is a themed automated
 * content mission; token cost is derived from TOKEN_COST so it always matches
 * real economics. Autopilot posting is gated to plans with campaignAutopilot. */

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
  recurring: boolean; // monthly vs one-shot
  minTier: "GROWTH" | "PRO" | "SCALE"; // plan gate
  xpReward: number;
};

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
    tagline: "Your opening strike — a starter pack of ads to get on the board.",
    objectives: [
      { type: "image", label: "Scroll-stopping image ads", target: 2 },
      { type: "video", label: "UGC videos with your Brand Face", target: 2 },
      { type: "post", label: "Auto-post to TikTok", target: 4 },
    ],
    platforms: ["TIKTOK"],
    recurring: false,
    minTier: "GROWTH",
    xpReward: 400,
  },
  {
    key: "STEADY_GRIND",
    name: "The Steady Grind",
    icon: "⚙️",
    tagline: "Always-on presence — a fresh drip of content posted every month.",
    objectives: [
      { type: "image", label: "Image ads", target: 2 },
      { type: "video", label: "UGC videos", target: 6 },
      { type: "post", label: "Auto-post to TikTok + Meta", target: 8 },
    ],
    platforms: ["TIKTOK", "META"],
    recurring: true,
    minTier: "PRO",
    xpReward: 1200,
  },
  {
    key: "LAUNCH_BLITZ",
    name: "Launch Blitz",
    icon: "🚀",
    tagline: "Go loud for a drop — a burst of videos in one week.",
    objectives: [
      { type: "video", label: "UGC hype videos", target: 8 },
      { type: "image", label: "Announcement image ads", target: 3 },
      { type: "post", label: "Blast across TikTok + Meta", target: 11 },
    ],
    platforms: ["TIKTOK", "META"],
    recurring: false,
    minTier: "PRO",
    xpReward: 1800,
  },
  {
    key: "OMNICHANNEL",
    name: "Omnichannel Onslaught",
    icon: "🌐",
    tagline: "Everything, everywhere — blogs, ads, and videos across every channel.",
    objectives: [
      { type: "blog", label: "SEO blog posts", target: 3 },
      { type: "image", label: "Image ads", target: 4 },
      { type: "video", label: "UGC videos", target: 8 },
      { type: "post", label: "Auto-post everywhere", target: 15 },
    ],
    platforms: ["TIKTOK", "META"],
    recurring: true,
    minTier: "SCALE",
    xpReward: 2600,
  },
];

export const QUESTLINE_BY_KEY: Record<string, QuestlineDef> = Object.fromEntries(
  QUESTLINES.map((q) => [q.key, q])
);
