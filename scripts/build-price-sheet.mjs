#!/usr/bin/env node
/**
 * Wholesale price sheet → PDF.
 *
 * Reads the catalogue dump the `catalog` QA mode publishes (catalog.json plus
 * the downscaled shots under cat/) and lays it out as a printable price sheet:
 * photo, product, price, air shipping, sea shipping.
 *
 * Rendering goes through headless Chromium's --print-to-pdf rather than a PDF
 * library. The sandbox has no reportlab or PIL, Chromium is already installed
 * for Playwright, and HTML+CSS is the layout language a print catalogue
 * actually wants — page breaks, repeating table headers, and web fonts all
 * come free.
 *
 *   node scripts/build-price-sheet.mjs <dump-dir> [out.pdf]
 *
 * Environment:
 *   SHEET_TITLE      headline on the cover        (default "Wholesale Price Sheet")
 *   SHEET_BRAND      brand line on the cover      (default derived from store host)
 *   SHEET_CONTACT    contact line on the cover    (optional)
 *   AIR_NOTE         text for the air column when no rate table is supplied
 *   AIR_RATES        path to a JSON rate file (see resolveAir below)
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dumpDir = process.argv[2];
const outPdf = path.resolve(process.argv[3] || "price-sheet.pdf");
if (!dumpDir) {
  console.error("usage: build-price-sheet.mjs <dump-dir> [out.pdf]");
  process.exit(2);
}

const data = JSON.parse(fs.readFileSync(path.join(dumpDir, "catalog.json"), "utf8"));
const rows = data.rows || [];

/* ── Sections ──────────────────────────────────────────────────────────────
 * The ask was "all Pokemon products, toys, and cards", which for this store is
 * effectively the whole catalogue — so nothing is dropped, it is grouped. A
 * buyer scanning a price sheet wants the sealed Pokémon together, not
 * alphabetical soup. Order matters: the first rule that matches wins, so the
 * narrow ones come first.                                                   */

/* Half the Pokémon shelf never says "Pokémon": the Korean and Japanese sealed
 * product is listed by set code ("X3 Boxes SV8A Terastal Festival Boosters
 * Sealed Korean"), and dropping 39 booster boxes into "Other" on a price sheet
 * is worse than a slightly loose rule. Both indirect routes require sealed-
 * product wording as well, so a Pikachu keychain does not land in the card
 * section on the strength of its name. */
const POKE_NAME = /pok[eé]mon|pocket monster/i;
const POKE_CHAR = /\b(eevee|pikachu|charizard|umbreon|espeon|sylveon|glaceon|leafeon|vaporeon|jolteon|flareon|mewtwo|gengar|lucario|gardevoir|gallade|greninja|snorlax|rayquaza|arceus|giratina|dialga|palkia|reshiram|zekrom|morpeko|terastal|eeveelution|v-?union|gem series|mega (?:brave|symphonia))\b/i;
const SET_CODE = /\b(?:sv|csv|cs|s|m)\d+[a-z]?\b/i;
const SEALED = /\b(boosters?|box|boxes|packs?|tins?|decks?|cards?|tcg|cases?)\b/i;

