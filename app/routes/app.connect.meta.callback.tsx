import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { db } from "../db.server";
import { verifyOAuthState } from "../lib/oauth-state.server";
import * as metaAds from "../lib/meta-ads.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  // This route does not authenticate — it cannot, it is a redirect back from
  // the ad platform. `state` used to be the raw shop domain, so completing
  // this flow with a hand-edited state wrote a live ad-account token against
  // somebody else's shop. Only a state we minted and signed is trusted.
  const shop = verifyOAuthState(url.searchParams.get("state"));

  if (!code || !shop) {
    return redirect("/app/connect?error=meta_oauth_failed");
  }

  // Exchange code for user access token
  const tokenRes = await fetch("https://graph.facebook.com/v20.0/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      redirect_uri: `${process.env.SHOPIFY_APP_URL}/app/connect/meta/callback`,
      code,
    }),
  });

  if (!tokenRes.ok) {
    return redirect("/app/connect?error=meta_token_exchange_failed");
  }

  const tokenData = await tokenRes.json() as { access_token: string };
  const userToken = tokenData.access_token;

  // Pick the first ad account (UI for multi-account selection is a future enhancement)
  const accounts = await metaAds.listAdAccounts(userToken);
  if (!accounts.length) {
    return redirect("/app/connect?error=no_meta_ad_accounts");
  }

  const account = accounts[0];
  const shopRecord = await db.shop.findUnique({ where: { domain: shop } });
  if (!shopRecord) {
    return redirect("/app/connect?error=shop_not_found");
  }

  await db.adAccount.upsert({
    where: { shopId_platform: { shopId: shopRecord.id, platform: "META" } },
    create: {
      shopId: shopRecord.id,
      platform: "META",
      externalId: account.id,
      name: account.name,
      accessToken: userToken,
    },
    update: {
      externalId: account.id,
      name: account.name,
      accessToken: userToken,
    },
  });

  return redirect("/app/connect?success=meta_connected");
};
