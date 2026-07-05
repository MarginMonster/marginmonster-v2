# MarginMonster v2 — Setup Checklist

## What this is
Shopify Remix app (embedded). Replaces the current Node.js profit-tracker architecture.
The Shopify app identity (client ID / secret) stays the same — reuse the existing MarginMonster app.

## Step 1 — Get your Shopify credentials
1. Go to: https://dev.shopify.com/dashboard/196587998/apps/391150927873/settings
2. Copy Client ID → `SHOPIFY_API_KEY` in your env
3. Reveal Client Secret → `SHOPIFY_API_SECRET` in your env

## Step 2 — Update shopify.app.toml
Replace `YOUR_CLIENT_ID` with your actual Client ID.
Replace `YOUR_HOST` with your Render URL once deployed.

## Step 3 — Create a Render service
Option A (blueprint): Push to GitHub, then use Render's Blueprint deploy with `render.yaml`.
Option B (manual): Create a Web Service + Postgres DB, set all env vars from `.env.example`.

The build command runs Prisma migrations automatically:
```
npm install && npx prisma generate && npx prisma migrate deploy && npm run build
```
Start command: `npm start`

## Step 4 — Set env vars on Render
All required vars are listed in `.env.example`. Required to boot:
- `SHOPIFY_API_KEY` + `SHOPIFY_API_SECRET` (from Step 1)
- `SHOPIFY_APP_URL` (your Render URL, e.g. `https://marginmonster.onrender.com`)
- `DATABASE_URL` (auto-set if using Render Postgres blueprint)
- `ANTHROPIC_API_KEY` (from console.anthropic.com)
- `REPLICATE_API_TOKEN` (from replicate.com)

Meta + TikTok vars are needed only when connecting ad accounts — app boots without them.

## Step 5 — Update Shopify app config
Run from the `marginmonster-remix` directory:
```
npx shopify app deploy
```
This pushes `shopify.app.toml` (scopes, webhooks, redirect URLs) to Shopify.
You'll need to be logged in: `npx shopify auth login`

## Step 6 — Install the app on your store
In the Dev Dashboard, use the "Test on development store" link or direct install URL.
On first install, the app auto-generates your brand profile (takes ~30 seconds).

## Step 7 — Connect ad accounts (optional)
Go to App → Ad Accounts → Connect Meta / Connect TikTok.
You'll need:
- Meta: A Facebook Developer App with Marketing API access + a Business ad account
- TikTok: A TikTok for Business developer app + advertiser account

## Step 8 — Pick a plan and start generating
Go to App → Choose Plan → select your goal → set weekly budget.
Content starts generating automatically. Review in the Content Queue.

## Known gaps (documented, not yet built)
- Video ad generation (image only for now)
- Dead-letter UI for failed jobs (check DB: `Job.status = 'FAILED'`)
- Multi-account picker for Meta/TikTok (currently takes first account)
- TikTok budget scaling API call in decisioning engine (Meta implemented, TikTok stubbed)

## Architecture notes
- Routes under `app/routes/app.*` are authenticated Shopify embedded routes
- `app/lib/*.server.ts` files are server-only (Remix convention)
- `worker.ts` is a standalone long-running process — run it as a separate Render service
  or use a cron job to hit `/api/worker/tick` (not yet wired, use the worker process for now)
- All campaigns are created PAUSED on both Meta and TikTok — nothing spends until you
  click Activate in the Campaigns tab or the decisioning engine scales a winner
