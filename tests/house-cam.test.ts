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
import {
  EMPTY_HOUSE, HOUSE_CAMERA, HOUSE_ROOMS, HOUSE_SCARES, HOUSE_TAKE_SECONDS, NIGHT, OWN_SCARE_LAPSE, camOf, cutClocks, houseNight, houseRooms, houseScare, houseScarePrompt,
  houseScenePrompt, houseSetPrompt, houseTakePrompt, houseWriterBrief, keptHouseOf, nextNightDate, parseHouseScare, playedSeconds, roomImg, roomPrompt, roomToDraw, scenePrompt, thingImg, withRoom, withThing,
} from "../app/lib/house-cam.ts";
import { clockAt, clockText, timeLapseOf } from "../app/lib/camera-dress.ts";

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

/** THE DIRECTION THAT WORKED — scratchpad t45/cam/h-bed-walkin.txt, rolled at 15 s on 2026-11-24 (Replicate Kling 3
 *  Omni pro): 0–1 s a dark shape in the doorway, 1–3 s he steps out of it, 3–6 s he crosses the room under the
 *  camera, 6–8 s he reaches the bedside, from ~8 s bent over her and still, his head coming round at the end. */
const WALK_IN = "A fixed home security camera mounted high in the corner of a bedroom records at night in infrared. The camera NEVER moves: no pan, no tilt, no zoom, no shake — it is screwed to the wall. One continuous shot, no cuts, nothing written on screen. NOBODY SPEAKS in this shot: no voice, no words, no whisper. FIRST TWO SECONDS: an ordinary night. The woman sleeps. The half-open bedroom door on the right is black. THEN the very tall, very thin man in the dark suit of <<<image_1>>> steps in through that doorway from the darkness, ducking his head under the top of the door frame, and walks slowly and stiffly across the wooden floor to the side of the bed nearest the camera, each step placed carefully, his long arms hanging loose. He walks the whole way: he never appears from nowhere, never jumps, never fades in. BY THE SIXTH SECOND he stands beside the bed exactly as in <<<image_1>>>, bent stiffly at the waist over the sleeping woman, his pale face a hand's width above her face. THEN, FOR A LONG TIME, HE DOES NOT MOVE AT ALL: perfectly still, bent over her, for five whole seconds. She turns over once in her sleep and back. He stays exactly where he is. He does not blink. LAST FOUR SECONDS: very slowly, his head turns up from her face toward the camera in the corner, until he is looking straight into the lens. His body does not move. The woman never wakes. He never runs, never flinches, never speaks, never opens his mouth. The light does not change; the picture never glitches. Sound: a quiet bedroom at night, the woman's slow breathing, a clock ticking, slow creaking footsteps on the wooden floor as he crosses the room. No voice at all. No music.";

