/* THE STORY'S PLACES — the same ferry in scene 1 and in scene 6.
 *
 * A story's people have held still since 2026-11-23 (one portrait each: tests/story-cast.test.ts). Its world
 * did not. The first Horror Story made in one press (2026-11-24, "The Bride of the Black Water") had a night
 * ferry that was a rowing boat in scene 1, a ship with a great wheel in scene 3 and a ferry with a
 * wheelhouse in scene 6: every picture drew "the ferry" from the word.
 *
 * Tried before any of this was written — two worlds (that ferry, a lighthouse), the same scenes drawn three
 * ways, every picture LOOKED at:
 *   as today                          three different boats; three different lighthouses
 *   the place in the same words       closer in mood, still three different buildings
 *   ONE picture of it as a reference  the same place in every scene
 * …but not any picture. Handed an establishing view, the everyday picture model hands the same far view
 * back with a small figure painted in (3 of 6). What it cannot copy as a scene is a DESIGN SHEET — the
 * place on a plain background, three views, no scenery; with one line saying how near the camera is it
 * drew a new view of the right place 6 times of 6, and 4 of 4 with two people in it as well. So one extra
 * everyday picture per place, and no stronger model.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRAMED_FIX, FRAMED_SIZE, NOTHING_WRITTEN, PLACE_FRAMING, PLACE_SHEET_ASPECT, STORY_MODEL, STORY_PLACE_MAX,
  framedIn, framedMeasure, inheritPlaces, castToken, placeEntry, placeIn, placeKey, placeNamed, placeNote, placeSheetPrompt, placesOf, placesStillIn, readCastToken, recurringPlaces, scenePlace,
} from "../app/lib/story-picture.ts";
import { storyToEditFrom } from "../app/lib/story-edit.ts";
import { seriesBriefOf, seriesFromPayload, seriesPlaces, seriesWriterBrief } from "../app/lib/film-series.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// (a checkout with CRLF line endings must read the same as one with LF)
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

const FERRY = "the ferry: an old low black wooden river ferry with a small square wheelhouse at its stern, one iron lantern hook at its bow and a worn plank deck with a low rail";
const CHAPEL = "the chapel: a small white clapboard chapel with a crooked steeple and one round window";
// (the scenes of that Horror Story, as a writer told to name the place would write them)
const SCENES = [
  "Corin stands at the wheel of the ferry, one hand on its spokes, staring into the fog, his lantern at his side.",
  "Maren stands on the black water in the fog, her gown trailing, far from any shore.",
  "Corin grips the rail of the ferry, never looking at the pale figure beyond the bow.",
  "Maren steps onto the ferry's deck without a ripple, water pooling at her bare feet.",
  "Corin kneels frozen on the deck while Maren bends over him, her hollow eyes close to his.",
  "The empty ferry drifts against a reed bank at grey dawn, its lantern cold on its hook.",
];

test("a place as the writer gives it: a short name, a colon, one fixed look", () => {
  assert.deepEqual(placeEntry(FERRY), { name: "the ferry", look: "an old low black wooden river ferry with a small square wheelhouse at its stern, one iron lantern hook at its bow and a worn plank deck with a low rail" });
  assert.deepEqual(placeEntry("  The Lighthouse — a tall white stone tower with one red band  "), { name: "The Lighthouse", look: "a tall white stone tower with one red band" });
  assert.deepEqual(placeEntry("the bakery (a corner shop with a blue door)"), { name: "the bakery", look: "a corner shop with a blue door" });
  assert.deepEqual(placeEntry(""), { name: "", look: "" });
  // what it is called by in a scene's words: its name without the article
  assert.equal(placeKey("the ferry"), "ferry");
  assert.equal(placeKey("The Old Ferry"), "old ferry");
  assert.equal(placeKey("Corin's ferry"), "corin ferry");
  assert.equal(placeKey("a"), "", "an article alone names nothing");
});

test("which scenes are set there: the ones whose words call the place by its name", () => {
  assert.ok(placeIn("Corin stands at the wheel of the ferry", "the ferry"));
  assert.ok(placeIn("Maren steps onto the ferry's deck", "the ferry"), "…'s");
  assert.ok(placeIn("The Ferry drifts against a reed bank", "the ferry"), "whatever the capitals");
  assert.ok(placeIn("the empty ferry at dawn", "the old ferry"), "a longer name is also known by its last word");
  assert.ok(!placeIn("Maren stands on the black water", "the ferry"));
  assert.ok(!placeIn("a ferryman rows across", "the ferry"), "a whole word, not a part of one");
  assert.ok(!placeIn("the wheelhouse door stands open", "the house"));
  assert.ok(!placeIn("anything at all", ""), "no name, no place");
  // a scene is set at ONE place: the first in the story's list that it names
  const places = [placeEntry(FERRY), placeEntry(CHAPEL)];
  assert.deepEqual(SCENES.map((v) => scenePlace(v, places)), [0, -1, 0, 0, -1, 0]);
  assert.equal(scenePlace("Corin ties up the ferry below the chapel", places), 0);
  assert.equal(scenePlace("Corin kneels in the chapel", places), 1);
});

test("the words say where: a scene the writer set at a place, whose words do not name it, is given the name", () => {
  // The first story made on the live site with places (2026-11-24, the same ferry story): five scenes named
  // "the ferry" and were drawn from its sheet — the same boat in each. The sixth, "…inside the wheelhouse
  // doorway…", is the ferry's wheelhouse and never says so: it was drawn with no sheet.
  const RIVER = "the river: a wide black slow-moving river with a thick rolling fog hanging low over its surface";
  const six = "Maren stands facing Corin inside the wheelhouse doorway, her hollow grey eyes inches from his face.";
  assert.equal(placeNamed(six, "the ferry", [FERRY, RIVER]), `At the ferry: ${six}`);
  assert.equal(placeNamed(six, "The Ferry", [FERRY]), `At the ferry: ${six}`, "the place's own name, as the story lists it");
  // words that already name one of the story's places are believed as they are — whatever the mark says
  assert.equal(placeNamed(SCENES[0], "the ferry", [FERRY, RIVER]), SCENES[0]);
  assert.equal(placeNamed("On the river, Maren stands motionless upon the black water.", "the ferry", [FERRY, RIVER]), "On the river, Maren stands motionless upon the black water.");
  // no mark, a mark that is no place of this story, no words: nothing is added
  assert.equal(placeNamed(six, "", [FERRY]), six);
  assert.equal(placeNamed(six, "the chapel", [FERRY]), six);
  assert.equal(placeNamed(six, "the ferry", []), six);
  assert.equal(placeNamed("", "the ferry", [FERRY]), "");
  // …and with it the sixth scene is one of the ferry's
  const visuals = [...SCENES.slice(0, 5), placeNamed(six, "the ferry", [FERRY])];
  assert.deepEqual(recurringPlaces(visuals, [FERRY])[0].scenes, [0, 2, 3, 5]);
  // the writer: asked for each scene's place, read before the scenes are tidied, folded into the words at the end
  const engine = read("app", "lib", "film-engine.server.ts");
  assert.ok(engine.includes("And every scene also has a third field, PLACE: the name of the one of them that picture is set at, in or on"));
  assert.ok(engine.includes("where: { type: \"string\" }, place: { type: \"string\" }, shot: { type: \"string\" },"));
  const read1 = engine.indexOf("const saidPlaces = list.map((s) => (typeof (s as { place?: unknown }).place === \"string\"");
  const tidy = engine.indexOf("list = list.map((s, i) => ({\n    visual: s.visual,");
  const fold = engine.indexOf("if (places.length) list = list.map((s, i) => ({ ...s, visual: placeNamed(s.visual, placeMarks[i], places) }));");
  assert.ok(read1 > 0 && tidy > read1 && fold > tidy, "read, tidied, then folded");
});

test("a sheet is drawn for a place the story COMES BACK to — two scenes or more, two places at most", () => {
  assert.equal(STORY_PLACE_MAX, 2);
  assert.deepEqual(recurringPlaces(SCENES, [FERRY]), [{ ...placeEntry(FERRY), scenes: [0, 2, 3, 5] }]);
  // a place seen once cannot drift: no sheet
  assert.deepEqual(recurringPlaces([...SCENES, "Corin kneels in the chapel at noon."], [FERRY, CHAPEL]).map((p) => p.name), ["the ferry"]);
  // the most used first; never a third; a place listed twice counts once; an entry with no look is no design
  const three = recurringPlaces(
    ["at the mill", "at the mill", "in the barn", "in the barn", "in the barn", "by the well", "by the well"],
    ["the mill: a grey stone watermill with a broken wheel and ivy on its north wall", "the barn: a red timber barn with a sagging roof and one white door", "the well: a round mossy stone well with a wooden crank and a tin bucket", "The Barn: listed twice by mistake, described differently here"],
  );
  assert.deepEqual(three.map((p) => [p.name, p.scenes]), [["the barn", [2, 3, 4]], ["the mill", [0, 1]]]);
  assert.deepEqual(recurringPlaces(["on the ferry", "on the ferry"], ["the ferry", "the ferry: a boat"]), [], "nothing to draw it from");
  assert.deepEqual(recurringPlaces(SCENES, []), []);
  assert.deepEqual(recurringPlaces([], [FERRY]), []);
  // (a story written before the writer was asked for places has none — nothing changes for it)
  assert.deepEqual(recurringPlaces(SCENES, undefined as unknown as string[]), []);
});

test("the design sheet: the place and nothing else, on a plain ground — so it cannot be copied as a scene", () => {
  const p = placeSheetPrompt(placeEntry(FERRY), "dark cinematic horror illustration");
  assert.ok(p.startsWith("A DESIGN SHEET of one place, for artists to copy it from: the ferry — an old low black wooden river ferry"));
  assert.ok(p.includes("shown in three views on a plain pale-grey studio background"));
  assert.ok(p.includes("no scenery, no sky, no ground, no weather around it"), "an establishing view was handed back with a figure painted into it");
  assert.ok(p.includes("Style: dark cinematic horror illustration."), "in the story's own style");
  assert.ok(p.includes("No people, no animals, no figures anywhere.") && p.endsWith(NOTHING_WRITTEN));
  assert.ok(placeSheetPrompt(placeEntry(FERRY), "x", "Wholesome, child-safe. ").startsWith("Wholesome, child-safe. A DESIGN SHEET"));
  assert.equal(PLACE_SHEET_ASPECT, "1:1");
  // what a scene is told about it: which reference it is, that it is the SAME one, and a NEW view of it
  const n = placeNote(3, placeEntry(FERRY));
  assert.ok(n.startsWith("Reference image 3 is a design sheet of the ferry (an old low black wooden river ferry"));
  assert.ok(n.includes("the PLACE this picture is set in") && n.includes("the same shapes, colours, materials and details"));
  assert.ok(n.includes("a NEW view of the same place") && n.includes("The sheet's plain background and its three views are NOT part of this picture: this is a scene that fills the whole frame"));
  // …and how near the camera is, when there are people in it (without it a figure came out small)
  assert.ok(PLACE_FRAMING.includes("each one fills at least a third of the picture's height"));
  // every picture of a told story — a place's design sheet too — is drawn on the good model (story-picture.ts → STORY_LADDER)
  assert.equal(STORY_MODEL, "google/nano-banana-pro");
});

test("the sheets travel in the cast's token — and only pictures on our own renders disk", () => {
  const cards = [{ name: "Corin", look: "a weathered night ferryman", img: "/renders/c1.jpg" }];
  const places = [{ name: "the ferry", look: "an old low black wooden river ferry", img: "https://easymodeapp.com/renders/f1.jpg?v=2" }];
  const token = castToken(cards, places);
  assert.equal(token, JSON.stringify({ v: 2, c: [{ n: "Corin", l: "a weathered night ferryman", i: "/renders/c1.jpg" }], p: [{ n: "the ferry", l: "an old low black wooden river ferry", i: "/renders/f1.jpg" }] }));
  assert.deepEqual(readCastToken(token), { refs: cards, sheet: null, places: [{ name: "the ferry", look: "an old low black wooden river ferry", img: "/renders/f1.jpg" }] });
  // a story with a place and nobody of its own still has a token
  assert.deepEqual(readCastToken(castToken([], places)).places.map((p) => p.name), ["the ferry"]);
  assert.deepEqual(readCastToken(castToken([], places)).refs, []);
  // a token written before places has none, and reads as it always did
  assert.equal(castToken(cards), JSON.stringify({ v: 2, c: [{ n: "Corin", l: "a weathered night ferryman", i: "/renders/c1.jpg" }] }));
  assert.deepEqual(readCastToken(castToken(cards)).places, []);
  // what is not a picture of ours never gets in, written or read; two at most; nothing twice
  assert.equal(castToken([], [{ name: "x", look: "", img: "https://evil.example/x.jpg" }, { name: "y", look: "", img: "/renders/../y.jpg" }, { name: "", look: "", img: "/renders/z.jpg" }]), "");
  assert.deepEqual(readCastToken(JSON.stringify({ v: 2, c: [], p: [{ n: "a", l: "", i: "https://evil.example/a.jpg" }, { n: "b", l: 4, i: "/renders/b.png" }, { n: "B", l: "", i: "/renders/b2.png" }, "nonsense"] })).places, [{ name: "b", look: "", img: "/renders/b.png" }]);
  assert.equal(readCastToken(castToken([], Array.from({ length: 5 }, (_, k) => ({ name: `p${k}`, look: "", img: `/renders/p${k}.jpg` })))).places.length, STORY_PLACE_MAX);
  // a full token still fits the form field it rides in (4,000)
  const fat = (n: number) => Array.from({ length: n }, (_, k) => ({ name: "N".repeat(60) + k, look: "l".repeat(900), img: `/renders/${"a".repeat(40)}${k}.jpg` }));
  assert.ok(castToken(fat(4), fat(2)).length < 2100, `a full token is ${castToken(fat(4), fat(2)).length} characters`);
});

test("a finished story keeps its places, and a carried sheet is only used by a story that still has that place", () => {
  const meta = { kind: "narrated", places: [{ name: "the ferry", look: "an old low black wooden river ferry", img: "/renders/f1.jpg" }, { name: "elsewhere", look: "", img: "https://evil.example/e.jpg" }] };
  assert.deepEqual(placesOf(meta), [{ name: "the ferry", look: "an old low black wooden river ferry", img: "/renders/f1.jpg" }]);
  assert.deepEqual(placesOf(JSON.stringify(meta)).length, 1);
  for (const m of [null, undefined, "", "{", 3, [], {}, { places: "x" }]) assert.deepEqual(placesOf(m), []);
  const carried = placesOf(meta);
  assert.deepEqual(placesStillIn(carried, [FERRY]), carried);
  assert.deepEqual(placesStillIn(carried, ["The Ferry: described anew"]), carried, "by its name, whatever the capitals");
  assert.deepEqual(placesStillIn(carried, [CHAPEL]), [], "another story's ferry is not this story's chapel");
  assert.deepEqual(placesStillIn(carried, []), []);
  // the pipeline writes them onto the finished piece beside its cast
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("...(readCastToken(storyCastRef).places.length ? { places: readCastToken(storyCastRef).places } : {}),"));
});

test("where the pictures are drawn: one sheet per place, beside the portraits, then every scene set there", () => {
  const nar = read("app", "lib", "narrated-story.server.ts");
  const fn = nar.slice(nar.indexOf("export async function narratedSceneSeeds("), nar.indexOf("/** DRAW ONE CHARACTER AGAIN."));
  // which places: the ones the WHOLE story comes back to (not only the scenes drawn in this call) — and one switch
  assert.ok(fn.includes("const wanted = process.env.STORY_PLACES !== \"off\" && !sheetRef ? recurringPlaces(scenes.map((s) => s?.visual || \"\"), placeList, placeCards.map((c) => c.name)) : [];"));
  // a sheet that came in with the token is used again when it is still this story's and still on our disk
  assert.ok(fn.includes("const placeCards: StoryPlaceRef[] = placesStillIn(carried.places, placeList).filter((c) => fs.existsSync(path.join(RENDERS(), path.basename(c.img))));"));
  assert.ok(fn.includes("const needPlaces = wanted.filter((p) => p.scenes.some((i) => todo.includes(i)) && !sheetFor(p.name));"), "only a sheet a scene being drawn NOW needs, and does not have");
  // drawn on the everyday model, square, from words alone — STARTED before the portraits and awaited after
  // them, so a story's pictures take no longer than they did
  const start = fn.indexOf("const sheetsDrawing = Promise.all(needPlaces.map(async (p) => ({ p, img: await drawScene(placeSheetPrompt(p, tmpl.sceneHint, safe, !tmpl.childSafe), [], PLACE_SHEET_ASPECT) })));");
  const portraits = fn.indexOf("const drawn = await Promise.all(need.map(async (e) =>");
  const done = fn.indexOf("for (const d of await sheetsDrawing) if (d.img) placeCards.push({ name: d.p.name, look: d.p.look, img: d.img });");
  assert.ok(start > 0 && portraits > start && done > portraits, "started, then the portraits, then awaited");
  // a scene: the people first, the place's sheet LAST — and not counted as a person when the model is chosen
  assert.ok(fn.includes("const setAt = wanted.find((p) => p.scenes.includes(i));"));
  assert.ok(fn.includes("const refs = [...people, ...(placeUrl ? [placeUrl] : [])];"));
  assert.ok(fn.includes("const placeNotes = place && placeUrl ? [placeNote(refs.length, place), ...(here.length && !cam ? [PLACE_FRAMING] : [])] : [];"), "the framing line only where there are people to frame — and only for a scene with no camera line of its own (it made every picture at a place the same medium two-shot)");
  assert.ok(fn.includes("const got = await drawScene(`${promptOf(withPlace)}${fix}`, withPlace ? refs : people, aspect);"));
  // a sheet that could not be drawn changes nothing: the scene is drawn from its words, as before
  assert.ok(fn.includes("const place = setAt ? sheetFor(setAt.name) : undefined;"));
  // what comes back: the token with the places in it, and the sheets themselves
  assert.ok(fn.includes("castRef: carried.sheet || castToken(cards, placeCards) || null, castCards: cards, placeCards,"));
});

test("the writer is asked for the story's places — a told story only — and they ride with its treatment", () => {
  const engine = read("app", "lib", "film-engine.server.ts");
  assert.ok(engine.includes("places: { type: \"array\", items: { type: \"string\" } },"), "in what the writer may return");
  // (2026-11-25, stories up to five minutes: what a story's places ARE is said once, in PLACES_ARE, so that a long
  //  story's PLAN can be asked for them — film-length.ts — and each of its parts told the ones the plan chose)
  assert.ok(engine.includes("const PLACES_ARE = `the ONE or TWO places or things this story keeps coming back to"));
  const ask = engine.indexOf("Also return \"places\": ${PLACES_ARE} ${PLACE_FIELD}\\n`");
  const narr = engine.indexOf("Write it as a NARRATED STORY: a storyteller's voice tells it over illustrated scenes");
  const acted = engine.indexOf("Write it as a SHORT FILM SCENE with CHARACTER DIALOGUE.");
  assert.ok(narr > 0 && ask > narr && ask < acted, "asked in the told story's brief and nowhere else");
  // …and outside that brief, only a told story's plan is asked about places that way
  assert.equal(engine.split("${PLACES_ARE}").length - 1, 1);
  assert.ok(engine.includes("planBrief(way, { sizes: partSizes, ending, placesAsk: narrated ? PLACES_ARE : undefined })"));
  assert.ok(engine.includes("Only what at least TWO pictures are set at, in or on; never a person or an animal; no weather or time of day in it; an empty list when the story has no such place."));
  assert.ok(engine.includes("Every VISUAL set there calls it by that exact name"), "that is how a scene is known to be set there");
  // …and it MUST answer (an empty list when the story has none). Left optional, the writer skipped it for a
  // Moral Story that goes back to "the well" in five of six pictures (live, 2026-11-24): the well was a ring
  // of rubble, then a well with a pulley, then a square one under trees.
  assert.ok(engine.includes("const NARRATED_SCHEMA = { ...TREATMENT_SCHEMA, required: [...TREATMENT_SCHEMA.required, \"places\"] } as const;"));
  assert.ok(engine.includes("schema: (narrated ? NARRATED_SCHEMA : TREATMENT_SCHEMA) as unknown as Record<string, unknown> },"), "a film that is acted or sung is not asked");
  // kept only for a told story; two at most; nothing too short to be a description
  assert.ok(engine.includes("const listed = narrated && Array.isArray(parsed.places)"));
  assert.ok(engine.includes(".filter((p) => p.length > 12).slice(0, 2)"));
  assert.ok(engine.includes("...(places.length ? { places } : {}), cast,"));
});

test("the page: the token keeps its places, a scene drawn again knows them, and the storyboard shows them", () => {
  const page = read("app", "routes", "web.film.tsx");
  assert.ok(page.includes("const castRefIn = (name: string): string => { const t = readCastToken(((form.get(name) as string) || \"\").trim().slice(0, 4000)); return castToken(t.refs, t.places); };"));
  // a re-rolled scene, and the scenes drawn again with ONE character, are set where they were
  assert.ok(page.includes("if (Array.isArray(tObj.places)) placeBible = tObj.places.filter((x: unknown) => typeof x === \"string\").slice(0, 2);"));
  assert.ok(page.includes("treatment: { title: \"\", musicMood: \"\", cast: castBible, places: placeBible, scenes: scenesNow.map("));
  assert.ok(page.includes("const r = await recastStoryCharacter({ template: tmpl.key, treatment: { title: \"\", musicMood: \"\", cast: castBible, places: placeBible, scenes: scenesNow }, cast: storyCast,"));
  // the row: the places stand beside the cast, read from the same token the portraits travel in
  assert.ok(page.includes("const places = readCastToken(seeds.castRef).places;"));
  assert.ok(page.includes("<div key={`place|${p.img}`} className=\"mm-star is-place\" style={{ [\"--i\" as string]: stars.length + k }}>"), "…and walks on after the last of the cast (tests/alive-details.test.ts)");
  assert.ok(page.includes("<span className=\"mm-star-tag\"><Ico n=\"image\" size={10} /> {t(\"Place\")}</span>"));
  assert.ok(page.includes("<span className=\"mm-star-nm\">{p.name.charAt(0).toUpperCase() + p.name.slice(1)}</span>"));
  // a design sheet is square: its card is as tall as a portrait's and as wide as it is tall — shown whole
  assert.ok(page.includes(".mm-star.is-place{flex-basis:144px;width:144px;}") && page.includes(".mm-star.is-place .mm-star-pic{width:144px;}") && page.includes(".mm-star.is-place .mm-star-pic img{object-position:center;}"));
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Place", "It looks like this in every scene."]) assert.equal(dict.split(`${JSON.stringify(k)}:`).length - 1, 5, k);
});

test("a story opened again to be edited comes back with its places", () => {
  const treatment = { title: "The Bride of the Black Water", musicMood: "low strings", cast: ["Corin, a weathered night ferryman"], places: [FERRY, 7, ""], scenes: SCENES.map((visual) => ({ visual, caption: "They say old Corin has ferried these waters longer than anyone can remember." })) };
  const asset = {
    id: "a1", title: "Horror Story — The Bride of the Black Water",
    metaJson: JSON.stringify({ kind: "narrated", template: "horror", aspect: "9:16", places: [{ name: "the ferry", look: "an old low black wooden river ferry", img: "/renders/f1.jpg" }, { name: "the chapel", look: "", img: "/renders/ch.jpg" }] }),
    bodyJson: JSON.stringify({ videoUrl: "/renders/nar-1-abc.mp4", treatment }),
  };
  const st = storyToEditFrom(asset, SCENES.map((_, i) => `/renders/s${i}.jpg`));
  assert.ok(st);
  assert.deepEqual(st!.treatment.places, [FERRY], "the list the writer gave — only what is a description");
  assert.deepEqual(readCastToken(st!.castRef).places, [{ name: "the ferry", look: "an old low black wooden river ferry", img: "/renders/f1.jpg" }], "the ferry's own sheet; not a sheet the story no longer has a place for");
  // a story made before places: nothing added, the token as it was
  const old = storyToEditFrom({ ...asset, metaJson: JSON.stringify({ kind: "narrated", template: "horror", aspect: "9:16" }), bodyJson: JSON.stringify({ videoUrl: "/renders/nar-1-abc.mp4", treatment: { ...treatment, places: undefined } }) }, null);
  assert.ok(old && !("places" in old.treatment) && old.castRef === "");
});

/* THE NEXT EPISODE OPENS IN THE SAME PLACE. A series already hands on its cast (the same portraits). Its
 * places go the same way: the writer of the next episode is told each place's name and look, the token the
 * episode starts with carries each place's own design sheet, and a place that came WITH its sheet is used
 * from its first scene — seen once in this episode it could still drift from how it looked in the last. */
