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
import { FILM_HEROES, heroById, heroName, heroOf, heroesFor } from "../app/lib/film-heroes.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");
const exists = (...p: string[]) => fs.existsSync(path.join(root, ...p));
const ui = read("app", "routes", "web.film.tsx");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

test("a Film is acted and a Story is told: every hero is one format told one way", () => {
  const byName = Object.fromEntries(FILM_HEROES.map((h) => [h.name, h]));
  assert.deepEqual([byName["Horror Film"].tmpl, byName["Horror Film"].told], ["horror", "acted"]);
  assert.deepEqual([byName["Horror Story"].tmpl, byName["Horror Story"].told], ["horror", "narrated"]);
  assert.deepEqual([byName["Short Film"].tmpl, byName["Short Film"].told], ["testmovie", "acted"]);
  assert.deepEqual([byName["Short Story"].tmpl, byName["Short Story"].told], ["testmovie", "narrated"]);
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
  assert.equal(heroName("testmovie", true, "Short Film"), "Short Story");
  assert.equal(heroName("moral", false, "Moral Story"), "Moral Story", "no acted Moral hero: the template's name stands");
  assert.equal(heroName("youtube", false, "YouTube Video"), "YouTube Video");
  assert.ok(read("app", "lib", "film-dialogue.server.ts").includes("title: `${heroName(tmpl.key, false, tmpl.name)} — "));
  assert.ok(read("app", "lib", "narrated-story.server.ts").includes("title: `${heroName(tmpl.key, true, tmpl.name)} — "));
});

test("a page is offered only the heroes it can make", () => {
  const all = ["musicvideo", "kidstv", "kidsmusicvideo", "moral", "horror", "testmovie"];
  assert.deepEqual(heroesFor(all, ["horror", "moral", "kidstv", "testmovie"]).map((h) => h.id), FILM_HEROES.map((h) => h.id));
  // a template that cannot be narrated offers no told hero; a template the account lacks offers none at all
  assert.deepEqual(heroesFor(all, ["moral"]).map((h) => h.id), ["musicvideo", "kidstv", "kidsmusicvideo", "moral", "horrorfilm", "testmovie"]);
  assert.deepEqual(heroesFor(["musicvideo"], ["horror"]).map((h) => h.id), ["musicvideo"]);
});

test("the grid shows a poster per hero, and opening one sets the format AND how it is told", () => {
  assert.ok(ui.includes("const heroes = heroesFor(d.templates.map((x) => x.key), d.narratable || []);"));
  const grid = ui.slice(ui.indexOf("{heroes.map((h) => ("), ui.indexOf("{heroes.map((h) => (") + 900);
  assert.ok(grid.includes("onClick={() => enterFormat(h.id)}") && grid.includes("<LoopCover k={h.media} />") && grid.includes("<b>{t(h.name)}</b>"));
  assert.ok(grid.includes("{t(h.kick)}{h.meta ? <em> · {t(h.meta)}</em> : null}"));
  assert.ok(!ui.includes("{d.templates.map((x) => {\n              const m = FMT["), "the grid is no longer one poster per template");
  const sw = ui.slice(ui.indexOf("const switchHero = (id: string) => {"), ui.indexOf("const switchHero = (id: string) => {") + 1100);
  assert.ok(sw.includes("const openNarrated = !!nt?.dialogue && h.told === \"narrated\" && (d.narratable || []).includes(h.tmpl);"));
  assert.ok(sw.includes("setHeroId(h.id);") && sw.includes("setTemplate(h.tmpl);") && sw.includes("setTold(openNarrated ? \"narrated\" : \"acted\");"));
  // its length and shape are set with it: the effect that follows `told` does not run when two heroes in a row are told the same way
  assert.ok(sw.includes("openNarrated ? d.narratedScenes.def : (nt?.defaultScenes || 6)"));
  assert.ok(sw.includes("if (nt?.dialogue) setFilmAspect(openNarrated ? \"9:16\" : \"16:9\");"));
  // two heroes can share a template, so "the same one again" is judged on the hero
  assert.ok(ui.includes("window.setTimeout(() => { if (key !== heroId) switchHero(key); setEntered(true); setAnim(\"\"); setZoomKey(null); }, reduce ? 0 : 400);"));
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
  for (const h of FILM_HEROES) {
    assert.ok(exists("public", "landing", `film-still-${h.media}.jpg`), `still for ${h.id}`);
    assert.ok(loops.includes(`"${h.media}"`), `${h.id} has a loop listed`);
    for (const f of [`film-loop-${h.media}.mp4`, `film-loop-${h.media}-tall.mp4`, `film-loop-${h.media}.jpg`]) assert.ok(exists("public", "landing", f), f);
    if (talls.includes(`"${h.media}"`)) assert.ok(exists("public", "landing", `film-still-${h.media}-tall.jpg`), `tall still for ${h.id}`);
    if (h.told === "narrated") assert.ok(talls.includes(`"${h.media}"`), `${h.id}: a strip of three upright pictures cannot be centre-cropped for a phone card`);
  }
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const h of FILM_HEROES) for (const k of [h.name, h.kick, h.meta].filter(Boolean)) assert.equal(count(dict, `\n  ${JSON.stringify(k)}:`), 5, k);
  // a poster's two lines fit a phone card (about 45 characters): "…your cast on…" was cut off at 390 px
  for (const h of FILM_HEROES) assert.ok((h.kick + (h.meta ? ` · ${h.meta}` : "")).length <= 45, `${h.name}: ${h.kick} · ${h.meta}`);
});
