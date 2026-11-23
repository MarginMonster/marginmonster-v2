/* A NARRATED story, the parts that are plain logic (no network, no disk) so the tests can hold them.
 *
 * The owner, 2026-11-17: "We also need to add routes for your stereotypical ai narrated story models
 * (cheaper and popular) either by toggle or by new cards and routes" — and, the same morning,
 * "Subtitle options / like captions need added".
 *
 * A narrated story is one voice telling a tale over a run of pictures: the narration is recorded first,
 * every picture is on screen for exactly as long as its part of the story takes to say, and the words can
 * ride along as captions. This file answers the three questions that makes:
 *
 *   WHEN does each picture show?   sceneWindows()  — from the narration's real word timings
 *   WHAT do the captions say, and when?   boldCards() / subtitleCards()
 *   HOW are they drawn?   captionFilters()  — ffmpeg drawtext, sized to the frame
 *
 * Captions are also used by the acted films (film-dialogue), which is why the styles live here. */

/** `last` marks the final word of a scene (set by scriptWordTimes): a caption card never runs past it. */
/** (`score` is the listener's own word for how sure it is of a HEARD word, 0 to 1 — see sureWords.) */
export type WordT = { word: string; start: number; end: number; last?: boolean; score?: number };
export type Window = { t0: number; t1: number };
/** `words` = the card's own words, each with the time it is said and its piece of the card's text (the
 *  pieces join back into `text`). boldCards() sets them; the highlight style lights each one in turn. */
export type Card = { text: string; t0: number; t1: number; words?: Array<{ text: string; t0: number; t1: number }> };

/** How the words are put on screen.
 *   off        nothing
 *   bold       big upper-case words, a few at a time, in step with the voice (the social look)
 *   highlight  the same big words — and the one being said is lit, word by word (what every short-video
 *              tool leads with; drawn by the subtitle renderer, see highlightAss)
 *   subtitles  a clean line or two of sentence-case text at the bottom (the film look) */
export type CaptionStyle = "off" | "bold" | "highlight" | "subtitles";
export const CAPTION_STYLES: Array<{ key: CaptionStyle; label: string; blurb: string }> = [
  { key: "bold", label: "Bold", blurb: "Big words that pop in time with the voice" },
  { key: "highlight", label: "Highlight", blurb: "Big words — the one being said lights up" },
  { key: "subtitles", label: "Subtitles", blurb: "A clean line along the bottom, like a film" },
  { key: "off", label: "Off", blurb: "No words on screen" },
];
export const captionStyleOf = (v: unknown, fallback: CaptionStyle = "off"): CaptionStyle => (v === "off" || v === "bold" || v === "highlight" || v === "subtitles" ? v : fallback);

const countWords = (s: string): number => (s.trim().match(/\S+/g) || []).length;

/* ---- scripts written without spaces (Chinese, Japanese) ----
 * The first Chinese story (2026-11-23, a re-telling) showed what counting spaces does to one: a whole
 * scene is "one word", so every scene got the same share of the narration whatever it had to say, and
 * each scene's caption was a single line of forty glyphs running off both sides of the frame. Here a
 * line is cut into the words a dictionary finds in it, a glyph is measured as wide as it is drawn, and
 * the said length of a line is its glyphs. For every other script nothing below changes. */
const WIDE = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;
const WIDE_ALL = new RegExp(WIDE.source, "g");
const AFTER_WIDE = new RegExp(`(?<=${WIDE.source})`).source;
/** Is any of this text in a script written without spaces — square glyphs, each about 1.7 letters wide? */
export const hasWide = (s: string): boolean => WIDE.test(s);
/** How wide a text draws, in Latin letters (what every line budget here is counted in). */
export function textWidth(s: string): number {
  let n = 0;
  for (const ch of s) n += WIDE.test(ch) ? 1.7 : 1;
  return n;
}
/** How long a unit takes to say, next to its neighbours: a word is one, a Chinese word is its glyphs. */
export const unitWeight = (u: string): number => Math.max(1, (u.match(WIDE_ALL) || []).length);

type WordSegmenter = { segment(s: string): Iterable<{ segment: string }> };
let segmenter: WordSegmenter | null | undefined;
/** A run of glyphs as the words a dictionary finds in it (glyph by glyph where there is no dictionary). */
function wordPieces(run: string): string[] {
  if (segmenter === undefined) {
    const Seg = (Intl as unknown as { Segmenter?: new (locale: string, o: { granularity: "word" }) => WordSegmenter }).Segmenter;
    try { segmenter = Seg ? new Seg("zh", { granularity: "word" }) : null; } catch { segmenter = null; }
  }
  return segmenter ? Array.from(segmenter.segment(run), (x) => x.segment) : Array.from(run);
}

/** A line as the units a voice says one after another, each as it will be drawn (see drawable): its
 *  words — and, in a script without spaces, the words found in each run of glyphs, so that a caption is
 *  never cut inside one. A mark stays on the unit before it: there, the marks are the only pauses. */
export function saidUnits(line: string): string[] {
  // (a colon, a semicolon or a dash between words is a pause, and cannot be drawn — the first two
  //  separate a filter's options: a comma stands for it, where it used to vanish and run "she heard
  //  it: a slow bell" together)
  if (!WIDE.test(line)) return drawable(line.replace(/[:;](?=\s|$)/g, ",").replace(/(?<=[\p{L}\p{N}])\s+[—–]+\s+/gu, ", ")).split(" ").filter(Boolean);
  // the full-width marks as the plain ones drawable() keeps; a dash between glyphs is a pause too
  const plain = line
    .replace(/[，、；：]/g, ",").replace(/[。．]/g, ".").replace(/！/g, "!").replace(/？/g, "?")
    .replace(new RegExp(`${AFTER_WIDE}\\s*[—–]+\\s*`, "g"), ", ")
    .replace(new RegExp(`${AFTER_WIDE}[;:]`, "g"), ",");
  const out: string[] = [];
  for (const run of drawable(plain).split(" ").filter(Boolean)) {
    if (!WIDE.test(run)) { out.push(run); continue; }
    let lead = "";
    for (const piece of wordPieces(run)) {
      if (/[\p{L}\p{N}]/u.test(piece)) { out.push(lead + piece); lead = ""; }
      else if (out.length) out[out.length - 1] += piece;
      else lead += piece;
    }
  }
  return out;
}

/** Units back into a line of text. Nothing goes between two glyphs of a script without spaces — and,
 *  the way Chinese subtitles are set, the comma or full stop after a glyph is not drawn: the space (or
 *  the end of the line) says it. Any other text is its words with a space between. */
export function joinUnits(units: string[]): string {
  let out = "";
  for (const u of units) {
    if (!u) continue;
    out += (!out || (WIDE.test(out[out.length - 1]) && WIDE.test(u[0])) ? "" : " ") + u;
  }
  return WIDE.test(out) ? out.replace(new RegExp(`${AFTER_WIDE}[.,]+(?= |$)`, "g"), "").trim() : out;
}

/* Where a Chinese line is better not cut. A word that leans on what FOLLOWS it (一 在 和 把 …) should not
 * end a card, and a particle that leans on what came BEFORE (的 了 着 过 …) should not start one: the
 * first real render had "人们都说这座老剧院一 / 到午夜就从未真正空过" and "GUS 和 ISLA 在 / 这里打扫多年",
 * which read as stumbles; "…老剧院 / 一到午夜…" and "GUS 和 ISLA / 在这里…" do not. This is not grammar —
 * only the commonest function words, each worth about two glyphs of unevenness. A word with a mark on
 * it is a pause, and a pause is always a fine place to cut. No effect on a script with spaces. */
const LEANS_FORWARD = new Set(Array.from("一在和与及就也都还又才把被对从向往为给跟比让使而但却那这每很太最更不没别是有将要"));
const LEANS_BACK = new Set(Array.from("的了着过吗呢吧啊们里上下中内外后前时地得般"));
/** What it costs, in letters of unevenness, to cut a line between these two units. */
export const cutCost = (prev: string, next: string): number =>
  (LEANS_FORWARD.has(prev) ? 3.4 : 0) + (LEANS_BACK.has(next.replace(/[.,!?…]+$/u, "")) ? 3.4 : 0);

/** What a scene has to say, as a length: its words — or, in a script without spaces, its glyphs. */
const saidLength = (line: string): number => (WIDE.test(line) ? saidUnits(line).reduce((n, u) => n + unitWeight(u), 0) : countWords(line));

/** No picture is up for less than this, however little its scene has to say. */
export const MIN_SCENE_S = 1.2;

