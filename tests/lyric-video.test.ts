/* THE LYRIC VIDEO (app/lib/lyric-video.ts) — a song in; its words big, timed and alive over pictures cut on its beat.
 *
 * The owner, 2026-11-24: "Add to music section "Lyric Video creator" … simple active exciting lyrics … with scene cuts
 * and stills … input link and it converts to a Lyric Video" — and "Allow copyrighted dog, fuck it, it's a lyric video".
 *
 * Every decision is pure and pinned here: the words and their lines, the beat (against a drum track whose beats are
 * KNOWN), the scenes, the art direction, the four looks' lyrics files (every word measured inside the frame, on
 * time), and the ffmpeg graphs. The listening, drawing and encoding (lyric-video.server.ts), the job, the route and
 * the page import the database, so they are pinned by their source text. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BIG_GAP_EM, LINK_FETCHES_A_DAY, LINK_MAX_SECONDS, LINK_MSG, LINK_TIMEOUT_MS, LYRIC_LOOKS, LYRIC_MAX_SECONDS, NO_GRID, PULSE,
  RIGHTS_ASK, RIGHTS_LINE, RIGHTS_NOTE, STILLS_MAX, STILLS_MIN, beatGrid, bigWord, chooseLines, chunkGraph,
  directionBrief, fallbackDirection, gridFromBeats, isSongLink, lineWindows, linesFromHeard, linesFromTimed, linkFailure, linkTitleOf,
  lowOnsets, lyricAccent, lyricAss, lyricEtaMinutes, lyricFrame, lyricLookOf, lyricShapeOf, motionFilter, pagesOf, parseDirection,
  pastedLines, pictureWords, planOk, renderChunks, scenePlan, scrimAlpha, shotFrames, shotPulses, songFileOf, songRightsOf,
  songTitleOf, stillPrompt, voicedWords, youTubeId, youTubeWatch, ytDlpArgs,
  type BeatGrid, type LyricLine, type LyricLook,
} from "../app/lib/lyric-video.ts";
import { readFontMetrics, textEms } from "../app/lib/font-metrics.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const metrics = readFontMetrics(new Uint8Array(fs.readFileSync(path.join(root, "public", "fonts", "Poppins-Bold.ttf"))))!;
const w = (word: string, start: number, end: number) => ({ word, start, end });
/** a fake sung line: its words a third of a second apart */
const sung = (text: string, t0: number, step = 0.32): LyricLine => {
  const ws = text.split(" ");
  return { text, t0, t1: t0 + ws.length * step, words: ws.map((x, k) => ({ text: x, t0: t0 + k * step, t1: t0 + k * step + step * 0.85 })) };
};
const LOOKS: LyricLook[] = ["bold", "karaoke", "neon", "minimal"];

/* ---------------------------------------------------------------- the choices */

test("four looks, two shapes, the app's own frame sizes — and anything unknown is the default", () => {
  assert.deepEqual(LYRIC_LOOKS.map((l) => l.key), LOOKS);
  for (const l of LYRIC_LOOKS) assert.ok(l.label && l.blurb.length <= 36, l.key);
  assert.equal(lyricLookOf("neon"), "neon");
  assert.equal(lyricLookOf("<script>"), "bold");
  assert.equal(lyricShapeOf("16:9"), "16:9");
  assert.equal(lyricShapeOf("1:1"), "9:16");
  assert.deepEqual(lyricFrame("9:16"), { W: 720, H: 1280 });
  assert.deepEqual(lyricFrame("16:9"), { W: 1280, H: 720 });
  assert.equal(LYRIC_MAX_SECONDS, 360);
  assert.ok(STILLS_MIN === 6 && STILLS_MAX === 14);
});

test("the song's name from its file, our own uploads only, and a link is told apart from words", () => {
  assert.equal(songTitleOf("03 - Night Drive (Official Audio).mp3"), "Night Drive");
  assert.equal(songTitleOf("C:\\Music\\my_song_final [Lyric Video].wav"), "my song final");
  assert.equal(songTitleOf("Song - copy (2).m4a"), "Song");
  assert.equal(songTitleOf(""), "");
  assert.equal(songFileOf("https://easymodeapp.com/renders/mvsong-0123456789abcdef0123.mp3"), "mvsong-0123456789abcdef0123.mp3");
  assert.equal(songFileOf("/renders/mvsong-0123456789abcdef0123.wav"), "mvsong-0123456789abcdef0123.wav");
  for (const bad of ["/renders/../.env", "/renders/img-123.jpg", "https://evil.example/renders/mvsong-zzz.mp3", "/uploads/mvsong-0123456789.mp3", "not a url"]) assert.equal(songFileOf(bad), null, bad);
  assert.equal(isSongLink("https://www.youtube.com/watch?v=abc"), true);
  assert.equal(isSongLink("www.example.com/song"), true);
  assert.equal(isSongLink("late night city lights"), false);
});

test("the time it takes grows with the song, never under three minutes", () => {
  assert.equal(lyricEtaMinutes(20), 3);
  assert.ok(lyricEtaMinutes(240) > lyricEtaMinutes(60));
  assert.equal(lyricEtaMinutes(10_000), lyricEtaMinutes(LYRIC_MAX_SECONDS), "a song is made only this long");
  assert.equal(lyricEtaMinutes(NaN), lyricEtaMinutes(180));
});

/* ---------------------------------------------------------------- 1. the words */

test("pasted lyrics: the headings a lyrics page carries go, a repeated line is sung that many times, a backing vocal stays", () => {
  const text = ["[Verse 1]", "Test line one here", "", "Chorus:", "Test chorus line (x2)", "(Pre-Chorus)", "(oh, oh)", "Verse 2", "last test line x3", "  ", "---"].join("\n");
  assert.deepEqual(pastedLines(text), ["Test line one here", "Test chorus line", "Test chorus line", "(oh, oh)", "last test line", "last test line", "last test line"]);
  assert.deepEqual(pastedLines(""), []);
  assert.equal(pastedLines("a\n".repeat(1000)).length, 400, "a paste has a ceiling");
});

test("pasted lyrics laid over what was heard: their own spelling, the heard time; a paste that is not this song is not used", () => {
  // ("light" is one letter from the pasted "lights": the same word, sung)
  const heard = [w("neon", 1.0, 1.3), w("light", 1.4, 1.8), w("on", 1.9, 2.0), w("the", 2.05, 2.15), w("boulevard", 2.2, 2.9), w("we", 4.0, 4.2), w("were", 4.3, 4.5), w("young", 4.6, 5.0)];
  const r = chooseLines({ pasted: ["Neon lights on the boulevard", "We were young"], heard });
  assert.equal(r.from, "pasted");
  assert.deepEqual(r.lines.map((l) => l.text), ["Neon lights on the boulevard", "We were young"]);
  assert.equal(r.lines[0].words[1].text, "lights", "the paste's spelling");
  assert.equal(r.lines[0].words[1].t0, 1.4, "the heard time");
  const other = chooseLines({ pasted: ["Completely different words entirely", "Nothing alike at all here"], heard });
  assert.equal(other.from, "heard");
  assert.ok(other.lines.length >= 1);
  assert.equal(chooseLines({ pasted: [], heard }).from, "heard");
});

