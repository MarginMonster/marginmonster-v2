/* PART 2 IS THE SAME FILM, CONTINUED (S10b — app/lib/film-series.ts, app/lib/film-dialogue.server.ts).
 *
 * The owner, 2026-11-25: "We also need for every video in archive "Make it a series" start on next part or episode
 * two / 3 /4 intelligently know. It should carry the cast / the scenes etch into the next part. For example this video
 * made- need the ability to pick up where left off to continue ! Yanno?"
 *
 * What broke: an acted film recorded only the cast the maker PICKED. The faces it invented (cut from its first master)
 * were thrown away, so an episode 2 drew new people under the same names; its places were drawn again from words; its
 * monster was drawn again; and nothing of how it ENDED reached the next film's pictures.
 *
 * Every name below is made up; the films are TEST films.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CARRY_PLACES_MAX, OPENS_THERE, carriedPlaceFor, carriedThreat, carryRecord, castWithCarry, lightOf, nextEpisodeCards, opensWhereItEnded,
  picksUpOf, placeHead, samePlace, sameThing, seriesBriefOf, seriesCarryOf, seriesFromPayload, seriesWriterBrief, type SeriesCarry,
} from "../app/lib/film-series.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const J = JSON.stringify;

/* ---- THE LAKE FILM, made up: two invented campers, a tent, a shore, a woman in the lake ---- */
const TENT = "inside a small dome tent pitched beside a still lake, at 3am";
const SHORE = "the lake shore outside the tent, at night";
const TENT_KEY = TENT.toLowerCase().slice(0, 60);
const SHORE_KEY = SHORE.toLowerCase().slice(0, 60);
const CAST_LINES = ["Testa, a wiry climber with a short dark bob", "Fakeby, a tall photographer in a grey beanie"];
const SCENES = [
  { where: TENT, visual: "Testa sits bolt upright in the dark tent, listening.", caption: "TESTA: Fakeby. Somebody is saying our names." },
  { where: SHORE, visual: "Fakeby's flashlight finds a woman standing waist-deep in the lake, perfectly still.", caption: "FAKEBY: There's a woman in the lake." },
  { where: TENT, visual: "Inside the zipped tent the door flap stirs and a pale wet hand slides through the opening.", caption: "" },
];
const BODY = J({ style: "TESTMOVIE", videoUrl: "/renders/tm-lake-1.mp4", treatment: { title: "TEST Who Calls From the Still Lake", cast: CAST_LINES, events: true, scenes: SCENES, musicMood: "low drone" } });

/** What film-dialogue.server.ts writes for it — through carryRecord, exactly as the engine calls it. */
const RECORD = carryRecord({
  // the maker picked nobody: the cast is empty, and the film invented both faces (cut from its first master)
  cast: [],
  faces: [{ name: "TESTA", faceUrl: "/renders/face-1700000000000-ab12cd34-l.jpg" }, { name: "FAKEBY", faceUrl: "/renders/face-1700000000000-ab12cd34-r.jpg" }],
  castLines: CAST_LINES,
  thing: "the woman in the lake",
  places: [
    { name: TENT_KEY, where: TENT, img: "/renders/img-1700000000001-aaaa.jpg" },
    { name: SHORE_KEY, where: SHORE, img: "/renders/img-1700000000002-bbbb.jpg" },
  ],
  lastFrame: "/renders/tmf-1700000000003-cccc.jpg",
  lastPlace: TENT_KEY,
});
const META = J({
  kind: "testmovie", template: "horror", aspect: "16:9", engine: "kling3", scenes: 3,
  ...RECORD,
  threat: { name: "the woman in the lake", img: "/renders/img-1700000000004-dddd.jpg", from: "story", look: "standing waist-deep in the lake, perfectly still" },
});
const ROW = { id: "lake1", title: "Horror Film — TEST Who Calls From the Still Lake", metaJson: META, bodyJson: BODY };

