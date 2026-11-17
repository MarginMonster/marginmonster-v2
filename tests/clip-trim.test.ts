/* Trimming the dead air off a dialogue clip — and not breaking the cut while doing it.
 *
 * The numbers here are from a real film ("The Last Slice", 2026-11-17) whose transition the owner called
 * trash. Two things were wrong, both visible in ffmpeg's own output for those two shots:
 *   - the end of a shot was never trimmed (ffmpeg closes a trailing silence with a silence_end at the
 *     end of the file; the old code only believed in a trailing silence that had none), and
 *   - the start of the NEXT shot was cut off, which threw away the frames that matched the last shot. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSilences, planClipTrim, plannedSeconds, isNoopTrim, LEAD_HOLD, LEAD_MAX_SPEED, TAIL_KEEP, TAIL_KEEP_LAST } from "../app/lib/clip-trim.ts";

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
  // 1.1 s of waiting becomes about half a second: the dissolve's 0.2 s at normal speed + the rest 3× faster
  const leadIn = plan.retime!.hold + (plan.retime!.leadEnd - plan.retime!.hold) / plan.retime!.speed;
  assert.ok(leadIn > 0.3 && leadIn < 0.6, `lead-in ${leadIn.toFixed(2)} s`);
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
  assert.ok(plannedSeconds(b) < SHOT2_DUR - 0.5);
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
  const last = planClipTrim(parseSilences(SHOT1), SHOT1_DUR, { chained: false, tailKeep: TAIL_KEEP_LAST });
  assert.ok(last.endAt > mid.endAt + 0.4 && last.endAt <= SHOT1_DUR);
});

test("a line that ends close to the end of the clip keeps its last word", () => {
  // trailing silence starts 0.2 s before the end — nothing worth cutting, and never cut INTO the word
  const plan = planClipTrim(parseSilences("silence_start: 7.85\nsilence_end: 8.04 | silence_duration: 0.19"), 8.04, { chained: false });
  assert.equal(plan.endAt, 8.04);
});
