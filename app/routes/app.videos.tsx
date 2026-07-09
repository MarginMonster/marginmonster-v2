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
  Banner,
  Box,
  Divider,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { enqueueJob } from "../lib/job-queue.server";
import { AVATARS, AVATAR_BY_ID, DIRECTION_CHIPS } from "../lib/avatars";

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
    const avatarId = ((form.get("avatarId") as string) || "").trim() || undefined;
    // Cast selection drives the style: a presenter = avatar video, none = showcase.
    const style = avatarId ? "AI_AVATAR" : "PRODUCT_HIGHLIGHT";
    const customPrompt = (form.get("customPrompt") as string)?.trim() || undefined;
    if (!productTitle) return json({ error: "Give your video a product or subject." });

    await enqueueJob(shop.id, "GENERATE_VIDEO_AD", {
      productTitle,
      style,
      customPrompt,
      avatarId,
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

export default function Videos() {
  const { videos, plan, hasVideoPlan } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const [productTitle, setProductTitle] = useState("");
  const [avatarId, setAvatarId] = useState<string>(""); // "" = product only
  const [customPrompt, setCustomPrompt] = useState("");

  const insertChip = (chip: string) =>
    setCustomPrompt((p) => (p.trim() ? `${p.trim()}, ${chip.toLowerCase()}` : chip));

  const generate = (intent: "generate" | "regenerate", seed?: { title: string; avatarId: string; prompt: string }) => {
    submit(
      {
        intent,
        productTitle: seed?.title ?? productTitle,
        avatarId: seed?.avatarId ?? avatarId,
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
          <p>Upgrade to Pro or Scale to generate AI product videos — a full presenter cast or highlight reels — from your catalog.</p>
        </EmptyState>
      </Page>
    );
  }

  const remaining = plan ? plan.videoQuota - plan.videoUsed + plan.videoCredits : 0;
  const selectedAvatar = avatarId ? AVATAR_BY_ID[avatarId] : null;

  return (
    <Page
      title="Video Studio"
      backAction={{ content: "Home", url: "/app" }}
      subtitle="Pick your presenter, direct the shot, and roll camera — ready-to-post videos for TikTok, Reels & Shorts."
    >
      <Layout>
        <Layout.Section>
          <div className="mm-hero">
            <span className="mm-eyebrow">▶ VIDEO STUDIO · DIRECTOR MODE</span>
            <h1><span className="mm-marquee">Lights. Camera. Sales.</span></h1>
            <p>
              Choose a presenter from the cast (or go product-only), add your
              direction, and we'll shoot a scroll-stopping vertical video —
              cut for TikTok, Reels, and Shorts.
            </p>
            <div className="mm-hero-stats">
              <div className="mm-hero-stat">
                <div className="k">VIDEOS LEFT</div>
                <div className="v">{remaining}</div>
              </div>
              <div className="mm-hero-stat">
                <div className="k">NOW CASTING</div>
                <div className="v cyan">{selectedAvatar ? selectedAvatar.name : "PRODUCT ONLY"}</div>
              </div>
            </div>
          </div>
        </Layout.Section>

        {/* CAST SELECT — Zeely-style presenter gallery */}
        <Layout.Section>
          <span className="mm-section-label">▶ SELECT YOUR PRESENTER<span className="mm-dots">· · · · ·</span></span>
          <div className="mm-cast-grid">
            <button
              type="button"
              className={`mm-cast mm-cast-none${avatarId === "" ? " on" : ""}`}
              onClick={() => setAvatarId("")}
            >
              <div className="ph">🎬</div>
              <div className="nm">PRODUCT ONLY</div>
              <div className="vb">Showcase reel</div>
            </button>
            {AVATARS.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`mm-cast${avatarId === a.id ? " on" : ""}`}
                onClick={() => setAvatarId(a.id)}
              >
                <img src={`/avatars/${a.id}.jpg`} alt={`${a.name} — ${a.vibe}`} loading="lazy" />
                <div className="nm">{a.name}</div>
                <div className="vb">{a.vibe}</div>
              </button>
            ))}
          </div>
        </Layout.Section>

        {/* Direction booth */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                {selectedAvatar ? `Direct ${selectedAvatar.name}'s shoot` : "Direct your showcase"}
              </Text>

              <TextField
                label="Product or subject"
                value={productTitle}
                onChange={setProductTitle}
                autoComplete="off"
                placeholder="e.g. Blue Razz Gummy Worms"
                helpText="What's the video about?"
              />

              <BlockStack gap="200">
                <TextField
                  label="Your direction (optional)"
                  value={customPrompt}
                  onChange={setCustomPrompt}
                  multiline={3}
                  autoComplete="off"
                  placeholder={
                    selectedAvatar
                      ? `What should ${selectedAvatar.name} do or say? e.g. "opens the bag mid-sentence and reacts to the sour hit"`
                      : 'Describe the shots and vibe. e.g. "slow-mo close-ups, bright candy colors, upbeat energy"'
                  }
                  helpText="Leave blank and we'll direct it from your brand voice — or take the director's chair. Tap a card below to drop in a proven angle."
                />
                <div className="mm-dir-chips">
                  {DIRECTION_CHIPS.map((c) => (
                    <button key={c} type="button" className="mm-chip mm-dir-chip" onClick={() => insertChip(c)}>
                      + {c}
                    </button>
                  ))}
                </div>
              </BlockStack>

              <div className="mm-forge-cta">
                <button
                  type="button"
                  className="mm-arcade-btn"
                  onClick={() => generate("generate")}
                  disabled={busy || !productTitle.trim() || remaining <= 0}
                >
                  {busy ? "ROLLING…" : "▶ ROLL CAMERA"}
                </button>
                <span className={`mm-credits${remaining <= 0 ? " low" : ""}`}>
                  <b>TAKES LEFT</b> 🎬 {remaining}
                </span>
              </div>
              {remaining <= 0 && (
                <Text variant="bodySm" as="p" tone="critical">
                  Out of video takes this period — top up or upgrade on the Plans page.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Library */}
        <Layout.Section>
          {videos.length === 0 ? (
            <Card>
              <Box padding="400">
                <Text as="p" tone="subdued" alignment="center">
                  No videos yet — pick a presenter and roll your first take above.
                </Text>
              </Box>
            </Card>
          ) : (
            <BlockStack gap="400">
              {videos.map((v) => {
                const body = JSON.parse(v.bodyJson);
                const meta = JSON.parse(v.metaJson);
                const pendingProvider = body.status === "awaiting_video_provider";
                const castMember = meta.avatarId ? AVATAR_BY_ID[meta.avatarId] : null;
                return (
                  <Card key={v.id}>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="050">
                          <Text variant="headingSm" as="h3">{v.title}</Text>
                          <InlineStack gap="200" blockAlign="center">
                            {castMember ? (
                              <span className="mm-cast-tag">
                                <img src={`/avatars/${castMember.id}.jpg`} alt="" /> {castMember.name}
                              </span>
                            ) : (
                              <Badge>{(meta.style || "PRODUCT_HIGHLIGHT").replace(/_/g, " ")}</Badge>
                            )}
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
                            <strong>Direction:</strong> {body.prompt}
                          </Text>
                        </>
                      )}

                      <InlineStack gap="200">
                        <Button
                          size="slim"
                          onClick={() =>
                            generate("regenerate", {
                              title: v.title || meta.productTitle || "",
                              avatarId: meta.avatarId || "",
                              prompt: body.prompt || "",
                            })
                          }
                          loading={busy}
                        >
                          Another take
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