test("the record: an invented cast keeps the faces it was first shown with, spelled as its cast list spells them", () => {
  assert.deepEqual(RECORD.cast, [
    { name: "Testa", faceUrl: "/renders/face-1700000000000-ab12cd34-l.jpg", voiceId: null },
    { name: "Fakeby", faceUrl: "/renders/face-1700000000000-ab12cd34-r.jpg", voiceId: null },
  ]);
  assert.deepEqual(RECORD.places?.map((p) => p.name), [TENT_KEY, SHORE_KEY], "each place drawn, in the order the film went there");
  assert.equal(RECORD.places?.[0].where, TENT);
  assert.equal(RECORD.lastFrame, "/renders/tmf-1700000000003-cccc.jpg");
  assert.equal(RECORD.lastPlace, TENT_KEY, "the last frame was taken in the tent");
  // a picked cast as before — and a character the maker cast with only a VOICE gets the invented face, keeping the voice
  const mixed = carryRecord({
    cast: [{ name: "Testa", faceUrl: "/avatars/testa_0.jpg", voiceId: "English_CalmWoman" }, { name: "Fakeby", faceUrl: null, voiceId: "English_ManWithDeepVoice" }],
    faces: [{ name: "FAKEBY", faceUrl: "/renders/face-1-r.jpg" }],
  });
  assert.deepEqual(mixed.cast, [
    { name: "Testa", faceUrl: "/avatars/testa_0.jpg", voiceId: "English_CalmWoman" },
    { name: "Fakeby", faceUrl: "/renders/face-1-r.jpg", voiceId: "English_ManWithDeepVoice" },
  ]);
  // a cast photo wins over a cut face (the engine never cuts one for them — and if it did, the photo stays)
  assert.equal(carryRecord({ cast: [{ name: "Testa", faceUrl: "/avatars/t.jpg" }], faces: [{ name: "Testa", faceUrl: "/renders/face-2-l.jpg" }] }).cast[0].faceUrl, "/avatars/t.jpg");
  // a label with no cast line is spelled as a name, not shouted
  assert.equal(carryRecord({ cast: [], faces: [{ name: "MORWEN", faceUrl: "/renders/face-3-l.jpg" }] }).cast[0].name, "Morwen");
  // the film's THING is never a cast member here (it has meta.threat): a cast monster that was the thing stays out
  const thingCast = carryRecord({ cast: [{ name: "TEST Drowned Bride", faceUrl: "/avatars/bride.jpg", role: "threat" }, { name: "Testa", faceUrl: "/avatars/t.jpg" }], thing: "TEST Drowned Bride" });
  assert.deepEqual(thingCast.cast.map((c) => c.name), ["Testa"]);
  // …but a role nobody used as the thing (not a horror film) is kept, as castForMeta always kept it
  assert.deepEqual(carryRecord({ cast: [{ name: "TEST Drowned Bride", faceUrl: "/avatars/bride.jpg", role: "threat" }] }).cast.map((c) => c.name), ["TEST Drowned Bride"]);
});

test("the record is bounded as seriesCarryOf reads it — our own pictures only, no stray place, no last place without a frame", () => {
  const r = carryRecord({
    cast: [],
    faces: [{ name: "Testa", faceUrl: "https://elsewhere.example/face.jpg" }, { name: "Fakeby", faceUrl: "/renders/../x.jpg" }, { name: "", faceUrl: "/renders/face-4.jpg" }],
    places: [
      { name: "far", where: "x", img: "https://elsewhere.example/a.jpg" },
      { name: "dots", where: "x", img: "/renders/a.b.jpg" },
      ...Array.from({ length: 10 }, (_, i) => ({ name: `place ${i}`, where: `the room number ${i}`, img: `/renders/p${i}.jpg` })),
    ],
    lastFrame: "javascript:alert(1)",
    lastPlace: "place 0",
  });
  assert.deepEqual(r.cast, [], "a face that is not one of our pictures is no face");
  assert.equal(r.places!.length, CARRY_PLACES_MAX);
  assert.ok(!("lastFrame" in r) && !("lastPlace" in r));
  assert.equal(carryRecord({ cast: [], places: [{ name: "a", where: "a", img: "/renders/a.jpg" }], lastFrame: "/renders/f.jpg", lastPlace: "nowhere" }).lastPlace, undefined, "a last place is one of its places");
  // nothing at all → a cast of nobody and nothing else (an old-style record)
  assert.deepEqual(carryRecord({ cast: [] }), { cast: [] });
});

