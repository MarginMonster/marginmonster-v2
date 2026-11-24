/* A TAKE — one continuous shot that something HAPPENS in. Found footage.
 *
 * The owner, 2026-11-24, after a ten-second action shot ("FUCKING BANGER") and a horror story: "Would be cool
 * to also get a \"found Footage\" style pipeline, that would do blair witch style creatives"; "I dont think
 * many people would do a singular scare shot and call it, there would need to be some type of exchange at the
 * bare minimum (voice saying \"babe whats wrong\" then boom the scare shot)". Then, take by take:
 *
 *   the first one    "it looks like the zap scares the scary person and she runs into the room and turns
 *                    around, can we enhance the creepy?"
 *   the re-roll      "she lip synced what the camera said towards the very beggining, creepy but im sure its
 *                    a glitch... But honestly - better"
 *   the bed          "bro the monster literally lipsynced every word"
 *   and an idea      "would be even better if these 10 second footages had like a 2 second off of subject at
 *                    the beggining then pans to the actual scene"
 *   the two re-rolls built from all of that: "Both of those films are fucking cinema"
 *
 * So a take is built from these parts, and this file is their wording (plain logic — tests/take.test.ts):
 *
 *   WHO     the thing in the frame, in a few words ("she", "the figure") — what the direction calls it.
 *   STILL   the scene the take ARRIVES at, drawn by the creature recipe the horror stories use
 *           (story-picture.ts): CAUGHT on a bad camera, nearly human and slightly WRONG, mostly HIDDEN.
 *   OPENS   where the camera is looking BEFORE it finds the thing — the same place, nobody in it. It is
 *           drawn FROM the still (so the house, the light and the grain are the same) and is the take's first
 *           frame; the still itself is handed to the engine as a reference, and the direction says to arrive
 *           at "exactly" it. Two seconds off the subject, then the camera FINDS it.
 *   BEATS   three of them: stillness; ONE wrong movement; then it comes toward the lens. Slow is what
 *           frightens — the first take was fast, and read as a startled person.
 *   SAYS    what the one filming says. THE ENGINE IS NEVER GIVEN THESE WORDS. It speaks any line it is
 *           handed — and moves the only mouth it can see to it: told that the voice came from behind the
 *           camera and that the thing's lips did not move, it still gave every word to the thing under the
 *           bed. So the direction says NOBODY SPEAKS, the thing's mouth never opens and closes at all, and
 *           the lines are a separate voice laid over the finished take (takeLines → takeSound).
 *   NEVER   what must not happen, said outright: it never flinches, runs, turns away, screams or speaks;
 *           nothing flashes, glitches or tears; the camera, once it has found the thing, never leaves it;
 *           and the one filming is never IN the picture (a take told that "the one filming shuffles
 *           backwards" ended with a pair of legs walking into the frame).
 *
 * The camera it was "shot on" (a phone, a camcorder, or nothing) is camera-dress.ts: the direction here only
 * says who is holding what, so the picture and the overlay tell the same story. */

import type { CameraLook } from "./camera-dress.ts";

/** How long the camera is off its subject at the start, in seconds. */
export const TAKE_OPENS_SECONDS = 2;
/** How long a take is, in seconds: the two it spends getting there, and ten of the scene. (The engine
 *  takes any whole length from 3 to 15.) */
export const TAKE_SECONDS = 12;
/** The engine refuses a prompt over 2,500 characters; a take's direction stays under this. */
export const TAKE_PROMPT_MAX = 2400;

/** The recipe for a first frame (the same three parts the horror stories' creatures are drawn with). */
export const TAKE_CAUGHT = "A single frame of real footage, caught by accident: shot at night on a handheld camera, badly underexposed, heavy grain and sensor noise, soft focus, a little motion blur, crushed blacks; one weak light that falls off fast into darkness. It is PHOTOGRAPHED — a real thing in a real place, like a practical-effects creature in a 1970s horror film — never CGI, never a 3D render, never an illustration, never a clean studio portrait.";
export const TAKE_WRONG = "What frightens is how nearly human it is: the proportions are a little off, the skin is waxy and bloodless, the eyes are sunk deep in dark sockets with one small wet glint, and nothing about it moves the way a person would.";
export const TAKE_HIDDEN = "Most of it is lost in the dark or behind something; we see less than we want to. No blood, no gore, no wounds.";

