/* A FOUND-FOOTAGE FILM — several moments from one camera, a card before each (app/lib/footage-film.ts, and its
 * making: app/lib/footage-film.server.ts).
 *
 * The owner, 2026-11-25: "Found footage needs redone … It currently appears to pipeline singular events But needs to be
 * more like \"Found Footage\" House cam, Body cam, phone or cam recording, with describe events flow like the others -
 * make it look banging and not limited".
 *
 * Held here: what both writers are told (the build — small, closer, the payoff; the place and the thing said ONCE;
 * THE END IS THEIRS; a film that is not a horror; no word for the engine); that whatever the page sends back is
 * cleaned and a member's own line survives; that every moment is checked by one take's own rules; that the place and
 * the thing are in every picture word for word; the clock a card gives its moment; the cards and the join, run on
 * REAL ffmpeg — the film's length the sum of its pieces, its picture and its sound the same length; and, as source
 * pins, what cannot be run in a test: three rolls at once, one more roll a moment and three a film, every paid step
 * checkpointed per moment and never paid for twice, one take when a film cannot be made.
 *
 * Every name in a fixture is made up and says TEST. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  FOOTAGE_BUILD, FOOTAGE_CARD_DB, FOOTAGE_CARD_SECONDS, FOOTAGE_DIRECTED_AT_ONCE, FOOTAGE_FPS, FOOTAGE_LIMITS, FOOTAGE_MAX_MOMENTS, FOOTAGE_OUTLINE_OTHER_CAMERA, FOOTAGE_OUTLINE_UNREADABLE, FOOTAGE_RATE,
  FOOTAGE_REROLLS, FOOTAGE_ROLLS_AT_ONCE, camStamp, cardText, cardWhen, cardWords, cleanFootageOutline, footageCardArgs, footageClocks, footageDirectionBrief,
  footageDirectionSchema, footageFilmEta, footageFilmJob, footageFps, footageFrom, footageIdea, footageJoinCheck, footageJoinGraph, footageMomentBrief, footageMomentSchema,
  footageOpensPrompt, footageOutlineAsk, footageOutlineBrief, footageOutlineSchema, footageScenePlan, footageScenePrompt, footageSeconds, footageTolerance, momentCount, momentScript, momentSeconds,
  parseFootageDirection, parseFootageMoment, parseFootageOutline, prose, undirected, withDirected,
  HOLD_BEAT, beatsFor, directionFaults, quietBeat, threeBeats,
} from "../app/lib/footage-film.ts";

test("a moment's beats are made THREE, and a sentence with somebody speaking is taken out — never the moment (the first live film lost all three, 2026-11-25)", () => {
  // four beats: the extra is folded into the third; two: the longer one splits at its sentence break; one of three sentences: three
  assert.deepEqual(threeBeats(["a", "b", "c", "d"]), ["a", "b", "c d"]);
  assert.deepEqual(threeBeats(["The light drifts between the trunks. It stops.", "It winks out."]), ["The light drifts between the trunks.", "It stops.", "It winks out."]);
  assert.deepEqual(threeBeats(["One. Two. Three. Four."]), ["One.", "Two.", "Three. Four."]);
  assert.deepEqual(threeBeats(["only one beat"]), ["only one beat"], "one sentence is not three");
  // speech out, the rest kept ("a scream echoes through the trees" is a horror moment's ordinary sentence)
  const SPEAKS = /\b(speaks?|says?|whispers?|screams?|shouts?|laughs?|mouths)\b/i;
  assert.equal(quietBeat("The light drifts between the trunks. A scream echoes through the trees. It winks out.", SPEAKS), "The light drifts between the trunks. It winks out.");
  assert.deepEqual(beatsFor(["The light drifts.", "A scream echoes through the trees.", "It winks out."], SPEAKS), ["The light drifts.", HOLD_BEAT, "It winks out."]);
  assert.deepEqual(beatsFor(["She screams.", "She whispers."], SPEAKS), [], "nothing left: refused, as before");
  // …and what is still refused SAYS WHY, for the server's log
  const o = cleanFootageOutline({ v: 1, camera: "camcorder", aspect: "16:9", kind: "scare", title: "TEST", place: "a TEST campsite", thing: "a thin pale TEST figure", moments: [{ when: "NIGHT 1", line: "a light between the trees", seconds: 7 }, { when: "NIGHT 2", line: "a shape circles the tent", seconds: 10 }] })!;
  const faults = directionFaults({ moments: [{ n: 1, seen: true, who: "it", still: "short", opens: "x", first: "y", finds: "", beats: ["one"] }] }, o);
  assert.equal(faults.length, 1);
  assert.ok(faults[0].startsWith("moment 1: 1 beats (1 after speech is taken out); still under 40 characters; opens under 20 characters; first under 12 characters; finds under 4 characters"), faults[0]);
  assert.ok(directionFaults("not json at all", o)[0].startsWith("no moments in the answer"));
  // the writer is held to it by its schema too: three beats, one or two lines
  const schema = footageDirectionSchema("camcorder").schema as { properties: { moments: { items: { properties: Record<string, { minItems?: number; maxItems?: number }> } } } };
  assert.deepEqual([schema.properties.moments.items.properties.beats.minItems, schema.properties.moments.items.properties.beats.maxItems], [3, 3]);
  assert.deepEqual([schema.properties.moments.items.properties.says.minItems, schema.properties.moments.items.properties.says.maxItems], [1, 2]);
  // the engine logs why
  assert.ok(fs.readFileSync(new URL("../app/lib/footage-film.server.ts", import.meta.url), "utf8").includes("for (const why of directionFaults(raw, outline, only)) console.error(`[footage-film] refused — ${why}`);"));
});

test("the place and the thing are cut as PROSE — at a sentence, else a whole word, never on a dangling comma (live, 2026-11-25)", () => {
  // the first live outline ("What Circled the Tent") showed its place as "…whatever the camera's tiny lamp catches,"
  const place = "A wooded campsite at the edge of a state forest, with a dirt clearing ringed by tall pines, a fire pit of blackened stones, a canvas tent, and a wooden picnic table scarred with old carvings. At night the only light is the orange fire and whatever the camera's tiny lamp catches, and the pines stand black against a starless sky.";
  assert.equal(prose(place, FOOTAGE_LIMITS.place), "A wooded campsite at the edge of a state forest, with a dirt clearing ringed by tall pines, a fire pit of blackened stones, a canvas tent, and a wooden picnic table scarred with old carvings.");
  // no sentence end that keeps half of it: the last whole word, with no comma hanging off it
  const long = `${"a narrow hallway with peeling paper, ".repeat(9)}and a door`;
  const cut = prose(long, 120);
  assert.ok(cut.length <= 120 && !/[,;:—–-]$/.test(cut) && long.startsWith(cut), cut);
  // short prose is left as it is; one word longer than the cap is cut where it must be
  assert.equal(prose("a quiet kitchen at night", 280), "a quiet kitchen at night");
  assert.equal(prose("x".repeat(900), 280).length, 280);
  // …and the outline cleans its place and its thing so
  const o = cleanFootageOutline({ v: 1, camera: "camcorder", aspect: "16:9", kind: "scare", title: "TEST", place, thing: "a thin pale figure, " + "taller than a man, ".repeat(20), moments: [{ when: "NIGHT 1", line: "a light between the trees", seconds: 7 }] })!;
  assert.ok(o.place.endsWith("old carvings.") && !/[,;:]$/.test(o.thing), `${o.place} | ${o.thing}`);
});
import { DRAMA_BOUNDS, DRAMA_CAUGHT, PLAIN_BOUNDS, PLAIN_CAUGHT, TAKE_CAUGHT, TAKE_HIDDEN, TAKE_MOODS, TAKE_PROMPT_MAX, TAKE_REF, TAKE_WRONG, footageEta, footageJob, takeIdea, takeLines, takePrompt } from "../app/lib/take.ts";
import { HOUSE_ROOMS, houseScare, houseScarePrompt, houseScenePrompt } from "../app/lib/house-cam.ts";
import { clockText } from "../app/lib/camera-dress.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const count = (src: string, piece: string) => src.split(piece).length - 1;

/** a TEST idea, and the outline a writer might answer it with */
const IDEA = "my TEST roommate keeps standing in the hallway at night and she is not really my roommate";
const PLACE = "A narrow TEST flat: a hallway with a worn green runner, a coat rack by the front door and a round mirror; the bedroom door at one end, the bathroom at the other. One weak ceiling bulb.";
const THING = "A tall TEST woman in a grey raincoat, her wet hair hanging over her face; her neck is a hand too long.";
const ANSWER = {
  title: "TEST The Other Roommate", kind: "scare", place: PLACE, thing: THING,
  moments: [
    { when: "night 1 · 2:14 am", line: "From the bedroom door, the hallway: a coat on the rack sways as if someone just brushed past it.", seconds: 7 },
    { when: "NIGHT 2 · 3:07 AM", line: "She is at the far end of the hallway with her back to the camera, facing the mirror.", seconds: 9 },
    { when: "NIGHT 4 · 3:11 AM", line: "She is right outside the bedroom door, and walks slowly at the camera.", seconds: 12 },
  ],
};
const outlineOf = (camera: "phone" | "camcorder" | "bare" | "bodycam" | "house" = "phone", over: Record<string, unknown> = {}) =>
  parseFootageOutline({ ...ANSWER, ...over }, camera, camera === "phone" ? "9:16" : "16:9", 3)!;

test("THE OUTLINE'S BRIEF: several moments from ONE camera — the build, the place and the thing said once, THE END IS THEIRS, a film that is not a horror, and never a word for the engine", () => {
  const b = footageOutlineBrief(IDEA, "phone", 4);
  assert.ok(b.startsWith("You are outlining a short FOUND-FOOTAGE FILM: 4 moments recorded by ONE camera — a phone held in somebody's hand (a tall, vertical picture) — cut together the way recovered footage is: a card on black that says when (\"NIGHT 1 · 2:14 AM\"), then what the camera caught; the next card, the next moment."));
  assert.ok(b.includes(`THE IDEA: ${IDEA}`));
  // THE BUILD ("needs to be more like Found Footage"): small and deniable, then closer, then the payoff
  for (const rule of [
    "every moment is worse (or bigger) than the one before, one step at a time",
    "The FIRST moment is ordinary, with ONE small thing wrong: far off, brief, deniable — something a person watching would rewind to check.",
    "The MIDDLE moments bring it closer or prove it",
    "The LAST moment is the payoff.",
    // THE END IS THEIRS — one take's rule (take.ts), and the film's
    "THE END IS THEIRS: if THE IDEA says how it ends, the last moment ends exactly that way; only an idea that gives no ending ends on the payoff of your choosing.",
  ]) { assert.ok(FOOTAGE_BUILD.includes(rule), rule); assert.ok(b.includes(rule), rule); }
  // the place and the thing: ONCE, so that they can be drawn the same every time
  assert.ok(b.includes("THE PLACE, said ONCE: the one place the whole film happens in, described so that it can be drawn the same in every moment"));
  assert.ok(b.includes("THE THING, said ONCE: who or what the film is about, when the same one is in more than one moment") && b.includes('"" when nothing recurs.'));
  // "not limited": a film that is no horror at all
  assert.ok(b.includes('"plain": it is NOT a horror at all — a dog caught opening the fridge, a meteor on a dashboard phone, a surprise party, a traffic stop; then nothing in it is a creature and nothing is made frightening.'));
  // one continuous shot a moment — and NO WORD FOR THE ENGINE: an outline has nobody's words in it
  assert.ok(b.includes("EACH MOMENT is ONE continuous shot that a real camera could film in the seconds it has: no cut, no jump in time, ONE thing happening."));
  assert.ok(b.includes("NEVER what anybody says: nobody's words are written in an outline, and nothing in the picture ever speaks."));
  assert.ok(b.includes("THE ONE FILMING is never in the picture") && b.includes("No blood, no gore, no wounds; nobody is hurt; everyone is fully clothed."));
  // the creature's own recipe, as one take's writer has it
  assert.ok(b.includes("nearly human and slightly wrong, ONE or TWO exact wrongnesses and no more") && b.includes("never horns, wings, tentacles, glowing eyes, flames or a bare skull"));
  // what comes back: exactly as many moments as were asked for, each a card, one line, its seconds
  assert.ok(b.includes('"moments": [exactly 4, in the order they are seen:') && b.includes('"when": the card — when this was recorded, in ENGLISH CAPITALS, 28 characters at most') && b.includes('"line": what the camera catches — one sentence, 180 characters at most') && b.includes('"seconds": how long the shot is, 6 to 12'));
  assert.ok(b.includes("in the language THE IDEA is written in"));
  assert.ok(!b.includes("FICTION") && !b.includes('"room"'), "a phone's film has no police bounds and no rooms");
  // a film is never fewer than two moments, nor more than eight
  assert.ok(footageOutlineBrief(IDEA, "phone", 1).includes("2 moments recorded") && footageOutlineBrief(IDEA, "phone", 99).includes(`${FOOTAGE_MAX_MOMENTS} moments recorded`));
  assert.equal(FOOTAGE_MAX_MOMENTS, 8);

  // A BODY CAMERA: fiction, and nobody hurt
  const worn = footageOutlineBrief(IDEA, "bodycam", 3);
  assert.ok(worn.includes("a body camera worn on the chest of somebody on duty") && worn.includes("It is FICTION: never a real police incident, agency, town or address; no badge, insignia or lettering on anything; no weapon is drawn or fired; nobody is struck, nobody is hurt."));
  // A HOUSE'S OWN CAMERAS: nobody films, every moment names its room — and an early moment can be one nothing comes into
  const house = footageOutlineBrief(IDEA, "house", 3);
  assert.ok(house.includes("the security cameras fixed high in the corners of ONE house's rooms: nobody holds them, they never move, and every moment is at night"));
  for (const r of HOUSE_ROOMS) assert.ok(house.includes(`"${r.key}" — ${r.name}: ${r.empty}`), r.key);
  assert.ok(house.includes("nothing comes in at all and ONE thing in the room changes with nobody there to do it") && house.includes('"room": the room, by its key') && house.includes("10 to 15"));
  // …and what it can be is something that MOVES, in the shot: never a light (every house direction says the light does
  // not change) and never a thing that "is somewhere else" (a continuous shot cannot jump) — review, 2026-11-25
  for (const brief of [house, footageDirectionBrief(outlineOf("house"))]) {
    assert.ok(brief.includes("a door swings slowly open; a chair slides back from the table; a ball rolls out across the floor"));
    assert.ok(!brief.includes("a light comes on") && !brief.includes("somewhere else"));
  }
  // THE CARD: nights or days, never a date or a year (the camera prints its own, from the card); a house's are nights
  assert.ok(b.includes('counted in nights or days — never a calendar date or a year: the camera prints its own — later moments later ("NIGHT 1 · 2:14 AM", "NIGHT 3 · 3:07 AM", "DAY 2 · 4:40 PM")'));
  assert.ok(house.includes('later moments later ("NIGHT 1 · 2:14 AM", "NIGHT 3 · 3:07 AM")') && !house.includes("DAY 2"));
  // (the house's rooms are the kept house's own: the place is whose house it is, never a room described again)
  assert.ok(house.includes("THE PLACE, said ONCE: this house — whose it is and what kind of house, in a sentence or two. Its rooms are the ones listed below, exactly as they are: a room is never described differently.") && !house.includes("its walls and floor, its light"));
  assert.ok(!house.includes("THE ONE FILMING is never in the picture"));

  // FROM A CARD: the ready-made take is one moment — the film leads up to it
  const smile = takeIdea("smile")!;
  const from = footageOutlineBrief("", "phone", 3, smile);
  assert.ok(from.includes(`THE IDEA: ${smile.premise}`) && from.includes(`IT STARTS FROM A READY-MADE TAKE, "She's smiling". Its own words were: ${smile.premise} — That take is ONE moment: the film's payoff, or close to it.`));
  assert.ok(footageOutlineBrief(IDEA, "house", 3, houseScare("overbed")!).includes('IT STARTS FROM A READY-MADE TAKE, "Over the bed".'));
  assert.ok(!b.includes("IT STARTS FROM"));
  // which card a film can start from: one this camera can film
  assert.equal(footageFrom("smile", "phone")?.key, "smile");
  assert.equal(footageFrom("smile", "bodycam"), undefined);
  assert.equal(footageFrom("welfare", "bodycam")?.key, "welfare");
  assert.equal(footageFrom("overbed", "house")?.key, "overbed");
  assert.equal(footageFrom("overbed", "phone"), undefined);
  assert.equal(footageFrom("", "phone"), undefined);
});

