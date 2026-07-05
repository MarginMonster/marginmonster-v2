import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db.server";
import type { BrandProfile, Plan } from "@prisma/client";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Blog posts are the SEO Autopilot product: the goal is always organic
// search traffic — rank for buyer-intent keywords, then convert.
const SEO_BLOG_INTENT =
  "rank in Google for buyer-intent keywords related to this product, " +
  "capture organic search traffic, and convert readers with a natural " +
  "product CTA. Write genuinely useful, keyword-rich content — not thin filler.";

export async function generateBlogPost(
  shopId: string,
  brandProfile: BrandProfile,
  plan: Plan,
  productTitle: string,
  productDescription: string
): Promise<string> {
  const voice = JSON.parse(brandProfile.voiceJson);
  const products = JSON.parse(brandProfile.productJson);
  const intent = SEO_BLOG_INTENT;

  const prompt = `Write a Shopify blog post for the store with this brand profile:

Tone: ${voice.tone}
Vocabulary to use: ${voice.vocabulary?.join(", ")}
Brand values: ${voice.values?.join(", ")}
Brand positioning: ${products.positioning}

Product to feature: ${productTitle}
Product details: ${productDescription?.slice(0, 400) || ""}

Marketing goal: ${intent}

Write a complete blog post (600-900 words) with:
- A compelling, SEO-friendly title (H1)
- 3-4 sections with subheadings (H2)
- Natural brand voice throughout
- A clear CTA at the end that aligns with the goal: ${intent}
- No generic filler — every paragraph should feel specific to this brand

Return ONLY the HTML body content (h1, h2, p, ul tags only — no html/head/body tags).`;

  let attempts = 0;
  while (attempts < 3) {
    attempts++;
    try {
      const msg = await anthropic.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });
      const html =
        msg.content[0].type === "text" ? msg.content[0].text.trim() : "";

      const asset = await db.asset.create({
        data: {
          shopId,
          type: "BLOG_POST",
          status: "PENDING",
          title: productTitle,
          bodyJson: JSON.stringify({ html }),
          metaJson: JSON.stringify({ planType: plan.type, productTitle }),
        },
      });

      return asset.id;
    } catch (e) {
      if (attempts === 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * attempts));
    }
  }
  throw new Error("Blog generation failed after retries");
}
