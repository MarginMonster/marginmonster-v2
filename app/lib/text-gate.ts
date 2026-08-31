/* Mechanical spell-checking of text a model RENDERED against the text we asked
 * for.
 *
 * Asking a vision model "does the ad say the requested strings?" is a
 * perceptual call, and it answers yes for a one-character corruption of an
 * unfamiliar proper noun every time. A real ad shipped "Teraastal Umbreon" for
 * "Terastal Umbreon" and passed; another shipped "Terastal Umboron". So the
 * model transcribes verbatim and the comparison happens HERE, in code, where it
 * is a string operation rather than a judgement.
 *
 * This lives in its own module for two reasons: the pipeline gate and the QA
 * harness both need it, and they had drifted into two different rules — the
 * harness was flagging at distance 2 against ALL requested copy, which catches
 * ordinary English pairs like "through" and "thought". One implementation, one
 * rule, and it can be tested without a database.
 */

/** Levenshtein distance, bailing out as soon as it exceeds `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Words long enough to be worth checking. Short English words sit one edit
 *  from each other constantly — "Ship" against a requested "Shop" would fail a
 *  perfectly good ad — so the floor is load-bearing, not caution. */
const MIN_FLAG = 6;

const words = (s: string): string[] => (s.toLowerCase().match(/[a-z][a-z'-]{3,}/g) || []);

/**
 * The first rendered word that looks like a corruption of something we asked
 * for, or null if the text is clean.
 *
 * Two thresholds, deliberately different:
 *
 *  - ONE edit against any requested word. Tight, because ordinary English is
 *    full of words a single edit apart and a false positive costs a good ad.
 *  - TWO edits against words from the PRODUCT NAME. This is where the real
 *    corruptions land — "Umboron" for "Umbreon" and "ASALEP" for "ASLEEP" are
 *    both two — and a product name has no near neighbours in English, so the
 *    wider net catches mangling without catching prose.
 */
export function findCorruptedWord(
  expected: string[],
  productNames: string[],
  transcript: string | undefined | null
): string | null {
  const wanted = new Set(expected.flatMap(words));
  const named = new Set(productNames.flatMap(words).filter((w) => w.length >= MIN_FLAG));
  const rendered = typeof transcript === "string" ? words(transcript) : [];

  const nearMiss = (w: string, pool: Set<string>, max: number): boolean =>
    [...pool].some((e) => e !== w && Math.abs(e.length - w.length) <= max && editDistance(e, w, max) <= max);

  const direct = rendered.find(
    (w) => w.length >= MIN_FLAG && !wanted.has(w) && (nearMiss(w, wanted, 1) || nearMiss(w, named, 2))
  );
  if (direct) return direct;

  // THE REVERSE CHECK, WHICH IS THE STRONGER ONE.
  //
  // Every requested string is supposed to be rendered verbatim, so a long
  // requested word that is ABSENT from the transcript is already suspicious —
  // and if something two edits away IS present, that present word is the
  // corruption. This needs no dictionary and cannot fire on an ordinary
  // English near-pair, because the word we asked for would still be there.
  //
  // It is what the forward rule cannot reach. A live ad rendered “flimily”
  // for a requested “flimsy”: two edits, and “flimsy” is ordinary English
  // rather than a product name, so the tight one-edit pool missed it and the
  // wide two-edit pool never looks at it. Anchoring on the MISSING word
  // instead of the rendered one catches it exactly.
  //
  // Safe when the transcriber simply drops a line: with no near neighbour
  // rendered, nothing fires.
  const renderedSet = new Set(rendered);
  for (const want of wanted) {
    if (want.length < MIN_FLAG || renderedSet.has(want)) continue;
    const impostor = rendered.find(
      (w) => !wanted.has(w) && Math.abs(w.length - want.length) <= 2 && editDistance(want, w, 2) <= 2
    );
    if (impostor) return impostor;
  }

  return null;
}
