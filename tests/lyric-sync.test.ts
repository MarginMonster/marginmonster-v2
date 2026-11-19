/* Lyrics on screen: the lyric lines, in their own spelling, timed by the words heard in the song. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { lyricWordTimes, lyricLinesOf } from "../app/lib/lyric-sync.ts";

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

import fs from "node:fs";
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
  assert.ok(cap.includes("createWhisperx(`${base}/renders/${path.basename(audio)}`, null)"), "the song's language is heard, not assumed");
});
