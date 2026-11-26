/* HOW LONG A FILM IS — said in ONE place, for the page that asks and for the two engines that make it.
 *
 * The owner, 2026-11-25, of the Length step (five buttons, "≈ 10s · 2 shots" to "≈ 30s · 6 shots"): "The how long
 * can be adjusted to a sexy slider allowing up to 5 minutes with estimated final pricing for generations".
 *
 * A film's length is a number of SHOTS (an acted film: one spoken line on camera each) or of SCENES (a told
 * story: one picture and two or three spoken sentences each) — up to five minutes of either. Everything a page
 * shows about that number comes from here: how long it runs, what it will cost, how long it takes to make. Both
 * engines hold a film to the very same numbers (film-engine.server.ts → filmShots), so the page can never offer
 * a length that is not made.
 *
 * …and a film that long is not written in one breath: the second half of this file says how its script is dealt
 * into PARTS, each written on its own under one plan (A LONG SCRIPT IS WRITTEN IN PARTS, below).
 *
 * Pure: no imports, safe in the browser. tests/film-length.test.ts. */

/** The two ways a story format is made: ACTED (the cast speak on camera — film-dialogue.server.ts) or NARRATED
 *  (a storyteller's voice over pictures — narrated-story.server.ts). */
export type FilmWay = "acted" | "narrated";

/** The longest film either engine makes, in seconds: five minutes. */
export const MAX_FILM_SECONDS = 300;

/** WHAT ONE SHOT COMES TO IN THE FINISHED FILM, in seconds.
 *  ACTED — a written line is 15–18 words, two sentences: speech-meter.ts puts that at about 5.4 s said
 *  (16.5 words × 0.28 s, the 0.4 s onset, three small pauses); the trim leaves a breath at each end
 *  (clip-trim.ts: LEAD 0.12–0.2 s, TAIL_KEEP 0.45 s) and each dissolve takes a few frames back. The five-shot
 *  films made on the live site on the morning of 2026-11-25 ran 26 to 32 seconds: 5.8 a shot. (The Length card
 *  said 5 — speech-meter's TYPICAL_SHOT_SECONDS — and those films all ran longer than their card.)
 *  NARRATED — a scene is "2-3 sentences, about 25-35 words"; the five-scene stories of the same morning ran 47
 *  to 50 seconds with their 0.8 s tail: 9.5 a scene in an ordinary voice. A slow, performed narrator takes
 *  longer (the page's own figures: 12 to 14 s a scene for the creature voices) — every function below that
 *  turns shots into time takes that pace as its last argument, so a page can be honest about a slow voice. */
export const SHOT_SECONDS: Record<FilmWay, number> = { acted: 5.8, narrated: 9.5 };

const MIN_SHOTS: Record<FilmWay, number> = { acted: 1, narrated: 3 };
const pace = (way: FilmWay, per?: number): number => (Number(per) >= 2 ? Number(per) : SHOT_SECONDS[way]);

/** The fewest shots a film has: one acted line; three told scenes (a beginning, a middle and an end). A format
 *  may ask for more (a horror film is a line and then the scare: two) — every function below takes that floor. */
export const minShots = (way: FilmWay): number => MIN_SHOTS[way];

/** WHAT FIVE MINUTES IS IN SHOTS — the most either engine makes: 52 acted shots, 32 told scenes. `per` (seconds a
 *  shot, when the page knows better than the usual pace — a slow narrator) can only LOWER it: the engines'
 *  ceiling is the number with no `per`. */
export function maxShots(way: FilmWay, per?: number): number {
  const most = Math.ceil(MAX_FILM_SECONDS / SHOT_SECONDS[way]);
  return Math.max(MIN_SHOTS[way], Math.min(most, Math.ceil(MAX_FILM_SECONDS / pace(way, per))));
}

/** A shot count held to what is made: a whole number between the floor and five minutes. Nothing usable (no
 *  number, zero) → `fallback` (itself held), else the floor. `min` = the format's own floor, when it has one. */
export function clampShots(way: FilmWay, n: unknown, o: { min?: number; fallback?: number; per?: number } = {}): number {
  const most = maxShots(way, o.per);
  const least = Math.min(most, Math.max(MIN_SHOTS[way], Math.round(Number(o.min) || 0)));
  const want = Math.round(Number(n) || 0) || Math.round(Number(o.fallback) || 0) || least;
  return Math.max(least, Math.min(most, want));
}

