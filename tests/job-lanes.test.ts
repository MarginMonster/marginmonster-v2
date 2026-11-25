/* A FILM IN THE MAKING NO LONGER HOLDS UP A PICTURE, A SIGN-UP OR A SCHEDULED POST.
 *
 * 2026-11-23: the worker ran one job at a time for the whole site, of any kind. While one member's film
 * rendered, a second member's job waited behind it, and behind both stood every picture, song, catalogue
 * import and welcome email on the site — and the scheduled posts too, because the chores only ran when a
 * tick began and a tick awaited whole renders.
 *
 * The rule had a reason — two VIDEO renders at once took the server down on 2026-11-03 — and the reason
 * is kept exactly: never two renders at once, and never two encodes at once of any kind. What changed is
 * that a picture and a paragraph are no longer treated as renders.
 *
 *   1. which lane a job runs in (and that a job nobody thought about runs in the careful one)
 *   2. members take turns
 *   3. one encode at a time, whoever asks — and a turn that never ends does not stop the rest for good
 *   4. the memory readings the status page gives
 *   5. the queue, the worker and the three runners are wired to all of it */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DESK_TYPES, LANES, LANE_LOOKAHEAD, PICTURE_TYPES, RETRY_REST_MS, STORY_MARK, aheadInLine, claimNext, laneOf, laneWhere, lineOrder, resting, storyKindOf, takeTurns, type LaneWhere } from "../app/lib/job-lanes.ts";
import { FFMPEG_TURN_WAIT_MS, TURN_BEAT_MS, asJob, ffmpegTurn, ffmpegTurnAlways, ffmpegTurns, inJob } from "../app/lib/ffmpeg-turn.ts";
import { queuedJob, queuedKindFits, stageFailureFits, stageJobFits, stageKindFits, stagePieceFits } from "../app/lib/stage-kind.ts";
import { KEEP_MINUTES, foldSample, memoryNow, oneNumber, statLine } from "../app/lib/memwatch.server.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

// ---- 1. lanes ---------------------------------------------------------------------------------------------

const schema = read("prisma", "schema.prisma");
const enumBody = schema.slice(schema.indexOf("enum JobType {"), schema.indexOf("}", schema.indexOf("enum JobType {")));
const JOB_TYPES = enumBody.split("\n").map((l) => l.trim()).filter((l) => /^[A-Z_]+$/.test(l));

test("every kind of job has a lane, and the lists name only kinds that exist", () => {
  assert.ok(JOB_TYPES.length >= 17, `read ${JOB_TYPES.length} job types out of the schema`);
  for (const t of [...PICTURE_TYPES, ...DESK_TYPES]) assert.ok(JOB_TYPES.includes(t), `${t} is not a job type — the database would refuse the lane's filter`);
  assert.equal(new Set([...PICTURE_TYPES, ...DESK_TYPES]).size, PICTURE_TYPES.length + DESK_TYPES.length, "no kind is in two lanes");
  // THE RENDER LANE IS WHAT IS LEFT. Pinned by name: a new kind of job lands here by default, and this
  // list failing is the moment to decide whether it really encodes video.
  const render = JOB_TYPES.filter((t) => laneOf(t) === "render").sort();
  assert.deepEqual(render, ["EDIT_VIDEO", "GENERATE_AD_COPY", "GENERATE_VIDEO_AD", "REGEN_SHOT"]);
  assert.equal(laneOf("GENERATE_IMAGE_AD"), "picture");
  assert.equal(laneOf("GENERATE_SONG"), "picture");
  assert.equal(laneOf("FORGE_CUSTOM_AVATAR"), "picture");
  assert.equal(laneOf("IMPORT_CATALOG"), "desk");
  assert.equal(laneOf("GENERATE_BRAND_PROFILE"), "desk");
  assert.equal(laneOf("SEND_WELCOME"), "desk");
  assert.equal(laneOf("SOMETHING_NOBODY_LISTED"), "render", "the careful lane is the default");
  assert.deepEqual([...LANES], ["render", "story", "picture", "desk"]);
});

/** What the database does with a lane's filter, done here: type (a name, a list, or "not in" a list), the
 *  payload containing a piece of text, and NOT — which is "not BOTH": this kind of job AND that text. (A
 *  video edit that carried the text is still a render; written as a bare "does not contain", it was
 *  selected by no lane at all — this test is what found that.) */
function selects(where: LaneWhere, job: { type: string; payload?: string | null }): boolean {
  const t = where.type;
  const typeOk = typeof t === "string" ? job.type === t : "in" in t ? t.in.includes(job.type) : !t.notIn.includes(job.type);
  const text = job.payload || "";
  return typeOk && (!where.payload || text.includes(where.payload.contains)) && (!where.NOT || !(job.type === where.NOT.type && text.includes(where.NOT.payload.contains)));
}

test("a lane's filter selects its own jobs — every job by exactly one lane", () => {
  assert.deepEqual(laneWhere("picture"), { type: { in: [...PICTURE_TYPES] } });
  assert.deepEqual(laneWhere("desk"), { type: { in: [...DESK_TYPES] } });
  assert.deepEqual(laneWhere("story"), { type: "GENERATE_VIDEO_AD", payload: { contains: STORY_MARK } });
  assert.deepEqual(laneWhere("render"), { type: { notIn: [...PICTURE_TYPES, ...DESK_TYPES] }, NOT: { type: "GENERATE_VIDEO_AD", payload: { contains: STORY_MARK } } });
  const story = JSON.stringify({ section: "creator", contentType: "film", filmMode: "narrated", filmTemplate: "horror", __lane: "story" });
  const film = JSON.stringify({ section: "creator", contentType: "film", filmTemplate: "horror" });
  // every kind of job, with a film's payload, with a story's, and with none: one lane each, and the one laneOf names
  for (const t of JOB_TYPES) {
    for (const payload of [film, story, null]) {
      const hits = LANES.filter((lane) => selects(laneWhere(lane), { type: t, payload }));
      assert.deepEqual(hits, [laneOf(t, payload)], t + " " + (payload || "").slice(0, 40));
    }
  }
  assert.equal(laneOf("GENERATE_VIDEO_AD", story), "story");
  assert.equal(laneOf("GENERATE_VIDEO_AD", film), "render");
  assert.equal(laneOf("GENERATE_VIDEO_AD"), "render", "a video job nobody can read is a render");
  assert.equal(laneOf("EDIT_VIDEO", story), "render", "only the kind of job that can be a story is asked");
  assert.equal(laneOf("GENERATE_IMAGE_AD", story), "picture");
});