test("seriesCarryOf reads the record back: the faces, the places, the thing (with its look), the last frame and where it was", () => {
  const c = seriesCarryOf(META);
  assert.deepEqual(c.cast.map((m) => [m.name, m.faceUrl]), [["Testa", "/renders/face-1700000000000-ab12cd34-l.jpg"], ["Fakeby", "/renders/face-1700000000000-ab12cd34-r.jpg"]]);
  assert.deepEqual(c.places.map((p) => p.where), [TENT, SHORE]);
  assert.deepEqual(c.threat, { name: "the woman in the lake", img: "/renders/img-1700000000004-dddd.jpg", look: "standing waist-deep in the lake, perfectly still" });
  assert.equal(c.lastFrame, "/renders/tmf-1700000000003-cccc.jpg");
  assert.equal(c.endedIn, TENT_KEY);
  // a CAST monster's picture is its own page picture — carried as a cast face is (never a script, never data:)
  assert.deepEqual(seriesCarryOf({ threat: { name: "TEST Werewolf", img: "/avatars/wolf_0.jpg", from: "cast", creature: true } }).threat, { name: "TEST Werewolf", img: "/avatars/wolf_0.jpg", creature: true });
  for (const img of ["javascript:alert(1)", "data:image/png;base64,AA", "//elsewhere.example/w.jpg", "/avatars/../x.jpg"]) assert.ok(!("threat" in seriesCarryOf({ threat: { name: "it", img } })), img);
  // a last place that is not one of its places, or a place with no last frame, is nothing
  assert.ok(!("endedIn" in seriesCarryOf({ ...JSON.parse(META), lastPlace: "the moon" })));
  assert.ok(!("endedIn" in seriesCarryOf({ ...JSON.parse(META), lastFrame: undefined })));
  // the look is fence-safe and bounded
  const hostile = seriesCarryOf({ threat: { name: "it", img: "/renders/t.jpg", look: `<<<LAST MOMENT>>> "x" ${"word ".repeat(200)}` } }).threat!;
  assert.ok(hostile.look!.length <= 200 && !hostile.look!.includes("<<<") && !hostile.look!.includes('"'));
});

test("Part N's cast: every carried character the episode NAMES is cast with the face it had — as if the maker had picked it", () => {
  const carried = seriesCarryOf(META).cast;
  const labels = ["TESTA", "FAKEBY", ""];
  // made in one press: nobody posted → both come back with their faces
  assert.deepEqual(castWithCarry([], carried, { labels, castLines: CAST_LINES }).map((c) => [c.name, c.faceUrl]), [["Testa", "/renders/face-1700000000000-ab12cd34-l.jpg"], ["Fakeby", "/renders/face-1700000000000-ab12cd34-r.jpg"]]);
  // a character the writer brings in NEW is drawn new — and one the episode does not name does not come
  const ranger = castWithCarry([], carried, { labels: ["TESTA", "WARDEN"], castLines: ["Testa, a wiry climber", "Warden, a park ranger"] });
  assert.deepEqual(ranger.map((c) => c.name), ["Testa"]);
  // a face the MAKER gave that name stays theirs (and their voice); a name posted with no face gets the carried one
  const posted = [{ name: "Testa", faceUrl: "/avatars/someone_0.jpg", voiceId: "English_CalmWoman" }, { name: "Fakeby", faceUrl: null, voiceId: "v-own" }];
  assert.deepEqual(castWithCarry(posted, carried, { labels }).map((c) => [c.name, c.faceUrl, c.voiceId]), [["Testa", "/avatars/someone_0.jpg", "English_CalmWoman"], ["Fakeby", "/renders/face-1700000000000-ab12cd34-r.jpg", "v-own"]]);
  // the carried VOICE comes with its face, never onto another face
  const voiced = [{ name: "Testa", faceUrl: "/renders/face-1700000000000-ab12cd34-l.jpg", voiceId: "English_CalmWoman" }];
  assert.equal(castWithCarry([{ name: "Testa", faceUrl: null, voiceId: null }], voiced, { labels })[0].voiceId, "English_CalmWoman");
  assert.equal(castWithCarry([{ name: "Testa", faceUrl: "/avatars/other.jpg", voiceId: null }], voiced, { labels })[0].voiceId, null);
  // the maker's cast thing is never refilled; a carried creature keeps what it is
  assert.equal(castWithCarry([{ name: "Testa", faceUrl: null, role: "threat" as const }], carried, { labels })[0].faceUrl, null);
  const wolf = castWithCarry([], [{ name: "Grimtest", faceUrl: "/avatars/wolf.jpg", voiceId: null, kind: "monster", look: "a huge grey werewolf" }], { labels: ["GRIMTEST"] });
  assert.deepEqual(wolf, [{ name: "Grimtest", faceUrl: "/avatars/wolf.jpg", voiceId: null, kind: "monster", look: "a huge grey werewolf" }]);
  // nothing carried → the posted cast exactly as it came
  assert.deepEqual(castWithCarry(posted, undefined, { labels }), posted);
  assert.deepEqual(castWithCarry(posted, [], { labels }), posted);
});

