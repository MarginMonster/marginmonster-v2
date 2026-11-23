/* A WORD NOBODY HEARD IS DRAWN WHEN IT IS SPOKEN — NOT IN THE PAUSE BEFORE IT.
 *
 * 2026-11-23, a new Horror Story told in the Ghost voice ("The Keeper's Tide"). Its last line is
 * "…and a cold, wet mouth breathed against her ear: welcome home, daughter." — and the narrator stops
 * after "ear", waits, and whispers the last three words. The listener does not hear the whisper. The
 * captions laid unheard words straight on from the last heard one, so WELCOME HOME came up in the pause,
 * 1.7 seconds before it was said, and was gone before the whisper came: the ending, given away.
 *
 * The voice track itself says where those words are — it is sounding there and quiet in the pause. The
 * numbers below are from a real take of that line in that voice, made with the app's own recipe and
 * measured with ffmpeg (clean, before any music): spoken 1.15–5.20, 5.70–13.95, 14.65–17.40. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ANY_SOUND_DB, CLEAR_VOICE_DB, MIN_SAY, PAUSE_MIN_S, boldCards, layOver, levelFrames, sceneWindows, scriptWordTimes, soundLevels, soundSpans, type Span, type WordT } from "../app/lib/narrated-core.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

// ---- the track, as measured ---------------------------------------------------------------------------------
// one frame every 50 ms: the voice, the echo dying away after each phrase (this voice speaks "from another
// room"), the whispered last phrase, digital silence before it all starts
const TOTAL = 18.2;
function ghostTake(): Array<{ t: number; db: number }> {
  const frames: Array<{ t: number; db: number }> = [];
  for (let i = 0; i * 0.05 < TOTAL; i++) {
    const t = Math.round(i * 5) / 100;
    let db: number;
    if (t < 1.1) db = -Infinity;
    else if (t < 1.15) db = -40;
    else if (t < 5.2) db = i % 7 === 3 ? -22 : -14;            // a sentence, with the dips between its words
    else if (t < 5.7) db = -31 - (t - 5.2) * 18;               // its echo: -31 falling to -40
    else if (t < 13.95) db = i % 9 === 4 ? -27 : -13;          // the long sentence ("…her ear:")
    else if (t < 14.65) db = -34 - (t - 13.95) * 12;           // the pause: echo falling away (never 30 dB down)
    else if (t < 17.4) db = i % 5 === 2 ? -25 : -19;           // the whisper: "welcome home, daughter"
    else db = -31 - (t - 17.4) * 30;                           // and its echo to the end
    frames.push({ t, db });
  }
  return frames;
}
const near = (a: number, b: number, tol = 0.11) => Math.abs(a - b) <= tol;

test("the print-out of a track's level is read frame by frame", () => {
  const printout = [
    "frame:0    pts:0       pts_time:0",
    "lavfi.astats.Overall.RMS_level=-inf",
    "frame:1    pts:800     pts_time:0.05",
    "lavfi.astats.Overall.RMS_level=-23.250000",
    "frame:2    pts:1600    pts_time:0.1",
    "lavfi.astats.Overall.RMS_level=-9.5",
    "something else entirely",
    "lavfi.astats.Overall.RMS_level=-12.0",   // a level with no frame before it is nobody's
  ].join("\r\n");
  assert.deepEqual(levelFrames(printout), [{ t: 0, db: -Infinity }, { t: 0.05, db: -23.25 }, { t: 0.1, db: -9.5 }]);
  assert.deepEqual(levelFrames(""), []);
});

test("the clear voice is found phrase by phrase — the echo between phrases is not it", () => {
  const frames = ghostTake();
  const clear = soundSpans(frames, TOTAL, CLEAR_VOICE_DB);
  assert.equal(clear.length, 3, JSON.stringify(clear));
  assert.ok(near(clear[0][0], 1.15) && near(clear[0][1], 5.2), `first sentence: ${clear[0]}`);
  assert.ok(near(clear[1][0], 5.7) && near(clear[1][1], 13.95), `second: ${clear[1]}`);
  assert.ok(near(clear[2][0], 14.65) && near(clear[2][1], 17.4), `the whisper is the clear voice too: ${clear[2]}`);
  // the dips between words (one frame in seven) do not split a sentence: shorter than a pause
  assert.ok(PAUSE_MIN_S >= 0.25);
  // at the looser reading the echo joins everything up — which is why it is only the second resort
  const any = soundSpans(frames, TOTAL, ANY_SOUND_DB);
  assert.equal(any.length, 1);
  assert.ok(near(any[0][0], 1.15) && any[0][1] > 17.4);
  assert.deepEqual(soundLevels(frames, TOTAL), [clear, any]);
  // a track that is all silence, or no track: nothing — and the timing falls back to the older rule
  assert.deepEqual(soundLevels(frames.map((f) => ({ t: f.t, db: -Infinity })), TOTAL), []);
  assert.deepEqual(soundLevels([], TOTAL), []);
  assert.deepEqual(soundSpans(frames, 0, CLEAR_VOICE_DB), []);
  assert.ok(CLEAR_VOICE_DB < ANY_SOUND_DB);
});

test("unheard words are shared out over the stretches of sound in WHOLE words — none drawn across a pause", () => {
  // "ear" still sounding against the heard word before it, then the pause, then the whisper
  const pieces: Span[] = [[61.22, 61.76], [63.2, 65.2]];
  const four = layOver(pieces, 4);
  assert.equal(four.length, 4);
  assert.ok(four[0].s === 61.22 && Math.abs(four[0].e - 61.76) < 1e-9, "one word in the first stretch");
  assert.ok(four[1].s === 63.2 && Math.abs(four[3].e - 65.2) < 1e-9, "three in the second");
  for (const w of four) assert.ok(!(w.s < 63.2 - 1e-9 && w.e > 61.76 + 1e-9), "no word spans the silence");
  // in order, end to end inside a stretch
  for (let i = 1; i < four.length; i++) assert.ok(four[i].s >= four[i - 1].e - 1e-9);
  assert.deepEqual(layOver([[2, 4]], 2), [{ s: 2, e: 3 }, { s: 3, e: 4 }]);
  assert.deepEqual(layOver([], 3), []);
  assert.deepEqual(layOver([[1, 2]], 0), []);
  // more stretches than words: the longest stretches get them
  const two = layOver([[0, 0.2], [1, 3], [4, 4.3], [5, 8]], 2);
  assert.deepEqual(two.map((w) => w.s), [1, 5]);
});

// ---- the line, as it was heard --------------------------------------------------------------------------------
const LINE = "The footprints stopped beside her pillow. The mattress sank under a weight she couldn't see — and a cold, wet mouth breathed against her ear: welcome home, daughter.";
const HEARD_ALL: WordT[] = [
  ["The", 1.13, 1.33], ["footprints", 1.37, 2.0], ["stopped", 2.08, 2.8], ["beside", 2.9, 3.4], ["her", 3.46, 3.7], ["pillow.", 4.46, 5.0],
  ["The", 5.72, 5.86], ["mattress", 5.9, 6.4], ["sank", 6.48, 6.8], ["under", 6.86, 7.08], ["a", 7.12, 7.2], ["weight", 7.24, 7.6], ["she", 7.66, 7.84], ["couldn't", 7.88, 8.2], ["see,", 8.28, 8.7],
  ["and", 9.52, 9.66], ["a", 9.7, 9.8], ["cold,", 9.98, 10.5], ["wet", 10.96, 11.2], ["mouth", 11.29, 11.8], ["breathed", 11.95, 12.38], ["against", 12.43, 12.75], ["her", 12.81, 12.97], ["ear.", 13.11, 14.05],
  ["Welcome", 14.69, 15.29], ["home,", 15.39, 16.37], ["daughter.", 16.49, 16.91],
].map(([word, start, end]) => ({ word: String(word), start: Number(start), end: Number(end) }));
const withoutWhisper = HEARD_ALL.slice(0, -3);
const at = (timed: WordT[], word: string) => timed.find((w) => w.word.toLowerCase().startsWith(word))!;

test("the whispered ending is captioned when it is whispered — and nothing is on screen in the pause", () => {
  const speech = soundLevels(ghostTake(), TOTAL);
  const windows = sceneWindows([LINE], withoutWhisper, TOTAL);
  // BEFORE: straight on from the last heard word, in the pause
  const before = scriptWordTimes([LINE], withoutWhisper, windows);
  assert.ok(at(before, "welcome").start < 14.2, `it used to start in the pause: ${at(before, "welcome").start}`);
  assert.ok(at(before, "daughter").end < 15.5, "and to be gone before the whisper was half said");
  // AFTER: over the sound that is there
  const after = scriptWordTimes([LINE], withoutWhisper, windows, undefined, speech);
  const [w, h, d] = [at(after, "welcome"), at(after, "home"), at(after, "daughter")];
  assert.ok(near(w.start, 14.65), `welcome starts with the whisper: ${w.start} (heard, when it is heard: 14.69)`);
  assert.ok(near(h.start, 15.57, 0.25), `home: ${h.start} (heard: 15.39)`);
  assert.ok(near(d.start, 16.48, 0.25), `daughter: ${d.start} (heard: 16.49)`);
  assert.ok(near(d.end, 17.4), "to the end of the whisper");
  // the cards: the heard words' card ends with "ear", the next one does not begin until the whisper does
  const cards = boldCards(after, "en");
  const ear = cards.find((c) => /EAR/.test(c.text))!, welcome = cards.find((c) => /WELCOME/.test(c.text))!;
  assert.ok(welcome.t0 >= 14.6, `WELCOME is not drawn in the pause: ${welcome.t0}`);
  // (a pause this short keeps the card before it up — a card is held across up to a breath, as always —
  //  but never the NEXT card early)
  assert.ok(ear.t1 <= welcome.t0 + 1e-9, `the card with EAR ends by the time WELCOME begins: ${ear.t1}`);
  // every word that WAS heard is exactly where it was heard — only the unheard ones moved
  for (const hw of withoutWhisper.slice(0, -1)) {
    const a = before.find((x) => x.start === hw.start), b = after.find((x) => x.start === hw.start);
    assert.ok(a && b, `${hw.word}@${hw.start} is where it was heard, with or without the track`);
  }
  assert.equal(before.length, after.length);
});

test("a missed OPENING sentence is laid over the opening sentence's own sound", () => {
  // the Keeper narrator's case: the listener's first word is the second sentence's
  const speech = soundLevels(ghostTake(), TOTAL);
  const missedOpening = HEARD_ALL.slice(6);
  const windows = sceneWindows([LINE], missedOpening, TOTAL);
  const timed = scriptWordTimes([LINE], missedOpening, windows, undefined, speech);
  const first = timed[0], pillow = at(timed, "pillow");
  assert.ok(near(first.start, 1.15), `the first word is drawn when the voice starts: ${first.start}`);
  assert.ok(pillow.end <= 5.25, `the sentence ends where its sound ends, before the pause: ${pillow.end}`);
  assert.ok(near(at(timed, "mattress").start, 5.9, 0.02), "and the heard sentence is where it was heard");
});

test("when the track cannot say — no reading, or too little sound for the words — the older rule stands", () => {
  const windows = sceneWindows([LINE], withoutWhisper, TOTAL);
  const old = scriptWordTimes([LINE], withoutWhisper, windows);
  // no reading at all
  assert.deepEqual(scriptWordTimes([LINE], withoutWhisper, windows, undefined, []), old);
  assert.deepEqual(scriptWordTimes([LINE], withoutWhisper, windows, undefined, undefined), old);
  // a reading with nothing after the last heard word but a sliver: three words do not fit in 0.3 s
  const sliver: Span[][] = [[[1.15, 14.05], [16.0, 16.3]]];
  assert.ok(0.3 < 3 * MIN_SAY);
  assert.deepEqual(scriptWordTimes([LINE], withoutWhisper, windows, undefined, sliver), old);
  // the clear voice cannot hold them but the looser reading can: the looser one is used
  const second: Span[][] = [[[1.15, 14.05], [16.0, 16.3]], [[1.15, 14.05], [14.65, 17.4]]];
  const timed = scriptWordTimes([LINE], withoutWhisper, windows, undefined, second);
  assert.ok(near(at(timed, "welcome").start, 14.65));
  // everything heard: the track changes nothing
  const all = sceneWindows([LINE], HEARD_ALL, TOTAL);
  assert.deepEqual(scriptWordTimes([LINE], HEARD_ALL, all, undefined, soundLevels(ghostTake(), TOTAL)), scriptWordTimes([LINE], HEARD_ALL, all));
});

test("the story and the faceless video read their own voice track — and a track that cannot be read costs nothing", () => {
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("const speech = words.length ? await voiceSound(voPath, voDur) : [];\n  const timed = scriptWordTimes(lines, words, windows, undefined, speech);"));
  const fl = read("app", "lib", "faceless-video.server.ts");
  assert.ok(fl.includes("const speech = words.length ? await voiceSound(voPath, voSeconds) : [];\n    caps = boldCards(scriptWordTimes(lines, words, beatWindows, undefined, speech), lang);"));
  const vs = read("app", "lib", "voice-sound.server.ts");
  // the narrator alone, 50 ms frames, printed to a FILE (the runner keeps ffmpeg's messages, not its output)
  assert.ok(vs.includes("aresample=16000,asetnsamples=n=800,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file='${name}'"));
  assert.ok(vs.includes('const name = file.replace(/\\\\/g, "/").replace(/:/g, "\\\\:");'), "a path is not filter syntax: slashes forward, the colon escaped, the name quoted");
  assert.ok(vs.includes("return soundLevels(levelFrames(fs.readFileSync(out, \"utf8\")), total);"));
  assert.ok(vs.includes("if (r.status !== 0 || !fs.existsSync(out)) return [];"));
  assert.ok(vs.includes("try { fs.rmSync(out, { force: true }); } catch { /* nothing written */ }"), "the print-out is not left behind");
  assert.equal(vs.split("return [];").length - 1, 3, "not read = an empty answer, never a failed render");
});
