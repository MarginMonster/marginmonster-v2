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
    price: 49,
    tagline: "Content + ads. Everything in Starter, plus scroll-stopping image ads and copy for Meta & TikTok.",
    highlight: true,
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
    price: 99,
    tagline: "Add video that sells. Product videos + we launch and optimize your ads automatically.",
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
    price: 199,
    tagline: "Full firepower for stores going all-in on growth.",
    blogQuota: 60,
    videoQuota: 20,
    imageQuota: 80,
    campaignAutopilot: true,
    features: [
      "60 blog posts + 80 image ads / month",
      "20 AI product videos / month",
      "Campaign Autopilot across Meta & TikTok",
      "Priority generation + best margins on credits",
    ],
  },
];

export const PLAN_BY_KEY: Record<PlanKey, PlanTier> = Object.fromEntries(
  PLAN_TIERS.map((t) => [t.key, t])
) as Record<PlanKey, PlanTier>;

// Overage credits (top up without upgrading).
export const CREDIT_PRICES = {
  blog: 3, // ~$0.05 cost
  image: 1, // ~$0.01 cost
  video: 15, // ~$2-4 cost — the margin protector
};

export const CREDIT_PACKS = [
  { type: "video" as const, qty: 5, price: 5 * CREDIT_PRICES.video, label: "5 extra videos" },
  { type: "video" as const, qty: 10, price: 10 * CREDIT_PRICES.video, label: "10 extra videos" },
  { type: "blog" as const, qty: 10, price: 10 * CREDIT_PRICES.blog, label: "10 extra blog posts" },
  { type: "image" as const, qty: 30, price: 30 * CREDIT_PRICES.image, label: "30 extra image ads" },
];
