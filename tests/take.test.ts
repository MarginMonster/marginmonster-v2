/* A TAKE — one continuous shot that something happens in (app/lib/take.ts).
 *
 * The owner, 2026-11-24: "there would need to be some type of exchange at the bare minimum (voice saying \"babe
 * whats wrong\" then boom the scare shot)". On the first take: "it looks like the zap scares the scary person
 * and she runs into the room and turns around, can we enhance the creepy?". On the re-roll: "she lip synced
 * what the camera said towards the very beggining, creepy but im sure its a glitch". On the next: "bro the
 * monster literally lipsynced every word". And: "would be even better if these 10 second footages had like a
 * 2 second off of subject at the beggining then pans to the actual scene". On the two takes rebuilt from all
 * of that: "Both of those films are fucking cinema".
 *
 * What is held here is what a take's direction must always say — and never say — because each of those was
 * learned from a take he watched: it opens off its subject; the ENGINE is given no word to speak; the voice is
 * a separate track; slowness; and the list of what never happens.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HAND_CAMS, TAKE_CAUGHT, TAKE_HIDDEN, TAKE_HISS, TAKE_IDEAS, TAKE_LIFT_MAX_DB, TAKE_LINE_GAP, TAKE_OPENS_SECONDS, TAKE_PROMPT_MAX, TAKE_RADIO_VOICE, TAKE_REF, TAKE_ROOM_DB,
  TAKE_SECONDS, TAKE_VOICE, TAKE_WRONG, parseTake, placeLines, takeIdea, takeLines, takeOpensPrompt, takePrompt, takeSound, takeStillPrompt, takeWriterBrief,
} from "../app/lib/take.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

/** the ready-made SCARES (a drama is not one — see its own test) */
const SCARES = TAKE_IDEAS.filter((i) => i.genre !== "drama");

test("ready-made scares: a scene, a way in, three beats, something said, a sound", () => {
  // (the three held in a hand; the body cam's welfare check and its traffic stop — written for the body cam alone)
  assert.deepEqual(TAKE_IDEAS.map((i) => i.key), ["smile", "stairs", "bed", "welfare", "traffic"]);
  assert.deepEqual(TAKE_IDEAS.map((i) => i.cams || HAND_CAMS), [HAND_CAMS, HAND_CAMS, HAND_CAMS, ["bodycam"], ["bodycam"]]);
  assert.deepEqual(TAKE_IDEAS.map((i) => i.genre || "horror"), ["horror", "horror", "horror", "horror", "drama"]);
  for (const i of SCARES) {
    assert.ok(i.name.length <= 22 && i.line.length <= 60, `${i.key}: fits a card`);
    assert.ok(i.still.length >= 120 && i.still.length <= 700, `${i.key}: a scene`);
    // THE WAY IN: somewhere ordinary in the same place with nobody in it, what the camera does there, and how it finds the thing
    assert.ok(i.opens.length >= 60 && i.opens.length <= 420 && /\bcamera\b/.test(i.opens), `${i.key}: where the camera looks first`);
    assert.ok(/^the camera looks /.test(i.first) && i.first.length <= 260, `${i.key}: the first two seconds`);
    assert.ok(/^(swings|tilts|sinks|turns|pans|goes|drops|lifts)\b/.test(i.finds), `${i.key}: how the camera finds it — a verb, for "THEN the camera …"`);
    assert.equal(i.beats.length, 3);
    // the first beat is stillness; the last one comes toward the lens and ends by filling the frame
    assert.ok(/still/i.test(i.beats[0]), `${i.key}: it begins perfectly still`);
    assert.ok(/toward the camera|toward the lens/i.test(i.beats[2]) && /frame/i.test(i.beats[2]), `${i.key}: it comes, and fills the frame`);
    assert.ok(/slow/i.test(i.beats[1] + i.beats[2]), `${i.key}: slowly`);
    assert.ok(i.says[0].endsWith("?") && i.says[1], `${i.key}: a worried question, then a plea`);
    assert.ok(i.asks === "looking" || i.asks === "found");
    assert.ok(i.sound);
    const all = `${i.still} ${i.opens} ${i.first} ${i.finds} ${i.beats.join(" ")}`;
    // nothing in a ready-made scare is what the recipe forbids
    assert.ok(!/\b(run|runs|running|scream|screams|lunge|lunges|blood|gore|horns?|wings?|tentacles?|glowing|flames?|skull)\b/i.test(all), i.key);
    // ITS MOUTH NEVER MOVES: no beat opens, widens or works a mouth (the bed's smile used to "open, slowly,
    // wider and wider" — and the engine then gave it every word the cameraman said)
    assert.ok(!/\b(smile|mouth|lips|jaw)\b[^.]*\b(opens?|opening|widens?|widening|parts?|parting|works?)\b/i.test(i.beats.join(" ")), `${i.key}: its mouth does nothing`);
    assert.ok(!/\b(speaks?|whispers?|says?|chews?|laughs?|mouths)\b/i.test(i.beats.join(" ")), `${i.key}: it makes no word`);
    // THE ONE FILMING IS NEVER A BODY IN THE DIRECTION'S LAST BEATS ("the one filming shuffles backwards" ended a
    // take with a pair of legs walking into the frame): it is the camera that backs away
    assert.ok(/while the camera backs away/.test(i.beats[2]) && !/the one filming/.test(i.beats.join(" ")), `${i.key}: the camera backs away`);
    // what is SAID is nowhere in what the engine is shown or told
    for (const line of i.says) assert.ok(!all.includes(line), `${i.key}: "${line}" is not in the direction`);
  }
  assert.equal(takeIdea(" SMILE ")?.name, "She's smiling");
  assert.equal(takeIdea("nope"), undefined);
  // two seconds off the subject, and ten of the scene
  assert.equal(TAKE_OPENS_SECONDS, 2);
  assert.equal(TAKE_SECONDS, 12);
  // the two the owner called cinema ask their question differently: on seeing her; while still looking
  assert.equal(takeIdea("smile")?.asks, "found");
  assert.equal(takeIdea("bed")?.asks, "looking");
});

