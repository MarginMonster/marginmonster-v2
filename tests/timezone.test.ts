/* The scheduler's times are wall times in a merchant's own day: "evening scroll
 * peak" at 19:00, "lunch break" at 12:00, "morning coffee reads" at 09:00.
 *
 * They were turned into instants with `new Date("2026-09-01T19:00:00")`, which
 * has no offset and so resolves in the RUNTIME's zone — UTC in the container.
 * The evening slot therefore posted at noon for a US Pacific merchant and at
 * five the next MORNING for one in Sydney.
 *
 * These tests pin the conversion, including the two cases that break a naive
 * implementation: the DST boundaries, and the day-number arithmetic that was
 * off by one whenever a campaign was created in the afternoon. */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  zonedInstant,
  zonedDateString,
  calendarDaysBetween,
  isValidTimeZone,
  offsetMs,
} from "../app/lib/timezone.ts";

const at = (d: string, t: string, tz: string) => zonedInstant(d, t, tz).toISOString();

test("7pm means 7pm where the merchant is", () => {
  // Winter: Pacific is UTC-8, Sydney UTC+11.
  assert.equal(at("2026-01-15", "19:00", "America/Los_Angeles"), "2026-01-16T03:00:00.000Z");
  assert.equal(at("2026-01-15", "19:00", "Australia/Sydney"), "2026-01-15T08:00:00.000Z");
  assert.equal(at("2026-01-15", "19:00", "Europe/London"), "2026-01-15T19:00:00.000Z");
  assert.equal(at("2026-01-15", "19:00", "UTC"), "2026-01-15T19:00:00.000Z");
});

test("the old behaviour, for contrast", () => {
  // What the scheduler did: parse without an offset, in a UTC container.
  const old = new Date("2026-01-15T19:00:00Z"); // container-local == UTC
  const correct = zonedInstant("2026-01-15", "19:00", "America/Los_Angeles");
  assert.equal(correct.getTime() - old.getTime(), 8 * 3600_000, "Pacific was posting 8 hours early");
});

test("summer time is followed, not assumed", () => {
  // Same wall time, different offsets — the zone's own DST rules decide.
  assert.equal(at("2026-07-15", "19:00", "America/Los_Angeles"), "2026-07-16T02:00:00.000Z");
  assert.equal(at("2026-07-15", "19:00", "Europe/London"), "2026-07-15T18:00:00.000Z");
  assert.equal(at("2026-07-15", "19:00", "Australia/Sydney"), "2026-07-15T09:00:00.000Z");
});

test("a wall time on the spring-forward day still resolves", () => {
  // 2026-03-08, US spring forward: 02:00 does not exist in local time. It must
  // produce a real instant rather than NaN or a throw.
  const d = zonedInstant("2026-03-08", "02:30", "America/Los_Angeles");
  assert.ok(Number.isFinite(d.getTime()), "spring-forward gap produced an invalid date");
  // 09:00 the same day is unambiguous and after the shift: PDT is UTC-7.
  assert.equal(at("2026-03-08", "09:00", "America/Los_Angeles"), "2026-03-08T16:00:00.000Z");
});

test("a wall time on the fall-back day resolves to one of the two candidates", () => {
  // 2026-11-01, US fall back: 01:30 happens twice. Either is defensible; it
  // must not be NaN and must be within the hour of ambiguity.
  const d = zonedInstant("2026-11-01", "01:30", "America/Los_Angeles");
  assert.ok(Number.isFinite(d.getTime()));
  const pdt = Date.parse("2026-11-01T08:30:00Z"); // UTC-7
  const pst = Date.parse("2026-11-01T09:30:00Z"); // UTC-8
  assert.ok(d.getTime() === pdt || d.getTime() === pst, `got ${d.toISOString()}`);
});