test("a story is known by the worker's own two tests, and the mark cannot be typed", () => {
  const narratable = (k: string | undefined) => !!k && ["horror", "moral", "kidstv", "testmovie"].includes(k);
  assert.equal(storyKindOf({ contentType: "faceless" }, narratable), "faceless");
  assert.equal(storyKindOf({ contentType: "film", filmMode: "narrated", filmTemplate: "horror" }, narratable), "narrated");
  assert.equal(storyKindOf({ contentType: "film", filmTemplate: "horror" }, narratable), null, "the same format, acted: a film");
  assert.equal(storyKindOf({ contentType: "film", filmMode: "narrated", filmTemplate: "musicvideo" }, narratable), null, "told by a narrator only where the format can be");
  assert.equal(storyKindOf({ contentType: "film", filmMode: "narrated" }, narratable), null);
  assert.equal(storyKindOf({ contentType: "commercial" }, narratable), null);
  // (a found-footage take runs beside the films, not behind one: one short clip and an overlay — 2026-11-25)
  assert.equal(storyKindOf({ contentType: "take" }, narratable), "take");
  assert.equal(storyKindOf({}, narratable), null);
  // the mark is the field as JSON.stringify writes it…
  assert.ok(JSON.stringify({ a: 1, __lane: "story" }).includes(STORY_MARK));
  // …and a member cannot spell it: a quote inside anything they type is escaped
  const typed = JSON.stringify({ contentType: "film", filmTopic: 'my story "__lane":"story" please', approvedTreatment: { title: '"__lane":"story"' } });
  assert.ok(!typed.includes(STORY_MARK));
  assert.equal(laneOf("GENERATE_VIDEO_AD", typed), "render");
  // decided when the job is queued, with those tests, and decided AGAIN for a payload queued a second time
  assert.ok(queue.includes("payload: JSON.stringify(await withLane(type, payload)),"));
  const lane = queue.slice(queue.indexOf("async function withLane("), queue.indexOf("export async function processNextJob"));
  assert.ok(lane.includes('if (type !== "GENERATE_VIDEO_AD") return payload;'));
  assert.ok(lane.includes("const { __lane: _decidedBefore, ...rest } = payload;"), "an old mark is not trusted");
  assert.ok(lane.includes('return storyKindOf(rest, narrates) ? { ...rest, __lane: "story" } : rest;'));
  assert.ok(lane.includes("return rest; // could not tell: the careful lane"));
  // the worker's dispatch is still those two tests, word for word
  assert.ok(queue.includes('if (payload.contentType === "faceless") {'));
  assert.ok(queue.includes('if (payload.contentType === "film") {'));
  assert.ok(queue.includes('if (payload.filmMode === "narrated" && canNarrate(ft)) {'));
  // and the story lane asks once more before it runs anything: a film can never run there
  const guard = queue.slice(queue.indexOf('if (lane === "story") {'), queue.indexOf("// EVERYTHING THIS JOB DOES IS A JOB'S WORK"));
  assert.ok(guard.includes("if (!storyKindOf(payload, canNarrate)) {"));
  assert.ok(guard.includes('data: { status: "PENDING", attempts: { decrement: 1 }, payload: JSON.stringify(unmarked) },'), "back to waiting, its try handed back, the mark gone");
  assert.ok(guard.includes("const { __lane: _mark, __jobId: _id, ...unmarked } = payload;"));
  assert.ok(guard.includes("return true;"));
});

test("a story does not wait behind a film — and two stories still take turns", async () => {
  const film = (id: string, shop: string, m: number): Row => ({ ...row(id, shop, "GENERATE_VIDEO_AD", m), payload: JSON.stringify({ contentType: "film", filmTemplate: "testmovie" }) });
  const story = (id: string, shop: string, m: number): Row => ({ ...row(id, shop, "GENERATE_VIDEO_AD", m), payload: JSON.stringify({ contentType: "film", filmMode: "narrated", filmTemplate: "horror", __lane: "story" }) });
  const faceless = (id: string, shop: string, m: number): Row => ({ ...row(id, shop, "GENERATE_VIDEO_AD", m), payload: JSON.stringify({ contentType: "faceless", topic: "octopus", __lane: "story" }) });
  const old = (id: string, shop: string, m: number): Row => ({ ...row(id, shop, "GENERATE_VIDEO_AD", m), payload: JSON.stringify({ contentType: "faceless", topic: "queued before the mark existed" }) });
  const rows = [film("film1", "A", 0), film("film2", "B", 1), story("story1", "B", 2), faceless("drop1", "C", 3), old("old1", "D", 4)];
  const { door } = memoryQueue(rows);
  const served = { render: new Map<string, number>(), story: new Map<string, number>() };
  const [r1, s1] = await Promise.all([claimNext("render", door, served.render, 1000), claimNext("story", door, served.story, 1000)]);
  assert.equal(r1?.id, "film1");
  assert.equal(s1?.id, "story1", "the two-minute story starts now, not after two films");
  // the story lane's next is the faceless drop; it never takes a film, and never the unmarked job
  assert.equal((await claimNext("story", door, served.story, 2000))?.id, "drop1");
  assert.equal(await claimNext("story", door, served.story, 3000), null);
  // the render lane: the other film, then the job that carries no mark (the careful lane) — never a story
  assert.equal((await claimNext("render", door, served.render, 2000))?.id, "film2");
  assert.equal((await claimNext("render", door, served.render, 3000))?.id, "old1");
  assert.equal(await claimNext("render", door, served.render, 4000), null);
  assert.deepEqual(rows.filter((r) => r.status === "PENDING"), []);
});


// ---- 2. members take turns --------------------------------------------------------------------------------

const job = (id: string, shopId: string, minute: number) => ({ id, shopId, createdAt: new Date(Date.UTC(2026, 10, 23, 13, minute)) });

test("one member's batch does not stand in front of everybody else", () => {
  // A queued five films at 13:00–13:04; B asked for one at 13:05; C at 13:06.
  const waiting = [job("a1", "A", 0), job("a2", "A", 1), job("a3", "A", 2), job("a4", "A", 3), job("a5", "A", 4), job("b1", "B", 5), job("c1", "C", 6)];
  // nobody served yet: each member's oldest, oldest member first — then the rest of A's batch
  assert.deepEqual(takeTurns(waiting, new Map()).map((j) => j.id), ["a1", "b1", "c1", "a2", "a3", "a4", "a5"]);
  // A's first film has started: B and C go before A's second
  const served = new Map([["A", Date.UTC(2026, 10, 23, 13, 7)]]);
  const next = takeTurns(waiting.slice(1), served).map((j) => j.id);
  assert.deepEqual(next.slice(0, 3), ["b1", "c1", "a2"]);
  // …and once B and C have had theirs, A's batch carries on in the order it was asked for
  served.set("B", Date.UTC(2026, 10, 23, 13, 20));
  served.set("C", Date.UTC(2026, 10, 23, 13, 30));
  assert.deepEqual(takeTurns(waiting.slice(1).filter((j) => j.shopId === "A"), served).map((j) => j.id), ["a2", "a3", "a4", "a5"]);
});

test("a member's own jobs keep their order, and the one served longest ago goes first", () => {
  const waiting = [job("a2", "A", 9), job("b1", "B", 3), job("a1", "A", 1), job("c1", "C", 8)];
  const served = new Map([["A", 500], ["B", 100], ["C", 300]]);
  const order = takeTurns(waiting, served).map((j) => j.id);
  assert.deepEqual(order, ["b1", "c1", "a1", "a2"], "B (served longest ago), then C, then A's OLDEST; A's second only as a fall-back");
  assert.ok(order.indexOf("a1") < order.indexOf("a2"), "an import queued to correct an earlier one still lands second");
  // a member never served goes before anyone who has been
  assert.equal(takeTurns([job("a1", "A", 1), job("d1", "D", 9)], served)[0].id, "d1");
  // nothing is dropped and nothing is repeated
  assert.deepEqual(order.slice().sort(), ["a1", "a2", "b1", "c1"]);
  assert.deepEqual(takeTurns([], served), []);
  // dates given as text or as numbers sort the same way
  assert.deepEqual(takeTurns([{ id: "x", shopId: "X", createdAt: "2026-11-23T13:05:00Z" }, { id: "y", shopId: "Y", createdAt: Date.UTC(2026, 10, 23, 13, 1) }], new Map()).map((j) => j.id), ["y", "x"]);
  assert.ok(LANE_LOOKAHEAD >= 40, "enough waiting jobs are looked at to see past one member's batch");
});

