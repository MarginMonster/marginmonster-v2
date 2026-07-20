/* Achievement roster — client-safe (no server imports) so route components can
 * render the full locked/unlocked grid. Bonuses are paid server-side by
 * xp.server.ts when an achievement unlocks: xp feeds the level curve, tokens
 * credit straight to the wallet (tokensExtra). */

export type AchievementDef = {
  key: string;
  icon: string;
  label: string;
  desc: string;
  xp: number; // XP bonus on unlock (0 for level-based ones to avoid cascades)
  tokens: number; // token bonus on unlock
};

export const ACHIEVEMENTS: AchievementDef[] = [
  { key: "SCANNER", icon: "🔍", label: "Scanner", desc: "Analyze your store's brand voice", xp: 20, tokens: 0 },
  { key: "INSERT_COIN", icon: "🕹️", label: "Insert Coin", desc: "Choose your partner", xp: 30, tokens: 0 },
  { key: "FIRST_FORGE", icon: "🔨", label: "First Forge", desc: "Forge your first listing", xp: 15, tokens: 5 },
  { key: "HAMMER_TIME", icon: "⚒️", label: "Hammer Time", desc: "Forge 10 listings", xp: 40, tokens: 10 },
  { key: "SHIPPED_IT", icon: "🚀", label: "Shipped It", desc: "Apply a forged listing to your store", xp: 20, tokens: 5 },
  { key: "BATCH_MASTER", icon: "📦", label: "Batch Master", desc: "Apply 5 listings in one combo", xp: 30, tokens: 10 },
  { key: "BIG_SPENDER", icon: "🪙", label: "Big Spender", desc: "Spend 100 lifetime tokens", xp: 50, tokens: 15 },
  { key: "PLAYER_ONE", icon: "⭐", label: "Player One", desc: "Reach level 5", xp: 0, tokens: 10 },
  { key: "ARCADE_REGULAR", icon: "👾", label: "Arcade Regular", desc: "Reach level 10", xp: 0, tokens: 25 },
  { key: "HIGH_SCORE", icon: "🏆", label: "High Score", desc: "Reach level 25", xp: 0, tokens: 60 },
  { key: "QUEST_COMPLETE", icon: "⚔️", label: "Questmaster", desc: "Complete your first campaign questline", xp: 0, tokens: 20 },
  // 🏝️ island era — the jumping shelf
  { key: "FIRST_TAKE", icon: "🎬", label: "Action!", desc: "Roll your first video take", xp: 0, tokens: 10 },
  { key: "SHOW_RUNNER", icon: "🎞️", label: "Show Runner", desc: "Deliver 10 video takes", xp: 60, tokens: 25 },
  { key: "STILL_LIFE", icon: "🖼️", label: "Still Life", desc: "Forge your first image ad", xp: 15, tokens: 5 },
  { key: "GALLERY_WALL", icon: "🗂️", label: "Gallery Wall", desc: "Forge 15 image ads", xp: 50, tokens: 20 },
  { key: "FIRST_VOYAGE", icon: "🗺️", label: "First Voyage", desc: "Launch your first campaign", xp: 25, tokens: 10 },
  { key: "FLEET_ADMIRAL", icon: "⚓", label: "Fleet Admiral", desc: "Run 2 campaigns at the same time", xp: 40, tokens: 25 },
  { key: "GOLD_RUSH", icon: "💰", label: "Gold Rush", desc: "A shopper clicks through one of your posts", xp: 30, tokens: 15 },
  { key: "TREASURE_HUNTER", icon: "🏴‍☠️", label: "Treasure Hunter", desc: "Collect 25 shopper click-throughs", xp: 80, tokens: 40 },
  { key: "PERFECT_WEEK", icon: "📅", label: "Perfect Week", desc: "Bank a perfect campaign week", xp: 0, tokens: 15 },
  { key: "ISLAND_LEGEND", icon: "🌋", label: "Island Legend", desc: "Reach level 40", xp: 0, tokens: 100 },
  { key: "CROWNED", icon: "👑", label: "Crowned", desc: "Reach level 50 — the island bows", xp: 0, tokens: 150 },
];

export const ACHIEVEMENT_BY_KEY: Record<string, AchievementDef> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.key, a])
);

/* ---- Level curve ----
 * Fast early levels (endowed progress: analyze + choose plan ≈ level 2 in the
 * first session), then a steady climb. totalXpForLevel(n) = XP needed to BE
 * level n. */
export function totalXpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(40 * Math.pow(level - 1, 1.55));
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (totalXpForLevel(level + 1) <= xp && level < 99) level++;
  return level;
}

/* Level-up gifts — EVERY level pays, milestones pay big:
 * regular level = 5 tokens (a free image ad on us)
 * every 5th     = 15 tokens
 * milestones    = 60 tokens (a free video) at 10/20/25, then heavier. */
export const MILESTONE_LEVELS = [10, 20, 25, 30, 40, 50, 75, 99];
export function giftForLevel(level: number): number {
  if (level === 99) return 500;
  if (level === 75) return 250;
  if (level === 50) return 150;
  if (level === 40) return 100;
  if (MILESTONE_LEVELS.includes(level)) return 60;
  if (level % 5 === 0) return 15;
  return 5;
}

/* XP awards per outcome (server enforces) */
export const XP_EVENTS = {
  forgeListing: 8, // per listing successfully forged
  applyListing: 12, // per listing pushed live to the store
  tokenSpent: 1, // per token spent (farm-proof: they paid)
  videoGenerated: 60, // per finished video — the app's premium action
} as const;
