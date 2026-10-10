# EASYMODE — Launch Checklist (owner actions)

_Last updated 2026-10-10. Generated from a full code triage of billing, email, the Stripe webhook, the avatar gate, env usage, and the test suite (run 3×: **277/277 green**)._

**Bottom line:** no code change is required to turn the money on — the billing path is ready and verified. The real wall is two **owner-only** gates (A and B). Everything the earlier notes flagged as a code risk (avatar-voices gate, FTC ad-format guardrail, campaign auto-post safety) is **already implemented and live**.

---

## 🔴 A. Stripe — turn billing on + run one live trial (owner only)

I can't do this — it sets live secrets and runs a real card charge.

1. In the **Render dashboard**, set `STRIPE_SECRET_KEY` (live key).
2. Confirm `SHOPIFY_APP_URL` **or** `STRIPE_WEBHOOK_URL_BASE` is the real public origin (`https://easymodeapp.com`) — the webhook registers against it.
3. Run **one real card-gated trial** end-to-end on the live site:
   - Start the 7-day trial → confirm Stripe collected the card (the gate is pinned in code: `payment_method_collection: "always"`, [stripe.server.ts:198](app/lib/stripe.server.ts:198)).
   - Confirm the plan activates immediately (webhook) **or** on next dashboard load (self-heal fallback `resolvePendingCheckout`, [stripe.server.ts:340](app/lib/stripe.server.ts:340)).
   - Let the trial convert (or use a Stripe test clock) → confirm the day-7 charge fires and tokens roll.
4. `STRIPE_WEBHOOK_SECRET` is optional — the endpoint self-provisions and stores it if unset.

## 🔴 B. Email — provider + DNS (owner only)

Signup/login do **not** depend on email, so email-off is not a lockout — only password-reset-by-email, transactional mail, and the monthly digest go dark (reset degrades to a support fallback). Still needed for self-serve:

1. Set `EMAIL_API_KEY` + `EMAIL_FROM` (Resend) in Render — gates [email-provider.server.ts:14](app/lib/email-provider.server.ts:14).
2. Add **SPF + DKIM** TXT records (and DMARC) for the sending domain so mail isn't spam-binned. (MX only if you also want to *receive* at that domain.)

## 🟢 C. Other env / safety (quick owner settings)

- **Confirm `DEV_GRANT_KEY` is UNSET** in Render — if set, it arms a token-granting route. (Dark by default: [web.dev.tsx:35](app/routes/web.dev.tsx:35) 404s when unset.)
- Set `PURGE_KEY` (gates `/art-status` + `/api/diag` detail/purge).
- Recommended: set `SESSION_SECRET` (today cookie/link signing falls back to the Shopify client secret; the list-based rotation makes adding it safe with **no merchant logout**).
- Optional premium/organic: `FAL_KEY` (premium video; else omni-human fallback), `UPLOADPOST_API_KEY` (organic auto-posting; unset = campaigns forge + hold READY).
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
