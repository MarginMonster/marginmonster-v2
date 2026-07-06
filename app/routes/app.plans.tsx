import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { useState } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  ChoiceList,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { PLAN_TIERS, PLAN_BY_KEY, type PlanKey } from "../lib/plan-config";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true },
  });
  return json({
    currentPlan: shop?.activePlan?.type || null,
    currentReview: shop?.activePlan?.reviewMode || "REVIEW_FIRST",
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const form = await request.formData();
  const planKey = form.get("planKey") as PlanKey;
  const reviewMode = (form.get("reviewMode") as "SET_AND_FORGET" | "REVIEW_FIRST") || "REVIEW_FIRST";

  const tier = PLAN_BY_KEY[planKey];
  if (!tier) throw new Error("Invalid plan");

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) throw new Error("Shop not found");

  // Seed the plan row (so quotas are ready the moment payment clears).
  await db.plan.upsert({
    where: { shopId: shop.id },
    create: {
      shopId: shop.id,
      type: planKey,
      reviewMode,
      blogQuota: tier.blogQuota,
      videoQuota: tier.videoQuota,
      imageQuota: tier.imageQuota,
      adCreativePack: tier.imageQuota > 0,
      campaignAutopilot: tier.campaignAutopilot,
      periodStart: new Date(),
    },
    update: {
      type: planKey,
      reviewMode,
      blogQuota: tier.blogQuota,
      videoQuota: tier.videoQuota,
      imageQuota: tier.imageQuota,
      adCreativePack: tier.imageQuota > 0,
      campaignAutopilot: tier.campaignAutopilot,
      active: true,
    },
  });

  // Attempt the real Shopify charge. On success this THROWS a redirect to
  // Shopify's approval screen. If billing isn't fully set up yet, we don't
  // block the merchant — the plan is already active, so we just send them
  // back to the dashboard. Real charging turns on once billing is verified.
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  try {
    await billing.request({
      plan: planKey,
      isTest: true,
      returnUrl: `${appUrl}/app`,
    });
  } catch (e) {
    if (e instanceof Response) throw e; // the approval redirect — let it flow
    // Surface the real billing error so we can see what Shopify says.
    const anyErr = e as { message?: string; errorData?: unknown };
    const detail = anyErr?.errorData
      ? JSON.stringify(anyErr.errorData)
      : anyErr?.message || String(e);
    console.error("[billing] request failed:", detail);
    return json({ error: detail });
  }

  throw redirect("/app");
};

type Fighter = { title: string; avatar: string; rank: string; power: number; accent: string; stats: { label: string; v: number }[] };
const FIGHTERS: Record<string, Fighter> = {
  STARTER: { title: "The Rookie", avatar: "👾", rank: "TIER I", power: 1, accent: "#34E7E4",
    stats: [{ label: "CONTENT", v: 2 }, { label: "ADS", v: 0 }, { label: "VIDEO", v: 0 }, { label: "AUTOPILOT", v: 0 }] },
  GROWTH: { title: "The Challenger", avatar: "👹", rank: "TIER II", power: 2, accent: "#E5397D",
    stats: [{ label: "CONTENT", v: 4 }, { label: "ADS", v: 3 }, { label: "VIDEO", v: 0 }, { label: "AUTOPILOT", v: 1 }] },
  PRO: { title: "The Warrior", avatar: "👺", rank: "TIER III", power: 3, accent: "#F5C451",
    stats: [{ label: "CONTENT", v: 4 }, { label: "ADS", v: 4 }, { label: "VIDEO", v: 3 }, { label: "AUTOPILOT", v: 4 }] },
  SCALE: { title: "The Boss", avatar: "🐲", rank: "TIER IV", power: 4, accent: "#B77BFF",
    stats: [{ label: "CONTENT", v: 5 }, { label: "ADS", v: 5 }, { label: "VIDEO", v: 5 }, { label: "AUTOPILOT", v: 5 }] },
};

