# AdArcade — design system

> **North star:** the *work* is clean and legible; the *arcade* lives in the edges and moments.
> Merchants must trust this app converts. We win like Stripe/Linear/Shopify: a restrained,
> professional core with arcade flavor as an **accent layer** — never arcade cranked to 11
> over every pixel.

## The one rule

**Arcade is an accent, not the surface.** Before adding any neon, character, pixel font,
or animation to a screen, ask: *is this a showcase moment or a work surface?*

- **Showcase moments** (get the arcade treatment): the Plans "SELECT YOUR FIGHTER" screen,
  onboarding, empty states, celebrations (first listing forged, plan upgraded), the player
  HUD, and **one** hero flourish per major screen.
- **Work surfaces** (stay clean): Content Queue, Calendar, Performance, forms, tables, the
  Forge working area, settings. Clean Polaris cards, readable type, neon only as an accent
  (active state, focus ring, a key stat, a small glyph).

## Background

- **Default = calm.** A static dark radial (`body` background). No twinkle, no asteroids.
- **Showcase pages opt in** via a `.mm-hero` element. The twinkling starfield (`body::before`)
  and drifting asteroids (`.mm-asteroids`) are gated behind `body:has(.mm-hero)`.
  Pages: dashboard, plans, strategy, videos. Dense tools have no hero → stay calm.
- The Forge (`/app/products`) supplies its own contained flourish (the ember/coal `.mm-ember-bg`)
  as its hero moment; its results/working area should read clean.

## Color

- Neutral dark surfaces + **one accent per context.**
  - Default accent: **cyan** (`--mm-cyan` #34E7E4).
  - Plans: the **tier color** (cyan / magenta / gold / violet) is the accent within each card.
- Neon is **reserved**: primary CTA, active/selected state, focus ring, a single key stat,
  and character glows. If everything glows, nothing does.
- Text on colored fills uses the darkest shade of that same color family — never pure black.

## Type

- **Pixel font (`--font-pixel`): short labels only** — eyebrows, tags, section labels, stat
  keys. **Never** body copy or long strings (it kills legibility).
- **Body:** clean sans (`--font-body`) / Polaris defaults. Let Polaris own body text color so
  it always adapts to the merchant's light/dark admin.
- **Headings:** `--font-heading`, restrained sizes. Sentence case for UI copy.

## Motion

- **Big animations are reserved for characters/heroes** — the mech levitation + aura + glint,
  the forge ember-intensify, hero glows.
- **Work surfaces get micro-interactions only**: hover lift, focus ring, 150ms transitions.
- Everything respects `prefers-reduced-motion`.

## Characters

- AdArcade is a **roster of AI units.** Your plan = the combat mech you deploy
  (SPARK-01 / HAVOC / OVERLORD / OMEGA — see `app/components/Mech.tsx`).
- Characters appear **at the edges** — HUD avatar, section headers, empty states, hero cards —
  **not** sprawled across work areas.
- Renders live in `public/fighters/mechs/` (generated via Replicate SDXL-Lightning + rembg;
  see `scratchpad/genmechs*.mjs` pattern). Keep the family consistent: matte-black chassis,
  single accent glow, same framing.
- *Open follow-up:* the SEO Forge's orc blacksmith is from a different (fantasy) universe. Under
  the accent model it's contained to the Forge hero, so it's tolerable — but recasting it as a
  cyber "Forgemaster" mech would fully unify the roster. Nice-to-have, not a blocker.

## Adding a new screen — checklist

1. Is it a work surface? → calm background (no `.mm-hero`), clean Polaris cards, one accent.
2. Is it a showcase? → add a `.mm-hero`, allow the arcade backdrop + a character.
3. Pixel font only on short labels.
4. One accent color; neon only on CTA/active/focus/key-stat.
5. Big motion only if there's a character; otherwise micro-interactions.