test("an OLD film carries its cast and nothing else — its next part is made as it always was", () => {
  const oldMeta = J({ kind: "testmovie", template: "horror", aspect: "16:9", cast: [{ name: "Testa", faceUrl: "/avatars/testa_0.jpg", voiceId: "English_CalmWoman" }] });
  const brief = seriesBriefOf({ ...ROW, metaJson: oldMeta }, { template: "horror", narrated: false })!;
  const c = brief.carry!;
  assert.deepEqual(c, { cast: [{ name: "Testa", faceUrl: "/avatars/testa_0.jpg", voiceId: "English_CalmWoman" }], places: [] });
  // its picked face is what the page re-picks today — the same face, by the same name
  assert.equal(castWithCarry([], c.cast, { labels: ["TESTA"] })[0].faceUrl, "/avatars/testa_0.jpg");
  // no place is matched, no thing comes back, it never opens on a frame it did not keep
  assert.equal(carriedPlaceFor(TENT, c.places), null);
  assert.equal(carriedThreat(c.threat, null), null);
  assert.equal(opensWhereItEnded({ visual: "Moments later, Testa holds her breath.", where: TENT }, c), false);
  assert.ok(!("thing" in brief));
  // a film with no record at all carries nothing: no `carry` rides the payload
  assert.ok(!("carry" in seriesBriefOf({ ...ROW, metaJson: J({ kind: "testmovie", template: "horror" }) }, { template: "horror", narrated: false })!));
});

test("Part N's places: the same place by its words or its head noun — never the shore for the tent, never 3am for the next morning", () => {
  assert.equal(placeHead(TENT), "tent");
  assert.equal(placeHead(SHORE), "shore");
  assert.equal(placeHead("Inside the dome tent by the lake"), "tent");
  assert.equal(placeHead("the tent, moments later"), "tent");
  assert.equal(placeHead("outside the tent"), "out:tent", "outside a thing is not inside it");
  assert.equal(placeHead("The kitchen of the old farmhouse"), "kitchen");
  assert.equal(placeHead("a farmhouse kitchen at dawn"), "kitchen");
  assert.equal(placeHead("Testa's car, parked on the verge"), "car");
  assert.equal(placeHead(""), "");
  assert.ok(samePlace(TENT, "Inside the dome tent by the lake"));
  assert.ok(!samePlace(TENT, SHORE));
  assert.ok(!samePlace("inside the tent", "outside the tent"));
  assert.equal(lightOf(TENT), "night");
  assert.equal(lightOf("the tent, the next morning"), "day");
  assert.equal(lightOf("the tent"), "");
  const places = seriesCarryOf(META).places;
  assert.equal(carriedPlaceFor(TENT, places)?.name, TENT_KEY, "word for word");
  assert.equal(carriedPlaceFor("Inside the dome tent by the lake", places)?.name, TENT_KEY, "said another way");
  assert.equal(carriedPlaceFor("the pebbly lake shore", places)?.name, SHORE_KEY);
  assert.equal(carriedPlaceFor("the ranger station on the hill", places), null, "a new place is drawn new");
  // a room reference copies the light: the tent in the morning is not drawn from the tent at 3am…
  assert.equal(carriedPlaceFor("inside the dome tent, the next morning", places), null);
  // …unless the light is not asked about (moments later is the same light)
  assert.equal(carriedPlaceFor("inside the dome tent, the next morning", places, { light: false })?.name, TENT_KEY);
  // of two of the same kind, the one that shares the most words
  const two = [{ name: "a", where: "the red tent at the festival", img: "/renders/a.jpg" }, { name: "b", where: "the small dome tent beside a still lake", img: "/renders/b.jpg" }];
  assert.equal(carriedPlaceFor("inside the dome tent by the still lake", two)?.name, "b");
  assert.equal(carriedPlaceFor("", places), null);
});

