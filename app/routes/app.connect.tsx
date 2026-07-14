import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useActionData, useNavigation } from "@remix-run/react";
import { useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { socialProviderEnabled, connectUrl, refreshLinkedPlatforms, linkedFromCache } from "../lib/social-provider.server";

// Meta OAuth: direct user to Facebook auth, then handle callback at /app/connect/meta/callback
// TikTok OAuth: similar flow via /app/connect/tiktok/callback
// These are separate route files for the callback handlers.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { adAccounts: true },
  });

  const metaAccount = shop?.adAccounts.find((a) => a.platform === "META");
  const tiktokAccount = shop?.adAccounts.find((a) => a.platform === "TIKTOK");

  // social auto-posting state — refresh the provider link cache on each visit
  // (this is where merchants land right after linking accounts)
  let linked: string[] = linkedFromCache(shop?.socialsJson);
  if (shop?.socialProfileKey) {
    try { linked = await refreshLinkedPlatforms(shop.id); } catch { /* cache stands */ }
  }

  return json({
    metaAccount: metaAccount ? { id: metaAccount.externalId, name: metaAccount.name } : null,
    tiktokAccount: tiktokAccount ? { id: tiktokAccount.externalId, name: tiktokAccount.name } : null,
    metaOAuthUrl: buildMetaOAuthUrl(session.shop),
    tiktokOAuthUrl: buildTikTokOAuthUrl(session.shop),
    posterEnabled: socialProviderEnabled(),
    linked,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") === "connectSocials") {
    const shop = await db.shop.findUnique({ where: { domain: session.shop } });
    if (!shop) return json({ error: "Shop not found" });
    // Bounce the merchant back INTO the embedded admin (a bare app URL would
    // 401 outside Shopify — same rule as the billing return URL).
    const storeHandle = session.shop.replace(/\.myshopify\.com$/, "");
    const appHandle = process.env.SHOPIFY_APP_HANDLE || "marginmonster-1";
    const returnUrl = `https://admin.shopify.com/store/${storeHandle}/apps/${appHandle}/app/connect`;
    const url = await connectUrl(shop.id, returnUrl);
    if (!url) return json({ error: "Couldn't reach the posting service — check the UPLOADPOST_API_KEY or try again." });
    return json({ connectSocialsUrl: url });
  }
  return json({ ok: true });
};

function buildMetaOAuthUrl(shop: string): string {
  const appId = process.env.META_APP_ID || "";
  const redirectUri = encodeURIComponent(`${process.env.SHOPIFY_APP_URL}/app/connect/meta/callback`);
  const scope = "ads_management,ads_read,business_management";
  const state = encodeURIComponent(shop);
  return `https://www.facebook.com/v20.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}`;
}

function buildTikTokOAuthUrl(shop: string): string {
  const appId = process.env.TIKTOK_APP_ID || "";
  const redirectUri = encodeURIComponent(`${process.env.SHOPIFY_APP_URL}/app/connect/tiktok/callback`);
  const state = encodeURIComponent(shop);
  return `https://business-api.tiktok.com/portal/auth?app_id=${appId}&redirect_uri=${redirectUri}&state=${state}`;
}

