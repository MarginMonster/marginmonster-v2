/* Serves the cartoon/singer style-picker covers — per-character real renders:
 *   /style-tiles/{character}-{style}.jpg  → that cast member in that style
 *   /style-tiles/{style}.jpg              → default character (legacy URLs)
 *   /style-tiles/cover.jpg                → the Cartoon Avatar section cover
 * Missing tiles kick off generation and serve the character's real portrait
 * meanwhile — placeholder art never appears. Public, read-only, allowlisted. */

import type { LoaderFunctionArgs } from "@remix-run/node";
import fs from "node:fs";
import { merchantBusy } from "../lib/art-throttle.server";
import { DEFAULT_TILE_CHARACTER, ensureAllStyleTiles, ensurePickerGallery, ensureStyleTile, isPickerKey, isSceneKey, portraitFile, styleTilePath, tileCharacterFor } from "../lib/style-tiles.server";

function serveFile(p: string, cache: string): Response {
  return new Response(new Uint8Array(fs.readFileSync(p)), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": cache },
  });
}

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const file = params.file || "";
  const m = file.match(/^(?:([a-z]+)-)?([a-z]+)\.jpg$/);
  const explicitChar = m?.[1];
  const key = m?.[2] || "";
  // Bare-key gallery tile → its assigned (varied) character; an explicit
  // {character}-{style} url previews that specific presenter instead.
  let character = explicitChar || tileCharacterFor(key);

  // The Cartoon Avatar cover — the default character in Pixar style; also
  // kicks the default set.
  if (!m?.[1] && key === "cover") {
    // Disk FIRST. ensureAllStyleTiles awaits merchantBusy(), which is a
    // db.job.count — so calling it before checking the file meant every
    // cache HIT on this public, unauthenticated, highly-cacheable image URL
    // ran a database count. Anyone with curl could turn an image request
    // into database load, and an ordinary picker page did it on every view.
    // The walker only has work to do when the tile is missing anyway.
    const real = styleTilePath(DEFAULT_TILE_CHARACTER, "pixar");
    if (real) return serveFile(real, "public, max-age=600");
    ensureAllStyleTiles();
    const fb = portraitFile(DEFAULT_TILE_CHARACTER);
    return fb ? serveFile(fb, "no-store") : new Response("Not ready", { status: 404 });
  }

  if (!isPickerKey(key)) return new Response("Not found", { status: 404 });
  if (!portraitFile(character)) character = DEFAULT_TILE_CHARACTER;

  const real = styleTilePath(character, key);
  if (real) return serveFile(real, "public, max-age=600");

  // Requesting one tile warms the character's whole set — a merchant looking
  // at the picker wants all 8 anyway.
  // Public route: never compete with a paying merchant's render.
  if (!(await merchantBusy())) ensureStyleTile(character, key);
  // SCENE backdrops have no presenter — serving the character portrait as a
  // fallback would show a face where a place belongs, so 404 until it's rendered
  // (the setting card shows its tint/emoji meanwhile).
  if (isSceneKey(key)) return new Response("Generating", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (explicitChar) ensureAllStyleTiles(character); else ensurePickerGallery();
  const fb = portraitFile(character);
  return fb ? serveFile(fb, "no-store") : new Response("Not ready", { status: 404 });
};
