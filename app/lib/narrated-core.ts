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
export type Card = { text: string; t0: number; t1: number };

/** How the words are put on screen.
 *   off        nothing
 *   bold       big upper-case words, a few at a time, in step with the voice (the social look)
 *   subtitles  a clean line or two of sentence-case text at the bottom (the film look) */
export type CaptionStyle = "off" | "bold" | "subtitles";
export const CAPTION_STYLES: Array<{ key: CaptionStyle; label: string; blurb: string }> = [
  { key: "bold", label: "Bold", blurb: "Big words that pop in time with the voice" },
  { key: "subtitles", label: "Subtitles", blurb: "A clean line along the bottom, like a film" },
  { key: "off", label: "Off", blurb: "No words on screen" },
];
export const captionStyleOf = (v: unknown, fallback: CaptionStyle = "off"): CaptionStyle => (v === "off" || v === "bold" || v === "subtitles" ? v : fallback);

const countWords = (s: string): number => (s.trim().match(/\S+/g) || []).length;
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
  const counts = lines.map((l) => Math.max(1, countWords(l)));
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
    const toks = drawable(line).split(" ").filter(Boolean);
    if (!win || !toks.length) return;
    const last = k === lines.length - 1;
    const heard = words.filter((w) => w.start >= win.t0 - 1e-6 && (last || w.start < win.t1 - 1e-6));
    const M = toks.length;
    // `sparse` (acted films): a voice the aligner could barely follow — a snarling creature, a whisper —
    // gives a few early words and then nothing, and timing the whole line by those would take it off
    // screen while it is still being said. Heard too little of it? The line starts at the first heard
    // word (or just after the cut) and runs to the end of its window.
    const thin = !!sparse && heard.length < sparse.minHeard * M;
    if (thin) {
      // just after the cut — unless the first word that WAS heard comes well into the shot (a late entrance)
      const late = heard.length && heard[0].start - win.t0 > 1.5 ? heard[0].start - 0.2 : win.t0 + sparse!.lead;
      const t0 = Math.min(Math.max(win.t0, late), win.t1 - 0.5);
      const t1 = Math.max(t0 + 0.4, win.t1 - sparse!.tail);
      const per = (t1 - t0) / M;
      toks.forEach((word, j) => out.push({ word, start: t0 + j * per, end: t0 + (j + 1) * per, ...(j === M - 1 ? { last: true } : {}) }));
      return;
    }
    const Hn = heard.length;
    toks.forEach((word, j) => {
      const fin = j === M - 1 ? { last: true } : {};
      if (Hn) {
        const a = Math.min(Hn - 1, Math.floor((j * Hn) / M));
        const b = Math.min(Hn - 1, Math.max(a, Math.ceil(((j + 1) * Hn) / M) - 1));
        out.push({ word, start: heard[a].start, end: Math.max(heard[b].end, heard[a].start + 0.05), ...fin });
      } else {
        const per = (win.t1 - win.t0) / M;
        out.push({ word, start: win.t0 + j * per, end: win.t0 + (j + 1) * per, ...fin });
      }
    });
  });
  return out;
}

/** The longest BOLD card, in characters: one line of big words at one size. */
export const BOLD_LINE = 18;

/** BOLD: the words, a few at a time (up to three words, one line), each card up exactly while it is
 *  being said. Give it scriptWordTimes() for the script's own spelling.
 *
 *  A card never holds the end of one sentence and the start of the next ("HOWL, ONCE. A" — seen in the
 *  first real render), never runs past the end of its scene, and does not draw the comma or full stop it
 *  ends on: big words carry their own weight. */
