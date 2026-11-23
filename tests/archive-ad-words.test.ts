/* AN IMAGE AD'S VIEWER SHOWS THE WORDS ON THE AD, NOT OUR BRIEF TO THE IMAGE MODEL.
 *
 * Opened as a customer, 2026-11-23: under "Prompt", one image ad showed the text "deterministic-callout"
 * (an internal tag) and the next showed our own brief ("Modern high-converting DTC e-commerce static ad,
 * crisp clean design, square 1:1 … Every text string below must appear EXACTLY as written …"). The ad's
 * actual words — the thing a merchant would check or paste into a post — were nowhere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adWordsOf } from "../app/lib/ad-words.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("the callout that was really made: headline, its four points, the button — one to a line", () => {
  const copy = { headline: "$43.14 for sixteen blind boxes", c1: "16 figures", c2: "Blind box", c3: "Secret chase", c4: "Easy bundle", cta: "Grab the set" };
  assert.equal(adWordsOf(copy), "$43.14 for sixteen blind boxes\n16 figures\nBlind box\nSecret chase\nEasy bundle\nGrab the set");
});

test("reading order whatever order the fields were stored in; the button is kept when lines run out", () => {
  assert.equal(adWordsOf({ cta: "Shop now", c2: "Two", headline: "Lead", c1: "One" }), "Lead\nTwo\nOne\nShop now", "the lead first, the button last, the rest as stored");
  const many = { headline: "H", n1: "one", n2: "two", n3: "three", n4: "four", n5: "five", n6: "six", cta: "Go" };
  const lines = adWordsOf(many)!.split("\n");
  assert.equal(lines.length, 6);
  assert.equal(lines[0], "H");
  assert.equal(lines[5], "Go");
  // a quiz ad opens on its question, a magazine cover on its masthead
  assert.equal(adWordsOf({ question: "Still guessing?", answer: "Sixteen figures, one set.", cta: "See it" }), "Still guessing?\nSixteen figures, one set.\nSee it");
  assert.equal(adWordsOf({ masthead: "FUNISM", cover1: "Sixteen tiny wonders", cover2: "The set to start with" }), "FUNISM\nSixteen tiny wonders\nThe set to start with");
});

test("bylines and layout labels are not the ad speaking; repeats are said once; nothing stored is nothing shown", () => {
  assert.equal(adWordsOf({ quote: "Opened three and kept going.", name: "Maya R.", cta: "Get yours" }), "Opened three and kept going.\nGet yours");
  assert.equal(adWordsOf({ tweet: "ok these are tiny and i love them", handle: "@tinyfan" }), "ok these are tiny and i love them");
  assert.equal(adWordsOf({ headline: "Sixteen", c1: "Sixteen", c2: "  spaced   out " }), "Sixteen\nspaced out");
  for (const none of [null, undefined, "", "deterministic-callout", [], {}, { headline: "  " }, { c1: 3 }]) assert.equal(adWordsOf(none), null);
});

test("the viewer: an image ad shows its words; only a picture the member described shows a prompt", () => {
  const src = read("app", "routes", "web.archive.tsx");
  assert.ok(src.includes("import { adWordsOf } from \"../lib/ad-words\";"));
  assert.ok(src.includes("const ownPicture = meta.kind === \"create\" || meta.kind === \"edit\";"));
  assert.ok(src.includes("const adWords = type === \"IMAGE_AD\" && !ownPicture ? adWordsOf(body.formatCopy) : null;"));
  assert.ok(src.includes("if (type === \"IMAGE_AD\" && !ownPicture) script = adWords;"), "our brief and the internal tag are never printed");
  assert.ok(src.includes("scriptLabel: script ? (adWords ? \"Words on the ad\" : isFaceless || isStory ? \"Narration\" : hasPresenter ? \"What they say\" : \"Prompt\") : null,"));
  // the block keeps its line breaks and shows six lines
  assert.ok(src.includes("white-space:pre-wrap;}"));
  assert.ok(src.includes(".wa-prompt-script{-webkit-line-clamp:6;}"));
  // the copy is stored with the picture when a format ad is made
  assert.ok(read("app", "lib", "image-generation.server.ts").includes("genMeta.formatCopy = r.copy;"));
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  assert.equal(dict.split("\"Words on the ad\":").length - 1, 5);
});
