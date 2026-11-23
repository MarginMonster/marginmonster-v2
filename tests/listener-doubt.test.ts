/* WORDS THE LISTENER WAS NOT SURE OF ARE NOT BELIEVED — AND A PIECE KEEPS WHAT ITS TIMING WAS MADE FROM.
 *
 * 2026-11-23, the third telling of "The Keeper's Tide" in the Ghost voice. One line of it —
 * "…bolted every door, yet still they came." — was drawn wrong: YET STILL came up at 18.2 s, THEY CAME at
 * 18.55, and by 18.95 the screen was empty — while the narrator SAID "yet still they came" from 18.98 to
 * 20.40 with nothing on screen (read off the finished film at twenty frames a second). The listener had
 * fitted the four words into the pause after "door," — the swell that leads that voice in — and left the
 * line itself without a word. The same film listened to again came out right, every time.
 *
 * What gives such words away is the listener's own score for them: over 2,041 words of 19 real listens
 * (measured that day), 44 scored under 0.2 and every one stood ALONE between two words it was sure of.
 *
 * The word times below are that film's own (from a listen of it that came out right); the four squeezed
 * words are where the film showed them. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOUBT_OFF_MIDDLE, DOUBT_ROOM_S, DOUBT_RUN, DOUBT_SCORE, LISTEN_AGAIN_UNDER, MIN_SAY, SAY_PACE, TIMING_WORDS_MAX,
  boldCards, listenAgain, listenQuality, listenedWords, readTiming, sceneWindows, scriptWordTimes, sureWords, timingLine, timingRecord,
  type Card, type Span, type WordT,
} from "../app/lib/narrated-core.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

const LINES = ["He checked the tower each night, bolted every door, yet still they came.", "She knelt and touched one."];
const TOTAL = 23.6;
type Heard = [string, number, number, number];
const words = (list: Heard[]): WordT[] => list.map(([word, start, end, score]) => ({ word, start, end, score }));
const BEFORE: Heard[] = [["He", 15.22, 15.32, 0.68], ["checked", 15.36, 15.6, 0.59], ["the", 15.62, 15.72, 0.65], ["tower", 15.74, 16.1, 0.81], ["each", 16.14, 16.44, 0.61], ["night,", 16.5, 17.12, 0.79], ["bolted", 17.18, 17.58, 0.6], ["every", 17.74, 17.98, 0.77]];
const AFTER: Heard[] = [["She", 21.36, 21.5, 0.98], ["knelt", 21.54, 21.76, 0.46], ["and", 21.86, 22.04, 0.51], ["touched", 22.08, 22.4, 0.48], ["one.", 22.48, 23.28, 0.57]];
// the line as it is really said…
const SAID: Heard[] = [["yet", 18.98, 19.2, 0.76], ["still", 19.34, 19.68, 0.91], ["they", 19.72, 19.88, 0.82], ["came.", 19.94, 20.4, 0.66]];
const RIGHT = words([...BEFORE, ["door,", 18.02, 18.3, 0.9], ...SAID, ...AFTER]);
// …and as the listener had it that time: in the pause, and not sure of one of them
const FAULTY = words([...BEFORE, ["door,", 18.02, 18.2, 0.9], ["yet", 18.22, 18.38, 0.05], ["still", 18.38, 18.52, 0.03], ["they", 18.52, 18.7, 0.08], ["came.", 18.7, 18.93, 0.02], ...AFTER]);
// a voice whose pauses are quiet…
const PLAIN: Span[][] = [[[15.2, 18.25], [18.98, 20.45], [21.34, 23.3]], [[15.2, 18.6], [18.9, 20.8], [21.3, 23.5]]];
// …and the Ghost's: the swell before a line and the echo after it fill every pause
const GHOST: Span[][] = [[[15.2, 20.95], [21.3, 23.4]], [[15.2, 23.6]]];

const shownAt = (cards: Card[], t: number): string => cards.find((c) => c.t0 <= t && t < c.t1)?.text || "";
const theLine = (timed: WordT[]) => timed.slice(9, 13);

test("the fault as it was: the line is drawn in the pause, and the screen is empty while it is said", () => {
  // (the listener's words taken at their word — how it was until that day)
  const timed = scriptWordTimes(LINES, FAULTY, sceneWindows(LINES, FAULTY, TOTAL), undefined, PLAIN);
  assert.deepEqual(theLine(timed).map((w) => w.word), ["yet", "still", "they", "came."]);
  assert.ok(theLine(timed).every((w) => w.end <= 18.95), "all four before the narrator has said one of them");
  const cards = boldCards(timed, "en");
  assert.equal(shownAt(cards, 18.3), "YET STILL");
  assert.equal(shownAt(cards, 18.8), "THEY CAME");
  for (const t of [19.0, 19.5, 20.0, 20.3]) assert.equal(shownAt(cards, t), "", `nothing on screen at ${t} s, while it is spoken`);
});

test("two or more unsure words in a row are not believed — one alone is", () => {
  assert.equal(DOUBT_SCORE, 0.2);
  assert.equal(DOUBT_RUN, 2);
  const d = sureWords(FAULTY);
  assert.equal(d.doubted, 4);
  assert.deepEqual(d.squeezed, [[18.22, 18.93]], "where they had been put");
  assert.deepEqual(d.sure.map((w) => w.word), [...BEFORE.map((h) => h[0]), "door,", ...AFTER.map((h) => h[0])]);
  // a listen that came out right is left exactly as it is
  assert.deepEqual(sureWords(RIGHT), { sure: RIGHT, squeezed: [], doubted: 0 });
  // ONE unsure word between two sure ones stays (real ones, from clean takes of this story: "a" at 0.00,
  // "the" at 0.04, a name spelt another way at 0.01 — its neighbours hold it where it is)
  const alone = words([["and", 62.15, 62.21, 0.39], ["a", 62.23, 62.25, 0.0], ["cold,", 62.43, 63.17, 0.93], ["wet", 63.3, 63.6, 0.8], ["the", 45.8, 45.86, 0.04], ["prince", 46.02, 46.3, 0.42]]);
  assert.deepEqual(sureWords(alone), { sure: alone, squeezed: [], doubted: 0 });
  // 0.2 itself is sure (the lowest pair in all 2,041 words: "the" at 0.20, "footprints" at 0.24)
  const edge = words([["the", 13.32, 13.42, 0.2], ["footprints", 13.46, 13.86, 0.24]]);
  assert.equal(sureWords(edge).doubted, 0);
  // a listener that gives no scores is taken at its word
  const bare: WordT[] = [{ word: "yet", start: 1, end: 1.1 }, { word: "still", start: 1.1, end: 1.2 }, { word: "they", start: 1.2, end: 1.3 }];
  assert.deepEqual(sureWords(bare), { sure: bare, squeezed: [], doubted: 0 });
  // A RUN WITH NO ROOM TO BE ANYWHERE ELSE STAYS — like one unsure word alone. The first Spanish story
  // made with the rule live: "notita [clara y] pequeña", the two scored 0.00, squeezed into 0.14 s of the
  // 0.20 s between two sure words. Not believing them moved nothing and cost the story a second listen.
  assert.equal(DOUBT_ROOM_S, 0.5);
  const held = words([["su", 41.68, 41.76, 0.96], ["notita", 41.82, 42.5, 0.82], ["clara", 42.52, 42.62, 0.0], ["y", 42.64, 42.66, 0.0], ["pequeña,", 42.7, 43.14, 0.88], ["entrelazándose", 43.52, 44.18, 0.87]]);
  assert.deepEqual(sureWords(held), { sure: held, squeezed: [], doubted: 0 });
  assert.equal(listenAgain(listenQuality(["su notita clara y pequeña, entrelazándose"], held)), false, "and nothing is asked again");
  // the same two words BESIDE A GAP — the next sure word a second later — are not held by anything
  const loose = held.map((w, i) => (i >= 4 ? { ...w, start: w.start + 1, end: w.end + 1 } : w));
  assert.equal(sureWords(loose).doubted, 2);
  assert.deepEqual(sureWords(loose).squeezed, [[42.52, 42.66]]);
  // the line this is all for had 2.45 s of room beside it (the sure words on either side: 18.20 … 21.36)
  assert.ok(21.36 - 18.2 - (18.93 - 18.22) > 2.4);
  // a run that is the LAST thing heard has nothing after it to hold it
  const tail = words([...BEFORE, ["door,", 18.02, 18.2, 0.9], ["yet", 18.22, 18.38, 0.05], ["still", 18.38, 18.52, 0.03]]);
  assert.equal(sureWords(tail).doubted, 2);
  // two runs: each has its own stretch
  const sureOnes = (n: number, from: number): Heard[] => Array.from({ length: n }, (_, i): Heard => ["s", from + i, from + i + 0.5, 0.9]);
  // (in the order they were heard, each run with seconds of room beside it)
  const two = words([...sureOnes(20, 0), ["a", 30, 30.1, 0.01], ["b", 30.1, 30.2, 0.02], ["c", 31, 31.5, 0.9], ["d", 33, 33.1, 0.1], ["e", 33.1, 33.2, 0.1], ["f", 33.2, 33.3, 0.1], ...sureOnes(20, 40)]);
  assert.deepEqual(sureWords(two).squeezed, [[30, 30.2], [33, 33.3]]);
  assert.equal(sureWords(two).doubted, 5);
  assert.equal(sureWords(two).sure.length, 41);
  assert.deepEqual(sureWords([]), { sure: [], squeezed: [], doubted: 0 });
  // A LISTENER UNSURE OF MOST OF WHAT IT HEARD TELLS NOTHING APART (a voice it can barely follow): when
  // the middle score of the whole listen is low, every word is taken at its word, as it always was
  assert.equal(DOUBT_OFF_MIDDLE, 0.4);
  const murky = words([["a", 1, 1.1, 0.01], ["b", 1.1, 1.2, 0.02], ["c", 2, 2.5, 0.9], ["d", 3, 3.1, 0.1], ["e", 3.1, 3.2, 0.1], ["f", 3.2, 3.3, 0.1]]);
  assert.deepEqual(sureWords(murky), { sure: murky, squeezed: [], doubted: 0 });
  // …which a SHORT piece with one squeezed line is not: four words of these eighteen, and still doubted
  assert.ok(4 / FAULTY.length > 0.2);
  assert.equal(sureWords(FAULTY).doubted, 4);
  // the real middles (measured): the Ghost 0.69–0.73, Spanish 0.77, French 0.76, German 0.82, Chinese 0.95
  for (const middle of [0.69, 0.73, 0.77, 0.76, 0.82, 0.95, 0.57]) assert.ok(middle > DOUBT_OFF_MIDDLE + 0.15);
});

test("the line is drawn while it is said — in a voice whose pauses are quiet", () => {
  const d = sureWords(FAULTY);
  const windows = sceneWindows(LINES, d.sure, TOTAL);
  assert.ok(Math.abs(windows[1].t0 - 21.36) < 1e-9, "the picture still changes on SHE");
  const timed = scriptWordTimes(LINES, d.sure, windows, undefined, PLAIN, d.squeezed);
  const line = theLine(timed);
  // over the sound of the line itself — 18.98 to 20.45 — each word within a fifth of a second of where it is said
  assert.ok(line[0].start >= 18.98 - 1e-9 && line[3].end <= 20.45 + 1e-9);
  line.forEach((w, k) => assert.ok(Math.abs(w.start - SAID[k][1]) < 0.2, `${w.word} at ${w.start.toFixed(2)}, said at ${SAID[k][1]}`));
  const cards = boldCards(timed, "en");
  assert.equal(shownAt(cards, 18.6), "", "the pause is a pause");
  assert.equal(shownAt(cards, 19.1), "YET STILL");
  assert.equal(shownAt(cards, 20.2), "THEY CAME");
  // every other word is where it was
  const asHeard = scriptWordTimes(LINES, RIGHT, sceneWindows(LINES, RIGHT, TOTAL), undefined, PLAIN);
  [0, 1, 2, 3, 4, 5, 6, 7, 13, 14, 15, 16, 17].forEach((i) => assert.ok(Math.abs(timed[i].start - asHeard[i].start) < 1e-9, timed[i].word));
});

test("…and in the Ghost's, whose swell and echo fill the pause: anywhere but where they were squeezed", () => {
  const d = sureWords(FAULTY);
  const timed = scriptWordTimes(LINES, d.sure, sceneWindows(LINES, d.sure, TOTAL), undefined, GHOST, d.squeezed);
  const line = theLine(timed);
  // the track cannot tell the pause from the line here — but the squeeze itself says where the line is NOT
  assert.ok(line[0].start >= 18.93 - 1e-9, `it starts after the squeeze (${line[0].start.toFixed(2)})`);
  assert.ok(line[3].end <= 20.95 + 1e-9);
  assert.ok(Math.abs(line[0].start - 18.98) < 0.1, "…which is when it is said");
  const cards = boldCards(timed, "en");
  assert.equal(shownAt(cards, 19.1), "YET STILL");
  assert.equal(shownAt(cards, 20.2), "THEY CAME");
  // without the squeeze to go by, the same words would be spread from "door," on — through the pause
  const blind = theLine(scriptWordTimes(LINES, d.sure, sceneWindows(LINES, d.sure, TOTAL), undefined, GHOST));
  assert.ok(blind[0].start < 18.3);
  // a squeeze that leaves no room elsewhere changes nothing: the words go over the sound there is
  const tight: Span[][] = [[[15.2, 18.95], [21.3, 23.4]], [[15.2, 18.95], [21.3, 23.6]]];
  const kept = theLine(scriptWordTimes(LINES, d.sure, sceneWindows(LINES, d.sure, TOTAL), undefined, tight, d.squeezed));
  assert.ok(kept[0].start >= 18.2 - 1e-9 && kept[3].end <= 18.95 + 1e-9);
});

test("…and when the voice track could not be read: on from the squeeze, at a speaking pace", () => {
  const d = sureWords(FAULTY);
  const windows = sceneWindows(LINES, d.sure, TOTAL);
  for (const speech of [undefined, [] as Span[][]]) {
    const line = theLine(scriptWordTimes(LINES, d.sure, windows, undefined, speech, d.squeezed));
    assert.ok(Math.abs(line[0].start - 18.93) < 1e-9, "past the squeeze");
    assert.ok(Math.abs(line[3].end - (18.93 + 4 * SAY_PACE)) < 1e-9);
    line.forEach((w, k) => assert.ok(Math.abs(w.start - SAID[k][1]) < 0.3, `${w.word} at ${w.start.toFixed(2)}, said at ${SAID[k][1]}`));
  }
  // nothing to step past: on from the last sure word, as ever
  const plainRule = theLine(scriptWordTimes(LINES, d.sure, windows));
  assert.ok(Math.abs(plainRule[0].start - 18.2) < 1e-9);
  // a squeeze somewhere else in the film is not stepped past
  const far = theLine(scriptWordTimes(LINES, d.sure, windows, undefined, undefined, [[2, 2.6]]));
  assert.ok(Math.abs(far[0].start - 18.2) < 1e-9);
});

test("a stray sound heard beside the last sure word does not have a line squeezed into it", () => {
  // after the last word the listener was sure of it heard one more short thing, and none of the three
  // words still to come: they used to be laid up to the END OF THAT SOUND — three words in 0.15 s
  const line = ["She heard it breathe: welcome home, daughter."];
  const heard: WordT[] = [{ word: "She", start: 1, end: 1.2 }, { word: "heard", start: 1.25, end: 1.6 }, { word: "it", start: 1.65, end: 1.75 }, { word: "breathe", start: 1.8, end: 2.4 }, { word: "Oh", start: 2.45, end: 2.55 }];
  const win = [{ t0: 0, t1: 9 }];
  const t = scriptWordTimes(line, heard, win);
  assert.ok(Math.abs(t[4].start - 2.4) < 1e-9);
  assert.ok(Math.abs(t[6].end - (2.4 + 3 * SAY_PACE)) < 1e-9, "at a speaking pace instead");
  assert.ok(t.slice(4).every((w) => w.end - w.start >= MIN_SAY));
  // when what it went on hearing IS long enough for the words, that is where they are (a number read out)
  const year = scriptWordTimes(["It was 1981."], [{ word: "It", start: 1, end: 1.2 }, { word: "was", start: 1.25, end: 1.5 }, { word: "nineteen", start: 1.6, end: 2.1 }, { word: "eighty", start: 2.15, end: 2.5 }, { word: "one", start: 2.55, end: 2.9 }], win);
  assert.ok(Math.abs(year[2].start - 1.5) < 1e-9 && Math.abs(year[2].end - 2.9) < 1e-9);
  // the same before the first sure word: a stray sound just ahead of it is not where three words were said
  const lead = scriptWordTimes(["Welcome home, daughter, she said."], [{ word: "Uh", start: 4.9, end: 5.0 }, { word: "she", start: 5.05, end: 5.25 }, { word: "said.", start: 5.3, end: 5.8 }], win);
  assert.ok(Math.abs(lead[0].start - (5.05 - 3 * SAY_PACE)) < 1e-9);
  assert.ok(Math.abs(lead[2].end - 5.05) < 1e-9);
  // …and when it started hearing something else long enough before, the words run from there
  const lead2 = scriptWordTimes(["Welcome home, daughter, she said."], [{ word: "Well", start: 3.0, end: 3.4 }, { word: "come", start: 3.5, end: 3.9 }, { word: "she", start: 5.05, end: 5.25 }, { word: "said.", start: 5.3, end: 5.8 }], win);
  assert.ok(Math.abs(lead2[0].start - 3.0) < 1e-9);
});

test("a listen that was not sure of its words is worth another — and the surer listen is the one kept", () => {
  assert.deepEqual(listenQuality(LINES, RIGHT), { share: 1, doubted: 0 });
  assert.equal(listenAgain(listenQuality(LINES, RIGHT)), false);
  const faulty = listenQuality(LINES, FAULTY);
  assert.equal(faulty.doubted, 4);
  assert.ok(Math.abs(faulty.share - 14 / 18) < 1e-9, "words it was not sure of are not words it heard");
  assert.equal(listenAgain(faulty), true);
  // in a long story four such words are too few to pull the share under the line — they are asked about on their own
  assert.ok(196 / 200 >= LISTEN_AGAIN_UNDER);
  assert.equal(listenAgain({ share: 196 / 200, doubted: 4 }), true);
  assert.equal(listenAgain({ share: 196 / 200, doubted: 0 }), false);
  assert.equal(listenAgain({ share: 0.9, doubted: 0 }), true, "a listen that missed words, as before");
  // the second listen replaces the first only when it is sure of MORE of the story
  assert.ok(listenQuality(LINES, RIGHT).share > faulty.share);
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("const first = listenQuality(lines, words);\n      if (listenAgain(first)) {\n        firstShare = first.share;"));
  assert.ok(nar.includes("const second = listenQuality(lines, again);"));
  assert.ok(nar.includes("if (second.share > first.share) { words = again; keptSoft = true; }"));
  const fl = read("app", "lib", "faceless-video.server.ts");
  assert.ok(fl.includes("if (listenQuality(lines, again).share > first.share) { words = again; keptSoft = true; }"));
});

test("the listener's answer is read with its scores", () => {
  const raw = { segments: [{ words: [{ word: "door,", start: 18.02, end: 18.2, score: 0.9 }, { word: "yet", start: 18.22, end: 18.38, score: 0.05 }, { word: "1981" }, { word: "x", start: 3, end: 3 }, { word: "plain", start: 4, end: 4.5 }] }, { words: [{ word: "She", start: 21.36, end: 21.5, score: 0.98 }] }, {}] };
  assert.deepEqual(listenedWords(raw), [
    { word: "door,", start: 18.02, end: 18.2, score: 0.9 },
    { word: "yet", start: 18.22, end: 18.38, score: 0.05 },
    { word: "plain", start: 4, end: 4.5 },
    { word: "She", start: 21.36, end: 21.5, score: 0.98 },
  ]);
  assert.deepEqual(listenedWords(null), []);
  assert.deepEqual(listenedWords({ segments: "no" as unknown as [] }).length, 0);
});

test("a piece keeps what its timing was made from — enough to work it out again, word for word", () => {
  const d = sureWords(FAULTY);
  const windows = sceneWindows(LINES, d.sure, TOTAL);
  const timed = scriptWordTimes(LINES, d.sure, windows, undefined, PLAIN, d.squeezed);
  const rec = timingRecord({ lines: LINES, listened: FAULTY, speech: PLAIN, seconds: TOTAL, timed, plain: scriptWordTimes(LINES, d.sure, windows), first: 14 / 18, soft: false });
  assert.equal(rec.v, 1);
  assert.equal(rec.heard.length, FAULTY.length, "the words that were not believed are in it too — they are what went wrong");
  assert.deepEqual(rec.heard[9], ["yet", 18.22, 18.38, 0.05]);
  assert.deepEqual(rec.clear, [15.2, 18.25, 18.98, 20.45, 21.34, 23.3]);
  assert.equal(rec.doubted, 4);
  assert.equal(rec.placed, 4, "the four words the voice track placed");
  // …through the piece's meta and back
  const back = readTiming(JSON.parse(JSON.stringify(rec)));
  assert.ok(back);
  assert.deepEqual(back!.lines, LINES);
  assert.deepEqual(back!.speech, PLAIN);
  assert.equal(back!.seconds, TOTAL);
  const d2 = sureWords(back!.listened);
  const again = scriptWordTimes(back!.lines, d2.sure, sceneWindows(back!.lines, d2.sure, back!.seconds), undefined, back!.speech, d2.squeezed);
  assert.deepEqual(again, timed, "the same timing, from the record alone");
  // one line of it, for the operator
  assert.equal(timingLine(rec), "timing: heard 18 words for 18 written (78% sure) — softer second listen no better, the first had 78% · voice track read: 3 clear / 3 any · 4 not believed · 4 placed by the track");
  const soft = timingRecord({ lines: LINES, listened: RIGHT, speech: PLAIN, seconds: TOTAL, first: 14 / 18, soft: true });
  assert.equal(timingLine(soft), "timing: heard 18 words for 18 written (100% sure) — softer second listen kept, the first had 78% · voice track read: 3 clear / 3 any · 0 not believed · 0 placed by the track");
  // a track that could not be read says so, and why
  const unread = timingRecord({ lines: LINES, listened: RIGHT, speech: [], seconds: TOTAL, unread: "ffmpeg 1: Error parsing a filter description" });
  assert.deepEqual([unread.clear, unread.any], [[], []]);
  assert.equal(timingLine(unread), "timing: heard 18 words for 18 written (100% sure) · voice track NOT read (ffmpeg 1: Error parsing a filter description) · 0 not believed · 0 placed by the track");
  assert.deepEqual(readTiming(JSON.parse(JSON.stringify(unread)))!.speech, []);
  // a listener that gave no score: kept as "did not say", read back as no score
  const bare = timingRecord({ lines: ["Hello there."], listened: [{ word: "Hello", start: 0.5, end: 0.9 }, { word: "there.", start: 1, end: 1.4 }], speech: [], seconds: 2 });
  assert.deepEqual(bare.heard, [["Hello", 0.5, 0.9, -1], ["there.", 1, 1.4, -1]]);
  assert.deepEqual(readTiming(bare)!.listened, [{ word: "Hello", start: 0.5, end: 0.9 }, { word: "there.", start: 1, end: 1.4 }]);
  // it stays small: a story is a few thousand characters, and nothing grows without end
  assert.ok(JSON.stringify(rec).length < 1500);
  const long: WordT[] = Array.from({ length: TIMING_WORDS_MAX + 50 }, (_, i) => ({ word: "w", start: i, end: i + 0.5, score: 0.9 }));
  assert.equal(timingRecord({ lines: ["w"], listened: long, speech: [], seconds: 2000 }).heard.length, TIMING_WORDS_MAX);
  // what is not a record is not read as one
  for (const junk of [null, undefined, "x", 3, {}, { v: 2, lines: [], heard: [] }, { v: 1, lines: "no", heard: [] }]) {
    assert.equal(readTiming(junk), null);
    assert.equal(timingLine(junk), null);
  }
});

test("both narrated pipelines do it, the record stays with the piece, and only the operator is shown it", () => {
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("const listened = words;\n  const doubt = sureWords(listened);\n  words = doubt.sure;\n  const windows = sceneWindows(lines, words, voDur);"), "the pictures are timed by the sure words too");
  assert.ok(nar.includes("const timing = timingRecord({ lines, listened, speech, seconds: voDur, timed, plain: scriptWordTimes(lines, words, windows), first: firstShare, soft: keptSoft, unread: sound.unread });"));
  assert.ok(nar.includes("        // what its timing was made from — for the operator alone (web.archive's loader)\n        timing,\n"), "in the piece's own meta");
  // (what is checkpointed is what was LISTENED — a job that starts again takes the same words out again)
  assert.ok(nar.includes("await ckpt({ ckWords: JSON.stringify(words) });\n  }"));
  assert.ok(nar.indexOf("await ckpt({ ckWords: JSON.stringify(words) });") < nar.indexOf("const doubt = sureWords(listened);"));
  const fl = read("app", "lib", "faceless-video.server.ts");
  assert.ok(fl.includes("const listened = words;\n    const doubt = sureWords(listened);\n    words = doubt.sure;"));
  assert.ok(fl.includes("timing = timingRecord({ lines, listened, speech, seconds: voSeconds, timed, plain: scriptWordTimes(lines, words, beatWindows), first: firstShare, soft: keptSoft, unread: sound.unread });"));
  assert.ok(fl.includes("else { caps = saved.caps || []; beatWindows = saved.windows || null; timing = saved.timing || null; }"), "a job that starts again keeps its record");
  assert.ok(fl.includes("...(timing ? { timing } : {}) }),"));
  // why a track was not read comes back with the reading
  const vs = read("app", "lib", "voice-sound.server.ts");
  assert.ok(vs.includes("export async function readVoiceSound(voPath: string, total: number): Promise<{ speech: Span[][]; unread?: string }> {"));
  assert.ok(vs.includes("return speech.length ? { speech } : { speech, unread: "));
  // the operator, and nobody else — one line on each piece, the whole record when asked for by its id
  const arch = read("app", "routes", "web.archive.tsx");
  assert.ok(arch.includes("opsTiming: operator ? (() => { try { return timingLine(JSON.parse(a.metaJson || \"{}\").timing) || undefined; } catch { return undefined; } })() : undefined,"));
  assert.ok(arch.includes("if (timingOf && operator) {"));
  assert.ok(arch.includes("where: { id: timingOf.slice(0, 64), shopId: shop.id }"), "of the operator's own shop");
  assert.ok(arch.includes("return json({ timingOf: piece?.id || null, title: piece?.title || null, timing }) as never;"));
  assert.ok(!arch.includes("a.opsTiming") && !arch.includes("viewer.opsTiming"), "never drawn");
  // an acted film's lines are timed the way they were (a snarl, a whisper: its own rule)
  const fc = read("app", "lib", "film-captions.server.ts");
  assert.ok(!fc.includes("sureWords("));
});
