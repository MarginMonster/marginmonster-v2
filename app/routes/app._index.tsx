import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData, Link, useNavigate } from "@remix-run/react";
import { useState } from "react";
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
          <ArcadeCabinet />
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

const VEND_SLOTS = [
  { em: "📝", lb: "BLOG", cls: "blog", color: "#FF2E97", route: "/app/assets" },
  { em: "🎬", lb: "VIDEO", cls: "video", color: "#23E5DB", route: "/app/videos" },
  { em: "🖼️", lb: "ADS", cls: "image", color: "#C6FF3D", route: "/app/assets" },
  { em: "🛍️", lb: "COPY", cls: "copy", color: "#FFD23F", route: "/app/products" },
  { em: "🧠", lb: "PLAN", cls: "plan", color: "#B77BFF", route: "/app/strategy" },
  { em: "🕸️", lb: "PAGE", cls: "page", color: "#FF7BAC", route: "/app/funnels" },
];

const GAME_TILES = [
  { ic: "🎯", tt: "PLANS", sb: "Choose your level", c: "c1", route: "/app/plans" },
  { ic: "🧠", tt: "STRATEGY", sb: "AI marketing plan", c: "c2", route: "/app/strategy" },
  { ic: "📝", tt: "CONTENT", sb: "Review the queue", c: "c3", route: "/app/assets" },
  { ic: "🗓️", tt: "CALENDAR", sb: "What's dropping", c: "c4", route: "/app/calendar" },
  { ic: "🎬", tt: "VIDEO", sb: "Video studio", c: "c5", route: "/app/videos" },
  { ic: "🛍️", tt: "PRODUCT", sb: "Copy generator", c: "c6", route: "/app/products" },
  { ic: "🕸️", tt: "PAGES", sb: "Landing pages", c: "c7", route: "/app/funnels" },
  { ic: "📊", tt: "HI-SCORE", sb: "Performance & ROI", c: "c8", route: "/app/performance" },
  { ic: "🔌", tt: "AD ACCTS", sb: "Connect Meta/TikTok", c: "c1", route: "/app/connect" },
  { ic: "🚀", tt: "CAMPAIGNS", sb: "Launch & optimize", c: "c2", route: "/app/campaigns" },
];

const SPIN_PRIZES = ["+5 TOKENS", "FREE VIDEO", "+1 BLOG POST", "JACKPOT x2", "+3 TOKENS", "SPIN AGAIN"];

function ArcadeCabinet() {
  const navigate = useNavigate();
  const [cap, setCap] = useState<{ lb: string; color: string; k: number } | null>(null);
  const [turn, setTurn] = useState(0);
  const [prize, setPrize] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);

  const dispense = (s: (typeof VEND_SLOTS)[number]) => {
    setCap({ lb: s.lb, color: s.color, k: Date.now() });
    setTimeout(() => navigate(s.route), 820);
  };

  const spin = () => {
    if (spinning) return;
    setSpinning(true);
    setPrize(null);
    const idx = Math.floor(Math.random() * SPIN_PRIZES.length);
    const rot = 360 * 5 - idx * 60 - 30;
    setTurn((t) => t + rot);
    setTimeout(() => {
      setPrize(SPIN_PRIZES[idx]);
      setSpinning(false);
    }, 3600);
  };

  return (
    <div className="mm-cab">
      <div className="mm-marquee-wrap">
        <div className="mm-marquee">
          ★ WELCOME TO THE <b>MARGINMONSTER ARCADE</b> ★ INSERT TOKEN — WATCH YOUR STORE GROW ★ <i>HI-SCORE = YOUR ROI</i> ★ NEW HIGH SCORE INCOMING ★
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(240px,1fr) minmax(220px,1fr)", gap: 20, alignItems: "start" }}>
        <div>
          <div className="mm-vend">
            <div className="mm-vend-led">◄ SELECT · DISPENSE · SHIP ►</div>
            <div className="mm-vend-glass">
              {cap && (
                <div key={cap.k} className="mm-capsule go" style={{ color: cap.color, background: cap.color }}>
                  {cap.lb}
                </div>
              )}
              {VEND_SLOTS.map((s) => (
                <button key={s.lb} className={`mm-slot ${s.cls}`} onClick={() => dispense(s)} aria-label={s.lb}>
                  <span className="em">{s.em}</span>
                  <span className="lb">{s.lb}</span>
                </button>
              ))}
            </div>
            <div className="mm-vend-tray">▼ DISPENSE TRAY ▼</div>
          </div>
          <p style={{ textAlign: "center", marginTop: 12 }}>
            <span className="mm-insert">▶ INSERT TOKEN — TAP A SLOT</span>
          </p>
        </div>

        <div className="mm-wheel-wrap">
          <div style={{ fontFamily: "var(--font-pixel)", fontSize: 10, color: "#FFD23F", marginBottom: 10 }}>
            ◆ DAILY TOKEN SPIN ◆
          </div>
          <div className="mm-wheel-pointer" />
          <div
            className="mm-wheel"
            style={{
              transform: `rotate(${turn}deg)`,
              background:
                "conic-gradient(#FF2E97 0 60deg,#23E5DB 60deg 120deg,#C6FF3D 120deg 180deg,#FFD23F 180deg 240deg,#B77BFF 240deg 300deg,#FF7BAC 300deg 360deg)",
            }}
          >
            <div style={{ position: "absolute", inset: 0, margin: "auto", width: 46, height: 46, borderRadius: "50%", background: "#14122A", border: "3px solid #FFD23F", top: "50%", left: "50%", transform: "translate(-50%,-50%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-pixel)", fontSize: 8, color: "#FFD23F" }}>
              MM
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <button className="mm-arcade-btn" onClick={spin}>{spinning ? "SPINNING…" : "▶ SPIN"}</button>
          </div>
          <div style={{ marginTop: 12, minHeight: 18, fontFamily: "var(--font-pixel)", fontSize: 10, color: "#C6FF3D" }}>
            {prize ? `YOU WON: ${prize}!` : ""}
          </div>
        </div>
      </div>

      <h3 className="mm-neon-h">▶ GAME SELECT</h3>
      <div className="mm-gameselect">
        {GAME_TILES.map((t) => (
          <Link key={t.tt} to={t.route} className={`mm-cabtile ${t.c}`}>
            <div className="ic">{t.ic}</div>
            <div className="tt">{t.tt}</div>
            <div className="sb">{t.sb}</div>
          </Link>
        ))}
      </div>
    </div>
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
