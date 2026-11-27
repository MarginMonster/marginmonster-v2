/* THE MOVIE MAKER'S TOP, WIRED TO THE GENRES — the shelves show movie categories, and the writer is never
 * handed nothing.
 *
 * The owner, 2026-11-25:
 *   "Our genres need to be movie categories (drama, horror, comedy, etch)"
 *   "the "write your dialogue" button generates a random scene and dialogue, atleast need a starter "nudge"
 *    couple sentences to hand to the writer"
 *   "The how long can be adjusted to a sexy slider allowing up to 5 minutes with estimated final pricing for
 *    generations"
 *
 * The genres themselves (app/lib/film-genres.ts, the heroes' `card`, the covers) were made and reviewed in their
 * own stream; this file holds how the PAGE (app/routes/web.film.tsx) shows them:
 *   · a poster says its category ("Comedy"), the shelf says how it is told; a screen reader hears the whole name;
 *   · every genre's phone cover is shown on a phone — the page's list and the sign-in lobby's are the same;
 *   · a scene's places are its genre's (backdropsOf), the page keeps no lists of its own;
 *   · on a wide screen a shelf that runs on SHOWS it: the fifth poster peeks, and a mouse gets two arrows.
 * …and the Length step (at the foot of this file): a slider up to five minutes, every figure film-length.ts's.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { FILM_HEROES, TALL_STILL_MEDIA, heroShelves, homeRows } from "../app/lib/film-heroes.ts";
import { dealStarters, nudgeFor, startersOf } from "../app/lib/film-genres.ts";
import { MAX_FILM_SECONDS, lengthStops, maxShots, renderMinutes, scriptParts, secondsFor, tokensFor } from "../app/lib/film-length.ts";
import { filmClock } from "../app/lib/film-flow.ts";
import { estimateFilmTokens } from "../app/lib/plan-config.ts";

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

test("a genre's tile says its movie category; the tile that opened the builder says how it is told; a screen reader hears the whole name", () => {
  // (2026-11-26, that evening: the genres left the home — "the genere tiles are what complicated things", the owner — for
  //  the builder's first card, the Genre card: its panel is a tile per genre, its word on it, its whole name to a reader)
  const grid = ui.slice(ui.indexOf("{genreSh.heroes.map((h) => ("), ui.indexOf("</div>", ui.indexOf("{genreSh.heroes.map((h) => (")));
  assert.ok(grid.includes("<span className=\"mm-genre-nm\">{t(h.card)}</span>"));
  assert.ok(grid.includes("aria-pressed={heroId === h.id} aria-label={t(h.name)} onClick={() => pickGenre(h.id)}>"));
  // the words are the categories, the same on both shelves — and the two that share a word differ by their name
  // (2026-11-26: the told ones stand again on the still shelf — the same heroes, so the same names; and the Anime shelf's
  //  posters say their STYLE, a word of its own each: "an Anime maker with different styles", the owner)
  // (2026-11-26, THE WAYS: Picture Book · Story · Film, then Anime · Kids · Music Video — the Kids' two on a way of their own)
  const shelves = heroShelves(FILM_HEROES);
  assert.deepEqual(shelves.map((s) => s.heroes.map((h) => h.card)), [
    ["Drama", "Comedy", "Horror", "Thriller", "Romance", "Sci-Fi", "Fantasy", "Mystery", "Moral"],
    ["Drama", "Comedy", "Horror", "Thriller", "Romance", "Sci-Fi", "Fantasy", "Mystery", "Moral"],
    ["Drama", "Comedy", "Horror", "Thriller", "Action", "Romance", "Sci-Fi", "Fantasy", "Mystery", "Moral"],
    ["Dream", "Retro", "Neon City", "Skyglow", "Dark Ink", "Pastel Days"],
    ["Kids Cartoon", "Kids Music Video"],
    ["Music Video"],
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
  assert.ok(/\nimport \{[^}]*\bbackdropsOf\b[^}]*\} from "\.\.\/lib\/film-genres";/.test(page));
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
  // (2026-11-26, that evening — THE ROWS: a row's tiles, Caught on Cam's cameras among them)
  assert.ok(jsx.includes("{row.tiles.length + (row.cameras?.length || 0) > 4 && (<>"));
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
  // (…and the rows are all drawn at once again since that evening's ROWS: nothing to run again for a way picked)
  const fx = ui.slice(ui.indexOf("/* A WIDE SCREEN'S ARROWS (FS_SHELF_GO, 2026-11-25)"), ui.indexOf("}, [entered, heroes.length, d.lyricVideo, d.foundFootage]);"));
  assert.ok(ui.includes("}, [entered, heroes.length, d.lyricVideo, d.foundFootage]);"));
  assert.ok(fx.includes("shelf.toggleAttribute(\"data-moved\", x > 2);") && fx.includes("shelf.toggleAttribute(\"data-end\", x >= row.scrollWidth - row.clientWidth - 2);"));
  assert.ok(fx.includes("row.addEventListener(\"scroll\", onScroll, { passive: true })") && fx.includes("window.addEventListener(\"resize\", place);") && fx.includes("document.fonts?.ready.then("));
  assert.ok(fx.includes("rows.forEach((row) => row.removeEventListener(\"scroll\", onScroll)); window.removeEventListener(\"resize\", place);"), "and lets go of them when the shelves go");
  assert.ok(!/scrollBy|scrollTo|scrollLeft\s*=|scrollIntoView/.test(fx));
  // (with today's ROWS — a few format tiles each, the genres in the builder — no row runs on past four, even an operator's:
  //  the arrows wait for a row of five)
  const rows = homeRows(heroShelves(FILM_HEROES), FILM_HEROES, { lyric: true, cam: true });
  assert.deepEqual(rows.map((r) => r.tiles.length + (r.cameras?.length || 0)), [3, 2, 3, 4]);
  assert.ok(rows.every((r) => r.tiles.length + (r.cameras?.length || 0) <= 4));
});

/* ---- THE WRITER'S NUDGE ---------------------------------------------------------------------------------- */

