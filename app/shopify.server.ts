import "@shopify/shopify-app-remix/adapters/node";
import { PLAN_BY_KEY, annualPrice } from "./lib/plan-config";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  DeliveryMethod,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { db } from "./db.server";
import "./worker.server"; // starts the in-process job worker on server boot

// Subscription plans — amounts must match app/lib/plan-config.ts.
// These names are the `plan` keys passed to billing.request().
// Every plan opens with a 7-day free trial (the low-friction wedge): the
// merchant approves the subscription but isn't charged until the trial ends,
// so they can experience real value before paying a cent.
const TRIAL_DAYS = 7;
/* THE PRICE CHARGED IS THE PRICE SHOWN.
 *
 * These amounts used to be typed out here as well as in plan-config.ts, under
 * a comment saying the two "must match". They did not: the plans page and the
 * marketing site render PLAN_TIERS and showed $39 and $69, while Shopify was
 * told to charge $59 and $99 — so a merchant read one number, approved the
 * confirmation, and was billed 51% more, every month. The Stripe path takes
 * its amount from tier.price and was always correct, which meant the same
 * plan cost different money depending on which door the merchant came in by.
 *
 * Derived now, so the two cannot drift again. plan-config.ts imports nothing,
 * so this is a leaf dependency with no cycle.
 *
 * NOTE: this fixes NEW subscriptions. Shopify keeps billing an existing
 * AppSubscription at the amount it was approved at, so anyone already on
 * STUDIO or ANTHEM stays at the old price until they re-subscribe. */
const tierPrice = (key: "STARTER" | "STUDIO" | "ANTHEM") => PLAN_BY_KEY[key].price;

export const BILLING_PLANS = {
  // Current 3-tier ladder — amounts come from app/lib/plan-config.ts.
  STARTER: { amount: tierPrice("STARTER"), currencyCode: "USD", interval: BillingInterval.Every30Days, trialDays: TRIAL_DAYS },
  STUDIO: { amount: tierPrice("STUDIO"), currencyCode: "USD", interval: BillingInterval.Every30Days, trialDays: TRIAL_DAYS },
  ANTHEM: { amount: tierPrice("ANTHEM"), currencyCode: "USD", interval: BillingInterval.Every30Days, trialDays: TRIAL_DAYS },
  // Legacy ladder — kept registered so existing subscriptions keep verifying;
  // never offered in the UI. Gating maps them via LEGACY_TIER_MAP.
  GROWTH: { amount: 39, currencyCode: "USD", interval: BillingInterval.Every30Days, trialDays: TRIAL_DAYS },
  PRO: { amount: 79, currencyCode: "USD", interval: BillingInterval.Every30Days, trialDays: TRIAL_DAYS },
  SCALE: { amount: 149, currencyCode: "USD", interval: BillingInterval.Every30Days, trialDays: TRIAL_DAYS },
} as const;

// Annual billing — pay for 10 months, get 12 (amounts = monthly × 10). Same
// 7-day trial. Keys mirror the tier keys with an _ANNUAL suffix.
export const BILLING_PLANS_ANNUAL = {
  // annualPrice() is the same "pay for 10 months" rule the pricing page uses.
  STARTER_ANNUAL: { amount: annualPrice(PLAN_BY_KEY.STARTER), currencyCode: "USD", interval: BillingInterval.Annual, trialDays: TRIAL_DAYS },
  STUDIO_ANNUAL: { amount: annualPrice(PLAN_BY_KEY.STUDIO), currencyCode: "USD", interval: BillingInterval.Annual, trialDays: TRIAL_DAYS },
  ANTHEM_ANNUAL: { amount: annualPrice(PLAN_BY_KEY.ANTHEM), currencyCode: "USD", interval: BillingInterval.Annual, trialDays: TRIAL_DAYS },
  // Legacy annual keys — same deal as above.
  GROWTH_ANNUAL: { amount: 390, currencyCode: "USD", interval: BillingInterval.Annual, trialDays: TRIAL_DAYS },
  PRO_ANNUAL: { amount: 790, currencyCode: "USD", interval: BillingInterval.Annual, trialDays: TRIAL_DAYS },
  SCALE_ANNUAL: { amount: 1490, currencyCode: "USD", interval: BillingInterval.Annual, trialDays: TRIAL_DAYS },
} as const;

// One-time token top-ups — amounts must match TOKEN_PACKS in plan-config.ts.
export const TOKEN_PACK_PLANS = {
  TOKENS_250: { amount: 25, currencyCode: "USD", interval: BillingInterval.OneTime },
  TOKENS_750: { amount: 60, currencyCode: "USD", interval: BillingInterval.OneTime },
  TOKENS_2000: { amount: 140, currencyCode: "USD", interval: BillingInterval.OneTime },
} as const;
export const TOKENS_BY_PACK: Record<keyof typeof TOKEN_PACK_PLANS, number> = {
  TOKENS_250: 250,
  TOKENS_750: 750,
  TOKENS_2000: 2000,
};

/** Test mode is the DEFAULT — no real money moves until BILLING_TEST=0 is set
 *  in the environment. Test charges still exercise the full approval flow on
 *  development stores. */
export function billingIsTest(): boolean {
  return process.env.BILLING_TEST !== "0";
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: ApiVersion.October25,
  // Hardcoded (not from env) so the app's requested scopes always match the
  // released app version. read_orders/read_customers are intentionally NOT
  // here — they are protected customer data that 403-gates all Admin API
  // access for a public app until PCD approval.
  scopes: ["read_products", "write_products", "write_marketing_events"],
  appUrl: process.env.SHOPIFY_APP_URL!,
  authPathPrefix: "/auth",
  // Public apps created on/after 2026-04-01 MUST use expiring tokens — Shopify
  // 403-rejects non-expiring offline tokens. Online tokens expire, satisfying
  // the requirement; the SDK re-exchanges them automatically when they lapse.
  useOnlineTokens: true,
  sessionStorage: new PrismaSessionStorage(db),
  distribution: AppDistribution.AppStore,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK generic inference quirk; runtime shape is correct
  billing: { ...BILLING_PLANS, ...BILLING_PLANS_ANNUAL, ...TOKEN_PACK_PLANS } as any,
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks",
    },
    PRODUCTS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks",
    },
    // Billing truth: cancellations/declines flip the plan off server-side
    APP_SUBSCRIPTIONS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
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
            data: { domain: session.shop, accessToken: session.accessToken || "" },
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
  // Managed-install apps (new Dev Dashboard) require the token-exchange
  // strategy — disabling it breaks auth (401).
  future: { unstable_newEmbeddedAuthStrategy: true },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
