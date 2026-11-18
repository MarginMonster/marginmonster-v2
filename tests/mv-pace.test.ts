/* The pace of a music video: more scene changes for a faster genre — without ever moving a shot of the
 * artist singing out of sync.
 *
 * The owner asked for it (2026-11-17): "Rap would be fast more scene changes. Unless we do a set the
 * pace or style". A music video here is N ten-second clips on one continuous song; a performance clip
 * was lip-synced to ITS ten seconds of that song. So the edit may cut away from a performance and come
 * back, and may shuffle cut-scene footage freely — but footage of the singer must play at exactly the
 * place in the song it was made for. These pin that, and that the video is still the length that was
 * picked, to the frame. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GENRE_PACE, PACES, PACE_KEYS, cutCount, editPlan, isPace, paceFor, planFilter, type Cut, type Pace, type ShotRole } from "../app/lib/mv-pace.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const D = 10;
// the director's cadence the pipeline and the builder share (b-roll, perform, b-roll, perform, b-roll, b-roll, perform, b-roll)
const CADENCE: ShotRole[] = ["broll", "perform", "broll", "perform", "broll", "broll", "perform", "broll"];
const rolesFor = (n: number): ShotRole[] => (n <= 1 ? ["perform"] : n === 2 ? ["perform", "broll"] : Array.from({ length: n }, (_, i) => CADENCE[i % CADENCE.length]));
/** Each cut with where it falls on the finished video's timeline. */
const onTimeline = (cuts: Cut[]) => { let t = 0; return cuts.map((c) => { const at = t; t += c.dur; return { ...c, at }; }); };

