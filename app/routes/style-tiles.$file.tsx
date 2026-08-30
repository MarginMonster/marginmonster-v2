/* Serves the cartoon/singer style-picker covers — per-character real renders:
 *   /style-tiles/{character}-{style}.jpg  → that cast member in that style
 *   /style-tiles/{style}.jpg              → default character (legacy URLs)
 *   /style-tiles/cover.jpg                → the Cartoon Avatar section cover
 * Missing tiles kick off generation and serve the character's real portrait
 * meanwhile — placeholder art never appears. Public, read-only, allowlisted. */

import type { LoaderFunctionArgs } from "@remix-run/node";
import fs from "node:fs";
import { merchantBusy } from "../lib/art-throttle.server";
import { DEFAULT_TILE_CHARACTER, ensureAllStyleTiles, ensureStyleTile, isPickerKey, portraitFile, styleTilePath } from "../lib/style-tiles.server";

function serveFile(p: string, cache: string): Response {
  return new Response(new Uint8Array(fs.readFileSync(p)), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": cache },
  });
}

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const file = params.file || "";
  const m = file.match(/^(?:([a-z]+)-)?([a-z]+)\.jpg$/);
  let character = m?.[1] || DEFAULT_TILE_CHARACTER;
  const key = m?.[2] || "";

  // The Cartoon Avatar cover — the default character in Pixar style; also
  // kicks the default set.
  if (!m?.[1] && key === "cover") {
    ensureAllStyleTiles();
    const real = styleTilePath(DEFAULT_TILE_CHARACTER, "pixar");
    if (real) return serveFile(real, "public, max-age=600");
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
  ensureAllStyleTiles(character);
  const fb = portraitFile(character);
  return fb ? serveFile(fb, "no-store") : new Response("Not ready", { status: 404 });
};
