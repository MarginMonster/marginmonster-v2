/* FILMS UP TO FIVE MINUTES — the numbers, the parts, and the wiring that makes them true.
 *
 * The owner, 2026-11-25, of the Length step (five buttons, "≈ 10s · 2 shots" to "≈ 30s · 6 shots"): "The how long
 * can be adjusted to a sexy slider allowing up to 5 minutes with estimated final pricing for generations".
 *
 * A slider that says five minutes is a promise: this file holds the page's numbers (film-length.ts) to what the
 * two engines really make — the same clamp in both, a script written in parts, a join made in parts, a film that
 * is picked up after a restart without paying for a finished shot twice, and a job that says it is alive while it
 * works for two hours.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FILM_TOKENS_PER_SECOND, MAX_FILM_SECONDS, SHOT_SECONDS, WRITE_AT_ONCE, clampShots, clockLabel, filmPlaces, laneMinutes, lengthStops, maxShots, minShots, partBrief, planBrief, planSchema,
  renderMinutes, scriptParts, secondsFor, takePlan, tokensFor, turnPart, type FilmWay,
} from "../app/lib/film-length.ts";
import { TYPICAL_SHOT_SECONDS, clipSecondsFor, estimateSpeakSeconds } from "../app/lib/speech-meter.ts";
import { MOTION_USD_PER_SECOND, motionSeconds, storyTypicalSeconds } from "../app/lib/story-motion.ts";
import { storyThreat } from "../app/lib/acted-staging.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const WAYS: FilmWay[] = ["acted", "narrated"];

/* ---- THE NUMBERS ---- */

test("five minutes is 52 acted shots or 32 told scenes — and a slow narrator's five minutes is fewer", () => {
  assert.equal(MAX_FILM_SECONDS, 300);
  assert.deepEqual(SHOT_SECONDS, { acted: 5.8, narrated: 9.5 });
  assert.equal(maxShots("acted"), 52);
  assert.equal(maxShots("narrated"), 32);
  assert.equal(minShots("acted"), 1);
  assert.equal(minShots("narrated"), 3);
  // the fewest shots that REACH five minutes: one fewer falls short of it
  for (const way of WAYS) {
    assert.ok(maxShots(way) * SHOT_SECONDS[way] >= MAX_FILM_SECONDS, way);
    assert.ok((maxShots(way) - 1) * SHOT_SECONDS[way] < MAX_FILM_SECONDS, way);
  }
  // a narrator who takes 14 seconds a scene (the page's figure for the Hollow voice) tells five minutes in 22
  assert.equal(maxShots("narrated", 14), 22);
  assert.equal(maxShots("narrated", 10), 30);
  // …and a pace can only LOWER the ceiling: the engines' limit is the one with no pace
  assert.equal(maxShots("narrated", 5), 32);
  assert.equal(maxShots("acted", 3), 52);
  assert.equal(maxShots("acted", NaN), 52);
});

test("an acted shot is 5.8 seconds: what the meter says a written line comes to, and what this morning's films ran", () => {
  // a line as the writer is told to write it: 15-18 words, two sentences
  const lines = [
    "I told you not to come back here. Nothing in this house belongs to you anymore.",
    "You say that, but the key was under the mat. Somebody wanted me to find it.",
    "Listen to me, there is no key. We changed every lock the week she died.",
  ];
  for (const l of lines) {
    const said = estimateSpeakSeconds(l);
    // what stays in the film is the line and a breath at each end, less a few frames of dissolve
    assert.ok(Math.abs(said + 0.5 - SHOT_SECONDS.acted) <= 0.9, `${said.toFixed(2)} s said`);
    // …and what is PAID for is the take, which is longer than what stays (the price is reckoned on it)
    assert.ok(clipSecondsFor(l) >= 6 && clipSecondsFor(l) <= 8, `${clipSecondsFor(l)} s take`);
  }
  // five shots: 29 s — inside the 26 to 32 s the films of 2026-11-25 ran (the card's five-a-shot said 25)
  assert.equal(secondsFor("acted", 5), 29);
  assert.ok(secondsFor("acted", 5) >= 26 && secondsFor("acted", 5) <= 32);
  assert.ok(5 * TYPICAL_SHOT_SECONDS < 26, "the old card's figure was under every one of them");
  // five told scenes: 47.5 s and the 0.8 s tail — the 47 to 50 s they ran
  assert.equal(secondsFor("narrated", 5), 48);
});

test("a count is held to what is made: whole, between the floor and five minutes", () => {
  assert.equal(clampShots("acted", 4), 4);
  assert.equal(clampShots("acted", 4.4), 4);
  assert.equal(clampShots("acted", 999), 52);
  assert.equal(clampShots("acted", -3), 1);
  assert.equal(clampShots("narrated", 1), 3);
  assert.equal(clampShots("narrated", 40), 32);
  // nothing usable: the fallback (held too), else the floor
  assert.equal(clampShots("acted", NaN, { fallback: 4 }), 4);
  assert.equal(clampShots("acted", "", { fallback: 400 }), 52);
  assert.equal(clampShots("narrated", undefined), 3);
  assert.equal(clampShots("narrated", 0, { fallback: 6 }), 6);
  // a format's own floor (a horror film is a line and then the scare)
  assert.equal(clampShots("acted", 1, { min: 2 }), 2);
  assert.equal(clampShots("acted", NaN, { min: 2 }), 2);
  // a slow narrator's ceiling
  assert.equal(clampShots("narrated", 30, { per: 14 }), 22);
});

