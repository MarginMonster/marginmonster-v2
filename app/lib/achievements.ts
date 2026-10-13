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

// NOTE: `key` is the persisted identifier (unlocks are stored by key), so the
// keys below keep their original names even where the theme has moved on — only
// the player-facing icon / label / desc are themed to the current EasyMode
// voice. XP + token bonuses are unchanged, so no one's progress resets.
export const ACHIEVEMENTS: AchievementDef[] = [
  // getting started
  { key: "SCANNER", icon: "🎙️", label: "Tuned In", desc: "Analyze your store's brand voice", xp: 20, tokens: 0 },
  { key: "INSERT_COIN", icon: "🎟️", label: "All In", desc: "Start your plan", xp: 30, tokens: 0 },
  // making & shipping
  { key: "FIRST_FORGE", icon: "✨", label: "First Spark", desc: "Make your first creation", xp: 15, tokens: 5 },
  { key: "HAMMER_TIME", icon: "🔥", label: "On a Roll", desc: "Make 10 creations", xp: 40, tokens: 10 },
  { key: "SHIPPED_IT", icon: "🚀", label: "Shipped It", desc: "Post a finished piece to your socials", xp: 20, tokens: 5 },
  { key: "BATCH_MASTER", icon: "📦", label: "Batch Master", desc: "Schedule a batch of posts at once", xp: 30, tokens: 10 },
  { key: "BIG_SPENDER", icon: "🪙", label: "Big Spender", desc: "Spend 100 tokens all-time", xp: 50, tokens: 15 },
  // media
  { key: "STILL_LIFE", icon: "🖼️", label: "Still Life", desc: "Create your first image ad", xp: 15, tokens: 5 },
  { key: "GALLERY_WALL", icon: "🗂️", label: "Gallery Wall", desc: "Create 15 image ads", xp: 50, tokens: 20 },
  { key: "FIRST_TAKE", icon: "🎬", label: "Action!", desc: "Create your first video", xp: 0, tokens: 10 },
  { key: "SHOW_RUNNER", icon: "🎞️", label: "Show Runner", desc: "Create 10 videos", xp: 60, tokens: 25 },
  { key: "FACELESS_FIRST", icon: "🎭", label: "Faceless", desc: "Make your first faceless video", xp: 20, tokens: 5 },
  { key: "MUSIC_FIRST", icon: "🎵", label: "First Track", desc: "Make your first track", xp: 15, tokens: 5 },
  { key: "MUSIC_TEN", icon: "🎧", label: "On Repeat", desc: "Make 10 tracks", xp: 50, tokens: 15 },
  { key: "BLOG_FIRST", icon: "📝", label: "Wordsmith", desc: "Write your first article", xp: 15, tokens: 5 },
  { key: "BLOG_TEN", icon: "📰", label: "Columnist", desc: "Write 10 articles", xp: 50, tokens: 15 },
  { key: "RANGE", icon: "🎨", label: "Range", desc: "Create in three different formats", xp: 40, tokens: 10 },
  // campaigns & results
  { key: "FIRST_VOYAGE", icon: "📣", label: "First Launch", desc: "Launch your first campaign", xp: 25, tokens: 10 },
  { key: "FLEET_ADMIRAL", icon: "🔀", label: "Double Up", desc: "Run two campaigns at once", xp: 40, tokens: 25 },
  { key: "CHANNEL_FIRST", icon: "📡", label: "On Air", desc: "Start an auto-posting channel", xp: 25, tokens: 10 },
  { key: "QUEST_COMPLETE", icon: "🏁", label: "Finish Line", desc: "Complete your first campaign", xp: 0, tokens: 20 },
  { key: "PERFECT_WEEK", icon: "📅", label: "Perfect Week", desc: "Run a full campaign week with no misses", xp: 0, tokens: 15 },
  { key: "GOLD_RUSH", icon: "🖱️", label: "First Click", desc: "A shopper taps through one of your posts", xp: 30, tokens: 15 },
  { key: "TREASURE_HUNTER", icon: "📈", label: "Momentum", desc: "Collect 25 shopper click-throughs", xp: 80, tokens: 40 },
  // level milestones
  { key: "PLAYER_ONE", icon: "⭐", label: "Warmed Up", desc: "Reach level 5", xp: 0, tokens: 10 },
  { key: "ARCADE_REGULAR", icon: "🌟", label: "In the Groove", desc: "Reach level 10", xp: 0, tokens: 25 },
  { key: "HIGH_SCORE", icon: "🏅", label: "Top Form", desc: "Reach level 25", xp: 0, tokens: 60 },
  { key: "ISLAND_LEGEND", icon: "💎", label: "Powerhouse", desc: "Reach level 40", xp: 0, tokens: 100 },
  { key: "CROWNED", icon: "👑", label: "Crowned", desc: "Reach level 50 — the top tier", xp: 0, tokens: 150 },
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

/* XP ≠ tokens, on purpose.
 *
 * XP earned from a spend is deliberately OFFSET from the token cost so the two
 * never read as a 1:1 swap ("30 tokens → 30 XP" looks like an exchange rate and
 * cheapens both). XP is the currency that CLIMBS — you always bank more XP than
 * you spent, which is what keeps level-ups (and their token gifts) coming as a
 * merchant generates more. This MUST be linear: refundTokens unwinds spends
 * partially, so the clawback can only stay proportional if the rate is a plain
 * multiplier. Display helpers and the award/refund paths all route through
 * xpForSpend so the "+X XP" a merchant is shown is exactly what lands. */
export const SPEND_XP_RATE = 1.5;
export function xpForSpend(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return Math.round(tokens * SPEND_XP_RATE);
}

/* XP awards per outcome (server enforces) */
export const XP_EVENTS = {
  forgeListing: 8, // per listing successfully forged
  applyListing: 12, // per listing pushed live to the store
  tokenSpent: SPEND_XP_RATE, // XP per token spent — offset from cost, see xpForSpend
  videoGenerated: 60, // per finished video — the app's premium action
} as const;
