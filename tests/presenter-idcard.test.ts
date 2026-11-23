/* THE CAST'S ID CARD (2026-11-22).
 *
 * The owner, on the Presenters section: "bonus points if we incorporate a potential (on hover or avatar
 * inspection ID card with each with descriptions along with the 3D animation)". So every member of the
 * cast — a person, a cartoon character, a creature alike — has an ID card (app/components/CastIdCard.tsx):
 *
 *   1. ON INSPECTION, on every device: in the character view the loose lines that gave the name, the
 *      green line under it, the facts and the description are one card beside (on a phone: under) the
 *      turning figure — a strip in the colour of their kind, a stamped code made from their id, the name
 *      large, the facts under labels. The rename pencil, the favourite star and the error line are where
 *      they were.
 *   2. ON HOVER / TAB, where there is a mouse: resting on a cast card in the grid brings the same card
 *      up beside it, small, with their figure TURNING on it. It never takes part in the click.
 *
 * And three small controls of the character view that the 44px floor had missed.
 *
 * What is pinned here was looked at first, in headless Chrome, on the real component with a made-up
 * cast (drawn mannequins under a TEST banner), driven with real mouse, key and touch input:
 *   - 1200 wide: a sweep across twelve cast cards (150 ms at most on any one) showed no card and mounted
 *     no figure; resting on one showed nothing at 140 ms and one card at 470 ms — beside it, inside the
 *     window, with one figure, turning; in the last column it came up on the other side; Escape, a scroll
 *     and leaving each took it down; a click opened the character exactly as before, with ONE figure on
 *     the page; the Tab key brought up the card of the cast card that took the focus, and focus handed
 *     back by the closing view did not; "less motion" gave no entrance animation and a figure standing still.
 *   - 390 wide, touch: "(hover:hover) and (pointer:fine)" is false, a tap opened the character and nothing
 *     floated on the way; the card was 358px of the 390, no sideways scroll (nor at 320), smallest text
 *     11px; to the thumb the pencil 44x44 (drawn 30), the star 44x44 (drawn 34; it measured 42), the
 *     "3D view for all" pill 44 high (drawn 24), Add 3D view / Delete / Keep / Cancel 44 high.
 *   - 1000 wide (mouse): those controls measured what they did before — 30, 24, 26. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const num = (s: string, re: RegExp) => { const m = s.match(re); assert.ok(m, String(re)); return Number(m![1]); };
const page = read("app", "routes", "web.presenters.tsx");
const card = read("app", "components", "CastIdCard.tsx");

/* THE REAL COMPONENT, RUN. It is a .tsx, which node will not import as it stands, so the file is compiled
 * here exactly as it is and evaluated — with stand-ins only for what it draws with: the icon set, the
 * turning figure, and a translator that puts [brackets] round whatever the CARD ITSELF translates (so a
 * test can tell the card's own labels from the text a page hands it). */
