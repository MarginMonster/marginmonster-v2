/* The ad pack: a finished video's captions as an SRT file, and its headline + primary text held to the
 * length each field shows in full. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { srtCues, srtTime, toSrt, fitCopy, AD_COPY_LIMITS } from "../app/lib/ad-pack.ts";

const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const w = (word: string, start: number, end: number) => ({ word, start, end });

test("the SRT clock is HH:MM:SS,mmm", () => {
  assert.equal(srtTime(0), "00:00:00,000");
  assert.equal(srtTime(1.2345), "00:00:01,235");
  assert.equal(srtTime(3723.5), "01:02:03,500");
  assert.equal(srtTime(-2), "00:00:00,000");
});

test("a sentence end, a pause, a long line and a long hold each start a new cue", () => {
  const words = [
    w("Nate,", 0.152, 0.433), w("we", 1.137, 1.25), w("can't", 1.3, 1.52), w("keep", 1.55, 1.7), w("paying", 1.72, 2.0),
    w("to", 2.02, 2.1), w("heat", 2.12, 2.35), w("a", 2.37, 2.4), w("building.", 2.42, 2.9), w("It's", 3.0, 3.2), w("time.", 3.25, 3.6),
  ];
  const cues = srtCues(words);
  assert.equal(cues[0].text, "Nate,", "a 0.7 s pause after the first word ends its cue");
  assert.ok(cues.every((c) => c.text.length <= 32), "one short line each");
  assert.ok(cues.some((c) => c.text.endsWith("building.")), "a sentence closes its cue");
  assert.equal(cues[cues.length - 1].text, "It's time.");
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].t0 >= cues[i - 1].t1, "cues never overlap");
  assert.ok(cues.every((c) => c.t1 > c.t0));
});

test("a short cue is held long enough to read, but never into the next", () => {
  const cues = srtCues([w("Hi.", 0, 0.2), w("Okay", 0.5, 0.7), w("then.", 0.72, 0.9)]);
  assert.equal(cues.length, 2);
  assert.ok(cues[0].t1 <= cues[1].t0, "held only up to the next cue");
  assert.ok(cues[1].t1 - cues[1].t0 >= 0.8 - 1e-9, "the last cue is held the full minimum");
});

test("junk words (empty, reversed times) are dropped and nothing heard makes no cues", () => {
  assert.deepEqual(srtCues([]), []);
  assert.deepEqual(srtCues([w("  ", 0, 1), w("x", 2, 1)]), []);
});

test("the file is numbered cues with a blank line between", () => {
  const srt = toSrt([{ t0: 0, t1: 1.5, text: "Hello there." }, { t0: 1.6, t1: 2.4, text: "Bye." }]);
  assert.equal(srt, "1\n00:00:00,000 --> 00:00:01,500\nHello there.\n\n2\n00:00:01,600 --> 00:00:02,400\nBye.\n");
});

test("copy is held to its field without cutting a word", () => {
  assert.equal(AD_COPY_LIMITS.headline, 40);
  assert.equal(AD_COPY_LIMITS.primary, 125);
  assert.equal(fitCopy("Short and sweet", 40), "Short and sweet");
  const long = "Your morning, upgraded. Fresh beans roasted every week in small batches for people who care about the cup. Order today and taste it.";
  const fit = fitCopy(long, 125);
  assert.ok(fit.length <= 125);
  assert.ok(/[.!?]$/.test(fit), "ends on a whole sentence when one fits");
  const words = fitCopy("Handmade ceramic mugs glazed by hand in a tiny studio by the sea", 40);
  assert.ok(words.length <= 40 && !words.endsWith(" "));
  assert.ok("Handmade ceramic mugs glazed by hand in a tiny studio by the sea".startsWith(words), "whole words only");
});

test("the pack is wired: captions + copy intents, kept files, grounded copy", () => {
  const route = read("app/routes/web.archive.tsx");
  assert.ok(route.includes('intent === "adsrt"') && route.includes('intent === "adcopy"'));
  assert.ok(/new Set\(\["adsize", "adsrt", "adcopy"[^\]]*\]\)/.test(route), "no shelf reload for any part of the pack");
  const srv = read("app/lib/ad-pack.server.ts");
  assert.ok(srv.includes("CLAIMS_GUARDRAIL"), "copy follows the shared claims guardrail");
  assert.ok(srv.includes("createWhisperx(`${base}/renders/${audioName}`, null)"), "the language is heard, not assumed");
  assert.ok(/updateMany\(\{\s*where: \{ id: a\.id, shopId: opts\.shopId, metaJson: a\.metaJson \}/.test(srv), "the copy is kept with a pinned write");
  const renders = read("app/routes/renders.$file.tsx");
  assert.ok(renders.includes("|srt)$/"), "the captions file is served");
  assert.ok(renders.includes("Content-Disposition"), "and saved, not opened as text");
});
