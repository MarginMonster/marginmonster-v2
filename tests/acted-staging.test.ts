/* AN ACTED FILM IS STAGED, AND SOMETHING HAPPENS IN IT.
 *
 * The owner, 2026-11-24, after watching a Horror Film made on the live site ("A woman house-sitting alone at
 * night keeps hearing her own voice calling her name from the basement. She goes down to look."): 21 seconds,
 * two shots — the two side by side at a table facing the lens, then the same two shoulder to shoulder in front
 * of a wall. "Unrealistic for them to stand this close bro, and aside from them on screen there is no actual
 * things occurring, it's just them speaking".
 *
 * Both were asked for, word for word: the picture every clip is seeded from said "CHEST UP … fairly CLOSE …
 * standing CLOSE together"; the writer was told "they STAY put … a still, tense TALKING beat"; the clip was
 * told "The speakers hold their places". What those words were protecting (both faces readable for the
 * lip-sync, one picture per place) is kept by every staging.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTED_STAGINGS, CAMERA_IS_DEALT, EVENT_IDEAS, EVENT_IDEAS_SMALL, EVENT_MAX, EVENT_MAX_LAST, HEARD_AUDIO, HEARD_BEFORE_SAID, HEARD_FIRST_SECONDS,
  HEARD_NOT_DRAWN, HEARD_OPEN, HEARD_THEN, HEARD_UNSEEN, LINE_IN_EVERY_SHOT, LINE_IN_EVERY_SHOT_BUT_THE_LAST, NOBODY_SPEAKS, ONE_TAKE, REVEAL_MOVES, SEEN_AT_THE_END,
  SILENT_SHOT_SECONDS, TWO_ALWAYS,
  clipEvent, clipHearsFirst, clipMoves, clipSilent, dealStagings, eventIdeas, faceNote, happensBrief, heardIn, heardSeconds, heardTalk, isActedStaging,
  noRoomIn, revealPicture, sceneEvent, silentRules, stagedRules, stagedTwoShot, stagingClip, stagingPicture, stagingsFor, twoOnScreen, wordless,
  type ActedStaging,
} from "../app/lib/acted-staging.ts";
import { KLING_PROMPT_MAX, clipRules, fitClipPrompt } from "../app/lib/clip-prompt.ts";
import { CLIP_MAX_SECONDS, clipSecondsFor } from "../app/lib/speech-meter.ts";
import { CREATURE_REAL, WHAT_FRIGHTENS } from "../app/lib/story-picture.ts";
import { TAKE_HIDDEN, TAKE_WRONG } from "../app/lib/take.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
/** A fixed source of "chance" for a test: a simple generator, the same run every time. */
const dice = (seed: number) => { let s = (Math.imul(seed, 2654435761) ^ 0x9e3779b9) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

const KEYS = Object.keys(ACTED_STAGINGS) as ActedStaging[];
const KINDS = [{ cartoon: false, sing: false }, { cartoon: true, sing: false }, { cartoon: false, sing: true }, { cartoon: true, sing: true }];

// The film he watched, as it might be written now: a kitchen, the stairs, the foot of the stairs.
const KITCHEN = { where: "the kitchen of an old farmhouse at night, one lamp on", scene: "Ruth pulls the basement door open a hand's width while Dana grips the torch." };
const STAIRS = { where: "the basement stairs, a bare bulb swinging", scene: "Dana and Ruth come down the wooden stairs side by side, the torch beam shaking ahead of them." };
const CELLAR = { where: "the foot of the basement stairs", scene: "Dana's beam finds a pale figure in the corner with her own face; it turns its head toward Ruth." };
const DINER = { where: "a warm dim diner at night, rain on the windows", scene: "Eli slides the photograph across the table and Marcus turns it face down." };
const CAR = { where: "inside a parked car at night, streetlights sliding past the windows", scene: "Mara turns the key and the engine dies." };
const BENCH = { where: "a quiet park bench at dusk, soft golden light", scene: "Dana and Ruth watch the neighbour walk past the gate." };
const PLACES = [KITCHEN, STAIRS, CELLAR, DINER, BENCH, { where: "an empty hospital corridor at night", scene: "They walk slowly along the corridor, one light flickering behind them." }, { where: "a dusty attic at night", scene: "Ruth lifts the sheet off a tall mirror as Dana backs away from it." }];

test("each LOCATION is dealt one staging: no two neighbours alike, and only what fits its frame, its place and its scene", () => {
  for (let seed = 1; seed <= 300; seed++) {
    for (const aspect of ["9:16", "16:9", "1:1"]) {
      const roll = dice(seed * 13 + aspect.length);
      const n = 1 + Math.floor(roll() * 6);
      const film = Array.from({ length: n }, () => PLACES[Math.floor(roll() * PLACES.length)]);
      const plan = dealStagings(film, { aspect, rand: dice(seed) });
      assert.equal(plan.length, n);
      plan.forEach((k, i) => {
        assert.ok(isActedStaging(k), `${seed}/${aspect}: ${plan.join(",")}`);
        assert.ok(stagingsFor(film[i], aspect).includes(k as ActedStaging), `${k} does not fit ${film[i].where}`);
        // a staging whose distance runs ACROSS the frame needs a wide one: in a tall frame both faces would be small
        if (aspect !== "16:9") assert.ok(k !== "apart" && k !== "across", `${k} in a ${aspect} frame`);
        // NO TWO NEIGHBOURS ALIKE — unless the script itself walks through two places running, where nothing else fits
        if (i > 0 && k === plan[i - 1]) assert.deepEqual(stagingsFor(film[i], aspect), ["walk"], `${seed}/${aspect}: ${plan.join(",")}`);
      });
      // the same dice, the same deal
      assert.deepEqual(dealStagings(film, { aspect, rand: dice(seed) }), plan);
    }
  }
  // dealt, not fixed: across many films every staging turns up — and a tall frame has more than one way too
  const wide = new Set<string>(), tall = new Set<string>();
  for (let seed = 1; seed <= 80; seed++) {
    dealStagings([KITCHEN, STAIRS, DINER], { aspect: "16:9", rand: dice(seed) }).forEach((k) => wide.add(String(k)));
    dealStagings([CELLAR], { aspect: "9:16", rand: dice(seed) }).forEach((k) => tall.add(String(k)));
  }
  assert.deepEqual([...wide].sort(), [...KEYS].sort());
  assert.deepEqual([...tall].sort(), ["depth", "levels"]);
  assert.deepEqual(dealStagings([]), []);
  // one location, one staging — the commonest film there is
  assert.equal(dealStagings([KITCHEN], { aspect: "9:16", rand: dice(7) }).length, 1);
});

test("what fits where: a walk when the two of them walk, a table where there is one, a thing to handle — and no staging inside a car", () => {
  // the two of them on the move together: nothing else fits
  assert.deepEqual(stagingsFor(STAIRS, "9:16"), ["walk"]);
  for (const scene of ["They walk slowly along the corridor.", "Both run for the stairs as the bulb dies.", "The two of them head into the trees.", "Dana and Ruth slowly walk the length of the hall.", "Dana and Ruth are walking toward the gate.", "Dana and Ruth set off down the path."]) {
    assert.deepEqual(stagingsFor({ where: "a place", scene }, "16:9"), ["walk"], scene);
  }
  // ONE of them crossing a room is not a walk; nor is somebody else walking, a walk-in cupboard or the lights going out
  for (const scene of ["Ruth walks to the door and opens it while Dana watches.", "Dana and Ruth watch the neighbour walk past the gate.", "Dana opens the walk-in cupboard as Ruth holds the lamp.", "Dana and Ruth sit at the table as the lights go out.", "Dana and Ruth stand at the sink; Ruth pulls the plug.", "Dana and Ruth run their hands along the wall.", "They hurry to bolt the door."]) {
    assert.ok(!stagingsFor({ where: "a place", scene }, "16:9").includes("walk"), scene);
  }
  // a thing to handle → AT WORK may be dealt; nothing to handle → it is not (the picture would invent busywork)
  assert.ok(stagingsFor(KITCHEN, "9:16").includes("doing"));
  assert.ok(!stagingsFor(CELLAR, "9:16").includes("doing"));
  assert.ok(!stagingsFor({ where: "a hallway", scene: "Dana holds her breath as the light goes out." }, "9:16").includes("doing"), "a held breath and a light are not things in a hand");
  // a table to sit at, and a wide frame to see across it
  assert.ok(stagingsFor(DINER, "16:9").includes("across"));
  assert.ok(!stagingsFor(DINER, "9:16").includes("across"));
  assert.ok(!stagingsFor(KITCHEN, "16:9").includes("across"), "no table is added to a place that has none");
  // NEAR AND FAR and TWO LEVELS fit anywhere: every location has at least two ways, so neighbours can differ
  for (const aspect of ["9:16", "16:9", "1:1", undefined]) assert.ok(["depth", "levels"].every((k) => stagingsFor({ where: "somewhere", scene: "Nothing in particular." }, aspect).includes(k as ActedStaging)));
  // a place that seats two side by side and nowhere else is drawn as it always was
  assert.equal(noRoomIn(CAR.where, CAR.scene), true);
  for (const where of ["in the back seat of a taxi", "inside the cab of an old pickup truck", "in a small tent on the ridge", "the front seats of a van"]) assert.equal(noRoomIn(where), true, where);
  for (const where of ["a quiet street, a car idling at the kerb", "in a dark alley behind a car", "in a car park at night", "in the lift lobby of an office block", "a quiet park bench at dusk"]) assert.equal(noRoomIn(where), false, where);
  assert.deepEqual(dealStagings([CAR, KITCHEN, CAR], { aspect: "9:16", rand: dice(2) }).map((k) => k === null), [true, false, true]);
});

test("a location that already has its picture keeps what that picture was drawn as", () => {
  // a film picked up after a restart: the kitchen's master exists (drawn NEAR AND FAR), the cellar's does not
  for (let seed = 1; seed <= 60; seed++) {
    const plan = dealStagings([{ ...KITCHEN, has: "depth" }, CELLAR], { aspect: "9:16", rand: dice(seed) });
    assert.deepEqual(plan, ["depth", "levels"], "kept — and its neighbour is dealt something else");
    // …and a place dealt BEFORE a kept one differs from it too
    assert.equal(dealStagings([CELLAR, { ...KITCHEN, has: "levels" }], { aspect: "9:16", rand: dice(seed) })[0], "depth");
  }
  // a master drawn before there were stagings (or one that fell back) has none: it is played as it always was
  assert.deepEqual(dealStagings([{ ...KITCHEN, has: null }], { aspect: "9:16" }), [null]);
  assert.deepEqual(dealStagings([{ ...KITCHEN, has: "sideways" as unknown as ActedStaging }], { aspect: "9:16" }), [null]);
});

test("the picture: the staging's words, both faces still readable, nobody shoulder to shoulder", () => {
  for (const k of KEYS) {
    const words = stagingPicture(k);
    assert.ok(words.startsWith("STAGING — "), k);
    assert.ok(words.includes("A MEDIUM shot"), `${k}: a medium shot with the place around them`);
    // what the lip-sync needs, said in every one of them
    assert.ok(words.includes("BOTH faces are LARGE, sharp and clearly visible, each open to the camera with both eyes and the whole mouth in view"), k);
    assert.ok(words.includes("never a flat side profile, never the back of a head, never a small far-off figure"), k);
    assert.ok(words.endsWith("Nobody is posed for the camera and nobody looks into the lens: each looks at the other, or at what they are doing."), k);
    // the sentences he was looking at are in none of them
    for (const old of ["CHEST UP", "fairly CLOSE", "CLOSE together", "three-quarters toward the camera so the camera sees"]) assert.ok(!words.includes(old), `${k}: ${old}`);
    // …and none of them asks for what the lip-sync cannot use: a back, an over-the-shoulder view, a face behind glass
    assert.ok(!/seen from behind|over[- ]the[- ]shoulder|through (?:a|the) (?:window|glass)|silhouette/i.test(words), k);
    assert.ok(ACTED_STAGINGS[k].fits.length > 20 && stagingClip(k).length > 40 && stagingClip(k).length <= 110, `${k}: where it fits, and a line for the clip short enough for its prompt`);
  }
  // his words, each a staging: distance, turned to each other, not lined up
  assert.ok(ACTED_STAGINGS.apart.picture.includes("at least an arm's length of clear space between them"));
  assert.ok(ACTED_STAGINGS.apart.picture.includes("turned toward EACH OTHER in a shallow V that is open to the camera"));
  for (const k of ["apart", "depth", "levels", "doing"] as const) assert.ok(ACTED_STAGINGS[k].picture.includes("never shoulder to shoulder, never lined up facing us"), k);
  // depth is not an over-the-shoulder shot: nobody is a blurred foreground head, and the far face is not far
  assert.ok(ACTED_STAGINGS.depth.picture.includes("two or three steps farther back — no more"));
  assert.ok(ACTED_STAGINGS.depth.picture.includes("The nearer one is NOT a blurred foreground shape: both are in the same sharp focus."));
  // a table is between them only where the place has one — and nothing taller than its top
  assert.ok(ACTED_STAGINGS.across.picture.includes("a table that belongs in this place") && ACTED_STAGINGS.across.picture.includes("Nothing taller than the table top stands between them."));
  assert.ok(ACTED_STAGINGS.walk.picture.includes("coming TOWARD the camera") && ACTED_STAGINGS.walk.picture.includes("with clear space between their shoulders"));
  assert.ok(ACTED_STAGINGS.doing.picture.includes("never behind them, so that nobody has to turn their back to use it"));
  assert.equal(stagingPicture("sideways"), "");
  assert.equal(stagingPicture(null), "");
  assert.equal(stagingClip(undefined), "");
});

test("the master's whole prompt in a staging: the scene's moment IN the picture, the cast bound exactly as before", () => {
  const who = " WHO IS WHO: reference image 1 is Dana and ONLY Dana. A person with a reference photo must be recognisably that same person.";
  const room = " The FIRST reference image shows ONLY the room: copy its exact setting.";
  const keep = "Keep the two people clearly distinct and do NOT blend or swap their faces, hair or clothing.";
  const mood = "Every living person in it looks tense, wary or afraid — nobody smiles, grins or laughs.";
  const parts = { setting: "the kitchen of an old farmhouse at night", personA: "Dana — EXACTLY the person in reference image 1", personB: "Ruth, a stout neighbour in her sixties with cropped white hair", act: `${KITCHEN.scene}`, mood, consistency: keep, roomNote: room, faceNote: who, comp: "vertical composition" };
  for (const k of KEYS) {
    const p = stagedTwoShot({ staging: k, ...parts });
    assert.ok(p.startsWith("A single photorealistic frame from a live-action film: BOTH people together in the kitchen of an old farmhouse at night, in the middle of a scene. STAGING — "), k);
    assert.ok(p.includes(stagingPicture(k)), k);
    // who is who, the room, the mood and the keep-them-distinct note are the caller's own text, untouched
    assert.ok(p.includes("Dana — EXACTLY the person in reference image 1 on one side and Ruth, a stout neighbour in her sixties with cropped white hair on the other, both faces prominent and in focus"), k);
    assert.ok(p.includes(`${keep} Hands are empty unless the moment puts something in them`) && p.includes(`${room}${who} Cinematic filmic lighting, both of them in sharp focus, vertical composition, no on-screen text, no watermark.`), k);
    assert.ok(p.includes(` ${mood} `), k);
    // the rules the lip-sync depends on are all still said
    assert.ok(p.includes("This is NOT an over-the-shoulder shot: neither person is turned fully away, cropped out, or blurred in the foreground; both are equally sharp."), k);
    assert.ok(p.includes("NOT separated by any window, glass pane, partition, railing, counter, doorway or divider BETWEEN them"), k);
    assert.ok(p.includes("each in their own half of the frame, never one directly in front of the other"), "the side each one is on is read off this picture");
    // THE MOMENT is in the picture — it is no longer told that the framing wins
    assert.ok(p.includes(" THE MOMENT this frame is taken at: Ruth pulls the basement door open a hand's width while Dana grips the torch — everything it names (what somebody holds, what is being done, what is in the place) is IN the picture, seen the way the moment says it is seen, and well above the picture's bottom edge."), k);
    assert.ok(p.includes("Where the moment says how somebody is placed (standing, sitting, crouching, walking), the moment decides; the distance between the two, the camera and their faces stay as described above."), k);
    assert.ok(p.includes("Draw the instant it BEGINS, before it is done, so that it can happen in the seconds that follow: ONE picture of ONE instant — never a split screen, panels or a before-and-after."), k);
    assert.ok(!p.includes("the framing wins") && !p.includes("CHEST UP") && !p.includes("standing CLOSE together") && !p.includes("shallow depth of field"), k);
  }
  // a cartoon stays a cartoon; no scene words → no moment; not a staging → nothing (the caller draws it as before)
  const toon = stagedTwoShot({ staging: "levels", cartoon: true, ...parts, act: "" });
  assert.ok(toon.startsWith("A single frame from a bright, glossy 3D-animated CARTOON film (modern wholesome preschool-cartoon look") && toon.endsWith("Clean cheerful cartoon lighting, soft candy colors, rounded friendly shapes, vertical composition, no on-screen text, no watermark."));
  assert.ok(!toon.includes("THE MOMENT"));
  assert.equal(stagedTwoShot({ staging: "sideways", ...parts }), "");
  assert.equal(stagedTwoShot({ staging: null, ...parts }), "");

  // …and in the function that draws it: the old prompt is still there LETTER FOR LETTER (a film with no staging
  // is drawn from it), and the staged one takes its place only when there is a staging
  const img = read("app", "lib", "image-generation.server.ts");
  const classic = img.split("\n").find((l) => l.startsWith("    const prompt = `${styleLead} of BOTH people together in ${setting}")) || "";
  assert.equal(crypto.createHash("sha256").update(classic, "utf8").digest("hex"), "e8bb6ae6d7bcac2b9832b103383a6bad3754a8571fa7cc0d306df40bc6dbc062", "the two-shot's own prompt is not to change with this");
  assert.ok(img.includes("const staged = opts.staging ? stagedTwoShot({ staging: opts.staging, cartoon, setting, personA, personB, act: (opts.action || \"\").replace(/\\s+/g, \" \").trim().slice(0, 320), mood, consistency: consistencyNote, roomNote, faceNote, comp }) : \"\";"));
  assert.ok(img.includes("const input: Record<string, unknown> = { prompt: staged || prompt, aspect_ratio: ar, output_format: \"jpg\" };"));
  assert.ok(img.includes("staging?: string | null; setting: string; style?: \"photoreal\" | \"cartoon\"; aspect?: \"9:16\" | \"16:9\" | \"1:1\" }): Promise<string | null> {"), "optional: nobody has to pass one");
});

test("the clip in a staging: how the two move in it, and the ONE thing that happens — in every size of the note", () => {
  const event = "Ruth pulls the basement door open a hand's width while Dana grips the torch.";
  for (const kind of KINDS) {
    const base = clipRules(kind);
    for (const k of KEYS) {
      const r = stagedRules(base, { staging: k, event: KITCHEN.scene });
      for (const note of [r.look, r.lookTight, r.lookShort]) {
        // nobody is told to hold still any more…
        assert.ok(!note.includes("hold their places") && !/[Nn]obody moves except/.test(note), `${JSON.stringify(kind)} ${k}`);
        // …they are told how to move in this staging, and what happens, in the scene's own words
        assert.ok(note.includes(stagingClip(k)), `${k}: the staging's words`);
        assert.ok(note.includes(`As the line is spoken, this happens once: ${event}`), `${k}: the event`);
        // …each on their own side of the frame: that is how a line finds its mouth, shot after shot
        assert.ok(/on their own sides?\b|on their own sides of the table|each on their own side/.test(note), `${k}: ${stagingClip(k)}`);
      }
      // who everybody is, and that nobody changes, is the note's own beginning — kept word for word. (Only where
      // the camera travels, what is behind them is not held "identical … throughout": told that, two people walk
      // on the spot. It is the PLACE that stays the same.)
      const lock = base.look.slice(0, base.look.search(/The speakers hold their places|Nobody moves except/)).trim();
      assert.ok(r.look.startsWith(k === "walk" ? lock.replace(/\bbackground\b/g, "place") : lock), `${JSON.stringify(kind)} ${k}`);
      if (k === "walk") for (const note of [r.look, r.lookTight, r.lookShort]) assert.ok(!/\bbackground\b/.test(note.replace("The background stays gently alive.", "")), `${JSON.stringify(kind)}: ${note}`);
      assert.ok(r.lookTight.startsWith("Keep EVERYONE and the setting EXACTLY as in the starting image") && r.lookShort.startsWith("Keep everyone and the setting EXACTLY as in the starting image"));
      assert.ok(r.look.endsWith("Nothing else new enters and no new object appears; anything held keeps its exact size and shape."), "the event is the ONLY new thing");
      assert.ok(r.lookTight.endsWith("Nothing else new enters; held things keep their size and shape."));
      assert.ok(r.look.length > r.lookTight.length && r.lookTight.length > r.lookShort.length, "three sizes, as before");
      // the style and no-text rules are untouched; the camera stays locked — except on a walk, where it goes with them
      assert.equal(r.style, base.style);
      assert.equal(r.noText, base.noText);
      if (k === "walk") {
        assert.ok(r.steady.startsWith("The camera travels smoothly backward ahead of them at their pace, level — no rotation, tilt, flip or zoom."), JSON.stringify(kind));
        assert.equal(r.steady.slice(r.steady.indexOf(" — no rotation")), base.steady.slice(base.steady.indexOf(" — no rotation")), "the sound rule is the same");
      } else assert.equal(r.steady, base.steady);
    }
    // not a staging → the rules exactly as they came
    assert.equal(stagedRules(base, { staging: null, event }), base);
    assert.equal(stagedRules(base, { staging: "sideways", event }), base);
  }
  const live = clipRules({ cartoon: false, sing: false });
  const full = stagedRules(live, { staging: "depth", event }).look;
  assert.ok(full.includes("every beard, mustache and bit of stubble stays exactly as it is, never fading, growing, appearing or vanishing. Do NOT morph, age or redraw anyone."), "the facial-hair lock");
  assert.ok(full.includes("The background stays gently alive."), "a live-action background still moves");
  assert.ok(!stagedRules(clipRules({ cartoon: true, sing: false }), { staging: "depth", event }).look.includes("background stays"), "a cartoon keeps the still background it was approved with");

  // a film written before its shots happened (no event): the staging's movement, and nothing else is named
  const quiet = stagedRules(live, { staging: "apart" });
  assert.ok(quiet.lookTight.endsWith("Both stay in frame on their own sides, faces in view, turned toward each other at the distance they have. Only natural talking, small gestures and shifts of weight. Nothing new enters; held things keep their size and shape."));
  assert.ok(!quiet.look.includes("this happens once"));
  // NOTHING IS NAMED THAT THE SCENE DOES NOT HAVE (a clip prompt that names a thing can add it — story-motion.ts):
  // apart from a table where the place has one, our own words name no object, light, weather or creature
  for (const k of KEYS) {
    const ours = `${stagingClip(k)} ${ACTED_STAGINGS[k].camera || ""}`;
    assert.ok(!/\b(?:door|lamp|light|fire|flame|smoke|rain|window|stairs?|box|chair|bag|key|creature|figure|shadow|hand|floor)\b/i.test(ours), `${k}: ${ours}`);
    assert.equal(/\btable\b/i.test(ours), k === "across", k);
  }
});

test("who is on which side is said only for somebody the event names", () => {
  const live = clipRules({ cartoon: false, sing: false });
  const told = stagedRules(live, { staging: "doing", event: "Ruth pulls the basement door open while Dana grips the torch.", others: [{ name: "RUTH", side: "right" }] });
  assert.ok(told.lookTight.includes("Ruth is on the right. As the line is spoken, this happens once: Ruth pulls the basement door open"), "by the name as the scene writes it");
  const untold = stagedRules(live, { staging: "doing", event: "Dana lifts the lid off the crate.", others: [{ name: "RUTH", side: "right" }] });
  assert.ok(!untold.look.includes(" is on the "));
  // "Ruthie" is not Ruth; no side, no name, no event → nothing
  assert.ok(!stagedRules(live, { staging: "doing", event: "Ruthie lifts the lid.", others: [{ name: "Ruth", side: "left" }] }).look.includes(" is on the "));
  assert.ok(!stagedRules(live, { staging: "doing", event: "Ruth lifts the lid.", others: [{ name: "Ruth", side: "" }, { name: "", side: "left" }] }).look.includes(" is on the "));
  assert.ok(!stagedRules(live, { staging: "doing", others: [{ name: "Ruth", side: "left" }] }).look.includes(" is on the "));
});

test("a scene's words as the engine is told them: nothing quoted, cut at a sentence, a clause or a word", () => {
  assert.equal(clipEvent("  Ruth pulls   the door open.  "), "Ruth pulls the door open.");
  // the engine SPEAKS what is in double quotes — a scene's words never carry any into the prompt
  assert.equal(clipEvent('Ruth says "who is there" and pulls the door open'), "Ruth says who is there and pulls the door open.");
  assert.equal(clipEvent("Dana’s torch finds it — “there” — in the corner!"), "Dana’s torch finds it — there — in the corner.");
  assert.equal(clipEvent(""), "");
  assert.equal(clipEvent(null), "");
  // longer than a shot's sentence: the first sentence, when that is most of it…
  const two = "Dana and Ruth come down the wooden basement stairs side by side with the torch beam shaking ahead of them over the concrete. The door at the top of the stairs swings slowly shut behind them and the bulb goes dark.";
  assert.equal(clipEvent(two), "Dana and Ruth come down the wooden basement stairs side by side with the torch beam shaking ahead of them over the concrete.");
  // …else a whole clause, never ending on "and" or "the"
  const long = "Dana and Ruth come down the wooden basement stairs side by side with the torch beam shaking ahead of them over the concrete floor and the stacked boxes and the old furnace while the bulb above them swings";
  const cut = clipEvent(long);
  assert.ok(cut.length <= EVENT_MAX + 1 && long.startsWith(cut.slice(0, -1)), cut);
  assert.ok(!/\b(?:and|the|of|while|with|a)\.$/.test(cut), cut);
  for (let n = 20; n <= 400; n += 7) assert.ok(clipEvent("word ".repeat(n)).length <= EVENT_MAX + 1);
});

test("which scenes' words are something happening: not the place's own name, and not the same thing twice", () => {
  const where = ["the kitchen at night", "the kitchen at night", "the kitchen at night", "A new location", "the kitchen at night"];
  const place = ["kitchen", "kitchen", "kitchen", "new", "kitchen"];
  const visuals = [
    "Ruth pulls the basement door open while Dana grips the torch.",
    // a beat the maker added by hand in the storyboard starts as a copy of its place's first scene
    "Ruth pulls the basement door open while Dana grips the torch.",
    "Dana lifts the lamp from the table as Ruth backs away.",
    // …and a scene they added starts as its place's name
    "A new location",
    "ruth pulls the basement door open while Dana grips the torch",
  ];
  assert.equal(sceneEvent(visuals, place, where, 0), visuals[0]);
  assert.equal(sceneEvent(visuals, place, where, 1), "", "a door is not pulled open twice");
  assert.equal(sceneEvent(visuals, place, where, 2), visuals[2]);
  assert.equal(sceneEvent(visuals, place, where, 3), "", "a place's name is not an event");
  assert.equal(sceneEvent(visuals, place, where, 4), "", "the same words, whatever the capitals or the full stop");
  // the same words in ANOTHER place are that place's own event
  assert.equal(sceneEvent(["They walk in.", "They walk in."], ["hall", "stairs"], ["a hall", "the stairs"], 1), "They walk in.");
  // a script that names no place at all: its first scene's words are still what happens in it
  assert.equal(sceneEvent(["Ruth pulls the door open."], ["k"], [""], 0), "Ruth pulls the door open.");
  assert.equal(sceneEvent(["", null, undefined], ["a", "a", "a"], ["x", "x", "x"], 1), "");
  assert.equal(sceneEvent([], [], [], 3), "");
});

test("the staged prompt still fits what the video engine reads, and never loses the event before the rest", () => {
  /** A stand-in for the talking directions: whole sentences, exactly `n` characters (as tests/clip-prompt.test.ts). */
  const talk = (n: number): string => { let s = ""; while (s.length < n) s += "Only one person speaks and says the line exactly once. "; return s.slice(0, n - 1).trimEnd().padEnd(n - 1, "x") + "."; };
  const TIMBRE = " Madalynn's voice is warm, upbeat and easy to trust (a friendly female voice); keep this exact voice in every shot.";
  const event = "Ruth pulls the basement door open a hand's width while Dana grips the torch.";
  for (const kind of KINDS) {
    for (const k of KEYS) {
      const rules = stagedRules(clipRules(kind), { staging: k, event, others: [{ name: "Ruth", side: "right" }] });
      // a typical shot (the sizes production really sent: about 1,460 characters of talking directions and a voice
      // timbre) keeps the identity lock, the staging and the event — it gives up, at most, the note's extra wording
      const typical = fitClipPrompt({ voice: talk(1460), voiceDesc: TIMBRE, ...rules });
      assert.ok(typical.prompt.length <= KLING_PROMPT_MAX, `${JSON.stringify(kind)} ${k}: ${typical.prompt.length}`);
      assert.ok(typical.gaveUp === "" || typical.gaveUp === "the look-note's extra wording", `${JSON.stringify(kind)} ${k}: gave up ${typical.gaveUp}`);
      assert.ok(typical.prompt.includes(event) && typical.prompt.includes(stagingClip(k)) && typical.prompt.includes(TIMBRE.trim()));
      assert.ok(typical.prompt.includes("Keep EVERYONE and the setting EXACTLY as in the starting image"));
      // whatever the sizes: never over the cap, never without the camera / sound / no-text rules — and while any
      // look-note is in it at all, the event is
      for (let n = 60; n <= 4200; n += 61) {
        const r = fitClipPrompt({ voice: talk(n), voiceDesc: n % 2 ? TIMBRE : "", ...rules });
        assert.ok(r.prompt.length <= KLING_PROMPT_MAX, `talk=${n}: ${r.prompt.length}`);
        assert.ok(r.prompt.endsWith(rules.noText) && r.prompt.includes(rules.steady), `talk=${n}`);
        if (!/line too long/.test(r.gaveUp)) assert.ok(r.prompt.includes(event), `talk=${n}: ${r.gaveUp}`);
      }
    }
  }
  // THE LAST SHOT of a film may say more of its scene (a horror film's says what is seen AND what it does): the
  // event is kept whole, and the prompt still fits — by giving up more of the standing note, never the rules
  const lastScene = "Dana's torch finds a pale woman with her own face standing in the corner, her smile far too wide and crowded with thin teeth; she takes one step toward Ruth, who has not turned round.";
  assert.ok(lastScene.length > EVENT_MAX && lastScene.length <= EVENT_MAX_LAST);
  const asLast = stagedRules(clipRules({ cartoon: false, sing: false }), { staging: "depth", event: lastScene, eventMax: EVENT_MAX_LAST });
  assert.ok(asLast.lookShort.includes("she takes one step toward Ruth, who has not turned round."), "what it DOES is the end of the sentence");
  assert.ok(!stagedRules(clipRules({ cartoon: false, sing: false }), { staging: "depth", event: lastScene }).lookShort.includes("she takes one step"), "any other shot is told a shot's worth");
  const lastFit = fitClipPrompt({ voice: talk(1460), voiceDesc: TIMBRE, ...asLast });
  assert.ok(lastFit.prompt.length <= KLING_PROMPT_MAX && lastFit.prompt.includes("she takes one step toward Ruth") && lastFit.prompt.endsWith(asLast.noText) && lastFit.prompt.includes(asLast.steady), lastFit.gaveUp);
  // "was something done in this shot?" is read off the prompt it was rendered from (a shot rolled again later too)
  const live = clipRules({ cartoon: false, sing: false });
  assert.equal(clipMoves(fitClipPrompt({ voice: talk(900), voiceDesc: "", ...stagedRules(live, { staging: "depth", event }) }).prompt), true);
  assert.equal(clipMoves(fitClipPrompt({ voice: talk(900), voiceDesc: "", ...stagedRules(live, { staging: "walk" }) }).prompt), true, "a walk moves, event or not");
  assert.equal(clipMoves(fitClipPrompt({ voice: talk(900), voiceDesc: "", ...stagedRules(live, { staging: "depth" }) }).prompt), false);
  assert.equal(clipMoves(fitClipPrompt({ voice: talk(900), voiceDesc: "", ...live }).prompt), false, "every film made before this");
  assert.equal(clipMoves(null), false);
});

test("the writer: every shot is something that HAPPENS, the camera is dealt, and a horror film ends on something seen", () => {
  // the KIND of thing is shown by a few examples DEALT for the film (a fixed example comes back as the story)
  for (let seed = 1; seed <= 40; seed++) {
    const four = eventIdeas(dice(seed));
    assert.equal(four.length, 4);
    assert.equal(new Set(four).size, 4, "no two the same");
    assert.ok(four.every((e) => EVENT_IDEAS.includes(e)));
    assert.deepEqual(eventIdeas(dice(seed)), four, "the same dice, the same deal");
    assert.ok(eventIdeas(dice(seed), 4, true).every((e) => EVENT_IDEAS_SMALL.includes(e)), "a film for little ones has its own");
  }
  const dealt = new Set<string>();
  for (let seed = 1; seed <= 60; seed++) eventIdeas(dice(seed)).forEach((e) => dealt.add(e));
  assert.equal(dealt.size, EVENT_IDEAS.length, "across many films every one of them turns up");
  assert.equal(eventIdeas(dice(1), 99).length, EVENT_IDEAS.length);
  // each is big enough to see and safe to animate: no fire, nothing poured, nothing written or on a screen, no small prop
  for (const e of [...EVENT_IDEAS, ...EVENT_IDEAS_SMALL]) assert.ok(!/\b(?:fire|flames?|match|candle|cigarette|drink|glass|cup|phone|screen|letter|note|paper|book|pours?|poured|water)\b/i.test(e), e);

  const brief = happensBrief(["a door pulled open", "a light going out"]);
  assert.ok(brief.startsWith("what HAPPENS in this shot, written for the camera: ONE sentence of at most 25 words that calls BOTH characters by NAME and says the ONE physical thing that is DONE while the line is spoken"));
  assert.ok(brief.includes("(the KIND of thing meant: a door pulled open; a light going out — examples of the kind, not a list to pick from: find what THIS story needs)"));
  assert.ok(brief.includes("A shot is NEVER only two people talking: in every shot somebody does something to something, or something in the place changes"));
  // what the lip-sync needs is asked of the writer too
  assert.ok(brief.includes("both stay in the picture with their faces toward us, each on their own side of it (the film tells the two apart by their side) — nobody leaves, nobody turns their back, nobody crosses over to the other's side, nothing passes in front of a face"));
  // a walk is written the way the dealer reads one (both of them, then the going): "they walk forward yanno?"
  assert.ok(brief.includes("When what happens is the two of them going somewhere TOGETHER, write it as both of them doing it (\"NAME and NAME walk down…\", \"NAME and NAME come along…\") — that is how the film knows to travel with them."));
  for (const said of ["Dana and Ruth walk down the hall.", "Dana and Ruth come along the path."]) assert.deepEqual(stagingsFor({ where: "a place", scene: said }, "9:16"), ["walk"], said);
  // the words go to the clip as well as the picture: no looks, no camera, nothing written, no flavour props
  assert.ok(brief.includes("Call them by NAME only (their looks are in \"cast\" — never repeat them here) and use no camera words."));
  assert.ok(brief.includes("never a cigarette, a drink or a phone added for flavour") && brief.includes("NO readable text, documents, papers, boards, signage or screens"));
  assert.ok(!happensBrief().includes("the KIND of thing meant"));
  assert.ok(ONE_TAKE.startsWith("ONE PLACE, ONE TAKE — the picture of a place is drawn ONCE, from the VISUAL of the FIRST shot set there"));
  assert.ok(ONE_TAKE.includes("a later shot there uses only what that first VISUAL already put in view") && ONE_TAKE.includes("whatever a shot changes stays changed"));
  assert.ok(ONE_TAKE.endsWith("For the same reason the film never comes BACK to a place it has left."), "a place's picture is the place BEFORE anything was done in it");
  assert.ok(CAMERA_IS_DEALT.startsWith("THE CAMERA IS NOT YOURS — ") && CAMERA_IS_DEALT.includes("is dealt by the film itself: one staging for each location, and no two locations alike"));
  assert.ok(CAMERA_IS_DEALT.includes("Never write the two side by side or shoulder to shoulder: people in a film keep a natural distance"));
  // the pipeline shows exactly two: somebody who is ALONE in the idea gets a second who belongs there
  assert.ok(TWO_ALWAYS.includes("If the idea has somebody ALONE, the second one must BELONG there, and the first lines make it plain why they are there"));
  assert.ok(TWO_ALWAYS.includes("the voice turns out to be somebody") && TWO_ALWAYS.includes("Never a stranger who is simply in the room."));
  // a horror film's last shot: the thing is IN the picture, in the SAME place as the shot before — and what
  // frightens is said ONCE (its own tests are below: "the last shot of a horror film")
  assert.ok(SEEN_AT_THE_END.startsWith("THE LAST SHOT IS SEEN, NOT SAID — a horror film ends on something the viewer SEES, not on a line about it."));
  assert.ok(SEEN_AT_THE_END.includes("seen the way WHAT FRIGHTENS (below) says such a thing is seen") && SEEN_AT_THE_END.includes("what HAPPENS in that shot is IT"));
  assert.ok(!SEEN_AT_THE_END.includes("a WHERE of its own"), "it is no longer given a place of its own");
  assert.ok(WHAT_FRIGHTENS.includes("NEARLY human and slightly wrong") && !SEEN_AT_THE_END.includes("NEARLY human") && !SEEN_AT_THE_END.includes("Never horns"), "not a second copy of it");

  const engine = read("app", "lib", "film-engine.server.ts");
  // an ACTED film only (a told story and a song keep their own briefs), with its examples dealt for a little one when it is for them
  assert.ok(engine.includes("const acted = !!tmpl.dialogue && !narrated;"));
  assert.ok(engine.includes("const actIdeas = acted ? eventIdeas(Math.random, 4, !!tmpl.childSafe) : [];"));
  assert.ok(engine.includes("Return EXACTLY ${scenes} consecutive SHOTS. Each shot has FOUR fields:\\n` +\n      `• VISUAL — ${happensBrief(actIdeas)}\\n` +"));
  // what he was watching is no longer asked for
  for (const old of ["they STAY put", "a still, tense TALKING beat", "• SHOT —", "FIVE fields", "Every shot's VISUAL features these same two, described the same way."]) assert.ok(!engine.split("\n").some((l) => !l.trim().startsWith("//") && l.includes(old)), old);
  // (the two's looks are said once, in "cast": a VISUAL is said to the video engine, and looks said there redraw a face)
  assert.ok(engine.includes("Every shot's VISUAL has these same two in it, called by these exact names — their looks are said HERE, once, and never repeated in a VISUAL.${noSlop}`"));
  assert.ok(engine.includes("`${CAMERA_IS_DEALT}\\n` +\n      `${ONE_TAKE}\\n` +\n      `${TWO_ALWAYS}\\n` +"));
  // a horror film only — and before WHAT FRIGHTENS, which it points down to
  const seen = engine.indexOf("(tmpl.key === \"horror\" ? `${SEEN_AT_THE_END}\\n` : \"\")");
  const frightens = engine.indexOf("(tmpl.key === \"horror\" ? `${WHAT_FRIGHTENS}\\n` : \"\") +");
  assert.ok(seen > 0 && frightens > seen);
  // the writer does not choose the camera: whatever it put in "shot" is not kept, so a place stays one take
  assert.ok(engine.includes("shot: !acted && typeof s.shot === \"string\" && s.shot.trim() ? s.shot.trim().slice(0, 60) : undefined,"));
  // a script written this way says so — that is what lets each clip be told its scene's words
  assert.ok(engine.includes("musicMood: parsed.musicMood || tmpl.musicHint, ...(acted ? { events: true } : {}), ...(dealt ? { fresh: dealt } : {}),"));
  assert.ok(engine.includes("  events?: boolean;"));
  // every shot's place is named, in the same words — other words are another place (and another picture)
  assert.ok(engine.includes("EVERY shot has one, and while the place stays the same it is the SAME words, letter for letter"));
});

test("the wiring: dealt per location, drawn into its master, said to its clips, kept on the piece", () => {
  const eng = read("app", "lib", "film-dialogue.server.ts");
  // DEALT once the film's locations are known — a two-hander only, and one switch turns it all off
  assert.ok(eng.includes("if (isTwoHander && process.env.ACTED_STAGING !== \"off\") {"));
  assert.ok(eng.includes("const dealt = dealStagings(locOrder.map((k) => {"));
  assert.ok(eng.includes("return { where: whereAt[first], scene: scenesArr[first]?.visual || \"\", ...(masters[k]?.url ? { has: stagingOf(masters[k]) } : approvedFrames[first] ? { has: null } : {}) };"), "by the first scene set there; a master that exists keeps its own; a place the maker drew themselves is left as they drew it");
  assert.ok(eng.includes("}), { aspect });"), "the frame decides what fits");
  // DRAWN: the location's master is asked for in it — and a staged try that draws nothing never costs a film its seed
  assert.ok(eng.includes("const dealt = stagingAt.get(locKey) || undefined;"));
  assert.ok(eng.includes("const staging = attempt === 2 && !url ? undefined : dealt;"));
  assert.ok(eng.includes("creatureA: creatureNamed(spkA), creatureB: creatureNamed(spkB), staging, action, mood: tmpl.faceMood, setting: cleanSetting(where), style: twoStyle, aspect }));"));
  // KEPT with the picture (and so in the checkpoint a restarted film is picked up from)
  assert.ok(eng.includes("masters[locKey] = { url, aOnLeft, a: firstName(spkA), b: firstName(spkB), ...(drawnAs ? { staging: drawnAs } : {}) };"));
  // one master per location is still the seed of every clip there, drawn from the first scene set there…
  assert.ok(eng.includes("const master = await masterFor(locKeyAt(i), whereAt[i], i === 0 ? abs(approvedFrames[0]) : undefined, scene.visual);"));
  // …and the shot / reverse-shot panels have not come back
  assert.ok(!eng.includes("renderTwoPanelShotReverse"));
  // SAID to a clip only when the picture it grows out of was drawn in a staging: not a frame the maker approved,
  // not an angle they added by hand, not a film with no master
  assert.ok(eng.includes("if (!chained) chainStaging = approvedFrames[i] || !master?.url || tr === \"angle\" ? null : stagingOf(master);"));
  assert.ok(eng.includes("    } else if (chainStaging) {\n      try {\n        playRules = stagedRules(rules, { staging: chainStaging, event: eventAt(i), eventMax: i === treatment.scenes.length - 1 ? EVENT_MAX_LAST : undefined, others: !turnB && otherName && oSide ? [{ name: otherName, side: oSide }] : [], heard: !!heard, reveal: lastHorror });\n      } catch (e) {"), "the film's last scene may say more (a horror film's says what is seen, and what it does); and no shot is lost to its staging");
  assert.ok(eng.includes("let playRules = rules;\n    if (silent) {"), "…after the one kind of shot that is told something else: nobody speaks in it");
  // a film is never lost to its staging either: with none dealt, every place is drawn as it always was
  assert.ok(eng.includes("    } catch (e) {\n      // (a film is never lost to its staging: with none dealt, every place is drawn as it always was)\n      stagingAt.clear();"));
  // …and the event only for a script whose shots are WRITTEN as things that happen (a script from before this,
  // or one typed by hand, describes a still two-shot — and words about how somebody looks, said to the video
  // engine, redraw their face), and only where the scene's words are one
  assert.ok(eng.includes("const eventAt = (i: number): string => (treatment.events ? sceneEvent(scenesArr.map((s) => s.visual), scenesArr.map((_, j) => locKeyAt(j)), scenesArr.map((s) => s.where || \"\"), i) : \"\");"));
  assert.ok(eng.includes("const fitted = fitClipPrompt({ voice: silent ? NOBODY_SPEAKS : voiceLine, voiceDesc: silent ? \"\" : voiceDesc, ...playRules });"), "…and still built to fit the engine's prompt");
  // a shot in which something is done keeps its mid-line pause (cutting it out would make whoever moves jump)
  assert.ok(eng.includes("if (opts.moves) return t.path;"));
  assert.equal(eng.split("moves: clipMoves(prompt)").length - 1, 2, "the first render and a shot rolled again");
  // ON THE PIECE: which staging each location got, and which each shot was played in
  assert.ok(eng.includes("...(locOrder.some((k) => stagingOf(masters[k])) ? { staging: locOrder.map((k) => ({ where: (whereAt[locFirst.get(k) ?? 0] || \"\").slice(0, 120), as: stagingOf(masters[k]) })) } : {}),"));
  assert.ok(eng.includes("staging: shotStaged[i] || undefined,"));
  assert.ok(eng.includes("shotSeeds.push(seedAbs); shotPrompts.push(prompt); shotDurs.push(clipSecs); shotChained.push(chained); shotStaged.push(chainStaging);"));
});

/* ---- A SHOT NOBODY SPEAKS IN ----
 * The first horror script written with "THE LAST SHOT IS SEEN, NOT SAID" ended on a shot with no line, and the
 * engine was told to say `""`. This engine speaks ANY quoted text it is handed and moves whatever mouth it can
 * see to it (take.ts); told "NOBODY SPEAKS … no voice at all" with no quotation anywhere, three takes of three
 * came back silent. */

/** No quotation mark of any kind — and no apostrophe except inside a word ("Dagny's"). */
const quoteFree = (s: string): boolean => !/["“”«»„‟‹›‘‚‛`´]/.test(s) && !/(?<![\p{L}\p{N}])['’]|['’](?![\p{L}\p{N}])/u.test(s);

test("what counts as a shot with no line: nothing said once the name and the stage directions are off", () => {
  for (const c of ["", "   ", null, undefined, "DANA:", "Dana: ", "…", "—", "(silence)", "[silence]", "DANA: (gasps)", "DAGNY: *a long breath*", "none", "No line.", "silence", "Nobody speaks"]) assert.equal(wordless(c), true, JSON.stringify(c));
  for (const c of ["DANA: None.", "DANA: Run.", "Run.", "YLVA: (whispers) Don't move.", "达娜：快跑！", "MOM: 3:00 already?"]) assert.equal(wordless(c), false, c);
});

test("who the two are: a shot nobody speaks in names nobody, and changes nothing", () => {
  // a film with no wordless shot is read exactly as it always was — whatever the cast lists say
  assert.deepEqual(twoOnScreen(["Dagny", "Ylva", "Dagny"], ["Dagny, a", "Ylva, b", "Odd, c"]), ["Dagny", "Ylva"]);
  assert.deepEqual(twoOnScreen(["Dagny", "Dagny"], ["Dagny, a", "Ylva, b"]), ["Dagny"], "one speaker and no wordless shot: no guess, as before");
  // a horror film whose LAST shot is wordless has the same two it would have without that shot
  assert.deepEqual(twoOnScreen(["Dagny", "Ylva", "Dagny", null]), ["Dagny", "Ylva"]);
  assert.deepEqual(twoOnScreen(["Dagny", "Ylva", "Dagny", null], ["Dagny, a", "Ylva, b", "Odd, c"]), ["Dagny", "Ylva"]);
  assert.deepEqual(twoOnScreen(["Ylva", "Dagny", null], ["Dagny, a", "Ylva, b"]), ["Ylva", "Dagny"], "in the order they first speak");
  // the other one's only shot IS the silent one (a line, then the scare): the other name on a cast list of two
  assert.deepEqual(twoOnScreen(["Dagny", null], ["Dagny, a woman in her forties", "Ylva, her older sister"]), ["Dagny", "Ylva"]);
  assert.deepEqual(twoOnScreen(["DAGNY", null], ["Ylva — the elder", "Dagny (the younger)"]), ["DAGNY", "Ylva"]);
  assert.deepEqual(twoOnScreen(["Dagny", null], ["Dagny, a", "Ylva, b", "Odd, c"], ["Dagny", "Ylva"]), ["Dagny", "Ylva"], "the script's list is not two: the cast the maker picked is tried next");
  assert.deepEqual(twoOnScreen(["Dagny", null], ["Dagny, a", "Ylva, b", "Odd, c"]), ["Dagny"], "never guessed from a list of three");
  assert.deepEqual(twoOnScreen(["Ruth", null], ["Dagny, a", "Ylva, b"]), ["Ruth"], "never guessed when the one who speaks is not on it");
  assert.deepEqual(twoOnScreen([null, null], ["Dagny, a", "Ylva, b"]), ["Dagny", "Ylva"], "nobody speaks at all: the list of two");
  assert.deepEqual(twoOnScreen(["", null], ["Dagny, a", "Ylva, b"]), [], "a line with no name on it names nobody either");
  assert.deepEqual(twoOnScreen([], null, undefined), []);
  // …and the engine reads its speakers this way
  const eng = read("app", "lib", "film-dialogue.server.ts");
  assert.ok(eng.includes("const leads = treatment.scenes.map((s) => (wordless(s.caption) ? null : splitExchange(s.caption || \"\").find((t) => t.speaker)?.speaker || \"\"));"));
  assert.ok(eng.includes("const allSpeakers = twoOnScreen(leads, treatment.cast, castActors.map((c) => c.name));"));
});

test("the clip of a shot nobody speaks in: NOBODY SPEAKS first, no quotation mark anywhere, what happens in it", () => {
  // a scene's words with every kind of quotation in them
  const scene = "Behind Ylva, a grey hand with fingers far too long pushes out of the split plaster — 'slowly' — toward her shoulder; Dagny's torch \"finds\" it.";
  const said = "Behind Ylva, a grey hand with fingers far too long pushes out of the split plaster — slowly — toward her shoulder; Dagny's torch finds it.";
  const face = faceNote({ horror: true, visual: scene, speaker: "Dagny", other: "Ylva" });
  for (const kind of KINDS) {
    const base = clipRules(kind);
    for (const staging of [...KEYS, null] as Array<ActedStaging | null>) {
      for (const extra of [{}, { unseen: true, reveal: true, face }]) {
        const r = silentRules(base, { staging, event: scene, eventMax: EVENT_MAX_LAST, sides: [{ name: "Dagny", side: "left" }, { name: "Ylva", side: "right" }], ...extra });
        const fit = fitClipPrompt({ voice: NOBODY_SPEAKS, voiceDesc: "", ...r });
        const p = fit.prompt;
        const at = `${JSON.stringify(kind)} ${staging} ${Object.keys(extra).join(",")}`;
        assert.ok(p.startsWith("NOBODY SPEAKS in this shot: no voice, no words, no whisper, no murmur — only the sounds of the place and of what happens in it."), at);
        assert.ok(quoteFree(p), `${at}: ${p}`);
        assert.ok(p.length <= KLING_PROMPT_MAX && fit.gaveUp === "", `${at}: ${p.length} ${fit.gaveUp}`);
        assert.ok(p.includes(`This happens once, and it is the shot: ${said}`), at);
        // nothing about talking anywhere in it: no spoken-dialogue audio, no "the ONLY audio is the spoken voice", no sung vocal
        assert.ok(p.includes("No voice at all.") && !/spoken-dialogue|spoken voice|spoken words|vocal/.test(p), at);
        assert.ok(clipSilent(p), at);
        if ("reveal" in extra) assert.ok(p.includes(HEARD_UNSEEN) && p.includes(REVEAL_MOVES) && p.includes("Neither Dagny nor Ylva smiles at any moment: both faces show fear."), at);
      }
    }
  }
  // the rules a talking shot is told are not this
  const live = clipRules({ cartoon: false, sing: false });
  assert.equal(clipSilent(fitClipPrompt({ voice: "Only Dagny speaks.", voiceDesc: "", ...stagedRules(live, { staging: "depth", event: scene }) }).prompt), false);
  assert.equal(clipSilent(null), false);
  // with nothing written to happen, it is a held, quiet beat — still told that nobody speaks
  const held = silentRules(live);
  assert.ok(held.lookShort.endsWith("Everybody stays where they are in the picture, faces in view. Only small natural movement: breathing, a look, a shift of weight."));
  assert.ok(NOBODY_SPEAKS.includes("Everyone in the picture keeps their mouth closed from the first frame to the last") && quoteFree(NOBODY_SPEAKS));
});

test("a shot nobody speaks in has a fixed length, is kept whole, has no voice and no caption card — and is re-rolled the same way", () => {
  assert.equal(SILENT_SHOT_SECONDS, 5);
  assert.equal(clipSecondsFor(""), SILENT_SHOT_SECONDS, "what the storyboard's own meter makes of an empty line");
  const eng = read("app", "lib", "film-dialogue.server.ts");
  assert.ok(eng.includes("const silent = wordless(scene.caption);"));
  assert.ok(eng.includes("const clipSecs = silent ? SILENT_SHOT_SECONDS : heard ? heardSeconds(line) : clipSecondsFor(line);"), "its length is a number of seconds, not a count of no words");
  assert.ok(eng.includes("  if (opts.silent) return rawPath;"), "kept whole: no trim looks for a line that is not there");
  assert.ok(eng.includes("if (wordless(treatment.scenes[i]?.caption)) return null;"), "no cast voice is put on it");
  assert.ok(eng.includes("const soloVoice = turnB || silent ? null :"), "no creature chain laid over it");
  assert.ok(eng.includes("lines: treatment.scenes.slice(0, clips.length).map((sc) => (wordless(sc.caption) ? \"\" : splitExchange(sc.caption || \"\").map((t) => t.line).join(\" \"))),"), "no caption card — an emptied line leaves no name on screen");
  assert.ok(eng.includes("caption: wordless(treatment.scenes[i]?.caption) ? \"\" : (treatment.scenes[i]?.caption || \"\").slice(0, 200),") && eng.includes("...(wordless(treatment.scenes[i]?.caption) ? { wordless: true } : {}),"), "recorded as wordless");
  // THE RE-ROLL: the shot editor renders one shot again from its stored prompt and length (film-edit.server.ts →
  // regenerateFilmShot → renderDialogueClipTo), and what kind of shot it was is read off that prompt
  const fn = eng.slice(eng.indexOf("export async function renderDialogueClipTo"), eng.indexOf("/** What a rendered take SAYS"));
  assert.ok(fn.includes("return trimClip(rawPath, { chained, last: !!opts.last, moves: clipMoves(prompt), silent: clipSilent(prompt), keepHead: clipHearsFirst(prompt) });"));
  assert.ok(eng.includes("shotDurs.push(clipSecs);"), "the length it was made at is what a re-roll asks for");
  const edit = read("app", "lib", "film-edit.server.ts");
  assert.ok(edit.includes("const dur = typeof shot.dur === \"number\" && shot.dur > 0 ? shot.dur : 8;"));
  assert.ok(edit.includes("newClip = await renderDialogueClipTo(engine, shot.seed, shot.prompt, dur, film.aspect, `regen-${i}`, !!shot.chained, undefined, { last: i === film.shots.length - 1 });"));
  // a re-cut captions each shot from what it records: a wordless shot records no caption
  assert.ok(edit.includes("let cap = s.caption || \"\";"));
});

test("the writer is told which shot may have no line: only a horror film's last", () => {
  assert.equal(LINE_IN_EVERY_SHOT, "EVERY shot has a line: a CAPTION is never left empty.");
  assert.equal(LINE_IN_EVERY_SHOT_BUT_THE_LAST, "EVERY shot has a line, with ONE exception: the LAST shot of this film has none (THE LAST SHOT, below). No other CAPTION is ever left empty.");
  assert.ok(SEEN_AT_THE_END.includes("So the LAST shot has NO LINE: its CAPTION is \"\" (empty — no NAME, no words) and it has no TONE. Nobody speaks in it, not a word and not a whisper; the last words of the film are the line of the shot BEFORE it."));
  const engine = read("app", "lib", "film-engine.server.ts");
  // said at the end of what a CAPTION is — every acted film; the exception for a horror film only
  assert.ok(engine.includes("one of the two reports it (\\\"He says he can't thank us enough!\\\"). ${tmpl.key === \"horror\" ? LINE_IN_EVERY_SHOT_BUT_THE_LAST : LINE_IN_EVERY_SHOT}\\n` +"));
  // a line the writer marks "(silence)" or "—" is not kept as a line to be spoken or drawn
  assert.ok(engine.includes("caption: s.caption && !(acted && wordless(s.caption)) ? dropOrgEndorsementPossessive(s.caption) : undefined,"));
});

/* ---- A SOUND THEY HEAR ----
 * The owner, of a four-shot Horror Film made on the live site: "Better but flaky, 'tell me you heard that' then
 * the sound plays after - floating hand knocking fast actor says 'it's knocking really slow'". */

const SISTERS = ["Dagny", "Ylva"];

test("a scene that is a sound is read off its own words: heard — never one of the two doing it", () => {
  const heard: Array<[string, boolean]> = [
    ["Three slow, heavy knocks come from inside the bedroom wall, a full second apart, as Dagny freezes and Ylva turns toward it.", true],
    ["A slow knock sounds inside the wall behind the dresser; Dagny drops the letters and Ylva steps back from the box.", true],
    ["Footsteps cross the ceiling above them as Dagny grips the banister and Ylva looks up.", true],
    ["A voice calls Dagny's name from the basement as Dagny and Ylva freeze at the top of the stairs.", true],
    ["Somewhere upstairs a door slams, and Dagny and Ylva both look up.", true],
    ["The knocking starts again, faster now, while Ylva presses her ear to the plaster and Dagny backs away.", true],
    ["Dagny hears a scratching behind the wallpaper and Ylva turns, the torch shaking.", true],
    ["Something taps three times on the window as Dagny and Ylva sit frozen at the table.", true],
    ["Dagny freezes and three knocks answer from inside the wall while Ylva drops the quilt.", true],
    ["A woman's voice hums a lullaby from the nursery as Dagny and Ylva stop on the landing.", true],
    // a sound, but not from out of sight: something in the picture makes it…
    ["The phone on the hall table rings as Dagny and Ylva stare at each other.", false],
    ["A grey hand knocks slowly on the inside of the wardrobe door as Dagny backs away and Ylva lifts the lamp.", false],
    ["A cry escapes Dagny as Ylva drops the lamp.", false],
    ["Dagny lifts the lid of the old trunk and it creaks.", false],
    // …or one of the two is knocking too (told "no hand knocks", the clip would be told two things at once)
    ["Ylva knocks twice on the wall and something knocks back, slower.", false],
  ];
  for (const [scene, unseen] of heard) {
    const h = heardIn(scene, SISTERS);
    assert.ok(h, scene);
    assert.equal(h!.unseen, unseen, scene);
    assert.ok(h!.sound.length > 5 && scene.includes(h!.sound), scene);
  }
  assert.equal(heardIn(heard[0][0], SISTERS)!.sound, "Three slow, heavy knocks come from inside the bedroom wall, a full second apart");
  // something one of them DOES, or no sound at all
  for (const scene of [
    "Ylva pulls the basement door open a hand's width while Dagny grips the torch.",
    "Dagny knocks on the wall twice while Ylva holds the lamp.",
    "Ylva slams the drawer shut as Dagny flinches.",
    "Ylva's knock echoes through the empty hall while Dagny holds the lamp.",
    "Ylva lowers her voice and pulls the sheet off the mirror while Dagny watches.",
    "Her voice breaks as Dagny hands Ylva the photograph.",
    "Dagny and Ylva laugh as the kite lifts into the wind.",
    "Ylva rings the bell on the counter as Dagny waits.",
    "Dagny lifts a bundle of letters from the drawer while Ylva folds a quilt into the box.",
    "Dagny and Ylva come down the wooden stairs side by side, the torch beam shaking ahead of them.",
    "In a hushed voice, Ylva tells Dagny to stop moving.",
    "Ylva lifts the music box and opens it, humming.",
    "", null,
  ]) assert.equal(heardIn(scene, SISTERS), null, String(scene));
  // a name at the start of a sentence is known by the film's own names — and any capital later on is somebody
  assert.equal(heardIn("Then Marta knocks on the door.", []), null);
  assert.ok(heardIn("Slow knocks come from the cellar door.", SISTERS));
  // the example the writer is shown is read as one
  const example = (HEARD_BEFORE_SAID.match(/\("(Three slow[^"]+)"\)/) || [])[1] || "";
  assert.ok(example && heardIn(example, SISTERS)?.unseen, example);
});

test("a shot that opens on a sound: the sound first, heard alone — then the line, in answer to it", () => {
  const event = clipEvent("Three slow, heavy knocks come from inside the bedroom wall, a full second apart, as Dagny freezes and Ylva turns toward it.");
  const deliver = "Deliver it in a tight, frightened whisper — put that exact emotion and energy into the voice, expressively, NEVER flat or monotone.";
  const face = "Neither Dagny nor Ylva smiles at any moment: both faces show fear.";
  const line = "Dagny, stop moving for a second. Tell me you heard that too.";
  const one = heardTalk({ event, unseen: true, speaker: "Dagny", side: "left", line, other: "Ylva", otherSide: "right", deliver, face });
  assert.ok(one.startsWith(`${HEARD_OPEN} ${event} ${HEARD_UNSEEN} ${HEARD_THEN} Dagny, the person on the LEFT side of the frame, says exactly this one line, ONCE, word for word, in accurate lip-sync, and nothing else: "${line}".`), one);
  assert.ok(HEARD_OPEN.startsWith("THE SHOT OPENS ON A SOUND, heard ALONE before anybody says a word") && HEARD_THEN === "ONLY AFTER IT does anybody speak, in answer to it.");
  assert.ok(one.indexOf("knocks") < one.indexOf("Tell me you heard that"), "the sound is said before what is said about it");
  // the line once, in quotes — the only quotation in it
  assert.equal((one.match(/"/g) || []).length, 2);
  // every rule of a talking shot, in fewer words — and "after that sound" where a talking shot says "right away"
  for (const rule of ["no word repeated, echoed or added", "the moment the line is finished, Dagny stops and holds a quiet expression", "ONLY Dagny's mouth moves: Ylva (on the right) is COMPLETELY SILENT the whole time, mouth closed, only listening and reacting", "Apart from that sound, Dagny's is the ONLY voice in the clip — no second voice, murmur or gibberish anywhere.", "Keep Dagny's voice the SAME as in every other shot.", `${deliver} ${face}`]) assert.ok(one.includes(rule), rule);
  assert.ok(!/right away/i.test(one));
  // (b) said only when it comes from out of sight
  assert.ok(HEARD_UNSEEN.includes("nothing in the picture makes it — no hand knocks or taps on anything, no mouth moves to it, nobody else appears: the two only HEAR it"));
  assert.ok(!heardTalk({ event, speaker: "Dagny", line, deliver }).includes(HEARD_UNSEEN));
  // …and a PICTURE drawn at such a moment (a place's master, a re-anchor) is told the sound is not drawn: told to
  // put everything the moment names in the picture, it would draw whoever makes it — a hand knocking
  const parts = { setting: "a bedroom in an old house at dusk", personA: "Dagny — EXACTLY the person in reference image 1", personB: "Ylva, a tall woman in her fifties", consistency: "Keep the two people clearly distinct.", comp: "wide cinematic landscape composition" };
  const knocks = stagedTwoShot({ staging: "depth", ...parts, act: "Three slow, heavy knocks come from inside the bedroom wall, a full second apart, as Dagny freezes and Ylva turns toward it." });
  assert.ok(knocks.includes(`is IN the picture, seen the way the moment says it is seen, and well above the picture's bottom edge. ${HEARD_NOT_DRAWN} Draw the instant it BEGINS`));
  assert.ok(HEARD_NOT_DRAWN.startsWith("What is HEARD in this moment is not drawn: nothing in the picture makes that sound"));
  for (const act of ["Dagny knocks on the wall twice while Ylva holds the lamp.", "Ylva pulls the drawer open while Dagny grips the torch.", "The phone on the hall table rings as Dagny and Ylva stare at each other."]) {
    assert.ok(!stagedTwoShot({ staging: "depth", ...parts, act }).includes(HEARD_NOT_DRAWN), act);
  }
  assert.ok(read("app", "lib", "film-dialogue.server.ts").includes("At this moment: ${now}${unheard} ${NO_TEXT}`"), "a re-anchor drawn at that moment is told so too");
  // a reply in the same shot; a line with no name on it
  const two = heardTalk({ event, speaker: "Dagny", side: "left", line: "Did you hear that?", deliver, reply: { speaker: "Ylva", side: "right", line: "It came from the wall." } });
  assert.ok(two.includes("FIRST Dagny (on the left side of the frame) says: \"Did you hear that?\". THEN Ylva (on the right side) replies: \"It came from the wall.\"") && two.includes("Apart from that sound there are exactly TWO voices, Dagny's and then Ylva's"));
  const anon = heardTalk({ event, line: "Did you hear that?", deliver });
  assert.ok(anon.startsWith(`${HEARD_OPEN} ${event} ${HEARD_THEN} Then ONE voice says this line, ONCE, word for word`));
  // known again from the prompt alone (a re-rolled shot is trimmed the way its first take was), and it keeps its pauses
  for (const p of [one, two, anon]) { assert.ok(clipHearsFirst(p)); assert.ok(clipMoves(p)); }
  assert.equal(clipHearsFirst("Only one person speaks and says the line exactly once."), false);
  assert.equal(clipHearsFirst(null), false);
});

test("…its rules: the scene's words lead, so the note says what follows them — and the sound rule lets the sound be made, exactly as described", () => {
  const scene = "Three slow, heavy knocks come from inside the bedroom wall, a full second apart, as Dagny freezes and Ylva turns toward it.";
  for (const kind of [{ cartoon: false, sing: false }, { cartoon: true, sing: false }]) {
    const base = clipRules(kind);
    assert.ok(base.steady.includes("The ONLY audio is the spoken voice and faint room tone — no music or sound effects."), "what every spoken clip is told: no leave for a knock");
    for (const k of KEYS) {
      const r = stagedRules(base, { staging: k, event: scene, heard: true });
      assert.ok(r.steady.endsWith(HEARD_AUDIO) && !r.steady.includes("no music or sound effects."), `${JSON.stringify(kind)} ${k}`);
      for (const note of [r.look, r.lookTight, r.lookShort]) {
        assert.ok(note.includes(stagingClip(k)) && note.includes("After the sound, only natural talking, small gestures and shifts of weight."), k);
        assert.ok(!note.includes("knocks") && !note.includes("As the line is spoken"), "the scene's words are said once, at the top");
      }
      assert.deepEqual(stagedRules(base, { staging: k, event: scene, heard: false }), stagedRules(base, { staging: k, event: scene }), "not a sound: as before");
      assert.deepEqual(stagedRules(base, { staging: k, heard: true }), stagedRules(base, { staging: k }), "no scene words: nothing to open on");
    }
  }
  // (c) WHAT IS SAID ABOUT IT IS WHAT IS HEARD
  assert.ok(HEARD_AUDIO.startsWith("The ONLY audio is that sound — exactly as described: no faster, no louder and no more of it — and then the spoken voice"));
});

test("a sound shot's whole prompt fits what the engine reads — the voice timbre, everybody's look and the sound all kept", () => {
  const TIMBRE = " Dagny's voice is warm, upbeat and easy to trust (a friendly female voice); keep this exact voice in every shot.";
  const scene = "Three slow, heavy knocks come from inside the bedroom wall behind the dresser, a full second apart, as Dagny freezes with the letters and Ylva turns toward it.";
  const deliver = "Deliver it quietly, barely holding it together, a tremor in the voice — put that exact emotion and energy into the voice, expressively, NEVER flat or monotone.";
  const line = "Dagny, stop moving for a second, please. Tell me you heard that too, because I swear it moved.";
  for (const kind of [{ cartoon: false, sing: false }, { cartoon: true, sing: false }]) {
    for (const k of KEYS) {
      for (const eventMax of [EVENT_MAX, EVENT_MAX_LAST]) {
        const event = clipEvent(scene, eventMax);
        const voice = heardTalk({ event, unseen: true, speaker: "Dagny", side: "left", line, other: "Ylva", otherSide: "right", deliver, face: faceNote({ horror: true, speaker: "Dagny", other: "Ylva" }) });
        const fit = fitClipPrompt({ voice, voiceDesc: TIMBRE, ...stagedRules(clipRules(kind), { staging: k, event: scene, eventMax, heard: true }) });
        const at = `${JSON.stringify(kind)} ${k} ${eventMax}: ${fit.prompt.length} ${fit.gaveUp}`;
        assert.ok(fit.prompt.length <= KLING_PROMPT_MAX, at);
        assert.ok(fit.gaveUp === "" || fit.gaveUp === "the look-note's extra wording", at);
        assert.ok(fit.prompt.includes(TIMBRE.trim()) && fit.prompt.includes(event) && fit.prompt.includes(`"${line}"`) && fit.prompt.includes(HEARD_AUDIO), at);
        assert.ok(fit.prompt.includes("Keep EVERYONE and the setting EXACTLY as in the starting image"), at);
      }
    }
  }
});

test("a sound shot is longer by the sound, keeps its head, and is only made where the scene is told to the clip", () => {
  for (const line of ["Run.", "Dagny, stop moving for a second. Tell me you heard that too.", "It's slow, like someone's knuckles counting something out. Real patient, like it has all night."]) {
    const s = heardSeconds(line);
    assert.equal(s, Math.min(CLIP_MAX_SECONDS, Math.ceil(clipSecondsFor(line) + HEARD_FIRST_SECONDS)), line);
    assert.ok(s > clipSecondsFor(line) || s === CLIP_MAX_SECONDS, line);
  }
  assert.equal(heardSeconds("Dagny, stop moving for a second. Tell me you heard that too."), 9);
  const eng = read("app", "lib", "film-dialogue.server.ts");
  assert.ok(eng.includes("const heard = !silent && chainStaging ? heardIn(eventAt(i), [spkA, spkB, ...castActors.map((c) => c.name)]) : null;"), "a staged picture in a film whose shots happen: where the scene is told at all");
  assert.ok(eng.includes("const voiceLine = heard\n      ? heardTalk({"));
  // the trims: nothing before the line is cut or played fast — the first take and a re-rolled one alike
  assert.equal(eng.split("keepHead: clipHearsFirst(prompt)").length - 1, 2);
  assert.ok(eng.includes("const plan = opts.keepHead ? { ...planned, cutHead: 0, retime: null } : planned;"));
});

test("the writer: a sound comes before any word about it, what is heard is not seen, and what is said about it is what is heard", () => {
  assert.ok(HEARD_BEFORE_SAID.startsWith("A SOUND COMES BEFORE ANY WORD ABOUT IT — when what happens in a shot is a SOUND"));
  for (const rule of [
    "that shot's VISUAL BEGINS with it: what is heard, exactly how it sounds — how many, how fast or slow, how loud — and where it comes from",
    "The shot opens on that sound, heard ALONE, and its line is the REACTION to it",
    "is only ever in the shot where that sound is first heard, or a later one; never before it.",
    "WHAT IS SAID ABOUT IT IS WHAT IS HEARD: a line that describes the sound says what its VISUAL says — never \"slow\" about a fast knock, never \"once\" about three.",
    "WHAT IS HEARD IS NOT SEEN: a sound from out of sight — inside a wall, upstairs, behind a closed door, under the floor — is made by NOTHING on screen: neither of the two knocks, taps or scratches while it is heard, and no hand or figure is shown making it",
  ]) assert.ok(HEARD_BEFORE_SAID.includes(rule), rule);
  for (const reaction of ["did you hear that?", "there it is again"]) assert.ok(HEARD_BEFORE_SAID.includes(reaction));
  // said to EVERY acted film (a knock at the door is not only a horror film's), after the two always being there
  const engine = read("app", "lib", "film-engine.server.ts");
  const two = engine.indexOf("`${TWO_ALWAYS}\\n` +");
  const heard = engine.indexOf("`${HEARD_BEFORE_SAID}\\n` +");
  const seen = engine.indexOf("(tmpl.key === \"horror\" ? `${SEEN_AT_THE_END}\\n` : \"\")");
  assert.ok(two > 0 && heard > two && seen > heard);
});

/* ---- NOBODY SMILES AT WHAT FRIGHTENS THEM ---- */

test("nobody smiles at what frightens them — said plainly, unless the script makes the smile the horror", () => {
  assert.equal(faceNote({ horror: true, tone: "quietly", speaker: "Ylva", other: "Dagny" }), "Neither Ylva nor Dagny smiles at any moment: both faces show fear.");
  // the owner's film: the most frightening line, said smiling
  assert.equal(faceNote({ horror: true, tone: "with dawning horror", visual: "Ylva presses her palm to the wall while Dagny backs away.", speaker: "Ylva", other: "Dagny" }), "Neither Ylva nor Dagny smiles at any moment: both faces show fear.");
  // the smile IS the horror: the script says so — in the scene's words, or in how the line is said
  assert.equal(faceNote({ horror: true, tone: "calmly", visual: "Ylva smiles at the wall, far too calm, as Dagny backs away.", speaker: "Ylva", other: "Dagny" }), "Dagny does not smile at any moment: the face shows fear.");
  assert.equal(faceNote({ horror: true, tone: "with a slow, wrong smile", speaker: "Ylva", other: "Dagny" }), "Dagny does not smile at any moment: the face shows fear.");
  assert.equal(faceNote({ horror: true, tone: "with a slow, wrong smile", visual: "Dagny grins at the wall.", speaker: "Ylva", other: "Dagny" }), "");
  // the calm before it: a horror film's warm line is left to its words (the owner's film opened on a fond one)
  assert.equal(faceNote({ horror: true, tone: "softly, fond and a little nostalgic", speaker: "Dagny", other: "Ylva" }), "");
  assert.equal(faceNote({ horror: true, tone: "trying to sound reassuring, voice shaking", speaker: "Dagny", other: "Ylva" }), "Neither Dagny nor Ylva smiles at any moment: both faces show fear.", "…unless the warmth is put on over fear");
  assert.equal(faceNote({ horror: true, tone: "", speaker: "Dagny", other: "Ylva" }), "Neither Dagny nor Ylva smiles at any moment: both faces show fear.", "no tone: frightened, in a horror film");
  // any other film: a frightened line only, and only its speaker
  assert.equal(faceNote({ tone: "scared, voice shaking", speaker: "Pip", other: "Rosa" }), "Pip does not smile at any moment: the face shows fear.");
  assert.equal(faceNote({ tone: "warmly, with a laugh", speaker: "Pip", other: "Rosa" }), "");
  assert.equal(faceNote({ speaker: "Pip", other: "Rosa" }), "");
  assert.equal(faceNote({ horror: true }), "Nobody smiles at any moment: every face shows fear.");
  for (const f of [faceNote({ horror: true, speaker: "Dagny's", other: "Ylva" }), faceNote({ horror: true })]) assert.ok(quoteFree(f), f);
  // the clip is told it: a talking shot in its delivery, a shot nobody speaks in in its rules — behind the one switch
  const eng = read("app", "lib", "film-dialogue.server.ts");
  assert.ok(eng.includes("const face = staged && !silent ? faceNote({ horror, tone, visual: scene.visual, speaker, other: turnB ? turnB.speaker : otherName }) : \"\";"));
  assert.ok(eng.includes("NEVER flat or monotone.`}${face ? ` ${face}` : \"\"}`;"));
  assert.ok(eng.includes("const scared = staged ? faceNote({ horror, visual: scene.visual, speaker: spkA, other: spkB }) : \"\";"));
  assert.ok(eng.includes("const staged = process.env.ACTED_STAGING !== \"off\";") && eng.includes("const horror = tmpl.key === \"horror\";"));
});

/* ---- THE LAST SHOT OF A HORROR FILM: SEEN, IN THE SAME ROOM ----
 * Its last shot was given "a WHERE of its own": a different bedroom, reached through a half-second double
 * exposure, a smooth, evenly lit, mannequin-like arm in its wall. The owner: "the hands coming out of wall are
 * more odd than actual realism". */

test("the last shot of a horror film: the SAME place, drawn into that place's own picture by the creature recipe, moving slowly", () => {
  // the writer: the same WHERE, letter for letter — never another room; slow; afraid
  for (const rule of [
    "It is in the SAME PLACE as the shot before it — its WHERE is the same words, letter for letter",
    "never in another room; the film draws it into that place's own picture",
    "mostly in shadow — and what HAPPENS in that shot is IT, SLOWLY",
    "Neither of the two smiles — they are afraid of it — unless that smile IS the horror and the VISUAL says so.",
  ]) assert.ok(SEEN_AT_THE_END.includes(rule), rule);
  // the picture: the place's own picture, edited — the thing added by the recipe the horror stories use, REUSED
  const moment = "Behind Ylva, a grey hand with fingers far too long pushes out through the split plaster toward her shoulder; Dagny sees it, Ylva has not turned round.";
  const mood = "Every living person in it looks tense, wary or afraid — nobody smiles, grins or laughs.";
  const p = revealPicture({ moment, mood });
  assert.ok(p.startsWith("Edit this picture, a frame from a live-action horror film. Keep it EXACTLY as it is — the same place, the same camera and framing, the same light and colour, and the same two people on the same sides of the frame, with the same faces, hair and clothes."));
  assert.ok(p.includes(`Change ONLY what this moment changes: ${moment} The one new thing in the picture is what this moment says is there, and it is real.`));
  assert.ok(p.includes(CREATURE_REAL), "CAUGHT on a real camera, a practical effect, never CGI — story-picture.ts's own words");
  assert.ok(p.includes(TAKE_HIDDEN), "mostly HIDDEN — take.ts's own words");
  assert.ok(p.includes("It is nearly human and slightly WRONG — in exactly the one or two ways the moment says, and in no other."), "WRONG — as the writer was told to write it (WHAT FRIGHTENS)");
  assert.ok(p.includes("nothing about it is clean, smooth or evenly lit") && p.includes(` ${mood} `));
  assert.ok(!p.includes(TAKE_WRONG), "not found footage's face — sunk eyes — on a thing that may be a hand");
  assert.ok(p.length < 2000, "within what the picture call keeps");
  assert.equal(revealPicture({ moment: "" }), "");
  assert.equal(revealPicture({ moment: null }), "");
  // reused, not a third copy: the recipe's words are imported, never written out again here
  const src = read("app", "lib", "acted-staging.ts");
  assert.ok(src.includes("import { CREATURE_REAL } from \"./story-picture.ts\";") && src.includes("import { TAKE_HIDDEN } from \"./take.ts\";"));
  for (const words of ["a practical-effects creature as a 1970s horror film would build it", "we see less than we want to"]) assert.ok(!src.includes(words), words);
  // the clip: it moves SLOWLY — whether or not a line was written for it
  assert.ok(REVEAL_MOVES.startsWith("What is seen moves SLOWLY — slow, smooth and unhurried, never a jump, a lunge or a sudden move"));
  const live = clipRules({ cartoon: false, sing: false });
  assert.ok(silentRules(live, { staging: "depth", event: moment, reveal: true }).lookShort.includes(REVEAL_MOVES));
  assert.ok(!silentRules(live, { staging: "depth", event: moment }).look.includes(REVEAL_MOVES));
  assert.ok(stagedRules(live, { staging: "depth", event: moment, reveal: true }).lookShort.endsWith(`As the line is spoken, this happens once: ${moment} ${REVEAL_MOVES}`));
  assert.ok(!stagedRules(live, { staging: "depth", reveal: true }).look.includes(REVEAL_MOVES), "nothing written to happen: nothing to move");
  // the film: the last shot of a staged horror film whose shots happen, in the same place, on a staged master —
  // never over a frame the maker approved; a picture that will not come leaves it to be seeded as any other
  const eng = read("app", "lib", "film-dialogue.server.ts");
  assert.ok(eng.includes("const lastHorror = staged && horror && i > 0 && i === treatment.scenes.length - 1 && !!eventAt(i);"));
  const at = eng.indexOf("if (!seedAbs && lastHorror && tr !== \"location\" && master?.url && stagingOf(master)) {");
  assert.ok(at > eng.indexOf("let seedAbs = abs(approvedFrames[i]);") && eng.indexOf("if (!seedAbs && master?.url) {", at) > at);
  assert.ok(eng.includes("const ask = revealPicture({ moment: eventAt(i), mood: tmpl.faceMood });"));
  assert.ok(eng.includes("seedAbs = abs(await removeLetterbox(await renderStyledSeed(ask, abs(master.url)!, aspect, 2000)));"), "the place's master is the ONE reference picture");
  assert.ok(eng.includes("playRules = silentRules(rules, { staging: chainStaging, event: eventAt(i), eventMax: i === treatment.scenes.length - 1 ? EVENT_MAX_LAST : undefined, sides, unseen, reveal: lastHorror, face: scared });"));
  // (the picture call keeps 2,000 characters of a prompt — image-generation.server.ts, not changed here)
  const img = read("app", "lib", "image-generation.server.ts");
  assert.ok(img.includes("export async function renderStyledSeed(prompt: string, refImageUrl: string, aspect = \"9:16\", maxPrompt = 500): Promise<string | null> {") && img.includes("const full = `${(prompt || \"\").trim().slice(0, Math.max(200, Math.min(2000, maxPrompt)))}. No watermark, no signature.`;"));
});

/* ---- A CUT TO ANOTHER PLACE IS A STRAIGHT CUT ---- */

test("a cut to another place, and to the reveal, is a straight cut; a shot that continues the last keeps its tiny blend", () => {
  const eng = read("app", "lib", "film-dialogue.server.ts");
  const hard = Number((eng.match(/export const HARD_CUT_SECONDS = ([\d.]+);/) || [])[1]);
  assert.ok(hard > 0 && hard <= 1 / 29, "one frame at 30 fps");
  assert.ok(eng.includes("const fadeFor = (i: number) => (hardSeams?.has(i) ? HARD_CUT_SECONDS : softSeams?.has(i) ? 0.32 : 0.18);"), "a straight cut wins over both dissolves");
  assert.ok(eng.includes("if (i > 0 && !chained && (tr === \"location\" || revealed)) hardSeams.add(i);"));
  assert.ok(eng.includes("await assembleTestMovie(clips, outPath, jobId, softSeams, aspect, hardSeams);"));
  assert.ok(eng.includes("export async function assembleTestMovie(clips: string[], outPath: string, jobId?: string, softSeams?: Set<number>, aspect: \"9:16\" | \"16:9\" | \"1:1\" = \"9:16\", hardSeams?: Set<number>): Promise<void> {"), "optional: a caller that passes none cuts as before");
  assert.ok(eng.includes("...(hardSeams.has(i) ? { cut: \"hard\" } : {}),"), "kept on the piece, so a re-cut can keep it");
});

const ffmpegOk = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0;

test("ffmpeg makes that one-frame xfade a straight cut: not one frame of the two rooms mixed", { skip: !ffmpegOk }, () => {
  const hard = Number((read("app", "lib", "film-dialogue.server.ts").match(/export const HARD_CUT_SECONDS = ([\d.]+);/) || [])[1]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hardcut-"));
  try {
    const clip = (name: string, color: string, hz: number) => {
      const out = path.join(dir, name);
      const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${color}:s=64x64:r=24:d=1`, "-f", "lavfi", "-i", `sine=frequency=${hz}:sample_rate=44100:duration=1`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      return out;
    };
    const a = clip("a.mp4", "red", 900), b = clip("b.mp4", "blue", 500);
    // the assembler's own steps: each clip to 30 fps from zero, then xfade + acrossfade at the seam — and every
    // frame read back as one mean colour: pure red, pure blue, or a blend of the two
    const mixed = (fade: number): number => {
      const graph = `[0:v]fps=30,setpts=PTS-STARTPTS[v0];[1:v]fps=30,setpts=PTS-STARTPTS[v1];[v0][v1]xfade=transition=fade:duration=${fade}:offset=${(1 - fade).toFixed(3)}[vx];[vx]scale=1:1[v];[0:a]aresample=44100,asetpts=PTS-STARTPTS[a0];[1:a]aresample=44100,asetpts=PTS-STARTPTS[a1];[a0][a1]acrossfade=d=${fade}[a]`;
      const r = spawnSync("ffmpeg", ["-v", "error", "-i", a, "-i", b, "-filter_complex", graph, "-map", "[v]", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1", "-map", "[a]", "-f", "null", "-"], { encoding: "buffer", maxBuffer: 1 << 26 });
      assert.equal(r.status, 0, String(r.stderr));
      const frames = r.stdout;
      assert.ok(frames.length >= 3 * 50, `${frames.length / 3} frames`);
      let blends = 0;
      for (let k = 0; k + 2 < frames.length; k += 3) {
        const [red, , blue] = [frames[k], frames[k + 1], frames[k + 2]];
        if (red > 40 && blue > 40) blends++;
      }
      return blends;
    };
    assert.equal(mixed(hard), 0, "a straight cut");
    assert.ok(mixed(0.32) >= 4, "…where the old dissolve to another place mixed the two");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