test("the genre sets the pace, and a pick overrules it", () => {
  assert.equal(paceFor("rap"), "fast");
  assert.equal(paceFor("pop"), "fast");
  assert.equal(paceFor("country"), "slow", "country keeps the long shots its approved videos were cut with");
  assert.equal(paceFor("rap", "slow"), "slow");
  assert.equal(paceFor("country", "fast"), "fast");
  // an unknown genre, or a pick that is not a pace, never breaks a render
  assert.equal(paceFor("polka"), "medium");
  assert.equal(paceFor(undefined, "ludicrous"), "medium");
  for (const junk of ["", "FAST", "quick", null, undefined, 3]) assert.equal(isPace(junk), false);
  // every genre the Music Video offers has a pace of its own
  const engine = fs.readFileSync(path.join(root, "app", "lib", "film-engine.server.ts"), "utf8");
  const genres = [...engine.slice(engine.indexOf("export const GENRES"), engine.indexOf("export const GENRE_KEYS")).matchAll(/^\s{2}(\w+):\s*\{ label:/gm)].map((m) => m[1]);
  assert.ok(genres.length >= 5, `found only ${genres.length} genres`);
  for (const g of genres) assert.ok(isPace(GENRE_PACE[g]), `genre "${g}" has no pace`);
});

test("slow is every clip whole — exactly the video as it was before pace existed", () => {
  for (const n of [1, 2, 3, 6, 12]) {
    assert.deepEqual(editPlan(rolesFor(n), D, "slow"), rolesFor(n).map((_, i) => ({ src: i, start: 0, dur: D })));
  }
});

test("a video with nothing to cut away to is left alone at any pace", () => {
  for (const pace of PACE_KEYS) {
    assert.deepEqual(editPlan(["perform"], D, pace), [{ src: 0, start: 0, dur: D }]);
    assert.deepEqual(editPlan(["perform", "perform", "perform"], D, pace), [0, 1, 2].map((i) => ({ src: i, start: 0, dur: D })));
  }
});

test("every edit is exactly the picked length, and never reads past the end of a clip", () => {
  for (const pace of PACE_KEYS) {
    for (let n = 1; n <= 12; n++) {
      const cuts = editPlan(rolesFor(n), D, pace);
      const total = cuts.reduce((a, c) => a + c.dur, 0);
      assert.ok(Math.abs(total - n * D) < 1e-9, `${pace} × ${n} scenes adds up to ${total}s, not ${n * D}s`);
      for (const c of cuts) {
        assert.ok(c.src >= 0 && c.src < n, `cut from a clip that does not exist (${c.src} of ${n})`);
        assert.ok(c.start >= 0 && c.dur > 0 && c.start + c.dur <= D + 1e-9, `cut ${JSON.stringify(c)} runs outside its ${D}s clip`);
      }
    }
  }
});

test("a shot of the artist singing only ever plays at its own place in the song", () => {
  // THE rule: a performance clip was lip-synced to seconds [i×D, i×D+D) of the track.
  for (const pace of PACE_KEYS) {
    for (let n = 2; n <= 12; n++) {
      const roles = rolesFor(n);
      for (const c of onTimeline(editPlan(roles, D, pace))) {
        if (roles[c.src] !== "perform") continue;
        assert.ok(Math.abs(c.at - (c.src * D + c.start)) < 1e-9, `${pace} × ${n}: performance clip ${c.src} (from ${c.start}s) plays at ${c.at}s — out of sync`);
      }
    }
  }
  // and the same when the maker has flipped scenes in the storyboard
  const flipped: ShotRole[] = ["perform", "perform", "broll", "perform", "broll", "perform"];
  for (const pace of PACE_KEYS) for (const c of onTimeline(editPlan(flipped, D, pace))) {
    if (flipped[c.src] === "perform") assert.ok(Math.abs(c.at - (c.src * D + c.start)) < 1e-9);
  }
});

test("a faster pace is more scene changes", () => {
  for (const n of [3, 6, 9, 12]) {
    const [slow, medium, fast] = PACE_KEYS.map((p) => cutCount(rolesFor(n), D, p));
    assert.equal(slow, n - 1);
    assert.ok(medium > slow, `${n} scenes: medium (${medium} cuts) is no faster than slow (${slow})`);
    assert.ok(fast > medium, `${n} scenes: fast (${fast} cuts) is no faster than medium (${medium})`);
  }
  // a one-minute rap video: a cut roughly every three seconds, not every ten
  const fast = editPlan(rolesFor(6), D, "fast");
  assert.ok(fast.length >= 18, `only ${fast.length} shots in a fast one-minute video`);
  assert.ok(Math.max(...fast.map((c) => c.dur)) <= 5 + 1e-9, "no shot longer than five seconds at a fast pace");
});

test("on a fast cut the singer is cut away FROM, and comes back", () => {
  const roles = rolesFor(3); // cut scene, performance, cut scene
  const perf = onTimeline(editPlan(roles, D, "fast")).filter((c) => c.at >= 10 - 1e-9 && c.at < 20 - 1e-9);
  // the performance's ten seconds: singer (5s) · a cutaway (2.5s) · singer again (2.5s)
  assert.deepEqual(perf.map((c) => [roles[c.src], c.dur]), [["perform", 5], ["broll", 2.5], ["perform", 2.5]]);
  assert.equal(perf[0].src, 1);
  assert.equal(perf[2].src, 1);
  assert.equal(perf[2].start, 7.5, "the singer comes back where the song is, not where they left off");
  // medium leaves a performance whole
  assert.ok(editPlan(roles, D, "medium").some((c) => c.src === 1 && c.start === 0 && c.dur === D));
});

test("cut scenes trade beats with each other, never with themselves when there is another", () => {
  const roles = rolesFor(3);
  const first = onTimeline(editPlan(roles, D, "fast")).filter((c) => c.at < 10 - 1e-9);
  assert.deepEqual(first.map((c) => c.src), [0, 2, 0, 2], "scene one alternates with the other cut scene");
  // with a single cut scene there is nobody to trade with: it plays through
  assert.ok(editPlan(["perform", "broll"], D, "fast").some((c) => c.src === 1 && c.dur === D));
});

test("the builder shows what the pipeline cuts", () => {
  for (const p of PACE_KEYS) assert.ok(PACES[p].label && PACES[p].blurb && PACES[p].beats >= 1);
  const film = fs.readFileSync(path.join(root, "app", "routes", "web.film.tsx"), "utf8");
  assert.ok(film.includes('name="filmPace" value={mvPace}'), "the builder sends the pace it shows");
  const pipeline = fs.readFileSync(path.join(root, "app", "lib", "music-video-pipeline.server.ts"), "utf8");
  assert.ok(pipeline.includes("paceFor(genre, opts.pace)"), "the pipeline cuts to the genre's pace unless one was picked");
  assert.ok(pipeline.includes("good.length === scenes.length ? editPlan("), "a video with a scene missing is joined whole — its clips are no longer at their own place in the song");
  const queue = fs.readFileSync(path.join(root, "app", "lib", "job-queue.server.ts"), "utf8");
  assert.ok(queue.includes("payload.filmPace"), "the queue carries the pace to the render");
});

test("the edit ffmpeg makes is the picked length to the frame", { skip: spawnSync("ffmpeg", ["-version"]).status !== 0 && "ffmpeg is not on this machine" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pace-"));
  try {
    const n = 3, fps = 30, d = 4; // three 4-second clips keep the test quick; the maths is the same
    const clips: string[] = [];
    for (let i = 0; i < n; i++) {
      const f = path.join(dir, `c${i}.mp4`);
      // each clip a different flat colour, so a frame says which clip it came from
      const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=${["red", "green", "blue"][i]}:s=64x64:r=${fps}:d=${d}`, "-pix_fmt", "yuv420p", f], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      clips.push(f);
    }
    for (const pace of ["medium", "fast"] as Pace[]) {
      const cuts = editPlan(["broll", "perform", "broll"], d, pace);
      const out = path.join(dir, `${pace}.mp4`);
      const args = ["-hide_banner", "-loglevel", "error", "-y"];
      clips.forEach((c) => args.push("-i", c));
      const r = spawnSync("ffmpeg", [...args, "-filter_complex", planFilter(cuts, n, fps), "-map", "[v]", "-an", "-pix_fmt", "yuv420p", out], { encoding: "utf8" });
      assert.equal(r.status, 0, `${pace}: ${r.stderr.slice(-300)}`);
      const frames = parseInt(spawnSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", out], { encoding: "utf8" }).stdout.trim(), 10);
      assert.equal(frames, n * d * fps, `${pace}: ${frames} frames, expected ${n * d * fps}`);
    }
    // a clip used more than once is split, a clip used once is read straight
    const g = planFilter([{ src: 0, start: 0, dur: 2 }, { src: 1, start: 0, dur: 2 }, { src: 0, start: 2, dur: 2 }], 2, 30);
    assert.ok(g.startsWith("[0:v]split=2[s0_0][s0_1];"));
    assert.ok(g.includes("[1:v]trim=start_frame=0:end_frame=60"));
    assert.ok(g.endsWith("concat=n=3:v=1:a=0[v]"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
