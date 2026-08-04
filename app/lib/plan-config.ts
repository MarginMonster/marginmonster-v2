// Single source of truth for pricing, quotas, capabilities, and credits.
//
// THE TWO-CURRENCY RULE (do not break):
//   TIER  controls WHICH generators are unlocked (capabilities below).
//   TOKENS control HOW MUCH the merchant can generate.
//   Tokens must NEVER unlock a generator the tier doesn't include — a Starter
//   store with 10,000 purchased tokens still cannot generate video. Enforced
//   server-side in lib/capabilities.server.ts at every generation entry point.
//
// The ladder is strictly cumulative — each tier contains everything below it.

export type PlanKey = "STARTER" | "STUDIO" | "ANTHEM";

// Pre-2026 ladder keys that may still exist on live Plan rows. They keep
// working forever: gating resolves them to the closest new tier.
export type LegacyPlanKey = "GROWTH" | "PRO" | "SCALE";
export const LEGACY_TIER_MAP: Record<LegacyPlanKey, PlanKey> = {
  GROWTH: "STARTER", // had images/blogs, no video
  PRO: "STUDIO", //     had video
  SCALE: "ANTHEM", //   had everything
};

export interface PlanTier {
  key: PlanKey;
  name: string;
  price: number; // USD / month
  tagline: string;
  highlight?: boolean; // renders the "Most popular" ribbon
  monthlyTokens: number; // included token allowance per billing period
  blogQuota: number; // legacy positioning fields — seeded onto the Plan row
  videoQuota: number;
  imageQuota: number;
  campaignAutopilot: boolean;
  features: string[];
}

