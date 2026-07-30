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
import { merchantBusy } from "./art-throttle.server";

// Default character (boot pre-render + the Cartoon Avatar cover).
export const DEFAULT_TILE_CHARACTER = "ingrid";

// Lives under data/renders because that's the ONLY path with a persistent
// disk on Render (render.yaml mountPath) — anywhere else gets wiped on every
// deploy, which made tiles flap between rendered and portrait-fallback.
const TILE_DIR = path.join(process.cwd(), "data", "renders", "style-tiles");
const TILE_VERSION = 5; // v5: bottle sourced from the v10 statue (the Product Highlight bottle)
// Per-key bumps: raise ONE style's version when its recipe changes materially,
// so only that style re-renders instead of every tile for every character.
const TILE_KEY_VERSIONS: Record<string, number> = {
  avatarcover: 4, // v4: holds the v10 statue bottle (extracted from phcover)
  anthemcover: 4, // v4: mic + the v10 statue bottle (extracted from phcover)
};
const tileVersion = (key: string) => TILE_KEY_VERSIONS[key] ?? TILE_VERSION;
// "papercut" replaced "brick" (Block Build read as cheap); the brick recipe
// stays in CARTOON_RECIPES so old assets still remix.
const PICKER_KEYS: CartoonStyleKey[] = [
  "dreamanime", "toyfigure", "papercut", "pixar", "retroanime", "vintagetoon", "puppet", "clay",
];

// Special non-style tiles: the Avatar AI / Anthem covers. These composite the
// character with the REAL approved EASYMODE bottle render (the statue cutout,
// passed as a second input image) via nano-banana, so the covers carry the
// same super-brand product as the Product Highlight tile — exact label, exact
// bottle, never a generic prop.
const SPECIAL_PROMPTS: Record<string, string> = {
  anthemcover:
    "Image 1 is a person; image 2 is a product bottle. Create a photorealistic shot of the exact same person from image 1 — identical face and hairstyle — singing joyfully into a retro silver studio microphone like a pop star mid-note, eyes bright, genuine delighted expression, one hand on the mic, the other hand holding up the exact bottle from image 2 (same shape, colors and label, its wordmark reading exactly EASYMODE, never redrawn or warped, the label facing the camera and right-side-up), both hands anatomically correct with five fingers. Colorful warm stage lighting with soft bokeh lights behind them, natural skin texture, centered on them from the waist up, no other text, no watermark.",
  avatarcover:
    "Image 1 is a person; image 2 is a product bottle. Create a photorealistic shot of the exact same person from image 1 — identical face and hairstyle — enthusiastically presenting to the camera like a friendly creator filming a product review, warm genuine smile, holding up the exact bottle from image 2 (same shape, colors and label, its wordmark reading exactly EASYMODE, never redrawn or warped, the label facing the camera and right-side-up), the hand holding the bottle anatomically correct with five fingers and a natural grip. Bright airy daylight room softly blurred behind them, natural skin texture, centered on them from the chest up, no other text, no watermark.",
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
      const { qaStylizedText, repairStylizedText } = await import("./cartoon-ad-pipeline.server");
      const recipe = CARTOON_RECIPES[key as CartoonStyleKey];
      const portraitUrl = `${base}/avatars/${character}_0.jpg`;
      const statueUrl = `${base}/ad-templates/statue.png`;
      // Every tile composites the REAL EASYMODE bottle render as a second
      // input, so the label is carried, not hallucinated — the same standard
      // merchant products get. Cartoon styles redraw it in-style, label intact.
      const prompt = SPECIAL_PROMPTS[key] || (
        `Image 1 is a person; image 2 is a product bottle. Redraw BOTH as a ${recipe.look}: ` +
        `the person becomes a charming character with the same hairstyle and a friendly stylized ` +
        `likeness, smiling and holding up the bottle from image 2 rendered in the same art style — ` +
        `same shape, same emerald green drink and black cap, and its label reads exactly "EASYMODE", facing the camera and right-side-up, ` +
        `in clean bold capital letters, perfectly spelled, with no other readable text anywhere. ` +
        `The hand gripping the bottle is anatomically correct — five fingers, natural relaxed grip, ` +
        `no extra or missing fingers. Wide landscape composition, the character centered from ` +
        `the waist up, beautiful style-true background scene, rich detail, no watermark.`);
      // Render → spell-check → one retry → strip lettering as a last resort.
      // A tile with gibberish on the label never reaches the disk.
      let url = "";
      let passed = false;
      for (let attempt = 0; attempt < 2 && !passed; attempt++) {
        const id = await repCreate("google/nano-banana", {
          prompt,
          image_input: [portraitUrl, statueUrl],
          output_format: "jpg",
        });
        url = await repPoll(id, 5 * 60_000, `style-tile:${character}:${key}`);
        // QA compares against the real statue render: exact wordmark AND a
        // bottle that's recognizably the Product Highlight bottle.
        const qa = await qaStylizedText(url, "EASYMODE", statueUrl);
        passed = qa.pass;
        if (!passed) artLog("style-tiles", `${flightKey}: attempt ${attempt + 1} failed label QA — ${qa.reason}`);
      }
      if (!passed) url = await repairStylizedText(url, "EASYMODE", "strip");
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
  // ONE tile per call: eight concurrent renders per presenter saturated the
  // per-model rate limit and 429'd merchant image ads. The self-heal tick
  // walks the set until the character is complete.
  void (async () => {
    if (await merchantBusy()) return;
    const keys: string[] = [...PICKER_KEYS];
    if (character === DEFAULT_TILE_CHARACTER) keys.push(...Object.keys(SPECIAL_PROMPTS));
    for (const k of keys) {
      if (currentTileExists(character, k)) continue;
      ensureStyleTile(character, k);
      return;
    }
  })();
}

/** Pre-forge tiles for the WHOLE cast, one character per call — the picker
 * must never show a plain portrait where a style render belongs ("images
 * failing to load"). One character at a time keeps each burst small enough
 * to dodge upstream rate limits; the worker's self-heal calls this every
 * cycle until every presenter's set exists. */
export function ensureNextCharacterTiles(characters: string[]): void {
  for (const c of characters) {
    if (!portraitFile(c)) continue;
    const missing = PICKER_KEYS.some((k) => !currentTileExists(c, k));
    if (missing) {
      ensureAllStyleTiles(c);
      return; // one character per cycle
    }
  }
}
