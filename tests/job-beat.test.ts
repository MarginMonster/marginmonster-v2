/* AFTER A CRASH, A MEMBER'S PIECE RESUMES IN MINUTES, NOT 25 (app/lib/job-beat.ts).
 * 2026-11-25, live: a story's job last wrote its row at ≈19:04 UTC, the server was back at 19:06:25, and the job sat
 * "in progress" with nothing running until ≈19:30 — the reaper waited for 25 minutes untouched, because a live job
 * could go that long without writing its row. Now the worker writes the row of every job it runs once a minute,
 * retries a beat that fails every ten seconds, never reaps its own jobs, and the ceiling is five minutes. These tests
 * drive all of it with a hand-cranked clock and a database in memory — nothing here touches a real one. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  JOB_BEAT_MS, JOB_BEAT_RETRY_MS, STOP_MARK_DEADLINE_MS, makeJobsHere, makeStopSwitch, markStopped, runBeating, settleWithin, splitOwn, startBeat,
  type BeatTimers, type StopRows,
} from "../app/lib/job-beat.ts";
import { onReclaim } from "../app/lib/job-stall.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const MIN = 60_000;

// ---- a clock turned by hand ----------------------------------------------------------------------------------------

/** Timers that fire only when the test turns the clock. Each "process" gets its own set (`proc()`), so a crash can
 *  take every timer of that process with it, as a real one does. */
function handClock() {
  let now = 0;
  let seq = 0;
  const due = new Map<number, { at: number; fn: () => void; owner: number }>();
  const settle = () => new Promise<void>((r) => setImmediate(r));
  let procs = 0;
  const proc = () => {
    const owner = ++procs;
    const timers: BeatTimers = {
      set: (fn, ms) => {
        const id = ++seq;
        due.set(id, { at: now + ms, fn, owner });
        return id;
      },
      clear: (h) => { due.delete(h as number); },
    };
    /** the process dies: nothing it scheduled ever fires */
    const kill = () => { for (const [id, t] of due) if (t.owner === owner) due.delete(id); };
    const pending = () => [...due.values()].filter((t) => t.owner === owner).length;
    return { timers, kill, pending };
  };
  async function advance(ms: number): Promise<void> {
    const end = now + ms;
    await settle();
    for (;;) {
      let first: [number, { at: number; fn: () => void }] | undefined;
      for (const e of due) if (e[1].at <= end && (!first || e[1].at < first[1].at || (e[1].at === first[1].at && e[0] < first[0]))) first = e;
      if (!first) break;
      due.delete(first[0]);
      now = first[1].at;
      first[1].fn();
      await settle();
    }
    now = end;
    await settle();
  }
  return { proc, advance, now: () => now };
}

// ---- a database in memory -------------------------------------------------------------------------------------------

type Row = { id: string; type: string; status: string; payload: string; attempts: number; updatedAt: number };

/** The job table, as the queue uses it: `updateMany` matches every key of `where` exactly and, like Prisma's
 *  @updatedAt, stamps every row it writes with the clock's time. `away` = the database is unreachable. */
function fakeDb(now: () => number) {
  const rows = new Map<string, Row>();
  const writes: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const state = { away: false, hang: false };
  return {
    rows,
    writes,
    state,
    async updateMany(a: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }> {
      writes.push(a);
      if (state.hang) return new Promise(() => { /* never answers */ });
      if (state.away) throw new Error("TEST database unreachable");
      let count = 0;
      for (const r of rows.values()) {
        if (!Object.entries(a.where).every(([k, v]) => (r as Record<string, unknown>)[k] === v)) continue;
        for (const [k, v] of Object.entries(a.data)) if (k !== "updatedAt") (r as Record<string, unknown>)[k] = v;
        r.updatedAt = now();
        count++;
      }
      return { count };
    },
  };
}

/** The worker's own touch, written exactly as job-queue.server.ts writes it (pinned below). */
const touchOf = (db: ReturnType<typeof fakeDb>, jobId: string) => () =>
  db.updateMany({ where: { id: jobId, status: "IN_PROGRESS" }, data: { updatedAt: new Date() } });

