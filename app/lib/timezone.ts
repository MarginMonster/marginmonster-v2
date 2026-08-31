/* Wall-clock times in the merchant's own timezone.
 *
 * The scheduler stores a drop as a date and a wall time — "2026-09-01", "19:00"
 * — and turned that into an instant with `new Date("2026-09-01T19:00:00")`. A
 * string with no offset is parsed in the RUNTIME's zone, and the container runs
 * in UTC, so every merchant's schedule was interpreted as UTC.
 *
 * That quietly defeats the whole point of the posting table, whose entries are
 * chosen for a human's day: "evening scroll peak" at 19:00, "lunch break" at
 * 12:00, "morning coffee reads" at 09:00. Interpreted as UTC, the evening slot
 * lands at noon for a US Pacific merchant and at five the next MORNING for one
 * in Sydney — the wrong time of day, and sometimes the wrong day entirely, on
 * the auto-posting they are paying for.
 *
 * No dependency: Intl already knows every zone's offset, including its history
 * of DST changes. Pure, so it is testable — see tests/timezone.test.ts.
 */

/** Milliseconds to add to UTC to get local wall time in `tz`, at `instant`. */
export function offsetMs(instant: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) p[part.type] = part.value;
  // "24" is a legal hour in this format at midnight; Date.UTC wants 0.
  const asWallUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second)
  );
  return asWallUtc - instant.getTime();
}

/** True for a string Intl will accept as a zone. Anything else falls back to
 *  UTC rather than throwing — a bad zone must never stop a drop from posting. */
export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The instant at which `date` `time` occurs in `tz`.
 *
 * Two passes, because the offset depends on the instant we are trying to find.
 * The first guess treats the wall time as UTC and corrects by the offset there;
 * across a DST boundary that guess can land on the wrong side, so the second
 * pass re-measures at the corrected instant. Two passes settle every real zone.
 *
 * @param date "YYYY-MM-DD"
 * @param time "HH:MM" (defaults to midday, which is what the calendar does for
 *             a slot with no time — and midday is the safest hour to guess,
 *             since it cannot slip across a date boundary in any zone)
 * @param tz   IANA zone; anything unrecognised is treated as UTC
 */
export function zonedInstant(date: string, time = "12:00", tz?: string | null): Date {
  const hhmm = /^\d{2}:\d{2}$/.test(time) ? time : "12:00";
  const naive = Date.parse(`${date}T${hhmm}:00Z`);
  if (!Number.isFinite(naive)) return new Date(NaN);
  if (!isValidTimeZone(tz)) return new Date(naive);

  let guess = naive - offsetMs(new Date(naive), tz);
  guess = naive - offsetMs(new Date(guess), tz);
  return new Date(guess);
}

/** The calendar date in `tz` for an instant — "YYYY-MM-DD".
 *
 *  toISOString().slice(0, 10) answers this question in UTC, which is a
 *  different day from the merchant's for a large part of every day. */
export function zonedDateString(instant: Date, tz?: string | null): string {
  if (!isValidTimeZone(tz)) return instant.toISOString().slice(0, 10);
  return new Date(instant.getTime() + offsetMs(instant, tz)).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to`, both "YYYY-MM-DD".
 *
 *  The scheduler used to subtract a real timestamp from a midnight and round
 *  the result, which is off by one whenever the questline was created in the
 *  afternoon: a drop on the second calendar day came out as "day 1". Comparing
 *  dates as dates has no such failure, and no DST failure either, because both
 *  sides are read at UTC midnight. */
export function calendarDaysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}