/* ---- the script, laid over what was heard ----
 * The listener's words used to be matched to the script by COUNT alone: scene k started at the heard
 * word the same fraction of the way through, and inside a scene the j-th written word took the j-th
 * heard word's time. That holds while the listener hears every word. On 2026-11-23 a story told in a
 * performed character voice had its whole first sentence missed — ten words of 147 — and every caption
 * in the story came up late (1.9 s on average, 4.2 s at worst; every picture changed late too): ten
 * missing words move every count after them.
 *
 * So the SAME WORDS are found first. Where a written word and a heard word are the same word, in order
 * (the longest such chain), the written word is said exactly when that heard word is. The words in
 * between — a number read out, a name heard wrong, a sentence the listener missed — are laid between
 * the anchors on either side of them. Only when too few words are the same (a different text, a garbled
 * listen) is anything counted into place as before. */
/** How long an unheard word is given when nothing says otherwise: an ordinary speaking pace. */
export const SAY_PACE = 0.42;
/** A word as it is compared: its letters and digits alone, lower-case, accents folded. */
const atomOf = (w: string): string => w.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");
/** What is compared for one unit: the word itself — or, in a script without spaces, each of its glyphs
 *  (the listener hears such a script glyph by glyph). */
function unitAtoms(u: string): string[] {
  if (!WIDE.test(u)) return [atomOf(u)];
  const glyphs = u.match(WIDE_ALL);
  return glyphs && glyphs.length ? glyphs : [atomOf(u)];
}
/** The longest chain of pairs (written, heard) that are the same word, both in order. */
function sameWords(written: string[], heard: string[]): Array<[number, number]> {
  const M = written.length, H = heard.length;
  if (!M || !H || M * H > 4_000_000) return [];
  const d = new Uint16Array((M + 1) * (H + 1));
  const at = (i: number, j: number) => i * (H + 1) + j;
  for (let i = 1; i <= M; i++) for (let j = 1; j <= H; j++) {
    d[at(i, j)] = written[i - 1] && written[i - 1] === heard[j - 1] ? d[at(i - 1, j - 1)] + 1 : Math.max(d[at(i - 1, j)], d[at(i, j - 1)]);
  }
  const pairs: Array<[number, number]> = [];
  let i = M, j = H;
  while (i > 0 && j > 0) {
    if (written[i - 1] && written[i - 1] === heard[j - 1] && d[at(i, j)] === d[at(i - 1, j - 1)] + 1) { pairs.unshift([i - 1, j - 1]); i--; j--; }
    else if (d[at(i - 1, j)] >= d[at(i, j - 1)]) i--;
    else j--;
  }
  return pairs;
}
/** Enough of the words are the same for them to be anchors: at least half of whichever is fewer — the
 *  written words or the heard ones — and never fewer than `min`. (Half of the WRITTEN words would turn
 *  away the very case this is for: a listener that missed most of a scene and heard the rest exactly.) */
const anchored = (pairs: number, atoms: string[], heard: number, min: number): boolean =>
  pairs >= Math.max(min, Math.min(atoms.filter(Boolean).length, heard) * 0.5);

/* ---- where the voice is sounding ----
 * The words the listener did NOT hear still have to go somewhere. Laid "on from the last heard word at an
 * ordinary pace", a story's last line came up 1.7 seconds before it was spoken (2026-11-23, "The Keeper's
 * Tide", told in the Ghost voice): "…breathed against her ear:" — a long pause — and then, whispered,
 * "welcome home, daughter". The listener does not hear a whisper; the caption gave the ending away in
 * the pause and was gone before the whisper came.
 *
 * The voice track itself says where those words are: it is SOUNDING there, and quiet in the pause.
 * (The track is the narrator alone — the music is mixed in later — so sound is voice.) Unheard words are
 * laid over the stretches of their gap that have sound in them, and never across a pause.
 *
 * "Sound" is the track's LEVEL, frame by frame, against how loud this voice itself is — not ffmpeg's
 * silence detector, which goes by single samples: a performed voice rings on after a word (the Ghost
 * speaks "from another room"), and measured on a real take that echo kept every pause but one "not
 * silent". The level tells them apart: a whisper sits 5 to 15 dB under the voice's loud level, the echo
 * dying away 20 and more. Two readings are handed on — the CLEAR voice (within CLEAR_VOICE_DB of the
 * loud level) is tried first; if it cannot hold the words, anything within ANY_SOUND_DB; and if neither
 * can, the older rule. */
export type Span = [number, number];

/** How far under this voice's loud level the clear voice still is (a whisper is; an echo is not)… */
export const CLEAR_VOICE_DB = 15;
/** …and how far under it anything at all still counts as sound. */
export const ANY_SOUND_DB = 30;
/** A quiet shorter than this is the space between two words, not a pause. */
export const PAUSE_MIN_S = 0.3;
/** The least time a spoken word takes: less sound than this for each unheard word cannot be those words. */
export const MIN_SAY = 0.2;

/** The level of each short frame of a track, out of ffmpeg's print-out (
 *  `astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level`): when the frame
 *  starts, and its level in dB (a frame of pure silence reads -inf, kept as -Infinity). */
export function levelFrames(printout: string): Array<{ t: number; db: number }> {
  const out: Array<{ t: number; db: number }> = [];
  let t: number | null = null;
  for (const line of (printout || "").split(/\r?\n/)) {
    const at = /pts_time:\s*(-?[\d.]+)/.exec(line);
    if (at) { t = Number(at[1]); continue; }
    const lv = /RMS_level=\s*(-?inf|-?[\d.]+)/i.exec(line);
    if (lv && t !== null && Number.isFinite(t)) {
      const db = /inf/i.test(lv[1]) ? -Infinity : Number(lv[1]);
      if (!Number.isNaN(db)) out.push({ t, db });
      t = null;
    }
  }
  return out;
}

/** Where the track is sounding: the stretches whose level is within `under` dB of the voice's loud level
 *  (the level its loudest tenth of frames reaches). A quiet shorter than PAUSE_MIN_S does not split a
 *  stretch; a blip shorter than 0.08 s is not one. */
export function soundSpans(frames: Array<{ t: number; db: number }>, total: number, under: number): Span[] {
  const real = frames.filter((f) => Number.isFinite(f.db)).map((f) => f.db).sort((a, b) => a - b);
  if (!real.length || !(total > 0)) return [];
  const loud = real[Math.min(real.length - 1, Math.floor(real.length * 0.9))];
  const floor = loud - under;
  // how long one frame lasts: the commonest step between two of them
  const steps = frames.slice(1).map((f, i) => f.t - frames[i].t).filter((d) => d > 0).sort((a, b) => a - b);
  const step = steps.length ? steps[Math.floor(steps.length / 2)] : 0.05;
  const spans: Span[] = [];
  for (const f of frames) {
    if (!(f.db >= floor)) continue;
    const a = Math.max(0, f.t), b = Math.min(total, f.t + step);
    const last = spans[spans.length - 1];
    if (last && a - last[1] < PAUSE_MIN_S) last[1] = Math.max(last[1], b);
    else spans.push([a, b]);
  }
  return spans.filter(([a, b]) => b - a >= 0.08);
}

/** Both readings of a track, the clear voice first — what scriptWordTimes takes as `speech`. */
export function soundLevels(frames: Array<{ t: number; db: number }>, total: number): Span[][] {
  // always in this order — the clear voice is [0] even when it found nothing (stillBeingSaid reads [0])
  const clear = soundSpans(frames, total, CLEAR_VOICE_DB), any = soundSpans(frames, total, ANY_SOUND_DB);
  return clear.length || any.length ? [clear, any] : [];
}
/** The stretches of the gap [g0, g1] that have the voice in them, for `run` unheard words — or null when
 *  they cannot hold that many words (MIN_SAY each).
 *  Sound right against a heard word, with quiet between it and the rest, is that word ringing on (or the
 *  next heard word drawing breath): the unheard words are in the rest — when the rest can hold them. What
 *  a listener misses is a quiet PHRASE, set apart by a pause; a word in the same breath as one it heard,
 *  it hears. */
function voicedIn(speech: Span[], g0: number, g1: number, run: number, leftHeard: boolean, rightHeard: boolean): Span[] | null {
  if (!(g1 - g0 > 0.05)) return null;
  let ps = speech.map(([s, e]): Span => [Math.max(s, g0), Math.min(e, g1)]).filter(([s, e]) => e - s >= 0.05);
  const holds = (list: Span[]) => list.reduce((sum, [s, e]) => sum + (e - s), 0) >= run * MIN_SAY;
  if (ps.length > 1 && leftHeard && ps[0][0] - g0 < 0.03 && holds(ps.slice(1))) ps = ps.slice(1);
  if (ps.length > 1 && rightHeard && g1 - ps[ps.length - 1][1] < 0.03 && holds(ps.slice(0, -1))) ps = ps.slice(0, -1);
  return ps.length && holds(ps) ? ps : null;
}

