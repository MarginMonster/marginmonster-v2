// In-process job worker. Imported by shopify.server.ts so it starts once when
// the web server boots — avoids needing a separate Render worker service for
// a low-volume app. Guarded by a global so hot-reload doesn't spawn duplicates.

import { processNextJob, reclaimOrphanJobs, stopTakingJobs } from "./lib/job-queue.server";
import { stopSwitch } from "./lib/job-beat";
import { LANES } from "./lib/job-lanes";
import { startMemoryWatch } from "./lib/memwatch.server";
import { postDueSlots } from "./lib/social-post.server";
import { tickDueSeries } from "./lib/creator-series.server";
import { tickPostQueue } from "./lib/post-queue.server";
import { refreshSocialStats } from "./lib/social-insights.server";
import { backfillDeadImages } from "./lib/image-generation.server";
import { purgeStaleUnkept } from "./lib/storage-cleanup.server";
import { sendMonthlyDigests } from "./lib/digest.server";
import { settlePendingReferrals } from "./lib/referral.server";

declare global {
  var __mm_worker_started__: boolean | undefined;
}

const POLL_MS = 8000;
// A row IN_PROGRESS that nobody has written for this long is a job nobody is running: a corpse.
//
// FIVE MINUTES, NOT TWENTY-FIVE (2026-11-25). Twenty-five was there because a live job could go that long without
// writing its row — a ten-minute provider poll, a long encode: only its checkpoints and the encode turn's beat wrote
// it — and any shorter ceiling took live renders for dead and rendered them twice. It cost every member whose render
// was under a crash or a deploy twenty-five minutes of "in progress" with nothing running (live: last touched ≈19:04
// UTC, the server back at 19:06:25, the job left until ≈19:30 — after the tester had already waited an hour).
// It is safe now because:
//  - EVERY RUNNING JOB BEATS: the worker writes its row once a minute, whatever the job is doing, and a beat that
//    fails is tried again every ten seconds (lib/job-beat.ts) — five minutes is five beats and some twenty-five
//    retries missed, which a live process does not do;
//  - A PROCESS NEVER REAPS ITS OWN LIVE JOB: should its beats be held up anyway (a struggling database), this
//    process's reaper still leaves the jobs it is running alone — only another process could take one, and Render
//    never runs two of ours side by side for long (below);
//  - a job is still only taken if its row has not moved since the scan (reclaimOrphanJobs: the conditional write).
// A job that never settles is still bounded: its beat ends when its lane gives its slot back (RENDER_SLOT_MS, or a long
// film's own hold), and then this ceiling takes it, as before.
const STUCK_MS = 5 * 60_000;
// Boot reclaim grace. Renders overlap deploys: the new instance boots while the
// OLD process is still paying for a live render, so reclaiming with 0 flipped a
// genuinely-running job back to PENDING and rendered it a second time. Anything
// still IN_PROGRESS this long after its last touch is from the dead process.
// (2026-11-25: Render's docs say a service with a disk — ours has one — is stopped BEFORE its new instance starts, so
//  that overlap should no longer happen; the grace stays, as cheap insurance against the day it does. With every
//  running job beating once a minute, two minutes untouched means its process is gone.)
const BOOT_GRACE_MS = 2 * 60_000;

let lastTileKick = 0;

