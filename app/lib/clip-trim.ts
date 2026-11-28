// Where to trim a rendered dialogue clip — pure, so it is unit-tested (tests/clip-trim.test.ts).
//
// A dialogue clip arrives with dead air on both ends: the video model waits about a second before the
// line starts, and holds for a second or so after it ends. Two things went wrong with removing it:
//
//  1. The END was never trimmed. The old test for "this silence runs to the end of the clip" was "it
//     has no silence_end" — but ffmpeg closes a trailing silence with a silence_end AT the end of the
//     file, so the test was never true and every clip kept its whole dead tail.
//
//  2. The START was CUT, on every clip. A clip that continues the previous one is seeded from that
//     clip's last frame, and the 0.18 s dissolve between them is invisible only because the two frames
//     match. Cutting the first second off threw the matching frames away: the cut landed on whatever
//     pose the actors had drifted into by the time the line began, and the dissolve smeared between two
//     different pictures (measured on a real film: the two sides of the cut were 0.81 similar, against
//     0.97 for the frames that were cut off).
//
// So: the end is cut just after the last word; and a clip that CONTINUES the previous one keeps its
// first frames and plays the rest of its lead-in FAST instead of dropping it — the cut stays seamless
// and the reply still comes quickly. Only a clip that opens on a deliberately new picture (the first
// shot, a new location, a new camera angle) has its lead-in cut.

export type SilenceRun = { start: number; end: number | null };

/** ffmpeg `silencedetect` output → silence runs, in order. A run still open when the file ends has
 *  `end: null` on older builds; newer ones close it with a silence_end at the file's end. */
export function parseSilences(stderr: string): SilenceRun[] {
  const runs: SilenceRun[] = [];
  const re = /silence_(start|end):\s*(-?[\d.]+)/g;
  let open: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr || "")) !== null) {
    const v = parseFloat(m[2]);
    if (Number.isNaN(v)) continue;
    if (m[1] === "start") {
      if (open !== null) runs.push({ start: open, end: null });
      open = Math.max(0, v);
    } else {
      runs.push({ start: open ?? 0, end: v });
      open = null;
    }
  }
  if (open !== null) runs.push({ start: open, end: null });
  return runs;
}

/** The ffmpeg filter the runs come from. 0.35 s is the shortest quiet worth acting on: at 0.6 s a
 *  half-second lead-in went unseen, so a film opened on dead air. */
export const SILENCE_FILTER = "silencedetect=noise=-33dB:d=0.35";

/** Start this long before the first word, so its attack isn't clipped. */
export const LEAD_PAD = 0.12;
/** A continuing clip plays this much at normal speed first — it covers the dissolve from the previous
 *  clip (0.18 s), which only works while both sides move at the same pace. */
export const LEAD_HOLD = 0.2;
/** …then the rest of its lead-in is squeezed toward this length… */
export const LEAD_TARGET = 0.15;
/** …but never played faster than this (a turn of the head still has to read as a turn of the head). */
// (1.25, not 3 — 2026-11-28, the owner, of films whose every shot now has something HAPPEN in it: "there are a few spots
//  where they travel in fast motion like something's wrong". At 3x a walk before a line was a scurry; a quarter faster is
//  not seen.)
export const LEAD_MAX_SPEED = 1.25;
/** Keep this much after the last word — a breath, not a pause. (The next shot is seeded from a frame
 *  0.2 s before the end, so this also leaves the speaker time to close their mouth before that frame.) */
export const TAIL_KEEP = 0.45;
/** The film's LAST shot holds a little longer, so the film doesn't stop on the final syllable. */
export const TAIL_KEEP_LAST = 1.0;
/** …and when the take itself ran out before that (the line finished on its last frames), the final
 *  frame is held for up to this long to make up the difference. */
export const END_HOLD_MAX = 0.8;

