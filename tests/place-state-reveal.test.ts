/* THE PLACE AS IT NOW IS, IN THE PICTURES (2026-11-25, stream S12) — acted-staging.ts. The lake films' reveals stood the
 * woman in the OPEN DOORWAY between the two, in a tent whose door the story had zipped shut ("then in a frame out of
 * nowhere the tent doors are fully open again and the monster lady is standing in front of door" — the owner). At a
 * tent, and wherever the door was shut, what is outside stays OUTSIDE: its face presses the cloth in; a sighting is its
 * shadow on the cloth; the change itself is drawn and kept. Names in the made-up cases are made up. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHANGE_KEEP, CLOTH_LOOK, CLOTH_LOOK_UP, CLOTH_OUTSIDE, CLOTH_OUTSIDE_GAP, CLOTH_PALMS, CLOTH_SHADOW_OF, DONE_STAYS_DONE, NOTHING_GLOWS, REVEAL_MOVED, REVEAL_MOVED_CLOTH, REVEAL_DIM as REVEAL_DIM_WORDS, REVEAL_PARTS, REVEAL_STAY, SEEN_AT_THE_END, SIGHT_SHADOW, SIGHT_SHADOW_MOVES, SIGHT_TURN_SHADOW,
  changePicture, revealClip, revealPart, revealPicture, sightingClip, sightingPicture, silentRules, stagedRules, thingRefNote,
} from "../app/lib/acted-staging.ts";
import { placeChangeIn, placeStateAt, stateNow } from "../app/lib/place-state.ts";
import { clipRules } from "../app/lib/clip-prompt.ts";

const TENT = "inside a small tent on a moonlit lakeshore";
const P1_LAST = "Against the thin tent wall, a tall shape leans close until only the woman's face presses the fabric, waxen skin and that impossibly wide smile outlined in moonlight.";
const EP2_LAST = "Through the sagging roof fabric, pressed flat from above, the woman's wide crowded smile shows pale through soaked white cloth, unmoving, waiting.";
const sides = [{ name: "Mireille", side: "left" }, { name: "Costin", side: "right" }];
const LOOK = "a drowned-pale figure in a soaked white nightgown clinging to her limbs, skin like old candle wax, a smile far too wide and crowded with thin teeth";

test("at a tent the reveal is OUTSIDE: its face in the wall, in the roof where the words say the roof, in the zipper's gap where they say the zipper", () => {
  assert.equal(revealPart(P1_LAST, { outdoors: true, cloth: true }), "fabric");
  assert.equal(revealPart(EP2_LAST, { outdoors: true, cloth: true }), "roof");
  assert.equal(revealPart("Slowly the zipper of the shut door slides up a hand's width from outside; in the gap, her face.", { outdoors: true, cloth: true }), "zipper");
  // without the cloth, out of doors, as before
  assert.equal(revealPart(P1_LAST, { outdoors: true }), "figure");
  for (const k of ["fabric", "roof", "zipper"] as const) {
    const p = REVEAL_PARTS[k];
    assert.ok(/OUTSIDE/.test(p.seen) && /OUTSIDE|outside/.test(p.clip), k);
    assert.ok(/toward the camera\.$/.test(p.moves) && !/["“”]/.test(p.clip + p.moves), k);
    assert.ok(!/glow/i.test(p.seen + p.clip), `${k}: nothing glows`);
  }
  assert.ok(REVEAL_PARTS.fabric.moves.includes("Nothing comes through the cloth, nothing tears, nothing is inside with them"));
  assert.ok(REVEAL_PARTS.roof.moves.includes("the roof sags a little lower, slowly"));
  assert.ok(REVEAL_PARTS.zipper.moves.includes("the gap grows no wider; nothing comes through, nothing reaches in"));
  // ITS SHADOW, NEVER A FACE (the owner, of the live Episode 2's face moulded in the canvas, 2026-11-25: "looks like wizard
  // of oz trash / not realistic") — drawn on that film's own frame and LOOKED at: the moonlit silhouette reads as real
  for (const k of ["fabric", "roof", "zipper"] as const) {
    const p = REVEAL_PARTS[k];
    assert.ok(/SHADOW/.test(p.seen) && /no face, no eyes, no teeth, no features, nothing lit inside it/.test(p.seen), `${k}: a flat shadow, nothing lit inside it`);
    assert.ok(/lit from OUTSIDE|moonlit/.test(p.seen) && /turned down low|has dimmed/.test(p.seen), `${k}: the lantern down, the light outside — what makes a shadow on a tent wall`);
    assert.ok(!/moulded|relief|pale through|bulges IN where a FACE/.test(p.seen + p.clip), `${k}: never a face in the cloth`);
    assert.ok(/silhouette with no face/.test(p.clip), `${k}: the clip says so too`);
  }
});

test("the reveal's picture at a tent: the place as it now is, the face pressed in from outside — never standing in the doorway, never glowing", () => {
  const state = stateNow(placeStateAt([
    { visual: "Moments later, Mireille claws the zipper pull down hard, sealing the gap as Costin presses both palms flat against the tent wall.", where: TENT },
    { visual: "Costin drags their heavy duffel bag across the tent floor and wedges it hard against the sealed zipper seam.", where: TENT },
  ], 2));
  // EPISODE 2's last shot — handed a portrait (`ref`), the cloth reveal still takes NONE: only its shadow shows there, and
  // handed her face the editor painted it on the canvas (the owner: "wizard of oz trash", 2026-11-25)
  const roof = revealPicture({ moment: EP2_LAST, sides, outdoors: true, ref: "figure", cloth: true, tent: true, state, mood: "Every living person in it looks tense, wary or afraid — nobody smiles, grins or laughs." });
  assert.ok(roof.includes(`Show it like this, and no more of it: High in the picture, on the tent's sloping roof above them, ${REVEAL_PARTS.roof.seen}.`));
  assert.ok(!roof.includes("SECOND picture") && !roof.includes(thingRefNote("figure", { near: true, cloth: true })), "no picture of it rides along at the cloth");
  assert.ok(roof.includes(CLOTH_LOOK_UP) && !roof.includes(CLOTH_LOOK), "on the roof they look UP at it, in profile");
  assert.ok(roof.includes("The place as it now is, and it stays exactly so: The tent door is zipped completely shut"), "drawn into the shut tent, and it stays shut");
  // (its OUTSIDE is in the shadow's own words now — "lit from OUTSIDE", "nothing of it seen through the cloth"; the separate
  //  sentence is kept for the zipper's open hand's width only, and its room went to her look. Nothing glows, always.)
  assert.ok(roof.includes(NOTHING_GLOWS) && !roof.includes(CLOTH_OUTSIDE) && /nothing of it seen through the cloth/.test(roof));
  assert.ok(!roof.includes(REVEAL_DIM_WORDS), "the shadow's own words dim the lantern — never said twice");
  assert.ok(!roof.includes("In the dark close behind") && !roof.includes("This is out of doors"), "not the figure standing close behind them — the doorway");
  assert.ok(roof.length <= 2400, `${roof.length}: inside what both editors read`);
  // (with room, the place's whole state — the bag too)
  const roomy = revealPicture({ moment: "Her face presses down into the roof.", sides, outdoors: true, cloth: true, tent: true, state, ref: "figure" });
  assert.ok(roomy.includes(`The place as it now is, and it stays exactly so: ${state}`) && roomy.length <= 2400, `${roomy.length}`);
  // PART 1's last shot: "presses the fabric" — its SHADOW on the tent's wall between and behind them, its shape her look
  const wall = revealPicture({ moment: P1_LAST, sides, outdoors: true, seen: LOOK, cloth: true, tent: true });
  assert.ok(wall.includes(`On the tent's wall between and behind them, well inside the picture, ${REVEAL_PARTS.fabric.seen}.`));
  assert.ok(wall.includes(`${CLOTH_SHADOW_OF} "${LOOK}".`), "the shape of the one the film already showed — long wet hair, the nightgown");
  assert.ok(wall.includes(CLOTH_LOOK) && !wall.includes("faces drained"), "they stare at the shadow, in profile — never into the lens");
  assert.ok(!wall.includes("What is wrong with it"), "its look is the film's own");
  assert.ok(!wall.includes(CLOTH_PALMS), "no hands unless the words name them");
  // …its palms on the canvas only when the scene's words name a hand (drawn and looked at: scarier, still real)
  assert.ok(revealPicture({ moment: "Her hands press flat against the tent wall from outside.", sides, outdoors: true, seen: LOOK, cloth: true, tent: true }).includes(`; ${CLOTH_PALMS}.`));
  // a thing nobody had seen: its wrongness, in its shadow
  const fresh = revealPicture({ moment: "Something presses against the canvas behind Mireille.", sides, outdoors: true, cloth: true, tent: true });
  assert.ok(fresh.includes(`What is wrong with it: ${REVEAL_PARTS.fabric.wrong}.`) && fresh.includes("On the tent's wall between and behind them"));
  // the zipper's gap: open a hand's width, no more
  const gap = revealPicture({ moment: "The zipper of the shut door slides up a hand's width from outside; in the gap, a pale face.", sides, outdoors: true, cloth: true, tent: true });
  assert.ok(gap.includes(`At the shut tent door the two are near — well inside the picture — ${REVEAL_PARTS.zipper.seen}.`) && gap.includes(CLOTH_OUTSIDE_GAP) && !gap.includes(CLOTH_OUTSIDE));
  // already far off in the picture it is drawn into: one of it, now at the cloth
  assert.ok(revealPicture({ moment: P1_LAST, sides, outdoors: true, cloth: true, tent: true, away: true }).includes(REVEAL_MOVED_CLOTH));
  assert.ok(revealPicture({ moment: "In the dark behind them she stands.", sides, outdoors: true, away: true }).includes(REVEAL_MOVED), "elsewhere, as before");
  // a creature the maker chose, at the cloth: its SHADOW too — no picture of it handed over to be painted on the canvas
  const grisel = revealPicture({ moment: P1_LAST, sides, outdoors: true, ref: "creature", name: "Grisel", creature: true, cloth: true, tent: true });
  assert.ok(grisel.includes(REVEAL_PARTS.fabric.seen) && !grisel.includes("SECOND picture"));
  // and NOTHING GLOWS in a reveal now (Part 1's face glowed in the doorway like a mask) — at the cloth always; elsewhere
  // it gives way before the face mood when a long moment runs the picture past what the editors read
  assert.ok(revealPicture({ moment: "In the dark corner something tall stands perfectly still.", sides }).includes(NOTHING_GLOWS));
});

test("the reveal's clip at the cloth: what is in its picture, and the one small thing it does — the cloth moves, nothing comes in", () => {
  assert.equal(revealClip(EP2_LAST, { outdoors: true, seen: true, cloth: true }), `${REVEAL_PARTS.roof.clip} ${REVEAL_PARTS.roof.moves}`);
  assert.equal(revealClip(P1_LAST, { outdoors: true, seen: true, cloth: true }), `${REVEAL_PARTS.fabric.clip} ${REVEAL_PARTS.fabric.moves}`);
  const live = clipRules({ cartoon: false, sing: false, horror: true });
  for (const r of [silentRules(live, { staging: "depth", event: EP2_LAST, reveal: true, drawn: true, outdoors: true, seen: true, cloth: true }), stagedRules(live, { staging: "depth", event: EP2_LAST, reveal: true, drawn: true, outdoors: true, seen: true, cloth: true })]) {
    for (const note of [r.look, r.lookTight, r.lookShort]) assert.ok(note.includes(REVEAL_PARTS.roof.clip) && note.includes(REVEAL_STAY) && !note.includes("In the dark behind them stands"), note);
  }
});

test("a sighting while the tent is shut is its SHADOW on the cloth — never seen through the shut door", () => {
  const p = sightingPicture({ moment: "A woman stands at the edge of the lake, watching the tent.", sides, seen: LOOK, outdoors: true, shadow: true, ref: "figure", state: "The tent door is zipped completely shut." });
  assert.ok(p.includes(`Show it like this, and no nearer: ${SIGHT_SHADOW}.`) && !p.includes("FAR OFF beyond the two of them"));
  assert.ok(!p.includes("SECOND picture"), "a shadow has no face: no picture of it rides along");
  assert.ok(p.includes("Whose shadow it is, as this story has it — only its OUTLINE shows, never its face:") && p.includes("The place as it now is, and it stays exactly so: The tent door is zipped completely shut."));
  // (drawn on Episode 2's frames and looked at: told her look, the editor lit a toothy grin INSIDE the shadow)
  assert.ok(SIGHT_SHADOW.includes("flat and featureless: no face, no eyes, no teeth, nothing lit inside it"));
  assert.ok(p.length <= 2400);
  // (…BEHIND them, each where they are, heads turned to it in profile: told "turned toward it, faces in view", the editor
  //  turned both faces to the lens — the S12 review LOOKED, 2026-11-25; a shadow moved to one side, drawn and looked at,
  //  fixed the eyes and moved both people to one side of the picture, which loses who is who)
  assert.ok(SIGHT_SHADOW.startsWith("ONLY ITS SHADOW: thrown from OUTSIDE onto the thin cloth wall behind them by the light out there — a tall dark shape"));
  assert.ok(p.includes(SIGHT_TURN_SHADOW) && SIGHT_TURN_SHADOW === "Both of them stay exactly where they are, each on their own side of the picture; only their heads have turned toward the shadow, so we see their faces in profile, eyes on it — neither looks at the camera.");
  assert.ok(!p.includes("three-quarters, so their faces stay in view"), "never the far-off sighting's turn, which reads as 'to the lens' when the shadow is behind them");
  assert.equal(sightingClip("A woman stands at the edge of the lake.", "the woman", true), `On the cloth wall behind them, thrown from outside, is the shadow of the woman. ${SIGHT_SHADOW_MOVES}`);
  assert.ok(!sightingClip("A woman stands at the edge of the lake.", "the woman", true).includes("edge of the lake"), "the scene's words would put her out by the water, through a shut door");
  const live = clipRules({ cartoon: false, sing: false, horror: true });
  assert.ok(stagedRules(live, { staging: "depth", event: "A woman stands at the edge of the lake.", sighted: true, sight: "the woman", shadow: true }).lookShort.includes(SIGHT_SHADOW_MOVES));
  assert.ok(silentRules(live, { staging: "depth", event: "A woman stands at the edge of the lake.", sighted: true, sight: "the woman", shadow: true }).look.includes(SIGHT_SHADOW_MOVES));
  // the open tent's sighting is as it was
  assert.ok(sightingPicture({ moment: "A woman stands at the edge of the lake.", sides, outdoors: true }).includes("FAR OFF beyond the two of them"));
  assert.ok(sightingPicture({ moment: "A woman stands at the edge of the lake.", sides, outdoors: true }).includes("three-quarters, so their faces stay in view — neither looks at the camera.") && !sightingPicture({ moment: "A woman stands at the edge of the lake.", sides, outdoors: true }).includes(SIGHT_TURN_SHADOW));
});

test("the picture of a change: ONE thing done to the place, who did it with a hand still on it, what was done before kept", () => {
  const c1 = placeChangeIn("Moments later, Mireille claws the zipper pull down hard, sealing the gap as Costin presses both palms flat against the tent wall.", "", { where: TENT });
  const p1 = changePicture({ change: c1, sides, outdoors: true });
  assert.ok(p1.startsWith(`${CHANGE_KEEP} Mireille is the one on the left; Costin is the one on the right. Change ONE thing — what this moment of the story has DONE to the place: The tent door is zipped completely shut — the two flaps joined edge to edge, the zipper closed to the floor; nothing of the outside shows through it.`));
  assert.ok(p1.includes(" What showed through it before is gone: the closed cloth is all there is to see there.") && p1.includes(" Mireille, the one on the left, still has one hand on its zipper pull, low on the shut door."));
  assert.ok(p1.includes("nothing is added, nobody else appears, nobody moves.") && p1.includes(NOTHING_GLOWS) && p1.includes("No text anywhere."));
  assert.ok(!CHANGE_KEEP.includes("every window, door") && !CHANGE_KEEP.includes("horror"), "the door is what changes; a door is shut in a drama too");
  const c2 = placeChangeIn("Costin drags their heavy duffel bag across the tent floor and wedges it hard against the sealed zipper seam.", "", { where: TENT });
  const kept = stateNow(placeStateAt([{ visual: "Mireille yanks the tent zipper shut.", where: TENT }], 1));
  const p2 = changePicture({ change: c2, sides, kept, outdoors: true });
  assert.ok(p2.includes("DONE to the place: The heavy duffel bag is wedged against the bottom of the shut tent door. Costin, the one on the right, still has one hand on the heavy duffel bag."));
  assert.ok(p2.includes(`Already so, and kept exactly so: ${kept}`) && !p2.includes("What showed through it before is gone"));
  assert.ok(p2.length < 2400);
  assert.equal(changePicture({ change: null }), "");
});

test("the writer: what is done to a place stays done — said after, kept in so many words, nothing through what is shut", () => {
  assert.ok(DONE_STAYS_DONE.startsWith("WHAT IS DONE TO A PLACE STAYS DONE — a shot that shuts, zips, locks or blocks something says in its VISUAL what it looks like AFTER, in so many words"));
  assert.ok(DONE_STAYS_DONE.includes("every later VISUAL in that place keeps it so in so many words (\"inside the zipped-shut tent\") until a shot shows it being opened."));
  assert.ok(DONE_STAYS_DONE.endsWith("Nothing comes in, and nothing is seen, through what is shut: whatever is outside a shut tent presses the cloth in, throws its shadow on it, or opens the zipper — and that opening is a shot of its own."));
  // the writer's own words for it are read back as the change they say (place-state.ts)
  assert.equal(placeChangeIn("Mireille drags the zipper round until the tent door is zipped completely shut, no gap.", "", { where: TENT })?.now, "shut");
  assert.equal(placeChangeIn("Moments later, inside the zipped-shut tent, Costin grips the lantern.", "", { where: TENT }), null);
  // …and the last shot's forms have the shut tent's: its SHADOW on the moonlit canvas — never its face in the cloth
  // (the owner, of the face moulded in the canvas: "looks like wizard of oz trash / not realistic", 2026-11-25)
  assert.ok(!/FACE pressing the thin canvas|stretched over its features/.test(SEEN_AT_THE_END), "the writer is never asked for the face in the cloth");
  assert.ok(SEEN_AT_THE_END.includes("at a TENT (always when its door was shut), it is OUTSIDE and only its SHADOW is seen — the lantern dims and its tall silhouette falls on the moonlit canvas, its palms pressed flat against the cloth from outside, or its shadow lying on the sagging roof — never its face in the cloth, never inside with them, never in an opening that is shut;"));
});
