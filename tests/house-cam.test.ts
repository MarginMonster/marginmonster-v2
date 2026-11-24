/* A HOUSE SEEN BY ITS OWN CAMERAS (app/lib/house-cam.ts).
 *
 * The owner, 2026-11-24: "Found footage from house camera POVs also" — "Need designated editing tools for found
 * footage (like time lapse) hours go by on the counter in seconds and the creepy hero stands over someone
 * sleeping" — "Found footage would need to remember rooms even when panning to other cams in the house".
 *
 * Held here: the rooms of one house are drawn from its first room, a scene is drawn from its room, the
 * engine is given no word to speak, and the clock runs on from camera to camera.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { HOUSE_CAMERA, HOUSE_ROOMS, cutClocks, houseRooms, houseTakePrompt, roomPrompt, scenePrompt } from "../app/lib/house-cam.ts";
import { clockText } from "../app/lib/camera-dress.ts";

test("a house's cameras: its rooms, numbered in the order they were chosen, each once", () => {
  assert.deepEqual(HOUSE_ROOMS.map((r) => r.key), ["living", "bedroom", "hallway", "kitchen", "nursery"]);
  const h = houseRooms(["Bedroom", "living", "bedroom", "attic", "hallway"]);
  assert.deepEqual(h.map((r) => [r.key, r.cam]), [["bedroom", "CAM 1"], ["living", "CAM 2"], ["hallway", "CAM 3"]]);
  assert.deepEqual(houseRooms([]), []);
});

test("REMEMBERING THE ROOMS: the first room is drawn from words; every other room FROM it; a scene FROM its room", () => {
  const [living, bedroom] = houseRooms(["living", "bedroom"]);
  const first = roomPrompt(living, true);
  assert.ok(first.startsWith(`Wide 16:9 picture. ${HOUSE_CAMERA} An ordinary living room`) && first.includes("NOBODY is in the room."));
  // the camera's own picture: high in the corner, wide, infrared, the whole frame (a black fisheye circle was
  // drawn the first time it was not said)
  assert.ok(HOUSE_CAMERA.includes("mounted high in the corner") && HOUSE_CAMERA.includes("infrared") && HOUSE_CAMERA.includes("no black circle"));
  const next = roomPrompt(bedroom, false);
  assert.ok(next.startsWith("Wide 16:9 picture. ANOTHER ROOM OF THE SAME HOUSE as the reference image"));
  assert.ok(next.includes("The same plain painted walls, the same floor, the same doors, door frames and skirting as the reference.") && next.includes(bedroom.empty));
  // a scene changes nothing but what it adds
  const s = scenePrompt("a woman asleep in the bed on her side, her face toward the camera.");
  assert.ok(s.startsWith("Wide 16:9 picture. EXACTLY the reference image — the same room") && s.includes("with ONLY this added: a woman asleep in the bed on her side, her face toward the camera. Nothing else in the room changes."));
  assert.ok(scenePrompt("him", { withPerson: true }).includes("EXACTLY the first reference image"));
  for (const p of [first, next, s]) assert.ok(p.endsWith("Nothing written anywhere in the picture: no date, no time, no text, no watermark."));
});

test("a house-camera take: the camera never moves, nobody speaks, no quoted word", () => {
  const p = houseTakePrompt({
    beats: ["FIRST NINE SECONDS: the woman sleeps.", "THEN he is standing beside the bed, exactly as in <<<image_1>>>."],
    never: "He never speaks, never opens his mouth.",
    sound: "a quiet bedroom at night, a clock ticking.",
  });
  assert.ok(p.startsWith("A fixed home security camera mounted high in the corner of the room records at night in infrared. The camera NEVER moves"));
  assert.ok(p.includes("NOBODY SPEAKS in this shot") && !/["“”]/.test(p));
  assert.ok(p.endsWith("Sound: a quiet bedroom at night, a clock ticking. No voice at all. No music."));
  assert.ok(p.length <= 2400);
});

test("THE CLOCK RUNS ON ACROSS THE CAMERAS: a cut picks the time up where the last one left it", () => {
  const start = { date: "2026-11-16 MON", start: 58 * 60 + 16 };                 // 00:58:16
  const clocks = cutClocks([
    { cam: "CAM 2", seconds: 8, lapse: { fast: 9, speed: 4.5, hours: 2.5 } },       // the bedroom, a time-lapse: 2 s fast + 6 s
    { cam: "CAM 1", seconds: 10 },                                                  // the living room, real time
    { cam: "CAM 2", seconds: 6 },
  ], start, 20);
  assert.deepEqual(clocks.map((c) => clockText(c.start)), ["00:58:16", "03:28:42", "03:29:12"]);
  // (the bedroom: 2½ hours in its fast two seconds, six real seconds after, twenty to walk to the living room)
  assert.ok(clocks.every((c) => c.date === "2026-11-16 MON"));
});
