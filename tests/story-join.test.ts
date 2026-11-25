/* A LONG TOLD STORY IS CUT IN PARTS, and read in parts when it is longer than the voice reads at once
 * (app/lib/story-join.ts). The owner, 2026-11-25, of the Length step: "a sexy slider allowing up to 5 minutes".
 * Five minutes of a told story is thirty-two scenes; until that morning a story was twelve at most, cut in ONE
 * ffmpeg. A story longer than twelve scenes is now cut a few scenes at a time, its sound mixed once, and the parts
 * put end to end — and the film that comes out is, frame for frame, the one a single cut makes. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NARRATION_MAX_CHARS, STORY_ONE_CUT, STORY_PART_SCENES, STORY_PICTURE, cardsDuring, exactly, partGraph, readingParts, sceneIn, storyJoinArgs, storyPartArgs, storyParts, storySoundArgs,
} from "../app/lib/story-join.ts";
import { joinCheck, joinList, JOIN_TOLERANCE } from "../app/lib/acted-staging.ts";
import { captionFilters, kenBurns } from "../app/lib/narrated-core.ts";
import { fitMotion, motionChain } from "../app/lib/story-motion.ts";
import { maxShots } from "../app/lib/film-length.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

/* ---- THE PARTS ---- */

test("a story of up to six scenes is cut whole; a longer one in parts of six at most, as even as they come", () => {
  // (12 at 720p was cut every day; at Full HD a 12-scene story's one cut ran the 2 GB server out of memory, four times,
  //  2026-11-25 — six at most in one ffmpeg, the parts' own size)
  assert.equal(STORY_ONE_CUT, 6);
  assert.equal(STORY_ONE_CUT, STORY_PART_SCENES);
  assert.equal(STORY_PART_SCENES, 6);
  const sec = (n: number) => Array.from({ length: n }, (_, i) => 280 + (i % 3) * 15);
  for (let n = 1; n <= 6; n++) assert.equal(storyParts(sec(n)).length, 1, `${n} scenes`);
  // (seven to twelve: two parts — the twelve-scene story that ran the server out of memory is cut 6 + 6)
  for (let n = 7; n <= 12; n++) assert.equal(storyParts(sec(n)).length, 2, `${n} scenes`);
  assert.deepEqual(storyParts(sec(12)).map((p) => p.to - p.from), [6, 6]);
  assert.deepEqual(storyParts(sec(13)).map((p) => p.to - p.from), [5, 4, 4]);
  assert.deepEqual(storyParts(sec(32)).map((p) => p.to - p.from), [6, 6, 5, 5, 5, 5]);
  // five minutes of a told story (film-length.ts) is cut in six parts
  assert.equal(storyParts(sec(maxShots("narrated"))).length, 6);
  for (let n = 1; n <= 40; n++) {
    const f = sec(n);
    const parts = storyParts(f);
    // every scene in exactly one part, in order; each part starting on the frame the one before it ended
    assert.equal(parts[0].from, 0);
    assert.equal(parts[parts.length - 1].to, n);
    let start = 0;
    parts.forEach((p, k) => {
      if (k) assert.equal(p.from, parts[k - 1].to);
      assert.equal(p.start, start);
      assert.equal(p.frames, f.slice(p.from, p.to).reduce((a, b) => a + b, 0));
      assert.ok(n <= STORY_ONE_CUT || p.to - p.from <= STORY_PART_SCENES, `${n}: a part of ${p.to - p.from}`);
      start += p.frames;
    });
    const sizes = parts.map((p) => p.to - p.from);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `${n}: ${sizes.join(",")}`);
  }
  assert.deepEqual(storyParts([]), []);
});

test("a part draws the words that are up during it, at the story's own times — a card already up when it begins included", () => {
  const cards = [
    { text: "ONE", t0: 0.2, t1: 2.4 },
    { text: "TWO", t0: 9.5, t1: 10.6, words: [{ text: "TW", t0: 9.5, t1: 10.1 }, { text: "O", t0: 10.1, t1: 10.6 }] },
    { text: "THREE", t0: 10.8, t1: 12 },
    { text: "FOUR", t0: 20, t1: 21 },
  ];
  // a part from 10 s to 20 s: the card that straddles its start, the one inside it — not the ones outside it — untouched
  assert.deepEqual(cardsDuring(cards, 10, 20), [cards[1], cards[2]]);
  assert.deepEqual(cardsDuring(cards, 0, 10).map((c) => c.text), ["ONE", "TWO"]);
  assert.equal(cardsDuring(cards, 30, 40).length, 0);
});

