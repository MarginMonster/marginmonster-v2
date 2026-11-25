/* THE BOARD'S SKETCHES, DRAWN — the making half of film-sketch.ts (read that first: what a sketch is, why it
 * is drawn on the cheapest model, and what its prompt learned).
 *
 * One call draws every place of a script: Replicate flux-schnell through the project's own helpers (repRun
 * creates the prediction and waits for it, with its own patience for a rate limit; persistRemote keeps the
 * picture on the render disk and hands back its /renders address). Four at a time; a place whose sketch
 * fails is null and the rest still come back — nothing here throws, because a sketch is a nicety and the
 * script it illustrates is already on the page.
 *
 * COST: $0.003 a sketch (flux-schnell's price for one picture) — a four-place film's board is about a cent,
 * the longest board we draw (sixteen places) under five. It is not charged for: nothing is spent in tokens
 * until Generate, and a board that showed no pictures until it was paid for is what this replaces. Because
 * it is free to ask for, each member (`by`: the shop) is held to SKETCH_BUDGET an hour (film-sketch.ts →
 * sketchAllowance); past that a place gets no sketch, never an error. The count is kept in this process's
 * memory — a few numbers per member, forgotten after an hour, and gone at a restart (which only forgives).
 *
 * Not run from here in a test (it needs the network and the render disk): the wording, the request and the
 * four-at-a-time, never-throwing loop are film-sketch.ts and are run in tests/film-kit.test.ts; twelve real
 * sketches were drawn through the same wording and looked at on 2026-11-25. */

import { persistRemote, repRun } from "./image-generation.server";
import { SKETCH_MODEL, sketchAll, sketchAllowance, SKETCH_WINDOW_MS, type SketchAspect, type SketchPlace } from "./film-sketch";

/** A sketch takes a second or two; one that has not come back in this long is not coming (repRun's own
 *  default is two minutes — far longer than anybody watches a blank sheet). */
const SKETCH_WAIT_MS = 45_000;

/** When each member's sketches were drawn, for the hourly budget. */
const drawnAt = new Map<string, number[]>();

/** One sketch (its /renders address) or null per place, in the places' order. `look` is a few words of mood
 *  for every sketch of this film ("a tense night, deep shadows") — the genre's, when the page has one. `by`
 *  is who is asking (the shop): their hourly budget is checked first, and the places past it get null. */
export async function sketchPlaces(places: ReadonlyArray<SketchPlace>, aspect: SketchAspect, look?: string, by?: string): Promise<(string | null)[]> {
  if (!process.env.REPLICATE_API_TOKEN) return places.map(() => null);
  let list = places;
  if (by) {
    const now = Date.now();
    // (forget members whose last sketch is older than the window, so the map never grows past the active ones)
    for (const [k, v] of drawnAt) if (!v.length || now - v[v.length - 1] >= SKETCH_WINDOW_MS) drawnAt.delete(k);
    const { allowed, stamps } = sketchAllowance(drawnAt.get(by) || [], now, places.length);
    drawnAt.set(by, stamps);
    if (allowed < places.length) console.log(`[film-sketch] ${by.slice(0, 60)} is past the hourly sketch budget: ${allowed} of ${places.length} drawn`);
    list = places.slice(0, allowed);
  }
  const drawn = list.length ? await sketchAll(list, aspect, async (input, place) => {
    try {
      return await persistRemote(await repRun(SKETCH_MODEL, input, SKETCH_WAIT_MS), "jpg");
    } catch (e) {
      console.error(`[film-sketch] no sketch for "${place.where.slice(0, 60)}": ${e instanceof Error ? e.message.slice(0, 160) : e}`);
      return null;
    }
  }, look) : [];
  return places.map((_, i) => drawn[i] ?? null);
}