test("the slider's stops: increasing, from the floor, every shot up to a minute, ending exactly at five minutes", () => {
  for (const way of WAYS) {
    const stops = lengthStops(way);
    assert.equal(stops[0], minShots(way), way);
    assert.equal(stops[stops.length - 1], maxShots(way), way);
    assert.equal(clockLabel(secondsFor(way, stops[stops.length - 1])), "5:00", way);
    for (let i = 1; i < stops.length; i++) assert.ok(stops[i] > stops[i - 1], `${way}: ${stops.join(",")}`);
    // every shot while the film is under a minute…
    const short = stops.filter((n) => n * SHOT_SECONDS[way] < 60);
    assert.deepEqual(short, Array.from({ length: short.length }, (_, i) => minShots(way) + i), way);
    // …then coarser: no two stops less than about ten seconds apart past the minute, and never a gap over 45 s
    for (let i = 1; i < stops.length; i++) {
      const gap = (stops[i] - stops[i - 1]) * SHOT_SECONDS[way];
      if (stops[i - 1] * SHOT_SECONDS[way] >= 120) assert.ok(gap >= 20, `${way}: ${stops[i - 1]}→${stops[i]}`);
      assert.ok(gap <= 45, `${way}: ${stops[i - 1]}→${stops[i]} is ${gap.toFixed(0)} s`);
    }
    assert.ok(stops.length >= 12 && stops.length <= 30, `${way}: ${stops.length} stops — a slider, not a list`);
    // seconds, tokens and minutes never go down as the slider goes up
    for (let i = 1; i < stops.length; i++) {
      assert.ok(secondsFor(way, stops[i]) > secondsFor(way, stops[i - 1]) || secondsFor(way, stops[i]) === MAX_FILM_SECONDS, way);
      assert.ok(tokensFor(way, secondsFor(way, stops[i])) >= tokensFor(way, secondsFor(way, stops[i - 1])), way);
      assert.ok(renderMinutes(way, stops[i])[0] >= renderMinutes(way, stops[i - 1])[0] && renderMinutes(way, stops[i])[1] >= renderMinutes(way, stops[i - 1])[1], way);
    }
  }
  assert.deepEqual(lengthStops("acted"), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 21, 26, 31, 36, 41, 46, 52]);
  assert.deepEqual(lengthStops("narrated"), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 19, 22, 25, 28, 32]);
  // a format's own floor; a slow narrator's own five minutes
  assert.equal(lengthStops("acted", { min: 2 })[0], 2);
  const slow = lengthStops("narrated", { per: 14 });
  assert.equal(slow[0], 3);
  assert.equal(slow[slow.length - 1], 22);
  assert.equal(clockLabel(secondsFor("narrated", 22, 14)), "5:00");
});

test("a clock reads to the nearest five seconds, and a film is never said to be longer than five minutes", () => {
  assert.equal(clockLabel(20), "0:20");
  assert.equal(clockLabel(87), "1:25");
  assert.equal(clockLabel(90), "1:30");
  assert.equal(clockLabel(300), "5:00");
  assert.equal(clockLabel(0), "0:00");
  assert.equal(clockLabel(-4), "0:00");
  assert.equal(clockLabel(58), "1:00");
  assert.equal(secondsFor("acted", 52), 300);
  assert.equal(secondsFor("narrated", 32), 300);
  assert.equal(secondsFor("acted", 10), 58);
  assert.equal(secondsFor("narrated", 6), 57);
  assert.equal(secondsFor("narrated", 6, 14), 84);
  assert.equal(secondsFor("acted", 0), 0);
});

test("THE PRICE: an estimate, rounded up to a five — and at these rates every generation clears his 20%", () => {
  assert.deepEqual(FILM_TOKENS_PER_SECOND, { acted: 5, narrated: 2.5 });
  assert.equal(tokensFor("acted", 20), 100);
  assert.equal(tokensFor("acted", 29), 145);
  assert.equal(tokensFor("acted", 29.1), 150);
  assert.equal(tokensFor("acted", 300), 1500);
  assert.equal(tokensFor("narrated", 57), 145);
  assert.equal(tokensFor("narrated", 300), 750);
  assert.equal(tokensFor("acted", 0), 0);
  for (const way of WAYS) for (const s of [5, 37, 141, 299]) assert.equal(tokensFor(way, s) % 5, 0);
  // the arithmetic in film-length.ts, from the code's own figures. A Studio token is worth $0.0433.
  const TOKEN_USD = 0.0433;
  // ACTED: the take is paid by the second, at fal Kling 3 Omni pro's $0.14 — a 7 s take for 5.8 s of film
  const eng = read("app", "lib", "film-dialogue.server.ts");
  assert.ok(eng.includes("fal: \"fal · Kling 3 Omni pro ($0.14/s)\","));
  const take = clipSecondsFor("I told you not to come back here. Nothing in this house belongs to you anymore.");
  assert.equal(take, 7);
  const acted = (take * 0.14) / SHOT_SECONDS.acted + 0.011; // …and about a cent a second for pictures, looks, listens
  assert.ok(acted > 0.17 && acted < 0.19, `$${acted.toFixed(3)} a second`);
  assert.ok(FILM_TOKENS_PER_SECOND.acted * TOKEN_USD >= acted * 1.2, "acted: at least 20% over what it costs");
  // NARRATED: every scene's picture moves, asked for in whole seconds; a 2K picture a scene, one in three twice
  const told = (motionSeconds(SHOT_SECONDS.narrated) * MOTION_USD_PER_SECOND + 0.15 * 1.33 + 0.05) / SHOT_SECONDS.narrated + 0.004;
  assert.ok(told > 0.07 && told < 0.09, `$${told.toFixed(3)} a second`);
  assert.ok(FILM_TOKENS_PER_SECOND.narrated * TOKEN_USD >= told * 1.2, "told: at least 20% over what it costs");
});

