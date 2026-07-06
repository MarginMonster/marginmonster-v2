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
  InlineStack,
  Button,
  Badge,
  Divider,
  ChoiceList,
  Icon,
  Banner,
} from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";
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
    // Surface Shopify's real userErrors so we can see what's actually wrong.
    const anyErr = e as { message?: string; errorData?: unknown };
    const detail = anyErr?.errorData
      ? JSON.stringify(anyErr.errorData)
      : anyErr?.message || String(e);
    console.error("[billing] request failed:", detail);
    return json({ error: detail });
  }

  throw redirect("/app");
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
            <span className="mm-eyebrow">Marketing freedom</span>
            <h1>Let your store sell for you.</h1>
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

        {/* Four plan cards — even grid */}
        <Layout.Section>
          <div className="mm-plan-grid">
            {PLAN_TIERS.map((tier) => {
              const isCurrent = currentPlan === tier.key;
              return (
                <div
                  key={tier.key}
                  className={`mm-plan-card${tier.highlight ? " is-featured" : ""}`}
                >
                  {tier.highlight && <div className="mm-plan-ribbon">Most popular</div>}

                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="headingMd" as="h3">{tier.name}</Text>
                      {isCurrent && <Badge tone="success">Current</Badge>}
                    </InlineStack>

                    <p className="mm-plan-price">
                      ${tier.price}
                      <small> /mo</small>
                    </p>

                    <Text variant="bodySm" as="p" tone="subdued">
                      {tier.tagline}
                    </Text>

                    <Divider />

                    <BlockStack gap="200">
                      {tier.features.map((f) => (
                        <InlineStack key={f} gap="150" blockAlign="start" wrap={false}>
                          <div style={{ color: "var(--mm-green, #4B7B4E)", flexShrink: 0 }}>
                            <Icon source={CheckIcon} />
                          </div>
                          <Text variant="bodySm" as="span">{f}</Text>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  </BlockStack>

                  <div style={{ flexGrow: 1 }} />
                  <div style={{ marginTop: 16 }}>
                    <Button
                      variant={tier.highlight ? "primary" : "secondary"}
                      fullWidth
                      size="large"
                      loading={nav.state !== "idle" && pending === tier.key}
                      onClick={() => buy(tier.key)}
                    >
                      {isCurrent ? "Current plan" : `Get ${tier.name}`}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Layout.Section>

        <Layout.Section>
          <Text variant="bodySm" as="p" tone="subdued" alignment="center">
            Need more than your plan includes? Top up with credits anytime — no
            upgrade required. Cancel or switch plans whenever you like.
          </Text>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
