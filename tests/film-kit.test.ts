/* THE MOVIE MAKER'S NEW PIECES (2026-11-25): a scene BOARD, a length SLIDER, starter NUDGES.
 *
 * The owner, that morning, of the acted film's script editor: "Scene design also comes across as fucking
 * boring and a chore"; of the Length step: "The how long can be adjusted to a sexy slider allowing up to 5
 * minutes with estimated final pricing for generations"; and of the writer: "atleast need a starter
 * \"nudge\" couple sentences to hand to the writer".
 *
 * What was built, and what holds it here:
 *   lib/film-flow.ts        the script grouped into places → angles → lines, and every edit as a function
 *                           from the flat list to a new flat list. It was copied out of routes/web.film.tsx;
 *                           PAGE, below, is that page's own code as it stood at commit 7d47dd51, and every
 *                           function is run against it on the same scripts. Two edits are new (move a
 *                           place, remove a place) and are held by what they must never do: lose a line, or
 *                           change the order of the lines inside a place.
 *   lib/film-sketch.ts      a rough pencil sketch for every place (about a third of a cent each): the
 *                           wording, the request, the four-at-a-time loop that never throws.
 *   lib/film-rewrite.ts     a director's one-tap note: what the writer is told, and the check on what comes
 *                           back — anything unusable is refused whole.
 *   components/film/*       the three pieces and their one stylesheet. They cannot be MOUNTED in a test (no
 *                           DOM) — what a tap does was driven with real touches, a real drag and real keys
 *                           in the harness (public/_harness/film-kit, not committed) and photographed at
 *                           phone and desktop width in both themes. Here they are DRAWN: compiled as they
 *                           stand and rendered to markup, so what the page is handed is held — one real
 *                           range control and what a screen reader is told, lines as text and not as boxes,
 *                           what holds while the writer has a sheet — along with what no photograph shows:
 *                           every word in all five languages, and the rules for a finger and less motion.
 *
 * The two calls that cost something or need the writer (film-sketch.server.ts, film-rewrite.server.ts) are
 * not run from here: twelve real sketches were drawn and looked at; the writer has no credit on this machine.
 * Their wiring is pinned as source. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as flowLib from "../app/lib/film-flow.ts";
import { FILM_KIT_CSS } from "../app/components/film/film-kit-style.ts";
import { UI_DICT } from "../app/lib/ui-i18n-dict.ts";
import {
  WIDE, addCloseUp, addLine, addScene, backdropIs, cycleSpeaker, filmClock, flowOf, movePlace, nextSpeaker, parseBeat, placeLines,
  removeAngle, removeLine, removePlace, setAngleShot, setLine, setSpeaker, setWhere, sideOf, speakersOf, whereOf,
  type FlowAngle, type FlowBeat, type FlowLoc, type FlowScene,
} from "../app/lib/film-flow.ts";
import {
  SKETCH_AT_ONCE, SKETCH_MAX_PLACES, SKETCH_MODEL, keepSketches, parseSketchPlaces, placesForSketch, sketchAll, sketchAspect, sketchInput,
  sketchKey, sketchPrompt, sketchesFor, unsketched,
} from "../app/lib/film-sketch.ts";
import {
  GENERIC_NOTES, NEW_TAKE, REWRITE_FAILED, applyRewrite, noteByKey, parseRewrite, parseRewriteLines, rewriteBrief, rewriteSchema, speakersInPlace,
} from "../app/lib/film-rewrite.ts";
import { nameTok } from "../app/lib/character-prompts.ts";
import { LINE_WORDS_MAX } from "../app/lib/dialogue-fit.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
/** A source file with its comments taken out (what it DOES, not what it says about itself). */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ---- the scripts (every name made up) ----------------------------------------------------------------- */

const KITCHEN = "a lighthouse kitchen at night, one lamp burning";
const STAIRS = "the spiral stairs inside the lighthouse";
const LAMP = "the lamp room at the top of the lighthouse";
const ROCKS = "the rocks below the lighthouse at dawn";

/** Four places; a shot with no `where` of its own (it is in the place before it); one close-up; and, as a
 *  horror film ends, a last shot nobody speaks in. */
const LIGHTHOUSE: FlowScene[] = [
  { visual: "Wren sets a storm lantern on the table while Odo bolts the heavy door", where: KITCHEN, caption: "Wren: The lamp upstairs went out on its own again, and nobody has climbed those stairs since noon.", tone: "low, certain" },
  { visual: "Odo turns from the door and points at the ceiling", where: KITCHEN, caption: "Odo: Then somebody is up there now, because I can hear the gallery door banging in the wind." },
  { visual: "Wren and Odo climb the spiral stairs together, Odo holding the lantern up", where: STAIRS, caption: "Odo: Count the steps with me, there were ninety-two this morning." },
  { visual: "Wren grips the rope rail", caption: "Wren: Ninety-three. Ninety-four. Odo, keep the light up." },
  { visual: "Odo lifts the lantern to the great lens while Wren pulls the dust sheet off it", where: LAMP, caption: "Wren: It is warm. Somebody lit it and put it out.", tone: "barely above a whisper" },
  { visual: "Odo lifts the lantern to the great lens while Wren pulls the dust sheet off it", where: LAMP, shot: "close-up on Odo", caption: "Odo: Look at the glass." },
  { visual: "Wren and Odo walk down the wet rocks toward a small boat", where: ROCKS, caption: "Odo: We tell the harbour it was the wind." },
  { visual: "Wren steps into the boat", where: ROCKS, caption: "Wren: We tell them nothing. We row." },
  { visual: "A wet handprint on the inside of the boat's lantern glass", where: ROCKS, caption: "" },
];
/** A script from before places existed: no `where`, no `shot` — one place, named from what is seen. */
const OLD: FlowScene[] = [
  { visual: "A dim test diner; rain on the glass. Two people in a booth", caption: "Pim: You came." },
  { visual: "The same booth", caption: "Quill: I said I would." },
  { visual: "The same booth", caption: "no label on this one" },
];
/** The same place twice, with another between (a film is told not to do it; a maker can). */
const BACK: FlowScene[] = [
  { visual: "v1", where: "the test yard", caption: "Pim: One." },
  { visual: "v2", where: "the test shed", caption: "Quill: Two." },
  { visual: "v3", where: "the test shed", shot: "close-up on Quill", caption: "Quill: Three." },
  { visual: "v4", where: "the test yard", caption: "Pim: Four." },
];
const CAST = ["Wren", "Odo"];

/* ---- PAGE: routes/web.film.tsx as it stood at 7d47dd51 (lines 3227–3291), copied line for line. The page
 * closed over `treatment`, `cast` and its own setters; here the script and the speakers are handed in and the
 * new script is handed back — nothing else is changed. ---- */
const PAGE = (() => {
  const WIDE_ = "wide two-shot";
  const parseBeat_ = (cap?: string): { speaker: string; line: string } => {
    const m = (cap || "").match(/^\s*([^:]{1,40}):\s*([\s\S]*)$/);
    return m ? { speaker: m[1].trim(), line: m[2].trim() } : { speaker: "", line: (cap || "").trim() };
  };
  const whereOf_ = (s: FlowScene, prev: string) => (s.where || "").trim() || prev || (s.visual || "").split(/[.;]/)[0].trim().slice(0, 80) || "A cinematic location";
  const flow = (scenes: FlowScene[]): FlowLoc[] => {
    const locs: FlowLoc[] = []; let prevWhere = "";
    (scenes || []).forEach((s, idx) => {
      const where = whereOf_(s, prevWhere); prevWhere = where;
      const shot = (s.shot || "").trim() || WIDE_;
      let loc = locs[locs.length - 1];
      if (!loc || loc.where !== where) { loc = { where, firstIdx: idx, lastIdx: idx, angles: [] }; locs.push(loc); }
      loc.lastIdx = idx;
      let ang = loc.angles[loc.angles.length - 1];
      if (!ang || ang.shot !== shot) { ang = { shot, beats: [], lastIdx: idx }; loc.angles.push(ang); }
      ang.lastIdx = idx;
      const { speaker, line } = parseBeat_(s.caption);
      ang.beats.push({ idx, speaker, line });
    });
    return locs;
  };
  const firstTok = nameTok;
  const speakerNames = (scenes: FlowScene[], cast: string[]): string[] => {
    const seen = new Set<string>(); const out: string[] = [];
    const add = (nm: string) => { const k = firstTok(nm); if (nm && k && !seen.has(k)) { seen.add(k); out.push(nm); } };
    cast.forEach((c) => c && add(c));
    (scenes || []).forEach((s) => { const sp = parseBeat_(s.caption).speaker; if (sp) add(sp); });
    return out;
  };
  const nextSpeaker_ = (cur: string, names: string[]) => { if (!names.length) return cur; const i = names.findIndex((n) => firstTok(n) === firstTok(cur)); return names[((i < 0 ? -1 : i) + 1) % names.length]; };
  const insertAt = (ss: FlowScene[], at: number, s: FlowScene) => { const out = ss.slice(); out.splice(Math.min(Math.max(0, at), out.length), 0, s); return out; };
  return {
    flow, speakerNames, nextSpeaker: nextSpeaker_,
    setBeatLine: (ss: FlowScene[], names: string[], idx: number, line: string) => ss.map((s, j) => (j === idx ? { ...s, caption: `${parseBeat_(s.caption).speaker || names[0] || "Name"}: ${line}` } : s)),
    setBeatSpeaker: (ss: FlowScene[], idx: number, name: string) => ss.map((s, j) => (j === idx ? { ...s, caption: `${name}: ${parseBeat_(s.caption).line}` } : s)),
    addBeat: (ss: FlowScene[], names: string[], loc: FlowLoc, ang: FlowAngle) => {
      const base = ss[loc.firstIdx];
      const prevSpk = ang.beats[ang.beats.length - 1]?.speaker || names[0] || "";
      return insertAt(ss, ang.lastIdx + 1, { visual: base?.visual || loc.where, where: loc.where, shot: ang.shot, caption: `${nextSpeaker_(prevSpk, names)}: ` });
    },
    addAngle: (ss: FlowScene[], names: string[], loc: FlowLoc) => {
      const base = ss[loc.firstIdx];
      const who = names[0] || "Name";
      return insertAt(ss, loc.lastIdx + 1, { visual: base?.visual || loc.where, where: loc.where, shot: `close-up on ${who}`, caption: `${who}: ` });
    },
    addScene: (ss: FlowScene[], names: string[]) => [...ss, { visual: "A new location", where: "A new location", shot: WIDE_, caption: `${names[0] || "Name"}: ` }],
    setWhere: (ss: FlowScene[], loc: FlowLoc, where: string) => ss.map((s, j) => (j >= loc.firstIdx && j <= loc.lastIdx ? { ...s, where, visual: s.visual && s.visual !== loc.where ? s.visual : where } : s)),
    setAngleShot: (ss: FlowScene[], ang: FlowAngle, shot: string) => ss.map((s, j) => (ang.beats.some((b) => b.idx === j) ? { ...s, shot } : s)),
    removeAngle: (ss: FlowScene[], loc: FlowLoc, ang: FlowAngle) => {
      const base = loc.angles[0]?.shot || WIDE_;
      return ss.map((s, j) => (ang.beats.some((b) => b.idx === j) ? { ...s, shot: base } : s));
    },
    removeBeat: (ss: FlowScene[], idx: number) => (ss.length > 1 ? ss.filter((_, j) => j !== idx) : ss),
    backdropIs: (where: string, key: string): boolean => new RegExp(`(^|[^a-z])${key}([^a-z]|$)`, "i").test(where || ""),
  };
})();

const SCRIPTS: Array<[string, FlowScene[]]> = [["four places", LIGHTHOUSE], ["no places written", OLD], ["a place come back to", BACK], ["empty", []]];

/* ---- film-flow: the grouping ------------------------------------------------------------------------- */

