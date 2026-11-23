/* The posting queue's clock — "Coming up" on the Auto-post page.
 *
 * A member adds finished pieces to a queue and each one posts itself at the next good time. A "good
 * time" is a fixed wall time in the shop's own day, chosen by how many posts a day it wants:
 *
 *   1 a day → 18:00            (the evening scroll)
 *   2 a day → 12:00, 18:00     (lunch, evening)
 *   3 a day → 09:00, 13:00, 19:00
 *
 * Pure — no database, no clock of its own — so the maths is tested directly (tests/post-queue.test.ts).
 * Wall times become instants through timezone.ts, the same helper the campaign calendar and poster use,
 * so a queue slot and a campaign slot agree about what "18:00" means for a shop in Lahore or Sydney.
 */

import { zonedDateString, zonedInstant } from "./timezone.ts";

export type PerDay = 1 | 2 | 3;

/** The wall times a day holds, by posts per day. */
export const QUEUE_SLOT_TIMES: Record<PerDay, readonly string[]> = {
  1: ["18:00"],
  2: ["12:00", "18:00"],
  3: ["09:00", "13:00", "19:00"],
};

/** A slot is never handed out sooner than this from now — time to change your mind, and time for the
 *  worker to be the one who sends it rather than a race with the click that queued it. */
export const QUEUE_MIN_LEAD_MS = 10 * 60_000;

/** Pending pieces a shop may hold at once (60 = a month at two a day). */
export const QUEUE_CAP = 60;

/** Anything that is not 2 or 3 is 1 — the default, and the safest pace for a new account. */
export function normalizePerDay(n: unknown): PerDay {
  const v = typeof n === "string" ? parseInt(n, 10) : Number(n);
  return v === 2 || v === 3 ? v : 1;
}

const ms = (v: Date | number | string): number => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v));

/** "YYYY-MM-DD" plus `days`. Read and written at UTC midnight, so no DST can shift it. */
export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The next `count` free slots, in order.
 *
 * - never sooner than QUEUE_MIN_LEAD_MS after `now`
 * - strictly after `after`, when given (a new piece goes behind the last one already waiting, so the
 *   queue keeps the order things were added in)
 * - never an instant in `taken` (compared to the minute, so a stored dueAt matches its slot)
 */
export function nextFreeSlots(opts: {
  now: Date | number;
  tz?: string | null;
  perDay: number;
  count: number;
  taken?: ReadonlyArray<Date | number | string>;
  after?: Date | number | string | null;
}): Date[] {
  const out: Date[] = [];
  if (!(opts.count > 0)) return out;
  const now = ms(opts.now);
  const earliest = now + QUEUE_MIN_LEAD_MS;
  const after = opts.after == null ? -Infinity : ms(opts.after);
  const minute = (t: number) => Math.floor(t / 60_000);
  const taken = new Set((opts.taken || []).map((v) => minute(ms(v))).filter(Number.isFinite));
  const times = QUEUE_SLOT_TIMES[normalizePerDay(opts.perDay)];

  // Start the day before "today" in the shop's zone: a slot late yesterday in local terms can never be
  // in the future, but starting a day early costs nothing and cannot miss a slot at a date boundary.
  let day = addDays(zonedDateString(new Date(Math.max(now, Number.isFinite(after) ? after : now)), opts.tz), -1);
  // A full year of days is far more than QUEUE_CAP needs at one a day; the bound only stops a bad input
  // from spinning forever.
  for (let guard = 0; guard < 400 && out.length < opts.count; guard++, day = addDays(day, 1)) {
    for (const hhmm of times) {
      const at = zonedInstant(day, hhmm, opts.tz).getTime();
      if (!Number.isFinite(at)) continue;
      if (at < earliest || at <= after || taken.has(minute(at))) continue;
      out.push(new Date(at));
      if (out.length >= opts.count) break;
    }
  }
  return out;
}

/** "today" | "tomorrow" | the row's own "YYYY-MM-DD" — how the list groups its rows, in the shop's day. */
export function dayBucket(instant: Date | number | string, now: Date | number, tz?: string | null): string {
  const d = zonedDateString(new Date(ms(instant)), tz);
  const today = zonedDateString(new Date(ms(now)), tz);
  if (d <= today) return "today";
  if (d === addDays(today, 1)) return "tomorrow";
  return d;
}

/* ---- the week at a glance ----
 * "Coming up" is a list, a day at a time. What a list does not show is the SHAPE of the week: the days
 * something goes out, and the day the queue runs dry. Every scheduler people come from opens on that
 * picture (a calendar); here it is one strip of seven days over the list — nothing new to learn or set.
 *
 * A queued piece counts on the day it is due (one already due counts today). A channel's NEXT drop is
 * known exactly; the ones after it are worked out from how often the channel posts (`everyHours`), so a
 * daily channel shows on every day of the strip and not only on its next one. */
export type WeekDay = {
  /** the day, "YYYY-MM-DD", in the shop's own calendar */
  date: string;
  /** how the list below names the same day: "today" | "tomorrow" | the date (dayBucket) */
  bucket: string;
  /** queued pieces due that day, and channel drops (the next one, and the ones worked out after it) */
  pieces: number;
  drops: number;
};

/** The next `days` days of the shop's calendar, starting today, with what goes out on each. */
export function weekAhead(
  rows: ReadonlyArray<{ kind: "piece" | "drop"; at: Date | number | string; everyHours?: number | null }>,
  now: Date | number,
  tz?: string | null,
  days = 7,
): WeekDay[] {
  const from = ms(now);
  const today = zonedDateString(new Date(from), tz);
  const week: WeekDay[] = Array.from({ length: Math.max(1, days) }, (_, i) => ({
    date: addDays(today, i), bucket: i === 0 ? "today" : i === 1 ? "tomorrow" : addDays(today, i), pieces: 0, drops: 0,
  }));
  const last = week[week.length - 1].date;
  const dayOf = (at: number): string => { const d = zonedDateString(new Date(at), tz); return d < today ? today : d; };
  const put = (at: number, what: "pieces" | "drops") => { const day = week.find((w) => w.date === dayOf(at)); if (day) day[what]++; };
  for (const r of rows) {
    const at = ms(r.at);
    if (!Number.isFinite(at)) continue;
    if (r.kind === "piece") { put(at, "pieces"); continue; }
    // a drop that is already due goes out now, and the channel's next ones are counted on from then
    const every = typeof r.everyHours === "number" && r.everyHours > 0 ? r.everyHours * 3_600_000 : 0;
    for (let t = Math.max(at, from), n = 0; n < 60 && dayOf(t) <= last; t += every, n++) {
      put(t, "drops");
      if (!every) break;
    }
  }
  return week;
}

/** The last day of the strip a QUEUED piece goes out on — null when the queue has nothing in the strip,
 *  and null when it reaches the strip's last day (it does not run dry this week). */
export function queueRunsOut(week: ReadonlyArray<WeekDay>): string | null {
  let lastWith = -1;
  week.forEach((d, i) => { if (d.pieces > 0) lastWith = i; });
  return lastWith < 0 || lastWith === week.length - 1 ? null : week[lastWith].date;
}
