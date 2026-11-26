/* EVERY PICTURE FILLS ITS FRAME — no empty band, no doubled strip.
 *
 * 2026-11-26, the live still story "What His Hands Remember" (a Drama Story). Scene 1 — "WIDE: inside the bakery,
 * Humphrey stands small before the cast-iron oven…" — came back as the bakery drawn as a LANDSCAPE picture in the
 * middle of the tall frame, a strip of the same picture repeated above it, and the bottom THIRD an empty flat CREAM
 * band. Every check let it through: the panels look is only asked where the words describe two moments, the black-bar
 * check (cropdetect) sees black only, and the framed-panel check (story-picture.ts → framedIn) wants all four edges
 * flat. The film then showed it for eleven seconds, the still move pushing slowly into the cream.
 *
 * So the picture is MEASURED — no reader, no guess, no money: it is read small and grey (BAND_SIZE × BAND_SIZE), and
 * each edge is walked inward line by line.
 *   · AN EMPTY BAND is a run of lines from the edge that are each ONE flat colour (any colour: cream, white, grey,
 *     black) and all the SAME colour — and that ends in a STRAIGHT EDGE: the line after it leaves that colour across
 *     nearly the whole frame at once. A real dark sky, a white wall, a snowfield or fog is never both: it shades as it
 *     goes (so its lines drift from the edge's colour), and where it ends something pokes into it here and there — a
 *     roofline, a treetop, a head — never a ruler-straight cut from side to side.
 *   · A DOUBLED STRIP is a strip at an edge of what is left that is the strip right beside it again, line for line
 *     (the bakery's top 23% was its own next 23%). It must have something in it (a flat strip matches anything), and
 *     it must match far better there than a few lines further on (a curtain's folds or a forest's trunks are alike all
 *     the way down; a copy is alike in one place).
 * What is left is the picture's own CONTENT BOX. The thresholds were tuned on real pictures — the bakery, and every
 * story, film and portrait picture kept on this machine (1,518; each of the 75 it flags looked at: letterboxes, flat
 * bands, things on a plain ground — no full scene) — and on test draws made to be hard: see tests/full-frame.test.ts.
 * NOT caught by measuring (seen in test draws of the bakery): a second, DIFFERENT view stacked on the first, and a
 * cut-away model whose plain ground fills only a corner. The words at the source took those away (story-shots.ts →
 * frameShapeLine, story-picture.ts → PLACE_FULL_SIZE: 4 broken of 5 → 0 of 5), and the look already asks whether a
 * smaller picture sits along an edge (story-picture.ts → storyGrimePrompt, "inset").
 *
 * Pure: the caller reads the picture (ffmpeg → `scale=96:96:flags=area,format=gray`, one raw frame). */

export type BandSide = "top" | "bottom" | "left" | "right";
/** What was found at a picture's edges, and where its own content is. `box` is in fractions of the frame (0–1). */
export type FrameBand = {
  /** the edges that carry an empty band */
  sides: BandSide[];
  /** the edges (of what is left) that carry a strip of the picture drawn again */
  doubled: BandSide[];
  /** where the picture's own content sits, as fractions of the frame */
  box: { x: number; y: number; w: number; h: number };
  /** how much of that content a crop that COVERS the frame keeps (1 = all of it) */
  keeps: number;
  /** the frame's shape — what the redraw is told it fills */
  frame: "tall" | "wide" | "square";
  /** the picture's own size in pixels (the cover crop is cut from it) */
  size: { w: number; h: number };
  /** the band is a light plain GROUND the picture sits on — on all four sides, or lining another side too where the
   *  picture's own outline meets it at a slant (a scale model on a table): a design sheet's look, which no crop makes
   *  into one right picture (absent: a band straight across the frame) */
  ground?: true;
};

