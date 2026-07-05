import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
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
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";

const PLANS = [
  {
    type: "GROW_SALES",
    title: "Grow Sales",
    description: "Maximize purchase volume and ROAS. Best for established stores looking to scale what's already working.",
    optimizes: "Purchases / ROAS",
    audience: "Warm retargeting first",
    pacing: "Conservative — test then scale",
    badge: "Most Popular",
  },
  {
    type: "LAUNCH_PRODUCT",
    title: "Launch New Product",
    description: "Build excitement and early traction for a new SKU. Front-loads spend in launch week to maximize early signals.",
    optimizes: "Add to Cart",
    audience: "Cold interest stacks",
    pacing: "Front-loaded — heavy launch week",
    badge: null,
  },
  {
    type: "CLEAR_INVENTORY",
    title: "Clear Inventory",
    description: "Move slow-selling stock fast. Targets warm audiences with urgency messaging on low-velocity SKUs.",
    optimizes: "Purchases on flagged SKUs",
    audience: "Warm retargeting",
    pacing: "Aggressive — time-boxed",
    badge: null,
  },
  {
    type: "BUILD_AWARENESS",
    title: "Build Brand Awareness",
    description: "Grow reach and brand recognition without ROAS pressure. Ideal for new brands or entering new markets.",
    optimizes: "Reach / Video Views",
    audience: "Cold broad",
    pacing: "Even / steady",
    badge: null,
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true },
  });
  return json({ currentPlan: shop?.activePlan?.type || null });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const planType = formData.get("planType") as string;
  const weeklyBudget = parseFloat(formData.get("weeklyBudget") as string) || 100;

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) throw new Error("Shop not found");

  await db.plan.upsert({
    where: { shopId: shop.id },
    create: { shopId: shop.id, type: planType as any, weeklyBudget },
    update: { type: planType as any, weeklyBudget, active: true },
  });

  return redirect("/app");
};

export default function Plans() {
  const { currentPlan } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const selectPlan = (planType: string) => {
    const budget = prompt("Weekly budget ($):", "150");
    if (!budget) return;
    submit({ planType, weeklyBudget: budget }, { method: "post" });
  };

  return (
    <Page title="Choose Your Marketing Autopilot" subtitle="Pick one goal. We handle everything else.">
      <Layout>
        <Layout.Section>
          <InlineStack gap="400" wrap align="start">
            {PLANS.map((plan) => (
              <Box key={plan.type} minWidth="280px" maxWidth="340px">
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text variant="headingMd" as="h3">{plan.title}</Text>
                      {plan.badge && <Badge tone="success">{plan.badge}</Badge>}
                      {currentPlan === plan.type && <Badge tone="info">Active</Badge>}
                    </InlineStack>

                    <Text variant="bodyMd" as="p" tone="subdued">{plan.description}</Text>

                    <Divider />

                    <BlockStack gap="200">
                      <InlineStack gap="200">
                        <Text variant="bodySm" as="span" fontWeight="bold">Optimizes for:</Text>
                        <Text variant="bodySm" as="span">{plan.optimizes}</Text>
                      </InlineStack>
                      <InlineStack gap="200">
                        <Text variant="bodySm" as="span" fontWeight="bold">Audience:</Text>
                        <Text variant="bodySm" as="span">{plan.audience}</Text>
                      </InlineStack>
                      <InlineStack gap="200">
                        <Text variant="bodySm" as="span" fontWeight="bold">Pacing:</Text>
                        <Text variant="bodySm" as="span">{plan.pacing}</Text>
                      </InlineStack>
                    </BlockStack>

                    <Button
                      variant={currentPlan === plan.type ? "secondary" : "primary"}
                      onClick={() => selectPlan(plan.type)}
                      loading={navigation.state === "submitting"}
                      fullWidth
                    >
                      {currentPlan === plan.type ? "Switch to This Plan" : "Activate This Plan"}
                    </Button>
                  </BlockStack>
                </Card>
              </Box>
            ))}
          </InlineStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
