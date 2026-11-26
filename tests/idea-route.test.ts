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
  for (const part of [hero, guide]) {
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