export default function Plans() {
  const { currentPlan, currentReview } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const billingError = actionData && "error" in actionData ? actionData.error : null;
  const submit = useSubmit();
  const nav = useNavigation();
  const [reviewMode, setReviewMode] = useState<string>(currentReview);
  const [pending, setPending] = useState<PlanKey | null>(null);

  const buy = (planKey: PlanKey) => {
    setPending(planKey);
    submit({ planKey, reviewMode }, { method: "post" });
  };

  return (
    <Page
      fullWidth
      backAction={{ content: "Home", url: "/app" }}
      title="Choose your plan"
      subtitle="Pick a plan, choose how hands-on you want to be, and start growing today."
    >
      <Layout>
        <Layout.Section>
          <div className="mm-hero">
            <span className="mm-eyebrow">▶ SELECT YOUR LEVEL</span>
            <h1>Pick your level. Let your store sell for you.</h1>
            <p>
              You didn't start a business to spend nights writing blog posts and
              editing videos. Pick a plan and hand the content grind to us — grow
              faster, and take your time back.
            </p>
          </div>
        </Layout.Section>

        {billingError && (
          <Layout.Section>
            <Banner tone="critical" title="Couldn't start checkout">
              <p>{billingError}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Review mode — applies to whichever plan you buy */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h3">How hands-on do you want to be?</Text>
              <ChoiceList
                title=""
                titleHidden
                choices={[
                  {
                    label: "Set-and-forget — publishes automatically, no review needed",
                    value: "SET_AND_FORGET",
                    helpText:
                      "Content goes live on your store the moment it's ready. You can still edit or remove anything after it's live. Don't worry — you can switch to review mode anytime.",
                  },
                  {
                    label: "Review first — you approve or edit before it goes live",
                    value: "REVIEW_FIRST",
                    helpText:
                      "Nothing publishes until you say so. Each piece waits in your queue with a 24h heads-up. Don't worry — you can change your mind and switch modes whenever you like.",
                  },
                ]}
                selected={[reviewMode]}
                onChange={(v) => setReviewMode(v[0])}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Character-select — each tier is a stronger fighter */}
        <Layout.Section>
          <span className="mm-section-label">▶ SELECT YOUR FIGHTER</span>
          <div className="mm-fighter-grid">
            {PLAN_TIERS.map((tier) => {
              const isCurrent = currentPlan === tier.key;
              const f = FIGHTERS[tier.key];
              return (
                <div
                  key={tier.key}
                  className={`mm-fighter-card${tier.highlight ? " is-featured" : ""}`}
                  style={{ ["--fx" as string]: f.accent }}
                >
                  {tier.highlight && <div className="mm-plan-ribbon">Most popular</div>}

                  <div className="mm-fighter-portrait">
                    <div className="mm-fighter-rank">{f.rank}</div>
                    <div className="mm-fighter-avatar" data-p={f.power}>{f.avatar}</div>
                    <div className="mm-fighter-power">
                      {[1, 2, 3, 4].map((n) => (
                        <span key={n} className={`pw${n <= f.power ? " on" : ""}`} />
                      ))}
                    </div>
                  </div>

                  <div className="mm-fighter-name">{f.title}</div>
                  <div className="mm-fighter-plan">
                    {tier.name}{isCurrent && <span className="mm-fighter-current">SELECTED</span>}
                  </div>
                  <p className="mm-plan-price" style={{ margin: "6px 0 12px" }}>
                    ${tier.price}<small> /mo</small>
                  </p>

                  <div className="mm-fighter-stats">
                    {f.stats.map((s) => (
                      <div className="mm-stat" key={s.label}>
                        <span className="sl">{s.label}</span>
                        <span className="sb">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <i key={n} className={n <= s.v ? "on" : ""} />
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mm-fighter-features">
                    {tier.features.slice(0, 4).map((ft) => (
                      <div className="ff" key={ft}><span>▸</span>{ft}</div>
                    ))}
                  </div>

                  <div style={{ flexGrow: 1 }} />
                  <button
                    className={`mm-fighter-select${nav.state !== "idle" && pending === tier.key ? " loading" : ""}`}
                    onClick={() => buy(tier.key)}
                    disabled={isCurrent}
                  >
                    {isCurrent ? "SELECTED" : nav.state !== "idle" && pending === tier.key ? "LOADING…" : "▶ SELECT"}
                  </button>
                </div>
              );
            })}
          </div>
        </Layout.Section>

        <Layout.Section>
          <Text variant="bodySm" as="p" tone="subdued" alignment="center">
            Need more than your plan includes? Drop in tokens anytime — no
            upgrade required. Cancel or switch plans whenever you like.
          </Text>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