const told = () => JSON.stringify({
  contentType: "film", filmMode: "narrated", filmScenes: 12, prePaid: true, __jobId: "job_TEST_9",
  ckTreatment: "{\"title\":\"TEST — The Lantern Pier\"}", ckImages: "[]", ckMotion: "[]", ckBeat: 1,
});

/** The reaper, as job-queue.server.ts → reclaimOrphanJobs decides: the scan, this process's own jobs split off
 *  (splitOwn — the real one), the rule's answer (onReclaim — the real one), the write pinned to the row as scanned. */
async function reap(db: ReturnType<typeof fakeDb>, now: number, olderThanMs: number, jobs = makeJobsHere()): Promise<string[]> {
  const scanned = [...db.rows.values()].filter((r) => r.status === "IN_PROGRESS" && r.updatedAt < now - olderThanMs).map((r) => ({ ...r }));
  const { orphans } = splitOwn(scanned, jobs);
  const taken: string[] = [];
  for (const j of orphans) {
    const { payload } = onReclaim(j.payload);
    const done = await db.updateMany({ where: { id: j.id, status: "IN_PROGRESS", updatedAt: j.updatedAt }, data: { status: "PENDING", attempts: Math.max(0, j.attempts - 1), payload } });
    if (done.count === 1) taken.push(j.id);
  }
  return taken;
}

/** The reaper's ceiling and the boot grace, as the worker sets them (read from its source, so they cannot drift). */
const worker = read("app", "worker.server.ts");
const minutesOf = (name: string): number => {
  const m = worker.match(new RegExp(`const ${name} = (\\d+) \\* 60_000;`));
  assert.ok(m, name);
  return Number(m[1]) * MIN;
};
const STUCK_MS = minutesOf("STUCK_MS");
const BOOT_GRACE_MS = minutesOf("BOOT_GRACE_MS");

// ---- 1. the beat ----------------------------------------------------------------------------------------------------

test("EVERY RUNNING JOB BEATS: once a minute from the claim, the row's updatedAt and nothing else — never its payload, never its status", async () => {
  const clock = handClock();
  const db = fakeDb(clock.now);
  db.rows.set("job_TEST_1", { id: "job_TEST_1", type: "GENERATE_VIDEO_AD", status: "IN_PROGRESS", payload: told(), attempts: 1, updatedAt: 0 });
  const p = clock.proc();
  const stop = startBeat({ touch: touchOf(db, "job_TEST_1"), timers: p.timers });
  await clock.advance(JOB_BEAT_MS - 1);
  assert.equal(db.writes.length, 0, "not before the first minute (the claim itself wrote the row)");
  await clock.advance(1);
  assert.equal(db.writes.length, 1);
  assert.equal(db.rows.get("job_TEST_1")!.updatedAt, JOB_BEAT_MS);
  await clock.advance(9 * JOB_BEAT_MS);
  assert.equal(db.writes.length, 10, "one a minute");
  assert.equal(db.rows.get("job_TEST_1")!.updatedAt, 10 * JOB_BEAT_MS);
  for (const w of db.writes) {
    assert.deepEqual(w.where, { id: "job_TEST_1", status: "IN_PROGRESS" }, "only while it is in progress");
    assert.deepEqual(Object.keys(w.data), ["updatedAt"], "the beat writes updatedAt alone");
  }
  const row = db.rows.get("job_TEST_1")!;
  assert.equal(row.payload, told(), "the checkpoints and the stall rule's marks are the job's");
  assert.equal(row.status, "IN_PROGRESS");
  // a row that is no longer in progress (finished, handed back) is not written: the beat goes on harmlessly
  row.status = "COMPLETED";
  const before = row.updatedAt;
  await clock.advance(3 * JOB_BEAT_MS);
  assert.equal(row.updatedAt, before);
  assert.equal(row.status, "COMPLETED");
  stop();
  assert.equal(p.pending(), 0);
});

