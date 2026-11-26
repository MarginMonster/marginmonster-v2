/* GENRE IS A SETUP STEP, NOT A PATH (2026-11-26).
 *
 * The owner, looking at the Movie Maker's home on his phone:
 *   "The new path routes are a bit confusing"
 *   "Selected at the top the type then outputs at the bottom - I think that is the confusing part"
 *   "Does genre even matter ?" — "Genre may be able to be just added at the setup step before seed generation"
 * and that evening, with two photos of the home:
 *   "Because this setup is hard to understand narrated/acted being at the top of the selection looks odd and easy to
 *    misunderstand. I liked when it was rows designated (the genere tiles are what complicated things)"
 *
 * So the home is ROWS designated by how a thing is told — Stories · Films · Music · Caught on Cam — each a few FORMAT
 * tiles that open their builder in one tap, and no genre anywhere on it. The genre (an anime's style) is the FIRST card
 * of the story builder: its panel the genres of the way the tile opened, one tap to change — which keeps what the member
 * set and asks first before it throws a script away. This file holds that; tests/film-heroes.test.ts holds the rows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { FILM_HEROES, KIDS_HEROES, LYRIC_HERO, genreWayOf, heroById, heroOfTile, heroShelves, homeRows, tileOfWay, type HomeTile } from "../app/lib/film-heroes.ts";
import { routeIdea } from "../app/lib/idea-route.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const page = read("app", "routes", "web.film.tsx");
const ui = page.slice(0, page.indexOf("const FS_STYLE = `"));
const dict = read("app", "lib", "ui-i18n-dict.ts");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
/** The text from `a` up to and including `b` (the first `b` after `a`). */
const between = (hay: string, a: string, b: string) => { const i = hay.indexOf(a); assert.ok(i >= 0, a); const j = hay.indexOf(b, i + a.length); assert.ok(j > i, b); return hay.slice(i, j + b.length); };
const ts = createRequire(import.meta.url)("typescript");
/** One of the page's own statements, compiled as it stands, run in a world of what it uses. */
const run = <T,>(src: string, name: string, deps: Record<string, unknown>): T => {
  const js: string = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(deps), `${js}\nreturn ${name};`)(...Object.values(deps)) as T;
};

const OPERATOR = homeRows(heroShelves(FILM_HEROES), FILM_HEROES, { lyric: true, cam: true });
const tile = (k: string): HomeTile => OPERATOR.flatMap((r) => r.tiles).find((w) => w.key === k)!;

test("THE FOUR WAYS ENTER DIRECTLY: Narrated Video, Narrated Pictures, Acted Film and Anime are tiles — one tap, no row of genres", () => {
  // each a tile of its row, holding its way's genres (an anime's styles) for the builder's first card
  for (const [k, row] of [["told", "told"], ["still", "told"], ["anime", "told"], ["acted", "acted"]] as const) {
    assert.equal(OPERATOR.find((r) => r.tiles.some((w) => w.key === k))?.key, row, k);
    assert.ok(tile(k).heroes.length > 1, `${k}: its genres are picked inside`);
  }
  // the tap: the tile's hero — its genre already picked — on the tile's rung, into its builder (enterFormat)
  assert.equal(count(ui, "onClick={() => openTile(w)}"), 1);
  assert.ok(ui.includes("const openTile = (w: HomeTile) => { setRingRow(null); enterFormat(heroOfTile(w, tileGuess), w.rung); };"));
  // and NO row of genre posters renders for them, nor for anything else: the home's markup never lists a way's heroes
  const home = between(ui, "{rows.map((row) => (", "{entered && (");
  assert.ok(!/heroes\.map|h\.card/.test(home), "no genre on the home");
  assert.ok(!ui.includes("{sh.heroes.map((h) => (") && !ui.includes("pickWay"));
  // the genres' words live in the builder's Genre panel only
  assert.equal(count(ui, "{t(h.card)}"), 1);
  assert.ok(between(ui, "{genreSh.heroes.map((h) => (", "))}").includes("<span className=\"mm-genre-nm\">{t(h.card)}</span>"));
});

