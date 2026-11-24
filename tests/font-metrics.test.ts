/* HOW WIDE A WORD IS — a font's own measurements, read from the file (app/lib/font-metrics.ts).
 *
 * A lyric video places every word by itself and sizes each row to fill the frame, so the width of a word has to be
 * the width the subtitle renderer will draw. Two kinds of check here: the real face the app draws in (Poppins Bold)
 * against what libass actually drew (measured 2026-11-24: ffmpeg 8.1's ass filter, words at known sizes on black,
 * the white pixels' box), and a tiny font built here byte by byte, so every table the reader touches is pinned. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canDraw, readFontMetrics, textEms } from "../app/lib/font-metrics.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const poppins = () => readFontMetrics(new Uint8Array(fs.readFileSync(path.join(root, "public", "fonts", "Poppins-Bold.ttf"))));

test("Poppins Bold: its own scale, and the renderer's box", () => {
  const m = poppins();
  assert.ok(m, "the face is read");
  assert.equal(m.unitsPerEm, 1000);
  // the OS/2 "win" box: 1135 above the baseline, 627 below — libass sizes a font by this, not by the em
  assert.ok(Math.abs(m.top - 1.135) < 1e-9 && Math.abs(m.bottom - 0.627) < 1e-9, `${m.top} ${m.bottom}`);
  assert.ok(Math.abs(m.box - 1.762) < 1e-9);
  assert.ok(Math.abs(m.cap - 0.705) < 1e-9, "the cap height named in OS/2");
});

test("Poppins Bold: the width it predicts is the width libass draws", () => {
  const m = poppins()!;
  // [text, size asked for, the ink libass drew in pixels, the capitals' ink height] — measured, 2026-11-24
  const drawn: Array<[string, number, number, number]> = [
    ["HELLO WORLD", 100, 386, 41],
    ["MOM", 160, 227, 65],
    ["ILL", 160, 105, 64],
    ["WWWWWW", 120, 426, 48],
    ["AVATAR TOWER", 110, 496, 45],
  ];
  for (const [text, size, ink, capInk] of drawn) {
    const advance = (textEms(m, text) * size) / m.box;
    // the advance includes the first and last letters' side bearings: never less than the ink, a little more
    assert.ok(advance >= ink && advance <= ink + 12, `${text} @${size}: predicted ${advance.toFixed(1)} px, drawn ${ink}`);
    const cap = (m.cap * size) / m.box;
    assert.ok(Math.abs(cap - capInk) <= 1.5, `${text}: capitals ${cap.toFixed(1)} px, drawn ${capInk}`);
  }
  // the point of reading the file: three letters are not one width
  assert.ok(textEms(m, "MOM") > textEms(m, "ILL") * 1.9);
  assert.ok(textEms(m, "") === 0);
});

test("can the face draw it: a missing LETTER is a reason to change face, a missing mark is not", () => {
  const m = poppins()!;
  assert.equal(canDraw(m, "Late night, city lights!"), true);
  assert.equal(canDraw(m, "Ça va, Zoë? Señor."), true, "Latin with accents");
  assert.equal(canDraw(m, "城市的灯光"), false, "Chinese needs its own face");
  assert.equal(canDraw(m, "a ♪ b"), true, "a symbol the face lacks is not a letter");
  assert.equal(m.has("A".codePointAt(0)!), true);
  assert.equal(m.has("城".codePointAt(0)!), false);
  // a character it lacks is as wide as glyph 0 — never zero (zero would pile words on each other)
  assert.ok(m.advance("城".codePointAt(0)!) > 0);
});

/* ---- a font built by hand: head, hhea, hmtx, OS/2 and cmap, nothing else ---- */
function buildFont(o: { upm: number; winAsc: number; winDesc: number; hAsc: number; hDesc: number; capH?: number; os2: boolean; advances: number[]; map: Array<[number, number]>; fmt: 4 | 12 }): Uint8Array {
  const tables: Record<string, Uint8Array> = {};
  const head = new DataView(new ArrayBuffer(54)); head.setUint16(18, o.upm); tables.head = new Uint8Array(head.buffer);
  const hhea = new DataView(new ArrayBuffer(36)); hhea.setInt16(4, o.hAsc); hhea.setInt16(6, o.hDesc); hhea.setUint16(34, o.advances.length); tables.hhea = new Uint8Array(hhea.buffer);
  const hmtx = new DataView(new ArrayBuffer(o.advances.length * 4)); o.advances.forEach((a, i) => hmtx.setUint16(i * 4, a)); tables.hmtx = new Uint8Array(hmtx.buffer);
  if (o.os2) {
    const os2 = new DataView(new ArrayBuffer(96)); os2.setUint16(0, o.capH ? 2 : 0); os2.setUint16(74, o.winAsc); os2.setUint16(76, o.winDesc); if (o.capH) os2.setInt16(88, o.capH);
    tables["OS/2"] = new Uint8Array(os2.buffer);
  }
  let sub: DataView;
  if (o.fmt === 12) {
    sub = new DataView(new ArrayBuffer(16 + o.map.length * 12));
    sub.setUint16(0, 12); sub.setUint32(4, sub.byteLength); sub.setUint32(12, o.map.length);
    o.map.forEach(([cp, gid], i) => { sub.setUint32(16 + i * 12, cp); sub.setUint32(20 + i * 12, cp); sub.setUint32(24 + i * 12, gid); });
  } else {
    // one segment per mapped character (idDelta = gid - cp), then the closing 0xFFFF segment
    const segs = [...o.map.map(([cp, gid]) => ({ s: cp, e: cp, d: (gid - cp) & 0xffff })), { s: 0xffff, e: 0xffff, d: 1 }];
    const n = segs.length;
    sub = new DataView(new ArrayBuffer(16 + n * 8));
    sub.setUint16(0, 4); sub.setUint16(2, sub.byteLength); sub.setUint16(6, n * 2);
    segs.forEach((g, i) => { sub.setUint16(14 + i * 2, g.e); sub.setUint16(16 + n * 2 + i * 2, g.s); sub.setUint16(16 + n * 4 + i * 2, g.d); sub.setUint16(16 + n * 6 + i * 2, 0); });
  }
  const cmap = new DataView(new ArrayBuffer(12 + sub.byteLength));
  cmap.setUint16(2, 1); cmap.setUint16(4, 3); cmap.setUint16(6, o.fmt === 12 ? 10 : 1); cmap.setUint32(8, 12);
  new Uint8Array(cmap.buffer).set(new Uint8Array(sub.buffer), 12);
  tables.cmap = new Uint8Array(cmap.buffer);
  const names = Object.keys(tables);
  let off = 12 + names.length * 16;
  const out = new Uint8Array(off + names.reduce((s, k) => s + tables[k].length + 4, 0));
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x00010000); dv.setUint16(4, names.length);
  names.forEach((k, i) => {
    const p = 12 + i * 16;
    for (let c = 0; c < 4; c++) dv.setUint8(p + c, k.charCodeAt(c));
    dv.setUint32(p + 8, off); dv.setUint32(p + 12, tables[k].length);
    out.set(tables[k], off);
    off += tables[k].length + 4;
  });
  return out;
}

