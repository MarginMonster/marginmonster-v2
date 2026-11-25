/* EVERY RUNNING JOB BEATS — AND A PROCESS NEVER REAPS ITS OWN (2026-11-25).
 *
 * Seen live that day: a tester's story was rendering when the server went down. The new process came back at
 * 19:06:25 UTC; the job had last written its row at ≈19:04 — inside the boot reclaim's two-minute grace, so the boot
 * left it for the reaper, and the reaper waited until the row had been untouched for TWENTY-FIVE minutes. The piece sat
 * "in progress" with nothing running until ≈19:30, after the tester had already waited an hour. Every deploy that
 * landed under a render cost a member the same. Twenty-five minutes was there for a reason: a live job could go that
 * long without writing its row (a ten-minute provider poll, a long encode — only its checkpoints and the encode turn's
 * beat wrote it), and any shorter ceiling would have taken live renders for dead and paid for them twice.
 *
 * So the WORKER now writes the row of every job it is running, once a minute, whatever the job is doing (`startBeat`,
 * started by job-queue.server.ts → claimAndRunOneJob). A row nobody has written for a few minutes is then a job nobody
 * is running, and the reaper's ceiling comes down from twenty-five minutes to five (worker.server.ts → STUCK_MS). What
 * keeps that from ever taking a live render:
 *  - the beat writes ONLY `updatedAt`, and only while the row is IN_PROGRESS — never the payload, so a job's `ck*`
 *    checkpoints and the stall rule's marks (job-stall.ts) are the job's alone;
 *  - a beat that fails is tried again every ten seconds until one lands: a database blip must not make a live job
 *    look dead;
 *  - a process never reaps a job it is running itself (`jobsHere`) — a process whose beats were held up cannot bounce
 *    its own render back to the line and render it a second time beside itself.
 * A beat has an end, like everything else in the worker: it stops when the job's lane gives its slot back — the queue's
 * own word for "this job is wedged" (RENDER_SLOT_MS, or a long film's own hold). A timer that beat for ever would keep
 * a wedged job looking alive for ever; that is why the acted film beats only at real steps (tests/film-length), and
 * why `alive` is asked before every beat here. The same answer takes a wedged job off `jobsHere`, so this process's
 * reaper may have it.
 * …BUT ONLY ON THE OLD TERMS (review, 2026-11-25). "The slot ran out" is the lane's word for "start the next job beside
 * it", never the reaper's word for "dead": a job past its slot may still be honestly at work (a slow provider on a long
 * film), writing its checkpoints as it always did — and before the beat, such a job was taken only after twenty-five
 * minutes without one. Left to the five-minute ceiling it would be bounced while live: rendered twice, paid twice, two
 * renders side by side in 2 GB. So a job past its slot that this process is STILL running is left alone until its row
 * has gone `OVERRAN_STUCK_MS` (the old twenty-five minutes) unwritten — exactly what it was promised before the beat.
 *
 * …AND A PROCESS TOLD TO STOP STARTS NOTHING NEW. On SIGTERM (worker.server.ts) the process stops taking jobs
 * (`makeStopSwitch`) and writes a stop mark on every job it is running (`markStopped`; what the mark means: job-stall.ts
 * → A DEPLOY IS NOT A STALL). The jobs it is running are let be until the process is ended.
 *
 * Pure: no database, no clock of its own. The rows and the timers are handed in, so the tests drive both. */

import { stoppedBy, withStopMark } from "./job-stall.ts";

/** Who a raw payload says stopped its run, or null (not JSON, not an object, or no mark). */
function markedBy(raw: string): string | null {
  try {
    const p = JSON.parse(raw);
    return p && typeof p === "object" && !Array.isArray(p) ? stoppedBy(p) : null;
  } catch {
    return null;
  }
}

/** How often the worker writes a running job's row. */
export const JOB_BEAT_MS = 60_000;
/** How soon a beat that did not land is tried again. */
export const JOB_BEAT_RETRY_MS = 10_000;
/** How long the stop marks may take on SIGTERM before the process gives up on them: Render ends a stopped process 30 s
 *  after SIGTERM (a service with a disk cannot change that), and the marks are a courtesy, never a reason to wait. */
export const STOP_MARK_DEADLINE_MS = 5_000;
/** How long a job this process is still running, but whose lane has given its slot back (no beat any more), may go
 *  unwritten before the reaper takes it: the twenty-five minutes every job had before the beat (splitOwn). */
