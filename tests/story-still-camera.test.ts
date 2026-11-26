/* THE CAMERA OF A STILL STORY (app/lib/narrated-core.ts → THE CAMERA OF A STILL STORY; story-motion.ts → StillCamera).
 *
 * The owner, 2026-11-26, of the still tier: "Image still story line needs optional selects for the image similar to
 * other providers (shake, slight motion, etch etch)". A still story's maker may say how its pictures move — Gentle (what
 * a still story always did), Zoom in, Zoom out, Pan, Handheld, Shake, No move — for the whole story and, if they want,
 * one picture at a time. All of it is the cut's ONE perspective pass, made by our own ffmpeg.
 *
 * These tests hold it to: each camera's moves; the default exactly S13's; the window INSIDE THE PICTURE at every frame —
 * computed, by evaluating the very expressions ffmpeg is given (a small evaluator of ffmpeg's expression language
 * below), and by ffmpeg itself at the frames where a hand comes closest to the edge; exactly the frames asked for; a
 * hand that keeps the story's clock across a part's edge; and a shake that jitters while a handheld camera sways.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { STILL_HANDS, STILL_MOVES, cameraMove, kenBurns, stillCorners, stillHandMargin, stillHeld, stillMove, stillMoves, type StillMove } from "../app/lib/narrated-core.ts";
import { STILL_CAMERAS, STILL_CAMERA_NAMES, stillCameraOf, storyCameraOf } from "../app/lib/story-motion.ts";
import { partGraph, sceneIn, storyParts } from "../app/lib/story-join.ts";

/* ---- ffmpeg's expression language, enough of it to read what stillMoves writes ----
 * numbers, W H on n, + - * /, unary minus, ( ), `;` (in order, the last one's value), and the functions stillMoves uses:
 * if lt between sin cos min max st ld (registers per expression, as ffmpeg keeps them). */
type Fn = (v: Record<string, number>, r: number[]) => number;
function compile(src: string): Fn {
  const s = src.replace(/\s+/g, "");
  let i = 0;
  const eat = (c: string) => { assert.equal(s[i], c, `expected ${c} at ${i} of ${s.slice(Math.max(0, i - 30), i + 30)}`); i++; };
  const seq = (): Fn => { const parts = [sum()]; while (s[i] === ";") { i++; parts.push(sum()); } return parts.length === 1 ? parts[0] : (v, r) => { let x = 0; for (const p of parts) x = p(v, r); return x; }; };
  const sum = (): Fn => {
    let a = term();
    while (s[i] === "+" || s[i] === "-") { const op = s[i++]; const l = a, b = term(); a = op === "+" ? (v, r) => l(v, r) + b(v, r) : (v, r) => l(v, r) - b(v, r); }
    return a;
  };
  const term = (): Fn => {
    let a = unary();
    while (s[i] === "*" || s[i] === "/") { const op = s[i++]; const l = a, b = unary(); a = op === "*" ? (v, r) => l(v, r) * b(v, r) : (v, r) => l(v, r) / b(v, r); }
    return a;
  };
  const unary = (): Fn => { if (s[i] === "-") { i++; const a = unary(); return (v, r) => -a(v, r); } if (s[i] === "+") { i++; return unary(); } return primary(); };
  const primary = (): Fn => {
    if (s[i] === "(") { i++; const e = seq(); eat(")"); return e; }
    const num = /^(\d+\.?\d*(e[+-]?\d+)?|\.\d+)/i.exec(s.slice(i));
    if (num) { i += num[0].length; const x = Number(num[0]); return () => x; }
    const id = /^[a-z_][a-z0-9_]*/i.exec(s.slice(i));
    assert.ok(id, `nothing to read at ${i}: ${s.slice(i, i + 20)}`);
    i += id![0].length;
    const name = id![0];
    if (s[i] !== "(") return (v) => { assert.ok(name in v, `unknown variable ${name}`); return v[name]; };
    i++;
    const args: Fn[] = [];
    if (s[i] !== ")") { args.push(seq()); while (s[i] === ",") { i++; args.push(seq()); } }
    eat(")");
    const [a, b, c] = args;
    switch (name) {
      case "if": return (v, r) => (a(v, r) ? b(v, r) : c ? c(v, r) : 0);
      case "lt": return (v, r) => (a(v, r) < b(v, r) ? 1 : 0);
      case "between": return (v, r) => { const x = a(v, r); return x >= b(v, r) && x <= c(v, r) ? 1 : 0; };
      case "sin": return (v, r) => Math.sin(a(v, r));
      case "cos": return (v, r) => Math.cos(a(v, r));
      case "min": return (v, r) => Math.min(a(v, r), b(v, r));
      case "max": return (v, r) => Math.max(a(v, r), b(v, r));
      case "st": return (v, r) => { const k = Math.round(a(v, r)); r[k] = b(v, r); return r[k]; };
      case "ld": return (v, r) => r[Math.round(a(v, r))] || 0;
      default: assert.fail(`a function stillMoves does not use: ${name}`);
    }
  };
  const e = seq();
  assert.equal(i, s.length, `left unread: ${s.slice(i, i + 40)}`);
  return e;
}
/** A perspective filter as stillMoves writes it → its eight corner expressions and its `enable`, compiled. */
function perspectiveOf(f: string): { corner: (on: number, W: number, H: number) => Array<[number, number]>; enabled: (n: number) => boolean } {
  assert.ok(f.startsWith("perspective="), f.slice(0, 40));
  const opts: Record<string, string> = {};
  for (const m of f.slice("perspective=".length).matchAll(/(\w+)='([^']*)'/g)) opts[m[1]] = m[2];
  for (const k of ["x0", "y0", "x1", "y1", "x2", "y2", "x3", "y3"]) assert.ok(opts[k], `${k} missing`);
  assert.ok(f.includes(":interpolation=cubic:eval=frame"), "sub-pixel, every frame");
  const c = Object.fromEntries(["x0", "y0", "x1", "y1", "x2", "y2", "x3", "y3"].map((k) => [k, compile(opts[k])]));
  const en = opts.enable ? compile(opts.enable) : null;
  return {
    corner: (on, W, H) => [0, 1, 2, 3].map((q) => [c[`x${q}`]({ on, W, H }, []), c[`y${q}`]({ on, W, H }, [])] as [number, number]),
    enabled: (n) => (en ? en({ n }, []) !== 0 : true),
  };
}

