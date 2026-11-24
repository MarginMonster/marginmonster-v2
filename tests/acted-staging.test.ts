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
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTED_STAGINGS, CAMERA_IS_DEALT, EVENT_IDEAS, EVENT_IDEAS_SMALL, EVENT_MAX, EVENT_MAX_LAST, ONE_TAKE, SEEN_AT_THE_END, TWO_ALWAYS,
  clipEvent, clipMoves, dealStagings, eventIdeas, happensBrief, isActedStaging, noRoomIn, sceneEvent, stagedRules, stagedTwoShot,
  stagingClip, stagingPicture, stagingsFor, type ActedStaging,
} from "../app/lib/acted-staging.ts";
import { KLING_PROMPT_MAX, clipRules, fitClipPrompt } from "../app/lib/clip-prompt.ts";
import { WHAT_FRIGHTENS } from "../app/lib/story-picture.ts";

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
  // a horror film's last shot: the thing is IN the picture, in a place of its own — and what frightens is said ONCE
  assert.ok(SEEN_AT_THE_END.startsWith("THE LAST SHOT IS SEEN, NOT SAID — a horror film ends on something the viewer SEES, not on a line about it."));
  assert.ok(SEEN_AT_THE_END.includes("seen the way WHAT FRIGHTENS (below) says such a thing is seen") && SEEN_AT_THE_END.includes("what HAPPENS in that shot is IT"));
  assert.ok(SEEN_AT_THE_END.includes("give that shot a WHERE of its own") && SEEN_AT_THE_END.endsWith("so that its picture is drawn WITH the thing in it."));
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
  assert.ok(eng.includes("let playRules = rules;\n    if (chainStaging) {\n      try {\n        playRules = stagedRules(rules, { staging: chainStaging, event: eventAt(i), eventMax: i === treatment.scenes.length - 1 ? EVENT_MAX_LAST : undefined, others: !turnB && otherName && oSide ? [{ name: otherName, side: oSide }] : [] });\n      } catch (e) {"), "the film's last scene may say more (a horror film's says what is seen, and what it does); and no shot is lost to its staging");
  // a film is never lost to its staging either: with none dealt, every place is drawn as it always was
  assert.ok(eng.includes("    } catch (e) {\n      // (a film is never lost to its staging: with none dealt, every place is drawn as it always was)\n      stagingAt.clear();"));
  // …and the event only for a script whose shots are WRITTEN as things that happen (a script from before this,
  // or one typed by hand, describes a still two-shot — and words about how somebody looks, said to the video
  // engine, redraw their face), and only where the scene's words are one
  assert.ok(eng.includes("const eventAt = (i: number): string => (treatment.events ? sceneEvent(scenesArr.map((s) => s.visual), scenesArr.map((_, j) => locKeyAt(j)), scenesArr.map((s) => s.where || \"\"), i) : \"\");"));
  assert.ok(eng.includes("const fitted = fitClipPrompt({ voice: voiceLine, voiceDesc, ...playRules });"), "…and still built to fit the engine's prompt");
  // a shot in which something is done keeps its mid-line pause (cutting it out would make whoever moves jump)
  assert.ok(eng.includes("if (opts.moves) return t.path;"));
  assert.equal(eng.split("moves: clipMoves(prompt)").length - 1, 2, "the first render and a shot rolled again");
  // ON THE PIECE: which staging each location got, and which each shot was played in
  assert.ok(eng.includes("...(locOrder.some((k) => stagingOf(masters[k])) ? { staging: locOrder.map((k) => ({ where: (whereAt[locFirst.get(k) ?? 0] || \"\").slice(0, 120), as: stagingOf(masters[k]) })) } : {}),"));
  assert.ok(eng.includes("staging: shotStaged[i] || undefined,"));
  assert.ok(eng.includes("shotSeeds.push(seedAbs); shotPrompts.push(prompt); shotDurs.push(clipSecs); shotChained.push(chained); shotStaged.push(chainStaging);"));
});