test("the scene is drawn by the creature recipe: caught, wrong, hidden — and nothing written", () => {
  const p = takeStillPrompt(TAKE_IDEAS[0]);
  assert.ok(p.startsWith("Vertical 9:16 picture. A single frame of real footage, caught by accident"));
  for (const part of [TAKE_CAUGHT, TAKE_WRONG, TAKE_HIDDEN, TAKE_IDEAS[0].still]) assert.ok(p.includes(part));
  assert.ok(p.indexOf(TAKE_CAUGHT) < p.indexOf(TAKE_IDEAS[0].still) && p.indexOf(TAKE_IDEAS[0].still) < p.indexOf(TAKE_WRONG));
  assert.ok(p.endsWith("Nothing written anywhere in the picture. No watermark, no signature."));
  assert.ok(takeStillPrompt(TAKE_IDEAS[1], "16:9").startsWith("Wide 16:9 picture."));
  assert.ok(/never CGI, never a 3D render, never an illustration/.test(TAKE_CAUGHT) && /No blood, no gore/.test(TAKE_HIDDEN));
});

test("THE WAY IN (\"a 2 second off of subject at the beggining then pans to the actual scene\"): the first frame is the same place, a moment earlier, with nobody in it", () => {
  for (const i of SCARES) {
    const p = takeOpensPrompt(i);
    assert.ok(p.startsWith("Vertical 9:16 picture. The SAME place and the SAME camera as the reference image, a moment earlier: "), i.key);
    assert.ok(p.includes(i.opens.replace(/\.$/, "")));
    assert.ok(p.includes("NOBODY is in the picture: no person, no face, no hand, no figure, no shape under a cover."));
    assert.ok(p.includes("the same underexposed, grainy, soft look as the reference image — real footage, never a render.") && p.endsWith("Nothing written anywhere."));
    // nothing of the THING is in the frame the take starts on
    assert.ok(!/smile|teeth|figure stands|pale|face is/i.test(i.opens), `${i.key}: the thing is not in the way in`);
  }
  assert.ok(takeOpensPrompt(TAKE_IDEAS[2], "16:9").startsWith("Wide 16:9 picture."));
  // a sentence that already ends is not given a second full stop
  assert.ok(!takeOpensPrompt({ opens: "the floor of a hallway, bare boards." }).includes("boards.."));
});

test("the direction: off the subject, the camera finds it, one wrong movement, the approach — and what never happens", () => {
  for (const idea of SCARES) {
    for (const camera of idea.cams || HAND_CAMS) {
      const p = takePrompt(idea, camera);
      assert.ok(p.length <= TAKE_PROMPT_MAX, `${idea.key}/${camera}: ${p.length} characters — the engine takes 2,500`);
      assert.ok(p.includes("One continuous take, no cuts, nothing written on screen."));
      // the four parts, in order, at their times
      const at = ["FIRST TWO SECONDS:", "THEN the camera ", "THEN, slowly:", "LAST FOUR SECONDS:"].map((m) => p.indexOf(m));
      assert.ok(at[0] > 0 && at[0] < at[1] && at[1] < at[2] && at[2] < at[3], `${idea.key}: four parts in order`);
      assert.ok(p.includes(`FIRST TWO SECONDS: ${idea.first}`));
      // it ARRIVES at the scene: the reference picture, named the way this host names it
      assert.ok(p.includes(`THEN the camera ${idea.finds} and stops: there, exactly as in <<<image_1>>>, `), `${idea.key}: found exactly as in the reference`);
      // WHAT NEVER HAPPENS (the first take: a "zap", then she ran into the room and turned around)
      for (const never of ["never runs", "never flinches", "never turns around", "never looks away", "never screams", "never speaks", "never mouths a word", "it never swings away, never drops, never falls.", "Nothing flashes", "the light does not change", "never glitches or tears"]) assert.ok(p.includes(never), `${idea.key}: ${never}`);
      // …and the one filming is never IN it (a take ended with a pair of legs walking into the frame)
      assert.ok(p.includes("The one filming is never in the picture: no legs, no feet, no body."));
      assert.ok(p.endsWith("No voice at all. No music.") && p.includes(idea.sound));
    }
  }
  // what is being held is said the way the overlay will show it
  assert.ok(takePrompt(TAKE_IDEAS[0], "phone").startsWith("Shot on a phone at night, held in one hand, the phone's own small light on. One continuous take"));
  assert.ok(takePrompt(TAKE_IDEAS[1], "camcorder").startsWith("Shot on a small home camcorder at night, held in one hand, its little lamp on. One continuous take"));
  assert.ok(takePrompt(TAKE_IDEAS[2], "bare").startsWith("Handheld, at night, one small light on. One continuous take"));
  // "she" is "her" where the sentence needs it; a thing is "its"
  assert.ok(takePrompt(TAKE_IDEAS[0]).includes("Her mouth does not open or close.") && takePrompt(TAKE_IDEAS[0]).includes("never opens her mouth") && takePrompt(TAKE_IDEAS[0]).includes("Once the camera has found her it never leaves her"));
  assert.ok(takePrompt(TAKE_IDEAS[1]).includes("Its mouth does not open or close.") && takePrompt(TAKE_IDEAS[1]).includes("Once the camera has found the figure it never leaves the figure"));
  // each host names the reference picture its own way
  assert.deepEqual(TAKE_REF, { replicate: "<<<image_1>>>", fal: "@Image1" });
  assert.ok(takePrompt(TAKE_IDEAS[0], "phone", TAKE_REF.fal).includes("exactly as in @Image1, ") && !takePrompt(TAKE_IDEAS[0], "phone", TAKE_REF.fal).includes("<<<"));
});

