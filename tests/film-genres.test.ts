/* THE GENRES ARE MOVIE CATEGORIES — and the writer is never handed nothing.
 *
 * The owner, 2026-11-25: "Our genres need to be movie categories (drama, horror, comedy, etch)". The shelves
 * carried our own formats ("Short Film", "Moral Story", "Horror Story"). And of the writer, the same morning:
 * "the "write your dialogue" button generates a random scene and dialogue, atleast need a starter "nudge" couple
 * sentences to hand to the writer".
 *
 * So there is one table (app/lib/film-genres.ts) for every story genre — the word on its card, its nine places,
 * eight starter ideas and four director's notes — seven new genres are templates of the engine made like the
 * Short Film, every hero has a cover, and an idea of fewer than three words becomes a starter.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DRAMA_BRIEF, FILM_GENRES, GENRE_FILMS, IDEA_MIN_WORDS, backdropsOf, categoryOf, dealStarters, genreOf, genreTemplate, ideaWords, notesOf, nudgeFor, startLine, startersOf,
} from "../app/lib/film-genres.ts";
import { FILM_HEROES, FORMER_HERO_NAMES, LOOP_MEDIA, TALL_STILL_MEDIA, heroName, heroOf, heroShelves } from "../app/lib/film-heroes.ts";
import { isFormatName } from "../app/lib/film-series.ts";
import { coverKind, coverWords } from "../app/lib/archive-cover.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const GENRES = ["testmovie", "comedy", "horror", "thriller", "action", "romance", "scifi", "fantasy", "mystery", "moral", "kidstv"];
const NEW = ["comedy", "thriller", "action", "romance", "scifi", "fantasy", "mystery"];

test("every story genre is in the table, under the word a film shelf would use", () => {
  assert.deepEqual(FILM_GENRES.map((g) => g.tmpl), GENRES, "in the order of the shelf");
  assert.deepEqual(FILM_GENRES.map((g) => g.card), ["Drama", "Comedy", "Horror", "Thriller", "Action", "Romance", "Sci-Fi", "Fantasy", "Mystery", "Moral", "Kids Cartoon"]);
  // the Short Film's template is SHOWN as Drama — its key is what it was
  assert.equal(categoryOf("testmovie"), "Drama");
  assert.equal(categoryOf("scifi"), "Sci-Fi");
  // a format that is not a story genre has no category, no starters — and is offered Drama's places and notes
  for (const k of ["musicvideo", "kidsmusicvideo", "lyricvideo", "nope", "", null, undefined]) {
    assert.equal(genreOf(k), undefined);
    assert.equal(categoryOf(k), "");
    assert.deepEqual(startersOf(k), []);
    assert.equal(backdropsOf(k), backdropsOf("testmovie"));
    assert.equal(notesOf(k), notesOf("testmovie"));
  }
});

test("nine places a genre: one plain word each, which is a word of the place it sets", () => {
  // (the page lights the chip of the place a scene is in by its key as a WHOLE word of the scene's `where` —
  //  web.film.tsx → backdropIs: a lighthouse once lit "Old house", a carpark would have lit "Car" and "Park")
  const lit = (where: string, key: string): boolean => new RegExp(`(^|[^a-z])${key}([^a-z]|$)`, "i").test(where || "");
  for (const g of FILM_GENRES) {
    const b = backdropsOf(g.tmpl);
    assert.equal(b.length, 9, g.tmpl);
    assert.equal(new Set(b.map((x) => x.key)).size, 9, `${g.tmpl}: no key twice`);
    assert.equal(new Set(b.map((x) => x.label)).size, 9, `${g.tmpl}: no label twice`);
    for (const x of b) {
      assert.ok(/^[a-z]+$/.test(x.key), `${g.tmpl}: "${x.key}" is one lower-case word`);
      assert.ok(x.label.length >= 3 && x.label.length <= 16, `${g.tmpl}: ${x.label}`);
      assert.ok(lit(x.where, x.key), `${g.tmpl}: "${x.key}" is a word of "${x.where}"`);
      assert.equal(b.filter((o) => lit(x.where, o.key)).length, 1, `${g.tmpl}: "${x.where}" lights its own chip and no other`);
      assert.ok(x.where.length >= 20 && x.where.length <= 120 && !/[.!?]$/.test(x.where), `${g.tmpl}: ${x.where}`);
      // nothing a picture would have to WRITE (the app's "nothing written" rule)
      assert.ok(!/\b(sign|banner|poster|neon sign that says|label|menu|billboard)\b/i.test(x.where) || x.where === "a highway motel room at night, the neon sign buzzing behind thin curtains", x.where);
    }
  }
  // the four lists the page had are copied key for key, label for label
  assert.deepEqual(backdropsOf("testmovie").map((x) => [x.key, x.label]), [["diner", "Diner"], ["street", "Street"], ["office", "Office"], ["kitchen", "Kitchen"], ["car", "Car"], ["living", "Living room"], ["bar", "Bar"], ["park", "Park"], ["warehouse", "Warehouse"]]);
  assert.deepEqual(backdropsOf("horror").map((x) => [x.key, x.label]), [["house", "Old house"], ["woods", "Woods"], ["hospital", "Hospital"], ["basement", "Basement"], ["cemetery", "Cemetery"], ["motel", "Motel"], ["attic", "Attic"], ["road", "Empty road"], ["chapel", "Chapel"]]);
  assert.deepEqual(backdropsOf("moral").map((x) => [x.key, x.label]), [["home", "At home"], ["school", "School"], ["market", "Market"], ["office", "Office"], ["park", "Park"], ["kitchen", "Kitchen"], ["shop", "Corner shop"], ["bus", "Bus stop"], ["street", "Street"]]);
  assert.deepEqual(backdropsOf("kidstv").map((x) => [x.key, x.label]), [["park", "Park"], ["playground", "Playground"], ["bedroom", "Bedroom"], ["classroom", "Classroom"], ["backyard", "Backyard"], ["beach", "Beach"], ["farm", "Farm"], ["forest", "Forest"], ["kitchen", "Kitchen"]]);
  // …and word for word, for as long as the page still carries its own copy of them (web.film.tsx is to take
  // them from here: `backdropsFor` → `backdropsOf`)
  const ui = read("app", "routes", "web.film.tsx");
  if (ui.includes("const BACKDROPS_BY_FORMAT")) {
    for (const k of ["testmovie", "horror", "moral", "kidstv"]) {
      for (const x of backdropsOf(k)) assert.ok(ui.includes(`{ key: "${x.key}", label: "${x.label}", where: "${x.where}" },`), `${k}: ${x.key} is the page's own, word for word`);
    }
  }
});

test("eight starters a genre: who, where, what goes wrong — in a sentence or two", () => {
  const all = FILM_GENRES.flatMap((g) => g.starters);
  assert.equal(all.length, 88);
  assert.equal(new Set(all).size, 88, "no starter twice, in a genre or across them");
  for (const g of FILM_GENRES) {
    const s = startersOf(g.tmpl);
    assert.equal(s.length, 8, g.tmpl);
    for (const one of s) {
      assert.ok(one.length >= 60 && one.length <= 220, `${g.tmpl} (${one.length}): ${one}`);
      assert.ok(/^[A-Z]/.test(one) && /[.?]$/.test(one), one);
      const sentences = one.split(/[.?!]\s+(?=[A-Z])/).length;
      assert.ok(sentences >= 1 && sentences <= 4, `${sentences} sentences: ${one}`);
      assert.ok(ideaWords(one) >= 12, one);
      // it is an idea, typed into the idea box as it stands: one line, no quotation marks to trip a prompt
      assert.ok(!/["“”\n\r]/.test(one), one);
      // nobody's name in it — not a real person's, a brand's or a show's; and not a cast's either (the maker's cast plays it)
      assert.ok(!/\b(Netflix|Disney|Marvel|Pixar|Uber|Lyft|Amazon|Google|Tesla|Alexa|Siri|IKEA|McDonald|Starbucks|Hogwarts|Sherlock|Dracula)\b/i.test(one), one);
      // NO HEAD-COUNT OF A CROWD (review, 2026-11-25): a dealt starter is the THEME, and the rule said right after it
      // (premise-rules.ts → PREMISE_WINS) holds a story to "as many as it says" — while an acted film is two people
      // in every shot. "…six people were at the table…" asked the writer for both.
      assert.ok(!/\b(three|four|five|six|seven|eight|nine|ten|dozen|\d+) (people|guests|friends|strangers|passengers|children|kids|men|women|of them)\b/i.test(one), one);
    }
  }
  // the two children's genres are for children: nothing frightening, nobody hurt, no grown-up trouble
  for (const k of ["kidstv", "moral"]) for (const one of startersOf(k)) {
    assert.ok(!/\b(dead|dies|died|death|kill|murder|ghost|haunt|blood|gun|knife|police|thief|steal|stolen|drunk|drug|affair|kiss|monster|scream|grave|corpse|weapon)/i.test(one), `${k}: ${one}`);
  }
  // (Kids Cartoon: small animal somebodies and a small, happy problem)
  for (const one of startersOf("kidstv")) assert.ok(/\b(fox|rabbit|bear|duckling|kittens|robot|puppy|hedgehog|mouse|penguin|bunnies|elephant|bird)\b/.test(one), one);
  // what each genre PROMISES is in its starters: no ghost in a thriller (that is Horror), no gunfire in Action
  for (const one of startersOf("thriller")) assert.ok(!/\b(ghost|haunt|spirit|demon|monster|curse)/i.test(one), one);
  for (const one of startersOf("action")) assert.ok(!/\b(gun|shoot|shot|explos|bomb|blood)/i.test(one), one);
  assert.ok(/^Who /.test(startersOf("mystery")[0]), "a mystery opens on its question");
});

test("four director's notes a genre: a word on the button, a sentence for the writer", () => {
  for (const g of FILM_GENRES) {
    const n = notesOf(g.tmpl);
    assert.equal(n.length, 4, g.tmpl);
    assert.equal(new Set(n.map((x) => x.key)).size, 4, g.tmpl);
    assert.equal(new Set(n.map((x) => x.label)).size, 4, g.tmpl);
    for (const x of n) {
      assert.ok(/^[a-z]+$/.test(x.key), x.key);
      assert.ok(x.label.length >= 5 && x.label.length <= 18, `${g.tmpl}: "${x.label}" fits a chip`);
      assert.ok(x.ask.length >= 60 && x.ask.length <= 240 && /[.]$/.test(x.ask) && /\bthis scene\b|\bthe scene\b/.test(x.ask), `${g.tmpl}: ${x.ask}`);
      assert.ok(!/["“”]/.test(x.ask), "it is put inside a prompt as it stands");
    }
    // every genre can be asked for less
    assert.equal(n.filter((x) => x.key === "shorter" && x.label === "Shorter").length, 1, g.tmpl);
  }
  // the genre's own word leads
  assert.deepEqual(notesOf("horror").map((x) => x.label), ["Scarier", "Slower burn", "Shorter", "Add a twist"]);
  assert.equal(notesOf("comedy")[0].label, "Funnier");
  assert.equal(notesOf("romance")[3].label, "End on a gesture");
  // …and a note never asks for what its genre refuses
  assert.ok(/without gore/.test(notesOf("horror")[0].ask));
  assert.ok(/no gunfire and no gore/.test(notesOf("action")[0].ask));
  assert.ok(/never as glow, sparks or light/.test(notesOf("fantasy")[0].ask));
  assert.ok(/nothing scary, nothing mean/.test(notesOf("kidstv")[0].ask));
});

test("a few starters are DEALT: a different few each time, never one twice in a deal", () => {
  for (const g of FILM_GENRES) {
    const firsts = new Set<string>();
    const hands = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const hand = dealStarters(g.tmpl, seed);
      assert.equal(hand.length, 3, "three unless said");
      assert.equal(new Set(hand).size, 3, `${g.tmpl} seed ${seed}: no repeat inside a deal`);
      for (const s of hand) assert.ok(startersOf(g.tmpl).includes(s));
      assert.deepEqual(dealStarters(g.tmpl, seed), hand, "the same seed deals the same hand");
      firsts.add(hand[0]);
      hands.add(hand.join("|"));
    }
    assert.equal(firsts.size, 8, `${g.tmpl}: every starter leads some deal`);
    assert.ok(hands.size >= 40, `${g.tmpl}: ${hands.size} different hands in sixty deals`);
  }
  assert.notDeepEqual(dealStarters("comedy", 1), dealStarters("comedy", 2));
  assert.equal(dealStarters("comedy", 7, 1).length, 1);
  assert.equal(new Set(dealStarters("comedy", 7, 8)).size, 8, "all eight, each once");
  assert.equal(dealStarters("comedy", 7, 20).length, 8, "never more than there are");
  assert.deepEqual(dealStarters("comedy", 7, 0), []);
  assert.deepEqual(dealStarters("musicvideo", 7), [], "a format that is not a story genre has none");
  // any number is a seed
  for (const seed of [0, -5, 1.5, 2 ** 40, NaN]) assert.equal(new Set(dealStarters("horror", seed)).size, 3);
});

test("the starter fallback fires only under three words", () => {
  assert.equal(IDEA_MIN_WORDS, 3);
  // how many words an idea has
  assert.equal(ideaWords(""), 0);
  assert.equal(ideaWords("   "), 0);
  assert.equal(ideaWords("love"), 1);
  assert.equal(ideaWords("haunted lighthouse"), 2);
  assert.equal(ideaWords("a haunted lighthouse"), 3);
  assert.equal(ideaWords("…  !!  —"), 0, "punctuation is not a word");
  assert.equal(ideaWords("dos hermanas"), 2);
  assert.equal(ideaWords("دو بہنیں رات کو"), 4);
  // a language written without spaces is counted two characters to a word: a whole premise is not "one word"
  assert.equal(ideaWords("两个姐妹在老房子里听到敲门声"), 7);
  assert.equal(ideaWords("爱情"), 1);
  assert.equal(ideaWords("老房子"), 2);
  // (Korean puts spaces between its words: counted as written, not two syllables to a word)
  assert.equal(ideaWords("유령 이야기"), 2);
  assert.equal(ideaWords("두 자매가 오래된 집에서"), 4);

  // nothing typed: one of the genre's own starters, word for word
  for (const g of FILM_GENRES) {
    for (const seed of [1, 2, 3, 99]) {
      const n = nudgeFor(g.tmpl, "", seed);
      assert.ok(n && startersOf(g.tmpl).includes(n.nudge) && n.topic === n.nudge && n.typed === "", g.tmpl);
      assert.deepEqual(nudgeFor(g.tmpl, "   ", seed), n, "spaces are nothing");
    }
    assert.ok(new Set(Array.from({ length: 40 }, (_, i) => nudgeFor(g.tmpl, "", i + 1)!.nudge)).size >= 6, `${g.tmpl}: not the same starter every time`);
  }
  // one or two words: still a starter — and the words are not thrown away
  const love = nudgeFor("romance", "love", 5)!;
  assert.ok(startersOf("romance").includes(love.nudge) && love.typed === "love");
  const two = nudgeFor("horror", "haunted lighthouse", 5)!;
  assert.ok(startersOf("horror").includes(two.nudge) && two.typed === "haunted lighthouse");
  // …a word the maker typed that a starter HAS picks that starter, whatever the dice
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const fern = nudgeFor("comedy", "fern", seed)!;
    assert.ok(/\bfern\b/.test(fern.nudge) && fern.typed === "", "the fern one");
    const cabin = nudgeFor("horror", "Cabin!", seed)!;
    assert.ok(/\bcabin\b/.test(cabin.nudge) && cabin.typed === "");
    assert.ok(/\b(train|compartment)\b/.test(nudgeFor("thriller", "night train", seed)!.nudge));
  }
  // (a little word that every starter has does not count as a match)
  assert.equal(nudgeFor("comedy", "the and", 3)!.typed, "the and");
  // (…and punctuation alone is nothing to work in: the writer is handed the starter and no "the maker typed only")
  for (const junk of ["?", "…", "!! —"]) assert.equal(nudgeFor("comedy", junk, 3)!.typed, "", junk);
  // three words or more: the idea stands, untouched
  for (const idea of ["a haunted lighthouse", "two sisters find a key", "两个姐妹在老房子里听到敲门声", "老房子的门"]) for (const g of GENRES) assert.equal(nudgeFor(g, idea, 1), null, idea);
  // a format that is not a story genre is never given one (a music video names its own theme)
  for (const k of ["musicvideo", "kidsmusicvideo", "nope", undefined]) assert.equal(nudgeFor(k, "", 1), null);

  // what the writer is told about a dealt theme
  assert.equal(startLine({ topic: "x", nudge: "x", typed: "" }, false), "", "the starter alone needs no more said");
  const typed = startLine({ topic: "x", nudge: "x", typed: 'my "lighthouse"' }, false);
  assert.ok(typed.startsWith("The maker typed only \"my 'lighthouse'\" — ") && typed.includes("work it into the story") && typed.endsWith("\n"));
  const cast = startLine({ topic: "x", nudge: "x", typed: "" }, true);
  assert.ok(cast.includes("its people ARE the chosen cast below") && cast.includes("keep the theme's place and what goes wrong") && cast.includes("\"the idea\" is this theme with the chosen cast as its people") && cast.endsWith("\n"));
  assert.ok(!cast.includes("THREAT"), "no creature chosen: nothing said of one");
  // a horror's chosen creature is the threat: with people chosen too, they are the starter's people and it is not
  const withThreat = startLine({ topic: "x", nudge: "x", typed: "" }, true, true);
  assert.ok(withThreat.includes("its people ARE the chosen cast below (all but the chosen creature that is the THREAT: it is what threatens them, not one of them) — "));
  // …and with only the creature chosen, the starter's people stand as they are (chosenThreat makes it the threat)
  assert.equal(startLine({ topic: "x", nudge: "x", typed: "" }, false, true), "");
  const both = startLine({ topic: "x", nudge: "x", typed: "love" }, true);
  assert.ok(both.indexOf("The maker typed only") === 0 && both.indexOf("its people ARE the chosen cast") > 0 && count(both, "\n") === 1);
});

test("the fallback is in the one place every unwritten film comes through, and the starter is kept", () => {
  const eng = read("app", "lib", "film-engine.server.ts");
  assert.ok(eng.includes("import { DRAMA_BRIEF, GENRE_FILMS, genreTemplate, nudgeFor, startLine } from \"./film-genres\";"));
  const fn = eng.slice(eng.indexOf("export async function previewFilmTreatment("), eng.indexOf("// ---- Assembly"));
  // never an episode (a series decides what happens next from its own recap), and only a story genre has starters
  // (…with nobody else's character in it, since 2026-11-26 — SPEC-S16, tests/character-mark.test.ts)
  // (…and never the name of a character the maker picked — review of S16a)
  assert.ok(fn.includes("const typedIdea = scrubFranchise((opts.topic || \"\").trim(), keepNames);"));
  assert.ok(fn.includes("const nudged = series ? null : nudgeFor(tmpl.key, typedIdea, Math.floor(Math.random() * 0x7fffffff));"));
  assert.ok(fn.includes("const topic = nudged ? nudged.topic : typedIdea;"));
  assert.ok(fn.indexOf("const series = ") < fn.indexOf("const nudged = ") && fn.indexOf("const picked = ") < fn.indexOf("const nudged = "));
  // said right after the theme, before the rule that holds a story to its idea
  // (only the chosen PEOPLE make the cast the starter's people: a horror's chosen creature is its THREAT — told,
  //  it is still in castChosen, so it is taken out here; review, 2026-11-25)
  assert.ok(fn.includes("events the user did not ask for.\\n${nudged ? startLine(nudged, castChosen.some((c) => !threatNames.includes(c.name)), threatNames.length > 0) : \"\"}${storyFormat ? `${PREMISE_WINS}\\n` : \"\"}`"));
  assert.ok(fn.indexOf("const threatNames = ") < fn.indexOf("startLine(nudged"));
  // the starter rides back on the treatment, for the page to show
  assert.ok(fn.includes("return { title: outTitle, scenes: list, ...(nudged ? { nudge: nudged.nudge } : {}),"));
  assert.ok(eng.includes("  nudge?: string;"));
  // the three callers with no approved script all write through previewFilmTreatment (so none needs its own)
  assert.ok(read("app", "lib", "film-dialogue.server.ts").includes("else treatment = await previewFilmTreatment({ shopId: opts.shopId, template: tmpl.key, topic: opts.topic,"));
  assert.ok(read("app", "lib", "narrated-story.server.ts").includes("else treatment = await previewFilmTreatment({ shopId: opts.shopId, template: tmpl.key, topic: opts.topic,"));
  assert.ok(read("app", "routes", "web.film.tsx").includes("try { treatment = await previewFilmTreatment(args); }"));
});

test("the seven new genres are templates made like the Short Film: live, acted, told, at its lengths", () => {
  assert.deepEqual(GENRE_FILMS.map((g) => g.key), NEW);
  assert.deepEqual(GENRE_FILMS.map((g) => g.name), ["Comedy Film", "Thriller Film", "Action Film", "Romance Film", "Sci-Fi Film", "Fantasy Film", "Mystery Film"]);
  // a stand-in for the Short Film's template: whatever its numbers are (they are another stream's to set), a
  // genre has the same ones — and everything that makes it acted, captioned and live
  const base = { key: "testmovie", name: "Drama Film", brief: "b", sceneHint: "s", musicHint: "m", defaultScenes: 7, minScenes: 3, maxScenes: 31, captions: true, castBible: true, dialogue: true, live: true, faceMood: "a mood that is the base's" };
  for (const g of GENRE_FILMS) {
    const t = genreTemplate(base, g);
    assert.deepEqual([t.key, t.name, t.brief, t.sceneHint, t.musicHint], [g.key, g.name, g.brief, g.sceneHint, g.musicHint]);
    assert.deepEqual([t.defaultScenes, t.minScenes, t.maxScenes, t.captions, t.castBible, t.dialogue, t.live], [7, 3, 31, true, true, true, true], `${g.key} inherits the Short Film's scene counts`);
    assert.equal(t.faceMood, g.faceMood, "the faces are the genre's own, or nobody's — never inherited");
    assert.equal("faceMood" in t, !!g.faceMood);
    // …and so is the world: only a genre that says its world is its own has one (Fantasy)
    assert.equal(genreTemplate({ ...base, ownWorld: true }, g).ownWorld, g.ownWorld);
    assert.equal("ownWorld" in t, !!g.ownWorld);
  }
  assert.equal(base.key, "testmovie", "the base is not changed");
  // THE WIRING (film-engine.server.ts cannot be loaded in a test — it opens the database): each genre is the
  // Short Film's own template spread under its words, added before the list of live templates is taken…
  const eng = read("app", "lib", "film-engine.server.ts");
  const made = "for (const g of GENRE_FILMS) FILM_TEMPLATES[g.key] = genreTemplate(FILM_TEMPLATES.testmovie, g);";
  assert.equal(count(eng, made), 1);
  assert.ok(eng.indexOf(made) > eng.indexOf("export const FILM_TEMPLATES") && eng.indexOf(made) < eng.indexOf("export const LIVE_FILM_TEMPLATES = Object.values(FILM_TEMPLATES).filter((t) => t.live);"));
  // …of a Short Film that is live and acted by the dialogue engine
  const short = eng.slice(eng.indexOf("  testmovie: {\n    key: \"testmovie\","), eng.indexOf("  avatardialogue: {"));
  assert.ok(short.includes("    dialogue: true,\n    live: true,\n  },"));
  assert.ok(short.includes("    name: \"Drama Film\",\n    brief: DRAMA_BRIEF,"), "the Short Film is Drama: its key kept, its brief a drama's");
  // …and each can be told by a narrator, to its own brief
  const told = eng.slice(eng.indexOf("const NARRATED_BRIEF"), eng.indexOf("export const NARRATABLE_KEYS: string[] = Object.keys(NARRATED_BRIEF);"));
  assert.ok(told.includes("  ...Object.fromEntries(GENRE_FILMS.map((g) => [g.key, g.narrated])),\n};"));
  assert.ok(told.includes("  testmovie: \"a short NARRATED DRAMA — "));
  for (const k of ["horror", "moral", "kidstv", "testmovie"]) assert.ok(told.includes(`  ${k}: "`), `${k} is told as it was`);
  // no genre's key is already a template's
  for (const g of GENRE_FILMS) assert.equal(count(eng, `\n  ${g.key}: {`), 0, g.key);
});

test("a genre is a promise about what happens and how it ends — and a look that is photographed", () => {
  const by = Object.fromEntries(GENRE_FILMS.map((g) => [g.key, g]));
  for (const g of GENRE_FILMS) {
    // "Write <brief>." — a phrase, not a sentence; long enough to promise something
    assert.ok(/^a short [A-Z-]+/.test(g.brief) && !/[.!?]$/.test(g.brief) && g.brief.length >= 300 && g.brief.length <= 640, `${g.key}: ${g.brief.length}`);
    assert.ok(/^a short NARRATED /.test(g.narrated) && !/[.!?]$/.test(g.narrated) && g.narrated.length >= 150 && g.narrated.length <= 360, `${g.key} told: ${g.narrated.length}`);
    assert.ok(/\bend(s|ing)?\b|\blast line\b/.test(g.brief), `${g.key} says how it ends`);
    assert.ok(/\bend(s|ing)?\b|\blast line\b|\bsolution\b/.test(g.narrated), `${g.key} told says how it ends`);
    // the LOOK: light, a lens, colours — and the word that says nothing is not in it
    assert.ok(/\b\d\dmm lens\b/.test(g.sceneHint) && /photorealistic live-action film scene/.test(g.sceneHint), g.key);
    for (const text of [g.brief, g.narrated, g.sceneHint, g.musicHint]) assert.ok(!/cinematic/i.test(text), `${g.key}: "cinematic" says nothing`);
    assert.ok(/NO readable text/.test(g.sceneHint), `${g.key}: nothing written in a picture`);
    assert.ok(g.musicHint.length >= 30 && /score|underscore/.test(g.musicHint), g.key);
    if (g.faceMood) assert.ok(/^Everybody in it /.test(g.faceMood) && /nobody /.test(g.faceMood) && g.faceMood.endsWith("."), g.key);
  }
  // each one's own promise
  assert.ok(by.comedy.brief.includes("ONE comic engine") && by.comedy.brief.includes("pushed further three times") && by.comedy.brief.includes("nobody winks at the camera") && by.comedy.brief.includes("the last line is the button"));
  assert.ok(by.thriller.brief.includes("the threat is a PERSON or a situation — never a ghost, a monster or anything supernatural") && by.thriller.brief.includes("a clock or a secret") && by.thriller.brief.includes("a turn the story already planted"));
  assert.ok(by.action.brief.includes("Something HAPPENS in every shot") && by.action.brief.includes("No gunfire, no gore and no explosion near the camera"));
  assert.ok(by.romance.brief.includes("It ends on a GESTURE instead of a declaration") && by.romance.brief.includes("Tender, never explicit"));
  assert.ok(by.scifi.brief.includes("ONE speculative idea in an otherwise ordinary near-future world") && by.scifi.brief.includes("No space battles") && by.scifi.brief.includes("any screen in a shot shows nothing that can be read"));
  assert.ok(by.fantasy.brief.includes("ONE piece of magic") && by.fantasy.brief.includes("that magic has a PRICE") && by.fantasy.brief.includes("never as glow, sparks, beams or light"));
  assert.ok(by.mystery.brief.includes("the first line asks the QUESTION") && by.mystery.brief.includes("Every shot holds one clue") && by.mystery.brief.includes("The answer was in plain sight earlier"));
  // (a sci-fi set may have a screen in it — it shows nothing that can be read; every other set has none)
  assert.ok(by.scifi.sceneHint.includes("a device or a screen shows only soft abstract light, never words or numbers") && !by.scifi.sceneHint.includes("or screens visible"));
  for (const k of NEW.filter((x) => x !== "scifi")) assert.ok(by[k].sceneHint.endsWith("signage, posters or screens visible"), k);
  // A FANTASY'S WORLD IS ITS OWN. Every other grown-up story's writer is told "IT IS TODAY'S REAL WORLD … no castle,
  // no lone stone cottage" (premise-rules.ts → REAL_WORLD); said to a fantasy, that forbids the genre. So its writer
  // is not told it — and is asked to SAY each place as what it is there, because the pictures are drawn from the words.
  assert.deepEqual(GENRE_FILMS.filter((g) => g.ownWorld).map((g) => g.key), ["fantasy"]);
  for (const text of [by.fantasy.brief, by.fantasy.narrated]) assert.ok(text.includes("old world of its own, before engines and electricity") && text.includes("stone, timber, thatch and firelight"));
  assert.ok(read("app", "lib", "film-engine.server.ts").includes("(storyFormat && !tmpl.childSafe && !tmpl.ownWorld ? `${REAL_WORLD}\\n` : \"\") +"));
  // the faces: a thriller's cast does not grin, a comedy's does not wink; a romance may smile
  assert.deepEqual(GENRE_FILMS.filter((g) => g.faceMood).map((g) => g.key), ["comedy", "thriller", "action", "mystery"]);
  // DRAMA, sharpened: one relationship, a choice that costs, small actions, a decision and not a speech
  assert.ok(/^a short DRAMA, acted: ONE relationship under pressure/.test(DRAMA_BRIEF) && DRAMA_BRIEF.includes("a choice that will cost one of them something") && DRAMA_BRIEF.includes("small physical actions") && DRAMA_BRIEF.endsWith("It ends on a decision being MADE, never on a speech about it"));
});

test("every genre is on the shelves under its word: acted — and, but for Action, told", () => {
  // (…a hero on a shelf of its own is not a genre's: an ANIME style's card is its style — "Dream" — and its genre its
  //  kin's, 2026-11-26: tests/anime-shelf.test.ts)
  const story = FILM_HEROES.filter((h) => h.told !== null && !h.shelf);
  // a story hero's card is its genre's word; a sung one's is its own name
  for (const h of story) assert.equal(h.card, categoryOf(h.tmpl), h.id);
  for (const h of FILM_HEROES.filter((x) => x.told === null)) assert.equal(h.card, h.name, h.id);
  for (const g of FILM_GENRES) {
    const acted = heroOf(g.tmpl, false);
    assert.ok(acted && acted.told === "acted", `${g.tmpl} has a Film`);
    const told = FILM_HEROES.find((h) => h.tmpl === g.tmpl && h.told === "narrated");
    if (g.tmpl === "action" || g.tmpl === "kidstv") assert.equal(told, undefined, `${g.tmpl} is acted only`);
    else assert.ok(told, `${g.tmpl} has a Story`);
  }
  // a new genre's template is called what its acted film is called (so a "title" that is only that name is known for one)
  for (const g of GENRE_FILMS) {
    assert.equal(heroName(g.key, false, "?"), g.name);
    assert.equal(heroName(g.key, true, g.name), g.key === "action" ? g.name : g.name.replace(/ Film$/, " Story"));
  }
  // ids that existed before 2026-11-25 are what they were: saved drafts, links and the Archive hold them
  for (const [id, tmpl, told, media] of [["musicvideo", "musicvideo", null, "musicvideo"], ["kidstv", "kidstv", "acted", "kidstv"], ["kidsmusicvideo", "kidsmusicvideo", null, "kidsmusicvideo"], ["moral", "moral", "narrated", "moralstory"], ["moralfilm", "moral", "acted", "moral"], ["horror", "horror", "narrated", "horrorstory"], ["horrorfilm", "horror", "acted", "horror"], ["shortstory", "testmovie", "narrated", "shortstory"], ["testmovie", "testmovie", "acted", "testmovie"]] as const) {
    const h = FILM_HEROES.find((x) => x.id === id);
    assert.deepEqual([h?.tmpl, h?.told, h?.media], [tmpl, told, media], id);
  }
  // a Story's id is its template's key, its Film's the key + "film" (as horror / horrorfilm always were)
  for (const g of NEW) {
    if (g !== "action") assert.deepEqual([heroOf(g, true)?.id, heroOf(g, true)?.media], [g, `${g}story`]);
    assert.deepEqual([heroOf(g, false)?.id, heroOf(g, false)?.media], [`${g}film`, g]);
  }
  // the tints are ones the page already draws
  const ui = read("app", "routes", "web.film.tsx");
  for (const h of FILM_HEROES) assert.ok(ui.includes(`.${h.tint}{background:`), `${h.id}: ${h.tint}`);
  // each kick is one plain line, and none names anybody else's film or show
  for (const h of FILM_HEROES) assert.ok(h.kick.length >= 10 && !/[.!?]$/.test(h.kick) && !/\b(Netflix|Disney|Marvel|Pixar|Mann|Peppa|Bluey|CoComelon)\b/i.test(h.kick), h.kick);
  // two shelves of categories, in a film shelf's order (found by their keys: since 2026-11-26 the still shelf stands
  // between them, re-listing the told ones)
  const shelves = heroShelves(FILM_HEROES);
  const told = shelves.find((s) => s.key === "told")!, acted = shelves.find((s) => s.key === "acted")!;
  assert.deepEqual(told.heroes.map((h) => h.tmpl), ["testmovie", "comedy", "horror", "thriller", "romance", "scifi", "fantasy", "mystery", "moral"]);
  // (2026-11-26, THE WAYS: the Kids Cartoon stands on the Kids way — a different audience — so the Film row ends at Moral)
  assert.deepEqual(acted.heroes.map((h) => h.tmpl), GENRES.filter((g) => g !== "kidstv"));
  assert.deepEqual(shelves.find((s) => s.key === "kids")!.heroes.map((h) => h.tmpl), ["kidstv", "kidsmusicvideo"]);
});

/** A JPEG's width and height, from its own frame header. */
function jpegSize(file: string): { w: number; h: number } {
  const b = fs.readFileSync(file);
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error(`no frame header in ${file}`);
}

