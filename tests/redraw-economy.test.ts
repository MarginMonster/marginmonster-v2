/* A TOLD STORY'S PICTURES: STOP PAYING FOR REDRAWS THE CHECKS GET WRONG (2026-11-26).
 *
 * Read off Render's own log for a day of live told TEST stories (2026-11-25 04:00Z → 2026-11-26 03:40Z: eleven made in
 * one press, 59 scenes — tests/redraw-day.json, each go's faults as the log printed them): 122 scene pictures, 2.07 a
 * scene. "Stared into the lens" was called on 58 goes and "the place came out run-down" on 29; the rejected and the kept
 * goes of two of the stories ("Circling in the Dark", "The Warmth by the Oven") were saved from the picture model's own
 * record while it still held them and LOOKED at: of their eleven stares two were stares, and none of their six run-down
 * calls was anything but the old roller rink the story was set in. So:
 *   · the run-down look counts only where no words of the story ask for a worn place (story-picture.ts → wornAsked);
 *   · a stare counts only where the shot is not facing us — never in a WALKING, an OVER THE SHOULDER or a WIDE, nor where
 *     the scene's words have them look our way (story-picture.ts → stareCounts);
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EYES_FIRST, stareCounts, storyExtrasPrompt, wornAsked, wornPlaces, wornSaid,
} from "../app/lib/story-picture.ts";
import { sceneShot } from "../app/lib/story-shots.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => fs.readFileSync(path.join(here, "..", ...p), "utf8").replace(/\r\n/g, "\n");
type Scene = { v: string; c?: string; goes: string[][]; looked?: string };
type Story = { title: string; scenes: Scene[] };
const day = JSON.parse(read("tests", "redraw-day.json")) as { stories: Story[] };
const story = (t: string): Story => day.stories.find((s) => s.title.includes(t))!;
const wordsOf = (s: Story): string => s.scenes.map((x) => `${x.v} ${x.c || ""}`).join(" ");

test("the run-down look listens to the story: a worn place its words ask for is no fault — the ordinary home still is", () => {
  const rink = story("Circling in the Dark");
  // its own words: "The old roller rink had been closed for hours…"
  assert.equal(wornAsked(`${rink.scenes[0].v} ${rink.scenes[0].c}`, wordsOf(rink)), true);
  // …and the scenes after it, whose own words only say "the dark rink floor" — the story said the rink is old
  assert.equal(wornSaid(`${rink.scenes[2].v} ${rink.scenes[2].c}`), false, "its own words do not say it");
  assert.equal(wornAsked(`${rink.scenes[2].v} ${rink.scenes[2].c}`, wordsOf(rink)), true, "the story's do");
  assert.deepEqual(wornPlaces(wordsOf(rink)), ["rink", "floor"]);
  // the worn concrete pier, the ferry's worn plank deck, boot-prints in dust, the dusty velvet rope
  const ferry = story("Eleven Went Aboard");
  assert.equal(wornAsked(ferry.scenes[8].v, wordsOf(ferry)), true);
  assert.equal(wornAsked(ferry.scenes[7].v, wordsOf(ferry)), true, "…beside the pier");
  assert.deepEqual(wornPlaces("WIDE: the ferry's worn plank deck seen whole"), ["plank", "deck", "ferry"]);
  assert.equal(wornSaid(story("Two Sets of Footprints").scenes[0].v), true);
  assert.equal(wornSaid(story("The Hour It Arrives").scenes[2].v), true);
  // more ways a story says it
  assert.deepEqual(wornPlaces("The house was abandoned years ago"), ["house"]);
  assert.deepEqual(wornPlaces("an old low black wooden ferry with a wheelhouse"), ["ferry"]);
  assert.deepEqual(wornPlaces("a long-closed rink, dark"), ["rink"]);
  assert.equal(wornAsked("WIDE: the farmhouse kitchen at night", "an old farmhouse on the hill"), true);
  // NOT ASKED — what LIVED_IN was made for, and words that only look like it
  const hospital = story("The Dent in the Pillow");
  for (const s of hospital.scenes) assert.equal(wornAsked(s.v, wordsOf(hospital)), false, `a working hospital: ${s.v.slice(0, 40)}`);
  assert.equal(wornAsked("NEAR AND FAR: from inside the dark hallway, Nadia stands close to the camera at the edge of the frame", "two children home alone at night; a ghost lady at the glass"), false, "the ordinary home");
  assert.equal(wornAsked("WIDE: inside Room 14 …", "a working small-town hospital; room 14 has been unused for a year"), false, "unused for a while is still kept (LIVED_IN)");
  assert.equal(wornAsked("WIDE: inside the bakery, Fergus stands frozen in the doorway, and near it Imelda lies curled asleep in her worn green coat.", ""), false, "a worn coat is not a worn bakery");
  assert.equal(wornAsked("CLOSE: Ottavia's face, flour dust on her cheek", ""), false, "flour dust");
  assert.equal(wornAsked("CLOSE: the skater in a faded pastel roller-rink dress", ""), false, "a hyphened word is one word");
  assert.equal(wornAsked("WIDE: the living room, an old photo on the wall above the sofa", ""), false, "an old photo ON the wall is not an old wall");
  assert.equal(wornAsked("WIDE: the kitchen, spotless, no dust anywhere", ""), false, "said NOT to be");
  assert.equal(wornAsked("WIDE: the farmhouse kitchen at night", "an old man lives on the hill"), false, "an old man is not an old place");
});

test("a stare counts only where the shot is not facing us — the cases read off the rejected pictures", () => {
  const rink = story("Circling in the Dark");
  const shotOf = (s: Scene) => sceneShot({ visual: s.v });
  // WALKING toward the camera: she faces us (three goes, the third looking well aside, all called stares)
  assert.equal(shotOf(rink.scenes[0]), "walk");
  assert.equal(stareCounts("walk", rink.scenes[0].v), false);
  // a close-up whose words have her look just past the camera's edge (two goes drawn exactly so)
  assert.equal(stareCounts(shotOf(rink.scenes[3]), rink.scenes[3].v), false);
  // NEAR AND FAR, a face near the lens staring down it while the moment is the skater far behind: STILL a fault (right twice)
  assert.equal(stareCounts(shotOf(rink.scenes[2]), rink.scenes[2].v), true);
  // OVER THE SHOULDER: Imelda looks up at HIM (three goes); WIDE: Fergus small in the doorway
  const oven = story("The Warmth by the Oven");
  assert.equal(stareCounts(shotOf(oven.scenes[3]), oven.scenes[3].v), false);
  assert.equal(stareCounts(shotOf(oven.scenes[1]), oven.scenes[1].v), false);
  // a plain close-up about something else is still looked at
  assert.equal(stareCounts("close", "CLOSE: Verity's face lit by the glow of the call-button panel, eyes fixed on one small red light"), true);
  assert.equal(stareCounts("two", "TOGETHER: Halina and Radek facing each other at the harbour dock"), true);
  assert.equal(stareCounts(null, "Inside the dark bedroom, Edvin stands at the window looking out"), true, "a scene with no shot: its words decide");
  for (const w of ["his gaze fixed past us toward the brass elevator doors", "she turns to face the camera", "looking straight at us", "the woman strides toward camera through shallow water"]) assert.equal(stareCounts("close", w), false, w);
  // the reader writes down where the eyes point before it answers — the question it was tuned with kept word for word
  const q = storyExtrasPrompt("CLOSE: Delphine's face, frozen mid-breath", ["Delphine: a night guard"]);
  assert.ok(q.includes(`look straight into the camera, eyes on the lens as if posing for a photograph? Somebody looking at something to one side of the camera, or seen from the side or from behind, does not. ${EYES_FIRST} `));
  assert.ok(EYES_FIRST.includes("only eyes that meet the lens itself count — eyes on something just beside the camera or past its edge, or a face turned even a little away, do not."));
  assert.ok(q.includes("\"eyes\": [\"whose face, and where its eyes point, in a few words — for each face you can see\"], \"intoLens\": [\"the name of each person looking straight into the camera — an empty list when nobody does\"]"));
});