test("how long it takes: acted shots one after another; a told story by the sum the page already counts down from", () => {
  // ACTED: 2.5 to 3 minutes a shot (measured 2026-11-25), a little wider at the top
  assert.deepEqual(renderMinutes("acted", 5), [15, 20]);
  assert.deepEqual(renderMinutes("acted", 52), [132, 170]);
  const eng = read("app", "lib", "film-dialogue.server.ts");
  assert.ok(eng.includes("for (let i = clips.length; i < treatment.scenes.length; i++) {"), "one shot after another: each is seeded from the last frame of the one before");
  // NARRATED: never under what the page's own measured sum says, for any length it could be before today
  for (const n of [3, 4, 6, 8, 12]) {
    for (const moves of [true, false]) {
      const [lo, hi] = renderMinutes("narrated", n, { moves });
      const s = storyTypicalSeconds(n, moves);
      assert.ok(lo >= Math.floor((s * 0.8) / 60) && hi >= Math.round((s * 1.35) / 60), `${n} scenes, moves=${moves}: ${lo}-${hi} against ${s} s`);
      assert.ok(hi > lo);
    }
  }
  assert.deepEqual(renderMinutes("narrated", 6), [4, 6]);
  assert.deepEqual(renderMinutes("narrated", 32), [14, 26]);
  assert.ok(renderMinutes("narrated", 6, { moves: false })[1] < renderMinutes("narrated", 6)[1], "still pictures are quicker");
  // the engine's own shape, which the sum counts: pictures four at a time, clips three at a time
  const told = read("app", "lib", "narrated-story.server.ts");
  assert.ok(told.includes("await Promise.all(Array.from({ length: Math.min(4, todo.length) }, () => worker()));"));
  assert.ok(read("app", "lib", "story-motion.server.ts").includes("const AT_ONCE = 3;"));
});

/* ---- A LONG SCRIPT IS WRITTEN IN PARTS ---- */

test("a script is dealt into parts: one answer up to six shots or twelve scenes, then scenes of six and parts of eight", () => {
  assert.deepEqual(WRITE_AT_ONCE, { acted: 6, narrated: 12 });
  // as it always was
  for (let n = 1; n <= 6; n++) assert.deepEqual(scriptParts("acted", n), [n]);
  for (let n = 3; n <= 12; n++) assert.deepEqual(scriptParts("narrated", n), [n]);
  // a long film: as few parts as hold it, as even as they come
  assert.deepEqual(scriptParts("acted", 7), [4, 3]);
  assert.deepEqual(scriptParts("acted", 13), [5, 4, 4]);
  assert.deepEqual(scriptParts("acted", 52), [6, 6, 6, 6, 6, 6, 6, 5, 5]);
  assert.deepEqual(scriptParts("narrated", 13), [7, 6]);
  assert.deepEqual(scriptParts("narrated", 32), [8, 8, 8, 8]);
  assert.deepEqual(scriptParts("narrated", 22), [8, 7, 7]);
  for (const way of WAYS) {
    for (let n = minShots(way); n <= maxShots(way); n++) {
      const parts = scriptParts(way, n);
      assert.equal(parts.reduce((a, b) => a + b, 0), n, `${way} ${n}`);
      assert.ok(Math.max(...parts) <= WRITE_AT_ONCE[way], `${way} ${n}: no part is more than one answer writes`);
      assert.ok(Math.max(...parts) - Math.min(...parts) <= 1, `${way} ${n}: even`);
      if (way === "acted") assert.ok(Math.min(...parts) >= Math.min(n, 3), `${n}: no scene of one or two lines`);
    }
  }
  // every stop of the slider is a script that can be dealt
  for (const way of WAYS) for (const n of lengthStops(way)) assert.ok(scriptParts(way, n).length >= 1);
});

test("an acted film comes back to its places: about half as many places as scenes, five at most, a turn in the middle", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map(filmPlaces), [1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(turnPart), [0, 0, 2, 2, 3, 5]);
});

const PLAN_ACTED = {
  title: "The Second Key",
  musicMood: "uneasy strings",
  cast: ["Odalys, a wiry night nurse in her forties with a grey braid", "Bram, a broad locksmith in his fifties in a canvas jacket"],
  places: ["a narrow hallway at night, one bulb", "A LOCKSMITH'S VAN in the rain", "an attic nobody listed"],
  parts: [
    { where: "a narrow hallway at night, one bulb", what: "Odalys shows Bram the door that will not open. He finds the lock was changed from inside. She admits she heard it turn." },
    { where: "a locksmith's van in the rain", what: "Bram wants to leave; Odalys will not let him. He finds a second key cut to his own pattern. They go back." },
    { where: "a narrow hallway at night, one bulb", what: "The door is open now. What is behind it is their answer, and it is not empty." },
  ],
};

