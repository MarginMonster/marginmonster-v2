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
  TAKE_CAUGHT, TAKE_HIDDEN, TAKE_HISS, TAKE_IDEAS, TAKE_LIFT_MAX_DB, TAKE_LINE_GAP, TAKE_OPENS_SECONDS, TAKE_PROMPT_MAX, TAKE_REF, TAKE_ROOM_DB,
  TAKE_SECONDS, TAKE_VOICE, TAKE_WRONG, parseTake, placeLines, takeIdea, takeLines, takeOpensPrompt, takePrompt, takeSound, takeStillPrompt, takeWriterBrief,
} from "../app/lib/take.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("ready-made scares: a scene, a way in, three beats, something said, a sound", () => {
  assert.deepEqual(TAKE_IDEAS.map((i) => i.key), ["smile", "stairs", "bed"]);
  for (const i of TAKE_IDEAS) {
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
  for (const i of TAKE_IDEAS) {
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
  for (const idea of TAKE_IDEAS) {
    for (const camera of ["phone", "camcorder", "bare"] as const) {
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
  for (const idea of TAKE_IDEAS) {
    for (const camera of ["phone", "camcorder", "bare"] as const) {
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
  assert.ok(srv.includes("startImage: o.first, referenceImages: [o.scene], prompt: o.direction(TAKE_REF.fal), generateAudio: true, durationSec: TAKE_SECONDS, aspect: o.aspect"));
  assert.ok(srv.includes('prompt: o.direction(TAKE_REF.replicate), start_image: o.first, reference_images: [o.scene], generate_audio: true, duration: TAKE_SECONDS, mode: "pro"'));
  // THE WAY IN is drawn from the scene; when it will not draw, the take starts on the scene itself
  assert.ok(srv.includes('prompt: takeOpensPrompt(take, aspect), image_input: [`${base}${still}`]'));
  assert.ok(srv.includes('catch (e) { opens = "-";') && srv.includes('const firstFrame = opens && opens !== "-" ? opens : still;'));
  // the seconds that cost money are on the disk (and checkpointed) the moment they exist
  assert.ok(srv.includes("fs.writeFileSync(path.join(renders(), name), buf);") && srv.includes("await ckpt({ ckRaw: rawName });"));
  // a writer that fails or half-answers → a ready-made scare, never half a direction
  assert.ok(srv.includes("take = written || { ...TAKE_IDEAS[0], title: TAKE_IDEAS[0].name };"));
  // NO WORDS: the take is listened to; if the engine spoke it is rolled again (once, unless told otherwise)
  // and the quieter roll is kept — a roll that could not be heard never replaces one that was
  assert.ok(srv.includes("for (let again = 0; again < rerolls() && wordsIn(spoke) > 0; again++) {"));
  assert.ok(srv.includes("if (nextSpoke !== null && wordsIn(nextSpoke) < wordsIn(spoke)) { rawName = next; spoke = nextSpoke;"));
  assert.ok(srv.includes("Number.isFinite(n) && n >= 0 ? Math.min(2, Math.floor(n)) : 1;"), "TAKE_REROLLS: once by default, never more than twice");
  // THE VOICE is the app's own, laid on by takeSound; the picture is copied, never re-encoded
  assert.ok(srv.includes("voice_id: TAKE_VOICE.id, emotion: TAKE_VOICE.emotion, speed: TAKE_VOICE.speed"));
  assert.ok(srv.includes("const placed = placeLines(spoken, total);") && srv.includes('"-filter_complex", takeSound({ lines: placed, roomDb: mean ? Number(mean[1]) : null, hasSound }),'));
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
