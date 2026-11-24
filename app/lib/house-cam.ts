/* A HOUSE, SEEN BY ITS OWN CAMERAS — found footage from the cameras on the walls.
 *
 * The owner, 2026-11-24: "Found footage from house camera POVs also" — "Like this overlay" (a screenshot of a
 * home security camera) — "Need designated editing tools for found footage (like time lapse) hours go by on the
 * counter in seconds and the creepy hero stands over someone sleeping … if we put it as a scene setting it would
 * maximize easiness" — and: "Found footage would need to remember rooms even when panning to other cams in the
 * house". On the first cut built from this: "he needs to walk into the room no time lapse, then time lapse, it
 * appeared that he just spawned in instead of it being genuinely cinematic".
 *
 * So a HOUSE is kept, and it is made of ROOMS, one camera each:
 *   1. THE FIRST ROOM is drawn from words — an empty room, seen from a fixed camera high in its corner, at night
 *      in infrared.
 *   2. EVERY OTHER ROOM is drawn FROM the first ("another room of the same house": the same walls, floor, doors
 *      and the same kind of camera) — so cutting from one camera to the next is the same house.
 *   3. A SCENE in a room is drawn FROM that room's own empty picture with only what the scene adds (somebody
 *      asleep, the thing standing in it) — the room itself never changes between scenes.
 *   4. THE TAKE starts on the room as it is, and the direction arrives at the scene ("exactly as in" it): the
 *      camera never moves; the engine is given no word to speak (take.ts says why). The thing WALKS IN — the
 *      whole way, at real time: told only where it ends up, the engine made it appear from nowhere.
 *   5. THE CLOCK runs on across the cameras (cutClocks): a cut to another camera picks the time up where the
 *      last one left it, plus the moment it took to get to the next room — and across takes made days apart
 *      (houseNight): the house's night goes on until dawn, and the next take starts the next night.
 * A TIME-LAPSE is a scene SETTING (camera-dress.ts → TimeLapse), never something the prompt has to ask for:
 * each scare carries the window its stillness falls in, measured on a real take.
 *
 * Pure: the drawing, the rolling and the dressing are house-take.server.ts's (scratchpad t45/cam/ proved each
 * step on 2026-11-24: an empty living room, a bedroom drawn from it, a figure drawn into each — then the
 * walk-in, h-bed-walkin.txt, rolled at 15 seconds). */

import { camDate, clockAt, type HouseClock, type TimeLapse } from "./camera-dress.ts";

/** What every house camera's picture is — said once, the same for every room. */
export const HOUSE_CAMERA = "A single frame from a home security camera's own recording: a fixed camera mounted high in the corner of a room, looking down across the whole room through a wide-angle lens, so the walls and the ceiling line bow slightly outward toward the edges. The picture fills the whole frame from edge to edge — no black circle, no round vignette, no black corners. It is night and the camera is in infrared night vision: black and white with a faint cold cast, soft, grainy, a little compressed; the middle of the room washed pale by the infrared, the far corners falling away into darkness. It is real footage of a real room — never CGI, never a 3D render, never an illustration.";
const NO_WRITING = "Nothing written anywhere in the picture: no date, no time, no text, no watermark.";

/** How long a house-camera take is, in seconds — the engine's longest (it takes 3 to 15): a walk in, a long
 *  stillness and one slow movement need all of it. */
export const HOUSE_TAKE_SECONDS = 15;

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

export const houseRoom = (key: unknown): Omit<HouseRoom, "cam"> | undefined => HOUSE_ROOMS.find((r) => r.key === String(key ?? "").trim().toLowerCase());

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
export function roomPrompt(room: Pick<HouseRoom, "empty">, first: boolean): string {
  if (first) return `Wide 16:9 picture. ${HOUSE_CAMERA} ${room.empty} NOBODY is in the room. ${NO_WRITING}`;
  return `Wide 16:9 picture. ANOTHER ROOM OF THE SAME HOUSE as the reference image, recorded by the SAME kind of camera: a fixed security camera mounted high in a corner, looking down across the room through the same wide-angle lens, at night in the same grey infrared, with the same soft, grainy, compressed look. The same plain painted walls, the same floor, the same doors, door frames and skirting as the reference. The picture fills the whole frame from edge to edge — no black circle. ${room.empty} NOBODY is in the room. Real footage, never a render. ${NO_WRITING}`;
}

