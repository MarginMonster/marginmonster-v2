/* A JOB THAT TAKES THE SERVER DOWN IS NOT TRIED FOREVER (app/lib/job-stall.ts).
 * 2026-11-25: a tester's 12-scene told story ran the 2 GB server out of memory in its final cut at 12:14, 12:42, 1:10
 * and 1:39 PM ET — each restart handed it back, it resumed from its checkpoints, and died three minutes later in the
 * same cut, taking every other member's render with it. Handed back twice in a row with no new checkpoint, a job is
 * now failed and refunded; a deploy in the middle of a long encode is not enough to kill a healthy one. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STALLED_REASON, STALLS_TO_FAIL, checkpointKeys, checkpointSig, isHeartbeat, lastCheckpoint, onReclaim, reclaimStall, stalledLog, withoutStallMarks,
} from "../app/lib/job-stall.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

/** A TEST told story's payload as it stood when its cut began: twelve clips made, the voice, the pictures. */
const told = (): Record<string, unknown> => ({
  contentType: "film", filmTemplate: "horror", filmMode: "narrated", filmScenes: 12, prePaid: true, chargedTokens: 150, __jobId: "job_TEST_1",
  ckTreatment: JSON.stringify({ title: "TEST — The Night Ferry", scenes: Array.from({ length: 12 }, (_, i) => ({ visual: `test scene ${i + 1}` })) }),
  ckVoPath: "/renders/vo-test.mp3", ckWords: "[]", ckImages: JSON.stringify(Array.from({ length: 12 }, (_, i) => `/renders/test-still-${i}.jpg`)),
  ckMusic: "/renders/bed-test.mp3", ckMotion: JSON.stringify(Array.from({ length: 12 }, (_, i) => `/renders/test-motion-${i}.mp4`)),
  ckBeat: 1764090000000,
});

/** What the reaper does to a row it hands back (job-queue.server.ts → reclaimOrphanJobs): the payload it writes, and
 *  whether the row is FAILED instead. */
const reap = (payload: string) => {
  const r = onReclaim(payload);
  return { ...r, failed: !!r.stall?.stuck };
};

test("THE INCIDENT, replayed: a job that dies at the same step is failed at the second stall — two tries after the crash, never a third", () => {
  assert.equal(STALLS_TO_FAIL, 2);
  let payload = JSON.stringify(told());
  // crash 1 (the first run's cut): handed back — nothing to compare with yet
  let r = reap(payload);
  assert.equal(r.failed, false);
  assert.equal(r.stall?.stalls, 0);
  assert.equal(r.reclaims, 0);
  payload = r.payload;
  // try 1: resumed, it writes a heartbeat before the cut (narrated-story.server.ts → beat) — and dies in the cut again
  payload = JSON.stringify({ ...JSON.parse(payload), ckBeat: 1764091800000, __startedAt: "2026-11-25T17:42:00.000Z" });
  r = reap(payload);
  assert.equal(r.failed, false, "one stall is not a loop");
  assert.equal(r.stall?.stalls, 1);
  payload = r.payload;
  // try 2: the same
  payload = JSON.stringify({ ...JSON.parse(payload), ckBeat: 1764093600000, __startedAt: "2026-11-25T18:10:00.000Z" });
  r = reap(payload);
  assert.equal(r.failed, true, "two stalls in a row: FAILED, not tried a third time");
  assert.equal(r.stall?.stalls, 2);
  assert.equal(r.reclaims, 2, "three restarts in all, where MAX_RECLAIMS let it have seven");
  // the step it was stuck after — its newest checkpoint, the heartbeat not counted
  assert.equal(r.stall?.after, "ckMotion");
});

