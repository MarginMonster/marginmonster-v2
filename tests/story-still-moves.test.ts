/* A STILL STORY LOOKS MADE, NOT BROKEN (app/lib/narrated-core.ts → A STILL PICTURE'S SLOW MOVE).
 *
 * The owner, 2026-11-25: "we also need the timeless pictures with narration as an extremely cheap base tier". A story
 * told over its STILL pictures is that tier (film-length.ts: 1 token a second), and every one of its pictures moves —
 * slowly, each its own way, its neighbours never alike — drawn by our own ffmpeg. Until that day the move was a zoompan
 * that put its window on whole pixels and stair-stepped (a slow drift stood still on 124 of 284 frames and then jumped).
 * These tests hold the moves to: four kinds in turn, the window always inside the picture, exactly the frames asked
 * for, one pass over a cut's joined picture that is frame for frame each scene moved alone, and a motion that is smooth
 * — measured, a dot's centre found in every frame.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STILL_DRIFT_ZOOM, STILL_MOVES, STILL_PUSH, kenBurns, stillHeld, stillMove, stillMoves, stillWindow, type StillMove } from "../app/lib/narrated-core.ts";
import { partGraph, sceneIn, storyParts } from "../app/lib/story-join.ts";
import { fitMotion, motionChain } from "../app/lib/story-motion.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

/* ---- THE MOVES ---- */

test("four moves in turn — push in, drift right, pull back, drift left — so no two neighbours move alike, and a story opens pushing in", () => {
  assert.deepEqual([...STILL_MOVES], ["in", "right", "out", "left"]);
  assert.equal(stillMove(0), "in", "the first picture pushes in, as it always did");
  for (let i = 1; i < 64; i++) assert.notEqual(stillMove(i), stillMove(i - 1), `scenes ${i - 1} and ${i}`);
  // a push is never followed by a push, nor a drift by a drift: the kind alternates, and so does the direction
  for (let i = 1; i < 64; i++) {
    const kind = (m: StillMove) => (m === "in" || m === "out" ? "push" : "drift");
    assert.notEqual(kind(stillMove(i)), kind(stillMove(i - 1)));
  }
  // scene i is counted through the WHOLE story: across a part's edge the neighbours still differ
  const parts = storyParts(Array.from({ length: 13 }, () => 280));
  for (const p of parts.slice(1)) assert.notEqual(stillMove(p.from), stillMove(p.from - 1));
  assert.equal(stillMove(-1), "left");
  assert.equal(stillMove(NaN), "in");
});

test("the window: a push from the whole picture to 1.10 and back, a drift across 7.4% of it — always inside the picture", () => {
  assert.equal(STILL_PUSH, 0.1);
  assert.equal(STILL_DRIFT_ZOOM, 1.08);
  assert.deepEqual(stillWindow("in", 0), { z: 1, cx: 0.5, cy: 0.5 });
  assert.ok(Math.abs(stillWindow("in", 1).z - 1.1) < 1e-12);
  assert.ok(Math.abs(stillWindow("out", 0).z - 1.1) < 1e-12);
  assert.deepEqual(stillWindow("out", 1), { z: 1, cx: 0.5, cy: 0.5 });
  const f = 1 / STILL_DRIFT_ZOOM;
  assert.ok(Math.abs(stillWindow("right", 0).cx - f / 2) < 1e-12 && Math.abs(stillWindow("right", 1).cx - (1 - f / 2)) < 1e-12, "right: from the left edge to the right edge");
  assert.ok(Math.abs(stillWindow("left", 0).cx - (1 - f / 2)) < 1e-12 && Math.abs(stillWindow("left", 1).cx - f / 2) < 1e-12);
  assert.ok(Math.abs((stillWindow("right", 1).cx - stillWindow("right", 0).cx) - (1 - f)) < 1e-12 && Math.abs(1 - f - 0.074) < 0.001);
  for (const m of STILL_MOVES) {
    let last = stillWindow(m, 0);
    for (let k = 0; k <= 100; k++) {
      const w = stillWindow(m, k / 100);
      const half = 0.5 / w.z;
      assert.ok(w.z >= 1 && w.z <= 1 + STILL_PUSH + 1e-12, `${m} ${k}: zoom ${w.z}`);
      assert.ok(w.cx - half >= -1e-12 && w.cx + half <= 1 + 1e-12 && w.cy - half >= -1e-12 && w.cy + half <= 1 + 1e-12, `${m} at ${k}%: the window leaves the picture`);
      // it only ever goes one way (a slow move, not a wobble)
      if (m === "in") assert.ok(w.z >= last.z);
      if (m === "out") assert.ok(w.z <= last.z);
      if (m === "right") assert.ok(w.cx >= last.cx);
      if (m === "left") assert.ok(w.cx <= last.cx);
      last = w;
    }
  }
  // past the ends it holds
  assert.deepEqual(stillWindow("in", 2), stillWindow("in", 1));
  assert.deepEqual(stillWindow("in", -1), stillWindow("in", 0));
});

