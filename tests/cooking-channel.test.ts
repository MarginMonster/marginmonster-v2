/* A COOKING CHANNEL — the owner, 2026-11-24: "Need cooking channel also".
 *
 * A faceless channel already posts on its own on any topic in one of a few formats; a cooking channel is one
 * whose format is a RECIPE: the dish, what you need, every step in order with its amounts and minutes, the
 * plate at the end — every picture a real food photograph. Picking a cooking topic picks that format, so a
 * cooking channel is two taps.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("the Recipe format: one dish, what you need, each step in order with amounts and minutes, the plate — food photographs", () => {
  const src = read("app", "lib", "faceless-video.server.ts");
  const m = /\n  recipe: "([^"]+)",\n/.exec(src);
  assert.ok(m, "FACELESS_FORMATS.recipe");
  const r = m![1];
  for (const part of ["one dish", "beat 1 names the dish", "how long it takes", "ONE beat of what you need", "each step as its own beat, in the order you do it", "exact amounts, the heat and the minutes", "the finished dish on the plate", "real food photograph", "never any writing in the picture"]) assert.ok(r.includes(part), part);
  // the writer is handed the format the same way as every other one
  assert.ok(src.includes("Style: ${FACELESS_FORMATS[fmtKey]}."));
});

test("the channel form offers it, and a cooking topic picks it", () => {
  const ui = read("app", "routes", "web.channels.tsx");
  assert.ok(ui.includes('["listicle", "Listicle"], ["recipe", "Recipe"]];'));
  assert.ok(ui.includes('const COOKING_NICHES = ["Easy weeknight dinners", "Late-night snacks"];'));
  for (const n of ["Easy weeknight dinners", "Late-night snacks"]) assert.ok(/const NICHES = \[[^\]]*\]/.exec(ui)![0].includes(`"${n}"`), n);
  assert.ok(ui.includes('onClick={() => { setNiche(n); if (COOKING_NICHES.includes(n)) setFormat("recipe"); }}>'));
  // and in every language the app speaks
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const w of ["Recipe", "Easy weeknight dinners", "Late-night snacks"]) assert.equal(dict.split(`"${w}":`).length - 1, 5, w);
});