test("half-hour and unusual zones work", () => {
  assert.equal(at("2026-01-15", "12:00", "Asia/Kolkata"), "2026-01-15T06:30:00.000Z");
  assert.equal(at("2026-01-15", "12:00", "Asia/Kathmandu"), "2026-01-15T06:15:00.000Z");
  // Chatham is +13:45 in January (it observes DST) and +12:45 in July —
  // verified against Intl directly, not assumed.
  assert.equal(at("2026-01-15", "12:00", "Pacific/Chatham"), "2026-01-14T22:15:00.000Z");
  assert.equal(at("2026-07-15", "12:00", "Pacific/Chatham"), "2026-07-14T23:15:00.000Z");
});

test("an unknown or missing zone falls back to UTC rather than throwing", () => {
  // A bad zone must never stop a drop from posting.
  assert.equal(at("2026-01-15", "19:00", "Mars/Olympus_Mons"), "2026-01-15T19:00:00.000Z");
  assert.equal(zonedInstant("2026-01-15", "19:00", null).toISOString(), "2026-01-15T19:00:00.000Z");
  assert.equal(zonedInstant("2026-01-15", "19:00", "").toISOString(), "2026-01-15T19:00:00.000Z");
});

test("a malformed time falls back to midday, which cannot slip a date", () => {
  assert.equal(at("2026-01-15", "nonsense", "UTC"), "2026-01-15T12:00:00.000Z");
  assert.equal(at("2026-01-15", "7pm", "UTC"), "2026-01-15T12:00:00.000Z");
});

test("a malformed date is an invalid date, not a wrong one", () => {
  assert.ok(Number.isNaN(zonedInstant("not-a-date", "19:00", "UTC").getTime()));
});

test("the merchant's calendar date is theirs, not the server's", () => {
  // 2026-01-16T03:00Z is still the 15th in Los Angeles.
  const instant = new Date("2026-01-16T03:00:00Z");
  assert.equal(zonedDateString(instant, "America/Los_Angeles"), "2026-01-15");
  assert.equal(zonedDateString(instant, "UTC"), "2026-01-16");
  assert.equal(zonedDateString(instant, null), "2026-01-16");
});

test("day numbers count calendar days, not rounded timestamps", () => {
  // The bug: a campaign created at 20:00 made its second calendar day "day 1",
  // because a midnight minus an afternoon rounds down.
  assert.equal(calendarDaysBetween("2026-09-01", "2026-09-02"), 1);
  assert.equal(calendarDaysBetween("2026-09-01", "2026-09-03"), 2);
  assert.equal(calendarDaysBetween("2026-09-01", "2026-09-01"), 0);
  assert.equal(calendarDaysBetween("2026-09-03", "2026-09-01"), -2);
});

test("day counting is unaffected by DST", () => {
  // A month containing a clock change still has whole days between dates —
  // the classic (b - a) / 86400000 bug is a 23- or 25-hour day rounding wrong.
  assert.equal(calendarDaysBetween("2026-03-07", "2026-03-09"), 2);
  assert.equal(calendarDaysBetween("2026-10-31", "2026-11-02"), 2);
  assert.equal(calendarDaysBetween("2026-01-01", "2026-12-31"), 364);
});

test("isValidTimeZone accepts real zones and refuses the rest", () => {
  assert.equal(isValidTimeZone("America/New_York"), true);
  assert.equal(isValidTimeZone("UTC"), true);
  assert.equal(isValidTimeZone("Not/AZone"), false);
  assert.equal(isValidTimeZone(""), false);
  assert.equal(isValidTimeZone(null), false);
  assert.equal(isValidTimeZone(undefined), false);
});

test("offsetMs reports the zone's real offset", () => {
  assert.equal(offsetMs(new Date("2026-01-15T12:00:00Z"), "America/Los_Angeles"), -8 * 3600_000);
  assert.equal(offsetMs(new Date("2026-07-15T12:00:00Z"), "America/Los_Angeles"), -7 * 3600_000);
  assert.equal(offsetMs(new Date("2026-01-15T12:00:00Z"), "UTC"), 0);
});
