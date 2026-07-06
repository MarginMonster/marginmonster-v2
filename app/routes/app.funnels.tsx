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
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { brandProfile: true, landingPages: { orderBy: { createdAt: "desc" } } },
  });
  return json({
    hasBrand: !!shop?.brandProfile,
    pages: shop?.landingPages ?? [],
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
    if (!productName) return json({ error: "Enter a product name." });
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
  { label: "Drive a purchase", value: "BUY" },
  { label: "Launch / pre-orders", value: "LAUNCH" },
  { label: "Capture leads (email)", value: "LEAD" },
];

export default function Funnels() {
  const { hasBrand, pages, appUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const error = actionData && "error" in actionData ? actionData.error : null;

  const [productName, setProductName] = useState("");
  const [goal, setGoal] = useState("BUY");

  const create = () => submit({ intent: "create", productName, goal }, { method: "post" });

  if (!hasBrand) {
    return (
      <Page title="Landing Pages" backAction={{ content: "Home", url: "/app" }}>
        <EmptyState heading="Analyze your store first" image="" action={{ content: "Go to dashboard", url: "/app" }}>
          <p>We build landing pages in your brand voice — analyze your store first.</p>
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page
      title="Landing Pages"
      backAction={{ content: "Home", url: "/app" }}
      subtitle="Instant, hosted landing pages for your products and campaigns — perfect for ad traffic."
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Create a landing page</Text>
              <TextField
                label="Product or offer"
                value={productName}
                onChange={setProductName}
                autoComplete="off"
                placeholder="e.g. Mystery Snack Box"
              />
              <Select label="Goal" options={GOALS} value={goal} onChange={setGoal} />
              <InlineStack>
                <Button variant="primary" onClick={create} loading={busy} disabled={!productName.trim()}>
                  Generate landing page
                </Button>
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
