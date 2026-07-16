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
  Badge,
  Button,
  Thumbnail,
  DataTable,
  Tabs,
  EmptyState,
  Modal,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { enqueueJob } from "../lib/job-queue.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true },
  });
  if (!shop) return json({ assets: [], hasPlan: false });

  const assets = await db.asset.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return json({ assets, hasPlan: !!shop.activePlan });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const assetId = formData.get("assetId") as string;

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) throw new Error("Shop not found");

  if (intent === "approve") {
    await db.asset.update({ where: { id: assetId }, data: { status: "APPROVED" } });
  } else if (intent === "reject") {
    await db.asset.update({ where: { id: assetId }, data: { status: "REJECTED" } });
  } else if (intent === "launch") {
    const platform = formData.get("platform") as "META" | "TIKTOK";
    const plan = await db.plan.findUnique({ where: { shopId: shop.id } });
    await enqueueJob(shop.id, "LAUNCH_CAMPAIGN", {
      assetId,
      platform,
      weeklyBudgetCents: Math.round((plan?.weeklyBudget || 100) * 100),
    });
  }

  return json({ ok: true });
};

const STATUS_BADGES: Record<string, { tone: "success" | "warning" | "critical" | "info"; label: string }> = {
  PENDING: { tone: "warning", label: "Pending Review" },
  APPROVED: { tone: "success", label: "Approved" },
  REJECTED: { tone: "critical", label: "Rejected" },
  PUBLISHED: { tone: "info", label: "Published" },
  FAILED: { tone: "critical", label: "Failed" },
};