test("A BEAT THAT FAILS IS TRIED AGAIN EVERY TEN SECONDS until one lands — a database blip never makes a live job look dead", async () => {
  const clock = handClock();
  const db = fakeDb(clock.now);
  db.rows.set("job_TEST_2", { id: "job_TEST_2", type: "GENERATE_VIDEO_AD", status: "IN_PROGRESS", payload: told(), attempts: 1, updatedAt: 0 });
  const p = clock.proc();
  const told_: Array<[string, number]> = [];
  const stop = startBeat({ touch: touchOf(db, "job_TEST_2"), timers: p.timers, onFail: (e, n) => told_.push([e instanceof Error ? e.message : String(e), n]) });
  db.state.away = true;
  await clock.advance(JOB_BEAT_MS); // the first beat: fails
  await clock.advance(JOB_BEAT_RETRY_MS); // tried again 10 s later: fails
  await clock.advance(JOB_BEAT_RETRY_MS); // and again
  assert.deepEqual(told_.map(([, n]) => n), [1, 2, 3], "each failure counted, in a row");
  assert.equal(db.writes.length, 3);
  db.state.away = false;
  await clock.advance(JOB_BEAT_RETRY_MS); // the database is back: the next try lands
  assert.equal(db.rows.get("job_TEST_2")!.updatedAt, JOB_BEAT_MS + 3 * JOB_BEAT_RETRY_MS);
  assert.equal(db.writes.length, 4);
  // …and the beat is back to once a minute, its count of failures reset
  await clock.advance(JOB_BEAT_MS - 1);
  assert.equal(db.writes.length, 4);
  await clock.advance(1);
  assert.equal(db.writes.length, 5);
  db.state.away = true;
  await clock.advance(JOB_BEAT_MS);
  assert.equal(told_[told_.length - 1][1], 1, "a new run of failures counts from one");
  // a query that never answers is a beat that did not land: tried again after ten seconds all the same
  db.state.away = false;
  db.state.hang = true;
  const n = db.writes.length;
  await clock.advance(JOB_BEAT_RETRY_MS); // this try hangs…
  assert.equal(db.writes.length, n + 1);
  await clock.advance(JOB_BEAT_RETRY_MS); // …given up on after 10 s (a failure), the next try 10 s after that
  await clock.advance(JOB_BEAT_RETRY_MS); // (which hangs too)
  assert.equal(db.writes.length, n + 2, "a hung query does not end the beat");
  db.state.hang = false;
  await clock.advance(2 * JOB_BEAT_RETRY_MS);
  assert.ok(db.rows.get("job_TEST_2")!.updatedAt > JOB_BEAT_MS * 2, "and once the database answers, the row is written again");
  // an onFail that throws is no reason to stop beating
  const loud = startBeat({ touch: async () => { throw new Error("TEST down"); }, timers: p.timers, onFail: () => { throw new Error("log broke"); } });
  await clock.advance(JOB_BEAT_MS + JOB_BEAT_RETRY_MS);
  assert.ok(p.pending() >= 1, "still scheduled");
  loud();
  stop();
  // (a touch that throws before it returns a promise is a failure like any other)
  const sync: number[] = [];
  const s2 = startBeat({ touch: () => { throw new Error("TEST thrown at once"); }, timers: p.timers, onFail: (_e, k) => sync.push(k) });
  await clock.advance(JOB_BEAT_MS);
  assert.deepEqual(sync, [1]);
  s2();
  assert.equal(p.pending(), 0);
});

