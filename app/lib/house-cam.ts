/* A HOUSE, SEEN BY ITS OWN CAMERAS — found footage from the cameras on the walls.
 *
 * The owner, 2026-11-24: "Found footage from house camera POVs also" — "Like this overlay" (a screenshot of a
 * home security camera) — "Need designated editing tools for found footage (like time lapse) hours go by on the
 * counter in seconds and the creepy hero stands over someone sleeping … if we put it as a scene setting it would
 * maximize easiness" — and: "Found footage would need to remember rooms even when panning to other cams in the
 * house".
 *
 * So a HOUSE is kept, and it is made of ROOMS, one camera each:
 *   1. THE FIRST ROOM is drawn from words — an empty room, seen from a fixed camera high in its corner, at night
 *      in infrared.
 *   2. EVERY OTHER ROOM is drawn FROM the first ("another room of the same house": the same walls, floor, doors
 *      and the same kind of camera) — so cutting from one camera to the next is the same house.
 *   3. A SCENE in a room is drawn FROM that room's own empty picture with only what the scene adds (somebody
 *      asleep, the thing standing in it) — the room itself never changes between scenes.
 *   4. THE TAKE starts on the room as it is, and the direction arrives at the scene ("exactly as in" it): the
 *      camera never moves; the engine is given no word to speak (take.ts says why).
 *   5. THE CLOCK runs on across the cameras (cutClocks): a cut to another camera picks the time up where the
 *      last one left it, plus the moment it took to get there.
 * A TIME-LAPSE is a scene SETTING (camera-dress.ts → TimeLapse), never something the prompt has to ask for.
 *
 * Pure: the drawing, the rolling and the dressing are the caller's (scratchpad t45/cam/ proved each step on
 * 2026-11-24: an empty living room, a bedroom drawn from it, a figure drawn into each). */

import { clockAt, type HouseClock, type TimeLapse } from "./camera-dress.ts";

/** What every house camera's picture is — said once, the same for every room. */
export const HOUSE_CAMERA = "A single frame from a home security camera's own recording: a fixed camera mounted high in the corner of a room, looking down across the whole room through a wide-angle lens, so the walls and the ceiling line bow slightly outward toward the edges. The picture fills the whole frame from edge to edge — no black circle, no round vignette, no black corners. It is night and the camera is in infrared night vision: black and white with a faint cold cast, soft, grainy, a little compressed; the middle of the room washed pale by the infrared, the far corners falling away into darkness. It is real footage of a real room — never CGI, never a 3D render, never an illustration.";
const NO_WRITING = "Nothing written anywhere in the picture: no date, no time, no text, no watermark.";

export type HouseRoom = {
  key: string;
  /** what the camera is called on screen, e.g. "CAM 1" */
  cam: string;
  /** the room's name, e.g. "Living room" */
  name: string;
  /** the room as it is with nobody in it — its furniture and its doors */
  empty: string;
};

/** The rooms a house can have a camera in. The first one in a house is the one the others are drawn from. */
export const HOUSE_ROOMS: ReadonlyArray<Omit<HouseRoom, "cam">> = [
  { key: "living", name: "Living room", empty: "An ordinary living room in an ordinary house: a sofa with a crumpled blanket on it, a low coffee table with a mug on it, a floor lamp that is switched off, a closed white panel door in the left wall, and an open doorway to a dark hallway in the far wall. Wooden floor, plain painted walls, white door frames and skirting." },
  { key: "bedroom", name: "Bedroom", empty: "A small bedroom: a double bed against the far wall with its head to the wall, its pale duvet turned back; a nightstand with an unlit lamp beside the bed; a closed wardrobe on the left; the bedroom door standing half open on the right, with black darkness beyond it." },
  { key: "hallway", name: "Hallway", empty: "A long narrow upstairs hallway: closed white doors along both sides, a runner rug down the middle of the wooden floor, the top of a staircase at the far end with its banister, and at the very end a dark window." },
  { key: "kitchen", name: "Kitchen", empty: "A small kitchen: counters along two walls, a sink under a dark window, a fridge humming in the corner, a small table with two chairs, and a doorway to a dark hall." },
  { key: "nursery", name: "Nursery", empty: "A child's bedroom: a small bed with a patterned quilt, a shelf of stuffed toys, a toy chest, a rocking chair in the corner, a closet door left a hand's width open, the bedroom door ajar onto darkness." },
];

