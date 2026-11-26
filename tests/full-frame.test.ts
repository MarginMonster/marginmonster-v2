/* EVERY STORY PICTURE FILLS ITS FRAME — no empty band, no doubled strip (app/lib/full-frame.ts).
 *
 * 2026-11-26, the live still story "What His Hands Remember": scene 1's picture was the bakery drawn as a landscape
 * across the middle of the tall frame, a strip of it repeated above and the bottom third an empty flat CREAM band — and
 * every check kept it. The band is now MEASURED: flat lines of one colour from an edge, holding that colour to their end
 * and ending in a straight edge; a strip that is its neighbour again, line for line. Tested here on synthetic pictures of
 * every kind (bands of several colours and sizes at each edge; dark and bright scenes with none), and on the small grey
 * reads of REAL pictures (tests/full-frame-reads.json): the bakery itself, test draws of its scene, and test draws made to
 * be hard — a night sky, a white wall, a snowfield, fog, a black-clothed back, a pitch-dark room — which must pass. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  BAND_FAULT, BAND_SIZE, BAND_TRIM_FAULT, COVER_MOST, bandCuttable, bandDepths, bandFault, bandFix, coverCrop, coverKeeps,
  edgeMeasure, frameBand, pictureSize, stripMeasure, type BandSide, type FrameBand,
} from "../app/lib/full-frame.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => fs.readFileSync(path.join(here, "..", ...p), "utf8").replace(/\r\n/g, "\n");
const S = BAND_SIZE;

/* ---- synthetic pictures, read as the check reads them: S × S grey ---- */
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
/** a fixed speckle, 0–16 */
const noise = (x: number, y: number) => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 17;
/** a busy, textured scene: things everywhere, 40–200 */
const scene = (x: number, y: number) => clamp(120 + 45 * Math.sin(x / 4.3 + y / 9) + 25 * Math.cos(y / 3.7 + x / 11) + noise(x, y) - 8);
function pic(f: (x: number, y: number) => number): Uint8Array {
  const g = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) g[y * S + x] = clamp(f(x, y));
  return g;
}
/** a band of `colour`, `d` lines deep, along `side`, over the scene */
const inBand = (side: BandSide, d: number, x: number, y: number) =>
  side === "top" ? y < d : side === "bottom" ? y >= S - d : side === "left" ? x < d : x >= S - d;
const banded = (side: BandSide, d: number, colour: number) => pic((x, y) => (inBand(side, d, x, y) ? colour : scene(x, y)));
const TALL = { w: 1536, h: 2752 };

test("a flat band of ANY colour at ANY edge is found — cream, white, grey, black; thin, deep and a third of the frame", () => {
  for (const colour of [228, 250, 128, 2]) {
    for (const side of ["top", "bottom", "left", "right"] as BandSide[]) {
      for (const d of [4, 10, 30]) {
        const b = frameBand(banded(side, d, colour), TALL.w, TALL.h);
        assert.ok(b, `${colour} ${side} ${d}`);
        assert.deepEqual(b.sides, [side], `${colour} ${side} ${d}`);
        assert.deepEqual(b.doubled, [], `${colour} ${side} ${d}`);
        // the content box leaves the band out — and the line where the band meets the picture
        const cut = (d + 1) / S;
        const near = (a: number, e: number) => Math.abs(a - e) < 1e-9;
        if (side === "top") assert.ok(near(b.box.y, cut) && near(b.box.h, 1 - cut));
        if (side === "bottom") assert.ok(b.box.y === 0 && near(b.box.h, 1 - cut));
        if (side === "left") assert.ok(near(b.box.x, cut) && near(b.box.w, 1 - cut));
        if (side === "right") assert.ok(b.box.x === 0 && near(b.box.w, 1 - cut));
      }
    }
  }
  // …and a band whose LAST line of the small read is half band, half picture — still flat and near the band's colour
  //  because what it meets is dark (review of S14: a letterboxed night picture, its black bottom bar over a dark road,
  //  was read as banded at the top only, and the cover kept the bottom bar — a third of the frame black)
  const road = (x: number, y: number) => 14 + 30 * ((x + y) % 9 === 0 ? 1 : 0) + noise(x, y);
  const half = pic((x, y) => (y < 28 ? 0 : y >= S - 28 ? 0 : y === S - 29 ? 3 : y < 40 ? scene(x, y) : road(x, y)));
  const hb = frameBand(half, TALL.w, TALL.h);
  assert.deepEqual(hb?.sides, ["top", "bottom"], "both bars, the half line taken as the edge");
  assert.ok(hb && hb.box.y + hb.box.h <= (S - 29) / S + 1e-9, "the cover leaves the half line out too");
  // …two lines (2%) is not a band yet; three is
  assert.equal(frameBand(banded("bottom", 2, 228), TALL.w, TALL.h), null);
  assert.ok(frameBand(banded("bottom", 3, 228), TALL.w, TALL.h));
});