test("THE BEAT ENDS on stop — at once, and a touch still in flight schedules nothing after it — and when the job's lane has given its slot back (wedged)", async () => {
  const clock = handClock();
  const db = fakeDb(clock.now);
  db.rows.set("job_TEST_3", { id: "job_TEST_3", type: "EDIT_VIDEO", status: "IN_PROGRESS", payload: "{}", attempts: 1, updatedAt: 0 });
  const p = clock.proc();
  // stopped before the first beat: nothing ever written
  const s1 = startBeat({ touch: touchOf(db, "job_TEST_3"), timers: p.timers });
  s1();
  await clock.advance(10 * JOB_BEAT_MS);
  assert.equal(db.writes.length, 0);
  assert.equal(p.pending(), 0);
  // stopped while a touch is in flight: that touch ends, and nothing follows it
  let answer: () => void = () => {};
  let calls = 0;
  const s2 = startBeat({ touch: () => { calls++; return new Promise<void>((r) => { answer = r; }); }, timers: p.timers });
  await clock.advance(JOB_BEAT_MS);
  assert.equal(calls, 1);
  s2();
  answer();
  await clock.advance(10 * JOB_BEAT_MS);
  assert.equal(calls, 1, "no beat after the stop");
  assert.equal(p.pending(), 0);
  // the lane's slot given back (alive() false): the beat stops for good, writes nothing more
  let held = true;
  const s3 = startBeat({ touch: touchOf(db, "job_TEST_3"), timers: p.timers, alive: () => held });
  await clock.advance(3 * JOB_BEAT_MS);
  assert.equal(db.writes.length, 3);
  held = false;
  await clock.advance(10 * JOB_BEAT_MS);
  assert.equal(db.writes.length, 3, "a wedged job is not kept looking alive");
  assert.equal(p.pending(), 0);
  s3(); // (stopping twice is harmless)
  // alive() that throws: cannot tell — keep beating (a live job is never left looking dead)
  const s4 = startBeat({ touch: touchOf(db, "job_TEST_3"), timers: p.timers, alive: () => { throw new Error("TEST"); } });
  await clock.advance(JOB_BEAT_MS);
  assert.equal(db.writes.length, 4);
  s4();
});

test("runBeating: on the list and beating while the job runs, and BOTH ended on every way out — done, thrown, an early return", async () => {
  const clock = handClock();
  const db = fakeDb(clock.now);
  const p = clock.proc();
  const jobs = makeJobsHere();
  for (const [id, way] of [["job_TEST_ok", "done"], ["job_TEST_throw", "throw"], ["job_TEST_paused", "early"]] as const) {
    db.rows.set(id, { id, type: "GENERATE_IMAGE_AD", status: "IN_PROGRESS", payload: "{}", attempts: 1, updatedAt: clock.now() });
    let finish: () => void = () => {};
    const work = () => new Promise<boolean>((resolve, reject) => {
      finish = () => (way === "throw" ? reject(new Error("TEST pipeline failed")) : resolve(way === "done"));
    });
    const run = runBeating(id, work, { touch: touchOf(db, id), timers: p.timers, jobs });
    assert.equal(jobs.has(id), true, `${way}: on the list while it runs`);
    await clock.advance(2 * JOB_BEAT_MS);
    assert.equal(db.rows.get(id)!.updatedAt, clock.now(), `${way}: beating while it runs`);
    finish();
    if (way === "throw") await assert.rejects(run, /TEST pipeline failed/);
    else assert.equal(await run, way === "done");
    assert.equal(jobs.has(id), false, `${way}: off the list`);
    assert.equal(p.pending(), 0, `${way}: no beat left behind`);
    const at = db.rows.get(id)!.updatedAt;
    await clock.advance(5 * JOB_BEAT_MS);
    assert.equal(db.rows.get(id)!.updatedAt, at, `${way}: nothing written after it ended`);
  }
  // and the job queue runs EVERY claimed job through it: the early returns (paused, handed to another lane) are
  // returns from runClaimedJob, which is called in one place only — inside runBeating
  const q = read("app", "lib", "job-queue.server.ts");
  const claim = q.slice(q.indexOf("async function claimAndRunOneJob("), q.indexOf("async function runClaimedJob("));
  const run = q.slice(q.indexOf("async function runClaimedJob("), q.indexOf("async function runJob("));
  assert.equal(q.split("runClaimedJob(lane, claimed, hold)").length - 1, 1);
  assert.ok(claim.includes("return await runBeating(jobId, () => runClaimedJob(lane, claimed, hold), {\n    touch: () => db.job.updateMany({ where: { id: jobId, status: \"IN_PROGRESS\" }, data: { updatedAt: new Date() } }),\n    alive: held,"));
  assert.ok(run.includes("return true; // a tick was still spent; let the loop pull the next job"), "the pause");
  assert.ok(run.includes("console.warn(`[worker] job ${job.id} was marked a story but is not one — handed to the render lane`);\n        return true;"), "the hand-back to the render lane");
  assert.ok(run.includes("await asJob(\n      () => runJob(jobType, jobShop, payload),"), "the job itself");
});

