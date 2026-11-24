/* A LYRIC VIDEO — a song in; its words big, timed and alive over a run of pictures that cut on the beat.
 *
 * The owner, 2026-11-24: "Add to music section "Lyric Video creator" this one should be simple active exciting
 * lyrics based on a YouTube video with scene cuts and stills yanno? Like a lyric visualizer simple - input link
 * and it converts to a Lyric Video" — and, on whose songs may go in: "Allow copyrighted dog, fuck it, it's a
 * lyric video. Hundreds of people do it". Any song may go in. Nothing here asks whose it is.
 *
 * THE LINK — our server fetching a song from a YouTube address. His word, 2026-11-24: "use YouTube link but
 * include regulatory things like 'you must have permissions from song owner'". So a link is fetched, and a video
 * made, only for a member who has ticked that they own the song or have its owner's permission (RIGHTS_LINE);
 * the piece keeps that confirmation (songRightsOf), and the Terms say what it means (/terms#songs). What a link
 * may fetch and how the tool is asked are below (youTubeId, ytDlpArgs); the fetching is lyric-video.server.ts
 * → songFromLink.
 *
 * Every decision is made in this file, where it can be tested; lyric-video.server.ts listens, draws and encodes.
 *
 *   1. THE WORDS     every sung word with its time — pasted lyrics laid over what is heard (lyric-sync.ts), or,
 *                    with none pasted, what is heard, cut into lines where the singer breathes (linesFromHeard)
 *   2. THE BEAT      the song's own pulse (mv-pace.ts → beatTimes) and where its bars start (beatGrid)
 *   3. THE SCENES    one picture per stretch of two to four bars, six to fourteen pictures in all; every cut on a
 *                    beat — a bar's first beat where one is near, the beat a sung line starts on best of all;
 *                    a long stretch is re-framed (the same picture, punched in) so the cutting never stalls
 *   4. THE LOOK      one art direction for the whole song (a writer reads its words; a fallback when it can't),
 *                    every picture drawn in it, with NO text in any picture (directionBrief / stillPrompt)
 *   5. THE LYRICS    an .ass file for the subtitle renderer (libass is in the production ffmpeg), in one of four
 *                    looks, every word placed from the font's own measurements (font-metrics.ts) so a line fills
 *                    the frame and never runs off it (lyricAss)
 *   6. THE CUT       each picture moving slowly — nudged on the beat in the loud looks — cut where the plan says,
 *                    shaded for reading, the song as the sound (motionFilter / chunkGraph)
 */

import { beatTimes } from "./mv-pace.ts";
import { textEms, type FontMetrics } from "./font-metrics.ts";
import { drawable, lyricWordTimes } from "./lyric-sync.ts";
import { frameWords, hasWide, joinUnits, type WordT } from "./narrated-core.ts";

/* ---------------------------------------------------------------------------------------------------------
 * THE CHOICES A MAKER HAS: a look, a shape. Everything else is decided from the song.
 * ------------------------------------------------------------------------------------------------------- */

export type LyricLook = "bold" | "karaoke" | "neon" | "minimal";
/** The looks, in the order the builder shows them. */
export const LYRIC_LOOKS: ReadonlyArray<{ key: LyricLook; label: string; blurb: string }> = [
  { key: "bold", label: "Bold", blurb: "Huge words slam in on the beat" },
  { key: "karaoke", label: "Karaoke", blurb: "The line lights up as it's sung" },
  { key: "neon", label: "Neon", blurb: "Glowing words flicker on" },
  { key: "minimal", label: "Minimal", blurb: "Clean and quiet, a line at a time" },
];
export const lyricLookOf = (v: unknown): LyricLook => (v === "karaoke" || v === "neon" || v === "minimal" ? v : "bold");

export type LyricShape = "9:16" | "16:9";
export const lyricShapeOf = (v: unknown): LyricShape => (v === "16:9" ? "16:9" : "9:16");
/** The frame, in pixels — the size every other render of the app is made at. */
export const lyricFrame = (shape: LyricShape): { W: number; H: number } => (shape === "16:9" ? { W: 1280, H: 720 } : { W: 720, H: 1280 });

export const LYRIC_FPS = 30;
/** A song longer than this is made into a video this long (the rest of the song is faded out). */
export const LYRIC_MAX_SECONDS = 360;
/** How many pictures a song gets — at least, and at most (each is a picture drawn and paid for). */
export const STILLS_MIN = 6;
export const STILLS_MAX = 14;
/** Pasted lyrics must match at least this much of what is heard to be the words on screen. */
export const PASTED_MIN_MATCH = 0.3;

/** About how long a lyric video takes to make, in minutes, for a song this long (seconds) — measured
 *  locally (lyric-video proof, 2026-11-24): about two minutes of listening and drawing, then the encode. */
export function lyricEtaMinutes(seconds: number): number {
  const s = Math.max(10, Math.min(LYRIC_MAX_SECONDS, Number.isFinite(seconds) ? seconds : 180));
  return Math.max(3, Math.round(2.5 + (s / 60) * 1.2));
}

/* ---------------------------------------------------------------------------------------------------------
 * THE SONG'S NAME, AND A LINK
 * ------------------------------------------------------------------------------------------------------- */

const NAME_JUNK = /[[(][^\])]*\b(?:official|audio|lyrics?|video|visuali[sz]er|hd|hq|4k|mp3|320|kbps|remaster(?:ed)?|explicit|clean|full song|music video)\b[^\])]*[\])]/gi;
/** A song's title from the name of its file: "03 - Night Drive (Official Audio).mp3" → "Night Drive". */
export function songTitleOf(fileName: string): string {
  let s = String(fileName || "").split(/[\\/]/).pop() || "";
  s = s.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/_+/g, " ").replace(NAME_JUNK, " ");
  s = s.replace(/^\s*\d{1,3}\s*[-.)]\s*/, "").replace(/\s*-\s*copy(?:\s*\(\d+\))?$/i, "");
  return s.replace(/\s+/g, " ").trim().slice(0, 80);
}

/** Is this a web address (a link to a song somewhere) rather than words? */
export const isSongLink = (s: string): boolean => /^\s*(?:https?:\/\/|www\.)\S+\s*$/i.test(String(s || ""));

/** The file name of a song WE stored (api.film-song-upload → /renders/mvsong-<hex>.<ext>), from the address
 *  the upload handed back — or null for any other address: a lyric video is only ever made from our own disk. */
export function songFileOf(songUrl: string): string | null {
  let p = "";
  try { p = new URL(String(songUrl || ""), "https://site.invalid").pathname; } catch { return null; }
  const m = /^\/renders\/(mvsong-[a-f0-9]{8,40}\.(?:mp3|wav|m4a|aac|ogg))$/i.exec(p);
  return m ? m[1] : null;
}

/* ---------------------------------------------------------------------------------------------------------
 * A SONG FROM A YOUTUBE LINK, AND WHOSE IT IS
 * ------------------------------------------------------------------------------------------------------- */

/** What the member ticks before a link is fetched or a video is made — and what they are told when they haven't
 *  (the owner, 2026-11-24: "you must have permissions from song owner"). */
export const RIGHTS_LINE = "I own this song, or I have permission from its owner to use it.";
export const RIGHTS_NOTE = "Songs you don't have the rights to can be muted, claimed or taken down where you post them.";
export const RIGHTS_ASK = "Tick the box to confirm you have the rights to this song.";

/** The hosts a link may name: YouTube's own, nothing else. (The fetching tool can read a thousand sites — it is
 *  only ever handed an address written here from a video's id.) */
const YT_HOSTS: ReadonlySet<string> = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** The video's id in a YouTube link — a watch page (www., m., music.), a youtu.be short link, a Short, an embed, a
 *  live recording — or null for anything else: a playlist or a channel, another site, a port, a login, words. */
