# EASYMODE — Launch Checklist (owner actions)

_Last updated 2026-10-10. Code triage + **live prod env verified via `/art-status`** (the real difference-maker — a code read can't see which env vars are actually set). Test suite run 3×: **277/277 green**._

**Bottom line — you're much closer than a code-only read implied.** Live `/art-status` confirms **Stripe, Email, Replicate, Anthropic, FAL and UploadPost are ALL already configured in prod.** Billing and email aren't "turn them on" gates anymore — they're on. What actually remains is small: one behavioral card test (A), a DNS check (B), and `SESSION_SECRET` (C). Everything flagged as a code risk (avatar gate, FTC ad-format guardrail, campaign auto-post safety) is implemented and live.

> Verified prod env (`/art-status`, 2026-10-10): `STRIPE_SECRET_KEY ✓` · `STRIPE_WEBHOOK ✓` · `EMAIL_READY ✓` · `REPLICATE ✓` · `ANTHROPIC ✓` · `FAL ✓` · `UPLOADPOST ✓` · **`SESSION_SECRET ✗ (not set)`**. Prod activity (24h): 33 image gens completed, 3 failed (~8%); 1 video completed, 0 failed.

---

## 🟡 A. Stripe — one live card test (the secret is already set)

`STRIPE_SECRET_KEY` and the webhook are **already live in prod** — billing is on. The only thing I can't do (live money) is verify the end-to-end flow once:

1. Run **one real card-gated trial** on the live site:
   - Start the 7-day trial → confirm Stripe collected the card (the gate is pinned in code: `payment_method_collection: "always"`, [stripe.server.ts:198](app/lib/stripe.server.ts:198)).
   - Confirm the plan activates immediately (webhook) **or** on next dashboard load (self-heal fallback `resolvePendingCheckout`, [stripe.server.ts:340](app/lib/stripe.server.ts:340)).
   - Let the trial convert (or use a Stripe test clock) → confirm the day-7 charge fires and tokens roll.
2. Confirm `SHOPIFY_APP_URL`/`STRIPE_WEBHOOK_URL_BASE` is the real public origin (`https://easymodeapp.com`) — the webhook registers against it. (`STRIPE_WEBHOOK ✓` in art-status means a signing secret already exists, so this is likely fine.)

## 🟡 B. Email — DNS check (the provider is already configured)

`EMAIL_READY ✓` means `EMAIL_API_KEY` **and** `EMAIL_FROM` are both set, so transactional mail / password-reset / digest are wired. The app can't verify DNS, so the one owner check:

1. Confirm **SPF + DKIM** (and ideally DMARC) TXT records exist for the `EMAIL_FROM` sending domain so mail isn't spam-binned. Send yourself a password-reset from `/web/forgot` as the real-world test. (MX only if you also want to *receive* at that domain.)

## 🟢 C. Other env / safety (quick owner settings)

- **Set `SESSION_SECRET`** — art-status shows it's **not set**, so cookie/link signing currently falls back to the Shopify client secret. The list-based rotation makes adding it safe with **no merchant logout**. (Only unset env in the list.)
- **Confirm `DEV_GRANT_KEY` is UNSET** in Render — if set, it arms a token-granting route (dark by default: [web.dev.tsx:35](app/routes/web.dev.tsx:35) 404s when unset). art-status deliberately does **not** report this one, so verify it in the dashboard directly.
- Confirm `PURGE_KEY` is set (gates the `/art-status` + `/api/diag` *detail* — names, failure text, per-shop activity; the aggregate status is intentionally public).
- `render.yaml` now lists all of these with `sync:false` so a blueprint re-sync won't leave them unprovisioned (values stay in the dashboard).

---

## ✅ Verified already done (no action)

- **Avatar-voices gate** — `LIVE_AVATARS` live; public cast = **21** designed voices (+1 private founder-only presenter = the "22"). Every picker uses it.
- **FTC ad-format guardrail** — the 9 worst fabrication formats are `retired:true` and filtered out; a `CLAIMS_GUARDRAIL` is wired into all 8 copy generators.
- **Campaign auto-post safety** — web builder defaults to SET_AND_FORGET, the publisher honors REVIEW_FIRST, and a backlog is paced (`CATCHUP_PER_SHOP=3`); auto-post only fires with `UPLOADPOST_API_KEY` + a linked social account.
- **Stripe webhook resilience** — not the sole writer; `resolvePendingCheckout` self-heals a missed webhook on next login, and the endpoint self-provisions at boot + ~every 10 min.
- **Pricing** — $19/$39/$69 marketing + $6.99 Creator, `video=150` tokens, matches intent. (Note: Creator is now free on every marketing plan while Stripe still has a paid Creator add-on line item — a minor product/billing inconsistency to reconcile later, not a blocker.)

## ⚠ Worth knowing (not blockers)

- **Double-billing on tier change** ([stripe.server.ts:512](app/lib/stripe.server.ts:512)): if Stripe's DELETE of a superseded sub fails, a merchant is billed for two plans until fixed by hand. Logged loudly but **no alerting** — someone has to read logs. Consider an alert.
- The 2 tests that were red are now green and were never wired into CI/Docker — consider adding `node --test` to the build so invariants can't ship broken silently.