test("a part's picture: each scene by the single cut's own chain, made exactly as long as it is, the words over all of them on the story's clock", () => {
  assert.equal(exactly(287), "tpad=stop_mode=clone:stop_duration=1,trim=end_frame=287,setpts=PTS-STARTPTS");
  assert.equal(partGraph(["A", "B"], [30, 45], []), "[0:v]A,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=30,setpts=PTS-STARTPTS[c0];[1:v]B,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=45,setpts=PTS-STARTPTS[c1];[c0][c1]concat=n=2:v=1:a=0[vcat];[vcat]null[v]");
  // (the words drawn on the story's own clock — millionths of a second from where it stands at the part's first
  //  frame — and the part's frames timed from 0 again after)
  assert.ok(partGraph(["A"], [30], ["drawtext=x", "drawtext=y"], 5400000).endsWith("[vcat]settb=AVTB,setpts=PTS+5400000,drawtext=x,drawtext=y,setpts=PTS-STARTPTS[v]"));
  // …where one cut's clock stands: each scene before the part counted as its own length, rounded to the millionth
  //  (scenes of 24, 31, 38, 45 frames are 800000, 1033333, 1266667 and 1500000 millionths)
  const clocks = storyParts(Array.from({ length: 15 }, (_, i) => 24 + (i % 4) * 7)).map((p) => [p.start, p.clock]);
  assert.deepEqual(clocks, [[0, 0], [162, 800000 + 1033333 + 1266667 + 1500000 + 800000], [331, 5400000 + 1033333 + 1266667 + 1500000 + 800000 + 1033333]]);
  // HOW A SCENE GOES IN is what the single cut does with it — its clip, its picture moving slowly, its picture held
  const clip = { file: "c.mp4", fit: fitMotion(5, 9) };
  assert.deepEqual(sceneIn(3, { still: "s.jpg", clip }, 270, 1080, 1920, { clips: true, moving: true }), { input: ["-i", "c.mp4"], chain: motionChain(clip.fit, 270, 1080, 1920) });
  assert.deepEqual(sceneIn(3, { still: "s.jpg", clip }, 270, 1080, 1920, { clips: false, moving: true }), { input: ["-i", "s.jpg"], chain: `${kenBurns(3, 270, 1080, 1920)},format=yuv420p` });
  assert.deepEqual(sceneIn(3, { still: "s.jpg", clip: null }, 270, 1080, 1920, { clips: true, moving: true }).input, ["-i", "s.jpg"]);
  assert.deepEqual(sceneIn(3, { still: "s.jpg", clip }, 270, 1080, 1920, { clips: true, moving: false }), { input: ["-loop", "1", "-t", "9.000", "-i", "s.jpg"], chain: "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p" });
  // …the very chains, encoder and mix the single cut has (narrated-story.server.ts → assembleNarrated → build)
  const nar = read("app", "lib", "narrated-story.server.ts");
  const single = nar.slice(nar.indexOf("export async function assembleNarrated("), nar.indexOf("async function cutInParts("));
  for (const s of [
    "? `[${i}:v]${motionChain(m.fit, frames[i], o.W, o.H)}[c${i}]`",
    "? `[${i}:v]${kenBurns(i, frames[i], o.W, o.H)},format=yuv420p[c${i}]`",
    ": `[${i}:v]scale=${o.W}:${o.H}:force_original_aspect_ratio=increase,crop=${o.W}:${o.H},setsar=1,fps=${FPS},format=yuv420p[c${i}]`);",
    // (one decoding thread a scene since 2026-11-25, as storyPartArgs puts it before each scene's own input)
    "if (m) a.push(\"-threads\", \"1\", \"-i\", m.file);",
    "else if (moving) a.push(\"-threads\", \"1\", \"-i\", s);",
    "else a.push(\"-threads\", \"1\", \"-loop\", \"1\", \"-t\", (frames[i] / FPS).toFixed(3), \"-i\", s);",
    "const clipOf = (i: number) => (useClips && moving ? moves[i] : null);",
    "f.push(`[${N}:a]aresample=44100,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100,apad=pad_dur=${TAIL_S}[vo]`);",
    "f.push(`[${N + 1}:a]aresample=44100,volume=0.18,afade=t=out:st=${Math.max(0, total - 1.6).toFixed(2)}:d=1.6[bg]`);",
    "f.push(`[vo][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`);",
    "\"-threads\", \"2\", \"-filter_complex_threads\", \"2\",",
    "\"-c:v\", \"libx264\", \"-preset\", \"fast\", \"-tune\", \"film\", \"-crf\", \"18\", \"-pix_fmt\", \"yuv420p\",",
  ]) assert.ok(single.includes(s), s);
  assert.deepEqual([...STORY_PICTURE], ["-threads", "2", "-filter_complex_threads", "2", "-c:v", "libx264", "-preset", "fast", "-tune", "film", "-crf", "18", "-pix_fmt", "yuv420p"]);
  const mix = storySoundArgs({ voice: "v.mp3", music: "m.mp3", total: 61.25, tail: 0.8, out: "s.wav" });
  assert.deepEqual(mix, ["-y", "-i", "v.mp3", "-stream_loop", "-1", "-i", "m.mp3", "-filter_complex", "[0:a]aresample=44100,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100,apad=pad_dur=0.8[vo];[1:a]aresample=44100,volume=0.18,afade=t=out:st=59.65:d=1.6[bg];[vo][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]", "-map", "[aout]", "-t", "61.25", "-c:a", "pcm_s16le", "-f", "wav", "s.wav"]);
  assert.deepEqual(storySoundArgs({ voice: "v.mp3", music: null, total: 61.25, tail: 0.8, out: "s.wav" }).slice(0, 8), ["-y", "-i", "v.mp3", "-filter_complex", "[0:a]aresample=44100,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100,apad=pad_dur=0.8[vo]", "-map", "[vo]", "-t"]);
  assert.deepEqual(storyJoinArgs({ list: "l.txt", sound: "s.wav", total: 61.25, out: "o.mp4" }), ["-y", "-f", "concat", "-safe", "0", "-i", "l.txt", "-i", "s.wav", "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", "61.25", "-movflags", "+faststart", "o.mp4"]);
  // (one decoding thread a scene since 2026-11-25: a part of six moving Full-HD scenes, 662 MB → 527 MB, measured)
  assert.deepEqual(storyPartArgs([{ input: ["-i", "a.jpg"], chain: "A" }], [30], ["drawtext=x"], 3000000, "p.mp4"), ["-y", "-threads", "1", "-i", "a.jpg", "-filter_complex", partGraph(["A"], [30], ["drawtext=x"], 3000000), "-map", "[v]", "-an", ...STORY_PICTURE, "-f", "mp4", "p.mp4"]);
});