test("PROGRESS is not a stall: a new checkpoint between two restarts starts the count again", () => {
  let payload = JSON.stringify(told());
  payload = reap(payload).payload; // a deploy: handed back, nothing to compare
  // resumed, it makes the next thing (a new checkpoint) — and a second deploy lands
  payload = JSON.stringify({ ...JSON.parse(payload), ckCut: "/renders/test-cut.mp4" });
  let r = reap(payload);
  assert.equal(r.stall?.stalls, 0);
  assert.equal(r.failed, false);
  payload = r.payload;
  // a checkpoint whose VALUE moved is progress too (a told story's motion list filling in clip by clip)
  const motion = JSON.parse(JSON.parse(payload).ckMotion);
  motion[11] = "/renders/test-motion-11b.mp4";
  payload = JSON.stringify({ ...JSON.parse(payload), ckMotion: JSON.stringify(motion) });
  r = reap(payload);
  assert.equal(r.stall?.stalls, 0);
  // …then one stall, then progress, then one stall: never two IN A ROW, never failed
  payload = reap(r.payload).payload;
  assert.equal(JSON.parse(payload).__stalls, 1);
  payload = JSON.stringify({ ...JSON.parse(payload), ckFa: "asset_TEST" });
  r = reap(payload);
  assert.equal(r.stall?.stalls, 0);
  r = reap(r.payload);
  assert.equal(r.stall?.stalls, 1);
  assert.equal(r.failed, false);
});

test("A DEPLOY MID-ENCODE, ONCE, never kills a healthy job — the first hand-back has nothing to compare with", () => {
  // a job handed back for the first time, in the middle of its longest encode
  const r = reap(JSON.stringify(told()));
  assert.equal(r.failed, false);
  assert.deepEqual([r.stall?.stalls, r.stall?.stuck], [0, false]);
  // …and once more after a resume that made progress, mid-encode again: still alive
  const resumed = JSON.stringify({ ...JSON.parse(r.payload), ckCut: "/renders/test-part1.mov" });
  const again = reap(resumed);
  assert.equal(again.failed, false);
  // even a second restart in the very same encode (one stall) is let through: only the third is a loop
  const third = reap(again.payload);
  assert.deepEqual([third.stall?.stalls, third.failed], [1, false]);
});

test("the fingerprint: checkpoints only, heartbeats and the queue's own marks left out, the same work the same however it is written", () => {
  assert.ok(isHeartbeat("ckBeat") && isHeartbeat("ckFbeat"));
  assert.ok(!isHeartbeat("ckFm0") && !isHeartbeat("ckTreatment"));
  const p = told();
  assert.deepEqual(checkpointKeys(p), ["ckTreatment", "ckVoPath", "ckWords", "ckImages", "ckMusic", "ckMotion"]);
  const sig = checkpointSig(p);
  assert.match(sig, /^[0-9a-f]{16}$/);
  // a heartbeat, a start stamp, the reaper's own counts, a refund flag: none of them is progress
  assert.equal(checkpointSig({ ...p, ckBeat: 2, ckFbeat: 3, __startedAt: "x", __reclaims: 4, __ckSig: "y", __stalls: 1, prePaid: false, refunded: true }), sig);
  // the same checkpoints in another order are the same work
  const shuffled = Object.fromEntries(Object.entries(p).reverse());
  assert.equal(checkpointSig(shuffled), sig);
  // a checkpoint added, or one whose value changed, is not
  assert.notEqual(checkpointSig({ ...p, ckCut: "x" }), sig);
  assert.notEqual(checkpointSig({ ...p, ckMusic: "/renders/other.mp3" }), sig);
  // the found-footage film's moments (ckFm0, ckFm1 …) and its join (ckFj) are checkpoints
  assert.deepEqual(checkpointKeys({ ckFo: "{}", ckFm0: "{}", ckFm1: "{}", ckFbeat: 1, ckFj: "{}" }), ["ckFo", "ckFm0", "ckFm1", "ckFj"]);
  // a key that merely starts with the letters is not one ("ckx", "checked")
  assert.deepEqual(checkpointKeys({ ckx: 1, checked: true, ck: 2 }), []);
  // where it was stuck: the newest checkpoint, or none yet
  assert.equal(lastCheckpoint(p), "ckMotion");
  assert.equal(lastCheckpoint({ ckBeat: 1, prePaid: true }), null);
  // a job with no checkpoint at all, handed back twice more with still none, is stuck too — "before its first"
  let payload = JSON.stringify({ contentType: "film", prePaid: true });
  payload = reap(payload).payload;
  payload = reap(payload).payload;
  const r = reap(payload);
  assert.equal(r.failed, true);
  assert.equal(r.stall?.after, null);
});

