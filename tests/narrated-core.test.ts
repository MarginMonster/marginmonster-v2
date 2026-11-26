/* NARRATED STORIES — when each picture shows, what the captions say and when, and that ffmpeg can draw
 * them. The owner asked for "stereotypical ai narrated story" videos and "Subtitle options / like captions"
 * (2026-11-17); these pin the parts that are plain logic. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  BOLD_LINE, MIN_SCENE_S, barBox, barsIn, boldCards, captionFilters, captionStyleOf, drawable, entryName, evenParts, frameWords, kenBurns, namedIn, presentIn, nameWords, wrapEven,
  keepToldScenes, saidUnits, sceneCast, sceneWindows, trimToSound, scriptWordTimes, storyFrame, subtitleCards, subtitleChars, wrapLines, type WordT,
} from "../app/lib/narrated-core.ts";

/** A narration "heard" word for word: `gap` seconds of silence between scenes. */
function heard(lines: string[], perWord = 0.3, gap = 0.5): { words: WordT[]; total: number } {
  const words: WordT[] = [];
  let t = 0.2;
  for (const l of lines) {
    for (const w of l.split(/\s+/).filter(Boolean)) { words.push({ word: w, start: t, end: t + perWord * 0.8 }); t += perWord; }
    t += gap;
  }
  return { words, total: t };
}

const STORY = [
  "Nobody in Harlow Creek remembers who built the house at the end of Mill Road.",
  "They only remember the rule. You do not knock after dark.",
  "In 1981, a boy named Tobias knocked anyway.",
  "The door opened before his hand came down — and something inside said his name.",
];

test("every picture is up for exactly its own part of the story, and the windows tile the whole narration", () => {
  const { words, total } = heard(STORY);
  const win = sceneWindows(STORY, words, total);
  assert.equal(win.length, STORY.length);
  assert.equal(win[0].t0, 0);
  assert.equal(win[win.length - 1].t1, total);
  for (let k = 0; k + 1 < win.length; k++) assert.equal(win[k].t1, win[k + 1].t0, "no gap and no overlap between pictures");
  // scene k starts at its own first heard word
  let idx = 0;
  STORY.forEach((l, k) => {
    if (k > 0) assert.ok(Math.abs(win[k].t0 - words[idx].start) < 1e-9, `scene ${k + 1} starts on its first word`);
    idx += l.split(/\s+/).length;
  });
});

test("a transcriber that hears a different number of words still lands each scene close to its start", () => {
  const { words, total } = heard(STORY);
  // "1981" is heard as three words; an "a" is dropped
  const off: WordT[] = [];
  for (const w of words) {
    if (w.word === "1981,") { const d = (w.end - w.start) / 3; ["nineteen", "eighty", "one"].forEach((x, i) => off.push({ word: x, start: w.start + i * d, end: w.start + (i + 1) * d })); }
    else if (w.word !== "a") off.push(w);
  }
  const exact = sceneWindows(STORY, words, total);
  const loose = sceneWindows(STORY, off, total);
  for (let k = 1; k < STORY.length; k++) assert.ok(Math.abs(exact[k].t0 - loose[k].t0) < 1.0, `scene ${k + 1} within a second (${exact[k].t0} vs ${loose[k].t0})`);
});

test("with nothing heard at all, the scenes share the narration by how much each has to say", () => {
  const win = sceneWindows(["one two three four five six", "seven eight nine"], [], 9);
  assert.equal(win.length, 2);
  assert.ok(Math.abs(win[0].t1 - 6) < 1e-9);
  assert.equal(win[1].t1, 9);
});

test("no picture flashes by: every scene gets its minimum, in order, even when one says a single word", () => {
  const lines = ["A long opening sentence that takes a while to say out loud.", "No.", "Then the ending arrives at last."];
  const { words, total } = heard(lines, 0.25, 0);
  const win = sceneWindows(lines, words, total);
  for (const w of win) assert.ok(w.t1 - w.t0 >= MIN_SCENE_S - 1e-9, `a scene of ${(w.t1 - w.t0).toFixed(2)}s`);
  for (let k = 0; k + 1 < win.length; k++) assert.ok(win[k + 1].t0 > win[k].t0);
});

