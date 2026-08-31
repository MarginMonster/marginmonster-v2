import { test } from "node:test";
import assert from "node:assert/strict";
import { captionChunks, LATIN_OPTS } from "../app/lib/caption-chunks.ts";

/** Cards that carry a real sentence boundary in their middle. A Latin
 *  terminator only counts when whitespace follows it, so "$29.99" and
 *  "3.5 hours" are not sentences; CJK punctuation never has whitespace
 *  after it, so there it counts on its own. */
const spans = (chunks: string[]) =>
  chunks.filter((c) => /[.!?]\s+\S/.test(c) || /[。！？]\s*\S/.test(c));

test("no caption card ever carries a sentence boundary in its middle", () => {
  // The script behind a real video in the merchant's Archive. The old chunker
  // produced a card reading "THE WILD. THIS".
  const script = "Ever seen Pokemon look this natural? This set brings six hand-painted, textured like stone. Grab your case now.";
  const chunks = captionChunks(script);
  assert.deepEqual(spans(chunks), [], `these cards straddle a full stop: ${JSON.stringify(spans(chunks))}`);
  assert.ok(chunks.includes("this natural?"), JSON.stringify(chunks));
  assert.ok(chunks.some((c) => c.endsWith("stone.")), JSON.stringify(chunks));
});

test("a decimal or a price is not a sentence", () => {
  const chunks = captionChunks("It costs $29.99 and lasts 3.5 hours. Worth it.");
  assert.ok(chunks.some((c) => c.includes("$29.99")), JSON.stringify(chunks));
  assert.ok(chunks.some((c) => c.includes("3.5")), JSON.stringify(chunks));
  assert.deepEqual(spans(chunks), []);
});

test("a long sentence breaks where a speaker would pause", () => {
  const chunks = captionChunks("Soft to the touch, built to last, and it ships tomorrow.");
  // No card may end on a dangling separator — the cut is the pause.
  for (const c of chunks) assert.doesNotMatch(c, /[,;:—–]$/, c);
  assert.deepEqual(spans(chunks), []);
});

test("a card is not left holding one word that would have fitted the card before it", () => {
  // The 3-word rhythm used to strand "six" on a card of its own between
  // "this set brings" and "hand-painted".
  const chunks = captionChunks("This set brings six hand-painted figures.");
  assert.ok(!chunks.includes("six"), JSON.stringify(chunks));
  // A single word IS allowed when nothing it could join has room — the last
  // word of a sentence often has nowhere to go.
  for (let i = 0; i < chunks.length - 1; i++) {
    if (chunks[i].includes(" ")) continue;
    const couldJoin = `${chunks[i]} ${chunks[i + 1]}`.length <= 16;
    assert.ok(!couldJoin, `"${chunks[i]}" could have joined "${chunks[i + 1]}"`);
  }
});

test("Chinese splits on its own punctuation, which carries no space", () => {
  const chunks = captionChunks("这个系列非常可爱，每盒都有惊喜。快来拢货吧！");
  assert.deepEqual(spans(chunks), [], JSON.stringify(chunks));
  assert.ok(chunks.some((c) => c.endsWith("。")), JSON.stringify(chunks));
  // Square glyphs need a tighter budget than Latin.
  for (const c of chunks) assert.ok(c.length <= 14, `${c} is ${c.length} glyphs`);
});

test("a long script is rebalanced, never truncated", () => {
  // The old code did chunks.slice(0, 20), so the captions stopped while the
  // voice-over kept talking.
  const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} here.`).join(" ");
  const chunks = captionChunks(long);
  assert.ok(chunks.length <= LATIN_OPTS.maxChunks, `${chunks.length} cards`);
  // Everything the speaker says still appears somewhere.
  const joined = chunks.join(" ").toLowerCase();
  for (const n of [0, 17, 39]) assert.ok(joined.includes(`number ${n}`), `lost sentence ${n}`);
});

test("degenerate input does not throw", () => {
  assert.deepEqual(captionChunks(""), []);
  assert.deepEqual(captionChunks("   "), []);
  assert.deepEqual(captionChunks("..."), ["..."]);
  assert.deepEqual(captionChunks("Hi."), ["Hi."]);
});

test("every card fits the frame budget it was given", () => {
  const chunks = captionChunks("Absolutely extraordinary craftsmanship throughout every single component here.");
  // One unbreakable word may exceed the budget; two words together may not.
  for (const c of chunks) {
    if (c.includes(" ")) assert.ok(c.length <= Math.round(LATIN_OPTS.budget * 1.35), `${c} is ${c.length} chars`);
  }
});
