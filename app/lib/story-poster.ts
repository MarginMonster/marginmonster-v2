/* A POSTER FOR EVERY STORY FILM.
 *
 * The Archive showed a film as its first frame: whatever the first second happened to be — often a
 * picture with a caption card half drawn across it. The owner (2026-11-23): "we also need more thought
 * out big brain detail 'wows' like the 3d avatars and the presenter cast heroes being the avatars".
 * A film has a poster. So a story film makes one when it is made: its most "cast" picture, its title,
 * and who is in it — the way a film is billed.
 *
 *   · It costs nothing: one ffmpeg frame from a picture the story already has. No model is asked.
 *   · It is drawn 4:5, the shape the Archive's shelf shows every piece in — so nothing of it is cropped
 *     there (a 9:16 picture loses its top and bottom on the shelf; the words would go with them).
 *   · It is language-neutral: the story's own TITLE and its cast's NAMES, nothing else written ("Episode 2"
 *     is part of an episode's title already). A title no font here can draw gets no poster — never boxes.
 *   · It never fails a film: no poster → the shelf shows the first frame, as it always did.
 *
 * What looking at them taught (2026-11-24, real story pictures — seven drawn here, then the first one made
 * on the live site): a title set as big as it would go, on three lines, buried the people it was billing;
 * a foot of the app's green-black ink turned their faces green; two dozen sheets of it showed as stripes
 * on a pale sky; and sixty finer sheets of plain black still left a green cast, because each tiny blend
 * rounds. So a big size is for a SHORT title, and the foot is one true gradient, computed in RGB.
 *
 * Pure (no disk, no ffmpeg): the layout and the filter text. tests/story-poster.test.ts holds it. */
import { drawable, hasWide, presentIn, textWidth } from "./narrated-core.ts";

/** The poster: 4:5, twice the width of a shelf tile on a phone. */
export const POSTER_W = 800;
export const POSTER_H = 1000;
/** The foot's gradient: how far above the words it begins, how dark it is at the very bottom (0–1), and how
 *  quickly it gets there (under 1 = most of the darkening happens early, so the words sit on solid ground). */
export const POSTER_FOOT_RISE = 150;
export const POSTER_FOOT_DEPTH = 0.9;
export const POSTER_FOOT_CURVE = 0.8;
/** Side and bottom margins, and the film section's gold. */
const PAD = 56;
const GOLD = "0xE7C879";
/** What stands between two names, and between an episode's number and its name. */
const DOT = "  ·  ";

/** WHICH PICTURE: the one with the most of the story's cast in it — a poster shows its stars. The EARLIEST
 *  of those, so the poster is not the ending when an earlier picture shows as many. `visuals` are the
 *  scenes' picture descriptions, `names` the cast's names; `have[i]` says whether scene i has a picture. */
export function posterScene(visuals: ReadonlyArray<string>, names: ReadonlyArray<string>, have?: ReadonlyArray<boolean>): number {
  let best = -1, most = -1;
  visuals.forEach((v, i) => {
    if (have && !have[i]) return;
    const n = names.filter((nm) => !!nm && presentIn(nm, v || "")).length;
    if (n > most) { most = n; best = i; }
  });
  return best;
}

/** A film's title as a poster bills it: "The Week the Boat Didn't Come — Episode 2: The Mended Hull" is the
 *  title, with its episode — number and name — on a line of its own. */
export function posterTitle(title: string): { title: string; episode: string; episodeName: string } {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  const m = /^(.*?)\s*[—–-]\s*(?:Episode|Ep\.?)\s*(\d+)(?:\s*[:—–-]\s*(.+))?$/i.exec(t);
  return m && m[1].trim() ? { title: m[1].trim(), episode: `Episode ${m[2]}`, episodeName: (m[3] || "").trim() } : { title: t, episode: "", episodeName: "" };
}

/** The title's lines at `max` letters to a line: as few lines as it fits in (three at most), filled as
 *  evenly as they can be. Words are kept whole; a script written without spaces is cut by its glyphs.
 *  [] when it does not fit in three lines of this width. */
