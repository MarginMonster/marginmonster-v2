/* THE HORROR FILM, WORD FOR WORD — the inputs whose outputs are held in tests/horror-golden.json.
 *
 * 2026-11-26, the owner: "The new ones should basically be a clone of the best section we have with genre changing
 * prompt suggestions" — every acted genre now runs the Horror Film's sighting-and-reveal machinery for its own
 * "figure" (acted-staging.ts → plain wording). Horror itself must not move by a byte: these are horror inputs to every
 * function that machinery touches, and the JSON beside this file is what each one returned BEFORE the generalization
 * (written once from the tree before it — tests/horror-golden.test.ts compares). Names are made up for the test. */
import {
  couldBeThing, faceNote, figureIn, revealClip, revealPicture, sightingClip, sightingOf, sightingPicture, silentRules, stagedRules,
  storyThreat, thingBound, thingRefNote, threatFromWords, threatPortrait,
} from "../app/lib/acted-staging.ts";
import { clipRules } from "../app/lib/clip-prompt.ts";

const HORROR_MOOD = "Every living person in it looks tense, wary or afraid — nobody smiles, grins or laughs.";
const HINT = "a dark, moody, cinematic horror scene, photorealistic like a frame from a live-action horror film";
const sides = [{ name: "Testa", side: "left" }, { name: "Quill", side: "right" }];
const CAST = ["Testa, a woman of 28 with a red bob", "Quill, a man of 30 in a green parka", "the woman in the lake, pale, a soaked white nightgown, a smile far too wide"];
const live = clipRules({ cartoon: false, sing: false, horror: true });
const glowless = clipRules({ cartoon: false, sing: false, horror: true, noGlow: true });