test("RUN: the hero a tile opens — its first genre; the genre the idea names; the same genre from another way", () => {
  const told = tile("told"), still = tile("still"), acted = tile("acted"), anime = tile("anime");
  // no idea in the box: Drama for the stories and the films, the first style for anime
  assert.deepEqual([told, still, acted, anime].map((w) => heroOfTile(w, null)), ["shortstory", "shortstory", "testmovie", "animedream"]);
  // an idea whose guess falls in the tile's way: that genre, preselected
  const ghost = routeIdea("a ghost in the attic", { heroes: FILM_HEROES, ways: ["still", "told", "acted", "anime", "kids", "sung", "cam"], current: "told" });
  assert.deepEqual(ghost, { way: "told", heroId: "horror", rung: "moving" });
  assert.equal(heroOfTile(told, ghost), "horror");
  // …and the same genre where the tile is another way: as pictures, as a film (a ghost story tapped as a Film is a Horror Film)
  assert.equal(heroOfTile(still, ghost), "horror");
  assert.equal(heroOfTile(acted, ghost), "horrorfilm");
  // a genre a way does not have: its first (no horror anime style) — and an action film told by a narrator is a Thriller,
  // as the guide box says it (there is no Action Story)
  assert.equal(heroOfTile(anime, ghost), "animedream");
  assert.equal(heroOfTile(told, { way: "acted", heroId: "actionfilm" }), "thriller");
  assert.equal(heroOfTile(acted, { way: "acted", heroId: "actionfilm" }), "actionfilm");
  // an anime idea in the Anime tile: its style
  assert.equal(heroOfTile(anime, { way: "anime", heroId: "animeneon" }), "animeneon");
  // a one-format tile always opens its format
  for (const k of ["kidstv", "musicvideo", "kidsmusicvideo", "lyricvideo"]) assert.equal(heroOfTile(tile(k), ghost), k === "lyricvideo" ? LYRIC_HERO.id : k);
});

test("KIDS, SUNG AND CAM STILL SHOW ROWS: the Kids Cartoon a Film, the sung ones and the Lyric Video Music, the cameras Caught on Cam", () => {
  assert.deepEqual(OPERATOR.map((r) => r.key), ["told", "acted", "sung", "cam"]);
  assert.deepEqual(OPERATOR.find((r) => r.key === "acted")!.tiles.map((w) => w.key), ["acted", "kidstv"]);
  assert.deepEqual(OPERATOR.find((r) => r.key === "sung")!.tiles.map((w) => w.key), ["musicvideo", "kidsmusicvideo", "lyricvideo"]);
  assert.deepEqual(OPERATOR.find((r) => r.key === "cam")!.cameras!.map((c) => c.key), ["house", "bodycam", "phone", "camcorder"]);
  // each kid's format, and each sung one, is one format: it opens straight into its builder, no genre card there
  for (const k of [...KIDS_HEROES, "musicvideo"]) assert.equal(genreWayOf(heroById(k)), null, k);
  // a camera is a door to Found Footage's own builder, the idea in the box going with it (this tab's sessionStorage)
  const cams = between(ui, "{row.cameras?.map((c) => (", "))}");
  assert.ok(cams.includes("href={`${FOUND_FOOTAGE_DOOR.href}?camera=${c.key}`}") && cams.includes("window.sessionStorage.setItem(IDEA_HANDOFF_KEY, packHandoff(idea, Date.now()));"));
});