test("the script is grouped exactly as the page grouped it — places, then angles, then lines", () => {
  for (const [name, ss] of SCRIPTS) assert.deepEqual(flowOf(ss), PAGE.flow(ss), name);
  assert.deepEqual(flowOf(null), []);
  assert.deepEqual(flowOf(undefined), []);
  // what that grouping IS, on the four-place script: the shot with no place of its own is in the stairs…
  const flow = flowOf(LIGHTHOUSE);
  assert.deepEqual(flow.map((l) => [l.where, l.firstIdx, l.lastIdx]), [[KITCHEN, 0, 1], [STAIRS, 2, 3], [LAMP, 4, 5], [ROCKS, 6, 8]]);
  // …the lamp room is two angles (its own take, then the close-up), every other place one…
  assert.deepEqual(flow.map((l) => l.angles.map((a) => a.shot)), [[WIDE], [WIDE], [WIDE, "close-up on Odo"], [WIDE]]);
  assert.equal(WIDE, "wide two-shot");
  // …and a shot nobody speaks in is a line with no speaker and no words
  assert.deepEqual(flow[3].angles[0].beats[2], { idx: 8, speaker: "", line: "" } satisfies FlowBeat);
  // a script with no places written is one place, named from the first thing seen
  assert.deepEqual(flowOf(OLD).map((l) => l.where), ["A dim test diner"]);
  // a place the film comes back to is a place again: three, not two
  assert.deepEqual(flowOf(BACK).map((l) => l.where), ["the test yard", "the test shed", "the test yard"]);
});

test("a line is \"NAME: what they say\" — and a line with no label has no speaker", () => {
  assert.deepEqual(parseBeat("Odo: Look at the glass."), { speaker: "Odo", line: "Look at the glass." });
  assert.deepEqual(parseBeat("  Mourning Mary :  two  words "), { speaker: "Mourning Mary", line: "two  words" });
  assert.deepEqual(parseBeat("Odo: at 9:15 sharp"), { speaker: "Odo", line: "at 9:15 sharp" }, "only the first colon is the label's");
  assert.deepEqual(parseBeat("no label on this one"), { speaker: "", line: "no label on this one" });
  assert.deepEqual(parseBeat("Odo: "), { speaker: "Odo", line: "" });
  assert.deepEqual(parseBeat(""), { speaker: "", line: "" });
  assert.deepEqual(parseBeat(undefined), { speaker: "", line: "" });
  assert.deepEqual(parseBeat(null), { speaker: "", line: "" });
  // a "label" longer than forty characters is a sentence with a colon in it
  const long = "This is a long sentence that happens to have a colon: here";
  assert.deepEqual(parseBeat(long), { speaker: "", line: long });
  assert.equal(whereOf({ visual: "", where: "  " }, ""), "A cinematic location");
  assert.equal(whereOf({ visual: "x" }, "the place before"), "the place before");
});

test("who speaks, whose turn is next, and which side of the conversation they are on", () => {
  for (const [name, ss] of SCRIPTS) {
    assert.deepEqual(speakersOf(ss, CAST), PAGE.speakerNames(ss, CAST), name);
    assert.deepEqual(speakersOf(ss), PAGE.speakerNames(ss, []), `${name}, nobody cast`);
  }
  // the cast's own spelling wins, and one person is one speaker however the script writes them
  assert.deepEqual(speakersOf([{ visual: "", caption: "WREN: a" }, { visual: "", caption: "Odo: b" }, { visual: "", caption: "Third Tess: c" }], ["Wren"]), ["Wren", "Odo", "Third Tess"]);
  for (const cur of ["Wren", "Odo", "ODO", "Nobody", ""]) assert.equal(nextSpeaker(cur, CAST), PAGE.nextSpeaker(cur, CAST), cur);
  assert.equal(nextSpeaker("Wren", CAST), "Odo");
  assert.equal(nextSpeaker("Odo", CAST), "Wren");
  assert.equal(nextSpeaker("Wren", []), "Wren", "nobody to choose from");
  // sides: the second of the cast answers from the right — as the page had it for two…
  assert.equal(sideOf("Wren", CAST), "left");
  assert.equal(sideOf("ODO", CAST), "right");
  assert.equal(sideOf("", CAST), "left");
  assert.equal(sideOf("A Stranger", CAST), "left");
  // …and with more than two they go on alternating
  assert.deepEqual(["A", "B", "C", "D"].map((n) => sideOf(n, ["A", "B", "C", "D"])), ["left", "right", "left", "right"]);
});

test("a backdrop lights up for its own place only — a lighthouse is not an \"Old house\"", () => {
  const cases: Array<[string, string]> = [
    ["the hallway of an old house at night", "house"], ["a lighthouse kitchen", "house"], ["a carpark", "car"], ["a carpark", "park"],
    ["a quiet park bench", "park"], ["Inside a parked CAR at night", "car"], ["", "car"], ["a bus stop in the rain", "bus"],
  ];
  for (const [where, key] of cases) assert.equal(backdropIs(where, key), PAGE.backdropIs(where, key), `${key} in "${where}"`);
  assert.equal(backdropIs("a lighthouse kitchen", "house"), false);
  assert.equal(backdropIs("the hallway of an old house at night", "house"), true);
  assert.equal(backdropIs("anything", ""), false, "a backdrop with no key lights nowhere");
});

test("seconds read as a clock", () => {
  assert.deepEqual([0, 5, 26, 59.6, 60, 90, 185, 300].map(filmClock), ["0:00", "0:05", "0:26", "1:00", "1:00", "1:30", "3:05", "5:00"]);
  assert.equal(filmClock(-3), "0:00");
  assert.equal(filmClock(Number.NaN), "0:00");
});

/* ---- film-flow: the edits the page already had -------------------------------------------------------- */

test("every edit the page made, made the same way — to the letter", () => {
  for (const [name, ss] of SCRIPTS) {
    const names = PAGE.speakerNames(ss, CAST);
    const flow = PAGE.flow(ss);
    ss.forEach((_, idx) => {
      assert.deepEqual(setLine(ss, idx, "A new line.", names), PAGE.setBeatLine(ss, names, idx, "A new line."), `${name}: line ${idx}`);
      assert.deepEqual(setSpeaker(ss, idx, "Odo"), PAGE.setBeatSpeaker(ss, idx, "Odo"), `${name}: speaker ${idx}`);
      const cur = parseBeat(ss[idx].caption).speaker;
      assert.deepEqual(cycleSpeaker(ss, idx, names), PAGE.setBeatSpeaker(ss, idx, PAGE.nextSpeaker(cur, names)), `${name}: next speaker ${idx}`);
      assert.deepEqual(removeLine(ss, idx), PAGE.removeBeat(ss, idx), `${name}: remove line ${idx}`);
    });
    flow.forEach((loc, li) => {
      assert.deepEqual(setWhere(ss, li, "a test cellar, one bulb"), PAGE.setWhere(ss, loc, "a test cellar, one bulb"), `${name}: where ${li}`);
      loc.angles.forEach((ang) => {
        // (the board hands in ANY shot of the angle or the place: the first and the last must do the same)
        for (const idx of [ang.beats[0].idx, ang.lastIdx]) {
          assert.deepEqual(addLine(ss, idx, names), PAGE.addBeat(ss, names, loc, ang), `${name}: add a line after ${idx}`);
          assert.deepEqual(setAngleShot(ss, idx, "close-up on Wren"), PAGE.setAngleShot(ss, ang, "close-up on Wren"), `${name}: angle ${idx}`);
          assert.deepEqual(removeAngle(ss, idx), PAGE.removeAngle(ss, loc, ang), `${name}: remove angle ${idx}`);
        }
      });
      for (const idx of [loc.firstIdx, loc.lastIdx]) assert.deepEqual(addCloseUp(ss, idx, names), PAGE.addAngle(ss, names, loc), `${name}: close-up in ${li}`);
    });
    assert.deepEqual(addScene(ss, names), PAGE.addScene(ss, names), `${name}: new scene`);
  }
});

test("what those edits come to, on the four-place script", () => {
  const names = speakersOf(LIGHTHOUSE, CAST);
  // "+ line" in the stairs: after its last line, in the stairs, for whoever did not speak last
  const plus = addLine(LIGHTHOUSE, 3, names);
  assert.equal(plus.length, LIGHTHOUSE.length + 1);
  assert.deepEqual(plus[4], { visual: LIGHTHOUSE[2].visual, where: STAIRS, shot: WIDE, caption: "Odo: " });
  assert.equal(flowOf(plus)[1].lastIdx, 4, "it is in the stairs");
  // "+ line" from the lamp room's close-up goes into the close-up
  assert.deepEqual(addLine(LIGHTHOUSE, 5, names)[6], { visual: LIGHTHOUSE[4].visual, where: LAMP, shot: "close-up on Odo", caption: "Wren: " });
  // "close-up" in the kitchen: after everything there, on the first of the cast
  const cu = addCloseUp(LIGHTHOUSE, 0, names);
  assert.deepEqual(cu[2], { visual: LIGHTHOUSE[0].visual, where: KITCHEN, shot: "close-up on Wren", caption: "Wren: " });
  assert.deepEqual(flowOf(cu)[0].angles.map((a) => a.shot), [WIDE, "close-up on Wren"]);
  // taking a close-up away folds its lines back into the place's own take
  assert.deepEqual(flowOf(removeAngle(LIGHTHOUSE, 5))[2].angles.map((a) => a.beats.length), [2]);
  // a line that had no speaker gets the first of the cast; the last line of a script cannot be removed
  assert.equal(setLine(OLD, 2, "Now it has one.", ["Pim", "Quill"])[2].caption, "Pim: Now it has one.");
  assert.equal(setLine([{ visual: "" }], 0, "x", [])[0].caption, "Name: x");
  assert.deepEqual(removeLine([LIGHTHOUSE[0]], 0), [LIGHTHOUSE[0]]);
  // an index that is nowhere changes nothing (and never hands back the same array)
  for (const out of [addLine(LIGHTHOUSE, 99, names), addCloseUp(LIGHTHOUSE, -1, names), setAngleShot(LIGHTHOUSE, 99, "x"), removeAngle(LIGHTHOUSE, 99), setWhere(LIGHTHOUSE, 9, "x"), cycleSpeaker(LIGHTHOUSE, 99, names)]) {
    assert.deepEqual(out, LIGHTHOUSE);
    assert.notEqual(out, LIGHTHOUSE);
  }
  // nothing above changed the script it was given
  assert.equal(LIGHTHOUSE.length, 9);
  assert.equal(LIGHTHOUSE[3].where, undefined);
  assert.deepEqual(placeLines(LIGHTHOUSE, 1), ["Odo: Count the steps with me, there were ninety-two this morning.", "Wren: Ninety-three. Ninety-four. Odo, keep the light up."]);
  assert.deepEqual(placeLines(LIGHTHOUSE, 9), []);
});

/* ---- film-flow: the two new edits --------------------------------------------------------------------- */

const linesIn = (ss: FlowScene[]) => flowOf(ss).map((l) => ss.slice(l.firstIdx, l.lastIdx + 1).map((s) => s.caption || ""));
const sorted = (ss: FlowScene[]) => ss.map((s) => `${s.visual}|${s.caption || ""}|${s.shot || ""}|${s.tone || ""}`).sort();

