import { test } from "node:test";
import assert from "node:assert/strict";
import { occupiedPlate } from "../app/lib/plate-scene.ts";

/* The real coral plate from ad-templates.ts. */
const CORAL =
  "Bold advertising backdrop: a flat vivid coral-red studio wall meeting a matching seamless coral floor, " +
  "single-color color-block look, bright punchy even studio lighting, completely empty scene with clear open " +
  "floor space across the lower third where a product will stand, no objects, no text, photorealistic, magazine-quality";

test("the emptiness assertions are removed", () => {
  const out = occupiedPlate(CORAL);
  assert.ok(!/completely empty scene/i.test(out), out);
  assert.ok(!/\bno objects\b/i.test(out), out);
});

test("everything that describes the backdrop survives", () => {
  const out = occupiedPlate(CORAL);
  for (const keep of [
    "Bold advertising backdrop",
    "flat vivid coral-red studio wall",
    "single-color color-block look",
    "bright punchy even studio lighting",
    "photorealistic",
    "magazine-quality",
  ]) {
    assert.ok(out.includes(keep), `lost: ${keep}`);
  }
});

test("'no text' is kept — an ad backdrop should still not invent lettering", () => {
  assert.ok(/no text/i.test(occupiedPlate(CORAL)));
});

test("the clause saying where the product stands is kept, because here it is placement", () => {
  // "clear open floor space ... where a product will stand" is an instruction
  // on this path, not a claim that the scene is empty
  assert.ok(/where a product will stand/i.test(occupiedPlate(CORAL)));
});

test("a plate with nothing to strip is returned intact in substance", () => {
  const plain = "Minimal editorial backdrop: bright white seamless sweep, soft daylight, photorealistic";
  assert.equal(occupiedPlate(plain), plain);
});

test("other phrasings of emptiness are caught too", () => {
  const out = occupiedPlate("Warm wooden table, empty scene, nothing in the frame, bare stage, soft light");
  assert.ok(!/empty scene/i.test(out), out);
  assert.ok(!/nothing in the frame/i.test(out), out);
  assert.ok(!/bare stage/i.test(out), out);
  assert.ok(out.includes("Warm wooden table"));
  assert.ok(out.includes("soft light"));
});

test("a word like 'emptying' inside a real clause is not mistaken for emptiness", () => {
  const s = "Studio shelf, an emptying hourglass beside it, warm light";
  assert.ok(occupiedPlate(s).includes("an emptying hourglass beside it"));
});

test("empty and malformed input do not throw", () => {
  assert.equal(occupiedPlate(""), "");
  assert.equal(occupiedPlate("   "), "");
  assert.equal(occupiedPlate(undefined as unknown as string), "");
});