test("THE GUIDE BOX LANDS ON A TILE: every way the guess can take maps onto one; Start opens the guessed genre; the chips name tile and genre", () => {
  const at = (way: Parameters<typeof tileOfWay>[1]["way"], heroId: string | null, camera?: string) => tileOfWay(OPERATOR, { way, heroId, camera });
  assert.equal(at("still", "horror"), "still");
  assert.equal(at("told", "horror"), "told");
  assert.equal(at("acted", "horrorfilm"), "acted");
  assert.equal(at("anime", "animeneon"), "anime");
  assert.equal(at("kids", "kidstv"), "kidstv");
  assert.equal(at("kids", "kidsmusicvideo"), "kidsmusicvideo", "kids → the cartoon or the sing-along, by its hero");
  assert.equal(at("sung", "musicvideo"), "musicvideo");
  assert.equal(at("cam", null, "bodycam"), "cam:bodycam");
  assert.equal(at("cam", null), "cam:house");
  assert.equal(tileOfWay(homeRows(heroShelves(FILM_HEROES), FILM_HEROES), { way: "cam", heroId: null }), null, "no camera for a member");
  // the page: the guessed tile is ringed (is-guess) and the first chip names it; the second names the genre Start opens
  assert.ok(ui.includes("const guessTile = !idea ? null : tileOfWay(rows, guess);"));
  assert.ok(ui.includes("${guessTile === w.key ? \" is-guess\" : \"\"}") && ui.includes("${guessTile === `cam:${c.key}` ? \" is-guess\" : \"\"}"));
  assert.ok(ui.includes("const guessName = !guessTile ? null : guess.way === \"cam\" ? CAUGHT_ON_CAM.name : guessOn?.name || null;"));
  assert.ok(ui.includes("return h && (guessOn?.heroes.length || 0) > 1 ? h.card : null;"), "the genre — where the tile has more than one");
  // showGuess brings the tile into view; Start goes the tile's own way, the guessed genre already picked
  const show = between(ui, "  const showGuess = () => {", "\n  };");
  assert.ok(show.includes("document.querySelector(`.fs-shelf [data-tile=\"${guessTile}\"]`)?.scrollIntoView({ block: \"center\", inline: \"center\", behavior: still ? \"auto\" : \"smooth\" });"));
  assert.ok(between(ui, "  const startIdea = () => {", "\n  };").includes("enterFormat(guess.heroId, guess.rung);"));
});

test("\"genre\" IS A STORY CARD — the first: Genre (The kind), Style (The look) for anime; its panel the way's genres", () => {
  assert.ok(ui.includes("type StoryCard = \"genre\" | \"cast\" | \"told\" | \"length\" | \"shape\" | \"captions\" | \"voice\" | \"motion\";"));
  const card = between(ui, "            {genreOn && hero && (", "            )}");
  assert.ok(card.includes("style={{ order: -2 }}") && card.includes("onClick={() => tapStory(\"genre\")}") && card.includes("aria-expanded={storyCard === \"genre\"}"));
  assert.ok(card.includes("{t(genreWay === \"anime\" ? \"The look\" : \"The kind\")}</span><b>{t(genreWay === \"anime\" ? \"Style\" : \"Genre\")}</b>"));
  assert.ok(card.includes("<span className=\"mm-val\">{t(hero.card)}</span>"), "its value: the genre's word");
  assert.ok(card.includes("<span className={`mm-card-ico is-genre ${hero.tint}`}>{fmtIcon(hero.tmpl, hero.told === \"narrated\")}</span>"), "its icon: the genre's own badge, on its own tint");
  const panel = between(ui, "            {genreOn && genreSh && storyCard === \"genre\" && (", "            )}");
  assert.ok(panel.includes("style={{ order: -1 }}") && panel.includes("<div className=\"mm-opts-h\">{t(genreSh.pick)}</div>"));
  assert.ok(panel.includes("<div className=\"mm-genres\" role=\"group\""));
  assert.ok(panel.includes("<button type=\"button\" key={h.id} className={`mm-genre${heroId === h.id ? \" on\" : \"\"}${wipeArm === `genre:${h.id}` ? \" is-arm\" : \"\"}`} aria-pressed={heroId === h.id} aria-label={t(h.name)} onClick={() => pickGenre(h.id)}>"));
  assert.ok(panel.includes("<LoopCover k={h.media} loop={false} />"), "the genre's own poster, still");
  // the way's genres, in the way's order — Drama first
  assert.deepEqual(heroShelves(FILM_HEROES).find((s) => s.key === "told")!.heroes.map((h) => h.card), ["Drama", "Comedy", "Horror", "Thriller", "Romance", "Sci-Fi", "Fantasy", "Mystery", "Moral"]);
  // three a row on a phone, five on a wide panel; the camera tiles' look
  const css = page.slice(page.indexOf("const FS_STYLE = `"));
  assert.ok(css.includes(".mm-genres{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:4px;}") && css.includes("@media(min-width:700px){.mm-genres{grid-template-columns:repeat(5,minmax(0,1fr));}}"));
});

