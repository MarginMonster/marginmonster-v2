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
    // a "stage" that is a SET, not a show (2026-11-22: the pop look offers "a sleek stage", so nearly
    // every pop performance was written on one — and handed a microphone the owner had asked to lose)
    "OMAR sings straight to camera on a sleek rooftop stage with bright synth lighting, city skyline glowing behind them",
    "Medium shot of OMAR singing straight to camera on a bright rooftop stage, VALENTINA dancing softly beside him",
    "A sound stage dressed as a neon alley",
  ]) assert.equal(micFits(v), false, v);
  for (const v of [
    "On stage at a packed arena, lights sweeping the crowd",
    "A small club stage, smoke and spotlights",
    "Inside a recording booth, foam on the walls",
    "A summer festival at dusk",
    "A live show in a sweaty basement venue",
    "Karaoke night in a tiny bar",
    "She grips a vintage chrome microphone in the hallway",   // the scene's own words ask for it
    "A packed concert stage washed in red and blue lights and haze",
    "A stage in front of a roaring crowd, hands in the air",
    "Onstage at the end of the tour, confetti still falling",
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
  assert.match(lead, /EXACTLY three DIFFERENT people, each shown ONCE/);
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
  assert.match(one, /EXACTLY two DIFFERENT people/);
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
  assert.match(castStillPrompt({ genre: "Pop", role: "perform", frame: "Wide", visual: "x", costars: 9, micOk: false }), /EXACTLY three DIFFERENT people/);
  // a cut scene with the cast in it says they are different people too (two co-stars came back blended into one)
  // — and that what they DO is the setting's business: it said "all moving together", and a scene set in a
  // car came back with the cast on their feet in it (tests/mv-sense.test.ts)
  // (…and that they are DRESSED as in their pictures — said plainly: "each with their own … clothes" let a
  //  cut scene re-dress two of them; the test "the locked wardrobe is LOOKED AT" below)
  assert.match(cut, /each doing what the setting describes, each with their own face and hair, and each DRESSED EXACTLY as in their reference image — the same garments, the same colours\. /);
  assert.doesNotMatch(cut, /all moving together/);
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
  assert.doesNotMatch(castCheckPrompt(), /"prop"|"seen"|"twin"/);
  assert.match(castCheckPrompt({ prop: "tiger" }), /recognisable tiger is clearly visible/);
  assert.match(castCheckPrompt({ prop: "tiger" }), /"prop": true \| false/);
  // WHO is there, not only how many: shown the cast's reference pictures after the frame, the checker
  // says which of them it can see and whether anyone is doubled or blended
  const q3 = castCheckPrompt({ refs: 3 });
  assert.match(q3, /The FIRST image is a frame from a music video\. The three images after it are the three people who must be in it \(person 1 is the 2nd image, person 2 the 3rd, person 3 the 4th\)/);
  assert.match(q3, /Go only by what can be seen: hair \(colour, length, style\), facial hair, build, apparent age and clothing/);
  assert.match(q3, /is someone matching them in the frame\?/);
  assert.match(q3, /TWICE \(a twin or copy of the same person\), or a BLEND of two of them/);
  assert.match(q3, /"seen": \[true \| false, true \| false, true \| false\], "twin": true \| false/);
  assert.match(castCheckPrompt({ refs: 2 }), /"seen": \[true \| false, true \| false\], "twin"/);
  assert.match(castCheckPrompt({ refs: 1 }), /The image after it is the one person who must be in it/);
  assert.deepEqual(parseCastCheck('{"people": 3, "seen": [true, false, true], "twin": true, "mic": "none"}'), { people: 3, mic: "none", seen: [true, false, true], twin: true });
  assert.deepEqual(parseCastCheck('{"people": 3, "seen": "all", "twin": "no", "mic": "none"}'), { people: 3, mic: "none" }, "an answer that is not the shape asked for is left out, not trusted");
  // THE FIRST LIVE STORYBOARD (2026-11-21): three people in the picture — the artist twice, a co-star
  // missing. The count is right; the picture is not.
  const doubled = { people: 3, mic: "none" as const, seen: [true, true, false], twin: true };
  assert.ok(castFaults(doubled, 3, false, false) >= 6, "a missing person and a double both count");
  assert.ok(castFaults({ people: 3, mic: "none", seen: [true, true, false] }, 3, false, false) > 0, "someone missing, though the count is right");
  assert.ok(castFaults({ people: 3, mic: "none", seen: [true, true, true], twin: true }, 3, false, false) > 0, "two co-stars blended into one");
  assert.equal(castFaults({ people: 3, mic: "none", seen: [true, true, true], twin: false }, 3, false, true), 0);
  // …and what the next try is told names who is missing, by their reference picture
  assert.match(castFix(doubled, 3, false, false), /The person in the 3rd reference image is MISSING — put them in, with their own face, hair and clothes/);
  assert.match(castFix(doubled, 3, false, false), /Nobody appears twice and no two people are blended into one — three DIFFERENT people/);
  assert.match(castFix({ people: 2, mic: "none", seen: [true, false, false] }, 3, false, true), /The person in the 2nd and 3rd reference image is MISSING/);
  // a wide shot where the people are too small to tell apart is not failed on who is there
  assert.equal(castFaults({ people: 1, mic: "none", seen: [true, false, false], twin: true }, null, false, false), 0);
  assert.equal(castFix({ people: 1, mic: "none", seen: [true, false, false], twin: true }, null, false, false), "");

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
  // (the hands are given something to do: told only "nobody holds one", the picture model drew the singer
  //  with a microphone three tries running)
  assert.equal(micLine(false, true), "NO microphones or mic stands anywhere — the singer's hands are EMPTY, open and gesturing at chest height.");

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
  assert.match(seeds, /sceneCast\(\{ scene: s, role: shot\.role, slot: shot\.slot, names: castNameList, listed: /);
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
  assert.match(still, /if \(!seen && !bars\) return \{ img, faults: null, reading: null \};/, "a vision outage takes the picture as it is (unless it has black bars round it — tests/mv-sense.test.ts)");
  // the checker is shown the cast's reference pictures, so it can say WHO is there
  assert.match(still, /readCast\(o\.abs\(img\) \|\| img, people\.map\(\(r\) => o\.abs\(r\) \|\| r\), o\.prop\?\.noun\)/);
  assert.match(pipe, /anthropicVision\(castCheckPrompt\(\{ refs: refs\.length, prop \}\), \[imgUrl, \.\.\.refs\]/);
  // what the check found rides back to the storyboard, which flags a scene that is still off
  assert.match(seeds, /sceneFaults: made\.map\(\(m\) => m\.faults\)/);
  // the star and the co-stars are dressed at the same time, not one after another
  assert.match(seeds, /await Promise\.all\(\[styleArtist\(\), \.\.\.castExtra\.map\(\(m, ci\) => styleCostar\(m, ci\)/);
  assert.match(still, /attempt < 3/);
  assert.match(still, /best\.faults/);
  // the picture calls really do read that far
  const img = read("app", "lib", "image-generation.server.ts");
  assert.match(img, /export async function renderStyledSeedMulti\(prompt: string, refImageUrls: \(string \| null \| undefined\)\[\], aspect = "9:16", lockNote\?: string, maxPrompt = 460\)/);
  // (…and takes the video's shape since 2026-11-22: tests/film-story-fixes.test.ts)
  assert.match(img, /export async function editSubjectIntoScene\(subjectUrl: string, prompt: string, maxPrompt = 480, shape\?: "9:16" \| "16:9" \| "1:1"\)/);
  assert.ok(CAST_PROMPT_MAX <= 900 && SOLO_EDIT_MAX <= 900, "both callers ask for no more than the picture calls allow");

  // the builder shows the same default the render uses
  const ui = read("app", "routes", "web.film.tsx");
  assert.match(ui, /import \{ MAX_COSTARS, sceneCast, singerOf \} from "\.\.\/lib\/mv-cast"/);
  assert.match(ui, /sceneCast\(\{ scene: sc, role, slot: shotSlot\(role, i\), names: castNamesAll \}\)/);
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

import { STYLE_PROMPT_MAX, castStylePrompt, lookWithoutWardrobe } from "../app/lib/mv-cast.ts";

test("the wardrobe is locked: what is picked is what is worn, in every scene", () => {
  // The owner, 2026-11-22: "outfits are changing but - we made outfits selectable for cast in the setup
  // and avatar selection … should we lock the selected wardrobe?" — with "Own look" picked, a presenter
  // in a navy suit came out in a sequin bomber in one video and a black blazer in the next.
  const LOOKS = {
    rap: "a PREMIUM, aspirational hip-hop music video — a stylish city rooftop at night, an upscale modern street, a sleek studio or a luxe interior; sharp designer streetwear; high-production and cinematic — NOT run-down, poor, gritty or a 'poverty' setting",
    pop: "a PREMIUM pop music video — a sleek stage, a bright modern studio, a chic rooftop or a stylish interior; fashionable wardrobe; polished, high-production and cinematic",
    rock: "a PREMIUM rock music video — a real concert stage, a cool industrial loft or a moody studio; stylish; cinematic and high-production, edgy but never cheap or run-down",
    rnb: "a PREMIUM R&B music video — a luxe interior, a rooftop at golden hour, a stylish lounge; elegant fashion; a warm, cinematic, high-production look",
  };
  // these ARE the looks the genres carry (so the test fails if one changes and nobody reads it for clothes)
  const engine = read("app", "lib", "film-engine.server.ts");
  for (const look of Object.values(LOOKS)) assert.ok(engine.includes(`look: "${look}"`), look.slice(0, 50));
  // the genre no longer says what to wear — the places and the finish stay
  assert.equal(lookWithoutWardrobe(LOOKS.pop), "a PREMIUM pop music video — a sleek stage, a bright modern studio, a chic rooftop or a stylish interior; polished, high-production and cinematic");
  assert.equal(lookWithoutWardrobe(LOOKS.rap), "a PREMIUM, aspirational hip-hop music video — a stylish city rooftop at night, an upscale modern street, a sleek studio or a luxe interior; high-production and cinematic — NOT run-down, poor, gritty or a 'poverty' setting");
  assert.equal(lookWithoutWardrobe(LOOKS.rock), "a PREMIUM rock music video — a real concert stage, a cool industrial loft or a moody studio; cinematic and high-production, edgy but never cheap or run-down");
  assert.equal(lookWithoutWardrobe(LOOKS.rnb), "a PREMIUM R&B music video — a luxe interior, a rooftop at golden hour, a stylish lounge; a warm, cinematic, high-production look");
  for (const look of Object.values(LOOKS)) assert.doesNotMatch(lookWithoutWardrobe(look), /wardrobe|streetwear|fashion/i);
  assert.equal(lookWithoutWardrobe(""), "");

  // OWN LOOK: the clothes in their own picture are kept — said first, then the framing and the face,
  // all inside the length the styling call reads (the genre's "fashionable wardrobe" used to be the
  // last thing it read)
  const own = castStylePrompt({ genreLabel: "Pop / Dance / EDM", look: LOOKS.pop, perform: "sings to camera with bright, upbeat, joyful charisma — lively and fun, warm and smiling, light rhythmic movement", realism: "Photorealistic." });
  assert.ok(own.startsWith("Keep this EXACT person identical — same face, hair, skin and build — and keep EXACTLY the clothes they wear in this picture: same garments, colours and accessories. Do NOT restyle or re-dress them, and do NOT swap them for anyone else."));
  const readPart = own.slice(0, STYLE_PROMPT_MAX);
  assert.equal(STYLE_PROMPT_MAX, 700);
  assert.ok(readPart.includes("Their hands are empty — no microphone.") && readPart.includes("Make it a realistic Pop / Dance / EDM music-video shot of them, who sings to camera"));
  assert.ok(readPart.includes("— framed from the knees up, the face clear and sharp, with a natural, genuine expression that fits the song (never angry or snarling)."));
  assert.ok(readPart.includes("a sleek stage, a bright modern studio"), "the genre's places are read too");
  assert.doesNotMatch(own, /fashionable wardrobe/);
  // AN OUTFIT THAT WAS MADE AND APPROVED: the picture being edited already shows it — keep it, named
  const pictured = castStylePrompt({ genreLabel: "Pop / Dance / EDM", look: LOOKS.pop, outfit: "a sharp tailored suit", outfitPictured: true });
  assert.ok(pictured.includes("keep EXACTLY the clothes they wear in this picture (a sharp tailored suit): same garments, colours and accessories."));
  assert.doesNotMatch(pictured, /Dress them in/);
  // an outfit in words only (its picture is gone, or was never made): dress them from the words
  const worded = castStylePrompt({ genreLabel: "Rock / Punk / Alt", look: LOOKS.rock, outfit: "an edgy black leather jacket look" });
  assert.ok(worded.includes("Dress them in an edgy black leather jacket look — that outfit and no other."));
  assert.doesNotMatch(worded, /keep EXACTLY the clothes/);
  // a co-star (no performance line) reads the same rule
  assert.ok(castStylePrompt({ genreLabel: "Country", look: "a PREMIUM country music video — a real honky-tonk stage" }).includes("Make it a realistic Country music-video shot of them — framed from the knees up, the face clear and sharp, with a natural, genuine expression. a PREMIUM country music video"));

  // every scene is drawn from that picture, and says so
  assert.match(castStillPrompt({ genre: "Pop", role: "perform", frame: "a medium-wide shot", visual: "A rooftop at night", costars: 2, micOk: false }), /NOT singing; everyone dressed exactly as in their reference image\. /);
  assert.match(castStillPrompt({ genre: "Pop", role: "broll", frame: "a wide shot", visual: "A rooftop at night", costars: 1, micOk: false }), /each DRESSED EXACTLY as in their reference image — the same garments, the same colours\. /);
  assert.match(soloStillPrompt({ genre: "Pop", role: "broll", frame: "a wide shot", visual: "A street at night", micOk: false }), /the artist \(the person in the reference image, dressed exactly as in it\)/);
  assert.match(soloEditPrompt({ role: "perform", frame: "a medium shot", visual: "A street at night", micOk: false }), /same face, hair, skin, build, and the clothes and jewelry of this picture whatever the setting says they wear;/);
  // …and the writer no longer dresses anyone: a VISUAL that said "silver jacket catching the glow" put a
  // co-star in a silver jacket for that one scene, over the look picked for her (seen 2026-11-22)
  assert.match(read("app", "lib", "mv-sense.ts"), /CLOTHES: never write what anyone is WEARING — no jackets, dresses, fabrics, jewellery or colours of clothing\./);

  // the pipeline styles each cast member FROM the picture that shows what they wear…
  const pipe = read("app", "lib", "music-video-pipeline.server.ts");
  assert.ok(pipe.includes("const pic = outfit && img && p.outfitImgs ? abs((p.outfitImgs[img] || \"\").trim() || null) : null;"));
  assert.ok(pipe.includes("let styled = await editSubjectIntoScene(w.src || own, castStylePrompt({ genreLabel: g.label, look: g.look, perform, outfit: w.outfit, outfitPictured: w.pictured, realism: REALISM }), STYLE_PROMPT_MAX);"));
  // …and an approved picture that can no longer be read is never kept as their reference
  assert.ok(pipe.includes("if (!styled && w.pictured) styled = await editSubjectIntoScene(own, castStylePrompt({ genreLabel: g.label, look: g.look, perform, outfit: w.outfit, outfitPictured: false, realism: REALISM }), STYLE_PROMPT_MAX);"));
  assert.ok(pipe.includes("const { styled } = await styleMember(p.heroUrl, g.perform);") && pipe.includes("ref = styled || picked;"));
  assert.ok(pipe.includes("const { styled, own: src } = await styleMember(m.img);"));
  assert.equal(pipe.split("castForScene: opts.castForScene, outfits: opts.outfits, outfitImgs: opts.outfitImgs,").length - 1, 2, "the storyboard and the render both hand the pictures on");
  assert.doesNotMatch(pipe, /keep this outfit consistent in every shot/);
  assert.ok(read("app", "lib", "job-queue.server.ts").includes("outfitImgs: (payload.filmOutfitImgs && typeof payload.filmOutfitImgs === \"object\") ? (payload.filmOutfitImgs as Record<string, string>) : undefined,"));

  // the page sends the approved picture with the outfit's words, and says the look is kept
  const ui = read("app", "routes", "web.film.tsx");
  assert.ok(ui.includes("for (const img of Object.keys(outfits)) { const pic = styleFor(img, outfits[img]); if (pic) outfitImgs[img] = pic; }"));
  assert.ok(ui.includes("...(Object.keys(outfitImgs).length ? { filmOutfitImgs: JSON.stringify(outfitImgs) } : {})"));
  assert.ok(ui.includes("<input type=\"hidden\" name=\"filmOutfitImgs\" value={JSON.stringify(outfitImgs)} />"));
  assert.ok(ui.includes("{t(\"The look you pick is what they wear in every scene.\")}"));
  // only a picture on our own render disk is accepted, whatever host the address names
  assert.ok(ui.includes("try { p = new URL(v.trim(), \"https://site.invalid\").pathname; } catch { continue; }"));
  const ours = /^\/renders\/[\w.-]+\.(?:jpe?g|png|webp)$/i;
  assert.ok(ui.includes(`if (${String(ours)}.test(p)) out[k.slice(0, 2000)] = p;`));
  const pathOf = (v: string) => new URL(v.trim(), "https://site.invalid").pathname;
  for (const good of ["https://easymodeapp.com/renders/img-17953-ab12.jpg", "/renders/img-1.png", "https://elsewhere.example/renders/x.webp"]) assert.ok(ours.test(pathOf(good)), good);
  for (const bad of ["https://elsewhere.example/steal.jpg", "/avatars/omar_0.jpg", "/renders/../secrets.jpg", "/renders/a/b.jpg", "/renders/x.svg", "file:///etc/passwd"]) assert.ok(!ours.test(pathOf(bad)), bad);
  assert.ok(ui.includes("const outfitImgs = parseOutfitImgs(form.get(\"filmOutfitImgs\") as string);") && ui.includes("...(filmOutfitImgs ? { filmOutfitImgs } : {}),"));
});

test("one scene can break from the locked wardrobe — inside the scene's Cast editor, before the render", () => {
  // The owner, 2026-11-22: "need to make per scene outfit editable on the seed revision system before
  // final video generate cta" — then, looking at it: "What if we leave the wardrobe stuff inside of the
  // avatar edit option (bundled them) no extra button?"
  const ui = read("app", "routes", "web.film.tsx");
  // scene → person → what they wear THERE ("" = their own look); no entry = their look for the video
  assert.ok(ui.includes("const [sceneOutfits, setSceneOutfits] = useState<Record<number, Record<string, string>>>({});"));
  // NO button and NO editor of its own: two edit buttons on a card, and the outfits live under the cast
  assert.ok(!ui.includes("is-wear") && !ui.includes("sceneWearPick") && !ui.includes("openSceneWearPick"));
  const acts = ui.slice(ui.indexOf("<div className=\"mm-sc-acts\">"), ui.indexOf("{editing && ("));
  assert.equal(acts.split("className={`mm-sc-act ").length - 1, 2, "Cast and Props");
  // …the Cast button carries a mark when the scene has an outfit of its own
  assert.ok(acts.includes("{sceneWearChanged(i) ? <span className=\"mm-sc-act-tag\" title={t(\"Outfit changed\")}><Ico n=\"shirt\" size={10} /></span> : null}"));
  const castEditor = ui.slice(ui.indexOf("<div className=\"mm-sc-castedit\">"), ui.indexOf("{seeds && scenePropPick === i && ("));
  // ONE LIST of the people in the scene — each with what they wear beside them, whoever leads tagged,
  // anyone else removable — and under it the people who are NOT in it yet. (It used to be a strip of faces
  // and then the same people again as outfit rows.)
  assert.ok(castEditor.includes("{sceneDraftPeople(strip.scenes, i).map((img) => {"));
  assert.ok(castEditor.includes("const leads = img === (draftLead || artistPick);"), "whoever leads is known by who they are, not by where they sit in the list");
  assert.ok(castEditor.includes("? (leads ? <span className=\"mm-sw-tag\">{t(\"Lead\")}</span> : null)"));
  assert.ok(castEditor.includes("{!leads && <button type=\"button\" className=\"mm-sw-rm\" onClick={() => toggleSceneCastDraft(img)}"));
  assert.equal(castEditor.split("<div className=\"mm-sc-castpick\">").length - 1, 1, "one strip, and it only ADDS");
  const addStrip = castEditor.slice(castEditor.indexOf("<div className=\"mm-sw-add\">"));
  assert.ok(addStrip.includes("{t(\"Add to this scene\")}"));
  assert.ok(addStrip.includes("castExtra.filter((m) => m.img !== draftLead && !sceneCastDraft.includes(m.img)).map((m) => ("), "only people who are not in the scene");
  assert.ok(!addStrip.includes("mm-cp-opt${"), "nothing in it is a toggle");
  assert.ok(castEditor.includes("{t(\"Only this scene changes. Everywhere else they keep the look you picked.\")}"));
  // the people being dressed are the ones in the editor's DRAFT, so a co-star just added can be dressed at once
  assert.ok(ui.includes("return [...new Set([lead, ...sceneCastDraft].filter((x): x is string => !!x))];"));
  // opening the editor loads both drafts; ONE button applies both, and draws the scene once
  assert.ok(ui.includes("setSceneWearDraft({ ...(sceneOutfits[i] || {}) }); setSceneWearText({}); setSceneWearNewFor(null);"));
  const confirm = ui.slice(ui.indexOf("const confirmSceneCastMv"), ui.indexOf("// ---- Wardrobe (owner edit)"));
  assert.ok(confirm.includes("for (const k of Object.keys(sceneWearDraft)) if (inScene.has(k)) wear[k] = sceneWearDraft[k];"), "only people in the scene keep an outfit for it");
  assert.ok(confirm.includes("if (Object.keys(wear).length) n[i] = wear; else delete n[i];"), "back to the video look = no entry");
  assert.ok(confirm.includes("rerollScene(i, undefined, sceneCastDraft, newSinger ? singer : undefined, wear, who);"), "(who, by name: the scene's words follow its cast — tests/mv-recast.test.ts)");
  assert.equal(castEditor.split("mm-sp-confirm").length - 1, 1, "one Regenerate button");
  // a scene is drawn from the picture of what each person wears IN IT
  assert.ok(ui.includes("if (w === undefined) return videoRef;") && ui.includes("if (w === \"\") return img;") && ui.includes("return styleFor(img, w) || videoRef;"));
  assert.ok(ui.includes("const sceneCastRefs = costarImgs.map((img) => sceneRefOf(i, img, img === artistPick ? seeds.artistRef : costarImgToRef(img), wearOverride)).filter(Boolean) as string[];"));
  assert.ok(ui.includes("const sceneArtistRef = artistPick ? sceneRefOf(i, artistPick, seeds.artistRef, wearOverride) : seeds.artistRef;"));
  assert.ok(ui.includes("const leadRef = leadImg ? sceneRefOf(i, leadImg, costarImgToRef(leadImg), wearOverride) : null;"));
  assert.ok(ui.includes("artistRef: sceneArtistRef || \"\","));
  // a NEW outfit made from a scene: one "New look" tile opens the one box; it is saved beside their looks
  // and does not become the video's look
  assert.ok(castEditor.includes("mm-sw-look mm-sw-new") && castEditor.includes("{sceneWearNewFor === img && ("));
  const make = ui.slice(ui.indexOf("const makeSceneOutfit"), ui.indexOf("const reindexWear"));
  assert.ok(make.includes("outfitFetcher.submit({ intent: \"styleOutfit\", outfitImg: img, outfitDesc: dsc, outfitAvatarId: rosterIdOf(img) }, { method: \"post\" });"));
  assert.ok(!make.includes("setOutfits("));
  assert.ok(ui.includes("if (r.img && sceneCastPick !== null) setSceneWearDraft((dd) => ({ ...dd, [img]: desc }));"), "…and is picked for that scene once it exists");
  // changing a look for the VIDEO redraws the storyboard: stills drawn in the old look would be rendered in it
  assert.ok(ui.includes("mvAspect, featKey, JSON.stringify(outfits)]);"));
  // removing a scene keeps the other scenes' outfits on the right scenes
  assert.ok(ui.includes("setSceneOutfits((prev) => reindexWear(prev, i));"));
  // the faces on a scene's card show that scene's look
  assert.ok(ui.includes("<img src={sceneFace(i, img)} alt=\"\" />"));

  // THE EDITORS OPEN AS A DRAWER under the card's row, full width (a card is 174 px wide on a phone: inside
  // it the outfit box was 62 px and the chips wrapped onto five lines — seen in the pane, 2026-11-22)
  assert.ok(ui.includes("<Fragment key={i}>") && ui.includes("<div className=\"mm-sc-drawer\" role=\"group\""));
  assert.ok(ui.includes(".mm-sc-drawer{grid-column:1/-1;"));
  assert.ok(ui.includes("grid-auto-flow:row dense;}"), "the cards after it keep their places in the row above");
  assert.ok(ui.includes("const editing = isMv && !!seeds && (sceneCastPick === i || scenePropPick === i);"));
  // one editor at a time
  assert.ok(ui.includes("if (scenePropPick === i) { setScenePropPick(null); return; }\n    setSceneCastPick(null);") || ui.includes("if (scenePropPick === i) { setScenePropPick(null); return; }\r\n    setSceneCastPick(null);"));

  // every new line is in all five languages
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Outfit changed", "Video look", "New look", "Lead", "Add to this scene", "Remove {name} from this scene", "Free — you see and edit every scene before anything is rendered.", "What {name} wears in this scene", "An outfit just for this scene — a white tux, a red dress…", "Only this scene changes. Everywhere else they keep the look you picked.", "The look you pick is what they wear in every scene.", "Edit scene {n}", "Who's in this scene", "Edit who's in this scene and what they wear", "Made in Movie Maker"]) {
    assert.equal(dict.split(`\n  ${JSON.stringify(k)}:`).length - 1, 5, k);
  }
});

test("a look made in the Movie Maker is kept on the presenter, and shows on their card in Presenters", async () => {
  // The owner, 2026-11-22: "the outfit changes will need to be saved to each avatars cast card also in
  // the presenters section and appear there".
  const { lookAvatarKey, lookImgPath, lookDesc, lookLabel, LOOKS_PER_AVATAR } = await import("../app/lib/avatar-looks.ts");
  // WHO: a presenter's id as the pickers carry it
  for (const id of ["omar", "valentina", "cav_cmwabc123", "mm-monster"]) assert.equal(lookAvatarKey(id), id);
  for (const bad of ["", " ", "a", "../etc", "omar/../x", "o m a r", 12, null, undefined, "x".repeat(80)]) assert.equal(lookAvatarKey(bad), "", String(bad));
  // THE PICTURE: only one on our own render disk — whatever host the address names, only the path is kept
  assert.equal(lookImgPath("https://easymodeapp.com/renders/img-1795-ab12.jpg"), "/renders/img-1795-ab12.jpg");
  assert.equal(lookImgPath("https://elsewhere.example/renders/x.webp"), "/renders/x.webp");
  assert.equal(lookImgPath("/renders/a.png?v=3"), "/renders/a.png");
  for (const bad of ["https://elsewhere.example/steal.jpg", "/avatars/omar_0.jpg", "/renders/../secrets.jpg", "/renders/a/b.jpg", "/renders/x.svg", "", null, 7]) assert.equal(lookImgPath(bad), "", String(bad));
  // the outfit's words, tidied; and the short name it goes by on a card
  assert.equal(lookDesc("  a red   sequin\nevening dress "), "a red sequin evening dress");
  assert.equal(lookDesc("x".repeat(300)).length, 160);
  assert.equal(lookLabel("a red sequin evening dress"), "Red sequin evening dress");
  assert.equal(lookLabel("an edgy black leather jacket look"), "Edgy black leather jacket look");
  assert.ok(lookLabel("a very long description of an outfit that goes on and on and on").length <= 34);
  assert.equal(lookLabel(""), "");
  assert.ok(LOOKS_PER_AVATAR >= 12);

  // the table, and the two ways a look gets there
  const schema = read("prisma", "schema.prisma");
  assert.match(schema, /model AvatarLook \{[\s\S]*?avatarKey String[\s\S]*?@@unique\(\[shopId, avatarKey, desc\]\)[\s\S]*?\}/);
  assert.ok(schema.includes("avatarLooks        AvatarLook[]"));
  const srv = read("app", "lib", "avatar-looks.server.ts");
  assert.ok(srv.includes("if (!shopId || !avatarKey || !d || !path) return false;"), "nothing is kept that is not a presenter, an outfit and a picture of ours");
  assert.ok(srv.includes("where: { shopId_avatarKey_desc: { shopId, avatarKey, desc: d } },"), "the same outfit made again replaces its picture");
  const ui = read("app", "routes", "web.film.tsx");
  // 1) made now: the request says who it is for, and the server keeps it on them
  assert.ok(ui.includes("const rosterIdOf = (img: string): string => d.roster.find((r) => r.img === img)?.id || \"\";"));
  assert.equal(ui.split("outfitAvatarId: rosterIdOf(img) }, { method: \"post\" });").length - 1, 2, "from the wardrobe row and from a scene");
  assert.ok(ui.includes("if (outfitAvatarId) { const { saveAvatarLook } = await import(\"../lib/avatar-looks.server\"); await saveAvatarLook(shop.id, outfitAvatarId, desc, img); }"));
  // 2) made before looks were kept: this browser hands its own over, once
  assert.ok(ui.includes("if (adopt.length) lookSyncFetcher.submit({ intent: \"adoptOutfitLooks\", looks: JSON.stringify(adopt.slice(0, 40)) }, { method: \"post\" });"));
  assert.ok(ui.includes("if (await saveAvatarLook(shop.id, o.avatarId, o.desc, o.img)) kept++;"));
  // saved looks come back to the wardrobe on any device
  assert.ok(ui.includes("const savedLooks = await avatarLooksFor(shop.id);") && ui.includes("const kept = (d.savedLooks || {})[r.id] || [];"));

  // THE PRESENTERS SECTION: the looks stand after the outfits they came with, on the card and inside it
  const pres = read("app", "routes", "web.presenters.tsx");
  assert.ok(pres.includes("const extraLooks = (id: string): Look[] => (savedLooks[id] || []).map((l) => ({ label: lookLabel(l.desc) || \"Look\", img: l.img, cut: null, spin: null, spinState: \"none\" as const, extra: true, made: l.desc }));"));
  assert.ok(pres.includes("looks: [...looks, ...extraLooks(c.id)],") && pres.includes("looks: [...looks, ...extraLooks(a.id)],"));
  assert.ok(pres.includes("{c.looks.some((l) => l.extra) && <span className=\"ph-lk\""), "said on the card in the grid");
  // a saved look is a portrait: no 3D view is offered for it, nor counted as missing
  assert.ok(pres.includes("c.looks.filter((l) => !l.extra && !l.spin && l.spinState !== \"building\").length"));
  assert.equal(pres.split("{c.custom && cur && !cur.extra && !cur.spin && cur.spinState").length - 1, 2);
  // its name is the outfit's own words — never run through the translator as if it were a label of ours
  assert.ok(pres.includes("<span className=\"pc-look-nm\">{l.extra ? l.label : t(l.label)}</span>"));
});

test("the music video's setup ends in ONE button: it makes the scenes, then it renders them", () => {
  // (seen in the pane, 2026-11-22: a dashed "Make the scenes — free", a disabled "Make the scenes first ↑"
  //  under it, and a note saying the same again — three things for one step)
  const ui = read("app", "routes", "web.film.tsx");
  assert.ok(!ui.includes("t(\"Make the scenes first"), "no button that only points at another button");
  assert.ok(!ui.includes("Script out your scenes first"));
  const card = ui.slice(ui.indexOf("<div className=\"mm-gen mm-makegen\">"), ui.indexOf("{actionData?.ok && <p className=\"fs-ok\">"));
  // before there is a storyboard the big button MAKES it…
  assert.ok(card.includes("<button type=\"button\" className=\"mm-go\" onClick={makeStoryboard} disabled={writing || seedBusy || chainToScenes || !d.hasPlan}>"));
  assert.ok(card.includes(": <><Ico n=\"wand\" size={17} /> {t(\"Make the scenes — free\")}</>}"));
  // …and once there is one it renders it, with "Start over" as the small button
  assert.ok(card.includes("<button type=\"submit\" className={`mm-go${alreadySent ? \" is-sent\" : \"\"}`} disabled={!canGo || alreadySent}>"));
  assert.ok(card.includes("{seeds ? makeBtn() : (<>"));
  assert.equal((card.split("className=\"mm-go\"").length - 1) + (card.split("className={`mm-go${").length - 1), 2, "one or the other, never both");
  assert.ok(card.includes("{t(\"Free — you see and edit every scene before anything is rendered.\")}"));
});

test("who sings a scene is picked on that person's own row — staged, like everything else in the editor", () => {
  // Seen on the live site at phone width, 2026-11-22: a row of "Who sings this scene?" pills listed the
  // same people as the rows under it, and it was the one control in the editor that acted AT ONCE — it
  // drew the scene again and closed the editor, throwing away an outfit picked in it a moment before.
  const ui = read("app", "routes", "web.film.tsx");
  assert.ok(!ui.includes("mm-sc-singer") && !ui.includes("t(\"Who sings this scene?\")"), "no second list of the same people");
  const castEditor = ui.slice(ui.indexOf("<div className=\"mm-sc-castedit\">"), ui.indexOf("{seeds && scenePropPick === i && ("));
  // the mic is on the row: a tag on whoever sings it, a button on anyone it can be handed to
  assert.ok(castEditor.includes("<span className=\"mm-sw-tag\"><Ico n=\"mic\" size={10} /> {t(\"Sings this scene\")}</span>"));
  assert.ok(castEditor.includes("className=\"mm-sw-mic\" aria-pressed={false} onClick={() => stageSceneSinger(i, micName)}"));
  // a co-star who has the scene can hand it back to the star, and so can the star standing beside them
  assert.equal(castEditor.split("onClick={() => stageSceneSinger(i, \"\")}").length - 1, 2);
  // only in a performance, and only when a co-star has a voice of their own
  assert.ok(ui.includes("const canPickSinger = isMv && perform && singable.length > 0;"));
  // a scene is given by NAME, so the mic is offered only to someone their name leads back to
  assert.ok(ui.includes("return m && castExtra[singerOf({ singer: name }, castNamesAll)]?.img === img ? name : \"\";"));
  // STAGED: tapping a mic changes the editor's draft and nothing else…
  const stage = ui.slice(ui.indexOf("const stageSceneSinger"), ui.indexOf("const micNameOf"));
  assert.ok(stage.includes("setSceneSingerDraft(name);"));
  assert.ok(stage.includes("setSceneCastDraft(costarsByDefault(sungBy(seeds.treatment.scenes[i], name), i, seeds.treatment.scenes.length));"), "a verse of one's own is a shot of one's own until people are added");
  assert.ok(!stage.includes("rerollScene(") && !stage.includes("setSeeds(") && !stage.includes("setSceneCastPick("), "nothing is drawn, written or closed");
  // …the editor shows who leads AS STAGED…
  assert.ok(ui.includes("const draftLead = isMv && sceneCastPick === i ? sceneLeadImg(draftScene(strip.scenes, i), i, strip.scenes.length) : leadImg;"));
  assert.ok(ui.includes("const lead = sceneLeadImg(draftScene(scenesArr, i), i, scenesArr.length) || artistPick;"));
  // …opening it loads who sings the scene now…
  assert.ok(ui.includes("setSceneSingerDraft(seeds ? sceneSingerName(seeds.treatment.scenes[i], i, seeds.treatment.scenes.length) : \"\");"));
  // …and the ONE button writes the new singer into the scene and draws it once, with the outfits kept
  const confirm = ui.slice(ui.indexOf("const confirmSceneCastMv"), ui.indexOf("// ---- Wardrobe (owner edit)"));
  assert.ok(confirm.includes("const newSinger = singer !== sceneSingerName(scenesArr[i], i, scenesArr.length);"));
  assert.ok(confirm.includes("if (newSinger) setSeeds((prev) => (prev ? { ...prev, treatment: { ...prev.treatment, scenes: prev.treatment.scenes.map((s, j) => (j === i ? sungBy(s, singer) : s)) } } : prev));"));
  assert.ok(ui.includes("const sungBy = (s: Scene, name: string): Scene => { const { singer: _drop, ...rest } = s; return name ? { ...rest, singer: name } : rest; };"));
});

test("a full scene says it is full — a third face is never let in by pushing somebody out", () => {
  // (seen on the live site, 2026-11-22: with the star and two co-stars in a scene, tapping "+" on another
  //  face silently dropped the first co-star)
  const ui = read("app", "routes", "web.film.tsx");
  assert.ok(ui.includes("prev.includes(img) ? prev.filter((x) => x !== img) : prev.length >= MAX_COSTARS ? prev : [...prev, img]"));
  assert.ok(!ui.includes("[...prev, img].slice(-2)"));
  const toggle = (prev: string[], img: string): string[] => (prev.includes(img) ? prev.filter((x) => x !== img) : prev.length >= MAX_COSTARS ? prev : [...prev, img]);
  assert.deepEqual(toggle(["a", "b"], "c"), ["a", "b"], "full: nobody is pushed out");
  assert.deepEqual(toggle(["a", "b"], "a"), ["b"]);
  assert.deepEqual(toggle(["b"], "c"), ["b", "c"]);
  const castEditor = ui.slice(ui.indexOf("<div className=\"mm-sc-castedit\">"), ui.indexOf("{seeds && scenePropPick === i && ("));
  assert.ok(castEditor.includes("{sceneCastDraft.length >= MAX_COSTARS ? ("));
  assert.ok(castEditor.includes("<div className=\"mm-sw-add mm-sw-full\"><div className=\"mm-cp-hint\">{t(\"This scene is full. Take someone out to add another.\")}</div></div>"));
  // a face from the roster JOINS the cast, so it is offered only while the cast has room for it
  assert.ok(castEditor.includes("{(castExtra.length < MAX_COSTARS ? [...customArtists.map((c) => ({ img: c.img, name: c.name })), ...mvRoster.map((r) => ({ img: r.img, name: r.name }))] : [])"));
  // (who the music video offers: people — and, on the owner's account while it is being tried, monsters)
  assert.ok(ui.includes("const mvRoster = d.mvCreatures ? d.roster.filter((r) => r.kind === \"person\" || r.kind === \"monster\") : people;"));
  assert.ok(ui.includes("mvCreatures: isAdminEmail(account.email),"));
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Sings this scene", "Sing this scene", "Give this scene back to {name}", "This scene is full. Take someone out to add another."]) {
    assert.equal(dict.split(`\n  ${JSON.stringify(k)}:`).length - 1, 5, k);
  }
});

test("once the scenes are drawn, another shape is asked for twice — it draws them all again", () => {
  // Seen on the live site, 2026-11-22: the Shape buttons sit right above "Render these scenes", and one tap
  // on another shape wiped the storyboard and every edit made on it (words, cast, outfits, props,
  // re-rolls) without a word — the pictures are drawn IN a shape.
  const ui = read("app", "routes", "web.film.tsx");
  assert.ok(ui.includes("artistPick, mvAspect, featKey, JSON.stringify(outfits)]"), "a new shape does start the storyboard over");
  const pick = ui.slice(ui.indexOf("const pickMvAspect"), ui.indexOf("const pickMvAspect") + 260);
  assert.ok(pick.includes("if (a === mvAspect) { setShapeArm(\"\"); return; }"));
  assert.ok(pick.includes("if (seedsDrawn && shapeArm !== a) { setShapeArm(a); return; }"), "with scenes drawn the first tap only asks");
  assert.ok(pick.includes("setMvAspect(a);"));
  assert.ok(ui.includes("const seedsDrawn = !!seeds;") && ui.includes("useEffect(() => { setShapeArm(\"\"); }, [seedsDrawn, mvAspect]);"));
  // the buttons go through it — nothing sets the shape directly any more
  assert.equal(ui.split("setMvAspect(").length - 1, 2, "only inside pickMvAspect — and where a kept video is put back with its own shape (tests/mv-draft.test.ts)");
  assert.ok(ui.includes("setMvAspect(k.aspect);"));
  assert.ok(ui.includes("onClick={() => pickMvAspect(a)}>{shapeArm === a ? t(\"Tap again to redraw\") : t(name)}<small>{a}</small></button>"));
  assert.ok(ui.includes("{shapeArm && <p className=\"mm-note mm-shape-warn\" role=\"status\">{t(\"A new shape draws every scene again, and your scene edits start over.\")}</p>}"));
  // the same rule, run: no scenes yet → one tap; scenes drawn → the second tap
  const run = (drawn: boolean, taps: string[]) => {
    let shape = "9:16", arm = "";
    for (const a of taps) { if (a === shape) { arm = ""; continue; } if (drawn && arm !== a) { arm = a; continue; } shape = a; arm = ""; }
    return { shape, arm };
  };
  assert.deepEqual(run(false, ["16:9"]), { shape: "16:9", arm: "" });
  assert.deepEqual(run(true, ["16:9"]), { shape: "9:16", arm: "16:9" });
  assert.deepEqual(run(true, ["16:9", "16:9"]), { shape: "16:9", arm: "" });
  assert.deepEqual(run(true, ["16:9", "1:1"]), { shape: "9:16", arm: "1:1" }, "asking for a different one starts the asking over");
  assert.deepEqual(run(true, ["16:9", "9:16"]), { shape: "9:16", arm: "" }, "tapping the shape it already has backs out");
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Tap again to redraw", "A new shape draws every scene again, and your scene edits start over."]) {
    assert.equal(dict.split(`\n  ${JSON.stringify(k)}:`).length - 1, 5, k);
  }
});

import { CUT_SCENE_DRESSED, CUT_SCENE_SETTING_MIN, redressedIn } from "../app/lib/mv-cast.ts";
import { rideFrame } from "../app/lib/mv-sense.ts";

test("the locked wardrobe is LOOKED AT: a still that re-dresses someone is made again", () => {
  // The live render of 2026-11-22: scenes 3 and 5 (the star and a co-star, a cut scene each) kept the navy
  // suit and the green velvet suit; scene 6 — the same two, from the same styled pictures — came back with
  // him in a patterned bomber and jeans and her in a sequin dress and a white coat. The check read hair
  // and faces, said both were there, and the scene was rendered: five seconds of a thirty-second video.
  const q = castCheckPrompt({ refs: 2 });
  // TWO THINGS WERE LEARNED on that storyboard's own stills, with the real reader (the admin's
  // `readCastStill`, below):
  //  1. asked only whether they were dressed the same, it answered YES to the re-dressed scene. Made to
  //     WRITE DOWN the garments first — in each person's own picture, and in the frame — it read
  //     ["floral bomber jacket, black t-shirt, dark jeans", "sequined mini dress, cream blazer coat"] and
  //     answered [false, false], twice in two; the three good scenes passed, the three-person one included.
  assert.match(q, /For each of the two people, in order: first name, in a few words, the main garments they wear in THEIR OWN image, and the main garments the matching person wears in the frame\. Then say whether it is the SAME OUTFIT\./);
  assert.match(q, /"twin": true \| false, "wearsInImage": \["<few words>", "<few words>"\], "wearsInFrame": \["<few words>", "<few words>"\], "dressed": \[true \| false, true \| false\]/);
  assert.ok(q.indexOf("\"wearsInFrame\"") < q.indexOf("\"dressed\""), "the garments are written before the answer");
  //  2. it is about the KIND of garment, not its colour: asked about "the same colours", a stand-in reader
  //     called a green velvet suit wrong because blue light made it look teal — and a false alarm redraws
  //     a good picture and flags it.
  assert.match(q, /Judge the KIND of garments, not their colour — coloured light, shadow and distance change how a colour looks\./);
  assert.match(q, /It is NOT the same outfit when a garment is plainly a different kind \(a bomber or casual jacket where their image has a tailored suit jacket; a dress or skirt where it has trousers; jeans where it has suit trousers\) or something big has been added or taken away \(a coat, a hat\)\./);
  assert.match(q, /If they are too small, too far away or too hidden to tell, or not in the frame, answer true\./);
  assert.doesNotMatch(q, /same colours/);
  // what it wrote is kept with the reading (the card can say what was wrong), tidied and bounded
  const real = parseCastCheck('```json {"people": 2, "seen": [true, true], "twin": false, "wearsInImage": ["dark suit jacket, white shirt, dark trousers", "dark green velvet double-breasted blazer, dark green trousers"], "wearsInFrame": ["floral bomber jacket, black t-shirt, dark jeans", "sequined mini dress, cream blazer coat"], "dressed": [false, false], "mic": "none", "odd": false} ```');
  assert.deepEqual(real?.dressed, [false, false]);
  assert.deepEqual(real?.wearsInFrame, ["floral bomber jacket, black t-shirt, dark jeans", "sequined mini dress, cream blazer coat"]);
  assert.equal(real?.wearsInImage?.length, 2);
  assert.equal(parseCastCheck(`{"people": 1, "mic": "none", "wearsInFrame": ["${"x".repeat(400)}"]}`)?.wearsInFrame?.[0].length, 90);
  assert.equal(parseCastCheck('{"people": 1, "mic": "none", "wearsInFrame": "a suit"}')?.wearsInFrame, undefined);
  assert.doesNotMatch(castCheckPrompt(), /dressed/i, "nobody to compare with: nothing asked");
  // read like the other answers: a list of yes/no, or left out
  assert.deepEqual(parseCastCheck('{"people": 2, "seen": [true, true], "twin": false, "dressed": [false, false], "mic": "none", "odd": false}'), { people: 2, mic: "none", seen: [true, true], twin: false, dressed: [false, false], odd: false });
  assert.deepEqual(parseCastCheck('{"people": 2, "seen": [true, true], "dressed": "mostly", "mic": "none"}'), { people: 2, mic: "none", seen: [true, true] });
  // THE SCENE: both there, each once, nothing odd, no microphone — and both in the wrong clothes
  const riverside = { people: 2, mic: "none" as const, seen: [true, true], twin: false, dressed: [false, false], odd: false };
  assert.deepEqual(redressedIn(riverside), [0, 1]);
  assert.equal(castFaults(riverside, 2, false, false), 4, "it is a fault now — the still is made again");
  assert.equal(castFaults({ ...riverside, dressed: [true, true] }, 2, false, false), 0);
  assert.equal(castFaults({ ...riverside, dressed: [true, false] }, 2, false, false), 2);
  // the redraw is told what was wrong, and whose
  assert.match(castFix(riverside, 2, false, false), /The person in the 1st and 2nd reference image is in the WRONG CLOTHES — dress them EXACTLY as in their reference image: the same garments, the same colours, nothing added/);
  assert.match(castFix({ ...riverside, dressed: [true, false] }, 2, false, false), /The person in the 2nd reference image is in the WRONG CLOTHES/);
  assert.equal(castFix({ ...riverside, dressed: [true, true] }, 2, false, false), "");
  // someone who is MISSING is not also "in the wrong clothes"
  const gone = { people: 1, mic: "none" as const, seen: [true, false], twin: false, dressed: [true, false] };
  assert.deepEqual(redressedIn(gone), []);
  assert.equal(castFaults(gone, 2, false, false), castFaults({ ...gone, dressed: [true, true] }, 2, false, false));
  // a wide shot where the people are too small to count is not judged on their clothes either
  assert.equal(castFaults(riverside, null, false, false), 0);
  assert.equal(castFix(riverside, null, false, false), "");
  // a missing person is still the worse fault
  assert.ok(castFaults({ people: 1, mic: "none", seen: [true, false] }, 2, false, false) > castFaults({ ...riverside, dressed: [true, false] }, 2, false, false));

  // THE PROMPT says it plainly in a cut scene, wherever the setting keeps room to be read…
  const visual = "OMAR and VALENTINA walk together along a glowing riverside promenade, leaning on the railing, taking in the skyline";
  const cut = castStillPrompt({ genre: "Pop / Dance / EDM", role: "broll", frame: "Wide lifestyle shot, both of them full length", visual, costars: 1, micOk: false });
  assert.ok(cut.includes(CUT_SCENE_DRESSED) && cut.includes(visual) && cut.length <= CAST_PROMPT_MAX);
  // …and keeps the short form where the plain one would cut the setting to a stub (a ride is framed in many words)
  const ride = castStillPrompt({ genre: "Pop / Dance / EDM", role: "broll", frame: rideFrame({ costars: 1, performing: false }), visual: LONG, costars: 1, micOk: false, extra: "Everyone does something a real person could really be filmed doing there; people in a vehicle sit in its seats" });
  assert.ok(!ride.includes(CUT_SCENE_DRESSED) && ride.includes("each with their own face, hair and clothes"), "the short form where the plain one would leave the setting too little room");
  const setting = ride.slice(ride.indexOf(" Setting: ") + 10).split(". Everyone does")[0];
  assert.ok(setting.length >= 60 && LONG.startsWith(setting), `the setting is still read (${setting.length} characters)`);
  assert.ok(CUT_SCENE_SETTING_MIN >= 120, "the plain form is only said where a setting can still be read whole");
  // the pipeline records what the check read about clothes
  assert.ok(read("app", "lib", "music-video-pipeline.server.ts").includes("dressed=${JSON.stringify(seen.dressed || null)}"));
  // and the card's flag names it among the things a re-roll is for
  assert.ok(read("app", "routes", "web.film.tsx").includes("t(\"We checked this picture and something looks off — someone missing or doubled, the wrong clothes, or a stray microphone. Tap to draw it again.\")"));
});

test("the cast check can be asked by hand — by an admin, about our own pictures only", () => {
  // (so a flag can be explained, and a change to the question tried on real stills with the real reader
  //  before it ships — the clothes question was first tried on a stand-in)
  const ui = read("app", "routes", "web.film.tsx");
  const act = ui.slice(ui.indexOf("if (intent === \"readCastStill\") {"), ui.indexOf("if (!shop.activePlan?.active) return json({ error: tr(lang, \"Pick a plan on the Dashboard first"));
  assert.ok(act.length > 200 && act.length < 2600);
  // admin only, and it says nothing to anyone else
  assert.ok(act.includes("if (!isAdminEmail(account.email)) return json({ error: \"Not found\" }, { status: 404 });"));
  assert.ok(act.indexOf("isAdminEmail(account.email)") < act.indexOf("readCastStillByHand"), "the gate comes first");
  // only pictures on our own render disk or among the built-in avatars, whatever host an address names
  const ours = /^\/(?:renders|avatars)\/[\w.-]+\.(?:jpe?g|png|webp)$/i;
  assert.ok(act.includes(`return ${String(ours)}.test(p) ? p : null;`));
  const pathOf = (v: string) => new URL(v.trim(), "https://site.invalid").pathname;
  for (const good of ["/renders/img-1795333801456-417a5a1f929984e990.jpg", "https://easymodeapp.com/avatars/omar_0.jpg", "https://elsewhere.example/renders/x.webp"]) assert.ok(ours.test(pathOf(good)), good);
  for (const bad of ["https://elsewhere.example/steal.jpg", "/renders/../secrets.jpg", "/renders/a/b.jpg", "/uploads/x.jpg", "/renders/x.svg", "file:///etc/passwd"]) assert.ok(!ours.test(pathOf(bad)), bad);
  assert.ok(act.includes(".slice(0, 3)"), "three reference pictures at most, as in the storyboard's own check");
  // the same reader, the same question unless another is given to try
  const lib = read("app", "lib", "music-video-pipeline.server.ts");
  const fn = lib.slice(lib.indexOf("export async function readCastStillByHand"), lib.indexOf("/** A cast still and how it fared when it was looked at"));
  assert.ok(fn.includes("castCheckPrompt({ refs: refs.length, prop: o.prop })"));
  assert.ok(fn.includes("anthropicVision(question, [abs(o.img), ...refs], { maxTokens: CAST_CHECK_TOKENS, model: \"claude-sonnet-4-6\" })"));
  assert.ok(lib.includes("anthropicVision(castCheckPrompt({ refs: refs.length, prop }), [imgUrl, ...refs], { maxTokens: CAST_CHECK_TOKENS, model: \"claude-sonnet-4-6\" })"), "…which is what the storyboard's own check does");
  // room to think: at 450 one answer in three about the re-dressed scene ran out before its JSON
  assert.ok(lib.includes("const CAST_CHECK_TOKENS = 1000;"));
});

test("the Render button says it worked — and the same storyboard is not sent twice", () => {
  // Seen on the live site, 2026-11-22: "Render these scenes" went straight back to itself, live, the moment
  // the render was queued. The only sign was a line under it, and a second tap queued the same video again.
  const ui = read("app", "routes", "web.film.tsx");
  // what was sent is remembered when the server says yes…
  assert.ok(ui.includes("const renderSig = seeds ? JSON.stringify([seeds.imgs, seeds.treatment, mvAspect, mvLyrics, mvPace]) : \"\";"));
  assert.ok(ui.includes("<Form method=\"post\" onSubmit={() => { sigAtSubmit.current = renderSig; }}>"));
  assert.ok(ui.includes("useEffect(() => { if (actionData?.ok && sigAtSubmit.current) setSentSig(sigAtSubmit.current); }, [actionData]);"));
  // …and the button stays "Rendering" for exactly that storyboard: change anything and it is live again
  assert.ok(ui.includes("const alreadySent = !!renderSig && sentSig === renderSig;"));
  assert.ok(ui.includes("<button type=\"submit\" className={`mm-go${alreadySent ? \" is-sent\" : \"\"}`} disabled={!canGo || alreadySent}>"));
  assert.ok(ui.includes(": alreadySent ? <><Ico n=\"check\" size={17} /> {t(\"Rendering — it lands in your Archive\")}</>"));
  // the same rule, run
  const sent = (sig: string, sentSig: string) => !!sig && sentSig === sig;
  assert.equal(sent("a", ""), false, "nothing sent yet");
  assert.equal(sent("a", "a"), true, "this storyboard is rendering");
  assert.equal(sent("b", "a"), false, "a re-rolled scene makes it a different video");
  assert.equal(sent("", ""), false, "no storyboard, nothing to say");
  // the line under it names the tab the video lands in, and does not promise "a few minutes"
  assert.ok(!ui.includes("land in your Gallery"), "the tab is called Archive");
  assert.ok(ui.includes("t(\"Rolling! Your video is rendering — it'll land in your Archive when it's done. You can keep working.\")"));
  assert.ok(ui.includes("t(\"Rolling! Your film is rendering — it'll land in your Archive when it's done. You can keep working.\")"));
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Rendering — it lands in your Archive", "Rolling! Your video is rendering — it'll land in your Archive when it's done. You can keep working.", "Rolling! Your film is rendering — it'll land in your Archive when it's done. You can keep working."]) {
    assert.equal(dict.split(`\n  ${JSON.stringify(k)}:`).length - 1, 5, k);
  }
});

test("the storyboard on a phone: the note names the real button, the edit buttons line up, faces not name stacks", () => {
  // (looked at on the live site at 390 px, 2026-11-22)
  const ui = read("app", "routes", "web.film.tsx");
  // the note above it ended "Happy with it? Hit Generate." — the button says "Render these scenes"
  assert.ok(!ui.includes("Hit Generate."));
  assert.ok(ui.includes("t(\"Here's your video, shot by shot. Tap any line to change it. A green Performance is sung to camera; a purple Cut scene breaks to props or scenery with no singing (tap the pill to switch).\")"));
  // the people and the two edit buttons sit at the bottom of every card, in line across a row
  assert.ok(ui.includes(".mm-sb-list.is-mv .mm-sc-bd{flex:1 1 auto;}") && ui.includes(".mm-sb-list.is-mv .mm-sc-chips{margin-top:auto;padding-top:2px;}"));
  // whoever leads keeps their name; on a phone the people beside them are their faces — the name is
  // still in the page for a screen reader (clipped, not removed)
  assert.ok(ui.includes("<span className=\"mm-sc-chip mm-chip-av\" key={img} title={castMemberName(img) || t(\"Cast\")}><img src={sceneFace(i, img)} alt=\"\" /><span className=\"mm-chip-nm\">{castMemberName(img) || t(\"Cast\")}</span></span>"));
  const phone = ui.slice(ui.indexOf("@media(max-width:639px){\n  .mm-sb-list.is-mv .mm-chip-av:not(.mm-chip-lead)"));
  assert.ok(phone.startsWith("@media(max-width:639px){"));
  assert.ok(phone.slice(0, 420).includes(".mm-chip-av:not(.mm-chip-lead) .mm-chip-nm{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}"));
  assert.ok(!phone.slice(0, 420).includes("display:none"));
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  const k = "Here's your video, shot by shot. Tap any line to change it. A green Performance is sung to camera; a purple Cut scene breaks to props or scenery with no singing (tap the pill to switch).";
  assert.equal(dict.split(`\n  ${JSON.stringify(k)}:`).length - 1, 5);
});