/** How long a film of so many shots runs, in whole seconds — never said to be more than five minutes (the last
 *  stop is the fewest shots that REACH five minutes, a second or four over). */
export function secondsFor(way: FilmWay, shots: number, per?: number): number {
  const n = Math.max(0, Math.round(Number(shots) || 0));
  return Math.min(MAX_FILM_SECONDS, Math.round(n * pace(way, per)));
}

/** A length as a clock reads it, to the nearest five seconds (an estimate is not said to the second):
 *  20 → "0:20", 87 → "1:25", 300 → "5:00". */
export function clockLabel(seconds: number): string {
  const r = Math.max(0, Math.round((Number(seconds) || 0) / 5) * 5);
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
}

/** THE SLIDER'S POSITIONS, as shot counts: every shot up to a minute (where one more line is a real choice),
 *  then about every ten seconds up to two minutes, then about every half minute — and the last one is exactly
 *  five minutes. Increasing, no repeats; starts at the floor (`min`: the format's own, when it has one). */
export function lengthStops(way: FilmWay, o: { min?: number; per?: number } = {}): number[] {
  const per = pace(way, o.per);
  const most = maxShots(way, o.per);
  const least = clampShots(way, o.min, { min: o.min, per: o.per });
  const stops: number[] = [];
  let n = least;
  while (n < most) {
    const secs = n * per;
    const step = secs < 60 ? 1 : Math.max(1, Math.round((secs < 120 ? 10 : 30) / per));
    // (a stop that would sit right under the last one is left out: "4:55" beside "5:00" is no choice at all)
    if (most - n < step / 2 && stops.length) break;
    stops.push(n);
    n += step;
  }
  stops.push(most);
  return stops;
}

/* ---- THE PRICE ----
 * ESTIMATES, FOR THE OWNER TO SET. Films are free to make while they are being finished; the page shows this
 * estimate beside "free", so that the day a price goes on nobody is surprised by it.
 *
 * What a second of finished film costs us today, from the code's own engines and the providers' own pages:
 *  ACTED — the clip engine is paid by the second of TAKE, and a take is longer than what stays in the film: a
 *   typical line is rendered as a 7-second take (speech-meter.ts → clipSecondsFor) and about 5.8 s of it is kept.
 *   fal Kling 3 Omni pro, $0.14 a second with sound (film-dialogue.server.ts → KLING_HOST_LABEL): $0.98 a shot,
 *   $0.169 a film second. Each place's picture ($0.15 a draw on nano-banana-pro, redrawn now and then), the fresh
 *   seed a place gets every few shots, the looks at them, the listen that trims each take, the script: about a
 *   cent a second more. ≈ $0.18 a second.
 *  NARRATED — every scene's picture moves: Seedance 1 Pro Fast at 1080p, $0.0486 a second, asked for in whole
 *   seconds (story-motion.ts): $0.051 a film second. A 2K picture a scene ($0.15, and one in three drawn twice)
 *   with the four looks at it: $0.026. The voice, the listen, the cast's portraits, the music bed: under half a
 *   cent. ≈ $0.08 a second. (While films are free that is ours to pay: a five-minute told story is about $24 —
 *   $15.50 of it the motion of its 32 scenes — and a five-minute acted one about $54.)
 *  STILL — a told story over its STILL pictures, each with its slow move (story-motion.ts → THE LADDER, its first
 *   rung; the owner, 2026-11-25, of the Stories shelf that promised only moving pictures: "we also need the timeless
 *   pictures with narration as an extremely cheap base tier"). The same story with nothing spent on motion: the 2K
 *   picture a scene and its looks, $0.026; the voice, the listen, the cast's portraits, the music bed, under half a
 *   cent. ≈ $0.029 a second — a five-minute one is about $8.70. (The cut that moves the stills is our own ffmpeg.)
 * A Studio-plan token is worth $0.0433, and his rule is at least 20% profit on every generation: acted needs
 * $0.18 × 1.2 ÷ $0.0433 = 4.9 tokens a second or more, told $0.08 × 1.2 ÷ $0.0433 = 2.2, told over stills
 * $0.029 × 1.2 ÷ $0.0433 = 0.80 — so 1. A one-minute story: still 60 · moving 150 · acted 300. */