test("WHEN IT SHOWS: a hero with genres to pick — a story, a film, an anime — and never for the Kids Cartoon, a next episode or a story opened to edit", () => {
  // the hero's own way: anime by its shelf, else told or acted by how it is told — the Kids Cartoon and the sung ones none
  for (const h of FILM_HEROES) {
    const want = h.shelf === "anime" ? "anime" : h.told === "narrated" ? "told" : h.told === "acted" && h.id !== "kidstv" ? "acted" : null;
    assert.equal(genreWayOf(h), want, h.id);
  }
  assert.equal(genreWayOf(LYRIC_HERO), null);
  // RUN the page's own rule
  const src = between(ui, "  const genreWay = lyricOn ? null : genreWayOf(hero);", "  const stepAt = genreOn ? 1 : 0;");
  const shelves = heroShelves(FILM_HEROES);
  const shows = (heroId: string, o: { series?: unknown; editing?: unknown; lyricOn?: boolean; isStoryboard?: boolean; shelvesOf?: typeof shelves } = {}) =>
    run<number>(src, "stepAt", { lyricOn: !!o.lyricOn, genreWayOf, hero: heroById(heroId), shelves: o.shelvesOf || shelves, isStoryboard: o.isStoryboard ?? true, series: o.series ?? null, editing: o.editing ?? null, heroId }) === 1;
  for (const id of ["shortstory", "comedy", "horror", "testmovie", "horrorfilm", "actionfilm", "moralfilm", "animedream", "animesky"]) assert.ok(shows(id), id);
  assert.ok(!shows("kidstv"), "the Kids Cartoon: no genre card");
  assert.ok(!shows("musicvideo", { isStoryboard: false }) && !shows("kidsmusicvideo", { isStoryboard: false }));
  assert.ok(!shows("horror", { series: { from: "x", title: "y", episode: 2 } }), "a next episode: the series' genre");
  assert.ok(!shows("horror", { editing: { from: "x", title: "y", kept: true } }), "a story opened to edit: its own genre");
  assert.ok(!shows("horror", { lyricOn: true }));
  // a way with one genre offered has nothing to pick
  const lone = FILM_HEROES.filter((h) => h.told !== "narrated" || h.id === "horror");
  assert.ok(!shows("horror", { shelvesOf: heroShelves(lone) }));
});

test("THE STEPS COUNT ON: Genre 1, then Cast 2 … Narrator or Engine 6 — and 1 to 5, as they were, without it", () => {
  assert.ok(ui.includes("const stepAt = genreOn ? 1 : 0;"));
  assert.ok(ui.includes("{storyDone.genre ? <Ico n=\"check\" size={13} /> : 1}</span>"));
  for (const [card, n] of [["cast", 1], ["length", 2], ["shape", 3], ["captions", 4], ["voice", 5]] as const) {
    assert.equal(count(ui, `{storyDone.${card} ? <Ico n="check" size={13} /> : ${n} + stepAt}</span>`), 1, card);
  }
  // the card and its panel stand FIRST in the grid (order -2, -1), before the Cast's (1, 2)
  assert.ok(ui.indexOf("style={{ order: -2 }}") > 0 && ui.indexOf("style={{ order: -1 }}") > ui.indexOf("style={{ order: -2 }}"));
  assert.ok(ui.includes("<button type=\"button\" ref={castCardRef} style={{ order: 1 }}"));
});

/** The page's switchGenre, compiled as it stands, in a world of recorded state calls. */
function genreWorld(from: string, o: { scenes: number; narrated: boolean }) {
  const src = between(ui, "  const switchGenre = (id: string) => {", "\n  };");
  const calls: [string, unknown][] = [];
  const rec = (name: string) => (v: unknown) => { calls.push([name, typeof v === "function" ? (v as (x: Record<string, boolean>) => unknown)({ cast: true }) : v]); };
  const templates = [
    { key: "testmovie", defaultScenes: 2, minScenes: 1, maxScenes: 52 },
    { key: "horror", defaultScenes: 4, minScenes: 2, maxScenes: 52 },
    { key: "comedy", defaultScenes: 4, minScenes: 2, maxScenes: 52 },
  ];
  const fromHero = heroById(from)!;
  // EVERYTHING the builder holds that switchGenre must NOT touch is in the world too, recorded: a call to one fails the test
  const kept = ["setTopic", "setStoryPick", "setFilmAspect", "setNarrPick", "setCapPick", "setPictures", "setStillCamera", "setDialogueEngine", "setTold", "setSeries", "setLockVoices"];
  const deps: Record<string, unknown> = {
    heroById, d: { templates, narratedScenes: { min: 3, max: 31, def: 6 } }, tmpl: templates.find((x) => x.key === fromHero.tmpl), narrated: o.narrated, scenes: o.scenes,
    setHeroId: rec("heroId"), setTemplate: rec("template"), setScenes: rec("scenes"), setTreatment: rec("treatment"), setSeeds: rec("seeds"), setFrames: rec("frames"), setCast: rec("cast"),
    setStoryMonster: rec("monster"), setStoryCard: rec("storyCard"), setStoryDone: rec("storyDone"),
    window: { requestAnimationFrame: () => 0 }, genreCardRef: { current: null },
    ...Object.fromEntries(kept.map((k) => [k, rec(k)])),
  };
  const switchGenre = run<(id: string) => void>(src, "switchGenre", deps);
  return { switchGenre, calls, kept, got: (name: string) => calls.filter(([n]) => n === name).map(([, v]) => v) };
}