test("a waiting piece knows how many are made before it — and its card says that, not a countdown", () => {
  // A has three films waiting, B one, C one.
  const waiting = [job("a1", "A", 0), job("a2", "A", 1), job("a3", "A", 2), job("b1", "B", 3), job("c1", "C", 4)];
  // nobody served yet: A's first, then B and C, and only then A's second — the order the lane will really take them in
  assert.deepEqual(lineOrder(waiting, new Map()).map((j) => j.id), ["a1", "b1", "c1", "a2", "a3"]);
  assert.equal(aheadInLine("a1", waiting, new Map(), 0), 0, "nothing in hand, first in line: starting any moment");
  // A's earlier film is the one in hand right now
  const served = new Map([["A", 5000]]);
  assert.deepEqual(lineOrder(waiting, served).map((j) => j.id), ["b1", "c1", "a1", "a2", "a3"]);
  assert.equal(aheadInLine("b1", waiting, served, 1), 1, "the one being made");
  assert.equal(aheadInLine("c1", waiting, served, 1), 2);
  assert.equal(aheadInLine("a1", waiting, served, 1), 3);
  assert.equal(aheadInLine("a3", waiting, served, 1), 5);
  assert.equal(aheadInLine("not-in-view", waiting, served, 1), null, "far down a very long line: no number is made up");
  assert.deepEqual([...served], [["A", 5000]], "working out the line serves nobody");
  // the Archive asks, and a piece that has not begun does not count down
  const archive = read("app", "routes", "web.archive.tsx");
  assert.ok(archive.includes('const inLine = jobs.filter((j) => j.status === "PENDING" && (!j.runAt || j.runAt.getTime() <= nowMs));'));
  assert.ok(archive.includes("await placesInLine(inLine.map((j) => ({ id: j.id, type: j.type, payload: j.payload })))"), "its own lane: a story is not behind the films");
  assert.ok(archive.includes('waiting: !failed && j.status === "PENDING", ahead: places.get(j.id) ?? null });'));
  assert.ok(archive.includes('{j.waiting ? inLineText(j.ahead, t) : <>{t("Rendering")} · '));
  assert.ok(archive.includes('{j.waiting ? t("In line") : <>'));
  const words = archive.slice(archive.indexOf("function inLineText("), archive.indexOf("function fmtEta("));
  assert.ok(words.includes('if (ahead == null) return t("In line — it starts when its turn comes");'));
  assert.ok(words.includes('if (ahead <= 0) return t("In line — starting any moment");'));
  assert.ok(words.includes('return ahead === 1 ? t("In line — 1 ahead of you") : t("In line — {n} ahead of you", { n: ahead });'));
  // …in every language the page speaks
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const key of ["In line", "In line — it starts when its turn comes", "In line — starting any moment", "In line — 1 ahead of you", "In line — {n} ahead of you"]) {
    assert.equal(dict.split(`\n  ${JSON.stringify(key)}: `).length - 1, 5, key);
  }
  const queueSrc = read("app", "lib", "job-queue.server.ts");
  assert.ok(queueSrc.includes("for (const j of mine) out.set(j.id, aheadInLine(j.id, waiting, lastServed[lane], inHand));"));
  assert.ok(queueSrc.includes('db.job.count({ where: { status: "IN_PROGRESS", ...inLane } }),'), "the one in hand counts as ahead");
  assert.ok(queueSrc.includes("const mine = jobs.filter((j) => laneOf(j.type, j.payload) === lane);"));
});

// ---- 2b. taking a job, against a queue in memory -----------------------------------------------------------

type Row = { id: string; shopId: string; type: string; createdAt: Date; status: "PENDING" | "IN_PROGRESS"; payload?: string };

/** The two database calls, as the real ones behave: `waiting` filters by kind and returns oldest first;
 *  `claim` succeeds only for the first caller to flip a PENDING row. */
function memoryQueue(rows: Row[]) {
  const asked: Array<{ take: number }> = [];
  const door = {
    async waiting(lane: LaneWhere, take: number) {
      asked.push({ take });
      return rows
        .filter((r) => r.status === "PENDING" && selects(lane, r))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, take);
    },
    async claim(id: string) {
      await Promise.resolve(); // the real one is a round trip: let another caller in between
      const row = rows.find((r) => r.id === id);
      if (!row || row.status !== "PENDING") return false;
      row.status = "IN_PROGRESS";
      return true;
    },
  };
  return { door, asked };
}
const row = (id: string, shopId: string, type: string, minute: number): Row => ({ id, shopId, type, createdAt: new Date(Date.UTC(2026, 10, 23, 13, minute)), status: "PENDING" });

test("a lane takes only its own kinds of job — a film in the making does not hold a picture or an import", async () => {
  const rows = [row("film1", "A", "GENERATE_VIDEO_AD", 0), row("film2", "B", "GENERATE_VIDEO_AD", 1), row("pic1", "B", "GENERATE_IMAGE_AD", 2), row("import1", "C", "IMPORT_CATALOG", 3), row("edit1", "C", "EDIT_VIDEO", 4)];
  const { door, asked } = memoryQueue(rows);
  const served = { render: new Map<string, number>(), picture: new Map<string, number>(), desk: new Map<string, number>() };
  // all three lanes look at the same moment, as the worker's tick has them do
  const [film, pic, imp] = await Promise.all([claimNext("render", door, served.render, 1000), claimNext("picture", door, served.picture, 1000), claimNext("desk", door, served.desk, 1000)]);
  assert.equal(film?.id, "film1");
  assert.equal(pic?.id, "pic1", "the picture starts now, not after two films");
  assert.equal(imp?.id, "import1", "and so does the sign-up's catalogue import");
  assert.deepEqual(rows.filter((r) => r.status === "IN_PROGRESS").map((r) => r.id), ["film1", "pic1", "import1"]);
  assert.ok(asked.every((a) => a.take === LANE_LOOKAHEAD));
  // nothing more for the picture and desk lanes; the render lane's next is the OTHER member's film, then the edit
  assert.equal(await claimNext("picture", door, served.picture, 2000), null);
  assert.equal(await claimNext("desk", door, served.desk, 2000), null);
  assert.equal((await claimNext("render", door, served.render, 2000))?.id, "film2");
  assert.equal((await claimNext("render", door, served.render, 3000))?.id, "edit1");
  assert.equal(await claimNext("render", door, served.render, 4000), null);
  assert.deepEqual([...served.render], [["A", 1000], ["B", 2000], ["C", 3000]], "only a won claim counts as being served");
});