test("NEW — a place moves earlier or later: every shot kept, and the order inside each place", () => {
  const before = linesIn(LIGHTHOUSE);
  for (let p = 0; p < 4; p++) for (const dir of [-1, 1] as const) {
    const out = movePlace(LIGHTHOUSE, p, dir);
    const to = p + dir;
    assert.deepEqual(sorted(out), sorted(LIGHTHOUSE), `place ${p} ${dir}: every shot is still there, with its picture, angle and tone`);
    if (to < 0 || to > 3) { assert.deepEqual(out, LIGHTHOUSE, `place ${p} ${dir}: off the end changes nothing`); continue; }
    const want = before.slice(); [want[p], want[to]] = [want[to], want[p]];
    assert.deepEqual(linesIn(out), want, `place ${p} ${dir}: the two places changed seats, lines in order`);
    const wheres = [KITCHEN, STAIRS, LAMP, ROCKS]; [wheres[p], wheres[to]] = [wheres[to], wheres[p]];
    assert.deepEqual(flowOf(out).map((l) => l.where), wheres);
  }
  // the shot with no place of its own went WITH the stairs — and now says so in so many words
  const up = movePlace(LIGHTHOUSE, 1, -1);
  assert.deepEqual(up.slice(0, 2).map((s) => [s.where, s.caption]), [[STAIRS, LIGHTHOUSE[2].caption], [STAIRS, LIGHTHOUSE[3].caption]]);
  assert.equal(up[2].where, KITCHEN);
  // the close-up is still a close-up, in the lamp room, after the lamp room's own take
  assert.deepEqual(flowOf(movePlace(LIGHTHOUSE, 2, 1))[3].angles.map((a) => [a.shot, a.beats.map((b) => b.line)]), [[WIDE, ["It is warm. Somebody lit it and put it out."]], ["close-up on Odo", ["Look at the glass."]]]);
  // there and back again is the script it was (with the one inherited place written out)
  const pinned = LIGHTHOUSE.map((s, i) => (i === 3 ? { ...s, where: STAIRS } : s));
  assert.deepEqual(movePlace(movePlace(LIGHTHOUSE, 1, 1), 2, -1), pinned);
  // an old script is one place: nothing to move, and nothing is written into it
  assert.deepEqual(movePlace(OLD, 0, 1), OLD);
  assert.deepEqual(movePlace(LIGHTHOUSE, 7, 1), LIGHTHOUSE);
  // two places with the very same words that end up side by side ARE one place: nothing lost, order kept
  const merged = movePlace(BACK, 1, -1);
  assert.deepEqual(sorted(merged), sorted(BACK));
  assert.deepEqual(linesIn(merged), [["Quill: Two.", "Quill: Three."], ["Pim: One.", "Pim: Four."]]);
});

test("NEW — a place is removed whole: only its shots go, and a script keeps at least one place", () => {
  for (let p = 0; p < 4; p++) {
    const out = removePlace(LIGHTHOUSE, p);
    const want = linesIn(LIGHTHOUSE).filter((_, k) => k !== p);
    assert.deepEqual(linesIn(out), want, `without place ${p}`);
    assert.equal(out.length, LIGHTHOUSE.length - linesIn(LIGHTHOUSE)[p].length);
  }
  // taking the kitchen out leaves the shot with no place of its own in the stairs, not in "nowhere"
  assert.deepEqual(flowOf(removePlace(LIGHTHOUSE, 0)).map((l) => l.where), [STAIRS, LAMP, ROCKS]);
  assert.deepEqual(removePlace(OLD, 0), OLD, "the only place stays");
  assert.deepEqual(removePlace(LIGHTHOUSE, 4), LIGHTHOUSE);
  assert.deepEqual(removePlace(LIGHTHOUSE, -1), LIGHTHOUSE);
  // down to one place, and no further
  let ss = LIGHTHOUSE.slice();
  for (let i = 0; i < 6; i++) ss = removePlace(ss, 0);
  assert.deepEqual(flowOf(ss).map((l) => l.where), [ROCKS]);
  assert.equal(ss.length, 3);
});

/* ---- film-sketch --------------------------------------------------------------------------------------- */

test("a sketch is asked for as a rough pencil storyboard panel — no text, no bubbles, no borders, no colour", () => {
  const place = placesForSketch(LIGHTHOUSE)[1];
  assert.deepEqual(place, { where: STAIRS, visual: LIGHTHOUSE[2].visual, lines: [LIGHTHOUSE[2].caption, LIGHTHOUSE[3].caption] });
  const p = sketchPrompt({ ...place, look: "a tense night, deep shadows", aspect: "16:9" });
  // the medium first, so it is a drawing before it is a place
  assert.ok(p.startsWith("A rough storyboard sketch for a film, drawn fast in loose graphite pencil with soft grey shading on off-white paper:"), p);
  // what must not be there, once, last
  assert.ok(p.endsWith("Black-and-white pencil only: no colour, no text or lettering, no speech bubbles, no panel borders. Unsigned."), p);
  for (const never of ["no text", "no speech bubbles", "no panel borders", "no colour"]) assert.ok(p.includes(never), never);
  // the place and what happens are the scene's own words…
  assert.ok(p.includes(`The place: ${STAIRS}.`));
  assert.ok(p.includes("The mood: a tense night, deep shadows."));
  // …but nobody's NAME is (a picture model writes a word it does not know), and not one word of the lines
  assert.ok(p.includes("What happens: one person and the other person climb the spiral stairs together, the other person holding the lantern up."), p);
  for (const word of ["Wren", "Odo", "ninety", "Count the steps"]) assert.ok(!p.includes(word), `"${word}" must not be sent`);
  assert.ok(p.includes("Two people are in it, drawn as simple figures with their faces only suggested."));
  // whoever the sentence comes to first is "one person" — whoever spoke first
  assert.ok(sketchPrompt({ where: LAMP, visual: "Odo lifts the lantern while Wren pulls the sheet off", lines: ["Wren: a", "Odo: b"] }).includes("one person lifts the lantern while the other person pulls the sheet off"));
  // a name inside another word is left alone
  assert.ok(sketchPrompt({ where: "x", visual: "Odo opens the odometer case", lines: ["Odo: a"] }).includes("one person opens the odometer case"));
  // one speaker, none, three — and never a fourth
  assert.ok(sketchPrompt({ where: "x", lines: ["A: a"] }).includes("One person is in it"));
  assert.ok(!sketchPrompt({ where: "x", lines: [] }).includes("in it,"));
  assert.ok(sketchPrompt({ where: "x", lines: ["A: a", "B: b", "C: c", "D: d"] }).includes("Three people are in it"));
  // a picture that is only the place's own words is not said twice; no mood, no mood sentence
  const bare = sketchPrompt({ where: "A new location", visual: "A new location" });
  assert.ok(!bare.includes("What happens") && !bare.includes("The mood"), bare);
  assert.ok(sketchPrompt({ where: "" }).includes("The place: a room."));
  assert.ok(p.length < 900, "a short prompt");
});

test("the sketch is in the film's shape — said as a shot, and asked for as a shape", () => {
  const shots = { "16:9": "A wide shot", "9:16": "A tall vertical shot", "1:1": "A square shot" } as const;
  for (const a of ["16:9", "9:16", "1:1"] as const) {
    const p = sketchPrompt({ where: STAIRS, aspect: a });
    assert.ok(p.includes(`${shots[a]}; the scene runs off all four edges of the picture.`), a);
    for (const other of Object.values(shots)) if (other !== shots[a]) assert.ok(!p.includes(other), `${a}: only its own shape`);
    assert.deepEqual(sketchInput(p, a), { prompt: p, aspect_ratio: a, num_outputs: 1, num_inference_steps: 4, go_fast: true, megapixels: "1", output_format: "jpg", output_quality: 82 });
  }
  assert.equal(sketchAspect("4:3"), "16:9");
  assert.equal(sketchAspect(undefined), "16:9");
  assert.equal(sketchInput("p", "weird" as never).aspect_ratio, "16:9");
  assert.equal(SKETCH_MODEL, "black-forest-labs/flux-schnell", "the cheapest, fastest picture there is: a sketch is the one place for it");
});

test("what is sent to be sketched is read back carefully: only places, cut to size, never more than sixteen", () => {
  assert.equal(SKETCH_MAX_PLACES, 16);
  assert.deepEqual(parseSketchPlaces(JSON.stringify(placesForSketch(LIGHTHOUSE))), placesForSketch(LIGHTHOUSE));
  assert.equal(placesForSketch(LIGHTHOUSE).length, 4);
  assert.deepEqual(placesForSketch(null), []);
  for (const bad of [undefined, null, "", "not json", "{}", "7", JSON.stringify({ where: "x" }), 12]) assert.deepEqual(parseSketchPlaces(bad), [], String(bad));
  assert.deepEqual(parseSketchPlaces([{ where: "  a   yard " }, null, 7, "x", { visual: "no place" }, { where: "" }, { where: "b", lines: ["A: 1", 2, "", "B: 2"], visual: 9 }]),
    [{ where: "a yard", visual: "", lines: [] }, { where: "b", visual: "9", lines: ["A: 1", "B: 2"] }]);
  const many = Array.from({ length: 40 }, (_, i) => ({ where: `test place ${i} ${"x".repeat(400)}`, visual: "v".repeat(900), lines: Array.from({ length: 30 }, () => "A: " + "w".repeat(500)) }));
  const cut = parseSketchPlaces(many);
  assert.equal(cut.length, 16);
  assert.ok(cut.every((p) => p.where.length <= 160 && (p.visual || "").length <= 400 && (p.lines || []).length <= 12 && (p.lines || []).every((l) => l.length <= 200)));
  // a long script's board stops at sixteen sketches too
  const long: FlowScene[] = Array.from({ length: 30 }, (_, i) => ({ visual: "v", where: `test place ${i}`, caption: "Pim: x" }));
  assert.equal(placesForSketch(long).length, 16);
});

test("every place is drawn, four at a time, in order — and one that fails is a blank sheet, never an error", async () => {
  assert.equal(SKETCH_AT_ONCE, 4);
  const places = Array.from({ length: 10 }, (_, i) => ({ where: `test place ${i}`, lines: ["Pim: a", "Quill: b"] }));
  let running = 0; let most = 0; const asked: string[] = [];
  const out = await sketchAll(places, "9:16", async (input, place) => {
    running++; most = Math.max(most, running);
    asked.push(place.where);
    assert.equal(input.aspect_ratio, "9:16");
    assert.ok(String(input.prompt).includes(`The place: ${place.where}.`) && String(input.prompt).includes("The mood: gentle."));
    await new Promise((r) => setTimeout(r, 5 + (9 - Number(place.where.slice(-1))) * 2));   // the later ones come back first
    running--;
    const i = Number(place.where.slice(-1));
    if (i === 2) throw new Error("the model said no");
    if (i === 5) return null;
    if (i === 7) return "";
    return `/renders/img-test-${i}.jpg`;
  }, "gentle");
  assert.deepEqual(out, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ([2, 5, 7].includes(i) ? null : `/renders/img-test-${i}.jpg`)));
  assert.equal(most, 4, "never more than four at once");
  assert.equal(asked.length, 10);
  // none, and more than sixteen
  assert.deepEqual(await sketchAll([], "16:9", async () => "x"), []);
  let calls = 0;
  const capped = await sketchAll(Array.from({ length: 30 }, (_, i) => ({ where: `p${i}` })), "1:1", async () => { calls++; return "/renders/x.jpg"; });
  assert.equal(capped.length, 16);
  assert.equal(calls, 16);
});

test("a sketch stays with its place — whatever order the places are in now", () => {
  assert.equal(sketchKey("  The  Spiral STAIRS "), "the spiral stairs");
  const places = placesForSketch(LIGHTHOUSE);
  let kept = keepSketches({}, places, ["/renders/k.jpg", null, "/renders/l.jpg", undefined]);
  assert.deepEqual(kept, { [sketchKey(KITCHEN)]: "/renders/k.jpg", [sketchKey(LAMP)]: "/renders/l.jpg" });
  assert.deepEqual(sketchesFor(flowOf(LIGHTHOUSE), kept), ["/renders/k.jpg", null, "/renders/l.jpg", null]);
  assert.deepEqual(unsketched(places, kept).map((p) => p.where), [STAIRS, ROCKS]);
  // the lamp room moved first: its sketch moved with it
  assert.deepEqual(sketchesFor(flowOf(movePlace(movePlace(LIGHTHOUSE, 2, -1), 1, -1)), kept), ["/renders/l.jpg", "/renders/k.jpg", null, null]);
  // a second round: a sketch that failed this time keeps the picture it had
  kept = keepSketches(kept, places, [null, "/renders/s.jpg", null, null]);
  assert.deepEqual(sketchesFor(flowOf(LIGHTHOUSE), kept), ["/renders/k.jpg", "/renders/s.jpg", "/renders/l.jpg", null]);
  // a place that was renamed has no sketch yet
  assert.deepEqual(sketchesFor(flowOf(setWhere(LIGHTHOUSE, 0, "a test cellar")), kept), [null, "/renders/s.jpg", "/renders/l.jpg", null]);
});

