import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  DataTable,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import * as meta from "../lib/meta-ads.server";
import * as tiktok from "../lib/tiktok-ads.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: {
      campaigns: {
        include: {
          adAccount: true,
          metrics: { orderBy: { recordedAt: "desc" }, take: 1 },
          asset: { select: { title: true, type: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return json({ campaigns: shop?.campaigns || [] });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const campaignId = formData.get("campaignId") as string;

  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: { adAccount: true },
  });
  if (!campaign?.externalId) return json({ ok: false });

  if (intent === "activate") {
    if (campaign.platform === "META") {
      await meta.activateCampaign(campaign.externalId, campaign.adAccount.accessToken);
    } else {
      await tiktok.activateCampaign(
        campaign.adAccount.externalId,
        campaign.externalId,
        campaign.adAccount.accessToken
      );
    }
    await db.campaign.update({ where: { id: campaignId }, data: { status: "ACTIVE" } });
  } else if (intent === "pause") {
    if (campaign.platform === "META") {
      await meta.pauseCampaign(campaign.externalId, campaign.adAccount.accessToken);
    } else {
      await tiktok.pauseCampaign(
        campaign.adAccount.externalId,
        campaign.externalId,
        campaign.adAccount.accessToken
      );
    }
    await db.campaign.update({ where: { id: campaignId }, data: { status: "PAUSED" } });
  }

  return json({ ok: true });
};

const STATUS_TONE: Record<string, "success" | "warning" | "critical" | "info"> = {
  ACTIVE: "success",
  PAUSED: "warning",
  KILLED: "critical",
  DRAFT: "info",
  COMPLETED: "info",
};

export default function Campaigns() {
  const { campaigns } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  if (campaigns.length === 0) {
    return (
      <Page title="Campaigns" backAction={{ content: "Home", url: "/app" }}>
        <EmptyState heading="No campaigns yet" image="">
          <p>Approve content in the Content Queue, then launch it as a campaign.</p>
          <Button url="/app/assets" variant="primary">Go to Content Queue</Button>
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page title="Campaigns" backAction={{ content: "Home", url: "/app" }} subtitle="All campaigns are created paused — activate when ready.">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="0">
              {campaigns.map((c) => {
                const metric = c.metrics[0];
                return (
                  <div
                    key={c.id}
                    style={{ padding: "16px", borderBottom: "1px solid #e1e3e5" }}
                  >
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text variant="bodyMd" as="p" fontWeight="semibold">
                          {c.asset.title} — {c.platform}
                        </Text>
                        <InlineStack gap="200">
                          <Badge tone={STATUS_TONE[c.status] || "info"}>{c.status}</Badge>
                          <Text variant="bodySm" as="span" tone="subdued">
                            Budget: ${(c.budgetCents / 100).toFixed(2)}/wk
                          </Text>
                          {metric && (
                            <>
                              <Text variant="bodySm" as="span" tone="subdued">
                                Spend: ${(metric.spendCents / 100).toFixed(2)}
                              </Text>
                              <Text variant="bodySm" as="span" tone="subdued">
                                ROAS: {metric.roas.toFixed(2)}x
                              </Text>
                              <Text variant="bodySm" as="span" tone="subdued">
                                Conv: {metric.conversions}
                              </Text>
                            </>
                          )}
                        </InlineStack>
                      </BlockStack>

                      <InlineStack gap="200">
                        {c.status === "PAUSED" && (
                          <Button
                            size="slim"
                            variant="primary"
                            onClick={() =>
                              submit({ intent: "activate", campaignId: c.id }, { method: "post" })
                            }
                          >
                            Activate
                          </Button>
                        )}
                        {c.status === "ACTIVE" && (
                          <Button
                            size="slim"
                            onClick={() =>
                              submit({ intent: "pause", campaignId: c.id }, { method: "post" })
                            }
                          >
                            Pause
                          </Button>
                        )}
                      </InlineStack>
                    </InlineStack>
                  </div>
                );
              })}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
