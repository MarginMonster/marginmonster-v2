/* A TAKE — one continuous shot that something HAPPENS in. Found footage.
 *
 * The owner, 2026-11-24, after a ten-second action shot ("FUCKING BANGER") and a horror story: "Would be cool
 * to also get a \"found Footage\" style pipeline, that would do blair witch style creatives"; "I dont think
 * many people would do a singular scare shot and call it, there would need to be some type of exchange at the
 * bare minimum (voice saying \"babe whats wrong\" then boom the scare shot)"; and on the first take he was
 * sent: "it looks like the zap scares the scary person and she runs into the room and turns around, can we
 * enhance the creepy?".
 *
 * So a take is built from five things, and this file is their wording (plain logic — tests/take.test.ts):
 *
 *   WHO     the thing in the frame, in a few words ("she", "the figure") — what the direction calls it.
 *   STILL   the first frame, drawn by the creature recipe the horror stories use (story-picture.ts): CAUGHT
 *           on a bad camera, nearly human and slightly WRONG, mostly HIDDEN.
 *   BEATS   three of them: stillness with the exchange over it; ONE wrong movement; then it comes toward
 *           the lens. Slow is what frightens — the first take was fast, and read as a startled person.
 *   SAYS    what the one filming says. The engine speaks it itself (heard on 2026-11-24: "Babe?", "Babe,
 *           what's wrong?", "No.") — so nothing is laid over the take without listening to it first.
 *   NEVER   what must not happen, said outright: it never flinches, runs, turns away or screams; nothing
 *           flashes, glitches or tears; the camera never swings off it or falls. And it never SPEAKS: on the
 *           re-rolled take the engine gave the cameraman's line to the only face it could see (the owner:
 *           "she lip synced what the camera said towards the very beggining, creepy but im sure its a
 *           glitch") — so the direction says whose voice it is, and that the thing's mouth does not move.
 *
 * The camera it was "shot on" (a phone, a camcorder, or nothing) is camera-dress.ts: the direction here only
 * says who is holding what, so the picture and the overlay tell the same story. */

import type { CameraLook } from "./camera-dress.ts";

/** How long a take is, in seconds — the engine's longest single shot, and the length the exchange and
 *  the approach both fit in. */
export const TAKE_SECONDS = 10;
/** The engine refuses a prompt over 2,500 characters; a take's direction stays under this. */
export const TAKE_PROMPT_MAX = 2400;

/** The recipe for a first frame (the same three parts the horror stories' creatures are drawn with). */
export const TAKE_CAUGHT = "A single frame of real footage, caught by accident: shot at night on a handheld camera, badly underexposed, heavy grain and sensor noise, soft focus, a little motion blur, crushed blacks; one weak light that falls off fast into darkness. It is PHOTOGRAPHED — a real thing in a real place, like a practical-effects creature in a 1970s horror film — never CGI, never a 3D render, never an illustration, never a clean studio portrait.";
export const TAKE_WRONG = "What frightens is how nearly human it is: the proportions are a little off, the skin is waxy and bloodless, the eyes are sunk deep in dark sockets with one small wet glint, and nothing about it moves the way a person would.";
export const TAKE_HIDDEN = "Most of it is lost in the dark or behind something; we see less than we want to. No blood, no gore, no wounds.";

export type Take = {
  /** what the direction calls the thing in the frame */
  who: string;
  /** the first frame, in words (the recipe is added around it) */
  still: string;
  /** stillness (the exchange is said over it) · the one wrong movement · the approach */
  beats: [string, string, string];
  /** what the one filming says: the worried question, then what is said as it comes closer */
  says: [string, string];
  /** the sound of the place and of the thing, in a few words */
  sound: string;
};

export type TakeIdea = Take & { key: string; name: string; line: string };

/** READY-MADE SCARES — a take without writing one. The first was made, looked at frame by frame and sent to
 *  the owner; each of the others must be rolled and LOOKED at before it is offered (tests hold the list). */
