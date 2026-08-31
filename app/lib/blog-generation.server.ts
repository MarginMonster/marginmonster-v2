import { db } from "../db.server";
import { sanitizeArticleHtml } from "./sanitize-html";
import type { BrandProfile, Plan } from "@prisma/client";
import { anthropicText } from "./anthropic.server";
import { langDirective } from "./content-lang";
import { brandBlock } from "./brand-prompt";

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
  // One shared block, and only the lines we can actually fill.
  const brand = brandBlock(brandProfile);
  const intent = SEO_BLOG_INTENT;
  const contentLang = (await db.shop.findUnique({ where: { id: shopId }, select: { contentLang: true } }))?.contentLang;

  const prompt = `Write a blog post for the store with this brand profile:${langDirective(contentLang)}

${brand}

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

CRITICAL: Never invent an expansion for an abbreviation, edition marker or product code in the product title. Product names are full of them — "S-Chinese", "CSV8C", "V4", "SV8A" — and guessing produces confident, wrong copy that makes the store look like it does not know its own catalogue. (A real article rendered "S-Chinese" as "South-Chinese"; it means Simplified Chinese.) If the meaning is not given in the product details above, use the abbreviation exactly as written, or write around it. Do the same with numbers: never state a price, a discount, a stock level, a release date or a pull rate that was not supplied to you.

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
      // SANITIZE ONCE, HERE. This HTML is rendered into the merchant’s Archive
      // with dangerouslySetInnerHTML and published to their storefront, and
      // nothing anywhere sanitized it. The model does not have to be hostile to
      // emit a <script> or an onerror= — a product description that looks like
      // markup is enough. Allowlist, so a tag nobody anticipated is dropped
      // rather than admitted.
      html = sanitizeArticleHtml(html);

      // CHECK THE ARTICLE BEFORE ADDING THE FOOTER.
      //
      // publishBlogAsset refuses to publish an empty body — `if (!html.trim())
      // return { ok: false, error: "no-body" }`. That guard could never fire,
      // because the footer below was appended first and made every body
      // non-empty. So a model that returned nothing, or a refusal, was stored
      // as a finished article, charged for, and auto-published to the
      // merchant's real storefront as a page whose entire content is the words
      // "This article was created with AI assistance."
      //
      // The floor is deliberately low — a very short post is a quality problem,
      // an empty one is a broken promise — but it has to be above the length of
      // a refusal sentence.
      const visible = html.replace(/<[^>]+>/g, "").trim();
      if (visible.length < 200) {
        throw new Error(`blog generation returned no usable article (${visible.length} characters of text)`);
      }

      // AI disclosure (FTC-aligned) — a subtle, honest footer on every published
      // article. Neutral wording so it's appropriate on any merchant's store.
      html += `\n<p style="margin-top:24px;font-size:13px;color:#8a8d82;font-style:italic;">This article was created with AI assistance and reviewed for your store.</p>`;

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