test("READY-MADE HOUSE SCARES: \"Over the bed\" is the walk-in that worked, word for word — he never spawns in", () => {
  assert.deepEqual(HOUSE_SCARES.map((s) => [s.key, s.room]), [["overbed", "bedroom"], ["lookup", "living"]]);
  assert.equal(HOUSE_TAKE_SECONDS, 15);
  const bed = houseScare("overbed")!;
  assert.equal(houseScarePrompt(bed, "<<<image_1>>>"), WALK_IN);
  // the owner: "he needs to walk into the room no time lapse, then time lapse, it appeared that he just spawned in"
  for (const s of HOUSE_SCARES) {
    const p = houseScarePrompt(s, "<<<image_1>>>");
    assert.ok(p.includes("walks the whole way: he never appears from nowhere, never jumps, never fades in."), `${s.key}: he walks in, the whole way`);
    // the beats carry their times, walk first: the engine is told when each happens
    const at = ["FIRST TWO SECONDS:", "THEN the very tall", "BY THE SIXTH SECOND", "THEN, FOR A LONG TIME,"].map((m) => p.indexOf(m));
    assert.ok(at.every((x, i) => x > 0 && (i === 0 || x > at[i - 1])), `${s.key}: in order`);
    assert.ok(/LAST (FOUR|FIVE) SECONDS:/.test(p), s.key);
    // nobody speaks; no quoted word; it fits the engine; both hosts' names for the reference
    assert.ok(p.includes("NOBODY SPEAKS in this shot") && !/["“”]/.test(p) && p.length <= 2400, s.key);
    assert.ok(houseScarePrompt(s, "@Image1").includes("the dark suit of @Image1") && !houseScarePrompt(s, "@Image1").includes("<<<"), s.key);
    assert.ok(!/\{(ref|thing)\}/.test(p), `${s.key}: nothing left unfilled`);
    // the card fits
    assert.ok(s.name.length <= 22 && s.line.length <= 60, s.key);
    // its time-lapse window fits the take and is a real time-lapse
    assert.ok(timeLapseOf(s.lapse, HOUSE_TAKE_SECONDS), `${s.key}: the window plays`);
  }
  // THE WINDOW measured on the real roll: 8.5 s real, 3.5 s played in one, three real — 01:12:48 → 03:42:48 → 03:42:50
  assert.deepEqual(bed.lapse, { from: 8.5, fast: 3.5, speed: 3.5, hours: 2.5 });
  assert.equal(bed.lapseOn, true);
  const lapse = timeLapseOf(bed.lapse, 15)!;
  const clock = { date: "2026-11-16 MON", start: 1 * 3600 + 12 * 60 + 40 };
  // (the clock as it was read off that cut: real time to 01:12:48, two and a half hours in one second, real time again)
  assert.deepEqual([8.5, 9.5, 11.5].map((t) => clockText(clockAt(clock, lapse, t))), ["01:12:48", "03:42:48", "03:42:50"]);
  assert.equal(playedSeconds(15, lapse), 12.5);
  assert.equal(playedSeconds(15, null), 15);
  // "Looking up": the same walk-in into the living room, the stillness, then under the camera — its time-lapse starts off
  const up = houseScare("lookup")!;
  assert.equal(up.lapseOn, false);
  assert.ok(houseScarePrompt(up, "<<<image_1>>>").startsWith("A fixed home security camera mounted high in the corner of a living room records at night in infrared."));
  assert.ok(houseScarePrompt(up, "<<<image_1>>>").includes("until he stands directly beneath the camera, so close that his upturned face fills the bottom of the frame"));
  // the same one walks into both rooms (the house keeps his first picture)
  assert.equal(bed.thing.key, up.thing.key);
  // NIGHT VISION OFF: a lamp, in colour — said to the engine, drawn into the room
  assert.ok(houseScarePrompt(bed, "<<<image_1>>>", { ir: false }).startsWith("A fixed home security camera mounted high in the corner of a bedroom records at night in colour, its night vision off: one small lamp is lit"));
  assert.ok(!houseScarePrompt(bed, "x", { ir: false }).includes("infrared."));
  assert.equal(houseScare("nope"), undefined);
});

test("THE ROOM AS THE TAKE FINDS IT, and the scene it arrives at — both drawn FROM the room", () => {
  const bed = houseScare("overbed")!, up = houseScare("lookup")!;
  // what the scare puts in the room before anything arrives (a woman asleep); nothing → the room's own picture
  assert.ok(houseSetPrompt(bed)!.includes("with ONLY this added: a woman asleep in the bed on her side"));
  assert.equal(houseSetPrompt(up), null);
  // night vision off: even an empty room is drawn again — relit, in colour
  const relit = houseSetPrompt(up, { ir: false })!;
  assert.ok(relit.includes("but in COLOUR: the camera's night vision is off and one small lamp is lit") && relit.includes("with nothing added: NOBODY is in the room, and nothing in it changes."));
  // the scene: the thing named from words the first time…
  const first = houseScenePrompt(bed);
  assert.ok(first.startsWith("Wide 16:9 picture. EXACTLY the reference image") && first.includes("with ONLY this added: a very tall, very thin man in a dark old suit that is too short at the wrists stands at the side of the bed"));
  // …and from his first picture once the house has seen him (the second reference image)
  const again = houseScenePrompt(up, { kept: true });
  assert.ok(again.startsWith("Wide 16:9 picture. EXACTLY the first reference image") && again.includes("the very tall, very thin man in the dark old suit from the second reference image stands in the middle of the floor"));
  // a lit lamp keeps its colour in the scene drawn from it
  assert.ok(houseScenePrompt(bed, { ir: false }).includes("the same dim lamp light, in colour, and the same grain"));
  // (the infrared is the default, and nothing about it changed)
  assert.ok(scenePrompt("x").includes("the same infrared grey and grain — with ONLY this added: x. Nothing else in the room changes."));
});

test("THE HOUSE, KEPT: its rooms in the order they were drawn (their cameras' numbers), the things seen in it, its night", () => {
  // a shop with no house: its first room is drawn from words, and is CAM 1
  assert.deepEqual(roomToDraw(null, "bedroom"), { first: true, from: null });
  assert.equal(camOf(null, "bedroom"), "CAM 1");
  let h = withRoom(null, "bedroom", "/renders/img-bed.jpg");
  // every other room FROM the first — and the next number
  assert.deepEqual(roomToDraw(h, "living"), { first: false, from: "/renders/img-bed.jpg" });
  assert.equal(camOf(h, "living"), "CAM 2");
  h = withRoom(h, "living", "/renders/img-living.jpg");
  // a room it has is never drawn again, and keeps its camera
  assert.equal(roomToDraw(h, "bedroom"), null);
  assert.equal(withRoom(h, "bedroom", "/renders/other.jpg"), h);
  assert.deepEqual([camOf(h, "bedroom"), camOf(h, "living"), camOf(h, "kitchen")], ["CAM 1", "CAM 2", "CAM 3"]);
  assert.equal(roomImg(h, "living"), "/renders/img-living.jpg");
  // the things seen in it: the first picture of each is kept, never replaced; a thing of nobody's (key "") is not kept
  h = withThing(h, "tallman", "/renders/img-scene.jpg");
  assert.equal(withThing(h, "tallman", "/renders/later.jpg"), h);
  assert.equal(withThing(h, "", "/renders/x.jpg"), h);
  assert.equal(thingImg(h, "tallman"), "/renders/img-scene.jpg");
  // stored and read back as it was; anything not ours is dropped
  const stored = JSON.parse(JSON.stringify({ ...h, night: { date: "2026-11-16 MON", end: 13_370 } }));
  assert.deepEqual(keptHouseOf(stored), { v: 1, rooms: [{ key: "bedroom", img: "/renders/img-bed.jpg" }, { key: "living", img: "/renders/img-living.jpg" }], things: [{ key: "tallman", img: "/renders/img-scene.jpg" }], night: { date: "2026-11-16 MON", end: 13_370 } });
  assert.deepEqual(keptHouseOf(JSON.stringify(stored)), keptHouseOf(stored));
  const dirty = keptHouseOf({ v: 1, rooms: [{ key: "attic", img: "/renders/a.jpg" }, { key: "bedroom", img: "https://elsewhere.example/x.jpg" }, { key: "living", img: "/renders/l.jpg" }, { key: "living", img: "/renders/l2.jpg" }], things: [{ key: "Tall Man!", img: "/renders/t.jpg" }], night: { date: "yesterday", end: 5 } });
  assert.deepEqual(dirty, { v: 1, rooms: [{ key: "living", img: "/renders/l.jpg" }], things: [], night: null });
  for (const bad of [null, "", "{", { v: 2, rooms: [] }, { v: 1, rooms: [] }, { v: 1 }]) assert.equal(keptHouseOf(bad), null);
  assert.deepEqual(EMPTY_HOUSE, { v: 1, rooms: [], things: [], night: null });
});

test("A BELIEVABLE NIGHT: the house's clock runs on from take to take until dawn, then it is the next night", () => {
  const lapse = timeLapseOf(houseScare("overbed")!.lapse, 15);
  // a new house: tonight, somewhere between twenty past midnight and half past three — and over before dawn
  for (const seed of [0, 1, 77, 4_999, 123_456, 9_999_999]) {
    const { clock, night } = houseNight({ prev: null, seconds: 15, lapse, today: "2026-11-24 TUE", seed });
    assert.equal(clock.date, "2026-11-24 TUE");
    assert.ok(clock.start >= NIGHT.from && clock.start <= NIGHT.lastStart, clockText(clock.start));
    assert.ok(night.end <= NIGHT.dawn && night.end === Math.round(clockAt(clock, lapse, 12.5)), clockText(night.end));
  }
  // the next take picks the night up where the last one ended, plus the walk to the next room (20–90 s)
  const next = houseNight({ prev: { date: "2026-11-24 TUE", end: 2 * 3600 }, seconds: 10, lapse: null, today: "2026-12-01 TUE", seed: 5 });
  assert.deepEqual(next, { clock: { date: "2026-11-24 TUE", start: 7225 }, night: { date: "2026-11-24 TUE", end: 7235 } });
  // a take that would run past dawn is the NEXT night, from its own start
  const late = houseNight({ prev: { date: "2026-11-24 TUE", end: 4 * 3600 }, seconds: 15, lapse, today: "2026-12-01 TUE", seed: 5 });
  assert.equal(late.clock.date, "2026-11-25 WED");
  assert.ok(late.clock.start >= NIGHT.from && late.night.end <= NIGHT.dawn);
  assert.equal(nextNightDate("2026-11-30 MON"), "2026-12-01 TUE");
  assert.equal(nextNightDate("2026-12-31 THU"), "2027-01-01 FRI");
});

test("A HOUSE SCARE OF THE MEMBER'S OWN: written into the walk-in's shape, with its times — or refused", () => {
  const bedroom = HOUSE_ROOMS.find((r) => r.key === "bedroom")!;
  const brief = houseWriterBrief("my roommate standing over me while I sleep", bedroom);
  for (const rule of ["fifteen-second shot from a home security camera", "THE IDEA: my roommate standing over me while I sleep", `THE ROOM: Bedroom. ${bedroom.empty}`, "WALKS the whole way to where it stops — it never appears from nowhere", "HOLDS PERFECTLY STILL for a long time", "ITS MOUTH NEVER MOVES", "No blood, no gore", "Answer with JSON only", '"door":', '"stands":', '"waits":', '"acts":']) assert.ok(brief.includes(rule), rule);
  const good = { title: "The Roommate", who: "she", thing: "a very tall woman in a long grey nightgown, her wet hair hanging over her face", set: "A man sleeps on his back in the bed", door: "the half-open door on the right", stands: "stands at the foot of the bed, facing the sleeper, her head bowed", waits: "The man turns over in his sleep.", acts: "turns her head up toward the camera until she is looking straight into the lens", sound: "a quiet bedroom, a clock ticking" };
  const s = parseHouseScare(good, "bedroom")!;
  assert.ok(s && s.room === "bedroom" && s.key === "own" && s.thing.key === "" && s.lapseOn === false);
  assert.deepEqual(s.lapse, OWN_SCARE_LAPSE);
  const p = houseScarePrompt(s, "<<<image_1>>>");
  assert.ok(p.includes("FIRST TWO SECONDS: an ordinary night. A man sleeps on his back in the bed. The half-open door on the right is black."));
  assert.ok(p.includes("THEN the very tall woman in a long grey nightgown, her wet hair hanging over her face — the one in <<<image_1>>> — comes in through the half-open door on the right from the darkness"));
  assert.ok(p.includes("She walks the whole way: she never appears from nowhere, never jumps, never fades in."));
  assert.ok(p.includes("BY THE SIXTH SECOND she stands at the foot of the bed, facing the sleeper, her head bowed exactly as in <<<image_1>>>."));
  assert.ok(p.includes("THEN, FOR A LONG TIME, SHE DOES NOT MOVE AT ALL: perfectly still for five whole seconds. The man turns over in his sleep. She stays exactly where she is."));
  assert.ok(p.includes("LAST FOUR SECONDS: very slowly, she turns her head up toward the camera until she is looking straight into the lens.") && p.includes("She never runs, never flinches, never speaks, never opens her mouth."));
  assert.ok(!/["“”]/.test(p) && p.length <= 2400);
  assert.ok(houseScenePrompt(s).includes("with ONLY this added: a very tall woman in a long grey nightgown, her wet hair hanging over her face stands at the foot of the bed"));
  // nothing in the room before it: the room is empty and still
  assert.ok(houseScarePrompt(parseHouseScare({ ...good, set: "" }, "bedroom")!, "x").includes("FIRST TWO SECONDS: an ordinary night. The bedroom is empty and still."));
  // refused: half an answer, a thing that speaks, no door, a pronoun it is not, a room the house cannot have
  assert.equal(parseHouseScare({ ...good, who: "they" }, "bedroom"), null);
  assert.equal(parseHouseScare({ ...good, acts: "whispers her name to the camera" }, "bedroom"), null);
  assert.equal(parseHouseScare({ ...good, door: "out of thin air" }, "bedroom"), null);
  assert.equal(parseHouseScare({ ...good, thing: "tall" }, "bedroom"), null);
  assert.equal(parseHouseScare(good, "attic"), null);
  assert.equal(parseHouseScare("not json", "bedroom"), null);
  assert.ok(parseHouseScare("Sure:\n```json\n" + JSON.stringify(good) + "\n```", "bedroom"));
});
