/* A FOUND-FOOTAGE FILM — several MOMENTS from one camera, cut together the way recovered footage is.
 *
 * The owner, 2026-11-25: "Found footage needs redone … It currently appears to pipeline singular events But needs to
 * be more like \"Found Footage\" House cam, Body cam, phone or cam recording, with describe events flow like the
 * others - make it look banging and not limited".
 *
 * One press used to make ONE twelve-second take of ONE event (take.ts — and that take is unchanged: its takes are
 * tuned, and he called them "cinema"). A found-footage film is what those takes are for:
 *
 *      NIGHT 1 · 2:14 AM        ← a card: white on black, the camera's own mono face, 1.2 seconds, a hard cut
 *      [ a take ]               ← something small, far off, deniable
 *      NIGHT 2 · 3:07 AM
 *      [ a take ]               ← closer
 *      NIGHT 4 · 3:11 AM
 *      [ a take ]               ← the payoff
 *
 * The same place, the same people and the same thing in every moment — and "not limited": a dog caught opening the
 * fridge on the kitchen camera, a meteor on a dashboard phone, whatever they describe. So a film is made of:
 *
 *   THE OUTLINE     what the member SEES AND EDITS ("describe events flow like the others"): a title, the place said
 *                   ONCE, the thing said ONCE, and the moments — each one a card ("when"), ONE line they can rewrite,
 *                   and its seconds. Written from their idea by the writer (footageOutlineBrief), free, before
 *                   anything is spent; whatever comes back from the page is cleaned again here and never trusted
 *                   (cleanFootageOutline).
 *   THE BUILD       the writer's job in the outline, and it must survive the direction: the FIRST moment is ordinary
 *                   with ONE small thing wrong (far off, brief, deniable); the MIDDLE ones bring it closer or prove
 *                   it; the LAST is the payoff — unless their idea says how it ends: THE END IS THEIRS (take.ts has
 *                   that rule for one take; it is the same rule).
 *   THE DIRECTION   one more writer call turns every line into the parts its take is filmed from — the shapes the
 *                   single takes are made from: a Take (take.ts) on a camera somebody holds or wears, a HouseScare
 *                   (house-cam.ts) on a camera on the wall. Each moment is checked by the single takes' own rules
 *                   (parseTake, parseHouseScare); one that fails is asked for once more, and left out if it fails
 *                   again. NO WORD FOR THE ENGINE, as ever: what the one filming says is a separate voice, each line
 *                   with a mood the writer picks from a closed list (a film is not all terror).
 *   SEEN OR NOT     the early moments of a haunting show no creature — only what it did. So each moment says whether
 *                   the thing is IN its picture: seen, it is directed by the scare's rules (stillness, slowness, a
 *                   mouth that never moves); not seen — and every moment of a film that is not a horror — it is a
 *                   "plain" take (take.ts → plainPrompt), and on a house camera a moment NOTHING comes into
 *                   (house-cam.ts → parseHouseTrace).
 *   THE PICTURES    the place and the thing are the member's words, WORD FOR WORD, in every moment's picture. The
 *                   first moment's scene is drawn from words; every later one is drawn FROM that picture ("the SAME
 *                   place … at ANOTHER MOMENT"), and once the thing has been drawn up close — its payoff — every other
 *                   moment it is in is drawn from that picture too, so it is the same one all the way through
 *                   (footageScenePlan). A house camera has its own continuity already: the kept house.
 *   THE CLOCK       a house camera and a body camera print the time, and a camcorder burns the date into its corner:
 *                   each moment's is what its card says ("NIGHT 2 · 3:07 AM" → the second night, 03:07 —
 *                   footageClocks).
 *   THE CARDS, THE JOIN   a card before every moment; cards and moments joined with straight cuts at the takes' own
 *                   size and frame rate, picture and sound the same length, measured (footageJoinGraph).
 *
 * Pure: plain logic and wording (tests/footage-film.test.ts). The making — the writer, the pictures, the rolls, the
 * join, the piece — is footage-film.server.ts.
 *
 * NOT YET FILMED: nothing here has been run against the writer or a video model (2026-11-25: the local writer has no
 * credit, and a roll costs money). Every wording below is built from the single takes' own, which were. */

import { camDate, cameraLookOf, filterPath, type CameraLook, type HouseClock } from "./camera-dress.ts";
import { HOUSE_ROOMS, HOUSE_TAKE_SECONDS, NIGHT, houseRoom, houseScare, houseTimes, parseHouseScare, parseHouseTrace, type HouseScare } from "./house-cam.ts";
import {
  DRAMA_BOUNDS, DRAMA_CAUGHT, HAND_CAMS, OWN_SCARE, PLAIN_BOUNDS, PLAIN_CAUGHT, TAKE_CAUGHT, TAKE_HIDDEN, TAKE_MOODS, TAKE_OPENS_SECONDS, TAKE_WRONG,
  familyOf, footageEta, footageJob, footageScare, hurtIn, parseTake, shapeFor, takeIdea, takeMood, takeOpensPrompt,
  type FootageForm, type Take, type TakeIdea, type TakeMood,
} from "./take.ts";

/* ---- WHAT THE MEMBER SEES AND EDITS ---- */

/** How many moments a film can have. One is today's single take; a film is two to eight. */
export const FOOTAGE_MAX_MOMENTS = 8;
/** How long a card stands on black before its moment, in seconds. */
export const FOOTAGE_CARD_SECONDS = 1.2;
/** How many handheld moments roll at once (a house camera's go one after another: its house is kept from one to
 *  the next). */
export const FOOTAGE_ROLLS_AT_ONCE = 3;
/** How many moments' parts one writer's answer is asked to hold: a longer film's direction is asked for in two
 *  halves (each shown the whole outline), so no answer runs into the request's own time limit. */
export const FOOTAGE_DIRECTED_AT_ONCE = 5;
/** How many times a film may roll a moment again because the engine spoke or cut — one for any moment, and this many
 *  for the whole film (each is a whole take paid for a second time). */
export const FOOTAGE_REROLLS = 3;
/** The most a member's words are kept to. */
export const FOOTAGE_LIMITS = { title: 60, place: 280, thing: 280, when: 28, line: 180 } as const;

/** "plain": not a horror — the direction has no creature rules. */
export type FootageKind = "scare" | "plain";
export type FootageMoment = {
  /** the card before it, e.g. "NIGHT 1 · 2:14 AM" (28 characters at most) */
  when: string;
  /** what the camera catches, one sentence a member can rewrite (180 characters at most) */
  line: string;
  /** how long its take is: 6–12 (a house camera: 10–15) */
  seconds: number;
  /** house camera only: a HOUSE_ROOMS key */
  room?: string;
};
/** WHAT THE MEMBER SEES AND EDITS: a film as a list of moments, each one line. */
export type FootageOutline = {
  v: 1;
  title: string;
  camera: CameraLook;
  aspect: "9:16" | "16:9";
  kind: FootageKind;
  /** the place, said ONCE and drawn the same in every moment */
  place: string;
  /** who or what it is about, said ONCE: its look, what it wears, what is wrong with it ("" if nothing recurs) */
  thing: string;
  moments: FootageMoment[];
};

