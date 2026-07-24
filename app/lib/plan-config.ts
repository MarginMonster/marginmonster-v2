// Single source of truth for pricing, quotas, and credits.
// A good/better/best/pro ladder modeled on successful AI marketing apps
// (Zeely, faceless.ai): cheap entry, a highlighted "most popular" middle,
// and a high anchor. Video is the only real cost so it is always metered.

export type PlanKey = "STARTER" | "GROWTH" | "PRO" | "SCALE";

export interface PlanTier {
  key: PlanKey;
  name: string;
  price: number; // USD / month
  tagline: string;
  highlight?: boolean; // renders the "Most popular" ribbon
  monthlyTokens: number; // included token allowance per billing period
  blogQuota: number;
  videoQuota: number;
  imageQuota: number; // image ads / month
  campaignAutopilot: boolean;
  features: string[];
}

export const PLAN_TIERS: PlanTier[] = [
  {
    key: "STARTER",
    name: "Starter",
    price: 19,
    tagline: "Get found on Google. SEO blog posts that pull in free traffic — written and published for you.",
    monthlyTokens: 200,
    blogQuota: 15,
    videoQuota: 0,
    imageQuota: 0,
    campaignAutopilot: false,
    features: [
      "Get found on Google with SEO blog posts",
      "Targets what your buyers search → ranks on Google",
      "Auto-published to your store on your schedule",
      "Review-first or set-and-forget",
    ],
  },
  {
    key: "GROWTH",
    name: "Growth",
    price: 39,
    tagline: "Content + ads. Everything in Starter, plus scroll-stopping image ads and copy for Meta & TikTok.",
    monthlyTokens: 550,
    blogQuota: 30,
    videoQuota: 0,
    imageQuota: 30,
    campaignAutopilot: false,
    features: [
      "Everything in Starter",
      "Scroll-stopping AI image ads + Meta/TikTok ad copy",
      "All content built from your real products",
      "Review-first or set-and-forget",
    ],
  },
  {
    key: "PRO",
    name: "Pro",
    price: 79,
    tagline: "Add video that sells. Product videos + we launch and optimize your ads automatically.",
    highlight: true,
    monthlyTokens: 1500,
    blogQuota: 30,
    videoQuota: 8,
    imageQuota: 40,
    campaignAutopilot: true,
    features: [
      "Everything in Growth",
      "AI product videos (avatar or highlight)",
      "Campaign Autopilot — auto-launch, kill losers, scale winners",
      "Vertical-formatted for TikTok, Reels & Shorts",
    ],
  },
  {
    key: "SCALE",
    name: "Scale",
    price: 149,
    tagline: "Full firepower for stores going all-in on growth.",
    monthlyTokens: 3000,
    blogQuota: 60,
    videoQuota: 20,
    imageQuota: 80,
    campaignAutopilot: true,
    features: [
      "Everything in Pro",
      "Our largest monthly token balance — best value per token",
      "Campaign Autopilot across Meta & TikTok",
      "Priority generation",
    ],
  },
];

export const PLAN_BY_KEY: Record<PlanKey, PlanTier> = Object.fromEntries(
  PLAN_TIERS.map((t) => [t.key, t])
) as Record<PlanKey, PlanTier>;

// Annual billing — pay for 10 months, get 12 (2 months free). Billing keys are
// the tier key + "_ANNUAL"; the annual price is the monthly price × 10.
export const ANNUAL_SUFFIX = "_ANNUAL";
export const annualKey = (k: PlanKey): string => `${k}${ANNUAL_SUFFIX}`;
export const annualPrice = (t: PlanTier): number => t.price * 10;
export const ANNUAL_TO_TIER: Record<string, PlanKey> = Object.fromEntries(
  PLAN_TIERS.map((t) => [annualKey(t.key), t.key])
);
export const isAnnualKey = (k: string): boolean => k.endsWith(ANNUAL_SUFFIX);

// ---- Unified token wallet ----
// Every AI action spends tokens from one shared balance. Each plan includes a
// monthly allowance (monthlyTokens); top up for anything over budget. Video is
// the real cost driver, so it's the most expensive action (margin protector).
export const TOKEN_COST = {
  description: 3, // AI product listing (The Listing Forge)
  adCopy: 3, // Meta/TikTok ad copy
  image: 5, // AI image ad
  strategy: 6, // marketing plan
  blog: 10, // SEO blog post
  landing: 10, // landing page
  // AI product video — real COGS ~$2-3 (omni-human/HeyGen lip-sync + TTS +
  // image). Priced so an all-video month stays margin-positive on every tier:
  // Pro 1500/150 = 10 videos ≈ $30 on $79 (62%), Scale 3000/150 = 20 ≈ $60 on
  // $149 (60%). This one number is the margin lever — raise it if COGS climbs.
  video: 150,
} as const;
export type TokenAction = keyof typeof TOKEN_COST;

export const TOKEN_ACTION_LABEL: Record<TokenAction, string> = {
  description: "Product description",
  adCopy: "Ad copy",
  image: "Image ad",
  strategy: "Marketing plan",
  blog: "Blog post",
  landing: "Landing page",
  video: "Product video",
};

// Top-up packs — one currency, use on anything. Priced ~$0.10-0.12/token so
// even a topped-up video ($4) stays margin-positive.
export const TOKEN_PACKS = [
  { tokens: 250, price: 25, label: "250 tokens" },
  { tokens: 750, price: 60, label: "750 tokens", best: false },
  { tokens: 2000, price: 140, label: "2,000 tokens", best: true },
];

// ---- Truthful capacity copy ----
// One currency means we can DERIVE "what a plan makes" from its wallet instead
// of hand-writing counts that drift. Each tier showcases the actions that fit
// its positioning; counts are the wallet ÷ that action's cost (rounded).
const PLAN_SHOWCASE: Record<PlanKey, TokenAction[]> = {
  STARTER: ["blog"],
  GROWTH: ["image", "blog"],
  PRO: ["video", "blog", "image"],
  SCALE: ["video", "blog", "image"],
};
const CAPACITY_NOUN: Partial<Record<TokenAction, string>> = {
  video: "product videos",
  blog: "blog posts",
  image: "image ads",
  landing: "landing pages",
};
export function planCapacity(tier: PlanTier): { action: TokenAction; count: number; noun: string }[] {
  return PLAN_SHOWCASE[tier.key].map((action) => ({
    action,
    count: Math.round(tier.monthlyTokens / TOKEN_COST[action]),
    noun: CAPACITY_NOUN[action] || action,
  }));
}
/** e.g. "≈ 10 product videos, 150 blog posts, or 300 image ads" — always true,
 *  because it's computed from the same wallet the app actually spends. */
export function planCapacityLine(tier: PlanTier): string {
  const parts = planCapacity(tier).map((c) => `${c.count.toLocaleString()} ${c.noun}`);
  if (parts.length === 1) return `≈ ${parts[0]} a month`;
  return `≈ ${parts.slice(0, -1).join(", ")}, or ${parts[parts.length - 1]}`;
}

/** Per-action token costs as a compact legend for the "one balance" explainer. */
export const TOKEN_COST_LEGEND: { action: TokenAction; label: string; cost: number }[] = [
  { action: "video", label: "Product video", cost: TOKEN_COST.video },
  { action: "blog", label: "Blog post", cost: TOKEN_COST.blog },
  { action: "image", label: "Image ad", cost: TOKEN_COST.image },
  { action: "description", label: "Listing / ad copy", cost: TOKEN_COST.description },
];
