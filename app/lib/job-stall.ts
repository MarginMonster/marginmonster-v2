/* A JOB THAT TAKES THE SERVER DOWN IS NOT TRIED FOREVER.
 *
 * 2026-11-25, verified from Render's own events and logs: a tester's first told story, twelve scenes, made all
 * twelve of its moving clips — and then its one final cut (twelve Full-HD inputs in one ffmpeg) needed more than
 * the server's 2 GB. "Ran out of memory (used over 2GB)" at 12:14, 12:42, 1:10 and 1:39 PM ET. Each time the
 * worker came back, the reaper found the job untouched for 25 minutes, handed it back (job-queue.server.ts →
 * reclaimOrphanJobs), it resumed from its checkpoints and died three minutes later in the same cut. It would have
 * done so six times (MAX_RECLAIMS) — and every one of those restarts killed every other member's render in
 * flight. The tester: "They have stuck bro on first test almost 1 hour". The told cut itself is fixed
 * (story-join.ts → STORY_ONE_CUT); this is the rule that makes the WHOLE queue safe from the same loop.
 *
 * A restart is counted apart from a job's tries (`__reclaims`), so a deploy never eats a render's attempts — that
 * stays. What a restart cannot say is WHY it happened: a deploy, or the job itself. Its checkpoints can. A job that
 * is handed back again with exactly the checkpoints it had when it was last handed back — the `ck*` keys of its
 * payload, heartbeats left out — made no progress in between: that is a STALL. One stall is not a loop (a second
 * deploy in the middle of a long encode is ordinary); TWO STALLS IN A ROW, on the same step, is: the job is failed
 * with its reason and refunded the way a job out of restarts always has been, and it is not tried a third time.
 *
 * Pure: no database, no clock. The reaper (job-queue.server.ts) asks it and writes what it says, conditionally,
 * exactly as before. */

import { createHash } from "node:crypto";

/** How many stalls in a row end a job: the two tries after a crash that each stopped at the same step. */
export const STALLS_TO_FAIL = 2;

/** What the member reads on a job the loop rule ended (the Studio shows a failed job's reason). */
export const STALLED_REASON = "It stopped twice at the same step and was not tried a third time — hit ROLL CAMERA to try again.";

/** A HEARTBEAT IS NOT PROGRESS. `ckBeat` (every pipeline's "still alive", a timestamp written between clips and
 *  encodes) and `ckFbeat` (the found-footage film's, every four minutes while its rolls are in the air) change on
 *  every run whether or not anything was made — counted, the told story that crash-looped would have looked like a
 *  job going somewhere: it writes ckBeat before every rung of its cut. */
export const isHeartbeat = (key: string): boolean => /beat$/i.test(key);

/** The keys a job has checkpointed, in the order its payload holds them (a checkpoint merges onto the payload, so a
 *  key written for the first time is the last one in it: ugc-ad-pipeline.server.ts → checkpointJob). */
export function checkpointKeys(payload: Record<string, unknown>): string[] {
  return Object.keys(payload || {}).filter((k) => /^ck[A-Z0-9_]/.test(k) && !isHeartbeat(k));
}

/** WHAT THE JOB HAS MADE, as one short fingerprint: every checkpoint and its value, in key order (so the same work
 *  is the same fingerprint however the payload was written). Kept on the payload as `__ckSig` — a hash, not the
 *  values: a told story's checkpoints are its whole script and every picture's address. */