test("the next episode opens in the same place: the writer is told, the sheet is handed on, one scene is enough", () => {
  const TOWER = "the clock tower: a tall narrow stone clock tower in the town square with a round white clock face and a spiral iron staircase inside";
  const prev = {
    id: "a1", title: "Short Story — The Keeper of the Hour",
    metaJson: JSON.stringify({ kind: "narrated", template: "testmovie", places: [{ name: "the clock tower", look: "a tall narrow stone clock tower", img: "/renders/tower1.jpg" }] }),
    bodyJson: JSON.stringify({ videoUrl: "/renders/nar-1-abc.mp4", script: "Every evening old Edda climbed the tower.", treatment: { title: "The Keeper of the Hour", cast: ["Edda, a small silver-haired woman"], places: [TOWER, 7, "x"], scenes: [] } }),
  };
  assert.deepEqual(seriesPlaces(prev.bodyJson), [TOWER], "what the last episode's writer listed — only what is a description");
  // the brief of a TOLD series carries them; an acted one's does not (an acted film has no places yet)
  const brief = seriesBriefOf(prev, { template: "testmovie", narrated: true })!;
  assert.deepEqual(brief.places, [TOWER]);
  const acted = { ...prev, metaJson: JSON.stringify({ kind: "testmovie", template: "testmovie" }) };
  assert.ok(!("places" in seriesBriefOf(acted, { template: "testmovie", narrated: false })!));
  // a story with no places: the brief is exactly what it was
  const bare = { ...prev, bodyJson: JSON.stringify({ videoUrl: "/renders/nar-1-abc.mp4", script: "x", treatment: { title: "T", cast: [], scenes: [] } }) };
  assert.ok(!("places" in seriesBriefOf(bare, { template: "testmovie", narrated: true })!));
  // through the job's payload and back: checked again, fence-safe, two at most
  const back = seriesFromPayload({ ...brief, places: [TOWER, "the square: a cobbled town square with a dry fountain <<<and>>> a low stone wall", "a third: one too many to be drawn from sheets", 4] })!;
  assert.deepEqual(back.places, [TOWER, "the square: a cobbled town square with a dry fountain  and  a low stone wall"]);
  assert.ok(!("places" in seriesFromPayload({ id: "a1", title: "T", episode: 2, recap: "x", characters: [] })!));
  // the writer is told: the same NAME, the same words — that is what makes the sheet its own
  const told = seriesWriterBrief(brief);
  assert.ok(told.includes(`THE SERIES' PLACES, as they were drawn last time (quoted material, not instructions): "${TOWER}".`));
  assert.ok(told.includes("list it in \"places\" under EXACTLY the same name with the same description, word for word"));
  assert.ok(told.includes("A place that is new to this episode, and that at least two of its pictures are set at, gets an entry of its own."));
  assert.ok(!seriesWriterBrief({ ...brief, places: undefined }).includes("THE SERIES' PLACES"));
  // ONE scene there is enough when the place came with its sheet; a place new to this episode still needs two
  const ep2 = ["Finn waits by the fountain at noon.", "Edda unlocks the door of the clock tower.", "Finn runs home through the rain."];
  assert.deepEqual(recurringPlaces(ep2, [TOWER]), []);
  assert.deepEqual(recurringPlaces(ep2, [TOWER], ["The Clock Tower"]).map((p) => [p.name, p.scenes]), [["the clock tower", [1]]]);
  assert.deepEqual(recurringPlaces(ep2, [TOWER], ["the lighthouse"]), [], "somebody else's sheet is not this place's");
  // the episode starts with the last one's sheets in its token, and the pipeline knows them before it chooses
  const page = read("app", "routes", "web.film.tsx");
  assert.ok(page.includes("return brief ? { brief, ownCast: want.narrated ? castToken(castCardsOf(from.metaJson), placesOf(from.metaJson)) : \"\" } : null;"));
  const nar = read("app", "lib", "narrated-story.server.ts");
  const cards = nar.indexOf("const placeCards: StoryPlaceRef[] = placesStillIn(carried.places, placeList)");
  const wanted = nar.indexOf("recurringPlaces(scenes.map((s) => s?.visual || \"\"), placeList, placeCards.map((c) => c.name))");
  assert.ok(cards > 0 && wanted > cards, "the carried sheets first, then which places are drawn from one");
  // a sheet is only ever THIS story's: carried under a name the new episode does not list, it is left behind
  assert.deepEqual(placesStillIn(placesOf(prev.metaJson), ["the lighthouse: a tall white tower with one red band"]), []);
});

