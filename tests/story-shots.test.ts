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
  assert.ok(engine.includes("if (camPlan.length) list = list.map((s, i) => { const cam = shotInWords(s.visual) ?? camPlan[i]; return cam ? { ...s, cam } : s; });"), "each scene keeps how it is seen — as its own words say it, else as planned");
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("const cam = sceneShot(scene);"));
  assert.ok(nar.includes("${cam ? ` ${cameraLine(cam)}` : \"\"}"));
  assert.ok(nar.includes("cams: treatment.scenes.map((s) => sceneShot(s)),"), "the motion follows it");
  assert.ok(read("app", "lib", "story-motion.server.ts").includes("prompt: motionPrompt(o.visuals[i] || \"\", o.cams?.[i]), durationSec: ask });"));
});

/* THE WORDS SAY HOW IT IS SEEN (2026-11-24): the kids' horror story's plan had "wide" on its window scene and
 * "over" on its sofa scene; the writer wrote them the other way round — and the sofa picture, told "over the
 * shoulder" by its camera line and "Wide shot … both on the sofa" by its words, came back with a big dark figure
 * looming in front and one child on the sofa. */
test("a scene's own words name how it is seen — and win over the plan's tag", async () => {
  const sh = await import("../app/lib/story-shots.ts");
  const cases: Array<[string, string | null]> = [
    ["Over Walt’s shoulder, inside at the living room window, he and Pearl look out", "over"],
    ["Wide shot of the living room in the house: Pearl and Walt sit small together on the sofa", "wide"],
    ["At the house: Over the shoulder from behind Priya, inside at the window", "over"],
    ["At the front door: OVER THE SHOULDER: from behind Mira’s dark shoulder", "over"],
    ["A detail: the brass doorknob of the front door", "detail"],
    ["From below, looking up at the rectangular window", "low"],
    ["NEAR AND FAR: Nessa’s face is close at the lace curtain", "depth"],
    ["WIDE: the house sits alone in deep blue darkness", "wide"],
    ["CLOSE: Tomi’s face, eyes wide", "close"],
    ["TOGETHER: Nessa and Dovey sit frozen on the sofa", "two"],
    ["WALKING: Finn comes up the lane", "walk"],
    // words that do not OPEN by naming a shot leave the plan as it is
    ["Inside, near the front door, Pearl and Walt freeze mid-step in the hallway", null],
    ["Close on the doorbell button glowing faintly", null],
    ["Together, Leni and Oskar sit pressed close on the brown sofa", null],
    ["Widely spaced trees line the road", null],
    ["Overhead lights flicker in the hall", null],
    ["Walking home, Finn hums", null],
    ["", null],
  ];
  for (const [v, want] of cases) assert.equal(sh.shotInWords(v), want, v);
  assert.equal(sh.sceneShot({ cam: "over", visual: "Wide shot of the living room: Pearl and Walt on the sofa" }), "wide", "the words win");
  assert.equal(sh.sceneShot({ cam: "over", visual: "Pearl and Walt on the sofa" }), "over", "words that say nothing keep the plan");
  assert.equal(sh.sceneShot({ visual: "A detail: the key" }), "detail", "a scene with no plan, seen as its words say");
  assert.equal(sh.sceneShot({ cam: "sideways", visual: "Pearl waits" }), null);
  assert.equal(sh.sceneShot(null), null);
});

/* NEVER A STRANGER TO FILL THE SHOT (2026-11-24, "Her Face in the Glass"): the door scene was planned "over" and
 * written naming only the ghost at the glass — and "the nearer figure is seen from BEHIND" came back as a grown
 * man in a dark jumper, who walked to the door in the clip. */
