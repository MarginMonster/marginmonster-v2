/* The guide box's answer (app/lib/idea-route.ts, 2026-11-26): where an idea typed at the top of the Movie Maker would
 * be made — the owner: "unless it guides user on page to actual prompt to use". */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FILM_HEROES } from "../app/lib/film-heroes.ts";
import { HERO_STARTERS, IDEA_HANDOFF_MS, dealHeroStarters, packHandoff, readHandoff, routeIdea } from "../app/lib/idea-route.ts";

const OPERATOR = ["still", "told", "acted", "cam", "anime", "kids", "sung"] as const;
const MEMBER = ["still", "told", "acted", "kids", "sung"] as const;
const heroesM = FILM_HEROES.filter((h) => !h.shelf);
const r = (idea: string, ways: readonly string[] = OPERATOR, current = "told", held = false) =>
  routeIdea(idea, { heroes: ways.includes("anime") ? FILM_HEROES : heroesM, ways: ways as never, current: current as never, held });

test("a story idea goes to its genre's Story — or Film, or Picture Book, when that way is lit", () => {
  assert.deepEqual(r("a night guard hears skates after closing in a haunted rink"), { way: "told", heroId: "horror", rung: "moving" });
  assert.deepEqual(r("two detectives chase a missing heir"), { way: "told", heroId: "mystery", rung: "moving" });
  assert.deepEqual(r("a robot learns to lie"), { way: "told", heroId: "scifi", rung: "moving" });
  assert.deepEqual(r("a best man loses the rings at the wedding"), { way: "told", heroId: "comedy", rung: "moving" }, "comedy before romance");
  assert.deepEqual(r("two sisters, one house, one will"), { way: "told", heroId: "shortstory", rung: "moving" }, "the rest is Drama");
  assert.deepEqual(r("a ghost in the attic", OPERATOR, "acted"), { way: "acted", heroId: "horrorfilm" });
  assert.deepEqual(r("a ghost in the attic", OPERATOR, "still"), { way: "still", heroId: "horror", rung: "still" });
  assert.deepEqual(r("a car chase through the old port"), { way: "told", heroId: "thriller", rung: "moving" }, "no Action Story: the nearest told genre");
  assert.deepEqual(r("a car chase through the old port", OPERATOR, "acted"), { way: "acted", heroId: "actionfilm" });
});

test("the originals: Caught on Cam (an operator's), Anime (an operator's), Kids, a song", () => {
  assert.deepEqual(r("caught on a doorbell cam at 3 AM"), { way: "cam", heroId: null, camera: "house" });
  assert.deepEqual(r("body cam footage of a patrol at a farm"), { way: "cam", heroId: null, camera: "bodycam" });
  assert.deepEqual(r("an old VHS home video of a birthday"), { way: "cam", heroId: null, camera: "camcorder" });
  assert.deepEqual(r("a vlog that keeps recording after she leaves"), { way: "cam", heroId: null, camera: "phone" });
  assert.deepEqual(r("an anime about a courier in a neon city"), { way: "anime", heroId: "animeneon" });
  assert.deepEqual(r("anime about two friends"), { way: "anime", heroId: "animedream" });
  assert.deepEqual(r("a bedtime cartoon about a brave little bus"), { way: "kids", heroId: "kidstv" });
  assert.deepEqual(r("a lullaby for my daughter"), { way: "kids", heroId: "kidsmusicvideo" });
  assert.deepEqual(r("a summer song for a drive at dusk"), { way: "sung", heroId: "musicvideo" });
  // a member: no Caught on Cam, no Anime — those words fall through to a story
  assert.equal(r("caught on a doorbell cam at 3 AM", MEMBER).way, "told");
  assert.equal(r("an anime about a ghost", MEMBER).heroId, "horror");
});

test("words that only LOOK like a route do not take one", () => {
  assert.equal(r("a story about a child who finds a dragon").way, "told", "about a child is not FOR one");
  assert.equal(r("a singer loses her voice").way, "told", "a story about a singer is still a story");
  assert.equal(r("the airplane never landed").heroId !== "scifi" || true, true);
  assert.notEqual(r("the airplane never landed").heroId, "scifi", "no \"ai\" inside \"airplane\"");
  assert.notEqual(r("a songbird at the window").way, "sung", "no \"song\" inside \"songbird\"");
  assert.equal(r("a hand-drawn map to the treasure").way, "told");
});

test("a tapped way HOLDS: only the pick inside it is guessed", () => {
  assert.deepEqual(r("a rap about my city", OPERATOR, "told", true), { way: "told", heroId: "shortstory", rung: "moving" });
  assert.deepEqual(r("a ghost at the window", OPERATOR, "cam", true), { way: "cam", heroId: null, camera: "house" });
  assert.deepEqual(r("a ghost at the window", OPERATOR, "anime", true), { way: "anime", heroId: "animedream" });
  assert.deepEqual(r("a lullaby", OPERATOR, "kids", true), { way: "kids", heroId: "kidsmusicvideo" });
  assert.deepEqual(r("a haunted house", OPERATOR, "sung", true), { way: "sung", heroId: "musicvideo" });
});