export const FILM_TOKENS_PER_SECOND: Record<PriceWay, number> = { acted: 5, narrated: 2.5, still: 1 };

/** WHAT A FILM IS PRICED AS — the two ways a film is made, and the cheapest rung of a told one: told over its
 *  STILL pictures ("narrated" is a told story whose pictures move). */
export type PriceWay = FilmWay | "still";
/** The rung a film is priced at: a told story over still pictures is "still", anything else its way. */
export const priceWay = (way: FilmWay, still?: boolean): PriceWay => (way === "narrated" && still ? "still" : way);

/** What a film of this many seconds is estimated at, in tokens — rounded UP to a five. */
export function tokensFor(way: PriceWay, seconds: number): number {
  const s = Number(seconds) || 0;
  const rate = FILM_TOKENS_PER_SECOND[way];
  return s > 0 && rate > 0 ? Math.ceil((s * rate) / 5 - 1e-9) * 5 : 0;
}

/* ---- HOW LONG IT TAKES TO MAKE ----
 * A range in minutes, from how each engine really works — read off the code, with the times that were measured
 * on the live site. Nothing here could be timed where it was written (no paid render, no writer): the two
 * figures marked MEASURED are the lead's and the page's own; the rest is the code's structure.
 *
 * ACTED (film-dialogue.server.ts): the shots are rendered ONE AFTER ANOTHER — each is seeded from the last frame
 * of the one before, so no two can be made at once. MEASURED on the films of 2026-11-25: 2.5 to 3 minutes a shot,
 * all told (its picture or fresh seed, the take, the download, the listen, the trim; and its share of the join,
 * which grows with the film as the shots do). A long film adds nothing of another kind — its join is made in
 * parts, each the size of a short film's — but a provider that stumbles once in fifty shots does so here, so the
 * top of the range is wider: 2 + 2.5 a shot, to 4 + 3.2 a shot.
 *
 * NARRATED (narrated-story.server.ts): the voice and the listen once; the pictures FOUR at a time; the clips that
 * move them THREE at a time, each then brought to the story's size one at a time; one cut (past twelve scenes, six
 * scenes at a time and then put together — story-join.ts: the same encoding, and a few seconds more for the sound
 * and the last pass, which copies the picture). MEASURED 2026-11-23
 * (story-motion.ts → storyTypicalSeconds, the sum the page and the Archive already count down from): 60 s + 12 s
 * a scene, and when the pictures move 20 s + 30 s a wave of three + 4 s a scene. That was at 720p. Since
 * 2026-11-25 the story is cut in Full HD at a finer setting, which is not yet timed: the cut is taken as 0.4 to
 * 1 second of work for every second of film, on top. */
export function renderMinutes(way: FilmWay, shots: number, o: { /** a told story's pictures move (the default) */ moves?: boolean; per?: number } = {}): [number, number] {
  const n = Math.max(1, Math.round(Number(shots) || 0));
  if (way === "acted") return [Math.round(2 + n * 2.5), Math.round(4 + n * 3.2)];
  const moves = o.moves !== false;
  const made = 60 + n * 12 + (moves ? 20 + Math.ceil(n / 3) * 30 + n * 4 : 0);
  const film = n * pace(way, o.per);
  const lo = Math.max(moves ? 3 : 2, Math.round((made * 0.8 + film * 0.4) / 60));
  return [lo, Math.max(lo + 1, Math.round((made * 1.35 + film) / 60))];
}

/** HOW LONG A FILM MAY HOLD ITS LANE, in minutes (job-queue.server.ts → processNextJob). The worker renders one film
 *  at a time — two at once is the memory spike that restarted the server — and frees the lane after 70 minutes in
 *  case a render never settles: "the ceiling must sit ABOVE the longest legitimate render". A five-minute acted film
 *  is two to three hours of honest work, so a film's own ceiling is half again the top of its own range. */
export const laneMinutes = (way: FilmWay, shots: number, o: { moves?: boolean; per?: number } = {}): number =>
  Math.ceil(renderMinutes(way, shots, o)[1] * 1.5);

