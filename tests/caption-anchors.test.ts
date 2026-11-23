/* THE SCRIPT, LAID OVER WHAT WAS HEARD — by the words that are the same, not by counting.
 *
 * 2026-11-23: a horror story told in a performed character voice. The listener missed the narrator's
 * whole first sentence — ten words of 147. Words were matched to the script by COUNT, so those ten
 * missing words moved everything after them: every caption came up late (1.9 s on average, 4.2 s at
 * worst — "THEY SAY" appeared as the voice said "Gus"), and every picture changed late too.
 *
 * A written word now takes the time of the heard word that IS that word; what lies between two such
 * anchors is laid between them. Measured on that story: 0.03 s on average. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { LISTEN_AGAIN_UNDER, SAY_PACE, boldCards, heardShare, sceneWindows, scriptWordTimes, type WordT } from "../app/lib/narrated-core.ts";

/** Words as a listener gives them: `text` split at spaces, `per` seconds apart, starting at `t0`. */
const said = (text: string, t0: number, per = 0.3): WordT[] => text.split(" ").map((word, i) => ({ word, start: t0 + i * per, end: t0 + i * per + per * 0.8 }));
const startOf = (timed: WordT[], word: string, nth = 0): number => timed.filter((w) => w.word.replace(/[.,]/g, "") === word)[nth].start;

const STORY = [
  "They say the old theatre never fully empties after midnight. Gus and Isla had cleaned it for years.",
  "A light flickered in the royal box. Isla felt a cold draft where no window existed.",
  "Gus forced the door that had not opened in fifty years.",
];

test("a sentence the listener missed moves nothing after it", () => {
  // the first sentence is not heard at all; the rest is heard word for word
  const heard = [
    ...said("Gus and Isla had cleaned it for years.", 5.2),
    ...said("A light flickered in the royal box. Isla felt a cold draft where no window existed.", 9.0),
    ...said("Gus forced the door that had not opened in fifty years.", 15.0),
  ];
  const total = 19;
  const win = sceneWindows(STORY, heard, total);
  assert.ok(Math.abs(win[1].t0 - 9.0) < 1e-6, `scene 2 opens on its own first word: ${win[1].t0}`);
  assert.ok(Math.abs(win[2].t0 - 15.0) < 1e-6, `scene 3 too: ${win[2].t0}`);
  const timed = scriptWordTimes(STORY, heard, win);
  // every word that was heard is said exactly when it was heard
  assert.ok(Math.abs(startOf(timed, "Gus") - 5.2) < 1e-6, "the first heard word");
  assert.ok(Math.abs(startOf(timed, "years") - (5.2 + 7 * 0.3)) < 1e-6);
  assert.ok(Math.abs(startOf(timed, "light") - 9.3) < 1e-6);
  assert.ok(Math.abs(startOf(timed, "Gus", 1) - 15.0) < 1e-6, "and the second Gus is the second Gus");
  // the unheard sentence runs UP TO the first heard word at an ordinary pace — it is not squeezed onto it
  const they = startOf(timed, "They"), midnight = timed.find((w) => w.word === "midnight.")!;
  assert.ok(Math.abs(they - (5.2 - 10 * SAY_PACE)) < 1e-6, `"They" at ${they}`);
  assert.ok(midnight.end <= 5.2 + 1e-6 && midnight.start > they);
  for (let i = 1; i < timed.length; i++) assert.ok(timed[i].start >= timed[i - 1].start - 1e-9, "in order");
  // the cards: "THEY SAY" is up long before the voice reaches "Gus"
  const cards = boldCards(timed, "en");
  assert.ok(cards[0].text === "THEY SAY" && cards[0].t0 < 1.5, `${cards[0].text} at ${cards[0].t0}`);
  assert.ok(cards.find((c) => c.text.startsWith("GUS"))!.t0 >= 5.2 - 1e-6);
});

test("counting alone would have been seconds late — this is the case it was built for", () => {
  // the same listen, the old way: scene 2 is said to start where 10 missing words push it
  const heard = [...said("Gus and Isla had cleaned it for years.", 5.2), ...said("A light flickered in the royal box. Isla felt a cold draft where no window existed.", 9.0), ...said("Gus forced the door that had not opened in fifty years.", 15.0)];
  const frac = STORY[0].split(" ").length / STORY.join(" ").split(" ").length;
  const byCount = heard[Math.round(frac * heard.length)].start;
  assert.ok(byCount - 9.0 > 1.5, `by count scene 2 opened ${(byCount - 9.0).toFixed(1)} s late`);
  assert.ok(Math.abs(sceneWindows(STORY, heard, 19)[1].t0 - 9.0) < 1e-6);
});

