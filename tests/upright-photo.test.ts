/* PHONE PHOTOS ARE STORED SIDEWAYS (owner report 2026-11-18: "it keeps rotating the finish image").
 *
 * An iPhone stores a portrait photo as landscape pixels plus an EXIF Orientation tag. Browsers obey the tag,
 * image models do not — so a portrait photo came back from "Edit photo" as a landscape picture lying on its
 * side. Uploads are now turned upright on save, and the tag is dropped so nothing turns them twice. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { jpegOrientation, orientationFilter } from "../app/lib/exif-orientation.ts";
import { uprightPhoto } from "../app/lib/upright-photo.server.ts";

const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** An APP1 "Exif" segment holding only IFD0 → Orientation. */
function exifSegment(orientation: number, order: "II" | "MM"): Buffer {
  const le = order === "II";
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write(order, 0, "latin1");
  if (le) { tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4); tiff.writeUInt16LE(1, 8); } else { tiff.writeUInt16BE(42, 2); tiff.writeUInt32BE(8, 4); tiff.writeUInt16BE(1, 8); }
  const e = 10;
  if (le) { tiff.writeUInt16LE(0x0112, e); tiff.writeUInt16LE(3, e + 2); tiff.writeUInt32LE(1, e + 4); tiff.writeUInt16LE(orientation, e + 8); }
  else { tiff.writeUInt16BE(0x0112, e); tiff.writeUInt16BE(3, e + 2); tiff.writeUInt32BE(1, e + 4); tiff.writeUInt16BE(orientation, e + 8); }
  const body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const head = Buffer.alloc(4);
  head[0] = 0xff; head[1] = 0xe1; head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}
/** The JPEG with an Exif orientation segment put right after its JFIF header (where a camera puts it). */
function withOrientation(jpeg: Buffer, orientation: number, order: "II" | "MM" = "II"): Buffer {
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + jpeg.readUInt16BE(4); // after APP0
  return Buffer.concat([jpeg.subarray(0, at), exifSegment(orientation, order), jpeg.subarray(at)]);
}
const fake = (orientation: number, order: "II" | "MM" = "II") => withOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), orientation, order);

test("the orientation tag is read from either byte order, after a JFIF header or without one", () => {
  for (let o = 1; o <= 8; o++) {
    assert.equal(jpegOrientation(fake(o, "II")), o, `II ${o}`);
    assert.equal(jpegOrientation(fake(o, "MM")), o, `MM ${o}`);
  }
  const jfif = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
  assert.equal(jpegOrientation(jfif), 1, "no tag → upright");
  assert.equal(jpegOrientation(withOrientation(jfif, 6)), 6, "a tag after the JFIF header is found");
});

test("anything that is not a readable JPEG tag reads as upright, never throws", () => {
  assert.equal(jpegOrientation(Buffer.alloc(0)), 1);
  assert.equal(jpegOrientation(Buffer.from("\x89PNG\r\n\x1a\n", "latin1")), 1);
  assert.equal(jpegOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff])), 1, "a length past the end");
  assert.equal(jpegOrientation(fake(9)), 1, "an out-of-range value");
  const cut = fake(6); assert.equal(jpegOrientation(cut.subarray(0, cut.length - 12)), 1, "a truncated segment");
});

test("each orientation maps to the turn that stands it upright (ImageMagick's -auto-orient table)", () => {
  assert.equal(orientationFilter(1), null);
  assert.equal(orientationFilter(0), null);
  assert.equal(orientationFilter(2), "hflip");
  assert.equal(orientationFilter(3), "hflip,vflip");
  assert.equal(orientationFilter(4), "vflip");
  assert.equal(orientationFilter(5), "transpose=0");
  assert.equal(orientationFilter(6), "transpose=1");
  assert.equal(orientationFilter(7), "transpose=3");
  assert.equal(orientationFilter(8), "transpose=2");
});

// Every ffmpeg on this machine: the bundled one and the system one (newer builds read the tag themselves —
// the photo must still be turned exactly once).
const builds = (() => {
  const out: string[] = [];
  try { const s = createRequire(import.meta.url)("ffmpeg-static") as string; if (s && fs.existsSync(s)) out.push(s); } catch { /* not installed */ }
  for (const p of ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"]) if (fs.existsSync(p)) out.push(p);
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["ffmpeg"], { encoding: "utf8" });
  if (which.status === 0) for (const l of which.stdout.split(/\r?\n/)) if (l.trim() && fs.existsSync(l.trim())) out.push(l.trim());
  return [...new Set(out)];
})();

