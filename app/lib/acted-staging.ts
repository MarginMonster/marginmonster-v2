/* HOW AN ACTED FILM IS STAGED — AND THAT SOMETHING HAPPENS IN IT.
 *
 * The owner, 2026-11-24, after watching a Horror Film made on the live site from "A woman house-sitting alone
 * at night keeps hearing her own voice calling her name from the basement. She goes down to look." — 21
 * seconds, two shots: the two of them sitting side by side at a table facing the lens, then the same two
 * shoulder to shoulder in front of a wall: "Unrealistic for them to stand this close bro, and aside from them
 * on screen there is no actual things occurring, it's just them speaking". (And earlier, of the told stories:
 * "the two characters standing side by side isnt always how a scene is or how things are filmed, sometimes
 * theree is distance and they walk forward yanno?")
 *
 * Both were ASKED FOR, word for word, by fixes to two older faults:
 *   · the picture every clip of a place is seeded from (image-generation → renderSideBySideTwoShot) said
 *     "Frame them from roughly the CHEST UP and fairly CLOSE", "standing CLOSE together", "BOTH FACES turned
 *     three-quarters toward the camera" — written when faces came out too small to hold, and as two profiles;
 *   · the writer was told "they STAY put … a still, tense TALKING beat … keep hands EMPTY", and the clip was
 *     told "The speakers hold their places" — written when big moves made a face morph.
 *
 * What those fixes were protecting still holds, and every staging here keeps it: the dialogue engine lip-syncs
 * from the seed picture, so BOTH faces stay in view and large enough to read a mouth; nobody is turned away,
 * cropped out or a blurred foreground head; nothing stands between the two; and one master picture per
 * location stays the seed of every clip there (no shot / reverse-shot panels).
 *
 * So, as a told story is dealt its shot plan (story-shots.ts), an acted film is dealt its STAGING — one way of
 * placing the two, and the camera, for each LOCATION, no two neighbours alike — and it is used three times:
 *
 *   · THE PICTURE (the location's master) is drawn in it, with what the scene calls for IN the picture;
 *   · THE CLIP is told how the two move in it, and the one thing that HAPPENS while the line is spoken;
 *   · THE PIECE keeps which staging each location got.
 *
 * …and THE WRITER is told that every shot is something that physically happens, not two people talking.
 *
 * A lesson carried over from the told stories (story-motion.ts): a clip prompt that NAMES a thing can ADD it
 * to the picture. So a clip is told only its own scene's words; a thing a shot needs is put there by the
 * writer and drawn into the PICTURE, never introduced by a late line of ours.
 *
 * Pure. tests/acted-staging.test.ts holds it. */

import { CLIP_MAX_SECONDS, clipSecondsFor } from "./speech-meter.ts";
import { CREATURE_REAL, DRESSED, SHADOW_SHAPE, TODAY_LOOK, shadowNote } from "./story-picture.ts";
import { castEntry, characterKind, dressedInWater, portraitPrompt } from "./story-picture.ts";
import { TAKE_HIDDEN } from "./take.ts";
import type { PlaceChange } from "./place-state.ts";

export type ActedStaging = "apart" | "depth" | "levels" | "across" | "walk" | "doing";

type StagingSpec = {
  /** (i) what the location's master picture is told: where the two are, and where the camera is */
  picture: string;
  /** (ii) what every clip of that location is told about how they move */
  clip: string;
  /** …and what the camera does, when it does not stay locked */
  camera?: string;
  /** (iii) where it fits, in words */
  fits: string;
  /** the distance between them runs ACROSS the frame: only a wide (16:9) frame has the room for it with
   *  both faces still large */
  wide?: true;
  /** only where the place's or the scene's own words have this */
  needs?: RegExp;
  /** …and when the scene's own words say this, nothing else fits */
  claims?: RegExp;
};

/** The two of them on the move together — a plural subject, and the going straight after it. ("Ruth walks
 *  to the door" is one of them crossing a room, and "Dana and Ruth watch him walk past" is neither of them.) */
const WALKING = /(?:\b[Tt]hey|\b[Bb]oth|\b[Tt]he two(?: of them)?|\p{Lu}[\p{L}'’-]* and \p{Lu}[\p{L}'’-]*)(?:,? (?:both|now|then|still|together|\p{L}+ly))* (?:walk|stride|stroll|creep|wander|descend|make their way|(?:come|go|head|start|set|run|hurry) (?:down|up|along|toward|towards|into|across|through|off|for)|(?:are |keep |start |begin )?(?:walking|striding|strolling|creeping|wandering|descending))\b(?!-)/u;
/** One of them has their hands on something. */
const HANDLING = /\b(?:opens|opening|pulls|pulling|pushes|pushing|lifts|lifting|picks up|picking up|carries|carrying|drags|dragging|digs|digging|searches|searching|unlocks|unlocking|unwraps|unwrapping|unzips|unzipping|unpacks|unpacking|wipes|wiping|sweeps|sweeping|hammering|mends|mending|repairing|shovels|shovelling|shoveling|pries|prying|prises|prising|grips|gripping|grabs|grabbing|rummages|rummaging|empties|emptying|unscrews|unscrewing|scrubs|scrubbing|unfolds|unfolding|tugs|tugging|hauls|hauling|kneads|kneading|reaches (?:for|into)|reaching (?:for|into)|sets down|puts down)\b/i;
/** The place has a table to sit at. */
const TABLE = /\b(?:table|booth|diner|caf[eé]|desk|canteen|cafeteria|dining room)\b/i;
/** A place that seats two people side by side and nowhere else — the inside of a car, a lift, a tent. No
 *  staging fits it: its picture is drawn as it always was. */
const NO_ROOM = /\b(?:in|inside|into)\s+(?:(?:a|an|the|his|her|their|my|our|your)\s+)?(?:[\p{L}'’-]+\s+){0,2}?(?:car|truck|van|taxi|cab|jeep|pickup|limo|limousine|cockpit|canoe|rowboat|kayak|elevator|lift|tent|phone booth)\b(?!\s+(?:park|wash|lot|dealership|lobby|shaft|rank|stop))|\b(?:front|back|passenger|driver[’']?s) seats?\b/iu;

/** What every staging's picture is also told — the part the lip-sync depends on. */
const FACES = "BOTH faces are LARGE, sharp and clearly visible, each open to the camera with both eyes and the whole mouth in view — never a flat side profile, never the back of a head, never a small far-off figure. Nobody is posed for the camera and nobody looks into the lens: each looks at the other, or at what they are doing.";

export const ACTED_STAGINGS: Record<ActedStaging, StagingSpec> = {
  apart: {
    picture: "STAGING — APART: the two are a natural speaking distance from each other — at least an arm's length of clear space between them, with the place seen in that gap — standing, or seated if that is how this place and this moment have them; never shoulder to shoulder, never lined up facing us. They are turned toward EACH OTHER in a shallow V that is open to the camera, and the camera stands a little to one side of them, so it sees one face three-quarters on and the other slightly more turned. A MEDIUM shot with the room around them: both seen from about the waist up, or from the knees up when the space between them is wide.",
    clip: "Both stay in frame on their own sides, faces in view, turned toward each other at the distance they have.",
    fits: "a wide (16:9) frame — anywhere two people can stand or sit apart",
    wide: true,
  },
  depth: {
    picture: "STAGING — NEAR AND FAR: one of them is nearer the camera, toward one side of the frame, seen from about the waist up; the other is two or three steps farther back — no more — toward the other side, seen from about the knees up, with real space between them; never shoulder to shoulder, never lined up facing us. The nearer one faces the camera's side of the room — busy with what this moment is about, or listening with their eyes away from the other — and the farther one is turned toward the nearer one, so BOTH faces are toward the camera. The nearer one is NOT a blurred foreground shape: both are in the same sharp focus. A MEDIUM shot with the place around them.",
    clip: "Both stay in frame on their own sides, faces in view: the nearer one near, the other those few steps behind.",
    fits: "any frame — anywhere with a few steps of room (what a tall 9:16 frame takes best)",
  },
  levels: {
    picture: "STAGING — TWO LEVELS: one of them is LOWER than the other — seated, crouched or kneeling, whichever this place and this moment allow — and the other is on their feet a step or two away, a little behind and to one side, so that the two heads are at different heights in the frame; never shoulder to shoulder, never lined up facing us. Both are turned toward the camera's side of the room. A MEDIUM shot with the place around them: the lower one seen whole or from the waist up, the one on their feet from about the knees up.",
    clip: "Both stay in frame on their own sides, faces in view: the lower one low, the other on their feet.",
    fits: "any frame — anywhere somebody can sit, crouch or kneel",
  },
  across: {
    picture: "STAGING — ACROSS A TABLE: the two sit at a table that belongs in this place, on opposite sides of it — its whole width between them, its top in the frame with whatever this moment puts on it. The camera is at the open end of the table, looking along it, and each of them sits a little turned out toward that end, so that it sees both faces three-quarters on. Nothing taller than the table top stands between them. A MEDIUM shot with the room around them: both seen from the table top up.",
    clip: "Both stay seated on their own sides of the table, faces in view — arms move, they lean in or sit back.",
    fits: "a wide (16:9) frame — and only where the place has a table to sit at",
    wide: true,
    needs: TABLE,
  },
  walk: {
    picture: "STAGING — WALKING: the two are walking through this place together, coming TOWARD the camera — caught mid-stride, side by side with clear space between their shoulders, or one of them half a step ahead — and the way they came stretches away behind them. A MEDIUM shot: both seen from about the knees up, their faces toward the camera — looking ahead, or turned a little to each other as they go.",
    clip: "They keep walking toward the camera together the whole shot, each on their own side, faces in view.",
    camera: "The camera travels smoothly backward ahead of them at their pace, level",
    fits: "any frame — and only when the scene has the two of them walking (then nothing else fits)",
    needs: WALKING,
    claims: WALKING,
  },
  doing: {
    picture: "STAGING — AT WORK: the thing this moment is about is IN the frame and clearly seen — at one side of it, or between the two and the camera, never behind them, so that nobody has to turn their back to use it — and one of them is busy with it: hands on it, their body turned so that their face is still open to the camera. The other stands a step or two back and to one side, watching them or the thing; never shoulder to shoulder, never lined up facing us. A MEDIUM shot with the place around them: the busy one seen from about the waist up, the other from about the knees up.",
    clip: "Both stay in frame on their own sides, faces in view: one at work on it, the other a step away.",
    fits: "any frame — and only when the scene gives one of them something to handle",
    needs: HANDLING,
  },
};

const KEYS = Object.keys(ACTED_STAGINGS) as ActedStaging[];
export const isActedStaging = (v: unknown): v is ActedStaging => typeof v === "string" && (KEYS as string[]).includes(v);
const oneLine = (s: unknown): string => (typeof s === "string" ? s : "").replace(/\s+/g, " ").trim();
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** (i) The words a staging adds to the master picture's prompt ("" for none: the picture is drawn as it
 *  always was). */
export const stagingPicture = (staging: unknown): string => (isActedStaging(staging) ? `${ACTED_STAGINGS[staging].picture} ${FACES}` : "");
/** (ii) The words it adds to a clip's prompt about how the two move ("" for none). */
export const stagingClip = (staging: unknown): string => (isActedStaging(staging) ? ACTED_STAGINGS[staging].clip : "");

/** Does a place have no room to stage two people in (the inside of a car)? */
export const noRoomIn = (where: string | null | undefined, scene: string | null | undefined = ""): boolean => NO_ROOM.test(`${oneLine(where)} . ${oneLine(scene)}`);

/** The stagings that fit one location: by the frame, and by the words of the place and of the first scene
 *  set there. Never empty — NEAR AND FAR and TWO LEVELS fit anywhere there is room to stand. */
export function stagingsFor(place: { where?: string | null; scene?: string | null }, aspect?: string): ActedStaging[] {
  const where = oneLine(place.where);
  const scene = oneLine(place.scene);
  const fit = KEYS.filter((k) => {
    const s = ACTED_STAGINGS[k];
    if (s.wide && aspect !== "16:9") return false;
    // (what somebody DOES is in the scene's words; what the place HAS may be in either)
    return !s.needs || s.needs.test(k === "across" ? `${where} . ${scene}` : scene);
  });
  const claimed = fit.filter((k) => ACTED_STAGINGS[k].claims?.test(scene));
  return claimed.length ? claimed : fit;
}

/** THE DEAL — one staging for each LOCATION of a film, in the order the film first visits them, no two
 *  neighbours alike. `where` is the place as the script names it, `scene` the words of the first scene set
 *  there. A location that already HAS its picture (a film picked up after a restart) keeps what that picture
 *  was drawn with (`has`: a staging, or null). A place with no room to stage anybody gets null — its picture
 *  is drawn as it always was. `rand` is a 0–1 source (Math.random, or a fixed one in a test). */
export function dealStagings(
  places: ReadonlyArray<{ where?: string | null; scene?: string | null; has?: ActedStaging | null }>,
  o: { aspect?: string; rand?: () => number } = {},
): Array<ActedStaging | null> {
  const rand = o.rand || Math.random;
  const pick = <T,>(a: T[]): T => a[Math.min(a.length - 1, Math.max(0, Math.floor(rand() * a.length)))];
  const out: Array<ActedStaging | null> = [];
  (places || []).slice(0, 24).forEach((p, i) => {
    if (p.has !== undefined) { out.push(isActedStaging(p.has) ? p.has : null); return; }
    if (noRoomIn(p.where, p.scene)) { out.push(null); return; }
    const before = i > 0 ? out[i - 1] : null;
    const after = places[i + 1]?.has ?? null;
    const fit = stagingsFor(p, o.aspect);
    const both = fit.filter((k) => k !== before && k !== after);
    const one = fit.filter((k) => k !== before);
    // (what the scene's own words call for is used even beside a neighbour staged the same way — only when
    //  NOTHING else fits it, which is a film that walks through two places running)
    out.push(pick(both.length ? both : one.length ? one : fit));
  });
  return out;
}

/* ---- THE PICTURE ---- */

/** What the master picture is told about hands (it used to be told they are "empty, relaxed and still"). */
const HANDS = "Hands are empty unless the moment puts something in them — then that ONE thing is drawn clearly, once, held naturally (never multiplied, floating or morphing); do NOT add a cigarette, glass, phone or any other small prop of your own.";

/** The whole prompt of a location's master picture when it has a staging — the staging's words in place of
 *  "chest up … fairly close … standing CLOSE together … faces three-quarters toward the camera", and the
 *  scene's own moment IN the picture (it used to be told "the framing wins"). Everything that binds a cast
 *  member to their reference picture is passed in and kept as it is. "" when `staging` is not one — the
 *  caller then draws the picture as it always did. */
/** TODAY'S WORLD AND A LIVED-IN HOME — AND A SHADOW DRAWN AS ONE — in an acted film's pictures too (a photographed
 *  film only). The told stories were given these on 2026-11-25 after the owner asked "why are the walls dingy and
 *  not just a regular household? why the train station guy appearing outside of the window"; an acted film is
 *  drawn from the same kind of words, with the same horror look, and had neither (story-picture.ts). */
/** (…and a genre whose world is its OWN — Fantasy, film-genres.ts → ownWorld — is told everybody is clothed and NOT
 *  that its places look the way they look today: "no cottage and no castle unless they name one" drew a fantasy as a
 *  modern flat. Found by the genres stream, 2026-11-25; the told stories choose it the same way.) */
export function actedRealism(cartoon: boolean | undefined, moment: string | null | undefined, setting?: string | null, ownWorld?: boolean): string {
  if (cartoon) return "";
  const night = NIGHT_WORDS.test(`${setting || ""} ${moment || ""}`) ? ` ${NIGHT_LINE}` : "";
  return ` ${ownWorld ? DRESSED : TODAY_LOOK}${shadowNote(String(moment || "")) ? ` ${SHADOW_SHAPE}` : ""} ${NOTHING_GLOWS}${night}`;
}
/** NIGHT IS NIGHT (2026-11-25): both acted lake films — "wake at 3am" — were lit like a blue dusk, the lake bright
 *  behind the tent. Said when the place or the moment says it is night. */
const NIGHT_WORDS = /\b(?:night|nighttime|midnight|3\s?am|2\s?am|4\s?am|three in the morning|after dark|pitch[- ]dark|pitch black|moonlight|moonlit)\b/i;
export const NIGHT_LINE = "It is the middle of the night: the sky outside is black, and the only light is what is really there — a lamp, a torch, a phone, the moon — never dusk, twilight or a blue evening glow.";
/** A NIGHT FILM'S PLACES ARE AT NIGHT (2026-11-25, "She Smiles From the Shallows": its idea said "3am", its first shot's
 *  words did not — "inside the tent" — and the tent was drawn at dusk, the lake blue in the evening light). A place whose
 *  own words, and whose shot's, name no time of day is told the idea's night. */
const DAY_WORDS = /\b(?:morning|dawn|sunrise|noon|midday|afternoon|daylight|daytime|sunset|dusk|evening|golden hour|sunlit|sunny)\b/i;
export function nightSetting(setting: string, idea: string | null | undefined, shot?: string | null): string {
  const s = String(setting || "");
  if (!NIGHT_WORDS.test(String(idea || "")) || NIGHT_WORDS.test(`${s} ${shot || ""}`) || DAY_WORDS.test(`${s} ${shot || ""}`)) return s;
  return `${s}, in the middle of the night`;
}
/** NOTHING GLOWS THAT IS NOT A LIGHT (2026-11-25, "Who Calls From the Shallows": the woman standing in the lake was
 *  drawn lit from inside like a lamp — a ghost's glow, in a film that is meant to look photographed). */
export const NOTHING_GLOWS = "Nothing in the picture glows unless it is a light — a lamp, a torch, a screen, the moon: a pale figure is lit only by the lights that are there, never from within.";