test("the marks the reaper writes: the restart counted as always, the fingerprint and the stalls beside it — and a payload it cannot read left exactly as it is", () => {
  const r = onReclaim(JSON.stringify({ ...told(), __reclaims: 3 }));
  const out = JSON.parse(r.payload);
  assert.equal(r.reclaims, 3);
  assert.equal(out.__reclaims, 4, "restarts are still counted apart from tries");
  assert.equal(out.__ckSig, checkpointSig(told()));
  assert.equal(out.__stalls, 0);
  // everything else in the payload is untouched — its checkpoints above all
  for (const [k, v] of Object.entries(told())) assert.deepEqual(out[k], v, k);
  // a stall count that is nonsense is read as none
  assert.equal(reclaimStall({ ...told(), __ckSig: checkpointSig(told()), __stalls: "lots" }).stalls, 1);
  assert.equal(reclaimStall({ ...told(), __ckSig: checkpointSig(told()), __stalls: -4 }).stalls, 1);
  // not JSON, or not an object: as it was, no count, no answer (the old path: "reclaims stays 0")
  for (const bad of ["not json", "null", "42", "[1,2]"]) assert.deepEqual(onReclaim(bad), { payload: bad, reclaims: 0, stall: null }, bad);
});

test("A RETRY STARTS ITS COUNT AFRESH: a job the rule ended, tried again from the Archive, is never failed by its first restart (review, 2026-11-25)", () => {
  // web.archive.tsx → retry: refunded → the payload kept without its ck* keys; not refunded → kept as it is
  const retried = (ended: string, refunded: boolean): string => {
    const p = JSON.parse(ended) as Record<string, unknown>;
    return JSON.stringify(refunded ? Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith("ck"))) : p);
  };
  // the reaper's three hand-backs of a job that loops; the third ends it, and what it WRITES is the payload it read,
  // its marks taken off (job-queue.server.ts → reclaimOrphanJobs, the dead branch)
  const loop = (start: string): string => {
    let payload = reap(start).payload;
    payload = reap(payload).payload;
    const third = reap(payload);
    assert.equal(third.failed, true);
    return withoutStallMarks(payload);
  };
  for (const [what, start, refunded] of [
    ["a job with no checkpoint at all, refunded", JSON.stringify({ contentType: "film", prePaid: true }), true],
    ["a told story with its checkpoints, refunded", JSON.stringify(told()), true],
    ["a told story with its checkpoints, nothing refunded (a free one)", JSON.stringify({ ...told(), freeGen: true }), false],
  ] as const) {
    const ended = loop(start);
    assert.ok(!("__ckSig" in JSON.parse(ended)) && !("__stalls" in JSON.parse(ended)), `${what}: no marks left on the ended row`);
    // the retry is handed back once, before it has made anything new (a deploy): one restart, never a loop
    const first = reap(retried(ended, refunded));
    assert.deepEqual([first.stall?.stalls, first.failed], [0, false], what);
    // …and its own loop is still caught: two more hand-backs at the same step end it
    const second = reap(first.payload);
    assert.equal(second.failed, false, what);
    assert.equal(reap(second.payload).failed, true, what);
  }
  // without the marks taken off, the same retry WAS failed by its first restart — the defect this guards
  const kept = (() => { let p = reap(JSON.stringify({ contentType: "film", prePaid: true })).payload; p = reap(p).payload; return p; })();
  assert.equal(reap(retried(kept, true)).failed, true);
  // only the two marks go; everything else, the restart count included, is as it was; anything unreadable untouched
  const marked = JSON.stringify({ ...told(), __reclaims: 2, __ckSig: "abc", __stalls: 1 });
  assert.deepEqual(JSON.parse(withoutStallMarks(marked)), { ...told(), __reclaims: 2 });
  const plain = JSON.stringify(told());
  assert.equal(withoutStallMarks(plain), plain, "no marks: the very same string");
  for (const bad of ["not json", "null", "42", "[1,2]"]) assert.equal(withoutStallMarks(bad), bad);
});