/** `pieces` with every stretch of `cut` taken out of them (a sliver under 0.05 s that is left is dropped). */
function without(pieces: Span[], cut: Span[]): Span[] {
  let out = pieces;
  for (const [c0, c1] of cut) {
    const next: Span[] = [];
    for (const [s, e] of out) {
      if (c1 <= s || c0 >= e) { next.push([s, e]); continue; }
      if (c0 - s >= 0.05) next.push([s, c0]);
      if (e - c1 >= 0.05) next.push([c1, e]);
    }
    out = next;
  }
  return out;
}

/** `run` words shared out over the stretches by how long each is, in WHOLE words — so no word is drawn
 *  across a silence — and spread evenly inside each. Returns each word's start and end, in order. */
export function layOver(pieces: Span[], run: number): Array<{ s: number; e: number }> {
  const voiced = pieces.reduce((sum, [s, e]) => sum + (e - s), 0);
  const out: Array<{ s: number; e: number }> = [];
  if (!(voiced > 0) || run <= 0) return out;
  const ideal = pieces.map(([s, e]) => (run * (e - s)) / voiced);
  const given = ideal.map((x) => Math.floor(x + 1e-9));
  let left = run - given.reduce((a, b) => a + b, 0);
  // what is left over goes to the stretches the rounding cut shortest (the earlier, on a tie)
  const order = ideal.map((x, k) => ({ k, frac: x - given[k] })).sort((a, b) => b.frac - a.frac || a.k - b.k);
  for (let n = 0; left > 0 && order.length; n++, left--) given[order[n % order.length].k]++;
  pieces.forEach(([s, e], k) => {
    const per = given[k] ? (e - s) / given[k] : 0;
    for (let q = 0; q < given[k]; q++) out.push({ s: s + q * per, e: s + (q + 1) * per });
  });
  return out;
}

/** How much of the script the listener heard as itself: 1 = every word, 0 = none of them. */
export function heardShare(lines: string[], words: WordT[]): number {
  const atoms: string[] = [];
  for (const l of lines) for (const u of saidUnits(l)) atoms.push(...unitAtoms(u));
  const real = atoms.filter(Boolean).length;
  if (!real || !words.length) return 0;
  return sameWords(atoms, words.map((w) => atomOf(w.word))).length / real;
}
/** A first listen that heard less of the script than this is worth a second, softer one. (A performed
 *  character voice's quiet opening sentence was not taken for speech at all on 2026-11-23 — 137 words of
 *  147; the same recording heard with the voice detector set softer gave all 147.) */
export const LISTEN_AGAIN_UNDER = 0.97;

/* ---- words the listener was not sure of ----
 * The listener gives every word a time AND says how sure it is of it. On 2026-11-23 a story told in the
 * Ghost voice had one line — "yet still they came" — drawn in the pause BEFORE it was spoken (four words
 * in 0.7 s, straight after "door,") and nothing on screen while it was said: the listener had fitted the
 * words into the swell that leads that voice in, and left the line itself without a word. The same film
 * listened to again came out right every time — nothing could be seen of it afterwards.
 *
 * What a listener does with words it has fitted where they are not: it scores them near nothing. Measured
 * that day over 2,041 words of 19 real listens (six voices; clean tracks and finished films): 44 words
 * scored under 0.2 — "a", "the", "and", a name spelt another way — and EVERY one of them stood alone
 * between two words the listener was sure of; not once were two such words side by side. So one unsure
 * word is where it says it is (its neighbours hold it there), and two or more in a row are not believed:
 * they are taken out of what was heard, and the script's words for them are placed like any others nobody
 * heard — where the voice is sounding, and first of all anywhere but where the listener squeezed them. */
/** A heard word the listener itself scored under this… */
export const DOUBT_SCORE = 0.2;
/** …with this many of them in a row, is not believed. */
export const DOUBT_RUN = 2;
/** …unless the listener is unsure of most of what it heard — the MIDDLE score of the whole listen is
 *  under this: then its scores tell nothing apart in this voice, and every word is taken at its word as
 *  it always was. (Measured the same day, the middle score of whole listens: 0.69–0.73 in the Ghost's
 *  English, 0.76–0.82 in Spanish, French and German, 0.95 in Chinese, 0.52–0.65 for sung lyrics; a
 *  Spanish voice listened to as English — the one listen on hand with runs — 0.57.) */
export const DOUBT_OFF_MIDDLE = 0.4;

/** The listener's answer as words: each with its time and — when the listener said — how sure it was. */
export function listenedWords(raw: unknown): WordT[] {
  const r = raw as { segments?: Array<{ words?: Array<{ word?: unknown; start?: unknown; end?: unknown; score?: unknown }> }> } | null;
  const out: WordT[] = [];
  for (const seg of r?.segments || []) {
    for (const w of seg?.words || []) {
      if (typeof w.word === "string" && typeof w.start === "number" && typeof w.end === "number" && w.end > w.start) {
        out.push({ word: w.word, start: w.start, end: w.end, ...(typeof w.score === "number" && Number.isFinite(w.score) ? { score: w.score } : {}) });
      }
    }
  }
  return out;
}

/** What was heard, without the words the listener was not sure of (DOUBT_RUN or more in a row, each
 *  under DOUBT_SCORE): `sure` is what is left, `squeezed` is where each such run had been put, `doubted`
 *  how many words that was. A word with no score is taken at its word. */
export function sureWords(words: WordT[]): { sure: WordT[]; squeezed: Span[]; doubted: number } {
  const sure: WordT[] = [], squeezed: Span[] = [];
  let doubted = 0;
  const unsure = (w: WordT) => typeof w.score === "number" && w.score < DOUBT_SCORE;
  const scores = words.map((w) => w.score).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  if (scores.length && scores[Math.floor(scores.length / 2)] < DOUBT_OFF_MIDDLE) return { sure: words, squeezed: [], doubted: 0 };
  for (let i = 0; i < words.length; ) {
    let j = i;
    while (j < words.length && unsure(words[j])) j++;
    if (j - i >= DOUBT_RUN) {
      squeezed.push([words[i].start, Math.max(words[j - 1].end, words[i].start)]);
      doubted += j - i;
      i = j;
    } else {
      // a sure word — or one unsure word alone, which stays where its neighbours hold it
      sure.push(words[i]);
      i++;
    }
  }
  return { sure, squeezed, doubted };
}

/** How good a listen is: how much of the script it heard AND was sure of, and how many words it was not. */
export function listenQuality(lines: string[], words: WordT[]): { share: number; doubted: number } {
  const { sure, doubted } = sureWords(words);
  return { share: heardShare(lines, sure), doubted };
}
/** A listen that missed part of the script — or fitted words where it was not sure of them — is worth
 *  another, softer one. */
export const listenAgain = (q: { share: number; doubted: number }): boolean => q.share < LISTEN_AGAIN_UNDER || q.doubted > 0;

/** When each scene's first word is said, where the scenes' own words say so — null for a scene whose
 *  opening (and the close of the scene before it) the listener did not hear; null altogether when the
 *  heard words are not the script's. */
function sceneStarts(lines: string[], words: WordT[]): Array<number | null> | null {
  const atoms: string[] = [];
  const first: number[] = [];
  for (const l of lines) { first.push(atoms.length); for (const u of saidUnits(l)) atoms.push(...unitAtoms(u)); }
  const pairs = sameWords(atoms, words.map((w) => atomOf(w.word)));
  if (!anchored(pairs.length, atoms, words.length, 3)) return null;
  const heardAt = new Map(pairs);
  return lines.map((_, k) => {
    if (!k) return 0;
    const end = k + 1 < lines.length ? first[k + 1] : atoms.length;
    // the close of the scene before, as it was heard (one of its last three words)
    let closed: number | null = null;
    for (let i = first[k] - 1; i >= Math.max(first[k - 1], first[k] - 3) && closed === null; i--) {
      const h = heardAt.get(i);
      if (h !== undefined) closed = words[h].end + (first[k] - 1 - i) * SAY_PACE;
    }
    // its own first word as it was heard — or counted back from the first of its opening words that was
    for (let j = first[k]; j < Math.min(end, first[k] + 4); j++) {
      const h = heardAt.get(j);
      if (h !== undefined) return Math.max(words[h].start - (j - first[k]) * SAY_PACE, closed ?? 0);
    }
    return closed;
  });
}

/** When each scene's part of the narration is spoken: one window per line, tiling [0, total] exactly
 *  (a picture stays up until the first word of the next scene).
 *
 *  A scene starts when its first word is heard (sceneStarts). Where that cannot be told — the heard
 *  words are not the script's, or that stretch was not heard — it starts at the heard word that sits
 *  the same fraction of the way through as its first word does in the script. With no heard words at
 *  all, the scenes share the track by how much each has to say. */