test("the drawing itself: the project's own helpers, its failures swallowed, and nothing thrown", () => {
  const src = read("app", "lib", "film-sketch.server.ts");
  assert.ok(src.includes('import { persistRemote, repRun } from "./image-generation.server";'));
  assert.ok(src.includes('return await persistRemote(await repRun(SKETCH_MODEL, input, SKETCH_WAIT_MS), "jpg");'));
  assert.ok(src.includes("const SKETCH_WAIT_MS = 45_000;"));
  // no token, no sketches — and no error
  assert.ok(src.includes("if (!process.env.REPLICATE_API_TOKEN) return places.map(() => null);"));
  assert.ok(src.includes("export async function sketchPlaces(places: ReadonlyArray<SketchPlace>, aspect: SketchAspect, look?: string): Promise<(string | null)[]> {"));
  assert.ok(!/\bthrow\b/.test(codeOf(src)), "the code never throws");
});

/* ---- film-rewrite -------------------------------------------------------------------------------------- */

const TREATMENT = { title: "TEST — The Lighthouse Keeps Its Own Hours", scenes: LIGHTHOUSE };
const TWIST = GENERIC_NOTES[3];

test("a director's note: the writer gets the whole script, the one scene, the note — and the six things that never bend", () => {
  const b = rewriteBrief({ treatment: TREATMENT, placeIndex: 1, note: TWIST, speakers: CAST, template: { key: "horror", name: "Horror Film", brief: "a short horror film that ends on something seen" } });
  assert.ok(b.startsWith('You are rewriting ONE scene of a short acted film (Horror Film) called "TEST — The Lighthouse Keeps Its Own Hours", on a note from its director. The film is a short horror film that ends on something seen.'), b.slice(0, 260));
  // the whole script, every line numbered through, scene by scene — and the one to rewrite is marked
  assert.ok(b.includes(`SCENE 1 — ${KITCHEN}\n1. Wren: The lamp upstairs went out on its own again, and nobody has climbed those stairs since noon.\n2. Odo: Then somebody is up there now`));
  assert.ok(b.includes(`SCENE 2 — ${STAIRS}   <<< THE SCENE TO REWRITE\n3. Odo: Count the steps with me, there were ninety-two this morning.   [what we see: Wren and Odo climb the spiral stairs together, Odo holding the lantern up]\n4. Wren: Ninety-three.`));
  assert.equal(b.split("<<< THE SCENE TO REWRITE").length - 1, 1);
  assert.ok(b.includes(`SCENE 4 — ${ROCKS}\n7. Odo: We tell the harbour it was the wind.\n8. Wren: We tell them nothing. We row.\n9. (no line — this shot is seen, not said)`));
  // what is seen is shown only for the scene being rewritten
  assert.equal(b.split("[what we see:").length - 1, 2);
  // the note, in the writer's hands
  assert.ok(b.includes(`THE DIRECTOR'S NOTE on scene 2: "${TWIST.ask}"`));
  assert.ok(b.includes("Rewrite the lines of scene 2, and only scene 2, to follow the note. What never bends:"));
  // the six
  assert.ok(b.includes('• THE SAME SPEAKERS — only Odo and Wren speak, called exactly "Odo" and "Wren": one speaker to a line'));
  assert.ok(b.includes(`• THE SAME PLACE — it all still happens in "${STAIRS}". Nobody leaves it, and no line puts them anywhere else.`));
  assert.ok(b.includes("• THE SAME NUMBER OF LINES, give or take one — the scene has 2 spoken lines now: return 1 to 3. Every line is one shot of the film."));
  assert.ok(b.includes(`• EVERY LINE CAN BE SAID IN TEN SECONDS — 8 to 18 spoken words, and never more than ${LINE_WORDS_MAX}: a longer line is cut off at the end of its shot. Count them.`));
  assert.ok(b.includes('• ONLY WHAT IS SAID — a line is the spoken words and nothing else: no stage directions, nothing in brackets or asterisks, no "(whispering)", no sound effects'));
  assert.ok(b.includes('• IT STILL JOINS UP — the scene before it ends on "Odo: Then somebody is up there now, because I can hear the gallery door banging in the wind." and the scene after it opens on "Wren: It is warm. Somebody lit it and put it out." — the rewritten scene starts from the one and hands over to the other.'));
  assert.ok(b.includes("• THE SAME LANGUAGE as the lines above."));
  assert.ok(b.endsWith('Return "lines": scene 2\'s new lines in order. Each has "speaker" (one of the names above, exactly), "line" (the spoken words only) and "tone" (a few words on HOW it is delivered, matching the words — "quietly, not looking up").'));
  // not said when it is not so
  assert.ok(!b.includes("FOR VERY YOUNG CHILDREN") && !b.includes("THE SHOT WITH NO LINE STAYS") && !b.includes("[close-up on"));
});

test("…and the rules that depend on the scene: first, last, the close-up, the shot nobody speaks in, a children's film", () => {
  const first = rewriteBrief({ treatment: TREATMENT, placeIndex: 0, note: NEW_TAKE, speakers: CAST });
  assert.ok(first.startsWith('You are rewriting ONE scene of a short acted film called "TEST'), "no format named, none said");
  assert.ok(first.includes('• IT STILL JOINS UP — it is where the film OPENS, and the scene after it opens on "Odo: Count the steps with me, there were ninety-two this morning." — the rewritten scene still sets that up.'));
  assert.ok(first.includes(`THE DIRECTOR'S NOTE on scene 1: "${NEW_TAKE.ask}"`));
  const lamp = rewriteBrief({ treatment: TREATMENT, placeIndex: 2, note: TWIST, speakers: CAST });
  assert.ok(lamp.includes("6. Odo: Look at the glass.   [what we see: Odo lifts the lantern to the great lens while Wren pulls the dust sheet off it]   [close-up on Odo]"));
  assert.ok(lamp.includes('A shot marked "[close-up on NAME]" is filmed on that person: its line is still theirs.'));
  const last = rewriteBrief({ treatment: TREATMENT, placeIndex: 3, note: TWIST, speakers: CAST });
  assert.ok(last.includes('• IT STILL JOINS UP — the scene before it ends on "Odo: Look at the glass." — the rewritten scene starts from there, and it is where the film ENDS: its last line lands the story.'));
  assert.ok(last.includes("the scene has 2 spoken lines now: return 1 to 3"), "the shot nobody speaks in is not counted as a line");
  assert.ok(last.includes("• THE SHOT WITH NO LINE STAYS — scene 4 ends on a shot nobody speaks in: it is not yours to write. Your last line is the last thing said before it."));
  const kids = rewriteBrief({ treatment: { scenes: OLD }, placeIndex: 0, note: TWIST, speakers: ["Pim", "Quill"], template: { name: "Kids Cartoon", childSafe: true } });
  assert.ok(kids.includes("• FOR VERY YOUNG CHILDREN — happy, gentle and safe: nothing scary, sad, violent or unkind, whatever the note says."));
  assert.ok(kids.includes("• IT STILL JOINS UP — it is the whole film: it still opens the story and lands its ending."));
  assert.ok(kids.includes("the scene has 3 spoken lines now: return 2 to 4"));
  // a place with nothing said in it yet; a place that is not there
  assert.ok(rewriteBrief({ treatment: { scenes: [{ visual: "v", where: "a test yard", caption: "Pim: " }] }, placeIndex: 0, note: TWIST, speakers: ["Pim", "Quill"] }).includes("• A SHORT SCENE — it has no lines yet: write 2 to 4."));
  assert.equal(rewriteBrief({ treatment: TREATMENT, placeIndex: 9, note: TWIST, speakers: CAST }), "");
  // who may speak: the place's own two, in the cast's spelling; a monologue is filled from the cast
  assert.deepEqual(speakersInPlace(LIGHTHOUSE, 1, CAST), ["Odo", "Wren"]);
  assert.deepEqual(speakersInPlace([{ visual: "", where: "w", caption: "WREN: alone here" }], 0, CAST), ["Wren", "Odo"]);
  assert.deepEqual(speakersInPlace([{ visual: "", where: "w", caption: "Pim: a" }, { visual: "", where: "w", caption: "Quill: b" }], 0, CAST), ["Pim", "Quill"]);
  assert.deepEqual(speakersInPlace(LIGHTHOUSE, 9, CAST), CAST);
});

test("the answer has a shape the writer is held to", () => {
  assert.deepEqual(rewriteSchema, {
    type: "object",
    properties: { lines: { type: "array", items: { type: "object", properties: { speaker: { type: "string" }, line: { type: "string" }, tone: { type: "string" } }, required: ["speaker", "line"], additionalProperties: false } } },
    required: ["lines"],
    additionalProperties: false,
  });
});

const GOOD = { lines: [
  { speaker: "ODO", line: "Count them again with me, slowly, because there were ninety-two steps this morning.", tone: "tight, counting" },
  { speaker: "Wren", line: "Ninety-three, ninety-four — Odo, somebody has added stairs to this tower since noon." },
] };

test("what comes back is checked: a good rewrite is taken, in the cast's own spelling", () => {
  assert.deepEqual(parseRewriteLines(JSON.stringify(GOOD), CAST), [
    { caption: "Odo: Count them again with me, slowly, because there were ninety-two steps this morning.", tone: "tight, counting" },
    { caption: "Wren: Ninety-three, ninety-four — Odo, somebody has added stairs to this tower since noon." },
  ]);
  assert.deepEqual(parseRewrite(JSON.stringify(GOOD), CAST), ["Odo: Count them again with me, slowly, because there were ninety-two steps this morning.", "Wren: Ninety-three, ninety-four — Odo, somebody has added stairs to this tower since noon."]);
  assert.deepEqual(parseRewrite(GOOD, CAST), parseRewrite(JSON.stringify(GOOD), CAST), "already an object");
  // lines written the old way ("NAME: words"), numbered or not
  assert.deepEqual(parseRewrite({ lines: ["1. Wren: Keep the light up.", "odo: I am keeping the light up."] }, CAST), ["Wren: Keep the light up.", "Odo: I am keeping the light up."]);
  // the label written into the line as well is not said twice
  assert.deepEqual(parseRewrite({ lines: [{ speaker: "Odo", line: "ODO: Look at the glass, Wren." }] }, CAST), ["Odo: Look at the glass, Wren."]);
  // a stage direction is never spoken: brackets go, an asterisked aside at either end goes, emphasis stays as the word
  assert.deepEqual(parseRewrite({ lines: [
    { speaker: "Wren", line: "(whispering) It is still warm. [beat] Somebody lit it." },
    { speaker: "Odo", line: "*swallows* Then they are *still* in here. *looks up*" },
    { speaker: "Wren", line: "“Do not turn around.”" },
    { speaker: "Odo", line: "*Run.*" },
  ] }, CAST), ["Wren: It is still warm. Somebody lit it.", "Odo: Then they are still in here.", "Wren: Do not turn around.", "Odo: Run."]);
  // told apart the way the film tells them apart: by the first word of a name, or its last
  assert.deepEqual(parseRewrite({ lines: [{ speaker: "Old Odo", line: "It was the wind." }] }, CAST), ["Odo: It was the wind."]);
  assert.deepEqual(parseRewrite({ lines: [{ speaker: "Mary", line: "It was the wind." }] }, ["Mourning Mary", "Odo"]), ["Mourning Mary: It was the wind."]);
});

