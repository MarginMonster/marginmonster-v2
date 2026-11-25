/* THE PLACE REMEMBERS WHAT WAS DONE TO IT (2026-11-25, stream S12) — app/lib/place-state.ts, on the words of the two
 * live films the owner watched ("Even in the new tent scenes … they never actually zipped the tent doors up … then in a
 * frame out of nowhere the tent doors are fully open again"). Names in the made-up cases are made up. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyChange, changeEndLine, changesState, clipEndsOnChange, clothPlace, placeChangeIn, placeStateAt, putLine, sameOpening, shutCloth, stateLine, stateNow } from "../app/lib/place-state.ts";
import { clampKlingPrompt, clipRules, fitClipPrompt } from "../app/lib/clip-prompt.ts";

const TENT_WHERE = "inside a small tent on a moonlit lakeshore";
/** Part 1, "She Walks From Still Water" — its shot 4 and its last shot, as the writer wrote them. */
const P1_4 = { visual: "Mireille lunges for the opening and yanks the tent zipper shut with one hard pull.", caption: "MIREILLE: Zip it, zip it now…", where: TENT_WHERE };
const P1_5 = { visual: "Against the thin tent wall, a tall shape leans close until only the woman's face presses the fabric, waxen skin and that impossibly wide smile outlined in moonlight.", caption: "", where: TENT_WHERE };
/** Episode 2, "The Zipper Gives" — all five. */
const EP2 = [
  { visual: "Moments later, Mireille claws the zipper pull down hard, sealing the gap as Costin presses both palms flat against the tent wall.", caption: "MIREILLE: It's shut, it's shut, help me hold it.", where: TENT_WHERE },
  { visual: "Costin drags their heavy duffel bag across the tent floor and wedges it hard against the sealed zipper seam.", caption: "COSTIN: That bag weighs forty pounds. Nothing's getting through.", where: TENT_WHERE },
  { visual: "A single wet drip lands slow and heavy on the tent roof, then another…", caption: "MIREILLE: Costin. That's not rain.", where: TENT_WHERE },
  { visual: "Costin grips Mireille's wrist and pulls her lower, both crouching as the tent's roof sags inward under something's weight.", caption: "COSTIN: Down. Get down and don't breathe.", where: TENT_WHERE },
  { visual: "Through the sagging roof fabric, pressed flat from above, the woman's wide crowded smile shows pale through soaked white cloth, unmoving, waiting.", caption: "", where: TENT_WHERE },
];
const SHUT_TENT = "The tent door is zipped completely shut — the two flaps joined edge to edge, the zipper closed to the floor; nothing of the outside shows through it.";

test("Part 1's shot 4 SHUTS the tent door — Mireille does it; its last shot changes nothing", () => {
  const c = placeChangeIn(P1_4.visual, P1_4.caption, { where: P1_4.where });
  assert.deepEqual(c, { what: "the tent door", now: "shut", end: SHUT_TENT, by: "Mireille" });
  assert.equal(placeChangeIn(P1_5.visual, "", { where: P1_5.where }), null, "a face pressing the fabric does nothing to the door");
  // the state when its last shot begins: shut
  const st = placeStateAt([{ visual: "Mireille and Teo sit up in the dark tent.", where: TENT_WHERE }, { visual: "x" }, { visual: "y" }, P1_4, P1_5], 4);
  assert.deepEqual(st?.openings, [{ what: "the tent door", now: "shut", end: SHUT_TENT }]);
  assert.equal(placeStateAt([P1_4, P1_5], 0), null, "before it, nothing was done");
});

test("Episode 2: shot 1 shuts it, shot 2 puts the bag against it, shots 3-5 change nothing — shut, with the bag, when the reveal begins", () => {
  const [c1, c2, c3, c4, c5] = EP2.map((s) => placeChangeIn(s.visual, s.caption, { where: s.where }));
  assert.equal(c1?.what, "the tent door");
  assert.equal(c1?.now, "shut");
  assert.equal(c1?.by, "Mireille", "Costin's palms on the tent wall are not the deed");
  assert.equal(c1?.end, SHUT_TENT);
  assert.equal(c1?.also, undefined, "palms pressed on a wall are not a thing put against the door");
  // the bag, "wedged … against the sealed zipper seam" — "it" is the bag he dragged
  assert.equal(c2?.now, null);
  assert.equal(c2?.by, "Costin");
  assert.equal(c2?.also, "The heavy duffel bag is wedged against the bottom of the shut tent door.");
  assert.deepEqual(c2?.put, { thing: "The heavy duffel bag", how: "wedged", prep: "against", what: "the tent door", plural: false, shut: true });
  assert.equal(c3, null);
  assert.equal(c4, null, "pulling HER lower is not a door");
  assert.equal(c5, null);
  const at = (i: number) => placeStateAt(EP2, i);
  assert.equal(at(0), null);
  assert.deepEqual(at(1)?.openings.map((o) => o.now), ["shut"]);
  assert.equal(at(1)?.also.length, 0);
  assert.equal(at(2)?.also[0].thing, "The heavy duffel bag");
  const five = at(4);
  assert.deepEqual(five?.openings, [{ what: "the tent door", now: "shut", end: SHUT_TENT }]);
  assert.equal(stateNow(five), `${SHUT_TENT} The heavy duffel bag is wedged against the bottom of the shut tent door.`);
  assert.equal(stateLine(five), "The tent door stays zipped shut the whole shot — nothing opens it. The heavy duffel bag stays wedged against the tent door.");
  assert.ok(shutCloth(five), "a shut tent: what is outside presses the cloth or throws its shadow on it");
});

