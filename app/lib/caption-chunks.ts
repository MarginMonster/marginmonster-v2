/* Splitting a spoken script into burned-in caption cards.
 *
 * The old rule was one line long: pack words up to a 16-character / 3-word
 * budget and cut. It knows nothing about grammar, so a real video in the
 * merchant's Archive captions as:
 *
 *     EVER SEEN | POKEMON LOOK | THE WILD. THIS | NATURAL | BRINGS SIX
 *
 * "THE WILD. THIS" carries a full stop in the middle and the next sentence's
 * first word tacked on the end. On a burned-in caption that is not a rough
 * edge — it is the merchant's finished video, and it reads as broken.
 *
 * Two rules fix it:
 *
 *   1. A chunk never spans a sentence boundary. Split on terminators first,
 *      then pack words inside each sentence.
 *   2. A long sentence breaks at its own clause boundaries (comma, semicolon,
 *      colon, dash) before it breaks anywhere else, because that is where a
 *      speaker pauses and therefore where a cut is invisible.
 *
 * And the cap is a rebalance, not a truncation: the old code did
 * chunks.slice(0, 20), so a script that produced more simply lost its ending —
 * the captions stopped while the voice-over kept talking. Widening the budget
 * until everything fits keeps the captions covering the audio.
 *
 * Pure, so it can be tested without rendering a video —
 * see tests/caption-chunks.test.ts.
 */

/** A hard stop: the next chunk must start after this.
 *
 *  Two patterns, because the whitespace requirement is not optional in one
 *  script and impossible in the other. Latin needs the space or "$29.99" and
 *  "3.5 hours" split down the middle. CJK never writes one after 。, so
 *  requiring it meant a Chinese script was never split on sentences at all
 *  and captioned straight through the full stop.
 */
const SENTENCE_END = /(?<=[.!?…])\s+|(?<=[。！？])\s*/;
/** A natural pause inside a sentence, kept ON the left-hand piece. */
const CLAUSE_SPLIT = /(?<=[,;:，、；：—–])\s*/;

export type ChunkOpts = {
  /** Max characters per card. */
  budget: number;
  /** Max words per card — the punchy UGC rhythm. Ignored for scripts with no spaces. */
  maxWords: number;
  /** Never emit more cards than this; the budget widens instead of dropping any. */
  maxChunks: number;
};

export const LATIN_OPTS: ChunkOpts = { budget: 16, maxWords: 3, maxChunks: 20 };
/** CJK glyphs are square and ~1.05×fontsize wide, so far fewer fit a 720px frame. */
export const CJK_OPTS: ChunkOpts = { budget: 9, maxWords: 99, maxChunks: 20 };

const splitKeeping = (text: string, re: RegExp): string[] =>
  text.split(re).map((s) => s.trim()).filter(Boolean);

/** Sentences, then clauses inside any sentence that is over budget. */
function segments(script: string, budget: number): string[] {
  const out: string[] = [];
  for (const sentence of splitKeeping(script, SENTENCE_END)) {
    if (sentence.length <= budget) { out.push(sentence); continue; }
    for (const clause of splitKeeping(sentence, CLAUSE_SPLIT)) out.push(clause);
  }
  return out;
}

/** Pack one segment's words into cards, never crossing into another segment. */
function packWords(segment: string, o: ChunkOpts): string[] {
  const words = segment.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const joined = cur ? `${cur} ${w}` : w;
    if (cur && (joined.length > o.budget || cur.split(" ").length >= o.maxWords)) {
      out.push(cur);
      cur = w;
    } else {
      cur = joined;
    }
  }
  if (cur) out.push(cur);

  // A one-word card left over at the end of a segment reads as a stutter —
  // "…this set brings | six | hand-painted". Fold it back into the card
  // before it when that card can take it. Only ever within this segment, so
  // the sentence rule above still holds.
  if (out.length > 1 && !out[out.length - 1].includes(" ")) {
    const merged = `${out[out.length - 2]} ${out[out.length - 1]}`;
    if (merged.length <= Math.round(o.budget * 1.35) && merged.split(" ").length <= o.maxWords + 1) {
      out.splice(out.length - 2, 2, merged);
    }
  }
  return out;
}

/** A script with no spaces at all (CJK) — cut it by glyph count instead. */
function packGlyphs(segment: string, budget: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < segment.length; i += budget) out.push(segment.slice(i, i + budget));
  return out;
}

/** A card should not end mid-thought on a dangling separator; the cut IS the
 *  pause. A terminator stays, because it tells the viewer the thought landed. */
const tidy = (chunk: string): string => chunk.replace(/[,;:，、；：—–]+$/, "").trim();

/** Any CJK ideograph, kana or hangul — the glyphs that are square and wide. */
const hasCJK = (s: string): boolean =>
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/.test(s);

/** Two short cards in a row become one, while they still fit. Used only when
 *  a script would otherwise blow the card ceiling: a card carrying two short
 *  whole sentences reads fine, and it is strictly better than dropping the
 *  end of what the voice-over is saying. */
function mergeAdjacent(chunks: string[], budget: number): string[] {
  const out: string[] = [];
  for (const c of chunks) {
    const prev = out[out.length - 1];
    if (prev && `${prev} ${c}`.length <= budget) out[out.length - 1] = `${prev} ${c}`;
    else out.push(c);
  }
  return out;
}

export function captionChunks(script: string, opts: Partial<ChunkOpts> = {}): string[] {
  // The BUDGET is chosen by script, because that is what decides how many
  // glyphs fit a 720px frame. The PACKING is chosen by whether there are
  // spaces to pack along, which is a different question — a Chinese script
  // with Latin brand names in it has both.
  const spaceless = !/\s/.test(script.trim()) && script.trim().length > 0;
  const base = { ...(hasCJK(script) ? CJK_OPTS : LATIN_OPTS), ...opts };
  const text = (script || "").trim();
  if (!text) return [];

  // Widen the budget rather than dropping the end of the script. A caption
  // track that stops while the voice-over keeps talking is worse than one
  // that reads a little denser.
  let last: string[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    const budget = base.budget + attempt * 4;
    const maxWords = base.maxWords + attempt;
    let chunks = segments(text, budget)
      .flatMap((seg) => (spaceless ? packGlyphs(seg, budget) : packWords(seg, { ...base, budget, maxWords })))
      .map(tidy)
      .filter(Boolean);
    // Past the first pass, let two short cards share one — including across a
    // sentence boundary, which is the one place that is safe to cross because
    // both sentences are whole.
    if (attempt > 0) chunks = mergeAdjacent(chunks, budget);
    if (chunks.length <= base.maxChunks) return chunks;
    last = chunks;
  }
  // Genuinely more speech than the frame can caption. Keep a contiguous
  // prefix rather than a gapped selection, so what does show still lines up
  // with what is being said.
  return last.slice(0, base.maxChunks);
}