test("dark and bright scenes with no band pass: a night sky, a white wall, a snowfield, fog, a black-clothed back", () => {
  // a NIGHT SKY over a ragged treeline: near-black, a few stars, a faint glow toward the horizon
  const night = pic((x, y) => {
    const tree = 44 + 7 * Math.sin(x / 3.1) + 5 * Math.cos(x / 1.7);
    if (y < tree) return 6 + y * 0.18 + (noise(x, y) === 16 && y % 7 === 3 ? 70 : 0);
    return 18 + noise(x, y) + (y > 70 ? 10 * Math.sin(x / 5) : 0);
  });
  assert.equal(frameBand(night, TALL.w, TALL.h), null, "a night sky");
  // the same sky with NO stars, shading slowly toward the horizon: its flat run drifts out of its colour — no step
  const plain = pic((x, y) => (y < 50 ? 4 + y * 0.12 : y < 53 ? 9 + y * 0.12 : scene(x, y) * 0.3));
  assert.equal(frameBand(plain, TALL.w, TALL.h), null, "a starless sky shading to the horizon");
  // a WHITE WALL filling the top half, a figure in a black coat standing against it
  const wall = pic((x, y) => (y < 60 ? (x > 34 && x < 60 && y > 30 ? 12 + noise(x, y) / 4 : 238) : 150 + noise(x, y) * 2 - y / 3));
  assert.equal(frameBand(wall, TALL.w, TALL.h), null, "a white wall with somebody in front of it");
  // a SNOWFIELD: the bottom half bright, shading toward the horizon, footprints and drifts here and there
  const snow = pic((x, y) => (y > 46 ? 226 + (y - 46) * 0.25 + (noise(x, y) > 14 ? -18 : 0) : y > 40 ? 60 + noise(x, y) * 3 : 205 - y * 0.2));
  assert.equal(frameBand(snow, TALL.w, TALL.h), null, "a snowfield");
  // FOG: nearly flat all over, paling toward the top, a boat in it
  const fog = pic((x, y) => 210 - 0.05 * Math.abs(x - 48) - 0.12 * y - (Math.abs(x - 48) < 8 && Math.abs(y - 60) < 3 ? 40 : 0));
  assert.equal(frameBand(fog, TALL.w, TALL.h), null, "fog");
  // a BLACK-CLOTHED BACK filling the left of the frame, its outline a shoulder, not a ruler
  const back = pic((x, y) => (x < 36 + 6 * Math.sin(y / 10) ? 4 : scene(x, y)));
  assert.equal(frameBand(back, TALL.w, TALL.h), null, "a black-clothed back");
  // a ground that SHADES out of its colour toward what stands on it (a studio floor under a cartoon's feet)
  const shade = pic((x, y) => (y < 70 ? scene(x, y) : y < 80 ? 206 + (y - 70) * 0.6 : 213));
  assert.equal(frameBand(shade, TALL.w, TALL.h), null, "a floor shading toward the feet");
  // one flat colour all over is no band round a picture; neither is a band with almost nothing beside it
  assert.equal(frameBand(pic(() => 128), TALL.w, TALL.h), null);
  assert.equal(frameBand(banded("top", 85, 228), TALL.w, TALL.h), null);
  assert.equal(frameBand(new Uint8Array(10), TALL.w, TALL.h), null, "nothing to read: never a band");
});

