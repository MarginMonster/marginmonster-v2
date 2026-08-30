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
 * Cut at the last word boundary at or before the limit instead. If there is no
 * boundary in the back half — one very long token — fall back to the hard cut,
 * because returning almost nothing would be worse.
 */
export function trimToWord(s: string | null | undefined, max: number): string {
  const t = (s || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(" ");
  const kept = at > Math.floor(max * 0.5) ? cut.slice(0, at) : cut;
  // Never end on dangling punctuation — it reads as a broken sentence and, in
  // a prompt, as an instruction that trails off.
  return kept.replace(/[\s,;:.!?\-–—/&+]+$/, "");
}