export function checkpointSig(payload: Record<string, unknown>): string {
  const keys = checkpointKeys(payload).sort();
  const text = JSON.stringify(keys.map((k) => [k, payload[k] === undefined ? null : payload[k]]));
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

/** The step a job is stuck after: its newest checkpoint, or null when it has none yet. */
export function lastCheckpoint(payload: Record<string, unknown>): string | null {
  const keys = checkpointKeys(payload);
  return keys.length ? keys[keys.length - 1] : null;
}

/** A DEPLOY IS NOT A STALL (2026-11-25, the R1 reviewer's risk). A long told story's cut parts write only `ckBeat`, so
 *  three deploys in a row landing inside the same cut read as two stalls in a row and failed a HEALTHY job. A restart
 *  can say why it happened after all — when it was asked to: on SIGTERM (Render stops the old process that way, on a
 *  deploy; an out-of-memory kill runs no handler and writes nothing) the worker writes `__stoppedBy` (who: "deploy")
 *  and `__stoppedAt` (when) onto every job it is running (job-beat.ts → markStopped). The reaper's hand-back of a job
 *  carrying the mark is not counted as a stall — progress still resets the count, a stall before it still stands —
 *  and the mark comes off as it is handed back. A new run's claim takes a mark left from an older run off as well
 *  (job-queue.server.ts → the start stamp), so only the run that was stopped is ever let off. */
export const STOPPED_BY = "__stoppedBy";
export const STOPPED_AT = "__stoppedAt";
export const STOP_MARKS = [STOPPED_BY, STOPPED_AT] as const;

/** Who stopped this job's run ("deploy"), or null when nobody said. */
export function stoppedBy(payload: Record<string, unknown>): string | null {
  const v = (payload || {})[STOPPED_BY];
  return typeof v === "string" && v ? v : null;
}

/** The payload with the stop mark on it (the time as written), or null when there is nothing to write: it already says
 *  so, or it is not a JSON object (left exactly as it is). Pure — the caller writes it, conditionally on `raw`. */
export function withStopMark(raw: string, by: string, at: string): string | null {
  try {
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object" || Array.isArray(p)) return null;
    if (p[STOPPED_BY] === by) return null;
    return JSON.stringify({ ...p, [STOPPED_BY]: by, [STOPPED_AT]: at });
  } catch {
    return null;
  }
}

export type ReclaimStall = {
  /** the fingerprint of its checkpoints now — written back as `__ckSig` */
  sig: string;
  /** stalls in a row, this one included — written back as `__stalls` (0: it made progress, or was never handed back) */
  stalls: number;
  /** two in a row: fail it, refund it, never try it again */
  stuck: boolean;
  /** the checkpoint it was stuck after (null: before its first) — for the operator's log */
  after: string | null;
  /** who stopped the run being handed back ("deploy"), when its process said so — then this hand-back is no stall */
  stopped: string | null;
};

/** THE RULE, for a job the reaper is about to hand back: has it made any progress since it was last handed back?
 *  `payload` = the job's payload as the reaper read it. A job handed back for the first time has nothing to be
 *  compared with, and is never a stall. A job whose own process said it was stopped by a deploy is not stalled by
 *  that deploy: its count stays where it was (a stall before it still counts; progress still starts it again). */
export function reclaimStall(payload: Record<string, unknown>): ReclaimStall {
  const p = payload || {};
  const sig = checkpointSig(p);
  const before = typeof p.__ckSig === "string" ? p.__ckSig : null;
  const had = typeof p.__stalls === "number" && Number.isFinite(p.__stalls) && p.__stalls > 0 ? Math.floor(p.__stalls) : 0;
  const stopped = stoppedBy(p);
  const stalls = before === sig ? (stopped ? had : had + 1) : 0;
  return { sig, stalls, stuck: !stopped && stalls >= STALLS_TO_FAIL, after: lastCheckpoint(p), stopped };
}

/** WHAT THE REAPER WRITES when it hands a job back: the payload with its restart counted (`__reclaims`, as it always
 *  was) and this rule's two marks (`__ckSig`, `__stalls`), a deploy's stop mark taken off; how many restarts it had
 *  before this one; and the rule's answer. A payload that is not a JSON object is left exactly as it is (no count, no
 *  answer). (Pure: it writes nothing. The reaper writes what it returns, conditionally on the row it read —
 *  tests/no-blind-writes.) */
export function onReclaim(raw: string): { payload: string; reclaims: number; stall: ReclaimStall | null } {
  try {
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object" || Array.isArray(p)) return { payload: raw, reclaims: 0, stall: null };
    const reclaims = typeof p.__reclaims === "number" ? p.__reclaims : 0;
    p.__reclaims = reclaims + 1;
    const stall = reclaimStall(p);
    p.__ckSig = stall.sig;
    p.__stalls = stall.stalls;
    // (the stop said why THIS restart happened; the next one must say so again for itself)
    for (const k of STOP_MARKS) delete p[k];
    const next = JSON.stringify(p);
    return { payload: next, reclaims, stall };
  } catch {
    return { payload: raw, reclaims: 0, stall: null };
  }
}

/** WHAT THE REAPER WRITES WHEN IT ENDS A JOB (FAILED, any reason): the payload as it was, this rule's two marks taken
 *  off. A failed job can be tried again from the Archive (web.archive.tsx → retry), and that keeps the payload — all
 *  of it when nothing was refunded, everything but the checkpoints when it was. Left on, the marks of the run that
 *  ended were compared with the NEW run's at its first hand-back: one deploy before the new run's first checkpoint
 *  (the same empty set of checkpoints the old run looped on) or before its first new one (the same checkpoints, kept)
 *  read as the second stall in a row, and a member's paid retry was failed by a single restart — found in review,
 *  2026-11-25. A new run starts its count afresh. (Not JSON, or not an object: left exactly as it is.)
 *  A deploy's stop mark goes with them: it spoke for the run that ended. */
export function withoutStallMarks(raw: string): string {
  try {
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object" || Array.isArray(p) || !["__ckSig", "__stalls", ...STOP_MARKS].some((k) => k in p)) return raw;
    delete p.__ckSig;
    delete p.__stalls;
    for (const k of STOP_MARKS) delete p[k];
    return JSON.stringify(p);
  } catch {
    return raw;
  }
}

/** A RETRY IS A NEW RUN (web.archive.tsx / app.archive.tsx → retryJob): the counts of the run that ended — its
 *  restarts (`__reclaims`) and this rule's marks (`__ckSig`, `__stalls`) — come off, so the new run counts afresh.
 *  Left on (review of R1, 2026-11-25): a job ended at MAX_RECLAIMS and tried again died at its FIRST hand-back, and one
 *  that stalled once and then failed in the worker (processNextJob's own terminal write, which the reaper's
 *  withoutStallMarks never sees) was failed again by a single deploy. Its checkpoints are the caller's business: a
 *  refunded retry drops them (a fresh purchase), a free one keeps them (it resumes). */
export const RUN_COUNTS = ["__reclaims", "__ckSig", "__stalls"] as const;
export function freshRun(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(payload || {}) };
  for (const k of RUN_COUNTS) delete out[k];
  return out;
}
/** …and whether a payload carries any of them (a free retry rewrites its payload only then). */
export const hasRunCounts = (payload: Record<string, unknown>): boolean => RUN_COUNTS.some((k) => k in (payload || {}));

/** The operator's line for a job the rule ended: its type, its id, and where it was stuck. */
export function stalledLog(o: { id: string; type: string; after: string | null; reclaims: number }): string {
  return `[worker] job ${o.id} (${o.type}) stopped twice in a row with no progress — stuck after ${o.after ? `checkpoint ${o.after}` : "its start (no checkpoint yet)"}, restart ${o.reclaims} — FAILED and refunded, not tried a third time`;
}