test("a sentence that only MENTIONS a state, tries, or touches is no change", () => {
  for (const v of [
    "Mireille stares at the zipped door, barely breathing.",
    "The tent door is zipped shut; Teo listens.",
    "The old door creaks in the wind as Dana listens.",
    "Dana looks through the window at the dark yard.",
    "Dana unzips her backpack and searches it.",
    "Ravi zips up his jacket and pulls on his boots.",
    "Dana tries to shut the door but it will not move.",
    "Dana reaches for the zipper as the shape outside leans closer.",
    "Dana knocks on the front door twice.",
    "Dana slams her fist on the door.",
    "Dana braces herself against the door, breathing hard.",
    "Dana closes the gap between them and grabs his arm.",
    "Ravi pulls the door to him and listens.",
    "Ravi secures the tent against the wind.",
    "Dana opens her eyes and stares at the ceiling.",
    "Ravi shuts the laptop and stands.",
    "",
  ]) assert.equal(placeChangeIn(v, "", { where: "a quiet house" }), null, v);
  assert.equal(placeChangeIn(null), null);
});

test("what is shut, what is opened, by whom, named as the words name it", () => {
  const c = (v: string, where = "a quiet house at night") => placeChangeIn(v, "", { where });
  assert.deepEqual(c("Dana slams the front door and turns to Ravi."), { what: "the front door", now: "shut", end: "The front door is shut — tight in its frame, no gap at its edge.", by: "Dana" });
  assert.equal(c("Ravi bolts the heavy wooden back door.")?.end, "The back door is shut and bolted — tight in its frame, no gap at its edge.");
  assert.equal(c("Ravi draws the curtains shut.")?.end, "The curtains are drawn shut — closed edge to edge; nothing of the window shows between them.");
  assert.equal(c("Ravi draws the curtains as Dana watches the road.")?.now, "shut");
  assert.equal(c("Ravi pulls the curtain aside to look out.")?.now, "open");
  assert.equal(c("Ravi draws back the curtains.")?.now, "open");
  assert.deepEqual(c("Dana forces the kitchen window up."), { what: "the kitchen window", now: "open", end: "The kitchen window is pushed open — a clear gap in its frame.", by: "Dana" });
  const creak = c("The bedroom door creaks slowly open.");
  assert.deepEqual(creak, { what: "the bedroom door", now: "open", end: "The bedroom door stands open." }, "by nobody we see");
  assert.equal(c("The zipper creeps up an inch from outside.", TENT_WHERE)?.what, "the tent door");
  assert.equal(c("The zipper creeps up an inch from outside.", TENT_WHERE)?.now, "open");
  assert.equal(c("Slowly, the zipper begins to slide up from outside.", TENT_WHERE)?.now, "open");
  assert.equal(c("The zipper gives with a soft rip.", TENT_WHERE)?.now, "open");
  assert.equal(c("Mireille unzips the tent door and peers out.", TENT_WHERE)?.now, "open");
  assert.equal(c("Ravi zips up the tent with shaking hands.", TENT_WHERE)?.now, "shut");
  assert.equal(c("The front door is flung open.")?.now, "open");
  assert.equal(c("The door slams behind them.")?.now, "shut");
  assert.deepEqual(c("Dana grabs the door and slams it shut."), { what: "the door", now: "shut", end: "The door is shut — tight in its frame, no gap at its edge.", by: "Dana" });
  // the writer's own way of saying it is done (DONE_STAYS_DONE asks for it) — and of saying it STAYS so, which is no change
  assert.equal(c("Mireille drags the zipper round until the tent door is zipped completely shut, no gap.", TENT_WHERE)?.now, "shut");
  assert.equal(c("Moments later, inside the zipped-shut tent, Mireille presses her ear to the canvas.", TENT_WHERE), null);
  assert.equal(c("Inside the zipped-shut tent, the zipper of the door slides up a hand's width from outside.", TENT_WHERE)?.now, "open");
  assert.equal(c("Teo wedges the duffel bag against the bottom of the zipped-shut door.", TENT_WHERE)?.also, "The duffel bag is wedged against the bottom of the shut tent door.");
  assert.equal(c("Teo shoves his shoulder against the door as it shudders."), null, "a body is not a thing left against it");
  // two things: the later one is what it is at the end
  assert.equal(c("Mireille zips it shut, but the zipper creeps up again from outside.", TENT_WHERE)?.now, "open");
  // what is put against it, and the article it is given
  assert.equal(c("Teo shoves the cooler in front of the door.")?.also, "The cooler is shoved in front of the door.");
  assert.equal(c("Teo piles their boxes against the shut door.")?.also, "The boxes are piled against the bottom of the shut door.");
  const both = c("Dana slams the door and Ravi jams a chair up against it.");
  assert.equal(both?.now, "shut");
  assert.equal(both?.by, "Dana");
});

