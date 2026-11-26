/* STILL STORIES — the still tier's own shelf of posters on the Movie Maker (2026-11-26).
 *
 * A told story can be made over its STILL pictures, each with a slow camera move: the cheapest thing the Movie Maker
 * makes (film-length.ts → 1 token a second, against 2.5 moving). On 2026-11-25 that choice went INTO the builder's
 * Length step (Still / Moving, each with its estimate). The owner, the next day:
 *   "Maybe just make it an additional tier on the actual movie maker (would look like more options)"
 * So the still rung stands on the home too: a shelf right after the Stories, re-listing the told heroes, each poster
 * opening its hero ON THE STILL RUNG — and each poster's picture drifting the way a still story's picture drifts, so
 * nine familiar posters read as more options rather than the same shelf twice.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { FILM_HEROES, heroOf, heroShelves, heroesFor, posterKey } from "../app/lib/film-heroes.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// (a checkout with CRLF line endings must read the same as one with LF)
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const page = read("app", "routes", "web.film.tsx");
const heroesSrc = read("app", "lib", "film-heroes.ts");
const dict = read("app", "lib", "ui-i18n-dict.ts");
/** A stylesheet the page declares: the text between `const NAME = \`` and its closing backtick. */
const sheetOf = (name: string) => {
  const open = `const ${name} = \``;
  const a = page.indexOf(open);
  assert.ok(a > 0, name);
  return page.slice(a + open.length, page.indexOf("`;", a));
};
const FS_STYLE = sheetOf("FS_STYLE");
const between = (hay: string, a: string, b: string) => { const i = hay.indexOf(a); assert.ok(i >= 0, a); const j = hay.indexOf(b, i + a.length); assert.ok(j > i, b); return hay.slice(i, j + b.length); };

test("the still shelf stands right after the Stories and re-lists exactly the told heroes, in their order", () => {
  const shelves = heroShelves(FILM_HEROES);
  assert.deepEqual(shelves.map((s) => s.key), ["told", "still", "acted", "sung"]);
  const [told, still] = shelves;
  assert.deepEqual([still.name, still.tag, still.line, still.rung], ["Still Stories", "Cheapest", "A narrator tells it over still pictures that slowly move", "still"]);
  // the Stories open on moving pictures: that is what their line says now
  assert.equal(told.rung, "moving");
  assert.equal(told.line, "A narrator tells it over moving pictures");
  // the very told heroes, in the heroes' own order — and nothing else
  const toldHeroes = FILM_HEROES.filter((h) => h.told === "narrated");
  assert.deepEqual(still.heroes.map((h) => h.id), toldHeroes.map((h) => h.id));
  assert.deepEqual(still.heroes, told.heroes);
  // a way shelf carries no rung but the told one's
  assert.deepEqual(shelves.filter((s) => s.rung).map((s) => [s.key, s.rung]), [["told", "moving"], ["still", "still"]]);
  // it re-lists whatever told heroes a page is offered (a page that cannot narrate a template has no Story of it)
  const fewer = heroesFor(["musicvideo", "kidstv", "kidsmusicvideo", "moral", "horror", "testmovie"], ["horror"]);
  assert.deepEqual(heroShelves(fewer).find((s) => s.key === "still")?.heroes.map((h) => h.id), ["horror"]);
  // …and a page with no told hero has no still shelf at all — never an empty one
  assert.ok(!heroShelves(FILM_HEROES.filter((h) => h.told !== "narrated")).some((s) => s.key === "still"));
});