test("Part N's thing: the carried one, named as this episode names it — unless this episode's thing is another", () => {
  const t = seriesCarryOf(META).threat!;
  assert.deepEqual(carriedThreat(t, null), t, "the episode names no thing: the series' thing is it");
  assert.equal(carriedThreat(t, { name: "the woman in the lake" })?.name, "the woman in the lake");
  assert.equal(carriedThreat(t, { name: "the pale woman" })?.name, "the pale woman", "named as this episode's words name it");
  assert.equal(carriedThreat(t, { name: "the figure in the water" })?.img, t.img, "a vaguer word for the same thing");
  assert.equal(carriedThreat(t, { name: "a werewolf" }), null, "another thing is drawn new");
  assert.equal(carriedThreat(t, { name: "the man with the lantern" }), null, "a man is not the woman");
  assert.equal(carriedThreat(undefined, { name: "the woman" }), null);
  assert.ok(sameThing("the woman in the lake", "The woman in the lake"));
  assert.ok(sameThing("the drowned bride", "the woman by the shore"));
  assert.ok(!sameThing("the drowned bride", "the old priest"));
  assert.ok(!sameThing("the woman", ""));
});

test("it opens where it ended: 'Moments later' in the place the last frame was taken — and only then", () => {
  const c = seriesCarryOf(META);
  assert.equal(opensWhereItEnded({ visual: "Moments later, Testa and Fakeby back away from the flap as the knocking starts again.", where: TENT }, c), true);
  assert.equal(opensWhereItEnded({ visual: "A moment later the flap stirs again.", where: "Inside the dome tent by the lake" }, c), true);
  assert.equal(opensWhereItEnded({ visual: "The next morning, Testa unzips the tent to grey light.", where: TENT }, c), false, "it starts later");
  assert.equal(opensWhereItEnded({ visual: "Moments later, Fakeby runs along the shore.", where: SHORE }, c), false, "another place than the last frame's");
  assert.equal(opensWhereItEnded({ visual: "Moments later…", where: TENT }, { ...c, lastFrame: undefined }), false);
  assert.equal(opensWhereItEnded({ visual: "Moments later…", where: TENT }, { ...c, endedIn: undefined }), false);
  assert.equal(opensWhereItEnded(null, c), false);
  for (const s of ["Moments later, x", "Seconds later x", "A moment later x", "Only moments later x", "An instant later x", "\"Moments later\" x"]) assert.ok(OPENS_THERE.test(s), s);
  for (const s of ["Later that night x", "The next morning x", "Three days later x", "x moments later"]) assert.ok(!OPENS_THERE.test(s), s);
});

test("the brief: the writer is asked for the sign, and the series' thing keeps its cast entry — from meta.threat when it had no line", () => {
  const brief = seriesBriefOf(ROW, { template: "horror", narrated: false })!;
  // the carry rides the brief (and so the job's payload), the thing's line is made from meta.threat
  assert.ok(brief.carry && brief.carry.lastFrame && brief.carry.places.length === 2);
  assert.equal(brief.thing, "the woman in the lake, standing waist-deep in the lake, perfectly still");
  const w = seriesWriterBrief(brief);
  assert.ok(w.includes("• When it opens right there, its FIRST scene's \"where\" is the last moment's Where, word for word, and its \"visual\" begins with the words \"Moments later,\".\n"));
  assert.ok(w.indexOf("• HOW IT OPENS") < w.indexOf("• When it opens right there"), "said with the rule it serves");
  assert.ok(w.includes(`Where: ${TENT}`), "the Where it is to repeat is in the last moment's fence");
  assert.ok(w.includes("• \"the woman in the lake\" — what this series is about, who never talks — keeps a \"cast\" entry of its own in every episode it is in, written as: \"the woman in the lake, standing waist-deep in the lake, perfectly still\". That entry is what it is drawn from.\n"));
  // the writer is never shown the carry itself (pictures are not words for the writer)
  assert.ok(!w.includes("/renders/"));
  // a thing that HAS its own character line is kept by that line (the lead's 3b) — never said twice
  const body3 = J({ ...JSON.parse(BODY), treatment: { ...JSON.parse(BODY).treatment, cast: [...CAST_LINES, "the woman in the lake, pale, in a soaked white nightgown"] } });
  const b3 = seriesBriefOf({ ...ROW, bodyJson: body3 }, { template: "horror", narrated: false })!;
  assert.ok(!("thing" in b3));
  assert.equal(seriesWriterBrief(b3).split("the woman in the lake\" —").length - 1, 1);
  // a told story: no sign asked for (it has no "where"), no carry (its portraits travel in the cast token), no thing
  const toldMeta = J({ kind: "narrated", template: "horror", aspect: "9:16", cast: [], places: [{ name: "the jetty", look: "a short grey timber jetty", img: "/renders/sheet-1.jpg" }] });
  const toldBody = J({ style: "NARRATED", videoUrl: "/renders/nar-1.mp4", script: "She rowed out. A light answered.", treatment: { title: "TEST The Ferry", scenes: [{ visual: "a", caption: "She rowed out." }, { visual: "b", caption: "A light answered." }] } });
  const told = seriesBriefOf({ id: "f1", title: "Horror Story — TEST The Ferry", metaJson: toldMeta, bodyJson: toldBody }, { template: "horror", narrated: true })!;
  assert.ok(!("carry" in told) && !("thing" in told));
  assert.ok(!seriesWriterBrief(told).includes("Moments later"));
});