const between = (hay: string, a: string, b: string) => { const i = hay.indexOf(a); assert.ok(i >= 0, a); const j = hay.indexOf(b, i + a.length); assert.ok(j > i, b); return hay.slice(i, j); };

test("the idea box asks for a sentence or two — it no longer promises to surprise anybody with a blank", () => {
  const box = between(ui, "<textarea id=\"fs-topic-in\"", "maxLength={IDEA_MAX} />");
  assert.ok(box.includes("placeholder={isStoryboard && series ? t(\"What happens next? (or leave it — we pick up where it ended)\") : tmpl?.needsProduct ? t(\"the joke, the vibe, who's in it… or leave blank and we'll write one\") : nudgeable ? t(\"a sentence or two: who, where, what goes wrong\") : t(\"a theme, a story, a mood… or leave blank and we'll surprise you\")}"));
  // ("…surprise you" is left only to a format that has no starters to offer — a sung one)
  assert.equal(count(ui, "or leave blank and we'll surprise you"), 1);
  // typing an idea quiets the box's ask
  assert.ok(box.includes("onChange={(e) => { setTopic(e.target.value); if (e.target.value.trim()) setNudgeUrge(false); }}"));
});

test("under the box, three of the genre's starters; a tap puts one IN the box; More ideas deals three others", () => {
  assert.ok(page.includes("import { StarterNudges } from \"../components/film/StarterNudges\";"));
  assert.ok(/\nimport \{[^}]*\bdealStarters\b[^}]*\} from "\.\.\/lib\/film-genres";/.test(page));
  const at = ui.indexOf("{/* the genre's starters, under the box, until there is a script (or the box is asked about again) */}");
  assert.ok(at > ui.indexOf("<textarea id=\"fs-topic-in\""), "under the box");
  const jsx = ui.slice(at, ui.indexOf("onMore={() => setNudgeSeed((s) => s + 1)} t={t} />", at) + 60);
  assert.ok(jsx.includes("{nudgeable && (nudgeUrge || (!treatment && !seeds)) && ("));
  // (…for an acted film, only the starters it can film: film-genres.ts → TOLD_ONLY, 2026-11-26)
  assert.ok(jsx.includes("<StarterNudges starters={dealStarters(template, nudgeSeed, 3, { acted: !narrated })} urge={nudgeUrge} disabled={writing}"));
  // (the component hands over the starter already in the member's language; on a phone the keyboard is not
  //  thrown up at them — the box is focused only where there is a mouse)
  assert.ok(jsx.includes("onPick={(text) => { setTopic(text); setNudgeUrge(false); if (window.matchMedia?.(\"(hover:hover) and (pointer:fine)\").matches) document.getElementById(\"fs-topic-in\")?.focus({ preventScroll: true }); }}"));
  // a different hand each visit, dealt in the browser (the server's page and the browser's are the same)
  assert.ok(ui.includes("const [nudgeSeed, setNudgeSeed] = useState(0);") && ui.includes("useEffect(() => { setNudgeSeed(Math.floor(Math.random() * 1e6)); }, []);"));
  // the film kit's stylesheet is mounted beside the page's, in both themes
  assert.equal(count(ui, "<style dangerouslySetInnerHTML={{ __html: FILM_KIT_CSS }} />"), 1);
  assert.ok(ui.indexOf("<style dangerouslySetInnerHTML={{ __html: FS_STYLE }} />") < ui.indexOf("__html: FILM_KIT_CSS"));
  // every genre deals three, a different three for another seed; a sung format deals none (and is not nudged)
  for (const k of ["testmovie", "comedy", "horror", "thriller", "action", "romance", "scifi", "fantasy", "mystery", "moral", "kidstv"]) {
    assert.equal(dealStarters(k, 7, 3).length, 3, k);
    assert.deepEqual(dealStarters(k, 7, 3), dealStarters(k, 7, 3), `${k}: the same seed, the same hand`);
    for (const s of dealStarters(k, 7, 3)) assert.equal(count(dict, `\n  ${JSON.stringify(s)}:`), 5, s);
  }
  assert.deepEqual(dealStarters("musicvideo", 7, 3), []);
  assert.ok(ui.includes("const nudgeable = isStoryboard && !tmpl?.lipSyncSinger && !series && !editing && dealStarters(template, 0, 1).length > 0;"));
});