test("captions say what was WRITTEN, timed by what was heard", () => {
  const { words, total } = heard(STORY);
  // the transcriber mishears a name and writes a number out
  const misheard = words.map((w) => (w.word === "Tobias" ? { ...w, word: "Tobius" } : w.word === "Harlow" ? { ...w, word: "Harlowe" } : w));
  const win = sceneWindows(STORY, misheard, total);
  const timed = scriptWordTimes(STORY, misheard, win);
  const said = timed.map((w) => w.word).join(" ");
  assert.ok(said.includes("Tobias") && !said.includes("Tobius"), "the script's spelling of a name");
  assert.ok(said.includes("Harlow ") && said.includes("1981"), "and a number as it was written");
  // in step with the voice: each written word carries the time of the heard word in the same place
  assert.equal(timed.length, words.length - 1, "the lone dash is not a word");
  for (let i = 0; i + 1 < timed.length; i++) assert.ok(timed[i + 1].start >= timed[i].start, "in order");
  const tob = timed.find((w) => w.word === "Tobias")!;
  const heardTob = misheard.find((w) => w.word === "Tobius")!;
  assert.ok(Math.abs(tob.start - heardTob.start) < 0.35, `Tobias appears as it is said (${tob.start} vs ${heardTob.start})`);
});

test("a scene nothing was heard in still gets its words, spread across its window", () => {
  const lines = ["First scene here.", "Second scene with five words."];
  const win = [{ t0: 0, t1: 2 }, { t0: 2, t1: 7 }];
  const timed = scriptWordTimes(lines, [{ word: "First", start: 0.1, end: 0.4 }, { word: "scene", start: 0.5, end: 0.8 }, { word: "here", start: 0.9, end: 1.2 }], win);
  const second = timed.slice(3);
  assert.equal(second.length, 5);
  assert.ok(Math.abs(second[0].start - 2) < 1e-9 && Math.abs(second[4].end - 7) < 1e-9);
});