/** Every case: a name, and what it returns. */
export const HORROR_CASES: Record<string, () => unknown> = {
  clipRules: () => live,
  clipRulesNoGlow: () => glowless,
  revealWall: () => revealPicture({ moment: "Three knocks from inside the wall behind Quill; a face presses into a hole in the plaster.", mood: HORROR_MOOD, sides }),
  revealWallHand: () => revealPicture({ moment: "Long fingers curl over the edge of a hole in the wall behind Testa.", mood: HORROR_MOOD, sides }),
  revealDoor: () => revealPicture({ moment: "The bedroom door eases open on the dark and a tall shape stands in the gap.", mood: HORROR_MOOD, sides }),
  revealWindow: () => revealPicture({ moment: "A pale face presses to the dark window glass.", mood: HORROR_MOOD, sides }),
  revealFigure: () => revealPicture({ moment: "Something stands in the corner of the room, perfectly still.", mood: HORROR_MOOD, sides }),
  revealOutdoorsSeen: () => revealPicture({ moment: "She is close behind Quill now, dripping.", mood: HORROR_MOOD, sides, seen: "a woman waist-deep in the lake, smiling", outdoors: true }),
  revealRefFigureAway: () => revealPicture({ moment: "She stands close behind Testa.", mood: HORROR_MOOD, sides, seen: "a woman waist-deep in the lake", outdoors: true, ref: "figure", name: "the woman in the lake", away: true }),
  revealRefScene: () => revealPicture({ moment: "She stands close behind Testa.", mood: HORROR_MOOD, sides, seen: "a woman waist-deep in the lake", ref: "scene" }),
  revealCreatureRef: () => revealPicture({ moment: "The werewolf is at the door.", mood: HORROR_MOOD, sides, creature: true, ref: "creature", name: "Howl" }),
  revealCloth: () => revealPicture({ moment: "Her hands press the tent wall from outside.", mood: HORROR_MOOD, sides, seen: "a woman in the lake", outdoors: true, cloth: true, tent: true, state: "The tent door is zipped completely shut. The duffel bag is wedged against it." }),
  revealClothRoof: () => revealPicture({ moment: "The roof sags as she lies on it.", mood: HORROR_MOOD, sides, cloth: true, tent: true }),
  revealClothZipper: () => revealPicture({ moment: "The zipper is drawn up a hand's width from outside.", mood: HORROR_MOOD, sides, cloth: true, tent: true, state: "The tent door is zipped shut." }),
  revealLong: () => revealPicture({ moment: "x ".repeat(400), mood: HORROR_MOOD, sides, seen: "y ".repeat(200), state: "z. ".repeat(200), ref: "figure", away: true }),
  revealEmpty: () => revealPicture({ moment: "" }),
  revealClipWall: () => revealClip("a face in a hole in the wall"),
  revealClipSeen: () => revealClip("she stands behind them", { seen: true, outdoors: true }),
  revealClipCreature: () => revealClip("the werewolf at the door", { creature: true }),
  revealClipCloth: () => revealClip("her shadow on the cloth", { cloth: true }),
  sightPlain: () => sightingPicture({ moment: "A woman stands waist-deep in the lake, smiling.", sides, outdoors: true, mood: HORROR_MOOD }),
  sightRef: () => sightingPicture({ moment: "The woman in the lake walks toward the tent.", sides, seen: CAST[2], outdoors: true, mood: HORROR_MOOD, ref: "figure", name: "the woman in the lake" }),
  sightCreature: () => sightingPicture({ moment: "Howl stands at the treeline.", sides, mood: HORROR_MOOD, creature: true, ref: "creature", name: "Howl" }),
  sightShadow: () => sightingPicture({ moment: "A shadow moves along the tent wall.", sides, seen: CAST[2], mood: HORROR_MOOD, shadow: true, state: "The tent door is zipped shut." }),
  sightScene: () => sightingPicture({ moment: "The figure is there again.", sides, seen: "a woman in the lake", ref: "scene" }),
  sightLong: () => sightingPicture({ moment: "w ".repeat(400), sides, seen: "v ".repeat(200), mood: HORROR_MOOD, state: "s. ".repeat(250) }),
  sightClip: () => sightingClip("A woman stands in the lake.", "a woman"),
  sightClipShadow: () => sightingClip("A woman stands in the lake.", "the woman in the lake", true),
  sightClipNoWho: () => sightingClip("Something moves in the reeds."),
  stagedRevealDrawn: () => stagedRules(live, { staging: "depth", event: "A face in a hole in the wall behind Quill.", reveal: true, drawn: true }),
  stagedRevealNotDrawn: () => stagedRules(live, { staging: "apart", event: "A tall shape in the doorway.", reveal: true }),
  stagedRevealSeenOutdoors: () => stagedRules(live, { staging: "walk", event: "She stands behind them.", reveal: true, drawn: true, seen: true, outdoors: true }),
  stagedRevealCloth: () => stagedRules(live, { staging: "depth", event: "Her shadow on the tent.", reveal: true, drawn: true, cloth: true }),
  stagedImplied: () => stagedRules(live, { staging: "levels", event: "x", reveal: true, implied: true }),
  stagedSighted: () => stagedRules(live, { staging: "depth", event: "A woman stands in the lake.", sighted: true, sight: "a woman" }),
  stagedSightedShadow: () => stagedRules(live, { staging: "depth", event: "A woman stands in the lake.", sighted: true, sight: "the woman in the lake", shadow: true }),
  stagedHeard: () => stagedRules(live, { staging: "across", event: "Three slow knocks from inside the wall.", heard: true }),
  stagedPlainEvent: () => stagedRules(live, { staging: "doing", event: "Testa pulls the drawer out and empties it.", others: [{ name: "Quill", side: "right" }] }),
  silentRevealDrawn: () => silentRules(live, { staging: "depth", event: "A face in a hole in the wall.", reveal: true, drawn: true, face: "Nobody smiles at any moment: every face shows fear.", sides }),
  silentRevealNotDrawn: () => silentRules(live, { staging: "depth", event: "A tall shape in the dark.", reveal: true, sides }),
  silentImplied: () => silentRules(live, { staging: "apart", event: "x", reveal: true, implied: true }),
  silentSighted: () => silentRules(live, { staging: "depth", event: "A woman stands in the lake.", sighted: true, sight: "a woman", unseen: true }),
  silentSightedShadow: () => silentRules(live, { staging: "depth", event: "A woman stands in the lake.", sighted: true, sight: "a woman", shadow: true }),
  silentBare: () => silentRules(live),
  thingBound: () => thingBound({ name: "the woman in the lake", refNo: 3, look: "pale, a soaked white nightgown" }),
  thingBoundNoLook: () => thingBound({ name: "Howl", refNo: 2 }),
  thingRefFigure: () => thingRefNote("figure", { near: true }),
  thingRefSceneFar: () => thingRefNote("scene", { seen: "a woman in the lake" }),
  thingRefCreatureCloth: () => thingRefNote("creature", { name: "Howl", near: true, cloth: true }),
  threatPortraitWoman: () => threatPortrait(CAST[2], HINT),
  threatPortraitGhost: () => threatPortrait("the ghost, a grey thing with a too-wide smile", HINT),
  faceHorror: () => faceNote({ horror: true, tone: "whispering", visual: "Testa backs away.", speaker: "Testa", other: "Quill", mood: HORROR_MOOD }),
  faceHorrorWarm: () => faceNote({ horror: true, tone: "warmly", visual: "", speaker: "Testa", other: "Quill" }),
  faceHorrorNobody: () => faceNote({ horror: true, mood: HORROR_MOOD }),
  storyThreat: () => storyThreat({ cast: CAST, speakers: ["Testa", "Quill"], last: "She stands behind them." }),
  storyThreatNone: () => storyThreat({ cast: ["Testa, a woman", "Quill, a man", "Mrs. Hale, their landlady"], speakers: ["Testa", "Quill"] }),
  threatFromWords: () => threatFromWords({ visuals: ["Testa and Quill zip the tent.", "A pale, motionless figure stands waist-deep in the lake, smiling."], said: ["There's a woman out there."], speakers: ["Testa", "Quill"], cast: CAST.slice(0, 2), names: ["Testa", "Quill"] }),
  sightingOf: () => sightingOf({ moment: "Quill shines the torch: a woman stands in the lake.", startedFrom: ["Testa and Quill sit in the tent."], speakers: ["Testa", "Quill"], cast: CAST, names: ["Testa", "Quill"] }),
  sightingOfLast: () => sightingOf({ moment: "a woman stands in the lake", last: true }),
  figureIn: () => figureIn("The woman in the lake stands at the waterline.", { speakers: ["Testa", "Quill"], cast: CAST }),
  couldBe: () => [couldBeThing("a man", "the woman in the lake"), couldBeThing("a figure", "the woman"), couldBeThing("a shadow", "")],
};
