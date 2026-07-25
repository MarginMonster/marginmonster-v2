/* REAL style-tile generation — the cartoon/singer style pickers show actual
 * flux-kontext renders: the SELECTED cast member redrawn through every style
 * by the same engine that renders merchant ads. Tiles are per-character and
 * render ON DEMAND the first time a character's tiles are requested (~8 small
 * renders), then cache on the durable disk. While a tile cooks, the
 * character's real portrait stands in — never placeholder art.
 *
 * Serving flow (style-tiles.$file route):
 *   tile on disk → serve it
 *   missing      → serve the character's portrait AND kick off generation */

import fs from "node:fs";
import path from "node:path";
import { CARTOON_RECIPES, type CartoonStyleKey } from "./cartoon-ad-pipeline.server";
import { artLog } from "./art-log.server";

// Default character (boot pre-render + the Cartoon Avatar cover).
export const DEFAULT_TILE_CHARACTER = "ingrid";

// Lives under data/renders because that's the ONLY path with a persistent
// disk on Render (render.yaml mountPath) — anywhere else gets wiped on every
// deploy, which made tiles flap between rendered and portrait-fallback.
const TILE_DIR = path.join(process.cwd(), "data", "renders", "style-tiles");
const TILE_VERSION = 2; // v2: five-finger hand guard in the prompt
// Per-key bumps: raise ONE style's version when its recipe changes materially,
// so only that style re-renders instead of every tile for every character.
const TILE_KEY_VERSIONS: Record<string, number> = {
  brick: 4, // v4: full voxel/cube look — v3 still drew studded minifigures
};
const tileVersion = (key: string) => TILE_KEY_VERSIONS[key] ?? TILE_VERSION;
const PICKER_KEYS: CartoonStyleKey[] = [
  "dreamanime", "toyfigure", "brick", "pixar", "retroanime", "vintagetoon", "puppet", "clay",
];

// Special non-style tiles rendered with the same machinery. The Anthem cover
// is the default character SINGING — a real photoreal render, not iconography.
const SPECIAL_PROMPTS: Record<string, string> = {
  anthemcover:
    "Edit this photo: the exact same person now singing joyfully into a retro silver studio microphone like a pop star mid-note, eyes bright, genuine delighted expression, one hand on the mic, colorful warm stage lighting with soft bokeh lights behind them, photorealistic, natural skin texture, wide landscape composition centered on them from the waist up, no text, no watermark.",
  avatarcover:
    "Edit this photo: the exact same person now enthusiastically presenting to the camera like a friendly creator filming a product review, warm genuine smile, holding up a small simple orange bottle with a blue cap (a generic product, no readable text), the hand holding the bottle anatomically correct with five fingers and a natural grip, bright airy daylight room softly blurred behind them, photorealistic, natural skin texture, wide landscape composition centered on them from the chest up, no text, no watermark.",
};

const inFlight = new Set<string>();

export function portraitFile(character: string): string | null {
  if (!/^[a-z]+$/.test(character)) return null;
  const p = path.join(process.cwd(), "public", "avatars", `${character}_0.jpg`);
  return fs.existsSync(p) ? p : null;
}

export function styleTilePath(character: string, key: string): string | null {
  if (!/^[a-z]+$/.test(character) || !/^[a-z]+$/.test(key)) return null;
  // Current version first, then ANY older real render — version bumps must
  // never regress the UI to placeholders while the new set rebuilds.
  const candidates = [path.join(TILE_DIR, `${character}-v${tileVersion(key)}-${key}.jpg`)];
  for (let v = tileVersion(key) - 1; v >= 2; v--) candidates.push(path.join(TILE_DIR, `${character}-v${v}-${key}.jpg`));
  candidates.push(path.join(TILE_DIR, `${character}-${key}.jpg`)); // pre-versioning names
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

function currentTileExists(character: string, key: string): boolean {
  return fs.existsSync(path.join(TILE_DIR, `${character}-v${tileVersion(key)}-${key}.jpg`));
}

export function isPickerKey(key: string): boolean {
  return (PICKER_KEYS as string[]).includes(key) || key in SPECIAL_PROMPTS;
}

/** Fire-and-forget: render one character×style tile if missing. Never throws —
 *  the portrait fallback keeps serving. */
export function ensureStyleTile(character: string, key: string): void {
  if (!isPickerKey(key)) return;
  const flightKey = `${character}:${key}`;
  if (!portraitFile(character) || currentTileExists(character, key) || inFlight.has(flightKey)) return;
  if (!process.env.REPLICATE_API_TOKEN) { artLog("style-tiles", `${flightKey}: skipped — REPLICATE_API_TOKEN not set`); return; }
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  if (!base) { artLog("style-tiles", `${flightKey}: skipped — SHOPIFY_APP_URL not set`); return; }

  inFlight.add(flightKey);
  (async () => {
    try {
      const { repCreate, repPoll, download } = await import("./ugc-ad-pipeline.server");
      const recipe = CARTOON_RECIPES[key as CartoonStyleKey];
      const prompt = SPECIAL_PROMPTS[key] || (
        `Redraw this exact person as a ${recipe.look}. Same person — same hairstyle, ` +
        `same friendly likeness, stylized for the art style. They are smiling and holding up ` +
        `a small simple orange bottle with a blue cap (a generic product, no readable text). ` +
        `The hand gripping the bottle is anatomically correct — five fingers, natural relaxed grip, ` +
        `no extra or missing fingers. Wide landscape composition, the character centered from ` +
        `the waist up, beautiful style-true background scene, rich detail, no text, no watermark.`);
      const id = await repCreate("black-forest-labs/flux-kontext-pro", {
        prompt,
        input_image: `${base}/avatars/${character}_0.jpg`,
        aspect_ratio: "16:9",
        output_format: "jpg",
      });
      const url = await repPoll(id, 5 * 60_000, `style-tile:${character}:${key}`);
      fs.mkdirSync(TILE_DIR, { recursive: true });
      const tmp = path.join(TILE_DIR, `.${character}-${key}.part`);
      await download(url, tmp);
      if (fs.statSync(tmp).size > 10_000) {
        fs.renameSync(tmp, path.join(TILE_DIR, `${character}-v${tileVersion(key)}-${key}.jpg`));
        artLog("style-tiles", `${flightKey}: rendered OK`);
      } else {
        fs.rmSync(tmp, { force: true });
        artLog("style-tiles", `${flightKey}: output too small — discarded`);
      }
      console.log(`[style-tiles] generated ${character} × ${key}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      artLog("style-tiles", `${flightKey}: FAILED — ${msg}`);
      console.error(`[style-tiles] ${character}×${key} failed (portrait keeps serving):`, msg);
    } finally {
      inFlight.delete(flightKey);
    }
  })();
}

/** Kick all missing tiles for a character (route + boot call this). */
export function ensureAllStyleTiles(character: string = DEFAULT_TILE_CHARACTER): void {
  for (const k of PICKER_KEYS) ensureStyleTile(character, k);
  // Special tiles (the Anthem cover) only need the default character.
  if (character === DEFAULT_TILE_CHARACTER) for (const k of Object.keys(SPECIAL_PROMPTS)) ensureStyleTile(character, k);
}
