/* LYRICS ON SCREEN — the song's own lyric lines, timed to the voice that sings them.
 *
 * A music video's song is written from the scene lyrics, but the song engine decides when each line is
 * sung (an intro, a held note, a repeated hook), and the song is then fit to the video's length — so a
 * scene's lyric is not what plays under that scene. The only honest clock is the song itself: the heard
 * words (whisperx) are matched to the written lyrics in order, and every lyric word takes its time from
 * the heard word it matches. Words the transcriber misheard or missed sit between the matched ones;
 * lines the song never reached (cut by the length fit) are dropped. Pure, so it is tested. */

import type { WordT, Window } from "./narrated-core";

/* ---- HOW A SONG IS LISTENED TO ----
 * Measured 2026-11-22 on four finished music videos, after one came out with no words on screen for its
 * first sixteen seconds: the copy of the sound sent to the transcriber was 16 kHz at 64 kbps, and on a
 * full mix that was enough to lose the singing —
 *     16 kHz / 64k, stock settings   0 of 56 lyric words heard (one "oh, oh, oh"); another song lost its last 5 s
 *     44.1 kHz / 192k, stock          52 of 56, every line
 *     either, with the voice detector set softer   52 of 56, every line, on all four songs
 * (the transcriber's "prompt" — handing it the lyrics — made it WORSE: 14 of 56). So a song goes over at
 * full rate, the voice detector is set softer for singing, and a first listen that catches under
 * LISTEN_AGAIN_BELOW of the lyrics gets a second one on the stock settings; the better of the two is kept. */

/** ffmpeg output options for the copy of a video's sound that is sent to be heard. */
export const LISTEN_AUDIO: readonly string[] = ["-ac", "1", "-ar", "44100", "-b:a", "192k"];
/** The transcriber's voice detector, set softer: singing over a band is quieter "speech" than talking. */
export const SUNG_VAD = { vad_onset: 0.2, vad_offset: 0.15 } as const;
/** A listen that matched less of the lyrics than this is worth a second one. */
export const LISTEN_AGAIN_BELOW = 0.6;
/** Did this listen catch too little of the lyrics to trust (so: listen again)? */
export const heardTooLittle = (r: { matched: number; total: number }): boolean => r.total > 0 && r.matched / r.total < LISTEN_AGAIN_BELOW;

/** EXACTLY narrated-core's drawable() (the caption cards split lines with it, so the timed words must be
 *  cut the same way) — kept here so this module has no runtime import; tests/lyric-sync.test.ts holds the
 *  two equal. */
