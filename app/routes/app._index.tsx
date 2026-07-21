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
import { unlockAchievement } from "../lib/xp.server";
import { ACHIEVEMENTS } from "../lib/achievements";
import { paidAdsEnabled } from "../lib/feature-flags.server";
import { socialProviderEnabled } from "../lib/social-provider.server";

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
      achievements: true,
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
    paidAds: paidAdsEnabled(),
    socialOn: socialProviderEnabled(),
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
    // Progression: the "we understand your store" moment = SCANNER unlocked.
    await unlockAchievement(shop.id, "SCANNER");
    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) });
  }
};

// Partner / stage labels so the dashboard reflects the arcade plan names
// (kept in sync with FIGHTERS in app.plans.tsx).
const PLAN_LABELS: Record<string, { fighter: string; rank: string }> = {
  STARTER: { fighter: "SPROUT", rank: "Starter" },
  GROWTH: { fighter: "OG", rank: "Growth" },
  PRO: { fighter: "STRONG", rank: "Rapid Growth" },
  SCALE: { fighter: "REX", rank: "Commercial Growth" },
};
const planLabel = (type: string) => {
  const l = PLAN_LABELS[type];
  return l ? `${l.fighter} · ${l.rank}` : type.replace(/_/g, " ");
};

export default function Dashboard() {
  const { shop, pendingAssets, brandJobError, billingStatus, steps, paidAds, socialOn } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const building = nav.state !== "idle";
  const liveError = (actionData && "error" in actionData ? actionData.error : null) || brandJobError;

  const ap = shop?.activePlan;
  const tokRemaining = ap ? Math.max(0, ap.tokensIncluded - ap.tokensUsed) + ap.tokensExtra : 0;
  const tokIncluded = ap?.tokensIncluded ?? 0;
  const tokExtra = ap?.tokensExtra ?? 0;

  if (!shop) {
    return (
      <Page title="EasyMode">
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
            paidAds={paidAds}
            socialOn={socialOn}
          />
        </Layout.Section>

        {steps && !(steps.analyzed && steps.planned && ((socialOn || paidAds) ? steps.connected : true) && steps.reviewed) && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">Get set up</Text>
                  <Badge tone="info">
                    {`${[steps.analyzed, steps.planned, ...((socialOn || paidAds) ? [steps.connected] : []), steps.reviewed].filter(Boolean).length} of ${(socialOn || paidAds) ? 4 : 3} done`}
                  </Badge>
                </InlineStack>
                <SetupStep done={steps.analyzed} title="Analyze your store" desc="Learn your brand voice & products" href="/app" />
                <SetupStep done={steps.planned} title="Choose a package" desc="Fund your expedition — quotas & tokens" href="/app/plans" />
                {(socialOn || paidAds) && (
                  <SetupStep done={steps.connected} title="Connect your socials" desc="Link TikTok, Instagram & Facebook — auto-posting arms itself" href="/app/connect" />
                )}
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
                  <Badge tone="success">{planLabel(shop.activePlan!.type)}</Badge>
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
                <Text variant="headingMd" as="h3">Tokens</Text>
                {hasPlan ? (
                  <Badge tone={tokRemaining > 0 ? "success" : "critical"}>{`⚡ ${tokRemaining.toLocaleString()} left`}</Badge>
                ) : (
                  <Badge tone="attention">No plan yet</Badge>
                )}
                <Text variant="bodySm" as="p" tone="subdued">
                  {hasPlan
                    ? `${tokIncluded.toLocaleString()}/mo included${tokExtra ? ` · +${tokExtra.toLocaleString()} top-up` : ""}`
                    : "Pick a plan to get tokens"}
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

        {/* Arcade achievements — real unlocks that pay XP + token bonuses */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" as="h2">Achievements</Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  {(shop.achievements?.length ?? 0)} / {ACHIEVEMENTS.length} unlocked · earn XP &amp; bonus tokens
                </Text>
              </InlineStack>
              <div className="mm-ach-grid">
                {ACHIEVEMENTS.map((a) => {
                  const earned = shop.achievements?.some((u: { key: string }) => u.key === a.key);
                  return (
                    <Achievement
                      key={a.key}
                      icon={a.icon}
                      name={a.label.toUpperCase()}
                      desc={a.desc}
                      bonus={a.tokens > 0 ? `+${a.tokens} 🪙` : `+${a.xp} XP`}
                      earned={earned}
                    />
                  );
                })}
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

        {paidAds && campaignRows.length > 0 && (
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

const QUICK = [
  { l: "Plans", route: "/app/plans" },
  { l: "Video Studio", route: "/app/videos" },
  { l: "Listing Studio", route: "/app/products" },
  { l: "Landing Pages", route: "/app/funnels" },
  { l: "Content Queue", route: "/app/assets" },
  { l: "Calendar", route: "/app/calendar" },
  { l: "Ad Accounts", route: "/app/connect" },
];

function ArcadeCabinet({ hasPlan, pendingAssets, liveCampaigns, paidAds, socialOn }: { hasPlan: boolean; pendingAssets: number; liveCampaigns: number; paidAds: boolean; socialOn: boolean }) {
  // "Track" points at the paid ROI dashboard only when paid ads are live; otherwise
  // it points at the campaign map (organic click-through attribution works today).
  const modes = [
    { mi: "✦", mt: "Create", md: "AI blogs, videos, ads and pages — in your brand voice, on demand.", go: "ENTER →", a: "a1", route: "/app/strategy" },
    { mi: "◆", mt: "Launch", md: "Publish and schedule campaigns to your socials — hands-free, every day.", go: "ENTER →", a: "a2", route: "/app/campaigns" },
    paidAds
      ? { mi: "▲", mt: "Track", md: "Watch ad spend, revenue and ROI climb the high-score board.", go: "ENTER →", a: "a3", route: "/app/performance" }
      : { mi: "▲", mt: "Track", md: "Watch the map light up gold where shoppers click through and buy.", go: "ENTER →", a: "a3", route: "/app/campaigns" },
  ];
  const quick = QUICK
    .filter((q) => q.route !== "/app/connect" || socialOn || paidAds)
    .map((q) => (q.route === "/app/connect" ? { ...q, l: paidAds ? "Ad Accounts" : "Auto-Posting" } : q));
  return (
    <>
      <div className="pp-hero" style={{ marginBottom: 18 }}>
        <span className="pp-eyebrow">Marketing Autopilot</span>
        <h1>Your store's marketing, <em>running itself.</em></h1>
        <p className="pp-sub">
          Videos starring your Brand Face, scroll-stopping ads, and articles that
          rank — created, scheduled, and posted to your socials every day. You
          watch the map light up gold where shoppers click through.
        </p>
        <div className="pp-stats">
          <div className="pp-stat">
            <div className="v">{liveCampaigns > 0 ? <span className="g">RUNNING</span> : "—"}</div>
            <div className="l">Autopilot</div>
          </div>
          <div className="pp-stat">
            <div className="v">{pendingAssets}</div>
            <div className="l">Content ready</div>
          </div>
          <div className="pp-stat">
            <div className="v">{liveCampaigns}</div>
            <div className="l">Campaigns live</div>
          </div>
        </div>
        <div style={{ marginTop: 18, position: "relative" }}>
          <Link to={hasPlan ? "/app/campaigns" : "/app/plans"} style={{ textDecoration: "none" }}>
            <span className="pp-cta gold" style={{ display: "inline-block" }}>
              {hasPlan ? "Launch a campaign" : "Choose your package"}
            </span>
          </Link>
        </div>
      </div>

      <div className="mm-modes">
        {modes.map((m) => (
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
        {quick.map((q) => (
          <Link key={q.l} to={q.route} className="mm-chip">{q.l}</Link>
        ))}
      </div>
    </>
  );
}

function Achievement({ icon, name, desc, bonus, earned }: { icon: string; name: string; desc?: string; bonus?: string; earned?: boolean }) {
  return (
    <div
      className={`mm-ach${earned ? " earned" : ""}`}
      title={desc}
      style={{ filter: earned ? "none" : "grayscale(1) opacity(0.5)" }}
    >
      <div className="ic">{icon}</div>
      <div className="nm">{name}</div>
      {desc && <div className="ds">{desc}</div>}
      {bonus && <div className="bn">{bonus}</div>}
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
