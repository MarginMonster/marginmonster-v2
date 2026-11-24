/* THE FRAME OF A PICTURE EDIT, ASKED IN THE FIELD THE ENGINE HAS.
 *
 * The compose engine (fal-image.server.ts, submitCompose) and the Commercial's keyframes and brand stills
 * (commercial-ad-pipeline.server.ts) were written for Seedream v4 edit, whose frame is `image_size`
 * ("portrait_4_3" = 3:4, "portrait_16_9" = 9:16, "square_hd" = 1:1) and which takes `max_images`. The engine
 * they call became fal-ai/nano-banana-pro/edit, whose schema (fal, read 2026-11-24) has `aspect_ratio` —
 * default "auto" — `num_images` and `resolution`, and NEITHER Seedream field. fal ignored them: every
 * compose and every Commercial keyframe since has come back at the edit engine's DEFAULT frame, "auto",
 * which the model picks from the pictures it is given.
 *
 * Finished work is made at that default and may rely on it — the presenter image ad, the Combine frame a
 * video starts from, a Commercial's five keyframes, a forged presenter's portrait. So the default is KEPT,
 * and now said out loud: asking for the frame each caller MEANT (MEANT_FRAME) would change what finished
 * ads look like, and that is the owner's call. Seedream itself, still reachable through COMPOSE_MODEL for
 * the harness's engine A/B (scripts/video-qa.ts), keeps exactly the fields it was sent before.
 *
 * Pure (tests/edit-frame.test.ts). */

/** The Seedream sizes the callers name — what each one meant. */
export type SeedreamSize = "portrait_4_3" | "portrait_16_9" | "square_hd";

/** What each Seedream size means as an aspect ratio — the frame a caller asked for, and has not been
 *  getting from nano-banana-pro/edit. */
export const MEANT_FRAME: Record<SeedreamSize, string> = { portrait_4_3: "3:4", portrait_16_9: "9:16", square_hd: "1:1" };

/** The nano-banana family (fal-ai/nano-banana, nano-banana-pro, and their /edit endpoints): framed by
 *  `aspect_ratio`, with no `image_size` and no `max_images`. */
export function isNanoBanana(model: string): boolean {
  return /(^|\/)nano-banana/.test(model);
}

/** The frame field for an EDIT on `model`. nano-banana: its own default, "auto", by name — what fal has
 *  been giving every one of these edits. Anything else: the Seedream size the caller names, as before. */
export function editFrameFields(model: string, meant: SeedreamSize): Record<string, string> {
  return isNanoBanana(model) ? { aspect_ratio: "auto" } : { image_size: meant };
}

/** How many pictures, in the fields `model` has: `num_images` on nano-banana (1–4), plus Seedream's
 *  `max_images` everywhere else, as before. */
export function editCountFields(model: string, n: number): Record<string, number> {
  return isNanoBanana(model) ? { num_images: n } : { num_images: n, max_images: n };
}
