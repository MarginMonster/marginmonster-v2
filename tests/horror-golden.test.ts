/* THE HORROR FILM IS UNCHANGED BY A BYTE — every acted genre now runs its machinery for its own FIGURE (2026-11-26,
 * acted-staging.ts → FIGURE_GENRES), and these are the horror answers of every function that machinery touches,
 * compared with what each returned before (tests/horror-golden.json — written from the tree before the change, in its
 * own commit). Then: the engine's horror branches read the same way they did. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HORROR_CASES } from "./horror-golden-cases.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const golden = JSON.parse(read("tests", "horror-golden.json")) as Record<string, unknown>;

test("every horror prompt, picture and clip is byte-identical to before the figure generalization", () => {
  assert.deepEqual(Object.keys(HORROR_CASES).sort(), Object.keys(golden).sort(), "the same cases as the golden file");
  for (const [k, f] of Object.entries(HORROR_CASES)) assert.deepEqual(JSON.parse(JSON.stringify(f())), golden[k], `horror case ${k}`);
});

test("the engine's horror branches read as they did: its thing, its sighting, its reveal and its words", () => {
  const eng = read("app", "lib", "film-dialogue.server.ts");
  // (horror is one of the two ways in; `plain` is false for it, and every plain branch is `plain ? new : old`)
  assert.ok(eng.includes("const plain = !horror && figureGenre(tmpl.key);"));
  assert.ok(eng.includes("const sightOn = staged && (horror || plain) && !cartoon && isTwoHander;"));
  assert.ok(eng.includes("const lastReveal = staged && (horror || endsOnFigure) && i > 0 && i === treatment.scenes.length - 1 && !!eventAt(i);"));
  assert.ok(eng.includes("const endsOnFigure = sightOn && plain && !!threatEntry"), "a horror film never ends on a 'figure'");
  assert.ok(eng.includes("const own = plain ? ownFigure() : storyThreat({ cast: treatment.cast, speakers: [spkA, spkB], last: scenesArr[scenesArr.length - 1]?.visual })\n        || threatFromWords("));
  assert.ok(eng.includes("prompt: plain ? figurePortrait(own.entry, tmpl.sceneHint) : threatPortrait(own.entry, tmpl.sceneHint), refs: []"));
  assert.ok(eng.includes("(plain ? undefined : castActors.find((c) => !!c.faceUrl && isCreature(c) && !speaks(c)))"));
  assert.ok(eng.includes("const isTheThing = (entry: string, who = \"\"): boolean => (!entry ? !plain && couldBeThing(who, thingWords) : !!threatEntry && lineName(entry) === lineName(threatEntry));"));
  assert.ok(eng.includes("const cloth = !plain && placeOn && (clothPlace(whereAt[i], eventAt(i)) || shutCloth(placeBefore));"));
  assert.ok(eng.includes("const sightShadow = !plain && placeOn && shutCloth(placeBefore);"));
  assert.ok(eng.includes("if (s && (!plain || isTheThing(s.entry, s.who))) {"));
  assert.ok(eng.includes("...(plain ? { plain: true } : {}) } : null,"), "the master's thing is bound in horror's words unless plain");
  // (the writer: horror's own rules, word for word and in the same place)
  const brief = read("app", "lib", "film-engine.server.ts");
  assert.ok(brief.includes("(tmpl.key === \"horror\" ? `${SEEN_WHEN_SEEN}\\n${ends ? `${SEEN_AT_THE_END}\\n` : \"\"}` : \"\") +"));
  assert.ok(brief.includes("${tmpl.key === \"horror\" ? (ends ? LINE_IN_EVERY_SHOT_BUT_THE_LAST : LINE_IN_EVERY_SHOT) : SOME_SHOTS_SILENT}"));
  assert.ok(brief.includes(" After them \"cast\" has the film's own threat, also exactly as it is here: ${thing.entry} — it is NOT one of the two, it never speaks, and it is in a VISUAL only where the rules below put it.`"));
  // (a maker's chosen creature as THE THREAT stays a horror film's)
  assert.ok(brief.includes("const threatNames = tmpl.key === \"horror\" ? picked.filter("));
});
