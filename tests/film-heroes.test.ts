/* THE MOVIE MAKER'S HEROES — a format as it is told. No Acted/Narrated switch.
 *
 * The owner, 2026-11-22, after seeing an acted and a narrated horror story made side by side: "I still think
 * we don't use a toggle but create a new hero (scripted horror stories) then Classic Ai Horror stories or
 * something. Same for short story: scripted and acted out vs a different hero altogether that matches the
 * narration model."
 *
 * So how a story is told is part of what is PICKED: each hero is one format told one way, with its own
 * name, poster and banner — and a narrated hero's poster is cut from a real narrated film.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FILM_HEROES, LOOP_MEDIA, TALL_STILL_MEDIA, heroById, heroName, heroOf, heroShelves, heroesFor } from "../app/lib/film-heroes.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");
const exists = (...p: string[]) => fs.existsSync(path.join(root, ...p));
const ui = read("app", "routes", "web.film.tsx");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

test("a Film is acted and a Story is told: every hero is one format told one way", () => {
  const byName = Object.fromEntries(FILM_HEROES.map((h) => [h.name, h]));
  assert.deepEqual([byName["Horror Film"].tmpl, byName["Horror Film"].told], ["horror", "acted"]);
  assert.deepEqual([byName["Horror Story"].tmpl, byName["Horror Story"].told], ["horror", "narrated"]);
  // (the Short Film is Drama since 2026-11-25 — the owner: "Our genres need to be movie categories (drama,
  //  horror, comedy, etch)" — the same template, told the same two ways, under its category's name)
  assert.deepEqual([byName["Drama Film"].tmpl, byName["Drama Film"].told], ["testmovie", "acted"]);
  assert.deepEqual([byName["Drama Story"].tmpl, byName["Drama Story"].told], ["testmovie", "narrated"]);
  assert.ok(!byName["Short Film"] && !byName["Short Story"]);
  assert.equal(byName["Moral Story"].told, "narrated");
  assert.equal(byName["Kids Cartoon"].told, "acted");
  // the name says how it is told
  for (const h of FILM_HEROES) {
    if (h.told === "narrated") assert.ok(/Story$/.test(h.name), `${h.name} is told`);
    if (/Film$/.test(h.name)) assert.equal(h.told, "acted", `${h.name} is acted`);
  }
  // ids are unique, and no two heroes are the same format told the same way
  assert.equal(new Set(FILM_HEROES.map((h) => h.id)).size, FILM_HEROES.length);
  assert.equal(new Set(FILM_HEROES.map((h) => `${h.tmpl}|${h.told}`)).size, FILM_HEROES.length);
  // a narrated hero never shares its poster with an acted one: the poster shows what the hero makes
  for (const h of FILM_HEROES.filter((x) => x.told === "narrated")) {
    assert.ok(!FILM_HEROES.some((o) => o !== h && o.media === h.media), h.id);
    assert.ok(/narrated/.test(h.meta), `${h.name} says so on its poster`);
  }
});

test("a hero is found by its id, and a finished film by how it was made", () => {
  assert.equal(heroById("horrorfilm")?.name, "Horror Film");
  assert.equal(heroById("nope"), undefined);
  assert.equal(heroOf("horror", true)?.id, "horror");
  assert.equal(heroOf("horror", false)?.id, "horrorfilm");
  assert.equal(heroOf("testmovie", true)?.id, "shortstory");
  assert.equal(heroOf("testmovie", false)?.id, "testmovie");
  assert.equal(heroOf("musicvideo", false)?.id, "musicvideo", "a sung format is the same hero either way");
  // the Archive calls a film what its hero is called; an unknown template keeps its own name
  assert.equal(heroName("horror", false, "Horror Story"), "Horror Film");
  assert.equal(heroName("horror", true, "Horror Story"), "Horror Story");
  assert.equal(heroName("testmovie", true, "Short Film"), "Drama Story");
  // MORAL FILM (2026-11-23): the acted Moral Story is a hero again — a tester who had been making it:
  // "Moral story section previous model do amazing, set this like previous"
  assert.equal(heroName("moral", false, "Moral Story"), "Moral Film");
  assert.equal(heroName("moral", true, "Moral Story"), "Moral Story");
  assert.equal(heroOf("moral", false)?.id, "moralfilm");
  assert.equal(heroById("moralfilm")?.told, "acted");
  assert.equal(heroById("moralfilm")?.media, "moral", "the poster of the acted one, which never left the disk");
  for (const f of ["film-loop-moral.mp4", "film-loop-moral-tall.mp4", "film-loop-moral.jpg", "film-still-moral.jpg", "film-still-moral-tall.jpg"]) assert.ok(fs.existsSync(path.join(root, "public", "landing", f)), f);
  assert.ok(read("app", "routes", "web.film.tsx").includes('const LOOP_KEYS = ["musicvideo", "testmovie", "shortstory", "kidstv", "moralstory", "moral", "horrorstory", "horror", "kidsmusicvideo"];'));
  // it sits right after the story it is the acted twin of, like the other pairs
  assert.equal(FILM_HEROES.findIndex((h) => h.id === "moralfilm"), FILM_HEROES.findIndex((h) => h.id === "moral") + 1);
  for (const w of ["Moral Film", "A lesson, scripted and acted out"]) assert.equal(read("app", "lib", "ui-i18n-dict.ts").split("\n  " + JSON.stringify(w) + ": ").length - 1, 5, w);
  assert.equal(heroName("youtube", false, "YouTube Video"), "YouTube Video");
  assert.ok(read("app", "lib", "film-dialogue.server.ts").includes("title: `${heroName(tmpl.key, false, tmpl.name)} — "));
  assert.ok(read("app", "lib", "narrated-story.server.ts").includes("title: `${heroName(tmpl.key, true, tmpl.name)} — "));
});

test("a page is offered only the heroes it can make", () => {
  // (the six formats there were before the genres became movie categories, 2026-11-25 — a page that knows only
  //  these is offered the nine heroes it always was, in the shelves' new order: Drama first, the Kids Cartoon last)
  const all = ["musicvideo", "kidstv", "kidsmusicvideo", "moral", "horror", "testmovie"];
  assert.deepEqual(heroesFor(all, ["horror", "moral", "kidstv", "testmovie"]).map((h) => h.id), ["musicvideo", "kidsmusicvideo", "shortstory", "testmovie", "horror", "horrorfilm", "moral", "moralfilm", "kidstv"]);
  // …and with the seven new templates, every hero there is
  const genres = ["comedy", "thriller", "action", "romance", "scifi", "fantasy", "mystery"];
  assert.deepEqual(heroesFor([...all, ...genres], ["horror", "moral", "kidstv", "testmovie", ...genres]).map((h) => h.id), FILM_HEROES.map((h) => h.id));
  // a template that cannot be narrated offers no told hero; a template the account lacks offers none at all
  assert.deepEqual(heroesFor(all, ["moral"]).map((h) => h.id), ["musicvideo", "kidsmusicvideo", "testmovie", "horrorfilm", "moral", "moralfilm", "kidstv"]);
  assert.deepEqual(heroesFor(["musicvideo"], ["horror"]).map((h) => h.id), ["musicvideo"]);
});

test("the grid shows a poster per hero, and opening one sets the format AND how it is told", () => {
  assert.ok(ui.includes("const heroes = heroesFor(d.templates.map((x) => x.key), d.narratable || []);"));
  // (the posters stand on shelves now — told, acted, sung: each shelf lists its own heroes)
  // (2026-11-26: and the told heroes again on the STILL shelf — a poster opens its hero on its shelf's rung, plays no
  //  loop there, and says "Still pictures" where a Story's poster says "narrated in minutes": the slice is longer)
  const grid = ui.slice(ui.indexOf("{sh.heroes.map((h) => ("), ui.indexOf("{sh.heroes.map((h) => (") + 1100);
  // (2026-11-25, the genres are movie categories: the poster says its CATEGORY — "Comedy" — and the shelf says
  //  how it is told; the whole name, "Comedy Film", is what a screen reader is told, with the line under it)
  assert.ok(grid.includes("onClick={() => enterFormat(h.id, sh.rung)}") && grid.includes("<LoopCover k={h.media} loop={sh.rung === \"still\" ? false : undefined} />") && grid.includes("<b>{t(h.card)}</b>"));
  assert.ok(grid.includes("aria-label={[t(h.name), h.kick ? t(h.kick) : \"\", sh.rung === \"still\" ? t(\"Still pictures\") : h.meta ? t(h.meta) : \"\"].filter(Boolean).join(\" · \")}") && !grid.includes("<b>{t(h.name)}</b>"));
  assert.ok(grid.includes("{t(h.kick)}{sh.rung === \"still\" ? <em> · {t(\"Still pictures\")}</em> : h.meta ? <em> · {t(h.meta)}</em> : null}"));
  assert.ok(!ui.includes("{d.templates.map((x) => {\n              const m = FMT["), "the grid is no longer one poster per template");
  const sw = ui.slice(ui.indexOf("const switchHero = (id: string) => {"), ui.indexOf("const switchHero = (id: string) => {") + 1100);
  assert.ok(sw.includes("const openNarrated = !!nt?.dialogue && h.told === \"narrated\" && (d.narratable || []).includes(h.tmpl);"));
  assert.ok(sw.includes("setHeroId(h.id);") && sw.includes("setTemplate(h.tmpl);") && sw.includes("setTold(openNarrated ? \"narrated\" : \"acted\");"));
  // its length and shape are set with it: the effect that follows `told` does not run when two heroes in a row are told the same way
  assert.ok(sw.includes("openNarrated ? d.narratedScenes.def : (nt?.defaultScenes || 6)"));
  assert.ok(sw.includes("if (nt?.dialogue) setFilmAspect(openNarrated ? \"9:16\" : \"16:9\");"));
  // two heroes can share a template, so "the same one again" is judged on the hero (and since 2026-11-26 a told
  // hero opened from a shelf with a rung — Stories, Still Stories — is opened on that rung, after switchHero's reset)
  assert.ok(ui.includes("window.setTimeout(() => { if (key !== heroId) switchHero(key); if (rung) setPictures(rung); setEntered(true); setAnim(\"\"); setZoomKey(null); }, reduce ? 0 : 400);"));
  assert.ok(!ui.includes("switchTemplate("));
});

test("there is no Acted / Narrated switch in the builder", () => {
  assert.ok(!ui.includes("tapStory(\"told\")") && !ui.includes("storyCard === \"told\"") && !ui.includes("aria-pressed={narrated}") && !ui.includes("aria-pressed={!narrated}"));
  assert.ok(!ui.includes("setTold(\"acted\")") && !ui.includes("setTold(\"narrated\")"), "only opening a hero decides how it is told");
  assert.equal(count(ui, "setTold("), 1);
  // the steps count on without it: Cast 1, Length 2, Shape 3, Captions 4, Narrator/Engine 5
  for (const [card, n] of [["length", 2], ["shape", 3], ["captions", 4], ["voice", 5]] as const) {
    assert.ok(ui.includes(`{storyDone.${card} ? <Ico n="check" size={13} /> : ${n}}</span>`), `${card} is step ${n}`);
  }
});

test("the builder's banner, the Generate button and a kept music video all speak of the hero", () => {
  assert.ok(ui.includes("const heroTitle = hero?.name || tmpl?.name || \"Film\";"));
  assert.ok(ui.includes("<div className=\"fs-hero-ttl\">{t(heroTitle)}</div>"));
  assert.ok(ui.includes("src={stillOf(hero?.media || template)}"));
  assert.ok(ui.includes("t(\"Generate {name} · Free\", { name: t(heroTitle) })") && ui.includes("t(\"Generate {name} · {cost} Tokens\", { name: t(heroTitle), cost })"));
  assert.ok(ui.includes("setTemplate(k.template); setHeroId(FILM_HEROES.find((h) => h.tmpl === k.template)?.id || k.template); setEntered(true);"));
  // the landing's reel names what is playing by its hero
  assert.ok(ui.includes("const playing = reelKey ? heroes.find((h) => h.media === reelKey) : null;") && ui.includes("onClick={() => enterFormat(playing.id)}"));
});

test("every hero has its poster files, and every name and line is translated", () => {
  const loops = ui.slice(ui.indexOf("const LOOP_KEYS = ["), ui.indexOf("];", ui.indexOf("const LOOP_KEYS = [")));
  const talls = ui.slice(ui.indexOf("const TALL_STILLS = new Set(["), ui.indexOf("]);", ui.indexOf("const TALL_STILLS = new Set([")));
  // (2026-11-25: the genres added that day — Comedy, Thriller, Action, Romance, Sci-Fi, Fantasy, Mystery — stand
  //  on their STILL until a real film of each has been made to cut a loop from. So "every hero has a loop" is now
  //  "every hero that has one, has all three files and is listed by the page": film-heroes.ts → LOOP_MEDIA is the
  //  list, and the nine that had a loop before still do. The phone stills are held the same way — TALL_STILL_MEDIA.)
  assert.deepEqual([...LOOP_MEDIA].sort(), ["horror", "horrorstory", "kidsmusicvideo", "kidstv", "moral", "moralstory", "musicvideo", "shortstory", "testmovie"]);
  for (const k of LOOP_MEDIA) assert.ok(loops.includes(`"${k}"`), `${k} is a loop the page lists`);
  for (const k of [...talls.matchAll(/"([^"]+)"/g)].map((m) => m[1])) assert.ok(TALL_STILL_MEDIA.includes(k), `${k}: the page's phone still is one film-heroes.ts knows`);
  for (const h of FILM_HEROES) {
    assert.ok(exists("public", "landing", `film-still-${h.media}.jpg`), `still for ${h.id}`);
    if (LOOP_MEDIA.includes(h.media)) for (const f of [`film-loop-${h.media}.mp4`, `film-loop-${h.media}-tall.mp4`, `film-loop-${h.media}.jpg`]) assert.ok(exists("public", "landing", f), f);
    else assert.ok(!exists("public", "landing", `film-loop-${h.media}.mp4`), `${h.media} has a loop on disk that LOOP_MEDIA does not list`);
    if (TALL_STILL_MEDIA.includes(h.media)) assert.ok(exists("public", "landing", `film-still-${h.media}-tall.jpg`), `tall still for ${h.id}`);
    if (h.told === "narrated") assert.ok(TALL_STILL_MEDIA.includes(h.media), `${h.id}: a strip of three upright pictures cannot be centre-cropped for a phone card`);
    // (re-tightened 2026-11-25, once the page listed the new genres' phone covers: every phone cover there is,
    //  the page SHOWS — a told Story's above all, or a phone card gets the middle panel of its strip)
    if (TALL_STILL_MEDIA.includes(h.media)) assert.ok(talls.includes(`"${h.media}"`), `${h.id}: the page shows its phone cover`);
    if (h.told === "narrated") assert.ok(talls.includes(`"${h.media}"`), `${h.id}: the page shows its phone cover`);
  }
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const h of FILM_HEROES) for (const k of [h.card, h.name, h.kick, h.meta].filter(Boolean)) assert.equal(count(dict, `\n  ${JSON.stringify(k)}:`), 5, k);
  // a poster's two lines fit a phone card (about 45 characters): "…your cast on…" was cut off at 390 px
  for (const h of FILM_HEROES) assert.ok((h.kick + (h.meta ? ` · ${h.meta}` : "")).length <= 45, `${h.name}: ${h.kick} · ${h.meta}`);
});

test("a film named after its idea is cut at a whole word, and says it was cut", async () => {
  const { trimTitle } = await import("../app/lib/text-trim.ts");
  // the Archive showed "Horror Story — two night cleaners at an old theatre find a bride who has be"
  const idea = "two night cleaners at an old theatre find a bride who has been waiting in the royal box since opening night";
  const cut = trimTitle(idea, 60);
  assert.ok(cut.length <= 60 && cut.endsWith("…"), cut);
  assert.ok(idea.startsWith(cut.slice(0, -1)) && idea[cut.length - 1] === " ", "ends on a whole word");
  assert.equal(trimTitle("The Lullaby Ward", 60), "The Lullaby Ward", "a title that fits is untouched");
  assert.equal(trimTitle("  spaced   out  ", 60), "spaced out");
  assert.equal(trimTitle("", 60), "");
  assert.ok(read("app", "lib", "narrated-story.server.ts").includes("${trimTitle(treatment.title || opts.topic || \"a story\", 60)}`,"));
  assert.ok(read("app", "lib", "film-dialogue.server.ts").includes("${trimTitle(treatment.title || opts.topic || \"dialogue scene\", 60)}`,"));
});

test("an acted film's badge in the Archive is its poster's name too", () => {
  // Under "Moral Film — The Wallet at the Market" the badge read "Moral Story · Kling · 16:9" (2026-11-23):
  // the badge named the engine's template, the title named the hero.
  const arch = read("app", "routes", "web.archive.tsx");
  assert.ok(arch.includes('return `${heroName(tk, false, names[tk] || "Short Film")} · ${eng === "kling3" ? "Kling" : "Veo"}${ar}`;'));
  assert.equal(heroName("moral", false, "Moral Story"), "Moral Film");
  assert.equal(heroName("horror", false, "Horror Story"), "Horror Film");
  assert.equal(heroName("testmovie", false, "Short Film"), "Drama Film", "the Short Film is Drama since 2026-11-25");
  assert.equal(heroName("comedy", false, "Comedy Film"), "Comedy Film");
  assert.equal(heroName("scifi", true, "Sci-Fi Film"), "Sci-Fi Story", "a told one is a Story, whatever its template is called");
  assert.equal(heroName("kidstv", false, "Kids Cartoon"), "Kids Cartoon");
  assert.equal(heroName("kidsmusic", false, "Kids Music Video"), "Kids Music Video", "a template with no hero keeps its own name");
});

/* The owner, 2026-11-24, with a photo of the grid (a Story beside its Film beside the next Story): "Narrated
 * and acted need segregated in an attractive way my friend, currently it's a bit confusing without clicking
 * through". */