export type Take = {
  /** what the direction calls the thing in the frame */
  who: string;
  /** the scene the take arrives at, in words (the recipe is added around it) */
  still: string;
  /** WHERE THE CAMERA LOOKS FIRST: the same place with nobody in it, as a picture (drawn from the still) */
  opens: string;
  /** what the one filming is doing for those two seconds, as the direction says it */
  first: string;
  /** how the camera gets from there to the thing ("swings up to the hallway ahead") */
  finds: string;
  /** stillness · the one wrong movement · the approach */
  beats: [string, string, string];
  /** what the one filming says — a separate voice, NEVER given to the picture engine: the worried
   *  question, then what is said as it comes closer */
  says: [string, string];
  /** when the question is asked: while still "looking" (before the camera has found anything — "Who's up
   *  there?") or once it is "found" ("Babe? … what's wrong?") */
  asks: "looking" | "found";
  /** the sound of the place and of the thing, in a few words */
  sound: string;
};

export type TakeIdea = Take & { key: string; name: string; line: string };

/** READY-MADE SCARES — a take without writing one. Each was rolled and looked at frame by frame (the mouth
 *  too) before it was offered; the first and the third are the two the owner called cinema. Tests hold the
 *  list. */
export const TAKE_IDEAS: ReadonlyArray<TakeIdea> = [
  {
    key: "smile", name: "She's smiling", line: "Someone you know, at the end of the hall, smiling wrong.",
    who: "she",
    still: "A woman leans into the frame from a dim doorway, long tangled hair hanging over half her face, one eye visible and fixed on the camera; she is smiling, and the smile is far too wide for a human mouth, full of crowded, jagged, yellowed teeth. A warm weak lamp somewhere behind the camera; a plain old cardigan; one hand raised to her chest.",
    opens: "the camera is pointed down at the floor of a dark hallway as the person holding it walks — bare wooden floorboards lit by the camera's own small weak light, the bottom of a door frame at the top edge of the picture, deep darkness beyond.",
    first: "the camera looks down at the dark floorboards while the one filming walks slowly forward; the picture sways a little with each step.",
    finds: "swings up to the hallway ahead",
    beats: [
      "she is standing in that hallway, in that light — long tangled hair over half her face, one eye fixed on the camera, the smile far too wide and full of crowded teeth, a plain old cardigan. She stands perfectly still, smiling at the camera. She does not blink. The smile is fixed.",
      "her head tilts to one side, much too far, until her ear is almost resting on her shoulder. The smile does not change. Her eyes never leave the lens.",
      "she walks toward the camera — slow, smooth, unhurried, arms hanging loose at her sides, head still tilted, still smiling, never blinking — while the camera backs away one small step at a time. She keeps coming, closer and closer, until her smiling face fills the whole frame.",
    ],
    says: ["Babe? ... Babe, what's wrong?", "no... no..."],
    asks: "found",
    sound: "slow footsteps on a wooden floor, her bare footsteps",
  },
  {
    key: "stairs", name: "Top of the stairs", line: "Something tall is standing where the light gives out.",
    who: "the figure",
    still: "Looking up a narrow staircase in an ordinary old house, lit only by the camera's own weak light: at the top, where the light gives out, a very tall, very thin figure stands with its head bent against the ceiling, arms hanging past its knees, the face a pale smear turned toward us. It is perfectly still.",
    opens: "the camera looks at the foot of a narrow staircase from the hallway — the bottom two steps, worn carpet, the wooden newel post and the start of the banister, lit by the camera's own small weak light; the stairs above are out of the picture.",
    first: "the camera looks at the foot of the stairs while the one filming stands still and listens.",
    finds: "tilts slowly up the staircase to the top, where the light gives out",
    beats: [
      "at the top of the stairs a very tall, very thin figure stands with its head bent against the ceiling, arms hanging past its knees, its pale face turned down toward the camera. It stands perfectly still.",
      "its head leans slowly to one side, further than a neck allows, and one long arm lifts and rests its fingers on the banister, one finger at a time.",
      "the figure comes down the stairs toward the camera — one step, a pause, another step — slow, never bending at the knees, its face always turned to the lens, while the camera backs away from the foot of the stairs. It keeps coming until its pale face is all the frame holds.",
    ],
    says: ["Hello? ... Who's up there?", "oh no... no..."],
    asks: "looking",
    sound: "the stairs creaking one at a time",
  },
  {
    key: "bed", name: "Under the bed", line: "You heard something. You look. It is looking back.",
    who: "the face",
    still: "The camera is held low, at floor level, looking into the black gap under an ordinary bed: in the dark there, lying on its side with its cheek on the floorboards, a pale, slack face is looking straight at the camera — wet black eyes wide open, a small closed smile — and the fingertips of one hand rest on the floor in front of it, the fingers far too long.",
    opens: "seen from standing height, the camera looks down at the side of that bed — the rumpled grey duvet hanging over the edge of the mattress, the wooden bed frame, bare wooden floorboards below; the gap under the bed is only a black strip low in the picture.",
    first: "the camera looks at the side of the bed from standing height — the rumpled duvet, the wooden frame — while the one filming stands still and listens.",
    finds: "sinks slowly down to the floor and looks into the black gap under the bed",
    beats: [
      "lying on its side in the dark under the bed with its cheek on the floorboards, a pale slack face is looking straight at the camera — wet black eyes wide open, a small closed smile — the fingertips of one long-fingered hand resting on the floor in front of it. It lies perfectly still. It does not blink.",
      "the long fingers begin to walk forward across the floorboards toward the lens, one finger at a time. The face does not change.",
      "the face slides out from under the bed toward the camera — slow, smooth, its cheek still on the floor, its eyes never leaving the lens, still smiling that small closed smile — while the camera backs away across the floor. It keeps coming until its face fills the whole frame.",
    ],
    says: ["Is someone... is someone under there?", "no, no, no..."],
    asks: "looking",
    sound: "fingernails on floorboards, something dragging",
  },
];