const SHAPES: ReadonlyArray<[number, number]> = [[1080, 1920], [1920, 1080], [1080, 1080]];

/* ---- THE CHOICE ---- */

test("the cameras: seven, the default first, each named short — and nothing else is one", () => {
  assert.deepEqual([...STILL_CAMERAS], ["gentle", "zoomin", "zoomout", "pan", "handheld", "shake", "still"]);
  assert.deepEqual({ ...STILL_CAMERA_NAMES }, { gentle: "Gentle", zoomin: "Zoom in", zoomout: "Zoom out", pan: "Pan", handheld: "Handheld", shake: "Shake", still: "No move" });
  for (const c of STILL_CAMERAS) assert.equal(stillCameraOf(c), c);
  assert.equal(stillCameraOf(" Shake "), "shake");
  for (const bad of ["", "zoompan", "drone", null, undefined, 3, { k: "shake" }]) assert.equal(stillCameraOf(bad), null, String(bad));
  // a finished story's record: the camera it was told with, or Gentle when it never said
  assert.equal(storyCameraOf({ stillCamera: "handheld" }), "handheld");
  assert.equal(storyCameraOf({ stillCamera: "warp" }), "gentle");
  assert.equal(storyCameraOf({}), "gentle");
  assert.equal(storyCameraOf(null), "gentle");
});

