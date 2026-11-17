/* The presenter "character kit": the full-body rotation shown in the Presenters section.
 *
 * What this pins down, each from something that actually went wrong while the stock cast's kits were
 * being built (2026-11-17):
 *   - 3 of the first 22 rotations were not rotations. The video model turned the presenter half-way and
 *     brought them back — it loops, it looks fine at a glance, and dragging it plays a wobble. The check
 *     that catches it (which way the visible surface slides) is tested against every committed kit AND
 *     against a there-and-back built from real frames.
 *   - One more got past that check and into production: the head turned all the way round but the body
 *     never showed its back (the owner, within minutes: "Rosa stuff is a bit glitched"). Hence the second
 *     check — the shoulders have to get wide again in the middle of the turn.
 *   - Frames picked evenly in TIME gave a dead zone: the model idles facing front for up to a third of
 *     the clip, so a drag did nothing and then whipped round. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { measureTurn, shoulderWidth, slideBetween, spinCrop, spinFramePicks, stepSize, turnShape } from "../app/lib/presenter-kit-core.ts";
import { nearestLoaded, spinLoadOrder } from "../app/lib/spin-frames.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const haveFfmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0;

/* ---------- picking frames ---------- */

test("frames are picked along what MOVES, not along the clock", () => {
  // a 145-frame clip: 30 frames standing still, 84 turning, 30 standing still again
  const motion = [...Array(30).fill(0.05), ...Array(84).fill(2), ...Array(30).fill(0.05)];
  const picks = spinFramePicks(motion, 60);
  assert.equal(picks.length, 60);
  assert.equal(picks[0], 0, "the turn starts on the first frame");
  assert.ok(picks.every((p, i) => i === 0 || p > picks[i - 1]), "never the same frame twice, never backwards");
  assert.ok(picks[picks.length - 1] <= 143, "never the last frame — it is the first one again");
  const idle = picks.filter((p) => p < 30 || p >= 114).length;
  assert.ok(idle <= 8, `the standing-still stretches got ${idle} of the 60 frames — picked by the clock they would get 25`);
});

test("a clip that turns at a steady pace is sampled evenly", () => {
  const picks = spinFramePicks(Array(144).fill(1.5), 60);
  assert.equal(picks.length, 60);
  const gaps = picks.slice(1).map((p, i) => p - picks[i]);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, `gaps between picks vary from ${Math.min(...gaps)} to ${Math.max(...gaps)}`);
});

test("a step is the same size on a busy surface as on a plain one", () => {
  // The same 2-pixel move changes a face far more than a plain shirt. If "how much changed" were used
  // as it is, the busy side of a presenter would be handed more frames than their back.
  const w = 120;
  const h = 160;
  const make = (shift: number, contrast: number) => {
    const mask = new Uint8Array(w * h);
    const grey = new Uint8Array(w * h);
    for (let y = 10; y < 150; y++) for (let x = 20; x < 100; x++) {
      mask[y * w + x] = 255;
      // smooth texture (a real surface, not noise): two sine waves across the picture
      grey[y * w + x] = Math.round(128 + contrast * (Math.sin((x - shift) / 5) + Math.sin((x - shift) / 11 + y / 9)));
    }
    return { mask, grey };
  };
  const step = (shift: number, contrast: number) => {
    const a = make(0, contrast);
    const b = make(shift, contrast);
    return stepSize(a.mask, a.grey, b.mask, b.grey, w, h);
  };
  const busy = step(2, 50);
  const plain = step(2, 9);
  assert.ok(busy > 1 && busy < 3, `a 2-pixel move on a busy surface measured ${busy.toFixed(2)}`);
  assert.ok(Math.abs(busy - plain) / busy < 0.3, `busy ${busy.toFixed(2)} vs plain ${plain.toFixed(2)} — the same move must measure about the same`);
  assert.ok(step(0, 50) < 0.05, "standing still is no step");
  assert.ok(step(4, 50) > busy * 1.5, "a bigger move is a bigger step");
  assert.ok(Number.isNaN(stepSize(new Uint8Array(w * h), new Uint8Array(w * h), new Uint8Array(w * h), new Uint8Array(w * h), w, h)), "nobody in the frame");
});