test("every hero has its cover: a wide still, and a phone one for every new genre", () => {
  const landing = (f: string) => path.join(root, "public", "landing", f);
  for (const h of FILM_HEROES) assert.ok(fs.existsSync(landing(`film-still-${h.media}.jpg`)), `film-still-${h.media}.jpg`);
  for (const m of TALL_STILL_MEDIA) assert.ok(fs.existsSync(landing(`film-still-${m}-tall.jpg`)), `film-still-${m}-tall.jpg`);
  for (const m of LOOP_MEDIA) for (const f of [`film-loop-${m}.mp4`, `film-loop-${m}-tall.mp4`, `film-loop-${m}.jpg`]) assert.ok(fs.existsSync(landing(f)), f);
  // no two heroes share a cover — a genre's Story is another picture than its Film
  assert.equal(new Set(FILM_HEROES.map((h) => h.media)).size, FILM_HEROES.length);
  // the thirteen made on 2026-11-25: 1600×900 wide and 1080×1350 for a phone, each under 350 KB
  const fresh = FILM_HEROES.filter((h) => NEW.includes(h.tmpl)).map((h) => h.media);
  assert.equal(fresh.length, 13);
  for (const m of fresh) {
    assert.ok(TALL_STILL_MEDIA.includes(m) && !LOOP_MEDIA.includes(m), `${m}: a phone still, and no loop yet`);
    const wide = landing(`film-still-${m}.jpg`), tall = landing(`film-still-${m}-tall.jpg`);
    assert.deepEqual(jpegSize(wide), { w: 1600, h: 900 }, wide);
    assert.deepEqual(jpegSize(tall), { w: 1080, h: 1350 }, tall);
    for (const f of [wide, tall]) { const kb = fs.statSync(f).size / 1000; assert.ok(kb > 60 && kb <= 350, `${path.basename(f)} is ${kb.toFixed(0)} KB`); }
  }
});