export const PLAN_TIERS: PlanTier[] = [
  {
    key: "STARTER",
    name: "Starter",
    price: 19,
    tagline: "Scroll-stopping image ads, SEO blogs, and auto-posting — your store never goes quiet.",
    monthlyTokens: 300,
    blogQuota: 15,
    videoQuota: 0,
    imageQuota: 60,
    campaignAutopilot: false,
    features: [
      "AI image ads built on famous ad formats",
      "SEO blog posts, written & published for you",
      "Captions + hashtags, auto-posted to TikTok, IG & Facebook",
      "AI product listings & ad copy",
    ],
  },
  {
    key: "STUDIO",
    name: "Studio",
    price: 39,
    tagline: "Every generator unlocked: AI presenters, cinematic videos, cartoon styles and your own Anthem.",
    highlight: true,
    monthlyTokens: 900,
    blogQuota: 30,
    videoQuota: 6,
    imageQuota: 60,
    campaignAutopilot: true,
    features: [
      "Everything in Starter — plus EVERY video generator",
      "Avatar AI & Product Highlight — presenter or cinematic",
      "Anthem + all 8 Cartoon Avatar styles included",
      "Campaign Autopilot — a month of content, launched for you",
    ],
  },
  {
    key: "ANTHEM",
    name: "Legend",
    price: 69,
    tagline: "Everything in Studio at nearly double the volume — built for stores that post every day.",
    monthlyTokens: 1600,
    blogQuota: 60,
    videoQuota: 10,
    imageQuota: 100,
    campaignAutopilot: true,
    features: [
      "Every generator, nearly 2× the tokens (1,600/mo)",
      "Best price per generation — built for daily posting",
      "The biggest Campaign Autopilot mixes (Go Viral scale)",
      "Campaign discount on token costs",
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

/** Resolve ANY plan-type string (new tier, legacy tier, or annual variant of
 *  either) to the current 3-tier ladder. Null = unknown type. */
export function resolveTierKey(type: string | null | undefined): PlanKey | null {
  if (!type) return null;
  const base = type.endsWith(ANNUAL_SUFFIX) ? type.slice(0, -ANNUAL_SUFFIX.length) : type;
  if (PLAN_BY_KEY[base as PlanKey]) return base as PlanKey;
  return LEGACY_TIER_MAP[base as LegacyPlanKey] || null;
}

/** Ladder height (1-3) for min-tier comparisons; legacy keys rank where their
 *  capabilities land. Unknown types rank 0 (below everything). */
export function planRank(type: string | null | undefined): number {
  const tier = resolveTierKey(type);
  return tier === "ANTHEM" ? 3 : tier === "STUDIO" ? 2 : tier === "STARTER" ? 1 : 0;
}
/** Legacy min-tier strings in questline defs rank against the OLD ladder. */
export function minTierRank(minTier: string): number {
  return minTier === "SCALE" || minTier === "ANTHEM" ? 3 : minTier === "PRO" || minTier === "STUDIO" ? 2 : 1;
}

// ---- Capabilities: what each tier UNLOCKS (cumulative) ----
export type Capability = "image" | "blog" | "autopost" | "video" | "cartoon" | "anthem";

// Studio unlocks EVERY generator (video, cartoon, anthem included) — the
// Anthem tier differentiates on VOLUME (1,600 tokens vs 900) and price-per-
// token, not on locked features. Gating creativity behind the top tier read
// as too strict; volume is the honest upsell.
export const TIER_CAPABILITIES: Record<PlanKey, readonly Capability[]> = {
  STARTER: ["image", "blog", "autopost"],
  STUDIO: ["image", "blog", "autopost", "video", "cartoon", "anthem"],
  ANTHEM: ["image", "blog", "autopost", "video", "cartoon", "anthem"],
};

/** The cheapest tier that includes a capability (upgrade-prompt target). */
export const CAPABILITY_TIER: Record<Capability, PlanKey> = {
  image: "STARTER",
  blog: "STARTER",
  autopost: "STARTER",
  video: "STUDIO",
  cartoon: "STUDIO",
  anthem: "STUDIO",
};

export const CAPABILITY_LABEL: Record<Capability, string> = {
  image: "Image ads",
  blog: "Blog posts",
  autopost: "Auto-posting",
  video: "Product videos",
  cartoon: "Cartoon Avatar styles",
  anthem: "Anthem singing videos",
};

// ---- Trial ----
// Shopify's trialDays delays the first charge; these are OUR guardrails.
// Trials run at Studio-level capabilities (merchants must SEE video) but under
// a hard token ceiling, and the top-shelf generators (anthem, cartoon) unlock
// on first payment. Enforced server-side in tokens.server / capabilities.server.
export const TRIAL_TOKEN_CAP = 400;

// ---- Unified token wallet ----
// Every unlocked AI action spends tokens from one shared balance. Each plan
// includes a monthly allowance (monthlyTokens); top up for anything over
// budget. Video is the real cost driver, so it's the most expensive action.
export const TOKEN_COST = {
  description: 3, // AI product listing (The Listing Forge)
  adCopy: 3, // Meta/TikTok ad copy
  image: 5, // AI image ad
  strategy: 6, // marketing plan
  blog: 10, // SEO blog post
  landing: 10, // landing page
  // AI product video — real COGS ~$2-3.5 (lip-sync + TTS + image, anthems the
  // priciest). Priced so an all-video month stays margin-positive per tier:
  // Studio 900/150 = 6 ≈ $18 COGS on $59 (~65%); Anthem 1600/150 ≈ 10 ≈ $35
  // COGS on $99 (~55% after Shopify's cut). The margin lever — raise if COGS climbs.
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

// Top-up packs — one currency, spend on anything YOUR TIER UNLOCKS. Priced
// ~$0.10-0.12/token so even the priciest generation path (anthem video ≈
// $3.50 COGS vs 150 tokens ≈ $15) holds well over 30% gross margin.
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
  STARTER: ["image", "blog"],
  STUDIO: ["video", "image", "blog"],
  ANTHEM: ["video", "image", "blog"],
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
/** e.g. "≈ 6 product videos, 180 image ads, or 90 blog posts" — always true,
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