/* ---- A LONG SCRIPT IS WRITTEN IN PARTS ----
 * Until 2026-11-25 a film was at most six acted shots or twelve told scenes, and its writer wrote all of it in
 * one answer. Five minutes is fifty-two shots, and one answer cannot be that:
 *  · the writer's answer has to arrive inside two minutes (http-retry.server.ts gives a request 120 s and then
 *    asks again from the start) — fifty-two shots is about six thousand tokens, more than has ever been asked
 *    for in one go here (a music video's twenty-four scenes, 4,400);
 *  · it cannot count: told "EXACTLY 4", it is right; told "EXACTLY 52", nobody has seen what comes back;
 *  · and a short script gets its shape for free — a long one, written in one breath, is the first minute's
 *    situation said five times over.
 * So a long film is PLANNED first (one small answer: the title, the cast, its places, and what happens in each
 * part — with a turn in the middle and the ending where the ending belongs), and then each part is written on
 * its own by the brief every short film is already written by, told the whole plan, the lines the part before it
 * ended on, and whether it opens the film, carries it on or ends it.
 *  ACTED — a part is ONE SCENE: one conversation in one place, six shots at most. That is exactly what the acted
 *   brief was tuned on, it is how the film is made (one picture per place, each clip grown out of the one before),
 *   and its seams are the film's own straight cuts.
 *  NARRATED — a part is up to eight scenes of the telling; the storyteller carries on mid-story from one part to
 *   the next.
 * A film short enough for one answer is written exactly as it was. */

/** The most shots ONE answer writes: an acted scene of six (a whole film, until now), a told story of twelve. */
export const WRITE_AT_ONCE: Record<FilmWay, number> = { acted: 6, narrated: 12 };
/** …and once a story is too long for one answer, the most a part of it has. */
const PART_MOST: Record<FilmWay, number> = { acted: 6, narrated: 8 };

/** HOW A SCRIPT OF SO MANY SHOTS IS DEALT INTO PARTS: their sizes, in order — one part (the script as it always
 *  was) up to WRITE_AT_ONCE, else as few parts as hold it, as even as they come (the longer ones first). */
export function scriptParts(way: FilmWay, shots: number): number[] {
  const n = Math.max(1, Math.round(Number(shots) || 0));
  if (n <= WRITE_AT_ONCE[way]) return [n];
  const k = Math.ceil(n / PART_MOST[way]);
  return Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0));
}

/** How many PLACES an acted film of `scenes` scenes is set in: a place a scene up to two; from three on it comes
 *  BACK to places it has been — about half as many places as scenes, five at most. (A new room every thirty
 *  seconds is nine rooms in five minutes: nobody knows where they are, and every one is a picture to draw.) */
export const filmPlaces = (scenes: number): number => {
  const k = Math.max(1, Math.round(Number(scenes) || 0));
  return k <= 2 ? k : Math.min(5, Math.ceil((k + 1) / 2));
};

/** Which part is THE TURN (counted from 1): the one that ends the first half — none in a film of two parts. */
export const turnPart = (parts: number): number => (parts >= 3 ? Math.ceil(parts / 2) : 0);

/** A long film's plan, as the writer returns it and takePlan checks it. */
export type FilmPlan = {
  title: string;
  musicMood: string;
  /** the film's people, each "Name, look" — written once, here, and handed to every part */
  cast: string[];
  /** ACTED: the labels of the places it is set in. NARRATED: the places it keeps coming back to, each "name: look". */
  places: string[];
  /** one entry a part: what happens in it — and, in an acted film, the one place it is set in */
  parts: Array<{ where: string; what: string }>;
};

/** The shape the plan is asked for in (a forced tool call's schema). */
export function planSchema(way: FilmWay): Record<string, unknown> {
  const part = way === "acted"
    ? { type: "object", properties: { where: { type: "string" }, what: { type: "string" } }, required: ["where", "what"] }
    : { type: "object", properties: { what: { type: "string" } }, required: ["what"] };
  return {
    type: "object",
    properties: { title: { type: "string" }, musicMood: { type: "string" }, cast: { type: "array", items: { type: "string" } }, places: { type: "array", items: { type: "string" } }, parts: { type: "array", items: part } },
    required: ["title", "musicMood", "cast", "places", "parts"],
  };
}

const oneLine = (v: unknown): string => String(typeof v === "string" ? v : "").replace(/\s+/g, " ").trim();
const sameWords = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** WHAT THE PLANNER IS ASKED FOR — the part of its brief that is about a LONG film (the idea, the cast and the
 *  format's own rules are said around it by film-engine.server.ts, in the words every film is written from).
 *  `sizes` = scriptParts(); `ending` = how this format's last part ends, when it has a way of its own ("" = as its
 *  kind of story ends); `placesAsk` (told) = the engine's own words for what a story's places are. */
