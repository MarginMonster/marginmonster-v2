import { test } from "node:test";
import assert from "node:assert/strict";
import { brandLines, brandBlock, NO_BRAND } from "../app/lib/brand-prompt.ts";

test("a web-form profile never emits the word undefined", () => {
  // Exactly what web._index.tsx used to store: productJson "{}", empty arrays.
  const out = brandLines({
    voiceJson: JSON.stringify({ tone: "warm", tagline: "", about: "", vocabulary: [], values: [] }),
    productJson: "{}",
  });
  assert.doesNotMatch(out, /undefined/);
  assert.equal(out, "Tone: warm");
});

test("empty and whitespace-only fields are dropped, not printed blank", () => {
  const out = brandLines({
    voiceJson: JSON.stringify({ tone: "   ", vocabulary: ["", "  "], values: [] }),
    productJson: JSON.stringify({ positioning: "" }),
  });
  assert.equal(out, "");
  assert.equal(brandBlock({ voiceJson: "{}", productJson: "{}" }), NO_BRAND);
});

test("every line that has content is carried, in house order", () => {
  const out = brandLines({
    voiceJson: JSON.stringify({
      tone: "bold", vocabulary: ["punchy", "loud"], values: ["speed"], tagline: "Go fast",
      about: "We sell hot sauce to people who like pain.",
    }),
    productJson: JSON.stringify({ storeName: "Fire Co", categories: ["sauce"], positioning: "Hotter than the rest" }),
  });
  assert.deepEqual(out.split("\n"), [
    "Store: Fire Co",
    "Sells: sauce",
    "Tone: bold",
    "Vocabulary to use: punchy, loud",
    "Brand values: speed",
    "Tagline: Go fast",
    "Brand positioning: Hotter than the rest",
    "About the store, in the merchant's own words: We sell hot sauce to people who like pain.",
  ]);
});

test("a corrupt or non-object blob degrades to the fallback, it does not throw", () => {
  for (const bad of ["", "null", "[]", "{oops", "42", '"a string"']) {
    assert.equal(brandBlock({ voiceJson: bad, productJson: bad }), NO_BRAND, bad);
  }
  assert.equal(brandBlock({}), NO_BRAND);
});

test("free text from the merchant is capped so it cannot swallow the prompt", () => {
  const out = brandLines({ voiceJson: JSON.stringify({ about: "x".repeat(5000) }), productJson: "{}" });
  assert.equal(out.length, "About the store, in the merchant's own words: ".length + 600);
});

test("array fields survive junk members", () => {
  const out = brandLines({
    voiceJson: JSON.stringify({ vocabulary: ["ok", null, 7, { a: 1 }, "fine"] }),
    productJson: "{}",
  });
  assert.equal(out, "Vocabulary to use: ok, fine");
});
