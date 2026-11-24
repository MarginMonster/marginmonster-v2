/* A COVER FOR EVERY PIECE — the Archive's shelf, sorted by eye.
 *
 * The owner, 2026-11-24: "Each creation in archive needs its own cover like the films (dedicated style)
 * like music, horror, narration, better segregation this way".
 *
 * A narrated story already makes a POSTER when it is made (story-poster.ts): its best picture, its title,
 * who is in it. Everything else on the shelf — music videos, acted films, horror, ads, Creator videos,
 * found footage, music tracks — showed whatever its first frame happened to be. Now every video and every
 * track wears a cover in the style of its FAMILY, so the shelf separates at a glance:
 *
 *   story    a told story (Moral / Short / Kids Story)      the story poster itself — picture to the edges,
 *                                                           a black foot, a gold rule, the names in gold
 *   film     an acted film (Short / Moral Film, Kids        a cinema marquee: the picture above, a black
 *            Cartoon, actors' dialogue, engine tests)        plate below lit by a frame of bulbs (the
 *                                                           sign-in lobby's own); the title centred in it
 *   horror   a Horror Story or Horror Film                   a black one-sheet: the picture drained of
 *                                                           colour, blood in the shadows, grain, a bone-white
 *                                                           title worn through in places, three claw marks
 *   music    a music video, a kids' one, a music track       a record sleeve: the picture as the sleeve, the
 *                                                           vinyl sliding out of it, over the picture blurred
 *                                                           (a track's sleeve is its own sound wave)
 *   ad       a commercial, a presenter ad, a cartoon ad,     the Ad Maker's green: the picture in a white
 *            an anthem, a product video                      card, the product's name under it, a hang tag
 *   creator  a Creator video, a faceless video, a talking    a sticker: the picture as a tilted white-edged
 *            head, an edited clip                            card on a bright gradient, its name on a label
 *   footage  found footage (a "take")                        a camcorder's viewfinder: corner marks, REC and
 *                                                           the clock, scan lines, the date it was made
 *
 * One app throughout: Poppins, the shelf's own 4:5, gold for names, and nothing written that is not the
 * piece's own (its title, the names in it, its length and its date — REC is the camera's). The words the
 * shelf says ABOUT a piece are said under it, in the member's language.
 *
 * Pure (no disk, no ffmpeg): which family a piece is, its words, the cover's record on the piece, how a
 * frame is chosen, where it is cropped, how a title is set, and each family's filter graph.
 * archive-cover.server.ts draws them; tests/archive-cover.test.ts holds this file. */
import { billable, posterDress, posterLayout, posterFilters, posterTitle, POSTER_H, POSTER_W, type PosterLayout } from "./story-poster.ts";
import { drawable, hasWide } from "./narrated-core.ts";

/** A cover is a poster's size: the shelf's own 4:5, twice a phone tile's width. */
export const COVER_W = POSTER_W;
export const COVER_H = POSTER_H;
/** The DESIGN's version. It is in every cover's file name (the renders route caches a file for a year, so a
 *  new design must be a new name) — raise it and every cover is asked for again, the old one shown meanwhile. */
export const COVER_V = 1;

export type CoverFamily = "story" | "film" | "horror" | "music" | "ad" | "creator" | "footage";
export const COVER_FAMILIES: ReadonlyArray<CoverFamily> = ["story", "film", "horror", "music", "ad", "creator", "footage"];
export type CoverKind = { family: CoverFamily; /** a kids' format: the same family in candy colours */ kids: boolean };

/** What the shelf calls each family under a video's tile (a wide screen's line) — English source words, run
 *  through t(). A track keeps its "Music": it is on a tab of its own, where every piece is music. */
export const COVER_LABEL: Record<CoverFamily, string> = {
  story: "Story", film: "Film", horror: "Horror", music: "Music video", ad: "Ad", creator: "Creator video", footage: "Found footage",
};

type Obj = Record<string, unknown>;
const objOf = (raw: unknown): Obj => {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Obj;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try { const o = JSON.parse(raw); return o && typeof o === "object" && !Array.isArray(o) ? (o as Obj) : {}; } catch { return {}; }
};
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** A piece as the cover reads it: its type, its title, and the two records it carries. */
export type CoverPiece = { type: string; title?: string | null; meta?: unknown; body?: unknown };

/** WHICH FAMILY. Read from what the piece already says about itself — the kind and template its pipeline
 *  wrote on it, its style — and, for one made before those were written, the name its pipeline gave it
 *  ("Horror Film — …", "Music Video — …", "Commercial — …"). null: not a video or a track (an image is
 *  its own cover; an article is a row). */
export function coverKind(p: CoverPiece): CoverKind | null {
  if (p.type === "AUDIO") return { family: "music", kids: false };
  if (p.type !== "VIDEO_AD") return null;
  const m = objOf(p.meta);
  const b = objOf(p.body);
  const kind = str(m.kind).toLowerCase();
  const tmpl = str(m.template).toLowerCase();
  const style = (str(m.style) || str(b.style)).toUpperCase();
  const title = str(p.title);
  // a take — found footage (take.server.ts)
  if (kind === "take" || style === "TAKE" || /^found footage\b/i.test(title)) return { family: "footage", kids: false };
  // HORROR, told or acted (and the older stills-and-clips engine's): the scare is the family
  if (tmpl === "horror" || /^horror (film|story)\b/i.test(title)) return { family: "horror", kids: false };
  // SUNG: a music video, a kids' music video (either engine), an A/B test of one
  const kidsSung = tmpl === "kidsmusicvideo" || tmpl === "kidsmusic" || /^kids music video\b/i.test(title);
  if (kind === "musicvideo" || style === "MUSICVIDEO" || tmpl === "musicvideo" || kidsSung || /^music video\b/i.test(title)) return { family: "music", kids: kidsSung };
  const kids = tmpl === "kidstv" || /^kids (cartoon|story)\b/i.test(title);
  // TOLD: a narrated story, and the older engine's films (stills and clips under one voice)
  if (kind === "narrated" || style === "NARRATED" || kind === "film" || style === "FILM" || /^(moral|short|kids) story\b/i.test(title)) return { family: "story", kids };
  // ACTED: the cast speak on camera — and the tests of it
  if (kind === "testmovie" || kind === "avatardialogue" || kind === "enginetest" || style === "TESTMOVIE" || style === "AVATARDIALOGUE" || style === "ENGINETEST"
    || /^(short|moral) film\b|^kids cartoon\b|^dialogue\b|^engine test\b/i.test(title)) return { family: "film", kids };
  // CREATOR: a faceless video, a described Creator video (the pipeline stamps `creative`; an older one is
  // known by the brief every such video was built from), an edited clip — and a presenter with no product
  // (the talking head: the Ad Maker's "No product")
  if (kind === "faceless" || style === "FACELESS" || /^faceless video\b/i.test(title)) return { family: "creator", kids: false };
  if (m.creative === true || (style === "PRODUCT_HIGHLIGHT" && str(b.prompt).startsWith("Cinematic short video.")) || style === "VIDEO_EDIT" || /^(video|edited video)\s*[—–-]/i.test(title)) return { family: "creator", kids: false };
  if (style === "AI_AVATAR" && m.serviceMode === true) return { family: "creator", kids: false };
  // everything else the Ad Maker made: a commercial, a presenter with a product, a cartoon ad, an anthem…
  return { family: "ad", kids: false };
}

/** The family whose cover IS the poster its pipeline made: a told story's poster is drawn in this very
 *  dress, so it stays its cover. Every other poster (an acted film's cast, a horror story's) stays the
 *  piece's POSTER — the download, the Movie Maker's episode row — and the shelf wears the family's cover. */
export const posterIsCover = (family: CoverFamily): boolean => family === "story";

/* ---- THE WORDS ---- */