export function planBrief(way: FilmWay, o: { sizes: ReadonlyArray<number>; per?: number; ending?: string; placesAsk?: string }): string {
  const k = o.sizes.length;
  const shots = o.sizes.reduce((a, b) => a + b, 0);
  const clock = clockLabel(secondsFor(way, shots, o.per));
  const turn = turnPart(k);
  const ending = oneLine(o.ending);
  const last = `The LAST ${way === "acted" ? "scene" : "part"} ends ${way === "acted" ? "the film" : "the story"}${ending ? ` ${ending}` : " the way its kind of story ends"} — and nothing before it does: no earlier ${way === "acted" ? "scene" : "part"} settles what the story is about.`;
  if (way === "acted") {
    const P = filmPlaces(k);
    return (
      `\nTHIS IS THE PLAN OF A LONGER FILM — about ${clock}, in ${k} SCENES. A scene is ONE conversation between the two in ONE place, ${Math.min(...o.sizes) === Math.max(...o.sizes) ? `${o.sizes[0]}` : `${Math.min(...o.sizes)} or ${Math.max(...o.sizes)}`} spoken lines long. You do not write the lines now: you say what each scene IS, and the lines are written from it. Return:\n` +
      `• "places" — the ${P} PLACE${P === 1 ? "" : "S"} this film is set in, each a short vivid label a set could be built from (e.g. "a dim old diner at night, rain on the windows"). They are the IDEA's own: a film the idea sets in one house has its places IN that house — its kitchen, its stairs, its porch — never somewhere the idea does not go.\n` +
      `• "parts" — EXACTLY ${k} entries, the scenes in order. Each has "where": ONE of the places, copied letter for letter; and "what": two or three plain sentences — what each of the two wants here, the ONE thing that is said, found or done that changes it, and how the scene ends. A scene's last sentence is what the next scene starts from.\n` +
      `HOW A FILM THIS LONG HOLDS: scene 1 opens with the trouble already under way — nobody is introduced, nobody explains what both already know. Every scene changes something: what one of them knows, wants or has. ` +
      (turn ? `Scene ${turn} is THE TURN — what the two believed is shown to be wrong, or what one of them wants changes — so the second half is not more of the first. ` : "") +
      (P < k ? `The film comes BACK to a place it has been at least once (people go home; they return to where it happened) — and two scenes in a row are never in the same place. ` : k > 1 ? `Each scene is in a place of its own. ` : "") +
      `The same two people carry every scene. ${last}\n`
    );
  }
  return (
    `\nTHIS IS THE PLAN OF A LONGER STORY — about ${clock} of telling, ${shots} pictures, in ${k} PARTS. You do not write the storyteller's words now: you say what each part TELLS, and the words are written from it. Return:\n` +
    (o.placesAsk ? `• "places" — ${oneLine(o.placesAsk)}\n` : "") +
    `• "parts" — EXACTLY ${k} entries, in order, each with "what": three or four plain sentences of what is told in that part — what happens, to whom, and where — ending on what the next part starts from.\n` +
    `HOW A STORY THIS LONG HOLDS: part 1 opens on the hook and has the trouble under way by its end. Every part changes something. ` +
    (turn ? `Part ${turn} is THE TURN — what seemed true is not, or what somebody wants changes — so the second half is not more of the first. ` : "") +
    `The same few characters carry all of it: whoever matters at the end is met in part 1. It keeps coming BACK to its places rather than wandering to a new one every picture. ${last}\n`
  );
}

/** The planner's answer, checked — or null when it cannot be worked from (the caller asks again). EXACTLY `parts`
 *  parts are kept (a longer answer is cut; a shorter one is not a plan). An acted part's place is one of the
 *  listed places, in the list's own words when it differs only in its letters' case; a place a part names that
 *  was not listed is listed. A cast must be there: every part is written for it. */