test("the plan, checked: exactly its parts, each acted scene in one of its places, in the list's own words", () => {
  const plan = takePlan(PLAN_ACTED, { way: "acted", parts: 3 });
  assert.ok(plan);
  assert.equal(plan.parts.length, 3);
  assert.equal(plan.title, "The Second Key");
  // a place that differs only in its letters' case is the listed one (other words would be another picture)
  assert.equal(plan.parts[1].where, "A LOCKSMITH'S VAN in the rain");
  assert.equal(plan.parts[0].where, plan.parts[2].where, "the film comes back to the hallway: the same words, the same place");
  // only the places a scene is set in are kept
  assert.deepEqual(plan.places, ["a narrow hallway at night, one bulb", "A LOCKSMITH'S VAN in the rain"]);
  // a longer answer is cut to the film's parts; a shorter one is not a plan
  assert.equal(takePlan(PLAN_ACTED, { way: "acted", parts: 2 })?.parts.length, 2);
  assert.equal(takePlan(PLAN_ACTED, { way: "acted", parts: 4 }), null);
  // a place a scene names that was not listed is listed
  const stray = takePlan({ ...PLAN_ACTED, places: ["a narrow hallway at night, one bulb"] }, { way: "acted", parts: 3 });
  assert.deepEqual(stray?.places, ["a narrow hallway at night, one bulb", "a locksmith's van in the rain"]);
  // no cast, no place for a scene, nothing at all: not a plan
  assert.equal(takePlan({ ...PLAN_ACTED, cast: [] }, { way: "acted", parts: 3 }), null);
  assert.equal(takePlan({ ...PLAN_ACTED, parts: PLAN_ACTED.parts.map((p, i) => (i === 1 ? { ...p, where: "" } : p)) }, { way: "acted", parts: 3 }), null);
  assert.equal(takePlan(null, { way: "acted", parts: 3 }), null);
  assert.equal(takePlan("a plan", { way: "acted", parts: 3 }), null);
  assert.equal(takePlan({ ...PLAN_ACTED, parts: "three" }, { way: "acted", parts: 3 }), null);
  // a told story's parts have no place of their own; its places are kept as "name: look"
  const told = takePlan({ title: "t", musicMood: "m", cast: ["Wren, a girl of nine in a yellow raincoat"], places: ["the ferry: an old low black wooden river ferry with a square wheelhouse"], parts: [{ what: "Wren boards the ferry alone and finds the wheelhouse door open." }, { what: "The ferryman is not who she was told he was." }] }, { way: "narrated", parts: 2 });
  assert.deepEqual(told?.parts.map((p) => p.where), ["", ""]);
  assert.deepEqual(told?.places, ["the ferry: an old low black wooden river ferry with a square wheelhouse"]);
  // the shape it is asked for in
  const acted = planSchema("acted") as { required: string[]; properties: { parts: { items: { required: string[] } } } };
  assert.deepEqual(acted.required, ["title", "musicMood", "cast", "places", "parts"]);
  assert.deepEqual(acted.properties.parts.items.required, ["where", "what"]);
  assert.deepEqual((planSchema("narrated") as typeof acted).properties.parts.items.required, ["what"]);
});

test("what the planner is asked: its scenes counted, a turn in the middle, places it comes back to, the ending at the end", () => {
  const nine = planBrief("acted", { sizes: scriptParts("acted", 52), ending: "on what the two SEE" });
  assert.ok(nine.includes("about 5:00, in 9 SCENES"));
  assert.ok(nine.includes("5 or 6 spoken lines long"));
  assert.ok(nine.includes("the 5 PLACES this film is set in"));
  assert.ok(nine.includes("They are the IDEA's own: a film the idea sets in one house has its places IN that house"), "five places never take a story out of where its idea put it");
  assert.ok(nine.includes("\"parts\" — EXACTLY 9 entries"));
  assert.ok(nine.includes("Scene 5 is THE TURN"));
  assert.ok(nine.includes("comes BACK to a place it has been at least once") && nine.includes("two scenes in a row are never in the same place"));
  assert.ok(nine.includes("The LAST scene ends the film on what the two SEE — and nothing before it does"));
  assert.ok(nine.includes("You do not write the lines now"));
  // two scenes: a place each, and no turn to name
  const two = planBrief("acted", { sizes: scriptParts("acted", 8) });
  assert.ok(two.includes("in 2 SCENES") && two.includes("4 spoken lines long") && two.includes("the 2 PLACES"));
  assert.ok(two.includes("Each scene is in a place of its own.") && !two.includes("THE TURN"));
  assert.ok(two.includes("The LAST scene ends the film the way its kind of story ends"));
  // a told story: pictures and parts, the engine's own words for its places, the same few characters
  const told = planBrief("narrated", { sizes: scriptParts("narrated", 32), ending: "and says the lesson in one clear closing line", placesAsk: "the ONE or TWO places this story keeps coming back to" });
  assert.ok(told.includes("about 5:00 of telling, 32 pictures, in 4 PARTS"));
  assert.ok(told.includes("• \"places\" — the ONE or TWO places this story keeps coming back to"));
  assert.ok(told.includes("Part 2 is THE TURN"));
  assert.ok(told.includes("whoever matters at the end is met in part 1"));
  assert.ok(told.includes("The LAST part ends the story and says the lesson in one clear closing line"));
  // a slow narrator's five minutes is said as five minutes
  assert.ok(planBrief("narrated", { sizes: scriptParts("narrated", 22), per: 14 }).includes("about 5:00 of telling, 22 pictures"));
});

