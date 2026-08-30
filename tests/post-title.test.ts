/* The last gate before a post leaves for the provider, which caps a title at
 * 150 characters. buildPostTitle routinely produces two or three times that:
 *
 *   <caption>\n\n🛒 <shop link>\n\n#tags #EasyModeAi\n\n✨ Made with EasyMode
 *
 * Two things in there are not optional. The #EasyModeAi disclosure is required
 * by Meta and promised on the landing page. The go/a/<id> link is the entire
 * attribution loop — it is how a post gets credited with a sale, and it is the
 * thing merchants are paying for.
 *
 * Both have been cut by this function at some point: first the tag (blind
 * slice), then the link (trim the body, re-attach the tag — but the body still
 * held the URL). A truncated cuid is the worst outcome of all, because it still
 * looks like a link to whoever taps it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { trimKeepingDisclosure } from "../app/lib/post-title.ts";

const MAX = 150;
const LINK = "https://easymodeapp.com/go/a/clx9f3k2p0001qw8h4b7ndz6t";
const DISCLOSURE = "#EasyModeAi";
const build = (caption: string, link = LINK, tags = "#skincare #glow #EasyModeAi", credit?: string) =>
  [caption, link ? `🛒 ${link}` : "", tags, credit].filter(Boolean).join("\n\n");

test("a title already inside the cap is untouched", () => {
  const short = "New drop.\n\n🛒 https://ez.co/g/1\n\n#EasyModeAi";
  assert.equal(trimKeepingDisclosure(short), short);
  assert.ok(short.length <= MAX);
});

test("the result never exceeds the provider's cap", () => {
  for (const caption of [
    "Soft, glowy skin without the ten-step routine — our bestselling serum is back in stock and it goes fast.",
    "A".repeat(400),
    "Short one",
  ]) {
    const out = trimKeepingDisclosure(build(caption));
    assert.ok(out.length <= MAX, `${out.length} > ${MAX} for caption of ${caption.length}`);
  }
});

test("the shop link survives in full — this is the whole attribution loop", () => {
  const long =
    "Soft, glowy skin without the ten-step routine. Our bestselling vitamin C serum is back in stock and it always goes fast, so grab yours.";
  const out = trimKeepingDisclosure(build(long));
  assert.ok(out.includes(LINK), `link was dropped:\n${out}`);
});

test("the link is never left half-written", () => {
  // The failure that mattered most: a cut cuid still reads as a real link.
  const long = "B".repeat(300);
  const out = trimKeepingDisclosure(build(long));
  const seen = out.match(/https?:\/\/\S+/);
  if (seen) assert.equal(seen[0], LINK, `link was truncated to ${seen[0]}`);
});

test("the AI disclosure always survives", () => {
  for (const caption of ["C".repeat(500), "tiny", "Some ordinary caption text here that runs on a while longer"]) {
    const out = trimKeepingDisclosure(build(caption));
    assert.ok(out.includes(DISCLOSURE), `disclosure lost:\n${out}`);
  }
});

test("the caption is cut at a word, not through one", () => {
  const caption = "Soft glowy skin without the ten step routine and none of the fuss whatsoever today";
  const out = trimKeepingDisclosure(build(caption));
  const first = out.split("\n\n")[0];
  if (first && caption.startsWith(first) && first.length < caption.length) {
    assert.ok(!/[A-Za-z0-9]$/.test(first) || caption[first.length] === " ", `cut mid-word: ${JSON.stringify(first)}`);
  }
});

test("the trial watermark is shed before anything that matters", () => {
  const out = trimKeepingDisclosure(build("D".repeat(200), LINK, "#a #EasyModeAi", "✨ Made with EasyMode"));
  assert.ok(out.includes(LINK));
  assert.ok(out.includes(DISCLOSURE));
  assert.ok(!out.includes("Made with EasyMode"), "the watermark outranked the caption");
});

test("the merchant's own hashtags are shed before the link is", () => {
  const tags = "#skincare #glow #vitaminc #serum #beauty #routine #selfcare #EasyModeAi";
  const out = trimKeepingDisclosure(build("E".repeat(120), LINK, tags));
  assert.ok(out.includes(LINK), "link dropped while hashtags were kept");
  assert.ok(out.includes(DISCLOSURE));
});

test("a URL the copywriter wrote inside the caption is not mistaken for the shop link", () => {
  const caption = "Read the full ingredient story at https://brand.example.com/ingredients before you buy anything else";
  const out = trimKeepingDisclosure(build(caption));
  assert.ok(out.includes(LINK), "the caption's own URL was protected instead of the shop link");
});

test("a post with no link still keeps its disclosure", () => {
  const out = trimKeepingDisclosure(["F".repeat(300), "#glow #EasyModeAi"].join("\n\n"));
  assert.ok(out.length <= MAX);
  assert.ok(out.includes(DISCLOSURE));
});

test("unstructured over-length text is still capped rather than thrown away", () => {
  const out = trimKeepingDisclosure("G".repeat(400));
  assert.equal(out.length, MAX);
});