test("three starters a day: a Story, a Film and an original the viewer can make — every hero real", () => {
  const ids = new Set(FILM_HEROES.map((h) => h.id));
  for (const s of [...HERO_STARTERS.story, ...HERO_STARTERS.film, ...HERO_STARTERS.only]) {
    assert.ok(s.text.length <= 42, s.text);
    if (s.route.heroId) assert.ok(ids.has(s.route.heroId), s.route.heroId);
  }
  const op = dealHeroStarters([...OPERATOR], 20419);
  assert.equal(op.length, 3);
  assert.deepEqual(op.map((s) => s.route.way), ["told", "acted", "cam"], "an operator always gets the doorbell");
  const mem = dealHeroStarters([...MEMBER], 20419);
  assert.deepEqual(mem.map((s) => s.route.way).slice(0, 2), ["told", "acted"]);
  assert.ok(mem[2].route.way === "kids" || mem[2].route.way === "sung");
  assert.deepEqual(dealHeroStarters([...MEMBER], 20419), mem, "the same day deals the same three");
});

test("the handoff to Found Footage: this tab only, ten minutes, one line", () => {
  const now = 1_800_000_000_000;
  assert.equal(readHandoff(packHandoff("  a doorbell\ncam at 3 AM ", now), now + 1000), "a doorbell cam at 3 AM");
  assert.equal(readHandoff(packHandoff("x", now), now + IDEA_HANDOFF_MS + 1), null, "stale");
  assert.equal(readHandoff(packHandoff("x", now + 120_000), now), null, "from the future");
  assert.equal(readHandoff("{not json", now), null);
  assert.equal(readHandoff(packHandoff("   ", now), now), null, "empty");
  assert.equal(readHandoff(null, now), null);
  assert.equal(JSON.parse(packHandoff("y".repeat(900), now)).idea.length, 400);
});

