/* THE SHOT PLAN — a told story is not filmed from one spot.
 *
 * The owner, 2026-11-24, looking at a Horror Story in his Archive: "the two characters standing side by
 * side isnt always how a scene is or how things are filmed, sometimes theree is distance and they walk
 * forward yanno?"
 *
 * He was right, and it was nobody's decision: a scene's picture was drawn from "who is in it, where, doing
 * what", and a picture model asked for two people draws two people standing side by side, mid-frame,
 * looking out at us. (Worse: every scene set at a place with a design sheet was also told "the camera is
 * near them — each one fills at least a third of the picture's height", which made every such picture the
 * same medium two-shot.) Nothing ever said how a scene is SEEN.
 *
 * So a story gets a shot plan before it is written: one way of seeing for each scene — from far back, over
 * a shoulder, one near and one far, somebody walking toward us, a face, a detail — dealt so that no two
 * neighbours are seen the same way and every story has distance in it. The plan is used three times:
 *
 *   · THE WRITER is given the list and writes each VISUAL to fit its line (the picture is drawn from words,
 *     so where each one stands has to be IN the words);
 *   · THE PICTURE is told the camera in one plain line of its own;
 *   · THE MOTION follows it: somebody caught mid-stride walks; a face barely moves.
 *
 * Pure. tests/story-shots.test.ts holds it. */

export type StoryShot = "wide" | "walk" | "depth" | "over" | "close" | "low" | "two" | "detail";

type ShotSpec = {
  /** What the writer is told this scene is seen as. */
  write: string;
  /** The one line the picture model is given. */
  camera: string;
  /** What moves, for the engine that brings the picture to life. */
  motion: string;
  /** Is everybody in it small or seen from afar? (A place's design sheet is then not "kept near".) */
  far?: boolean;
};