export function sceneWindows(lines: string[], words: WordT[], total: number): Window[] {
  const n = lines.length;
  if (!n) return [];
  const T = Math.max(total, n * MIN_SCENE_S);
  const counts = lines.map((l) => Math.max(1, saidLength(l)));
  const sum = counts.reduce((a, b) => a + b, 0);
  const heardStart = words.length ? sceneStarts(lines, words) : null;
  const starts: number[] = [0];
  let said = counts[0];
  for (let k = 1; k < n; k++) {
    const frac = said / sum;
    const known = heardStart ? heardStart[k] : null;
    let at = known !== null && known !== undefined ? known : words.length ? words[Math.min(words.length - 1, Math.round(frac * words.length))].start : frac * T;
    // in order, each scene given at least its minimum, and room left for the ones still to come
    at = Math.max(starts[k - 1] + MIN_SCENE_S, Math.min(at, T - (n - k) * MIN_SCENE_S));
    starts.push(at);
    said += counts[k];
  }
  return starts.map((t0, k) => ({ t0, t1: k + 1 < n ? starts[k + 1] : T }));
}

/** The scenes a narrated story is told in: the ones that have something to say, at most `max` of them —
 *  each kept WITH the picture the maker approved for it, so dropping an empty scene never slides every
 *  later picture onto the wrong scene. `approved` is index-aligned with `scenes` as they came in. */
export function keepToldScenes<S extends { caption?: string }>(scenes: S[], approved: (string | null | undefined)[], max: number): { scenes: S[]; approved: (string | null)[] } {
  const kept = (scenes || []).map((s, i) => ({ s, img: (approved || [])[i] || null })).filter((x) => !!x.s && !!(x.s.caption || "").trim()).slice(0, Math.max(1, max));
  return { scenes: kept.map((x) => x.s), approved: kept.map((x) => x.img) };
}

/** Where the talking stops inside each window, read from ffmpeg's `silencedetect` report of the film's
 *  sound: a window that ENDS in quiet is cut back to where that quiet begins (plus a breath). Windows
 *  that do not end in quiet are returned as they are. */
