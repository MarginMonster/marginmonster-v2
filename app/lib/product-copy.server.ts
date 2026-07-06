import type { BrandProfile } from "@prisma/client";
import { anthropicText } from "./anthropic.server";

export interface ProductCopy {
  seoTitle: string;
  metaDescription: string;
  descriptions: string[]; // 2 full-length variants
  bullets: string[]; // scannable selling points
}

export async function generateProductCopy(
  brandProfile: BrandProfile,
  productName: string,
  notes: string
): Promise<ProductCopy> {
  const voice = JSON.parse(brandProfile.voiceJson);
  const products = JSON.parse(brandProfile.productJson);

  const prompt = `Write high-converting, SEO-friendly product copy for a Shopify store.

Brand tone: ${voice.tone}
Brand vocabulary: ${(voice.vocabulary || []).join(", ")}
Brand positioning: ${products.positioning || ""}

Product: ${productName}
Extra notes from the merchant: ${notes || "none"}

Return ONLY a JSON object:
{
  "seoTitle": "string — under 60 chars, keyword-rich, compelling",
  "metaDescription": "string — under 155 chars, benefit-driven, invites the click",
  "descriptions": [
    "full product description variant 1 (120-180 words, brand voice, benefit-led, ends with a soft CTA)",
    "full product description variant 2 (different angle, 120-180 words)"
  ],
  "bullets": ["scannable selling point 1", "point 2", "point 3", "point 4", "point 5"]
}

Every line must sound like this brand — never generic.`;

  const text = await anthropicText(prompt, { model: "claude-sonnet-5", maxTokens: 1400 });
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Could not parse product copy.");
  return JSON.parse(match[0]) as ProductCopy;
}
