import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "@remix-run/react";
import { useState } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  TextField,
  Box,
  Divider,
  Banner,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { generateProductCopy, type ProductCopy } from "../lib/product-copy.server";
import { chargeTokens, tokensRemaining, InsufficientTokensError } from "../lib/tokens.server";
import { TOKEN_COST } from "../lib/plan-config";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { brandProfile: true, activePlan: true },
  });
  const tokens = shop?.activePlan
    ? { remaining: tokensRemaining(shop.activePlan), included: shop.activePlan.tokensIncluded }
    : null;

  // Pull the store catalog so the merchant can pick a product instead of
  // typing a name. read_products, via the request (online) token.
  let products: { title: string; image: string | null; description: string }[] = [];
  try {
    const res = await admin.graphql(
      `{ products(first: 40, sortKey: UPDATED_AT, reverse: true) {
        edges { node { title featuredImage { url } description(truncateAt: 220) } }
      } }`
    );
    const j = (await res.json()) as {
      data?: { products?: { edges?: { node: { title: string; featuredImage?: { url?: string }; description?: string } }[] } };
    };
    products = (j.data?.products?.edges || []).map((e) => ({
      title: e.node.title,
      image: e.node.featuredImage?.url || null,
      description: e.node.description || "",
    }));
  } catch {
    /* non-fatal — falls back to manual entry */
  }

  return json({ hasBrand: !!shop?.brandProfile, products, tokens, cost: TOKEN_COST.description });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { brandProfile: true, activePlan: true },
  });
  if (!shop?.brandProfile) return json({ error: "Analyze your store on the dashboard first." });
  if (!shop.activePlan) return json({ error: "Choose a plan first to get tokens.", outOfTokens: true });

  const cost = TOKEN_COST.description;
  if (tokensRemaining(shop.activePlan) < cost) {
    return json({
      error: `Not enough tokens — this needs ${cost}, you have ${tokensRemaining(shop.activePlan)}. Top up on the Plans page.`,
      outOfTokens: true,
    });
  }

  const form = await request.formData();
  const productName = (form.get("productName") as string)?.trim();
  const notes = (form.get("notes") as string)?.trim() || "";
  if (!productName) return json({ error: "Enter a product name." });
  try {
    const copy = await generateProductCopy(shop.brandProfile, productName, notes);
    // Only charge on success.
    const { remaining } = await chargeTokens(shop.id, "description");
    return json({ copy, remaining });
  } catch (e) {
    if (e instanceof InsufficientTokensError) return json({ error: e.message, outOfTokens: true });
    return json({ error: e instanceof Error ? e.message : String(e) });
  }
};

export default function Products() {
  const { hasBrand, products, tokens, cost } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const outOfTokens = actionData && "outOfTokens" in actionData && actionData.outOfTokens;
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const copy = actionData && "copy" in actionData ? (actionData.copy as ProductCopy) : null;
  const error = actionData && "error" in actionData ? actionData.error : null;

  const [productName, setProductName] = useState("");
  const [notes, setNotes] = useState("");

  const pick = (p: { title: string; description: string }) => {
    setProductName(p.title);
    setNotes(p.description?.slice(0, 300) || "");
  };

  const generate = () => submit({ productName, notes }, { method: "post" });

  if (!hasBrand) {
    return (
      <Page title="AI Product Descriptions" backAction={{ content: "Home", url: "/app" }}>
        <EmptyState heading="Analyze your store first" image="" action={{ content: "Go to dashboard", url: "/app" }}>
          <p>We learn your brand voice first, so every description sounds like you.</p>
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page
      title="AI Product Descriptions"
      backAction={{ content: "Home", url: "/app" }}
      subtitle="SEO-ready product copy in your brand voice — descriptions, bullets, and meta tags."
    >
      <Layout>
        {products.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Pick a product</Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  Tap a product from your store to auto-fill it — or type a name below.
                </Text>
                <div className="mm-prodgrid">
                  {products.map((p) => {
                    const selected = p.title === productName;
                    return (
                      <button
                        key={p.title}
                        type="button"
                        className={`mm-prodcard${selected ? " on" : ""}`}
                        onClick={() => pick(p)}
                      >
                        {p.image ? (
                          <img src={p.image} alt="" loading="lazy" />
                        ) : (
                          <div className="mm-prodph">🛍️</div>
                        )}
                        <span className="mm-prodtitle">{p.title}</span>
                      </button>
                    );
                  })}
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <TextField
                label="Product name"
                value={productName}
                onChange={setProductName}
                autoComplete="off"
                placeholder="e.g. Blue Razz Gummy Worms"
                helpText={products.length > 0 ? "Picked from your store above, or type your own." : undefined}
              />
              <TextField
                label="Notes (optional)"
                value={notes}
                onChange={setNotes}
                autoComplete="off"
                multiline={2}
                placeholder="Key features, ingredients, who it's for, what makes it special…"
              />
              <InlineStack gap="300" blockAlign="center">
                <Button
                  variant="primary"
                  onClick={generate}
                  loading={busy}
                  disabled={!productName.trim() || (tokens != null && tokens.remaining < cost)}
                >
                  Generate copy
                </Button>
                {tokens != null && (
                  <Badge tone={tokens.remaining < cost ? "critical" : "info"}>
                    {`⚡ ${cost} token${cost > 1 ? "s" : ""} · ${tokens.remaining} left`}
                  </Badge>
                )}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {error && (
          <Layout.Section>
            <Banner
              tone={outOfTokens ? "critical" : "warning"}
              title={outOfTokens ? "Out of tokens" : "Couldn't generate copy"}
              action={outOfTokens ? { content: "Top up tokens", url: "/app/plans" } : undefined}
            >
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {copy && (
          <>
            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">SEO meta</Text>
                  <BlockStack gap="100">
                    <Text variant="bodySm" as="p" tone="subdued">Title tag</Text>
                    <Text variant="bodyMd" as="p" fontWeight="semibold">{copy.seoTitle}</Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text variant="bodySm" as="p" tone="subdued">Meta description</Text>
                    <Text variant="bodyMd" as="p">{copy.metaDescription}</Text>
                  </BlockStack>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <InlineStack gap="400" wrap>
                {copy.descriptions.map((d, i) => (
                  <Box key={i} minWidth="320px" maxWidth="420px">
                    <Card>
                      <BlockStack gap="200">
                        <Badge>{`Variant ${i + 1}`}</Badge>
                        <Text variant="bodyMd" as="p">{d}</Text>
                      </BlockStack>
                    </Card>
                  </Box>
                ))}
              </InlineStack>
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">Selling points</Text>
                  {copy.bullets.map((b) => (
                    <Text key={b} variant="bodyMd" as="p">• {b}</Text>
                  ))}
                </BlockStack>
              </Card>
            </Layout.Section>
          </>
        )}
      </Layout>
    </Page>
  );
}
