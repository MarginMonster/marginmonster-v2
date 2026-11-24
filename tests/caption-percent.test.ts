/* A CAPTION SAYS "20% OFF", NOT "20 OFF".
 *
 * Every caption sanitizer in the video pipelines deleted the percent sign. The reason was real: in ffmpeg
 * drawtext's default mode a stray "%" makes the whole string draw NOTHING (drawn and looked at, 2026-11-23:
 * "TAKE 20% OFF TODAY" came out blank). The cure was worse than it looked — a merchant's real "20% off",
 * spoken in their own ad, was captioned "TAKE 20 OFF".
 *
 * Each caption drawtext is now literal (expansion=none — drawn and looked at too: the percent sign draws,
 * and a timed caption still appears at its time), and each sanitizer lets "%" through.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drawable as lyricDrawable } from "../app/lib/lyric-sync.ts";
import { drawable as cardDrawable } from "../app/lib/narrated-core.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f: string) => fs.readFileSync(path.join(root, "app", "lib", f), "utf8").replace(/\r\n/g, "\n");

// (a faceless video draws its captions through narrated-core's captionFilters since 2026-11-23 — by way of
//  caption-burn.server.ts's captionGraph since 2026-11-24 — it has no drawtext of its own)
const VIDEO_FILES = ["ugc-ad-pipeline.server.ts", "film-engine.server.ts", "video-edit.server.ts", "narrated-core.ts"];

test("the caption cards and the timed words keep a percent sign — and still agree with each other", () => {
  for (const s of ["Take 20% off today", "100% cotton — $19.99", "Half the class is 50% faster…"]) {
    assert.ok(lyricDrawable(s).includes("%"), s);
    assert.equal(lyricDrawable(s), cardDrawable(s));
  }
  assert.equal(cardDrawable("Take 20% off: today!"), "Take 20% off today!", "the colon still goes — it separates a filter's options");
  assert.equal(cardDrawable("a\\b [x]=1;2"), "ab x12");
});

test("each ALL-CAPS caption sanitizer lets it through", () => {
  for (const f of ["ugc-ad-pipeline.server.ts", "faceless-video.server.ts", "film-engine.server.ts", "video-edit.server.ts"]) {
    const src = read(f);
    assert.ok(src.includes(".replace(/[^\\p{L}\\p{N} .,!?$%’-]/gu, \"\")"), f);
    assert.ok(!src.includes(".replace(/[^\\p{L}\\p{N} .,!?$’-]/gu, \"\")"), `${f}: the old allow-list is gone`);
  }
});

test("every caption drawtext is literal — a kept % would otherwise blank the whole line", () => {
  let total = 0;
  for (const f of VIDEO_FILES) {
    const src = read(f);
    const all = src.split("drawtext=").length - 1;
    const literal = src.split("drawtext=expansion=none:").length - 1;
    assert.ok(all > 0, `${f} draws captions`);
    assert.equal(literal, all, `${f}: ${all - literal} drawtext without expansion=none`);
    assert.ok(!src.includes("%{"), `${f} asks drawtext to expand nothing`);
    total += all;
  }
  assert.equal(total, 6, "ugc ×2, narrated-core ×2, film-engine, video-edit");
  const faceless = read("faceless-video.server.ts");
  assert.ok(!faceless.includes("drawtext="), "a faceless video has no caption drawing of its own");
  // (…drawn the way the stories draw them: caption-burn.server.ts — Hindi and Urdu by the subtitle renderer)
  assert.ok(faceless.includes("const cap = captionGraph(opts.caps, \"bold\", opts.fontFile, 720, 1280);\n  const captions = cap.plain;"), "it draws the same cards the stories do");
});
