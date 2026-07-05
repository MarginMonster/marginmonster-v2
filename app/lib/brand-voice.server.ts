import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db.server";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface ShopifyProduct {
  title: string;
  description: string;
  productType: string;
  priceRange: { minVariantPrice: { amount: string } };
}

interface ShopifyStorefront {
  name: string;
  description: string;
  primaryDomain: { url: string };
}

async function fetchStoreContent(
  shop: string,
  accessToken: string
): Promise<{ storefront: ShopifyStorefront; products: ShopifyProduct[] }> {
  const res = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query: `{
        shop { name description primaryDomain { url } }
        products(first: 20, sortKey: BEST_SELLING) {
          edges {
            node {
              title
              description(truncateAt: 300)
              productType
              priceRange { minVariantPrice { amount } }
            }
          }
        }
      }`,
    }),
  });

  if (!res.ok) throw new Error(`Shopify API ${res.status}`);
  const json = await res.json() as { data: { shop: ShopifyStorefront; products: { edges: { node: ShopifyProduct }[] } } };
  return {
    storefront: json.data.shop,
    products: json.data.products.edges.map((e) => e.node),
  };
}

function safeParseJSON(text: string): Record<string, unknown> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in response");
  return JSON.parse(match[0]);
}

export async function generateBrandProfile(
  shopId: string,
  shop: string,
  accessToken: string
): Promise<void> {
  const { storefront, products } = await fetchStoreContent(shop, accessToken);

  const productSummary = products
    .map((p) => `${p.title} (${p.productType || "General"}, $${parseFloat(p.priceRange.minVariantPrice.amount).toFixed(2)}): ${p.description?.slice(0, 150) || ""}`)
    .join("\n");

  const prices = products.map((p) =>
    parseFloat(p.priceRange.minVariantPrice.amount)
  );
  const avgPrice = prices.length
    ? prices.reduce((a, b) => a + b, 0) / prices.length
    : 0;

  const prompt = `You are a brand strategist analyzing a Shopify store to build a brand intelligence profile for AI-driven marketing.

Store: ${storefront.name}
Description: ${storefront.description || "N/A"}
URL: ${storefront.primaryDomain?.url || ""}

Top products:
${productSummary}

Return ONLY a JSON object with this exact structure:
{
  "voice": {
    "tone": "string (e.g. playful, professional, bold, warm)",
    "vocabulary": ["word1", "word2", "word3", "word4", "word5"],
    "values": ["value1", "value2", "value3"],
    "tagline": "string — a 5-8 word brand tagline you'd write for this store",
    "samplePhrases": ["phrase1", "phrase2", "phrase3"]
  },
  "visual": {
    "imageStyle": "string (e.g. bright lifestyle, dark moody, clean minimal, vibrant street)",
    "contentThemes": ["theme1", "theme2", "theme3"]
  },
  "products": {
    "categories": ["cat1", "cat2"],
    "avgPrice": ${avgPrice.toFixed(2)},
    "positioning": "string — one sentence on how this store positions itself vs competitors"
  }
}`;

  let voiceData: Record<string, unknown>;
  let attempts = 0;
  while (attempts < 3) {
    attempts++;
    try {
      const msg = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      const text = msg.content[0].type === "text" ? msg.content[0].text : "";
      voiceData = safeParseJSON(text);
      break;
    } catch (e) {
      if (attempts === 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * attempts));
    }
  }

  const voice = voiceData!.voice as Record<string, unknown>;
  const visual = voiceData!.visual as Record<string, unknown>;
  const productsMeta = voiceData!.products as Record<string, unknown>;

  await db.brandProfile.upsert({
    where: { shopId },
    create: {
      shopId,
      voiceJson: JSON.stringify(voice),
      visualJson: JSON.stringify(visual),
      productJson: JSON.stringify(productsMeta),
    },
    update: {
      voiceJson: JSON.stringify(voice),
      visualJson: JSON.stringify(visual),
      productJson: JSON.stringify(productsMeta),
    },
  });
}