const require = createRequire(import.meta.url);
const React = require("react") as { createElement: (...a: unknown[]) => unknown; Fragment: unknown };
const { renderToStaticMarkup } = require("react-dom/server") as { renderToStaticMarkup: (el: unknown) => string };
type Place = { left: number; top: number; side: string };
type CardModule = {
  castIdCode: (id: string) => string;
  placeCastHover: (anchor: { left: number; top: number; right: number; bottom: number }, card: { w: number; h: number }, view: { w: number; h: number }, prefer?: "right" | "left", gap?: number, edge?: number) => Place;
  CastIdCard: unknown; CastFigure: unknown; CastHoverCard: unknown; useCastHover: unknown;
  CAST_ID_CSS: string; CAST_HOVER_MEDIA: string; CAST_HOVER_DELAY_MS: number;
};
const mod: CardModule = (() => {
  const ts = require("typescript");
  const js: string = ts.transpileModule(card, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const standIns: Record<string, unknown> = {
    "../lib/icons": { Ico: (p: { n: string }) => React.createElement("svg", { "data-ico": p.n }) },
    "../lib/ui-lang": { useT: () => (s: string, params?: Record<string, string | number>) => `[${Object.entries(params || {}).reduce((out, [k, v]) => out.split(`{${k}}`).join(String(v)), s)}]` },
    "./SpinStage": { SpinStage: (p: { spin: { base: string }; name: string }) => React.createElement("i", { "data-turning": p.spin.base, "data-name": p.name }) },
  };
  const m = { exports: {} as Record<string, unknown> };
  new Function("exports", "require", "module", js)(m.exports, (spec: string) => (spec in standIns ? standIns[spec] : require(spec)), m);
  return m.exports as unknown as CardModule;
})();
const html = (props: Record<string, unknown>, ...children: unknown[]) => renderToStaticMarkup(React.createElement(mod.CastIdCard, props, ...children));
const facts = (h: string) => [...h.matchAll(/<div class="pc-id-fact"><dt><svg data-ico="([a-z]+)"><\/svg> ([^<]*)<\/dt><dd>(.*?)<\/dd><\/div>/g)].map((m) => `${m[1]} ${m[2]} = ${m[3].replace(/<[^>]+>/g, "").trim()}`);

test("the ID code: the same id always gives the same code, different ids give different ones, and it is never empty", () => {
  const { castIdCode } = mod;
  // stamped "EM-" and four characters
  const SHAPE = /^EM-[2-9BCDFGHJKLMNPQRSTVWXZ]{4}$/;
  for (const id of ["valentina", "pip", "keeper", "cavclz4x9k2p0001abcd", "a", "", " ", "x".repeat(4000), "名前", "ZZZ SAMPLE"]) {
    assert.match(castIdCode(id), SHAPE, JSON.stringify(id));
    assert.equal(castIdCode(id), castIdCode(id), "asked twice, answered the same");
  }
  // NEVER EMPTY — not for an id that is, and not for one that is missing altogether
  assert.equal(castIdCode(""), "EM-FGF6");
  assert.match(castIdCode(undefined as unknown as string), SHAPE);
  assert.match(castIdCode(null as unknown as string), SHAPE);
  // THE SAME TOMORROW: it is made from the id and nothing else (no clock, no dice, nothing of the browser's),
  // so these do not change unless somebody changes how a code is made — which would re-stamp every card
  assert.equal(castIdCode("valentina"), "EM-PV9B");
  assert.equal(castIdCode("pip"), "EM-W2W6");
  assert.equal(castIdCode("keeper"), "EM-BLMG");
  const fn = card.slice(card.indexOf("export function castIdCode"), card.indexOf("export type CastHoverPlace"));
  assert.ok(fn.length > 300 && !/Math\.random|Date\.|performance|navigator|window|crypto/.test(fn));
  // DIFFERENT IDS, DIFFERENT CODES. Ids one character apart — as one shop's own characters are…
  assert.notEqual(castIdCode("cavzztest0001"), castIdCode("cavzztest0002"));
  assert.equal(castIdCode("cavzztest0001"), "EM-NDN6");
  assert.equal(castIdCode("cavzztest0002"), "EM-94RW", "…share nothing, not just a last letter");
  assert.notEqual(castIdCode("a"), castIdCode("b"));
  assert.notEqual(castIdCode("pip"), castIdCode("PIP"));
  assert.notEqual(castIdCode(""), castIdCode(" "));
  // …the cast that stands in the page's own line-up…
  const lineup = (page.match(/const LINEUP = \[([^\]]+)\]/) || ["", ""])[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
  assert.ok(lineup.length >= 10, "the line-up was read");
  assert.equal(new Set(lineup.map(castIdCode)).size, lineup.length, "no two of the line-up share a code");
  // …and five thousand made-up ids: 28 x 28 x 28 x 28 = 614,656 codes, so a handful MUST pair up by chance
  // (about twenty) — more than that would mean the codes bunch
  const many = new Set<string>();
  for (let i = 0; i < 5000; i++) many.add(castIdCode(`cav${(i * 7919 + 13).toString(36)}x${i}`));
  assert.ok(many.size >= 4950, `5000 ids gave ${many.size} codes`);
  // every one of the 28 characters is used, in every one of the four places
  for (let at = 3; at < 7; at++) assert.equal(new Set([...many].map((c) => c[at])).size, 28, `place ${at - 2}`);
  // no vowels, so a code can never spell a word on somebody's card; no 0 or 1, which read as O and I
  assert.ok(card.includes('const CODE_LETTERS = "23456789BCDFGHJKLMNPQRSTVWXZ";'));
  for (const c of many) assert.ok(!/[AEIOUY01]/.test(c.slice(3)), c);
});

test("the floating card goes beside the cast card, flips at an edge, and stays inside the window", () => {
  const { placeCastHover } = mod;
  const view = { w: 1200, h: 900 };
  const size = { w: 348, h: 313 }; // what the floating card measured
  const box = (left: number, top: number, w = 175, h = 288) => ({ left, top, right: left + w, bottom: top + h });
  // room on the right: 12px from the cast card, level with its middle
  assert.deepEqual(placeCastHover(box(227, 538), size, view), { side: "right", left: 414, top: 526 });
  // the last column: no room on the right — the other side (SEEN: 989..1164 of 1200 → the card at 629)
  assert.deepEqual(placeCastHover(box(989, 538), size, view), { side: "left", left: 629, top: 526 });
  // a right-to-left page asks for the left first, and gets the right when the left has no room
  assert.equal(placeCastHover(box(600, 300), size, view, "left").side, "left");
  assert.equal(placeCastHover(box(36, 300), size, view, "left").side, "right");
  // near the top or the bottom of the window it slides along the cast card instead of leaving the window
  assert.equal(placeCastHover(box(227, -120), size, view).top, 8);
  assert.equal(placeCastHover(box(227, 760), size, view).top, 900 - 8 - 313);
  // a window too narrow for either side: underneath — or on top when only that has room
  const narrow = { w: 520, h: 900 };
  assert.deepEqual(placeCastHover(box(172, 100), size, narrow), { side: "below", left: 86, top: 400 });
  assert.deepEqual(placeCastHover(box(172, 560), size, narrow), { side: "above", left: 86, top: 560 - 12 - 313 });
  // …and when nothing has room, still inside the window
  const tiny = { w: 520, h: 420 };
  const squeezed = placeCastHover(box(172, 60), size, tiny);
  assert.ok(squeezed.left >= 8 && squeezed.left + size.w <= tiny.w - 8 && squeezed.top >= 8 && squeezed.top + size.h <= tiny.h - 8);
  // EVERYWHERE a cast card can be in a window the card fits in, the whole of it is inside that window
  for (const v of [view, { w: 1440, h: 900 }, { w: 800, h: 700 }, narrow, { w: 760, h: 420 }]) {
    for (let x = -100; x <= v.w; x += 37) {
      for (let y = -300; y <= v.h; y += 53) {
        for (const prefer of ["right", "left"] as const) {
          const p = placeCastHover(box(x, y), size, v, prefer);
          assert.ok(p.left >= 8 && p.left + size.w <= v.w - 8 && p.top >= 8 && p.top + size.h <= v.h - 8, `${JSON.stringify(v)} ${x},${y} → ${JSON.stringify(p)}`);
          // beside it means beside it: never on top of the cast card it describes, while there is room not to be
          if (p.side === "right") assert.ok(p.left >= x + 175 + 12);
          if (p.side === "left") assert.ok(p.left + size.w <= x - 12);
        }
      }
    }
  }
  // the page gives it real measurements: the cast card's box, its own size, the window's — and which way the page reads
  const hover = card.slice(card.indexOf("export function CastHoverCard"), card.indexOf("export const CAST_ID_CSS"));
  assert.ok(hover.includes("anchor.getBoundingClientRect(),"));
  assert.ok(hover.includes("{ w: el.offsetWidth, h: el.offsetHeight },"));
  assert.ok(hover.includes("{ w: document.documentElement.clientWidth, h: window.innerHeight },"));
  assert.ok(hover.includes('getComputedStyle(anchor).direction === "rtl" ? "left" : "right",'));
  // measured before it is painted, and not shown until it has been placed
  assert.ok(hover.includes("useLayoutEffect(() => {") && hover.includes('{ visibility: "hidden" }'));
});

test("the card: the name large, who they are, the facts under labels, the description — for every kind of cast member", () => {
  const person = html({
    id: "valentina", name: "Test Person", kind: "person", role: "Fake fashion host", age: "Mid 20s", energy: "Upbeat", voice: "Signature",
    outfits: 4, has3d: true, about: "A made-up person.",
    actions: React.createElement("button", { className: "pc-star" }, "star"),
  }, React.createElement("p", { className: "after" }, "after"));
  // a full card of the right kind, with its stamp — which a screen reader skips for the name
  assert.ok(person.startsWith('<div class="pc-id full k-person"><div class="pc-id-top" aria-hidden="true"><span>[Cast ID]</span><span class="pc-id-code" dir="ltr">EM-PV9B</span></div>'));
  // THE NAME, large, a heading — with what the page hangs on it (the pencil, the star) on the same line
  assert.ok(person.includes('<h2 class="pc-id-name">Test Person<button class="pc-star">star</button></h2>'));
  assert.ok(person.includes('<p class="pc-id-role">Fake fashion host</p>'));
  // THE FACTS, in this order. The labels are the card's own (it translates them: the brackets); what a
  // page hands it is shown as handed (already in the viewer's language)
  assert.deepEqual(facts(person), [
    "presenter [Kind] = [Presenter]",
    "hourglass [Age] = Mid 20s",
    "bolt [Energy] = Upbeat",
    "shirt [Outfits] = 4 [3D view]",
    "mic [Voice] = Signature",
  ]);
  assert.ok(person.includes('<dd>4<span class="pc-id-3d" title="[3D view]"><svg data-ico="sphere"></svg> [3D view]</span></dd>'), "the 3D view sits with the outfits it belongs to");
  assert.ok(person.includes('<p class="pc-id-about">A made-up person.</p><p class="after">after</p></div>'));

  // A CREATURE with no stated age and nothing written about it: the same card, less on it
  const creature = html({ id: "keeper", name: "Test Creature", kind: "monster", role: "Fake thing in the cellar", age: "", energy: "Calm", voice: "Hollow", outfits: 1, has3d: false, about: "" });
  assert.ok(creature.startsWith('<div class="pc-id full k-monster">'));
  assert.deepEqual(facts(creature), ["moon [Kind] = [Creature]", "bolt [Energy] = Calm", "shirt [Outfits] = 1", "mic [Voice] = Hollow"]);
  assert.ok(!creature.includes("pc-id-about") && !creature.includes("pc-id-3d") && !creature.includes("[Age]"));
  // A CARTOON CHARACTER
  const cartoon = html({ id: "pip", name: "Test Cartoon", kind: "cartoon", energy: "Upbeat", voice: "Bouncy", outfits: 1, has3d: true });
  assert.ok(cartoon.startsWith('<div class="pc-id full k-cartoon">'));
  assert.equal(facts(cartoon)[0], "felt [Kind] = [Cartoon]");
  assert.ok(!cartoon.includes("pc-id-role"), "no line under the name when there is nothing to say");
  // a kind nobody has thought of yet is still somebody: a presenter, never a crash or an empty label
  assert.equal(facts(html({ id: "x", name: "X", kind: "robot" }))[0], "presenter [Kind] = [Presenter]");
  // a fact with nothing to say is left off — never a label over a blank
  assert.deepEqual(facts(html({ id: "x", name: "X", kind: "person" })), ["presenter [Kind] = [Presenter]"]);
  assert.deepEqual(facts(html({ id: "x", name: "X", kind: "person", outfits: 0, has3d: true })), ["presenter [Kind] = [Presenter]", "shirt [Outfits] = [3D view]"]);
  // the star of the brand: a gold strip
  assert.ok(html({ id: "x", name: "X", kind: "person", lead: true }).startsWith('<div class="pc-id full k-person lead">'));
  // RENAMING: the form takes the name's place — the rest of the card stays
  const renaming = html({ id: "x", name: "X", kind: "person", role: "Your character", nameSlot: React.createElement("form", { className: "pc-rename" }), actions: React.createElement("button", null, "star") });
  assert.ok(renaming.includes('<div class="pc-id-main"><form class="pc-rename"></form><p class="pc-id-role">Your character</p>'));
  assert.ok(!renaming.includes("pc-id-name") && !renaming.includes("star"));

  // THE SMALL ONE that floats: the same card — the same facts — with their figure standing on it
  const figure = React.createElement(mod.CastFigure, { spin: { base: "/kits/zz/", q: "", n: 60, w: 334, h: 900, dir: 1 }, img: "/zz.jpg", name: "Test Person" });
  const mini = html({ id: "valentina", name: "Test Person", kind: "person", role: "Fake fashion host", age: "Mid 20s", energy: "Upbeat", voice: "Signature", outfits: 4, has3d: true, about: "A made-up person.", size: "mini", figure });
  assert.ok(mini.startsWith('<div class="pc-id mini k-person">'));
  assert.deepEqual(facts(mini).map((f) => f.replace("[3D]", "[3D view]")), facts(person));
  assert.ok(mini.includes("4<span class=\"pc-id-3d\" title=\"[3D view]\"><svg data-ico=\"sphere\"></svg> [3D]</span>"), "where the figure itself is turning, the chip is short");
  assert.ok(mini.includes('<div class="pc-id-name">Test Person</div>') && !mini.includes("<h2"), "not a second heading for the page");
  // …their figure TURNING, when they have a 3D view (and how wide it is for its height, so a wide one fits its frame)
  assert.ok(mini.includes(`<div class="pc-id-body"><div class="pc-id-fig" style="--pc-id-ar:${String(334 / 900)}"><i data-turning="/kits/zz/" data-name="Test Person"></i></div><div class="pc-id-main">`));
  // …and their picture when they do not
  const still = renderToStaticMarkup(React.createElement(mod.CastFigure, { spin: null, img: "/zz.jpg", name: "Test Person" }));
  assert.equal(still, '<div class="pc-id-fig"><img class="pc-id-pic" src="/zz.jpg" alt="" draggable="false"/></div>');

  // every word the card puts on the screen itself goes through the translator
  const body = card.slice(card.indexOf("export function CastIdCard"), card.indexOf("export function CastFigure"));
  for (const s of ["Cast ID", "Kind", "Age", "Energy", "Outfits", "Voice", "Presenter", "Cartoon", "Creature", "3D view", "3D"]) assert.ok(body.includes(`t("${s}")`), s);
  assert.equal(count(body, 't("'), 12, "those eleven, and nothing else ('3D view' twice: the chip and its tooltip)");
});

test("the card is shared: it knows nothing of a route, and it carries its own stylesheet", () => {
  // what it is built from — React, the icon set, the translator, the turning figure. No route, no Remix,
  // no loader's type: the Movie Maker's cast pickers can use it as it is.
  const imports = [...card.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["react", "react", "react-dom", "../lib/icons", "../lib/ui-lang", "../lib/presenter-kits", "./SpinStage"]);
  assert.ok(card.includes('import type { Spin } from "../lib/presenter-kits";'), "of the kits, only a type");
  assert.ok(!/routes\/|@remix-run|\.server|useLoaderData|Member\b/.test(card));
  for (const made of ["export function castIdCode(", "export function placeCastHover(", "export function CastIdCard(", "export function CastFigure(", "export function useCastHover(", "export function CastHoverCard(", "export const CAST_ID_CSS = `"]) assert.ok(card.includes(made), made);
  // the kinds are spelt out, and they are the cast's own three
  assert.ok(card.includes('export type CastKind = "person" | "cartoon" | "monster";'));
  assert.ok(read("app", "lib", "avatars.ts").includes('export type CharacterKind = "person" | "cartoon" | "monster";'));

  const css = mod.CAST_ID_CSS;
  // every class it styles is its own (.pc-id…), or the turning figure's inside its own frame
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const classes = new Set([...rules.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]).filter((c) => /^(pc|ph|spin|wb|ws|mini|full|lead|k-)/.test(c)));
  assert.ok(classes.size >= 15);
  for (const c of classes) assert.ok(/^pc-id(-|$)/.test(c) || /^spin(-|$)/.test(c) || /^(mini|full|lead|k-cartoon|k-monster)$/.test(c), c);
  // …and its size / kind marks are only ever read ON the card (.pc-id.mini, never a bare .mini)
  assert.ok(!/(?<!\.pc-id)\.(mini|full|lead|k-[a-z]+)\b/.test(rules));
  assert.equal(count(css, ".spin"), count(css, ".pc-id-fig .spin"), "the figure's own rules are touched only inside the card's frame");
  // the page's colours, by its variables; no second font family
  for (const v of ["var(--green,#0C7A46)", "var(--ink,#14201A)", "var(--ink2,#4A554E)", "var(--line,#E1DECD)", "var(--paper,#F4F1E6)"]) assert.ok(css.includes(v), v);
  assert.deepEqual([...new Set([...css.matchAll(/font-family:([^;}]+)/g)].map((m) => m[1]))].sort(), ["Inter,-apple-system,sans-serif", "Poppins,sans-serif"]);
  // NO TEXT UNDER 11px, on any size of the card
  const sizes = [...css.matchAll(/font-size:([\d.]+)px/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length >= 12 && Math.min(...sizes) >= 11, `smallest ${Math.min(...sizes)}`);
  // THE STRIP: thin, along the top, in the colour of their kind — the colours the cast cards' kind badges have
  assert.ok(css.includes('.pc-id::before{content:"";display:block;height:5px;background:var(--pc-id-accent);}'));
  assert.ok(css.includes(".pc-id{--pc-id-accent:var(--green,#0C7A46);"));
  assert.ok(css.includes(".pc-id.k-cartoon{--pc-id-accent:#FFD45C;}") && page.includes(".ph-kind.cartoon{background:#FFD45C;"));
  assert.ok(css.includes(".pc-id.k-monster{--pc-id-accent:#2B2140;}") && page.includes(".ph-kind.monster{background:#2B2140;"));
  assert.ok(css.includes(".pc-id.lead{--pc-id-accent:#D3A63A;}") && page.includes(".ph-face.bf{border-color:#D3A63A;"));
  // PHONE FIRST: two facts across; three only when the CARD is wide (its own width, not the window's — the
  // column it stands in is 358px on a phone, 368 at 800 wide, 465 at 1000, 524 from 1180)
  assert.ok(css.includes(".pc-id{--pc-id-accent:var(--green,#0C7A46);container-type:inline-size;"));
  assert.ok(css.includes(".pc-id-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));"));
  const roomy = css.slice(css.indexOf("@container (min-width:440px){"), css.indexOf("/* who stands on the card"));
  assert.ok(roomy.includes(".pc-id-facts{grid-template-columns:repeat(3,minmax(0,1fr));"));
  // …and nothing in it can push the page sideways: the columns may shrink, long words break
  assert.ok(css.includes(".pc-id-main{flex:1 1 auto;min-width:0;}") && css.includes(".pc-id-fact{min-width:0;}"));
  assert.ok(/\.pc-id-name\{[^}]*overflow-wrap:anywhere;/.test(css) && /\.pc-id-fact dd\{[^}]*overflow-wrap:anywhere;/.test(css));
  // the figure stands on the SAME studio wall every presenter stands on
  const wall = (s: string, re: RegExp) => { const m = s.match(re); assert.ok(m, String(re)); return m![1]; };
  assert.equal(wall(css, /\.pc-id-fig\{[^}]*background:(radial-gradient\([^;]+\));\}/), wall(page, /\n\.ph-bd\{background:(radial-gradient\([^;]+\));\}/));
  // a figure nearly as wide as it is tall (a cartoon pup: 820 x 900) is never wider than its frame
  assert.ok(css.includes("@supports (height:1cqh){.pc-id-fig .spin-fig{height:min(84cqh,calc(90cqw / var(--pc-id-ar,.4)));}}"));
  assert.ok(css.includes(".pc-id-fig .spin-tip{display:none;}"), "\"Drag to turn\" is not offered on a card that cannot be touched");
  // the Presenters page ships it, beside the turning figure's own stylesheet
  assert.ok(page.includes("${SPIN_STAGE_CSS}\n${CAST_ID_CSS}\n"));
  assert.ok(page.includes('import { CastIdCard, CastFigure, CastHoverCard, useCastHover, CAST_ID_CSS, idCardOf, castVoiceWord, castAgeText, castSentence } from "../components/CastIdCard";'));
});

