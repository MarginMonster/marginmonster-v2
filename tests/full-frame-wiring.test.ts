/* A TOLD PICTURE WITH AN EMPTY BAND IS DRAWN AGAIN, AND NEVER SHOWN WITH ITS BAND (2026-11-26).
 *
 * The live still story "What His Hands Remember" kept, for its first scene, the bakery drawn as a landscape on an empty
 * cream band — and showed it for eleven seconds. Every told picture is now measured (app/lib/full-frame.ts) where it is
 * looked at (narrated-story.server.ts → narratedSceneSeeds): the band is a fault in its check (story-picture.ts →
 * storyFaults), named to the next go (storyFix), counted toward drawing the scene without its place's sheet, and a
 * picture still banded after its goes is cut to its content and covers the frame. The acted film's masters are covered
 * where that leaves a right picture (film-dialogue.server.ts → removeLetterbox). Pins for wiring a test cannot run. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type FrameBand } from "../app/lib/full-frame.ts";
import { PLACE_FULL_SIZE, UNCLOTHED_FAULT, keptFaults, placeNote, storyFaults, storyFix, type StoryCheck } from "../app/lib/story-picture.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => fs.readFileSync(path.join(here, "..", ...p), "utf8").replace(/\r\n/g, "\n");
const TALL = { w: 1536, h: 2752 };
const thin: FrameBand = { sides: ["top"], doubled: [], box: { x: 0, y: 0.05, w: 1, h: 0.95 }, keeps: 0.95, frame: "tall", size: TALL };
const bakery: FrameBand = { sides: ["top", "bottom"], doubled: ["top"], box: { x: 0, y: 0.31, w: 1, h: 0.36 }, keeps: 0.36, frame: "tall", size: TALL };

test("a band is a fault in the check: weighed like a split picture, named first to the next go, written on the piece", () => {
  const clean: StoryCheck = { seen: [true], panels: false };
  assert.equal(storyFaults(clean), 0);
  assert.equal(storyFaults({ ...clean, band: bakery }), 4);
  assert.equal(storyFaults({ ...clean, band: thin }), 1, "a sliver that cutting off leaves right");
  assert.equal(storyFaults({ ...clean, band: bakery, panels: true }), storyFaults({ ...clean, panels: true }) + 4);
  // every other fault at once still weighs less than somebody unclothed
  const all: StoryCheck = { seen: [false, false, false], panels: true, extra: true, outside: true, lens: ["X"], grimy: true, inset: true, notNight: true, band: bakery };
  assert.equal(storyFaults(all), 34);
  assert.ok(UNCLOTHED_FAULT > storyFaults(all));
  // the redraw: the band's words first of the faults
  const fix = storyFix({ ...clean, band: { ...thin, sides: ["bottom"] }, panels: true }, ["Humphrey"]);
  assert.ok(fix.startsWith(" The last try left an empty band across the bottom — draw ONE picture that fills the whole tall frame, top to bottom. The last try was split into panels"), fix);
  assert.equal(storyFix(clean, ["Humphrey"]), "", "no band, nothing said");
  // the piece's record says a scene was kept cut from a banded picture
  assert.deepEqual(keptFaults([{ ...clean, band: bakery, who: ["Humphrey"] }, null]), [{ scene: 1, missing: [], band: true }]);
  assert.deepEqual(keptFaults([{ ...clean, who: [] }]), []);
  // …and the lenient path's picture, flagged with the check it is given (review of S14): no cast looked for, the band
  assert.equal(storyFaults({ seen: [], panels: false, band: bakery }), 4);
  assert.deepEqual(keptFaults([null, { seen: [], panels: false, band: bakery, who: [] }]), [{ scene: 2, missing: [], band: true }]);
});

test("a place's sheet is a scale model only on the sheet", () => {
  assert.ok(placeNote(2, { name: "the bakery", look: "a small old bakery" }).endsWith(` ${PLACE_FULL_SIZE}`));
  assert.ok(PLACE_FULL_SIZE.includes("here it is the REAL place at full size") && PLACE_FULL_SIZE.includes("never a cut-away model with plain background above it, below it or around it"));
});

test("wired: every told picture is measured, a band is a fault and its sheet is let go, never shown with a band", () => {
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("import { bandOf, coverBand } from \"./full-frame.server\";") && nar.includes("import { bandCuttable, bandFault } from \"./full-frame\";"));
  assert.ok(nar.includes("${cam ? ` ${cameraLine(cam, aspect)}` : \"\"}"), "the frame's shape in the picture's ask");
  const loop = nar.slice(nar.indexOf("for (let a = 0; a < 3 && !img; a++) {"), nar.indexOf("out[i] = img;"));
  assert.ok(loop.includes("const band = await bandOf(got);\n        if (band && withPlace) framedGoes++;\n        const looked = await lookAt(got);\n        const seenAs: StoryCheck | null = band ? { ...(looked || { seen: castPics.map(() => true), panels: false }), band } : looked;\n        const faults = seenAs ? storyFaults(seenAs) : 0;"));
  // measured after the black-bar and framed-panel checks, before the look's verdict
  assert.ok(loop.indexOf("if (got && (await letterboxed(got)))") < loop.indexOf("const band = await bandOf(got);"));
  assert.ok(loop.indexOf("if (got && withPlace && (await framedPanel(got)))") < loop.indexOf("const band = await bandOf(got);"));
  assert.ok(loop.indexOf("const band = await bandOf(got);") < loop.indexOf("if (!faults) { img = got; break; }"));
  // after the goes: covered, its fault gone only when cutting it off leaves a right picture
  assert.ok(loop.includes("if (!img && best?.check.band) {") && loop.includes("const cut = await bandOf(was.img);\n        const covered = cut ? await coverBand(was.img, cut) : null;"), "measured again: an edit may have dressed the picture kept");
  assert.ok(loop.includes("if (!cut) { best = { img: was.img, faults: storyFaults(rest), check: rest }; if (!best.faults) img = was.img; }"), "no band left: no band fault");
  // (…and the cover read again: a side the first read missed leaves it flagged — review of S14)
  assert.ok(loop.includes("const left = await bandOf(covered);\n          const right = bandCuttable(cut) && !left;\n          const check = right ? rest : { ...rest, band: left || cut };") && loop.includes("best = { img: covered, faults: storyFaults(check), check };"));
  assert.ok(loop.includes("} else console.error(`[narrated] scene ${i + 1}: kept with an empty band or a doubled strip — the cover could not be made, kept as it was (flagged)`);"), "a cover that cannot be made is said, and the band's fault stays");
  assert.ok(loop.indexOf("if (!img && best?.check.unclothed) {") < loop.indexOf("if (!img && best?.check.band) {"), "dressed first, then cut");
  assert.ok(loop.indexOf("if (!img && best?.check.band) {") < loop.indexOf("if (!img && best) { img = best.img;"));
  // …the lenient path's picture too
  // (…and its scene flagged when cutting it off does not leave a right picture — review of S14)
  assert.ok(loop.includes("const lb = img ? await bandOf(img) : null;\n          if (img && lb) {\n            img = (await coverBand(img, lb)) || img;\n            if (!bandCuttable(lb)) { faultsOut[i] = bandFault(lb); checksOut[i] = { seen: [], panels: false, band: lb, who: [] }; }\n          }"));
  assert.ok(nar.indexOf("checksOut[i] = { seen: [], panels: false, band: lb, who: [] }") > 0 && nar.indexOf("if (img && faultsOut[i] == null) faultsOut[i] = 0;") > nar.indexOf("checksOut[i] = { seen: [], panels: false, band: lb, who: [] }"), "its flag is set before the scene is called right");
  // the read and the crop
  const srv = read("app", "lib", "full-frame.server.ts");
  assert.ok(srv.includes("\"-vf\", `scale=${BAND_SIZE}:${BAND_SIZE}:flags=area,format=gray`, \"-frames:v\", \"1\", \"-f\", \"rawvideo\", \"-pix_fmt\", \"gray\", raw]"));
  assert.ok(srv.includes("`crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${W}:${H}:flags=lanczos,setsar=1`"));
  assert.ok(srv.includes("if (!band || !bandCuttable(band)) return null;"));
});

test("the acted film's masters and edits: cut and covered where that leaves a right picture — one line", () => {
  const dlg = read("app", "lib", "film-dialogue.server.ts");
  assert.ok(dlg.includes("import { coveredIfBanded } from \"./full-frame.server\";"));
  const fn = dlg.slice(dlg.indexOf("async function removeLetterbox("), dlg.indexOf("/** Grab the ACTUAL last frame"));
  assert.ok(fn.includes("if (!found || !crop) return (await coveredIfBanded(relUrl)) || relUrl;"), "a black letterbox is cropped as it was; any other band is covered");
});