export default function Assets() {
  const { assets, hasPlan } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [selectedTab, setSelectedTab] = useState(0);
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [previewAsset, setPreviewAsset] = useState<typeof assets[0] | null>(null);

  const tabs = [
    { id: "pending", content: `Pending (${assets.filter((a) => a.status === "PENDING").length})` },
    { id: "approved", content: "Approved" },
    { id: "published", content: "Published" },
    { id: "all", content: "All" },
  ];

  // content types live in separate drawers — nobody scrolls past 20 videos to
  // find a blog post
  const TYPE_TABS: [string, string][] = [
    ["ALL", "All"], ["VIDEO_AD", "🎬 Videos"], ["IMAGE_AD", "🖼 Images"], ["BLOG_POST", "📰 Blogs"], ["AD_COPY", "✍ Ad copy"],
  ];
  const countOf = (t: string) => assets.filter((a) => a.type === t).length;

  const tabStatuses = ["PENDING", "APPROVED", "PUBLISHED", null];
  const filtered = (tabStatuses[selectedTab]
    ? assets.filter((a) => a.status === tabStatuses[selectedTab])
    : assets
  ).filter((a) => typeFilter === "ALL" || a.type === typeFilter);

  if (!hasPlan) {
    return (
      <Page title="Content Queue" backAction={{ content: "Home", url: "/app" }}>
        <EmptyState heading="No plan selected yet" image="">
          <p>Choose a marketing plan first and we'll start generating content automatically.</p>
          <Button url="/app/plans" variant="primary">Choose Plan</Button>
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page title="Content Queue" backAction={{ content: "Home", url: "/app" }} subtitle="Review and approve AI-generated content before it goes live.">
      <Layout>
        <Layout.Section>
          <Card>
            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
              <Box paddingBlockStart="300" paddingBlockEnd="200" paddingInlineStart="300">
                <div className="mm-filter-chips">
                  {TYPE_TABS.map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      className={`mm-chip mm-filter-chip${typeFilter === val ? " on" : ""}`}
                      onClick={() => setTypeFilter(val)}
                    >
                      {label}{val !== "ALL" ? ` (${countOf(val)})` : ""}
                    </button>
                  ))}
                </div>
              </Box>
              <BlockStack gap="0">
                {filtered.length === 0 ? (
                  <Box padding="800">
                    <Text variant="bodyMd" as="p" tone="subdued" alignment="center">
                      No content here yet. Generate content by adding products or connecting ad accounts.
                    </Text>
                  </Box>
                ) : (
                  filtered.map((asset) => {
                    const body = JSON.parse(asset.bodyJson);
                    const badgeConfig = STATUS_BADGES[asset.status] || STATUS_BADGES.PENDING;
                    return (
                      <Box key={asset.id} padding="400" borderBlockEndWidth="025" borderColor="border">
                        <InlineStack align="space-between" blockAlign="center">
                          <InlineStack gap="400" blockAlign="center">
                            {asset.type === "IMAGE_AD" && body.imageUrl && (
                              <Thumbnail source={body.imageUrl} alt={asset.title || ""} size="small" />
                            )}
                            <BlockStack gap="100">
                              <Text variant="bodyMd" as="p" fontWeight="semibold">{asset.title}</Text>
                              <InlineStack gap="200">
                                <Badge>{asset.type.replace(/_/g, " ")}</Badge>
                                <Badge tone={badgeConfig.tone}>{badgeConfig.label}</Badge>
                              </InlineStack>
                            </BlockStack>
                          </InlineStack>

                          <InlineStack gap="200">
                            <Button size="slim" onClick={() => setPreviewAsset(asset)}>Preview</Button>
                            {asset.status === "PENDING" && (
                              <>
                                <Button
                                  size="slim"
                                  variant="primary"
                                  onClick={() =>
                                    submit({ intent: "approve", assetId: asset.id }, { method: "post" })
                                  }
                                  loading={navigation.state === "submitting"}
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="slim"
                                  tone="critical"
                                  onClick={() =>
                                    submit({ intent: "reject", assetId: asset.id }, { method: "post" })
                                  }
                                >
                                  Reject
                                </Button>
                              </>
                            )}
                            {asset.status === "APPROVED" && (
                              <>
                                <Button
                                  size="slim"
                                  variant="primary"
                                  onClick={() =>
                                    submit(
                                      { intent: "launch", assetId: asset.id, platform: "META" },
                                      { method: "post" }
                                    )
                                  }
                                >
                                  Launch on Meta
                                </Button>
                                <Button
                                  size="slim"
                                  onClick={() =>
                                    submit(
                                      { intent: "launch", assetId: asset.id, platform: "TIKTOK" },
                                      { method: "post" }
                                    )
                                  }
                                >
                                  Launch on TikTok
                                </Button>
                              </>
                            )}
                          </InlineStack>
                        </InlineStack>
                      </Box>
                    );
                  })
                )}
              </BlockStack>
            </Tabs>
          </Card>
        </Layout.Section>
      </Layout>

      {previewAsset && (
        <Modal
          open
          onClose={() => setPreviewAsset(null)}
          title={previewAsset.title || "Preview"}
          size="large"
        >
          <Modal.Section>
            <AssetPreview asset={previewAsset} />
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}

function AssetPreview({ asset }: { asset: { type: string; bodyJson: string } }) {
  const body = JSON.parse(asset.bodyJson);

  if (asset.type === "IMAGE_AD" && body.imageUrl) {
    return (
      <BlockStack gap="400">
        <img src={body.imageUrl} alt="Generated ad" style={{ maxWidth: "100%", borderRadius: 8 }} />
        {body.prompt && (
          <Text variant="bodySm" as="p" tone="subdued">Prompt: {body.prompt}</Text>
        )}
      </BlockStack>
    );
  }

  if (asset.type === "BLOG_POST" && body.html) {
    return (
      <div
        style={{ fontFamily: "sans-serif", lineHeight: 1.6 }}
        dangerouslySetInnerHTML={{ __html: body.html }}
      />
    );
  }

  if (asset.type === "AD_COPY") {
    return (
      <BlockStack gap="400">
        <BlockStack gap="200">
          <Text variant="headingMd" as="h3">Headlines</Text>
          {body.headlines?.map((h: string, i: number) => (
            <Card key={i}><Text as="p">{h}</Text></Card>
          ))}
        </BlockStack>
        <BlockStack gap="200">
          <Text variant="headingMd" as="h3">Primary Texts</Text>
          {body.primaryTexts?.map((t: string, i: number) => (
            <Card key={i}><Text as="p">{t}</Text></Card>
          ))}
        </BlockStack>
        <BlockStack gap="200">
          <Text variant="headingMd" as="h3">CTAs</Text>
          <InlineStack gap="200">
            {body.ctas?.map((c: string) => <Badge key={c}>{c}</Badge>)}
          </InlineStack>
        </BlockStack>
      </BlockStack>
    );
  }

  return <Text as="p">{JSON.stringify(body, null, 2)}</Text>;
}

// Missing Box import — add it:
function Box({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) {
  return <div style={{ padding: "16px" }}>{children}</div>;
}
