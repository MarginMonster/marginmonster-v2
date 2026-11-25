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
  ACTED_STAGINGS, AGES_FIT_RELATION, AGE_RULES, CAMERA_IS_DEALT, EVENT_IDEAS, EVENT_IDEAS_SMALL, EVENT_MAX, EVENT_MAX_LAST, HEARD_AUDIO, HEARD_BEFORE_SAID,
  HEARD_FIRST_SECONDS, HEARD_NOT_DRAWN, HEARD_OPEN, HEARD_THEN, HEARD_UNSEEN, LINE_IN_EVERY_SHOT, LINE_IN_EVERY_SHOT_BUT_THE_LAST, NOBODY_SPEAKS, ONE_TAKE,
  FILM_FPS, JOIN_TOLERANCE, PICTURE_DESC_MAX, REVEAL_DIM, REVEAL_MOVES, REVEAL_PARTS, SOUND_NOT_DRAWN, SOUND_NOT_SHOWN, lookAtPicture, lookTarget, REVEAL_REACT, REVEAL_STAY, REVEAL_UNSEEN_REACT, SEAM_FRAMES, SEEN_AT_THE_END, SEEN_WHEN_SEEN, SILENT_SHOT_SECONDS, TWO_ALWAYS,
  ageAsk, ageOf, castAgeProblem, clipEvent, clipFrames, clipHearsFirst, clipMoves, clipSilent, dealStagings, eventIdeas, faceNote, happensBrief, heardIn, heardSeconds,
  heardTalk, isActedStaging, joinCheck, joinGraph, kinLooks, kinNote, noRoomIn, ownTitle, relationOf, repairAges, revealClip, revealPart, revealPicture, sceneEvent, silentRules, stagedRules, stagedTwoShot,
  stagingClip, stagingPicture, stagingsFor, takeAgeFix, titleAsk, twoOnScreen, wordless,
  type ActedStaging, type Seam, type SeamKind,
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