test("THE OUTLINE, CHECKED: the writer's is held to its shape, and what the page posts back is cleaned and clamped — a member's own line survives", () => {
  // the shape the writer is held to: exactly as many moments as were asked for
  const s = footageOutlineSchema(5).schema as { required: string[]; properties: Record<string, { minItems?: number; maxItems?: number; enum?: string[]; items?: { required: string[]; properties: Record<string, { enum?: string[] }> } }> };
  assert.deepEqual(s.required, ["title", "kind", "place", "thing", "moments"]);
  assert.deepEqual(s.properties.kind.enum, ["scare", "plain"]);
  assert.deepEqual([s.properties.moments.minItems, s.properties.moments.maxItems], [5, 5]);
  assert.deepEqual(s.properties.moments.items!.required, ["when", "line", "seconds"]);
  const hs = footageOutlineSchema(3, true).schema as typeof s;
  assert.deepEqual(hs.properties.moments.items!.required, ["when", "line", "seconds", "room"]);
  assert.deepEqual(hs.properties.moments.items!.properties.room.enum, HOUSE_ROOMS.map((r) => r.key));
  assert.equal(footageOutlineSchema(3).name, "footage_outline");

  // THE WRITER'S ANSWER
  const o = outlineOf("phone");
  assert.deepEqual({ v: o.v, title: o.title, camera: o.camera, aspect: o.aspect, kind: o.kind, place: o.place, thing: o.thing }, { v: 1, title: "TEST The Other Roommate", camera: "phone", aspect: "9:16", kind: "scare", place: PLACE, thing: THING });
  // a card is capitals; a phone's seconds are 6–12
  assert.deepEqual(o.moments.map((m) => [m.when, m.seconds]), [["NIGHT 1 · 2:14 AM", 7], ["NIGHT 2 · 3:07 AM", 9], ["NIGHT 4 · 3:11 AM", 12]]);
  assert.ok(o.moments.every((m) => !("room" in m)), "only a house camera's moments have a room");
  // THE SHAPE FOLLOWS THE CAMERA, whatever was asked
  assert.equal(parseFootageOutline(ANSWER, "phone", "16:9", 3)!.aspect, "9:16");
  assert.equal(parseFootageOutline(ANSWER, "bodycam", "9:16", 3)!.aspect, "16:9");
  assert.equal(parseFootageOutline(ANSWER, "camcorder", "9:16", 3)!.aspect, "9:16");
  // more moments than were asked for are left off; text around the JSON is read through
  assert.equal(parseFootageOutline(ANSWER, "phone", "9:16", 2)!.moments.length, 2);
  assert.ok(parseFootageOutline("Here it is:\n```json\n" + JSON.stringify(ANSWER) + "\n```", "phone", "9:16", 3));
  // "plain" only when it says so; a thing called "none" is no thing
  assert.equal(parseFootageOutline({ ...ANSWER, kind: "PLAIN" }, "phone", "9:16", 3)!.kind, "plain");
  assert.equal(parseFootageOutline({ ...ANSWER, kind: "comedy" }, "phone", "9:16", 3)!.kind, "scare");
  assert.equal(parseFootageOutline({ ...ANSWER, thing: "None." }, "phone", "9:16", 3)!.thing, "");
  // not an outline: no place, one moment, no answer — the caller asks once more, then films ONE take
  for (const bad of [{ ...ANSWER, place: "" }, { ...ANSWER, moments: ANSWER.moments.slice(0, 1) }, { ...ANSWER, moments: "three" }, "the writer is busy", null, 7, []]) assert.equal(parseFootageOutline(bad, "phone", "9:16", 3), null, JSON.stringify(bad).slice(0, 60));

  // A HOUSE CAMERA: every moment in a room of the house — the one before it when it names none, the living room first
  const h = parseFootageOutline({ ...ANSWER, moments: [{ ...ANSWER.moments[0], room: "attic", seconds: 4 }, { ...ANSWER.moments[1], room: "Bedroom", seconds: 30 }, { ...ANSWER.moments[2] }] }, "house", "9:16", 3)!;
  assert.deepEqual(h.moments.map((m) => [m.room, m.seconds]), [["living", 10], ["bedroom", 15], ["bedroom", 12]]);
  assert.equal(h.aspect, "16:9");

  // WHAT THE PAGE POSTS BACK: as text or as an object — and a line the member rewrote is the line that is filmed
  const mine = "She is standing ON the bed now. I'm not making this up.";
  const edited = { ...o, moments: [o.moments[0], { ...o.moments[1], line: mine, when: "night 3 — 03:33", seconds: 99 }, o.moments[2]] };
  const back = cleanFootageOutline(JSON.stringify(edited))!;
  assert.equal(back.moments[1].line, mine, "their own words survive");
  assert.deepEqual([back.moments[1].when, back.moments[1].seconds], ["NIGHT 3 — 03:33", 12], "their card, in capitals; their seconds, clamped");
  assert.deepEqual(cleanFootageOutline(edited), back, "an object is read as its text is");
  assert.deepEqual(cleanFootageOutline(o), o, "a clean outline is left as it is");
  // NEVER TRUSTED: every word is clamped, quotes cannot close anything, a control character is a space, a made-up
  // camera or version is no outline, a moment with no line is dropped, nine moments are eight
  const dirty = cleanFootageOutline({
    v: 1, camera: "PHONE", aspect: "16:9", kind: "nope", title: "T".repeat(200), place: `a "TEST" place\u0000\n with a tab\t in it`, thing: "x".repeat(900),
    moments: [{ when: "w".repeat(90), line: "L".repeat(900), seconds: -3 }, { when: "", line: "   " }, { line: "ok then, a line", seconds: "8" }, ...Array.from({ length: 9 }, (_, k) => ({ line: `TEST moment number ${k}`, when: `night ${k}` }))],
  })!;
  assert.equal(dirty.camera, "phone");
  assert.equal(dirty.aspect, "9:16");
  assert.equal(dirty.kind, "scare");
  assert.equal(dirty.title.length, FOOTAGE_LIMITS.title);
  assert.equal(dirty.place, "a 'TEST' place with a tab in it");
  assert.equal(dirty.thing.length, FOOTAGE_LIMITS.thing);
  assert.equal(dirty.moments.length, FOOTAGE_MAX_MOMENTS);
  assert.deepEqual([dirty.moments[0].when.length, dirty.moments[0].line.length, dirty.moments[0].seconds], [FOOTAGE_LIMITS.when, FOOTAGE_LIMITS.line, 10]);
  assert.deepEqual([dirty.moments[1].line, dirty.moments[1].when, dirty.moments[1].seconds], ["ok then, a line", "NIGHT 2", 8], "the empty moment is gone; a moment with no card gets its night");
  for (const bad of [null, "", "{", "[]", { v: 2, camera: "phone", moments: o.moments }, { v: 1, camera: "drone", moments: o.moments }, { v: 1, camera: "phone", moments: [] }, { v: 1, camera: "phone", moments: [{ line: "…" }] }]) assert.equal(cleanFootageOutline(bad), null, JSON.stringify(bad).slice(0, 50));
  // ONE moment is an outline too (it is filmed as one take), and a place may be left empty by a member
  assert.equal(cleanFootageOutline({ ...o, place: "", moments: [o.moments[0]] })!.moments.length, 1);
  // A CARD holds only what the camera's mono face can draw, and nothing that could end its text
  assert.equal(cardWords("  night 1 · 2:14 am  "), "NIGHT 1 · 2:14 AM");
  assert.equal(cardWords("it's \"50%\" [done]; \\ {x} <y>"), "IT’S ’50’ DONE X Y");
  assert.equal(cardWords("夜 1 · 午前2時"), "1 · 2", "a script the face cannot draw is left off, never drawn as empty boxes");
  assert.equal(cardWords("día 2 — 16:40"), "DÍA 2 — 16:40");
  // TOO LONG: cut at a word, never inside one ("… 11:52 P" was drawn, and read by the clock as the morning — review,
  // 2026-11-25), and never left ending on a separator; one word longer than a card is cut where it must be
  assert.equal(cardWords("Tuesday 14 October · 11:52 PM"), "TUESDAY 14 OCTOBER · 11:52");
  assert.equal(cardWords("NIGHT 12 · 3:07 AM · SECOND FLOOR"), "NIGHT 12 · 3:07 AM · SECOND");
  assert.equal(cardWords("NIGHT 2 · 3:07 AM · BASEMENT STAIRS"), "NIGHT 2 · 3:07 AM · BASEMENT");
  assert.equal(cardWords("ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFG"), "ABCDEFGHIJKLMNOPQRSTUVWXYZAB");
  for (const s of ["Tuesday 14 October · 11:52 PM", "x ".repeat(40), "NIGHT 1 · 2:14 AM"]) assert.ok(cardWords(s).length <= FOOTAGE_LIMITS.when, s);
  // how many moments, and how long each may be
  assert.deepEqual([0, 1, 2.4, 8, 9, "5", "x", null].map(momentCount), [1, 1, 2, 8, 8, 5, 1, 1]);
  assert.deepEqual([3, 6, 9.4, 12, 40, 0, "x"].map((v) => momentSeconds("phone", v)), [6, 6, 9, 12, 12, 10, 10]);
  assert.deepEqual([3, 10, 12.6, 15, 40, 0].map((v) => momentSeconds("house", v)), [10, 10, 13, 15, 15, 15]);
});

test("HOW LONG A FILM IS, AND HOW LONG IT TAKES: its moments and a card before each — one moment is one take", () => {
  const o = outlineOf("phone");
  assert.equal(FOOTAGE_CARD_SECONDS, 1.2);
  assert.equal(footageSeconds(o), 7 + 9 + 12 + 3 * 1.2);
  assert.equal(footageSeconds({ moments: [o.moments[2]] }), 12, "one take has no card");
  assert.equal(footageSeconds({ moments: [] }), 0);
  // the wait: one moment is one take's; a film's grows with its moments, three rolling at a time — a house camera's one by one
  assert.deepEqual(footageFilmEta({ camera: "phone", moments: [o.moments[0]] }), footageEta("phone"));
  assert.deepEqual(footageFilmEta({ camera: "house", moments: [o.moments[0]] }), footageEta("house"));
  const eta = (camera: "phone" | "house", n: number) => footageFilmEta({ camera, moments: Array.from({ length: n }, () => o.moments[0]) });
  assert.deepEqual([2, 3, 4, 8].map((n) => eta("phone", n)), [[10, 17], [10, 19], [15, 28], [22, 43]]);
  assert.deepEqual([2, 4, 8].map((n) => eta("house", n)), [[12, 23], [21, 41], [39, 77]]);
  for (let n = 2; n <= 8; n++) for (const cam of ["phone", "house"] as const) {
    const [lo, hi] = eta(cam, n), [plo, phi] = eta(cam, Math.max(1, n - 1));
    assert.ok(lo < hi && lo >= plo && hi >= phi, `${cam} ${n}: at least < at most, and never shorter than one moment fewer`);
  }
  assert.ok(eta("house", 4)[0] > eta("phone", 4)[0], "a house camera's moments go one after another");
});