export const takeIdea = (key: unknown): TakeIdea | undefined => TAKE_IDEAS.find((i) => i.key === String(key ?? "").trim().toLowerCase());

const one = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const stop = (s: string) => (s && !/[.!?]$/.test(s) ? `${s}.` : s);
const shapeOf = (aspect: "9:16" | "16:9") => (aspect === "16:9" ? "Wide 16:9 picture." : "Vertical 9:16 picture.");

/** The picture model's prompt for the scene a take arrives at. */
export function takeStillPrompt(t: Pick<Take, "still">, aspect: "9:16" | "16:9" = "9:16"): string {
  return `${shapeOf(aspect)} ${TAKE_CAUGHT} ${one(t.still, 700)} ${TAKE_WRONG} ${TAKE_HIDDEN} Nothing written anywhere in the picture. No watermark, no signature.`;
}

/** The picture model's prompt for the take's FIRST frame — off its subject — drawn FROM the scene's own
 *  still (which is handed over as the reference image): the same place, a moment earlier, nobody in it. */
export function takeOpensPrompt(t: Pick<Take, "opens">, aspect: "9:16" | "16:9" = "9:16"): string {
  return `${shapeOf(aspect)} The SAME place and the SAME camera as the reference image, a moment earlier: ${stop(one(t.opens, 420))} NOBODY is in the picture: no person, no face, no hand, no figure, no shape under a cover. Lit only by the camera's own small weak light; the same underexposed, grainy, soft look as the reference image — real footage, never a render. Nothing written anywhere.`;
}