const words = (s: unknown, max: number): string => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/["“”]/g, "'").replace(/\s+/g, " ").trim().slice(0, max).trim();
/** PROSE cut to `max` — the place, the thing — at the last full sentence that fits (when that keeps half of it or
 *  more), else at the last whole word, never on a dangling comma: the first live outline (2026-11-25, "What Circled
 *  the Tent") showed the member its place as "…and whatever the camera's tiny lamp catches,". One word longer than
 *  `max` is cut where it must be. */
export const prose = (s: unknown, max: number): string => {
  const t = String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/["“”]/g, "'").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (end >= max * 0.5) return cut.slice(0, end + 1).trim();
  const sp = cut.lastIndexOf(" ");
  return (sp > 0 ? cut.slice(0, sp) : t.slice(0, max)).replace(/[\s,;:—–-]+$/, "").trim();
};
const stop = (s: string): string => (s && !/[.!?…—]$/.test(s) ? `${s}.` : s);
const shapeOf = (aspect: "9:16" | "16:9"): string => (aspect === "16:9" ? "Wide 16:9 picture." : "Vertical 9:16 picture.");

/** How many moments were asked for: a whole number from 1 to FOOTAGE_MAX_MOMENTS (anything else: 1). */
export const momentCount = (v: unknown): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(1, Math.min(FOOTAGE_MAX_MOMENTS, n)) : 1;
};
/** A moment's length on this camera, in whole seconds: 6–12 held or worn (ten when it is not said), 10–15 on a house
 *  camera (fifteen — the walk-in's own length — when it is not said). */
export function momentSeconds(camera: CameraLook, v: unknown): number {
  const [lo, hi, own] = camera === "house" ? [10, HOUSE_TAKE_SECONDS, HOUSE_TAKE_SECONDS] : [6, 12, 10];
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.max(lo, Math.min(hi, n)) : own;
}
/** A card's words as they are kept: capitals (a card is drawn in capitals), one line, 28 characters — and only what
 *  the camera's mono face can draw: Latin letters with their accents, figures, plain punctuation, the middle dot and
 *  the dashes (anything else would be an empty box on the card). */
export const cardWords = (v: unknown): string => fitCard(words(v, 80).replace(/['‘`´]/g, "’").replace(/[^\x20-\x7E¡-ſ–—’]/g, "").replace(/[\\%{}[\]<>|;^~]/g, "").replace(/\s+/g, " ").trim().toUpperCase());
/** A card too long is cut at a WORD, never inside one: "TUESDAY 14 OCTOBER · 11:52 PM" cut at 28 characters was drawn
 *  as "… 11:52 P" — and read back by the clock as 11:52 in the MORNING (review, 2026-11-25, of the stand-in cards). */
function fitCard(s: string): string {
  const max = FOOTAGE_LIMITS.when;
  if (s.length <= max) return s;
  const head = s.slice(0, max + 1);
  // (no space to cut at — one word longer than a card — is cut where it must be)
  const cut = /\s/.test(head) ? head.replace(/\s+\S*$/, "").replace(/[\s·•|,:;–—-]+$/, "").trim() : "";
  return (cut || s.slice(0, max)).trim();
}

/** One moment, cleaned — or null when it has no line. `before`: the moment before it (a house camera's room carries
 *  on when a moment names none). */
function cleanMoment(raw: unknown, camera: CameraLook, index: number, before?: FootageMoment): FootageMoment | null {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const line = words(m.line, FOOTAGE_LIMITS.line);
  if (line.replace(/[^\p{L}\p{N}]+/gu, "").length < 4) return null;
  return {
    when: cardWords(m.when) || `NIGHT ${index + 1}`,
    line,
    seconds: momentSeconds(camera, m.seconds),
    ...(camera === "house" ? { room: houseRoom(m.room)?.key || before?.room || "living" } : {}),
  };
}

const readAnswer = (raw: unknown): Record<string, unknown> | null => {
  try {
    const s = typeof raw === "string" ? raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1) : "";
    const o = typeof raw === "object" && raw ? raw : s ? JSON.parse(s) : null;
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch { return null; }
};
const kindOf = (v: unknown): FootageKind => (String(v ?? "").trim().toLowerCase() === "plain" ? "plain" : "scare");
/** "none" is not a thing */
const thingWords = (v: unknown): string => { const t = prose(v, FOOTAGE_LIMITS.thing); return /^(none|nothing|nobody|no one|n\/a|-+)\.?$/i.test(t) ? "" : t; };

function momentsOf(list: unknown, camera: CameraLook, most: number): FootageMoment[] {
  const out: FootageMoment[] = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (out.length >= most) break;
    const m = cleanMoment(raw, camera, out.length, out[out.length - 1]);
    if (m) out.push(m);
  }
  return out;
}

/** THE WRITER'S OUTLINE, checked — or null (the caller asks once more, then films ONE take of the idea rather than
 *  half a film). A film needs a place and two moments; more than were asked for are left off. */
export function parseFootageOutline(raw: unknown, camera: CameraLook, aspect: "9:16" | "16:9", count: number): FootageOutline | null {
  const o = readAnswer(raw);
  if (!o) return null;
  const place = prose(o.place, FOOTAGE_LIMITS.place);
  const moments = momentsOf(o.moments, camera, momentCount(count));
  if (place.length < 12 || moments.length < 2) return null;
  return { v: 1, title: words(o.title, FOOTAGE_LIMITS.title) || "Found footage", camera, aspect: shapeFor(camera, aspect), kind: kindOf(o.kind), place, thing: thingWords(o.thing), moments };
}

/** WHAT THE PAGE POSTS BACK — the outline the member approved, as text or as an object: validated, clamped, NEVER
 *  trusted (every word in it goes to a writer and a picture model). Their own words survive: a line they rewrote is
 *  the line that is filmed. Null when it is not an outline at all, names no camera, or has no moment left with a
 *  line in it. (One moment is an outline too — it is filmed as one take: footageFilmJob.) */
export function cleanFootageOutline(o: unknown): FootageOutline | null {
  const r = readAnswer(o);
  if (!r || Number(r.v) !== 1) return null;
  const camera = cameraLookOf(r.camera);
  if (!camera) return null;
  const moments = momentsOf(r.moments, camera, FOOTAGE_MAX_MOMENTS);
  if (!moments.length) return null;
  return { v: 1, title: words(r.title, FOOTAGE_LIMITS.title) || "Found footage", camera, aspect: shapeFor(camera, r.aspect), kind: kindOf(r.kind), place: prose(r.place, FOOTAGE_LIMITS.place), thing: thingWords(r.thing), moments };
}

/** ONE MOMENT the writer wrote again ("another take on this moment"), checked — or null. What it does not say stays
 *  as the moment was (`was`): its card, its length, its room. */
export function parseFootageMoment(raw: unknown, camera: CameraLook, index: number, was?: FootageMoment): FootageMoment | null {
  const r = readAnswer(raw);
  if (!r) return null;
  return cleanMoment({ when: cardWords(r.when) || was?.when, line: r.line, seconds: Number(r.seconds) > 0 ? r.seconds : was?.seconds, room: houseRoom(r.room)?.key || was?.room }, camera, index, was);
}

/** How long the film plays, in seconds: its moments, and a card before each (one moment is one take: no card). */
export function footageSeconds(o: Pick<FootageOutline, "moments">): number {
  const n = o.moments.length;
  const total = o.moments.reduce((s, m) => s + (Number(m.seconds) || 0), 0) + (n > 1 ? n * FOOTAGE_CARD_SECONDS : 0);
  return Math.round(total * 10) / 10;
}

/** HOW LONG IT TAKES, start to Archive, in minutes [at least, at most]. The rolls are most of it: handheld moments
 *  roll three at a time, each then dressed in turn; a house camera's go one after another (fifteen-second rolls, and
 *  a room drawn the first time it is seen). The top end allows for a moment rolled again. One moment is one take
 *  (take.ts → footageEta). */
export function footageFilmEta(o: Pick<FootageOutline, "camera" | "moments">): [number, number] {
  const n = Math.max(1, Math.min(FOOTAGE_MAX_MOMENTS, o.moments.length));
  if (n === 1) return footageEta(o.camera);
  if (o.camera === "house") return [Math.round(3 + n * 4.5), Math.round(5 + n * 9)];
  const batches = Math.ceil(n / FOOTAGE_ROLLS_AT_ONCE);
  return [Math.round(4 + batches * 4 + n * 0.8), Math.round(6 + batches * 8 + n * 1.6)];
}

/* ---- THE OUTLINE'S WRITER ---- */

/** The camera, as a writer is told it. */
const CAMERA_WORDS: Record<CameraLook, string> = {
  phone: "a phone held in somebody's hand (a tall, vertical picture)",
  camcorder: "a small home camcorder held in somebody's hand",
  bare: "a camera held in somebody's hand",
  bodycam: "a body camera worn on the chest of somebody on duty, a flashlight beside it",
  house: "the security cameras fixed high in the corners of ONE house's rooms: nobody holds them, they never move, and every moment is at night",
};
/** What a body camera's film is held to (take.ts → DRAMA_BOUNDS, as a writer is told it). */
const WORN_BOUNDS = "It is FICTION: never a real police incident, agency, town or address; no badge, insignia or lettering on anything; no weapon is drawn or fired; nobody is struck, nobody is hurt.";
const ROOMS_LIST = HOUSE_ROOMS.map((r) => `"${r.key}" — ${r.name}: ${r.empty}`).join("\n");
const secondsRule = (camera: CameraLook): string => (camera === "house"
  ? "10 to 15 — 10 for a moment nothing comes into, 15 for one where it stands still a long time"
  : "6 to 12 — short for a glimpse, 10 to 12 for the payoff");
/** WHAT A CARD MAY SAY, as a writer is told it. Counted in nights or days, never a calendar date or a year: the
 *  camcorder burns a date into its corner and the house and body cameras print one, all worked out from the card
 *  (footageClocks) — a card that said "OCT 31 1998" over a corner that says NOV 24 2026 is a film that contradicts
 *  itself (review, 2026-11-25). A house camera's moments are all at night (its direction says so, in infrared), so
 *  its examples are nights only. */
const cardRule = (camera: CameraLook): string => `in ENGLISH CAPITALS, 28 characters at most, counted in nights or days — never a calendar date or a year: the camera prints its own — later moments later (${camera === "house" ? '"NIGHT 1 · 2:14 AM", "NIGHT 3 · 3:07 AM"' : '"NIGHT 1 · 2:14 AM", "NIGHT 3 · 3:07 AM", "DAY 2 · 4:40 PM"'})`;
/** A house moment nothing comes into, as a writer is shown it: a thing that MOVES on its own, in the shot. Never a
 *  light that comes on (every house direction says "The light does not change": the engine is told both, and does one
 *  or flickers), and never a thing that "is somewhere else" (a continuous shot cannot jump: it would have to move).
 *  (Review, 2026-11-25: both were in the examples, beside the rule they break.) */
const HOUSE_TRACE_EXAMPLES = "a door swings slowly open; a chair slides back from the table; a ball rolls out across the floor";

/** THE BUILD, as both writers are told it (the outline's, and then the direction's — it must survive both). */
export const FOOTAGE_BUILD = "HOW IT BUILDS — every moment is worse (or bigger) than the one before, one step at a time. The FIRST moment is ordinary, with ONE small thing wrong: far off, brief, deniable — something a person watching would rewind to check. The MIDDLE moments bring it closer or prove it: it is nearer, it has moved something, it is in the room, it is looking at the camera. The LAST moment is the payoff. THE END IS THEIRS: if THE IDEA says how it ends, the last moment ends exactly that way; only an idea that gives no ending ends on the payoff of your choosing.";

/** WRITE ME THE MOMENTS — the brief for the outline's writer: `count` moments from one camera, from the member's
 *  idea. `from`: the ready-made take their words started from (a handheld or body-cam scare, or a house scare). The
 *  answer is JSON — { title, kind, place, thing, moments: [{ when, line, seconds, room? }] } — read by
 *  parseFootageOutline. */
export function footageOutlineBrief(idea: string, camera: CameraLook, count: number, from?: TakeIdea | HouseScare): string {
  const n = Math.max(2, momentCount(count));
  const house = camera === "house";
  return [
    `You are outlining a short FOUND-FOOTAGE FILM: ${n} moments recorded by ONE camera — ${CAMERA_WORDS[camera]} — cut together the way recovered footage is: a card on black that says when ("NIGHT 1 · 2:14 AM"), then what the camera caught; the next card, the next moment.`,
    `THE IDEA: ${words(idea, 400) || from?.premise || "something that should not be in the house"}`,
    ...(from ? [`IT STARTS FROM A READY-MADE TAKE, "${from.name}". Its own words were: ${from.premise} — That take is ONE moment: the film's payoff, or close to it. Outline the film that leads up to it, changed wherever THE IDEA changes its words.`] : []),
    'WHAT KIND IT IS — "scare": the idea is frightening, something that should not be there. "plain": it is NOT a horror at all — a dog caught opening the fridge, a meteor on a dashboard phone, a surprise party, a traffic stop; then nothing in it is a creature and nothing is made frightening.',
    house
      ? "THE PLACE, said ONCE: this house — whose it is and what kind of house, in a sentence or two. Its rooms are the ones listed below, exactly as they are: a room is never described differently."
      : "THE PLACE, said ONCE: the one place the whole film happens in, described so that it can be drawn the same in every moment — what kind of place it is, its walls and floor, its light, and two or three things in it that will be recognised each time.",
    'THE THING, said ONCE: who or what the film is about, when the same one is in more than one moment — its look, what it wears, and for a scare exactly what is wrong with it: nearly human and slightly wrong, ONE or TWO exact wrongnesses and no more (a smile far too wide; a neck or fingers too long; skin like candle wax) — never horns, wings, tentacles, glowing eyes, flames or a bare skull. "" when nothing recurs.',
    FOOTAGE_BUILD,
    "EACH MOMENT is ONE continuous shot that a real camera could film in the seconds it has: no cut, no jump in time, ONE thing happening. Write what THE CAMERA CATCHES, in one sentence a person could rewrite — who or what, where in the place, what it does. NEVER what anybody says: nobody's words are written in an outline, and nothing in the picture ever speaks.",
    house
      ? `NOBODY IS FILMING: these are a house's own cameras, one in each room, and every moment is at night. Each moment names the room its camera is in — one of:\n${ROOMS_LIST}\nIn a moment the thing comes in through one of THAT room's own doors and is seen the whole way — or, in an early moment, nothing comes in at all and ONE thing in the room changes with nobody there to do it (${HOUSE_TRACE_EXAMPLES}) — never a light: the light in a house camera's picture never changes.`
      : "THE ONE FILMING is never in the picture: they hold the camera, and it sees what they look at. A scare is at night, or somewhere dark.",
    "No blood, no gore, no wounds; nobody is hurt; everyone is fully clothed.",
    ...(camera === "bodycam" ? [WORN_BOUNDS] : []),
    `Answer with JSON only — the title, the place, the thing and every line in the language THE IDEA is written in: {"title": a short name for the film (2–5 words), "kind": "scare" or "plain", "place": THE PLACE, in two or three sentences, "thing": THE THING, in one or two sentences, or "", "moments": [exactly ${n}, in the order they are seen: {"when": the card — when this was recorded, ${cardRule(camera)}, "line": what the camera catches — one sentence, 180 characters at most, "seconds": how long the shot is, ${secondsRule(camera)}${house ? ', "room": the room, by its key' : ""}}]}`,
  ].join("\n");
}

const MOMENT_SCHEMA = (house: boolean) => ({
  type: "object", additionalProperties: false, required: ["when", "line", "seconds", ...(house ? ["room"] : [])],
  properties: { when: { type: "string" }, line: { type: "string" }, seconds: { type: "number" }, ...(house ? { room: { type: "string", enum: HOUSE_ROOMS.map((r) => r.key) } } : {}) },
});

/** THE SHAPE THE OUTLINE'S WRITER IS HELD TO (anthropicText → jsonSchema, a forced tool call). A house camera's
 *  moments name their room (pass the camera's schema: footageOutlineSchema(count, true)). */
export function footageOutlineSchema(count: number, house = false): { name: string; schema: Record<string, unknown> } {
  const n = Math.max(2, momentCount(count));
  return {
    name: "footage_outline",
    schema: {
      type: "object", additionalProperties: false, required: ["title", "kind", "place", "thing", "moments"],
      properties: { title: { type: "string" }, kind: { type: "string", enum: ["scare", "plain"] }, place: { type: "string" }, thing: { type: "string" }, moments: { type: "array", minItems: n, maxItems: n, items: MOMENT_SCHEMA(house) } },
    },
  };
}

const sheet = (o: FootageOutline, mark?: number): string => o.moments.map((m, i) => {
  const room = o.camera === "house" ? ` — ${houseRoom(m.room)?.name || "Living room"} camera` : "";
  return `${i + 1}. ${m.when} — ${m.seconds} seconds${room} — ${m.line}${mark === i ? "   ← THIS ONE" : ""}`;
}).join("\n");
const kindLine = (o: FootageOutline): string => (o.kind === "plain" ? "NOT a horror: nothing in it is a creature, and nothing is made frightening" : "a horror: something that should not be there");

/** ANOTHER TAKE ON THIS MOMENT — the brief for rewriting moment `index` of an outline the member is editing (`note`:
 *  what they asked for, if they said). The answer is JSON — { when, line, seconds, room? } — read by
 *  parseFootageMoment. */
export function footageMomentBrief(o: FootageOutline, index: number, note?: string): string {
  const i = Math.max(0, Math.min(o.moments.length - 1, Math.floor(Number(index) || 0)));
  const n = o.moments.length;
  const step = i === 0 ? "It is the FIRST moment: ordinary, with ONE small thing wrong — far off, brief, deniable."
    : i === n - 1 ? "It is the LAST moment: the payoff — it ends the way THE IDEA of the film ends."
    : "It is a MIDDLE moment: closer than the one before it, not yet the payoff — it brings the thing nearer, or proves it.";
  const asked = words(note, 300);
  return [
    `You are rewriting ONE moment of a found-footage film's outline — recorded by ${CAMERA_WORDS[o.camera]}. Everything else in the outline stays as it is.`,
    `THE FILM: "${o.title}" — ${kindLine(o)}.`,
    `THE PLACE: ${o.place || "(not said)"}`,
    `THE THING: ${o.thing || "nothing recurs"}`,
    `THE MOMENTS:\n${sheet(o, i)}`,
    `Write ANOTHER take on moment ${i + 1}: something DIFFERENT that the camera catches at this point of the film — the same place, the same thing, the same step of the build — not a rewording of what is there. ${step}`,
    ...(asked ? [`THE MEMBER ASKS: ${asked}`] : []),
    "It is ONE continuous shot that a real camera could film in the seconds it has: no cut, no jump in time, ONE thing happening. Write what THE CAMERA CATCHES — who or what, where in the place, what it does. NEVER what anybody says. No blood, no gore, nobody hurt, everyone clothed.",
    ...(o.camera === "house" ? [`The rooms a camera can be in:\n${ROOMS_LIST}`] : []),
    ...(o.camera === "bodycam" ? [WORN_BOUNDS] : []),
    `Answer with JSON only, the line in the language the outline is written in: {"when": its card — the card it has, unless the new moment happens at another time — ${cardRule(o.camera)}, "line": one sentence, 180 characters at most, "seconds": ${secondsRule(o.camera)}${o.camera === "house" ? ', "room": the room, by its key' : ""}}`,
  ].join("\n");
}
export const footageMomentSchema = (house = false): { name: string; schema: Record<string, unknown> } => ({ name: "footage_moment", schema: MOMENT_SCHEMA(house) });

/* ---- THE DIRECTION: EVERY LINE BECOMES A TAKE'S PARTS ---- */

/** A moment as it will be filmed. On a camera somebody holds or wears: a Take's parts (`seen`: the thing is in its
 *  picture — else it is a plain take). On a house camera: a house scare (`seen`: something comes in — else nothing
 *  does; `lapse`: the time-lapse setting can play on it — a fifteen-second scare that stands still). */
export type DirectedMoment =
  | { cam: "hand"; seen: boolean; take: Take & { title: string } }
  | { cam: "house"; seen: boolean; lapse: boolean; scare: HouseScare & { title: string } };
/** A film's direction: one entry for each moment of its outline, in order — null where the writer's answer for
 *  that moment was not one to film. */
export type FootageDirection = Array<DirectedMoment | null>;

const numbers = (only: readonly number[] | undefined, n: number): string => (only && only.length ? only.map((i) => i + 1).join(", ") : n === 1 ? "1" : `1 to ${n}`);

/** DIRECT IT — the brief that turns an outline into each moment's parts. `only`: the moments to write (the ones that
 *  failed the first time — the rest are done). The answer is JSON, read by parseFootageDirection. */
export function footageDirectionBrief(o: FootageOutline, only?: readonly number[]): string {
  const n = o.moments.length;
  const plain = o.kind === "plain";
  const which = only && only.length ? `Write ONLY moment${only.length > 1 ? "s" : ""} ${numbers(only, n)} — the others are written.` : "";
  // (a house camera's rooms are the kept house's own — drawn once, from house-cam.ts's words — so the writer is shown
  //  each room a moment is in, as its camera has it: a door it names must be one of that room's)
  const rooms = [...new Set(o.moments.map((m) => houseRoom(m.room)?.key || "living"))].map((k) => houseRoom(k)).filter((r): r is NonNullable<typeof r> => !!r);
  const head = [
    `THE FILM: "${o.title}" — ${kindLine(o)}.`,
    o.camera === "house"
      ? `THE HOUSE: ${o.place || "an ordinary house"}\nTHE ROOMS its cameras are in — each exactly as its camera has it; a door or doorway named in a moment must be one of that room's own:\n${rooms.map((r) => `${r.name}: ${r.empty}`).join("\n")}`
      : `THE PLACE — the same in every moment. It is drawn from these words, so never describe it differently: ${o.place || "(not said: keep it the same from moment to moment)"}`,
    `THE THING — the same one in every moment it is in. Its look is drawn from these words; never describe it differently and never add to it: ${o.thing || "nothing recurs — each moment is about what its own line says"}`,
    `THE MOMENTS:\n${sheet(o)}`,
    // (the outline IS the idea by now: its last line is how the film ends)
    `${FOOTAGE_BUILD} Here THE IDEA is the outline itself: the last moment ends the way its own line says. Keep the first moment as small as its line makes it, and never bring the thing closer than a moment's line does.`,
  ];
  if (o.camera === "house") {
    return [
      `You are directing a found-footage FILM recorded by the security cameras of ONE house: ${n} moment${n > 1 ? "s" : ""}, each ONE continuous shot from a camera fixed high in the corner of a room, at night. Nobody holds the camera, it NEVER moves, and nothing is ever said. The film is already outlined; you turn each moment's line into the parts its shot is filmed from. Change nothing that a line says happens.`,
      ...head,
      `TWO KINDS OF MOMENT. "seen": false — NOTHING COMES IN: the room as it is, and ONE thing in it moves with nobody there to do it, in the shot, at its real speed (${HOUSE_TRACE_EXAMPLES}) — never a light coming on or going out: write "set", "happens" and "after". "seen": true — IT COMES IN through one of THIS room\'s own doors or doorways and goes the WHOLE way to where it stops — it never appears from nowhere; it stops there; then what it does at the end: write "set", "door", "stands", "waits" and "acts".`,
      plain
        ? "Everything in it moves the way it really would, at its real speed. Nobody is hurt; everyone is fully clothed."
        : "What frightens is slowness and stillness. It NEVER runs, flinches, screams or speaks; nothing flashes or glitches; ITS MOUTH NEVER MOVES. No blood, no gore, no wounds, nobody hurt; fully clothed.",
      "Nothing in any moment speaks, and no spoken word is written anywhere. The camera NEVER moves and the light never changes: whatever happens, happens in front of it, in the seconds the moment has.",
      ...(which ? [which] : []),
      `Answer with JSON only, in English whatever language the outline is in: {"who": what THE THING is — "he", "she" or "it", "thing": THE THING in one phrase starting with "a" or "an", in its own words above ("a very tall woman in a long grey nightgown, her wet hair hanging over her face"), "moments": [one for each of moments ${numbers(only, n)}, in order: {"n": the moment's number, "seen": true or false, "set": what is in the room before anything happens, as one short sentence (somebody asleep, a dog in its basket), or "" for nothing, "door": (seen) the door or doorway of THIS room it comes in through, as the room names it ("the half-open door on the right"), "stands": (seen) where it stops and how it is there, present tense, without the subject ("stands at the foot of the bed, facing the sleeper, her head bowed"), "waits": (seen) what else moves while it is there, one short sentence, or "", "acts": (seen) what it does at the end, present tense, without the subject ("turns her head up toward the camera until she is looking straight into the lens"), "happens": (not seen) what changes, present tense, starting with the thing that changes ("the wardrobe door on the left swings slowly open"), "after": (not seen) that thing as it is afterwards, as a picture ("the wardrobe door on the left standing wide open, black inside"), "sound": the sound of the room and of what happens, in a few words}]}`,
    ].join("\n");
  }
  const worn = o.camera === "bodycam";
  return [
    `You are directing a found-footage FILM: ${n} moment${n > 1 ? "s" : ""} recorded by ONE camera — ${CAMERA_WORDS[o.camera]} — each of them ONE continuous shot. The film is already outlined; you turn each moment's line into the parts its shot is filmed from. Change nothing that a line says happens.`,
    ...head,
    "EVERY MOMENT IS BUILT THE SAME WAY. FIRST, for two seconds, the camera is NOT on its subject: it is looking somewhere ordinary in the same place — the floor as its holder walks, a doorway, the side of a bed — and what the moment is about is not in the picture. THEN the camera moves and FINDS it, and three beats follow: (1) what is there as the camera finds it — say exactly what it looks like and where it is; (2) the ONE thing that happens; (3) how this moment ends. It is ONE continuous shot of the seconds it has, that a real camera could film: no cut, no jump in time. If its end needs the camera to leave its subject, the camera swings away; if it needs the dark, the light goes out — no flash — and comes back.",
    '"seen": true when THE THING itself is in this moment\'s picture, however far off or small; false when only what it did is seen (a door that was shut, open; something moved), or the moment is about something else.',
    plain
      ? "Everything in it moves the way it really would, at its real speed. Nobody is hurt; everyone is fully clothed."
      : "WHEN THE THING IS SEEN, what frightens is slowness and stillness: it NEVER runs, flinches, turns away or screams, and nothing flashes or glitches. ITS MOUTH NEVER MOVES: nothing it does involves speaking, mouthing, chewing, or its mouth opening or closing. In the first moment it is far away and hard to be sure of. No blood, no gore, no wounds; everyone is fully clothed.",
    "NOBODY IN THE PICTURE EVER SPEAKS, and no spoken word is written anywhere but in \"says\": the video model moves the only mouth it can see to any word it is given.",
    `THE ONE FILMING is never seen: write what THE CAMERA does ("the camera backs away"), never what their body does. What they SAY is recorded on its own and laid over the shot — "says": one or two short lines for each moment, each with the mood it is said in, one of: ${TAKE_MOODS.join(", ")}. What a real person would actually blurt in THIS moment, specific to what they know by now (a name, what they heard, what happened the night before), broken off, 3 to 12 words — never a stock line ("what are you doing", "who is there", "hello?" on its own, "no no", "oh god"). ${plain ? "Nobody is frightened in this film: calm, excited, laughing, annoyed, whispering or shouting." : "The mood builds with the film: nobody is terrified in the first moment — they are annoyed, curious, half asleep; fear is for when it has been earned."}`,
    ...(worn ? [`${WORN_BOUNDS} "radio": what a dispatcher says over the radio as the FIRST moment opens — ONE short call: a unit number, why they were sent, a MADE-UP house number and street.`] : []),
    ...(which ? [which] : []),
    `Answer with JSON only, in English whatever language the outline is in: {${worn ? '"radio": the dispatcher\'s call, ' : ""}"moments": [one for each of moments ${numbers(only, n)}, in order: {"n": the moment's number, "seen": true or false, "who": what to call what the camera finds, lower case, 1–3 words ("she", "the figure", "the dog", "the door"), "still": THE SCENE THE CAMERA ARRIVES AT in this moment, as one picture, in 2–3 sentences — where the camera is, what is in front of it and how far away, the light — without describing the place or the thing over again, "opens": WHERE THE CAMERA LOOKS FIRST, as one picture of the same place with what the moment is about NOT in it, one or two sentences, "first": what the camera sees and what its holder is doing for those two seconds, one sentence starting "the camera", "finds": how the camera gets from there to its subject, a few words starting with a verb ("swings up to the hallway ahead"), "beats": [the three beats, one or two sentences each, in the present tense], "says": [{"text": the line, "mood": its mood} — one or two], "asks": "looking" if the first line is said BEFORE the camera finds its subject, "found" if on seeing it, "ends": how the moment ends — "comes" (it comes toward the camera), "stays" (the camera stays on it and the light does not change), "dark" (the light goes out or changes), "away" (the camera turns or swings away from it), "sound": the sound of the place and of what happens, in a few words}]}`,
  ].join("\n");
}

/** THE SHAPE THE DIRECTION'S WRITER IS HELD TO. */
export function footageDirectionSchema(camera: CameraLook): { name: string; schema: Record<string, unknown> } {
  const str = { type: "string" }, n = { type: "number" }, seen = { type: "boolean" };
  if (camera === "house") {
    return {
      name: "footage_house_direction",
      schema: {
        type: "object", additionalProperties: false, required: ["who", "thing", "moments"],
        properties: {
          who: { type: "string", enum: ["he", "she", "it"] }, thing: str,
          moments: { type: "array", items: { type: "object", additionalProperties: false, required: ["n", "seen", "set", "sound"], properties: { n, seen, set: str, door: str, stands: str, waits: str, acts: str, happens: str, after: str, sound: str } } },
        },
      },
    };
  }
  return {
    name: "footage_direction",
    schema: {
      type: "object", additionalProperties: false, required: ["moments"],
      properties: {
        radio: str,
        moments: { type: "array", items: {
          type: "object", additionalProperties: false, required: ["n", "seen", "who", "still", "opens", "first", "finds", "beats", "says", "asks", "ends", "sound"],
          properties: {
            n, seen, who: str, still: str, opens: str, first: str, finds: str, beats: { type: "array", items: str, minItems: 3, maxItems: 3 },
            says: { type: "array", minItems: 1, maxItems: 2, items: { type: "object", additionalProperties: false, required: ["text", "mood"], properties: { text: str, mood: { type: "string", enum: [...TAKE_MOODS] } } } },
            asks: { type: "string", enum: ["looking", "found"] }, ends: { type: "string", enum: ["comes", "stays", "dark", "away"] }, sound: str,
          },
        } },
      },
    },
  };
}

/** no quoted word ever reaches the engine: the marks are taken out of everything a direction is built from */
const unquoted = (v: unknown): string => String(v ?? "").replace(/["“”]/g, "");
/** what a creature never does in its beats (the ready-made scares are held to the same) … */
const THING_SPEAKS = /\b(speaks?|says?|whispers?|screams?|shouts?|laughs?|mouths)\b/i;
/** … and what nobody on camera does in a plain one: the engine is given no word, so nobody is written speaking */
const SOMEBODY_SPEAKS = /\b(speaks?|says?|whispers?|shouts?|yells?|screams?|talks?|tells?|replies|sings?|mouths)\b/i;

/* THE FIRST LIVE FILM (2026-11-25, "What Circled the Tent", camcorder, three moments): every moment of its direction was
 * refused, twice, and the film was made as ONE take of its last night. The single take's checker (take.ts → parseTake)
 * takes EXACTLY three beats, and refuses a moment whole when a beat has anybody speaking in it; the film's writer is
 * asked for "the three beats" and its answer was held to neither by its schema — and "a scream echoes through the
 * trees" is a horror moment's ordinary sentence. So a moment's beats are made three (more folded into the third; two
 * become three at the longer one's sentence break), and a sentence with anybody speaking in it is taken OUT of the beats
 * rather than the moment refused. What is still refused says why (directionFaults → the server's log). */
const sentencesOf = (s: string): string[] => s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
export function threeBeats(list: ReadonlyArray<unknown>): string[] {
  const b = list.map((x) => unquoted(x).replace(/\s+/g, " ").trim()).filter(Boolean);
  if (b.length >= 3) return [b[0], b[1], b.slice(2).join(" ")];
  if (b.length === 2) {
    const k = b[0].length >= b[1].length ? 0 : 1;
    const parts = sentencesOf(b[k]);
    if (parts.length >= 2) {
      const half = Math.ceil(parts.length / 2), a = parts.slice(0, half).join(" "), c = parts.slice(half).join(" ");
      return k === 0 ? [a, c, b[1]] : [b[0], a, c];
    }
  }
  if (b.length === 1) { const parts = sentencesOf(b[0]); if (parts.length >= 3) return [parts[0], parts[1], parts.slice(2).join(" ")]; }
  return b;
}
/** A beat with every sentence that has anybody SPEAKING in it taken out ("" when nothing is left). */
export const quietBeat = (beat: string, speaks: RegExp): string => sentencesOf(beat).filter((s) => !speaks.test(s)).join(" ").trim();
/** The beat a moment is given when only two are left — what found footage does between two things anyway. */
export const HOLD_BEAT = "The camera holds on it for a breath, unsteady.";
/** A moment's three beats: made three, every sentence with somebody speaking taken out, made three again — and when
 *  two are left, the camera's hold between them. Fewer than two: none (the moment is refused, as before). */
export function beatsFor(list: ReadonlyArray<unknown>, speaks: RegExp): string[] {
  const three = threeBeats(threeBeats(list).map((b) => quietBeat(b, speaks)).filter(Boolean));
  return three.length === 2 ? [three[0], HOLD_BEAT, three[1]] : three;
}
/** WHY a direction's moments would be refused — one line per moment that would be, for the server's log (the first
 *  live film was refused with nothing to say why). Mirrors handMoment's rules. */
export function directionFaults(raw: unknown, o: FootageOutline, only?: readonly number[]): string[] {
  const r = readAnswer(raw);
  const list = r && Array.isArray(r.moments) ? r.moments : [];
  const wanted = only && only.length ? [...only] : o.moments.map((_, i) => i);
  if (!list.length) return [`no moments in the answer (${String(typeof raw === "string" ? raw : JSON.stringify(raw) || "").slice(0, 160)})`];
  const out: string[] = [];
  list.forEach((x, k) => {
    const m = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const n = Math.round(Number(m.n)), i = Number.isFinite(n) && wanted.includes(n - 1) ? n - 1 : wanted[k];
    if (i == null || o.camera === "house") return;
    const scare = o.kind === "scare" && m.seen !== false && (!!o.thing || o.kind === "scare");
    const beats = beatsFor(Array.isArray(m.beats) ? m.beats : [], scare ? THING_SPEAKS : SOMEBODY_SPEAKS);
    const why: string[] = [];
    if (beats.length !== 3) why.push(`${Array.isArray(m.beats) ? m.beats.length : 0} beats (${beats.length} after speech is taken out)`);
    if (unquoted(m.still).trim().length < 40) why.push("still under 40 characters");
    if (!unquoted(m.who).trim()) why.push("no who");
    if (unquoted(m.opens).trim().length < 20) why.push("opens under 20 characters");
    if (unquoted(m.first).trim().length < 12) why.push("first under 12 characters");
    if (unquoted(m.finds).replace(/^the camera\s+/i, "").trim().length < 4) why.push("finds under 4 characters");
    if (why.length) out.push(`moment ${i + 1}: ${why.join("; ")}`);
  });
  return out;
}

/** The mood a line is said in when its writer named none: nobody in a plain film is frightened; in a scare the fear
 *  is the last moment's (scared, then terrified — one take's own two manners), and before it they whisper. */
function ownMood(kind: FootageKind, last: boolean, line: number, lines: number): TakeMood {
  if (kind === "plain") return "calm";
  if (!last) return "whispering";
  return lines > 1 && line === lines - 1 ? "terrified" : "scared";
}

/** WHEN THE ONE FILMING SPEAKS in a moment of `seconds`: the first line as they look (0.3 s) or just after the camera
 *  finds its subject; the second as the moment's end begins — one take's own two times (take.ts → takeLines), moved
 *  with the moment's length. Each line carries its mood. */
export function momentScript(t: Pick<Take, "says" | "asks">, seconds: number, moods: ReadonlyArray<TakeMood | undefined>): Array<{ at: number; text: string; mood?: TakeMood }> {
  const out: Array<{ at: number; text: string; mood?: TakeMood }> = [];
  const first = t.asks === "looking" ? 0.3 : TAKE_OPENS_SECONDS + 0.8;
  if (t.says[0]) out.push({ at: first, text: t.says[0], ...(moods[0] ? { mood: moods[0] } : {}) });
  if (t.says[1]) out.push({ at: Math.round(Math.max(first + 2.2, seconds - 3.4) * 10) / 10, text: t.says[1], ...(moods[1] ? { mood: moods[1] } : {}) });
  return out;
}

function handMoment(raw: Record<string, unknown>, o: FootageOutline, i: number, radio: string): DirectedMoment | null {
  const m = o.moments[i], last = i === o.moments.length - 1;
  // (a film with no thing that recurs: every moment is about what its own line says — and in a SCARE, a moment the
  //  writer says something is seen in is still the scare's, with all of its rules (stillness, the mouth that never
  //  moves). Until the review of 2026-11-25 it was made plain: directed to move "at its real speed", its picture told
  //  "no figure" over a still that had one. Not a horror: nothing is a creature, seen or not.)
  const seen = raw.seen !== false && (!!o.thing || o.kind === "scare");
  const scare = o.kind === "scare" && seen;
  const said = (Array.isArray(raw.says) ? raw.says : []).map((s): { text?: unknown; mood?: unknown } => (s && typeof s === "object" ? (s as { text?: unknown; mood?: unknown }) : { text: s }))
    .map((s) => ({ text: words(s.text, 90), mood: takeMood(s.mood) })).filter((s) => s.text).slice(0, 2);
  // (three beats, always, and nobody speaking in them — a sentence that has somebody speak is taken out, never the
  //  whole moment: the first live film lost all three of its moments to these two rules — threeBeats, quietBeat)
  const beats = beatsFor(Array.isArray(raw.beats) ? raw.beats : [], scare ? THING_SPEAKS : SOMEBODY_SPEAKS);
  // THE SINGLE TAKE'S OWN RULES: every part there and of a sane length (parseTake) — a moment is never filmed from half
  // a direction
  const take = parseTake({
    title: o.title, who: unquoted(raw.who), still: unquoted(raw.still), opens: unquoted(raw.opens), first: unquoted(raw.first), finds: unquoted(raw.finds),
    beats, says: said.map((s) => s.text), asks: raw.asks, ends: raw.ends, sound: unquoted(raw.sound),
    ...(o.camera === "bodycam" && i === 0 && radio ? { radio } : {}),
  });
  if (!take) return null;
  const direction = [take.still, take.opens, take.first, take.finds, ...take.beats].join(" ");
  // NO WORD FOR THE ENGINE: a thing that speaks, or anybody written speaking, is not followed
  if ((scare ? THING_SPEAKS : SOMEBODY_SPEAKS).test(take.beats.join(" "))) return null;
  // a body camera's plain moments keep the drama's bounds: no weapon, no blow, no wound
  if (o.camera === "bodycam" && !scare && hurtIn(`${direction} ${take.radio || ""}`)) return null;
  const lines = said.length;
  const moods = said.map((s, k) => s.mood || ownMood(o.kind, last, k, lines));
  return {
    cam: "hand", seen,
    take: { ...take, ...(scare ? {} : { genre: "plain" as const }), seconds: m.seconds, script: momentScript(take, m.seconds, moods) },
  };
}

function houseMoment(raw: Record<string, unknown>, top: Record<string, unknown>, o: FootageOutline, i: number): DirectedMoment | null {
  const m = o.moments[i];
  const room = houseRoom(m.room)?.key || "living";
  const plain = o.kind === "plain";
  const shape = { seconds: m.seconds, plain };
  if (raw.seen === false) {
    const scare = parseHouseTrace({ title: o.title, set: raw.set, happens: raw.happens, after: raw.after, sound: raw.sound }, room, shape);
    return scare ? { cam: "house", seen: false, lapse: false, scare } : null;
  }
  // (a moment may name a thing of its own — a film where nothing recurs; else it is THE THING. The way in: one house
  //  take's rule wants a door, a doorway, a hall, the stairs or a window — and the hallway's own words say "staircase",
  //  so that is read as the stairs it is rather than losing the moment)
  const door = String(raw.door ?? "").replace(/\bstaircase\b/gi, "stairs");
  const scare = parseHouseScare({ title: o.title, who: raw.who || top.who, thing: raw.thing || top.thing, set: raw.set, door, stands: raw.stands, waits: raw.waits, acts: raw.acts, sound: raw.sound }, room, shape);
  if (!scare) return null;
  const the = scare.thing.first.replace(/^(a|an)\s+/i, "the ");
  return {
    cam: "house", seen: true,
    // (the time-lapse is the walk-in's own window: only a fifteen-second scare has the stillness it plays over)
    lapse: !plain && houseTimes(m.seconds).seconds === HOUSE_TAKE_SECONDS,
    scare: {
      ...scare,
      // the same one in every moment: named from words the first time it is drawn, from its picture after
      thing: { key: "", first: scare.thing.first, again: `${the} from the second reference image` },
      // THE THING, WORD FOR WORD, in the picture's words
      scene: o.thing ? `${scare.scene}. Exactly this one — ${o.thing.replace(/\.$/, "")}` : scare.scene,
    },
  };
}

/** THE DIRECTION'S ANSWER, checked moment by moment against the single takes' own rules — one entry for each moment
 *  of the outline, null where the answer for it is missing or not one to film. (A moment says which it is by "n";
 *  an answer without numbers is read in order.) */
export function parseFootageDirection(raw: unknown, o: FootageOutline, only?: readonly number[]): FootageDirection {
  const out: FootageDirection = o.moments.map(() => null);
  const r = readAnswer(raw);
  const list = r && Array.isArray(r.moments) ? r.moments : [];
  const radio = words(r?.radio, 140);
  const wanted = only && only.length ? [...only] : o.moments.map((_, i) => i);
  list.forEach((x, k) => {
    const m = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const n = Math.round(Number(m.n));
    const i = Number.isFinite(n) && wanted.includes(n - 1) ? n - 1 : wanted[k];
    if (i == null || i < 0 || i >= o.moments.length || out[i]) return;
    out[i] = o.camera === "house" ? houseMoment(m, r as Record<string, unknown>, o, i) : handMoment(m, o, i, radio);
  });
  return out;
}
/** The moments still to be written (their places in the outline). */
export const undirected = (d: FootageDirection): number[] => d.map((m, i) => (m ? -1 : i)).filter((i) => i >= 0);
/** A direction with the moments a second answer wrote put in — never over one that was already there. */
export const withDirected = (d: FootageDirection, more: FootageDirection): FootageDirection => d.map((m, i) => m || more[i] || null);

/* ---- THE PICTURES (a camera somebody holds or wears; a house camera's are the kept house's) ---- */

/** How a film's pictures look: a horror is caught at night on a bad camera (the creature recipe's own first part);
 *  anything else is caught in whatever light there was — a body camera's in its own. */
const caughtBy = (o: Pick<FootageOutline, "kind" | "camera">): string => (o.kind === "scare" ? TAKE_CAUGHT : o.camera === "bodycam" ? DRAMA_CAUGHT : PLAIN_CAUGHT);
/** …and what each is held to: the creature's other two parts only where the thing is IN the picture. */
const heldTo = (o: Pick<FootageOutline, "kind" | "camera">, seen: boolean): string => (o.kind === "scare"
  ? (seen ? `${TAKE_WRONG} ${TAKE_HIDDEN}` : "NOTHING frightening is in the picture itself: no figure, no face in the dark. No blood, no gore, no wounds.")
  : o.camera === "bodycam" ? DRAMA_BOUNDS : PLAIN_BOUNDS);

/** THE PICTURE A MOMENT ARRIVES AT, as the picture model is asked for it. THE PLACE AND THE THING ARE THE OUTLINE'S OWN
 *  WORDS, WORD FOR WORD, in every one — that, and the pictures handed over with it, is what makes it one film:
 *    refs 0   the film's first picture: from words alone.
 *    refs 1   drawn FROM the first picture (the reference): the same place, at another moment.
 *    refs 2   …and from the picture the thing was drawn up close in (the second reference): the same one.
 *  `seen`: the thing is in this picture (else it is not named in it at all). */
export function footageScenePrompt(o: Pick<FootageOutline, "kind" | "camera" | "aspect" | "place" | "thing">, m: { still: string; seen: boolean; who?: string }, refs: 0 | 1 | 2 = 0): string {
  const still = stop(words(m.still, 700)), place = words(o.place, FOOTAGE_LIMITS.place), thing = m.seen ? words(o.thing, FOOTAGE_LIMITS.thing) : "";
  // (held to what is IN the picture: a scare's moment with something in it — a film whose writer named no thing that
  //  recurs still has one in its moment — is never told "no figure" over a still that has one. Review, 2026-11-25.)
  const end = `${heldTo(o, m.seen)} Nothing written anywhere in the picture. No watermark, no signature.`;
  if (!refs) return `${shapeOf(o.aspect)} ${caughtBy(o)} ${place ? `THE PLACE: ${stop(place)} ` : ""}WHAT THE CAMERA SEES: ${still}${thing ? ` WHO OR WHAT IT IS: ${stop(thing)}` : ""} ${end}`;
  // ("the SAME she as in …" is no sentence: a pronoun is "one"; "the figure" is the SAME figure)
  const named = words(m.who, 40).replace(/^(the|a|an)\s+/i, "");
  const who = !named || /^(she|he|it|they|her|him|them)$/i.test(named) ? "one" : named;
  const same = thing ? (refs === 2 ? ` It is the SAME ${who} as in the second reference image — the same face, the same body, the same clothes: ${stop(thing)}` : ` WHO OR WHAT IT IS: ${stop(thing)}`) : "";
  return `${shapeOf(o.aspect)} The SAME place and the SAME camera as the ${refs === 2 ? "first " : ""}reference image — the same walls, floor, furniture, light and grain wherever the picture shows the same part of it — at ANOTHER MOMENT: ${still}${same} ${place ? `THE PLACE, in words: ${stop(place)} ` : ""}Real footage, never a render. ${end}`;
}

/** A moment's WAY IN (its first frame, off its subject), drawn from its own scene as one take's is (take.ts →
 *  takeOpensPrompt) — a body camera's plain moment keeps the drama's bounds. */
export function footageOpensPrompt(o: Pick<FootageOutline, "camera" | "aspect">, take: Pick<Take, "opens" | "genre">): string {
  const p = takeOpensPrompt(take, o.aspect);
  return o.camera === "bodycam" && take.genre === "plain" ? p.replace(/ Nothing written anywhere\.$/, ` ${DRAMA_BOUNDS} Nothing written anywhere.`) : p;
}

/** THE ORDER A FILM'S SCENES ARE DRAWN IN — so that it is one place and one thing. `seen[i]`: the thing is in moment
 *  i's picture (null: the moment has no direction, and is not drawn). The film's FIRST moment is drawn from words:
 *  every other is drawn from it (the place). The LAST moment the thing is seen in — its payoff, where it is closest —
 *  is drawn next, and every other moment it is in is drawn from that too (the thing). `rest`: the others, which can
 *  be drawn together. */
export function footageScenePlan(seen: ReadonlyArray<boolean | null>): { place: number; thing: number | null; rest: number[] } | null {
  const all = seen.map((s, i) => (s === null ? -1 : i)).filter((i) => i >= 0);
  if (!all.length) return null;
  const place = all[0];
  const withIt = all.filter((i) => seen[i]);
  const thing = withIt.length ? withIt[withIt.length - 1] : null;
  return { place, thing, rest: all.filter((i) => i !== place && i !== thing) };
}

/* ---- THE CLOCK A MOMENT PRINTS: WHAT ITS CARD SAYS ---- */

const NUMBER_WORDS = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE"];
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** WHAT A CARD SAYS ABOUT WHEN: which night or day it is (`day`, counted from 1 — null: it does not say), whether it
 *  calls it a night or a day (`part`), a weekday (0 = Sunday), and the time (seconds after midnight — null: none).
 *  "NIGHT 2 · 3:07 AM" → the second night, 03:07. */
export function cardWhen(when: unknown): { day: number | null; part: "night" | "day" | "morning" | "evening" | null; weekday: number | null; time: number | null } {
  const s = String(when ?? "").toUpperCase();
  const d = /\b(NIGHT|DAY|EVENING|MORNING|WEEK)\s*#?\s*(\d{1,3}|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE)\b/.exec(s);
  const count = d ? (/^\d/.test(d[2]) ? Number(d[2]) : NUMBER_WORDS.indexOf(d[2])) : 0;
  const day = d && count >= 1 ? (d[1] === "WEEK" ? (count - 1) * 7 + 1 : count) : null;
  const named = /\b(NIGHT|EVENING|MORNING|DAY)\b/.exec(s);
  const part = named ? (named[1].toLowerCase() as "night" | "day" | "morning" | "evening") : null;
  const wd = /\b(SUN|MON|TUE|WED|THU|FRI|SAT)[A-Z]*\b/.exec(s);
  let time: number | null = null;
  const t = /\b(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*(A\.?M\.?|P\.?M\.?)?/.exec(s) || /\b(\d{1,2})()()\s*(A\.?M\.?|P\.?M\.?)(?![A-Z])/.exec(s);
  if (t) {
    let h = Number(t[1]);
    const min = Number(t[2] || 0), sec = Number(t[3] || 0), half = (t[4] || "").replace(/\./g, "");
    if (half && h >= 1 && h <= 12) h = (h % 12) + (half === "PM" ? 12 : 0);
    if (h <= 23 && min <= 59 && sec <= 59 && (half ? true : !!t[2])) time = h * 3600 + min * 60 + sec;
  }
  return { day, part, weekday: wd ? WEEKDAYS.indexOf(wd[1]) : null, time };
}

/** The date `days` after a day, as the camera prints it ("2026-11-24 TUE"). */
function dateAfter(today: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(today);
  const base = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : Date.UTC(2026, 10, 24);
  const d = new Date(base + Math.round(days) * 86_400_000);
  return camDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** EACH MOMENT'S CLOCK, FROM ITS CARD — what a house camera and a body camera print, and what a camcorder burns into
 *  its corner. The card is on screen the moment before, so the clock says what it says: "NIGHT 2 · 3:07 AM" is the
 *  second night at 03:07 (a night's small hours are the morning after: NIGHT 2 at 11:50 PM comes before NIGHT 2 at
 *  2 AM, a date later). What a card does not say is filled in believably: no night → the night of the moment before,
 *  or the next one when its hour has already gone by; no hour → later the same night, or a new night's small hours;
 *  nothing readable at all → consecutive nights. The film's LAST night is `today` ("YYYY-MM-DD": footage is found
 *  after it was shot). `seed`: any whole number — the seconds, and the hours nobody gave, are picked by it. */
export function footageClocks(whens: readonly unknown[], today: string, seed = 0): HouseClock[] {
  const HOUR = 3600;
  const pick = (i: number, span: number) => (span > 0 ? Math.abs(Math.floor(Number(seed) || 0) + i * 7919) % span : 0);
  // each moment as a day (0 = the film's first) and a time; `night`: its small hours belong to the morning after
  const at: Array<{ day: number; time: number; night: boolean; weekday: number | null }> = [];
  whens.forEach((when, i) => {
    const w = cardWhen(when), prev = at[i - 1];
    // THE HOUR: the card's (its seconds picked — a camera never starts on the minute); else a believable one for the
    // part of the day it names — and a night's small hours when it names none
    const time = w.time !== null ? w.time + (w.time % 60 === 0 ? 5 + pick(i, 50) : 0)
      : w.part === "day" ? 13 * HOUR + pick(i, 4 * HOUR)
      : w.part === "morning" ? 7 * HOUR + pick(i, 3 * HOUR)
      : w.part === "evening" ? 19 * HOUR + pick(i, 2 * HOUR)
      : NIGHT.from + pick(i, NIGHT.lastStart - NIGHT.from);
    const night = w.part === "night" || (w.part === null && (time < 6 * HOUR || time >= 20 * HOUR));
    // THE NIGHT: the card's; else the weekday it names, counted on from the one before; else — an hour and nothing
    // more — the same night while the hours go forward, the next one when this hour has already gone by; and a card
    // that says neither is the next night
    const day = w.day !== null ? w.day - 1
      : !prev ? 0
      : w.weekday !== null && prev.weekday !== null && w.weekday !== prev.weekday ? prev.day + ((w.weekday - prev.weekday + 7) % 7)
      : w.time === null ? prev.day + 1
      : order(time, night) > order(prev.time, prev.night) ? prev.day : prev.day + 1;
    at.push({ day, time, night, weekday: w.weekday });
  });
  // the date each prints: a night's small hours are the morning after it began
  const offset = at.map((m) => m.day + (m.night && m.time < 12 * HOUR ? 1 : 0));
  const last = Math.max(0, ...offset);
  // (a card that names a weekday is printed on one: every date moves back together, by less than a week)
  const named = at.findIndex((m) => m.weekday !== null);
  const back = named < 0 ? 0 : (WEEKDAYS.indexOf(dateAfter(today, offset[named] - last).slice(11)) - (at[named].weekday as number) + 7) % 7;
  return at.map((m, i) => ({ date: dateAfter(today, offset[i] - last - back), start: m.time }));
}
/** where a time falls in its night or day: a night runs from noon to noon, so 11 PM comes before 2 AM */
const order = (time: number, night: boolean): number => (night ? (time + 12 * 3600) % 86400 : time);

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** What a camcorder burns into its corner for a clock: "NOV 25 2026" and "2:14 AM" (camera-dress.ts → stamp). */
export function camStamp(clock: HouseClock): { date: string; time: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(clock.date);
  const date = m ? `${MONTHS[Math.max(0, Math.min(11, Number(m[2]) - 1))]} ${Number(m[3])} ${m[1]}` : "NOV 24 2026";
  const s = ((Math.floor(clock.start) % 86400) + 86400) % 86400, h = Math.floor(s / 3600), min = Math.floor(s / 60) % 60;
  return { date, time: `${h % 12 || 12}:${String(min).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}` };
}

/* ---- THE CARDS ---- */

/** A card's words as ffmpeg's drawtext is given them, inside text='…' with expansion=none: capitals; nothing that
 *  ends the quote or escapes (an apostrophe becomes a typographic one, a backslash and a percent sign go); and every
 *  colon escaped for the filter's own option parser ("2:14" would otherwise end the text at "2"). */
export function cardText(when: unknown): string {
  return cardWords(when).replace(/[\\%']/g, "").replace(/:/g, "\\:") || "FOUND FOOTAGE";
}

/** How far the camera's noise floor (take.ts → TAKE_HISS, the same brown noise the takes lay under their rooms) is
 *  turned down under a card. Measured 2026-11-25 on rendered cards: −18 dB here plays at −62.6 dB — far under a
 *  take's room (−34), and not the −90 of digital silence (which is what −46 dB here came out as). */
export const FOOTAGE_CARD_DB = -18;

/** THE CARD BEFORE A MOMENT, as ffmpeg's arguments: its `when` on black — white, the camera's mono face, centred —
 *  for FOOTAGE_CARD_SECONDS, at the film's own size and frame rate (so it joins the takes without being scaled),
 *  with NEAR-silence under it: a camera's own noise floor, far down — never digital zero, which reads as the sound
 *  cutting out. A hard cut in and out: nothing fades. */
export function footageCardArgs(o: { when: unknown; w: number; h: number; fps: number; font: string; out: string }): string[] {
  const w = Math.max(2, 2 * Math.round(o.w / 2)), h = Math.max(2, 2 * Math.round(o.h / 2));
  const fps = footageFps(o.fps);
  const text = cardText(o.when);
  // (as wide as the frame allows — a mono face's letters are 0.6 of its size wide — and never taller than a card wants)
  const letters = Math.max(1, cardWords(o.when).length || 13);
  const size = Math.max(14, Math.round(Math.min(w * 0.052, h * 0.075, (w * 0.86) / (0.6 * letters))));
  const secs = FOOTAGE_CARD_SECONDS.toFixed(3);
  return [
    "-v", "error", "-y",
    "-f", "lavfi", "-t", secs, "-i", `color=c=black:s=${w}x${h}:r=${fps}`,
    "-f", "lavfi", "-t", secs, "-i", `anoisesrc=color=brown:amplitude=0.05:sample_rate=${FOOTAGE_RATE}`,
    "-filter_complex", `[0:v]drawtext=fontfile='${filterPath(o.font)}':expansion=none:text='${text}':fontcolor=white:fontsize=${size}:x=(w-tw)/2:y=(h-th)/2,format=yuv420p[v];[1:a]aformat=channel_layouts=stereo,highpass=f=60,lowpass=f=1400,volume=${FOOTAGE_CARD_DB}dB[a]`,
    "-map", "[v]", "-map", "[a]", "-t", secs,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(fps), "-c:a", "aac", "-b:a", "160k", "-ar", String(FOOTAGE_RATE), "-movflags", "+faststart", o.out,
  ];
}

/* ---- THE JOIN: CARDS AND MOMENTS, STRAIGHT CUTS, PICTURE AND SOUND THE SAME LENGTH ---- */

/** The film's sound rate (the takes' own: take.ts → takeSound mixes at 48 kHz). */
export const FOOTAGE_RATE = 48000;
/** The frame rates a film can be joined at — each divides the sound rate, so a piece's sound can be cut to its
 *  frames exactly. A take keeps the rate it was dressed at (a phone's 24, a house camera's 15, a body camera's 30):
 *  nothing is re-timed, so nothing judders. Any other rate is joined at 30. */
export const FOOTAGE_FPS = [15, 24, 25, 30] as const;
export const footageFps = (v: unknown): number => { const n = Math.round(Number(v)); return (FOOTAGE_FPS as readonly number[]).includes(n) ? n : 30; };
/** How far the finished film's picture and sound may differ — from each other, and from the length its pieces add up
 *  to: two frames, and one block of sound (acted-staging.ts → JOIN_TOLERANCE, at this film's own rates). */
export const footageTolerance = (fps: number): number => 2 / footageFps(fps) + 1024 / FOOTAGE_RATE;

/** THE JOIN, as ffmpeg's filter graph (outputs [vc] and [ac]) — the acted films' join (acted-staging.ts → joinGraph:
 *  why every piece is made exactly as long as its PICTURE, and its sound the very same length) with every seam a
 *  straight cut, at the film's own frame rate. `frames[i]`: piece i's length in frames at `fps`, read off its
 *  picture; `silent[i]`: it has no sound (silence of its length is made). Each piece is fitted to w×h (never
 *  cropped: a dressed take's marks sit at its edges), its last frame held if it is a frame short, then cut; its
 *  sound cut or padded to the very same length, meeting the next in two 12 ms fades so a cut never clicks. Returns
 *  the graph and the film's length in frames. */
export function footageJoinGraph(o: { frames: ReadonlyArray<number>; fps: number; w: number; h: number; silent?: ReadonlyArray<boolean> }): { graph: string; frames: number } {
  const n = o.frames.map((f) => Math.max(1, Math.round(Number(f) || 0)));
  if (!n.length) return { graph: "", frames: 0 };
  const fps = footageFps(o.fps), per = FOOTAGE_RATE / fps;
  const w = Math.max(2, 2 * Math.round(o.w / 2)), h = Math.max(2, 2 * Math.round(o.h / 2));
  const g: string[] = [];
  n.forEach((frames, i) => {
    g.push(`[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=bicubic,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${fps},format=yuv420p,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=3,trim=end_frame=${frames},setpts=PTS-STARTPTS[v${i}]`);
    const samples = frames * per;
    const fades = [...(i > 0 ? ["afade=t=in:d=0.012"] : []), ...(i < n.length - 1 ? [`afade=t=out:st=${(frames / fps - 0.012).toFixed(6)}:d=0.012`] : [])];
    const cut = `atrim=end_sample=${samples},asetpts=PTS-STARTPTS${fades.length ? `,${fades.join(",")}` : ""}[a${i}]`;
    g.push(o.silent?.[i]
      ? `anullsrc=r=${FOOTAGE_RATE}:cl=stereo,${cut}`
      : `[${i}:a]aresample=${FOOTAGE_RATE},aformat=sample_fmts=fltp:sample_rates=${FOOTAGE_RATE}:channel_layouts=stereo,asetpts=PTS-STARTPTS,apad,${cut}`);
  });
  g.push(`${n.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${n.length}:v=1:a=1[vc][ac]`);
  return { graph: g.join(";"), frames: n.reduce((s, f) => s + f, 0) };
}

/** IS THE FINISHED FILM WHOLE? Its picture and its sound the same length, and the length its pieces add up to — each
 *  within footageTolerance. The reason, when it is not (and such a film is never shipped). */
export function footageJoinCheck(o: { video: number | null | undefined; audio: number | null | undefined; frames: number; fps: number }): { ok: boolean; why: string } {
  const v = Number(o.video), a = Number(o.audio), tol = footageTolerance(o.fps), want = o.frames / footageFps(o.fps);
  if (!(v > 0)) return { ok: false, why: "the finished film has no picture" };
  if (!(a > 0)) return { ok: false, why: "the finished film has no sound" };
  if (!(Math.abs(v - a) <= tol)) return { ok: false, why: `its picture runs ${v.toFixed(3)} s and its sound ${a.toFixed(3)} s` };
  if (!(Math.abs(v - want) <= tol)) return { ok: false, why: `its picture runs ${v.toFixed(3)} s where its cards and moments add up to ${want.toFixed(3)} s` };
  return { ok: true, why: "" };
}

/* ---- THE JOB A BUILDER ASKS FOR ---- */

/** The builder's form for a film: the single take's (take.ts → FootageForm), and either the outline the member
 *  approved (`outline`, as the page holds it) or — for one press — how many `moments` to write. */
export type FootageFilmForm = FootageForm & { outline?: unknown; moments?: unknown };
/** Why a film cannot be queued, in words the page can show — beside the single take's own (take.ts → footageJob). */
export const FOOTAGE_OUTLINE_UNREADABLE = "Those moments can't be read — write them again.";
export const FOOTAGE_OUTLINE_OTHER_CAMERA = "Those moments were written for another camera — write them again.";
const yes = (v: unknown) => v === true || v === "1" || v === "on" || v === "true";
const no = (v: unknown) => v === false || v === "0" || v === "off" || v === "false";

/** A film's idea as ONE take is asked for it: its last moment — the payoff — with the thing and the place it was
 *  written for. (An outline the member cut down to one moment; and what a film that cannot be made falls back to.) */
export const footageIdea = (o: Pick<FootageOutline, "moments" | "thing" | "place">): string =>
  words([o.moments[o.moments.length - 1]?.line || "", o.thing, o.place ? `It happens here: ${o.place}` : ""].filter(Boolean).map(stop).join(" "), 400);

/** THE JOB A FILM IS QUEUED AS — or why not. The single take's job (take.ts → footageJob: `contentType: "take"`, the
 *  camera, the shape, the house's settings) with one thing more: `takeOutline` — the outline the member approved,
 *  cleaned here — or `takeMoments`, how many moments to write for one press. One moment is one take, exactly as it
 *  is queued today. `t`: the page's language — a card's words left as they were in it are left as they were, and the
 *  refusal comes back in it. */
export function footageFilmJob(f: FootageFilmForm, t: (s: string) => string = (s) => s): { ok: true; name: string; moments: number; payload: Record<string, unknown> } | { ok: false; error: string } {
  const refuse = (error: string) => ({ ok: false as const, error: t(error) });
  const asked = f.outline != null && String(typeof f.outline === "string" ? f.outline : "x").trim() !== "";
  if (asked) {
    const outline = cleanFootageOutline(f.outline);
    if (!outline) return refuse(FOOTAGE_OUTLINE_UNREADABLE);
    // (the camera on the form is the one it is filmed on — any camera carried the way the outline's is: a phone's
    //  moments can be filmed on a camcorder; a house's rooms cannot be walked through with a phone)
    const camera = cameraLookOf(f.camera) || outline.camera;
    if (familyOf(camera) !== familyOf(outline.camera)) return refuse(FOOTAGE_OUTLINE_OTHER_CAMERA);
    const film: FootageOutline = { ...outline, camera, aspect: shapeFor(camera, f.aspect ?? outline.aspect) };
    const card = footageScare(f.scare);
    if (film.moments.length < 2) {
      // ONE MOMENT IS ONE TAKE: its line (with the thing and the place it was written for) is the take's own idea
      const one = footageJob({ ...f, scare: OWN_SCARE, camera, aspect: film.aspect, own: footageIdea(film), room: film.moments[0].room }, t);
      return one.ok ? { ...one, moments: 1 } : refuse(one.error);
    }
    const house = camera === "house";
    return {
      ok: true, name: film.title, moments: film.moments.length,
      payload: {
        section: "creator", contentType: "take",
        takeCamera: camera, takeAspect: film.aspect,
        takeOutline: JSON.stringify(film),
        // (their own words, for the piece's record — the outline is what is filmed)
        ...(words(f.own, 400) ? { takeOwn: words(f.own, 400) } : {}),
        ...(card && card.cams.includes(camera) ? { takeFrom: card.key } : {}),
        // (a film's time-lapse starts off — it plays on a moment where the thing stands still; night vision starts on)
        ...(house ? { takeLapse: yes(f.lapse), takeIr: !no(f.ir) } : {}),
        productTitle: `Found Footage — ${film.title}`.slice(0, 60),
        ...(card ? { productImageUrl: card.img } : {}),
        initiator: "web",
      },
    };
  }
  // ONE PRESS: the single take's own job, and how many moments to write from it
  const one = footageJob(f, t);
  if (!one.ok) return refuse(one.error);
  const n = momentCount(f.moments);
  if (n < 2) return { ...one, moments: 1 };
  const { takeIdea: ready, ...payload } = one.payload as Record<string, unknown> & { takeIdea?: string };
  // (a card left as it was: the film grows from the card's own words — its premise is the idea, the card where it starts)
  const card = ready ? footageScare(ready) : undefined;
  return {
    ok: true, name: one.name, moments: n,
    payload: { ...payload, ...(card ? { takeOwn: card.premise, takeFrom: card.key } : {}), takeMoments: n },
  };
}

/** WHAT THE OUTLINE'S WRITER IS ASKED when the page asks for the moments (the free preview, before anything is
 *  queued) — or why not. The same decisions the job makes (take.ts → footageJob: the camera, the shape, whose idea
 *  it is), so the outline a member reads is the film that one press would have made: a card left as it was is its
 *  own words and where the film starts; words of their own are the idea, written from the card they started on.
 *  `count`: the moments asked for (three when the page does not say; a film is never fewer than two). */
export function footageOutlineAsk(f: FootageFilmForm, t: (s: string) => string = (s) => s): { ok: true; idea: string; from?: string; camera: CameraLook; aspect: "9:16" | "16:9"; count: number } | { ok: false; error: string } {
  const one = footageJob(f, t);
  if (!one.ok) return { ok: false, error: t(one.error) };
  const p = one.payload as { takeCamera: CameraLook; takeAspect: "9:16" | "16:9"; takeIdea?: string; takeOwn?: string; takeFrom?: string };
  const card = p.takeIdea ? footageScare(p.takeIdea) : undefined;
  const from = card?.key || p.takeFrom;
  return { ok: true, idea: card ? card.premise : String(p.takeOwn || ""), ...(from ? { from } : {}), camera: p.takeCamera, aspect: p.takeAspect, count: Math.max(2, momentCount(f.moments == null || String(f.moments).trim() === "" ? 3 : f.moments)) };
}

/** The card a film's idea started from, for this camera — a handheld or body-cam scare, or a house scare (its key is
 *  one or the other's). Undefined when there is none, or this camera cannot film it. */
export function footageFrom(key: unknown, camera: CameraLook): TakeIdea | HouseScare | undefined {
  if (camera === "house") return houseScare(key);
  const card = takeIdea(key);
  return card && (card.cams || HAND_CAMS).includes(camera) ? card : undefined;
}