test("the still posters are NOT heroes of their own: a piece made from one reads back as its Story", () => {
  // (`tmpl|told` is unique — film-heroes.test.ts — and heroOf / film-series.ts → storyHeroOf take the first match; a
  //  still story is that Story with meta.rung = "still", which Edit story, Next episode and Another language carry)
  assert.ok(!FILM_HEROES.some((h) => /still/i.test(h.id) || /still/i.test(h.name)), "no FilmHero for the still rung");
  assert.equal(new Set(FILM_HEROES.map((h) => `${h.tmpl}|${h.told}`)).size, FILM_HEROES.length);
  for (const h of heroShelves(FILM_HEROES).find((s) => s.key === "still")!.heroes) assert.equal(heroOf(h.tmpl, true)?.id, h.id, h.id);
  // the rung rides the piece, as it did (S13's carry is untouched)
  assert.ok(read("app", "lib", "story-motion.ts").includes("export type StoryPictures = \"still\" | \"moving\";"));
});

test("where a server's pictures cannot move, every story is told over stills already: no still shelf repeats the Stories", () => {
  assert.ok(!heroShelves(FILM_HEROES, { still: false }).some((s) => s.key === "still" || s.rung === "still"));
  assert.deepEqual(heroShelves(FILM_HEROES, { still: false }).map((s) => s.key), ["told", "acted", "sung"]);
  // the Stories stay, and say moving pictures — the builder's own words there are the still ones (S13: lenStill)
  assert.equal(heroShelves(FILM_HEROES, { still: false })[0].heroes.length, 9);
  assert.deepEqual(heroShelves(FILM_HEROES, { still: true }).map((s) => s.key), ["told", "still", "acted", "sung"]);
  assert.deepEqual(heroShelves(FILM_HEROES, {}).map((s) => s.key), ["told", "still", "acted", "sung"], "the shelf is there unless asked away");
  // the page asks with the loader's own fact
  assert.equal(count(page, "{heroShelves(heroes, { still: d.storyMotion }).map((sh) => ("), 1);
  assert.ok(page.includes("    storyMotion: storyMotionOn(),\n"));
});

test("a poster's key says which shelf it stands on, so the same hero pops only where it was tapped", () => {
  assert.equal(posterKey("horror", "still"), "still:horror");
  assert.equal(posterKey("horror", "moving"), "horror", "a Story's poster keeps its plain id");
  assert.equal(posterKey("horror"), "horror");
  assert.equal(posterKey("horrorfilm"), "horrorfilm");
  // every poster on the page has a key of its own
  const keys = heroShelves(FILM_HEROES).flatMap((s) => s.heroes.map((h) => posterKey(h.id, s.rung)));
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.length, 9 + 9 + 11 + 2);
});

test("the page: one map draws every shelf; a still poster opens its hero on the still rung, plays no loop, and says so", () => {
  const block = between(page, "{heroShelves(heroes, { still: d.storyMotion }).map((sh) => (", "{entered && (");
  // the SAME single map — the still shelf is not a second block of markup
  assert.equal(count(page, "heroShelves("), 1);
  assert.equal(count(block, "{sh.heroes.map((h) => ("), 1);
  assert.equal(count(block, "className=\"fs-shelf-arrow "), 2);
  // its heading's icon: a picture
  assert.ok(block.includes("<Ico n={sh.key === \"told\" ? \"book\" : sh.key === \"still\" ? \"image\" : sh.key === \"acted\" ? \"film\" : \"music\"} size={18} />"));
  // each poster: its zoom by its own key; chosen only while its rung is; opened on its shelf's rung
  assert.ok(block.includes("className={`fs-fmt${zoomKey === posterKey(h.id, sh.rung) ? \" zoom\" : \"\"}"));
  assert.ok(block.includes("aria-selected={heroId === h.id && (!sh.rung || pictures === sh.rung)}"));
  assert.ok(block.includes("onClick={() => enterFormat(h.id, sh.rung)}"));
  // no moving loop on the still shelf: LoopCover with loop={false} has no <video> at all
  assert.ok(block.includes("<LoopCover k={h.media} loop={sh.rung === \"still\" ? false : undefined} />"));
  assert.ok(page.includes("const has = !!clip || (loop ?? LOOP_KEYS.includes(k));") && page.includes("{has && <video ref={ref} className={`fs-fmt-vid"));
  // its note is "Still pictures" where a Story's says "narrated in minutes" — on the poster and to a screen reader
  assert.ok(block.includes("{t(h.kick)}{sh.rung === \"still\" ? <em> · {t(\"Still pictures\")}</em> : h.meta ? <em> · {t(h.meta)}</em> : null}"));
  assert.ok(block.includes("sh.rung === \"still\" ? t(\"Still pictures\") : h.meta ? t(h.meta) : \"\"].filter(Boolean).join(\" · \")}"));
  // nothing else about the poster changed: its word, its tint and its told glyph are the Story's
  assert.ok(block.includes("<span className=\"fs-fmt-label\"><b>{t(h.card)}</b></span>") && block.includes("{fmtIcon(h.tmpl, h.told === \"narrated\")}"));
  assert.ok(page.includes("// (2026-11-26) …and the told heroes again on a shelf of their still rung: a poster's key says which shelf it stands on\nimport { posterKey } from \"../lib/film-heroes\";"));
});