test("an EMPTY box never reaches the writer: Write, Write-and-draw and Generate ask for an idea instead", () => {
  // the one guard: with nothing in the box (and a format that wants an idea) it focuses the box, says the
  // nudge line, and stirs the starters once — and nothing is sent
  const guard = between(ui, "const noIdeaYet = () => {", "\n  };\n");
  assert.ok(guard.includes("if (!nudgeable || topic.trim()) return false;"));
  assert.ok(guard.includes("if (nudgeUrge) { setNudgeUrge(false); window.requestAnimationFrame(() => setNudgeUrge(true)); } else setNudgeUrge(true);"), "pressed again: stirred again");
  assert.ok(guard.includes("box.scrollIntoView({ block: \"center\", behavior: reduce ? \"auto\" : \"smooth\" });") && guard.includes("box.focus({ preventScroll: true });"));
  assert.ok(guard.includes("return true;"));
  // "Write the dialogue" (and the board's "Rewrite all", which goes through the same function)
  const write = between(ui, "const writeTreatment = () => {", "treatmentFetcher.submit(");
  assert.ok(write.includes("if (noIdeaYet()) return;\n    sentTopic.current = topic;\n"));
  // "Write it and draw it" (a told story): asked BEFORE the chain starts and before a storyboard is let go
  const make = between(ui, "const makeStoryboard = () => {", "writeTreatment();\n  };");
  assert.ok(make.indexOf("if (noIdeaYet()) return;") > make.indexOf("if (treatment && !seeds) { previewScenes(); return; }"));
  assert.ok(make.indexOf("if (noIdeaYet()) return;") < make.indexOf("if (seeds) { setSeeds(null); }") && make.indexOf("if (noIdeaYet()) return;") < make.indexOf("setChainToScenes(true);"));
  // Generate with nothing written: the writer would be called on the server — asked first; with a script or a
  // storyboard on the page the writer is not called at all, and Generate goes
  assert.ok(ui.includes("<Form method=\"post\" onSubmit={(e) => { if (!treatment && !seeds && noIdeaYet()) { e.preventDefault(); return; } sigAtSubmit.current = storySig; }}>"));
  // what the box is told (the film kit's own line, said with t())
  const kit = read("app", "components", "film", "StarterNudges.tsx");
  assert.ok(kit.includes("export const nudgeHint = \"Give the writer a sentence or two — or tap a starter\";") && kit.includes("{urge && <p className=\"fk-nudge-hint\" role=\"status\">{t(nudgeHint)}</p>}"));
  assert.equal(count(dict, "\n  \"Give the writer a sentence or two — or tap a starter\":"), 5);
});

test("EXCEPT A NEXT EPISODE: its empty box is the normal case — the writer is called, and the box says why", () => {
  // the owner: "need the ability to pick up where left off to continue" — the last episode's ending and its
  // recap ARE the idea, so a series is never nudged: `nudgeable` is false, noIdeaYet lets it through
  assert.ok(ui.includes("&& !series &&") && /const nudgeable = [^;]*!series[^;]*;/.test(ui));
  assert.ok(between(ui, "const noIdeaYet = () => {", "\n  };\n").includes("if (!nudgeable || topic.trim()) return false;"));
  assert.ok(ui.includes("t(\"What happens next? (or leave it — we pick up where it ended)\")"));
  // …and the series is sent to the writer as before
  assert.ok(ui.includes("...(series && isStoryboard ? { seriesFrom: series.from } : {})"));
  // (the server deals no starter for an episode either: film-engine.server.ts)
  assert.ok(read("app", "lib", "film-engine.server.ts").includes("const nudged = series ? null : nudgeFor(tmpl.key, typedIdea, Math.floor(Math.random() * 0x7fffffff), { acted: !!tmpl.dialogue && !narrated });"));
  // the ask is dropped when the format or the series changes
  assert.ok(ui.includes("useEffect(() => { setNudgeUrge(false); }, [template, series?.from]);"));
});

/* THE NUDGE COMES BACK — the route's own function, compiled as it stands. */
const nudgeFill: (shown: string, english: string, sent: string) => string = (() => {
  const src = between(page, "function nudgeFill(shown: string, english: string, sent: string): string {", "\n}\n") + "\n}\n";
  const ts = createRequire(import.meta.url)("typescript");
  const js: string = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(`${js}\nreturn nudgeFill;`)();
})();

