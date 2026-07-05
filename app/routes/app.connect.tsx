import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
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

  return json({
    metaAccount: metaAccount ? { id: metaAccount.externalId, name: metaAccount.name } : null,
    tiktokAccount: tiktokAccount ? { id: tiktokAccount.externalId, name: tiktokAccount.name } : null,
    metaOAuthUrl: buildMetaOAuthUrl(session.shop),
    tiktokOAuthUrl: buildTikTokOAuthUrl(session.shop),
  });
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
  const { metaAccount, tiktokAccount, metaOAuthUrl, tiktokOAuthUrl } =
    useLoaderData<typeof loader>();

  return (
    <Page title="Connect Ad Accounts" backAction={{ content: "Home", url: "/app" }} subtitle="Link your Meta and TikTok ad accounts to start publishing campaigns.">
      <Layout>
        <Layout.Section>
          <Banner tone="info" title="Ad accounts required to launch campaigns">
            <p>You can generate and approve content without connecting ad accounts. Connect when you're ready to publish.</p>
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
