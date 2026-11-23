/* THE NAME A PRODUCT PICK FILLED IN GOES WITH THE PICK.
 *
 * Seen while making ads as a customer (noted 2026-11-18, fixed 2026-11-23): pick a product from the store —
 * its name fills the "Product name" box — then tap "Upload a photo". The picked product's picture and buy
 * link were dropped, as designed, but its NAME stayed. The ad made from the uploaded photo was then named,
 * scripted and captioned for the store product.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ui = fs.readFileSync(path.join(root, "app", "routes", "web.studio.tsx"), "utf8").replace(/\r\n/g, "\n");

/** The rule, as the page writes it: a model of dropPickedName + the three choose* handlers. */
type S = { source: "store" | "upload" | "link" | null; title: string; imageUrl: string; pickedUrl: string };
const CATALOG = ["Monchichi Hippers Series Sealed Set (12 per set)", "Funism palmsize wonders V2 (16 per set)"];
function choose(s: S, next: "store" | "upload" | "link"): S {
  if (s.source === next) return s; // a tap on the card that is already on wipes nothing
  const pickedName = s.source !== null && (!!s.pickedUrl || CATALOG.includes(s.title));
  return { source: next, title: pickedName ? "" : s.title, imageUrl: "", pickedUrl: "" };
}

test("the model: a pick's name leaves with the pick; a typed name stays; the first tap clears nothing", () => {
  const picked: S = { source: "store", title: CATALOG[0], imageUrl: "https://cdn/x.jpg", pickedUrl: "https://shop/p/monchichi" };
  assert.deepEqual(choose(picked, "upload"), { source: "upload", title: "", imageUrl: "", pickedUrl: "" });
  assert.deepEqual(choose(picked, "link"), { source: "link", title: "", imageUrl: "", pickedUrl: "" });
  assert.equal(choose(picked, "store"), picked, "re-tapping the active card");
  // the member typed their own name over a store pick (typing clears the buy link) — it is theirs
  const renamed: S = { ...picked, title: "My birthday gift set", pickedUrl: "" };
  assert.equal(choose(renamed, "upload").title, "My birthday gift set");
  // …a product read from a pasted link came with its page address: its name goes with it
  const imported: S = { source: "link", title: "Sonny Angel Hippers", imageUrl: "https://x/y.jpg", pickedUrl: "https://other.shop/p/1" };
  assert.equal(choose(imported, "store").title, "");
  // …the "last product" chip sets a catalogue title with no buy link: still a pick's name
  assert.equal(choose({ source: "store", title: CATALOG[1], imageUrl: "https://cdn/f.jpg", pickedUrl: "" }, "upload").title, "");
  // a name typed under "Upload a photo" survives a look at the store grid
  assert.equal(choose({ source: "upload", title: "Hand-poured soy candle", imageUrl: "", pickedUrl: "" }, "store").title, "Hand-poured soy candle");
  // no source yet (a name pre-filled by a link into the page): the first tap on a card clears nothing
  assert.equal(choose({ source: null, title: CATALOG[0], imageUrl: "", pickedUrl: "" }, "store").title, CATALOG[0]);
});

test("the page is that model", () => {
  assert.ok(ui.includes("const dropPickedName = () => {\n    if (prodSource !== null && (pickedUrl || d.catalog.some((c) => c.title === productTitle))) setProductTitle(\"\");\n  };"));
  for (const k of ["store", "upload", "link"]) {
    const fn = `choose${k[0].toUpperCase()}${k.slice(1)}`;
    assert.ok(ui.includes(`const ${fn} = () => { if (prodSource !== "${k}") { dropPickedName(); setImageUrl(""); setPickedUrl(""); } setProdSource("${k}");`), fn);
  }
  // dropPickedName reads prodSource BEFORE the switch: it is called first in each handler
  assert.equal(ui.split("{ dropPickedName(); setImageUrl(\"\"); setPickedUrl(\"\"); }").length - 1, 3);
  // typing in the name box makes the name the member's own: it drops the buy link the pick came with
  assert.ok(ui.includes("onChange={(e) => { setProductTitle(e.target.value); setPickedUrl(\"\"); }}"));
  // a store pick, a link import and the "last product" chip are what fill the name from a pick
  assert.ok(ui.includes("setProductTitle(c.title);\n                    setImageUrl(c.imageUrl || \"\");\n                    setPickedUrl(c.url);"));
  assert.ok(ui.includes("if (imp) { setProductTitle(imp.title); setImageUrl(imp.image || \"\"); setPickedUrl(imp.url || \"\");"));
});
