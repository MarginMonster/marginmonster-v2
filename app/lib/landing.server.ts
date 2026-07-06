import type { BrandProfile } from "@prisma/client";
import { anthropicText } from "./anthropic.server";

export interface LandingContent {
  hero: string;
  subhead: string;
  benefits: { title: string; body: string }[];
  socialProof: string;
  ctaText: string;
}

export async function generateLandingContent(
  brandProfile: BrandProfile,
  productName: string,
  goal: string
): Promise<LandingContent> {
  const voice = JSON.parse(brandProfile.voiceJson);
  const products = JSON.parse(brandProfile.productJson);

  const goalLine =
    goal === "LEAD"
      ? "capture the visitor's email in exchange for an offer"
      : goal === "LAUNCH"
      ? "build excitement and pre-orders for a new product"
      : "drive an immediate purchase";

  const prompt = `Write a high-converting landing page for a Shopify product.

Brand tone: ${voice.tone}
Brand vocabulary: ${(voice.vocabulary || []).join(", ")}
Positioning: ${products.positioning || ""}
Product: ${productName}
Goal: ${goalLine}

Return ONLY a JSON object:
{
  "hero": "string — a bold 6-10 word headline that stops the scroll",
  "subhead": "string — one supporting sentence with the core benefit",
  "benefits": [
    { "title": "short benefit title", "body": "one sentence" },
    { "title": "...", "body": "..." },
    { "title": "...", "body": "..." }
  ],
  "socialProof": "string — a punchy, believable one-line social proof statement",
  "ctaText": "string — 2-4 word button text"
}

Make every line sound like this brand.`;

  const text = await anthropicText(prompt, { maxTokens: 900 });
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Could not parse landing page content.");
  return JSON.parse(match[0]) as LandingContent;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) +
    "-" +
    Math.random().toString(36).slice(2, 7)
  );
}
