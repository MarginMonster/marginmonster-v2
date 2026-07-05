import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
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
  Box,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { generateBrandProfile } from "../lib/brand-voice.server";

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
        where: { type: "GENERATE_BRAND_PROFILE" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  const pendingAssets = shop?.assets.filter((a) => a.status === "PENDING").length ?? 0;
  const brandJob = shop?.jobs[0] || null;

  return json({
    shop,
    pendingAssets,
    brandJobStatus: brandJob?.status ?? null,
    brandJobError: brandJob?.lastError ?? null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return json({ error: "Shop not found" });

  // Use the authenticated admin client (fresh session token) rather than a
  // stored token — far more reliable. Build the profile synchronously so any
  // error surfaces immediately instead of sitting silently in the queue.
  const graphql = async (query: string) => {
    const res = await admin.graphql(query);
    const jsonRes = await res.json();
    if (jsonRes.errors) {
      throw new Error("Shopify API: " + JSON.stringify(jsonRes.errors));
    }
    return jsonRes.data;
  };

  try {
    await generateBrandProfile(shop.id, graphql);
    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) });
  }
};

export default function Dashboard() {
  const { shop, pendingAssets, brandJobError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const building = nav.state !== "idle";
  const liveError = (actionData && "error" in actionData ? actionData.error : null) || brandJobError;

  if (!shop) {
    return (
      <Page title="MarginMonster">
        <Card>
          <Text as="p">Connecting your store… refresh in a moment.</Text>
        </Card>
      </Page>
    );
  }

  const hasPlan = !!shop.activePlan;
  const profile = shop.brandProfile;
  const hasBrandProfile = !!profile;

  const voice = profile ? JSON.parse(profile.voiceJson) : null;
  const visual = profile ? JSON.parse(profile.visualJson) : null;
  const productMeta = profile ? JSON.parse(profile.productJson) : null;
  const productImages: string[] = visual?.productImages || [];

  const campaignRows = shop.campaigns.map((c) => {
    const m = c.metrics[0];
    return [
      c.platform,
      c.status,
      m ? `$${(m.spendCents / 100).toFixed(2)}` : "$0",
      m ? m.roas.toFixed(2) : "—",
      m ? m.conversions.toString() : "0",
    ];
  });

  const buildProfile = () => submit({}, { method: "post" });

  return (
    <Page
      primaryAction={{ content: hasPlan ? "Review content" : "View plans", url: hasPlan ? "/app/assets" : "/app/plans" }}
      secondaryActions={hasPlan ? [{ content: "View plans", url: "/app/plans" }] : undefined}
    >
      <Layout>
        {/* Aspirational hero */}
        <Layout.Section>
          <div className="mm-hero">
            <span className="mm-eyebrow">Your marketing, on autopilot</span>
            <h1>Grow your store while you live your life.</h1>
            <p>
              Escape the content grind. MarginMonster studies your brand and
              quietly produces the blogs, videos, and ads that bring customers
              in — so your business grows whether you're working or not.
            </p>
            <a href="/app/plans" className="mm-hero-cta">
              {hasPlan ? "View plans" : "See plans & pricing →"}
            </a>
          </div>
        </Layout.Section>

        {/* Brand profile: the "we understand your store" moment */}
        <Layout.Section>
          {hasBrandProfile ? (
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">
                    We've studied {productMeta?.storeName || "your store"} 🔍
                  </Text>
                  <Button
                    variant="plain"
                    onClick={buildProfile}
                    loading={building}
                  >
                    Re-analyze
                  </Button>
                </InlineStack>

                {voice?.tagline && (
                  <Text variant="headingLg" as="p">
                    “{voice.tagline}”
                  </Text>
                )}

                <InlineStack gap="200" wrap>
                  {voice?.tone && <Badge tone="info">{`Voice: ${voice.tone}`}</Badge>}
                  {visual?.imageStyle && <Badge>{`Look: ${visual.imageStyle}`}</Badge>}
                  {productMeta?.avgPrice != null && (
                    <Badge>{`Avg price: $${Number(productMeta.avgPrice).toFixed(0)}`}</Badge>
                  )}
                </InlineStack>

                {Array.isArray(voice?.values) && voice.values.length > 0 && (
                  <InlineStack gap="200" wrap>
                    {voice.values.map((v: string) => (
                      <Badge key={v} tone="success">{v}</Badge>
                    ))}
                  </InlineStack>
                )}

                {productImages.length > 0 && (
                  <>
                    <Divider />
                    <Text variant="bodySm" as="p" tone="subdued">
                      Pulling from your real products:
                    </Text>
                    <InlineStack gap="200" wrap>
                      {productImages.map((src) => (
                        <img
                          key={src}
                          src={src}
                          alt=""
                          style={{
                            width: 72,
                            height: 72,
                            objectFit: "cover",
                            borderRadius: 10,
                            border: "1px solid var(--mm-line, #E6DCC3)",
                          }}
                        />
                      ))}
                    </InlineStack>
                  </>
                )}
              </BlockStack>
            </Card>
          ) : (
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">
                  Let's get to know your store
                </Text>
                <Text as="p" tone="subdued">
                  We'll analyze your products and existing content to learn your
                  brand voice and visual style — everything we create will sound
                  and look like you. Takes about a minute.
                </Text>
                {liveError && (
                  <Banner tone="warning" title="Last attempt hit a snag">
                    <p>{liveError}</p>
                  </Banner>
                )}
                <Box>
                  <Button variant="primary" onClick={buildProfile} loading={building}>
                    {building ? "Analyzing your store…" : "Analyze my store"}
                  </Button>
                </Box>
              </BlockStack>
            </Card>
          )}
        </Layout.Section>

        {/* Next-step nudge */}
        {!hasPlan && hasBrandProfile && (
          <Layout.Section>
            <Banner
              title="You're one click from hands-free marketing"
              tone="success"
              action={{ content: "Choose your plan", url: "/app/plans" }}
            >
              <p>
                Pick an engine and we'll start producing content for your store
                automatically. Cancel anytime.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {/* Stats */}
        <Layout.Section>
          <InlineStack gap="400" wrap>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingMd" as="h3">Active plan</Text>
                {hasPlan ? (
                  <Badge tone="success">{shop.activePlan!.type.replace(/_/g, " ")}</Badge>
                ) : (
                  <Badge tone="attention">None yet</Badge>
                )}
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingMd" as="h3">Awaiting review</Text>
                <Text variant="heading2xl" as="p">{pendingAssets}</Text>
                <Text variant="bodyMd" as="p" tone="subdued">pieces of content</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingMd" as="h3">Live campaigns</Text>
                <Text variant="heading2xl" as="p">
                  {shop.campaigns.filter((c) => c.status === "ACTIVE").length}
                </Text>
                <Text variant="bodyMd" as="p" tone="subdued">on Meta / TikTok</Text>
              </BlockStack>
            </Card>
          </InlineStack>
        </Layout.Section>

        {/* Trust / palms-raised band */}
        <Layout.Section>
          <div className="mm-trust">
            <div className="mm-trust-item">
              <div className="mm-trust-icon">⏱️</div>
              <strong>Hours back every week</strong>
              <span>Content that used to take days is handled while you sleep.</span>
            </div>
            <div className="mm-trust-item">
              <div className="mm-trust-icon">📈</div>
              <strong>Grounded in real data</strong>
              <span>Every post and ad is built from your actual products — never generic.</span>
            </div>
            <div className="mm-trust-item">
              <div className="mm-trust-icon">🤝</div>
              <strong>You're always in control</strong>
              <span>Review before anything publishes, or let it run. Your call, anytime.</span>
            </div>
          </div>
        </Layout.Section>

        <Layout.Section>
          <div className="mm-quote">
            “The best time to plant a tree was 20 years ago. The second best time
            is now.” — start growing today.
          </div>
        </Layout.Section>

        {campaignRows.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Recent campaigns</Text>
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
