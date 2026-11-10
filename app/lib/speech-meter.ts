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

/** Estimated seconds a spoken line runs: words × rate + a short onset + punctuation
 *  micro-beats (a comma/period is a natural breath). Returns 0 for an empty line. */
export function estimateSpeakSeconds(line: string): number {
  const words = (String(line || "").trim().match(/\S+/g) || []).length;
  if (!words) return 0;
  const pauses = (String(line).match(/[,.;:!?—]/g) || []).length * 0.15;
  return words * SECONDS_PER_WORD + 0.4 + pauses;
}

/** The render clip length for a line: long enough never to clip the speech, short enough
 *  to leave no big dead tail for the model to pad. Clamped to the renderer's sane range. */
export function clipSecondsFor(line: string): number {
  const spoken = estimateSpeakSeconds(line);
  return Math.max(CLIP_MIN_SECONDS, Math.min(CLIP_MAX_SECONDS, Math.round(spoken + 1.2)));
}

/** How full a line is against ONE clip's ceiling, as 0..1+ — drives the editor meter bar
 *  (>1 means the line would overrun the clip and get cut off). */
export function clipFill(line: string): number {
  return CLIP_MAX_SECONDS > 0 ? estimateSpeakSeconds(line) / CLIP_MAX_SECONDS : 0;
}

/** A compact "~Xs" label for the meter (one decimal under 10s, whole seconds above). */
export function secondsLabel(sec: number): string {
  if (!(sec > 0)) return "0s";
  return sec < 10 ? `${sec.toFixed(1)}s` : `${Math.round(sec)}s`;
}
