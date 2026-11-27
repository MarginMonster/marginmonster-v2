/* EVERY ACTED GENRE'S FIGURE — THE HORROR FILM'S MACHINERY, IN PLAIN WORDS (2026-11-26).
 *
 * The owner: "The new ones should basically be a clone of the best section we have with genre changing prompt
 * suggestions" · "horror is likely the most accurate for everything". The Horror Film could bring one more into a place
 * after its picture was drawn — glimpsed far off (the SIGHTING), then found close in the last shot (the REVEAL), drawn
 * from that one's own portrait. Now a Drama, Comedy, Thriller, Action, Romance, Sci-Fi, Fantasy, Mystery or Moral film
 * does the same for its FIGURE (the Duchess who walks in, the culprit, the one they wait for) — and only the words
 * differ: a person seen plainly, the two reacting the way the genre's faces say. No fear, no creature, nothing wrong.
 * Horror's own words: tests/horror-golden.test.ts. Names are made up for the test (TEST names).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIGURE_AT_DOOR, FIGURE_AT_THE_END, FIGURE_COMES, FIGURE_FAR, FIGURE_FAR_MOVES, FIGURE_GENRES, FIGURE_MOVED, FIGURE_MOVES, FIGURE_NEAR, FIGURE_REACT,
  FIGURE_SEEN, FIGURE_UNSEEN_REACT, KEEP_FRAME_PLAIN, REVEAL_MOVES, REVEAL_PICTURE_MAX, REVEAL_REACT, REVEAL_STAY, REVEAL_UNSEEN_REACT, SIGHT_MOVES, SIGHT_PICTURE_MAX,
  figureGenre, figurePortrait, revealClip, revealPicture, sightingClip, sightingPicture, silentRules, stagedRules, storyFigure, thingBound, thingRefNote,
} from "../app/lib/acted-staging.ts";
import { clipRules } from "../app/lib/clip-prompt.ts";
import { CREATURE_REAL } from "../app/lib/story-picture.ts";
import { TAKE_HIDDEN } from "../app/lib/take.ts";
import { GENRE_FILMS } from "../app/lib/film-genres.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

/** Horror's words, which no figure picture or clip may carry. */
const HORROR_WORDS = /\bhorror\b|\bfear|afraid|frighten|creature|\bwrong\b|FREEZE|frozen|\bshadow|candle|in the dark|drained|scream/i;
const DRAMA_MOOD = "Faces show what each one feels: quiet, real, never posed.";
const sides = [{ name: "Testa", side: "left" }, { name: "Quill", side: "right" }];
// A DRAMA: the two wait for the Duchess; she is glimpsed on the terrace, then walks in at the end
const CAST = ["Testa, a woman of 34 in a navy suit", "Quill, a man of 36 in a grey cardigan", "the Duchess, a woman in her seventies, silver hair in a low knot, a long dark-green coat"];
const VISUALS = [
  "Testa sets two cups on the tray while Quill straightens the chairs.",
  "Quill pulls the curtain back: the Duchess stands far off on the terrace, looking in.",
  "Testa smooths the tablecloth as Quill checks the clock.",
  "The drawing-room door opens and the Duchess steps in, looking at the two of them.",
];
const live = clipRules({ cartoon: false, sing: false });

test("which genres have a figure: every acted genre but horror — never the Kids Cartoon, never a told story's", () => {
  for (const k of ["testmovie", "moral", ...GENRE_FILMS.map((g) => g.key)]) assert.ok(figureGenre(k), k);
  assert.equal(FIGURE_GENRES.length, 9);
  for (const k of ["horror", "kidstv", "kidsmusicvideo", "musicvideo", "shortfilm", "avatardialogue", "", undefined]) assert.equal(figureGenre(k as string), false, String(k));
});