test("a name heard wrong and a number read out sit between the words either side of them", () => {
  const lines = ["In 1981 a boy named Tobias knocked anyway."];
  // "1981" is heard as three words, "Tobias" as "Tobius"
  const heard = said("In nineteen eighty one a boy named Tobius knocked anyway.", 1.0);
  const timed = scriptWordTimes(lines, heard, [{ t0: 0, t1: 6 }]);
  assert.deepEqual(timed.map((w) => w.word), ["In", "1981", "a", "boy", "named", "Tobias", "knocked", "anyway."], "the caption says what was WRITTEN");
  const at = (w: string) => timed.find((x) => x.word === w)!;
  assert.ok(Math.abs(at("In").start - 1.0) < 1e-6);
  assert.ok(at("1981").start >= heard[0].end - 1e-6 && at("1981").end <= heard[4].start + 1e-6, "the number fills the time its three heard words took");
  assert.ok(Math.abs(at("a").start - heard[4].start) < 1e-6, "and the word after it is not three words late");
  assert.ok(at("Tobias").start >= heard[6].end - 1e-6 && at("Tobias").end <= heard[8].start + 0.06, "the name sits where the wrong name was heard");
  assert.ok(Math.abs(at("knocked").start - heard[8].start) < 1e-6);
});

test("words the listener stopped hearing run on from the last one heard, at an ordinary pace", () => {
  const lines = ["The bell rang three times and then it stopped for good."];
  const heard = said("The bell rang three times", 2.0);
  const timed = scriptWordTimes(lines, heard, [{ t0: 0, t1: 30 }]);
  const last = timed[timed.length - 1], times = timed.find((w) => w.word === "times")!;
  assert.ok(Math.abs(times.start - heard[4].start) < 1e-6);
  assert.ok(Math.abs(last.end - (heard[4].end + 6 * SAY_PACE)) < 1e-6, "six unheard words: six paces — not stretched to the end of a 30-second window");
});

test("a scene whose opening was missed starts where the scene before was heard to end", () => {
  const lines = ["The door opened slowly.", "Nobody was there at all.", "Then the lamp went out."];
  // scene 2's first words ("Nobody was") are missed; scene 1's close and scene 3 are heard
  const heard = [...said("The door opened slowly.", 0.5), ...said("there at all.", 4.0), ...said("Then the lamp went out.", 7.0)];
  const win = sceneWindows(lines, heard, 10);
  assert.ok(Math.abs(win[1].t0 - (4.0 - 2 * SAY_PACE)) < 1e-6, `counted back from "there": ${win[1].t0}`);
  assert.ok(win[1].t0 >= heard[3].end - 1e-6, "and never before the scene before was heard to end");
  assert.ok(Math.abs(win[2].t0 - 7.0) < 1e-6);
});

test("when the heard words are not the script's, nothing is anchored: counted as before", () => {
  const lines = ["Nobody in Harlow Creek remembers who built the house.", "They only remember the rule."];
  // a garbled listen: the same number of words, none of them the same
  const garbled = said("no buddy inn hollow creak re members hue bilt thee how's the own lee re member there ool", 0.2);
  const win = sceneWindows(lines, garbled, 6);
  const frac = lines[0].split(" ").length / lines.join(" ").split(" ").length;
  assert.equal(win[1].t0, garbled[Math.round(frac * garbled.length)].start, "the scene starts by the count");
  const timed = scriptWordTimes(lines, garbled, win);
  const inOne = garbled.filter((w) => w.start < win[1].t0);
  assert.equal(timed[0].start, inOne[0].start, "and the j-th written word takes the j-th heard word's time");
  // nothing heard at all: the words are spread across each window, as they always were
  const none = scriptWordTimes(lines, [], [{ t0: 0, t1: 3 }, { t0: 3, t1: 6 }]);
  assert.equal(none[0].start, 0);
  assert.ok(Math.abs(none[none.length - 1].end - 6) < 1e-9);
});

