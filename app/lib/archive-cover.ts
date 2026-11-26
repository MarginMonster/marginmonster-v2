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
import { ANIME_STYLES } from "./anime-styles.ts";

/** A cover is a poster's size: the shelf's own 4:5, twice a phone tile's width. */
export const COVER_W = POSTER_W;
export const COVER_H = POSTER_H;
/** The DESIGN's version. It is in every cover's file name (the renders route caches a file for a year, so a
 *  new design must be a new name) — raise it and every cover is asked for again, the old one shown meanwhile. */
export const COVER_V = 1;
/** …and each family's own: raise ONE family's and only its covers are drawn again (the others are not
 *  touched — their files, their names, their records). Ads and Creator videos are at 2: their first design
 *  (an app's own template) was turned down — "The ads and creator ones need rethought" — and the owner chose
 *  the redrawn A for both (2026-11-24), so any cover drawn in the first design is drawn again. */
export const COVER_VERSION: Readonly<Record<CoverFamily, number>> = { story: COVER_V, film: COVER_V, horror: COVER_V, music: COVER_V, ad: 2, creator: 2, footage: COVER_V };

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

/** The movie categories a film's name can begin with since 2026-11-25 ("Drama Film — …", "Sci-Fi Story — …":
 *  film-heroes.ts) — as a pattern. Horror and Moral were names before that and are spelled out where they are read. */
const GENRE_WORDS = "drama|comedy|thriller|action|romance|sci-fi|fantasy|mystery";
/** …and the anime styles' names since 2026-11-26 ("Dream Anime Story — …", "Neon City Anime Story — …": film-heroes.ts,
 *  built from anime-styles.ts) — read off the table, never copied, each escaped as the words it is. Every one is a told
 *  story, so a piece that says nothing about itself but its name is a "story". */