test("where a part stands: the whole plan, its own line of it, what came before — and only the last part ends the film", () => {
  const plan = takePlan(PLAN_ACTED, { way: "acted", parts: 3 })!;
  const first = partBrief("acted", { plan, index: 0, shots: 6, idea: "A locksmith is called to a door that \"locks itself\"." });
  assert.ok(first.startsWith("THIS IS SCENE 1 OF 3 of one longer film, made from this idea: \"A locksmith is called to a door that 'locks itself'.\"."));
  assert.ok(first.includes("  2. [A LOCKSMITH'S VAN in the rain] Bram wants to leave"));
  assert.ok(first.includes("Write ONLY scene 1"));
  assert.ok(first.includes("IT IS SET IN \"a narrow hallway at night, one bulb\" — every one of its shots has exactly these words as its WHERE"));
  assert.ok(!first.includes("WHAT HAS BEEN SAID"), "nothing came before the first scene");
  assert.ok(first.includes("IT DOES NOT END THE FILM") && first.includes("what scene 2 picks up") && !first.includes("IT ENDS THE FILM"));
  // the middle: handed EVERY line already written — not a summary — and still not the end
  const one = ["ODALYS: It will not open. I have tried every key she left.", "BRAM: That lock was changed from the inside. Who was in here?", "ODALYS: I heard it turn. From this side."];
  const mid = partBrief("acted", { plan, index: 1, shots: 6, said: [one] });
  assert.ok(mid.includes("WHAT HAS BEEN SAID — every line of the scenes before this one, as written. They ARE the film so far: carry on from them, contradict none of them, and say none of them again.\n  scene 1:\n    ODALYS: It will not open. I have tried every key she left.\n    BRAM: That lock was changed from the inside. Who was in here?\n    ODALYS: I heard it turn. From this side.\nThis scene begins AFTER the last of that.\n"));
  assert.ok(mid.includes("IT DOES NOT END THE FILM") && mid.includes("what scene 3 picks up"));
  // the last: it ends the film — and it is back in the hallway, told what that place's picture was drawn from
  const two = ["BRAM: I am not going back in.", "ODALYS: Then give me the key you cut."];
  const last = partBrief("acted", { plan, index: 2, shots: 6, said: [one, two, ["BRAM: a line of the scene being written is not said to it"]], seenAs: "Odalys holds a torch on the lock while Bram kneels at the \"stuck\" door" });
  assert.ok(last.includes("IT ENDS THE FILM") && !last.includes("IT DOES NOT END"));
  assert.ok(last.includes("  scene 1:\n    ODALYS: It will not open.") && last.includes("  scene 2:\n    BRAM: I am not going back in.\n    ODALYS: Then give me the key you cut.\nThis scene begins AFTER"));
  assert.ok(!last.includes("scene 3:\n") && !last.includes("a line of the scene being written"), "only the scenes BEFORE it");
  assert.ok(last.includes("The film has been here before: this place's picture was drawn from \"Odalys holds a torch on the lock while Bram kneels at the 'stuck' door\""));
  // a told story's part: no place of its own, the storyteller carries on
  const toldPlan = takePlan({ title: "t", musicMood: "m", cast: ["Wren, a girl of nine"], places: [], parts: [{ what: "Wren boards the ferry alone at dusk." }, { what: "The ferryman is not who she was told." }] }, { way: "narrated", parts: 2 })!;
  const part = partBrief("narrated", { plan: toldPlan, index: 0, shots: 7 });
  assert.ok(part.startsWith("THIS IS PART 1 OF 2 of one longer story. Its plan"));
  assert.ok(part.includes("  1. Wren boards the ferry alone at dusk.") && !part.includes("IT IS SET IN"));
  assert.ok(part.includes("IT DOES NOT END THE STORY") && part.includes("its last sentence leaves open what part 2 picks up"));
  const second = partBrief("narrated", { plan: toldPlan, index: 1, shots: 6, said: [["Wren had never taken the ferry alone.", "And the wheelhouse door stood open."]] });
  assert.ok(second.includes("IT ENDS THE STORY"));
  assert.ok(second.includes("WHAT HAS BEEN TOLD — the storyteller's words for the parts before this one, as written. They ARE the story so far: carry on from them, contradict none of them, and say none of them again.\n  part 1: Wren had never taken the ferry alone. And the wheelhouse door stood open.\nThis part begins AFTER the last of that.\n"));
});

/* ---- THE WIRING: what makes the numbers true ---- */

const engine = () => read("app", "lib", "film-engine.server.ts");
const acted = () => read("app", "lib", "film-dialogue.server.ts");

test("ONE LIMIT: every acted format is five minutes long through one constant, and both engines hold a film to it", () => {
  const eng = engine();
  // the per-template `maxScenes: 6` is gone from every acted format — one constant, five minutes of shots
  assert.ok(eng.includes("export const ACTED_MAX_SHOTS = maxShots(\"acted\");"));
  assert.equal(eng.split("maxScenes: ACTED_MAX_SHOTS,").length - 1, 4, "the Kids Cartoon, the Moral Story, the Horror Story and the Short Film");
  assert.ok(!/dialogue: true[^}]*maxScenes: 6,|maxScenes: 6,[^}]*dialogue: true/.test(eng), "no acted format keeps the old ceiling");
  // …and a genre added from the Short Film inherits it (film-genres.ts → genreTemplate)
  assert.ok(eng.includes("for (const g of GENRE_FILMS) FILM_TEMPLATES[g.key] = genreTemplate(FILM_TEMPLATES.testmovie, g);"));
  // the sung formats keep their own (a music video is a song's length)
  assert.ok(eng.includes("    defaultScenes: 3,\n    minScenes: 1,\n    maxScenes: 24,"), "Music Video");
  assert.ok(eng.includes("    defaultScenes: 4,\n    minScenes: 2,\n    maxScenes: 8,"), "Kids Music Video");
  // the writer's clamp — and, whatever a template says, an acted format's ceiling is the shared one
  assert.ok(eng.includes("if (t.dialogue && !t.lipSyncSinger && !t.sung) return clampShots(\"acted\", n, { min: t.minScenes, fallback: t.defaultScenes });"));
  // a told story: three scenes to five minutes' worth
  assert.ok(eng.includes("export const NARRATED_MIN_SCENES = minShots(\"narrated\");"));
  assert.ok(eng.includes("export const NARRATED_MAX_SCENES = maxShots(\"narrated\");"));
  assert.ok(eng.includes("export const clampNarrated = (n: number): number => clampShots(\"narrated\", n, { fallback: NARRATED_DEFAULT_SCENES });"));
  // THE ONE CALL for whoever asks — the page's action, both engines
  assert.ok(eng.includes("export function filmShots(template: string | undefined, narrated: boolean, n: unknown): number {"));
  assert.ok(eng.includes("return narrated && canNarrate(t.key) ? clampNarrated(Number(n)) : clampScenes(t, Number(n));"));
  // the acted engine holds a film to it (it was the template's own maxScenes: six)
  assert.ok(acted().includes("const want = filmShots(tmpl.key, false, opts.sceneCount ?? treatment.scenes.length);"));
  assert.ok(!acted().includes("Math.min(tmpl.maxScenes,"));
  // …and the told engine to clampNarrated
  assert.ok(read("app", "lib", "narrated-story.server.ts").includes("keepToldScenes(treatment.scenes, opts.approvedSceneImgs || [], clampNarrated(opts.sceneCount ?? treatment.scenes.length));"));
});