test("a film's name is read off its title, old and new", () => {
  // what the writer hands back when it has no title is not a title — today's names and the ones before them
  for (const n of [...FILM_HEROES.map((h) => h.name), ...FORMER_HERO_NAMES, "drama film", "SCI-FI STORY"]) assert.equal(isFormatName(n), true, n);
  assert.deepEqual([...FORMER_HERO_NAMES], ["Short Film", "Short Story"]);
  for (const n of ["Drama", "A Comedy Film About Ferns", "The Mystery Film"]) assert.equal(isFormatName(n), false, n);
  // the Archive's cover says the title without the name in front of it — for every hero there is, and was
  const V = (title: string, meta: Record<string, unknown> = {}) => ({ type: "VIDEO_AD", title, meta, body: {} });
  for (const h of FILM_HEROES.filter((x) => x.told !== null)) {
    const p = V(`${h.name} — The Last Fern`, { kind: h.told === "narrated" ? "narrated" : "testmovie", template: h.tmpl });
    const k = coverKind(p)!;
    assert.equal(coverWords(p, k).title, "The Last Fern", h.name);
    assert.equal(k.family, h.tmpl === "horror" ? "horror" : h.told === "narrated" ? "story" : "film", h.name);
  }
  for (const old of ["Short Film", "Short Story"]) { const p = V(`${old} — One Umbrella`); assert.equal(coverWords(p, coverKind(p)!).title, "One Umbrella"); }
  // a piece that says nothing about itself but its name is still put in its family
  assert.equal(coverKind(V("Sci-Fi Story — Eleven Minutes"))?.family, "story");
  assert.equal(coverKind(V("Action Film — Six Blocks"))?.family, "film");
  assert.equal(coverKind(V("Drama Film — The Diner"))?.family, "film");
  assert.equal(coverKind(V("Short Story — Tide"))?.family, "story");
  // (a title that merely begins with a genre's word is nobody's format)
  assert.equal(coverWords(V("Mystery Film Night at Ours"), { family: "ad", kids: false }).title, "Mystery Film Night at Ours");
});

