/* A SPOKEN LINE FITS ITS SHOT — COUNTED, NOT HOPED FOR.
 *
 * An acted film's writer is told every line is "about 15-18 words … NEVER more than 18", because each line
 * is one shot of at most ten seconds and the film's length is the sum of them. It cannot count. Made as a
 * customer on 2026-11-23: a kids' cartoon set to "≈ 20s · 4 shots" came back with four lines of 26 to 30
 * words — every shot ran the full ten seconds, the film was 40 seconds, and it cost us twice the render.
 * (The music video's lyric has the same history: film-engine.server.ts counts it and asks again.)
 *
 * So the lines are counted, and the ones over the limit are sent back ONCE. Asking for "14 to 18 words"
 * again does not work — the first version of this did exactly that, and on the live site the lines came
 * back at 25, 29 and 26 words. What works is what the lyric fit learned: ask for every long line at THREE
 * LENGTHS and let the code pick — the longest version that fits, or failing that the shortest one that is
 * at least shorter. A version is only ever taken when it is that speaker's line. Pure: the model call is
 * the caller's.
 */

/** What a line should come to. */
export const LINE_WORDS_WANT: readonly [number, number] = [14, 18];
/** A line with more words than this goes back (a little slack over the 18 the writer is told). */
export const LINE_WORDS_MAX = 20;
/** A version shorter than this is not a line any more (a shot would be mostly dead air). */
export const LINE_WORDS_MIN = 8;
/** The three lengths every long line is asked for, in words. */
export const LINE_VERSIONS: readonly [number, number, number] = [11, 14, 17];

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

/** The one request: every line is shown, in order, so a rewrite can keep the thread; the long ones are
 *  marked, and each of THOSE is asked for at three lengths. */
export function fitAsk(captions: ReadonlyArray<string | null | undefined>, long: ReadonlyArray<number>): string {
  const [a, b, c] = LINE_VERSIONS;
  const sheet = captions.map((l, i) => `${i + 1}. ${long.includes(i) ? `[TOO LONG — ${saidWords(l)} words] ` : ""}${(l || "").replace(/\s+/g, " ").trim()}`).join("\n");
  return (
    `These are the lines of a short acted scene, in order, one speaker per line, each written as "NAME: what they say". ` +
    `Every line is spoken in ONE shot of at most ten seconds, so a line may have AT MOST ${LINE_WORDS_WANT[1]} spoken words (the NAME is not spoken). The lines marked [TOO LONG] have more.\n\n` +
    `${sheet}\n\n` +
    `For EVERY marked line write THREE shorter versions of it — the SAME speaker, the same meaning and feeling, in the language the line is written in, at three LENGTHS: a short one of about ${a} spoken words, a middle one of about ${b}, and a long one of about ${c}. Whatever the NEXT line answers or reacts to must still be said in each. Shorter means fewer words — cut, do not squeeze.\n` +
    `Return "lines": exactly ${captions.length} entries, one for each line above in the same order. The entry for a marked line is the list of its three versions, shortest first, each as "NAME: what they say" and nothing else (no numbers, no marks). The entry for an unmarked line is an EMPTY list.`
  );
}

/** Of a long line's versions, the one to use — or the original when none will do. Only a version that is
 *  the SAME speaker's line (and still a line: LINE_WORDS_MIN words or more) is considered. The longest that
 *  fits (≤ LINE_WORDS_MAX) fills the shot best; if none fits, the shortest that is at least shorter than
 *  the original is still an improvement. */