test("THE ENGINE IS GIVEN NO WORDS (\"bro the monster literally lipsynced every word\")", () => {
  for (const idea of SCARES) {
    for (const camera of idea.cams || HAND_CAMS) {
      const p = takePrompt(idea, camera);
      assert.ok(p.includes("NOBODY SPEAKS in this shot: no voice, no words, no whisper"), `${idea.key}: nobody speaks`);
      // not one quotation mark: nothing is quoted for the engine to say…
      assert.ok(!/["“”]/.test(p), `${idea.key}/${camera}: no quoted line`);
      // …and neither line is in it in any form
      for (const line of idea.says) assert.ok(!p.toLowerCase().includes(line.toLowerCase().replace(/[.?! ]+$/, "")), `${idea.key}: "${line}" is not given to the engine`);
      assert.ok(!/\b(whispers?|says|asks|worried:)\b/i.test(p.replace("no whisper", "")), `${idea.key}: nobody is told to say anything`);
    }
  }
  // even when the writer's parts carry a quote, none reaches the engine as a quotation
  const sneaky = { ...TAKE_IDEAS[0], says: ['He said "hi"?', "no"] as [string, string] };
  assert.ok(!takePrompt(sneaky).includes("He said") && !/["“”']hi["“”']/.test(takePrompt(sneaky)));
});

test("THE VOICE BEHIND THE CAMERA is a separate track: what is said, when, and how it sits in the room", () => {
  // the question on finding her; while still looking for the other two; the plea as it comes
  assert.deepEqual(takeLines(takeIdea("smile")!), [{ at: 2.8, text: "Babe? ... Babe, what's wrong?" }, { at: 8.6, text: "no... no..." }]);
  assert.deepEqual(takeLines(takeIdea("bed")!).map((l) => l.at), [0.3, 8.6]);
  assert.deepEqual(takeLines(takeIdea("stairs")!).map((l) => l.at), [0.3, 8.6]);
  assert.deepEqual(takeLines({ says: ["", ""], asks: "found" }), []);
  assert.deepEqual(takeLines({ says: ['He said "hi"?', ""], asks: "found" }), [{ at: 2.8, text: "He said 'hi'?" }]);
  // the voice and the manner of the takes he called cinema
  assert.deepEqual(TAKE_VOICE, { id: "English_magnetic_voiced_man", emotion: "fearful", speed: 0.95 });

  // PLACED once each line's length is known: never on top of the line before, never cut off by the end
  assert.deepEqual(placeLines([{ at: 0.3, seconds: 3 }, { at: 8.6, seconds: 2.8 }]), [{ at: 0.3, seconds: 3 }, { at: 8.6, seconds: 2.8 }]);
  // a long first line pushes the second one later, by the breath between them
  assert.deepEqual(placeLines([{ at: 2.8, seconds: 6 }, { at: 8.6, seconds: 2 }]).map((l) => l.at), [2.8, 2.8 + 6 + TAKE_LINE_GAP]);
  // a line that would run past the end is said EARLIER, so it ends inside the take…
  assert.deepEqual(placeLines([{ at: 0.3, seconds: 3 }, { at: 8.6, seconds: 3.6 }]).map((l) => l.at), [0.3, 8.25]);
  // …and is left out only when there is no room for it at all
  assert.deepEqual(placeLines([{ at: 2.8, seconds: 6 }, { at: 8.6, seconds: 4 }]).map((l) => l.at), [2.8]);
  assert.deepEqual(placeLines([{ at: 0.3, seconds: 13 }]), []);
  assert.deepEqual(placeLines([{ at: 0.3, seconds: 0 }]), [], "a line that is no sound is no line");

  // THE SOUND: the room lifted to a real level, a low hiss under it, the lines band-limited — one mix
  const g = takeSound({ lines: [{ at: 2.8 }, { at: 8.6 }], roomDb: -54.8, hasSound: true });
  assert.ok(g.startsWith("[0:a]aresample=48000,aformat=channel_layouts=stereo,volume=20.8dB[amb];"), "the room is lifted to −34 dB");
  assert.ok(g.includes("[3:a]aformat=channel_layouts=stereo,highpass=f=60,lowpass=f=1400,volume=-17dB[hiss];"), "the hiss is the input after the lines");
  assert.ok(g.includes("[1:a]aresample=48000,aformat=channel_layouts=stereo,highpass=f=150,lowpass=f=6500,aecho=0.8:0.5:14:0.18,volume=-1dB,adelay=2800|2800[v0];"));
  assert.ok(g.includes("adelay=8600|8600[v1];") && g.endsWith("[amb][hiss][v0][v1]amix=inputs=4:normalize=0:duration=first,alimiter=limit=0.9[a]"));
  assert.equal(TAKE_ROOM_DB, -34);
  // a room that is already loud is not lifted; a silent one is lifted no further than the cap; one that
  // could not be measured is left alone
  assert.ok(takeSound({ lines: [{ at: 1 }], roomDb: -20, hasSound: true }).includes("volume=0.0dB[amb]"));
  assert.ok(takeSound({ lines: [{ at: 1 }], roomDb: -91, hasSound: true }).includes(`volume=${TAKE_LIFT_MAX_DB.toFixed(1)}dB[amb]`));
  assert.ok(takeSound({ lines: [{ at: 1 }], roomDb: null, hasSound: true }).includes("volume=0.0dB[amb]"));
  // a take with no sound of its own: the hiss stands in for the room, and the mix still has its inputs
  const mute = takeSound({ lines: [{ at: 1 }], roomDb: null, hasSound: false });
  assert.ok(mute.startsWith("[2:a]aformat=channel_layouts=stereo,volume=-90dB[amb];") && mute.endsWith("[amb][hiss][v0]amix=inputs=3:normalize=0:duration=first,alimiter=limit=0.9[a]"));
  assert.ok(TAKE_HISS.startsWith("anoisesrc=color=brown"));
});

test("a take of the member's own: the writer is told how a scare is built, and its answer is checked", () => {
  const brief = takeWriterBrief("a man in the corner of the nursery");
  assert.ok(brief.includes("THE IDEA: a man in the corner of the nursery"));
  for (const rule of ["ONE continuous twelve-second shot", "for two seconds, the camera is NOT on the thing", "THEN the camera moves and FINDS it", "(1) STILLNESS", "(2) ONE WRONG MOVEMENT", "(3) IT COMES", "NEVER runs, flinches, turns away or screams", "ITS MOUTH NEVER MOVES", "nearly human and slightly wrong", "No blood, no gore, no wounds", "The one filming is never seen: write what THE CAMERA does", "Answer with JSON only", '"opens":', '"first":', '"finds":', '"asks":']) assert.ok(brief.includes(rule), rule);
  assert.ok(takeWriterBrief("").includes("THE IDEA: something that should not be in the house"));

  const good = {
    title: "The Nursery Corner", who: "The Man",
    still: "The camera looks across a dark nursery from the doorway: in the far corner, facing the wall, stands a tall man, perfectly still.",
    opens: "the camera looks down at a cot with a mobile hanging over it, lit by its own small light; nobody is in the room.",
    first: "the camera looks at the empty cot while its holder stands in the doorway.",
    finds: "The camera turns slowly to the far corner",
    beats: ["the man stands facing the corner, perfectly still.", "his head turns all the way round, slowly.", "he walks backwards toward the camera, slowly, while the camera backs away, until his face fills the frame."],
    says: ["Who's there?", "no, no"], asks: "LOOKING", sound: "floorboards",
  };
  const t = parseTake(JSON.stringify(good));
  assert.ok(t && t.title === "The Nursery Corner" && t.who === "the man" && t.beats.length === 3 && t.says[1] === "no, no");
  // "the camera" is the direction's own subject there: a writer who repeats it is not doubled
  assert.equal(t!.finds, "turns slowly to the far corner");
  assert.equal(t!.asks, "looking");
  assert.equal(parseTake({ ...good, asks: "whenever" })!.asks, "found", "anything else: on seeing it");
  // wrapped in prose or a code fence: still read
  assert.ok(parseTake("Here you go:\n```json\n" + JSON.stringify(good) + "\n```"));
  // half a direction is no direction
  assert.equal(parseTake(JSON.stringify({ ...good, beats: good.beats.slice(0, 2) })), null);
  assert.equal(parseTake(JSON.stringify({ ...good, still: "a man" })), null);
  assert.equal(parseTake(JSON.stringify({ ...good, says: [] })), null);
  // …and a take with no way in is not this take
  assert.equal(parseTake(JSON.stringify({ ...good, opens: "" })), null);
  assert.equal(parseTake(JSON.stringify({ ...good, first: "" })), null);
  assert.equal(parseTake(JSON.stringify({ ...good, finds: "" })), null);
  assert.equal(parseTake("not json"), null);
  assert.equal(parseTake(null), null);
  // a second line is optional; a title falls back
  const bare = parseTake({ ...good, title: "", says: ["Hello?"] });
  assert.ok(bare && bare.title === "Found footage" && bare.says[1] === "");
  // …and whatever the writer returns, the direction built from it fits the engine and carries no word to say
  const p = takePrompt(t!, "phone");
  assert.ok(p.length <= TAKE_PROMPT_MAX && !/["“”]/.test(p) && !p.includes("Who's there"));
  assert.ok(p.includes("THEN the camera turns slowly to the far corner and stops: there, exactly as in <<<image_1>>>, the man stands facing the corner, perfectly still. Its mouth does not open or close."));
});

test("the making: started off its subject, listened to, voiced afterwards — and every step after the take degrades instead of failing", () => {
  const srv = read("app", "lib", "take.server.ts");
  // the same model on the same host order the acted films use — fal's standard tier first — on the endpoint
  // that takes a first frame AND a picture to arrive at
  assert.ok(srv.includes('const FAL_OMNI_STD = "fal-ai/kling-video/o3/standard/reference-to-video";') && srv.includes('const FAL_OMNI = "fal-ai/kling-video/o3/pro/reference-to-video";'));
  assert.ok(srv.indexOf('host: "fal kling 3 omni standard"') < srv.indexOf('host: "fal kling 3 omni"') && srv.indexOf('host: "fal kling 3 omni"') < srv.indexOf('host: "replicate kling 3 omni"'));
  assert.ok(srv.includes("startImage: o.first, referenceImages: [o.scene], prompt: o.direction(TAKE_REF.fal), generateAudio: true, durationSec: secs, aspect: o.aspect"));
  assert.ok(srv.includes('prompt: o.direction(TAKE_REF.replicate), start_image: o.first, reference_images: [o.scene], generate_audio: true, duration: secs, mode: "pro"'));
  // (a handheld take is TAKE_SECONDS; a house take asks for its own — always inside the engine's 3–15)
  assert.ok(srv.includes("const secs = Math.max(3, Math.min(15, Math.round(o.seconds ?? TAKE_SECONDS)));"));
  // THE WAY IN is drawn from the scene; when it will not draw, the take starts on the scene itself
  assert.ok(srv.includes("prompt: takeOpensPrompt(take, aspect), image_input: [imageRef(base, still)]"));
  // (a picture is handed over by its public address — inline only on a run whose renders are not public)
  assert.ok(srv.includes('const inline = () => process.env.RENDERS_INLINE === "1";') && srv.includes("return `${base}${rel}`;"));
  assert.ok(srv.includes('catch (e) { opens = "-";') && srv.includes('const firstFrame = opens && opens !== "-" ? opens : still;'));
  // the seconds that cost money are on the disk (and checkpointed) the moment they exist
  assert.ok(srv.includes("fs.writeFileSync(path.join(renders(), name), buf);") && srv.includes("await ckpt({ ckRaw: rawName });"));
  // a writer that fails or half-answers → a ready-made scare written for that camera, never half a direction
  assert.ok(srv.includes("take = written || { ...fallback, title: fallback.name };"));
  assert.ok(srv.includes("const fallbackFor = (camera: CameraLook): TakeIdea => TAKE_IDEAS.find((i) => (i.cams || HAND_CAMS).includes(camera)) || TAKE_IDEAS[0];"));
  // NO WORDS: the take is listened to; if the engine spoke it is rolled again (once, unless told otherwise)
  // and the quieter roll is kept — a roll that could not be heard never replaces one that was
  assert.ok(srv.includes("for (let again = 0; silent && again < rerolls() && wordsIn(spoke) > 0; again++) {"));
  assert.ok(srv.includes("if (nextSpoke !== null && wordsIn(nextSpoke) < wordsIn(spoke)) { rawName = next; spoke = nextSpoke;"));
  assert.ok(srv.includes("Number.isFinite(n) && n >= 0 ? Math.min(2, Math.floor(n)) : 1;"), "TAKE_REROLLS: once by default, never more than twice");
  // THE VOICE is the app's own, laid on by takeSound; the picture is copied, never re-encoded
  assert.ok(srv.includes("voice_id: voice.id, emotion: voice.emotion, speed: voice.speed"));
  // (the one filming in the takes' own voice — an officer's in a drama; a body cam's dispatcher in the radio's)
  assert.ok(srv.includes('const voice = l.radio ? TAKE_RADIO_VOICE : take.genre === "drama" ? TAKE_OFFICER_VOICE : TAKE_VOICE;'));
  assert.ok(srv.includes("const placed = placeLines(spoken, total);") && srv.includes('"-filter_complex", takeSound({ lines: placed, roomDb, hasSound }),'));
  assert.ok(srv.includes('"-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac"'));
  // a voice that will not speak → the take without it
  assert.ok(srv.includes("const soundName = voiced?.name || rawName;"));
  // a look that will not render ships the take as it is
  assert.ok(srv.includes("const outPath = dressed || path.join(dir, soundName);"));
  // grain is incompressible: the dressed take is encoded under a cap
  assert.ok(srv.includes('"-crf", "22", "-maxrate", "7M", "-bufsize", "14M"'));
  // the phone's two faces are given a moment, never waited on for long
  assert.ok(srv.includes("const fonts = await overlayFonts(8_000);"));
  // the piece says what was laid on, and what the engine said on its own (which should be nothing)
  assert.ok(srv.includes("lines: voiced?.lines || null,") && srv.includes("\n        spoke,\n"));
});

test("fal's Omni reference endpoint is asked the way its schema reads: a first frame, the pictures to arrive at, the frame", async () => {
  const { falVideoBody } = await import("../app/lib/fal-video-body.ts");
  const body = falVideoBody("fal-ai/kling-video/o3/standard/reference-to-video", { startImage: "https://x/off.jpg", referenceImages: ["https://x/scene.jpg"], prompt: "p @Image1", generateAudio: true, durationSec: 12, aspect: "9:16" });
  assert.deepEqual(body, { prompt: "p @Image1", start_image_url: "https://x/off.jpg", image_urls: ["https://x/scene.jpg"], duration: "12", generate_audio: true, aspect_ratio: "9:16" });
  assert.equal(falVideoBody("fal-ai/kling-video/o3/pro/reference-to-video", { startImage: "s", prompt: "p", aspect: "16:9" }).aspect_ratio, "16:9");
  // no reference: no empty list is sent; never more than the four the endpoint takes
  assert.ok(!("image_urls" in falVideoBody("fal-ai/kling-video/o3/pro/reference-to-video", { startImage: "s", prompt: "p" })));
  assert.equal((falVideoBody("fal-ai/kling-video/o3/pro/reference-to-video", { startImage: "s", prompt: "p", referenceImages: ["a", "b", "c", "d", "e"] }).image_urls as string[]).length, 4);
  // the image-to-video endpoint is asked exactly as before
  assert.deepEqual(falVideoBody("fal-ai/kling-video/o3/standard/image-to-video", { startImage: "https://x/a.jpg", prompt: "p", generateAudio: true, durationSec: 10 }), { prompt: "p", image_url: "https://x/a.jpg", duration: "10", generate_audio: true });
});

test("THE BODY CAM (\"What about body cam footage\"): a welfare check — worn, wide, a radio call that is its own voice, fiction", () => {
  const w = takeIdea("welfare")!;
  assert.deepEqual(w.cams, ["bodycam"]);
  // the porch is its two seconds off the subject; the flashlight finds her at the end of the hall
  assert.ok(/porch steps/.test(w.opens) && /door standing ajar/.test(w.first) && w.finds.startsWith("goes in through the door"));
  // the direction is the body cam's own: worn on a chest, a flashlight beside it — and still no word for the engine
  const p = takePrompt(w, "bodycam");
  assert.ok(p.startsWith("Recorded at night by a body camera worn on the chest of the one walking in"));
  assert.ok(p.includes("NOBODY SPEAKS in this shot") && !/["“”]/.test(p) && !p.includes(w.radio!.slice(0, 20)) && !p.includes("Alder Lane"));
  assert.ok(p.length <= TAKE_PROMPT_MAX);
  // the DISPATCHER: said first, the moment the take opens, in a voice of its own — the radio's
  assert.deepEqual(takeLines(w), [
    { at: 0.2, text: "Four-twelve, welfare check at fourteen Alder Lane. No lights in three days.", radio: true },
    { at: 2.8, text: "Hello? ... Ma'am? Are you okay?" },
    { at: 8.6, text: "ma'am... stop... please..." },
  ]);
  assert.deepEqual(TAKE_RADIO_VOICE, { id: "English_ConfidentWoman", emotion: "neutral", speed: 1.05 });
  // a radio call takes its time: the question waits for it to end (placeLines), and nothing is cut off
  assert.deepEqual(placeLines([{ at: 0.2, seconds: 4.4, radio: true }, { at: 2.8, seconds: 2.4 }, { at: 8.6, seconds: 2 }]).map((l) => l.at), [0.2, 5.2, 8.6]);
  // A RADIO SOUNDS LIKE A RADIO (the call that worked, t45/cam/b-dispatch-radio.wav): 450–2700 Hz, squeezed hard,
  // and the squelch — a short burst of white noise — either side of it; the one filming keeps the room's touch
  const g = takeSound({ lines: [{ at: 0.2, radio: true, seconds: 4.4 }, { at: 5.2 }], roomDb: -50, hasSound: true });
  assert.ok(g.includes("[1:a]aresample=48000,aformat=channel_layouts=stereo,highpass=f=450,lowpass=f=2700,acompressor=threshold=-26dB:ratio=8:attack=2:release=60,volume=-3dB,adelay=200|200[v0];"));
  assert.ok(g.includes("anoisesrc=d=0.12:c=white:a=0.22:r=48000,highpass=f=450,lowpass=f=2700,aformat=channel_layouts=stereo,adelay=60|60[q0a];"), "the squelch before the call");
  assert.ok(g.includes("adelay=4620|4620[q0b];"), "…and after it ends");
  assert.ok(g.includes("[2:a]aresample=48000,aformat=channel_layouts=stereo,highpass=f=150,lowpass=f=6500,aecho=0.8:0.5:14:0.18,volume=-1dB,adelay=5200|5200[v1];"));
  assert.ok(g.endsWith("[amb][hiss][v0][v1][q0a][q0b]amix=inputs=6:normalize=0:duration=first,alimiter=limit=0.9[a]"));
  // (a radio line whose length is not known still gets the burst before it)
  assert.ok(takeSound({ lines: [{ at: 1, radio: true }], roomDb: null, hasSound: true }).endsWith("[amb][hiss][v0][q0a]amix=inputs=4:normalize=0:duration=first,alimiter=limit=0.9[a]"));
  // a take with no radio has no radio line (the three held in a hand are as they were)
  for (const k of ["smile", "stairs", "bed"]) assert.ok(takeLines(takeIdea(k)!).every((l) => !("radio" in l)), k);
  // THE ROOM ON ITS OWN (a house camera's take: nobody speaks over it) — lifted, with the hiss, two inputs
  assert.equal(takeSound({ lines: [], roomDb: -58, hasSound: true }), "[0:a]aresample=48000,aformat=channel_layouts=stereo,volume=24.0dB[amb];[1:a]aformat=channel_layouts=stereo,highpass=f=60,lowpass=f=1400,volume=-17dB[hiss];[amb][hiss]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.9[a]");

  // a body cam of the member's own: worn, FICTION, and a radio call written with it
  const brief = takeWriterBrief("something in the attic of an empty farmhouse", "bodycam");
  assert.ok(brief.startsWith("You are directing ONE continuous twelve-second shot of found footage — something caught on a body camera worn on the chest"));
  for (const rule of ["It is FICTION: a creature in a house — never a real police incident, never a weapon drawn or fired, never anybody hurt, never a real agency", '"radio": what a dispatcher says over the radio', "a MADE-UP house number and street", "no real agency, no crime, no weapon"]) assert.ok(brief.includes(rule), rule);
  // …and the other cameras' brief is exactly as it was
  assert.equal(takeWriterBrief("x", "phone"), takeWriterBrief("x"));
  assert.ok(!takeWriterBrief("x").includes("radio"));
  const good = { title: "The Attic", who: "it", still: "A flashlight beam crosses a dusty attic at night; in the far corner, under the eaves, something pale and thin is folded up against the rafters, perfectly still.", opens: "the camera looks at a narrow attic ladder from the landing below, lit by the flashlight.", first: "the camera looks up the ladder while the one wearing it climbs.", finds: "lifts into the attic and the beam crosses to the far corner", beats: ["it is folded in the corner, perfectly still.", "its head turns slowly to the light.", "it crawls toward the camera, slowly, while the camera backs away, until it fills the frame."], says: ["Hello?", "no"], asks: "looking", sound: "rafters creaking", radio: 'Two-oh-nine, "check" the farmhouse on Mill Road.' };
  assert.equal(parseTake(good)!.radio, "Two-oh-nine, 'check' the farmhouse on Mill Road.");
  assert.ok(!("radio" in parseTake({ ...good, radio: "" })!));
});

test("THE BODY CAM'S POLICE DRAMA (\"doesn't nessesarily need to be horror\"): the driver speaks to the engine, the officer and the radio are their own tracks — fiction, nobody hurt, nobody the default", async () => {
  const { castTake, dramaPrompt, DRAMA_BOUNDS, TAKE_OFFICER_VOICE } = await import("../app/lib/take.ts");
  const tr = takeIdea("traffic")!;
  assert.ok(tr.genre === "drama" && tr.seconds === 15 && tr.name.length <= 22 && tr.line.length <= 60);
  assert.deepEqual(tr.cams, ["bodycam"]);
  // NOBODY IS THE DEFAULT: the driver is a different somebody from take to take — and the card never says who
  assert.ok(tr.cast!.length >= 6 && tr.still.includes("{driver}") && !/\b(he|she|his|her)\b/i.test(tr.line));
  const drivers = new Set([0, 1, 2, 3, 4, 5].map((seed) => castTake(tr, seed).still));
  assert.equal(drivers.size, 6);
  for (const d of drivers) assert.ok(!d.includes("{driver}"));
  assert.ok(tr.cast!.some((c) => /woman/.test(c)) && tr.cast!.some((c) => /\bman\b/.test(c)), "men and women");
  assert.equal(castTake(takeIdea("smile")!, 3), takeIdea("smile"), "a scare is untouched");
  // its scene is a body camera's frame, not a creature's — and the bounds are in every picture
  const still = takeStillPrompt(castTake(tr, 1), "16:9");
  assert.ok(still.startsWith("Wide 16:9 picture. A single frame from a body camera's own recording at night") && still.includes(DRAMA_BOUNDS) && !still.includes(TAKE_WRONG));
  assert.ok(DRAMA_BOUNDS.includes("no real police department, no badge, patch, insignia") && DRAMA_BOUNDS.includes("no weapon drawn; nobody hurt"));
  assert.ok(takeOpensPrompt(tr, "16:9").includes("The SAME place and the SAME body camera as the reference image") && takeOpensPrompt(tr, "16:9").includes(DRAMA_BOUNDS));
  // THE DIRECTION: the driver's own words, quoted, at about their second — and ONLY the driver's
  const p = takePrompt(tr, "bodycam");
  assert.equal(p, dramaPrompt(tr, "bodycam", "<<<image_1>>>"));
  assert.ok(p.includes(`At about 4 seconds the driver says: "I'm not getting out of the car. I didn't do anything."`) && p.includes(`At about 13 seconds the driver says: "Okay! Okay."`));
  assert.ok(p.indexOf("At about 4 seconds") < p.indexOf("FROM THE SEVENTH SECOND:") && p.indexOf("LAST FIVE SECONDS:") < p.indexOf("At about 13 seconds"));
  assert.ok(p.includes("Only the driver speaks in this shot; the officer wearing the camera says nothing and is never seen except the hands."));
  assert.ok(p.includes("A FICTIONAL police drama, and nobody is hurt: no weapon is drawn or fired, nobody is struck, no blood.") && p.includes("exactly as in <<<image_1>>>, "));
  // the officer's lines and the dispatcher's are NOT in it in any form (they are their own voices, laid on after)
  for (const s of tr.script!) assert.ok(!p.includes(s.text.replace(/[!.]+$/, "")), s.text);
  assert.ok(!p.includes("County Road") && !p.includes("Plate comes back"));
  assert.ok(p.length <= TAKE_PROMPT_MAX && !/\b(gun|shoots?|shot fired|punch|kick|taser|blood)\b/i.test(p.replace("no blood", "").replace("no weapon is drawn or fired", "")));
  // THE TRACKS: the radio first, then the officer's three lines at their own times — the officer's voice, firm
  assert.deepEqual(takeLines(tr), [
    { at: 0.2, text: "Unit twelve, copy your stop on County Road nine. Plate comes back expired.", radio: true },
    { at: 2.4, text: "Step out of the car for me." },
    { at: 7.4, text: "Hey! Stop! Stop!" },
    { at: 10.6, text: "Hands behind your back." },
  ]);
  assert.deepEqual(TAKE_OFFICER_VOICE, { id: "English_Trustworth_Man", emotion: "angry", speed: 1 });
  // the server: the driver is picked for each take, the take is fifteen seconds, and a drama that speaks is NOT rolled again
  const srv = read("app", "lib", "take.server.ts");
  assert.ok(srv.includes("else if (ready) take = { ...castTake(ready, parseInt(stamp().slice(-6), 16)), title: ready.name };"));
  assert.ok(srv.includes("const seconds = take.seconds || TAKE_SECONDS;") && srv.includes("direction, aspect, seconds });"));
  assert.ok(srv.includes('const silent = take.genre !== "drama";') && srv.includes("for (let again = 0; silent && again < rerolls() && wordsIn(spoke) > 0; again++) {"));
  assert.ok(srv.includes('const voice = l.radio ? TAKE_RADIO_VOICE : take.genre === "drama" ? TAKE_OFFICER_VOICE : TAKE_VOICE;'));
});

test("THE BUILDER'S RULES: what can film what, the shape that follows the camera, and the job a form asks for", async () => {
  const { FOOTAGE_SCARES, OWN_SCARE, familyOf, fits, footageEta, footageJob, footageScare, pickCamera, pickScare, shapeChoosable, shapeFor } = await import("../app/lib/take.ts");
  // every ready-made scare, with the cameras that can film it and its card's picture
  assert.deepEqual(FOOTAGE_SCARES.map((s) => [s.key, s.cams.join("/")]), [["smile", "phone/camcorder/bare"], ["stairs", "phone/camcorder/bare"], ["bed", "phone/camcorder/bare"], ["welfare", "bodycam"], ["traffic", "bodycam"], ["overbed", "house"], ["lookup", "house"]]);
  // ON THEIR SHELVES — the body cam has its own: a scare, and a police drama
  const { FOOTAGE_SHELVES, shelfScares } = await import("../app/lib/take.ts");
  assert.deepEqual(FOOTAGE_SHELVES.map((s) => [s.family, shelfScares(s.family).map((x) => x.key).join(",")]), [["hand", "smile,stairs,bed"], ["worn", "welfare,traffic"], ["fixed", "overbed,lookup"]]);
  assert.equal(footageScare("traffic")!.genre, "drama");
  assert.ok(!("genre" in footageScare("welfare")!));
  for (const s of FOOTAGE_SCARES) {
    assert.ok(s.img.startsWith(`/landing/ff-scare-${s.key}.jpg?v=`), s.key);
    const file = path.join(root, "public", "landing", `ff-scare-${s.key}.jpg`);
    assert.ok(fs.existsSync(file) && fs.statSync(file).size < 120_000, `${s.key}: a small card picture is in the repo`);
  }
  for (const c of ["phone", "camcorder", "bare", "house", "bodycam"]) {
    for (const ext of ["mp4", "jpg"]) {
      const file = path.join(root, "public", "landing", `ff-cam-${c}.${ext}`);
      assert.ok(fs.existsSync(file) && fs.statSync(file).size <= 300_000, `${c}.${ext}: a small loop and its still`);
    }
  }
  assert.equal(footageScare("overbed")!.lapseOn, true);
  assert.equal(footageScare("lookup")!.lapseOn, false);
  // who carries it
  assert.deepEqual(["phone", "camcorder", "bare", "bodycam", "house"].map((c) => familyOf(c as never)), ["hand", "hand", "hand", "worn", "fixed"]);
  // THE SHAPE FOLLOWS THE CAMERA: a phone tall, a house camera and a body cam wide, the other two the maker's pick (wide unless asked)
  assert.deepEqual(["phone", "house", "bodycam"].map((c) => shapeFor(c as never, "9:16")), ["9:16", "16:9", "16:9"]);
  assert.equal(shapeFor("phone", "16:9"), "9:16");
  assert.deepEqual(["camcorder", "bare"].map((c) => [shapeFor(c as never), shapeFor(c as never, "9:16"), shapeChoosable(c as never)]), [["16:9", "9:16", true], ["16:9", "9:16", true]]);
  assert.ok(!shapeChoosable("phone") && !shapeChoosable("house") && !shapeChoosable("bodycam"));
  // what can film what (your own idea: any camera)
  assert.ok(fits("smile", "camcorder") && !fits("smile", "house") && fits("overbed", "house") && !fits("overbed", "phone") && fits("welfare", "bodycam") && !fits("welfare", "phone"));
  for (const c of ["phone", "camcorder", "bare", "house", "bodycam"]) assert.ok(fits(OWN_SCARE, c as never));
  // THE LAST TAP WINS, THE OTHER CHOICE FOLLOWS — never a pair that cannot be filmed
  assert.deepEqual(pickScare({ scare: "smile", camera: "camcorder" }, "overbed"), { scare: "overbed", camera: "house" });
  assert.deepEqual(pickScare({ scare: "overbed", camera: "house" }, "bed", "camcorder"), { scare: "bed", camera: "camcorder" }, "back to the camera last in hand");
  assert.deepEqual(pickScare({ scare: "smile", camera: "phone" }, "welfare"), { scare: "welfare", camera: "bodycam" });
  assert.deepEqual(pickScare({ scare: "overbed", camera: "house" }, OWN_SCARE), { scare: OWN_SCARE, camera: "house" }, "your own idea keeps the camera");
  assert.deepEqual(pickScare({ scare: "smile", camera: "phone" }, "nope"), { scare: "smile", camera: "phone" });
  assert.deepEqual(pickCamera({ scare: "smile", camera: "phone" }, "bare"), { scare: "smile", camera: "bare" });
  assert.deepEqual(pickCamera({ scare: "smile", camera: "phone" }, "house"), { scare: "overbed", camera: "house" });
  assert.deepEqual(pickCamera({ scare: "overbed", camera: "house" }, "bodycam"), { scare: "welfare", camera: "bodycam" });
  assert.deepEqual(pickCamera({ scare: OWN_SCARE, camera: "phone" }, "house"), { scare: OWN_SCARE, camera: "house" });
  for (const s of FOOTAGE_SCARES) for (const c of ["phone", "camcorder", "bare", "house", "bodycam"]) {
    const p = pickCamera({ scare: s.key, camera: s.cams[0] }, c as never);
    assert.ok(fits(p.scare, p.camera), `${s.key} → ${c}`);
  }

  // THE JOB: everything decided here — a house take carries its room, its time-lapse and its night vision
  const house = footageJob({ scare: "overbed", camera: "house", aspect: "9:16" });
  assert.ok(house.ok);
  assert.deepEqual(house.ok && house.payload, { section: "creator", contentType: "take", takeCamera: "house", takeAspect: "16:9", takeIdea: "overbed", takeRoom: "bedroom", takeLapse: true, takeIr: true, productTitle: "Found Footage — Over the bed", productImageUrl: footageScare("overbed")!.img, initiator: "web" });
  const off = footageJob({ scare: "overbed", camera: "house", lapse: "0", ir: "0", room: "kitchen" });
  assert.ok(off.ok && off.payload.takeLapse === false && off.payload.takeIr === false && off.payload.takeRoom === "bedroom", "a ready-made scare keeps its own room");
  const look = footageJob({ scare: "lookup", camera: "house" });
  assert.ok(look.ok && look.payload.takeLapse === false && look.payload.takeRoom === "living");
  const mine = footageJob({ scare: "own", own: "the babysitter is still standing in the nursery at 4 a.m.", camera: "house", room: "nursery", lapse: "1" });
  assert.ok(mine.ok && mine.payload.takeOwn === "the babysitter is still standing in the nursery at 4 a.m." && mine.payload.takeRoom === "nursery" && mine.payload.takeLapse === true && !("takeIdea" in mine.payload) && !("productImageUrl" in mine.payload));
  assert.ok(mine.ok && mine.name.length <= 45 && mine.name.endsWith("…"));
  const phone = footageJob({ scare: "bed", camera: "phone", aspect: "16:9", lapse: "1" });
  assert.ok(phone.ok && phone.payload.takeAspect === "9:16" && !("takeLapse" in phone.payload) && !("takeRoom" in phone.payload), "a phone is tall; the house's settings are the house's");
  const cc = footageJob({ scare: "stairs", camera: "camcorder", aspect: "9:16" });
  assert.ok(cc.ok && cc.payload.takeAspect === "9:16");
  // …or why not, in words the page can show
  assert.deepEqual(footageJob({ scare: "smile", camera: "tripod" }), { ok: false, error: "Pick a camera." });
  assert.deepEqual(footageJob({ scare: "nope", camera: "phone" }), { ok: false, error: "Pick what happens." });
  assert.deepEqual(footageJob({ scare: "smile", camera: "house" }), { ok: false, error: "That camera can't film that one — pick another." });
  assert.deepEqual(footageJob({ scare: "own", own: "boo", camera: "phone" }), { ok: false, error: "Say what happens, in a few words." });
  // how long, start to Archive
  assert.deepEqual(footageEta("phone"), [5, 10]);
  assert.deepEqual(footageEta("house"), [6, 12]);
});