export function youTubeId(link: string): string | null {
  let s = String(link ?? "").trim();
  if (!s || s.length > 2000 || /\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!YT_HOSTS.has(host)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  let id: string | null = null;
  if (host === "youtu.be") id = parts.length === 1 ? parts[0] : null;
  else if (parts.length === 1 && parts[0] === "watch") id = u.searchParams.get("v");
  else if (parts.length === 2 && ["shorts", "embed", "live", "v", "e"].includes(parts[0])) id = parts[1];
  return id && YT_ID.test(id) ? id : null;
}
/** The one address the fetching tool is handed — written from the id alone, never the member's own string. */
export const youTubeWatch = (id: string): string => `https://www.youtube.com/watch?v=${id}`;

/** The longest video a link may fetch, in seconds: a song with a long intro is under it; a three-hour mix is not. */
export const LINK_MAX_SECONDS = 900;
/** How many songs one account may fetch from links in a day (a lyric video is made from one). */
export const LINK_FETCHES_A_DAY = 12;
/** How long a fetch may take — inside the request, so well under the 100 s at which the site's proxy gives up. */
export const LINK_TIMEOUT_MS = 75_000;

/** What the fetching tool (yt-dlp) is asked: the audio of that ONE video — AAC (.m4a) when it has it, which needs
 *  no re-encoding — with its facts in a .info.json beside it. No playlist, nothing live, nothing too long or big;
 *  no config file on the machine can add to it. */
export function ytDlpArgs(watchUrl: string, outTemplate: string): string[] {
  return [
    "--ignore-config", "--no-playlist", "--no-progress", "--no-mtime",
    "--match-filter", `!is_live & duration <= ${LINK_MAX_SECONDS}`,
    "--max-filesize", "60M",
    "--socket-timeout", "20", "--retries", "2",
    "-f", "bestaudio[ext=m4a]/bestaudio/best",
    "--write-info-json",
    "-o", outTemplate,
    "--", watchUrl,
  ];
}

/** What a member is told when a link can't be fetched (English source words — the route runs them through tr()). */
export const LINK_MSG = {
  notYouTube: "That isn't a YouTube video link — paste one from youtube.com or youtu.be, or upload the song file.",
  noTool: "Links can't be fetched right now — upload the song file instead.",
  botCheck: "YouTube wouldn't hand that song over right now — upload the song file instead.",
  gone: "That video can't be reached — it may be private, removed or blocked. Try another link, or upload the song file.",
  age: "That video is age-restricted, so we can't fetch it — upload the song file instead.",
  long: "That video is too long or is a live stream — link the song itself, or upload the file.",
  big: "That one's too big to fetch — link the song itself, or upload the file.",
  slow: "That took too long — try again, or upload the song file.",
  many: "That's a lot of songs fetched today — upload the file, or try again tomorrow.",
  failed: "We couldn't fetch that song — try again, or upload the song file.",
} as const;
export type LinkFailure = keyof typeof LINK_MSG;

/** WHY A FETCH FAILED, read from what the tool printed. */
export function linkFailure(o: { code: number | null; out: string; err: string; timedOut: boolean }): LinkFailure {
  const s = `${o.out || ""}\n${o.err || ""}`;
  if (o.timedOut) return "slow";
  if (/does not pass filter|live event|premieres? in|is a live stream/i.test(s)) return "long";
  if (/larger than max-filesize/i.test(s)) return "big";
  if (/not a bot|HTTP Error 429|Too Many Requests/i.test(s)) return "botCheck";
  if (/confirm your age|age[- ]restricted|inappropriate for some users/i.test(s)) return "age";
  if (/requested format is not available/i.test(s)) return "failed";
  if (/private video|video unavailable|video is (?:not available|unavailable|no longer available)|has been removed|been terminated|members[- ]only|join this channel|available in your country|blocked it/i.test(s)) return "gone";
  return "failed";
}

/** A song's title from what its video says of itself: "Artist - Track" when YouTube knows them (a music upload),
 *  else the video's title — "(Official Video)" and the like taken off. A slash stays a slash ("AC/DC"). */
export function linkTitleOf(info: { title?: unknown; track?: unknown; artist?: unknown } | null | undefined): string {
  const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const track = str(info?.track);
  const artist = str(info?.artist).split(/\s*,\s*/)[0] || "";
  const raw = track ? (artist ? `${artist} - ${track}` : track) : str(info?.title);
  return raw.replace(NAME_JUNK, " ").replace(/\s+/g, " ").replace(/\s*[-–|]\s*$/, "").trim().slice(0, 80);
}

/** THE CONFIRMATION, as a piece keeps it: when the member ticked RIGHTS_LINE, and where the song came from (the
 *  YouTube address, written again from its id). Anything else is no confirmation at all. */
export type SongRights = { confirmed: true; at: string; from: "upload" | "youtube"; link?: string };
export function songRightsOf(v: unknown): SongRights | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.confirmed !== true || typeof o.at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(o.at)) return null;
  const from = o.from === "youtube" ? "youtube" : o.from === "upload" ? "upload" : null;
  if (!from) return null;
  const id = from === "youtube" && typeof o.link === "string" ? youTubeId(o.link) : null;
  return { confirmed: true, at: o.at.slice(0, 32), from, ...(id ? { link: youTubeWatch(id) } : {}) };
}

/* ---------------------------------------------------------------------------------------------------------
 * 1. THE WORDS
 * ------------------------------------------------------------------------------------------------------- */

export type LyricWord = { text: string; t0: number; t1: number };
export type LyricLine = { text: string; words: LyricWord[]; t0: number; t1: number };

const SECTION_WORDS = "(?:intro|outro|verse|chorus|pre-?chorus|post-?chorus|hook|bridge|refrain|interlude|break|breakdown|instrumental|drop|ad-?libs?|spoken|rap|solo)";
const SECTION_HEAD = new RegExp(`^(?:\\[[^\\]]*\\]|\\{[^}]*\\}|\\(\\s*${SECTION_WORDS}\\b[^)]*\\)|${SECTION_WORDS}\\b[\\s\\d.]*(?:x\\s*\\d+)?\\s*:?)$`, "i");
const REPEATED = /\s*(?:[[(]\s*(?:x\s*(\d)|(\d)\s*x)\s*[\])]|\bx\s*(\d))\s*$/i;

/** Pasted lyrics as the lines that are sung: the headings a lyric page carries ("[Chorus]", "Verse 2:") are not
 *  sung and are dropped; a line marked as repeated ("(x2)") is sung that many times, so it is there that many
 *  times. A line in brackets that is not a heading — "(oh, oh)" — is a backing vocal, and stays. */
export function pastedLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of String(text || "").slice(0, 12_000).split(/\r?\n/)) {
    let l = raw.replace(/\s+/g, " ").trim();
    if (!l || SECTION_HEAD.test(l)) continue;
    let times = 1;
    const rep = REPEATED.exec(l);
    if (rep) { times = Math.max(1, Math.min(4, Number(rep[1] || rep[2] || rep[3]) || 1)); l = l.slice(0, rep.index).trim(); }
    if (!/[\p{L}\p{N}]/u.test(l)) continue;
    for (let k = 0; k < times && out.length < 400; k++) out.push(l);
  }
  return out;
}

/** Lines whose words are in time order, each word at least a moment long, none empty. */
function tidyLines(lines: LyricWord[][]): LyricLine[] {
  const out: LyricLine[] = [];
  for (const ws of lines) {
    const words = ws.filter((w) => w.text && Number.isFinite(w.t0) && Number.isFinite(w.t1)).map((w) => ({ text: w.text, t0: Math.max(0, w.t0), t1: Math.max(w.t1, w.t0 + 0.06) }));
    for (let i = 1; i < words.length; i++) if (words[i].t0 < words[i - 1].t0) words[i].t0 = words[i - 1].t0;
    if (!words.length) continue;
    out.push({ text: joinUnits(words.map((w) => w.text)), words, t0: words[0].t0, t1: Math.max(...words.map((w) => w.t1)) });
  }
  return out.sort((a, b) => a.t0 - b.t0);
}

/** Lines out of timed words in which `last` closes each line — lyricWordTimes' shape. */
export function linesFromTimed(timed: WordT[]): LyricLine[] {
  const lines: LyricWord[][] = [];
  let cur: LyricWord[] = [];
  for (const w of timed) {
    const text = drawable(w.word);
    if (text) cur.push({ text, t0: w.start, t1: Math.max(w.end, w.start + 0.05) });
    if (w.last && cur.length) { lines.push(cur); cur = []; }
  }
  if (cur.length) lines.push(cur);
  return tidyLines(lines);
}

/** Words that lean on the next one: a line cut for its length does not end on one ("…the way that I" /
 *  "know"). English only — every other language is cut by its pauses and length alone. */
const LEAN = new Set("a an the and or but nor so of to in on at for with from by as into onto over under than that who which when while if because his her their my your our its this these those i".split(" "));
const bare = (w: string): string => w.toLowerCase().replace(/[^\p{L}\p{N}’']/gu, "");

export const LINE_PAUSE = 0.65;
export const LINE_MAX_WORDS = 8;
export const LINE_MAX_CHARS = 40;
export const LINE_MAX_SECONDS = 4.5;
const lineFits = (ws: LyricWord[]): boolean =>
  ws.length === 1 || (ws.length <= LINE_MAX_WORDS && joinUnits(ws.map((w) => w.text)).length <= LINE_MAX_CHARS && ws[ws.length - 1].t1 - ws[0].t0 <= LINE_MAX_SECONDS);

/** A phrase too long for one screen, cut into AS FEW LINES AS FIT and, of those cuts, the most even — where the
 *  singer breathes (a comma, the longest gap between two words), never after a word that leans on the next one,
 *  never leaving a word alone. (Cut greedily, "…lyric video layout" filled a line and "checking" was left on a
 *  screen of its own — the first dry run, 2026-11-24.) */
function splitPhrase(ph: LyricWord[]): LyricWord[][] {
  if (lineFits(ph)) return [ph];
  const n = ph.length;
  const best = new Array<number>(n + 1).fill(Infinity);
  const from = new Array<number>(n + 1).fill(-1);
  best[0] = 0;
  for (let j = 1; j <= n; j++) for (let i = j - 1; i >= 0; i--) {
    const seg = ph.slice(i, j);
    if (!lineFits(seg)) break;
    const chars = joinUnits(seg.map((w) => w.text)).length;
    let c = best[i] + 1000 + (chars * chars) / 10;
    if (j < n) {
      if (LEAN.has(bare(ph[j - 1].text))) c += 30;
      if (/,$/.test(ph[j - 1].text)) c -= 15;
      c -= Math.min(20, (ph[j].t0 - ph[j - 1].t1) * 40);
    }
    if (seg.length === 1) c += 25;
    if (c < best[j]) { best[j] = c; from[j] = i; }
  }
  const out: LyricWord[][] = [];
  for (let j = n; j > 0; j = from[j]) out.unshift(ph.slice(from[j], j));
  return out;
}

/** WHAT WAS HEARD, AS LINES — for a song nobody pasted the words of. A phrase is what is sung between two
 *  breaths (a pause of LINE_PAUSE, or a sentence's end); a phrase longer than a screen carries (words, letters,
 *  seconds) is cut into even lines where the singer breathes (splitPhrase). */
export function linesFromHeard(heard: WordT[]): LyricLine[] {
  const words = heard
    .map((w) => ({ text: drawable(w.word), t0: w.start, t1: Math.max(w.end, w.start + 0.05) }))
    .filter((w) => w.text && Number.isFinite(w.t0) && Number.isFinite(w.t1))
    .sort((a, b) => a.t0 - b.t0);
  const phrases: LyricWord[][] = [];
  let cur: LyricWord[] = [];
  for (const w of words) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      if (w.t0 - prev.t1 >= LINE_PAUSE || /[.!?…]$/u.test(prev.text)) { phrases.push(cur); cur = []; }
    }
    cur.push(w);
  }
  if (cur.length) phrases.push(cur);
  return tidyLines(phrases.flatMap(splitPhrase));
}

/** THE WORDS ON SCREEN: the pasted lyrics, timed by what was heard, when they match enough of it — or, when
 *  nothing was pasted (or what was pasted is not what is sung), what was heard. */