/** A 64×32 JPEG: left half red, right half blue (the way a phone stores a portrait shot: landscape). */
function sidewaysShot(bin: string, dir: string): Buffer {
  const f = path.join(dir, "shot.jpg");
  const r = spawnSync(bin, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=32x32",
    "-f", "lavfi", "-i", "color=c=blue:s=32x32", "-filter_complex", "[0][1]hstack", "-frames:v", "1", "-q:v", "2", f]);
  assert.equal(r.status, 0, String(r.stderr));
  return fs.readFileSync(f);
}
/** Width, height and the average colour of the top and bottom quarters of a JPEG. */
function look(bin: string, jpeg: Buffer, dir: string) {
  const f = path.join(dir, "look.jpg");
  fs.writeFileSync(f, jpeg);
  const probe = spawnSync(bin, ["-hide_banner", "-noautorotate", "-i", f], { encoding: "utf8" });
  const m = /, (\d+)x(\d+)/.exec(probe.stderr);
  assert.ok(m, probe.stderr);
  const w = Number(m[1]), h = Number(m[2]);
  const raw = spawnSync(bin, ["-hide_banner", "-loglevel", "error", "-noautorotate", "-i", f, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 24 });
  const px = raw.stdout as Buffer;
  const avg = (y0: number, y1: number) => {
    let r = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 3; r += px[i]; b += px[i + 2]; n++; }
    return { r: r / n, b: b / n };
  };
  return { w, h, top: avg(0, Math.floor(h / 4)), bottom: avg(h - Math.floor(h / 4), h) };
}

for (const bin of builds) {
  test(`a portrait phone photo is stood upright, once, with no tag left on it (${path.basename(path.dirname(bin))}/${path.basename(bin)})`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "upright-"));
    try {
      const shot = withOrientation(sidewaysShot(bin, dir), 6); // "turn me 90° clockwise to view"
      assert.equal(jpegOrientation(shot), 6);
      const out = await uprightPhoto(shot, bin);
      assert.notEqual(out, shot, "the photo was re-written");
      assert.equal(jpegOrientation(out), 1, "no orientation tag left — a browser must not turn it again");
      assert.ok(!out.includes(Buffer.from("Exif\0\0", "latin1")), "no Exif segment at all");
      const v = look(bin, out, dir);
      assert.deepEqual([v.w, v.h], [32, 64], "portrait now, not landscape");
      // turned 90° clockwise: the stored LEFT (red) is now the TOP, the stored right (blue) the bottom
      assert.ok(v.top.r > 180 && v.top.b < 80, `top is red: ${JSON.stringify(v.top)}`);
      assert.ok(v.bottom.b > 180 && v.bottom.r < 80, `bottom is blue: ${JSON.stringify(v.bottom)}`);

      // orientation 8 (turn counter-clockwise): the stored left (red) ends at the bottom
      const v8 = look(bin, await uprightPhoto(withOrientation(sidewaysShot(bin, dir), 8, "MM"), bin), dir);
      assert.deepEqual([v8.w, v8.h], [32, 64]);
      assert.ok(v8.bottom.r > 180 && v8.top.b > 180, "turned the other way");

      // already upright → the very same bytes back
      const plain = sidewaysShot(bin, dir);
      assert.equal(await uprightPhoto(plain, bin), plain);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("no ffmpeg: the upload is kept as it came (never refused over this)", async () => {
  const shot = fake(6);
  assert.equal(await uprightPhoto(shot, null), shot);
});

test("every place a user's photo is saved stands it upright first", () => {
  const studio = read("app/routes/web.studio.tsx");
  const saves = studio.match(/writeFileSync\([^\n]*arrayBuffer\(\)[^\n]*\)/g) || [];
  const photoSaves = saves.filter((s) => !/\bvid\b/.test(s) && !s.includes("await uprightPhoto("));
  assert.equal(photoSaves.length, 0, `photo saves that skip uprightPhoto: ${photoSaves.join(" | ")}`);
  assert.ok((studio.match(/await uprightPhoto\(/g) || []).length >= 5, "backdrop, frame, product photo, backdrop (video), second photo");
  assert.ok(read("app/routes/api.buddy-upload.tsx").includes("await uprightPhoto("), "chat uploads");
  assert.ok(read("app/routes/api.character.tsx").includes("await uprightPhoto("), "character / presenter photos");
});
