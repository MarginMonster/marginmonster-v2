/* A SPOKEN LINE FITS ITS SHOT — COUNTED, NOT HOPED FOR.
 *
 * Made as a customer, 2026-11-23: a kids' cartoon set to "≈ 20s · 4 shots". The writer is told "about 15-18
 * words … NEVER more than 18" a line; it wrote four lines of 26 to 30. Every shot ran its full ten seconds,
 * the film came out at 40 seconds, and the render cost twice what the length that was picked costs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LINE_WORDS_MAX, LINE_WORDS_MIN, LINE_WORDS_WANT, fitAsk, linesTooLong, saidWords, splitLine, takeRewrites } from "../app/lib/dialogue-fit.ts";
import { clipSecondsFor } from "../app/lib/speech-meter.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

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

test("the one request shows every line in order and marks the long ones with their count", () => {
  const mixed = [KITE[0], "COCO: I feel it, Pip, like a soft and happy song all around us."];
  const ask = fitAsk(mixed, linesTooLong(mixed));
  assert.ok(ask.includes("1. [TOO LONG — 26 words] PIP: Coco, feel that breeze"));
  assert.ok(ask.includes("2. COCO: I feel it, Pip, like a soft and happy song all around us."));
  assert.ok(ask.includes("Rewrite ONLY the marked lines to between 14 and 18 spoken words each"));
  assert.ok(ask.includes("whatever the NEXT line answers or reacts to must still be said"));
  assert.ok(ask.includes("in the language the line is written in"));
  assert.ok(ask.includes("Return \"lines\": exactly 2 entries"));
});

test("a rewrite is taken only when it is that speaker's line, shorter and still a line", () => {
  const long = linesTooLong(KITE);
  const good = [
    "PIP: Coco, feel that breeze off the water! It is perfect for flying our kite again!",
    "COCO: I feel it, Pip, like a soft happy song. Let us pull slow and steady.",
    "PIP: Look how high it goes, Coco, dancing right over the little waves!",
    "COCO: Because we flew it together, Pip. Let us watch until the sun says goodnight.",
  ];
  const out = takeRewrites(KITE, long, good);
  assert.deepEqual(out, good);
  for (const l of out) assert.ok(saidWords(l) <= LINE_WORDS_MAX && saidWords(l) >= LINE_WORDS_MIN, l);
  // numbering or a mark left on by the writer is taken off; the label keeps the form it was first written in
  assert.equal(takeRewrites(KITE, long, ["1. [TOO LONG — 26 words] pip: Coco, feel that breeze! It is perfect for flying our kite.", KITE[1], KITE[2], KITE[3]])[0], "PIP: Coco, feel that breeze! It is perfect for flying our kite.");
  // another speaker's words, a line that is still too long, one that is longer, one too short to be a line, not text
  assert.equal(takeRewrites(KITE, long, ["COCO: Coco, feel that breeze off the water, it is perfect for our kite!", KITE[1], KITE[2], KITE[3]])[0], KITE[0]);
  assert.equal(takeRewrites(KITE, long, [`PIP: ${"word ".repeat(22).trim()}`, KITE[1], KITE[2], KITE[3]])[0], KITE[0]);
  assert.equal(takeRewrites(KITE, long, [`PIP: ${"word ".repeat(30).trim()}`, KITE[1], KITE[2], KITE[3]])[0], KITE[0]);
  assert.equal(takeRewrites(KITE, long, ["PIP: Feel that breeze!", KITE[1], KITE[2], KITE[3]])[0], KITE[0]);
  assert.equal(takeRewrites(KITE, long, [42, KITE[1], KITE[2], KITE[3]])[0], KITE[0]);
  // a line that was not marked is never touched, whatever came back for it
  const one = [KITE[0], "COCO: I feel it too, Pip."];
  assert.equal(takeRewrites(one, linesTooLong(one), [good[0], "COCO: Something else entirely was written here instead."])[1], one[1]);
  // the wrong number of lines, or no list at all: everything stays as written
  assert.deepEqual(takeRewrites(KITE, long, good.slice(0, 3)), KITE);
  assert.deepEqual(takeRewrites(KITE, long, "nope"), KITE);
  assert.deepEqual(takeRewrites(KITE, long, undefined), KITE);
});

test("the writer's lines go through it for an acted film — not a narrated story, not a song", () => {
  const src = read("app", "lib", "film-engine.server.ts");
  assert.ok(src.includes("import { LINE_WORDS_MAX, fitAsk, linesTooLong, saidWords, takeRewrites } from \"./dialogue-fit\";"));
  assert.ok(src.includes("if (tmpl.dialogue && !narrated) {\n    const written = list.map((s) => s.caption || \"\");\n    const long = linesTooLong(written);\n    if (long.length) {"), "no extra call unless a line is too long");
  assert.ok(src.includes("const next = takeRewrites(written, long, (JSON.parse(raw) as { lines?: unknown }).lines);"));
  assert.ok(src.includes("list = list.map((s, i) => (next[i] && next[i] !== written[i] ? { ...s, caption: next[i] } : s));"));
  assert.ok(src.includes("console.error(`[film] the long lines could not be rewritten, kept as written:"), "any trouble: the lines stay as written");
  // the instruction it backs up is still given
  assert.ok(src.includes("NEVER more than 18 words"));
});