test("a PAIR needs one straight edge; a picture on a plain ground is banded on all four sides", () => {
  // a mauve band top and bottom; under the bottom one, asphalt of nearly its own tone (the music video still, 2026-11-22)
  const pair = pic((x, y) => (y < 11 ? 73 : y >= S - 11 ? 79 : y >= S - 24 ? 62 + noise(x, y) * 1.2 : scene(x, y)));
  const m = edgeMeasure(pair, "bottom");
  assert.ok(m.step && m.edge < 0.75 && m.edge >= 0.2, `the bottom edge alone is too soft to say (${m.edge})`);
  assert.deepEqual(bandDepths(pair), { top: 11, bottom: 11, left: 0, right: 0 });
  assert.deepEqual(frameBand(pair, TALL.w, TALL.h)?.sides, ["top", "bottom"]);
  // a picture sitting on a pale studio ground (the place's design sheet copied — a test draw of 2026-11-26)
  const ground = pic((x, y) => (x >= 6 && x < 90 && ((y >= 14 && y < 40) || (y >= 46 && y < 82)) && (x + y) % 23 !== 0 ? scene(x, y) : 214));
  const g = frameBand(ground, TALL.w, TALL.h);
  assert.deepEqual(g?.sides, ["top", "bottom", "left", "right"]);
  assert.equal(g?.ground, true);
  assert.equal(bandCuttable(g), false, "its middle is still views on a ground: never cut and called right");
  assert.equal(bandFault(g), BAND_FAULT);
  // a room drawn as a MODEL ON A TABLE: a cream band straight across the top, and the same cream under the model's
  // slanted base at the bottom — no straight edge there, the same ground all the same (a test draw of the bakery)
  const model = pic((x, y) => (y < 26 ? 213 : y >= S - 6 - Math.round(Math.abs(x - 48) / 4) ? 213 : scene(x, y)));
  const md = frameBand(model, TALL.w, TALL.h);
  assert.deepEqual(md?.sides, ["top", "bottom"]);
  assert.equal(md?.ground, true);
  assert.equal(bandCuttable(md), false, "cut to its top band alone it would still stand on its ground");
  // …but a band straight across, with nothing of its colour anywhere else, is just a band
  const across = frameBand(banded("top", 14, 213), TALL.w, TALL.h);
  assert.equal(across?.ground, undefined);
  assert.equal(bandCuttable(across), true);
  // …but never a DARK ground: a night picture darkens toward all four edges
  const vignette = pic((x, y) => (x >= 6 && x < 90 && y >= 14 && y < 82 ? scene(x, y) : 8));
  assert.deepEqual(bandDepths(vignette).left, 0);
});

test("a DOUBLED STRIP is found where it is the strip beside it again — not in a curtain, not in a flat strip", () => {
  // the bakery: a cream band, then a strip that is the picture's own top again, then the picture
  const doubled = pic((x, y) => (y < 8 ? 228 : y < 30 ? scene(x, y + 22) : y >= 66 ? 228 : scene(x, y)));
  const b = frameBand(doubled, TALL.w, TALL.h);
  assert.deepEqual(b?.sides, ["top", "bottom"]);
  assert.deepEqual(b?.doubled, ["top"]);
  assert.ok(b!.box.y >= 31 / S && b!.box.y <= 33 / S, `the strip is cut off with the band: ${b!.box.y * S}`);
  // …with no band beside it at all
  const bare = pic((x, y) => (y < 20 ? scene(x, y + 20) : scene(x, y)));
  assert.deepEqual(frameBand(bare, TALL.w, TALL.h)?.doubled, ["top"]);
  // a curtain's folds are alike all the way down: no one place matches better than the next
  const curtain = pic((x) => 120 + 40 * Math.sin(x / 2.3));
  assert.equal(frameBand(curtain, TALL.w, TALL.h), null);
  const m = stripMeasure(curtain, "rows", 0, S, "start");
  assert.ok(m && m.ratio > 0.5, "a curtain matches itself everywhere");
  // a smooth wall repeated is not "a strip of the picture drawn twice"
  const smooth = pic((x, y) => (y < 20 ? 150 + (y + 20) * 0.5 + x * 0.05 : 150 + y * 0.5 + x * 0.05));
  assert.equal(frameBand(smooth, TALL.w, TALL.h), null);
});