test("THE PAGE: the box is the builder's own idea; Start goes the poster's way; NOTHING is made from the hero", async () => {
  const fs = await import("node:fs");
  const ui = fs.readFileSync(new URL("../app/routes/web.film.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(ui.includes('<input id="fs-ask-in" className="fs-ask-in" type="text" value={topic} maxLength={IDEA_MAX}'), "bound to the shared topic");
  const start = ui.slice(ui.indexOf("const startIdea = () => {"), ui.indexOf("const pickStarter = (st: HeroStarter) => {"));
  assert.ok(start.includes("enterFormat(guess.heroId, guess.rung);"), "the poster's own path");
  assert.ok(start.includes("window.sessionStorage.setItem(IDEA_HANDOFF_KEY, packHandoff(idea, Date.now()));") && start.includes("navigate(`/web/found-footage?camera=${guess.camera || \"house\"}`);"));
  const hero = ui.slice(ui.indexOf("{/* THE GUIDE BOX: the builder's own idea, raised to the top"), ui.indexOf("{/* what is playing — and a way straight into making one */}"));
  const guide = ui.slice(ui.indexOf("/* THE GUIDE BOX (2026-11-26"), ui.indexOf("// THE IDEA LANDS:"));
  // (…the one request the box sends is its READING of the idea — readIdea, free, nothing written, drawn or charged)
  const readAsk = 'readFetcher.submit({ intent: "readIdea", idea }, { method: "post" });';
  assert.equal(guide.split(readAsk).length - 1, 1);
  for (const part of [hero, guide.split(readAsk).join("")]) {
    assert.ok(part.length > 400);
    for (const spend of ["Fetcher.submit", "submit(", "<Form", "writeTreatment", "makeStoryboard", "previewScenes", "spendTokens"]) assert.ok(!part.includes(spend), spend);
  }
  // the idea lands in the builder's own box — never for a next episode, an edit, or a builder already holding a script
  assert.ok(ui.includes("if (!entered || !topic.trim() || series || editing || treatment || seeds) return;"));
  // Found Footage puts a brought idea in ITS box, once
  const ff = fs.readFileSync(new URL("../app/routes/web.found-footage.tsx", import.meta.url), "utf8");
  assert.ok(ff.includes("const brought = readHandoff(window.sessionStorage.getItem(IDEA_HANDOFF_KEY), Date.now());") && ff.includes("window.sessionStorage.removeItem(IDEA_HANDOFF_KEY);"));
  // every word of the box is in all five languages
  const dict = fs.readFileSync(new URL("../app/lib/ui-i18n-dict.ts", import.meta.url), "utf8");
  for (const k of ["Got an idea? Type it here", "We'd make this:", "We'll take you to the right place with your idea in it. Nothing is made yet.", ...[...HERO_STARTERS.story, ...HERO_STARTERS.film, ...HERO_STARTERS.only].map((x) => x.text)]) {
    assert.equal(dict.split(`\n  ${JSON.stringify(k)}: `).length - 1, 5, k);
  }
});

test("THE IDEA, READ (2026-11-26 — \"not routing things properly now\"): the small model's answer is checked, then routed by the same rules", async () => {
  const { ideaReadAsk, parseIdeaRead, routeFromRead, IDEA_READ_GENRES } = await import("../app/lib/idea-route.ts");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  // the ask: the idea fenced, one line of JSON, every genre named, "about a child" is not "for kids"
  const ask = ideaReadAsk("BARNABY: Quick, hide the crown jewels before the Duchess walks in!");
  assert.ok(ask.includes('"""BARNABY: Quick, hide the crown jewels before the Duchess walks in!"""'));
  assert.ok(ask.includes("Answer with ONE line of JSON and nothing else"));
  for (const g of IDEA_READ_GENRES) assert.ok(ask.includes(`"${g}"`), g);
  assert.ok(ask.includes("a story ABOUT a child is not"));
  // the answer, checked: a drama is the Drama template; anything not one of its own values is nothing
  assert.deepEqual(parseIdeaRead('{"genre":"comedy","kids":false,"song":false,"camera":null,"anime":false}'), { genre: "comedy", kids: false, song: false, camera: null, anime: false });
  assert.equal(parseIdeaRead('Sure! {"genre":"drama","kids":false,"song":false,"camera":null,"anime":false}')?.genre, "testmovie");
  assert.equal(parseIdeaRead('{"genre":"Sci-Fi","kids":false}')?.genre, "scifi");
  assert.equal(parseIdeaRead('{"genre":"western"}'), null);
  assert.equal(parseIdeaRead("no idea"), null);
  assert.equal(parseIdeaRead('{"genre":"horror","camera":"drone"}')?.camera, null);
  assert.equal(parseIdeaRead('{"genre":"horror","camera":"house","kids":"yes"}')?.kids, false, "only a real true is true");
  // routed by the same rules as the keywords: the farce to a Comedy Story, the puppy's to Kids, the doorbell to a camera
  const o = { heroes: FILM_HEROES.filter((h) => !h.shelf), ways: ["still", "told", "acted", "cam", "anime", "kids", "sung"] as const, current: "told" as const, held: false };
  assert.deepEqual(routeFromRead({ genre: "comedy", kids: false, song: false, camera: null, anime: false }, "hide the crown jewels", o), { way: "told", heroId: "comedy", rung: "moving" });
  assert.deepEqual(routeFromRead({ genre: "testmovie", kids: true, song: false, camera: null, anime: false }, "a puppy shares his ball", o), { way: "kids", heroId: "kidstv" });
  assert.deepEqual(routeFromRead({ genre: "horror", kids: false, song: false, camera: "house", anime: false }, "something at the door at 3am", o), { way: "cam", heroId: null, camera: "house" });
  // …and a way the member TAPPED still holds: only the pick inside it follows the reading
  assert.deepEqual(routeFromRead({ genre: "thriller", kids: false, song: false, camera: null, anime: false }, "a train, a newspaper", { ...o, current: "acted", held: true }), { way: "acted", heroId: "thrillerfilm" });
  // the page: read once the member stops typing, never reloading the page, and used only while the box says what was read
  const ui = fs.readFileSync(path.join(root, "app", "routes", "web.film.tsx"), "utf8");
  assert.ok(ui.includes('const BOARD_INTENTS = new Set(["sketchFilmScenes", "rewriteFilmScene", "readIdea"]);'));
  assert.ok(ui.includes('readFetcher.submit({ intent: "readIdea", idea }, { method: "post" }); }, 900);'));
  assert.ok(ui.includes("const ideaRead = readFetcher.data && readFetcher.data.text === idea ? readFetcher.data.read || null : null;"));
  assert.ok(ui.includes("ideaRead ? routeFromRead(ideaRead, topic, routeOpts) : routeIdea(topic, routeOpts);"));
  // the server: after the plan checks, free, the text sent back as it came, nothing on a failure
  const act = ui.slice(ui.indexOf("export const action"));
  assert.ok(act.indexOf('if (intent === "readIdea")') > act.indexOf('capabilitiesFor(shop.activePlan).has("creatorvideo")'));
  assert.ok(act.includes("return json({ text, read: parseIdeaRead(await anthropicText(ideaReadAsk(text), { maxTokens: 80 })) });"));
});

test("the keywords alone: a train-derailment victim is a Thriller now (it was a Drama)", () => {
  assert.equal(routeIdea("I saw my own name as the sole victim of a fatal derailment at the next station", { heroes: FILM_HEROES.filter((h) => !h.shelf), ways: ["still", "told", "acted"], current: "told" }).heroId, "thriller");
});

test("the reading is told a family secret coming out is a DRAMA (2026-11-26: the tester's Thanksgiving loan was read as a comedy)", async () => {
  const { ideaReadAsk } = await import("../app/lib/idea-route.ts");
  const ask = ideaReadAsk("At the Thanksgiving table, Aunt Clara thanked my brother for paying back the secret loan.");
  assert.ok(ask.includes('an idea played MAINLY for laughs — is "comedy"'));
  assert.ok(ask.includes('a family argument, a secret coming out, a betrayal or a hard choice is "drama", even with a witty line in it.'));
});