test("what was heard, as lines: a new line at each breath and sentence; a long phrase cut evenly — no word left alone", () => {
  const heard = [
    // a phrase of 12 words with no pause: too long for one screen
    ...("this is a test phrase that keeps on going for quite a while".split(" ").map((x, k) => w(x, 1 + k * 0.3, 1.25 + k * 0.3))),
    // a pause, then a sentence that ends
    w("short", 6, 6.3), w("one.", 6.4, 6.7),
    w("next", 6.9, 7.1), w("thing", 7.2, 7.5),
  ];
  const lines = linesFromHeard(heard);
  const texts = lines.map((l) => l.text);
  assert.equal(texts[texts.length - 2], "short one.", "a sentence ends a line");
  assert.equal(texts[texts.length - 1], "next thing");
  const long = lines.slice(0, lines.length - 2);
  assert.equal(long.length, 2, "twelve words: two lines, not three");
  assert.ok(long.every((l) => l.words.length >= 4), "even, nothing orphaned");
  assert.ok(!/ (a|the|that|on|for)$/.test(long[0].text), `a line does not end leaning on the next: ${long[0].text}`);
  // timed words where `last` closes each line (lyricWordTimes' shape)
  const timed = linesFromTimed([{ word: "one", start: 1, end: 1.2 }, { word: "two", start: 1.3, end: 1.5, last: true }, { word: "three", start: 3, end: 3.4, last: true }]);
  assert.deepEqual(timed.map((l) => l.text), ["one two", "three"]);
});

test("a word heard where the vocal is silent was not sung there", () => {
  const heard = [w("hello", 1, 1.4), w("thank", 9, 9.3), w("you", 9.3, 9.6), w("world", 2, 2.5)];
  assert.deepEqual(voicedWords(heard, [[0.8, 3]]).map((x) => x.word), ["hello", "world"]);
  assert.equal(voicedWords(heard, []).length, 4, "nothing to go by: all kept");
});

/* ---------------------------------------------------------------- 2. the beat — against beats we KNOW */

/** A drum track: a kick on every bar's first beat (loud) and third (softer), a snare on two and four, hats on the
 *  eighths, a faint hiss under it all. Returns the samples and the true beat times. */
function drums(seconds: number, bpm: number, sr = 11025, first = 0.3): { pcm: Float32Array; beats: number[] } {
  const pcm = new Float32Array(Math.round(seconds * sr));
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff) * 2 - 1; };
  const beat = 60 / bpm;
  const hit = (t: number, kind: "kick" | "kick2" | "snare" | "hat") => {
    const i0 = Math.round(t * sr);
    const len = Math.round((kind === "hat" ? 0.04 : kind === "snare" ? 0.12 : 0.18) * sr);
    for (let k = 0; k < len && i0 + k < pcm.length; k++) {
      const tt = k / sr, env = Math.exp(-k / (len / 5));
      const v = kind === "kick" || kind === "kick2" ? Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-tt * 30)) * tt) * (kind === "kick" ? 0.9 : 0.55)
        : kind === "snare" ? rnd() * 0.45 + Math.sin(2 * Math.PI * 190 * tt) * 0.2 : rnd() * 0.12;
      pcm[i0 + k] += v * env;
    }
  };
  const beats: number[] = [];
  for (let k = 0; first + k * beat < seconds - 0.3; k++) {
    const t = first + k * beat;
    beats.push(t);
    hit(t, k % 4 === 0 ? "kick" : k % 4 === 2 ? "kick2" : "snare");
    hit(t, "hat"); hit(t + beat / 2, "hat");
  }
  for (let i = 0; i < pcm.length; i++) pcm[i] += rnd() * 0.002;
  return { pcm, beats };
}

test("the beat of a drum track: its tempo, every beat within 30 ms, and the bars on the loud kick", () => {
  for (const bpm of [96, 120, 140]) {
    const { pcm, beats } = drums(24, bpm);
    const g = beatGrid(pcm, 11025, []);
    assert.ok(g.steady, `${bpm}: a pulse is found`);
    assert.ok(Math.abs(g.bpm - bpm) / bpm < 0.015, `${bpm}: found ${g.bpm.toFixed(1)}`);
    const later = beats.filter((t) => t > 1.5 && t < 22);
    const off = later.map((t) => Math.min(...g.beats.map((b) => Math.abs(b - t))));
    assert.ok(off.every((d) => d < 0.03), `${bpm}: worst beat ${(Math.max(...off) * 1000).toFixed(0)} ms off`);
    // the bars: the grid's bar beats are the true first beats of the bars (the loud kicks)
    const downs = beats.filter((_, k) => k % 4 === 0);
    const onDown = g.bars.filter((b) => downs.some((d) => Math.abs(d - b) < 0.04)).length;
    assert.ok(onDown / g.bars.length > 0.9, `${bpm}: ${onDown}/${g.bars.length} bars on the downbeat`);
  }
});

test("no steady pulse (a few beats, or none) is no grid — the scenes are then cut on the lines", () => {
  assert.deepEqual(gridFromBeats([1, 2, 3], () => 1), NO_GRID);
  assert.equal(beatGrid(new Float32Array(11025 * 3), 11025).steady, false, "three seconds of silence");
  // a near tie between beats one and three is broken by where the sung lines start
  const beats = Array.from({ length: 32 }, (_, k) => 0.5 + k * 0.5);
  const tie = gridFromBeats(beats, (t) => (Math.round((t - 0.5) / 0.5) % 2 === 0 ? 1 : 0.1), [0.5 + 2 * 0.5, 0.5 + 10 * 0.5, 0.5 + 18 * 0.5]);
  assert.equal(Math.round((tie.bars[0] - 0.5) / 0.5) % 4, 2, "the lines start on the third beat: that is the bar");
  const lo = lowOnsets(new Float32Array(11025), 11025);
  assert.ok(lo.fps > 80 && lo.env.length > 0);
});

/* ---------------------------------------------------------------- 3. the scenes */

const steady = (T: number, bpm = 120): BeatGrid => {
  const beat = 60 / bpm;
  const beats = Array.from({ length: Math.floor(T / beat) }, (_, k) => +(0.1 + k * beat).toFixed(3));
  return { beats, bars: beats.filter((_, k) => k % 4 === 0), bpm, beat, steady: true };
};

test("six to fourteen pictures, every cut on a beat, the song covered end to end", () => {
  for (const T of [20, 30, 60, 210, 360]) {
    const g = steady(T);
    const lines = Array.from({ length: Math.floor(T / 4) }, (_, k) => sung("a test line here", 1 + k * 4));
    const p = scenePlan({ duration: T, grid: g, lines });
    assert.ok(p.sections.length >= STILLS_MIN && p.sections.length <= STILLS_MAX, `${T}s: ${p.sections.length} pictures`);
    assert.equal(p.sections[0].t0, 0);
    assert.equal(p.sections[p.sections.length - 1].t1, T);
    for (let i = 1; i < p.sections.length; i++) {
      assert.equal(p.sections[i].t0, p.sections[i - 1].t1, "no gap, no overlap");
      assert.ok(g.beats.some((b) => Math.abs(b - p.sections[i].t0) < 1e-6), `${T}s: cut ${p.sections[i].t0} is on a beat`);
    }
    // a shot is at most four bars (a long stretch is cut again on its bars, the same picture re-framed)
    for (const s of p.shots) assert.ok(s.t1 - s.t0 <= 4 * 4 * g.beat + 0.06, `${T}s: shot ${s.t0}–${s.t1}`);
    for (const s of p.shots.slice(1)) assert.ok(g.beats.some((b) => Math.abs(b - s.t0) < 1e-6), `${T}s: shot cut ${s.t0} on a beat`);
    assert.ok(planOk(p));
    assert.ok(p.sections.every((s) => typeof s.text === "string"));
  }
});