test("the posters stand on three shelves — told, acted, sung — and each says what its posters share (and the told ones again, on the still shelf)", () => {
  const shelves = heroShelves(FILM_HEROES);
  // (2026-11-26, the still tier — the owner: "Maybe just make it an additional tier on the actual movie maker (would
  //  look like more options)": "Still Stories" stands right after the Stories, re-listing them on their cheapest rung)
  assert.deepEqual(shelves.map((s) => [s.key, s.name, s.tag]), [["told", "Stories", "Narrated"], ["still", "Still Stories", "Cheapest"], ["acted", "Films", "Acted"], ["sung", "Music videos", "Sung"]]);
  // THE GENRES ARE MOVIE CATEGORIES. The owner, 2026-11-25: "Our genres need to be movie categories (drama,
  // horror, comedy, etch)". The shelves read "Moral Story, Horror Story, Short Story" and "Kids Cartoon, Moral
  // Film, Horror Film, Short Film" — our formats. Now each is a film shelf, in a film shelf's order, and the WORD
  // on a poster is its category (the shelf says how it is told); the Archive's name still says Film or Story.
  // (the still shelf's posters are the Stories', in the same order: the same row of genres, on the cheapest rung)
  assert.deepEqual(shelves.map((s) => s.heroes.map((h) => h.card)), [
    ["Drama", "Comedy", "Horror", "Thriller", "Romance", "Sci-Fi", "Fantasy", "Mystery", "Moral"],
    ["Drama", "Comedy", "Horror", "Thriller", "Romance", "Sci-Fi", "Fantasy", "Mystery", "Moral"],
    ["Drama", "Comedy", "Horror", "Thriller", "Action", "Romance", "Sci-Fi", "Fantasy", "Mystery", "Moral", "Kids Cartoon"],
    ["Music Video", "Kids Music Video"],
  ]);
  assert.deepEqual(shelves.map((s) => s.heroes.map((h) => h.name)), [
    ["Drama Story", "Comedy Story", "Horror Story", "Thriller Story", "Romance Story", "Sci-Fi Story", "Fantasy Story", "Mystery Story", "Moral Story"],
    ["Drama Story", "Comedy Story", "Horror Story", "Thriller Story", "Romance Story", "Sci-Fi Story", "Fantasy Story", "Mystery Story", "Moral Story"],
    ["Drama Film", "Comedy Film", "Horror Film", "Thriller Film", "Action Film", "Romance Film", "Sci-Fi Film", "Fantasy Film", "Mystery Film", "Moral Film", "Kids Cartoon"],
    ["Music Video", "Kids Music Video"],
  ]);
  assert.deepEqual(shelves.map((s) => s.heroes.map((h) => h.id)), [
    ["shortstory", "comedy", "horror", "thriller", "romance", "scifi", "fantasy", "mystery", "moral"],
    ["shortstory", "comedy", "horror", "thriller", "romance", "scifi", "fantasy", "mystery", "moral"],
    ["testmovie", "comedyfilm", "horrorfilm", "thrillerfilm", "actionfilm", "romancefilm", "scififilm", "fantasyfilm", "mysteryfilm", "moralfilm", "kidstv"],
    ["musicvideo", "kidsmusicvideo"],
  ]);
  // every poster on exactly one WAY shelf (told, acted, sung — how it is made); a way shelf holds one way of telling
  // and nothing else. The still shelf is a RUNG shelf: it re-lists the Stories, and adds no hero.
  const way = shelves.filter((s) => s.key !== "still");
  assert.deepEqual(way.map((s) => s.key), ["told", "acted", "sung"]);
  assert.equal(way.flatMap((s) => s.heroes).length, FILM_HEROES.length);
  assert.equal(new Set(way.flatMap((s) => s.heroes.map((h) => h.id))).size, FILM_HEROES.length);
  assert.ok(way[0].heroes.every((h) => h.told === "narrated") && way[1].heroes.every((h) => h.told === "acted") && way[2].heroes.every((h) => h.told === null));
  assert.deepEqual(shelves[1].heroes, shelves[0].heroes, "the still shelf re-lists the Stories");
  // the line under each name is what nobody should have to click to learn
  // (the Stories' line said "ready in minutes" until 2026-11-25; every poster on it still says "narrated in minutes".
  //  On 2026-11-25 it named BOTH rungs of a told story — the owner: "we also need the timeless pictures with narration
  //  as an extremely cheap base tier". Since 2026-11-26 the still rung has a shelf of its own, which says it, so the
  //  Stories say moving pictures again: two headings in a row both saying "or cheaper stills" is noise.)
  assert.ok(/narrator/i.test(shelves[0].line) && /moving/.test(shelves[0].line) && !/still/.test(shelves[0].line) && !/cheaper/.test(shelves[0].line));
  assert.ok(/narrator/i.test(shelves[1].line) && /still/.test(shelves[1].line) && /move/.test(shelves[1].line));
  assert.ok(shelves[0].heroes.every((h) => /minutes/.test(h.meta)), "how soon a story is ready is said on each of its posters");
  // (two lines of a phone's heading at most, as the line it replaced: "…moving or still pictures · stills are cheapest"
  //  ran to three at 390 px, seen on the TEST page)
  for (const sh of shelves) assert.ok(sh.line.length <= 58, `${sh.name}: a heading's line, not a paragraph`);
  assert.ok(/actors/i.test(shelves[2].line) && /camera/.test(shelves[2].line));
  assert.ok(/sings/.test(shelves[3].line));
  // a page that offers fewer formats shows fewer shelves — never an empty one
  assert.deepEqual(heroShelves(FILM_HEROES.filter((h) => h.told !== "acted")).map((s) => s.key), ["told", "still", "sung"]);
  assert.deepEqual(heroShelves(FILM_HEROES.filter((h) => h.told !== "narrated")).map((s) => s.key), ["acted", "sung"], "no Stories, no still shelf");
  assert.deepEqual(heroShelves([]), []);

  // THE PAGE: a heading per shelf (an icon, the name, the line, a one-word tag), then that shelf's posters
  const ui = fs.readFileSync(new URL("../app/routes/web.film.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(ui.includes("{heroShelves(heroes, { still: d.storyMotion }).map((sh) => ("));
  assert.ok(ui.includes("<section key={sh.key} className={`fs-shelf is-${sh.key}`} aria-labelledby={`fs-shelf-${sh.key}`}>"));
  assert.ok(ui.includes("<h2 className=\"fs-shelf-name\" id={`fs-shelf-${sh.key}`}>{t(sh.name)}</h2>"));
  assert.ok(ui.includes("<span>{t(sh.line)}</span>") && ui.includes("<em className=\"fs-shelf-tag\">{t(sh.tag)}</em>"));
  assert.ok(ui.includes("<div className={`fs-fmtgrid${anim === \"in\" ? \" throw\" : \"\"}`} role=\"tablist\" aria-label={t(sh.name)}>"), "each shelf is its own list of formats");
  assert.ok(ui.includes("{sh.heroes.map((h) => ("));
  // each shelf has its own accent, and the trays fall away when a format is entered (the chosen poster flies)
  for (const k of [".fs-shelf.is-told{--shelf:", ".fs-shelf.is-still{--shelf:", ".fs-shelf.is-acted{--shelf:", ".fs-shelf.is-sung{--shelf:", ".fs-shelves.throw .fs-shelf{background:transparent;border-color:transparent;}"]) assert.ok(ui.includes(k), k);
  // four to a row on a wide screen: the four Films stand in one line
  assert.ok(ui.includes("@media(min-width:980px){.fs-shelf .fs-fmtgrid{grid-template-columns:repeat(4,minmax(0,1fr));}}"));
  // every word on the headings is in all five languages
  const dict = fs.readFileSync(new URL("../app/lib/ui-i18n-dict.ts", import.meta.url), "utf8");
  for (const sh of shelves) for (const k of [sh.name, sh.tag, sh.line]) assert.ok(dict.split(`${JSON.stringify(k)}:`).length - 1 >= 5, k);
});
