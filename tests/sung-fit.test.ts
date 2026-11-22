/* A SING-ALONG'S PICTURES FOLLOW ITS SONG — and whoever is in the picture stays in it.
 *
 * "One Umbrella, Three Little Ducks", a Kids Music Video made as a customer on 2026-11-22: four scenes of
 * five seconds, one lyric line written across each. The singer took fifteen seconds over the four lines,
 * so line three came up on screen as the singer finished line four, and the last scene showed line four
 * while the song — looped to fill the twenty seconds — started again from line one. In the same film the
 * duckling that "leaps feet-first into a big round puddle" was animated sinking into it, and was gone for
 * the rest of the scene.
 *
 * The times below are that film's own, heard by the transcriber the app uses. Re-cut with this fit, each
 * scene was on screen while its line was sung (looked at, one frame a second).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MOTION_GENTLE, MOTION_KEEPS_CAST, MOTION_NEGATIVE, SUNG_FIT, fitFilter, fitScenesToSong, sceneSpans } from "../app/lib/sung-fit.ts";
import { sceneLineTimes } from "../app/lib/lyric-sync.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

// the film's four lines, and every word of the song with the time it was heard (the loop's second
// "Pitter patter…", which started at 18.03 s, left out: the song itself is 17.46 s long)
const LINES = ["Pitter patter, rain falls down today", "Splish splash, we hop and we play", "One umbrella, not enough for three", "Take turns and share, that's the way to be!"];
const HEARD = "Pitter@0.57 patter@1.13 rain@1.69 falls@1.93 down@2.21 today@2.47 Splish@4.74 splash@5.30 we@5.70 hop@5.90 and@6.28 we@6.44 play@6.92 One@8.40 umbrella,@8.66 not@9.16 enough@9.78 for@10.38 three@10.61 Take@10.95 turns@11.21 and@11.55 share,@11.71 that's@12.23 the@12.53 way@12.71 to@13.05 be@13.21"
  .split(" ").map((x, i, all) => { const [word, t] = x.split("@"); const start = Number(t); const next = all[i + 1] ? Number(all[i + 1].split("@")[1]) : start + 0.24; return { word, start, end: Math.min(start + 0.5, next - 0.02) }; });
const SONG = 17.46;
const sum = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) * 100) / 100;

test("the real film: every scene is on screen while ITS line is sung, and the film is as long as the song", () => {
  const spans = sceneSpans(4, sceneLineTimes(LINES.map((caption) => ({ caption })), HEARD));
  assert.deepEqual(spans.map((s) => s && Math.round(s.start * 100) / 100), [0.57, 4.74, 8.4, 10.95], "when each line starts");
  const fit = fitScenesToSong(spans, SONG, 5)!;
  assert.ok(fit, "the song can be followed");
  assert.deepEqual(fit.map((f) => f.dur), [4.59, 3.66, 2.55, 6.66]);
  assert.equal(sum(fit.map((f) => f.dur)), SONG, "as long as the song — nothing loops, nothing is faded out half-way through its last bars");
  // the first three are cut short; the last is slowed a little to reach the end of the song, not held
  assert.deepEqual(fit.slice(0, 3).map((f) => [f.slow, f.hold]), [[1, 0], [1, 0], [1, 0]]);
  assert.deepEqual([fit[3].slow, fit[3].hold], [1.34, 0]);
  // each line starts inside its own scene, and at most the tail of a held note runs past it
  let at = 0;
  fit.forEach((f, k) => {
    const s = spans[k]!;
    assert.ok(s.start >= at && s.start < at + f.dur, `line ${k + 1} starts in scene ${k + 1}`);
    assert.ok(s.end <= at + f.dur + 0.25, `line ${k + 1} is over before scene ${k + 2}`);
    at += f.dur;
  });
  // what it was: five seconds a scene — line three (sung from 8.40) came up at 10 s, line four (sung from 10.95) at 15 s
  assert.ok(spans[2]!.end < 11 && spans[3]!.end < 15, "by which time the singer had finished them");
});

test("a song that cannot be followed leaves the film as it was", () => {
  const ok = [{ start: 1, end: 3 }, { start: 5, end: 7 }];
  assert.ok(fitScenesToSong(ok, 12, 5));
  assert.equal(fitScenesToSong([{ start: 1, end: 3 }, null], 12, 5), null, "a line that was not heard");
  assert.equal(fitScenesToSong([{ start: 5, end: 7 }, { start: 1, end: 3 }], 12, 5), null, "lines sung out of order");
  assert.equal(fitScenesToSong([], 12, 5), null);
  assert.equal(fitScenesToSong(ok, 0, 5), null, "no song");
  assert.equal(fitScenesToSong(ok, Number.NaN, 5), null);
  assert.equal(fitScenesToSong([{ start: 1, end: Number.NaN }, { start: 5, end: 7 }], 12, 5), null);
  assert.equal(fitScenesToSong([{ start: 1, end: 3 }, { start: 9.8, end: 9.9 }], 10, 5), null, "the song ran out before the last scene could have its line");
});

test("quick lines, slow lines, a long outro, a song that stops on its last word", () => {
  // QUICK: three lines in two seconds — no scene is shorter than the floor
  const quick = fitScenesToSong([{ start: 0.5, end: 0.9 }, { start: 1.0, end: 1.3 }, { start: 1.4, end: 1.9 }], 9, 5)!;
  assert.ok(quick.every((f) => f.dur >= SUNG_FIT.minScene - 0.001), JSON.stringify(quick));
  // SLOW: a lullaby, eight seconds a line — the clip is slowed as far as it may be and its last frame held
  const slow = fitScenesToSong([{ start: 0.2, end: 7 }, { start: 8.15, end: 15 }, { start: 16.15, end: 23 }], 24, 5)!;
  assert.deepEqual(slow.map((f) => f.dur), [8, 8, 8]);
  assert.deepEqual([slow[0].slow, slow[0].hold], [SUNG_FIT.maxSlow, 1], "5 s at 1.4x is 7 s, and one more held");
  // A LONG OUTRO: the last scene runs as far as its clip can, then the film ends (the song is faded there)
  const outro = fitScenesToSong([{ start: 1, end: 3 }, { start: 4.15, end: 6 }], 40, 5)!;
  assert.deepEqual([outro[1].dur, outro[1].slow, outro[1].hold], [7, SUNG_FIT.maxSlow, 0]);
  // …but never less than a moment after the last word, even when that takes a hold
  const late = fitScenesToSong([{ start: 1, end: 3 }, { start: 4.15, end: 12 }], 40, 5)!;
  assert.deepEqual([late[1].dur, late[1].hold], [10.2, 3.2]);
  // THE SONG STOPS ON ITS LAST WORD: so does the film
  const stop = fitScenesToSong([{ start: 1, end: 3 }, { start: 4.15, end: 6.9 }], 7, 5)!;
  assert.equal(sum(stop.map((f) => f.dur)), 7);
  // a slowed clip is never a frame short of the time it has to fill
  for (const f of [...slow, ...outro, ...late, ...stop]) assert.ok(5 * f.slow + f.hold >= f.dur - 0.011 || f.slow === 1, JSON.stringify(f));
});

test("a scene's span is its lines' — and the filter says what the fit says", () => {
  assert.deepEqual(sceneSpans(3, [{ scene: 0, start: 1, end: 2 }, { scene: 0, start: 2.5, end: 4 }, { scene: 2, start: 9, end: 10 }, { scene: 7, start: 1, end: 2 }]), [{ start: 1, end: 4 }, null, { start: 9, end: 10 }]);
  assert.deepEqual(sceneSpans(0, [{ scene: 0, start: 1, end: 2 }]), []);
  assert.equal(fitFilter({ dur: 3.66, slow: 1, hold: 0 }), "fps=30", "a clip that is only cut short is not touched");
  assert.equal(fitFilter({ dur: 6.66, slow: 1.34, hold: 0 }), "setpts=1.34*PTS,fps=30");
  assert.equal(fitFilter({ dur: 8, slow: 1.4, hold: 1 }), "setpts=1.40*PTS,tpad=stop_mode=clone:stop_duration=1.20,fps=30", "held a little longer than needed — the cut is made by the duration");
});

test("the engine fits a SUNG film's scenes to its song before assembling — and only a sung film's", () => {
  const eng = read("app", "lib", "film-engine.server.ts");
  const at = eng.indexOf("  let filmClips = clips;");
  const block = eng.slice(at, eng.indexOf("  const outBuf = fs.readFileSync(outPath);"));
  assert.ok(at > 0 && block.includes("if (tmpl.sung && musicIsSung && musicPath && clips.length === treatment.scenes.length) {"), "a sung song, and a clip for every scene");
  assert.ok(block.includes("const heard = await hearSong({ songPath: musicPath, lyricLines: lyricLinesOf(treatment.scenes), jobId });"));
  assert.ok(block.includes("const fit = fitScenesToSong(sceneSpans(clips.length, sceneLineTimes(treatment.scenes, heard)), ffprobeDuration(musicPath), CLIP_SECONDS);"));
  assert.ok(block.includes("\"-vf\", fitFilter(fit[i]), \"-t\", fit[i].dur.toFixed(2), \"-an\""));
  // it never costs the film: whatever goes wrong, the scenes keep their own length
  assert.ok(block.includes("console.error(\"[film] could not fit the scenes to the song (keeping five seconds a scene):\"") && block.includes("      filmClips = clips;\n      // (a fit that stopped half-way leaves nothing behind)"));
  assert.ok(block.includes("  await assembleFilm({\n    clips: filmClips,"));
  assert.ok(block.includes("for (const f of filmClips) { if (!clips.includes(f)) { try { fs.unlinkSync(f); } catch { /* best effort */ } } }"), "the fitted copies are cleared; the filmed clips are kept for a resume");
  // …and the finished film is levelled to where the music videos play (two songs made the same hour: -14.5 and -10.8 LUFS)
  assert.ok(block.includes("if (musicIsSung) { try { const { levelFilm } = await import(\"./film-loudness.server\"); await levelFilm(outPath, -14); } catch { /* left as it was */ } }"));
  // the song is heard the way a song is: softly first, the stock settings when that catches little
  const cap = read("app", "lib", "film-captions.server.ts");
  const hear = cap.slice(cap.indexOf("export async function hearSong("), cap.indexOf("/** LYRICS ON SCREEN for a music video"));
  assert.ok(hear.includes("let heard = await listen(true);") && hear.includes("if (heardTooLittle(lyricWordTimes(o.lyricLines, heard))) {") && hear.includes("const again = await listen(false);"));
  assert.ok(hear.includes("createWhisperx(url, null, { sung })"), "the language is detected, not assumed");
});

test("the animator is told FIRST that whoever is in the picture stays in it", () => {
  for (const must of ["stays in the picture", "Nobody leaves the frame, sinks, goes under water, vanishes, melts or changes shape", "nobody new appears"]) assert.ok(MOTION_KEEPS_CAST.includes(must), must);
  assert.ok(MOTION_GENTLE.includes("on the spot"));
  for (const must of ["a character disappearing", "sinking or going under water", "a new character appearing"]) assert.ok(MOTION_NEGATIVE.includes(must), must);
  const eng = read("app", "lib", "film-engine.server.ts");
  assert.ok(eng.includes("const motion = `${safePhrase}${MOTION_KEEPS_CAST}${tmpl.childSafe ? MOTION_GENTLE : \"\"}${scene.visual}. ${castBible}${productLine} ${tmpl.sceneHint}."), "before the scene's own words, which may be cut by the engine's limit");
  assert.ok(eng.includes("animateCreate(undefined, { startImage: seedAbs, prompt: motion, negativePrompt: MOTION_NEGATIVE, durationSec: CLIP_SECONDS })"));
});