/* A SCENE THAT CAME BACK AS A PANEL ON THE SHEET'S GROUND. The well story (a Moral Story, wide, made on the live
 * site, 2026-11-24): five scenes drew their place right. The sixth — "Inside the burrow, Rusk lies curled…" —
 * came back as a small framed picture floating in a pale-grey frame: the look of the burrow's design sheet,
 * copied. Measured on the 81 pictures saved that night: that one read flat 4 / same 0 with all four sides
 * straight; the nearest real scene (a ferry in fog) read flat 19 with no straight side at all. */
test("a scene that comes back as a framed panel on a plain ground is drawn again — and never kept", () => {
  const S = FRAMED_SIZE;
  const picture = (paint: (x: number, y: number) => [number, number, number]): Uint8Array => {
    const px = new Uint8Array(S * S * 3);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const [r, g, b] = paint(x, y); const k = (y * S + x) * 3; px[k] = r; px[k + 1] = g; px[k + 2] = b; }
    return px;
  };
  const noise = (x: number, y: number): number => ((x * 37 + y * 91) % 23) - 11;
  // the failure: a pale-grey ground, a darker picture with straight sides in the middle of it
  const panel = picture((x, y) => (x >= 14 && x < 82 && y >= 20 && y < 76 ? [70 + noise(x, y), 48 + noise(y, x), 30] : [205, 206, 210]));
  assert.equal(framedIn(panel), true);
  assert.deepEqual(framedMeasure(panel), { flat: 0, same: 0, left: true, right: true, top: true, bottom: true });
  // …also when the ground is not perfectly flat (a soft studio gradient, a little grain)
  assert.equal(framedIn(picture((x, y) => (x >= 14 && x < 82 && y >= 20 && y < 76 ? [70 + noise(x, y), 48, 30] : [200 + Math.round(y / 12), 201 + Math.round(y / 12), 206 + (noise(x, y) > 8 ? 2 : 0)]))), true);
  // a real scene: sky above, ground below — its edges are not one colour
  assert.equal(framedIn(picture((x, y) => (y < 40 ? [150 + y, 170 + y, 220] : [120 + noise(x, y), 90, 60]))), false);
  // a figure in fog: every edge is the same soft grey, but nothing inside has straight sides
  const fog = picture((x, y) => { const d = Math.hypot(x - 48, y - 52); return d < 18 + (y % 7) ? [40, 42, 50] : [150, 152, 158]; });
  assert.equal(framedMeasure(fog)!.flat <= 34, true);
  assert.equal(framedIn(fog), false, "a round shape in a plain field is a picture, not a panel");
  // a plain field with nothing in it, and nonsense
  assert.equal(framedIn(picture(() => [205, 206, 210])), false);
  assert.equal(framedIn(new Uint8Array(10)), false);
  assert.equal(framedMeasure(new Uint8Array(10)), null);
  // black bars are the other check's (cropdetect): bars left and right alone are not "all four edges"
  assert.equal(framedIn(picture((x, y) => (x < 16 || x >= 80 ? [0, 0, 0] : [120 + noise(x, y), 140 + (y % 9) * 8, 90]))), false);

  // THE PIPELINE: measured only where a place's sheet was used; told once; the third go leaves the sheet out
  const nar = read("app", "lib", "narrated-story.server.ts");
  const fn = nar.slice(nar.indexOf("export async function narratedSceneSeeds("), nar.indexOf("/** DRAW ONE CHARACTER AGAIN."));
  assert.ok(fn.includes("const withPlace = placeNotes.length > 0 && framedGoes < 2;"));
  assert.ok(fn.includes("if (got && withPlace && (await framedPanel(got))) { framedGoes++; fix = FRAMED_FIX;"));
  assert.ok(fn.includes("const promptOf = (withPlace: boolean): string =>") && fn.includes("${[...notes, ...(withPlace ? placeNotes : [])].join(\" \")}"), "without its sheet a scene is drawn from its words, as before");
  assert.ok(FRAMED_FIX.includes("fills the whole frame from edge to edge"));
  // a framed panel is never the picture that is kept: only a clean picture, the best of the looked-at ones,
  // or a letterboxed one are
  assert.ok(fn.includes("if (!img && best) { img = best.img;") && fn.includes("if (!img) img = barred;"));
  assert.ok(!/img = (?:boxed|framed)/.test(fn));
  // read from the picture itself, at a small size; a picture that cannot be read is not called one
  const m = nar.slice(nar.indexOf("async function framedPanel("), nar.indexOf("/** THE POSTER (story-poster.ts)"));
  assert.ok(m.includes("\"-vf\", `scale=${FRAMED_SIZE}:${FRAMED_SIZE}`, \"-frames:v\", \"1\", \"-f\", \"rawvideo\", \"-pix_fmt\", \"rgb24\", raw]);"));
  assert.ok(m.includes("return framedIn(new Uint8Array(fs.readFileSync(raw)));") && m.includes("} catch { return false; }"));
  assert.ok(m.includes("finally { try { fs.unlinkSync(raw); } catch { /* nothing to clear */ } }"), "the scratch file is cleared either way");
});

