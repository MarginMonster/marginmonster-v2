/* THE WORDS DRAWN ONTO AN IMAGE AD KEEP THEIR "$" AND THEIR "%".
 *
 * Made as a customer, 2026-11-23: an image ad asked to lead with the price. The copy came back right —
 * "16 figures, one $43.14 set" — and the crisp, drawn layout was thrown away for the slower generative one.
 * Why: the sanitizer for drawn text had no "$" in its allow-list, so the headline was drawn "ONE 43.14 SET",
 * and the ad's own check then found "$43.14" missing.
 *
 * The same sanitizer deleted every "%", because in drawtext's default mode a stray "%" makes the whole
 * string draw NOTHING (verified with ffmpeg 8.1 and this repo's Poppins: "20% OFF FIRST ORDER" came out
 * blank; with expansion=none it drew). So a merchant's real "20% off" was drawn "20 OFF" and "100% cotton"
 * "100 COTTON". Every drawtext the image composites run is now literal, and both signs are kept.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "app", "lib", "image-generation.server.ts"), "utf8").replace(/\r\n/g, "\n");

/** The REAL sanitizer, lifted out of the source (it is a pure one-expression arrow function). */
const at = src.indexOf("const dt = (s: string) =>");
const end = src.indexOf(".trim();", at) + ".trim();".length;
const dt = new Function(`${src.slice(at, end).replace("(s: string)", "(s)")}\nreturn dt;`)() as (s: string) => string;

test("a price keeps its currency sign", () => {
  assert.equal(dt("16 figures, one $43.14 set"), "16 figures, one $43.14 set");
  assert.equal(dt("Only €12,50 today"), "Only €12,50 today");
  assert.equal(dt("£5 & ¥900 & ₹500"), "£5 & ¥900 & ₹500");
});

test("a percent sign is kept; what breaks a filter is still removed", () => {
  assert.equal(dt("20% off first order"), "20% off first order");
  assert.equal(dt("100% cotton"), "100% cotton");
  // the colon separates a filter's options; a backslash escapes; brackets, semicolons and equals are filter syntax
  assert.equal(dt("Sale: now!"), "Sale now!");
  assert.equal(dt("a\\b [x]=1;2 {y} (z)"), "ab x12 y z");
  // a straight apostrophe would be swallowed inside text='…' — it is folded to the typographic one
  assert.equal(dt("don't settle"), "don’t settle");
  assert.equal(dt("  spaced  "), "spaced");
});

test("every drawtext the image composites run is literal — or a kept % would blank the whole string", () => {
  assert.ok(src.includes("const literal = args.map((a) => (a.includes(\"drawtext=\") ? a.split(\"drawtext=\").join(\"drawtext=expansion=none:\") : a));"));
  assert.ok(src.includes("const p = spawn(bin, literal, {"));
  // that helper is the ONLY place this file starts ffmpeg with a filter that can draw text
  assert.equal(src.split("spawn(").length - 1, 1, "one spawn, inside runFfmpegStill");
  assert.ok(src.split("runFfmpegStill(").length - 1 > 20, "the composites all go through it");
  // nothing here asks drawtext to expand anything, so literal mode takes nothing away
  assert.deepEqual(src.split("\n").filter((l) => l.includes("drawtext=") && l.includes("%{")), []);
  assert.ok(!/drawtext=[^`"']*expansion=(?!none)/.test(src));
});
