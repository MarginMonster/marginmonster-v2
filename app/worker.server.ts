// In-process job worker. Imported by shopify.server.ts so it starts once when
// the web server boots — avoids needing a separate Render worker service for
// a low-volume app. Guarded by a global so hot-reload doesn't spawn duplicates.

import { processNextJob, reclaimOrphanJobs } from "./lib/job-queue.server";
import { postDueSlots } from "./lib/social-post.server";
import { refreshSocialStats } from "./lib/social-insights.server";
import { backfillDeadImages } from "./lib/image-generation.server";
import { purgeStaleUnkept } from "./lib/storage-cleanup.server";
import { sendMonthlyDigests } from "./lib/digest.server";
import { settlePendingReferrals } from "./lib/referral.server";

declare global {
  var __mm_worker_started__: boolean | undefined;
}

const POLL_MS = 8000;
// video pipelines legitimately run 10-15 min; anything past this is a corpse
const STUCK_MS = 25 * 60_000;
// Boot reclaim grace. Renders overlap deploys: the new instance boots while the
// OLD process is still paying for a live render, so reclaiming with 0 flipped a
// genuinely-running job back to PENDING and rendered it a second time. Anything
// still IN_PROGRESS this long after its last touch is from the dead process.
const BOOT_GRACE_MS = 2 * 60_000;

let lastTileKick = 0;

// A tick that has been running this long is not slow, it is wedged. The
// legitimate worst case is a full drain of 20 jobs, and each job carries its
// own failure paths; nothing here should legitimately take a third of an hour.
const TICK_DEADLINE_MS = 20 * 60_000;

// setInterval fires every 8s but a tick awaits FULL renders, so ticks used to
// stack: several overlapping drains all racing for the same PENDING rows. The
// conditional claim in processNextJob stops the double-render; this stops the
// pile-up that caused it.
//
// A PERMANENT "return" IS WORSE THAN AN OVERLAP.
//
// The guard had no escape. If any await in the tick never settled — an
// unsignalled fetch to a provider that accepted the connection and went quiet,
// a blocking probe on a wedged file — then `ticking` stayed true forever and
// every subsequent tick returned immediately. No job drained again, for any
// merchant, until somebody redeployed. And because reclaimOrphanJobs sat
// inside the same guard, the one mechanism that would have marked those jobs
// failed and refunded them was switched off by the same fault.
//
// Two changes. The reaper now runs on its own timer, outside this guard, so a
// wedged tick can no longer suppress refunds. And the guard expires: past the
// deadline a fresh tick takes over. That does not cancel the stuck promise —
// nothing in JavaScript can — but an overlapping drain is a bounded cost the
// conditional claim already handles, and a dead worker is not.
let ticking = false;
let tickStartedAt = 0;
let tickGen = 0;
async function tick() {
  if (ticking && Date.now() - tickStartedAt < TICK_DEADLINE_MS) return;
  if (ticking) {
    console.error(
      `[worker] the previous tick has been running for ${Math.round((Date.now() - tickStartedAt) / 60_000)} min — ` +
        `treating it as wedged and starting a fresh one. Something in it is awaiting a promise that will not settle.`
    );
  }
  const gen = ++tickGen;
  ticking = true;
  tickStartedAt = Date.now();
  try {
    // Self-heal the style tiles + ad templates: cheap no-op when everything
    // exists; re-kicks anything a deploy restart interrupted mid-render.
    if (Date.now() - lastTileKick > 10 * 60_000) {
      lastTileKick = Date.now();
      import("./lib/style-tiles.server").then((m) => m.ensureAllStyleTiles()).catch(() => { /* non-fatal */ });
      // Whole-cast tile pre-forge: one presenter per cycle until every
      // presenter's style set exists (no more portrait stand-ins in pickers).
      Promise.all([import("./lib/style-tiles.server"), import("./lib/avatars")])
        .then(([m, a]) => m.ensureNextCharacterTiles(a.AVATARS.map((av) => av.id)))
        .catch(() => { /* non-fatal */ });
      import("./lib/image-generation.server").then((m) => { m.ensureAllAdTemplates(); m.ensureAllFormatPreviews(); }).catch(() => { /* non-fatal */ });
      // Self-heal Stripe webhook provisioning (no-op once the secret exists).
      import("./lib/stripe.server").then((m) => m.ensureStripeWebhook()).catch(() => { /* non-fatal */ });
    }
    // Publish READY slots whose post time arrived (self-throttled to ~5 min).
    await postDueSlots();
    // Pull organic follower/engagement analytics into the cache (self-throttled to ~1h).
    await refreshSocialStats().catch((e) => console.error("[worker] social insights (non-fatal):", e));
    await backfillDeadImages().catch((e) => console.error("[worker] image backfill (non-fatal):", e));
    // Clear un-kept videos/photos older than 30 days (self-throttled to ~6h).
    await purgeStaleUnkept().catch((e) => console.error("[worker] storage cleanup (non-fatal):", e));
    // Monthly "here's what we made you" digest (self-throttled; per-shop 30-day gate).
    await sendMonthlyDigests().catch((e) => console.error("[worker] digest (non-fatal):", e));
    // Pay referrals whose free trial has now elapsed (self-throttled to ~6h).
    await settlePendingReferrals().catch((e) => console.error("[worker] referral settle (non-fatal):", e));
    // Drain any pending jobs each tick.
    let processed = true;
    let guard = 0;
    while (processed && guard < 20) {
      processed = await processNextJob();
      guard++;
    }
  } catch (e) {
    console.error("[worker] tick error:", e);
  } finally {
    // Only the newest tick may release the flag. A wedged predecessor that
    // finally settles must not clear it out from under its replacement.
    if (gen === tickGen) ticking = false;
  }
}