test("the script's figure: a cast line after the two that a shot shows by name — never a name no shot shows", () => {
  const f = storyFigure({ cast: CAST, speakers: ["Testa", "Quill"], visuals: VISUALS, last: VISUALS[3] });
  assert.deepEqual(f, { entry: CAST[2], name: "the Duchess", creature: false });
  // a name on the cast list that no shot shows is no figure: the film is made exactly as before
  assert.equal(storyFigure({ cast: [...CAST.slice(0, 2), "Mom, a woman in her sixties"], speakers: ["Testa", "Quill"], visuals: VISUALS }), null);
  // never one of the two who talk; no cast beyond the two → none
  assert.equal(storyFigure({ cast: CAST.slice(0, 2), speakers: ["Testa", "Quill"], visuals: VISUALS }), null);
  // of two, the one the last scene names
  const two = storyFigure({ cast: [...CAST, "Marlow, a man of 50 in a raincoat"], speakers: ["Testa", "Quill"], visuals: [...VISUALS, "Marlow waits at the gate."], last: "Marlow walks in." });
  assert.equal(two?.name, "Marlow");
  // any person, not only a horror film's figure words ("the Duchess" has none)
  assert.ok(!/\b(?:woman|man|figure)\b/.test("the Duchess"));
});

test("the REVEAL picture of a figure: the place's own picture, the person added plainly where the moment puts them", () => {
  const p = revealPicture({ moment: VISUALS[3], mood: DRAMA_MOOD, sides, plain: true });
  assert.ok(p.startsWith(KEEP_FRAME_PLAIN), "the horror film's keep-the-frame, without 'horror'");
  assert.ok(p.includes("Testa is the one on the left; Quill is the one on the right."));
  assert.ok(p.includes(VISUALS[3]) && p.includes(FIGURE_AT_DOOR), "at the door the moment names");
  assert.ok(p.includes(DRAMA_MOOD), "the genre's own faces");
  assert.ok(!HORROR_WORDS.test(p), p);
  assert.ok(!p.includes(CREATURE_REAL) && !p.includes(TAKE_HIDDEN));
  // anywhere else, a few steps from them; and out of doors nothing is built
  const near = revealPicture({ moment: "The Duchess stands beside the fountain.", sides, outdoors: true, plain: true });
  assert.ok(near.includes(FIGURE_NEAR) && near.includes("nothing is built into the place"));
  // from her own portrait — that exact person, plainly
  const ref = revealPicture({ moment: VISUALS[3], sides, ref: "figure", name: "the Duchess", plain: true, away: true });
  assert.ok(ref.includes("It is the SAME person this film already showed: the one in the SECOND picture") && ref.includes("now here with the two of them"));
  assert.ok(ref.includes(FIGURE_MOVED), "seen far off before: one of her, come close");
  assert.ok(!HORROR_WORDS.test(ref), ref);
  // the place as it now is; held under what both editors read
  const long = revealPicture({ moment: "x ".repeat(400), mood: DRAMA_MOOD, sides, seen: "y ".repeat(200), state: "z. ".repeat(250), ref: "scene", plain: true });
  assert.ok(long.length <= REVEAL_PICTURE_MAX + 50);
  assert.equal(revealPicture({ moment: "", plain: true }), "");
});

test("the SIGHTING picture of a figure: far off, in the place's own light, the two turned to them — never a shadow", () => {
  const p = sightingPicture({ moment: VISUALS[1], sides, seen: CAST[2], mood: DRAMA_MOOD, plain: true });
  assert.ok(p.startsWith(KEEP_FRAME_PLAIN) && p.includes(FIGURE_FAR) && p.includes(`Who they are, as this story has them: "${CAST[2]}".`));
  assert.ok(!HORROR_WORDS.test(p), p);
  // her portrait as the second picture, plainly
  const ref = sightingPicture({ moment: VISUALS[1], sides, seen: CAST[2], ref: "figure", name: "the Duchess", plain: true });
  assert.ok(ref.includes("that exact person, the same face, hair and clothes — far off") && !ref.includes("What it looks like"));
  // a shut tent's shadow is a horror film's: a figure is never drawn as one
  const shut = sightingPicture({ moment: "Marlow waits by the tent.", sides, plain: true, shadow: true });
  assert.ok(!/SHADOW/i.test(shut) && shut.includes(FIGURE_FAR));
  assert.ok(sightingPicture({ moment: "w ".repeat(400), sides, seen: "v ".repeat(200), mood: DRAMA_MOOD, state: "s. ".repeat(250), plain: true }).length <= SIGHT_PICTURE_MAX + 50);
});