// ---- 2. a process never reaps its own --------------------------------------------------------------------------------

test("A PROCESS NEVER REAPS ITS OWN LIVE JOB: the list, the newer run's entry, a wedged job let go", () => {
  const jobs = makeJobsHere();
  const release = jobs.add("job_TEST_a");
  assert.equal(jobs.has("job_TEST_a"), true);
  assert.equal(jobs.has("job_TEST_b"), false);
  // the same row run again in this process (a wedged run, then a newer one): the older run's release leaves the newer
  let wedged = false;
  const newer = jobs.add("job_TEST_a", () => !wedged);
  release();
  assert.equal(jobs.has("job_TEST_a"), true, "the newer run is still here");
  // past its lane's ceiling the job is no longer kept from the reaper
  wedged = true;
  assert.equal(jobs.has("job_TEST_a"), false);
  assert.deepEqual(jobs.ids(), []);
  wedged = false;
  assert.deepEqual(jobs.ids(), ["job_TEST_a"]);
  newer();
  assert.equal(jobs.has("job_TEST_a"), false);
  // an answer that throws: cannot tell — never reap it
  jobs.add("job_TEST_c", () => { throw new Error("TEST"); });
  assert.equal(jobs.has("job_TEST_c"), true);
  // the reaper's scan, split
  const { orphans, ours } = splitOwn([{ id: "job_TEST_c" }, { id: "job_TEST_dead" }], jobs);
  assert.deepEqual(orphans.map((r) => r.id), ["job_TEST_dead"]);
  assert.deepEqual(ours.map((r) => r.id), ["job_TEST_c"]);
  // wired: the boot reclaim and the reaper are one function, and it takes only the orphans
  const q = read("app", "lib", "job-queue.server.ts");
  const reaper = q.slice(q.indexOf("export async function reclaimOrphanJobs("), q.indexOf("export async function enqueueJob("));
  assert.ok(reaper.includes("const { orphans: stuck, ours } = splitOwn(scanned);\n"));
  assert.ok(reaper.indexOf("splitOwn(scanned)") < reaper.indexOf("for (const j of stuck) {"));
  assert.ok(reaper.indexOf("for (const j of stuck) {") < reaper.indexOf("onReclaim(j.payload)"));
  assert.ok(reaper.includes("but this process is running it — its beat is not landing; left alone"));
  assert.ok(worker.includes("await reclaimOrphanJobs(STUCK_MS);") && worker.includes("reclaimOrphanJobs(BOOT_GRACE_MS).catch("));
  // the job is on the list exactly while its lane's slot is its own
  assert.ok(q.includes("return await claimAndRunOneJob(lane, (ms) => { if (slot.token === myToken) slot.until = Math.max(slot.until, Date.now() + ms); }, () => slot.token === myToken && Date.now() < slot.until);"));
  assert.ok(read("app", "lib", "job-beat.ts").includes("const release = (o.jobs ?? jobsHere).add(id, o.alive);"));
});

// ---- 3. the ceiling, and the incident replayed ----------------------------------------------------------------------

test("THE CEILING IS FIVE MINUTES, the boot grace two — and both sit well clear of a live job's beat", () => {
  assert.equal(STUCK_MS, 5 * MIN);
  assert.equal(BOOT_GRACE_MS, 2 * MIN);
  assert.equal(JOB_BEAT_MS, MIN);
  assert.equal(JOB_BEAT_RETRY_MS, 10_000);
  assert.ok(STUCK_MS >= 5 * JOB_BEAT_MS, "five beats in a row missed before a row is taken");
  assert.ok(STUCK_MS / JOB_BEAT_RETRY_MS >= 25, "…and some twenty-five retries");
  assert.ok(BOOT_GRACE_MS >= 2 * JOB_BEAT_MS);
  assert.ok(!worker.includes("25 * 60_000"), "no twenty-five minutes left in the worker");
});

