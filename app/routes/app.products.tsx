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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { brandProfile: true },
  });
  return json({ hasBrand: !!shop?.brandProfile });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { brandProfile: true },
  });
  if (!shop?.brandProfile) return json({ error: "Analyze your store on the dashboard first." });
  const form = await request.formData();
  const productName = (form.get("productName") as string)?.trim();
  const notes = (form.get("notes") as string)?.trim() || "";
  if (!productName) return json({ error: "Enter a product name." });
  try {
    const copy = await generateProductCopy(shop.brandProfile, productName, notes);
    return json({ copy });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) });
  }
};

export default function Products() {
  const { hasBrand } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const copy = actionData && "copy" in actionData ? (actionData.copy as ProductCopy) : null;
  const error = actionData && "error" in actionData ? actionData.error : null;

  const [productName, setProductName] = useState("");
  const [notes, setNotes] = useState("");

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
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <TextField
                label="Product name"
                value={productName}
                onChange={setProductName}
                autoComplete="off"
                placeholder="e.g. Blue Razz Gummy Worms"
              />
              <TextField
                label="Notes (optional)"
                value={notes}
                onChange={setNotes}
                autoComplete="off"
                multiline={2}
                placeholder="Key features, ingredients, who it's for, what makes it special…"
              />
              <InlineStack>
                <Button variant="primary" onClick={generate} loading={busy} disabled={!productName.trim()}>
                  Generate copy
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {error && (
          <Layout.Section>
            <Banner tone="warning" title="Couldn't generate copy"><p>{error}</p></Banner>
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
