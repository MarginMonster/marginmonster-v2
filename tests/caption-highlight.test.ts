/* THE HIGHLIGHT CAPTION STYLE — big words, and the one being said lights up.
 *
 * Every short-video tool leads with this look. Ours already had the hard part: every caption word carries
 * the time it is said. drawtext cannot colour one word of a string, so this style is an .ass file for the
 * subtitle renderer (narrated-core → highlightAss), sized and placed to sit exactly where the Bold card
 * sits — and a renderer that fails falls back to the same cards drawn as Bold, never to no captions.
 *
 * These pin the cards' word pieces, the file, the fallback and the option in the Movie Maker; the last
 * test really renders one with ffmpeg and looks at the colour of the lit word. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ASS_EM, ASS_FOOT, CAPTION_STYLES, HIGHLIGHT_RGB, boldCards, captionFilters, captionStyleOf, highlightAss, sceneWindows, scriptWordTimes, type Card, type WordT,
} from "../app/lib/narrated-core.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

const LINES = ["A lighthouse keeper heard a ship's bell on a night with no ships.", "Her name was Wren Oakhollow, and her only company was a cat named Biscuit."];
/** every word heard, 0.3 s apart, half a second between the two lines */
function heard(): { words: WordT[]; total: number } {
  const words: WordT[] = [];
  let t = 0.2;
  for (const l of LINES) { for (const w of l.split(" ")) { words.push({ word: w, start: t, end: t + 0.24 }); t += 0.3; } t += 0.5; }
  return { words, total: t };
}
const cardsOf = (): Card[] => { const h = heard(); return boldCards(scriptWordTimes(LINES, h.words, sceneWindows(LINES, h.words, h.total)), "en"); };
const events = (ass: string) => ass.split("\n").filter((l) => l.startsWith("Dialogue: ")).map((l) => {
  const f = l.slice("Dialogue: ".length).split(",");
  return { start: f[1], end: f[2], marginV: Number(f[7]), text: f.slice(9).join(",") };
});
const secs = (t: string) => { const [h, m, s] = t.split(":"); return Number(h) * 3600 + Number(m) * 60 + Number(s); };

test("it is one of the caption styles, and its plain look is Bold", () => {
  assert.deepEqual(CAPTION_STYLES.map((c) => c.key), ["bold", "highlight", "subtitles", "off"]);
  assert.equal(captionStyleOf("highlight"), "highlight");
  assert.equal(captionStyleOf("karaoke", "bold"), "bold", "nothing else is a style");
  const cards = cardsOf();
  assert.deepEqual(captionFilters(cards, "highlight", "/f/Poppins-Bold.ttf", 720, 1280), captionFilters(cards, "bold", "/f/Poppins-Bold.ttf", 720, 1280), "drawn by drawtext it IS the Bold card");
});

test("every Bold card carries its words: pieces that join back into the card, each with its own time", () => {
  const cards = cardsOf();
  assert.ok(cards.length >= 8);
  for (const c of cards) {
    assert.ok(c.words && c.words.length >= 1, c.text);
    assert.equal(c.words!.map((w) => w.text).join(""), c.text, "the pieces ARE the card");
    for (let k = 1; k < c.words!.length; k++) assert.ok(c.words![k].t0 >= c.words![k - 1].t0, "in the order they are said");
    assert.ok(c.words![0].t0 >= c.t0 - 1e-6 && c.words![c.words!.length - 1].t0 <= c.t1 + 1e-6);
  }
  const name = cards.find((c) => c.text === "WREN OAKHOLLOW")!;
  assert.deepEqual(name.words!.map((w) => w.text), ["WREN", " OAKHOLLOW"], "the comma the card does not draw is in no piece");
});

