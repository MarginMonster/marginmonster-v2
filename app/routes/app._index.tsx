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
  DataTable,
  Banner,
  Button,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: {
      brandProfile: true,
      activePlan: true,
      assets: { orderBy: { createdAt: "desc" }, take: 10 },
      campaigns: {
        include: {
          metrics: { orderBy: { recordedAt: "desc" }, take: 1 },
          adAccount: true,
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
      jobs: {
        where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  const pendingAssets = shop?.assets.filter((a) => a.status === "PENDING").length ?? 0;
  const activeJobs = shop?.jobs.length ?? 0;

  return json({ shop, pendingAssets, activeJobs });
};

export default function Dashboard() {
  const { shop, pendingAssets, activeJobs } = useLoaderData<typeof loader>();

  if (!shop) {
    return (
      <Page title="MarginMonster">
        <EmptyState
          heading="Setting up your account..."
          image=""
        >
          <p>Your store is being connected. Refresh in a moment.</p>
        </EmptyState>
      </Page>
    );
  }

  const hasPlan = !!shop.activePlan;
  const hasBrandProfile = !!shop.brandProfile;

  const campaignRows = shop.campaigns.map((c) => {
    const latestMetric = c.metrics[0];
    return [
      c.platform,
      c.status,
      latestMetric ? `$${(latestMetric.spendCents / 100).toFixed(2)}` : "$0",
      latestMetric ? latestMetric.roas.toFixed(2) : "—",
      latestMetric ? latestMetric.conversions.toString() : "0",
    ];
  });

  return (
    <Page
      title="MarginMonster"
      subtitle="AI Marketing Autopilot"
      primaryAction={
        !hasPlan
          ? { content: "Choose a Plan", url: "/app/plans" }
          : { content: "Review Content", url: "/app/assets" }
      }
    >
      <Layout>
        {!hasBrandProfile && (
          <Layout.Section>
            <Banner
              title="Building your brand profile"
              tone="info"
            >
              <p>We're analyzing your store to build your brand voice and visual profile. This takes about a minute.</p>
            </Banner>
          </Layout.Section>
        )}

        {!hasPlan && hasBrandProfile && (
          <Layout.Section>
            <Banner
              title="Pick a marketing goal to start"
              tone="warning"
              action={{ content: "Choose Plan", url: "/app/plans" }}
            >
              <p>Choose one of four autopilot plans and we'll start generating content and campaigns for your store.</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <InlineStack gap="400" wrap>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingMd" as="h3">Active Plan</Text>
                {hasPlan ? (
                  <Badge tone="success">{shop.activePlan!.type.replace(/_/g, " ")}</Badge>
                ) : (
                  <Badge tone="attention">None selected</Badge>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="100">
                <Text variant="headingMd" as="h3">Pending Review</Text>
                <Text variant="heading2xl" as="p">{pendingAssets}</Text>
                <Text variant="bodyMd" as="p" tone="subdued">assets awaiting approval</Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="100">
                <Text variant="headingMd" as="h3">Generating</Text>
                <Text variant="heading2xl" as="p">{activeJobs}</Text>
                <Text variant="bodyMd" as="p" tone="subdued">jobs in queue</Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="100">
                <Text variant="headingMd" as="h3">Active Campaigns</Text>
                <Text variant="heading2xl" as="p">
                  {shop.campaigns.filter((c) => c.status === "ACTIVE").length}
                </Text>
                <Text variant="bodyMd" as="p" tone="subdued">running on Meta / TikTok</Text>
              </BlockStack>
            </Card>
          </InlineStack>
        </Layout.Section>

        {campaignRows.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Recent Campaigns</Text>
                <DataTable
                  columnContentTypes={["text", "text", "numeric", "numeric", "numeric"]}
                  headings={["Platform", "Status", "Spend", "ROAS", "Conversions"]}
                  rows={campaignRows}
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
