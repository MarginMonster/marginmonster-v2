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
export type WordT = { word: string; start: number; end: number; last?: boolean };
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

/** When each scene's part of the narration is spoken: one window per line, tiling [0, total] exactly
 *  (a picture stays up until the first word of the next scene).
 *
 *  The aligner's words are matched to the script by COUNT, not word for word — it hears "nineteen
 *  eighty one" where the script says "1981", drops an "a", splits a hyphen — so scene k starts at the
 *  heard word that sits the same fraction of the way through as scene k's first word does in the
 *  script. With no heard words at all, the scenes share the track by how much each has to say. */
export function sceneWindows(lines: string[], words: WordT[], total: number): Window[] {
  const n = lines.length;
  if (!n) return [];
  const T = Math.max(total, n * MIN_SCENE_S);
  const counts = lines.map((l) => Math.max(1, saidLength(l)));
  const sum = counts.reduce((a, b) => a + b, 0);
  const starts: number[] = [0];
  let said = counts[0];
  for (let k = 1; k < n; k++) {
    const frac = said / sum;
    let at = words.length ? words[Math.min(words.length - 1, Math.round(frac * words.length))].start : frac * T;
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

/** The SCRIPT's own words, each given the time of the heard word at the same place in its scene — so the
 *  captions say exactly what was written (a name spelt right, "1981" as written, nothing a transcriber
 *  misheard) and still move in step with the voice. Inside a scene's window the script's words and the
 *  heard words are matched by position; a scene in which nothing was heard spreads its words evenly.
 *  The words are returned as they will be drawn (see drawable), in order, scene after scene.
 *  With `sparse`, a window in which fewer than minHeard of the line's words were heard is not timed by
 *  them: its words run from the first heard word (or `lead` after the window opens) to `tail` before
 *  it closes. */
export function scriptWordTimes(lines: string[], words: WordT[], windows: Window[], sparse?: { minHeard: number; lead: number; tail: number }): WordT[] {
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
  return out;
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
