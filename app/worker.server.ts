// In-process job worker. Imported by shopify.server.ts so it starts once when
// the web server boots — avoids needing a separate Render worker service for
// a low-volume app. Guarded by a global so hot-reload doesn't spawn duplicates.

import { processNextJob, reclaimOrphanJobs } from "./lib/job-queue.server";
import { postDueSlots } from "./lib/social-post.server";
import { refreshSocialStats } from "./lib/social-insights.server";
import { backfillDeadImages } from "./lib/image-generation.server";
import { purgeStaleUnkept } from "./lib/storage-cleanup.server";

declare global {
  var __mm_worker_started__: boolean | undefined;
}

const POLL_MS = 8000;
// video pipelines legitimately run 10-15 min; anything past this is a corpse
const STUCK_MS = 25 * 60_000;

async function tick() {
  try {
    // Free any jobs whose process died mid-run (deploys, restarts).
    await reclaimOrphanJobs(STUCK_MS);
    // Publish READY slots whose post time arrived (self-throttled to ~5 min).
    await postDueSlots();
    // Pull organic follower/engagement analytics into the cache (self-throttled to ~1h).
    await refreshSocialStats().catch((e) => console.error("[worker] social insights (non-fatal):", e));
    await backfillDeadImages().catch((e) => console.error("[worker] image backfill (non-fatal):", e));
    // Clear un-kept videos/photos older than 30 days (self-throttled to ~6h).
    await purgeStaleUnkept().catch((e) => console.error("[worker] storage cleanup (non-fatal):", e));
    // Drain any pending jobs each tick.
    let processed = true;
    let guard = 0;
    while (processed && guard < 20) {
      processed = await processNextJob();
      guard++;
    }
  } catch (e) {
    console.error("[worker] tick error:", e);
  }
}

if (!global.__mm_worker_started__ && process.env.NODE_ENV === "production") {
  global.__mm_worker_started__ = true;
  console.log("[worker] in-process job worker started");
  // Boot reclaim: this is a single-instance app, so nothing can genuinely be
  // IN_PROGRESS when we start — anything marked that way was orphaned by the
  // previous process (this is exactly the "stuck rendering forever" bug).
  reclaimOrphanJobs(0).catch((e) => console.error("[worker] boot reclaim:", e));
  setInterval(tick, POLL_MS);
  // Kick one immediately so freshly-installed shops don't wait.
  tick();
}

export {};
