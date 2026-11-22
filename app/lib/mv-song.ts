/* HOW MUCH SONG A MUSIC VIDEO NEEDS — and which engine sings it.
 *
 * The video is cut to exactly the length that was picked, and the song is fit to it: a song that is too
 * long is trimmed with a fade, a song that is too SHORT is repeated. The first live 30-second videos of
 * five-second scenes (2026-11-21) were given six lines and had sung them all by 15–17 seconds — the
 * second half of each video was the first half's words again, the lyrics on screen stopped, and a
 * co-star's featured verse was a repeat of the opening.
 *
 * So the lyric budget is no longer a guess at "a line every five seconds". The engines were measured
 * (2026-11-22: the same plain nine-word lines sung in each genre's own style, timed word by word):
 *
 *   SHORT engine (minimax/music-1.5 — 590 characters of lyrics at most): it sings the sheet ONCE at a
 *   pace set by the genre, then stops, plays on without words, or makes words up (the track itself came
 *   back anywhere from 26 seconds to over four minutes for the same kind of sheet — only the pace is
 *   steady). Rap 3.2 and 3.5 words a second; rock 3.25; pop 2.1, 2.2, 2.3; R&B 2.4; country 1.7 and
 *   2.2. It usually starts singing in the first second — but one country song and one R&B song opened
 *   with 10–12 seconds of music.
 *
 *   FULL-LENGTH engine (minimax/music-2.5 — 3,400 characters): takes a tagged sheet and arranges a whole
 *   song at a steady 4.4–5.5 seconds a line whatever the genre. It ALWAYS opens with about fifteen
 *   seconds of music, [Intro] tag or not (15.0 s without it, 16.8 s with) — so it is for videos of a
 *   minute and up only: a shorter video cannot spend half its length waiting for the first word.
 *
 * Either engine's opening is then cut down to a few seconds before the first word (the pipeline's
 * trimSongIntro), so the singing starts while the opening shot is still on screen.
 *
 * The writer (film-engine) and the render (music-video-pipeline) both ask HERE, so the song that is
 * written is the song the engine it is given to can sing. Pure and import-free. */

export type SongEngine = "short" | "full";

/** Words a second the SHORT engine sings, by genre (measured — see above). */
export const SING_RATE: Record<string, number> = { rap: 3.2, rock: 3.2, pop: 2.2, rnb: 2.3, country: 2.0 };
const DEFAULT_RATE = 2.2;

/** The most words the short engine's lyric limit holds (590 characters ≈ 6 a word with its space). */
export const SHORT_ENGINE_WORDS = 95;

/** Seconds a line takes on the full-length engine. A touch under what was measured (4.4–5.5), so the song
 *  comes out a little LONGER than the video and is trimmed, never repeated. */
export const FULL_LINE_SECONDS = 4.2;

/** A video of a minute or more is the full-length engine's; anything shorter is the short engine's. */
export const FULL_SONG_SECONDS = 60;

/** The most music a song may open with before its first word, and how much is left when it is cut down. */
export const INTRO_MAX_SECONDS = 5;
export const INTRO_KEEP_SECONDS = 3.5;

const rateOf = (genre: string | null | undefined): number => SING_RATE[genre || ""] || DEFAULT_RATE;

/** Which engine sings a video of this length. */
export const songEngineFor = (videoSecs: number): SongEngine => (videoSecs >= FULL_SONG_SECONDS ? "full" : "short");

/** How many words of lyric a video of this length needs on the SHORT engine: its seconds at the genre's
 *  pace and a little over (the last line is better faded out than the song found a few words short) —
 *  but never more than the engine takes. (Rap and rock fill that limit at about half a minute: a longer
 *  short-engine video in those genres ends on music, or on the hook again.) */
export function songWordsFor(genre: string | null | undefined, videoSecs: number): number {
  return Math.min(SHORT_ENGINE_WORDS, Math.max(8, Math.round(Math.max(5, videoSecs) * rateOf(genre) * 1.08)));
}

/** How many lines the full-length engine is given for a video of this length. */
export const fullSongLines = (videoSecs: number): number => Math.max(4, Math.round(videoSecs / FULL_LINE_SECONDS));

/** About how many words of lyric fall in ONE scene, on the short engine. */
export function sceneWordsFor(genre: string | null | undefined, sceneSec: number, videoSecs?: number): number {
  const even = Math.round(sceneSec * rateOf(genre));
  // where the engine's limit caps the song, a scene's share is its share of what fits
  const capped = videoSecs && videoSecs > 0 ? Math.round((songWordsFor(genre, videoSecs) * sceneSec) / videoSecs) : even;
  return Math.max(4, Math.min(even, capped));
}

/** A scene's lyric as a RANGE of words, and as lines — how the writer is told it.
 *
 *  Told "about 11 words — 1–2 short lines" the writer gave 13–14 a scene (the song ran a scene late and
 *  its last lines were never sung). Told that AND "never more than 13" it gave 7–9 — fifty words for a
 *  song that needs about seventy, which would have run out at 23 seconds of a 30-second video. A range
 *  with both ends, said as lines of so-many words, is what it can count to. */
export function sceneWordRange(genre: string | null | undefined, sceneSec: number, videoSecs?: number): { lo: number; hi: number } {
  const w = sceneWordsFor(genre, sceneSec, videoSecs);
  return { lo: Math.max(4, w - 1), hi: w + 1 };
}

