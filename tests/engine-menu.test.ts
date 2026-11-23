/* THE AD MAKER OFFERS FOUR ENGINES, NOT EIGHT.
 *
 * Its menu listed "Auto — Kling 3 Pro" and then "Kling 3 Pro" again; Kling 2.6 Pro and Kling 2.5 Turbo at
 * the same price as the newest Kling; and Veo 3 Fast beside Veo 3.1 Fast at the same +75. Five of the eight
 * were a choice with no reason to make it. The menu is now the one included engine and the three premium
 * ones that are really different — and every old key still means what it meant, because saved campaigns,
 * remixes and jobs in flight name them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VIDEO_ENGINES, VIDEO_ENGINE_BY_KEY, VIDEO_ENGINE_MENU, engineMenuFor, engineSurcharge, normalizeEngineKey } from "../app/lib/video-engines.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("what is offered: one included engine and three that differ", () => {
  assert.deepEqual(VIDEO_ENGINE_MENU.map((e) => e.key), ["auto", "hailuo", "seedance", "veo31"]);
  assert.deepEqual(VIDEO_ENGINE_MENU.map((e) => e.surcharge), [0, 25, 75, 75]);
  // nothing on the menu is an older version of something else on the menu at the same price
  const names = VIDEO_ENGINE_MENU.map((e) => e.name.replace(/[\d. ]+(Pro|Fast|Turbo)?$/i, "").trim());
  assert.equal(new Set(names).size, names.length, names.join(" | "));
});

test("every engine that ever had a key still has it — and still costs what it cost", () => {
  assert.deepEqual(VIDEO_ENGINES.map((e) => e.key), ["auto", "kling", "kling26", "kling25fal", "hailuo", "seedance", "veo31", "veo"]);
  for (const k of ["kling", "kling26", "kling25fal", "veo"]) {
    assert.equal(normalizeEngineKey(k), k, `${k} is still accepted from a saved recipe`);
    assert.ok(VIDEO_ENGINE_BY_KEY[k]);
    assert.equal(VIDEO_ENGINE_BY_KEY[k].menu, false);
  }
  assert.equal(engineSurcharge("veo"), 75);
  assert.equal(engineSurcharge("kling26"), 0);
  assert.equal(normalizeEngineKey("auto"), undefined);
  assert.equal(normalizeEngineKey("made-up"), undefined);
});

test("an engine in force is never hidden: a remix of an older piece shows its engine as picked", () => {
  assert.deepEqual(engineMenuFor("auto").map((e) => e.key), ["auto", "hailuo", "seedance", "veo31"]);
  assert.deepEqual(engineMenuFor(undefined).map((e) => e.key), ["auto", "hailuo", "seedance", "veo31"]);
  assert.deepEqual(engineMenuFor("veo31").map((e) => e.key), ["auto", "hailuo", "seedance", "veo31"], "an offered engine is not listed twice");
  assert.deepEqual(engineMenuFor("kling26").map((e) => e.key), ["auto", "hailuo", "seedance", "veo31", "kling26"]);
  assert.deepEqual(engineMenuFor("veo").map((e) => e.key), ["auto", "hailuo", "seedance", "veo31", "veo"]);
  assert.deepEqual(engineMenuFor("made-up").map((e) => e.key), ["auto", "hailuo", "seedance", "veo31"]);
});

test("both studios draw that menu", () => {
  const web = read("app", "routes", "web.studio.tsx");
  assert.ok(web.includes("import { engineMenuFor, engineSurcharge, normalizeEngineKey } from \"../lib/video-engines\";"));
  assert.ok(web.includes("{engineMenuFor(videoEngine).map((e) => ("));
  assert.ok(!web.includes("VIDEO_ENGINES.map("));
  const embedded = read("app", "routes", "app.studio.tsx");
  assert.ok(embedded.includes("{engineMenuFor(videoEngine).map((e) => ("));
  assert.ok(!embedded.includes("VIDEO_ENGINES.map("));
});