export default function Connect() {
  const { metaAccount, tiktokAccount, metaOAuthUrl, tiktokOAuthUrl, posterEnabled, linked } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const connectUrlOut = actionData && "connectSocialsUrl" in actionData ? (actionData.connectSocialsUrl as string) : null;
  const connectErr = actionData && "error" in actionData ? (actionData.error as string) : null;

  // linking happens on the provider's hosted page — top-level redirect out
  useEffect(() => {
    if (!connectUrlOut) return;
    try { if (window.top) { window.top.location.href = connectUrlOut; return; } } catch { /* cross-origin */ }
    window.open(connectUrlOut, "_top");
  }, [connectUrlOut]);

  const PLAT_LABEL: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook" };
  const isLinked = (p: string) => linked.includes(p);

  return (
    <Page title="Connect Accounts" backAction={{ content: "Home", url: "/app" }} subtitle="Link your socials for auto-posting, and your ad accounts to launch paid campaigns.">
      <Layout>
        {/* THE headline capability: auto-posting to socials */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingLg" as="h2">📲 Auto-posting — the hands-off engine</Text>
                {linked.length > 0 ? <Badge tone="success">Armed</Badge> : <Badge tone="attention">Not connected</Badge>}
              </InlineStack>
              <Text variant="bodyMd" as="p" tone="subdued">
                Link once and your campaigns post themselves — every video and ad goes live on TikTok,
                Instagram, and Facebook at peak times, all month, with zero clicks from you.
              </Text>

              {connectErr && <Banner tone="critical"><p>{connectErr}</p></Banner>}

              {!posterEnabled ? (
                <Banner tone="warning" title="Auto-posting isn't switched on yet">
                  <p>The posting service key (UPLOADPOST_API_KEY) isn't configured on the server. Once it's set, this becomes one-click.</p>
                </Banner>
              ) : (
                <>
                  <InlineStack gap="300" wrap>
                    {(["tiktok", "instagram", "facebook"] as const).map((p) => (
                      <Badge key={p} tone={isLinked(p) ? "success" : undefined}>
                        {`${isLinked(p) ? "✓ " : ""}${PLAT_LABEL[p]}`}
                      </Badge>
                    ))}
                  </InlineStack>
                  <InlineStack gap="200">
                    <Button
                      variant="primary"
                      loading={nav.state !== "idle"}
                      onClick={() => submit({ intent: "connectSocials" }, { method: "post" })}
                    >
                      {linked.length > 0 ? "Manage connected socials" : "Connect TikTok, Instagram & Facebook"}
                    </Button>
                  </InlineStack>
                  {linked.length > 0 && (
                    <Text variant="bodySm" as="p" tone="subdued">
                      ✓ Armed on {linked.map((p) => PLAT_LABEL[p] || p).join(", ")}. Your active campaigns will auto-post from here.
                    </Text>
                  )}
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Banner tone="info" title="Ad accounts (optional) — for paid campaigns">
            <p>Auto-posting above covers organic content. Connect Meta/TikTok ad accounts below only when you want to run paid ad spend (that always runs on your own account — we never touch your budget).</p>
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <InlineStack gap="400" wrap>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h3">Meta (Facebook & Instagram)</Text>
                  {metaAccount ? (
                    <Badge tone="success">Connected</Badge>
                  ) : (
                    <Badge tone="attention">Not connected</Badge>
                  )}
                </InlineStack>

                {metaAccount ? (
                  <BlockStack gap="200">
                    <Text variant="bodyMd" as="p">Account: {metaAccount.name}</Text>
                    <Text variant="bodyMd" as="p" tone="subdued">ID: {metaAccount.id}</Text>
                    <Button url={metaOAuthUrl} external>Reconnect / Switch Account</Button>
                  </BlockStack>
                ) : (
                  <BlockStack gap="200">
                    <Text variant="bodyMd" as="p" tone="subdued">
                      Connect your Meta Business ad account to run campaigns on Facebook and Instagram.
                    </Text>
                    <Button variant="primary" url={metaOAuthUrl} external>
                      Connect Meta
                    </Button>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h3">TikTok for Business</Text>
                  {tiktokAccount ? (
                    <Badge tone="success">Connected</Badge>
                  ) : (
                    <Badge tone="attention">Not connected</Badge>
                  )}
                </InlineStack>

                {tiktokAccount ? (
                  <BlockStack gap="200">
                    <Text variant="bodyMd" as="p">Account: {tiktokAccount.name}</Text>
                    <Text variant="bodyMd" as="p" tone="subdued">ID: {tiktokAccount.id}</Text>
                    <Button url={tiktokOAuthUrl} external>Reconnect / Switch Account</Button>
                  </BlockStack>
                ) : (
                  <BlockStack gap="200">
                    <Text variant="bodyMd" as="p" tone="subdued">
                      Connect your TikTok for Business ad account to run video and image campaigns.
                    </Text>
                    <Button url={tiktokOAuthUrl} external>Connect TikTok</Button>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </InlineStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
