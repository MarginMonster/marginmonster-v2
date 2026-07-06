import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Banner,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { generateMarketingPlan, type MarketingPlan } from "../lib/strategy.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { brandProfile: true, activePlan: true },
  });
  return json({
    hasBrand: !!shop?.brandProfile,
    hasPlan: !!shop?.activePlan,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { brandProfile: true, activePlan: true },
  });
  if (!shop?.brandProfile) return json({ error: "Analyze your store on the dashboard first." });
  if (!shop?.activePlan) return json({ error: "Choose a plan first." });
  try {
    const plan = await generateMarketingPlan(shop.brandProfile, shop.activePlan);
    return json({ plan });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) });
  }
};

export default function Strategy() {
  const { hasBrand, hasPlan } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const plan = actionData && "plan" in actionData ? (actionData.plan as MarketingPlan) : null;
  const error = actionData && "error" in actionData ? actionData.error : null;

  const generate = () => submit({}, { method: "post" });

  if (!hasBrand || !hasPlan) {
    return (
      <Page title="AI Marketing Plan" backAction={{ content: "Home", url: "/app" }}>
        <EmptyState
          heading="Set up first"
          image=""
          action={{ content: hasBrand ? "Choose a plan" : "Go to dashboard", url: hasBrand ? "/app/plans" : "/app" }}
        >
          <p>Analyze your store and pick a plan, then we'll build your custom 4-week marketing strategy.</p>
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page
      title="AI Marketing Plan"
      backAction={{ content: "Home", url: "/app" }}
      subtitle="A custom 4-week growth strategy built from your brand and goal."
      primaryAction={{ content: plan ? "Regenerate plan" : "Build my plan", onAction: generate, loading: busy }}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="warning" title="Couldn't build the plan">
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {!plan && !error && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300" align="center">
                <Text variant="headingMd" as="h2">Your growth strategy, in one click</Text>
                <Text as="p" tone="subdued">
                  We'll analyze your brand, products, and goal to produce a concrete 4-week plan —
                  channels, budget split, content themes, and the KPIs to watch.
                </Text>
                <Box>
                  <Button variant="primary" onClick={generate} loading={busy}>Build my plan</Button>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {plan && (
          <>
            <Layout.Section>
              <div className="mm-hero">
                <span className="mm-eyebrow">Your 4-week plan</span>
                <h1>{plan.headline}</h1>
                <p>{plan.positioning}</p>
              </div>
            </Layout.Section>

            <Layout.Section>
              <InlineStack gap="400" wrap>
                <Box minWidth="320px">
                  <Card>
                    <BlockStack gap="300">
                      <Text variant="headingMd" as="h2">Channels</Text>
                      {plan.channels.map((c) => (
                        <BlockStack key={c.name} gap="050">
                          <InlineStack gap="200" blockAlign="center">
                            <Text variant="bodyMd" as="span" fontWeight="semibold">{c.name}</Text>
                            <Badge tone="info">{c.cadence}</Badge>
                          </InlineStack>
                          <Text variant="bodySm" as="p" tone="subdued">{c.why}</Text>
                        </BlockStack>
                      ))}
                    </BlockStack>
                  </Card>
                </Box>

                <Box minWidth="280px">
                  <Card>
                    <BlockStack gap="300">
                      <Text variant="headingMd" as="h2">Budget split</Text>
                      {plan.budgetSplit.map((b) => (
                        <div key={b.channel}>
                          <InlineStack align="space-between">
                            <Text variant="bodyMd" as="span">{b.channel}</Text>
                            <Text variant="bodyMd" as="span" fontWeight="semibold">{b.percent}%</Text>
                          </InlineStack>
                          <div style={{ height: 8, background: "var(--mm-line,#E6DCC3)", borderRadius: 4, marginTop: 4 }}>
                            <div style={{ width: `${b.percent}%`, height: 8, background: "var(--mm-gold,#C9972B)", borderRadius: 4 }} />
                          </div>
                        </div>
                      ))}
                    </BlockStack>
                  </Card>
                </Box>
              </InlineStack>
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">Week by week</Text>
                  {plan.weeklyPlan.map((w) => (
                    <div key={w.week}>
                      <InlineStack gap="300" blockAlign="start" wrap={false}>
                        <Box minWidth="70px"><Badge>{w.week}</Badge></Box>
                        <Text variant="bodyMd" as="p">{w.focus}</Text>
                      </InlineStack>
                      <Box paddingBlock="200"><Divider /></Box>
                    </div>
                  ))}
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <InlineStack gap="400" wrap>
                <Box minWidth="300px">
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="headingMd" as="h2">Content themes</Text>
                      <InlineStack gap="200" wrap>
                        {plan.contentThemes.map((t) => <Badge key={t} tone="success">{t}</Badge>)}
                      </InlineStack>
                    </BlockStack>
                  </Card>
                </Box>
                <Box minWidth="300px">
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="headingMd" as="h2">KPIs to watch</Text>
                      {plan.kpis.map((k) => (
                        <Text key={k} variant="bodyMd" as="p">• {k}</Text>
                      ))}
                    </BlockStack>
                  </Card>
                </Box>
              </InlineStack>
            </Layout.Section>
          </>
        )}
      </Layout>
    </Page>
  );
}
