/* EVERY FFMPEG THE APP RUNS HAS A THREAD CAP (app/lib/ffmpeg-threads.ts → capThreads).
 *
 * Measured on the live server, 2026-11-25 22:05–22:14 UTC: a TEST told story of three scenes held the server at
 * 1.08 GB for three minutes, exactly while story-motion re-encoded its three clips to Full HD with no -threads —
 * ffmpeg sizes its decoder, filter and x264 threads by the HOST's cores, and every thread holds frames. Every run
 * now goes through capThreads: one decoding thread an input, two for each picture an output encodes, two for the
 * filter graphs; the caller's own -threads always wins; nothing but those options is ever added, and no value
 * (a filter string, a path with "-i" in it) is looked inside.
 *
 * Three kinds of test: what capThreads makes of each shape of run the app has (and that it is idempotent); what
 * FFMPEG ITSELF reads from the capped arguments (`-v debug` prints how it split the command line — every input's
 * and output's options — before it opens a file); and source pins that every runner applies it, with one switch. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FFMPEG_FLAGS, FFMPEG_VERSIONED_FLAGS, capThreads, ffmpegArgsFor, isFfmpegBin, takesValue, threadCapOn, withThreadCap } from "../app/lib/ffmpeg-threads.ts";
import { sceneIn, storyJoinArgs, storyPartArgs, storySoundArgs, STORY_PICTURE } from "../app/lib/story-join.ts";
import { fitMotion } from "../app/lib/story-motion.ts";
import { footageCardArgs, footageFilmArgs, footagePartArgs } from "../app/lib/footage-film.ts";
import { mvEditJoinArgs, mvFallbackPartArgs } from "../app/lib/mv-pace.ts";
import { cutLookArgs } from "../app/lib/take.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

/** story-motion.server.ts's re-encode of one downloaded clip, exactly as it is written there (W×H = 1080×1920). */
const motionArgs = (raw: string, tmp: string, W = 1080, H = 1920) => ["-y", "-i", raw, "-an", "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`,
  "-c:v", "libx264", "-preset", "fast", "-tune", "film", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", tmp];
const GLOBALS = ["-filter_threads", "2", "-filter_complex_threads", "2"];

/* ---- WHAT capThreads MAKES OF EACH SHAPE OF RUN ---- */

test("one input and an encoder: the globals first, one decoding thread before -i, two for x264 before the path", () => {
  assert.deepEqual(capThreads(motionArgs("raw.mp4", "tmp.mp4")), [
    ...GLOBALS, "-y", "-threads", "1", "-i", "raw.mp4", "-an", "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1",
    "-c:v", "libx264", "-preset", "fast", "-tune", "film", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-threads", "2", "tmp.mp4",
  ]);
});

test("many inputs: every one gets its own decoding thread, wherever its other input options are", () => {
  const args = ["-y", "-i", "a.mp4", "-loop", "1", "-t", "3.000", "-i", "b.png", "-stream_loop", "-1", "-i", "c.mp3", "-f", "lavfi", "-t", "2", "-i", "color=c=black:s=64x64",
    "-filter_complex", "[0:v][1:v][3:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-map", "2:a", "-shortest", "-c:v", "libx264", "-c:a", "aac", "out.mp4"];
  assert.deepEqual(capThreads(args), [...GLOBALS, "-y", "-threads", "1", "-i", "a.mp4", "-loop", "1", "-t", "3.000", "-threads", "1", "-i", "b.png",
    "-stream_loop", "-1", "-threads", "1", "-i", "c.mp3", "-f", "lavfi", "-t", "2", "-threads", "1", "-i", "color=c=black:s=64x64",
    "-filter_complex", "[0:v][1:v][3:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-map", "2:a", "-shortest", "-c:v", "libx264", "-c:a", "aac", "-threads", "2", "out.mp4"]);
});

test("an input that already sets -threads keeps its own (before its -i or anywhere among its options); the others get one", () => {
  const args = ["-y", "-threads", "3", "-i", "a.mp4", "-threads", "1", "-loop", "1", "-t", "2", "-i", "b.png", "-i", "c.mp4", "-filter_complex", "x", "-map", "[v]", "-c:v", "libx264", "o.mp4"];
  const out = capThreads(args);
  assert.deepEqual(out, [...GLOBALS, "-y", "-threads", "3", "-i", "a.mp4", "-threads", "1", "-loop", "1", "-t", "2", "-i", "b.png", "-threads", "1", "-i", "c.mp4",
    "-filter_complex", "x", "-map", "[v]", "-c:v", "libx264", "-threads", "2", "o.mp4"]);
  // a stream-specified -threads counts as its own too
  assert.deepEqual(capThreads(["-threads:v", "4", "-i", "a.mp4", "o.mp4"]).slice(4, 8), ["-threads:v", "4", "-i", "a.mp4"]);
});

test("an output that sets its own -threads keeps it — the caller always wins (and so do its own filter threads)", () => {
  const args = ["-y", "-i", "a.mp4", "-vf", "scale=2:2", "-threads", "6", "-c:v", "libx264", "o.mp4"];
  assert.deepEqual(capThreads(args), [...GLOBALS, "-y", "-threads", "1", "-i", "a.mp4", "-vf", "scale=2:2", "-threads", "6", "-c:v", "libx264", "o.mp4"]);
  const own = ["-filter_complex_threads", "4", "-y", "-i", "a.mp4", "-filter_threads", "3", "-c:v", "libx264", "o.mp4"];
  const capped = capThreads(own);
  assert.equal(capped.filter((t) => t === "-filter_threads").length, 1);
  assert.equal(capped.filter((t) => t === "-filter_complex_threads").length, 1);
  assert.equal(capped[capped.indexOf("-filter_threads") + 1], "3");
  assert.equal(capped[capped.indexOf("-filter_complex_threads") + 1], "4");
});

test("\"-i\" inside a value is a value: a filter string, a label, a metadata value and a path are stepped over whole", () => {
  const graph = "[0:v]drawtext=text='-i -i':x=0[-i];[-i]null[v]";
  const args = ["-y", "-i", "clip -i one.mp4", "-filter_complex", graph, "-map", "[v]", "-metadata", "title=-i", "-c:v", "libx264", "out -i.mp4"];
  const out = capThreads(args);
  assert.deepEqual(out, [...GLOBALS, "-y", "-threads", "1", "-i", "clip -i one.mp4", "-filter_complex", graph, "-map", "[v]", "-metadata", "title=-i", "-c:v", "libx264", "-threads", "2", "out -i.mp4"]);
  // …and a value that IS "-i" exactly — something before it must be a flag this file does not know — leaves the run as written
  assert.deepEqual(capThreads(["-y", "-some_new_flag", "-i", "a.mp4", "o.mp4"]), ["-y", "-some_new_flag", "-i", "a.mp4", "o.mp4"]);
});

test("REVIEW: a flag this file does not know, in front of another option, leaves the run as written — never a cap between an option and its value", () => {
  // read as valued, "-some_new_flag" would swallow "-c:v", and "libx264" would look like an output path: the cap
  // would land between "-c:v" and its codec, and ffmpeg would be told to encode with a codec named "-threads"
  for (const a of [
    ["-y", "-i", "a.mp4", "-some_new_flag", "-c:v", "libx264", "o.mp4"],
    ["-y", "-i", "a.mp4", "-some_new_flag", "-threads", "4", "o.mp4"],
    ["-some_new_flag", "-stream_loop", "-1", "-i", "a.mp4", "o.mp4"],
  ]) assert.deepEqual(capThreads(a), a, a.join(" "));
  // a value that starts with a dash and a digit is a value, as everywhere in the app
  assert.deepEqual(capThreads(["-stream_loop", "-1", "-i", "a.mp3", "-map_metadata", "-1", "o.mp3"]),
    [...GLOBALS, "-stream_loop", "-1", "-threads", "1", "-i", "a.mp3", "-map_metadata", "-1", "-threads", "2", "o.mp3"]);
});

test("REVIEW: -autorotate / -autoscale take a value in ffmpeg 5.1 and 6.1 and none in 7+, so a run that says them is left alone; -noautorotate is a flag in all", () => {
  for (const a of [["-autorotate", "0", "-i", "a.jpg", "o.jpg"], ["-i", "a.mp4", "-autoscale", "0", "-c:v", "libx264", "o.mp4"], ["-autorotate", "-i", "a.jpg", "o.jpg"]]) assert.deepEqual(capThreads(a), a, a.join(" "));
  assert.equal(takesValue("noautorotate"), false);
  assert.equal(takesValue("noautoscale"), false);
  assert.ok(!FFMPEG_FLAGS.has("autorotate") && !FFMPEG_FLAGS.has("autoscale"));
});

test("two outputs: each is capped by its own options — the encoder gets two threads, the stream copy none", () => {
  const args = ["-y", "-i", "a.mp4", "-c:v", "libx264", "-crf", "20", "big.mp4", "-c", "copy", "same.mkv", "-vf", "scale=320:-2", "-c:v", "libx264", "small.mp4"];
  assert.deepEqual(capThreads(args), [...GLOBALS, "-y", "-threads", "1", "-i", "a.mp4", "-c:v", "libx264", "-crf", "20", "-threads", "2", "big.mp4",
    "-c", "copy", "same.mkv", "-vf", "scale=320:-2", "-c:v", "libx264", "-threads", "2", "small.mp4"]);
});

test("-f null - (a look, not a file): the decoder gets one thread, the output '-' is an output", () => {
  const look = cutLookArgs("take.mp4");
  assert.deepEqual(capThreads(look), [...GLOBALS, "-v", "info", "-nostats", "-threads", "1", "-i", "take.mp4", "-an", "-vf", "scale=320:-2,signalstats,select='gte(scene,0)',metadata=print", "-f", "null", "-threads", "2", "-"]);
});

test("a picture: jpg in, jpg out", () => {
  assert.deepEqual(capThreads(["-y", "-i", "in.jpg", "-vf", "scale='min(1568,iw)':-2", "-q:v", "3", "out.jpg"]),
    [...GLOBALS, "-y", "-threads", "1", "-i", "in.jpg", "-vf", "scale='min(1568,iw)':-2", "-q:v", "3", "-threads", "2", "out.jpg"]);
});

test("the stream-copy join: its inputs get a decoding thread each, its copied picture no encoder threads", () => {
  const join = storyJoinArgs({ list: "parts.txt", sound: "sound.wav", total: 61.5, out: "story.mp4" });
  assert.deepEqual(capThreads(join), [...GLOBALS, "-y", "-f", "concat", "-safe", "0", "-threads", "1", "-i", "parts.txt", "-threads", "1", "-i", "sound.wav",
    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", "61.50", "-movflags", "+faststart", "story.mp4"]);
  for (const a of [footageFilmArgs("l.txt", ["-c:a", "aac"], "f.mp4"), mvEditJoinArgs("l.txt", "m.mp4"), ["-i", "a.mp4", "-vcodec", "copy", "o.mp4"], ["-i", "a.mp4", "-c:v:0", "copy", "o.mp4"]]) {
    assert.ok(!capThreads(a).slice(4).join(" ").includes("-threads 2"), `no encoder threads for a copied picture: ${a.join(" ")}`);
  }
});

test("what counts as encoding a picture: -vn never does; the last codec said for video wins; another stream's codec does not count", () => {
  const enc = (o: string[]) => capThreads(["-i", "a.mp4", ...o, "o.mp4"]).slice(-3, -1).join(" ") === "-threads 2";
  assert.equal(enc(["-vn", "-c:a", "libmp3lame"]), false);
  assert.equal(enc(["-c", "copy"]), false);
  assert.equal(enc(["-c", "copy", "-c:v", "libx264"]), true);
  assert.equal(enc(["-c:v", "libx264", "-c", "copy"]), false);
  assert.equal(enc(["-c:v", "copy", "-c:a", "aac"]), false);
  assert.equal(enc(["-c:a", "copy"]), true, "the picture is still encoded");
  assert.equal(enc(["-codec:v", "copy"]), false);
  assert.equal(enc([]), true, "no codec named: ffmpeg's default encoder");
});

test("the told cut (already capped) is not changed by a single thread: only -filter_threads is added, which it does not use", () => {
  const scenes = Array.from({ length: 6 }, (_, i) => sceneIn(i, { still: `s${i}.jpg`, clip: { file: `c${i}.mp4`, fit: fitMotion(5, 10) } }, 300, 1080, 1920, { clips: true, moving: true }));
  const part = storyPartArgs(scenes, scenes.map(() => 300), [], 0, "part.mp4");
  assert.deepEqual(capThreads(part), ["-filter_threads", "2", ...part]);
  assert.ok(STORY_PICTURE.includes("-filter_complex_threads"));
  // a still held for its scene (-loop 1 -t … -i) keeps the one thread put before its input options
  const still = sceneIn(0, { still: "s.jpg" }, 300, 1080, 1920, { clips: false, moving: false });
  const held = storyPartArgs([still], [300], [], 0, "p.mp4");
  assert.deepEqual(capThreads(held), ["-filter_threads", "2", ...held]);
});

test("the sound alone: its input gets a thread; an audio-only output gets -threads 2, which an audio encoder ignores", () => {
  const sound = storySoundArgs({ voice: "v.mp3", music: "m.mp3", total: 30, tail: 1, out: "s.wav" });
  const out = capThreads(sound);
  assert.equal(out.filter((t, i) => t === "-threads" && out[i + 1] === "1").length, 2);
  assert.deepEqual(out.slice(-3), ["-threads", "2", "s.wav"]);
});

test("flags take no value (-y, -an, -nostats, -noautorotate, -hide_banner, -shortest); a value that starts with a dash is still a value", () => {
  for (const f of ["y", "an", "vn", "hide_banner", "shortest", "nostats", "nostdin", "noautorotate", "copyts"]) assert.equal(takesValue(f), false, f);
  for (const v of ["t", "ss", "map", "map_metadata", "f", "c", "threads", "filter_complex", "filter_complex_script", "loop", "stream_loop", "itsoffset", "fps_mode", "movflags", "metadata"]) assert.equal(takesValue(v), true, v);
  assert.deepEqual(capThreads(["-hide_banner", "-loglevel", "error", "-y", "-noautorotate", "-i", "in.jpg", "-vf", "transpose=1", "-map_metadata", "-1", "-frames:v", "1", "-q:v", "2", "out.jpg"]),
    [...GLOBALS, "-hide_banner", "-loglevel", "error", "-y", "-noautorotate", "-threads", "1", "-i", "in.jpg", "-vf", "transpose=1", "-map_metadata", "-1", "-frames:v", "1", "-q:v", "2", "-threads", "2", "out.jpg"]);
  assert.deepEqual(capThreads(["-itsoffset", "-0.5", "-i", "a.wav", "o.wav"]), [...GLOBALS, "-itsoffset", "-0.5", "-threads", "1", "-i", "a.wav", "-threads", "2", "o.wav"]);
});

test("a run that names no output (a probe), or cannot be read, is handed back exactly as given", () => {
  for (const a of [["-hide_banner", "-i", "x.mp4"], ["-i", "a.mp4", "-c:v"], ["-y", "-i"], [], ["-version"]]) assert.deepEqual(capThreads(a), a);
  const given = ["-i", "a.mp4", "o.mp4"];
  const out = capThreads(given);
  assert.notEqual(out, given, "a new array");
  assert.deepEqual(given, ["-i", "a.mp4", "o.mp4"], "the caller's array is never changed");
});

/** every shape of run above, and the app's own builders */
const corpus = (): string[][] => {
  const scenes = Array.from({ length: 3 }, (_, i) => sceneIn(i, { still: `s${i}.jpg`, clip: i < 2 ? { file: `c${i}.mp4`, fit: fitMotion(5, 10) } : null }, 240, 1080, 1920, { clips: true, moving: true }));
  return [
    motionArgs("raw.mp4", "tmp.mp4"),
    storyPartArgs(scenes, [240, 240, 240], [], 0, "part.mp4"),
    storyJoinArgs({ list: "parts.txt", sound: "s.wav", total: 20, out: "story.mp4" }),
    storySoundArgs({ voice: "v.mp3", music: null, total: 20, tail: 1, out: "s.wav" }),
    footagePartArgs(["a.mp4", "b.mp4"], "[0:v][1:v]concat=n=2[vc];[0:a][1:a]concat=n=2:v=0:a=1[ac]", ["-threads", "2", "-c:v", "libx264"], "p.mov"),
    footageFilmArgs("l.txt", ["-c:a", "aac", "-b:a", "192k"], "f.mp4"),
    footageCardArgs({ when: "TEST NIGHT 1", w: 1080, h: 1920, fps: 24, font: "C:/fonts/Test Mono.ttf", out: "card.mp4" }),
    mvFallbackPartArgs(["a.mp4", "b.mp4", "c.mp4"], 720, 1280, "mv.mov"),
    mvEditJoinArgs("l.txt", "mv.mp4"),
    cutLookArgs("take.mp4"),
    ["-y", "-i", "in.jpg", "-vf", "scale=64:-2", "-q:v", "3", "out.jpg"],
    ["-y", "-i", "a.mp4", "-c:v", "libx264", "big.mp4", "-c", "copy", "same.mkv"],
    ["-y", "-ss", "1.20", "-t", "3.00", "-i", "a.mp4", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "trim.mp4"],
    ["-hide_banner", "-loglevel", "error", "-y", "-noautorotate", "-i", "in.jpg", "-vf", "transpose=1", "-map_metadata", "-1", "-frames:v", "1", "-q:v", "2", "out.jpg"],
  ];
};

test("idempotent: capping a capped run changes nothing", () => {
  for (const a of corpus()) {
    const once = capThreads(a);
    assert.deepEqual(capThreads(once), once, a.join(" "));
    // only ever ADDS: the caller's tokens are all there, in their order
    let k = 0;
    for (const t of once) if (k < a.length && t === a[k]) k++;
    assert.equal(k, a.length, `every token kept, in order: ${a.join(" ")}`);
  }
});

/* ---- THE SWITCH, AND WHICH BINARIES ---- */

test("FFMPEG_THREAD_CAP=off runs every encode as written; on is the default", () => {
  const a = motionArgs("r.mp4", "t.mp4");
  assert.equal(threadCapOn({}), true);
  assert.equal(threadCapOn({ FFMPEG_THREAD_CAP: "" }), true);
  assert.equal(threadCapOn({ FFMPEG_THREAD_CAP: "on" }), true);
  for (const off of ["off", "OFF", " off ", "0", "false", "no"]) assert.equal(threadCapOn({ FFMPEG_THREAD_CAP: off }), false, off);
  assert.deepEqual(withThreadCap(a, { FFMPEG_THREAD_CAP: "off" }), a);
  assert.deepEqual(withThreadCap(a, {}), capThreads(a));
});

test("only ffmpeg is capped — never ffprobe, yt-dlp or anything else a runner starts", () => {
  for (const b of ["ffmpeg", "/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "C:\\tools\\ffmpeg.exe", "C:/x/node_modules/ffmpeg-static/ffmpeg.exe", "FFMPEG.EXE"]) assert.equal(isFfmpegBin(b), true, b);
  for (const b of ["ffprobe", "/usr/bin/ffprobe", "C:\\x\\ffprobe.exe", "/usr/local/bin/yt-dlp", "", "/opt/ffmpeg/bin/rembg", "ffmpeg-wrapper"]) assert.equal(isFfmpegBin(b), false, b);
  const probe = ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", "a.mp4"];
  assert.deepEqual(ffmpegArgsFor("/usr/bin/ffprobe", probe, {}), probe);
  assert.deepEqual(ffmpegArgsFor("/usr/bin/ffmpeg", ["-i", "a.mp4", "o.mp4"], {}), capThreads(["-i", "a.mp4", "o.mp4"]));
  assert.deepEqual(ffmpegArgsFor("/usr/bin/ffmpeg", ["-i", "a.mp4", "o.mp4"], { FFMPEG_THREAD_CAP: "off" }), ["-i", "a.mp4", "o.mp4"]);
});

/* ---- WHAT FFMPEG ITSELF READS ----
 * `-v debug` makes ffmpeg print, while it splits the command line and before it opens anything, how it read every
 * token: "matched as option 'x' … with argument 'v'", "matched as AVOption 'threads' with argument '1'", "matched as
 * input url with argument 'a.mp4'", "matched as output url". The inputs named here do not exist, so nothing is ever
 * encoded: ffmpeg stops at the first one. */

const ffmpegOk = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0;
/** Every ffmpeg there is to ask: the one on PATH (8.1 here) and the app's own npm build (6.1), the nearest to
 *  production's Debian 5.1. REVIEW 2026-11-25: asked only 8.1, the flag list held "-autorotate" and "-autoscale",
 *  which 5.1 and 6.1 read WITH a value — two versions catch what one cannot. */
const readers = (() => {
  const out = ffmpegOk ? ["ffmpeg"] : [];
  try {
    const p = path.join(root, "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    if (fs.existsSync(p) && spawnSync(p, ["-version"], { encoding: "utf8" }).status === 0) out.push(p);
  } catch { /* the one on PATH */ }
  return out;
})();
type Reading = { inputs: string[][]; outputs: string[][]; globals: string[]; argOf: Map<number, string> };
const ffmpegReads = (args: string[], bin = "ffmpeg"): Reading => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r1c-read-"));
  try {
    // (-loglevel, not -v: ffmpeg looks for the first "-loglevel" before any "-v", and a run may say "-loglevel error")
    const r = spawnSync(bin, ["-loglevel", "debug", ...args], { encoding: "utf8", cwd: dir, timeout: 20_000 });
    const lines = String(r.stderr || "").split(/\r?\n/);
    const start = lines.findIndex((l) => l.startsWith("Splitting the commandline"));
    const end = lines.findIndex((l) => l.startsWith("Finished splitting the commandline"));
    assert.ok(start >= 0 && end > start, `ffmpeg split the command line: ${args.join(" ")}\n${(r.stderr || "").slice(-600)}`);
    const out: Reading = { inputs: [], outputs: [], globals: [], argOf: new Map() };
    let opts: string[] = [];
    for (const l of lines.slice(start + 1, end)) {
      const m = /^Reading option '(.*)' \.\.\. matched as (input url|output url|option '([^']+)'|AVOption '([^']+)')/.exec(l);
      assert.ok(m, `a line ffmpeg printed that this test cannot read: ${l}`);
      // (ffmpeg 6.x logs an input as "Reading option '-i' ... matched as output url with argument 'a.mp4'" — its
      // own misprint; an output url is logged without an argument. Read either way, the test runs on 6.1 as on 8.1.)
      if (m[2] === "input url" || (m[1] === "-i" && m[2] === "output url")) { out.inputs.push(opts); opts = []; continue; }
      if (m[2] === "output url") { out.outputs.push(opts); opts = []; continue; }
      // kept as the token was written ("c:v=copy", "threads=1"): ffmpeg's own name for "-c:v" is just 'c'
      const name = m[3] || m[4];
      const arg = /with argument '(.*)'\.$/.exec(l)?.[1] ?? "";
      if (name === "filter_threads" || name === "filter_complex_threads") out.globals.push(`${name}=${arg}`);
      opts.push(`${m[1].slice(1)}=${arg}`);
    }
    return out;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test("ffmpeg reads every capped run as meant: each input with its decoding thread, each picture it encodes with two, the filter threads", { skip: !readers.length && "no ffmpeg" }, () => {
  for (const bin of readers) for (const a of corpus()) {
    const before = ffmpegReads(a, bin);
    const capped = capThreads(a);
    const after = ffmpegReads(capped, bin);
    assert.equal(after.inputs.length, before.inputs.length, `the same inputs: ${a.join(" ")}`);
    assert.equal(after.outputs.length, before.outputs.length, `the same outputs: ${a.join(" ")}`);
    after.inputs.forEach((o, k) => {
      const own = before.inputs[k].find((x) => x.startsWith("threads="));
      assert.ok(o.includes(own || "threads=1"), `input ${k} decodes with ${own || "one thread"}: ${a.join(" ")}`);
      assert.deepEqual(o.filter((x) => !x.startsWith("threads=") && !/^filter(_complex)?_threads=/.test(x)), before.inputs[k].filter((x) => !x.startsWith("threads=")), "nothing else of the input's own is changed");
    });
    after.outputs.forEach((o, k) => {
      const own = before.outputs[k].find((x) => x.startsWith("threads="));
      // the picture is copied when the last codec said for video is "copy"
      const videoCodecs = before.outputs[k].filter((x) => /^(c|codec)(:v)?=|^vcodec=/.test(x));
      const copy = videoCodecs.length > 0 && videoCodecs[videoCodecs.length - 1].endsWith("=copy");
      if (own) assert.ok(o.includes(own), `output ${k} keeps its own ${own}`);
      else if (!copy && !before.outputs[k].includes("vn=1")) assert.ok(o.includes("threads=2"), `output ${k} encodes with two threads: ${a.join(" ")}`);
    });
    assert.ok(after.globals.some((g) => g.startsWith("filter_threads=")) && after.globals.some((g) => g.startsWith("filter_complex_threads=")), "the filter threads are set");
  }
});

test("every name in FFMPEG_FLAGS is a flag to ffmpeg itself (a valued option listed there would have its value read as a path)", { skip: !readers.length && "no ffmpeg" }, () => {
  const info = new Set(["L", "license", "version", "buildconf", "formats", "muxers", "demuxers", "devices", "codecs", "decoders", "encoders", "bsfs", "protocols", "filters", "pix_fmts", "layouts", "sample_fmts", "dispositions", "colors", "hwaccels"]);
  for (const bin of readers) for (const f of FFMPEG_FLAGS) {
    if (info.has(f)) continue; // they print and stop; no run names an output with them
    const r = ffmpegReads([`-${f}`, "zzvalue.mp4", "-i", "nope.mp4"], bin);
    assert.equal(r.outputs.length, 1, `-${f} took no value: "zzvalue.mp4" was read as an output (${bin})`);
  }
});

test("every option the app's source writes for ffmpeg is read the same way by capThreads and by ffmpeg", { skip: !readers.length && "no ffmpeg" }, () => {
  // each "-name" string literal in every app file that runs ffmpeg
  const names = new Set<string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) {
        const s = fs.readFileSync(p, "utf8");
        if (!/ffmpeg|runFfmpeg/i.test(s)) continue;
        for (const m of s.matchAll(/["'`]-([a-z][a-z0-9_]*)(?::[a-z0-9:]+)?["'`]/gi)) names.add(m[1]);
      }
    }
  };
  walk(path.join(root, "app"));
  assert.ok(names.size > 30, `found the app's options (${names.size})`);
  for (const bin of readers) {
  const seen: string[] = [];
  for (const n of [...names].sort()) {
    // a boolean whose arity changed between versions has no one right reading: capThreads leaves such a run alone
    if (FFMPEG_VERSIONED_FLAGS.has(n)) { assert.deepEqual(capThreads([`-${n}`, "1", "-i", "a.mp4", "o.mp4"]), [`-${n}`, "1", "-i", "a.mp4", "o.mp4"]); continue; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r1c-opt-"));
    try {
      const r = spawnSync(bin, ["-loglevel", "debug", `-${n}`, "zzvalue", "-i", "nope.mp4", "out.mp4"], { encoding: "utf8", cwd: dir, timeout: 20_000 });
      // its reading here — not this test's own "-loglevel debug" (nor, for -i, the "-i nope.mp4" after it)
      const line = String(r.stderr || "").split(/\r?\n/).find((l) => l.startsWith(`Reading option '-${n}'`) && !/with argument 'debug'\.$/.test(l));
      if (!line || !/matched as/.test(line)) continue; // not an ffmpeg option (an ffprobe or yt-dlp one, or a name's suffix)
      const flag = !/with argument 'zzvalue'\.$/.test(line); // a flag is logged with '1' (or '0' for -noX)
      seen.push(`${n}:${flag ? "flag" : "value"}`);
      assert.equal(takesValue(n), !flag, `${bin} reads -${n} as ${flag ? "a flag" : "taking a value"}; capThreads must too (ffmpeg-threads.ts → FFMPEG_FLAGS)`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  for (const must of ["y:flag", "an:flag", "vn:flag", "i:value", "map:value", "threads:value", "filter_complex:value", "noautorotate:flag"]) assert.ok(seen.includes(must), `${must} (${bin})`);
  }
});

/* ---- PIXELS: THREADS DO NOT CHANGE A FRAME OF WHAT IS DECODED AND FILTERED ---- */

test("the same frames decoded and filtered with the cap as without it (framemd5 of the story-motion chain)", { skip: !ffmpegOk && "no ffmpeg on PATH" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r1c-px-"));
  try {
    const clip = path.join(dir, "test-standin.mp4");
    const made = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=360x640:r=24:d=1", "-vf", "noise=alls=10:allf=t,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", clip], { encoding: "utf8" });
    assert.equal(made.status, 0, made.stderr);
    const look = (args: string[]) => { const r = spawnSync("ffmpeg", args, { encoding: "utf8", maxBuffer: 16 << 20 }); assert.equal(r.status, 0, r.stderr); return r.stdout.split("\n").filter((l) => !l.startsWith("#")).join("\n"); };
    const chain = ["-v", "error", "-i", clip, "-an", "-vf", "scale=540:960:force_original_aspect_ratio=increase,crop=540:960,setsar=1", "-f", "framemd5", "-"];
    const plain = look(["-cpucount", "16", ...chain]);
    const capped = look(["-cpucount", "16", ...capThreads(chain)]);
    assert.ok(plain.split("\n").length >= 24, "every frame hashed");
    assert.equal(capped, plain);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ---- SOURCE PINS: EVERY RUNNER APPLIES IT ---- */

test("runFfmpeg — the runner every job's encode goes through — caps every run, with the reason written beside it", () => {
  const src = read("app", "lib", "ugc-ad-pipeline.server.ts");
  assert.ok(src.includes('import { withThreadCap } from "./ffmpeg-threads.ts";'));
  assert.ok(src.includes("const p = spawn(ffmpegBin(), withThreadCap(args), { stdio: [\"ignore\", \"ignore\", \"pipe\"] });"));
  assert.ok(src.includes("FFMPEG_THREAD_CAP=off runs every encode as written."));
  assert.ok(src.includes("const out = spawnSync(ffmpegBin(), withThreadCap([ // one decoding thread, as every run (runFfmpeg)"), "the letterbox look too");
  assert.ok(!/spawn(Sync)?\(ffmpegBin\(\), \[/.test(src), "no run of ffmpeg left uncapped here");
});
