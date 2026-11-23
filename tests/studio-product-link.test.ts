/* "PASTE A PRODUCT LINK" IS A WAY IN, NOT A SMALL LINK BESIDE THE NAME BOX.
 *
 * Rival ad makers open with a link box (Creatify, Predis, Captions, Revid, TikTok Symphony: "any product
 * URL works as input"). The Ad Maker could already read a product page — behind a 12px "＋ Add by URL"
 * on the Product name label, whose product was then shown as a pick from a store grid it might not even
 * be in. It is now the third card of the product chooser, beside "From your store" and "Upload a photo",
 * with one box and one set of rules, and it follows the chooser's invariant: what is on screen is what is
 * submitted — exactly one productImageUrl field is ever mounted, and nothing of another source rides along.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const ui = read("app", "routes", "web.studio.tsx");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

test("the link is a third source, and both choosers offer it as a card", () => {
  assert.ok(ui.includes("const [prodSource, setProdSource] = useState<\"store\" | \"upload\" | \"link\" | null>(null);"));
  assert.equal(count(ui, "<button type=\"button\" className={`ws-srccard${prodSource === \"link\" ? \" sel\" : \"\"}`} aria-pressed={prodSource === \"link\"} onClick={pickLinkCard}>"), 2, "the hub's chooser and the classic one");
  assert.equal(count(ui, "<b>{t(\"Paste a product link\")}</b>"), 2);
  assert.equal(count(ui, "{prodSource === \"link\" && !serviceForced && linkBranchUI}"), 2, "the same box under each — built once");
  assert.equal(count(ui, "const linkBranchUI = ("), 1);
  // the small control it replaces is gone: two controls an inch apart were one decision
  assert.ok(!ui.includes("setShowImport(") && !ui.includes("{t(\"Add by URL\")}"));
});

test("arriving from another source drops that source's pick; the card puts the cursor in the box", () => {
  assert.ok(ui.includes("const chooseLink = () => { if (prodSource !== \"link\") { dropPickedName(); setImageUrl(\"\"); setPickedUrl(\"\"); } setProdSource(\"link\"); setShowConnect(false); };"));
  assert.ok(ui.includes("const pickLinkCard = () => { flushSync(chooseLink); linkInputRef.current?.focus(); };"), "one tap, then paste");
  // the other two cards already drop whatever came from any source but their own
  assert.ok(ui.includes("const chooseStore = () => { if (prodSource !== \"store\") { dropPickedName(); setImageUrl(\"\"); setPickedUrl(\"\"); } setProdSource(\"store\");"));
  assert.ok(ui.includes("const chooseUpload = () => { if (prodSource !== \"upload\") { dropPickedName(); setImageUrl(\"\"); setPickedUrl(\"\"); } setProdSource(\"upload\"); setShowConnect(false); };"));
});

test("an imported product stays under ITS card, counts as a product, and rides the submit in the same field", () => {
  // it used to be dressed as a store pick
  assert.ok(ui.includes("if (imp) { setProductTitle(imp.title); setImageUrl(imp.image || \"\"); setPickedUrl(imp.url || \"\"); if (imp.image) { setUrlInput(\"\"); setHubPick(null); } setProdSource(\"link\"); }"));
  assert.ok(ui.includes("|| (prodSource === \"link\" && !!imageUrl.trim());"), "with a picture it is a product; without one it is not");
  // exactly one hidden productImageUrl per chooser, mounted for the store AND the link — never under Upload
  assert.equal(count(ui, "{(prodSource === \"store\" || prodSource === \"link\") && !serviceForced && <input type=\"hidden\" name=\"productImageUrl\" value={imageUrl} />}"), 2);
  assert.ok(!ui.includes("{prodSource === \"store\" && !serviceForced && <input type=\"hidden\" name=\"productImageUrl\""));
});

test("the box can only import: it is not a field of the Generate form", () => {
  const box = ui.slice(ui.indexOf("const linkBranchUI = ("), ui.indexOf("// The product source chooser (cards + store grid/connect/import + upload box +"));
  assert.ok(box.includes("<input ref={linkInputRef} form=\"ws-linkform\""), "it belongs to the little form at the foot of the page");
  assert.ok(box.includes("onKeyDown={(e) => { if (e.key === \"Enter\") { e.preventDefault(); if (!busy) doImport(); } }}"));
  assert.ok(ui.includes("<form id=\"ws-linkform\" hidden noValidate onSubmit={(e) => { e.preventDefault(); if (!busy) doImport(); }} />"));
  assert.ok(ui.includes("const doImport = () => { if (urlInput.trim()) submit({ intent: \"importUrl\", url: urlInput.trim() }, { method: \"post\" }); };"), "the import that was already there — free");
  // what came back is shown; a page with no picture says so and keeps the link in the box
  assert.ok(box.includes("{importErr && <p className=\"ws-note ws-err\" role=\"alert\">{importErr}</p>}"));
  assert.ok(box.includes("t(\"We read the name, but that page has no picture we can use. Try another link, or upload a photo instead.\")"));
  assert.ok(box.includes("<div className=\"ws-cat sel ws-linkfound\" role=\"status\">"), "drawn the way a store pick is");
});

test("the nudges name all three ways in, and the link has a line of its own", () => {
  assert.ok(ui.includes("t(\"Tap “Add your product” above — from your store, a product link, or a photo.\")"));
  assert.ok(ui.includes("t(\"Pick where your product comes from above — your store, a product link, or a photo.\")"));
  assert.equal(count(ui, "? t(\"Paste your product link above so the ad features it.\")"), 2);
  assert.equal(count(ui, "t(\"You can paste a single product link instead — tap “Paste a product link” above.\")"), 2);
});

test("three cards across on a wide screen, one per row on a phone", () => {
  assert.ok(ui.includes(".ws-srcpick{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:4px 0 12px}"));
  assert.ok(ui.includes("@media (max-width:620px){\n  .ws-srcpick{grid-template-columns:minmax(0,1fr);gap:8px}"));
  assert.ok(ui.includes("min-height:58px"), "three equal places to tap");
  assert.ok(!ui.includes("  .ws-srccard{min-height:76px}"), "the two-across height is gone with the two-across row");
});

test("every new sentence is in all five languages", () => {
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const s of [
    "Paste a product link",
    "We read the name and photo off the page",
    "We read the name, but that page has no picture we can use. Try another link, or upload a photo instead.",
    "You can paste a single product link instead — tap “Paste a product link” above.",
    "Tap “Add your product” above — from your store, a product link, or a photo.",
    "Paste your product link above so the ad features it.",
    "Pick where your product comes from above — your store, a product link, or a photo.",
  ]) assert.equal(count(dict, `\n  ${JSON.stringify(s)}: `), 5, s);
});
