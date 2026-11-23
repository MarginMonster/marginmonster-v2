/* CAPTIONS IN A SCRIPT WRITTEN WITHOUT SPACES (Chinese).
 *
 * 2026-11-23: the first Chinese story anyone looked at — a horror story told again in 中文 from the
 * Archive — had every scene's caption as ONE line of forty glyphs running off both sides of the frame,
 * and every scene on screen for the same time whatever it had to say: a line with no spaces was "one
 * word" to everything that counted words. (It was also drawn as empty boxes: tests/caption-font.test.ts.)
 *
 * The lines below are that story's own narration; `heard()` stands in for the transcriber, which hears
 * Chinese glyph by glyph (measured on the real film: 278 glyphs timed). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  BOLD_LINE, boldCards, captionFilters, cutCost, drawable, evenParts, hasWide, joinUnits, saidUnits, sceneWindows, scriptWordTimes, subtitleCards, subtitleChars, textWidth,
  unitWeight, wrapEvenUnits, wrapLines, wrapUnits, type WordT,
} from "../app/lib/narrated-core.ts";

const STORY = [
  "人们都说,这座老剧院一到午夜就从未真正空过。GUS和ISLA在这里打扫多年,从不曾信过这话——直到今晚。",
  "皇家包厢里灯光闪了一下,那是自开幕夜起就被封死了几十年的包厢。ISLA感到一股寒气袭来,可那里根本没有窗户。",
  "GUS用力撬开了那扇五十年未曾打开的门。积尘如同憋了太久的一口气般涌出,而门内,似乎也有什么东西随之呼出了一口气。",
  "她还在那里。",
];
const glyphs = (s: string): string => (s.match(/[\u3400-\u9fff]/g) || []).join("");

/** The narration as the transcriber hears Chinese: one timed "word" per glyph, `gap` seconds between scenes. */
function heard(lines: string[], per = 0.25, gap = 0.6): { words: WordT[]; total: number } {
  const words: WordT[] = [];
  let t = 0.2;
  for (const l of lines) {
    for (const g of glyphs(l)) { words.push({ word: g, start: t, end: t + per * 0.9 }); t += per; }
    t += gap;
  }
  return { words, total: t };
}

test("a Chinese line is cut into words — no glyph lost, marks kept on the word before, names whole", () => {
  for (const line of STORY) {
    const units = saidUnits(line);
    assert.equal(glyphs(units.join("")), glyphs(line), "every glyph, in order");
    assert.ok(units.length > 3, "more than one unit: a line with no spaces is not one word");
    for (const u of units) assert.ok(!/^[.,!?…]/.test(u), `no unit starts with a mark: ${u}`);
    for (const u of units) assert.ok(unitWeight(u) <= 6, `a dictionary word, not a sentence: ${u}`);
  }
  const first = saidUnits(STORY[0]);
  assert.ok(first.includes("GUS") && first.includes("ISLA"), "a name in Latin letters is a unit of its own");
  assert.ok(first.some((u) => /,$/.test(u)), "a comma stays on the word before it");
  assert.ok(first.some((u) => /\.$/.test(u)), "and so does a full stop — the full-width 。 as the plain one");
  assert.equal(first[first.length - 1].replace(/[^.]/g, ""), ".", "the line ends on its full stop");
  assert.ok(saidUnits("从不曾信过这话——直到今晚。").some((u) => /话,$/.test(u)), "a dash between glyphs is a pause, like a comma");
});

test("every other script is cut exactly as before: at its spaces", () => {
  for (const s of ["Nobody in Harlow Creek remembers who built the house.", "Dicen que el viejo teatro nunca se vacía del todo después de la medianoche.", "It’s 100% true, isn't it?"]) {
    assert.equal(hasWide(s), false);
    assert.deepEqual(saidUnits(s), drawable(s).split(" ").filter(Boolean));
    assert.equal(joinUnits(saidUnits(s)), drawable(s));
    assert.equal(textWidth(drawable(s)), [...drawable(s)].length, "a letter is one wide");
    assert.ok(saidUnits(s).every((u) => unitWeight(u) === 1), "and a word is one unit of speech");
  }
  assert.deepEqual(wrapLines("the quick brown fox jumps over", 12), wrapUnits(["the", "quick", "brown", "fox", "jumps", "over"], 12));
  // a colon, a semicolon or a dash between words is a pause: it cannot be drawn, so a comma stands for it
  // (it used to vanish: "she heard it: a slow bell" ran together as "IT A SLOW")
  assert.deepEqual(saidUnits("Then she heard it: a slow bell; far off — and gone."), ["Then", "she", "heard", "it,", "a", "slow", "bell,", "far", "off,", "and", "gone."]);
  assert.deepEqual(saidUnits("door—open at 10:30"), ["door", "open", "at", "1030"], "a dash inside a word and a colon inside a time are not pauses");
});