test("each camera's moves: Gentle is S13's four in turn exactly; Zoom in / out every picture; Pan crosses and comes back; a hand; nothing", () => {
  for (let i = -3; i < 40; i++) {
    assert.equal(cameraMove("gentle", i), stillMove(i), `gentle ${i}`);
    assert.equal(cameraMove(undefined, i), stillMove(i), `none is gentle ${i}`);
    assert.equal(cameraMove(null, i), stillMove(i));
    assert.equal(cameraMove("zoomin", i), "in");
    assert.equal(cameraMove("zoomout", i), "out");
    assert.equal(cameraMove("pan", i), i % 2 === 0 ? "right" : "left", `pan ${i}`);
    assert.equal(cameraMove("handheld", i), "sway");
    assert.equal(cameraMove("shake", i), "shake");
    assert.equal(cameraMove("still", i), null);
  }
  // pan: neighbours always cross the other way, across a part's edge too (scene i counted through the whole story)
  for (const p of storyParts(Array.from({ length: 13 }, () => 280)).slice(1)) assert.notEqual(cameraMove("pan", p.from), cameraMove("pan", p.from - 1));
  // THE DEFAULT IS UNCHANGED: a run of Gentle stills is S13's very filter, character for character (the pin below is
  // tests/story-still-moves.test.ts's), and the story's clock does not touch a slow move
  const gentle = stillMoves([{ move: cameraMove("gentle", 0), frames: 285 }]);
  assert.equal(gentle, "perspective=x0='W*(0.5-0.5/(1+0.1*(on-1)/284))':y0='H*(0.5-0.5/(1+0.1*(on-1)/284))':x1='W*(0.5+0.5/(1+0.1*(on-1)/284))':y1='H*(0.5-0.5/(1+0.1*(on-1)/284))':x2='W*(0.5-0.5/(1+0.1*(on-1)/284))':y2='H*(0.5+0.5/(1+0.1*(on-1)/284))':x3='W*(0.5+0.5/(1+0.1*(on-1)/284))':y3='H*(0.5+0.5/(1+0.1*(on-1)/284))':interpolation=cubic:eval=frame");
  const six = Array.from({ length: 6 }, (_, i) => ({ move: cameraMove("gentle", i), frames: 240 + i * 7 }));
  assert.equal(stillMoves(six, 1234), stillMoves(six), "a slow move is its own scene's: the story's clock never enters it");
  // a scene's camera rides into a part (story-join.ts → sceneIn): its move, or none at all for No move
  assert.equal(sceneIn(5, { still: "s.jpg", camera: "handheld" }, 270, 1080, 1920, { clips: false, moving: true }).move, "sway");
  assert.equal(sceneIn(5, { still: "s.jpg", camera: "pan" }, 270, 1080, 1920, { clips: false, moving: true }).move, "left");
  assert.deepEqual(sceneIn(5, { still: "s.jpg", camera: "still" }, 270, 1080, 1920, { clips: false, moving: true }), { input: ["-i", "s.jpg"], chain: stillHeld(270, 1080, 1920) });
  assert.equal(sceneIn(5, { still: "s.jpg" }, 270, 1080, 1920, { clips: false, moving: true }).move, "right", "no camera: Gentle's move for scene 6");
  // No move over a whole run: no pass at all
  assert.equal(stillMoves([{ move: cameraMove("still", 0), frames: 90 }, { move: cameraMove("still", 1), frames: 90 }]), "");
});

/* ---- THE HAND ---- */

test("the hand: every axis a sum of sines that never passes ±1, unrelated frequencies, a shake quicker than a sway — and its window cropped in just enough", () => {
  for (const [kind, h] of Object.entries(STILL_HANDS)) {
    for (const [ax, a] of Object.entries({ x: h.x, y: h.y, a: h.a })) {
      const w = [...a.calm, ...(a.nerves || [])].reduce((s, x) => s + Math.abs(x[1]), 0);
      assert.ok(Math.abs(w - 1) < 1e-9, `${kind}.${ax}: its weights add up to ${w}`);
      const hz = [...a.calm, ...(a.nerves || [])].map((x) => x[0]);
      // never a frequency two to seven times another (a beat the eye can learn: the same wobble, again and again), and
      // none past what 30 frames a second can show
      for (const p of hz) for (const q of hz) if (p < q && q / p < 8) assert.ok(Math.abs(q / p - Math.round(q / p)) > 0.1, `${kind}.${ax}: ${q} Hz is ${q / p} × ${p} Hz`);
      for (const f of hz) assert.ok(f > 0 && f < 7.5, `${kind}.${ax}: ${f} Hz`);
    }
    if (h.swell) assert.ok(h.swell[1] > 0 && h.swell[1] <= 0.5, "the swell runs between a share of the quick waves and all of them, never below nothing");
  }
  const fastest = (h: typeof STILL_HANDS.sway) => Math.max(...[...h.x.calm, ...(h.x.nerves || [])].map((x) => x[0]));
  assert.ok(fastest(STILL_HANDS.sway) < 1, "a handheld camera sways: nothing in it a second or quicker");
  assert.ok(fastest(STILL_HANDS.shake) > 4, "a shaking one jitters: waves of four a second and more");
  // HOW MUCH IS CROPPED, and the least room ever left: the window 1/1.07 of the picture each way (3.3% off every side),
  // and every corner inside the picture even with every wave at its peak at once — in every frame shape
  assert.equal(STILL_HANDS.sway.z, 1.07);
  assert.equal(STILL_HANDS.shake.z, 1.07);
  for (const [W, H] of SHAPES) {
    for (const m of ["sway", "shake"] as const) {
      const room = stillHandMargin(m, W, H);
      assert.ok(room >= 10, `${m} at ${W}x${H}: ${room.toFixed(1)} px of room at the very worst`);
    }
  }
  assert.ok(Math.abs(stillHandMargin("sway", 1080, 1920) - 11.2) < 0.2, `${stillHandMargin("sway", 1080, 1920)}`);
});

