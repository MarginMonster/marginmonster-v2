import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { db } from "./db.server";
import "./worker.server"; // starts the in-process job worker on server boot

// Subscription plans — amounts must match app/lib/plan-config.ts.
// These names are the `plan` keys passed to billing.request().
export const BILLING_PLANS = {
  STARTER: { amount: 19, currencyCode: "USD", interval: BillingInterval.Every30Days },
  GROWTH: { amount: 49, currencyCode: "USD", interval: BillingInterval.Every30Days },
  PRO: { amount: 99, currencyCode: "USD", interval: BillingInterval.Every30Days },
  SCALE: { amount: 199, currencyCode: "USD", interval: BillingInterval.Every30Days },
} as const;

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL!,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(db),
  distribution: AppDistribution.AppStore,
  billing: BILLING_PLANS,
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: "http" as const,
      callbackUrl: "/webhooks",
    },
    PRODUCTS_CREATE: {
      deliveryMethod: "http" as const,
      callbackUrl: "/webhooks",
    },
  },
  hooks: {
    afterAuth: async ({ session }) => {
      shopify.registerWebhooks({ session });

      // Upsert shop record and kick off brand profile generation
      const existing = await db.shop.findUnique({
        where: { domain: session.shop },
      });
      if (!existing) {
        await db.shop.create({
          data: { domain: session.shop, accessToken: session.accessToken },
        });
        await db.job.create({
          data: {
            shop: { connect: { domain: session.shop } },
            type: "GENERATE_BRAND_PROFILE",
            payload: JSON.stringify({ shop: session.shop }),
          },
        });
      } else if (existing.accessToken !== session.accessToken) {
        await db.shop.update({
          where: { domain: session.shop },
          data: { accessToken: session.accessToken },
        });
      }
    },
  },
  future: { unstable_newEmbeddedAuthStrategy: true },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
