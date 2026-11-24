/* THE SHOT PLAN, AND A CREATURE THAT STAYS ONE.
 *
 * The owner, 2026-11-24, looking at a Horror Story in his Archive: "there is several problems with the seed
 * images (characters breaking) also would like to note that the two characters standing side by side isnt
 * always how a scene is or how things are filmed, sometimes theree is distance and they walk forward yanno?"
 *
 * What that episode's pictures were, looked at one by one: its werewolf an ordinary black wolf (three goes
 * running — the look refused each, and the best of them was kept), then a man with a wolf's head in a clean
 * shirt; two of its six scenes the same two figures side by side; and in its last scene a CORRECT still
 * that the motion engine re-posed — the werewolf leapt, dropped to all fours and grew figures behind him.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STORY_SHOTS, cameraLine, isStoryShot, planShots, shotIsFar, shotListBrief, shotMotion, shotOf, type StoryShot } from "../app/lib/story-shots.ts";
import { creatureNote, keptFaults, storyFix } from "../app/lib/story-picture.ts";
import { presentIn } from "../app/lib/narrated-core.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
/** A fixed source of "chance" for a test: a simple generator, the same run every time. */
const dice = (seed: number) => { let s = (Math.imul(seed, 2654435761) ^ 0x9e3779b9) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

test("a story is dealt a shot plan: no two neighbours alike, distance in it, an opening that shows where we are", () => {
  const DISTANT: StoryShot[] = ["walk", "depth", "over", "wide"];
  for (let seed = 1; seed <= 400; seed++) {
    for (const n of [4, 6, 8, 10]) {
      const plan = planShots(n, dice(seed * 7 + n));
      assert.equal(plan.length, n);
      assert.ok(plan.every(isStoryShot), plan.join(","));
      for (let i = 1; i < n; i++) assert.notEqual(plan[i], plan[i - 1], `${seed}/${n}: ${plan.join(",")}`);
      assert.ok(["wide", "walk", "depth", "low"].includes(plan[0]), `opens on ${plan[0]}`);
      assert.ok(["close", "depth", "over", "low", "detail"].includes(plan[n - 1]), `ends on ${plan[n - 1]}`);
      assert.ok(plan.filter((k) => DISTANT.includes(k)).length >= 2, `distance at least twice: ${plan.join(",")}`);
      // the old default — two people in a medium shot — once; a bare detail once; a face twice at most
      assert.ok(plan.filter((k) => k === "two").length <= 1 && plan.filter((k) => k === "detail").length <= 1 && plan.filter((k) => k === "close").length <= 2, plan.join(","));
    }
  }
  // dealt, not fixed: across many stories every way of seeing turns up
  const seen = new Set<string>();
  for (let seed = 1; seed <= 60; seed++) planShots(6, dice(seed)).forEach((k) => seen.add(k));
  assert.equal(seen.size, Object.keys(STORY_SHOTS).length);
  assert.deepEqual(planShots(0), []);
  assert.equal(planShots(1, dice(3)).length, 1);
});

test("the plan is used three times: the writer's list, the picture's camera line, the motion", () => {
  const brief = shotListBrief(["wide", "walk", "depth", "close"]);
  assert.ok(brief.startsWith("THE SHOT LIST — a film is not shot from one spot, and people in it do not line up side by side facing the camera."));
  assert.ok(brief.includes("saying where each one is — near us or far off, facing us or seen from behind, walking or still"));
  assert.ok(brief.includes("\n  1. WIDE — the place is the picture") && brief.includes("\n  2. WALKING — somebody is caught mid-stride, walking TOWARD the camera") && brief.includes("\n  3. NEAR AND FAR — ") && brief.includes("\n  4. CLOSE — one face fills the frame"));
  assert.equal(shotListBrief([]), "");
  // his own words, each a way of seeing: distance, and walking forward
  assert.ok(STORY_SHOTS.depth.write.includes("with clear distance between them") && STORY_SHOTS.walk.write.includes("walking TOWARD the camera"));
  assert.ok(STORY_SHOTS.two.write.includes("turned toward EACH OTHER (never lined up facing us)"));
  for (const k of Object.keys(STORY_SHOTS) as StoryShot[]) {
    assert.ok(cameraLine(k).startsWith("CAMERA: "), k);
    assert.ok(shotMotion(k).length > 20, k);
  }
  assert.equal(cameraLine(null), "");
  assert.equal(shotMotion(undefined), "");
  assert.ok(shotIsFar("wide") && shotIsFar("depth") && !shotIsFar("close") && !shotIsFar(null));
  // a scene with no plan (every story written before, a scene added by hand) is drawn as scenes always were
  assert.equal(shotOf({ cam: "over" }), "over");
  assert.equal(shotOf({ cam: "sideways" }), null);
  assert.equal(shotOf({}), null);
  assert.equal(shotOf(null), null);

  const engine = read("app", "lib", "film-engine.server.ts");
  assert.ok(engine.includes("const camPlan = narrated ? planShots(scenes) : [];"), "a told story only");
  assert.ok(engine.includes("    shotListBrief(camPlan) +\n    freshLine +\n"));
  assert.ok(engine.includes("if (camPlan.length) list = list.map((s, i) => (camPlan[i] ? { ...s, cam: camPlan[i] } : s));"), "each scene keeps how it is seen");
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("const cam = shotOf(scene);"));
  assert.ok(nar.includes("${cam ? ` ${cameraLine(cam)}` : \"\"}"));
  assert.ok(nar.includes("cams: treatment.scenes.map((s) => s.cam),"), "the motion follows it");
  assert.ok(read("app", "lib", "story-motion.server.ts").includes("prompt: motionPrompt(o.visuals[i] || \"\", o.cams?.[i]), durationSec: ask });"));
});