test("what a band weighs, and what the next go is told", () => {
  const thin: FrameBand = { sides: ["top"], doubled: [], box: { x: 0, y: 0.05, w: 1, h: 0.95 }, keeps: 0.95, frame: "tall", size: TALL };
  const bakery: FrameBand = { sides: ["top", "bottom"], doubled: ["top"], box: { x: 0, y: 0.31, w: 1, h: 0.36 }, keeps: 0.36, frame: "tall", size: TALL };
  // weighed like a split picture, unless cutting it off leaves most of the picture (a sliver of black at the top)
  assert.equal(bandFault(null), 0);
  assert.equal(bandFault(thin), BAND_TRIM_FAULT);
  assert.equal(bandFault(bakery), BAND_FAULT);
  assert.equal(BAND_FAULT, 4, "like panels");
  assert.equal(COVER_MOST, 0.6);
  // the redraw is told in plain words: which edge, and the frame it fills
  assert.equal(bandFix({ ...thin, sides: ["bottom"] }), "The last try left an empty band across the bottom — draw ONE picture that fills the whole tall frame, top to bottom");
  assert.equal(bandFix(bakery), "The last try left an empty band across the top and the bottom and drew a strip of the picture twice, along the top — draw ONE picture that fills the whole tall frame, top to bottom, nothing in it drawn twice");
  assert.equal(bandFix({ ...thin, sides: ["left", "right"], frame: "wide" }), "The last try left an empty band down both sides — draw ONE picture that fills the whole wide frame, side to side");
  assert.equal(bandFix({ ...thin, sides: ["top", "bottom", "left", "right"], ground: true }), "The last try set the picture on an empty plain ground, like a model on a design sheet — draw ONE picture that fills the whole tall frame, edge to edge");
  assert.equal(bandFix({ ...thin, sides: ["top", "bottom"], ground: true }), "The last try set the picture on an empty plain ground, like a model on a design sheet — draw ONE picture that fills the whole tall frame, top to bottom");
  assert.equal(bandFix(null), "");
});

test("the crop that covers the frame from the picture's own content — and the rule for when it is enough", () => {
  // the bakery's content: the full width, 36% of the height — a cover keeps its middle 36%: a narrow middle, still flagged
  assert.ok(Math.abs(coverKeeps(1536, 0.36 * 2752, 1536, 2752) - 0.36) < 0.01);
  assert.equal(coverKeeps(1536, 2752, 1536, 2752), 1);
  assert.equal(coverKeeps(0, 10, 10, 10), 0);
  const bakery: FrameBand = { sides: ["top", "bottom"], doubled: ["top"], box: { x: 0, y: 0.3125, w: 1, h: 0.3542 }, keeps: 0.355, frame: "tall", size: TALL };
  const c = coverCrop(bakery, TALL.w, TALL.h);
  assert.ok(c.w % 2 === 0 && c.h % 2 === 0 && c.x % 2 === 0 && c.y % 2 === 0, "whole even pixels");
  assert.ok(Math.abs(c.w / c.h - TALL.w / TALL.h) < 0.01, "the frame's own shape");
  assert.ok(c.y >= Math.floor(0.3125 * TALL.h) - 1 && c.y + c.h <= Math.ceil((0.3125 + 0.3542) * TALL.h) + 1, "inside the content: no band in it");
  assert.ok(Math.abs(c.x + c.w / 2 - TALL.w / 2) <= 2, "the middle of it");
  assert.equal(bandCuttable(bakery), false);
  // a sliver at the top: nearly all of it, and it is simply right
  const thin: FrameBand = { sides: ["top"], doubled: [], box: { x: 0, y: 0.05, w: 1, h: 0.95 }, keeps: 0.95, frame: "tall", size: TALL };
  const t = coverCrop(thin, TALL.w, TALL.h);
  assert.ok(t.y >= 0.05 * TALL.h - 2 && t.y + t.h <= TALL.h && t.x >= 0 && t.x + t.w <= TALL.w);
  assert.equal(bandCuttable(thin), true);
  // a wide frame with bands down both sides
  const pillar: FrameBand = { sides: ["left", "right"], doubled: [], box: { x: 0.1, y: 0, w: 0.8, h: 1 }, keeps: 0.8, frame: "wide", size: { w: 2752, h: 1536 } };
  const p = coverCrop(pillar, 2752, 1536);
  assert.ok(p.x >= 0.1 * 2752 - 2 && p.x + p.w <= 0.9 * 2752 + 2 && Math.abs(p.w / p.h - 2752 / 1536) < 0.01);
});