/** The size of the picture ffmpeg was given, from its own report of the input ("…Video: mjpeg …, 1536x2752 …"). */
export function pictureSize(ffmpegReport: string): { w: number; h: number } | null {
  const m = /Input #0[\s\S]*?Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(ffmpegReport || "");
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

/** The side of the small grey square the picture is read at. (96: a band of 3% is three lines.) */
export const BAND_SIZE = 96;
/** A line is FLAT when its lightest and darkest points are this close (0–255). */
export const BAND_FLAT = 6;
/** …and it is still the band's colour when its mean is this close to the edge line's. */
export const BAND_DRIFT = 4;
/** A band HOLDS its colour to its end: its last three lines are this close to the edge line's. */
export const BAND_HOLD = 2;
/** A band is at least this deep (a fraction of the frame). */
export const BAND_MIN = 0.03;
/** The band ENDS in a straight edge: on one of the next lines, this share of the points has left its colour… */
export const BAND_EDGE_SHARE = 0.75;
/** …by more than this. */
export const BAND_EDGE_STEP = 10;
/** The other band of a PAIR needs only this share. */
export const BAND_PAIR_EDGE = 0.2;
/** A plain GROUND round all four sides counts only when it is at least this light (0–255). */
export const BAND_LIGHT = 64;
/** A doubled strip is at least this deep, and matches its neighbour this closely (mean difference, 0–255)… */
export const STRIP_MIN = 0.06;
export const STRIP_MATCH = 6;
/** …and at most this share of how it matches a little further on — which must be a real difference (mean, 0–255). */
export const STRIP_RATIO = 0.2;
export const STRIP_APART = 12;
/** …and has something in it: the mean step between neighbouring points along its lines is at least this. */
export const STRIP_DETAIL = 6;

type Line = (k: number) => Uint8Array;

/** The lines of one side, edge first: `count` of them, each `len` points long. */
function sideLines(gray: Uint8Array, S: number, side: BandSide): { count: number; line: Line } {
  return {
    count: S,
    line: (k: number) => {
      const out = new Uint8Array(S);
      for (let i = 0; i < S; i++) {
        const x = side === "left" ? k : side === "right" ? S - 1 - k : i;
        const y = side === "top" ? k : side === "bottom" ? S - 1 - k : i;
        out[i] = gray[y * S + x];
      }
      return out;
    },
  };
}
const meanOf = (l: Uint8Array): number => { let s = 0; for (const v of l) s += v; return s / Math.max(1, l.length); };
const spreadOf = (l: Uint8Array): number => { let lo = 255, hi = 0; for (const v of l) { if (v < lo) lo = v; if (v > hi) hi = v; } return hi - lo; };

/** One edge, measured: how many lines deep its flat run of one colour goes, that colour, whether the run ENDS IN A
 *  STEP — it holds its colour to its last line (BAND_HOLD), and one of the next two lines (the first may be half band,
 *  half picture) is not flat or jumps to another colour: not a ground or a sky that slowly shaded out of it — and how
 *  much of those two lines has left the colour (the straight edge). */
export function edgeMeasure(gray: Uint8Array, side: BandSide, S = BAND_SIZE): { depth: number; colour: number; step: boolean; edge: number } {
  const { count, line } = sideLines(gray, S, side);
  const colour = (meanOf(line(0)) + meanOf(line(1))) / 2;
  let depth = 0;
  for (let k = 0; k < count; k++) {
    const l = line(k);
    if (spreadOf(l) > BAND_FLAT || Math.abs(meanOf(l) - colour) > BAND_DRIFT) break;
    depth = k + 1;
  }
  // (…its LAST line may be half band, half picture — still flat and near the colour when what the band meets is dark or
  //  plain — and then it is the edge, not the band: review of S14, a letterboxed night picture whose black band over a
  //  dark road ended in a line 2.3 off black, so the band never "held" and the cover kept a third of the frame black)
  const off = (k: number): number => Math.abs(meanOf(line(k)) - colour);
  if (depth > 3 && off(depth - 1) > BAND_HOLD && [2, 3, 4].every((j) => off(depth - j) <= BAND_HOLD)) depth--;
  let hold = 0;
  for (let k = Math.max(0, depth - 3); k < depth; k++) hold = Math.max(hold, Math.abs(meanOf(line(k)) - colour));
  let jump = false;
  for (let k = depth; k < Math.min(count, depth + 2); k++) { const l = line(k); if (spreadOf(l) > BAND_FLAT || Math.abs(meanOf(l) - colour) > 3 * BAND_DRIFT) jump = true; }
  const step = depth > 0 && hold <= BAND_HOLD && jump;
  let edge = 0;
  for (let k = depth; k < Math.min(count, depth + 2); k++) {
    const l = line(k);
    let off = 0;
    for (const v of l) if (Math.abs(v - colour) > BAND_EDGE_STEP) off++;
    edge = Math.max(edge, off / l.length);
  }
  return { depth, colour, step, edge };
}

/** The empty bands along the four sides: each one's depth in lines (0 = none). A side is a band when its flat run
 *  of one colour is at least BAND_MIN deep and ends in a step that is a straight edge (BAND_EDGE_SHARE of the next
 *  lines left its colour). A PAIR — the opposite sides both flat runs of the same colour and about the same depth —
 *  needs only one of its two edges straight: the other may end against picture of nearly its own tone (the music
 *  video still of 2026-11-22 with a mauve band top and bottom: under the bottom one, grey asphalt). */
export function bandDepths(gray: Uint8Array, S = BAND_SIZE): Record<BandSide, number> {
  const out: Record<BandSide, number> = { top: 0, bottom: 0, left: 0, right: 0 };
  const m = {} as Record<BandSide, ReturnType<typeof edgeMeasure>>;
  for (const side of ["top", "bottom", "left", "right"] as BandSide[]) m[side] = edgeMeasure(gray, side, S);
  const deep = (e: ReturnType<typeof edgeMeasure>): boolean => e.depth >= Math.ceil(S * BAND_MIN) && e.depth < S && e.step;
  const alone = (e: ReturnType<typeof edgeMeasure>): boolean => deep(e) && e.edge >= BAND_EDGE_SHARE;
  for (const [a, b] of [["top", "bottom"], ["left", "right"]] as Array<[BandSide, BandSide]>) {
    const pair = deep(m[a]) && deep(m[b]) && Math.abs(m[a].colour - m[b].colour) <= 4 * BAND_DRIFT
      && Math.min(m[a].depth, m[b].depth) >= 0.5 * Math.max(m[a].depth, m[b].depth)
      && Math.max(m[a].edge, m[b].edge) >= BAND_EDGE_SHARE && Math.min(m[a].edge, m[b].edge) >= BAND_PAIR_EDGE;
    if (pair || alone(m[a])) out[a] = m[a].depth;
    if (pair || alone(m[b])) out[b] = m[b].depth;
  }
  // …and A PICTURE SITTING ON A PLAIN GROUND (the place's design sheet copied — two views of the bakery on its pale studio
  // ground, a test draw of 2026-11-26 that the framed-panel check missed by a hair): all four sides a run of the SAME
  // light colour ending in a step, two lines deep at least and one opposite pair a band's depth — whatever the views'
  // own outlines are. Never a dark ground: a night picture darkens toward all four edges.
  const sides = ["top", "bottom", "left", "right"] as BandSide[];
  const shade = sides.reduce((a, s) => a + m[s].colour, 0) / 4;
  const ground = shade >= BAND_LIGHT && sides.every((s) => m[s].depth >= 2 && m[s].depth < S && m[s].step && Math.abs(m[s].colour - shade) <= 2 * BAND_DRIFT)
    && ((deep(m.top) && deep(m.bottom)) || (deep(m.left) && deep(m.right)));
  if (ground) for (const s of sides) out[s] = m[s].depth;
  return out;
}

/** The strip at the `from` end of the span [lo, hi) of lines that best matches the strip right beside it: its
 *  depth `t` in lines, how far it is from its neighbour (`match`, mean difference 0–255), that over how far it is from
 *  the strip a few lines further on (`ratio`), and how much detail it has across the frame (`detail`, the mean step
 *  between neighbouring points along its lines). `from` "start" = the strip sits at `lo`, its copy right after it;
 *  "end" = at `hi`, its copy right before it. Null when the span is too short to hold a strip and its copy. */
export function stripMeasure(gray: Uint8Array, axis: "rows" | "cols", lo: number, hi: number, from: "start" | "end", S = BAND_SIZE): { t: number; match: number; ratio: number; detail: number } | null {
  const at = (k: number, i: number): number => (axis === "rows" ? gray[k * S + i] : gray[i * S + k]);
  /** mean difference between the `t` lines from a and the `t` lines from b */
  const diff = (a: number, b: number, t: number): number => { let s = 0; for (let j = 0; j < t; j++) for (let i = 0; i < S; i++) s += Math.abs(at(a + j, i) - at(b + j, i)); return s / (t * S); };
  const detailOf = (a: number, t: number): number => { let s = 0; for (let j = 0; j < t; j++) for (let i = 1; i < S; i++) s += Math.abs(at(a + j, i) - at(a + j, i - 1)); return s / (t * (S - 1)); };
  let best: { t: number; match: number; ratio: number; detail: number } | null = null;
  for (let t = Math.ceil(S * STRIP_MIN); 2 * t <= hi - lo; t++) {
    const strip = from === "start" ? lo : hi - t;
    const copy = from === "start" ? lo + t : hi - 2 * t;
    const shift = Math.max(2, Math.round(t / 3));
    const further = from === "start" ? copy + shift : copy - shift;
    if (further < lo || further + t > hi) continue;
    const match = diff(strip, copy, t);
    // (a picture alike all the way down — a curtain's folds, a wall — matches a few lines on as well as beside: no copy)
    const apart = diff(strip, further, t);
    const ratio = apart >= STRIP_APART ? match / apart : 1;
    if (!best || ratio < best.ratio) best = { t, match, ratio, detail: detailOf(strip, t) };
  }
  return best;
}
/** Is there a doubled strip there? (Its depth in lines, else 0.) */
export function doubledStrip(gray: Uint8Array, axis: "rows" | "cols", lo: number, hi: number, from: "start" | "end", S = BAND_SIZE): number {
  const m = stripMeasure(gray, axis, lo, hi, from, S);
  return m && m.match <= STRIP_MATCH && m.ratio <= STRIP_RATIO && m.detail >= STRIP_DETAIL ? m.t : 0;
}

/** The share of a content box (`cw` × `ch` pixels) a crop to the frame's shape (`W` × `H`) keeps. */
export function coverKeeps(cw: number, ch: number, W: number, H: number): number {
  if (!(cw > 0 && ch > 0 && W > 0 && H > 0)) return 0;
  const A = W / H;
  return cw / ch > A ? (ch * A) / cw : cw / A / ch;
}

/** What is at the picture's edges. `gray` is the picture read at S × S (one byte a point, rows top to bottom);
 *  `W` × `H` its real size. Null when there is no band and no doubled strip — or nothing to read. */
export function frameBand(gray: Uint8Array, W: number, H: number, S = BAND_SIZE): FrameBand | null {
  if (!gray || gray.length < S * S || !(W > 0 && H > 0)) return null;
  const all = ["top", "bottom", "left", "right"] as BandSide[];
  const depth = bandDepths(gray, S);
  const sides = all.filter((s) => depth[s] > 0);
  // THE SAME PLAIN GROUND ON ANOTHER SIDE (a test draw of the bakery, 2026-11-26: the room drawn as a cut-away model, a
  // cream band straight across the top — and the same cream under the model's slanted base at the bottom, no straight
  // edge to it, so no band of its own; cut to the top band alone it still stood on its ground). A light band's colour
  // lining another side too, two lines deep and ending in a step, is the same ground: cut off with it, and the picture is
  // a picture on a ground — never called right by a crop.
  const m = Object.fromEntries(all.map((s) => [s, edgeMeasure(gray, s, S)])) as Record<BandSide, ReturnType<typeof edgeMeasure>>;
  const light = sides.filter((s) => m[s].colour >= BAND_LIGHT);
  const lined = all.filter((s) => !depth[s] && m[s].depth >= 2 && m[s].depth < S && m[s].step && light.some((b) => Math.abs(m[b].colour - m[s].colour) <= 2 * BAND_DRIFT));
  for (const s of lined) { depth[s] = m[s].depth; sides.push(s); }
  sides.sort((a, b) => all.indexOf(a) - all.indexOf(b));
  const ground = lined.length > 0 || (light.length === 4);
  // what is left — a band's own edge line is half band, half picture: it is left out too
  let y0 = depth.top ? depth.top + 1 : 0, y1 = depth.bottom ? S - depth.bottom - 1 : S;
  let x0 = depth.left ? depth.left + 1 : 0, x1 = depth.right ? S - depth.right - 1 : S;
  if (y1 - y0 < S * 0.2 || x1 - x0 < S * 0.2) return null;     // nothing much left: not a band round a picture
  // (…and a doubled strip one line more than it measured: where it meets its copy is not on a line of the small read)
  const doubled: BandSide[] = [];
  const top = doubledStrip(gray, "rows", y0, y1, "start", S);
  if (top) { doubled.push("top"); y0 += top + 1; }
  const bottom = doubledStrip(gray, "rows", y0, y1, "end", S);
  if (bottom) { doubled.push("bottom"); y1 -= bottom + 1; }
  const left = doubledStrip(gray, "cols", x0, x1, "start", S);
  if (left) { doubled.push("left"); x0 += left + 1; }
  const right = doubledStrip(gray, "cols", x0, x1, "end", S);
  if (right) { doubled.push("right"); x1 -= right + 1; }
  if (!sides.length && !doubled.length) return null;
  const box = { x: x0 / S, y: y0 / S, w: (x1 - x0) / S, h: (y1 - y0) / S };
  const r = W / H;
  return { sides, doubled, box, keeps: coverKeeps(box.w * W, box.h * H, W, H), frame: r < 0.9 ? "tall" : r > 1.1 ? "wide" : "square", size: { w: W, h: H }, ...(ground ? { ground: true as const } : {}) };
}

/* WHAT A BAND COSTS, AND WHAT IS DONE ABOUT IT.
 * A picture with a band is drawn again, told what was wrong (bandFix). It weighs among its other faults (story-picture.ts →
 * storyFaults) what a split picture weighs — it cannot be shown as it is — unless a crop that COVERS the frame from its
 * own content keeps most of what was drawn (COVER_MOST): then it is a thin band the crop cuts off at no cost, and it
 * weighs 1, so a picture with nothing else wrong but a sliver of black at its top is kept before one with a stranger in it.
 *
 * THE RULE AFTER THE LAST GO: a picture that still has a band is never shown with it. It is cropped to its own content —
 * the band and the doubled strip cut off — and that content's MIDDLE, at the frame's shape, is scaled to cover the frame
 * (coverCrop). When that keeps most of the content (≥ COVER_MOST), the picture is simply right, a little closer. When it
 * keeps less — a landscape inside a tall frame: the bakery kept 36% — it is still covered (a narrow middle is a picture;
 * a cream band is a broken one), and the scene stays FLAGGED with its fault, so the storyboard offers the redraw. It is
 * only ever kept when every go came back worse. */
export const COVER_MOST = 0.6;
export const BAND_FAULT = 4;
export const BAND_TRIM_FAULT = 1;
/** Does cutting it off leave a right picture? — most of the content kept, and not a picture on a plain ground (that is a
 *  sheet's look: its middle is still a model or views on a ground). */
export const bandCuttable = (b: FrameBand | null | undefined): boolean => !!b && b.keeps >= COVER_MOST && !b.ground;
export const bandFault = (b: FrameBand | null | undefined): number => (!b ? 0 : bandCuttable(b) ? BAND_TRIM_FAULT : BAND_FAULT);

/** The crop that covers a `W` × `H` frame from the picture's own content: the middle of the content box at the frame's
 *  shape, in whole even pixels, inside the box. (Scaled back up to `W` × `H` by the caller.) */
export function coverCrop(b: Pick<FrameBand, "box">, W: number, H: number): { w: number; h: number; x: number; y: number } {
  const bx = b.box.x * W, by = b.box.y * H, bw = b.box.w * W, bh = b.box.h * H;
  const A = W / H;
  const even = (v: number): number => Math.max(2, 2 * Math.floor(v / 2));
  const w = even(bw / bh > A ? bh * A : bw);
  const h = even(bw / bh > A ? bh : bw / A);
  // (the box already leaves out a line of the small read past each band and strip — about 1% — so a pixel either way is nothing)
  const x = 2 * Math.round((bx + (bw - w) / 2) / 2), y = 2 * Math.round((by + (bh - h) / 2) / 2);
  return { w: Math.min(w, W), h: Math.min(h, H), x: Math.max(0, Math.min(x, W - w)), y: Math.max(0, Math.min(y, H - h)) };
}

/** What the next go is told about a picture that came back with a band or a doubled strip — in plain words, which edge,
 *  and the frame it fills ("" when there is neither). */
export function bandFix(b: FrameBand | null | undefined): string {
  if (!b || (!b.sides.length && !b.doubled.length)) return "";
  const along = (sides: BandSide[], band: boolean): string => {
    const has = (s: BandSide) => sides.includes(s);
    if (has("top") && has("bottom")) return band ? "across the top and the bottom" : "along the top and the bottom";
    if (has("left") && has("right")) return band ? "down both sides" : "along both sides";
    return sides.map((s) => (s === "top" || s === "bottom" ? `${band ? "across" : "along"} the ${s}` : `down the ${s} side`)).join(" and ");
  };
  const band = b.ground ? "set the picture on an empty plain ground, like a model on a design sheet" : b.sides.length ? `left an empty band ${along(b.sides, true)}` : "";
  const what = [band, b.doubled.length ? `drew a strip of the picture twice, ${along(b.doubled, false)}` : ""].filter(Boolean).join(" and ");
  const all = [...b.sides, ...b.doubled];
  const tb = all.some((s) => s === "top" || s === "bottom"), lr = all.some((s) => s === "left" || s === "right");
  const span = tb && lr ? "edge to edge" : tb ? "top to bottom" : "side to side";
  return `The last try ${what} — draw ONE picture that fills the whole ${b.frame} frame, ${span}${b.doubled.length ? ", nothing in it drawn twice" : ""}`;
}
