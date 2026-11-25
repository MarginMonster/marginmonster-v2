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
import { createRequire } from "node:module";
import { FILM_HEROES, TALL_STILL_MEDIA, heroShelves } from "../app/lib/film-heroes.ts";
import { dealStarters, nudgeFor, startersOf } from "../app/lib/film-genres.ts";

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
  assert.ok(jsx.includes("<StarterNudges starters={dealStarters(template, nudgeSeed, 3)} urge={nudgeUrge} disabled={writing}"));
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
  assert.ok(read("app", "lib", "film-engine.server.ts").includes("const nudged = series ? null : nudgeFor(tmpl.key, typedIdea, Math.floor(Math.random() * 0x7fffffff));"));
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
