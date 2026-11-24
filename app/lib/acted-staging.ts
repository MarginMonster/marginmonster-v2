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
  /** "vertical composition" … */
  comp: string;
}): string {
  const stage = stagingPicture(o.staging);
  if (!stage) return "";
  const lead = o.cartoon
    ? "A single frame from a bright, glossy 3D-animated CARTOON film (modern wholesome preschool-cartoon look: rounded friendly character designs, big expressive eyes, soft candy colors)"
    : "A single photorealistic frame from a live-action film";
  const act = oneLine(o.act).replace(/[\s.!?;,]+$/, "");
  const mood = oneLine(o.mood);
  const moment = act
    ? ` THE MOMENT this frame is taken at: ${act} — everything it names (what somebody holds, what is being done, what is in the place) is IN the picture, seen the way the moment says it is seen, and well above the picture's bottom edge. Draw the instant it BEGINS, before it is done, so that it can happen in the seconds that follow: ONE picture of ONE instant — never a split screen, panels or a before-and-after. Where the moment says how somebody is placed (standing, sitting, crouching, walking), the moment decides; the distance between the two, the camera and their faces stay as described above.`
    : "";
  const tail = o.cartoon
    ? `Clean cheerful cartoon lighting, soft candy colors, rounded friendly shapes, ${o.comp}, no on-screen text, no watermark.`
    : `Cinematic filmic lighting, both of them in sharp focus, ${o.comp}, no on-screen text, no watermark.`;
  return `${lead}: BOTH people together in ${o.setting}, in the middle of a scene. ${stage} ${o.personA} on one side and ${o.personB} on the other, both faces prominent and in focus — each in their own half of the frame, never one directly in front of the other. This is NOT an over-the-shoulder shot: neither person is turned fully away, cropped out, or blurred in the foreground; both are equally sharp. Both are in the SAME space — NOT separated by any window, glass pane, partition, railing, counter, doorway or divider BETWEEN them; if the setting has a window it stays in the BACKGROUND behind or beside them, never between them and never splitting the frame down the middle. Nothing is added to the place that does not belong in it — no table, booth or chairs on a street, in a hallway or outdoors.${moment}${mood ? ` ${mood}` : ""} ${o.consistency} ${HANDS}${o.roomNote || ""}${o.faceNote || ""} ${tail}`;
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

/** Is something DONE in this shot — was its clip told an event, or a walk? (Read off the prompt the shot
 *  was rendered from, so a shot rolled again later is treated the way it was the first time.) The cut that
 *  takes a long pause out of the MIDDLE of a take was made for two people standing still, where it cannot
 *  be seen; in a shot where somebody is moving it would make them jump — so such a shot keeps its pause. */
export const clipMoves = (prompt: string | null | undefined): boolean => {
  const p = String(prompt || "");
  return p.includes(EVENT_LEAD) || p.includes(ACTED_STAGINGS.walk.clip);
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
 *  is said (EVENT_MAX unless told). Not a staging → the rules as they came. */
export function stagedRules<T extends ClipNotes>(base: T, o: { staging?: unknown; event?: string | null; eventMax?: number; others?: ReadonlyArray<{ name: string; side: string }> }): T {
  if (!isActedStaging(o.staging)) return base;
  const spec = ACTED_STAGINGS[o.staging];
  const event = clipEvent(o.event, o.eventMax && o.eventMax > 0 ? o.eventMax : EVENT_MAX);
  const who = event
    ? (o.others || []).map((p) => {
        const name = oneLine(p?.name);
        const side = oneLine(p?.side);
        if (!name || !side) return "";
        let said: RegExpExecArray | null = null;
        try { said = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, "iu").exec(event); } catch { /* a name no pattern can be made of is simply not placed */ }
        return said ? `${said[0]} is on the ${side}.` : "";
      }).filter(Boolean).join(" ")
    : "";
  const does = event ? `${who ? `${who} ` : ""}${EVENT_LEAD} ${event}` : "Only natural talking, small gestures and shifts of weight.";
  const rest = event ? "Nothing else" : "Nothing";
  const alive = /background stays/.test(base.look) ? " The background stays gently alive." : "";
  // (where the camera travels, what is BEHIND them cannot stay "identical … throughout" — told that, two
  //  people walk on the spot: it is the PLACE that stays the same)
  const lock = (note: string): string => (spec.camera ? lockOf(note).replace(/\bbackground\b/g, "place") : lockOf(note));
  return {
    ...base,
    look: `${lock(base.look)} ${spec.clip} ${does}${alive} ${rest} new enters and no new object appears; anything held keeps its exact size and shape.`,
    lookTight: `${lock(base.lookTight)} ${spec.clip} ${does} ${rest} new enters; held things keep their size and shape.`,
    lookShort: `${lock(base.lookShort)} ${spec.clip} ${does}`,
    steady: spec.camera ? base.steady.replace(CAMERA_LOCKED, spec.camera) : base.steady,
  };
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

/** What replaced 'SHOT — set this to EXACTLY "wide two-shot" for EVERY beat'. */
export const CAMERA_IS_DEALT = "THE CAMERA IS NOT YOURS — how the two are placed and filmed in each place (how far apart they are, who is nearer, standing or seated or walking, where the camera is) is dealt by the film itself: one staging for each location, and no two locations alike. So there is no \"shot\" field, and no VISUAL names a shot size, a lens, an angle or a \"two-shot\". Never write the two side by side or shoulder to shoulder: people in a film keep a natural distance, and look at each other or at what they are doing — not at us.";

/** The pipeline shows exactly two people. An idea that has somebody ALONE still gets a second — so the
 *  second has to come out of the idea. */
export const TWO_ALWAYS = "ALWAYS THE SAME TWO — both are in every shot. If the idea has somebody ALONE, the second one must BELONG there, and the first lines make it plain why they are there: somebody who came because of what is happening (a neighbour who came to check, a friend who was called, a relative with a key) — or, when it can speak, the very thing the idea is about (the voice turns out to be somebody). Never a stranger who is simply in the room. It stays the story of the one who was alone: the other came INTO it.";

/** A horror film only: what its last shot is. (What the thing IS, and how little of it is shown, is said once
 *  — story-picture.ts → WHAT_FRIGHTENS, which the writer is given after this.) */
export const SEEN_AT_THE_END = "THE LAST SHOT IS SEEN, NOT SAID — a horror film ends on something the viewer SEES, not on a line about it. In the LAST shot's VISUAL the thing this story has been circling is IN the picture with the two of them, seen the way WHAT FRIGHTENS (below) says such a thing is seen — a part of it, at the edge of the light, behind one of them — and what HAPPENS in that shot is IT: it moves, it is nearer than it was, the one who has not seen it turns round. When it is not one of the two, it has no \"cast\" entry: say what it is, and the one or two things that are wrong with it, in that VISUAL (which may run to 40 words). And give that shot a WHERE of its own — the exact spot it is seen from, in its own words, even if that is only a few steps on from the place before — so that its picture is drawn WITH the thing in it.";
