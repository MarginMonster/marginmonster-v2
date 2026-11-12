/* Genre cover photos for the Music Video "Genre" picker — real pictures, not text pills.
 * Generates one cinematic, atmospheric establishing shot per genre the first time it's
 * requested (flux via renderCreativeSeed, outage-proof), caches it immutably like /vthumb
 * and /propimg. Pre-warm: curl https://easymodeapp.com/genreimg/<key> per genre. */

import type { LoaderFunctionArgs } from "@remix-run/node";
import fs from "node:fs";
import path from "node:path";
import { GENRES } from "../lib/film-engine.server";
import { renderCreativeSeed } from "../lib/image-generation.server";

const KEY = /^[a-z0-9_-]{1,40}$/i;

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const key = (params.key || "").toLowerCase();
  if (!KEY.test(key) || !GENRES[key]) return new Response("Not found", { status: 404 });

  const rendersDir = path.join(process.cwd(), "data", "renders");
  const cacheDir = path.join(rendersDir, "genres");
  // Bump the version to regenerate every genre cover (the prompt changed — fuller, brighter comps).
  const cache = path.join(cacheDir, `${key}-v2.jpg`);

  if (!fs.existsSync(cache)) {
    try {
      const g = GENRES[key];
      const prompt = `A vibrant, premium music-video cover frame for ${g.label}: ${g.look}. A bold, well-lit SUBJECT-FILLED composition — the stage/setting FILLS the whole frame edge to edge with rich color and energy; do NOT leave a large dark empty sky or black space at the top. High-production, cinematic, saturated, eye-catching. NO people, no text, no watermark.`;
      const durable = await renderCreativeSeed(prompt, "16:9");
      if (durable) {
        const src = path.join(rendersDir, path.basename(durable.split("?")[0]));
        if (fs.existsSync(src)) { fs.mkdirSync(cacheDir, { recursive: true }); fs.copyFileSync(src, cache); }
      }
    } catch { /* fall through to 404 */ }
  }
  if (!fs.existsSync(cache)) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(fs.readFileSync(cache)), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