test("two workers after the same job: one gets it, the other gets the next one — never both", async () => {
  const rows = [row("p1", "A", "GENERATE_IMAGE_AD", 0), row("p2", "B", "GENERATE_IMAGE_AD", 1)];
  const { door } = memoryQueue(rows);
  // two processes mid-deploy: each has its own memory of whose turn it is
  const [one, two] = await Promise.all([claimNext("picture", door, new Map(), 1), claimNext("picture", door, new Map(), 1)]);
  assert.deepEqual([one?.id, two?.id].sort(), ["p1", "p2"]);
  // and with one job between them, exactly one of them gets it
  const single = [row("p3", "A", "GENERATE_IMAGE_AD", 2)];
  const q = memoryQueue(single);
  const got = await Promise.all([claimNext("picture", q.door, new Map(), 1), claimNext("picture", q.door, new Map(), 1)]);
  assert.equal(got.filter(Boolean).length, 1);
  const lostServed = new Map<string, number>();
  assert.equal(await claimNext("picture", q.door, lostServed, 1), null);
  assert.equal(lostServed.size, 0, "a lost claim serves nobody");
});

test("members take turns across a lane's whole run", async () => {
  // A's channel queued four drops; B then asks for one film; C for one.
  const rows = [row("a1", "A", "GENERATE_VIDEO_AD", 0), row("a2", "A", "GENERATE_VIDEO_AD", 1), row("a3", "A", "GENERATE_VIDEO_AD", 2), row("a4", "A", "GENERATE_VIDEO_AD", 3), row("b1", "B", "GENERATE_VIDEO_AD", 4), row("c1", "C", "GENERATE_VIDEO_AD", 5)];
  const { door } = memoryQueue(rows);
  const served = new Map<string, number>();
  const order: string[] = [];
  for (let t = 1; ; t++) {
    const j = await claimNext("render", door, served, t * 1000);
    if (!j) break;
    order.push(j.id);
  }
  assert.deepEqual(order, ["a1", "b1", "c1", "a2", "a3", "a4"], "B and C wait for ONE of A's films, not four");
});

// ---- 3. one encode at a time, for every job --------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test("a job's encodes run one at a time, in the order they were asked for", async () => {
  const log: string[] = [];
  let together = 0;
  let most = 0;
  const encode = (name: string, ms: number) => asJob(() => ffmpegTurn(async () => {
    together++; most = Math.max(most, together);
    log.push(name + " starts");
    await sleep(ms);
    log.push(name + " ends");
    together--;
    return name;
  }));
  // three jobs, one in each lane, all reaching their encode at the same moment
  const results = await Promise.all([encode("film", 40), encode("picture", 5), encode("song", 5)]);
  assert.deepEqual(results, ["film", "picture", "song"]);
  assert.deepEqual(log, ["film starts", "film ends", "picture starts", "picture ends", "song starts", "song ends"]);
  assert.equal(most, 1, "never two at once");
  assert.deepEqual(ffmpegTurns(), { running: 0, waiting: 0 });
});

test("only a job takes a turn — a thumbnail asked for by a web request does not wait for somebody's film", async () => {
  let filmDone = false;
  const film = asJob(() => ffmpegTurn(async () => { await sleep(60); filmDone = true; return "film"; }));
  await sleep(5); // the film's encode is running
  assert.equal(inJob(), false, "this test is not a job");
  const thumb = await ffmpegTurn(async () => "thumbnail"); // exactly what vthumb, the storyboard check and the film editor do
  assert.equal(thumb, "thumbnail");
  assert.equal(filmDone, false, "it did not wait for the film");
  await film;
  // …and being a job reaches every await inside it, however deep, timers included
  const seen: boolean[] = [];
  await asJob(async () => {
    seen.push(inJob());
    await sleep(3);
    seen.push(inJob());
    await Promise.all([1, 2].map(async () => { await sleep(1); seen.push(inJob()); }));
  });
  assert.deepEqual(seen, [true, true, true, true]);
  assert.equal(inJob(), false, "and stops at its end");
  // work that is heavy and never urgent takes a turn whoever asks (a presenter's 3D view)
  const order: string[] = [];
  const a = asJob(() => ffmpegTurn(async () => { await sleep(30); order.push("film"); }));
  await sleep(2);
  const b = ffmpegTurnAlways(async () => { order.push("kit"); });
  await Promise.all([a, b]);
  assert.deepEqual(order, ["film", "kit"]);
  assert.deepEqual(ffmpegTurns(), { running: 0, waiting: 0 });
});

test("a job that is waiting its turn says it is alive", async () => {
  // No clock in this test: the film's encode ends only when the waiting job has beaten three times, so the
  // picture can only be drawn if the beats really happen WHILE it waits (every 10 ms here; a minute, live).
  let beats = 0;
  let endFilm: () => void = () => {};
  const long = asJob(() => ffmpegTurn(() => new Promise<void>((r) => { endFilm = r; })));
  await sleep(2);
  const waited = ffmpegTurnAlways(async () => "drawn", 60_000, () => { beats++; if (beats === 3) endFilm(); }, 10);
  assert.equal(await waited, "drawn");
  await long;
  assert.ok(beats >= 3, "beat while it waited: " + beats);
  const after = beats;
  await sleep(60);
  assert.equal(beats, after, "and stopped when its turn ended");
  // a beat that throws, or rejects, costs nothing
  const loud = ffmpegTurnAlways(async () => { await sleep(40); return "fine"; }, 5000, () => { throw new Error("database away"); }, 10);
  assert.equal(await loud, "fine");
  const quiet = ffmpegTurnAlways(async () => { await sleep(40); return "fine"; }, 5000, () => Promise.reject(new Error("database away")), 10);
  assert.equal(await quiet, "fine");
  // the worker hands the job's own row to it
  const queueSrc = read("app", "lib", "job-queue.server.ts");
  assert.ok(queueSrc.includes('await asJob(\n      () => runJob(jobType, jobShop, payload),\n      () => db.job.updateMany({ where: { id: jobId, status: "IN_PROGRESS" }, data: { updatedAt: new Date() } }),\n    );'));
  assert.ok(TURN_BEAT_MS * 10 < 25 * 60_000, "many beats inside the reaper's 25 minutes");
});

test("an encode that fails gives its turn up like any other", async () => {
  const failed = asJob(() => ffmpegTurn(async () => { await sleep(5); throw new Error("ffmpeg exited 1"); }));
  const threw = asJob(() => ffmpegTurn(() => { throw new Error("could not even start"); }));
  const after = asJob(() => ffmpegTurn(async () => "drawn"));
  await assert.rejects(failed, /ffmpeg exited 1/);
  await assert.rejects(threw, /could not even start/);
  assert.equal(await after, "drawn");
  assert.deepEqual(ffmpegTurns(), { running: 0, waiting: 0 });
});

test("a turn that never ends does not stop every other encode for good", async () => {
  let release: () => void = () => {};
  const stuck = asJob(() => ffmpegTurn(() => new Promise<string>((r) => { release = () => r("late"); })));
  const started = Date.now();
  const next = await asJob(() => ffmpegTurn(async () => "went anyway", 60)); // the bound, shortened for the test
  assert.equal(next, "went anyway");
  assert.ok(Date.now() - started >= 50, "it did wait for the bound first");
  // and the one after that waits for ITS predecessor, not for the stuck one
  assert.equal(await asJob(() => ffmpegTurn(async () => "third", 5000)), "third");
  release();
  assert.equal(await stuck, "late");
  assert.deepEqual(ffmpegTurns(), { running: 0, waiting: 0 });
  // the real bound sits above the longest hard ceiling any runner has (10 minutes)
  assert.ok(FFMPEG_TURN_WAIT_MS > 10 * 60_000);
  assert.ok(FFMPEG_TURN_WAIT_MS < 25 * 60_000, "and under the reaper's 25 minutes");
});