test("a few faster frames do not pull frames away from the rest of the turn", () => {
  // turning throughout; one stretch measures half again as fast (it happens — the model is not a turntable)
  const steps = [...Array(48).fill(2), ...Array(48).fill(3), ...Array(48).fill(2)];
  const picks = spinFramePicks(steps, 60);
  const fast = picks.filter((p) => p >= 48 && p < 96).length;
  assert.ok(Math.abs(fast - 20) <= 5, `the faster third got ${fast} of 60 frames`);
});

test("a clip shorter than the frames wanted gives every frame it has", () => {
  assert.deepEqual(spinFramePicks([1, 1, 1, 1], 60), [0, 1, 2, 3]);
});

/* ---------- the crop ---------- */

test("one crop box holds the presenter through the whole turn", () => {
  const log = "[Parsed_cropdetect_0 @ 0x1] x1:400 x2:700 y1:200 y2:1800 w:300 h:1600 x:400 y:200 pts:1 t:0.04 limit:24 crop=300:1600:400:200\n" +
    "[Parsed_cropdetect_0 @ 0x1] x1:350 x2:760 y1:190 y2:1810 w:410 h:1620 x:350 y:190 pts:2 t:0.08 limit:24 crop=410:1620:350:190\n";
  const box = spinCrop(log, { w: 1088, h: 1920 });
  assert.ok(box);
  // the LAST line is the union of every frame; padded a little, even-sized, inside the picture
  assert.ok(box.x < 350 && box.x + box.w > 760, "padded past the widest the figure ever got");
  assert.ok(box.y < 190 && box.y + box.h > 1810);
  assert.equal(box.w % 2, 0);
  assert.equal(box.h % 2, 0);
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= 1088 && box.y + box.h <= 1920);
  assert.equal(spinCrop("nothing detected", { w: 1088, h: 1920 }), null);
});

/* ---------- is it a full turn ---------- */

// shoulders through one real rotation of 60 frames: wide (front), narrow (side), wide (back), narrow, wide
const TURN_WIDTHS = Array.from({ length: 60 }, (_, i) => 60 + 40 * Math.abs(Math.cos((i / 60) * 2 * Math.PI)));

test("a real rotation slides the same way through both halves; a there-and-back does not", () => {
  const out = Array(30).fill(0.02);
  const real = turnShape([...out, ...out], TURN_WIDTHS);
  assert.equal(real.full, true);
  assert.equal(real.dir, 1);
  assert.equal(turnShape([...out, ...out].map((x) => -x), TURN_WIDTHS).dir, -1);
  assert.equal(turnShape([...out, ...out].map((x) => -x), TURN_WIDTHS).full, true);
  // out, then back the way it came
  assert.equal(turnShape([...out, ...out.map((x) => -x)], TURN_WIDTHS).full, false);
  // a figure that never really turns
  assert.equal(turnShape(Array(60).fill(0.0005), TURN_WIDTHS).full, false);
  // frames the measurement could not read are ignored, not counted as zero
  assert.equal(turnShape([...out, ...out].map((x, i) => (i % 7 === 0 ? NaN : x)), TURN_WIDTHS).full, true);
});

test("a rotation has to show the presenter's BACK: wide, narrow, wide again", () => {
  const slides = Array(60).fill(0.02); // turning the same way throughout — the first check is satisfied
  assert.ok(turnShape(slides, TURN_WIDTHS).back > 0.95, "a real turn is as wide at the back as at the front");
  // the paper flip: side view to side view, the body never squaring up to the camera in between
  const flip = TURN_WIDTHS.map((w, i) => (i > 14 && i < 46 ? 62 : w));
  const flipped = turnShape(slides, flip);
  assert.ok(flipped.back < 0.7, `a flip measured ${flipped.back.toFixed(2)} at the back`);
  assert.equal(flipped.full, false);
  // a scarf or a broad jacket keeps the side views fairly wide — still a real turn if the back squares up
  assert.equal(turnShape(slides, TURN_WIDTHS.map((w) => Math.max(w, 82))).full, true);
  // widths that could not be read: no back view on record, so not shown
  assert.equal(turnShape(slides, Array(60).fill(NaN)).full, false);
});

