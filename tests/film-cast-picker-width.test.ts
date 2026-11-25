/* "PICK A PRESENTER" OPENS AS WIDE AS THE CARD, NOT AS WIDE AS ITS OWN LABEL.
 *
 * Casting an episode as a customer, 2026-11-23: in "Cast your movie" the picker is one more item in a row of
 * small options (Re-cast · Remove · Pick a presenter · Use my own photo). Opened, it stayed as wide as its
 * label — 118px — so 32 presenters came out in ONE 98px column, one and a half faces showing at a time, at a
 * desktop width with a thousand pixels of card beside it. Measured after the fix: 13 across at 1280px, and
 * 3 across on a 390px phone (2 before), where the row now sits under the face.
 *
 * 2026-11-25 — "Cast your movie" is no longer a section of its own. The owner: "It looks like there is two
 * cast selection cards per story (Bottom one comes across as extra)". The same rows, with the same options
 * row, live in the Cast STEP's panel now (tests/film-one-cast.test.ts), and everything pinned here went with
 * them: the pins below also say WHERE the row is — inside the step's panel, and nowhere else. Measured there
 * in a harness built from the route's own JSX: 13 across at 1280px, as before, and 4 across on a 390px phone
 * with no sideways scroll. (Two characters side by side at 1280px were tried and taken out: an opened picker
 * was then only as wide as half the panel — 5 across.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "app", "routes", "web.film.tsx"), "utf8").replace(/\r\n/g, "\n");

test("an opened picker takes the whole options row", () => {
  assert.ok(src.includes(".fs-actor-opts{display:flex;gap:14px;align-items:center;flex-wrap:wrap;}"));
  assert.ok(src.includes(".fs-actor-opts > details[open]{flex:1 1 100%;min-width:0;}"));
  // both pickers are direct children of that row, so both get it
  assert.ok(/<div className="fs-actor-opts">[\s\S]{0,900}<details className="fs-shot-own fs-actor-roster">/.test(src));
  assert.ok(src.includes("<details className=\"fs-shot-own fs-actor-own\">"));
  // (2026-11-25) …and that row is in the Cast STEP's panel — the one place a film is cast — and only there
  const panel = src.slice(src.indexOf('            {storyCard === "cast" && ('), src.indexOf('            {storyCard === "length" && ('));
  assert.ok(panel.length > 2000 && panel.includes('<div className={`mm-opts mm-opts-grid${scripted ? " mm-castpanel" : ""}`} style={{ order: 2 }}>'));
  assert.ok(/<div className="fs-actor-opts">[\s\S]{0,900}<details className="fs-shot-own fs-actor-roster">/.test(panel));
  assert.ok(panel.includes("<details className=\"fs-shot-own fs-actor-own\">"));
  assert.equal(src.split('<div className="fs-actor-opts">').length - 1, 1);
  assert.ok(!src.includes("fs-caststage"));
  // the roster fills whatever width it is given
  assert.ok(src.includes(".fs-roster{display:grid;grid-template-columns:repeat(auto-fill,minmax(66px,1fr));"));
});

test("on a phone the options row sits under the face, the full width of the card", () => {
  const at = src.indexOf(".fs-actor-opts > details[open]{flex:1 1 100%;min-width:0;}");
  const phone = src.slice(at, at + 900);
  assert.ok(phone.includes("@media(max-width:560px){"));
  assert.ok(phone.includes(".fs-actor{display:grid;grid-template-columns:98px minmax(0,1fr);gap:8px 14px;align-items:start;}"));
  assert.ok(phone.includes(".fs-actor-face{grid-row:1 / span 3;}"), "beside the name, the description and the voice");
  assert.ok(phone.includes(".fs-actor-main{display:contents;}"));
  assert.ok(phone.includes(".fs-actor-opts{grid-column:1 / -1;}"));
  // the phone rules come AFTER the desktop ones they change, or they would lose
  assert.ok(at > src.indexOf(".fs-actor-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:8px;}"));
  assert.ok(at > src.indexOf(".fs-actor{display:flex;gap:14px;align-items:flex-start;"));
  // (2026-11-25) inside the Cast step's panel the row is still under the face, the full width of the card — the
  // panel only moves the VOICE under the face too, and those rules come after the ones above, which they adjust
  const inPanel = src.indexOf("  .mm-castpanel .fs-actor-opts{grid-row:4;gap:12px 16px;}");
  assert.ok(inPanel > at, "the panel's phone rules follow the general ones");
  assert.ok(!/\.mm-castpanel \.fs-actor-opts\{[^}]*grid-column/.test(src), "the panel does not narrow the row: it keeps grid-column:1 / -1");
  assert.ok(!/\.mm-castpanel \.fs-actor-opts > details\[open\]/.test(src), "nor the opened picker: it keeps the whole row");
});