test("RUN: when the server wrote from a dealt starter, the box holds it — and keeps what was typed", () => {
  const starter = startersOf("horror")[0];
  const word = starter.split(/[^A-Za-z]+/).find((w) => w.length >= 6) as string;
  assert.ok(word, starter);
  // a word the starter already says: the box is the starter, as the member's language says it
  assert.equal(nudgeFill("(es) " + starter, starter, word), "(es) " + starter);
  assert.equal(nudgeFill(starter, starter, `  ${word.toUpperCase()} `), starter);
  // words it does not say ride along, in brackets — what the member typed is not thrown out of the box
  assert.equal(nudgeFill(starter, starter, "faro  viejo"), `${starter} (faro viejo)`);
  // nothing (or no words at all) typed: the starter
  assert.equal(nudgeFill(starter, starter, ""), starter);
  assert.equal(nudgeFill(starter, starter, "?…"), starter);
  // the server's own fallback still decides what is dealt — the page only shows it: a typed word the
  // starters hold picks the starter that holds it
  const n = nudgeFor("horror", word, 3);
  assert.ok(n && startersOf("horror").includes(n.nudge) && n.nudge.toLowerCase().includes(word.toLowerCase()) && n.typed === "");
  assert.equal(nudgeFill(n.nudge, n.nudge, word), n.nudge);
});

test("the nudge comes back: the box is filled with it once, while the box is what was sent — and it is not a 'new idea'", () => {
  assert.ok(ui.includes("type Treatment = { title?: string; scenes: Scene[]; musicMood: string; cast?: string[]; nudge?: string };"));
  const fx = between(ui, "// THE NUDGE COMES BACK (nudgeFill)", "}, [treatmentFetcher.data]);");
  assert.ok(fx.includes("if (!tr2?.nudge || !tr2.scenes?.length || topic !== sentTopic.current) return;"), "typed since it was sent: the box is theirs");
  assert.ok(fx.includes("const fill = nudgeFill(t(tr2.nudge), tr2.nudge, sentTopic.current);") && fx.includes("nudgeFilled.current = fill;\n    setTopic(fill);"));
  // (filling the box is not the member changing the idea: no "Rewrite to use the new idea" note for it)
  const idea = between(ui, "if (restoring.current) return;\n    // (the box filled with the starter", "}, [topic]);");
  assert.ok(idea.includes("if (nudgeFilled.current !== null && topic === nudgeFilled.current) return;\n    if (seeds || (treatment && !tmpl?.lipSyncSinger)) setIdeaChanged(true);"));
  // said once, under the box, while it stands
  assert.ok(ui.includes("{!!treatment && !ideaChanged && nudgeFilled.current !== null && topic === nudgeFilled.current && <p className=\"mm-note mm-idea-kept\" role=\"status\">{t(\"Written from a starter idea — change it and write again to make it yours.\")}</p>}"));
});

test("every new line of the top is translated, five times over", () => {
  for (const k of ["a sentence or two: who, where, what goes wrong", "What happens next? (or leave it — we pick up where it ended)", "Written from a starter idea — change it and write again to make it yours."]) {
    assert.ok(ui.includes(`t(${JSON.stringify(k)})`), k);
    assert.equal(count(dict, `\n  ${JSON.stringify(k)}:`), 5, k);
  }
});

test("on a phone a step card's kicker keeps clear of its number — and no card is made wider for it", () => {
  // (2026-11-25: at 390px the Captions card's "THE WORDS" ran into its "4"; in Spanish, French and German kickers
  //  ran up to 18px under theirs. Measured after: every English kicker on one line, 5px or more clear; the longer
  //  ones wrap; the page 390px wide in all six languages.)
  const css = sheetOf("FS_STYLE");
  const phone = between(css, "@media(max-width:560px){\n  .mm-story .mm-grid > .mm-card .mm-step{", "\n}\n");
  assert.ok(phone.includes("top:10px;right:10px;width:22px;height:22px;font-size:11.5px;}"));
  assert.ok(phone.includes(".mm-story .mm-grid > .mm-card .mm-card-kick{font-size:10px;}"));
  assert.ok(phone.includes(".mm-story .mm-grid > .mm-card .mm-card-ttl{flex:1 1 auto;}"));
  assert.ok(phone.includes(".mm-story .mm-grid > .mm-card .mm-card-ttl::before{content:\"\";float:right;width:18px;height:16px;}"));
  // (a right-to-left card has its icon on the number's side, not its words)
  assert.ok(phone.includes("[dir=rtl] .mm-story .mm-grid > .mm-card .mm-card-ttl::before{content:none;}"));
  // never by padding the row: that made every card wider, and German ran off the phone
  assert.ok(!/\.mm-card-top\{[^}]*padding/.test(css));
});

/* ---- THE LENGTH SLIDER ------------------------------------------------------------------------------------
 * "The how long can be adjusted to a sexy slider allowing up to 5 minutes with estimated final pricing for
 * generations". The Length step's panel is the film kit's LengthSlider; every figure on it — the stops, how long
 * the film runs, what it will cost, how long it takes to make — is film-length.ts's, and the action holds a film
 * to the same numbers. */