export function posterLines(text: string, max: number): string[] {
  const t = drawable(String(text || ""));
  if (!t) return [];
  const glyphs = hasWide(t) && !/\s/.test(t);
  const units = glyphs ? Array.from(t) : t.split(" ");
  const glue = glyphs ? "" : " ";
  const width = (a: string[]) => textWidth(a.join(glue));
  const total = width(units);
  for (let n = 1; n <= 3; n++) {
    // each line takes words until it holds its share of the whole (or the next word would not fit)
    const share = total / n;
    const lines: string[][] = [[]];
    for (const u of units) {
      const cur = lines[lines.length - 1];
      if (cur.length && lines.length < n && (width([...cur, u]) > max || width(cur) >= share)) lines.push([u]);
      else cur.push(u);
    }
    if (lines.every((l) => width(l) <= max)) return lines.map((l) => l.join(glue));
  }
  return [];
}

/** The sizes a title is tried at, largest first: [font size, letters to a line, lines it may take].
 *  A BIG size is for a short title — one line, or two; three lines only once the type is modest. */
export const POSTER_SIZES: ReadonlyArray<readonly [number, number, number]> = [
  [96, 11, 1], [84, 13, 2], [72, 15, 2], [62, 17, 2], [54, 20, 3], [46, 24, 3], [40, 28, 3], [36, 31, 3],
];

export type PosterLayout = { size: number; lines: string[]; episode: string; cast: string };

/** What goes on the poster — null when there is nothing to draw (no title at all). */
export function posterLayout(o: { title: string; cast?: ReadonlyArray<string> }): PosterLayout | null {
  const { title, episode, episodeName } = posterTitle(o.title);
  let size = 0;
  let lines: string[] = [];
  for (const [s, max, most] of POSTER_SIZES) {
    const l = posterLines(title, max);
    if (l.length && l.length <= most) { size = s; lines = l; break; }
  }
  if (!lines.length) {
    // longer than three lines of the smallest size: the smallest, cut at three lines with an ellipsis
    const [s, max] = POSTER_SIZES[POSTER_SIZES.length - 1];
    const words = drawable(title).split(" ").filter(Boolean);
    const out: string[] = [];
    let cur = "";
    let cut = false;
    for (const w of words) {
      if (cur && textWidth(`${cur} ${w}`) > max) {
        if (out.length === 2) { cut = true; break; }
        out.push(cur); cur = w;
      } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) out.push(cut ? `${cur.slice(0, Math.max(1, max - 1))}…` : cur);
    size = s; lines = out.slice(0, 3);
  }
  if (!lines.length) return null;
  // the billing: up to three names, in capitals, a dot between — cut so it never runs past the picture
  const names = (o.cast || []).map((n) => drawable(String(n || "")).toUpperCase()).filter(Boolean).filter((n, k, a) => a.indexOf(n) === k).slice(0, 3);
  let cast = names.join(DOT);
  while (names.length > 1 && textWidth(cast) > 38) { names.pop(); cast = names.join(DOT); }
  if (textWidth(cast) > 38) cast = "";
  const epName = drawable(episodeName).toUpperCase();
  const ep = episode ? (epName && textWidth(`${episode}${DOT}${epName}`) <= 40 ? `${episode.toUpperCase()}${DOT}${epName}` : episode.toUpperCase()) : "";
  return { size, lines, episode: ep, cast };
}

/** The ffmpeg filter chain for one poster frame: the picture cropped to 4:5, then the dress (below). */
export function posterFilters(layout: PosterLayout, font: string): string {
  return [`scale=${POSTER_W}:${POSTER_H}:force_original_aspect_ratio=increase`, `crop=${POSTER_W}:${POSTER_H}`, "setsar=1", posterDress(layout, font)].join(",");
}

/* AN ACTED FILM'S POSTER IS ITS CAST. A told story has a picture for every scene; an acted film's pictures
 * are wide two-shots — cropped to the shelf's shape, both faces would be cut in half. What it does have is
 * who the maker cast: their own portraits. So an acted film is billed with them — one fills the poster, two
 * stand side by side, three share it — under the same foot, rule, names and title. */

/** How many portraits a cast poster holds. */
export const POSTER_CAST_MAX = 3;

/** The -filter_complex graph for a poster made of `n` portraits (inputs 0…n-1), each cropped from its middle
 *  to its share of the frame — a portrait's face is in its middle. "" when there is nobody to show. */