test("a shot that wants a figure near the lens takes one of the people the words name — or a thing, never a stranger", async () => {
  const sh = await import("../app/lib/story-shots.ts");
  assert.ok(sh.STORY_SHOTS.over.camera.includes("the nearer figure is one of the people these words NAME, seen from BEHIND"));
  assert.ok(sh.STORY_SHOTS.over.camera.includes("When these words name nobody to stand there, the foreground is the dark edge of the place instead (a door frame, a curtain, a chair back) — never a stranger."));
  assert.ok(sh.STORY_SHOTS.depth.camera.includes("Both are people these words NAME; when they name only one, the near edge is a thing of the place (a door frame, a lamp, a chair back) — never a stranger."));
  assert.ok(sh.STORY_SHOTS.over.write.includes("NAME whose shoulder it is (\"over NAME's shoulder\")"), "the writer says whose back it is (a placeholder, never a name it could copy)");
  assert.ok(sh.cameraLine("over").startsWith("CAMERA: over the shoulder"));
  // (…and a low angle keeps feet where people stand: one at a window stood two children up on its sill)
  assert.ok(sh.cameraLine("low").includes("their feet on the floor or the ground where they stand (never up on a ledge or a sill)."));
  // (…and what the narration says is SEEN is in the picture: "they saw her standing on the porch" over an empty porch)
  const w = read("app", "lib", "film-engine.server.ts");
  assert.ok(w.includes("What the CAPTION over a picture says is SEEN at that moment is IN that VISUAL (\"they saw her standing on the porch\" → she is on the porch, through the glass)"));
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
  // EVERY GO of a scene is on the good model now (story-picture.ts → STORY_LADDER) — the last go of a scene whose
  // cast came out wrong twice used to be the one moved up to it
  assert.ok(!nar.includes("STORY_STRONG_RETRY") && nar.includes("const got = await drawScene(`${promptOf(withPlace)}${fix}`, withPlace ? refs : people, aspect);"));
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

test("what frightens: a creature a horror story invents is photographed, slightly wrong, and mostly hidden", async () => {
  // The owner's three references, 2026-11-24 ("actual realistic scary as fuck ass creatures like this"), drawn
  // on the app's own picture model two ways: worded as the app worded them → Halloween illustrations; worded by
  // how it was caught, what is wrong with it and what stays hidden → his references.
  const { CREATURE_REAL, WHAT_FRIGHTENS, creatureHidden, portraitPrompt } = await import("../app/lib/story-picture.ts");
  assert.ok(CREATURE_REAL.startsWith("It is PHOTOGRAPHED: a practical-effects creature") && CREATURE_REAL.endsWith("Never CGI, never a 3D render, never an illustration, never a clean studio look."));
  assert.ok(WHAT_FRIGHTENS.includes("it is NEARLY human and slightly wrong: give it ONE or TWO exact wrongnesses and nothing more"));
  assert.ok(WHAT_FRIGHTENS.includes("Never horns, wings, tentacles, armour, glowing magic, flames or a bare skull — those are costumes."));
  assert.ok(WHAT_FRIGHTENS.includes("it is never fully seen"));
  assert.ok(creatureHidden("The Smiler").startsWith("The Smiler is never shown whole or well lit:"));
  assert.equal(creatureHidden(""), "");
  // an invented CREATURE's portrait is a photograph of a built thing; a person's is what it always was;
  // and a children's format never gets it
  const thing = portraitPrompt("The Smiler, a tall pale ghoul with a grin far too wide and eyes sunk in black sockets", "a dark horror scene");
  assert.ok(thing.includes(CREATURE_REAL) && thing.includes("A wardrobe-test photograph of The Smiler") && thing.includes("the whole figure from head to feet"));
  const person = portraitPrompt("Marla, a lean camper in a mud-streaked olive jacket", "a dark horror scene");
  assert.ok(!person.includes("PHOTOGRAPHED") && person.includes("A character portrait of Marla") && person.includes("In the exact art style of the story."));
  assert.ok(!portraitPrompt("Grum, a friendly green monster with one big eye", "a bright cartoon", "Wholesome, child-safe. ").includes("PHOTOGRAPHED"), "a children's monster stays a cartoon");
  const engine = read("app", "lib", "film-engine.server.ts");
  assert.ok(engine.includes("(tmpl.key === \"horror\" ? `${WHAT_FRIGHTENS}\\n` : \"\") +"), "a horror story only");
  assert.ok(engine.includes("deep shadows that hide more than they show, shot on 35mm at night, underexposed, film grain"));
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("if (!tmpl.childSafe) own.forEach((c) => { if (characterKind(c.name, c.look) === \"monster\") notes.push(creatureHidden(c.name)); });"), "only a creature the STORY invented — a cast member the maker chose is seen");
});
