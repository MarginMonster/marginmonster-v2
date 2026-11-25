/* NO ffmpeg THE APP RUNS OPENS MORE THAN IT MUST AT ONCE — the audit of 2026-11-25.
 *
 * That afternoon a tester's 12-scene told story ran the 2 GB server out of memory four times in its one final cut
 * (twelve Full-HD inputs in one ffmpeg). Every ffmpeg that opens several videos at once was found and measured on
 * Full-HD TEST stand-ins (peak private memory, Windows' own counters, at a 16-core host's thread counts — ffmpeg sizes
 * each H.264 decoder by the machine's cores):
 *
 *   the told story's old one cut (12 scenes)      843 MB  → in parts of six (story-join.ts), one thread a scene: 527 MB
 *   the found-footage join (16 pieces)            781 MB  → in parts of six (footage-film.ts):                   536 MB
 *   the Archive cover's frame picker (8 shots)  1,073 MB  → one thread a shot:                                   276 MB
 *   the music video's paced edit (24 clips)       870 MB  → one thread a clip:                                   672 MB
 *   the music video's fallback (24 Full-HD)     1,163 MB  → parts of six, one thread a clip:                     418 MB
 *   the Kids Music Video's cut (8 clips)          469 MB  → one thread a clip:                                   319 MB
 *   an acted film's part (6 shots: same shape as a told part)                → one thread a shot (joinPartArgs)
 *
 * Held here: every one of those opens one decoding thread an input, and the fallback is joined in parts — measured
 * whole on real ffmpeg. What opens only stills or sound, or one video, is listed with why it is safe. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MV_PART_CLIPS, mvFallbackGraph, mvFallbackJoinArgs, mvFallbackPartArgs, mvFallbackParts } from "../app/lib/mv-pace.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const ffmpegOk = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0 && spawnSync("ffprobe", ["-version"], { encoding: "utf8" }).status === 0;

test("every ffmpeg that opens several videos at once gives each ONE decoding thread", () => {
  const pins: Array<[string, string, string]> = [
    ["archive-cover.server.ts", 'for (const c of list) { if (c.t != null) args.push("-ss", c.t.toFixed(2)); args.push("-threads", "1", "-i", c.file); }', "the cover's frame picker: 1,073 → 276 MB, and two run at once from the web, beside a job"],
    ["film-engine.server.ts", 'opts.clips.forEach((c) => a.push("-threads", "1", "-i", c));', "the Kids Music Video's cut: 469 → 319 MB"],
    ["music-video-pipeline.server.ts", 'norm.forEach((p) => args.push("-threads", "1", "-i", p));', "the music video's paced edit: 870 → 672 MB"],
    ["narrated-story.server.ts", 'if (m) a.push("-threads", "1", "-i", m.file);', "a told story of six scenes or fewer, cut whole"],
    ["story-join.ts", 'return ["-y", ...scenes.flatMap((s) => ["-threads", "1", ...s.input]), "-filter_complex",', "a told story's part: 662 → 527 MB, and 92 → 69 s"],
    ["acted-staging.ts", 'return ["-y", ...files.flatMap((f) => ["-threads", "1", "-i", f]), "-filter_complex",', "an acted film's part"],
    ["film-join.server.ts", 'const inputs = clips.flatMap((c) => ["-threads", "1", "-i", c]);', "an acted film of six shots or fewer, joined whole"],
    ["footage-film.ts", 'return ["-y", ...files.flatMap((f) => ["-threads", "1", "-i", f]), "-filter_complex", graph,', "a found-footage film's part"],
    ["footage-film.server.ts", 'await runFfmpeg(["-y", ...pieces.flatMap((p) => ["-threads", "1", "-i", p.file]), "-filter_complex", plan.graph,', "a found-footage film of six pieces or fewer, joined whole"],
    ["mv-pace.ts", 'return ["-y", ...files.flatMap((f) => ["-threads", "1", "-i", f]), "-filter_complex", mvFallbackGraph(files.length, W, H),', "the music video's fallback, in parts"],
  ];
  for (const [file, line, why] of pins) assert.ok(read("app", "lib", file).includes(line), `${file}: ${why}`);
  // …and nowhere in those files is a list of videos opened the old way
  for (const [file, old] of [
    ["archive-cover.server.ts", 'args.push("-i", c.file); }'],
    ["film-engine.server.ts", 'opts.clips.forEach((c) => a.push("-i", c));'],
    ["music-video-pipeline.server.ts", 'norm.forEach((p) => args.push("-i", p));'],
    ["music-video-pipeline.server.ts", 'clips.forEach((c) => args.push("-i", c));'],
    ["film-join.server.ts", 'clips.flatMap((c) => ["-i", c])'],
  ] as const) assert.ok(!read("app", "lib", file).includes(old), `${file} still opens its videos with every decoder sized to the cores`);
});

test("what the audit left as it is, and why: stills, sound, or one video at a time", () => {
  // stills — one picture decoded once each, no decoder of a moving video (and drawn at 720p)
  assert.ok(read("app", "lib", "faceless-video.server.ts").includes('if (useKenBurns) a.push("-i", s);'), "a faceless video: up to eight STILLS");
  assert.ok(read("app", "lib", "lyric-video.server.ts").includes('for (const sh of shots) args.push("-i", diskOf(o.stills[sh.pic].src));'), "a lyric video: STILLS, in pieces of 45 s (lyric-video.ts → renderChunks)");
  assert.ok(read("app", "lib", "story-poster.server.ts").includes('...pictured.flatMap((c) => ["-i", c.input])') && read("app", "lib", "story-poster.ts").includes("export const POSTER_CAST_MAX = 3;"), "a poster: three portraits at most");
  // one video and its stills / its sound
  assert.ok(read("app", "lib", "commercial-ad-pipeline.server.ts").includes('const args = ["-y", "-f", "concat", "-safe", "0", "-i", list];'), "a commercial: its five clips one after another (the concat demuxer), its words as stills");
  // sound only
  assert.ok(read("app", "lib", "narrated-story.server.ts").includes('...files.flatMap((f) => ["-i", f]), "-filter_complex", graph, "-map", "[j]"'), "a long narration's readings: sound only");
});

test("THE MUSIC VIDEO'S FALLBACK, in parts of six: dealt as even as they come, each part the graph it always was", () => {
  assert.equal(MV_PART_CLIPS, 6);
  assert.deepEqual(mvFallbackParts(24).map((p) => p.to - p.from), [6, 6, 6, 6]);
  assert.deepEqual(mvFallbackParts(13).map((p) => p.to - p.from), [5, 4, 4]);
  assert.deepEqual(mvFallbackParts(6).map((p) => p.to - p.from), [6]);
  assert.deepEqual(mvFallbackParts(1), [{ from: 0, to: 1 }]);
  assert.deepEqual(mvFallbackParts(0), []);
  for (let n = 1; n <= 30; n++) {
    const parts = mvFallbackParts(n);
    assert.equal(parts[0].from, 0);
    assert.equal(parts[parts.length - 1].to, n);
    parts.forEach((p, k) => { if (k) assert.equal(p.from, parts[k - 1].to); assert.ok(p.to - p.from <= MV_PART_CLIPS); });
  }
  // the graph the fallback always had, for the clips of a part
  assert.equal(mvFallbackGraph(2, 720, 1280),
    "[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30[v0];[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a0];" +
    "[1:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30[v1];[1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a1];" +
    "[v0][a0][v1][a1]concat=n=2:v=1:a=1[vo][ao]");
  assert.deepEqual(mvFallbackPartArgs(["a.mp4"], 720, 1280, "p.mov"),
    ["-y", "-threads", "1", "-i", "a.mp4", "-filter_complex", mvFallbackGraph(1, 720, 1280), "-map", "[vo]", "-map", "[ao]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le", "-f", "mov", "p.mov"]);
  assert.deepEqual(mvFallbackJoinArgs("l.txt", "o.mp4"), ["-y", "-f", "concat", "-safe", "0", "-i", "l.txt", "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "o.mp4"]);
  // WIRED: every part, then the parts end to end; their files gone; the first clip as it is when nothing could be made
  const mv = read("app", "lib", "music-video-pipeline.server.ts");
  const fb = mv.slice(mv.indexOf("// FALLBACK: plain hard-cut concat"), mv.indexOf("async function sceneShowsProp("));
  assert.ok(fb.includes("const parts = mvFallbackParts(N);"));
  assert.ok(fb.includes("const r = await runFfmpeg(mvFallbackPartArgs(clips.slice(parts[p].from, parts[p].to), W, H, partFiles[p]));"));
  assert.ok(fb.includes("const r = await runFfmpeg(mvFallbackJoinArgs(partList, outPath));"));
  assert.ok(fb.includes("for (const f of [...partFiles, partList]) { try { fs.rmSync(f, { force: true }); } catch { /* best effort */ } }"));
  assert.ok(fb.includes("fs.copyFileSync(clips[0], outPath);"));
});