/** The page's enterFormat, compiled as it stands, in a world of recorded state calls. */
function enterWorld(heroId: string) {
  const src = between(page, "  const enterFormat = (key: string, rung?: StoryPictures) => {", "\n  };");
  const ts = createRequire(import.meta.url)("typescript");
  const js: string = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls: [string, unknown][] = [];
  const later: (() => void)[] = [];
  const rec = (name: string) => (v: unknown) => { calls.push([name, v]); };
  const deps = {
    window: { matchMedia: () => ({ matches: false }), setTimeout: (fn: () => void) => { later.push(fn); return 0; } },
    setZoomKey: rec("zoom"), setAnim: rec("anim"), setLyricOn: rec("lyric"), setEntered: rec("entered"), setPictures: rec("pictures"),
    LYRIC_HERO: { id: "lyricvideo" }, heroId, posterKey,
    // as the page's own switchHero does to the rung: it resets it (and the script, the cast, the storyboard)
    switchHero: (id: string) => { calls.push(["switchHero", id]); calls.push(["pictures", "moving"]); },
  };
  const enterFormat = new Function(...Object.keys(deps), `${js}\nreturn enterFormat;`)(...Object.values(deps)) as (key: string, rung?: "still" | "moving") => void;
  return { enterFormat, calls, settle: () => { while (later.length) later.shift()!(); }, last: (name: string) => [...calls].reverse().find(([n]) => n === name)?.[1] };
}

test("entering from the still shelf opens the hero on the still rung — and the same hero from the other shelf keeps its work", () => {
  // the switch's reset comes first, then the shelf's rung: the preset wins
  const src = between(page, "  const enterFormat = (key: string, rung?: StoryPictures) => {", "\n  };");
  assert.ok(src.includes("setZoomKey(posterKey(key, rung)); setAnim(\"in\");"));
  assert.ok(src.includes("window.setTimeout(() => { if (key !== heroId) switchHero(key); if (rung) setPictures(rung); setEntered(true); setAnim(\"\"); setZoomKey(null); }, reduce ? 0 : 400);"));
  assert.ok(between(page, "const switchHero = (id: string) => {", "\n  };").includes("setPictures(\"moving\");"));

  // another hero, from Still Stories: switched (a new story), then Still
  let w = enterWorld("testmovie");
  w.enterFormat("horror", "still");
  assert.equal(w.calls[0][1], "still:horror", "the still poster pops, not the Story's");
  w.settle();
  assert.deepEqual(w.calls.filter(([n]) => n === "switchHero" || n === "pictures").map(([n, v]) => `${n}:${v}`), ["switchHero:horror", "pictures:moving", "pictures:still"]);
  assert.equal(w.last("pictures"), "still");
  assert.equal(w.last("entered"), true);

  // the SAME hero again from the other shelf: no switch — its script, cast and storyboard are kept — only the rung
  w = enterWorld("horror");
  w.enterFormat("horror", "moving");
  assert.equal(w.calls[0][1], "horror");
  w.settle();
  assert.ok(!w.calls.some(([n]) => n === "switchHero"), "the work is kept");
  assert.deepEqual(w.calls.filter(([n]) => n === "pictures").map(([, v]) => v), ["moving"]);
  w = enterWorld("horror");
  w.enterFormat("horror", "still");
  w.settle();
  assert.ok(!w.calls.some(([n]) => n === "switchHero"));
  assert.equal(w.last("pictures"), "still");

  // a door with no rung (an acted Film, the hero reel's tag, the Lyric Video) leaves the rung as it was
  w = enterWorld("horror");
  w.enterFormat("horrorfilm");
  w.settle();
  assert.deepEqual(w.calls.filter(([n]) => n === "pictures").map(([, v]) => v), ["moving"], "only switchHero's own reset");
  w = enterWorld("horror");
  w.enterFormat("horror");
  w.settle();
  assert.ok(!w.calls.some(([n]) => n === "pictures" || n === "switchHero"));
  assert.ok(page.includes("onClick={() => enterFormat(playing.id)}") && page.includes("onClick={() => enterFormat(LYRIC_HERO.id)}"));
});

