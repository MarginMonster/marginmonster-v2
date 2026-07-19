# EasyMode — design system v2: "One arcade, many cabinets"

> **North star:** classic golden-age arcade — lively, vibrant, upbeat, encouraging,
> and extremely simple to use. Think vintage Donkey Kong marquee art, Pac-Man dots,
> Asteroids' starfield void, and 90s monster-collector partners. The app is an
> **arcade room**: each tool is its own game cabinet, wrapped in one consistent
> CRT-and-marquee chrome.

## The concept that unifies everything

An arcade is not one game — it's a room of cabinets. So different tools are
*allowed* different game genres, and it reads as intentional:

| Tool | Cabinet genre |
|---|---|
| Plans | Monster-collector (choose your partner, it evolves) |
| SEO Forge | Fantasy dungeon (Gauntlet/Golden Axe — the orc blacksmith belongs) |
| Performance | Space-shooter scoreboard (Asteroids, HI-SCORE) |
| Dashboard | The arcade lobby (marquee, PRESS START) |

What makes them one product is the shared chrome: the CRT void + scanlines,
marquee typography, cabinet buttons, coin/token language, and encouraging copy.

## Partners (the monster roster)

Your plan = your partner; upgrading = evolution. Vintage 90s creature-collector
style, vibrant cel-shaded with bold outlines:

- **BYTE** — Stage 1 "Starter" (cyan baby dragon, rookie)
- **KILO** — Stage 2 "Growth" (magenta fox, runner)
- **MEGA** — Stage 3 "Rapid Growth" (gold armored lion, champion)
- **GIGA** — Stage 4 "Commercial Growth" (purple/gold dragon, legend)

Renders: `public/fighters/mons/` (Replicate SDXL-Lightning + rembg; keep the
style block from scratchpad genmons.mjs for consistency). Component:
`app/components/Mech.tsx` (`Mech` + `MECH_BY_PLAN`) — floating hero presentation
(aura + levitation + ground shadow + silhouette-masked glint).

## Chrome (the shared cabinet)

- **Background:** deep-indigo CRT void with subtle starfield everywhere;
  faint scanlines + vignette (`body::after`). Asteroid wireframes only on
  showcase pages (`body:has(.mm-hero)`).
- **Buttons:** chunky "cabinet buttons" — bright gradient fill, hard 4px press
  shadow, press-down active state. (`.mm-arcade-btn`, Polaris primary,
  `.mm-hero-cta`, `.mm-fighter-select`.)
- **Marquee titles:** rainbow gradient text (`.mm-marquee`) on hero H1s ONLY.
- **Pac-dots:** `.mm-dots` trail after section labels, sparingly.
- **Cheer chips:** `.mm-cheer` for celebratory tags ("NICE COMBO!").
- **Palette:** deep indigo base + cabinet primaries `--arc-red/-yellow/-green/-blue/-violet`
  plus legacy cyan/gold/magenta. Text on colored fills = darkest shade of the same family.

## Voice — witty, upbeat, encouraging

- Coin language: tokens are **coins** ("INSERT COINS", "Drop a coin").
- Game language: PRESS START, PLAYER 1 READY, HI-SCORE, LEVEL UP, STAGE 1–4.
- Encourage constantly: celebrate completions, frame progress as score/streaks.
- Keep it *simple*: one clear action per screen. Never let theme block the task.

## Legibility guardrails (still non-negotiable)

- Pixel font for SHORT labels only; body copy stays clean sans (Polaris owns body
  text color so it adapts to the merchant's light/dark admin).
- Scanlines/vignette stay faint (≤ ~10% opacity) and behind content (z-index 0).
- One accent per context; work surfaces (Queue, Calendar, Performance tables,
  forms) keep clean cards — the vibrancy lives in chrome, buttons, and characters.
- Everything respects `prefers-reduced-motion`.

## New screen checklist

1. Which cabinet is this? Give it its genre flavor in the HERO only.
2. Wrap it in the shared chrome (void, cabinet buttons, marquee title if hero).
3. Coin/game/encouraging copy; one clear action.
4. Pixel font short labels; clean body text; one accent.
5. Big motion only for characters; micro-interactions elsewhere.