test("EVERY FRAME OF FIVE MINUTES: each hand's window inside the picture, at least its worst-case room from every edge — and a sway is slow, a shake quick, neither a lurch", () => {
  const N = 5 * 60 * 30;
  for (const [W, H] of SHAPES) {
    for (const m of ["sway", "shake"] as const) {
      const room = stillHandMargin(m, W, H);
      let least = Infinity, step = 0, mean = 0;
      let prev = stillCorners(m, 0, N, 0, W, H);
      for (let T = 0; T < N; T++) {
        const c = stillCorners(m, T, N, T, W, H);
        for (const [x, y] of c) least = Math.min(least, x, W - x, y, H - y);
        // how far the picture moves between two frames: the most any corner of the window travels
        const d = Math.max(...c.map(([x, y], q) => Math.hypot(x - prev[q][0], y - prev[q][1])));
        step = Math.max(step, d); mean += d / N;
        prev = c;
      }
      assert.ok(least >= room - 1e-6, `${m} at ${W}x${H}: a corner came within ${least.toFixed(2)} px of the edge (room ${room.toFixed(2)})`);
      assert.ok(least < room + 25, `${m} at ${W}x${H}: it reaches out (${least.toFixed(1)} px at its closest) — not a camera held still`);
      // (measured, Full HD: a handheld camera's corner at most 1.3 px a frame, 0.66 on average; a shake's at most 8.2,
      //  2.7 on average — a jitter, never a lurch that smears a face)
      if (m === "sway") assert.ok(step < 2 && mean < 0.9, `a handheld camera moved ${step.toFixed(2)} px in a frame (mean ${mean.toFixed(2)}) at ${W}x${H}`);
      else assert.ok(step > 4 && step < 9 && mean > 2 && mean < 3.5, `a shake moved ${step.toFixed(2)} px in a frame at most (mean ${mean.toFixed(2)}) at ${W}x${H}: nervous, never a lurch that smears a face`);
    }
  }
});