test("every word a member reads is in all five languages", () => {
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  const said = new Set<string>();
  for (const h of FILM_HEROES) for (const k of [h.card, h.name, h.kick, h.meta]) if (k) said.add(k);
  for (const g of FILM_GENRES) {
    said.add(g.card);
    for (const b of g.backdrops) said.add(b.label);
    for (const n of g.notes) said.add(n.label);
    for (const s of g.starters) said.add(s);
  }
  // (268 since 2026-11-26: the six anime styles' cards, names and kicks — their "narrated in minutes" was said already)
  assert.equal(said.size, 268);
  for (const k of said) assert.equal(count(dict, `\n  ${JSON.stringify(k)}: `), 5, k);
  // (a place's `where` and a note's `ask` are for the writer and the pictures — never shown, never translated)
  // a translated starter is still an idea: about as long as the English one, and a sentence
  const blocks = ["es", "fr", "de", "zh", "ur"].map((l) => dict.slice(dict.indexOf(`const ${l}: Record<string, string> = {`)));
  for (const g of FILM_GENRES) for (const s of g.starters) {
    blocks.forEach((b, i) => {
      const at = b.indexOf(`\n  ${JSON.stringify(s)}: `);
      const line = b.slice(at + 1, b.indexOf("\n", at + 1));
      const tr = JSON.parse(line.slice(line.indexOf(": ", JSON.stringify(s).length + 1) + 2).replace(/,\s*$/, "")) as string;
      const cjk = i === 3;
      assert.ok(tr.length >= (cjk ? 18 : 50) && tr.length <= 300 && tr !== s && /[.?!。？！۔؟]$/.test(tr), `${["es", "fr", "de", "zh", "ur"][i]}: ${tr}`);
      assert.ok(ideaWords(tr) >= IDEA_MIN_WORDS, "picked in another language, it is still an idea of its own");
    });
  }
});