export type TrimPlan = {
  /** Drop everything before this point (0 = keep the start). Only for a clip that opens on a new picture. */
  cutHead: number;
  /** For a clip that continues the previous one: play [hold, leadEnd] `speed`× faster instead of cutting it. */
  retime: { hold: number; leadEnd: number; speed: number } | null;
  /** Stop here (= the clip's length when there is nothing to trim off the end). */
  endAt: number;
  /** Hold the final frame this long after `endAt` (the film's last shot only; 0 otherwise). */
  holdEnd: number;
};

/** Decide the trim for one clip of length `dur` from its silence runs. `chained` = this clip was seeded
 *  from the previous clip's last frame, so its first frames must survive. */
export function planClipTrim(runs: SilenceRun[], dur: number, opts: { chained: boolean; last?: boolean }): TrimPlan {
  // a last shot with no quiet at all after its line still gets its hold
  const none: TrimPlan = { cutHead: 0, retime: null, endAt: dur, holdEnd: opts.last && dur > 0 ? END_HOLD_MAX : 0 };
  if (!(dur > 0) || !runs.length) return none;
  const tailKeep = opts.last ? TAIL_KEEP_LAST : TAIL_KEEP;

  // Lead-in: a silence that starts at (or right by) the top of the clip and ends well before its end.
  const first = runs[0];
  const lead = first.start <= 0.3 && first.end !== null && first.end > 0.35 && first.end < dur - 0.5 ? first.end : 0;
  const leadEnd = lead > 0 ? Math.max(0, lead - LEAD_PAD) : 0;

  // Dead tail: the LAST silence, when it reaches the end of the clip — open, or closed at the end.
  const last = runs[runs.length - 1];
  const reachesEnd = last.end === null || last.end >= dur - 0.15;
  let endAt = dur;
  if (reachesEnd && last.start > leadEnd + 1.0 && last.start < dur - 0.3) endAt = Math.min(dur, last.start + tailKeep);
  // The film's last shot: however much quiet the take has after its line, make it up to a full beat.
  let holdEnd = 0;
  if (opts.last) {
    const quiet = reachesEnd && last.start > leadEnd + 1.0 ? Math.max(0, endAt - last.start) : 0;
    const need = Math.min(END_HOLD_MAX, TAIL_KEEP_LAST - quiet);
    if (need > 0.15) holdEnd = need;
  }

  if (!opts.chained) return { cutHead: leadEnd > 0.15 ? leadEnd : 0, retime: null, endAt, holdEnd };

  let retime: TrimPlan["retime"] = null;
  const span = leadEnd - LEAD_HOLD;
  if (span > 0.3) {
    const speed = Math.min(LEAD_MAX_SPEED, span / LEAD_TARGET);
    if (speed > 1.15) retime = { hold: LEAD_HOLD, leadEnd, speed };
  }
  return { cutHead: 0, retime, endAt, holdEnd };
}

// ── TRIMMING ON THE WORDS ───────────────────────────────────────────────────────────────────────────
// Silence alone can't tell a breath from a word. A fal take of "The Watch in Her Hands" (2026-11-19)
// opened on a 0.4 s breath, then 0.9 s of quiet, a 60 ms click, and 0.9 s more before "Grandpa," — the
// lead-in test wants quiet from the top of the clip, so it saw no lead-in, and the film opened on 2.2 s of
// a girl standing silent. The heard words (whisperx) say exactly where the line starts and ends; the
// measured silence then CONFIRMS that what the words would cut is really quiet, so a growl, a laugh or a
// gasp the transcriber didn't write down is never cut away.

export type TimedWord = { start: number; end: number };

/** Heard words → the quiet around them, as the runs planClipTrim reads: before the first word, the gaps
 *  between words, and after the last one. */
export function silencesFromWords(words: TimedWord[], dur: number, minGap = 0.35): SilenceRun[] {
  const w = words
    .filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start && x.start >= 0 && x.start < dur)
    .sort((a, b) => a.start - b.start);
  if (!w.length) return [];
  const runs: SilenceRun[] = [];
  if (w[0].start >= minGap) runs.push({ start: 0, end: w[0].start });
  let lastEnd = w[0].end;
  for (let i = 1; i < w.length; i++) {
    if (w[i].start - lastEnd >= minGap) runs.push({ start: lastEnd, end: w[i].start });
    lastEnd = Math.max(lastEnd, w[i].end);
  }
  if (dur - lastEnd >= minGap) runs.push({ start: lastEnd, end: dur });
  return runs;
}