export function trimToSound(windows: Window[], silenceReport: string): Window[] {
  const starts = [...(silenceReport || "").matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...(silenceReport || "").matchAll(/silence_end:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  const quiet = starts.map((s0, i) => ({ s: Math.max(0, s0), e: i < ends.length ? ends[i] : Infinity }));
  return windows.map((w) => {
    const q = quiet.find((x) => x.s > w.t0 + 1 && x.s < w.t1 - 0.4 && x.e >= w.t1 - 0.3);
    return q ? { t0: w.t0, t1: Math.min(w.t1, q.s + 0.5) } : w;
  });
}

/** Letters, digits and the punctuation that can be drawn without quoting trouble. An apostrophe becomes
 *  the typographic one: a straight one would end the text inside the filter. A dash between words
 *  becomes a space, so "door—open" does not close up into one word. */
export const drawable = (s: string): string => s.replace(/[']/g, "’").replace(/[—–]/g, " ").replace(/[^\p{L}\p{N} .,!?$%’…-]/gu, "").replace(/\s+/g, " ").trim();

/** The SCRIPT's own words, each given the time it is said — so the captions say exactly what was written
 *  (a name spelt right, "1981" as written, nothing a transcriber misheard) and still move in step with
 *  the voice. Inside a scene's window a written word takes the time of the heard word that IS that word;
 *  the words between two such anchors are laid between them, and words before the first or after the
 *  last run up to it or on from it at an ordinary pace (see "the script, laid over what was heard").
 *  When too few words are the same, the written and the heard words are matched by position instead;
 *  a scene in which nothing was heard spreads its words evenly.
 *  The words are returned as they will be drawn (see drawable), in order, scene after scene.
 *  With `sparse`, a window in which fewer than minHeard of the line's words were heard is not timed by
 *  them: its words run from the first heard word (or `lead` after the window opens) to `tail` before
 *  it closes.
 *  With `speech` (where the voice track has sound, the clear voice first — soundLevels), words nobody
 *  heard are laid over the sound in their gap, never across a silence ("where the voice is sounding").
 *  With `squeezed` (where the listener had put words it was not sure of — sureWords, which also takes
 *  them out of `words`), the words nobody is sure of go anywhere in their gap but there, when the rest of
 *  it can hold them. */
export function scriptWordTimes(lines: string[], words: WordT[], windows: Window[], sparse?: { minHeard: number; lead: number; tail: number }, speech?: Span[][], squeezed?: Span[]): WordT[] {
  const room = (list: Span[]) => list.reduce((sum, [s, e]) => sum + (e - s), 0);
  const out: WordT[] = [];
  lines.forEach((line, k) => {
    const win = windows[k];
    const toks = saidUnits(line);
    if (!win || !toks.length) return;
    const last = k === lines.length - 1;
    const heard = words.filter((w) => w.start >= win.t0 - 1e-6 && (last || w.start < win.t1 - 1e-6));
    const M = toks.length;
    // where each unit sits in the line, by how long it takes to say: a word is one — so for a script
    // with spaces this is simply its place in the line — and a Chinese word is its glyphs (the aligner
    // hears Chinese glyph by glyph)
    const at: number[] = [0];
    for (const tk of toks) at.push(at[at.length - 1] + unitWeight(tk));
    const S = at[M];
    // `sparse` (acted films): a voice the aligner could barely follow — a snarling creature, a whisper —
    // gives a few early words and then nothing, and timing the whole line by those would take it off
    // screen while it is still being said. Heard too little of it? The line starts at the first heard
    // word (or just after the cut) and runs to the end of its window.
    const thin = !!sparse && heard.length < sparse.minHeard * S;
    if (thin) {
      // just after the cut — unless the first word that WAS heard comes well into the shot (a late entrance)
      const late = heard.length && heard[0].start - win.t0 > 1.5 ? heard[0].start - 0.2 : win.t0 + sparse!.lead;
      const t0 = Math.min(Math.max(win.t0, late), win.t1 - 0.5);
      const t1 = Math.max(t0 + 0.4, win.t1 - sparse!.tail);
      const per = (t1 - t0) / S;
      toks.forEach((word, j) => out.push({ word, start: t0 + at[j] * per, end: t0 + at[j + 1] * per, ...(j === M - 1 ? { last: true } : {}) }));
      return;
    }
    const Hn = heard.length;
    // THE SAME WORDS, WHERE THEY WERE HEARD
    const atoms: string[] = [];
    const firstAtom: number[] = [];
    for (const tk of toks) { firstAtom.push(atoms.length); atoms.push(...unitAtoms(tk)); }
    firstAtom.push(atoms.length);
    const pairs = Hn ? sameWords(atoms, heard.map((w) => atomOf(w.word))) : [];
    if (anchored(pairs.length, atoms, Hn, 2)) {
      const A = atoms.length;
      const when: Array<{ s: number; e: number } | null> = atoms.map(() => null);
      for (const [i, h] of pairs) when[i] = { s: heard[h].start, e: heard[h].end };
      const firstHeard = pairs[0][1], lastHeard = pairs[pairs.length - 1][1];
      for (let i = 0; i < A; ) {
        if (when[i]) { i++; continue; }
        let j = i;
        while (j < A && !when[j]) j++;
        const run = j - i;
        const left = i > 0 ? when[i - 1]!.e : null, right = j < A ? when[j]!.s : null;
        // WHERE THE VOICE IS SOUNDING in this gap, when the track has been read: the unheard words are
        // there — after the pause, if there is one — and not "on from the last heard word".
        let laid: Array<{ s: number; e: number }> | null = null;
        for (const level of speech || []) {
          const g0 = left !== null ? left : win.t0;
          const pieces = voicedIn(level, g0, right !== null ? Math.max(right, g0) : win.t1, run, left !== null, right !== null);
          if (!pieces) continue;
          // …and first of all anywhere but where the listener squeezed words it was not sure of
          const elsewhere = squeezed && squeezed.length ? without(pieces, squeezed) : pieces;
          const over = layOver(room(elsewhere) >= run * MIN_SAY ? elsewhere : pieces, run);
          if (over.length === run) { laid = over; break; }
        }
        if (laid) {
          for (let q = i; q < j; q++) when[q] = laid[q - i];
          i = j;
          continue;
        }
        // (the track was not read, or has no sound here that could be these words — the older rule.)
        // Not where the listener squeezed them: a squeeze that opens the stretch is stepped past, when
        // what is left of the stretch can still hold the words.
        const past = (from: number, to: number): number => {
          for (const [q0, q1] of squeezed || []) if (q0 < from + 0.3 && q1 > from && to - q1 >= run * MIN_SAY) return q1;
          return from;
        };
        let a: number, b: number;
        if (left !== null && right !== null) { a = past(left, right); b = Math.max(a, right); }
        // before the first anchor: from where the listener started hearing something else — when that
        // leaves time for these words to be said in — or at an ordinary pace up to the anchor (not before
        // the scene opens)
        else if (right !== null) {
          b = right;
          const from = firstHeard > 0 ? Math.min(heard[0].start, b) : NaN;
          a = Math.max(win.t0, b - from >= run * MIN_SAY ? from : b - run * SAY_PACE);
        }
        // after the last anchor: as far as the listener went on hearing — when that is long enough for
        // these words to have been said in (a stray sound heard just after the anchor must not have a
        // whole line squeezed into it) — or at an ordinary pace
        else {
          a = past(left!, win.t1);
          const on = lastHeard < Hn - 1 ? heard[Hn - 1].end : NaN;
          b = Math.max(a, on - a >= run * MIN_SAY ? on : Math.min(win.t1, a + run * SAY_PACE));
        }
        const per = (b - a) / run;
        for (let q = i; q < j; q++) when[q] = { s: a + (q - i) * per, e: a + (q - i + 1) * per };
        i = j;
      }
      toks.forEach((word, j) => {
        const a = when[firstAtom[j]]!, b = when[firstAtom[j + 1] - 1]!;
        out.push({ word, start: a.s, end: Math.max(b.e, a.s + 0.05), ...(j === M - 1 ? { last: true } : {}) });
      });
      return;
    }
    toks.forEach((word, j) => {
      const fin = j === M - 1 ? { last: true } : {};
      if (Hn) {
        const a = Math.min(Hn - 1, Math.floor((at[j] * Hn) / S));
        const b = Math.min(Hn - 1, Math.max(a, Math.ceil((at[j + 1] * Hn) / S) - 1));
        out.push({ word, start: heard[a].start, end: Math.max(heard[b].end, heard[a].start + 0.05), ...fin });
      } else {
        const per = (win.t1 - win.t0) / S;
        out.push({ word, start: win.t0 + at[j] * per, end: win.t0 + at[j + 1] * per, ...fin });
      }
    });
  });
  return speech && speech.length ? stillBeingSaid(out, speech[0]) : out;
}

/** A WORD IS STILL BEING SAID WHILE THE VOICE GOES ON SOUNDING. The listener ends a whispered or
 *  drawn-out word early: on a re-telling of the same story (2026-11-23) it gave "welcome" 0.4 s, then
 *  nothing for over half a second while the whisper went straight on, then "home" — so the caption went
 *  blank in the middle of three words, and the cut fell between "welcome" and "home" as if a pause were
 *  there. Where the clear voice sounds all the way from the end of one word to the start of the next, the
 *  first word's time runs on to the second's. Never across the end of a scene, and never across a real
 *  pause: quiet is quiet. */
export const STILL_SAID_MAX_S = 1.5;
export function stillBeingSaid(timed: WordT[], clearVoice: Span[]): WordT[] {
  if (!clearVoice.length) return timed;
  const sounding = (a: number, b: number) => clearVoice.reduce((sum, [s, e]) => sum + Math.max(0, Math.min(e, b) - Math.max(s, a)), 0);
  return timed.map((w, i) => {
    const next = timed[i + 1];
    if (!next || w.last) return w;
    const gap = next.start - w.end;
    if (!(gap > 0.05) || gap > STILL_SAID_MAX_S) return w;
    return sounding(w.end, next.start) >= gap * 0.85 ? { ...w, end: next.start } : w;
  });
}

/* ---- what the timing was made from ----
 * Nobody can read the server's log. When a story's captions came up wrong there (2026-11-23, "words the
 * listener was not sure of"), nothing said what the listener had heard — and the same film listened to
 * again on a desk came out right, every time. So a piece that is timed to its narration keeps what the
 * timing was made from: its lines, every word the listener heard with its time and how sure it was,
 * where the voice track was sounding, how long the track ran. A few thousand characters — and with them
 * the timing can be worked out again anywhere, word for word (readTiming → sceneWindows →
 * scriptWordTimes). It is shown to the operator alone (the Archive's loader). */
export type TimingRecord = {
  v: 1;
  /** how long the voice track ran */
  seconds: number;
  lines: string[];
  /** every word the listener heard — the word, when it starts and ends, how sure (−1: it did not say) */
  heard: Array<[string, number, number, number]>;
  /** where the voice was sounding, as start,end,start,end… — the clear voice, and any sound at all */
  clear: number[];
  any: number[];
  /** why the voice track was not read, when it was not */
  unread?: string;
  /** how much of the script was heard and sure (0 to 1); what the FIRST listen had heard when a softer
   *  second one was made; and whether the softer one was the one kept */
  share: number;
  first?: number;
  soft?: boolean;
  /** how many heard words were not believed, and how many of the script's words the voice track placed */
  doubted: number;
  placed: number;
};
/** No more heard words than this are kept (a story is a few hundred at most). */
export const TIMING_WORDS_MAX = 900;
const to2 = (x: number) => Math.round(x * 100) / 100;
const to3 = (x: number) => Math.round(x * 1000) / 1000;

/** The record of one timing. `listened` is everything the listener heard (unsure words too); `timed` is
 *  what scriptWordTimes made of it and `plain` the same without the voice track — the words that differ
 *  are the ones the track placed. */
export function timingRecord(o: {
  lines: string[]; listened: WordT[]; speech: Span[][]; seconds: number;
  timed?: WordT[]; plain?: WordT[]; first?: number; soft?: boolean; unread?: string;
}): TimingRecord {
  const flat = (spans?: Span[]) => (spans || []).flatMap(([s, e]) => [to2(s), to2(e)]);
  const q = listenQuality(o.lines, o.listened);
  const placed = o.timed && o.plain && o.timed.length === o.plain.length
    ? o.timed.filter((w, i) => Math.abs(w.start - o.plain![i].start) > 0.05).length : 0;
  return {
    v: 1,
    seconds: to3(o.seconds),
    lines: o.lines,
    heard: o.listened.slice(0, TIMING_WORDS_MAX).map((w): [string, number, number, number] => [w.word, to3(w.start), to3(w.end), typeof w.score === "number" ? to3(w.score) : -1]),
    clear: flat(o.speech[0]),
    any: flat(o.speech[1]),
    ...(o.unread ? { unread: o.unread.slice(0, 200) } : {}),
    share: to3(q.share),
    ...(typeof o.first === "number" ? { first: to3(o.first) } : {}),
    ...(o.soft ? { soft: true } : {}),
    doubted: q.doubted,
    placed,
  };
}

/** A record read back into what the timing is made from — null when it is not one. */
export function readTiming(rec: unknown): { lines: string[]; listened: WordT[]; speech: Span[][]; seconds: number } | null {
  const r = rec as Partial<TimingRecord> | null;
  if (!r || typeof r !== "object" || r.v !== 1 || !Array.isArray(r.lines) || !Array.isArray(r.heard)) return null;
  const pairs = (flat: unknown): Span[] => {
    const out: Span[] = [];
    if (Array.isArray(flat)) for (let i = 0; i + 1 < flat.length; i += 2) if (typeof flat[i] === "number" && typeof flat[i + 1] === "number") out.push([flat[i], flat[i + 1]]);
    return out;
  };
  const listened: WordT[] = [];
  for (const h of r.heard) {
    if (Array.isArray(h) && typeof h[0] === "string" && typeof h[1] === "number" && typeof h[2] === "number") {
      listened.push({ word: h[0], start: h[1], end: h[2], ...(typeof h[3] === "number" && h[3] >= 0 ? { score: h[3] } : {}) });
    }
  }
  const clear = pairs(r.clear), any = pairs(r.any);
  return { lines: r.lines.map(String), listened, speech: clear.length || any.length ? [clear, any] : [], seconds: Number(r.seconds) || 0 };
}

/** The record in one line, for the operator. */
export function timingLine(rec: unknown): string | null {
  const r = rec as Partial<TimingRecord> | null;
  const t = readTiming(rec);
  if (!r || !t) return null;
  const said = t.lines.reduce((n, l) => n + saidUnits(l).length, 0);
  const pct = (x: unknown) => `${Math.round((typeof x === "number" ? x : 0) * 100)}%`;
  const listen = `heard ${t.listened.length} words for ${said} written (${pct(r.share)} sure)`
    + (typeof r.first === "number" ? ` — ${r.soft ? "softer second listen kept" : "softer second listen no better"}, the first had ${pct(r.first)}` : "");
  const track = t.speech.length ? `voice track read: ${t.speech[0].length} clear / ${t.speech[1].length} any` : `voice track NOT read${r.unread ? ` (${r.unread})` : ""}`;
  return `timing: ${listen} · ${track} · ${r.doubted || 0} not believed · ${r.placed || 0} placed by the track`;
}

/** The longest BOLD card, in characters: one line of big words at one size. */
export const BOLD_LINE = 18;

/* Words that lean on what FOLLOWS them — articles, joining words, the commonest prepositions, "his" and
 * "her", the little pronouns French and Spanish hang on a verb. A card that ends on one reads as a
 * stumble: a faceless video made on 2026-11-23 showed "KEEPER HEARD A", "FLATTENED, AND HE" and
 * "STOPPED, AND THE". By language, because the same letters are a different word in another one ("die"
 * is an article in German and a verb in English). "is" and "was" are not here: "HER NAME WAS" / "WREN
 * OAKHOLLOW" is a reveal, not a stumble. A word with a mark on it is a pause, and is not looked up. */
const LEAN: Record<string, Set<string>> = {
  en: new Set("a an the and or but nor so of to in on at for with from by as into onto over under near than that who which when while if because his her their my your our its this these those no not".split(" ")),
  es: new Set("el la los las un una unos unas y e o u pero de del en a al con por para sin sobre que cuando si porque su sus mi mis tu tus no se me te lo le nos".split(" ")),
  fr: new Set("le la les un une des et ou mais de du en à au aux avec pour par sans sur dans que qui quand si car son sa ses mon ma mes ton ta tes ne se me te je tu il elle on nous vous ils elles".split(" ")),
  de: new Set("der die das den dem des ein eine einen einem einer und oder aber von zu zum zur in im an am auf mit für aus bei nach über unter dass wenn weil sein seine ihr ihre mein meine kein keine nicht".split(" ")),
};

/** One phrase in cards of up to three words on one line — the cut that reads best, not the first that
 *  fits: a card is not left ending on a word that leans on the next one, a word is not left on a card by
 *  itself (unless it is a clause by itself), and where the sentence breathes — a comma — is where a card
 *  ends, not somewhere in the middle of one. */
function phraseCards(ph: WordT[], lean: Set<string>): WordT[][] {
  const n = ph.length;
  const fits = (i: number, j: number): boolean => j - i === 1 || textWidth(ph.slice(i, j).map((w) => w.word).join(" ")) <= BOLD_LINE;
  const best: number[] = new Array(n + 1).fill(Infinity);
  const from: number[] = new Array(n + 1).fill(-1);
  best[0] = 0;
  for (let j = 1; j <= n; j++) {
    for (let len = 1; len <= 3; len++) { // of two cuts as good as each other, the EARLIER card is the fuller one ("HIS NAME WAS" / "HOWL, ONCE")
      const i = j - len;
      if (i < 0 || best[i] === Infinity || !fits(i, j)) continue;
      const last = ph[j - 1].word;
      const breathes = /,$/.test(last);
      let cost = best[i] + 1; // a card
      if (j < n && lean.has(last.toLowerCase())) cost += 3; // it ends leaning on the next card
      if (len === 1 && n > 1) cost += j === n ? 3 : 2; // a word by itself — worst of all as the phrase's last card
      if (j < n && breathes) cost -= 1.5; // it ends where the sentence breathes
      for (let k = i; k < j - 1; k++) if (/,$/.test(ph[k].word)) cost += 2; // …and does not breathe in the middle
      if (cost < best[j] - 1e-9) { best[j] = cost; from[j] = i; }
    }
  }
  const cuts: number[] = [];
  for (let j = n; j > 0; j = from[j]) cuts.unshift(j);
  let at = 0;
  return cuts.map((j) => ph.slice(at, (at = j)));
}

/** BOLD: the words, a few at a time (up to three words, one line), each card up exactly while it is
 *  being said. Give it scriptWordTimes() for the script's own spelling, and the language the words are
 *  in (en, es, fr, de — anything else is cut as English).
 *
 *  A card never holds the end of one sentence and the start of the next ("HOWL, ONCE. A" — seen in the
 *  first real render), never runs past the end of its scene, and does not draw the comma or full stop it
 *  ends on: big words carry their own weight. */
export function boldCards(words: WordT[], lang?: string | null): Card[] {
  // 1) phrases: a card never crosses the end of a sentence, the end of a scene, or a real pause
  const phrases: WordT[][] = [];
  let cur: WordT[] = [];
  for (const w of words) {
    if (cur.length && w.start - cur[cur.length - 1].end > 0.6) { phrases.push(cur); cur = []; }
    cur.push(w);
    // (in a script without spaces a comma ends the phrase too: there, a clause is what a card holds)
    if (w.last || /[.!?…]$/u.test(w.word) || (WIDE.test(w.word) && /,$/.test(w.word))) { phrases.push(cur); cur = []; }
  }
  if (cur.length) phrases.push(cur);
  const width = (ws: WordT[]) => textWidth(joinUnits(ws.map((x) => x.word)));
  const cards: Card[] = [];
  for (const ph of phrases) {
    let chunks: WordT[][] = [];
    if (ph.some((w) => WIDE.test(w.word))) {
      // 2) a script without spaces: the clause is the card when it fits the line; a longer one is cut
      //    into as few even parts as fit — between words, never inside one
      const units = ph.map((w) => w.word);
      const fits = (g: string[]) => textWidth(joinUnits(g)) <= BOLD_LINE;
      let parts = Math.max(1, Math.ceil(width(ph) / BOLD_LINE));
      let split = evenParts(units, parts);
      while (!split.every(fits) && parts < units.length) split = evenParts(units, ++parts);
      let from = 0;
      chunks = split.map((g) => ph.slice(from, (from += g.length)));
    } else {
      // 2) each phrase in cards of up to three words on one line, cut where it reads best (phraseCards)
      chunks = phraseCards(ph, LEAN[(lang || "en").toLowerCase().slice(0, 2)] || LEAN.en);
    }
    for (const ch of chunks) {
      const upTo = (k: number): string => drawable(joinUnits(ch.slice(0, k + 1).map((w) => w.word))).toUpperCase().replace(/[.,…]+$/u, "").trim();
      const text = upTo(ch.length - 1);
      if (!text) continue;
      // each word's own piece of the card (they join back into it), so one can be lit while it is said
      const pieces: Array<{ text: string; t0: number; t1: number }> = [];
      let before = "";
      let whole = true;
      ch.forEach((w, k) => {
        const now = upTo(k);
        if (!now.startsWith(before) || now.length === before.length) whole = false;
        pieces.push({ text: now.slice(before.length), t0: w.start, t1: w.end });
        before = now;
      });
      cards.push({ text, t0: ch[0].start, t1: ch[ch.length - 1].end, ...(whole ? { words: pieces } : {}) });
    }
  }
  // no gaps a word can fall into: a card holds until the next one starts (but not across a long pause)
  for (let i = 0; i + 1 < cards.length; i++) if (cards[i + 1].t0 - cards[i].t1 < 0.6) cards[i].t1 = cards[i + 1].t0;
  return cards;
}

/** Break a text into lines of at most `max` characters, at spaces (a single word longer than a line
 *  stands alone). */
export function wrapLines(text: string, max: number): string[] {
  return wrapUnits(text.split(" ").filter(Boolean), max);
}

/** wrapLines for a line already cut into its units (saidUnits): as wide as it is drawn, joined as it is drawn. */
export function wrapUnits(units: string[], max: number): string[] {
  const lines: string[] = [];
  let cur: string[] = [];
  for (const u of units) {
    if (cur.length && textWidth(joinUnits([...cur, u])) > max) { lines.push(joinUnits(cur)); cur = [u]; }
    else cur.push(u);
  }
  if (cur.length) lines.push(joinUnits(cur));
  return lines;
}

/** Like wrapLines, but a text that takes two lines is broken where the two come out most alike. */
export function wrapEven(text: string, max: number): string[] {
  return wrapEvenUnits(text.split(" ").filter(Boolean), max);
}

/** wrapEven for a line already cut into its units. */
export function wrapEvenUnits(units: string[], max: number): string[] {
  const greedy = wrapUnits(units, max);
  if (greedy.length !== 2) return greedy;
  let best = greedy;
  let gap = Math.abs(textWidth(greedy[0]) - textWidth(greedy[1]));
  // in a script without spaces the line turns at a pause when there is one to turn at ("…寒气袭来 / 可那里
  // …", not "…寒气袭 / 来 可那里…"): the evenest of those, and only otherwise the evenest of all — and
  // not where a word would be left leaning over the turn (cutCost)
  const wide = units.some((u) => WIDE.test(u));
  if (wide) {
    const k = units.findIndex((_, i) => i > 0 && joinUnits(units.slice(0, i)) === greedy[0]);
    if (k > 0) gap += cutCost(units[k - 1], units[k]);
  }
  let atPause = false;
  for (let i = 1; i < units.length; i++) {
    const a = joinUnits(units.slice(0, i)), b = joinUnits(units.slice(i));
    if (textWidth(a) > max || textWidth(b) > max) continue;
    const even = Math.abs(textWidth(a) - textWidth(b));
    const g = even + (wide ? cutCost(units[i - 1], units[i]) : 0);
    // a pause is always where a script without spaces turns; one with spaces turns there when the pause
    // is near the middle ("He never shared a single one, / terrified winter would…" — not "…a single
    // one, terrified / winter would…"), and evenly otherwise
    const pause = /[.,!?…]$/u.test(units[i - 1]) && (wide || even <= 2 * PAUSE_PULL);
    if (pause ? !atPause || g < gap - 1e-6 : !atPause && g < gap - 1e-6) { gap = g; best = [a, b]; atPause = atPause || pause; }
  }
  return best;
}

/** How far from the even point a pause may be and still be where the cut falls, in letters. */
export const PAUSE_PULL = 12;

/** Cut a run of words into `parts` runs of about the same length as drawn (each at least a word).
 *  With `atPauses`, a cut is drawn to a pause — a comma — that is near the even point: "…with barely a
 *  handful left himself, / offered Russo acorns…" rather than "…a handful left / himself, offered…"
 *  (the first real wide story, 2026-11-23). */
export function evenParts(words: string[], parts: number, atPauses = false): string[][] {
  const n = Math.max(1, Math.min(parts, words.length));
  const ends: number[] = [];
  let pos = 0;
  words.forEach((w, i) => { pos += textWidth(w) + (i && !(WIDE.test(words[i - 1].slice(-1)) && WIDE.test(w[0] || "")) ? 1 : 0); ends.push(pos); });
  const out: string[][] = [];
  let from = 0;
  for (let j = 1; j < n; j++) {
    const target = (j * pos) / n;
    // how far a cut after word i is from an even one — plus what it costs to cut there at all (cutCost:
    // nothing, in a script with spaces)
    const off = (i: number): number => Math.abs(ends[i] - target) + (i + 1 < words.length ? cutCost(words[i], words[i + 1]) : 0) - (atPauses && /[,…]$/u.test(words[i]) ? PAUSE_PULL : 0);
    let best = from;
    // (a later cut has to be really better, not better by the rounding of 1.7 + 1.7 + …: of two cuts
    //  as good as each other, the earlier one is taken — as it always was)
    for (let i = from; i < words.length - (n - j); i++) if (off(i) < off(best) - 1e-6) best = i;
    out.push(words.slice(from, best + 1));
    from = best + 1;
  }
  out.push(words.slice(from));
  return out.filter((g) => g.length);
}

/** SUBTITLES: each scene's words as written, at most two lines at a time. Reading them in order is
 *  reading the story. `maxChars` = the longest line that fits the frame. A scene with nothing to say
 *  shows nothing.
 *
 *  A card is whole sentences: as many as fit on two lines together, and a sentence too long for two
 *  lines is shown two lines at a time (the first real render broke "…and ran / away to the top…" across
 *  two cards because the first sentence had left room).
 *
 *  With `timed` (scriptWordTimes() of the same lines) every card comes up as its first word is spoken
 *  and stays until the next card's first word — or, at the end of a scene, a moment after its own last
 *  word. Without it, a scene's cards share its window by how much each says. */
export function subtitleCards(lines: string[], windows: Window[], maxChars: number, timed?: WordT[]): Card[] {
  const cards: Card[] = [];
  let at = 0; // where this scene's words start in `timed`
  const fits = (ws: string[]) => wrapUnits(ws, maxChars).length <= 2;
  lines.forEach((line, k) => {
    const win = windows[k];
    const toks = saidUnits(line);
    const n = toks.length;
    const mine = timed && timed.length >= at + n ? timed.slice(at, at + n) : null;
    at += n;
    if (!win || !n) return;
    const sentences: string[][] = [];
    let cur: string[] = [];
    for (const tk of toks) { cur.push(tk); if (/[.!?…]$/u.test(tk)) { sentences.push(cur); cur = []; } }
    if (cur.length) sentences.push(cur);
    const groups: string[][] = []; // the words of each card
    let acc: string[] = [];
    for (const sen of sentences) {
      if (acc.length && fits([...acc, ...sen])) { acc = [...acc, ...sen]; continue; }
      if (acc.length) { groups.push(acc); acc = []; }
      if (fits(sen)) { acc = sen; continue; }
      // too long for one card: as few cards as it needs, each with an even share of the sentence
      // (two full lines and then "in circles." on a card of its own reads like a mistake)
      let parts = Math.ceil(wrapUnits(sen, maxChars).length / 2);
      // (cut at a pause near the even point when that still fits; else evenly; else in more cards)
      let split = evenParts(sen, parts, true);
      if (!split.every(fits)) split = evenParts(sen, parts);
      while (!split.every(fits) && parts < sen.length) split = evenParts(sen, ++parts);
      groups.push(...split);
    }
    if (acc.length) groups.push(acc);
    const first = cards.length;
    let w0 = 0;
    groups.forEach((g, gi) => {
      const w1 = Math.min(n, w0 + g.length);
      const text = wrapEvenUnits(g, maxChars).join("\n");
      if (mine) cards.push({ text, t0: mine[w0].start, t1: Math.min(win.t1, mine[w1 - 1].end + 0.6) });
      else cards.push({ text, t0: win.t0 + ((win.t1 - win.t0) * w0) / n, t1: gi === groups.length - 1 ? win.t1 : win.t0 + ((win.t1 - win.t0) * w1) / n });
      w0 = w1;
    });
    if (mine) for (let i = first; i + 1 < cards.length; i++) cards[i].t1 = cards[i + 1].t0;
  });
  return cards;
}

/** The longest subtitle line a frame of this shape holds. */
export const subtitleChars = (W: number, H: number): number => (W > H ? 52 : W === H ? 36 : 30);

/** ffmpeg drawtext filters for a list of cards — one filter per LINE of each card, so nothing has to be
 *  escaped across a line break. `font` is a font file path; W×H the frame. Returns [] for "off". */
export function captionFilters(cards: Card[], style: CaptionStyle, font: string, W: number, H: number): string[] {
  if (style === "off" || !cards.length) return [];
  const f = font.replace(/\\/g, "/").replace(/:/g, "\\:");
  const u = Math.min(W, H) / 720; // one design unit: sizes were drawn on a 720-wide phone frame
  const out: string[] = [];
  for (const c of cards) {
    const lines = c.text.split("\n").map(drawable).filter(Boolean);
    const when = `enable='gte(t,${c.t0.toFixed(2)})*lt(t,${c.t1.toFixed(2)})'`;
    lines.forEach((ln, li) => {
      const fromBottom = lines.length - 1 - li;
      if (style === "bold" || style === "highlight") {
        // ONE size for every card (a card is at most BOLD_LINE characters); only a single giant word shrinks
        const size = Math.round(Math.max(30, Math.min(54, Math.floor((720 * 0.9) / (Math.max(BOLD_LINE, textWidth(ln)) * 0.62)))) * u);
        const y = W > H ? `h-${Math.round(150 * u)}-${fromBottom * Math.round(size * 1.25)}` : `h-${Math.round(H * 0.28)}-${fromBottom * Math.round(size * 1.25)}`;
        out.push(`drawtext=expansion=none:fontfile='${f}':text='${ln}':fontsize=${size}:fontcolor=white:borderw=${Math.max(4, Math.round(8 * u))}:bordercolor=black:x=(w-text_w)/2:y=${y}:${when}`);
      } else {
        const size = Math.round(34 * u);
        // a wide frame keeps them low, like a film; a tall or square one lifts them clear of the strip
        // where a phone feed draws its own caption and buttons (about the bottom fifth)
        const base = W > H ? Math.round(70 * u) : W === H ? Math.round(H * 0.12) : Math.round(H * 0.2);
        const y = `h-${base}-${fromBottom * Math.round(size * 1.42)}`;
        // a soft dark backing behind each line: readable over a bright cartoon and a dark cellar alike
        out.push(`drawtext=expansion=none:fontfile='${f}':text='${ln}':fontsize=${size}:fontcolor=white:borderw=${Math.max(1, Math.round(1.5 * u))}:bordercolor=black@0.85:box=1:boxcolor=black@0.45:boxborderw=${Math.max(6, Math.round(9 * u))}:x=(w-text_w)/2:y=${y}:${when}`);
      }
    });
  }
  return out;
}

/* ---- the HIGHLIGHT style: the Bold cards, with the word being said lit ----
 * drawtext draws a whole string in one colour, so this one is handed to the subtitle renderer (libass)
 * as an .ass file: for every word of a card, one line that is on screen while that word is said — the
 * card's text with that word in the highlight colour. Sized and placed to sit exactly where the Bold
 * card sits (measured side by side, 2026-11-23: with Poppins, the renderer's font size is the letter
 * height × 1.74, and the line's foot is 1.31 letter heights under where drawtext puts its top).
 * A card with no word times (or a script without spaces, not yet measured) is shown unlit. */
export const HIGHLIGHT_RGB = "FFD84A";
export const ASS_EM = 1.74;
export const ASS_FOOT = 1.31;
const assTime = (t: number): string => {
  const cs = Math.max(0, Math.round(t * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor((cs % 360000) / 6000)).padStart(2, "0")}:${String(Math.floor((cs % 6000) / 100)).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
/** RRGGBB → the renderer's &H00BBGGRR& */
const assColour = (rgb: string): string => `&H00${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}&`;
/** what may stand in a line of the file: drawable() text has no braces or backslashes, but nothing is taken on trust */
const assText = (t: string): string => t.replace(/[{}\\\r\n]/g, " ");

/** The .ass file for the highlight style — "" when there is nothing to draw. `fontFamily` is the family
 *  name of the font the cards are drawn in (the renderer finds it in the fonts folder it is given). */
export function highlightAss(cards: Card[], fontFamily: string, W: number, H: number): string {
  const shown = cards.filter((c) => c.text && c.t1 > c.t0);
  if (!shown.length) return "";
  const u = Math.min(W, H) / 720;
  const outline = Math.max(4, Math.round(8 * u));
  const white = assColour("FFFFFF"), lit = assColour(HIGHLIGHT_RGB);
  const head = [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${W}`, `PlayResY: ${H}`, "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cap,${fontFamily.replace(/[,\r\n]/g, " ")},54,${white},${white},&H00000000&,&H00000000&,-1,0,0,0,100,100,0,0,1,${outline},0,2,20,20,0,1`, "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const lines: string[] = [];
  for (const c of shown) {
    // the same size and the same place as the Bold card (captionFilters)
    const em = Math.round(Math.max(30, Math.min(54, Math.floor((720 * 0.9) / (Math.max(BOLD_LINE, textWidth(c.text)) * 0.62)))) * u);
    const top = W > H ? H - Math.round(150 * u) : H - Math.round(H * 0.28);
    const marginV = Math.max(0, H - top - Math.round(em * ASS_FOOT));
    const open = `{\\fs${Math.round(em * ASS_EM)}}`;
    const say = (a: number, b: number, text: string) => { if (b - a > 0.005) lines.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Cap,,0,0,${marginV},,${open}${text}`); };
    const ws = c.words && c.words.length && !hasWide(c.text) ? c.words : null;
    if (!ws) { say(c.t0, c.t1, assText(c.text)); continue; }
    ws.forEach((w, k) => {
      const a = k === 0 ? c.t0 : Math.max(c.t0, Math.min(w.t0, c.t1));
      const b = k + 1 < ws.length ? Math.max(a, Math.min(ws[k + 1].t0, c.t1)) : c.t1;
      // (the word's own letters are lit — not the space or comma that joins it to the one before)
      const lead = /^[\s,]*/.exec(w.text)![0];
      const before = ws.slice(0, k).map((x) => x.text).join("") + lead;
      const after = ws.slice(k + 1).map((x) => x.text).join("");
      say(a, b, `${assText(before)}{\\c${lit}}${assText(w.text.slice(lead.length))}{\\c${white}}${assText(after)}`);
    });
  }
  return lines.length ? [...head, ...lines, ""].join("\n") : "";
}

/* ---- who is IN a scene's picture ----
 * The first real render drew the werewolf into every scene — including "the empty counter at dawn" —
 * because every picture was told about the whole cast. A character is in a picture when the scene's
 * VISUAL names them (the writer is told to name everyone who is in it, and nobody who is not). */

const NAME_SKIP = /^(the|a|an|mr|mrs|ms|miss|dr|sir|lady|lord|old|little|big|young|captain|king|queen|uncle|aunt|grandma|grandpa)$/i;
/** The words of a name a scene might call the character by: "Mourning Mary" → Mourning, Mary; "The Ganve" → Ganve. */
export function nameWords(name: string): string[] {
  return (name || "").split(/[^\p{L}\p{N}'’-]+/u).filter((w) => w.length >= 2 && !NAME_SKIP.test(w));
}
/** Is this character named in the text? The whole name in any case, or one of its own words exactly as
 *  written — as a word of its own, so "Dot" is not in "dotted", and "Howl" is not "a distant howl". */
export function namedIn(name: string, text: string): boolean {
  const t = text || "";
  const full = (name || "").trim();
  if (!full) return false;
  // a name of several words is unmistakable in any case; a single word must be written as the name is
  if (/\s/.test(full) && t.toLowerCase().includes(full.toLowerCase())) return true;
  return nameWords(full).some((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u").test(t));
}
/** The name a cast-list entry starts with: "Marla, a tired night clerk…" → "Marla". */
export const entryName = (entry: string): string => ((entry || "").split(/[,:—–(]/)[0] || "").trim();
/** Who is in this scene's picture: which of the PICKED cast (by index) and which of the story's other
 *  cast-list entries. */
export function sceneCast(visual: string, pickedNames: string[], others: string[]): { picked: number[]; others: string[] } {
  return {
    picked: pickedNames.map((n, i) => (namedIn(n, visual) ? i : -1)).filter((i) => i >= 0),
    others: others.filter((e) => namedIn(entryName(e), visual)),
  };
}

/** Does a picture have black bars baked into it — a wide composition letterboxed inside a tall frame
 *  (or a tall one pillarboxed inside a wide frame)? Read from ffmpeg's own report of the picture's size
 *  and of the box its non-black content sits in (`cropdetect`). Only a matching PAIR of bars counts:
 *  a night sky is dark at the top of a picture, not at the top and the bottom alike. */
export function barsIn(ffmpegReport: string): boolean { return !!barBox(ffmpegReport); }
/** The box the picture's real content sits in when it has such bars (else null) — for cropping them off. */
export function barBox(ffmpegReport: string): { w: number; h: number; x: number; y: number } | null {
  const size = /Video:[^\n]*?\b(\d{3,5})x(\d{3,5})\b/.exec(ffmpegReport || "");
  const crops = [...(ffmpegReport || "").matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  if (!size || !crops.length) return null;
  const W = Number(size[1]), H = Number(size[2]);
  const [w, h, x, y] = crops[crops.length - 1].slice(1).map(Number);
  // a live still had bars of 3.7% — thin, but a black band top and bottom all the same
  const pair = (a: number, b: number, full: number) => a > full * 0.025 && b > full * 0.025 && Math.abs(a - b) < full * 0.025;
  if (pair(y, H - h - y, H)) return { w: W, h, x: 0, y };
  if (pair(x, W - w - x, W)) return { w, h: H, x, y: 0 };
  return null;
}
/** What a picture model is told about the frame it is filling. */
export const frameWords = (aspect: string): string =>
  `${aspect === "16:9" ? "A wide landscape" : aspect === "1:1" ? "A square" : "A tall vertical"} picture that fills the whole frame from edge to edge — no borders, no black bars, no letterboxing.`;

/** A slow push in on one picture and a slow pull back on the next (zoompan), `frames` long, to W×H.
 *  The source is scaled up first so the move is smooth rather than stair-stepped. `i` picks the direction. */
export function kenBurns(i: number, frames: number, W: number, H: number): string {
  const n = Math.max(2, frames);
  const z = i % 2 === 0 ? `1+0.10*on/${n - 1}` : `max(1.10-0.10*on/${n - 1},1.001)`;
  return `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${n}:s=${W}x${H}:fps=30,setsar=1`;
}

/** The frame a story is drawn on. */
export const storyFrame = (aspect: string | null | undefined): { aspect: "9:16" | "16:9" | "1:1"; W: number; H: number } =>
  aspect === "16:9" ? { aspect: "16:9", W: 1280, H: 720 } : aspect === "1:1" ? { aspect: "1:1", W: 1080, H: 1080 } : { aspect: "9:16", W: 720, H: 1280 };

/* ---- how loud a finished film is ----
 * An acted film's sound is whatever the video model performed; the first two came out at about -24 dB
 * beside narrated stories at -18. A film is measured once and moved to the target with ONE gain for the
 * whole film (no moment-to-moment riding, which pumps the room tone up between lines). */

/** ffmpeg's loudnorm measurement (`print_format=json`) → integrated loudness and true peak, or null. */
export function parseLoudness(report: string): { i: number; tp: number } | null {
  const i = /"input_i"\s*:\s*"(-?[\d.]+|-inf)"/.exec(report || "");
  const tp = /"input_tp"\s*:\s*"(-?[\d.]+|-inf)"/.exec(report || "");
  if (!i || !tp || i[1] === "-inf") return null;
  const iv = Number(i[1]), tv = tp[1] === "-inf" ? -99 : Number(tp[1]);
  return Number.isFinite(iv) && Number.isFinite(tv) ? { i: iv, tp: tv } : null;
}
/** The gain (dB) that takes a film from where it measures to `target` LUFS: never more than `maxBoost`
 *  up or 12 down, and 0 when it is already within a decibel (nothing to gain from re-encoding). */
export function levelGain(measured: { i: number; tp: number }, target = -16, maxBoost = 12): number {
  const g = Math.max(-12, Math.min(maxBoost, target - measured.i));
  return Math.abs(g) < 1 ? 0 : Math.round(g * 10) / 10;
}