export const OVERRAN_STUCK_MS = 25 * 60_000;

/** The timers a beat runs on — the real ones in the worker, a hand-cranked clock in the tests. */
export type BeatTimers = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };

/** The real timers, unref'd: a beat is never what keeps a process from ending. */
export const realTimers: BeatTimers = {
  set: (fn, ms) => {
    const h = setTimeout(fn, ms);
    (h as { unref?: () => void }).unref?.();
    return h;
  },
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** `work`, or a failure once `ms` have gone by without an answer (a query that hangs is a beat that did not land). */
export function settleWithin<T>(work: Promise<T>, ms: number, timers: BeatTimers = realTimers): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const h = timers.set(() => reject(new Error(`no answer in ${ms} ms`)), ms);
    work.then(
      (v) => { timers.clear(h); resolve(v); },
      (e) => { timers.clear(h); reject(e); },
    );
  });
}

/** THE BEAT. `touch` writes the job's row (its `updatedAt`, nothing else) once every `everyMs`; one that throws, or does
 *  not answer within `retryMs`, is tried again after `retryMs`, and again, until one lands. `alive` is asked before
 *  each beat: false (the job's lane has given its slot back — the job is wedged) ends the beat for good. Returns the
 *  stop — called in a `finally` on every way out of the job, it ends the beat at once, and a touch still in flight
 *  then schedules nothing after it. `onFail` is told each failure and how many in a row (for the log). */
export function startBeat(o: {
  touch: () => Promise<unknown>;
  alive?: () => boolean;
  everyMs?: number;
  retryMs?: number;
  timers?: BeatTimers;
  onFail?: (e: unknown, inARow: number) => void;
}): () => void {
  const every = o.everyMs ?? JOB_BEAT_MS;
  const retry = o.retryMs ?? JOB_BEAT_RETRY_MS;
  const timers = o.timers ?? realTimers;
  let stopped = false;
  let handle: unknown;
  let failed = 0;
  const next = (ms: number) => {
    if (!stopped) handle = timers.set(() => void fire(), ms);
  };
  async function fire(): Promise<void> {
    handle = undefined;
    if (stopped) return;
    let ours = true;
    try { ours = o.alive ? o.alive() : true; } catch { /* cannot tell: keep beating, a live job is never left looking dead */ }
    if (!ours) {
      stopped = true;
      return;
    }
    try {
      await settleWithin(Promise.resolve().then(o.touch), retry, timers);
      failed = 0;
      next(every);
    } catch (e) {
      failed++;
      try { o.onFail?.(e, failed); } catch { /* a log that throws is no reason to stop beating */ }
      next(retry);
    }
  }
  next(every);
  return () => {
    stopped = true;
    if (handle !== undefined) timers.clear(handle);
    handle = undefined;
  };
}

/** THE JOBS THIS PROCESS IS RUNNING, in memory. The reaper and the boot reclaim skip every one of them (a process that
 *  ends takes the list with it — a job of a process that died is on nobody's list). `ours` is asked each time: a job
 *  whose lane has given its slot back (wedged) is no longer kept from the reaper by its age alone — only on the old
 *  terms (splitOwn → `overran`) until its work ends and its release takes it off. A job id run again in this process
 *  (a wedged run, and the newer run of the same row) is the NEWER run's: the older run's release does not remove it. */
export type JobsHere = {
  /** this process is running `id` while `ours()` says so; returns the release (call it in a `finally`) */
  add: (id: string, ours?: () => boolean) => () => void;
  /** is this process running `id` (and is it still its own)? */
  has: (id: string) => boolean;
  /** is this process still running `id` at all — its slot its own or not (its work has not yet ended)? */
  running: (id: string) => boolean;
  /** every job this process is running whose slot is still its own */
  ids: () => string[];
  /** every job this process is running, its slot its own or not (the stop mark goes on each: all are stopped) */
  all: () => string[];
};

export function makeJobsHere(): JobsHere {
  const here = new Map<string, () => boolean>();
  const has = (id: string): boolean => {
    const ours = here.get(id);
    if (!ours) return false;
    try { return ours(); } catch { return true; } // cannot tell: never reap it
  };
  return {
    add: (id, ours = () => true) => {
      here.set(id, ours);
      return () => {
        if (here.get(id) === ours) here.delete(id);
      };
    },
    has,
    running: (id) => here.has(id),
    ids: () => [...here.keys()].filter(has),
    all: () => [...here.keys()],
  };
}