test("a still poster moves the way a still story moves: Gentle, slowly, a transform only — and never past its picture's edge", () => {
  const before = FS_STYLE.slice(0, FS_STYLE.indexOf("/* ───────── THE ROWS — each shelf is ONE row of its posters, swiped sideways ─────────"));
  const rules = [
    ".fs-shelf.is-still .fs-fmt-cover img{animation:mmCamGentle 14s ease-in-out infinite alternate;}",
    ".fs-shelf.is-still .fs-fmt:nth-child(3n+2) .fs-fmt-cover img{animation-delay:-4.7s;}",
    ".fs-shelf.is-still .fs-fmt:nth-child(3n) .fs-fmt-cover img{animation-delay:-9.3s;}",
    // where there is a mouse: while it is pointed at, or has the keyboard's focus (as a loop plays); on a touch screen, always
    "@media(hover:hover) and (pointer:fine){\n  .fs-shelf.is-still .fs-fmt-cover img{animation-play-state:paused;}\n  .fs-shelf.is-still .fs-fmt:hover .fs-fmt-cover img,.fs-shelf.is-still :focus-visible > .fs-fmt-cover img{animation-play-state:running;}\n}",
    // nothing moves for anyone who asks for less motion
    "@media(prefers-reduced-motion:reduce){.fs-shelf.is-still .fs-fmt-cover img{animation:none;}}",
  ];
  for (const r of rules) assert.equal(count(before, r), 1, r);
  // the page's own sheet (mounted on the home, always), before the rows — whose rules move nothing by themselves
  assert.equal(count(page, "<style dangerouslySetInnerHTML={{ __html: FS_STYLE }} />"), 1);
  // only the still shelf's covers drift: no other rule animates a poster's picture
  const flat = FS_STYLE.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.deepEqual([...flat.matchAll(/([^{}]*\.fs-fmt-cover img)\{[^}]*animation:[^;}]+/g)].map((m) => m[1].trim()), [".fs-shelf.is-still .fs-fmt-cover img", ".fs-shelf.is-still .fs-fmt-cover img"]);

  // the move is S13b's GENTLE — the still story's own default camera — the keyframes the Length step's tile plays
  const kf = /@keyframes mmCamGentle\{((?:\d+%\{[^}]*\})+)\}/.exec(FS_STYLE);
  assert.ok(kf, "mmCamGentle is in the page's sheet");
  assert.ok(FS_STYLE.includes(".mm-cam.is-gentle img{animation:mmCamGentle 9s ease-in-out infinite alternate;}"));
  // a transform and nothing else
  const steps = [...kf[1].matchAll(/(\d+)%\{([^}]*)\}/g)].map((m) => {
    assert.ok(/^transform:[^;]+;$/.test(m[2]), m[2]);
    const s = Number(/scale\(([\d.]+)\)/.exec(m[2])?.[1] ?? 1);
    const tx = Number(/translateX\((-?[\d.]+)%\)/.exec(m[2])?.[1] ?? 0);
    return { at: Number(m[1]), s, tx };
  });
  assert.deepEqual(steps.map((x) => x.at), [0, 35, 70, 100]);
  // NO EDGE EVER SHOWS. `scale(s) translateX(tx%)` about the picture's middle moves it s·tx% of the cover's width and
  // leaves (s − 1)/2 of it to spare on each side. Between two keyframes both numbers move together (a missing
  // translateX is a translateX(0)), so the path is checked along every segment.
  let worst = 1;
  for (let k = 0; k + 1 < steps.length; k++) {
    for (let i = 0; i <= 100; i++) {
      const u = i / 100;
      const s = steps[k].s + (steps[k + 1].s - steps[k].s) * u;
      const tx = steps[k].tx + (steps[k + 1].tx - steps[k].tx) * u;
      const spare = (s - 1) / 2 * 100 - s * Math.abs(tx);
      assert.ok(spare >= 0, `${steps[k].at}%→${steps[k + 1].at}% at ${u}: an edge shows`);
      worst = Math.min(worst, spare);
    }
  }
  assert.ok(worst >= 0.25, `the closest it comes to an edge is ${worst.toFixed(2)}% of the cover's width`);
  // (the comment's figures are these: 5.75% at 115% with 7.5% to spare; 3.2% at 107% with 3.5%)
  assert.ok(Math.abs(1.15 * 5 - 5.75) < 1e-9 && Math.abs(1.07 * 3 - 3.21) < 1e-9);
  // it never stops at a hard end: alternate, so it eases back the way it came
  assert.ok(/mmCamGentle 14s ease-in-out infinite alternate/.test(before));
});

