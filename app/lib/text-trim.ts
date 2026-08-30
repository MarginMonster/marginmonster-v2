/* Length limits that don't cut a word in half.
 *
 * Several of these strings are handed to a model as something to reproduce
 * "word for word" or "letter-for-letter", and some are then printed on the ad
 * or spoken aloud by TTS. A hard slice() ends them mid-word, so the
 * instruction and the artefact contradict each other: we ask for a verbatim
 * rendering of a fragment, and the model obliges. A merchant's promotion
 * arrives on the ad as "20% off your first ord", and a commercial's tagline is
 * both printed and SPOKEN with its last word sheared off.
 *
 * Cut at the last word boundary at or before the limit instead. A hard cut is
 * used ONLY when the limit lands inside the very first word, because then there
 * is no boundary to cut at and returning nothing would be worse.
 *
 * An earlier version of this required the boundary to fall in the back half of
 * the limit, which meant a short limit on a string like "X10 Boxes Pokemon…"
 * rejected the boundary at index 3 and hard-cut to "X10 Boxe" — the exact
 * mid-word cut the function exists to prevent. A property test across every
 * limit from 8 to 60 caught it.
 */
export function trimToWord(s: string | null | undefined, max: number): string {
  const t = (s || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(" ");
  const kept = at > 0 ? cut.slice(0, at) : cut;
  // Never end on dangling punctuation — it reads as a broken sentence and, in
  // a prompt, as an instruction that trails off.
  return kept.replace(/[\s,;:.!?\-–—/&+]+$/, "");
}