/** One of the page's own module functions, compiled as it stands (with what it calls handed in). */
const pageFn = <F,>(head: string, name: string, deps: Record<string, unknown> = {}): F => {
  const src = between(page, head, "\n}\n") + "\n}\n";
  const ts = createRequire(import.meta.url)("typescript");
  const js: string = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(deps), `${js}\nreturn ${name};`)(...Object.values(deps)) as F;
};
const stopsWith = pageFn<(stops: number[], n: number) => number[]>("function stopsWith(stops: number[], n: number): number[] {", "stopsWith");
const storyMinutes = pageFn<(way: "acted" | "narrated", n: number, o?: { moves?: boolean; per?: number; veo?: boolean }) => [number, number]>("function storyMinutes(", "storyMinutes", { renderMinutes });
const enT = (s: string, p: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (_, k) => String(p[k]));
const waitSaid = pageFn<(m: number, t: typeof enT) => string>("function waitSaid(", "waitSaid");
const lengthPanel = () => between(ui, "            {storyCard === \"length\" && (\n", "            {storyCard === \"shape\" && (");

test("the Length step's panel is the slider — up to five minutes, by the way the story is told", () => {
  assert.ok(page.includes("import { LengthSlider } from \"../components/film/LengthSlider\";"));
  assert.ok(page.includes("import { lengthStops, maxShots, renderMinutes, scriptParts, secondsFor, tokensFor, type FilmWay } from \"../lib/film-length\";"));
  // the panel's opener is kept to the byte: it is also where the Cast panel ends (tests/film-one-cast.test.ts,
  // tests/film-cast-picker-width.test.ts)
  assert.equal(count(ui, "\n            {storyCard === \"length\" && (\n"), 1);
  const panel = lengthPanel();
  assert.ok(panel.includes("<LengthSlider stops={lenStops} value={lenPending ?? scenes} onChange={pickLen} secondsOf={lenSecs} tokensOf={lenTokens} minutesOf={lenMinutes}\n                  unit={narrated ? \"scenes\" : \"shots\"} free={cost === 0} disabled={writing} t={t} />"));
  // the row of buttons is gone (52 of them, once a film could be five minutes); the other steps' pickers stay
  assert.ok(!panel.includes("mm-lenopt") && !panel.includes("mm-lenpick") && !ui.includes("lens.map("));
  assert.ok(ui.includes("<div className=\"mm-lenpick mm-shapepick\" role=\"group\" aria-label={t(\"Shape\")}>"));
  // acted or told: the way, and a told story's narrator's own pace
  assert.ok(ui.includes("const lenWay: FilmWay = narrated ? \"narrated\" : \"acted\";"));
  assert.ok(ui.includes("const lenPer = narrated ? NARRATOR_PACE[narratorId] : undefined;"));
  assert.ok(ui.includes("const lenSecs = (n: number) => secondsFor(lenWay, n, lenPer);"));
  assert.ok(ui.includes("const lenStops = stopsWith(lengthStops(lenWay, { min: narrated ? undefined : tmpl.minScenes, per: lenPer }), scenes);"));
  // every story format's strip starts at its floor and ends at exactly five minutes
  for (const min of [1, 2]) {
    const s = lengthStops("acted", { min });
    assert.equal(s[0], min);
    assert.equal(s[s.length - 1], maxShots("acted"));
    assert.equal(filmClock(secondsFor("acted", s[s.length - 1])), "5:00");
  }
  for (const per of [undefined, 12, 13, 14]) {
    const s = lengthStops("narrated", { per });
    assert.equal(s[0], 3);
    assert.equal(filmClock(secondsFor("narrated", s[s.length - 1], per)), "5:00", `a told story at ${per ?? "the usual"} s a scene ends at five minutes`);
  }
});

test("RUN: the thumb sits on the length the film HAS — a script edited to twelve lines is twelve, not the stop beside it", () => {
  const acted = lengthStops("acted", { min: 1 });
  assert.ok(!acted.includes(12) && !acted.includes(18), "(twelve and eighteen are not stops)");
  assert.ok(stopsWith(acted, 12).includes(12) && stopsWith(acted, 12).length === acted.length + 1);
  assert.deepEqual(stopsWith(acted, 12), [...acted, 12].sort((a, b) => a - b));
  // a stop already, or past either end: the stops as they are
  assert.deepEqual(stopsWith(acted, 4), acted);
  assert.deepEqual(stopsWith(acted, 0), acted);
  assert.deepEqual(stopsWith(acted, 60), acted);
  assert.deepEqual(stopsWith([], 6), []);
});