export function stagedTwoShot(o: {
  staging: unknown;
  cartoon?: boolean;
  /** the place, already tidied */
  setting: string;
  /** each of the two, as the picture model is told who they are */
  personA: string;
  personB: string;
  /** the first scene set here, in its own words */
  act?: string;
  /** how the people look, where the format has a say */
  mood?: string;
  /** the keep-them-distinct note (a person, a cartoon, a creature) */
  consistency: string;
  /** " The FIRST reference image shows ONLY the room…" — or "" */
  roomNote?: string;
  /** " WHO IS WHO: …" — or "" */
  faceNote?: string;
  /** " THE ONE THEY FEAR: reference image N is …" (thingBound) — the film's thing, where this moment has it in view; or "" */
  thingNote?: string;
  /** "vertical composition" … */
  comp: string;
  /** a genre whose world is its own (Fantasy): clothed, never "today" — actedRealism */
  ownWorld?: boolean;
}): string {
  const stage = stagingPicture(o.staging);
  if (!stage) return "";
  const lead = o.cartoon
    ? "A single frame from a bright, glossy 3D-animated CARTOON film (modern wholesome preschool-cartoon look: rounded friendly character designs, big expressive eyes, soft candy colors)"
    : "A single photorealistic frame from a live-action film";
  const act = oneLine(o.act).replace(/[\s.!?;,]+$/, "");
  const mood = oneLine(o.mood);
  // (a moment that is a sound from out of sight: told to put everything the moment names IN the picture, the
  //  picture model draws whoever is making it — a hand knocking. A picture cannot hold a sound.)
  const heardHere = act ? heardIn(act, [o.personA, o.personB].map((p) => (oneLine(p).split(/[,—–(:]/)[0] || "").trim())) : null;
  const unheard = heardHere?.unseen ? ` ${HEARD_NOT_DRAWN}` : "";
  // (…and NO sound is drawn, from out of sight or not — the knocked window came back with a glowing ring on it; and
  //  what the moment is about — a window, a door — is at the side, so that looking at it keeps their faces to us)
  const soundless = heardHere ? ` ${SOUND_NOT_DRAWN}` : "";
  const eyeline = act && !o.cartoon ? lookAtPicture(lookTarget(act)) : "";
  const moment = act
    ? ` THE MOMENT this frame is taken at: ${act} — everything it names (what somebody holds, what is being done, what is in the place) is IN the picture, seen the way the moment says it is seen, and well above the picture's bottom edge.${unheard}${soundless}${eyeline ? ` ${eyeline}` : ""} Draw the instant it BEGINS, before it is done, so that it can happen in the seconds that follow: ONE picture of ONE instant — never a split screen, panels or a before-and-after. Where the moment says how somebody is placed (standing, sitting, crouching, walking), the moment decides; the distance between the two, the camera and their faces stay as described above.`
    : "";
  const tail = o.cartoon
    ? `Clean cheerful cartoon lighting, soft candy colors, rounded friendly shapes, ${o.comp}, no on-screen text, no watermark.`
    : `Cinematic filmic lighting, both of them in sharp focus, ${o.comp}, no on-screen text, no watermark.`;
  // (two who are RELATED, drawn from words alone, are told so — and their ages — in the picture of the two of
  //  them: kinNote. Anybody bound to a reference picture is drawn from it, and nothing is said about them here.)
  const kin = o.faceNote ? "" : kinNote(o.personA, o.personB);
  return `${lead}: BOTH people together in ${o.setting}, in the middle of a scene. ${stage} ${o.personA} on one side and ${o.personB} on the other, both faces prominent and in focus — each in their own half of the frame, never one directly in front of the other.${kin ? ` ${kin}` : ""} This is NOT an over-the-shoulder shot: neither person is turned fully away, cropped out, or blurred in the foreground; both are equally sharp. Both are in the SAME space — NOT separated by any window, glass pane, partition, railing, counter, doorway or divider BETWEEN them; if the setting has a window it stays in the BACKGROUND behind or beside them, never between them and never splitting the frame down the middle. Nothing is added to the place that does not belong in it — no table, booth or chairs on a street, in a hallway or outdoors.${moment}${mood ? ` ${mood}` : ""}${actedRealism(o.cartoon, act, o.setting, o.ownWorld)} ${o.consistency} ${HANDS}${o.roomNote || ""}${o.faceNote || ""}${o.thingNote || ""} ${tail}`;
}

/* ---- THE CLIP ---- */

/** The standing rules of a clip prompt, as clip-prompt.ts makes them (the same shape, so the two fit). */
export type ClipNotes = { look: string; lookTight: string; lookShort: string; style: string; steady: string; noText: string };

/** No more of a scene's words than this are said to the video engine (its prompt is 2,500 characters, and
 *  the talking directions take about 1,500 of them). */
export const EVENT_MAX = 170;
/** …and of a film's LAST scene, which may be written longer (a horror film's last shot says what is seen
 *  and what it does): the prompt builder then gives up more of the standing note to make the room. */
export const EVENT_MAX_LAST = 240;

/** A scene's own words as ONE line the engine can be told: nothing in double quotes (the engine SPEAKS what
 *  is quoted), and — when it is longer than a shot's sentence should be — cut at the end of a sentence, else
 *  of a clause, else of a word, never ending on "and" or "the". */
export function clipEvent(visual: string | null | undefined, max = EVENT_MAX): string {
  let s = oneLine(String(visual || "").replace(/["“”«»]/g, ""));
  if (!s) return "";
  if (s.length > max) {
    const cut = s.slice(0, max + 1);
    const last = (marks: string[]): number => Math.max(...marks.map((m) => cut.lastIndexOf(m)));
    const sentence = last([". ", "; ", " — "]);
    const clause = last([", ", " while ", " as ", " and "]);
    const space = cut.lastIndexOf(" ");
    s = cut.slice(0, sentence >= max * 0.5 ? sentence : clause >= max * 0.6 ? clause : space > 0 ? space : max);
    for (let k = 0; k < 3; k++) s = s.replace(/[\s,;:—–-]+$/, "").replace(/\s+(?:the|a|an|and|or|of|to|with|while|as|in|on|at|by|from|into|her|his|their|its)$/i, "");
  }
  s = s.replace(/[\s,;:—–-]+$/, "").replace(/[.!?]+$/, "");
  return s ? `${s}.` : "";
}

/** WHICH SCENES' WORDS ARE SOMETHING HAPPENING. The words of scene `i` as its clip is told them — or "" when
 *  they are not a thing that happens in that shot:
 *    · they are only the place's own name (a scene the maker adds by hand in the storyboard starts as
 *      "A new location", and a place given a new backdrop takes the backdrop's words);
 *    · they are the same words as an earlier scene in the same place (a beat added by hand starts as a copy
 *      of its place's first scene — and a door is not pulled open twice).
 *  `visuals`, `places` (the key of the location each scene is in) and `wheres` are one entry per scene. */
export function sceneEvent(visuals: ReadonlyArray<string | null | undefined>, places: ReadonlyArray<string>, wheres: ReadonlyArray<string | null | undefined>, i: number): string {
  const bare = (s: unknown): string => oneLine(s).toLowerCase().replace(/[\s.!?]+$/, "");
  const v = oneLine(visuals[i]);
  if (!v || bare(v) === bare(wheres[i])) return "";
  for (let j = 0; j < i; j++) if (places[j] === places[i] && bare(visuals[j]) === bare(v)) return "";
  return v;
}

/** Where a look-note starts telling everybody to hold still (clip-prompt.ts → clipRules). What comes before
 *  it — who everybody is, and that nobody changes — is kept word for word; a staged shot says the rest itself. */
const HOLDS = /(?:;\s*)?(?:The speakers hold their places|[Nn]obody moves except)/;
const CAMERA_LOCKED = "The camera stays LOCKED and level";
/** How the one thing that happens in a shot is introduced to the engine. */
const EVENT_LEAD = "As the line is spoken, this happens once:";

/** Is something DONE in this shot — was its clip told an event, or a walk, or does it open on a sound?
 *  (Read off the prompt the shot was rendered from, so a shot rolled again later is treated the way it was
 *  the first time.) The cut that takes a long pause out of the MIDDLE of a take was made for two people
 *  standing still, where it cannot be seen; in a shot where somebody is moving it would make them jump —
 *  and in one that opens on a sound it would close the gaps between three slow knocks — so such a shot
 *  keeps its pause. */
export const clipMoves = (prompt: string | null | undefined): boolean => {
  const p = String(prompt || "");
  return p.includes(EVENT_LEAD) || p.includes(ACTED_STAGINGS.walk.clip) || p.includes(HEARD_MARK);
};
const lockOf = (note: string): string => {
  const m = HOLDS.exec(note);
  const kept = (m ? note.slice(0, m.index) : note).trim().replace(/[;,]+$/, "");
  return /[.!?]$/.test(kept) ? kept : `${kept}.`;
};

/** (ii) THE CLIP'S RULES IN A STAGING. The look-note of a clip used to end "The speakers hold their places —
 *  only natural talking…": in its place the staging's own words about movement, and — when the scene is
 *  written as something that happens — THE ONE THING THAT HAPPENS, in the scene's own words and nobody
 *  else's. Three sizes, as before, so the prompt builder can still step down when a line is long; the event
 *  is in every one of them. `others` = who is on which side of the frame, for anybody the talking directions
 *  did not already place (said only when the event names them); `eventMax` = how much of the scene's words
 *  is said (EVENT_MAX unless told). Not a staging → the rules as they came.
 *  `heard` = THE SHOT OPENS ON A SOUND (heardIn, below): the scene's words lead the whole prompt instead
 *  (heardTalk), so the note says only what follows them, and the sound rule lets that sound be heard.
 *  `reveal` = a horror film's last shot: what is seen in it moves SLOWLY and the two FREEZE (REVEAL_MOVES,
 *  REVEAL_REACT); `drawn` = …whose thing this film drew into its picture (revealPicture): the clip is told what
 *  is in that picture and the one small thing it does in place (revealClip) INSTEAD of the scene's words, the
 *  two stay where they are and the camera does not move; `implied` = …whose thing could not be drawn into its
 *  picture: the scene's words are not said at all, and the two react to something never seen
 *  (REVEAL_UNSEEN_REACT). */
export function stagedRules<T extends ClipNotes>(base: T, o: { staging?: unknown; event?: string | null; eventMax?: number; others?: ReadonlyArray<{ name: string; side: string }>; heard?: boolean; reveal?: boolean; drawn?: boolean; creature?: boolean; outdoors?: boolean; seen?: boolean; implied?: boolean; /** a SIGHTING this film drew into its picture (sightingOf): what is seen is told to be there, far off, and does what the words say, slowly — sightingClip */ sighted?: boolean; /** …who it is, as the words call it */ sight?: string | null; /** …only its SHADOW on the shut tent's cloth (sightingClip) */ shadow?: boolean; /** the drawn reveal is OUTSIDE, in the cloth (revealClip) */ cloth?: boolean }): T {
  if (!isActedStaging(o.staging)) return base;
  const spec = ACTED_STAGINGS[o.staging];
  if (o.implied) {
    return {
      ...base,
      look: `${lockOf(base.look)} ${spec.clip} ${REVEAL_UNSEEN_REACT}`,
      lookTight: `${lockOf(base.lookTight)} ${spec.clip} ${REVEAL_UNSEEN_REACT}`,
      lookShort: `${lockOf(base.lookShort)} ${REVEAL_UNSEEN_REACT}`,
      steady: spec.camera ? base.steady.replace(CAMERA_LOCKED, spec.camera) : base.steady,
    };
  }
  const said = clipEvent(o.event, o.eventMax && o.eventMax > 0 ? o.eventMax : EVENT_MAX);
  const drawn = !!o.reveal && !!o.drawn && !!said;
  // (A SIGHTING — sightingOf: what is seen is in the picture, far off; the two stay where they are and the camera does
  //  not travel away from it. Never also a sound the shot opens on: "nobody else appears" would be untrue.)
  const sighted = !drawn && !!o.sighted && !!said;
  const event = drawn ? revealClip(said, { creature: o.creature, outdoors: o.outdoors, seen: o.seen, cloth: o.cloth }) : sighted ? sightingClip(said, o.sight, o.shadow) : said;
  const heard = !!o.heard && !!event && !drawn && !sighted;
  const who = event && !heard && !drawn
    ? (o.others || []).map((p) => {
        const name = oneLine(p?.name);
        const side = oneLine(p?.side);
        if (!name || !side) return "";
        let said: RegExpExecArray | null = null;
        try { said = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, "iu").exec(event); } catch { /* a name no pattern can be made of is simply not placed */ }
        return said ? `${said[0]} is on the ${side}.` : "";
      }).filter(Boolean).join(" ")
    : "";
  const slow = drawn ? ` ${REVEAL_REACT}` : event && o.reveal ? ` ${REVEAL_MOVES} ${REVEAL_REACT}` : "";
  // (no sound is drawn — SOUND_NOT_SHOWN; and what they talk about, they look at — lookTarget)
  const does = heard ? `${HEARD_AFTER} ${SOUND_NOT_SHOWN}` : event ? `${who ? `${who} ` : ""}${EVENT_LEAD} ${event}${slow}` : "Only natural talking, small gestures and shifts of weight.";
  const target = !drawn && !sighted && event ? lookTarget(event) : "";
  // (in the fullest note only: a long shot steps down to the tighter note first — the picture's own eyeline,
  //  lookAtPicture, has already turned them toward it)
  const eye = target ? ` They look at ${target} when they speak of it, not at the camera.` : "";
  const rest = event ? "Nothing else" : "Nothing";
  const alive = /background stays/.test(base.look) ? " The background stays gently alive." : "";
  // (a drawn reveal — and a sighting: the two stay where they are and the camera does not move — nothing may come
  //  nearer the lens)
  const clip = drawn || sighted ? REVEAL_STAY : spec.clip;
  const travels = drawn || sighted ? undefined : spec.camera;
  // (where the camera travels, what is BEHIND them cannot stay "identical … throughout" — told that, two
  //  people walk on the spot: it is the PLACE that stays the same)
  const lock = (note: string): string => (travels ? lockOf(note).replace(/\bbackground\b/g, "place") : lockOf(note));
  const steady = travels ? base.steady.replace(CAMERA_LOCKED, travels) : base.steady;
  return {
    ...base,
    look: `${lock(base.look)} ${clip}${eye} ${does}${alive} ${rest} new enters and no new object appears; anything held keeps its exact size and shape.`,
    lookTight: `${lock(base.lookTight)} ${clip} ${does} ${rest} new enters; held things keep their size and shape.`,
    lookShort: `${lock(base.lookShort)} ${clip} ${does}`,
    // (told "no music or sound effects", the engine has no leave to make the knock the shot opens on)
    steady: heard ? steady.replace(SPOKEN_AUDIO, HEARD_AUDIO) : steady,
  };
}

/* ---- A SHOT NOBODY SPEAKS IN ----
 *
 * The first free horror script written on the live site after "THE LAST SHOT IS SEEN, NOT SAID" went out
 * (2026-11-24) came back with a last shot that had NO line — and nothing in the pipeline had ever met one:
 * the engine was told to say `""`, the shot was sized by zero words, and every step after it (the listen,
 * the trim to the end of the speech, the voices, the captions) ran on a line that was not there.
 *
 * It is the right ending for a horror film — the owner, of found footage, the same day: "there would need to
 * be some type of exchange at the bare minimum (voice saying \"babe whats wrong\" then boom the scare shot)".
 * An exchange, then a shot in which something is SEEN and nobody talks. So a wordless shot is a real kind of
 * shot, anywhere in any acted film (a maker can also empty a line in the storyboard):
 *
 *   · THE ENGINE IS TOLD NOBODY SPEAKS, and is given no quoted words at all. Learned on this same engine
 *     (take.ts): it speaks ANY quoted text it is handed and moves whatever mouth it can see to it — the
 *     creature's, if that is the one in view; told "NOBODY SPEAKS … no voice at all" with no quotation
 *     anywhere in the prompt, three takes of three came back with no speech and every mouth shut.
 *   · WHAT HAPPENS is still said — in a horror ending it IS the shot — and so is how the two stand.
 *   · ITS LENGTH is a number of seconds, not a count of no words.
 *   · EVERYTHING THAT NEEDS A LINE steps over it: who the film's two speakers are, the voices, the listen
 *     and the speech trims, the captions. */

/** How long a shot nobody speaks in runs, in seconds — the shortest shot the engine makes, the length the
 *  action shot the owner called a banger was, what the Length card counts every shot as, and what the
 *  storyboard's own meter makes of an empty line (speech-meter.ts → clipSecondsFor("")). */
export const SILENT_SHOT_SECONDS = 5;

const LABEL_LEAD = /^\s*[\p{L}][\p{L}\p{N} .'’-]{0,30}:\s*/u;
const LABEL_ANY = /\p{Lu}[\p{L}'’-]{1,20}:/gu;
const ASIDE = /\([^()]*\)|\[[^[\]]*\]|\*[^*]*\*|<[^<>]*>/g;
const NO_LINE = /^(?:none|null|n\/a|no line|no dialogue|no caption|no words|silent|silence|wordless|nobody speaks)\.?$/i;

/** IS NOTHING SAID IN THIS SHOT? A caption with no words in it once the speaker's label and any stage
 *  direction are taken off: "", "DANA:" (a line the maker emptied in the storyboard — its label stays),
 *  "…", "(silence)", "DANA: (gasps)" — or, with no speaker at all, a bare "none" / "no line" / "silence".
 *  ("DANA: None." is a line: somebody says it.) */
export function wordless(caption: unknown): boolean {
  const c = oneLine(caption);
  if (!c) return true;
  const labelled = LABEL_LEAD.test(c);
  const said = oneLine(c.replace(LABEL_LEAD, "").replace(LABEL_ANY, " ").replace(ASIDE, " "));
  if (!/[\p{L}\p{N}]/u.test(said)) return true;
  return !labelled && NO_LINE.test(said);
}

const nameKeyOf = (n: unknown): string => { const w = oneLine(n).toLowerCase().split(/[\s,]+/).filter(Boolean); return w.find((x) => x !== "the") || w[0] || ""; };
const entryNameOf = (e: unknown): string => (oneLine(e).split(/[,:—–(]/)[0] || "").trim();

/** WHO THE FILM'S SPEAKERS ARE — the people its captions name, in the order they first speak (exactly two
 *  makes it a two-hander: one picture of the two per place, each line found its mouth by its side).
 *  `leads[i]` is the speaker shot i's caption names — "" for a line with no name on it, and NULL FOR A SHOT
 *  NOBODY SPEAKS IN, which names nobody and so changes nothing: a film whose last shot is wordless has the
 *  same two as it would without that shot.
 *  One case needs more than the captions: a film in which only ONE of the two ever speaks, because the
 *  other's only shot is the silent one (a two-shot horror film: a line, then the scare) — or in which nobody
 *  speaks at all. The second person is then the other name on the cast list, when the list (the script's
 *  own, else the cast the maker picked — `casts`, tried in turn) is exactly two people and the one who
 *  speaks is one of them. Never guessed otherwise; and never for a film with no wordless shot, which is
 *  read exactly as it always was. */
export function twoOnScreen(leads: ReadonlyArray<string | null | undefined>, ...casts: Array<ReadonlyArray<string | null | undefined> | null | undefined>): string[] {
  const spoken = Array.from(new Set(leads.filter((l): l is string => typeof l === "string" && !!l)));
  const silent = leads.filter((l) => l === null).length;
  if (!silent || spoken.length > 1 || (!spoken.length && silent < leads.length)) return spoken;
  for (const cast of casts) {
    const names = (cast || []).map(entryNameOf).filter(Boolean);
    const keys = names.map(nameKeyOf);
    if (names.length !== 2 || !keys[0] || !keys[1] || keys[0] === keys[1]) continue;
    if (!spoken.length) return names;
    const at = keys.indexOf(nameKeyOf(spoken[0]));
    if (at >= 0) return [spoken[0], names[1 - at]];
  }
  return spoken;
}

/** THE FIRST THING THE ENGINE IS TOLD in a shot nobody speaks in — in place of the talking directions. The
 *  words are the ones that held on this engine (take.ts → takePrompt), and there is NO quotation mark in
 *  them or anywhere else in such a shot's prompt: any quoted text is spoken. */
const SILENT_MARK = "NOBODY SPEAKS in this shot";
export const NOBODY_SPEAKS = `${SILENT_MARK}: no voice, no words, no whisper, no murmur — only the sounds of the place and of what happens in it. Everyone in the picture keeps their mouth closed from the first frame to the last: nobody opens it to speak, and nobody mouths a word.`;
/** …and the last thing it is told about sound, in place of "The ONLY audio is the spoken voice…". */
const SILENT_SOUND = "The only sound is the place itself and what happens in it. No voice at all. No music.";
/** How what happens is introduced in such a shot (there is no line for it to happen "as"). */
const SILENT_EVENT_LEAD = "This happens once, and it is the shot:";

/** Was this prompt a wordless shot's? (Read off the prompt, like clipMoves: a shot rolled again later is
 *  treated the way it was the first time.) Such a take is kept WHOLE: every trim a take goes through looks
 *  for where the speech starts and stops, and with no speech it would take the first sound for the first
 *  word — and cut the quiet before the thing moves, which is the shot. */
export const clipSilent = (prompt: string | null | undefined): boolean => String(prompt || "").includes(SILENT_MARK);

/** A scene's words with nothing in them that could be read as a quotation: no quotation mark of any kind,
 *  and no apostrophe except inside a word ("Dana's", "don't"). */
const unquoted = (s: string): string => s.replace(/["“”«»„‟‹›‘‚‛`´]/g, "").replace(/(?<![\p{L}\p{N}])['’]|['’](?![\p{L}\p{N}])/gu, "");

/** THE CLIP'S RULES FOR A SHOT NOBODY SPEAKS IN. The same look-notes in the same three sizes — who everybody
 *  is and that nobody changes, kept word for word — and then: how the two stand (the staging's own words when
 *  the picture has one; else that everybody holds their place), THE ONE THING THAT HAPPENS in the scene's own
 *  words (with it, a horror ending is its shot; without it the shot is a held, quiet beat), and nothing about
 *  talking anywhere: the style tag loses its "spoken-dialogue audio", the sound rule becomes the place's own
 *  sound and no voice, and the no-text rule no longer mentions spoken words. `sides` = who is on which side
 *  of the frame — no talking directions place anybody in such a shot, so each is said when the event names
 *  them. The prompt is `NOBODY_SPEAKS`, then these (clip-prompt.ts → fitClipPrompt, with no voice timbre).
 *  And, after what happens: `unseen` = it is a sound from out of sight, made by nothing in the picture
 *  (HEARD_UNSEEN); `reveal` = a horror film's last shot, whose thing moves SLOWLY while the two freeze and one
 *  turns to it (REVEAL_MOVES, REVEAL_REACT); `drawn` = …whose thing this film drew into its picture: told what
 *  is in it and the one small thing it does in place (revealClip) INSTEAD of the scene's words — the two stay
 *  where they are, the camera does not move; `implied` = …whose thing could not be drawn into its picture: the
 *  scene's words are not said, and the two react to something never seen (REVEAL_UNSEEN_REACT); `face` = who
 *  must not smile (faceNote) — every one of them in words with no quotation mark in them either. */
export function silentRules<T extends ClipNotes>(base: T, o: { staging?: unknown; event?: string | null; eventMax?: number; sides?: ReadonlyArray<{ name: string; side: string }>; unseen?: boolean; reveal?: boolean; drawn?: boolean; creature?: boolean; outdoors?: boolean; seen?: boolean; implied?: boolean; face?: string | null; /** a SIGHTING this film drew (stagedRules → sighted) */ sighted?: boolean; sight?: string | null; /** …only its SHADOW on the shut tent's cloth; the drawn reveal in the cloth (stagedRules) */ shadow?: boolean; cloth?: boolean } = {}): T {
  const spec = isActedStaging(o.staging) ? ACTED_STAGINGS[o.staging] : null;
  const said = o.implied ? "" : clipEvent(o.event, o.eventMax && o.eventMax > 0 ? o.eventMax : EVENT_MAX);
  const drawn = !!o.reveal && !!o.drawn && !!said;
  const sighted = !drawn && !!o.sighted && !!said;
  const event = drawn ? revealClip(said, { creature: o.creature, outdoors: o.outdoors, seen: o.seen, cloth: o.cloth }) : unquoted(sighted ? sightingClip(said, o.sight, o.shadow) : said);
  const who = event && !drawn
    ? (o.sides || []).map((p) => {
        const name = unquoted(oneLine(p?.name));
        const side = oneLine(p?.side);
        if (!name || !side) return "";
        let said: RegExpExecArray | null = null;
        try { said = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, "iu").exec(event); } catch { /* a name no pattern can be made of is simply not placed */ }
        return said ? `${said[0]} is on the ${side}.` : "";
      }).filter(Boolean).join(" ")
    : "";
  // (a drawn reveal — and a sighting: both stay where they are and the camera does not move — nothing may come nearer
  //  the lens)
  const move = drawn || sighted ? REVEAL_STAY : spec ? spec.clip : "Everybody stays where they are in the picture, faces in view.";
  const after = `${event && o.unseen && !drawn && !sighted ? ` ${HEARD_UNSEEN}` : ""}${drawn ? ` ${REVEAL_REACT}` : event && o.reveal ? ` ${REVEAL_MOVES} ${REVEAL_REACT}` : ""}${o.face ? ` ${unquoted(oneLine(o.face))}` : ""}`;
  const does = event ? `${who ? `${who} ` : ""}${SILENT_EVENT_LEAD} ${event}${after}` : o.implied ? `${REVEAL_UNSEEN_REACT}${after}` : `Only small natural movement: breathing, a look, a shift of weight.${after}`;
  const rest = event ? "Nothing else" : "Nothing";
  const alive = /background stays/.test(base.look) ? " The background stays gently alive." : "";
  const travels = drawn || sighted ? undefined : spec?.camera;
  const lock = (note: string): string => (travels ? lockOf(note).replace(/\bbackground\b/g, "place") : lockOf(note));
  const camera = (travels ? base.steady.replace(CAMERA_LOCKED, travels) : base.steady).replace(/\s*(?:The ONLY audio is|Keep ONLY the sung vocal)[\s\S]*$/, "").trim();
  return {
    ...base,
    look: `${lock(base.look)} ${move} ${does}${alive} ${rest} new enters and no new object appears; anything held keeps its exact size and shape.`,
    lookTight: `${lock(base.lookTight)} ${move} ${does} ${rest} new enters; held things keep their size and shape.`,
    lookShort: `${lock(base.lookShort)} ${move} ${does}`,
    style: base.style.replace(/[,;]\s*clean\b[\s\S]*$/, ".").trim(),
    steady: `${camera} ${SILENT_SOUND}`.trim(),
    noText: base.noText.replace(/\s*never show the spoken words as text;?/, ""),
  };
}

/* ---- A SOUND THEY HEAR ----
 *
 * The owner, 2026-11-24, of a four-shot Horror Film made on the live site (two sisters clearing out their late
 * mother's house hear slow knocking inside the bedroom wall): "Better but flaky, 'tell me you heard that' then
 * the sound plays after - floating hand knocking fast actor says 'it's knocking really slow'". Measured on the
 * film: the knocks are heard at 12 s and 14 s — DURING the line after "Tell me you heard that too", not before
 * it — and in that shot one sister's own hand knocks quickly on the dresser while the other calls it slow and
 * patient. Three rules, said to the writer (HEARD_BEFORE_SAID, below) and to each clip:
 *
 *   (a) A SOUND THEY REACT TO COMES FIRST. A shot whose scene is a sound OPENS on it — heard alone, before
 *       anybody speaks — and its line answers it (heardTalk). Its take is longer by the sound (heardSeconds)
 *       and keeps its head: the trims that cut the quiet before the first word, or play it fast, would cut
 *       the knock away or make it quick (clipHearsFirst — read off the prompt, so a re-rolled shot is trimmed
 *       the same). And its sound rule lets the sound be made: every clip was told "no music or sound
 *       effects", which left the engine leave for nothing but the voice.
 *   (b) WHAT IS HEARD IS NOT SEEN. A sound from out of sight — in a wall, upstairs, behind a door — is made by
 *       nothing in the picture (HEARD_UNSEEN).
 *   (c) WHAT IS SAID ABOUT IT IS WHAT IS HEARD. How it sounds (slow or fast, how many, how loud) is in the
 *       scene's words, which the clip opens on, and the sound is to be made exactly as described.
 *
 * Which scenes are a sound is read off the scene's OWN words (the writer is asked to begin such a scene with
 * the sound), so what the maker reads in the storyboard is what the clip is told. */

/** A word for something HEARD. */
const SOUND_WORD = /^(?:knock(?:s|ed|ing)?|rap(?:s|ping)?|tap(?:s|ping)?|thump(?:s|ing)?|thud(?:s|ding)?|bang(?:s|ing)?|footsteps?|footfalls?|scratch(?:es|ing)?|scrap(?:e|es|ing)|creak(?:s|ing)?|whisper(?:s|ing)?|voices?|cry|cries|scream(?:s|ing)?|shriek(?:s|ing)?|wail(?:s|ing)?|moan(?:s|ing)?|groan(?:s|ing)?|crash(?:es|ing)?|slam(?:s|ming)?|rattl(?:e|es|ing)|rings|ringing|chim(?:e|es|ing)|buzz(?:es|ing)?|hum(?:s|ming)?|laughter|giggl(?:e|es|ing)|music|singing|lullaby|whistl(?:e|es|ing)|bells?|click(?:s|ing)?|howl(?:s|ing)?|growl(?:s|ing)?|sob(?:s|bing)?|breathing|hiss(?:es|ing)?|drip(?:s|ping)?|sounds?|nois(?:e|es)|thunder|echo(?:es)?)$/i;
/** …someone HEARS it. */
const HEARS = /^(?:hear|hears|heard|hearing)$/i;
/** …made by something nobody can see. */
const SOMEONE = /^(?:something|someone|somebody)$/i;
/** …and a word that says who DOES it, before the sound word: then it is something one of them does
 *  ("she knocks", "Dagny knocks", "Ylva's knock"), not something they hear. */
const DOER = /^(?:she|he|they|i|we|you|her|his|their|my|our|your)$/i;
/** …a sound only a living thing makes: when nobody in the scene is said to make it, it comes from out of sight
 *  ("The knocking starts again"). */
const BEING_SOUND = /^(?:knock(?:s|ed|ing)?|rap(?:s|ping)?|tap(?:s|ping)?|thump(?:s|ing)?|thud(?:s|ding)?|bang(?:s|ing)?|footsteps?|footfalls?|scratch(?:es|ing)?|scrap(?:e|es|ing)|whisper(?:s|ing)?|voices?|cry|cries|scream(?:s|ing)?|shriek(?:s|ing)?|wail(?:s|ing)?|moan(?:s|ing)?|groan(?:s|ing)?|laughter|giggl(?:e|es|ing)|singing|lullaby|whistl(?:e|es|ing)|hum(?:s|ming)?|howl(?:s|ing)?|growl(?:s|ing)?|sob(?:s|bing)?|breathing)$/i;
/** …and the thing in the picture that is SEEN making it ("a grey hand knocks on the inside of the door"). */
const SEEN_MAKER = /^(?:hands?|fingers?|knuckles?|fists?|arms?|claws?|nails?|figure|figures|face|faces|mouth|head|woman|man|girl|boy|child|creature)$/i;
/** Where a scene's words break into the things that happen in it. */
const CLAUSE_BREAK = /\s*(?:;|:\s|\.\s|\s[—–]\s|,\s+and\s|,?\s(?:as|while|when|until|before|then)\s|\sand\s(?=(?:a|an|the|one|two|three|four|five|six|several|some|another|more|something|someone|somebody|it)\b))\s*/i;
/** A sound from out of sight: inside, behind or under something, upstairs, overhead, at a closed door — or
 *  where somebody puts an ear to listen. */
const UNSEEN = /\b(?:from|inside|within|behind|beneath|under|underneath|below|above|beyond|through|in)\s+(?:(?:the|a|an|her|his|their|its|our|my|that|this)\s+)?(?:[\p{L}'’-]+\s+){0,2}?(?:walls?|ceiling|floors?|floorboards|attic|basement|cellar|loft|crawl\s?space|closet|cupboard|wardrobe|chimney|vents?|pipes|plaster|wallpaper|panell?ing|boards|box|trunk|chest|coffin|crate|darkness|dark|hallway|hall|stairwell|stairs|door|room|house)\b|\b(?:at|on|against)\s+(?:(?:the|a|an)\s+)?(?:[\p{L}'’-]+\s+){0,2}?(?:door|window)\b|\b(?:above|below|beneath|under|underneath)\s+(?:them|her|him|us|their heads|her head|his head)\b|\bear\s+(?:to|against)\s+(?:(?:the|a)\s+)?(?:[\p{L}'’-]+\s+){0,2}?(?:walls?|plaster|wallpaper|door|floor|floorboards)\b|\b(?:upstairs|downstairs|overhead|ceiling|next door|out of sight|unseen|somewhere)\b/iu;

/** IS THIS SCENE A SOUND THEY HEAR? The scene's own words → the part of them that is the sound, and whether
 *  it comes from out of sight; null when nothing is heard in it. A sound is heard when the words begin with
 *  it ("Three slow knocks from inside the wall; …", "Footsteps cross the ceiling as …"), when somebody
 *  HEARS something, or when something unseen makes it ("as something scratches behind the panel") — never
 *  when it is one of the two doing it ("Dagny knocks on the wall", "Ylva slams the drawer"). It is UNSEEN
 *  when the words put it out of sight (inside, behind or under something, upstairs, at a closed door), say
 *  only that "something" makes it, or it is a sound only a living thing makes and nobody is said to make it
 *  ("The knocking starts again") — never when a thing in the picture is said to make it ("a grey hand knocks
 *  on the inside of the door": that is SEEN), and never when one of the two is also making a sound in that
 *  scene (the clip would be told two things at once: that nobody's hand knocks, and that hers does). `names`
 *  = the people of the film, so that a name at the start of a sentence is known for one. */
export function heardIn(event: string | null | undefined, names: ReadonlyArray<string | null | undefined> = []): { sound: string; unseen: boolean } | null {
  const text = oneLine(String(event || "").replace(/["“”«»]/g, ""));
  if (!text) return null;
  const known = new Set(names.map((n) => oneLine(n).toLowerCase()).filter(Boolean).flatMap((n) => [n, ...n.split(/\s+/)]));
  const bare = (w: string): string => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’]+$/gu, "");
  const nameLike = (w: string, k: number): boolean => {
    const b = bare(w).replace(/['’]s$/i, "");
    return known.has(b.toLowerCase()) || (k > 0 && /^\p{Lu}/u.test(b));
  };
  let heard: { sound: string; unseen: boolean } | null = null;
  let doing = false;
  let seen = false;
  for (const clause of text.split(CLAUSE_BREAK).map((c) => c.trim()).filter(Boolean)) {
    const words = clause.split(/\s+/).map(bare).filter(Boolean);
    // (somebody HEARS it: whatever the clause names after that is heard, not done — "Dagny hears three knocks")
    let found = words.some((w) => HEARS.test(w));
    let unseen = false;
    for (let k = 0; !found && k < words.length; k++) {
      if (!SOUND_WORD.test(words[k])) continue;
      if ((k > 0 && SOMEONE.test(words[k - 1])) || (k > 1 && SOMEONE.test(words[k - 2]) && /^is$/i.test(words[k - 1]))) { found = true; unseen = true; break; }
      const before = words.slice(0, k);
      // ("in a hushed voice", "with a shaking voice" is how somebody speaks, not something heard)
      if (/^voices?$/i.test(words[k]) && before.slice(-3).some((w) => /^(?:in|with)$/i.test(w))) break;
      // …at the head of the words, with nobody before it who could be the one making it
      if (!before.some((w, j) => DOER.test(w) || nameLike(w, j))) {
        if (k < 8) {
          found = true;
          if (before.some((w) => SEEN_MAKER.test(w))) seen = true;
          // (a living thing's sound that nobody in the scene is said to make — "A cry escapes Dagny" is hers)
          else unseen = BEING_SOUND.test(words[k]) && !words.some((w) => known.has(w.replace(/['’]s$/i, "").toLowerCase()));
        }
      } else doing = true;
      break;
    }
    if (found && !heard) heard = { sound: clause.replace(/[\s.,;:!?—–-]+$/, ""), unseen };
  }
  return heard ? { sound: heard.sound, unseen: !doing && !seen && (heard.unseen || UNSEEN.test(text)) } : null;
}

/** How a shot that opens on a sound begins — the first words of its prompt (and how such a prompt is known
 *  again: clipHearsFirst). The scene's own words follow it. */
const HEARD_MARK = "THE SHOT OPENS ON A SOUND";
export const HEARD_OPEN = `${HEARD_MARK}, heard ALONE before anybody says a word:`;
/** (b) — a sound from out of sight is made by nothing in the picture. */
export const HEARD_UNSEEN = "It comes from out of sight, and nothing in the picture makes it — no hand knocks or taps on anything, no mouth moves to it, nobody else appears: the two only HEAR it.";
/** …and what a PICTURE is told of such a moment (a place's master — stagedTwoShot — and a re-anchor drawn at
 *  it): told to put everything the moment names in the picture, the picture model draws whoever makes it. */
export const HEARD_NOT_DRAWN = "What is HEARD in this moment is not drawn: nothing in the picture makes that sound — no hand knocks or taps on anything, and nobody else is there; the two only hear it.";
/** A SOUND IS NEVER DRAWN — from out of sight or not. A boy's three knocks on his own window came back as a
 *  glowing ring on the glass that pulsed with every knock (the owner, 2026-11-24: "there is an orb glowing that
 *  pulses with the knocks in the window"): the window was in the picture, so nothing said the knock was not. */
export const SOUND_NOT_DRAWN = "A sound is never drawn: nothing glows, rings, ripples, flashes, cracks or lights up where it comes from — the glass, the wall and the door look exactly as they would in silence.";
/** …and in a clip, in fewer words (its prompt is short of room). */
export const SOUND_NOT_SHOWN = "Nothing glows, pulses or lights up with the sound.";
/** WHAT THEY TALK ABOUT, THEY LOOK AT. The same film: "both the parent and child are talking about something
 *  outside yet looking towards the camera" — every staging turns both faces to the lens (the lip-sync needs
 *  them), and the window they were talking about stood behind them. So the thing a moment is about is put at the
 *  SIDE of the frame, near the camera: looking at it keeps their faces toward us. */
const LOOK_THING = /\b(?:window|windows|door|doorway|curtain|curtains)\b/i;
export const lookTarget = (moment: string | null | undefined): string => {
  const m = LOOK_THING.exec(oneLine(moment));
  return m ? `the ${m[0].toLowerCase().replace(/(?<=w|n)s$/, "")}` : "";
};
export const lookAtPicture = (target: string): string =>
  target ? `WHAT THEY LOOK AT: ${target} this moment is about is at one SIDE of the frame, near the camera — beside them, never behind them — and both look toward it, turned three-quarters, so their faces stay toward us; nobody looks into the lens.` : "";
/** …and only then the line. */
export const HEARD_THEN = "ONLY AFTER IT does anybody speak, in answer to it.";
/** What the look-note says happens once the sound has been heard (the scene's words lead the prompt). */
const HEARD_AFTER = "After the sound, only natural talking, small gestures and shifts of weight.";
/** The sound rule every spoken clip has (clip-prompt.ts → clipRules)… */
const SPOKEN_AUDIO = "The ONLY audio is the spoken voice and faint room tone — no music or sound effects.";
/** …and, in a shot that opens on a sound, the one it has instead — (c): exactly the sound described. */
export const HEARD_AUDIO = "The ONLY audio is that sound — exactly as described: no faster, no louder and no more of it — and then the spoken voice, over faint room tone; no music and no other sound effects.";
/** How much longer a take that opens on a sound is than its line alone needs (three slow knocks, a second
 *  apart, and the breath after them). */
export const HEARD_FIRST_SECONDS = 2.5;
/** The length of such a take: its line's (speech-meter.ts → clipSecondsFor), and the sound before it — never
 *  more than the longest take a line is given. */
export const heardSeconds = (line: string): number => Math.min(CLIP_MAX_SECONDS, Math.ceil(clipSecondsFor(line) + HEARD_FIRST_SECONDS));
/** Did this prompt open on a sound? (Read off the prompt, like clipMoves.) Such a take keeps its head — the
 *  sound is in it. */
export const clipHearsFirst = (prompt: string | null | undefined): boolean => String(prompt || "").includes(HEARD_MARK);

/** THE TALKING DIRECTIONS OF A SHOT THAT OPENS ON A SOUND. The scene's own words lead — the sound, heard
 *  alone — then that nobody speaks before it, then the line, in fewer words than a talking shot's own
 *  directions but every one of their rules: who speaks (by their side of the frame), the line once, word for
 *  word, nothing repeated or added, how it is delivered, the other one silent, one voice, the same voice as in
 *  every other shot — and "after that sound" where a talking shot says "right away". (Shorter so that the
 *  sound, the line and everybody's look all fit the 2,500 characters the engine reads.) `event` = the scene's
 *  words as the clip is told them (clipEvent); `deliver` = the tone sentence, as built for every shot; `face`
 *  = faceNote; `reply` = a second speaker in the same shot. */
export function heardTalk(t: {
  event: string;
  unseen?: boolean;
  speaker?: string | null;
  side?: string | null;
  line: string;
  other?: string | null;
  otherSide?: string | null;
  deliver: string;
  face?: string | null;
  reply?: { speaker: string; side?: string | null; line: string } | null;
}): string {
  const event = clipEvent(t.event, Math.max(EVENT_MAX_LAST, oneLine(t.event).length));
  const open = `${HEARD_OPEN} ${event}${t.unseen ? ` ${HEARD_UNSEEN}` : ""} ${SOUND_NOT_SHOWN} ${HEARD_THEN}`;
  const deliver = `${oneLine(t.deliver)}${oneLine(t.face) ? ` ${oneLine(t.face)}` : ""}`;
  const speaker = oneLine(t.speaker);
  const side = oneLine(t.side).toLowerCase();
  const other = oneLine(t.other);
  const oSide = oneLine(t.otherSide).toLowerCase();
  const line = oneLine(t.line);
  if (t.reply && oneLine(t.reply.speaker) && oneLine(t.reply.line) && speaker) {
    const b = oneLine(t.reply.speaker);
    const bSide = oneLine(t.reply.side).toLowerCase();
    return `${open} Then a short back-and-forth, ONE person at a time, in accurate lip-sync: FIRST ${speaker}${side ? ` (on the ${side} side of the frame)` : ""} says: "${line}". THEN ${b}${bSide ? ` (on the ${bSide} side)` : ""} replies: "${oneLine(t.reply.line)}". Each says their line exactly ONCE, word for word — no word repeated, echoed or added — and only the one speaking moves their mouth while the other stays silent, listening. Apart from that sound there are exactly TWO voices, ${speaker}'s and then ${b}'s, never overlapping — no third voice, murmur or gibberish. ${deliver}`;
  }
  if (speaker) {
    const listener = other ? `${other}${oSide ? ` (on the ${oSide})` : ""}` : `the other one${oSide ? ` (on the ${oSide})` : ""}`;
    return `${open} ${speaker}${side ? `, the person on the ${side.toUpperCase()} side of the frame,` : ""} says exactly this one line, ONCE, word for word, in accurate lip-sync, and nothing else: "${line}". ${deliver} Every word clear and crisp — no mumbling, and no word repeated, echoed or added; the moment the line is finished, ${speaker} stops and holds a quiet expression. ONLY ${speaker}'s mouth moves: ${listener} is COMPLETELY SILENT the whole time, mouth closed, only listening and reacting. Apart from that sound, ${speaker}'s is the ONLY voice in the clip — no second voice, murmur or gibberish anywhere. Keep ${speaker}'s voice the SAME as in every other shot.`;
  }
  return `${open} Then ONE voice says this line, ONCE, word for word, clearly and in accurate lip-sync: "${line}". ${deliver} The other character is completely silent — mouth closed, only listening. No other voice or murmur anywhere.`;
}

/* ---- NOBODY SMILES AT WHAT FRIGHTENS THEM ----
 * The same film: the older sister SMILED while she said its most frightening line ("it isn't trying to get
 * out. It's holding the wall closed."). Nothing told her face otherwise — the delivery said how the line
 * SOUNDS, and the picture's "nobody smiles" (the format's own face mood) was not said to the clip. */

const FEAR = /\b(?:afraid|scared|fear(?:ful|fully)?|frighten(?:ed|ing)?|terrif(?:ied|ying)|horror|horrif(?:ied|ying)|dread|panic(?:ked|king|ky)?|trembl(?:e|es|ing)|shak(?:y|ing|en)|petrified|alarm(?:ed)?|aghast)\b/i;
const SMILE = /\b(?:smil(?:e|es|ed|ing)|grin(?:s|ned|ning)?|laugh(?:s|ed|ing)?|chuckl(?:e|es|ed|ing)|giggl(?:e|es|ed|ing)|beam(?:s|ed|ing))\b/i;
/** A line said warmly — in a horror film, the calm before it (the owner's film opened on a fond line about old
 *  letters): its face is left to the line. */
const WARM = /\b(?:warm(?:ly|th)?|fond(?:ly|ness)?|cheerful(?:ly)?|happ(?:y|ily)|amused|playful(?:ly)?|teasing(?:ly)?|light-?hearted(?:ly)?|nostalgic(?:ally)?|wistful(?:ly)?|tender(?:ly)?|affectionate(?:ly)?|joking(?:ly)?|relieved|excited(?:ly)?|proud(?:ly)?|reassuring(?:ly)?)\b/i;

/** WHO MUST NOT SMILE IN THIS SHOT, said plainly: in a horror film both of the two, in every shot but one whose
 *  line is said warmly (and its tone says no fear); in any other film the one who says a frightened line (its
 *  TONE says fear). Never when the script makes the smile the horror — a scene whose words have that one smiling
 *  ("Ylva smiles at the wall"), or a tone that says the line is said smiling. "" = nothing to say. It has no
 *  quotation mark in it (it goes into silent shots too). */
export function faceNote(o: { horror?: boolean; tone?: string | null; visual?: string | null; speaker?: string | null; other?: string | null }): string {
  const tone = oneLine(o.tone);
  const visual = oneLine(o.visual);
  const afraid = FEAR.test(tone);
  if (o.horror ? WARM.test(tone) && !afraid : !afraid) return "";
  const smiles = (name: string): boolean => {
    try { return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])[^.;!?,]{0,32}?${SMILE.source}`, "iu").test(visual); } catch { return false; }
  };
  const speaker = oneLine(o.speaker);
  const other = o.horror ? oneLine(o.other) : "";
  const who = [
    speaker && !smiles(speaker) && !SMILE.test(tone) ? speaker : "",
    other && other.toLowerCase() !== speaker.toLowerCase() && !smiles(other) ? other : "",
  ].filter(Boolean);
  if (who.length === 2) return `Neither ${who[0]} nor ${who[1]} smiles at any moment: both faces show fear.`;
  if (who.length === 1) return `${who[0]} does not smile at any moment: the face shows fear.`;
  // (nobody named, in a horror film, and nobody the script makes smile)
  return o.horror && !speaker && !other && !SMILE.test(tone) ? "Nobody smiles at any moment: every face shows fear." : "";
}

/* ---- THE LAST SHOT OF A HORROR FILM: SEEN, IN THE SAME ROOM ----
 * The same film again: its last shot was told "a WHERE of its own", so the film drew a whole new room for it
 * — a different bedroom, reached through a half-second double exposure — and in it a smooth, evenly lit,
 * mannequin-like arm stuck straight out of a hole in the plaster. The owner: "the hands coming out of wall
 * are more odd than actual realism". Now the last shot is in the SAME place as the shot before it (the writer:
 * SEEN_AT_THE_END), and its picture is THAT place's own picture, edited: the same room, camera, light and two
 * people, with the thing added — made by the creature recipe the horror stories are made with, reused here
 * rather than written a third time: photographed, a practical effect (story-picture.ts → CREATURE_REAL), and
 * mostly lost in the dark (take.ts → TAKE_HIDDEN); and as slightly wrong as the scene's own words say (the
 * writer was told WHAT FRIGHTENS: one or two exact wrongnesses). In the clip it moves SLOWLY — "slow is what
 * frightens" (take.ts) — and the cut to it is a straight cut (film-dialogue → assembleTestMovie).
 *
 * THE SECOND LIVE FILM (2026-11-24, the same idea, made on that) had its reveal in the same room, cut straight
 * — and still "odd, not real": an ordinary, smooth, evenly lit, normal-length human arm reaching in from a
 * split in the wallpaper at the very left edge of the frame, and neither sister reacting (one talked to the
 * camera, the other kept packing). Nothing wrong with it had landed, because nothing concrete was asked for —
 * only "slightly WRONG in exactly the ways the moment says", and the moment said none. So the picture is now
 * told, whatever the scene's words: (a) the THING ITSELF, barely seen — a face a hand's width back in a hole
 * broken through the plaster, one eye catching the light; or the tips of long fingers curled over its broken
 * edge — never a whole limb in the light; (b) its wrongness in so many words, for the part of it that shows
 * (REVEAL_PARTS); (c) WHERE it is — close behind one of the two, at the height of a head, in light that has
 * dimmed — never at the edge of the frame; and that the two have frozen. It is drawn on the stronger editor
 * (film-dialogue → nano-banana-pro, flux-kontext-pro when that refuses). And the clip (d): they freeze, then one
 * of them slowly turns to it (REVEAL_REACT) — or, when no picture of it could be drawn, they react to something
 * never seen (REVEAL_UNSEEN_REACT). Every wording was drawn from a frame of that film and LOOKED at.
 *
 * THE THIRD LIVE FILM (knock3, 2026-11-24) had the picture right — at 25.3 s, long pale fingers curled over the
 * edge of a hole broken in the plaster between the two sisters — and the CLIP made it wrong again: over its six
 * seconds the engine pushed the hand out of the hole into a big pale hand reaching toward the camera by 28.6 s,
 * "the odd look again". The clip had been told the scene's own words (written to "it moves a little, it is
 * nearer than it was") and that it "moves SLOWLY"; a hand at the edge of a hole is a hand about to reach, and
 * the engine finished the gesture — toward the lens, where it grew. So now:
 *  · the clip of a reveal that was DRAWN is not told the scene's words at all: it is told what is in its
 *    picture and the ONE small thing it may do, in place (REVEAL_PARTS → clip, moves), and never toward the
 *    camera; the two stay where they are and the camera does not move (silentRules / stagedRules → drawn);
 *  · in a wall it is always a FACE (revealPart): a face held in a hole has nowhere to go — its eye turns, its
 *    head tilts — and one eye open too wide in the dark is frightening without moving at all; in the lab the
 *    face was the most frightening and the most real of the stills. A hand is made to reach;
 *  · the writer is told it happens IN PLACE, never nearer (SEEN_AT_THE_END). */

/** How the thing in a horror film's last shot moves, when what it is was not drawn here (a frame the maker
 *  approved, a last shot in a place of its own): only a little, in place, never toward the camera. */
export const REVEAL_MOVES = "What is seen moves only a little, SLOWLY and IN PLACE — never a jump, a lunge or a reach, never out of where it is, never toward the camera — and it stays solid and real, half in shadow.";
/** …and how the two take it, in the clip: they do not go on packing, and they do not talk to the camera. */
export const REVEAL_REACT = "Both of them FREEZE where they are — whatever their hands were doing stops dead — and then, slowly, one of them turns to look at it and stares; nobody screams, nobody runs, nobody looks at the camera.";
/** …and where they are while it happens, in a reveal that was drawn: where its picture has them (no walking on
 *  toward the camera, as a "walk" staging's clip would say), with the camera still. */
export const REVEAL_STAY = "Both of them stay where they are in the picture, faces in view.";
/** …and when the thing could not be drawn into the picture (the picture models refused it, or the place has no
 *  staged picture to draw it into): the clip is NOT told what it is — a clip told to show a thing that is not in
 *  its picture draws one of its own, and that is the floating hand the owner saw — so the two react to something
 *  we never see. */
export const REVEAL_UNSEEN_REACT = "Something they can see and we never do has stopped them dead: both FREEZE, staring at the same place in the dark beside them, faces drained; then, slowly, one of them backs away a single step. Nothing new appears anywhere in the picture.";
/** How much of the scene's words the picture is told. */
export const REVEAL_MOMENT_MAX = 320;

/** WHAT OF IT IS SEEN, AND WHAT IS WRONG WITH IT — in so many words: in a wall, a face; anywhere else, a figure.
 *  Every wording here was drawn from a frame of the second live film on the real picture models, nine rounds of
 *  it, and LOOKED at (scratchpad t45/acted/reveal-lab): told "a gap", the model cut a flat black shape out of the
 *  picture; told "grey, too many joints", it drew a bony white claw; told "wide, wet eye", a crying woman; told
 *  "between them", it painted over the window. */
const REVEAL_HAND = /\b(?:hand|hands|finger|fingers|fingertips|arm|arms|knuckles?|claws?|nails?|grip|grips|gripping|reach|reaches|reaching)\b/i;
/** A scene whose thing is in a WALL — then it is in a hole broken through real plaster (with thickness: torn
 *  paper, crumbled plaster, splintered lath), not a black shape laid over the picture. (Since 2026-11-24 only
 *  the opening words: a scene that merely MENTIONS a wall — "knocks from the hallway wall" — is not one;
 *  revealPart reads REVEAL_IN_WALL first.) */
const REVEAL_WALL = /\b(?:hole|gap|crack|split|torn)\b/i;
const REVEAL_HOLE = "the plaster has been broken open from inside into a ragged hole: torn wallpaper curling outward, crumbled plaster and splintered wooden lath at its edges, deep black inside";
/** Each form: what the picture is told is SEEN of it, and what is WRONG with it; and what its clip is told is in
 *  the picture (`clip`) and the ONLY thing it may do there (`moves`) — a little, in place, never toward the
 *  camera. (The fingers form — "the tips of four FINGERS curled over its broken lower edge" — drew right and
 *  moved wrong: the third live film's engine made it a big hand reaching at the lens. It is not drawn any more.) */
export const REVEAL_PARTS = {
  /** In a wall: one eye in a hole. */
  face: {
    seen: "a hand's width back inside it, half hidden by its broken edge, is a FACE that is not quite human: only one eye and a sliver of cheek catch the light; the rest is lost in black",
    wrong: "the skin is grey-white like old candle wax and the cheek is sunken; the eye is open far too wide, the white showing all the way round it, and it does not blink",
    clip: "In the hole broken in the wall, back in the dark, is a pale FACE that is not quite human: one eye and a sliver of cheek in the light, the eye open far too wide.",
    moves: "Only its EYE moves: it slides slowly round to look at them, and it never blinks. The face stays exactly where it is, back inside the hole — it never leans out, never pushes through, never grows, and its mouth stays shut. Nothing comes out of the wall, and nothing comes toward the camera.",
  },
  /** …anywhere else (a shape in a corner, something standing in a doorway): a FIGURE, almost all in shadow.
   *  (Told take.ts's TAKE_WRONG — "waxy, bloodless, eyes sunk in dark sockets" — the picture model drew a
   *  zombie.) */
  figure: {
    seen: "a tall FIGURE stands in the dark, almost all of it in shadow; only the pale shape of its face catches the light, a little too high up",
    wrong: "it is too tall and too thin, and perfectly still; its face is grey-white like old candle wax, and one eye is open far too wide — never a zombie, never a skull, never a mask",
    clip: "In the dark behind them stands a tall, thin FIGURE, almost all of it in shadow: only the pale shape of its face in the light, a little too high up.",
    moves: "Only its HEAD moves: it tilts slowly to one side. It never takes a step, never raises its arms, never comes nearer, never grows, and nothing comes toward the camera.",
  },
  /** AT THE DOOR THE KNOCKING CAME FROM — the owner, of a film whose boy ran to his parents' room and then a
   *  werewolf hung half out of its wall (2026-11-24): "monster half way hanging out of the wall. Like what the
   *  fuck is that plot?". A thing that knocks at a door is found at that door: it has eased open on the dark. */
  door: {
    seen: "the door has eased open a hand's width on the dark beyond it; in that gap stands a tall FIGURE, almost all of it in shadow — only the pale shape of its face catches the light, a little too high up",
    wrong: "it is too tall and too thin, and perfectly still; its face is grey-white like old candle wax, and one eye is open far too wide — never a zombie, never a skull, never a mask",
    clip: "The door has eased open a hand's width on the dark: in the gap stands a tall FIGURE, almost all of it in shadow, only the pale shape of its face in the light.",
    moves: "Only its HEAD moves: it tilts slowly to one side. It never steps through, never pushes the door, never reaches, never comes nearer, and nothing comes toward the camera.",
  },
  /** …and one that knocks at a WINDOW is outside it, at the glass — never inside, nothing broken. */
  window: {
    seen: "OUTSIDE the window, close to the dark glass, is a FACE that is not quite human — only its pale shape and one eye catch the light; the glass is whole, between it and the room",
    wrong: "the skin is grey-white like old candle wax and the cheek is sunken; the eye is open far too wide, the white showing all the way round it, and it does not blink",
    clip: "Outside the window, close to the dark glass, is a pale FACE that is not quite human: one eye in the light, open far too wide.",
    moves: "Only its EYE moves: it slides slowly round to look at them, and it never blinks. The face stays OUTSIDE the glass — it never comes through, never breaks it, never grows, and nothing comes toward the camera.",
  },
  /* THROUGH THE CLOTH (2026-11-25, stream S12). Part 1 of the lake films said "a tall shape leans close until only the
   * woman's face presses the fabric", Episode 2 "through the sagging roof fabric, pressed flat from above, the woman's
   * wide crowded smile shows pale through soaked white cloth" — and both reveals drew her STANDING IN THE OPEN DOORWAY
   * between them, Part 1's face glowing like a mask: out of doors every reveal was "a figure close behind them", and in
   * a tent whose door is open that is the doorway. At a tent — and wherever the moment presses on cloth, or the door has
   * been SHUT (place-state.ts) — what is outside stays OUTSIDE: never inside with them, never in an opening that is shut.
   * Its face presses the cloth in; where the words say the roof, the roof sags down toward them. */
  /** …its face, pressed into the tent's wall from outside. */
  fabric: {
    seen: "pressed into the thin cloth from OUTSIDE is the shape of a FACE: the wet fabric stretched tight over its brow, its nose and its open mouth, its features showing pale through the cloth — nothing of it is inside, and nothing of it comes through",
    wrong: "the mouth under the cloth is stretched far too wide, and it is perfectly still",
    clip: "From OUTSIDE, the shape of a face is pressed into the thin cloth, the wet fabric stretched over its features, pale through it.",
    moves: "Only the cloth moves: it presses in a little further, slowly, as the face under it turns toward them. Nothing comes through the cloth, nothing tears, nothing is inside with them, and nothing comes toward the camera.",
  },
  /** …in the ROOF: pressed down from above, the roof sagging toward them. */
  roof: {
    seen: "pressed DOWN into it from OUTSIDE is the shape of a FACE: the sagging wet fabric stretched tight over its brow, its nose and its open mouth, its features showing pale through the cloth — nothing of it is inside, and nothing of it comes through",
    wrong: "the mouth under the cloth is stretched far too wide, and it is perfectly still",
    clip: "Above them, from OUTSIDE, the shape of a face is pressed down into the sagging roof, the wet fabric stretched over its features, pale through the cloth.",
    moves: "Only the cloth moves: the roof sags a little lower, slowly, as the face in it turns toward them. Nothing comes through the cloth, nothing tears, nothing is inside with them, and nothing comes toward the camera.",
  },
  /** …or the ZIPPER of the shut door, drawn up a hand's width from outside: in that gap, its face. */
  zipper: {
    seen: "the zipper of the shut door has been drawn up a hand's width from OUTSIDE: in that narrow dark gap, close to the cloth, is its FACE — only its pale shape and one eye catch the light; the rest of the door stays shut",
    wrong: "the skin is grey-white like old candle wax; the eye is open far too wide, and it does not blink",
    clip: "The zipper of the shut door has been drawn up a hand's width from outside: in the narrow gap, its pale face and one eye.",
    moves: "Only its EYE moves: it slides slowly round to look at them. The zipper stays where it is and the gap grows no wider; the face stays OUTSIDE — it never comes through, never reaches in, never grows, and nothing comes toward the camera.",
  },
} as const;
export type RevealPart = keyof typeof REVEAL_PARTS;
/** IN A WALL only when the thing is IN it — "inside the wall", "a hole in the plaster" — not when a knock merely
 *  sounds "from the hallway wall" while the story's thing is somewhere else. */
const REVEAL_IN_WALL = /\b(?:in|inside|within|behind|through)\s+(?:the\s+|a\s+|its\s+|that\s+|their\s+)?(?:[\p{L}'’-]+\s+){0,2}?(?:wall|walls|plaster|wallpaper)\b|\b(?:hole|crack|split)\s+(?:in|through)\s+(?:the\s+|a\s+)?(?:[\p{L}'’-]+\s+){0,2}?(?:wall|walls|plaster|wallpaper)\b/iu;
const REVEAL_DOOR = /\b(?:door|doors|doorway)\b/i;
const REVEAL_WINDOW = /\b(?:window|windows|windowpane|pane|glass)\b/i;
/** Which of them a scene calls for — WHERE ITS STORY PUTS IT: in a wall (the face — whatever part of it the
 *  scene's words name: a hand at the edge of a hole is a hand about to reach, and the engine finishes the reach)
 *  only when the scene has it IN the wall; at the door it knocked at; outside the window it knocked on; else
 *  standing in the dark of the room. A CREATURE the maker chose (`creature`) is never in a wall: a werewolf's
 *  head through the plaster was the owner's "what the fuck is that plot". */
/** AN OPEN-AIR PLACE — a lake shore, the woods, a campsite, a tent, a road: no plaster to break open, no door to ease
 *  open, no window glass (2026-11-25, the lake film "She Smiles From the Shallows": its last scene said "through the
 *  tent wall", the reveal was told the plaster had been broken open, and the editor built a plastered room on the
 *  shore with a grey ghoul in a hole in it). Judged by whichever kind of place the words name FIRST ("the backyard of
 *  the house" is out of doors; "the kitchen, looking out at the lake" is not), a tent counting as out of doors. */
const OPEN_AIR = /\b(?:lake|lakes|lakeside|lakeshore|shore|shoreline|beach|sea|ocean|river|riverbank|creek|stream|pond|swamp|marsh|bog|woods|forest|trees|clearing|field|fields|meadow|campsite|camp|campground|campfire|tent|tents|trail|path|road|highway|street|alley|yard|backyard|garden|park|parking lot|cemetery|graveyard|dock|pier|jetty|cliff|hill|hillside|mountain|desert|bridge|rooftop|outside|outdoors)\b/i;
const INDOOR = /\b(?:room|bedroom|kitchen|hallway|corridor|basement|cellar|attic|closet|bathroom|living room|lounge|office|apartment|flat|stairs|staircase|stairwell|inside|indoors|interior|cabin|house|home|hospital|ward|church|school|classroom|library|store|shop|bar|diner|restaurant|garage|barn|shed|warehouse|motel|hotel|lobby|elevator)\b/i;
export function openAirPlace(where: string | null | undefined): boolean {
  const w = oneLine(where).toLowerCase().replace(/\b(?:inside|in|into)\s+(?:the|a|their|our|her|his|my)\s+tent\b/g, "tent");
  const out = w.search(OPEN_AIR), inn = w.search(INDOOR);
  return out >= 0 && (inn < 0 || out < inn);
}
/** …AT A TENT (`cloth`: the place is a tent, the moment presses on cloth, or its door was SHUT — place-state.ts →
 *  clothPlace, shutCloth): OUTSIDE — its face in the cloth; in the ROOF where the words say so; in the gap of the shut
 *  door's zipper where the words have the zipper drawn up. */
const CLOTH_ROOF = /\b(?:roof|ceiling|from above|overhead)\b/i;
const CLOTH_ZIPPER = /\b(?:zipper|zip)\b[^.;]{0,60}\b(?:up|open|gap)\b|\bunzip(?:s|ped|ping)?\b/i;
export const revealPart = (moment: string | null | undefined, o: { creature?: boolean; outdoors?: boolean; cloth?: boolean } = {}): RevealPart => {
  const m = oneLine(moment);
  if (o.cloth) return CLOTH_ZIPPER.test(m) ? "zipper" : CLOTH_ROOF.test(m) ? "roof" : "fabric";
  // (out of doors there is no wall, door or window to find it in: it stands in the dark)
  if (o.outdoors) return "figure";
  if (!o.creature && REVEAL_IN_WALL.test(m)) return "face";
  if (REVEAL_DOOR.test(m)) return "door";
  if (REVEAL_WINDOW.test(m)) return "window";
  // (a gap, a crack, a split or a hole that is not a door or a window is in the wall or its paper — the owner's
  //  own wall films said "a gap behind June", "presses into the gap")
  if (!o.creature && REVEAL_WALL.test(m)) return "face";
  return "figure";
};
/** …said of the face when the scene's words name a hand: its words are given to the picture whole, and told
 *  "fingers" the picture model draws fingers. */
const REVEAL_NO_HAND = "only that FACE shows — no hand, no fingers and no arm of it anywhere in the picture";
/** THE CLIP OF A REVEAL THAT WAS DRAWN: what is in its picture, and the one small thing it does there — in place
 *  of the scene's own words, which may say "reaching", "nearer", "pushes out" (no quotation marks: a shot nobody
 *  speaks in has none). */
/** THE ONE THE FILM ALREADY SHOWED, standing in the dark (revealPicture with `seen`): how much of it shows — its own
 *  look is the shot's words that showed it; never the generic figure's "too tall, too thin, candle wax", which drew the
 *  lake film's woman as a grey ghoul. */
const SEEN_FIGURE = "it stands in the dark, almost all of it in shadow; only the pale shape of its face catches the light";
const SEEN_FIGURE_CLIP = "In the dark behind them stands the one this film already showed, almost all of it in shadow: only the pale shape of its face in the light.";
export const revealClip = (moment: string | null | undefined, o: { creature?: boolean; outdoors?: boolean; seen?: boolean; /** at a tent, or a shut cloth door: OUTSIDE, in the cloth (revealPart) */ cloth?: boolean } = {}): string => {
  // (the one the film already showed is a FIGURE that stands — never a face in a hole in a wall: the same placing as
  //  its picture, revealPicture → `known`; at a tent, its face in the cloth, as its picture has it)
  const part = revealPart(moment, { creature: o.creature || o.seen, outdoors: o.outdoors, cloth: o.cloth });
  const p = REVEAL_PARTS[part];
  // (the one the film already showed is drawn as itself, not as "a tall, thin figure": its clip says so)
  return `${o.seen && !o.creature && part === "figure" ? SEEN_FIGURE_CLIP : p.clip} ${p.moves}`;
};
/** The light it is seen in: the place's own, dimmed — the frame that worked was the one in which the light had
 *  gone low; in the place's ordinary light the thing read as stuck onto the picture. */
export const REVEAL_DIM = "The light has dimmed, and deep shadow has crept in around them.";
/** …and that it is real: photographed there, never laid over the picture. */
const REVEAL_REAL = "Real, photographed in this place with the same grain and softness — dim, and easy to miss at first.";

/** THE PICTURE OF A HORROR FILM'S LAST SHOT, asked of the picture model with that place's own picture (its
 *  master) as the one reference image. `moment` = the scene's own words; `sides` = who is on which side of that
 *  picture (the picture model is handed no names: "behind Peggy" means nothing to it unless it is told which
 *  one Peggy is — and the thing goes close behind the one the scene's words put it behind, else the one on the
 *  right); `mood` = the format's face mood (a horror cast does not grin — film-engine → faceMood). "" when
 *  there is no moment to draw. The recipe the horror stories use is said in its own words: photographed, a
 *  practical effect (story-picture.ts → CREATURE_REAL), mostly hidden (take.ts → TAKE_HIDDEN). */
/* THE THING THE FILM HAS ALREADY SHOWN (2026-11-25, "Who Calls From the Shallows"): a woman stood waist-deep in the lake
 * in its third shot — long dark hair, a white dress, smiling — and its last shot, "she" close behind them, came back as
 * a bald grey ghoul's face in a window in the tent wall: the reveal is drawn from the last scene's words alone, and a
 * threat the STORY invented (not a creature the maker chose) has no picture of its own to be drawn from. So the words
 * of the shot that showed it go with it: the latest earlier scene that names the same kind of thing the moment does. */
const THING_WORDS = /\b(?:woman|women|lady|girl|man|men|boy|child|figure|figures|shadow|shadows|ghost|creature|thing|stranger|shape|monster|face)\b/gi;
export function seenBefore(moment: string | null | undefined, earlier: ReadonlyArray<string | null | undefined>): string {
  const m = oneLine(moment).toLowerCase();
  if (!m) return "";
  const want = new Set((m.match(THING_WORDS) || []).map((w) => w.toLowerCase().replace(/s$/, "")));
  if (/\b(?:she|her)\b/.test(m)) ["woman", "lady", "girl"].forEach((w) => want.add(w));
  if (/\b(?:he|him|his)\b/.test(m)) ["man", "boy"].forEach((w) => want.add(w));
  if (!want.size) return "";
  for (let k = earlier.length - 1; k >= 0; k--) {
    const v = oneLine(earlier[k]);
    const words = (v.toLowerCase().match(THING_WORDS) || []).map((w) => w.replace(/s$/, ""));
    if (words.some((w) => want.has(w))) return v.slice(0, 240);
  }
  return "";
}

/** How every edit of a place's own picture begins — the reveal's, and a sighting's (below). */
const KEEP_FRAME = "Edit this photo, a frame from a live-action horror film. Keep the camera and the framing, every window, door and lamp, the furniture and both people exactly as they are, each where they stand, with the same faces, hair and clothes.";
/** …and out of doors, what is NOT added to the place (2026-11-25: a plastered room built on a lake shore). */
const OUT_OF_DOORS = " This is out of doors: nothing is built into the place — no wall, no plaster, no door and no window is added.";
/** PHOTOGRAPHED — CREATURE_REAL's own words, without its "practical-effects creature": said of a thing the film has
 *  already shown as a person-like figure (the woman in the lake). Told it is a creature, the editor drew her as a
 *  grey zombie man in the tent opening ("Who Calls From Still Water", the eighth render of the lake idea, 2026-11-25). */
const caughtAt = CREATURE_REAL.indexOf("caught on");
export const PHOTOGRAPHED = caughtAt > 0 ? `It is PHOTOGRAPHED: ${CREATURE_REAL.slice(caughtAt)}` : CREATURE_REAL;

/** THE SECOND PICTURE AN EDIT IS HANDED OF THE FILM'S THING (2026-11-25, "Who Calls From Still Water": everything right
 *  until the last shot — the woman in a soaked white dress waist-deep in the lake in shot 4 — and the reveal, an edit of
 *  the tent's picture told in WORDS that it is "the SAME one this film already showed", drew a grey zombie man in the
 *  tent opening and a face pressed into the canvas. The owner: "It looked really good till that last scene bro". Words
 *  do not carry a face.) So whatever shows the thing is handed ITS picture and told which figure in it to take:
 *    · "creature" — a creature the maker cast (its kind is "monster" or "cartoon"): the creature in that picture, as
 *      the reveal has always said it;
 *    · "figure"   — the portrait of anything else: a thing the maker cast as a person, and EVERY threat the story
 *      invented (the film draws its portrait — characterKind reads the lake film's smiling woman as a monster, and
 *      told "creature" an editor drew her as a grey zombie man): that exact figure;
 *    · "scene"    — no portrait would draw, so the picture that FIRST showed it (a sighting, or the master of the
 *      place it first stood in), whole: the far-off figure in it, never the two people in it.
 *  `near` = the reveal (close behind them); else a sighting (far off). The editor that takes ONE picture is never told
 *  of a second one (the caller asks it without). */
export type ThingRef = "creature" | "figure" | "scene";
/** The reveal of a thing its place's picture already has far off: one of it, come close — never two. */
export const REVEAL_MOVED = "The one already standing far off in this picture is gone from there: it is this one, now close behind them — there is only ONE of it in the picture.";
/** …and when it has come to the cloth (revealPart "fabric", "roof", "zipper"): never also standing out there. */
export const REVEAL_MOVED_CLOTH = "The one already standing far off in this picture is gone from there: it is this one, now at the cloth — there is only ONE of it in the picture.";
/** `cloth` = the reveal has it OUTSIDE, its face in the cloth (revealPart): its picture lends its FACE, never the whole
 *  of it standing in the tent — the lake films' reveals drew the woman standing in the doorway between them. */
export function thingRefNote(ref: ThingRef | null | undefined, o: { name?: string | null; near?: boolean; seen?: string | null; cloth?: boolean } = {}): string {
  const name = oneLine(o.name);
  const seen = oneLine(o.seen).replace(/"/g, "'").slice(0, 240);
  const where = o.near ? "now close behind them" : "far off";
  if (o.cloth && o.near && ref === "creature") return `What is found is ${name || "it"}: the creature in the SECOND picture — ONLY its face, that exact face, pressing into the cloth from OUTSIDE the way this says; never the whole creature, never inside; everything else in the first picture stays exactly as it is.`;
  if (o.cloth && o.near && (ref === "figure" || ref === "scene")) return `It is the SAME one this film already showed: ONLY the FACE of the ${ref === "scene" ? "far-off figure" : "figure"} in the SECOND picture${ref === "scene" && seen ? ` ("${seen}")` : ""} — that exact face — pressing into the cloth from OUTSIDE; never the whole figure, never inside, and nothing else of the second picture comes with it.`;
  if (ref === "creature") return `What is found is ${name || "it"}: the creature in the SECOND picture — that exact creature, its face, its fur or skin and its colours and whatever it wears — drawn INTO the first picture the way this says${o.near ? "" : ", far off"}; everything else in the first picture stays exactly as it is.`;
  if (ref === "figure") return `It is the SAME one this film already showed: the figure in the SECOND picture — that exact figure, the same face, hair and clothes — ${where}; never a different face or a different creature, and nothing else of the second picture comes with it.`;
  if (ref === "scene") return `It is the SAME one this film already showed: the far-off figure in the SECOND picture${seen ? ` — "${seen}"` : ""} — never the two people in that picture: that exact figure, the same face, hair and clothes, ${where}; never a different face or a different creature, and nothing else of the second picture comes with it.`;
  return "";
}

export function revealPicture(o: { moment: string | null | undefined; mood?: string | null; sides?: ReadonlyArray<{ name: string; side: string }>; /** the thing is a creature the maker chose, drawn from its own picture */ creature?: boolean; /** how the film showed the thing before, in that shot's words (seenBefore) */ seen?: string | null; /** the place is out of doors (openAirPlace) */ outdoors?: boolean; /** the thing's own picture rides along as the SECOND image (thingRefNote) — never said to an editor that takes one picture */ ref?: ThingRef | null; /** …and its name, for a creature */ name?: string | null; /** the place's own picture already has it, far off (REVEAL_MOVED) */ away?: boolean; /** at a tent, a moment pressing on cloth, or a shut cloth door: OUTSIDE, its face in the cloth (revealPart) */ cloth?: boolean; /** …and the place is a tent */ tent?: boolean; /** THE PLACE AS IT NOW IS — what was done to it, in plain sentences (place-state.ts → stateNow): the picture it is drawn into shows it, and it stays so */ state?: string | null }): string {
  const moment = clipEvent(o.moment, REVEAL_MOMENT_MAX);
  if (!moment) return "";
  const mood = oneLine(o.mood);
  const sides = (o.sides || []).map((p) => ({ name: oneLine(p?.name), side: oneLine(p?.side).toLowerCase() })).filter((p) => p.name && (p.side === "left" || p.side === "right"));
  const who = sides.length ? ` ${sides.map((p) => `${p.name} is the one on the ${p.side}`).join("; ")}.` : "";
  const behind = sides.find((p) => { try { return new RegExp(`\\b(?:behind|over)\\s+${escapeRe(p.name)}\\b`, "iu").test(moment); } catch { return false; } })
    || sides.find((p) => p.side === "right") || null;
  const at = behind ? `close behind ${behind.name}, the one on the ${behind.side}` : "close behind one of them";
  // A THING THE FILM ALREADY SHOWED (its words, or its picture) is that same figure, standing — never a face in a hole
  // in the plaster: the eighth lake film's reveal drew "a face pressed into the canvas"
  const ref = o.ref === "creature" || o.ref === "figure" || o.ref === "scene" ? o.ref : null;
  const known = !o.creature && ref !== "creature" && (!!oneLine(o.seen) || !!ref);
  const part = revealPart(moment, { creature: o.creature || known, outdoors: o.outdoors, cloth: o.cloth });
  // (AT A TENT it is OUTSIDE — its face in the tent's wall, or in its roof, or in the gap of the shut door's zipper:
  //  the lake films' reveals stood the woman in the open doorway between them — S12, 2026-11-25)
  const cloth = part === "fabric" || part === "roof" || part === "zipper";
  const wall = o.tent ? "the tent's wall" : "the cloth";
  const where = part === "face"
    ? `In the wall ${at}, at the height of a head — not over a window or a door, well inside the picture — ${REVEAL_HOLE}; `
    : part === "door"
    ? "At the door the two are facing — the one this moment is about, well inside the picture — "
    : part === "window"
    ? "At the window the two are facing — the one this moment is about, well inside the picture — "
    : part === "fabric"
    ? `In ${wall} ${at}, at the height of a head, well inside the picture, `
    : part === "roof"
    ? `In ${o.tent ? "the tent's roof" : "the cloth overhead"}, above them and well inside the picture, `
    : part === "zipper"
    ? `At the shut ${o.tent ? "tent " : ""}door the two are near — well inside the picture — `
    : `In the dark ${at}, well inside the picture, `;
  const only = part === "face" && REVEAL_HAND.test(moment) ? `; ${REVEAL_NO_HAND}` : "";
  // (a creature the maker chose is drawn as ITSELF — its own picture says what it looks like; the "what is wrong"
  //  words are a made-up thing's, and would paint candle-wax skin on a werewolf)
  // (…and a thing the film has ALREADY SHOWN is that same one — its look as that shot's words gave it, never a new one;
  //  and since 2026-11-25 its own PICTURE when the film has one: "that exact figure — the same face, hair and clothes —
  //  now close behind them" — thingRefNote; at the cloth, its FACE only)
  const seen = !known ? ""
    : ref === "figure" || ref === "scene" ? ` ${thingRefNote(ref, { near: true, seen: o.seen, cloth })}`
    : cloth ? ` It is the SAME one this film already showed — "${oneLine(o.seen).replace(/"/g, "'").slice(0, 240)}" — ONLY its face, the same face, pressing into the cloth from OUTSIDE: never the whole of it, never inside.`
    : ` It is the SAME one this film already showed — "${oneLine(o.seen).replace(/"/g, "'").slice(0, 240)}" — the same look, the same hair, the same clothes, only nearer: never a different face or a different creature.`;
  // (…whose look is THOSE words: the generic thing's "too tall, too thin, candle-wax skin" would contradict them — told
  //  both, the editor drew the lake film's woman as a grey ghoul)
  const wrong = o.creature || seen ? "" : ` What is wrong with it: ${REVEAL_PARTS[part].wrong}.`;
  const shows = seen && part === "figure" ? SEEN_FIGURE : REVEAL_PARTS[part].seen;
  // (out of doors nothing is built into the place: no wall, no plaster, no door, no window)
  const open = o.outdoors ? OUT_OF_DOORS : "";
  // (a thing already shown as a person-like figure is PHOTOGRAPHED, never "a practical-effects creature": told that,
  //  the eighth lake film's editor drew the woman as a grey zombie man)
  const real = known ? PHOTOGRAPHED : CREATURE_REAL;
  // (a creature handed over as its own picture: said last, as it always was — film-dialogue used to append it)
  const creatureRef = ref === "creature" ? ` ${thingRefNote("creature", { name: o.name, near: true, cloth })}` : "";
  // (…and where the place's own picture was DRAWN with it far off — its first scene showed it, film-dialogue →
  //  thingInMaster — the one out there is the one that has come close: kept, as "keep everything" says, the place would
  //  have two of it. Review, 2026-11-25: the shore film's reveal is an edit of the shore's picture, the woman already
  //  standing in the lake in it.)
  const moved = o.away ? ` ${cloth ? REVEAL_MOVED_CLOTH : REVEAL_MOVED}` : "";
  // (THE PLACE AS IT NOW IS — S12: the picture this is drawn into is the place after what was done to it, the door
  //  zipped shut; said, so that it stays so. At the cloth it is OUTSIDE: never inside, never in what is shut.)
  const state = oneLine(o.state).slice(0, 420);
  const now = (st: string): string => `${st ? ` The place as it now is, and it stays exactly so: ${st}` : ""}${part === "zipper" ? ` ${CLOTH_OUTSIDE_GAP}` : cloth ? ` ${CLOTH_OUTSIDE}` : ""}`;
  // (…and lit only by the light that is there: Part 1's face glowed in the doorway like a mask — NOTHING_GLOWS)
  // (at the cloth the place's own out-of-doors sentence goes: "OUTSIDE, never inside" says it, and nothing is built)
  const make = (withMood: boolean, st: string, glow: boolean): string => `${KEEP_FRAME}${who} ${REVEAL_DIM} Add one thing — what this moment of the story has in it (its words say WHAT it is and WHERE; never how much of it shows): ${moment} Show it like this, and no more of it: ${where}${shows}${only}.${wrong}${seen}${moved}${cloth ? "" : open}${now(st)} ${DRESSED}${glow ? ` ${NOTHING_GLOWS}` : ""} ${REVEAL_REAL} ${real} ${TAKE_HIDDEN} Both have frozen where they stand, faces drained, and neither looks at the camera.${withMood && mood ? ` ${mood}` : ""} No text anywhere.${creatureRef}`;
  // (inside what both editors read — REVEAL_PICTURE_MAX: the place's state is said in its first sentence only — the door
  //  that is shut — then NOTHING_GLOWS gives way where the thing is not at the cloth (a face in a hole in the plaster is
  //  in the dark already), and the format's face mood last)
  const first = (state.match(/^[^.]*\./) || [state])[0];
  let p = make(true, state, true);
  if (p.length > REVEAL_PICTURE_MAX) p = make(true, first, true);
  if (p.length > REVEAL_PICTURE_MAX && !cloth) p = make(true, first, false);
  if (p.length > REVEAL_PICTURE_MAX) p = make(false, first, cloth);
  return p;
}
/** What a reveal's picture runs to at most — what both editors read (SIGHT_PICTURE_MAX is the same). */
export const REVEAL_PICTURE_MAX = 2400;
/** What the reveal at the cloth is told of where it is NOT. */
export const CLOTH_OUTSIDE = "It is OUTSIDE: never inside with them, never in an opening that is shut.";
/** …and at the zipper's gap: the door is open by that hand's width, and no more. */
export const CLOTH_OUTSIDE_GAP = "It is OUTSIDE: never inside with them; the door stays shut but for that hand's width.";

/* ---- WHEN THEY SEE IT, WE SEE IT: THE SIGHTING ----
 *
 * 2026-11-25, one idea rendered six times ("Two friends camping by a quiet lake wake at 3am to someone softly calling
 * their names from the water. When they shine a flashlight, a woman is standing waist-deep in the lake, perfectly
 * still, smiling — and she starts walking toward their tent."):
 *   · when the WRITER happened to move the two outside for the flashlight shot, the film worked: a new place is a new
 *     master, drawn from that scene's words, with the woman in the water ("Still Water Calls Twice");
 *   · when it kept all five shots inside the tent ("Who Smiles In Still Water"), the woman was NEVER seen. A place's
 *     picture is drawn once, from the FIRST scene set there; every later shot there starts from that picture or from
 *     the last frame of the shot before, and its clip is told "nothing new enters". The writer is told SEEN_WHEN_SEEN
 *     ("the VISUAL of THAT shot shows it"); only the engine can honour it, by DRAWING what a shot newly shows.
 * So a shot whose own words put somebody or something in the picture that is not one of the two who talk — and that
 * the picture it starts from was not drawn with — is a SIGHTING (sightingOf). Its seed is the place's own picture with
 * that one added FAR OFF, beyond the two, half in the dark (sightingPicture); its clip is told it is there and does
 * only what the words say, slowly, staying far off (sightingClip); the cut into it is a straight one (the film cuts to
 * what they see); and the shots after it in that place grow out of it, so what was seen stays seen. Never a sound from
 * out of sight (it is HEARD — HEARD_NOT_DRAWN), never the film's last horror shot (the REVEAL owns that), never a
 * cartoon, never a frame the maker approved. */

/** What a scene's words can put in the picture: somebody (strong), or — only where the words have it standing, moving
 *  or watching — something (weak: "the first thing she can find" is nobody; "a shape stands at the waterline" is). */
const FIGURE_STRONG = /^(?:woman|women|lady|girl|man|men|boy|child|figure|figures|ghost|creature|stranger|monster)$/i;
const FIGURE_WEAK = /^(?:thing|shape|shadow|shadows|face|someone|somebody|something)$/i;
const PRESENCE = /^(?:stands?|standing|stood|waits?|waiting|watch(?:es|ing)?|crouch(?:es|ing)?|rises?|rising|appears?|looms?|lurks?|moves?|moving|walks?|walking|steps?|stepping|drifts?|drifting|hangs?|hanging|sits?|sitting|leans?|leaning|peers?|peering|floats?|floating|wades?|wading|stares?|staring|smiles?|smiling|emerges?|emerging|waves?|waving)$/i;
const POSSESSOR = /^(?:her|his|their|its|my|our|your)$/i;
const IMAGE_OF = /^(?:photo|photos|photograph|photographs|picture|pictures|painting|paintings|drawing|drawings|portrait|portraits|statue|statues|doll|dolls|mannequin|poster|sketch|figurine|carving|reflection)$/i;
const ARTICLE = /^(?:a|an|the|that|this|some|one)$/i;
/** …and a clause that says it is NOT there ("the woman is gone", "the water is empty"). */
const NOT_THERE = /\b(?:gone|vanished|disappear(?:s|ed)?|no longer|nowhere|not there|empty|nobody|no one)\b/i;
/** Which figures are the same KIND of one, so that "the lady" after "a woman" is not a second sighting. */
const nounOf = (w: string): string => { const n = w.toLowerCase(); return n === "women" ? "woman" : n === "men" ? "man" : n.replace(/s$/, ""); };
const groupOf = (n: string): string => (/^(?:woman|lady|girl)$/.test(n) ? "f" : /^(?:man|boy)$/.test(n) ? "m" : n === "child" ? "c" : "any");
/** The words of a moment that are SEEN: a sound from out of sight taken out (heardIn) — "a voice calls their names
 *  from the water" is heard; the woman the light then finds is seen. */
const seenWords = (text: unknown, names: ReadonlyArray<string | null | undefined>): string => {
  const t = oneLine(String(text || "").replace(/["“”«»]/g, ""));
  const h = t ? heardIn(t, names) : null;
  return h?.unseen ? oneLine(t.replace(h.sound, " ")).replace(/^[\s,;:.—–-]+/, "") : t;
};
type Figure = { noun: string; who: string; entry: string };
/** Every figure a scene's (seen) words put in the picture: a cast entry that is neither of the two who talk (by its
 *  name), or a figure word — never one somebody owns ("Mara's face", "her shadow"), never one a speaker's own cast line
 *  makes them ("the woman" in a film whose Mara is "a woman of 28" — an indefinite "a woman" still counts), never in a
 *  clause that says it is gone. */
function figuresIn(text: string, o: { speakers: ReadonlyArray<string | null | undefined>; cast: ReadonlyArray<string | null | undefined> }): Figure[] {
  const t = oneLine(text);
  if (!t) return [];
  const speakerKeys = o.speakers.map((s) => nameKeyOf(s)).filter(Boolean);
  const entries = (o.cast || []).map((e) => oneLine(e)).filter(Boolean);
  const others = entries.filter((e) => !speakerKeys.includes(nameKeyOf(entryNameOf(e))));
  const speakerNouns = new Set(entries.filter((e) => speakerKeys.includes(nameKeyOf(entryNameOf(e)))).flatMap((e) => (e.match(THING_WORDS) || []).map(nounOf)));
  const out: Figure[] = [];
  for (const clause of t.split(CLAUSE_BREAK).map((c) => c.trim()).filter(Boolean)) {
    if (NOT_THERE.test(clause)) continue;
    // a cast entry by its own name ("the woman in the lake")
    for (const e of others) {
      const nm = entryNameOf(e).replace(/^(?:the|a|an)\s+/i, "");
      if (!nm) continue;
      let hit = false;
      try { hit = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(nm)}(?![\\p{L}\\p{N}])`, "iu").test(clause); } catch { /* a name no pattern can be made of is not looked for */ }
      if (hit) out.push({ noun: nounOf((nm.match(THING_WORDS) || [nameKeyOf(nm)])[0]), who: entryNameOf(e), entry: e });
    }
    const words = clause.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’]+$/gu, "")).filter(Boolean);
    for (let k = 0; k < words.length; k++) {
      const w = words[k];
      const strong = FIGURE_STRONG.test(w);
      if (!strong && !FIGURE_WEAK.test(w)) continue;
      const prev = words[k - 1] || "";
      if (POSSESSOR.test(prev) || /['’]s$/i.test(prev)) continue;
      // (a picture OF somebody is nobody in the place: "a photo of a smiling man", "a doll of a little girl")
      if (words.slice(Math.max(0, k - 4), k).some((x) => IMAGE_OF.test(x))) continue;
      // (back to its article: "a pale woman", "the tall figure")
      let a = -1;
      for (let j = k - 1; j >= Math.max(0, k - 3); j--) if (ARTICLE.test(words[j])) { a = j; break; }
      const art = a >= 0 ? words[a].toLowerCase() : "";
      const noun = nounOf(w);
      if (!strong && !words.slice(k + 1, k + 5).some((x) => PRESENCE.test(x))) continue;
      if (art === "the" && speakerNouns.has(noun)) continue;
      out.push({ noun, who: words.slice(a >= 0 ? a : k, k + 1).join(" "), entry: others.find((e) => (entryNameOf(e).match(THING_WORDS) || []).map(nounOf).includes(noun)) || "" });
    }
  }
  return out;
}
/** Is this figure already in a picture whose words had `before`? The same name, the same kind of one ("the lady" after
 *  "a woman"), or — when either of them is only "a figure", "something", "a shape" — anybody at all: two ways of
 *  calling one thing are never drawn as two. */
const alreadyIn = (f: Figure, before: Figure[]): boolean => before.some((b) =>
  (!!f.entry && b.entry === f.entry) || b.noun === f.noun || groupOf(f.noun) === "any" || groupOf(b.noun) === "any" || groupOf(f.noun) === groupOf(b.noun)
  || (groupOf(f.noun) === "c" && /^(?:girl|boy)$/.test(b.noun)) || (groupOf(b.noun) === "c" && /^(?:girl|boy)$/.test(f.noun)));

/** THE FIGURE A SCENE'S WORDS PUT IN VIEW, if any (a sound from out of sight is not one): what a place's picture is
 *  drawn with when its first scene shows the film's thing (film-dialogue → masterFor), and what the first shot that
 *  showed it was. */
export function figureIn(words: string | null | undefined, o: { speakers?: ReadonlyArray<string | null | undefined>; cast?: ReadonlyArray<string | null | undefined> | null; names?: ReadonlyArray<string | null | undefined> } = {}): { who: string; entry: string } | null {
  const speakers = o.speakers || [];
  const cast = o.cast || [];
  const f = figuresIn(seenWords(words, [...speakers, ...(o.names || [])]), { speakers, cast })[0];
  return f ? { who: f.who, entry: f.entry } : null;
}

/** MAY A FIGURE WITH NO CAST LINE OF ITS OWN BE DRAWN AS THE FILM'S THING — from its picture? (Review, 2026-11-25: in
 *  a horror film a figure the script gives no cast line is taken to be its thing, and handed the thing's picture
 *  with "that exact figure — the same face, hair and clothes".) Not when the words make it somebody else: "a man walks
 *  past the tent with a lantern" is no woman in the lake — told both, an editor draws her where the words say a man.
 *  And never a shadow or a shape: a shadow is drawn as a shadow, a featureless black shape (story-picture.ts →
 *  SHADOW_SHAPE), never with a face, hair and clothes. `thing` = the thing's own cast line or name (and look). */
export function couldBeThing(who: string | null | undefined, thing: string | null | undefined): boolean {
  const mine = (oneLine(who).match(THING_WORDS) || []).map(nounOf);
  if (mine.some((n) => n === "shadow" || n === "shape")) return false;
  const sex = (n: string): string => (/^(?:woman|lady|girl)$/.test(n) ? "f" : /^(?:man|boy)$/.test(n) ? "m" : "");
  const a = new Set(mine.map(sex).filter(Boolean));
  const b = new Set((oneLine(thing).match(THING_WORDS) || []).map(nounOf).map(sex).filter(Boolean));
  return !a.size || !b.size || [...a].some((s) => b.has(s));
}

/** THE THING, WHEN THE SCRIPT GAVE IT NO CAST LINE OF ITS OWN (live, 2026-11-25 — the ninth lake film, "She Calls Twice
 *  From the Lake"). WHAT_FRIGHTENS asks the writer for a "cast" entry for a threat the idea names; its writer listed
 *  only the two who talk, storyThreat found nothing, and the film had no thing at all: the woman in the lake was drawn
 *  from words in the shot whose light found her, and the reveal drew a grinning white face, a grey woman and a man
 *  nobody wrote — the eighth film's failure again, on the build made to end it. So the film's thing no longer hangs
 *  on the writer: the first scene whose SEEN words put a figure in view ("a woman stands waist-deep in the lake" — a
 *  sound from out of sight is not one, nor a photo of one, nor one somebody owns) gives it its entry, named where it
 *  stands ("the woman in the lake", never just "the woman": in a film whose two who talk are women, a bare "the
 *  woman" bound to a picture names three people); failing every scene, the maker's own idea. Never a shadow or a shape
 *  (drawn as a shadow, never with a face — couldBeThing), never one of the two who talk, never a figure that has a
 *  cast line of its own (that line is storyThreat's to judge: "Mom" is not the thing). */
const PLACE_PREP = /\b(in|at|on|by|under|behind|beside|near|outside|inside|across|beyond)\s+the\s+([a-z-]+)(?:\s+([a-z-]+))?/gi;
const PLACE_ADJ = /^(?:black|dark|still|cold|open|far|deep|old|empty|shallow|misty|foggy|quiet|pale|grey|gray|dim|wet|frozen|narrow)$/i;
/** Where it STANDS when that is in water — the woman in the lake is "in the lake", wherever the light comes from. */
const IN_WATER = /\b(?:in|into)\s+the\s+(?:(?:black|dark|still|cold|deep|shallow|misty|foggy|quiet|grey|gray|frozen)\s+)?(lake|water|sea|river|pond|pool|shallows|marsh|swamp|reeds|tide|surf|waves)\b/i;
/** The plain figure words, that say nothing of WHO it is — any later word for the same one ("the woman") says more. */
const VAGUE = /^(?:figure|shape|thing|stranger|face|shadow)$/;
export function threatFromWords(o: {
  visuals: ReadonlyArray<string | null | undefined>;
  /** the lines said — a figure the words call "a figure" the two call "a woman" ("there's a woman standing out there") */
  said?: ReadonlyArray<string | null | undefined>;
  idea?: string | null;
  speakers: ReadonlyArray<string | null | undefined>;
  cast?: ReadonlyArray<string | null | undefined> | null;
  names?: ReadonlyArray<string | null | undefined>;
}): { entry: string; name: string; creature: boolean } | null {
  const speakers = o.speakers || [];
  const cast = o.cast || [];
  const names = [...speakers, ...(o.names || [])];
  const figs = (text: string): Figure[] => figuresIn(seenWords(text, names), { speakers, cast }).filter((f) => !f.entry && couldBeThing(f.who, ""));
  // THE FIRST ONE SEEN, in the scenes' own words (else the idea's): its look is drawn from where it is first shown
  const shown = [...(o.visuals || []).map((v) => oneLine(v)), oneLine(o.idea)].filter(Boolean);
  let first: { f: Figure; text: string } | null = null;
  for (const text of shown) { const f = figs(text)[0]; if (f) { first = { f, text }; break; } }
  if (!first) return null;
  // …and what it IS, from every word for the same one — the scenes, the lines, the idea: the most telling word wins
  // ("a pale, motionless figure" in the shot whose light finds her; "the woman" in the next; "a woman standing out
  //  there" in what is said — the ninth lake film: named a "figure", her portrait was drawn as a creature). The words
  //  vote, the maker's own idea twice; a figure first called only "a figure" is never made a man by one line about a
  //  man walking past when everything else says a woman.
  const votes = new Map<string, number>();
  const vote = (t: string, w: number) => { for (const g of figs(t)) if (!VAGUE.test(g.noun) && alreadyIn(g, [first!.f])) votes.set(g.noun, (votes.get(g.noun) || 0) + w); };
  for (const t of (o.visuals || []).map((v) => oneLine(v)).filter(Boolean)) vote(t, 1);
  for (const t of (o.said || []).map((s) => oneLine(s)).filter(Boolean)) vote(t, 1);
  if (oneLine(o.idea)) vote(oneLine(o.idea), 2);
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  const noun = !VAGUE.test(first.f.noun) ? first.f.noun : best ? best[0] : first.f.noun;
  if (!noun) return null;
  // ITS LOOK: only its own words — from the figure on, in the clause that shows it ("a pale, motionless figure,
  // waist-deep, smiling"; never "Yuri switches on the flashlight…": he would be drawn into her portrait). (The figure's
  // words come back without their commas — "a pale motionless figure" — so they are found with any marks between.)
  const findWho = (text: string): { index: number; length: number } | null => {
    const ws = oneLine(first!.f.who).split(/\s+/).filter(Boolean).map(escapeRe);
    if (!ws.length) return null;
    try { const m = new RegExp(`(?<![\\p{L}\\p{N}])${ws.join("[\\s,;:'’\"“”-]+")}(?![\\p{L}\\p{N}])`, "iu").exec(text); return m ? { index: m.index, length: m[0].length } : null; } catch { return null; }
  };
  const sentence = first.text.split(/(?<=[.!?])\s+/).find((s) => !!findWho(s)) || first.text;
  const clause = sentence.split(CLAUSE_BREAK).map((c) => c.trim()).find((c) => !!findWho(c)) || sentence;
  const hit = findWho(clause) || { index: 0, length: 0 };
  const rest = clause.slice(hit.index);
  const look = rest.slice(0, hit.length).replace(/\b(?:figure|shape|thing|stranger)\b/i, noun) + rest.slice(hit.length);
  // WHERE IT STANDS: in the water when any word for it says so; else the place nearest it in the clause that shows
  // it (after it, else before it) — a place takes "the" ("in a soaked nightgown" is what it wears)
  const phrase = (m: RegExpMatchArray): string => `${m[1].toLowerCase()} the ${(m[3] && PLACE_ADJ.test(m[2]) ? `${m[2]} ${m[3]}` : m[2]).toLowerCase()}`;
  const wet = [first.text, oneLine(o.idea)].map((t) => IN_WATER.exec(t)).find(Boolean);
  const afterIt = [...clause.slice(hit.index + hit.length).matchAll(PLACE_PREP)][0];
  const beforeIt = [...clause.slice(0, hit.index).matchAll(PLACE_PREP)].pop();
  const place = wet ? `in the ${wet[1].toLowerCase()}` : afterIt ? phrase(afterIt) : beforeIt ? phrase(beforeIt) : "";
  const name = `the ${noun}${place ? ` ${place}` : ""}`;
  return { entry: `${name}, ${clipEvent(look, 220)}`, name, creature: /^(?:ghost|creature|monster)$/.test(noun) };
}

/** What a sighting is: who is newly seen (as the words call them), their cast line when the story has one, and the
 *  words that show them (a sound from out of sight taken out) — what the sighting's picture is drawn from, and what is
 *  kept of it for the reveal. */
export type Sighting = { who: string; entry: string; words: string };
/** IS THIS SHOT A SIGHTING? `moment` / `visual` = the shot's own words (its event, else its visual); `startedFrom` =
 *  the words of the scene(s) the picture it would start from was drawn from (its place's first scene, and any sighting
 *  in that place since the film came to it); `speakers` = the two who talk; `cast` = the script's cast lines; `names` =
 *  everybody else of the film (for heardIn). Null when nothing new is seen — and always for the film's last horror
 *  shot (`last`), a cartoon, and a frame the maker approved. */
export function sightingOf(o: {
  moment?: string | null; visual?: string | null;
  startedFrom?: ReadonlyArray<string | null | undefined>;
  speakers?: ReadonlyArray<string | null | undefined>;
  cast?: ReadonlyArray<string | null | undefined> | null;
  names?: ReadonlyArray<string | null | undefined>;
  last?: boolean; cartoon?: boolean; approved?: boolean;
}): Sighting | null {
  if (o.last || o.cartoon || o.approved) return null;
  const speakers = (o.speakers || []).filter((s): s is string => !!oneLine(s));
  const cast = (o.cast || []).map(oneLine).filter(Boolean);
  // (the PEOPLE of the film, by their names, for heardIn — never a cast line's "the woman in the lake": its "the" and its
  //  "lake" would read every sentence about the lake as somebody named in it)
  const names = [...speakers, ...(o.names || [])];
  const words = seenWords(oneLine(o.moment) || oneLine(o.visual), names);
  if (!words) return null;
  const found = figuresIn(words, { speakers, cast });
  if (!found.length) return null;
  const before = (o.startedFrom || []).flatMap((s) => figuresIn(seenWords(s, names), { speakers, cast }));
  const fresh = found.find((f) => !alreadyIn(f, before));
  return fresh ? { who: fresh.who, entry: fresh.entry, words: clipEvent(words, REVEAL_MOMENT_MAX) } : null;
}

/** Where a sighting puts what is seen, and how the two take it — in the picture. */
const SIGHT_FAR = "FAR OFF beyond the two of them: deep in the picture, small in the frame and half in the dark, seen past them — never between them and the camera, never nearer than these words put it, and well inside the picture";
const SIGHT_TURN = "Both of them stay where they stand; only their heads have turned toward it, three-quarters, so their faces stay in view — neither looks at the camera.";
/** …and WHILE THE TENT IS SHUT (2026-11-25, S12 — place-state.ts → shutCloth): nothing is seen THROUGH a shut door. What
 *  they see of it is its SHADOW, thrown on the cloth from outside by the light out there — the moon, a torch. */
export const SIGHT_SHADOW = "ONLY ITS SHADOW: thrown from OUTSIDE onto the thin cloth wall behind them by the light out there — a tall dark shape on the cloth, soft at its edges, as big as somebody standing close outside; nothing of it is inside, the shut door stays exactly as it is, and nothing is seen through it";
/** THE PICTURE OF A SIGHTING: the shot's starting picture (its place's own) with what the moment newly shows added
 *  WHERE ITS WORDS PUT IT — far off, beyond the two, half in the dark — the two turned toward it. Its look is its own
 *  cast line, or the words of the shot that first showed it (`seen`); with its own picture as the SECOND image (`ref`,
 *  never said to an editor that takes one picture) it is that exact figure. Clothed (DRESSED, and a moment that puts it
 *  in water dressed in the same sentence — dressedInWater), lit only by the lights there (NOTHING_GLOWS), photographed
 *  (CREATURE_REAL for a creature, else PHOTOGRAPHED), mostly hidden (TAKE_HIDDEN); out of doors nothing is built into
 *  the place. The reveal's own words wherever it is the same idea. "" when there is no moment. */
export function sightingPicture(o: { moment: string | null | undefined; sides?: ReadonlyArray<{ name: string; side: string }>; seen?: string | null; outdoors?: boolean; mood?: string | null; creature?: boolean; ref?: ThingRef | null; name?: string | null; /** the tent's door is SHUT (place-state.ts → shutCloth): only its SHADOW on the cloth — SIGHT_SHADOW */ shadow?: boolean; /** the place as it now is (place-state.ts → stateNow) */ state?: string | null }): string {
  const moment = clipEvent(o.moment, REVEAL_MOMENT_MAX);
  if (!moment) return "";
  const sides = (o.sides || []).map((p) => ({ name: oneLine(p?.name), side: oneLine(p?.side).toLowerCase() })).filter((p) => p.name && (p.side === "left" || p.side === "right"));
  const who = sides.length ? ` ${sides.map((p) => `${p.name} is the one on the ${p.side}`).join("; ")}.` : "";
  const seen = oneLine(o.seen).replace(/"/g, "'").slice(0, 240);
  // (a shadow has no face: no picture of it rides along, and its look is the SHAPE of what the words say — S12)
  const ref = o.shadow ? null : o.ref === "creature" || o.ref === "figure" || o.ref === "scene" ? o.ref : null;
  // (its look in words only where no picture of it rides along — the picture is the look)
  const look = seen && !ref ? (o.shadow ? ` Whose shadow it is, as this story has it (only its outline shows): "${seen}".` : ` What it looks like, as this story has it: "${seen}".`) : "";
  const refNote = ref ? ` ${thingRefNote(ref, { name: o.name, seen })}` : "";
  const mood = oneLine(o.mood);
  const creature = !!o.creature || ref === "creature";
  const state = oneLine(o.state).slice(0, 420);
  const now = state ? ` The place as it now is, and it stays exactly so: ${state}` : "";
  // (a shadow in the words is drawn as a shadow — the told stories' own sentence, story-picture.ts → SHADOW_SHAPE)
  // (…and WHILE THE TENT IS SHUT nothing is seen through it: what they see is its SHADOW on the cloth — SIGHT_SHADOW)
  const make = (m: string, withMood: boolean) => `${KEEP_FRAME}${who} Add one thing — what the two of them SEE at this moment of the story (its words say WHAT it is and WHERE): ${dressedInWater(m)} Show it like this, and no nearer: ${o.shadow ? SIGHT_SHADOW : SIGHT_FAR}.${shadowNote(m) && !o.shadow ? ` ${SHADOW_SHAPE}` : ""}${look}${refNote}${o.outdoors ? OUT_OF_DOORS : ""}${now} ${SIGHT_TURN}${withMood && mood ? ` ${mood}` : ""} ${DRESSED} ${NOTHING_GLOWS} ${REVEAL_REAL} ${creature ? CREATURE_REAL : PHOTOGRAPHED} ${TAKE_HIDDEN} No text anywhere.`;
  // (inside what both editors read: the format's face mood gives way first, then the moment is said shorter)
  let p = make(moment, true);
  if (p.length > SIGHT_PICTURE_MAX) p = make(moment, false);
  if (p.length > SIGHT_PICTURE_MAX) p = make(clipEvent(moment, Math.max(80, moment.length - (p.length - SIGHT_PICTURE_MAX))), false);
  return p;
}
/** What a sighting's picture may run to — what the reveal's is held under (both editors read it). */
export const SIGHT_PICTURE_MAX = 2400;

/** THE CLIP OF A SIGHTING: what is in its picture, and the ONE thing it does — what the scene's words say it does,
 *  slowed: a few slow steps at most, never running, never reaching, never at the camera, never growing. (No quotation
 *  marks: a shot nobody speaks in has none.) */
export const SIGHT_MOVES = "What they see stays FAR OFF, small and half in the dark: it does only what these words say it does, SLOWLY — a few slow steps at most — never running, never reaching, never coming near the camera and never growing; they look toward it, never at the camera.";
export const sightingClip = (said: string | null | undefined, who?: string | null, shadow?: boolean): string => {
  const s = oneLine(said);
  if (!s) return "";
  const w = oneLine(who).replace(/["“”«»]/g, "");
  // (its SHADOW on the shut tent's cloth — never the scene's own words, which put it out by the water: told them, the
  //  engine draws it there, through a door that is shut — S12)
  if (shadow) return `On the cloth wall behind them, thrown from outside, is the shadow of ${w || "something standing close outside"}. ${SIGHT_SHADOW_MOVES}`;
  return `${w ? `Far off beyond them, already in the picture, is ${w}. ` : ""}${s} ${SIGHT_MOVES}`;
};
export const SIGHT_SHADOW_MOVES = "Only its shadow moves, slowly along the cloth: nothing comes in, the cloth does not tear, the shut door stays shut, nothing is seen through it, and nothing comes toward the camera; they look toward it, never at the camera.";

/* ---- WHAT WAS DONE TO THE PLACE: THE PICTURE OF A CHANGE (2026-11-25, stream S12) ----
 *
 * "they say "close the tent up" then "put the bag in front of the door" but they never actually zipped the tent doors
 * up" — the owner, of the lake films. Each shot of a place started from its master (the moment BEFORE anything was
 * done), from the last frame of a take that never finished the zip, or from a re-anchor of the master: no picture ever
 * showed the door shut, so it was never shut. Now a shot whose scene CHANGES its place (place-state.ts → placeChangeIn)
 * has that change DRAWN: an edit of the shot's own start picture with ONE thing changed — the door zipped shut, the bag
 * wedged against it — and the shot ENDS on it (the video engine's end frame); every later picture there grows out of it. */
/** How a change's edit begins: the reveal's KEEP_FRAME without its "every window, door … exactly as they are" (the door
 *  is what changes) and without "a horror film" (a door is shut in a drama too). */
export const CHANGE_KEEP = "Edit this photo, a frame from a live-action film. Keep the camera and the framing, the light, the furniture and both people exactly as they are, each where they stand, with the same faces, hair and clothes.";
/** THE PICTURE OF A CHANGE — what the edit of the shot's start picture is told: the ONE thing done (its `end`, and what
 *  was put against it), who still has a hand on it (by their side of the picture: an editor is handed no names), what
 *  was already done there and stays so, and that nothing else changes. "" when there is nothing to draw. */
export function changePicture(o: { change: PlaceChange | null | undefined; sides?: ReadonlyArray<{ name: string; side: string }>; /** what was already true there (place-state.ts → stateNow of the state before this shot, without what this changes) */ kept?: string | null; outdoors?: boolean }): string {
  const c = o.change;
  const done = c ? [c.now ? c.end : "", c.also || ""].filter(Boolean).join(" ") : "";
  if (!c || !done) return "";
  const sides = (o.sides || []).map((p) => ({ name: oneLine(p?.name), side: oneLine(p?.side).toLowerCase() })).filter((p) => p.name && (p.side === "left" || p.side === "right"));
  const who = sides.length ? ` ${sides.map((p) => `${p.name} is the one on the ${p.side}`).join("; ")}.` : "";
  // (who did it still has a hand on it — the shot ends with the deed just done, not with hands back in laps)
  const by = c.by ? sides.find((p) => p.name.toLowerCase() === c.by!.toLowerCase()) : null;
  const on = c.now === "shut" && /tent door/i.test(c.what) ? "its zipper pull, low on the shut door" : c.now ? "it" : c.put ? c.put.thing.replace(/^The\b/, "the") : "it";
  const hand = by ? ` ${by.name}, the one on the ${by.side}, still has one hand on ${on}.` : "";
  const kept = oneLine(o.kept).slice(0, 420);
  const before = kept ? ` Already so, and kept exactly so: ${kept}` : "";
  // (the outside a shut door hid is GONE from the picture — said, or the editor paints the cloth half-transparent)
  const hides = c.now === "shut" && /tent door|curtain|blinds|shutters/i.test(c.what) ? " What showed through it before is gone: the closed cloth is all there is to see there." : "";
  return `${CHANGE_KEEP}${who} Change ONE thing — what this moment of the story has DONE to the place: ${done}${hides}${hand}${before} Everything else in the picture stays exactly as it is: nothing is added, nobody else appears, nobody moves.${o.outdoors ? " Nothing is built into the place." : ""} ${NOTHING_GLOWS} One photograph of one instant — never panels or a before-and-after. No text anywhere.`;
}

/* ---- THE FILM'S THING: ONE FACE, KNOWN BEFORE ANYTHING IS FILMED ----
 * The owner, of the eighth lake film, minutes after "It looked really good till that last scene bro": "Monster should
 * be castable also". A creature the maker picked was used only if the writer happened to name it in the LAST scene, and
 * a threat the story invented had no picture at all — each picture of it was drawn from words, and the reveal drew
 * somebody else. So an acted film's thing has ONE picture: the maker's cast threat, or — when the script has one of its
 * own (a cast line that is neither of the two who talk) — a portrait the film draws of it once, before the first shot,
 * on the portrait recipe the told stories use. Everything that shows it is drawn from that picture. */

/** WHICH OF THE SCRIPT'S CAST IS ITS THREAT — a cast line that is neither of the two who talk, and that is a threat:
 *  a creature by its name or its look (story-picture.ts → characterKind: "the ghost lady"), or a figure by its name
 *  ("the woman in the lake", "the pale man", "the figure"). Never somebody with only a name ("Dad", "Mrs. Hale"): the
 *  mother the idea sends away from home is not what stands behind them at the end. Of several, a creature first, then
 *  the one the last scene's words name. */
export function storyThreat(o: { cast?: ReadonlyArray<string | null | undefined> | null; speakers?: ReadonlyArray<string | null | undefined>; last?: string | null }): { entry: string; name: string; creature: boolean } | null {
  const keys = (o.speakers || []).map((s) => nameKeyOf(s)).filter(Boolean);
  const last = oneLine(o.last).toLowerCase();
  const found = (o.cast || []).map(oneLine).filter(Boolean)
    .filter((e) => !keys.includes(nameKeyOf(entryNameOf(e))))
    .map((e) => {
      const c = castEntry(e);
      const creature = characterKind(c.name, c.look || e) === "monster";
      const nouns = (c.name.match(THING_WORDS) || []).map(nounOf);
      const bare = c.name.toLowerCase().replace(/^(?:the|a|an)\s+/, "");
      const named = !!last && (!!bare && last.includes(bare) || nouns.some((n) => new RegExp(`\\b${n}\\b`).test(last)));
      return { entry: e, name: c.name, creature, figure: nouns.length > 0, named };
    })
    .filter((x) => x.creature || x.figure);
  const pick = found.find((x) => x.creature) || found.find((x) => x.named) || found[0];
  return pick ? { entry: pick.entry, name: pick.name, creature: pick.creature } : null;
}

/** THE PORTRAIT of the story's own threat: the told stories' portrait recipe (story-picture.ts → portraitPrompt — a
 *  creature by its name or its look is photographed as a practical effect), its look dressed where it is in water,
 *  and DRESSED and NOTHING_GLOWS said with it. The picture is then LOOKED at for an unclothed figure, as a master is.
 *  (Review, 2026-11-25: a threat whose NAME makes it a person-like figure — "the woman in the lake" — is PHOTOGRAPHED,
 *  never "a practical-effects creature". characterKind reads her "smile far too wide" as a monster, so the recipe
 *  asked for a creature; and every picture of her after it is "that exact figure" — told "creature", the eighth lake
 *  film's editor drew her as a grey zombie man. The recipe's own words otherwise, as the reveal does — PHOTOGRAPHED.) */
export function threatPortrait(entry: string, sceneHint: string): string {
  const p = portraitPrompt(dressedInWater(oneLine(entry)), sceneHint);
  const personLike = /\b(?:woman|women|lady|girl|man|men|boy|child|stranger)\b/i.test(castEntry(oneLine(entry)).name);
  const asFigure = personLike && p.includes(CREATURE_REAL) ? p.replace(CREATURE_REAL, PHOTOGRAPHED).replace("this ONE creature alone", "this ONE figure alone") : p;
  return `${asFigure} ${DRESSED} ${NOTHING_GLOWS}`;
}

/** …AND A PLACE WHOSE FIRST SCENE HAS IT IN VIEW is drawn with that picture beside the cast's, bound to it by name the
 *  way a cast member's photo is (image-generation → renderSideBySideTwoShot). */
export function thingBound(o: { name: string; refNo: number; look?: string | null }): string {
  const name = oneLine(o.name);
  if (!name || !(o.refNo > 0)) return "";
  const look = oneLine(o.look).slice(0, 200);
  return ` THE ONE THEY FEAR: reference image ${o.refNo} is ${name} and ONLY ${name}${look ? ` (${look})` : ""}. Where this moment has ${name}, ${name} is drawn EXACTLY as in that picture — the same face, hair and clothes — and only as much of ${name} as the moment shows; nothing else of that picture comes into this one, and ${name} is never one of the two.`;
}

/* ---- THE WRITER ---- */

/* The KIND of thing that happens in a shot, as examples for the writer — DEALT, a different few every film:
 * a fixed example comes back as the story (the example name "Pip" came back as a character's name in story
 * after story — story-variety.ts). Each is something big enough to see and safe to animate: no fire, nothing
 * poured, nothing written or on a screen, no small prop. */
export const EVENT_IDEAS: readonly string[] = [
  "a door pulled open", "a drawer dragged out and emptied", "a thing picked up and turned over in the hands", "a walk down a flight of stairs",
  "a light going out", "a curtain drawn back", "a coat pulled on", "a bag unzipped and searched",
  "a chair pushed back from a table", "a key tried in a lock", "a window forced up", "a blanket lifted off something",
  "a lid prised off a box", "a lamp carried across the room", "a coat taken down from its hook", "a step back from something on the floor",
  "a cupboard opened shelf by shelf", "a rope hauled in hand over hand", "a spade driven into the ground", "a torch beam swung across a wall",
  "a suitcase snapped shut", "a ladder climbed two rungs", "a sheet pulled off a mirror", "a floorboard levered up",
];
/** …and for a film for little ones. */
export const EVENT_IDEAS_SMALL: readonly string[] = [
  "a kite pulled up into the wind", "a ball rolled across the grass", "a box opened", "a blanket lifted off something",
  "a tower of blocks stacked one higher", "a bucket filled with sand", "a wagon pulled along a path", "a door pushed open",
  "a hat lifted off a hook", "a basket carried between two", "a lid lifted off a pot", "a present unwrapped",
  "a boat pushed out onto a pond", "a seed pressed into the soil",
];
/** A few of them, no two the same. `rand` is a 0–1 source. */
export function eventIdeas(rand: () => number = Math.random, n = 4, small = false): string[] {
  const pool = (small ? EVENT_IDEAS_SMALL : EVENT_IDEAS).slice();
  const out: string[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.min(pool.length - 1, Math.max(0, Math.floor(rand() * pool.length))), 1)[0]);
  return out;
}

/** What a shot's VISUAL is in an acted film: the one thing that HAPPENS in it. (It used to be "a TWO-SHOT
 *  framing BOTH characters … they STAY put … a still, tense TALKING beat".) The same field goes to the
 *  place's picture and, from there on, to the clip — so it is short, and has no looks and no camera in it. */
export function happensBrief(ideas: ReadonlyArray<string> = []): string {
  return (
    `what HAPPENS in this shot, written for the camera: ONE sentence of at most 25 words that calls BOTH characters by NAME and says the ONE physical thing that is DONE while the line is spoken — something we can watch happen in a few seconds` +
    (ideas.length ? ` (the KIND of thing meant: ${ideas.join("; ")} — examples of the kind, not a list to pick from: find what THIS story needs)` : "") +
    `. A shot is NEVER only two people talking: in every shot somebody does something to something, or something in the place changes — and looking, listening, nodding, sitting, standing or "exchanging a glance" is not it. Keep it small enough to do while speaking and to finish inside the shot: both stay in the picture with their faces toward us, each on their own side of it (the film tells the two apart by their side) — nobody leaves, nobody turns their back, nobody crosses over to the other's side, nothing passes in front of a face. When what happens is the two of them going somewhere TOGETHER, write it as both of them doing it ("NAME and NAME walk down…", "NAME and NAME come along…") — that is how the film knows to travel with them. Whatever is handled belongs to the story and is big enough to see — never a cigarette, a drink or a phone added for flavour (small props warp in AI video) — and nothing in view is written: NO readable text, documents, papers, boards, signage or screens. Call them by NAME only (their looks are in "cast" — never repeat them here) and use no camera words.`
  );
}

/** How the shots of one place hang together — it is how the film is made: one picture per place, then each
 *  clip starts on the last frame of the one before. */
export const ONE_TAKE = "ONE PLACE, ONE TAKE — the picture of a place is drawn ONCE, from the VISUAL of the FIRST shot set there, and every later shot in that place carries on from where the shot before it ended. So a later shot there uses only what that first VISUAL already put in view — whatever is handled, opened or put out later is named in the first — and whatever a shot changes stays changed: what was opened stays open, and whoever crossed the room is still where they went. For the same reason the film never comes BACK to a place it has left.";

/** WHAT IS DONE TO A PLACE STAYS DONE (2026-11-25, stream S12). The owner, of the lake films: "the writer may need to be
 *  more deliberate on what it's telling the ai to do, for example they say "close the tent up" then "put the bag in front
 *  of the door" but they never actually zipped the tent doors up". The film draws what a VISUAL says is done, and keeps
 *  it (place-state.ts) — so a VISUAL says what it looks like AFTER, and every later one keeps it in so many words. Said
 *  to every acted film (film-engine.server.ts), and named in a next episode's brief (film-series.ts). */
export const DONE_STAYS_DONE = "WHAT IS DONE TO A PLACE STAYS DONE — a shot that shuts, zips, locks or blocks something says in its VISUAL what it looks like AFTER, in so many words (\"…until the tent door is zipped completely shut, no gap\"; \"…wedges the duffel bag against the bottom of the zipped-shut door\"), and every later VISUAL in that place keeps it so in so many words (\"inside the zipped-shut tent\") until a shot shows it being opened. Nothing comes in, and nothing is seen, through what is shut: whatever is outside a shut tent presses the cloth in, throws its shadow on it, or opens the zipper — and that opening is a shot of its own.";

/** What replaced 'SHOT — set this to EXACTLY "wide two-shot" for EVERY beat'. */
export const CAMERA_IS_DEALT = "THE CAMERA IS NOT YOURS — how the two are placed and filmed in each place (how far apart they are, who is nearer, standing or seated or walking, where the camera is) is dealt by the film itself: one staging for each location, and no two locations alike. So there is no \"shot\" field, and no VISUAL names a shot size, a lens, an angle or a \"two-shot\". Never write the two side by side or shoulder to shoulder: people in a film keep a natural distance, and look at each other or at what they are doing — not at us.";

/** The pipeline shows exactly two people. An idea that has somebody ALONE still gets a second — so the
 *  second has to come out of the idea. */
export const TWO_ALWAYS = "ALWAYS THE SAME TWO — both are in every shot. If the idea has somebody ALONE, the second one must BELONG there, and the first lines make it plain why they are there: somebody who came because of what is happening (a neighbour who came to check, a friend who was called, a relative with a key) — or, when it can speak, the very thing the idea is about (the voice turns out to be somebody). Never a stranger who is simply in the room. It stays the story of the one who was alone: the other came INTO it.";

/** WHETHER A SHOT MAY HAVE NO LINE — said to the writer in so many words, at the end of what a CAPTION is.
 *  ("THE LAST SHOT IS SEEN, NOT SAID" alone left it to chance: of the first two horror scripts written on the
 *  live site with it, one ended on a shot with no line and one on a screamed one.) Every shot of an acted
 *  film has a line; the one exception is the last shot of a horror film, which has none — see below. */
export const LINE_IN_EVERY_SHOT = "EVERY shot has a line: a CAPTION is never left empty.";
export const LINE_IN_EVERY_SHOT_BUT_THE_LAST = "EVERY shot has a line, with ONE exception: the LAST shot of this film has none (THE LAST SHOT, below). No other CAPTION is ever left empty.";

/** A SOUND IN A SHOT, for the writer — (a), (b) and (c) of "A SOUND THEY HEAR" above. The film he watched had
 *  "Tell me you heard that too" one shot BEFORE the knocking was heard, a sister's own hand knocking, and a
 *  line calling quick knocks slow. Said to every acted film (a knock at the door is not only a horror film's). */
export const HEARD_BEFORE_SAID = "A SOUND COMES BEFORE ANY WORD ABOUT IT — when what happens in a shot is a SOUND (a knock, footsteps, a voice, a bang, a scrape), that shot's VISUAL BEGINS with it: what is heard, exactly how it sounds — how many, how fast or slow, how loud — and where it comes from (\"Three slow, heavy knocks from inside the bedroom wall, a full second apart; …\"). The shot opens on that sound, heard ALONE, and its line is the REACTION to it — so a line that reacts to a sound (\"did you hear that?\", \"there it is again\", \"listen\") is only ever in the shot where that sound is first heard, or a later one; never before it. WHAT IS SAID ABOUT IT IS WHAT IS HEARD: a line that describes the sound says what its VISUAL says — never \"slow\" about a fast knock, never \"once\" about three. WHAT IS HEARD IS NOT SEEN: a sound from out of sight — inside a wall, upstairs, behind a closed door, under the floor — is made by NOTHING on screen: neither of the two knocks, taps or scratches while it is heard, and no hand or figure is shown making it; they only HEAR it — they freeze, turn toward it, look at each other.";

/** A horror film only: what its last shot is. (What the thing IS, and how little of it is shown, is said once
 *  — story-picture.ts → WHAT_FRIGHTENS, which the writer is given after this.)
 *  THE LAST SHOT HAS NO LINE, and that is decided, not left to the writer: it is the scare after the exchange
 *  (the owner: "voice saying \"babe whats wrong\" then boom the scare shot"); the engine gives its whole take
 *  to what happens when it has no line to speak; and the last shot is the one place a spoken line could land
 *  in the wrong mouth — there is a third face in that picture, and this engine moves whatever mouth it can
 *  see (take.ts). A line the writer puts there anyway is spoken, as any line is.
 *  IT IS IN THE SAME PLACE. It used to be given "a WHERE of its own … so that its picture is drawn WITH the
 *  thing in it" — and the film drew a whole new room for it, reached through a dissolve, with a mannequin's arm
 *  in its wall (the owner: "more odd than actual realism"). Now its WHERE is the place before it, letter for
 *  letter, and the film draws the thing INTO that place's own picture (film-dialogue → revealPicture). It
 *  moves SLOWLY, and the two are afraid of it — nobody grins at what frightens them, unless the smile IS it.
 *  IT MOVES IN PLACE. Told "it moves a little, it is nearer than it was", the third live film's writer had the
 *  fingers come out of the hole, and the engine made them a big hand reaching at the lens. So the writer is
 *  given the forms the film draws (a face in a hole in a wall; a tall shape in the dark) and what they may do:
 *  an eye turns, a head tilts — never out, never nearer, never reaching. */
/** WHEN THEY SEE IT, WE SEE IT (2026-11-25): the lake idea — "when they shine a flashlight, a woman is standing
 *  waist-deep in the lake" — was acted as five shots in the tent: the two talked about her smiling, she was never in a
 *  picture, and the last shot's reveal did not come — so she was never seen at all. Said before SEEN_AT_THE_END. */
export const SEEN_WHEN_SEEN = "WHEN THEY SEE IT, WE SEE IT — when the IDEA has its people see the thing before the end (they shine a light and there it stands; they look out and it is there), the VISUAL of THAT shot shows it where the idea puts it: in the frame behind or beyond the two, far off and small, half in the dark, the way WHAT FRIGHTENS says such a thing is seen — and says what it is and what is wrong with it, in the same few words in every VISUAL that shows it. It is never only talked about.";
export const SEEN_AT_THE_END = "THE LAST SHOT IS SEEN, NOT SAID — a horror film ends on something the viewer SEES, not on a line about it. So the LAST shot has NO LINE: its CAPTION is \"\" (empty — no NAME, no words) and it has no TONE. Nobody speaks in it, not a word and not a whisper; the last words of the film are the line of the shot BEFORE it. It is in the SAME PLACE as the shot before it — its WHERE is the same words, letter for letter: the thing is found where the two already are, WHERE ITS SOUND CAME FROM — at the door it knocked at, at the window it knocked on, in the wall only when the story has it IN the wall, or right behind one of them in the dark — never in another room; the film draws it into that place's own picture, the one thing in the film that was not in that place's first VISUAL. In that last shot's VISUAL the thing this story has been circling is IN the picture with the two of them, seen the way WHAT FRIGHTENS (below) says such a thing is seen — BARELY: only a part of it, the way a horror film shows it — at a door, the door eased open a hand's width on the dark and a tall shape in the gap with only its face in the light; at a window, its face close to the dark glass, OUTSIDE, the glass whole; in a wall (only when it is IN the wall), its FACE pressed into a hole broken in the plaster, one eye catching the light; at a TENT (always when its door was shut), it is OUTSIDE — its FACE pressing the thin canvas in from outside, the wet fabric stretched over its features, or the zipper of the shut door sliding up a hand's width from outside and, in that gap, its face — never inside with them, never in an opening that is shut; anywhere else, a tall shape standing in the dark with only its face in the light — never a hand, an arm or a body reaching out into the light — never at the edge of the picture. Say its one or two wrongnesses in so many words (skin like old candle wax; an eye open far too wide that never blinks; a face a little too high up) — never just \"wrong\" or \"strange\". And what HAPPENS in that shot is IT, SLOWLY and IN PLACE: its eye turns to them, or its head tilts — it never comes out of where it is, never comes nearer, never reaches for anybody — and the two FREEZE, and one of them slowly turns to it. Neither of the two smiles — they are afraid of it — unless that smile IS the horror and the VISUAL says so. When it is not one of the two, it has no \"cast\" entry: say what it is, and the one or two things that are wrong with it, in that VISUAL (which may run to 40 words).";

/* ---- PEOPLE WHO ARE RELATED ARE THE RIGHT AGES FOR IT ----
 * The owner, of the same live film: "Also want to note in that video they are "sisters" but one of them is 130
 * and the other looks 30". The writer's cast for that idea had read "in her fifties" and "in her thirties", and
 * the pictures — drawn from those words — followed them. So the writer is told (AGES_FIT_RELATION), and then the
 * cast it wrote is CHECKED (castAgeProblem): when the idea, the lines or the cast make the two related, their
 * stated ages must fit — and a cast that breaks it is asked for again, or put right here (repairAges); never
 * filmed. Only a cast of exactly two is checked (the pair the relation is about is then not in doubt). */

/** What the writer is told, with the cast it invents. */
export const AGES_FIT_RELATION = "AGES — every \"cast\" entry says that character's AGE plainly (\"in her forties\", \"a 30-year-old\", \"in his early sixties\"): their picture is drawn from it. When the story makes two of them RELATED, their ages FIT it: sisters or brothers within about ten years of each other (twins the same age), cousins or a married couple within about fifteen, a parent 20 to 40 years older than their child, a grandparent 45 to 70 years older than their grandchild. Two who are close in age by what they are (sisters, brothers, cousins, a couple) LOOK it: no grey or white hair on either of them unless both are past sixty.";

/** The relations a cast of two can have, and the age gap each allows (in years: [least, most]). */
export const AGE_RULES = {
  twins: { gap: [0, 1], says: "twins", rule: "twins are the same age" },
  siblings: { gap: [0, 10], says: "siblings", rule: "siblings are within about ten years of each other" },
  cousins: { gap: [0, 15], says: "cousins", rule: "cousins are within about fifteen years of each other" },
  couple: { gap: [0, 15], says: "a married couple", rule: "a married couple is within about fifteen years of each other" },
  parent: { gap: [18, 45], says: "a parent and their child", rule: "a parent is 20 to 40 years older than their child" },
  grandparent: { gap: [40, 75], says: "a grandparent and their grandchild", rule: "a grandparent is 45 to 70 years older than their grandchild" },
} as const;
export type AgeRelation = keyof typeof AGE_RULES;

const DECADE_WORDS: Record<string, number> = { teens: 10, twenties: 20, thirties: 30, forties: 40, fifties: 50, sixties: 60, seventies: 70, eighties: 80, nineties: 90 };
const DECADE_OF = Object.fromEntries(Object.entries(DECADE_WORDS).map(([w, d]) => [d, w])) as Record<number, string>;
/** An age, as words say it: a decade (early / mid / late), a number of years, or a word for a time of life. */
const AGE_SAID = /\b(?:(early|mid|late)[\s-]+)?(teens|twenties|thirties|forties|fifties|sixties|seventies|eighties|nineties|[1-9]0s)\b|\b(\d{1,2})[\s-]+years?[\s-]+old\b|\b(?:aged|age)\s+(\d{1,2})\b|\b(elderly|middle-aged|teenage|teenager)\b/i;

/** …and as a cast list says it with a bare number: "Prudence, 58, grey hair…", "Ruth (30)", "a woman of about
 *  52", "around 40" — never a number of anything else ("about 6 feet tall", "about 30 letters"). */
const AGE_NUMBER = /^[^,(:—–]{1,40}[,(:—–]\s*(\d{1,2})\s*(?=[,);—–]|$)|\b(?:about|around|roughly|nearly|almost|approximately|maybe|perhaps|some)\s+(\d{1,2})\b(?!\s*(?:%|percent|cm|mm|kg|lbs?|pounds|stone|feet|foot|ft|inches|inch|metres?|meters?|miles?|minutes?|hours?|days?|weeks?|months?|times|letters|boxes|people|years?\s+(?:ago|later|before|after|earlier|since))\b)|\b(?:woman|man|girl|boy|lady|person)\s+of\s+(\d{1,2})\b/i;

/** THE AGE AN ENTRY STATES, as a range of years — "in her fifties" [50, 59], "in his early thirties" [30, 33],
 *  "a 30-year-old" [30, 30], "middle-aged" [40, 60], "Prudence, 58," [58, 58] — with the words it was said in
 *  (the first said, in the entry); null when it states none. */
export function ageOf(entry: unknown): { from: number; to: number; said: string } | null {
  const text = oneLine(entry);
  const m = AGE_SAID.exec(text);
  const bare = AGE_NUMBER.exec(text);
  const number = bare ? bare[1] || bare[2] || bare[3] || "" : "";
  if (bare && number && (!m || bare.index + bare[0].indexOf(number) < m.index)) {
    const years = parseInt(number, 10);
    if (Number.isFinite(years) && years > 0) return { from: years, to: years, said: number };
  }
  if (!m) return null;
  const said = m[0];
  if (m[2]) {
    const d = /^\d0s$/i.test(m[2]) ? parseInt(m[2], 10) : DECADE_WORDS[m[2].toLowerCase()];
    const lo = d === 10 ? 13 : d;
    const part = (m[1] || "").toLowerCase();
    return part === "early" ? { from: lo, to: lo + 3, said } : part === "mid" ? { from: d + 3, to: d + 6, said } : part === "late" ? { from: d + 6, to: d + 9, said } : { from: lo, to: d + 9, said };
  }
  const n = parseInt(m[3] || m[4] || "", 10);
  if (Number.isFinite(n)) return { from: n, to: n, said };
  const w = (m[5] || "").toLowerCase();
  return w === "elderly" ? { from: 65, to: 90, said } : w === "middle-aged" ? { from: 40, to: 60, said } : { from: 13, to: 19, said };
}

const nameOfEntry = (e: unknown): string => (oneLine(e).split(/[,:—–(]/)[0] || "").trim();

/* Who is family to whom. A horror story talks about relatives all the time — "their late mother's house", "Mum
 * kept every letter", "my brother went missing down there" — and none of those is one of the TWO. So a relation
 * is read only where it is said of the pair: */
const KIN_NOUN = "twin|sister|brother|sibling|cousin|husband|wife|spouse|mother|mum|mom|father|dad|daughter|son|grandmother|grandma|granny|grandfather|grandpa|granddad|granddaughter|grandson|grandchild";
const KIN_ADJ = "older|younger|big|little|kid|baby|twin|elder";
const KIN_OF: Record<string, AgeRelation> = {
  twin: "twins", sister: "siblings", brother: "siblings", sibling: "siblings", cousin: "cousins", husband: "couple", wife: "couple", spouse: "couple",
  mother: "parent", mum: "parent", mom: "parent", father: "parent", dad: "parent", daughter: "parent", son: "parent",
  grandmother: "grandparent", grandma: "grandparent", granny: "grandparent", grandfather: "grandparent", grandpa: "grandparent", granddad: "grandparent", granddaughter: "grandparent", grandson: "grandparent", grandchild: "grandparent",
};
/** (the order a relation is taken in, when words seem to say two: the narrower first) */
const RELATION_ORDER: AgeRelation[] = ["twins", "grandparent", "parent", "couple", "cousins", "siblings"];
/** said of the two together: "two sisters", "the Miller brothers", "twin sisters", "a brother and sister",
 *  "a mother and her daughter" — never "their sisters", "whose brothers", "a mother of twins" */
const PAIR_SAID: Array<[RegExp, AgeRelation]> = [
  [/\btwin\s+(?:sisters|brothers)\b|(?<!\b(?:their|her|his|my|our|your|whose)\s+(?:\p{L}+\s+)?|\b(?:mother|father|parent|mum|mom|dad)\s+of\s+(?:\p{L}+\s+)?)\btwins\b/iu, "twins"],
  [/\b(?:grandmother|grandma|granny|grandfather|grandpa|granddad)\s+and\s+(?:her|his|their)?\s*(?:granddaughter|grandson|grandchild)\b|\b(?:granddaughter|grandson|grandchild)\s+and\s+(?:her|his|their)?\s*(?:grandmother|grandma|granny|grandfather|grandpa|granddad)\b/iu, "grandparent"],
  [/\b(?:mother|mum|mom|father|dad|parent)\s+and\s+(?:her|his|their)?\s*(?:daughter|son|child|kid|boy|girl)\b|\b(?:daughter|son)\s+and\s+(?:her|his|their)?\s*(?:mother|mum|mom|father|dad)\b/iu, "parent"],
  [/\b(?:husband\s+and\s+wife|wife\s+and\s+husband|married\s+couple|newlyweds?)\b/iu, "couple"],
  [/(?<!\b(?:their|her|his|my|our|your|whose)\s+(?:\p{L}+\s+)?)\bcousins\b/iu, "cousins"],
  [/\b(?:brother\s+and\s+sister|sister\s+and\s+brother)\b|(?<!\b(?:their|her|his|my|our|your|whose)\s+(?:\p{L}+\s+)?)\b(?:sisters|brothers|siblings)\b/iu, "siblings"],
];
/** a line said TO the other one ("you're my little sister") or of the TWO of them ("we're twins", "we're married") */
const LINE_TO_YOU = new RegExp(`\\byou(?:['’]re|\\s+are|\\s+were)\\s+(?:my|our)\\s+(?:(${KIN_ADJ})\\s+)?(${KIN_NOUN})(?![\\p{L}'’])`, "giu");
const LINE_OF_US = /\bwe(?:['’]re|\s+are|\s+were)\s+(?:(?:both|all|still)\s+)?(twins|sisters|brothers|siblings|cousins|married)\b/giu;
const kinRelation = (adj: string | undefined, noun: string): AgeRelation | undefined => ((adj || "").toLowerCase() === "twin" ? "twins" : KIN_OF[noun.toLowerCase()]);

/** WHAT THE TWO ARE TO EACH OTHER — read only where it is said of the PAIR: in the idea ("two sisters", "a widow
 *  and her brother", "my sister and I", "June's older sister"), in a cast entry (right after its name — "Bo, her
 *  older brother, …" — or of the other one by name: "Peggy's younger sister"), and in a line said to the other
 *  one or of both ("you're my little sister", "we're twins"). A third person they speak of ("their late mother's
 *  house", "Mum kept every letter", "her late husband's brother", "my brother went missing here") is not a
 *  relation between them. null = none. */
export function relationOf(o: { idea?: string | null; cast?: ReadonlyArray<string | null | undefined>; lines?: ReadonlyArray<string | null | undefined> }): AgeRelation | null {
  const idea = oneLine(o.idea);
  const entries = (o.cast || []).map(oneLine).filter(Boolean);
  const lines = (o.lines || []).map(oneLine).join(" | ");
  const found = new Set<AgeRelation>();
  const kin = (text: string, who: string) => {
    if (!text) return;
    let re: RegExp;
    try { re = new RegExp(`${who}\\s+(?:(${KIN_ADJ})\\s+)?(${KIN_NOUN})(?![\\p{L}'’])`, "giu"); } catch { return; }
    for (const m of text.matchAll(re)) { const r = kinRelation(m[1], m[2]); if (r) found.add(r); }
  };
  // (a name of one of the two, whole or any word of it: "Peggy's sister", "Mary Ann's brother")
  const names = [...new Set(entries.map(nameOfEntry).flatMap((n) => [n, ...n.split(/\s+/)]).filter((n) => n.replace(/\P{L}/gu, "").length > 1))].map(escapeRe);
  const named = names.length ? `(?<![\\p{L}\\p{N}])(?:${names.join("|")})['’]s` : "";
  for (const text of [idea, ...entries]) for (const [re, r] of PAIR_SAID) if (re.test(text)) found.add(r);
  kin(idea, `\\b(?:and|with)\\s+(?:her|his|your)`);
  kin(idea, `\\b(?:my|our)(?=\\s+(?:(?:${KIN_ADJ})\\s+)?(?:${KIN_NOUN})\\s+and\\s+(?:I|me)\\b)`);
  for (const text of [idea, ...entries]) if (named) kin(text, named);
  for (const e of entries) kin(e, `^[^,:—–(]*[,:—–(]\\s*(?:her|his)`);
  for (const m of lines.matchAll(LINE_TO_YOU)) { const r = kinRelation(m[1], m[2]); if (r) found.add(r); }
  for (const m of lines.matchAll(LINE_OF_US)) { const w = m[1].toLowerCase(); found.add(w === "married" ? "couple" : w === "twins" ? "twins" : w === "cousins" ? "cousins" : "siblings"); }
  return RELATION_ORDER.find((r) => found.has(r)) ?? null;
}

/** IS THIS CAST OF TWO THE WRONG AGES FOR WHAT THEY ARE TO EACH OTHER? The relation, the two entries' ages, and
 *  which entry is the older — or null when there is nothing wrong, no relation, no age stated for either, or not
 *  exactly two in the cast. Ages are ranges, and only a clear break counts: "in her fifties" and "in her thirties"
 *  are at least eleven years apart — not sisters; "late forties" and "early fifties" are. */
export function castAgeProblem(o: { idea?: string | null; cast?: ReadonlyArray<string | null | undefined> | null; lines?: ReadonlyArray<string | null | undefined> }): { relation: AgeRelation; ages: [{ from: number; to: number; said: string }, { from: number; to: number; said: string }]; older: 0 | 1 } | null {
  const cast = (o.cast || []).map(oneLine).filter(Boolean);
  if (cast.length !== 2) return null;
  const relation = relationOf({ idea: o.idea, cast, lines: o.lines });
  if (!relation) return null;
  const a = ageOf(cast[0]), b = ageOf(cast[1]);
  if (!a || !b) return null;
  const [least, most] = AGE_RULES[relation].gap;
  const minGap = Math.max(0, Math.max(a.from, b.from) - Math.min(a.to, b.to));
  const maxGap = Math.max(a.to, b.to) - Math.min(a.from, b.from);
  if (minGap <= most && maxGap >= least) return null;
  return { relation, ages: [a, b], older: a.from + a.to >= b.from + b.to ? 0 : 1 };
}

/** A decade the way a cast entry says it ("mid-forties", "early thirties", "late teens"), for `years`. */
const decadeWords = (years: number): string => {
  const y = Math.max(13, Math.min(95, Math.round(years)));
  if (y < 20) return "late teens";
  const d = Math.floor(y / 10) * 10;
  const u = y - d;
  return `${u <= 3 ? "early " : u <= 6 ? "mid-" : "late "}${DECADE_OF[d]}`;
};

/** PUT IT RIGHT, when asking again did not: one of the two keeps their age, and only the other one's AGE WORDS
 *  are said again, where the relation puts them — "thirties" → "mid-forties" (so "in her thirties" reads "in her
 *  mid-forties"), "30-year-old" → "46-year-old", "middle-aged" → "a 46-year-old". Brothers, sisters, cousins, a
 *  couple: the younger is brought up to a few years under the older. A parent or a grandparent: the CHILD keeps
 *  their age and the elder is made older — a horror film's cast is adults only, and making the child younger could
 *  make them a minor. Everything else in both entries is left exactly as written. */
export function repairAges(cast: ReadonlyArray<string>, p: NonNullable<ReturnType<typeof castAgeProblem>>): string[] {
  const out = cast.map(oneLine);
  const elder = p.relation === "parent" || p.relation === "grandparent";
  const keep = p.ages[elder ? (p.older === 0 ? 1 : 0) : p.older];
  const k = elder ? p.older : p.older === 0 ? 1 : 0;
  const change = p.ages[k];
  const target = Math.max(1, Math.round(p.relation === "parent" ? keep.from + 28 : p.relation === "grandparent" ? keep.from + 55 : p.relation === "twins" ? (keep.from + keep.to) / 2 : keep.from - 4));
  const at = out[k].indexOf(change.said);
  if (at < 0) return out;
  const decade = /(?:teens|ties|[1-9]0s)$/i.test(change.said);
  const said = decade ? decadeWords(target) : /\d/.test(change.said) ? change.said.replace(/\d{1,2}/, String(target)) : `${target}-year-old`;
  let before = out[k].slice(0, at);
  // (an article that no longer fits the word after it: "an elderly woman" → "a 70-year-old woman")
  if (!decade) before = before.replace(/\b(an?)\s+$/i, (m, art: string) => `${/^(?:8|11-|18-)/.test(said) ? (art[0] === "A" ? "An" : "an") : (art[0] === "A" ? "A" : "a")} `);
  out[k] = `${before}${said}${out[k].slice(at + change.said.length)}`;
  return out;
}

/** The one question asked when the ages are wrong: both entries again, the same people, ages that fit. */
export function ageAsk(cast: ReadonlyArray<string>, p: NonNullable<ReturnType<typeof castAgeProblem>>): string {
  const rule = AGE_RULES[p.relation];
  return `These are the two characters of a short film, as its cast list describes them:\n1. ${oneLine(cast[0])}\n2. ${oneLine(cast[1])}\nIn the story they are ${rule.says} — but their ages (${p.ages[0].said}; ${p.ages[1].said}) cannot be: ${rule.rule}. Rewrite BOTH entries so that their ages fit what they are to each other, and say each one's age plainly in the entry ("in her forties", "about 30"). Keep each entry's NAME first and exactly as it is, and keep everything else about them — looks, clothes, hair — the same. Return "cast": the two entries, in the same order.`;
}

/** The rewritten cast, taken only when it is two entries, each starting with the same name as before, whose ages
 *  now fit; else null. */
export function takeAgeFix(cast: ReadonlyArray<string>, answer: unknown, o: { idea?: string | null; lines?: ReadonlyArray<string | null | undefined> } = {}): string[] | null {
  if (!Array.isArray(answer) || answer.length !== 2 || answer.some((x) => typeof x !== "string" || !oneLine(x))) return null;
  const next = answer.map((x) => oneLine(x).slice(0, 400));
  if (next.some((e, i) => nameOfEntry(e).toLowerCase() !== nameOfEntry(cast[i]).toLowerCase())) return null;
  if (!ageOf(next[0]) || !ageOf(next[1])) return null;
  return castAgeProblem({ idea: o.idea, cast: next, lines: o.lines }) ? null : next;
}

/* ---- RELATED PEOPLE LOOK IT, IN THE PICTURES ----
 * The third live film of the same idea (knock3, 2026-11-24): its two "sisters" were still DRAWN fifteen to twenty
 * years apart — one about forty with short dark hair and glasses, one about sixty with grey hair in a bun. Ages
 * that fit can still be drawn that far apart ("mid-fifties" and "late forties" are sisters a few years apart, and
 * the check above lets them through): each of the two is drawn from her own words alone, nothing in the picture
 * says they are sisters, and "grey hair" adds ten years to anybody. So, for the PICTURES of a cast of two the
 * writer invented (the cast stays as written; people the maker picked are drawn from their own photos):
 *  · each one's words say whose sister (brother, twin, cousin, wife, mother…) they are, and their age as a number;
 *  · sisters, brothers, twins and cousins are drawn at the SAME age — the one between their two;
 *  · grey, white or silver hair is left out for a sister, brother, twin, cousin or spouse under sixty;
 *  · and the picture of the two of them says what they are to each other, and their ages (kinNote). */

/** How long one person's words may be in the master picture's prompt (image-generation.server.ts →
 *  renderSideBySideTwoShot cuts each one's description at 140 characters). */
export const PICTURE_DESC_MAX = 140;
const SAME_AGE_KIN: ReadonlySet<AgeRelation> = new Set<AgeRelation>(["twins", "siblings", "cousins"]);
const NO_GREY_KIN: ReadonlySet<AgeRelation> = new Set<AgeRelation>(["twins", "siblings", "cousins", "couple"]);
type Sex = "f" | "m" | "";
const KIN_FEMALE = /^(?:sister|wife|mother|mum|mom|daughter|grandmother|grandma|granny|granddaughter)$/i;
const KIN_MALE = /^(?:brother|husband|father|dad|son|grandfather|grandpa|granddad|grandson)$/i;
/** a woman or a man, by what the entry calls them ("a woman…"), else by what it says they are right after the
 *  name ("Bo, her younger brother" — whoever "her" is), else by the one kind of pronoun it uses; "" when unsure */
const sexOf = (entry: unknown): Sex => {
  const s = oneLine(entry);
  const noun = /\b(woman|girl|lady|man|boy|guy|gentleman)\b/i.exec(s);
  if (noun) return /^(?:woman|girl|lady)$/i.test(noun[1]) ? "f" : "m";
  const kin = new RegExp(`^[^,:—–(]*[,:—–(]\\s*(?:\\S+['’]s|her|his|their)\\s+(?:(?:older|younger|big|little|kid|baby|twin|elder|identical)\\s+)?(${KIN_NOUN})(?![\\p{L}'’])`, "iu").exec(s);
  if (kin) return KIN_FEMALE.test(kin[1]) ? "f" : KIN_MALE.test(kin[1]) ? "m" : "";
  const f = /\b(?:she|her|herself)\b/i.test(s), m = /\b(?:he|his|him|himself)\b/i.test(s);
  return f && !m ? "f" : m && !f ? "m" : "";
};
/** …and when an entry does not say, the words the two are named in together: "two sisters", "twin brothers" */
const pairSex = (text: unknown): Sex => (/\b(?:sisters|twin\s+sisters)\b/i.test(oneLine(text)) ? "f" : /\b(?:brothers|twin\s+brothers)\b/i.test(oneLine(text)) ? "m" : "");
/** what one of the two is to the other: "sister", "twin brother", "mother", "grandson"… */
const KIN_NAME: Record<AgeRelation, (sex: Sex, elder: boolean) => string> = {
  twins: (s) => (s === "f" ? "twin sister" : s === "m" ? "twin brother" : "twin"),
  siblings: (s) => (s === "f" ? "sister" : s === "m" ? "brother" : "sibling"),
  cousins: () => "cousin",
  couple: (s) => (s === "f" ? "wife" : s === "m" ? "husband" : "spouse"),
  parent: (s, elder) => (elder ? (s === "f" ? "mother" : s === "m" ? "father" : "parent") : s === "f" ? "daughter" : s === "m" ? "son" : "child"),
  grandparent: (s, elder) => (elder ? (s === "f" ? "grandmother" : s === "m" ? "grandfather" : "grandparent") : s === "f" ? "granddaughter" : s === "m" ? "grandson" : "grandchild"),
};
const GREY_WORD = "salt[- ]and[- ]pepper|grey|gray|silver|silvery|white|snow[- ]white|iron[- ]gr[ae]y|steel[- ]gr[ae]y|ash[- ]gr[ae]y|greying|graying|silvering|grizzled";
const HAIR_WORD = "hair|bun|braid|braids|plait|plaits|ponytail|curls|crop|bob|pixie|beard|stubble|moustache|mustache|streak|streaks|locks";
const HAIR_LOOK = "short|long|cropped|close-cropped|curly|wavy|straight|thick|thin|thinning|fine|wispy|shoulder-length|chin-length|neat|messy|untidy|frizzy|tidy|loose|tight|tied-back|swept-back|dark|brown|black|blonde|blond|fair|auburn|red|chestnut|sandy";
/** grey hair, said any of the ways a cast entry says it: "short grey hair", "grey hair pulled into a bun",
 *  "silver-streaked dark hair", "a grey-haired woman", "dark hair streaked with grey", "greying at the temples" —
 *  never a grey cardigan, white blouse or silver earrings */
const GREY_HAIR: RegExp[] = [
  new RegExp(`\\b(?:${GREY_WORD})(?:(?:-|\\s+and\\s+)(?:${GREY_WORD}))?(?:-(?:streaked|flecked|shot|tinged))?\\s+(?=(?:(?:${HAIR_LOOK})[\\s,]+){0,3}(?:${HAIR_WORD})\\b)`, "giu"),
  new RegExp(`\\b(?:${GREY_WORD})-haired\\b\\s*,?\\s*`, "giu"),
  new RegExp(`\\s*,?\\s*\\b(?:(?:streaked|flecked|shot|touched|tinged)\\s+with|going|turning)\\s+(?:${GREY_WORD})\\b`, "giu"),
  new RegExp(`\\s*,?\\s*\\b(?:${GREY_WORD})\\s+at\\s+the\\s+temples\\b`, "giu"),
];
/** "a" or "an" again, where words were taken out between an article and the word after it */
const reArticle = (before: string, after: string): string => {
  const next = after.replace(/^\s+/, "");
  const m = /\b(a|an)\s*$/i.exec(before);
  if (!m || !next) return `${before}${after}`;
  // ("a 47-year-old with dark hair" → "with dark hair": the article had nothing left to go with)
  if (/^(?:with|in|wearing|who|whose|and|dressed|of|carrying|holding)\b|^[,;.]/i.test(next)) return `${before.slice(0, m.index)}${next}`;
  if (!/^\p{L}/u.test(next)) return `${before}${after}`;
  const an = /^[aeio]/i.test(next) ? "an" : /^[bcdfgjklmnpqrstvwxyz]/i.test(next) ? "a" : m[1].toLowerCase();
  return `${before.slice(0, m.index)}${m[1][0] === "A" ? `${an[0].toUpperCase()}${an.slice(1)}` : an} ${next}`;
};
const cutAll = (s: string, re: RegExp): string => {
  let out = s;
  for (let guard = 0; guard < 8; guard++) {
    re.lastIndex = 0;
    const m = re.exec(out);
    if (!m) break;
    out = reArticle(out.slice(0, m.index), out.slice(m.index + m[0].length));
  }
  return out;
};
const tidyWords = (s: string): string => s
  .replace(/\s+/g, " ")
  // ("with grey hair, round glasses" lost its grey: "with round glasses" — never "with hair")
  .replace(/\bwith hair\s*(?:,|\band\b)\s*/gi, "with ")
  .replace(/\bwith hair\s*$/i, "")
  .replace(/\(\s*\)/g, "")
  .replace(/\s+([,;.)])/g, "$1")
  .replace(/([,;])(?:\s*[,;])+/g, "$1")
  .replace(/\b(?:with|and)\s*(?=[,;]|$)/gi, "")
  .replace(/\s+([,;.)])/g, "$1")
  .replace(/^[\s,;:—–)(-]+|[\s,;:—–(-]+$/g, "")
  .trim();
/** One of the two, as their picture is told who they are (see above). */
const kinEntry = (entry: string, name: string, other: string, said: string, kin: string, years: number, noGrey: boolean): string => {
  const e = oneLine(entry);
  // what comes after the name ("Prudence, a woman in her fifties…" → "a woman in her fifties…")
  let rest = e.toLowerCase().startsWith(name.toLowerCase()) ? e.slice(name.length).replace(/^\s*[,:—–(-]\s*/, "") : e;
  // …without the age, which is said again as a number: "a woman in her late fifties with…" → "a woman with…"
  const at = said ? rest.indexOf(said) : -1;
  if (at >= 0) {
    let before = rest.slice(0, at).replace(/\b(?:in|into)\s+(?:her|his|their|the)\s+$/i, "");
    for (let k = 0; k < 2; k++) before = before.replace(/\b(?:aged|age|of|about|around|roughly|nearly|almost|approximately|maybe|perhaps|some)\s+$/i, "");
    rest = reArticle(before, rest.slice(at + said.length));
  }
  // …without what they are to the other, which is said first ("Colette's younger sister", "her sister")
  const adj = "(?:(?:older|younger|big|little|kid|baby|twin|elder|identical)\\s+)?";
  const noun = `(?:${KIN_NOUN}|sibling|spouse|partner)`;
  try { rest = rest.replace(new RegExp(`(^|,)\\s*(?<![\\p{L}\\p{N}])${escapeRe(other)}['’]s\\s+${adj}${noun}(?![\\p{L}'’])\\s*,?`, "giu"), "$1"); } catch { /* a name no pattern can be made of: left as it is */ }
  rest = rest.replace(new RegExp(`^\\s*(?:her|his|their)\\s+${adj}${noun}(?![\\p{L}'’])\\s*,?`, "iu"), "");
  if (noGrey) for (const re of GREY_HAIR) rest = cutAll(rest, re);
  rest = tidyWords(rest);
  const whole = `${name}, ${other}'s ${kin}, about ${years} years old${rest ? `, ${rest}` : ""}`;
  if (whole.length <= PICTURE_DESC_MAX) return whole;
  // (too long for the picture's 140 characters: cut where a phrase ends, never in the middle of a word)
  const cut = whole.slice(0, PICTURE_DESC_MAX + 1);
  const phrase = Math.max(cut.lastIndexOf(", "), cut.lastIndexOf(" with "), cut.lastIndexOf(" and "), cut.lastIndexOf(" in "));
  const end = phrase > PICTURE_DESC_MAX * 0.6 ? phrase : cut.lastIndexOf(" ");
  return whole.slice(0, end > 0 ? end : PICTURE_DESC_MAX).replace(/[\s,;:—–-]+$/, "");
};

/** THE PICTURES' WORDS FOR A CAST OF TWO WHO ARE RELATED — each entry as its picture is told who they are, and
 *  the sentence the picture of the two of them is told (kinNote); null when the two are not related by what the
 *  idea, the cast or the lines say, either states no age, or the cast is not exactly two. */
export function kinLooks(o: { idea?: string | null; cast?: ReadonlyArray<string | null | undefined> | null; lines?: ReadonlyArray<string | null | undefined> }): { relation: AgeRelation; entries: [string, string]; note: string } | null {
  const cast = (o.cast || []).map(oneLine);
  if (cast.length !== 2 || !cast[0] || !cast[1]) return null;
  const relation = relationOf({ idea: o.idea, cast, lines: o.lines });
  const ages = cast.map(ageOf);
  const names = cast.map(nameOfEntry);
  if (!relation || !ages[0] || !ages[1] || !names[0] || !names[1] || names[0].toLowerCase() === names[1].toLowerCase()) return null;
  const mid = [(ages[0].from + ages[0].to) / 2, (ages[1].from + ages[1].to) / 2];
  const shared = Math.round((mid[0] + mid[1]) / 2);
  const years = SAME_AGE_KIN.has(relation) ? [shared, shared] : mid.map((m) => Math.round(m));
  const elder = mid[0] >= mid[1] ? 0 : 1;
  // (an entry that does not say: "two sisters" says it of both)
  const hint = relation === "siblings" || relation === "twins" ? pairSex(o.idea) || pairSex(cast.join(" | ")) : "";
  const entries = cast.map((entry, k) => kinEntry(entry, names[k], names[1 - k], ages[k]?.said || "", KIN_NAME[relation](sexOf(entry) || hint, k === elder), years[k], NO_GREY_KIN.has(relation) && years[k] < 60)) as [string, string];
  return { relation, entries, note: kinNote(entries[0], entries[1]) };
}

/** WHAT THE PICTURE OF THE TWO IS TOLD THEY ARE TO EACH OTHER, from the words each one is drawn from — "Prudence
 *  and Colette are sisters and look it: the same age — both about 51 — …"; "" unless both state an age and the
 *  words make them related. (Read off the words rather than handed over: the master picture's prompt is made in
 *  image-generation.server.ts, which hands stagedTwoShot each one's words and nothing about the two.) */
export function kinNote(a: unknown, b: unknown): string {
  const cast = [oneLine(a), oneLine(b)];
  if (!cast[0] || !cast[1]) return "";
  const relation = relationOf({ cast });
  const ages = cast.map(ageOf);
  const names = cast.map(nameOfEntry);
  if (!relation || !ages[0] || !ages[1] || !names[0] || !names[1]) return "";
  const yrs = [Math.round((ages[0].from + ages[0].to) / 2), Math.round((ages[1].from + ages[1].to) / 2)];
  const sex = cast.map(sexOf);
  const pairOf = (f: string, m: string, mixed: string, unknown: string) => (sex[0] === "f" && sex[1] === "f" ? f : sex[0] === "m" && sex[1] === "m" ? m : sex[0] && sex[1] ? mixed : unknown);
  if (SAME_AGE_KIN.has(relation)) {
    const pair = relation === "cousins" ? "cousins" : relation === "twins" ? pairOf("twin sisters", "twin brothers", "twins", "twins") : pairOf("sisters", "brothers", "a brother and a sister", "siblings");
    const age = Math.abs(yrs[0] - yrs[1]) <= 3 ? `the same age — both about ${Math.round((yrs[0] + yrs[1]) / 2)}` : `close in age — about ${yrs[0]} and about ${yrs[1]}`;
    return `${names[0]} and ${names[1]} are ${pair} and look it: ${age}, the same generation, with a family likeness; neither one looks old enough to be the other's parent.`;
  }
  if (relation === "couple") return `${names[0]} and ${names[1]} are a married couple and look it: about ${yrs[0]} and about ${yrs[1]}.`;
  const e = yrs[0] >= yrs[1] ? 0 : 1, c = 1 - e;
  return `${names[e]} is ${names[c]}'s ${KIN_NAME[relation](sex[e], true)} and looks it: about ${yrs[e]}, and ${names[c]} about ${yrs[c]} — ${relation === "grandparent" ? "two generations" : "a generation"} apart.`;
}

/* ---- THE TITLE ----
 * The same film was called "Horror Film — Two sisters clearing out their late mother's house at…": the idea, not
 * a title. The one made from that same idea before it was "The Knock She Kept". The writer's answer is a forced
 * tool call, and the schema's "required" is not enforced there — a writer that leaves the title out (or hands the
 * idea back as one) used to have the film named after the idea; it happened once before, to a Moral Story
 * (2026-11-23), and making the title "required" did not stop it. So the title is CHECKED, and asked for once more
 * on its own (titleAsk) when it is not one. (For every story format — acted and told.) */

const titleNorm = (s: unknown): string => oneLine(s).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
/** The writer's title, tidied — or "" when it is not a title of its own: missing, the idea itself, the idea's own
 *  opening words, or a whole sentence. */
export function ownTitle(title: unknown, idea: unknown): string {
  const t = oneLine(title).replace(/^["'“”‘’«»]+|["'“”‘’«».]+$/g, "").trim();
  if (!t) return "";
  const n = titleNorm(t), i = titleNorm(idea);
  const words = n.split(" ").filter(Boolean).length;
  if (i && (n === i || (i.startsWith(n) && words >= 5))) return "";
  return words > 12 ? "" : t.slice(0, 80);
}
/** The one question asked when it is not: the film's own lines and scenes, a title of its own. */
export function titleAsk(o: { idea?: string | null; scenes: ReadonlyArray<{ visual?: string | null; caption?: string | null }>; language?: string }): string {
  const sheet = o.scenes.map((s, k) => `${k + 1}. ${oneLine(s.visual).slice(0, 200)}${oneLine(s.caption) ? ` — ${oneLine(s.caption).slice(0, 200)}` : ""}`).join("\n");
  return `This is a short film, scene by scene:\n${sheet}\nIt was made from this idea: "${oneLine(o.idea).replace(/"/g, "'").slice(0, 300)}".\nGive the film a TITLE of its own, the way a film is titled: two to six words, short and specific to THIS story — never the idea's own words, no quotation marks, no full stop${o.language && !/^english$/i.test(o.language) ? `, in ${o.language}` : ""}. Return "title".`;
}

/* ---- THE JOIN: EVERY SHOT'S PICTURE, AND ITS SOUND THE SAME LENGTH ----
 * The fourth live film of the sisters' idea (knock4, 2026-11-24, "The Patient Wall"): its picture ended at 19.17 s
 * and its sound at 24.17 s — the last shot, the reveal, was gone from the picture while its 5 s of sound played on
 * over the last frame of the shot before. The join (film-dialogue → assembleTestMovie) placed every dissolve by
 * each clip's CONTAINER length — the longer of its picture and its sound — and a clip's sound often runs a few
 * hundredths of a second past its last frame (sound is cut in 1024-sample blocks, pictures in frames; a trim
 * cuts the two on different grids). Every such overhang put the next seam later than the picture it joins. A
 * dissolve of 0.18 s or 0.32 s swallowed that; the straight cut into the reveal (a 0.034 s dissolve: one frame)
 * could not: its offset fell after the last frame of the shot before, ffmpeg's xfade never brought the reveal in,
 * and acrossfade — which has no offset — kept all of its sound. The two films before it (knock2, knock3) happened
 * to have sound a hair SHORTER than picture. Reproduced on ffmpeg 6.1.1 and 8.1.2 with 30 ms of overhang a clip
 * (scratchpad acted-fix/join-repro.mjs). So now:
 *  · every clip is made exactly as long as its PICTURE, on the film's 30 fps grid: its picture cut (or its last
 *    frame held) to that many frames, its sound cut or padded with silence to the very same length;
 *  · a dissolve is a whole number of frames, so every offset falls on a frame, and the sound crosses in exactly
 *    as long as the picture does;
 *  · a straight cut is a JOIN (concat) — no offset to miss — its sound meeting in two 12 ms fades, so it never
 *    clicks;
 *  · and the finished file is MEASURED: picture and sound the same length, and the length the shots add up to
 *    (joinCheck). A film that fails it is joined again the plain way, and one that fails that is not shipped. */

/** The film's frame rate (every clip is brought to it before the join). */
export const FILM_FPS = 30;
const FILM_RATE = 44100;
/** Sound samples in one frame (44100 / 30 — a whole number, so a clip's sound can be cut to its frames exactly). */
const SAMPLES_PER_FRAME = FILM_RATE / FILM_FPS;
/** How a shot is joined to the one before it, in frames of dissolve: a shot that CONTINUES the last (seeded from
 *  its last frame) 5 frames (0.167 s — it was 0.18 s, never a whole frame); a new angle in the same place 10
 *  (0.333 s — it was 0.32 s); a cut to another place, or to the reveal, none: a straight cut. */
export const SEAM_FRAMES = { soft: 5, reframe: 10, hard: 0 } as const;
export type SeamKind = keyof typeof SEAM_FRAMES;
/** A seam as a join is told it: one of the kinds above, or a dissolve of that many frames (0: a straight join). */
export type Seam = SeamKind | number | null | undefined;
const seamFrames = (s: Seam): number => (typeof s === "number" ? Math.max(0, Math.round(s)) : SEAM_FRAMES[s || "soft"] ?? SEAM_FRAMES.soft);

/** HOW LONG A CLIP IS IN THE FILM, in frames: its PICTURE's length (`picture` — the acted film: a clip's sound
 *  runs past its picture only by the encoder's rounding, and is cut to it), or the LONGER of its picture and its
 *  sound (`longer` — the avatar dialogue: a lip-sync engine can hand back a picture that stops before its line is
 *  done, and the line is never cut — the clip's last frame is held until it is). */
export function clipFrames(o: { picture: number | null | undefined; sound?: number | null | undefined; length?: "picture" | "longer" }): number {
  const picture = Number(o.picture) > 0 ? Number(o.picture) : 0;
  const sound = Number(o.sound) > 0 ? Number(o.sound) : 0;
  const secs = o.length === "longer" ? Math.max(picture, sound) : picture;
  return secs > 0 ? Math.max(1, Math.round(secs * FILM_FPS)) : 0;
}
/** How far the finished file's picture and sound may differ — from each other, and from the length the shots add
 *  up to: two frames, and one block of sound (the encoder rounds the sound up to whole 1024-sample blocks). */
export const JOIN_TOLERANCE = 2 / FILM_FPS + 1024 / FILM_RATE;

const frameSecs = (frames: number): string => (frames / FILM_FPS).toFixed(6);

/** THE JOIN, as ffmpeg's filter graph (outputs [vc] and [ac]). `frames[i]` = clip i's length in frames at 30 fps
 *  (clipFrames); `seams[i]` = how clip i is joined to the one before it (seams[0] is not read); `prep` = the picture
 *  filters each clip gets first (crop, scale, …, fps=30); `silent[i]` = clip i has no sound stream (silence of its
 *  length is made for it); `hold` = how many seconds a clip's last frame may be held to reach its length (3: the
 *  few frames a picture-length clip can be short of itself; more where a clip is as long as its sound);
 *  `dissolve: false` = every seam a straight join (the plain way, tried when the first way does not come out
 *  whole). Returns the graph and the film's length in frames.
 *  FOR A PART OF A LONGER FILM (joinParts, below — a film with none of these is joined exactly as it was):
 *  `skip[i]` = frames of clip i left out at its head (the clip is then frames skip…skip+frames of its picture, and
 *  the same stretch of its sound); `head` = clip 0 is the last `head` frames of the shot BEFORE this part's first
 *  shot, and all of it dissolves into clip 1; `fadeIn` / `fadeOut` = the film is joined STRAIGHT to what comes
 *  before / after this graph, so its sound meets there in the same 12 ms fades two runs meet in. */
export function joinGraph(o: { frames: ReadonlyArray<number>; seams?: ReadonlyArray<Seam>; prep: string; silent?: ReadonlyArray<boolean>; dissolve?: boolean; hold?: number; skip?: ReadonlyArray<number>; head?: number; fadeIn?: boolean; fadeOut?: boolean }): { graph: string; frames: number } {
  const n = o.frames.map((f) => Math.max(1, Math.round(Number(f) || 0)));
  if (!n.length) return { graph: "", frames: 0 };
  const hold = Math.max(3, Math.ceil(Number(o.hold) || 0));
  const head = n.length > 1 && Number(o.head) > 0 ? Math.max(1, Math.min(n[0], n[1] - 1, Math.round(Number(o.head)))) : 0;
  const g: string[] = [];
  n.forEach((frames, i) => {
    const skip = Math.max(0, Math.round(Number(o.skip?.[i]) || 0));
    // the picture, exactly `frames` long: brought to 30 fps, its last frame held as long as it must be, then cut
    g.push(`[${i}:v]${o.prep},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${hold},trim=${skip ? `start_frame=${skip}:` : ""}end_frame=${skip + frames},setpts=PTS-STARTPTS[v${i}]`);
    // …and its sound exactly as long: cut, or padded with silence (a clip with no sound gets silence)
    const samples = frames * SAMPLES_PER_FRAME;
    g.push(o.silent?.[i]
      ? `anullsrc=r=${FILM_RATE}:cl=stereo,atrim=end_sample=${samples},asetpts=PTS-STARTPTS[a${i}]`
      : `[${i}:a]aresample=${FILM_RATE},aformat=sample_rates=${FILM_RATE}:channel_layouts=stereo,asetpts=PTS-STARTPTS,apad,atrim=${skip ? `start_sample=${skip * SAMPLES_PER_FRAME}:` : ""}end_sample=${skip * SAMPLES_PER_FRAME + samples},asetpts=PTS-STARTPTS[a${i}]`);
  });
  // runs of shots joined by dissolves; a straight cut starts a new run
  const runs: number[][] = [];
  n.forEach((_, i) => {
    if (i === 0 || o.dissolve === false || seamFrames(o.seams?.[i]) === 0) runs.push([i]);
    else runs[runs.length - 1].push(i);
  });
  const joined = runs.map((run, r) => {
    let v = `v${run[0]}`, a = `a${run[0]}`, len = n[run[0]];
    run.slice(1).forEach((i, k) => {
      // (never longer than either shot it joins — and the tail of the shot before a part dissolves WHOLE into the
      //  part's first shot: it is exactly as long as the dissolve it was cut for)
      const fade = head && i === 1 ? head : Math.max(1, Math.min(seamFrames(o.seams?.[i]), len - 1, n[i] - 1));
      const vo = `r${r}v${k}`, ao = `r${r}a${k}`;
      g.push(`[${v}][v${i}]xfade=transition=fade:duration=${frameSecs(fade)}:offset=${frameSecs(len - fade)}[${vo}]`);
      g.push(`[${a}][a${i}]acrossfade=d=${frameSecs(fade)}[${ao}]`);
      v = vo; a = ao; len += n[i] - fade;
    });
    return { v, a, frames: len };
  });
  // a straight cut is a join; its sound meets in two 12 ms fades, out then in, so that it never clicks
  const meets = (p: { frames: number }, r: number): string[] => [
    ...(r > 0 || o.fadeIn ? ["afade=t=in:d=0.012"] : []),
    ...(r < joined.length - 1 || o.fadeOut ? [`afade=t=out:st=${(p.frames / FILM_FPS - 0.012).toFixed(6)}:d=0.012`] : []),
  ];
  if (joined.length === 1) {
    g.push(`[${joined[0].v}]null[vc]`, `[${joined[0].a}]${meets(joined[0], 0).join(",") || "anull"}[ac]`);
  } else {
    const parts = joined.map((p, r) => {
      g.push(`[${p.a}]${meets(p, r).join(",")}[j${r}]`);
      return `[${p.v}][j${r}]`;
    });
    g.push(`${parts.join("")}concat=n=${joined.length}:v=1:a=1[vc][ac]`);
  }
  return { graph: g.join(";"), frames: joined.reduce((s, p) => s + p.frames, 0) };
}

/** How many frames each seam dissolves over, as joinGraph joins them (0: a straight join — and seam 0, which
 *  joins nothing). The one sum both ways of joining a film agree on: its length is its shots less these. */
export function seamFades(frames: ReadonlyArray<number>, seams?: ReadonlyArray<Seam>, dissolve = true): number[] {
  const n = frames.map((f) => Math.max(1, Math.round(Number(f) || 0)));
  let len = 0;
  return n.map((f, i) => {
    if (i === 0 || dissolve === false || seamFrames(seams?.[i]) === 0) { len = f; return 0; }
    const fade = Math.max(1, Math.min(seamFrames(seams?.[i]), len - 1, f - 1));
    len += f - fade;
    return fade;
  });
}

/* ---- A LONG FILM IS JOINED IN PARTS ----
 * joinGraph opens every clip of the film in ONE ffmpeg. That was six clips at most; a five-minute film is fifty
 * (film-length.ts), in Full HD, on a server with 2 GB — and an encode there is stopped at ten minutes
 * (ugc-ad-pipeline.server.ts → runFfmpeg), which nine thousand frames of 1080p do not fit in. So a film of more
 * than JOIN_PART_CLIPS clips is joined in PARTS: each part is a handful of its shots, joined by the very graph
 * above and encoded the way the film is; then the parts are put end to end WITHOUT being encoded again (their
 * picture is copied; only the sound — kept uncompressed until then — is encoded, once, for the whole film).
 * A part ends where the film already cuts straight — a change of place — whenever one is within reach. Where
 * none is (a long scene in one room), it ends at a dissolve, and the dissolve is not lost: the part before it
 * stops short by the dissolve's frames, and the next part opens the same shot again for just those frames and
 * dissolves them into its own first shot. Frame for frame, and sample for sample, the film is the one a single
 * graph would have made (tests/acted-staging.test.ts joins twenty-seven clips both ways and counts them). */

/** No more clips than this are opened by one ffmpeg: what a whole film had at most until 2026-11-25, joined on
 *  the live server every day. */
export const JOIN_PART_CLIPS = 6;

export type JoinPart = {
  /** the clips this part opens, by their place in the film, in the order its graph reads them — when `carried`,
   *  the first is the shot BEFORE the part's own first shot, opened again for its last frames */
  clips: number[];
  /** the part's own shots: from `from` up to, not including, `to` */
  from: number; to: number;
  /** frames of dissolve this part carries in from the shot before it (0: it begins at a straight cut, or the film) */
  carried: number;
  graph: string;
  /** how long the part is, in frames */
  frames: number;
};

/** THE FILM IN PARTS. The same arguments as joinGraph (for the whole film), and `most` = how many clips one part
 *  may open (JOIN_PART_CLIPS). Returns the parts in order and the film's length in frames — the sum of theirs,
 *  which is what a single graph of the same shots comes to. */
export function joinParts(o: { frames: ReadonlyArray<number>; seams?: ReadonlyArray<Seam>; prep: string; silent?: ReadonlyArray<boolean>; dissolve?: boolean; hold?: number; most?: number }): { parts: JoinPart[]; frames: number } {
  const n = o.frames.map((f) => Math.max(1, Math.round(Number(f) || 0)));
  const N = n.length;
  const fades = seamFades(n, o.seams, o.dissolve);
  const most = Math.max(2, Math.round(Number(o.most) || JOIN_PART_CLIPS));
  // a dissolve can be carried over a part's edge when both its shots outlast it with room to spare (always, for a
  // real shot: a dissolve is ten frames at most) — and the shot before it can still give its own head away
  const carries = (c: number): boolean => n[c] >= fades[c] + 2 && n[c - 1] - fades[c] >= fades[c - 1] + 2;
  const parts: JoinPart[] = [];
  let from = 0;
  while (from < N) {
    const carried = from > 0 ? fades[from] : 0;
    // (the shot opened again for its tail is one of the clips this part opens)
    let to = Math.min(N, from + most - (carried ? 1 : 0));
    if (to < N) {
      let cut = -1;
      // the LAST straight cut within reach; failing that, the last dissolve there that can be carried
      for (let c = to; c > from && cut < 0; c--) if (fades[c] === 0) cut = c;
      for (let c = to; c > from && cut < 0; c--) if (carries(c)) cut = c;
      // (shots too short to carry a dissolve across: the part runs on to the first seam that can be cut)
      for (let c = to + 1; c < N && cut < 0; c++) if (fades[c] === 0 || carries(c)) cut = c;
      to = cut < 0 ? N : cut;
    }
    const own = Array.from({ length: to - from }, (_, k) => from + k);
    const tail = to < N ? fades[to] : 0;
    const clips = carried ? [from - 1, ...own] : own;
    const made = joinGraph({
      frames: [...(carried ? [carried] : []), ...own.map((i) => n[i] - (i === to - 1 ? tail : 0))],
      // (the seams as the whole film has them, in frames — a part must not work them out again from its own shots)
      seams: [...(carried ? [null, carried] : [null]), ...own.slice(1).map((i) => fades[i])],
      skip: carried ? [n[from - 1] - carried, ...own.map(() => 0)] : undefined,
      head: carried || undefined,
      prep: o.prep, hold: o.hold,
      silent: clips.map((i) => !!o.silent?.[i]),
      fadeIn: from > 0 && !carried,
      fadeOut: to < N && !tail,
    });
    parts.push({ clips, from, to, carried, graph: made.graph, frames: made.frames });
    from = to;
  }
  return { parts, frames: parts.reduce((s, p) => s + p.frames, 0) };
}

/** A part is kept, between its making and the film's last pass, as a QuickTime file: its picture encoded the way
 *  the film's is, its sound uncompressed — so that the parts meet on a sample, and the film's sound is encoded
 *  once, whole (AAC is written in blocks of 1,024 samples: nine parts encoded apart would each end on a rounded
 *  block, and the picture would drift from the sound by up to a fifth of a second). */
export const JOIN_PART_SOUND = ["-c:a", "pcm_s16le"] as const;

/** The encoder's arguments, told apart: what encodes the PICTURE (every part gets these), what encodes the SOUND
 *  and what is the file's own (the film's last pass gets those). Flags come in pairs: a flag, then its value. */
export function joinEncode(encode: ReadonlyArray<string>): { picture: string[]; sound: string[]; file: string[] } {
  const out = { picture: [] as string[], sound: [] as string[], file: [] as string[] };
  for (let i = 0; i < encode.length; i += 2) {
    const flag = String(encode[i]);
    const to = /^-(?:c:a|codec:a|acodec|b:a|ar|ac|q:a)$/.test(flag) ? out.sound : flag === "-movflags" ? out.file : out.picture;
    to.push(...encode.slice(i, i + 2));
  }
  return out;
}

/** ffmpeg's arguments for ONE part: its clips (`files`, in the part's own order), its graph, the film's picture
 *  encoder, uncompressed sound, into `out` (a .mov). */
export function joinPartArgs(part: { graph: string }, files: ReadonlyArray<string>, encode: ReadonlyArray<string>, out: string): string[] {
  return ["-y", ...files.flatMap((f) => ["-i", f]), "-filter_complex", part.graph, "-map", "[vc]", "-map", "[ac]", ...joinEncode(encode).picture, ...JOIN_PART_SOUND, "-f", "mov", out];
}

/** The list the last pass reads: every part's file and its exact length (so each part starts on the frame the
 *  one before it ended — a file's own length is only kept to the millisecond). */
export function joinList(files: ReadonlyArray<string>, frames: ReadonlyArray<number>): string {
  return files.map((f, i) => `file '${String(f).replace(/\\/g, "/").replace(/'/g, "'\\''")}'\nduration ${frameSecs(frames[i])}\n`).join("");
}

/** ffmpeg's arguments for the film's LAST pass: the parts end to end, their picture copied as it is, their sound
 *  encoded once. */
export function joinFilmArgs(list: string, encode: ReadonlyArray<string>, out: string): string[] {
  const e = joinEncode(encode);
  return ["-y", "-f", "concat", "-safe", "0", "-i", list, "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy", ...e.sound, ...e.file, out];
}

/** IS THE FINISHED FILM WHOLE? Its picture and its sound the same length, and the length its shots add up to
 *  (`frames`, from joinGraph), each within JOIN_TOLERANCE. `video`/`audio` = the file's two streams' lengths in
 *  seconds (audio null: the file has no sound — only its picture is measured). The reason, when it is not. */
export function joinCheck(o: { video: number | null | undefined; audio: number | null | undefined; frames?: number }): { ok: boolean; why: string } {
  const v = Number(o.video), a = o.audio == null ? null : Number(o.audio);
  if (!(v > 0)) return { ok: false, why: "the finished file has no picture" };
  if (a !== null && !(Math.abs(v - a) <= JOIN_TOLERANCE)) return { ok: false, why: `its picture runs ${v.toFixed(3)} s and its sound ${a.toFixed(3)} s` };
  const want = o.frames && o.frames > 0 ? o.frames / FILM_FPS : 0;
  if (want && !(Math.abs(v - want) <= JOIN_TOLERANCE)) return { ok: false, why: `its picture runs ${v.toFixed(3)} s where its shots add up to ${want.toFixed(3)} s` };
  return { ok: true, why: "" };
}
