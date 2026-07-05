import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
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
  Box,
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

  // Real purchase: redirect to Shopify's charge-approval screen.
  // isTest keeps it free during development — flip to false to charge for real.
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  try {
    await billing.request({
      plan: planKey,
      isTest: true,
      returnUrl: `${appUrl}/app?billing=confirmed`,
    });
  } catch (e) {
    // billing.request signals the redirect by THROWING a Response — let that
    // through. Only genuine errors get reported back to the UI.
    if (e instanceof Response) throw e;
    return json({ error: e instanceof Error ? e.message : String(e) });
  }

  return json({ ok: true });
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
                    label: "Set-and-forget — content publishes automatically",
                    value: "SET_AND_FORGET",
                    helpText: "Zero effort. You can still edit anything after it's live.",
                  },
                  {
                    label: "Review first — approve or edit before anything publishes",
                    value: "REVIEW_FIRST",
                    helpText: "Everything waits in your queue with a 24h notice. Full control.",
                  },
                ]}
                selected={[reviewMode]}
                onChange={(v) => setReviewMode(v[0])}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Four plan cards */}
        <Layout.Section>
          <InlineStack gap="400" wrap align="center">
            {PLAN_TIERS.map((tier) => {
              const isCurrent = currentPlan === tier.key;
              return (
                <Box key={tier.key} minWidth="250px" maxWidth="290px">
                  <div
                    style={{
                      position: "relative",
                      border: tier.highlight
                        ? "2px solid var(--mm-gold, #C9972B)"
                        : "1px solid var(--mm-line, #E6DCC3)",
                      borderRadius: 16,
                      background: "#fff",
                      height: "100%",
                    }}
                  >
                    {tier.highlight && (
                      <div
                        style={{
                          position: "absolute",
                          top: -12,
                          left: "50%",
                          transform: "translateX(-50%)",
                          background: "var(--mm-gold, #C9972B)",
                          color: "#fff",
                          fontFamily: "Poppins, sans-serif",
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          padding: "4px 12px",
                          borderRadius: 999,
                          whiteSpace: "nowrap",
                        }}
                      >
                        Most popular
                      </div>
                    )}
                    <Box padding="400">
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text variant="headingMd" as="h3">{tier.name}</Text>
                          {isCurrent && <Badge tone="success">Current</Badge>}
                        </InlineStack>

                        <InlineStack blockAlign="end" gap="100">
                          <Text variant="heading2xl" as="p">${tier.price}</Text>
                          <Text variant="bodySm" as="span" tone="subdued">/mo</Text>
                        </InlineStack>

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

                        <Button
                          variant={tier.highlight ? "primary" : "secondary"}
                          fullWidth
                          size="large"
                          loading={nav.state !== "idle" && pending === tier.key}
                          onClick={() => buy(tier.key)}
                        >
                          {isCurrent ? "Current plan" : `Get ${tier.name}`}
                        </Button>
                      </BlockStack>
                    </Box>
                  </div>
                </Box>
              );
            })}
          </InlineStack>
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
