# Shopify App Store Submission Pack

Everything needed to take EasyMode from "installed on our dev store" to "listed
on the Shopify App Store." Work top to bottom; the listing copy at the end is
paste-ready.

## 1. Readiness checklist

### Already done ✅
- [x] Embedded app with App Bridge + Polaris (session token auth)
- [x] Billing through Shopify Billing API (plans + token top-ups)
- [x] GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`)
- [x] Minimal scopes: `read_products`, `write_products`, `write_marketing_events`
- [x] 7-day free trial on paid plans + annual plans
- [x] AI-content disclosure + "Made with EasyMode" watermark
- [x] Onboarding that generates first content automatically (time-to-value)
- [x] App Bridge review prompt after first win

### To do before submitting
- [ ] **Partner Dashboard → Distribution**: switch the app from custom/dev to
      **Public distribution** (this is irreversible for the app record).
- [ ] **App URL + redirect URLs** are already prod (`marginmonster-fiew.onrender.com`)
      — consider a branded domain (e.g. `app.easymodeapp.com`) BEFORE listing,
      because changing it after listing means re-review.
- [ ] **Privacy policy URL** — publish one (easymodeapp.com/privacy) and set it
      in the Partner Dashboard. Must name the AI subprocessors (Anthropic,
      Replicate, fal.ai) and what product data is sent to them.
- [ ] **Support contact** — an email (e.g. support@easymodeapp.com) monitored
      daily; reviewers test it.
- [ ] **Listing assets** (specs below): icon 1200×1200, feature banner
      1600×900, 3-6 screenshots (1600×900 desktop, plus mobile shots),
      optional 2-3 min demo video (reviewers love it, merchants convert on it).
- [ ] **Test instructions for the reviewer**: a demo store they can install on,
      with a note that video generation takes 2-5 minutes.
- [ ] **Run the review gauntlet yourself**: fresh install on a clean dev store →
      onboarding → plan pick (test mode) → generate one of each content type →
      uninstall (verify webhooks fire and data cleans up).

## 2. Review-killer traps (fix before they find them)
1. **Billing must gate cleanly** — every generate action already checks
   `activePlan`; make sure the no-plan state shows the plans page, not an error.
2. **Uninstall → reinstall must work** — token exchange re-auths, plan state
   resets sanely.
3. **Slow generations need progress UI** — the Archive's "rendering" state
   covers this; make sure a brand-new shop sees it on their FIRST generation.
4. **No dead ends** — every coming-soon/empty state needs a CTA somewhere.
5. **Performance** — reviewers run Lighthouse on the embedded app; Polaris +
   our CSS is fine, but don't ship 400KB+ of unused CSS forever (see backlog).

## 3. Listing copy (paste-ready)

**App name**: EasyMode — AI Videos, Ads & SEO

**Tagline** (70 chars max):
> Your product → scroll-stopping videos, ads & SEO content. On autopilot.

**Intro** (100 chars):
> Turn any product into UGC videos, image ads, blogs & landing pages — made by AI, in your voice.

**Description**:
> **Still trying to figure out Zeely or Arcads? EasyMode is the whole studio.**
>
> Pick a product. Pick a style. EasyMode writes the script in your brand's
> voice, casts a presenter (or a cartoon, or a jingle), renders the video,
> burns in captions, and drops it in your Archive — ready to post.
>
> **What you get**
> - 🎬 **Avatar AI videos** — a real-looking presenter holds YOUR product and
>   sells it, lip-synced, captioned, vertical.
> - 🎨 **Viral cartoon ads** — your product redrawn in the 8 styles the
>   internet already shares (dream anime, boxed action figure, brick build,
>   claymation…) and brought to life.
> - 🎵 **Earworm jingles** — an AI-sung ad with early-2000s commercial energy.
> - 🖼 **Image ads** — product stills with on-image headline + CTA text.
> - ✍️ **SEO blog autopilot** — articles written from your real catalog,
>   scheduled and auto-published.
> - 🎯 **Landing pages** — one-product pages built to close.
> - 🚀 **Campaign autopilot** — 30-day content calendars that run themselves.
>
> **Why merchants pick EasyMode**
> - One token wallet, every content type — no per-tool subscriptions.
> - Everything is written from your live catalog in your brand voice — never
>   generic.
> - Works for services too: no product photo needed, we sell the outcome.
> - 7-day free trial. Cancel anytime.

**Category**: Marketing → Content marketing
**Pricing**: Freemium listing with plans Starter/Growth/Pro/Scale (+ trials).

## 4. Submission steps
1. Partner Dashboard → Apps → EasyMode → **Distribution → Public**.
2. Fill the listing (copy above, assets from `/public` + fresh screenshots).
3. Add test instructions + demo store credentials for the review team.
4. Submit. Typical first response: 5-10 business days. Expect one round of
   feedback; answer fast — re-reviews are quicker.
5. While waiting: keep shipping — updates don't reset the review.
