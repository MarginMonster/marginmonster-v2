// Standalone job worker. Run with: node --loader ts-node/esm worker.ts
// In production (Render), add a second service pointing to this file
// or use a cron job to call /api/worker/tick.

import { processNextJob } from "./app/lib/job-queue.server";

const POLL_MS = 5000;
const DECISIONING_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

async function runWorker() {
  console.log("EasyMode worker started");

  let lastDecisioningRun = 0;

  while (true) {
    try {
      // Drain pending content generation jobs
      let processed = true;
      while (processed) {
        processed = await processNextJob();
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
        await processNextJob();
      }
    } catch (e) {
      console.error("Worker error:", e);
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

runWorker().catch(console.error);