test("the file: one line per word, on screen while that word is said, with that word lit", () => {
  const cards = cardsOf();
  const ass = highlightAss(cards, "Poppins", 720, 1280);
  assert.ok(ass.startsWith("[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1280\n"));
  assert.ok(ass.includes("\nStyle: Cap,Poppins,54,&H00FFFFFF&,&H00FFFFFF&,&H00000000&,&H00000000&,-1,0,0,0,100,100,0,0,1,8,0,2,20,20,0,1\n"), "white, bold, an 8 px black outline, set from the foot of the frame");
  const ev = events(ass);
  assert.equal(ev.length, cards.reduce((n, c) => n + c.words!.length, 0), "a line for every word");
  const lit = `{\\c&H00${HIGHLIGHT_RGB.slice(4, 6)}${HIGHLIGHT_RGB.slice(2, 4)}${HIGHLIGHT_RGB.slice(0, 2)}&}`;
  const white = "{\\c&H00FFFFFF&}";
  let i = 0;
  for (const c of cards) {
    c.words!.forEach((w, k) => {
      const e = ev[i++];
      const strip = e.text.replace(/\{[^}]*\}/g, "");
      assert.equal(strip, c.text, "every line shows the whole card");
      const m = /\{\\c&H00[0-9A-F]{6}&\}([^{]*)\{\\c&H00FFFFFF&\}/.exec(e.text)!;
      assert.equal(m[1], w.text.trim(), `the word being said is the lit one: ${e.text}`);
      assert.ok(e.text.includes(lit) && e.text.includes(white));
      // on screen from when the word starts (the first from when the card does) until the next word starts
      const a = secs(e.start), b = secs(e.end);
      assert.ok(Math.abs(a - (k === 0 ? c.t0 : w.t0)) < 0.011, `${e.text} starts ${e.start}`);
      assert.ok(Math.abs(b - (k + 1 < c.words!.length ? c.words![k + 1].t0 : c.t1)) < 0.011, `${e.text} ends ${e.end}`);
      assert.ok(b > a);
    });
  }
  // no two lines of one card overlap, none leaves a gap inside its card
  for (let k = 1; k < ev.length; k++) assert.ok(secs(ev[k].start) >= secs(ev[k - 1].end) - 1e-6);
});

test("it sits exactly where the Bold card sits: the same letter height and the same foot", () => {
  for (const [W, H] of [[720, 1280], [1280, 720], [720, 720]]) {
    const u = Math.min(W, H) / 720;
    const cards: Card[] = [{ text: "WE SHOULD OPEN", t0: 0, t1: 1, words: [{ text: "WE", t0: 0, t1: 0.3 }, { text: " SHOULD", t0: 0.3, t1: 0.6 }, { text: " OPEN", t0: 0.6, t1: 1 }] }, { text: "UNCHARACTERISTICALLY QUIET", t0: 1, t1: 2 }];
    const bold = captionFilters(cards, "bold", "/f/Poppins-Bold.ttf", W, H);
    const ev = events(highlightAss(cards, "Poppins", W, H));
    assert.equal(ev.length, 4, "three words lit in turn, and a card with no word times shown unlit");
    for (const [card, e] of [[0, ev[0]], [1, ev[3]]] as Array<[number, (typeof ev)[number]]>) {
      const em = Number(/fontsize=(\d+)/.exec(bold[card])![1]);
      assert.equal(Number(/\{\\fs(\d+)\}/.exec(e.text)![1]), Math.round(em * ASS_EM), `${W}x${H}: the letter height`);
      const top = W > H ? H - Math.round(150 * u) : H - Math.round(H * 0.28);
      assert.equal(e.marginV, H - top - Math.round(em * ASS_FOOT), `${W}x${H}: the foot`);
    }
    assert.ok(!/\{\\c/.test(ev[3].text), "nothing is lit on a card without word times");
  }
  assert.equal(highlightAss([], "Poppins", 720, 1280), "");
  assert.equal(highlightAss([{ text: "", t0: 0, t1: 1 }], "Poppins", 720, 1280), "");
  // a script without spaces is shown unlit (its renderer size is not measured): never a wrong-sized guess
  const zh = highlightAss([{ text: "人们都说", t0: 0, t1: 1, words: [{ text: "人们", t0: 0, t1: 0.5 }, { text: "都说", t0: 0.5, t1: 1 }] }], "Noto Sans SC", 720, 1280);
  assert.equal(events(zh).length, 1);
});

test("nothing in a card can break the file", () => {
  const ass = highlightAss([{ text: "A {\\b1}TRICK\\N", t0: 0, t1: 1, words: [{ text: "A", t0: 0, t1: 0.5 }, { text: " {\\b1}TRICK\\N", t0: 0.5, t1: 1 }] }], "Pop,pins\nX", 720, 1280);
  const ev = events(ass);
  for (const e of ev) assert.ok(!/\\b1|\\N/.test(e.text.replace(/\{\\c&H00[0-9A-F]{6}&\}|\{\\fs\d+\}/g, "")), e.text);
  assert.ok(ass.includes("Style: Cap,Pop pins X,54,"), "nor a font name");
});

test("the pipelines try it first and fall back to the same cards drawn as Bold — never to none", () => {
  const burn = read("app", "lib", "caption-burn.server.ts");
  assert.ok(burn.includes("const plain = captionFilters(cards, style, fontFile, W, H);"));
  assert.ok(burn.includes("if (style === \"highlight\" && plain.length && !cards.some((c) => hasWide(c.text))) {"));
  assert.ok(burn.includes("styled = [`ass=filename='${inFilter(file)}':fontsdir='${inFilter(path.dirname(fontFile))}'`];"), "the renderer is handed the file and the folder its font is in");
  assert.ok(burn.includes("export const fontFamilyOf = (fontFile: string): string => (/NotoSansSC/i.test(path.basename(fontFile)) ? \"Noto Sans SC\" : /NotoNastaliqUrdu/i.test(path.basename(fontFile)) ? \"Noto Nastaliq Urdu\" : \"Poppins\");"));
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("const cards: Card[] = style === \"bold\" || style === \"highlight\"\n    ? boldCards(timed, normalizeContentLang(lang))"));
  assert.ok(nar.includes("const cap = captionGraph(o.cards, o.style, o.fontFile, o.W, o.H);"));
  assert.ok(nar.includes("const run = await runFfmpeg(build(true, true, true, true));"), "the styled look first");
  assert.ok(nar.indexOf("build(true, true, true, true)") < nar.indexOf("for (const [withCaps, kb, mus] of rungs) {"), "then the rungs it always had: plain captions, no captions, plain slideshow");
  assert.ok(nar.includes("} finally { cap.cleanup(); }"));
  const film = read("app", "lib", "film-captions.server.ts");
  assert.ok(film.includes("let run = cap.styled ? await burn(cap.styled) : null;"));
  assert.ok(film.includes("if (!run || !drawn(run)) run = await burn(filters);"));
  assert.ok(film.includes("} finally { cap.cleanup(); }"));
});

