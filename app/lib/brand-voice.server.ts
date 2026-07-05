import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db.server";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface ShopifyProduct {
  title: string;
  description: string;
  productType: string;
  priceRange: { minVariantPrice: { amount: string } };
  featuredImage?: { url: string } | null;
}

interface ShopifyStorefront {
  name: string;
  description: string;
  primaryDomain: { url: string };
}

// A GraphQL runner that returns the `data` object (or throws a clear error).
// Injected by the caller so we can use either the authenticated admin client
// (dashboard) or a stored-token fetch (background worker).
export type GraphQLRunner = (query: string) => Promise<any>;

const STORE_QUERY = `{
  shop {
    name
    description
    primaryDomain { url }
  }
  products(first: 20, sortKey: UPDATED_AT, reverse: true) {
    edges {
      node {
        title
        description(truncateAt: 300)
        productType
        priceRange { minVariantPrice { amount } }
        featuredImage { url }
      }
    }
  }
}`;

async function fetchStoreContent(
  graphql: GraphQLRunner
): Promise<{ storefront: ShopifyStorefront; products: ShopifyProduct[] }> {
  const data = await graphql(STORE_QUERY);
  if (!data || !data.shop) {
    throw new Error("Shopify returned no store data — check app scopes are approved.");
  }
  return {
    storefront: data.shop,
    products: (data.products?.edges || []).map((e: { node: ShopifyProduct }) => e.node),
  };
}

function safeParseJSON(text: string): Record<string, unknown> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in response");
  return JSON.parse(match[0]);
}

export async function generateBrandProfile(
  shopId: string,
  graphql: GraphQLRunner
): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "The server is missing ANTHROPIC_API_KEY. Add it in Render → your service → Environment, then redeploy."
    );
  }

  const { storefront, products } = await fetchStoreContent(graphql);

  const productSummary = products
    .map((p) => `${p.title} (${p.productType || "General"}, $${parseFloat(p.priceRange.minVariantPrice.amount).toFixed(2)}): ${p.description?.slice(0, 150) || ""}`)
    .join("\n");

  const prices = products.map((p) =>
    parseFloat(p.priceRange.minVariantPrice.amount)
  );
  const avgPrice = prices.length
    ? prices.reduce((a, b) => a + b, 0) / prices.length
    : 0;

  const hasProducts = products.length > 0;
  const productBlock = hasProducts
    ? `Top products:\n${productSummary}`
    : `This store has no products listed yet. Infer a sensible brand direction from the store name and description alone, and keep it flexible — the merchant will add products soon.`;

  const prompt = `You are a brand strategist analyzing a Shopify store to build a brand intelligence profile for AI-driven marketing.

Store: ${storefront.name}
Description: ${storefront.description || "N/A"}
URL: ${storefront.primaryDomain?.url || ""}

${productBlock}

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
      if (attempts === 3) {
        const detail = e instanceof Error ? e.message : String(e);
        const status = (e as { status?: number })?.status;
        throw new Error(
          `Couldn't reach the AI service (${detail}${status ? `, status ${status}` : ""}). ` +
            `This usually means ANTHROPIC_API_KEY is missing or invalid on the server.`
        );
      }
      await new Promise((r) => setTimeout(r, 1000 * attempts));
    }
  }

  const voice = voiceData!.voice as Record<string, unknown>;
  const visual = voiceData!.visual as Record<string, unknown>;
  const productsMeta = voiceData!.products as Record<string, unknown>;

  // Attach real store graphics so the dashboard can render the merchant's
  // actual brand, not generic placeholders.
  const productImages = products
    .map((p) => p.featuredImage?.url)
    .filter((u): u is string => !!u)
    .slice(0, 8);

  const enrichedVisual = {
    ...visual,
    productImages,
  };
  const enrichedProducts = {
    ...productsMeta,
    storeName: storefront.name,
    storeUrl: storefront.primaryDomain?.url || null,
    productCount: products.length,
  };

  await db.brandProfile.upsert({
    where: { shopId },
    create: {
      shopId,
      voiceJson: JSON.stringify(voice),
      visualJson: JSON.stringify(enrichedVisual),
      productJson: JSON.stringify(enrichedProducts),
    },
    update: {
      voiceJson: JSON.stringify(voice),
      visualJson: JSON.stringify(enrichedVisual),
      productJson: JSON.stringify(enrichedProducts),
    },
  });
}
