/* Does a music-video shot make physical sense?
 *
 * The owner, on the first featured-verse video (2026-11-22): "hyper unrealistic (walking in place in car,
 * car looking ai slop) aside from that it's good avatar quality and vocals, not getting a MUSIC VIDEO-esque
 * vibe but we are close".
 *
 * Looked at frame by frame, that video's three car shots were a third of its length:
 *   - two of the cast standing up in the back of a moving convertible, stepping on the spot;
 *   - the same shot again;
 *   - the two women in the front seats and the artist on foot behind the car, in traffic.
 * The song was about a night drive, so its cut scenes were set in a car — and the shot list then laid its
 * own action over them ("all of them dancing", "them walking through the scene together"), to the picture
 * model AND to the video model, which was told nothing else about the scene.
 *
 * These pin what was changed: the action is the scene's, a ride is filmed from inside the car, both models
 * and the writer are told the plain rule, and a picture of somebody doing the impossible is drawn again. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FILL_FRAME, RIDE_CAM, RIDE_MAX_COSTARS, SENSE_RULES, carInScene, hasBars, highScene, momentLine, rideFrame, rideScene, sameCar, senseMotion, senseStill } from "../app/lib/mv-sense.ts";
import { CAST_PROMPT_MAX, SOLO_EDIT_MAX, castCheckPrompt, castFaults, castFix, castStillPrompt, defaultCostars, parseCastCheck, sceneCast, soloEditPrompt } from "../app/lib/mv-cast.ts";
import { SHOT_NOTES } from "../app/lib/mv-pace.ts";
import { FEATURE_VOCAL_TRIM_DB } from "../app/lib/mv-feature.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");

test("a ride in a car is told apart from a scene beside one, and from traffic going by", () => {
  for (const v of [
    "OMAR drives a silver convertible down a neon avenue, KEIKO and VALENTINA laughing in the back seat",
    "Cruising through downtown in a vintage Cadillac with the top down, city lights streaking past",
    "The artist behind the wheel, streetlights sliding across the windshield",
    "Three friends riding in a convertible through the city at night",
    "In the back of a taxi, rain on the windows, neon smearing past",
    "A late night drive through the city, windows down, her hand out in the wind",
    "MARQUIS in the passenger seat watching the skyline go by",
    "Inside a black SUV, the dashboard glowing blue on his face",
    "Driving slow down an empty boulevard under the streetlights",
    "Cruising down the strip in a matte black car, palm trees sliding past",
    "KEIKO and OMAR in the front seat, the city blurring by, both singing along",
    "He drives, one hand on the wheel, her head on his shoulder",
  ]) assert.equal(rideScene(v), true, v);
  for (const v of [
    "OMAR leans against a parked black Mustang under the bridge, neon on the wet ground",
    "The three of them dancing in front of the car's headlights in an empty parking garage",
    "Sitting on the hood of a lowrider at sunset, the city below",
    "She steps out of a limo onto the red carpet, cameras flashing",
    "On a rooftop ledge, the traffic streaming by on the highway far below",
    "A rain-slicked rooftop at blue hour, neon signs bleeding pink and teal",
    "Standing beside a vintage convertible in a desert gas station",
    "A recording booth, warm lamp light",
    "Walking down a neon-lit street at night",
    // other people's cars are not the cast's ride
    "The night city from a rooftop, cars driving through the streets below",
    "He stands on the corner as a car drives by behind him",
    "A crosswalk at midnight, taxis cruising past, neon overhead",
    "Caught in the glow of the car's headlights, she turns to the camera",
    "Dancing in the headlights of a vintage truck in an empty lot",
    "",
  ]) assert.equal(rideScene(v), false, v);
  assert.equal(rideScene(null), false);
  assert.equal(rideScene(undefined), false);
  // a car in the scene, ridden or not
  assert.equal(carInScene("OMAR leans against a parked black Mustang under the bridge"), true);
  assert.equal(carInScene("Cruising through downtown with the top down"), true);
  assert.equal(carInScene("A rooftop at sunset"), false);
  assert.equal(carInScene("A carnival at night, the carousel turning"), false, "a word that only starts with 'car'");
});

test("a ride is framed from inside the car, everyone in a seat — and the bonnet stays out of the shot", () => {
  for (const costars of [0, 1, 2]) for (const performing of [true, false]) {
    const f = rideFrame({ costars, performing });
    assert.match(f, /INTERIOR car shot|from the PASSENGER SEAT of the car/, `${costars}/${performing}`);
    assert.match(f, /seat/);
    assert.match(f, /bonnet/);
    assert.equal(/facing the camera/.test(f), performing, "only a singer faces the camera");
    assert.doesNotMatch(f, /danc|walk|stand/i);
    // a car interior is a wide picture: asked for upright it came back with black bars three times in twelve
    assert.ok(f.endsWith(FILL_FRAME), "told to fill the frame");
  }
  // with co-stars it is said as where the CAMERA is and who is in which seat, with one steering wheel
  // (told only "shot from inside the car" the camera stood out over the bonnet, and two people drove)
  assert.match(rideFrame({ costars: 1, performing: false }), /^INTERIOR car shot, the camera on the dashboard facing back at the people in their seats: the artist driving, the other person in the passenger seat; heads and shoulders fill the frame, nobody looking at the camera\. ONE steering wheel, the artist's\. No windshield or bonnet in the shot\./);
  assert.match(rideFrame({ costars: 2, performing: false }), /one person in the passenger seat, the third in the back seat between them/);
  assert.match(rideFrame({ costars: 1, performing: true }), /the artist driving, facing the camera and singing, the other person in the passenger seat/);
  assert.match(RIDE_CAM, /handheld/);
  // the stills are told the rule in a sentence
  assert.equal(senseStill("Cruising downtown in a convertible with the top down"), "Everyone SITS — nobody stands in or on the car.");
  assert.match(senseStill("Leaning on a parked Mustang under the bridge"), /real production model with true proportions, wheels on the ground/);
  assert.equal(senseStill("An empty street at sunset"), "", "a scene with no car in it, on the ground, is told nothing extra");
  assert.match(senseStill("A rooftop at sunset"), /well back from the edge/, "up high has a rule of its own (below)");
  // …and both still fit the length the picture calls read, with (nearly) all of a 40-word setting
  const SETTING = "OMAR drives a silver 1965 convertible down a neon-lit avenue at night, KEIKO beside him, both laughing, magenta and teal signs sliding across the windshield, wet asphalt shining under the streetlights";
  assert.ok(SETTING.split(/\s+/).length >= 30);
  const cast = castStillPrompt({ genre: "Pop / Dance / EDM", role: "broll", frame: rideFrame({ costars: 1, performing: false }), visual: SETTING, costars: 1, micOk: false, extra: senseStill(SETTING).replace(/[.\s]+$/, "") });
  assert.ok(cast.length <= CAST_PROMPT_MAX, `${cast.length}`);
  const kept = cast.slice(cast.indexOf("Setting: ") + 9, cast.indexOf(". Everyone SITS"));
  assert.ok(SETTING.startsWith(kept) && kept.length >= 120, `the setting keeps at least 120 characters (${kept.length})`);
  assert.match(cast, /Everyone SITS — nobody stands in or on the car$/);
  const solo = soloEditPrompt({ role: "broll", frame: rideFrame({ costars: 0, performing: false }), visual: SETTING, micOk: false, extra: ` ${senseStill(SETTING)}` });
  assert.ok(solo.length <= SOLO_EDIT_MAX, `${solo.length}`);
  assert.ok(solo.includes(SETTING), "the whole setting is in the solo picture's prompt");
  assert.match(solo, /Everyone SITS — nobody stands in or on the car\./);
});

test("a car holds the artist and one other unless the maker asks for more", () => {
  assert.equal(RIDE_MAX_COSTARS, 1);
  const RIDE = { visual: "OMAR drives through the neon city, KEIKO and VALENTINA laughing in the back seat" };
  const names = ["KEIKO", "VALENTINA"];
  // drawn on the real picture model: the artist and one other came out right every time; three in a car
  // came back with somebody twice, or a fourth person, in four tries of six
  assert.deepEqual(defaultCostars(RIDE, "broll", 5, names), [0], "the first of the two the writer named");
  assert.deepEqual(defaultCostars(RIDE, "perform", 1, names), [0], "a performance at the wheel too");
  assert.deepEqual(defaultCostars(RIDE, "broll", 2, names), [0], "even in the dance slot");
  // on foot nothing changes: both in a performance, both where both are named
  assert.deepEqual(defaultCostars({ visual: "A rooftop at sunset" }, "perform", 1, names), [0, 1]);
  assert.deepEqual(defaultCostars({ visual: "KEIKO and VALENTINA lean on the parked car" }, "broll", 5, names), [0, 1]);
  // the maker's own pick for the scene stands
  assert.deepEqual(sceneCast({ scene: RIDE, role: "broll", slot: 5, names, listed: [0, 1] }).others, [0, 1]);
  assert.deepEqual(sceneCast({ scene: RIDE, role: "broll", slot: 5, names }).others, [0]);
});

test("a picture that comes back with black bars round it is found, and made again", () => {
  const W = 48, H = 48;
  const pic = (fn: (x: number, y: number) => number) => { const g = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = fn(x, y); return g; };
  // a wide picture in an upright frame: flat black above and below (the real ones measured 0–7 of 255)
  assert.equal(hasBars(pic((_x, y) => (y < 12 || y >= 36 ? 7 : 90)), W, H), true);
  assert.equal(hasBars(pic((_x, y) => (y < 4 || y >= 44 ? 0 : 120)), W, H), true);
  // an upright picture in a wide frame: bars either side
  assert.equal(hasBars(pic((x) => (x < 10 || x >= 38 ? 3 : 100)), W, H), true);
  // a night scene is dark at the top, but not one flat black — and not at BOTH edges
  assert.equal(hasBars(pic((x, y) => (y < 8 ? 5 + ((x * 7) % 12) : 80)), W, H), false, "a night sky with a little light in it");
  assert.equal(hasBars(pic((_x, y) => (y < 10 ? 4 : 110)), W, H), false, "black above only");
  assert.equal(hasBars(pic(() => 3), W, H), false, "a black frame is not a letterboxed picture");
  assert.equal(hasBars(pic((x, y) => 40 + ((x + y) % 60)), W, H), false);
  assert.equal(hasBars(new Uint8Array(10), W, H), false, "too little to tell");
  const pipe = read("app", "lib", "music-video-pipeline.server.ts");
  // looked at small and in grey; a check that cannot be made never costs a picture
  assert.match(pipe, /"-vf", "scale=48:48,format=gray", "-f", "rawvideo", raw\]/);
  assert.match(pipe, /return hasBars\(fs\.readFileSync\(raw\), 48, 48\);\s+\} catch \{ return false; \}/);
  // a cast still counts it with its other faults and names it to the next try…
  const still = pipe.slice(pipe.indexOf("async function castStill"), pipe.indexOf("/** Build the per-scene SEED stills"));
  assert.match(still, /\+ \(bars \? 2 : 0\);/);
  assert.match(still, /bars \? FILL_FRAME : ""/);
  // …and a still of the artist alone is made once more, then flagged for the maker (storyboard and re-roll)
  assert.equal(pipe.split("stillHasBars(again)").length - 1, 2);
  assert.match(pipe, /if \(img && !multiCast && \(await stillHasBars\(img\)\)\) \{/);
});

test("the video model is told what is happening in the scene, and what real people would do there", () => {
  assert.equal(momentLine(""), "");
  assert.equal(momentLine("OMAR leans on the car, watching the lights."), " What is happening: OMAR leans on the car, watching the lights.");
  // a long scene is cut at a word
  const long = "A rain-slicked rooftop high above the city at blue hour, neon signs bleeding pink and teal across the puddles, water towers and satellite dishes silhouetted against a wall of glass skyscrapers, steam rising from the vents, a helicopter light sweeping slowly across the low clouds far behind them while traffic hums forty floors below";
  const m = momentLine(long, 120);
  assert.ok(m.length <= " What is happening: ".length + 121, m);
  assert.ok(long.startsWith(m.slice(" What is happening: ".length, -1)));
  assert.match(m, /[a-z]\.$/i);
  // in a car: seated, the whole shot
  const ride = senseMotion("Cruising downtown in a convertible with the top down");
  assert.match(ride, /everyone STAYS SEATED the whole shot/);
  assert.match(ride, /Nobody stands up, climbs, walks or dances/);
  assert.match(ride, /keeps their hands on the wheel/);
  // anywhere else: real movement — and never on the spot
  const foot = senseMotion("A rooftop at sunset");
  assert.match(foot, /natural, physically possible motion/);
  assert.match(foot, /Nobody walks or steps on the spot/);
  assert.match(foot, /nobody stands in or on a vehicle/);

  const pipe = read("app", "lib", "music-video-pipeline.server.ts");
  const gen = pipe.slice(pipe.indexOf("export async function generateMusicVideo"));
  // a cut scene's motion is the scene's own words, the camera and the rule — not the slot's action
  assert.match(gen, /cinematic B-ROLL: \$\{fr\.ride \? "a close shot from inside the car" : shot\.kind\}\.\$\{momentLine\(_s\.visual\)\} The camera does \$\{fr\.cam\}\.\$\{senseMotion\(_s\.visual\)\}/);
  // …and every mouth stays shut: the first re-made video opened on a co-star turning to the camera and
  // talking, with nothing synced to her
  assert.match(gen, /Nobody sings, talks or mouths words: every mouth stays closed or in a quiet smile\./);
  assert.doesNotMatch(gen, /cinematic B-ROLL\. \$\{framing\}/, "the slot's framing — and the action it carried — is no longer what the video model is told");
  // a performance in a car is told to stay seated too
  assert.match(gen, /\$\{fr\.ride \? senseMotion\(_s\.visual\) : ""\}/);
  // one function frames the storyboard, a re-roll and the render
  assert.equal(pipe.split("framingOf(shot, ").length - 1 + pipe.split("framingOf(o.shot, ").length - 1, 4, "the cast still, the solo still, the re-roll and the render");
  assert.match(pipe, /frame: ride \? rideFrame\(\{ costars, performing: shot\.role === "perform" \}\) : costars > 0 \? shot\.short : shot\.frame,/);
  assert.match(pipe, /cam: ride \? RIDE_CAM : shot\.cam,/);
  assert.match(gen, /const fr = framingOf\(shot, _s\.visual, k\);/);
});

test("the shot list says how a shot is framed — never what the people in it do", () => {
  const pipe = read("app", "lib", "music-video-pipeline.server.ts");
  const list = pipe.slice(pipe.indexOf("const SHOTLIST"), pipe.indexOf("type Shot ="));
  const shorts = [...list.matchAll(/short: "([^"]+)"/g)].map((x) => x[1]);
  assert.equal(shorts.length, 8);
  for (const s of shorts) assert.doesNotMatch(s, /\b(?:dancing|walking|riding)\b/i, s);
  const kinds = [...list.matchAll(/kind: "([^"]+)"/g)].map((x) => x[1]);
  assert.equal(kinds.length, 8);
  for (const k of kinds) assert.doesNotMatch(k, /\b(?:dancing|walking|riding|car)\b/i, k);
  // the cut scenes' own framings no longer bring an action or a thing of their own
  assert.doesNotMatch(list, /backup dancers/);
  assert.doesNotMatch(list, /the car rolling/);
  assert.doesNotMatch(list, /walking, riding, arriving/);
  // the picture of a cast cut scene: what they do is the setting's
  const cut = castStillPrompt({ genre: "Pop", role: "broll", frame: "Wide dynamic shot of all of them, full of rhythm and movement, nobody looking at the camera", visual: "An empty parking garage, headlights on", costars: 2, micOk: false });
  assert.match(cut, /each doing what the setting describes/);
});

test("the writer is told the same rules before a scene is written", () => {
  assert.match(SENSE_RULES, /^REAL-WORLD SENSE — every VISUAL must be something a real crew could film with real people/);
  assert.match(SENSE_RULES, /people in it SIT in its seats — nobody stands, dances or walks in or on a vehicle/);
  assert.match(SENSE_RULES, /Film it PARKED .* or from INSIDE, close on the faces with the lights passing — never a wide shot of people riding along in an open car/);
  assert.match(SENSE_RULES, /Say what KIND of car it is .* and use those SAME words every time it appears in a VISUAL — never shortened to "the Mustang" or "the car"; the same person drives it throughout/);
  // …in the pictures, not the song: told to use the same words "every time it appears", the writer SANG
  // them ("Headlights glowing bright, that black 1969 Mustang convertible waits for…")
  assert.match(SENSE_RULES, /\(That is for the pictures: the LYRICS never need to name the car at all\.\)/);
  assert.match(SENSE_RULES, /DANCING happens on foot, where there is room to dance/);
  assert.match(SENSE_RULES, /Each person does ONE simple, natural thing/);
  assert.ok(SENSE_RULES.endsWith("\n"));
  const engine = read("app", "lib", "film-engine.server.ts");
  const fn = engine.slice(engine.indexOf("export async function previewFilmTreatment"), engine.indexOf("// ---- Assembly"));
  assert.match(fn, /SENSE_RULES \+\s+`RENDER-SAFE/);
  // the dance scene is somewhere people can dance, and no scene is written as "riding"
  assert.match(SHOT_NOTES[2], /on foot, somewhere with room to dance \(never in a vehicle, never sitting\)/);
  assert.doesNotMatch(SHOT_NOTES[5], /riding/);
});

test("a picture of somebody doing the impossible is drawn again", () => {
  // the checker is asked — in every cast still, with or without the cast's reference pictures
  for (const q of [castCheckPrompt(), castCheckPrompt({ refs: 3 }), castCheckPrompt({ refs: 2, prop: "tiger" })]) {
    assert.match(q, /standing, walking or dancing in or on a car or other vehicle \(people in a vehicle sit in its seats\)/);
    assert.match(q, /"odd": true \| false/);
  }
  assert.deepEqual(parseCastCheck('{"people": 3, "seen": [true, true, true], "twin": false, "mic": "none", "odd": true}'), { people: 3, mic: "none", seen: [true, true, true], twin: false, odd: true });
  assert.deepEqual(parseCastCheck('{"people": 3, "mic": "none", "odd": "a bit"}'), { people: 3, mic: "none" }, "an answer that is not yes or no is left out");
  // THE VIDEO: all three there, each once, no microphone — and two of them on their feet in a moving car
  const standing = { people: 3, mic: "none" as const, seen: [true, true, true], twin: false, odd: true };
  assert.ok(castFaults(standing, 3, false, false) >= 3);
  assert.ok(castFaults(standing, 3, false, false) > castFaults({ people: 3, mic: "front" }, 3, false, true), "worse than a stray microphone");
  assert.equal(castFaults({ ...standing, odd: false }, 3, false, false), 0);
  // …in a wide shot too, where the people are not counted
  assert.ok(castFaults({ people: 1, mic: "none", odd: true }, null, false, false) > 0);
  assert.match(castFix(standing, 3, false, false), /people in a vehicle SIT in its seats — nobody stands, walks or dances in or on it/);
  assert.equal(castFix({ ...standing, odd: false }, 3, false, false), "");
  const pipe = read("app", "lib", "music-video-pipeline.server.ts");
  const still = pipe.slice(pipe.indexOf("async function castStill"), pipe.indexOf("/** Build the per-scene SEED stills"));
  // the cast still is framed by the same function, told the rule, and counted inside a car whatever its slot
  assert.match(still, /const fr = framingOf\(o\.shot, o\.visual, k\);/);
  assert.match(still, /frame: fr\.frame, visual: o\.visual, costars: k, micOk, extra: \[propLine, fr\.sense\.replace\(\/\[\.\\s\]\+\$\/, ""\), fix\]/);
  assert.match(still, /const expect = !fr\.ride && \(o\.shot\.slot === 0 \|\| o\.shot\.slot === 7\) \? null : k \+ 1;/);
});

test("a featured take keeps the balance of the song it is cut into, and its peaks stay under full scale", () => {
  // MEASURED 2026-11-22, each file split into vocal and music: a custom voice on a pop song came back
  // vocal -5.6 dB / music -7.4 dB; the stand-in voice on a rap song vocal -2.7 / music -4.3 — the vocal
  // 1.6-1.8 dB forward of where the song had it. Asked for 1.7 dB lower the take came back at the song's
  // own balance to 0.2 dB.
  assert.ok(FEATURE_VOCAL_TRIM_DB <= -1.5 && FEATURE_VOCAL_TRIM_DB >= -1.9, String(FEATURE_VOCAL_TRIM_DB));
  const voice = read("app", "lib", "singing-voice.server.ts");
  assert.match(voice, /\.\.\.\(vocalsDb \? \{ main_vocals_volume_change: vocalsDb \} : \{\}\),/);
  // a video sung whole in one voice is asked for as it always was
  assert.match(voice, /const vocalsDb = Number\.isFinite\(opts\.vocalsDb\) \? Math\.max\(-12, Math\.min\(12, Math\.round\(\(opts\.vocalsDb as number\) \* 10\) \/ 10\)\) : 0;/);
  const pipe = read("app", "lib", "music-video-pipeline.server.ts");
  assert.equal(pipe.split("vocalsDb:").length - 1, 1, "only the featured take is trimmed");
  // the limiter catches peaks and nothing else: left to itself it turned the take up 0.45 dB, to full scale
  assert.match(voice, /`volume=\$\{gain\.toFixed\(1\)\}dB,alimiter=limit=0\.95:level=0`/);
});

test("one car, described the same way in every scene it is in", () => {
  // THE STORYBOARD (2026-11-22): a black Mustang in scenes 1 and 5 — and "the Mustang convertible" in
  // scene 6, which was drawn red
  const scenes = [
    "Wide shot of a glowing city skyline at night; OMAR stands small on a rooftop edge, VALENTINA blurred behind him near a parked black 1969 Mustang convertible.",
    "Medium shot of OMAR singing straight to camera on a bright rooftop, VALENTINA dancing softly beside him.",
    "Hero shot of the black 1969 Mustang convertible parked beneath glowing city lights, KEIKO leaning against its hood.",
    "Lifestyle shot of OMAR walking toward the Mustang convertible, leaning back against it beside VALENTINA.",
    "KEIKO sits on the hood of the car, the city behind her.",
    "A taxi idles at the kerb while the three of them cross the street.",
  ];
  const out = sameCar(scenes);
  assert.equal(out[0], scenes[0], "said in full already (with 'parked' left where it was)");
  assert.equal(out[1], scenes[1], "no car in it");
  assert.equal(out[2], scenes[2]);
  assert.match(out[3], /walking toward the black 1969 Mustang convertible, leaning back against it/);
  assert.match(out[4], /on the hood of the black 1969 Mustang convertible, the city behind her/);
  assert.equal(out[5], scenes[5], "a different vehicle is left alone");
  // a state word stays with the scene it was said in, and the article still reads
  assert.deepEqual(sameCar(["A matte black lowrider rolls up.", "They lean on a parked lowrider at dusk."]), ["A matte black lowrider rolls up.", "They lean on a parked matte black lowrider at dusk."]);
  assert.deepEqual(sameCar(["An emerald green convertible under the bridge.", "She waits by a convertible."]), ["An emerald green convertible under the bridge.", "She waits by an emerald green convertible."]);
  // joining words are not a description: this is not a car called "glow of his black"
  assert.deepEqual(sameCar(["Caught in the glow of his black car.", "He opens the door of the car."]), ["Caught in the glow of his black car.", "He opens the door of the black car."]);
  // nothing to carry: no car is described, or there is no car at all; traffic is not a car
  assert.deepEqual(sameCar(["They get in the car.", "The car pulls away."]), ["They get in the car.", "The car pulls away."]);
  assert.deepEqual(sameCar(["A rooftop at sunset.", "The cars stream by below."]), ["A rooftop at sunset.", "The cars stream by below."]);
  assert.deepEqual(sameCar([]), []);
  // the writer is told not to shorten it, and what comes back is carried through anyway
  assert.match(SENSE_RULES, /use those SAME words every time it appears in a VISUAL — never shortened to "the Mustang" or "the car"/);
  const engine = read("app", "lib", "film-engine.server.ts");
  assert.match(engine, /const carried = sameCar\(list\.map\(\(s\) => s\.visual\)\);\s+list = list\.map\(\(s, i\) => \(\{ \.\.\.s, visual: carried\[i\] \|\| s\.visual \}\)\);/);
});

test("a check that cannot be read is asked for again, said so, and what it saw rides back to the page", () => {
  const pipe = read("app", "lib", "music-video-pipeline.server.ts");
  const fn = pipe.slice(pipe.indexOf("async function readCast"), pipe.indexOf("/** A cast still and how it fared"));
  // (a re-rolled performance came back with a microphone its scene ruled out and no flag on it —
  //  and nothing recorded whether the check had looked at it)
  assert.match(fn, /for \(let attempt = 0; attempt < 2; attempt\+\+\) \{/);
  // (room for a sentence before the JSON — and, since the clothes question, for the garments it writes down)
  assert.match(fn, /maxTokens: CAST_CHECK_TOKENS, model: "claude-sonnet-4-6"/);
  assert.match(fn, /the cast check's answer could not be read/);
  assert.match(fn, /the cast check could not be made/);
  // what the check read off the kept picture goes back with the storyboard and with a re-roll
  assert.match(pipe, /best = \{ img, faults, reading: \{ \.\.\.\(seen \|\| \{\}\), bars \} \};/);
  assert.match(pipe, /if \(!seen && !bars\) return \{ img, faults: null, reading: null \};/);
  assert.match(pipe, /sceneChecks: made\.map\(\(m\) => m\.reading \?\? null\)/);
  const ui = read("app", "routes", "web.film.tsx");
  assert.match(ui, /sceneFaults: r\.sceneFaults, sceneChecks: r\.sceneChecks,/);
  // (…with the scene's words too, when the re-roll rewrote them for its cast — tests/mv-recast.test.ts)
  assert.ok(ui.includes("return json({ ok: true, sceneIndex, img, faults, check, ...(visualNow !== sceneVisual ? { visual: visualNow } : {}) });"));
  // the page keeps it with the storyboard and puts it on the scene's card
  assert.match(ui, /checks: Array\.isArray\(sd\.sceneChecks\) \? sd\.sceneChecks : \[\] \}\);/);
  assert.match(ui, /checks: prev\.imgs\.map\(\(_, j\) => \(j === idx \? nc : \(prev\.checks \|\| \[\]\)\[j\] \?\? null\)\)/);
  assert.match(ui, /data-check=\{isMv && seeds && \(seeds\.checks \|\| \[\]\)\[i\] != null \? JSON\.stringify\(\(seeds\.checks \|\| \[\]\)\[i\]\) : undefined\}/);
});

test("up high, people stand on solid floor back from the edge", () => {
  // (a later video, 2026-11-22: it opened on the artist strolling along the unrailed edge of a skyscraper
  //  roof and closed on the cast walking a glass floor hung over the city)
  for (const v of [
    "Wide establishing shot of a glittering night city skyline from a high rooftop, OMAR small at the edge",
    "The three of them walking along a glowing glass skywalk high above the city",
    "On a penthouse terrace at night, string lights overhead",
    "Standing on the ledge of a tower, wind in his jacket",
    "A balcony over the boulevard", "an observation deck at dusk", "walking a sky bridge between two towers", "a glass floor over the street",
  ]) assert.equal(highScene(v), true, v);
  // a skyline or a tower in the distance is a backdrop, not a place to fall from
  for (const v of ["An empty street at night, the skyline glowing behind them", "Under a streetlamp, skyscrapers towering in the distance", "An empty parking garage lit by neon strips", "", null, undefined]) assert.equal(highScene(v), false, String(v));

  const still = senseStill("Medium shot on a rooftop terrace at night, string lights overhead");
  assert.match(still, /solid floor, well back from the edge, with a wall or railing at the edge — nobody on a ledge or on glass over a drop\.$/);
  assert.ok(still.length <= 140, "short: the picture calls read a limited length");
  assert.equal(senseStill("An empty street at night, the skyline behind"), "");
  // a car on a roof keeps the car's rule (one line, not two: the prompt has a budget)
  assert.match(senseStill("A black 1969 Mustang convertible parked on a rooftop car park"), /^The car is a real production model/);
  assert.match(senseMotion("On a rooftop terrace at night"), /Nobody goes to the edge or climbs anything\.$/);
  assert.doesNotMatch(senseMotion("An empty street at night"), /edge/);
  assert.doesNotMatch(senseMotion("Driving through the city in a black convertible, top down"), /edge/);
  // the writer is told before a scene is written; the check asks; a redraw is told what was wrong
  assert.match(SENSE_RULES, /UP HIGH \(a rooftop, a terrace, a balcony\): it has a wall or a railing, and people stay well back from the edge\. Nobody stands or walks on a ledge, a beam, or a glass floor over a drop\./);
  assert.match(castCheckPrompt({ refs: 2 }), /or standing on a ledge, an unrailed roof edge or a glass floor over a drop\?/);
  assert.match(castFix({ people: 3, mic: "none", odd: true }, 3, false, false), /up high, everyone is on solid floor back from the edge, behind a wall or railing/);
  // both still prompts stay inside their budgets with the rule in
  const visual = "Wide lifestyle shot on a glowing rooftop terrace at night, the three of them walking toward the camera, laughing, the city lights spread out far below and behind them";
  assert.ok(castStillPrompt({ genre: "pop", role: "broll", frame: "a wide lifestyle shot", visual, costars: 2, micOk: false, extra: senseStill(visual).replace(/[.\s]+$/, "") }).length <= CAST_PROMPT_MAX);
});
