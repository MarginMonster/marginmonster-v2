import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
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
  Checkbox,
  Icon,
} from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import {
  PLAN_TIERS,
  ADDONS,
  monthlyTotal,
  type PlanTypeKey,
} from "../lib/plan-config";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true },
  });
  return json({ current: shop?.activePlan || null });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();

  const type = form.get("planType") as PlanTypeKey;
  const reviewMode = form.get("reviewMode") as "SET_AND_FORGET" | "REVIEW_FIRST";
  const adCreativePack = form.get("adCreativePack") === "true";
  const campaignAutopilot = form.get("campaignAutopilot") === "true";

  const tier = PLAN_TIERS[type];
  if (!tier) throw new Error("Invalid plan");

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) throw new Error("Shop not found");

  await db.plan.upsert({
    where: { shopId: shop.id },
    create: {
      shopId: shop.id,
      type,
      reviewMode,
      adCreativePack,
      campaignAutopilot,
      blogQuota: tier.blogQuota,
      videoQuota: tier.videoQuota,
      periodStart: new Date(),
    },
    update: {
      type,
      reviewMode,
      adCreativePack,
      campaignAutopilot,
      blogQuota: tier.blogQuota,
      videoQuota: tier.videoQuota,
      active: true,
    },
  });

  // NOTE: real billing goes through Shopify's Billing API — see BILLING.md.
  return redirect("/app");
};

export default function Plans() {
  const { current } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [selected, setSelected] = useState<PlanTypeKey>(
    (current?.type as PlanTypeKey) || "SEO_AUTOPILOT"
  );
  const [reviewMode, setReviewMode] = useState<string>(
    current?.reviewMode || "REVIEW_FIRST"
  );
  const [adCreativePack, setAdCreativePack] = useState(
    current?.adCreativePack || false
  );
  const [campaignAutopilot, setCampaignAutopilot] = useState(
    current?.campaignAutopilot || false
  );

  const total = monthlyTotal(selected, { adCreativePack, campaignAutopilot });

  const activate = () => {
    submit(
      {
        planType: selected,
        reviewMode,
        adCreativePack: String(adCreativePack),
        campaignAutopilot: String(campaignAutopilot),
      },
      { method: "post" }
    );
  };

  return (
    <Page
      title="Build your autopilot"
      subtitle="Pick your engine, choose how hands-on you want to be, then let it run."
    >
      <Layout>
        {/* Core plan choice */}
        <Layout.Section>
          <InlineStack gap="400" wrap align="start">
            {(Object.values(PLAN_TIERS) as (typeof PLAN_TIERS)[PlanTypeKey][]).map(
              (tier) => {
                const isSel = selected === tier.key;
                return (
                  <Box key={tier.key} minWidth="320px" maxWidth="380px">
                    <div
                      onClick={() => setSelected(tier.key)}
                      style={{
                        cursor: "pointer",
                        border: isSel
                          ? "2px solid var(--mm-gold, #C9972B)"
                          : "2px solid transparent",
                        borderRadius: 16,
                      }}
                    >
                      <Card>
                        <BlockStack gap="400">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text variant="headingLg" as="h3">
                              {tier.name}
                            </Text>
                            {isSel && <Badge tone="success">Selected</Badge>}
                          </InlineStack>

                          <InlineStack blockAlign="end" gap="100">
                            <Text variant="heading2xl" as="p">
                              ${tier.price}
                            </Text>
                            <Text variant="bodyMd" as="span" tone="subdued">
                              /month
                            </Text>
                          </InlineStack>

                          <Text variant="bodyMd" as="p" tone="subdued">
                            {tier.tagline}
                          </Text>

                          <Divider />

                          <BlockStack gap="200">
                            {tier.features.map((f) => (
                              <InlineStack key={f} gap="200" blockAlign="start" wrap={false}>
                                <div style={{ color: "var(--mm-green, #4B7B4E)", flexShrink: 0 }}>
                                  <Icon source={CheckIcon} />
                                </div>
                                <Text variant="bodyMd" as="span">
                                  {f}
                                </Text>
                              </InlineStack>
                            ))}
                          </BlockStack>
                        </BlockStack>
                      </Card>
                    </div>
                  </Box>
                );
              }
            )}
          </InlineStack>
        </Layout.Section>

        {/* Review mode */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h3">
                How hands-on do you want to be?
              </Text>
              <ChoiceList
                title=""
                titleHidden
                choices={[
                  {
                    label: "Set-and-forget — content publishes automatically",
                    value: "SET_AND_FORGET",
                    helpText:
                      "We generate and publish on schedule. Zero effort. You can still edit anything after it's live.",
                  },
                  {
                    label: "Review first — approve or edit before anything publishes",
                    value: "REVIEW_FIRST",
                    helpText:
                      "Every post/video waits in your queue with a 24h notice. Full editing control before it goes live.",
                  },
                ]}
                selected={[reviewMode]}
                onChange={(v) => setReviewMode(v[0])}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Add-ons */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h3">
                Supercharge it (optional)
              </Text>
              <Checkbox
                label={`${ADDONS.adCreativePack.name} — +$${ADDONS.adCreativePack.price}/mo`}
                helpText={ADDONS.adCreativePack.description}
                checked={adCreativePack}
                onChange={setAdCreativePack}
              />
              <Checkbox
                label={`${ADDONS.campaignAutopilot.name} — +$${ADDONS.campaignAutopilot.price}/mo`}
                helpText={ADDONS.campaignAutopilot.description}
                checked={campaignAutopilot}
                onChange={setCampaignAutopilot}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Summary + activate */}
        <Layout.Section>
          <Card>
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text variant="headingLg" as="p">
                  ${total}
                  <Text as="span" variant="bodyMd" tone="subdued">
                    {" "}
                    /month
                  </Text>
                </Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  {PLAN_TIERS[selected].name}
                  {adCreativePack ? " + Ad Creative Pack" : ""}
                  {campaignAutopilot ? " + Campaign Autopilot" : ""}
                  {" · need more? top up with credits anytime."}
                </Text>
              </BlockStack>
              <Button
                variant="primary"
                size="large"
                onClick={activate}
                loading={navigation.state === "submitting"}
              >
                {current ? "Update my plan" : "Activate autopilot"}
              </Button>
            </InlineStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