/** A house's cameras, numbered in the order its rooms were chosen. */
export function houseRooms(keys: readonly string[]): HouseRoom[] {
  const seen = new Set<string>();
  const out: HouseRoom[] = [];
  for (const k of keys) {
    const r = HOUSE_ROOMS.find((x) => x.key === String(k).trim().toLowerCase());
    if (r && !seen.has(r.key)) { seen.add(r.key); out.push({ ...r, cam: `CAM ${out.length + 1}` }); }
  }
  return out;
}

/** The picture model's prompt for a room with nobody in it. The house's FIRST room is drawn from these words
 *  alone; every other room is drawn with the first room's picture handed over as the reference. */
export function roomPrompt(room: HouseRoom, first: boolean): string {
  if (first) return `Wide 16:9 picture. ${HOUSE_CAMERA} ${room.empty} NOBODY is in the room. ${NO_WRITING}`;
  return `Wide 16:9 picture. ANOTHER ROOM OF THE SAME HOUSE as the reference image, recorded by the SAME kind of camera: a fixed security camera mounted high in a corner, looking down across the room through the same wide-angle lens, at night in the same grey infrared, with the same soft, grainy, compressed look. The same plain painted walls, the same floor, the same doors, door frames and skirting as the reference. The picture fills the whole frame from edge to edge — no black circle. ${room.empty} NOBODY is in the room. Real footage, never a render. ${NO_WRITING}`;
}

/** The picture model's prompt for a scene in a room: the room's own picture, with only what the scene adds.
 *  (`withPerson`: the second reference image is somebody — the thing — already drawn, so it is the same one.) */
export function scenePrompt(adds: string, opts: { withPerson?: boolean } = {}): string {
  return `Wide 16:9 picture. EXACTLY the ${opts.withPerson ? "first " : ""}reference image — the same room, the same camera high in the corner, every piece of furniture and every door where it is, the same infrared grey and grain — with ONLY this added: ${adds.trim().replace(/\.$/, "")}. Nothing else in the room changes. No blood, no gore. Real footage, never a render. ${NO_WRITING}`;
}

/** The direction for a house-camera take: the camera never moves, nobody speaks, and what happens, in order.
 *  `ref` is how this host names the reference picture (the scene the take arrives at), when there is one. */
export function houseTakePrompt(o: { beats: string[]; never: string; sound: string }): string {
  const text = [
    "A fixed home security camera mounted high in the corner of the room records at night in infrared. The camera NEVER moves: no pan, no tilt, no zoom, no shake — it is screwed to the wall. One continuous shot, no cuts, nothing written on screen. NOBODY SPEAKS in this shot: no voice, no words, no whisper.",
    ...o.beats.map((b) => b.trim()),
    o.never.trim(),
    "The light does not change; the picture never glitches.",
    `Sound: ${o.sound.trim().replace(/\.$/, "")}. No voice at all. No music.`,
  ].join(" ");
  return text.slice(0, 2400);
}

/** ONE CUT of a house's footage: which camera, how long its take is (as it is played — a time-lapse is
 *  shorter), and its time-lapse, if it is one. */
export type HouseCut = { cam: string; seconds: number; lapse?: TimeLapse | null };

/** THE CLOCK ACROSS THE CAMERAS. The first cut starts at `start`; each later one picks the time up where the
 *  cut before it ended (its clock as it stood on its last frame, a time-lapse's hours included) plus `gap`
 *  seconds — the moment it took to get to the next room. Returns each cut's clock. */
export function cutClocks(cuts: readonly HouseCut[], start: HouseClock, gap = 20): HouseClock[] {
  const out: HouseClock[] = [];
  let at = start.start;
  for (const c of cuts) {
    const clock = { date: start.date, start: at };
    out.push(clock);
    at = Math.round(clockAt(clock, c.lapse ?? null, Math.max(0, c.seconds)) + gap);
  }
  return out;
}
