import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
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
  Banner,
  Box,
  Divider,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { enqueueJob } from "../lib/job-queue.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true },
  });
  if (!shop) return json({ videos: [], plan: null, hasVideoPlan: false });

  const videos = await db.asset.findMany({
    where: { shopId: shop.id, type: "VIDEO_AD" },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const plan = shop.activePlan;
  const hasVideoPlan = !!plan && plan.videoQuota > 0;

  return json({
    videos,
    plan: plan
      ? { videoQuota: plan.videoQuota, videoUsed: plan.videoUsed, videoCredits: plan.videoCredits }
      : null,
    hasVideoPlan,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent") as string;

  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true, brandProfile: true },
  });
  if (!shop) return json({ error: "Shop not found" });

  if (intent === "generate" || intent === "regenerate") {
    if (!shop.brandProfile) {
      return json({ error: "Analyze your store first (on the dashboard) so videos match your brand." });
    }
    if (!shop.activePlan || shop.activePlan.videoQuota <= 0) {
      return json({ error: "Video generation needs the Pro or Scale plan. Upgrade on the Plans page." });
    }

    const productTitle = (form.get("productTitle") as string)?.trim();
    const style = (form.get("style") as string) || "PRODUCT_HIGHLIGHT";
    const customPrompt = (form.get("customPrompt") as string)?.trim() || undefined;
    if (!productTitle) return json({ error: "Give your video a product or subject." });

    await enqueueJob(shop.id, "GENERATE_VIDEO_AD", {
      productTitle,
      style,
      customPrompt,
    });
    return json({ ok: true, queued: true });
  }

  const assetId = form.get("assetId") as string;
  if (intent === "approve") {
    await db.asset.update({ where: { id: assetId }, data: { status: "APPROVED" } });
  } else if (intent === "reject") {
    await db.asset.update({ where: { id: assetId }, data: { status: "REJECTED" } });
  }
  return json({ ok: true });
};

const STYLE_OPTIONS = [
  { label: "Product highlight — dynamic showcase reel", value: "PRODUCT_HIGHLIGHT" },
  { label: "AI avatar — UGC-style spokesperson", value: "AI_AVATAR" },
];

export default function Videos() {
  const { videos, plan, hasVideoPlan } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const [productTitle, setProductTitle] = useState("");
  const [style, setStyle] = useState("PRODUCT_HIGHLIGHT");
  const [customPrompt, setCustomPrompt] = useState("");

  const generate = (intent: "generate" | "regenerate", seed?: { title: string; style: string; prompt: string }) => {
    submit(
      {
        intent,
        productTitle: seed?.title ?? productTitle,
        style: seed?.style ?? style,
        customPrompt: seed?.prompt ?? customPrompt,
      },
      { method: "post" }
    );
  };

  if (!hasVideoPlan) {
    return (
      <Page title="Video Studio" backAction={{ content: "Home", url: "/app" }}>
        <EmptyState
          heading="Video generation is a Pro feature"
          image=""
          action={{ content: "See plans", url: "/app/plans" }}
        >
          <p>Upgrade to Pro or Scale to generate AI product videos — avatars or highlight reels — from your catalog.</p>
        </EmptyState>
      </Page>
    );
  }

  const remaining = plan ? plan.videoQuota - plan.videoUsed + plan.videoCredits : 0;

  return (
    <Page
      title="Video Studio"
      backAction={{ content: "Home", url: "/app" }}
      subtitle="Write a prompt, pick a style, and generate scroll-stopping product videos."
    >
      <Layout>
        <Layout.Section>
          <InlineStack gap="200">
            <Badge tone="success">{`${remaining} videos left this month`}</Badge>
            {plan && plan.videoCredits > 0 && (
              <Badge>{`+${plan.videoCredits} credit videos`}</Badge>
            )}
          </InlineStack>
        </Layout.Section>

        {/* Generation / prompting studio */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Create a video</Text>

              <TextField
                label="Product or subject"
                value={productTitle}
                onChange={setProductTitle}
                autoComplete="off"
                placeholder="e.g. Blue Razz Gummy Worms"
                helpText="What's the video about?"
              />

              <Select
                label="Style"
                options={STYLE_OPTIONS}
                value={style}
                onChange={setStyle}
              />

              <TextField
                label="Prompt / script (optional)"
                value={customPrompt}
                onChange={setCustomPrompt}
                multiline={4}
                autoComplete="off"
                placeholder={
                  style === "AI_AVATAR"
                    ? "What should the avatar say? e.g. 'These gummy worms are unreal — sour, sweet, and gone in seconds…'"
                    : "Describe the shots/vibe. e.g. 'Slow-mo close-ups, bright candy colors, playful energy, upbeat feel'"
                }
                helpText="Leave blank and we'll write it from your brand voice — or take full control here."
              />

              <InlineStack>
                <Button
                  variant="primary"
                  onClick={() => generate("generate")}
                  loading={busy}
                  disabled={!productTitle.trim()}
                >
                  Generate video
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Library */}
        <Layout.Section>
          {videos.length === 0 ? (
            <Card>
              <Box padding="400">
                <Text as="p" tone="subdued" alignment="center">
                  No videos yet — create your first one above.
                </Text>
              </Box>
            </Card>
          ) : (
            <BlockStack gap="400">
              {videos.map((v) => {
                const body = JSON.parse(v.bodyJson);
                const meta = JSON.parse(v.metaJson);
                const pendingProvider = body.status === "awaiting_video_provider";
                return (
                  <Card key={v.id}>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="050">
                          <Text variant="headingSm" as="h3">{v.title}</Text>
                          <InlineStack gap="200">
                            <Badge>{(meta.style || "PRODUCT_HIGHLIGHT").replace(/_/g, " ")}</Badge>
                            <Badge tone={v.status === "APPROVED" ? "success" : v.status === "REJECTED" ? "critical" : "warning"}>
                              {v.status}
                            </Badge>
                          </InlineStack>
                        </BlockStack>
                      </InlineStack>

                      {body.videoUrl ? (
                        <video
                          src={body.videoUrl}
                          controls
                          style={{ width: "100%", maxWidth: 320, borderRadius: 12 }}
                        />
                      ) : (
                        <Banner tone={pendingProvider ? "info" : "warning"}>
                          <p>
                            {pendingProvider
                              ? "Queued — connect a video provider to render this. Your prompt & style are saved."
                              : "Rendering…"}
                          </p>
                        </Banner>
                      )}

                      {body.prompt && (
                        <>
                          <Divider />
                          <Text variant="bodySm" as="p" tone="subdued">
                            <strong>Prompt:</strong> {body.prompt}
                          </Text>
                        </>
                      )}

                      <InlineStack gap="200">
                        <Button
                          size="slim"
                          onClick={() =>
                            generate("regenerate", {
                              title: v.title || meta.productTitle || "",
                              style: meta.style || "PRODUCT_HIGHLIGHT",
                              prompt: body.prompt || "",
                            })
                          }
                          loading={busy}
                        >
                          Regenerate
                        </Button>
                        {v.status === "PENDING" && (
                          <>
                            <Button
                              size="slim"
                              variant="primary"
                              onClick={() => submit({ intent: "approve", assetId: v.id }, { method: "post" })}
                            >
                              Approve
                            </Button>
                            <Button
                              size="slim"
                              tone="critical"
                              onClick={() => submit({ intent: "reject", assetId: v.id }, { method: "post" })}
                            >
                              Reject
                            </Button>
                          </>
                        )}
                      </InlineStack>
                    </BlockStack>
                  </Card>
                );
              })}
            </BlockStack>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