test("shoulder width is read at the shoulders, not where the arms hang", () => {
  const w = 100;
  const h = 200;
  const mask = new Uint8Array(w * h);
  const fill = (x0: number, x1: number, y0: number, y1: number) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = 255; };
  fill(42, 58, 10, 36);   // head
  fill(30, 70, 36, 100);  // torso, 40 wide
  fill(36, 64, 100, 190); // legs
  fill(8, 30, 80, 120);   // an arm held well away from the body, low down — not counted
  assert.equal(shoulderWidth(mask, w, h), 39);
  assert.ok(Number.isNaN(shoulderWidth(new Uint8Array(w * h), w, h)), "nobody in the frame");
});

test("the slide between two frames is measured in the middle of the figure", () => {
  const w = 120;
  const h = 200;
  // a textured column 60 px wide; frame B is the same texture moved 4 px to the right
  const make = (shift: number) => {
    const mask = new Uint8Array(w * h);
    const grey = new Uint8Array(w * h);
    for (let y = 10; y < 190; y++) for (let x = 30; x < 90; x++) {
      mask[y * w + x] = 255;
      const u = x - shift;
      grey[y * w + x] = 90 + ((u * 37 + y * 11 + ((u >> 2) ^ (y >> 3)) * 29) % 120);
    }
    return { mask, grey };
  };
  const a = make(0);
  const b = make(4);
  assert.equal(slideBetween(a.mask, a.grey, b.mask, b.grey, w, h), 4);
  assert.equal(slideBetween(b.mask, b.grey, a.mask, a.grey, w, h), -4);
  assert.equal(slideBetween(a.mask, a.grey, a.mask, a.grey, w, h), 0);
  // nobody in the frame
  assert.ok(Number.isNaN(slideBetween(new Uint8Array(w * h), new Uint8Array(w * h), b.mask, b.grey, w, h)));
});

/* ---------- loading and drawing ---------- */

test("frames load coarse-to-fine, each exactly once", () => {
  const order = spinLoadOrder(60);
  assert.equal(order.length, 60);
  assert.equal(new Set(order).size, 60);
  assert.equal(order[0], 0, "the figure itself first");
  assert.deepEqual(order.slice(1, 4), [16, 32, 48], "then a turn's worth of widely spaced frames");
  assert.ok(order.indexOf(8) < order.indexOf(4) && order.indexOf(4) < order.indexOf(2) && order.indexOf(2) < order.indexOf(1));
});

test("a frame that has not arrived is drawn as its nearest neighbour that has", () => {
  const loaded: boolean[] = Array(60).fill(false);
  assert.equal(nearestLoaded(10, loaded, 60), -1);
  loaded[0] = true; loaded[16] = true; loaded[48] = true;
  assert.equal(nearestLoaded(10, loaded, 60), 16);
  assert.equal(nearestLoaded(5, loaded, 60), 0);
  assert.equal(nearestLoaded(58, loaded, 60), 0, "wraps: frame 58 is two steps from frame 0");
  assert.equal(nearestLoaded(-3, loaded, 60), 0);
  assert.equal(nearestLoaded(48 + 60 * 3, loaded, 60), 48, "any number of turns round");
});

/* ---------- the kits that ship ---------- */

type SpinMeta = { n: number; w: number; h: number; dir: number };
type Entry = { cuts?: number; v?: number; spins?: Array<SpinMeta | null> };
const kits = JSON.parse(fs.readFileSync(path.join(root, "app", "lib", "presenter-kits.json"), "utf8")) as Record<string, Entry>;
const cast = (JSON.parse(fs.readFileSync(path.join(root, "app", "lib", "avatars-data.json"), "utf8")) as string[][]).map((a) => a[0]);
const designed = Object.keys((JSON.parse(fs.readFileSync(path.join(root, "app", "lib", "voice-design-ledger.json"), "utf8")) as { designed: Record<string, unknown> }).designed);
const live = cast.filter((id) => designed.includes(id));
// outfit 0's frames carry no number; outfit 2's are "2-s00.webp" (lookPrefix in app/lib/presenter-kits.ts)
const prefixOf = (look: number) => (look > 0 ? `${look}-` : "");
const shown = (m: SpinMeta | null | undefined): m is SpinMeta => !!m && !!m.n && (m.dir === 1 || m.dir === -1);

