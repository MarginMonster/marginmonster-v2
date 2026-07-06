import type { BrandProfile, Plan } from "@prisma/client";
import { anthropicText } from "./anthropic.server";

export interface MarketingPlan {
  headline: string;
  positioning: string;
  channels: { name: string; why: string; cadence: string }[];
  contentThemes: string[];
  budgetSplit: { channel: string; percent: number }[];
  weeklyPlan: { week: string; focus: string }[];
  kpis: string[];
}

const PLAN_FOCUS: Record<string, string> = {
  STARTER: "organic SEO traffic through consistent blog content",
  GROWTH: "SEO plus paid social creative to drive first purchases",
  PRO: "video-led paid acquisition with automated optimization",
  SCALE: "full-funnel content + paid scaling across channels",
};

export async function generateMarketingPlan(
  brandProfile: BrandProfile,
  plan: Plan
): Promise<MarketingPlan> {
  const voice = JSON.parse(brandProfile.voiceJson);
  const products = JSON.parse(brandProfile.productJson);
  const focus = PLAN_FOCUS[plan.type] || PLAN_FOCUS.GROWTH;

  const prompt = `You are a senior e-commerce growth strategist. Build a concrete 4-week marketing plan for this Shopify store.

Store: ${products.storeName || "the store"}
Positioning: ${products.positioning || "N/A"}
Brand tone: ${voice.tone}
Brand values: ${(voice.values || []).join(", ")}
Current focus: ${focus}
Weekly budget available: $${plan.weeklyBudget || 150}

Return ONLY a JSON object with this exact structure:
{
  "headline": "string — a punchy 6-10 word strategy headline",
  "positioning": "string — one sentence on the angle to win with",
  "channels": [
    { "name": "e.g. SEO blog", "why": "short reason", "cadence": "e.g. 3x/week" },
    { "name": "Meta ads", "why": "...", "cadence": "..." },
    { "name": "TikTok", "why": "...", "cadence": "..." }
  ],
  "contentThemes": ["theme1", "theme2", "theme3", "theme4"],
  "budgetSplit": [
    { "channel": "Meta", "percent": 50 },
    { "channel": "TikTok", "percent": 35 },
    { "channel": "Content/SEO", "percent": 15 }
  ],
  "weeklyPlan": [
    { "week": "Week 1", "focus": "..." },
    { "week": "Week 2", "focus": "..." },
    { "week": "Week 3", "focus": "..." },
    { "week": "Week 4", "focus": "..." }
  ],
  "kpis": ["kpi1", "kpi2", "kpi3"]
}

Make it specific to this store and realistic for the budget. Percentages must sum to 100.`;

  const text = await anthropicText(prompt, { maxTokens: 1200 });
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Could not parse the marketing plan.");
  return JSON.parse(match[0]) as MarketingPlan;
}
