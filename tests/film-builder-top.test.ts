/* THE MOVIE MAKER'S TOP, WIRED TO THE GENRES — the shelves show movie categories, and the writer is never
 * handed nothing.
 *
 * The owner, 2026-11-25:
 *   "Our genres need to be movie categories (drama, horror, comedy, etch)"
 *   "the "write your dialogue" button generates a random scene and dialogue, atleast need a starter "nudge"
 *    couple sentences to hand to the writer"
 *
 * The genres themselves (app/lib/film-genres.ts, the heroes' `card`, the covers) were made and reviewed in their
 * own stream; this file holds how the PAGE (app/routes/web.film.tsx) shows them:
 *   · a poster says its category ("Comedy"), the shelf says how it is told; a screen reader hears the whole name;
 *   · every genre's phone cover is shown on a phone — the page's list and the sign-in lobby's are the same;
 *   · a scene's places are its genre's (backdropsOf), the page keeps no lists of its own;
 *   · on a wide screen a shelf that runs on SHOWS it: the fifth poster peeks, and a mouse gets two arrows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FILM_HEROES, TALL_STILL_MEDIA, heroShelves } from "../app/lib/film-heroes.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const page = read("app", "routes", "web.film.tsx");
const ui = page.slice(0, page.indexOf("const FS_STYLE = `"));
const dict = read("app", "lib", "ui-i18n-dict.ts");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const sheetOf = (name: string) => {
  const open = `const ${name} = \``;
  const a = page.indexOf(open);
  assert.ok(a > 0, name);
  return page.slice(a + open.length, page.indexOf("`;", a));
};
const listOf = (src: string) => {
  const m = /const TALL_STILLS = new Set\(\[([^\]]+)\]\)/.exec(src);
  assert.ok(m);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
};

test("a poster says its movie category; the shelf says how it is told; a screen reader hears the whole name", () => {
  const grid = ui.slice(ui.indexOf("{sh.heroes.map((h) => ("), ui.indexOf("{/* THE LYRIC VIDEO (film-heroes.ts → LYRIC_HERO)"));
  assert.ok(grid.includes("<span className=\"fs-fmt-label\"><b>{t(h.card)}</b></span>"));
  assert.ok(grid.includes("aria-label={[t(h.name), h.kick ? t(h.kick) : \"\", h.meta ? t(h.meta) : \"\"].filter(Boolean).join(\" · \")}"));
  // the words are the categories, the same on both shelves — and the two that share a word differ by their name
  const shelves = heroShelves(FILM_HEROES);
  assert.deepEqual(shelves.map((s) => s.heroes.map((h) => h.card)), [
    ["Drama", "Comedy", "Horror", "Thriller", "Romance", "Sci-Fi", "Fantasy", "Mystery", "Moral"],
    ["Drama", "Comedy", "Horror", "Thriller", "Action", "Romance", "Sci-Fi", "Fantasy", "Mystery", "Moral", "Kids Cartoon"],
    ["Music Video", "Kids Music Video"],
  ]);
  for (const h of FILM_HEROES) {
    const twin = FILM_HEROES.find((o) => o !== h && o.card === h.card);
    if (twin) assert.notEqual(twin.name, h.name, h.card);
    assert.equal(count(dict, `\n  ${JSON.stringify(h.card)}:`), 5, h.card);
  }
  // the builder's banner and the Generate button still say the whole name ("Drama Film", "Drama Story")
  assert.ok(ui.includes("const heroTitle = hero?.name || tmpl?.name || \"Film\";"));
});

test("every phone cover there is, a phone is shown — the page's list and the sign-in lobby's are one list", () => {
  const film = listOf(page);
  const lobby = listOf(read("app", "components", "AuthLobby.tsx"));
  assert.deepEqual(film, lobby, "the same list, in the same order");
  assert.deepEqual([...film].sort(), [...TALL_STILL_MEDIA].sort(), "every phone cover film-heroes.ts knows of");
  for (const k of film) assert.ok(fs.existsSync(path.join(root, "public", "landing", `film-still-${k}-tall.jpg`)), k);
  // a told Story's poster is three upright pictures side by side: cropped down its middle it would be one
  for (const h of FILM_HEROES.filter((x) => x.told === "narrated")) assert.ok(film.includes(h.media), h.id);
});

test("a scene's places are its genre's: the page keeps no lists of its own", () => {
  assert.ok(page.includes("import { backdropsOf } from \"../lib/film-genres\";"));
  for (const gone of ["const FILM_BACKDROPS", "const BACKDROPS_BY_FORMAT", "const backdropsFor", "backdropsFor("]) assert.ok(!page.includes(gone), gone);
});

test("a wide screen shows that a shelf runs on: the fifth poster peeks in, and a mouse has two arrows", () => {
  // (the geometry — four and three tenths, the end of the row — is held with the rest of the rows' numbers in
  //  tests/film-theater.test.ts; here: the arrows)
  const go = sheetOf("FS_SHELF_GO");
  // mounted beside the page's sheet while the shelves are shown
  assert.equal(count(ui, "{!entered && <style dangerouslySetInnerHTML={{ __html: FS_SHELF_GO }} />}"), 1);
  assert.ok(ui.indexOf("<style dangerouslySetInnerHTML={{ __html: FS_STYLE }} />") < ui.indexOf("__html: FS_SHELF_GO"));
  // ONLY where there is a mouse and room for four; on a touch screen and below 980px there are none
  assert.ok(go.startsWith("\n.fs-shelf-arrow{display:none;}\n@media(min-width:980px) and (hover:hover) and (pointer:fine){\n  .fs-shelf-arrow{display:grid;"));
  // over the pictures' middle (the page measures it), each at its end of the row — the logical end, so a
  // right-to-left page has them the other way round and its chevrons point the way the row goes
  assert.ok(go.includes("top:var(--go-y,50%);width:46px;height:46px;margin-top:-23px;border-radius:50%;cursor:pointer;"));
  assert.ok(go.includes(".fs-shelf-arrow.is-back{inset-inline-start:2px;}") && go.includes(".fs-shelf-arrow.is-on{inset-inline-end:2px;}") && go.includes("[dir=rtl] .fs-shelf-arrow svg{transform:scaleX(-1);}"));
  // a full-size thing to click (46px), on the cream card in both themes
  assert.ok(/width:(4[4-9]|[5-9]\d)px;height:\1px;/.test(go));
  // there only while the row can go that way, and gone as a format is entered
  assert.ok(go.includes(".fs-shelf:not([data-moved]) .fs-shelf-arrow.is-back,.fs-shelf[data-end] .fs-shelf-arrow.is-on,.fs-shelves.throw .fs-shelf-arrow{opacity:0;pointer-events:none;}"));
  // nothing moves for anyone who asks for less motion
  assert.ok(go.includes("@media(prefers-reduced-motion:reduce){.fs-shelf-arrow,.fs-shelf-arrow:hover,.fs-shelf-arrow:active{transition:none;transform:none;}}"));
  // the markup: on a shelf with more than four, two plain marks — hidden from a screen reader, out of the Tab
  // order (Tab walks every poster already) — and a click is what moves the row
  const jsx = ui.slice(ui.indexOf("{/* A WIDE SCREEN'S ARROWS (FS_SHELF_GO)"), ui.indexOf("</section>", ui.indexOf("{/* A WIDE SCREEN'S ARROWS (FS_SHELF_GO)")));
  assert.ok(jsx.includes("{sh.heroes.length + (sh.key === \"sung\" && d.lyricVideo ? 1 : 0) + (sh.key === \"acted\" && d.foundFootage ? 1 : 0) > 4 && (<>"));
  assert.ok(jsx.includes("<span className=\"fs-shelf-arrow is-back\" aria-hidden=\"true\" onClick={(e) => stepShelf(e.currentTarget, -1)}>"));
  assert.ok(jsx.includes("<span className=\"fs-shelf-arrow is-on\" aria-hidden=\"true\" onClick={(e) => stepShelf(e.currentTarget, 1)}>"));
  assert.ok(!/<button|tabIndex/.test(jsx));
  // a click moves it four posters (the way the arrow points, in either direction of writing), gliding only
  // when motion is welcome
  const step = ui.slice(ui.indexOf("const stepShelf = (el: HTMLElement, dir: -1 | 1) => {"), ui.indexOf("const stepShelf = (el: HTMLElement, dir: -1 | 1) => {") + 700);
  assert.ok(step.includes("const step = one ? 4 * (one.offsetWidth + (parseFloat(cs.columnGap) || 12)) : row.clientWidth * 0.8;"));
  assert.ok(step.includes("row.scrollBy({ left: dir * (cs.direction === \"rtl\" ? -1 : 1) * step, behavior: reduce ? \"auto\" : \"smooth\" });"));
  assert.ok(step.includes("const reduce = !!window.matchMedia?.(\"(prefers-reduced-motion: reduce)\").matches;"));
  // the page tells each shelf where it is: on arrival, on every scroll of its row, and when the layout changes —
  // and it writes only attributes of the shelf: nothing there moves a row
  const fx = ui.slice(ui.indexOf("/* A WIDE SCREEN'S ARROWS (FS_SHELF_GO, 2026-11-25)"), ui.indexOf("}, [entered, heroes.length, d.lyricVideo, d.foundFootage]);"));
  assert.ok(fx.includes("shelf.toggleAttribute(\"data-moved\", x > 2);") && fx.includes("shelf.toggleAttribute(\"data-end\", x >= row.scrollWidth - row.clientWidth - 2);"));
  assert.ok(fx.includes("row.addEventListener(\"scroll\", onScroll, { passive: true })") && fx.includes("window.addEventListener(\"resize\", place);") && fx.includes("document.fonts?.ready.then("));
  assert.ok(fx.includes("rows.forEach((row) => row.removeEventListener(\"scroll\", onScroll)); window.removeEventListener(\"resize\", place);"), "and lets go of them when the shelves go");
  assert.ok(!/scrollBy|scrollTo|scrollLeft\s*=|scrollIntoView/.test(fx));
  // with today's shelves the two long ones get arrows on a wide screen, Music videos does not
  assert.deepEqual(heroShelves(FILM_HEROES).map((s) => s.heroes.length > 4), [true, true, false]);
});