test("THE RESUME: a film picked up after a restart never pays for a finished shot again — and is the film it would have been", () => {
  const src = acted();
  // the finished shots are the checkpointed clips whose files are still there — up to the first that is gone
  assert.ok(src.includes("const had = resume.ckClips || [];\n  const firstGone = had.findIndex((p) => !p || !fs.existsSync(p));\n  const clips: string[] = firstGone < 0 ? [...had] : had.slice(0, firstGone);"));
  // the only loop that renders a take starts after them (the take is the paid call; the other call of it is the
  // editor's re-roll of one shot, renderDialogueClipTo)
  const film = src.slice(src.indexOf("export async function generateTestMovie("));
  assert.equal(film.split("await dialogueClip(").length - 1, 1);
  const loop = film.indexOf("for (let i = clips.length; i < treatment.scenes.length; i++) {");
  assert.ok(loop > 0 && film.indexOf("await dialogueClip(") > loop);
  // every finished shot is written down the moment it is finished: its clip, the frame the next grows out of, and
  // what it was — in ONE write, so that a restart never finds a clip without its record
  assert.ok(src.includes("await ckpt({ ckClips: clips, ckLastStill: prevFrameUrl, ckShots: shotsKept() });"));
  assert.ok(src.includes("await ckpt({ ckClips: clips, ckShots: shotsKept() });"), "…and a clip re-voiced in the background");
  // what each was is read back — from the job's own row, which the worker does not hand over
  assert.ok(src.includes("try { const j = JSON.parse(resume.ckShots ?? (await ownCheckpoint(jobId, \"ckShots\")) ?? \"null\"); if (Array.isArray(j)) kept = j as ShotKept[]; }"));
  assert.ok(engine().includes("export async function ownCheckpoint(jobId: string | undefined, key: string): Promise<string | undefined> {"));
  assert.ok(engine().includes("const job = await db.job.findUnique({ where: { id: jobId }, select: { payload: true } });"));
  for (const s of [
    "const shotSeeds: (string | null)[] = clips.map((_, i) => kept[i]?.seed || null);",
    "const shotPrompts: (string | null)[] = clips.map((_, i) => kept[i]?.prompt || null);",
    "const shotDurs: number[] = clips.map((_, i) => Number(kept[i]?.dur) || 0);",
    "const shotChained: boolean[] = clips.map((_, i) => !!kept[i]?.chained);",
    "for (let i = 0; i < clips.length; i++) if (kept[i]?.voice) shotVoice[i] = String(kept[i].voice);",
    // the cut INTO a finished shot as it was made — and, for a film checkpointed before this, a change of place cut straight
    "const cut = kept[i] ? kept[i].cut : transitionAt(i) === \"location\" ? \"hard\" : undefined;",
    // the faces the film first showed, cut again from its first master
    "if (clips.length && masters[locKeyAt(0)]?.url) {",
  ]) assert.ok(src.includes(s), s);
  // a re-voiced clip is never re-voiced (and paid for) again
  assert.ok(src.includes("if (!voiceId || revoiceTried.has(idx) || path.basename(clips[idx] || \"\").startsWith(\"tmv-\")) return;"));
  // the masters and the cast's looks come back from their own checkpoints, so no place is drawn twice
  assert.ok(src.includes("try { const r = resume.ckMasters ? JSON.parse(resume.ckMasters) : null; if (r && typeof r === \"object\") Object.assign(masters, r); } catch { /* ignore */ }"));
  // the record is dropped from the job's row when the film is made (its shots are on the piece)
  assert.ok(src.includes("await ckpt({ ckShots: undefined });"));
  assert.ok(src.indexOf("await ckpt({ ckShots: undefined });") > src.indexOf("const asset = await db.asset.create({"));
  // the worker hands a restarted acted film its checkpoints (the record itself is read from the row, above)
  const q = read("app", "lib", "job-queue.server.ts");
  assert.ok(q.includes("ckClips: payload.ckClips as string[] | undefined,") && q.includes("ckLastStill: payload.ckLastStill as string | undefined,") && q.includes("ckMasters: payload.ckMasters as string | undefined,"));
});

