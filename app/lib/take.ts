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
 * says who is holding what, so the picture and the overlay tell the same story.
 *
 * A BODY CAM (the owner, 2026-11-24: "What about body cam footage police shot channel") is a take like these,
 * worn instead of held: its scare is written for it (a welfare check at a dark house — fiction: a creature in a
 * house, never a real incident, a weapon or a real agency), and the dispatcher's call over the radio is one
 * more separate voice (RADIO), band-limited like a radio — never a word given to the engine.
 *
 * EVERY CARD IS A STARTER (the owner, 2026-11-24, on the builder: "These found footage options leave zero room for
 * creativity, it's just what happens"). Tapping a card puts its PREMISE — what happens in it, in words a member can
 * change (who, where, what is wrong, how it ends) — into the builder's one box:
 *
 *   WORDS LEFT AS THEY WERE   the ready-made take, exactly as it is. Each was rolled and looked at frame by frame;
 *                             nothing on that path changes.
 *   WORDS CHANGED             the member's OWN take, written FROM the card: the writer is shown the card's own
 *                             direction and keeps what their words keep, changes what they change (takeWriterBrief;
 *                             the police drama has a writer of its own, dramaWriterBrief, inside the same bounds).
 *   NO CARD                   a take of their own words alone.
 *
 * A take the writer writes ENDS the way the member's words say — it is gone when the light comes back, it is right
 * behind them, the one filming runs, it was someone they know — and only words that give no ending end with it
 * coming at the lens. The craft that works stays: two seconds off the subject, the camera FINDS it, stillness, one
 * small impossible movement, slowness, a mouth that never moves. The direction lets the camera leave it, or the
 * light change, only for the ending that needs it (TAKE_ENDS). Whether the words were changed is decided by
 * cardUnchanged — on the page and on the server alike.
 *
 * The builder that puts a scare, a camera and its settings together (routes/web.found-footage.tsx) keeps its
 * rules at the foot of this file; the house's own cameras are house-cam.ts.
 *
 * A FILM (the owner, 2026-11-25: "It currently appears to pipeline singular events But needs to be more like \"Found
 * Footage\" … with describe events flow like the others - make it look banging and not limited") is several of these
 * takes from one camera, a card on black before each — footage-film.ts. Each of its moments is a take made of the
 * parts above; what a film adds to this file is small: a take that is not a scare ("plain"), and a mood for each
 * line of the one filming. ONE take is exactly what it was. */

import { cameraLookOf, type CameraLook } from "./camera-dress.ts";
import { HOUSE_SCARES, houseRoom, houseScare } from "./house-cam.ts";

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

/** HOW A WRITTEN TAKE ENDS (every ready-made scare "comes"):
 *    comes  it comes slowly at the camera until it fills the frame — the ending when the member's words give none
 *    stays  the camera stays on it and the light does not change (a reveal; a step into the light)
 *    dark   the light goes out or changes, and comes back on something else (it is gone; it is closer)
 *    away   the camera turns or swings away from it (to look behind — and it is right there; the one filming runs)
 *  Only "dark" lets the light change, and only "away" lets the camera leave it (takePrompt). */
export const TAKE_ENDS = ["comes", "stays", "dark", "away"] as const;
export type TakeEnding = (typeof TAKE_ENDS)[number];

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
  /** BODY CAM: what the dispatcher says over the radio as the take opens — a separate voice, band-limited like
   *  a radio, NEVER given to the picture engine */
  radio?: string;
  /** "drama": NOT A SCARE (the owner, of the body cam: "normal police interactions and traffic stops … that one
   *  doesn't nessesarily need to be horror"). Its scene, way in and direction are the drama's own (dramaPrompt),
   *  and the person ON camera speaks — see `speaks`. Unset: a scare.
   *  "plain": NOT A SCARE EITHER, and nobody's drama — something a camera simply caught (a found-footage FILM's
   *  moments, footage-film.ts: a dog opening the fridge; in a horror, a door that was shut, open). Its picture and its
   *  direction carry no creature (plainPrompt), and nobody on camera speaks. */
  genre?: "drama" | "plain";
  /** DRAMA ONLY: what the person on camera says, at about which second — the one place words ARE given to the
   *  engine, as quoted dialogue, because here the mouth it moves is the right one. (The one wearing the camera
   *  is still never given a word: theirs are `script`, laid on afterwards.) */
  speaks?: Array<{ at: number; text: string }>;
  /** the lines of the one wearing the camera, each at its own time — when a take has more to say than a
   *  question and a plea (`says` / `asks` are then not used). A separate voice, never given to the engine.
   *  `mood`: how the line is said, when its writer picked one (a film's moments — see TAKE_MOODS). */
  script?: Array<{ at: number; text: string; mood?: TakeMood }>;
  /** how long the take is, in seconds (unset: TAKE_SECONDS) */
  seconds?: number;
  /** A WRITTEN take's ending (unset: "comes", as every ready-made scare does) — see TAKE_ENDS */
  ends?: TakeEnding;
  /** DRAMA: where the camera stops on the person, as the direction says it ("at the window") */
  stops?: string;
};

/** `cams`: the cameras a scare is written for (unset: the three held in a hand — a phone, a camcorder, none).
 *  `cast`: the people a drama's `{driver}` can be, one picked for each take — so nobody is ever its default.
 *  `premise`: THE CARD'S WORDS — what happens in it, in a sentence or three a member can change (who, where, what is
 *  wrong, how it ends). The builder puts them in its box when the card is tapped; left as they are, the take is this
 *  one exactly as it is. */
export type TakeIdea = Take & { key: string; name: string; line: string; premise: string; cams?: readonly CameraLook[]; cast?: readonly string[] };

/** READY-MADE SCARES — a take without writing one. Each was rolled and looked at frame by frame (the mouth
 *  too) before it was offered; the first and the third are the two the owner called cinema. Tests hold the
 *  list. */
