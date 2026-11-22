/* A music video's length is picked in SECONDS; the pace decides how many scenes that is.
 *
 * The owner, 2026-11-21: "when we set up the music videos during the UI setup we have it by seconds and
 * not scenes — that way there could potentially be many scenes to come out and it works better with
 * pace … if we need to help guide scenes for better outcomes we should. Original lyrics only."
 *
 * The video model makes a clip of 5 or 10 seconds, so a slow video is ten-second scenes and a medium or
 * fast one is five-second scenes: the same 30 seconds is 3 scenes slow, 6 scenes medium or fast. These pin
 * the arithmetic, that a five-second performance is still never moved out of sync, that the song writer
 * is told what each scene is filmed as, and that the words are always new. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  MV_DEFAULT_SECONDS, MV_MAX_SECONDS, MV_SECONDS, PACES, PACE_KEYS, SCENE_SECONDS, SHOT_NOTES, SHOT_ROLES,
  cutCount, defaultRole, editPlan, lengthLabel, mvBillScenes, planFilter, sceneCountFor, sceneSecondsFor, sceneSecondsOf, shotSlot,
  type Cut, type ShotRole,
} from "../app/lib/mv-pace.ts";
import { ORIGINAL_LYRICS_RULE } from "../app/lib/lyrics-rules.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");
const rolesFor = (n: number, sec: number): ShotRole[] => Array.from({ length: n }, (_, i) => defaultRole(i, n, sec));
const onTimeline = (cuts: Cut[]) => { let t = 0; return cuts.map((c) => { const at = t; t += c.dur; return { ...c, at }; }); };

test("the pace decides how long a scene is, and the seconds decide how many there are", () => {
  assert.deepEqual(SCENE_SECONDS, { slow: 10, medium: 5, fast: 5 });
  assert.equal(sceneSecondsFor("slow"), 10);
  assert.equal(sceneSecondsFor("fast"), 5);
  // the same 30 seconds: 3 scenes slow, 6 medium or fast
  assert.equal(sceneCountFor(30, sceneSecondsFor("slow")), 3);
  assert.equal(sceneCountFor(30, sceneSecondsFor("medium")), 6);
  assert.equal(sceneCountFor(30, sceneSecondsFor("fast")), 6);
  // every length on offer, both ways — and the video is always exactly the seconds that were picked
  for (const s of MV_SECONDS) for (const sec of [5, 10]) assert.equal(sceneCountFor(s, sec) * sec, s, `${s}s of ${sec}s scenes`);
  assert.equal(sceneCountFor(10, 10), 1, "ten seconds slow is one shot");
  assert.equal(sceneCountFor(10, 5), 2);
  assert.equal(sceneCountFor(120, 5), 24, "two minutes of five-second scenes — many scenes, as asked");
  // never longer than two minutes, never fewer than one scene, never a nonsense count
  assert.equal(sceneCountFor(600, 5), MV_MAX_SECONDS / 5);
  assert.equal(sceneCountFor(600, 10), MV_MAX_SECONDS / 10);
  assert.equal(sceneCountFor(0, 10), 1);
  assert.equal(sceneCountFor(NaN, 5), 1);
  assert.ok(MV_SECONDS.includes(MV_DEFAULT_SECONDS));
  assert.equal(Math.max(...MV_SECONDS), MV_MAX_SECONDS);
  // what arrives from a form or an old job is 5 only when it says 5
  assert.equal(sceneSecondsOf(5), 5);
  assert.equal(sceneSecondsOf("5"), 5);
  for (const v of [10, "10", undefined, null, "", 7, "fast", 0]) assert.equal(sceneSecondsOf(v), 10, String(v));
  // the labels
  assert.equal(lengthLabel(30), "30s");
  assert.equal(lengthLabel(60), "1:00");
  assert.equal(lengthLabel(90), "1:30");
  assert.equal(lengthLabel(120), "2:00");
});

test("a video costs its length, whatever the pace", () => {
  for (const s of MV_SECONDS) {
    assert.equal(mvBillScenes(sceneCountFor(s, 5), 5), mvBillScenes(sceneCountFor(s, 10), 10), `${s}s`);
    assert.equal(mvBillScenes(sceneCountFor(s, 10), 10), s / 10);
  }
  assert.equal(mvBillScenes(1, 5), 1, "never less than one");
  assert.equal(mvBillScenes(3, 5), 2, "an odd number of five-second scenes rounds up");
  // the page quotes with the function the action charges with
  const ui = read("app", "routes", "web.film.tsx");
  assert.match(ui, /const cost = estimateFilmTokens\(tmpl\.lipSyncSinger \? mvBillScenes\(scenes, filmSceneSeconds\) : scenes\);/);
  assert.match(ui, /const cost = estimateFilmTokens\(tmpl\?\.lipSyncSinger \? mvBillScenes\(mvSceneCount, mvSceneSec\) : scenes\);/);
});

test("a short video leads with the performance; a longer one follows the director's cadence", () => {
  assert.equal(defaultRole(0, 1, 10), "perform", "a 10-second video IS the artist singing");
  assert.deepEqual(rolesFor(2, 10), ["perform", "broll"]);
  assert.deepEqual(rolesFor(2, 5), ["perform", "broll"], "10 seconds of five-second scenes");
  assert.deepEqual(rolesFor(4, 5), ["perform", "broll", "perform", "broll"], "20 seconds of five-second scenes");
  // 30 seconds and up: the cadence
  assert.deepEqual(rolesFor(3, 10), SHOT_ROLES.slice(0, 3));
  assert.deepEqual(rolesFor(6, 5), SHOT_ROLES.slice(0, 6));
  assert.deepEqual(rolesFor(24, 5), Array.from({ length: 24 }, (_, i) => SHOT_ROLES[i % 8]));
  // every video of two scenes or more has someone singing to camera AND something to cut away to
  for (const s of MV_SECONDS) for (const sec of [5, 10]) {
    const roles = rolesFor(sceneCountFor(s, sec), sec);
    assert.ok(roles.includes("perform"), `${s}s/${sec}`);
    if (roles.length > 1) assert.ok(roles.includes("broll"), `${s}s/${sec}`);
  }
  // unset scene length = ten seconds, as every video was before
  assert.equal(defaultRole(1, 2), "broll");
});

test("the roles, the writer's notes and the pipeline's shot list are one list", () => {
  assert.equal(SHOT_ROLES.length, 8);
  assert.equal(SHOT_NOTES.length, SHOT_ROLES.length);
  SHOT_NOTES.forEach((note, k) => assert.ok(note.startsWith(SHOT_ROLES[k] === "perform" ? "PERFORMANCE" : "CUT SCENE"), `slot ${k}`));
  // the pipeline's SHOTLIST (the framing for each slot) is in the same order
  const pipe = read("app", "lib", "music-video-pipeline.server.ts");
  const list = pipe.slice(pipe.indexOf("const SHOTLIST"), pipe.indexOf("type Shot ="));
  const roles = [...list.matchAll(/\{ role: "(perform|broll)",\s+kind: "[^"]{6,60}", frame: "/g)].map((m) => m[1]);
  assert.deepEqual(roles, SHOT_ROLES);
  // every slot has the short framing a cast shot is given
  assert.equal([...list.matchAll(/short: "[^"]{8,120}"/g)].length, SHOT_ROLES.length);
  // a scene is framed by a slot of ITS kind, wherever it sits and whatever it was flipped to
  for (let i = 0; i < 40; i++) for (const role of ["perform", "broll"] as const) assert.equal(SHOT_ROLES[shotSlot(role, i)], role, `scene ${i} as ${role}`);
  // on the cadence a scene keeps its own slot
  for (let i = 0; i < 16; i++) assert.equal(shotSlot(SHOT_ROLES[i % 8], i), i % 8);
  // two performances in a row are not the same framing twice
  assert.notEqual(shotSlot("perform", 0), shotSlot("perform", 2));
  // the pipeline and the page both deal roles with the shared function (they each had a copy)
  assert.match(pipe, /const role = \(s && s\.kind\) \|\| defaultRole\(i, n, sceneSec\);/);
  const ui = read("app", "routes", "web.film.tsx");
  assert.match(ui, /const defaultSceneRole = \(i: number, n: number\): "perform" \| "broll" => defaultRole\(i, n, mvSceneSec\);/);
  assert.doesNotMatch(ui, /const DEFAULT_ROLES/);
});

test("five-second scenes: medium plays each scene whole, fast splits its cut scenes — the singer is never moved", () => {
  for (const s of [10, 20, 30, 60, 120]) {
    const n = sceneCountFor(s, 5);
    const roles = rolesFor(n, 5);
    // medium: every clip whole, in order — the scene changes ARE the cuts
    assert.deepEqual(editPlan(roles, 5, "medium"), roles.map((_, i) => ({ src: i, start: 0, dur: 5 })), `${s}s medium`);
    assert.equal(cutCount(roles, 5, "medium"), n - 1);
    for (const pace of PACE_KEYS) {
      const cuts = onTimeline(editPlan(roles, 5, pace));
      // exactly the picked length
      assert.ok(Math.abs(cuts.reduce((a, c) => a + c.dur, 0) - s) < 1e-9, `${s}s ${pace}`);
      for (const c of cuts) {
        // never reads past the end of a clip, never a sliver
        assert.ok(c.start >= -1e-9 && c.start + c.dur <= 5 + 1e-9, `${s}s ${pace}`);
        assert.ok(c.dur >= 2.5 - 1e-9, "no piece shorter than half a scene");
        // a performance plays only at its own place in the song
        if (roles[c.src] === "perform") assert.ok(Math.abs(c.at - (c.src * 5 + c.start)) < 1e-9, `${s}s ${pace}: scene ${c.src} moved`);
      }
      // a five-second performance is too short to cut away from: it is held whole
      roles.forEach((r, i) => { if (r === "perform") assert.equal(cuts.filter((c) => c.src === i).length, 1, `${s}s ${pace}: performance ${i} was split`); });
    }
    // fast is at least as busy as medium, and busier once there are two cut scenes to trade
    assert.ok(cutCount(roles, 5, "fast") >= cutCount(roles, 5, "medium"));
    if (roles.filter((r) => r === "broll").length >= 2) assert.ok(cutCount(roles, 5, "fast") > cutCount(roles, 5, "medium"), `${s}s`);
  }
  // the same length is more scene changes the faster the pace (30 seconds: 2 → 5 → more)
  const c30 = PACE_KEYS.map((p) => cutCount(rolesFor(sceneCountFor(30, sceneSecondsFor(p)), sceneSecondsFor(p)), sceneSecondsFor(p), p));
  assert.equal(c30[0], 2);
  assert.equal(c30[1], 5);
  assert.ok(c30[2] > c30[1]);
  // the builder no longer says a medium cut "trades places" — at five seconds each scene plays whole
  assert.equal(PACES.medium.blurb, "A new scene every few seconds");
  // …and it shows, for each pace, how many scenes the picked length is
  const ui = read("app", "routes", "web.film.tsx");
  assert.match(ui, /const n = mine && seeds \? seeds\.treatment\.scenes\.length : sceneCountFor\(mvSeconds, sec\);/);
  assert.match(ui, /return \{ n, cuts: cutCount\(roles, sec, p\) \};/);
});

test("ffmpeg cuts a video of five-second scenes to exactly the picked length", { skip: spawnSync("ffmpeg", ["-version"]).status !== 0 && "ffmpeg is not on this machine" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mvsec-"));
  try {
    const n = 6, D = 5, roles = rolesFor(n, D);
    const beats: number[] = [];
    for (let t = 0.3; t < n * D; t += 60 / 104) beats.push(t);
    const cuts = editPlan(roles, D, "fast", beats);
    assert.ok(cuts.length > n, "a fast cut of six scenes has more pieces than scenes");
    const args: string[] = [];
    for (let i = 0; i < n; i++) {
      const f = path.join(dir, `c${i}.mp4`);
      assert.equal(spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", `testsrc2=s=180x320:r=30:d=${D}`, "-frames:v", String(D * 30), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", f], { encoding: "utf8" }).status, 0);
      args.push("-i", f);
    }
    const out = path.join(dir, "o.mp4");
    const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args, "-filter_complex", planFilter(cuts, n, 30), "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", out], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr.slice(-300));
    const frames = Number(spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", out], { encoding: "utf8" }).stdout.trim());
    assert.equal(frames, n * D * 30, "30 seconds, to the frame");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the scene length rides from the page to the render, and an old job is still ten-second scenes", () => {
  const ui = read("app", "routes", "web.film.tsx");
  // the page: seconds are picked, the count follows from the pace
  assert.match(ui, /const \[mvSeconds, setMvSeconds\] = useState<number>\(MV_DEFAULT_SECONDS\);/);
  assert.match(ui, /const mvSceneSec = sceneSecondsFor\(mvPace\);/);
  assert.match(ui, /const n = sceneCountFor\(mvSeconds, mvSceneSec\);\s+setScenes\(n\);/);
  assert.match(ui, /onClick=\{\(\) => setMvSeconds\(s\)\}/);
  // …and nothing else may leave the count at the format's default: opening the format card did, and the
  // page read "15s · 3 scenes" beside a picker that said 30 seconds (seen on the live site, 2026-11-21)
  assert.match(ui, /setScenes\(nt\?\.lipSyncSinger \? mvWant : \(nt\?\.defaultScenes \|\| 6\)\);/);
  assert.match(ui, /if \(tmpl\?\.lipSyncSinger && !treatment && !seeds && scenes !== mvWant\) setScenes\(mvWant\);/);
  // …it goes with the song request, the storyboard request, a re-roll, and the render
  for (const intent of ["previewFilmTreatment", "previewFilmScenes", "rerollFilmScene"]) {
    const at = ui.indexOf(`{ intent: "${intent}"`);
    assert.ok(at > 0, intent);
    assert.match(ui.slice(at, at + 400), /filmSceneSeconds: String\(mvSceneSec\)/, intent);
  }
  assert.match(ui, /<input type="hidden" name="filmSceneSeconds" value=\{String\(mvSceneSec\)\} \/>/);
  // the action: read once, for a music video only, and the scene count is held to two minutes of it
  assert.match(ui, /const filmSceneSeconds = tmpl\.lipSyncSinger \? sceneSecondsOf\(\(\(form\.get\("filmSceneSeconds"\) as string\) \|\| ""\)\.trim\(\)\) : 10;/);
  assert.match(ui, /Math\.min\(tmpl\.maxScenes, Math\.floor\(MV_MAX_SECONDS \/ filmSceneSeconds\)\)/);
  assert.match(ui, /\.\.\.\(tmpl\.lipSyncSinger \? \{ filmSceneSeconds \} : \{\}\),/);
  // the queue hands it on; a job from before this existed has none and is ten seconds
  const queue = read("app", "lib", "job-queue.server.ts");
  assert.match(queue, /sceneSeconds: payload\.filmSceneSeconds === 5 \? 5 : 10,/);
  // the pipeline: the clip length, the song length and the picked-length fit all go by it
  const pipe = read("app", "lib", "music-video-pipeline.server.ts");
  const gen = pipe.slice(pipe.indexOf("export async function generateMusicVideo"));
  assert.match(gen, /const D = sceneSecondsOf\(opts\.sceneSeconds\);/);
  assert.match(gen, /Math\.floor\(MV_MAX_SECONDS \/ D\)/);
  assert.match(gen, /const fullLength = songEngineFor\(N \* D\) === "full";/);
  assert.match(gen, /minSeconds: N \* D/);
  assert.match(gen, /const targetLen = N \* D;/);
  assert.match(gen, /durationSec: D,/);
  assert.doesNotMatch(gen, /N \* 10/, "nothing still assumes ten-second scenes");
  assert.doesNotMatch(gen, /const D = 10/);
  // the video model takes exactly these two lengths
  const fal = read("app", "lib", "fal-video.server.ts");
  assert.match(fal, /duration: String\(opts\.durationSec \?\? /);
  // the format allows two minutes of five-second scenes
  const engine = read("app", "lib", "film-engine.server.ts");
  const mv = engine.slice(engine.indexOf('key: "musicvideo"'), engine.indexOf('key: "musicvideo"') + 1400);
  assert.match(mv, /maxScenes: 24,/);
  assert.match(mv, /minScenes: 1,/);
});

test("the song writer is told what each scene is filmed as, who sings, and when a microphone fits", () => {
  const engine = read("app", "lib", "film-engine.server.ts");
  const fn = engine.slice(engine.indexOf("export async function previewFilmTreatment"), engine.indexOf("// ---- Assembly"));
  // the shot list, scene by scene, from the same notes the roles come from
  assert.match(fn, /SHOT_NOTES\[shotSlot\(roles\[i\], i\)\]/);
  assert.match(fn, /const cadence = Array\.from\(\{ length: n \}, \(_, i\) => defaultRole\(i, n, sceneSec\)\);/);
  // one moment a scene: a sequence of actions was drawn as the artist twice
  assert.match(fn, /ONE moment — a single frame of film, never a sequence of actions/);
  assert.match(fn, /THE SHOT LIST — scene by scene, this is what each one is filmed as; write each VISUAL to fit its line/);
  // it used to be told every scene was the artist performing to camera
  assert.doesNotMatch(fn, /the place and the artist performing to camera/);
  // only the artist sings; co-stars dance beside them in a performance
  assert.match(fn, /WHO DOES WHAT — only the ARTIST ever sings\./);
  assert.match(fn, /the co-stars are in the shot WITH the artist: beside or just behind them, dancing or moving to the music — never singing/);
  // microphones only where one belongs
  assert.match(fn, /MICROPHONES — most music videos have none: the song is mimed\. Do NOT put a microphone or mic stand in a VISUAL unless that scene is a live stage show or a recording booth — and then ONLY the artist has one\./);
  // the lyric budget goes by the video's length in seconds, not by a count of ten-second scenes
  assert.match(fn, /const videoSecs = scenes \* sceneSec;/);
  assert.match(fn, /const shortCut = videoSecs <= 20;/);
  assert.match(fn, /const fullSong = songEngineFor\(videoSecs\) === "full";/);
  assert.match(fn, /const fullLines = fullSongLines\(videoSecs\);/);
  // each scene comes back carrying what it was written as
  assert.match(fn, /\.\.\.\(tmpl\.lipSyncSinger \? \{ kind: outRoles\[i\] \} : \{\}\),/);
  // the pipeline picks its song engine with the SAME function the writer wrote the song for
  assert.match(read("app", "lib", "music-video-pipeline.server.ts"), /const fullLength = songEngineFor\(N \* D\) === "full";/);
});

test("the song is written to the length its engine will sing it at", async () => {
  const { FULL_LINE_SECONDS, FULL_SONG_SECONDS, INTRO_KEEP_SECONDS, INTRO_MAX_SECONDS, SHORT_ENGINE_WORDS, SING_RATE, fitLyricLines, fullSongLines, introCut, sceneWordsFor, songEngineFor, songWordsFor, wordsAsLines } = await import("../app/lib/mv-song.ts");
  // MEASURED 2026-11-22 (the same nine-word lines in each genre's own style, timed word by word, the
  // short engine): rap 54 words in 17 s and 108 in 31 s; rock 78 in 24 s; pop 54 in 26 s, 81 in 37 s,
  // 108 in 46 s; R&B 78 in 33 s; country 54 in 34 s and 57 in 26 s. The first live 30-second videos were
  // given six lines and were out of words by 15–17 s — their second half repeated the first.
  assert.ok(SING_RATE.rap >= 3 && SING_RATE.rap <= 3.6);
  assert.ok(SING_RATE.rock >= 3 && SING_RATE.rock <= 3.4);
  assert.ok(SING_RATE.pop >= 2 && SING_RATE.pop <= 2.4);
  assert.ok(SING_RATE.rnb >= 2.1 && SING_RATE.rnb <= 2.5);
  assert.ok(SING_RATE.country >= 1.7 && SING_RATE.country <= 2.2);
  // 30 seconds of pop needs about 70 words — not the 45 or so of "a line a scene"
  assert.ok(songWordsFor("pop", 30) >= 66 && songWordsFor("pop", 30) <= 76, String(songWordsFor("pop", 30)));
  assert.ok(songWordsFor("pop", 20) >= 44 && songWordsFor("pop", 20) <= 52);
  assert.ok(songWordsFor("country", 30) >= 60);
  // every short-engine length: the words fit the engine, and — unless the engine's limit is what stops
  // them — last to the end of the video at the genre's pace
  for (const g of Object.keys(SING_RATE)) for (const s of MV_SECONDS) {
    if (songEngineFor(s) !== "short") continue;
    const w = songWordsFor(g, s);
    assert.ok(w <= SHORT_ENGINE_WORDS, `${g} ${s}s: ${w} words do not fit the short engine`);
    if (w < SHORT_ENGINE_WORDS) assert.ok(w / SING_RATE[g] >= s, `${g} ${s}s: ${w} words run out before the video ends`);
  }
  // rap and rock fill the engine at about half a minute
  assert.equal(songWordsFor("rap", 30), SHORT_ENGINE_WORDS);
  assert.ok(songWordsFor("rap", 20) < SHORT_ENGINE_WORDS);
  // WHICH ENGINE: the full-length one always opens on about fifteen seconds of music (15.0 s without an
  // [Intro] tag, 16.8 s with one), so it is for a minute and up only
  assert.equal(FULL_SONG_SECONDS, 60);
  for (const s of MV_SECONDS) assert.equal(songEngineFor(s), s >= 60 ? "full" : "short", `${s}s`);
  // …at a line every 4-5 seconds, a touch generous so the song is trimmed, not repeated
  assert.equal(fullSongLines(60), Math.round(60 / FULL_LINE_SECONDS));
  assert.equal(fullSongLines(120), 29);
  // a scene's share
  assert.equal(sceneWordsFor("pop", 5), 11);
  assert.equal(sceneWordsFor("rap", 5), 16);
  assert.equal(sceneWordsFor("country", 10), 20);
  // …which, where the engine's limit caps the song, is its share of what fits (30 s of rap: 95 words over six scenes)
  assert.equal(sceneWordsFor("rap", 5, 30), 16);
  assert.ok(sceneWordsFor("rap", 5, 45) <= 11, "45 s of rap cannot have 16 words a scene: the engine takes 95 in all");
  assert.equal(wordsAsLines(11), "1–2 short lines");
  assert.equal(wordsAsLines(30), "3–5 short lines");
  // the writer is told the words, per video and per scene, and that the engine stops when they run out
  const engine = read("app", "lib", "film-engine.server.ts");
  const fn = engine.slice(engine.indexOf("export async function previewFilmTreatment"), engine.indexOf("// ---- Assembly"));
  assert.match(fn, /about \$\{songWords\} words in TOTAL \(\$\{wordsAsLines\(songWords\)\}\), spread evenly — \$\{perScene\} in every scene/);
  assert.match(fn, /STOPS when the words run out/);
  assert.match(fn, /EVERY scene has one — a cut scene too: the song does not stop for it/);
  assert.doesNotMatch(fn, /The music engine expands these lyrics into a full-length track/, "it does not — it stops, plays on without words, or makes words up");
  assert.match(fn, /const sceneWords = sceneWordsFor\(genreKey, sceneSec, videoSecs\);/);

  // THE OPENING: a song whose first word comes late is started a few seconds before it
  assert.equal(introCut(0.6), 0, "a song that starts singing at once is left alone");
  assert.equal(introCut(INTRO_MAX_SECONDS), 0);
  assert.ok(Math.abs(introCut(15) - (15 - INTRO_KEEP_SECONDS)) < 1e-9, "the full-length engine's fifteen seconds become three and a half");
  assert.ok(Math.abs(introCut(12.6) - (12.6 - INTRO_KEEP_SECONDS)) < 1e-9);
  assert.equal(introCut(null), 0, "no words heard: nothing is cut");
  assert.equal(introCut(NaN), 0);
  const pipe = read("app", "lib", "music-video-pipeline.server.ts");
  const gen = pipe.slice(pipe.indexOf("export async function generateMusicVideo"));
  // …only a song WE made (never a track the maker brought), before it is fit to the video's length
  assert.match(gen, /songPath = await trimSongIntro\(songPath, base\);\s+await ckpt\(\{ ckSong: songPath \}\);/);
  assert.ok(gen.indexOf("if (!songPath && opts.songUrl)") < gen.indexOf("trimSongIntro(songPath, base)"));
  assert.ok(gen.indexOf("trimSongIntro(songPath, base)") < gen.indexOf("fitSongToLength(songPath, targetLen)"));
  const trim = pipe.slice(pipe.indexOf("async function trimSongIntro"), pipe.indexOf("/** Force the song to EXACTLY"));
  assert.match(trim, /const cut = introCut\(first\);\s+if \(!\(cut > 0\.3\)\) return songPath;/);
  assert.match(trim, /return songPath;\s+\}\s*$/, "anything that goes wrong leaves the song as it was");
  // the full-length take is asked to be long enough to lose its opening and still cover the video
  assert.match(gen, /minSeconds: N \* D \+ \(fullLength \? 12 : 0\)/);
  assert.match(gen, /Vocals start right away — no instrumental intro\./);

  // a sheet over the short engine's limit loses whole lines from the end, never half a word
  const sheet = ["one two three four", "five six seven eight", "nine ten eleven twelve"].join("\n");
  assert.equal(fitLyricLines(sheet, 100), sheet);
  assert.equal(fitLyricLines(sheet, 45), "one two three four\nfive six seven eight");
  assert.equal(fitLyricLines(sheet, 20), "one two three four");
  assert.equal(fitLyricLines("supercalifragilistic expialidocious again", 25), "supercalifragilistic");
  assert.equal(fitLyricLines("", 50), "");
  assert.equal(fitLyricLines(" a \n\n b ", 50), "a\nb");
  assert.match(gen, /const shortSheet = fitLyricLines\(lyrics, 585\);/);
});

test("lyrics are always new words — even when the brief names a famous song", () => {
  // the rule itself
  assert.match(ORIGINAL_LYRICS_RULE, /ORIGINAL WORDS ONLY/);
  assert.match(ORIGINAL_LYRICS_RULE, /NEVER quote, continue, translate or closely rework the lyrics, hook or title of any existing song — even when the brief names one/);
  assert.match(ORIGINAL_LYRICS_RULE, /give it a new title of its own/);
  // every place a song is written carries it
  const engine = read("app", "lib", "film-engine.server.ts");
  assert.match(engine, /import \{ ORIGINAL_LYRICS_RULE \} from "\.\/lyrics-rules";/);
  assert.match(engine, /\(tmpl\.lipSyncSinger \|\| tmpl\.sung \? `\$\{ORIGINAL_LYRICS_RULE\}\\n` : ""\)/);
  const jingle = read("app", "lib", "jingle-ad-pipeline.server.ts");
  assert.match(jingle, /ORIGINAL_LYRICS_RULE/);
  assert.ok(jingle.split("ORIGINAL_LYRICS_RULE").length >= 3, "imported and used in the jingle's lyric prompt");
});