test("units go back together the way Chinese is set: nothing between glyphs, a space where a comma was", () => {
  assert.equal(joinUnits(["人们", "都", "说,", "这", "座", "老", "剧院"]), "人们都说 这座老剧院");
  assert.equal(joinUnits(["真正", "空", "过."]), "真正空过", "the full stop at the end is not drawn");
  assert.equal(joinUnits(["GUS", "和", "ISLA", "在", "这里"]), "GUS 和 ISLA 在这里", "a name in Latin letters gets air on both sides");
  assert.equal(joinUnits(["谁", "在", "那里?", "没有", "人."]), "谁在那里? 没有人", "a question keeps its mark");
  assert.equal(textWidth("人们都说"), 4 * 1.7, "a glyph is square: about 1.7 letters");
  assert.equal(textWidth("GUS 和"), 3 + 1 + 1.7);
});

test("each scene is on screen for as long as it takes to say — by its glyphs, not as 'one word' each", () => {
  const total = 60;
  const win = sceneWindows(STORY, [], total);
  const said = STORY.map((l) => glyphs(l).length);
  assert.ok(said[3] < said[0] / 5, "the last scene says very little");
  const share = (i: number) => (win[i].t1 - win[i].t0) / total;
  assert.ok(share(3) < 0.1, `the short scene is short on screen: ${share(3).toFixed(2)}`);
  assert.ok(Math.abs(share(0) - share(1)) < 0.06, "two scenes that say about as much get about as long");
  assert.equal(win[0].t0, 0); assert.equal(win[win.length - 1].t1, total);
  // with the voice heard: each scene starts on its own first glyph
  const h = heard(STORY);
  const w2 = sceneWindows(STORY, h.words, h.total);
  let at = 0;
  STORY.forEach((l, k) => {
    // (a name in Latin letters counts as one where the listener hears none — within a glyph or two)
    if (k) assert.ok(Math.abs(w2[k].t0 - h.words[at].start) < 1.2, `scene ${k + 1} opens at ${w2[k].t0.toFixed(2)}, its first glyph is at ${h.words[at].start.toFixed(2)}`);
    at += glyphs(l).length;
  });
});

test("BOLD in Chinese: a clause per card, every card inside the line, nothing lost, nothing cut mid-word", () => {
  const h = heard(STORY);
  const win = sceneWindows(STORY, h.words, h.total);
  const timed = scriptWordTimes(STORY, h.words, win);
  assert.deepEqual(timed.map((w) => w.word), STORY.flatMap(saidUnits), "the script's own words, in order");
  for (let i = 1; i < timed.length; i++) assert.ok(timed[i].start >= timed[i - 1].start, "in the order they are said");
  const cards = boldCards(timed);
  assert.equal(cards[0].text, "人们都说", "the first clause is the first card");
  assert.equal(cards[cards.length - 1].text, "她还在那里");
  for (const c of cards) {
    assert.ok(textWidth(c.text) <= BOLD_LINE, `fits the line: ${c.text} (${textWidth(c.text).toFixed(1)})`);
    assert.ok(!/[.,…]$/.test(c.text), `ends on no comma or full stop: ${c.text}`);
    assert.ok(c.t1 > c.t0);
  }
  assert.equal(glyphs(cards.map((c) => c.text).join("")), glyphs(STORY.join("")), "every glyph of the story is on a card, once, in order");
  for (let i = 1; i < cards.length; i++) assert.ok(cards[i].t0 >= cards[i - 1].t1 - 1e-6, "no two cards up at once");
  // a card's pieces are whole units: the cut never falls inside a dictionary word
  const units = STORY.flatMap(saidUnits).map((u) => u.replace(/[.,!?…]+$/, ""));
  let rest = units.join("\u0001") + "\u0001";
  for (const c of cards) for (const piece of c.text.split(" ")) {
    // each piece of a card is one or more whole units, in order
    let acc = "";
    while (acc.toUpperCase() !== piece && rest) { const cut = rest.indexOf("\u0001"); acc += rest.slice(0, cut); rest = rest.slice(cut + 1); assert.ok(piece.startsWith(acc.toUpperCase()), `${piece} is built of whole words (${acc})`); }
  }
  // the size a card is drawn at keeps it inside nine tenths of the frame
  const filters = captionFilters(cards, "bold", "C:/x/Font.otf", 720, 1280);
  filters.forEach((f, i) => {
    const size = Number(/fontsize=(\d+)/.exec(f)![1]);
    assert.ok(textWidth(cards[i].text) * 0.62 * size <= 720 * 0.9 + 1, `${cards[i].text} at ${size}px`);
  });
});

