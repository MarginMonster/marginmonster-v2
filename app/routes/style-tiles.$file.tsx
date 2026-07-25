/* Serves the cartoon style-picker covers. Real flux-generated tiles (one cast
 * member redrawn through each style) once they exist on the durable disk;
 * until then, the illustrated fallback — while generation kicks off in the
 * background. Public, read-only, key-allowlisted. */

import type { LoaderFunctionArgs } from "@remix-run/node";
import fs from "node:fs";
import path from "node:path";
import { ensureAllStyleTiles, ensureStyleTile, isPickerKey, styleTilePath } from "../lib/style-tiles.server";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const file = params.file || "";
  const m = file.match(/^([a-z]+)\.jpg$/);
  const key = m?.[1] || "";

  // The Cartoon Avatar cover — the FIRST CHARACTER leads in Pixar-style
  // (the 3D-toon render of Amara); fallback ct.png until it's generated.
  // Requesting the cover also kicks off every missing style tile.
  if (key === "cover") {
    const real = styleTilePath("pixar");
    ensureAllStyleTiles();
    if (real) {
      return new Response(new Uint8Array(fs.readFileSync(real)), {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=600" },
      });
    }
    const fb = path.join(process.cwd(), "public", "content-types", "ct.png");
    // no-store: the instant the real render exists, the next refresh shows it
    return new Response(new Uint8Array(fs.readFileSync(fb)), {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  }

  if (!isPickerKey(key)) return new Response("Not found", { status: 404 });

  const real = styleTilePath(key);
  if (real) {
    return new Response(new Uint8Array(fs.readFileSync(real)), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=600" },
    });
  }

  ensureStyleTile(key);
  const fb = path.join(process.cwd(), "public", "content-types", "cartoon", `${key}.png`);
  if (!fs.existsSync(fb)) return new Response("Not found", { status: 404 });
  // no-store: the instant the real render exists, the next refresh shows it
  return new Response(new Uint8Array(fs.readFileSync(fb)), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
};
