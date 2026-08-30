/* The mechanical spell-check that stands between a mangled product name and a
 * merchant's ad. Both cases below are ads that actually shipped. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { editDistance, findCorruptedWord } from "../app/lib/text-gate.ts";

const COPY = [
  "Ten Boxes, One Rare Coin",
  "Sealed Boxes",
  "S-Chinese Print",
  "Terastal Umbreon",
  "Collector Coin",
  "Shop Now",
];
const PRODUCT = ["X10 Boxes Pokemon TCG S-Chinese Terastal Umbreon Coin Set"];

test("catches the corruption that shipped: Umboron for Umbreon", () => {
  const bad = findCorruptedWord(COPY, PRODUCT, "Ten Boxes One Rare Coin Terastal Umboron Collector Coin");
  assert.equal(bad, "umboron");
});

test("catches the corruption the code comment records: Teraastal for Terastal", () => {
  const bad = findCorruptedWord(COPY, PRODUCT, "Teraastal Umbreon Collector Coin");
  assert.equal(bad, "teraastal");
});

test("correct copy passes", () => {
  const ok = findCorruptedWord(COPY, PRODUCT, "Ten Boxes One Rare Coin Sealed Boxes Terastal Umbreon Shop Now");
  assert.equal(ok, null);
});

test("ordinary English two edits apart is NOT flagged", () => {
  // "through" and "thought" are two edits apart. Flagging that costs a good ad.
  const ok = findCorruptedWord(["Read this through before buying"], ["Weighted Blanket"], "Read this thought before buying");
  assert.equal(ok, null);
});

test("short words are never flagged — Ship against a requested Shop", () => {
  assert.equal(findCorruptedWord(["Shop Now"], ["Widget"], "Ship Now"), null);
});

test("legitimate extra copy is left alone", () => {
  const ok = findCorruptedWord(COPY, PRODUCT, "Ten Boxes One Rare Coin Limited Edition Terastal Umbreon");
  assert.equal(ok, null);
});

test("a product name mangled by two edits is caught even when absent from the copy", () => {
  // The gate's whole reason for the wider product-name net.
  const bad = findCorruptedWord(["Sleep better tonight"], ["Asleep Weighted Blanket"], "FALL ASALEP FASTER");
  assert.equal(bad, "asalep");
});

test("empty and missing transcripts are clean, not crashes", () => {
  assert.equal(findCorruptedWord(COPY, PRODUCT, ""), null);
  assert.equal(findCorruptedWord(COPY, PRODUCT, undefined), null);
  assert.equal(findCorruptedWord(COPY, PRODUCT, null), null);
});

test("no expected copy at all cannot flag anything", () => {
  assert.equal(findCorruptedWord([], [], "anything at all here"), null);
});

test("editDistance bails out past max instead of computing the true distance", () => {
  assert.equal(editDistance("umbreon", "umbreon"), 0);
  assert.equal(editDistance("umbreon", "umbroon"), 1);
  assert.equal(editDistance("umbreon", "umboron"), 2);
  // Beyond the cap it reports max+1 rather than the real distance.
  assert.equal(editDistance("umbreon", "banana", 2), 3);
});