// A tick that has been running this long is not slow, it is wedged. A single
// avatar-dialogue render legitimately runs long — up to 8 sequential clips,
// each up to an 18-min provider poll, plus TTS/masks/assembly (~65 min worst
// case) — so the old 20-min ceiling flagged a perfectly healthy render as
// wedged and let a fresh tick overlap it, which is exactly how two renders
// ended up running at once. Matches RENDER_SLOT_MS, the process-wide
// one-render-at-a-time lock in the queue, so the tick never deems a live render
// wedged before that lock would have freed its slot anyway.
const TICK_DEADLINE_MS = 70 * 60_000;

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
//
// ONE GUARD PER LOOP (2026-11-23). There was one tick, and it did everything in a row: the chores, then
// every waiting job, each awaited to its end. So while a film rendered — 25 minutes, up to 65 — nothing
// else on the site moved: no picture, no catalogue import for a member who had just signed up, and no
// scheduled post either, because the chores only ran when a tick began. Each lane of jobs
// (lib/job-lanes.ts) now drains in its own loop, and the chores have theirs; every loop keeps the same
// guard and the same way out as the single tick had.
function guarded(name: string, body: () => Promise<void>): () => Promise<void> {
  let running = false;
  let startedAt = 0;
  let gen = 0;
  return async () => {
    if (running && Date.now() - startedAt < TICK_DEADLINE_MS) return;
    if (running) {
      console.error(
        `[worker] ${name}: the previous pass has been running for ${Math.round((Date.now() - startedAt) / 60_000)} min — ` +
          `treating it as wedged and starting a fresh one. Something in it is awaiting a promise that will not settle.`
      );
    }
    const mine = ++gen;
    running = true;
    startedAt = Date.now();
    try {
      await body();
    } catch (e) {
      console.error(`[worker] ${name} error:`, e);
    } finally {
      // Only the newest pass may release the flag. A wedged predecessor that
      // finally settles must not clear it out from under its replacement.
      if (mine === gen) running = false;
    }
  };
}

// THE CHORES — everything that is not a job. None of it renders anything here (posts go out through the
// posting service, channels QUEUE their next drop), so none of it has a reason to wait for a render.
const chores = guarded("chores", async () => {
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
  // Advance Creator "Channels" — render + post the next drop for any channel
  // whose cadence is due (self-throttled to ~2 min; caps drops per scan).
  await tickDueSeries().catch((e) => console.error("[worker] series tick (non-fatal):", e));
  // Send queued pieces ("Coming up" on Auto-post) whose time has come — claimed one by one, never twice.
  await tickPostQueue().catch((e) => console.error("[worker] post queue (non-fatal):", e));
  // Pull organic follower/engagement analytics into the cache (self-throttled to ~1h).
  await refreshSocialStats().catch((e) => console.error("[worker] social insights (non-fatal):", e));
  // Clear un-kept videos/photos older than 30 days (self-throttled to ~6h).
  await purgeStaleUnkept().catch((e) => console.error("[worker] storage cleanup (non-fatal):", e));
  // Monthly "here's what we made you" digest (self-throttled; per-shop 30-day gate).
  await sendMonthlyDigests().catch((e) => console.error("[worker] digest (non-fatal):", e));
  // Pay referrals whose free trial has now elapsed (self-throttled to ~6h).
  await settlePendingReferrals().catch((e) => console.error("[worker] referral settle (non-fatal):", e));
});

// THE LANES — each drains its own waiting jobs, one at a time, beside the others.
const drains = LANES.map((lane) =>
  guarded(`${lane} lane`, async () => {
    let processed = true;
    let guard = 0;
    while (processed && guard < 20) {
      processed = await processNextJob(lane);
      guard++;
    }
    // (a process told to stop draws nothing more: see SIGTERM, below)
    if (stopSwitch.stopped()) return;
    // Re-making pictures whose files went missing draws pictures HERE, so it takes its turn with the
    // picture jobs — as it always did, when everything took turns. AFTER the members' own pictures:
    // it can take a few minutes, and nobody is waiting for it.
    if (lane === "picture") await backfillDeadImages().catch((e) => console.error("[worker] image backfill (non-fatal):", e));
  })
);