test("the state: shut then opened again is open; what was against it goes; another place is another place", () => {
  const shut = { visual: "Teo yanks the tent zipper shut.", where: TENT_WHERE };
  const bag = { visual: "Teo shoves the cooler against the zipped door.", where: TENT_WHERE };
  const open = { visual: "The zipper creeps up a hand's width from outside.", where: TENT_WHERE };
  const st = placeStateAt([shut, bag, open], 3);
  assert.deepEqual(st?.openings.map((o) => o.now), ["open"]);
  assert.equal(st?.also.length, 0, "the cooler was against a door that is now open");
  assert.equal(stateLine(st), "", "nothing is shut: nothing to keep shut");
  assert.equal(stateNow(st), "The tent door hangs open — its zipper undone, its flaps parted on the outside.");
  // the shot that opens it is not told it stays shut
  const before = placeStateAt([shut, bag, open], 2);
  const own = placeChangeIn(open.visual, "", { where: open.where });
  assert.equal(stateLine(before, own), "", "this shot IS the opening");
  assert.ok(stateLine(before).startsWith("The tent door stays zipped shut the whole shot — nothing opens it."));
  // only the same place, since the film came to it
  assert.equal(placeStateAt([shut, { visual: "x", where: "the car" }], 2, (j) => j >= 1), null);
  // a change that changes nothing — shut again, the same bag again
  const s1 = placeStateAt([shut], 1);
  assert.equal(changesState(s1, placeChangeIn(shut.visual, "", { where: TENT_WHERE })), false);
  assert.equal(changesState(s1, placeChangeIn(bag.visual, "", { where: TENT_WHERE })), true);
  assert.equal(changesState(null, placeChangeIn(shut.visual, "", { where: TENT_WHERE })), true);
  assert.equal(applyChange(null, null), null);
  assert.ok(sameOpening("the door", "the front door") && !sameOpening("the front door", "the back door") && !sameOpening("the door", "the window"));
  assert.equal(putLine({ thing: "The chair", how: "jammed", prep: "under", what: "the door", plural: false, shut: true }), "The chair is jammed under the shut door.");
});

test("the shot that makes the change is told where it ends; every later clip is told it stays — and both survive the 2,500-character cap", () => {
  const c1 = placeChangeIn(EP2[0].visual, EP2[0].caption, { where: TENT_WHERE });
  assert.equal(changeEndLine(c1), "By the end of the shot the tent door is zipped completely shut — the two flaps joined edge to edge, the zipper closed to the floor; nothing of the outside shows through it.");
  assert.equal(changeEndLine(placeChangeIn(EP2[1].visual, "", { where: TENT_WHERE })), "By the end of the shot the heavy duffel bag is wedged against the bottom of the shut tent door.");
  assert.equal(changeEndLine(null), "");
  assert.ok(clipEndsOnChange(`x y. ${changeEndLine(c1)}`) && !clipEndsOnChange("Nobody moves."));
  // the line rides in the camera-and-sound rules, which the prompt builder keeps whole however long the line is
  // (clip-prompt.ts → fitClipPrompt), so the provider's clamp (which keeps the head) never has anything to cut
  const rules = clipRules({ cartoon: false, sing: false, horror: true });
  const line = stateLine(placeStateAt(EP2, 4));
  const steady = `${rules.steady} ${line}`;
  for (const voice of ["Short line.", "A".repeat(1800), "word ".repeat(700)]) {
    const fitted = fitClipPrompt({ voice, voiceDesc: " Her voice is low.", ...rules, steady });
    assert.ok(fitted.prompt.length <= 2500, `${fitted.prompt.length}`);
    assert.ok(fitted.prompt.includes(line), "the state line is in the prompt");
    assert.equal(clampKlingPrompt(fitted.prompt), fitted.prompt, "and the clamp leaves it whole");
  }
});

test("a tent is cloth; so is a moment that presses on cloth", () => {
  assert.ok(clothPlace(TENT_WHERE));
  assert.ok(clothPlace("a lakeshore at night", "Against the thin tent wall, a tall shape leans close until only the woman's face presses the fabric."));
  assert.ok(clothPlace("an old farmhouse bedroom", "A face pushes against the curtain from the other side."));
  assert.ok(!clothPlace("an old farmhouse bedroom", "Dana draws the curtain."), "a curtain drawn is a curtain, not something pressing it");
  assert.ok(!clothPlace("a kitchen at night", "A face at the window glass."));
  assert.ok(!shutCloth(placeStateAt([{ visual: "Dana slams the front door." }], 1)), "a shut house door is no cloth");
});