export function takePlan(raw: unknown, o: { way: FilmWay; parts: number }): FilmPlan | null {
  const a = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!a) return null;
  const list = (v: unknown): string[] => (Array.isArray(v) ? v : []).map(oneLine).filter(Boolean);
  const cast = list(a.cast).map((c) => c.slice(0, 400)).slice(0, 5);
  const places = list(a.places).map((p) => p.slice(0, o.way === "acted" ? 120 : 400)).filter((p, k, all) => all.findIndex((x) => sameWords(x, p)) === k);
  const said = (Array.isArray(a.parts) ? a.parts : []).map((p) => {
    const e = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
    return { where: oneLine(e.where).slice(0, 120), what: oneLine(e.what).slice(0, 600) };
  }).filter((p) => p.what.length > 12);
  if (!cast.length || said.length < o.parts) return null;
  const parts = said.slice(0, o.parts);
  if (o.way === "acted") {
    for (const p of parts) {
      if (!p.where) return null;
      const listed = places.find((x) => sameWords(x, p.where));
      if (listed) p.where = listed; else places.push(p.where);
    }
  } else for (const p of parts) p.where = "";
  return { title: oneLine(a.title).slice(0, 120), musicMood: oneLine(a.musicMood).slice(0, 200), cast, places: o.way === "acted" ? places.filter((x) => parts.some((p) => p.where === x)) : places, parts };
}

/** WHERE A PART STANDS — what its writer is told before the brief every film is written by: the idea is the whole
 *  film's, the plan is quoted, this is part `index` (from 0) of it, and everything the parts before it said.
 *  `said` = the lines already written, part by part, in their own words — ALL of them, not a summary: a writer
 *  that has only the plan repeats what a scene already established, and contradicts what it cannot see (the plan
 *  says what a scene is, never the name somebody gave the dog); `seenAs` (acted) = the VISUAL this part's place
 *  was first drawn from, when the film has been there before. */
export function partBrief(way: FilmWay, o: { plan: FilmPlan; index: number; shots: number; idea?: string; said?: ReadonlyArray<ReadonlyArray<string>>; seenAs?: string }): string {
  const k = o.plan.parts.length;
  const j = Math.max(0, Math.min(k - 1, o.index));
  const unit = way === "acted" ? "SCENE" : "PART";
  const idea = oneLine(o.idea).replace(/"/g, "'");
  const sheet = o.plan.parts.map((p, i) => `  ${i + 1}. ${way === "acted" ? `[${p.where}] ` : ""}${p.what}`).join("\n");
  const said = (o.said || []).slice(0, j).map((lines) => (lines || []).map((l) => oneLine(l).slice(0, 320)).filter(Boolean));
  const before = said.some((lines) => lines.length)
    ? `WHAT HAS BEEN ${way === "acted" ? "SAID" : "TOLD"} — ${way === "acted" ? "every line of the scenes" : "the storyteller's words for the parts"} before this one, as written. They ARE the ${way === "acted" ? "film" : "story"} so far: carry on from them, contradict none of them, and say none of them again.\n` +
      said.map((lines, i) => (way === "acted" ? `  scene ${i + 1}:\n${lines.map((l) => `    ${l}`).join("\n")}` : `  part ${i + 1}: ${lines.join(" ")}`)).join("\n") +
      `\nThis ${unit.toLowerCase()} begins AFTER the last of that.\n`
    : "";
  const here = o.plan.parts[j];
  return (
    `THIS IS ${unit} ${j + 1} OF ${k} of one longer ${way === "acted" ? "film" : "story"}${idea ? `, made from this idea: "${idea}"` : ""}. Its plan — what each ${unit.toLowerCase()} is:\n${sheet}\n` +
    `Write ONLY ${unit.toLowerCase()} ${j + 1}, as its line of the plan says: everything before it has happened, and nothing after it happens yet.\n` +
    (way === "acted" ? `IT IS SET IN "${here.where}" — every one of its shots has exactly these words as its WHERE, and nobody leaves.${o.seenAs ? ` The film has been here before: this place's picture was drawn from "${oneLine(o.seenAs).replace(/"/g, "'").slice(0, 240)}" — it is that same place, and only what that put in view is handled.` : ""}\n` : "") +
    before +
    (j < k - 1
      ? `IT DOES NOT END THE ${way === "acted" ? "FILM" : "STORY"}: nothing is settled for good, nobody says goodbye, no lesson is drawn — its last ${way === "acted" ? "line" : "sentence"} leaves open what ${unit.toLowerCase()} ${j + 2} picks up.\n`
      : `IT ENDS THE ${way === "acted" ? "FILM" : "STORY"}: what the plan has been heading for happens here, in its last ${way === "acted" ? "shots" : "scenes"}.\n`)
  );
}