test("THE JOB A FILM IS QUEUED AS: a take's job with the approved outline — or a count for one press; one moment is one take, exactly as it is queued today", () => {
  const o = outlineOf("phone");
  const form = { scare: "own", own: IDEA, camera: "phone" };
  // ONE MOMENT, OR NONE ASKED FOR: the single take's own job, untouched
  const single = footageJob(form);
  assert.ok(single.ok);
  for (const moments of [undefined, 1, "1", 0, "x"]) {
    const j = footageFilmJob({ ...form, moments });
    assert.ok(j.ok && j.moments === 1);
    assert.deepEqual(j.ok && j.payload, single.ok && single.payload, `moments ${moments}: today's payload`);
    assert.ok(j.ok && !("takeMoments" in j.payload) && !("takeOutline" in j.payload));
  }
  // ONE PRESS: the same job, and how many moments to write
  const press = footageFilmJob({ ...form, moments: "4" });
  assert.ok(press.ok && press.moments === 4);
  assert.deepEqual(press.ok && press.payload, { ...(single.ok ? single.payload : {}), takeMoments: 4 });
  assert.equal(press.ok && press.payload.contentType, "take", "still a take: the Archive's footage family, the story lane");
  assert.equal((footageFilmJob({ ...form, moments: 99 }) as { moments: number }).moments, FOOTAGE_MAX_MOMENTS);
  // …a card left as it was: the film grows from the card's own words — its premise is the idea, the card where it starts
  const card = footageFilmJob({ scare: "smile", own: takeIdea("smile")!.premise, camera: "phone", moments: 3 });
  assert.ok(card.ok && card.name === "She's smiling");
  assert.deepEqual(card.ok && [card.payload.takeOwn, card.payload.takeFrom, card.payload.takeMoments, "takeIdea" in card.payload], [takeIdea("smile")!.premise, "smile", 3, false]);
  // …and a card whose words were changed is their own idea, written from it — as one take is
  const changed = footageFilmJob({ scare: "smile", own: "My TEST sister is at the end of the hall and she is smiling far too wide", camera: "phone", moments: 3 });
  assert.deepEqual(changed.ok && [changed.payload.takeOwn, changed.payload.takeFrom, changed.payload.takeMoments], ["My TEST sister is at the end of the hall and she is smiling far too wide", "smile", 3]);
  // a house camera keeps its settings, the single take's way
  const house = footageFilmJob({ scare: "own", own: IDEA, camera: "house", moments: 3, lapse: "1", ir: "0", room: "kitchen" });
  assert.deepEqual(house.ok && [house.payload.takeCamera, house.payload.takeAspect, house.payload.takeLapse, house.payload.takeIr, house.payload.takeMoments], ["house", "16:9", true, false, 3]);

  // THE OUTLINE THE MEMBER APPROVED — as the page holds it — cleaned HERE, not on the page
  const film = footageFilmJob({ ...form, outline: JSON.stringify(o) });
  assert.ok(film.ok && film.name === "TEST The Other Roommate" && film.moments === 3);
  assert.deepEqual(film.ok && film.payload, {
    section: "creator", contentType: "take", takeCamera: "phone", takeAspect: "9:16", takeOutline: JSON.stringify(o), takeOwn: IDEA,
    productTitle: "Found Footage — TEST The Other Roommate", initiator: "web",
  });
  assert.deepEqual(cleanFootageOutline(film.ok && film.payload.takeOutline), o, "what is queued reads back as the outline");
  // their edit is what is queued; a line too long is clamped before it is
  const mine = { ...o, moments: [o.moments[0], { ...o.moments[1], line: "x".repeat(400) }, o.moments[2]] };
  const q = footageFilmJob({ ...form, outline: JSON.stringify(mine) });
  assert.equal(q.ok && cleanFootageOutline(q.payload.takeOutline)!.moments[1].line.length, FOOTAGE_LIMITS.line);
  // the camera on the form films it — a phone's moments on a camcorder, in the shape that camera has
  const cam = footageFilmJob({ scare: "own", camera: "camcorder", aspect: "16:9", outline: o });
  assert.deepEqual(cam.ok && [cam.payload.takeCamera, cam.payload.takeAspect, cleanFootageOutline(cam.payload.takeOutline)!.camera, cleanFootageOutline(cam.payload.takeOutline)!.aspect], ["camcorder", "16:9", "camcorder", "16:9"]);
  // …but a house's rooms cannot be walked through with a phone, nor a phone's hallway watched from a wall
  assert.deepEqual(footageFilmJob({ camera: "house", outline: o }), { ok: false, error: FOOTAGE_OUTLINE_OTHER_CAMERA });
  assert.deepEqual(footageFilmJob({ camera: "phone", outline: outlineOf("house") }), { ok: false, error: FOOTAGE_OUTLINE_OTHER_CAMERA });
  assert.deepEqual(footageFilmJob({ camera: "phone", outline: "{not json" }), { ok: false, error: FOOTAGE_OUTLINE_UNREADABLE });
  assert.deepEqual(footageFilmJob({ camera: "phone", outline: { v: 1, camera: "phone", moments: [] } }), { ok: false, error: FOOTAGE_OUTLINE_UNREADABLE });
  // a house film: the time-lapse starts off, night vision on, and the card it started from gives the tile its picture
  const hf = footageFilmJob({ scare: "overbed", camera: "house", outline: outlineOf("house") });
  assert.deepEqual(hf.ok && [hf.payload.takeLapse, hf.payload.takeIr, hf.payload.takeFrom, hf.payload.productImageUrl], [false, true, "overbed", "/landing/ff-scare-overbed.jpg?v=1"]);
  assert.equal((footageFilmJob({ scare: "overbed", camera: "house", lapse: "1", outline: outlineOf("house") }) as { payload: Record<string, unknown> }).payload.takeLapse, true);
  // AN OUTLINE CUT DOWN TO ONE MOMENT is one take of that moment — its line, with the thing and the place it was written for
  const one = footageFilmJob({ camera: "phone", outline: { ...o, moments: [o.moments[2]] } });
  assert.ok(one.ok && one.moments === 1 && !("takeOutline" in one.payload) && !("takeMoments" in one.payload));
  assert.equal(one.ok && one.payload.takeOwn, footageIdea({ ...o, moments: [o.moments[2]] }));
  assert.ok(String(one.ok && one.payload.takeOwn).startsWith("She is right outside the bedroom door, and walks slowly at the camera. A tall TEST woman in a grey raincoat"));
  assert.ok(footageIdea(o).startsWith(o.moments[2].line) && footageIdea(o).length <= 400, "a film's idea as one take: its payoff");
  // THE REFUSALS come back in the page's language (and the single take's own are the single take's)
  const t = (s: string) => `[es] ${s}`;
  assert.deepEqual(footageFilmJob({ camera: "phone", outline: "{" }, t), { ok: false, error: `[es] ${FOOTAGE_OUTLINE_UNREADABLE}` });
  assert.deepEqual(footageFilmJob({ camera: "x", moments: 3 }, t), { ok: false, error: "[es] Pick a camera." });
  assert.deepEqual(footageFilmJob({ camera: "phone", scare: "own", own: "", moments: 3 }, t), { ok: false, error: "[es] Say what happens, in a few words." });
  // (a card's words left as they were IN THAT LANGUAGE are left as they were)
  const es = footageFilmJob({ scare: "smile", own: `[es] ${takeIdea("smile")!.premise}`, camera: "phone", moments: 1 }, t);
  assert.equal(es.ok && es.payload.takeIdea, "smile");

  // WHAT THE WRITER IS ASKED FOR THE FREE PREVIEW ("describe events flow like the others") is decided the same way
  // the job is — so the outline a member reads is the film one press would have made
  assert.deepEqual(footageOutlineAsk({ ...form, moments: "4" }), { ok: true, idea: IDEA, camera: "phone", aspect: "9:16", count: 4 });
  // (a form's empty field is "not said" — three — never read as a nought and floored to two: review, 2026-11-25)
  assert.equal(footageOutlineAsk({ ...form, moments: "" }).ok && (footageOutlineAsk({ ...form, moments: "" }) as { count: number }).count, 3);
  assert.equal((footageOutlineAsk({ ...form, moments: " " }) as { count: number }).count, 3);
  assert.deepEqual(footageOutlineAsk({ scare: "smile", own: takeIdea("smile")!.premise, camera: "camcorder", aspect: "9:16" }), { ok: true, idea: takeIdea("smile")!.premise, from: "smile", camera: "camcorder", aspect: "9:16", count: 3 }, "a card left as it was: its own words, and three moments when the page does not say");
  assert.deepEqual(footageOutlineAsk({ scare: "overbed", own: "A TEST mime stands over the bed for hours and then lies down beside her", camera: "house", moments: 1 }), { ok: true, idea: "A TEST mime stands over the bed for hours and then lies down beside her", from: "overbed", camera: "house", aspect: "16:9", count: 2 });
  assert.deepEqual(footageOutlineAsk({ camera: "phone", scare: "own", own: "" }, t), { ok: false, error: "[es] Say what happens, in a few words." });
  assert.deepEqual(footageOutlineAsk({ camera: "house", scare: "smile" }), { ok: false, error: "That camera can't film that one — pick another." });
});

/* ---- THE DIRECTION ---- */

/** a TEST moment as the direction's writer might answer it, for a camera somebody holds */
const hand = (n: number, over: Record<string, unknown> = {}) => ({
  n, seen: true, who: "She",
  still: "The camera looks down the hallway from the bedroom door: at the far end, by the coat rack, the tall TEST woman in the grey raincoat stands with her back to the camera, half lost in the dark.",
  opens: "the camera looks down at the worn green runner beside the bedroom door, lit by the phone's own small light; the far end of the hallway is out of the picture.",
  first: "the camera looks down at the runner while the one filming stands in the bedroom doorway and listens.",
  finds: "the camera swings up to the far end of the hallway",
  beats: ["she stands at the far end of the hallway by the coat rack with her back to the camera, perfectly still.", "her head turns slowly, further than a neck allows, until one eye is on the camera.", "the phone's light goes out; when it comes back the hallway is empty."],
  says: [{ text: "Mara? ... Is that \"your\" coat?", mood: "annoyed" }, { text: "she's at work— she's at work", mood: "whispering" }],
  asks: "looking", ends: "dark", sound: "a coat hanger ticking against the wall",
  ...over,
});

test("THE DIRECTION'S BRIEF: every line becomes a take's parts — the build must survive, the place and the thing are never redescribed, nobody on camera speaks, and each line of the one filming has a mood", () => {
  const o = outlineOf("phone");
  const b = footageDirectionBrief(o);
  assert.ok(b.startsWith("You are directing a found-footage FILM: 3 moments recorded by ONE camera — a phone held in somebody's hand (a tall, vertical picture) — each of them ONE continuous shot. The film is already outlined; you turn each moment's line into the parts its shot is filmed from. Change nothing that a line says happens."));
  // the place and the thing ONCE — and they are what the pictures are drawn from
  assert.ok(b.includes(`THE PLACE — the same in every moment. It is drawn from these words, so never describe it differently: ${PLACE}`));
  assert.ok(b.includes(`THE THING — the same one in every moment it is in. Its look is drawn from these words; never describe it differently and never add to it: ${THING}`));
  // every moment's card, seconds and line — the member's own words
  assert.ok(b.includes(`THE MOMENTS:\n1. NIGHT 1 · 2:14 AM — 7 seconds — ${o.moments[0].line}\n2. NIGHT 2 · 3:07 AM — 9 seconds — ${o.moments[1].line}\n3. NIGHT 4 · 3:11 AM — 12 seconds — ${o.moments[2].line}`));
  // THE BUILD MUST SURVIVE THE DIRECTION — and by now the outline IS the idea: its last line is how the film ends
  assert.ok(b.includes(`${FOOTAGE_BUILD} Here THE IDEA is the outline itself: the last moment ends the way its own line says. Keep the first moment as small as its line makes it, and never bring the thing closer than a moment's line does.`));
  // one take's own craft, for every moment: off its subject, the camera FINDS it, three beats, one continuous shot
  for (const rule of [
    "FIRST, for two seconds, the camera is NOT on its subject", "THEN the camera moves and FINDS it, and three beats follow",
    "It is ONE continuous shot of the seconds it has, that a real camera could film: no cut, no jump in time.",
    "If its end needs the camera to leave its subject, the camera swings away; if it needs the dark, the light goes out — no flash — and comes back.",
    // SEEN OR NOT: the early moments of a haunting show no creature
    '"seen": true when THE THING itself is in this moment\'s picture, however far off or small; false when only what it did is seen (a door that was shut, open; something moved), or the moment is about something else.',
    "WHEN THE THING IS SEEN, what frightens is slowness and stillness: it NEVER runs, flinches, turns away or screams", "ITS MOUTH NEVER MOVES", "In the first moment it is far away and hard to be sure of.",
    // NO WORD FOR THE ENGINE
    'NOBODY IN THE PICTURE EVER SPEAKS, and no spoken word is written anywhere but in "says": the video model moves the only mouth it can see to any word it is given.',
    'THE ONE FILMING is never seen: write what THE CAMERA does ("the camera backs away"), never what their body does.',
    // what they say: a mood for each line, from the closed list — and the fear is earned
    `each with the mood it is said in, one of: ${TAKE_MOODS.join(", ")}.`,
    'never a stock line ("what are you doing", "who is there", "hello?" on its own, "no no", "oh god")',
    "The mood builds with the film: nobody is terrified in the first moment — they are annoyed, curious, half asleep; fear is for when it has been earned.",
    "Answer with JSON only, in English whatever language the outline is in:", '"moments": [one for each of moments 1 to 3, in order:',
  ]) assert.ok(b.includes(rule), rule);
  assert.ok(!b.includes("FICTION") && !b.includes('"radio"'));
  // A FILM THAT IS NOT A HORROR: no creature rules, nobody frightened
  const plain = footageDirectionBrief({ ...o, kind: "plain" });
  assert.ok(plain.includes("NOT a horror: nothing in it is a creature, and nothing is made frightening"));
  assert.ok(plain.includes("Everything in it moves the way it really would, at its real speed. Nobody is hurt; everyone is fully clothed.") && plain.includes("Nobody is frightened in this film: calm, excited, laughing, annoyed, whispering or shouting."));
  for (const scare of ["WHEN THE THING IS SEEN, what frightens", "ITS MOUTH NEVER MOVES", "fear is for when it has been earned"]) assert.ok(!plain.includes(scare), scare);
  assert.ok(plain.includes("NOBODY IN THE PICTURE EVER SPEAKS"), "a plain film gives the engine no word either");
  // A BODY CAMERA: fiction — and the dispatcher's call opens the FIRST moment only
  const worn = footageDirectionBrief(outlineOf("bodycam"));
  assert.ok(worn.includes("It is FICTION: never a real police incident") && worn.includes('"radio": what a dispatcher says over the radio as the FIRST moment opens — ONE short call') && worn.includes('{"radio": the dispatcher\'s call, "moments":'));
  // ASKED ONCE MORE, for the moments that failed — and only those
  const again = footageDirectionBrief(o, [0, 2]);
  assert.ok(again.includes("Write ONLY moments 1, 3 — the others are written.") && again.includes('"moments": [one for each of moments 1, 3, in order:'));
  assert.ok(footageDirectionBrief(o, [1]).includes("Write ONLY moment 2 — the others are written."));
  assert.ok(again.includes(`2. NIGHT 2 · 3:07 AM — 9 seconds — ${o.moments[1].line}`), "it still sees the whole film");

  // A HOUSE'S CAMERAS: nobody films, nothing is said, and a moment is one of two kinds
  const h = outlineOf("house", { moments: [{ ...ANSWER.moments[0], room: "bedroom", seconds: 10 }, { ...ANSWER.moments[1], room: "bedroom", seconds: 12 }, { ...ANSWER.moments[2], room: "hallway", seconds: 15 }] });
  const hb = footageDirectionBrief(h);
  assert.ok(hb.startsWith("You are directing a found-footage FILM recorded by the security cameras of ONE house: 3 moments, each ONE continuous shot from a camera fixed high in the corner of a room, at night. Nobody holds the camera, it NEVER moves, and nothing is ever said."));
  assert.ok(hb.includes(`1. NIGHT 1 · 2:14 AM — 10 seconds — Bedroom camera — ${h.moments[0].line}`) && hb.includes("3. NIGHT 4 · 3:11 AM — 15 seconds — Hallway camera — "));
  // its rooms are the kept house's own, so the writer is shown each one a moment is in — once — as its camera has it:
  // a door it names must be one of that room's (a walk-in through a door the room has not got is not filmed)
  const room = (key: string) => HOUSE_ROOMS.find((r) => r.key === key)!;
  assert.ok(hb.includes(`THE HOUSE: ${PLACE}\nTHE ROOMS its cameras are in — each exactly as its camera has it; a door or doorway named in a moment must be one of that room's own:\nBedroom: ${room("bedroom").empty}\nHallway: ${room("hallway").empty}\nTHE THING`));
  assert.ok(!hb.includes(room("kitchen").empty) && !hb.includes("It is drawn from these words, so never describe it differently"), "only the rooms it is in; the house's rooms are not drawn from the outline's words");
  // (it MOVES, in the shot — never a light, never "somewhere else": review, 2026-11-25)
  assert.ok(hb.includes('TWO KINDS OF MOMENT. "seen": false — NOTHING COMES IN: the room as it is, and ONE thing in it moves with nobody there to do it, in the shot, at its real speed (a door swings slowly open; a chair slides back from the table; a ball rolls out across the floor) — never a light coming on or going out'));
  assert.ok(hb.includes("IT COMES IN through one of THIS room's own doors or doorways and goes the WHOLE way to where it stops — it never appears from nowhere"));
  assert.ok(hb.includes("Nothing in any moment speaks, and no spoken word is written anywhere.") && hb.includes(FOOTAGE_BUILD) && !hb.includes('"says"'));
  assert.ok(hb.includes('"who": what THE THING is — "he", "she" or "it", "thing": THE THING in one phrase starting with "a" or "an"'));

  // the shapes both are held to
  const hs = footageDirectionSchema("phone").schema as { properties: { moments: { items: { required: string[]; properties: Record<string, { enum?: string[]; items?: { properties: Record<string, { enum?: string[] }> } }> } } } };
  assert.deepEqual(hs.properties.moments.items.required, ["n", "seen", "who", "still", "opens", "first", "finds", "beats", "says", "asks", "ends", "sound"]);
  assert.deepEqual(hs.properties.moments.items.properties.says.items!.properties.mood.enum, [...TAKE_MOODS]);
  assert.deepEqual(hs.properties.moments.items.properties.ends.enum, ["comes", "stays", "dark", "away"]);
  assert.deepEqual((footageDirectionSchema("house").schema as { required: string[] }).required, ["who", "thing", "moments"]);
});