test("a creature stays that creature: said in the picture's words, said again when it came out wrong", () => {
  const note = creatureNote("Howl", "monster");
  assert.ok(note.startsWith("Howl is a creature — not a person and not an ordinary animal:"));
  assert.ok(note.includes("whatever Howl is doing here (standing, crouching, walking, seen from behind), Howl has exactly the BODY of the reference image"));
  assert.ok(note.includes("the same clothing in the same state") && note.endsWith("Never drawn as an everyday animal; never as a human being wearing that head, a mask or a costume."));
  assert.ok(creatureNote("Pip", "cartoon").startsWith("Pip is a cartoon character — "));
  assert.equal(creatureNote("Rosa", "person"), "");
  assert.equal(creatureNote("Rosa", undefined), "");
  assert.equal(creatureNote("", "monster"), "");
  // the fix: a person is told their face and hair; a creature is ALSO told what its body must be
  const check = { seen: [false, false], panels: false };
  const fix = storyFix(check, ["Howl", "Marla"], ["monster", "person"]);
  assert.ok(fix.includes("Howl and Marla were missing or drawn as someone else in the last try"));
  assert.ok(fix.includes("Howl must have the reference image's own BODY — the same build, standing the same way, covered in the same fur or skin, in the same clothing in the same state: not an ordinary animal, and not a human being with that head."));
  assert.ok(!storyFix(check, ["Rosa", "Marla"], ["person", "person"]).includes("BODY"));
  assert.equal(storyFix(check, ["Howl", "Marla"]), storyFix(check, ["Howl", "Marla"], []), "with no kinds given, the fix is what it always was");
  assert.equal(storyFix({ seen: [true, true], panels: false }, ["Howl", "Marla"], ["monster", "person"]), "");

  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("here.forEach((c) => { const note = creatureNote(c.name, c.kind); if (note) notes.push(note); });"));
  // THE LAST GO of a scene whose cast came out wrong twice is drawn on the stronger model
  assert.ok(nar.includes("const strong = a === 2 && !!best && best.check.seen.includes(false) && process.env.STORY_STRONG_RETRY !== \"off\";"));
  assert.ok(nar.includes("const model = strong ? STORY_CROWD_MODEL : sceneModel(people);"));
});

test("a picture kept with somebody still wrong is written down on the piece", () => {
  assert.deepEqual(keptFaults([null, { seen: [true, true], panels: false, who: ["Howl", "Marla"] }, { seen: [false, true], panels: false, who: ["Howl", "Marla"] }, { seen: [true], panels: true, who: ["Howl"] }, undefined]), [
    { scene: 3, missing: ["Howl"] },
    { scene: 4, missing: [], panels: true },
  ]);
  assert.deepEqual(keptFaults([]), []);
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("pictureFaults = keptFaults(drawn.sceneChecks);"));
  assert.ok(nar.includes("...(pictureFaults.length ? { pictureFaults } : {}),"), "on the piece's own record");
  assert.ok(nar.includes("if (pictureFaults.length) await ckpt({ ckPictureFaults: JSON.stringify(pictureFaults) });"), "…and kept across a restart");
  assert.ok(read("app", "lib", "job-queue.server.ts").includes("ckPictureFaults: payload.ckPictureFaults as string | undefined,"));
});

test("named as somebody who is NOT there is not being there", () => {
  // (the last picture of that episode: the woman's portrait was sent, she was asked for, and the right
  //  picture — without her — was the one the look refused)
  const last = "Howl's glowing yellow eyes reflect in a dark puddle beside the campsite clearing, but the puddle shows a second pair of eyes behind him, and Marla is no longer standing there.";
  assert.equal(presentIn("Marla", last), false);
  assert.equal(presentIn("Howl", last), true, "his eyes are him");
  for (const gone of ["The bench is empty; Edda is gone.", "No sign of Edda at the round green door.", "Finn stands alone where Edda had stood.", "The square without Edda, the clock stopped.", "Edda has vanished from the tower stairs.", "Finn is searching for Edda among the stalls.", "Edda is nowhere to be seen on the quay.", "Edda is not there; only her lantern."]) {
    assert.equal(presentIn("Edda", gone), false, gone);
  }
  // …but somebody who IS there still is — however the sentence turns
  for (const here of ["Edda stands at the round green door.", "Howl, gone still as stone, listens at the wall.", "Howl gone still beside the fire pit.", "Marla stands where Howl had been, and Howl looms behind her.", "Edda waits for Finn, who walks toward her.", "Edda is not afraid."]) {
    const who = here.startsWith("Howl") || here.includes("Howl looms") ? "Howl" : "Edda";
    assert.equal(presentIn(who, here), true, here);
  }
  assert.equal(presentIn("Finn", "Edda waits for Finn at the door."), false, "waited for is not there");
  assert.equal(presentIn("Finn", "Edda waits for Finn, who walks toward her."), true, "…unless the words go straight on to what he is doing");
});
