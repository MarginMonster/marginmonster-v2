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
 * until Generate, and a board that showed no pictures until it was paid for is what this replaces.
 *
 * Not run from here in a test (it needs the network and the render disk): the wording, the request and the
 * four-at-a-time, never-throwing loop are film-sketch.ts and are run in tests/film-kit.test.ts; twelve real
 * sketches were drawn through the same wording and looked at on 2026-11-25. */

import { persistRemote, repRun } from "./image-generation.server";
import { SKETCH_MODEL, sketchAll, type SketchAspect, type SketchPlace } from "./film-sketch";

/** A sketch takes a second or two; one that has not come back in this long is not coming (repRun's own
 *  default is two minutes — far longer than anybody watches a blank sheet). */
const SKETCH_WAIT_MS = 45_000;

/** One sketch (its /renders address) or null per place, in the places' order. `look` is a few words of mood
 *  for every sketch of this film ("a tense night, deep shadows") — the genre's, when the page has one. */
export async function sketchPlaces(places: ReadonlyArray<SketchPlace>, aspect: SketchAspect, look?: string): Promise<(string | null)[]> {
  if (!process.env.REPLICATE_API_TOKEN) return places.map(() => null);
  return sketchAll(places, aspect, async (input, place) => {
    try {
      return await persistRemote(await repRun(SKETCH_MODEL, input, SKETCH_WAIT_MS), "jpg");
    } catch (e) {
      console.error(`[film-sketch] no sketch for "${place.where.slice(0, 60)}": ${e instanceof Error ? e.message.slice(0, 160) : e}`);
      return null;
    }
  }, look);
}
