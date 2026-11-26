/* A SPOKEN LINE FITS ITS SHOT — COUNTED, NOT HOPED FOR.
 *
 * Made as a customer, 2026-11-23: a kids' cartoon set to "≈ 20s · 4 shots". The writer is told "about 15-18
 * words … NEVER more than 18" a line; it wrote four lines of 26 to 30. Every shot ran its full ten seconds,
 * the film came out at 40 seconds, and the render cost twice what the length that was picked costs.
 *
 * The first fix asked for the long lines again "at 14 to 18 words" — and on the live site they came back at
 * 25, 29 and 26. It cannot count. So each long line is asked for at THREE lengths and the code picks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LINE_VERSIONS, LINE_WORDS_MAX, LINE_WORDS_MIN, LINE_WORDS_SHORT, LINE_WORDS_WANT, fitAsk, growAsk, linesTooLong, linesTooShort, pickLine, pickLonger, saidWords, splitLine, takeLonger, takeRewrites } from "../app/lib/dialogue-fit.ts";
import { clipSecondsFor } from "../app/lib/speech-meter.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const words = (n: number, w = "word") => Array.from({ length: n }, () => w).join(" ");

// the cartoon that was really written
const KITE = [
  "PIP: Coco, feel that breeze coming off the water, it feels perfect for flying our kite again! Let us give the string a nice big tug together!",
  "COCO: I feel it, Pip, it is swirling all around us like a soft and happy song. Let us pull slow and steady so our kite lifts up nice and smooth.",
  "PIP: Look how high it is going, Coco, it is dancing right over the little waves! I think this is the happiest our kite has ever flown!",
  "COCO: It is because we flew it together, Pip, that makes it the happiest kite in the whole wide world. Let us watch it float until the sun says goodnight.",
];

test("the speaker's label is not spoken, and is not counted", () => {
  assert.deepEqual(splitLine("PIP: Hello there, Coco!"), { name: "PIP", said: "Hello there, Coco!" });
  assert.deepEqual(splitLine("The Keeper:   She understands now."), { name: "The Keeper", said: "She understands now." });
  assert.deepEqual(splitLine("no label here"), { name: "", said: "no label here" });
  assert.deepEqual(splitLine(null), { name: "", said: "" });
  assert.equal(saidWords("PIP: Hello there, Coco!"), 3);
  assert.equal(saidWords(""), 0);
});

test("the lines that were really written are all found too long", () => {
  assert.deepEqual(KITE.map((l) => saidWords(l)), [26, 30, 26, 29]);
  assert.deepEqual(linesTooLong(KITE), [0, 1, 2, 3]);
  // …each of them a full ten-second shot, where a line of the length asked for is about six or seven
  for (const l of KITE) assert.equal(clipSecondsFor(splitLine(l).said), 10);
  assert.ok(clipSecondsFor("I kept thinking about you after we parted, which is a strange thing to admit to a stranger.") <= 8);
});

test("a line at the length asked for, a little over, an empty one and an uncountable script are left alone", () => {
  assert.deepEqual(LINE_WORDS_WANT, [14, 18]);
  assert.equal(LINE_WORDS_MAX, 20);
  const eighteen = "OMAR: I kept thinking about you after we parted, which is a strange thing to admit to a stranger.";
  const twenty = "ADAEZE: Tunde, the boat radio's dead and that thing hasn't moved from the doorway in an hour. What did you do?";
  assert.equal(saidWords(eighteen), 18);
  assert.equal(saidWords(twenty), 20);
  assert.deepEqual(linesTooLong([eighteen, twenty, "", undefined, null]), []);
  // Chinese has no spaces between words: the count means nothing there, so nothing is sent back
  assert.deepEqual(linesTooLong(["小皮：可可，你感觉到海边吹来的微风了吗，今天真是放风筝的好日子，让我们一起拉一拉线吧，让它飞得又高又稳，好不好呀"]), []);
});

test("the one request shows every line in order, marks the long ones, and asks for each at three lengths", () => {
  const mixed = [KITE[0], "COCO: I feel it, Pip, like a soft and happy song all around us."];
  const ask = fitAsk(mixed, linesTooLong(mixed));
  assert.ok(ask.includes("1. [TOO LONG — 26 words] PIP: Coco, feel that breeze"));
  assert.ok(ask.includes("2. COCO: I feel it, Pip, like a soft and happy song all around us."));
  assert.deepEqual(LINE_VERSIONS, [11, 14, 17]);
  assert.ok(ask.includes("write THREE shorter versions of it"));
  assert.ok(ask.includes("a short one of about 11 spoken words, a middle one of about 14, and a long one of about 17"));
  assert.ok(ask.includes("Whatever the NEXT line answers or reacts to must still be said in each."));
  assert.ok(ask.includes("in the language the line is written in"));
  assert.ok(ask.includes("Return \"lines\": exactly 2 entries"));
  assert.ok(ask.includes("The entry for an unmarked line is an EMPTY list."));
});

test("of the three, the longest that fits is taken — it fills the shot best", () => {
  const orig = `PIP: ${words(26)}`;
  assert.equal(pickLine(orig, [`PIP: ${words(11)}`, `PIP: ${words(15)}`, `PIP: ${words(18)}`]), `PIP: ${words(18)}`);
  // the "long" version overshot (it cannot count): the middle one is the longest that fits
  assert.equal(pickLine(orig, [`PIP: ${words(12)}`, `PIP: ${words(17)}`, `PIP: ${words(23)}`]), `PIP: ${words(17)}`);
  // every version is over the limit, but shorter than what was written: the shortest is still an improvement
  assert.equal(pickLine(orig, [`PIP: ${words(21)}`, `PIP: ${words(23)}`, `PIP: ${words(25)}`]), `PIP: ${words(21)}`);
  // what the first fix could not use: one rewrite at 25 where 26 was written — now it is at least taken
  assert.equal(pickLine(orig, [`PIP: ${words(25)}`]), `PIP: ${words(25)}`);
});

test("a version is only ever taken when it is that speaker's line, shorter, and still a line", () => {
  const orig = KITE[0];
  assert.equal(pickLine(orig, [`COCO: ${words(15)}`]), orig, "another speaker's words");
  assert.equal(pickLine(orig, [`PIP: ${words(26)}`, `PIP: ${words(30)}`]), orig, "as long, or longer");
  assert.equal(pickLine(orig, [`PIP: ${words(LINE_WORDS_MIN - 1)}`]), orig, "too short to hold a shot");
  assert.equal(pickLine(orig, [42, null, undefined, {}]), orig, "not text");
  assert.equal(pickLine(orig, []), orig);
  // numbering or a mark left on is taken off; the label keeps the form it was first written in
  assert.equal(pickLine(orig, ["1. [TOO LONG — 26 words] pip: Coco, feel that breeze! It is perfect for flying our kite."]), "PIP: Coco, feel that breeze! It is perfect for flying our kite.");
  // a line with no label
  assert.equal(pickLine(words(26), [words(15)]), words(15));
});

test("only a marked line can change; a wrong answer changes nothing", () => {
  const long = linesTooLong(KITE);
  const versions = KITE.map((l) => { const { name } = splitLine(l); return [`${name}: ${words(11)}`, `${name}: ${words(14)}`, `${name}: ${words(17)}`]; });
  const out = takeRewrites(KITE, long, versions);
  assert.deepEqual(out.map((l) => saidWords(l)), [17, 17, 17, 17]);
  assert.deepEqual(out.map((l) => splitLine(l).name), ["PIP", "COCO", "PIP", "COCO"]);
  // an unmarked line is never touched, whatever came back for it
  const one = [KITE[0], "COCO: I feel it too, Pip."];
  assert.equal(takeRewrites(one, linesTooLong(one), [[`PIP: ${words(16)}`], ["COCO: Something else entirely was written here instead of it."]])[1], one[1]);
  // a single text where a list was asked for is one version
  assert.equal(saidWords(takeRewrites(one, [0], [`PIP: ${words(16)}`, []])[0]), 16);
  // the wrong number of entries, or no list at all: everything stays as written
  assert.deepEqual(takeRewrites(KITE, long, versions.slice(0, 3)), KITE);
  assert.deepEqual(takeRewrites(KITE, long, "nope"), KITE);
  assert.deepEqual(takeRewrites(KITE, long, undefined), KITE);
});

test("the writer's lines go through it for an acted film — not a narrated story, not a song — and it says what it did", () => {
  const src = read("app", "lib", "film-engine.server.ts");
  assert.ok(src.includes("import { LINE_WORDS_MAX, LINE_WORDS_SHORT, fitAsk, growAsk, linesTooLong, linesTooShort, saidWords, takeLonger, takeRewrites } from \"./dialogue-fit\";"));
  assert.ok(src.includes("if (tmpl.dialogue && !narrated) {\n    const written = list.map((s) => s.caption || \"\");\n    const long = linesTooLong(written);\n    if (long.length) {"), "no extra call unless a line is too long");
  assert.ok(src.includes("jsonSchema: { name: \"dialogue_fit\", schema: { type: \"object\", properties: { lines: { type: \"array\", items: { type: \"array\", items: { type: \"string\" } } } }, required: [\"lines\"], additionalProperties: false } },"), "a list of versions for each line");
  assert.ok(src.includes("const next = takeRewrites(written, long, (JSON.parse(raw) as { lines?: unknown }).lines);"));
  assert.ok(src.includes("list = list.map((s, i) => (next[i] && next[i] !== written[i] ? { ...s, caption: next[i] } : s));"));
  assert.ok(src.includes("lineNote = { was: long.map((i) => saidWords(written[i])), now: long.map((i) => saidWords(next[i])),"));
  // (…beside what was done about lines by somebody off screen — tests/dialogue-cast.test.ts)
  assert.ok(src.includes("cast, ...(lineNote ? { lineFit: lineNote } : {}), ...(castNote ? { castFit: castNote } : {}), ...(fitNote ? { lyricFit: fitNote } : {}) };"), "what happened rides back on the treatment");
  assert.ok(src.includes("console.error(`[film] the long lines could not be rewritten, kept as written: ${why}`);"), "any trouble: the lines stay as written");
  // the instruction it backs up is still given
  assert.ok(src.includes("NEVER more than 18 words"));
});

/* A LINE TOO SHORT FOR ITS SHOT (2026-11-26). The comedy brief asked for "Short lines" and the action brief for
 * "terse" ones, while every take is at least five seconds: a four-word button leaves dead air, which the engine
 * fills with silence or looped words. Only too-long lines were ever sent back. */