test("the CLIPS: a figure moves at an ordinary pace, the two react as the moment says — the horror freeze is horror's", () => {
  assert.equal(revealClip("anything", { plain: true, who: "the Duchess" }), `In the picture with them, in plain view, is the Duchess. ${FIGURE_MOVES}`);
  assert.ok(sightingClip(VISUALS[1], "the Duchess", false, true).endsWith(FIGURE_FAR_MOVES));
  assert.ok(!sightingClip(VISUALS[1], "the Duchess", true, true).includes("shadow"), "never a shadow");
  // a drawn reveal, talking and not
  const said = stagedRules(live, { staging: "depth", event: VISUALS[3], reveal: true, drawn: true, plain: true, figure: "the Duchess" });
  assert.ok(said.look.includes(REVEAL_STAY) && said.look.includes("is the Duchess.") && said.look.includes(FIGURE_REACT));
  assert.ok(!said.look.includes(REVEAL_REACT) && !said.look.includes(REVEAL_MOVES));
  const quiet = silentRules(live, { staging: "depth", event: VISUALS[3], reveal: true, drawn: true, plain: true, figure: "the Duchess" });
  assert.ok(quiet.look.includes(FIGURE_REACT) && !quiet.look.includes(REVEAL_REACT) && !/["“”]/.test(quiet.look));
  // not drawn here (a frame the maker approved): an ordinary pace
  assert.ok(stagedRules(live, { staging: "apart", event: VISUALS[3], reveal: true, plain: true }).look.includes(`${FIGURE_COMES} ${FIGURE_REACT}`));
  // could not be drawn: someone just out of the picture, never "faces drained"
  for (const r of [stagedRules(live, { staging: "apart", event: "x", reveal: true, implied: true, plain: true }), silentRules(live, { staging: "apart", event: "x", reveal: true, implied: true, plain: true })]) {
    assert.ok(r.look.includes(FIGURE_UNSEEN_REACT) && !r.look.includes(REVEAL_UNSEEN_REACT));
  }
  // a sighting: far off, ordinary pace
  const sight = stagedRules(live, { staging: "depth", event: VISUALS[1], sighted: true, sight: "the Duchess", plain: true });
  assert.ok(sight.look.includes(FIGURE_FAR_MOVES) && !sight.look.includes(SIGHT_MOVES));
  for (const r of [said, quiet, sight]) assert.ok(!HORROR_WORDS.test(r.look), r.look);
  // A SHOT WITH NO FIGURE IN IT IS TOLD EXACTLY WHAT IT WAS: `plain` changes nothing but the reveal and the sighting
  for (const o of [{ staging: "doing", event: VISUALS[0] }, { staging: "across", event: "Three slow knocks at the door.", heard: true }, { staging: "walk", event: VISUALS[2], others: [{ name: "Quill", side: "right" }] }]) {
    assert.deepEqual(stagedRules(live, { ...o, plain: true, figure: "the Duchess" }), stagedRules(live, o));
    assert.deepEqual(silentRules(live, { ...o, plain: true, figure: "the Duchess" }), silentRules(live, o));
  }
});

test("the figure's ONE picture: its portrait photographed as a person, and the place's master bound to it plainly", () => {
  const p = figurePortrait(CAST[2], "a cinematic, photorealistic live-action film scene");
  assert.ok(!p.includes(CREATURE_REAL) && !/creature/i.test(p));
  assert.ok(thingBound({ name: "the Duchess", refNo: 3, plain: true }).startsWith(" THE ONE THIS STORY TURNS ON: reference image 3 is the Duchess and ONLY the Duchess."));
  assert.ok(!thingBound({ name: "the Duchess", refNo: 3, plain: true }).includes("FEAR"));
  assert.ok(thingRefNote("scene", { seen: "a woman on the terrace", plain: true }).includes("the far-off person in the SECOND picture"));
  // a creature the maker cast is said as it always was
  assert.equal(thingRefNote("creature", { name: "Howl", plain: true }), thingRefNote("creature", { name: "Howl" }));
});

test("the WRITER: every acted genre but horror is told its figure — glimpsed where seen, and the film MAY end on them", () => {
  assert.ok(FIGURE_SEEN.startsWith("THE FILM'S FIGURE — when this story turns on ONE more person besides the two"));
  assert.ok(FIGURE_SEEN.includes("add them to \"cast\" AFTER the two") && FIGURE_SEEN.includes("The figure NEVER speaks") && FIGURE_SEEN.includes("never invent one."));
  assert.ok(FIGURE_AT_THE_END.includes("SAME PLACE as the shot before it") && FIGURE_AT_THE_END.includes("its CAPTION is \"\""));
  for (const w of [FIGURE_SEEN, FIGURE_AT_THE_END]) assert.ok(!HORROR_WORDS.test(w), w);
  const eng = read("app", "lib", "film-engine.server.ts");
  const at = eng.indexOf("(figureGenre(tmpl.key) ? `${FIGURE_SEEN}\\n${ends ? `${FIGURE_AT_THE_END}\\n` : \"\"}` : \"\")");
  assert.ok(at > eng.indexOf("(tmpl.key === \"horror\" ? `${SEEN_WHEN_SEEN}"), "after horror's own, in the acted brief");
  // a wordless shot outside horror stays as it was
  assert.ok(eng.includes("${tmpl.key === \"horror\" ? (ends ? LINE_IN_EVERY_SHOT_BUT_THE_LAST : LINE_IN_EVERY_SHOT) : SOME_SHOTS_SILENT}"));
  // a long film: the plan chooses the figure with the cast, and each part is told it apart from the two
  assert.ok(eng.includes("(!narrated && figureGenre(tmpl.key) ? `${FIGURE_SEEN}\\n` : \"\") +"));
  assert.ok(eng.includes("const figurePlan = !narrated && figureGenre(tmpl.key) && one!.plan.cast.length > 2;"));
  assert.ok(eng.includes(" After them \"cast\" has the film's own figure, also exactly as it is here: ${thing.entry} — they are NOT one of the two, they never speak"));
});

test("the ENGINE: a genre's figure runs the horror film's sighting and reveal, and a film without one is made as before", () => {
  const eng = read("app", "lib", "film-dialogue.server.ts");
  assert.ok(eng.includes("const plain = !horror && figureGenre(tmpl.key);"));
  // (the Kids Cartoon is a cartoon — and not a figure genre; a film that is not a two-hander, or not staged, neither)
  assert.ok(eng.includes("const sightOn = staged && (horror || plain) && !cartoon && isTwoHander;"));
  // the figure is the script's own cast line (shown by name), or the maker's cast threat — never guessed from loose words
  assert.ok(eng.includes("const ownFigure = () => storyFigure({ cast: treatment.cast, speakers: [spkA, spkB], visuals: scenesArr.map((s) => s.visual), last: scenesArr[scenesArr.length - 1]?.visual });"));
  assert.ok(eng.includes("(!entry ? !plain && couldBeThing(who, thingWords) :"));
  // only the figure is sighted; the last shot is the reveal only when its words show the figure
  assert.ok(eng.includes("if (s && (!plain || isTheThing(s.entry, s.who))) {"));
  assert.ok(eng.includes("const endsOnFigure = sightOn && plain && !!threatEntry && (othersIn(lastWords).some((e) => lineName(e) === lineName(threatEntry))"));
  assert.ok(eng.includes("const lastReveal = staged && (horror || endsOnFigure) && i > 0 && i === treatment.scenes.length - 1 && !!eventAt(i);"));
  // the same pictures, the same editors — in plain words
  assert.equal(eng.split("tent, state: placeNow, plain })").length - 1, 2, "the reveal's two asks");
  assert.equal(eng.split("state: placeNow, plain }) : askOne;").length - 1, 2, "…and the sighting's");
  assert.equal(eng.split("cloth, plain, figure: threat?.name });").length - 1, 2, "the clip of a talking shot and of a wordless one");
  assert.ok(eng.includes("prompt: plain ? figurePortrait(own.entry, tmpl.sceneHint) : threatPortrait(own.entry, tmpl.sceneHint)"));
  // never a shadow on the cloth for a figure
  assert.ok(eng.includes("const cloth = !plain && placeOn &&") && eng.includes("const sightShadow = !plain && placeOn &&"));
});
