// Single source of truth for pricing, quotas, and credits.
// Land-grab pricing: cheap entry, expand via add-ons + metered video credits.
// Margin note: blog/image are ~99% margin; video is the only real cost
// (~$2-4/video) so it is always metered — never unlimited.

export type PlanTypeKey = "SEO_AUTOPILOT" | "VIDEO_AUTOPILOT";

export interface PlanTier {
  key: PlanTypeKey;
  name: string;
  price: number; // USD / month
  blogQuota: number;
  videoQuota: number;
  tagline: string;
  features: string[];
}

export const PLAN_TIERS: Record<PlanTypeKey, PlanTier> = {
  SEO_AUTOPILOT: {
    key: "SEO_AUTOPILOT",
    name: "SEO Autopilot",
    price: 19,
    blogQuota: 15,
    videoQuota: 0,
    tagline: "High-SEO blog posts that pull in free organic traffic — on autopilot.",
    features: [
      "15 SEO blog posts every month",
      "Keyword-targeted & linked to your products",
      "Auto-published to your store on a schedule you set",
      "Set-and-forget, or review & edit every post before it goes live",
    ],
  },
  VIDEO_AUTOPILOT: {
    key: "VIDEO_AUTOPILOT",
    name: "Video Autopilot",
    price: 79,
    blogQuota: 0,
    videoQuota: 10,
    tagline: "Scroll-stopping product videos, generated from your catalog.",
    features: [
      "10 AI product videos every month",
      "Choose per video: AI avatar (UGC) or product highlight",
      "Built from your store products or your own uploads",
      "Autopilot or manual — always reviewable before publishing",
    ],
  },
};

export interface AddOn {
  key: "adCreativePack" | "campaignAutopilot";
  name: string;
  price: number;
  description: string;
}

export const ADDONS: Record<string, AddOn> = {
  adCreativePack: {
    key: "adCreativePack",
    name: "Ad Creative Pack",
    price: 29,
    description: "60 AI image ads + Meta/TikTok ad copy every month.",
  },
  campaignAutopilot: {
    key: "campaignAutopilot",
    name: "Campaign Autopilot",
    price: 49,
    description:
      "We launch and optimize your ads automatically — kill losers, scale winners. The full closed loop.",
  },
};

// Overage credits (top up without upgrading).
export const CREDIT_PRICES = {
  blog: 3, // ~$0.05 cost
  image: 1, // ~$0.01 cost
  video: 15, // ~$2-4 cost — the margin protector
};

// Credit top-up packs shown in the UI.
export const CREDIT_PACKS = [
  { type: "video" as const, qty: 5, price: 5 * CREDIT_PRICES.video, label: "5 extra videos" },
  { type: "video" as const, qty: 10, price: 10 * CREDIT_PRICES.video, label: "10 extra videos" },
  { type: "blog" as const, qty: 10, price: 10 * CREDIT_PRICES.blog, label: "10 extra blog posts" },
  { type: "image" as const, qty: 30, price: 30 * CREDIT_PRICES.image, label: "30 extra image ads" },
];

export function monthlyTotal(
  planKey: PlanTypeKey,
  addons: { adCreativePack?: boolean; campaignAutopilot?: boolean }
): number {
  let total = PLAN_TIERS[planKey].price;
  if (addons.adCreativePack) total += ADDONS.adCreativePack.price;
  if (addons.campaignAutopilot) total += ADDONS.campaignAutopilot.price;
  return total;
}
