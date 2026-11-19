/* THE AD PACK — what a merchant needs beside the video to run it as an ad: the video in every shape
 * (ad-sizes.ts), its captions as the file every platform takes (.srt), and the words that go around it
 * (a headline and the primary text). The plain parts live here, where they are tested: cutting the heard
 * words into caption cues, writing the SRT, and holding copy to each field's limit. Client-safe. */

export type HeardWord = { word: string; start: number; end: number };
export type Cue = { t0: number; t1: number; text: string };

/** Heard words → caption cues a phone viewer reads in one glance: one short line each (≤ maxChars), a new
 *  cue after a sentence ends or a real pause, never more than maxDur on screen, at least minDur when the
 *  next cue leaves room, and never overlapping the next one. */
export function srtCues(words: HeardWord[], o: { maxChars?: number; maxDur?: number; pause?: number; minDur?: number } = {}): Cue[] {
  const maxChars = o.maxChars ?? 32, maxDur = o.maxDur ?? 3.5, pause = o.pause ?? 0.7, minDur = o.minDur ?? 0.8;
  const clean = words
    .map((w) => ({ word: (w.word || "").replace(/\s+/g, " ").trim(), start: Number(w.start), end: Number(w.end) }))
    .filter((w) => w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start && w.start >= 0)
    .sort((a, b) => a.start - b.start);
  const cues: Cue[] = [];
  let cur: HeardWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    cues.push({ t0: cur[0].start, t1: cur[cur.length - 1].end, text: cur.map((w) => w.word).join(" ") });
    cur = [];
  };
  for (const w of clean) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const text = `${cur.map((x) => x.word).join(" ")} ${w.word}`;
      const sentenceEnded = /[.!?…。！？]["”’)]?$/.test(prev.word);
      if (text.length > maxChars || w.end - cur[0].start > maxDur || w.start - prev.end > pause || sentenceEnded) flush();
    }
    cur.push(w);
  }
  flush();
  // hold each cue long enough to read, but never into the next one
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    const room = next ? next.t0 - 0.05 : Infinity;
    if (cues[i].t1 - cues[i].t0 < minDur) cues[i].t1 = Math.min(cues[i].t0 + minDur, room);
    if (next && cues[i].t1 > room) cues[i].t1 = Math.max(cues[i].t0 + 0.1, room);
  }
  return cues;
}

/** Seconds → the SRT clock: HH:MM:SS,mmm. */
export function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

/** Cues → an SRT file (numbered from 1, a blank line after each, CRLF-free UTF-8 — every platform reads it). */
export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.t0)} --> ${srtTime(c.t1)}\n${c.text}\n`).join("\n");
}

/** The two fields every ad manager asks for, at the length each one shows in full: Meta cuts a headline
 *  around 40 characters and the primary text at 125 ("…See more"); TikTok's ad text is 100. */
export const AD_COPY_LIMITS = { headline: 40, primary: 125 } as const;

/** Hold copy to a field's limit without cutting a word in half: the longest run of whole sentences that
 *  fits, else whole words (no ellipsis — this is pasted into an ad manager as it is). */
export function fitCopy(text: string, max: number): string {
  const s = (text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const sentences = s.match(/[^.!?]+[.!?]+["”’)]?\s*/g) || [];
  let out = "";
  for (const x of sentences) { if ((out + x).trim().length > max) break; out += x; }
  if (out.trim().length >= Math.min(max * 0.5, 30)) return out.trim();
  const words = s.split(" ");
  out = "";
  for (const w of words) { if ((out ? `${out} ${w}` : w).length > max) break; out = out ? `${out} ${w}` : w; }
  return out.replace(/[,;:–—-]+$/, "").trim();
}