export function boldCards(words: WordT[]): Card[] {
  // 1) phrases: a card never crosses the end of a sentence, the end of a scene, or a real pause
  const phrases: WordT[][] = [];
  let cur: WordT[] = [];
  for (const w of words) {
    if (cur.length && w.start - cur[cur.length - 1].end > 0.6) { phrases.push(cur); cur = []; }
    cur.push(w);
    if (w.last || /[.!?…]$/u.test(w.word)) { phrases.push(cur); cur = []; }
  }
  if (cur.length) phrases.push(cur);
  const width = (ws: WordT[]) => ws.reduce((n, x) => n + x.word.length, 0) + Math.max(0, ws.length - 1);
  const cards: Card[] = [];
  for (const ph of phrases) {
    // 2) each phrase in lines of up to three words…
    const chunks: WordT[][] = [];
    let c: WordT[] = [];
    for (const w of ph) {
      if (c.length && (c.length >= 3 || width(c) + 1 + w.word.length > BOLD_LINE)) { chunks.push(c); c = []; }
      c.push(w);
    }
    if (c.length) chunks.push(c);
    // …and no word left on a card by itself when the card before it can spare one
    const n = chunks.length;
    if (n >= 2 && chunks[n - 1].length === 1 && chunks[n - 2].length >= 2) {
      const moved = chunks[n - 2][chunks[n - 2].length - 1];
      if (moved.word.length + 1 + chunks[n - 1][0].word.length <= BOLD_LINE) { chunks[n - 2].pop(); chunks[n - 1].unshift(moved); }
    }
    for (const ch of chunks) {
      const text = drawable(ch.map((w) => w.word).join(" ")).toUpperCase().replace(/[.,…]+$/u, "").trim();
      if (text) cards.push({ text, t0: ch[0].start, t1: ch[ch.length - 1].end });
    }
  }
  // no gaps a word can fall into: a card holds until the next one starts (but not across a long pause)
  for (let i = 0; i + 1 < cards.length; i++) if (cards[i + 1].t0 - cards[i].t1 < 0.6) cards[i].t1 = cards[i + 1].t0;
  return cards;
}

/** Break a text into lines of at most `max` characters, at spaces (a single word longer than a line
 *  stands alone). */
export function wrapLines(text: string, max: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(" ").filter(Boolean)) {
    if (cur && cur.length + 1 + w.length > max) { lines.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Like wrapLines, but a text that takes two lines is broken where the two come out most alike. */
export function wrapEven(text: string, max: number): string[] {
  const greedy = wrapLines(text, max);
  if (greedy.length !== 2) return greedy;
  const words = text.split(" ").filter(Boolean);
  let best = greedy;
  let gap = Math.abs(greedy[0].length - greedy[1].length);
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    if (a.length > max || b.length > max) continue;
    const g = Math.abs(a.length - b.length);
    if (g < gap) { gap = g; best = [a, b]; }
  }
  return best;
}

/** Cut a run of words into `parts` runs of about the same length in characters (each at least a word). */
export function evenParts(words: string[], parts: number): string[][] {
  const n = Math.max(1, Math.min(parts, words.length));
  const ends: number[] = [];
  let pos = 0;
  words.forEach((w, i) => { pos += w.length + (i ? 1 : 0); ends.push(pos); });
  const out: string[][] = [];
  let from = 0;
  for (let j = 1; j < n; j++) {
    const target = (j * pos) / n;
    let best = from;
    for (let i = from; i < words.length - (n - j); i++) if (Math.abs(ends[i] - target) < Math.abs(ends[best] - target)) best = i;
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
  const fits = (ws: string[]) => wrapLines(ws.join(" "), maxChars).length <= 2;
  lines.forEach((line, k) => {
    const win = windows[k];
    const toks = drawable(line).split(" ").filter(Boolean);
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
      let parts = Math.ceil(wrapLines(sen.join(" "), maxChars).length / 2);
      let split = evenParts(sen, parts);
      while (!split.every(fits) && parts < sen.length) split = evenParts(sen, ++parts);
      groups.push(...split);
    }
    if (acc.length) groups.push(acc);
    const first = cards.length;
    let w0 = 0;
    groups.forEach((g, gi) => {
      const w1 = Math.min(n, w0 + g.length);
      const text = wrapEven(g.join(" "), maxChars).join("\n");
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
      if (style === "bold") {
        // ONE size for every card (a card is at most BOLD_LINE characters); only a single giant word shrinks
        const size = Math.round(Math.max(30, Math.min(54, Math.floor((720 * 0.9) / (Math.max(BOLD_LINE, ln.length) * 0.62)))) * u);
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
