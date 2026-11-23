/* A SPOKEN LINE FITS ITS SHOT — COUNTED, NOT HOPED FOR.
 *
 * An acted film's writer is told every line is "about 15-18 words … NEVER more than 18", because each line
 * is one shot of at most ten seconds and the film's length is the sum of them. It cannot count. Made as a
 * customer on 2026-11-23: a kids' cartoon set to "≈ 20s · 4 shots" came back with four lines of 26 to 30
 * words — every shot ran the full ten seconds, the film was 40 seconds, and it cost us twice the render.
 * (The music video's lyric has the same history: film-engine.server.ts counts it and asks again.)
 *
 * So the lines are counted, and the ones over the limit are sent back ONCE for a shorter rewrite — the same
 * speaker, the same meaning, and whatever the next line answers still said. A rewrite is only taken when it
 * really is that line, shorter. Pure: the model call is the caller's.
 */

/** What the writer is asked for. */
export const LINE_WORDS_WANT: readonly [number, number] = [14, 18];
/** A line with more words than this goes back for a rewrite (a little slack over the 18 it is told). */
export const LINE_WORDS_MAX = 20;
/** A rewrite shorter than this is not a line any more (a shot would be mostly dead air). */
export const LINE_WORDS_MIN = 8;

const LABEL = /^\s*([\p{L}][\p{L}\p{N} .'’-]{0,30}):\s*([\s\S]*)$/u;
const CJK = /[぀-ヿ㐀-鿿가-힯]/;

/** "NAME: what they say" → its two parts. A line with no label has an empty name. */
export function splitLine(caption: string | null | undefined): { name: string; said: string } {
  const c = (caption || "").replace(/\s+/g, " ").trim();
  const m = c.match(LABEL);
  return m ? { name: m[1].trim(), said: m[2].trim() } : { name: "", said: c };
}

/** How many words are SPOKEN in a line (the speaker's label is not said). */
export const saidWords = (caption: string | null | undefined): number => (splitLine(caption).said.match(/\S+/g) || []).length;

/** The lines that are too long, by position. Scripts with no spaces between words (Chinese, Japanese,
 *  Korean) cannot be counted this way and are left alone. */
export function linesTooLong(captions: ReadonlyArray<string | null | undefined>): number[] {
  const out: number[] = [];
  captions.forEach((c, i) => {
    if (!c || CJK.test(c)) return;
    if (saidWords(c) > LINE_WORDS_MAX) out.push(i);
  });
  return out;
}

/** The one request for shorter lines. Every line is shown, in order, so the rewrite can keep the thread. */
export function fitAsk(captions: ReadonlyArray<string | null | undefined>, long: ReadonlyArray<number>): string {
  const [lo, hi] = LINE_WORDS_WANT;
  const sheet = captions.map((c, i) => `${i + 1}. ${long.includes(i) ? `[TOO LONG — ${saidWords(c)} words] ` : ""}${(c || "").replace(/\s+/g, " ").trim()}`).join("\n");
  return (
    `These are the lines of a short acted scene, in order, one speaker per line, each written as "NAME: what they say". ` +
    `Every line is spoken in ONE shot of at most ten seconds, so a line may have AT MOST ${hi} spoken words (the NAME is not spoken). The lines marked [TOO LONG] have more.\n` +
    `Rewrite ONLY the marked lines to between ${lo} and ${hi} spoken words each: the SAME speaker, the same meaning and feeling, in the language the line is written in — and whatever the NEXT line answers or reacts to must still be said. Count the words. Leave every other line exactly as it is.\n\n` +
    `${sheet}\n\n` +
    `Return "lines": exactly ${captions.length} entries, one for each line above in the same order — a marked line rewritten, an unmarked line unchanged — each as "NAME: what they say" and nothing else (no numbers, no marks).`
  );
}

/** The lines after the rewrite came back: a marked line takes its rewrite only when that is a line by the
 *  SAME speaker, between LINE_WORDS_MIN and LINE_WORDS_MAX words, and shorter than what it replaces.
 *  Anything else — a wrong count of lines, another speaker, a longer line, not text — keeps the original. */
export function takeRewrites(captions: ReadonlyArray<string | null | undefined>, long: ReadonlyArray<number>, rewritten: unknown): string[] {
  const base = captions.map((c) => c || "");
  if (!Array.isArray(rewritten) || rewritten.length !== captions.length) return base;
  return base.map((orig, i) => {
    if (!long.includes(i)) return orig;
    const r = rewritten[i];
    if (typeof r !== "string") return orig;
    const tidy = r.replace(/^\s*\d+\.\s*/, "").replace(/^\s*\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").trim();
    const was = splitLine(orig);
    const now = splitLine(tidy);
    if (now.name.toLowerCase() !== was.name.toLowerCase()) return orig;
    const n = saidWords(tidy);
    if (n < LINE_WORDS_MIN || n > LINE_WORDS_MAX || n >= saidWords(orig)) return orig;
    // the speaker's label exactly as it was written the first time (the cast is matched by it)
    return was.name ? `${was.name}: ${now.said}` : now.said;
  });
}
