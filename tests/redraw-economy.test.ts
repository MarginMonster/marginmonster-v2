/* A TOLD STORY'S PICTURES: STOP PAYING FOR REDRAWS THE CHECKS GET WRONG (2026-11-26).
 *
 * Read off Render's own log for a day of live told TEST stories (2026-11-25 04:00Z → 2026-11-26 03:40Z: eleven made in
 * one press, 59 scenes — tests/redraw-day.json, each go's faults as the log printed them): 122 scene pictures, 2.07 a
 * scene. "Stared into the lens" was called on 58 goes and "the place came out run-down" on 29; the rejected and the kept
 * goes of two of the stories ("Circling in the Dark", "The Warmth by the Oven") were saved from the picture model's own
 * record while it still held them and LOOKED at: of their eleven stares two were stares, and none of their six run-down
 * calls was anything but the old roller rink the story was set in. So:
 *   · the run-down look counts only where no words of the story ask for a worn place (story-picture.ts → wornAsked);
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  wornAsked, wornPlaces, wornSaid,
} from "../app/lib/story-picture.ts";

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