test("an acted shot whose voice was barely understood keeps its line up for the whole of its speech", () => {
  // the first real acted film with a creature: the hiker's line was heard in full, the werewolf's
  // snarled line only as its first four words — and his subtitle left the screen while he was talking
  const lines = ["Hello? Ranger station, is anybody here, I just need shelter from this storm.", "Nobody's here but me, and I live here, you should not have come inside."];
  const windows = [{ t0: 0, t1: 6.1 }, { t0: 6.1, t1: 13.27 }];
  const heardW: WordT[] = [
    ...["Hello?", "Ranger", "Station,", "is", "anybody", "here?", "I", "just", "need", "shelter", "from", "the", "storm."].map((w, i) => ({ word: w, start: 0.8 + i * 0.36, end: 1.0 + i * 0.36 })),
    { word: "here", start: 7.38, end: 7.56 }, { word: "but", start: 7.58, end: 7.64 }, { word: "me.", start: 7.66, end: 7.72 },
  ];
  const sparse = { minHeard: 0.6, lead: 0.25, tail: 0.3 };
  const timed = scriptWordTimes(lines, heardW, windows, sparse);
  const n1 = drawable(lines[0]).split(" ").length;
  const his = timed.slice(n1);
  // her line is timed by what was heard
  assert.ok(Math.abs(timed[0].start - 0.8) < 1e-9);
  // his line comes up just after the cut (the first word the aligner caught was 1.3 s into his shot)
  assert.ok(Math.abs(his[0].start - 6.35) < 1e-9, String(his[0].start));
  assert.ok(Math.abs(his[his.length - 1].end - (13.27 - 0.3)) < 1e-6, String(his[his.length - 1].end));
  const cards = subtitleCards(lines, windows, 52, timed);
  const hisCards = cards.filter((c) => c.t0 >= 6.1);
  assert.ok(hisCards.length >= 1 && hisCards[0].t0 >= 6.1, "his subtitle does not come up over her line");
  // a speaker who clearly enters late: the line waits for them
  const lateHeard = [...heardW.slice(0, 13), { word: "me.", start: 9.5, end: 9.7 }];
  assert.ok(Math.abs(scriptWordTimes(lines, lateHeard, windows, sparse).slice(n1)[0].start - 9.3) < 1e-9);
  // the shot ends in quiet from 11.1 s: his words stop there, not at the end of the picture
  const said = trimToSound(windows, "[silencedetect @ 0x1] silence_start: 11.1\n[silencedetect @ 0x1] silence_end: 13.27 | silence_duration: 2.17\n");
  assert.deepEqual(said[0], windows[0]);
  assert.ok(Math.abs(said[1].t1 - 11.6) < 1e-9);
  const quietEnd = scriptWordTimes(lines, heardW, said, sparse).slice(n1);
  assert.ok(quietEnd[quietEnd.length - 1].end <= 11.6 - 0.3 + 1e-9);
  // quiet in the MIDDLE of a shot (a pause) trims nothing; quiet that never ends (to the end of the file) does
  assert.deepEqual(trimToSound(windows, "silence_start: 8.0\nsilence_end: 9.0\n")[1], windows[1]);
  assert.ok(Math.abs(trimToSound(windows, "silence_start: 12.0\n")[1].t1 - 12.5) < 1e-9);
  assert.ok(hisCards[hisCards.length - 1].t1 >= 12.9, "and is still up while he is speaking");
  // nothing heard at all in a shot: the line comes up just after the cut
  const none = scriptWordTimes(lines, heardW.slice(0, 13), windows, sparse).slice(n1);
  assert.ok(Math.abs(none[0].start - 6.35) < 1e-9);
  // without the option (a narrated story): the three words that were heard are where they were heard, and
  // the rest of the line runs on from them at an ordinary pace. (It used to be squeezed into the third of
  // a second that was heard — the whole line gone by 7.7 s. caption-anchors.test.ts)
  const plain = scriptWordTimes(lines, heardW, windows).slice(n1);
  assert.ok(Math.abs(plain[1].start - 7.38) < 1e-9, "“here” where it was heard");
  assert.ok(plain[his.length - 1].end > 11 && plain[his.length - 1].end <= 13.27 + 1e-9, String(plain[his.length - 1].end));
});