test("the card says what the slider says: '≈ 1:44 · 18 shots' — 'scenes' for a story", () => {
  assert.ok(ui.includes("const lenLabel = (n: number) => `≈ ${filmClock(lenSecs(n))}`;"));
  assert.ok(ui.includes("<span className=\"mm-val\">{lenLabel(scenes)} · {narrated ? (scenes === 1 ? t(\"1 scene\") : t(\"{n} scenes\", { n: scenes })) : (scenes === 1 ? t(\"1 shot\") : t(\"{n} shots\", { n: scenes }))}</span>"));
  // the slider's own big figure is the same clock of the same seconds
  const kit = read("app", "components", "film", "LengthSlider.tsx");
  assert.ok(kit.includes("const secs = secondsOf(shots);") && kit.includes("{filmClock(secs)}</output>"));
  assert.equal(`≈ ${filmClock(secondsFor("acted", 18))}`, "≈ 1:44");
  assert.equal(`≈ ${filmClock(secondsFor("acted", 52))}`, "≈ 5:00");
  assert.equal(`≈ ${filmClock(secondsFor("narrated", 6))}`, "≈ 0:57");
});

test("the cost line is the ESTIMATE, with 'free while we finish films' beside it while films are free", () => {
  // (…at the story's rung since 2026-11-25: a told story over still pictures is estimated at the still rate —
  //  tests/video-ladder.test.ts)
  assert.ok(ui.includes("const lenTokens = (n: number) => (cost > 0 ? estimateFilmTokens(n) : tokensFor(priceWay(lenWay, lenStill), lenSecs(n)));"));
  // films are free today — the page's own price is nothing — so the slider shows the estimate AND the tag
  assert.equal(estimateFilmTokens(52), 0);
  assert.ok(ui.includes("const cost = estimateFilmTokens(tmpl?.lipSyncSinger ? mvBillScenes(mvSceneCount, mvSceneSec) : scenes);"));
  assert.ok(lengthPanel().includes("free={cost === 0}"));
  assert.equal(count(dict, "\n  \"free while we finish films\":"), 5);
  // (review, 2026-11-25: the tag is one unbroken line beside the tokens — film-kit-style.ts, .fk-len-free nowrap — and
  //  the longer translations ran it off a 390px phone: German to 401px, French 418, Spanish 422. Each is now about
  //  as long as the English, whose tag fits at every length; measured 390px in all six languages at 0:17, 1:27, 5:00.)
  //  (Chinese and Urdu are not set in capitals and were already narrower: 117 and 141px.)
  for (const said of ["gratis mientras probamos", "gratuit pendant les essais", "gratis, solange wir testen"]) {
    assert.ok(dict.includes(`\n  "free while we finish films": ${JSON.stringify(said)},`), said);
    assert.ok(said.length <= "free while we finish films".length, said);
  }
  // what five minutes is estimated at
  assert.equal(tokensFor("acted", secondsFor("acted", maxShots("acted"))), 1500);
  assert.equal(tokensFor("narrated", secondsFor("narrated", maxShots("narrated"))), 750);
  // the page's FREE badges stay
  assert.ok(ui.includes("t(\"Generate {name} · Free\", { name: t(heroTitle) })") && ui.includes("t(\"Free while we get this section dialed in — pricing comes later\")"));
});

test("the action holds a story to the slider's own numbers (filmShots); the Music Video and the Kids Music Video keep theirs", () => {
  const act = page.slice(page.indexOf("export const action = async"), page.indexOf("export default function FilmStudio"));
  assert.ok(act.includes("const { FILM_TEMPLATES, filmTemplate, previewFilmTreatment, canNarrate, filmShots } = await import(\"../lib/film-engine.server\");"));
  assert.ok(act.includes("const storyLength = !!tmpl.dialogue && !tmpl.lipSyncSinger && !tmpl.sung;"));
  assert.ok(act.includes("const clampScenes = (n: number) => (storyLength ? filmShots(tmpl.key, narrated, n) : Math.max(tmpl.minScenes, Math.min(maxScenes, Math.round(n || tmpl.defaultScenes))));"));
  // the sung formats' own: a Music Video's length in seconds
  assert.ok(act.includes("const maxScenes = tmpl.lipSyncSinger ? Math.min(tmpl.maxScenes, Math.floor(MV_MAX_SECONDS / filmSceneSeconds)) : tmpl.maxScenes;"));
  // all three places a length comes in go through it (the write, the storyboard, the film) — and the length of a
  // script that is sent with the film
  assert.equal(count(act, "clampScenes(parseInt((form.get(\"filmScenes\") as string) || \"\", 10) || tmpl.defaultScenes)"), 3);
  assert.ok(act.includes("scenes = clampScenes(n);"));
  assert.ok(!page.includes("clampNarrated"));
  // the slider's last stop is exactly the engines' ceiling
  const eng = read("app", "lib", "film-engine.server.ts");
  assert.ok(eng.includes("export const ACTED_MAX_SHOTS = maxShots(\"acted\");") && eng.includes("export const NARRATED_MAX_SCENES = maxShots(\"narrated\");"));
  assert.ok(eng.includes("return narrated && canNarrate(t.key) ? clampNarrated(Number(n)) : clampScenes(t, Number(n));"));
  // …and the page is handed the told story's range of the engine (it said 3 to 12)
  assert.ok(page.includes("narratedScenes: { min: NARRATED_MIN_SCENES, max: NARRATED_MAX_SCENES, def: NARRATED_DEFAULT_SCENES },"));
});