/** The name a pipeline puts in front of a title ("Music Video — Neon Hearts"): the cover says the title. */
const KIND_PREFIX = /^(?:kids music video|music video|horror film|horror story|moral film|moral story|short film|short story|kids cartoon|kids story|found footage|faceless video|commercial|anthem|product video|edited video|video|dialogue \(actors\)|dialogue · actors|skit|youtube video)\s*[—–-]\s*/i;

/** WHAT THE COVER SAYS: the piece's own title — without the kind its pipeline put in front of it — and the
 *  names it bills (three at most): the cast of a story or a film, who sang a verse, who presents. */
export function coverWords(p: CoverPiece, kind: CoverKind): { title: string; names: string[] } {
  const m = objOf(p.meta);
  let t = String(p.title || "").replace(/\s+/g, " ").trim();
  const names: string[] = [];
  // an engine test is billed as the film it tested
  const tested = /^engine test\b.*?\bof\s+(.+)$/i.exec(t) || /^engine test\s*·\s*[^·]+·\s*(.+)$/i.exec(t);
  if (tested) t = tested[1].trim();
  // "Mara presents — The Night Cream": the product is the title, Mara is billed
  const presents = /^(.{1,40}?)\s+presents\s*[—–-]\s*(.+)$/i.exec(t);
  if (presents) { names.push(presents[1].trim()); t = presents[2].trim(); }
  const cartoon = /^.{1,40}?\scartoon\s*[—–-]\s*(.+)$/i.exec(t);
  if (cartoon && kind.family === "ad") t = cartoon[1].trim();
  t = t.replace(KIND_PREFIX, "").trim();
  if (kind.family === "story" || kind.family === "film" || kind.family === "horror") {
    const listed = [...(Array.isArray(m.cast) ? m.cast : []), ...(Array.isArray(m.castCards) ? m.castCards : [])];
    for (const c of listed) if (c && typeof c === "object") names.push(str((c as Obj).name));
  }
  if (kind.family === "music" && Array.isArray(m.featured)) for (const n of m.featured) names.push(str(n));
  const seen = new Set<string>();
  const billed = names.map((n) => n.replace(/\s+/g, " ").slice(0, 40)).filter((n) => {
    const k = n.toLowerCase();
    if (!n || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 3);
  return { title: t, names: billed };
}

/** Letters this cover can draw: Poppins draws Latin, the captions' CJK font draws a script written without
 *  spaces. Anything else would come out as boxes (Cyrillic, Arabic, Greek…) or as letters never joined (the
 *  server's ffmpeg does not shape a script — Urdu, Hindi) — so it is left off the cover, and the piece's name
 *  stays under the tile, where the page draws it. */
export const canDraw = (s: string): boolean => [...String(s || "")].every((ch) => !/\p{L}/u.test(ch) || /\p{Script=Latin}/u.test(ch) || hasWide(ch));

/* ---- THE RECORD ON THE PIECE ---- */

/** Where a cover is kept, beside the piece's own media: "mv-…-abc.mp4" → "mv-…-abc-k3x9a2-cover1.jpg" — one
 *  dot (the renders route serves nothing else), the design's version, and a tag of the PIECE (two pieces made
 *  from one file — drawn by the harness on 2026-11-24 — wrote over each other's covers; the tag is a hash, so
 *  the piece's id cannot be read back out of the name). */
export const coverName = (media: string, piece: string): string =>
  `${String(media || "").split(/[?#]/)[0].split("/").pop()!.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-zA-Z0-9_-]/g, "")}-${seedOf(`cover:${piece}`).toString(36)}-cover${COVER_V}.jpg`;

/** A piece's cover as its meta keeps it (`meta.cover`) — one of OUR renders, and which design drew it. */
export function coverOf(meta: unknown): { src: string; v: number } | null {
  const c = objOf(meta).cover;
  const mm = typeof c === "string" ? /^\/renders\/[a-zA-Z0-9_-]+-cover(\d{1,3})\.jpg$/.exec(c) : null;
  return mm ? { src: c as string, v: Number(mm[1]) } : null;
}

/** The media a cover can be made from: a file on our own renders disk (never a provider's address — those
 *  die within the hour, and a piece whose media is gone gets nothing). Its bare name, or null. */
export function localMedia(url: string | null | undefined): string | null {
  const u = String(url || "").split(/[?#]/)[0];
  const mm = /^\/renders\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,180}\.(?:mp4|mov|webm|m4v|mp3|m4a|wav))$/i.exec(u);
  return mm ? mm[1] : null;
}

/** SHOULD THE ARCHIVE ASK FOR ONE? A video or a track of a known family, whose media is ours and still
 *  here, that has no cover of the current design — and is not a told story with its poster (that IS its
 *  cover). */
/** FAMILIES WHOSE DESIGN IS BEING REDRAWN: not asked for until it is. The owner, seeing every family on a
 *  TEST page (2026-11-24): "The ads and creator ones need rethought" — so an ad's or a creator video's tile
 *  keeps the picture it had until the new design lands. */
export const COVER_HELD: ReadonlySet<string> = new Set(["ad", "creator"]);

export function coverAsk(o: { kind: CoverKind | null; media: string | null | undefined; expired: boolean; poster: string | null; cover: { v: number } | null }): boolean {
  if (!o.kind || o.expired || !localMedia(o.media)) return false;
  if (COVER_HELD.has(o.kind.family)) return false;
  if (o.poster && posterIsCover(o.kind.family)) return false;
  return !o.cover || o.cover.v < COVER_V;
}

/* ---- THE PICTURE ---- */

/** Where in a video the candidate frames are taken: n moments spread across its middle — never its first
 *  second (a fade from black, a title card) nor its last (an end card). */
export function frameTimes(duration: number, n = 6): number[] {
  const d = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (d <= 0.4) return [0];
  const k = Math.max(1, Math.min(12, Math.floor(n)));
  const from = d * 0.16, to = d * 0.84;
  return Array.from({ length: k }, (_, i) => Math.round((k === 1 ? d / 2 : from + ((to - from) * i) / (k - 1)) * 100) / 100);
}

/** The analysis graph: each candidate (input i) shrunk to `w` pixels wide in grey, side by side, as one
 *  raw frame — a few kilobytes that say which picture is worth a cover. */
export function framesGraph(n: number, w: number, h: number): string {
  const k = Math.max(1, Math.floor(n));
  const one = (i: number) => `[${i}:v]scale=${w}:${h},setsar=1,format=gray`;
  return k === 1 ? `${one(0)}[o]` : `${Array.from({ length: k }, (_, i) => `${one(i)}[g${i}]`).join(";")};${Array.from({ length: k }, (_, i) => `[g${i}]`).join("")}hstack=inputs=${k}[o]`;
}

export type FrameStats = {
  /** where the picture is, as fractions of the height — the rest is black bars */
  top: number; bottom: number;
  /** its mean brightness, its spread (contrast), and how much of it is near black — inside the bars */
  mean: number; spread: number; dark: number;
};

/** One candidate's numbers, from the analysis frame: `gray` is `stride` pixels wide, `h` tall, and the
 *  candidate is the `w` columns from `x0`. */
export function frameStats(gray: Uint8Array, stride: number, h: number, x0: number, w: number): FrameStats {
  const rowMean = (y: number) => { let s = 0, mx = 0; for (let x = x0; x < x0 + w; x++) { const v = gray[y * stride + x] || 0; s += v; if (v > mx) mx = v; } return { mean: s / Math.max(1, w), max: mx }; };
  const bar = (y: number) => { const r = rowMean(y); return r.mean < 14 && r.max < 42; };
  let t = 0, b = h - 1;
  while (t < h && bar(t)) t++;
  while (b > t && bar(b)) b--;
  if (t >= h) return { top: 0, bottom: 1, mean: 0, spread: 0, dark: 1 };
  let s = 0, s2 = 0, dark = 0, n = 0;
  for (let y = t; y <= b; y++) for (let x = x0; x < x0 + w; x++) { const v = gray[y * stride + x] || 0; s += v; s2 += v * v; if (v < 24) dark++; n++; }
  const mean = s / Math.max(1, n);
  const spread = Math.sqrt(Math.max(0, s2 / Math.max(1, n) - mean * mean));
  // (a bar that is not the whole edge is not trusted below one row in twenty)
  const top = t / h >= 0.05 ? t / h : 0;
  const bottom = (h - 1 - b) / h >= 0.05 ? (b + 1) / h : 1;
  return { top, bottom, mean, spread, dark: dark / Math.max(1, n) };
}

/** How good a cover a candidate makes: bright enough to see, not blown out, with something in it (contrast),
 *  not mostly black, filling the frame (no bars) — and a little preference for the middle of the piece. */
export function frameScore(s: FrameStats, at = 0.5): number {
  const tall = s.bottom - s.top;
  if (tall < 0.25 || s.mean < 16) return 0;
  const light = s.mean < 55 ? (s.mean - 16) / 39 : s.mean > 200 ? Math.max(0, (245 - s.mean) / 45) : 1;
  const detail = Math.min(1, s.spread / 58);
  const middle = 1 - 0.25 * Math.min(1, Math.abs(at - 0.5) * 2);
  return Math.max(0, light) * (0.3 + 0.7 * detail) * (1 - 0.75 * s.dark) * Math.sqrt(tall) * middle;
}

/** The best of the candidates (the earliest of equals); -1 when none is worth a cover. */
export function bestFrame(stats: ReadonlyArray<FrameStats>, at?: ReadonlyArray<number>): number {
  let best = -1, top = 0.04;
  stats.forEach((s, i) => { const sc = frameScore(s, at?.[i] ?? 0.5); if (sc > top + 1e-9) { top = sc; best = i; } });
  return best;
}

/** Where captions are burned into a finished video: from about 60% of a tall frame's height down (80% of a
 *  wide one's). A cover cut from a FINISHED video stays above that line, so no caption is cut in half on it;
 *  a picture that never had captions (a story's still, an acted film's shot, a take before its dressing)
 *  keeps all of itself. */
export const CAPTION_LINE = { tall: 0.6, wide: 0.8 } as const;

/** The part of a picture that may be shown: inside its bars, and — for a finished video — above its
 *  captions (unless that would leave less than half of the picture). Fractions of the height. */
export function safeBox(src: { w: number; h: number }, frame: { top: number; bottom: number } = { top: 0, bottom: 1 }, captioned = false): { top: number; bottom: number } {
  const top = Math.max(0, Math.min(0.9, frame.top));
  const bottom = Math.max(top + 0.1, Math.min(1, frame.bottom));
  if (!captioned) return { top, bottom };
  const line = src.h > src.w * 1.05 ? CAPTION_LINE.tall : CAPTION_LINE.wide;
  const cut = Math.min(bottom, line);
  return cut - top >= (bottom - top) * 0.5 ? { top, bottom: cut } : { top, bottom };
}

/** Where the eye goes in a picture, as a fraction of its height: a little above the middle — a face, a
 *  figure's head and shoulders, a product held up. A crop is centred there, as far as the safe part allows. */
export const FOCUS_Y = 0.42;

/** THE CROP: the largest window of `aspect` (width ÷ height) inside the safe part of a w×h picture, centred
 *  across, and centred down on `focusY` of the picture's height as far as the safe part lets it be. Whole,
 *  even pixels, inside the picture. */
export function cropWindow(src: { w: number; h: number }, safe: { top: number; bottom: number }, aspect: number, focusY = FOCUS_Y): { x: number; y: number; w: number; h: number } {
  const W = Math.max(2, Math.round(src.w)), H = Math.max(2, Math.round(src.h));
  const T = Math.max(0, Math.min(H - 2, safe.top * H)), B = Math.max(T + 2, Math.min(H, safe.bottom * H));
  const room = B - T;
  let w = W, h = W / aspect;
  if (h > room) { h = room; w = h * aspect; }
  const even = (v: number) => Math.max(2, Math.floor(v / 2) * 2);
  const cw = Math.min(even(w), W - (W % 2)), ch = Math.min(even(h), H - (H % 2));
  const x = Math.max(0, Math.min(W - cw, Math.round((W - cw) / 2)));
  const y = Math.max(Math.ceil(T), Math.min(Math.floor(B) - ch, Math.round(focusY * H - ch / 2)));
  return { x, y: Math.max(0, Math.min(H - ch, y)), w: cw, h: ch };
}

/* ---- THE WORDS, SET ---- */

/** Poppins Bold's own advance widths, ‰ of an em, for the printable ASCII letters (U+0020…U+007E) — read from
 *  public/fonts/Poppins-Bold.ttf. "ILL" and "MOM" are both three letters; they are not one width. */
const ADV = [212, 392, 411, 904, 658, 870, 798, 221, 477, 477, 534, 628, 287, 580, 282, 453, 652, 376, 571, 605, 677, 650, 637, 535, 648, 615, 284, 347, 551, 696, 541, 538, 1080, 737, 659, 762, 727, 541, 547, 762, 731, 295, 578, 697, 477, 918, 752, 786, 624, 788, 652, 615, 591, 705, 730, 1052, 715, 671, 596, 510, 802, 510, 709, 780, 291, 679, 679, 605, 679, 616, 360, 679, 674, 295, 294, 618, 295, 1059, 674, 637, 679, 679, 428, 558, 406, 674, 626, 866, 588, 632, 496, 499, 291, 499, 636];
const OTHER: Record<string, number> = { "’": 0.314, "…": 0.76, "·": 0.299, "—": 0.93, "–": 0.695, "€": 0.796, "£": 0.663, "¥": 0.671, "₹": 0.598, "•": 0.501 };

/** How wide a text draws, in ems of Poppins Bold (a glyph of a script written without spaces: one em). */
export function emWidth(s: string): number {
  let w = 0;
  for (const ch of String(s || "")) {
    const c = ch.codePointAt(0) || 0;
    w += c >= 32 && c < 127 ? ADV[c - 32] / 1000 : OTHER[ch] ?? (hasWide(ch) ? 1 : /\p{Lu}/u.test(ch) ? 0.74 : 0.64);
  }
  return w;
}

/** A text's lines at `maxEm` ems to a line: as few as it fits in (`most` at most), filled as evenly as they
 *  can be, words kept whole (a script without spaces is cut by its glyphs) — and a name with a colon breaks
 *  AT the colon when it needs two lines and both halves fit ("Howl:" / "Night tales"). [] when it does not fit. */
export function fitLines(text: string, maxEm: number, most: number): string[] {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t || !(maxEm > 0)) return [];
  const glyphs = hasWide(t) && !/\s/.test(t);
  const units = glyphs ? Array.from(t) : t.split(" ");
  const glue = glyphs ? "" : " ";
  const width = (a: string[]) => emWidth(a.join(glue));
  const total = width(units);
  if (!glyphs && total > maxEm && most >= 2) {
    const k = units.findIndex((u) => u.endsWith(":"));
    if (k >= 0 && k < units.length - 1) {
      const halves = [units.slice(0, k + 1), units.slice(k + 1)];
      if (halves.every((l) => width(l) <= maxEm)) return halves.map((l) => l.join(glue));
    }
  }
  for (let n = 1; n <= Math.max(1, most); n++) {
    const share = total / n;
    const lines: string[][] = [[]];
    for (const u of units) {
      const cur = lines[lines.length - 1];
      if (cur.length && lines.length < n && (width([...cur, u]) > maxEm || width(cur) >= share)) lines.push([u]);
      else cur.push(u);
    }
    if (lines.every((l) => width(l) <= maxEm)) return lines.map((l) => l.join(glue));
  }
  return [];
}

/** A ladder of sizes a title is tried at, largest first: [font size in pixels, lines it may take]. */
export type Ladder = ReadonlyArray<readonly [number, number]>;

/** A TITLE SET IN A BOX `box` pixels wide: the biggest size of the ladder at which it fits in its lines —
 *  and when even the smallest will not hold it, the smallest, cut at its last line with an ellipsis. In
 *  capitals for a family that sets its titles so. null when there is nothing to draw. */
export function fitTitle(text: string, box: number, ladder: Ladder, caps = false): { size: number; lines: string[] } | null {
  const b = billable(String(text || ""));
  const t = caps ? b.toUpperCase() : b;
  if (!t || !canDraw(t)) return null;
  for (const [size, most] of ladder) {
    const lines = fitLines(t, box / size, most);
    if (lines.length && lines.length <= most) return { size, lines };
  }
  const [size, most] = ladder[ladder.length - 1];
  const words = t.split(" ").filter(Boolean);
  const glyphs = hasWide(t) && !/\s/.test(t);
  const units = glyphs ? Array.from(t) : words;
  const glue = glyphs ? "" : " ";
  const out: string[] = [];
  let cur = "";
  for (const u of units) {
    const next = cur ? `${cur}${glue}${u}` : u;
    if (cur && emWidth(next) * size > box) {
      if (out.length === most - 1) { out.push(cutToFit(`${cur}${glue}${u}`, box / size)); return { size, lines: out }; }
      out.push(cur); cur = u;
    } else cur = next;
  }
  if (cur) out.push(emWidth(cur) * size > box ? cutToFit(cur, box / size) : cur);
  return out.length ? { size, lines: out.slice(0, most) } : null;
}

/** A line cut to `maxEm` with an ellipsis (whole words when it has spaces). */
export function cutToFit(line: string, maxEm: number): string {
  const s = String(line || "").trim();
  if (emWidth(s) <= maxEm) return s;
  const words = s.split(" ");
  while (words.length > 1 && emWidth(`${words.join(" ")}…`) > maxEm) words.pop();
  let t = words.join(" ");
  if (emWidth(`${t}…`) > maxEm) { const g = Array.from(t); while (g.length > 1 && emWidth(`${g.join("")}…`) > maxEm) g.pop(); t = g.join(""); }
  return `${t.replace(/[\s,.:;–—-]+$/u, "")}…`;
}

/** The billing: names in capitals with a dot between — as many as fit `box` pixels at `size`. */
export function billingLine(names: ReadonlyArray<string>, box: number, size: number): string {
  const list = names.map((n) => drawable(String(n || "")).toUpperCase()).filter((n) => !!n && canDraw(n));
  while (list.length && emWidth(list.join("  ·  ")) * size > box) list.pop();
  return list.join("  ·  ");
}

/* ---- THE GRAPHS ---- */

/** What a cover is drawn FROM: the picture (input 0 — a still, a frame of a video, or a track's sound),
 *  its size and where it may be cropped, and the extra portraits an acted film is billed with (inputs 1…). */
export type CoverPicture = { w: number; h: number; safe: { top: number; bottom: number }; /** its mean brightness (0–255), when it was measured */ mean?: number };
export type CoverSpec = {
  kind: CoverKind;
  title: string;
  names: ReadonlyArray<string>;
  /** a font file (Poppins, or the captions' CJK font when the words need it) */
  font: string;
  /** the picture; null for a music track (its sleeve is its own sound — input 0 is the audio) */
  picture: CoverPicture | null;
  /** an acted film's cast: their portraits, inputs 0…n-1 in place of the picture (at most three) */
  portraits?: ReadonlyArray<CoverPicture>;
  /** a STILL that is the story's own picture: cropped the way its pipeline's poster crops one */
  still?: boolean;
  /** found footage: the date it was made ("2026.11.24  03:12") and its length in seconds */
  stamp?: string;
  seconds?: number;
  /** a number that makes this cover's grain and wear its own (and the same every time it is drawn) */
  seed?: number;
};

/** A stable number from a text (cyrb-style) — for a cover's grain. */
export function seedOf(s: string): number {
  let h = 0x811c9dc5;
  for (const ch of String(s || "")) { h ^= ch.codePointAt(0) || 0; h = Math.imul(h, 16777619); }
  return (h >>> 0) % 2147483647;
}

const GOLD = "0xE7C879";
const fontArg = (font: string) => font.replace(/\\/g, "/").replace(/:/g, "\\:");
/** Words inside drawtext's quotes: a colon is escaped once (the graph's quotes are read first, then drawtext
 *  splits its options at every bare colon — as story-poster.ts found); nothing else drawable() keeps can end
 *  the text early, and expansion is off so a "%" is a letter. */
const esc = (s: string) => String(s || "").replace(/\\/g, "").replace(/'/g, "’").replace(/:/g, "\\:");
/** One line of words with its BASELINE at `base` (drawtext puts the top of the line's tallest letter at y,
 *  so y = base − ascent stands every line on the same ground, whatever letters it has). */
function words(font: string, s: string, size: number, color: string, x: string | number, base: number, extra = ""): string {
  return `drawtext=expansion=none:fontfile='${fontArg(font)}':text='${esc(s)}':fontsize=${size}:fontcolor=${color}:x=${x}:y=${base}-ascent${extra}`;
}
const CAP = 0.705; // Poppins' capital height, in ems
/** A crop and a scale to w×h, from a picture's crop window. (Its clock starts at nought first: a frame taken
 *  from inside a video arrives a moment after the shapes drawn beside it, and a cover is ONE frame — the first
 *  out. Without this the ad's and the sticker's cards came out empty.) */
const cropTo = (p: CoverPicture, w: number, h: number, focusY = FOCUS_Y) => {
  const c = cropWindow(p, p.safe, w / h, focusY);
  return `setpts=PTS-STARTPTS,crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${w}:${h}:flags=lanczos,setsar=1`;
};
/** A rounded rectangle's coverage at (X,Y) in a w×h layer, corners of radius r, anti-aliased — 0…255. */
const roundedAlpha = (w: number, h: number, r: number) => {
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  return `255*clip(${r}+0.5-hypot(max(abs(X-${cx})-${cx - r}\\,0)\\,max(abs(Y-${cy})-${cy - r}\\,0))\\,0\\,1)`;
};
/** A layer of one colour, shaped by an alpha expression. */
const shape = (w: number, h: number, color: string, alpha: string) => `color=c=${color}:s=${w}x${h},format=rgba,geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='${alpha}'`;
/** A darkening that rises from `from` to the bottom: every channel scaled by one factor, in RGB (sheets of
 *  translucent black, stacked, turn a picture green — story-poster.ts learned it by looking). */
const foot = (from: number, span: number, depth: number, curve = 0.8) => {
  const k = `(1-${depth}*pow(clip((Y-${from})/${span}\\,0\\,1)\\,${curve}))`;
  return `format=gbrp,geq=r='r(X\\,Y)*${k}':g='g(X\\,Y)*${k}':b='b(X\\,Y)*${k}'`;
};

/** A BLOCK OF WORDS — the billing over the title — centred down the room between `top` and `bottom`,
 *  starting at `x` (a number: set from the left; an expression: drawtext's own, e.g. centred). */
function wordBlock(font: string, o: { bill: string; billColor: string; billSize: number; fit: { size: number; lines: string[] } | null; color: string; extra?: string; x: string | number; top: number; bottom: number; lead?: number }): string[] {
  const lead = o.fit ? Math.round(o.fit.size * (o.lead ?? 1.1)) : 0;
  const billH = o.bill ? Math.round(o.billSize * CAP) : 0;
  const gap = o.bill && o.fit ? 24 : 0;
  const titleH = o.fit ? Math.round(o.fit.size * CAP) + lead * (o.fit.lines.length - 1) : 0;
  let y = Math.round(o.top + (o.bottom - o.top - (billH + gap + titleH)) / 2);
  const out: string[] = [];
  if (o.bill) { y += billH; out.push(words(font, o.bill, o.billSize, o.billColor, o.x, y)); y += gap; }
  if (o.fit) { y += Math.round(o.fit.size * CAP); out.push(...titleLines(font, o.fit.lines, o.fit.size, o.color, o.x, y, lead, o.extra || "")); }
  return out;
}

/** Lines of a title, stacked from a first baseline. */
const titleLines = (font: string, lines: ReadonlyArray<string>, size: number, color: string, x: string | number, firstBase: number, lead: number, extra = "") =>
  lines.map((ln, i) => words(font, ln, size, color, x, firstBase + i * lead, extra));

/** THE GRAPH for one cover: a -filter_complex whose output is [out], 800×1000. */
export function coverGraph(spec: CoverSpec): string {
  switch (spec.kind.family) {
    case "story": return storyGraph(spec);
    case "film": return filmGraph(spec);
    case "horror": return horrorGraph(spec);
    case "music": return musicGraph(spec);
    case "ad": return adGraph(spec);
    case "creator": return creatorGraph(spec);
    case "footage": return footageGraph(spec);
  }
}

/** The words a cover will draw — so the font that can draw them is chosen before the graph is built. */
export function coverText(spec: Pick<CoverSpec, "title" | "names" | "stamp">): string {
  return [spec.title, ...spec.names, spec.stamp || ""].join(" ");
}

/* STORY — the story poster itself (story-poster.ts), so a story made before posters wears the very dress of
 * one made after: a still is cropped as its pipeline crops one; a frame of a finished video is cut above
 * its captions first. */
export function storyLayout(spec: Pick<CoverSpec, "title" | "names">): PosterLayout | null {
  const layout = posterLayout({ title: spec.title, cast: spec.names.filter((n) => canDraw(n)) });
  return layout && canDraw(`${layout.lines.join(" ")} ${layout.episode} ${layout.episode2 || ""}`) ? layout : null;
}
function storyGraph(spec: CoverSpec): string {
  const layout = storyLayout(spec) || { size: 0, lines: [], episode: "", cast: "" };
  const p = spec.picture || { w: COVER_W, h: COVER_H, safe: { top: 0, bottom: 1 } };
  if (spec.still) return `[0:v]${posterFilters(layout, spec.font)},format=yuvj444p[out]`;
  return `[0:v]${cropTo(p, COVER_W, COVER_H)},${posterDress(layout, spec.font)},format=yuvj444p[out]`;
}

/* FILM — A MARQUEE. The picture fills the top; below it a black plate is framed by a row of lit bulbs — the
 * sign-in lobby's own — and the title stands centred in it, the cast billed in gold above it. A film cast
 * from the member's presenters shows them, side by side (as its poster does); one with an invented cast
 * shows a frame of one of its shots (an acted film's pictures are wide: the panel keeps both faces). */
export const FILM_PANEL_H = 636;
export const FILM_LADDER: Ladder = [[66, 1], [60, 2], [52, 2], [46, 2], [40, 3], [34, 3]];
export function filmGraph(spec: CoverSpec): string {
  const W = COVER_W, PH = FILM_PANEL_H, plateH = COVER_H - PH;
  const parts: string[] = [];
  const faces = (spec.portraits || []).slice(0, 3);
  if (faces.length) {
    const share = Math.floor(W / faces.length);
    const widths = faces.map((_, i) => share + (i < W - share * faces.length ? 1 : 0));
    faces.forEach((f, i) => parts.push(`[${i}:v]${cropTo(f, widths[i], PH, 0.38)}[f${i}]`));
    parts.push(faces.length === 1 ? `[f0]null[pic]` : `${faces.map((_, i) => `[f${i}]`).join("")}hstack=inputs=${faces.length}[pic]`);
  } else {
    const p = spec.picture || { w: W, h: PH, safe: { top: 0, bottom: 1 } };
    parts.push(`[0:v]${cropTo(p, W, PH)}[pic]`);
  }
  // the picture fades into the plate, then the plate
  parts.push(`[pic]${foot(PH - 170, 170, 0.9, 1.3)},pad=${W}:${COVER_H}:0:0:color=0x0B0A08[base]`);
  // THE BULBS: a frame of lamps round the plate, each a hot core in a warm glow — one mask, coloured after
  const x0 = 26, x1 = W - 26, y0 = 26, y1 = plateH - 26, sx = (x1 - x0) / 22, sy = (y1 - y0) / 10;
  const near = (v: string, a: number, b: number, s: number) => `(${a}+${s.toFixed(3)}*round((clip(${v}\\,${a}\\,${b})-${a})/${s.toFixed(3)}))`;
  const nx = near("X", x0, x1, sx), ny = near("Y", y0, y1, sy);
  const d = `min(min(hypot(X-${nx}\\,Y-${y0})\\,hypot(X-${nx}\\,Y-${y1}))\\,min(hypot(X-${x0}\\,Y-${ny})\\,hypot(X-${x1}\\,Y-${ny})))`;
  parts.push(`color=c=black:s=${W}x${plateH},format=gray,geq=lum='255*max(clip(7-${d}\\,0\\,1)\\,0.62*exp(-pow(${d}\\,2)/162))'[m]`);
  parts.push(`[m]split[m1][m2]`);
  // (a kids' film: every bulb its own candy colour — pink, yellow, sky, round the frame — counted by the
  //  bulb it is, so each one is a single colour)
  const which = `mod(round((X-${x0})/${sx.toFixed(3)})+round((Y-${y0})/${sy.toFixed(3)})\\,3)`;
  const candy = (a: number, b: number, c: number) => `if(eq(${which}\\,0)\\,${a}\\,if(eq(${which}\\,1)\\,${b}\\,${c}))`;
  parts.push(spec.kind.kids
    ? `[m1]format=rgb24,geq=r='${candy(255, 255, 110)}':g='${candy(122, 214, 222)}':b='${candy(182, 77, 255)}'[c]`
    : `[m1]format=rgb24,lutrgb=r='255':g='150+val*0.37':b='38+val*0.66'[c]`);
  parts.push(`[c][m2]alphamerge[bulbs]`);
  parts.push(`[base][bulbs]overlay=0:${PH}:format=rgb[lit]`);
  // THE WORDS, centred in the plate: the billing, the title, the episode
  const e = episodeOf(spec.title);
  const fit = fitTitle(e.title, 640, FILM_LADDER);
  const bill = billingLine(spec.names, 640, 24);
  const ep = episodeLine(e, 640, 22);
  const lead = fit ? Math.round(fit.size * 1.12) : 0;
  const blockH = (bill ? 24 * CAP + 26 : 0) + (fit ? fit.size * CAP + lead * (fit.lines.length - 1) : 0) + (ep ? 26 + 22 * CAP : 0);
  let y = Math.round(PH + plateH / 2 - blockH / 2);
  const out: string[] = [];
  const mid = "(w-text_w)/2";
  if (bill) { y += Math.round(24 * CAP); out.push(words(spec.font, bill, 24, GOLD, mid, y)); y += 26; }
  if (fit) { y += Math.round(fit.size * CAP); out.push(...titleLines(spec.font, fit.lines, fit.size, "white", mid, y, lead, ":shadowcolor=black@0.6:shadowx=0:shadowy=2")); y += lead * (fit.lines.length - 1); }
  if (ep) { y += 26 + Math.round(22 * CAP); out.push(words(spec.font, ep, 22, GOLD, mid, y)); }
  parts.push(`[lit]${out.length ? `${out.join(",")},` : ""}format=yuvj444p[out]`);
  return parts.join(";");
}

/** A title and its episode: the series' name stays the title; the episode — number and name — is a line of
 *  its own in capitals ("EPISODE 2  ·  THE MENDED HULL"), cut to its box. */
export function episodeOf(t: string): { title: string; episode: string; episodeName: string } {
  const e = posterTitle(t);
  return e.episode ? e : { title: t, episode: "", episodeName: "" };
}
export function episodeLine(e: { episode: string; episodeName: string }, box: number, size: number): string {
  if (!e.episode) return "";
  const name = drawable(e.episodeName).toUpperCase();
  const full = name && canDraw(name) ? `${e.episode.toUpperCase()}  ·  ${name}` : e.episode.toUpperCase();
  return emWidth(full) * size <= box ? full : cutToFit(full, box / size);
}

/* HORROR — A BLACK ONE-SHEET. The picture drained of colour with blood in its shadows, crushed, grained and
 * vignetted; a deep black rising under a bone-white title in capitals, worn through in places and glowing
 * red behind; a thin red rule; three claw marks torn across the corner. */
export const HORROR_LADDER: Ladder = [[92, 1], [80, 2], [68, 2], [58, 2], [50, 3], [42, 3], [36, 3]];
/** How much a horror cover lifts its picture's middle tones: 1 for a picture of ordinary light (or one never
 *  measured), up to 1.45 for a dark one — so a face in a night scene still reads after the grade crushes it. */
export function horrorGamma(mean: number | undefined): number {
  if (mean == null || !Number.isFinite(mean)) return 1;
  return Math.round(Math.max(1, Math.min(1.45, 1 + (92 - mean) / 120)) * 100) / 100;
}
export function horrorGraph(spec: CoverSpec): string {
  const W = COVER_W, H = COVER_H, seed = (spec.seed ?? 7) % 99991;
  const p = spec.picture || { w: W, h: H, safe: { top: 0, bottom: 1 } };
  const parts: string[] = [];
  // (a frame that is dark already is lifted in its middle tones before it is crushed — a horror film's own
  //  night interior, graded as a lit one is, came out a black page with a face lost in it; its blacks stay black)
  const gamma = horrorGamma(p.mean);
  parts.push(`[0:v]${cropTo(p, W, H)},eq=contrast=1.32:brightness=-0.035:saturation=0.22${gamma !== 1 ? `:gamma=${gamma}` : ""},colorbalance=rs=0.17:gs=-0.05:bs=-0.08:rm=0.1:gm=-0.035:bm=-0.05,vignette=angle=PI/3.3,noise=alls=13:allf=t:all_seed=${seed},${foot(470, H - 470, 0.95, 0.9)}[bg]`);
  const e = episodeOf(spec.title);
  const fit = fitTitle(e.title, W - 120, HORROR_LADDER, true);
  const bill = billingLine(spec.names, W - 120, 22);
  const ep = episodeLine(e, W - 120, 22);
  const lead = fit ? Math.round(fit.size * 1.06) : 0;
  // from the bottom up: the episode, the title, the rule, the names
  const epBase = H - 58;
  const lastBase = ep ? epBase - 44 : H - 62;
  const firstBase = fit ? lastBase - lead * (fit.lines.length - 1) : lastBase;
  const titleTop = fit ? firstBase - Math.round(fit.size * CAP) : lastBase;
  const ruleY = titleTop - 30;
  const billBase = ruleY - 20;
  let last = "bg";
  if (fit) {
    // the title on its own layer: a red glow behind it, and the bone letters worn through in blotches
    const LH = Math.min(H, Math.round(firstBase + lead * (fit.lines.length - 1) + fit.size * 0.4 - (titleTop - 30)));
    const LY = titleTop - 30;
    const local = (y: number) => y - LY;
    const tl = (color: string) => titleLines(spec.font, fit.lines, fit.size, color, "(w-text_w)/2", local(firstBase), lead).join(",");
    parts.push(`color=c=black@0:s=${W}x${LH},format=rgba,${titleLines(spec.font, fit.lines, fit.size, "0xB0141A", "(w-text_w)/2", local(firstBase), lead, ":borderw=5:bordercolor=0xB0141A").join(",")},gblur=sigma=9[glow]`);
    parts.push(`color=c=black@0:s=${W}x${LH},format=rgba,${tl("0xEDE5D3")}[t]`);
    // (the wear: coarse noise drawn at a quarter of the size and enlarged — blotches a few pixels across, about
    //  one in eight of the letters' area — then cut hard. A fine noise blurred was tried first and LOOKED at:
    //  blurring narrows it, so almost nothing crossed the cut and the title came out clean.)
    parts.push(`color=c=gray:s=${Math.ceil(W / 4)}x${Math.ceil(LH / 4)},noise=alls=100:allf=u:all_seed=${seed + 1},format=gray,scale=${W}:${LH}:flags=bicubic,lut=y='if(gt(val\\,164)\\,24\\,255)'[wear]`);
    parts.push(`[t]split[t1][t2];[t2]alphaextract[ta];[ta][wear]blend=all_mode=multiply[tw];[t1][tw]alphamerge[tt]`);
    parts.push(`[bg][glow]overlay=0:${LY}:format=rgb[g1];[g1][tt]overlay=0:${LY}:format=rgb[g2]`);
    last = "g2";
  }
  const out: string[] = [];
  out.push(`drawbox=x=${W / 2 - 56}:y=${ruleY}:w=112:h=3:color=0xB3121E@1:t=fill`);
  if (bill) out.push(words(spec.font, bill, 22, "0xD9CFBA", "(w-text_w)/2", billBase));
  if (ep) out.push(words(spec.font, ep, 22, "0xC4262E", "(w-text_w)/2", epBase));
  parts.push(`[${last}]${out.join(",")}[h1]`);
  // THE MARK: three claw marks, tapered, torn down across the corner
  const S = 170, ang = 1.05, ca = Math.cos(ang).toFixed(4), sa = Math.sin(ang).toFixed(4);
  const u = `((X-${S / 2})*${ca}+(Y-${S / 2})*${sa})`, v = `(-(X-${S / 2})*${sa}+(Y-${S / 2})*${ca})`;
  const stroke = (o: number) => `clip((7*(1-pow(${u}/66\\,2))-abs(${v}-(${o})))\\,0\\,1)`;
  parts.push(`color=c=black:s=${S}x${S},format=gray,geq=lum='255*max(max(${stroke(-24)}\\,${stroke(0)})\\,${stroke(24)})*lt(abs(${u})\\,66)'[cm]`);
  parts.push(`color=c=0xB3121E:s=${S}x${S},format=rgb24[cc];[cc][cm]alphamerge[claw]`);
  parts.push(`[h1][claw]overlay=${W - S - 26}:22:format=rgb,format=yuvj444p[out]`);
  return parts.join(";");
}

/* MUSIC — A RECORD SLEEVE. The picture is the sleeve; the record slides out of it, its label gold (candy pink
 * for a kids' song); behind them the same picture, blurred and dimmed, gives every cover its own colour.
 * A music TRACK has no picture: its sleeve is its own sound — the wave of it, in gold. The title and who
 * sang a verse go under the sleeve. */
export const MUSIC_LADDER: Ladder = [[64, 1], [58, 2], [50, 2], [44, 2], [38, 3], [32, 3]];
const TRACK_FIELDS = ["0x0E3B2A", "0x3A1846", "0x10264A", "0x4A1414", "0x0B3B40", "0x2A2418"];
export function musicGraph(spec: CoverSpec): string {
  const W = COVER_W, H = COVER_H, SX = 40, SY = 60, S = 560, cx = SX + S, cy = SY + S / 2, R = 262, LR = 86;
  const parts: string[] = [];
  const track = !spec.picture;
  if (track) {
    const field = TRACK_FIELDS[(spec.seed ?? 0) % TRACK_FIELDS.length];
    parts.push(`[0:a]dynaudnorm=f=200:g=11,aformat=channel_layouts=mono,showwavespic=s=${S - 120}x${Math.round(S * 0.5)}:colors=${GOLD}[wave]`);
    parts.push(`color=c=${field}:s=${S}x${S},format=rgb24[field]`);
    // (a keyline round the sleeve, as a printed one has; the wave across its middle)
    parts.push(`[field][wave]overlay=60:${Math.round(S * 0.25)}:format=rgb,drawbox=x=26:y=26:w=${S - 52}:h=${S - 52}:color=${GOLD}@0.6:t=2[sleeve]`);
    parts.push(`color=c=${field}:s=${W}x${H},format=gbrp,geq=r='r(X\\,Y)*(1-0.7*Y/${H})':g='g(X\\,Y)*(1-0.7*Y/${H})':b='b(X\\,Y)*(1-0.7*Y/${H})'[bg]`);
  } else {
    const p = spec.picture!;
    // (a kids' song is lighter and brighter behind its sleeve: a nursery's pastels, blurred and dimmed like a
    //  club's neon, came out mud)
    const dim = spec.kind.kids ? 0.66 : 0.4;
    parts.push(`[0:v]setpts=PTS-STARTPTS,split[a][b]`);
    parts.push(`[a]${cropTo(p, W, H)},gblur=sigma=36,eq=saturation=${spec.kind.kids ? 2.1 : 1.45},lutrgb=r='val*${dim}':g='val*${dim}':b='val*${dim}'[bg]`);
    parts.push(`[b]${cropTo(p, S, S)}[sleeve]`);
  }
  // THE RECORD: grooves, two sheens, the label, the spindle hole
  const D = 2 * R + 2, c = R + 1;
  const dd = `hypot(X-${c}\\,Y-${c})`;
  parts.push(`color=c=black:s=${D}x${D},format=gray,geq=lum='13+10*gt(sin(${dd}*2.3)\\,0.72)+34*pow(abs(cos(2*atan2(Y-${c}\\,X-${c})-0.9))\\,10)*gt(${dd}\\,${LR + 6})'[vl]`);
  parts.push(`color=c=black:s=${D}x${D},format=gray,geq=lum='255*clip(${R}+0.5-${dd}\\,0\\,1)'[va]`);
  parts.push(`[vl]format=rgb24[vc];[vc][va]alphamerge[disc]`);
  const label = spec.kind.kids ? "0xFF7AB6" : "0xD8B048";
  const ld = `hypot(X-${LR - 0.5}\\,Y-${LR - 0.5})`;
  // (the label: its edge, a fine ring inside it, and the spindle hole through which the record shows)
  parts.push(`${shape(2 * LR, 2 * LR, label, `255*clip(${LR}+0.5-${ld}\\,0\\,1)*(1-0.25*between(${ld}\\,${LR - 14}\\,${LR - 11}))*clip(${ld}-7\\,0\\,1)`)}[label]`);
  // the sleeve's shadow, then the sleeve
  parts.push(`${shape(S + 80, S + 80, "black", `200*clip(1-hypot(max(abs(X-${(S + 79) / 2})-${S / 2 - 6}\\,0)\\,max(abs(Y-${(S + 79) / 2})-${S / 2 - 6}\\,0))/34\\,0\\,1)`)}[shadow]`);
  parts.push(`[bg][disc]overlay=${cx - c}:${cy - c}:format=rgb[d1];[d1][label]overlay=${cx - LR}:${cy - LR}:format=rgb[d2];[d2][shadow]overlay=${SX - 40 + 10}:${SY - 40 + 16}:format=rgb[d3];[d3][sleeve]overlay=${SX}:${SY}:format=rgb[d4]`);
  // the words under the sleeve
  const fit = fitTitle(spec.title, W - 2 * SX, MUSIC_LADDER);
  const bill = billingLine(spec.names, W - 2 * SX, 24);
  const out = wordBlock(spec.font, { bill, billColor: GOLD, billSize: 24, fit, color: "white", extra: ":shadowcolor=black@0.5:shadowx=0:shadowy=2", x: SX, top: SY + S + 12, bottom: H - 28 });
  parts.push(`[d4]${out.length ? `${out.join(",")},` : ""}format=yuvj444p[out]`);
  return parts.join(";");
}

/* AD — THE AD MAKER'S GREEN. The picture in a white card on the market green, rounded, lifted on a soft
 * shadow; a cream hang tag on its corner; the product's name in white under it, the presenter billed in cream. */
export const AD_LADDER: Ladder = [[62, 1], [56, 2], [48, 2], [42, 3], [36, 3]];
export function adGraph(spec: CoverSpec): string {
  const W = COVER_W, H = COVER_H, CX = 38, CY = 40, CW = 724, CH = 620, B = 12, PW = CW - 2 * B, PH = CH - 2 * B;
  const p = spec.picture || { w: PW, h: PH, safe: { top: 0, bottom: 1 } };
  const parts: string[] = [];
  parts.push(`color=c=black:s=${W}x${H},format=gbrp,geq=r='9+30*pow(1-Y/${H}\\,1.5)+8*(1-X/${W})':g='104+42*pow(1-Y/${H}\\,1.5)+10*(1-X/${W})':b='58+24*pow(1-Y/${H}\\,1.5)+6*(1-X/${W})'[bg]`);
  parts.push(`${shape(CW + 60, CH + 60, "black", `150*clip(1-hypot(max(abs(X-${(CW + 59) / 2})-${CW / 2 - 24}\\,0)\\,max(abs(Y-${(CH + 59) / 2})-${CH / 2 - 24}\\,0))/30\\,0\\,1)`)}[sh]`);
  parts.push(`${shape(CW, CH, "white", roundedAlpha(CW, CH, 30))}[card]`);
  parts.push(`[0:v]${cropTo(p, PW, PH)},format=rgba,geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='${roundedAlpha(PW, PH, 21)}'[pic]`);
  // THE HANG TAG: a cream tag with its hole, hung from the card's corner on a slant
  const T = 150;
  const tu = `((X-${T / 2})*0.8192+(Y-${T / 2})*0.5736)`, tv = `(-(X-${T / 2})*0.5736+(Y-${T / 2})*0.8192)`;
  const body = `clip(min(min(${tu}+40\\,58-${tu})\\,26-abs(${tv}))+0.5\\,0\\,1)`;
  const point = `clip(min(${tu}+60-abs(${tv})*0.77\\,-${tu}-38)+0.5\\,0\\,1)`;
  const hole = `clip(hypot(${tu}+30\\,${tv})-6.5\\,0\\,1)`;
  parts.push(`${shape(T, T, "0xF4F1E6", `255*max(${body}\\,${point})*${hole}`)}[tag]`);
  parts.push(`[bg][sh]overlay=${CX - 30}:${CY - 30 + 14}:format=rgb[a1];[a1][card]overlay=${CX}:${CY}:format=rgb[a2];[a2][pic]overlay=${CX + B}:${CY + B}:format=rgb[a3];[a3][tag]overlay=${CX + CW - 112}:${CY - 34}:format=rgb[a4]`);
  const fit = fitTitle(spec.title, W - 2 * 48, AD_LADDER);
  const bill = billingLine(spec.names, W - 2 * 48, 24);
  const out = wordBlock(spec.font, { bill, billColor: "0xF4F1E6", billSize: 24, fit, color: "white", extra: ":shadowcolor=0x06301B@0.6:shadowx=0:shadowy=2", x: 48, top: CY + CH + 8, bottom: H - 26 });
  parts.push(`[a4]${out.length ? `${out.join(",")},` : ""}format=yuvj444p[out]`);
  return parts.join(";");
}

/* CREATOR — A STICKER. A bright gradient (violet, rose, amber); the picture as a white-edged card, tilted
 * as if just stuck on; its name on a white label across the card's foot; a sparkle in the corner. */
export const CREATOR_LADDER: Ladder = [[54, 1], [48, 2], [42, 2], [36, 3], [32, 3]];
export function creatorGraph(spec: CoverSpec): string {
  const W = COVER_W, H = COVER_H, PW = 600, PH = 700, B = 16, CW = PW + 2 * B, CH = PH + 2 * B, A = -0.055;
  const p = spec.picture || { w: PW, h: PH, safe: { top: 0, bottom: 1 } };
  const parts: string[] = [];
  // violet → rose → amber, along the diagonal
  const t = `clip((X*0.55+Y)/${(W * 0.55 + H).toFixed(0)}\\,0\\,1)`;
  const two = (a: number, b: number, c: number) => `if(lt(${t}\\,0.5)\\,${a}+(${b - a})*${t}*2\\,${b}+(${c - b})*(${t}*2-1))`;
  parts.push(`color=c=black:s=${W}x${H},format=gbrp,geq=r='${two(92, 236, 255)}':g='${two(46, 64, 168)}':b='${two(232, 128, 64)}'[bg]`);
  // the card: the picture inside a white edge, a shadow under it, all turned a little
  const GW = CW + 80, GH = CH + 80;
  parts.push(`${shape(GW, GH, "black", `120*clip(1-hypot(max(abs(X-${(GW - 1) / 2})-${CW / 2 - 20}\\,0)\\,max(abs(Y-${(GH - 1) / 2 - 12})-${CH / 2 - 20}\\,0))/34\\,0\\,1)`)}[sh]`);
  parts.push(`${shape(CW, CH, "white", roundedAlpha(CW, CH, 40))}[edge]`);
  parts.push(`[0:v]${cropTo(p, PW, PH)},format=rgba,geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='${roundedAlpha(PW, PH, 26)}'[pic]`);
  parts.push(`[sh][edge]overlay=40:40:format=rgb[k1];[k1][pic]overlay=${40 + B}:${40 + B}:format=rgb,format=rgba[k2]`);
  // (the shadow layer's own alpha is kept through the overlays, so the turned card has soft edges)
  parts.push(`[k2]rotate=${A}:c=none:ow=rotw(${A}):oh=roth(${A})[card]`);
  parts.push(`[bg][card]overlay=${W / 2}-w/2:448-h/2:format=rgb[c1]`);
  // the sparkle: a four-pointed star, and a small one beside it
  const star = (n: number) => `255*clip(1.4-(pow(abs(X-${n / 2})/${n / 2}\\,0.5)+pow(abs(Y-${n / 2})/${n / 2}\\,0.5))*1.25\\,0\\,1)`;
  parts.push(`${shape(96, 96, "white", star(96))}[s1];${shape(44, 44, "white", star(44))}[s2]`);
  parts.push(`[c1][s1]overlay=${W - 132}:30:format=rgb[c2];[c2][s2]overlay=${W - 168}:112:format=rgb[c3]`);
  // the label: white, rounded, sized to the name
  const fit = fitTitle(spec.title, 600, CREATOR_LADDER);
  const out: string[] = [];
  let last = "c3";
  if (fit) {
    const lead = Math.round(fit.size * 1.12);
    const textW = Math.max(...fit.lines.map((l) => emWidth(l) * fit.size));
    const LW = Math.min(W - 40, Math.round(textW + 64)), LH = Math.round(fit.size * CAP + lead * (fit.lines.length - 1) + 52);
    // (across the card's foot, as if stuck on over it)
    const LX = Math.round((W - LW) / 2), LY = Math.min(H - LH - 30, 772);
    parts.push(`${shape(LW, LH, "white", roundedAlpha(LW, LH, Math.min(26, LH / 2)))}[lab]`);
    parts.push(`[c3][lab]overlay=${LX}:${LY}:format=rgb[c4]`);
    last = "c4";
    out.push(...titleLines(spec.font, fit.lines, fit.size, "0x14201A", "(w-text_w)/2", LY + 26 + Math.round(fit.size * CAP), lead));
  }
  parts.push(`[${last}]${out.length ? `${out.join(",")},` : ""}format=yuvj444p[out]`);
  return parts.join(";");
}

/* FOUND FOOTAGE — A CAMCORDER'S VIEWFINDER. The picture washed, grained and scan-lined; the four corner marks,
 * a red REC with the clock, the battery; the title in capitals over a dark foot, and in the corner the date
 * it was made, in the amber of an old date stamp. */
export const FOOTAGE_LADDER: Ladder = [[46, 1], [42, 2], [36, 2], [32, 3]];
export function footageGraph(spec: CoverSpec): string {
  const W = COVER_W, H = COVER_H, seed = (spec.seed ?? 11) % 99991, M = 38, L = 66, T = 5;
  const p = spec.picture || { w: W, h: H, safe: { top: 0, bottom: 1 } };
  const parts: string[] = [];
  parts.push(`[0:v]${cropTo(p, W, H)},eq=saturation=0.6:contrast=1.12:brightness=-0.02,colorbalance=gm=0.05:bm=0.02:gs=0.03,noise=alls=22:allf=t:all_seed=${seed},format=yuv444p,geq=lum='p(X\\,Y)*if(eq(mod(Y\\,4)\\,0)\\,0.82\\,1)':cb='p(X\\,Y)':cr='p(X\\,Y)',vignette=angle=PI/3.6,${foot(640, H - 640, 0.8, 1)}[bg]`);
  const box = (x: number, y: number, w: number, h: number, c = "white@0.92") => `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${c}:t=fill`;
  const out: string[] = [
    // the corner marks
    box(M, M, L, T), box(M, M, T, L), box(W - M - L, M, L, T), box(W - M - T, M, T, L),
    box(M, H - M - T, L, T), box(M, H - M - L, T, L), box(W - M - L, H - M - T, L, T), box(W - M - T, H - M - L, T, L),
    // the battery
    box(W - M - 96, M + 30, 56, 26, "white@0.92").replace(":t=fill", ":t=3"), box(W - M - 40, M + 38, 6, 10),
    box(W - M - 91, M + 35, 14, 16), box(W - M - 74, M + 35, 14, 16), box(W - M - 57, M + 35, 14, 16),
  ];
  const secs = Math.max(0, Math.round(spec.seconds || 0));
  const clock = `${String(Math.floor(secs / 3600)).padStart(2, "0")}:${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  out.push(words(spec.font, "REC", 30, "white", M + 64, M + 64, ":shadowcolor=black@0.6:shadowx=0:shadowy=2"));
  out.push(words(spec.font, clock, 26, "white", M + 140, M + 62, ":shadowcolor=black@0.6:shadowx=0:shadowy=2"));
  const fit = fitTitle(spec.title, W - 2 * (M + 22), FOOTAGE_LADDER, true);
  const stampBase = H - M - 34;
  if (spec.stamp && canDraw(spec.stamp)) out.push(words(spec.font, spec.stamp, 28, "0xFFB23F", `w-text_w-${M + 24}`, stampBase, ":shadowcolor=black@0.7:shadowx=2:shadowy=2"));
  if (fit) {
    const lead = Math.round(fit.size * 1.1);
    const firstBase = stampBase - 56 - lead * (fit.lines.length - 1);
    out.push(...titleLines(spec.font, fit.lines, fit.size, "white", M + 24, firstBase, lead, ":shadowcolor=black@0.7:shadowx=0:shadowy=3"));
  }
  parts.push(`[bg]${out.join(",")}[f1]`);
  // the red dot
  parts.push(`${shape(28, 28, "0xE5262E", "255*clip(13.5-hypot(X-13.5\\,Y-13.5)\\,0\\,1)")}[dot]`);
  parts.push(`[f1][dot]overlay=${M + 26}:${M + 40}:format=rgb,format=yuvj444p[out]`);
  return parts.join(";");
}
