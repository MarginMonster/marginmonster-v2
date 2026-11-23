/* A COMMERCIAL PLAYS OVER MUSIC, AT THE LOUDNESS OF EVERYTHING ELSE WE MAKE.
 *
 * The first Commercial made as a customer after the engine fix (2026-11-23): the picture was right — one
 * woman through all five scenes, the real product in every one — and the sound was a narrator and nothing
 * else: -27.5 LUFS, with more than two seconds of dead silence after every line. The same narration mixed
 * offline over a bed with the filter below: -17.4 LUFS before levelling, no silence anywhere, the voice
 * 12–14 dB over the music.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMMERCIAL_BED_VOLUME, COMMERCIAL_LUFS, COMMERCIAL_MUSIC_DEFAULT, commercialBedFilter, commercialMusicPrompt } from "../app/lib/commercial-music.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("the bed follows the feel the member asked for", () => {
  assert.match(commercialMusicPrompt("fast + funny, lead with the price"), /^playful upbeat/);
  assert.match(commercialMusicPrompt("golden-hour rooftop, confident and premium"), /^elegant premium/);
  assert.match(commercialMusicPrompt("cozy at home, make it feel like a gift"), /^warm heartfelt/);
  assert.match(commercialMusicPrompt("HYPE it up, bold cuts"), /^energetic modern/);
  // the member's own words outrank what the product is called
  assert.match(commercialMusicPrompt("premium and elegant", "Kids Toy Blind Box"), /^elegant premium/);
});

test("with nothing said, the product may hint — and otherwise it is the bed nobody would mind", () => {
  assert.match(commercialMusicPrompt("", "Whispers to Dreamland Blind Box Dolls"), /^whimsical light/);
  assert.match(commercialMusicPrompt(null, "Stainless Steel Water Bottle 32oz"), new RegExp("^" + COMMERCIAL_MUSIC_DEFAULT));
  assert.match(commercialMusicPrompt("show it on a kitchen counter", "Stainless Steel Water Bottle"), new RegExp("^" + COMMERCIAL_MUSIC_DEFAULT), "a direction with no feel in it is not overridden by the product's name");
});

test("the narrator is the only voice, and the bed can loop", () => {
  for (const d of ["", "funny", "premium", "something else entirely"]) {
    const p = commercialMusicPrompt(d);
    assert.ok(p.endsWith(", instrumental, no vocals, loopable"), p);
    assert.ok(p.length < 220, "short enough for the music model");
  }
});

test("the mix: the voice at -16, the bed well under it for the whole cut, faded in and out", () => {
  const f = commercialBedFilter(29);
  assert.ok(f.startsWith("[0:a]aresample=44100,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100,apad=whole_dur=29[vo];"), "the voice, padded to the whole cut so the bed never ends it early");
  assert.ok(f.includes(`[1:a]aresample=44100,volume=${COMMERCIAL_BED_VOLUME},afade=t=in:st=0:d=0.5,afade=t=out:st=27.40:d=1.6[bg];`));
  assert.ok(f.endsWith("[vo][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]"), "mixed without amix halving the voice");
  assert.equal(COMMERCIAL_BED_VOLUME, 0.18, "the narrated stories' figure");
  assert.equal(COMMERCIAL_LUFS, -16);
  // a cut too short for the fade still gets a sane filter
  assert.ok(commercialBedFilter(1).includes("afade=t=out:st=0.00:d=1.6"));
  assert.ok(commercialBedFilter(0).includes("apad=whole_dur=1[vo]"));
});

test("the pipeline buys the bed last, never fails the ad over it, and levels the result", () => {
  const src = read("app", "lib", "commercial-ad-pipeline.server.ts");
  assert.ok(src.includes("musicPath = await musicBedToDisk(commercialMusicPrompt(params.direction, params.productTitle));"));
  const at = src.indexOf("musicPath = await musicBedToDisk(");
  assert.ok(src.slice(at - 120, at).includes("try {") && src.slice(at, at + 260).includes("} catch (e) {"), "no bed is yesterday's commercial, not a failed one");
  assert.ok(src.indexOf("musicPath = await musicBedToDisk(") > src.indexOf("const outPath = path.join(rendersDir, fileName);"), "after every scene and line has rendered");
  assert.ok(src.includes("      taglinePath: voPaths[clipPaths.length],\n      musicPath,\n      productJpegPath: jpg,"));
  assert.ok(src.includes("try { await levelFilm(outPath, COMMERCIAL_LUFS); }"));
  assert.ok(src.indexOf("await levelFilm(outPath, COMMERCIAL_LUFS)") < src.indexOf("assertPlayableVideo(outPath);", src.indexOf("await levelFilm(outPath, COMMERCIAL_LUFS)")), "levelled before the file is checked, mirrored and stored");
  // the assembler: the bed goes under the voice it already mixed, and a failed mix keeps the voice
  assert.ok(src.includes("if (voPath && opts.musicPath && fs.existsSync(opts.musicPath)) {"));
  assert.ok(src.includes("\"-filter_complex\", commercialBedFilter(totalSec), \"-map\", \"[aout]\", \"-t\", String(totalSec), withBed]);"));
  assert.ok(src.includes("if (fs.existsSync(withBed) && fs.statSync(withBed).size > 2000) voPath = withBed;"));
});

test("the Archive's wait for a commercial is the time one takes", () => {
  // five scenes drawn, animated and voiced one after another: 9 min 26 s measured on the live site — and the
  // card said "taking longer than usual" from the third minute
  const arc = read("app", "routes", "web.archive.tsx");
  assert.ok(arc.includes("const COMMERCIAL_TYPICAL_SEC = 660;"));
  assert.ok(arc.includes(": (j.type === \"GENERATE_VIDEO_AD\" && p.contentType === \"commercial\") ? COMMERCIAL_TYPICAL_SEC"));
});
