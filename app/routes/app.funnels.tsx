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
  Select,
  Box,
  Banner,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { generateLandingContent, slugify } from "../lib/landing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { brandProfile: true, landingPages: { orderBy: { createdAt: "desc" } } },
  });

  // catalog picker — one tap instead of typing product names from memory
  let products: { id: string; title: string; image: string | null }[] = [];
  try {
    const res = await admin.graphql(
      `{ products(first: 24, sortKey: UPDATED_AT, reverse: true) {
        edges { node { id title featuredImage { url } } }
      } }`
    );
    const j = (await res.json()) as {
      data?: { products?: { edges?: { node: { id: string; title: string; featuredImage?: { url?: string } } }[] } };
    };
    products = (j.data?.products?.edges || []).map((e) => ({
      id: e.node.id,
      title: e.node.title,
      image: e.node.featuredImage?.url || null,
    }));
  } catch { /* non-fatal — manual entry still works */ }

  return json({
    hasBrand: !!shop?.brandProfile,
    pages: shop?.landingPages ?? [],
    products,
    appUrl: process.env.SHOPIFY_APP_URL || "",
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { brandProfile: true },
  });
  if (!shop) return json({ error: "Shop not found" });
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "create") {
    if (!shop.brandProfile) return json({ error: "Analyze your store first." });
    const productName = (form.get("productName") as string)?.trim();
    const goal = (form.get("goal") as string) || "BUY";
    if (!productName) return json({ error: "Pick a product or type an offer." });
    try {
      const content = await generateLandingContent(shop.brandProfile, productName, goal);
      await db.landingPage.create({
        data: {
          shopId: shop.id,
          slug: slugify(productName),
          title: content.hero,
          productName,
          goal,
          contentJson: JSON.stringify(content),
          published: true,
        },
      });
      return json({ ok: true });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  const id = form.get("id") as string;
  if (intent === "toggle") {
    const p = await db.landingPage.findUnique({ where: { id } });
    if (p && p.shopId === shop.id) {
      await db.landingPage.update({ where: { id }, data: { published: !p.published } });
    }
  } else if (intent === "delete") {
    const p = await db.landingPage.findUnique({ where: { id } });
    if (p && p.shopId === shop.id) await db.landingPage.delete({ where: { id } });
  }
  return json({ ok: true });
};

const GOALS = [
  { label: "Sell it — straight to checkout", value: "BUY" },
  { label: "Launch hype — pre-orders & waitlist", value: "LAUNCH" },
  { label: "Collect emails — build your list", value: "LEAD" },
];

export default function Funnels() {
  const { hasBrand, pages, products, appUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const error = actionData && "error" in actionData ? actionData.error : null;

  const [productName, setProductName] = useState("");
  const [goal, setGoal] = useState("BUY");

  const productOptions = [
    { label: "Pick from your catalog…", value: "" },
    ...products.map((p) => ({ label: p.title.length > 48 ? p.title.slice(0, 48) + "…" : p.title, value: p.title })),
  ];

  const create = () => submit({ intent: "create", productName, goal }, { method: "post" });

  if (!hasBrand) {
    return (
      <Page title="Landing Pages" backAction={{ content: "SEO Hub", url: "/app/seo" }}>
        <EmptyState heading="Analyze your store first" image="" action={{ content: "Go to dashboard", url: "/app" }}>
          <p>We build landing pages in your brand voice — analyze your store first.</p>
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page title="Landing pages" backAction={{ content: "SEO Hub", url: "/app/seo" }}>
      <Layout>
        <Layout.Section>
          <div className="pp-hero">
            <span className="pp-eyebrow">SEO Hub · Landing pages</span>
            <h1>One product. One page. <em>One job.</em></h1>
            <p className="pp-sub">
              A landing page is a focused mini-site for a single product — headline, story,
              social proof, and one big button. Send your ad clicks and bio links here instead
              of your busy storefront, and more of them buy. We write it, host it, and put it
              live in about a minute.
            </p>
          </div>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Build one now</Text>
              <Select
                label="Your product"
                options={productOptions}
                value={products.some((p) => p.title === productName) ? productName : ""}
                onChange={(v) => v && setProductName(v)}
              />
              <TextField
                label="Or type any product or offer"
                value={productName}
                onChange={setProductName}
                autoComplete="off"
                placeholder='e.g. "Mystery Snack Box" or "Summer Bundle — 20% off"'
              />
              <Select label="What should the page do?" options={GOALS} value={goal} onChange={setGoal} />
              <InlineStack gap="300" blockAlign="center">
                <button
                  type="button"
                  className={`pp-cta-hero${busy ? " busy" : ""}`}
                  onClick={create}
                  disabled={busy || !productName.trim()}
                >
                  {busy ? "🏗 Building your page…" : "✨ Build my page"}
                </button>
                {busy && <Text variant="bodySm" as="span" tone="subdued">Writing headline, story & CTA in your brand voice…</Text>}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {error && (
          <Layout.Section>
            <Banner tone="warning" title="Couldn't create page"><p>{error}</p></Banner>
          </Layout.Section>
        )}

        {pages.length > 0 && (
          <Layout.Section>
            <div className="pp-head">
              <h2>Your pages</h2>
              <span className="pp-sub2">{pages.filter((p) => p.published).length} live · share these links in ads & bios</span>
            </div>
            <Card>
              <BlockStack gap="0">
                {pages.map((p) => {
                  const url = `${appUrl}/lp/${p.slug}`;
                  return (
                    <Box key={p.id} padding="300" borderBlockEndWidth="025" borderColor="border">
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="050">
                          <Text variant="bodyMd" as="p" fontWeight="semibold">{p.title}</Text>
                          <InlineStack gap="200">
                            <Badge tone={p.published ? "success" : undefined}>
                              {p.published ? "Live" : "Draft"}
                            </Badge>
                            <Text variant="bodySm" as="span" tone="subdued">{p.views} views</Text>
                          </InlineStack>
                        </BlockStack>
                        <InlineStack gap="200">
                          <Button size="slim" url={url} external>Preview</Button>
                          <Button size="slim" onClick={() => submit({ intent: "toggle", id: p.id }, { method: "post" })}>
                            {p.published ? "Unpublish" : "Publish"}
                          </Button>
                          <Button size="slim" tone="critical" onClick={() => submit({ intent: "delete", id: p.id }, { method: "post" })}>
                            Delete
                          </Button>
                        </InlineStack>
                      </InlineStack>
                    </Box>
                  );
                })}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