test("a script written in parts is not asked for again whole when it fails — a short one still gets its second go", () => {
  const act = page.slice(page.indexOf("if (intent === \"previewFilmTreatment\") {"), page.indexOf("if (intent === \"previewFilmFrame\") {"));
  assert.ok(act.includes("const inParts = storyLength && scriptParts(narrated ? \"narrated\" : \"acted\", scenes).length > 1;"));
  assert.ok(act.includes("try { treatment = await previewFilmTreatment(args); }\n      catch (first) {\n        if (inParts) throw first;\n        console.error(`[film] treatment write failed, trying once more:"));
  // (everything a film was before today is written in one answer, and keeps its retry)
  for (let n = 1; n <= 6; n++) assert.equal(scriptParts("acted", n).length, 1);
  for (let n = 3; n <= 12; n++) assert.equal(scriptParts("narrated", n).length, 1);
  assert.ok(scriptParts("acted", maxShots("acted")).length > 1 && scriptParts("narrated", maxShots("narrated")).length > 1);
});

test("a slow narrator picked after a long length: the story still ends at five minutes — while nothing is written", () => {
  const fx = between(ui, "useEffect(() => {\n    if (!narrated || restoring.current || treatment || seeds) return;", "}, [narratorId]);");
  assert.ok(fx.includes("const most = maxShots(\"narrated\", lenPer);\n    if (scenes > most) setScenes(most);"));
  assert.ok(ui.includes("const NARRATOR_PACE: Record<string, number> = { \"char:keeper\": 14, \"char:mary\": 13, \"char:coco\": 12, \"char:howl\": 12 };"));
  assert.equal(maxShots("narrated", 14), 22);
  assert.ok(22 * 14 >= MAX_FILM_SECONDS && 21 * 14 < MAX_FILM_SECONDS);
});

test("A SLIDER CANNOT ASK FIRST PER VALUE: under a written script a new length waits — 'This rewrites your script', Rewrite / Keep", () => {
  // held PENDING while the page's own arming ("len:") stands; anything that drops the arming puts the thumb back
  assert.ok(ui.includes("const [lenDraft, setLenDraft] = useState<number | null>(null);"));
  assert.ok(ui.includes("const lenPending = wipeArm === \"len:\" && lenDraft !== null ? lenDraft : null;"));
  assert.ok(ui.includes("useEffect(() => { setWipeArm(\"\"); }, [storyCard, template, storyHasWork]);"));
  const pick = between(ui, "const pickLen = (n: number) => {", "\n  };\n");
  // nothing written, or back to the script's own length: it is simply the length
  assert.ok(pick.includes("if (!treatment || treatment.scenes.length === n) { setLenDraft(null); orArm(\"len:\", false, () => setStoryLen(n)); return; }"));
  // else held — and armed once (orArm's first tap); while armed a move only changes what is pending, never commits
  assert.ok(pick.includes("setLenDraft(n);\n    // (the first move ARMS — orArm's first tap; while armed, a move only changes what is pending)\n    if (wipeArm !== \"len:\") orArm(\"len:\", true, () => setStoryLen(n));"));
  assert.ok(!pick.includes("setScenes("), "never a length under a script without the tap");
  // Keep: the thumb goes back
  assert.ok(ui.includes("const keepLen = () => { setLenDraft(null); setWipeArm(\"\"); };"));
  // Rewrite: orArm's second tap — the length, and the script written again at it (a told story with pictures drawn again)
  const redo = between(ui, "const rewriteAtLen = () => {", "\n  };\n");
  assert.ok(redo.includes("orArm(\"len:\", true, () => { setLenDraft(null); setStoryLen(n); setLenRedo({ draw: narrated && !!seeds }); });"));
  // (review, 2026-11-25: Rewrite never throws a script away to then write or draw NOTHING — not while the pictures
  //  are still being drawn (makeStoryboard refuses then), and not with an empty idea box (the writer is never called
  //  without one): the box asks first, and the script and the pending length both stay)
  assert.ok(redo.includes("if (lenPending === null || writing || seedBusy) return;"));
  assert.ok(redo.indexOf("if (noIdeaYet()) return;") > -1 && redo.indexOf("if (noIdeaYet()) return;") < redo.indexOf("orArm(\"len:\", true,"), "the box asks BEFORE anything is wiped");
  assert.ok(ui.includes("if (!lenRedo) return;\n    setLenRedo(null);\n    if (lenRedo.draw) makeStoryboard(); else writeTreatment();\n  }, [lenRedo]);"));
  // the line, under the slider, in the panel
  const panel = lengthPanel();
  assert.ok(panel.indexOf("{lenPending !== null && (") > panel.indexOf("<LengthSlider "));
  assert.ok(panel.includes("<p className=\"mm-note mm-shape-warn mm-lenwipe\" role=\"status\">\n                    <span>{t(\"This rewrites your script\")}</span>"));
  assert.ok(panel.includes("<button type=\"button\" className=\"mm-lenwipe-go\" onClick={rewriteAtLen} disabled={writing || seedBusy}>{t(\"Rewrite\")}</button>"));
  assert.ok(panel.includes("<button type=\"button\" className=\"mm-lenwipe-keep\" onClick={keepLen}>{t(\"Keep\")}</button>"));
  // each answer a finger's size to tap, the look kept small
  const css = sheetOf("FS_STYLE");
  assert.ok(css.includes(".mm-lenwipe-do button::after{content:\"\";position:absolute;left:0;right:0;top:50%;height:44px;transform:translateY(-50%);}"));
  for (const k of ["This rewrites your script", "Rewrite", "Keep"]) assert.equal(count(dict, `\n  ${JSON.stringify(k)}:`), 5, k);
});