test("the still shelf has its own accent — a cool steel blue — and its words in all five languages", () => {
  const before = FS_STYLE.slice(0, FS_STYLE.indexOf("/* ───────── THE ROWS"));
  assert.ok(before.includes(".fs-shelf.is-told{--shelf:#A8741B;--shelf-soft:rgba(168,116,27,.1);}\n/* (the STILL shelf"));
  assert.ok(before.includes(".fs-shelf.is-still{--shelf:#3E6A8E;--shelf-soft:rgba(62,106,142,.09);}\n.fs-shelf.is-acted{"));
  // blue: more blue in it than red or green, and none of the other three
  const [r, g, b] = [1, 3, 5].map((i) => parseInt("#3E6A8E".slice(i, i + 2), 16));
  assert.ok(b > g && g > r);
  // the words — every one five times, and the two it reuses never added again (a duplicate key is a TS error)
  for (const k of ["Still Stories", "A narrator tells it over still pictures that slowly move", "A narrator tells it over moving pictures", "Cheapest", "Still pictures"]) {
    assert.equal(count(dict, `\n  ${JSON.stringify(k)}: `), 5, k);
  }
  for (const lang of ["es", "fr", "de", "zh", "ur"]) {
    const open = `const ${lang}: Record<string, string> = {\n`;
    assert.ok(dict.includes(`${open}  "Still Stories": `), `${lang}: inserted at the top of its block`);
  }
});

test("the shelf's comment keeps the owner's words and the rule", () => {
  assert.ok(heroesSrc.includes("\"Maybe just make it an additional tier on the actual movie maker (would look like more\n * options)\""));
  assert.ok(heroesSrc.includes("THE RULE. Every hero stands on exactly one WAY shelf — told, acted, sung — which is how it is made. A RUNG shelf"));
  assert.ok(heroesSrc.includes("The still shelf's name, tag and line are a first proposal, each one line to change; so is its place."));
  assert.ok(heroesSrc.includes("import type { StoryPictures } from \"./story-motion.ts\";"), "a type only: film-heroes.ts stays free of what story-motion.ts runs");
});
