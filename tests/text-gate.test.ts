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

test("an ordinary English near-pair is fine ALONGSIDE the requested word, and a corruption OF it is not", () => {
  // "through" and "thought" are two edits apart, and this pair is exactly why
  // the forward rule's threshold is one edit rather than two: flagging a
  // second word that merely resembles requested copy costs a good ad.
  //
  // But the two cases are not the same, and this test used to conflate them.
  // If "through" is on the ad and "thought" appears as well, nothing is wrong.
  // If "through" is MISSING and "thought" is standing where it should be, the
  // ad no longer says what the merchant's copy said — that is a corruption,
  // and the reverse rule is there to name it. A live ad rendered “flimily”
  // for “flimsy” and shipped precisely because nothing looked at it this way.
  const expected = ["Read this through before buying"];
  const product = ["Weighted Blanket"];
  assert.equal(findCorruptedWord(expected, product, "Read this through before buying thought"), null);
  assert.equal(findCorruptedWord(expected, product, "Read this thought before buying"), "thought");
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

test("a two-edit corruption of ordinary requested copy is caught by the missing word", () => {
  // From a live ad: the model rendered "flimily" for a requested "flimsy" and
  // "keychien" for "keychain". The forward rule catches the second (the
  // product name pool is deliberately wider) and cannot reach the first —
  // "flimsy" is ordinary English, so it only gets the tight one-edit pool.
  const expected = [
    "The Difference Is Clear", "Six unique designs", "Soft plush texture",
    "Secure keychain clip", "One generic design", "Stiff cheap fabric", "Loose flimsy clasp",
  ];
  const product = ["Anime Cat Ear Plush Keychain Case (6 Toys)"];
  assert.equal(
    findCorruptedWord(expected, product, "One generic design Stiff cheap fabric Loose flimily clasp Six unique designs Soft plush texture Secure keychain clip"),
    "flimily",
  );
});

test("clean copy still passes, and a dropped line is not called a corruption", () => {
  const expected = ["Loose flimsy clasp", "Secure keychain clip", "Six unique designs"];
  const product = ["Anime Cat Ear Plush Keychain Case"];
  // Everything rendered correctly.
  assert.equal(findCorruptedWord(expected, product, "Loose flimsy clasp Secure keychain clip Six unique designs"), null);
  // The transcriber missed a whole line: nothing near it was rendered, so
  // there is no impostor to name and this rule stays quiet.
  assert.equal(findCorruptedWord(expected, product, "Secure keychain clip Six unique designs"), null);
});

test("ordinary English near-pairs do not trip the reverse rule", () => {
  // The word we asked for is present, so a similar word elsewhere is just
  // another word. This is the case the tight forward threshold exists for.
  assert.equal(findCorruptedWord(["Sleep through the noise"], [], "Sleep through the noise thought"), null);
  // "designer" against a requested "Designed" IS flagged, and deliberately:
  // the base prompt forbids the model adding layout text of its own, so an
  // unrequested near-neighbour is a defect either way. That is the forward
  // rule, unchanged.
  assert.equal(findCorruptedWord(["Designed for comfort"], [], "Designed for comfort designer"), "designer");
});
