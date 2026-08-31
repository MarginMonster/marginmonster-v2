/* Deterministic repair for model-written ad copy, applied before it is drawn
 * into an image.
 *
 * WHY THIS IS NOT JUST A BETTER PROMPT. formatCopy already tells the model
 * "Punctuation must be correct — write \"that's\", \"you're\", \"it's\" with
 * apostrophes". A live ad still shipped reading:
 *
 *     FINALLY A CAKE THAT WONT CRUMBLE.
 *
 * Once copy reaches the image model the text is baked into pixels, so a
 * mistake at this stage is not a typo — it is a re-render, or an ad the
 * merchant posts with a spelling error on it. Instructions reduce the rate;
 * they do not take it to zero. This does, for the handful of mistakes that
 * are mechanically decidable.
 *
 * The list below is deliberately conservative. Every entry is a string that is
 * NOT an English word, so restoring the apostrophe cannot change the meaning of
 * something the writer meant. The tempting ones that are left out:
 *
 *   its   — "its colour" is correct far more often than "it's"
 *   lets  — "lets you skip the queue" is correct and common in ad copy
 *   well  — a word
 *   ill   — a word
 *   id    — a word
 *   were  — a word
 *   your  — a different word, not a contraction at all
 *   wed   — a word
 *   hed   — a word
 *
 * "wont" and "cant" ARE English words (as is his wont; the cant of the trade)
 * and are included anyway: neither has ever appeared in a product ad in that
 * sense, and both are among the most common contractions to lose an apostrophe.
 *
 * Pure and dependency-free — see tests/ad-copy-tidy.test.ts.
 */

/** Contraction spellings that are not words in their own right. */
const CONTRACTIONS: Record<string, string> = {
  dont: "don't", doesnt: "doesn't", didnt: "didn't",
  isnt: "isn't", arent: "aren't", wasnt: "wasn't", werent: "weren't",
  havent: "haven't", hasnt: "hasn't", hadnt: "hadn't",
  wouldnt: "wouldn't", couldnt: "couldn't", shouldnt: "shouldn't",
  wont: "won't", cant: "can't", aint: "ain't",
  thats: "that's", whats: "what's", heres: "here's", theres: "there's",
  wheres: "where's", hows: "how's", whos: "who's", whens: "when's",
  youre: "you're", theyre: "they're", hes: "he's", shes: "she's",
  youve: "you've", weve: "we've", theyve: "they've", ive: "I've",
  youll: "you'll", theyll: "they'll", im: "I'm",
};

/** Copy the source token's capitalisation onto the repaired one. */
function matchCase(source: string, repaired: string): string {
  if (source === source.toUpperCase() && source !== source.toLowerCase()) return repaired.toUpperCase();
  if (source[0] === source[0].toUpperCase()) return repaired[0].toUpperCase() + repaired.slice(1);
  return repaired;
}

/** Restore apostrophes the model dropped. */
export function fixContractions(text: string): string {
  return text.replace(/[A-Za-z]+/g, (word) => {
    const fixed = CONTRACTIONS[word.toLowerCase()];
    return fixed ? matchCase(word, fixed) : word;
  });
}

/** Collapse a phrase the model stuttered.
 *
 *  formatCopy's own prompt names this failure ("we still each still got",
 *  "first try first try") because it kept happening. Adjacent repeats of one
 *  word, and of a two- or three-word run, are unambiguous and safe to remove.
 *  Anything longer, or non-adjacent, is left alone — a deliberate refrain is a
 *  real thing in ad copy and this must not eat one. */
export function collapseStutter(text: string): string {
  const tokens = text.split(/(\s+)/); // keep the separators
  const words = tokens.filter((_, i) => i % 2 === 0);
  const gaps = tokens.filter((_, i) => i % 2 === 1);
  const key = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, "");

  for (let run = 3; run >= 1; run--) {
    for (let i = 0; i + run * 2 <= words.length; i++) {
      const a = words.slice(i, i + run).map(key);
      const b = words.slice(i + run, i + run * 2).map(key);
      if (a.every(Boolean) && a.join(" ") === b.join(" ")) {
        // Keep the SECOND copy: it carries the run's original trailing
        // punctuation ("first try, first try." -> "first try.").
        words.splice(i, run);
        gaps.splice(i, run);
        i--;
      }
    }
  }

  return words.reduce((out, w, i) => out + w + (gaps[i] ?? ""), "");
}

/** Everything, in the order that composes correctly. */
export function tidyAdCopy(text: string): string {
  if (typeof text !== "string") return "";
  let out = text.replace(/\s+/g, " ").trim();
  out = fixContractions(out);
  out = collapseStutter(out);
  // A trailing comma or a doubled terminator is what a truncated string looks
  // like drawn into a layout box.
  out = out.replace(/\s+([,.!?;:])/g, "$1").replace(/([.!?])\1+/g, "$1").replace(/[,;:]+$/, "");
  return out.trim();
}