/* TOLD, THEN CHECKED. Episode 2 of the clock-tower story, made on the live site the hour the hand-on shipped:
 * the writer named "the clock tower" in five of six scenes — and listed no places. The tower's sheet went
 * unused; drawn from words, the tower was a church with a spire in one scene and a gothic steeple in another. */
test("the places a story inherited are kept whether or not its writer lists them", () => {
  const TOWER = "the clock tower: a tall narrow stone clock tower in the town square with a round white clock face and a spiral iron staircase inside";
  const SHOP = "the workshop: a cramped clockmaker's workshop with a cluttered bench under one green lamp";
  const ep2 = [
    "Finn stands in the square at dawn, staring up at the clock tower.",
    "Finn climbs the spiral iron staircase inside the clock tower.",
    "Inside the workshop, Mr. Callum holds a small brass gear up to the lamplight.",
  ];
  // the writer listed nothing: the tower its scenes name is listed for it, under its own name and words
  assert.deepEqual(inheritPlaces([], [TOWER], ep2), [TOWER]);
  // …listed the tower in other words: the words that match its sheet win, and its own new place follows
  assert.deepEqual(inheritPlaces(["The Clock Tower: a grand gothic steeple with a golden dial", SHOP], [TOWER], ep2), [TOWER, SHOP]);
  // …listed it and its scenes do not happen to name it: still its place
  assert.deepEqual(inheritPlaces(["the clock tower: something else entirely here"], [TOWER], ["Finn waits by the fountain."]), [TOWER]);
  // an episode set somewhere else does not drag the old place along
  assert.deepEqual(inheritPlaces([SHOP], [TOWER], ["Inside the workshop, Edda mends a gear.", "Finn sweeps the workshop floor."]), [SHOP]);
  assert.deepEqual(inheritPlaces([], [TOWER], ["Finn waits by the fountain."]), []);
  // two at most, the inherited ones first; nothing twice; a story with no earlier places is as it was
  assert.deepEqual(inheritPlaces([SHOP, "the bakery: a corner bakery with a blue door and a striped awning"], [TOWER, TOWER], ep2), [TOWER, SHOP]);
  assert.deepEqual(inheritPlaces([SHOP], [], ep2), [SHOP]);
  assert.deepEqual(inheritPlaces([SHOP], undefined as unknown as string[], ep2), [SHOP]);
  // the writer step: read, then checked against the series it continues — a told story only
  const engine = read("app", "lib", "film-engine.server.ts");
  assert.ok(engine.includes("let places = narrated ? inheritPlaces(listed, series?.places || [], list.map((s) => s.visual)) : [];"));
  // and with the place back in the list, the sheet the episode arrived with is used from its first scene
  const visuals = ["Finn waits by the fountain.", "Edda unlocks the door of the clock tower."];
  assert.deepEqual(recurringPlaces(visuals, inheritPlaces([], [TOWER], visuals), ["the clock tower"]).map((p) => p.scenes), [[1]]);
});