// The reaper, deliberately on its own timer and its own guard. This is the
// only thing that turns a job killed by a restart — or by a wedge — into a
// FAILED row with the merchant's tokens returned, so it must not be reachable
// from anything that can stall.
let reaping = false;
async function reap() {
  if (reaping) return;
  reaping = true;
  try {
    await reclaimOrphanJobs(STUCK_MS);
  } catch (e) {
    console.error("[worker] orphan reclaim:", e);
  } finally {
    reaping = false;
  }
}

if (!global.__mm_worker_started__ && process.env.NODE_ENV === "production") {
  global.__mm_worker_started__ = true;
  console.log("[worker] in-process job worker started");
  // Boot reclaim: anything left IN_PROGRESS was orphaned by the previous
  // process (this is exactly the "stuck rendering forever" bug) — but a deploy
  // OVERLAPS, so a job the outgoing process is still rendering (and paying for)
  // must not be grabbed. The grace window only frees rows nobody has touched.
  reclaimOrphanJobs(BOOT_GRACE_MS).catch((e) => console.error("[worker] boot reclaim:", e));
  setInterval(tick, POLL_MS);
  // Independent of the drain: a wedged tick must not switch off refunds.
  setInterval(reap, 60_000);
  // Kick one immediately so freshly-installed shops don't wait.
  tick();
  // Self-build the cartoon style-picker tiles (real flux renders of the first
  // character) and the Ad Template plates + statue previews at boot — nobody
  // has to visit anything to trigger them.
  import("./lib/style-tiles.server")
    .then((m) => m.ensureAllStyleTiles())
    .catch((e) => console.error("[worker] style tiles boot kick:", e));
  import("./lib/image-generation.server")
    .then((m) => { m.ensureAllAdTemplates(); m.ensureAllFormatPreviews(); })
    .catch((e) => console.error("[worker] ad templates boot kick:", e));
  // Self-provision the Stripe webhook endpoint the moment STRIPE_SECRET_KEY
  // lands in the environment — no dashboard clicks required.
  import("./lib/stripe.server")
    .then((m) => m.ensureStripeWebhook())
    .catch((e) => console.error("[worker] stripe webhook boot kick:", e));
}

export {};