export function chooseLines(o: { pasted: string[]; heard: WordT[] }): { lines: LyricLine[]; from: "pasted" | "heard"; matched: number; total: number } {
  if (o.pasted.length) {
    const r = lyricWordTimes(o.pasted, o.heard);
    if (r.total > 0 && r.matched / r.total >= PASTED_MIN_MATCH) {
      const lines = linesFromTimed(r.timed);
      if (lines.length) return { lines, from: "pasted", matched: r.matched, total: r.total };
    }
    return { lines: linesFromHeard(o.heard), from: "heard", matched: r.matched, total: r.total };
  }
  return { lines: linesFromHeard(o.heard), from: "heard", matched: 0, total: 0 };
}

/** The heard words that sit where the separated vocal is SOUNDING (spans: narrated-core → soundSpans of the
 *  vocal alone). A listener writes a "thank you" into the quiet of a vocal track; nobody sang it there. With no
 *  spans to go by, every word is kept. */
export function voicedWords(words: WordT[], spans: Array<[number, number]>, slack = 0.15): WordT[] {
  if (!spans.length) return words;
  return words.filter((w) => spans.some(([a, b]) => w.end > a - slack && w.start < b + slack));
}

/* ---------------------------------------------------------------------------------------------------------
 * 2. THE BEAT
 * ------------------------------------------------------------------------------------------------------- */

export type BeatGrid = {
  /** every beat, in seconds */
  beats: number[];
  /** the beats a bar starts on (every fourth, where the low drum hits hardest) */
  bars: number[];
  bpm: number;
  /** one beat, in seconds (0 with no pulse) */
  beat: number;
  /** a steady pulse was found */
  steady: boolean;
};
export const NO_GRID: BeatGrid = { beats: [], bars: [], bpm: 0, beat: 0, steady: false };

/** How suddenly the LOW end gets louder, frame by frame (a kick drum is a spike here; a snare much less of
 *  one): the signal through two one-pole low-passes, its energy every 11.6 ms, the rise in its log. */
export function lowOnsets(pcm: Float32Array, sr: number, cutoff = 150): { fps: number; env: Float32Array } {
  const hop = Math.max(1, Math.round(sr * 0.0116));
  const win = hop * 2;
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
  const low = new Float32Array(pcm.length);
  let y1 = 0, y2 = 0;
  for (let i = 0; i < pcm.length; i++) { y1 += a * (pcm[i] - y1); y2 += a * (y1 - y2); low[i] = y2; }
  const n = Math.max(0, Math.floor((low.length - win) / hop));
  const env = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let e = 0;
    const o = i * hop;
    for (let k = 0; k < win; k++) { const x = low[o + k]; e += x * x; }
    const l = Math.log(1e-9 + e / win);
    env[i] = i ? Math.max(0, l - prev) : 0;
    prev = l;
  }
  return { fps: sr / hop, env };
}

/** The bars of a steady beat: which of every four beats is a bar's first. The low drum hits hardest on it
 *  (`kick` = how hard at a time); sung lines tend to start on it too, and break a near tie between the two
 *  beats a rock kick lands on. */
export function gridFromBeats(beats: number[], kick: (t: number) => number, lineStarts: number[] = []): BeatGrid {
  const bs = beats.filter((b) => Number.isFinite(b) && b >= 0).sort((a, b) => a - b);
  if (bs.length < 8) return NO_GRID;
  const gaps = bs.slice(1).map((b, i) => b - bs[i]).sort((a, b) => a - b);
  const beat = gaps[gaps.length >> 1];
  if (!(beat > 0.2 && beat < 1.5)) return NO_GRID;
  const sum = [0, 0, 0, 0], cnt = [0, 0, 0, 0];
  bs.forEach((b, k) => { sum[k % 4] += kick(b); cnt[k % 4]++; });
  const mean = sum.map((s, p) => (cnt[p] ? s / cnt[p] : 0));
  const top = Math.max(...mean) || 1;
  const votes = [0, 0, 0, 0];
  for (const t of lineStarts) {
    let k = 0;
    for (let i = 1; i < bs.length; i++) if (Math.abs(bs[i] - t) < Math.abs(bs[k] - t)) k = i;
    if (Math.abs(bs[k] - t) <= beat * 0.35) votes[k % 4]++;
  }
  const allVotes = votes.reduce((a, b) => a + b, 0) || 1;
  const score = mean.map((m, p) => m / top + (0.35 * votes[p]) / allVotes);
  let phase = 0;
  for (let p = 1; p < 4; p++) if (score[p] > score[phase] + 1e-9) phase = p;
  return { beats: bs, bars: bs.filter((_, k) => k % 4 === phase), bpm: 60 / beat, beat, steady: true };
}

/** THE SONG'S BEAT, from its samples (mono PCM at `sr` Hz): the beats themselves are the app's own finder
 *  (mv-pace.ts → beatTimes); the bars are found here. No steady pulse → NO_GRID, and the scenes are cut on
 *  the sung lines instead. */
export function beatGrid(pcm: Float32Array, sr: number, lineStarts: number[] = []): BeatGrid {
  const beats = beatTimes(pcm, sr);
  if (beats.length < 8) return NO_GRID;
  const lo = lowOnsets(pcm, sr);
  const reach = Math.max(1, Math.round(lo.fps * 0.04));
  const kick = (t: number): number => {
    const c = Math.round(t * lo.fps);
    let m = 0;
    for (let i = Math.max(0, c - reach); i <= Math.min(lo.env.length - 1, c + reach); i++) m = Math.max(m, lo.env[i]);
    return m;
  };
  return gridFromBeats(beats, kick, lineStarts);
}

/* ---------------------------------------------------------------------------------------------------------
 * 3. THE SCENES
 * ------------------------------------------------------------------------------------------------------- */

/** How a picture moves while it is up: zoom from z0 to z1 (1 = the whole picture), and where the view sits
 *  in the room the zoom leaves, from (x0, y0) to (x1, y1) — -1 the left / top edge, +1 the right / bottom. */
export type Move = { z0: number; z1: number; x0: number; x1: number; y0: number; y1: number };
/** One stretch of the video: a picture (by index), from t0 to t1, moving one way. */
export type Shot = { t0: number; t1: number; pic: number; move: Move };
/** One picture's stretch of the song, and the words sung in it (what its picture is drawn from). */
export type Section = { t0: number; t1: number; text: string };
export type ScenePlan = { duration: number; sections: Section[]; shots: Shot[]; grid: { beats: number[]; bars: number[]; bpm: number } };

const r3 = (x: number): number => Math.round(x * 1000) / 1000;
const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

/** The ways a fresh picture moves, in the order pictures take them: in, drift, out, drift back, rise. */
const MOVES: Move[] = [
  { z0: 1.0, z1: 1.12, x0: 0, x1: 0, y0: 0, y1: 0 },
  { z0: 1.12, z1: 1.16, x0: 0.7, x1: -0.7, y0: 0, y1: 0 },
  { z0: 1.15, z1: 1.03, x0: 0, x1: 0, y0: 0, y1: 0 },
  { z0: 1.12, z1: 1.16, x0: -0.7, x1: 0.7, y0: 0, y1: 0 },
  { z0: 1.1, z1: 1.16, x0: 0, x1: 0, y0: 0.6, y1: -0.6 },
];
/** The same picture again, a cut later: punched in on a corner of it, so the cut is seen. */
function reframe(j: number): Move {
  const side = j % 2 ? 1 : -1;
  const z0 = 1.26 + 0.08 * ((j - 1) % 2);
  return { z0, z1: z0 + 0.05, x0: side * 0.55, x1: side * 0.35, y0: -side * 0.35, y1: -side * 0.2 };
}

/** THE SCENE PLAN. One picture per stretch of the song — two to four bars where the song has a steady beat
 *  (about six seconds where it has none), STILLS_MIN to STILLS_MAX pictures — every cut on a beat: the bar's
 *  first beat where one is near, and best of all the beat a sung line starts on (the picture changes as the
 *  new line comes in), never in the middle of a word when that can be helped. A stretch longer than four bars
 *  (a long song has more stretches than pictures) is cut again on its bars into the same picture re-framed. */
