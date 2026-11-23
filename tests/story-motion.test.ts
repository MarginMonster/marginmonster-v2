/* A STORY'S PICTURES MOVE.
 *
 * A tester, 2026-11-23, on Moral Story, Horror Story and Short Story alike: "they only stop screen on one
 * image and play voice … change picture like screen not moving anything … previously they work good but
 * now … they just play voice and pics, not scene like video." A narrated story was a voice over still
 * pictures with a push-in too slow to see.
 *
 * Each scene's own picture is now played as one continuous moving shot for as long as the scene is told
 * (app/lib/story-motion.ts, story-motion.server.ts). Tried that day on real story pictures; the cut was run
 * for real with these very filter chains: 251 + 438 + 186 frames asked, 875 made.
 *
 *   1. THE ARITHMETIC is run here: the length asked for, how a clip fills a scene it is shorter than, when a
 *      kept clip serves another telling, what it costs.
 *   2. THE PROMISES that keep a story safe are pinned by reading the source: a scene whose clip fails keeps
 *      its still, a cut that fails with clips is made again without them, a clip is asked for once. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MOTION_KEEP_DAYS, MOTION_MAX_S, MOTION_MAX_SCENES, MOTION_MIN_S, MOTION_REUSE_SHARE, MOTION_STRETCH_MAX, MOTION_USD_PER_SECOND,
  STORY_MOTION_MODEL, fitMotion, isMotionClip, motionChain, motionCost, motionName, motionOn, motionPrompt, motionReusable, motionSeconds, storyTypicalSeconds,
} from "../app/lib/story-motion.ts";
import { falVideoBody } from "../app/lib/fal-video-body.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("a scene is ONE clip as long as it is told — within what the engine makes", () => {
  assert.equal(MOTION_MIN_S, 2);
  assert.equal(MOTION_MAX_S, 12);
  assert.equal(motionSeconds(8.37), 9, "a whole second more than it needs, never less");
  assert.equal(motionSeconds(10), 10);
  assert.equal(motionSeconds(10.01), 11);
  assert.equal(motionSeconds(14.6), 12, "the longest it makes");
  assert.equal(motionSeconds(1.2), 2, "the shortest");
  assert.equal(motionSeconds(NaN), 5);
  // what is asked of the provider: the picture, the words, 720p, the seconds as it wants them — and nothing
  // it would refuse (it takes no negative prompt and no sound)
  const body = falVideoBody(STORY_MOTION_MODEL, { startImage: "https://x.test/renders/img-1.jpg", prompt: "p", durationSec: motionSeconds(9.4) });
  assert.deepEqual(body, { prompt: "p", image_url: "https://x.test/renders/img-1.jpg", resolution: "720p", duration: "10" });
  assert.equal(STORY_MOTION_MODEL, "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video");
});

test("a clip shorter than its scene is slowed a little, then its last frame holds — a longer one is simply cut", () => {
  assert.deepEqual(fitMotion(10.04, 8.37), { speed: 1, hold: 0 });
  assert.deepEqual(fitMotion(10, 10), { speed: 1, hold: 0 });
  const slow = fitMotion(10, 12);
  assert.ok(Math.abs(slow.speed - 1.2) < 1e-9 && slow.hold === 0, "slowed to fit, nothing held");
  const long = fitMotion(10.04, 14.6);
  assert.equal(long.speed, MOTION_STRETCH_MAX, "never slower than this");
  assert.ok(Math.abs(long.hold - (14.6 - 10.04 * 1.25)) < 1e-9);
  assert.ok(long.hold > 2 && long.hold < 2.1);
  // nothing known about the clip: it is used as it is
  assert.deepEqual(fitMotion(0, 9), { speed: 1, hold: 0 });
  assert.deepEqual(fitMotion(NaN, 9), { speed: 1, hold: 0 });
  // the chain: slowed BEFORE it is put on the story's thirty frames a second, the story's own size, a
  // second of held frame always there to be trimmed, and exactly the frames of its window
  const chain = motionChain(long, 438, 720, 1280);
  assert.equal(chain, "setpts=1.2500*PTS,fps=30,scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=3.05,trim=end_frame=438,setpts=PTS-STARTPTS");
  assert.equal(motionChain({ speed: 1, hold: 0 }, 251, 1280, 720), "fps=30,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=1.00,trim=end_frame=251,setpts=PTS-STARTPTS");
  // the still beside it is the same kind of picture (two different pixel formats cannot be joined)
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("? `[${i}:v]${motionChain(m.fit, frames[i], o.W, o.H)}[c${i}]`"));
  assert.ok(nar.includes("? `[${i}:v]${kenBurns(i, frames[i], o.W, o.H)},format=yuv420p[c${i}]`"));
});

test("the same picture told again moves without being paid for twice — a re-drawn one does not", () => {
  assert.equal(motionName("/data/renders/img-1795454456667-16cc1ad934d7cdf1c9.jpg"), "img-1795454456667-16cc1ad934d7cdf1c9.mv.mp4");
  assert.equal(motionName("C:\\data\\renders\\nst-17-2-ab.jpg.n.jpg"), "nst-17-2-ab.jpg.n.mv.mp4", "a picture with its bars cropped off is its own picture");
  assert.equal(motionName("x.PNG"), "x.mv.mp4");
  assert.notEqual(motionName("img-1.jpg"), motionName("img-2.jpg"));
  assert.ok(isMotionClip("img-1.mv.mp4") && !isMotionClip("nar-1.mp4") && !isMotionClip("img-1.mv.mp4.raw.mp4"));
  // told again in Spanish the scene runs 11.2 s where it ran 10: the ten-second clip serves
  assert.equal(motionReusable(10.04, 11.2), true);
  assert.equal(motionReusable(10.04, 16), true, "a scene past the engine's twelve seconds is asked about as twelve");
  assert.equal(motionReusable(5, 12), false, "too short to stand for it");
  assert.equal(motionReusable(0, 5), false);
  assert.equal(motionReusable(0.8, 1.2), false, "a file that hardly plays is not a clip");
  assert.equal(MOTION_REUSE_SHARE, 0.6);
  // a kept clip is a cache: cleared after a week, and only ever by its own name
  assert.equal(MOTION_KEEP_DAYS, 7);
});

test("what it is told — the scene as written, nobody talking, nothing changed", () => {
  const p = motionPrompt("Pip and Tansy walk together along the path,\n Pip balancing apples atop Tansy's broad shell.");
  assert.ok(p.startsWith("Pip and Tansy walk together along the path, Pip balancing apples atop Tansy's broad shell. One continuous shot of this exact picture coming to life:"));
  assert.ok(p.includes("Nobody speaks — mouths stay closed, or only smile, gasp or react."), "a told story: a mouth moving under the narrator reads as a fault");
  assert.ok(p.includes("Everyone and everything stays exactly as drawn — the same faces, the same designs, the same place; nothing new appears, nobody leaves, no cuts, no writing."));
  assert.ok(p.includes("The camera drifts slowly forward, steady and smooth."));
  // a scene with nothing written still moves; a very long description is cut, the rules never are
  assert.ok(motionPrompt("").startsWith("One continuous shot"));
  const long = motionPrompt("x".repeat(2000));
  assert.ok(long.length < 1200 && long.endsWith("no cuts, no writing."));
});

test("what it costs is known, and it can be turned off", () => {
  assert.equal(MOTION_USD_PER_SECOND, 0.0216);
  // fal's page: $1 per million tokens, tokens = height × width × fps × seconds / 1024
  assert.ok(Math.abs((720 * 1280 * 24) / 1024 / 1_000_000 - MOTION_USD_PER_SECOND) < 1e-9);
  assert.equal(motionCost([12, 10, 9, 10, 12, 12]), 1.4, "a six-scene story of about a minute");
  assert.equal(motionCost([]), 0);
  assert.equal(motionOn({}, true), true);
  assert.equal(motionOn({ STORY_MOTION: "off" }, true), false);
  assert.equal(motionOn({ STORY_MOTION: " OFF " }, true), false);
  assert.equal(motionOn({ STORY_MOTION: "on" }, true), true);
  assert.equal(motionOn({}, false), false, "no provider key: the stories are told over stills, as before");
  assert.equal(motionOn(undefined, true), true);
  // every scene of the longest story a maker can ask for moves — never ten that do and two that stand still
  assert.equal(MOTION_MAX_SCENES, 12);
  assert.ok(read("app", "routes", "web.film.tsx").includes("narratedScenes: { min: 3, max: 12, def: 6 },"));
  assert.equal(motionCost(Array.from({ length: 12 }, () => 12)), 3.11, "the most a story's motion can cost");
});

test("the wait is said honestly: a story whose pictures move takes minutes longer", () => {
  // over stills, as it was measured: sixty seconds and twelve a scene
  assert.equal(storyTypicalSeconds(6, false), 132);
  assert.equal(storyTypicalSeconds(4, false), 108);
  // moving: a clip a scene, three at a time (about a minute and a quarter a wave), and each brought to size
  assert.equal(storyTypicalSeconds(6, true), 132 + 40 + 2 * 75 + 6 * 8);
  assert.equal(storyTypicalSeconds(3, true), 96 + 40 + 75 + 24);
  assert.ok(storyTypicalSeconds(12, true) < 12 * 60, "the longest story is still under twelve minutes");
  assert.equal(storyTypicalSeconds(0, false), storyTypicalSeconds(1, false));
  // the Archive's card counts down from it, and the builder says it beside Generate
  const arch = read("app", "routes", "web.archive.tsx");
  assert.ok(arch.includes("? storyTypicalSeconds(typeof p.filmScenes === \"number\" ? p.filmScenes : 6, storyMotionOn())"));
  const film = read("app", "routes", "web.film.tsx");
  assert.ok(film.includes("storyMotion: storyMotionOn(),"));
  assert.ok(film.includes("if (opts.moves) { const s = storyTypicalSeconds(n, true); lo = Math.max(3, Math.round((s * 0.8) / 60)); hi = Math.round((s * 1.35) / 60); }"));
  assert.ok(film.includes("narrated, moves: d.storyMotion, scenes, engine: dialogueEngine })}"));
  // …and the storyboard says the pictures will move, in every language
  assert.ok(film.includes("{d.storyMotion ? <> {t(\"In the finished story every picture moves.\")}</> : null}"));
  assert.equal(read("app", "lib", "ui-i18n-dict.ts").split("\n  \"In the finished story every picture moves.\": ").length - 1, 5);
});

test("a kept clip is cleared after a week — by its own name, and nothing else is touched", () => {
  const sc = read("app", "lib", "storage-cleanup.server.ts");
  assert.ok(sc.includes("if (!isMotionClip(n)) continue;"));
  assert.ok(sc.includes("const cutoff = now - MOTION_KEEP_DAYS * 86_400_000;"));
  assert.ok(sc.includes("if (st.isFile() && st.mtimeMs < cutoff) { fs.rmSync(fp, { force: true }); freed++; }"));
  assert.ok(sc.includes("await purgeOverlaySources(rendersDir, now);\n  purgeMotionClips(rendersDir, now);"));
  // the operator is shown what moved and what was paid for; a member is not sent it
  const arch = read("app", "routes", "web.archive.tsx");
  assert.ok(arch.includes("opsMotion: operator ? (() => { try { const m = JSON.parse(a.metaJson || \"{}\").motion; return m && typeof m === \"object\" ? m : undefined; } catch { return undefined; } })() : undefined,"));
  assert.ok(!arch.includes("a.opsMotion") && !arch.includes("viewer.opsMotion"));
});

test("a clip never costs a story", () => {
  const srv = read("app", "lib", "story-motion.server.ts");
  // each scene by itself: one that fails is written down and keeps its still
  assert.ok(srv.includes("try { out.clips[i] = await clipFor(i); }\n        catch (e) { out.faults.push({ scene: i + 1, error: "));
  // asked for ONCE: a kept clip is used, a job that starts again picks its request up by id
  assert.ok(srv.includes("if (fs.existsSync(file) && motionReusable(seconds(file), need)) { out.reused++; return file; }"));
  assert.ok(srv.includes("let id = ids[name];\n      if (!id) {\n        id = await falVideoSubmit(STORY_MOTION_MODEL, "));
  assert.ok(srv.includes("ids[name] = id;\n        out.seconds += ask;\n        await saveIds();"), "the id is saved before the wait");
  assert.ok(srv.includes("if (!/still running/.test(e instanceof Error ? e.message : \"\")) { delete ids[name];"), "a clip still being made keeps its id for the next try");
  // one clip a picture — a scene that borrowed its neighbour's picture does not buy a second
  assert.ok(srv.includes("const had = making.get(name);\n    if (had) return had;"));
  // the job says it is alive while it waits, and the wait is bounded
  assert.ok(srv.includes("setInterval(() => { void checkpointJob(o.jobId!, { ckBeat: Date.now() }).catch(() => undefined); }, 45_000)"));
  assert.ok(srv.includes("const CLIP_WAIT_MS = 7 * 60_000;"));
  assert.ok(srv.includes("while (next < Math.min(N, MOTION_MAX_SCENES)) {"));
  // kept small: the story's own size, no sound
  assert.ok(srv.includes("\"-an\", \"-vf\", `scale=${o.W}:${o.H}:force_original_aspect_ratio=increase,crop=${o.W}:${o.H},setsar=1`,"));

  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("if (storyMotionOn()) {\n    try {"), "the whole step is tried, and a story is told over stills if it cannot be");
  assert.ok(nar.includes("the pictures could not be brought to life — told over the still pictures"));
  // the engine is given the picture that goes into the cut (bars cropped off), and each scene's own length
  assert.ok(nar.includes("for (const s of stills) seeds.push(await withoutBars(s));"));
  assert.ok(nar.includes("told: windows.map((w, i) => (i === windows.length - 1 ? end : w.t1) - w.t0),"));
  assert.ok(nar.includes("await assembleNarrated({ stills, clips: motion?.clips, windows,"));
  // the cut: with the moving scenes first — and if that fails, the same story from its stills
  assert.ok(nar.includes("if (anyMoves) {\n      const run = await runFfmpeg(build(true, true, true));\n      if (run.status === 0 && produced()) return;"));
  assert.ok(nar.includes("const run = await runFfmpeg(build(withCaps, kb, mus, false, false));"), "every older rung is cut without clips");
  assert.ok(nar.includes("if (!c || !fs.existsSync(c)) return null;"), "a clip that is not on the disk is not a clip");
  // the piece says what moved, what was paid for, and why any scene did not
  assert.ok(nar.includes("...(motion ? { motion: { engine: STORY_MOTION_ENGINE, scenes: motion.clips.filter(Boolean).length, of: stills.length, made: motion.made, reused: motion.reused, seconds: motion.seconds, ...(motion.faults.length ? { faults: motion.faults.slice(0, 8) } : {}) } } : {}),"));
  // a job that starts again is handed the clips it was waiting for
  const jq = read("app", "lib", "job-queue.server.ts");
  assert.ok(jq.includes("ckMotion: payload.ckMotion as string | undefined,"));
});