/** The light a scene is drawn in: the infrared grey every room is kept in, or — NIGHT VISION OFF — the dim
 *  colour of one small lamp. `relight`: the reference is still the infrared room, and is turned to colour here
 *  (the room the take starts on); without it the reference is in colour already (the scene drawn from it). */
export type SceneLight = { light?: "ir" | "lamp"; relight?: boolean };

/** The picture model's prompt for a scene in a room: the room's own picture, with only what the scene adds.
 *  (`withPerson`: the second reference image is somebody — the thing — already drawn, so it is the same one.)
 *  Nothing added: the room as it is (relit, when the night vision is off). */
export function scenePrompt(adds: string, opts: { withPerson?: boolean } & SceneLight = {}): string {
  const look = opts.light === "lamp"
    ? (opts.relight
      ? "the same grain — but in COLOUR: the camera's night vision is off and one small lamp is lit, a dim warm light that falls off fast into darkness"
      : "the same dim lamp light, in colour, and the same grain")
    : "the same infrared grey and grain";
  const what = adds.trim().replace(/\.$/, "");
  const add = what ? `with ONLY this added: ${what}. Nothing else in the room changes.` : "with nothing added: NOBODY is in the room, and nothing in it changes.";
  return `Wide 16:9 picture. EXACTLY the ${opts.withPerson ? "first " : ""}reference image — the same room, the same camera high in the corner, every piece of furniture and every door where it is, ${look} — ${add} No blood, no gore. Real footage, never a render. ${NO_WRITING}`;
}

/** The direction for a house-camera take: the camera never moves, nobody speaks, and what happens, in order.
 *  `room` names the room ("a bedroom"; unset: "the room"); `ir: false` is a night with the night vision off —
 *  a lamp lit, in colour. The beats carry their own times and their own way of naming the reference picture. */