test("the chains: a picture HELD for its frames (decoded once), and ONE perspective over a run of scenes — each its own move over its own frames", () => {
  assert.equal(stillHeld(285, 1080, 1920), "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,loop=loop=284:size=1:start=0,settb=1/30,setpts=N,fps=30,format=yuv420p");
  // nothing moves: nothing to lay over it
  assert.equal(stillMoves([]), "");
  assert.equal(stillMoves([{ move: null, frames: 30 }, { move: null, frames: 40 }]), "");
  // one scene pushing in over 285 frames: the window's edges from the frame number, sub-pixel, bicubic, every frame
  const one = stillMoves([{ move: "in", frames: 285 }]);
  assert.equal(one, "perspective=x0='W*(0.5-0.5/(1+0.1*(on-1)/284))':y0='H*(0.5-0.5/(1+0.1*(on-1)/284))':x1='W*(0.5+0.5/(1+0.1*(on-1)/284))':y1='H*(0.5-0.5/(1+0.1*(on-1)/284))':x2='W*(0.5-0.5/(1+0.1*(on-1)/284))':y2='H*(0.5+0.5/(1+0.1*(on-1)/284))':x3='W*(0.5+0.5/(1+0.1*(on-1)/284))':y3='H*(0.5+0.5/(1+0.1*(on-1)/284))':interpolation=cubic:eval=frame");
  // a run: still, clip, still — the clip's frames are not redrawn (enable) but are counted, so each still's move is its own
  const run = stillMoves([{ move: "in", frames: 30 }, { move: null, frames: 20 }, { move: "out", frames: 40 }]);
  assert.ok(run.startsWith("perspective=x0='if(lt(on,31),W*(0.5-0.5/(1+0.1*(on-1)/29)),if(lt(on,51),0,W*(0.5-0.5/(1+0.1*(1-(on-51)/39)))))'"), run.slice(0, 160));
  assert.ok(run.endsWith(":interpolation=cubic:eval=frame:enable='between(n,0,29)+between(n,50,89)'"));
  // every scene's chain in one: kenBurns is a run of one
  assert.equal(kenBurns(1, 120, 180, 320), `${stillHeld(120, 180, 320)},${stillMoves([{ move: "right", frames: 120 }])}`);
  // a part lays its stills' moves over its joined picture, BEFORE its words (which stay put)
  const s = sceneIn(5, { still: "s.jpg" }, 270, 1080, 1920, { clips: false, moving: true });
  assert.deepEqual(s, { input: ["-i", "s.jpg"], chain: stillHeld(270, 1080, 1920), move: "right" });
  const g = partGraph(["A", "B"], [30, 40], ["drawtext=w"], 0, ["in", "out"]);
  assert.ok(g.indexOf("perspective=") > g.indexOf("concat=n=2") && g.indexOf("perspective=") < g.indexOf("drawtext=w"));
  // the plain rung is still the plain rung: its pictures held, nothing moved
  assert.equal(sceneIn(5, { still: "s.jpg" }, 270, 1080, 1920, { clips: false, moving: false }).move, undefined);
});

