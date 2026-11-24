/* HOW WIDE A WORD IS — a font's own measurements, read straight out of the .ttf / .otf file.
 *
 * A lyric video places every word by itself (so each can land on its own beat), and a row of words is
 * sized to fill the frame exactly. That needs the real width of every letter, not a guess per character:
 * "ILL" and "MOM" are both three letters. The file already holds the numbers — the advance of each glyph
 * (`hmtx`), which glyph a character is (`cmap`), and the font's own scale (`head`, `hhea`, `OS/2`) — and
 * they are a few fixed-layout tables, so they are read here with no library.
 *
 * Kerning is not read: a row measured here is within a per cent or two of what the subtitle renderer
 * draws, which a row's side margins absorb.
 *
 * THE SUBTITLE RENDERER'S SIZE IS NOT THE EM. libass sizes a font the way the old Windows renderer did:
 * the size asked for is the height of the font's OS/2 "win" box (usWinAscent + usWinDescent), not its em
 * square. So text asked for at size S is drawn with an em of S ÷ `box`, where `box` is that height in
 * ems — which is why this file reads the OS/2 table at all. Pure, so it is tested. */

export type FontMetrics = {
  /** font units to an em */
  unitsPerEm: number;
  /** the height of the OS/2 "win" box in ems — the subtitle renderer's size ÷ this = the em it draws */
  box: number;
  /** the top and the bottom of that box, in ems above / below the baseline */
  top: number; bottom: number;
  /** the height of a capital letter in ems */
  cap: number;
  /** the advance of one character in ems (a character the font does not have: the advance of glyph 0) */
  advance: (codePoint: number) => number;
  /** true when the font has a glyph for the character */
  has: (codePoint: number) => boolean;
};

/** Read a font file's measurements — or null when the bytes are not a font this reader understands. */
export function readFontMetrics(file: Uint8Array): FontMetrics | null {
  try {
    const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
    const tag = dv.getUint32(0);
    // (a collection holds several fonts: the first one is read)
    const start = tag === 0x74746366 /* ttcf */ ? dv.getUint32(12) : 0;
    const kind = dv.getUint32(start);
    if (kind !== 0x00010000 && kind !== 0x4f54544f /* OTTO */ && kind !== 0x74727565 /* true */) return null;
    const n = dv.getUint16(start + 4);
    const tables = new Map<string, { off: number; len: number }>();
    for (let i = 0; i < n; i++) {
      const p = start + 12 + i * 16;
      const name = String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3));
      tables.set(name, { off: dv.getUint32(p + 8), len: dv.getUint32(p + 12) });
    }
    const head = tables.get("head"), hhea = tables.get("hhea"), hmtx = tables.get("hmtx"), cmap = tables.get("cmap");
    if (!head || !hhea || !hmtx || !cmap) return null;
    const unitsPerEm = dv.getUint16(head.off + 18);
    if (!unitsPerEm) return null;
    const hAsc = dv.getInt16(hhea.off + 4), hDesc = dv.getInt16(hhea.off + 6);
    const nH = dv.getUint16(hhea.off + 34);
    if (!nH) return null;
    const os2 = tables.get("OS/2");
    let winAsc = 0, winDesc = 0, capH = 0;
    if (os2 && os2.len >= 78) {
      winAsc = dv.getUint16(os2.off + 74); winDesc = dv.getUint16(os2.off + 76);
      if (dv.getUint16(os2.off) >= 2 && os2.len >= 90) capH = dv.getInt16(os2.off + 88);
    }
    // (a font with no OS/2 box is sized by its hhea line, as the renderer does)
    const top = (winAsc + winDesc > 0 ? winAsc : hAsc) / unitsPerEm;
    const bottom = (winAsc + winDesc > 0 ? winDesc : -hDesc) / unitsPerEm;
    if (!(top + bottom > 0)) return null;

    // ---- which glyph a character is: the widest Unicode map the file has ----
    const nMaps = dv.getUint16(cmap.off + 2);
    let best = -1, bestRank = -1;
    for (let i = 0; i < nMaps; i++) {
      const p = cmap.off + 4 + i * 8;
      const plat = dv.getUint16(p), enc = dv.getUint16(p + 2), off = cmap.off + dv.getUint32(p + 4);
      const fmt = dv.getUint16(off);
      const rank = fmt === 12 && ((plat === 3 && enc === 10) || plat === 0) ? 3 : fmt === 4 && ((plat === 3 && enc === 1) || plat === 0) ? 2 : -1;
      if (rank > bestRank) { bestRank = rank; best = off; }
    }
    if (best < 0) return null;
    const fmt = dv.getUint16(best);
    let glyphOf: (cp: number) => number;
    if (fmt === 12) {
      const groups = dv.getUint32(best + 12);
      const g = best + 16;
      glyphOf = (cp) => {
        let lo = 0, hi = groups - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1, p = g + mid * 12;
          const a = dv.getUint32(p), b = dv.getUint32(p + 4);
          if (cp < a) hi = mid - 1; else if (cp > b) lo = mid + 1; else return dv.getUint32(p + 8) + (cp - a);
        }
        return 0;
      };
    } else {
      const segs = dv.getUint16(best + 6) / 2;
      const ends = best + 14, starts = ends + segs * 2 + 2, deltas = starts + segs * 2, ranges = deltas + segs * 2;
      glyphOf = (cp) => {
        if (cp > 0xffff) return 0;
        let lo = 0, hi = segs - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (dv.getUint16(ends + mid * 2) < cp) lo = mid + 1; else hi = mid; }
        const s = dv.getUint16(starts + lo * 2);
        if (s > cp || dv.getUint16(ends + lo * 2) < cp) return 0;
        const delta = dv.getInt16(deltas + lo * 2), ro = dv.getUint16(ranges + lo * 2);
        if (!ro) return (cp + delta) & 0xffff;
        const at = ranges + lo * 2 + ro + (cp - s) * 2;
        if (at + 2 > dv.byteLength) return 0;
        const gid = dv.getUint16(at);
        return gid ? (gid + delta) & 0xffff : 0;
      };
    }
    const advanceOfGlyph = (gid: number): number => dv.getUint16(hmtx.off + Math.min(gid, nH - 1) * 4) / unitsPerEm;
    // (a font that names no cap height: the height of its H is not in these tables — seven tenths of the
    //  em is where nearly every text face puts its capitals)
    const cap = capH > 0 ? capH / unitsPerEm : 0.7;
    return {
      unitsPerEm, box: top + bottom, top, bottom, cap,
      advance: (cp) => advanceOfGlyph(glyphOf(cp)),
      has: (cp) => glyphOf(cp) !== 0,
    };
  } catch { return null; }
}

/** The width of a run of text in ems (no kerning). */
export function textEms(m: FontMetrics, text: string): number {
  let w = 0;
  for (const ch of text) w += m.advance(ch.codePointAt(0) || 32);
  return w;
}

/** Can the font draw every letter and digit of the text? (Spaces and marks it lacks are not a reason to
 *  give up on a face; a missing LETTER is — it would be drawn as an empty box.) */
export function canDraw(m: FontMetrics, text: string): boolean {
  for (const ch of text) if (/[\p{L}\p{N}]/u.test(ch) && !m.has(ch.codePointAt(0) || 0)) return false;
  return true;
}
