import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  Divider,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { getContentCalendar } from "../lib/calendar.server";

const TYPE_LABEL: Record<string, string> = {
  BLOG_POST: "Blog post",
  VIDEO_AD: "Product video",
  IMAGE_AD: "Image ad",
  AD_COPY: "Ad copy",
};
const typeLabel = (t: string) => TYPE_LABEL[t] || t;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return json({ cal: null });
  const cal = await getContentCalendar(shop.id);
  return json({ cal });
};

const typeTone: Record<string, "info" | "success" | "warning"> = {
  BLOG_POST: "info",
  VIDEO_AD: "success",
  IMAGE_AD: "warning",
};

export default function Calendar() {
  const { cal } = useLoaderData<typeof loader>();

  if (!cal || !cal.active) {
    return (
      <Page title="Content Calendar" backAction={{ content: "Home", url: "/app" }}>
        <EmptyState heading="No plan yet" image="" action={{ content: "Choose a plan", url: "/app/plans" }}>
          <p>Pick a plan and we'll schedule your content automatically — this calendar shows what's coming.</p>
        </EmptyState>
      </Page>
    );
  }

  const Row = ({ label, type, title, status }: { label: string; type: string; title?: string; status: string }) => (
    <div>
      <InlineStack gap="400" blockAlign="center" wrap={false}>
        <Box minWidth="120px"><Text variant="bodyMd" as="span" fontWeight="semibold">{label}</Text></Box>
        <Badge tone={typeTone[type] || "info"}>{typeLabel(type)}</Badge>
        <Text variant="bodyMd" as="span" tone="subdued">
          {title || (status === "scheduled" ? "Auto-generated from your catalog" : "Generated")}
        </Text>
      </InlineStack>
      <Box paddingBlock="200"><Divider /></Box>
    </div>
  );

  return (
    <Page
      title="Content Calendar"
      backAction={{ content: "Home", url: "/app" }}
      subtitle={`Publishing on autopilot — a new piece roughly every ${cal.cadenceDays} days.`}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" as="h2">Coming up</Text>
                <Badge tone="success">On schedule</Badge>
              </InlineStack>
              {cal.upcoming.map((s, i) => (
                <Row key={i} label={s.label} type={s.type} status={s.status} />
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>

        {cal.recent.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Recently created</Text>
                {cal.recent.map((s, i) => (
                  <Row key={i} label={s.label} type={s.type} title={s.title} status={s.status} />
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