test("RUN: switchGenre KEEPS what the member set — the idea, the stars, the shape, the narrator — and clears what the old genre WROTE", () => {
  // a told Drama Story at 9 scenes, a script and its pictures on the page: Comedy
  let w = genreWorld("shortstory", { scenes: 9, narrated: true });
  w.switchGenre("comedy");
  assert.deepEqual(w.got("heroId"), ["comedy"]);
  assert.deepEqual(w.got("template"), ["comedy"]);
  assert.deepEqual([w.got("treatment"), w.got("seeds"), w.got("frames"), w.got("cast")], [[null], [null], [[]], [[]]], "the script, its pictures, its cast");
  for (const k of w.kept) assert.deepEqual(w.got(k), [], `${k} is kept`);
  assert.deepEqual(w.got("scenes"), [9], "a told story keeps its length — within the told range");
  assert.deepEqual(w.got("storyCard"), [null], "the panel closes");
  assert.deepEqual(w.got("storyDone"), [{ cast: true, genre: true }], "and the step is done — the others as they were");
  assert.deepEqual(w.got("monster"), [null], "no monster outside Horror");
  // …into Horror the monster stays (it is Horror's)
  w = genreWorld("shortstory", { scenes: 6, narrated: true });
  w.switchGenre("horror");
  assert.deepEqual(w.got("monster"), []);
  // an acted Drama Film still at Drama's opening length (2) takes Comedy's (4); a length the member set stays, held to the range
  w = genreWorld("testmovie", { scenes: 2, narrated: false });
  w.switchGenre("comedyfilm");
  assert.deepEqual(w.got("scenes"), [4]);
  w = genreWorld("testmovie", { scenes: 1, narrated: false });
  w.switchGenre("horrorfilm");
  assert.deepEqual(w.got("scenes"), [2], "Horror's floor is two shots");
  w = genreWorld("horrorfilm", { scenes: 12, narrated: false });
  w.switchGenre("comedyfilm");
  assert.deepEqual(w.got("scenes"), [12]);
  // a told story out of the told range is held to it
  w = genreWorld("shortstory", { scenes: 40, narrated: true });
  w.switchGenre("comedy");
  assert.deepEqual(w.got("scenes"), [31]);
  // an unknown genre changes nothing
  w = genreWorld("shortstory", { scenes: 6, narrated: true });
  w.switchGenre("nope");
  assert.equal(w.calls.length, 0);
  // the page: NOT switchHero (which starts everything over, the stars and the shape with it)
  assert.ok(!between(ui, "  const switchGenre = (id: string) => {", "\n  };").includes("switchHero"));
});