test("on inspection: the character view shows the card, and everything the old lines did is still there", () => {
  const view = page.slice(page.indexOf("function CharacterView("), page.indexOf("const PH_STYLE = `"));
  // ONE card per character view, fed by the same facts as the one that floats
  assert.equal(count(view, "<CastIdCard"), 1);
  assert.ok(view.includes("          <CastIdCard\n            {...cardOf(c, t)}\n            lead={isBrandFace}\n"));
  // it stands where the loose lines stood: under the badge, above the error line, the Outfits and the Voice
  const order = ['<span className={`pc-badge', "<CastIdCard", '{fetcher.data?.error ? <p className="pc-err" role="alert">{fetcher.data.error}</p> : null}\n\n          {/* Outfits */}', "{/* Voice */}", '{danger("in")}'].map((s) => view.indexOf(s));
  assert.ok(order.every((at) => at > 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  // THE FACTS' MEANING — who they are, energy, the age when it is known, how many outfits, whether one turns.
  // (2026-11-22: the mapping moved into the card's own module, so the Movie Maker's pickers use the SAME
  //  one — tests/film-cast-idcard.test.ts. The page only counts a member's outfits from their looks.)
  const of = card.slice(card.indexOf("export const idCardOf = (c: CastCardSource, t: Tr) => ({"), card.indexOf("const DECADE"));
  assert.ok(of.includes("id: c.id, name: c.name, kind: c.kind,"), "whoever they are: their kind goes through as it is");
  assert.ok(of.includes("role: c.custom ? t(c.vibe) : c.vibe,"), "the line under the name, as it read before");
  assert.ok(of.includes("age: c.age, energy: t(CAST_ENERGY[c.energy] || CAST_ENERGY.warm), voice: castVoiceWord(c, t),"));
  assert.ok(of.includes("outfits: c.outfits, has3d: c.has3d,"));
  assert.ok(of.includes("about: c.about,"));
  assert.ok(page.includes("const cardOf = (c: Member, t: T) => idCardOf({ ...c, outfits: c.looks.length, has3d: c.looks.some((l) => !!l.spin) }, t);"));
  // the energy is under a label now, so it is the Refine chips' own word for it
  assert.ok(card.includes('export const CAST_ENERGY = { hype: "Upbeat", warm: "Warm", calm: "Calm" } as const;'));
  assert.ok(page.includes('["energy", "hype", "Upbeat"], ["energy", "warm", "Warm"], ["energy", "calm", "Calm"],'));
  // THE VOICE'S NAME: the one the cast card in the grid gives — one function for both
  assert.ok(card.includes('(c.voiceOwn ? c.voice : c.voice ? t(c.voice) : c.signature ? t("Signature") : t("Automatic"));'));
  assert.ok(page.includes("const voiceWord = (c: Member, t: T): string => castVoiceWord(c, t);"));
  assert.ok(page.includes('<Ico n="mic" size={10} /> {voiceWord(c, t)}</span>'));
  // …and the Voice section under the card still says it its own, longer way
  assert.ok(view.includes('const voiceName = c.voiceOwn ? c.voice : c.voice ? t(c.voice) : c.signature ? t("Signature voice") : t("Automatic");'));

  // THE RENAME PENCIL (your own characters only) and THE FAVOURITE STAR ride on the card's name
  const acts = view.slice(view.indexOf("            actions={<>"), view.indexOf("            </>}\n          />"));
  assert.ok(acts.includes('{c.custom && <button type="button" className="pc-pencil" onClick={() => setRenaming(true)} aria-label={t("Rename {name}", { name: c.name })}><Ico n="pencil" size={14} /></button>}'));
  assert.ok(acts.includes('<button type="button" className={`pc-star${fav ? " on" : ""}`} onClick={onFav} aria-pressed={fav}'));
  assert.ok(acts.includes('aria-label={fav ? t("Remove {name} from favourites", { name: c.name }) : t("Add {name} to favourites", { name: c.name })}'));
  assert.ok(acts.includes('<span aria-hidden="true">{fav ? "★" : "☆"}</span>'));
  // THE RENAME FORM takes the name's place, on the card
  const slot = view.slice(view.indexOf("            nameSlot={renaming ? ("), view.indexOf("            actions={<>"));
  assert.ok(slot.includes('<form className="pc-rename" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) post({ intent: "rename", name: newName.trim() }); }}>'));
  assert.ok(slot.includes('<input className="wb-in" value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} aria-label={t("Presenter name")} autoFocus />'));
  assert.ok(slot.includes('<button type="button" className="pc-textbtn" onClick={() => { setRenaming(false); setNewName(c.name); }}>{t("Cancel")}</button>'));
  assert.ok(slot.trimEnd().endsWith(") : undefined}"));
  // the lines the card replaced are gone — from the page and from its stylesheet
  for (const gone of ['className="pc-name"', 'className="pc-vibe"', 'className="pc-facts"', 'className="pc-about"', ".pc-name{", ".pc-vibe{", ".pc-facts{", ".pc-facts span{", ".pc-about{"]) assert.ok(!page.includes(gone), gone);
  // the card hangs under the badge; the Outfits and Voice sections' own rules are as they were
  assert.ok(page.includes(".pc-scroll>.pc-id{margin-top:10px;}"));
  assert.ok(page.includes(".pc-sec{margin-top:18px;padding-top:16px;border-top:1px solid var(--line,#E1DECD);}"));
  assert.ok(page.includes(".pc-looks{display:flex;gap:9px;flex-wrap:wrap;}"));
  assert.ok(page.includes(".pc-voice-row{display:flex;align-items:center;gap:11px;padding:10px 12px;}"));
  // a wide desktop's bigger type is the page's call, on the card's own classes
  const wide = page.slice(page.indexOf("@media(min-width:1180px) and (min-height:600px){"));
  assert.ok(wide.includes(".pc-scroll .pc-id-name{font-size:38px;}") && wide.includes(".pc-scroll .pc-id-role{font-size:15.5px;margin-top:5px;}") && wide.includes(".pc-scroll .pc-id-about{font-size:14.5px;}"));
});

test("on hover: one card at a time, after a moment, only where there is a mouse — and never in the click's way", () => {
  const hub = page.slice(page.indexOf("export default function PresenterHub()"), page.indexOf("type T = ReturnType<typeof useT>;"));
  const hook = card.slice(card.indexOf("export function useCastHover("), card.indexOf("/** The floating ID card:"));
  const floating = card.slice(card.indexOf("export function CastHoverCard("), card.indexOf("export const CAST_ID_CSS"));
  const css = mod.CAST_ID_CSS;

  // WHERE IT MOUNTS: once, on the page — not inside a cast card (which clips its contents, lifts on hover,
  // and IS the link) — and from there it portals itself to <body>
  assert.equal(count(page, "<CastHoverCard"), 1);
  assert.ok(hub.includes([
    "      {pointed && hoverAt ? (",
    "        <CastHoverCard key={pointed.id} anchor={hoverAt.anchor}>",
    '          <CastIdCard size="mini" {...cardOf(pointed, t)} lead={pointed.id === d.brandFaceId}',
    "            figure={<CastFigure spin={pointed.looks[0]?.spin} img={pointed.cut || pointed.img} name={pointed.name} />} />",
    "        </CastHoverCard>",
    "      ) : null}",
  ].join("\n")));
  assert.ok(hub.indexOf("<CastHoverCard") > hub.indexOf("        })}\n      </div>\n"), "after the grid has closed");
  assert.ok(floating.includes("document.body,\n  );"));
  assert.ok(page.includes(".ph-face{position:relative;display:flex;flex-direction:column;border-radius:18px;overflow:hidden;"), "why not inside: the cast card clips");
  assert.ok(page.includes(".ph-facewrap:hover{transform:translateY(-4px);}"), "…and lifts");
  // the figure is the first outfit's turn, or the picture the cast card itself shows
  assert.ok(hub.includes("<img src={c.cut || c.img} alt={c.name} loading=\"lazy\" draggable={false} />"));

  // ONE AT A TIME — so one turning figure (sixty frames) at a time: one piece of state, one card rendered,
  // the figure only inside it; and none at all while a character is open (that view has its own figure)
  assert.equal(count(hook, "useState<"), 1);
  assert.ok(hook.includes("const [at, setAt] = useState<HoverAt | null>(null);"));
  assert.ok(hub.includes("const hover = useCastHover(!open && !forgeOpen);"));
  assert.ok(hub.includes("const pointed = hoverAt ? shown.find((c) => c.id === hoverAt.id) || null : null;"), "and only for somebody the grid is showing");
  assert.ok(hook.includes("return { at: enabled ? at : null, bind, hide: drop };"));
  assert.ok(hook.includes("if (!enabled) { drop(); return; }"));
  assert.equal(count(card, "<SpinStage"), 1, "the card's only figure is CastFigure's");
  assert.equal(count(page, "<SpinStage"), 1, "the page's only other one is the character view's stage");
  const grid = hub.slice(hub.indexOf("{shown.map((c) => {"), hub.indexOf("<CastHoverCard"));
  assert.ok(!grid.includes("SpinStage") && !grid.includes("CastFigure") && !grid.includes("CastIdCard"), "nothing is mounted per cast card");

  // AFTER A MOMENT: sweeping the mouse across the grid shows nothing
  assert.equal(mod.CAST_HOVER_DELAY_MS, 250);
  assert.ok(hook.includes("timer.current = setTimeout(() => {") && hook.includes("}, CAST_HOVER_DELAY_MS);"));
  assert.ok(hook.includes("onPointerLeave: () => { if (want.current?.by === \"pointer\") drop(); },"));
  assert.ok(hook.includes("if (timer.current) { clearTimeout(timer.current); timer.current = null; }"));
  // …and when the moment is up it is shown only if the cast card is STILL pointed at (or still holds the focus)
  assert.ok(hook.includes('if (!w.anchor.isConnected || !(w.by === "pointer" ? w.anchor.matches(":hover") : w.anchor.contains(document.activeElement))) {'));

  // ONLY WHERE THERE IS A MOUSE: a device that can hover and point precisely; a touch is never a hover
  assert.equal(mod.CAST_HOVER_MEDIA, "(hover:hover) and (pointer:fine)");
  assert.ok(card.includes('const canHover = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(CAST_HOVER_MEDIA).matches;'));
  assert.ok(hook.includes('if (!enabled || e.pointerType === "touch" || !canHover()) return;'));
  assert.ok(hook.includes("if (!enabled || !canHover() || performance.now() - tabAt.current > 500) return;"));
  assert.ok(css.includes("@media not all and (hover:hover) and (pointer:fine){.pc-id-float{display:none;}}"));
  // on a phone the grid is what it was: the cast card is the same link, and a tap opens the character
  assert.ok(grid.includes('<div key={c.id} className={`ph-facewrap${c.voiceSample ? " can-hear" : ""}`} {...hover.bind(c.id)}>'));
  assert.ok(grid.includes('<Link to={`/web/presenters?who=${encodeURIComponent(c.id)}`} state={{ hub: true }} preventScrollReset className={`ph-face${isBf ? " bf" : ""}`}>'));

  // NEVER IN THE CLICK'S WAY: it listens, it never prevents or stops anything, and a press takes it down
  assert.deepEqual([...hook.matchAll(/\n    (on[A-Za-z]+):/g)].map((m) => m[1]), ["onPointerEnter", "onPointerLeave", "onPointerDown", "onFocus", "onBlur"]);
  assert.ok(!/preventDefault|stopPropagation|onClick|onMouseDown/.test(hook) && !/preventDefault|stopPropagation|onClick/.test(floating));
  assert.ok(hook.includes("onPointerDown: drop,"));
  // …and the card itself can never be what the mouse lands on
  assert.ok(css.includes(".pc-id-float{position:fixed;z-index:10400;left:0;top:0;pointer-events:none;"));
  assert.ok(page.includes(".pc-scrim{font-family:Inter,-apple-system,sans-serif;color:var(--ink,#14201A);position:fixed;inset:0;z-index:10500;"), "under the character view, over the page");

  // IT GOES: on leave, on blur, on Escape, on a press — and when its cast card moves under it (a scroll, a resize)
  assert.ok(hook.includes('else if (e.key === "Escape") drop();'));
  assert.ok(hook.includes('if (want.current?.by === "focus" && !e.currentTarget.contains(e.relatedTarget as Node | null)) drop();'), "focus stepping between one cast card's own controls is not a blur");
  assert.ok(hook.includes('window.addEventListener("scroll", onMove, { capture: true, passive: true });'));
  assert.ok(hook.includes('window.addEventListener("resize", onMove);'));
  assert.ok(hook.includes('window.removeEventListener("scroll", onMove, true);') && hook.includes('window.removeEventListener("resize", onMove);') && hook.includes('document.removeEventListener("keydown", onKey, true);'));
  // a scroll that moves nothing here (the assistant's chat filling up) is not a reason
  assert.ok(hook.includes("if (r.left === s.left && r.top === s.top) return;"));
  // KEYBOARD: focus that arrived by the Tab key — not focus a closing dialog handed back, nor a click's
  assert.ok(hook.includes('if (e.key === "Tab") tabAt.current = performance.now();'));

  // IT IS AN EXTRA FOR THE EYE, done properly: hidden from assistive tech AND inert — there is a slider
  // inside (the turning figure), and nothing may tab into it. The same card is in the character view.
  assert.ok(floating.includes('<div ref={ref} className="pc-id-float" aria-hidden="true" data-side={place?.side} style={style}>{children}</div>,'));
  assert.ok(floating.includes('el.setAttribute("inert", "");'));
  assert.ok(!/role="tooltip"|aria-describedby/.test(card) && !/aria-describedby/.test(page), "one way, not half of each");
  assert.ok(read("app", "components", "SpinStage.tsx").includes('role="slider" tabIndex={0}'), "why inert");

  // LESS MOTION: no entrance (the figure stands still by itself: SpinStage reads the same setting)
  assert.ok(css.includes("animation:pcidin .18s cubic-bezier(.2,.8,.2,1) both;}"));
  assert.ok(css.includes("@media(prefers-reduced-motion:reduce){.pc-id-float{animation:none;}}"));
  assert.ok(read("app", "components", "SpinStage.tsx").includes('st.auto = !(typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);'));
});

test("on a phone, the pencil, the \"3D view for all\" pill and three text buttons are 44px to the thumb", () => {
  const cssAt = page.indexOf("const PH_STYLE = `");
  const css = page.slice(cssAt);
  const viewAt = css.indexOf("/* ---- the character view ---- */");
  const phoneAt = css.indexOf("@media(max-width:760px){", viewAt);
  const phone = css.slice(phoneAt, css.indexOf("/* a desktop has room for a bigger figure", phoneAt));
  assert.ok(viewAt > 0 && phone.startsWith("@media(max-width:760px){") && phone.trimEnd().endsWith("}"), "the character view's own phone rules");
  // (the site sets box-sizing:border-box on everything, so a size includes its border — and a hit box's
  //  `inset` is counted from INSIDE that border)
  assert.ok(read("app", "routes", "web.tsx").includes("*{box-sizing:border-box}"));

  // THE RENAME PENCIL keeps its 30px look. It is positioned now (the hit box hangs on it), and ::before was free.
  const pencil = css.match(/\n\.pc-pencil\{position:relative;flex:0 0 auto;width:(\d+)px;height:(\d+)px;border-radius:50%;border:(\d+)px solid /);
  assert.ok(pencil, "the pencil's own rule");
  const [pw, ph, pb] = pencil!.slice(1).map(Number);
  const pencilOut = num(phone, /\.pc-pencil::before\{content:"";position:absolute;inset:-(\d+)px;border-radius:50%;\}/);
  assert.ok(pw - 2 * pb + 2 * pencilOut >= 44 && ph - 2 * pb + 2 * pencilOut >= 44, "30 − 2 + 16");
  assert.equal(count(css, ".pc-pencil::"), 1, "its one pseudo-element is the hit box");
  // …beside THE STAR, which is on the same line: 34px drawn, 44 to the thumb (-5px had measured 42)
  const star = css.match(/\n\.pc-star\{position:relative;flex:0 0 auto;display:inline-grid;place-items:center;width:(\d+)px;height:(\d+)px;margin-left:(\d+)px;padding:0;vertical-align:middle;border-radius:50%;border:(\d+)px solid /);
  assert.ok(star, "the star's own rule — and it no longer shrinks when a long name wraps (it was a flex item with no say)");
  const [sw, , sMargin, sb] = star!.slice(1).map(Number);
  const starOut = num(css, /\n\.pc-star::before\{content:"";position:absolute;inset:-(\d+)px;border-radius:50%;\}/);
  assert.ok(sw - 2 * sb + 2 * starOut >= 44);
  // the two hit boxes do not reach each other: the name's gap and the star's margin are wider than both overhangs
  const nameGap = num(mod.CAST_ID_CSS, /\.pc-id-name\{display:flex;align-items:center;gap:(\d+)px;/);
  assert.ok((pencilOut - pb) + (starOut - sb) < nameGap + sMargin, "7 + 5 < 16");

  // THE "3D VIEW FOR ALL" PILL keeps its look: 24px high as drawn (11px type, 4px padding, a 1.5px border).
  const pill = css.match(/\n\.pc-h-act\{margin-left:auto;display:inline-flex;align-items:center;gap:4px;border:([\d.]+)px solid [^;]+;background:#fff;border-radius:999px;padding:(\d+)px 10px;font:inherit;font-size:(\d+)px;/);
  assert.ok(pill, "the pill's own rule");
  const [border] = pill!.slice(1).map(Number);
  assert.ok(phone.includes(".pc-h-act{position:relative;}"), "positioned, on a phone, for the hit box to hang on");
  const reach = phone.match(/\.pc-h-act::before\{content:"";position:absolute;inset:-(\d+)px 0 -(\d+)px;\}/);
  assert.ok(reach, "the pill's hit box");
  const [upBy, downBy] = reach!.slice(1).map(Number);
  const DRAWN = 24; // measured at 390 wide
  assert.ok(DRAWN - 2 * border + upBy + downBy >= 44, "21 + 15 + 8");
  // it reaches UP, into the section's own padding — and stops short of the outfits underneath
  assert.ok(upBy > downBy);
  assert.ok(upBy - border <= num(css, /\n\.pc-sec\{margin-top:18px;padding-top:(\d+)px;/));
  assert.ok(downBy - border < num(css, /\n\.pc-h\{display:flex;align-items:center;gap:6px;margin:0 0 (\d+)px;/), "6.5 < 9");
  assert.equal(count(css, ".pc-h-act::"), 1);

  // THE TEXT BUTTONS: Add 3D view (on the stage), Delete this presenter / Delete, Cancel and Keep
  assert.ok(phone.includes(".pc-buildbtn,.pc-del,.pc-textbtn{min-height:44px;}"));
  assert.ok(phone.includes(".pc-textbtn{min-width:44px;}"), "\"Keep\" is a four-letter word: 39px wide without it");
  // each is a real rule, written ABOVE the phone's (between equals, the later rule wins) — and centres its words
  for (const base of [
    ".pc-buildbtn{border:0;background:var(--green,#0C7A46);",
    ".pc-build,.pc-buildbtn{position:absolute;z-index:3;left:12px;right:12px;bottom:12px;margin-inline:auto;width:fit-content;max-width:calc(100% - 24px);display:flex;align-items:center;",
    ".pc-del{display:inline-flex;align-items:center;",
    ".pc-textbtn{border:0;background:transparent;",
    ".pc-h-act{margin-left:auto;",
    ".pc-pencil{position:relative;",
  ]) {
    const at = css.indexOf(`\n${base}`);
    assert.ok(at > 0 && at < phoneAt, base);
  }
  // …and each is on the page
  for (const used of [
    '<button type="button" className="pc-buildbtn" disabled={busy} onClick={() => post({ intent: "buildSpin", look: String(look) })}>',
    '<button type="button" className="pc-del go" disabled={busy} onClick={() => post({ intent: "delete" })}>',
    '<button type="button" className="pc-del" onClick={() => setArmed(true)}>',
    '<button type="button" className="pc-textbtn" onClick={() => setArmed(false)}>{t("Keep")}</button>',
    '<button type="button" className="pc-textbtn" onClick={() => { setRenaming(false); setNewName(c.name); }}>{t("Cancel")}</button>',
    '<button type="button" className="pc-h-act" disabled={busy} onClick={() => post({ intent: "buildSpin", look: "all" })}>',
    '<button type="button" className="pc-pencil" onClick={() => setRenaming(true)}',
  ]) assert.ok(page.includes(used), used);
  // A DESKTOP IS AS IT WAS: all of it is said once, inside the phone's block
  for (const once of [".pc-pencil::before{", ".pc-h-act::before{", ".pc-h-act{position:relative;}", ".pc-buildbtn,.pc-del,.pc-textbtn{min-height:44px;}", ".pc-textbtn{min-width:44px;}"]) {
    assert.equal(count(css, once), 1, once);
    assert.equal(count(phone, once), 1, once);
  }
});
