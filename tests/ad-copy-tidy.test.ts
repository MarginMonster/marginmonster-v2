import { test } from "node:test";
import assert from "node:assert/strict";
import { tidyAdCopy, fixContractions, collapseStutter } from "../app/lib/ad-copy-tidy.ts";

test("restores the apostrophe that shipped on a live ad", () => {
  // Verbatim from an ad in the merchant's Archive.
  assert.equal(tidyAdCopy("FINALLY A CAKE THAT WONT CRUMBLE."), "FINALLY A CAKE THAT WON'T CRUMBLE.");
});

test("case is carried across, all three ways", () => {
  assert.equal(fixContractions("wont"), "won't");
  assert.equal(fixContractions("Wont"), "Won't");
  assert.equal(fixContractions("WONT"), "WON'T");
  assert.equal(fixContractions("youre THEYRE Thats"), "you're THEY'RE That's");
});

test("words that only LOOK like contractions are left alone", () => {
  // Every one of these is correct English as written, and 'fixing' it would
  // change the meaning of copy the model meant.
  for (const safe of [
    "lets you skip the queue",
    "its colour is perfect",
    "well worth the money",
    "ill effects, none",
    "we were there first",
    "your order ships today",
    "a well id never use",
    "wed love to see it",
  ]) {
    assert.equal(fixContractions(safe), safe, safe);
  }
});

test("collapses the stutter the prompt keeps naming", () => {
  assert.equal(collapseStutter("first try first try"), "first try");
  assert.equal(collapseStutter("the the best deal"), "the best deal");
  assert.equal(collapseStutter("built to last built to last, promise"), "built to last, promise");
  // The kept copy is the one carrying the punctuation.
  assert.equal(tidyAdCopy("first try, first try."), "first try.");
});

test("a deliberate refrain is not a stutter", () => {
  // Non-adjacent repetition is a real device in ad copy and must survive.
  const refrain = "more colour, more life, more you";
  assert.equal(collapseStutter(refrain), refrain);
  const four = "one two three four one two three four";
  assert.equal(collapseStutter(four), four); // runs longer than three are left alone
});

test("tidies the punctuation that means a string was cut", () => {
  assert.equal(tidyAdCopy("Hydration , upgraded"), "Hydration, upgraded");
  assert.equal(tidyAdCopy("Shop now!!"), "Shop now!");
  assert.equal(tidyAdCopy("Everything you get,"), "Everything you get");
  assert.equal(tidyAdCopy("  spaced   out  "), "spaced out");
});

test("never throws, whatever it is handed", () => {
  assert.equal(tidyAdCopy(""), "");
  assert.equal(tidyAdCopy(undefined as unknown as string), "");
  assert.equal(tidyAdCopy(null as unknown as string), "");
  assert.equal(tidyAdCopy(42 as unknown as string), "");
  assert.equal(tidyAdCopy("é 你好 🎉"), "é 你好 🎉");
});

test("leaves real product copy untouched", () => {
  for (const good of [
    "Glass skin, minus the 12 steps.",
    "2% hyaluronic acid",
    "$0.40 per serving",
    "14 days of battery on one charge",
    "There's no comparison.",
  ]) {
    assert.equal(tidyAdCopy(good), good, good);
  }
});
