/* THE POSTING QUEUE — "Add any piece to your queue and it posts itself at the next good time."
 *
 * Added 2026-11-22. Rivals (Buffer, Later) are built around a queue; ours lives on the Auto-post page as
 * "Coming up", with one setting (posts per day) and one list.
 *
 *   1. THE CLOCK (app/lib/post-queue.ts, pure) is RUN here: each posts-per-day, the shop's own zone (DST
 *      included), never sooner than ten minutes from now, taken slots skipped, new pieces behind old.
 *   2. THE SENDING (app/lib/post-queue.server.ts) posts publicly to people's real accounts, and a double
 *      post is the worst thing it could do. It cannot run without a database, so the load-bearing lines
 *      are pinned by reading the source: the claim comes before the post, a stuck POSTING row becomes
 *      FAILED "interrupted" and is never put back to PENDING by the machine, every member action is
 *      scoped to the shop, and the worker calls the tick.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QUEUE_MIN_LEAD_MS, QUEUE_SLOT_TIMES, addDays, dayBucket, nextFreeSlots, normalizePerDay } from "../app/lib/post-queue.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const iso = (ds: Date[]) => ds.map((d) => d.toISOString());
const NOW = Date.parse("2026-11-22T10:00:00Z");

// ── 1. the clock ─────────────────────────────────────────────────────────────────────────────────────

test("the good hours: 1 a day at 18:00, 2 at 12:00 and 18:00, 3 at 09:00, 13:00 and 19:00", () => {
  assert.deepEqual(QUEUE_SLOT_TIMES, { 1: ["18:00"], 2: ["12:00", "18:00"], 3: ["09:00", "13:00", "19:00"] });
  assert.equal(QUEUE_MIN_LEAD_MS, 10 * 60_000);
});

test("one a day — the next three evenings (UTC shop)", () => {
  assert.deepEqual(iso(nextFreeSlots({ now: NOW, tz: null, perDay: 1, count: 3 })), [
    "2026-11-22T18:00:00.000Z", "2026-11-23T18:00:00.000Z", "2026-11-24T18:00:00.000Z",
  ]);
});

test("two a day — lunch and evening", () => {
  assert.deepEqual(iso(nextFreeSlots({ now: NOW, tz: "UTC", perDay: 2, count: 4 })), [
    "2026-11-22T12:00:00.000Z", "2026-11-22T18:00:00.000Z", "2026-11-23T12:00:00.000Z", "2026-11-23T18:00:00.000Z",
  ]);
});

test("three a day — a morning slot already gone today is not handed out", () => {
  assert.deepEqual(iso(nextFreeSlots({ now: NOW, tz: "UTC", perDay: 3, count: 4 })), [
    "2026-11-22T13:00:00.000Z", "2026-11-22T19:00:00.000Z", "2026-11-23T09:00:00.000Z", "2026-11-23T13:00:00.000Z",
  ]);
});

test("never sooner than ten minutes from now", () => {
  const at = (now: string) => nextFreeSlots({ now: Date.parse(now), tz: "UTC", perDay: 1, count: 1 })[0].toISOString();
  assert.equal(at("2026-11-22T17:50:00Z"), "2026-11-22T18:00:00.000Z"); // exactly ten minutes: allowed
  assert.equal(at("2026-11-22T17:50:01Z"), "2026-11-23T18:00:00.000Z"); // nine and a bit: tomorrow
  assert.equal(at("2026-11-22T17:59:00Z"), "2026-11-23T18:00:00.000Z");
  assert.equal(at("2026-11-22T18:30:00Z"), "2026-11-23T18:00:00.000Z");
});

test("the shop's own zone: 18:00 is the shop's evening, not the server's", () => {
  const first = (tz: string) => nextFreeSlots({ now: NOW, tz, perDay: 1, count: 1 })[0].toISOString();
  // Karachi is UTC+5: 15:00 local now, so 18:00 local today = 13:00Z
  assert.equal(first("Asia/Karachi"), "2026-11-22T13:00:00.000Z");
  // Los Angeles is UTC-8 in November: 02:00 local now, so 18:00 local on the 22nd = 02:00Z on the 23rd
  assert.equal(first("America/Los_Angeles"), "2026-11-23T02:00:00.000Z");
  // Sydney is UTC+11 in November: 21:00 local now, so today's 18:00 has gone — tomorrow's = 07:00Z
  assert.equal(first("Australia/Sydney"), "2026-11-23T07:00:00.000Z");
});

test("across a DST change the wall time holds (Los Angeles springs forward on 8 March 2026)", () => {
  assert.deepEqual(iso(nextFreeSlots({ now: Date.parse("2026-03-07T12:00:00Z"), tz: "America/Los_Angeles", perDay: 1, count: 2 })), [
    "2026-03-08T02:00:00.000Z", // 18:00 PST on the 7th
    "2026-03-09T01:00:00.000Z", // 18:00 PDT on the 8th
  ]);
});

test("an unknown zone is treated as UTC rather than failing", () => {
  assert.deepEqual(iso(nextFreeSlots({ now: NOW, tz: "Mars/Olympus", perDay: 1, count: 1 })), ["2026-11-22T18:00:00.000Z"]);
});

test("taken slots are skipped, to the minute", () => {
  const taken = ["2026-11-22T12:00:00.000Z", new Date("2026-11-22T18:00:30Z")];
  assert.deepEqual(iso(nextFreeSlots({ now: NOW, tz: "UTC", perDay: 2, count: 2, taken })), [
    "2026-11-23T12:00:00.000Z", "2026-11-23T18:00:00.000Z",
  ]);
});

test("a new piece goes behind the last one waiting, even if an earlier slot is free", () => {
  assert.deepEqual(iso(nextFreeSlots({ now: NOW, tz: "UTC", perDay: 2, count: 2, after: "2026-11-25T12:00:00Z" })), [
    "2026-11-25T18:00:00.000Z", "2026-11-26T12:00:00.000Z",
  ]);
});

test("sixty pieces at one a day are sixty consecutive evenings", () => {
  const s = nextFreeSlots({ now: NOW, tz: "Asia/Karachi", perDay: 1, count: 60 });
  assert.equal(s.length, 60);
  for (let i = 1; i < s.length; i++) assert.equal(s[i].getTime() - s[i - 1].getTime(), 86_400_000);
});

test("nothing asked, nothing given", () => {
  assert.deepEqual(nextFreeSlots({ now: NOW, tz: "UTC", perDay: 1, count: 0 }), []);
});

test("posts per day is 1, 2 or 3 — anything else is 1", () => {
  assert.equal(normalizePerDay("2"), 2);
  assert.equal(normalizePerDay(3), 3);
  for (const v of [0, 4, "x", null, undefined, -1, 2.5]) assert.equal(normalizePerDay(v), 1);
});

test("rows group by the shop's day: Today, Tomorrow, then the date", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(dayBucket("2026-11-22T18:00:00Z", NOW, "UTC"), "today");
  assert.equal(dayBucket("2026-11-23T18:00:00Z", NOW, "UTC"), "tomorrow");
  assert.equal(dayBucket("2026-11-24T18:00:00Z", NOW, "UTC"), "2026-11-24");
  // 02:00Z on the 23rd is still the evening of the 22nd in Los Angeles
  assert.equal(dayBucket("2026-11-23T02:00:00Z", NOW, "America/Los_Angeles"), "today");
});

// ── 2. the sending, pinned ───────────────────────────────────────────────────────────────────────────

const q = read("app", "lib", "post-queue.server.ts");
const pa = read("app", "lib", "post-asset.server.ts");
const pure = read("app", "lib", "post-queue.ts");
const worker = read("app", "worker.server.ts");
const route = read("app", "routes", "web.autopost.tsx");

test("the clock is pure — no database", () => {
  assert.ok(!/db\.server/.test(pure));
  assert.ok(!/from "\.\.\/db/.test(pure));
});

test("a row is CLAIMED (PENDING → POSTING, count === 1) before anything is posted", () => {
  const send = q.slice(q.indexOf("async function sendOne"));
  const claim = send.indexOf('where: { id: row.id, status: "PENDING" },\n    data: { status: "POSTING"');
  const gate = send.indexOf("if (claim.count !== 1) return;");
  const post = send.indexOf("postAssetToSocials(");
  assert.ok(claim > 0, "the conditional claim");
  assert.ok(gate > claim, "only the claimer continues");
  assert.ok(post > gate, "the post comes after the claim");
  // every write after the post is pinned to the claimed state
  assert.ok(send.includes('db.scheduledPost.updateMany({ where: { id: row.id, status: "POSTING" }, data: done })'));
  assert.ok(send.includes('db.scheduledPost.updateMany({ where: { id: row.id, status: "POSTING" }, data: { status: "FAILED"'));
});

test("a row stuck in POSTING for 15 minutes becomes FAILED 'interrupted' — never PENDING again by itself", () => {
  assert.ok(q.includes("export const POSTING_STUCK_MS = 15 * 60_000;"));
  assert.ok(q.includes('where: { status: "POSTING", updatedAt: { lt: new Date(now - POSTING_STUCK_MS) } }'));
  assert.ok(q.includes(': { status: "FAILED", error: "interrupted" }'));
  // The ONLY write that makes a row PENDING again is the member's own "Try again", on a FAILED row.
  assert.equal(q.split('status: "PENDING", dueAt: new Date(), error: null').length - 1, 1);
  assert.ok(q.includes('where: { id, shopId, status: "FAILED" },\n    data: { status: "PENDING", dueAt: new Date(), error: null }'));
  assert.ok(!/data:\s*\{\s*status:\s*"PENDING"/.test(q.replace('data: { status: "PENDING", dueAt: new Date(), error: null }', "")));
});

test("every member action is scoped to the shop", () => {
  for (const fn of ["queueRemove", "queuePostNow", "queueRetry"]) {
    const body = q.slice(q.indexOf(`export async function ${fn}`), q.indexOf("\n}\n", q.indexOf(`export async function ${fn}`)));
    assert.ok(/where: \{ id, shopId, status:/.test(body), `${fn} is scoped by shopId`);
  }
  assert.ok(q.includes("where: { id: seriesId, shopId, status: \"ACTIVE\", nextRunAt: s.nextRunAt }"), "skip is pinned to the nextRunAt read");
  assert.ok(q.includes('db.asset.findMany({ where: { id: { in: ids }, shopId, type: { in: ["VIDEO_AD", "IMAGE_AD"] } }'));
  assert.ok(pa.includes('db.asset.findFirst({ where: { id, shopId, type: { in: ["VIDEO_AD", "IMAGE_AD"] } } })'));
  // the route takes the shop from the session, never from the form
  const action = route.slice(route.indexOf("export const action"));
  assert.ok(action.includes("const { shop } = await requireWebIdentity(request);"));
  for (const intent of ["queueAdd", "queueRemove", "queuePostNow", "queueRetry", "queuePerDay", "skipDrop"]) {
    assert.ok(action.includes(`intent === "${intent}"`), intent);
  }
  assert.ok(action.includes("queueAdd(shop.id, field(\"assetIds\"))"));
});

test("a piece already waiting is skipped, and the queue holds 60 at most", () => {
  assert.ok(q.includes("const already = new Set(waiting.map((w) => w.assetId));"));
  assert.ok(q.includes(".filter((id) => hasMedia.has(id) && !already.has(id)).slice(0, room)"));
  assert.ok(pure.includes("export const QUEUE_CAP = 60;"));
});

test("the worker sends the queue right after the channels, non-fatally", () => {
  const series = worker.indexOf('await tickDueSeries().catch((e) => console.error("[worker] series tick (non-fatal):", e));');
  const queue = worker.indexOf('await tickPostQueue().catch((e) => console.error("[worker] post queue (non-fatal):", e));');
  assert.ok(series > 0 && queue > series);
  assert.ok(worker.includes('import { tickPostQueue } from "./lib/post-queue.server";'));
});

test("posting one piece matches the Archive: no absolutised media, the #EasyModeAi tag, the go-link", () => {
  assert.ok(pa.includes("const mediaUrl = media;"));
  assert.ok(!/new URL\(/.test(pa) && !/mediaUrl = `\$\{/.test(pa), "the stored /renders path goes to publishPost as-is");
  assert.ok(pa.includes("? capBase : `${capBase}\\n\\n#${AI_DISCLOSURE_TAG}`"));
  assert.ok(pa.includes("const goUrl = `${base}/go/a/${id}`;"));
  // the networks are the one shared list, and a picture is never sent to a video-only network
  assert.ok(pa.includes("import { POSTABLE_PLATFORMS as ALL_NETWORKS, takes } from \"./social-networks\";"));
  assert.ok(pa.includes("export const POSTABLE_PLATFORMS: readonly string[] = ALL_NETWORKS;"));
  assert.ok(pa.includes(".filter((p) => takes(p, asset.type === \"VIDEO_AD\"));"));
  assert.ok(pa.includes("titleFor = (p) => buildPostTitle(captions[p], goUrl, fbText, credit, p);"), "each network gets text fitted to its own limit");
  assert.ok(pa.includes('where: { id, metaJson: fresh.metaJson },'));
});