export function pickLine(original: string, versions: ReadonlyArray<unknown>): string {
  const was = splitLine(original);
  const had = saidWords(original);
  const ok: Array<{ said: string; n: number }> = [];
  for (const v of versions) {
    if (typeof v !== "string") continue;
    const tidy = v.replace(/^\s*\d+\.\s*/, "").replace(/^\s*\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").trim();
    const now = splitLine(tidy);
    if (now.name.toLowerCase() !== was.name.toLowerCase()) continue;
    const n = (now.said.match(/\S+/g) || []).length;
    if (n < LINE_WORDS_MIN || n >= had) continue;
    ok.push({ said: now.said, n });
  }
  if (!ok.length) return original;
  const fits = ok.filter((x) => x.n <= LINE_WORDS_MAX).sort((x, y) => y.n - x.n);
  const best = fits[0] || ok.sort((x, y) => x.n - y.n)[0];
  // the speaker's label exactly as it was first written (the cast is matched by it)
  return was.name ? `${was.name}: ${best.said}` : best.said;
}

/** The lines after the versions came back. Only a marked line can change. A wrong number of entries, or
 *  anything that is not a list of them, changes nothing. (An entry may also be a single text: one version.) */
export function takeRewrites(captions: ReadonlyArray<string | null | undefined>, long: ReadonlyArray<number>, rewritten: unknown): string[] {
  const base = captions.map((c) => c || "");
  if (!Array.isArray(rewritten) || rewritten.length !== captions.length) return base;
  return base.map((orig, i) => {
    if (!long.includes(i)) return orig;
    const r = rewritten[i];
    return pickLine(orig, Array.isArray(r) ? r : [r]);
  });
}

/** A line with fewer spoken words than this goes back too (2026-11-26). No take is shorter than five seconds
 *  (speech-meter.ts → CLIP_MIN_SECONDS) and a line under ten words does not fill one: the slack is what the engine
 *  pads with silence or looped words. */
export const LINE_WORDS_SHORT = 10;
/** The three lengths every short line is asked for, in words. */
export const LINE_LONGER: readonly [number, number, number] = [14, 16, 18];

/** The lines that are too short, by position. A wordless shot and a script with no spaces are left alone. */
export function linesTooShort(captions: ReadonlyArray<string | null | undefined>): number[] {
  const out: number[] = [];
  captions.forEach((c, i) => {
    if (!c || CJK.test(c)) return;
    const n = saidWords(c);
    if (n > 0 && n < LINE_WORDS_SHORT) out.push(i);
  });
  return out;
}

/** The one request for the short ones: every line in order, the short ones marked, each at three LONGER lengths — and
 *  beside each line, WHAT WE SEE in its shot (`visuals`), so a longer line adds nothing the picture does not have (review
 *  of item 3, 2026-11-26: "a reason, a detail, a beat of reaction" asked blind could invent a clue, a person or a fact —
 *  against a Mystery's clues named in its first VISUAL and a Thriller's planted turn; the director's-note rewrite keeps
 *  "WHAT WE SEE STAYS" for the same reason). */
export function growAsk(captions: ReadonlyArray<string | null | undefined>, short: ReadonlyArray<number>, visuals: ReadonlyArray<string | null | undefined> = []): string {
  const [a, b, c] = LINE_LONGER;
  const seen = (i: number): string => { const v = (visuals[i] || "").replace(/\s+/g, " ").trim().slice(0, 300); return v ? `\n   (what we see in this shot: ${v})` : ""; };
  const sheet = captions.map((l, i) => `${i + 1}. ${short.includes(i) ? `[TOO SHORT — ${saidWords(l)} words] ` : ""}${(l || "").replace(/\s+/g, " ").trim()}${seen(i)}`).join("\n");
  return (
    `These are the lines of a short acted scene, in order, one speaker per line, each written as "NAME: what they say". ` +
    `Every line is spoken in ONE shot that is never shorter than five seconds, so a line needs about ${a} to ${c} spoken words (the NAME is not spoken) or the shot is left with dead air. The lines marked [TOO SHORT] have fewer.\n\n` +
    `${sheet}\n\n` +
    `For EVERY marked line write THREE longer versions of it — the SAME speaker, the same meaning, feeling and punch, in the language the line is written in, at three LENGTHS: about ${a}, about ${b} and about ${c} spoken words, as two short sentences, never a speech. Longer means more is SAID (a reason, a detail, a beat of reaction), never filler and never a word repeated; a line that lands a joke still ends on it. Add no new object, person, place or fact: a longer line speaks only of what this story and its shot already have.\n` +
    `Return "lines": exactly ${captions.length} entries, one for each line above in the same order. The entry for a marked line is the list of its three versions, shortest first, each as "NAME: what they say" and nothing else (no numbers, no marks). The entry for an unmarked line is an EMPTY list.`
  );
}

/** Of a short line's versions: the SAME speaker's, longer than written, never over LINE_WORDS_MAX — the longest wins. */
export function pickLonger(original: string, versions: ReadonlyArray<unknown>): string {
  const was = splitLine(original);
  const had = saidWords(original);
  let best: { said: string; n: number } | null = null;
  for (const v of versions) {
    if (typeof v !== "string") continue;
    const now = splitLine(v.replace(/^\s*\d+\.\s*/, "").replace(/^\s*\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").trim());
    if (now.name.toLowerCase() !== was.name.toLowerCase()) continue;
    const n = (now.said.match(/\S+/g) || []).length;
    if (n <= had || n > LINE_WORDS_MAX) continue;
    if (!best || n > best.n) best = { said: now.said, n };
  }
  if (!best) return original;
  return was.name ? `${was.name}: ${best.said}` : best.said;
}

/** The lines after the longer versions came back: only a marked line can change; a wrong answer changes nothing. */
export function takeLonger(captions: ReadonlyArray<string | null | undefined>, short: ReadonlyArray<number>, rewritten: unknown): string[] {
  const base = captions.map((c) => c || "");
  if (!Array.isArray(rewritten) || rewritten.length !== captions.length) return base;
  return base.map((orig, i) => (short.includes(i) ? pickLonger(orig, Array.isArray(rewritten[i]) ? rewritten[i] : [rewritten[i]]) : orig));
}