test("the cut is wired: a story of more than twelve scenes goes to the parts, down the single cut's own ladder, measured", () => {
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("if (N > STORY_ONE_CUT) return cutInParts({ ...o, norm, frames, moves, total, hasMusic, beat });"));
  // (before the single cut's own words are made: a short story is cut exactly as it was)
  assert.ok(nar.indexOf("if (N > STORY_ONE_CUT) return cutInParts(") < nar.indexOf("const cap = captionGraph(o.cards, o.style, o.fontFile, o.W, o.H);"));
  const fn = nar.slice(nar.indexOf("async function cutInParts("), nar.indexOf("export async function generateNarratedStory("));
  for (const s of [
    "const run = await runFfmpeg(storySoundArgs({ voice: o.voPath, music: music ? o.musicPath : null, total: o.total, tail: TAIL_S, out: sound }));",
    "const cap = rung.words === \"none\" ? null : captionGraph(cardsDuring(o.cards, from, from + part.frames / FPS), o.style, o.fontFile, o.W, o.H);",
    "return sceneIn(i, { still: o.norm[i], clip: o.moves[i] }, o.frames[i], o.W, o.H, rung);",
    "const run = await runFfmpeg(storyPartArgs(scenes, o.frames.slice(part.from, part.to), words, part.clock, files[p]));",
    "if (!(got && Math.abs(got - part.frames / FPS) <= 1.5 / FPS)) {",
    "fs.writeFileSync(list, joinList(files, parts.map((x) => x.frames)), \"utf8\");",
    "const run = await runFfmpeg(storyJoinArgs({ list, sound, total: o.total, out: o.outPath }));",
    "if (made && made.video && Math.abs(made.video - sum) <= 2 / FPS && made.audio && made.audio > 1) {",
    "for (const f of [...files, list, sound]) { try { fs.rmSync(f, { force: true }); } catch { /* best effort */ } }",
    "throw new Error(`[narrated] the story could not be cut in parts — ${tried.join(\"; \")}`);",
    "await o.beat();",
  ]) assert.ok(fn.includes(s), s);
  // the ladder: the styled words, the moving scenes, the still pictures with their push-in, no words, plain stills
  const order = ["how: \"with its styled words\"", "how: \"with its moving scenes\"", "how: \"over its still pictures\"", "how: \"without its words\"", "how: \"as plain still pictures\""].map((s) => fn.indexOf(s));
  assert.ok(order.every((x, k) => x > 0 && (k === 0 || x > order[k - 1])), order.join(","));
});