test("BOLD cards: a few words on one line, upper case, each up while it is said, none overlapping", () => {
  const { words, total } = heard(STORY);
  const cards = boldCards(scriptWordTimes(STORY, words, sceneWindows(STORY, words, total)));
  assert.ok(cards.length >= 12);
  for (const c of cards) {
    assert.equal(c.text, c.text.toUpperCase());
    assert.ok(c.text.split(" ").length <= 3, c.text);
    assert.ok(c.text.length <= BOLD_LINE || !c.text.includes(" "), `one line: "${c.text}"`);
    assert.ok(c.t1 > c.t0);
    assert.ok(!/['":;\\%\[\]]/.test(c.text), `nothing that breaks the filter: ${c.text}`);
    assert.ok(!/[.,…]$/.test(c.text), `no closing comma or full stop: "${c.text}"`);
  }
  for (let i = 0; i + 1 < cards.length; i++) assert.ok(cards[i].t1 <= cards[i + 1].t0 + 1e-9, "one card at a time");
  // every word of the story is on screen once, in order (only a card's closing comma / full stop is dropped)
  const bare = (x: string) => x.replace(/[.,…]/g, "").replace(/\s+/g, " ").trim();
  assert.equal(bare(cards.map((c) => c.text).join(" ")), bare(STORY.map(drawable).join(" ").toUpperCase()));
});

test("a BOLD card never holds the end of one sentence and the start of the next, nor two scenes", () => {
  // seen in the first real render: "HOWL, ONCE. A" and "YOU LOOK. THE" (the next scene's first word)
  const lines = ["They say his name was Howl, once. A trucker who stopped here.", "The bell rang. He did not look up."];
  const { words, total } = heard(lines, 0.3, 0.2);
  const cards = boldCards(scriptWordTimes(lines, words, sceneWindows(lines, words, total)));
  const texts = cards.map((c) => c.text);
  assert.ok(texts.includes("HOWL, ONCE"), texts.join(" | "));
  assert.ok(texts.some((x) => x.startsWith("A TRUCKER")), texts.join(" | "));
  for (const x of texts) assert.ok(!/[.!?] /.test(x), `"${x}" runs across a sentence`);
  // no card mixes the two scenes: "HERE" closes scene one, "THE BELL RANG" opens scene two
  assert.ok(texts.some((x) => x.endsWith("HERE")) && texts.includes("THE BELL RANG"), texts.join(" | "));
  // a scene written without a closing full stop still ends its card
  const loose = ["no full stop here", "next scene starts"];
  const h2 = heard(loose, 0.3, 0);
  const c2 = boldCards(scriptWordTimes(loose, h2.words, sceneWindows(loose, h2.words, h2.total))).map((c) => c.text);
  assert.ok(!c2.some((x) => x.includes("HERE NEXT")), c2.join(" | "));
});

test("who is in a scene's picture is whoever its VISUAL names — and nobody else", () => {
  // a name is a word of its own, written as the name is
  assert.ok(namedIn("Howl", "Howl standing under the canopy light"));
  assert.ok(!namedIn("Howl", "a distant howl rolls over the empty lot"));
  assert.ok(namedIn("Dot", "Pip and Dot run to the kite"));
  assert.ok(!namedIn("Dot", "a dotted line on the map") && !namedIn("Pip", "a rusty pipe"));
  assert.ok(namedIn("Pip", "the kite lands on Pip's nose"));
  // several words: the whole name in any case, or any of its own words
  assert.ok(namedIn("Mourning Mary", "Mary drifts down the stairs"));
  assert.ok(namedIn("Mourning Mary", "the veil of mourning mary on the chair"));
  assert.ok(namedIn("The Ganve", "Ganve crouches in the reeds") && !namedIn("The Ganve", "The lake at dawn, empty"));
  assert.deepEqual(nameWords("The Ganve"), ["Ganve"]);
  // A NAME THAT ONLY DESCRIBES is called by its head word (live 2026-11-26: "the claw machine ghost" was counted in
  // every scene that showed the claw machine, and the redraws drew its hands into them)
  assert.deepEqual(nameWords("the claw machine ghost"), ["ghost"]);
  assert.deepEqual(nameWords("the woman in grey"), ["woman"]);
  assert.deepEqual(nameWords("the keeper's daughter"), ["daughter"]);
  assert.deepEqual(nameWords("the ghost of the pier"), ["ghost"]);
  assert.deepEqual(nameWords("the skater"), ["skater"], "one word: as before");
  assert.deepEqual(nameWords("Mourning Mary"), ["Mourning", "Mary"], "a proper name: every word, as before");
  assert.deepEqual(nameWords("Old Tomas the ferryman"), ["Tomas", "ferryman"], "any capital makes it a proper name");
  assert.deepEqual(nameWords("علی رضا"), ["علی", "رضا"], "a script with no capitals keeps every word");
  const lit = "FROM BELOW: low angle looking up at the claw machine, its chipped mustard-yellow case glowing faintly, Girish standing beside it.";
  assert.equal(presentIn("the claw machine ghost", lit), false, "the machine is not the ghost");
  assert.equal(presentIn("the claw machine ghost", "WIDE: Girish stands frozen before the claw machine as every dead machine flickers alight."), false);
  assert.equal(presentIn("the claw machine ghost", "CLOSE: the ghost presses its face to the glass of the claw machine."), true);
  assert.equal(presentIn("the claw machine ghost", "the claw machine ghost watches from among the toys"), true, "the whole name");
  assert.equal(presentIn("the claw machine ghost", "the ghost's long pale fingers spread on the glass"), true, "its hand is it");
  assert.equal(namedIn("the woman in grey", "a grey coat hangs on the hook"), false);
  assert.equal(namedIn("the woman in grey", "the woman turns from the window"), true);
  assert.equal(entryName("Marla, a tired night clerk in her forties"), "Marla");
  // the scene decides
  const others = ["Marla, a tired night clerk in her forties", "Denny, a lanky teenage stock boy"];
  assert.deepEqual(sceneCast("The empty counter at dawn, a scrap of red plaid on it", ["Howl"], others), { picked: [], others: [] });
  assert.deepEqual(sceneCast("Howl presses a clawed hand to the glass while Marla counts to ten", ["Howl"], others), { picked: [0], others: [others[0]] });
  assert.deepEqual(sceneCast("Denny stacks cans in aisle three", ["Howl"], others), { picked: [], others: [others[1]] });
});

test("SUBTITLES: the story as written, at most two lines at a time, each inside its own scene", () => {
  const { words, total } = heard(STORY);
  const win = sceneWindows(STORY, words, total);
  const max = subtitleChars(720, 1280);
  for (const timed of [undefined, scriptWordTimes(STORY, words, win)]) {
    const cards = subtitleCards(STORY, win, max, timed);
    for (const c of cards) {
      const ls = c.text.split("\n");
      assert.ok(ls.length <= 2);
      for (const l of ls) assert.ok(l.length <= max, `"${l}" fits`);
      assert.ok(c.t1 > c.t0);
    }
    for (let i = 0; i + 1 < cards.length; i++) assert.ok(cards[i].t1 <= cards[i + 1].t0 + 1e-9, "one card at a time");
    // (as the words are said: a dash between words is a pause, drawn as a comma — saidUnits)
    assert.equal(cards.map((c) => c.text.replace(/\n/g, " ")).join(" "), STORY.flatMap(saidUnits).join(" "), "nothing lost, nothing added");
    // a card never spills into the next scene's picture
    let k = 0;
    for (const c of cards) { while (k + 1 < win.length && c.t0 >= win[k].t1 - 1e-9) k++; assert.ok(c.t1 <= win[k].t1 + 1e-9, `card "${c.text.slice(0, 20)}" ends inside scene ${k + 1}`); }
  }
});

test("subtitles timed to the voice come up as their first word is spoken", () => {
  const { words, total } = heard(STORY);
  const win = sceneWindows(STORY, words, total);
  const timed = scriptWordTimes(STORY, words, win);
  const cards = subtitleCards(STORY, win, 30, timed);
  const first = cards[0].text.replace(/\n/g, " ").split(" ")[0];
  assert.equal(first, "Nobody");
  assert.ok(Math.abs(cards[0].t0 - timed[0].start) < 1e-9);
  // the second card of scene 1 starts on ITS first word, not at an even split
  const n0 = cards[0].text.replace(/\n/g, " ").split(" ").length;
  assert.ok(Math.abs(cards[1].t0 - timed[n0].start) < 1e-9);
});

test("a subtitle card is whole sentences — it never ends in the middle of one that could have fitted", () => {
  // seen in the first real render: "…So it snapped its string, and ran" / "away to the top of the tallest tree in the park."
  const lines = ["One windy morning, a little red kite got tired of flying in circles. So it snapped its string, and ran away to the top of the tallest tree in the park."];
  const cards = subtitleCards(lines, [{ t0: 0, t1: 10 }], 52).map((c) => c.text.replace(/\n/g, " "));
  assert.deepEqual(cards, [
    "One windy morning, a little red kite got tired of flying in circles.",
    "So it snapped its string, and ran away to the top of the tallest tree in the park.",
  ]);
  // short sentences share a card while they fit on two lines
  const short = subtitleCards(["Pip saw it first. Dot saw it second. And both of them agreed that a kite all alone in a tree was the saddest thing they had ever seen."], [{ t0: 0, t1: 9 }], 52).map((c) => c.text.replace(/\n/g, " "));
  assert.equal(short[0], "Pip saw it first. Dot saw it second.");
  // a sentence too long for two lines is shown two lines at a time, nothing lost
  const long = "This single sentence simply goes on and on and on without ever stopping for breath because the storyteller forgot what a full stop is for and nobody in the room dared to interrupt.";
  const lc = subtitleCards([long], [{ t0: 0, t1: 12 }], 30);
  assert.ok(lc.length >= 3);
  for (const c of lc) assert.ok(c.text.split("\n").length <= 2);
  assert.equal(lc.map((c) => c.text.replace(/\n/g, " ")).join(" "), long);
});

test("wrapLines never loses a word and never overfills a line (a giant word stands alone)", () => {
  const text = "a supercalifragilisticexpialidocious word and then some more ordinary ones";
  const ls = wrapLines(text, 12);
  assert.equal(ls.join(" "), text);
  for (const l of ls) assert.ok(l.length <= 12 || !l.includes(" "));
});

test("a subtitle card is set evenly: no stub line, and no one-word card after a long sentence", () => {
  // seen in the vertical render: "…a little / red kite got tired of flying" then "in circles." alone
  const lines = ["One windy morning, a little red kite got tired of flying in circles."];
  const cards = subtitleCards(lines, [{ t0: 0, t1: 6 }], 30);
  assert.deepEqual(cards.map((c) => c.text), ["One windy morning,\na little red kite", "got tired of\nflying in circles."]);
  assert.deepEqual(wrapEven("One windy morning, a little red kite", 30), ["One windy morning,", "a little red kite"]);
  assert.deepEqual(wrapEven("short line", 30), ["short line"]);
  assert.deepEqual(evenParts("a b c d e f".split(" "), 3), [["a", "b"], ["c", "d"], ["e", "f"]]);
  assert.deepEqual(evenParts(["only"], 3), [["only"]]);
});

test("a picture with black bars baked in is caught — and a dark scene is not mistaken for one", () => {
  // ffmpeg's own words about two real stills from the test renders (768x1344)
  const head = "  Stream #0:0: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 768x1344, 25 fps, 25 tbr, 25 tbn\n";
  assert.equal(barsIn(head + "[Parsed_cropdetect_0 @ 0x1] x1:14 x2:767 y1:404 y2:939 w:754 h:536 x:14 y:404 pts:2 t:0.08 limit:0.039216 crop=754:536:14:404\n"), true, "a wide picture letterboxed in a tall frame");
  assert.equal(barsIn(head + "[Parsed_cropdetect_0 @ 0x1] x1:0 x2:767 y1:0 y2:1343 w:768 h:1344 x:0 y:0 pts:2 t:0.08 limit:0.039216 crop=768:1344:0:0\n"), false, "a picture that fills its frame");
  // a night sky: black at the top only
  assert.equal(barsIn(head + "[Parsed_cropdetect_0 @ 0x1] crop=768:1000:0:344\n"), false, "dark at the top is a sky, not a bar");
  // pillarboxed: a tall picture inside a wide frame
  assert.equal(barsIn("  Stream #0:0: Video: mjpeg, yuvj420p, 1344x768, 25 fps\n[Parsed_cropdetect_0 @ 0x1] crop=540:768:402:0\n"), true);
  assert.equal(barsIn(""), false);
  // thin bars — 50px top and bottom of 1344, seen on the live site — are bars too, and can be cropped off
  const thin = head + "[Parsed_cropdetect_0 @ 0x1] crop=768:1244:0:50\n";
  assert.equal(barsIn(thin), true);
  assert.deepEqual(barBox(thin), { w: 768, h: 1244, x: 0, y: 50 });
  // …while 40px of dark sky above a full picture (the same scene, drawn again) is not
  assert.equal(barBox(head + "[Parsed_cropdetect_0 @ 0x1] crop=768:1304:0:40\n"), null);
  assert.ok(frameWords("9:16").startsWith("A tall vertical") && frameWords("16:9").startsWith("A wide") && frameWords("1:1").startsWith("A square"));
});

test("an approved picture stays with ITS scene, whatever is dropped around it", () => {
  // the first live film re-drew all six approved pictures; and an empty scene must not slide the rest along
  const scenes = [{ caption: "One." }, { caption: "  " }, { caption: "Three." }, { caption: "Four." }, { caption: "Five." }];
  const imgs = ["a.jpg", "b.jpg", "c.jpg", null, "e.jpg"];
  const kept = keepToldScenes(scenes, imgs, 12);
  assert.deepEqual(kept.scenes.map((x) => x.caption), ["One.", "Three.", "Four.", "Five."]);
  assert.deepEqual(kept.approved, ["a.jpg", "c.jpg", null, "e.jpg"]);
  // every scene approved → every picture used, in order
  const all = keepToldScenes(scenes.filter((x) => x.caption.trim()), ["1", "2", "3", "4"], 12);
  assert.deepEqual(all.approved, ["1", "2", "3", "4"]);
  // capped, pictures capped with it; no pictures given → none claimed
  assert.deepEqual(keepToldScenes(scenes, imgs, 2).approved, ["a.jpg", "c.jpg"]);
  assert.deepEqual(keepToldScenes(scenes, [], 12).approved, [null, null, null, null]);
});

test("caption style: only the three known styles, anything else is the fallback", () => {
  assert.equal(captionStyleOf("bold"), "bold");
  assert.equal(captionStyleOf("subtitles"), "subtitles");
  assert.equal(captionStyleOf("off", "bold"), "off");
  assert.equal(captionStyleOf("karaoke", "bold"), "bold");
  assert.equal(captionStyleOf(undefined), "off");
  assert.deepEqual(captionFilters([{ text: "HELLO", t0: 0, t1: 1 }], "off", "f.ttf", 720, 1280), []);
});

test("the frame a story is drawn on", () => {
  // (full HD since 2026-11-25 — the owner: "yes obviously upgrade the best image possible")
  assert.deepEqual(storyFrame("16:9"), { aspect: "16:9", W: 1920, H: 1080 });
  assert.deepEqual(storyFrame("1:1"), { aspect: "1:1", W: 1080, H: 1080 });
  assert.deepEqual(storyFrame("4:5"), { aspect: "9:16", W: 1080, H: 1920 });
  assert.deepEqual(storyFrame(null), { aspect: "9:16", W: 1080, H: 1920 });
});

// ---- ffmpeg really draws them -------------------------------------------------------------------------
const ffmpegOk = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0;
const FONT = path.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");

test("ffmpeg accepts the caption filters and the picture move, for every frame shape and both styles", { skip: !ffmpegOk || !fs.existsSync(FONT) }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "narr-"));
  try {
    const still = path.join(dir, "s.jpg");
    assert.equal(spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc2=s=640x800:d=1", "-frames:v", "1", still], { encoding: "utf8" }).status, 0);
    const lines = ["It’s the boy's turn — \"now\", she said: 100% sure; isn't it?", "Then nothing. Nothing at all, for a long, long time."];
    const win = [{ t0: 0, t1: 1.5 }, { t0: 1.5, t1: 3 }];
    for (const aspect of ["9:16", "16:9", "1:1"]) {
      const { W, H } = storyFrame(aspect);
      for (const style of ["bold", "subtitles"] as const) {
        const timed = scriptWordTimes(lines, [], win);
        const cards = style === "bold" ? boldCards(timed) : subtitleCards(lines, win, subtitleChars(W, H), timed);
        const caps = captionFilters(cards, style, FONT, W, H);
        assert.ok(caps.length >= cards.length, "a filter for every line of every card");
        const out = path.join(dir, `o-${W}-${style}.mp4`);
        const graph = `[0:v]${kenBurns(0, 45, W, H)}[a];[1:v]${kenBurns(1, 45, W, H)}[b];[a][b]concat=n=2:v=1:a=0[v];[v]${caps.join(",")}[o]`;
        const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", still, "-i", still, "-filter_complex", graph, "-map", "[o]", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", out], { encoding: "utf8" });
        assert.equal(r.status, 0, `${aspect} ${style}: ${r.stderr.slice(-400)}`);
        const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=width,height,nb_read_frames", "-of", "csv=p=0", out], { encoding: "utf8" });
        const [w, h, frames] = probe.stdout.trim().split(",").map(Number);
        assert.equal(w, W); assert.equal(h, H);
        assert.equal(frames, 90, "two pictures of 45 frames each — the move is exactly as long as asked");
      }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* The second episode of the clock-tower story (live, 2026-11-24) is about a woman who has NOT come. Three of
 * its pictures are at "Edda's cottage". Each named Edda, so each was drawn from her portrait: she stood in
 * her own doorway in two of them — and the one picture that rightly left her out was flagged "Edda is
 * missing". */
test("named as the owner of something is not being there", () => {
  const cottage = "Finn walks up to Edda's cottage, past the wooden bench beside the round green door, no smoke rising from the crooked chimney.";
  const door = "Finn sits on the wooden bench beside Edda’s round green door at dusk, Old Tomas beside him.";
  assert.ok(namedIn("Edda", cottage), "she is NAMED there…");
  assert.equal(presentIn("Edda", cottage), false, "…but it is her cottage that is in the picture");
  assert.equal(presentIn("Edda", door), false);
  assert.equal(presentIn("Finn", cottage), true);
  assert.equal(presentIn("Old Tomas", door), true);
  // what is theirs and part of them IS them
  assert.equal(presentIn("Edda", "Edda's hand rests on the cold iron rail"), true);
  assert.equal(presentIn("Maren", "Maren's bare bluish foot rests on the ferry's deck"), true);
  assert.equal(presentIn("Maren", "Maren's long dark wet hair drips onto the planks"), true, "four words on");
  assert.equal(presentIn("Pip", "the kite lands on Pip's nose"), true);
  // a VOICE is heard, never drawn (live 2026-11-26: the grandmother was looked for in her grandson's close-up)
  const heard = "At the kitchen: CLOSE: Teodor's face, flour dusting his cheek, eyes down on his kneading hands, concentration and quiet delight as Philomena's voice drifts over him near the counter.";
  assert.equal(presentIn("Philomena", heard), false, "her voice is not her");
  assert.equal(presentIn("Teodor", heard), true);
  assert.equal(presentIn("Ode", "morning light golden on Ode's mossy shell"), true);
  // named as somebody once is enough, whatever else of theirs is mentioned
  assert.equal(presentIn("Edda", "Edda stands at the door of Edda's cottage"), true);
  assert.equal(presentIn("Tomas", "Tomas' boat rocks at the pier"), false, "a name that ends in s");
  assert.equal(presentIn("Tomas", "Old Tomas holds the great key out toward Finn"), true);
  // not named at all, or nothing to go on
  assert.equal(presentIn("Edda", "The empty square at dawn"), false);
  assert.equal(presentIn("", cottage), false);
  assert.equal(presentIn("Edda", ""), false);
  // WHO IS DRAWN: the three cottage pictures are Finn's and Old Tomas's — Edda's portrait is not handed over
  const others = ["Edda, a small silver-haired woman in her seventies", "Finn, a wiry nine-year-old boy", "Old Tomas, a tall stooped man in a navy coat"];
  assert.deepEqual(sceneCast(cottage, [], others).others, [others[1]]);
  assert.deepEqual(sceneCast("Old Tomas stands beside Finn at Edda's cottage, resting a weathered hand on the boy's shoulder.", [], others).others, [others[1], others[2]]);
  assert.deepEqual(sceneCast("Edda and Finn stand together outside the weathered wooden door of the clock tower, Edda pointing down the street.", [], others).others, [others[0], others[1]]);
  // a picked presenter is held to the same rule
  assert.deepEqual(sceneCast("The bench outside Howl's den, empty", ["Howl"], []).picked, []);
  // the writer is told as well: whoever a picture names is drawn in it
  const engine = fs.readFileSync(new URL("../app/lib/film-engine.server.ts", import.meta.url), "utf8");
  assert.ok(engine.includes("Whoever a VISUAL names is DRAWN in it — so a place or thing that belongs to somebody who is NOT in the picture is called by what it is"));
});