test("what the member reads and what the operator's log says", () => {
  assert.equal(STALLED_REASON, "It stopped twice at the same step and was not tried a third time — hit ROLL CAMERA to try again.");
  assert.equal(
    stalledLog({ id: "job_TEST_1", type: "GENERATE_VIDEO_AD", after: "ckMotion", reclaims: 3 }),
    "[worker] job job_TEST_1 (GENERATE_VIDEO_AD) stopped twice in a row with no progress — stuck after checkpoint ckMotion, restart 3 — FAILED and refunded, not tried a third time",
  );
  assert.ok(stalledLog({ id: "j", type: "EDIT_VIDEO", after: null, reclaims: 3 }).includes("stuck after its start (no checkpoint yet)"));
});

test("THE REAPER IS WIRED TO IT: the rule's answer fails the row, with its reason, refunded the way a job out of restarts is — and the write is still conditional", () => {
  const q = read("app", "lib", "job-queue.server.ts");
  const reaper = q.slice(q.indexOf("export async function reclaimOrphanJobs("), q.indexOf("export async function enqueueJob("));
  assert.ok(q.includes('import { STALLED_REASON, onReclaim, stalledLog, withoutStallMarks } from "./job-stall";'));
  assert.ok(reaper.includes("const { payload: bumpedPayload, reclaims, stall } = onReclaim(j.payload);"));
  assert.ok(reaper.includes("const looped = !!stall?.stuck;\n    const dead = j.attempts >= MAX_ATTEMPTS || reclaims >= MAX_RECLAIMS || looped;"));
  assert.ok(reaper.includes('const why = looped ? STALLED_REASON : "Interrupted by a server restart — hit ROLL CAMERA to try again.";'));
  // still pinned to the snapshot: a job that checkpointed a second after the scan is alive — hands off
  // (a row it ends leaves without the rule's marks — review, 2026-11-25: a retry keeps the payload)
  assert.ok(reaper.includes('where: { id: j.id, status: "IN_PROGRESS", updatedAt: j.updatedAt },\n      data: dead\n        ? { status: "FAILED", lastError: why, payload: withoutStallMarks(j.payload) }\n        : { status: "PENDING", attempts: Math.max(0, j.attempts - 1), payload: bumpedPayload },'));
  // the operator's line, only for a row this reaper actually ended
  const claimedAt = reaper.indexOf("if (claimed.count !== 1) continue;");
  const logAt = reaper.indexOf("if (looped && stall) console.error(stalledLog({ id: j.id, type: j.type, after: stall.after, reclaims: reclaims + 1 }));");
  assert.ok(claimedAt > 0 && logAt > claimedAt);
  // refunded EXACTLY as the dead path always was — the same block, the questline told, a forge's card ended
  const deadAt = reaper.indexOf("if (dead) {\n      await refundPrepaidOnce(j);");
  assert.ok(deadAt > logAt);
  assert.ok(reaper.includes('await markForgeFailed(j, looped ? "It stopped twice at the same step — forge it again." : "Interrupted by a server restart — forge it again.");'));
  assert.ok(reaper.includes("try { await maybeTickQuestline(JSON.parse(j.payload), j.shopId, false); } catch { /* non-fatal */ }"));
  // the restart cap stays as the backstop
  assert.ok(q.includes("const MAX_RECLAIMS = 6;"));
});