test("a try that failed rests before the next — a restart does not", async () => {
  const at = (sec: number) => new Date(Date.UTC(2026, 10, 23, 13, 0, sec));
  const now = at(100).getTime();
  // never tried, or put back by a restart with its try handed back: goes at once
  assert.equal(resting({ id: "a", shopId: "A", createdAt: at(0), attempts: 0, updatedAt: at(99) }, now), false);
  assert.equal(resting({ id: "a", shopId: "A", createdAt: at(0) }, now), false);
  // failed once 10 s ago: rests (30 s for a first try); 31 s ago: goes
  assert.equal(resting({ id: "a", shopId: "A", createdAt: at(0), attempts: 1, updatedAt: at(90) }, now), true);
  assert.equal(resting({ id: "a", shopId: "A", createdAt: at(0), attempts: 1, updatedAt: at(69) }, now), false);
  // failed twice: a minute
  assert.equal(resting({ id: "a", shopId: "A", createdAt: at(0), attempts: 2, updatedAt: at(45) }, now), true);
  assert.equal(resting({ id: "a", shopId: "A", createdAt: at(0), attempts: 2, updatedAt: at(39) }, now), false);
  assert.equal(RETRY_REST_MS, 30_000);
  // in the line: the resting job is passed over, and the next member's job is not held up by it
  type R = Row & { attempts: number; updatedAt: Date };
  const rows: R[] = [
    { ...row("failed-once", "A", "GENERATE_IMAGE_AD", 0), attempts: 1, updatedAt: at(90) },
    { ...row("fresh", "B", "GENERATE_IMAGE_AD", 1), attempts: 0, updatedAt: at(95) },
  ];
  const { door } = memoryQueue(rows);
  assert.equal((await claimNext("picture", door, new Map(), now))?.id, "fresh");
  assert.equal(await claimNext("picture", door, new Map(), now), null, "still resting");
  assert.equal((await claimNext("picture", door, new Map(), at(125).getTime()))?.id, "failed-once", "and taken once it has rested");
});

// ---- 4. memory readings -----------------------------------------------------------------------------------

test("the kernel's files are read as they are written", () => {
  assert.equal(oneNumber("1073741824\n"), 1073741824);
  assert.equal(oneNumber("max\n"), null, "no limit");
  assert.equal(oneNumber("9223372036854771712\n"), null, "an old kernel's way of saying no limit");
  assert.equal(oneNumber(null), null);
  const stat = "anon 734003200\nfile 209715200\nkernel 1048576\n";
  assert.equal(statLine(stat, "anon"), 734003200);
  assert.equal(statLine(stat, "file"), 209715200);
  assert.equal(statLine(stat, "anon_thp"), null, "a key that only starts the same is not the key");
  assert.equal(statLine("oom_kill_disable 0\nunder_oom 0\noom_kill 2\n", "oom_kill"), 2);
  assert.equal(statLine(null, "anon"), null);
  // on a machine without those files the container figures are null and the process's own is there
  const now = memoryNow();
  assert.ok(now.nodeMb > 0);
  for (const k of ["usedMb", "cacheMb", "limitMb", "oomKills"] as const) assert.ok(now[k] === null || typeof now[k] === "number");
});

test("the highest reading of each minute is kept, for the last half hour", () => {
  const at = (m: number, s: number) => new Date(Date.UTC(2026, 10, 23, 14, m, s));
  let minutes = foldSample([], at(0, 5), 610);
  minutes = foldSample(minutes, at(0, 10), 940);
  minutes = foldSample(minutes, at(0, 15), 700);
  assert.deepEqual(minutes, [{ at: "2026-11-23T14:00Z", peakMb: 940 }], "one line a minute: its highest");
  minutes = foldSample(minutes, at(1, 0), 420);
  assert.deepEqual(minutes.map((m) => m.peakMb), [940, 420]);
  for (let m = 2; m < 50; m++) minutes = foldSample(minutes, at(m, 0), 400 + m);
  assert.equal(minutes.length, KEEP_MINUTES);
  assert.equal(minutes[minutes.length - 1].at, "2026-11-23T14:49Z");
  assert.equal(minutes[0].at, "2026-11-23T14:20Z", "older minutes fall off the front");
});

// ---- 5. wiring ---------------------------------------------------------------------------------------------

const queue = read("app", "lib", "job-queue.server.ts");
const worker = read("app", "worker.server.ts");

test("the queue claims within a lane, in turn-taking order, with a slot per lane", () => {
  assert.ok(queue.includes("export async function processNextJob(lane: Lane): Promise<boolean> {"), "the lane is not optional");
  assert.ok(queue.includes("const slot = slots[lane];\n  if (Date.now() < slot.until) return false;\n  const myToken = ++slot.token;\n  slot.until = Date.now() + RENDER_SLOT_MS;"), "reserved before the first await");
  assert.ok(queue.includes("if (slot.token === myToken) slot.until = 0;"), "only the owner releases");
  // taking a job is claimNext (tested above with a queue in memory); the queue hands it the two real calls
  const take = queue.slice(queue.indexOf("let job = await claimNext("), queue.indexOf("if (!job) return false;"));
  assert.ok(take.includes("lane,"), "its own lane");
  assert.ok(take.includes('status: "PENDING",\n            attempts: { lt: MAX_ATTEMPTS },\n            OR: [{ runAt: null }, { runAt: { lte: new Date() } }],\n            ...(inLane as Prisma.JobWhereInput),'), "only what could start now, of this lane");
  assert.ok(take.includes('orderBy: { createdAt: "asc" },\n          take,'));
  // the claim is still the conditional update: only the caller that flipped the row owns the job
  assert.ok(take.includes('where: { id, status: "PENDING" },\n          data: { status: "IN_PROGRESS", attempts: { increment: 1 } },\n        })).count === 1,'));
  assert.ok(take.includes("lastServed[lane],"), "each lane remembers whose turn it is");
  assert.ok(!/renderSlotUntil|renderSlotToken/.test(queue), "the single slot is gone");
});

test("each lane drains in its own loop, and the chores never wait for a job", () => {
  assert.ok(worker.includes("const drains = LANES.map((lane) =>\n  guarded(`${lane} lane`, async () => {"));
  assert.ok(worker.includes("processed = await processNextJob(lane);"));
  assert.ok(worker.includes("function tick() {\n  void chores();\n  for (const drain of drains) void drain();\n}"));
  const chores = worker.slice(worker.indexOf('const chores = guarded("chores"'), worker.indexOf("const drains = "));
  assert.ok(chores.includes("await postDueSlots();"), "a scheduled post goes out while a film renders");
  assert.ok(chores.includes("await tickDueSeries()"));
  assert.ok(!chores.includes("processNextJob"), "no job is awaited among the chores");
  assert.ok(!chores.includes("backfillDeadImages"), "re-making pictures draws pictures: it takes its turn in the picture lane");
  assert.ok(worker.includes('if (lane === "picture") await backfillDeadImages()'));
  // every loop has the single tick's guard: it expires, and only the newest pass releases it
  const guard = worker.slice(worker.indexOf("function guarded("), worker.indexOf("const chores = "));
  assert.ok(guard.includes("if (running && Date.now() - startedAt < TICK_DEADLINE_MS) return;"));
  assert.ok(guard.includes("if (mine === gen) running = false;"));
  assert.ok(worker.includes("startMemoryWatch();"));
});

