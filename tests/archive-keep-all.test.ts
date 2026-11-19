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

test("select mode: many pieces kept or deleted at once — never a posted one, never another shop's", () => {
  const src = fs.readFileSync(new URL("../app/routes/web.archive.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const act = src.slice(src.indexOf('if (intent === "deleteMany")'), src.indexOf('if (intent === "unkeep")'));
  assert.ok(act.includes("shopId: shop.id") && act.includes('status: { not: "PUBLISHED" }'), "scoped to the shop, posted pieces skipped");
  assert.ok(act.includes(".slice(0, 300)"), "never more than a page");
  const ui = src.slice(src.indexOf("const deletePicked"), src.indexOf("const deletePicked") + 800);
  assert.ok(ui.includes("if (!armBulk) { setArmBulk(true); return; }"), "armed: a second tap deletes");
  assert.ok(ui.includes("setTimeout(") && ui.includes("undo:"), "held behind an Undo window like a single delete");
});