/* ---- THE NARRATION ---- */

test("a narration the voice cannot read at once is dealt into readings that end where sentences end", () => {
  assert.equal(NARRATION_MAX_CHARS, 9000);
  // five minutes in English is well inside one reading
  const sentence = "The ferry was late that night, and the river was black and very still. ";
  const fiveMinutes = sentence.repeat(Math.ceil(7000 / sentence.length)).trim();
  assert.deepEqual(readingParts(fiveMinutes), [fiveMinutes]);
  assert.deepEqual(readingParts("  one   two  "), ["one two"]);
  assert.deepEqual(readingParts(""), []);
  // past the limit: as few readings as hold it, each ending on a sentence, nothing lost, none a scrap
  const long = sentence.repeat(Math.ceil(12500 / sentence.length)).trim();
  const r = readingParts(long);
  assert.equal(r.length, 2);
  assert.ok(r.every((x) => x.length <= NARRATION_MAX_CHARS && x.endsWith(".")));
  assert.equal(r.join(" "), long);
  assert.ok(Math.abs(r[0].length - r[1].length) < sentence.length * 2, `${r[0].length} and ${r[1].length}`);
  // a sentence longer than a reading is cut where a word ends
  const run = `${"word ".repeat(30).trim()}.`;
  const cut = readingParts(run, 60);
  assert.ok(cut.length >= 3 && cut.every((x) => x.length <= 60) && cut.join(" ") === run, JSON.stringify(cut));
  // a Hindi story (read by the speech model) ends its sentences on "।", an Urdu one on "۔": cut there, never mid-sentence
  for (const stop of ["।", "۔"]) {
    const told = `${"शब्द ".repeat(8).trim()}${stop} `.repeat(6).trim();
    const parts = readingParts(told, 100);
    assert.ok(parts.length >= 2 && parts.every((x) => x.endsWith(stop) && x.length <= 100) && parts.join(" ") === told, JSON.stringify(parts));
  }
  // the wiring: one reading as it always was; more, read one after another and joined
  const nar = read("app", "lib", "narrated-story.server.ts");
  const fn = nar.slice(nar.indexOf("export async function narrate("), nar.indexOf("/** Put it together:"));
  assert.ok(fn.includes("const readings = readingParts(text);"));
  assert.ok(fn.includes("const { buf, url } = readings.length > 1 ? { buf: await joinReadings(await readingsInTurn(readings, readOnce)), url: \"\" } : await readOnce(text, \"narration\");"));
  assert.ok(nar.includes("for (let k = 0; k < readings.length; k++) out.push((await read(readings[k], `narration-${k + 1}-of-${readings.length}`)).buf);"));
});

