/* REAL style-tile generation — the cartoon style picker's covers are actual
 * flux-kontext generations, not illustrations: ONE cast member (the "first
 * character") redrawn through every style by the same engine that renders
 * merchant ads. Generated once on the production server (which holds the
 * Replicate key), cached on the durable disk, served to every merchant.
 *
 * Serving flow (style-tiles.$file route):
 *   tile on disk → serve it (long cache)
 *   missing      → serve the illustrated fallback AND kick off generation
 * So the picker always renders, and upgrades itself to real art within a
 * minute of the first visit. Delete a file in data/style-tiles to regenerate. */

import fs from "node:fs";
import path from "node:path";
import { CARTOON_RECIPES, type CartoonStyleKey } from "./cartoon-ad-pipeline.server";

// The one face every style transforms. Portrait must exist in public/avatars.
// Cached tiles are keyed by this name — changing the character automatically
// renders a fresh set instead of serving the previous face's tiles.
const FIRST_CHARACTER = "ingrid";

const TILE_DIR = path.join(process.cwd(), "data", "style-tiles");
const PICKER_KEYS: CartoonStyleKey[] = [
  "dreamanime", "toyfigure", "brick", "pixar", "retroanime", "vintagetoon", "puppet", "clay",
];

const inFlight = new Set<string>();

export function styleTilePath(key: string): string | null {
  if (!/^[a-z]+$/.test(key)) return null;
  const p = path.join(TILE_DIR, `${FIRST_CHARACTER}-${key}.jpg`);
  return fs.existsSync(p) ? p : null;
}

export function isPickerKey(key: string): key is CartoonStyleKey {
  return (PICKER_KEYS as string[]).includes(key);
}

/** Fire-and-forget: generate the real tile for a style if it's missing and
 *  not already cooking. Never throws — the fallback art keeps serving. */
export function ensureStyleTile(key: string): void {
  if (!isPickerKey(key)) return;
  if (styleTilePath(key) || inFlight.has(key)) return;
  if (!process.env.REPLICATE_API_TOKEN) return;
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  if (!base) return;
  const portrait = path.join(process.cwd(), "public", "avatars", `${FIRST_CHARACTER}_0.jpg`);
  if (!fs.existsSync(portrait)) return;

  inFlight.add(key);
  (async () => {
    try {
      const { repCreate, repPoll, download } = await import("./ugc-ad-pipeline.server");
      const recipe = CARTOON_RECIPES[key];
      const prompt =
        `Redraw this exact person as a ${recipe.look}. Same person — same hairstyle, ` +
        `same friendly likeness, stylized for the art style. They are smiling and holding up ` +
        `a small simple orange bottle with a blue cap (a generic product, no readable text). ` +
        `Wide landscape composition, the character centered from the waist up, beautiful ` +
        `style-true background scene, rich detail, no text, no watermark.`;
      const id = await repCreate("black-forest-labs/flux-kontext-pro", {
        prompt,
        input_image: `${base}/avatars/${FIRST_CHARACTER}_0.jpg`,
        aspect_ratio: "16:9",
        output_format: "jpg",
      });
      const url = await repPoll(id, 5 * 60_000, `style-tile:${key}`);
      fs.mkdirSync(TILE_DIR, { recursive: true });
      const tmp = path.join(TILE_DIR, `.${key}.part`);
      await download(url, tmp);
      if (fs.statSync(tmp).size > 10_000) fs.renameSync(tmp, path.join(TILE_DIR, `${FIRST_CHARACTER}-${key}.jpg`));
      else fs.rmSync(tmp, { force: true });
      console.log(`[style-tiles] generated real tile for ${key}`);
    } catch (e) {
      console.error(`[style-tiles] ${key} generation failed (fallback art keeps serving):`, e instanceof Error ? e.message : e);
    } finally {
      inFlight.delete(key);
    }
  })();
}

/** Kick all missing tiles (called opportunistically from the route). */
export function ensureAllStyleTiles(): void {
  for (const k of PICKER_KEYS) ensureStyleTile(k);
}