test("…and anything unusable refuses the WHOLE rewrite: the scene stays as it was", () => {
  const line = (speaker: string, text: string) => ({ speaker, line: text });
  const bad: Array<[string, unknown]> = [
    ["not JSON", "Here is your scene!"],
    ["nothing", ""], ["null", null], ["a number", 7], ["a list", ["Wren: a"]],
    ["no lines", {}], ["lines not a list", { lines: "Wren: a" }], ["an empty list", { lines: [] }],
    ["somebody who is not in the scene", { lines: [GOOD.lines[0], line("The Keeper", "I have been up here all along, waiting for the two of you.")] }],
    ["no speaker", { lines: [line("", "Who said this?")] }],
    ["a line with no label", { lines: ["Just some words with no name."] }],
    ["an empty line", { lines: [GOOD.lines[0], line("Wren", "   ")] }],
    ["only a stage direction", { lines: [line("Wren", "(she says nothing)")] }],
    ["a line no shot can hold", { lines: [line("Wren", Array.from({ length: LINE_WORDS_MAX + 5 }, () => "word").join(" "))] }],
    ["something that is not a line", { lines: [GOOD.lines[0], 7] }],
    ["far too many lines", { lines: Array.from({ length: 25 }, () => GOOD.lines[0]) }],
  ];
  for (const [why, raw] of bad) {
    assert.equal(parseRewrite(raw, CAST), null, why);
    assert.equal(parseRewriteLines(typeof raw === "string" ? raw : JSON.stringify(raw), CAST), null, `${why} (as text)`);
  }
  // the longest line a shot CAN hold is taken
  assert.equal(parseRewrite({ lines: [line("Wren", Array.from({ length: LINE_WORDS_MAX + 4 }, () => "word").join(" "))] }, CAST)?.length, 1);
  // the number of lines: the scene's own, give or take one
  const n = (k: number) => ({ lines: Array.from({ length: k }, (_, i) => line(i % 2 ? "Odo" : "Wren", "These are words that somebody could say out loud.")) });
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((k) => !!parseRewrite(n(k), CAST, 3)), [false, true, true, true, false, false]);
  assert.ok(parseRewrite(n(6), CAST), "with no number to hold it to, six is six");
  // nobody to speak, nothing taken
  assert.equal(parseRewrite(GOOD, []), null);
});

test("the scene is replaced — and nothing else in the script moves", () => {
  const lines = parseRewriteLines(GOOD, CAST)!;
  const same = applyRewrite(LIGHTHOUSE, 1, lines);
  assert.equal(same.length, LIGHTHOUSE.length);
  assert.deepEqual(same[2], { visual: LIGHTHOUSE[2].visual, where: STAIRS, caption: lines[0].caption, tone: "tight, counting" });
  // the shot that had no place of its own is still in the stairs, and says so now
  assert.deepEqual(same[3], { visual: "Wren grips the rope rail", where: STAIRS, caption: lines[1].caption });
  for (const i of [0, 1, 4, 5, 6, 7, 8]) assert.equal(same[i], LIGHTHOUSE[i], `shot ${i} is the very same shot`);
  assert.deepEqual(flowOf(same).map((l) => l.where), [KITCHEN, STAIRS, LAMP, ROCKS]);
  // how a line was said goes with the line: the kitchen's old tone does not stay on a new line
  const kitchen = applyRewrite(LIGHTHOUSE, 0, ["Wren: New words.", "Odo: And new words back."]);
  assert.deepEqual(kitchen[0], { visual: LIGHTHOUSE[0].visual, where: KITCHEN, caption: "Wren: New words." });
  assert.ok(!("tone" in kitchen[0]));
  // one line more: a new shot, in that place, at the last shot's angle, seen as the place is first seen
  const more = applyRewrite(LIGHTHOUSE, 2, ["Wren: One.", "Odo: Two.", "Wren: Three."]);
  assert.equal(more.length, LIGHTHOUSE.length + 1);
  assert.deepEqual(more.slice(4, 7), [
    { visual: LIGHTHOUSE[4].visual, where: LAMP, caption: "Wren: One." },
    { visual: LIGHTHOUSE[5].visual, where: LAMP, shot: "close-up on Odo", caption: "Odo: Two." },
    { visual: LIGHTHOUSE[4].visual, where: LAMP, shot: "close-up on Odo", caption: "Wren: Three." },
  ]);
  assert.equal(more[7], LIGHTHOUSE[6]);
  // one line fewer: the place's last spoken shot goes
  const fewer = applyRewrite(LIGHTHOUSE, 0, ["Odo: Only this."]);
  assert.equal(fewer.length, LIGHTHOUSE.length - 1);
  assert.deepEqual(flowOf(fewer)[0].angles[0].beats.map((b) => b.line), ["Only this."]);
  // the shot nobody speaks in stays, last, with its picture — whatever the count does
  for (const rocks of [["Odo: A."], ["Odo: A.", "Wren: B."], ["Odo: A.", "Wren: B.", "Odo: C."]]) {
    const out = applyRewrite(LIGHTHOUSE, 3, rocks);
    assert.deepEqual(out[out.length - 1], LIGHTHOUSE[8], `${rocks.length} lines`);
    assert.deepEqual(placeLines(out, 3), [...rocks, ""]);
  }
  // lines added by hand and never typed are taken over by the rewrite
  const blank: FlowScene[] = [{ visual: "v", where: "a test yard", caption: "Pim: " }, { visual: "v", where: "a test yard", caption: "Quill: " }];
  assert.deepEqual(applyRewrite(blank, 0, ["Pim: Hello.", "Quill: Hello back.", "Pim: Good."]).map((s) => s.caption), ["Pim: Hello.", "Quill: Hello back.", "Pim: Good."]);
  // nothing to put, or nowhere to put it: the script as it was
  assert.deepEqual(applyRewrite(LIGHTHOUSE, 1, []), LIGHTHOUSE);
  assert.deepEqual(applyRewrite(LIGHTHOUSE, 9, lines), LIGHTHOUSE);
  assert.equal(LIGHTHOUSE[2].caption, "Odo: Count the steps with me, there were ninety-two this morning.", "the script handed in is never changed");
});

test("the notes: \"New take\" is on every scene, and a key that is nobody's note is no note", () => {
  assert.deepEqual(GENERIC_NOTES.map((n) => [n.key, n.label]), [["stakes", "Raise the stakes"], ["tension", "More tension"], ["shorter", "Shorter"], ["twist", "Add a twist"]]);
  assert.deepEqual([NEW_TAKE.key, NEW_TAKE.label], ["newtake", "New take"]);
  for (const n of [...GENERIC_NOTES, NEW_TAKE]) assert.ok(n.ask.length > 40 && n.ask.length < 400 && /[.!]$/.test(n.ask), `${n.key}: a sentence for the writer`);
  assert.equal(noteByKey(GENERIC_NOTES, "twist"), GENERIC_NOTES[3]);
  assert.equal(noteByKey(GENERIC_NOTES, "newtake"), NEW_TAKE);
  assert.equal(noteByKey([], "newtake"), NEW_TAKE);
  assert.equal(noteByKey(null, " newtake "), NEW_TAKE);
  for (const k of ["", "scarier", "TWIST", undefined, null, 7]) assert.equal(noteByKey(GENERIC_NOTES, k), null, String(k));
  // the page sends a KEY; the sentence the writer reads is looked up on the server, never sent by a browser
  assert.equal(noteByKey([{ key: "scarier", label: "Scarier", ask: "Make it frightening." }], "scarier")?.ask, "Make it frightening.");
});

test("the rewrite itself: the films' own writer, the schema forced, asked twice at most, and nothing thrown", () => {
  const src = read("app", "lib", "film-rewrite.server.ts");
  assert.ok(src.includes('import { anthropicText } from "./anthropic.server";'));
  assert.ok(src.includes('model: "claude-sonnet-5",\n        maxTokens: REWRITE_MAX_TOKENS,\n        jsonSchema: { name: "scene_rewrite", schema: rewriteSchema as unknown as Record<string, unknown> },'));
  assert.ok(src.includes("for (let attempt = 0; attempt < 2; attempt++) {"));
  // what comes back is held to the scene's own speakers and its own number of lines
  assert.ok(src.includes("const lines = parseRewriteLines(raw, who, had || undefined);"));
  assert.ok(src.includes("const who = speakersInPlace(scenes, placeIndex, speakers);"));
  assert.ok(!/\bthrow\b/.test(codeOf(src)), "the code never throws");
});

/* ==== THE THREE PIECES, DRAWN =============================================================================
 * They cannot be mounted here (there is no DOM), but they can be DRAWN: each is compiled as it stands and
 * rendered to markup by React's own server renderer, with the real icons and the real film-flow under it.
 * What a tap does was driven and photographed in the harness (real touches, a real drag, real keys);
 * what is held here is what the page is handed before anything is tapped. */

const requireCjs = createRequire(import.meta.url);
function loadTsx(file: string[], mods: Record<string, unknown>): Record<string, unknown> {
  const ts = requireCjs("typescript");
  const js: string = ts.transpileModule(read(...file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  new Function("module", "exports", "require", js)(mod, mod.exports, (id: string) => (id in mods ? mods[id] : requireCjs(id)));
  return mod.exports;
}
const React = requireCjs("react") as { createElement: (type: unknown, props: unknown) => unknown };
const { renderToStaticMarkup } = requireCjs("react-dom/server") as { renderToStaticMarkup: (el: unknown) => string };
const icons = loadTsx(["app", "lib", "icons.tsx"], {});
const kit = { "../../lib/icons": icons, "../../lib/film-flow": flowLib };
const { SceneBoard, NEW_TAKE_KEY } = loadTsx(["app", "components", "film", "SceneBoard.tsx"], kit) as { SceneBoard: unknown; NEW_TAKE_KEY: string };
const slider = loadTsx(["app", "components", "film", "LengthSlider.tsx"], kit) as {
  LengthSlider: unknown; LENGTH_TICKS: readonly number[];
  tickAt: (seconds: number, stops: number[]) => number | null; ticksFor: (stops: number[], gap?: number) => Array<{ seconds: number; at: number }>;
};
const nudges = loadTsx(["app", "components", "film", "StarterNudges.tsx"], kit) as { StarterNudges: unknown; nudgeHint: string };
const draw = (type: unknown, props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(type, props));
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
/** t(), as the page hands it over — here it only fills the {placeholders} in. */
const say = (s: string, p?: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(p?.[k] ?? `{${k}}`));
const nothing = () => {};

const STOPS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 21, 24, 27, 30, 36, 42, 48, 54, 60];
const sliderProps = (over: Record<string, unknown> = {}) => ({
  stops: STOPS, value: 18, onChange: nothing, secondsOf: (n: number) => n * 5, tokensOf: (n: number) => n * 25,
  minutesOf: (n: number) => [n * 2.5, n * 3.05] as [number, number], unit: "shots", free: true, t: say, ...over,
});

test("THE LENGTH SLIDER (\"a sexy slider … up to 5 minutes with estimated final pricing\"): one real range control, the length large, the price and the wait under it", () => {
  const html = draw(slider.LengthSlider, sliderProps());
  // ONE control, and it is a real one: a keyboard and a screen reader get it for nothing
  assert.equal(count(html, "<input"), 1);
  assert.equal(count(html, "<button"), 0, "it replaced five buttons with no button at all");
  const input = /<input[^>]*>/.exec(html)![0];
  for (const attr of ['type="range"', 'min="0"', 'max="22"', 'step="1"', 'value="13"', 'aria-label="How long?"', 'aria-valuetext="1:30 · 18 shots · ≈ 450 tokens"', 'class="fk-len-in"']) assert.ok(input.includes(attr), `${attr} in ${input}`);
  // the readout belongs to that control
  const id = /id="([^"]+)"/.exec(input)![1];
  assert.ok(html.includes(`<output class="fk-len-time fk-num" for="${id}">1:30</output>`), html);
  assert.ok(html.includes('<span class="fk-len-count fk-num">18 shots</span>'));
  // under it: what it costs, how long it takes — and "free" BESIDE the estimate, never instead of it
  assert.ok(html.includes('<span class="fk-len-cost fk-num">≈ 450 tokens</span>'));
  assert.ok(html.includes('<span class="fk-len-takes fk-num">renders in about 45–55 min</span>'));
  assert.ok(html.includes('<span class="fk-len-free">free while we finish films</span>'));
  const paid = draw(slider.LengthSlider, sliderProps({ free: false }));
  assert.ok(!paid.includes("fk-len-free") && paid.includes("≈ 450 tokens"), "no tag when it is not free; the estimate either way");
  // the thumb is where the stop is (13 of 22), and the figures' boxes are as wide as the widest they will show
  assert.ok(html.includes(`--p:${13 / 22}`), html.slice(0, 200));
  assert.ok(html.includes("--clock:4ch") && html.includes("--count:9ch"), "\"5:00\" and \"60 shots\", reserved");
  // the film and the frame are pictures of the control, not controls
  assert.ok(html.includes('<span class="fk-len-film" aria-hidden="true"><i class="fk-len-lit"></i></span>'));
  assert.ok(html.includes('<span class="fk-len-thumb" aria-hidden="true">'));
  assert.ok(html.indexOf("fk-len-in") < html.indexOf("fk-len-thumb"), "the thumb comes after the input: its focus ring is drawn on the thumb");
});