test("a script without spaces is anchored glyph by glyph — a Latin name the listener spells out moves nothing", () => {
  const lines = ["GUS和ISLA在这里打扫多年,从不曾信过这话。"];
  // the listener hears the name letter by letter and writes ISLA as two other glyphs
  const glyphs = ["G", "u", "s", "和", "艾", "瑟", "在", "这", "里", "打", "扫", "多", "年", "从", "不", "曾", "信", "过", "这", "话"];
  const heard: WordT[] = glyphs.map((word, i) => ({ word, start: 1 + i * 0.25, end: 1 + i * 0.25 + 0.2 }));
  const timed = scriptWordTimes(lines, heard, [{ t0: 0, t1: 8 }]);
  const at = (w: string) => timed.find((x) => x.word.replace(/[.,]/g, "") === w)!;
  assert.ok(Math.abs(at("和").start - heard[3].start) < 1e-6, "和 is said when 和 is heard");
  assert.ok(Math.abs(at("在").start - heard[6].start) < 1e-6, "在 too — the two glyphs heard for ISLA do not push it");
  assert.ok(Math.abs(at("多年").start - heard[11].start) < 1e-6 && Math.abs(at("多年").end - heard[12].end) < 1e-6, "a two-glyph word spans its two glyphs");
  assert.ok(at("ISLA").start >= heard[3].end - 1e-6 && at("ISLA").end <= heard[6].start + 0.06, "the name sits between its neighbours");
});

// ---- the listen itself ------------------------------------------------------------------------------------
// The sentence was missed because the stock voice detector did not take a performed voice's quiet opening
// for speech. The same recording heard with the detector set softer gave all 147 words (measured,
// 2026-11-23). A first listen that missed part of the script is done again that way; the better is kept.
test("a listen that missed part of the story is done again, softer — and the better one is kept", () => {
  const heardAll = [...said("They say the old theatre never fully empties after midnight. Gus and Isla had cleaned it for years.", 0.2), ...said("A light flickered in the royal box. Isla felt a cold draft where no window existed.", 9.0), ...said("Gus forced the door that had not opened in fifty years.", 15.0)];
  const missedOpening = heardAll.slice(10);
  assert.equal(heardShare(STORY, heardAll), 1, "every word heard as itself");
  const share = heardShare(STORY, missedOpening);
  assert.ok(Math.abs(share - (heardAll.length - 10) / heardAll.length) < 1e-9, `ten words missed: ${share}`);
  assert.ok(share < LISTEN_AGAIN_UNDER, "worth a second listen");
  assert.ok(137 / 147 < LISTEN_AGAIN_UNDER, "the real one (137 of 147) was");
  assert.ok(177 / 179 >= LISTEN_AGAIN_UNDER && 157 / 158 >= LISTEN_AGAIN_UNDER, "a name heard wrong here and there is not (the French and German listens)");
  assert.equal(heardShare(STORY, []), 0);
  assert.equal(heardShare([], heardAll), 0);
  // a heard name spelt another way, a number read out: those words are not "the same", the rest are
  assert.ok(Math.abs(heardShare(["In 1981 a boy named Tobias knocked anyway."], said("In nineteen eighty one a boy named Tobius knocked anyway.", 1)) - 6 / 8) < 1e-9);
  const read = (f: string) => fs.readFileSync(new URL(`../app/lib/${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const nar = read("narrated-story.server.ts");
  // (…or fitted words where it was not sure of them — tests/listener-doubt.test.ts)
  assert.ok(nar.includes("const first = listenQuality(lines, words);\n      if (listenAgain(first)) {"));
  assert.ok(nar.includes("createWhisperx(voUrl, normalizeContentLang(lang), { sung: true })"), "the softer detector, in the story's own language");
  assert.ok(nar.includes("if (second.share > first.share) { words = again; keptSoft = true; }"), "only a better listen replaces the first");
  assert.ok(nar.includes("the softer listen failed — keeping the first"), "and a failed second listen costs nothing");
  const fl = read("faceless-video.server.ts");
  assert.ok(fl.includes("if (words.length && listenAgain(first)) {"));
  assert.ok(fl.includes("createWhisperx(voUrl, lang, { sung: true })"));
  assert.ok(fl.includes("if (listenQuality(lines, again).share > first.share) { words = again; keptSoft = true; }"));
});
