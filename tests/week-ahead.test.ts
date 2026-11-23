/* THE WEEK AT A GLANCE — one strip of seven days over "Coming up".
 *
 * Added 2026-11-23. The posting queue is a list, a day at a time; what a list does not show is the shape
 * of the week — the days something goes out, and the day the queue runs dry. Buffer and Later open on
 * that picture (a calendar). Here it is one strip inside the section that already exists: nothing to
 * set, nothing to learn, and it is not there at all when nothing is coming up.
 *
 *   1. THE COUNTING (app/lib/post-queue.ts → weekAhead, queueRunsOut — pure) is RUN here: the shop's own
 *      calendar day, a piece already due counts today, a channel's later drops worked out from how often
 *      it posts, nothing past the seventh day.
 *   2. THE PAGE (app/routes/web.autopost.tsx) is pinned by reading it: only what GOES OUT is counted, a
 *      day links to its group only when the list has one, and every word of it is translated. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dayBucket, queueRunsOut, weekAhead } from "../app/lib/post-queue.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const NY = "America/New_York";
// a Monday, half past noon in New York
const NOW = Date.parse("2026-11-23T17:30:00Z");
const shape = (w: ReturnType<typeof weekAhead>) => w.map((d) => `${d.date.slice(8)}:${d.pieces}+${d.drops}`).join(" ");

test("seven days of the shop's own calendar, starting today — named the way the list names them", () => {
  const w = weekAhead([], NOW, NY);
  assert.deepEqual(w.map((d) => d.date), ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
  assert.deepEqual(w.map((d) => d.bucket), ["today", "tomorrow", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
  // …the very names dayBucket gives a row due on each of those days, so a day can link to its group
  w.forEach((d) => assert.equal(dayBucket(`${d.date}T20:00:00Z`, NOW, NY), d.bucket));
  assert.ok(w.every((d) => d.pieces === 0 && d.drops === 0));
  // "today" is the shop's today: at 02:00 UTC on the 24th it is still the 23rd in New York — and already the 24th in Karachi
  const late = Date.parse("2026-11-24T02:00:00Z");
  assert.equal(weekAhead([], late, NY)[0].date, "2026-11-23");
  assert.equal(weekAhead([], late, "Asia/Karachi")[0].date, "2026-11-24");
  assert.equal(weekAhead([], late, null)[0].date, "2026-11-24", "no zone: UTC");
  assert.equal(weekAhead([], late, "Not/AZone")[0].date, "2026-11-24");
});

test("a queued piece counts on the day it is due — one already due counts today, one past the strip not at all", () => {
  const w = weekAhead([
    { kind: "piece", at: "2026-11-23T23:00:00Z" }, // 18:00 today in New York
    { kind: "piece", at: "2026-11-24T23:00:00Z" }, // 18:00 tomorrow
    { kind: "piece", at: "2026-11-22T23:00:00Z" }, // was due yesterday: it goes out now
    { kind: "piece", at: "2026-11-25T03:30:00Z" }, // 22:30 on the 24th in New York — not the 25th
    { kind: "piece", at: "2026-12-20T23:00:00Z" }, // weeks away
    { kind: "piece", at: "not a time" },
  ], NOW, NY);
  assert.equal(shape(w), "23:2+0 24:2+0 25:0+0 26:0+0 27:0+0 28:0+0 29:0+0");
  // the same pieces in Karachi fall on other days — its 18:00 is another instant, and so is its midnight
  assert.equal(shape(weekAhead([{ kind: "piece", at: "2026-11-25T03:30:00Z" }], NOW, "Asia/Karachi")), "23:0+0 24:0+0 25:1+0 26:0+0 27:0+0 28:0+0 29:0+0");
  // a Date and a number are taken as well as a string
  assert.equal(weekAhead([{ kind: "piece", at: new Date(NOW + 3_600_000) }, { kind: "piece", at: NOW + 2 * 86_400_000 }], NOW, NY).map((d) => d.pieces).join(""), "1010000");
});

test("a channel shows on every day it will post — its later drops are worked out from how often it posts", () => {
  // three times a week: the next one tomorrow 09:00, then every 56 hours
  const three = weekAhead([{ kind: "drop", at: "2026-11-24T14:00:00Z", everyHours: 56 }], NOW, NY);
  assert.equal(shape(three), "23:0+0 24:0+1 25:0+0 26:0+1 27:0+0 28:0+0 29:0+1");
  // daily, next one this evening: every day of the strip
  const daily = weekAhead([{ kind: "drop", at: "2026-11-23T23:00:00Z", everyHours: 24 }], NOW, NY);
  assert.equal(shape(daily), "23:0+1 24:0+1 25:0+1 26:0+1 27:0+1 28:0+1 29:0+1");
  // twice a day and already due: it goes out now, and is counted on from now — one more today at half past midnight? no: that is tomorrow
  const twice = weekAhead([{ kind: "drop", at: "2026-11-23T10:00:00Z", everyHours: 12 }], NOW, NY);
  assert.equal(shape(twice), "23:0+1 24:0+2 25:0+2 26:0+2 27:0+2 28:0+2 29:0+2");
  // how often is not known (or is nonsense): the next drop alone
  for (const everyHours of [undefined, null, 0, -5, NaN]) {
    assert.equal(shape(weekAhead([{ kind: "drop", at: "2026-11-25T15:00:00Z", everyHours }], NOW, NY)), "23:0+0 24:0+0 25:0+1 26:0+0 27:0+0 28:0+0 29:0+0");
  }
  // a first drop past the strip is not in it; a silly interval cannot run away
  assert.ok(weekAhead([{ kind: "drop", at: "2026-12-05T15:00:00Z", everyHours: 24 }], NOW, NY).every((d) => d.drops === 0));
  const mad = weekAhead([{ kind: "drop", at: NOW, everyHours: 0.01 }], NOW, NY);
  assert.ok(mad.reduce((n, d) => n + d.drops, 0) <= 60);
  // pieces and drops on the same day are both there
  assert.equal(shape(weekAhead([{ kind: "piece", at: "2026-11-24T23:00:00Z" }, { kind: "drop", at: "2026-11-24T14:00:00Z", everyHours: 56 }], NOW, NY)).split(" ")[1], "24:1+1");
});

test("the day the queue runs dry — and no word when it does not", () => {
  const dry = (rows: Parameters<typeof weekAhead>[0]) => queueRunsOut(weekAhead(rows, NOW, NY));
  assert.equal(dry([]), null, "nothing queued: nothing to run out");
  assert.equal(dry([{ kind: "drop", at: "2026-11-24T14:00:00Z", everyHours: 24 }]), null, "a channel posts by itself — it is the QUEUE that runs dry");
  assert.equal(dry([{ kind: "piece", at: "2026-11-23T23:00:00Z" }, { kind: "piece", at: "2026-11-24T23:00:00Z" }, { kind: "piece", at: "2026-11-25T23:00:00Z" }]), "2026-11-25");
  assert.equal(dry([{ kind: "piece", at: "2026-11-23T23:00:00Z" }]), "2026-11-23");
  // a gap in the middle (a piece was removed) does not end it early
  assert.equal(dry([{ kind: "piece", at: "2026-11-23T23:00:00Z" }, { kind: "piece", at: "2026-11-27T23:00:00Z" }]), "2026-11-27");
  // it reaches the last day of the strip: it does not run dry this week
  const full = Array.from({ length: 9 }, (_, i) => ({ kind: "piece" as const, at: NOW + 3_600_000 + i * 86_400_000 }));
  assert.equal(dry(full), null);
});

test("the page: only what goes out is counted, a day links only to a group that is there, and it is quiet when nothing is coming", () => {
  const page = read("app", "routes", "web.autopost.tsx");
  // a drop held for approval makes a video and posts nothing
  assert.ok(page.includes("const days = weekAhead(queue.upcoming.filter((r) => r.kind === \"piece\" || r.autoPost), now, tz);"));
  // a calendar day is named at its own noon in UTC — no zone can turn it into its neighbour
  assert.ok(page.includes("const noon = (date: string) => new Date(`${date}T12:00:00Z`);"));
  assert.ok(page.includes("const wdFmt = new Intl.DateTimeFormat(lang, { weekday: \"short\", timeZone: \"UTC\" });"));
  assert.ok(page.includes("runsOut: dry ? dayFmt.format(noon(dry)) : null,"));
  // not there at all when the week is empty (the section's own empty state says what to do)
  assert.ok(page.includes("{d.week.some((w) => w.pieces + w.drops > 0) && ("));
  assert.ok(page.includes("return groups.some((g) => g.key === w.bucket)"));
  assert.ok(page.includes("<div className=\"ap-q-group\" key={g.key} id={`ap-day-${g.key}`}>"));
  assert.ok(page.includes("href={`#ap-day-${w.bucket}`}"));
  // seven days in one row at every width, and a day is said aloud in full
  assert.ok(page.includes(".ap-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px;"));
  assert.ok(page.includes("aria-label={say} title={say}"));
  assert.ok(page.includes("{d.runsOut && ("));
  // the list's loader says how often a channel posts
  const srv = read("app", "lib", "post-queue.server.ts");
  assert.ok(srv.includes("select: { id: true, name: true, nextRunAt: true, platformsJson: true, autoPost: true, cadence: true },"));
  assert.ok(srv.includes("autoPost: s.autoPost, everyHours: cadenceOf(s.cadence).intervalHours,"));
  // every word of it, in every language the app speaks
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const s of ["The next seven days", "{date}: {n} post", "{date}: {n} posts", "{date}: nothing going out", "Your queue runs out after {date}.", "Add more from the Archive"]) {
    assert.ok(page.includes(`"${s}"`), s);
    assert.equal(dict.split(`\n  ${JSON.stringify(s)}: `).length - 1, 5, `five translations of “${s}”`);
  }
});
