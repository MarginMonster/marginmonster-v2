/* Black bars baked into a generated frame — and not mistaking a dark edge for one.
 * The numbers are ffmpeg cropdetect's on real master frames from 2026-11-17. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { letterboxCrop, parseCropdetect } from "../app/lib/letterbox.ts";

const FRAME = { w: 1344, h: 768 };
const stderrFor = (crop: string) => `Input #0, image2, from 'x.jpg':
  Stream #0:0: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 1344x768 [SAR 1:1 DAR 7:4], 25 fps, 25 tbr, 25 tbn
[Parsed_cropdetect_0 @ 000001] x1:0 x2:1343 y1:66 y2:699 w:1344 h:634 x:0 y:66 pts:0 t:0.000000 limit:0.094118 crop=1344:768:0:0
[Parsed_cropdetect_0 @ 000001] x1:0 x2:1343 y1:66 y2:699 w:1344 h:634 x:0 y:66 pts:1 t:0.040000 limit:0.094118 ${crop}`;

test("cropdetect's output is read: frame size and the LAST crop it settled on", () => {
  assert.deepEqual(parseCropdetect(stderrFor("crop=1344:634:0:66")), { frame: FRAME, crop: { w: 1344, h: 634, x: 0, y: 66 } });
  assert.equal(parseCropdetect("no video here"), null);
});

test("a frame with bars above and below is cropped to the picture", () => {
  // the master that came back letterboxed: 66 px of black on top, 68 px underneath
  assert.deepEqual(letterboxCrop(FRAME, { w: 1344, h: 634, x: 0, y: 66 }), { w: 1344, h: 634, x: 0, y: 66 });
});

test("a frame that is only dark along one edge is left alone", () => {
  // a night-kitchen master whose right-hand 52 px were a dark doorway
  assert.equal(letterboxCrop(FRAME, { w: 1292, h: 768, x: 0, y: 0 }), null);
  // two stray pixels
  assert.equal(letterboxCrop(FRAME, { w: 1342, h: 768, x: 2, y: 0 }), null);
  // nothing to crop at all
  assert.equal(letterboxCrop(FRAME, { w: 1344, h: 768, x: 0, y: 0 }), null);
  // dark top only (a ceiling in shadow) — not a letterbox
  assert.equal(letterboxCrop(FRAME, { w: 1344, h: 690, x: 0, y: 78 }), null);
});

test("lopsided or enormous 'bars' are not treated as a letterbox", () => {
  // 120 px on top, 20 px below: a dark composition, not bars
  assert.equal(letterboxCrop(FRAME, { w: 1344, h: 628, x: 0, y: 120 }), null);
  // more than a third of the frame gone: something else is wrong — don't zoom into it
  assert.equal(letterboxCrop(FRAME, { w: 1344, h: 460, x: 0, y: 154 }), null);
});

test("pillar bars are handled the same way, and only the barred dimension is cropped", () => {
  assert.deepEqual(letterboxCrop(FRAME, { w: 1144, h: 760, x: 100, y: 4 }), { w: 1144, h: 768, x: 100, y: 0 });
});
