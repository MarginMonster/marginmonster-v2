// In-process job worker. Imported by shopify.server.ts so it starts once when
// the web server boots — avoids needing a separate Render worker service for
// a low-volume app. Guarded by a global so hot-reload doesn't spawn duplicates.

import { processNextJob } from "./lib/job-queue.server";

declare global {
  var __mm_worker_started__: boolean | undefined;
}

const POLL_MS = 8000;

async function tick() {
  try {
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
  setInterval(tick, POLL_MS);
  // Kick one immediately so freshly-installed shops don't wait.
  tick();
}

export {};
