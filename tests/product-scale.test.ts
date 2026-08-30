/* The size hint that goes into a paid image prompt.
 *
 * When this is right, the composer draws a product at a believable size next to
 * a presenter. When it is wrong it is worse than absent: the no-hint path says
 * nothing at all, while a bogus number actively instructs the model to draw a
 * shampoo bottle the width of a hand.
 *
 * The two cases below are the ones that shipped — both from putting a bare "in"
 * in the unit list, and both extremely common in real product copy. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { explicitCm } from "../app/lib/product-scale.ts";

const near = (got: number | null, want: number) => {
  assert.ok(got !== null, "expected a measurement, got none");
  assert.ok(Math.abs(got! - want) < 0.05, `expected ~${want}cm, got ${got}`);
};

test('"3 IN 1" is a product name, not three inches', () => {
  assert.equal(explicitCm("3 IN 1 Shampoo Conditioner Body Wash"), null);
  assert.equal(explicitCm("5 in 1 multi tool"), null);
});

test('"12 in stock" is inventory, not a dimension', () => {
  assert.equal(explicitCm("Silver ring — 12 in stock, ships today"), null);
  assert.equal(explicitCm("Only 8 in stock"), null);
});

test("a real inch measurement is still read", () => {
  near(explicitCm("Wall art, 24 in"), 60.96);
  near(explicitCm("Cutting board 18 in, walnut"), 45.72);
  near(explicitCm('Monitor stand 20"'), 50.8);
  near(explicitCm("Shelf 30 inches wide"), 76.2);
  near(explicitCm("Poster: 16 inch square"), 40.64);
});

test("a dimension triple keeps working", () => {
  // 30 in is the largest of the three.
  near(explicitCm("Desk 24 in x 18 in x 30 in"), 76.2);
});

test("only numbers that carry a unit are measured", () => {
  // "12 x 8 in" is 12 inches by 8 inches to a human, but the 12 is bare and
  // this function deliberately does not infer units across a chain — guessing
  // is how "3 in 1" became three inches. Reading the 8 understates the product
  // slightly; inventing a unit for the 12 would be the same class of mistake
  // that made the hint actively wrong.
  near(explicitCm("Box 12 x 8 in"), 20.32);
});

test("metric units are read and converted", () => {
  near(explicitCm("Bottle, 25cm tall"), 25);
  near(explicitCm("Blade 150 mm"), 15);
  near(explicitCm("Rug 2 m long"), 200);
});

test("the largest measurement in the text wins", () => {
  near(explicitCm("Frame 20cm x 30cm x 5cm"), 30);
});

test("absurd readings are ignored", () => {
  assert.equal(explicitCm("2026 Collection Calendar"), null); // a year
  assert.equal(explicitCm("Micro bead 1mm"), null); // 0.1cm — not a product size
  assert.equal(explicitCm("Ladder 900 cm"), null); // 9m — not a shippable product
});

test("units glued to other words are not measurements", () => {
  assert.equal(explicitCm("500ml bottle"), null);
  assert.equal(explicitCm("30min timer"), null);
  assert.equal(explicitCm("100mg capsules"), null);
});

test("empty and missing text are safe", () => {
  assert.equal(explicitCm(""), null);
  assert.equal(explicitCm(undefined as unknown as string), null);
});