test("THE INCIDENT, replayed: a silent live job is never taken; a blip does not let its own process take it; after a crash it is handed back in minutes, not 25", async () => {
  const clock = handClock();
  const db = fakeDb(clock.now);
  db.rows.set("job_TEST_story", { id: "job_TEST_story", type: "GENERATE_VIDEO_AD", status: "IN_PROGRESS", payload: told(), attempts: 1, updatedAt: 0 });
  // process A runs the story: forty minutes of work that writes nothing (a long provider poll, a long encode)
  const a = clock.proc();
  const jobsA = makeJobsHere();
  let slotHeld = true;
  const work = new Promise<void>(() => { /* still at work */ });
  void runBeating("job_TEST_story", () => work, { touch: touchOf(db, "job_TEST_story"), timers: a.timers, jobs: jobsA, alive: () => slotHeld });
  // a reaper that is NOT this process's (an overlap during a deploy) scans every minute: never takes it
  for (let m = 0; m < 40; m++) {
    await clock.advance(MIN);
    assert.deepEqual(await reap(db, clock.now(), STUCK_MS), [], `minute ${m + 1}`);
  }
  // the database goes away for seven minutes: the row ages past the ceiling…
  db.state.away = true;
  for (let m = 0; m < 7; m++) {
    await clock.advance(MIN);
    // …but this process's own reaper leaves the job it is running alone
    assert.deepEqual(await reap(db, clock.now(), STUCK_MS, jobsA), [], `blip minute ${m + 1}`);
  }
  assert.ok(clock.now() - db.rows.get("job_TEST_story")!.updatedAt > STUCK_MS, "the row did age past the ceiling");
  db.state.away = false;
  await clock.advance(JOB_BEAT_RETRY_MS);
  assert.equal(db.rows.get("job_TEST_story")!.updatedAt, clock.now(), "the first try after the blip lands within ten seconds");
  // THE CRASH (an out-of-memory kill: no handler, every timer of process A gone, its list with it)
  await clock.advance(30_000);
  const lastBeat = db.rows.get("job_TEST_story")!.updatedAt;
  a.kill();
  const crashedAt = clock.now();
  // process B boots a minute later: the boot reclaim (two-minute grace) may or may not take it yet…
  await clock.advance(MIN);
  let taken = await reap(db, clock.now(), BOOT_GRACE_MS);
  // …and its reaper takes it at the first scan past five minutes untouched
  while (!taken.length) {
    await clock.advance(MIN);
    taken = await reap(db, clock.now(), STUCK_MS);
    assert.ok(clock.now() - crashedAt <= 7 * MIN, "never 25 minutes");
  }
  assert.deepEqual(taken, ["job_TEST_story"]);
  const row = db.rows.get("job_TEST_story")!;
  assert.equal(row.status, "PENDING", "handed back to the line, to resume from its checkpoints");
  assert.equal(JSON.parse(row.payload).__reclaims, 1);
  assert.ok(clock.now() - lastBeat <= STUCK_MS + MIN, "within a reaper tick of the ceiling");
});

test("A WEDGED JOB IS STILL TAKEN: once its lane gives its slot back, the beat stops and its own process's reaper may have it", async () => {
  const clock = handClock();
  const db = fakeDb(clock.now);
  db.rows.set("job_TEST_wedged", { id: "job_TEST_wedged", type: "GENERATE_VIDEO_AD", status: "IN_PROGRESS", payload: told(), attempts: 1, updatedAt: 0 });
  const a = clock.proc();
  const jobsA = makeJobsHere();
  const slotUntil = 70 * MIN; // RENDER_SLOT_MS
  void runBeating("job_TEST_wedged", () => new Promise<void>(() => { /* never settles */ }), {
    touch: touchOf(db, "job_TEST_wedged"), timers: a.timers, jobs: jobsA, alive: () => clock.now() < slotUntil,
  });
  let takenAt = -1;
  for (let m = 1; m <= 90 && takenAt < 0; m++) {
    await clock.advance(MIN);
    if ((await reap(db, clock.now(), STUCK_MS, jobsA)).length) takenAt = clock.now();
  }
  assert.ok(takenAt > slotUntil, "not while its slot was its own");
  assert.ok(takenAt <= slotUntil + STUCK_MS + MIN, "and soon after: " + takenAt / MIN);
  assert.equal(a.pending(), 0, "its beat had stopped");
});

