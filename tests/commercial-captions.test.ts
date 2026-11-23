/* A COMMERCIAL SAYS WHAT IT SAYS WITH THE SOUND OFF.
 *
 * Its whole story was in a narrator's voice: five scenes with a line each, then the product with a tagline
 * spoken over it — and not one of those words on screen. Most people meet an ad muted. The films already
 * had a caption step that takes "what is said in shot i" and "how long shot i runs" (captionFilm); a
 * commercial is exactly that shape, and nothing called it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMMERCIAL_BEAT_SEC, COMMERCIAL_PACK_SEC, commercialCaptionPlan } from "../app/lib/commercial-captions.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("one line per scene, then the tagline over the closing shot", () => {
  const p = commercialCaptionPlan(["A cozy night in.", "Twelve surprises inside.", "Which one came home?", "Made to perch anywhere.", "A whole set, ready to display."], "Home Never Felt Cozier", 5);
  assert.deepEqual(p.lines, ["A cozy night in.", "Twelve surprises inside.", "Which one came home?", "Made to perch anywhere.", "A whole set, ready to display.", "Home Never Felt Cozier"]);
  assert.deepEqual(p.clipDurs, [5, 5, 5, 5, 5, 4]);
  assert.equal(p.clipDurs.reduce((a, b) => a + b, 0), 29, "the 29 seconds a five-scene commercial runs");
  assert.equal(COMMERCIAL_BEAT_SEC, 5);
  assert.equal(COMMERCIAL_PACK_SEC, 4);
});

test("a line stays over its own scene whatever is missing", () => {
  // a scene with no line keeps its place as an empty one — the next line must not slide onto it
  const gap = commercialCaptionPlan(["First.", "", null, "Fourth."], "Tag", 4);
  assert.deepEqual(gap.lines, ["First.", "", "", "Fourth.", "Tag"]);
  assert.deepEqual(gap.clipDurs, [5, 5, 5, 5, 4]);
  // fewer scenes rendered than were written: only the rendered ones are captioned
  assert.deepEqual(commercialCaptionPlan(["a", "b", "c", "d", "e"], "t", 3).lines, ["a", "b", "c", "t"]);
  // more scenes than lines: the extra scenes are silent ones, in place
  assert.deepEqual(commercialCaptionPlan(["a"], "t", 3), { lines: ["a", "", "", "t"], clipDurs: [5, 5, 5, 4] });
  // no tagline: the closing shot simply has no words (and still has its length)
  assert.deepEqual(commercialCaptionPlan(["a"], undefined, 1), { lines: ["a", ""], clipDurs: [5, 4] });
  // whitespace is tidied, nothing else is touched
  assert.deepEqual(commercialCaptionPlan(["  Two\n lines   here "], " Tag  line ", 1).lines, ["Two lines here", "Tag line"]);
  assert.deepEqual(commercialCaptionPlan([], "t", 0), { lines: ["t"], clipDurs: [4] });
});

test("the assembler and the caption step read the same two lengths", () => {
  const src = read("app", "lib", "commercial-ad-pipeline.server.ts");
  assert.ok(src.includes("const clipSecs = opts.clipPaths.map((_, i) => opts.clipSecs?.[i] ?? opts.clipSec ?? COMMERCIAL_BEAT_SEC);"));
  assert.ok(src.includes("const packSec = opts.packshotSec ?? COMMERCIAL_PACK_SEC;"));
});

test("the ad is captioned last — after the music and the level — and can never be lost to it", () => {
  const src = read("app", "lib", "commercial-ad-pipeline.server.ts");
  const at = src.indexOf("const cap = commercialCaptionPlan(plan.beats.map((b) => b.narration), plan.tagline, clipPaths.length);");
  assert.ok(at > 0);
  assert.ok(at > src.indexOf("await levelFilm(outPath, COMMERCIAL_LUFS)"), "the sound is finished first; drawing the words re-encodes the picture only");
  assert.ok(at < src.indexOf("assertPlayableVideo(outPath);", at), "and the finished file is still checked before it is stored");
  const call = src.slice(at, at + 520);
  assert.ok(call.includes("filmPath: outPath, lines: cap.lines, clipDurs: cap.clipDurs, style: \"subtitles\","));
  assert.ok(call.includes("english: normalizeContentLang(contentLang) === \"en\", jobId: params.jobId, listenMs: 120_000,"), "timed to the voice in English; by scene length in any other language; two minutes of listening at most");
  // captionFilm's own promise, which this relies on: it returns "off" and leaves the file when it cannot draw
  const cap = read("app", "lib", "film-captions.server.ts");
  assert.ok(cap.includes("console.error(`[captions] failed — the film ships without captions:"));
  assert.ok(cap.includes("\"-c:a\", \"copy\""), "the sound is copied, never re-made");
});