test("a story that is drawing says it is at work whenever a picture comes back — at a real step, never on a timer", () => {
  const nar = read("app", "lib", "narrated-story.server.ts");
  const fn = nar.slice(nar.indexOf("export async function narratedSceneSeeds("), nar.indexOf("/** DRAW ONE CHARACTER AGAIN."));
  assert.ok(fn.includes("const alive = async (): Promise<void> => { try { await o.beat?.(); } catch { /* skipped */ } };"));
  assert.ok(fn.includes("const got = await drawScene(`${first}${promptOf(withPlace)}${fix}`, withPlace ? refs : people, aspect);\n        await alive();"));
  assert.ok(fn.includes("if (img && faultsOut[i] == null) faultsOut[i] = 0;\n      await alive();"));
  assert.ok(!/setInterval/.test(fn));
  // (…and the idea rides after the beat since 2026-11-25 — tests/told-night.test.ts)
  assert.ok(nar.includes("const drawn = await narratedSceneSeeds({ template: tmpl.key, treatment, cast: opts.cast, aspect, only: missing, castRef: storyCastRef || null, beat: () => ckpt({ ckBeat: Date.now() }), idea: opts.topic });"));
});

test("every scene of a long story moves — handed to the motion engine twelve at a time, put back in the story's order", () => {
  // the motion engine brings at most twelve scenes of one story to life (story-motion.ts), the most a story had
  const motion = read("app", "lib", "story-motion.ts");
  assert.ok(motion.includes("export const MOTION_MAX_SCENES = 12;"));
  assert.ok(read("app", "lib", "story-motion.server.ts").includes("while (next < Math.min(N, MOTION_MAX_SCENES)) {"));
  const nar = read("app", "lib", "narrated-story.server.ts");
  const fn = nar.slice(nar.indexOf("async function animateInRuns("), nar.indexOf("/** The readings of a long story"));
  for (const s of [
    "if (N <= MOTION_MAX_SCENES) return animateScenes(o);",
    "for (let from = 0; from < N; from += MOTION_MAX_SCENES) {",
    "const run = await animateScenes({ ...o, seeds: o.seeds.slice(from, to), visuals: o.visuals.slice(from, to), cams: o.cams?.slice(from, to), told: o.told.slice(from, to), still: o.still?.slice(from, to) });",
    "run.clips.forEach((c, k) => { out.clips[from + k] = c; });",
    "out.made += run.made; out.reused += run.reused; out.seconds += run.seconds;",
    "out.faults.push(...run.faults.map((f) => ({ ...f, scene: f.scene + from })));",
    "out.looks.push(...run.looks.map((l) => ({ ...l, scene: l.scene + from })));",
  ]) assert.ok(fn.includes(s), s);
  assert.ok(nar.includes("      motion = await animateInRuns({\n        seeds, visuals:"));
  assert.ok(!nar.includes("motion = await animateScenes("));
});

/* ---- THE CUT, MADE ---- */

