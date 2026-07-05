import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { db } from "../db.server";
import * as tiktokAds from "../lib/tiktok-ads.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const shop = url.searchParams.get("state");

  if (!code || !shop) {
    return redirect("/app/connect?error=tiktok_oauth_failed");
  }

  // Exchange code for access token
  const tokenRes = await fetch("https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: process.env.TIKTOK_APP_ID,
      secret: process.env.TIKTOK_APP_SECRET,
      auth_code: code,
    }),
  });

  if (!tokenRes.ok) {
    return redirect("/app/connect?error=tiktok_token_exchange_failed");
  }

  const tokenData = await tokenRes.json() as { data: { access_token: string } };
  const accessToken = tokenData.data.access_token;

  const accounts = await tiktokAds.listAdAccounts(accessToken);
  if (!accounts.length) {
    return redirect("/app/connect?error=no_tiktok_ad_accounts");
  }

  const account = accounts[0];
  const shopRecord = await db.shop.findUnique({ where: { domain: decodeURIComponent(shop) } });
  if (!shopRecord) {
    return redirect("/app/connect?error=shop_not_found");
  }

  await db.adAccount.upsert({
    where: { shopId_platform: { shopId: shopRecord.id, platform: "TIKTOK" } },
    create: {
      shopId: shopRecord.id,
      platform: "TIKTOK",
      externalId: account.advertiser_id,
      name: account.advertiser_name,
      accessToken,
    },
    update: {
      externalId: account.advertiser_id,
      name: account.advertiser_name,
      accessToken,
    },
  });

  return redirect("/app/connect?success=tiktok_connected");
};
