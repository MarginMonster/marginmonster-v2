/* THE LENGTH A FILM IS SOLD AT IS THE LENGTH IT COMES OUT AT.
 *
 * Made as a customer on 2026-11-22: the Short Film's Length card read "≈ 32s · 4 shots" (eight seconds a
 * shot), the scene written under it read "≈ 19s film" on its own meter, and the acted films made that day
 * ran 19.5 seconds for four shots. The meter was calibrated on real renders long ago (0.28 s a word); the
 * card was never told.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLIP_MIN_SECONDS, TYPICAL_SHOT_SECONDS, estimateSpeakSeconds } from "../app/lib/speech-meter.ts";
import { secondsFor } from "../app/lib/film-length.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

// the four lines of that film, as the writer wrote them
const LINES = [
  "That one is clearly mine, I saw it through the glass minutes before you arrived here.",
  "Minutes do not matter, I have been standing in this exact spot much longer.",
  "Fine, let's call it a draw then, before we both catch a dreadful cold arguing.",
  "Agreed, Omar, one umbrella was always going to be enough for two.",
];

test("a typical written line is about five seconds on the meter — which is what the card now says a shot is", () => {
  const each = LINES.map((l) => estimateSpeakSeconds(l));
  const total = each.reduce((a, b) => a + b, 0);
  assert.ok(total > 17 && total < 21, `the scene's own meter: ${total.toFixed(1)} s for four shots (the page showed "≈ 19s film")`);
  for (const s of each) assert.ok(Math.abs(s - TYPICAL_SHOT_SECONDS) <= 1.2, `${s.toFixed(1)} s is about ${TYPICAL_SHOT_SECONDS}`);
  assert.equal(Math.round(total / LINES.length), TYPICAL_SHOT_SECONDS);
  assert.ok(TYPICAL_SHOT_SECONDS >= CLIP_MIN_SECONDS, "no clip is shorter than the floor, so no shot is sold as shorter");
  // what the card said, against what was made
  assert.ok(4 * 8 - total > 12, "eight a shot promised 32 s for a 19 s film");
  assert.ok(Math.abs(4 * TYPICAL_SHOT_SECONDS - total) < 2, "five a shot says 20");
});

test("the Length card is fed from what films are measured to run — the figure its slider says", () => {
  const ui = read("app", "routes", "web.film.tsx");
  // (2026-11-25: the Length step is a slider up to five minutes, and the card says what the slider says —
  //  film-length.ts's seconds: 5.8 a shot, as the films of that morning ran; this meter's five was under every one
  //  of them — tests/film-length.test.ts. The meter itself still measures each written line, on the scene board.)
  assert.ok(ui.includes("const lenLabel = (n: number) => `≈ ${filmClock(lenSecs(n))}`;"));
  assert.ok(ui.includes("const lenSecs = (n: number) => secondsFor(lenWay, n, lenPer);"));
  assert.ok(!ui.includes("`≈ ${n * 8}s`"));
  assert.ok(ui.includes("import { estimateSpeakSeconds, CLIP_MAX_SECONDS } from \"../lib/speech-meter\";"));
  // four shots are said at what four shots come to — far nearer the made film than eight a shot was
  const total = LINES.map((l) => estimateSpeakSeconds(l)).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(secondsFor("acted", 4) - total) < Math.abs(4 * 8 - total) / 2, `${secondsFor("acted", 4)} s against ${total.toFixed(1)} s`);
});