export const STORY_SHOTS: Record<StoryShot, ShotSpec> = {
  // (…and the VISUAL says what fills the top and the bottom of the picture: "WIDE: inside the bakery, Humphrey stands
  //  small before the cast-iron oven…" named nothing above or below him, and in a tall frame it came back as a landscape
  //  of the bakery with an empty cream band under it, 2026-11-26 — full-frame.ts)
  wide: {
    write: "WIDE — the place is the picture: we see it whole, from far back, and whoever is in it is small in it (a quarter of the frame's height at most); say what fills the TOP of the picture and what fills the BOTTOM (the ceiling and the floor, the sky and the ground)",
    camera: "CAMERA: a wide shot from far back — the place fills the frame and every figure in it is small, a quarter of the picture's height at most, each at its true size beside the others and the place (whoever is farther away is smaller).",
    motion: "The camera drifts very slowly forward. Everybody holds their place; only small movement.",
    far: true,
  },
  walk: {
    write: "WALKING — somebody is caught mid-stride, walking TOWARD the camera: alone in the frame, or with the other a few steps behind them; the way they came stretches away behind",
    camera: "CAMERA: straight ahead of them at eye level — caught mid-stride, walking toward us, full figure in view, the way they came stretching away behind.",
    motion: "Whoever is mid-stride walks slowly and steadily toward the camera, keeping exactly the body, face and clothes they have in the picture. The camera holds still.",
  },
  // (NEVER A STRANGER TO FILL THE SHOT, 2026-11-24: the kids' horror story's door scene was planned "over" and
  //  written naming only the ghost at the glass — and the camera line's "nearer figure seen from BEHIND" was
  //  drawn as a grown man in a dark jumper, who then walked to the door in the clip. Each line that wants a
  //  figure near the lens now says it is one of the people the words NAME, and what stands there instead.)
  depth: {
    write: "NEAR AND FAR — one of them close to the camera at one edge of the frame (perhaps only a shoulder, or half a face), the other far off and small, deep in the picture, with clear distance between them",
    camera: "CAMERA: deep staging — one figure close to the lens at one edge of the frame, the other far away and small in the background, real distance between them. Both are people these words NAME; when they name only one, the near edge is a thing of the place (a door frame, a lamp, a chair back) — never a stranger.",
    motion: "Both hold their places; only small movement. The camera holds still.",
    far: true,
  },
  over: {
    write: "OVER THE SHOULDER — from just behind one of them (their back and shoulder dark in the foreground), looking at who or what they are looking at, several steps away; NAME whose shoulder it is (\"over NAME's shoulder\") — never the shoulder of the one this scene's CAPTION is about: they are the one we see beyond it, facing us",
    camera: "CAMERA: over the shoulder — the nearer figure is one of the people these words NAME, seen from BEHIND, large in the foreground at one side; beyond them, several steps away, is what they are looking at. When these words name nobody to stand there, the foreground is the dark edge of the place instead (a door frame, a curtain, a chair back) — never a stranger.",
    motion: "Both hold their places; only small movement. The camera holds still.",
  },
  // (…looking at what the moment is about, never at us: a boy written "at the window looking out", seen CLOSE,
  //  came back as a portrait staring into the lens with the window beside him — the owner: "the kid not even
  //  looking out the window", 2026-11-25)
  close: {
    write: "CLOSE — one face fills the frame (ONE character only, even if the other is nearby), and what they feel is on it; their eyes are on what they are looking at — the window, the door, the dark — never on us",
    camera: "CAMERA: a close-up — one face fills most of the frame, the background soft behind it; the eyes are on whatever this moment has them looking at, off to one side of the lens — never into it.",
    motion: "Almost still: a breath, the eyes moving, one slow blink. The camera holds still.",
  },
  low: {
    write: "FROM BELOW — the camera is low, near the ground, looking up at them against the sky, the ceiling or the trees",
    // (…standing where people stand: a low angle at a window stood two children up on its sill, 2026-11-24)
    camera: "CAMERA: a low angle from near the ground, looking up — they tower in the frame against what is above them, their feet on the floor or the ground where they stand (never up on a ledge or a sill).",
    motion: "They hold their places; only small movement. The camera rises very slightly.",
  },
  two: {
    write: "TOGETHER — both in the frame from the knees up, turned toward EACH OTHER (never lined up facing us), in the middle of what this moment is about",
    camera: "CAMERA: a medium shot from the knees up — they are turned toward each other, not posed side by side facing the camera.",
    motion: "Both hold their places; only small movement. The camera drifts very slowly forward.",
  },
  detail: {
    // (ONE PERSON'S HANDS: a tester's Moral Story, 2026-11-24, ended on "the boy's small hand and the old man's
    //  hand on the neck of the sack" — and the picture melted the two hands into one; a picture model cannot
    //  keep two people's fingers apart on one thing filling the frame)
    write: "A DETAIL — no face at all: ONE person's hand (or their two hands), an object, a footprint, a door handle — the one thing this moment turns on, filling the frame (name nobody in this VISUAL unless it is their hand or their paw). Never two people's hands together on one thing — when two share it, the DETAIL is the thing itself, or one of their hands on it. A hand in it is always somebody's, and the VISUAL says whose (\"Nadia's small hand on the lock\"), never just \"a hand\" (2026-11-25: \"a hand turning the small brass lock\" in a story about two children was drawn as a grown man's)",
    camera: "CAMERA: an extreme close-up of that one thing — it fills the frame; no faces in the picture; at most one person's hands, and they are the hands of whoever these words name (a child's hand is a child's: small).",
    motion: "Almost still: the smallest movement. The camera holds still.",
  },
};

const KEYS = Object.keys(STORY_SHOTS) as StoryShot[];
export const isStoryShot = (v: unknown): v is StoryShot => typeof v === "string" && (KEYS as string[]).includes(v);
/** The way a scene is seen, as it was planned — or null for a scene that has none (every story written
 *  before 2026-11-24, a scene the maker added by hand): it is drawn as scenes always were. */
export const shotOf = (scene: { cam?: unknown } | null | undefined): StoryShot | null => (scene && isStoryShot(scene.cam) ? scene.cam : null);

/* THE WORDS SAY HOW IT IS SEEN. The writer is handed the plan in order, and may write a scene as another line of
 * it: the kids' horror story of 2026-11-24 had its plan "wide" on the window scene and "over" on the sofa scene —
 * and the writer wrote "Over Walt's shoulder, inside at the living room window…" and "Wide shot of the living
 * room: Pearl and Walt sit small together on the sofa". The sofa picture was then told "over the shoulder" by its
 * camera line and "wide, both on the sofa" by its words — and came back with a big dark figure looming in the
 * foreground and one child on the sofa. A scene's words that OPEN by naming how it is seen are what it is drawn
 * from, what moves, and what the maker reads and can change — so they win over the plan's tag. */