function tick() {
  // A PROCESS TOLD TO STOP STARTS NOTHING NEW — no job, no chore (the chores draw the app's own art and send posts;
  // one started in a process's last seconds is cut off half-done): see SIGTERM, below.
  if (stopSwitch.stopped()) return;
  void chores();
  for (const drain of drains) void drain();
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
  // Sample what the server is really using, so "is it safe to run jobs side by side" is a number on
  // /art-status and not a guess (lib/memwatch.server.ts).
  startMemoryWatch();
  // Boot reclaim: anything left IN_PROGRESS was orphaned by the previous
  // process (this is exactly the "stuck rendering forever" bug) — but a deploy
  // OVERLAPS, so a job the outgoing process is still rendering (and paying for)
  // must not be grabbed. The grace window only frees rows nobody has touched.
  reclaimOrphanJobs(BOOT_GRACE_MS).catch((e) => console.error("[worker] boot reclaim:", e));
  setInterval(tick, POLL_MS);
  // Independent of the drain: a wedged tick must not switch off refunds.
  setInterval(reap, 60_000);
  // The posting queue, ALSO on its own timer. The tick above awaits whole renders (up to an hour), and
  // the page promises "Post now" goes out within a minute. tickPostQueue has its own in-process guard
  // and claims every row before sending, so the two callers can never send the same row twice.
  setInterval(() => { if (!stopSwitch.stopped()) tickPostQueue().catch((e) => console.error("[worker] post queue timer (non-fatal):", e)); }, 30_000);
  // A DEPLOY IS NOT A STALL, AND THE OLD PROCESS STARTS NOTHING NEW (2026-11-25).
  // How Render ends a process (its docs, read that day): SIGTERM to the app's process, then SIGKILL if it has not
  // exited after the shutdown delay — 30 seconds, which a service with a disk (ours) cannot change — and such a
  // service is stopped BEFORE its new instance starts. An out-of-memory kill runs no handler at all. What this relies
  // on: the SIGTERM reaching this node process — the Dockerfile ends in `npx remix-serve`, the last command of `sh -c`
  // (exec'd by dash), and npx passes SIGTERM on to the server it started (npm's signal-manager). The line below is
  // logged when it does; a deploy whose log lacks it ran no handler, and its jobs are handed back as any restart's are.
  // On SIGTERM: no job is claimed and no chore started from here on (tick, processNextJob); each job this process is
  // running gets the stop mark (lib/job-stall.ts → A DEPLOY IS NOT A STALL), conditionally, status untouched, within
  // five seconds at most; and the running jobs are let be — one may finish in the time left. Nothing here exits the
  // process or makes it wait: remix-serve closes its server on the same signal, and Render ends the rest.
  // (A listener here takes away Node's own "exit on SIGTERM" — remix-serve's own listener already had.)
  process.once("SIGTERM", () => {
    console.log("[worker] SIGTERM — this process takes no new job and starts no chore from now on; marking the jobs it is running as stopped by a deploy");
    stopTakingJobs("deploy")
      .then(({ running, marked }) =>
        console.log(
          `[worker] stop marks: ${running.length} job(s) running here` +
            (running.length ? `, ${marked === null ? "marks not all written in time" : `${marked.length} marked (${marked.join(", ") || "none"})`}` : ""),
        ),
      )
      .catch((e) => console.error("[worker] stop marks (non-fatal):", e));
  });
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
  // Config health: alert the operator on money/security misconfig at boot
  // (e.g. an unset SESSION_SECRET) instead of letting it sit silently in a
  // diagnostics page nobody opens. Silent when the config is healthy.
  import("./lib/ops-alert.server")
    .then((m) => m.checkConfigHealth())
    .catch((e) => console.error("[worker] config health check:", e));
  // Proactive billing reconciliation: catch a customer billed for 2+ plans at
  // once — a past double-charge a missed webhook or an old bug left behind,
  // which the at-the-moment alerts can't see retroactively. First run shortly
  // after boot (so it doesn't fight the other boot kicks), then daily.
  // Read-only against Stripe; it only alerts, never cancels.
  setTimeout(() => {
    const run = () => import("./lib/stripe.server").then((m) => m.reconcileBilling()).catch((e) => console.error("[worker] billing reconcile:", e));
    run();
    setInterval(run, 24 * 3600_000);
  }, 60_000);
}

export {};
