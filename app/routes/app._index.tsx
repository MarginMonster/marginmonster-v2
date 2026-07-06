import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData, Link } from "@remix-run/react";
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
  const { session, billing } = await authenticate.admin(request);

  // Ground-truth billing status (test mode).
  let billingStatus: { active: boolean; plan: string | null } = { active: false, plan: null };
  try {
    const check = await billing.check({
      plans: ["STARTER", "GROWTH", "PRO", "SCALE"],
      isTest: true,
    });
    const sub = check.appSubscriptions?.[0];
    billingStatus = { active: !!check.hasActivePayment, plan: sub?.name || null };
  } catch (e) {
    console.error("[billing] check failed:", e);
  }

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
      adAccounts: true,
    },
  });

  const pendingAssets = shop?.assets.filter((a) => a.status === "PENDING").length ?? 0;
  const brandJob = shop?.jobs[0] || null;

  // Onboarding checklist state.
  const steps = {
    analyzed: !!shop?.brandProfile,
    planned: !!shop?.activePlan,
    connected: (shop?.adAccounts.length ?? 0) > 0,
    reviewed: (shop?.assets.some((a) => a.status === "APPROVED" || a.status === "PUBLISHED")) ?? false,
  };

  return json({
    shop,
    pendingAssets,
    brandJobStatus: brandJob?.status ?? null,
    brandJobError: brandJob?.lastError ?? null,
    billingStatus,
    steps,
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
    let res: Response;
    try {
      res = await admin.graphql(query);
    } catch (thrown) {
      // admin.graphql throws a Response on HTTP errors (e.g. 403) — read it.
      if (thrown instanceof Response) {
        const body = await thrown.text().catch(() => "");
        throw new Error(`Shopify ${thrown.status}: ${body.slice(0, 400) || "(no body)"}`);
      }
      throw thrown;
    }
    const bodyText = await res.text();
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${bodyText.slice(0, 400)}`);
    const jsonRes = JSON.parse(bodyText);
    if (jsonRes.errors) {
      throw new Error("Shopify GraphQL: " + JSON.stringify(jsonRes.errors).slice(0, 400));
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
  const { shop, pendingAssets, brandJobError, billingStatus, steps } = useLoaderData<typeof loader>();
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
          <ArcadeCabinet
            hasPlan={hasPlan}
            pendingAssets={pendingAssets}
            liveCampaigns={shop.campaigns.filter((c) => c.status === "ACTIVE").length}
          />
        </Layout.Section>

        {steps && !(steps.analyzed && steps.planned && steps.connected && steps.reviewed) && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">Get set up</Text>
                  <Badge tone="info">
                    {`${[steps.analyzed, steps.planned, steps.connected, steps.reviewed].filter(Boolean).length} of 4 done`}
                  </Badge>
                </InlineStack>
                <SetupStep done={steps.analyzed} title="Analyze your store" desc="Learn your brand voice & products" href="/app" />
                <SetupStep done={steps.planned} title="Choose a plan" desc="Pick your marketing goal" href="/app/plans" />
                <SetupStep done={steps.connected} title="Connect an ad account" desc="Link Meta or TikTok to publish" href="/app/connect" />
                <SetupStep done={steps.reviewed} title="Approve your first content" desc="Review what we generate" href="/app/assets" />
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

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

                {productMeta?.positioning && (
                  <Text variant="bodyMd" as="p" tone="subdued">
                    {productMeta.positioning}
                  </Text>
                )}

                <InlineStack gap="200" wrap>
                  {voice?.tone && <Badge tone="info">{`Voice: ${voice.tone}`}</Badge>}
                  {visual?.imageStyle && <Badge>{`Look: ${visual.imageStyle}`}</Badge>}
                  {Number(productMeta?.avgPrice) > 0 && (
                    <Badge>{`Avg price: $${Number(productMeta.avgPrice).toFixed(0)}`}</Badge>
                  )}
                  {productMeta?.storeUrl && (
                    <Badge>{String(productMeta.storeUrl).replace(/^https?:\/\//, "")}</Badge>
                  )}
                </InlineStack>

                {Array.isArray(voice?.values) && voice.values.length > 0 && (
                  <InlineStack gap="200" wrap>
                    {voice.values.map((v: string) => (
                      <Badge key={v} tone="success">{v}</Badge>
                    ))}
                  </InlineStack>
                )}

                {productImages.length > 0 ? (
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
                ) : (
                  <>
                    <Divider />
                    <Text variant="bodySm" as="p" tone="subdued">
                      No products in your store yet — we've built your brand
                      direction from your store details. Add products and hit
                      “Re-analyze” to sharpen it.
                    </Text>
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
                <Text variant="bodySm" as="p" tone="subdued">
                  {billingStatus?.active
                    ? `Billing: active (${billingStatus.plan})`
                    : "Billing: not charging yet"}
                </Text>
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

        {/* Arcade achievements */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Achievements</Text>
              <div className="mm-ach-grid">
                <Achievement icon="🕹️" name="POWERED ON" earned />
                <Achievement icon="🔍" name="BRAND SCANNED" earned={steps?.analyzed} />
                <Achievement icon="🎯" name="PLAYER 1" earned={steps?.planned} />
                <Achievement icon="📦" name="FIRST DROP" earned={(shop.assets.length ?? 0) > 0} />
                <Achievement icon="🚀" name="ON THE BOARD" earned={shop.campaigns.length > 0} />
                <Achievement icon="🏆" name="HIGH SCORE" earned={shop.campaigns.some((c) => c.status === "ACTIVE")} />
              </div>
            </BlockStack>
          </Card>
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

const MODES = [
  { mi: "✦", mt: "Create", md: "AI blogs, videos, ads and pages — in your brand voice, on demand.", go: "ENTER →", a: "a1", route: "/app/strategy" },
  { mi: "◆", mt: "Launch", md: "Publish and auto-optimize campaigns across Meta and TikTok.", go: "ENTER →", a: "a2", route: "/app/campaigns" },
  { mi: "▲", mt: "Track", md: "Watch ad spend, revenue and ROI climb the high-score board.", go: "ENTER →", a: "a3", route: "/app/performance" },
];

const QUICK = [
  { l: "Plans", route: "/app/plans" },
  { l: "Video Studio", route: "/app/videos" },
  { l: "Product Copy", route: "/app/products" },
  { l: "Landing Pages", route: "/app/funnels" },
  { l: "Content Queue", route: "/app/assets" },
  { l: "Calendar", route: "/app/calendar" },
  { l: "Ad Accounts", route: "/app/connect" },
];

function ArcadeCabinet({ hasPlan, pendingAssets, liveCampaigns }: { hasPlan: boolean; pendingAssets: number; liveCampaigns: number }) {
  return (
    <>
      <div className="mm-hero">
        <span className="mm-eyebrow">THE MARKETING ARCADE</span>
        <h1>Your store's marketing, on autopilot.</h1>
        <p>
          Insert a token and the arcade goes to work — generating the content,
          launching the ads, and pushing your ROI up the high-score board while
          you run your business.
        </p>
        <Link to={hasPlan ? "/app/performance" : "/app/plans"} className="mm-hero-cta">
          {hasPlan ? "Enter the arcade →" : "Choose your plan →"}
        </Link>
        <div className="mm-hero-stats">
          <div className="mm-hero-stat">
            <div className="k">HI-SCORE · ROI</div>
            <div className="v">{liveCampaigns > 0 ? "LIVE" : "—"}</div>
          </div>
          <div className="mm-hero-stat">
            <div className="k">CONTENT READY</div>
            <div className="v cyan">{pendingAssets}</div>
          </div>
          <div className="mm-hero-stat">
            <div className="k">CAMPAIGNS LIVE</div>
            <div className="v cyan">{liveCampaigns}</div>
          </div>
        </div>
      </div>

      <div className="mm-modes">
        {MODES.map((m) => (
          <Link key={m.mt} to={m.route} className={`mm-mode ${m.a}`}>
            <div className="mi">{m.mi}</div>
            <div className="mt">{m.mt}</div>
            <div className="md">{m.md}</div>
            <div className="mgo">{m.go}</div>
          </Link>
        ))}
      </div>

      <span className="mm-section-label" style={{ marginTop: 22 }}>QUICK ACCESS</span>
      <div className="mm-quick">
        {QUICK.map((q) => (
          <Link key={q.l} to={q.route} className="mm-chip">{q.l}</Link>
        ))}
      </div>
    </>
  );
}

function Achievement({ icon, name, earned }: { icon: string; name: string; earned?: boolean }) {
  return (
    <div className={`mm-ach${earned ? " earned" : ""}`} style={{ filter: earned ? "none" : "grayscale(1) opacity(0.5)" }}>
      <div className="ic">{icon}</div>
      <div className="nm">{name}</div>
    </div>
  );
}

function SetupStep({ done, title, desc, href }: { done: boolean; title: string; desc: string; href: string }) {
  return (
    <Link to={href} style={{ textDecoration: "none" }}>
      <InlineStack gap="300" blockAlign="center" wrap={false}>
        <div
          style={{
            width: 26, height: 26, borderRadius: 13, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: done ? "var(--mm-green,#4B7B4E)" : "transparent",
            border: done ? "none" : "2px solid var(--mm-line,#E6DCC3)",
            color: "#fff", fontSize: 15, fontWeight: 700,
          }}
        >
          {done ? "✓" : ""}
        </div>
        <BlockStack gap="0">
          <Text variant="bodyMd" as="span" fontWeight="semibold" tone={done ? "subdued" : undefined}>
            {title}
          </Text>
          <Text variant="bodySm" as="span" tone="subdued">{desc}</Text>
        </BlockStack>
      </InlineStack>
    </Link>
  );
}