export function scenePlan(o: { duration: number; grid: BeatGrid; lines: LyricLine[] }): ScenePlan {
  const T = Math.max(1, o.duration);
  const g = o.grid.steady ? o.grid : NO_GRID;
  const bar = g.steady ? g.beat * 4 : 0;
  const target = bar ? bar * 3 : 6;
  const minSec = bar ? Math.max(bar * 1.25, 2.2) : 3;
  let n = clamp(Math.round(T / target), STILLS_MIN, STILLS_MAX);
  n = Math.max(1, Math.min(n, Math.floor(T / minSec)));
  const starts = o.lines.map((l) => l.t0);
  const words = o.lines.flatMap((l) => l.words);
  const barSet = new Set(g.bars.map((b) => Math.round(b * 1000)));
  const isBar = (t: number): boolean => barSet.has(Math.round(t * 1000));
  const lineAt = (t: number): boolean => starts.some((s) => s >= t - 0.08 && s <= t + (bar ? g.beat * 1.1 : 0.6));
  const inWord = (t: number): boolean => words.some((w) => t > w.t0 + 0.05 && t < w.t1 - 0.05);
  // where a cut may go: on a beat — or, with no beat, where a line starts, or on the half second
  const cands: number[] = g.steady
    ? g.beats
    : [...starts.map((s) => Math.max(0, s - 0.05)), ...Array.from({ length: Math.floor(T * 2) }, (_, i) => i / 2)].sort((a, b) => a - b);
  const cuts: number[] = [];
  let prev = 0;
  for (let k = 1; k < n; k++) {
    const ideal = prev + (T - prev) / (n - k + 1); // what is left of the song, shared by the pictures left
    const lo = prev + minSec, hi = T - (n - k) * minSec;
    const reach = bar || 2;
    let best = NaN, bestScore = -Infinity;
    for (const c of cands) {
      if (c < lo || c > hi || Math.abs(c - ideal) > reach) continue;
      let s = -Math.abs(c - ideal) / reach;
      if (isBar(c)) s += 0.5;
      if (lineAt(c)) s += 0.9;
      if (inWord(c)) s -= 0.15;
      if (s > bestScore + 1e-9) { bestScore = s; best = c; }
    }
    if (!Number.isFinite(best)) {
      // no beat where the even lengths want a cut (a 20-second song at 113.6 a minute left its last window with none,
      // and the cut fell 0.19 s off the beat): the beat nearest the ideal that still leaves every picture a second
      // — ON the beat matters more than an even length — and the ideal itself only with no beat at all
      const want = clamp(ideal, lo, Math.max(lo, hi));
      best = want;
      let d = Infinity;
      for (const c of cands) if (c >= prev + 1 && c <= T - (n - k) && Math.abs(c - want) < d) { d = Math.abs(c - want); best = c; }
    }
    cuts.push(best);
    prev = best;
  }
  const bounds = [0, ...cuts, T];
  const sections: Section[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const t0 = bounds[i], t1 = bounds[i + 1];
    const text = joinUnits(words.filter((w) => w.t0 >= t0 - 0.1 && w.t0 < t1 - 0.1).map((w) => w.text));
    sections.push({ t0: r3(t0), t1: r3(t1), text });
  }
  // the shots: a stretch longer than four bars is cut again on its bars — the same picture, re-framed
  const maxShot = bar ? bar * 4 + 0.05 : 8.5;
  const step = bar ? bar * 3 : 6;
  const snapTo = (t: number, list: number[], within: number): number => {
    let best = t, d = within;
    for (const c of list) if (Math.abs(c - t) < d) { d = Math.abs(c - t); best = c; }
    return best;
  };
  const shots: Shot[] = [];
  sections.forEach((s, i) => {
    const len = s.t1 - s.t0;
    const m = len > maxShot ? Math.max(2, Math.round(len / step)) : 1;
    const inner: number[] = [];
    for (let j = 1; j < m; j++) {
      const want = s.t0 + (len * j) / m;
      let at = bar ? snapTo(want, g.bars, bar / 2 + 0.01) : want;
      if (at === want && g.steady) at = snapTo(want, g.beats, g.beat);
      if (at > s.t0 + 1.5 && at < s.t1 - 1.5 && (!inner.length || at > inner[inner.length - 1] + 1.5)) inner.push(at);
    }
    const marks = [s.t0, ...inner, s.t1];
    for (let j = 0; j + 1 < marks.length; j++) {
      shots.push({ t0: r3(marks[j]), t1: r3(marks[j + 1]), pic: i, move: j === 0 ? MOVES[[0, 1, 2, 3, 4][i % 5]] : reframe(j) });
    }
  });
  return { duration: r3(T), sections, shots, grid: { beats: g.beats.map(r3), bars: g.bars.map(r3), bpm: Math.round(g.bpm * 10) / 10 } };
}

/** Is this a plan that can be cut from (a checkpoint read back after a restart)? */
export function planOk(p: unknown): p is ScenePlan {
  const x = p as ScenePlan | null;
  return !!x && Array.isArray(x.sections) && x.sections.length > 0 && Array.isArray(x.shots) && x.shots.length > 0
    && x.shots.every((s) => Number.isFinite(s.t0) && s.t1 > s.t0 && Number.isInteger(s.pic) && s.pic >= 0 && s.pic < x.sections.length && !!s.move)
    && !!x.grid && Array.isArray(x.grid.beats) && Array.isArray(x.grid.bars) && Number.isFinite(x.duration);
}

/* ---------------------------------------------------------------------------------------------------------
 * 4. THE LOOK — one art direction, and every picture drawn in it
 * ------------------------------------------------------------------------------------------------------- */

export type ArtDirection = { style: string; palette: string[]; pictures: string[]; from: "writer" | "fallback" };

/** What each look asks of the pictures under it — the words have to read over them. */
const LOOK_ROOM: Record<LyricLook, string> = {
  bold: "The lyrics are huge words across the middle of the frame: keep the centre of every picture simple — the subject off-centre, open sky, a wall or a floor in the middle.",
  karaoke: "The lyrics run along the lower third: keep the bottom third of every picture calm and fairly dark.",
  neon: "The lyrics glow like neon signs: make the pictures dark and moody — night, low-key light, deep shadows.",
  minimal: "The lyrics are small and quiet: soft, airy pictures with plenty of empty space.",
};

/** A style and palette for each look, for when there is no writer (and the palette any writer's colours
 *  fall back to). The palette's last colour is the one the sung word lights up in. */
const LOOK_FALLBACK: Record<LyricLook, { style: string; palette: string[] }> = {
  bold: { style: "Bold, high-contrast cinematic photograph — saturated colour, dramatic directional light, deep shadows, a wide lens", palette: ["#101418", "#F4F1EA", "#FFD23F"] },
  karaoke: { style: "Warm cinematic film still — soft golden light, shallow depth of field, gentle film grain", palette: ["#1B1A2E", "#F6E7D2", "#FF7A59"] },
  // (lit by light, not by signs: "lit by neon" drew shop signs, with letters on them, into the first test's night)
  neon: { style: "Moody night photograph lit by coloured light — glowing tubes and lamps, wet reflections, deep blacks, a light haze", palette: ["#07070F", "#2B2D6E", "#3DF5FF"] },
  minimal: { style: "Minimal fine-art photograph — soft natural light, muted pastel tones, lots of empty space", palette: ["#EDE7DF", "#9AA5A0", "#FFE8A3"] },
};

/** The JSON the writer answers in (anthropic.server.ts → anthropicText's jsonSchema). */
export const DIRECTION_SCHEMA = {
  name: "lyric_video_direction",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["style", "palette", "pictures"],
    properties: {
      style: { type: "string" },
      palette: { type: "array", items: { type: "string" } },
      pictures: { type: "array", items: { type: "string" } },
    },
  },
} as const;

/** The writer's brief: the song's words stretch by stretch, the look's needs, the rules a picture keeps. */
export function directionBrief(o: { title: string; sections: string[]; look: LyricLook; shape: LyricShape }): string {
  const n = o.sections.length;
  const words = o.sections.map((s, i) => `${i + 1}. ${s.trim() ? s.trim().slice(0, 400) : "(no words here — music only)"}`).join("\n");
  return [
    `You are the art director of a LYRIC VIDEO: a song's words, big and animated, over a run of still pictures that cut on the beat — one picture for each stretch of the song.`,
    "",
    `The song${o.title ? `: "${o.title.slice(0, 80)}"` : ""}. Its words, stretch by stretch (${n} stretches):`,
    words,
    "",
    "Decide ONE look for the whole video, then one picture per stretch:",
    `- "style": one sentence naming the visual style every picture shares — the medium (photograph, film still, painting, illustration, 3D render, anime…), the era, the light, the lens and the colour grade. Pick what fits this song's mood and genre, and be specific and bold.`,
    `- "palette": exactly 3 colours as #RRGGBB, the video's colours. The LAST one is the colour each sung word lights up in: bright, saturated, readable over both dark and light pictures.`,
    `- "pictures": exactly ${n} descriptions, one per stretch and in order — each ONE striking image (a place, a moment, an object, a figure seen from afar or from behind) that carries what that stretch is about, literally or as a metaphor. One concrete, visual sentence each. Vary the framing from one picture to the next (wide, close, overhead, low) so the cuts feel alive, and let the pictures tell a loose story across the song.`,
    "",
    `Rules: no text, letters, numbers, signs, logos, posters or screens with writing anywhere in a picture — the lyrics are laid over them. No real, famous or recognisable people. Nothing explicit or gory. ${LOOK_ROOM[o.look]} The video is ${o.shape === "16:9" ? "wide (16:9)" : "tall (9:16)"}.`,
  ].join("\n");
}

const HEX = /^#?([0-9a-f]{6})$/i;
/** The writer's answer as a direction — or null when it is not one (no style, or fewer than half the pictures).
 *  Missing pictures are filled from the fallback; colours that are not colours are the look's own. */