test("THE HEARTBEAT: a film that works for two hours is never taken for dead — and one that is dead still is", () => {
  // what the reaper reads: a job IN_PROGRESS whose row nobody has written for 25 minutes
  assert.ok(read("app", "worker.server.ts").includes("const STUCK_MS = 25 * 60_000;"));
  assert.ok(read("app", "worker.server.ts").includes("await reclaimOrphanJobs(STUCK_MS);"));
  assert.ok(read("app", "lib", "job-queue.server.ts").includes("where: { status: \"IN_PROGRESS\", updatedAt: { lt: cutoff } },"));
  // …and every checkpoint is a write of the row (the row's updatedAt is set by every write)
  assert.ok(/model Job \{[^}]*updatedAt\s+DateTime\s+@updatedAt/.test(read("prisma", "schema.prisma")));
  assert.ok(read("app", "lib", "ugc-ad-pipeline.server.ts").includes("data: { payload: JSON.stringify(merged) },"));
  const src = acted();
  // the acted film beats at REAL steps — never on a timer (a timer would keep a wedged job alive for ever)
  assert.ok(src.includes("const say = async (alive?: () => unknown): Promise<void> => { try { await alive?.(); } catch { /* a beat that fails is skipped */ } };"));
  assert.ok(src.includes("const alive = () => ckpt({ ckBeat: Date.now() });"));
  assert.ok(!/setInterval/.test(src));
  // before the take is waited for, at every host that gives up (each is waited for up to ten minutes), at every
  // failed try, and when the take is back
  assert.ok(src.includes("const VEO_POLL_MS = 10 * 60_000;"));
  // (…the take ending, since S12, on the picture of what it does to its place, when it does something — endImage)
  assert.ok(src.includes("await say(alive);\n    // (…ending on the picture of what it does to its place, when it does something and that picture came — S12)\n    const clipUrl = await dialogueClip(dialogueEngine, seedAbs, prompt, `testmovie-${i}`, clipSecs, aspect, undefined, alive, endImage);\n    await say(alive);"));
  const kling = src.slice(src.indexOf("async function klingDialogueClip("), src.indexOf("async function dialogueClip("));
  assert.ok(kling.includes("console.error(`[testmovie] ${step.name} failed (${stage}): ${e instanceof Error ? e.message.slice(0, 360) : e}`);\n      // (a host gave up — after as long as ten minutes: the film is still at work, and says so)\n      await say(alive);"));
  const retry = src.slice(src.indexOf("async function dialogueClip("), src.indexOf("/** Render ONE dialogue clip end-to-end"));
  assert.ok(retry.includes("await say(alive);") && retry.includes("? await klingDialogueClip(seedAbs, prompt, stage, durationSec, host, alive, endImage)"));
  // …each try at a place's picture
  assert.ok(src.includes("// (a picture came back, or did not — either way the film is at work, and says so: see `say`)\n      await say(alive);"));
  // …and the join between its parts (film-join.server.ts → joinInParts), the loudness and the captions as before
  assert.ok(src.includes("return joinWhole({ clips, outPath, prep: SCALE, seams, length: \"picture\", encode: ENCODE, label: \"[testmovie]\", beat });"));
  // …and while a script is written INSIDE the job (a film made in one press): ten answers or more for five minutes,
  // the job beating as each comes back — the plan, each part, each part's line check — and never for a short film
  const eng = engine();
  assert.ok(eng.includes("const alive = async (): Promise<void> => { if (inParts) try { await opts.beat?.(); } catch { /* skipped */ } };"));
  assert.ok(eng.includes("try { plan = takePlan(JSON.parse(raw), { way, parts: partSizes.length }); } catch { plan = null; }\n      await alive();"));
  assert.ok(eng.includes("if (came.length > got.length) got = came;\n          await alive();"));
  assert.ok(eng.includes("done[k] = await checkPart(spans[k]); await alive();"));
  const beatAt = src.indexOf("sceneCount: opts.sceneCount, beat: alive, ...(castForWriter(opts.cast).length");
  assert.ok(beatAt > 0 && src.indexOf("const alive = () => ckpt({ ckBeat: Date.now() });") < beatAt);
  assert.ok(read("app", "lib", "narrated-story.server.ts").includes("sceneCount: opts.sceneCount, beat: () => ckpt({ ckBeat: Date.now() }), contentLang: lang, mode: \"narrated\","));
});

test("THE RESUME, when a finished shot's file is gone: the next shot grows out of the last shot still there, never out of one that is made again", () => {
  const src = acted();
  // `ckLastStill` is the last frame of the last CHECKPOINTED shot; picked up before a gone one, that shot is made again
  const at = src.indexOf("let prevFrameUrl: string | undefined = resume.ckLastStill;");
  assert.ok(at > src.indexOf("const firstGone = had.findIndex((p) => !p || !fs.existsSync(p));"));
  assert.ok(src.includes("if (firstGone >= 0) prevFrameUrl = clips.length ? (await extractLastFrame(clips[clips.length - 1])) || undefined : undefined;"));
  assert.ok(src.indexOf("if (firstGone >= 0) prevFrameUrl =") > at);
});

test("A LONG ACTED FILM'S OWN THREAT, cast by its plan, is handed to each part apart from THE TWO — never as one of them", () => {
  // WHAT FRIGHTENS asks a threat the idea names for a "cast" entry of its own; the plan keeps up to five entries
  const plan = ["Odalys, a wiry night nurse in her forties with a grey braid", "Bram, a broad locksmith in his fifties in a canvas jacket", "The Knocker, a tall pale woman in a soaked nightgown with a smile far too wide"];
  assert.equal(storyThreat({ cast: plan })?.entry, plan[2]);
  assert.equal(storyThreat({ cast: [plan[2], plan[0], plan[1]] })?.entry, plan[2], "wherever it stands in the list");
  // three people, no threat among them: nothing is taken out (the text is then as it always was)
  assert.equal(storyThreat({ cast: [plan[0], plan[1], "Mara, their late mother's neighbour in her seventies"] }), null);
  const eng = engine();
  assert.ok(eng.includes("const thing = !narrated && one!.plan.cast.length > 2 ? storyThreat({ cast: one!.plan.cast }) : null;"));
  assert.ok(eng.includes("const two = thing ? one!.plan.cast.filter((e) => e !== thing.entry).join(\"; \") : chosen;"));
  assert.ok(eng.includes("`\\nTHE TWO who carry the whole film are already chosen — ${two}. Return them as \"cast\" exactly as they are here.${thing ? ` After them \"cast\" has the film's own threat, also exactly as it is here: ${thing.entry} — it is NOT one of the two, it never speaks, and it is in a VISUAL only where the rules below put it.` : \"\"} Every shot's VISUAL has these same two in it,"));
});