test("THE EXPRESSIONS FFMPEG IS GIVEN, evaluated at every frame: each scene its camera's window, inside the picture, the hands on the story's clock", () => {
  // a run as a story's part might hold it: a sway, a push in, a shake, a clip (untouched), a drift right, a sway again,
  // starting at frame 4321 of the story
  const run: Array<{ move: StillMove | null; frames: number }> = [
    { move: "sway", frames: 247 }, { move: "in", frames: 251 }, { move: "shake", frames: 262 }, { move: null, frames: 120 }, { move: "right", frames: 233 }, { move: "sway", frames: 240 },
  ];
  const from = 4321;
  const f = stillMoves(run, from);
  // one formula a hand however many scenes it holds: the sway is written once
  assert.equal((f.match(/st\(0,on\+4320\)/g) || []).length, 8 * 2, "each corner: one sway, one shake");
  const p = perspectiveOf(f);
  for (const [W, H] of SHAPES) {
    let at = 0;
    for (const r of run) {
      for (let k = 0; k < r.frames; k++) {
        const on = at + k + 1;
        assert.equal(p.enabled(at + k), !!r.move, `frame ${at + k}: redrawn only where a still moves`);
        if (!r.move) continue;
        const got = p.corner(on, W, H);
        const want = stillCorners(r.move, k, r.frames, from + at + k, W, H);
        for (let q = 0; q < 4; q++) {
          assert.ok(Math.abs(got[q][0] - want[q][0]) < 0.05 && Math.abs(got[q][1] - want[q][1]) < 0.05, `${r.move} frame ${k} corner ${q} at ${W}x${H}: ffmpeg's ${got[q]} against ${want[q]}`);
          assert.ok(got[q][0] >= -1e-6 && got[q][0] <= W + 1e-6 && got[q][1] >= -1e-6 && got[q][1] <= H + 1e-6, `${r.move} frame ${k}: corner ${q} leaves the picture (${got[q]})`);
        }
      }
      at += r.frames;
    }
  }
  // a whole story held in one hand: the formula alone, nothing to choose between
  const all = stillMoves([{ move: "shake", frames: 200 }, { move: "shake", frames: 210 }]);
  assert.ok(!all.includes("if(") && !all.includes("enable"), all.slice(0, 120));
  assert.ok(all.includes("st(0,on-1)"), "a story's first part counts from its first frame");
  // …and a whole story of each camera, every frame, every shape: inside the picture
  for (const cam of STILL_CAMERAS) {
    const scenes = Array.from({ length: 7 }, (_, i) => ({ move: cameraMove(cam, i), frames: 180 + ((i * 37) % 90) }));
    const s = stillMoves(scenes);
    if (cam === "still") { assert.equal(s, ""); continue; }
    const q = perspectiveOf(s);
    const total = scenes.reduce((a, b) => a + b.frames, 0);
    for (const [W, H] of SHAPES) for (let on = 1; on <= total; on++) for (const [x, y] of q.corner(on, W, H)) assert.ok(x >= -1e-6 && x <= W + 1e-6 && y >= -1e-6 && y <= H + 1e-6, `${cam} at frame ${on}, ${W}x${H}: (${x}, ${y})`);
  }
});

test("a part keeps the story's clock: its hand starts where the story's frame is (partGraph reads it from the part's clock)", () => {
  // the second part of a story starts at frame 1452: its clock is the millionths of a second to there
  const clock = Math.round((1452 * 1e6) / 30);
  const g = partGraph(["A", "B"], [240, 250], [], clock, ["sway", "shake"]);
  assert.ok(g.includes("st(0,on+1451)"), g.slice(0, 200));
  // and the first part from 0
  assert.ok(partGraph(["A"], [240], [], 0, ["sway"]).includes("st(0,on-1)"));
});

/* ---- MADE BY FFMPEG ---- */

const ffmpegOk = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0;
const ff = (args: string[]): void => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8", maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr);
};
const rawFrames = (file: string, W: number, H: number, fmt: "gray" | "rgb24"): Uint8Array[] => {
  const px = fmt === "gray" ? 1 : 3;
  const raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", fmt, "pipe:1"], { encoding: "buffer", maxBuffer: 1 << 30 }).stdout;
  const out: Uint8Array[] = [];
  for (let k = 0; k + W * H * px <= raw.length; k += W * H * px) out.push(raw.subarray(k, k + W * H * px));
  return out;
};

