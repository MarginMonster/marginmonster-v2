/* THE ANIME MAKER, IN STYLES — six drawn styles, each a told template of its own.
 *
 * The owner, 2026-11-26: "Maybe just make it an additional tier on the actual movie maker (would look like more
 * options) also would like to add an Anime maker with different styles".
 *
 * So there is one table (app/lib/anime-styles.ts): six styles, each a template made from its KIN — the movie
 * category it is told as — with a drawn look of its own. Every picture of such a story is told FIRST that it is drawn
 * (narrated-story.server.ts → `safe`), its writer is told what "a photograph of a real place" means for it
 * (DRAWN_WORLD), and it is given its kin's starters, so the writer is never handed nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ANIME_KEYS, ANIME_STYLES, ANIME_TAIL, DRAWN_WORLD, animeBrief, animeSceneHint, animeStyleOf, animeTemplate, drawnLead } from "../app/lib/anime-styles.ts";
import { FILM_GENRES, GENRE_FILMS, backdropsOf, dealStarters, genreOf, genreTemplate, notesOf, nudgeFor, startersOf } from "../app/lib/film-genres.ts";
import { CREATURE_REAL, characterKind, placeSheetPrompt, portraitPrompt } from "../app/lib/story-picture.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const TINTS = ["t-film", "t-kids", "t-horror", "t-mv", "t-kmv", "t-moral"];

test("six styles, each told as a movie category, each with its own poster word and Archive name", () => {
  assert.deepEqual(ANIME_STYLES.map((s) => s.key), ["animedream", "animeretro", "animeneon", "animesky", "animeink", "animepastel"], "in the shelf's order");
  assert.deepEqual([...ANIME_KEYS], ANIME_STYLES.map((s) => s.key));
  assert.deepEqual(ANIME_STYLES.map((s) => s.kin), ["fantasy", "thriller", "scifi", "romance", "mystery", "comedy"]);
  assert.deepEqual(ANIME_STYLES.map((s) => s.card), ["Dream", "Retro", "Neon City", "Skyglow", "Dark Ink", "Pastel Days"]);
  assert.equal(new Set(ANIME_STYLES.map((s) => s.key)).size, 6);
  for (const s of ANIME_STYLES) {
    assert.ok(/^anime[a-z]+$/.test(s.key), `${s.key}: lower-case, "anime" first`);
    // a kin is a movie category that exists — and not Action: there is no told action story ("a chase is something to SEE")
    assert.ok(GENRE_FILMS.some((g) => g.key === s.kin) && s.kin !== "action", `${s.key}: ${s.kin}`);
    assert.equal(s.name, `${s.card} Anime Story`);
    assert.ok(s.name.endsWith(" Anime Story"));
    // the kick under the poster, with what every story's poster says after it, fits a phone's card
    assert.ok(`${s.kick} · narrated in minutes`.length <= 45, `${s.key}: "${s.kick}"`);
    assert.ok(s.kick.length >= 10 && !/[.!?]$/.test(s.kick), s.kick);
    assert.ok(TINTS.includes(s.tint), `${s.key}: ${s.tint}`);
    assert.ok(s.short.length >= 10 && s.short.length <= 60 && /anime/.test(s.short), `${s.key}: ${s.short}`);
    assert.ok(s.musicHint.length >= 30, s.key);
  }
  assert.equal(new Set(ANIME_STYLES.map((s) => s.card)).size, 6);
  assert.equal(new Set(ANIME_STYLES.map((s) => s.name)).size, 6);
  // (the tints are ones the Movie Maker already draws)
  const ui = read("app", "routes", "web.film.tsx");
  for (const t of TINTS) assert.ok(ui.includes(`.${t}{background:`), t);
  // the two styles the anime AD recipes narrated in production keep those voices; the rest are their kin's
  assert.deepEqual(ANIME_STYLES.map((s) => s.narrator || ""), ["English_SereneWoman", "English_ConfidentWoman", "", "", "", ""]);
  // …and those two looks ARE the production recipes (cartoon-styles.json), with the ad's own words taken out
  const recipes = JSON.parse(read("app", "lib", "cartoon-styles.json")) as Record<string, { look: string; voice: string }>;
  assert.equal(recipes.dreamanime.voice, "English_SereneWoman");
  assert.equal(recipes.retroanime.voice, "English_ConfidentWoman");
  assert.ok(recipes.dreamanime.look.includes("watercolor-washed skies") && animeStyleOf("animedream")!.look.includes("watercolour-washed skies"));
  assert.ok(recipes.retroanime.look.includes("hard-edged shadow shapes") && animeStyleOf("animeretro")!.look.includes("hard-edged cel shadows"));
  for (const s of ANIME_STYLES) assert.ok(!/film still|OVA|confident character poses|big warm eyes|cinematic/i.test(s.look), `${s.key}: an ad's word`);
  // a style is found by its key, and nothing else is one
  assert.equal(animeStyleOf("animeink")?.card, "Dark Ink");
  for (const k of ["mystery", "testmovie", "anime", "", null, undefined]) assert.equal(animeStyleOf(k), undefined);
});

test("named in plain words: no studio, director, show, film or game — and no photograph in any look", () => {
  const BANNED = ["Ghibli", "Miyazaki", "Shinkai", "Toei", "Madhouse", "Kyoto Animation", "KyoAni", "Trigger", "MAPPA", "Ufotable", "Sunrise", "Pixar", "Disney", "DreamWorks", "Akira", "Evangelion", "Gundam", "Naruto", "Dragon Ball", "One Piece", "Sailor Moon", "Pokémon", "Pokemon", "Totoro", "Bebop", "Ghost in the Shell", "Spirited Away", "Your Name", "Demon Slayer", "Attack on Titan", "Studio"];
  const words = [ANIME_TAIL, DRAWN_WORLD, ...ANIME_STYLES.flatMap((s) => [s.key, s.card, s.name, s.kick, s.short, s.look, s.musicHint])];
  for (const w of words) for (const b of BANNED) assert.ok(!new RegExp(`\\b${b}\\b`, "i").test(w), `"${b}" in: ${w.slice(0, 80)}`);
  for (const s of ANIME_STYLES) {
    assert.ok(!/photo|photoreal|live-action|\d\dmm|lens/i.test(s.look), `${s.key}: a look is drawn, never photographed`);
    assert.ok(s.look.startsWith("a frame from a ") && !/[.;!?]$/.test(s.look), s.key);
    assert.ok(!/photo|lens|3D/i.test(s.short), s.key);
  }
  // NEVER COMBINED WITH "CAST SEX APPEAL" (his open ask, 2026-11-24): anime models draw grown-ups young — so no style's
  // words reach for allure, and the rule is written where the table is
  for (const w of words) assert.ok(!/\b(sexy|seductive|sensual|alluring|revealing|cleavage|lingerie|bikini|swimsuit|skimpy|cute girl|schoolgirl|loli|chibi)\b/i.test(w), w.slice(0, 80));
  const src = read("app", "lib", "anime-styles.ts");
  assert.ok(src.includes("NEVER COMBINED WITH THE \"CAST SEX APPEAL\" ASK") && src.includes("Anime models draw grown-ups young"));
  assert.ok(src.includes("named descriptively (never by the IP that popularized them)"), "the ad pipeline's rule, cited");
  assert.ok(src.includes("app/lib/cartoon-styles.json") && src.includes("CARTOON_RECIPES"), "the third copy says where the first two are");
});

test("the tail every anime picture is told: drawn, original, grown-ups grown-up, dressed, one frame, nothing to read", () => {
  for (const s of ANIME_STYLES) {
    const hint = animeSceneHint(s);
    assert.ok(hint.endsWith(ANIME_TAIL), s.key);
    assert.equal(hint, `${s.look}; ${ANIME_TAIL}`);
  }
  for (const must of ["2D hand-drawn animation", "never a 3D render", "never photographic", "an original design, not any existing anime, manga or game character", "adult face", "adult proportions", "modestly dressed", "never a manga page, panels, speech bubbles", "lettering", "nothing readable anywhere"]) {
    assert.ok(ANIME_TAIL.includes(must), must);
  }
});

test("the lead said FIRST in every picture of a drawn story — and only of one", () => {
  for (const k of ["testmovie", "horror", "kidstv", "fantasy", "mystery", "musicvideo", "", null, undefined]) assert.equal(drawnLead(k), "", String(k));
  for (const s of ANIME_STYLES) {
    const lead = drawnLead(s.key);
    assert.ok(lead.startsWith("EVERYTHING IN THIS PICTURE IS DRAWN"), s.key);
    assert.ok(lead.length <= 200, `${s.key}: ${lead.length}`);
    assert.ok(lead.includes(` — ${s.short}: `) && lead.includes("never a photograph and never a 3D render, whatever any word below says."), s.key);
    // (it is put in front of the picture's words as `safe` is: a sentence and a space)
    assert.ok(lead.endsWith(". "), s.key);
  }
});

test("a style's template is its kin's: the brief, faces, world, lengths and dialogue kept — its look, name and score its own", () => {
  const base = { key: "romance", name: "Romance Film", brief: "the kin's brief", sceneHint: "a photographed look", musicHint: "the kin's score", faceMood: "the kin's faces", ownWorld: true, defaultScenes: 7, minScenes: 3, maxScenes: 52, captions: false, castBible: true, dialogue: true, live: true };
  const before = JSON.stringify(base);
  for (const s of ANIME_STYLES) {
    const t = animeTemplate(base, s);
    // its own
    assert.deepEqual([t.key, t.name, t.sceneHint, t.musicHint, t.drawn], [s.key, s.name.replace(/ Story$/, ""), animeSceneHint(s), s.musicHint, true]);
    assert.ok(t.name.endsWith(" Anime") && !t.name.endsWith("Story"), t.name);
    // the kin's, kept
    assert.deepEqual([t.brief, t.faceMood, t.ownWorld, t.defaultScenes, t.minScenes, t.maxScenes, t.dialogue, t.live, t.captions, t.castBible], ["the kin's brief", "the kin's faces", true, 7, 3, 52, true, true, false, true]);
    // …and nothing dropped: every field of the base is there, and only the five above differ
    for (const k of Object.keys(base) as Array<keyof typeof base>) {
      assert.ok(k in t, `${s.key} keeps ${k}`);
      if (!["key", "name", "sceneHint", "musicHint"].includes(k)) assert.equal(t[k], base[k], `${s.key}: ${k}`);
    }
    assert.deepEqual(Object.keys(t).sort(), [...Object.keys(base), "drawn"].sort());
  }
  assert.equal(JSON.stringify(base), before, "the kin's template is not changed");
  // the engine, as it is built: the Short Film → each movie category → each style from its kin (film-engine.server.ts)
  const short = { key: "testmovie", name: "Drama Film", brief: "a drama", sceneHint: "s", musicHint: "m", defaultScenes: 2, minScenes: 1, maxScenes: 52, captions: false, castBible: true, dialogue: true, live: true };
  const made: Record<string, typeof short & { faceMood?: string; ownWorld?: boolean; drawn?: boolean }> = { testmovie: short };
  for (const g of GENRE_FILMS) made[g.key] = genreTemplate(made.testmovie, g);
  for (const s of ANIME_STYLES) made[s.key] = animeTemplate(made[s.kin], s);
  for (const s of ANIME_STYLES) {
    const t = made[s.key], kin = made[s.kin];
    assert.ok(kin && !kin.drawn, `${s.kin} exists before ${s.key} is made from it, and is not drawn itself`);
    assert.equal(t.brief, kin.brief);
    assert.equal(t.faceMood, kin.faceMood);
    assert.equal(!!t.ownWorld, s.kin === "fantasy", `${s.key}: only Dream's world is its own — its kin's, Fantasy's`);
    assert.ok(t.drawn && t.dialogue && t.live);
  }
  // told: the kin's narrated brief, and that every picture is a drawn frame in the style
  const told = animeBrief("a short NARRATED MYSTERY — a storyteller's voice that opens on the question", animeStyleOf("animeink")!);
  assert.equal(told, "a short NARRATED MYSTERY — a storyteller's voice that opens on the question — every picture of it a frame of a hand-drawn anime film (dark anime of ink-black shadows)");
  assert.ok(!/[.!?]$/.test(told), "\"Write <brief>.\" — a phrase, as every brief is");
});

test("through the real picture asks: a drawn story's creature is DRAWN, and its place sheet is told first that it is drawn", () => {
  // the creature the way WHAT_FRIGHTENS asks the writer for one
  const creature = "the figure in the stairwell, too tall, a smile far too wide, crowded with thin teeth, in a soaked grey overcoat";
  assert.equal(characterKind("the figure in the stairwell", "too tall, a smile far too wide"), "monster");
  for (const s of ANIME_STYLES) {
    const hint = animeSceneHint(s);
    const drawn = portraitPrompt(creature, hint, drawnLead(s.key));
    assert.ok(!drawn.includes(CREATURE_REAL) && !drawn.includes("wardrobe-test photograph") && !drawn.includes("PHOTOGRAPHED"), s.key);
    assert.ok(drawn.includes("In the exact art style of the story") && drawn.startsWith(drawnLead(s.key)), s.key);
    // (…which is what the lead does: with no lead, the same creature is photographed)
    assert.ok(portraitPrompt(creature, hint, "").includes("wardrobe-test photograph"));
    // a person's portrait: the lead first, then the style
    assert.ok(portraitPrompt("Odessa Lark, a woman in her thirties with a short black bob", hint, drawnLead(s.key)).startsWith(`${drawnLead(s.key)}${hint}. A character portrait of Odessa Lark`));
    // the place sheet: the lead before "like a scale model photographed on a table"
    const sheet = placeSheetPrompt({ name: "the ferry", look: "a low black wooden ferry with a glass wheelhouse" }, hint, drawnLead(s.key), true);
    assert.ok(sheet.startsWith(drawnLead(s.key)) && sheet.indexOf("EVERYTHING IN THIS PICTURE IS DRAWN") < sheet.indexOf("photographed on a table"), s.key);
  }
});

test("a style is given its kin's starters and nudge — the writer is never handed nothing", () => {
  for (const s of ANIME_STYLES) {
    assert.equal(genreOf(s.key), genreOf(s.kin), s.key);
    assert.deepEqual(startersOf(s.key), startersOf(s.kin));
    for (const seed of [0, 1, 2, 7, 99, 12345]) assert.deepEqual(dealStarters(s.key, seed), dealStarters(s.kin, seed), `${s.key} seed ${seed}`);
    for (const seed of [1, 2, 3, 99]) {
      const n = nudgeFor(s.key, "", seed);
      assert.ok(n && startersOf(s.kin).includes(n.nudge) && n.topic === n.nudge, `${s.key}: a ${s.kin} starter`);
    }
    // three words or more: the maker's own idea stands
    assert.equal(nudgeFor(s.key, "a lighthouse keeper's cat", 1), null);
    // …and its places and director's notes are its kin's
    assert.equal(backdropsOf(s.key), backdropsOf(s.kin));
    assert.equal(notesOf(s.key), notesOf(s.kin));
  }
  // no row is added to the genres' own table (it is the photographed, acted and told categories, as it was)
  assert.equal(FILM_GENRES.length, 11);
  assert.ok(!FILM_GENRES.some((g) => g.tmpl.startsWith("anime")));
  // the alias, and why, are written where it is
  const src = read("app", "lib", "film-genres.ts");
  assert.ok(src.includes("import { ANIME_STYLES } from \"./anime-styles.ts\";"));
  assert.ok(src.includes("const ANIME_KIN: Record<string, string> = Object.fromEntries(ANIME_STYLES.map((s) => [s.key, s.kin]));"));
  assert.ok(src.includes("export const genreOf = (tmplKey: string | null | undefined): FilmGenre | undefined => (tmplKey ? BY_TMPL[tmplKey] || BY_TMPL[ANIME_KIN[tmplKey]] : undefined);"));
  assert.ok(src.includes("atleast need a starter \"nudge\" couple sentences"));
});

test("THE WIRING: each style a template after the categories, told to its own brief, its writer told it is drawn", () => {
  // (film-engine.server.ts cannot be loaded in a test — it opens the database)
  const eng = read("app", "lib", "film-engine.server.ts");
  assert.ok(eng.includes("import { ANIME_STYLES, DRAWN_WORLD, animeBrief, animeTemplate } from \"./anime-styles\";"));
  // the template: drawn, and told only
  assert.ok(eng.includes("\n  drawn?: boolean;\n"));
  assert.ok(eng.indexOf("  drawn?: boolean;") > eng.indexOf("export interface FilmTemplate {") && eng.indexOf("  drawn?: boolean;") < eng.indexOf("  live: boolean;\n}"));
  // each style is its kin's template, made AFTER the movie categories (so every kin exists by then) and before the
  // live list is taken (so the page has it)
  const genres = "for (const g of GENRE_FILMS) FILM_TEMPLATES[g.key] = genreTemplate(FILM_TEMPLATES.testmovie, g);";
  const anime = "for (const s of ANIME_STYLES) FILM_TEMPLATES[s.key] = animeTemplate(FILM_TEMPLATES[s.kin], s);";
  assert.equal(count(eng, anime), 1);
  assert.ok(eng.indexOf(genres) < eng.indexOf(anime));
  assert.ok(eng.indexOf(anime) < eng.indexOf("export function filmTemplate(") && eng.indexOf(anime) < eng.indexOf("export const LIVE_FILM_TEMPLATES = Object.values(FILM_TEMPLATES).filter((t) => t.live);"));
  for (const s of ANIME_STYLES) assert.ok(GENRE_FILMS.some((g) => g.key === s.kin), `${s.kin} is made by the line before`);
  // …told: after the briefs (the kin's is there), before the narratable keys are read off them
  const told = "for (const s of ANIME_STYLES) NARRATED_BRIEF[s.key] = animeBrief(NARRATED_BRIEF[s.kin], s);";
  assert.equal(count(eng, told), 1);
  assert.ok(eng.indexOf("  ...Object.fromEntries(GENRE_FILMS.map((g) => [g.key, g.narrated])),\n};") < eng.indexOf(told));
  assert.ok(eng.indexOf(told) < eng.indexOf("export const NARRATABLE_KEYS: string[] = Object.keys(NARRATED_BRIEF);"));
  // the writer: right after each of the three REAL_WORLD lines (the whole story, a long one's plan, one part of it),
  // whatever the story's world — the REAL_WORLD lines themselves as they were
  const drawnLine = "(tmpl.drawn ? `${DRAWN_WORLD}\\n` : \"\") +";
  assert.equal(count(eng, drawnLine), 3);
  assert.ok(eng.includes("    (storyFormat && !tmpl.childSafe && !tmpl.ownWorld ? `${REAL_WORLD}\\n` : \"\") +\n    " + drawnLine));
  assert.equal(count(eng, "(!tmpl.childSafe && !tmpl.ownWorld ? `${REAL_WORLD}\\n` : \"\") +\n"), 2);
  assert.equal(count(eng, "      (!tmpl.childSafe && !tmpl.ownWorld ? `${REAL_WORLD}\\n` : \"\") +\n      " + drawnLine), 1, "the plan");
  assert.equal(count(eng, "\n    (!tmpl.childSafe && !tmpl.ownWorld ? `${REAL_WORLD}\\n` : \"\") +\n    " + drawnLine), 1, "a part");
  // what it tells the writer
  assert.ok(DRAWN_WORLD.startsWith("THIS STORY IS DRAWN: every picture is one frame of a hand-drawn 2D anime film"));
  assert.ok(DRAWN_WORLD.includes("A VISUAL never says photo, photograph, photorealistic, lens, live-action or 3D."));
});

test("THE WIRING: a drawn story's narrator, and its style said first in every one of its pictures", () => {
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("import { ANIME_STYLES, drawnLead } from \"./anime-styles\";"));
  // the narrator: the style's own, else its kin's
  const loop = "for (const s of ANIME_STYLES) DEFAULT_NARRATOR[s.key] = s.narrator || DEFAULT_NARRATOR[s.kin] || \"English_ManWithDeepVoice\";";
  assert.equal(count(nar, loop), 1);
  assert.ok(nar.indexOf("export const DEFAULT_NARRATOR: Record<string, string> = {") < nar.indexOf(loop) && nar.indexOf("  mystery: \"English_ManWithDeepVoice\",\n};") < nar.indexOf(loop));
  assert.ok(nar.indexOf(loop) < nar.indexOf("export const narratorFor = "));
  assert.ok(nar.includes("English_SereneWoman and Retro by English_ConfidentWoman") && nar.includes("LISTEN before trusting either"));
  // `safe`: what every picture of the story is told first — the G-rating, and a drawn story's style
  assert.equal(count(nar, "const safe = "), 1);
  assert.ok(nar.includes("  const safe = `${tmpl.childSafe ? \"Wholesome, child-safe, G-rated, bright and friendly. \" : \"\"}${tmpl.drawn ? drawnLead(tmpl.key) : \"\"}`;"));
  // …said in all four picture asks of a told story, as it was: the sheets, the portraits, every scene, the lenient path
  assert.ok(nar.includes("placeSheetPrompt(p, tmpl.sceneHint, safe, !tmpl.childSafe && !tmpl.ownWorld)"));
  assert.ok(nar.includes("const ask = portraitPrompt(dressedInWater(e), tmpl.sceneHint, safe);"));
  assert.ok(nar.includes("const promptOf = (withPlace: boolean): string => `${safe}${visual.slice(0, 600)}"));
  assert.ok(nar.includes("await renderCreativeSeed(`${safe}${night ? `${NIGHT_LINE} ` : \"\"}"));
});