export function castPosterGraph(n: number, layout: PosterLayout, font: string): string {
  const k = Math.max(0, Math.min(POSTER_CAST_MAX, Math.floor(n || 0)));
  if (!k) return "";
  // (the shares add up to the whole width: 800 → 400 + 400, or 267 + 267 + 266)
  const share = Math.floor(POSTER_W / k);
  const widths = Array.from({ length: k }, (_, i) => share + (i < POSTER_W - share * k ? 1 : 0));
  const parts = widths.map((w, i) => `[${i}:v]scale=${w}:${POSTER_H}:force_original_aspect_ratio=increase,crop=${w}:${POSTER_H},setsar=1[p${i}]`);
  const joined = k === 1 ? "[p0]" : `${widths.map((_, i) => `[p${i}]`).join("")}hstack=inputs=${k},`;
  return `${parts.join(";")};${joined}${posterDress(layout, font)}`;
}

/** THE DRESS: what is laid over an 800×1000 picture that is already there — a dark foot rising under the
 *  words, a gold rule, the billing, the title, the episode. `font` is a font file path. */
export function posterDress(layout: PosterLayout, font: string): string {
  const f = font.replace(/\\/g, "/").replace(/:/g, "\\:");
  const H = POSTER_H;
  const lineH = Math.round(layout.size * 1.1);
  const titleH = layout.lines.length * lineH;
  const episodeH = layout.episode ? 46 : 0;
  // from the bottom up: margin, episode, title, billing, rule
  const titleTop = H - PAD - episodeH - titleH;
  const castY = titleTop - 44;
  const ruleY = (layout.cast ? castY : titleTop) - 26;
  const out: string[] = [];
  // THE FOOT: one true gradient under the words, computed in RGB — every channel of a pixel is scaled by the
  // same factor, so the picture gets darker and keeps its colours. (Translucent sheets of black, stacked,
  // were tried first: sixty tiny blends each ROUND every channel, the brightness fell while the colour did
  // not, and the foot of the first live poster had a green cast — a grey blanket turned moss.)
  const from = Math.max(0, ruleY - POSTER_FOOT_RISE);
  const span = H - PAD - from;
  const keep = `(1-${POSTER_FOOT_DEPTH}*pow(clip((Y-${from})/${span},0,1),${POSTER_FOOT_CURVE}))`;
  out.push("format=gbrp", `geq=r='r(X,Y)*${keep}':g='g(X,Y)*${keep}':b='b(X,Y)*${keep}'`);
  out.push(`drawbox=x=${PAD}:y=${ruleY}:w=72:h=5:color=${GOLD}@1:t=fill`);
  const text = (s: string, size: number, color: string, y: number) =>
    `drawtext=expansion=none:fontfile='${f}':text='${s}':fontsize=${size}:fontcolor=${color}:shadowcolor=black@0.55:shadowx=0:shadowy=2:x=${PAD}:y=${y}`;
  if (layout.cast) out.push(text(layout.cast, 26, GOLD, castY));
  layout.lines.forEach((ln, i) => out.push(text(ln, layout.size, "white", titleTop + i * lineH)));
  if (layout.episode) out.push(text(layout.episode, 26, GOLD, H - PAD - 30));
  return out.join(",");
}

/** The poster's file name, beside the film's own: "nar-…-abc.mp4" → "nar-…-abc-poster.jpg" (one dot — the
 *  renders route serves nothing else). */
export const posterName = (videoFile: string): string => `${String(videoFile || "").replace(/\.[a-z0-9]+$/i, "").replace(/[^a-zA-Z0-9_-]/g, "")}-poster.jpg`;

/** A film's poster as its meta keeps it (`meta.poster`) — one of OUR render pictures, or nothing. */
export function posterOf(meta: unknown): string | null {
  let m: unknown = meta;
  if (typeof m === "string") { try { m = JSON.parse(m); } catch { return null; } }
  const p = m && typeof m === "object" && !Array.isArray(m) ? (m as { poster?: unknown }).poster : null;
  return typeof p === "string" && /^\/renders\/[a-zA-Z0-9_-]+-poster\.jpg$/.test(p) ? p : null;
}
