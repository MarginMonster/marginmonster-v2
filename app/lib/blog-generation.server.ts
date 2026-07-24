import { db } from "../db.server";
import type { BrandProfile, Plan } from "@prisma/client";
import { anthropicText } from "./anthropic.server";

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

Write a COMPLETE blog post of 550-750 words. Follow this exact structure every time so all articles read as one house style:
- One <h1> title: compelling and SEO-friendly (front-load the buyer keyword)
- A short 1-2 sentence intro <p> that hooks the reader
- Exactly 3 sections, each a <h2> subheading followed by 1-2 <p> paragraphs
- Use one <ul> with 3-5 <li> bullets in the most list-friendly section
- A final <h2> "The bottom line" (or similar) with a closing <p> that delivers a clear CTA aligned to: ${intent}
- Natural brand voice throughout; no generic filler — every paragraph specific to this brand

CRITICAL: The article MUST be fully finished — a complete final sentence and a closing CTA paragraph. Never stop mid-sentence or mid-tag. Stay within the word count so you finish cleanly.

Return ONLY the HTML body content (h1, h2, p, ul, li, strong tags only — no html/head/body tags, no markdown fences).`;

  let attempts = 0;
  while (attempts < 3) {
    attempts++;
    try {
      let html = (
        await anthropicText(prompt, {
          model: "claude-sonnet-5",
          maxTokens: 4096,
        })
      ).trim();
      // Strip any stray markdown fences and guarantee we never store a body
      // that was cut off mid-tag (belt-and-suspenders on top of the word cap).
      html = html.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const lastClose = html.lastIndexOf("</");
      const lastOpen = html.lastIndexOf("<");
      if (lastOpen > lastClose) html = html.slice(0, lastOpen).trim(); // drop a dangling partial tag

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