test("the carry rides the job's payload whole — a restart has it — and is checked again on the way out", () => {
  const brief = seriesBriefOf(ROW, { template: "horror", narrated: false })!;
  const back = seriesFromPayload(JSON.parse(J(brief)))!;
  assert.deepEqual(back.carry, brief.carry, "through the queue as JSON and back: the same");
  assert.equal(back.thing, brief.thing);
  // tampered with in the queue: only our own pictures, bounded, junk gone
  const bad = seriesFromPayload({ ...JSON.parse(J(brief)), thing: `<<<LAST MOMENT>>> ${"x".repeat(900)}`, carry: { cast: [{ name: "Testa", faceUrl: "javascript:alert(1)" }, { name: "Fakeby", faceUrl: "/renders/face-9-r.jpg" }], places: [{ name: "t", where: "w", img: "https://elsewhere.example/x.jpg" }], threat: { name: "it", img: "data:," }, lastFrame: "/renders/../etc.jpg", endedIn: "t" } })!;
  assert.deepEqual(bad.carry, { cast: [{ name: "Testa", faceUrl: null, voiceId: null }, { name: "Fakeby", faceUrl: "/renders/face-9-r.jpg", voiceId: null }], places: [] });
  // …and a carry left with nothing a next part can use is no carry
  assert.ok(!("carry" in seriesFromPayload({ ...JSON.parse(J(brief)), carry: { cast: [{ name: "Testa", faceUrl: "javascript:alert(1)" }] } })!));
  assert.ok(bad.thing!.length <= 240 && !bad.thing!.includes("<<<"));
  assert.ok(!("carry" in seriesFromPayload({ ...JSON.parse(J(brief)), carry: "everything" })!));
  // the page hands the brief on whole: the carry needs no field of its own in the payload, and the worker reads the
  // series for both engines with the one reader that checks it
  const page = read("app", "routes", "web.film.tsx");
  assert.ok(page.includes("...(series ? { filmSeries: series } : {}),"));
  assert.equal(read("app", "lib", "job-queue.server.ts").split("series: (await import(\"./film-series\")).seriesFromPayload(payload.filmSeries),").length - 1, 2);
});

test("the builder's banner reads where it picks up — the last line said, by whom, as the cast list spells them", () => {
  assert.deepEqual(picksUpOf(BODY), { said: "There's a woman in the lake.", who: "Fakeby" });
  assert.deepEqual(picksUpOf(J({ style: "NARRATED", script: "She rowed out. A light answered." })), { said: "A light answered.", who: "" });
  assert.equal(picksUpOf(J({ style: "TESTMOVIE", treatment: { scenes: [{ visual: "only a picture", caption: "" }] } })), null, "a stage direction is no line");
  const [card] = nextEpisodeCards([ROW], 3);
  assert.deepEqual(card.picksUp, { said: "There's a woman in the lake.", who: "Fakeby" });
  assert.deepEqual(card.thing, { name: "the woman in the lake", img: "/renders/img-1700000000004-dddd.jpg" });
  // the invented faces are the card's cast now: a tap on it opens with them
  assert.deepEqual(card.setup.cast.map((m) => m.faceUrl), ["/renders/face-1700000000000-ab12cd34-l.jpg", "/renders/face-1700000000000-ab12cd34-r.jpg"]);
});

