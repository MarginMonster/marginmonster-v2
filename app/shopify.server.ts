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
  GROWTH: { amount: 39, currencyCode: "USD", interval: BillingInterval.Every30Days },
  PRO: { amount: 79, currencyCode: "USD", interval: BillingInterval.Every30Days },
  SCALE: { amount: 149, currencyCode: "USD", interval: BillingInterval.Every30Days },
} as const;

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: ApiVersion.January25,
  // Hardcoded (not from env) so the app's requested scopes always match the
  // released app version. read_orders/read_customers are intentionally NOT
  // here — they are protected customer data that 403-gates all Admin API
  // access for a public app until PCD approval.
  scopes: ["read_products", "write_marketing_events"],
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
      // Webhooks declared in the app config are auto-registered by Shopify —
      // calling registerWebhooks manually can 403 under the new auth strategy,
      // so we skip it. Everything here is wrapped so a hiccup never blocks
      // the install.
      try {
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
      } catch (e) {
        console.error("[afterAuth] non-fatal setup error:", e);
      }
    },
  },
  // Standard OAuth (authorization code flow) — produces a reliable offline
  // token. The experimental token-exchange strategy was returning tokens the
  // Admin API rejected with 403 for this public app.
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