test("a hand-made font: the box from OS/2, the advances from hmtx, glyphs through a format-4 map", () => {
  const f = buildFont({ upm: 2048, winAsc: 2000, winDesc: 600, hAsc: 1800, hDesc: -400, capH: 1400, os2: true, advances: [512, 1024, 2048], map: [[65, 1], [66, 2], [67, 5]], fmt: 4 });
  const m = readFontMetrics(f)!;
  assert.ok(m, "read");
  assert.equal(m.unitsPerEm, 2048);
  assert.ok(Math.abs(m.box - 2600 / 2048) < 1e-9 && Math.abs(m.cap - 1400 / 2048) < 1e-9);
  assert.equal(m.advance(65), 0.5, "A → glyph 1");
  assert.equal(m.advance(66), 1, "B → glyph 2");
  // glyph 5 is past the last advance hmtx lists: it takes the last one, as the format says
  assert.equal(m.advance(67), 1);
  assert.equal(m.advance(90), 0.25, "a character with no glyph is glyph 0");
  assert.equal(m.has(65), true);
  assert.equal(m.has(90), false);
  assert.equal(textEms(m, "AB"), 1.5);
  assert.equal(canDraw(m, "ABC"), true);
  assert.equal(canDraw(m, "ABZ"), false);
});

test("a hand-made font: a format-12 map (every plane), and no OS/2 — sized by its hhea line", () => {
  const f = buildFont({ upm: 1000, winAsc: 0, winDesc: 0, hAsc: 900, hDesc: -300, os2: false, advances: [100, 600], map: [[0x1f600, 1]], fmt: 12 });
  const m = readFontMetrics(f)!;
  assert.ok(m);
  assert.ok(Math.abs(m.box - 1.2) < 1e-9 && Math.abs(m.top - 0.9) < 1e-9 && Math.abs(m.bottom - 0.3) < 1e-9);
  assert.equal(m.advance(0x1f600), 0.6, "a character beyond the first plane");
  assert.equal(m.cap, 0.7, "no cap height named: seven tenths of the em");
});

test("bytes that are not a font are not read — and never throw", () => {
  assert.equal(readFontMetrics(new Uint8Array(0)), null);
  assert.equal(readFontMetrics(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])), null);
  assert.equal(readFontMetrics(new TextEncoder().encode("<html>not a font</html>".padEnd(64, " "))), null);
  // a real font cut short
  const real = fs.readFileSync(path.join(root, "public", "fonts", "Poppins-Bold.ttf"));
  assert.equal(readFontMetrics(new Uint8Array(real.subarray(0, 200))), null);
});
