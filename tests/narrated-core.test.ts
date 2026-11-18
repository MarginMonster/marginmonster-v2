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
  BOLD_LINE, MIN_SCENE_S, barsIn, boldCards, captionFilters, captionStyleOf, drawable, entryName, evenParts, frameWords, kenBurns, namedIn, nameWords, wrapEven,
  sceneCast, sceneWindows, scriptWordTimes, storyFrame, subtitleCards, subtitleChars, wrapLines, type WordT,
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
    assert.equal(cards.map((c) => c.text.replace(/\n/g, " ")).join(" "), STORY.map(drawable).join(" "), "nothing lost, nothing added");
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
  assert.ok(frameWords("9:16").startsWith("A tall vertical") && frameWords("16:9").startsWith("A wide") && frameWords("1:1").startsWith("A square"));
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
  assert.deepEqual(storyFrame("16:9"), { aspect: "16:9", W: 1280, H: 720 });
  assert.deepEqual(storyFrame("1:1"), { aspect: "1:1", W: 1080, H: 1080 });
  assert.deepEqual(storyFrame("4:5"), { aspect: "9:16", W: 720, H: 1280 });
  assert.deepEqual(storyFrame(null), { aspect: "9:16", W: 720, H: 1280 });
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