export const drawable = (s: string): string => s.replace(/[']/g, "’").replace(/[—–]/g, " ").replace(/[^\p{L}\p{N} .,!?$%’…-]/gu, "").replace(/\s+/g, " ").trim();

const norm = (w: string) => w.toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, "");

/** Two words are "the same" when equal, or (long enough) one letter apart, or one is a clear prefix of
 *  the other — singing stretches and swallows syllables, and the transcriber spells what it hears. */
function same(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4) return false;
  // one edit apart
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export type LyricTiming = { lines: string[]; windows: Window[]; timed: WordT[]; matched: number; total: number };

/** Lyric lines + heard words → the lines the song actually sings, each line's window, and every word's
 *  time (in the order and spelling of the lyrics, `last` on each line's final word — the shape boldCards
 *  and subtitleCards take). `matched/total` says how much of the lyrics was heard. */
export function lyricWordTimes(lyricLines: string[], heard: WordT[]): LyricTiming {
  const lines = lyricLines.map((l) => drawable(l)).filter(Boolean);
  const toks: Array<{ word: string; line: number; n: string }> = [];
  lines.forEach((l, k) => l.split(" ").filter(Boolean).forEach((word) => toks.push({ word, line: k, n: norm(word) })));
  const H = heard.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start).map((w) => ({ ...w, n: norm(w.word) }));
  const n = toks.length, m = H.length;
  const empty: LyricTiming = { lines: [], windows: [], timed: [], matched: 0, total: n };
  if (!n || !m) return empty;

  // in-order alignment (longest common subsequence under `same`), so a repeated chorus word is matched
  // to ITS place in the song rather than to the first time it was heard
  const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    L[i][j] = same(toks[i].n, H[j].n) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const at: Array<number | null> = new Array(n).fill(null);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (same(toks[i].n, H[j].n) && L[i][j] === L[i + 1][j + 1] + 1) { at[i] = j; i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  const matched = at.filter((x) => x !== null).length;
  if (!matched) return { ...empty, total: n };

  // times: a matched word from its heard word. An unheard word is placed by the heard words of ITS OWN
  // line — between two of them evenly; at the start of its line just ahead of the line's first heard
  // word; at the end just after its last — never spread across an instrumental break between lines.
  const time: Array<{ start: number; end: number } | null> = at.map((j) => (j === null ? null : { start: H[j].start, end: Math.max(H[j].end, H[j].start + 0.05) }));
  const hits = at.map((j, i) => (j !== null ? i : -1)).filter((i) => i >= 0);
  const PER = 0.35; // seconds per unheard word at the edge of a line (a sung word, roughly)
  for (let i = 0; i < n; i++) {
    if (time[i]) continue;
    let a = -1, b = -1;
    for (const h of hits) { if (h < i) a = h; else { b = h; break; } }
    const sameA = a >= 0 && toks[a].line === toks[i].line;
    const sameB = b >= 0 && toks[b].line === toks[i].line;
    if (sameA && sameB) {
      const ta = time[a]!.end, tb = time[b]!.start;
      const step = Math.max(0.05, (tb - ta) / (b - a));
      time[i] = { start: ta + step * (i - a - 1), end: ta + step * (i - a) };
    } else if (sameB) {
      const tb = time[b]!.start, k = b - i;
      time[i] = { start: Math.max(0, tb - PER * k), end: Math.max(0.05, tb - PER * (k - 1)) };
    } else if (sameA) {
      const ta = time[a]!.end, k = i - a;
      const cap = b >= 0 ? time[b]!.start : Infinity;
      time[i] = { start: Math.min(ta + PER * (k - 1), cap - 0.05), end: Math.min(ta + PER * k, cap) };
    }
    // neither: no word of this line was heard near it — the line is left for `keep` to judge
  }

  // keep the lines the song really sings: at least a third of their words heard (the rest of a line can
  // be timed from its neighbours; a line with almost nothing heard was not sung where we would put it)
  const keep = lines.map((_, k) => {
    const mine = toks.map((t, i) => ({ t, i })).filter((x) => x.t.line === k);
    const hit = mine.filter((x) => at[x.i] !== null).length;
    return mine.length > 0 && hit / mine.length >= 0.34 && mine.every((x) => time[x.i]);
  });
  const outLines: string[] = [];
  const windows: Window[] = [];
  const timed: WordT[] = [];
  lines.forEach((line, k) => {
    if (!keep[k]) return;
    const mine = toks.map((t, i) => ({ t, i })).filter((x) => x.t.line === k);
    mine.forEach((x, idx) => timed.push({ word: x.t.word, start: time[x.i]!.start, end: time[x.i]!.end, ...(idx === mine.length - 1 ? { last: true } : {}) }));
    outLines.push(line);
    windows.push({ t0: Math.max(0, time[mine[0].i]!.start - 0.1), t1: time[mine[mine.length - 1].i]!.end + 0.5 });
  });
  // a line's window never runs into the next line's
  for (let k = 0; k + 1 < windows.length; k++) windows[k].t1 = Math.min(windows[k].t1, windows[k + 1].t0);
  return { lines: outLines, windows, timed, matched, total: n };
}

/** WHEN each scene's own lyric lines are actually sung: for every line the song really sings, the scene
 *  it was written for and the time of its first and last word. (For a featured verse — mv-feature.ts —
 *  so a co-star's voice comes in on THEIR first line rather than on the scene.) Lines the song never
 *  reached are simply absent. */
export function sceneLineTimes(scenes: Array<{ caption?: string }>, heard: WordT[]): Array<{ scene: number; start: number; end: number }> {
  const all: Array<{ line: string; scene: number }> = [];
  scenes.forEach((s, i) => (s?.caption || "").split(/\s*\/\s*|\n/).map((l) => drawable(l.replace(/\s+/g, " ").trim())).filter(Boolean).forEach((line) => all.push({ line, scene: i })));
  const t = lyricWordTimes(all.map((x) => x.line), heard);
  // the timed words come line by line, `last` closing each kept line
  const spans: Array<{ start: number; end: number }> = [];
  let open: { start: number; end: number } | null = null;
  for (const w of t.timed) {
    if (!open) open = { start: w.start, end: w.end };
    open.start = Math.min(open.start, w.start);
    open.end = Math.max(open.end, w.end);
    if (w.last) { spans.push(open); open = null; }
  }
  // the kept lines are, in order, some of the written ones: walk both to find which scene each belongs to
  const out: Array<{ scene: number; start: number; end: number }> = [];
  let k = 0;
  for (let q = 0; q < t.lines.length && q < spans.length; q++) {
    while (k < all.length && all[k].line !== t.lines[q]) k++;
    if (k >= all.length) break;
    out.push({ scene: all[k].scene, start: spans[q].start, end: spans[q].end });
    k++;
  }
  return out;
}

/** The lyric lines of a music video, from its scenes: each scene's lyric chunk, its lines split on " / ". */
export function lyricLinesOf(scenes: Array<{ caption?: string }>): string[] {
  return scenes.flatMap((s) => (s.caption || "").split(/\s*\/\s*|\n/)).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}
