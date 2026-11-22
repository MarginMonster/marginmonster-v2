/** Word-metered speech timing — the SINGLE source of truth shared by the film render
 *  engine (to size each dialogue clip to its spoken line) and the storyboard editor (to
 *  show a live "~Xs" meter as the user types). A clip that outlasts its line is exactly
 *  what makes Kling pad the dead time — with silence (an awkward pause) or by LOOPING words
 *  (the "repeated a few words" bug) — so sizing the clip to the words kills both at the
 *  source, and the editor meter lets the writer fill each beat without overrunning it.
 *
 *  Pure (no server-only deps) so the browser bundle can import it too. ~0.45s/word ≈ 135
 *  wpm, a natural dramatic-dialogue pace; calibrate against real renders if delivery drifts. */

// Measured against real Kling renders: it speaks ~0.28s/word (≈210 wpm) — much faster
// than a dramatic read. Sizing clips at the old 0.45 left ~half the clip as dead ambient
// pad (the character standing there), so this is tuned to what the model actually delivers.
export const SECONDS_PER_WORD = 0.28;
/** A single dialogue clip (one speaker's beat) can't exceed the renderer's max take. */
export const CLIP_MAX_SECONDS = 10;
/** Floor — a very short line still needs a watchable beat to seed and hold on. */
export const CLIP_MIN_SECONDS = 5;
/** WHAT ONE ACTED SHOT COMES TO, for the Length card. A written line is 15–18 words, which the rate above
 *  puts at about five seconds — and no clip is shorter than that. The card said EIGHT a shot: "≈ 32s · 4
 *  shots" above a scene whose own meter read "≈ 19s film", and the films made that way ran 19.5 seconds
 *  (2026-11-22). A film a third shorter than the length that was picked is the complaint rival tools'
 *  customers make most after billing. tests/speech-meter-length.test.ts keeps this tied to the meter. */
export const TYPICAL_SHOT_SECONDS = 5;

/** Estimated seconds a spoken line runs: words × rate + a short onset + punctuation
 *  micro-beats (a comma/period is a natural breath). Returns 0 for an empty line. */
export function estimateSpeakSeconds(line: string): number {
  const words = (String(line || "").trim().match(/\S+/g) || []).length;
  if (!words) return 0;
  const pauses = (String(line).match(/[,.;:!?—]/g) || []).length * 0.15;
  return words * SECONDS_PER_WORD + 0.4 + pauses;
}

/** The video model waits about this long before the first word (measured on real renders: 1.2 s and
 *  1.4 s). The estimate above counts 0.4 s of it — what is left in the film once the lead-in has been
 *  trimmed — so the rest has to be added back when sizing the take itself. */
export const MODEL_LEAD_IN_EXTRA = 0.8;

/** The render clip length for a line: long enough never to clip the speech — the take must also hold
 *  the model's own lead-in, or the last word lands on the very last frame (a 17-word line in a 7 s take
 *  ended exactly at the cut). The dead air that leaves is trimmed afterwards, so a little headroom
 *  costs nothing on screen. Clamped to the renderer's sane range. */
export function clipSecondsFor(line: string): number {
  const spoken = estimateSpeakSeconds(line);
  return Math.max(CLIP_MIN_SECONDS, Math.min(CLIP_MAX_SECONDS, Math.round(spoken + MODEL_LEAD_IN_EXTRA + 1.0)));
}

/** How full a line is against ONE clip's ceiling, as 0..1+ — drives the editor meter bar
 *  (>1 means the line would overrun the clip and get cut off). The ceiling is the longest take less
 *  the lead-in the model spends before it speaks. */
export function clipFill(line: string): number {
  const room = CLIP_MAX_SECONDS - MODEL_LEAD_IN_EXTRA;
  return room > 0 ? estimateSpeakSeconds(line) / room : 0;
}

/** A compact "~Xs" label for the meter (one decimal under 10s, whole seconds above). */
export function secondsLabel(sec: number): string {
  if (!(sec > 0)) return "0s";
  return sec < 10 ? `${sec.toFixed(1)}s` : `${Math.round(sec)}s`;
}