test("the Movie Maker offers it, shows what it looks like, and remembers it", () => {
  const f = read("app", "routes", "web.film.tsx");
  assert.ok(f.includes("captions === \"highlight\" ? \"the spoken word lights up\""));
  assert.ok(f.includes("{c.key === \"highlight\" && (() => { const w = t(\"the door opened\").split(\" \");"));
  assert.ok(f.includes(".mm-cap-demo .bold .lit{color:#FFD84A;font-weight:inherit;}"));
  assert.equal(HIGHLIGHT_RGB, "FFD84A", "the demo's colour is the caption's");
  assert.ok(read("app", "lib", "story-edit.ts").includes("captions === \"off\" || captions === \"subtitles\" || captions === \"highlight\" ? captions : \"bold\""), "an edited story keeps it");
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Highlight", "Big words — the one being said lights up", "the spoken word lights up"]) assert.equal(dict.split(`${JSON.stringify(k)}:`).length - 1, 5, k);
});

// ---- the renderer really draws it ------------------------------------------------------------------------
const ffmpegOk = spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" });
const hasAss = ffmpegOk.status === 0 && / ass +V->V/.test(ffmpegOk.stdout);
const FONT_DIR = path.join(process.cwd(), "public", "fonts");

test("ffmpeg's subtitle renderer draws it: the lit word is the highlight colour, the others white", { skip: !hasAss || !fs.existsSync(path.join(FONT_DIR, "Poppins-Bold.ttf")) }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-"));
  try {
    const W = 720, H = 1280;
    const cards: Card[] = [{ text: "WWWWWW MMMMMM", t0: 0, t1: 2, words: [{ text: "WWWWWW", t0: 0, t1: 1 }, { text: " MMMMMM", t0: 1, t1: 2 }] }];
    const file = path.join(dir, "c.ass");
    fs.writeFileSync(file, highlightAss(cards, "Poppins", W, H));
    const esc = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:");
    // the average colour of the left half and of the right half of the caption band, while each word is said
    const band = (t: number, x: number) => {
      const r = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `color=c=black:s=${W}x${H}:d=2`, "-vf", `ass=filename='${esc(file)}':fontsdir='${esc(FONT_DIR)}',crop=200:40:${x}:${H - Math.round(H * 0.28) + 8},scale=1:1`, "-ss", String(t), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer" });
      assert.equal(r.status, 0, r.stderr.toString().slice(-300));
      return [...r.stdout.subarray(0, 3)];
    };
    const warm = ([r, , b]: number[]) => r - b; // the highlight is yellow: much more red than blue; white and black are neither
    const left0 = band(0.5, 110), right0 = band(0.5, 420), left1 = band(1.5, 110), right1 = band(1.5, 420);
    assert.ok(warm(left0) > 25 && warm(right0) < 12, `first word lit: left ${left0} right ${right0}`);
    assert.ok(warm(left1) < 12 && warm(right1) > 25, `then the second: left ${left1} right ${right1}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
