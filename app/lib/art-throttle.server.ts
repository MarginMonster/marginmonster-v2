/* Background art forging must NEVER compete with paying merchants.
 *
 * The self-forging systems (ad-format previews, style tiles, ad templates,
 * bottle/cover art) fire fire-and-forget renders — ensureAllFormatPreviews
 * alone kicked 48 at once. That saturated the per-model rate limit on
 * Replicate, and merchant image ads (which hit the same models) came back 429
 * and terminal-failed. Cosmetic art starving revenue work is backwards.
 *
 * Two guards:
 *   1. serial walkers — the ensureAll* loops kick ONE render per self-heal
 *                   tick instead of fanning out, so bursts become a queue.
 *   2. merchantBusy() — background forging stands down entirely while any
 *                   merchant generation job is pending or running.
 */

import { db } from "../db.server";

/** True when a merchant generation is queued or running — background art
 *  forging should skip this round and retry on the next self-heal tick. */
export async function merchantBusy(): Promise<boolean> {
  try {
    const n = await db.job.count({
      where: {
        type: { in: ["GENERATE_VIDEO_AD", "GENERATE_IMAGE_AD", "GENERATE_BLOG_POST"] },
        status: { in: ["PENDING", "IN_PROGRESS"] },
      },
    });
    return n > 0;
  } catch {
    return false; // never block art forging on a DB hiccup
  }
}
