/* A TAKE — one continuous shot that something happens in (app/lib/take.ts).
 *
 * The owner, 2026-11-24: "there would need to be some type of exchange at the bare minimum (voice saying \"babe
 * whats wrong\" then boom the scare shot)". On the first take: "it looks like the zap scares the scary person
 * and she runs into the room and turns around, can we enhance the creepy?". On the re-roll: "she lip synced
 * what the camera said towards the very beggining, creepy but im sure its a glitch... But honestly - better".
 *
 * What is held here is what a take's direction must always say — the exchange, slowness, and the list of what
 * never happens — because each of those was learned from a take he watched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TAKE_CAUGHT, TAKE_HIDDEN, TAKE_IDEAS, TAKE_PROMPT_MAX, TAKE_SECONDS, TAKE_WRONG, parseTake, takeIdea, takePrompt, takeStillPrompt, takeWriterBrief } from "../app/lib/take.ts";

test("ready-made scares: each has a first frame, three beats, something said, a sound", () => {
  assert.deepEqual(TAKE_IDEAS.map((i) => i.key), ["smile", "stairs", "bed"]);
  for (const i of TAKE_IDEAS) {
    assert.ok(i.name.length <= 22 && i.line.length <= 60, `${i.key}: fits a card`);
    assert.ok(i.still.length >= 120 && i.still.length <= 700, `${i.key}: a first frame`);
    assert.equal(i.beats.length, 3);
    // the first beat is stillness; the last one comes toward the lens and ends by filling the frame
    assert.ok(/still/i.test(i.beats[0]), `${i.key}: it begins perfectly still`);
    assert.ok(/toward the camera|toward the lens/i.test(i.beats[2]) && /frame/i.test(i.beats[2]), `${i.key}: it comes, and fills the frame`);
    assert.ok(/slow/i.test(i.beats[1] + i.beats[2]), `${i.key}: slowly`);
    assert.ok(i.says[0].endsWith("?") && i.says[1], `${i.key}: a worried question, then a plea`);
    assert.ok(i.sound);
    // nothing in a ready-made scare is what the recipe forbids
    assert.ok(!/\b(run|runs|running|scream|screams|lunge|lunges|blood|gore|horns?|wings?|tentacles?|glowing|flames?|skull)\b/i.test(`${i.still} ${i.beats.join(" ")}`), i.key);
  }
  assert.equal(takeIdea(" SMILE ")?.name, "She's smiling");
  assert.equal(takeIdea("nope"), undefined);
  assert.equal(TAKE_SECONDS, 10);
});

test("the first frame is drawn by the creature recipe: caught, wrong, hidden — and nothing written", () => {
  const p = takeStillPrompt(TAKE_IDEAS[0]);
  assert.ok(p.startsWith("Vertical 9:16 picture. A single frame of real footage, caught by accident"));
  for (const part of [TAKE_CAUGHT, TAKE_WRONG, TAKE_HIDDEN, TAKE_IDEAS[0].still]) assert.ok(p.includes(part));
  assert.ok(p.indexOf(TAKE_CAUGHT) < p.indexOf(TAKE_IDEAS[0].still) && p.indexOf(TAKE_IDEAS[0].still) < p.indexOf(TAKE_WRONG));
  assert.ok(p.endsWith("Nothing written anywhere in the picture. No watermark, no signature."));
  assert.ok(takeStillPrompt(TAKE_IDEAS[1], "16:9").startsWith("Wide 16:9 picture."));
  assert.ok(/never CGI, never a 3D render, never an illustration/.test(TAKE_CAUGHT) && /No blood, no gore/.test(TAKE_HIDDEN));
});

test("the direction: the exchange, one wrong movement, the approach — and what never happens", () => {
  for (const idea of TAKE_IDEAS) {
    for (const camera of ["phone", "camcorder", "bare"] as const) {
      const p = takePrompt(idea, camera);
      assert.ok(p.length <= TAKE_PROMPT_MAX, `${idea.key}/${camera}: ${p.length} characters — the engine takes 2,500`);
      // one continuous take; the camera never leaves it
      assert.ok(p.includes("One continuous take, no cuts, nothing written on screen.") && p.includes("it never swings away, never drops, never falls."));
      // the three beats, in order, at their times
      const at = ["FIRST THREE SECONDS:", "THEN, slowly:", "LAST FOUR SECONDS:"].map((m) => p.indexOf(m));
      assert.ok(at[0] > 0 && at[0] < at[1] && at[1] < at[2], `${idea.key}: three beats in order`);
      // THE EXCHANGE: said by the one filming, who is never seen — and the thing does not answer
      assert.ok(p.includes(`whispers, close to the microphone, worried: "${idea.says[0]}"`));
      assert.ok(p.includes("The one filming is never seen — the voice comes from BEHIND the camera"));
      // …NOR MOUTH IT (the re-roll: the engine gave the cameraman's line to the only face it could see)
      assert.ok(/does not answer, and does not move (her|his|its) lips: the voice is not (her|his|its) voice\./.test(p), `${idea.key}: the thing's lips do not move`);
      // WHAT NEVER HAPPENS (the first take: a "zap", then she ran into the room and turned around)
      for (const never of ["never runs", "never flinches", "never turns around", "never looks away", "never screams", "never speaks", "never mouths a word", "Nothing flashes", "the light does not change", "never glitches or tears"]) assert.ok(p.includes(never), `${idea.key}: ${never}`);
      assert.ok(p.includes("No music.") && p.includes(idea.sound));
    }
  }
  // what is being held is said the way the overlay will show it
  assert.ok(takePrompt(TAKE_IDEAS[0], "phone").startsWith("Shot on a phone at night, held in one hand, the phone's own small light on her."));
  assert.ok(takePrompt(TAKE_IDEAS[1], "camcorder").startsWith("Shot on a small home camcorder at night, held in one hand, its little lamp on the figure."));
  assert.ok(takePrompt(TAKE_IDEAS[2], "bare").startsWith("Handheld, at night, one small light on the face."));
  // "she" is "her" where the sentence needs it; a thing is "its"
  assert.ok(takePrompt(TAKE_IDEAS[0]).includes("does not move her lips") && takePrompt(TAKE_IDEAS[1]).includes("does not move its lips"));
  // a quote inside what is said cannot break the quoted line
  assert.ok(!takePrompt({ ...TAKE_IDEAS[0], says: ['He said "hi"?', "no"] }).includes('"hi"'));
});

test("a take of the member's own: the writer is told how a scare is built, and its answer is checked", () => {
  const brief = takeWriterBrief("a man in the corner of the nursery");
  assert.ok(brief.includes("THE IDEA: a man in the corner of the nursery"));
  for (const rule of ["ONE continuous ten-second shot", "(1) STILLNESS", "(2) ONE WRONG MOVEMENT", "(3) IT COMES", "NEVER runs, flinches, turns away or screams", "nearly human and slightly wrong", "No blood, no gore, no wounds", "Answer with JSON only"]) assert.ok(brief.includes(rule), rule);
  assert.ok(takeWriterBrief("").includes("THE IDEA: something that should not be in the house"));

  const good = { title: "The Nursery Corner", who: "The Man", still: "The camera looks across a dark nursery from the doorway: in the far corner, facing the wall, stands a tall man, perfectly still.", beats: ["the man stands facing the corner.", "his head turns all the way round.", "he walks backwards toward the camera, slowly."], says: ["Who are you?", "no, no"], sound: "floorboards" };
  const t = parseTake(JSON.stringify(good));
  assert.ok(t && t.title === "The Nursery Corner" && t.who === "the man" && t.beats.length === 3 && t.says[1] === "no, no");
  // wrapped in prose or a code fence: still read
  assert.ok(parseTake("Here you go:\n```json\n" + JSON.stringify(good) + "\n```"));
  // half a direction is no direction
  assert.equal(parseTake(JSON.stringify({ ...good, beats: good.beats.slice(0, 2) })), null);
  assert.equal(parseTake(JSON.stringify({ ...good, still: "a man" })), null);
  assert.equal(parseTake(JSON.stringify({ ...good, says: [] })), null);
  assert.equal(parseTake("not json"), null);
  assert.equal(parseTake(null), null);
  // a second line is optional; a title falls back
  const bare = parseTake({ ...good, title: "", says: ["Hello?"] });
  assert.ok(bare && bare.title === "Found footage" && bare.says[1] === "");
  // …and whatever the writer returns, the direction built from it still fits the engine
  assert.ok(takePrompt(t!, "phone").length <= TAKE_PROMPT_MAX);
});