const SHOT_WORDS: Array<[StoryShot, RegExp]> = [
  ["over", /^over (?:the |[\p{L}'’.-]+(?:['’]s)? )?shoulder\b/iu],
  ["depth", /^near and far\b/i],
  ["wide", /^(?:a\s+)?wide(?:\s+shot)?\b|^from far (?:back|away)\b/i],
  ["low", /^from below\b|^(?:a\s+)?low[- ]angle\b|^from the ground\b/i],
  ["detail", /^(?:a\s+)?detail\b/i],
  ["close", /^(?:a\s+)?close-?up\b|^close\s*[:—–-]/i],
  ["two", /^together\s*[:—–-]/i],
  ["walk", /^walking\s*[:—–-]|^mid-stride\b/i],
];
/** How a scene's own words say it is seen — when they OPEN by naming it ("Wide shot of…", "Over Walt's shoulder,",
 *  "A detail:", "From below,"); null when they do not (the plan's tag then stands). A place the words are set at
 *  ("At the house: …") is read past first. */
export function shotInWords(visual: string | null | undefined): StoryShot | null {
  const v = String(visual || "").replace(/\s+/g, " ").trim().replace(/^at [^:]{1,60}:\s*/i, "");
  for (const [k, re] of SHOT_WORDS) if (re.test(v)) return k;
  return null;
}
/** The way a scene is seen: what its words say, else what was planned. */
export const sceneShot = (scene: { cam?: unknown; visual?: string | null } | null | undefined): StoryShot | null => (scene ? shotInWords(scene.visual) ?? shotOf(scene) : null);

/** How a story OPENS, how it ENDS, and what it must have somewhere. */
const OPENERS: StoryShot[] = ["wide", "walk", "depth", "low"];
const CLOSERS: StoryShot[] = ["close", "depth", "over", "low", "detail"];
const DISTANT: StoryShot[] = ["walk", "depth", "over", "wide"];
/** How many of one kind a story may have: a face twice, everything else once — and the old default, two
 *  people in a medium shot, once in a short story. */
const MOST: Partial<Record<StoryShot, number>> = { close: 2, detail: 1, two: 1, low: 1 };

/** The plan for a story of `n` scenes: one way of seeing each. No two neighbours alike, an opening that
 *  shows where we are, an ending that lands on somebody (or on the one thing), and distance in it at least
 *  twice. `rand` is a 0–1 source (Math.random, or a fixed one in a test). */
export function planShots(n: number, rand: () => number = Math.random): StoryShot[] {
  const count = Math.max(0, Math.min(24, Math.floor(n || 0)));
  if (!count) return [];
  const pick = <T,>(a: T[]): T => a[Math.min(a.length - 1, Math.floor(rand() * a.length))];
  const used: Partial<Record<StoryShot, number>> = {};
  const take = (k: StoryShot): StoryShot => { used[k] = (used[k] || 0) + 1; return k; };
  const room = (k: StoryShot): boolean => (used[k] || 0) < (MOST[k] ?? Math.max(1, Math.ceil(count / 4)));
  const out: StoryShot[] = [take(pick(OPENERS))];
  for (let i = 1; i < count; i++) {
    const last = i === count - 1;
    const from = (last ? CLOSERS : KEYS).filter((k) => k !== out[i - 1] && room(k));
    // (the story has not had enough distance yet, and it is running out of scenes to have it in)
    const owed = 2 - out.filter((k) => DISTANT.includes(k)).length;
    const mustBeDistant = !last && owed > 0 && count - 1 - i <= owed;
    const pool = mustBeDistant ? from.filter((k) => DISTANT.includes(k)) : from;
    // (the last scene ALWAYS lands on a closer — when every one of them has been used as often as it may
    //  be, one is used once more rather than ending the story on a wide shot)
    const usable = pool.length ? pool : from.length ? from : (last ? CLOSERS : KEYS).filter((k) => k !== out[i - 1]);
    out.push(take(pick(usable)));
  }
  return out;
}

/** The names a VISUAL opens with — one per way of seeing, each read back by shotInWords. */
export const SHOT_NAME: Record<StoryShot, string> = { wide: "WIDE", walk: "WALKING", depth: "NEAR AND FAR", over: "OVER THE SHOULDER", close: "CLOSE", low: "FROM BELOW", two: "TOGETHER", detail: "A DETAIL" };
const SHOT_LABELS = (Object.keys(SHOT_NAME) as StoryShot[]).map((k) => `"${SHOT_NAME[k]}:"`).join(", ");

