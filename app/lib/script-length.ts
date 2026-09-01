/* Measuring a voice-over script, in a writing system that may not use spaces.
 *
 * The UGC and Cartoon pipelines both judged a script with
 *
 *     raw.split(/\s+/).length < 12   →  "mangled, discard it"
 *
 * Chinese is written without inter-word spaces and its full stop 。is not
 * whitespace, so a perfect 35-character Simplified Chinese script counts as
 * ONE token, is discarded as mangled, and the fallback ladder then retries,
 * de-brands, retries again and throws. `zh` is a shipped content language that
 * a store can be assigned automatically from its locale — so UGC and Cartoon
 * video were not merely degraded for those merchants, they were impossible,
 * and the error blamed a trademark refusal.
 *
 * The same blindness sat on the other end: the `> 34 words` cap that keeps a
 * script inside the ~12s lip-sync budget never fired for CJK either, so if the
 * floor were relaxed on its own a Chinese script would run long instead.
 *
 * Thresholds. English spec is 26–32 words ≈ 12s at ~2.8 words/sec. Mandarin
 * TTS runs about 5 characters/sec, so the same 12s is ≈ 60 characters; a
 * "mangled fragment" is proportionally under ~20.
 */

import { hasCJK } from "./content-lang.ts";

export const MIN_WORDS = 12;
export const MIN_CJK_CHARS = 20;
export const MAX_CJK_CHARS = 58;

/** Characters that actually carry the script, ignoring spacing. */
const cjkLen = (s: string): number => [...s.replace(/\s+/g, "")].length;

/**
 * True when the model returned a fragment rather than a script — the signal
 * the fallback ladder reads as "refusal, retry".
 */
export function scriptTooShort(raw: string, minWords = MIN_WORDS, minCjkChars = MIN_CJK_CHARS): boolean {
  const s = (raw || "").trim();
  if (!s) return true;
  // A Chinese script with Latin brand names in it has both, so CJK decides.
  return hasCJK(s) ? cjkLen(s) < minCjkChars : s.split(/\s+/).filter(Boolean).length < minWords;
}

/**
 * Trim a script to the lip-sync budget in whichever unit its writing system
 * actually uses. Returns the script unchanged when it already fits.
 */
export function capScript(raw: string, maxWords: number, maxCjkChars = MAX_CJK_CHARS): string {
  const s = (raw || "").trim();
  if (!s) return s;
  if (hasCJK(s)) {
    const chars = [...s];
    if (chars.length <= maxCjkChars) return s;
    // Prefer to end on a clause boundary rather than mid-word.
    const cut = chars.slice(0, maxCjkChars).join("");
    const stop = Math.max(cut.lastIndexOf("，"), cut.lastIndexOf("、"), cut.lastIndexOf("。"), cut.lastIndexOf("；"));
    return (stop >= maxCjkChars * 0.6 ? cut.slice(0, stop) : cut).trim();
  }
  const w = s.split(" ").filter(Boolean);
  return w.length > maxWords ? w.slice(0, maxWords).join(" ") : s;
}

/** Give the voice model a clean final stop so it does not rush or trail off. */
export function endStop(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return s;
  // 。！？ are the CJK terminators; a Latin "." after Chinese reads as a typo.
  if (/[.!?。！？]$/.test(s)) return s;
  return s + (hasCJK(s) ? "。" : ".");
}