export const TAKE_IDEAS: ReadonlyArray<TakeIdea> = [
  {
    key: "smile", name: "She's smiling", line: "Someone you know, in a doorway, smiling wrong.",
    who: "she",
    still: "A woman leans into the frame from a dim doorway, long tangled hair hanging over half her face, one eye visible and fixed on the camera; she is smiling, and the smile is far too wide for a human mouth, full of crowded, jagged, yellowed teeth. A warm weak lamp somewhere behind the camera; a plain old cardigan; one hand raised to her chest.",
    beats: [
      "she stands in the doorway perfectly still, smiling at the camera. She does not blink.",
      "her head tilts to one side, much too far, until her ear is almost resting on her shoulder. The smile does not change. Her eyes never leave the lens.",
      "she walks toward the camera — slow, smooth, unhurried, arms hanging loose at her sides, head still tilted, still smiling, never blinking — while the one filming backs away one small step at a time. She keeps coming, closer and closer, until her smiling face fills the whole frame.",
    ],
    says: ["Babe? ... Babe, what's wrong?", "no... no..."],
    sound: "her slow bare footsteps on a wooden floor",
  },
  {
    key: "stairs", name: "Top of the stairs", line: "Something tall is standing where the light gives out.",
    who: "the figure",
    still: "Looking up a narrow staircase in an ordinary old house, lit only by the camera's own weak light: at the top, where the light gives out, a very tall, very thin figure stands with its head bent against the ceiling, arms hanging past its knees, the face a pale smear turned toward us. It is perfectly still.",
    beats: [
      "the figure stands at the top of the stairs perfectly still, its pale face turned down toward the camera.",
      "its head leans slowly to one side, further than a neck allows, and one long arm lifts and rests its fingers on the banister, one finger at a time.",
      "the figure comes down the stairs toward the camera — one step, a pause, another step — never bending at the knees, its face always turned to the lens, while the one filming backs away from the foot of the stairs. It keeps coming until its pale face is all the frame holds.",
    ],
    says: ["Hello? ... Who's up there?", "oh no... no..."],
    sound: "the stairs creaking one at a time",
  },
  {
    key: "bed", name: "Under the bed", line: "You heard something. You look. It is looking back.",
    who: "the face",
    still: "The camera is held low, at floor level, looking into the black gap under an ordinary bed: in the dark there, lying on its side with its cheek on the floorboards, a pale, slack face is looking straight at the camera — wet black eyes wide open, a small closed smile — and the fingertips of one hand rest on the floor in front of it, the fingers far too long.",
    beats: [
      "the face under the bed lies perfectly still on its side, eyes open, looking at the camera. It does not blink.",
      "the smile opens, slowly, wider and wider, and the long fingers begin to walk forward across the floorboards toward the lens, one finger at a time.",
      "the face slides out from under the bed toward the camera — slow, smooth, its cheek still on the floor, its eyes never leaving the lens — while the one filming shuffles backwards across the floor. It keeps coming until its face fills the whole frame.",
    ],
    says: ["Is someone... is someone under there?", "no, no, no..."],
    sound: "fingernails on floorboards, something dragging",
  },
];

export const takeIdea = (key: unknown): TakeIdea | undefined => TAKE_IDEAS.find((i) => i.key === String(key ?? "").trim().toLowerCase());

const one = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The picture model's prompt for a take's first frame. */
export function takeStillPrompt(t: Pick<Take, "still">, aspect: "9:16" | "16:9" = "9:16"): string {
  const shape = aspect === "16:9" ? "Wide 16:9 picture." : "Vertical 9:16 picture.";
  return `${shape} ${TAKE_CAUGHT} ${one(t.still, 700)} ${TAKE_WRONG} ${TAKE_HIDDEN} Nothing written anywhere in the picture. No watermark, no signature.`;
}

/** What the one filming is holding, as the direction says it — the same story the overlay tells. */
const HELD: Record<CameraLook, string> = {
  phone: "Shot on a phone at night, held in one hand, the phone's own small light on",
  camcorder: "Shot on a small home camcorder at night, held in one hand, its little lamp on",
  bare: "Handheld, at night, one small light on",
};