test("a clause too long for one card is not cut where a word is left leaning over the cut", () => {
  // the two stumbles in the first real render
  assert.deepEqual(evenParts(saidUnits("人们都说这座老剧院一到午夜就从未真正空过"), 2).map(joinUnits), ["人们都说这座老剧院", "一到午夜就从未真正空过"], "一 goes with what follows it");
  assert.deepEqual(evenParts(saidUnits("GUS和ISLA在这里打扫多年"), 2).map(joinUnits), ["GUS 和 ISLA", "在这里打扫多年"], "在 goes with what follows it");
  assert.ok(cutCost("一", "到") > 0 && cutCost("在", "这里") > 0 && cutCost("和", "ISLA") > 0, "a word that leans forward does not end a card");
  assert.ok(cutCost("封死", "了") > 0 && cutCost("包厢", "的,") > 0, "a particle that leans back does not start one");
  assert.equal(cutCost("剧院", "一"), 0);
  assert.equal(cutCost("说,", "这"), 0, "a word with a mark on it is a pause: always a fine place to cut");
  // …and it is nothing at all in a script with spaces
  assert.equal(cutCost("the", "old"), 0);
  assert.deepEqual(evenParts("the quick brown fox jumps over the lazy dog".split(" "), 2), [["the", "quick", "brown", "fox"], ["jumps", "over", "the", "lazy", "dog"]]);
  const h = heard(STORY);
  const cards = boldCards(scriptWordTimes(STORY, h.words, sceneWindows(STORY, h.words, h.total))).map((c) => c.text);
  assert.ok(cards.includes("GUS 和 ISLA"), cards.slice(0, 8).join(" | "));
  for (const c of cards) assert.ok(!/[一在和把被从向]$/.test(c), `no card ends leaning forward: ${c}`);
});

test("BOLD when nothing was heard is the same cards, spread over each scene — not whole sentences", () => {
  const win = sceneWindows(STORY, [], 60);
  const cards = boldCards(scriptWordTimes(STORY, [], win));
  assert.equal(cards[0].text, "人们都说");
  for (const c of cards) assert.ok(textWidth(c.text) <= BOLD_LINE, c.text);
  // …and in English too (the unheard path used to draw "THE THEATRE NEVER EMPTIES." whole, stop and all)
  const en = ["They say the old theatre never empties after midnight.", "Then the lights went out. All of them."];
  const cEn = boldCards(scriptWordTimes(en, [], sceneWindows(en, [], 12)));
  for (const c of cEn) { assert.ok(c.text.split(" ").length <= 3, c.text); assert.ok(!/[.,]$/.test(c.text), c.text); assert.equal(c.text, c.text.toUpperCase()); }
  assert.equal(cEn[cEn.length - 1].text, "ALL OF THEM");
  const src = fs.readFileSync(new URL("../app/lib/narrated-story.server.ts", import.meta.url), "utf8");
  assert.ok(src.includes("const timed = scriptWordTimes(lines, words, windows, undefined, speech);"), "one way to time the words, heard or not");
  assert.ok(!src.includes("subtitleCards(lines.map((l) => l.toUpperCase()), windows, 18)"), "the sentence-at-a-time bold is gone");
});

test("SUBTITLES in Chinese: two lines at most, inside the frame, turning at a pause when there is one", () => {
  const h = heard(STORY);
  const win = sceneWindows(STORY, h.words, h.total);
  const max = subtitleChars(720, 1280);
  for (const timed of [scriptWordTimes(STORY, h.words, win), undefined]) {
    const cards = subtitleCards(STORY, win, max, timed);
    assert.ok(cards.length >= STORY.length);
    for (const c of cards) {
      const ls = c.text.split("\n");
      assert.ok(ls.length <= 2, c.text);
      for (const l of ls) assert.ok(textWidth(l) <= max, `${l} (${textWidth(l).toFixed(1)} of ${max})`);
    }
    assert.equal(glyphs(cards.map((c) => c.text).join("")), glyphs(STORY.join("")), "the whole story, once, in order");
  }
  assert.deepEqual(wrapEvenUnits(saidUnits("ISLA感到一股寒气袭来,可那里根本没有窗户。"), max), ["ISLA 感到一股寒气袭来", "可那里根本没有窗户"], "the line turns at the comma, not a glyph before it");
  assert.deepEqual(wrapEvenUnits(saidUnits("GUS和ISLA在这里打扫多年,从不曾信过这话——直到今晚。"), max), ["GUS 和 ISLA 在这里打扫多年", "从不曾信过这话 直到今晚"]);
  // English is turned where the two lines come out most alike, as before
  assert.deepEqual(wrapEvenUnits("The door opened before his hand came down and it said his name".split(" "), 36).map((l) => l.length).sort(), [30, 31]);
});

// ---- ffmpeg takes them --------------------------------------------------------------------------------
const ffmpegOk = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0;
const FONT = path.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");

test("ffmpeg accepts Chinese caption filters, both styles (the glyphs need their own font to SHOW — that is caption-font's job)", { skip: !ffmpegOk || !fs.existsSync(FONT) }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "narr-zh-"));
  try {
    const win = sceneWindows(STORY, [], 4);
    const timed = scriptWordTimes(STORY, [], win);
    for (const style of ["bold", "subtitles"] as const) {
      const cards = style === "bold" ? boldCards(timed) : subtitleCards(STORY, win, subtitleChars(720, 1280), timed);
      const caps = captionFilters(cards, style, FONT, 720, 1280);
      assert.ok(caps.length >= cards.length);
      const graph = path.join(dir, `${style}.txt`);
      fs.writeFileSync(graph, `color=c=black:s=720x1280:d=4,${caps.join(",")}[o]`);
      const out = path.join(dir, `${style}.mp4`);
      const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-filter_complex_script", graph, "-map", "[o]", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", out], { encoding: "utf8" });
      assert.equal(r.status, 0, `${style}: ${r.stderr.slice(-400)}`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
