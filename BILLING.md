# Billing — how to turn on real charges

## Current status
Plan selection works and activates the plan, but **no money is charged yet.**

Shopify's Billing API returns:
> "This application is currently owned by a Shop. It must be migrated to the
> Shopify Partners area before it can create charges with the API."

MarginMonster was created as a **shop-owned app**. Shopify's Billing API only
lets **Partner-owned apps** create subscription charges. This is a Shopify
account rule — not a code issue. The billing code is already correct and will
start charging automatically the moment the app is Partner-owned.

## What must happen (account owner action)
To charge real merchants, the app must be owned by a **Partner organization**:

1. Create/confirm a free Partner account at **partners.shopify.com**
   (or confirm the org `196587998` is a Partner org, not a shop).
2. Transfer/migrate the MarginMonster app to that Partner organization.
   - New Dev Dashboard: the app must be created under the Partner org, not
     tied to the store. If it can't be transferred in place, the practical
     path is to create the app under the Partner org and re-point this same
     codebase at it (new Client ID/Secret + reinstall).
3. Once Partner-owned, no code change is needed — the existing
   `billing.request(...)` in `app/routes/app.plans.tsx` will show Shopify's
   charge-approval screen and process the subscription.

## When ready to charge for real
In `app/routes/app.plans.tsx`, change `isTest: true` → `isTest: false` in the
`billing.request` call. Keep `true` for testing (no real money).

## Plans are defined in two places (keep them in sync)
- Prices/quotas shown to users: `app/lib/plan-config.ts`
- Billing amounts charged: `BILLING_PLANS` in `app/shopify.server.ts`