// ---- 4. a process told to stop --------------------------------------------------------------------------------------

test("THE STOP SWITCH: thrown once, never thrown back, and the first word stands", () => {
  const s = makeStopSwitch();
  assert.equal(s.stopped(), null);
  const at = new Date("2026-11-25T19:04:00Z");
  s.stop("deploy", at);
  assert.deepEqual(s.stopped(), { by: "deploy", at });
  s.stop("other", new Date());
  assert.deepEqual(s.stopped(), { by: "deploy", at });
});

test("THE STOP MARK is written on each running job: conditionally, its status untouched, a checkpoint written meanwhile kept", async () => {
  const rows = new Map<string, { status: string; payload: string }>([
    ["job_TEST_run", { status: "IN_PROGRESS", payload: told() }],
    ["job_TEST_race", { status: "IN_PROGRESS", payload: told() }],
    ["job_TEST_done", { status: "COMPLETED", payload: told() }],
    ["job_TEST_odd", { status: "IN_PROGRESS", payload: "not json" }],
    ["job_TEST_blip", { status: "IN_PROGRESS", payload: told() }],
  ]);
  const writes: Array<{ id: string; before: string; next: string }> = [];
  let raced = false;
  let blipped = false;
  const db: StopRows = {
    read: async (id) => {
      if (id === "job_TEST_blip" && !blipped) { blipped = true; throw new Error("TEST blip"); }
      const r = rows.get(id);
      return r ? { ...r } : null;
    },
    write: async (id, before, next) => {
      writes.push({ id, before, next });
      // the race: a checkpoint lands between the read and this write
      if (id === "job_TEST_race" && !raced) {
        raced = true;
        rows.get(id)!.payload = JSON.stringify({ ...JSON.parse(told()), ckCut: "/renders/test-part2.mov" });
      }
      const r = rows.get(id);
      if (!r || r.status !== "IN_PROGRESS" || r.payload !== before) return 0;
      r.payload = next;
      return 1;
    },
  };
  const at = new Date("2026-11-25T19:04:30Z");
  const marked = await markStopped(["job_TEST_run", "job_TEST_race", "job_TEST_done", "job_TEST_odd", "job_TEST_blip", "job_TEST_gone"], db, "deploy", at);
  assert.deepEqual(marked.sort(), ["job_TEST_blip", "job_TEST_race", "job_TEST_run"]);
  const run = JSON.parse(rows.get("job_TEST_run")!.payload);
  assert.equal(run.__stoppedBy, "deploy");
  assert.equal(run.__stoppedAt, "2026-11-25T19:04:30.000Z");
  for (const [k, v] of Object.entries(JSON.parse(told()))) assert.deepEqual(run[k], v, k);
  assert.equal(rows.get("job_TEST_run")!.status, "IN_PROGRESS", "status untouched");
  // the checkpoint that landed in between is kept, the mark written onto it
  const race = JSON.parse(rows.get("job_TEST_race")!.payload);
  assert.equal(race.ckCut, "/renders/test-part2.mov");
  assert.equal(race.__stoppedBy, "deploy");
  // a finished job, and a payload that is not JSON, are left exactly as they were
  assert.equal(rows.get("job_TEST_done")!.payload, told());
  assert.equal(rows.get("job_TEST_odd")!.payload, "not json");
  assert.ok(!writes.some((w) => w.id === "job_TEST_done" || w.id === "job_TEST_odd"));
  // a second SIGTERM finds them marked: no write, still reported
  const n = writes.length;
  assert.deepEqual((await markStopped(["job_TEST_run"], db, "deploy", new Date())).length, 1);
  assert.equal(writes.length, n);
  // the whole of it is bounded in time: a database that never answers does not hold the end up
  const clock = handClock();
  const p = clock.proc();
  const hung: StopRows = { read: () => new Promise(() => { /* never */ }), write: async () => 0 };
  let gaveUp = false;
  const bounded = settleWithin(markStopped(["job_TEST_run"], hung, "deploy", at), STOP_MARK_DEADLINE_MS, p.timers).catch(() => { gaveUp = true; });
  await clock.advance(STOP_MARK_DEADLINE_MS);
  await bounded;
  assert.equal(gaveUp, true);
  assert.ok(STOP_MARK_DEADLINE_MS <= 5_000, "a few seconds — Render ends the process 30 s after SIGTERM");
});