test("the master's whole prompt in a staging: the scene's moment IN the picture, the cast bound exactly as before", async () => {
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
  assert.ok(img.includes("const staged = opts.staging ? stagedTwoShot({ staging: opts.staging, cartoon, setting, personA, personB, act: action.replace(/\\s+/g, \" \").trim().slice(0, 560), mood, consistency: consistencyNote, roomNote, faceNote, comp }) : \"\";"));
  // (…drawn on the good model first, the everyday one only if it will not: story-picture.ts → STORY_MODEL)
  assert.ok(img.includes("for (const m of [STORY_MODEL, STORY_LAST_MODEL]) {") && img.includes("try { url = await repRun(m, storyPictureInput(m, { prompt: staged || prompt, refs, aspect: ar }), 150_000); used = m; break; }"));
  // (…and a staged picture of a photographed film is told today's world, a lived-in home and what a shadow is)
  const sp = await import("../app/lib/story-picture.ts");
  const real = stagedTwoShot({ staging: "levels", ...parts, act: "Beyond the window a tall dark shadow stands under the old tree while Dana grips the torch" });
  assert.ok(real.includes(` ${sp.TODAY_LOOK}`) && real.includes(sp.SHADOW_SHAPE));
  assert.ok(!stagedTwoShot({ staging: "levels", ...parts }).includes(sp.SHADOW_SHAPE), "no standing shadow in the moment, no shadow line");
  assert.ok(!stagedTwoShot({ staging: "levels", cartoon: true, ...parts }).includes(sp.TODAY_LOOK), "a cartoon is left as it was");
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
  // a horror film only — and before WHAT FRIGHTENS, which it points down to (with WHEN THEY SEE IT, WE SEE IT before
  // it: the lake film kept the woman its idea had them SEE off screen until a last shot that did not come)
  const seen = engine.indexOf("(tmpl.key === \"horror\" ? `${SEEN_WHEN_SEEN}\\n${SEEN_AT_THE_END}\\n` : \"\")");
  const frightens = engine.indexOf("(tmpl.key === \"horror\" ? `${WHAT_FRIGHTENS}\\n` : \"\") +");
  assert.ok(seen > 0 && frightens > seen);
  assert.ok(SEEN_WHEN_SEEN.startsWith("WHEN THEY SEE IT, WE SEE IT — when the IDEA has its people see the thing before the end") && SEEN_WHEN_SEEN.endsWith("It is never only talked about."));
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
  assert.ok(eng.includes("creatureA: creatureNamed(spkA), creatureB: creatureNamed(spkB), staging, action, mood: tmpl.faceMood, setting: nightSetting(cleanSetting(where), opts.topic, action), style: twoStyle, aspect }));"));
  // KEPT with the picture (and so in the checkpoint a restarted film is picked up from)
  assert.ok(eng.includes("masters[locKey] = { url, aOnLeft, a: firstName(spkA), b: firstName(spkB), ...(drawnAs ? { staging: drawnAs } : {}) };"));
  // one master per location is still the seed of every clip there, drawn from the first scene set there…
  assert.ok(eng.includes("const master = await masterFor(locKeyAt(i), whereAt[i], i === 0 ? abs(approvedFrames[0]) : undefined, lastHorror && tr === \"location\" ? undefined : withLooks(scene.visual));"));
  // …and the shot / reverse-shot panels have not come back
  assert.ok(!eng.includes("renderTwoPanelShotReverse"));
  // SAID to a clip only when the picture it grows out of was drawn in a staging: not a frame the maker approved,
  // not an angle they added by hand, not a film with no master
  assert.ok(eng.includes("if (!chained) chainStaging = approvedFrames[i] || !master?.url || tr === \"angle\" ? null : stagingOf(master);"));
  assert.ok(eng.includes("    } else if (chainStaging) {\n      try {\n        playRules = stagedRules(rules, { staging: chainStaging, event: eventAt(i), eventMax: i === treatment.scenes.length - 1 ? EVENT_MAX_LAST : undefined, others: !turnB && otherName && oSide ? [{ name: otherName, side: oSide }] : [], heard: !!heard, reveal: lastHorror, drawn: revealed, creature: revealedCreature, outdoors, seen: revealSeen, implied });\n      } catch (e) {"), "the film's last scene may say more (a horror film's says what is seen, and what it does); and no shot is lost to its staging");
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
      for (const extra of [{}, { unseen: true, reveal: true, face }, { unseen: true, reveal: true, drawn: true, face }]) {
        const r = silentRules(base, { staging, event: scene, eventMax: EVENT_MAX_LAST, sides: [{ name: "Dagny", side: "left" }, { name: "Ylva", side: "right" }], ...extra });
        const fit = fitClipPrompt({ voice: NOBODY_SPEAKS, voiceDesc: "", ...r });
        const p = fit.prompt;
        const at = `${JSON.stringify(kind)} ${staging} ${Object.keys(extra).join(",")}`;
        assert.ok(p.startsWith("NOBODY SPEAKS in this shot: no voice, no words, no whisper, no murmur — only the sounds of the place and of what happens in it."), at);
        assert.ok(quoteFree(p), `${at}: ${p}`);
        assert.ok(p.length <= KLING_PROMPT_MAX && fit.gaveUp === "", `${at}: ${p.length} ${fit.gaveUp}`);
        // nothing about talking anywhere in it: no spoken-dialogue audio, no "the ONLY audio is the spoken voice", no sung vocal
        assert.ok(p.includes("No voice at all.") && !/spoken-dialogue|spoken voice|spoken words|vocal/.test(p), at);
        assert.ok(clipSilent(p), at);
        if ("drawn" in extra) {
          // THE REVEAL THIS FILM DREW: what is in its picture and the one small thing it does — never the scene's
          // words ("pushes out … toward her shoulder"), never walking on, the camera still
          assert.ok(p.includes(`This happens once, and it is the shot: ${revealClip(scene)} ${REVEAL_REACT}`) && p.includes(REVEAL_STAY), at);
          assert.ok(!p.includes("pushes out") && !p.includes("toward her shoulder") && !p.includes(HEARD_UNSEEN) && !p.includes(REVEAL_MOVES), at);
          assert.ok(!p.includes(ACTED_STAGINGS.walk.clip) && !p.includes(ACTED_STAGINGS.walk.camera || "(no camera)"), at);
          assert.ok(p.includes("Neither Dagny nor Ylva smiles at any moment: both faces show fear."), at);
          continue;
        }
        assert.ok(p.includes(`This happens once, and it is the shot: ${said}`), at);
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
  assert.ok(one.startsWith(`${HEARD_OPEN} ${event} ${HEARD_UNSEEN} ${SOUND_NOT_SHOWN} ${HEARD_THEN} Dagny, the person on the LEFT side of the frame, says exactly this one line, ONCE, word for word, in accurate lip-sync, and nothing else: "${line}".`), one);
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
  assert.ok(knocks.includes(`is IN the picture, seen the way the moment says it is seen, and well above the picture's bottom edge. ${HEARD_NOT_DRAWN} ${SOUND_NOT_DRAWN} Draw the instant it BEGINS`));
  assert.ok(HEARD_NOT_DRAWN.startsWith("What is HEARD in this moment is not drawn: nothing in the picture makes that sound"));
  for (const act of ["Dagny knocks on the wall twice while Ylva holds the lamp.", "Ylva pulls the drawer open while Dagny grips the torch.", "The phone on the hall table rings as Dagny and Ylva stare at each other."]) {
    assert.ok(!stagedTwoShot({ staging: "depth", ...parts, act }).includes(HEARD_NOT_DRAWN), act);
  }
  assert.ok(read("app", "lib", "film-dialogue.server.ts").includes("At this moment: ${now}${unheard} ${NO_TEXT}`"), "a re-anchor drawn at that moment is told so too");
  // a reply in the same shot; a line with no name on it
  const two = heardTalk({ event, speaker: "Dagny", side: "left", line: "Did you hear that?", deliver, reply: { speaker: "Ylva", side: "right", line: "It came from the wall." } });
  assert.ok(two.includes("FIRST Dagny (on the left side of the frame) says: \"Did you hear that?\". THEN Ylva (on the right side) replies: \"It came from the wall.\"") && two.includes("Apart from that sound there are exactly TWO voices, Dagny's and then Ylva's"));
  const anon = heardTalk({ event, line: "Did you hear that?", deliver });
  assert.ok(anon.startsWith(`${HEARD_OPEN} ${event} ${SOUND_NOT_SHOWN} ${HEARD_THEN} Then ONE voice says this line, ONCE, word for word`));
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
  assert.ok(eng.includes("const heard = !silent && chainStaging && !implied && !revealed ? heardIn(eventAt(i), [spkA, spkB, ...castActors.map((c) => c.name)]) : null;"), "a staged picture in a film whose shots happen: where the scene is told at all (and never a reveal that could not be drawn — its words are not said)");
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
  const seen = engine.indexOf("(tmpl.key === \"horror\" ? `${SEEN_WHEN_SEEN}\\n${SEEN_AT_THE_END}\\n` : \"\")");
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

test("the last shot of a horror film: the SAME place, the thing BARELY seen and plainly wrong, close behind them — never a whole arm at the edge", () => {
  // the writer: the same WHERE, letter for letter — never another room; barely seen; its wrongness in words; slow; afraid
  for (const rule of [
    "It is in the SAME PLACE as the shot before it — its WHERE is the same words, letter for letter",
    "never in another room; the film draws it into that place's own picture",
    "BARELY: only a part of it, the way a horror film shows it — at a door, the door eased open a hand's width on the dark and a tall shape in the gap with only its face in the light; at a window, its face close to the dark glass, OUTSIDE, the glass whole; in a wall (only when it is IN the wall), its FACE pressed into a hole broken in the plaster, one eye catching the light; anywhere else, a tall shape standing in the dark with only its face in the light — never a hand, an arm or a body reaching out into the light — never at the edge of the picture",
    "WHERE ITS SOUND CAME FROM — at the door it knocked at, at the window it knocked on, in the wall only when the story has it IN the wall, or right behind one of them in the dark",
    "Say its one or two wrongnesses in so many words (skin like old candle wax; an eye open far too wide that never blinks; a face a little too high up) — never just \"wrong\" or \"strange\".",
    "what HAPPENS in that shot is IT, SLOWLY and IN PLACE: its eye turns to them, or its head tilts — it never comes out of where it is, never comes nearer, never reaches for anybody — and the two FREEZE, and one of them slowly turns to it.",
    "Neither of the two smiles — they are afraid of it — unless that smile IS the horror and the VISUAL says so.",
  ]) assert.ok(SEEN_AT_THE_END.includes(rule), rule);
  // (told "it moves a little, it is nearer than it was", the third live film's writer brought the fingers out of the
  //  hole, and the engine made them a big hand reaching at the lens)
  assert.ok(!SEEN_AT_THE_END.includes("nearer than it was") && !/fingers|joint too many/.test(SEEN_AT_THE_END));
  // what of it shows: in a WALL, its face — whatever part of it the words name (a hand at the edge of a hole is a
  // hand about to reach, and the engine finishes the reach); anywhere else, a figure in the dark
  assert.equal(revealPart("In a gap behind June a pale face presses forward, one eye watching Peggy."), "face");
  assert.equal(revealPart("Behind Peggy, a pale hand pushes out through a split in the wallpaper and reaches toward her hair."), "face");
  assert.equal(revealPart("Long fingers curl round the edge as a face presses into the gap."), "face");
  assert.equal(revealPart("Long grey fingers with one joint too many curl out of a fresh hole in the plaster between Colette and Prudence, creeping nearer to Prudence's hair."), "face", "THE THIRD LIVE FILM'S KIND OF SCENE");
  assert.equal(revealPart("In the dark corner behind June something tall stands perfectly still."), "figure");
  // (a doorway is a door: what comes from one is found in its gap — the door eased open on the dark)
  assert.equal(revealPart("A hand reaches out of the dark doorway behind Peggy."), "door");
  assert.deepEqual(Object.keys(REVEAL_PARTS).sort(), ["door", "face", "figure", "window"], "the fingers form drew right and moved wrong: it is not drawn any more");
  // THE OWNER, 2026-11-24, of a boy's film whose werewolf hung half out of the parents' wall: "what the fuck is that
  // plot?" — a knock FROM a wall is not a thing IN it; a creature the maker chose is never in a wall at all
  assert.equal(revealPart("Three slow knocks echo from inside the hallway wall as Dariusz and Marisol run into the dim bedroom."), "face", "inside the wall: the knocks are IN it");
  assert.equal(revealPart("Three slow knocks echo from inside the hallway wall; in the dark behind them, Howl is there.", { creature: true }), "figure");
  assert.equal(revealPart("Three slow knocks on the bedroom door as they freeze."), "door");
  assert.equal(revealPart("Three slow knocks on the window glass as they freeze."), "window");
  assert.equal(revealPart("Knocks on the window; a hole in the plaster splits open beside Dana."), "face", "a hole IN the plaster is in the wall");
  assert.ok(REVEAL_PARTS.window.seen.includes("OUTSIDE the window") && REVEAL_PARTS.window.moves.includes("stays OUTSIDE the glass"));
  assert.ok(REVEAL_PARTS.door.seen.includes("the door has eased open a hand's width on the dark") && REVEAL_PARTS.door.moves.includes("never steps through"));
  // a creature the maker chose is drawn as ITSELF: no made-up wrongness painted on it
  const wolf = revealPicture({ moment: "Knocks on the bedroom door; Howl is there.", sides: [{ name: "Ana", side: "left" }], creature: true });
  assert.ok(wolf.includes("At the door the two are facing") && !wolf.includes("What is wrong with it"));
  assert.equal(revealClip("Knocks on the bedroom door.", { creature: true }), `${REVEAL_PARTS.door.clip} ${REVEAL_PARTS.door.moves}`);
  const mood = "Every living person in it looks tense, wary or afraid — nobody smiles, grins or laughs.";
  const sides = [{ name: "Peggy", side: "left" }, { name: "June", side: "right" }];
  // THE LIVE FILMS' KIND OF SCENE (a hand reaching out of the wallpaper toward the older one): drawn as a FACE in
  // a hole broken in real plaster, close behind HER — told who she is by her side of the picture — and told that
  // no hand of it shows, since the scene's own words (given whole) name one
  const arm = "Behind Peggy, a pale hand pushes out through a split in the wallpaper and reaches slowly toward her hair; June keeps folding, she has not seen it.";
  const p = revealPicture({ moment: arm, mood, sides });
  assert.ok(p.startsWith("Edit this photo, a frame from a live-action horror film. Keep the camera and the framing, every window, door and lamp, the furniture and both people exactly as they are, each where they stand, with the same faces, hair and clothes. Peggy is the one on the left; June is the one on the right."));
  assert.ok(p.includes(REVEAL_DIM), "in light that has dimmed: in the place's ordinary light the thing read as stuck on");
  assert.ok(p.includes(`(its words say WHAT it is and WHERE; never how much of it shows): ${arm} Show it like this, and no more of it: In the wall close behind Peggy, the one on the left, at the height of a head — not over a window or a door, well inside the picture — the plaster has been broken open from inside into a ragged hole: torn wallpaper curling outward, crumbled plaster and splintered wooden lath at its edges, deep black inside; ${REVEAL_PARTS.face.seen}; only that FACE shows — no hand, no fingers and no arm of it anywhere in the picture.`));
  assert.ok(p.includes(`What is wrong with it: ${REVEAL_PARTS.face.wrong}.`));
  assert.ok(!revealPicture({ moment: "In a black gap torn in the wallpaper a pale face presses forward, watching them.", sides }).includes("no hand, no fingers"), "said only when the words name a hand");
  assert.ok(REVEAL_PARTS.face.seen.includes("a hand's width back inside it, half hidden by its broken edge, is a FACE that is not quite human: only one eye and a sliver of cheek catch the light"));
  assert.ok(REVEAL_PARTS.face.wrong.includes("the eye is open far too wide, the white showing all the way round it, and it does not blink") && !/\bwet\b/.test(REVEAL_PARTS.face.wrong), "(told 'wet', the model drew a crying woman)");
  assert.ok(p.includes(CREATURE_REAL), "CAUGHT on a real camera, a practical effect, never CGI — story-picture.ts's own words");
  assert.ok(p.includes(TAKE_HIDDEN), "mostly HIDDEN — take.ts's own words");
  assert.ok(p.includes("Both have frozen where they stand, faces drained, and neither looks at the camera.") && p.includes(` ${mood} `));
  assert.ok(!p.includes(TAKE_WRONG), "(told found footage's 'waxy, bloodless, eyes sunk in dark sockets', the model drew a zombie)");
  assert.ok(p.length < 2400, "inside what both editors read");
  // with no place named for it, behind the one on the right; not at a wall, no hole — a figure in the dark
  assert.ok(revealPicture({ moment: "In a black gap torn in the wallpaper a pale face presses forward, watching them.", sides }).includes("In the wall close behind June, the one on the right,"));
  const corner = revealPicture({ moment: "In the dark corner something tall stands perfectly still.", sides });
  assert.ok(corner.includes(`In the dark close behind June, the one on the right, well inside the picture, ${REVEAL_PARTS.figure.seen}.`) && !corner.includes("plaster"));
  assert.ok(REVEAL_PARTS.figure.wrong.includes("never a zombie, never a skull, never a mask"));
  assert.equal(revealPicture({ moment: "" }), "");
  assert.equal(revealPicture({ moment: null }), "");
  // reused, not a third copy: the recipe's words are imported, never written out again here
  const src = read("app", "lib", "acted-staging.ts");
  assert.ok(src.includes("import { CREATURE_REAL, DRESSED, SHADOW_SHAPE, TODAY_LOOK, shadowNote } from \"./story-picture.ts\";") && src.includes("import { TAKE_HIDDEN } from \"./take.ts\";"));
  for (const words of ["a practical-effects creature as a 1970s horror film would build it", "we see less than we want to"]) assert.ok(!src.includes(words), words);
  // the clip: it moves only a little, in place, and the two FREEZE and one turns to it — whether or not a line was
  // written for it. Not drawn here (a frame the maker approved, a place of its own): the scene's words, held in place
  assert.equal(REVEAL_MOVES, "What is seen moves only a little, SLOWLY and IN PLACE — never a jump, a lunge or a reach, never out of where it is, never toward the camera — and it stays solid and real, half in shadow.");
  assert.equal(REVEAL_REACT, "Both of them FREEZE where they are — whatever their hands were doing stops dead — and then, slowly, one of them turns to look at it and stares; nobody screams, nobody runs, nobody looks at the camera.");
  const live = clipRules({ cartoon: false, sing: false });
  const moment = "Behind June, the tips of long grey fingers curl over the broken edge of a hole in the plaster; Peggy sees them, June has not turned round.";
  assert.ok(silentRules(live, { staging: "depth", event: moment, reveal: true }).lookShort.includes(`${REVEAL_MOVES} ${REVEAL_REACT}`));
  assert.ok(!silentRules(live, { staging: "depth", event: moment }).look.includes(REVEAL_MOVES));
  assert.ok(stagedRules(live, { staging: "depth", event: moment, reveal: true }).lookShort.endsWith(`As the line is spoken, this happens once: ${moment} ${REVEAL_MOVES} ${REVEAL_REACT}`));
  assert.ok(!stagedRules(live, { staging: "depth", reveal: true }).look.includes(REVEAL_MOVES), "nothing written to happen: nothing to move");
  // DRAWN HERE (the reveal picture came): told what is in that picture and the one thing it does, in place — never
  // the scene's own words, which said "curl over", "creeping nearer", "pushes out"; the two stay where they are; the
  // camera does not travel, even in a staging whose camera does
  for (const staging of [...KEYS, null] as Array<ActedStaging | null>) {
    for (const r of [silentRules(live, { staging, event: moment, reveal: true, drawn: true }), stagedRules(live, { staging: staging || "depth", event: moment, reveal: true, drawn: true })]) {
      for (const note of [r.look, r.lookTight, r.lookShort]) {
        assert.ok(note.includes(`${REVEAL_PARTS.face.clip} ${REVEAL_PARTS.face.moves} ${REVEAL_REACT}`) && note.includes(REVEAL_STAY), `${staging}: ${note}`);
        assert.ok(!note.includes(moment) && !/fingers curl|turned round|Peggy|June/.test(note) && !note.includes(REVEAL_MOVES), `${staging}: ${note}`);
      }
      assert.ok(!r.steady.includes(ACTED_STAGINGS.walk.camera || "(no camera)") && !r.look.includes(ACTED_STAGINGS.walk.clip), `${staging}: the camera stays where it is`);
    }
  }
  // …in the exact words of each form: one small thing, in place — never out, never nearer, never at the lens
  assert.equal(REVEAL_PARTS.face.moves, "Only its EYE moves: it slides slowly round to look at them, and it never blinks. The face stays exactly where it is, back inside the hole — it never leans out, never pushes through, never grows, and its mouth stays shut. Nothing comes out of the wall, and nothing comes toward the camera.");
  assert.equal(REVEAL_PARTS.figure.moves, "Only its HEAD moves: it tilts slowly to one side. It never takes a step, never raises its arms, never comes nearer, never grows, and nothing comes toward the camera.");
  assert.equal(revealClip("In the dark corner behind June something tall stands perfectly still."), `${REVEAL_PARTS.figure.clip} ${REVEAL_PARTS.figure.moves}`);
  for (const part of Object.values(REVEAL_PARTS)) assert.ok(quoteFree(part.clip) && quoteFree(part.moves) && /toward the camera\.$/.test(part.moves), part.moves);
  // a sound-first shot is never what the reveal's line opens on: its clip is told what is in its picture instead
  const heardReveal = stagedRules(live, { staging: "depth", event: "Three slow knocks from inside the wall, then pale fingers curl over the edge of the hole.", heard: true, reveal: true, drawn: true });
  assert.ok(heardReveal.lookShort.includes(REVEAL_PARTS.face.clip) && heardReveal.steady === live.steady, "no sound rule: it is not a sound shot");
  // …and when its picture could not be drawn: the clip is NOT told what it is (told to show a thing its picture
  // has not got, the engine draws one of its own — the floating hand), and the two react to something never seen
  for (const r of [silentRules(live, { staging: "depth", event: moment, reveal: true, implied: true }), stagedRules(live, { staging: "depth", event: moment, reveal: true, implied: true })]) {
    for (const note of [r.look, r.lookTight, r.lookShort]) assert.ok(note.includes(REVEAL_UNSEEN_REACT) && !/fingers|plaster|hole/.test(note), note);
  }
  assert.ok(REVEAL_UNSEEN_REACT.endsWith("Nothing new appears anywhere in the picture."));
  // the film: the last shot of a staged horror film whose shots happen, in the same place, on a staged master —
  // never over a frame the maker approved — drawn on the stronger editor first, the more permissive one after
  const eng = read("app", "lib", "film-dialogue.server.ts");
  assert.ok(eng.includes("const lastHorror = staged && horror && i > 0 && i === treatment.scenes.length - 1 && !!eventAt(i);"));
  const at = eng.indexOf("if (!seedAbs && lastHorror && master?.url && stagingOf(master)) {");
  assert.ok(at > eng.indexOf("let seedAbs = abs(approvedFrames[i]);") && eng.indexOf("if (!seedAbs && master?.url) {", at) > at);
  assert.ok(eng.includes("const askOne = revealPicture({ moment: eventAt(i), mood: tmpl.faceMood, sides: [spkA, spkB].filter((n): n is string => !!n).map((n) => ({ name: n, side: sideFor(n) })), creature: !!(thing && thingFace), seen, outdoors });"));
  const pro = eng.indexOf("[\"google/nano-banana-pro\", { prompt: ask, image_input: [abs(master.url), ...(thing && thingFace ? [thingFace] : [])], aspect_ratio: aspect, output_format: \"jpg\", resolution: \"2K\" }],");
  const kontext = eng.indexOf("[\"black-forest-labs/flux-kontext-pro\", { prompt: askOne, input_image: abs(master.url), aspect_ratio: aspect, output_format: \"jpg\", output_quality: 92 }],");
  assert.ok(pro > at && kontext > pro, "the place's master is the first reference picture, on nano-banana-pro, then flux-kontext-pro");
  // A CREATURE THE MAKER CHOSE that is not one of the two, and that the last shot finds, is drawn from its own
  // picture — the second picture on the stronger editor; the permissive one (one picture) is never told of it
  assert.ok(eng.includes("const thing = castActors.find((c) => !!c.faceUrl && isCreature(c) && ![spkA, spkB].some((s) => !!s && nameTok(s) === nameTok(c.name)) && (scene.visual || \"\").toLowerCase().includes(c.name.trim().toLowerCase()));"));
  assert.ok(eng.includes("const ask = askOne && thing && thingFace") && eng.includes(": askOne;"));
  assert.ok(eng.includes("try { seedAbs = abs(await removeLetterbox(await persistRemote(await repRun(model, input, 180_000), \"jpg\"))); }"));
  assert.ok(eng.includes("const implied = lastHorror && !revealed && !approvedFrames[i];"));
  assert.ok(eng.includes("playRules = silentRules(rules, { staging: chainStaging, event: eventAt(i), eventMax: i === treatment.scenes.length - 1 ? EVENT_MAX_LAST : undefined, sides, unseen, reveal: lastHorror, drawn: revealed, creature: revealedCreature, outdoors, seen: revealSeen, implied, face: scared });"));
  assert.ok(eng.includes("others: !turnB && otherName && oSide ? [{ name: otherName, side: oSide }] : [], heard: !!heard, reveal: lastHorror, drawn: revealed, creature: revealedCreature, outdoors, seen: revealSeen, implied });"));
});

/* ---- A CUT TO ANOTHER PLACE IS A STRAIGHT CUT ---- */

test("a cut to another place, and to the reveal, is a straight cut; a shot that continues the last keeps its tiny blend", () => {
  const eng = read("app", "lib", "film-dialogue.server.ts");
  assert.ok(eng.includes("const seams: SeamKind[] = clips.map((_, i) => (hardSeams?.has(i) ? \"hard\" : softSeams?.has(i) ? \"reframe\" : \"soft\"));"), "a straight cut wins over both dissolves");
  assert.deepEqual(SEAM_FRAMES, { soft: 5, reframe: 10, hard: 0 }, "dissolves of whole frames (0.167 s, 0.333 s); a straight cut none");
  assert.ok(eng.includes("if (i > 0 && !chained && (tr === \"location\" || revealed)) hardSeams.add(i);"));
  assert.ok(eng.includes("const filmFrames = await assembleTestMovie(clips, outPath, jobId, softSeams, aspect, hardSeams);"));
  assert.ok(eng.includes("export async function assembleTestMovie(clips: string[], outPath: string, jobId?: string, softSeams?: Set<number>, aspect: \"9:16\" | \"16:9\" | \"1:1\" = \"9:16\", hardSeams?: Set<number>): Promise<number> {"), "optional: a caller that passes none cuts as before");
  assert.ok(eng.includes("...(hardSeams.has(i) ? { cut: \"hard\" } : {}),"), "kept on the piece, so a re-cut can keep it");
  assert.ok(!/HARD_CUT_SECONDS|fadeFor|buildXfade/.test(eng), "no one-frame dissolve left to miss");
});

/* ---- THE JOIN: EVERY SHOT'S PICTURE, AND ITS SOUND THE SAME LENGTH ----
 * knock4 (2026-11-24, "The Patient Wall"): picture 19.17 s, sound 24.17 s — the reveal gone from the picture, its
 * 5 s of sound playing over the last frame of the shot before. Each dissolve was placed by its clip's CONTAINER
 * length (the longer of picture and sound); a few hundredths of a second of sound past the picture moved the
 * one-frame cut into the reveal past the last frame of the shot before, and xfade never brought it in. */

const ffmpegOk = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0 && spawnSync("ffprobe", ["-version"], { encoding: "utf8" }).status === 0;
/** the ffmpegs to join on: the one on PATH, and the app's own ffmpeg-static when it is installed (two versions) */
const joiners = (() => {
  const out = ["ffmpeg"];
  try {
    const p = path.join(root, "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    if (fs.existsSync(p) && spawnSync(p, ["-version"], { encoding: "utf8" }).status === 0) out.push(p);
  } catch { /* the one on PATH */ }
  return out;
})();
const SCALE_169 = "crop=iw:ih*0.90:0:0,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,fps=30";
/** a stand-in shot: `colour` filling a 1280x720 picture at 24 fps for `picture` s, a tone for `sound` s (0: none) */
const standIn = (dir: string, name: string, colour: string, picture: number, sound: number): string => {
  const out = path.join(dir, `${name}.mp4`);
  const args = ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${colour}:s=1280x720:r=24:d=${picture}`];
  if (sound > 0) args.push("-f", "lavfi", "-i", `sine=frequency=440:sample_rate=44100:duration=${sound}`);
  args.push("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", ...(sound > 0 ? ["-c:a", "aac"] : []), out);
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return out;
};
const streamsOf = (file: string): { video: number; audio: number | null } => {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  const m = Object.fromEntries(r.stdout.trim().split(/\r?\n/).map((l) => { const [t, d] = l.split(","); return [t, parseFloat(d)]; }));
  return { video: m.video, audio: m.audio ?? null };
};
/** join stand-ins the way assembleTestMovie does (pictureFrames: the PICTURE's length, at 30 fps) */
const SCALE_916 = "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30";
/** join stand-ins the way film-join.server.ts → joinWhole does: each clip's length by clipFrames (its picture, or
 *  the longer of its picture and its sound), its last frame held as long as that needs */
const joinOn = (ff: string, dir: string, name: string, clips: string[], seams: Seam[], dissolve = true, o: { length?: "picture" | "longer"; prep?: string } = {}) => {
  const sizes = clips.map((c) => { const s = streamsOf(c); return { picture: s.video, frames: clipFrames({ picture: s.video, sound: s.audio, length: o.length }) }; });
  const frames = sizes.map((s) => s.frames);
  const hold = Math.max(...sizes.map((s) => s.frames / FILM_FPS - s.picture)) + 1;
  const silent = clips.map((c) => streamsOf(c).audio === null);
  const plan = joinGraph({ frames, seams, prep: o.prep || SCALE_169, silent, dissolve, hold });
  const film = path.join(dir, `${name}.mp4`);
  const r = spawnSync(ff, ["-v", "error", "-y", ...clips.flatMap((c) => ["-i", c]), "-filter_complex", plan.graph, "-map", "[vc]", "-map", "[ac]", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", film], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  // every frame read back as one colour: which shots' pictures are in the film, and how many frames of each
  const raw = spawnSync(ff, ["-v", "error", "-i", film, "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { encoding: "buffer", maxBuffer: 1 << 26 }).stdout;
  const seen = { red: 0, green: 0, blue: 0, white: 0, mixed: 0 };
  for (let k = 0; k + 2 < raw.length; k += 3) {
    const [r0, g, b] = [raw[k], raw[k + 1], raw[k + 2]];
    if (r0 > 200 && g > 200 && b > 200) seen.white++; else if (r0 > 200 && g < 60 && b < 60) seen.red++; else if (g > 100 && r0 < 60 && b < 60) seen.green++; else if (b > 200 && r0 < 60 && g < 60) seen.blue++; else seen.mixed++;
  }
  return { plan, streams: streamsOf(film), seen, check: joinCheck({ ...streamsOf(film), frames: plan.frames }) };
};

test("THE FOURTH FILM'S REVEAL: shots whose sound runs past their picture never take the next shot out of the film", { skip: !ffmpegOk }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "join-"));
  try {
    // knock4's shapes: three shots with 30 ms more sound than picture (on the old join, enough to drop what follows a
    // straight cut — on ffmpeg 6.1.1 and 8.1.2 alike), then the 5 s silent reveal, cut straight
    const shots = [standIn(dir, "s1", "red", 6.0, 6.03), standIn(dir, "s2", "green", 4.5, 4.53), standIn(dir, "s3", "blue", 4.0, 4.03), standIn(dir, "rv", "white", 5.0, 5.0)];
    for (const ff of joiners) {
      for (const dissolve of [true, false]) {
        const j = joinOn(ff, dir, `knock4-${joiners.indexOf(ff)}-${dissolve}`, shots, [null, "soft", "reframe", "hard"], dissolve);
        const at = `${ff} dissolve=${dissolve}`;
        assert.ok(j.check.ok, `${at}: ${j.check.why}`);
        assert.equal(j.seen.white, 150, `${at}: the reveal, all 5 s of it, is in the picture — ${JSON.stringify(j.seen)}`);
        assert.ok(j.seen.red > 150 && j.seen.green > 100 && j.seen.blue > 100, `${at}: ${JSON.stringify(j.seen)}`);
        assert.ok(Math.abs(j.streams.video - (j.streams.audio ?? 0)) <= JOIN_TOLERANCE, `${at}: picture ${j.streams.video}, sound ${j.streams.audio}`);
        assert.equal(j.plan.frames, dissolve ? 180 + 135 + 120 + 150 - 5 - 10 : 180 + 135 + 120 + 150, at);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a shot whose sound is 1.5 s longer than its picture, one with no sound, one with too little: every picture in, the sound cut to it", { skip: !ffmpegOk }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "join-"));
  try {
    const three = [standIn(dir, "a", "red", 5.0, 5.0), standIn(dir, "b", "green", 4.0, 5.5), standIn(dir, "c", "blue", 5.0, 5.0)];
    for (const ff of joiners) {
      for (const seams of [[null, "soft", "soft"], [null, "hard", "hard"], [null, "reframe", "hard"]] as Array<Array<SeamKind | null>>) {
        const j = joinOn(ff, dir, `three-${joiners.indexOf(ff)}-${seams.join("")}`, three, seams);
        const at = `${ff} ${seams.join(",")}`;
        assert.ok(j.check.ok, `${at}: ${j.check.why}`);
        assert.ok(j.seen.red >= 140 && j.seen.green >= 105 && j.seen.blue >= 140, `${at}: all three pictures — ${JSON.stringify(j.seen)}`);
        assert.ok(Math.abs(j.streams.video - (j.streams.audio ?? 0)) <= JOIN_TOLERANCE, `${at}: picture ${j.streams.video}, sound ${j.streams.audio}`);
      }
      // a shot with NO sound stream gets its length of silence; one whose sound stops early is padded to its picture
      const odd = [standIn(dir, "d", "red", 5.0, 4.2), standIn(dir, "e", "green", 4.0, 0), standIn(dir, "f", "white", 5.0, 5.0)];
      const j = joinOn(ff, dir, `odd-${joiners.indexOf(ff)}`, odd, [null, "soft", "hard"]);
      assert.ok(j.check.ok && j.seen.white === 150 && j.seen.green >= 105, `${ff}: ${j.check.why} ${JSON.stringify(j.seen)}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a straight cut is a join: not one frame of the two rooms mixed — a dissolve still mixes them", { skip: !ffmpegOk }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "join-"));
  try {
    const two = [standIn(dir, "a", "red", 2.0, 2.0), standIn(dir, "b", "blue", 2.0, 2.0)];
    for (const ff of joiners) {
      const cut = joinOn(ff, dir, `cut-${joiners.indexOf(ff)}`, two, [null, "hard"]);
      assert.equal(cut.seen.mixed, 0, `${ff}: a straight cut — ${JSON.stringify(cut.seen)}`);
      assert.deepEqual([cut.seen.red, cut.seen.blue], [60, 60], ff);
      const dissolve = joinOn(ff, dir, `dissolve-${joiners.indexOf(ff)}`, two, [null, "reframe"]);
      assert.ok(dissolve.seen.mixed >= 4, `${ff}: …where a dissolve mixes the two — ${JSON.stringify(dissolve.seen)}`);
      assert.equal(dissolve.plan.frames, 110, `${ff}: 60 + 60 frames less the 10 they share`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a film whose picture ends before its sound is never shipped: measured after the join and again at the end, and the job fails", () => {
  // knock4's own numbers, and a picture that stops short of what its shots add up to
  assert.equal(joinCheck({ video: 19.166667, audio: 24.171995 }).ok, false);
  assert.match(joinCheck({ video: 19.166667, audio: 24.171995 }).why, /picture runs 19\.167 s and its sound 24\.172 s/);
  assert.equal(joinCheck({ video: 19.166667, audio: 19.18, frames: 725 }).ok, false, "the picture is 5 s short of its shots");
  assert.equal(joinCheck({ video: 24.166667, audio: 24.18, frames: 725 }).ok, true);
  assert.equal(joinCheck({ video: 24.166667, audio: null, frames: 725 }).ok, true, "no sound stream: the picture alone is measured");
  assert.equal(joinCheck({ video: 24.166667, audio: NaN }).ok, false, "a sound stream whose length cannot be read never passes");
  assert.equal(joinCheck({ video: 0, audio: 5 }).ok, false);
  assert.ok(JOIN_TOLERANCE > 2 / FILM_FPS && JOIN_TOLERANCE < 0.1, "two frames and one block of sound");
  const eng = read("app", "lib", "film-dialogue.server.ts");
  // the acted film's join is film-join.server.ts's, every shot as long as its PICTURE
  assert.ok(eng.includes("return joinWhole({ clips, outPath, prep: SCALE, seams, length: \"picture\", encode: ENCODE, label: \"[testmovie]\", beat });"));
  const join = read("app", "lib", "film-join.server.ts");
  // every shot measured by its PICTURE, never by the file's longer stream
  assert.ok(join.includes("[\"-select_streams\", \"v:0\", \"-show_entries\", \"stream=duration,nb_frames,avg_frame_rate\"]"));
  assert.ok(join.includes("return { picture, frames: clipFrames({ picture, sound: o.length === \"longer\" ? streamSeconds(c).audio : null, length: o.length }) };"));
  // joined with dissolves, then the plain way — each MEASURED — and otherwise the job fails
  assert.ok(join.includes("? joinCheck({ ...streamSeconds(outPath), frames: plan.frames })"));
  assert.ok(join.includes("throw new Error(`${label} the film could not be joined whole — ${failed.join(\"; \")}`);"));
  assert.ok(!/xfade|acrossfade|ffprobeDuration\(c\)/.test(join), "no dissolve placed by a measured length: the graph is joinGraph's");
  // …and measured once more after its sound is levelled and its captions drawn, before it is stored
  const end = eng.indexOf("const finished = joinCheck({ ...streamSeconds(outPath), frames: filmFrames });");
  assert.ok(end > eng.indexOf("captioned = await captionFilm({") && end < eng.indexOf("const outBuf = fs.readFileSync(outPath);"));
  assert.ok(eng.includes("if (!finished.ok) throw new Error(`[testmovie] the finished film is not whole after its sound and captions — ${finished.why}`);"));
  // the captions are timed by the same lengths the join used
  assert.ok(eng.includes("clipDurs: clips.map((c) => { try { return pictureFrames(c) / FILM_FPS; } catch { return 0; } }),"));
});

/* ---- THE AVATAR DIALOGUE'S JOIN: THE SAME, EACH CLIP AS LONG AS ITS LINE ----
 * film-dialogue-avatar.server.ts placed its 0.25 s dissolves by each clip's CONTAINER length, as the acted film did;
 * its clips come from lip-sync engines, which can hand back a picture that stops before its line does — past
 * 0.25 s of that, every later clip's picture was gone. Its clips are now as long as the LONGER of picture and line
 * (the line never cut, the last frame held), joined by film-join.server.ts, measured, or the job fails. */

test("how long a clip is in the film: its picture — or, for the avatar dialogue, the longer of its picture and its line", () => {
  assert.equal(clipFrames({ picture: 4.0, sound: 5.5 }), 120);
  assert.equal(clipFrames({ picture: 4.0, sound: 5.5, length: "picture" }), 120);
  assert.equal(clipFrames({ picture: 4.0, sound: 5.5, length: "longer" }), 165);
  assert.equal(clipFrames({ picture: 4.0, sound: 3.0, length: "longer" }), 120);
  assert.equal(clipFrames({ picture: 4.0, sound: null, length: "longer" }), 120);
  assert.equal(clipFrames({ picture: 0 }), 0);
  // a seam may be a dissolve of so many frames (the avatar's 0.25 s: 8 of them), 0 a straight join
  const plan = joinGraph({ frames: [150, 120], seams: [null, 8], prep: "fps=30" });
  assert.equal(plan.frames, 262);
  assert.ok(plan.graph.includes("xfade=transition=fade:duration=0.266667:offset=4.733333") && plan.graph.includes("acrossfade=d=0.266667"));
  assert.equal(joinGraph({ frames: [150, 120], seams: [null, 0], prep: "fps=30" }).frames, 270);
  // …and a clip's last frame may be held as long as its length needs
  assert.ok(joinGraph({ frames: [165], prep: "fps=30", hold: 2.5 }).graph.includes("tpad=stop_mode=clone:stop_duration=3,trim=end_frame=165,"));
  assert.ok(joinGraph({ frames: [300], prep: "fps=30", hold: 6.2 }).graph.includes("tpad=stop_mode=clone:stop_duration=7,"));
  // the avatar dialogue's join is film-join.server.ts's: 0.25 s dissolves as 8 frames, each clip as long as its line
  const av = read("app", "lib", "film-dialogue-avatar.server.ts");
  assert.ok(av.includes("export const AVATAR_DISSOLVE_FRAMES = Math.round(0.25 * FILM_FPS);"));
  assert.ok(av.includes("return joinWhole({ clips, outPath, prep: SCALE, seams: clips.map(() => AVATAR_DISSOLVE_FRAMES), length: \"longer\", encode: ENCODE, label: \"[avatardialogue]\", beat });"));
  assert.ok(!/xfade=|acrossfade=|buildConcat|running \+ durs/.test(av), "no join of its own left");
});

test("the avatar dialogue: a clip whose line runs 1.5 s past its picture — every picture in, the whole line kept, its last frame held", { skip: !ffmpegOk }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "join-"));
  try {
    // three of its clips; the middle one's lip-sync stopped 1.5 s before its line did
    const three = [standIn(dir, "a", "red", 5.0, 5.0), standIn(dir, "b", "green", 4.0, 5.5), standIn(dir, "c", "blue", 5.0, 5.0)];
    for (const ff of joiners) {
      for (const dissolve of [true, false]) {
        const j = joinOn(ff, dir, `avatar-${joiners.indexOf(ff)}-${dissolve}`, three, [null, 8, 8], dissolve, { length: "longer", prep: SCALE_916 });
        const at = `${ff} dissolve=${dissolve}`;
        assert.ok(j.check.ok, `${at}: ${j.check.why}`);
        // every picture — the middle one its own 4 s and 1.5 s of its last frame, held while the line finishes
        assert.ok(j.seen.red >= 140 && j.seen.green >= 150 && j.seen.blue >= 140, `${at}: ${JSON.stringify(j.seen)}`);
        assert.ok(Math.abs(j.streams.video - (j.streams.audio ?? 0)) <= JOIN_TOLERANCE, `${at}: picture ${j.streams.video}, sound ${j.streams.audio}`);
        assert.equal(j.plan.frames, dissolve ? 150 + 165 + 150 - 8 - 8 : 150 + 165 + 150, at);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ---- PEOPLE WHO ARE RELATED ARE THE RIGHT AGES FOR IT ----
 * The owner, of the same film: "Also want to note in that video they are "sisters" but one of them is 130 and the
 * other looks 30". The writer's cast for that idea read "in her fifties" and "in her thirties". */

const SISTERS_IDEA = "Two sisters clearing out their late mother's house at night hear slow knocking inside the bedroom wall.";
const SISTERS_CAST = ["Peggy, a woman in her fifties with short grey hair, round glasses and a floral blouse", "June, a woman in her thirties with a long dark braid and a denim jacket"];
const SISTERS_LINES = ["PEGGY: Mum kept every letter we ever wrote her, every single one of them.", "JUNE: Peggy, did you hear that? That came from inside the wall, right behind the dresser."];

test("THE OWNER'S CASE: sisters written in their fifties and their thirties are caught — and never filmed so", () => {
  const p = castAgeProblem({ idea: SISTERS_IDEA, cast: SISTERS_CAST, lines: SISTERS_LINES });
  assert.ok(p, "caught");
  assert.equal(p!.relation, "siblings");
  assert.deepEqual(p!.ages.map((a) => [a.from, a.to, a.said]), [[50, 59, "fifties"], [30, 39, "thirties"]]);
  assert.equal(p!.older, 0);
  // asked for once more — both entries, the same people, ages that fit
  const ask = ageAsk(SISTERS_CAST, p!);
  assert.ok(ask.includes(`1. ${SISTERS_CAST[0]}\n2. ${SISTERS_CAST[1]}`) && ask.includes("In the story they are siblings — but their ages (fifties; thirties) cannot be: siblings are within about ten years of each other."));
  assert.ok(ask.includes("Keep each entry's NAME first and exactly as it is"));
  // a rewrite is taken only when it IS the two, by name, with ages that now fit
  const good = ["Peggy, a woman in her early fifties with short grey hair, round glasses and a floral blouse", "June, a woman in her late forties with a long dark braid and a denim jacket"];
  assert.deepEqual(takeAgeFix(SISTERS_CAST, good, { idea: SISTERS_IDEA, lines: SISTERS_LINES }), good);
  assert.equal(takeAgeFix(SISTERS_CAST, SISTERS_CAST, { idea: SISTERS_IDEA }), null, "still a broken pair");
  assert.equal(takeAgeFix(SISTERS_CAST, ["Margaret, a woman in her fifties", "June, a woman in her late forties"], { idea: SISTERS_IDEA }), null, "a renamed sister");
  assert.equal(takeAgeFix(SISTERS_CAST, [good[0]], { idea: SISTERS_IDEA }), null);
  assert.equal(takeAgeFix(SISTERS_CAST, ["Peggy, a woman with grey hair", "June, a woman with a braid"], { idea: SISTERS_IDEA }), null, "no ages said");
  assert.equal(takeAgeFix(SISTERS_CAST, "nope", { idea: SISTERS_IDEA }), null);
  // …and when no rewrite comes: put right here — only June's age words change, and they now fit
  const fixed = repairAges(SISTERS_CAST, p!);
  assert.deepEqual(fixed, [SISTERS_CAST[0], "June, a woman in her mid-forties with a long dark braid and a denim jacket"]);
  assert.equal(castAgeProblem({ idea: SISTERS_IDEA, cast: fixed, lines: SISTERS_LINES }), null);
});

test("which two are related is read only from words said of the pair — never of a third person they talk about", () => {
  // the owner's idea: "two sisters" — their late MOTHER's house, "Mum kept…", is somebody else
  assert.equal(relationOf({ idea: SISTERS_IDEA, cast: SISTERS_CAST, lines: SISTERS_LINES }), "siblings");
  assert.equal(relationOf({ idea: "A carer and a neighbour clear out their late mother's house.", cast: ["Ann, in her thirties", "Bo, in his sixties"], lines: ["ANN: Mum kept every letter."] }), null);
  assert.equal(relationOf({ idea: "A woman and her neighbour hear knocking.", cast: ["Ann, in her thirties", "Bo, Ann's older brother, in his forties"] }), "siblings", "said of the other one BY NAME");
  assert.equal(relationOf({ idea: "A woman and her neighbour hear knocking.", cast: ["Ann, in her thirties", "Bo, her older brother, in his forties"] }), "siblings", "said right after the name");
  assert.equal(relationOf({ idea: "A woman and her neighbour hear knocking.", cast: ["Ann, in her thirties", "Bo, June's older brother, in his forties"] }), null, "June is not one of the two");
  assert.equal(relationOf({ idea: "A woman and her neighbour hear knocking.", cast: ["Ann, in her thirties, still searching for her brother", "Bo, in his sixties"] }), null, "HER brother, somewhere in her own entry, is somebody else");
  assert.equal(relationOf({ idea: "A haunted lighthouse.", cast: ["Ann, in her thirties", "Bo, in his forties"], lines: ["BO: You're my little sister, Ann. I won't leave you here."] }), "siblings");
  assert.equal(relationOf({ idea: "A haunted lighthouse.", cast: ["Ann, in her thirties", "Bo, in his forties"], lines: ["ANN: We're twins, Bo. I'd know if it was you."] }), "twins");
  assert.equal(relationOf({ idea: "A haunted lighthouse.", cast: ["Ann, in her thirties", "Bo, in his sixties"], lines: ["BO: My brother went missing down there.", "ANN: The twins from the village saw it too.", "BO: Your mother never came back."] }), null, "lines about anybody else are not read");
  assert.equal(relationOf({ idea: "Two brothers hear their mother calling from the cellar." }), "siblings", "THEIR mother is never one of the two");
  assert.equal(relationOf({ idea: "My sister and I spend a night in the old mill." }), "siblings");
  assert.equal(relationOf({ idea: "A mother of twins hears crying in the attic." }), null);
  assert.equal(relationOf({ idea: "A mother and her daughter hear knocking." }), "parent");
  assert.equal(relationOf({ idea: "A widow and her late husband's brother.", cast: ["Ann, in her sixties", "Bo, in his sixties"] }), null, "her late husband's brother is family to somebody else — an in-law, not her brother");
  assert.equal(relationOf({ idea: "A widow and her brother.", cast: ["Ann, in her sixties", "Bo, in his sixties"] }), "siblings");
  assert.equal(relationOf({ idea: "Twin brothers find a door in the cellar." }), "twins");
  assert.equal(relationOf({ idea: "A grandmother and her grandson." }), "grandparent");
  assert.equal(relationOf({ idea: "A husband and wife buy an old farmhouse." }), "couple");
  assert.equal(relationOf({ idea: "Two cousins inherit a boat." }), "cousins");
  assert.equal(relationOf({ idea: "Two friends at a diner." }), null);
});

test("each relation's ages: a clear break is caught, a near one is not, and the repair never makes a child of anybody", () => {
  for (const [idea, cast, broken] of [
    ["Two sisters", ["Ann, in her late forties", "Bea, in her early fifties"], false],
    ["Two sisters", ["Ann, an elderly woman", "Bea, a 30-year-old woman"], true],
    ["Twin brothers", ["Sam, in his early thirties", "Max, in his early thirties"], false],
    ["Twin brothers", ["Sam, in his early thirties", "Max, in his late thirties"], true],
    ["A married couple", ["Ivy, in her sixties", "Ned, in his twenties"], true],
    ["Two cousins", ["Ann, in her twenties", "Bea, in her fifties"], true],
    ["A mother and her daughter", ["Mara, in her forties", "Lily, in her twenties"], false],
    ["A mother and her daughter", ["Mara, in her forties", "Lily, in her late thirties"], true],
    ["A grandmother and her grandson", ["Edna, in her seventies", "Tom, in his late teens"], false],
    ["Two sisters", ["Ann, in her thirties", "Bea, with a braid"], false],
    ["Two friends", ["Ann, in her twenties", "Bea, in her seventies"], false],
  ] as Array<[string, string[], boolean]>) {
    const p = castAgeProblem({ idea, cast });
    assert.equal(!!p, broken, `${idea}: ${cast.join(" / ")}`);
    if (!p) continue;
    const fixed = repairAges(cast, p);
    assert.equal(castAgeProblem({ idea, cast: fixed }), null, `${idea}: ${fixed.join(" / ")}`);
    // only ONE entry's age words changed, and nobody was made younger than they were written
    assert.equal(fixed.filter((e, i) => e !== cast[i]).length, 1);
    fixed.forEach((e, i) => { const was = ageOf(cast[i])!, now = ageOf(e)!; assert.ok(now.from >= was.from || now.to >= was.from, `${cast[i]} → ${e}`); });
  }
  // a parent and child: the child keeps their age, the parent is made older (a horror cast is adults only)
  assert.deepEqual(repairAges(["Mara, in her forties", "Lily, in her late thirties"], castAgeProblem({ idea: "A mother and her daughter", cast: ["Mara, in her forties", "Lily, in her late thirties"] })!), ["Mara, in her mid-sixties", "Lily, in her late thirties"]);
  // the words an age is said in
  assert.deepEqual(["Ruth, a 30-year-old nurse", "Ana, aged 27", "Cal, a middle-aged man", "Dee, in her early thirties", "Eli, in his late 40s", "Fay, no age said"].map((e) => { const a = ageOf(e); return a ? [a.from, a.to] : null; }), [[30, 30], [27, 27], [40, 60], [30, 33], [46, 49], null]);
  assert.equal(repairAges(["Ann, an elderly woman", "Bea, an elderly woman"], { relation: "siblings", ages: [{ from: 65, to: 90, said: "elderly" }, { from: 13, to: 19, said: "elderly" }], older: 0 })[1], "Bea, a 61-year-old woman", "an article that fits the new words");
});

test("the writer is told: each one's age said plainly, and related people the right ages for it — and the cast is checked after", () => {
  assert.ok(AGES_FIT_RELATION.startsWith("AGES — every \"cast\" entry says that character's AGE plainly"));
  for (const rule of ["sisters or brothers within about ten years of each other (twins the same age)", "cousins or a married couple within about fifteen", "a parent 20 to 40 years older than their child", "a grandparent 45 to 70 years older than their grandchild"]) assert.ok(AGES_FIT_RELATION.includes(rule), rule);
  assert.deepEqual(AGE_RULES.siblings.gap, [0, 10]);
  const engine = read("app", "lib", "film-engine.server.ts");
  assert.ok(engine.includes("    castLine +\n") && engine.includes("(storyFormat ? `\\n${AGES_FIT_RELATION}` : \"\") +"), "told with the cast, in every story format");
  // checked on the cast as it stands after the names are enforced, a cast of two only
  const nameFix = engine.indexOf("outTitle = apply(outTitle);");
  const check = engine.indexOf("const problem = castAgeProblem({ idea: topic, cast, lines: spoken });");
  assert.ok(nameFix > 0 && check > nameFix);
  // (a cast the writer invented: people the maker picked are drawn from their own photos, at their own ages)
  // (…a chosen creature that is an acted film's threat is not one of the cast: the pair the writer invented
  //  around it is checked like any invented pair — premise-rules.ts → chosenThreat)
  assert.ok(engine.includes("if (storyFormat && !castPicked.length && cast && cast.length === 2) {"));
  assert.ok(engine.includes("const castChosen = actedThreat ? picked.filter((c) => !threatNames.includes(c.name)) : picked;") && engine.includes("const castPicked = castChosen;"));
  assert.ok(engine.includes("const want = castPicked.length ? castPicked[i]?.name : i === 0 ? artistName : castNames[i - 1];"), "names are held to the chosen PEOPLE only — never the boy renamed after the creature");
  assert.ok(engine.includes("fixed = takeAgeFix(cast, (JSON.parse(raw) as { cast?: unknown }).cast, { idea: topic, lines: spoken });"));
  assert.ok(engine.includes("const now = fixed || repairAges(cast, problem);"), "never filmed as written: put right here when asking again did not");
  assert.ok(engine.includes("...(ageNote ? { ageFit: ageNote } : {})"), "…and what happened rides on the treatment");
  // …and two close in age LOOK it (the third film's sisters: one drawn about sixty, with grey hair in a bun)
  assert.ok(AGES_FIT_RELATION.endsWith("Two who are close in age by what they are (sisters, brothers, cousins, a couple) LOOK it: no grey or white hair on either of them unless both are past sixty."));
});

/* ---- RELATED PEOPLE LOOK IT, IN THE PICTURES ----
 * The third live film of the same idea (knock3): its "sisters" — written, most likely, "in her late forties" and "in
 * her mid-fifties", which fit — were DRAWN fifteen to twenty years apart: about forty with a short dark crop and
 * glasses, about sixty with grey hair in a bun. Drawn from those words on the master picture's own model, they came
 * out the same way twice (scratchpad t45/acted/k3-sisters-before-*.jpg); from the words below, both about fifty,
 * twice (k3-sisters-after-*.jpg). */

const KNOCK3_CAST = [
  "Colette, a woman in her late forties with a short dark crop, wire-rimmed glasses, a white shirt and a long grey cardigan",
  "Prudence, a woman in her mid-fifties with grey hair pulled into a loose bun and a red plaid flannel shirt",
];

test("THE THIRD FILM'S SISTERS: ages that fit are DRAWN as sisters — the same age as a number, no grey hair under sixty, and the picture of the two told so", () => {
  assert.equal(castAgeProblem({ idea: SISTERS_IDEA, cast: KNOCK3_CAST }), null, "the ages fit — the check let them through");
  const kin = kinLooks({ idea: SISTERS_IDEA, cast: KNOCK3_CAST });
  assert.ok(kin);
  assert.equal(kin!.relation, "siblings");
  assert.deepEqual(kin!.entries, [
    "Colette, Prudence's sister, about 51 years old, a woman with a short dark crop, wire-rimmed glasses, a white shirt and a long grey cardigan",
    "Prudence, Colette's sister, about 51 years old, a woman with hair pulled into a loose bun and a red plaid flannel shirt",
  ]);
  assert.ok(kin!.entries.every((e) => e.length <= PICTURE_DESC_MAX), "inside what the master picture's prompt keeps of each one");
  assert.equal(kin!.note, "Colette and Prudence are sisters and look it: the same age — both about 51, the same generation, with a family likeness; neither one looks old enough to be the other's parent.");
  // the master picture of the two of them says it, right after who they are — never when a reference photo is bound
  const parts = { setting: "their late mother's bedroom at night", consistency: "Keep the two people clearly distinct.", comp: "wide cinematic landscape composition" };
  const master = stagedTwoShot({ staging: "depth", ...parts, personA: kin!.entries[0], personB: kin!.entries[1] });
  assert.ok(master.includes(`${kin!.entries[0]} on one side and ${kin!.entries[1]} on the other, both faces prominent and in focus — each in their own half of the frame, never one directly in front of the other. ${kin!.note} This is NOT an over-the-shoulder shot`));
  assert.equal(kinNote(kin!.entries[0], kin!.entries[1]), kin!.note, "read back off the words the picture is given");
  assert.ok(!stagedTwoShot({ staging: "depth", ...parts, personA: kin!.entries[0], personB: "Prudence — EXACTLY the person in reference image 1", faceNote: " WHO IS WHO: reference image 1 is Prudence and ONLY Prudence." }).includes("are sisters"));
  assert.ok(!stagedTwoShot({ staging: "depth", ...parts, personA: KNOCK3_CAST[0], personB: "Sam, a man in his sixties" }).includes(" look it"), "nobody related: nothing said");
  // the first film's sisters, once their ages were put right: the same — and Peggy's grey goes, her glasses stay
  const first = kinLooks({ idea: SISTERS_IDEA, cast: repairAges(SISTERS_CAST, castAgeProblem({ idea: SISTERS_IDEA, cast: SISTERS_CAST })!), lines: SISTERS_LINES });
  assert.deepEqual(first!.entries, ["Peggy, June's sister, about 50 years old, a woman with short hair, round glasses and a floral blouse", "June, Peggy's sister, about 50 years old, a woman with a long dark braid and a denim jacket"]);
});

test("the pictures' words for every relation: whose (sister, wife, mother…), the age as a number — and grey hair, only where it belongs", () => {
  const look = (idea: string, cast: string[]) => kinLooks({ idea, cast });
  // every way a cast entry says grey hair goes, for a sister under sixty — a grey cardigan, silver earrings and a
  // white blouse stay; "a 47-year-old with" does not become "a with"
  assert.deepEqual(look("Two sisters", ["Ann, a woman of about 52 with silver-streaked dark hair, silver earrings and a white blouse", "Bea, her younger sister, a 47-year-old with dark hair streaked with grey, greying at the temples"])!.entries,
    ["Ann, Bea's sister, about 50 years old, a woman with dark hair, silver earrings and a white blouse", "Bea, Ann's sister, about 50 years old, with dark hair"]);
  assert.deepEqual(look("Two sisters", ["Prudence, 58, grey-haired, in a plaid flannel shirt", "Colette (49), Prudence's younger sister, short dark crop and glasses"])!.entries,
    ["Prudence, Colette's sister, about 54 years old, in a plaid flannel shirt", "Colette, Prudence's sister, about 54 years old, short dark crop and glasses"]);
  const twins = look("Twin brothers find a door in the cellar.", ["Sam, a man in his early thirties with a buzz cut", "Max, a man in his early thirties with a ponytail"])!;
  assert.deepEqual(twins.entries, ["Sam, Max's twin brother, about 32 years old, a man with a buzz cut", "Max, Sam's twin brother, about 32 years old, a man with a ponytail"]);
  assert.ok(twins.note.startsWith("Sam and Max are twin brothers and look it: the same age — both about 32"));
  // a couple: each their own age, and no grey under sixty
  const couple = look("A married couple buy a farmhouse.", ["Ivy, a woman in her late fifties with grey hair", "Ned, a man in his early fifties with a salt-and-pepper beard"])!;
  assert.deepEqual(couple.entries, ["Ivy, Ned's wife, about 58 years old, a woman", "Ned, Ivy's husband, about 52 years old, a man with a beard"]);
  assert.equal(couple.note, "Ivy and Ned are a married couple and look it: about 58 and about 52.");
  // a mother and her daughter: a generation apart — the mother's grey hair is hers to keep
  const parent = look("A mother and her daughter hear knocking.", ["Mara, a woman in her sixties with grey hair", "Lily, a woman in her late thirties with red hair"])!;
  assert.deepEqual(parent.entries, ["Mara, Lily's mother, about 65 years old, a woman with grey hair", "Lily, Mara's daughter, about 38 years old, a woman with red hair"]);
  assert.equal(parent.note, "Mara is Lily's mother and looks it: about 65, and Lily about 38 — a generation apart.");
  // nobody related, nobody's age said, not two: nothing
  assert.equal(look("Two friends at a diner.", ["Ann, in her twenties", "Bea, in her seventies with white hair"]), null);
  assert.equal(look("Two sisters", ["Ann, with a braid", "Bea, in her thirties"]), null);
  assert.equal(look("Two sisters", ["Ann, in her thirties"]), null);
  // the ways a cast list says an age with a bare number — and the numbers that are not ages
  assert.deepEqual(["Prudence, 58, grey hair", "Ruth (30)", "Ann, a woman of about 52 with a raincoat", "Cy, around 40, a farmer", "Bo, about 6 feet tall", "Di, about 30 letters in her hand"].map((e) => ageOf(e)?.from ?? null), [58, 30, 52, 40, null, null]);
  // the film: only the pictures, only a cast the writer invented (anybody with a cast photo is drawn from it)
  const eng = read("app", "lib", "film-dialogue.server.ts");
  assert.ok(eng.includes("const kin = (treatment.cast || []).some((e) => !!actorOfEntry(e)) ? null : kinLooks({ idea: opts.topic, cast: treatment.cast, lines: treatment.scenes.map((s) => s.caption || \"\") });"));
  assert.ok(eng.includes("|| \"exactly as in their reference photo\"}` : pictureEntry(entry); };"), "the cast reference picture");
  assert.ok(eng.includes("join(\"; \")}.${kin?.note ? ` ${kin.note}` : \"\"}` : \"\";"), "…which says what they are to each other");
  assert.ok(eng.includes("return pictureEntry((treatment.cast || []).find((c) => firstName(n) && c.toLowerCase().includes(firstName(n))) || \"\") || `${n}, a person`;"), "each one's words in the master picture");
  assert.ok(eng.includes("descA: bibleFor(spkA), descB: bibleFor(spkB)"));
});

/* ---- THE TITLE ----
 * The same film was called "Horror Film — Two sisters clearing out their late mother's house at…"; the one made
 * from that idea before it was "The Knock She Kept". */

test("a title of its own, or asked for once more — never the idea", () => {
  assert.equal(ownTitle("The Knock She Kept", SISTERS_IDEA), "The Knock She Kept");
  assert.equal(ownTitle("\"Holding the Wall\".", SISTERS_IDEA), "Holding the Wall");
  assert.equal(ownTitle("", SISTERS_IDEA), "");
  assert.equal(ownTitle(undefined, SISTERS_IDEA), "");
  assert.equal(ownTitle(SISTERS_IDEA, SISTERS_IDEA), "", "the idea handed back");
  assert.equal(ownTitle("Two sisters clearing out their late mother's house", SISTERS_IDEA), "", "the idea's own opening words");
  assert.equal(ownTitle("Two Sisters", SISTERS_IDEA), "Two Sisters", "a short title that happens to share two words is a title");
  assert.equal(ownTitle("They heard it knocking in the wall and then they found out what it was all along", SISTERS_IDEA), "", "a sentence, not a title");
  const ask = titleAsk({ idea: SISTERS_IDEA, scenes: [{ visual: "Peggy lifts a bundle of letters.", caption: "PEGGY: Mum kept every letter." }], language: "Spanish" });
  assert.ok(ask.includes("1. Peggy lifts a bundle of letters. — PEGGY: Mum kept every letter.") && ask.includes("two to six words, short and specific to THIS story — never the idea's own words") && ask.includes(", in Spanish."));
  assert.ok(!titleAsk({ idea: SISTERS_IDEA, scenes: [], language: "English" }).includes("in English"));
  const engine = read("app", "lib", "film-engine.server.ts");
  // checked before the line every story's title has come from — which stays as it was
  const checked = engine.indexOf("parsed.title = ownTitle(parsed.title, topic) || undefined;");
  assert.ok(checked > 0 && engine.indexOf("let outTitle = (parsed.title || topic || tmpl.name).slice(0, 80);") > checked);
  assert.ok(engine.includes("if (!parsed.title && storyFormat && list.length) {"));
  assert.ok(engine.includes("const raw = await anthropicText(titleAsk({ idea: topic, scenes: list, language: langName }), {"));
  assert.ok(engine.includes("parsed.title = ownTitle((JSON.parse(raw) as { title?: unknown }).title, topic) || undefined;"));
});

/* "WHO CALLS FROM THE SHALLOWS" (2026-11-25, the owner: "that one looks pretty slop"): a woman stood waist-deep in the lake
 * in its third shot — lit from inside like a lamp — and its last shot, "she" close behind them, came back as a bald grey
 * ghoul's face in a window in the tent wall. A threat the story invented had no picture to be drawn from, so the words of
 * the shot that showed it now go with it; and nothing in a photographed film glows unless it is a light. */
test("the reveal is the thing the film already showed, in that shot's words; nothing glows that is not a light", async () => {
  const st = await import("../app/lib/acted-staging.ts");
  const earlier = [
    "Esperanza and Rupert sit up in their sleeping bags inside the tent, the lake dark behind the open flap",
    "Rupert holds the flashlight at the tent flap, Esperanza beside him, staring out at the water",
    "Far out in the lake a woman stands waist-deep, long black hair over her shoulders, white dress soaked, smiling",
  ];
  assert.equal(st.seenBefore("She is right behind Rupert now, smiling, water dripping from her hair", earlier), earlier[2], "'she' finds the woman");
  assert.equal(st.seenBefore("The figure stands at the tent flap", ["a tall figure stands under the pines, far off", "the two sit by the fire"]), "a tall figure stands under the pines, far off", "the latest earlier scene that names the same kind of thing");
  assert.equal(st.seenBefore("Something knocks on the tent pole", earlier), "", "a moment that names no figure carries nothing");
  assert.equal(st.seenBefore("", earlier), "");
  const sides = [{ name: "Esperanza", side: "left" }, { name: "Rupert", side: "right" }];
  const p = st.revealPicture({ moment: "She is right behind Rupert now, smiling", sides, seen: earlier[2] });
  assert.ok(p.includes(`It is the SAME one this film already showed — "${earlier[2]}" — the same look, the same hair, the same clothes, only nearer: never a different face or a different creature.`));
  assert.ok(p.length < 2400, "inside what both editors read");
  assert.ok(!st.revealPicture({ moment: "She is right behind Rupert now", sides, seen: earlier[2], creature: true }).includes("It is the SAME one this film already showed"), "a chosen creature is drawn from its own picture");
  assert.ok(!st.revealPicture({ moment: "She is right behind Rupert now", sides }).includes("It is the SAME one"), "nothing seen before: as it was");
  // the engine hands it the earlier shots' words, unless the thing is a creature the maker chose
  const eng = fs.readFileSync(new URL("../app/lib/film-dialogue.server.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(eng.includes("const seen = thing && thingFace ? \"\" : (othersIn(eventAt(i))[0] || seenBefore(eventAt(i), treatment.scenes.slice(0, i).map((s) => s.visual || \"\")));"), "(the story's own cast line for it first, when the moment names it)");
  assert.ok(eng.includes("creature: !!(thing && thingFace), seen, outdoors });"));
  // nothing glows that is not a light — in every picture of a photographed film
  assert.ok(st.NOTHING_GLOWS.includes("a pale figure is lit only by the lights that are there, never from within"));
  assert.ok(st.actedRealism(false, "x").endsWith(` ${st.NOTHING_GLOWS}`) && st.actedRealism(true, "x") === "");
});

/* "SHE WALKS OUT SMILING" (2026-11-25, on the 1080p build): "Tunde" was a Black man in the tent and a white man in the same
 * shirt on the shore — a character the story invented has no cast photo, and each new place drew him again from words;
 * and the woman written "a pale woman in a soaked grey dress, her smile far too wide" came out of the lake as a swimmer
 * in a swimsuit — anybody but the two who talk was drawn from the scene's bare words. */
test("an invented character keeps the face the film first showed; anybody else named carries the story's own description", () => {
  const eng = fs.readFileSync(new URL("../app/lib/film-dialogue.server.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  // the faces: cut from the first master, each from their own half; a cast photo wins
  assert.ok(eng.includes("const faceFor = (n: string) => { const k = firstName(n); return abs(castActors.find((c) => { const nm = (c.name || \"\").toLowerCase(); return firstName(c.name) === k || (!!k && nm.split(/[\\s,]/).includes(k)); })?.faceUrl) || firstFaces[k]; };"));
  assert.ok(eng.includes("for (const [who, left] of [[spkA, m.aOnLeft], [spkB, !m.aOnLeft]] as Array<[string, boolean]>) {"));
  assert.ok(eng.includes("if (!k || castActors.some((c) => !!c.faceUrl && firstName(c.name) === k)) continue; // a cast photo wins"));
  assert.ok(eng.includes("left ? \"crop=iw/2:ih:0:0\" : \"crop=iw/2:ih:iw/2:0\""));
  const set = eng.indexOf("masters[locKey] = { url, aOnLeft, a: firstName(spkA), b: firstName(spkB),");
  const cut = eng.indexOf("try { await cutFirstFaces(masters[locKey]); }");
  assert.ok(set > 0 && cut > set, "cut once the first master — and its sides — are known");
  // anybody else the words name: their own cast line rides with the words, into the master and the reveal
  assert.ok(eng.includes("return visual && others.length ? `${visual} (Who else is in it, as the story describes them: ${others.join(\"; \")}.)` : visual;"));
  assert.ok(eng.includes("lastHorror && tr === \"location\" ? undefined : withLooks(scene.visual));"));
  assert.ok(eng.includes("const seen = thing && thingFace ? \"\" : (othersIn(eventAt(i))[0] || seenBefore(eventAt(i), treatment.scenes.slice(0, i).map((s) => s.visual || \"\")));"));
  assert.ok(eng.includes("if (!nm || [spkA, spkB].some((s) => !!s && firstName(s) === firstName(nm))) return false;"), "the two who talk are not 'anybody else'");
});

/* NIGHT IS NIGHT (2026-11-25): both acted lake films — "wake at 3am" — were lit like a blue dusk. */
test("a photographed film's night scene is the middle of the night", async () => {
  const st = await import("../app/lib/acted-staging.ts");
  assert.ok(st.actedRealism(false, "Tunde shakes Isamu awake", "inside a tent by a lake at 3am").endsWith(` ${st.NIGHT_LINE}`));
  assert.ok(st.actedRealism(false, "they wake at midnight to a voice", "a tent").includes(st.NIGHT_LINE));
  assert.ok(!st.actedRealism(false, "they pack the car", "a driveway on a sunny morning").includes(st.NIGHT_LINE), "day stays day");
  assert.equal(st.actedRealism(true, "at night", "a bedroom"), "", "a cartoon is left as it was");
  assert.ok(st.NIGHT_LINE.includes("never dusk, twilight or a blue evening glow"));
  const src = fs.readFileSync(new URL("../app/lib/acted-staging.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(src.includes("${actedRealism(o.cartoon, act, o.setting)}"), "the staged master is told it, from its place and its moment");
});

test("OUT OF DOORS NOTHING IS BUILT INTO THE PLACE (\"She Smiles From the Shallows\", 2026-11-25): its last scene said \"through the tent wall\" — the editor built a plastered room on the lake shore with a grey ghoul in a hole — and the one the film already showed is drawn as itself", async () => {
  const st = await import("../app/lib/acted-staging.ts");
  // which kind of place the words name FIRST; a tent is out of doors
  for (const w of ["the lakeshore campsite at night", "inside the tent by the lake", "a tent on the shore", "the backyard of the house", "the woods behind the cabin", "a dark forest trail", "the end of the dock"]) assert.equal(st.openAirPlace(w), true, w);
  for (const w of ["the kitchen, looking out at the lake", "a cabin by the lake", "the upstairs hallway", "room 14 of the hospital", "the basement", "", null]) assert.equal(st.openAirPlace(w), false, String(w));
  // the tent wall is no wall: out of doors it is a FIGURE in the dark, whatever the words say
  const moment = "Her pale face presses through the tent wall behind Wren, still smiling.";
  assert.equal(st.revealPart(moment), "face", "indoors, a face in the wall — as it was");
  assert.equal(st.revealPart(moment, { outdoors: true }), "figure");
  assert.equal(st.revealPart("She is at the door, knocking", { outdoors: true }), "figure");
  const sides = [{ name: "Wren", side: "left" }, { name: "Ines", side: "right" }];
  const seen = "a woman stands waist-deep in the black lake, long wet dark hair, a white dress, perfectly still, smiling";
  const pic = st.revealPicture({ moment, sides, seen, outdoors: true });
  assert.ok(pic.includes("In the dark close behind Wren, the one on the left, well inside the picture, it stands in the dark, almost all of it in shadow; only the pale shape of its face catches the light."));
  assert.ok(pic.includes("This is out of doors: nothing is built into the place — no wall, no plaster, no door and no window is added."));
  assert.ok(pic.includes(`It is the SAME one this film already showed — "${seen}"`));
  // …and the generic thing's look is not said over hers (told both, the editor drew her as a grey ghoul)
  assert.ok(!pic.includes("plaster has been broken open") && !pic.includes("What is wrong with it") && !pic.includes("too tall and too thin") && !pic.includes("a little too high up"));
  // nothing seen before, indoors: exactly as it was
  const before = st.revealPicture({ moment, sides });
  assert.ok(before.includes("plaster has been broken open") && before.includes("What is wrong with it:") && !before.includes("out of doors"));
  // the clip is told what the picture holds: the one already shown, in the dark
  assert.ok(st.revealClip(moment, { outdoors: true, seen: true }).startsWith("In the dark behind them stands the one this film already showed, almost all of it in shadow: only the pale shape of its face in the light. Only its HEAD moves"));
  assert.ok(st.revealClip(moment, { outdoors: true }).startsWith("In the dark behind them stands a tall, thin FIGURE"));
  assert.ok(st.revealClip(moment).startsWith("In the hole broken in the wall"), "indoors: as it was");
  // the film hands both over, from the place's own words
  const eng = fs.readFileSync(new URL("../app/lib/film-dialogue.server.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(eng.includes("const outdoors = openAirPlace(whereAt[i]);") && eng.includes("revealSeen = !!seen;"));
  assert.ok(eng.includes("creature: revealedCreature, outdoors, seen: revealSeen, implied, face: scared });") && eng.includes("creature: revealedCreature, outdoors, seen: revealSeen, implied });"));
});

test("A NIGHT FILM'S PLACES ARE AT NIGHT (the lake film: its idea said 3am, its first shot said only 'inside the tent', and the tent was drawn at dusk)", async () => {
  const st = await import("../app/lib/acted-staging.ts");
  const idea = "Two friends camping by a quiet lake wake at 3am to someone softly calling their names from the water.";
  assert.equal(st.nightSetting("inside the tent", idea), "inside the tent, in the middle of the night");
  assert.ok(st.actedRealism(false, "Philippa shakes Hana awake", st.nightSetting("inside the tent", idea)).includes(st.NIGHT_LINE), "…and so it is told the night");
  // a place or a shot that names its own time keeps it; an idea that is not at night changes nothing
  assert.equal(st.nightSetting("the lake at dawn", idea), "the lake at dawn");
  assert.equal(st.nightSetting("the campsite", idea, "They arrive in the late afternoon sun"), "the campsite");
  assert.equal(st.nightSetting("the campsite at night", idea), "the campsite at night");
  assert.equal(st.nightSetting("inside the tent", "Two friends go camping by a quiet lake."), "inside the tent");
  assert.equal(st.nightSetting("inside the tent", null), "inside the tent");
  // every place's master is told it, from the film's own idea
  const eng = fs.readFileSync(new URL("../app/lib/film-dialogue.server.ts", import.meta.url), "utf8");
  assert.ok(eng.includes("setting: nightSetting(cleanSetting(where), opts.topic, action), style: twoStyle, aspect"));
});

/* ---- A LONG FILM IS JOINED IN PARTS ----
 * The owner, 2026-11-25: films "up to 5 minutes". Five minutes is fifty-two shots (film-length.ts), and the join
 * opened every clip of a film in one ffmpeg: fifty Full-HD inputs on a 2 GB server, in an encode that is stopped
 * at ten minutes. A film of more than six clips is joined in parts — each a handful of shots, cut where the film
 * already cuts straight when it can — and the parts are put end to end without being encoded again. */

test("a long film is dealt into parts of six clips at most, cut at its straight cuts — and a dissolve at a part's edge is carried, not lost", async () => {
  const st = await import("../app/lib/acted-staging.ts");
  assert.equal(st.JOIN_PART_CLIPS, 6);
  // nine scenes of six shots, a straight cut into each: the parts ARE the scenes
  const scenes = Array.from({ length: 54 }, (_, i): Seam => (i === 0 ? null : i % 6 === 0 ? "hard" : i % 3 === 0 ? "reframe" : "soft"));
  const frames = scenes.map((_, i) => 150 + (i % 4) * 6);
  const film = st.joinParts({ frames, seams: scenes, prep: "fps=30" });
  assert.equal(film.parts.length, 9);
  assert.deepEqual(film.parts.map((p) => [p.from, p.to, p.carried]), Array.from({ length: 9 }, (_, k) => [k * 6, k * 6 + 6, 0]));
  assert.ok(film.parts.every((p) => p.clips.length <= st.JOIN_PART_CLIPS));
  // the film is as long as one graph of all of it would be: its shots less its dissolves
  const whole = st.joinGraph({ frames, seams: scenes, prep: "fps=30" });
  assert.equal(film.frames, whole.frames);
  assert.equal(film.frames, frames.reduce((a, b) => a + b, 0) - st.seamFades(frames, scenes).reduce((a, b) => a + b, 0));
  assert.deepEqual(st.seamFades([150, 120, 90, 60], [null, "soft", "reframe", "hard"]), [0, 5, 10, 0]);
  assert.deepEqual(st.seamFades([150, 120, 90], [null, "soft", "reframe"], false), [0, 0, 0]);
  // a part that begins at a straight cut fades its sound in, one that ends at one fades it out — as two runs meet
  assert.ok(film.parts[0].graph.includes("afade=t=out:st=") && !film.parts[0].graph.includes("afade=t=in"));
  assert.ok(film.parts[4].graph.includes("afade=t=in:d=0.012,afade=t=out:st="));
  assert.ok(film.parts[8].graph.includes("afade=t=in:d=0.012") && !film.parts[8].graph.includes("afade=t=out"));

  // ONE LONG SCENE — twenty shots in one room, not a straight cut among them: a part ends at a dissolve, and the
  // next one opens the shot before it again, for just the frames the dissolve needs
  const room = Array.from({ length: 20 }, (_, i): Seam => (i === 0 ? null : i % 4 === 0 ? "reframe" : "soft"));
  const lens = room.map(() => 165);
  const long = st.joinParts({ frames: lens, seams: room, prep: "fps=30" });
  assert.deepEqual(long.parts.map((p) => [p.from, p.to, p.carried]), [[0, 6, 0], [6, 11, 5], [11, 16, 5], [16, 20, 10]]);
  assert.ok(long.parts.every((p) => p.clips.length <= st.JOIN_PART_CLIPS), "the shot opened again counts as one of a part's clips");
  assert.deepEqual(long.parts[1].clips, [5, 6, 7, 8, 9, 10]);
  assert.equal(long.frames, st.joinGraph({ frames: lens, seams: room, prep: "fps=30" }).frames);
  // part 1 stops five frames short of its last shot…
  assert.ok(long.parts[0].graph.includes("[5:v]fps=30,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=3,trim=end_frame=160,"));
  // …and part 2 opens that shot at its 160th frame, for five frames, and dissolves all five into its own first shot
  assert.ok(long.parts[1].graph.includes("[0:v]fps=30,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=3,trim=start_frame=160:end_frame=165,"));
  assert.ok(long.parts[1].graph.includes("atrim=start_sample=235200:end_sample=242550,"));
  assert.ok(long.parts[1].graph.includes("[v0][v1]xfade=transition=fade:duration=0.166667:offset=0.000000[r0v0]"));
  assert.ok(!long.parts[1].graph.includes("afade=t=in"), "its sound carries on: nothing fades at a dissolve");
  // the plain way: every seam a straight join, nothing carried
  const plain = st.joinParts({ frames: lens, seams: room, prep: "fps=30", dissolve: false });
  assert.ok(plain.parts.every((p) => p.carried === 0 && !/xfade/.test(p.graph)));
  assert.equal(plain.frames, 20 * 165);
  // a film short enough for one ffmpeg is one part, and its graph is joinGraph's own
  const six = st.joinParts({ frames: [150, 120, 130, 140, 150, 160], seams: [null, "soft", "soft", "hard", "soft", "reframe"], prep: "fps=30" });
  assert.equal(six.parts.length, 1);
  assert.equal(six.parts[0].graph, st.joinGraph({ frames: [150, 120, 130, 140, 150, 160], seams: [null, 5, 5, 0, 5, 10], prep: "fps=30" }).graph);
  // nothing asked of joinGraph that it was not asked before changes what it writes
  assert.ok(st.joinGraph({ frames: [165], prep: "fps=30", hold: 2.5 }).graph.endsWith("[v0]null[vc];[a0]anull[ac]"));
});

test("the encoder's arguments are told apart: the picture is encoded in every part, the sound once, for the whole film", async () => {
  const st = await import("../app/lib/acted-staging.ts");
  const ENCODE = ["-threads", "2", "-filter_complex_threads", "2", "-c:v", "libx264", "-preset", "fast", "-tune", "film", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"];
  assert.deepEqual(st.joinEncode(ENCODE), {
    picture: ["-threads", "2", "-filter_complex_threads", "2", "-c:v", "libx264", "-preset", "fast", "-tune", "film", "-crf", "18", "-pix_fmt", "yuv420p"],
    sound: ["-c:a", "aac", "-b:a", "160k"],
    file: ["-movflags", "+faststart"],
  });
  // the acted film's own encoder is the one told apart here
  const eng = read("app", "lib", "film-dialogue.server.ts");
  assert.ok(eng.includes(`const ENCODE = [${ENCODE.map((a) => `"${a}"`).join(", ")}];`));
  assert.deepEqual(st.joinPartArgs({ graph: "G" }, ["a.mp4", "b.mp4"], ENCODE, "p.mov"), ["-y", "-i", "a.mp4", "-i", "b.mp4", "-filter_complex", "G", "-map", "[vc]", "-map", "[ac]", ...st.joinEncode(ENCODE).picture, "-c:a", "pcm_s16le", "-f", "mov", "p.mov"]);
  assert.deepEqual(st.joinFilmArgs("l.txt", ENCODE, "f.mp4"), ["-y", "-f", "concat", "-safe", "0", "-i", "l.txt", "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "f.mp4"]);
  // each part starts on the frame the one before it ended: its length is said, to the microsecond
  assert.equal(st.joinList(["C:\\r\\tm-1.mp4.part1.mov", "/r/it's.mov"], [1001, 30]), "file 'C:/r/tm-1.mp4.part1.mov'\nduration 33.366667\nfile '/r/it'\\''s.mov'\nduration 1.000000\n");
  // the film's own join hands a long film to the parts, and measures every part and the finished file
  const join = read("app", "lib", "film-join.server.ts");
  assert.ok(join.includes("if (clips.length > JOIN_PART_CLIPS) return joinInParts({ ...o, frames, silent, hold });"));
  assert.ok(join.includes("const run = await runFfmpeg(joinPartArgs(part, part.clips.map((i) => clips[i]), o.encode, files[p]));"));
  assert.ok(join.includes("? joinCheck({ ...streamSeconds(files[p]), frames: part.frames })"), "every part is measured");
  assert.ok(join.includes("const run = await runFfmpeg(joinFilmArgs(list, o.encode, outPath));"));
  assert.ok(join.includes("? joinCheck({ ...streamSeconds(outPath), frames: plan.frames })"), "…and so is the film, against the sum of its parts");
  assert.ok(join.includes("throw new Error(`${label} the film could not be joined whole — ${tried.join(\"; \")}`);"), "not whole either way: the job fails");
  assert.ok(join.includes("for (const f of [...files, list]) { try { fs.rmSync(f, { force: true }); } catch { /* best effort */ } }"), "the parts are gone when it returns");
  assert.ok(join.includes("if (o.beat) await o.beat();"), "the job says it is alive between parts");
});

/** a small stand-in shot of its own colour and its own tone (0: no sound stream) — 320×180, quick to make */
const smallShot = (dir: string, name: string, rgb: [number, number, number], picture: number, sound: number): string => {
  const out = path.join(dir, `${name}.mp4`);
  const hex = rgb.map((c) => c.toString(16).padStart(2, "0")).join("");
  const args = ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=0x${hex}:s=320x180:r=24:d=${picture}`];
  if (sound > 0) args.push("-f", "lavfi", "-i", `sine=frequency=${300 + (rgb[0] + rgb[1] * 2 + rgb[2] * 3) % 500}:sample_rate=44100:duration=${sound}`);
  args.push("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", ...(sound > 0 ? ["-c:a", "aac"] : []), out);
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return out;
};
/** every frame of a film as one colour (its picture brought down to a single pixel) */
const framesOf = (ff: string, film: string): Array<[number, number, number]> => {
  const raw = spawnSync(ff, ["-v", "error", "-i", film, "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { encoding: "buffer", maxBuffer: 1 << 26 }).stdout;
  const out: Array<[number, number, number]> = [];
  for (let k = 0; k + 2 < raw.length; k += 3) out.push([raw[k], raw[k + 1], raw[k + 2]]);
  return out;
};

test("TWENTY-SEVEN SHOTS JOINED IN PARTS come out whole — and frame for frame the film one graph makes of them", { skip: !ffmpegOk }, async () => {
  const st = await import("../app/lib/acted-staging.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "join-parts-"));
  const PREP = "scale=320:180:force_original_aspect_ratio=increase,crop=320:180,setsar=1,fps=30";
  const ENCODE = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"];
  try {
    // 27 shots, each a colour of its own: three scenes that end in a straight cut, then ONE scene of twelve shots
    // with no straight cut in it (a part has to end at a dissolve there), then a last scene. Some shots' sound runs
    // 30 ms past their picture (knock4's fault), one has no sound at all, one has too little.
    const N = 27;
    const colour = (i: number): [number, number, number] => [(i * 67 + 20) % 236 + 10, (i * 131 + 90) % 236 + 10, (i * 29 + 160) % 236 + 10];
    const hardAt = new Set([4, 9, 12, 24]);
    const seams: Seam[] = Array.from({ length: N }, (_, i) => (i === 0 ? null : hardAt.has(i) ? "hard" : i % 3 === 0 ? "reframe" : "soft"));
    const clips = Array.from({ length: N }, (_, i) => {
      const picture = 1 + (i % 5) * 0.2;
      return smallShot(dir, `s${i}`, colour(i), picture, i === 7 ? 0 : i === 15 ? picture - 0.4 : picture + (i % 2 ? 0.03 : 0));
    });
    const sizes = clips.map((c) => { const s = streamsOf(c); return { frames: clipFrames({ picture: s.video }), silent: s.audio === null }; });
    const frames = sizes.map((s) => s.frames);
    const silent = sizes.map((s) => s.silent);
    for (const ff of joiners) {
      // (the plain way — every seam a straight join — on the first ffmpeg only: it is the same arguments)
      for (const dissolve of ff === joiners[0] ? [true, false] : [true]) {
        const at = `${ff} dissolve=${dissolve}`;
        // ONE GRAPH of all twenty-seven — what the join did until now (here, on small pictures, it still can)
        const one = st.joinGraph({ frames, seams, prep: PREP, silent, dissolve });
        const oneFile = path.join(dir, `one-${joiners.indexOf(ff)}-${dissolve}.mp4`);
        const r1 = spawnSync(ff, ["-v", "error", "-y", ...clips.flatMap((c) => ["-i", c]), "-filter_complex", one.graph, "-map", "[vc]", "-map", "[ac]", ...ENCODE, oneFile], { encoding: "utf8" });
        assert.equal(r1.status, 0, r1.stderr);
        // IN PARTS — the very arguments film-join.server.ts runs
        const plan = st.joinParts({ frames, seams, prep: PREP, silent, dissolve });
        assert.ok(plan.parts.length >= 5 && plan.parts.every((p) => p.clips.length <= st.JOIN_PART_CLIPS), `${at}: ${plan.parts.map((p) => p.clips.length).join(",")}`);
        if (dissolve) assert.ok(plan.parts.some((p) => p.carried > 0), "the twelve-shot scene makes a part end at a dissolve");
        const partFiles = plan.parts.map((_, p) => path.join(dir, `film-${joiners.indexOf(ff)}-${dissolve}.mp4.part${p + 1}.mov`));
        plan.parts.forEach((part, p) => {
          const r = spawnSync(ff, ["-v", "error", ...st.joinPartArgs(part, part.clips.map((i) => clips[i]), ENCODE, partFiles[p])], { encoding: "utf8" });
          assert.equal(r.status, 0, `${at} part ${p + 1}: ${r.stderr}`);
          const whole = joinCheck({ ...streamsOf(partFiles[p]), frames: part.frames });
          assert.ok(whole.ok, `${at} part ${p + 1}: ${whole.why}`);
        });
        const list = path.join(dir, `film-${joiners.indexOf(ff)}-${dissolve}.parts.txt`);
        fs.writeFileSync(list, st.joinList(partFiles, plan.parts.map((p) => p.frames)), "utf8");
        const film = path.join(dir, `film-${joiners.indexOf(ff)}-${dissolve}.mp4`);
        const r2 = spawnSync(ff, ["-v", "error", ...st.joinFilmArgs(list, ENCODE, film)], { encoding: "utf8" });
        assert.equal(r2.status, 0, `${at}: ${r2.stderr}`);

        // WHOLE: its picture and its sound the same length, and the length its shots add up to
        const streams = streamsOf(film);
        const whole = joinCheck({ ...streams, frames: plan.frames });
        assert.ok(whole.ok, `${at}: ${whole.why}`);
        assert.equal(plan.frames, one.frames, `${at}: as long as the one graph's film`);
        assert.ok(Math.abs(streams.video - (streams.audio ?? 0)) <= JOIN_TOLERANCE, `${at}: picture ${streams.video}, sound ${streams.audio}`);
        // FRAME FOR FRAME the film the one graph makes: the same number of frames, each the same colour
        const a = framesOf(ff, oneFile), b = framesOf(ff, film);
        assert.equal(b.length, plan.frames, `${at}: every frame is there`);
        assert.equal(a.length, b.length, at);
        let worst = 0;
        for (let k = 0; k < a.length; k++) worst = Math.max(worst, Math.abs(a[k][0] - b[k][0]), Math.abs(a[k][1] - b[k][1]), Math.abs(a[k][2] - b[k][2]));
        assert.ok(worst <= 6, `${at}: the two films differ by ${worst} somewhere — a frame is not where it should be`);
        // …every shot's own colour is in it, in order (no shot's picture lost at a part's edge)
        let from = 0;
        for (let i = 0; i < N; i++) {
          const [r0, g0, b0] = colour(i);
          const hit = b.findIndex((px, k) => k >= from && Math.abs(px[0] - r0) <= 8 && Math.abs(px[1] - g0) <= 8 && Math.abs(px[2] - b0) <= 8);
          assert.ok(hit >= from, `${at}: shot ${i + 1}'s picture is in the film, after shot ${i}'s`);
          from = hit + 1;
        }
        // …its SOUND is the one graph's too, sample for sample (every shot has its own tone: a part that began a few
        //  milliseconds off would put one shot's tone over the next shot's)
        const heard = (f: string): Int16Array => { const raw = spawnSync(ff, ["-v", "error", "-i", f, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1"], { encoding: "buffer", maxBuffer: 1 << 26 }).stdout; return new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2)); };
        const sa = heard(oneFile), sb = heard(film);
        assert.ok(Math.abs(sa.length - sb.length) <= 8000 * JOIN_TOLERANCE, `${at}: ${sa.length} and ${sb.length} samples`);
        let off = 0;
        const len = Math.min(sa.length, sb.length);
        for (let k = 0; k < len; k++) if (Math.abs(sa[k] - sb[k]) > 3300) off++;
        assert.ok(off / len < 0.004, `${at}: ${((off / len) * 100).toFixed(2)}% of the sound is not where the one graph has it`);
        // …and its frames are evenly spaced, one every thirtieth of a second, across every part's edge
        const pts = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", film], { encoding: "utf8" }).stdout
          .trim().split(/\r?\n/).map((l) => parseFloat(l)).filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
        assert.equal(pts.length, plan.frames, at);
        for (let k = 1; k < pts.length; k++) assert.ok(Math.abs(pts[k] - pts[k - 1] - 1 / FILM_FPS) < 0.002, `${at}: frame ${k} comes ${(pts[k] - pts[k - 1]).toFixed(4)} s after the one before`);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