/* ---- THE BUILDER (web.film.tsx, the ?episode= path): one calm banner, and the carried people on the Cast card ---- */
test("the builder: 'Episode N of …' with the carried faces and 'Picks up from: …' — the Cast card says who is back", () => {
  const page = read("app", "routes", "web.film.tsx");
  // the card the episode was opened from is held (the loader's cards move on once a film is made)
  const start = page.slice(page.indexOf("const startEpisode = (c: NextEpisodeCard) => {"), page.indexOf("const dropSeries = () =>"));
  assert.ok(start.includes("episodeCard.current = c;"));
  // an ACTED episode's invented faces (no roster pick holds them) come back on the Cast card, as a told one's always did
  assert.ok(start.includes("setSeriesOwn(isNarr ? (s.returning || []) : s.cast.filter((m) => !!m.faceUrl && !d.roster.some((r) => r.img === m.faceUrl)).map((m) => ({ name: m.name, img: m.faceUrl as string })));"));
  // the banner: still the one line that says which episode (its pin: tests/film-series.test.ts), its ✕, and now who
  // comes back (the cast's faces, a told story's own, the thing last — four at most) and the line it picks up from
  const at = page.indexOf("{isStoryboard && series ? (() => {");
  const banner = page.slice(at, page.indexOf("})() : (", at));
  assert.ok(at > 0 && banner.includes("const ep = episodeCard.current && episodeCard.current.from === series.from ? episodeCard.current : null;"));
  assert.ok(banner.includes("...(ep.thing ? [{ ...ep.thing, thing: true }] : [])].filter((f, k, a) => a.findIndex((x) => x.img === f.img) === k).slice(0, 4)"));
  assert.ok(banner.includes("{t(\"Episode {n} of “{title}”\", { n: series.episode, title: series.title })}"));
  assert.ok(banner.includes("<span className=\"fs-epb-faces\" aria-hidden=\"true\">"));
  assert.ok(banner.includes("{picks && <span className=\"fs-epb-picks\"><b>{t(\"Picks up from\")}</b> <span className=\"fs-epb-said\"><q>{picks.said}</q>{picks.who ? <span className=\"fs-epb-who\"> — {picks.who}</span> : null}</span></span>}"));
  assert.ok(banner.includes("onClick={dropSeries}"));
  // phone first: the line takes the whole width under the faces (beside four of them it was five words, cut mid-word,
  // on the 390 harness) and is three lines at most; the ✕ is 44 to the finger; still for reduced motion
  assert.ok(page.includes(".fs-epb-back{display:flex;flex-wrap:wrap;"));
  assert.ok(page.includes(".fs-epb-said{flex:1 1 100%;min-width:0;font-size:13px;line-height:1.42;color:#3E5247;display:-webkit-box;-webkit-line-clamp:3;"));
  assert.ok(page.includes(".fs-epline-x{flex:none;position:relative;width:32px;height:32px;") && page.includes(".fs-epline-x::after{content:\"\";position:absolute;inset:-6px;}"));
  assert.ok(page.includes("@media(prefers-reduced-motion:reduce){.fs-epb-face,.fs-epb-face.is-thing{animation:none;}}"));
  // the new word, in all five languages
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  assert.equal(dict.split(`\n  ${J("Picks up from")}:`).length - 1, 5);
});

/* ---- THE WIRING (film-dialogue.server.ts) — what cannot run without paid models ---- */
const eng = read("app", "lib", "film-dialogue.server.ts");
const loop = eng.indexOf("for (let i = clips.length; i < treatment.scenes.length; i++) {");

test("wiring: the record is written in the create — every speaking face, the places' masters, the last frame and its place", () => {
  const at = eng.lastIndexOf("await db.asset.create({");
  const rec = eng.indexOf("const nextPart = carryRecord({");
  assert.ok(rec > loop && rec < at, "after the shots, before the piece");
  const call = eng.slice(rec, eng.indexOf("});", rec));
  assert.ok(call.includes("cast: castActors,"));
  assert.ok(call.includes("faces: [spkA, spkB].filter((n): n is string => !!n).map((n) => ({ name: n, faceUrl: ownRel(firstFaces[firstName(n)]) })),"), "the faces the film first showed");
  assert.ok(call.includes("places: locOrder.filter((k) => !!masters[k]?.url).map((k) => ({ name: k, where: whereAt[locFirst.get(k) ?? 0] || \"\", img: ownRel(masters[k].url) })),"));
  assert.ok(call.includes("lastFrame: ownRel(prevFrameUrl),"), "the last shot's own last frame — before any caption was drawn over the film");
  assert.ok(call.includes("lastPlace: clips.length ? locKeyAt(clips.length - 1) : null,"));
  assert.ok(call.includes("carried: carry,"));
  assert.ok(eng.slice(at, eng.indexOf("return asset.id;", at)).includes("...nextPart,"));
  // the cut faces and the last frame are put in the render store (the masters already are)
  assert.ok(eng.includes("if (n && /^(?:face|tmf)-/.test(n)) { try { await mirrorRender(n, fs.readFileSync(path.join(RENDERS(), n))); } catch { /* non-fatal */ } }"));
});