/** What the one filming is holding, as the direction says it — the same story the overlay tells. */
const HELD: Record<CameraLook, string> = {
  phone: "Shot on a phone at night, held in one hand, the phone's own small light on",
  camcorder: "Shot on a small home camcorder at night, held in one hand, its little lamp on",
  bare: "Handheld, at night, one small light on",
  // (a house camera is nobody's: it is screwed to the wall, and the take's way in is the room itself)
  house: "Recorded at night by a fixed security camera mounted high in the corner of the room, in infrared; the camera never moves, pans, tilts or zooms",
  // (a body camera is worn on the chest of the one walking in: it sees what they face, bobbing with each step)
  bodycam: "Recorded at night by a body camera worn on the chest of the one walking in, through its wide-angle lens; the picture bobs gently with every step; a flashlight held beside it lights the way",
};

/** How a host's prompt names the reference picture (the scene the take arrives at). */
export const TAKE_REF = { replicate: "<<<image_1>>>", fal: "@Image1" } as const;

/** The direction for the take itself: two seconds off the subject, the camera finds it, the wrong movement,
 *  the approach — and what never happens. NO SPOKEN WORD is in it (see the header): `ref` is how this host
 *  names the reference picture. */
export function takePrompt(t: Take, camera: CameraLook = "phone", ref: string = TAKE_REF.replicate): string {
  const who = one(t.who, 40) || "it";
  const obj = /^(she|he)$/i.test(who) ? (who.toLowerCase() === "she" ? "her" : "him") : who;
  const poss = /^she$/i.test(who) ? "her" : /^he$/i.test(who) ? "his" : "its";
  const [b1, b2, b3] = t.beats.map((b) => one(b, 520));
  const text = [
    `${HELD[camera]}. One continuous take, no cuts, nothing written on screen. NOBODY SPEAKS in this shot: no voice, no words, no whisper — only breathing and the quiet of the place.`,
    `FIRST TWO SECONDS: ${stop(one(t.first, 260))}`,
    `THEN the camera ${one(t.finds, 160)} and stops: there, exactly as in ${ref}, ${stop(b1)} ${cap(poss)} mouth does not open or close.`,
    `THEN, slowly: ${stop(b2)}`,
    `LAST FOUR SECONDS: ${stop(b3)}`,
    `${cap(who)} never runs, never flinches, never turns around and never looks away; never screams, never speaks, never opens ${poss} mouth, never mouths a word. Once the camera has found ${obj} it never leaves ${obj}: it never swings away, never drops, never falls. The one filming is never in the picture: no legs, no feet, no body. Nothing flashes; the light does not change; the picture never glitches or tears.`,
    `Sound: a quiet house at night, breathing getting faster, ${one(t.sound, 90) || "slow footsteps"}. No voice at all. No music.`,
  ].join(" ");
  return text.length <= TAKE_PROMPT_MAX ? text : text.slice(0, TAKE_PROMPT_MAX);
}

/* ---- THE VOICE BEHIND THE CAMERA ----
 * A separate voice, said by the app's own speaking model and laid over the finished take. */

/** The voice of the one filming, and how it is said (the voice and the manner of the takes the owner
 *  called cinema). */
export const TAKE_VOICE = { id: "English_magnetic_voiced_man", emotion: "fearful", speed: 0.95 } as const;
/** How long after the camera finds the thing the question comes, when it is asked on seeing it. */
const ASK_AFTER_FOUND = 0.8;
/** The plea comes as it starts toward the lens (the last four seconds begin at TAKE_SECONDS − 4). */
const PLEA_AT = TAKE_SECONDS - 3.4;
/** The least silence between the end of one line and the start of the next. */
export const TAKE_LINE_GAP = 0.6;

export type TakeLine = { at: number; text: string };

