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

// The one face every style transforms — matches the Avatar AI cover so the
// whole studio tells a single story. Portrait must exist in public/avatars.
const FIRST_CHARACTER = "amara";

const TILE_DIR = path.join(process.cwd(), "data", "style-tiles");
const PICKER_KEYS: CartoonStyleKey[] = [
  "dreamanime", "toyfigure", "brick", "pixar", "retroanime", "vintagetoon", "puppet", "clay",
];

const inFlight = new Set<string>();

export function styleTilePath(key: string): string | null {
  if (!/^[a-z]+$/.test(key)) return null;
  const p = path.join(TILE_DIR, `${key}.jpg`);
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
      if (fs.statSync(tmp).size > 10_000) fs.renameSync(tmp, path.join(TILE_DIR, `${key}.jpg`));
      else fs.rmSync(tmp, { force: true });
      console.log(`[style-tiles] generated real tile for ${key}`);
      // All four collage styles real? Refresh the Cartoon Avatar cover too.
      buildCover().catch(() => { /* best-effort */ });
    } catch (e) {
      console.error(`[style-tiles] ${key} generation failed (fallback art keeps serving):`, e instanceof Error ? e.message : e);
    } finally {
      inFlight.delete(key);
    }
  })();
}

/** 2×2 collage of four real tiles → the Cartoon Avatar content-type cover. */
async function buildCover(): Promise<void> {
  const parts = ["dreamanime", "toyfigure", "pixar", "clay"].map((k) => path.join(TILE_DIR, `${k}.jpg`));
  if (!parts.every((p) => fs.existsSync(p))) return;
  const out = path.join(TILE_DIR, "cover.jpg");
  if (fs.existsSync(out)) return;
  const { runFfmpeg } = await import("./ugc-ad-pipeline.server");
  const r = await runFfmpeg([
    "-y",
    "-i", parts[0], "-i", parts[1], "-i", parts[2], "-i", parts[3],
    "-filter_complex",
    "[0:v]scale=400:232:force_original_aspect_ratio=increase,crop=400:232[a];" +
    "[1:v]scale=400:232:force_original_aspect_ratio=increase,crop=400:232[b];" +
    "[2:v]scale=400:232:force_original_aspect_ratio=increase,crop=400:232[c];" +
    "[3:v]scale=400:232:force_original_aspect_ratio=increase,crop=400:232[d];" +
    "[a][b]hstack[top];[c][d]hstack[bot];[top][bot]vstack",
    "-frames:v", "1", "-q:v", "3", out,
  ]);
  if (r.status === 0) console.log("[style-tiles] cover collage built from real tiles");
}

/** Kick all missing tiles (called opportunistically from the route). */
export function ensureAllStyleTiles(): void {
  for (const k of PICKER_KEYS) ensureStyleTile(k);
}
