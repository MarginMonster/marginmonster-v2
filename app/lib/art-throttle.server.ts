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
    // EVERY kind of piece a member can be waiting on. The list was three kinds long, so the app's own
    // art was drawn beside a member's song, a presenter being forged, a video edit and a re-rolled
    // shot — the same competition for the same provider this exists to prevent. A job scheduled for
    // later (a campaign's drop next week, a win-back email in 45 days) is not somebody waiting.
    const n = await db.job.count({
      where: {
        type: { in: ["GENERATE_VIDEO_AD", "GENERATE_IMAGE_AD", "GENERATE_BLOG_POST", "GENERATE_SONG", "EDIT_VIDEO", "REGEN_SHOT", "FORGE_CUSTOM_AVATAR", "FORGE_COMPANION"] },
        OR: [{ status: "IN_PROGRESS" }, { status: "PENDING", OR: [{ runAt: null }, { runAt: { lte: new Date() } }] }],
      },
    });
    return n > 0;
  } catch (e) {
    // FAIL CLOSED. This used to return false — "never block art forging on a
    // DB hiccup" — which has it backwards: the only thing this gates is
    // cosmetic background art (style tiles, ad-template plates), every caller
    // is a self-heal walker that retries on the next tick, and the cost of
    // guessing wrong is competing with a merchant's PAID render for the same
    // provider rate limit. Not knowing whether the queue is busy is a reason
    // to wait, not a reason to spend.
    console.error("[art-throttle] could not read the job queue — standing down this round:", e);
    return true;
  }
}

/* Guard 3: a hard ceiling on how many cosmetic renders run at once.
 *
 * Guards 1 and 2 live in the ensureAll* walkers, but /ad-templates/:file is a
 * PUBLIC, unauthenticated route that calls the per-key ensure* functions
 * directly — and those had neither guard. Each key dedupes itself, so 48
 * parallel requests for 48 distinct format keys meant 48 simultaneous
 * Replicate renders: exactly the rate-limit saturation this module exists to
 * prevent, triggerable by anyone with a URL and no session.
 *
 * The cap is shared across every cosmetic renderer (formats, templates,
 * bottles, covers) because they all draw on the same per-model rate limit. */
const ART_LIMIT = 2;
let artActive = 0;

/** Claim a render slot. False means "not now" — the caller must not start,
 *  and must not mark itself in-flight; the self-heal tick retries later. */
export function takeArtSlot(): boolean {
  if (artActive >= ART_LIMIT) return false;
  artActive++;
  return true;
}

/** Release a slot claimed by takeArtSlot. Always call this from a finally. */
export function releaseArtSlot(): void {
  if (artActive > 0) artActive--;
}
