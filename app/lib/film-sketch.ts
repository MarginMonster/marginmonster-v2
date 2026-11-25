/* A PICTURE FOR EVERY PLACE — the storyboard artist's quick panel, for about a third of a cent.
 *
 * An acted film had NO pictures until it was paid for: its script editor was a column of text boxes (the
 * owner, 2026-11-25: "Scene design also comes across as fucking boring and a chore"), and the storyboard a
 * rival shows — a picture for every scene — out-looked it. The film's real pictures cost real money and are
 * drawn from the cast's faces, so they cannot be handed out while somebody is still changing the words.
 *
 * What a director is handed first is not a finished frame anyway: it is a SKETCH. So every place on the
 * board (components/film/SceneBoard.tsx) gets one — loose graphite on off-white paper, in the film's shape,
 * the place and how many people are in it. It promises nothing about faces or wardrobe (nobody reads a
 * pencil sketch as "this is what my film will look like"), and it is drawn on the cheapest, fastest picture
 * model there is (Replicate flux-schnell: four steps, about a second, $0.003 a picture — a twelve-place
 * film's board is under four cents), so it can be free and redrawn whenever a place changes.
 *
 * This file is the wording and the shapes (plain logic — tests/film-kit.test.ts); the drawing is
 * film-sketch.server.ts.
 *
 * WHAT THE PROMPT LEARNED (twelve sketches drawn and looked at, 2026-11-25 — see the notes at sketchPrompt). */

import { flowOf, parseBeat, type FlowScene } from "./film-flow.ts";
import { nameTok } from "./character-prompts.ts";

export type SketchAspect = "16:9" | "9:16" | "1:1";
/** One place, as the page sends it to be sketched. */
export type SketchPlace = { where: string; visual?: string; lines?: string[] };

/** The picture model, and why this one: the cheapest and fastest there is. A sketch is the one picture in
 *  the app where that is the right trade — everything a member keeps is drawn on the best model we have. */
export const SKETCH_MODEL = "black-forest-labs/flux-schnell";
/** No board is sketched past this many places (a five-minute film has about ten). */
export const SKETCH_MAX_PLACES = 16;
/** How many are drawn at once (the app draws its story pictures four at a time too). */
export const SKETCH_AT_ONCE = 4;

/** The film's shape, or wide when it is none we know. */
export const sketchAspect = (a: unknown): SketchAspect => (a === "9:16" || a === "1:1" ? a : "16:9");

const tidy = (s: unknown, max: number): string => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const SHOT: Record<SketchAspect, string> = {
  "16:9": "A wide shot",
  "9:16": "A tall vertical shot",
  "1:1": "A square shot",
};

/** Who is in a place: the different people its lines are spoken by (at most three are drawn). */
function peopleIn(lines: ReadonlyArray<string> | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines || []) {
    const sp = parseBeat(l).speaker;
    const k = nameTok(sp);
    if (sp && k && !seen.has(k)) { seen.add(k); out.push(sp); }
  }
  return out.slice(0, 3);
}

/** A name means nothing to a picture model — and a model that is handed a word it does not know WRITES it.
 *  Each speaker's name in what happens becomes "one person" / "the other person" / "a third person", in the
 *  order the sentence itself comes to them (so it never opens "the other person and one person climb…"). */