test("a long film says so in the Generate area: past twenty minutes, one calm line — the same estimate the slider says", () => {
  assert.ok(page.includes("const LONG_RENDER_MINUTES = 20;"));
  assert.ok(ui.includes("const [renderLo, renderHi] = lenMinutes(scenes);\n  const renderAbout = (renderLo + renderHi) / 2;\n  const longRender = isStoryboard && renderAbout > LONG_RENDER_MINUTES;"));
  // said ONCE: in the estimate's own place (its range is on the slider), never a second line saying it again
  const go = between(ui, "<div className={`fs-eta${longRender ? \" is-long\" : \"\"}`} aria-live=\"polite\"", "</Form>");
  assert.ok(go.includes("<span aria-hidden=\"true\">⏱</span> {longRender\n              ? t(\"About {time} to render — we'll keep it in your Archive\", { time: waitSaid(renderAbout, t) })\n              : <>{t(\"Est. render time\")} <b>{filmEta("));
  assert.equal(count(ui, "About {time} to render"), 1);
  // ONE estimate: the slider's minutes, "Est. render time" and this line are all storyMinutes (renderMinutes)
  assert.ok(ui.includes("const lenMinutes = (n: number): [number, number] => storyMinutes(lenWay, n, { moves: d.storyMotion && pictures !== \"still\", per: lenPer, veo: dialogueEngine === \"veo\" });"));
  assert.ok(page.includes("[lo, hi] = storyMinutes(\"narrated\", n, { moves: opts.moves, per: opts.per });") && page.includes("[lo, hi] = storyMinutes(\"acted\", n, { veo: opts.engine === \"veo\" });"));
  assert.ok(ui.includes("filmEta({ lipSyncSinger: tmpl?.lipSyncSinger, dialogue: isStoryboard, per: lenPer, narrated, moves: d.storyMotion && pictures !== \"still\", scenes, engine: dialogueEngine })"));
  // RUN: who sees it
  const about = (way: "acted" | "narrated", n: number, o?: { moves?: boolean; per?: number; veo?: boolean }) => { const [lo, hi] = storyMinutes(way, n, o); return (lo + hi) / 2; };
  assert.deepEqual(storyMinutes("acted", 4), renderMinutes("acted", 4));
  assert.ok(about("acted", 4) <= 20, "a short acted film: no line");
  assert.ok(about("acted", 6) <= 20 && about("acted", 7) > 20, "from seven shots (about forty seconds) it is said");
  assert.equal(waitSaid(about("acted", 7), enT), "25 min");
  assert.equal(waitSaid(about("acted", 52), enT), "2 h 30 min");
  assert.ok(about("narrated", maxShots("narrated")) <= 20, "a told story, even five minutes of it, is under twenty");
  // (Veo, never timed, kept the seventh slower the page has always said)
  assert.deepEqual(storyMinutes("acted", 52, { veo: true }), [Math.round((132 * 8) / 7), Math.round((170 * 8) / 7)]);
  assert.deepEqual(storyMinutes("narrated", 6, { veo: true }), renderMinutes("narrated", 6));
  // said as people say it, to the nearest five minutes
  assert.equal(waitSaid(44, enT), "45 min");
  assert.equal(waitSaid(60, enT), "1 h");
  assert.equal(waitSaid(66, enT), "1 h 5 min");
  for (const k of ["About {time} to render — we'll keep it in your Archive", "{n} min", "{h} h {m} min", "{h} h"]) assert.equal(count(dict, `\n  ${JSON.stringify(k)}:`), 5, k);
  // calm: no amber — a sentence, centred, wrapping as one
  const css = sheetOf("FS_STYLE");
  const rule = css.slice(css.indexOf(".fs-eta.is-long{"), css.indexOf("}", css.indexOf(".fs-eta.is-long{")));
  assert.ok(rule.includes("display:block;") && rule.includes("text-align:center;") && !/#7A5A12|#FFF7E3|#EBD9A8/.test(rule), rule);
});
