/* The ad pack: one finished video in every shape ad networks use, nothing cut off (blur fill). These run
 * the real ffmpeg on a synthetic vertical clip and read the results back: right size, sound kept, made
 * once and then served from the copy, and the archive action only ever touches this shop's own videos. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { AD_SIZES, AD_SIZE_KEYS, isAdSize, sameShape, sizeGraph } from "../app/lib/ad-sizes.ts";
import { sizedVideo } from "../app/lib/ad-sizes.server.ts";

const require = createRequire(import.meta.url);
const ff: string = require("ffmpeg-static");
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

function probe(file: string) {
  const e = spawnSync(ff, ["-hide_banner", "-i", file], { encoding: "utf8" }).stderr || "";
  const v = e.match(/Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/);
  return { w: v ? +v[1] : 0, h: v ? +v[2] : 0, audio: /Audio:/.test(e) };
}

test("the four shapes, and the fill only when the shape differs", () => {
  assert.deepEqual(AD_SIZE_KEYS, ["9x16", "4x5", "1x1", "16x9"]);
  assert.equal(AD_SIZES["4x5"].w * 5, AD_SIZES["4x5"].h * 4);
  assert.ok(isAdSize("1x1") && !isAdSize("2x3") && !isAdSize("__proto__"));
  assert.ok(sameShape(720, 1280, 1080, 1920));
  assert.ok(!sameShape(720, 1280, 1080, 1350));
  assert.ok(!sizeGraph(720, 1280, 1080, 1920).includes("boxblur"), "same shape: just a scale");
  const g = sizeGraph(720, 1280, 1080, 1350);
  assert.ok(g.includes("boxblur") && g.includes("force_original_aspect_ratio=decrease"), "different shape: whole picture on a blur");
  assert.ok(g.endsWith("[v]"));
});

test("a vertical clip comes out in every shape, with its sound, made once", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adsize-"));
  try {
    const src = path.join(dir, "tm-test.mp4");
    const mk = spawnSync(ff, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=360x640:d=2:r=24", "-f", "lavfi", "-i", "sine=f=440:d=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src], { encoding: "utf8" });
    assert.equal(mk.status, 0, mk.stderr);
    for (const k of AD_SIZE_KEYS) {
      const r = await sizedVideo("/renders/tm-test.mp4", k, { dir, ffmpeg: ff });
      assert.ok(r.ok, `${k}: ${!r.ok ? r.error : ""}`);
      if (!r.ok) continue;
      assert.equal(r.url, `/renders/tm-test-${k}.mp4`);
      const p = probe(path.join(dir, path.basename(r.url)));
      assert.equal(p.w, AD_SIZES[k].w, `${k} width`);
      assert.equal(p.h, AD_SIZES[k].h, `${k} height`);
      assert.ok(p.audio, `${k} keeps the sound`);
    }
    const t0 = Date.now();
    const again = await sizedVideo("/renders/tm-test.mp4", "4x5", { dir, ffmpeg: ff });
    assert.ok(again.ok && Date.now() - t0 < 500, "second ask is served from the copy");
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith("tmp-")), [], "no half-written files left");
    // anything that is not one of our own stored videos is refused
    assert.deepEqual(await sizedVideo("https://example.com/x.mp4", "1x1", { dir, ffmpeg: ff }), { ok: false, error: "not-local" });
    assert.deepEqual(await sizedVideo("/renders/../secret.mp4", "1x1", { dir, ffmpeg: ff }), { ok: false, error: "not-local" });
    assert.deepEqual(await sizedVideo("/renders/nope.mp4", "1x1", { dir, ffmpeg: ff }), { ok: false, error: "missing" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the archive's size action is this shop's videos only", () => {
  const src = read("app/routes/web.archive.tsx");
  const at = src.indexOf('if (intent === "adsize")');
  assert.ok(at > 0);
  const block = src.slice(at, at + 1400);
  assert.ok(block.includes("shopId: shop.id"), "scoped to the shop");
  assert.ok(block.includes('type: "VIDEO_AD"'), "videos only");
  assert.ok(block.includes("isAdSize("), "only the four shapes");
});
