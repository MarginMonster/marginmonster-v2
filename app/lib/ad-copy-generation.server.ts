import type { BrandProfile, Plan } from "@prisma/client";
import { db } from "../db.server";
import { anthropicText } from "./anthropic.server";

const PLAN_CTA: Record<string, string[]> = {
  GROW_SALES: ["Shop Now", "Get Yours", "Buy Today"],
  LAUNCH_PRODUCT: ["Be First", "Get Early Access", "Discover Now"],
  CLEAR_INVENTORY: ["Grab It", "While Supplies Last", "Shop the Sale"],
  BUILD_AWARENESS: ["Learn More", "Explore", "See Our Story"],
};

export interface AdCopySet {
  headlines: string[];    // 3 variants, max 40 chars each
  primaryTexts: string[]; // 3 variants, max 125 chars each
  ctas: string[];         // 3 CTA options
}

export async function generateAdCopy(
  shopId: string,
  brandProfile: BrandProfile,
  plan: Plan,
  productTitle: string,
  productDescription: string
): Promise<string> {
  const voice = JSON.parse(brandProfile.voiceJson);
  const products = JSON.parse(brandProfile.productJson);
  const ctas = PLAN_CTA[plan.campaignGoal] || PLAN_CTA.GROW_SALES;

  const prompt = `Write Meta/TikTok ad copy for this product with these constraints:

Brand tone: ${voice.tone}
Brand vocabulary: ${voice.vocabulary?.join(", ")}
Product: ${productTitle}
Description: ${productDescription?.slice(0, 200) || ""}
Goal: ${plan.campaignGoal.replace(/_/g, " ").toLowerCase()}
Positioning: ${products.positioning}

Return ONLY a JSON object:
{
  "headlines": ["headline1 (max 40 chars)", "headline2 (max 40 chars)", "headline3 (max 40 chars)"],
  "primaryTexts": [
    "primary text 1 (max 125 chars, hook + value prop + soft CTA)",
    "primary text 2 (different angle, max 125 chars)",
    "primary text 3 (urgency/social proof angle, max 125 chars)"
  ],
  "ctas": ["${ctas[0]}", "${ctas[1]}", "${ctas[2]}"]
}

All copy must sound like this brand, not generic ad copy.`;

  let copyData: AdCopySet | undefined;
  let attempts = 0;
  while (attempts < 3) {
    attempts++;
    try {
      const text = await anthropicText(prompt, { maxTokens: 512 });
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON in response");
      copyData = JSON.parse(match[0]) as AdCopySet;
      break;
    } catch (e) {
      if (attempts === 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * attempts));
    }
  }

  const asset = await db.asset.create({
    data: {
      shopId,
      type: "AD_COPY",
      status: "PENDING",
      title: `Ad copy for ${productTitle}`,
      bodyJson: JSON.stringify(copyData),
      metaJson: JSON.stringify({ campaignGoal: plan.campaignGoal, productTitle }),
    },
  });

  return asset.id;
}