/** The worker's own list. */
export const jobsHere: JobsHere = makeJobsHere();

/** RUN A CLAIMED JOB AS THIS PROCESS'S OWN: on the list (kept from the reaper) and beating, from now until `work` has
 *  ended — whichever way it ends: done, thrown, or any early return (paused, handed to another lane). Both stop in
 *  the `finally`, so no way out leaves a beat behind it, or a job on the list that is no longer running. */
export async function runBeating<T>(
  id: string,
  work: () => Promise<T>,
  o: {
    touch: () => Promise<unknown>;
    alive?: () => boolean;
    jobs?: JobsHere;
    everyMs?: number;
    retryMs?: number;
    timers?: BeatTimers;
    onFail?: (e: unknown, inARow: number) => void;
  },
): Promise<T> {
  const release = (o.jobs ?? jobsHere).add(id, o.alive);
  const stop = startBeat(o);
  try {
    return await work();
  } finally {
    stop();
    release();
  }
}

/** THE REAPER'S SCAN, SPLIT: the rows it may take (`orphans`); the ones this process is running itself, its slot its
 *  own (`ours` — never taken here, whatever their age); and the ones it is still running past their slot whose row was
 *  written less than `overranMs` ago (`overran` — left alone on the old terms: see …BUT ONLY ON THE OLD TERMS, above).
 *  job-queue.server.ts → reclaimOrphanJobs logs the two kept kinds. */
export function splitOwn<T extends { id: string; updatedAt: Date | number }>(
  rows: T[],
  jobs: JobsHere = jobsHere,
  now: number = Date.now(),
  overranMs: number = OVERRAN_STUCK_MS,
): { orphans: T[]; ours: T[]; overran: T[] } {
  const orphans: T[] = [];
  const ours: T[] = [];
  const overran: T[] = [];
  for (const r of rows) {
    const at = typeof r.updatedAt === "number" ? r.updatedAt : r.updatedAt.getTime();
    if (jobs.has(r.id)) ours.push(r);
    else if (jobs.running(r.id) && now - at < overranMs) overran.push(r);
    else orphans.push(r);
  }
  return { orphans, ours, overran };
}

/** THE STOP SWITCH: once thrown, no job is claimed here again (job-queue.server.ts → processNextJob) and the worker
 *  starts no chore (worker.server.ts → tick). It is never thrown back: a stopped process is ended by its host. */
export type StopSwitch = { stop: (by: string, at?: Date) => void; stopped: () => { by: string; at: Date } | null };

export function makeStopSwitch(): StopSwitch {
  let s: { by: string; at: Date } | null = null;
  return {
    stop: (by, at = new Date()) => {
      if (!s) s = { by, at };
    },
    stopped: () => s,
  };
}

/** The worker's own switch. */
export const stopSwitch: StopSwitch = makeStopSwitch();

/** The two calls `markStopped` needs: read a job's row; write its payload ONLY IF the row is still IN_PROGRESS and its
 *  payload is still the one read (returns how many rows were written: 1 or 0). The status is never written. */
export type StopRows = {
  read: (id: string) => Promise<{ status: string; payload: string } | null>;
  write: (id: string, before: string, next: string) => Promise<number>;
};

/** WRITE THE STOP MARK on each job this process is running (job-stall.ts → withStopMark): conditionally on the payload
 *  read, so a checkpoint written in between is never undone (that write is retried on the new payload, up to `tries`
 *  times). A row that is no longer IN_PROGRESS — it finished meanwhile — is left alone. Never throws. Returns the ids
 *  that now carry the mark. The caller bounds the whole of it in time (settleWithin): it must never hold up an end. */
export async function markStopped(ids: string[], rows: StopRows, by: string, at: Date, tries = 3): Promise<string[]> {
  const marked: string[] = [];
  await Promise.all(
    ids.map(async (id) => {
      for (let k = 0; k < tries; k++) {
        try {
          const row = await rows.read(id);
          if (!row || row.status !== "IN_PROGRESS") return;
          const next = withStopMark(row.payload, by, at.toISOString());
          if (next === null) {
            // already marked (a second SIGTERM), or a payload that is not a JSON object: nothing to write
            if (markedBy(row.payload) === by) marked.push(id);
            return;
          }
          if ((await rows.write(id, row.payload, next)) === 1) {
            marked.push(id);
            return;
          }
        } catch {
          /* a blip: read it again */
        }
      }
    }),
  );
  return marked;
}
