/* ACTED films, after the owner looked at what they flex with and I looked at what they sound like:
 *  - "Short film and moral story having side profile of only one character speaking is weak sauce flex"
 *    (2026-11-17) → the master two-shot is an OPEN two-shot, faces three-quarters to the camera
 *  - a kids film about a rescued baby bird had no bird in it → the master is told what the scene shows
 *  - acted films came out quieter than narrated ones → levelled, with one gain for the whole film */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { levelGain, parseLoudness } from "../app/lib/narrated-core.ts";

const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the two-shot a film is seeded from shows both faces to the camera, not two profiles", () => {
  const img = read("app/lib/image-generation.server.ts");
  const at = img.indexOf("export async function renderSideBySideTwoShot");
  const fn = img.slice(at, img.indexOf("\nexport ", at + 10));
  assert.ok(fn.includes("OPEN two-shot"), "an open two-shot");
  assert.ok(fn.includes("BOTH FACES turned three-quarters toward the camera"));
  assert.ok(fn.includes("never two flat side profiles"));
  assert.ok(!fn.includes("directly facing each other"), "the wording that produced two profiles is gone");
  // …and it is still a two-shot with both in frame (the rule the lip-sync depends on)
  assert.ok(fn.includes("This is NOT an over-the-shoulder shot"));
});

test("the two-shot is told what the scene shows, inside the same framing", () => {
  const img = read("app/lib/image-generation.server.ts");
  assert.ok(img.includes("THE MOMENT this shot shows:"));
  assert.ok(img.includes("where it conflicts with the framing described here, the framing wins"));
  const eng = read("app/lib/film-dialogue.server.ts");
  // (…except a horror film's last shot in a place of its own: that place is drawn with only the two in it, and the
  //  thing is added by the reveal — acted-staging.ts → revealPicture)
  // (…with the story's own description of anybody else it names: the woman in the lake came out as a swimmer)
  // (…and, since 2026-11-25, whether the film's THING is in view there, so its own picture rides along — acted-sighting.test.ts)
  assert.ok(eng.includes("i === 0 ? abs(approvedFrames[0]) : undefined, lastReveal && tr === \"location\" ? undefined : withLooks(scene.visual), thingHere)"), "the engine passes the scene's picture");
});

test("a film's loudness is read from ffmpeg's own report", () => {
  const report = `[Parsed_loudnorm_0 @ 0x1]\n{\n\t"input_i" : "-19.81",\n\t"input_tp" : "-5.22",\n\t"input_lra" : "4.10",\n\t"input_thresh" : "-30.01",\n\t"output_i" : "-16.03"\n}\n`;
  assert.deepEqual(parseLoudness(report), { i: -19.81, tp: -5.22 });
  assert.equal(parseLoudness("no report here"), null);
  assert.equal(parseLoudness(`"input_i" : "-inf",\n"input_tp" : "-inf"`), null, "a silent film has no loudness to move");
});

test("one gain for the whole film: up to the target, never wild, nothing when it is already there", () => {
  assert.equal(levelGain({ i: -19.81, tp: -5.22 }), 3.8, "the real kids film: 3.8 dB up");
  assert.equal(levelGain({ i: -16.27, tp: -1.34 }), 0, "the real horror film was already there");
  assert.equal(levelGain({ i: -16.9, tp: -3 }), 0, "within a decibel is left alone");
  assert.equal(levelGain({ i: -40, tp: -20 }), 12, "a near-silent film is not blown up by 24 dB");
  assert.equal(levelGain({ i: -6, tp: 0 }), -10, "and a hot one comes down");
  assert.equal(levelGain({ i: 10, tp: 0 }), -12);
});

test("the acted engine levels a film before it captions it", () => {
  const eng = read("app/lib/film-dialogue.server.ts");
  const a = eng.indexOf(`await import("./film-loudness.server")`);
  const b = eng.indexOf(`await import("./film-captions.server")`);
  assert.ok(a > 0 && b > a, "loudness first (it re-muxes the sound), captions after (they re-encode the picture)");
  const lvl = read("app/lib/film-loudness.server.ts");
  assert.ok(lvl.includes(`"-c:v", "copy"`), "the picture is not touched");
  assert.ok(lvl.includes("alimiter=limit=0.89"), "peaks the gain pushes over the top are caught");
});