const SECTIONS = [
  {
    key: "pokemon", label: "Pokémon — Sealed",
    test: (t) => POKE_NAME.test(t)
      || (POKE_CHAR.test(t) && SEALED.test(t))
      || (SET_CODE.test(t) && SEALED.test(t)),
  },
  // Brand names carry this section, not the word "toy" — a shelf of Sonny
  // Angel, Smiski and Labubu cases lists itself by series name and never says
  // "figure" once. The generic nouns stay as a backstop for new lines.
  { key: "toys", label: "Collectible Figures & Blind Boxes", test: (t) => /\b(sonny angel|smiski|pop ?mart|labubu|molly|skullpanda|crybaby|dimoo|hirono|funism|blokees|monchhichi|monchichi|hippers|chiikawa|hello kitty|sanrio|sylvanian|bearbrick|be@rbrick|nendoroid|funko|gundam|transformers)\b|\b(figures?|figurines?|plush|dolls?|toy|model kit|blind ?box(es)?|key ?chains?|straps?)\b|\(\s*\d+\s*(per set|pcs?)\b/i.test(t) },
  // Sits ahead of the card rule on purpose: "Blind Box" contains "box", and
  // a Labubu case is not a booster box.
  { key: "cards", label: "Trading Cards — Other", test: (t) => SEALED.test(t) || /\b(yu-?gi-?oh|magic the gathering|mtg|one piece|dragon ball|weiss)\b/i.test(t) },
  { key: "other", label: "Other Products", test: () => true },
];

const bucketed = new Map(SECTIONS.map((s) => [s.key, []]));
for (const r of rows) {
  const t = String(r.title || "");
  bucketed.get(SECTIONS.find((s) => s.test(t)).key).push(r);
}

/* ── Shipping ──────────────────────────────────────────────────────────────
 * Sea is free and that is the whole pitch, so it is a constant. Air is not
 * invented: without per-item weights and the freight band table, any number
 * here would be a guess printed next to a real price. If a rate file is
 * supplied it is used; otherwise the column says how the quote is obtained.
 *
 * Rate file shape (all optional):
 *   { "note": "...", "default": "$12.00",
 *     "byTitle": { "<exact product title>": "$18.40" } }                    */
const AIR_NOTE = process.env.AIR_NOTE || "Quoted at checkout";
let airRates = {};
if (process.env.AIR_RATES && fs.existsSync(process.env.AIR_RATES)) {
  airRates = JSON.parse(fs.readFileSync(process.env.AIR_RATES, "utf8"));
}
function resolveAir(row) {
  const byTitle = airRates.byTitle || {};
  return byTitle[row.title] || airRates.default || airRates.note || AIR_NOTE;
}

const host = (() => { try { return new URL(data.store).host.replace(/^www\./, ""); } catch { return data.store || ""; } })();
const BRAND = process.env.SHEET_BRAND || host;
const TITLE = process.env.SHEET_TITLE || "Wholesale Price Sheet";
const CONTACT = process.env.SHEET_CONTACT || "";
const TODAY = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Chromium prints from file:// — every image path has to resolve against the
 *  dump directory, and a missing shot must not leave a broken-image glyph in a
 *  document that goes to a buyer. */
function cell(row) {
  const img = row.image && fs.existsSync(path.join(dumpDir, row.image))
    ? `<img src="${esc(row.image)}" alt="">`
    : `<div class="noimg">No photo</div>`;
  const price = row.price ? esc(row.price) : `<span class="tbd">Enquire</span>`;
  return `<tr>
  <td class="ph">${img}</td>
  <td class="ti">${esc(row.title)}</td>
  <td class="pr">${price}</td>
  <td class="air">${esc(resolveAir(row))}</td>
  <td class="sea"><span class="free">FREE</span></td>
</tr>`;
}

const sectionsHtml = SECTIONS.filter((s) => bucketed.get(s.key).length).map((s) => {
  const items = bucketed.get(s.key);
  return `<section class="sec">
  <h2>${esc(s.label)} <span class="n">${items.length} item${items.length === 1 ? "" : "s"}</span></h2>
  <table>
    <thead><tr>
      <th class="ph">Photo</th><th class="ti">Product</th><th class="pr">Price</th>
      <th class="air">Air Shipping</th><th class="sea">Sea Shipping</th>
    </tr></thead>
    <tbody>${items.map(cell).join("\n")}</tbody>
  </table>
</section>`;
}).join("\n");

const withPrices = rows.filter((r) => r.price).length;

const html = `<!doctype html>
<meta charset="utf-8">
<title>${esc(BRAND)} — ${esc(TITLE)}</title>
<style>
  @page { size: letter; margin: 14mm 12mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 10pt/1.35 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #14161a; }

  /* Cover: one page, then everything else starts fresh. */
  .cover { height: 232mm; display: flex; flex-direction: column; justify-content: center;
           page-break-after: always; }
  .cover .brand { font-size: 30pt; font-weight: 800; letter-spacing: -.02em; }
  .cover h1 { font-size: 17pt; font-weight: 600; margin: 6mm 0 0; color: #3a4048; }
  .cover .rule { height: 3px; width: 46mm; background: #14161a; margin: 8mm 0; }
  .cover dl { display: grid; grid-template-columns: 34mm 1fr; gap: 2.6mm 6mm; margin: 0; font-size: 10.5pt; }
  .cover dt { color: #6b7280; }
  .cover dd { margin: 0; font-weight: 600; }
  .seapitch { margin-top: 12mm; padding: 6mm 7mm; border: 2px solid #14161a; border-radius: 3mm; }
  .seapitch b { font-size: 13pt; }
  .seapitch p { margin: 2mm 0 0; color: #3a4048; font-size: 9.5pt; }

  .sec { page-break-before: always; }
  .sec:first-of-type { page-break-before: avoid; }
  h2 { font-size: 13pt; margin: 0 0 3mm; border-bottom: 2px solid #14161a; padding-bottom: 2mm; }
  h2 .n { float: right; font-size: 9pt; font-weight: 500; color: #6b7280; padding-top: 2.2mm; }

  table { width: 100%; border-collapse: collapse; }
  /* Repeat the header on every page — a 40-page table with one header at the
     top is unreadable the moment a buyer prints it. */
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .07em; color: #6b7280;
       text-align: left; padding: 2mm 2mm; border-bottom: 1px solid #d4d8de; }
  td { padding: 2.2mm 2mm; border-bottom: 1px solid #eceef1; vertical-align: middle; }

  th.ph, td.ph { width: 24mm; }
  td.ph img { width: 21mm; height: 21mm; object-fit: contain; display: block; }
  .noimg { width: 21mm; height: 21mm; border: 1px dashed #d4d8de; border-radius: 1.5mm;
           font-size: 6.5pt; color: #9aa1ab; display: flex; align-items: center; justify-content: center; }
  td.ti { font-weight: 600; font-size: 9pt; }
  th.pr, td.pr, th.air, td.air, th.sea, td.sea { text-align: right; white-space: nowrap; }
  th.pr, td.pr { width: 22mm; }
  td.pr { font-weight: 700; font-size: 10.5pt; }
  th.air, td.air { width: 30mm; color: #3a4048; font-size: 8.5pt; }
  th.sea, td.sea { width: 26mm; }
  .free { font-weight: 800; letter-spacing: .04em; }
  .tbd { color: #9aa1ab; font-weight: 500; font-size: 9pt; }
</style>

<div class="cover">
  <div class="brand">${esc(BRAND)}</div>
  <h1>${esc(TITLE)}</h1>
  <div class="rule"></div>
  <dl>
    <dt>Issued</dt><dd>${esc(TODAY)}</dd>
    <dt>Products listed</dt><dd>${rows.length}</dd>
    ${CONTACT ? `<dt>Contact</dt><dd>${esc(CONTACT)}</dd>` : ""}
    <dt>Store</dt><dd>${esc(host)}</dd>
  </dl>
  <div class="seapitch">
    <b>Sea freight ships FREE on every item in this sheet.</b>
    <p>Air shipping is available on request and is quoted per order by weight and destination.
       Prices are listed in the store's own currency and are subject to change; this sheet
       reflects listings as of the issue date above.</p>
  </div>
</div>

${sectionsHtml}
`;

const htmlPath = path.join(dumpDir, "price-sheet.html");
fs.writeFileSync(htmlPath, html);

/* Chromium ships with the sandbox image for Playwright; the glob keeps this
 * working across image rebuilds that bump the browser revision. */
const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
const chrome = process.env.CHROME_BIN
  || [base, ...(fs.existsSync(base) ? fs.readdirSync(base) : [])]
      .map((d) => (d === base ? path.join(base, "chromium", "chrome-linux", "chrome")
                              : path.join(base, d, "chrome-linux", "chrome")))
      .find((p) => fs.existsSync(p));
if (!chrome) { console.error("no Chromium found under " + base); process.exit(1); }

execFileSync(chrome, [
  "--headless", "--no-sandbox", "--disable-gpu",
  "--no-pdf-header-footer",
  `--print-to-pdf=${outPdf}`,
  `file://${htmlPath}`,
], { stdio: ["ignore", "ignore", "pipe"] });

const kb = Math.round(fs.statSync(outPdf).size / 1024);
console.log(`${outPdf} — ${rows.length} products (${withPrices} priced), ${kb} KB`);
for (const s of SECTIONS) {
  const n = bucketed.get(s.key).length;
  if (n) console.log(`  ${s.label}: ${n}`);
}
