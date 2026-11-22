/* Lyrics on screen: the lyric lines, in their own spelling, timed by the words heard in the song. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LISTEN_AGAIN_BELOW, LISTEN_AUDIO, SUNG_VAD, heardTooLittle, lyricWordTimes, lyricLinesOf } from "../app/lib/lyric-sync.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");

const w = (word: string, start: number, end: number) => ({ word, start, end });

test("heard as written: every word takes its heard time, one window per line", () => {
  const r = lyricWordTimes(["Neon lights on the boulevard", "We were young and loud"], [
    w("Neon", 1.0, 1.4), w("lights", 1.5, 1.9), w("on", 2.0, 2.1), w("the", 2.2, 2.3), w("boulevard", 2.4, 3.2),
    w("We", 4.0, 4.2), w("were", 4.3, 4.5), w("young", 4.6, 5.0), w("and", 5.1, 5.2), w("loud", 5.3, 6.0),
  ]);
  assert.equal(r.matched, 10);
  assert.deepEqual(r.lines, ["Neon lights on the boulevard", "We were young and loud"]);
  assert.equal(r.timed[0].start, 1.0);
  assert.ok(r.timed[4].last && r.timed[9].last, "each line's last word is marked");
  assert.ok(r.windows[0].t1 <= r.windows[1].t0, "windows never overlap");
});

test("misheard and missed words: spelling comes from the lyrics, time from around them", () => {
  const r = lyricWordTimes(["Dancing in the moonlight tonight"], [w("dancin", 1, 1.5), w("the", 1.8, 2.0), w("moonlite", 2.1, 2.8), w("tonight", 3, 3.6)]);
  assert.deepEqual(r.timed.map((x) => x.word), ["Dancing", "in", "the", "moonlight", "tonight"]);
  const inWord = r.timed[1];
  assert.ok(inWord.start >= 1.5 - 1e-9 && inWord.end <= 1.8 + 1e-9, "the unheard word sits between its heard neighbours");
});

test("a repeated hook is matched in order, not to its first appearance", () => {
  const r = lyricWordTimes(["Hey hey", "Hey hey"], [w("hey", 1, 1.3), w("hey", 1.4, 1.7), w("hey", 9, 9.3), w("hey", 9.4, 9.7)]);
  assert.equal(r.windows.length, 2);
  assert.ok(r.windows[1].t0 > 8, "the second line is the second time it was sung");
});

test("a line the song never reached is not shown; an unheard opener waits for its own line", () => {
  const r = lyricWordTimes(["First line sung here", "Oh baby come back now", "Never sung at all"], [
    w("First", 1, 1.3), w("line", 1.4, 1.7), w("sung", 1.8, 2.1), w("here", 2.2, 2.6),
    // 25 s of instrumental, then the second line — its first word unheard
    w("baby", 30, 30.4), w("come", 30.5, 30.8), w("back", 30.9, 31.2), w("now", 31.3, 31.8),
  ]);
  assert.deepEqual(r.lines, ["First line sung here", "Oh baby come back now"], "the third line was cut off by the song's end");
  const oh = r.timed.find((x) => x.word === "Oh")!;
  assert.ok(oh.start > 29 && oh.start < 30, "the unheard 'Oh' sits just before 'baby', not across the instrumental");
});

test("nothing heard → nothing shown; lyric lines come apart on slashes", () => {
  assert.deepEqual(lyricWordTimes(["A line"], []).lines, []);
  assert.deepEqual(lyricLinesOf([{ caption: "Line one / Line two" }, { caption: "" }, { caption: "Line three" }]), ["Line one", "Line two", "Line three"]);
});

import { drawable } from "../app/lib/lyric-sync.ts";
import { drawable as cardsDrawable } from "../app/lib/narrated-core.ts";
test("lyric words are cut exactly as the caption cards cut lines", () => {
  for (const s of ["Don't stop — believin'!", "Hey, hey; HEY: 100% $5 tonight…", "café – naïve résumé"]) assert.equal(drawable(s), cardsDrawable(s));
});

test("a music video can carry its lyrics, off unless the maker picks a style", () => {
  const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const mv = read("app/lib/music-video-pipeline.server.ts");
  assert.ok(mv.includes("captionLyrics({ filmPath: outPath"), "burned after the cut");
  assert.ok(mv.includes("opts.songUrl ? [] : lyricLinesOf(scenes)"), "a merchant's own track is captioned from what is heard");
  const q = read("app/lib/job-queue.server.ts");
  assert.ok(q.includes('captions: payload.filmCaptions === "bold" || payload.filmCaptions === "subtitles" ? payload.filmCaptions : "off"'));
  const ui = read("app/routes/web.film.tsx");
  assert.ok(ui.includes('useState<CaptionStyle>("off")') && ui.includes('name="filmCaptions" value={mvLyrics}'), "off by default, sent with the video");
  const cap = read("app/lib/film-captions.server.ts");
  assert.ok(cap.includes("createWhisperx(src, null, { sung })"), "the song's language is heard, not assumed");
});

test("a song is listened to at full rate, on its vocal alone first, and again when a listen caught too little", () => {
  // (a real video, 2026-11-22: no words on screen for its first sixteen seconds. The transcriber had been
  //  sent a 16 kHz / 64k copy of the mix and heard nine "oh"s; the same sound at full rate: 52 of 56 words)
  assert.deepEqual([...LISTEN_AUDIO], ["-ac", "1", "-ar", "44100", "-b:a", "192k"]);
  assert.ok(!LISTEN_AUDIO.includes("16000") && !LISTEN_AUDIO.includes("64k"));
  // softer than the transcriber's own voice detector (0.5 / 0.363)
  assert.ok(SUNG_VAD.vad_onset < 0.5 && SUNG_VAD.vad_offset < 0.363 && SUNG_VAD.vad_offset < SUNG_VAD.vad_onset);
  // what that video's first listen caught, and what a good one catches
  assert.equal(heardTooLittle({ matched: 0, total: 56 }), true);
  assert.equal(heardTooLittle({ matched: 14, total: 56 }), true);
  assert.equal(heardTooLittle({ matched: 52, total: 56 }), false);
  assert.equal(heardTooLittle({ matched: Math.ceil(56 * LISTEN_AGAIN_BELOW), total: 56 }), false);
  assert.equal(heardTooLittle({ matched: 0, total: 0 }), false, "no lyrics of ours to match: nothing to listen again for");

  const cap = read("app", "lib", "film-captions.server.ts");
  const fn = cap.slice(cap.indexOf("export async function captionLyrics"));
  assert.ok(fn.includes(`runFfmpeg(["-y", "-i", o.filmPath, "-vn", ...LISTEN_AUDIO, audio])`));
  assert.ok(!fn.includes(`"16000"`));
  // our own song is heard softly first; a merchant's own track (captioned from what is heard) is not
  assert.ok(fn.includes(`const ours = o.lyricLines.some((l) => (l || "").trim());`));
  assert.ok(fn.includes("null, { sung }), 5 * 60_000, \"lyrics\")"));
  // OUR OWN SONG IS HEARD ON ITS VOCAL ALONE FIRST (a real video, 2026-11-22: the last line — nine
  // seconds of singing over a busy outro — was not heard at all on the mix; on the separated vocal
  // every word of it was: 55 of 55 lyric words against 42)
  const vocalFirst = fn.indexOf("const stems = await separateSong(mixUrl);");
  const mixAfter = fn.indexOf("const mix = await listen(mixUrl, ours);");
  assert.ok(vocalFirst > 0 && mixAfter > vocalFirst, "the vocal alone, then the mix");
  assert.ok(fn.includes("heard = await listen(stems.vocals, true);"));
  // the mix is for somebody's own track, or the way back when the vocal gave too little
  assert.ok(fn.includes("if (!ours || heardTooLittle(r) || heard.length < 3) {"));
  assert.ok(fn.includes("if (!ours || heard.length < 3 || r1.matched > r.matched) { heard = mix; r = r1; }"));
  // …and a poor listen to the mix gets a second on the stock settings; the better is kept
  assert.ok(fn.includes("const again = await listen(mixUrl, false);") && fn.includes("if (r2.matched > r.matched) { heard = again; r = r2; }"));
  // a split that fails costs nothing: the mix is listened to instead
  assert.ok(fn.includes("the vocal could not be separated — listening to the whole mix"));
  // the softer detector is only ever asked for by name
  const fv = read("app", "lib", "faceless-video.server.ts");
  assert.ok(fv.includes(`export async function createWhisperx(audioUrl: string, language: string | null = "en", opts: { sung?: boolean } = {})`));
  assert.ok(fv.includes("batch_size: 16, ...(opts.sung ? SUNG_VAD : {}) }"));
  // the SRT that rides with a video listens to the same full-rate copy
  assert.ok(read("app", "lib", "ad-pack.server.ts").includes(`runFfmpeg(["-y", "-i", src, "-vn", ...LISTEN_AUDIO, audio])`));
});
