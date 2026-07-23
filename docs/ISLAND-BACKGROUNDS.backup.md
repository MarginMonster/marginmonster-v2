# Animated island backgrounds — parked, not deleted

The "living island" ambient backgrounds (per-page looping video + static photo
fallback) were **parked** when the app moved to the *Editorial Arcade* paper look
(2026-07). They are **not removed** — the Editorial Arcade layer at the bottom of
`app/brand.css` only *overrides* them, so restoring is a delete-the-override job.

## What the islands are
- Per-page landscape video loops: `public/bg/<page>.mp4` (dashboard, campaigns,
  videos, seo, queue, calendar, performance, plans).
- Static photo fallbacks: `public/bg/<page>.jpg` (desktop) + `public/bg/<page>-m.jpg`
  (mobile portrait crops).
- Rendered by the `<video class="em-bgvid">` element in `app/routes/app.tsx`
  (still present in the markup — just hidden by CSS while paper is active).

## The exact state to restore to
The islands were last correct at commit **395b686**
("Fix animated island background on mobile"). To see the original CSS/markup:

```
git show 395b686:app/brand.css      # island bg rules live ~lines 1860-1917
git show 395b686:app/routes/app.tsx # the <video class="em-bgvid"> block + bgRef
```

## How to bring the islands back
1. In `app/brand.css`, delete the `EDITORIAL ARCADE` block's **background override**
   (the section that sets `body { background: <paper> }`, `body::before { display:none }`,
   and `.em-bgvid { display:none }`). The original island rules below it take over again.
2. The `<video class="em-bgvid">` element in `app.tsx` is unchanged, so it will
   autoplay again as soon as CSS stops hiding it. Nothing to re-add.

That's it — the islands are one override-block away at any time.