const ANIME_NAMES = ANIME_STYLES.map((s) => s.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

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
  // (the genres became movie categories on 2026-11-25 — film-heroes.ts: a "Comedy Story" is told, a "Comedy
  //  Film" acted; "Short …" is what a Drama was called before, and the Archive still holds those)
  if (kind === "narrated" || style === "NARRATED" || kind === "film" || style === "FILM" || new RegExp(`^(?:(moral|short|kids|${GENRE_WORDS}) story|${ANIME_NAMES})\\b`, "i").test(title)) return { family: "story", kids };
  // ACTED: the cast speak on camera — and the tests of it
  if (kind === "testmovie" || kind === "avatardialogue" || kind === "enginetest" || style === "TESTMOVIE" || style === "AVATARDIALOGUE" || style === "ENGINETEST"
    || new RegExp(`^(short|moral|${GENRE_WORDS}) film\\b|^kids cartoon\\b|^dialogue\\b|^engine test\\b`, "i").test(title)) return { family: "film", kids };
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
const KIND_PREFIX = new RegExp(`^(?:kids music video|music video|horror film|horror story|moral film|moral story|short film|short story|(?:${GENRE_WORDS}) (?:film|story)|${ANIME_NAMES}|kids cartoon|kids story|found footage|faceless video|commercial|anthem|product video|edited video|video|dialogue \\(actors\\)|dialogue · actors|skit|youtube video)\\s*[—–-]\\s*`, "i");

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
export const coverName = (media: string, piece: string, family: CoverFamily): string =>
  `${String(media || "").split(/[?#]/)[0].split("/").pop()!.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-zA-Z0-9_-]/g, "")}-${seedOf(`cover:${piece}`).toString(36)}-cover${COVER_VERSION[family] ?? COVER_V}.jpg`;

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
/** FAMILIES WHOSE DESIGN IS BEING REDRAWN: not asked for until it is (a held family's tile keeps the picture
 *  it had). None today. Ads and Creator videos were held while they were redrawn — the owner, seeing every
 *  family on a TEST page (2026-11-24): "The ads and creator ones need rethought" — until he chose, the same
 *  day, "A" for both (COVER_STYLE). The set stays, for the next family that is redrawn. */
export const COVER_HELD: ReadonlySet<string> = new Set<string>();

export function coverAsk(o: { kind: CoverKind | null; media: string | null | undefined; expired: boolean; poster: string | null; cover: { v: number } | null }): boolean {
  if (!o.kind || o.expired || !localMedia(o.media)) return false;
  if (COVER_HELD.has(o.kind.family)) return false;
  if (o.poster && posterIsCover(o.kind.family)) return false;
  return !o.cover || o.cover.v < (COVER_VERSION[o.kind.family] ?? COVER_V);
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
  /** how much of it is blown out, near white (a sun flare, a window) */
  bright?: number;
  /** the brightness along its top edge — a product photo's backdrop */
  edge?: number;
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
  let s = 0, s2 = 0, dark = 0, bright = 0, n = 0;
  for (let y = t; y <= b; y++) for (let x = x0; x < x0 + w; x++) { const v = gray[y * stride + x] || 0; s += v; s2 += v * v; if (v < 24) dark++; if (v > 242) bright++; n++; }
  const mean = s / Math.max(1, n);
  const spread = Math.sqrt(Math.max(0, s2 / Math.max(1, n) - mean * mean));
  // (a bar that is not the whole edge is not trusted below one row in twenty)
  const top = t / h >= 0.05 ? t / h : 0;
  const bottom = (h - 1 - b) / h >= 0.05 ? (b + 1) / h : 1;
  let es = 0, en = 0;
  for (let y = t; y < Math.min(b + 1, t + Math.max(1, Math.round(h * 0.06))); y++) for (let x = x0; x < x0 + w; x++) { es += gray[y * stride + x] || 0; en++; }
  return { top, bottom, mean, spread, dark: dark / Math.max(1, n), bright: bright / Math.max(1, n), edge: es / Math.max(1, en) };
}

/** How good a cover a candidate makes: bright enough to see, not blown out, with something in it (contrast),
 *  not mostly black, filling the frame (no bars) — and a little preference for the middle of the piece. */
export function frameScore(s: FrameStats, at = 0.5): number {
  const tall = s.bottom - s.top;
  if (tall < 0.25 || s.mean < 16) return 0;
  const light = s.mean < 55 ? (s.mean - 16) / 39 : s.mean > 200 ? Math.max(0, (245 - s.mean) / 45) : 1;
  const detail = Math.min(1, s.spread / 58);
  const middle = 1 - 0.25 * Math.min(1, Math.abs(at - 0.5) * 2);
  // (a frame half blown out by the sun had the most "contrast" of a commercial's six and was picked — 2026-11-24)
  const glare = 1 - Math.min(0.85, Math.max(0, (s.bright ?? 0) - 0.06) * 2.4);
  return Math.max(0, light) * (0.3 + 0.7 * detail) * (1 - 0.75 * s.dark) * Math.sqrt(tall) * middle * glare;
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
export type CoverPicture = { w: number; h: number; safe: { top: number; bottom: number }; /** its mean brightness (0–255), when it was measured */ mean?: number; /** …and along its top edge */ edge?: number };
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
  /** an ad's or a Creator video's design, A / B / C (else the one in use: COVER_STYLE) */
  style?: CoverStyle;
  /** an ad: the product's own photo (the next input after the picture) */
  packshot?: CoverPicture;
  /** a Creator video: which channel colour it wears (creatorChannel) */
  channel?: string;
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
const cropTo = (p: CoverPicture, w: number, h: number, focusY = FOCUS_Y, zoom = 1) => {
  const c0 = cropWindow(p, p.safe, w / h, focusY);
  // (punched in: the same window, `zoom` of its size, held a little above its middle — where a face is)
  const z = Math.max(0.5, Math.min(1, zoom));
  const cw = Math.max(2, Math.floor((c0.w * z) / 2) * 2), ch = Math.max(2, Math.floor((c0.h * z) / 2) * 2);
  const c = z < 1 ? { w: cw, h: ch, x: Math.max(0, Math.min(Math.round(p.w) - cw, Math.round(c0.x + (c0.w - cw) / 2))), y: Math.max(0, Math.min(Math.round(p.h) - ch, Math.round(c0.y + (c0.h - ch) * 0.4))) } : c0;
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

/* ---- ADS AND CREATOR VIDEOS, DRAWN AGAIN ----
 * The owner, seeing every family on a TEST page (2026-11-24): "The ads and creator ones need rethought". The
 * five he kept each look like a real object of their own world — a one-sheet, a marquee, a record sleeve, a
 * viewfinder. The first ad and Creator covers were an app's own template (a coloured ground, a framed card).
 * So each is drawn again as an object of ITS world — three ways each, side by side on a TEST page for him to
 * choose. HIS CHOICE (2026-11-24): "A" — the print ad for ads, the thumbnail for Creator videos (COVER_STYLE):
 *   AD       A · a print ad: the picture, a clean band with the product's name set big, its packshot lifted
 *                over the fold, the length as a player shows it
 *            B · a sponsored post: a feed card — the account, the picture, the button bar, the row of hearts
 *            C · a product spot: the product's own photo alone in a studio made of its colours, lit from above
 *   CREATOR  A · a thumbnail: the picture punched in, a huge hook in heavy outline, one word in yellow, tilted
 *            B · a short-video frame: the feed's rail of buttons, the caption, the progress line
 *            C · a channel template: one colour per kind of channel on every video of it, a slanted band with
 *                the hook, the channel's round badge */
export type CoverStyle = "A" | "B" | "C";
export const COVER_OPTIONS = {
  ad: [{ key: "A", name: "Print ad" }, { key: "B", name: "Sponsored post" }, { key: "C", name: "Product spot" }],
  creator: [{ key: "A", name: "Thumbnail" }, { key: "B", name: "Short-video frame" }, { key: "C", name: "Channel template" }],
} as const;
/** The option drawn for each — the owner's choice (2026-11-24: "A" for both). B and C stay drawable (a cover
 *  spec may name one), so a change of mind is this line and a version step (COVER_VERSION). */
export const COVER_STYLE: Readonly<{ ad: CoverStyle; creator: CoverStyle }> = { ad: "A", creator: "A" };

const INK = "0x14201A";
const GREEN = "0x0C7A46";
const even = (v: number) => Math.max(2, Math.floor(v / 2) * 2);

/** A length as a player shows it — "0:15", "1:02" ("" when it is not known). Digits only: no language. */
export function clockOf(seconds: number | undefined): string {
  const s = Math.round(Number(seconds) || 0);
  return s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "";
}

/** A play triangle, pointing right, filling a w×h layer (anti-aliased). */
const playAlpha = (w: number, h: number) => `255*clip((${w}-X)*${(h / 2 / w).toFixed(4)}-abs(Y-${(h - 1) / 2})+0.5\\,0\\,1)*clip(X+0.5\\,0\\,1)`;
/** How far (X,Y) is from the segment a→b — a stroke is drawn where this is under its half-width. */
const segDist = (ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const t = `clip(((X-${ax})*${dx}+(Y-${ay})*${dy})/${l2}\\,0\\,1)`;
  return `hypot(X-(${ax}+${dx}*${t})\\,Y-(${ay}+${dy}*${t}))`;
};
const strokeOf = (d: string, half: number) => `clip(${half}+0.5-${d}\\,0\\,1)`;
const union = (xs: string[]) => xs.reduce((a, b) => `max(${a}\\,${b})`);
/** A heart (the implicit curve), filled, centred at (cx,cy), r across. */
const heartIn = (cx: number, cy: number, r: number) => {
  const x = `((X-${cx})/${r})`, y = `((${cy}-Y)/${r}+0.2)`;
  return `lt(pow(${x}*${x}+${y}*${y}-1\\,3)-${x}*${x}*${y}*${y}*${y}\\,0)`;
};
/** A triangle, filled (inside when (X,Y) is on the same side of all three edges). */
const triIn = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
  const e = (x1: number, y1: number, x2: number, y2: number) => `((X-${x1})*${y2 - y1}-(Y-${y1})*${x2 - x1})`;
  const [d1, d2, d3] = [e(ax, ay, bx, by), e(bx, by, cx, cy), e(cx, cy, ax, ay)];
  return `max(gte(${d1}\\,0)*gte(${d2}\\,0)*gte(${d3}\\,0)\\,lte(${d1}\\,0)*lte(${d2}\\,0)*lte(${d3}\\,0))`;
};
/** A circle's coverage: filled, or (with `ring`) only its edge. */
const discIn = (cx: number, cy: number, r: number) => `clip(${r}+0.5-hypot(X-${cx}\\,Y-${cy})\\,0\\,1)`;
const ringIn = (cx: number, cy: number, r: number, half: number) => `clip(${half}+0.5-abs(hypot(X-${cx}\\,Y-${cy})-${r})\\,0\\,1)`;
/** A picture's crop scaled to w×h and cut to a circle (an avatar). */
const avatarOf = (src: string, p: CoverPicture, d: number, focusY: number) =>
  `${src}${cropTo(p, d, d, focusY)},format=rgba,geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='255*clip(${d / 2}+0.5-hypot(X-${(d - 1) / 2}\\,Y-${(d - 1) / 2})\\,0\\,1)'`;
/** Icons drawn twice their size from one mask and halved — their edges come out smooth. `mask` is a 0…1
 *  expression on a (2w)×(2h) layer; the result is a w×h layer of `color`. */
const iconLayer = (w: number, h: number, color: string, mask: string, label: string) => [
  `color=c=black:s=${w * 2}x${h * 2},format=gray,geq=lum='255*${mask}'[${label}m]`,
  `color=c=${color}:s=${w * 2}x${h * 2},format=rgb24[${label}c];[${label}c][${label}m]alphamerge,scale=${w}:${h}:flags=area[${label}]`,
];

/** A player's length chip — a dark pill, a play triangle, "0:15" — its right edge at `xr`, its top at `y`. */
function lengthChip(font: string, clock: string, xr: number, y: number, from: string, to: string): string[] {
  if (!clock) return [`[${from}]null[${to}]`];
  const size = 24, h = 42, w = Math.round(emWidth(clock) * size) + 62, x = xr - w;
  return [
    `${shape(w, h, "black", `0.58*${roundedAlpha(w, h, h / 2)}`)}[${to}p]`,
    `${shape(14, 16, "white", playAlpha(14, 16))}[${to}t]`,
    `[${from}][${to}p]overlay=${x}:${y}:format=rgb[${to}a];[${to}a][${to}t]overlay=${x + 18}:${y + 13}:format=rgb,${words(font, clock, size, "white", x + 42, y + 30)}[${to}]`,
  ];
}

/* AD · A — A PRINT AD. The picture as the ad's photograph; under it a clean paper band with a rule of the Ad
 * Maker's green, the product's name set big and sure in ink, the presenter above it; the product's own photo
 * lifted over the fold as a packshot; the length in the corner as a player shows it. */
export const PRINT_LADDER: Ladder = [[60, 1], [54, 2], [46, 2], [40, 3], [34, 3]];
function adPrintGraph(spec: CoverSpec): string {
  const W = COVER_W, H = COVER_H, HERO = 790, RULE = 6, PK = 196, B = 8, OW = PK + 2 * B;
  const p = spec.picture || { w: W, h: HERO, safe: { top: 0, bottom: 1 } };
  const pk = spec.packshot;
  const parts: string[] = [];
  parts.push(`[0:v]${cropTo(p, W, HERO)},eq=contrast=1.06:saturation=1.1,pad=${W}:${H}:0:0:color=0xFBFAF6,drawbox=x=0:y=${HERO}:w=${W}:h=${RULE}:color=${GREEN}@1:t=fill[p0]`);
  let last = "p0";
  if (pk) {
    const X0 = W - 40 - OW, Y0 = HERO - Math.round(OW / 2);
    parts.push(`${shape(OW + 60, OW + 60, "black", `105*clip(1-hypot(max(abs(X-${(OW + 59) / 2})-${OW / 2 - 16}\\,0)\\,max(abs(Y-${(OW + 59) / 2})-${OW / 2 - 16}\\,0))/26\\,0\\,1)`)}[pks]`);
    parts.push(`${shape(OW, OW, "white", roundedAlpha(OW, OW, 22))}[pkw]`);
    parts.push(`[1:v]${cropTo(pk, PK, PK, 0.5)},format=rgba,geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='${roundedAlpha(PK, PK, 15)}'[pk]`);
    parts.push(`[p0][pks]overlay=${X0 - 30}:${Y0 - 30 + 12}:format=rgb[p1];[p1][pkw]overlay=${X0}:${Y0}:format=rgb[p2];[p2][pk]overlay=${X0 + B}:${Y0 + B}:format=rgb[p3]`);
    last = "p3";
  }
  parts.push(...lengthChip(spec.font, clockOf(spec.seconds), W - 26, 26, last, "p4"));
  const box = pk ? W - 40 - OW - 40 - 40 : W - 80;
  const fit = fitTitle(spec.title, box, PRINT_LADDER);
  const bill = billingLine(spec.names, box, 22);
  const out = wordBlock(spec.font, { bill, billColor: GREEN, billSize: 22, fit, color: INK, x: 40, top: HERO + RULE, bottom: H - 4 });
  parts.push(`[p4]${out.length ? `${out.join(",")},` : ""}format=yuvj444p[out]`);
  return parts.join(";");
}

/* AD · B — A SPONSORED POST. A feed card: the account (the product's photo in a gold ring, the product's name,
 * the presenter or the length under it, the "…"), the picture, the button bar in the Ad Maker's green with its
 * arrow, and the row every feed has — a heart (red: liked), a bubble, a paper plane, the save mark. */
function adPostGraph(spec: CoverSpec): string {
  const W = COVER_W, H = COVER_H, HEAD = 92, IMG = 760, BAR = 60, AV = 58, ROW = H - HEAD - IMG - BAR;
  const p = spec.picture || { w: W, h: IMG, safe: { top: 0, bottom: 1 } };
  const pk = spec.packshot;
  const parts: string[] = [`color=c=white:s=${W}x${H},format=rgb24[bg]`];
  if (pk) {
    parts.push(`[0:v]${cropTo(p, W, IMG)}[img]`);
    parts.push(`${avatarOf("[1:v]", pk, AV, 0.45)}[av]`);
  } else {
    // (no photo of the product: the picture's own middle is the account's picture)
    parts.push(`[0:v]setpts=PTS-STARTPTS,split[s0][s1]`);
    parts.push(`[s0]${cropTo(p, W, IMG)}[img]`);
    parts.push(`${avatarOf("[s1]", p, AV, 0.4)}[av]`);
  }
  const R = AV + 10;
  parts.push(`${shape(R, R, "0xD8B048", `255*${ringIn((R - 1) / 2, (R - 1) / 2, R / 2 - 2.5, 1.6)}`)}[ring]`);
  parts.push(`[bg][img]overlay=0:${HEAD}:format=rgb[b1];[b1][ring]overlay=22:${(HEAD - R) / 2}:format=rgb[b2];[b2][av]overlay=27:${(HEAD - AV) / 2}:format=rgb[b3]`);
  // the row of a feed: drawn twice their size and halved
  const C = ROW, cy = C; // (centre line of the row, at twice the size)
  const heart = heartIn(92, cy, 25);
  const bubble = union([ringIn(212, cy, 23, 3.4), strokeOf(segDist(196, cy + 17, 186, cy + 30), 3.4)]);
  const plane = union([strokeOf(segDist(306, cy - 4, 360, cy - 26), 3.4), strokeOf(segDist(360, cy - 26, 336, cy + 26), 3.4), strokeOf(segDist(336, cy + 26, 306, cy - 4), 3.4), strokeOf(segDist(360, cy - 26, 326, cy + 6), 3.4)]);
  const bx = 2 * (W - 46);
  const save = union([strokeOf(segDist(bx - 17, cy - 25, bx + 17, cy - 25), 3.4), strokeOf(segDist(bx - 17, cy - 25, bx - 17, cy + 25), 3.4), strokeOf(segDist(bx + 17, cy - 25, bx + 17, cy + 25), 3.4), strokeOf(segDist(bx - 17, cy + 25, bx, cy + 11), 3.4), strokeOf(segDist(bx + 17, cy + 25, bx, cy + 11), 3.4)]);
  parts.push(...iconLayer(W, ROW, "0xFF3040", heart, "ih"));
  parts.push(...iconLayer(W, ROW, INK, union([bubble, plane, save]), "ii"));
  parts.push(`[b3][ih]overlay=0:${HEAD + IMG + BAR}:format=rgb[b4];[b4][ii]overlay=0:${HEAD + IMG + BAR}:format=rgb[b5]`);
  // the account's name, the line under it, the "…"; the button bar and its arrow (and the length, when known)
  // (under the name, the presenter when there is one — the length is on the button bar, never said twice)
  const name = fitTitle(spec.title, 560, [[28, 1]]);
  const sub = spec.names[0] ? billingLine(spec.names.slice(0, 1), 560, 20) : "";
  const out: string[] = [];
  if (name) out.push(words(spec.font, name.lines[0], 28, INK, 104, sub ? 46 : 57));
  if (sub) out.push(words(spec.font, sub, 20, "0x8E918F", 104, 74));
  out.push(words(spec.font, "•••", 26, "0x8E918F", W - 78, 52));
  out.push(`drawbox=x=0:y=${HEAD + IMG}:w=${W}:h=${BAR}:color=${GREEN}@1:t=fill`);
  out.push(words(spec.font, ">", 34, "white", W - 50, HEAD + IMG + 42));
  parts.push(`[b5]${out.join(",")}[b6]`);
  const clock = clockOf(spec.seconds);
  if (clock) {
    parts.push(`${shape(14, 16, "white", playAlpha(14, 16))}[bt]`);
    parts.push(`[b6][bt]overlay=26:${HEAD + IMG + 22}:format=rgb,${words(spec.font, clock, 24, "white", 50, HEAD + IMG + 39)},format=yuvj444p[out]`);
  } else parts.push(`[b6]format=yuvj444p[out]`);
  return parts.join(";");
}

/* AD · C — A PRODUCT SPOT. The product alone: its own photo (else the piece's best picture), its edges melted
 * into a studio of the photo's own backdrop colour — a light from above, the floor falling darker; under it a
 * gold rule, the presenter, the product's name, in ink or in white as the studio is light or dark.
 * (The studio was first spread from the WHOLE photo: a bottle's dark base smudged the floor grey and the
 *  photo's rectangle showed — 2026-11-24. Its backdrop is the colour along its top edge.) */
export const SPOT_LADDER: Ladder = [[54, 1], [48, 2], [42, 2], [36, 3]];
function adSpotGraph(spec: CoverSpec): string {
  const W = COVER_W, H = COVER_H;
  const own = !!spec.packshot;
  const p = spec.packshot || spec.picture || { w: 600, h: 600, safe: { top: 0, bottom: 1 } };
  const s = Math.min(600 / Math.max(1, p.w), 600 / Math.max(1, p.h));
  const pw = even(p.w * s), ph = even(p.h * s), cx = W / 2, cy = 450;
  const parts: string[] = [];
  parts.push(`[${own ? 1 : 0}:v]setpts=PTS-STARTPTS,split[k0][k1]`);
  // the studio: the photo's own backdrop (the colour along its top edge), lit from above, the floor darker
  const light = `(1+0.14*exp(-(pow(X-${cx}\\,2)+pow(Y-260\\,2))/180000))*(1-0.24*clip((Y-700)/300\\,0\\,1))`;
  parts.push(`[k0]crop=iw:max(2\\,ih*0.06):0:0,scale=1:1:flags=area,scale=${W}:${H}:flags=neighbor,format=gbrp,geq=r='clip(r(X\\,Y)*${light}\\,0\\,255)':g='clip(g(X\\,Y)*${light}\\,0\\,255)':b='clip(b(X\\,Y)*${light}\\,0\\,255)'[st]`);
  parts.push(`[k1]scale=${pw}:${ph}:flags=lanczos,setsar=1,format=rgba,geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='255*clip(min(min(X\\,W-1-X)\\,min(Y\\,H-1-Y))/36\\,0\\,1)'[pr]`);
  parts.push(`[st][pr]overlay=${cx - pw / 2}:${cy - ph / 2}:format=rgb[q2]`);
  parts.push(...lengthChip(spec.font, clockOf(spec.seconds), W - 26, 26, "q2", "q3"));
  // (ink or white by the studio's own brightness — its backdrop's, where the words stand)
  const dark = (p.edge ?? p.mean ?? 140) < 125;
  const fg = dark ? "white" : INK;
  const fit = fitTitle(spec.title, W - 120, SPOT_LADDER);
  const bill = billingLine(spec.names, W - 120, 22);
  // (the presenter in the studio's own text colour, a shade softer — green on an olive studio did not read)
  const out = [`drawbox=x=${cx - 40}:y=${cy + 300 + 26}:w=80:h=4:color=${GOLD}@1:t=fill`, ...wordBlock(spec.font, { bill, billColor: dark ? GOLD : `${INK}@0.72`, billSize: 22, fit, color: fg, x: "(w-text_w)/2", top: cy + 300 + 40, bottom: H - 18 })];
  parts.push(`[q3]${out.join(",")},format=yuvj444p[out]`);
  return parts.join(";");
}

/** THE WORD A THUMBNAIL LIGHTS UP: a number when the hook has one ("5", "3-INGREDIENT"), else its longest word
 *  (four letters or more) — the word the eye should land on. Its line and place in the line; null for none
 *  (a hook written without spaces is lit whole, never one glyph of it). */
export function hookWord(lines: ReadonlyArray<string>): { line: number; word: number } | null {
  const all = lines.flatMap((ln, line) => (hasWide(ln) && !/\s/.test(ln) ? [] : ln.split(" ").map((w, word) => ({ line, word, w }))));
  const digit = all.find((x) => /\p{N}/u.test(x.w));
  if (digit) return { line: digit.line, word: digit.word };
  let best: { line: number; word: number; n: number } | null = null;
  for (const x of all) {
    const n = (x.w.match(/\p{L}/gu) || []).length;
    if (n >= 4 && (!best || n > best.n)) best = { line: x.line, word: x.word, n };
  }
  return best ? { line: best.line, word: best.word } : null;
}

/** Lines of a hook, word by word (so one can be lit), each line centred on `cx`. */
function hookLines(font: string, lines: ReadonlyArray<string>, size: number, firstBase: number, lead: number, cx: number, lit: { line: number; word: number } | null, color: string, litColor: string, extra: string): string[] {
  const out: string[] = [];
  lines.forEach((ln, i) => {
    const ws = hasWide(ln) && !/\s/.test(ln) ? [ln] : ln.split(" ");
    const space = emWidth(" ") * size;
    const widths = ws.map((w) => emWidth(w) * size);
    let x = cx - (widths.reduce((a, b) => a + b, 0) + space * (ws.length - 1)) / 2;
    ws.forEach((w, k) => {
      out.push(words(font, w, size, lit && lit.line === i && lit.word === k ? litColor : color, Math.round(x), firstBase + i * lead, extra));
      x += widths[k] + space;
    });
  });
  return out;
}

/* CREATOR · A — A THUMBNAIL, the way creators make them to stop a thumb: the picture punched in and pushed —
 * colour up, crisp, the edges falling dark — and across its lower half the hook, huge, in capitals with a heavy
 * black outline and a drop shadow, one word in yellow, the whole of it tilted as if slapped on. */
export const THUMB_LADDER: Ladder = [[104, 2], [92, 2], [80, 3], [70, 3], [60, 3], [52, 3]];
function creatorThumbGraph(spec: CoverSpec): string {
  const W = COVER_W, H = COVER_H, A = -0.045;
  const p = spec.picture || { w: W, h: H, safe: { top: 0, bottom: 1 } };
  const parts: string[] = [`[0:v]${cropTo(p, W, H, FOCUS_Y, 0.86)},eq=saturation=1.42:contrast=1.14:brightness=0.02,unsharp=5:5:0.6,vignette=angle=PI/4.6[bg]`];
  const fit = fitTitle(spec.title, 720, THUMB_LADDER, true);
  if (!fit) return `${parts[0]};[bg]format=yuvj444p[out]`;
  const lead = Math.round(fit.size * 1.02), ow = Math.max(6, Math.round(fit.size * 0.1)), pad = Math.round(fit.size * 0.3);
  const LH = Math.round(fit.size * CAP + lead * (fit.lines.length - 1) + 2 * pad + fit.size * 0.3);
  const draw = hookLines(spec.font, fit.lines, fit.size, pad + Math.round(fit.size * CAP), lead, W / 2, hookWord(fit.lines), "white", "0xFFE135",
    `:borderw=${ow}:bordercolor=black:shadowcolor=black@0.55:shadowx=0:shadowy=${Math.round(fit.size * 0.08)}`);
  parts.push(`color=c=black@0:s=${W}x${LH},format=rgba,${draw.join(",")},rotate=${A}:c=none:ow=rotw(${A}):oh=roth(${A})[hook]`);
  parts.push(`[bg][hook]overlay=(W-w)/2:${Math.max(380, Math.min(H - LH - 20, Math.round(690 - LH / 2)))}:format=rgb,format=yuvj444p[out]`);
  return parts.join(";");
}

/* CREATOR · B — A SHORT-VIDEO FRAME: the picture as the feed shows it, darkening at the foot; on the right the
 * rail — the maker in a white ring with a red plus, a heart, a bubble, the share arrow, the turning record —
 * at the foot the caption (the maker's name, the title) and the thin progress line. */
export const SHORT_LADDER: Ladder = [[40, 2], [36, 2], [32, 3], [28, 3]];
function creatorShortGraph(spec: CoverSpec): string {
  const W = COVER_W, H = COVER_H, RX = 726, AV = 72;
  const p = spec.picture || { w: W, h: H, safe: { top: 0, bottom: 1 } };
  const parts: string[] = [`[0:v]setpts=PTS-STARTPTS,split=3[s0][s1][s2]`];
  parts.push(`[s0]${cropTo(p, W, H)},eq=saturation=1.12:contrast=1.05,${foot(600, 400, 0.78, 1.1)}[bg]`);
  parts.push(`${avatarOf("[s1]", p, AV, 0.35)}[av]`);
  const R = AV + 8;
  parts.push(`${shape(R, R, "white", `255*${discIn((R - 1) / 2, (R - 1) / 2, R / 2)}`)}[avr]`);
  parts.push(`${shape(30, 30, "0xFE2C55", `255*${discIn(14.5, 14.5, 15)}`)},drawbox=x=8:y=13:w=14:h=4:color=white@1:t=fill,drawbox=x=13:y=8:w=4:h=14:color=white@1:t=fill[plus]`);
  // the rail's three buttons, white on a soft shadow — drawn at twice their size (layer 240 × 560, centre x 120)
  const RW = 120, RH = 280, c = RW;
  const heart = heartIn(c, 80, 40);
  // (a speech bubble: an oval and its tail — a round with a stick read as a magnifier, 2026-11-24)
  const bubble = union([`lt(pow((X-${c})/42\\,2)+pow((Y-280)/36\\,2)\\,1)`, triIn(c - 28, 296, c - 4, 312, c - 46, 336)]);
  // (the share arrow: a shaft widening to the right, and its head)
  const share = union([`lt(abs(Y-470)\\,(X-${c - 36})*0.62)*gt(X\\,${c - 36})*lt(X\\,${c + 6})*lt(abs(Y-470)\\,26)`, `lt(abs(Y-470)\\,48-(X-${c + 6})*1.15)*gte(X\\,${c + 6})*lt(X\\,${c + 48})`]);
  const rail = union([heart, bubble, share]);
  parts.push(`color=c=black:s=${RW * 2}x${RH * 2},format=gray,geq=lum='255*${rail}'[rm]`);
  parts.push(`[rm]split[rm1][rm2]`);
  parts.push(`color=c=white:s=${RW * 2}x${RH * 2},format=rgb24[rc];[rc][rm1]alphamerge,scale=${RW}:${RH}:flags=area[rail]`);
  parts.push(`color=c=black:s=${RW * 2}x${RH * 2},format=rgb24[rs];[rs][rm2]alphamerge,scale=${RW}:${RH}:flags=area,colorchannelmixer=aa=0.45,gblur=sigma=4[rsh]`);
  // the turning record: a dark disc with a groove, the maker's picture at its middle
  parts.push(`${shape(60, 60, "0x161616", `255*${discIn(29.5, 29.5, 30)}`)}[rec]`);
  parts.push(`${shape(60, 60, "0x5A5A5A", `255*${ringIn(29.5, 29.5, 22, 0.9)}`)}[recg]`);
  parts.push(`${avatarOf("[s2]", p, 28, 0.35)}[recl]`);
  const top = 300, REC = top + 70 + 350;
  parts.push(`[bg][avr]overlay=${RX - R / 2}:${top - R / 2}:format=rgb[c1];[c1][av]overlay=${RX - AV / 2}:${top - AV / 2}:format=rgb[c2];[c2][plus]overlay=${RX - 15}:${top + AV / 2 - 10}:format=rgb[c3]`);
  parts.push(`[c3][rsh]overlay=${RX - RW / 2 + 2}:${top + 70 + 3}:format=rgb[c4];[c4][rail]overlay=${RX - RW / 2}:${top + 70}:format=rgb[c5]`);
  parts.push(`[c5][rec]overlay=${RX - 30}:${REC - 30}:format=rgb[c6a];[c6a][recg]overlay=${RX - 30}:${REC - 30}:format=rgb[c6b];[c6b][recl]overlay=${RX - 14}:${REC - 14}:format=rgb[c6]`);
  // the caption: the maker's name, then the title; the progress line under everything
  const fit = fitTitle(spec.title, 600, SHORT_LADDER);
  const who = spec.names[0] ? `@${drawable(spec.names[0]).replace(/\s+/g, "")}` : "";
  const out: string[] = [];
  const lead = fit ? Math.round(fit.size * 1.16) : 0;
  const lastBase = H - 52;
  const firstBase = fit ? lastBase - lead * (fit.lines.length - 1) : lastBase;
  if (who && canDraw(who)) out.push(words(spec.font, who, 30, "white", 32, firstBase - (fit ? Math.round(fit.size * CAP) : 0) - 22, ":shadowcolor=black@0.5:shadowx=0:shadowy=2"));
  if (fit) out.push(...titleLines(spec.font, fit.lines, fit.size, "white", 32, firstBase, lead, ":shadowcolor=black@0.5:shadowx=0:shadowy=2"));
  out.push(`drawbox=x=0:y=${H - 8}:w=${W}:h=4:color=white@0.32:t=fill`, `drawbox=x=0:y=${H - 8}:w=${Math.round(W * 0.34)}:h=4:color=white@1:t=fill`);
  parts.push(`[c6]${out.join(",")},format=yuvj444p[out]`);
  return parts.join(";");
}

/* CREATOR · C — A CHANNEL TEMPLATE: every video of one kind of channel wears ITS colour — facts yellow,
 * lists cyan, storytime violet, motivation orange, cooking red, a described video green, a talking head blue,
 * an edit pink — as a bar along the top, a slanted band across the lower third carrying the hook in black
 * capitals (its key word in white), and the channel's round badge with the title's first letter. */
export const CHANNEL_ACCENT: Readonly<Record<string, string>> = {
  facts: "0xFFD400", listicle: "0x22D3EE", storytime: "0xB57BFF", motivational: "0xFF7A2E", recipe: "0xFF4D6D",
  create: "0x4ADE80", talk: "0x60A5FA", edit: "0xF472B6",
};
/** Which channel colour a Creator piece wears: a faceless video's format, else what kind of Creator piece it is. */
export function creatorChannel(meta: unknown, body?: unknown): string {
  const m = objOf(meta), b = objOf(body);
  const style = (str(m.style) || str(b.style)).toUpperCase();
  if (str(m.kind) === "faceless" || style === "FACELESS") { const f = str(m.format).toLowerCase(); return CHANNEL_ACCENT[f] ? f : "facts"; }
  if (style === "VIDEO_EDIT") return "edit";
  if (style === "AI_AVATAR") return "talk";
  return "create";
}
export const CHANNEL_LADDER: Ladder = [[76, 2], [66, 2], [58, 3], [50, 3], [44, 3]];
function creatorChannelGraph(spec: CoverSpec): string {
  const W = COVER_W, H = COVER_H, S = 0.07;
  const accent = CHANNEL_ACCENT[spec.channel || ""] || CHANNEL_ACCENT.facts;
  const p = spec.picture || { w: W, h: H, safe: { top: 0, bottom: 1 } };
  const parts: string[] = [`[0:v]${cropTo(p, W, H)},eq=saturation=1.25:contrast=1.08,drawbox=x=0:y=0:w=${W}:h=12:color=${accent}@1:t=fill[bg]`];
  const fit = fitTitle(spec.title, 640, CHANNEL_LADDER, true);
  let last = "bg";
  const out: string[] = [];
  if (fit) {
    const lead = Math.round(fit.size * 1.04);
    const textH = Math.round(fit.size * CAP) + lead * (fit.lines.length - 1);
    const BH = textH + 2 * Math.round(fit.size * 0.5);
    const mid = 760; // the band's middle, where it crosses the cover's centre
    const top = Math.round(mid - BH / 2);
    // the band: a parallelogram rising to the right (its edges slope by S); its shadow under it
    const LH = BH + Math.round(W * S) + 4, y0 = Math.round(W * S); // (layer: the band at x=0 sits y0 lower than at x=W)
    const inside = `clip(Y-(${y0}-${S}*X)+0.5\\,0\\,1)*clip((${y0 + BH}-${S}*X)-Y+0.5\\,0\\,1)`;
    parts.push(`${shape(W, LH, "black", `120*${inside}`)},gblur=sigma=7[bsh]`);
    parts.push(`${shape(W, LH, accent, `255*${inside}`)}[band]`);
    const LY = top - Math.round(y0 / 2);
    parts.push(`[bg][bsh]overlay=8:${LY + 12}:format=rgb[d1];[d1][band]overlay=0:${LY}:format=rgb[d2]`);
    last = "d2";
    const firstBase = top + Math.round((BH - textH) / 2) + Math.round(fit.size * CAP);
    out.push(...hookLines(spec.font, fit.lines, fit.size, firstBase, lead, W / 2, hookWord(fit.lines), "0x111111", "white", ":borderw=3:bordercolor=0x111111"));
  }
  // the channel's badge: a black disc in a ring of its colour, the title's first letter
  const first = Array.from(billable(spec.title).replace(/^[^\p{L}\p{N}]+/u, ""))[0] || "";
  const D = 96;
  parts.push(`${shape(D, D, "0x111111", `255*${discIn((D - 1) / 2, (D - 1) / 2, D / 2)}`)}[bd]`);
  parts.push(`${shape(D, D, accent, `255*${ringIn((D - 1) / 2, (D - 1) / 2, D / 2 - 5, 3.2)}`)}[br]`);
  parts.push(`[${last}][bd]overlay=${W - D - 28}:${40}:format=rgb[e1];[e1][br]overlay=${W - D - 28}:${40}:format=rgb[e2]`);
  if (first && canDraw(first)) out.push(words(spec.font, first.toUpperCase(), 52, accent, `${W - D - 28 + D / 2}-text_w/2`, 40 + D / 2 + 19));
  parts.push(`[e2]${out.length ? `${out.join(",")},` : ""}format=yuvj444p[out]`);
  return parts.join(";");
}

const AD_DRAW: Record<CoverStyle, (s: CoverSpec) => string> = { A: adPrintGraph, B: adPostGraph, C: adSpotGraph };
const CREATOR_DRAW: Record<CoverStyle, (s: CoverSpec) => string> = { A: creatorThumbGraph, B: creatorShortGraph, C: creatorChannelGraph };
export function adGraph(spec: CoverSpec): string { return AD_DRAW[spec.style || COVER_STYLE.ad](spec); }
export function creatorGraph(spec: CoverSpec): string { return CREATOR_DRAW[spec.style || COVER_STYLE.creator](spec); }

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