export const TAKE_IDEAS: ReadonlyArray<TakeIdea> = [
  {
    key: "smile", name: "She's smiling", line: "Someone you know, at the end of the hall, smiling wrong.",
    premise: "My girlfriend is standing at the end of the dark hallway, smiling at me — the smile is far too wide. Her head tilts much too far. Then she walks slowly toward me until her face fills the screen.",
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
    // (the plea is what they understand, out loud — never "no... no..."; the owner, 2026-11-25: "the wording choice is
    //  fucking sad", of a take whose writer had kept this card's "no no")
    says: ["Babe? ... Babe, what's wrong?", "babe... you're scaring me... stop—"],
    asks: "found",
    sound: "slow footsteps on a wooden floor, her bare footsteps",
  },
  {
    key: "stairs", name: "Top of the stairs", line: "Something tall is standing where the light gives out.",
    premise: "Something very tall and thin is standing at the top of the stairs, where the light gives out. Its head leans too far to one side. Then it comes down the stairs toward me, one slow step at a time.",
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
    says: ["Hello? ... Who's up there?", "don't come down... please don't come down—"],
    asks: "looking",
    sound: "the stairs creaking one at a time",
  },
  {
    key: "bed", name: "Under the bed", line: "You heard something. You look. It is looking back.",
    premise: "I hear something under the bed. I crouch down and look: a pale face is lying there in the dark, staring back at me. Its long fingers creep toward me. Then it slides out from under the bed, slowly, toward me.",
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
    says: ["Is someone... is someone under there?", "it's coming out... it's coming out—"],
    asks: "looking",
    sound: "fingernails on floorboards, something dragging",
  },
  {
    // BODY CAM (worn, wide) — the welfare check of the body-cam test take of 2026-11-24 (scratchpad t45/cam/b-*):
    // the porch is its way in, the flashlight finds her at the end of the hall, and she comes.
    key: "welfare", name: "Welfare check", line: "No lights in three days. The front door is open.",
    premise: "A welfare check at an old house — no lights in three days, the front door open. At the end of the hall stands a very tall woman in a pale nightgown, her hair over her face. Her head jerks straight. Then she walks slowly toward me.",
    cams: ["bodycam"],
    who: "she",
    still: "Looking down a long narrow hallway of an old wooden house at night from just inside its front door, a flashlight's hard white beam thrown down the hall — faded wallpaper, a runner rug, an old picture frame hanging crooked, a door half open on the left. At the far end, where the beam weakens, stands a very tall, very thin woman in a long pale nightgown, facing the camera, perfectly still, her long dark hair hanging over her face, her arms hanging far too low at her sides, her head tilted much too far to one side.",
    opens: "the camera looks up three sagging porch steps at an old wooden house at night: a peeling porch rail, a screen door hanging open and the front door behind it standing ajar, black inside; the flashlight's hard white beam from beside the camera lies on the steps.",
    first: "the camera looks at the porch steps and the door standing ajar while the one wearing it climbs the steps slowly; the flashlight beam moves over the boards.",
    finds: "goes in through the door and the flashlight beam travels down the black hallway",
    beats: [
      "she stands at the far end of the hallway facing the camera, perfectly still — the very tall, very thin woman in the long pale nightgown, her long dark hair over her face, her arms hanging far too low, her head tilted much too far to one side.",
      "her head straightens, one small jerk at a time.",
      "she walks toward the camera down the hallway — slow, smooth, silent, her arms hanging far too low — while the camera backs away toward the door, the flashlight beam trembling on her. She keeps coming until she fills the whole frame.",
    ],
    says: ["Hello? ... Ma'am? Are you okay?", "ma'am... stop... please..."],
    asks: "found",
    sound: "creaking porch boards, the hinge of the door, footsteps on old wood",
    radio: "Four-twelve, welfare check at fourteen Alder Lane. No lights in three days.",
  },
  {
    // BODY CAM — A POLICE DRAMA, NOT A SCARE (the owner, 2026-11-24: "Body cam can be normal police interactions
    // and traffic stops (people resisting arrest)"). FICTION, within these bounds: a generic "Unit twelve" of a
    // generic county — no real department, badge, insignia, place or person; resisting is refusing, pulling away
    // and a short chase, and it ends in handcuffs — no weapon drawn or fired, no blow struck, nobody hurt; and the
    // driver is a different somebody every take (`cast`), never one kind of person by default.
    key: "traffic", name: "Traffic stop", line: "The driver won't get out of the car. Then runs.",
    premise: "A traffic stop on a dark country road. The driver won't get out of the car — then jumps out and runs. I catch them at the back of the car, and it ends in handcuffs.",
    cams: ["bodycam"], genre: "drama", seconds: 15,
    who: "the driver", stops: "at the window",
    still: "Through the open driver's window of a car stopped on the shoulder of a dark country road, lit by the patrol car's headlights behind it and washed red and blue by its flashing lights: {driver}, looking up at the camera, annoyed, one hand on the wheel. The officer's hand holding a flashlight is just visible at the lower edge of the picture.",
    opens: "the camera looks down at the asphalt and the white edge line of a dark country road in the patrol car's headlights, red and blue light washing over it, the back of a stopped car ahead at the top of the picture.",
    first: "the camera looks down at the road as the officer wearing it walks from the patrol car toward the stopped car; the picture bobs with each step.",
    finds: "lifts to the driver's open window",
    beats: [
      "the driver looks up at the camera from behind the wheel, annoyed, and does not get out.",
      "the driver throws the door open, gets out, pulls free of the officer's reaching hand and runs along the side of the car; the camera follows at a run for a few steps, bouncing hard.",
      "the driver is caught at the back of the car and turned to face it, hands behind the back, and the officer's hands click handcuffs onto the driver's wrists. The driver stops struggling.",
    ],
    // THE TIMES (the live take of 2026-11-24 — the walk-up 0–4 s, at the window 5–9 s, out of the car 10–11 s,
    // the handcuffs to the end): the radio during the walk-up, the officer's question as the camera reaches the
    // window, the driver's answer after it (never before the window: told it "at about 4 seconds", the engine
    // ALSO said it at 0.4 s, from a car still far down the road), the chase, the handcuffs.
    speaks: [
      { at: 6, text: "I'm not getting out of the car. I didn't do anything." },
      { at: 13.5, text: "Okay! Okay." },
    ],
    script: [
      { at: 4.6, text: "Step out of the car for me." },
      { at: 9.4, text: "Hey! Stop! Stop!" },
      { at: 11.4, text: "Hands behind your back." },
    ],
    says: ["Step out of the car for me.", "Hands behind your back."],
    asks: "found",
    sound: "an idling engine, footsteps on gravel, a car door, heavy breathing",
    radio: "Unit twelve, copy your stop. Plate comes back expired.",
    cast: [
      "a man in his fifties with a grey beard, a faded work jacket and a trucker cap, at the wheel of an old pickup truck",
      "a young woman in her twenties in an oversized hoodie, her hair tied up, at the wheel of a small hatchback",
      "a middle-aged man in a rumpled suit with his tie loosened, at the wheel of a silver sedan",
      "a woman in her forties in a denim jacket, with short curly hair, at the wheel of a dusty minivan",
      "a lanky young man in a varsity jacket and a beanie, at the wheel of a dented coupe",
      "a man in his sixties in a cardigan and glasses, at the wheel of a long old station wagon",
    ],
  },
];

/** A drama's somebody for this take: `{driver}` in its scene becomes one of its `cast`, picked by `seed` (any
 *  whole number) — a different one from take to take. A take with no cast is as it was. */
export function castTake<T extends Take & { cast?: readonly string[] }>(t: T, seed: number): T {
  if (!t.cast?.length || !t.still.includes("{driver}")) return t;
  const who = t.cast[Math.abs(Math.floor(Number(seed) || 0)) % t.cast.length];
  return { ...t, still: t.still.replace(/\{driver\}/g, who) };
}

export const takeIdea = (key: unknown): TakeIdea | undefined => TAKE_IDEAS.find((i) => i.key === String(key ?? "").trim().toLowerCase());

const one = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const stop = (s: string) => (s && !/[.!?]$/.test(s) ? `${s}.` : s);
const shapeOf = (aspect: "9:16" | "16:9") => (aspect === "16:9" ? "Wide 16:9 picture." : "Vertical 9:16 picture.");

/** A DRAMA's picture (not a creature's): a body camera's own frame — and the bounds every one of them keeps. */
export const DRAMA_CAUGHT = "A single frame from a body camera's own recording at night: worn on an officer's chest, seen through its wide-angle lens so the edges bow slightly outward; a small, hard camera sensor — a little over-sharpened, noisy in the dark, slightly washed colours. Real footage of real people — never CGI, never a render, never an illustration.";
export const DRAMA_BOUNDS = "A fictional scene: no real police department, no badge, patch, insignia, emblem or lettering on anything; no weapon drawn; nobody hurt, no blood.";

/* ---- NOT A SCARE: SOMETHING A CAMERA SIMPLY CAUGHT ----
 * The owner, 2026-11-25, of found footage: "make it look banging and not limited". A found-footage FILM
 * (footage-film.ts) is not only horror — a dog caught opening the fridge, a meteor on a dashboard phone — and inside
 * a horror the early moments show no creature at all, only what it did (a door that was shut, open). A take like
 * that is "plain": no creature recipe in its picture, no list of what a creature never does in its direction. What
 * every take keeps, it keeps: one continuous take, no cuts, two seconds off its subject, NO WORD FOR THE ENGINE (the
 * header says why), the one filming never in the picture, nothing written, everyone clothed. NOT YET ROLLED: written
 * 2026-11-25 beside the scare's own wording, which was. */
export const PLAIN_CAUGHT = "A single frame of real footage, caught as it happened on an ordinary camera somebody had with them: a little noisy, a little soft, not composed, lit only by whatever light was there. It is PHOTOGRAPHED — real people, real animals and real things in a real place — never CGI, never a 3D render, never an illustration, never a clean studio picture.";
export const PLAIN_BOUNDS = "Everyone in it is fully clothed. No blood, no gore, nobody hurt.";

/** The picture model's prompt for the scene a take arrives at. */
export function takeStillPrompt(t: Pick<Take, "still" | "genre">, aspect: "9:16" | "16:9" = "9:16"): string {
  if (t.genre === "drama") return `${shapeOf(aspect)} ${DRAMA_CAUGHT} ${one(t.still, 700)} ${DRAMA_BOUNDS} Nothing written anywhere in the picture. No watermark, no signature.`;
  if (t.genre === "plain") return `${shapeOf(aspect)} ${PLAIN_CAUGHT} ${one(t.still, 700)} ${PLAIN_BOUNDS} Nothing written anywhere in the picture. No watermark, no signature.`;
  return `${shapeOf(aspect)} ${TAKE_CAUGHT} ${one(t.still, 700)} ${TAKE_WRONG} ${TAKE_HIDDEN} Nothing written anywhere in the picture. No watermark, no signature.`;
}

/** The picture model's prompt for the take's FIRST frame — off its subject — drawn FROM the scene's own
 *  still (which is handed over as the reference image): the same place, a moment earlier, nobody in it. */