/** The direction for the take itself: the exchange, the wrong movement, the approach — and what never happens. */
export function takePrompt(t: Take, camera: CameraLook = "phone"): string {
  const who = one(t.who, 40) || "it";
  const obj = /^(she|he)$/i.test(who) ? (who.toLowerCase() === "she" ? "her" : "him") : who;
  const poss = /^she$/i.test(who) ? "her" : /^he$/i.test(who) ? "his" : "its";
  const [b1, b2, b3] = t.beats.map((b) => one(b, 520));
  const [ask, plead] = t.says.map((s) => one(s, 90).replace(/"/g, "'"));
  const text = [
    `${HELD[camera]} ${obj}. One continuous take, no cuts, nothing written on screen. The camera stays pointed at ${obj} the whole time: it never swings away, never drops, never falls.`,
    `FIRST THREE SECONDS: ${b1} The one filming is never seen — the voice comes from BEHIND the camera — and whispers, close to the microphone, worried: "${ask}" ${cap(who)} does not answer, and does not move ${poss} lips: the voice is not ${poss} voice.`,
    `THEN, slowly: ${b2}`,
    `LAST FOUR SECONDS: ${b3}${plead ? ` The one filming whispers "${plead}".` : ""}`,
    `${cap(who)} never runs, never flinches, never turns around and never looks away; never screams, never speaks, never mouths a word. Nothing flashes; the light does not change; the picture never glitches or tears.`,
    `Sound: a quiet house at night, the whisper, breathing getting faster, ${one(t.sound, 90) || "slow footsteps"}. No music.`,
  ].join(" ");
  return text.length <= TAKE_PROMPT_MAX ? text : text.slice(0, TAKE_PROMPT_MAX);
}

/** WRITE ME ONE — the brief for the writer when a member describes a take of their own. The answer is JSON:
 *  { title, who, still, beats: [3], says: [2], sound }. */
export function takeWriterBrief(idea: string): string {
  return [
    "You are directing ONE continuous ten-second shot of found footage — something caught on a camera somebody was holding. Not a story: a moment.",
    `THE IDEA: ${one(idea, 400) || "something that should not be in the house"}`,
    "It is built the way a scare is built, in three beats: (1) STILLNESS — the thing is already in the frame, perfectly still, and the one filming speaks to it, worried; it does not answer. (2) ONE WRONG MOVEMENT — small, slow, impossible for a person: a head tilting too far, fingers walking, a smile widening. (3) IT COMES — slowly, smoothly, toward the camera, never taking its eyes off the lens, while the one filming backs away; it ends with it filling the frame.",
    "What frightens is slowness and stillness. It NEVER runs, flinches, turns away or screams, and nothing flashes or glitches — a startled thing is not frightening.",
    "THE THING is nearly human and slightly wrong: ONE or TWO exact wrongnesses and no more (a smile far too wide, crowded with thin teeth; eyes sunk in dark sockets; a neck or fingers too long; skin like candle wax). Never horns, wings, tentacles, glowing eyes, flames or a bare skull. No blood, no gore, no wounds.",
    'Answer with JSON only: {"title": a short name for this take (2–5 words), "who": what to call the thing in a sentence ("she", "the figure", "the face" — lower case, 1–3 words), "still": the FIRST FRAME in 2–4 sentences — where the camera is, what is in the dark, exactly what is wrong with it, what little light there is, "beats": [the stillness, the wrong movement, the approach — one or two sentences each, in the present tense, starting with the thing], "says": [what the one filming asks at the start (a few worried words), what they whisper as it comes (two or three words)], "sound": the sound of the thing moving, in a few words}',
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
  if (beats.length !== 3 || says.length < 1 || still.length < 40 || !who) return null;
  return {
    title: one(o.title, 60) || "Found footage",
    who, still,
    beats: [beats[0], beats[1], beats[2]],
    says: [says[0], says[1] || ""],
    sound: one(o.sound, 90),
  };
}
