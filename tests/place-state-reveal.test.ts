/* THE PLACE AS IT NOW IS, IN THE PICTURES (2026-11-25, stream S12) — acted-staging.ts. The lake films' reveals stood the
 * woman in the OPEN DOORWAY between the two, in a tent whose door the story had zipped shut ("then in a frame out of
 * nowhere the tent doors are fully open again and the monster lady is standing in front of door" — the owner). At a
 * tent, and wherever the door was shut, what is outside stays OUTSIDE: its face presses the cloth in; a sighting is its
 * shadow on the cloth; the change itself is drawn and kept. Names in the made-up cases are made up. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHANGE_KEEP, CLOTH_OUTSIDE, CLOTH_OUTSIDE_GAP, DONE_STAYS_DONE, NOTHING_GLOWS, REVEAL_MOVED, REVEAL_MOVED_CLOTH, REVEAL_PARTS, REVEAL_STAY, SEEN_AT_THE_END, SIGHT_SHADOW, SIGHT_SHADOW_MOVES,
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
  assert.ok(REVEAL_PARTS.zipper.moves.includes("the gap grows no wider; the face stays OUTSIDE"));
});

test("the reveal's picture at a tent: the place as it now is, the face pressed in from outside — never standing in the doorway, never glowing", () => {
  const state = stateNow(placeStateAt([
    { visual: "Moments later, Mireille claws the zipper pull down hard, sealing the gap as Costin presses both palms flat against the tent wall.", where: TENT },
    { visual: "Costin drags their heavy duffel bag across the tent floor and wedges it hard against the sealed zipper seam.", where: TENT },
  ], 2));
  // EPISODE 2's last shot, its thing's portrait as the second picture
  const roof = revealPicture({ moment: EP2_LAST, sides, outdoors: true, ref: "figure", cloth: true, tent: true, state, mood: "Every living person in it looks tense, wary or afraid — nobody smiles, grins or laughs." });
  assert.ok(roof.includes(`Show it like this, and no more of it: High in the picture, in the tent's sloping roof above Costin, the one on the right, ${REVEAL_PARTS.roof.seen}.`));
  // (drawn from Episode 2's own frames and LOOKED at: "pale through the cloth" drew a face seen through gauze, and a face
  //  as tall as the two of them was printed on the door — the cloth hides it, it is life-size, a bulge in the cloth)
  for (const k of ["fabric", "roof"] as const) {
    assert.ok(REVEAL_PARTS[k].seen.includes("life-size, no bigger than their own heads") && REVEAL_PARTS[k].seen.includes("never a picture printed on the cloth, never skin or colour showing through it"), k);
    assert.ok(!/pale through/.test(REVEAL_PARTS[k].seen + REVEAL_PARTS[k].clip), k);
  }
  assert.ok(roof.includes(thingRefNote("figure", { near: true, cloth: true })) && roof.includes("ONLY the FACE of the figure in the SECOND picture") && !roof.includes("now close behind them"), "its FACE, from the portrait — never the whole of it standing in the tent");
  assert.ok(roof.includes("The place as it now is, and it stays exactly so: The tent door is zipped completely shut"), "drawn into the shut tent, and it stays shut");
  assert.ok(roof.includes(CLOTH_OUTSIDE) && roof.includes(NOTHING_GLOWS));
  assert.ok(!roof.includes("In the dark close behind") && !roof.includes("This is out of doors"), "not the figure standing close behind them — the doorway");
  assert.ok(roof.length <= 2400, `${roof.length}: inside what both editors read`);
  // (with room, the place's whole state — the bag too)
  const roomy = revealPicture({ moment: "Her face presses down into the roof.", sides, outdoors: true, cloth: true, tent: true, state, ref: "figure" });
  assert.ok(roomy.includes(`The place as it now is, and it stays exactly so: ${state}`) && roomy.length <= 2400, `${roomy.length}`);
  // PART 1's last shot: "presses the fabric" — in the tent's wall, close behind the one on the right; told by words alone
  const wall = revealPicture({ moment: P1_LAST, sides, outdoors: true, seen: LOOK, cloth: true, tent: true });
  assert.ok(wall.includes(`In the tent's wall close behind Costin, the one on the right, at the height of a head, well inside the picture, ${REVEAL_PARTS.fabric.seen}.`));
  assert.ok(wall.includes("but only the SHAPE of its face shows, moulded in the stretched cloth from OUTSIDE: never the whole of it, never inside."));
  assert.ok(!wall.includes("What is wrong with it"), "its look is the film's own");
  // a thing nobody had seen: its wrongness, in the cloth
  const fresh = revealPicture({ moment: "Something presses against the canvas behind Mireille.", sides, outdoors: true, cloth: true, tent: true });
  assert.ok(fresh.includes(`What is wrong with it: ${REVEAL_PARTS.fabric.wrong}.`) && fresh.includes("In the tent's wall close behind Mireille, the one on the left"));
  // the zipper's gap: open a hand's width, no more
  const gap = revealPicture({ moment: "The zipper of the shut door slides up a hand's width from outside; in the gap, a pale face.", sides, outdoors: true, cloth: true, tent: true });
  assert.ok(gap.includes(`At the shut tent door the two are near — well inside the picture — ${REVEAL_PARTS.zipper.seen}.`) && gap.includes(CLOTH_OUTSIDE_GAP) && !gap.includes(CLOTH_OUTSIDE));
  // already far off in the picture it is drawn into: one of it, now at the cloth
  assert.ok(revealPicture({ moment: P1_LAST, sides, outdoors: true, cloth: true, tent: true, away: true }).includes(REVEAL_MOVED_CLOTH));
  assert.ok(revealPicture({ moment: "In the dark behind them she stands.", sides, outdoors: true, away: true }).includes(REVEAL_MOVED), "elsewhere, as before");
  // a creature the maker chose: its FACE in the cloth
  assert.ok(revealPicture({ moment: P1_LAST, sides, outdoors: true, ref: "creature", name: "Grisel", creature: true, cloth: true, tent: true }).includes("ONLY its face, that exact face, pressing into the cloth from OUTSIDE"));
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
  assert.ok(p.includes("Whose shadow it is, as this story has it (only its outline shows)") && p.includes("The place as it now is, and it stays exactly so: The tent door is zipped completely shut."));
  assert.ok(p.length <= 2400);
  assert.equal(sightingClip("A woman stands at the edge of the lake.", "the woman", true), `On the cloth wall behind them, thrown from outside, is the shadow of the woman. ${SIGHT_SHADOW_MOVES}`);
  assert.ok(!sightingClip("A woman stands at the edge of the lake.", "the woman", true).includes("edge of the lake"), "the scene's words would put her out by the water, through a shut door");
  const live = clipRules({ cartoon: false, sing: false, horror: true });
  assert.ok(stagedRules(live, { staging: "depth", event: "A woman stands at the edge of the lake.", sighted: true, sight: "the woman", shadow: true }).lookShort.includes(SIGHT_SHADOW_MOVES));
  assert.ok(silentRules(live, { staging: "depth", event: "A woman stands at the edge of the lake.", sighted: true, sight: "the woman", shadow: true }).look.includes(SIGHT_SHADOW_MOVES));
  // the open tent's sighting is as it was
  assert.ok(sightingPicture({ moment: "A woman stands at the edge of the lake.", sides, outdoors: true }).includes("FAR OFF beyond the two of them"));
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
  // …and the last shot's forms have the shut tent's two
  assert.ok(SEEN_AT_THE_END.includes("at a TENT (always when its door was shut), it is OUTSIDE — its FACE pressing the thin canvas in from outside, the wet fabric stretched over its features, or the zipper of the shut door sliding up a hand's width from outside and, in that gap, its face — never inside with them, never in an opening that is shut;"));
});