test("EXACTLY the frames asked for, for every camera, in every frame shape", { skip: !ffmpegOk }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "still-camera-frames-"));
  try {
    const pic = path.join(dir, "test-picture.png");
    ff(["-f", "lavfi", "-i", "testsrc2=s=400x720", "-frames:v", "1", "-vf", "lutyuv=y='clipval*0.6+80'", pic]);
    for (const [w, h] of [[180, 320], [320, 180], [240, 240]]) {
      for (const cam of STILL_CAMERAS) {
        const fr = [37, 29];
        const out = path.join(dir, `${cam}-${w}.mkv`);
        const mv = stillMoves(fr.map((n, i) => ({ move: cameraMove(cam, i), frames: n })));
        const graph = [`[0:v]${stillHeld(fr[0], w, h)}[c0]`, `[1:v]${stillHeld(fr[1], w, h)}[c1]`, `[c0][c1]concat=n=2:v=1:a=0${mv ? `,${mv}` : ""}[v]`].join(";");
        ff(["-i", pic, "-i", pic, "-filter_complex", graph, "-map", "[v]", "-c:v", "ffv1", out]);
        const frames = rawFrames(out, w, h, "gray");
        assert.equal(frames.length, fr[0] + fr[1], `${cam} at ${w}x${h}: exactly its frames`);
        let d = 0; for (let q = 0; q < w * h; q++) d = Math.max(d, Math.abs(frames[0][q] - frames[fr[0] - 1][q]));
        if (cam === "still") assert.equal(d, 0, "No move does not move");
        else assert.ok(d > 20, `${cam} at ${w}x${h} did not move (${d})`);
      }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("NO EDGE SHOWS AT THE EXTREMES: each hand cut by ffmpeg, Full-HD, around the frames where it comes closest to the picture's edge", { skip: !ffmpegOk }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "still-camera-edge-"));
  try {
    for (const [W, H] of SHAPES) {
      // a TEST picture the frame's own size: grey texture (no colour in it at all) inside a MAGENTA band 3 px wide at its
      // very edge — if a window ever reached the picture's edge (or bicubic reached past it), magenta would show
      const pic = path.join(dir, `edge-${W}x${H}.png`);
      ff(["-f", "lavfi", "-i", `testsrc2=s=${W}x${H}`, "-frames:v", "1", "-vf", `format=gray,format=rgb24,drawbox=x=0:y=0:w=${W}:h=${H}:color=0xFF00FF:t=3`, pic]);
      for (const m of ["sway", "shake"] as const) {
        // where, in five minutes, the window comes closest to an edge
        let worst = 0, least = Infinity;
        for (let T = 0; T < 9000; T++) for (const [x, y] of stillCorners(m, T, 9000, T, W, H)) { const r = Math.min(x, W - x, y, H - y); if (r < least) { least = r; worst = T; } }
        // cut 9 frames around it, as a part starting there would be
        const from = Math.max(0, worst - 4);
        const out = path.join(dir, `${m}-${W}x${H}.mkv`);
        ff(["-i", pic, "-filter_complex", `[0:v]${stillHeld(9, W, H)},${stillMoves([{ move: m, frames: 9 }], from)},format=rgb24[v]`, "-map", "[v]", "-c:v", "ffv1", out]);
        const frames = rawFrames(out, W, H, "rgb24");
        assert.equal(frames.length, 9);
        let magenta = 0;
        for (const fr of frames) for (let q = 0; q < W * H; q++) { const r = fr[q * 3], g = fr[q * 3 + 1], b = fr[q * 3 + 2]; if (r - g > 60 && b - g > 60) magenta++; }
        assert.equal(magenta, 0, `${m} at ${W}x${H}, frames ${from}–${from + 8} (closest ${least.toFixed(1)} px at ${worst}): ${magenta} magenta pixels`);
      }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a hand across a part's edge: the story cut in two parts is frame for frame the story cut once", { skip: !ffmpegOk }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "still-camera-parts-"));
  try {
    const W = 180, H = 320;
    const pic = path.join(dir, "p.png");
    ff(["-f", "lavfi", "-i", "testsrc2=s=400x720", "-frames:v", "1", "-vf", "lutyuv=y='clipval*0.6+80'", pic]);
    const fr = [40, 33, 45];
    const moves: Array<StillMove | null> = ["sway", "shake", "sway"];
    const chains = fr.map((n) => stillHeld(n, W, H));
    // once: the three scenes and their moves in one pass
    const one = path.join(dir, "one.mkv");
    ff([...fr.flatMap(() => ["-i", pic]), "-filter_complex", partGraph(chains, fr, [], 0, moves), "-map", "[v]", "-c:v", "ffv1", one]);
    // in parts: the first scene, then the other two — the second part on the story's clock where the first ends
    const a = path.join(dir, "a.mkv"), b = path.join(dir, "b.mkv");
    ff(["-i", pic, "-filter_complex", partGraph(chains.slice(0, 1), fr.slice(0, 1), [], 0, moves.slice(0, 1)), "-map", "[v]", "-c:v", "ffv1", a]);
    ff(["-i", pic, "-i", pic, "-filter_complex", partGraph(chains.slice(1), fr.slice(1), [], Math.round((fr[0] * 1e6) / 30), moves.slice(1)), "-map", "[v]", "-c:v", "ffv1", b]);
    const O = rawFrames(one, W, H, "gray"), P = [...rawFrames(a, W, H, "gray"), ...rawFrames(b, W, H, "gray")];
    assert.equal(O.length, fr[0] + fr[1] + fr[2]);
    assert.equal(P.length, O.length);
    let worst = 0, at = -1;
    for (let k = 0; k < O.length; k++) for (let q = 0; q < W * H; q++) { const d = Math.abs(O[k][q] - P[k][q]); if (d > worst) { worst = d; at = k; } }
    assert.ok(worst <= 2, `the parts differ from the one cut by ${worst} at frame ${at}`);
    // and it does move across the edge: the part's first frame is not the story's first frame again
    let d = 0; for (let q = 0; q < W * H; q++) d = Math.max(d, Math.abs(O[fr[0]][q] - O[0][q]));
    assert.ok(d > 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("SEEN: a TEST dot under each hand lands, in every frame ffmpeg makes, where the window says — within a tenth of a pixel or so", { skip: !ffmpegOk }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "still-camera-dot-"));
  try {
    const W = 540, H = 960, N = 150, P = [270, 480];
    const pic = path.join(dir, "dot.png");
    ff(["-f", "lavfi", "-i", "color=black:s=540x960", "-frames:v", "1", "-vf", "drawbox=x=266:y=476:w=8:h=8:color=white:t=fill,gblur=sigma=4,format=gray", pic]);
    const steps: Record<string, number[]> = {};
    for (const m of ["sway", "shake"] as const) {
      const out = path.join(dir, `${m}.mkv`);
      ff(["-i", pic, "-filter_complex", `[0:v]${stillHeld(N, W, H)},${stillMoves([{ move: m, frames: N }])},format=gray[v]`, "-map", "[v]", "-c:v", "ffv1", out]);
      const seen = rawFrames(out, W, H, "gray").map((f) => {
        let s = 0, sx = 0, sy = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = f[y * W + x]; if (v > 6) { s += v; sx += v * x; sy += v * y; } }
        return [sx / s, sy / s];
      });
      assert.equal(seen.length, N);
      seen.forEach(([gx, gy], k) => {
        // where the dot must be: the window (its centre, its turn, its zoom) undone around the frame's centre
        const c = stillCorners(m, k, N, k, W, H);
        const C = [(c[0][0] + c[3][0]) / 2, (c[0][1] + c[3][1]) / 2];
        const th = Math.atan2(c[1][1] - c[0][1], c[1][0] - c[0][0]);
        const z = W / Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]);
        const dx = P[0] - C[0], dy = P[1] - C[1];
        const ex = W / 2 + z * (dx * Math.cos(th) + dy * Math.sin(th)) - 0.5, ey = H / 2 + z * (-dx * Math.sin(th) + dy * Math.cos(th)) - 0.5;
        assert.ok(Math.hypot(gx - ex, gy - ey) < 0.2, `${m}, frame ${k}: the dot at (${gx.toFixed(2)}, ${gy.toFixed(2)}), the window says (${ex.toFixed(2)}, ${ey.toFixed(2)})`);
      });
      steps[m] = seen.slice(1).map((p, k) => Math.hypot(p[0] - seen[k][0], p[1] - seen[k][1]));
    }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    // …and so, seen: a handheld camera wanders (under a pixel a frame at half HD), a shake jitters several times quicker
    assert.ok(Math.max(...steps.sway) < 1, `handheld: ${Math.max(...steps.sway).toFixed(3)} px in a frame`);
    assert.ok(mean(steps.shake) > 3 * mean(steps.sway) && Math.max(...steps.shake) < 4.5, `shake ${mean(steps.shake).toFixed(3)} (at most ${Math.max(...steps.shake).toFixed(2)}) against handheld ${mean(steps.sway).toFixed(3)} px a frame`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("kenBurns is still Gentle's move said for one scene (the default untouched)", () => {
  for (let i = 0; i < 4; i++) assert.equal(kenBurns(i, 120, 180, 320), `${stillHeld(120, 180, 320)},${stillMoves([{ move: STILL_MOVES[i], frames: 120 }])}`);
});