test("ON SIGTERM the worker stops taking jobs and starting chores, marks what it is running, and lets it be — wired", () => {
  const q = read("app", "lib", "job-queue.server.ts");
  // no claim once stopped — checked before the slot is even reserved, and again after a claim that was in flight
  assert.ok(q.includes("export async function processNextJob(lane: Lane): Promise<boolean> {\n  // (a process told to stop claims nothing: stopTakingJobs, above)\n  if (stopSwitch.stopped()) return false;"));
  const claim = q.slice(q.indexOf("async function claimAndRunOneJob("), q.indexOf("async function runClaimedJob("));
  assert.ok(claim.includes("if (stopSwitch.stopped()) {\n    await db.job.updateMany({ where: { id: job.id, status: \"IN_PROGRESS\", attempts: job.attempts + 1 }, data: { status: \"PENDING\", attempts: { decrement: 1 } } }).catch(() => undefined);\n    return false;\n  }"));
  assert.ok(claim.indexOf("if (stopSwitch.stopped()) {") < claim.indexOf("runBeating("), "handed back before it ever starts");
  // the mark: conditional on the row as read, status never written, bounded in time
  const stop = q.slice(q.indexOf("export async function stopTakingJobs("), q.indexOf("export async function processNextJob("));
  assert.ok(stop.includes("stopSwitch.stop(by);\n  const running = jobsHere.ids();"));
  assert.ok(stop.includes("write: async (id, before, next) => (await db.job.updateMany({ where: { id, status: \"IN_PROGRESS\", payload: before }, data: { payload: next } })).count,"));
  assert.ok(stop.includes("deadlineMs,\n  ).catch(() => null);"));
  assert.ok(!/status:\s*"(PENDING|FAILED|COMPLETED)"/.test(stop), "the running jobs' status is never touched");
  // the worker: once, on SIGTERM; nothing new from the tick, the post-queue timer, or the picture lane's backfill
  assert.ok(worker.includes('process.once("SIGTERM", () => {'));
  assert.ok(worker.includes('stopTakingJobs("deploy")'));
  assert.ok(worker.includes("function tick() {\n  // A PROCESS TOLD TO STOP STARTS NOTHING NEW"));
  assert.ok(worker.includes("  if (stopSwitch.stopped()) return;\n  void chores();\n  for (const drain of drains) void drain();\n}"));
  assert.ok(worker.includes("setInterval(() => { if (!stopSwitch.stopped()) tickPostQueue()"));
  const lane = worker.slice(worker.indexOf("const drains = LANES.map("), worker.indexOf("function tick()"));
  assert.ok(lane.indexOf("if (stopSwitch.stopped()) return;") < lane.indexOf('if (lane === "picture") await backfillDeadImages()'));
  // and nothing in it ends the process or makes it wait: Render does that
  const handler = worker.slice(worker.indexOf('process.once("SIGTERM"'));
  assert.ok(!/process\.exit/.test(handler));
  // a new run's claim takes an old run's stop mark off (job-stall.ts → A DEPLOY IS NOT A STALL)
  assert.ok(q.includes("p.__startedAt = new Date().toISOString();\n    // A NEW RUN IS NOT LET OFF FOR AN OLD RUN'S DEPLOY"));
  assert.ok(q.includes("    for (const k of STOP_MARKS) delete p[k];\n    const stamped = JSON.stringify(p);"));
});
