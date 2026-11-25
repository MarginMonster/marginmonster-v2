/* WHEN THEY SEE IT, WE SEE IT — AND THE MONSTER HAS ONE FACE.
 *
 * 2026-11-25, one idea rendered six times ("Two friends camping by a quiet lake wake at 3am to someone softly calling
 * their names from the water. When they shine a flashlight, a woman is standing waist-deep in the lake, perfectly still,
 * smiling — and she starts walking toward their tent."). When the writer kept all five shots inside the tent, the woman
 * was NEVER seen: a place's picture is drawn once, from the first scene set there, and every later shot's clip is told
 * "nothing new enters". And the eighth render had everything right until the last shot — the woman in a soaked white
 * dress in the lake, walking toward them — and then the reveal, told in WORDS that she was "the SAME one this film
 * already showed", drew a grey zombie man in the tent opening. The owner: "It looked really good till that last scene
 * bro" — and then: "Monster should be castable also".
 *
 * The cast and every scene below are made up for the test (TEST names), in the shape the writer returns them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NOTHING_GLOWS, PHOTOGRAPHED, REVEAL_MOVED, REVEAL_STAY, SIGHT_MOVES, SIGHT_PICTURE_MAX,
  couldBeThing, figureIn, heardIn, revealClip, revealPicture, sightingClip, sightingOf, sightingPicture, silentRules, stagedRules, stagedTwoShot, storyThreat, thingBound, thingRefNote, threatFromWords, threatPortrait,
} from "../app/lib/acted-staging.ts";
import { clipRules } from "../app/lib/clip-prompt.ts";
import { CREATURE_REAL, DRESSED, SHADOW_SHAPE } from "../app/lib/story-picture.ts";
import { TAKE_HIDDEN } from "../app/lib/take.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

// THE LAKE FILM, five shots all inside the tent ("Who Smiles In Still Water"), written the way the writer writes them
const CAST = [
  "Testa, 29, a woman with short black curls in a grey fleece",
  "Fakeby, 31, a lanky man with a red beard in a flannel shirt",
  "the woman in the lake, a pale woman in a soaked white dress, long black hair, her smile far too wide",
];
const TWO = ["Testa", "Fakeby"];
const TENT = [
  "Inside the tent at 3am, Testa sits up as someone softly calls their names from the water.",
  "Fakeby pulls the flashlight from his pack while Testa unzips the tent flap.",
  "Fakeby shines the flashlight out through the flap: far out in the lake a woman is standing waist-deep, perfectly still, smiling.",
  "The woman starts walking toward the tent, slow, the water falling away from her dress.",
  "She is right behind Fakeby in the tent opening, smiling, water dripping from her hair.",
];
const SIDES = [{ name: "Testa", side: "left" }, { name: "Fakeby", side: "right" }];
const MOOD = "Every living person in it looks tense, wary or afraid — nobody smiles, grins or laughs.";

test("the lake film's own shots: the one where she is SEEN is a sighting — the voice is heard, what the picture has is not new, and the last shot is the reveal's", () => {
  // (each shot's starting picture: the tent's master, drawn from shot 1; after the sighting, the sighting's picture)
  const from = (i: number) => (i <= 2 ? [TENT[0]] : [TENT[0], TENT[2]]);
  // shot 1: "someone softly calls their names" — it is HEARD; and it is the scene the tent's picture is drawn from
  assert.equal(sightingOf({ moment: TENT[0], startedFrom: [TENT[0]], speakers: TWO, cast: CAST }), null);
  assert.equal(sightingOf({ moment: TENT[1], startedFrom: from(1), speakers: TWO, cast: CAST }), null, "nobody else in it");
  // shot 3: she is standing waist-deep in the lake — SEEN, and the tent's picture never had her
  const s = sightingOf({ moment: TENT[2], startedFrom: from(2), speakers: TWO, cast: CAST });
  assert.deepEqual(s, { who: "a woman", entry: CAST[2], words: TENT[2] });
  // shot 4: she walks toward the tent — the picture it grows out of (the sighting's) already has her
  assert.equal(sightingOf({ moment: TENT[3], startedFrom: from(3), speakers: TWO, cast: CAST }), null);
  // shot 5: the film's last horror shot is the REVEAL's
  assert.equal(sightingOf({ moment: TENT[4], startedFrom: [TENT[0]], speakers: TWO, cast: CAST, last: true }), null);
  // …and the shore film, where the writer moved them outside: a NEW place drawn from that scene's own words already has her
  assert.equal(sightingOf({ moment: TENT[2], startedFrom: [TENT[2]], speakers: TWO, cast: CAST }), null, "a shot that only repeats what its picture already has");
  // never a cartoon, never a frame the maker approved
  assert.equal(sightingOf({ moment: TENT[2], startedFrom: [TENT[0]], speakers: TWO, cast: CAST, cartoon: true }), null);
  assert.equal(sightingOf({ moment: TENT[2], startedFrom: [TENT[0]], speakers: TWO, cast: CAST, approved: true }), null);
});

test("what is SEEN and what is not: a voice from the water is heard; the woman the light then finds is seen", () => {
  const at = { startedFrom: ["Inside the tent at night."], speakers: TWO, cast: CAST };
  assert.equal(sightingOf({ ...at, moment: "A woman's voice calls their names softly from the water." }), null, "heard: never drawn");
  const both = sightingOf({ ...at, moment: "A voice calls their names from the water as Fakeby's light finds a woman standing in the lake." });
  assert.ok(both && both.who === "a woman" && both.words.includes("finds a woman standing in the lake") && !both.words.includes("A voice calls"), JSON.stringify(both));
  // somebody's own face, the first thing to hand, a woman who is gone — nobody new
  assert.equal(sightingOf({ ...at, moment: "Fakeby grabs the first thing he can find." }), null);
  assert.equal(sightingOf({ ...at, moment: "Testa's face goes white as Fakeby holds her." }), null);
  assert.equal(sightingOf({ ...at, moment: "Fakeby sweeps the light back across the lake — the woman is gone." }), null);
  assert.equal(sightingOf({ ...at, moment: "Testa holds up the old photo of a smiling man by the lake." }), null, "a picture OF somebody is nobody in the place");
  // a weak word counts only standing, moving, watching
  assert.ok(sightingOf({ ...at, moment: "At the edge of the trees something stands perfectly still." }));
  assert.equal(sightingOf({ ...at, moment: "Shadows fill the tent as the lamp gutters." }), null);
  // "the woman" in a film whose own Testa is "a woman of 29" may be her; an indefinite "a woman" is somebody else
  assert.equal(sightingOf({ ...at, moment: "The woman zips the flap shut with shaking hands." }), null);
  // a cast line that is neither of the two, by its own name
  const named = sightingOf({ ...at, moment: "Fakeby's light finds the woman in the lake, perfectly still." });
  assert.ok(named && named.entry === CAST[2]);
  // two ways of calling one thing are never drawn as two
  assert.equal(sightingOf({ ...at, moment: "The figure stands closer now, at the waterline.", startedFrom: ["Far out in the lake a woman stands waist-deep."] }), null);
  assert.equal(sightingOf({ ...at, moment: "The lady stands at the waterline.", startedFrom: ["Far out in the lake a woman stands waist-deep."] }), null);
  // …but a man after a woman is another one
  assert.ok(sightingOf({ ...at, moment: "Behind her, a man stands under the pines.", startedFrom: ["Far out in the lake a woman stands waist-deep."] }));
  assert.equal(sightingOf({ ...at, moment: "" }), null);
  assert.equal(sightingOf({}), null);
  // the same reading, for a place's picture: is the film's thing in view in this place's first scene?
  assert.deepEqual(figureIn(TENT[2], { speakers: TWO, cast: CAST }), { who: "a woman", entry: CAST[2] });
  assert.equal(figureIn(TENT[0], { speakers: TWO, cast: CAST }), null, "a voice is not in view");
});

test("the sighting's picture: far off, beyond them, clothed, nothing built outdoors — the reveal's own words", () => {
  const p = sightingPicture({ moment: TENT[2], sides: SIDES, seen: CAST[2], outdoors: true, mood: MOOD });
  // the place's picture, kept; the two told apart by their side
  assert.ok(p.startsWith("Edit this photo, a frame from a live-action horror film. Keep the camera and the framing, every window, door and lamp, the furniture and both people exactly as they are, each where they stand, with the same faces, hair and clothes. Testa is the one on the left; Fakeby is the one on the right."));
  // where the words put it: far off, beyond them, small, half in the dark — never between them and the camera, never nearer
  assert.ok(p.includes("Show it like this, and no nearer: FAR OFF beyond the two of them: deep in the picture, small in the frame and half in the dark, seen past them — never between them and the camera, never nearer than these words put it, and well inside the picture."));
  // the two turned toward it, faces still in view, nobody at the lens
  assert.ok(p.includes("Both of them stay where they stand; only their heads have turned toward it, three-quarters, so their faces stay in view — neither looks at the camera."));
  // its look: its own cast line
  assert.ok(p.includes(`What it looks like, as this story has it: "${CAST[2]}".`));
  // clothed — said where she is put in the water too, when the words do not dress her (dressedInWater)
  assert.ok(p.includes(DRESSED));
  const bare = sightingPicture({ moment: "Far out in the lake a woman is standing waist-deep, perfectly still.", sides: SIDES });
  assert.ok(bare.includes("waist-deep, perfectly still. She is fully clothed: a long pale nightgown, soaked and clinging, covering her from neck to knee."), bare);
  // lit only by what is there; photographed — never "a practical-effects creature" for a person-like figure
  assert.ok(p.includes(NOTHING_GLOWS) && p.includes(PHOTOGRAPHED) && !p.includes(CREATURE_REAL) && p.includes(TAKE_HIDDEN));
  assert.ok(!PHOTOGRAPHED.includes("creature") && PHOTOGRAPHED.includes("caught on 35mm film") && PHOTOGRAPHED.includes("Never CGI"));
  assert.ok(sightingPicture({ moment: TENT[2], sides: SIDES, creature: true }).includes(CREATURE_REAL), "a creature the maker chose is photographed as one");
  // out of doors nothing is built into the place; indoors nothing is said of it
  assert.ok(p.includes("This is out of doors: nothing is built into the place — no wall, no plaster, no door and no window is added."));
  assert.ok(!sightingPicture({ moment: TENT[2], sides: SIDES }).includes("out of doors"));
  // the face mood rides along; nothing is dimmed (it is not the reveal)
  assert.ok(p.includes(` ${MOOD} `) && !p.includes("The light has dimmed"));
  assert.ok(p.length <= SIGHT_PICTURE_MAX, `${p.length}`);
  // a very long moment and look still fit what the editors read
  const long = sightingPicture({ moment: `${TENT[2]} ${"The flashlight beam shakes across the black water and the reeds. ".repeat(6)}`, sides: SIDES, seen: CAST[2].repeat(3), outdoors: true, mood: MOOD });
  assert.ok(long.length <= SIGHT_PICTURE_MAX && long.includes("FAR OFF beyond the two of them"), `${long.length}`);
  assert.equal(sightingPicture({ moment: "" }), "");
  // WITH ITS OWN PICTURE as the second image: that exact figure — and its look in words is not said over the picture
  const ref = sightingPicture({ moment: TENT[2], sides: SIDES, seen: CAST[2], outdoors: true, ref: "figure" });
  assert.ok(ref.includes("It is the SAME one this film already showed: the figure in the SECOND picture — that exact figure, the same face, hair and clothes — far off; never a different face or a different creature, and nothing else of the second picture comes with it."));
  assert.ok(!ref.includes("What it looks like, as this story has it"));
});

test("the sighting's clip: told it is there, far off, and the ONE thing it does — slowly; the two stay, the camera stays", () => {
  const live = clipRules({ cartoon: false, sing: false });
  const said = "Far out in the lake a woman is standing waist-deep, perfectly still, smiling, and she starts walking toward the tent.";
  assert.equal(sightingClip(said, "a woman"), `Far off beyond them, already in the picture, is a woman. ${said} ${SIGHT_MOVES}`);
  assert.ok(SIGHT_MOVES.includes("SLOWLY — a few slow steps at most — never running, never reaching, never coming near the camera and never growing"));
  assert.equal(sightingClip("", "a woman"), "");
  for (const staging of ["depth", "walk", "apart"] as const) {
    const r = stagedRules(live, { staging, event: said, sighted: true, sight: "a woman" });
    for (const note of [r.look, r.lookTight, r.lookShort]) {
      assert.ok(note.includes(`As the line is spoken, this happens once: ${sightingClip(said, "a woman")}`) && note.includes(REVEAL_STAY), `${staging}: ${note}`);
    }
    assert.ok(r.look.includes("Nothing else new enters"), "nothing ELSE enters");
    assert.equal(r.steady, live.steady, `${staging}: the camera does not travel away from what they see`);
  }
  // a sighting is never also a sound the shot opens on ("nobody else appears" would be untrue)
  const heard = stagedRules(live, { staging: "depth", event: said, sighted: true, sight: "a woman", heard: true });
  assert.equal(heard.steady, live.steady);
  assert.ok(heard.lookShort.includes(SIGHT_MOVES));
  // nobody speaks in it: the same words, no quotation mark, no "nobody else appears"
  const quiet = silentRules(live, { staging: "depth", event: said, sighted: true, sight: "a woman", unseen: true });
  assert.ok(quiet.lookShort.includes(SIGHT_MOVES) && quiet.lookShort.includes(REVEAL_STAY) && !quiet.look.includes("nobody else appears") && !/["“”]/.test(quiet.look));
  // not a sighting: exactly as before
  assert.deepEqual(stagedRules(live, { staging: "depth", event: said }), stagedRules(live, { staging: "depth", event: said, sighted: false, sight: "a woman" }));
});

test("THE REVEAL FINDS THE SAME ONE — FROM ITS PICTURE: that exact figure, now close behind them; nothing says it is a creature", () => {
  const p = revealPicture({ moment: TENT[4], sides: SIDES, seen: TENT[2], outdoors: true, ref: "figure" });
  assert.ok(p.includes("It is the SAME one this film already showed: the figure in the SECOND picture — that exact figure, the same face, hair and clothes — now close behind them; never a different face or a different creature, and nothing else of the second picture comes with it."));
  // what still described a different creature is out: the generic wrongness, the made-up "too tall", the practical-effects creature
  assert.ok(!p.includes("What is wrong with it") && !p.includes("too tall and too thin") && !p.includes(CREATURE_REAL) && p.includes(PHOTOGRAPHED));
  assert.ok(p.includes("it stands in the dark, almost all of it in shadow; only the pale shape of its face catches the light"));
  assert.ok(p.includes(TAKE_HIDDEN), "mostly hidden asks for no other creature");
  // a figure the film already showed stands — never a face pressed into the wall (the eighth film: "a face pressed into the canvas")
  const indoors = revealPicture({ moment: "Her pale face presses through the wall behind Fakeby, smiling.", sides: SIDES, ref: "figure" });
  assert.ok(!indoors.includes("plaster has been broken open") && indoors.includes("In the dark close behind Fakeby"));
  assert.ok(revealClip("Her pale face presses through the wall behind Fakeby.", { seen: true }).startsWith("In the dark behind them stands the one this film already showed"));
  // the fallback when no portrait would draw: the picture that FIRST showed it, whole — the far-off figure in it, never the two
  const scene = revealPicture({ moment: TENT[4], sides: SIDES, seen: TENT[2], outdoors: true, ref: "scene" });
  assert.ok(scene.includes(`It is the SAME one this film already showed: the far-off figure in the SECOND picture — "${TENT[2]}" — never the two people in that picture: that exact figure, the same face, hair and clothes, now close behind them;`));
  // a creature the maker chose: its own picture, as the reveal always said it — and the creature recipe
  const wolf = revealPicture({ moment: "In the dark behind them, Howlette is there.", sides: SIDES, creature: true, ref: "creature", name: "Howlette" });
  assert.ok(wolf.endsWith(" No text anywhere. What is found is Howlette: the creature in the SECOND picture — that exact creature, its face, its fur or skin and its colours and whatever it wears — drawn INTO the first picture the way this says; everything else in the first picture stays exactly as it is."));
  assert.ok(wolf.includes(CREATURE_REAL));
  // without a picture (the editor that takes one): the words as before
  const words = revealPicture({ moment: TENT[4], sides: SIDES, seen: TENT[2], outdoors: true });
  assert.ok(words.includes(`It is the SAME one this film already showed — "${TENT[2]}" — the same look`) && !words.includes("SECOND picture"));
  for (const x of [p, scene, wolf, words]) assert.ok(x.length < 2400, `${x.length}`);
  // THE SHORE FILM: the place's own picture was drawn with her already far off in the lake — the reveal is one of her,
  // come close, never two (review, 2026-11-25); said only then, and to both editors (it is about the first picture)
  const shore = revealPicture({ moment: TENT[4], sides: SIDES, seen: TENT[2], outdoors: true, ref: "figure", away: true });
  assert.ok(shore.includes(`now close behind them; never a different face or a different creature, and nothing else of the second picture comes with it. ${REVEAL_MOVED} This is out of doors`), shore);
  assert.ok(revealPicture({ moment: TENT[4], sides: SIDES, seen: TENT[2], away: true }).includes(REVEAL_MOVED));
  assert.equal(revealPicture({ moment: TENT[4], sides: SIDES, seen: TENT[2], outdoors: true, ref: "figure", away: false }), p, "not away: exactly as without it");
  assert.ok(shore.length < 2400);
  // the notes themselves
  assert.equal(thingRefNote(null), "");
  assert.ok(thingRefNote("figure").includes("— far off;"), "a sighting's: far off");
});

test("the film's thing: the script's own threat is found by what it IS — never somebody with only a name", () => {
  assert.deepEqual(storyThreat({ cast: CAST, speakers: TWO, last: TENT[4] }), { entry: CAST[2], name: "the woman in the lake", creature: true });
  assert.equal(storyThreat({ cast: ["Lia, 9, a girl in yellow pyjamas", "Theo, 7, her brother", "Mom, who is away at work tonight"], speakers: ["Lia", "Theo"], last: "Mom's car pulls into the drive." }), null, "the mother the idea sends away is not what stands behind them");
  const ghost = storyThreat({ cast: ["Lia, 9", "Theo, 7", "the ghost lady, a tall woman in a grey gown"], speakers: ["Lia", "Theo"] });
  assert.ok(ghost && ghost.name === "the ghost lady" && ghost.creature);
  // of several: a creature first, then the one the last scene names
  assert.equal(storyThreat({ cast: ["Ana, 30", "Bo, 32", "the old man, a fisherman in a yellow coat", "the drowned girl, grey skin, a white nightdress"], speakers: ["Ana", "Bo"] })?.name, "the drowned girl");
  assert.equal(storyThreat({ cast: ["Ana, 30", "Bo, 32", "the stranger, a man in a long coat", "the pale man, bald, too tall"], speakers: ["Ana", "Bo"], last: "The pale man stands in the doorway." })?.name, "the pale man");
  // the two who talk are never it
  assert.equal(storyThreat({ cast: ["the stranger, a man in a long coat", "Bo, 32"], speakers: ["the stranger", "Bo"] }), null);
  assert.equal(storyThreat({}), null);
  // ITS PORTRAIT: the told stories' recipe, dressed, nothing glowing
  const portrait = threatPortrait("the woman in the lake, a pale woman standing waist-deep in the water, long black hair", "a dark horror scene, photorealistic");
  assert.ok(portrait.includes("A wardrobe-test photograph of the woman in the lake") || portrait.includes("A character portrait of the woman in the lake"), portrait);
  assert.ok(portrait.includes("She is fully clothed: a long pale nightgown, soaked and clinging") && portrait.includes(DRESSED) && portrait.endsWith(NOTHING_GLOWS));
  // A PERSON-LIKE THREAT IS PHOTOGRAPHED, never "a practical-effects creature" (review, 2026-11-25): the lake film's own
  // cast line reads as a monster ("her smile far too wide"), and every picture of her after the portrait is "that exact
  // figure" — the portrait must not be the grey zombie the eighth film's reveal drew
  const her = threatPortrait(CAST[2], "a dark horror scene, photorealistic");
  assert.ok(her.includes("A wardrobe-test photograph of the woman in the lake") && her.includes("this ONE figure alone") && her.includes(PHOTOGRAPHED), her);
  assert.ok(!her.includes(CREATURE_REAL) && !/\bcreature\b/i.test(her), her);
  // …a creature by its own name stays one
  const wolf = threatPortrait("the werewolf, huge and lean, with shaggy grey fur", "a dark horror scene, photorealistic");
  assert.ok(wolf.includes(CREATURE_REAL) && wolf.includes("this ONE creature alone"), wolf);
});

test("the film's thing when the script gave it NO cast line: the first figure its words put in view, named where it stands — else the maker's idea (live, 2026-11-25: the ninth lake film had no thing at all)", () => {
  const TWO_ONLY = CAST.slice(0, 2); // the ninth film's writer listed only the two who talk
  const t = threatFromWords({ visuals: TENT, speakers: TWO, cast: TWO_ONLY, names: TWO });
  // shot 1's voice is HEARD (nobody is seen); shot 3's light finds her — named by where she stands, never a bare "the woman",
  // and her look is only the clause that shows HER (never "Fakeby shines the flashlight…": he would be in her portrait)
  assert.deepEqual(t, { entry: "the woman in the lake, a woman is standing waist-deep, perfectly still, smiling.", name: "the woman in the lake", creature: false });
  // …and her portrait is the told stories' recipe in the film's own (photographed) style, dressed, nothing glowing — never
  // a creature's, and nobody but her in it
  const p = threatPortrait(t!.entry, "a dark horror scene, photorealistic");
  assert.ok(p.includes("A character portrait of the woman in the lake") && !p.includes(CREATURE_REAL) && p.includes(DRESSED) && p.endsWith(NOTHING_GLOWS), p);
  assert.ok(!p.includes("Fakeby") && !p.includes("Testa"), p);
  // what she WEARS is never where she is: "in a soaked nightgown" is not a place ("the" takes a place, "a" a garment)
  const worn = threatFromWords({ visuals: ["Far out in the black water, a pale woman in a soaked white nightgown stands waist-deep in the still lake, smiling."], speakers: TWO, cast: TWO_ONLY });
  assert.equal(worn?.name, "the woman in the water");
  assert.ok(worn!.entry.includes("a pale woman in a soaked white nightgown"), worn!.entry);
  // THE NINTH LAKE FILM'S OWN SCRIPT (live, 2026-11-25, its words as the engine stored them): only the two in "cast"; the
  // light finds "a pale, motionless figure"; the next scene and the lines call her a woman. She is the woman in the lake —
  // never "the figure across the black water", never drawn by the creature recipe, and Yuri is never in her portrait
  const V9_CAST = ["Yuri, a lanky 28-year-old with a scruffy beard, round wire glasses, a faded flannel shirt and a battered green headlamp", "Wilfred, a stocky 30-year-old with a buzz cut, a thick canvas jacket, a scar through one eyebrow and a wristwatch with a cracked face"];
  const V9_SEEN = [
    "A soft, breathy voice calls 'Yuri...Wilfred...' twice from the lake; Yuri bolts upright, Wilfred grips the sleeping bag.",
    "Wilfred unzips the tent flap an inch, cold air rushing in, while Yuri clutches the flashlight tight.",
    "Yuri switches on the flashlight, its beam cutting across the black water toward a pale, motionless figure, waist-deep, smiling.",
    "The woman glides forward through the shallows without a ripple as Wilfred yanks the zipper down, sealing the flap.",
    "Beside Yuri, the tent flap hangs open a hand's width, and the woman's face fills the gap, skin pale as candle wax, smiling far too wide, eyes unblinking.",
  ];
  const V9_SAID = ["Yuri: Did you hear that? Someone said our names, right out there on the water.", "Wilfred: It's probably just the wind on the water, Yuri. Don't open that light yet.", "Yuri: Wilfred, look— there's a woman standing out there, and she isn't moving at all.", "Wilfred: She's coming toward us, Yuri— zip it, zip it now, don't look at her.", ""];
  const v9 = threatFromWords({ visuals: V9_SEEN, said: V9_SAID, idea: "Two friends camping by a quiet lake wake at 3am to someone softly calling their names from the water. When they shine a flashlight, a woman is standing waist-deep in the lake, perfectly still, smiling — and she starts walking toward their tent.", speakers: ["Yuri", "Wilfred"], cast: V9_CAST, names: ["Yuri", "Wilfred"] });
  assert.deepEqual(v9, { entry: "the woman in the lake, a pale, motionless woman, waist-deep, smiling.", name: "the woman in the lake", creature: false });
  const v9p = threatPortrait(v9!.entry, "a dark, moody, cinematic horror scene, photorealistic");
  assert.ok(!v9p.includes(CREATURE_REAL) && !/\bcreature\b/i.test(v9p) && !v9p.includes("Yuri"), v9p);
  // …and one line about a man walking past never makes her a man (the words vote; the maker's idea twice)
  assert.equal(threatFromWords({ visuals: [...V9_SEEN.slice(0, 3), "A man walks past the tent with a lantern.", ...V9_SEEN.slice(3)], said: V9_SAID, idea: "a woman is standing waist-deep in the lake", speakers: ["Yuri", "Wilfred"], cast: V9_CAST })?.name, "the woman in the lake");
  // a voice from out of sight is nobody seen; a shadow is drawn as a shadow, never as the thing's face
  assert.equal(threatFromWords({ visuals: [TENT[0], TENT[1]], speakers: TWO, cast: TWO_ONLY }), null);
  assert.equal(threatFromWords({ visuals: ["A shadow stands under the old tree, watching."], speakers: TWO, cast: TWO_ONLY }), null);
  // a figure with a cast line of its own is storyThreat's to judge ("Mom" is no thing) — never taken here
  assert.equal(threatFromWords({ visuals: ["Mom stands in the doorway with the car keys."], speakers: ["Lia", "Theo"], cast: ["Lia, 9", "Theo, 7", "Mom, who is away at work"] }), null);
  // nothing seen in any scene: the maker's own idea names it
  const fromIdea = threatFromWords({ visuals: [TENT[0], TENT[1]], idea: "Two friends camping by a quiet lake wake at 3am to someone softly calling their names from the water. When they shine a flashlight, a woman is standing waist-deep in the lake, perfectly still, smiling.", speakers: TWO, cast: TWO_ONLY });
  assert.equal(fromIdea?.name, "the woman in the lake");
  // a creature by what it is keeps the creature recipe
  assert.equal(threatFromWords({ visuals: ["At the tree line a ghost stands watching the tent."], speakers: TWO, cast: TWO_ONLY })?.creature, true);
});

test("which figure with no cast line of its own may be drawn as the film's thing — never somebody the words make else, never a shadow", () => {
  // (review, 2026-11-25: a third person the words name in a horror shot was handed the woman's portrait — "that exact
  //  figure, the same face, hair and clothes" — where the words say a man)
  const lady = CAST[2];
  assert.equal(couldBeThing("A man", lady), false, "a man is not the woman in the lake");
  assert.equal(couldBeThing("a boy", "the pale woman, grey dress"), false);
  assert.ok(couldBeThing("a woman", lady) && couldBeThing("the lady", lady) && couldBeThing("a girl", lady));
  assert.ok(couldBeThing("Something", lady) && couldBeThing("a figure", lady) && couldBeThing("a pale face", lady), "anything not said to be somebody else may be it");
  assert.ok(couldBeThing("a man", "Howlette a TEST werewolf with grey fur") && couldBeThing("a woman", ""), "a thing with no sex in its words: anything may be it");
  // a shadow is drawn as a shadow (SHADOW_SHAPE): never with the thing's face, hair and clothes
  assert.equal(couldBeThing("A shadow", lady), false);
  assert.equal(couldBeThing("a shape", ""), false);
  // …and its sighting says so, in the told stories' own sentence
  const shadow = sightingPicture({ moment: "A shadow moves slowly past the tent, watching.", sides: SIDES });
  assert.ok(shadow.includes(`FAR OFF beyond the two of them: deep in the picture, small in the frame and half in the dark, seen past them — never between them and the camera, never nearer than these words put it, and well inside the picture. ${SHADOW_SHAPE}`), shadow);
  assert.ok(!sightingPicture({ moment: TENT[2], sides: SIDES }).includes(SHADOW_SHAPE), "nobody else is told of a shadow");
});

test("the engine: the thing's one picture before the first shot, the sighting's seed and cut, its clip, its checkpoint, the reveal from the picture", () => {
  const eng = read("app", "lib", "film-dialogue.server.ts");
  const loop = eng.indexOf("for (let i = clips.length; i < treatment.scenes.length; i++) {");
  // THE THING, found or drawn ONCE, before the first shot — the maker's cast threat first; a horror film's chosen creature
  // no longer needs the last scene to name it; else the script's own, whose portrait is drawn, looked at and kept
  const thingAt = eng.indexOf("const sightOn = staged && horror && !cartoon && isTwoHander;");
  assert.ok(thingAt > 0 && thingAt < loop, "before the shots");
  // (…never one of the two who talk: a cast threat the script gave lines to is not the thing — review, 2026-11-25)
  assert.ok(eng.includes("const speaks = (c: { name: string }): boolean => [spkA, spkB].some((s) => !!s && nameTok(s) === nameTok(c.name));"));
  assert.ok(eng.includes("const named = (chosen && !speaks(chosen) ? chosen : null) || castActors.find((c) => !!c.faceUrl && isCreature(c) && !speaks(c));"));
  assert.ok(eng.includes("const own = storyThreat({ cast: treatment.cast, speakers: [spkA, spkB], last: scenesArr[scenesArr.length - 1]?.visual })"));
  // (…and when the script gave its thing no cast line — the ninth lake film, live 2026-11-25 — the first figure its words
  //  put in view, else the maker's own idea: the film never goes without its thing because the writer forgot a line)
  assert.ok(eng.includes("|| threatFromWords({ visuals: scenesArr.map((s) => s.visual), said: scenesArr.map((s) => s.caption), idea: opts.topic, speakers: [spkA, spkB], cast: treatment.cast, names: peopleNames });"));
  // (every list of NAMES the staging reads is the film's people's — never its thing: "the woman in the lake" as a name made
  //  heardIn read "the", "in", "woman" and "lake" as names, and a voice from the water came out seen — monster row review)
  assert.ok(eng.includes('const peopleNames = castActors.filter((c) => c.role !== "threat").map((c) => c.name);'));
  assert.ok(!eng.includes("castActors.map((c) => c.name)"), "no list of names with the thing in it");
  assert.equal(heardIn("A voice calls their names softly from the water.", ["Mara", "Jonah"])?.unseen, true);
  assert.ok(eng.includes("for (const model of kept ? [] : STORY_LADDER) {") && eng.includes("storyPictureInput(model, { prompt: threatPortrait(own.entry, tmpl.sceneHint), refs: [], aspect: PORTRAIT_ASPECT })"), "the told stories' portrait recipe and ladder");
  assert.ok(eng.includes("img = (await clothedOrDropped(drawn, PORTRAIT_ASPECT)) || \"\";"), "looked at for an unclothed figure");
  assert.ok(eng.includes("if (!kept) await ckpt({ ckThreat: JSON.stringify(threat) });"), "kept: a restarted film does not draw it twice");
  assert.ok(eng.includes("k.from === \"story\" && k.entry === own.entry && onDisk(k.img)"), "…and a kept one is only taken for the same thing, still on disk");
  // the clothed look: edited once, or dropped — never a film lost to it (since 2026-11-25 the ONE look every film picture
  // has — clothed.server.ts → keepClothed, whose look keeps a picture it cannot read: tests/clothed.test.ts)
  assert.ok(eng.includes("const kept = await keepClothed({ url: rel, ref: (u) => abs(u) || u, edit: (u, bare) => clothedEditOn(u, bare, ar), still: \"drop\", log: (l) => console.log(`[testmovie] ${l}`) });"));
  assert.ok(read("app", "lib", "clothed.server.ts").includes("} catch { return NOBODY; }"), "a look that cannot be made keeps the picture");
  // what the worker does not hand over is read from the job's own row
  assert.ok(eng.includes("ckThreat?: string; ckSightings?: string };"));
  assert.ok(eng.includes("const r = JSON.parse(resume.ckSightings ?? (await keptOnJob(\"ckSightings\")) ?? \"null\");"));
  // THE SIGHTING: after the reveal (which owns the last shot), before the seed branches; on the reveal's editor ladder,
  // from the place AS IT NOW IS, the thing's own picture second where it is the film's thing
  const reveal = eng.indexOf("if (!seedAbs && lastHorror && master?.url && stagingOf(master)) {", loop);
  const sight = eng.indexOf("if (!seedAbs && sightOn && !lastHorror && master?.url && stagingOf(master)) {", loop);
  const branches = eng.indexOf("if (!seedAbs && master?.url) {", loop);
  assert.ok(reveal > loop && sight > reveal && branches > sight);
  assert.ok(eng.includes("const s = sightingOf({ moment: eventAt(i), startedFrom: startedFrom(i, tr), speakers: [spkA, spkB], cast: thingCast, names: peopleNames, last: lastHorror, cartoon, approved: !!approvedFrames[i] });"));
  assert.ok(eng.includes("const base = abs(shownAt(i) || master.url);"));
  const pro = eng.indexOf("[\"google/nano-banana-pro\", { prompt: ask, image_input: [base, ...(ref ? [ref.url] : [])], aspect_ratio: aspect, output_format: \"jpg\", resolution: \"2K\" }],", sight);
  const kontext = eng.indexOf("[\"black-forest-labs/flux-kontext-pro\", { prompt: askOne, input_image: base, aspect_ratio: aspect, output_format: \"jpg\", output_quality: 92 }],", sight);
  const seedream = eng.indexOf("[\"bytedance/seedream-4.5\", { prompt: ask, image_input: [base, ...(ref ? [ref.url] : [])], aspect_ratio: aspect, size: \"2K\", max_images: 1 }],", sight);
  assert.ok(pro > sight && kontext > pro && seedream > kontext && seedream < branches, "nano-banana-pro, then flux-kontext-pro (never told of a second picture), then Seedream 4.5");
  assert.ok(eng.includes("const drawn = await removeLetterbox(await persistRemote(await repRun(model, input, 180_000), \"jpg\"));") && eng.includes("pic = drawn ? (await clothedOrDropped(drawn, aspect)) || \"\" : \"\";"), "letterbox off, clothed or dropped");
  // its picture is checkpointed the moment it is drawn, and a restarted film takes it back
  assert.ok(eng.includes("let pic = sightings[i]?.url && sightings[i].words === s.words ? sightings[i].url : \"\";"));
  // (…and since S12 whether it was only its shadow on a shut tent's cloth — never then the thing's picture)
  assert.ok(eng.includes("sightings[i] = { url: pic, words: s.words, who: s.who, entry: s.entry, ...(sightShadow ? { shadow: true } : {}) };\n            await ckpt({ ckSightings: JSON.stringify(sightings) });"));
  assert.ok(eng.includes("seedAbs = abs(pic); sighted = s; sinceAnchor = 0;"));
  // the cut into it is a straight one; its staging is the place's; it is never also a sound shot; its clip is told so
  assert.ok(eng.includes("if (i > 0 && !chained && (tr === \"location\" || revealed || !!sighted)) hardSeams.add(i);"));
  assert.ok(eng.includes("(tr === \"angle\" && !sighted) ? null : stagingOf(master);"));
  assert.ok(eng.includes("&& !implied && !revealed && !sighted ? heardIn("));
  assert.equal(eng.split("sighted: !!sighted, sight: sighted?.who, shadow: sightedShadow, cloth });").length - 1, 2, "said to a talking shot and to one nobody speaks in");
  // what was seen stays seen: a new angle or a re-anchor in that place grows out of the place AS IT NOW IS
  assert.equal(eng.split("abs(shownAt(i) || master.url)!, [faceFor(spkA), faceFor(spkB)]").length - 1, 2);
  // a place whose first scene has the thing in view is drawn with its picture; the first picture that showed it is kept
  assert.ok(eng.includes("const thingHere = !masters[locKeyAt(i)]?.url && thingInMaster(i, lastHorror);"));
  assert.ok(eng.includes("if (thingHere && master?.url && !firstShown) firstShown = { url: master.url, words: scene.visual || \"\" };"));
  // (never a shadow on the cloth — S12)
  assert.ok(eng.includes("if (!firstShown && !sightings[i]?.shadow && isTheThing(s.entry, s.who)) firstShown = { url: pic, words: s.words };"));
  // (…and which figure IS the thing: its cast line by its NAME, or one with no line that its words do not make somebody
  //  else or a shadow — couldBeThing; review, 2026-11-25)
  assert.ok(eng.includes("const isTheThing = (entry: string, who = \"\"): boolean => (!entry ? couldBeThing(who, thingWords) : !!threatEntry && lineName(entry) === lineName(threatEntry));"));
  assert.ok(eng.includes("const theThing = isTheThing(s.entry, s.who);") && eng.includes("return !!f && isTheThing(f.entry, f.who);") && eng.includes("if (sightings[j] && !sightings[j].shadow && isTheThing(sightings[j].entry, sightings[j].who))"));
  // THE REVEAL from the thing's picture: its portrait, else the picture that first showed it
  assert.ok(eng.includes("const thingRef = (): { url: string; kind: ThingRef } | null => (threat ? { url: abs(threat.img) || threat.img, kind: threat.creature ? \"creature\" : \"figure\" } : firstShown ? { url: abs(firstShown.url) || firstShown.url, kind: \"scene\" } : null);"));
  assert.ok(eng.includes("revealSeen = !!seen || (!!ref && !creatureRef);"));
  // ON THE PIECE: who the monster was
  // (…and, since S10b, its look and whether it is a creature: Part 2 carries it — film-series.ts → seriesCarryOf)
  assert.ok(eng.includes("...(threat ? { threat: { name: threat.name, img: threat.img, from: threat.from, ...(threat.look ? { look: threat.look.slice(0, 200) } : {}), ...(threat.creature ? { creature: true } : {}) } } : {}),"));
});

test("a place whose first scene has the thing in view is drawn with its picture, bound by name like a cast member's photo", () => {
  const note = thingBound({ name: "the woman in the lake", refNo: 4, look: "a pale woman in a soaked white dress" });
  assert.equal(note, " THE ONE THEY FEAR: reference image 4 is the woman in the lake and ONLY the woman in the lake (a pale woman in a soaked white dress). Where this moment has the woman in the lake, the woman in the lake is drawn EXACTLY as in that picture — the same face, hair and clothes — and only as much of the woman in the lake as the moment shows; nothing else of that picture comes into this one, and the woman in the lake is never one of the two.");
  assert.equal(thingBound({ name: "", refNo: 4 }), "");
  assert.equal(thingBound({ name: "x", refNo: 0 }), "");
  // said in the staged master's prompt, after the cast's own binding
  const staged = stagedTwoShot({ staging: "depth", setting: "a tent by a lake at night", personA: "Testa", personB: "Fakeby", act: TENT[2], consistency: "Keep them distinct.", faceNote: " WHO IS WHO: x.", thingNote: note, comp: "wide cinematic landscape composition" });
  assert.ok(staged.includes(` WHO IS WHO: x.${note} Cinematic filmic lighting`));
  // and nothing changes without one
  assert.ok(!stagedTwoShot({ staging: "depth", setting: "a tent", personA: "Testa", personB: "Fakeby", consistency: "c", comp: "c" }).includes("THE ONE THEY FEAR"));
  // the master's whole prompt: image-generation passes it — in a STAGED picture only (the close two-shot's own prompt is
  // pinned letter for letter in acted-staging.test.ts) — and keeps its clothed and night looks exactly as they were
  const ig = read("app", "lib", "image-generation.server.ts");
  assert.ok(ig.includes("const thingNote = opts.thing && refNo(opts.thing.url) ? thingBound({ name: opts.thing.name, refNo: refNo(opts.thing.url), look: opts.thing.look }) : \"\";"));
  assert.ok(ig.includes("const refs = [opts.roomRefUrl, opts.faceA, opts.faceB, opts.staging ? opts.thing?.url : null].filter((u): u is string => !!u).slice(0, 4);"));
  // (…and the genre's own world after it, stream S8 2026-11-25: tests/clothed.test.ts)
  assert.ok(ig.includes("roomNote, faceNote, thingNote, comp, ownWorld: opts.ownWorld })") && !ig.includes("${faceNote}${thingNote}"));
  assert.ok(ig.includes("action?: string; /** THE FILM'S THING") && ig.includes("thing?: { url: string; name: string; look?: string } | null;"));
  // (the clothed look is the one every film picture has since 2026-11-25 — clothed.server.ts → keepClothed, the same steps)
  assert.ok(ig.includes("url = (await keepClothed({") && ig.includes("if (!cartoon && NIGHT_SAID.test(`${setting} ${action}`)) {"), "the clothed and the night looks, as they were");
});
