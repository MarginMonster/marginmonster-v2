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
import { FILM_HEROES, LOOP_MEDIA, TALL_STILL_MEDIA, heroById, heroName, heroOf, heroShelves, heroesFor, homeRows, rowOfWay, CAUGHT_ON_CAM, wayParamOf } from "../app/lib/film-heroes.ts";

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
  // (…and the six anime styles, 2026-11-26, which follow them — a page that is offered their templates: an operator's)
  const anime = ["animedream", "animeretro", "animeneon", "animesky", "animeink", "animepastel"];
  assert.deepEqual(heroesFor([...all, ...genres, ...anime], ["horror", "moral", "kidstv", "testmovie", ...genres, ...anime]).map((h) => h.id), FILM_HEROES.map((h) => h.id));
  assert.deepEqual(FILM_HEROES.slice(-6).map((h) => h.id), anime);
  // a page that is not offered them (every member's, until the owner prices anime) has no anime hero at all
  assert.ok(!heroesFor([...all, ...genres], ["horror", "moral", "kidstv", "testmovie", ...genres]).some((h) => h.shelf));
  // a template that cannot be narrated offers no told hero; a template the account lacks offers none at all
  assert.deepEqual(heroesFor(all, ["moral"]).map((h) => h.id), ["musicvideo", "kidsmusicvideo", "testmovie", "horrorfilm", "moral", "moralfilm", "kidstv"]);
  assert.deepEqual(heroesFor(["musicvideo"], ["horror"]).map((h) => h.id), ["musicvideo"]);
});

test("the home shows a tile per FORMAT, and opening one sets the format AND how it is told", () => {
  assert.ok(ui.includes("const heroes = heroesFor(d.templates.map((x) => x.key), d.narratable || []);"));
  // (2026-11-26, that evening — THE ROWS: no genre on the home. A tile is a format — "Narrated Video", "Acted Film" — and
  //  the genre is the builder's first card; a tile shows its name on its picture and its one short line under it, and a
  //  screen reader hears its whole line)
  const grid = ui.slice(ui.indexOf("{row.tiles.map((w) => {"), ui.indexOf("{row.cameras?.map((c) => ("));
  assert.ok(grid.includes("onClick={() => openTile(w)}") && grid.includes("<b>{t(w.name)}</b>") && grid.includes("<span className=\"fs-fmt-sub\">{t(w.short)}</span>"));
  assert.ok(grid.includes("aria-label={[t(w.name), t(w.line), w.tag ? t(w.tag) : \"\", w.only ? t(\"Only on EasyMode\") : \"\"].filter(Boolean).join(\" · \")}"));
  assert.ok(!grid.includes("h.card") && !ui.includes("{sh.heroes.map((h) => ("), "no genre poster on the home");
  // one tap: the tile's hero — the genre the guide box's idea names, else its first — on the tile's rung
  assert.ok(ui.includes("const openTile = (w: HomeTile) => { setRingRow(null); enterFormat(tileHero(w), w.rung); };"));
  assert.ok(!ui.includes("{d.templates.map((x) => {\n              const m = FMT["), "the grid is no longer one poster per template");
  const sw = ui.slice(ui.indexOf("const switchHero = (id: string) => {"), ui.indexOf("const switchHero = (id: string) => {") + 1100);
  assert.ok(sw.includes("const openNarrated = !!nt?.dialogue && h.told === \"narrated\" && (d.narratable || []).includes(h.tmpl);"));
  assert.ok(sw.includes("setHeroId(h.id);") && sw.includes("setTemplate(h.tmpl);") && sw.includes("setTold(openNarrated ? \"narrated\" : \"acted\");"));
  // its length and shape are set with it: the effect that follows `told` does not run when two heroes in a row are told the same way
  assert.ok(sw.includes("openNarrated ? d.narratedScenes.def : (nt?.defaultScenes || 6)"));
  assert.ok(sw.includes("if (nt?.dialogue) setFilmAspect(openNarrated ? \"9:16\" : \"16:9\");"));
  // two heroes can share a template, so "the same one again" is judged on the hero (and since 2026-11-26 a told
  // hero opened from a tile with a rung — Narrated Video, Narrated Pictures — is opened on that rung, after switchHero's reset)
  assert.ok(ui.includes("window.setTimeout(() => { if (key !== heroId) switchHero(key); if (rung) setPictures(rung); setEntered(true); setAnim(\"\"); setZoomKey(null); }, reduce ? 0 : 400);"));
  assert.ok(!ui.includes("switchTemplate("));
});