test("the wiring: the single cut and the parts lay the same moves, and nothing else still calls the old zoompan move", () => {
  const nar = read("app", "lib", "narrated-story.server.ts");
  const single = nar.slice(nar.indexOf("export async function assembleNarrated("), nar.indexOf("async function cutInParts("));
  assert.ok(single.includes("? `[${i}:v]${stillHeld(frames[i], o.W, o.H)}[c${i}]`"));
  // (each still's move by its camera since 2026-11-26 — none is Gentle, the four in turn: tests/story-still-camera.test.ts)
  assert.ok(single.includes("const stillMoveOf = (i: number) => cameraMove(o.cameras?.[i], i);"));
  assert.ok(single.includes("const still = moving ? stillMoves(norm.map((_, i) => ({ move: clipOf(i) ? null : stillMoveOf(i), frames: frames[i] }))) : \"\";"));
  assert.ok(!/zoompan/.test(read("app", "lib", "narrated-core.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "no zoompan in the move");
  assert.ok(!nar.includes("kenBurns("), "the cut holds and moves; the one-scene kenBurns is the move said for one scene");
  const join = read("app", "lib", "story-join.ts");
  assert.ok(join.includes("if (how.moving) { const move = cameraMove(s.camera, i); return { input: [\"-i\", s.still], chain: stillHeld(frames, W, H), ...(move ? { move } : {}) }; }"));
  assert.ok(join.includes("partGraph(scenes.map((s) => s.chain), frames, captions, clock, scenes.map((s) => s.move))"));
});

/* ---- THE MOVES, MADE ---- */

const ffmpegOk = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0;
const ff = (args: string[]): void => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
};
const grayFrames = (file: string, W: number, H: number): Uint8Array[] => {
  const raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"], { encoding: "buffer", maxBuffer: 1 << 28 }).stdout;
  const out: Uint8Array[] = [];
  for (let k = 0; k + W * H <= raw.length; k += W * H) out.push(raw.subarray(k, k + W * H));
  return out;
};

test("EXACTLY the frames asked for, no black edge, and ONE pass over a run is frame for frame each still moved alone", { skip: !ffmpegOk }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "still-moves-"));
  try {
    const W = 180, H = 320;
    // a TEST picture with detail everywhere and nothing black (a black edge would show at once)
    const pic = path.join(dir, "test-picture.png");
    ff(["-f", "lavfi", "-i", "testsrc2=s=400x720", "-frames:v", "1", "-vf", "lutyuv=y='clipval*0.6+80'", pic]);
    // each move alone, for every frame shape a story has
    for (const [w, h] of [[W, H], [320, 180], [240, 240]]) {
      for (let i = 0; i < 4; i++) {
        const out = path.join(dir, `m${i}-${w}.mkv`);
        ff(["-i", pic, "-filter_complex", `[0:v]${kenBurns(i, 47, w, h)}[v]`, "-map", "[v]", "-c:v", "ffv1", out]);
        const frames = grayFrames(out, w, h);
        assert.equal(frames.length, 47, `${stillMove(i)} at ${w}x${h}: exactly the frames asked for`);
        // no black edge: the darkest pixel of the outermost rows and columns of every frame is the picture's, not black
        let darkest = 255;
        for (const fr of frames) for (let x = 0; x < w; x++) for (const y of [0, h - 1]) darkest = Math.min(darkest, fr[y * w + x]);
        for (const fr of frames) for (let y = 0; y < h; y++) for (const x of [0, w - 1]) darkest = Math.min(darkest, fr[y * w + x]);
        assert.ok(darkest >= 70, `${stillMove(i)} at ${w}x${h}: an edge pixel at ${darkest}`);
        // it moved: its first and last frames differ
        let d = 0; for (let p = 0; p < w * h; p++) d = Math.max(d, Math.abs(frames[0][p] - frames[46][p]));
        assert.ok(d > 40, `${stillMove(i)} did not move`);
      }
    }
    // a run as a cut makes it: still (push in), a moving clip, still (pull back) — joined, then ONE pass of moves
    const clip = path.join(dir, "clip.mp4");
    ff(["-f", "lavfi", "-i", `color=c=0x3355CC:s=${W}x${H}:r=30:d=1`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", clip]);
    const fr = [30, 20, 40];
    const graph = [
      `[0:v]${stillHeld(fr[0], W, H)}[c0]`, `[1:v]${motionChain(fitMotion(1, fr[1] / 30), fr[1], W, H)}[c1]`, `[2:v]${stillHeld(fr[2], W, H)}[c2]`,
      "[c0][c1][c2]concat=n=3:v=1:a=0[vcat]",
      `[vcat]${stillMoves([{ move: stillMove(0), frames: fr[0] }, { move: null, frames: fr[1] }, { move: stillMove(2), frames: fr[2] }])}[v]`,
    ].join(";");
    const joined = path.join(dir, "joined.mkv");
    ff(["-i", pic, "-i", clip, "-i", pic, "-filter_complex", graph, "-map", "[v]", "-c:v", "ffv1", joined]);
    const J = grayFrames(joined, W, H);
    assert.equal(J.length, 90, "the run is exactly its scenes");
    const alone = (i: number, n: number) => { const f = path.join(dir, `alone${i}.mkv`); ff(["-i", pic, "-filter_complex", `[0:v]${kenBurns(i, n, W, H)}[v]`, "-map", "[v]", "-c:v", "ffv1", f]); return grayFrames(f, W, H); };
    const A0 = alone(0, fr[0]), A2 = alone(2, fr[2]);
    const worst = (a: Uint8Array, b: Uint8Array) => { let m = 0; for (let p = 0; p < a.length; p++) m = Math.max(m, Math.abs(a[p] - b[p])); return m; };
    for (let k = 0; k < fr[0]; k++) assert.ok(worst(J[k], A0[k]) <= 2, `scene 1, frame ${k}`);
    for (let k = 0; k < fr[2]; k++) assert.ok(worst(J[fr[0] + fr[1] + k], A2[k]) <= 2, `scene 3, frame ${k}: its move is its own, though a clip came before it`);
    // …and the clip between them is untouched (one flat colour, as it was made)
    const flat = J.slice(fr[0], fr[0] + fr[1]).every((f) => { let lo = 255, hi = 0; for (const v of f) { lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo <= 2; });
    assert.ok(flat, "the clip's frames are not redrawn");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("SMOOTH: a dot's centre, found in every frame, moves on a straight even path — no frame stands still, nothing shivers", { skip: !ffmpegOk }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "still-smooth-"));
  try {
    const W = 180, H = 320, N = 120;
    // a TEST picture: one soft white dot off-centre on black
    const pic = path.join(dir, "dot.png");
    ff(["-f", "lavfi", "-i", "color=black:s=360x640", "-frames:v", "1", "-vf", "drawbox=x=206:y=290:w=6:h=6:color=white:t=fill,gblur=sigma=4,format=gray", pic]);
    const centres = (i: number) => {
      const out = path.join(dir, `d${i}.mkv`);
      ff(["-i", pic, "-filter_complex", `[0:v]${kenBurns(i, N, W, H)},format=gray[v]`, "-map", "[v]", "-c:v", "ffv1", out]);
      return grayFrames(out, W, H).map((f) => {
        let s = 0, sx = 0, sy = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = f[y * W + x]; if (v > 6) { s += v; sx += v * x; sy += v * y; } }
        return [sx / s, sy / s];
      });
    };
    for (const i of [1, 3]) {
      // a DRIFT: about 14 px across the frame in 120 frames — 0.12 px a frame, and every frame takes its step
      const c = centres(i);
      assert.equal(c.length, N);
      const steps = c.slice(1).map((p, k) => p[0] - c[k][0]);
      const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
      assert.ok(Math.abs(Math.abs(mean) * (N - 1) - W * STILL_DRIFT_ZOOM * (1 - 1 / STILL_DRIFT_ZOOM)) < 0.5, `${stillMove(i)}: travels ${(mean * (N - 1)).toFixed(2)} px`);
      assert.ok(steps.every((s) => Math.sign(s) === Math.sign(mean) && Math.abs(s) > Math.abs(mean) * 0.6), `${stillMove(i)}: a frame stood still or stepped back (${steps.map((s) => s.toFixed(3)).join(" ")})`);
      const sd = Math.sqrt(steps.reduce((a, b) => a + (b - mean) ** 2, 0) / steps.length);
      assert.ok(sd < Math.abs(mean) * 0.2, `${stillMove(i)}: steps vary by ${sd.toFixed(3)} on ${mean.toFixed(3)}`);
    }
    // a PUSH: the dot, off-centre, creeps outward about 1.5 px in all — on its straight path in every frame (the zoompan
    // move put it up to a quarter of a pixel off its path here, frame after frame: its window on whole pixels of a 2x
    // source)
    const c = centres(0);
    const travel = Math.hypot(c[N - 1][0] - c[0][0], c[N - 1][1] - c[0][1]);
    assert.ok(travel > 1 && travel < 2.5, `push: ${travel.toFixed(2)} px in all`);
    for (const axis of [0, 1]) {
      const ys = c.map((p) => p[axis]);
      const xm = (N - 1) / 2, ym = ys.reduce((a, b) => a + b, 0) / N;
      let sxy = 0, sxx = 0;
      ys.forEach((y, k) => { sxy += (k - xm) * (y - ym); sxx += (k - xm) ** 2; });
      const b = sxy / sxx;
      const off = Math.max(...ys.map((y, k) => Math.abs(y - (ym + b * (k - xm)))));
      assert.ok(off < 0.08, `push: ${axis ? "down" : "across"}, a frame ${off.toFixed(3)} px off its path`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
