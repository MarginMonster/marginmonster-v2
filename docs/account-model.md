# Account Model Blueprint — one hub, many front doors

The plan for taking EasyMode from "a Shopify app" to "a product with a Shopify
app" — website first, mobile later — without ever splitting the data.

## The shape

```
        WEBSITE              SHOPIFY APP           MOBILE (later)
   easymodeapp.com        (embedded, current)      iOS / Android
        │                        │                      │
        └────────────────────────┼──────────────────────┘
                                 │
                    THE HUB (already running)
                 Remix on Render + Postgres
        accounts · token wallet · jobs · pipelines · assets
```

Wix/WordPress/Shopify are **front doors**, not hubs. The hub is our own
backend — it already exists and already does the hard parts (token metering,
job queue, AI pipelines, billing state). Every platform is a client of it.

## Step 1 — promote `Shop` → `Account`

Today `Shop` (keyed by myshopify domain) IS the identity. Tomorrow:

```prisma
model Account {
  id            String   @id @default(cuid())
  email         String   @unique      // login for web/mobile
  passwordHash  String?               // null = shopify-only account so far
  createdAt     DateTime @default(now())
  plan          Plan?                 // the ONE wallet moves here
  connections   Connection[]
  // brandProfile, assets, jobs, achievements… all re-parent here over time
}

model Connection {
  id         String  @id @default(cuid())
  accountId  String
  kind       String  // "shopify" | "web" | "ios" | "android"
  externalId String  // myshopify domain, apple sub id, etc.
  @@unique([kind, externalId])
}
```

Migration is additive and safe:
1. Add `Account` + `Connection`; backfill one Account per existing Shop
   (email from the shop's contact email; `Connection(kind:"shopify")`).
2. Point `Plan` (the wallet) at `Account` instead of `Shop` — this is THE
   critical move; everything else can stay shop-keyed and follow gradually.
3. New web signups create an Account with no shopify Connection. Later
   "Connect your Shopify store" just adds the Connection — same wallet.

## Step 2 — billing per platform, one wallet

| Front door | Charged via | Credits |
|---|---|---|
| Website | Stripe (or Paddle for MoR/tax) | the Account wallet |
| Shopify app | Shopify Billing (unchanged) | the same wallet |
| Mobile | Apple/Google IAP (required for in-app) | the same wallet |

Rules that keep this sane:
- The wallet has ONE balance; `spendTokens`/`refundTokens` don't care who
  funded it.
- An Account has ONE active plan at a time, tagged with its billing source.
  Switching platforms = cancel there, subscribe here (don't build proration
  across providers — nobody does).
- Web is the account/billing "home base": mobile apps link out to it for
  subscription management, which also legally sidesteps Apple's 30% on plans
  bought on the web.

## Step 3 — the website front door (the "instant win")

Mostly a shell + auth job; the product already works without Shopify:
- **Auth**: email+password or magic link, session cookie (Remix session
  storage already in the stack).
- **Routes**: a `web.*` (or subdomain) layout that mounts the SAME studio,
  archive, campaigns UIs minus Polaris/App Bridge.
- **Product input**: already built — the Studio's import-by-URL path works for
  any storefront.
- **Gate Shopify-write features** (push listing to store, auto-publish blog to
  Shopify) behind "Connect your store"; everything else works day one.
- **Billing**: Stripe Checkout + webhook → set `Plan` on the Account.

## Step 4 — mobile (later)
- Thin JSON API layer over the same loaders/actions (`/api/v1/*`), token auth.
- Ship as a wrapper (Capacitor/Expo WebView) first; native later if it earns it.

## Order of operations
1. `Account`/`Connection` tables + backfill (no behavior change).
2. Wallet re-parent to Account (guarded rollout).
3. Web auth + Stripe + non-embedded shell → **launch easymodeapp.com**.
4. Shopify App Store listing (parallel track — see shopify-submission.md).
5. Mobile wrapper once web revenue proves the funnel.