test("RUN: with a script or a storyboard on the page, another genre ASKS FIRST — the page's own arm-to-confirm (orArm)", () => {
  const orArmSrc = between(ui, "  const orArm = (key: string, wipes: boolean, go: () => void) => {", "\n  };");
  const pickSrc = between(ui, "  const pickGenre = (id: string) => {", "\n  };");
  const world = (wipeArm: string, storyHasWork: boolean, heroId = "shortstory") => {
    const calls: [string, unknown][] = [];
    const rec = (name: string) => (v?: unknown) => { calls.push([name, v]); };
    const orArm = run<(key: string, wipes: boolean, go: () => void) => void>(orArmSrc, "orArm", { storyHasWork, wipeArm, setWipeArm: rec("arm") });
    const pickGenre = run<(id: string) => void>(pickSrc, "pickGenre", { heroId, orArm, setWipeArm: rec("arm"), setStoryCard: rec("storyCard"), switchGenre: rec("switch") });
    return { pickGenre, calls };
  };
  // a script on the page, nothing armed: the first tap only ARMS — nothing is thrown away
  let w = world("", true);
  w.pickGenre("comedy");
  assert.deepEqual(w.calls, [["arm", "genre:comedy"]]);
  // the second tap on the same genre: done
  w = world("genre:comedy", true);
  w.pickGenre("comedy");
  assert.deepEqual(w.calls, [["arm", ""], ["switch", "comedy"]]);
  // another genre while one is armed: that one is armed instead
  w = world("genre:comedy", true);
  w.pickGenre("horror");
  assert.deepEqual(w.calls, [["arm", "genre:horror"]]);
  // nothing written yet: one tap
  w = world("", false);
  w.pickGenre("comedy");
  assert.deepEqual(w.calls, [["arm", ""], ["switch", "comedy"]]);
  // the genre already picked closes the panel, and switches nothing
  w = world("genre:comedy", true, "comedy");
  w.pickGenre("comedy");
  assert.deepEqual(w.calls, [["arm", ""], ["storyCard", null]]);
  // the page: the work it would throw away is the storyboard's (a script, or pictures) — the arming the other wipes use,
  // dropped when the card closes or the template changes; the line says so while armed; the tile wears the amber
  assert.ok(ui.includes("const storyHasWork = !tmpl?.lipSyncSinger && (!!treatment || !!seeds);"));
  assert.ok(ui.includes("useEffect(() => { setWipeArm(\"\"); }, [storyCard, template, storyHasWork]);"));
  assert.ok(ui.includes("{wipeArm.startsWith(\"genre:\") && <p className=\"mm-note mm-shape-warn\" role=\"status\">{t(genreWay === \"anime\" ? \"A new style writes it again — tap again to change\" : \"A new genre writes it again — tap again to change\")}</p>}"));
  assert.ok(page.includes(".fs-rface.is-arm,.mm-told.is-arm,.mm-lenopt.is-arm,.mm-genre.is-arm{border-color:#D9A53A;"));
});

test("ANOTHER GENRE IS THE SAME BUILDER: nothing rises in again; the banner, the starters and the Archive's name follow the hero", () => {
  assert.ok(ui.includes("<div className=\"fs-stepsin\" key={lyricOn ? LYRIC_HERO.id : genreWay || template}>"));
  // (the banner and the Generate button speak of the hero — "Comedy Story" — and the starters are the template's)
  assert.ok(ui.includes("<div className=\"fs-hero-ttl\">{t(heroTitle)}</div>") && ui.includes("const heroTitle = hero?.name || tmpl?.name || \"Film\";"));
  assert.ok(ui.includes("<StarterNudges starters={dealStarters(template, nudgeSeed, 3, { acted: !narrated })}"));
  // a picked genre gives the focus back to the card it was picked from (its tile goes with the panel)
  assert.ok(between(ui, "  const switchGenre = (id: string) => {", "\n  };").includes("window.requestAnimationFrame(() => genreCardRef.current?.focus({ preventScroll: true }));"));
});

test("every new word is in all five languages — and \"Genre\" says a film's kind in Chinese too", () => {
  for (const k of ["The kind", "Genre", "The look", "Style", "A new genre writes it again — tap again to change", "A new style writes it again — tap again to change", "A narrator tells it", "Actors speak on camera", "Pick a genre", "Pick a style"]) {
    assert.equal(count(dict, `\n  ${JSON.stringify(k)}: `), 5, k);
  }
  // (it said 曲风, a song's style, while only the Music Video's card used it)
  assert.ok(dict.includes("\n  \"Genre\": \"类型\",") && !dict.includes("\"Genre\": \"曲风\""));
  for (const k of ["The kind", "Style", "A new genre writes it again — tap again to change", "A new style writes it again — tap again to change"]) assert.ok(ui.includes(JSON.stringify(k)), k);
});