test("every cut is on a beat at any tempo — even where the even lengths leave no beat in reach", () => {
  // (the pasted-lyrics test song, 2026-11-24: 20 s at 113.6 a minute — the last cut's window held no beat, and the
  //  cut fell 0.19 s off one)
  for (const bpm of [84, 96, 113.6, 128.5, 145.9, 172]) for (const T of [12, 20, 30, 47]) {
    const g = steady(T, bpm);
    const lines = Array.from({ length: Math.floor(T / 3.7) }, (_, k) => sung("a test line here", 0.6 + k * 3.7));
    const p = scenePlan({ duration: T, grid: g, lines });
    for (const s of p.shots.slice(1)) assert.ok(g.beats.some((b) => Math.abs(b - s.t0) < 1e-6), `${bpm} bpm, ${T}s: cut ${s.t0} is on a beat`);
    for (const s of p.shots) assert.ok(s.t1 - s.t0 >= 1 - 1e-6, `${bpm} bpm, ${T}s: a picture is up a second at least`);
  }
});

test("a cut goes where a sung line starts, when one is near — the picture changes as the new line comes in", () => {
  const g = steady(30);
  // lines that start on the beat at 5.1, 10.1, 15.1, 20.1, 25.1 (beats at 0.1 + k/2)
  const lines = [5.1, 10.1, 15.1, 20.1, 25.1].map((t) => sung("one two three four", t));
  const p = scenePlan({ duration: 30, grid: g, lines });
  const cuts = p.sections.slice(1).map((s) => s.t0);
  const onLines = cuts.filter((c) => lines.some((l) => Math.abs(l.t0 - c) < 0.01)).length;
  assert.ok(onLines >= 4, `cuts ${cuts.join(", ")}: ${onLines} on a line's start`);
});

test("with no beat, the cuts follow the lines; the same picture again is punched in, so the cut is seen", () => {
  const lines = Array.from({ length: 8 }, (_, k) => sung("words for the test", 2 + k * 3.7));
  const p = scenePlan({ duration: 32, grid: NO_GRID, lines });
  assert.ok(p.sections.length >= STILLS_MIN);
  assert.deepEqual(p.grid.beats, []);
  const long = scenePlan({ duration: 300, grid: steady(300), lines: [] });
  const again = long.shots.filter((s, i) => i && long.shots[i - 1].pic === s.pic);
  assert.ok(again.length > 0, "a long song re-frames its pictures");
  for (const s of again) assert.ok(s.move.z0 >= 1.2, "a re-frame starts punched in");
  assert.equal(planOk({ sections: [], shots: [] }), false);
  assert.equal(planOk(null), false);
});

/* ---------------------------------------------------------------- 4. the look */

test("the writer's brief: the words stretch by stretch, one picture each, and no text in any picture", () => {
  const b = directionBrief({ title: "Test Song", sections: ["first test words", "", "third test words"], look: "neon", shape: "9:16" });
  assert.ok(b.includes("1. first test words") && b.includes("2. (no words here — music only)") && b.includes("3. third test words"));
  assert.ok(b.includes("exactly 3 descriptions"));
  assert.ok(/no text, letters, numbers, signs, logos/.test(b));
  assert.ok(/No real, famous or recognisable people/.test(b));
  assert.ok(/neon/i.test(b) && /dark and moody/.test(b), "the look's needs");
  assert.ok(b.includes("tall (9:16)"));
});

test("the writer's answer is read carefully; a broken one is no direction; a missing picture is filled", () => {
  const sections = ["one", "two", "three", "four"];
  const good = parseDirection(JSON.stringify({ style: "Grainy 1970s film photograph, warm tungsten light", palette: ["#112233", "nope", "#AABBCC", "#FF8800"], pictures: ["A lone car on a desert road at dusk", "A neon diner seen through rain", "Hands on a steering wheel, close"] }), { sections, look: "bold" });
  assert.ok(good);
  assert.equal(good.from, "writer");
  assert.equal(good.pictures.length, 4, "the fourth filled from the fallback");
  assert.deepEqual(good.palette, ["#112233", "#AABBCC", "#FF8800"]);
  assert.equal(parseDirection("not json", { sections, look: "bold" }), null);
  assert.equal(parseDirection(JSON.stringify({ style: "x", pictures: ["a", "b", "c", "d"] }), { sections, look: "bold" }), null, "no style");
  assert.equal(parseDirection(JSON.stringify({ style: "A long enough style here", pictures: ["Only one picture given here"] }), { sections, look: "bold" }), null, "under half the pictures");
});

