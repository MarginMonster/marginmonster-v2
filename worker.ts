// Standalone job worker. Run with: node --loader ts-node/esm worker.ts
// In production (Render), add a second service pointing to this file
// or use a cron job to call /api/worker/tick.

import { processNextJob } from "./app/lib/job-queue.server";
import { LANES } from "./app/lib/job-lanes";

const POLL_MS = 5000;
const DECISIONING_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

async function runWorker() {
  console.log("EasyMode worker started");

  let lastDecisioningRun = 0;

  while (true) {
    try {
      // Drain pending content generation jobs
      // one lane after another: this process is its own worker and does one thing at a time
      let processed = true;
      while (processed) {
        processed = false;
        for (const lane of LANES) processed = (await processNextJob(lane)) || processed;
      }

      // Hourly decisioning pass
      const now = Date.now();
      if (now - lastDecisioningRun >= DECISIONING_INTERVAL_MS) {
        lastDecisioningRun = now;
        const { db } = await import("./app/db.server");
        await db.job.create({
          data: {
            shopId: "system",
            type: "DECISIONING_PASS" as any,
            payload: "{}",
          },
        });
        await processNextJob("desk");
      }
    } catch (e) {
      console.error("Worker error:", e);
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

runWorker().catch(console.error);
