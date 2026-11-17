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

/** Start this long before the first word, so its attack isn't clipped. */
export const LEAD_PAD = 0.12;
/** A continuing clip plays this much at normal speed first — it covers the dissolve from the previous
 *  clip (0.18 s), which only works while both sides move at the same pace. */
export const LEAD_HOLD = 0.2;
/** …then the rest of its lead-in is squeezed toward this length… */
export const LEAD_TARGET = 0.15;
/** …but never played faster than this (a turn of the head still has to read as a turn of the head). */
export const LEAD_MAX_SPEED = 3;
/** Keep this much after the last word — a breath, not a pause. (The next shot is seeded from a frame
 *  0.2 s before the end, so this also leaves the speaker time to close their mouth before that frame.) */
export const TAIL_KEEP = 0.45;
/** The film's LAST shot holds a little longer, so the film doesn't stop on the final syllable. */
export const TAIL_KEEP_LAST = 1.0;

export type TrimPlan = {
  /** Drop everything before this point (0 = keep the start). Only for a clip that opens on a new picture. */
  cutHead: number;
  /** For a clip that continues the previous one: play [hold, leadEnd] `speed`× faster instead of cutting it. */
  retime: { hold: number; leadEnd: number; speed: number } | null;
  /** Stop here (= the clip's length when there is nothing to trim off the end). */
  endAt: number;
};

/** Decide the trim for one clip of length `dur` from its silence runs. `chained` = this clip was seeded
 *  from the previous clip's last frame, so its first frames must survive. */
export function planClipTrim(runs: SilenceRun[], dur: number, opts: { chained: boolean; tailKeep?: number }): TrimPlan {
  const none: TrimPlan = { cutHead: 0, retime: null, endAt: dur };
  if (!(dur > 0) || !runs.length) return none;

  // Lead-in: a silence that starts at (or right by) the top of the clip and ends well before its end.
  const first = runs[0];
  const lead = first.start <= 0.3 && first.end !== null && first.end > 0.35 && first.end < dur - 0.5 ? first.end : 0;
  const leadEnd = lead > 0 ? Math.max(0, lead - LEAD_PAD) : 0;

  // Dead tail: the LAST silence, when it reaches the end of the clip — open, or closed at the end.
  const last = runs[runs.length - 1];
  const reachesEnd = last.end === null || last.end >= dur - 0.15;
  let endAt = dur;
  if (reachesEnd && last.start > leadEnd + 1.0 && last.start < dur - 0.3) endAt = Math.min(dur, last.start + (opts.tailKeep ?? TAIL_KEEP));

  if (!opts.chained) return { cutHead: leadEnd > 0.15 ? leadEnd : 0, retime: null, endAt };

  let retime: TrimPlan["retime"] = null;
  const span = leadEnd - LEAD_HOLD;
  if (span > 0.3) {
    const speed = Math.min(LEAD_MAX_SPEED, span / LEAD_TARGET);
    if (speed > 1.15) retime = { hold: LEAD_HOLD, leadEnd, speed };
  }
  return { cutHead: 0, retime, endAt };
}

/** How long the clip is once the plan is applied. */
export function plannedSeconds(plan: TrimPlan): number {
  const squeezed = plan.retime ? (plan.retime.leadEnd - plan.retime.hold) * (1 - 1 / plan.retime.speed) : 0;
  return plan.endAt - plan.cutHead - squeezed;
}

/** True when the plan changes nothing worth a re-encode. */
export function isNoopTrim(plan: TrimPlan, dur: number): boolean {
  return !plan.retime && plan.cutHead <= 0.15 && plan.endAt >= dur - 0.2;
}