const NUMBER_WORD = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"];
/** "two lines of 5–6 words": a scene's words as lines of about seven words or fewer. */
export function wordsAsLineCount(words: number): string {
  const lines = Math.max(1, Math.round(words / 7));
  const lo = Math.floor(words / lines), hi = Math.ceil(words / lines);
  return `${NUMBER_WORD[lines] || lines} line${lines === 1 ? "" : "s"} of ${lo === hi ? lo : `${lo}–${hi}`} words`;
}

/** How many words are in a lyric (its " / " line breaks and punctuation are not words). */
export const lyricWords = (caption: string | null | undefined): number => (caption || "").replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** What a scene's lyric is told about its own length when the sheet is rewritten: how many words it has,
 *  and how many to add or lose. (The writer cannot count to a number it is given — asked for 10–12 words
 *  a scene it wrote 13–14, then 7–9, then 6–8 — but it can add "3 to 5 more words" to a line it is shown.) */
export function lyricAsk(words: number, lo: number, hi: number): string {
  if (words < lo) return `${words} words — needs ${lo - words} to ${hi - words} MORE`;
  if (words > hi) return `${words} words — needs ${words - hi} to ${words - lo} FEWER`;
  return `${words} words — the right length, leave it as it is`;
}

/** Of several versions of ONE scene's lyric, the one nearest the length the scene needs (`want` words).
 *  The first version given wins a tie — pass the lyric the scene has now first, and it is only replaced
 *  by one that fits better. Empty versions are skipped; "" when there is none. */
export function pickLyric(versions: Array<string | null | undefined>, want: number): string {
  let best = "", bestOff = Infinity;
  for (const v of versions) {
    const t = (v || "").trim();
    if (!t) continue;
    const off = Math.abs(lyricWords(t) - want);
    if (off < bestOff) { best = t; bestOff = off; }
  }
  return best;
}

/** DOES A SHEET FIT ITS VIDEO (short engine)? `captions` = each scene's lyric. `total` words against the
 *  `want` the scenes add up to; `off` = how far it is from fitting (0 = fits): words short of nine-tenths
 *  of what is wanted, words over a tenth more, and every word a scene runs past its own ceiling. */
export function lyricFit(captions: Array<string | null | undefined>, genre: string | null | undefined, sceneSec: number, videoSecs?: number): { total: number; want: number; lo: number; hi: number; off: number } {
  const { lo, hi } = sceneWordRange(genre, sceneSec, videoSecs);
  const counts = captions.map(lyricWords);
  const total = counts.reduce((a, b) => a + b, 0);
  const want = captions.length * sceneWordsFor(genre, sceneSec, videoSecs);
  const short = Math.max(0, Math.ceil(want * 0.9) - total);
  const long = Math.max(0, total - Math.floor(want * 1.1));
  const over = counts.reduce((a, c) => a + Math.max(0, c - (hi + 1)), 0);
  return { total, want, lo, hi, off: short + long + over };
}

/** A count of words as the writer is told it: "3–5 short lines". */
export function wordsAsLines(words: number): string {
  const lo = Math.max(1, Math.floor(words / 10)), hi = Math.max(1, Math.ceil(words / 7));
  return lo === hi ? `${lo} short line${lo === 1 ? "" : "s"}` : `${lo}–${hi} short lines`;
}

/** A lyric sheet cut to at most `max` characters by dropping whole LINES from the end (never half a
 *  word): what the short engine is sent when the writer ran over its limit. A single line longer than
 *  the limit is cut at a word. */
export function fitLyricLines(sheet: string, max: number): string {
  const lines = (sheet || "").split("\n").map((l) => l.trim()).filter(Boolean);
  while (lines.length > 1 && lines.join("\n").length > max) lines.pop();
  const out = lines.join("\n");
  if (out.length <= max) return out;
  const cut = out.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.5 ? cut.slice(0, at) : out.slice(0, max)).trim();
}

/** HOW LOUD THE FINISHED VIDEO IS. The song engine hands back whatever level it likes, and a re-voiced
 *  take is level-matched to that: the four live test videos measured -16.2, -11.3, -12.3 and -10.2 LUFS,
 *  two of them with peaks 1.6-1.7 dB OVER full scale (which a phone simply clips). One plain gain — never
 *  a compressor, so the song's own dynamics are untouched — brings the track to the level the platforms
 *  play at (about -14 LUFS) or as near as its peaks allow, and always leaves the peaks room for the
 *  final encode. `loudness` = the track's integrated loudness (LUFS), `peak` its highest peak (dBFS).
 *  Returns the gain in dB (0 = leave it: it is already there, or it could not be measured). */
export const TARGET_LUFS = -14;
export const PEAK_CEILING_DB = -1.5;
export function levelGain(loudness: number | null | undefined, peak: number | null | undefined): number {
  if (loudness == null || peak == null || !Number.isFinite(loudness) || !Number.isFinite(peak) || loudness < -60) return 0;
  const g = Math.max(-12, Math.min(6, Math.min(TARGET_LUFS - loudness, PEAK_CEILING_DB - peak)));
  return Math.abs(g) < 0.5 ? 0 : Math.round(g * 10) / 10;
}

/** WHERE TO START a song whose first word comes late: `firstWord` seconds in (null = no words were
 *  heard). Returns how many seconds to cut off the front — 0 when the song already starts soon enough. */
export function introCut(firstWord: number | null | undefined): number {
  if (firstWord == null || !Number.isFinite(firstWord) || firstWord <= INTRO_MAX_SECONDS) return 0;
  return Math.max(0, firstWord - INTRO_KEEP_SECONDS);
}