test("a story whose writer listed no place is asked again, about nothing else", async () => {
  // With a shot list in its brief the live writer returned an empty "places" three times out of three
  // (2026-11-24) — and a story's ring of stones was low boulders, then tall megaliths, then an arch.
  const { placesAsk, takePlaces } = await import("../app/lib/story-picture.ts");
  const visuals = [
    "Howl crouches low behind a fallen log at the forest's edge.",
    "Wide shot of the clearing: thirteen bare black stones ringing bonfire light, Konrad and Greta small figures.",
    "Over Konrad's dark shoulder, looking across the clearing at Greta.",
    "Near and far: Howl's clawed hand gripping the fallen log; far off, Greta inside the stone ring.",
  ];
  const q = placesAsk(visuals);
  assert.ok(q.startsWith("These are the pictures of ONE illustrated story, in order:\n1. Howl crouches low behind a fallen log at the forest's edge.\n2. Wide shot of the clearing"));
  assert.ok(q.includes("Name the ONE or TWO places or things that at least TWO of these pictures are set at, in, on or beside"));
  assert.ok(q.includes("a short plain name beginning with \"the\" (use the words the pictures already use for it)"));
  assert.ok(q.includes("Never a person or an animal; no weather and no time of day in it."));
  assert.ok(q.endsWith("Reply with ONLY this JSON: {\"places\": [\"name: look\"], \"scenes\": [\"a name, or an empty string, for each picture\"]}."));
  // its answer, checked: a mark per scene, only a listed name, and only a place TWO scenes share
  const ring = "the stone ring: thirteen bare black standing stones, waist-high and rough, in a ring around one fire pit of ash, pale stripped trees close behind them";
  assert.deepEqual(takePlaces({ places: [ring, "the fallen log: a mossy log"], scenes: ["the fallen log", "The Stone Ring", "the stone ring", "the stone ring", "extra"] }, 4), {
    places: [ring],
    marks: ["", "the stone ring", "the stone ring", "the stone ring"],
  }, "the log is in one scene only — it is no recurring place");
  assert.deepEqual(takePlaces({ places: [ring], scenes: ["", "the stone ring"] }, 4), { places: [], marks: ["", "", "", ""] }, "one scene is not a place the story comes back to");
  assert.deepEqual(takePlaces({ places: ["x", 4, "no colon here at all, just words"], scenes: [] }, 3), { places: [], marks: ["", "", ""] });
  assert.deepEqual(takePlaces(null, 2), { places: [], marks: ["", ""] });
  assert.equal(takePlaces({ places: [ring, ring.replace("stone ring", "old well"), ring.replace("stone ring", "third place")], scenes: ["the stone ring", "the stone ring", "the old well", "the old well"] }, 4).places.length, 2, "two at most");

  const engine = read("app", "lib", "film-engine.server.ts");
  assert.ok(engine.includes("if (narrated && !places.length && list.length >= 3 && process.env.STORY_PLACES !== \"off\") {"), "a told story only, only when none was listed, and never with places switched off");
  assert.ok(engine.includes("const asked = takePlaces(JSON.parse(raw), list.length);"));
  assert.ok(engine.includes("if (asked.places.length) { places = asked.places; placeMarks = asked.marks; }"));
  assert.ok(engine.includes("the places could not be asked for, the story is drawn from its words"), "never fatal");
  // …and a scene it marks says so in its own words, exactly as when the writer had marked it
  assert.ok(engine.indexOf("places = asked.places; placeMarks = asked.marks;") < engine.indexOf("visual: placeNamed(s.visual, placeMarks[i], places)"));
});