test("…at its ends, between its stops, and for a told story", () => {
  const at = (value: number, over: Record<string, unknown> = {}) => draw(slider.LengthSlider, sliderProps({ value, ...over }));
  // twenty seconds
  const short = at(4);
  assert.ok(short.includes(">0:20</output>") && short.includes(">4 shots<") && short.includes("≈ 100 tokens") && short.includes("renders in about 10–12 min"), short);
  assert.ok(short.includes('value="2"'));
  // five minutes: thousands are grouped, and past an hour the wait is said to the nearest five minutes
  const long = at(60);
  assert.ok(long.includes(">5:00</output>") && long.includes(">60 shots<") && long.includes("≈ 1,500 tokens"), long);
  assert.ok(long.includes("renders in about 2 h 30 min – 3 h 5 min"), long);
  assert.ok(long.includes('aria-valuetext="5:00 · 60 shots · ≈ 1,500 tokens"'));
  assert.ok(long.includes("--p:1;"));
  assert.ok(at(2).includes("--p:0;") && at(2).includes(">0:10</output>"));
  // a count that is not one of the stops shows the stop nearest it (and never a position that is not one)
  assert.ok(at(17).includes('value="12"') && at(17).includes(">16 shots<"));
  assert.ok(at(999).includes(">60 shots<") && at(-4).includes(">2 shots<"));
  // one shot is "1 shot"; a told story counts scenes
  assert.ok(at(1, { stops: [1, 2, 3] }).includes(">1 shot<"));
  const told = at(6, { unit: "scenes", stops: [3, 4, 5, 6, 8, 10, 12], secondsOf: (n: number) => n * 10 });
  assert.ok(told.includes(">6 scenes<") && told.includes(">1:00</output>") && told.includes('aria-valuetext="1:00 · 6 scenes · ≈ 150 tokens"'), told);
  // a wait that is one number, an hour on the dot, and no stops at all
  assert.ok(at(18, { minutesOf: () => [50, 50] }).includes("renders in about 50 min"));
  assert.ok(at(18, { minutesOf: () => [55, 120] }).includes("renders in about 55 min – 2 h"));
  assert.ok(at(7, { stops: [] }).includes(">7 shots<"));
  assert.ok(at(18, { disabled: true }).includes('disabled=""') && at(18, { disabled: true }).includes("fk-len is-off"));
});