export function takeOpensPrompt(t: Pick<Take, "opens" | "genre">, aspect: "9:16" | "16:9" = "9:16"): string {
  if (t.genre === "drama") return `${shapeOf(aspect)} The SAME place and the SAME body camera as the reference image, a few seconds earlier: ${stop(one(t.opens, 420))} NOBODY is in the picture. The same small, hard, noisy camera look as the reference image — real footage, never a render. ${DRAMA_BOUNDS} Nothing written anywhere.`;
  // (a plain take's light is whatever its scene has — a kitchen light, daylight, the dark — so the way in is told to
  //  keep the reference's, not to be "the camera's own small weak light")
  if (t.genre === "plain") return `${shapeOf(aspect)} The SAME place and the SAME camera as the reference image, a moment earlier: ${stop(one(t.opens, 420))} What the camera is about to find is NOT in the picture yet. The same light and the same look as the reference image — real footage, never a render. ${PLAIN_BOUNDS} Nothing written anywhere.`;
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
 *  the end — and what never happens. NO SPOKEN WORD is in it (see the header): `ref` is how this host
 *  names the reference picture. A written take's ending (`ends`) loosens exactly one rule, and only the one it
 *  needs: "away" lets the camera leave it in the last four seconds, "dark" lets the light change there. A ready-made
 *  scare (and any take that comes at the lens, or stays on it) is directed word for word as it always was. */
export function takePrompt(t: Take, camera: CameraLook = "phone", ref: string = TAKE_REF.replicate): string {
  if (t.genre === "drama") return dramaPrompt(t, camera, ref);
  if (t.genre === "plain") return plainPrompt(t, camera, ref);
  const who = one(t.who, 40) || "it";
  const obj = /^(she|he)$/i.test(who) ? (who.toLowerCase() === "she" ? "her" : "him") : who;
  const poss = /^she$/i.test(who) ? "her" : /^he$/i.test(who) ? "his" : "its";
  const [b1, b2, b3] = t.beats.map((b) => one(b, 520));
  const tail = endWord(t);
  const held = t.ends === "away"
    ? `Once the camera has found ${obj} it stays on ${obj} until the last ${tail} seconds: it never drops, never falls.`
    : `Once the camera has found ${obj} it never leaves ${obj}: it never swings away, never drops, never falls.`;
  const light = t.ends === "dark"
    ? `Nothing flashes; the light changes only as the last ${tail} seconds say; the picture never glitches or tears.`
    : "Nothing flashes; the light does not change; the picture never glitches or tears.";
  const text = [
    `${HELD[camera]}. One continuous take, no cuts, nothing written on screen. NOBODY SPEAKS in this shot: no voice, no words, no whisper — only breathing and the quiet of the place.`,
    `FIRST TWO SECONDS: ${stop(one(t.first, 260))}`,
    // (HER MOUTH STAYS AS THE PICTURE HAS IT — 2026-11-25: told it "does not open or close", the engine shut the far-too-wide
    //  grin of the scene still into closed lips; the engine is given no words now, so nothing asks it to lip-sync)
    `THEN the camera ${one(t.finds, 160)} — in the same shot, one smooth unbroken move, never a cut — and stops: there, exactly as in ${ref}, ${stop(b1)} ${cap(poss)} mouth stays exactly as it is in ${ref}, and never moves.`,
    `THEN, slowly: ${stop(b2)}`,
    `LAST ${tail.toUpperCase()} SECONDS: ${stop(b3)}`,
    `${cap(who)} never runs, never flinches, never turns around and never looks away; never screams, never speaks, never moves ${poss} mouth, never mouths a word. ${held} The one filming is never in the picture: no legs, no feet, no body. ${light}`,
    `Sound: a quiet house at night, breathing getting faster, ${one(t.sound, 90) || "slow footsteps"}. No voice at all. No music.`,
  ].join(" ");
  return text.length <= TAKE_PROMPT_MAX ? text : text.slice(0, TAKE_PROMPT_MAX);
}

/** How long a take's END is, as its direction says it: the last FOUR seconds — of a take as short as a film's
 *  briefest moments (under eight seconds: two of them are its way in), the last THREE. */
const endWord = (t: Pick<Take, "seconds">): "four" | "three" => ((t.seconds ?? TAKE_SECONDS) < 8 ? "three" : "four");

/** What the one filming is holding in a PLAIN take: no night and no little light are claimed — its pictures say what
 *  the light is. */
const HELD_PLAIN: Record<CameraLook, string> = {
  phone: "Shot on a phone held in one hand",
  camcorder: "Shot on a small home camcorder held in one hand",
  bare: "Handheld",
  house: "Recorded by a fixed security camera mounted high in the corner of the room; the camera never moves, pans, tilts or zooms",
  bodycam: "Recorded by a body camera worn on the chest of the one walking, through its wide-angle lens; the picture bobs gently with every step",
};

/** A PLAIN take's direction (see PLAIN_CAUGHT): the scare's own shape — two seconds off its subject, the camera
 *  finds it by a MOVE, what happens, the end — with nothing of the creature's in it: no stillness to hold, no mouth
 *  to keep shut, nothing it "never" does. NOBODY SPEAKS here either: the one filming is a separate voice, laid on
 *  afterwards, and nobody on camera is given a word (the engine moves the only mouth it can see). A body camera's
 *  keeps the drama's bounds: fiction, and nobody hurt. */
export function plainPrompt(t: Take, camera: CameraLook = "phone", ref: string = TAKE_REF.replicate): string {
  const [b1, b2, b3] = t.beats.map((b) => one(b, 520));
  const text = [
    `${HELD_PLAIN[camera]}. One continuous take, no cuts, nothing written on screen. NOBODY SPEAKS in this shot: no voice, no words, no whisper — only the sound of the place.${camera === "bodycam" ? " A FICTIONAL scene, and nobody is hurt: no weapon is drawn or fired, nobody is struck, no blood." : ""}`,
    `FIRST TWO SECONDS: ${stop(one(t.first, 260))}`,
    `THEN the camera ${one(t.finds, 160)} — in the same shot, one smooth unbroken move, never a cut — and stops: there, exactly as in ${ref}, ${stop(b1)}`,
    `THEN: ${stop(b2)}`,
    `LAST ${endWord(t).toUpperCase()} SECONDS: ${stop(b3)}`,
    "Everything in it moves the way it really would, at its real speed: nothing is staged, nothing is slowed down. Nobody in the picture speaks or mouths a word. The one filming is never in the picture: no legs, no feet, no body. Nothing flashes; the picture never glitches or tears.",
    `Sound: ${one(t.sound, 90) || "the quiet of the place"}. No voice at all. No music.`,
  ].join(" ");
  return text.length <= TAKE_PROMPT_MAX ? text : text.slice(0, TAKE_PROMPT_MAX);
}

/** A DRAMA'S MOMENTS, in seconds of the take: the camera is at the window by DRAMA_WINDOW_AT; the driver gets out
 *  from DRAMA_RUN_AT. (The live take of 2026-11-24: at the window 5–9 s, out of the car 10–11 s.) */
export const DRAMA_WINDOW_AT = 5;
export const DRAMA_RUN_AT = 9;
const ORDINAL = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth"];
const CARDINAL = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const nth = (s: number) => ORDINAL[Math.max(1, Math.min(15, Math.round(s)))];

/** The lines a drama gives the engine, as they will be quoted: each ONCE (a line written twice is said once), and
 *  never before the camera is at the window — a line timed earlier is moved to the window (a voice with no mouth in
 *  view, from a car still far down the road, is what the engine made of a line timed during the walk-up). */
export function dramaLines(t: Pick<Take, "speaks">): Array<{ at: number; text: string }> {
  const seen = new Set<string>();
  const out: Array<{ at: number; text: string }> = [];
  for (const s of t.speaks || []) {
    const text = one(s.text, 120).replace(/["“”]/g, "'");
    const key = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push({ at: Math.max(DRAMA_WINDOW_AT + 1, Math.min(14, Math.round(Number(s.at) || 0))), text });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** A DRAMA's direction: one continuous body-cam take, its beats at their times — and the one place a found-footage
 *  take gives the engine words: the person ON camera's own lines, quoted ONCE each, at their second, and only once
 *  the camera is at the window with their face in view (the engine moves the mouth it can see, which here is the
 *  right one). The walk-up is silent; the one wearing the camera says nothing in the shot (their lines and the
 *  radio are laid on afterwards); nobody is hurt. */
export function dramaPrompt(t: Take, camera: CameraLook = "bodycam", ref: string = TAKE_REF.replicate): string {
  const who = one(t.who, 40) || "the driver";
  const [b1, b2, b3] = t.beats.map((b) => one(b, 420));
  const said = dramaLines(t);
  const quote = (s: { at: number; text: string }) => `AT THE ${nth(s.at).toUpperCase()} SECOND — not before — ${who} says, once: "${s.text}"`;
  const atWindow = said.filter((s) => s.at < DRAMA_RUN_AT), later = said.filter((s) => s.at >= DRAMA_RUN_AT);
  const text = [
    `${HELD[camera]}. One continuous take, no cuts, nothing written on screen. A FICTIONAL police drama, and nobody is hurt: no weapon is drawn or fired, nobody is struck, no blood.`,
    `FIRST ${CARDINAL[DRAMA_WINDOW_AT - 1].toUpperCase()} SECONDS — THE WALK-UP, IN SILENCE: ${stop(one(t.first, 260))} Nobody speaks while the camera walks up: no voice and no word at all, only footsteps and an idling engine.`,
    `BY THE ${nth(DRAMA_WINDOW_AT).toUpperCase()} SECOND the camera ${one(t.finds, 160)} and stops: there, exactly as in ${ref}, ${stop(b1)}`,
    // (where the camera stops is the take's own — the traffic stop's window; a written drama's door or kerb)
    ...(atWindow.length ? [`Only now, with the camera ${one(t.stops, 40) || "stopped"} and ${who}'s face in full view, ${who} speaks.`] : []),
    ...atWindow.map(quote),
    `FROM THE ${nth(DRAMA_RUN_AT).toUpperCase()} SECOND: ${stop(b2)}`,
    `LAST FOUR SECONDS: ${stop(b3)}`,
    ...later.map(quote),
    `Each line is said once, at its moment, and never before it. Only ${who} speaks in this shot; the officer wearing the camera says nothing and is never seen except the hands. Nothing flashes but the patrol car's red and blue lights; the picture never glitches.`,
    `Sound: ${one(t.sound, 90) || "footsteps on gravel"}; a police radio crackles faintly. No music.`,
  ].join(" ");
  return text.length <= TAKE_PROMPT_MAX ? text : text.slice(0, TAKE_PROMPT_MAX);
}

/* ---- THE VOICE BEHIND THE CAMERA ----
 * A separate voice, said by the app's own speaking model and laid over the finished take. */

/** The voice of the one filming, and how it is said (the voice and the manner of the takes the owner
 *  called cinema). */
export const TAKE_VOICE = { id: "English_magnetic_voiced_man", emotion: "fearful", speed: 0.95 } as const;
/** THE ONE FILMING, PERFORMED (2026-11-25, the owner, of a take from his own words: "voice sounds like shit he is in
 *  monotone - no fear"). The speech model's "fearful" read every line flat. ElevenLabs v3 — the engine the character
 *  voices are ACTED on (character-voices.ts) — takes a man's voice told how to say each line, at low stability for a
 *  bigger performance: the first a scared, shaky whisper as they see it, the last terrified and out of breath.
 *  TAKE_VOICE stays behind it, for when it will not speak. */
export const TAKE_ACTED = { voice: "Mark", stability: 0.2, style: 0.85, speed: 1.0 } as const;
/** HOW A LINE CAN BE SAID — a closed list its writer picks from. One scare is whispered in terror from its first word
 *  (takeActing, below); a found-footage FILM (footage-film.ts) is several moments, and they are not all terror: its
 *  first is somebody annoyed at a noise, and a film that is not a horror at all — a dog caught opening the fridge —
 *  is never whispered in terror. (2026-11-25, with the films; the first two are the single take's own two manners.) */
export const TAKE_MOODS = ["scared", "terrified", "whispering", "calm", "excited", "laughing", "annoyed", "shouting"] as const;
export type TakeMood = (typeof TAKE_MOODS)[number];
export const takeMood = (v: unknown): TakeMood | undefined => {
  const k = String(v ?? "").trim().toLowerCase();
  return (TAKE_MOODS as readonly string[]).includes(k) ? (k as TakeMood) : undefined;
};
/** The acting tags each mood is performed with (the acted voice reads them and does not say them)… */
const MOOD_ACTING: Record<TakeMood, string> = {
  scared: "[scared] [shaky breath] [whispering]",
  terrified: "[terrified] [breathing heavily] [whispering]",
  whispering: "[whispering] [quietly]",
  calm: "[calm] [casual]",
  excited: "[excited]",
  laughing: "[laughing] [amused]",
  annoyed: "[annoyed] [sighs]",
  shouting: "[shouting] [alarmed]",
};
/** …and the manner the plain voice behind it is asked for (the speech model's own short list). */
const MOOD_EMOTION: Record<TakeMood, string> = { scared: "fearful", terrified: "fearful", whispering: "neutral", calm: "neutral", excited: "happy", laughing: "happy", annoyed: "angry", shouting: "surprised" };
/** How the `index`-th of `total` lines is said — as its `mood` says, when its writer picked one (a film's moment);
 *  a single take's lines have none: scared, then terrified on the last. */
export function takeActing(index: number, total: number, mood?: TakeMood): string {
  if (mood && MOOD_ACTING[mood]) return MOOD_ACTING[mood];
  return total > 1 && index === total - 1 ? "[terrified] [breathing heavily] [whispering]" : "[scared] [shaky breath] [whispering]";
}
/** The plain voice for a line with a mood (no mood: the voice as it is). */
export const moodVoice = <V extends { emotion: string }>(voice: V, mood?: TakeMood): V => (mood && MOOD_EMOTION[mood] ? { ...voice, emotion: MOOD_EMOTION[mood] } : voice);
/** How long after the camera finds the thing the question comes, when it is asked on seeing it. */
const ASK_AFTER_FOUND = 0.8;
/** The plea comes as it starts toward the lens (the last four seconds begin at TAKE_SECONDS − 4). */
const PLEA_AT = TAKE_SECONDS - 3.4;
/** The least silence between the end of one line and the start of the next. */
export const TAKE_LINE_GAP = 0.6;
/** THE DISPATCHER (a body cam's radio): a level, unhurried voice — a radio call is read flat. */
export const TAKE_RADIO_VOICE = { id: "English_ConfidentWoman", emotion: "neutral", speed: 1.05 } as const;
/** THE OFFICER wearing the camera in a drama (not frightened: firm). */
export const TAKE_OFFICER_VOICE = { id: "English_Trustworth_Man", emotion: "angry", speed: 1.0 } as const;
/** The radio call comes the moment the take opens. */
const RADIO_AT = 0.2;

/** `radio`: the line is the dispatcher's, over the radio (said in TAKE_RADIO_VOICE, band-limited by takeSound).
 *  `mood`: how the one filming says it, when its writer picked one (TAKE_MOODS). */
export type TakeLine = { at: number; text: string; radio?: true; mood?: TakeMood };

/** What is said, and when: the radio call (a body cam's), the question (while looking, or on finding it) and
 *  the plea as it comes. */
export function takeLines(t: Pick<Take, "says" | "asks" | "radio" | "script">): TakeLine[] {
  const say = (s: unknown) => one(s, 90).replace(/["“”]/g, "'");
  const [ask, plea] = [say(t.says[0]), say(t.says[1])];
  const radio = one(t.radio, 140).replace(/["“”]/g, "'");
  const out: TakeLine[] = [];
  if (radio) out.push({ at: RADIO_AT, text: radio, radio: true });
  // (a take with more to say than a question and a plea says it at its own times)
  if (t.script?.length) {
    for (const s of t.script) { const text = say(s.text), mood = takeMood(s.mood); if (text) out.push({ at: Math.max(0, Number(s.at) || 0), text, ...(mood ? { mood } : {}) }); }
    return out.sort((a, b) => a.at - b.at);
  }
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

/** A CUT IN A ONE-SHOT TAKE (2026-11-25, the owner, of a take from his own words: "1 second to 2 second the cut is far
 *  too obvious"). Told to swing from the way in to the thing, the engine now and then CUTS to it instead. A cut is ONE
 *  frame unlike the one before it (ffmpeg's scene score ≥ CUT_SCORE) while the light stays as it was, with calm
 *  frames either side. Measured on that take, its overlay cropped away: the cut scored 0.113 at a brightness change
 *  of 1.8 (of 255), between frames scoring 0.002 and 0.041; its two lamps going out scored 0.16 and 0.11 at changes of
 *  18 and 12 — a lamp is not a cut, and a camera swung fast is several unlike frames in a row, not one. */
export const CUT_SCORE = 0.08;
/** The most the brightness may change across a cut (a bigger change is the light, not the camera). */
export const CUT_LIGHT = 5;
/** A cut this early is cut OFF: the take starts just after it (later than this, too much of the take would go). */
export const TRIM_WITHIN = 4;
/** How a take is looked at for its cuts: ffmpeg logs every frame's brightness and scene score (read by framesOf). */
export const cutLookArgs = (file: string): string[] => ["-v", "info", "-nostats", "-i", file, "-an", "-vf", "scale=320:-2,signalstats,select='gte(scene,0)',metadata=print", "-f", "null", "-"];
/** Each frame of a take as ffmpeg logs it (signalstats + metadata=print): its second, brightness and scene score. */
export function framesOf(log: string): Array<{ t: number; y: number; s: number }> {
  const out: Array<{ t: number; y: number; s: number }> = [];
  let cur: { t: number; y: number; s: number } | null = null;
  for (const line of log.split(/\r?\n/)) {
    const t = /pts_time:(-?[\d.]+)/.exec(line);
    if (t) { cur = { t: Number(t[1]), y: NaN, s: 0 }; out.push(cur); continue; }
    if (!cur) continue;
    const y = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line);
    if (y) cur.y = Number(y[1]);
    const s = /lavfi\.scene_score=([\d.]+)/.exec(line);
    if (s) cur.s = Number(s[1]);
  }
  return out.filter((f) => Number.isFinite(f.t) && Number.isFinite(f.y));
}
/** The seconds a take CUTS at (see CUT_SCORE). */
export function cutsAt(frames: ReadonlyArray<{ t: number; y: number; s: number }>): number[] {
  const out: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i], before = frames[i - 1], after = frames[i + 1];
    if (f.s < CUT_SCORE) continue;
    // (the light changed — a lamp, a torch, the dark — not the camera; or a black frame either side)
    if (Math.abs(f.y - before.y) > CUT_LIGHT || Math.min(f.y, before.y) < 8) continue;
    // (a camera swung fast: unlike frames on either side of this one too)
    if (before.s > f.s * 0.3 || (after && after.s > f.s * 0.6)) continue;
    out.push(Math.round(f.t * 100) / 100);
  }
  return out;
}
/** Which of two rolls of a take is KEPT: the one with fewer cuts; then, for a take that must be silent, the one the
 *  engine spoke fewer words in (`words` null: it could not be heard — and a roll that could not be heard is not
 *  known to be quieter). True when `a` is better than `b`. */
export function betterRoll(a: { cuts: number; words: number | null }, b: { cuts: number; words: number | null }, silent: boolean): boolean {
  if (a.cuts !== b.cuts) return a.cuts < b.cuts;
  return silent && a.words !== null && b.words !== null && a.words < b.words;
}
/** A roll worth rolling again: it cuts, or the engine spoke in a take that must be silent. */
export const rollFaulty = (r: { cuts: number; words: number | null }, silent: boolean): boolean => r.cuts > 0 || (silent && (r.words ?? 0) > 0);
/** The lines of a take that now starts `by` seconds later (its cut cut off): each said that much earlier — never
 *  before the take's first moment (the radio at its own). */
export function shiftLines<T extends { at: number; radio?: true }>(lines: T[], by: number): T[] {
  if (!(by > 0)) return lines;
  return lines.map((l) => ({ ...l, at: Math.round(Math.max(l.radio ? RADIO_AT : 0.3, l.at - by) * 100) / 100 }));
}

/** How loud the room of a take should be once it is finished, and the most it is ever lifted by. Told that
 *  nobody speaks, the engine answers with a room that is nearly silent (measured on the first two such
 *  takes: −55 and −62 dB); a phone's microphone is never that quiet. */
export const TAKE_ROOM_DB = -34;
export const TAKE_LIFT_MAX_DB = 30;

/** THE SOUND OF A FINISHED TAKE, as an ffmpeg filter graph. The inputs are, in order: the take (0), each
 *  spoken line (1 … n), and one input of brown noise for the hiss (n + 1). The take's own room is lifted to a
 *  real level, a faint low hiss is laid under everything so the voice sits IN the room, and each line is a
 *  little band-limited with a touch of room — someone standing right behind the lens. A RADIO line is a radio
 *  (the dispatcher's call that worked, scratchpad t45/cam/b-dispatch-radio.wav): 450–2700 Hz, squeezed hard,
 *  with the squelch — a short burst of white noise — either side of it (`seconds`: how long the line is, for the
 *  burst after it). The mix is `[a]`. (No lines at all: the room lifted, and its hiss — a house camera's own
 *  microphone.) */
export function takeSound(o: { lines: Array<{ at: number; radio?: boolean; seconds?: number }>; roomDb: number | null; hasSound: boolean }): string {
  const n = o.lines.length;
  const lift = o.hasSound && o.roomDb !== null && Number.isFinite(o.roomDb) ? Math.max(0, Math.min(TAKE_LIFT_MAX_DB, TAKE_ROOM_DB - o.roomDb)) : 0;
  const parts: string[] = [];
  const squelch: string[] = [];
  parts.push(o.hasSound
    ? `[0:a]aresample=48000,aformat=channel_layouts=stereo,volume=${lift.toFixed(1)}dB[amb]`
    : `[${n + 1}:a]aformat=channel_layouts=stereo,volume=-90dB[amb]`);
  parts.push(`[${n + 1}:a]aformat=channel_layouts=stereo,highpass=f=60,lowpass=f=1400,volume=-17dB[hiss]`);
  const burst = (label: string, atMs: number) => {
    parts.push(`anoisesrc=d=0.12:c=white:a=0.22:r=48000,highpass=f=450,lowpass=f=2700,aformat=channel_layouts=stereo,adelay=${atMs}|${atMs}[${label}]`);
    squelch.push(`[${label}]`);
  };
  o.lines.forEach((l, i) => {
    const ms = Math.max(0, Math.round(l.at * 1000));
    if (l.radio) {
      parts.push(`[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,highpass=f=450,lowpass=f=2700,acompressor=threshold=-26dB:ratio=8:attack=2:release=60,volume=-3dB,adelay=${ms}|${ms}[v${i}]`);
      burst(`q${i}a`, Math.max(0, ms - 140));
      if (l.seconds && l.seconds > 0) burst(`q${i}b`, ms + Math.round(l.seconds * 1000) + 20);
    } else {
      parts.push(`[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,highpass=f=150,lowpass=f=6500,aecho=0.8:0.5:14:0.18,volume=8dB,adelay=${ms}|${ms}[v${i}]`);
      // (+8 dB: the room echo halves what it is given and the filters take the rest — measured on "Not in Your Bed", a
      //  -21 LUFS line came out at -34, six dB over the room; the one holding the camera is the loudest thing at its mic)
    }
  });
  parts.push(`[amb][hiss]${o.lines.map((_, i) => `[v${i}]`).join("")}${squelch.join("")}amix=inputs=${n + 2 + squelch.length}:normalize=0:duration=first,alimiter=limit=0.9[a]`);
  return parts.join(";");
}
/** The hiss input `takeSound` expects, as an ffmpeg lavfi source. */
export const TAKE_HISS = "anoisesrc=color=brown:amplitude=0.05:sample_rate=48000";

/** A ready-made take's own direction, as a writer is shown it to start from (a drama's lines with their seconds). */
function directionLines(c: Take): string {
  const at = (l: { at: number; text: string }) => `at ${l.at} s, "${l.text}"`;
  const radio = c.radio ? [`- the radio, as the take opens: "${c.radio}"`] : [];
  if (c.genre === "drama") {
    return [
      `- the scene it arrives at: ${c.still}`,
      `- where the camera looks first: ${c.opens}`,
      `- the walk-up, the first four seconds: ${c.first}`,
      `- how the camera finds them: the camera ${c.finds}, and stops ${c.stops || "on them"}`,
      `- (1) by the fifth second: ${c.beats[0]}`,
      `- (2) from the ninth second: ${c.beats[1]}`,
      `- (3) the last four seconds: ${c.beats[2]}`,
      `- what the person on camera says: ${(c.speaks || []).map(at).join("; ")}`,
      `- what the officer says: ${(c.script || []).map(at).join("; ")}`,
      ...radio,
      `- the sound: ${c.sound}`,
    ].join("\n");
  }
  return [
    `- the scene it arrives at: ${c.still}`,
    `- where the camera looks first: ${c.opens}`,
    `- the first two seconds: ${c.first}`,
    `- how the camera finds it: the camera ${c.finds}`,
    `- (1) ${c.beats[0]}`,
    `- (2) ${c.beats[1]}`,
    `- (3) ${c.beats[2]}`,
    `- what the one filming says: "${c.says[0]}" (${c.asks === "looking" ? "while still looking" : "on seeing it"})${c.says[1] ? `, then "${c.says[1]}"` : ""}`,
    ...radio,
    `- the sound: ${c.sound}`,
  ].join("\n");
}

/** The part of a writer's brief that hands it the card the member's words started from: the card's words, its
 *  direction, and what to do with them. (`changes`: what the member may have changed, in this kind of take.) */
function startsFrom(c: { name: string; premise: string }, direction: string, changes: string): string[] {
  return [
    `IT STARTS FROM A READY-MADE TAKE, "${c.name}". Its own words were: ${c.premise}`,
    "The member changed those words into THE IDEA above. This is that take's direction — it was filmed, and it works:",
    direction,
    `Start from that direction and change it to fit THE IDEA: keep everything the idea keeps (and every detail it does not mention), and change everything it changes — ${changes}. Where the idea says the same as the card, keep the card's own words.`,
  ];
}

/** WRITE ME ONE — the brief for the writer when a member's own words describe a take. `from`: the card those words
 *  started from (its own direction is where the writer starts). The answer is JSON:
 *  { title, who, still, opens, first, finds, beats: [3], says: [2], asks, ends, sound } — and, for a body cam, the
 *  dispatcher's call: radio. THE END is the member's: only words that give no ending end with it coming at the lens. */
export function takeWriterBrief(idea: string, camera?: CameraLook, from?: TakeIdea): string {
  const worn = camera === "bodycam";
  return [
    worn
      ? "You are directing ONE continuous twelve-second shot of found footage — something caught on a body camera worn on the chest of somebody walking in at night, a flashlight beside it. Not a story: a moment. It is FICTION: a creature in a house — never a real police incident, never a weapon drawn or fired, never anybody hurt, never a real agency, a real town or a real address."
      : "You are directing ONE continuous twelve-second shot of found footage — something caught on a camera somebody was holding. Not a story: a moment.",
    `THE IDEA: ${one(idea, 400) || "something that should not be in the house"}`,
    ...(from ? startsFrom(from, directionLines(from), "who or what it is, where it is, what is wrong with it, what it does, how it ends") : []),
    // (what the one filming SAYS is never the card's: a writer kept "no... no..." under the member's own words, and the
    //  owner heard "roommate what are you doing no no" — 2026-11-25: "the wording choice is fucking sad")
    ...(from ? ["BUT NEVER what the one filming says: write their words NEW, for THE IDEA (see \"says\") — not one of the card's lines, and not their shape."] : []),
    "It is built the way a scare is built. FIRST, for two seconds, the camera is NOT on the thing: it is looking somewhere ordinary in the same place — the floor as its holder walks, the side of a bed, the foot of a staircase — and nobody is in the picture. THEN the camera moves and FINDS it, and three beats follow: (1) STILLNESS — the thing is there, perfectly still, looking at the camera. (2) ONE WRONG MOVEMENT — small, slow, impossible for a person: a head tilting too far, fingers walking. (3) THE END — whatever THE IDEA says happens at the end: it is gone when the light comes back; the camera turns away, turns back, and it is right there; the one filming runs; it was someone they know. Only when the idea gives no ending does IT COME — slowly, smoothly, toward the camera, never taking its eyes off the lens, while the camera backs away, until it fills the frame.",
    "All of it is ONE continuous shot of about twelve seconds that a real camera could film: no cut, no jump in time, nothing a second camera would have to see. If the end needs the camera to leave it, the camera swings away; if it needs the dark, the light goes out — no flash — and comes back.",
    "What frightens is slowness and stillness. It NEVER runs, flinches, turns away or screams, and nothing flashes or glitches — a startled thing is not frightening.",
    "ITS MOUTH NEVER MOVES. Nothing it does involves speaking, mouthing, chewing, or its mouth opening or closing: a smile it has is fixed from the first frame to the last. (The one filming speaks, and a mouth that moves would look like it is saying their words.)",
    "THE THING is nearly human and slightly wrong: ONE or TWO exact wrongnesses and no more (a smile far too wide, crowded with thin teeth; eyes sunk in dark sockets; a neck or fingers too long; skin like candle wax). Never horns, wings, tentacles, glowing eyes, flames or a bare skull. No blood, no gore, no wounds.",
    "The one filming is never seen: write what THE CAMERA does (\"the camera backs away\"), never what their body does.",
    'Answer with JSON only, in English whatever language the idea is in: {"title": a short name for this take (2–5 words), "who": what to call the thing in a sentence ("she", "the figure", "the face" — lower case, 1–3 words), "still": THE SCENE THE CAMERA ARRIVES AT, as one picture, in 2–4 sentences — where the camera is, what is in the dark, exactly what is wrong with it, what little light there is, "opens": WHERE THE CAMERA LOOKS FIRST, as one picture of the same place with NOBODY in it, in one or two sentences, "first": what the camera sees and what its holder is doing for those two seconds, one sentence starting "the camera", "finds": how the camera gets from there to the thing, a few words starting with a verb ("swings up to the hallway ahead", "sinks slowly down to the floor and looks under the bed"), "beats": [the stillness — say again here exactly what the thing looks like and where it is, since this is where the camera finds it —, the wrong movement, THE END — one or two sentences each, in the present tense; the first two start with the thing], "says": [what the one filming says first — as they look, or the moment they see it (see "asks") — what a real, frightened person would actually blurt in THIS situation: specific to what the idea says they know (the name of the person they live with, what they heard a minute ago, whose room it is), broken off, breathless, 4 to 12 words — never a stock line ("what are you doing", "who is there", "hello?" on its own), what they whisper as the end lands: what they have just UNDERSTOOD, said out loud and broken off — the turn of THIS idea in their own words (the kind of line: "then who’s in your bed—", for an idea where she is also asleep in her room), 2 to 7 words, never "no", "no no", "oh god" or "what the"], "asks": "looking" if the question is asked BEFORE the camera finds the thing ("Who is up there?"), "found" if it is asked on seeing it ("What is wrong?"), "ends": how THE END ends — "comes" (it comes toward the camera), "stays" (the camera stays on it and the light does not change), "dark" (the light goes out or changes), "away" (the camera turns or swings away from it), "sound": the sound of the thing moving, in a few words}',
    ...(worn ? ['…and with it, "radio": what a dispatcher says over the radio as the take opens — ONE short call: a unit number, why they were sent and a MADE-UP house number and street ("Four-twelve, welfare check at fourteen Alder Lane. No lights in three days."); no real agency, no crime, no weapon.'] : []),
  ].join("\n");
}

/** WRITE ME A DRAMA — the brief for the writer when a member changes the police drama's words. Not the creature's:
 *  here the person ON camera speaks (their lines are the one place a found-footage take gives the engine words),
 *  the officer's lines and the dispatcher's are laid on afterwards, and DRAMA_BOUNDS hold. `person`: who is on camera
 *  when the member's words do not say — one of the card's cast, picked for each take (castPick), so nobody is ever
 *  the default. The answer is JSON — { title, who, still, opens, first, finds, stops, beats: [3], speaks: [{at, text}],
 *  script: [{at, text}], radio, sound } — and is read by parseTake(…, "drama"). */
export function dramaWriterBrief(idea: string, from: TakeIdea, person?: string): string {
  const who = one(person, 200) || from.cast?.[0] || "someone stopped for something small";
  const card: Take = { ...from, still: from.still.replace(/\{driver\}/g, who) };
  return [
    "You are directing ONE continuous fifteen-second shot of body-camera footage — a FICTIONAL police drama, not a horror: caught at night by a camera worn on the chest of an officer. Not a story: one moment.",
    `THE IDEA: ${one(idea, 400) || from.premise}`,
    ...startsFrom(from, directionLines(card), "who is on camera, where it is, what they say, what they do, how it ends"),
    `If the idea does not say who the person on camera is, it is ${who}. Never make them one kind of person by default; never mock or stereotype anyone.`,
    "THE SHAPE, second by second — it is what films well: the first four seconds are THE WALK-UP, in silence (nobody speaks; only footsteps and the patrol car's engine idling); BY THE FIFTH SECOND the camera has found the person and stopped on them, their face in full view — (1) how they are; FROM THE NINTH SECOND, THE TURN — (2) what they do: refuse, argue, plead, pull away, run a few steps, hand something over, break down; THE LAST FOUR SECONDS, THE END — (3) how it ends, as the idea says: in handcuffs, with a warning, let go, a ticket, a hug. All of it is ONE continuous shot a real body camera could film: no cut, no jump in time.",
    "THE BOUNDS — it is FICTION: a generic unit (\"Unit twelve\") of a made-up county; no real police department, agency, badge, patch, insignia or lettering; no real place, street, person or event. No weapon is drawn, pointed or fired; nobody is struck, nobody is hurt, no blood. Resisting is refusing, pulling away and a short chase; it may end in handcuffs.",
    "WHO SPEAKS, AND HOW: the person on camera's own lines are said IN the shot — the video model moves their mouth to them — so each is short (under fifteen words), said once, after the sixth second, once their face is in view. The officer wearing the camera is never seen except their hands and never speaks in the shot: the officer's lines are recorded on their own and laid over the take — the first as the camera reaches the person (about 4.5 seconds), before the person answers, and never at the same moment as one of the person's lines. The dispatcher's call over the radio is heard as the take opens.",
    `Answer with JSON only, in English whatever language the idea is in: {"title": a short name for this take (2–5 words), "who": what to call the person on camera, lower case ("the driver", "the woman at the door"), "still": THE SCENE THE CAMERA ARRIVES AT, as one picture, in 2–4 sentences — where the camera is, who is there and exactly how they look, the light, "opens": WHERE THE CAMERA LOOKS FIRST, as one picture of the same place with NOBODY in it, in one or two sentences, "first": what the camera sees and does in the walk-up, one sentence starting "the camera", "finds": how the camera gets to the person, a few words starting with a verb ("lifts to the driver's open window"), "stops": where the camera stops, a few words starting with "at" ("at the window", "at the front door"), "beats": [how they are when the camera finds them, THE TURN, THE END — one or two sentences each, in the present tense], "speaks": [{"at": the second it is said, 6 to 14, "text": what the person on camera says} — one to three lines], "script": [{"at": the second it is said, 0 to 14, "text": what the officer says} — two to four lines], "radio": what the dispatcher says as the take opens — one short call: the unit, why, a made-up street, "sound": the sounds of the place, in a few words}`,
  ].join("\n");
}

/** Who is on camera in a drama whose words do not say: one of its cast, picked by `seed` (as castTake picks). */
export const castPick = (t: { cast?: readonly string[] }, seed: number): string | undefined =>
  t.cast?.length ? t.cast[Math.abs(Math.floor(Number(seed) || 0)) % t.cast.length] : undefined;

/** THE SHAPE A WRITER'S ANSWER IS HELD TO (anthropicText → jsonSchema, a forced tool call): a take… */
export const TAKE_SCHEMA = {
  name: "take",
  schema: { type: "object", additionalProperties: false, required: ["title", "who", "still", "opens", "first", "finds", "beats", "says", "asks", "ends", "sound"], properties: { title: { type: "string" }, who: { type: "string" }, still: { type: "string" }, opens: { type: "string" }, first: { type: "string" }, finds: { type: "string" }, beats: { type: "array", items: { type: "string" } }, says: { type: "array", items: { type: "string" } }, asks: { type: "string", enum: ["looking", "found"] }, ends: { type: "string", enum: [...TAKE_ENDS] }, sound: { type: "string" }, radio: { type: "string" } } },
};
const SPOKEN_SCHEMA = { type: "array", items: { type: "object", additionalProperties: false, required: ["at", "text"], properties: { at: { type: "number" }, text: { type: "string" } } } };
/** …and a drama. */
export const DRAMA_SCHEMA = {
  name: "drama_take",
  schema: { type: "object", additionalProperties: false, required: ["title", "who", "still", "opens", "first", "finds", "stops", "beats", "speaks", "script", "radio", "sound"], properties: { title: { type: "string" }, who: { type: "string" }, still: { type: "string" }, opens: { type: "string" }, first: { type: "string" }, finds: { type: "string" }, stops: { type: "string" }, beats: { type: "array", items: { type: "string" } }, speaks: SPOKEN_SCHEMA, script: SPOKEN_SCHEMA, radio: { type: "string" }, sound: { type: "string" } } },
};

/** A drama is fifteen seconds: the walk-up, the window, the turn, the end (the traffic stop's own length). */
export const DRAMA_SECONDS = 15;
/** How long the officer waits after a line of the person on camera: that answer is in the take's own sound, and a
 *  line laid over it would bury it. */
export const DRAMA_LINE_ROOM = 2.4;
/** What a written drama never has in it (DRAMA_BOUNDS): a weapon, a blow, a wound. The bounds said back — "no blood",
 *  "no weapon is drawn", "nobody is hurt" — are taken out before it is looked for. */
const DRAMA_HURT = /\b(?:guns?|handguns?|pistols?|rifles?|shotguns?|revolvers?|firearms?|tasers?|tased|shoots?|shooting|shots? fired|weapons? (?:is |are )?(?:drawn|pointed|fired|raised)|draws? (?:a|his|her|their) (?:gun|weapon|pistol)|punch(?:es|ed|ing)?|kick(?:s|ed|ing)?|stab(?:s|bed|bing)?|knife|knives|blood(?:y)?|bleed(?:s|ing)?|wounded|injured)\b/i;
const NOT_HURT = /\b(?:no|never|without)(?: an?)? (?:guns?|weapons?|blood|knife|knives)(?: (?:is|are))?(?: (?:drawn|pointed|fired|raised))?(?: or (?:drawn|pointed|fired|raised))?\b|\b(?:nobody|no one) is (?:hurt|injured|struck)\b/gi;
/** Is a weapon, a blow or a wound in these words (the bounds said back are not one)? — asked of anything a body camera
 *  films that is not the creature's: a film's plain moments (footage-film.ts) keep the drama's bounds. */
export const hurtIn = (text: unknown): boolean => DRAMA_HURT.test(String(text ?? "").replace(NOT_HURT, " "));

/** The writer's answer, checked: every part there and of a sane length — else null (the caller falls back
 *  to a ready-made idea rather than film half a direction). `kind` "drama": a drama writer's answer
 *  (dramaWriterBrief) — the person on camera's lines and the officer's, with their seconds, checked against the
 *  bounds; a drama is never made from an answer with a weapon, a blow or a wound in it. */
export function parseTake(raw: unknown, kind?: "drama"): (Take & { title: string }) | null {
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
  if (beats.length !== 3 || still.length < 40 || !who) return null;
  // (the way in is part of the direction: a take with no off-subject opening is not this take)
  if (opens.length < 20 || first.length < 12 || finds.length < 4) return null;
  const radio = one(o.radio, 140).replace(/["“”]/g, "'");
  const title = one(o.title, 60) || "Found footage", sound = one(o.sound, 90);
  if (kind === "drama") {
    // the lines with their seconds — each one short, said once (dramaLines keeps the person's after the window)
    const spoken = (v: unknown, max: number, lo: number, hi: number, n: number) => (Array.isArray(v) ? v : [])
      .map((x) => {
        const l = (x && typeof x === "object" ? x : {}) as { at?: unknown; text?: unknown };
        return { at: Math.round(Math.min(hi, Math.max(lo, Number(l.at))) * 10) / 10, text: one(l.text, max).replace(/["“”]/g, "'") };
      })
      .filter((l) => l.text && Number.isFinite(l.at)).slice(0, n).sort((a, b) => a.at - b.at);
    const speaks = spoken(o.speaks, 120, DRAMA_WINDOW_AT + 1, 14, 3);
    // (the officer's lines are a track of their own: none is laid over a line of the person's — it waits until
    //  after it, or is left out when there is no room left)
    const script = spoken(o.script, 90, 0, 14.5, 4).map((l) => {
      let at = l.at;
      for (const s of speaks) if (at > s.at - 0.5 && at < s.at + DRAMA_LINE_ROOM) at = s.at + DRAMA_LINE_ROOM;
      return { ...l, at: Math.round(at * 10) / 10 };
    }).filter((l) => l.at <= 14.5).sort((a, b) => a.at - b.at);
    if (!speaks.length || !script.length) return null;
    // (the bounds are looked for in EVERYTHING the writer wrote — a line left out for want of room included: an answer
    //  with a weapon in it anywhere is not one to film any of)
    const lineTexts = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => String((x && typeof x === "object" ? (x as { text?: unknown }).text : x) ?? ""));
    const all = [still, opens, first, finds, ...beats, radio, String(o.title ?? ""), ...lineTexts(o.speaks), ...lineTexts(o.script)].join(" ");
    if (DRAMA_HURT.test(all.replace(NOT_HURT, " "))) return null;
    const stops = one(o.stops, 40).toLowerCase().replace(/[.,;:]+$/, "");
    return {
      title, who, still, opens, first, finds,
      beats: [beats[0], beats[1], beats[2]],
      // (a drama's officer says their lines at their own times — `script`; `says` is only their first and last)
      says: [script[0].text, script.length > 1 ? script[script.length - 1].text : ""],
      asks: "found",
      sound,
      ...(radio ? { radio } : {}),
      genre: "drama", speaks, script, seconds: DRAMA_SECONDS,
      ...(/^(?:at|by|beside|outside|in front of)\s\S/.test(stops) ? { stops } : {}),
    };
  }
  if (says.length < 1) return null;
  const ends = String(o.ends ?? "").trim().toLowerCase();
  return {
    title,
    who, still, opens, first, finds,
    beats: [beats[0], beats[1], beats[2]],
    says: [says[0], says[1] || ""],
    asks: String(o.asks || "").trim().toLowerCase() === "looking" ? "looking" : "found",
    sound,
    ...(radio ? { radio } : {}),
    // (coming at the lens is the ending a take has unless it says otherwise — it is never written down)
    ...(ends !== "comes" && (TAKE_ENDS as readonly string[]).includes(ends) ? { ends: ends as TakeEnding } : {}),
  };
}

/* ---- THE BUILDER: WHAT HAPPENS, AND WHAT IT WAS SHOT ON ----
 * The owner: "You know what I want make it easymode and selectable good UI interface". One screen
 * (routes/web.found-footage.tsx): what happens, the camera, the settings that apply to that camera, one button.
 * These are its rules — the page and the server both ask them. */

/** Who carries the camera: a HAND (a phone, a camcorder, no overlay), a CHEST (the body cam), or nobody (the house
 *  camera on the wall). A ready-made scare is written for one of them; a take of the member's own words alone fits
 *  every camera. */
export type FootageFamily = "hand" | "worn" | "fixed";
export const familyOf = (c: CameraLook): FootageFamily => (c === "house" ? "fixed" : c === "bodycam" ? "worn" : "hand");
export const HAND_CAMS: readonly CameraLook[] = ["phone", "camcorder", "bare"];
/** The key of a take of the member's own words, with no card picked. */
export const OWN_SCARE = "own";

/** THE SHAPE FOLLOWS THE CAMERA. A phone is held upright (9:16); a house camera and a body cam are wide (16:9); a
 *  camcorder and the bare hand are the maker's pick, wide unless asked (the owner: "for the wider that could be
 *  cam corder style … with no actual overlay"). */
export const shapeChoosable = (c: CameraLook): boolean => c === "camcorder" || c === "bare";
export function shapeFor(c: CameraLook, asked?: unknown): "9:16" | "16:9" {
  if (c === "phone") return "9:16";
  if (c === "house" || c === "bodycam") return "16:9";
  return asked === "9:16" ? "9:16" : "16:9";
}

/** A ready-made scare as the builder shows it: its card, its words (`premise` — what tapping it puts in the box), and
 *  the cameras that can film it (`genre`: a drama, not a scare). */
export type FootageScare = { key: string; name: string; line: string; premise: string; cams: readonly CameraLook[]; img: string; lapseOn?: boolean; genre?: "drama" };
/** The cards' pictures are public/landing/ff-scare-<key>.jpg — bump this when one is replaced. */
export const FF_PIC_V = 1;
export const FOOTAGE_SCARES: ReadonlyArray<FootageScare> = [
  ...TAKE_IDEAS.map((i) => ({ key: i.key, name: i.name, line: i.line, premise: i.premise, cams: i.cams || HAND_CAMS, img: `/landing/ff-scare-${i.key}.jpg?v=${FF_PIC_V}`, ...(i.genre === "drama" ? { genre: i.genre } : {}) })),
  ...HOUSE_SCARES.map((s) => ({ key: s.key, name: s.name, line: s.line, premise: s.premise, cams: ["house"] as readonly CameraLook[], img: `/landing/ff-scare-${s.key}.jpg?v=${FF_PIC_V}`, lapseOn: s.lapseOn })),
];
/** WHAT HAPPENS, ON ITS SHELVES — one for each way a camera is carried. The body cam has its own (the owner: it
 *  "doesn't nessesarily need to be horror"): a scare, and a police drama. */
export const FOOTAGE_SHELVES: ReadonlyArray<{ family: FootageFamily; name: string; line: string }> = [
  { family: "hand", name: "Someone filming", line: "A phone, a camcorder, or no overlay." },
  { family: "worn", name: "Body cam", line: "A scare, or a police drama." },
  { family: "fixed", name: "House cameras", line: "The house remembers its rooms." },
];
export const shelfScares = (family: FootageFamily): FootageScare[] => FOOTAGE_SCARES.filter((s) => familyOf(s.cams[0]) === family);
export const footageScare = (key: unknown): FootageScare | undefined => FOOTAGE_SCARES.find((s) => s.key === String(key ?? "").trim().toLowerCase());
/** Can this camera film this scare? (Your own idea: any camera.) */
export const fits = (scare: string, camera: CameraLook): boolean => scare === OWN_SCARE || !!footageScare(scare)?.cams.includes(camera);

/** What is picked: the scare, and the camera. */
export type FootagePick = { scare: string; camera: CameraLook };
/** THE LAST TAP WINS, THE OTHER CHOICE FOLLOWS — never a card that cannot be pressed. A scare is tapped: if the
 *  camera picked cannot film it, the camera becomes one that can (the hand-held camera last used, when it is one
 *  of them; else its first). */
export function pickScare(p: FootagePick, scare: string, lastHand: CameraLook = "phone"): FootagePick {
  if (scare !== OWN_SCARE && !footageScare(scare)) return p;
  if (fits(scare, p.camera)) return { scare, camera: p.camera };
  const cams = (footageScare(scare) as FootageScare).cams;
  return { scare, camera: cams.includes(lastHand) ? lastHand : cams[0] };
}
/** …a camera is tapped: if it cannot film the scare picked, the scare becomes the first one it can. */
export function pickCamera(p: FootagePick, camera: CameraLook): FootagePick {
  if (fits(p.scare, camera)) return { scare: p.scare, camera };
  return { scare: FOOTAGE_SCARES.find((s) => s.cams.includes(camera))?.key || OWN_SCARE, camera };
}

/** The builder's form, as it arrives. `own`: the words in its box — a card's own words when one was tapped and left
 *  as it put them, else the member's. */
export type FootageForm = { scare?: unknown; own?: unknown; camera?: unknown; aspect?: unknown; lapse?: unknown; ir?: unknown; room?: unknown };
const yes = (v: unknown) => v === true || v === "1" || v === "on" || v === "true";
const no = (v: unknown) => v === false || v === "0" || v === "off" || v === "false";

/** Words as they are compared: letters and numbers of any script, in lower case — so spacing, punctuation, the kind
 *  of quote or apostrophe and capitals are never a change. */
const wordsKey = (s: unknown): string => String(s ?? "").normalize("NFKC").toLowerCase().replace(/['’‘`´]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** The same words (see wordsKey) — and not none. */
export const sameWords = (a: unknown, b: unknown): boolean => { const k = wordsKey(a); return !!k && k === wordsKey(b); };

/** A CARD'S WORDS, LEFT AS THEY WERE? — true when the box is empty or says what the card's premise says, in English
 *  or as the member was shown it (`shown`: the page's own translation; the server passes the same, for the member's
 *  language). The page asks it to say which take the button will film; the server asks it again (footageJob) and
 *  only its answer counts. */
export function cardUnchanged(words: unknown, premise: string, shown?: (s: string) => string): boolean {
  if (!String(words ?? "").trim()) return true;
  return sameWords(words, premise) || (!!shown && sameWords(words, shown(premise)));
}

/** THE JOB A BUILDER ASKS FOR — or why not (in words the page can show). Everything is decided here: the shape
 *  from the camera, the room from the scare, the house's settings only for the house camera (the time-lapse
 *  starts as the scare has it; night vision starts on) — and WHOSE TAKE IT IS: a card whose words were left as they
 *  were is the ready-made take (`takeIdea`); a card whose words were changed is the member's own, written from it
 *  (`takeOwn` + `takeFrom`); no card is their own words alone (`takeOwn`). `shown`: the card's words as the member
 *  was shown them (the page's language) — words left as they were in that language are left as they were. */
export function footageJob(f: FootageForm, shown?: (s: string) => string): { ok: true; name: string; payload: Record<string, unknown> } | { ok: false; error: string } {
  const camera = cameraLookOf(f.camera);
  if (!camera) return { ok: false, error: "Pick a camera." };
  const key = String(f.scare ?? "").trim().toLowerCase();
  const own = key === OWN_SCARE;
  const scare = own ? undefined : footageScare(key);
  if (!own && !scare) return { ok: false, error: "Pick what happens." };
  if (!fits(key, camera)) return { ok: false, error: "That camera can't film that one — pick another." };
  const idea = one(f.own, 400).replace(/["“”]/g, "'");
  // A CARD IS A STARTER: its words changed make it the member's own take — written FROM the card
  const from = scare && !cardUnchanged(idea, scare.premise, shown) ? scare : undefined;
  const written = own || !!from;
  if (written && idea.length < 8) return { ok: false, error: "Say what happens, in a few words." };
  const house = camera === "house";
  const hs = house && scare ? houseScare(scare.key) : undefined;
  const name = written ? (idea.length > 44 ? `${idea.slice(0, 43).trim()}…` : idea) : (scare as FootageScare).name;
  return {
    ok: true, name,
    payload: {
      section: "creator", contentType: "take",
      takeCamera: camera, takeAspect: shapeFor(camera, f.aspect),
      ...(written ? { takeOwn: idea, ...(from ? { takeFrom: from.key } : {}) } : { takeIdea: (scare as FootageScare).key }),
      ...(house ? {
        // (a ready-made house scare keeps its own room; a take written from one is in the room picked, else its)
        takeRoom: hs && !from ? hs.room : houseRoom(f.room)?.key || hs?.room || "living",
        takeLapse: yes(f.lapse) ? true : no(f.lapse) ? false : !!hs?.lapseOn,
        takeIr: !no(f.ir),
      } : {}),
      // (what the Archive's tile shows while it is made: its name, and its card's picture)
      productTitle: `Found Footage — ${name}`.slice(0, 60),
      ...(scare ? { productImageUrl: scare.img } : {}),
      initiator: "web",
    },
  };
}

/** HOW LONG, start to Archive, in minutes: the roll is most of it (a twelve-second take; a house take is fifteen
 *  and draws its room first). A take the engine spoke in is rolled once more, which the top end allows for. */
export const footageEta = (camera: CameraLook): [number, number] => (camera === "house" ? [6, 12] : [5, 10]);
