/* Archive: "Keep all" saves every piece on the 30-day clock in one tap, and the Videos tab can be cut
 * down to Films or Faceless when it holds a mix. Keep-all must only ever flip this shop's UN-kept pieces
 * (a posted piece stays posted), and the Films chip must know every kind Movie Maker writes. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("keepMany only flips this shop's un-kept pieces, a page at most", () => {
  const src = read("app/routes/web.archive.tsx");
  const at = src.indexOf('if (intent === "keepMany")');
  assert.ok(at > 0);
  const block = src.slice(at, src.indexOf('if (intent === "unkeep")', at));
  assert.ok(block.includes("shopId: shop.id"), "scoped to the shop");
  assert.ok(block.includes('status: "PENDING"'), "only un-kept pieces change");
  assert.ok(block.includes('data: { status: "APPROVED" }'), "kept = APPROVED, like the single Keep");
  assert.ok(/\.slice\(0, 300\)/.test(block), "bounded");
});

test("the Films chip knows every kind a Movie Maker pipeline records", () => {
  const archive = read("app/routes/web.archive.tsx");
  const m = archive.match(/const FILM_KINDS = new Set\(\[([^\]]+)\]\)/);
  assert.ok(m, "FILM_KINDS defined");
  const kinds = new Set([...m![1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]));
  for (const [file, kind] of [
    ["app/lib/film-dialogue.server.ts", "testmovie"],
    ["app/lib/narrated-story.server.ts", "narrated"],
    ["app/lib/music-video-pipeline.server.ts", "musicvideo"],
    ["app/lib/film-edit.server.ts", "enginetest"],
  ] as const) {
    assert.ok(read(file).includes(`kind: "${kind}"`), `${file} still writes kind "${kind}"`);
    assert.ok(kinds.has(kind), `Films chip includes "${kind}"`);
  }
});