test("a line too short for its shot goes back once, asked for at three LONGER lengths — in a new genre's film", () => {
  assert.equal(LINE_WORDS_SHORT, 10);
  // a two-word line and a nine-word one are short; fifteen is not; an empty line and an uncountable script are left alone
  assert.deepEqual(linesTooShort(["MARA: Told you.", `JONAH: ${words(15)}`, "", "小皮：好", `MARA: ${words(9)}`]), [0, 4]);
  assert.deepEqual(linesTooShort([null, undefined, "MARA:"]), [], "a wordless shot is not a short line");
  // the one request: every line in order, the short ones marked
  const lines = ["MARA: Told you.", `JONAH: ${words(15)}`];
  const ask = growAsk(lines, linesTooShort(lines));
  assert.ok(ask.includes("1. [TOO SHORT — 2 words] MARA: Told you."));
  assert.ok(ask.includes(`2. JONAH: ${words(15)}`));
  assert.ok(ask.includes("write THREE longer versions of it") && ask.includes("about 14, about 16 and about 18 spoken words"));
  assert.ok(ask.includes("Return \"lines\": exactly 2 entries") && ask.includes("The entry for an unmarked line is an EMPTY list."));
  // (…each line with WHAT WE SEE in its shot, and nothing new added — review of item 3: asked blind, a longer line could
  //  invent a clue, a person or a fact the picture does not have)
  const seenAsk = growAsk(lines, [0], ["CLOSE: Mara sets the third cup on the counter.", ""]);
  assert.ok(seenAsk.includes("1. [TOO SHORT — 2 words] MARA: Told you.\n   (what we see in this shot: CLOSE: Mara sets the third cup on the counter.)"));
  assert.ok(seenAsk.includes(`2. JONAH: ${words(15)}\n`) && !seenAsk.includes(`2. JONAH: ${words(15)}\n   (what we see`), "a shot with no words of its own adds nothing");
  assert.ok(seenAsk.includes("Add no new object, person, place or fact: a longer line speaks only of what this story and its shot already have."));
  assert.ok(read("app", "lib", "film-engine.server.ts").includes("growAsk(written, short, list.map((s) => s.visual || \"\"))"));
  // of the versions: the longest that is still a line of the right length
  assert.equal(pickLonger("MARA: Told you.", [`MARA: ${words(13)}`, `MARA: ${words(17)}`, `MARA: ${words(23)}`]), `MARA: ${words(17)}`);
  // …never another speaker's, never one no longer than written, never one over the limit
  assert.equal(pickLonger("MARA: Told you.", [`JONAH: ${words(15)}`]), "MARA: Told you.", "another speaker's words");
  assert.equal(pickLonger("MARA: Told you.", ["MARA: I did."]), "MARA: Told you.", "not longer");
  assert.equal(pickLonger("MARA: Told you.", [`MARA: ${words(LINE_WORDS_MAX + 1)}`]), "MARA: Told you.", "over the limit");
  assert.equal(pickLonger("MARA: Told you.", [42, null, {}]), "MARA: Told you.", "not text");
  // (numbering or a mark left on is taken off; the label keeps the form it was first written in)
  assert.equal(pickLonger("MARA: Told you.", [`1. [TOO SHORT — 2 words] mara: ${words(16)}`]), `MARA: ${words(16)}`);
  // only a marked line can change; a wrong answer changes nothing
  assert.deepEqual(takeLonger(lines, [0], "nope"), lines);
  assert.deepEqual(takeLonger(lines, [0], [[`MARA: ${words(16)}`]]), lines, "the wrong number of entries");
  assert.deepEqual(takeLonger(lines, [0], [[`MARA: ${words(16)}`], [`JONAH: ${words(18)}`]]), [`MARA: ${words(16)}`, lines[1]]);
  // the engine: for a NEW genre's acted film only (Drama, Horror, Moral and Kids are left as tuned), after the long ones
  const src = read("app", "lib", "film-engine.server.ts");
  const at = src.indexOf("if (tmpl.dialogue && !narrated && GENRE_FILMS.some((g) => g.key === tmpl.key)) {\n    const written = list.map((s) => s.caption || \"\");\n    const short = linesTooShort(written);");
  assert.ok(at > 0 && at > src.indexOf("const long = linesTooLong(written);") && at < src.indexOf("return { list, castNote, lineNote };"));
  assert.ok(src.includes("jsonSchema: { name: \"dialogue_grow\", schema: { type: \"object\", properties: { lines: { type: \"array\", items: { type: \"array\", items: { type: \"string\" } } } }, required: [\"lines\"], additionalProperties: false } },"));
  assert.ok(src.includes("const next = takeLonger(written, short, (JSON.parse(raw) as { lines?: unknown }).lines);"));
  assert.ok(src.includes("console.error(`[film] the short lines could not be rewritten, kept as written: "), "any trouble: the lines stay as written");
});
