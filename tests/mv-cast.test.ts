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
  assert.match(cut, /each doing what the setting describes, each with their own face, hair and clothes/);
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
  assert.match(img, /export async function editSubjectIntoScene\(subjectUrl: string, prompt: string, maxPrompt = 480\)/);
  assert.ok(CAST_PROMPT_MAX <= 900 && SOLO_EDIT_MAX <= 900, "both callers ask for no more than the picture calls allow");

  // the builder shows the same default the render uses
  const ui = read("app", "routes", "web.film.tsx");
  assert.match(ui, /import \{ sceneCast, singerOf \} from "\.\.\/lib\/mv-cast"/);
  assert.match(ui, /sceneCast\(\{ scene: scenesArr\[i\], role, slot: shotSlot\(role, i\), names: castNamesAll \}\)/);
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
  assert.match(castStillPrompt({ genre: "Pop", role: "broll", frame: "a wide shot", visual: "A rooftop at night", costars: 1, micOk: false }), /each with their own face, hair and clothes\. /);
  assert.match(soloStillPrompt({ genre: "Pop", role: "broll", frame: "a wide shot", visual: "A street at night", micOk: false }), /the artist \(the person in the reference image, dressed exactly as in it\)/);
  assert.match(soloEditPrompt({ role: "perform", frame: "a medium shot", visual: "A street at night", micOk: false }), /same face, hair, skin, build, wardrobe and jewelry/);

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

test("one scene can break from the locked wardrobe — picked on the storyboard, before the render", () => {
  // The owner, 2026-11-22: "need to make per scene outfit editable on the seed revision system before
  // final video generate cta".
  const ui = read("app", "routes", "web.film.tsx");
  // scene → person → what they wear THERE ("" = their own look); no entry = their look for the video
  assert.ok(ui.includes("const [sceneOutfits, setSceneOutfits] = useState<Record<number, Record<string, string>>>({});"));
  // a scene is drawn from the picture of what each person wears IN IT
  assert.ok(ui.includes("if (w === undefined) return videoRef;") && ui.includes("if (w === \"\") return img;") && ui.includes("return styleFor(img, w) || videoRef;"));
  assert.ok(ui.includes("const sceneCastRefs = costarImgs.map((img) => sceneRefOf(i, img, img === artistPick ? seeds.artistRef : costarImgToRef(img), wearOverride)).filter(Boolean) as string[];"));
  assert.ok(ui.includes("const sceneArtistRef = artistPick ? sceneRefOf(i, artistPick, seeds.artistRef, wearOverride) : seeds.artistRef;"));
  assert.ok(ui.includes("const leadRef = leadImg ? sceneRefOf(i, leadImg, costarImgToRef(leadImg), wearOverride) : null;"));
  assert.ok(ui.includes("artistRef: sceneArtistRef || \"\","));
  // staged, then drawn on an explicit button — like the scene's cast and its props
  const confirm = ui.slice(ui.indexOf("const confirmSceneWear"), ui.indexOf("const makeSceneOutfit"));
  assert.ok(confirm.includes("rerollScene(i, undefined, undefined, undefined, draft);"));
  assert.ok(confirm.includes("if (Object.keys(draft).length) n[i] = draft; else delete n[i];"), "back to the video look = no entry");
  // a NEW outfit made from a scene is saved beside their looks — it does not become the video's look
  const make = ui.slice(ui.indexOf("const makeSceneOutfit"), ui.indexOf("const reindexWear"));
  assert.ok(make.includes("outfitFetcher.submit({ intent: \"styleOutfit\", outfitImg: img, outfitDesc: dsc }, { method: \"post\" });"));
  assert.ok(!make.includes("setOutfits("));
  assert.ok(ui.includes("if (r.img && sceneWearPick !== null) setSceneWearDraft((dd) => ({ ...dd, [img]: desc }));"), "…and is picked for that scene once it exists");
  // changing a look for the VIDEO redraws the storyboard: the wardrobe is locked, so stills drawn in the
  // old look would be rendered in it
  assert.ok(ui.includes("mvAspect, featKey, JSON.stringify(outfits)]);"));
  assert.ok(ui.includes("setSeeds(null); setCastForScene({}); setSceneCastPick(null); setSceneOutfits({}); setSceneWearPick(null); }"));
  // removing a scene keeps the other scenes' outfits on the right scenes
  assert.ok(ui.includes("setSceneOutfits((prev) => reindexWear(prev, i)); setSceneWearPick(null);"));
  // the card says so, its faces show the scene's look, and the panel explains what changes
  assert.ok(ui.includes("{sceneWearChanged(i) ? t(\"Outfit changed\") : t(\"Wardrobe\")}"));
  assert.ok(ui.includes("<img src={sceneFace(i, img)} alt=\"\" />"));
  assert.ok(ui.includes("{t(\"Only this scene changes. Everywhere else they keep the look you picked.\")}"));
  // the re-roll's pictures are read by the pipeline as it reads any reference (a site path is made whole)
  const pipe = read("app", "lib", "music-video-pipeline.server.ts");
  const reroll = pipe.slice(pipe.indexOf("export async function rerollMusicVideoScene"));
  assert.ok(reroll.includes("const abs = (u: string | null | undefined): string | null => (u ? (u.startsWith(\"http\") ? u : `${base}${u}`) : null);"));
  // every new line is in all five languages
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Wardrobe", "Outfit changed", "Video look", "What they wear in this scene", "What {name} wears in this scene", "An outfit just for this scene — a white tux, a red dress…", "Only this scene changes. Everywhere else they keep the look you picked.", "The look you pick is what they wear in every scene."]) {
    assert.equal(dict.split(`\n  ${JSON.stringify(k)}:`).length - 1, 5, k);
  }
});