export function houseTakePrompt(o: { beats: string[]; never: string; sound: string; room?: string; ir?: boolean }): string {
  const where = o.room ? `a ${o.room.trim().toLowerCase()}` : "the room";
  const light = o.ir === false ? "at night in colour, its night vision off: one small lamp is lit, a dim warm light that falls off fast into darkness" : "at night in infrared";
  const text = [
    `A fixed home security camera mounted high in the corner of ${where} records ${light}. The camera NEVER moves: no pan, no tilt, no zoom, no shake — it is screwed to the wall. One continuous shot, no cuts, nothing written on screen. NOBODY SPEAKS in this shot: no voice, no words, no whisper.`,
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

/* ---- READY-MADE HOUSE SCARES ----
 * Each one is built the way the walk-in take that worked is built (h-bed-walkin.txt, rolled at 15 s on
 * 2026-11-24 — "he walks the whole way" is the line that stopped him appearing from nowhere): an ordinary
 * room; the thing comes in through one of its doors and walks the WHOLE way; it stops, exactly as in the scene
 * picture; it holds perfectly still for a long time (the time-lapse window, when the setting is on); and then
 * ONE slow movement. Its beats carry their times, so the engine puts the walk first and the stillness in the
 * window. The engine is given no word to speak; nobody is filming, so nobody speaks afterwards either. */

/** Who the thing is. The house keeps the first picture it was drawn in, so the same one walks into every room:
 *  `first` names it the first time (drawn from words), `again` once its picture is the second reference. */
export type HouseThing = { key: string; first: string; again: string };

export type HouseScare = {
  key: string;
  name: string;
  /** a line for its card */
  line: string;
  /** the room it happens in (HOUSE_ROOMS) */
  room: string;
  thing: HouseThing;
  /** what the room holds BEFORE the thing arrives, drawn into the room's own picture ("" = the room as it is) */
  set: string;
  /** THE SCENE the take arrives at, as a picture — `{thing}` where the thing is named */
  scene: string;
  /** the direction, beat by beat, each with its time — `{ref}` where the scene picture is named */
  beats: string[];
  /** what it never does */
  never: string;
  /** the sound of the room and of it */
  sound: string;
  /** THE TIME-LAPSE WINDOW: the stretch of the take its stillness falls in (seconds of the take as rolled) */
  lapse: TimeLapse & { from: number };
  /** whether the time-lapse setting starts ON for this scare */
  lapseOn: boolean;
};

/** The one who walks into both rooms of the ready-made house (the figure of h-living-figure.txt). */
const TALL_MAN: HouseThing = {
  key: "tallman",
  first: "a very tall, very thin man in a dark old suit that is too short at the wrists",
  again: "the very tall, very thin man in the dark old suit from the second reference image",
};

export const HOUSE_SCARES: ReadonlyArray<HouseScare> = [
  {
    key: "overbed", name: "Over the bed", line: "He walks in. He stands over her. For hours.",
    room: "bedroom", thing: TALL_MAN,
    set: "a woman asleep in the bed on her side under the pale duvet, her face turned toward the camera, her dark hair on the pillow",
    scene: "{thing} stands at the side of the bed nearest the camera, bent forward stiffly at the waist over the sleeping woman, his pale face a hand's width above her sleeping face, looking down at her; his long pale hands hang at his sides. He is perfectly still. She does not wake. Nearly human and slightly wrong: too tall, too thin, waxy bloodless skin. Fully clothed",
    // (the wording of h-bed-walkin.txt, word for word: rolled at 15 s, it put him in the doorway at 0–1 s, out
    //  of it by 3, across the room under the camera by 6, at the bedside by 8, bent over her and still to the
    //  end, his head coming round to the lens at the last)
    beats: [
      "FIRST TWO SECONDS: an ordinary night. The woman sleeps. The half-open bedroom door on the right is black.",
      "THEN the very tall, very thin man in the dark suit of {ref} steps in through that doorway from the darkness, ducking his head under the top of the door frame, and walks slowly and stiffly across the wooden floor to the side of the bed nearest the camera, each step placed carefully, his long arms hanging loose. He walks the whole way: he never appears from nowhere, never jumps, never fades in.",
      "BY THE SIXTH SECOND he stands beside the bed exactly as in {ref}, bent stiffly at the waist over the sleeping woman, his pale face a hand's width above her face.",
      "THEN, FOR A LONG TIME, HE DOES NOT MOVE AT ALL: perfectly still, bent over her, for five whole seconds. She turns over once in her sleep and back. He stays exactly where he is. He does not blink.",
      "LAST FOUR SECONDS: very slowly, his head turns up from her face toward the camera in the corner, until he is looking straight into the lens. His body does not move. The woman never wakes.",
    ],
    never: "He never runs, never flinches, never speaks, never opens his mouth.",
    sound: "a quiet bedroom at night, the woman's slow breathing, a clock ticking, slow creaking footsteps on the wooden floor as he crosses the room",
    // (the window that played right on that take: 8.5 s at real time, 3.5 s played in one, three at real time —
    //  the clock read 01:12:48 → racing → 03:42:48 → 03:42:50)
    lapse: { from: 8.5, fast: 3.5, speed: 3.5, hours: 2.5 },
    lapseOn: true,
  },
  {
    key: "lookup", name: "Looking up", line: "It walks in, stops, and stares up at the camera.",
    room: "living", thing: TALL_MAN,
    set: "",
    scene: "{thing} stands in the middle of the floor between the coffee table and the camera, facing the camera, his long pale hands hanging at his sides, his head tipped back so that his pale face is turned straight UP at the camera in the corner; two small white points where his eyes catch the light. He is perfectly still. What frightens is how nearly human he is: too tall, too thin, the skin waxy and bloodless, nothing about him standing the way a person would. He is fully clothed",
    // (the approach is h-living-take.txt's, which rolled well with him already in the room; the way in is the
    //  bedroom's walk-in, so he is never simply there)
    beats: [
      "FIRST TWO SECONDS: an ordinary night. The living room is empty and still. The open doorway to the dark hallway in the far wall is black.",
      "THEN the very tall, very thin man in the dark suit of {ref} steps out of that dark doorway, ducking his head under the top of the door frame, and walks slowly and stiffly into the middle of the room, each step placed carefully, his long arms hanging loose. He walks the whole way: he never appears from nowhere, never jumps, never fades in.",
      "BY THE SIXTH SECOND he stands in the middle of the floor between the coffee table and the camera exactly as in {ref}, his head tipped back, his pale face turned straight up at the camera in the corner.",
      "THEN, FOR A LONG TIME, HE DOES NOT MOVE AT ALL: perfectly still, staring up at the camera, for four whole seconds. He does not blink. His mouth stays closed.",
      "LAST FIVE SECONDS: slowly, he walks toward the camera — stiff, smooth, unhurried, each step placed carefully, his face never leaving the lens — until he stands directly beneath the camera, so close that his upturned face fills the bottom of the frame, looking straight up into the lens. He stays there, perfectly still.",
    ],
    never: "He never runs, never flinches, never looks away, never speaks, never opens his mouth. Nothing else in the room moves.",
    sound: "a quiet house at night, a clock ticking somewhere, slow footsteps creaking on a wooden floor",
    // (his stillness, by the direction's own times: from about the seventh second to the tenth — NOT yet
    //  measured on a rolled take; the setting starts off)
    lapse: { from: 7.5, fast: 2.5, speed: 2.5, hours: 2 },
    lapseOn: false,
  },
];

export const houseScare = (key: unknown): HouseScare | undefined => HOUSE_SCARES.find((s) => s.key === String(key ?? "").trim().toLowerCase());

/** The picture a house take ARRIVES at, as the picture model is asked for it (drawn from the room as the take
 *  finds it — `kept`: the thing is already in the house, its picture the second reference). */
export function houseScenePrompt(s: Pick<HouseScare, "scene" | "thing">, opts: { kept?: boolean; ir?: boolean } = {}): string {
  const adds = s.scene.replace(/\{thing\}/g, opts.kept ? s.thing.again : s.thing.first);
  return scenePrompt(adds, { withPerson: !!opts.kept, light: opts.ir === false ? "lamp" : "ir" });
}

/** The room as the take FINDS it (what the scare puts there before the thing arrives, and the lamp when the
 *  night vision is off) — or null when it is the room's own kept picture, unchanged. */
export function houseSetPrompt(s: Pick<HouseScare, "set">, opts: { ir?: boolean } = {}): string | null {
  if (!s.set.trim() && opts.ir !== false) return null;
  return scenePrompt(s.set, { light: opts.ir === false ? "lamp" : "ir", relight: opts.ir === false });
}

/** The direction for a house scare: its beats with the reference named the way this host names it. */
export function houseScarePrompt(s: HouseScare, ref: string, opts: { ir?: boolean } = {}): string {
  const room = houseRoom(s.room)?.name || "room";
  return houseTakePrompt({ room, ir: opts.ir, beats: s.beats.map((b) => b.replace(/\{ref\}/g, ref)), never: s.never, sound: s.sound });
}

/* ---- A HOUSE SCARE OF THE MEMBER'S OWN ----
 * The writer fills in the parts; the app puts them in the shape that worked (the walk-in, the stillness — the
 * time-lapse window — and one slow movement), with the times. */

/** The window a written scare's stillness falls in — the shape is the walk-in's, so it is the walk-in's window. */
export const OWN_SCARE_LAPSE: TimeLapse & { from: number } = { from: 8.5, fast: 3.5, speed: 3.5, hours: 2.5 };

const one = (s: unknown, max: number) => String(s ?? "").replace(/["“”]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const stop = (s: string) => (s && !/[.!?]$/.test(s) ? `${s}.` : s);

/** WRITE ME ONE — the brief for the writer when a member describes a house-camera scare of their own. The answer
 *  is JSON: { title, who, thing, set, door, stands, waits, acts, sound }. */
export function houseWriterBrief(idea: string, room: Pick<HouseRoom, "name" | "empty">): string {
  return [
    "You are directing ONE continuous fifteen-second shot from a home security camera: fixed high in the corner of a room, at night. Nobody is holding it; nobody is filming; nothing is said. Not a story: a moment.",
    `THE IDEA: ${one(idea, 400) || "something that should not be in the house"}`,
    `THE ROOM: ${room.name}. ${room.empty}`,
    "It is built the way the scares that work are built. (1) An ordinary night: the room is still. (2) THE THING COMES IN through one of the room's own doors or doorways and WALKS the whole way to where it stops — it never appears from nowhere. (3) It stops, and HOLDS PERFECTLY STILL for a long time — this is the scare. (4) ONE slow, wrong movement: a head turning up to the camera, a step toward the lens.",
    "What frightens is slowness and stillness. It NEVER runs, flinches, screams or speaks; nothing flashes or glitches. ITS MOUTH NEVER MOVES.",
    "THE THING is nearly human and slightly wrong: ONE or TWO exact wrongnesses and no more (too tall, too thin, a neck or fingers too long, skin like candle wax, eyes sunk in dark sockets). Never horns, wings, tentacles, glowing eyes, flames or a bare skull. No blood, no gore, no wounds, nobody hurt. Fully clothed.",
    'Answer with JSON only: {"title": a short name for it (2–5 words), "who": "he", "she" or "it", "thing": what it is and looks like, one phrase starting with "a" or "an" ("a very tall woman in a long grey nightgown, her wet hair hanging over her face"), "set": what is in the room before it arrives, as one short sentence (somebody asleep, a dog in its basket), or "" for nothing, "door": the door or doorway of THIS room it comes in through, as the room names it ("the half-open door on the right"), "stands": where it stops and how it stands there, present tense, without the subject ("stands at the foot of the bed, facing the sleeper, her head bowed"), "waits": what else moves while it stands perfectly still, one short sentence, or "" ("The man turns over in his sleep."), "acts": its one slow movement at the end, present tense, without the subject ("turns her head up toward the camera until she is looking straight into the lens"), "sound": the sound of the room and of it, in a few words}',
  ].join("\n");
}

/** The writer's answer, checked and put in the shape that works — or null (the caller falls back to a
 *  ready-made scare rather than film half a direction). */
export function parseHouseScare(raw: unknown, roomKey: string): (HouseScare & { title: string }) | null {
  let o: Record<string, unknown> | null = null;
  try {
    const s = typeof raw === "string" ? raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1) : "";
    o = typeof raw === "object" && raw ? (raw as Record<string, unknown>) : s ? JSON.parse(s) : null;
  } catch { o = null; }
  const room = houseRoom(roomKey);
  if (!o || !room) return null;
  const who = one(o.who, 8).toLowerCase();
  const pro = who === "she" ? "she" : who === "he" ? "he" : who === "it" ? "it" : "";
  const thing = one(o.thing, 220).replace(/\.$/, ""), set = one(o.set, 200).replace(/\.$/, ""), door = one(o.door, 90).replace(/\.$/, "");
  const stands = one(o.stands, 260).replace(/\.$/, ""), waits = one(o.waits, 180), acts = one(o.acts, 260).replace(/\.$/, "");
  if (!pro || !/^(a|an)\s/i.test(thing) || thing.length < 12 || stands.length < 12 || acts.length < 12) return null;
  if (!/\b(door|doorway|hall|hallway|stairs|window)\b/i.test(door)) return null;
  // it never speaks: a writer who has it say anything is not followed
  if (/\b(speaks?|says?|whispers?|screams?|shouts?|laughs?|mouths?)\b/i.test(`${stands} ${acts}`)) return null;
  const Pro = cap(pro), poss = pro === "she" ? "her" : pro === "he" ? "his" : "its";
  const the = thing.replace(/^(a|an)\s+/i, "the ");
  const doorThe = door.replace(/^(a|an)\s+/i, "the ");
  return {
    title: one(o.title, 60) || "House camera",
    key: "own", name: one(o.title, 60) || "House camera", line: "", room: room.key,
    // (a thing of the member's own is not kept in the house: nothing says the next one is the same)
    thing: { key: "", first: thing, again: thing },
    set,
    scene: `{thing} ${stands}. ${Pro} is perfectly still. Nearly human and slightly wrong. Fully clothed`,
    beats: [
      `FIRST TWO SECONDS: an ordinary night. ${set ? stop(cap(set)) : `The ${room.name.toLowerCase()} is empty and still.`} ${cap(doorThe)} is black.`,
      `THEN ${the} — the one in {ref} — comes in through ${doorThe} from the darkness and walks slowly and stiffly across the room, each step placed carefully. ${Pro} walks the whole way: ${pro} never appears from nowhere, never jumps, never fades in.`,
      `BY THE SIXTH SECOND ${pro} ${stands} exactly as in {ref}.`,
      `THEN, FOR A LONG TIME, ${pro.toUpperCase()} DOES NOT MOVE AT ALL: perfectly still for five whole seconds.${waits ? ` ${stop(cap(waits))}` : ""} ${Pro} stays exactly where ${pro} is. ${Pro} does not blink.`,
      `LAST FOUR SECONDS: very slowly, ${pro} ${acts}.`,
    ],
    never: `${Pro} never runs, never flinches, never speaks, never opens ${poss} mouth.`,
    sound: one(o.sound, 90) || "a quiet house at night, a clock ticking",
    lapse: OWN_SCARE_LAPSE,
    lapseOn: false,
  };
}

/* ---- THE HOUSE, KEPT ----
 * What a shop's house is, once it has one: each room's EMPTY picture in the order the rooms were drawn (the first
 * is the one every other was drawn from, and the order is the cameras' numbers), the first picture each thing
 * was drawn in, and the night its cameras are recording. It rides on every house take's own record
 * (house-take.server.ts), so the next take finds it there. */

export type HouseNight = { date: string; end: number };
export type KeptHouse = {
  v: 1;
  rooms: Array<{ key: string; img: string }>;
  things: Array<{ key: string; img: string }>;
  night: HouseNight | null;
};
export const EMPTY_HOUSE: KeptHouse = { v: 1, rooms: [], things: [], night: null };

/** a picture on our own renders disk — nothing else is ever handed back to a model as a room */
const RENDER_PIC = /^\/renders\/[\w.-]+\.(?:jpe?g|png|webp)$/i;
const CAM_DATE = /^\d{4}-\d{2}-\d{2} (SUN|MON|TUE|WED|THU|FRI|SAT)$/;

/** A kept house as it was stored, checked — or null. Unknown rooms, foreign pictures and a second copy of a room
 *  are dropped; what is left keeps its order. */
export function keptHouseOf(raw: unknown): KeptHouse | null {
  let o: Record<string, unknown> | null = null;
  try { o = typeof raw === "string" ? JSON.parse(raw) : raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null; } catch { o = null; }
  if (!o || o.v !== 1 || !Array.isArray(o.rooms)) return null;
  const pics = (list: unknown, ok: (k: string) => boolean) => {
    const seen = new Set<string>();
    const out: Array<{ key: string; img: string }> = [];
    for (const x of Array.isArray(list) ? list : []) {
      const key = String((x as { key?: unknown })?.key ?? "").trim().toLowerCase(), img = String((x as { img?: unknown })?.img ?? "");
      if (!ok(key) || seen.has(key) || !RENDER_PIC.test(img)) continue;
      seen.add(key); out.push({ key, img });
    }
    return out;
  };
  const rooms = pics(o.rooms, (k) => !!houseRoom(k)).slice(0, HOUSE_ROOMS.length);
  const things = pics(o.things, (k) => /^[a-z0-9-]{2,24}$/.test(k)).slice(0, 12);
  const n = o.night as { date?: unknown; end?: unknown } | null | undefined;
  const night = n && CAM_DATE.test(String(n.date ?? "")) && Number.isFinite(Number(n.end)) && Number(n.end) >= 0 && Number(n.end) < 86400
    ? { date: String(n.date), end: Math.round(Number(n.end)) } : null;
  if (!rooms.length) return null;
  return { v: 1, rooms, things, night };
}

/** The picture a room is kept as, or null when the house has never seen it. */
export const roomImg = (h: KeptHouse | null, key: string): string | null => h?.rooms.find((r) => r.key === key)?.img || null;
/** The first picture a thing was drawn in, in this house. */
export const thingImg = (h: KeptHouse | null, key: string): string | null => (key ? h?.things.find((t) => t.key === key)?.img || null : null);
/** A room's camera, as it is named on screen: its place among the house's rooms (a room not yet drawn gets the next
 *  number). */
export function camOf(h: KeptHouse | null, key: string): string {
  const i = (h?.rooms || []).findIndex((r) => r.key === key);
  return `CAM ${(i >= 0 ? i : (h?.rooms.length || 0)) + 1}`;
}
/** How a room the house does not have yet is drawn: from words when it is the house's first, else FROM the first
 *  room's picture. Null when the room is kept already. */
export function roomToDraw(h: KeptHouse | null, key: string): { first: boolean; from: string | null } | null {
  if (roomImg(h, key)) return null;
  const first = h?.rooms[0]?.img || null;
  return { first: !first, from: first };
}
export const withRoom = (h: KeptHouse | null, key: string, img: string): KeptHouse => {
  const base = h || EMPTY_HOUSE;
  return roomImg(base, key) ? base : { ...base, rooms: [...base.rooms, { key, img }] };
};
export const withThing = (h: KeptHouse, key: string, img: string): KeptHouse =>
  !key || thingImg(h, key) ? h : { ...h, things: [...h.things, { key, img }] };

/* ---- A BELIEVABLE NIGHT ----
 * The clock a house take is dressed with. A house's night runs on from one take to the next, the way it runs on
 * from one camera to the next (cutClocks) — until it would reach dawn; then the next take is the next night. A
 * night is between twenty past midnight and twenty to six. */

export const NIGHT = { from: 20 * 60, lastStart: 3 * 3600 + 30 * 60, dawn: 5 * 3600 + 40 * 60, gapMin: 20, gapMax: 90 } as const;

/** How long a take lasts once it is dressed: a time-lapse plays its window fast. */
export const playedSeconds = (seconds: number, lapse: TimeLapse | null): number =>
  lapse ? Math.max(0, seconds - lapse.fast + lapse.fast / lapse.speed) : seconds;

/** The night after this one, as the camera prints it. */
export function nextNightDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  return camDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** This take's clock, and the house's night once it has been played. `today`: the date a new house's first
 *  night is (as the camera prints it); `seed`: any whole number — the gap between takes and the hour a new night
 *  starts at are picked by it, so two houses do not keep the same hours. */
export function houseNight(o: { prev: HouseNight | null; seconds: number; lapse: TimeLapse | null; today: string; seed: number }): { clock: HouseClock; night: HouseNight } {
  const played = playedSeconds(o.seconds, o.lapse);
  const endOf = (start: number) => clockAt({ date: "", start }, o.lapse, played);
  const seed = Math.abs(Math.floor(Number(o.seed) || 0));
  if (o.prev) {
    const start = Math.round(o.prev.end + NIGHT.gapMin + (seed % (NIGHT.gapMax - NIGHT.gapMin + 1)));
    if (start >= NIGHT.from && endOf(start) <= NIGHT.dawn) return { clock: { date: o.prev.date, start }, night: { date: o.prev.date, end: Math.round(endOf(start)) } };
  }
  const date = o.prev ? nextNightDate(o.prev.date) : o.today;
  const latest = Math.max(NIGHT.from, Math.min(NIGHT.lastStart, NIGHT.dawn - Math.ceil(endOf(0))));
  const start = NIGHT.from + (latest > NIGHT.from ? seed % (latest - NIGHT.from + 1) : 0);
  return { clock: { date, start }, night: { date, end: Math.round(endOf(start)) } };
}