/** The plan as it is handed to the story's writer. */
export function shotListBrief(plan: ReadonlyArray<StoryShot>): string {
  if (!plan.length) return "";
  // (EVERY VISUAL OPENS WITH ITS LINE'S NAME: the writer, handed the list in order, wrote a story's scenes as
  //  OTHER lines of it — "Close on Edvin's face…" on the WALKING line, "Walking toward the camera down a dark
  //  hallway" on A DETAIL — and each picture was then told one camera by its line and another by its words: the
  //  boy stared into the lens, his run down the hall became a hand on a doorknob (2026-11-25). The one story whose
  //  writer had opened every VISUAL with its line's name came out right in every scene. shotInWords reads it.)
  return (
    `THE SHOT LIST — a film is not shot from one spot, and people in it do not line up side by side facing the camera. Each scene is SEEN in the way its line says; write its VISUAL so the picture comes out that way, saying where each one is — near us or far off, facing us or seen from behind, walking or still. When a line is written for two and your scene has one (or the other way round), keep its distance and its angle and stage whoever is there:\n` +
    plan.map((k, i) => `  ${i + 1}. ${STORY_SHOTS[k].write}`).join("\n") +
    `\nEVERY VISUAL OPENS WITH THE NAME OF THE LINE IT IS SEEN AS, in capitals, and a colon — ${SHOT_LABELS} — and then describes exactly that way of seeing. You may give a scene another line of the list than its number when the story needs it; its VISUAL then opens with THAT line's name.\n`
  );
}

/* A WIDE VIEW IN A TALL FRAME IS STILL A TALL PICTURE (2026-11-26, the live still story "What His Hands Remember"): its
 * first scene, "WIDE: inside the bakery, Humphrey stands small before the cast-iron oven…", in a 9:16 story, came back as
 * the bakery drawn as a LANDSCAPE picture across the middle of the tall frame, a strip of it repeated above and an empty
 * cream band below — and the picture had been told "a tall vertical picture that fills the whole frame from edge to edge"
 * first thing, and "ONE single continuous picture … filling the whole frame" later. Told "a wide shot", a picture model
 * draws a wide picture. So a shot that is seen from far back is told, with its camera line, the shape of the frame it is
 * composed for — and, in a wide frame, a shot that stands a figure up full height is told the same the other way round. */
const FAR_IN_TALL: ReadonlyArray<StoryShot> = ["wide", "depth"];
const TALL_IN_WIDE: ReadonlyArray<StoryShot> = ["walk", "low"];
export const TALL_FRAME_WIDE = "This far view is composed for a TALL frame: the place fills it from the top edge to the bottom edge — the ceiling or the sky at the top, the floor or the ground at the bottom — never a wide picture inside a tall one: nothing empty above it or below it, nothing drawn twice.";
export const WIDE_FRAME_TALL = "This view is composed for a WIDE frame: the place stretches across it from the left edge to the right edge — never a tall picture inside a wide one: nothing empty beside it, nothing drawn twice.";
/** The frame's own shape, said for a shot that a picture model would otherwise draw in the other shape ("" for any
 *  other shot, any other frame, or a scene with no plan). `aspect` as the story is drawn: "9:16", "16:9", "1:1". */
export function frameShapeLine(shot: StoryShot | null | undefined, aspect: string | null | undefined): string {
  if (!shot) return "";
  if (aspect === "16:9") return TALL_IN_WIDE.includes(shot) ? WIDE_FRAME_TALL : "";
  if (aspect === "1:1") return "";
  return FAR_IN_TALL.includes(shot) ? TALL_FRAME_WIDE : "";
}

/** The line the picture model is given for a scene seen this way ("" for a scene with no plan) — and, given the shape
 *  of the frame, that shape where the shot needs it said (frameShapeLine). */
export const cameraLine = (shot: StoryShot | null | undefined, aspect?: string | null): string => (shot && STORY_SHOTS[shot] ? [STORY_SHOTS[shot].camera, aspect === undefined ? "" : frameShapeLine(shot, aspect)].filter(Boolean).join(" ") : "");
/** Is everybody in this shot meant to be small or far? */
export const shotIsFar = (shot: StoryShot | null | undefined): boolean => !!(shot && STORY_SHOTS[shot]?.far);
/** What moves in a scene seen this way ("" → the engine's ordinary small motion). */
export const shotMotion = (shot: StoryShot | null | undefined): string => (shot && STORY_SHOTS[shot] ? STORY_SHOTS[shot].motion : "");