test("A GENRE WHOSE WORLD IS ITS OWN is never told today's real world — not in a long film's plan, nor in any of its parts", () => {
  const eng = engine();
  // the whole-film brief (film-genres.ts → ownWorld) — and the plan's and every part's, the same rule
  assert.ok(eng.includes("(storyFormat && !tmpl.childSafe && !tmpl.ownWorld ? `${REAL_WORLD}\\n` : \"\") +"));
  assert.equal(eng.split("(!tmpl.childSafe && !tmpl.ownWorld ? `${REAL_WORLD}\\n` : \"\") +").length - 1, 2, "the plan and the part");
  assert.ok(!eng.includes("(!tmpl.childSafe ? `${REAL_WORLD}\\n` : \"\") +"));
});

test("A LONG FILM HOLDS ITS LANE: the worker does not start the next film beside one that is two hours into its work", () => {
  // the ceiling after which a lane is given back (one render at a time: two at once restarted the server)
  const q = read("app", "lib", "job-queue.server.ts");
  assert.ok(q.includes("const RENDER_SLOT_MS = 70 * 60_000;"));
  // a short film's own ceiling is under it (nothing changes); a five-minute one is well over it
  assert.ok(laneMinutes("acted", 6) * 60_000 <= 70 * 60_000);
  assert.equal(laneMinutes("acted", 6), 35);
  assert.equal(laneMinutes("acted", 52), 255);
  for (let n = 1; n <= maxShots("acted"); n++) assert.ok(laneMinutes("acted", n) >= renderMinutes("acted", n)[1], `${n}`);
  // the slot is still reserved before the first await, and released only by its owner (tests/job-lanes.test.ts)…
  assert.ok(q.includes("const slot = slots[lane];\n  if (Date.now() < slot.until) return false;\n  const myToken = ++slot.token;\n  slot.until = Date.now() + RENDER_SLOT_MS;"));
  // …and the reservation that runs an acted film is lengthened to the film's own ceiling, never shortened
  assert.ok(q.includes("return await claimAndRunOneJob(lane, (ms) => { if (slot.token === myToken) slot.until = Math.max(slot.until, Date.now() + ms); });"));
  assert.ok(q.includes("if (t.dialogue && !t.sung && !t.lipSyncSinger) hold(laneMinutes(\"acted\", p.filmScenes) * 60_000);"));
  assert.ok(q.includes("if (job.type === \"GENERATE_VIDEO_AD\" && p.contentType === \"film\" && p.filmMode !== \"narrated\" && typeof p.filmScenes === \"number\") {"));
});

test("THE WRITER IN PARTS: a long film is planned, then written a part at a time — each told every line before it", () => {
  const eng = engine();
  assert.ok(eng.includes("const partSizes = storyFormat ? scriptParts(way, scenes) : [scenes];"));
  assert.ok(eng.includes("const inParts = partSizes.length > 1;"));
  // the plan, asked for twice at most; no plan → the film is not quietly made shorter: the maker is told
  assert.ok(eng.includes("jsonSchema: { name: \"film_plan\", schema: planSchema(way) },"));
  assert.ok(eng.includes("try { plan = takePlan(JSON.parse(raw), { way, parts: partSizes.length }); } catch { plan = null; }"));
  assert.ok(eng.includes("if (!plan) throw new Error(`[film] a ${scenes}-${narrated ? \"scene story\" : \"shot film\"} could not be planned in ${partSizes.length} parts`);"));
  // each part told the plan, where it stands, and EVERY line the parts before it wrote
  assert.ok(eng.includes("const ask = promptFor(n, cams, { plan: planned, index: j, said: spans.map(([a, b]) => all.slice(a, b).map((s) => s.caption || \"\").filter(Boolean)), ...(first ? { seenAs: first.visual } : {}) });"));
  assert.ok(eng.includes("type PartOf = { plan: FilmPlan; index: number; /** the lines already written, part by part */ said: string[][]; seenAs?: string };"));
  // an acted scene is in the ONE place its plan gave it — the same words every time the film is there
  assert.ok(eng.includes("all.push(...got.map((s) => (narrated ? s : { ...s, where: planned.parts[j].where })));"));
  // a film short enough for one answer is written by the brief exactly as it was
  assert.ok(eng.includes("const prompt = promptFor(scenes, camPlan, null);"));
  assert.ok(eng.includes("if (!part) return prompt;"));
  // every part's answer is the size a whole film's was: six acted shots (1,500 tokens), eight told scenes (2,400)
  assert.ok(eng.includes("maxTokens: tmpl.lipSyncSinger ? (scenes > 12 ? 4400 : 2600) : narrated ? 2400 : 1500,"));
  assert.ok(Math.max(...scriptParts("acted", maxShots("acted"))) <= 6 && Math.max(...scriptParts("narrated", maxShots("narrated"))) <= 8);
  // the lines of a long film are checked a part at a time, three parts at once
  assert.ok(eng.includes("await Promise.all(Array.from({ length: Math.min(3, spans.length) }, async () => {"));
  // and the answer says how it was planned
  assert.ok(eng.includes("acts?: Array<{ what: string; where?: string; scenes: number }>;"));
});