const ffmpegOk = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0 && spawnSync("ffprobe", ["-version"], { encoding: "utf8" }).status === 0;
const streamsOf = (file: string): { video: number; audio: number | null } => {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  const m = Object.fromEntries(r.stdout.trim().split(/\r?\n/).map((l) => { const [t, d] = l.split(","); return [t, parseFloat(d)]; }));
  return { video: m.video, audio: m.audio ?? null };
};
const ff = (args: string[]): void => {
  const r = spawnSync("ffmpeg", ["-v", "error", ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
};
/** every frame of a film, as a grid of colours (4×4 by default) */
const gridOf = (film: string, w = 4, h = 4): Uint8Array[] => {
  const raw = spawnSync("ffmpeg", ["-v", "error", "-i", film, "-vf", `scale=${w}:${h}:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { encoding: "buffer", maxBuffer: 1 << 27 }).stdout;
  const size = w * h * 3;
  const out: Uint8Array[] = [];
  for (let k = 0; k + size - 1 < raw.length; k += size) out.push(raw.subarray(k, k + size));
  return out;
};

test("A STORY OF FIFTEEN SCENES CUT IN PARTS is, frame for frame, the story one cut makes — its words where they were, its sound under all of it", { skip: !ffmpegOk }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "story-join-"));
  try {
    const W = 180, H = 320, N = 15, TAIL = 0.8;
    const colour = (i: number): string => [(i * 67 + 20) % 236 + 10, (i * 131 + 90) % 236 + 10, (i * 29 + 160) % 236 + 10].map((c) => c.toString(16).padStart(2, "0")).join("");
    // fifteen scenes of their own lengths (whole frames, as the cut gives them), each a picture of its own colour;
    // three of them MOVE — a clip of another colour, shorter than its scene (it is slowed, then held)
    const frames = Array.from({ length: N }, (_, i) => 24 + (i % 4) * 7);
    const stills = Array.from({ length: N }, (_, i) => { const f = path.join(dir, `s${i}.png`); ff(["-y", "-f", "lavfi", "-i", `color=c=0x${colour(i)}:s=${W}x${H}`, "-frames:v", "1", f]); return f; });
    const moving = new Set([2, 7, 13]);
    const clips = Array.from({ length: N }, (_, i) => {
      if (!moving.has(i)) return null;
      const f = path.join(dir, `c${i}.mp4`);
      ff(["-y", "-f", "lavfi", "-i", `color=c=0x${colour(i + 40)}:s=${W}x${H}:r=24:d=0.8`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", f]);
      return { file: f, fit: fitMotion(0.8, frames[i] / 30) };
    });
    const total = frames.reduce((a, b) => a + b, 0) / 30;
    // the voice (as long as the story, less its tail) and a music bed shorter than it (it is looped)
    const voice = path.join(dir, "vo.wav");
    ff(["-y", "-f", "lavfi", "-i", `sine=frequency=330:sample_rate=44100:duration=${(total - TAIL).toFixed(3)}`, voice]);
    const music = path.join(dir, "bed.wav");
    ff(["-y", "-f", "lavfi", "-i", "sine=frequency=520:sample_rate=44100:duration=3.1", music]);
    // the words: a card in most scenes, one of them up across the edge between two parts
    const parts = storyParts(frames);
    assert.deepEqual(parts.map((p) => p.to - p.from), [5, 5, 5]);
    const edge = parts[1].start / 30;
    const font = path.join(root, "public", "fonts", "Poppins-Bold.ttf");
    const cards = [
      { text: "THE FERRY", t0: 0.1, t1: 1.2 }, { text: "WAS LATE", t0: 2.0, t1: 3.1 },
      { text: "ACROSS THE EDGE", t0: edge - 0.4, t1: edge + 0.7 }, { text: "THE END", t0: total - 1.5, t1: total - 0.2 },
    ];
    const how = { clips: true, moving: true };
    const scenes = frames.map((f, i) => sceneIn(i, { still: stills[i], clip: clips[i] }, f, W, H, how));

    // ONE CUT — what the single cut does (assembleNarrated → build): every scene at once, the words, the mix, -t total
    const one = path.join(dir, "one.mp4");
    const g = [
      ...scenes.map((s, i) => `[${i}:v]${s.chain}[c${i}]`), `${scenes.map((_, i) => `[c${i}]`).join("")}concat=n=${N}:v=1:a=0[vcat]`,
      `[vcat]${captionFilters(cards, "bold", font, W, H).join(",")}[vf]`,
      `[${N}:a]aresample=44100,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100,apad=pad_dur=${TAIL}[vo]`,
      `[${N + 1}:a]aresample=44100,volume=0.18,afade=t=out:st=${Math.max(0, total - 1.6).toFixed(2)}:d=1.6[bg]`,
      "[vo][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]",
    ];
    ff(["-y", ...scenes.flatMap((s) => s.input), "-i", voice, "-stream_loop", "-1", "-i", music, "-filter_complex", g.join(";"), "-map", "[vf]", "-map", "[aout]", "-t", total.toFixed(2), ...STORY_PICTURE, "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", one]);

    // IN PARTS — the very arguments narrated-story.server.ts → cutInParts runs
    const sound = path.join(dir, "film.mp4.sound.wav");
    ff(storySoundArgs({ voice, music, total, tail: TAIL, out: sound }));
    const files = parts.map((p, k) => {
      const out = path.join(dir, `film.mp4.part${k + 1}.mp4`);
      const words = captionFilters(cardsDuring(cards, p.start / 30, (p.start + p.frames) / 30), "bold", font, W, H);
      ff(storyPartArgs(scenes.slice(p.from, p.to), frames.slice(p.from, p.to), words, p.clock, out));
      // each part exactly the frames its scenes add up to
      assert.ok(Math.abs(streamsOf(out).video - p.frames / 30) <= 1.5 / 30, `part ${k + 1}: ${streamsOf(out).video} s against ${p.frames / 30}`);
      return out;
    });
    const list = path.join(dir, "film.mp4.parts.txt");
    fs.writeFileSync(list, joinList(files, parts.map((p) => p.frames)), "utf8");
    const film = path.join(dir, "film.mp4");
    ff(storyJoinArgs({ list, sound, total, out: film }));

    // WHOLE: its picture the sum of its scenes, its sound as long as the story
    const s = streamsOf(film);
    assert.ok(Math.abs(s.video - total) <= 2 / 30, `picture ${s.video} against ${total}`);
    assert.ok(s.audio !== null && Math.abs(s.audio - total) <= JOIN_TOLERANCE, `sound ${s.audio} against ${total}`);
    assert.ok(joinCheck({ video: s.video, audio: s.audio, frames: Math.round(total * 30) }).ok);
    // FRAME FOR FRAME the one cut's story: the same number of frames, and each the same picture (its words in it)
    const a = gridOf(one), b = gridOf(film);
    assert.equal(b.length, Math.round(total * 30));
    assert.equal(a.length, b.length);
    let worst = 0, at = -1;
    for (let k = 0; k < a.length; k++) for (let j = 0; j < 48; j++) { const d = Math.abs(a[k][j] - b[k][j]); if (d > worst) { worst = d; at = k; } }
    // (two encodes of the same frames differ by a few levels — most at a cut; a frame out of place differs by the
    //  distance between two scenes' colours, which is more than sixty here)
    assert.ok(worst <= 24, `the two differ by ${worst} at frame ${at} — a frame is not where the one cut has it`);
    // (…read again at a finer grid, where a word shows: a word is a few pixels high here). The words are where the
    // one cut has them. Six of these cards begin or end EXACTLY on a frame (2.0 s is frame 60) — the hardest case:
    // on a part's own clock, counted in frames, every one of the six came out a frame late; on the one cut's clock
    // (partGraph), at most one, and only by its last frame — ffmpeg's concat counts a moving scene's length to the
    // millionth its own way. So: no word anywhere it should not be, but for one frame where a card begins or ends.
    const fine = gridOf(film, 45, 80), oneFine = gridOf(one, 45, 80);
    const edges = cards.flatMap((c) => [Math.round(c.t0 * 30), Math.round(c.t1 * 30)]);
    const off: number[] = [];
    for (let k = 0; k < fine.length; k++) { let d = 0; for (let j = 0; j < fine[k].length; j++) d = Math.max(d, Math.abs(fine[k][j] - oneFine[k][j])); if (d > 40) off.push(k); }
    assert.ok(off.length <= 1 && off.every((k) => edges.includes(k)), `frames where a word is not where the one cut has it: ${off.join(", ")} (cards begin and end at ${edges.join(", ")})`);
    // …and the word that is up across the edge between two parts is there on both sides of it
    const edgeFrame = parts[1].start;
    const plain = path.join(dir, "plain.mp4");
    ff(["-y", ...scenes.flatMap((x) => x.input), "-filter_complex", `${scenes.map((x, i) => `[${i}:v]${x.chain}[c${i}]`).join(";")};${scenes.map((_, i) => `[c${i}]`).join("")}concat=n=${N}:v=1:a=0[v]`, "-map", "[v]", ...STORY_PICTURE, plain]);
    const bare = gridOf(plain, 45, 80);
    const lit = (frame: number) => { let d = 0; for (let j = 0; j < fine[frame].length; j++) d = Math.max(d, Math.abs(fine[frame][j] - bare[frame][j])); return d; };
    assert.ok(lit(edgeFrame - 2) > 60 && lit(edgeFrame + 2) > 60, `the card across the edge: ${lit(edgeFrame - 2)} before, ${lit(edgeFrame + 2)} after`);
    // (…and no card where the story has none: the frame before the second card's first)
    assert.ok(lit(Math.floor(1.6 * 30)) < 20, `a frame with no card: ${lit(Math.floor(1.6 * 30))}`);
    // its frames evenly spaced, one every thirtieth of a second, across every part's edge
    const pts = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", film], { encoding: "utf8" }).stdout
      .trim().split(/\r?\n/).map((l) => parseFloat(l)).filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
    assert.equal(pts.length, b.length);
    for (let k = 1; k < pts.length; k++) assert.ok(Math.abs(pts[k] - pts[k - 1] - 1 / 30) < 0.002, `frame ${k} comes ${(pts[k] - pts[k - 1]).toFixed(4)} s after the one before`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
