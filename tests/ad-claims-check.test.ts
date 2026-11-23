/* AN AD'S WORDS ARE READ FOR CLAIMS NOBODY GAVE IT — AN INSTRUCTION ALONE CAN LOSE.
 *
 * Made as a customer, 2026-11-23: a Commercial for a toy set with the Ad Maker's own quick direction
 * "fast + funny, lead with the price". The writer was given no price, so it led with one anyway — "Sixteen
 * blind boxes, the lowest price around", tagline "Sixteen Wonders, Lowest Price" — spoken by the narrator
 * and printed on screen. The claims guardrail in its prompt names 'lowest price' as a thing never to invent;
 * the member's direction outweighed it. The merchant is answerable for that sentence (FTC, 16 CFR 465).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLAIMS_GUARDRAIL, claimFaults, claimRepairNote, dropFaultSentences } from "../app/lib/ad-claims.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

const LIVE = "Bored shelf. Boring day. Something's got to change. Sixteen blind boxes, the lowest price around. Sixteen chances, one set, pure impulse buy. Sixteen surprises, every single one a win. Best impulse grab, sixteen wonders, one easy buy.";
const DIRECTION = "fast + funny, lead with the price";

test("the ad that was really made is caught", () => {
  assert.deepEqual(claimFaults(LIVE, DIRECTION), ["lowest price", "price around"]);
  assert.deepEqual(claimFaults("Sixteen Wonders, Lowest Price", DIRECTION), ["lowest price"]);
});

test("each rule's unmistakable words are found", () => {
  const cases: Array<[string, string]> = [
    ["The cheapest way to collect them all.", "cheapest"],
    ["Unbeatable value for a full set.", "unbeatable value"],
    ["Take 30% off this week.", "30% off"],
    ["Grab it today only.", "today only"],
    ["A limited-time drop.", "limited-time"],
    ["Free shipping on every case.", "free shipping"],
    ["Order now while supplies last.", "while supplies last"],
    ["They are selling fast.", "selling fast"],
    ["The #1 blind box in the country.", "#1"],
    ["Our best-selling set.", "best-selling"],
    ["A top-rated toy.", "top-rated"],
    // the plain price comparisons (an image ad printed a "Low cost" chip beside no price, 2026-11-23)
    ["Low cost", "low cost"],
    ["Low prices on every set.", "low prices"],
    ["A low-priced way to start.", "low-priced"],
    ["Cheaper than a night out.", "cheaper"],
    ["It's cheap fun.", "cheap"],
    ["A real bargain.", "bargain"],
    ["Sixteen figures? That's a steal.", "a steal"],
    ["Rated 4.9 stars by fans.", "4.9 stars"],
    ["Thousands of happy customers agree.", "thousands of happy customers"],
    ["Backed by a money-back promise.", "money-back"],
    ["Satisfaction guaranteed.", "guaranteed"],
    ["An authentic collectible.", "authentic"],
    ["Officially licensed figures.", "officially licensed"],
    ["Every box is factory-sealed.", "factory-sealed"],
  ];
  for (const [line, word] of cases) assert.ok(claimFaults(line).includes(word), `${line} → ${JSON.stringify(claimFaults(line))}`);
});

test("ordinary selling words are left alone", () => {
  for (const line of [
    "Sixteen blind boxes for $43.14.",
    "Best impulse grab, sixteen wonders, one easy buy.",
    "Your best morning starts here.",
    "A whole set of little companions, ready to display.",
    "One price, sixteen surprises.",
    "The stars of your shelf.",
    "Made to perch right on the edge of anything.",
    "Open one. Then another. Then all of them.",
    // words that only look like the new price words
    "Slow costume changes, fast laughs.",
    "Steal the show at your next party.",
    "Follow the low road home.",
    "A cheerful little set.",
  ]) assert.deepEqual(claimFaults(line), [], line);
  // …and a price word the merchant wrote themselves is theirs
  assert.deepEqual(claimFaults("Low cost", "Low cost blind boxes for resellers"), []);
  assert.deepEqual(claimFaults(""), []);
  assert.deepEqual(claimFaults(null), []);
});

test("a claim the merchant made is theirs to make", () => {
  assert.deepEqual(claimFaults("Take 20% off this week.", "Mention our 20% off sale"), []);
  assert.deepEqual(claimFaults("Take 20% off — sale ends Friday.", "Mention our 20% off sale"), ["sale ends"], "…but not what the writer added to it");
  assert.deepEqual(claimFaults("Officially licensed and factory-sealed.", "Officially Licensed Sanrio set, factory-sealed case"), []);
  assert.deepEqual(claimFaults("Free shipping on every case.", "we do FREE SHIPPING over $50"), [], "case and spacing do not matter");
  // curly apostrophes in either text do not hide a match
  assert.deepEqual(claimFaults("It’s the lowest price around.", "it’s the lowest price around"), []);
});

test("the writer is told which words, and the last resort removes only the sentences that claim", () => {
  const note = claimRepairNote(["lowest price", "price around"]);
  assert.ok(note.includes("\"lowest price\", \"price around\""));
  assert.ok(/no price talk, discount, deadline, rank, guarantee or authenticity claim/.test(note));
  assert.ok(note.includes("Keep the story, the scenes and every line that made no such claim."));
  assert.equal(
    dropFaultSentences(LIVE, DIRECTION),
    "Bored shelf. Boring day. Something's got to change. Sixteen chances, one set, pure impulse buy. Sixteen surprises, every single one a win. Best impulse grab, sixteen wonders, one easy buy.",
  );
  assert.equal(dropFaultSentences("Sixteen Wonders, Lowest Price", DIRECTION), "", "nothing left: the caller puts a plain line there");
  assert.equal(dropFaultSentences("A whole set, ready to display.", ""), "A whole set, ready to display.", "a clean line comes back as it was");
  assert.equal(dropFaultSentences("Take 20% off this week. Collect all sixteen.", "our 20% off sale"), "Take 20% off this week. Collect all sixteen.");
});

test("the instruction still names what the check enforces", () => {
  assert.ok(CLAIMS_GUARDRAIL.includes("invent no '50% off', 'today only', 'lowest price' or deal"));
});

test("the Commercial reads its own words before using them, and knows the real price", () => {
  const src = read("app", "lib", "commercial-ad-pipeline.server.ts");
  // the price: said once and exactly when the catalogue has one; left alone when it does not. The rule is
  // one function now (ad-claims.ts → priceRule, tests/ad-price-rule.test.ts) — every ad writer is given it.
  assert.ok(src.includes("priceRule(price, [productDescription, direction].filter(Boolean).join(\" \")),"));
  assert.ok(src.includes("const price = cleanPrice(priceText);"));
  assert.ok(src.includes("import { catalogPriceFor } from \"./catalog-import.server\";"));
  assert.ok(read("app", "lib", "catalog-import.server.ts").includes("const row = await db.catalogProduct.findFirst({ where: { shopId, title: t }, select: { priceText: true } });"));
  assert.equal(src.split("await catalogPriceFor(params.shopId, params.productTitle)").length - 1, 2, "the free preview and the paid render are given the same price");
  // read → ask once more → cut the sentence
  assert.ok(src.includes("const merchantSaid = [productTitle, productDescription, direction, price].filter(Boolean).join(\" \\n \");"));
  assert.ok(src.includes("let faults = claimFaults(spoken(j), merchantSaid);"));
  assert.ok(src.includes("const again = shape(await ask(claimRepairNote(faults)));"));
  assert.ok(src.includes("if (left.length < faults.length) { j = again; faults = left; }"), "a rewrite is kept only when it claims less");
  assert.ok(src.includes("j.beats = j.beats.map((b) => ({ ...b, narration: dropFaultSentences(b.narration, merchantSaid) || `${plain}.` }));"));
  assert.ok(src.includes("j.tagline = dropFaultSentences(j.tagline, merchantSaid) || plain;"));
  // the narrator's lines and the tagline are both what is checked — both are spoken and both are printed
  assert.ok(src.includes("const spoken = (p: CommercialPlan) => [...p.beats.map((b) => b.narration), p.tagline].join(\" \\n \");"));
});