export function parseDirection(raw: string, o: { sections: string[]; look: LyricLook }): ArtDirection | null {
  let j: { style?: unknown; palette?: unknown; pictures?: unknown } | null = null;
  try { j = JSON.parse(String(raw || "").replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return null; }
  if (!j || typeof j !== "object") return null;
  const clean = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/["“”]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "");
  const style = clean(j.style, 300);
  if (style.length < 10) return null;
  const n = o.sections.length;
  const pics = Array.isArray(j.pictures) ? j.pictures.map((p) => clean(p, 320)).filter((p) => p.length >= 8) : [];
  if (pics.length < Math.ceil(n / 2)) return null;
  const fb = fallbackDirection({ sections: o.sections, look: o.look });
  const pictures = Array.from({ length: n }, (_, i) => pics[i] || fb.pictures[i]);
  const given = Array.isArray(j.palette) ? j.palette.map((c) => (typeof c === "string" ? HEX.exec(c.trim()) : null)).filter((m): m is RegExpExecArray => !!m).map((m) => `#${m[1].toUpperCase()}`) : [];
  const palette = given.length >= 3 ? given.slice(0, 3) : [...given, ...fb.palette].slice(0, 3);
  return { style, palette, pictures, from: "writer" };
}

/** Words that carry no picture. */
const PLAIN = new Set(("a an the and or but nor so of to in on at for with from by as into onto over under than that this these those who which when while if because is are was were be been am do does did have has had will would can could should not no yes oh ooh ah yeah hey la na da uh mm i me my mine you your yours we us our they them their he him his she her it its im youre dont cant wont aint gonna wanna gotta just like get got all now then there here what where how why").split(" "));
/** The words of a stretch a picture can be made of: its longer words, most first, none twice. */
export function pictureWords(text: string, max = 5): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of String(text || "").toLowerCase().replace(/[’']/g, "").split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 3 || PLAIN.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out.sort((a, b) => b.length - a.length).slice(0, max);
}

/** The framings a fallback direction runs through, so no two pictures in a row are framed alike. */
const FRAMINGS = ["a wide establishing view", "a close, intimate detail", "seen from a low angle", "seen from high above", "a lone figure seen from behind, far away", "a single object, still and lit"];

/** A DIRECTION WITH NO WRITER: the look's own style and palette, and each picture made of its stretch's own
 *  words — never quoted (a quoted word is drawn as lettering), only named as what the picture evokes. */
export function fallbackDirection(o: { sections: string[]; look: LyricLook }): ArtDirection {
  const fb = LOOK_FALLBACK[o.look];
  const pictures = o.sections.map((s, i) => {
    const kw = pictureWords(s, 4);
    const framing = FRAMINGS[i % FRAMINGS.length];
    return kw.length ? `A scene that evokes ${kw.join(", ")} — ${framing}` : `An atmospheric image that sets the song's mood — ${framing}`;
  });
  return { style: fb.style, palette: fb.palette.slice(), pictures, from: "fallback" };
}

/** What each look's pictures are told about the words that will sit on them. */
const LOOK_FRAMING: Record<LyricLook, string> = {
  bold: "A strong, simple composition with a calm, uncluttered centre.",
  karaoke: "The bottom third of the frame calm and darker.",
  neon: "Dark and low-key, deep blacks.",
  minimal: "Soft and airy, plenty of quiet empty space.",
};
/** The picture model's prompt for picture `i` — or, for a picture the model refused: `plain`, the same without
 *  the stretch's own description; `abstract`, nothing but light and colour in the look's style (the first wide test
 *  had a plain prompt refused too: the model's filter flags some pictures whatever they were asked as). */
export function stillPrompt(d: ArtDirection, i: number, look: LyricLook, shape: LyricShape, plain: boolean | "abstract" = false): string {
  const pic = plain === "abstract" ? "An abstract composition of light, colour and texture, no figures"
    : plain ? `An atmospheric image that sets the song's mood — ${FRAMINGS[i % FRAMINGS.length]}`
    : d.pictures[i] || d.pictures[d.pictures.length - 1] || "";
  return `${d.style.replace(/[.\s]+$/, "")}. ${pic.replace(/[.\s]+$/, "")}. ${frameWords(shape)} ${LOOK_FRAMING[look]} Absolutely no text: no letters, words, numbers, captions, signs, logos or watermarks anywhere in the picture.`;
}

const hexRgb = (hex: string): [number, number, number] | null => {
  const m = HEX.exec(String(hex || "").trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const lin = (c: number): number => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]: [number, number, number]): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
/** THE COLOUR A SUNG WORD LIGHTS UP IN, as RRGGBB: the direction's accent, lifted toward white until it reads
 *  over a dark picture (a grey or a colour that is no colour falls back to the look's own). */
export function lyricAccent(d: ArtDirection, look: LyricLook): string {
  const own = (LOOK_FALLBACK[look].palette[2] || "#FFD23F").slice(1).toUpperCase();
  const rgb = hexRgb(d.palette[d.palette.length - 1] || "");
  if (!rgb) return own;
  const sat = Math.max(...rgb) - Math.min(...rgb);
  if (sat < 40 && look !== "minimal") return own;
  let c: [number, number, number] = rgb;
  for (let k = 0; k < 12 && lum(c) < 0.4; k++) c = c.map((x) => Math.round(x + (255 - x) * 0.18)) as [number, number, number];
  return c.map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/* ---------------------------------------------------------------------------------------------------------
 * 5. THE LYRICS — an .ass file, every word measured
 * ------------------------------------------------------------------------------------------------------- */

const assTime = (t: number): string => {
  const cs = Math.max(0, Math.round(t * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor((cs % 360000) / 6000)).padStart(2, "0")}:${String(Math.floor((cs % 6000) / 100)).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
/** RRGGBB → the renderer's colour, &HBBGGRR& */
const col = (rgb: string): string => `&H${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}&`;
const alpha = (a: number): string => `&H${Math.round(clamp(a, 0, 255)).toString(16).toUpperCase().padStart(2, "0")}&`;
/** Text as it may stand in the file: drawable() text has no braces or backslashes, but nothing is taken on trust. */
const esc = (t: string): string => t.replace(/[{}\\\r\n]/g, " ");
const px = (n: number): string => String(Math.round(n * 10) / 10);
const msOf = (s: number): number => Math.max(0, Math.round(s * 1000));
/** A mix of two RRGGBB colours, `k` of the second. */
const mixRgb = (a: string, b: string, k: number): string => {
  const A = hexRgb(a) || [255, 255, 255], B = hexRgb(b) || [255, 255, 255];
  return A.map((x, i) => Math.round(x + (B[i] - x) * k).toString(16).padStart(2, "0")).join("").toUpperCase();
};

/** The size a look's words are drawn at and its rules — in caps of the frame's short side (720 in both shapes),
 *  so a vertical and a wide video read the same on the same phone. */
type LookSpec = { maxCap: number; maxRows: number; maxPage: number; widthFrac: number; lead: number; hold: number };
function lookSpec(look: LyricLook, W: number, H: number): LookSpec {
  const wide = W > H;
  if (look === "bold") return { maxCap: 0.13, maxRows: wide ? 3 : 4, maxPage: wide ? 9 : 7, widthFrac: 0.88, lead: 0.12, hold: 1.1 };
  if (look === "neon") return { maxCap: 0.085, maxRows: wide ? 2 : 3, maxPage: wide ? 8 : 6, widthFrac: 0.8, lead: 0.15, hold: 1.1 };
  if (look === "karaoke") return { maxCap: 0.054, maxRows: 2, maxPage: 16, widthFrac: 0.9, lead: 0.6, hold: 1.2 };
  return { maxCap: 0.044, maxRows: 2, maxPage: 16, widthFrac: 0.84, lead: 0.3, hold: 1.4 };
}

/** The measuring of one face: em, cap and where a word anchored at its middle has its capitals. */
type Meter = {
  m: FontMetrics;
  /** the size (renderer's units) whose capitals are `capPx` tall */
  sizeForCap: (capPx: number) => number;
  em: (size: number) => number;
  cap: (size: number) => number;
  /** width of a text in pixels at a size, with `sp` pixels between letters */
  width: (text: string, size: number, sp?: number) => number;
  /** the \an5 anchor's y for capitals centred on `capY` */
  anchorY: (capY: number, size: number) => number;
};
function meter(m: FontMetrics): Meter {
  const em = (size: number) => size / m.box;
  return {
    m,
    em,
    sizeForCap: (capPx) => (capPx * m.box) / m.cap,
    cap: (size) => m.cap * em(size),
    width: (text, size, sp = 0) => textEms(m, text) * em(size) + sp * Array.from(text).length,
    // measured (scratchpad lyric/measure-an5): \an5 centres the win box (top above the baseline, bottom below),
    // so capitals sit (top - bottom - cap)/2 em above the anchor
    anchorY: (capY, size) => capY - ((m.top - m.bottom - m.cap) / 2) * em(size),
  };
}

/** Cut `n` words into rows of at most `maxIn` words and at most `maxRows` rows, at the cheapest cost — `cost(i,
 *  j)` is what a row of words i..j-1 costs. Returns the rows' [from, to) bounds. */
function cheapestRows(n: number, maxIn: number, maxRows: number, cost: (i: number, j: number) => number): Array<[number, number]> {
  const INF = Infinity;
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array(maxRows + 1).fill(INF));
  const from: number[][] = Array.from({ length: n + 1 }, () => new Array(maxRows + 1).fill(-1));
  best[0][0] = 0;
  for (let j = 1; j <= n; j++) for (let r = 1; r <= maxRows; r++) for (let i = Math.max(0, j - maxIn); i < j; i++) {
    if (best[i][r - 1] === INF) continue;
    const c = best[i][r - 1] + cost(i, j);
    if (c < best[j][r] - 1e-9) { best[j][r] = c; from[j][r] = i; }
  }
  let r = 1;
  for (let k = 1; k <= maxRows; k++) if (best[n][k] < best[n][r]) r = k;
  if (best[n][r] === INF) {
    // more words than the rows can hold (a caller's page was too long): rows of `maxIn`, the height check shrinks them
    const rows: Array<[number, number]> = [];
    for (let i = 0; i < n; i += maxIn) rows.push([i, Math.min(n, i + maxIn)]);
    return rows;
  }
  const rows: Array<[number, number]> = [];
  for (let j = n; j > 0 && r > 0; r--) { const i = from[j][r]; rows.unshift([i, j]); j = i; }
  return rows;
}

/** A line's words as pages a screen can hold: as few as fit `max` words each, cut where the singer pauses
 *  longest near the even point. */
export function pagesOf(words: LyricWord[], max: number): LyricWord[][] {
  const n = words.length;
  const parts = Math.max(1, Math.ceil(n / Math.max(1, max)));
  if (parts === 1) return [words];
  const out: LyricWord[][] = [];
  let from = 0;
  for (let p = 1; p < parts; p++) {
    const even = Math.round((n * p) / parts);
    let cut = even;
    let gap = -1;
    for (let c = Math.max(from + 1, even - 1); c <= Math.min(n - 1, even + 1); c++) {
      const g = words[c].t0 - words[c - 1].t1 + (/[,;.!?]$/.test(words[c - 1].text) ? 0.5 : 0);
      if (g > gap) { gap = g; cut = c; }
    }
    if (cut - from > max) cut = from + max;
    out.push(words.slice(from, cut));
    from = cut;
  }
  out.push(words.slice(from));
  return out.filter((p) => p.length);
}

/** When each line is on screen: from a little before its first word (`lead`) until a little after its last
 *  (`hold`) — never into the next line, never past the end. */
export function lineWindows(lines: LyricLine[], lead: number, hold: number, duration: number): Array<{ on: number; off: number }> {
  const on = lines.map((l, i) => Math.max(0, l.t0 - lead, i ? lines[i - 1].t0 + 0.05 : 0));
  return lines.map((l, i) => {
    const next = i + 1 < lines.length ? on[i + 1] : duration;
    const off = Math.min(next, duration, Math.max(l.t1 + hold, on[i] + 0.4));
    return { on: on[i], off: Math.max(off, Math.min(next, on[i] + 0.2)) };
  });
}

/** A word placed: its text, where its \an5 anchor is, its size. */
type Placed = { text: string; t0: number; t1: number; x: number; y: number; size: number };

/** A big word as it is drawn: without the comma or full stop it ends on — big words carry their own weight
 *  (narrated-core's Bold cards do the same); a question or a shout keeps its mark. */
export const bigWord = (t: string): string => t.replace(/[.,;:…]+$/u, "") || t;
/** The gap between two big upper-case words, in ems: the face's own space (about a quarter of an em in Poppins)
 *  reads as one word in capitals this size ("YOURSHADOW" on the first real render, 2026-11-24). */
export const BIG_GAP_EM = 0.36;

/** BOLD / NEON: a page's words as rows across the frame and each word's place in them, measured — so the
 *  words can come in one at a time and land exactly where the whole line will stand. `fill` = each row as wide
 *  as it can be (Bold: short rows big), else one size for every row (Neon). */
function placePage(o: { words: LyricWord[]; me: Meter; W: number; H: number; spec: LookSpec; fill: boolean; upper: boolean; sp: number; cy: number; gapEm: number }): Placed[] {
  const { me, W, H, spec } = o;
  const short = Math.min(W, H);
  // (the raw words decide where a row may break — a comma is a breath — and the words as SHOWN are measured)
  const raw = o.words.map((w) => w.text);
  const texts = raw.map((t) => bigWord(o.upper ? t.toUpperCase() : t));
  const n = texts.length;
  const wide = W > H;
  const unspaced = hasWide(raw.join(""));
  const maxW = W * spec.widthFrac;
  const maxS = me.sizeForCap(short * spec.maxCap);
  // the size a row would like to be: in a wide frame a bigger one, so a line stacks into two or three big rows
  // rather than running across in one small one ("LATE NIGHT CITY LIGHTS" in one row, the first wide test)
  const nice = me.sizeForCap(short * spec.maxCap * (o.fill ? (wide ? 0.8 : 0.62) : 0.85));
  const gapEm = unspaced ? 0 : o.gapEm;
  const chars = (t: string) => Array.from(t).length;
  // a row is (its words' advances + the gaps) × em + letter spacing — so the size at which it is exactly the width it
  // is given follows directly (letter spacing is in pixels, whatever the size)
  const rowSize = (i: number, j: number) => {
    let ems = gapEm * (j - i - 1), cs = 0;
    for (let k = i; k < j; k++) { ems += textEms(me.m, texts[k]); cs += chars(texts[k]); }
    return Math.min(maxS, (Math.max(maxW * 0.5, maxW - o.sp * cs) * me.m.box) / Math.max(0.5, ems));
  };
  const rows = cheapestRows(n, wide ? 4 : 3, spec.maxRows, (i, j) => {
    const S = rowSize(i, j);
    // a row smaller than it would like costs three times what a bigger one does: these are BIG words ("TAILLIGHTS
    // FADING INTO GOLD" ran across a wide frame in one small row, the first wide test, where two big rows read better)
    const r = Math.log(S / nice);
    let c = 0.15 + (r < 0 ? 3 : 1) * r * r;
    if (j - i === 1 && n > 1 && chars(texts[i]) <= 2) c += 1.2;
    if (j < n && LEAN.has(bare(raw[j - 1]))) c += 0.8;
    for (let k = i; k < j - 1; k++) if (/[,;]$/.test(raw[k])) c += 0.5;
    if (j < n && /[,;.!?]$/.test(raw[j - 1])) c -= 0.3;
    return c;
  });
  let sizes = rows.map(([i, j]) => rowSize(i, j));
  if (!o.fill) { const s = Math.min(...sizes); sizes = sizes.map(() => s); }
  else { const lo = Math.min(...sizes); sizes = sizes.map((s) => Math.min(s, lo * 2.1)); }
  // the whole block fits the height it is given, rows a third of a capital apart
  const caps = () => sizes.map((s) => me.cap(s));
  const blockH = () => { const c = caps(); return c.reduce((a, b) => a + b, 0) + c.slice(1).reduce((a, x, k) => a + 0.34 * ((x + c[k]) / 2), 0); };
  const room = H * (wide ? 0.62 : 0.56);
  if (blockH() > room) { const k = room / blockH(); sizes = sizes.map((s) => s * k); }
  const c = caps();
  let y = o.cy - blockH() / 2;
  const out: Placed[] = [];
  rows.forEach(([i, j], r) => {
    const S = sizes[r];
    const capY = y + c[r] / 2;
    const ay = me.anchorY(capY, S);
    const ws = texts.slice(i, j).map((t) => me.width(t, S, o.sp));
    const between = gapEm * me.em(S) + (gapEm ? o.sp : 0);
    const rowW = ws.reduce((a, b) => a + b, 0) + between * (j - i - 1);
    let x = (W - rowW) / 2;
    for (let k = i; k < j; k++) {
      const w = ws[k - i];
      out.push({ text: texts[k], t0: o.words[k].t0, t1: o.words[k].t1, x: x + w / 2, y: ay, size: S });
      x += w + between;
    }
    y += c[r] + (r + 1 < rows.length ? 0.34 * ((c[r] + c[r + 1]) / 2) : 0);
  });
  return out;
}

/** KARAOKE / MINIMAL: a line as one or two rows of one size (cut where the two come out most alike), the size
 *  the look asks for or smaller until the widest row fits — or null when even the smallest size will not hold
 *  it in two rows (the line is then shown in pages). */
function fitRows(texts: string[], me: Meter, maxW: number, size: number, minSize: number, sp: number): { rows: string[]; counts: number[]; size: number } | null {
  const line = joinUnits(texts);
  for (let S = size; S >= minSize - 1e-6; S *= 0.92) {
    if (me.width(line, S, sp) <= maxW) return { rows: [line], counts: [texts.length], size: S };
    let best: number | null = null, gap = Infinity;
    for (let k = 1; k < texts.length; k++) {
      const wa = me.width(joinUnits(texts.slice(0, k)), S, sp), wb = me.width(joinUnits(texts.slice(k)), S, sp);
      if (wa > maxW || wb > maxW) continue;
      const g = Math.abs(wa - wb) + (LEAN.has(bare(texts[k - 1])) ? me.em(S) * 2 : 0) - (/[,;.!?]$/.test(texts[k - 1]) ? me.em(S) : 0);
      if (g < gap) { gap = g; best = k; }
    }
    if (best !== null) return { rows: [joinUnits(texts.slice(0, best)), joinUnits(texts.slice(best))], counts: [best, texts.length - best], size: S };
  }
  return null;
}

export type AssInput = {
  look: LyricLook;
  lines: LyricLine[];
  W: number;
  H: number;
  /** the measurements of the face the lyrics are drawn in (font-metrics.ts → readFontMetrics), and its family name */
  metrics: FontMetrics;
  family: string;
  /** RRGGBB — the colour a sung word lights up in (lyricAccent) */
  accent: string;
  /** the beat (for the bars the words bump on) and the cuts (for the flash on a new picture) */
  bars: number[];
  cuts: number[];
  /** the song's name, shown over the opening when the singing starts late enough */
  title: string;
  duration: number;
};

/** THE LYRICS FILE. Four looks:
 *   BOLD     big upper-case words stacked across the middle, rows filling the frame (a short row is big),
 *            each word slamming in as it is sung — lit in the accent while it is sung — the rows thumping on
 *            every bar, a white flash on every new picture
 *   KARAOKE  the line, sentence case, low on the frame, up a moment before it is sung, each word filling
 *            with the accent as it is sung; the next line waits under it, dimmed
 *   NEON     upper-case words, one size, a coloured glow around a pale core, each flickering on as it is
 *            sung, the glow surging on every bar, the line tilted a little; a flash of the accent on a cut
 *   MINIMAL  the line, lower case, small and spaced, rising gently into place dimmed, each word coming up
 *            to full as it is sung
 *  Every word's box is measured with the face's own advance widths, so a row fills the frame and none runs
 *  off it. Returns "" when there is nothing to draw. */
export function lyricAss(o: AssInput): string {
  const { W, H, look } = o;
  const me = meter(o.metrics);
  const spec = lookSpec(look, W, H);
  const short = Math.min(W, H);
  const wide = W > H;
  const white = col("FFFFFF"), black = col("000000"), acc = col(o.accent);
  const head = [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${W}`, `PlayResY: ${H}`, "WrapStyle: 2", "ScaledBorderAndShadow: yes", "YCbCr Matrix: None", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: L,${o.family.replace(/[,\r\n]/g, " ")},60,${white},${white},${black},${black},0,0,0,0,100,100,0,0,1,3,0,5,0,0,0,1`, "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const ev: string[] = [];
  const add = (layer: number, a: number, b: number, tags: string, text: string) => {
    if (!(b - a > 0.02) || !text) return;
    ev.push(`Dialogue: ${layer},${assTime(a)},${assTime(b)},L,,0,0,0,,{${tags}}${text}`);
  };
  const upper = look === "bold" || look === "neon";
  // (a lyric line is not a sentence on a page: the comma or full stop it ends on is not drawn — in the big looks no
  //  word keeps one, bigWord)
  const lines = o.lines.filter((l) => l.words.length).map((l) => {
    const words = l.words.map((w, k) => (k === l.words.length - 1 ? { ...w, text: bigWord(w.text) } : w));
    return { ...l, words, text: joinUnits(words.map((w) => w.text)) };
  });
  const wins = lineWindows(lines, spec.lead, spec.hold, o.duration);

  // THE TITLE, over the opening, when the singing starts late enough to give it a moment
  const firstOn = wins.length ? wins[0].on : o.duration;
  const titleWords = drawable(o.title || "").split(" ").filter(Boolean).slice(0, 8);
  const titleOff = Math.min(firstOn - 0.2, 6);
  const titleOn = 0.1;
  const title: LyricLine | null = titleWords.length && titleOff - titleOn >= 1.4
    ? { text: titleWords.join(" "), t0: titleOn + 0.05, t1: titleOff, words: titleWords.map((t, k) => ({ text: t, t0: titleOn + 0.05 + k * 0.07, t1: titleOff })) }
    : null;

  // a flash on every new picture (the loud looks)
  if (look === "bold" || look === "neon") {
    const fill = look === "bold" ? white : acc;
    for (const c of o.cuts) {
      if (!(c > 0.3 && c < o.duration - 0.3)) continue;
      add(0, c, c + 0.22, `\\an7\\pos(0,0)\\p1\\bord0\\shad0\\1c${fill}\\1a${alpha(look === "bold" ? 0x9a : 0xa8)}\\t(0,200,\\1a&HFF&)`, `m 0 0 l ${W} 0 l ${W} ${H} l 0 ${H}{\\p0}`);
    }
  }

  // THE THUMP on every bar: the words stretch UP a little and settle. Only up — a word grown sideways about its
  // own middle closed the gap to the next one ("YOURSHADOW", the first real render), and the rows have room above
  // and below to spare.
  const thumpsIn = (a: number, b: number): string => o.bars
    .filter((t) => t > a + 0.2 && t < b - 0.15)
    .map((t) => { const s = msOf(t - a); return `\\t(${s},${s + 50},\\fscy112)\\t(${s + 50},${s + 260},\\fscy100)`; })
    .join("");

  if (look === "bold") {
    const cy = H * 0.5;
    const edge = W * 0.02;
    const draw = (words: LyricWord[], on: number, off: number, isTitle: boolean) => {
      const placed = placePage({ words, me, W, H, spec, fill: true, upper, sp: 0, cy, gapEm: BIG_GAP_EM });
      placed.forEach((p, k) => {
        const start = Math.max(on, p.t0 - 0.05);
        if (!(off - start > 0.05)) return;
        const b = Math.max(3, Math.round(p.size * 0.045)), sh = Math.max(2, Math.round(p.size * 0.03));
        const nextT = k + 1 < placed.length ? placed[k + 1].t0 : p.t1 + 0.25;
        const lit = clamp(msOf(nextT - start), 80, 60_000);
        const colour = isTitle ? `\\1c${white}` : `\\1c${acc}\\t(${lit},${lit + 120},\\1c${white})`;
        // the slam: the word lands from a quarter bigger, in 80 ms — never so big that it reaches past the frame (a
        // row is sized to fill the width, so its outer words have almost no room to grow): measured per word
        const half = me.width(p.text, p.size) / 2 + b;
        const room = Math.min((p.x - edge) / half, (W - edge - p.x) / half);
        const pop = Math.round(clamp(room, 1, 1.25) * 100);
        add(2, start, off,
          `\\an5\\pos(${px(p.x)},${px(p.y)})\\fs${px(p.size)}\\bord${b}\\shad${sh}\\3c${black}\\4c${black}${colour}\\fscx${pop}\\fscy${pop}\\alpha&HFF&\\t(0,80,\\fscx100\\fscy100\\alpha&H00&\\4a&H70&)${isTitle ? "" : thumpsIn(start, off)}\\fad(0,90)`,
          esc(p.text));
      });
    };
    if (title) draw(title.words, titleOn, titleOff, true);
    lines.forEach((l, i) => {
      const pages = pagesOf(l.words, spec.maxPage);
      pages.forEach((pg, k) => {
        const on = k === 0 ? wins[i].on : Math.max(wins[i].on, pg[0].t0 - spec.lead);
        const off = k + 1 < pages.length ? Math.max(on + 0.1, pages[k + 1][0].t0 - spec.lead) : wins[i].off;
        draw(pg, on, off, false);
      });
    });
  } else if (look === "neon") {
    const cy = H * 0.5;
    const sp = Math.round(me.em(me.sizeForCap(short * spec.maxCap)) * 0.04);
    const draw = (words: LyricWord[], on: number, off: number, tilt: number, glowBars: boolean) => {
      const placed = placePage({ words, me, W, H, spec, fill: false, upper, sp, cy, gapEm: BIG_GAP_EM });
      if (!placed.length) return;
      const xs = placed.map((p) => p.x), ys = placed.map((p) => p.y);
      const ox = (Math.min(...xs) + Math.max(...xs)) / 2, oy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const core = mixRgb(o.accent, "FFFFFF", 0.78);
      placed.forEach((p) => {
        const start = Math.max(on, p.t0 - 0.04);
        if (!(off - start > 0.05)) return;
        const g = Math.max(6, Math.round(p.size * 0.16));
        const where = `\\an5\\pos(${px(p.x)},${px(p.y)})\\org(${px(ox)},${px(oy)})\\frz${tilt}\\fs${px(p.size)}\\fsp${sp}`;
        // the glow: the letters' outline only, wide and soft, in the accent — flickering on, surging on the bar
        const surge = glowBars ? o.bars.filter((t) => t > start + 0.25 && t < off - 0.2).map((t) => { const s = msOf(t - start); return `\\t(${s},${s + 40},\\3a&H00&)\\t(${s + 40},${s + 320},\\3a&H48&)`; }).join("") : "";
        add(1, start, off, `${where}\\bord${g}\\blur${Math.round(g * 0.9)}\\shad0\\1a&HFF&\\3c${acc}\\3a&HFF&\\t(0,1,\\3a&H48&)\\t(45,46,\\3a&HD8&)\\t(95,96,\\3a&H48&)\\t(150,151,\\3a&HA0&)\\t(200,201,\\3a&H48&)${surge}\\fad(0,140)`, esc(p.text));
        // the tube: a pale core with a thin, slightly soft rim of the accent
        add(2, start, off, `${where}\\bord${Math.max(2, Math.round(p.size * 0.03))}\\blur2\\shad0\\1c${col(core)}\\3c${acc}\\alpha&HFF&\\t(0,1,\\alpha&H00&)\\t(45,46,\\alpha&HC0&)\\t(95,96,\\alpha&H00&)\\t(150,151,\\alpha&H70&)\\t(200,201,\\alpha&H00&)\\fad(0,140)`, esc(p.text));
      });
    };
    if (title) draw(title.words, titleOn, titleOff, 0, false);
    lines.forEach((l, i) => {
      const tilt = i % 2 ? 2.5 : -2.5;
      const pages = pagesOf(l.words, spec.maxPage);
      pages.forEach((pg, k) => {
        const on = k === 0 ? wins[i].on : Math.max(wins[i].on, pg[0].t0 - spec.lead);
        const off = k + 1 < pages.length ? Math.max(on + 0.1, pages[k + 1][0].t0 - spec.lead) : wins[i].off;
        draw(pg, on, off, tilt, true);
      });
    });
  } else if (look === "karaoke") {
    const baseY = H * (wide ? 0.72 : 0.76);
    const S0 = me.sizeForCap(short * spec.maxCap);
    const maxW = W * spec.widthFrac;
    const b = Math.max(3, Math.round(S0 * 0.05));
    // a page: one or two rows of words, timed for the fill (\kf, in hundredths, as the renderer counts them)
    type KPage = { words: LyricWord[]; counts: number[]; size: number; on: number; off: number };
    const kpages: KPage[] = [];
    lines.forEach((l, i) => {
      const fit = fitRows(l.words.map((w) => w.text), me, maxW, S0, S0 * 0.72, 0);
      const parts = fit ? [l.words] : pagesOf(l.words, Math.max(2, Math.ceil(l.words.length / 2)));
      parts.forEach((pw, k) => {
        const f = fit && parts.length === 1 ? fit : fitRows(pw.map((w) => w.text), me, maxW, S0, S0 * 0.6, 0) || { rows: [joinUnits(pw.map((w) => w.text))], counts: [pw.length], size: S0 * 0.6 };
        const on = k === 0 ? wins[i].on : Math.max(wins[i].on, pw[0].t0 - 0.25);
        const off = k + 1 < parts.length ? Math.max(on + 0.1, parts[k + 1][0].t0 - 0.25) : wins[i].off;
        kpages.push({ words: pw, counts: f.counts, size: f.size, on, off });
      });
    });
    const kText = (pg: KPage): string => {
      // which row each word is on
      const rowOf: number[] = [];
      pg.counts.forEach((c, r) => { for (let q = 0; q < c; q++) rowOf.push(r); });
      let out = "";
      let clock = Math.round(pg.on * 100);
      pg.words.forEach((w, k) => {
        const s = Math.round(w.t0 * 100);
        if (s > clock) { out += `{\\k${s - clock}}`; clock = s; }
        const next = k + 1 < pg.words.length ? pg.words[k + 1].t0 : w.t1 + 0.2;
        const e = Math.max(clock + 8, Math.round(Math.min(Math.max(w.t1, w.t0 + 0.12), next) * 100));
        const sep = k + 1 < pg.words.length ? (rowOf[k + 1] !== rowOf[k] ? "\\N" : hasWide(w.text) ? "" : " ") : "";
        out += `{\\kf${e - clock}}${esc(w.text)}${sep}`;
        clock = e;
      });
      return out;
    };
    if (title) add(2, titleOn, titleOff, `\\an2\\pos(${px(W / 2)},${px(baseY)})\\fs${px(S0 * 1.15)}\\bord${b}\\shad2\\1c${white}\\3c${black}\\4c${black}\\4a&H80&\\fad(250,250)`, esc(title.text));
    kpages.forEach((pg, k) => {
      add(2, pg.on, pg.off, `\\an2\\pos(${px(W / 2)},${px(baseY)})\\fs${px(pg.size)}\\bord${b}\\shad2\\1c${acc}\\2c${white}\\3c${black}\\4c${black}\\4a&H80&\\fad(140,120)`, kText(pg));
      // the next line, waiting under this one, dimmed — in the room left below it (a renderer line is as tall
      // as its size), on one row if two would run off the bottom, and left out if even one would
      const nx = kpages[k + 1];
      if (nx && nx.on - pg.off < 0.3) {
        const small = nx.size * 0.72;
        const top = baseY + me.em(S0) * 0.35;
        const below = H * 0.97 - top;
        const texts = nx.words.map((w) => w.text);
        let f = fitRows(texts, me, maxW, small, small * 0.7, 0);
        if (f && f.rows.length * f.size > below) f = fitRows(texts, me, maxW, Math.min(small, below), Math.min(small, below) * 0.6, 0);
        if (f && f.rows.length > 1 && f.rows.length * f.size > below) f = null;
        if (f && f.rows.length * f.size <= below) {
          add(1, pg.on, pg.off, `\\an8\\pos(${px(W / 2)},${px(top)})\\fs${px(f.size)}\\bord${Math.max(2, b - 1)}\\shad0\\1c${white}\\3c${black}\\alpha&H70&\\3a&HA0&\\fad(140,0)`, f.rows.map(esc).join("\\N"));
        }
      }
    });
  } else {
    // MINIMAL
    const cy = H * (wide ? 0.5 : 0.52);
    const S0 = me.sizeForCap(short * spec.maxCap);
    const sp = Math.round(me.em(S0) * 0.06);
    const maxW = W * spec.widthFrac;
    const draw = (words: LyricWord[], on: number, off: number, rise: boolean) => {
      const texts = words.map((w) => w.text.toLowerCase());
      const f = fitRows(texts, me, maxW, S0, S0 * 0.7, sp);
      if (!f) return false;
      // each word comes up from dim to full as it is sung (the fill only — the soft rim stays as it is)
      const rowsOfWords: string[] = [];
      let k = 0;
      f.counts.forEach((n, r) => {
        const part = words.slice(k, k + n).map((w, q) => {
          const s = msOf(Math.max(0, w.t0 - on));
          // (waiting at about 45%: at 30% the words still to come vanished over a busy picture)
          return `{\\1a&H8C&\\t(${s},${s + 220},\\1a&H00&)}${esc(texts[k + q])}`;
        });
        rowsOfWords.push(part.join(hasWide(f.rows[r]) ? "" : " "));
        k += n;
      });
      const y = cy;
      const move = rise ? `\\move(${px(W / 2)},${px(y + 16)},${px(W / 2)},${px(y)},0,380)` : `\\pos(${px(W / 2)},${px(y)})`;
      add(2, on, off, `\\an5${move}\\fs${px(f.size)}\\fsp${sp}\\bord2\\blur3\\shad0\\1c${white}\\3c${black}\\3a&HA0&\\fad(220,260)`, rowsOfWords.join("\\N"));
      return true;
    };
    if (title) draw(title.words.map((w) => ({ ...w, t0: titleOn })), titleOn, titleOff, true);
    lines.forEach((l, i) => {
      if (draw(l.words, wins[i].on, wins[i].off, true)) return;
      const pages = pagesOf(l.words, Math.max(2, Math.ceil(l.words.length / 2)));
      pages.forEach((pg, k) => {
        const on = k === 0 ? wins[i].on : Math.max(wins[i].on, pg[0].t0 - spec.lead);
        const off = k + 1 < pages.length ? Math.max(on + 0.1, pages[k + 1][0].t0 - spec.lead) : wins[i].off;
        draw(pg, on, off, k === 0);
      });
    });
  }
  return ev.length ? [...head, ...ev, ""].join("\n") : "";
}

/* ---------------------------------------------------------------------------------------------------------
 * 6. THE CUT — ffmpeg graphs (the encode itself: lyric-video.server.ts)
 * ------------------------------------------------------------------------------------------------------- */

/** How much a picture is nudged on the beat, by look: on a bar's first beat, and on every other beat. */
export const PULSE: Record<LyricLook, { bar: number; beat: number }> = {
  bold: { bar: 0.022, beat: 0.008 },
  neon: { bar: 0.016, beat: 0 },
  karaoke: { bar: 0.008, beat: 0 },
  minimal: { bar: 0, beat: 0 },
};

/** How many frames each shot is — rounded on the whole video's timeline, so they always add up to it. */
export function shotFrames(shots: Shot[], fps = LYRIC_FPS): number[] {
  return shots.map((s) => Math.max(1, Math.round(s.t1 * fps) - Math.round(s.t0 * fps)));
}

/** The beats inside a shot, as frames from its start, and how hard each one nudges. */
export function shotPulses(shot: Shot, frames: number, grid: { beats: number[]; bars: number[] }, look: LyricLook, fps = LYRIC_FPS): Array<{ f: number; amp: number }> {
  const p = PULSE[look];
  if (!p.bar && !p.beat) return [];
  const bars = new Set(grid.bars.map((b) => Math.round(b * 1000)));
  const f0 = Math.round(shot.t0 * fps);
  const out: Array<{ f: number; amp: number }> = [];
  for (const b of grid.beats) {
    const f = Math.round(b * fps) - f0;
    if (f < 2 || f > frames - 3) continue;
    const amp = bars.has(Math.round(b * 1000)) ? p.bar : p.beat;
    if (amp > 0) out.push({ f, amp });
  }
  return out;
}

export type CropBox = { w: number; h: number; x: number; y: number };

/** ONE PICTURE, MOVING: the still (with any baked-in black bars cropped off), scaled to twice the frame so the
 *  slow move is smooth, then zoompan from the shot's start framing to its end framing — and, in the loud looks,
 *  a quick push on the beat that falls away (a fifth of a second). Ends in [out]. */
export function motionFilter(o: { input: string; out: string; frames: number; W: number; H: number; move: Move; pulses?: Array<{ f: number; amp: number }>; crop?: CropBox | null; fps?: number; over?: number }): string {
  const ow = Math.round(o.W * (o.over || 2)), oh = Math.round(o.H * (o.over || 2));
  const n = Math.max(2, o.frames);
  const d = n - 1;
  const m = o.move;
  const num = (x: number) => String(Math.round(x * 10000) / 10000);
  const lerp = (a: number, b: number) => (Math.abs(b - a) < 1e-9 ? num(a) : `(${num(a)}+${num(b - a)}*on/${d})`);
  const kicks = (o.pulses || []).slice(0, 80).map((p) => `+${num(p.amp)}*gte(on,${p.f})*exp((${p.f}-on)/4.5)`).join("");
  const z = `max(1.0005,${lerp(m.z0, m.z1)}${kicks})`;
  const x = `(iw-iw/zoom)*(0.5+0.5*${lerp(m.x0, m.x1)})`;
  const y = `(ih-ih/zoom)*(0.5+0.5*${lerp(m.y0, m.y1)})`;
  const crop = o.crop ? `crop=${o.crop.w}:${o.crop.h}:${o.crop.x}:${o.crop.y},` : "";
  // (the picture is turned into the video's own colour format ONCE, before the move — done after it, the same
  //  conversion ran on every frame: measured, a third of the encode)
  return `${o.input}${crop}scale=${ow}:${oh}:force_original_aspect_ratio=increase:out_range=tv,crop=${ow}:${oh},format=yuv420p,zoompan=z='${z}':x='${x}':y='${y}':d=${n}:s=${o.W}x${o.H}:fps=${o.fps || LYRIC_FPS},setsar=1${o.out}`;
}

/** The encode in pieces — whole shots, about `maxFrames` each — so no single encode runs long (the app's encodes
 *  are killed at ten minutes) and a piece's cut always falls on a cut of the video. */
export function renderChunks(frames: number[], maxFrames = 45 * LYRIC_FPS): Array<{ from: number; to: number; frame0: number; frames: number }> {
  const out: Array<{ from: number; to: number; frame0: number; frames: number }> = [];
  let from = 0, frame0 = 0;
  while (from < frames.length) {
    let to = from, sum = frames[from];
    while (to + 1 < frames.length && sum + frames[to + 1] <= maxFrames) { to++; sum += frames[to]; }
    out.push({ from, to, frame0, frames: sum });
    frame0 += sum;
    from = to + 1;
  }
  return out;
}

/** The shading under the words, by look, as the alpha (0-255) of a black sheet, for ffmpeg's geq — drawn ONCE
 *  as a picture and laid over every frame (one geq over a whole video would be far too slow). */
export function scrimAlpha(look: LyricLook): string {
  const r2 = "(pow((X-W/2)/(W/2),2)+pow((Y-H/2)/(H/2),2))";
  const band = (w: number) => `exp(-pow((Y-H/2)/(${w}*H),2))`;
  if (look === "neon") return `255*min(0.72,0.30+0.18*${r2})`;
  if (look === "karaoke") return `255*min(0.78,0.08+0.10*${r2}+0.58*pow(max(0,(Y-0.42*H)/(0.58*H)),1.3))`;
  if (look === "minimal") return `255*min(0.55,0.10+0.10*${r2}+0.16*${band(0.2)})`;
  return `255*min(0.62,0.14+0.16*${r2}+0.12*${band(0.26)})`;
}

/** THE GRAPH FOR ONE PIECE OF THE VIDEO: inputs 0…k-1 are the pieces' shots' pictures (one input per shot),
 *  input k the shading picture — ONE frame, held for the whole piece (a looped picture is read and converted
 *  again on every frame: measured, that was nearly half the encode). The shots move and are joined, shaded,
 *  then the lyrics are drawn — at the piece's place in the whole video (its timestamps are moved there for the
 *  subtitle renderer and back) — and the last piece fades out. Ends in [v]. `assFilter` is the renderer's
 *  filter, path already escaped. */
export function chunkGraph(o: {
  shots: Shot[]; frames: number[]; crops: Array<CropBox | null>; pulses: Array<Array<{ f: number; amp: number }>>;
  W: number; H: number; frame0: number; assFilter: string | null; fadeOut?: { at: number; d: number } | null; fps?: number; over?: number;
}): string {
  const fps = o.fps || LYRIC_FPS;
  const k = o.shots.length;
  const parts: string[] = [];
  o.shots.forEach((s, i) => parts.push(motionFilter({ input: `[${i}:v]`, out: `[s${i}]`, frames: o.frames[i], W: o.W, H: o.H, move: s.move, pulses: o.pulses[i], crop: o.crops[i], fps, over: o.over })));
  parts.push(`${o.shots.map((_, i) => `[s${i}]`).join("")}concat=n=${k}:v=1:a=0[cat]`);
  // (laid over in the video's own format: left to choose, the overlay converted every frame — 11 s of a 30-second
  //  video against 2 s like this)
  parts.push(`[${k}:v]scale=${o.W}:${o.H},format=yuva420p[scrim]`);
  parts.push(`[cat][scrim]overlay=0:0:eof_action=repeat:format=yuv420[shaded]`);
  const tail: string[] = [];
  // (the shift is said in seconds over the stream's own time base, so it is right whatever that base is)
  if (o.assFilter) tail.push(`setpts=PTS+${o.frame0}/(${fps}*TB)`, o.assFilter, "setpts=PTS-STARTPTS");
  if (o.fadeOut) tail.push(`fade=t=out:st=${o.fadeOut.at.toFixed(3)}:d=${o.fadeOut.d.toFixed(3)}`);
  tail.push("format=yuv420p");
  parts.push(`[shaded]${tail.join(",")}[v]`);
  return parts.join(";\n");
}