test("EVERY MOMENT IS CHECKED BY ONE TAKE'S OWN RULES: seen is a scare, unseen is plain; its lines have their moods and their times; a moment that fails is null, and asked for once more", () => {
  const o = outlineOf("phone");
  const d = parseFootageDirection({ moments: [hand(1, { seen: false, who: "the coat" }), hand(2), hand(3, { ends: "comes", says: [{ text: "Mara. Stop. Mara—" }, { text: "you're not her" }] })] }, o);
  assert.equal(d.length, 3);
  assert.deepEqual(undirected(d), []);
  const [first, mid, last] = d.map((m) => { assert.ok(m && m.cam === "hand"); return m; });
  // NOT SEEN: a plain take — no creature in its direction; SEEN: one take's own scare direction
  assert.deepEqual([first.seen, first.take.genre, mid.seen, mid.take.genre, last.take.genre], [false, "plain", true, undefined, undefined]);
  // each moment is as long as its line says, and its direction says so (a seven-second one ends in its last three)
  assert.deepEqual(d.map((m) => m && m.cam === "hand" && m.take.seconds), [7, 9, 12]);
  const p1 = takePrompt(first.take, "phone"), p2 = takePrompt(mid.take, "phone", TAKE_REF.fal);
  assert.ok(p1.includes("LAST THREE SECONDS:") && !p1.includes("never flinches") && p1.includes("NOBODY SPEAKS in this shot"));
  assert.ok(p2.includes("THEN the camera swings up to the far end of the hallway — in the same shot, one smooth unbroken move, never a cut — and stops: there, exactly as in @Image1, she stands at the far end of the hallway"));
  assert.ok(p2.includes("She never runs, never flinches, never turns around and never looks away") && p2.includes("the light changes only as the last four seconds say"));
  // NO WORD FOR THE ENGINE: no direction quotes anything, and no line of the one filming is in one
  for (const m of [first, mid, last]) for (const ref of [TAKE_REF.replicate, TAKE_REF.fal]) {
    const p = takePrompt(m.take, "phone", ref);
    assert.ok(!/["“”]/.test(p) && !p.includes("Mara") && !p.includes("at work") && p.length <= TAKE_PROMPT_MAX);
  }
  // WHAT THE ONE FILMING SAYS: at one take's own two times, moved with the moment's length — each with its mood
  assert.deepEqual(first.take.script, [{ at: 0.3, text: "Mara? ... Is that 'your' coat?", mood: "annoyed" }, { at: 3.6, text: "she's at work— she's at work", mood: "whispering" }]);
  assert.deepEqual(mid.take.script!.map((l) => l.at), [0.3, 5.6]);
  assert.deepEqual(takeLines(mid.take), mid.take.script, "the voice is laid from these lines, moods and all");
  // (a line with no mood: nobody is terrified before the last moment — and there the fear is one take's own, scared then terrified)
  assert.deepEqual(last.take.script, [{ at: 0.3, text: "Mara. Stop. Mara—", mood: "scared" }, { at: 8.6, text: "you're not her", mood: "terrified" }]);
  assert.deepEqual(parseFootageDirection({ moments: [hand(1, { says: [{ text: "who left the light on" }] }), hand(2), hand(3)] }, o)[0]!.cam === "hand" && (parseFootageDirection({ moments: [hand(1, { says: [{ text: "who left the light on" }] }), hand(2), hand(3)] }, o)[0] as { take: { script: unknown } }).take.script, [{ at: 0.3, text: "who left the light on", mood: "whispering" }]);
  assert.deepEqual(momentScript({ says: ["a", "b"], asks: "found" }, 6, ["calm", undefined]), [{ at: 2.8, text: "a", mood: "calm" }, { at: 5, text: "b" }], "a short moment's second line still comes after its first");
  assert.deepEqual(momentScript({ says: ["a", ""], asks: "looking" }, 10, []), [{ at: 0.3, text: "a" }]);

  // ONE TAKE'S OWN RULES: half a direction is no moment — and the others stand
  const half = parseFootageDirection({ moments: [hand(1), hand(2, { beats: ["only one beat"] }), hand(3, { opens: "" })] }, o);
  assert.deepEqual(undirected(half), [1, 2]);
  assert.ok(half[0]);
  // a THING that speaks is not followed (the engine would give it every word); nor, in a plain moment, anybody written
  // speaking — the SENTENCE that has them speak is taken out, never the whole moment (the first live film, 2026-11-25,
  // lost all three of its moments to these rules): what is left is filmed, the camera's hold where the speech was
  const spoke = parseFootageDirection({ moments: [hand(1), hand(2, { beats: ["she stands at the far end, perfectly still.", "she whispers the name of the one filming.", "she walks toward the camera."] }), hand(3)] }, o);
  assert.deepEqual(undirected(spoke), []);
  const spokeBeats = (spoke[1] as { take: { beats: string[] } }).take.beats;
  assert.deepEqual(spokeBeats, ["she stands at the far end, perfectly still.", HOLD_BEAT, "she walks toward the camera."]);
  const told = parseFootageDirection({ moments: [hand(1, { seen: false, beats: ["the coat sways on the rack.", "a man in the doorway tells the camera to leave.", "the coat is still."] }), hand(2), hand(3)] }, o);
  assert.ok(told[0] && !(told[0] as { take: { beats: string[] } }).take.beats.some((b) => /\btells?\b/.test(b)));
  // nobody is given a line: a moment with nothing said is no moment (one take's rule)
  assert.deepEqual(undirected(parseFootageDirection({ moments: [hand(1, { says: [] }), hand(2), hand(3)] }, o)), [0]);
  // no answer at all: every moment is still to be written
  for (const none of [null, "", "{", { moments: "x" }]) assert.deepEqual(undirected(parseFootageDirection(none, o)), [0, 1, 2]);
  // moments say which they are; an answer without numbers is read in order; one more than was asked for is not read
  const shuffled = parseFootageDirection({ moments: [hand(3, { who: "it" }), hand(1, { who: "the coat" }), hand(2)] }, o);
  assert.deepEqual(shuffled.map((m) => m && m.cam === "hand" && m.take.who), ["the coat", "she", "it"]);
  const unnumbered = parseFootageDirection({ moments: [hand(0, { n: undefined, who: "one" }), hand(0, { n: undefined, who: "two" }), hand(0, { n: undefined, who: "three" }), hand(0, { n: undefined, who: "four" })] }, o);
  assert.deepEqual(unnumbered.map((m) => m && m.cam === "hand" && m.take.who), ["one", "two", "three"]);
  // ASKED ONCE MORE: the second answer fills only what the first left empty
  const second = parseFootageDirection({ moments: [hand(2, { who: "the woman" }), hand(3, { who: "her" })] }, o, [1, 2]);
  const whole = withDirected(half, second);
  assert.deepEqual(undirected(whole), []);
  assert.equal(whole[0], half[0], "what was written the first time is kept");
  assert.deepEqual(whole.map((m) => m && m.cam === "hand" && m.take.who), ["she", "the woman", "her"]);
  assert.equal(withDirected(d, second)[1], d[1], "never over a moment that was already there");

  // A FILM THAT IS NOT A HORROR: every moment plain, whatever it sees — and nobody is frightened
  const dog = parseFootageDirection({ moments: [hand(1, { says: [{ text: "Biscuit? Is that you?" }] }), hand(2), hand(3)] }, { ...o, kind: "plain" });
  assert.ok(dog.every((m) => m && m.cam === "hand" && m.take.genre === "plain"));
  assert.deepEqual(dog[0] && dog[0].cam === "hand" && dog[0].take.script, [{ at: 0.3, text: "Biscuit? Is that you?", mood: "calm" }]);
  // A FILM WITH NO THING THAT RECURS: not a horror — nothing to be seen, every moment plain; a SCARE — what its writer
  // says is seen in a moment is still the scare's, with all its rules (review, 2026-11-25: it used to be made plain,
  // directed "at its real speed" and its picture told "no figure" over a still that had one)
  assert.ok(parseFootageDirection({ moments: [hand(1), hand(2), hand(3)] }, { ...o, kind: "plain", thing: "" }).every((m) => m && !m.seen && m.cam === "hand" && m.take.genre === "plain"));
  const bare = parseFootageDirection({ moments: [hand(1, { seen: false }), hand(2), hand(3)] }, { ...o, thing: "" });
  assert.deepEqual(bare.map((m) => m && m.cam === "hand" && [m.seen, m.take.genre]), [[false, "plain"], [true, undefined], [true, undefined]]);

  // A BODY CAMERA: the dispatcher's call opens the FIRST moment only — a separate voice, never in a direction; and a
  // plain moment with a weapon in it is not filmed (the drama's bounds)
  const wo = outlineOf("bodycam");
  const worn = parseFootageDirection({ radio: "Unit nine, noise complaint at four TEST Lane.", moments: [hand(1), hand(2), hand(3)] }, wo);
  assert.deepEqual(worn.map((m) => m && m.cam === "hand" && m.take.radio), ["Unit nine, noise complaint at four TEST Lane.", undefined, undefined]);
  assert.ok(!takePrompt((worn[0] as { take: Parameters<typeof takePrompt>[0] }).take, "bodycam").includes("Unit nine"));
  assert.equal(takeLines((worn[0] as { take: Parameters<typeof takeLines>[0] }).take)[0].radio, true);
  assert.equal(parseFootageDirection({ radio: "Unit nine.", moments: [hand(1)] }, o)[0]!.cam === "hand" && (parseFootageDirection({ radio: "Unit nine.", moments: [hand(1)] }, o)[0] as { take: { radio?: string } }).take.radio, undefined, "only a body camera has a radio");
  assert.deepEqual(undirected(parseFootageDirection({ moments: [hand(1, { seen: false, beats: ["a man stands at the kerb.", "the man pulls a pistol from his jacket.", "the man walks away."] }), hand(2), hand(3)] }, wo)), [0]);
});

test("A HOUSE CAMERA'S MOMENTS: something comes in — the walk-in, at the moment's own length — or nothing does; the same thing in every moment, word for word in its picture", () => {
  const o = outlineOf("house", { moments: [{ ...ANSWER.moments[0], room: "bedroom", seconds: 10 }, { ...ANSWER.moments[1], room: "bedroom", seconds: 15 }, { ...ANSWER.moments[2], room: "hallway", seconds: 12 }] });
  const seen = { set: "A man asleep in the bed on his back", door: "the half-open door on the right", stands: "stands at the foot of the bed, facing the sleeper, her head bowed", waits: "The man turns over in his sleep.", acts: "turns her head up toward the camera until she is looking straight into the lens", sound: "a quiet bedroom, a clock ticking" };
  const answer = {
    who: "she", thing: "a tall TEST woman in a grey raincoat, her wet hair hanging over her face",
    moments: [
      { n: 1, seen: false, set: "A man asleep in the bed on his back", happens: "the wardrobe door on the left swings slowly open", after: "the wardrobe door on the left standing wide open, black inside", sound: "a hinge creaking" },
      { n: 2, seen: true, ...seen },
      { n: 3, seen: true, ...seen, set: "", door: "the top of the staircase at the far end", stands: "stands in the middle of the runner rug, facing the camera", waits: "", acts: "walks slowly toward the camera until she is directly beneath it" },
    ],
  };
  const d = parseFootageDirection(answer, o);
  assert.deepEqual(undirected(d), []);
  const [trace, bed, hall] = d.map((m) => { assert.ok(m && m.cam === "house"); return m; });
  assert.deepEqual([trace.seen, bed.seen, hall.seen], [false, true, true]);
  assert.deepEqual([trace.scare.room, bed.scare.room, hall.scare.room], ["bedroom", "bedroom", "hallway"]);
  // NOTHING COMES IN: the room, and one thing in it that changes
  const tp = houseScarePrompt(trace.scare, "<<<image_1>>>");
  assert.ok(tp.includes("THEN, with nobody there to do it: the wardrobe door on the left swings slowly open.") && tp.includes("LAST THREE SECONDS: nothing else moves. Nobody comes into the room."));
  assert.equal(trace.scare.thing.first, "");
  // IT COMES IN: the walk-in that was rolled, at fifteen seconds word for word — and at twelve with its own times
  const bp = houseScarePrompt(bed.scare, "<<<image_1>>>");
  assert.ok(bp.includes("THEN the tall TEST woman in a grey raincoat, her wet hair hanging over her face — the one in <<<image_1>>> — comes in through the half-open door on the right from the darkness and walks slowly and stiffly across the room"));
  assert.ok(bp.includes("BY THE SIXTH SECOND she stands at the foot of the bed") && bp.includes("perfectly still for five whole seconds.") && bp.includes("LAST FOUR SECONDS: very slowly, she turns her head up toward the camera"));
  const hp = houseScarePrompt(hall.scare, "<<<image_1>>>");
  assert.ok(hp.includes("BY THE FIFTH SECOND she stands in the middle of the runner rug") && hp.includes("perfectly still for three whole seconds.") && hp.includes("in the corner of a hallway"));
  for (const p of [tp, bp, hp]) assert.ok(p.includes("NOBODY SPEAKS in this shot") && !/["“”]/.test(p) && !/\{(ref|thing)\}/.test(p) && p.length <= 2400);
  // THE TIME-LAPSE can play only where there is the stillness it plays over: a fifteen-second scare
  assert.deepEqual([trace.lapse, bed.lapse, hall.lapse], [false, true, false]);
  // THE SAME ONE IN EVERY MOMENT: named from words the first time it is drawn, from its own picture after — and THE
  // THING, the member's words, word for word in the picture's words
  const firstPic = houseScenePrompt(bed.scare), laterPic = houseScenePrompt(hall.scare, { kept: true });
  assert.ok(firstPic.includes("with ONLY this added: a tall TEST woman in a grey raincoat, her wet hair hanging over her face stands at the foot of the bed"));
  assert.ok(laterPic.startsWith("Wide 16:9 picture. EXACTLY the first reference image") && laterPic.includes("with ONLY this added: the tall TEST woman in a grey raincoat, her wet hair hanging over her face from the second reference image stands in the middle of the runner rug"));
  for (const pic of [firstPic, laterPic]) assert.ok(pic.includes(`Exactly this one — ${THING.replace(/\.$/, "")}.`), "the thing, word for word");
  assert.ok(!houseScenePrompt(trace.scare).includes("raincoat"), "nothing comes in: the thing is not in that picture");
  assert.equal(bed.scare.thing.key, "", "a film's thing is the film's own: the shop's house does not keep it");
  // a moment that fails one house take's rules is null, and asked for once more: no door, a thing that speaks, half a trace
  const bad = parseFootageDirection({ ...answer, moments: [{ n: 1, seen: false, happens: "a door", after: "" }, { n: 2, seen: true, ...seen, door: "out of thin air" }, { n: 3, seen: true, ...seen, acts: "whispers his name to the camera" }] }, o);
  assert.deepEqual(undirected(bad), [0, 1, 2]);
  // NOT A HORROR on the kitchen camera: it comes the whole way, at its real speed — and nothing about it is wrong
  const ko = outlineOf("house", { kind: "plain", thing: "Biscuit, a small brown TEST terrier with one white ear.", moments: [{ when: "NIGHT 1 · 2:14 AM", line: "The kitchen: the fridge door is standing open.", seconds: 10, room: "kitchen" }, { when: "NIGHT 2 · 2:31 AM", line: "The dog trots in and opens the fridge.", seconds: 12, room: "kitchen" }] });
  const k = parseFootageDirection({ who: "it", thing: "a small brown TEST terrier with one white ear", moments: [
    { n: 1, seen: false, set: "", happens: "the fridge door swings open a hand's width", after: "the fridge door standing a hand's width open, its light on", sound: "a fridge humming" },
    { n: 2, seen: true, set: "", door: "the doorway to the dark hall", stands: "stands on its hind legs at the fridge, its front paws on the door", waits: "The fridge door swings open.", acts: "takes a packet from the bottom shelf and trots back out", sound: "claws on the floor" },
  ] }, ko);
  assert.deepEqual(undirected(k), []);
  const kp = houseScarePrompt((k[1] as { scare: Parameters<typeof houseScarePrompt>[0] }).scare, "<<<image_1>>>");
  assert.ok(kp.includes("crosses the room the way it really would") && kp.includes("LAST FOUR SECONDS: it takes a packet from the bottom shelf and trots back out.") && !kp.includes("stiffly") && !kp.includes("DOES NOT MOVE"));
  assert.equal(k[1] && k[1].cam === "house" && k[1].lapse, false, "no stillness, no time-lapse");
});

/* ---- THE PICTURES ---- */

test("THE PLACE AND THE THING, WORD FOR WORD, IN EVERY PICTURE — the first from words, every other from it, the thing from its own payoff", () => {
  const o = outlineOf("phone");
  const still = "The camera looks down the hallway from the bedroom door: at the far end, by the coat rack, she stands with her back to the camera.";
  // THE FILM'S FIRST PICTURE: from words — the creature recipe only where the thing is IN it
  const first = footageScenePrompt(o, { still, seen: true, who: "she" });
  assert.equal(first, `Vertical 9:16 picture. ${TAKE_CAUGHT} THE PLACE: ${PLACE} WHAT THE CAMERA SEES: ${still} WHO OR WHAT IT IS: ${THING} ${TAKE_WRONG} ${TAKE_HIDDEN} Nothing written anywhere in the picture. No watermark, no signature.`);
  const unseen = footageScenePrompt(o, { still, seen: false });
  assert.ok(unseen.includes(`THE PLACE: ${PLACE}`) && !unseen.includes(THING) && !unseen.includes(TAKE_WRONG) && !unseen.includes(TAKE_HIDDEN));
  assert.ok(unseen.includes("NOTHING frightening is in the picture itself: no figure, no face in the dark. No blood, no gore, no wounds.") && unseen.startsWith(`Vertical 9:16 picture. ${TAKE_CAUGHT} `));
  // EVERY LATER ONE is drawn FROM the first picture: the same place, at another moment
  const later = footageScenePrompt(o, { still, seen: false }, 1);
  assert.ok(later.startsWith(`Vertical 9:16 picture. The SAME place and the SAME camera as the reference image — the same walls, floor, furniture, light and grain wherever the picture shows the same part of it — at ANOTHER MOMENT: ${still} THE PLACE, in words: ${PLACE} Real footage, never a render.`));
  // …and where the thing is in it, from the picture it was drawn up close in too: the SAME one
  const both = footageScenePrompt(o, { still, seen: true, who: "she" }, 2);
  // (a pronoun is "the SAME one" — "the SAME she" is no sentence; review, 2026-11-25 — and "the figure" the SAME figure)
  assert.ok(both.includes("as the first reference image") && both.includes(`It is the SAME one as in the second reference image — the same face, the same body, the same clothes: ${THING}`) && both.includes(`THE PLACE, in words: ${PLACE}`));
  assert.ok(footageScenePrompt(o, { still, seen: true, who: "the figure" }, 2).includes("It is the SAME figure as in the second reference image"));
  // A SCARE WHOSE WRITER NAMED NO THING THAT RECURS: a moment something is seen in is held to the creature's rules —
  // never told "no figure" over a still that has one (review, 2026-11-25)
  const nameless = footageScenePrompt({ ...o, thing: "" }, { still, seen: true, who: "she" });
  assert.ok(nameless.includes(`${TAKE_WRONG} ${TAKE_HIDDEN}`) && !nameless.includes("no figure") && !nameless.includes("WHO OR WHAT IT IS"));
  assert.ok(footageScenePrompt(o, { still, seen: true }, 1).includes(`WHO OR WHAT IT IS: ${THING}`), "the payoff itself is drawn from the place and the words");
  // WORD FOR WORD: the member's own place and thing are in every picture the thing is in, however it is drawn
  for (const refs of [0, 1, 2] as const) { const p = footageScenePrompt(o, { still, seen: true, who: "she" }, refs); assert.ok(p.includes(PLACE) && p.includes(THING) && p.endsWith("Nothing written anywhere in the picture. No watermark, no signature."), `refs ${refs}`); }
  assert.ok(footageScenePrompt({ ...o, aspect: "16:9" }, { still, seen: true }).startsWith("Wide 16:9 picture."));
  // a place a member left empty is simply not said
  assert.ok(!footageScenePrompt({ ...o, place: "" }, { still, seen: true }).includes("THE PLACE"));
  // NOT A HORROR: caught in whatever light there was, and nothing of the creature's — a body camera's in its own look, inside the drama's bounds
  const plain = footageScenePrompt({ ...o, kind: "plain" }, { still, seen: true });
  assert.ok(plain.startsWith(`Vertical 9:16 picture. ${PLAIN_CAUGHT} `) && plain.includes(`${PLAIN_BOUNDS} Nothing written anywhere in the picture.`) && !plain.includes(TAKE_WRONG) && !plain.includes(TAKE_CAUGHT));
  const worn = footageScenePrompt({ ...o, kind: "plain", camera: "bodycam", aspect: "16:9" }, { still, seen: true });
  assert.ok(worn.startsWith(`Wide 16:9 picture. ${DRAMA_CAUGHT} `) && worn.includes(DRAMA_BOUNDS));
  // THE WAY IN: one take's own, from the moment's own scene — a body camera's plain one inside the bounds
  const take = { opens: "the camera looks down at the worn green runner by the bedroom door.", genre: undefined };
  assert.ok(footageOpensPrompt(o, take).startsWith("Vertical 9:16 picture. The SAME place and the SAME camera as the reference image, a moment earlier: the camera looks down at the worn green runner by the bedroom door. NOBODY is in the picture"));
  const wornIn = footageOpensPrompt({ camera: "bodycam", aspect: "16:9" }, { ...take, genre: "plain" });
  assert.ok(wornIn.includes("What the camera is about to find is NOT in the picture yet.") && wornIn.endsWith(`${DRAMA_BOUNDS} Nothing written anywhere.`));
  assert.ok(!footageOpensPrompt({ camera: "phone", aspect: "9:16" }, { ...take, genre: "plain" }).includes(DRAMA_BOUNDS));

  // THE ORDER THE SCENES ARE DRAWN IN: the first moment (the place); then the LAST moment the thing is in (its payoff,
  // where it is closest); then the rest, which can be drawn together
  assert.deepEqual(footageScenePlan([false, true, true, true]), { place: 0, thing: 3, rest: [1, 2] });
  assert.deepEqual(footageScenePlan([true, false, true, false]), { place: 0, thing: 2, rest: [1, 3] });
  // the thing only in the first moment: that picture is both; nothing seen at all: no thing's picture
  assert.deepEqual(footageScenePlan([true, false, false]), { place: 0, thing: 0, rest: [1, 2] });
  assert.deepEqual(footageScenePlan([false, false]), { place: 0, thing: null, rest: [1] });
  // a moment with no direction (or left out) is not drawn — and the next is the film's first
  assert.deepEqual(footageScenePlan([null, false, null, true]), { place: 1, thing: 3, rest: [] });
  assert.equal(footageScenePlan([null, null]), null);
  assert.equal(footageScenePlan([]), null);
});

/* ---- THE CLOCK ---- */

test("THE CLOCK A MOMENT PRINTS IS WHAT ITS CARD SAYS: \"NIGHT 2 · 3:07 AM\" → the second night, 03:07 — and what a card does not say is filled in believably", () => {
  // what a card says
  assert.deepEqual(cardWhen("NIGHT 2 · 3:07 AM"), { day: 2, part: "night", weekday: null, time: 3 * 3600 + 7 * 60 });
  assert.deepEqual(cardWhen("night two, 11.52 pm"), { day: 2, part: "night", weekday: null, time: 23 * 3600 + 52 * 60 });
  assert.deepEqual(cardWhen("DAY 3 · 16:40"), { day: 3, part: "day", weekday: null, time: 16 * 3600 + 40 * 60 });
  assert.deepEqual(cardWhen("12:05 A.M."), { day: null, part: null, weekday: null, time: 5 * 60 });
  assert.deepEqual(cardWhen("12:00 PM"), { day: null, part: null, weekday: null, time: 12 * 3600 });
  assert.deepEqual(cardWhen("TUESDAY · 2 AM"), { day: null, part: null, weekday: 2, time: 2 * 3600 });
  assert.deepEqual(cardWhen("WEEK 2 · NIGHT"), { day: 8, part: "night", weekday: null, time: null });
  assert.deepEqual(cardWhen("03:07:44"), { day: null, part: null, weekday: null, time: 3 * 3600 + 7 * 60 + 44 });
  for (const none of ["LATER", "", null, "THE BASEMENT", "25:99", "NIGHT 0"]) assert.deepEqual(cardWhen(none), { day: null, part: /NIGHT/.test(String(none)) ? "night" : null, weekday: null, time: null }, String(none));
  assert.deepEqual(cardWhen("TAPE 2"), { day: null, part: null, weekday: null, time: null }, "a bare number is not a time");

  const hm = (c: { start: number }) => clockText(c.start).slice(0, 5);
  // THE SPEC'S OWN: the second night at 03:07 — a date later than the first, the hour and minute the card's
  const film = footageClocks(["NIGHT 1 · 2:14 AM", "NIGHT 2 · 3:07 AM", "NIGHT 4 · 3:11 AM"], "2026-11-25", 7);
  assert.deepEqual(film.map(hm), ["02:14", "03:07", "03:11"]);
  // the film's LAST night is today (footage is found after it was shot); the camera prints the date its own way
  assert.deepEqual(film.map((c) => c.date), ["2026-11-22 SUN", "2026-11-23 MON", "2026-11-25 WED"]);
  // (a camera never starts on the minute: the seconds are picked, the same for the same film)
  assert.ok(film.every((c) => c.start % 60 >= 5 && c.start % 60 <= 54));
  assert.deepEqual(footageClocks(["NIGHT 1 · 2:14 AM", "NIGHT 2 · 3:07 AM", "NIGHT 4 · 3:11 AM"], "2026-11-25", 7), film);
  assert.notDeepEqual(footageClocks(["NIGHT 1 · 2:14 AM", "NIGHT 2 · 3:07 AM", "NIGHT 4 · 3:11 AM"], "2026-11-25", 8).map((c) => c.start), film.map((c) => c.start));
  assert.equal(footageClocks(["NIGHT 1 · 02:14:09"], "2026-11-25")[0].start, 2 * 3600 + 14 * 60 + 9, "a card that gives its seconds keeps them");
  // A NIGHT'S SMALL HOURS ARE THE MORNING AFTER: 11:52 PM comes before 12:40 AM of the same night, a date apart
  const night = footageClocks(["NIGHT 1 · 11:52 PM", "NIGHT 1 · 12:40 AM", "NIGHT 2 · 11:30 PM"], "2026-11-25");
  assert.deepEqual(night.map((c) => [c.date, hm(c)]), [["2026-11-24 TUE", "23:52"], ["2026-11-25 WED", "00:40"], ["2026-11-25 WED", "23:30"]]);
  // days are days: the same date as their number says
  assert.deepEqual(footageClocks(["DAY 1 · 4:40 PM", "DAY 3 · 9:05 AM"], "2026-11-25").map((c) => [c.date, hm(c)]), [["2026-11-23 MON", "16:40"], ["2026-11-25 WED", "09:05"]]);
  // AN HOUR AND NOTHING MORE: the same night while the hours go forward — the next when this hour has already gone by
  const hours = footageClocks(["1:10 AM", "2:45 AM", "1:30 AM"], "2026-11-25");
  assert.deepEqual(hours.map((c) => [c.date, hm(c)]), [["2026-11-24 TUE", "01:10"], ["2026-11-24 TUE", "02:45"], ["2026-11-25 WED", "01:30"]]);
  // A NIGHT AND NO HOUR: that night's small hours; NOTHING READABLE AT ALL: consecutive nights, at believable hours
  for (const whens of [["NIGHT 1", "NIGHT 2", "NIGHT 5"], ["LATER", "THE BASEMENT", ""], [null, undefined, 7]]) for (const seed of [0, 3, 99_991]) {
    const c = footageClocks(whens, "2026-11-25", seed);
    assert.equal(c.length, 3);
    assert.ok(c.every((x) => x.start >= 20 * 60 && x.start <= 3 * 3600 + 30 * 60 && Number.isInteger(x.start)), `small hours: ${c.map(hm)}`);
    assert.ok(c[0].date < c[1].date && c[1].date < c[2].date, `later nights are later dates: ${c.map((x) => x.date)}`);
    assert.equal(c[2].date, "2026-11-25 WED");
  }
  assert.deepEqual(footageClocks(["LATER", "THE BASEMENT", ""], "2026-11-25").map((c) => c.date), ["2026-11-23 MON", "2026-11-24 TUE", "2026-11-25 WED"]);
  // a part of the day and no hour: a day's afternoon, a morning, an evening
  const parts = footageClocks(["DAY 1", "MORNING 2", "EVENING 2"], "2026-11-25", 4).map((c) => c.start / 3600);
  assert.ok(parts[0] >= 13 && parts[0] < 17 && parts[1] >= 7 && parts[1] < 10 && parts[2] >= 19 && parts[2] < 21, String(parts));
  // A CARD THAT NAMES A WEEKDAY is printed on one — and a later weekday is that many days on
  const week = footageClocks(["MONDAY · 2:14 AM", "WEDNESDAY · 3:07 AM"], "2026-11-25");
  assert.deepEqual(week.map((c) => [c.date.slice(11), hm(c)]), [["MON", "02:14"], ["WED", "03:07"]]);
  assert.ok(week[1].date <= "2026-11-25 WED" && week[0].date.slice(0, 10) === "2026-11-23");
  assert.deepEqual(footageClocks([], "2026-11-25"), []);
  // WHAT A CAMCORDER BURNS INTO ITS CORNER for that clock; a body camera and a house camera print the clock itself
  assert.deepEqual(camStamp({ date: "2026-11-23 MON", start: 3 * 3600 + 7 * 60 + 31 }), { date: "NOV 23 2026", time: "3:07 AM" });
  assert.deepEqual(camStamp({ date: "2027-01-05 TUE", start: 23 * 3600 + 52 * 60 }), { date: "JAN 5 2027", time: "11:52 PM" });
  assert.deepEqual(camStamp({ date: "2026-11-23", start: 12 * 3600 }).time, "12:00 PM");
  assert.deepEqual(camStamp({ date: "2026-11-23", start: 5 }).time, "12:00 AM");
});

/* ---- THE CARDS AND THE JOIN — on real ffmpeg ---- */

const ffmpegOk = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0 && spawnSync("ffprobe", ["-version"], { encoding: "utf8" }).status === 0;
/** a face ffmpeg can open: the app's own (the camera's mono face is fetched to the renders disk on the server) */
const FONT = path.join(root, "public", "fonts", "Poppins-Bold.ttf");
const streamsOf = (file: string): { video: number; audio: number | null; w: number; h: number; fps: number; rate: number } => {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,duration,width,height,avg_frame_rate,sample_rate", "-of", "json", file], { encoding: "utf8" });
  const s = (JSON.parse(r.stdout || "{}").streams || []) as Array<Record<string, string>>;
  const v = s.find((x) => x.codec_type === "video") || {}, a = s.find((x) => x.codec_type === "audio");
  const [num, den] = String(v.avg_frame_rate || "0/1").split("/").map(Number);
  return { video: parseFloat(v.duration), audio: a ? parseFloat(a.duration) : null, w: Number(v.width), h: Number(v.height), fps: den ? num / den : 0, rate: a ? Number(a.sample_rate) : 0 };
};
/** a stand-in moment: `colour` filling a w×h picture at `fps` for `picture` s, a tone for `sound` s (0: no sound at all) */
const standIn = (dir: string, name: string, colour: string, size: string, fps: number, picture: number, sound: number): string => {
  const out = path.join(dir, `${name}.mp4`);
  const args = ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${colour}:s=${size}:r=${fps}:d=${picture}`];
  if (sound > 0) args.push("-f", "lavfi", "-i", `sine=frequency=440:sample_rate=44100:duration=${sound}`);
  args.push("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", ...(sound > 0 ? ["-c:a", "aac"] : []), out);
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return out;
};
const meanDb = (file: string): number => Number((/mean_volume:\s*(-?[\d.]+) dB/.exec(spawnSync("ffmpeg", ["-v", "info", "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr) || [])[1]);
/** cards and stand-in moments joined the way footage-film.server.ts → joinFootage joins them: a card before every
 *  moment at the film's size and rate, every piece measured by its PICTURE, the graph, one ffmpeg, the check */
const joinFilm = (dir: string, name: string, moments: Array<{ file: string; when: string }>, o: { w: number; h: number; fps: number }) => {
  const pieces: string[] = [];
  moments.forEach((m, i) => {
    const card = path.join(dir, `${name}-card${i}.mp4`);
    const c = spawnSync("ffmpeg", footageCardArgs({ when: m.when, w: o.w, h: o.h, fps: o.fps, font: FONT, out: card }), { encoding: "utf8" });
    assert.equal(c.status, 0, c.stderr);
    pieces.push(card, m.file);
  });
  const measured = pieces.map(streamsOf);
  const frames = measured.map((s) => Math.max(1, Math.round(s.video * o.fps)));
  const silent = measured.map((s) => s.audio === null);
  const plan = footageJoinGraph({ frames, fps: o.fps, w: o.w, h: o.h, silent });
  const film = path.join(dir, `${name}.mp4`);
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...pieces.flatMap((p) => ["-threads", "1", "-i", p]), "-filter_complex", plan.graph, "-map", "[vc]", "-map", "[ac]", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", film], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  // every frame read back as one colour: which pieces' pictures are in the film, and how many frames of each
  const raw = spawnSync("ffmpeg", ["-v", "error", "-i", film, "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { encoding: "buffer", maxBuffer: 1 << 26 }).stdout;
  const seen = { red: 0, green: 0, blue: 0, black: 0, mixed: 0 };
  const order: string[] = [];
  for (let k = 0; k + 2 < raw.length; k += 3) {
    const [r0, g, b] = [raw[k], raw[k + 1], raw[k + 2]];
    const what = r0 > 200 && g < 60 && b < 60 ? "red" : g > 100 && r0 < 60 && b < 60 ? "green" : b > 200 && r0 < 60 && g < 60 ? "blue" : r0 < 40 && g < 40 && b < 40 ? "black" : "mixed";
    seen[what as keyof typeof seen]++;
    if (order[order.length - 1] !== what) order.push(what);
  }
  const streams = streamsOf(film);
  return { film, pieces, frames, plan, streams, seen, order, check: footageJoinCheck({ ...streams, frames: plan.frames, fps: o.fps }) };
};

test("THE JOIN'S GRAPH: every piece exactly as long as its PICTURE, its sound the very same length, straight cuts, never cropped — at the film's own rate", () => {
  assert.equal(FOOTAGE_RATE, 48000);
  assert.deepEqual([...FOOTAGE_FPS], [15, 24, 25, 30]);
  // every rate a film is joined at divides the sound rate: a piece's sound can be cut to its frames exactly
  for (const f of FOOTAGE_FPS) assert.equal(FOOTAGE_RATE % f, 0, String(f));
  assert.deepEqual([24, 23.976, 15, 30, 29.97, 60, 0, "x"].map(footageFps), [24, 24, 15, 30, 30, 30, 30, 30]);
  const { graph, frames } = footageJoinGraph({ frames: [29, 288.4, 29, 240], fps: 24, w: 1080, h: 1920, silent: [false, false, false, true] });
  assert.equal(frames, 29 + 288 + 29 + 240);
  const parts = graph.split(";");
  // the picture: fitted, never cropped (a dressed take's marks sit at its edges); brought to the rate; its last frame held, then cut
  assert.equal(parts[0], "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease:flags=bicubic,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=24,format=yuv420p,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=3,trim=end_frame=29,setpts=PTS-STARTPTS[v0]");
  assert.ok(!graph.includes("crop="));
  // its sound: 2,000 samples a frame at 24 — cut or padded to the very same length; a cut meets in two 12 ms fades
  assert.equal(parts[1], "[0:a]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS,apad,atrim=end_sample=58000,asetpts=PTS-STARTPTS,afade=t=out:st=1.196333:d=0.012[a0]");
  assert.ok(parts[3].includes("atrim=end_sample=576000,asetpts=PTS-STARTPTS,afade=t=in:d=0.012,afade=t=out:st=11.988000:d=0.012[a1]"));
  // a piece with no sound at all gets silence of its own length; the last piece does not fade out
  assert.equal(parts[7], "anullsrc=r=48000:cl=stereo,atrim=end_sample=480000,asetpts=PTS-STARTPTS,afade=t=in:d=0.012[a3]");
  // straight cuts: one join, in order — nothing dissolves
  assert.equal(parts[8], "[v0][a0][v1][a1][v2][a2][v3][a3]concat=n=4:v=1:a=1[vc][ac]");
  assert.ok(!/xfade|acrossfade/.test(graph));
  assert.ok(footageJoinGraph({ frames: [30, 150], fps: 15, w: 1921, h: 1079 }).graph.startsWith("[0:v]scale=1922:1080:"), "even sizes");
  assert.deepEqual(footageJoinGraph({ frames: [], fps: 24, w: 2, h: 2 }), { graph: "", frames: 0 });
  // IS IT WHOLE? picture and sound the same length, and the length its pieces add up to — within two frames and a block of sound
  assert.equal(footageTolerance(24), 2 / 24 + 1024 / 48000);
  assert.deepEqual(footageJoinCheck({ video: 24.417, audio: 24.42, frames: 586, fps: 24 }), { ok: true, why: "" });
  assert.equal(footageJoinCheck({ video: 19.17, audio: 24.17, frames: 580, fps: 24 }).why, "its picture runs 19.170 s and its sound 24.170 s");
  assert.equal(footageJoinCheck({ video: 20, audio: 20, frames: 586, fps: 24 }).why, "its picture runs 20.000 s where its cards and moments add up to 24.417 s");
  assert.equal(footageJoinCheck({ video: 20, audio: null, frames: 480, fps: 24 }).ok, false, "a film with no sound is not whole");
  assert.equal(footageJoinCheck({ video: NaN, audio: 20, frames: 480, fps: 24 }).ok, false);
});

test("THE CARD: its \"when\" on black for 1.2 s at the film's own size and rate — escaped for drawtext, and near-silence under it, never digital zero", { skip: !ffmpegOk }, () => {
  // as drawtext is given it: capitals, every colon escaped, nothing that could end the text
  assert.equal(cardText("night 2 · 3:07 am"), "NIGHT 2 · 3\\:07 AM");
  assert.equal(cardText("it's 50% [done]; 3:07,am"), "IT’S 50 DONE 3\\:07,AM");
  assert.equal(cardText(""), "FOUND FOOTAGE");
  const args = footageCardArgs({ when: "NIGHT 2 · 3:07 AM", w: 1080, h: 1920, fps: 24, font: "C:\\fonts\\TEST Mono.ttf", out: "card.mp4" });
  const graph = args[args.indexOf("-filter_complex") + 1];
  assert.ok(graph.startsWith("[0:v]drawtext=fontfile='C\\:/fonts/TEST Mono.ttf':expansion=none:text='NIGHT 2 · 3\\:07 AM':fontcolor=white:fontsize=56:x=(w-tw)/2:y=(h-th)/2,format=yuv420p[v];"), graph);
  assert.ok(graph.endsWith(`[1:a]aformat=channel_layouts=stereo,highpass=f=60,lowpass=f=1400,volume=${FOOTAGE_CARD_DB}dB[a]`));
  assert.ok(args.includes("color=c=black:s=1080x1920:r=24") && args.includes("anoisesrc=color=brown:amplitude=0.05:sample_rate=48000"));
  assert.equal(count(args.join(" "), "-t 1.200"), 3, "1.2 seconds: both sources, and the card itself");
  assert.ok(!/fade/.test(graph), "a hard cut in and out: nothing fades");
  // a long card is drawn smaller, never off the edge (a mono face's letters are 0.6 of its size wide)
  const long = footageCardArgs({ when: "W".repeat(28), w: 720, h: 1280, fps: 24, font: FONT, out: "x.mp4" });
  const size = Number(/fontsize=(\d+)/.exec(long[long.indexOf("-filter_complex") + 1])![1]);
  assert.ok(size * 0.6 * 28 <= 720 * 0.87 && size >= 14, `28 letters at ${size}px fit a 720px frame`);

  // THE REAL THING, on every shape and rate a film has — and with the characters that would break a filter
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "footage-card-"));
  try {
    for (const [when, w, h, fps] of [["NIGHT 1 · 2:14 AM", 1080, 1920, 24], ["NIGHT 2 · 3:07 AM", 1280, 720, 15], ["it's 50% [done]; 3:07,am — ok", 720, 1280, 30]] as Array<[string, number, number, number]>) {
      const out = path.join(dir, `card-${w}-${fps}.mp4`);
      const r = spawnSync("ffmpeg", footageCardArgs({ when, w, h, fps, font: FONT, out }), { encoding: "utf8" });
      assert.equal(r.status, 0, `${when}: ${r.stderr}`);
      const s = streamsOf(out);
      assert.deepEqual([s.w, s.h, Math.round(s.fps), s.rate], [w, h, fps, 48000], when);
      assert.ok(Math.abs(s.video - FOOTAGE_CARD_SECONDS) <= 1 / fps && Math.abs((s.audio as number) - FOOTAGE_CARD_SECONDS) <= 0.03, `${when}: ${s.video} / ${s.audio}`);
      // NEAR-silence: far under a take's room (−34 dB), and not the −91 of digital zero
      const db = meanDb(out);
      assert.ok(db > -75 && db < -50, `${when}: ${db} dB`);
      // the card is black with white writing in its middle: its corners are black, its middle row is not
      // LOOKED AT: one frame of it, an eighth of its size, as grey — the brightest point of each part of the picture
      const gw = w / 8, gh = h / 8;
      const grey = spawnSync("ffmpeg", ["-v", "error", "-ss", "0.5", "-i", out, "-frames:v", "1", "-vf", `scale=${gw}:${gh}:flags=area`, "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"], { encoding: "buffer" }).stdout;
      assert.equal(grey.length, gw * gh);
      const brightest = (x0: number, y0: number, x1: number, y1: number) => { let m = 0; for (let y = Math.floor(y0 * gh); y < Math.ceil(y1 * gh); y++) for (let x = Math.floor(x0 * gw); x < Math.ceil(x1 * gw); x++) m = Math.max(m, grey[y * gw + x]); return m; };
      // black above and below, and nothing drawn in the outermost twentieth on either side: its words stay inside the frame
      assert.ok(brightest(0, 0, 1, 0.4) < 20 && brightest(0, 0.6, 1, 1) < 20 && brightest(0, 0, 0.05, 1) < 20 && brightest(0.95, 0, 1, 1) < 20, `${when}: black all round`);
      // …and white writing across its middle, on both sides of the centre
      assert.ok(brightest(0.1, 0.45, 0.5, 0.55) > 80 && brightest(0.5, 0.45, 0.9, 0.55) > 80, `${when}: its words are drawn in white across the middle`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("CARDS AND MOMENTS, JOINED BY REAL FFMPEG: the film's length is the sum of its pieces, its picture and its sound the same length — and every moment is all there", { skip: !ffmpegOk }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "footage-join-"));
  try {
    // A PHONE'S FILM at its own 24 frames a second: three moments whose sound runs 30 ms past their picture (what took a
    // reveal out of an acted film — acted-staging.ts), one of them with no sound at all
    const shots = [
      { file: standIn(dir, "m1", "red", "720x1280", 24, 3.0, 3.03), when: "NIGHT 1 · 2:14 AM" },
      { file: standIn(dir, "m2", "green", "720x1280", 24, 2.5, 2.53), when: "NIGHT 2 · 3:07 AM" },
      { file: standIn(dir, "m3", "blue", "720x1280", 24, 4.0, 0), when: "NIGHT 4 · 3:11 AM" },
    ];
    const j = joinFilm(dir, "phone", shots, { w: 720, h: 1280, fps: 24 });
    assert.ok(j.check.ok, j.check.why);
    // a card is 29 frames at 24 (1.2 s, rounded up to a frame); each moment is its picture, to the frame
    assert.deepEqual(j.frames, [29, 72, 29, 60, 29, 96]);
    assert.equal(j.plan.frames, 3 * 29 + 72 + 60 + 96);
    // THE FILM'S LENGTH IS THE SUM — and its picture and its sound are the same length
    const want = j.plan.frames / 24;
    assert.ok(Math.abs(j.streams.video - want) <= footageTolerance(24), `picture ${j.streams.video} of ${want}`);
    assert.ok(Math.abs((j.streams.audio as number) - want) <= footageTolerance(24), `sound ${j.streams.audio} of ${want}`);
    assert.ok(Math.abs(j.streams.video - (j.streams.audio as number)) <= footageTolerance(24));
    assert.ok(Math.abs(want - (footageSeconds({ moments: [{ seconds: 3 }, { seconds: 2.5 }, { seconds: 4 }] as never }))) <= 3 / 24, "what the outline promised, to within a frame a card");
    // every moment is ALL there, in order, a card before each, and nothing dissolved into anything
    assert.deepEqual(j.order, ["black", "red", "black", "green", "black", "blue"]);
    assert.deepEqual([j.seen.red, j.seen.green, j.seen.blue, j.seen.black, j.seen.mixed], [72, 60, 96, 87, 0]);
    assert.deepEqual([j.streams.w, j.streams.h, Math.round(j.streams.fps), j.streams.rate], [720, 1280, 24, 48000], "the takes' own size and rate");

    // A HOUSE CAMERA'S FILM at its own 15, wide — and a moment that came back smaller (another host's roll) is fitted to
    // the film's size, never cropped and never left to change the picture's size mid-film
    const wide = [
      { file: standIn(dir, "h1", "red", "1280x720", 15, 5.0, 5.0), when: "NIGHT 1 · 1:02 AM" },
      { file: standIn(dir, "h2", "blue", "640x360", 15, 6.0, 6.04), when: "NIGHT 3 · 3:33 AM" },
    ];
    const h = joinFilm(dir, "house", wide, { w: 1280, h: 720, fps: 15 });
    assert.ok(h.check.ok, h.check.why);
    assert.deepEqual(h.frames, [18, 75, 18, 90]);
    assert.deepEqual([h.streams.w, h.streams.h, Math.round(h.streams.fps)], [1280, 720, 15]);
    assert.deepEqual(h.order, ["black", "red", "black", "blue"]);
    assert.deepEqual([h.seen.red, h.seen.blue, h.seen.black, h.seen.mixed], [75, 90, 36, 0]);
    assert.ok(Math.abs(h.streams.video - (h.streams.audio as number)) <= footageTolerance(15));

    // MOMENTS AT ANOTHER RATE THAN THE FILM'S (takes that did not agree are joined at 30): still whole
    const mixed = joinFilm(dir, "mixed", [shots[0], { file: standIn(dir, "x2", "green", "720x1280", 30, 2.0, 2.0), when: "LATER" }], { w: 720, h: 1280, fps: 30 });
    assert.ok(mixed.check.ok, mixed.check.why);
    assert.deepEqual(mixed.frames, [36, 90, 36, 60]);
    assert.deepEqual(mixed.order, ["black", "red", "black", "green"]);
    // the check itself: a film cut short is not whole
    assert.equal(footageJoinCheck({ ...j.streams, frames: j.plan.frames + 48, fps: 24 }).ok, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ---- THE MAKING, as its source says it (it rolls on paid models: nothing here can be run in a test) ---- */

test("THE MAKING: three rolls at once and their encodes in turn; one more roll a moment, three a film; a house camera one moment after another", () => {
  const srv = read("app", "lib", "footage-film.server.ts");
  assert.deepEqual([FOOTAGE_ROLLS_AT_ONCE, FOOTAGE_REROLLS], [3, 3]);
  // every handheld moment is made by ONE take's own maker — three at a time, the cut cut off and the dressing in turn
  // with every other job's encodes (the server has 2 GB)
  assert.ok(srv.includes("await inTurns(live().filter((i) => !finished(i)), FOOTAGE_ROLLS_AT_ONCE, async (i) => {"));
  assert.ok(srv.includes("const m = await makeTake({") && srv.includes("turn: ffmpegTurn,") && srv.includes('import { ffmpegTurn } from "./ffmpeg-turn";'));
  // (inTurns never has more than `atOnce` at work, and starts the next as one ends)
  assert.ok(srv.includes("const hand = async () => { while (next < items.length) await work(items[next++]); };") && srv.includes("await Promise.all(Array.from({ length: Math.max(1, Math.min(atOnce, items.length)) }, hand));"));
  const take = read("app", "lib", "take.server.ts");
  assert.ok(take.includes("const turn = opts.turn || (<T>(run: () => Promise<T>): Promise<T> => run());"), "one take runs its encodes at once, as it always has");
  assert.ok(take.includes('const r = await turn(() => run("ffmpeg", ["-v", "error", "-y", "-ss", Math.max(0, early - 0.005).toFixed(3),') && take.includes("const dressed = await turn(() => dressTake(path.join(dir, soundName), { look: camera, w: size.w, h: size.h, ...worn, ...(opts.look || {}) }));"));
  // its parts and its two pictures arrive made: makeTake writes and draws nothing for a film
  assert.ok(srv.includes("resume: { ckTake: JSON.stringify(d.take), ckStill: text(r.ckStill), ckOpens: text(r.ckOpens), ckRoll: text(r.ckRoll), ckRaw: text(r.ckRaw), ckHost: text(r.ckHost), ckSpoke: text(r.ckSpoke), ckCuts: text(r.ckCuts), ckTrim: text(r.ckTrim) },"));
  // A ROLL AGAIN: one for any moment, three for the whole film — counted across a restart — and none when TAKE_REROLLS=0
  assert.ok(srv.includes("let again = Math.max(0, FOOTAGE_REROLLS - records.reduce((n, r) => n + (Number(r.rerolls) || 0), 0));"));
  assert.ok(srv.includes("const mayRoll = (i: number) => () => (rerolls() > 0 && again > 0 && !(Number(records[i].rerolls) > 0) ? 1 : 0);"));
  // (counted the moment it is spent — before the roll is even asked for — and kept on the moment's own record)
  assert.ok(srv.includes("const rolledAgain = (i: number) => () => { again--; void save(i, { rerolls: (Number(records[i].rerolls) || 0) + 1 }); };"));
  assert.ok(take.includes("— rolled again`);\n      opts.onReroll?.();\n      try {"), "said before the second roll is asked for");
  assert.equal(count(srv, "rerolls: mayRoll(i), onReroll: rolledAgain(i),"), 2, "a handheld moment's and a house moment's");
  // the clock its card says: a body camera prints it, a camcorder burns its date and hour in
  assert.ok(srv.includes('!clock ? undefined : camera === "bodycam" ? { clock } : camera === "camcorder" ? { stamp: camStamp(clock) } : undefined;') && srv.includes("look: lookFor(camera, clocks[i]),"));
  assert.ok(srv.includes("const clocks = footageClocks(film.moments.map((m) => m.when), today, seed);"));
  // A MOMENT THAT WILL NOT ROLL IS LEFT OUT, and the film goes on with what it has
  assert.equal(count(srv, "} catch (e) { await leave(i, `it would not roll (${short(e, 100)})`); }"), 2);
  // A HOUSE CAMERA: one moment after another — the house kept from each to the next, the thing's first picture handed on
  const house = srv.slice(srv.indexOf('if (camera === "house") {\n      // 3+4)'), srv.indexOf("} else {\n      // 3) THE PICTURES"));
  assert.ok(house.includes("for (const i of live()) {") && !house.includes("inTurns("), "never two at once");
  assert.ok(house.includes("const m = await makeHouseTake({") && house.includes("lapse: opts.lapse === true && d.lapse, ir: opts.ir, clock: clocks[i], best: true,") && house.includes("...(d.seen && thingPic ? { thingPic } : {}),"));
  assert.ok(house.includes("house = m.house;") && house.includes("if (d.seen && !thingPic) { thingPic = m.scene; await ckpt({ ckFt: thingPic }); }") && house.includes("await ckpt({ ckFh: JSON.stringify(house) });"));
  assert.ok(house.includes("house = keptHouseOf(resume(\"ckFh\")) || (await keptHouseFor(opts.shopId));"));
  // THE PICTURES of a held camera: on the strongest picture model at 2K — the place, then the thing's payoff, then the rest
  const pics = srv.slice(srv.indexOf("// 3) THE PICTURES"), srv.indexOf("// 4) THE TAKES"));
  assert.ok(pics.includes("const prompt = footageScenePrompt(film, { still: d.take.still, seen: d.seen, who: d.take.who }, refs.length as 0 | 1 | 2);"));
  assert.equal(count(pics, 'aspect_ratio: aspect, output_format: "jpg" }, true)'), 2, "the scene and the way in, both at their best");
  assert.ok(pics.includes("if (!text(records[plan.place].ckStill)) { await drawScene(plan.place, []); continue; }"));
  assert.ok(pics.includes("if (plan.thing !== null && plan.thing !== plan.place && !text(records[plan.thing].ckStill)) { await drawScene(plan.thing, [placePic]); continue; }"));
  assert.ok(pics.includes("(direction[i] as DirectedMoment).seen && thingPic ? [placePic, thingPic] : [placePic]"));
  assert.ok(pics.includes("prompt: footageOpensPrompt(film, d.take), image_input: [imageRef(base, text(records[i].ckStill) as string)]") && pics.includes('let opens = "-";'));
});

test("NEVER PAID FOR TWICE: the outline and the direction are kept as ckFo, every moment keeps its own record (ckFm0 …), written one at a time — and a resumed film takes what it has", () => {
  const srv = read("app", "lib", "footage-film.server.ts");
  // one write at a time: three moments checkpoint at once, and a lost checkpoint is a roll paid for again
  assert.ok(srv.includes("writing = writing.then(async () => { if (opts.jobId) await checkpointJob(opts.jobId, patch); }).catch(() => undefined);"));
  // THE OUTLINE AND THE DIRECTION: kept the moment each exists — with the day and the seed its clocks are picked by
  assert.ok(srv.includes("await ckpt({ ckFo: JSON.stringify({ v: 1, outline, today, seed }) });") && srv.includes("await ckpt({ ckFo: JSON.stringify({ v: 1, outline, today, seed, direction }) });"));
  assert.ok(srv.includes('const kept = readJson(resume("ckFo"));') && srv.includes("let outline = approved || cleanFootageOutline(kept?.outline);"));
  assert.ok(srv.includes("let direction: FootageDirection = Array.isArray(kept?.direction) && kept.direction.length === outline.moments.length ? (kept.direction as FootageDirection) : [];") && srv.includes("if (!direction.length) {"));
  // EVERY MOMENT'S OWN RECORD: one JSON text each, read back on a resume
  assert.ok(srv.includes("const records: MomentRecord[] = film.moments.map((_, i) => (readJson(resume(`ckFm${i}`)) as MomentRecord | null) || {});"));
  assert.ok(srv.includes("Object.assign(records[i], own);\n    return ckpt({ [`ckFm${i}`]: JSON.stringify(records[i]) });"));
  // …every step one take checkpoints lands in it (the roll the moment it is on the disk: take.server.ts → ckRaw — and
  // the host it came from, so a moment resumed after its roll still says where it was rolled)
  assert.equal(count(srv, "}, (patch) => save(i, patch));"), 2);
  const take = read("app", "lib", "take.server.ts"), houseTake = read("app", "lib", "house-take.server.ts");
  assert.ok(take.includes("await ckpt({ ckRaw: rawName });\n    await ckpt({ ckHost: host });") && take.includes('let host = (rawName && resume.ckHost) || "";'));
  assert.ok(houseTake.includes("await ckpt({ ckRaw: rawName, ckHost: host });") && houseTake.includes('let host = (rawName && resume.ckHost) || "";'));
  assert.ok(srv.includes("const rolled = (i: number, counted: number) => counted || 1 + (Number(records[i].rerolls) || 0);"));
  // A ROLL IN THE AIR IS PAID FOR ALREADY — three of a film's are, for minutes at a time. So the asking is kept
  // (ckRoll: host | model | id) the moment it is made, and a job that stopped with a roll in the air WAITS for it
  // instead of asking again; one that cannot be had is rolled afresh
  assert.ok(take.includes("const asked = async (host: string, model: string, id: string): Promise<string> => { try { await o.onSubmit?.(`${host}|${model}|${id}`); } catch { /* the roll is what matters */ } return id; };"));
  assert.ok(take.includes('try { return { url: host.startsWith("fal") ? await falVideoPoll(model, id, TAKE_POLL_MS) : await repPoll(id, TAKE_POLL_MS, "take"), host }; }'));
  assert.ok(take.includes("catch (e) { console.error(`[take] the roll left in the air could not be had — rolled afresh:"));
  assert.ok(take.indexOf("if (o.pending) {") > 0 && take.indexOf("if (o.pending) {") < take.indexOf("const order: Array<{ host: string; fal: boolean; go: () => Promise<string> }> = ["), "waited for before any host is asked");
  // …handed over ONCE, for the take's first roll (a roll asked for after that is a new one), and never when the roll is on the disk
  assert.ok(take.includes("let pending = left;\n  return () => { const p = pending; pending = undefined; return { ...(p ? { pending: p } : {}), onSubmit: (handle: string) => ckpt({ ckRoll: handle }) }; };"));
  assert.ok(take.includes("const flying = inTheAir(rawName ? undefined : resume.ckRoll, ckpt);") && take.includes("const rolled = await rollTake({ ...flying(), first: imageRef(base, firstFrame), scene: imageRef(base, still), direction, aspect, seconds });"));
  // A PICTURE IT HAS IS NOT DRAWN AGAIN; A MOMENT IT HAS IS NOT MADE AGAIN
  assert.ok(srv.includes("plan.rest.filter((i) => !text(records[i].ckStill))") && srv.includes("live().filter((i) => !text(records[i].ckOpens))"));
  assert.ok(srv.includes("const finished = (i: number): MadeMoment | null => { const d = records[i].done; return d && d.out && fs.existsSync(path.join(dir, d.out)) ? d : null; };"));
  assert.ok(srv.includes("if (finished(i)) continue;") && srv.includes("live().filter((i) => !finished(i))"));
  // a moment left out stays left out (and says why on the piece); the join, once made, is not made again; nor the piece
  assert.ok(srv.includes("return save(i, { left: why.slice(0, 160) });") && srv.includes("const live = (): number[] => direction.map((d, i) => (d && !records[i].left ? i : -1)).filter((i) => i >= 0);"));
  assert.ok(srv.includes('const kept = text(resume("ckFj")), joined = kept ? readJson(kept) : null;') && srv.includes("await ckpt({ ckFj: JSON.stringify(j) });"));
  assert.ok(srv.includes('const written = resume("ckFa");') && srv.includes("await ckpt({ ckFa: asset.id });"));
  // the job says it is alive while its rolls are in the air (the queue's reaper: 25 minutes untouched = abandoned)
  assert.ok(srv.includes("const alive = setInterval(() => { void ckpt({ ckFbeat: Date.now() }); }, 4 * 60_000);") && srv.includes("} finally { clearInterval(alive); }"));
  // every key starts "ck": a retry from the Archive clears them all (web.archive.tsx drops every key that does)
  for (const key of srv.match(/\bck[A-Z][A-Za-z]*/g) || []) assert.ok(/^ck(F[oamjht]|Fbeat|Take|Still|Opens|Roll|Raw|Host|Spoke|Cuts|Trim|Scare|House|Set|Scene|Cut)$/.test(key), key);
  assert.ok(read("app", "routes", "web.archive.tsx").includes('.filter(([k]) => !k.startsWith("ck"))'));
});

test("A JOB IS NEVER LOST: no outline, or fewer than two moments directed → ONE take, the way one take is always made; nothing made at all → that take; one moment made → it is the piece", () => {
  const srv = read("app", "lib", "footage-film.server.ts");
  // the page's two free calls ask the writer twice, and say why in words the page can show
  assert.equal(count(srv, "for (let attempt = 0; attempt < 2; attempt++) {"), 2);
  assert.ok(srv.includes('export const FOOTAGE_WRITER_BUSY = "The writer didn\'t answer — try again in a moment.";') && srv.includes('export const FOOTAGE_NEEDS_IDEA = "Say what happens, in a few words.";'));
  assert.equal(count(srv, "throw new Error(FOOTAGE_WRITER_BUSY);"), 2);
  assert.ok(srv.includes("const outline = cleanFootageOutline(o.outline);\n  const i = Math.floor(Number(o.index));"), "an outline the page sends for a rewrite is cleaned like any other");
  // the writers are the films' own model, held to the shapes
  assert.ok(srv.includes('const WRITER = "claude-sonnet-5";') && srv.includes("jsonSchema: footageOutlineSchema(n, o.camera === \"house\")") && srv.includes("jsonSchema: footageDirectionSchema(outline.camera)") && srv.includes('jsonSchema: footageMomentSchema(outline.camera === "house")'));
  // THE DIRECTION: the whole film asked for at once; the moments that failed are asked for ONCE more — never a third time
  assert.ok(srv.includes("const again = undirected(direction);") && srv.includes('direction = withDirected(direction, await asked(again, "the second time"));'));
  assert.equal(count(srv, "await asked("), 1);
  assert.equal(count(srv, "asked(only, \"the first time\")"), 1);
  // (a film of more than five moments is asked for in two halves, side by side — each call shown the WHOLE outline —
  //  so no one answer is long enough to run into the request's own 120-second limit; a writer that does not answer
  //  is no answer, never an error that loses the job)
  assert.equal(FOOTAGE_DIRECTED_AT_ONCE, 5);
  assert.ok(srv.includes("const parts: Array<number[] | undefined> = all.length > FOOTAGE_DIRECTED_AT_ONCE ? [all.slice(0, half), all.slice(half)] : [undefined];"));
  assert.ok(srv.includes('let direction = (await Promise.all(parts.map((only) => asked(only, "the first time")))).reduce(withDirected, all.map(() => null) as FootageDirection);'));
  assert.ok(srv.includes("catch (e) { console.error(`[footage-film] the direction's writer did not answer ${what}: ${short(e)}`); return all.map(() => null); }"));
  // …and two halves put together are the whole film's direction, each moment in its own place
  const o8 = parseFootageOutline({ ...ANSWER, moments: Array.from({ length: 8 }, (_, k) => ({ when: `NIGHT ${k + 1}`, line: `TEST moment number ${k + 1} of eight.`, seconds: 8 })) }, "phone", "9:16", 8)!;
  const first = parseFootageDirection({ moments: [1, 2, 3, 4].map((n) => hand(n, { who: `one${n}` })) }, o8, [0, 1, 2, 3]);
  const second = parseFootageDirection({ moments: [5, 6, 7, 8].map((n) => hand(n, { who: `two${n}` })) }, o8, [4, 5, 6, 7]);
  const both = [first, second].reduce(withDirected, o8.moments.map(() => null));
  assert.deepEqual(undirected(both), []);
  assert.deepEqual(both.map((m) => m && m.cam === "hand" && m.take.who), ["one1", "one2", "one3", "one4", "two5", "two6", "two7", "two8"]);
  assert.ok(footageDirectionBrief(o8, [4, 5, 6, 7]).includes("Write ONLY moments 5, 6, 7, 8 — the others are written.") && footageDirectionBrief(o8, [4, 5, 6, 7]).includes("1. NIGHT 1 — 8 seconds — TEST moment number 1 of eight."));
  // ONE TAKE INSTEAD — by the single take's own two makers, with the payload's own checkpoints; remembered, so a
  // resumed job goes straight back to its take
  assert.ok(srv.includes("catch (e) { return oneTake(`the outline could not be written (${short(e, 80)})`); }"));
  assert.ok(srv.includes('if (outline.moments.length < 2) return oneTake("the outline has one moment", outline);'));
  assert.ok(srv.includes('if (direction.filter(Boolean).length < 2) return oneTake("the direction came back with fewer than two moments", outline);'));
  assert.ok(srv.includes('if (!made.length) return oneTake("no moment of the film could be made", film);'));
  assert.ok(srv.includes("await ckpt({ ckFo: JSON.stringify({ v: 1, single: why, ...(outline ? { outline } : {}) }) });") && srv.includes('if (kept && typeof kept.single === "string") return oneTake(kept.single, cleanFootageOutline(kept.outline));'));
  const one = srv.slice(srv.indexOf("const oneTake = async"), srv.indexOf("// 1) THE OUTLINE and 2) THE DIRECTION"));
  assert.ok(one.includes("return generateHouseTake({") && one.includes("return generateTake({"));
  assert.ok(one.includes('resume: { ckTake: resume("ckTake"), ckStill: resume("ckStill"), ckOpens: resume("ckOpens"), ckRoll: resume("ckRoll"), ckRaw: resume("ckRaw"), ckHost: resume("ckHost"), ckSpoke: resume("ckSpoke"), ckCuts: resume("ckCuts"), ckTrim: resume("ckTrim") },'));
  assert.ok(one.includes('resume: { ckScare: resume("ckScare"), ckHouse: resume("ckHouse"), ckSet: resume("ckSet"), ckScene: resume("ckScene"), ckRoll: resume("ckRoll"), ckRaw: resume("ckRaw"), ckHost: resume("ckHost"), ckSpoke: resume("ckSpoke"), ckCut: resume("ckCut") },'));
  // (a card whose own words are the idea is that card exactly as it is; a film's idea as one take is its payoff)
  assert.ok(one.includes("const ready = card && (!idea || sameWords(idea, card.premise)) ? card.key : undefined;") && one.includes('const idea = String(opts.idea || "").trim() || (outline ? footageIdea(outline) : "");'));
  // nothing to film from at all is an error, never a made-up take
  assert.ok(srv.includes('throw new Error("[footage-film] nothing to film: no outline, and no idea to write one from");'));
  // ONE MOMENT LEFT is the piece as it is — never rolled again as "one take"
  assert.ok(srv.includes("let outName = made[0].m.out, seconds = film.moments[made[0].i].seconds, starts = [0], cards = false;\n  if (made.length > 1) {"));
});

test("THE JOIN AND THE PIECE: measured or the job fails; levelled where somebody speaks; one VIDEO_AD that is still a take to the Archive", () => {
  const srv = read("app", "lib", "footage-film.server.ts");
  const join = srv.slice(srv.indexOf("export async function joinFootage("), srv.indexOf("export type FootageFilmOptions"));
  // ONE SIZE — the largest take's: a 1080p roll is never shrunk — and ONE RATE: the takes' own when they agree
  assert.ok(join.includes("const big = shots.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));") && join.includes("const fps = rates.length === 1 ? footageFps(rates[0]) : 30;"));
  // a card before every moment, in the camera's mono face — the app's own when that will not draw; no card rather than no film
  assert.ok(join.includes("for (const font of [...new Set([fonts.mono, fonts.font])]) {") && join.includes('const r = await ffmpegTurn(() => run("ffmpeg", footageCardArgs({ when: s.when, w: big.w, h: big.h, fps, font, out }), 60_000));'));
  assert.ok(join.includes("if (card) pieces.push({ file: card, moment: false });\n      pieces.push({ file: s.file, moment: true });"));
  // every piece by its PICTURE (never its container); one decoding thread a piece; the app's one-encode-at-a-time runner
  assert.ok(join.includes("const frames = pieces.map((p) => Math.max(1, Math.round(pictureOf(p.file).seconds * fps)));") && join.includes("const plan = footageJoinGraph({ frames, fps, w: big.w, h: big.h, silent });"));
  assert.ok(join.includes('await runFfmpeg(["-y", ...pieces.flatMap((p) => ["-threads", "1", "-i", p.file]), "-filter_complex", plan.graph, "-map", "[vc]", "-map", "[ac]",'));
  // MEASURED — and a film that is not whole is never shipped: the job fails here
  assert.ok(join.includes("? footageJoinCheck({ ...streamSeconds(outPath), frames: plan.frames, fps })"));
  assert.ok(join.includes("if (!whole.ok) { fs.rmSync(outPath, { force: true }); throw new Error(`${label} the film could not be joined whole — ${whole.why}`); }"));
  // never the join that crops the bottom tenth of every clip (a dressed take's marks sit there)
  assert.ok(!srv.includes("assembleTestMovie"));
  // the takes' own rate control, capped (grain is incompressible)
  assert.ok(srv.includes('"-crf", "20", "-maxrate", hd ? "10M" : "7M", "-bufsize", hd ? "20M" : "14M"'));
  // THE LEVEL every film plays at — where somebody speaks; a house camera's film is the room alone
  assert.ok(srv.includes('if (camera !== "house") { try { await levelFilm(path.join(dir, j.name)); } catch { /* left as it was */ } }'));
  // THE PIECE: still a take — the Archive's footage family, its cover and its labels (archive-cover.ts, web.archive.tsx)
  assert.ok(srv.includes('type: "VIDEO_AD",') && srv.includes("title: `Found Footage — ${String(film.title || \"a film\").slice(0, 60)}`,"));
  assert.ok(srv.includes('bodyJson: JSON.stringify({ style: "TAKE", videoUrl: `/renders/${outName}`, prompt: opts.idea || film.title || "", script: lines.map((l) => l.text).join(" … ") }),'));
  assert.ok(srv.includes('kind: "take", template: "foundfootage", section: opts.section || "creator", aspect, seconds,') && srv.includes("...(opts.jobId ? { jobId: opts.jobId } : {}),"));
  assert.ok(srv.includes("v: 1, kind: film.kind, place: film.place, thing: film.thing,") && srv.includes(": { left: String(records[i].left || \"it was not made\") }),") && srv.includes("\n          cards,\n"));
  // what the one filming says, at the FILM's times; a house film carries the house as it now stands — where the next house take finds it
  assert.ok(srv.includes("const lines = made.flatMap((x, k) => (x.m.lines || []).map((l) => ({ ...l, at: at(k, l.at) })));") && srv.includes("lines: lines.length ? lines : null,"));
  assert.ok(srv.includes('...(camera === "house" && house ? { house } : {}),'));
  const { HOUSE_NEEDLE } = { HOUSE_NEEDLE: '"house":{"v":1' };
  assert.ok(read("app", "lib", "house-take.server.ts").includes(`export const HOUSE_NEEDLE = '${HOUSE_NEEDLE}';`));
});

test("ANOTHER TAKE ON THIS MOMENT: the same place, the same thing, the same step of the build — and something different", () => {
  const o = outlineOf("phone");
  const b = footageMomentBrief(o, 1, "make it the mirror, not the hallway");
  assert.ok(b.startsWith("You are rewriting ONE moment of a found-footage film's outline — recorded by a phone held in somebody's hand (a tall, vertical picture). Everything else in the outline stays as it is."));
  assert.ok(b.includes(`THE PLACE: ${PLACE}`) && b.includes(`THE THING: ${THING}`));
  assert.ok(b.includes(`2. NIGHT 2 · 3:07 AM — 9 seconds — ${o.moments[1].line}   ← THIS ONE`) && count(b, "← THIS ONE") === 1);
  assert.ok(b.includes("Write ANOTHER take on moment 2: something DIFFERENT that the camera catches at this point of the film — the same place, the same thing, the same step of the build — not a rewording of what is there. It is a MIDDLE moment: closer than the one before it, not yet the payoff"));
  assert.ok(b.includes("THE MEMBER ASKS: make it the mirror, not the hallway") && b.includes("NEVER what anybody says."));
  assert.ok(footageMomentBrief(o, 0).includes("It is the FIRST moment: ordinary, with ONE small thing wrong — far off, brief, deniable.") && !footageMomentBrief(o, 0).includes("THE MEMBER ASKS"));
  assert.ok(footageMomentBrief(o, 2).includes("It is the LAST moment: the payoff — it ends the way THE IDEA of the film ends."));
  assert.ok(footageMomentBrief(o, 99).includes("Write ANOTHER take on moment 3:"), "a moment past the end is the last");
  assert.deepEqual((footageMomentSchema(true).schema as { required: string[] }).required, ["when", "line", "seconds", "room"]);
  // the answer: a moment, cleaned — what it does not say stays as the moment was
  assert.deepEqual(parseFootageMoment({ when: "night 2 · 3:19 am", line: "She is IN the mirror, and the hallway behind the camera is empty.", seconds: 8 }, "phone", 1, o.moments[1]), { when: "NIGHT 2 · 3:19 AM", line: "She is IN the mirror, and the hallway behind the camera is empty.", seconds: 8 });
  assert.deepEqual(parseFootageMoment({ line: "She is IN the mirror now." }, "phone", 1, o.moments[1]), { when: "NIGHT 2 · 3:07 AM", line: "She is IN the mirror now.", seconds: 9 });
  assert.deepEqual(parseFootageMoment({ line: "The kitchen door swings shut.", room: "kitchen" }, "house", 0, { when: "NIGHT 1", line: "x", seconds: 10, room: "bedroom" }), { when: "NIGHT 1", line: "The kitchen door swings shut.", seconds: 10, room: "kitchen" });
  assert.equal(parseFootageMoment({ line: "" }, "phone", 1, o.moments[1]), null);
  assert.equal(parseFootageMoment("no", "phone", 1), null);
});

test("WHAT THE PAGE WILL SAY: every refusal a film can give has its words here, for the page's dictionary", () => {
  const srv = read("app", "lib", "footage-film.server.ts");
  // the two a film adds to the single take's own, and the two the writer's free calls can throw
  assert.equal(FOOTAGE_OUTLINE_UNREADABLE, "Those moments can't be read — write them again.");
  assert.equal(FOOTAGE_OUTLINE_OTHER_CAMERA, "Those moments were written for another camera — write them again.");
  assert.ok(srv.includes("throw new Error(FOOTAGE_NEEDS_IDEA);") && srv.includes("throw new Error(FOOTAGE_OUTLINE_UNREADABLE);"));
  // (the single take's own refusals are already in the dictionary — tests/found-footage.test.ts holds that)
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  assert.ok(dict.includes('"Say what happens, in a few words.":'));
});