/** How much of [a, b] the measured silence covers, 0–1. */
export function quietShare(runs: SilenceRun[], a: number, b: number, dur: number): number {
  if (!(b > a)) return 1;
  let q = 0;
  for (const r of runs) {
    const s = Math.max(a, r.start), e = Math.min(b, r.end ?? dur);
    if (e > s) q += e - s;
  }
  return Math.min(1, q / (b - a));
}

/** Below this share of measured quiet, a stretch the words call empty is treated as sound we can't name. */
export const QUIET_CONFIRM = 0.6;

/** The trim from the heard words — or null when the measured silence doesn't back it up (then the caller
 *  trims on silence alone, as before). `measured` = silencedetect runs of the same clip. */
export function planFromWords(words: TimedWord[], measured: SilenceRun[], dur: number, opts: { chained: boolean; last?: boolean }): TrimPlan | null {
  if (words.length < 2) return null;
  const plan = planClipTrim(silencesFromWords(words, dur), dur, opts);
  const head = plan.retime ? plan.retime.leadEnd : plan.cutHead;
  if (head > 0.15 && quietShare(measured, 0, head, dur) < QUIET_CONFIRM) return null;
  if (plan.endAt < dur - 0.2 && quietShare(measured, plan.endAt, dur, dur) < QUIET_CONFIRM) return null;
  return plan;
}

/** A long pause between two words is taken down to this beat. */
export const PAUSE_KEEP = 0.22;
/** …when it is longer than this. */
export const PAUSE_MIN = 1.0;

/** The ONE longest pause between two heard words (over PAUSE_MIN, confirmed quiet), as the span to cut:
 *  keep [0, keep1], resume at start2. Null when there's none, or a side would be left too short. */
export function interiorCutFromWords(words: TimedWord[], measured: SilenceRun[], dur: number): { keep1: number; start2: number } | null {
  const w = words.filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start).sort((a, b) => a.start - b.start);
  let best: { a: number; b: number } | null = null;
  let lastEnd = w.length ? w[0].end : 0;
  for (let i = 1; i < w.length; i++) {
    const a = lastEnd, b = w[i].start;
    if (b - a > PAUSE_MIN && quietShare(measured, a, b, dur) >= 0.7 && (!best || b - a > best.b - best.a)) best = { a, b };
    lastEnd = Math.max(lastEnd, w[i].end);
  }
  if (!best) return null;
  const keep1 = +(best.a + PAUSE_KEEP).toFixed(2);
  const start2 = +Math.max(keep1, best.b - LEAD_PAD).toFixed(2);
  if (keep1 < 0.6 || dur - start2 < 0.6 || start2 - keep1 < 0.5) return null;
  return { keep1, start2 };
}

/** How far a word heard at time t in the raw clip moves once the plan is applied (it moves earlier by
 *  the cut head, or by what the sped-up lead-in saved). Words are all after the lead-in. */
export function planShift(plan: TrimPlan): number {
  const squeezed = plan.retime ? (plan.retime.leadEnd - plan.retime.hold) * (1 - 1 / plan.retime.speed) : 0;
  return plan.cutHead + squeezed;
}

/** How long the clip is once the plan is applied. */
export function plannedSeconds(plan: TrimPlan): number {
  const squeezed = plan.retime ? (plan.retime.leadEnd - plan.retime.hold) * (1 - 1 / plan.retime.speed) : 0;
  return plan.endAt - plan.cutHead - squeezed + plan.holdEnd;
}

/** True when the plan changes nothing worth a re-encode. */
export function isNoopTrim(plan: TrimPlan, dur: number): boolean {
  return !plan.retime && plan.cutHead <= 0.15 && plan.endAt >= dur - 0.2 && !(plan.holdEnd > 0);
}