test("ffmpeg reads a real JPEG the way the check is given it — and the cover crop leaves no band", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "full-frame-"));
  try {
    const W = 540, H = 960;
    const src = path.join(dir, "banded.jpg");
    // a busy test pattern with a cream band across its bottom third — the bakery's shape
    const make = spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", `testsrc2=s=${W}x${H}:d=1`, "-vf", `drawbox=x=0:y=${Math.round(H * 0.69)}:w=${W}:h=${H}:color=0xE8E4DC:t=fill`, "-frames:v", "1", "-q:v", "3", src], { encoding: "utf8" });
    assert.equal(make.status, 0, make.stderr?.slice(-300));
    // the read full-frame.server.ts → bandOf makes
    const readGray = (file: string) => {
      const raw = path.join(dir, `${path.basename(file)}.gray`);
      const r = spawnSync("ffmpeg", ["-y", "-i", file, "-vf", `scale=${S}:${S}:flags=area,format=gray`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", raw], { encoding: "utf8" });
      assert.equal(r.status, 0);
      return { gray: new Uint8Array(fs.readFileSync(raw)), size: pictureSize(r.stderr) };
    };
    const a = readGray(src);
    assert.deepEqual(a.size, { w: W, h: H }, "the picture's size, from ffmpeg's own report of its input");
    const b = frameBand(a.gray, W, H);
    assert.deepEqual(b?.sides, ["bottom"]);
    // (a third of the frame gone from one edge still leaves a picture two thirds as tall, full width: covered, it keeps 69%)
    assert.ok(b && Math.abs(b.keeps - 0.69) < 0.02 && bandCuttable(b), `${b?.keeps}`);
    // the crop full-frame.server.ts → coverBand makes, read again: no band
    const c = coverCrop(b!, W, H);
    const out = path.join(dir, "covered.jpg");
    const cut = spawnSync("ffmpeg", ["-y", "-i", src, "-vf", `crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${W}:${H}:flags=lanczos,setsar=1`, "-frames:v", "1", "-q:v", "2", out], { encoding: "utf8" });
    assert.equal(cut.status, 0);
    const again = readGray(out);
    assert.deepEqual(again.size, { w: W, h: H }, "the same size as before");
    assert.equal(frameBand(again.gray, W, H), null, "covered: no band left");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  // (the INPUT's size — never the 96 × 96 the read is written at)
  assert.deepEqual(pictureSize("Input #0, image2, from 'x.jpg':\n  Stream #0:0: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 1536x2752 [SAR 1:1 DAR 12:43], 25 tbr\nOutput #0, rawvideo:\n  Stream #0:0: Video: rawvideo, gray, 96x96"), { w: 1536, h: 2752 });
  assert.equal(pictureSize("no picture"), null);
});

/* ---- REAL PICTURES, read small and grey exactly as the check reads them (deflated, base64) ---- */
type Read = { w: number; h: number; gray: string; what: string; want: { sides: BandSide[]; doubled: BandSide[] } | null };
const READS: Record<string, Read> = fs.existsSync(path.join(here, "full-frame-reads.json")) ? JSON.parse(read("tests", "full-frame-reads.json")) : {};
const grayOf = (r: Read) => new Uint8Array(zlib.inflateRawSync(Buffer.from(r.gray, "base64")));

test("REAL pictures: the bakery and the banded test draws fail; the hard real scenes pass", () => {
  const names = Object.keys(READS);
  assert.ok(names.length >= 12, `the real reads are here (${names.length})`);
  assert.ok(READS["bakery-live"], "the live bakery picture itself");
  for (const n of names) {
    const r = READS[n];
    const g = grayOf(r);
    assert.equal(g.length, S * S, n);
    const b = frameBand(g, r.w, r.h);
    if (!r.want) { assert.equal(b, null, `${n} (${r.what}) must pass`); continue; }
    assert.ok(b, `${n} (${r.what}) must fail`);
    assert.deepEqual(b.sides, r.want.sides, `${n} sides`);
    assert.deepEqual(b.doubled, r.want.doubled, `${n} doubled`);
  }
  // the bakery: cream top and bottom, its top strip doubled, a narrow middle left — still flagged when covered
  const bakery = frameBand(grayOf(READS["bakery-live"]), 1536, 2752)!;
  assert.ok(bakery.keeps < COVER_MOST && bakery.box.y > 0.3 && bakery.box.y + bakery.box.h < 0.7);
  assert.ok(bandFix(bakery).startsWith("The last try left an empty band across the top and the bottom and drew a strip of the picture twice"));
});