test("wiring: Part N casts the carried people, draws a shared place from its picture, brings the thing, opens on the last frame", () => {
  // THE SAME PEOPLE — before anything reads the cast
  const cast = eng.indexOf("const castActors = castWithCarry(");
  assert.ok(cast > 0 && cast < eng.indexOf("const castLooks: Record<string, string> = {};"));
  assert.ok(eng.includes("const carry = opts.series?.carry || null;"));
  // (a carried face — or the thing's picture — no longer on our disk is never handed to a picture model)
  assert.ok(eng.includes("const carriedCast = (carry?.cast || []).map((c) => (c.faceUrl && c.faceUrl.startsWith(\"/renders/\") && !fs.existsSync(path.join(RENDERS(), path.basename(c.faceUrl))) ? { ...c, faceUrl: null } : c));"));
  assert.ok(eng.includes("if (carry.threat.img.startsWith(\"/renders/\") && !onDisk(carry.threat.img)) return null;"));
  // THE SAME PLACES — the room of a master, inside masterFor, after a drawn master is returned as it was (never twice)
  const mf = eng.indexOf("const masterFor = async (");
  const room = eng.indexOf("roomRef = roomRef || roomFor(locKey);", mf);
  assert.ok(room > eng.indexOf("if (masters[locKey]?.url) return masters[locKey];", mf) && room < eng.indexOf("renderSideBySideTwoShot({ roomRefUrl: roomRef,", mf));
  assert.ok(eng.includes("const p = carriedPlaceFor(whereAt[locFirst.get(k) ?? 0], carry.places);\n      if (p && onDisk(p.img)) carriedRoom.set(k, p.img);"), "only a picture still on our disk");
  assert.ok(eng.includes("const roomFor = (locKey: string): string | undefined => (openFrame && locKey === locKeyAt(0) ? abs(openFrame) : abs(carriedRoom.get(locKey)));"));
  assert.ok(eng.indexOf("const roomFor = ") < loop, "known before the first master is drawn");
  // …and a master drawn so is checkpointed as every master is
  assert.ok(eng.includes("await ckpt({ ckMasters: JSON.stringify(masters) });"));
  // THE SAME THING — S7's own cast-threat path, after the maker's own
  assert.ok(eng.includes("const chosen = castThreat(castActors) || carriedThing;"));
  assert.ok(eng.includes("const t = carriedThreat(carry.threat, own);"));
  assert.ok(eng.includes("if (castActors.some((c) => !!c.faceUrl && isCreature(c) && !talks(c.name))) return null;"), "a creature the maker cast wins");
  // IT OPENS WHERE IT ENDED — only a first shot not made yet, no frame the maker approved, the film's own shape, read sides
  assert.ok(eng.includes("if (carry?.lastFrame && isTwoHander && !clips.length && !approvedFrames[0] && opensWhereItEnded({ visual: scenesArr[0]?.visual, where: whereAt[0] }, carry)) {"));
  assert.ok(eng.includes("if (shape && Math.abs(shape - AW / AH) / (AW / AH) < 0.03) {"));
  assert.ok(eng.includes("openFrame = (await removeLetterbox(carry.lastFrame)) || \"\";"), "letterbox removed");
  const seed = eng.indexOf("let seedAbs = abs(approvedFrames[i]);", loop);
  const opened = eng.indexOf("const opened = !seedAbs && i === 0 && !!openFrame && !!master?.url && openLeft !== null && openLeft === master.aOnLeft;", loop);
  assert.ok(opened > seed && opened < eng.indexOf("if (!seedAbs && lastHorror && master?.url && stagingOf(master)) {", loop), "before every other seed");
  assert.ok(eng.includes("if (opened) { seedAbs = abs(openFrame);"));
  assert.ok(eng.indexOf("if (opened) chainStaging = null;") > eng.indexOf("if (!chained) chainStaging = approvedFrames[i] || !master?.url || (tr === \"angle\" && !sighted) ? null : stagingOf(master);"), "the last frame is no staged picture");
});
