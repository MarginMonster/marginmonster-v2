/* THE TWO FACES A PHONE'S CAMERA SCREEN IS SET IN (app/lib/overlay-fonts.ts).
 *
 * The owner's screenshot of his own phone's camera (2026-11-24) sets its labels in a light sans and its
 * numbers in fixed-width figures; the repo has one font, Poppins Bold. Two open faces are fetched once to the
 * disk — and a take must never wait on them or fail for them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OVERLAY_FACES, looksLikeFace } from "../app/lib/overlay-fonts.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("two faces, each from a pinned release first and a second place after it", () => {
  assert.deepEqual(OVERLAY_FACES.map((f) => f.key), ["thin", "mono"]);
  for (const f of OVERLAY_FACES) {
    assert.ok(/\.(otf|ttf)$/.test(f.file), f.file);
    assert.ok(f.sources.length >= 2, `${f.key}: more than one source`);
    // a tag, never a moving branch: the file cannot be moved from under us
    for (const u of f.sources) assert.ok(/^https:\/\/(raw\.githubusercontent\.com|cdn\.jsdelivr\.net)\//.test(u) && /(\/v\d|@v\d)/.test(u) && !/\/(main|master)\//.test(u), u);
    assert.ok(f.sources.every((u) => u.endsWith(f.file)));
    assert.equal(new Set(f.sources.map((u) => new URL(u).host)).size, f.sources.length, "two different hosts");
  }
});

test("what is kept must BE a font: big enough, and opening like one", () => {
  const [thin] = OVERLAY_FACES;
  const font = (n: number, head: number[]) => Object.assign(new Uint8Array(n), head);
  assert.equal(looksLikeFace(thin, font(200_000, [0x4f, 0x54, 0x54, 0x4f])), true, "OTTO");
  assert.equal(looksLikeFace(thin, font(200_000, [0, 1, 0, 0])), true, "TrueType");
  assert.equal(looksLikeFace(thin, font(200_000, [0x3c, 0x21, 0x44, 0x4f])), false, "an error page under a font's name");
  assert.equal(looksLikeFace(thin, font(9_000, [0x4f, 0x54, 0x54, 0x4f])), false, "a stub");
  assert.equal(looksLikeFace(thin, null), false);
});

test("a take never waits on a font and never fails for one", () => {
  const srv = read("app", "lib", "overlay-fonts.server.ts");
  // whatever is on the disk now is the answer; a missing face falls back to the app's own
  assert.ok(srv.includes("return { font: poppins(), thin: thin || poppins(), mono: mono || thin || poppins(), fetched: { thin: !!thin, mono: !!mono } };"));
  // one fetch at a time per face; never thrown out of
  assert.ok(srv.includes("const running = fetching.get(face.key);\n  if (running) return running;"));
  assert.ok(srv.includes("else void all;"), "with no wait asked for, the fetch runs behind the take");
  assert.ok(!/throw new Error/.test(srv), "nothing here can fail a take");
  // the bytes are checked before they are kept, and written beside the file first
  assert.ok(srv.includes("if (!looksLikeFace(face, buf)) {") && srv.includes("fs.renameSync(part, f);"));
});
