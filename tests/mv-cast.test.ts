/* Who is in a music-video shot, what each of them is doing, and whether a microphone belongs in it.
 *
 * A tester (2026-11-21) picked a star and two back characters and got videos with ONE back character —
 * who was holding the microphone: "the right way is put mic only in main character and they sing, other
 * 2 dancing". The owner the same day: "Mics only if necessary or fitting, most music videos don't use a
 * mic. If we need to help guide scenes for better outcomes we should."
 *
 * Three things went wrong, and these pin each one:
 *   1. the default cast put one co-star, in rotation, in a performance — a short video could never show
 *      the second;
 *   2. the picture model was never told who was who: the sentence that said so came after the setting,
 *      past the point where the picture call stops reading;
 *   3. nothing looked at the picture afterwards. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAST_PROMPT_MAX, DANCE_SLOT, MAX_COSTARS, MIC_MOTION_LINE, NO_NEW_MIC_LINE, SOLO_EDIT_MAX,
  castCheckPrompt, castFaults, castFix, castMotionLine, castStillPrompt, cutAtWord, defaultCostars, micFits, micLine, parseCastCheck,
  soloEditPrompt, soloStillPrompt,
} from "../app/lib/mv-cast.ts";
import { SHOT_ROLES, shotSlot } from "../app/lib/mv-pace.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");
const LONG = "A rain-slicked rooftop high above the city at blue hour, neon signs bleeding pink and teal across the puddles, water towers and satellite dishes silhouetted against a wall of glass skyscrapers, steam rising from the vents, a helicopter light sweeping slowly across the low clouds far behind them while traffic hums forty floors below";

test("a microphone belongs on a stage or in a booth — and nowhere else unless the scene asks for one", () => {
  for (const v of [
    "A rooftop at sunset, the city glowing behind them",
    "Cruising down the strip in a matte black car, palm trees sliding past",
    "A neon-lit corner store at midnight",
    "Backstage corridor, flickering lights",           // backstage is not the stage
    "A dusty country road, golden hour",
  ]) assert.equal(micFits(v), false, v);
  for (const v of [
    "On stage at a packed arena, lights sweeping the crowd",
    "A small club stage, smoke and spotlights",
    "Inside a recording booth, foam on the walls",
    "A summer festival at dusk",
    "A live show in a sweaty basement venue",
    "Karaoke night in a tiny bar",
    "She grips a vintage chrome microphone in the hallway",   // the scene's own words ask for it
  ]) assert.equal(micFits(v), true, v);
  // a scene that says there is none has none, even on a stage
  assert.equal(micFits("An empty stage, no microphone, just her and the lights"), false);
  assert.equal(micFits("On stage without a mic, dancing"), false);
  assert.equal(micFits(""), false);
  assert.equal(micFits(null), false);
});

test("every picked co-star is in a performance; a cut scene has the ones it names, the dance has them all", () => {
  const names = ["Valentina", "Keiko"];
  // the tester's case: a performance — BOTH back characters, not one in rotation
  assert.deepEqual(defaultCostars({ visual: "A rooftop at sunset" }, "perform", 1, names), [0, 1]);
  assert.deepEqual(defaultCostars({ visual: "A rooftop at sunset" }, "perform", 3, names), [0, 1]);
  // one co-star picked → that one
  assert.deepEqual(defaultCostars({ visual: "x" }, "perform", 1, ["Keiko"]), [0]);
  // never more than the picture model can keep apart
  assert.equal(defaultCostars({ visual: "x" }, "perform", 1, ["A1", "B2", "C3", "D4"]).length, MAX_COSTARS);
  // a cut scene: whoever the writer named in it…
  assert.deepEqual(defaultCostars({ visual: "Keiko leans on the hood of the car, laughing" }, "broll", 4, names), [1]);
  assert.deepEqual(defaultCostars({ visual: "The street at night", caption: "Valentina and Keiko by my side" }, "broll", 5, names), [0, 1]);
  // …by NAME, not by a word that merely contains it
  assert.deepEqual(defaultCostars({ visual: "An anniversary dinner" }, "broll", 5, ["Ann", "Bo"]), []);
  assert.deepEqual(defaultCostars({ visual: "Ann waits at the bar" }, "broll", 5, ["Ann", "Bo"]), [0]);
  // …the dance cut scene has them all (they ARE the dancers)…
  assert.equal(SHOT_ROLES[DANCE_SLOT], "broll");
  assert.deepEqual(defaultCostars({ visual: "The lot behind the club" }, "broll", DANCE_SLOT, names), [0, 1]);
  assert.deepEqual(defaultCostars({ visual: "The lot behind the club" }, "broll", DANCE_SLOT + 8, names), [0, 1], "the cadence repeats every 8");
  // …and any other cut scene is the artist's or the scenery's
  assert.deepEqual(defaultCostars({ visual: "A wide shot of the skyline" }, "broll", 0, names), []);
  assert.deepEqual(defaultCostars({ visual: "Chrome and rain" }, "broll", 7, names), []);
  // nobody picked → nobody
  assert.deepEqual(defaultCostars({ visual: "x" }, "perform", 1, []), []);
  // a name with characters a pattern would choke on is still just a name
  assert.deepEqual(defaultCostars({ visual: "D.J. (the real one) at the decks" }, "broll", 4, ["D.J. (the real one)"]), [0]);
});

test("the cast picture is told who is who FIRST, inside the length the picture call reads", () => {
  const p = castStillPrompt({ genre: "Rap / Hip-Hop", role: "perform", frame: "Medium-wide shot, everyone visible from the knees up", visual: LONG, costars: 2, micOk: false });
  assert.ok(p.length <= CAST_PROMPT_MAX, `${p.length} characters — over the limit, the end would be cut off`);
  const setting = p.indexOf("Setting:");
  assert.ok(setting > 0);
  const lead = p.slice(0, setting);
  // how many people, each once
  assert.match(lead, /EXACTLY three people, each shown ONCE/);
  // the artist is the 1st reference, front and centre, the one singing
  assert.match(lead, /ARTIST \(the person in the 1st reference image\) is front and centre, nearest the camera, facing it and singing/);
  // the others are the 2nd and 3rd, behind, dancing, NOT singing
  assert.match(lead, /the other two \(the 2nd and 3rd reference images\) are beside and a step behind the artist, dancing to the music, mouths closed, NOT singing/);
  // no microphone on a rooftop
  assert.match(lead, /NO microphones or mic stands anywhere/);
  // the framing is in it, and the setting starts with the scene's own words
  assert.match(lead, /Medium-wide shot, everyone visible from the knees up\./);
  assert.ok(p.slice(setting).startsWith("Setting: A rain-slicked rooftop high above the city"));
  // a long setting is cut at a word, never mid-word, and never ends on punctuation the caller adds
  assert.doesNotMatch(p, /[.,;:\s]$/);
  assert.ok(LONG.startsWith(p.slice(setting + "Setting: ".length)), "the setting is a prefix of the scene's words");
  assert.match(p, /[a-z]$/i);

  // one co-star: two people, singular wording
  const one = castStillPrompt({ genre: "Pop", role: "perform", frame: "Wide full-body shot", visual: "A beach at dawn", costars: 1, micOk: false });
  assert.match(one, /EXACTLY two people/);
  assert.match(one, /the other person \(the 2nd reference image\) is beside and a step behind the artist, dancing to the music, mouth closed, NOT singing/);
  // on a stage the artist — and only the artist — may hold one
  const stage = castStillPrompt({ genre: "Rock", role: "perform", frame: "Wide full-body shot", visual: "On stage at a packed arena", costars: 2, micOk: true });
  assert.match(stage, /Only the artist may hold a microphone — low, clear of the mouth; nobody else has one\./);
  assert.doesNotMatch(stage, /NO microphones/);
  // a cut scene: nobody sings, nobody has a microphone — stage or not
  const cut = castStillPrompt({ genre: "Rock", role: "broll", frame: "Wide dynamic shot of all of them dancing", visual: "On stage at a packed arena", costars: 2, micOk: true });
  assert.match(cut, /Nobody sings and there are NO microphones\./);
  assert.doesNotMatch(cut, /front and centre/);
  // what else must be in the shot rides at the end, and still fits
  const withProp = castStillPrompt({ genre: "Rap / Hip-Hop", role: "perform", frame: "Wide full-body shot", visual: LONG, costars: 1, micOk: false, extra: "Also in the shot: the tiger from the 3rd reference image — exactly one, and no other animal." });
  assert.ok(withProp.length <= CAST_PROMPT_MAX);
  assert.match(withProp, /Also in the shot: the tiger from the 3rd reference image — exactly one, and no other animal$/);
  // the count is clamped to what a shot can hold
  assert.match(castStillPrompt({ genre: "Pop", role: "perform", frame: "Wide", visual: "x", costars: 9, micOk: false }), /EXACTLY three people/);
});

test("a shot of the artist alone says the microphone rule before the setting, and keeps the setting", () => {
  const wide = soloStillPrompt({ genre: "Country", role: "perform", frame: "a MEDIUM shot of the artist performing straight to camera, framed from the waist up", visual: LONG, micOk: false });
  assert.ok(wide.length <= CAST_PROMPT_MAX);
  assert.match(wide, /who appears ONCE — never a twin or second copy of them; they face the camera, singing\./);
  assert.ok(wide.indexOf("NO microphones") > 0 && wide.indexOf("NO microphones") < wide.indexOf("Setting:"));
  // a cut scene of the artist alone may still have unnamed dancers in it: it never says "exactly one person"
  const dance = soloStillPrompt({ genre: "Pop", role: "broll", frame: "a dynamic B-ROLL shot of DANCING — backup dancers or the artist moving through the scene", visual: "A parking garage", micOk: false });
  assert.doesNotMatch(dance, /EXACTLY ONE person/i);
  assert.match(dance, /Nobody sings and there are NO microphones\./);

  // the upright path: the artist's own picture edited into the scene
  const edit = soloEditPrompt({ role: "perform", frame: "a MEDIUM CLOSE-UP of the artist performing to camera — head and shoulders in frame, NOT a tight face-filling extreme close-up, a natural relaxed expression, shallow depth of field", visual: LONG, micOk: false, extra: " The artist raps with swagger, with a natural, genuine expression." });
  assert.ok(edit.length <= SOLO_EDIT_MAX);
  assert.ok(edit.startsWith("Keep this EXACT person identical"));
  assert.ok(edit.indexOf("NO microphone anywhere.") < edit.indexOf("Compose the shot as"));
  // it used to lose most of a long setting (the whole prompt was cut at 480): at least 200 characters of it are kept
  const kept = edit.slice(edit.indexOf("in this setting: ") + "in this setting: ".length);
  assert.ok(kept.startsWith(LONG.slice(0, 200)), "the setting survives");
  // on a stage, a performance is not told there is no microphone
  assert.doesNotMatch(soloEditPrompt({ role: "perform", frame: "a WIDE shot", visual: "On stage", micOk: true }), /NO microphone/);
  // …but a cut scene still is
  assert.match(soloEditPrompt({ role: "broll", frame: "a WIDE shot", visual: "On stage", micOk: true }), /NO microphone anywhere\./);
});

test("the picture is looked at: the right people, a microphone only where it belongs", () => {
  // the checker's answer is read whether or not it wraps it in words
  assert.deepEqual(parseCastCheck('{"people": 3, "mic": "none"}'), { people: 3, mic: "none" });
  assert.deepEqual(parseCastCheck('Here you go:\n```json\n{"people": 2, "mic": "other"}\n```'), { people: 2, mic: "other" });
  assert.deepEqual(parseCastCheck('{"people": 3, "mic": "front", "prop": false}'), { people: 3, mic: "front", prop: false });
  for (const junk of ["", "three people, no mic", '{"people": "lots", "mic": "none"}', '{"people": 3, "mic": "maybe"}', '{"mic": "none"}', '{"people": 99, "mic": "none"}', "{not json}"]) {
    assert.equal(parseCastCheck(junk), null, junk);
  }
  // the question asks about the prop only when there is one
  assert.doesNotMatch(castCheckPrompt(), /"prop"/);
  assert.match(castCheckPrompt("tiger"), /recognisable tiger is clearly visible/);
  assert.match(castCheckPrompt("tiger"), /"prop": true \| false/);

  // RIGHT: three people, nobody with a microphone, on a rooftop
  assert.equal(castFaults({ people: 3, mic: "none" }, 3, false, true), 0);
  // THE TESTER'S PICTURE: one back character missing, and the microphone in the wrong hand
  const testers = castFaults({ people: 2, mic: "other" }, 3, false, true);
  assert.ok(testers > 0);
  assert.ok(testers > castFaults({ people: 3, mic: "other" }, 3, false, true), "a missing person is worse than a stray microphone");
  assert.ok(castFaults({ people: 3, mic: "other" }, 3, false, true) > castFaults({ people: 3, mic: "front" }, 3, false, true), "the wrong hand is worse than the right one");
  // an extra person (a copy of someone) is a fault too
  assert.ok(castFaults({ people: 4, mic: "none" }, 3, false, true) > 0);
  // on a stage, the singer holding one is right; anyone else — or everyone — is not
  assert.equal(castFaults({ people: 3, mic: "front" }, 3, true, true), 0);
  assert.ok(castFaults({ people: 3, mic: "other" }, 3, true, true) > 0);
  assert.ok(castFaults({ people: 3, mic: "several" }, 3, true, true) > 0);
  // off a stage even the singer should not have one — and in a cut scene nobody sings
  assert.ok(castFaults({ people: 3, mic: "front" }, 3, false, true) > 0);
  assert.ok(castFaults({ people: 3, mic: "front" }, 3, true, false) > 0);
  // a wide shot where the people are too small to count is not failed on the count
  assert.equal(castFaults({ people: 1, mic: "none" }, null, false, false), 0);
  // the prop the scene has must be there
  assert.ok(castFaults({ people: 3, mic: "none", prop: false }, 3, false, true, true) > 0);
  assert.equal(castFaults({ people: 3, mic: "none", prop: true }, 3, false, true, true), 0);
  assert.equal(castFaults({ people: 3, mic: "none", prop: false }, 3, false, true, false), 0, "a prop nobody asked for is not checked");

  // what the next try is told names the fault
  assert.match(castFix({ people: 2, mic: "other" }, 3, false, true), /ALL three people must be clearly visible/);
  assert.match(castFix({ people: 2, mic: "other" }, 3, false, true), /Remove every microphone/);
  assert.match(castFix({ people: 4, mic: "none" }, 3, false, true), /ONLY three people/);
  assert.match(castFix({ people: 3, mic: "several" }, 3, true, true), /ONLY the artist holds a microphone/);
  assert.match(castFix({ people: 3, mic: "none", prop: false }, 3, false, true, "tiger"), /The tiger must be clearly visible/);
  assert.equal(castFix({ people: 3, mic: "none" }, 3, false, true), "");
});

test("the video model is told who is in the shot, that only the artist sings, and not to invent a microphone", () => {
  assert.equal(castMotionLine(0, true), "");
  const three = castMotionLine(2, true);
  assert.match(three, /is the ONLY one singing/);
  assert.match(three, /The other two dance and move to the beat with their mouths closed and never sing\./);
  assert.match(three, /The same three people stay in frame the whole time — nobody appears, vanishes or is duplicated\./);
  const two = castMotionLine(1, true);
  assert.match(two, /The other person dances and moves to the beat with their mouth closed and never sings\./);
  assert.match(two, /The same two people/);
  assert.match(castMotionLine(2, false), /nobody sings\.$/);
  assert.match(MIC_MOTION_LINE, /Do NOT add a microphone/);
  assert.match(MIC_MOTION_LINE, /keep holding it the same way/);
  assert.match(NO_NEW_MIC_LINE, /Do NOT add a microphone/);
  assert.equal(micLine(false, true), "NO microphones or mic stands anywhere — nobody holds one.");

  const pipe = read("app", "lib", "music-video-pipeline.server.ts");
  // it used to say, of every performance, "There is NO microphone" — and, over a picture of three people,
  // "exactly ONE artist … a single person"
  assert.doesNotMatch(pipe, /There is NO microphone/);
  assert.match(pipe, /\$\{MIC_MOTION_LINE\}/);
  assert.match(pipe, /const who = k \? castMotionLine\(k, shot\.role === "perform"\) : ` \$\{ONE_PERSON\}`/);
});

test("the pipeline and the builder make cast shots one way — the shared default, the shared prompt, the check", () => {
  const pipe = read("app", "lib", "music-video-pipeline.server.ts");
  const seeds = pipe.slice(pipe.indexOf("async function buildMusicVideoSeeds"), pipe.indexOf("export async function previewMusicVideoScenes"));
  const reroll = pipe.slice(pipe.indexOf("export async function rerollMusicVideoScene"), pipe.indexOf("export async function generateMusicVideo"));
  // no pick for a scene → the shared default (it used to be "all co-stars in every scene" here and "one
  // in rotation" in the builder: two answers to one question)
  assert.match(seeds, /defaultCostars\(s, shot\.role, shot\.slot, castNameList\)/);
  // a shot with co-stars goes through the checked path, in the storyboard and in a re-roll alike
  for (const [name, src] of [["storyboard", seeds], ["re-roll", reroll]] as const) {
    assert.match(src, /castStill\(\{/, `${name}: the checked cast still`);
    assert.match(src, /soloStillPrompt\(\{/, `${name}: the wide/square solo prompt`);
    assert.match(src, /soloEditPrompt\(\{/, `${name}: the upright solo prompt`);
    // the old prompt, which named the cast after the setting
    assert.doesNotMatch(src, /Feature the artist together with/, name);
  }
  // the forced artist-and-prop compose would throw the co-stars out of their own scene
  assert.match(seeds, /if \(propKey && artistRef && propRefs\[propKey\] && !multiCast\)/);
  // the checked still asks the picture call for the room its prompt needs, looks at the result, and never
  // lets a failed check cost the scene
  const still = pipe.slice(pipe.indexOf("async function castStill"), pipe.indexOf("/** Build the per-scene SEED stills"));
  assert.match(still, /renderStyledSeedMulti\(prompt, refs, o\.asp, undefined, CAST_PROMPT_MAX\)/);
  assert.match(still, /if \(!seen\) return img;/, "a vision outage takes the picture as it is");
  assert.match(still, /attempt < 3/);
  assert.match(still, /best\.faults/);
  // the picture calls really do read that far
  const img = read("app", "lib", "image-generation.server.ts");
  assert.match(img, /export async function renderStyledSeedMulti\(prompt: string, refImageUrls: \(string \| null \| undefined\)\[\], aspect = "9:16", lockNote\?: string, maxPrompt = 460\)/);
  assert.match(img, /export async function editSubjectIntoScene\(subjectUrl: string, prompt: string, maxPrompt = 480\)/);
  assert.ok(CAST_PROMPT_MAX <= 900 && SOLO_EDIT_MAX <= 900, "both callers ask for no more than the picture calls allow");

  // the builder shows the same default the render uses
  const ui = read("app", "routes", "web.film.tsx");
  assert.match(ui, /import \{ defaultCostars \} from "\.\.\/lib\/mv-cast"/);
  assert.match(ui, /defaultCostars\(scenesArr\[i\], role, shotSlot\(role, i\), castExtra\.map\(\(m\) => m\.name \|\| ""\)\)/);
  assert.doesNotMatch(ui, /pOrder % castExtra\.length/, "one co-star in rotation is gone");
  // and the slot it is given is the slot the pipeline frames the scene with
  for (let i = 0; i < 24; i++) for (const role of ["perform", "broll"] as const) assert.equal(SHOT_ROLES[shotSlot(role, i)], role);
});

test("a long setting is cut at a word", () => {
  assert.equal(cutAtWord("one two three", 50), "one two three");
  assert.equal(cutAtWord("one two three four", 9), "one two");
  assert.equal(cutAtWord("one, two; three", 9), "one, two");
  assert.equal(cutAtWord("  spaced    out   words  ", 12), "spaced out");
  // a single word longer than the room is cut hard rather than dropped
  assert.equal(cutAtWord("supercalifragilistic", 5), "super");
});
