import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  DataTable,
  Box,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { getPerformanceSummary } from "../lib/performance.server";
import { seedDemoData, clearDemoData } from "../lib/demo-seed.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return json({ summary: null });
  const summary = await getPerformanceSummary(shop.id);
  return json({ summary });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return json({ ok: false });
  const intent = (await request.formData()).get("intent");
  if (intent === "seed") await seedDemoData(shop.id);
  if (intent === "clear") await clearDemoData(shop.id);
  return json({ ok: true });
};

const money = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Performance() {
  const { summary } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const nav = useNavigation();
  const seed = () => submit({ intent: "seed" }, { method: "post" });
  const clear = () => submit({ intent: "clear" }, { method: "post" });

  if (!summary || !summary.hasData) {
    return (
      <Page title="Performance & ROI" backAction={{ content: "Home", url: "/app" }}>
        <EmptyState
          heading="No campaign data yet"
          image=""
          action={{ content: "Load sample data", onAction: seed, loading: nav.state !== "idle" }}
        >
          <p>
            Once you launch campaigns, this is where you'll see ad spend,
            revenue, ROI, traffic sources, and conversions — all in one place.
            (Load sample data to preview it.)
          </p>
        </EmptyState>
      </Page>
    );
  }

  const { totals, roi, roas, byPlatform, campaigns } = summary;

  const platformRows = byPlatform.map((p) => [
    p.platform,
    money(p.spendCents),
    money(p.revenueCents),
    `${p.roas.toFixed(2)}x`,
    p.clicks.toLocaleString(),
    p.conversions.toLocaleString(),
  ]);

  const campaignRows = campaigns.map((c) => [
    c.name,
    c.platform,
    c.status,
    money(c.spendCents),
    money(c.revenueCents),
    `${c.roas.toFixed(2)}x`,
    `${c.roi >= 0 ? "+" : ""}${c.roi.toFixed(0)}%`,
    c.conversions.toLocaleString(),
  ]);

  return (
    <Page
      title="Performance & ROI"
      backAction={{ content: "Home", url: "/app" }}
      subtitle="Every dollar in, every dollar out — ad spend, revenue, ROI, traffic, and conversions."
      secondaryActions={[
        { content: "Reload sample data", onAction: seed },
        { content: "Clear sample data", onAction: clear, destructive: true },
      ]}
    >
      <Layout>
        <Layout.Section>
          <div className="mm-score">
            <span className="lbl">HI-SCORE · ROI</span>
            <span className="val">{`${roi >= 0 ? "+" : ""}${roi.toFixed(0)}%`}</span>
          </div>
        </Layout.Section>

        {/* Headline KPIs */}
        <Layout.Section>
          <InlineStack gap="400" wrap>
            <Kpi label="Ad spend" value={money(totals.spendCents)} sub="total invested" />
            <Kpi label="Revenue" value={money(totals.revenueCents)} sub="attributed to ads" tone="green" />
            <Kpi
              label="ROI"
              value={`${roi >= 0 ? "+" : ""}${roi.toFixed(0)}%`}
              sub="return on ad spend"
              tone={roi >= 0 ? "green" : "red"}
            />
            <Kpi label="ROAS" value={`${roas.toFixed(2)}x`} sub="revenue per $1 spent" />
            <Kpi label="Conversions" value={totals.conversions.toLocaleString()} sub="purchases from ads" />
            <Kpi label="Traffic" value={totals.clicks.toLocaleString()} sub="clicks to your store" />
          </InlineStack>
        </Layout.Section>

        {/* Traffic sources */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Traffic sources</Text>
              <Text variant="bodyMd" as="p" tone="subdued">
                Where your visitors and sales are coming from.
              </Text>
              <DataTable
                columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric", "numeric"]}
                headings={["Source", "Spend", "Revenue", "ROAS", "Clicks", "Conversions"]}
                rows={platformRows}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Per-campaign performance */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Campaign performance</Text>
              <DataTable
                columnContentTypes={["text", "text", "text", "numeric", "numeric", "numeric", "numeric", "numeric"]}
                headings={["Campaign", "Source", "Status", "Spend", "Revenue", "ROAS", "ROI", "Conv."]}
                rows={campaignRows}
              />
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "green" | "red" }) {
  const color =
    tone === "green" ? "var(--mm-green, #4B7B4E)" : tone === "red" ? "var(--mm-red, #B3473B)" : "var(--mm-gold-deep, #A87D1E)";
  return (
    <Box minWidth="150px">
      <Card>
        <BlockStack gap="100">
          <Text variant="headingSm" as="h3" tone="subdued">{label}</Text>
          <div style={{ fontFamily: "Poppins, sans-serif", fontSize: 26, fontWeight: 800, color }}>
            {value}
          </div>
          <Text variant="bodySm" as="p" tone="subdued">{sub}</Text>
        </BlockStack>
      </Card>
    </Box>
  );
}