test("there is no Acted / Narrated switch in the builder", () => {
  assert.ok(!ui.includes("tapStory(\"told\")") && !ui.includes("storyCard === \"told\"") && !ui.includes("aria-pressed={narrated}") && !ui.includes("aria-pressed={!narrated}"));
  assert.ok(!ui.includes("setTold(\"acted\")") && !ui.includes("setTold(\"narrated\")"), "only opening a hero decides how it is told");
  assert.equal(count(ui, "setTold("), 1);
  // the steps count on without it: Cast 1, Length 2, Shape 3, Captions 4, Narrator/Engine 5 — and from 2 when the GENRE
  // card stands first (2026-11-26: the genre is a setup step — `stepAt`, tests/film-genre-setup.test.ts)
  for (const [card, n] of [["cast", 1], ["length", 2], ["shape", 3], ["captions", 4], ["voice", 5]] as const) {
    assert.ok(ui.includes(`{storyDone.${card} ? <Ico n="check" size={13} /> : ${n} + stepAt}</span>`), `${card} is step ${n}`);
  }
  assert.ok(ui.includes("{storyDone.genre ? <Ico n=\"check\" size={13} /> : 1}</span>"));
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
test("the WAYS — every hero on exactly one — are what the home's tiles and the builder's Genre card are made of", () => {
  // (2026-11-24, the owner: "Narrated and acted need segregated in an attractive way" — the shelves. 2026-11-26, of the
  //  Stories and the Still Stories showing the same nine posters: "This has become repetitive and unorganized and
  //  confusing"; he picked "A": big WAY cards, the ladder then "Only on EasyMode", and ONE row of the chosen way's posters.
  //  Then: "I don't want to lose our distinctive categories like caught on cam, found footage, and our other uniques" —
  //  "Those need to be on display". That evening: "I liked when it was rows designated (the genere tiles are what
  //  complicated things)" — the cards and the chosen way's row are gone, and a way is a TILE on the rows: its name, tag,
  //  short line and picture; its heroes are the genres its builder's first card offers.)
  const shelves = heroShelves(FILM_HEROES);
  // (the ladder's NAMES are his hierarchy in his words — "narrated with stills / … stills to video … / acted" — after his
  //  phone photo: "Picture book sounds like a physical book / story / film come across as confusing", 2026-11-26)
  assert.deepEqual(shelves.map((s) => [s.key, s.name, s.tag]), [["still", "Narrated Pictures", "Cheapest"], ["told", "Narrated Video", "Most popular"], ["acted", "Acted Film", "Premium"], ["anime", "Anime", "New"], ["kids", "Kids", "For little ones"], ["sung", "Music Video", "Sung"]]);
  // …and every one says what it is on a phone too: a SHORT line, a few words (the line under its tile)
  assert.deepEqual(shelves.map((s) => s.short), ["Still images, read aloud", "Every scene moves", "Characters talk on camera", "Hand-drawn, six styles", "Cartoons & sing-alongs", "Your artist sings"]);
  for (const sh of shelves) assert.ok(sh.short.length <= 26, sh.short);
  // (the ladder / "Only on EasyMode" grouping went with the ways' cards; what to do in the Genre panel is each way's own)
  assert.ok(shelves.every((s) => !("group" in s)));
  assert.deepEqual(shelves.map((s) => s.pick), ["Pick a genre", "Pick a genre", "Pick a genre", "Pick a style", "Pick one", "Pick one"]);
  // THE GENRES ARE MOVIE CATEGORIES (the owner, 2026-11-25): the WORD on a poster is its category; the Archive's name says
  // Film or Story. Picture Book's posters are the Story's, in the same order, on the cheapest rung.
  assert.deepEqual(shelves.map((s) => s.heroes.map((h) => h.card)), [
    ["Drama", "Comedy", "Horror", "Thriller", "Romance", "Sci-Fi", "Fantasy", "Mystery", "Moral"],
    ["Drama", "Comedy", "Horror", "Thriller", "Romance", "Sci-Fi", "Fantasy", "Mystery", "Moral"],
    ["Drama", "Comedy", "Horror", "Thriller", "Action", "Romance", "Sci-Fi", "Fantasy", "Mystery", "Moral"],
    ["Dream", "Retro", "Neon City", "Skyglow", "Dark Ink", "Pastel Days"],
    ["Kids Cartoon", "Kids Music Video"],
    ["Music Video"],
  ]);
  assert.deepEqual(shelves.map((s) => s.heroes.map((h) => h.id)), [
    ["shortstory", "comedy", "horror", "thriller", "romance", "scifi", "fantasy", "mystery", "moral"],
    ["shortstory", "comedy", "horror", "thriller", "romance", "scifi", "fantasy", "mystery", "moral"],
    ["testmovie", "comedyfilm", "horrorfilm", "thrillerfilm", "actionfilm", "romancefilm", "scififilm", "fantasyfilm", "mysteryfilm", "moralfilm"],
    ["animedream", "animeretro", "animeneon", "animesky", "animeink", "animepastel"],
    ["kidstv", "kidsmusicvideo"],
    ["musicvideo"],
  ]);
  // every poster on exactly ONE way (Picture Book is a RUNG: it re-lists the Story's heroes and adds none)
  const way = shelves.filter((s) => s.key !== "still");
  assert.deepEqual(way.map((s) => s.key), ["told", "acted", "anime", "kids", "sung"]);
  assert.equal(way.flatMap((s) => s.heroes).length, FILM_HEROES.length);
  assert.equal(new Set(way.flatMap((s) => s.heroes.map((h) => h.id))).size, FILM_HEROES.length);
  assert.deepEqual(shelves[0].heroes, shelves[1].heroes, "Picture Book re-lists the Story's heroes");
  assert.equal(shelves[0].rung, "still");
  assert.equal(shelves[1].rung, "moving");
  // the line on each card is what nobody should have to click to learn
  const line = (k: string) => shelves.find((s) => s.key === k)!.line;
  assert.ok(/narrator/i.test(line("told")) && /moving/.test(line("told")) && !/still/.test(line("told")));
  assert.ok(/narrator/i.test(line("still")) && /still/.test(line("still")) && /move/.test(line("still")));
  assert.ok(/narrator/i.test(line("anime")) && /hand-drawn anime/.test(line("anime")));
  assert.ok(/actors/i.test(line("acted")) && /camera/.test(line("acted")));
  assert.ok(/sings/.test(line("sung")));
  assert.ok(shelves[1].heroes.every((h) => /minutes/.test(h.meta)), "how soon a story is ready is still each poster's note (its screen-reader name)");
  for (const sh of shelves) assert.ok(sh.line.length <= 58, `${sh.name}: a card's line, not a paragraph`);
  // where nothing can move, there is no Picture Book: the Story says stills and shows no motion (Picture Book's art)
  const flat = heroShelves(FILM_HEROES, { still: false });
  assert.deepEqual(flat.map((s) => s.key), ["told", "acted", "anime", "kids", "sung"]);
  assert.equal(flat[0].line, line("still"));
  assert.equal(flat[0].short, shelves[0].short, "…and its tile's short line too: \"Every scene moves\" would be untrue there");
  assert.deepEqual(flat[0].art, shelves[0].art);
  // a page that offers fewer formats shows fewer ways — never an empty one
  assert.deepEqual(heroShelves(FILM_HEROES.filter((h) => !h.shelf)).map((s) => s.key), ["still", "told", "acted", "kids", "sung"], "no anime template offered, no Anime card");
  assert.deepEqual(heroShelves(FILM_HEROES.filter((h) => h.told !== "narrated")).map((s) => s.key), ["acted", "kids", "sung"], "no Stories, no Picture Book");
  assert.deepEqual(heroShelves([]), []);
  // CAUGHT ON CAM: Found Footage's cameras, named as its builder names them — and its ROW's words (the way card's art,
  // tag and lines went with the card)
  assert.deepEqual(CAUGHT_ON_CAM.cameras.map((c) => c.key), ["house", "bodycam", "phone", "camcorder"]);
  assert.deepEqual(CAUGHT_ON_CAM.cameras.map((c) => c.name), ["House camera", "Body cam", "Phone", "Camcorder"]);
  assert.deepEqual(Object.keys(CAUGHT_ON_CAM), ["key", "name", "line", "cameras"]);
  assert.deepEqual([CAUGHT_ON_CAM.name, CAUGHT_ON_CAM.line], ["Caught on Cam", "Found footage"]);
  // every way's art is a real file, and none is a -tall Story file with captions burnt into it
  for (const a of shelves.map((s) => s.art)) {
    for (const p of [a.still, a.clip].filter(Boolean) as string[]) assert.ok(exists("public", ...p.replace(/^\//, "").split("/")), p);
    assert.ok(!/film-(?:loop|still)-(?:horrorstory|shortstory|moralstory)-tall/.test(`${a.still} ${a.clip || ""}`), a.still);
  }
  assert.equal(wayParamOf("Cam"), "cam");
  assert.equal(wayParamOf("still"), "still");
  assert.equal(wayParamOf("stories"), null);

  // every word of the ways is in all five languages (a tile says its name, tag and short line; a screen reader its line;
  // the Genre panel its pick)
  const dict = fs.readFileSync(new URL("../app/lib/ui-i18n-dict.ts", import.meta.url), "utf8");
  for (const sh of shelves) for (const k of [sh.name, sh.tag, sh.line, sh.pick, sh.short]) assert.ok(dict.split(`${JSON.stringify(k)}:`).length - 1 >= 5, k);
});

/* THE ROWS (2026-11-26, that evening). The owner, with two photos of the ways on the live home: "Because this setup is hard
 * to understand narrated/acted being at the top of the selection looks odd and easy to misunderstand. I liked when it was
 * rows designated (the genere tiles are what complicated things)". */
test("THE ROWS: Stories · Films · Music · Caught on Cam — each designated by how it is told, a few FORMAT tiles, never a genre", () => {
  const all = homeRows(heroShelves(FILM_HEROES), FILM_HEROES, { lyric: true, cam: true });
  assert.deepEqual(all.map((r) => [r.key, r.name, r.line, !!r.only]), [
    ["told", "Stories", "A narrator tells it", false],
    ["acted", "Films", "Actors speak on camera", false],
    ["sung", "Music", "Sung", false],
    ["cam", "Caught on Cam", "Found footage", true],
  ]);
  const tiles = (rows: typeof all) => rows.map((r) => r.tiles.map((w) => [w.key, w.name, w.short, w.tag || "", !!w.only]));
  assert.deepEqual(tiles(all), [
    [["told", "Narrated Video", "Every scene moves", "Most popular", false], ["still", "Narrated Pictures", "Still images, read aloud", "Cheapest", false], ["anime", "Anime", "Hand-drawn, six styles", "New", true]],
    [["acted", "Acted Film", "Characters talk on camera", "Premium", false], ["kidstv", "Kids Cartoon", "A cartoon for little ones", "", false]],
    [["musicvideo", "Music Video", "Your artist sings", "", false], ["kidsmusicvideo", "Kids Music Video", "A sing-along for little ones", "", false], ["lyricvideo", "Lyric Video", "Your song, words on screen", "", false]],
    [],
  ]);
  // Caught on Cam's row is its cameras
  assert.deepEqual(all[3].cameras?.map((c) => c.key), ["house", "bodycam", "phone", "camcorder"]);
  // each tile opens what its way holds: the genres (an anime's styles) for the builder's first card, or its one format
  const by = Object.fromEntries(all.flatMap((r) => r.tiles).map((w) => [w.key, w]));
  assert.deepEqual(by.told.heroes, heroShelves(FILM_HEROES).find((s) => s.key === "told")!.heroes);
  assert.deepEqual(by.still.heroes, by.told.heroes, "Narrated Pictures opens the very same stories, on its rung");
  assert.deepEqual([by.told.rung, by.still.rung, by.acted.rung, by.anime.rung], ["moving", "still", undefined, undefined]);
  assert.deepEqual([by.told.heroes[0].id, by.acted.heroes[0].id, by.anime.heroes[0].id], ["shortstory", "testmovie", "animedream"], "Drama, Drama, the first style");
  assert.deepEqual(["kidstv", "musicvideo", "kidsmusicvideo", "lyricvideo"].map((k) => by[k].heroes.map((h) => h.id)), [["kidstv"], ["musicvideo"], ["kidsmusicvideo"], ["lyricvideo"]]);
  // the picture of each: the way's art where it IS one of its heroes' phone posters (drawn as that poster: its phone cut —
  // the very file — and its wide cut on a wide screen), else the art itself; never a -tall Story loop (captions burnt in)
  assert.deepEqual(Object.fromEntries(Object.entries(by).map(([k, w]) => [k, "media" in w.cover ? w.cover.media : w.cover.art.still])), {
    told: "/landing/film-loop-horrorstory.jpg", still: "fantasystory", anime: "animesky", acted: "testmovie", kidstv: "kidstv",
    musicvideo: "musicvideo", kidsmusicvideo: "kidsmusicvideo", lyricvideo: "lyricvideo",
  });
  assert.deepEqual(by.lyricvideo.cover, { media: "lyricvideo", loop: true, tall: true });
  for (const k of ["still", "acted", "anime"] as const) {
    const sh = heroShelves(FILM_HEROES).find((s) => s.key === k)!;
    assert.equal(sh.art.still, `/landing/film-still-${(by[k].cover as { media: string }).media}-tall.jpg`, `${k}: the way card's own picture, on a phone`);
  }
  // A MEMBER (no Lyric Video, no Caught on Cam, no anime templates): the same rows less those
  const member = FILM_HEROES.filter((h) => !h.shelf);
  const rows = homeRows(heroShelves(member), member);
  assert.deepEqual(rows.map((r) => r.key), ["told", "acted", "sung"]);
  assert.deepEqual(tiles(rows)[0].map((w) => w[0]), ["told", "still"]);
  assert.deepEqual(tiles(rows)[2].map((w) => w[0]), ["musicvideo", "kidsmusicvideo"]);
  // where pictures cannot move: no Narrated Pictures, and the Narrated Video says what it is told over then, still
  const flat = homeRows(heroShelves(member, { still: false }), member);
  assert.deepEqual(tiles(flat)[0], [["told", "Narrated Video", "Still images, read aloud", "Most popular", false]]);
  assert.deepEqual(flat[0].tiles[0].cover, { media: "fantasystory" }, "and shows no motion");
  // a row with nothing on it is not shown
  assert.deepEqual(homeRows([], []), []);

  // THE PAGE: one map draws every row, in the shelves' own markup — an icon chip, its name, its line — and the tiles
  const ui = fs.readFileSync(new URL("../app/routes/web.film.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.equal(ui.split("heroShelves(").length - 1, 1, "one call");
  assert.ok(ui.includes("const shelves = heroShelves(heroes, { still: d.storyMotion });"));
  assert.ok(ui.includes("const rows = homeRows(shelves, heroes, { lyric: d.lyricVideo, cam: d.foundFootage });"), "the Lyric Video and Caught on Cam are an operator's, as their builders are");
  assert.equal(ui.split("{rows.map((row) => (").length - 1, 1);
  assert.ok(ui.includes("<section key={row.key} id={`fs-row-${row.key}`} className={`fs-shelf is-${row.key}${ringRow === row.key ? \" is-ring\" : \"\"}`} aria-labelledby={`fs-shelf-${row.key}`}>"));
  assert.ok(ui.includes("<span className=\"fs-shelf-ico\" aria-hidden=\"true\"><Ico n={ROW_ICON[row.key]} size={18} /></span>"));
  assert.ok(ui.includes("const ROW_ICON: Record<HomeRowKey, string> = { told: \"book\", acted: \"film\", sung: \"music\", cam: \"camera\" };"));
  assert.ok(ui.includes("<h2 className=\"fs-shelf-name\" id={`fs-shelf-${row.key}`}>{t(row.name)}</h2>"));
  // ✦ Only on EasyMode, on display: after Caught on Cam's line, and over the Anime tile's name
  assert.ok(ui.includes("<span>{t(row.line)}{row.only ? <> · <b className=\"fs-only\"><span aria-hidden=\"true\">✦</span> {t(\"Only on EasyMode\")}</b></> : null}</span>"));
  assert.ok(ui.includes("{w.only ? <span className=\"fs-fmt-kick is-only\">✦ {t(\"Only on EasyMode\")}</span> : null}"));
  assert.ok(ui.includes("{w.tag ? <span className=\"fs-fmt-tag\">{t(w.tag)}</span> : null}"));
  // the accents: Stories gold, Films green, Music violet, Caught on Cam red
  for (const k of [".fs-shelf.is-told{--shelf:#A8741B;", ".fs-shelf.is-acted{--shelf:#0C7A46;", ".fs-shelf.is-sung{--shelf:#6B4BC8;", ".fs-shelf.is-cam{--shelf:#B83A28;", ".fs-shelves.throw .fs-shelf{background:transparent;border-color:transparent;}"]) assert.ok(ui.includes(k), k);
  // …and none for a way that is no row (the still, anime and kids shelves were rows of their own until that evening)
  for (const k of [".fs-shelf.is-still", ".fs-shelf.is-anime", ".fs-shelf.is-kids"]) assert.ok(!ui.includes(k), k);
  // every word of the rows is in all five languages
  const dict = fs.readFileSync(new URL("../app/lib/ui-i18n-dict.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  for (const k of [...all.flatMap((r) => [r.name, r.line, ...r.tiles.flatMap((w) => [w.name, w.short, w.line, w.tag || ""])]), "Only on EasyMode"].filter(Boolean)) {
    assert.ok(dict.split(`\n  ${JSON.stringify(k)}: `).length - 1 >= 5, k);
  }
});

test("NO WAYS GRID, NO CHOSEN-WAY ROW: the cards, their row and their code and styles are gone", () => {
  const ui = fs.readFileSync(new URL("../app/routes/web.film.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  for (const gone of ["wayCards", "wayOn", "wayHeld", "pickWay", "wayGroup", "wayRow", "WayCover", "WAY_STEP", "WAY_ICON", "guessKey", "fs-ways", "fs-way", "fsWayDrift", "fsWayPan", "\"How it's told\"", "\"Pick what to make\"", "\"Tap it to start\""]) {
    assert.ok(!ui.includes(gone), gone);
  }
  // one list of rows in the markup, and a link's way (?way=) is a ROW brought into view and ringed — never entered
  assert.equal(ui.split('className={`fs-shelves${anim === "in" ? " throw" : ""}`}').length - 1, 1);
  assert.ok(ui.includes("const [ringRow, setRingRow] = useState<HomeRowKey | null>(() => rowOfWay(rows, d.openWay));"));
  assert.ok(ui.includes("window.requestAnimationFrame(() => document.getElementById(`fs-row-${ringRow}`)?.scrollIntoView({ block: \"start\", behavior: still ? \"auto\" : \"smooth\" }));"));
  assert.ok(ui.includes(".fs-shelf.is-ring{outline:3px solid var(--shelf);outline-offset:4px;}"), "an outline: the ticket's own shadow is not touched");
  const rows = homeRows(heroShelves(FILM_HEROES), FILM_HEROES, { cam: true });
  assert.deepEqual((["still", "told", "anime", "acted", "kids", "sung", "cam"] as const).map((w) => rowOfWay(rows, w)), ["told", "told", "told", "acted", "acted", "sung", "cam"]);
  assert.equal(rowOfWay(homeRows(heroShelves(FILM_HEROES), FILM_HEROES), "cam"), null, "no Caught on Cam row for a member");
  assert.equal(rowOfWay(rows, null), null);
});
