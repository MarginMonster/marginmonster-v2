/* Trimming the dead air off a dialogue clip — and not breaking the cut while doing it.
 *
 * The numbers here are from a real film ("The Last Slice", 2026-11-17) whose transition the owner called
 * trash. Two things were wrong, both visible in ffmpeg's own output for those two shots:
 *   - the end of a shot was never trimmed (ffmpeg closes a trailing silence with a silence_end at the
 *     end of the file; the old code only believed in a trailing silence that had none), and
 *   - the start of the NEXT shot was cut off, which threw away the frames that matched the last shot. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSilences, planClipTrim, plannedSeconds, isNoopTrim, LEAD_HOLD, LEAD_MAX_SPEED, TAIL_KEEP, TAIL_KEEP_LAST, END_HOLD_MAX, SILENCE_FILTER } from "../app/lib/clip-trim.ts";

// ffmpeg silencedetect (noise=-33dB:d=0.6) on the two raw shots, verbatim.
const SHOT1 = `
[silencedetect @ 0000025f] silence_start: 0.231338
[silencedetect @ 0000025f] silence_end: 1.366281 | silence_duration: 1.134943
[silencedetect @ 0000025f] silence_start: 7.820975
[silencedetect @ 0000025f] silence_end: 9.032562 | silence_duration: 1.211587`;
const SHOT1_DUR = 9.041667;
const SHOT2 = `
[silencedetect @ 000002a5] silence_start: 0
[silencedetect @ 000002a5] silence_end: 1.220522 | silence_duration: 1.220522
[silencedetect @ 000002a5] silence_start: 4.487642
[silencedetect @ 000002a5] silence_end: 5.094422 | silence_duration: 0.60678`;
const SHOT2_DUR = 7.041667;

test("silence runs are read in order, closed or still open", () => {
  assert.deepEqual(parseSilences(SHOT1), [{ start: 0.231338, end: 1.366281 }, { start: 7.820975, end: 9.032562 }]);
  assert.deepEqual(parseSilences("silence_start: 0.1\nsilence_end: 0.9 | silence_duration: 0.8\nsilence_start: 6.2"), [{ start: 0.1, end: 0.9 }, { start: 6.2, end: null }]);
  assert.deepEqual(parseSilences("no silence here"), []);
});

test("the end of a shot is trimmed even when ffmpeg closes the trailing silence at the end of the file", () => {
  // this is the case that never fired: shot 1 kept its whole 1.2 s of dead tail
  const plan = planClipTrim(parseSilences(SHOT1), SHOT1_DUR, { chained: false });
  assert.ok(Math.abs(plan.endAt - (7.820975 + TAIL_KEEP)) < 1e-6, `ends at ${plan.endAt}`);
  assert.ok(plan.endAt < SHOT1_DUR - 0.7, "most of the 1.2 s dead tail must go");
});

test("…and still is when the trailing silence is left open (older ffmpeg)", () => {
  const plan = planClipTrim(parseSilences("silence_start: 0.23\nsilence_end: 1.36 | silence_duration: 1.13\nsilence_start: 7.82"), SHOT1_DUR, { chained: false });
  assert.ok(Math.abs(plan.endAt - (7.82 + TAIL_KEEP)) < 1e-6);
});

test("a shot that opens on a new picture just starts on its line", () => {
  const plan = planClipTrim(parseSilences(SHOT1), SHOT1_DUR, { chained: false });
  assert.ok(Math.abs(plan.cutHead - (1.366281 - 0.12)) < 1e-6);
  assert.equal(plan.retime, null);
});

test("a shot that CONTINUES the last one keeps its opening frames — the lead-in is played fast, not cut", () => {
  const plan = planClipTrim(parseSilences(SHOT2), SHOT2_DUR, { chained: true });
  assert.equal(plan.cutHead, 0, "cutting the head is what broke the seamless cut");
  assert.ok(plan.retime, "the lead-in should be re-timed");
  assert.equal(plan.retime!.hold, LEAD_HOLD);
  assert.ok(Math.abs(plan.retime!.leadEnd - (1.220522 - 0.12)) < 1e-6);
  assert.ok(plan.retime!.speed > 1 && plan.retime!.speed <= LEAD_MAX_SPEED);
  // (2026-11-28: a quarter faster at most — at 3× whoever moved in the lead-in moved in fast motion, the owner's "like
  //  something's wrong"; 1.1 s of waiting is now a little under a second)
  const leadIn = plan.retime!.hold + (plan.retime!.leadEnd - plan.retime!.hold) / plan.retime!.speed;
  assert.ok(leadIn > 0.8 && leadIn < 1.1 && plan.retime!.speed <= 1.25, `lead-in ${leadIn.toFixed(2)} s`);
});

test("a pause in the MIDDLE of a line is not mistaken for the end of the shot", () => {
  // shot 2's only later silence is mid-line (4.49–5.09) and the speech runs to the last frame
  const plan = planClipTrim(parseSilences(SHOT2), SHOT2_DUR, { chained: true });
  assert.equal(plan.endAt, SHOT2_DUR);
});

test("the planned length adds up", () => {
  const a = planClipTrim(parseSilences(SHOT1), SHOT1_DUR, { chained: false });
  assert.ok(Math.abs(plannedSeconds(a) - (a.endAt - a.cutHead)) < 1e-9);
  const b = planClipTrim(parseSilences(SHOT2), SHOT2_DUR, { chained: true });
  const squeezed = (b.retime!.leadEnd - b.retime!.hold) * (1 - 1 / b.retime!.speed);
  assert.ok(Math.abs(plannedSeconds(b) - (SHOT2_DUR - squeezed)) < 1e-9);
  assert.ok(plannedSeconds(b) < SHOT2_DUR);
});

test("a short lead-in on a continuing shot is left alone", () => {
  const plan = planClipTrim(parseSilences("silence_start: 0\nsilence_end: 0.5 | silence_duration: 0.5"), 6, { chained: true });
  assert.equal(plan.retime, null);
  assert.ok(isNoopTrim(plan, 6));
});

test("a clip with nothing to trim, or nothing but silence, is left alone", () => {
  assert.ok(isNoopTrim(planClipTrim([], 8, { chained: false }), 8));
  // silent from start to finish: neither a lead-in nor a tail — don't cut it to nothing
  const silent = planClipTrim(parseSilences("silence_start: 0\nsilence_end: 8 | silence_duration: 8"), 8, { chained: false });
  assert.ok(isNoopTrim(silent, 8));
});

test("the film's last shot holds a beat longer than the others", () => {
  const mid = planClipTrim(parseSilences(SHOT1), SHOT1_DUR, { chained: false });
  const last = planClipTrim(parseSilences(SHOT1), SHOT1_DUR, { chained: false, last: true });
  assert.ok(last.endAt > mid.endAt + 0.4 && last.endAt <= SHOT1_DUR);
  assert.ok(Math.abs(last.endAt - (7.820975 + TAIL_KEEP_LAST)) < 1e-6);
  assert.equal(last.holdEnd, 0, "the take already has its beat of quiet — nothing to hold");
  assert.equal(mid.holdEnd, 0, "only the film's last shot is ever held");
});

test("a last shot whose line runs to the final frame holds that frame instead of ending on the word", () => {
  // the re-rendered film, 2026-11-17: June's "…okay?" finished 0.2 s before the take ended
  const plan = planClipTrim(parseSilences(SHOT2), SHOT2_DUR, { chained: true, last: true });
  assert.equal(plan.endAt, SHOT2_DUR, "nothing is cut off the end — there is nothing spare");
  assert.equal(plan.holdEnd, END_HOLD_MAX);
  assert.ok(!isNoopTrim(plan, SHOT2_DUR));
  // no quiet anywhere in the take (speech wall to wall): still held
  assert.equal(planClipTrim([], 6, { chained: false, last: true }).holdEnd, END_HOLD_MAX);
  // …and a take with a short tail is topped up to a full beat, not doubled
  const short = planClipTrim(parseSilences("silence_start: 7.5\nsilence_end: 7.9 | silence_duration: 0.4"), 7.9, { chained: false, last: true });
  assert.equal(short.endAt, 7.9);
  assert.ok(Math.abs(short.holdEnd - (TAIL_KEEP_LAST - 0.4)) < 1e-6, `held ${short.holdEnd}`);
  assert.ok(Math.abs(plannedSeconds(short) - (7.9 + short.holdEnd)) < 1e-9);
});

test("a half-second lead-in is seen (the detection filter is fine enough)", () => {
  assert.match(SILENCE_FILTER, /d=0\.3\d?$/);
  // the re-rendered film's first shot: 0.45 s of quiet before the first word — at d=0.6 it went unseen
  const runs = parseSilences("silence_start: 0.0155\nsilence_end: 0.448 | silence_duration: 0.43\nsilence_start: 7.60\nsilence_end: 9.03 | silence_duration: 1.43");
  const first = planClipTrim(runs, 9.04, { chained: false });
  assert.ok(Math.abs(first.cutHead - (0.448 - 0.12)) < 1e-6, "the film's first shot starts just before its first word");
  // on a CONTINUING shot the same half second is too little to be worth re-timing — it stays, uncut
  const cont = planClipTrim(runs, 9.04, { chained: true });
  assert.equal(cont.cutHead, 0);
  assert.equal(cont.retime, null);
});

test("a line that ends close to the end of the clip keeps its last word", () => {
  // trailing silence starts 0.2 s before the end — nothing worth cutting, and never cut INTO the word
  const plan = planClipTrim(parseSilences("silence_start: 7.85\nsilence_end: 8.04 | silence_duration: 0.19"), 8.04, { chained: false });
  assert.equal(plan.endAt, 8.04);
});

// ── Trimming on the heard words ────────────────────────────────────────────────────────────────────
// fal "standard" take of "The Watch in Her Hands", shot 1 (2026-11-19): a breath at the top, then quiet
// split by a 60 ms click, and the line starts at 2.25 s. Measured with the film's own SILENCE_FILTER;
// the words are whisperx's.
import { silencesFromWords, quietShare, planFromWords, interiorCutFromWords, planShift, QUIET_CONFIRM, PAUSE_KEEP } from "../app/lib/clip-trim.ts";
const WATCH_DUR = 8.0;
const WATCH_QUIET = parseSilences(`
silence_start: 0.418299
silence_end: 1.32188 | silence_duration: 0.903583
silence_start: 1.37971
silence_end: 2.24349 | silence_duration: 0.863787
silence_start: 7.51977
silence_end: 7.98764 | silence_duration: 0.467868`);
const WATCH_WORDS = [
  { start: 2.248, end: 2.549 }, { start: 2.589, end: 2.669 }, { start: 2.689, end: 2.829 }, { start: 2.869, end: 2.929 },
  { start: 2.949, end: 3.09 }, { start: 3.11, end: 3.19 }, { start: 3.23, end: 3.47 }, { start: 3.49, end: 3.55 },
  { start: 3.6, end: 7.48 },
];

test("silence alone misses a lead-in that opens on a breath", () => {
  const plan = planClipTrim(WATCH_QUIET, WATCH_DUR, { chained: false });
  assert.equal(plan.cutHead, 0, "the quiet doesn't start at the top, so no lead-in is seen — 2.2 s of dead air stayed");
});

test("the heard words find it, and the measured quiet confirms it", () => {
  assert.ok(quietShare(WATCH_QUIET, 0, 2.128, WATCH_DUR) >= QUIET_CONFIRM);
  const plan = planFromWords(WATCH_WORDS, WATCH_QUIET, WATCH_DUR, { chained: false });
  assert.ok(plan, "a plan from the words");
  assert.ok(Math.abs(plan!.cutHead - (2.248 - LEAD_PAD_FOR_TEST)) < 1e-6, "cut to just before the first word");
  assert.ok(Math.abs(planShift(plan!) - plan!.cutHead) < 1e-9, "the line moves earlier by the cut");
});

test("a sound the transcriber didn't write down (a growl, a laugh) is never cut", () => {
  const loud = parseSilences("silence_start: 0\nsilence_end: 0.3 | silence_duration: 0.3\nsilence_start: 7.5\nsilence_end: 8 | silence_duration: 0.5");
  assert.equal(planFromWords(WATCH_WORDS, loud, WATCH_DUR, { chained: false }), null, "words alone don't get to cut 2 s of sound");
});

test("a continuing shot plays its word-found lead-in fast instead of cutting it", () => {
  const plan = planFromWords(WATCH_WORDS, WATCH_QUIET, WATCH_DUR, { chained: true });
  assert.ok(plan && plan.cutHead === 0 && plan.retime, "never cut — re-timed");
  assert.ok(planShift(plan!) > 0.1, "and the line arrives a little sooner");
});

test("words → quiet runs: before the first word, between words, after the last", () => {
  const runs = silencesFromWords([{ start: 1, end: 2 }, { start: 3, end: 4 }], 6);
  assert.deepEqual(runs, [{ start: 0, end: 1 }, { start: 2, end: 3 }, { start: 4, end: 6 }]);
  assert.deepEqual(silencesFromWords([], 5), []);
});

test("a long pause between words is one pause even with a click inside it", () => {
  const words = [{ start: 0.2, end: 1.4 }, { start: 3.3, end: 6.0 }];
  const quiet = parseSilences("silence_start: 1.45\nsilence_end: 2.3 | silence_duration: 0.85\nsilence_start: 2.36\nsilence_end: 3.25 | silence_duration: 0.89");
  const cut = interiorCutFromWords(words, quiet, 6.5);
  assert.ok(cut, "the 1.9 s gap is found though each silent half is under a second");
  assert.equal(cut!.keep1, +(1.4 + PAUSE_KEEP).toFixed(2));
  assert.ok(cut!.start2 < 3.3, "resumes just before the next word");
  assert.equal(interiorCutFromWords([{ start: 0.2, end: 1.4 }, { start: 2.2, end: 6 }], quiet, 6.5), null, "a 0.8 s pause is a natural beat");
  const noisy = parseSilences("silence_start: 1.5\nsilence_end: 1.7 | silence_duration: 0.2");
  assert.equal(interiorCutFromWords(words, noisy, 6.5), null, "a gap full of sound we can't name stays");
});
const LEAD_PAD_FOR_TEST = 0.12;