test("THE FALLBACK IN PARTS, BY REAL FFMPEG: eight TEST clips, each with its own colour and sound — every frame there, in order, the sound as long as the picture", { skip: !ffmpegOk }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mv-fallback-"));
  const W = 180, H = 320;
  try {
    const colour = (i: number): [number, number, number] => [(i * 67 + 40) % 200 + 50, (i * 131 + 90) % 200 + 50, (i * 29 + 160) % 200 + 50];
    const clips = Array.from({ length: 8 }, (_, i) => {
      const out = path.join(dir, `clip${i}.mp4`);
      const hex = colour(i).map((c) => c.toString(16).padStart(2, "0")).join("");
      const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=0x${hex}:s=${W}x${H}:r=24:d=1`, "-f", "lavfi", "-i", `sine=frequency=${300 + i * 60}:sample_rate=48000:duration=1`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", out], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      return out;
    });
    const parts = mvFallbackParts(clips.length);
    assert.deepEqual(parts.map((p) => p.to - p.from), [4, 4]);
    const film = path.join(dir, "mv.mp4");
    const files = parts.map((_, p) => `${film}.part${p + 1}.mov`);
    parts.forEach((p, k) => {
      const r = spawnSync("ffmpeg", ["-v", "error", ...mvFallbackPartArgs(clips.slice(p.from, p.to), W, H, files[k])], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
    });
    const list = path.join(dir, "parts.txt");
    fs.writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"), "utf8");
    const r = spawnSync("ffmpeg", ["-v", "error", ...mvFallbackJoinArgs(list, film)], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    // every frame: eight seconds at 30, each clip's colour for its own second, in order
    const raw = spawnSync("ffmpeg", ["-v", "error", "-i", film, "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { encoding: "buffer", maxBuffer: 1 << 24 }).stdout;
    const px: Array<[number, number, number]> = [];
    for (let k = 0; k + 2 < raw.length; k += 3) px.push([raw[k], raw[k + 1], raw[k + 2]]);
    assert.equal(px.length, 240);
    for (let i = 0; i < 8; i++) {
      const [r0, g0, b0] = colour(i);
      const own = px.slice(i * 30, i * 30 + 30).filter((p) => Math.abs(p[0] - r0) <= 8 && Math.abs(p[1] - g0) <= 8 && Math.abs(p[2] - b0) <= 8).length;
      assert.equal(own, 30, `clip ${i + 1}: ${own} of its 30 frames where they belong`);
    }
    // the sound, as long as the picture (within a block of AAC)
    const s = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "json", film], { encoding: "utf8" }).stdout).streams as Array<{ codec_type: string; duration: string }>;
    const v = parseFloat(s.find((x) => x.codec_type === "video")!.duration), a = parseFloat(s.find((x) => x.codec_type === "audio")!.duration);
    assert.ok(Math.abs(v - 8) <= 1 / 30 + 0.001, `picture ${v}`);
    assert.ok(Math.abs(a - v) <= 0.05, `sound ${a} against picture ${v}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