test("the strip is labelled BY TIME: each label where its length falls between the stops — and none on top of another", () => {
  assert.deepEqual([...slider.LENGTH_TICKS], [30, 60, 120, 180, 300]);
  const secs = STOPS.map((n) => n * 5);
  // a length that IS a stop sits on that stop; one between two stops, between them in proportion
  assert.equal(slider.tickAt(60, secs), 10 / 22);
  assert.equal(slider.tickAt(300, secs), 1);
  assert.equal(slider.tickAt(10, secs), 0);
  assert.equal(slider.tickAt(120, secs), 15 / 22, "2:00 is 24 shots: the sixteenth stop");
  assert.equal(slider.tickAt(65, secs), 10.5 / 22, "halfway between 12 shots (1:00) and 14 (1:10)");
  // a strip that does not reach a length has no label for it
  assert.equal(slider.tickAt(5, secs), null);
  assert.equal(slider.tickAt(301, secs), null);
  assert.equal(slider.tickAt(60, []), null);
  assert.deepEqual(slider.ticksFor(secs).map((k) => k.seconds), [30, 60, 120, 180, 300]);
  const html = draw(slider.LengthSlider, sliderProps());
  assert.deepEqual([...html.matchAll(/--at:([\d.]+)">([\d:]+)</g)].map((m) => [m[2], Number(m[1])]), [["0:30", 4 / 22], ["1:00", 10 / 22], ["2:00", 15 / 22], ["3:00", 18 / 22], ["5:00", 1]]);
  assert.ok(html.includes('<div class="fk-len-ticks" aria-hidden="true">'));
  // a short strip (a told story of up to two minutes): only what it reaches
  assert.deepEqual(slider.ticksFor([30, 40, 50, 60, 80, 100, 120]).map((k) => k.seconds), [30, 60, 120]);
  // labels that would touch: one too close to the label before it is left out (here 1:00 and 2:00, a
  // quarter of the strip or less after 0:30)…
  assert.deepEqual(slider.ticksFor([20, 100, 200, 290, 300], 0.3).map((k) => [k.seconds, Math.round(k.at * 1000) / 1000]), [[30, 0.031], [180, 0.45], [300, 1]]);
  // …and the last (the longest film there is) is always there: the label before it gives way (here 3:00)
  assert.deepEqual(slider.ticksFor([100, 170, 180, 300], 0.4).map((k) => k.seconds), [120, 300]);
});

const STARTERS = ["TEST — Two keepers hear the lamp room door bang, though the stairs have been empty since noon.", "TEST — A baker finds her late husband's handwriting on tomorrow's order slips.", "TEST — Two sisters find a music box only one of them can hear.", "TEST — a fourth, not shown"];

test("STARTER NUDGES (\"atleast need a starter nudge … to hand to the writer\"): three starters, each whole, a tap away from the box", () => {
  const html = draw(nudges.StarterNudges, { starters: STARTERS, onPick: nothing, onMore: nothing, t: say });
  assert.ok(html.includes("Need a nudge?"));
  assert.equal(count(html, 'class="fk-nudge-card"'), 3, "three, however many there are");
  for (const s of STARTERS.slice(0, 3)) assert.ok(html.includes(`<span class="fk-nudge-txt" dir="auto">${s.replace(/'/g, "&#x27;")}</span>`), `whole: ${s}`);
  assert.ok(!html.includes("a fourth, not shown"));
  assert.equal(count(html, "Use this"), 3);
  assert.ok(/<button type="button" class="fk-nudge-more">.*More ideas<\/button>/.test(html), html);
  // not urged: no line about an empty box
  assert.ok(!html.includes("fk-nudge-hint") && html.includes('<div class="fk fk-nudge">'));
  // the line for a press of "write" on an empty box, and where it is said
  assert.equal(nudges.nudgeHint, "Give the writer a sentence or two — or tap a starter");
  const urged = draw(nudges.StarterNudges, { starters: STARTERS, onPick: nothing, onMore: nothing, urge: true, t: say });
  assert.ok(urged.includes('<p class="fk-nudge-hint" role="status">Give the writer a sentence or two — or tap a starter</p>'));
  assert.ok(urged.includes('<div class="fk fk-nudge is-urge">'));
  // the cards a member arrives to are simply there: nothing is "dealt" until they ask
  assert.ok(html.includes('<ul class="fk-nudge-list">'));
  // nothing to offer, nothing drawn
  assert.equal(draw(nudges.StarterNudges, { starters: [], onPick: nothing, onMore: nothing, t: say }), "");
  // what is tapped is what goes in the box — in the member's language
  const src = read("app", "components", "film", "StarterNudges.tsx");
  assert.ok(src.includes("const text = t(s);") && src.includes("onClick={() => { setTaken(s); onPick(text); }}"));
});

const boardProps = (over: Record<string, unknown> = {}) => {
  const scenes = (over.scenes as FlowScene[]) || LIGHTHOUSE;
  const speakers = speakersOf(scenes, CAST);
  return {
    flow: flowOf(scenes), speakers, faceOf: (n: string) => (nameTok(n) === "wren" ? "/avatars/test-face.jpg" : null), displayName: (n: string) => speakers.find((s) => nameTok(s) === nameTok(n)) || n,
    backdrops: [{ key: "house", label: "Old house", where: "the hallway of an old house at night" }, { key: "kitchen", label: "Kitchen" }],
    notes: [{ key: "scarier", label: "Scarier" }, { key: "slower", label: "Slower burn" }, { key: "shorter", label: "Shorter" }, { key: "twist", label: "Add a twist" }],
    sketches: ["/renders/img-test-1.jpg", null, "/renders/img-test-3.jpg", null], sketching: false, noting: null, aspect: "16:9", title: "TEST — The Lighthouse",
    totalSeconds: 26, secondsOf: (text: string) => text.split(/\s+/).filter(Boolean).length * 0.5, maxSeconds: 10,
    onLine: nothing, onSpeaker: nothing, onAddLine: nothing, onRemoveLine: nothing, onCloseUp: nothing, onAngleShot: nothing, onRemoveAngle: nothing,
    onWhere: nothing, onMove: nothing, onRemovePlace: nothing, onAddScene: nothing, onNote: nothing, onRewriteAll: nothing, t: say, ...over,
  };
};
const sheets = (html: string) => html.split("<article").slice(1).map((s) => s.split("</article>")[0]);

test("THE SCENE BOARD (\"boring and a chore\" → a board): a slate, a sheet per place, a dashed frame for the next one", () => {
  const html = draw(SceneBoard, boardProps());
  assert.ok(html.startsWith('<section class="fk fk-board" data-aspect="16:9" aria-label="Storyboard">'), html.slice(0, 120));
  // the slate: the film's title, "4 scenes · ≈ 0:26", Rewrite all
  assert.ok(html.includes("<i>Production</i><b>TEST — The Lighthouse</b>"));
  assert.ok(html.includes('<div class="fk-slate-meta">4 scenes <span aria-hidden="true">·</span> <span class="fk-num" title="Estimated spoken length of the whole film">≈ 0:26</span></div>'), html.slice(0, 900));
  assert.ok(/<button type="button" class="fk-slate-rw">.*Rewrite all<\/button>/.test(html.split("</header>")[0]));
  assert.ok(draw(SceneBoard, boardProps({ title: "  " })).includes("<b>Untitled film</b>"));
  assert.ok(draw(SceneBoard, boardProps({ rewriteArmed: true })).includes("Tap again to rewrite"), "the page's \"asked first\" shows on the button");
  // four sheets, each a place: its number and its own words on the strip
  const four = sheets(html);
  assert.equal(four.length, 4);
  [KITCHEN, STAIRS, LAMP, ROCKS].forEach((where, i) => {
    assert.ok(four[i].includes(`<span class="fk-tag"><i aria-hidden="true"></i>SC ${i + 1}</span><span class="fk-place" dir="auto">${where}</span>`), `sheet ${i + 1}`);
    assert.ok(four[i].includes(`aria-label="Scene ${i + 1}: ${where}"`));
  });
  // between sheets a cut mark, not a sentence: the film fades in, then cuts
  assert.deepEqual([...html.matchAll(/<\/svg> (FADE IN|CUT TO)<span>/g)].map((m) => m[1]), ["FADE IN", "CUT TO", "CUT TO", "CUT TO", "CUT TO"]);
  // after the last, the next one
  assert.ok(/<button type="button" class="fk-new">.*<b>New scene<\/b><small>They go somewhere else<\/small><\/button><\/li><\/ol><\/section>$/.test(html));
  // "New take" is the board's own note, under the key the writer's side knows it by
  assert.equal(NEW_TAKE_KEY, NEW_TAKE.key);
});

test("…the picture: a sketch where there is one, a drawn sheet where there is not — never a grey box", () => {
  const html = draw(SceneBoard, boardProps());
  const four = sheets(html);
  assert.ok(four[0].includes('<img class="fk-sketch" src="/renders/img-test-1.jpg" alt="Storyboard sketch of scene 1" loading="lazy"'));
  assert.ok(four[2].includes('src="/renders/img-test-3.jpg"'));
  for (const i of [1, 3]) {
    assert.ok(!four[i].includes("<img"), `sheet ${i + 1} has no picture yet`);
    assert.ok(four[i].includes('<div class="fk-blank">') && four[i].includes(`<span class="fk-blank-n" aria-hidden="true">${i + 1}</span>`));
  }
  assert.ok(!html.includes("Sketching…"));
  // while they are being drawn, the blank ones say so
  const drawing = sheets(draw(SceneBoard, boardProps({ sketching: true })));
  assert.ok(drawing[1].includes('<div class="fk-blank is-drawing">') && drawing[1].includes('<span class="fk-blank-say">Sketching…</span>'));
  assert.ok(!drawing[0].includes("Sketching…"), "a sheet that has its sketch does not");
  // the film's shape is the board's
  assert.ok(draw(SceneBoard, boardProps({ aspect: "9:16" })).startsWith('<section class="fk fk-board" data-aspect="9:16"'));
});

test("…the lines: a conversation in TEXT — bubbles beside faces, sides by speaker, no box to fill in", () => {
  const html = draw(SceneBoard, boardProps());
  // AT REST NOTHING IS A FORM: not one text box on the whole board
  assert.equal(count(html, "<textarea"), 0);
  assert.equal(count(html, "<input"), 0);
  // every spoken line is a bubble (a button to tap), with its words as they are
  assert.equal(count(html, 'class="fk-bubble"'), 8);
  assert.ok(html.includes('<button type="button" class="fk-bubble" dir="auto" title="Tap to edit this line">Look at the glass.</button>'));
  // sides: Wren on the left, Odo answering from the right
  const kitchen = sheets(html)[0];
  assert.deepEqual([...kitchen.matchAll(/class="fk-line (left|right)"/g)].map((m) => m[1]), ["left", "right"]);
  assert.deepEqual([...sheets(html)[1].matchAll(/class="fk-line (left|right)"/g)].map((m) => m[1]), ["right", "left"]);
  // a face when they are cast, their letter when they are not — and a tap on either is "the next speaker"
  assert.ok(kitchen.includes('<button type="button" class="fk-face" style="background-image:url(/avatars/test-face.jpg)" aria-label="Wren says this — tap for the next speaker" title="Tap to switch who speaks"></button>'), kitchen.slice(0, 2400));
  assert.ok(kitchen.includes('aria-label="Odo says this — tap for the next speaker" title="Tap to switch who speaks"><span aria-hidden="true">O</span></button>'));
  // every line can be taken out…
  assert.equal(count(html, 'aria-label="Remove this line"'), 8);
  // …but not the only line of a script
  const one = draw(SceneBoard, boardProps({ scenes: [{ visual: "v", where: "a test yard", caption: "Wren: Only this." }] }));
  assert.equal(count(one, "Remove this"), 0);
  // with one speaker there is nobody to hand a line to
  const solo = boardProps({ scenes: [{ visual: "v", where: "a test yard", caption: "Wren: Only this." }] });
  assert.ok(draw(SceneBoard, { ...solo, speakers: ["Wren"] }).includes('<button type="button" class="fk-face" disabled=""'));
  // THE SECONDS: no meter on a line at rest; a quiet mark on one that runs long (0.5 s a word here, 10 s a shot)
  assert.equal(count(html, "fk-meter"), 0);
  assert.equal(count(html, "fk-long"), 0);
  const words = (n: number) => `Wren: ${Array.from({ length: n }, () => "word").join(" ")}`;
  const long = draw(SceneBoard, boardProps({ scenes: [{ visual: "v", where: "w", caption: words(19) }, { visual: "v", where: "w", caption: words(24) }, { visual: "v", where: "w", caption: words(10) }] }));
  assert.ok(long.includes('<span class="fk-long warn"') && long.includes("9.5s — nearly a full shot"));
  assert.ok(long.includes('<span class="fk-long over"') && long.includes("12s — too long for one shot"));
  assert.equal(count(long, "fk-long "), 2);
  assert.equal(count(long, "fk-meter"), 0, "the meter is for typing");
});

test("…a shot with no line is \"Seen, not said\", and a close-up is a small tag between the bubbles", () => {
  const html = draw(SceneBoard, boardProps());
  const rocks = sheets(html)[3];
  assert.equal(count(html, "Seen, not said"), 1);
  assert.ok(/<div class="fk-line is-unsaid"[^>]*><button type="button" class="fk-unsaid" title="Tap to give this shot a line">.*Seen, not said<\/button>/.test(rocks), rocks.slice(-1800));
  assert.ok(rocks.includes('aria-label="Remove this shot"'));
  // a line somebody added and never typed is one too (it is filmed with nobody speaking)
  const blank = draw(SceneBoard, boardProps({ scenes: [{ visual: "v", where: "w", caption: "Wren: Hello." }, { visual: "v", where: "w", caption: "Odo: " }] }));
  assert.equal(count(blank, "Seen, not said"), 1);
  assert.equal(count(blank, 'class="fk-bubble"'), 1);
  // the close-up: one tag, in the lamp room, before the line it is on
  assert.equal(count(html, 'class="fk-cam"'), 1);
  const lamp = sheets(html)[2];
  assert.ok(/<div class="fk-cam">.*<button type="button" class="fk-cam-txt" dir="auto" title="Change what the close-up is on">close-up on Odo<\/button><button type="button" class="fk-cam-x" aria-label="Remove this angle change">/.test(lamp), lamp);
  assert.ok(lamp.indexOf("It is warm.") < lamp.indexOf('class="fk-cam"') && lamp.indexOf('class="fk-cam"') < lamp.indexOf("Look at the glass."));
});

test("…directing is one tap: the genre's four notes and \"New take\" under every scene — and a sheet with the writer holds", () => {
  const html = draw(SceneBoard, boardProps());
  for (const sheet of sheets(html)) {
    assert.deepEqual([...sheet.split('class="fk-notes"')[1].split("</div>")[0].matchAll(/<button type="button" class="fk-note[^"]*">(?:<svg.*?<\/svg> )?([^<]+)<\/button>/g)].map((m) => m[1]), ["Scarier", "Slower burn", "Shorter", "Add a twist", "New take"]);
    assert.ok(sheet.includes('<div class="fk-notes" role="group" aria-label="Direct this scene">'));
    assert.ok(sheet.includes('<p class="fk-status" role="status" aria-live="polite"></p>'), "nothing said until something is happening");
  }
  assert.equal(count(html, "disabled"), 0, "nothing is held");
  // the stairs are with the writer
  const noting = draw(SceneBoard, boardProps({ noting: 1 }));
  const held = sheets(noting);
  assert.ok(noting.includes('<article class="fk-frame is-noting" aria-busy="true" aria-label="Scene 2:'));
  assert.equal(count(noting, "is-noting"), 1, "that sheet and no other");
  assert.ok(held[1].includes('<p class="fk-status" role="status" aria-live="polite">Rewriting scene 2…</p>'));
  assert.ok(!held[0].includes("Rewriting"));
  // …and nothing on the board can be changed until it is back (two rewrites at once would cross)
  assert.equal(count(noting, '<button type="button" class="fk-note" disabled="">') + count(noting, '<button type="button" class="fk-note fk-note-dice" disabled="">'), 20);
  assert.equal(count(noting, '<button type="button" class="fk-bubble" dir="auto" disabled=""'), 8);
  assert.ok(noting.includes('<button type="button" class="fk-slate-rw" disabled="">'));
  assert.ok(noting.includes('<button type="button" class="fk-new" disabled="">'));
  // the whole script being written again: every sheet holds
  const busy = draw(SceneBoard, boardProps({ busy: true }));
  assert.ok(busy.startsWith('<section class="fk fk-board is-busy"'));
  assert.equal(count(busy, '<article class="fk-frame is-noting" aria-busy="true"'), 4);
});

test("…quiet tools: \"+ line\" and \"close-up\" at the foot; earlier / later / remove on the corner — where they mean something", () => {
  const html = draw(SceneBoard, boardProps());
  const four = sheets(html);
  for (const sheet of four) {
    const foot = sheet.split('<div class="fk-foot">')[1];
    assert.ok(/^<button type="button" class="fk-quiet">.*<\/svg> line<\/button><button type="button" class="fk-quiet">.*<\/svg> close-up<\/button><span class="fk-foot-len fk-num" title="Estimated spoken length of this scene">≈ \d:\d\d<\/span><\/div>$/.test(foot), foot);
  }
  const has = (sheet: string) => ["earlier", "later"].map((w) => sheet.includes(`aria-label="Move scene ${four.indexOf(sheet) + 1} ${w}"`));
  assert.deepEqual(four.map(has), [[false, true], [true, true], [true, true], [true, false]], "the first cannot go earlier, the last cannot go later");
  assert.equal(count(html, 'class="fk-tool fk-rm" aria-label="Remove scene'), 4);
  assert.equal(count(html, "Remove?"), 0, "removing a scene is asked twice: nothing is armed until it is tapped");
  // a script of one place has nothing to move and nothing that may be removed
  const one = draw(SceneBoard, boardProps({ scenes: OLD }));
  assert.equal(count(one, "fk-tools"), 0);
  // the place opens on a tap of the strip — and until then the backdrops are not there
  assert.equal(count(html, 'class="fk-strip" aria-expanded="false" title="Change where this scene happens"'), 4);
  assert.equal(count(html, "fk-bds") + count(html, "fk-where"), 0, "hidden until asked for");
});

test("what a tap sends: scene indexes into the FLAT script, place indexes into the flow — exactly what film-flow takes", () => {
  const src = read("app", "components", "film", "SceneBoard.tsx");
  for (const call of [
    // a line's own shot
    "onChange={(e) => typeLine(b.idx, e.target.value)}", "const typeLine = (idx: number, text: string) => { setDraft(text); props.onLine(idx, text); };",
    "onClick={() => props.onSpeaker(b.idx)}", "props.onRemoveLine(b.idx);",
    // "+ line": after the LAST angle's last shot; "close-up": after the place's last shot; and the new line opens
    "openWhenAdded(lastAngle.lastIdx + 1); props.onAddLine(lastAngle.lastIdx);", "openWhenAdded(loc.lastIdx + 1); props.onCloseUp(loc.lastIdx);", "openWhenAdded(total); props.onAddScene();",
    // a close-up, by the first shot of its angle
    "props.onAngleShot(idx, next);", "onBlur={() => sendAngle(ang.beats[0].idx)}", "props.onRemoveAngle(ang.beats[0].idx);",
    // a place, by its place in the flow
    "props.onMove(li, -1);", "props.onMove(li, 1);", "props.onRemovePlace(li);", "props.onWhere(li, next);", "onClick={() => note(li, n.key)}", "onClick={() => note(li, NEW_TAKE_KEY)}",
    "const note = (li: number, key: string) => { settle(); setNoteKey(key); props.onNote(li, key); };",
    "props.onRewriteAll();",
  ]) assert.ok(src.includes(call), call);
  // WHAT IS TYPED IS KEPT WHILE IT IS TYPED: the box shows its own text, not the script's (which comes back trimmed)
  assert.ok(src.includes('<textarea ref={box} className="fk-bubble fk-bubble-in" dir="auto" rows={1} value={draft}'));
  // a place or a close-up is only sent when it is not empty (an emptied place IS the place before it)
  assert.ok(src.includes('const next = whereDraft.replace(/\\s+/g, " ").trim();\n    if (next && flow[li] && next !== flow[li].where) props.onWhere(li, next);'));
  assert.ok(src.includes('const next = angleDraft.replace(/\\s+/g, " ").trim();\n    if (next) props.onAngleShot(idx, next);'));
  // a backdrop writes its place into the scene — its own words, or its label when it has none
  assert.ok(src.includes("const where = (bd.where || t(bd.label)).trim();"));
  // removing a scene is asked twice
  assert.ok(src.includes("if (armed !== li) { setArmed(li); return; }"));
  // Escape puts back what was there — and touches nothing when nothing was typed
  assert.ok(src.includes('else if (e.key === "Escape") { e.preventDefault(); if (draft !== was.current) props.onLine(idx, was.current); closeLine(); }'));
});

/* ==== EVERY WORD, IN FIVE LANGUAGES ====================================================================== */

test("every word the three pieces show is in all five languages — with its {placeholders} intact", () => {
  const found = new Set<string>();
  for (const f of ["SceneBoard.tsx", "LengthSlider.tsx", "StarterNudges.tsx"]) {
    for (const m of read("app", "components", "film", f).matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)) found.add(JSON.parse(`"${m[1]}"`));
  }
  // …and the words that reach t() through a variable: the empty box's line, the notes' own labels, and what
  // the page says when a note could not be carried out
  found.add(nudges.nudgeHint);
  for (const n of [...GENERIC_NOTES, NEW_TAKE]) found.add(n.label);
  found.add(REWRITE_FAILED);
  assert.equal(REWRITE_FAILED, "Couldn't rewrite that scene — it is as it was. Try the note again.");
  assert.ok(found.size >= 60, `${found.size} strings`);
  for (const must of ["Rewrite all", "CUT TO", "FADE IN", "Seen, not said", "New take", "Need a nudge?", "More ideas", "free while we finish films", "≈ {n} tokens", "renders in about {a}–{b} min", "SC {n}", "Sketching…"]) assert.ok(found.has(must), must);
  const holes = (s: string) => (s.match(/\{[a-z]+\}/g) || []).sort().join(",");
  const missing: string[] = [];
  for (const lang of ["es", "fr", "de", "zh", "ur"] as const) {
    const dict = UI_DICT[lang] || {};
    for (const key of found) {
      const said = dict[key];
      if (typeof said !== "string" || !said.trim()) { missing.push(`${lang}: ${key}`); continue; }
      assert.equal(holes(said), holes(key), `${lang}: ${key} → ${said}`);
    }
  }
  assert.deepEqual(missing, []);
  // the other way of counting, the one the rest of the suite uses: the key, written five times
  const text = read("app", "lib", "ui-i18n-dict.ts");
  for (const key of found) assert.ok(count(text, `${JSON.stringify(key)}:`) >= 5, key);
});

/* ==== THE LOOK: what cannot be seen in a photograph ===================================================== */

/** The stylesheet's rules: [selector, declarations], with what encloses each (an @media, @container, @supports or @keyframes). */
function rulesOf(css: string): Array<{ sel: string; body: string; at: string }> {
  const out: Array<{ sel: string; body: string; at: string }> = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0; let at = ""; let buf = "";
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === "{") {
      const head = buf.trim(); buf = "";
      if (head.startsWith("@")) { at = head; depth++; continue; }
      const end = clean.indexOf("}", i);
      out.push({ sel: head, body: clean.slice(i + 1, end).trim(), at });
      i = end;
    } else if (ch === "}") { depth--; if (depth <= 0) { depth = 0; at = ""; } buf = ""; }
    else buf += ch;
  }
  return out;
}

test("the kit's stylesheet styles the kit and nothing else, in two themes, with the dark its own default", () => {
  const css = FILM_KIT_CSS;
  // plain text: nothing interpolated, no backslash to lose
  assert.ok(!css.includes("\\") && !css.includes("${"));
  const src = read("app", "components", "film", "film-kit-style.ts");
  assert.equal(count(src, "export const "), 1, "one exported string");
  const rules = rulesOf(css);
  assert.ok(rules.length > 180, `${rules.length} rules`);
  // every rule names the kit: .fk… — or, inside @keyframes, a step of an fk- animation
  for (const r of rules) {
    if (r.at.startsWith("@keyframes")) { assert.ok(/^@keyframes fk-[a-z]+$/.test(r.at), r.at); continue; }
    for (const part of r.sel.split(",")) assert.ok(/^(\[data-theme="light"\] |\[dir=rtl\] )?\.fk[-\w]*/.test(part.trim()), `"${part.trim()}" is not the kit's`);
  }
  for (const m of css.matchAll(/animation:(fk-[a-z]+)/g)) assert.ok(css.includes(`@keyframes ${m[1]}{`), m[1]);
  for (const m of css.matchAll(/animation:([a-z-]+) /g)) assert.ok(m[1].startsWith("fk-") , `animation ${m[1]}`);
  // THE DARK IS ITS OWN DEFAULT — a deep green wall, gold marks; the light is anything inside data-theme="light"
  const root = rules.find((r) => r.sel === ".fk")!;
  assert.ok(root.body.includes("--fk-wall:#0C2217;") && root.body.includes("--fk-mark:#E7C879;") && root.body.includes("--fk-on-wall:#FFFDF7;"));
  const light = rules.find((r) => r.sel === '[data-theme="light"] .fk,.fk[data-theme="light"]')!;
  assert.ok(light.body.includes("--fk-wall:#EDF3EC;") && light.body.includes("--fk-mark:#0C7A46;") && light.body.includes("--fk-on-wall:#14201A;"));
  // …and the light changes ONLY what is around the cards: the wall, its marks, a card's edge, shadow and pin
  assert.deepEqual([...light.body.matchAll(/(--fk-[a-z0-9-]+):/g)].map((m) => m[1]).sort(), ["--fk-drop", "--fk-edge", "--fk-mark", "--fk-mark-ink", "--fk-on-wall", "--fk-on-wall2", "--fk-pin", "--fk-pin-deep", "--fk-wall", "--fk-wall-edge", "--fk-wall-lit"]);
  assert.equal(count(css, "[data-theme="), 2, "no other rule knows the theme: the colours do the work");
  // "deep GREEN dark, never brown": the wall's red is its smallest part
  const [, rr, gg, bb] = /--fk-wall:#(..)(..)(..);/.exec(root.body)!.map((h) => parseInt(h, 16));
  assert.ok(gg > rr && gg > bb, "green");
  // what a member works in is the same cream and ink in both themes — a sheet, a bubble, the slider, a starter
  for (const sel of [".fk-frame", ".fk-bubble", ".fk-len", ".fk-nudge-card", ".fk-bd", ".fk-where-in"]) {
    const r = rules.find((x) => x.sel === sel && !x.at)!;
    assert.ok(/background:(#fff|var\(--fk-cream\)|linear-gradient\(180deg,#fff,#FBF8EF\))/.test(r.body), `${sel} carries its own surface`);
  }
});

test("…a finger, a phone, and less motion", () => {
  const css = FILM_KIT_CSS;
  const rules = rulesOf(css);
  const rule = (sel: string, at = "") => { const r = rules.find((x) => x.sel === sel && x.at === at); assert.ok(r, `${at} ${sel}`); return r!.body; };
  // a small control is 44px to the finger by an invisible ::after — never by growing what is drawn
  assert.equal(rule(".fk-tool::after"), 'content:"";position:absolute;inset:-6px;');           // 32 + 12
  assert.ok(rule(".fk-tool").includes("height:32px;min-width:32px;"));
  assert.ok(rule(".fk-tools").includes("gap:12px;"), "…and the three are far enough apart that their 44s do not overlap");
  assert.equal(rule(".fk-x::after"), 'content:"";position:absolute;inset:-9px;');              // 26 + 18
  assert.equal(rule(".fk-cam-x::after"), 'content:"";position:absolute;inset:-10px;');         // 24 + 20
  assert.equal(rule(".fk-face::after"), 'content:"";position:absolute;inset:-3px;');           // 38 + 6
  assert.equal(rule(".fk-note::after"), 'content:"";position:absolute;inset:-6px -2px;');      // 33 inside its border + 12
  for (const sel of [".fk-slate-rw::after", ".fk-quiet::after", ".fk-unsaid::after", ".fk-cam-txt::after", ".fk-nudge-more::after"]) assert.equal(rule(sel), 'content:"";position:absolute;left:0;right:0;top:50%;height:44px;transform:translateY(-50%);', sel);
  assert.ok(rule(".fk-bubble").includes("min-height:44px;") && rule(".fk-strip").includes("min-height:46px;") && rule(".fk-where-in").includes("min-height:44px;") && rule(".fk-bd").includes("min-height:60px;"));
  // the slider's real thumb is as wide as a finger and as tall as the strip
  assert.equal(rule(".fk-len-in::-webkit-slider-thumb"), "-webkit-appearance:none;appearance:none;width:44px;height:56px;border:0;background:transparent;");
  assert.ok(rule(".fk-len-in::-moz-range-thumb").startsWith("width:44px;height:56px;"));
  assert.ok(rule(".fk-len-strip").includes("height:56px;") && rule(".fk-len-strip").includes("touch-action:pan-y;"), "a finger that starts on it can still scroll the page");
  // …the frame a member sees is drawn at that thumb's centre, and the green reaches exactly there
  assert.ok(rule(".fk-len-thumb").includes("left:calc(var(--p,0) * (100% - 44px) + 22px);") && rule(".fk-len-lit").includes("width:calc(var(--p,0) * (100% - 44px) + 22px);") && rule(".fk-len-ticks span").includes("left:calc(var(--at,0) * (100% - 44px) + 22px);"));
  // a strip of film reads left to right in every language (the control under it must agree with the picture over it)
  assert.equal(rule(".fk-len-strip,.fk-len-ticks"), "direction:ltr;");
  // NOTHING JUMPS: tabular figures in boxes as wide as the widest value; the estimate is always two rows on a narrow strip
  assert.equal(rule(".fk-num"), "font-variant-numeric:tabular-nums;");
  assert.ok(rule(".fk-len-time").includes("min-width:var(--clock,4ch);") && rule(".fk-len-count").includes("min-width:calc(var(--count,9ch) + 24px);"));
  assert.ok(rule(".fk-len-est").includes('display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-areas:"cost free" "takes takes";'));
  assert.ok(rule(".fk-len-est", "@container fklen (min-width:600px)").startsWith("display:flex;flex-wrap:nowrap;"));
  // a phone: what is typed into is 16px (a smaller box makes iOS zoom the page) — and the rule that says so
  // comes AFTER the 15px of a line at rest, with .fk in front, so the 15 can never win
  const phone = css.split("@media(max-width:640px){")[1].split("\n}")[0];
  assert.ok(phone.includes(".fk-bubble{font-size:15px;}\n  .fk .fk-where-in,.fk .fk-bubble-in,.fk .fk-cam-in{font-size:16px;}"), phone);
  // the one row that scrolls sideways scrolls inside itself
  assert.ok(rule(".fk-bds").includes("overflow-x:auto;") && rule(".fk-bds").includes("overscroll-behavior-x:contain;"));
  // THE BOARD ON A WALL: one column; two from a board 780px wide; three from 1240px — and never four
  assert.ok(rule(".fk-wall").includes("grid-template-columns:minmax(0,1fr);"));
  assert.equal(rule(".fk-wall", "@container fkboard (min-width:780px)"), "grid-template-columns:repeat(2,minmax(0,1fr));");
  assert.equal(rule(".fk-wall", "@container fkboard (min-width:1240px)"), "grid-template-columns:repeat(3,minmax(0,1fr));");
  assert.ok(rule(".fk-board").startsWith("container-type:inline-size;container-name:fkboard;"));
  assert.ok(css.includes("@supports not (container-type:inline-size){\n  @media(min-width:900px){.fk-wall{grid-template-columns:repeat(2,minmax(0,1fr));}}\n  @media(min-width:1400px){.fk-wall{grid-template-columns:repeat(3,minmax(0,1fr));}}\n}"));
  // a hover is for a pointer that can hover: a finger's tap leaves :hover stuck
  const hover = css.split("@media(hover:hover){")[1].split("\n}")[0];
  assert.equal(count(css.replace(/\/\*[\s\S]*?\*\//g, ""), ":hover"), count(hover, ":hover") + 1, "every :hover rule is inside the one block (+1 for the block's own name)");
  assert.ok(count(hover, ":hover") >= 18);
  // LESS MOTION: nothing moves, and a sketch is simply there
  assert.ok(css.includes("@media(prefers-reduced-motion:reduce){\n  .fk *,.fk *::before,.fk *::after{animation:none!important;transition:none!important;}\n  .fk-sketch{filter:grayscale(1) contrast(1.3);opacity:1;transform:none;}"));
  // THE SKETCH: grey (one came back with a green lantern), laid on the sheet's own paper, developing in once
  assert.ok(rule(".fk-sketch").includes("mix-blend-mode:multiply;filter:grayscale(1) contrast(1.3) blur(14px);opacity:0;"));
  assert.equal(rule(".fk-sketch.is-in"), "filter:grayscale(1) contrast(1.3);opacity:1;transform:none;");
  // …and the slate strip lies over the picture's lower edge (where a picture model signs its work)
  assert.ok(rule(".fk-strip").includes("position:absolute;left:10px;right:10px;bottom:-22px;min-height:46px;"));
  assert.ok(rule(".fk-pic").includes("margin-bottom:24px;"), "…with room left under the picture for the half of it that hangs below");
});