function withoutNames(visual: string, people: ReadonlyArray<string>): string {
  const called = ["one person", "the other person", "a third person"];
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const find = (w: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w)}(?![\\p{L}\\p{N}])`, "giu");
  const words = (p: string) => [...new Set([p.trim(), p.trim().split(/\s+/)[0]])].filter((w) => w.length >= 2);
  const at = (p: string) => Math.min(...words(p).map((w) => { const i = visual.search(find(w)); return i < 0 ? Infinity : i; }), Infinity);
  const named = people.filter((p) => at(p) < Infinity).sort((a, b) => at(a) - at(b));
  let out = visual;
  named.forEach((p, i) => { for (const w of words(p)) out = out.replace(find(w), `$1${called[i]}`); });
  return out;
}

/** WHAT THE SKETCH IS TOLD — each sentence earned by a sketch that was drawn and looked at (twelve of them,
 *  2026-11-25, the same four places three ways):
 *
 *  - It opens with the MEDIUM ("rough storyboard sketch … loose graphite pencil … off-white paper"), so it
 *    is a drawing before it is a place.
 *  - "the scene runs off all four edges": the first four, told only that it "fills the whole page", were
 *    small drawings floating in the middle of a white sheet — one of them a few lines on four fifths of
 *    blank paper. Told this, the room reaches the sides and the shading has somewhere to go.
 *  - The shape is said as a SHOT (wide / tall / square), and the picture is asked for in that shape.
 *  - The place and what happens are the scene's own words. The LINES are never sent (a picture model handed
 *    dialogue letters it onto the paper) — only how many people speak there, and their names become "one
 *    person", "the other person".
 *  - People are "simple figures, faces only suggested": the film's cast is not known to this picture, and a
 *    sketch with a finished face in it reads as a promise about who is in the film.
 *  - What must not be there is said ONCE, last, and only the four things that matter: colour, text, speech
 *    bubbles, panel borders. (The first wording also said "no arrows" — and got arrows; the second said "no
 *    margin and no border" — and three of four came back with a ruled border. A thing named is a thing
 *    drawn, so nothing is named that was not already turning up.)
 *
 *
 *  The last four were drawn with exactly these words: no ruled border on any, every one a pencil drawing of
 *  its place with its people in it, none a photograph or a finished illustration. They are lighter in line
 *  than the second round's (whose opening, "a film storyboard FRAME", is also what drew the borders).
 *
 *  WHAT THE PROMPT CANNOT STOP, the board hides (components/film/film-kit-style.ts): a storyboard artist's
 *  squiggle of a signature in the bottom right corner (four of the twelve, whatever was said) sits under
 *  the board's slate strip; a fleck of colour (one green lantern) is taken out by showing every sketch in
 *  grey; and the white of the page becomes the board's own paper (the picture is laid on it with multiply),
 *  so a drawing that leaves some of its sheet empty is a drawing on a sheet, not a white box. */
export function sketchPrompt({ where, visual, lines, look, aspect }: { where: string; visual?: string; lines?: ReadonlyArray<string>; look?: string; aspect?: SketchAspect }): string {
  const place = tidy(where, 160) || "a room";
  const people = peopleIn(lines);
  const seen = tidy(visual, 260);
  const happens = seen && seen.toLowerCase() !== place.toLowerCase() ? tidy(withoutNames(seen, people), 260) : "";
  const who = people.length >= 3 ? "Three people are in it" : people.length === 2 ? "Two people are in it" : people.length === 1 ? "One person is in it" : "";
  const mood = tidy(look, 120);
  return [
    `A rough storyboard sketch for a film, drawn fast in loose graphite pencil with soft grey shading on off-white paper: quick confident lines, rough hatching, nothing polished.`,
    `${SHOT[sketchAspect(aspect)]}; the scene runs off all four edges of the picture.`,
    `The place: ${place}.`,
    happens ? `What happens: ${happens.replace(/[.\s]+$/, "")}.` : "",
    who ? `${who}, drawn as simple figures with their faces only suggested.` : "",
    mood ? `The mood: ${mood.replace(/[.\s]+$/, "")}.` : "",
    `Black-and-white pencil only: no colour, no text or lettering, no speech bubbles, no panel borders. Unsigned.`,
  ].filter(Boolean).join(" ");
}

/** What the picture model is asked for: one picture, in the film's shape, the model's own four steps, at one
 *  megapixel (1344 x 768 wide; about 100 KB as a JPEG). The one sketch tried at a quarter of that came back
 *  just as good at 28 KB — one sample is not a reason to change, but it is the lever if a board of many
 *  places ever loads slowly on a phone. */
export function sketchInput(prompt: string, aspect: SketchAspect): Record<string, unknown> {
  return { prompt, aspect_ratio: sketchAspect(aspect), num_outputs: 1, num_inference_steps: 4, go_fast: true, megapixels: "1", output_format: "jpg", output_quality: 82 };
}

/** EVERY PLACE DRAWN, A FEW AT A TIME — one answer per place, in the places' own order: a picture's address,
 *  or null for the one that could not be drawn. It never throws: a board with three sketches and one blank
 *  sheet is a board; a board that failed because its fourth sketch did is nothing. `draw` is the making
 *  (film-sketch.server.ts hands in the real one; the tests a pretend one). */
export async function sketchAll(
  places: ReadonlyArray<SketchPlace>,
  aspect: SketchAspect,
  draw: (input: Record<string, unknown>, place: SketchPlace) => Promise<string | null | undefined>,
  look?: string,
): Promise<(string | null)[]> {
  const list = places.slice(0, SKETCH_MAX_PLACES);
  const out: (string | null)[] = list.map(() => null);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= list.length) return;
      try {
        const url = await draw(sketchInput(sketchPrompt({ ...list[i], look, aspect }), aspect), list[i]);
        out[i] = typeof url === "string" && url ? url : null;
      } catch { out[i] = null; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SKETCH_AT_ONCE, list.length) }, worker));
  return out;
}

/** The places of a script, as they are sent to be sketched: where, what is seen in its first shot, and its
 *  lines (read only for who speaks there). */
export function placesForSketch(scenes: ReadonlyArray<FlowScene> | null | undefined): SketchPlace[] {
  const list = scenes || [];
  return flowOf(list).slice(0, SKETCH_MAX_PLACES).map((loc) => ({
    where: loc.where,
    visual: tidy(list[loc.firstIdx]?.visual, 400),
    lines: list.slice(loc.firstIdx, loc.lastIdx + 1).map((s) => tidy(s.caption, 200)).filter(Boolean).slice(0, 12),
  }));
}

/** What a request to sketch says, read back on the server: a JSON list of places — anything else is no
 *  places at all. Every text is cut to size; a place with no `where` is not one. */
export function parseSketchPlaces(raw: unknown): SketchPlace[] {
  let v: unknown = raw;
  if (typeof raw === "string") { try { v = JSON.parse(raw); } catch { return []; } }
  if (!Array.isArray(v)) return [];
  const out: SketchPlace[] = [];
  for (const p of v.slice(0, SKETCH_MAX_PLACES)) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const where = tidy(o.where, 160);
    if (!where) continue;
    out.push({
      where,
      visual: tidy(o.visual, 400),
      lines: Array.isArray(o.lines) ? o.lines.filter((l): l is string => typeof l === "string").map((l) => tidy(l, 200)).filter(Boolean).slice(0, 12) : [],
    });
  }
  return out;
}

/* ---- keeping a sketch with its place ------------------------------------------------------------------
 * Places move, are removed, and two can become one (film-flow.ts → movePlace), so a list of sketches kept
 * BY POSITION goes wrong the first time a place is moved. A sketch belongs to what it is a picture OF: the
 * place's words. The page keeps a small map from sketchKey(where) to the picture, and hands the board
 * sketchesFor(flow, map) — whatever order the places are in now. */

/** What a place's sketch is kept under: its words, however they are spaced or cased. */
export const sketchKey = (where: string | null | undefined): string => String(where ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** The sketches that came back, added to the ones already kept. `urls[i]` is the picture of `places[i]`; a
 *  place whose sketch failed (null) keeps the picture it had, if it had one. */
export function keepSketches(kept: Readonly<Record<string, string>>, places: ReadonlyArray<{ where: string }>, urls: ReadonlyArray<string | null | undefined>): Record<string, string> {
  const out: Record<string, string> = { ...kept };
  places.forEach((p, i) => { const u = urls[i]; const k = sketchKey(p.where); if (k && typeof u === "string" && u) out[k] = u; });
  return out;
}

/** One sketch (or none yet) for every place on the board, in the board's order. */
export function sketchesFor(flow: ReadonlyArray<{ where: string }>, kept: Readonly<Record<string, string>>): (string | null)[] {
  return flow.map((loc) => kept[sketchKey(loc.where)] || null);
}

/** The places that have no sketch yet (after a place was renamed, or a scene was added) — and, when `tried`
 *  is given, that were not already sent. A sketch that failed comes back null and its place stays without
 *  one: a page that asked again for every place still without a sketch, each time a request came back, would
 *  ask for that place for ever (review of 2026-11-25). The page keeps the keys it sent (sketchKey) in `tried`. */
export function unsketched(places: ReadonlyArray<SketchPlace>, kept: Readonly<Record<string, string>>, tried?: ReadonlySet<string>): SketchPlace[] {
  return places.filter((p) => { const k = sketchKey(p.where); return !kept[k] && !(tried && tried.has(k)); });
}

/* ---- what one member can have drawn --------------------------------------------------------------------
 * A sketch is free to the member and costs us $0.003; the request that asks for them is an ordinary form
 * post. A board asks for each place once (unsketched + tried), so an honest member draws a few dozen in an
 * evening — but nothing in the request itself stops a page (or a script) asking for sixteen, over and over.
 * So the server keeps, per member, when their last sketches were drawn, and draws at most SKETCH_BUDGET in
 * any SKETCH_WINDOW_MS; past it, a place simply gets no sketch (null — the drawn blank sheet), never an error.
 * 240 an hour is fifteen full sixteen-place boards: far past anyone writing films, and $0.72 at most. */
export const SKETCH_BUDGET = 240;
export const SKETCH_WINDOW_MS = 60 * 60 * 1000;

/** How many of `want` sketches may be drawn now, given when this member's earlier ones were (`stamps`, in
 *  ms). Hands back the stamps still inside the window, with the allowed ones added — the caller stores them. */
export function sketchAllowance(stamps: ReadonlyArray<number>, now: number, want: number, budget = SKETCH_BUDGET, windowMs = SKETCH_WINDOW_MS): { allowed: number; stamps: number[] } {
  const live = stamps.filter((s) => now - s < windowMs);
  const allowed = Math.max(0, Math.min(Math.max(0, Math.floor(want)), budget - live.length));
  return { allowed, stamps: [...live, ...Array.from({ length: allowed }, () => now)] };
}