test("with no writer, each picture is made of its stretch's own words — named, never quoted (quoted words are drawn as lettering)", () => {
  const d = fallbackDirection({ sections: ["the neon boulevard burns tonight", "", "oh oh yeah"], look: "neon" });
  assert.equal(d.from, "fallback");
  assert.equal(d.pictures.length, 3);
  assert.ok(d.pictures[0].includes("boulevard") && !/["“”]/.test(d.pictures[0]));
  assert.ok(/atmospheric/.test(d.pictures[1]) && /atmospheric/.test(d.pictures[2]), "music only, or nothing but sounds");
  assert.deepEqual(pictureWords("Oh oh, the night and the night again, tonight"), ["tonight", "night", "again"], "longest first, each once, the little words gone");
  assert.ok(!/neon/i.test(d.style) || !/\bsigns?\b/i.test(d.style), "lit by light, not by signs (signs come with letters)");
});

test("a picture's prompt: the one style, its own picture, the frame — and absolutely no text; a refused one asks for less", () => {
  const d = fallbackDirection({ sections: ["fire and rain tonight", "open road"], look: "bold" });
  const p = stillPrompt(d, 0, "bold", "9:16");
  assert.ok(p.startsWith(d.style.replace(/[.\s]+$/, "")) && p.includes("fire") && p.includes("tall vertical"));
  assert.ok(/Absolutely no text: no letters, words, numbers, captions, signs, logos or watermarks/.test(p));
  assert.ok(stillPrompt(d, 1, "bold", "16:9").includes("wide landscape"));
  assert.ok(!stillPrompt(d, 0, "bold", "9:16", true).includes("fire"), "the plain ask leaves its words out");
  assert.ok(/abstract composition/.test(stillPrompt(d, 0, "bold", "9:16", "abstract")));
});

test("the colour a sung word lights up in reads over a dark picture", () => {
  const lum = (hex: string) => { const v = parseInt(hex, 16); const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => { const s = x / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const dark = lyricAccent({ style: "x", palette: ["#000000", "#111111", "#3A0CA3"], pictures: [], from: "writer" }, "bold");
  assert.ok(lum(dark) >= 0.4, `lifted: ${dark}`);
  assert.equal(lyricAccent({ style: "x", palette: ["#808080"], pictures: [], from: "writer" }, "neon"), "3DF5FF", "a grey is no colour: the look's own");
  assert.equal(lyricAccent({ style: "x", palette: ["bad"], pictures: [], from: "writer" }, "bold"), "FFD23F");
});

/* ---------------------------------------------------------------- 5. the lyrics file */

const LINES: LyricLine[] = [
  sung("test line one for the frame", 4),
  sung("a much longer test line that keeps on going past where any phone would end", 7.5, 0.25),
  sung("short", 12),
  sung("I", 13.5),
  sung("WWWWWWWW MMMMMMMM wide test letters", 15),
  sung("the second test verse, with a comma, and more after it.", 18, 0.3),
];
const assOf = (look: LyricLook, shape: "9:16" | "16:9" = "9:16", title = "Test Title Card") => {
  const { W, H } = lyricFrame(shape);
  return lyricAss({ look, lines: LINES, W, H, metrics, family: "Poppins", accent: "FFD23F", bars: [4, 6, 8, 10, 12, 14, 16, 18, 20, 22], cuts: [6, 12, 18], title, duration: 24 });
};
const dialogues = (ass: string) => ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
const sec = (t: string) => { const [h, m, s] = t.split(":"); return +h * 3600 + +m * 60 + +s; };

test("BOLD and NEON: every word is placed by itself — measured, inside the frame, even at the top of its slam", () => {
  for (const shape of ["9:16", "16:9"] as const) for (const look of ["bold", "neon"] as const) {
    const { W } = lyricFrame(shape);
    const words = dialogues(assOf(look, shape)).filter((l) => l.startsWith("Dialogue: 2,"));
    assert.ok(words.length >= LINES.reduce((n, l) => n + l.words.length, 0), `${look} ${shape}: a word an event`);
    for (const l of words) {
      const pos = /\\pos\(([\d.]+),([\d.]+)\)/.exec(l)!, fs_ = /\\fs([\d.]+)/.exec(l)!, bord = /\\bord(\d+)/.exec(l)!, sp = /\\fsp(\d+)/.exec(l);
      const pop = /\\fscx(\d+)/.exec(l);
      const text = l.slice(l.lastIndexOf("}") + 1);
      const size = +fs_[1];
      const width = (textEms(metrics, text) * size) / metrics.box + (sp ? +sp[1] * Array.from(text).length : 0);
      const half = (width / 2 + +bord[1]) * (pop ? +pop[1] / 100 : 1);
      assert.ok(+pos[1] - half >= -0.5 && +pos[1] + half <= W + 0.5, `${look} ${shape}: "${text}" from ${(+pos[1] - half).toFixed(1)} to ${(+pos[1] + half).toFixed(1)} of ${W}`);
    }
  }
});

test("KARAOKE and MINIMAL: one or two rows a line, each row measured inside the frame", () => {
  for (const shape of ["9:16", "16:9"] as const) for (const look of ["karaoke", "minimal"] as const) {
    const { W } = lyricFrame(shape);
    for (const l of dialogues(assOf(look, shape)).filter((x) => x.startsWith("Dialogue: 2,") && !x.includes("\\p1"))) {
      const size = +/\\fs([\d.]+)/.exec(l)![1];
      const sp = /\\fsp(\d+)/.exec(l);
      const body = l.slice(l.indexOf("}") + 1).replace(/\{[^}]*\}/g, "");
      const rows = body.split("\\N");
      assert.ok(rows.length <= 2, `${look}: at most two rows`);
      for (const r of rows) {
        const width = (textEms(metrics, r) * size) / metrics.box + (sp ? +sp[1] * Array.from(r).length : 0);
        assert.ok(width <= W * 0.92, `${look} ${shape}: "${r}" is ${width.toFixed(0)} of ${W}`);
      }
    }
  }
});

test("every word comes on screen when it is sung — never more than a quarter second off", () => {
  const all = LINES.flatMap((l) => l.words);
  for (const look of ["bold", "neon"] as const) {
    const ev = dialogues(assOf(look, "9:16", "")).filter((l) => l.startsWith("Dialogue: 2,")).map((l) => sec(l.split(",")[1])).sort((a, b) => a - b);
    // (a word whose line was cut short by the next line can drop out; every one that shows is on time)
    for (const t of ev) assert.ok(all.some((x) => Math.abs(x.t0 - t) <= 0.25), `${look}: an event at ${t} has its word`);
  }
  // karaoke: the fill of each word starts at its sung start (the renderer counts in hundredths)
  const kar = dialogues(assOf("karaoke", "9:16", "")).filter((l) => l.startsWith("Dialogue: 2,") && l.includes("\\kf"));
  const fills: number[] = [];
  for (const l of kar) { let clock = sec(l.split(",")[1]); for (const m of l.matchAll(/\{\\k(f?)(\d+)\}/g)) { if (m[1]) fills.push(clock); clock += +m[2] / 100; } }
  for (const f of fills) assert.ok(all.some((x) => Math.abs(x.t0 - f) <= 0.02), `karaoke fill at ${f}`);
  assert.ok(fills.length >= all.length * 0.9, `${fills.length} fills for ${all.length} words`);
});

test("big words drop the comma or full stop they end on; the title is shown only when the singing starts late", () => {
  for (const look of ["bold", "neon"] as const) {
    for (const l of dialogues(assOf(look)).filter((x) => x.startsWith("Dialogue: 2,"))) assert.ok(!/[.,;:]$/.test(l.slice(l.lastIndexOf("}") + 1)), l);
  }
  assert.equal(bigWord("night."), "night");
  assert.equal(bigWord("why?"), "why?");
  assert.equal(bigWord("..."), "...");
  assert.ok(BIG_GAP_EM > 0.3, "a caps gap wider than the face's own space");
  // lines start at 4 s: room for the title; at 0.3 s: none
  assert.ok(assOf("bold").includes("TEST") && assOf("bold").includes("TITLE"));
  const early = lyricAss({ look: "bold", lines: [sung("early test words", 0.3)], W: 720, H: 1280, metrics, family: "Poppins", accent: "FFD23F", bars: [], cuts: [], title: "Never Shown Title", duration: 10 });
  assert.ok(!early.includes("NEVER"));
});

test("the loud looks flash on a new picture and move on the bar; the quiet ones do not", () => {
  const flashes = (look: LyricLook) => dialogues(assOf(look)).filter((l) => l.includes("\\p1")).length;
  assert.equal(flashes("bold"), 3);
  assert.equal(flashes("neon"), 3);
  assert.equal(flashes("karaoke"), 0);
  assert.equal(flashes("minimal"), 0);
  // Bold's thump stretches UP only (sideways, two neighbours' gap closed: "YOURSHADOW", the first real render)
  const bold = assOf("bold");
  assert.ok(bold.includes("\\fscy112") && !/\\t\(\d+,\d+,\\fscx1\d\d\\fscy1\d\d\)/.test(bold.split("\\t(0,80,")[1] || ""));
  assert.ok(/\\t\(\d+,\d+,\\3a&H00&\)/.test(assOf("neon")), "neon's glow surges on the bar");
  assert.ok(PULSE.bold.bar > PULSE.karaoke.bar && PULSE.minimal.bar === 0);
});

test("nothing in a lyric can write into the renderer's file", () => {
  const bad: LyricLine = sung("{\\pos(0,0)\\fs999}hack test \\N", 3);
  for (const look of LOOKS) {
    const ass = lyricAss({ look, lines: [bad], W: 720, H: 1280, metrics, family: "Poppins", accent: "FFD23F", bars: [], cuts: [], title: "", duration: 8 });
    assert.ok(!ass.includes("\\fs999") && !ass.includes("\\pos(0,0)"), look);
  }
  assert.equal(lyricAss({ look: "bold", lines: [], W: 720, H: 1280, metrics, family: "Poppins", accent: "FFD23F", bars: [], cuts: [], title: "", duration: 8 }), "");
});

test("a line is up from just before its first word until just after its last — never into the next", () => {
  const a = sung("one two", 2), b = sung("three four", 3.2);
  const [x, y] = lineWindows([a, b], 0.12, 1.1, 10);
  assert.ok(x.on <= 2 && x.on >= 1.8 && x.off <= y.on + 1e-9 && y.off <= 10);
  const pages = pagesOf(sung("one two three four five six seven eight nine ten", 0).words, 7);
  assert.equal(pages.length, 2);
  assert.ok(pages.every((p) => p.length >= 4));
});

/* ---------------------------------------------------------------- 6. the cut */

test("the shots' frames add up to the whole video; the encode is in pieces of whole shots", () => {
  const p = scenePlan({ duration: 200, grid: steady(200, 128), lines: [] });
  const fr = shotFrames(p.shots);
  assert.equal(fr.reduce((a, b) => a + b, 0), Math.round(200 * 30));
  const ch = renderChunks(fr);
  assert.equal(ch[0].frame0, 0);
  for (let i = 1; i < ch.length; i++) { assert.equal(ch[i].from, ch[i - 1].to + 1); assert.equal(ch[i].frame0, ch[i - 1].frame0 + ch[i - 1].frames); }
  assert.ok(ch.every((c) => c.frames <= 45 * 30 || c.from === c.to));
  assert.equal(ch.reduce((a, c) => a + c.frames, 0), fr.reduce((a, b) => a + b, 0));
});

test("a picture moves slowly from one framing to the next, is nudged on the beat in the loud looks, and its bars are cropped", () => {
  const g = steady(20);
  const p = scenePlan({ duration: 20, grid: g, lines: [] });
  const fr = shotFrames(p.shots);
  const pulses = shotPulses(p.shots[0], fr[0], g, "bold");
  assert.ok(pulses.length > 0 && pulses.every((x) => x.f >= 2 && x.f <= fr[0] - 3));
  assert.deepEqual(shotPulses(p.shots[0], fr[0], g, "minimal"), []);
  const f = motionFilter({ input: "[0:v]", out: "[s0]", frames: 150, W: 720, H: 1280, move: p.shots[0].move, pulses, crop: { w: 768, h: 1200, x: 0, y: 72 } });
  assert.ok(f.startsWith("[0:v]crop=768:1200:0:72,scale=1440:2560:force_original_aspect_ratio=increase:out_range=tv,crop=1440:2560,format=yuv420p,zoompan="));
  assert.ok(f.includes(":d=150:s=720x1280:fps=30") && f.endsWith("setsar=1[s0]"));
  assert.ok(f.includes(`*gte(on,${pulses[0].f})*exp((${pulses[0].f}-on)/4.5)`));
});

test("one piece's graph: the shots joined, the shading laid on ONCE, the lyrics drawn at the piece's place in the song", () => {
  const p = scenePlan({ duration: 30, grid: steady(30), lines: [] });
  const fr = shotFrames(p.shots);
  const g = chunkGraph({ shots: p.shots.slice(2, 4), frames: fr.slice(2, 4), crops: [null, null], pulses: [[], []], W: 720, H: 1280, frame0: 333, assFilter: "ass=filename='x.ass'", fadeOut: { at: 9.2, d: 0.8 } });
  assert.ok(g.includes("[s0][s1]concat=n=2:v=1:a=0[cat]"));
  assert.ok(g.includes("[2:v]scale=720:1280,format=yuva420p[scrim]") && g.includes("overlay=0:0:eof_action=repeat:format=yuv420[shaded]"), "one frame of shading, held — in the video's own format");
  assert.ok(g.includes("setpts=PTS+333/(30*TB),ass=filename='x.ass',setpts=PTS-STARTPTS"), "moved to its place in the song for the renderer, and back");
  assert.ok(g.includes("fade=t=out:st=9.200:d=0.800") && g.endsWith("format=yuv420p[v]"));
  for (const look of LOOKS) assert.ok(scrimAlpha(look).startsWith("255*min("), look);
});

/* ---------------------------------------------------------------- the server, the job, the route, the page (source) */

/* ---------------------------------------------------------------- a song from a YouTube link, and whose it is */

test("a link is a YouTube VIDEO's link or nothing — and the tool is handed an address written from its id alone", () => {
  const id = "dQw4w9WgXcQ";
  for (const good of [
    `https://www.youtube.com/watch?v=${id}`, `http://youtube.com/watch?v=${id}&t=42s`, `youtube.com/watch?v=${id}`, `www.youtube.com/watch?feature=share&v=${id}`,
    `https://m.youtube.com/watch?v=${id}`, `https://music.youtube.com/watch?v=${id}&list=RDAMVM${id}`, `https://youtu.be/${id}`, `youtu.be/${id}?si=abc123`,
    `https://www.youtube.com/shorts/${id}`, `https://www.youtube.com/embed/${id}?autoplay=1`, `https://www.youtube.com/live/${id}`, `https://www.youtube-nocookie.com/embed/${id}`,
    `  https://YOUTU.BE/${id}  `, `https://www.youtube.com./watch?v=${id}`, `https://www.youtube.com/watch?v=${id}#t=10`,
  ]) assert.equal(youTubeId(good), id, good);
  // an id may begin with "-" or "_" — still only ever inside the address we write
  assert.equal(youTubeId("https://youtu.be/-abcdefghij"), "-abcdefghij");
  assert.equal(youTubeWatch("-abcdefghij"), "https://www.youtube.com/watch?v=-abcdefghij");
  for (const bad of [
    "", "   ", "a song I like", "https://www.youtube.com/playlist?list=PL1234567890", "https://www.youtube.com/@somechannel", "https://www.youtube.com/channel/UC123",
    "https://www.youtube.com/watch", "https://www.youtube.com/watch?v=short", `https://www.youtube.com/watch?v=${id}x`, `https://www.youtube.com/watch?v=${id}%00`,
    `https://youtube.com.evil.example/watch?v=${id}`, `https://evilyoutube.com/watch?v=${id}`, `https://vimeo.com/${id}`, `https://soundcloud.com/a/b`,
    `https://user:pass@www.youtube.com/watch?v=${id}`, `https://www.youtube.com:8443/watch?v=${id}`, `ftp://youtube.com/watch?v=${id}`, `file:///etc/passwd`,
    `javascript:alert(1)//youtube.com/watch?v=${id}`, `--exec=rm https://youtu.be/${id}`, `https://youtu.be/${id}/more`, `https://www.youtube.com/shorts/${id}/x`,
    `https://youtu.be/${id} https://youtu.be/${id}`, "x".repeat(2100),
  ]) assert.equal(youTubeId(bad), null, bad.slice(0, 80));
  assert.equal(youTubeWatch(id), `https://www.youtube.com/watch?v=${id}`);
});

test("what the fetching tool is asked: one video's audio, AAC first, nothing live, long, big — and no config on the machine", () => {
  const a = ytDlpArgs("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "/data/renders/ytsrc-ab.%(ext)s");
  assert.deepEqual(a.slice(-2), ["--", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"], "the address last, after the end of the options");
  for (const flag of ["--ignore-config", "--no-playlist", "--no-progress", "--write-info-json"]) assert.ok(a.includes(flag), flag);
  const opt = (k: string) => a[a.indexOf(k) + 1];
  assert.equal(opt("--match-filter"), `!is_live & duration <= ${LINK_MAX_SECONDS}`);
  assert.equal(opt("--max-filesize"), "60M");
  assert.equal(opt("-f"), "bestaudio[ext=m4a]/bestaudio/best");
  assert.equal(opt("-o"), "/data/renders/ytsrc-ab.%(ext)s");
  assert.ok(!a.some((x) => /^--(?:exec|cookies|batch-file|config-location|load-info-json|plugin-dirs)/.test(x)), "nothing that runs or reads anything else");
  assert.equal(LINK_MAX_SECONDS, 900);
  assert.ok(LINK_TIMEOUT_MS <= 80_000, "a fetch ends well inside the 100 s the site's proxy allows a request");
  assert.equal(LINK_FETCHES_A_DAY, 12);
});

test("why a fetch failed, from what the tool printed — and every answer tells the member what to do", () => {
  const f = (err: string, more: Partial<{ code: number | null; out: string; timedOut: boolean }> = {}) => linkFailure({ code: 1, out: "", err, timedOut: false, ...more });
  assert.equal(f("ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication."), "botCheck");
  assert.equal(f("ERROR: unable to download video data: HTTP Error 429: Too Many Requests"), "botCheck");
  assert.equal(f("ERROR: [youtube] abc: Private video. Sign in if you've been granted access to this video"), "gone");
  assert.equal(f("ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader"), "gone");
  assert.equal(f("ERROR: [youtube] abc: The uploader has not made this video available in your country"), "gone");
  assert.equal(f("ERROR: [youtube] abc: Join this channel to get access to members-only content like this video"), "gone");
  assert.equal(f("ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users."), "age");
  assert.equal(f("", { code: 0, out: "[youtube] abc: Downloading webpage\n[download] Night Drive does not pass filter (!is_live & duration <= 900), skipping .." }), "long");
  assert.equal(f("ERROR: [youtube] abc: This live event will begin in 3 hours."), "long");
  assert.equal(f("", { code: 0, out: "[download] File is larger than max-filesize (73400320 bytes > 62914560 bytes). Aborting." }), "big");
  assert.equal(f("ERROR: [youtube] abc: Requested format is not available. Use --list-formats for a list of available formats"), "failed");
  assert.equal(f("anything at all", { timedOut: true }), "slow");
  assert.equal(f("ERROR: something new"), "failed");
  for (const [k, v] of Object.entries(LINK_MSG)) assert.ok(/upload|try again|link the song/i.test(v) && v.length <= 140, `${k} says what to do, briefly`);
});

test("a fetched song's title: Artist - Track when YouTube knows them, else the video's title without the junk", () => {
  assert.equal(linkTitleOf({ title: "Night Drive (Official Video)", track: "Night Drive", artist: "The Fake Band, A Friend" }), "The Fake Band - Night Drive");
  assert.equal(linkTitleOf({ title: "Sunny Hill - Glass Kites [Official Audio] (HD)" }), "Sunny Hill - Glass Kites");
  assert.equal(linkTitleOf({ title: "AC/DC style riff - Test Song (Lyrics)" }), "AC/DC style riff - Test Song", "a slash stays");
  assert.equal(linkTitleOf({ title: "  " }), "");
  assert.equal(linkTitleOf(null), "");
  assert.ok(linkTitleOf({ title: "x".repeat(300) }).length <= 80);
});

test("WHOSE SONG IT IS — the confirmation the piece keeps, and nothing else counts as one", () => {
  assert.equal(RIGHTS_LINE, "I own this song, or I have permission from its owner to use it.");
  assert.ok(/muted, claimed or taken down/.test(RIGHTS_NOTE) && /Tick the box/.test(RIGHTS_ASK));
  const at = "2026-11-24T18:30:00.000Z";
  assert.deepEqual(songRightsOf({ confirmed: true, at, from: "upload" }), { confirmed: true, at, from: "upload" });
  assert.deepEqual(songRightsOf({ confirmed: true, at, from: "youtube", link: "https://youtu.be/dQw4w9WgXcQ?si=x" }), { confirmed: true, at, from: "youtube", link: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  assert.deepEqual(songRightsOf({ confirmed: true, at, from: "youtube", link: "https://evil.example/x" }), { confirmed: true, at, from: "youtube" }, "a bad address is not kept");
  for (const bad of [null, undefined, "yes", {}, { confirmed: "true", at, from: "upload" }, { confirmed: true, at: "yesterday", from: "upload" }, { confirmed: true, at, from: "radio" }, { confirmed: false, at, from: "upload" }]) {
    assert.equal(songRightsOf(bad), null, JSON.stringify(bad));
  }
});

test("the making (lyric-video.server.ts): listened to as the app listens to singing, checkpointed, the link, the piece", () => {
  const s = read("app", "lib", "lyric-video.server.ts");
  // THE LINK — his word, 2026-11-24: "use YouTube link but include regulatory things like 'you must have permissions
  // from song owner'": a YouTube video's id or nothing, the tool handed only the address written from it
  const link = s.slice(s.indexOf("export async function songFromLink("), s.indexOf("/* ----", s.indexOf("export async function songFromLink(")));
  assert.ok(link.includes("const id = youTubeId(link);") && link.includes("if (!id) return { ok: false, message: LINK_MSG.notYouTube"));
  assert.ok(link.indexOf("if (!id) return") < link.indexOf("runTool(bin,"), "nothing runs for a link that isn't a YouTube video's");
  assert.ok(link.includes("const source = youTubeWatch(id);") && link.includes("runTool(bin, ytDlpArgs(source, "), "the tool gets our address, never the member's string");
  assert.ok(link.includes("if (!fs.existsSync(bin)) return { ok: false, message: LINK_MSG.noTool"), "no tool on the machine: upload instead");
  assert.ok(link.includes("if (recent.length >= LINK_FETCHES_A_DAY) return { ok: false, message: LINK_MSG.many"), "a day's cap per account");
  assert.ok(link.includes("LINK_TIMEOUT_MS)") && link.includes("return { ok: false, message: LINK_MSG[why], why };"));
  // it runs inside the member's request — never queued behind a film's encode
  assert.ok(!link.includes("runFfmpeg(") && link.includes("runTool(ffmpegBin(), "), "its own short ffmpeg, not the encoder's turn");
  assert.ok(link.includes("out = path.join(dir, `${name}.m4a`);") && link.includes("const name = `mvsong-${crypto.randomBytes(10).toString(\"hex\")}`;"), "kept where an upload goes, named as an upload is");
  assert.ok(link.includes("} finally {\n    for (const f of mine())"), "the raw download and its facts never stay behind");
  assert.ok(s.includes('export const ytDlpBin = (): string => process.env.YT_DLP_PATH || "/usr/local/bin/yt-dlp";'));
  assert.ok(s.includes("...LISTEN_AUDIO") && s.includes("separateSong(mixUrl)") && s.includes("createWhisperx(src, null, { sung })"));
  assert.ok(s.includes("voicedWords(v.words, voiced)") && s.includes("heardTooLittle("));
  for (const k of ["ckLvHeard", "ckLvPlan", "ckLvDirection", "ckLvStills"]) assert.ok(s.includes(`${k}: JSON.stringify(`), `${k} is checkpointed`);
  assert.ok(s.includes('repRun("google/nano-banana", { prompt: stillPrompt(o.direction, i, o.look, o.shape, plain), aspect_ratio: o.shape, output_format: "jpg" }'));
  assert.ok(s.includes('model: "claude-sonnet-5"') && s.includes("jsonSchema: DIRECTION_SCHEMA") && s.includes("fallbackDirection("));
  assert.ok(s.includes('"-filter_complex_script", graphFile') && s.includes('"-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-maxrate", "6M", "-bufsize", "12M"'));
  assert.ok(s.includes('"-c:a", "aac", "-b:a", "192k"') && s.includes('"-f", "concat", "-safe", "0"'));
  assert.ok(s.includes('title: `Lyric Video — ${(made.title || "your song").slice(0, 60)}`') && s.includes('type: "VIDEO_AD"') && s.includes('kind: "lyricvideo"'));
  // born carrying its section and its job (what "my piece" is looked up by) — and the member's word on whose song it is
  assert.ok(s.includes('section: o.section || "creator"') && s.includes("metaJson: JSON.stringify({ ...made.meta, ...(o.jobId ? { jobId: o.jobId } : {}), ...(rights ? { songRights: rights } : {}) }),"));
  assert.ok(s.includes("const rights = songRightsOf(o.songRights);"));
  assert.ok(s.includes("[NO-RETRY] [lyricvideo] that song is not one of our uploads"));
});

test("the image installs the fetching tool and the JavaScript runtime YouTube needs — checked, newest, never failing the build", () => {
  const docker = read("Dockerfile");
  assert.ok(docker.includes("RUN node scripts/fetch-yt-dlp.mjs /usr/local/bin || true"));
  assert.ok(docker.indexOf("RUN node scripts/fetch-yt-dlp.mjs") > docker.indexOf("COPY . ."), "after the source is in (the script is part of it)");
  const sc = read("scripts", "fetch-yt-dlp.mjs");
  assert.ok(sc.includes('"https://github.com/yt-dlp/yt-dlp/releases/latest/download/"') && sc.includes('"https://github.com/denoland/deno/releases/latest/download/"'));
  assert.ok(sc.includes("const h = checked(bin, sums, YT.file);") && sc.includes("const h = checked(zip, sum, DENO.file);"), "each checked against its release's own SHA-256");
  assert.ok(sc.indexOf("checked(bin, sums, YT.file)") < sc.indexOf('install("yt-dlp", bin)') && sc.indexOf("checked(zip, sum, DENO.file)") < sc.indexOf('install("deno", unzipOne(zip))'), "checked before installed");
  assert.ok(!/process\.exit\(\s*[1-9]/.test(sc), "it never fails the build");
  assert.equal(sc.split("\ntry {").length - 1, 2, "each install in its own try");
  assert.ok(sc.includes("say(`yt-dlp NOT installed") && sc.includes("say(`Deno NOT installed"), "a failure is said, and the build goes on");
});

test("the job: a GENERATE_VIDEO_AD of kind lyricvideo, resumed from its own checkpoints, nothing charged", () => {
  const q = read("app", "lib", "job-queue.server.ts");
  const at = q.indexOf('if (payload.contentType === "lyricvideo") {');
  assert.ok(at > q.indexOf('case "GENERATE_VIDEO_AD": {') && at < q.indexOf('if (payload.contentType === "faceless") {'));
  const branch = q.slice(at, at + 1800);
  assert.ok(branch.includes('const { generateLyricVideo } = await import("./lyric-video.server");'));
  for (const k of ["ckLvHeard", "ckLvPlan", "ckLvDirection", "ckLvStills"]) assert.ok(branch.includes(`${k}: payload.${k} as string | undefined`), k);
  assert.ok(branch.includes("songRights: payload.songRights,"), "the member's confirmation reaches the piece");
  assert.ok(!branch.includes("spendTokens") && !branch.includes("prePaid"), "no tokens");
});

test("the door (api.lyric-video.tsx): operators only, the member's word on whose song it is, our own disk only, the Archive's tile", () => {
  const r = read("app", "routes", "api.lyric-video.tsx");
  assert.ok(r.includes('if (!isAdminEmail(id.account.email)) return json({ error: "Not found" }, { status: 404 });'));
  // THE TICK, checked on the server for BOTH intents, before anything is fetched or made
  const tick = 'if (String(form.get("rights") || "") !== "yes") return json({ error: tr(lang, RIGHTS_ASK), needRights: true }, { status: 400 });';
  assert.ok(r.includes(tick));
  assert.ok(r.indexOf(tick) < r.indexOf('if (intent === "link") {') && r.indexOf(tick) < r.indexOf("enqueueJob("), "asked before the link and before the job");
  assert.ok(r.includes('if (intent !== "link" && intent !== "make")'), "no third way past it");
  assert.ok(r.includes("const got = await songFromLink(String(form.get(\"link\") || \"\").trim().slice(0, 2000), { shopId: id.shop.id });"));
  assert.ok(r.includes("return json({ songUrl: `/renders/${path.basename(got.songPath)}`, name: got.name, title: got.title, seconds: got.seconds, source: got.source });"));
  assert.ok(r.includes("const file = songFileOf(String(form.get(\"songUrl\") || \"\"));") && r.includes('fs.existsSync(path.join(process.cwd(), "data", "renders", file))'));
  assert.ok(r.includes('enqueueJob(id.shop.id, "GENERATE_VIDEO_AD", {') && r.includes('contentType: "lyricvideo"') && r.includes('section: "creator"'));
  // the record: when, and from where — the YouTube address written again from its id
  assert.ok(r.includes('const linkId = youTubeId(String(form.get("songLink") || ""));'));
  assert.ok(r.includes('songRights: { confirmed: true, at: new Date().toISOString(), from: linkId ? "youtube" : "upload", ...(linkId ? { link: youTubeWatch(linkId) } : {}) },'));
  assert.ok(r.includes("productTitle: `Lyric Video — "));
  assert.ok(!/spendTokens|chargedTokens/.test(r), "nothing is charged");
});

test("the Terms say what the tick means: whose song, the platforms' claims, and where a rights holder writes", () => {
  const terms = read("app", "routes", "terms.tsx");
  assert.ok(terms.includes('<h2 id="songs"><a className="anchor" href="#songs">Songs and other material you bring</a></h2>'));
  const sec = terms.slice(terms.indexOf('<h2 id="songs">'), terms.indexOf('<h2 id="ai">'));
  assert.ok(/own it or have permission from its owner/.test(sec) && /keep a record of your confirmation/.test(sec));
  assert.ok(/muted, claimed,\s+blocked or taken down/.test(sec));
  assert.ok(/Copyright complaints/.test(sec) && sec.includes('href="mailto:hello@easymodeapp.com"') && /infringe repeatedly/.test(sec));
  assert.ok(read("app", "routes", "privacy.tsx").includes('export const LEGAL_UPDATED = "24 November 2026";'), "the date moved with the change");
});

test("the page: a Lyric Video poster on the Music videos shelf for operators, and its one-screen builder", () => {
  const ui = read("app", "routes", "web.film.tsx");
  assert.ok(ui.includes("lyricVideo: isAdminEmail(account.email),"));
  assert.ok(ui.includes('{sh.key === "sung" && d.lyricVideo && (') && ui.includes("onClick={() => enterFormat(LYRIC_HERO.id)}") && ui.includes("<LoopCover k={LYRIC_HERO.media} loop tall />"));
  assert.ok(ui.includes("setLyricOn(key === LYRIC_HERO.id);") && ui.includes("const hero = lyricOn ? LYRIC_HERO : heroById(heroId);"));
  assert.ok(ui.includes("{lyricOn ? <LyricVideoBuilder t={t} /> : (<>"));
  assert.ok(ui.includes('fetch("/api/film-song-upload", { method: "POST", body: fd })') && ui.includes('fetch("/api/lyric-video", { method: "POST", body: fd })'));
  assert.ok(ui.includes('fd.set("intent", "link")') && ui.includes('fd.set("intent", "make")'));
  // THE TICK: one box, asked before the link is fetched and before the video is made — never a silent grey button
  assert.ok(ui.includes("<b>{t(RIGHTS_LINE)}</b>") && ui.includes("{t(RIGHTS_NOTE)} <a href=\"/terms#songs\""));
  assert.ok(ui.includes('if (!rights) { askRights("link"); return; }') && ui.includes('if (!rights) { askRights("make"); return; }'));
  assert.equal(ui.split('fd.set("rights", "yes")').length - 1, 2, "both requests carry it");
  assert.ok(ui.includes('if (song.link) fd.set("songLink", song.link);'), "the YouTube address goes with the video, for the record");
  assert.ok(ui.includes("setSong(null); setTitle(\"\"); setRights(false);"), "another song is another confirmation");
  assert.ok(ui.includes('placeholder={t("Paste a YouTube link")}') && ui.includes('{t("Getting the song…")}'));
  assert.ok(ui.includes("{LYRIC_LOOKS.map((lk) => (") && ui.includes("src={`/landing/lyric-look-${lk.key}.jpg?v=1`}"));
  // the card, the builder's looks and its moving cover are on the disk
  for (const f of ["film-still-lyricvideo.jpg", "film-still-lyricvideo-tall.jpg", "film-loop-lyricvideo.mp4", "film-loop-lyricvideo-tall.mp4", "film-loop-lyricvideo.jpg", ...LOOKS.map((l) => `lyric-look-${l}.jpg`)]) {
    assert.ok(fs.existsSync(path.join(root, "public", "landing", f)), f);
  }
  // every word the builder shows is in all five languages
  const b = ui.slice(ui.indexOf("function LyricVideoBuilder("), ui.indexOf("const LV_STYLE = `"));
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  const said = [...b.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
  const heroes = read("app", "lib", "film-heroes.ts");
  assert.ok(heroes.includes('name: "Lyric Video", kick: "Your song, words on screen", meta: "cut on the beat"'));
  for (const k of [...new Set([...said, ...LYRIC_LOOKS.flatMap((l) => [l.label, l.blurb]), "Lyric Video", "Your song, words on screen", "cut on the beat",
    // said through constants (the server says them too), and every answer a link can get
    RIGHTS_LINE, RIGHTS_NOTE, RIGHTS_ASK, ...Object.values(LINK_MSG)])]) {
    assert.equal(dict.split(`\n  ${JSON.stringify(k)}: `).length - 1, 5, k);
  }
});

/* The owner, 2026-11-24: "Put found footage routes into the app and body cam". Found footage has its own builder
 * (web.found-footage.tsx, operators only); the Movie Maker gets ONE way in — a door at the end of the Films shelf. */
test("the Movie Maker's door to Found Footage: on the Films shelf, operators only, its own poster and clip", async () => {
  const { FOUND_FOOTAGE_DOOR, FILM_HEROES, heroShelves } = await import("../app/lib/film-heroes.ts");
  assert.equal(FOUND_FOOTAGE_DOOR.href, "/web/found-footage");
  assert.ok(!FILM_HEROES.some((h) => h.id === FOUND_FOOTAGE_DOOR.id), "a door, not a hero this page builds");
  assert.deepEqual(heroShelves(FILM_HEROES).map((s) => s.heroes.length), [3, 4, 2], "the shelves' own heroes are as they were");
  assert.ok(`${FOUND_FOOTAGE_DOOR.kick} · ${FOUND_FOOTAGE_DOOR.meta}`.length <= 45, "its two lines fit a phone card");
  for (const f of [FOUND_FOOTAGE_DOOR.still, FOUND_FOOTAGE_DOOR.clip]) assert.ok(fs.existsSync(path.join(root, "public", f)), f);
  const ui = read("app", "routes", "web.film.tsx");
  assert.ok(ui.includes("foundFootage: isAdminEmail(account.email),"), "the same operator check as every admin-only format");
  assert.ok(ui.includes('{sh.key === "acted" && d.foundFootage && (') && ui.includes("href={FOUND_FOOTAGE_DOOR.href}"));
  assert.ok(ui.includes("<LoopCover k={FOUND_FOOTAGE_DOOR.id} still={FOUND_FOOTAGE_DOOR.still} clip={FOUND_FOOTAGE_DOOR.clip} />"));
  // the builder it opens turns everyone else away too
  assert.ok(read("app", "routes", "web.found-footage.tsx").includes('if (!isAdminEmail(account.email)) throw new Response("Not found", { status: 404 });'));
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of [FOUND_FOOTAGE_DOOR.name, FOUND_FOOTAGE_DOOR.kick, FOUND_FOOTAGE_DOOR.meta]) assert.equal(dict.split(`\n  ${JSON.stringify(k)}: `).length - 1, 5, k);
});

test("the Archive knows a lyric video: under Films, and its in-progress card expects a song's worth of time", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../app/routes/web.archive.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(src.includes('"avatardialogue", "enginetest", "lyricvideo"]);'));
  assert.ok(src.includes(': (j.type === "GENERATE_VIDEO_AD" && p.contentType === "lyricvideo") ? lyricEtaMinutes(typeof p.lyricSeconds === "number" ? p.lyricSeconds : 180) * 60'));
});
