/* A DESCRIBED CREATOR VIDEO MUST REACH THE VIDEO ENGINE WITH A SEED IT CAN FETCH.
 *
 * Creator → Video → type a description → Make. The scene is first drawn as a still
 * (renderCreativeSeed) and that still is animated. renderCreativeSeed saves the still on our own
 * disk and returns "/renders/<file>" — a path, not an address. It was handed on as it was:
 * prepareVerticalSeed could not fetch it, and the bare path went to both video engines, which
 * refused it ("input.start_image: Does not match format 'uri'"). Every described Creator video
 * failed and refunded from the day the seed step shipped (2026-10-27) until one was made as a
 * customer on 2026-11-23. Nothing tested the join between the two halves; this does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchableUrl } from "../app/lib/fetchable-url.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("one of our own paths becomes a whole address", () => {
  assert.equal(fetchableUrl("/renders/img-1.jpg", "https://easymodeapp.com"), "https://easymodeapp.com/renders/img-1.jpg");
  assert.equal(fetchableUrl("/renders/img-1.jpg", "https://easymodeapp.com/"), "https://easymodeapp.com/renders/img-1.jpg", "no doubled slash");
  assert.equal(fetchableUrl("/uploads/a b.png", "http://localhost:3000"), "http://localhost:3000/uploads/a b.png");
});

test("an address that is already whole is left alone", () => {
  assert.equal(fetchableUrl("https://replicate.delivery/x/out.jpg", "https://easymodeapp.com"), "https://replicate.delivery/x/out.jpg");
  assert.equal(fetchableUrl("  https://cdn.example/a.jpg  ", ""), "https://cdn.example/a.jpg");
});

test("nothing fetchable comes back as undefined — never as a bare path", () => {
  assert.equal(fetchableUrl("/renders/img-1.jpg", ""), undefined, "no base configured");
  assert.equal(fetchableUrl("/renders/img-1.jpg", "easymodeapp.com"), undefined, "a base with no scheme is not an address");
  assert.equal(fetchableUrl("renders/img-1.jpg", "https://easymodeapp.com"), undefined, "not a path of ours");
  assert.equal(fetchableUrl("//evil.example/x.jpg", "https://easymodeapp.com"), undefined, "a scheme-relative URL is someone else's host");
  assert.equal(fetchableUrl("", "https://easymodeapp.com"), undefined);
  assert.equal(fetchableUrl(null, "https://easymodeapp.com"), undefined);
});

test("the Creator seed is made whole before anything is asked to fetch it", () => {
  const src = read("app", "lib", "video-generation.server.ts");
  const from = src.indexOf("if (params.creative && !productImageUrl) {");
  assert.ok(from > 0);
  const block = src.slice(from, from + 2400);
  assert.ok(block.includes("const seedAbs = fetchableUrl(seed);"));
  assert.ok(block.includes("const vseed = seedAbs ? await prepareVerticalSeed(seedAbs, aspect) : undefined;"), "the framing step fetches the whole address");
  assert.ok(block.includes("seedImage = vseed || seedAbs;"), "and the engine is handed a whole address or nothing");
  assert.ok(!block.includes("seedImage = vseed || seed;"), "the bare path is never the seed");
  // what the seed step returns is still a path of ours — the reason this join exists
  const img = read("app", "lib", "image-generation.server.ts");
  const fn = img.slice(img.indexOf("export async function renderCreativeSeed("));
  assert.ok(fn.slice(0, 2600).includes("const durable = await persistRemote(url, \"jpg\");"));
  assert.ok(img.includes("  return `/renders/${fileName}`;"));
});