test("every encode a job starts takes its turn — the three runners", () => {
  const ugc = read("app", "lib", "ugc-ad-pipeline.server.ts");
  const com = read("app", "lib", "commercial-ad-pipeline.server.ts");
  const img = read("app", "lib", "image-generation.server.ts");
  assert.ok(ugc.includes("return ffmpegTurn(() => new Promise<{ status: number; stderr: string }>((resolve, reject) => {\n    const p = spawn(ffmpegBin(), args,"));
  assert.ok(com.includes("return ffmpegTurn(() => new Promise<void>((resolve, reject) => {\n    const p = spawn(bin, args,"));
  assert.ok(img.includes("return ffmpegTurn(() => new Promise<{ ok: boolean; stdout: string; stderr: string }>((resolve) => {"));
  // the kill timers are set INSIDE the turn: time spent waiting is not time spent encoding
  for (const [name, src] of [["ugc", ugc], ["commercial", com], ["still", img]] as const) {
    const turn = src.indexOf("return ffmpegTurn(");
    const timer = src.indexOf("setTimeout(", turn);
    const spawned = src.indexOf("spawn(", turn);
    assert.ok(turn > 0 && spawned > turn && timer > turn, name);
  }
  // nothing else in a job's path starts ffmpeg on its own
  for (const f of ["narrated-story.server.ts", "faceless-video.server.ts", "film-engine.server.ts", "film-captions.server.ts", "video-edit.server.ts", "music-video-pipeline.server.ts"]) {
    const src = read("app", "lib", f);
    assert.ok(!/\bspawn(Sync)?\(/.test(src.replace(/\/\/[^\n]*/g, "")), `${f} starts a process of its own`);
  }
});

test("the status page says whether ANYTHING is being made, and what the server is using", () => {
  const status = read("app", "routes", "art-status.tsx");
  assert.ok(status.includes('db.job.count({ where: { status: "IN_PROGRESS" } })'), "every kind of job, not three of them");
  assert.ok(status.includes('const due = { status: "PENDING" as const, attempts: { lt: 3 }, OR: [{ runAt: null }, { runAt: { lte: new Date() } }] };'), "a drop scheduled for next week is not waiting");
  assert.ok(status.includes("busy: { running, waiting }"));
  assert.ok(status.includes("memory: memoryReport(),"));
  assert.ok(status.includes("encodes: ffmpegTurns(),"));
  assert.ok(queue.includes("const MAX_ATTEMPTS = 3;"), "the 3 above is the queue's own ceiling");
});

// ---- 6. what reading the code for "jobs side by side" found ------------------------------------------------

test("a job that finished after being bounced back to waiting is finished — it is not made twice", () => {
  // A reclaim hands the attempt BACK (attempts - 1), so the bounced row never carries the finishing run's
  // attempt number: pinned to it, the force-complete could not match, and the piece was rendered again.
  assert.ok(queue.includes('data: dead\n        ? { status: "FAILED", lastError: "Interrupted by a server restart — hit ROLL CAMERA to try again." }\n        : { status: "PENDING", attempts: Math.max(0, j.attempts - 1), payload: bumpedPayload },'), "the reclaim still hands the attempt back");
  assert.ok(queue.includes('await db.job.updateMany({ where: { id: job.id, status: "PENDING" }, data: { status: "COMPLETED", processedAt: new Date() } });'));
  assert.ok(!queue.includes('status: "PENDING", attempts: myAttempt }'), "no attempt pin on the waiting row");
  // the first write is still scoped to this run: a row a NEWER run holds is never completed from here
  assert.ok(queue.includes('where: { id: job.id, status: "IN_PROGRESS", attempts: myAttempt },\n      data: { status: "COMPLETED", processedAt: new Date() },'));
  // the start stamp goes onto the payload as it is after the claim
  assert.ok(queue.includes("const fresh = await db.job.findUnique({ where: { id: job.id }, select: { payload: true } });\n    const p = JSON.parse(fresh?.payload ?? job.payload);\n    p.__startedAt = new Date().toISOString();"));
});

test("the Stage waits for the piece of the kind it is making", () => {
  // a picture asked for through Helpurr lands while "Making your video…" is on the Stage
  assert.equal(stageKindFits("video", { video: false, audio: false }), false, "the picture is not the video");
  assert.equal(stageKindFits("video", { video: true, audio: false }), true);
  assert.equal(stageKindFits("song", { video: false, audio: true }), true);
  assert.equal(stageKindFits("song", { video: true, audio: false }), false);
  assert.equal(stageKindFits("image", { video: false, audio: false }), true);
  assert.equal(stageKindFits("photo", { video: false, audio: false }), true, "an edit lands as a picture");
  assert.equal(stageKindFits("image", { video: true, audio: false }), false);
  assert.equal(stageKindFits("", { video: true, audio: false }), true, "nothing recorded: the first new piece, as before");
  // …and that picture FAILING is not "your video failed, tokens refunded"
  assert.equal(stageJobFits("video", "image"), false);
  assert.equal(stageJobFits("video", "video"), true);
  assert.equal(stageJobFits("video", "faceless"), true);
  assert.equal(stageJobFits("song", "song"), true);
  assert.equal(stageJobFits("image", "photo"), true, "pictures and edits share a lane: one answers for the other");
  assert.equal(stageJobFits("photo", "video"), false);
  const studio = read("app", "routes", "web.studio.tsx");
  assert.ok(studio.includes("const fresh = d.recent.find((p) => p.media && !preIdsRef.current.includes(p.id) && ofKind(p));"));
  assert.ok(studio.includes('const lg = (d.recentGens || []).find((g) => g.status === "FAILED" && stageFailureFits(watchedJobRef.current, want, g, makingStartedRef.current - 15000));'));
  assert.ok(studio.includes("take: 5,\n    select: { id: true, type: true, status: true, createdAt: true, lastError: true, payload: true },"), "the newest few jobs, not only the newest");
  assert.ok(studio.includes('const cooking = genRows.find((r) => (r.status === "PENDING" || r.status === "IN_PROGRESS")'), "a landed picture does not hide the video still cooking");
});

test("a post that went out is recorded, a waiting job is only cancelled while it waits, a presenter's 3D view takes a turn", () => {
  const post = read("app", "lib", "social-post.server.ts");
  const rec = post.slice(post.indexOf("const record = async (slot: QuestSlot)"), post.indexOf("for (const s of schedule.slots)"));
  assert.ok(rec.includes("for (let attempt = 0; attempt < 8; attempt++) {\n          if (attempt) await new Promise((r) => setTimeout(r, 150 * attempt));"), "eight tries, each a little later");
  assert.ok(rec.includes("where: { id: q.id, scheduleJson: fresh.scheduleJson },"), "still compare-and-swap on what was read");
  const quests = read("app", "lib", "questlines.server.ts");
  assert.ok(quests.includes('if (p.questlineId === questlineId) await db.job.deleteMany({ where: { id: j.id, status: "PENDING" } });'));
  assert.ok(!quests.includes("await db.job.delete({ where: { id: j.id } });"));
  assert.ok(quests.includes("for (let attempt = 0; attempt < 8 && !committed; attempt++) {\n      if (attempt) await new Promise((r) => setTimeout(r, 150 * attempt));"));
  const kitCore = read("app", "lib", "presenter-kit-core.ts");
  assert.ok(kitCore.includes("const alone = t.turn ? () => t.turn!(job) : job;\n  return t.lane ? t.lane(alone) : alone();"), "the turn is taken by the single process, inside the kit's own lane");
  assert.ok(!/from "\.\/ffmpeg-turn/.test(kitCore), "the core stays free of the server: the turn is handed to it");
  assert.equal(kitCore.split("clearTimeout(kill);").length - 1, 4, "both runners end their kill timer on close and on error");
  assert.ok(kitCore.includes("const RUN_CEILING_MS = 10 * 60_000;"));
  assert.ok(read("app", "lib", "presenter-kit.server.ts").includes("lane: oneAtATime, turn: (run) => ffmpegTurnAlways(run) };"));
});

test("a picture standing in the provider's line is not timed as if it were being made", () => {
  const fal = read("app", "lib", "fal-image.server.ts");
  assert.ok(fal.includes('if (sj.status !== "COMPLETED") return { done: false, queued: sj.status === "IN_QUEUE" };'));
  const wait = fal.slice(fal.indexOf("export async function awaitCompose("), fal.indexOf("function auth()"));
  assert.ok(wait.includes("while (made < makeMs && queued < COMPOSE_QUEUE_GRACE_MS) {"));
  assert.ok(wait.includes("if (p.queued) queued += everyMs; else made += everyMs;"));
  assert.ok(fal.includes("export const COMPOSE_QUEUE_GRACE_MS = 8 * 60_000;"));
  assert.ok(fal.includes('const urls = await awaitCompose(q.statusUrl, q.responseUrl, 2 * 60_000, 2500);\n  if (urls) return urls;\n  throw new Error("compose: timed out after 2 min");'));
  const img = read("app", "lib", "image-generation.server.ts");
  assert.equal(img.split("(await awaitCompose(q.statusUrl, q.responseUrl, 180_000))?.[0]").length - 1, 2, "both Combine waits");
  // a plan that failed once is asked for again later, not never
  assert.ok(img.includes("shotPlanFailed.set(productImageUrl, Date.now());\n    return null;"));
  assert.ok(!img.includes("shotPlans.set(productImageUrl, null);"));
  assert.ok(img.includes("if (failedAt && Date.now() - failedAt < PLAN_RETRY_AFTER_MS) return null;"));
});

test("a thumbnail is written whole, and the app's own art waits for every kind of piece", () => {
  const thumb = read("app", "routes", "vthumb.$file.tsx");
  assert.ok(thumb.includes('"-q:v", "4", "-f", "mjpeg", part]);'), "an explicit format: the name no longer ends in .jpg");
  assert.ok(thumb.includes("if (made.status === 0 && fs.existsSync(part) && fs.statSync(part).size > 0) fs.renameSync(part, thumb);"));
  assert.ok(!thumb.includes('"-q:v", "4", thumb]'), "never straight onto the final name");
  const art = read("app", "lib", "art-throttle.server.ts");
  for (const kind of ["GENERATE_SONG", "EDIT_VIDEO", "REGEN_SHOT", "FORGE_CUSTOM_AVATAR", "FORGE_COMPANION"]) assert.ok(art.includes('"' + kind + '"'), kind);
  assert.ok(art.includes('OR: [{ status: "IN_PROGRESS" }, { status: "PENDING", OR: [{ runAt: null }, { runAt: { lte: new Date() } }] }],'), "a drop scheduled for next week is not somebody waiting");
});

test("a transcript request waits out “too many requests”, and members' pictures come before re-made ones", () => {
  // It was the one request to the provider that gave up on the first 429 — and every caller catches that
  // and carries on without a listen: captions "timed by length instead", lyrics left off, nothing failed.
  const fl = read("app", "lib", "faceless-video.server.ts");
  const create = fl.slice(fl.indexOf("export async function createWhisperx("), fl.indexOf("export type WordT"));
  assert.ok(create.includes("if (res.status === 429) {"));
  assert.ok(create.includes('const wait = Math.min(retryAfterMs(res.headers.get("retry-after"), body.retry_after), WHISPERX_PATIENCE_MS - slept);'));
  assert.ok(create.includes("if (wait <= 0) break;"), "patience has an end");
  assert.ok(create.includes('throw new Error("whisperx create: rate-limited too long");'));
  assert.ok(create.includes("export const WHISPERX_PATIENCE_MS = 90_000;"));
  assert.ok(create.includes("const seconds = Number.isFinite(h) && h > 0 ? h : typeof bodySeconds === \"number\" && bodySeconds > 0 ? bodySeconds : 12;"), "the wait the provider names: header, else body, else 12 s");
  assert.ok(create.includes("if (!res.ok) throw new Error(`whisperx create ${res.status}: "), "any other refusal is still an error at once");
  // the picture lane: the members' own jobs first, then the pictures nobody is waiting for
  const lane = worker.slice(worker.indexOf("const drains = LANES.map("), worker.indexOf("function tick()"));
  assert.ok(lane.indexOf("processed = await processNextJob(lane);") < lane.indexOf('if (lane === "picture") await backfillDeadImages()'));
});

// ---- 7. every piece says which job made it -----------------------------------------------------------------

test("a finished piece carries its job, and what waits for “my piece” asks for exactly that", () => {
  const img = read("app", "lib", "image-generation.server.ts");
  const tag = img.slice(img.indexOf("export async function tagAssetSection("), img.indexOf("export type EditOp"));
  assert.ok(tag.includes("export async function tagAssetSection(assetId: string | null | undefined, section: string | undefined, jobId?: string): Promise<void> {"));
  assert.ok(tag.includes("if (!assetId || (!creator && !jobId)) return;"), "the job is written for every section");
  assert.ok(tag.includes("const needJob = !!jobId && meta.jobId !== jobId;"));
  assert.ok(tag.includes("if (needSection) meta.section = \"creator\";\n      if (needJob) meta.jobId = jobId;"));
  assert.ok(tag.includes("where: { id: assetId, metaJson: prev }"), "still compare-and-swap on what was read");
  // the worker hands the job to it wherever a piece is finished — ten places
  assert.equal(queue.split("payload.__jobId as string | undefined);").length - 1, 10);
  assert.ok(queue.includes("await tagAssetSection(editedId, undefined, payload.__jobId as string | undefined);"), "a photo edit");
  assert.ok(queue.includes("await tagAssetSection(createdAssetId, undefined, payload.__jobId as string | undefined);"), "a described picture");
  assert.ok(queue.includes("payload.__jobId = job.id;"));
  assert.ok(!/tagAssetSection\([^)]*payload\.section as string \| undefined\);/.test(queue), "no call left without the job");

  // HELPURR: the piece this job made; the old rule only for a piece that carries no job at all
  const buddy = read("app", "routes", "api.buddy.tsx");
  const poll = buddy.slice(buddy.indexOf('if (body.intent === "makeStatus") {'), buddy.indexOf("if (url) return json({ done: true"));
  assert.ok(poll.includes('const safeJob = /^[A-Za-z0-9_-]{8,64}$/.test(jobId) ? jobId : "";'), "an id is an id before it goes into a search");
  assert.ok(poll.includes("? await db.asset.findFirst({ where: { shopId: id.shop.id, type, metaJson: { contains: `\"jobId\":\"${safeJob}\"` } }, orderBy: { createdAt: \"desc\" }, select })"));
  assert.ok(poll.includes("const asset = mine ?? await db.asset.findFirst({"));
  assert.ok(poll.includes("{ NOT: { metaJson: { contains: '\"jobId\":\"' } } }"), "a piece stamped by another job is never the answer");

  // THE STAGE: the job it queued
  assert.equal(queuedKindFits("video", "video"), true);
  assert.equal(queuedKindFits("videoedit", "video"), true);
  assert.equal(queuedKindFits("video", "faceless"), false, "a faceless video is its own kind — and its own lane");
  assert.equal(queuedKindFits("faceless", "faceless"), true);
  assert.equal(queuedKindFits("music", "song"), true);
  assert.equal(queuedKindFits("image", "photo"), true);
  assert.equal(queuedKindFits("article", "image"), false);
  const at = (sec: number) => new Date(Date.UTC(2026, 10, 23, 15, 0, sec)).toISOString();
  const gens = [{ id: "helpurr-picture", kind: "image", at: at(32) }, { id: "my-video", kind: "video", at: at(30) }, { id: "older-video", kind: "video", at: at(1) }];
  assert.equal(queuedJob("video", gens, Date.parse(at(10))), "my-video", "the newest job OF THAT KIND, not the newest job");
  assert.equal(queuedJob("faceless", gens, Date.parse(at(10))), null, "none of that kind: not guessed");
  assert.equal(queuedJob("video", gens, Date.parse(at(40))), null, "nothing new enough");
  // the Movie Maker film that lands first is a Creator video too — it is not the answer
  assert.equal(stagePieceFits("my-video", "video", { jobId: "a-film-queued-earlier", video: true, audio: false }), false);
  assert.equal(stagePieceFits("my-video", "video", { jobId: "my-video", video: true, audio: false }), true);
  assert.equal(stagePieceFits("my-video", "video", { jobId: null, video: true, audio: false }), true, "a piece that says nothing: the kind rule, as before");
  assert.equal(stagePieceFits("my-video", "video", { jobId: null, video: false, audio: false }), false);
  assert.equal(stagePieceFits(null, "video", { jobId: "whoever", video: true, audio: false }), true, "a page that does not know its job: the kind rule");
  assert.equal(stageFailureFits("my-video", "video", { id: "helpurr-picture", kind: "image", at: at(32) }, 0), false);
  assert.equal(stageFailureFits("my-video", "video", { id: "another-video", kind: "video", at: at(33) }, 0), false, "another video failing is not this one failing");
  assert.equal(stageFailureFits("my-video", "video", { id: "my-video", kind: "video", at: at(30) }, 0), true);
  assert.equal(stageFailureFits(null, "video", { id: "x", kind: "video", at: at(30) }, Date.parse(at(20))), true);
  assert.equal(stageFailureFits(null, "video", { id: "x", kind: "video", at: at(5) }, Date.parse(at(20))), false);
  const studio = read("app", "routes", "web.studio.tsx");
  assert.ok(studio.includes("watchedJobRef.current = f.id; // picked back up after a reload: this is the job"));
  assert.ok(studio.includes("stagePieceFits(watchedJobRef.current, want, { jobId: p.jobId, video: !!p.isVideo, audio: !!p.isAudio })"));
  assert.ok(studio.includes("const recentGens = genRows.map((r) => ({ id: r.id, status: r.status as string,"));
  assert.ok(studio.includes("return { id: a.id, jobId: madeBy, isVideo: a.type === \"VIDEO_AD\","));
});

test("a narrated story's card does not promise ten minutes", () => {
  const archive = read("app", "routes", "web.archive.tsx");
  // (the sum moved to story-motion.ts when a story's pictures began to move: over stills it is the same
  //  sixty seconds and twelve a scene; with moving pictures a clip a scene is added — tests/story-motion.test.ts)
  assert.ok(archive.includes('const typical = (j.type === "GENERATE_VIDEO_AD" && p.contentType === "film" && p.filmMode === "narrated")\n      // (…and since its pictures MOVE — story-motion.ts — a clip a scene on top of that; unless its maker\n      //  asked for it over STILL pictures, the ladder\'s simple rung, which is the quick one)\n      ? storyTypicalSeconds(typeof p.filmScenes === "number" ? p.filmScenes : 6, storyMotionOn(p.filmPictures))\n      : (j.type === "GENERATE_VIDEO_AD" && p.contentType === "film")\n      ? Math.max(600,'));
  const core = read("app", "lib", "story-motion.ts");
  assert.ok(core.includes("60 + Math.max(1, scenes) * 12 + (moves ? "));
});

test("the Studio's action says which job it queued, and the Stage is told before it guesses", () => {
  // Found on the live site the hour the job-following shipped: the Stage looked for its job on the list
  // it held when "queued" arrived — still the list from BEFORE the action — found nothing, fell back to
  // "a video", and showed a story that landed first as the faceless video's result.
  assert.ok(queue.includes("queuedHere.getStore()?.push(job.id);\n  return job.id;"), "every job queued inside a request is noted");
  assert.ok(queue.includes("export async function collectingJobs<T>(work: () => Promise<T>): Promise<{ result: T; jobIds: string[] }> {\n  const jobIds: string[] = [];\n  const result = await queuedHere.run(jobIds, work);\n  return { result, jobIds };\n}"));
  const studio = read("app", "routes", "web.studio.tsx");
  const wrap = studio.slice(studio.indexOf("export const action = async (args: ActionFunctionArgs) => {"), studio.indexOf("const studioAction = async ({ request }: ActionFunctionArgs) => {"));
  assert.ok(wrap.includes("const { result, jobIds } = await collectingJobs(() => studioAction(args));"));
  assert.ok(wrap.includes("if (!jobIds.length || !(result instanceof Response)) return result;"), "nothing queued: the answer exactly as it was");
  assert.ok(wrap.includes('if (data && typeof data === "object" && "queued" in data) {'), "only beside `queued`");
  assert.ok(wrap.includes("return json({ ...data, jobIds }, { status: result.status, headers });"));
  assert.ok(wrap.includes('headers.delete("content-length");'), "the body grew");
  // the Stage: the job it was told; else the list — and the list is looked at again when it comes back
  assert.ok(studio.includes("watchedJobRef.current = Array.isArray(told) && told.length === 1 && typeof told[0] === \"string\"\n        ? told[0]\n        : queuedJob(queuedKindRef.current, d.recentGens || [], Date.now() - 20_000);"));
  const land = studio.slice(studio.indexOf("if (!watchedJobRef.current && queuedKindRef.current) {"), studio.indexOf("const fresh = d.recent.find("));
  assert.ok(land.includes("watchedJobRef.current = queuedJob(queuedKindRef.current, d.recentGens || [], makingStartedRef.current - 20_000);"), "before any piece is judged");
  assert.ok(studio.includes('watchedJobRef.current = f.id; // picked back up after a reload: this is the job\n    queuedKindRef.current = "";'));
});