/** What is said, and when: the question (while looking, or on finding it) and the plea as it comes. */
export function takeLines(t: Pick<Take, "says" | "asks">): TakeLine[] {
  const say = (s: unknown) => one(s, 90).replace(/["“”]/g, "'");
  const [ask, plea] = [say(t.says[0]), say(t.says[1])];
  const out: TakeLine[] = [];
  if (ask) out.push({ at: t.asks === "looking" ? 0.3 : TAKE_OPENS_SECONDS + ASK_AFTER_FOUND, text: ask });
  if (plea) out.push({ at: PLEA_AT, text: plea });
  return out;
}

/** The lines' real times once each one's length is known (seconds, in order): a line never starts before
 *  the one before it has ended and a breath has passed; one that would run past the end of the take is said
 *  EARLIER, so that it ends inside it — and left out only when there is no room for it at all (never cut off
 *  mid-word). */
export function placeLines<T extends { at: number; seconds: number }>(lines: T[], total: number = TAKE_SECONDS): T[] {
  const out: T[] = [];
  let free = 0;
  for (const l of lines) {
    if (!(l.seconds > 0)) continue;
    const latest = total - 0.15 - l.seconds;
    const at = Math.round(Math.min(Math.max(l.at, free), latest) * 100) / 100;
    if (at < free - 0.005 || at < 0) continue;
    out.push({ ...l, at });
    free = at + l.seconds + TAKE_LINE_GAP;
  }
  return out;
}

/** How loud the room of a take should be once it is finished, and the most it is ever lifted by. Told that
 *  nobody speaks, the engine answers with a room that is nearly silent (measured on the first two such
 *  takes: −55 and −62 dB); a phone's microphone is never that quiet. */
export const TAKE_ROOM_DB = -34;
export const TAKE_LIFT_MAX_DB = 30;

/** THE SOUND OF A FINISHED TAKE, as an ffmpeg filter graph. The inputs are, in order: the take (0), each
 *  spoken line (1 … n), and one input of brown noise for the hiss (n + 1). The take's own room is lifted to a
 *  real level, a faint low hiss is laid under everything so the voice sits IN the room, and each line is a
 *  little band-limited with a touch of room — someone standing right behind the lens. The mix is `[a]`. */
export function takeSound(o: { lines: Array<{ at: number }>; roomDb: number | null; hasSound: boolean }): string {
  const n = o.lines.length;
  const lift = o.hasSound && o.roomDb !== null && Number.isFinite(o.roomDb) ? Math.max(0, Math.min(TAKE_LIFT_MAX_DB, TAKE_ROOM_DB - o.roomDb)) : 0;
  const parts: string[] = [];
  parts.push(o.hasSound
    ? `[0:a]aresample=48000,aformat=channel_layouts=stereo,volume=${lift.toFixed(1)}dB[amb]`
    : `[${n + 1}:a]aformat=channel_layouts=stereo,volume=-90dB[amb]`);
  parts.push(`[${n + 1}:a]aformat=channel_layouts=stereo,highpass=f=60,lowpass=f=1400,volume=-17dB[hiss]`);
  o.lines.forEach((l, i) => {
    const ms = Math.max(0, Math.round(l.at * 1000));
    parts.push(`[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,highpass=f=150,lowpass=f=6500,aecho=0.8:0.5:14:0.18,volume=-1dB,adelay=${ms}|${ms}[v${i}]`);
  });
  parts.push(`[amb][hiss]${o.lines.map((_, i) => `[v${i}]`).join("")}amix=inputs=${n + 2}:normalize=0:duration=first,alimiter=limit=0.9[a]`);
  return parts.join(";");
}
/** The hiss input `takeSound` expects, as an ffmpeg lavfi source. */
export const TAKE_HISS = "anoisesrc=color=brown:amplitude=0.05:sample_rate=48000";

/** WRITE ME ONE — the brief for the writer when a member describes a take of their own. The answer is JSON:
 *  { title, who, still, opens, first, finds, beats: [3], says: [2], asks, sound }. */
export function takeWriterBrief(idea: string): string {
  return [
    "You are directing ONE continuous twelve-second shot of found footage — something caught on a camera somebody was holding. Not a story: a moment.",
    `THE IDEA: ${one(idea, 400) || "something that should not be in the house"}`,
    "It is built the way a scare is built. FIRST, for two seconds, the camera is NOT on the thing: it is looking somewhere ordinary in the same place — the floor as its holder walks, the side of a bed, the foot of a staircase — and nobody is in the picture. THEN the camera moves and FINDS it, and three beats follow: (1) STILLNESS — the thing is there, perfectly still, looking at the camera. (2) ONE WRONG MOVEMENT — small, slow, impossible for a person: a head tilting too far, fingers walking. (3) IT COMES — slowly, smoothly, toward the camera, never taking its eyes off the lens, while the camera backs away; it ends with it filling the frame.",
    "What frightens is slowness and stillness. It NEVER runs, flinches, turns away or screams, and nothing flashes or glitches — a startled thing is not frightening.",
    "ITS MOUTH NEVER MOVES. Nothing it does involves speaking, mouthing, chewing, or its mouth opening or closing: a smile it has is fixed from the first frame to the last. (The one filming speaks, and a mouth that moves would look like it is saying their words.)",
    "THE THING is nearly human and slightly wrong: ONE or TWO exact wrongnesses and no more (a smile far too wide, crowded with thin teeth; eyes sunk in dark sockets; a neck or fingers too long; skin like candle wax). Never horns, wings, tentacles, glowing eyes, flames or a bare skull. No blood, no gore, no wounds.",
    "The one filming is never seen: write what THE CAMERA does (\"the camera backs away\"), never what their body does.",
    'Answer with JSON only: {"title": a short name for this take (2–5 words), "who": what to call the thing in a sentence ("she", "the figure", "the face" — lower case, 1–3 words), "still": THE SCENE THE CAMERA ARRIVES AT, as one picture, in 2–4 sentences — where the camera is, what is in the dark, exactly what is wrong with it, what little light there is, "opens": WHERE THE CAMERA LOOKS FIRST, as one picture of the same place with NOBODY in it, in one or two sentences, "first": what the camera sees and what its holder is doing for those two seconds, one sentence starting "the camera", "finds": how the camera gets from there to the thing, a few words starting with a verb ("swings up to the hallway ahead", "sinks slowly down to the floor and looks under the bed"), "beats": [the stillness — say again here exactly what the thing looks like and where it is, since this is where the camera finds it —, the wrong movement, the approach — one or two sentences each, in the present tense, starting with the thing], "says": [what the one filming asks (a few worried words, ending in a question mark), what they whisper as it comes (two or three words)], "asks": "looking" if the question is asked BEFORE the camera finds the thing ("Who is up there?"), "found" if it is asked on seeing it ("What is wrong?"), "sound": the sound of the thing moving, in a few words}',
  ].join("\n");
}

/** The writer's answer, checked: every part there and of a sane length — else null (the caller falls back
 *  to a ready-made idea rather than film half a direction). */
export function parseTake(raw: unknown): (Take & { title: string }) | null {
  let o: Record<string, unknown> | null = null;
  try {
    const s = typeof raw === "string" ? raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1) : "";
    o = typeof raw === "object" && raw ? (raw as Record<string, unknown>) : s ? JSON.parse(s) : null;
  } catch { o = null; }
  if (!o) return null;
  const beats = Array.isArray(o.beats) ? o.beats.map((b) => one(b, 520)).filter(Boolean) : [];
  const says = Array.isArray(o.says) ? o.says.map((b) => one(b, 90)).filter(Boolean) : [];
  const still = one(o.still, 700), who = one(o.who, 40).toLowerCase();
  const opens = one(o.opens, 420), first = one(o.first, 260), finds = one(o.finds, 160).replace(/^the camera\s+/i, "");
  if (beats.length !== 3 || says.length < 1 || still.length < 40 || !who) return null;
  // (the way in is part of the direction: a take with no off-subject opening is not this take)
  if (opens.length < 20 || first.length < 12 || finds.length < 4) return null;
  return {
    title: one(o.title, 60) || "Found footage",
    who, still, opens, first, finds,
    beats: [beats[0], beats[1], beats[2]],
    says: [says[0], says[1] || ""],
    asks: String(o.asks || "").trim().toLowerCase() === "looking" ? "looking" : "found",
    sound: one(o.sound, 90),
  };
}
