/* Prop thumbnails for the Music Video "Props" picker. The owner wants PICTURES, not emojis.
 * This generates one clean studio photo per catalog prop the first time it's requested
 * (flux via renderCreativeSeed, which already survives the nano-banana outage), caches it
 * to disk, and serves the cached ~30KB JPG immutably after — the exact /vthumb pattern.
 * Pre-warm with: curl https://easymodeapp.com/propimg/<key> for each key (public, no auth). */

import type { LoaderFunctionArgs } from "@remix-run/node";
import fs from "node:fs";
import path from "node:path";
import { PROPS } from "../lib/film-engine.server";
import { renderCreativeSeed } from "../lib/image-generation.server";

// Only a short catalog key — letters/digits/_-; no slashes or "..", so it can't escape data/renders.
const KEY = /^[a-z0-9_-]{1,40}$/i;

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const key = (params.key || "").toLowerCase();
  if (!KEY.test(key) || !PROPS[key]) return new Response("Not found", { status: 404 });

  const rendersDir = path.join(process.cwd(), "data", "renders");
  const cacheDir = path.join(rendersDir, "props");
  const cache = path.join(cacheDir, `${key}.jpg`);

  if (!fs.existsSync(cache)) {
    try {
      // The prop's clean noun (strip the leading emoji from the catalog label): "🐯 Tiger" -> "Tiger".
      const noun = (PROPS[key].label || key).replace(/^[^\p{L}]+/u, "").trim() || key;
      const prompt = `A professional studio product photo of ${noun}: a single subject centered on a clean light grey seamless background, soft even studio lighting, photorealistic, crisp high detail, no people, no text, no watermark.`;
      const durable = await renderCreativeSeed(prompt, "1:1");
      if (durable) {
        const src = path.join(rendersDir, path.basename(durable.split("?")[0]));
        if (fs.existsSync(src)) { fs.mkdirSync(cacheDir, { recursive: true }); fs.copyFileSync(src, cache); }
      }
    } catch { /* fall through to the 404 below */ }
  }
  if (!fs.existsSync(cache)) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(fs.readFileSync(cache)), {
    headers: {
      "Content-Type": "image/jpeg",
      // A prop's catalog photo never changes — cache hard so the picker is instant.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
