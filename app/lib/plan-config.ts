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
      "15 SEO blog posts / month",
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
    highlight: true,
    monthlyTokens: 550,
    blogQuota: 30,
    videoQuota: 0,
    imageQuota: 30,
    campaignAutopilot: false,
    features: [
      "30 SEO blog posts / month",
      "30 AI image ads + Meta/TikTok ad copy",
      "All content built from your real products",
      "Review-first or set-and-forget",
    ],
  },
  {
    key: "PRO",
    name: "Pro",
    price: 79,
    tagline: "Add video that sells. Product videos + we launch and optimize your ads automatically.",
    monthlyTokens: 1500,
    blogQuota: 30,
    videoQuota: 8,
    imageQuota: 40,
    campaignAutopilot: true,
    features: [
      "Everything in Growth",
      "8 AI product videos / month (avatar or highlight)",
      "Campaign Autopilot — auto-launch, kill losers, scale winners",
      "Vertical-formatted for TikTok, Reels & Shorts",
    ],
  },
  {
    key: "SCALE",
    name: "Scale",
    price: 149,
    tagline: "Full firepower for stores going all-in on growth.",
    monthlyTokens: 3500,
    blogQuota: 60,
    videoQuota: 20,
    imageQuota: 80,
    campaignAutopilot: true,
    features: [
      "60 blog posts + 80 image ads / month",
      "20 AI product videos / month",
      "Campaign Autopilot across Meta & TikTok",
      "Priority generation + best token value",
    ],
  },
];

export const PLAN_BY_KEY: Record<PlanKey, PlanTier> = Object.fromEntries(
  PLAN_TIERS.map((t) => [t.key, t])
) as Record<PlanKey, PlanTier>;

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
  video: 60, // AI product video (~$1-2 real cost) — margin protector
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