test("every live presenter has a cut-out portrait — the whole cast stands on one backdrop", () => {
  assert.ok(live.length >= 20, `only ${live.length} live presenters found`);
  for (const id of live) {
    assert.ok((kits[id]?.cuts || 0) >= 1, `${id} has no cut-out — run scripts/build-presenter-kits.ts ${id}`);
    assert.ok(fs.existsSync(path.join(root, "public", "kits", id, "o0.webp")), `${id}: public/kits/${id}/o0.webp is missing`);
  }
});

test("every live presenter can be turned around in their first outfit", () => {
  for (const id of live) assert.ok(shown(kits[id]?.spins?.[0]), `${id} has no 3D view — run scripts/build-presenter-kits.ts --spin ${id}`);
});

test("every file a kit's entry promises is on disk", () => {
  for (const [id, k] of Object.entries(kits)) {
    for (let v = 0; v < (k.cuts || 0); v++) assert.ok(fs.existsSync(path.join(root, "public", "kits", id, `o${v}.webp`)), `${id}: o${v}.webp`);
    (k.spins || []).forEach((m, look) => {
      for (let i = 0; i < (m?.n || 0); i++) {
        const name = `${prefixOf(look)}s${String(i).padStart(2, "0")}.webp`;
        assert.ok(fs.existsSync(path.join(root, "public", "kits", id, name)), `${id}: ${name}`);
      }
    });
  }
});

test("every rotation that is shown is one real turn, in the direction on record", { skip: !haveFfmpeg && "ffmpeg not available" }, async () => {
  const tools = { token: "", ffmpeg: "ffmpeg", ffprobe: "ffprobe" };
  for (const [id, k] of Object.entries(kits)) {
    for (const [look, m] of (k.spins || []).entries()) {
      if (!shown(m)) continue; // dir 0 = held back, never shown
      const shape = await measureTurn(tools, path.join(root, "public", "kits", id), prefixOf(look), { frames: m.n, w: m.w, h: m.h });
      const what = `${id} outfit ${look}`;
      assert.ok(shape.full, `${what} is not a full turn (slides ${(shape.first * 100).toFixed(2)}% then ${(shape.second * 100).toFixed(2)}%, back ${shape.back.toFixed(2)}× the front) — re-roll it: build-presenter-kits.ts --respin --look ${look} ${id}`);
      assert.equal(shape.dir, m.dir, `${what}: recorded dir ${m.dir}, measures ${shape.dir}`);
    }
  }
});

/** Measure a rotation made by re-ordering a real kit's frames: frame i of the fake is frame `from(i, n)` of mei's. */
async function measureFake(from: (i: number, n: number) => number) {
  const id = "mei";
  const m = kits[id]?.spins?.[0];
  assert.ok(shown(m), "mei's kit is needed for this test");
  const n = m.n;
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP || process.env.TMPDIR || "/tmp"), "kit-fake-"));
  try {
    for (let i = 0; i < n; i++) {
      fs.copyFileSync(path.join(root, "public", "kits", id, `s${String(from(i, n)).padStart(2, "0")}.webp`), path.join(tmp, `s${String(i).padStart(2, "0")}.webp`));
    }
    return await measureTurn({ token: "", ffmpeg: "ffmpeg", ffprobe: "ffprobe" }, tmp, "", { frames: n, w: m.w, h: m.h });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test("a there-and-back made from a real kit is caught", { skip: !haveFfmpeg && "ffmpeg not available" }, async () => {
  // Play mei's first half forwards, then backwards: exactly what the video model does when it cheats.
  const shape = await measureFake((i, n) => (i <= n / 2 ? i : n - i));
  assert.equal(shape.full, false, `a there-and-back passed as a full turn (slides ${(shape.first * 100).toFixed(2)}% then ${(shape.second * 100).toFixed(2)}%)`);
});

test("a turn that never shows the back, made from a real kit, is caught", { skip: !haveFfmpeg && "ffmpeg not available" }, async () => {
  // Front to side as recorded, the side view HELD where the back should be, then the other side to front.
  const shape = await measureFake((i, n) => (i < n / 4 || i > (3 * n) / 4 ? i : i < n / 2 ? Math.round(n / 4) : Math.round((3 * n) / 4)));
  assert.ok(shape.back < 0.85, `the held side views measured ${shape.back.toFixed(2)}× the front — a side view should be much narrower`);
  assert.equal(shape.full, false);
});
