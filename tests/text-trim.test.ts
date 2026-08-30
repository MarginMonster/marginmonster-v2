/* Length limits on strings a model is told to reproduce "word for word" — and
 * that are printed on ads and spoken aloud by TTS. A hard slice ends them
 * mid-word and the model faithfully renders the fragment. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { trimToWord } from "../app/lib/text-trim.ts";

test("a string under the limit is returned untouched", () => {
  assert.equal(trimToWord("20% off", 60), "20% off");
  assert.equal(trimToWord("abcde", 5), "abcde");
});

test("a merchant's offer is cut at a word, not through one", () => {
  const offer = "20% off your first order when you spend over fifty pounds";
  assert.equal(trimToWord(offer, 40), "20% off your first order when you spend");
  // what it used to do, for contrast
  assert.equal(offer.slice(0, 40), "20% off your first order when you spend ");
});

test("no dangling punctuation is left behind", () => {
  assert.equal(trimToWord("Sleek bottle on marble, soft shadow falls left", 24), "Sleek bottle on marble");
});

test("empty, null and undefined are safe", () => {
  assert.equal(trimToWord("", 40), "");
  assert.equal(trimToWord(null, 40), "");
  assert.equal(trimToWord(undefined, 40), "");
});

/* The contract is: never cut mid-word WHEN a word boundary exists at or before
 * the limit. If the first word is itself longer than the limit there is no
 * boundary to cut at, and a hard cut beats returning nothing — asserted
 * separately below. Real limits in this codebase are 40-300, where a first word
 * longer than the limit does not occur.
 *
 * An earlier version of this test asserted an absolute "never mid-word at any
 * limit", which no implementation can satisfy. It did, however, catch a real
 * bug on the way: the function used to reject a valid boundary that fell in the
 * front half of the limit and hard-cut instead, turning "X10 Boxes Pokemon…"
 * into "X10 Boxe". */
test("never ends mid-word whenever a word boundary exists", () => {
  const corpus = [
    "20% off your first order when you spend over fifty pounds",
    "Bright airy kitchen, morning light, steam rising off the cup",
    "X10 Boxes Pokemon TCG S-Chinese Terastal Umbreon Coin Set",
    "Experience deep restful sleep with the weighted blanket everyone talks about",
  ];
  for (const text of corpus) {
    for (let max = 8; max <= 60; max++) {
      const out = trimToWord(text, max);
      assert.ok(out.length <= max, `exceeded the limit at max=${max}`);
      const boundaryExists = text.slice(0, max).includes(" ");
      if (out.length < text.length && boundaryExists) {
        const lastChar = out.slice(-1);
        const nextChar = text[out.length];
        const splitAWord = /[A-Za-z0-9]/.test(lastChar) && /[A-Za-z0-9]/.test(nextChar);
        assert.ok(!splitAWord, `cut mid-word at max=${max}: ${JSON.stringify(out)}`);
      }
    }
  }
});

test("a boundary in the front half is still used", () => {
  // The bug the property test found: index 3 is a valid place to cut.
  assert.equal(trimToWord("X10 Boxes Pokemon TCG", 8), "X10");
});

test("when the first word alone exceeds the limit, a hard cut beats nothing", () => {
  // No boundary exists, so there is nothing to cut at. Returning "" would drop
  // the instruction out of the prompt entirely.
  assert.equal(trimToWord("Experience deep restful sleep", 8), "Experien");
  assert.equal(trimToWord("A".repeat(80), 40), "A".repeat(40));
});
