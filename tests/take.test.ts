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
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
      // …by a MOVE, never a cut (the owner, of a take that cut to it: "the cut is far too obvious")
      assert.ok(p.includes(`THEN the camera ${idea.finds} — in the same shot, one smooth unbroken move, never a cut — and stops: there, exactly as in <<<image_1>>>, `), `${idea.key}: found exactly as in the reference, by a move`);
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
  assert.ok(takePrompt(TAKE_IDEAS[0]).includes("Her mouth stays exactly as it is in <<<image_1>>>, and never moves.") && takePrompt(TAKE_IDEAS[0]).includes("never moves her mouth") && takePrompt(TAKE_IDEAS[0]).includes("Once the camera has found her it never leaves her"));
  assert.ok(takePrompt(TAKE_IDEAS[1]).includes("Its mouth stays exactly as it is in <<<image_1>>>, and never moves.") && takePrompt(TAKE_IDEAS[1]).includes("Once the camera has found the figure it never leaves the figure"));
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
  assert.deepEqual(takeLines(takeIdea("smile")!), [{ at: 2.8, text: "Babe? ... Babe, what's wrong?" }, { at: 8.6, text: "babe... you're scaring me... stop—" }]);
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
  // (the one filming at +8 dB: the room echo halves its input and the filters take the rest — "Not in Your Bed" measured a
  //  -21 LUFS line at -34 in the mix, six dB over the room; now about fifteen, the loudest thing at the camera mic)
  assert.ok(g.includes("[1:a]aresample=48000,aformat=channel_layouts=stereo,highpass=f=150,lowpass=f=6500,aecho=0.8:0.5:14:0.18,volume=8dB,adelay=2800|2800[v0];"));
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
  for (const rule of ["ONE continuous twelve-second shot", "for two seconds, the camera is NOT on the thing", "THEN the camera moves and FINDS it", "(1) STILLNESS", "(2) ONE WRONG MOVEMENT", "(3) THE END", "NEVER runs, flinches, turns away or screams", "ITS MOUTH NEVER MOVES", "nearly human and slightly wrong", "No blood, no gore, no wounds", "The one filming is never seen: write what THE CAMERA does", "Answer with JSON only", '"opens":', '"first":', '"finds":', '"asks":', '"ends":']) assert.ok(brief.includes(rule), rule);
  assert.ok(takeWriterBrief("").includes("THE IDEA: something that should not be in the house"));
  // (the answer is English whatever the member wrote in — the direction is for the engine, the lines for an English voice)
  assert.ok(brief.includes("Answer with JSON only, in English whatever language the idea is in:"));

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
  assert.ok(p.includes("THEN the camera turns slowly to the far corner — in the same shot, one smooth unbroken move, never a cut — and stops: there, exactly as in <<<image_1>>>, the man stands facing the corner, perfectly still. Its mouth stays exactly as it is in <<<image_1>>>, and never moves."));
});

test("the making: started off its subject, listened to, voiced afterwards — and every step after the take degrades instead of failing", () => {
  const srv = read("app", "lib", "take.server.ts");
  // the same model on the same host order the acted films use — fal's PRO tier (1080p) first ("upgrade the best image
  // possible"), then its standard tier — on the endpoint that takes a first frame AND a picture to arrive at
  assert.ok(srv.includes('const FAL_OMNI_STD = "fal-ai/kling-video/o3/standard/reference-to-video";') && srv.includes('const FAL_OMNI = "fal-ai/kling-video/o3/pro/reference-to-video";'));
  assert.ok(srv.indexOf('host: "fal kling 3 omni"') < srv.indexOf('host: "fal kling 3 omni standard"') && srv.indexOf('host: "fal kling 3 omni standard"') < srv.indexOf('host: "replicate kling 3 omni"'));
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
  // NO WORDS, NO CUT: the take is listened to and looked at; if the engine spoke or cut it is rolled again (once,
  // unless told otherwise) and the better roll is kept (take.ts → betterRoll: a roll that could not be heard never
  // replaces one that was, for its words)
  // (`more` is TAKE_REROLLS for one take — the same rule; a found-footage FILM's moment hands in its own, from the few
  //  rolls the film has for all of its moments: footage-film.server.ts, 2026-11-25)
  assert.ok(srv.includes("const more = opts.rerolls ?? rerolls;"));
  assert.ok(srv.includes("for (let again = 0; again < more() && rollFaulty({ cuts: cuts.length, words: said(spoke) }, silent); again++) {"));
  assert.ok(srv.includes("if (betterRoll({ cuts: nextCuts.length, words: said(nextSpoke) }, { cuts: cuts.length, words: said(spoke) }, silent)) { rawName = next; spoke = nextSpoke; cuts = nextCuts;"));
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
  assert.ok(srv.includes('"-crf", "22", "-maxrate", hd ? "10M" : "7M", "-bufsize", hd ? "20M" : "14M"') && srv.includes("const hd = look.w * look.h > 1_500_000;"));
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
  assert.ok(g.includes("[2:a]aresample=48000,aformat=channel_layouts=stereo,highpass=f=150,lowpass=f=6500,aecho=0.8:0.5:14:0.18,volume=8dB,adelay=5200|5200[v1];"));
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
  const { castTake, dramaPrompt, DRAMA_BOUNDS, DRAMA_RUN_AT, TAKE_OFFICER_VOICE } = await import("../app/lib/take.ts");
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
  // THE DIRECTION: the driver's own words, quoted ONCE each, at their second — and ONLY the driver's
  const p = takePrompt(tr, "bodycam");
  assert.equal(p, dramaPrompt(tr, "bodycam", "<<<image_1>>>"));
  assert.ok(p.includes(`AT THE SIXTH SECOND — not before — the driver says, once: "I'm not getting out of the car. I didn't do anything."`));
  assert.ok(p.includes(`AT THE FOURTEENTH SECOND — not before — the driver says, once: "Okay! Okay."`));
  assert.ok(p.indexOf("FROM THE NINTH SECOND:") < p.indexOf("LAST FOUR SECONDS:") && p.indexOf("LAST FOUR SECONDS:") < p.indexOf("AT THE FOURTEENTH SECOND"));
  assert.ok(p.includes("Each line is said once, at its moment, and never before it. Only the driver speaks in this shot; the officer wearing the camera says nothing and is never seen except the hands."));
  assert.ok(p.includes("A FICTIONAL police drama, and nobody is hurt: no weapon is drawn or fired, nobody is struck, no blood.") && p.includes("exactly as in <<<image_1>>>, "));
  // the officer's lines and the dispatcher's are NOT in it in any form (they are their own voices, laid on after)
  for (const s of tr.script!) assert.ok(!p.includes(s.text.replace(/[!.]+$/, "")), s.text);
  assert.ok(!p.includes("copy your stop") && !p.includes("Plate comes back"));
  assert.ok(p.length <= TAKE_PROMPT_MAX && !/\b(gun|shoots?|shot fired|punch|kick|taser|blood)\b/i.test(p.replace("no blood", "").replace("no weapon is drawn or fired", "")));
  // THE TRACKS: the radio during the walk-up, the officer's question as the camera reaches the window, then the chase
  // and the handcuffs — the officer's voice, firm
  assert.deepEqual(takeLines(tr), [
    { at: 0.2, text: "Unit twelve, copy your stop. Plate comes back expired.", radio: true },
    { at: 4.6, text: "Step out of the car for me." },
    { at: 9.4, text: "Hey! Stop! Stop!" },
    { at: 11.4, text: "Hands behind your back." },
  ]);
  // (the officer's question comes before the driver answers it, and nothing of ours is laid over the driver's answer)
  const answer = tr.speaks![0];
  assert.ok(tr.script![0].at < answer.at && tr.script![1].at >= DRAMA_RUN_AT && tr.script![1].at > answer.at + 2.5);
  assert.deepEqual(TAKE_OFFICER_VOICE, { id: "English_Trustworth_Man", emotion: "angry", speed: 1 });
  // the server: the driver is picked for each take, the take is fifteen seconds, and a drama that speaks is NOT rolled again
  const srv = read("app", "lib", "take.server.ts");
  assert.ok(srv.includes("const seed = parseInt(stamp().slice(-6), 16);") && srv.includes("else if (ready) take = { ...castTake(ready, seed), title: ready.name };"));
  assert.ok(srv.includes("const seconds = take.seconds || TAKE_SECONDS;") && srv.includes("direction, aspect, seconds });"));
  assert.ok(srv.includes('const silent = take.genre !== "drama";') && srv.includes("for (let again = 0; again < more() && rollFaulty({ cuts: cuts.length, words: said(spoke) }, silent); again++) {"));
  assert.ok(srv.includes('const voice = l.radio ? TAKE_RADIO_VOICE : take.genre === "drama" ? TAKE_OFFICER_VOICE : TAKE_VOICE;'));
});

test("NO VOICE WITHOUT A MOUTH IN VIEW: the walk-up is silent, every quoted line comes after the window, once — and no other take quotes anything at all", async () => {
  // the live traffic stop (2026-11-24): told "at about 4 seconds", the engine ALSO said the driver's line at 0.4–1.5 s,
  // while the camera was still walking up the road and the car was far away — a voice with no mouth, said twice
  const { dramaLines, DRAMA_WINDOW_AT } = await import("../app/lib/take.ts");
  const { HOUSE_SCARES, houseScarePrompt, parseHouseScare } = await import("../app/lib/house-cam.ts");
  const tr = takeIdea("traffic")!;
  for (const ref of [TAKE_REF.replicate, TAKE_REF.fal]) {
    const p = takePrompt(tr, "bodycam", ref);
    const walk = p.slice(p.indexOf("FIRST FOUR SECONDS — THE WALK-UP, IN SILENCE:"), p.indexOf("BY THE FIFTH SECOND"));
    assert.ok(walk.includes("Nobody speaks while the camera walks up: no voice and no word at all, only footsteps and an idling engine.") && !/["“”]/.test(walk), "the walk-up is silent");
    // every quotation comes AFTER the camera is at the window with the face in view — and each line only once
    const window = p.indexOf(`BY THE FIFTH SECOND the camera lifts to the driver's open window and stops: there, exactly as in ${ref}`);
    const inView = p.indexOf("Only now, with the camera at the window and the driver's face in full view, the driver speaks.");
    assert.ok(window > 0 && inView > window);
    const quotes = [...p.matchAll(/"([^"]+)"/g)];
    assert.equal(quotes.length, tr.speaks!.length);
    for (const q of quotes) assert.ok(q.index! > inView, `"${q[1]}" is said only once the face is in view`);
    for (const s of tr.speaks!) assert.equal(p.split(`"${s.text}"`).length - 1, 1, `"${s.text}" is quoted once`);
    // each quoted line is told its second, and "not before"
    assert.ok(/AT THE SIXTH SECOND — not before — the driver says, once: "I'm not getting out/.test(p));
  }
  // the lines as quoted: never before the window (a line timed during the walk-up is moved to it), a line written twice said once
  assert.deepEqual(dramaLines({ speaks: [{ at: 0.4, text: "Leave me alone." }, { at: 7, text: "leave me ALONE" }, { at: 12, text: '"Okay."' }] }), [{ at: DRAMA_WINDOW_AT + 1, text: "Leave me alone." }, { at: 12, text: "'Okay.'" }]);
  assert.ok(tr.speaks!.every((s) => s.at > DRAMA_WINDOW_AT), "the ready-made lines are timed after the window");
  // EVERY OTHER TAKE QUOTES NOTHING — so nothing can be said before a mouth is in view (handheld, body-cam horror, house)
  for (const i of SCARES) for (const c of i.cams || HAND_CAMS) for (const ref of [TAKE_REF.replicate, TAKE_REF.fal]) assert.ok(!/["“”]/.test(takePrompt(i, c, ref)), `${i.key}/${c}`);
  for (const s of HOUSE_SCARES) for (const ir of [true, false]) assert.ok(!/["“”]/.test(houseScarePrompt(s, "<<<image_1>>>", { ir })), `${s.key}/ir ${ir}`);
  const own = parseHouseScare({ title: "x", who: "she", thing: 'a tall woman in a "grey" nightgown', set: "", door: "the half-open door on the right", stands: 'stands “still” at the foot of the bed', waits: "", acts: "turns her head up toward the camera, slowly", sound: "" }, "bedroom")!;
  assert.ok(own && !/["“”]/.test(houseScarePrompt(own, "<<<image_1>>>")), "a written house scare has its quotes taken out");
  assert.equal(parseHouseScare({ title: "x", who: "she", thing: "a tall woman who whispers your name", set: "", door: "the half-open door on the right", stands: "stands at the foot of the bed", waits: "", acts: "turns her head up toward the camera, slowly", sound: "" }, "bedroom"), null, "a thing that speaks is not followed");
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

/* ---- EVERY CARD IS A STARTER ----
 * The owner, 2026-11-24, on the builder's cards: "These found footage options leave zero room for creativity, it's
 * just what happens". A card now puts its own words in the builder's box; left as they are, it is the ready-made
 * take (hand-tuned — untouched); changed, it is the member's own, written FROM the card, ending the way their words
 * say. (The fixtures below are made up, and look it.) */

const ZORBLAT = "My TEST grandma Zorblat is standing at the end of the dark hallway, smiling far too wide. When the light comes back, she is gone.";

test("EVERY CARD IS A STARTER: its words say what happens in it — who, where, what is wrong, how it ends — and the engine is never given them", async () => {
  const { FOOTAGE_SCARES } = await import("../app/lib/take.ts");
  assert.equal(new Set(FOOTAGE_SCARES.map((s) => s.premise)).size, FOOTAGE_SCARES.length, "each card its own words");
  for (const s of FOOTAGE_SCARES) {
    // a few lines on a phone, plain words to change — inside the box's 400 characters, nothing to trip on
    assert.ok(s.premise.length >= 80 && s.premise.length <= 240, `${s.key}: ${s.premise.length} characters`);
    assert.ok(!/["“”\n]/.test(s.premise), `${s.key}: no quotation mark, no line break`);
  }
  // each card's words say what its take is — who and where, and how it ends
  const said = Object.fromEntries(FOOTAGE_SCARES.map((s) => [s.key, s.premise]));
  assert.ok(/girlfriend/.test(said.smile) && /hallway/.test(said.smile) && /far too wide/.test(said.smile) && /walks slowly toward me until her face fills the screen\.$/.test(said.smile));
  assert.ok(/top of the stairs/.test(said.stairs) && /comes down the stairs toward me, one slow step at a time\.$/.test(said.stairs));
  assert.ok(/under the bed/.test(said.bed) && /slides out from under the bed, slowly, toward me\.$/.test(said.bed));
  assert.ok(/^A welfare check/.test(said.welfare) && /nightgown/.test(said.welfare) && /walks slowly toward me\.$/.test(said.welfare));
  assert.ok(/^A traffic stop/.test(said.traffic) && /won't get out of the car/.test(said.traffic) && /ends in handcuffs\.$/.test(said.traffic));
  assert.ok(/bedroom/.test(said.overbed) && /asleep/.test(said.overbed) && /up to the camera\.$/.test(said.overbed));
  assert.ok(/living room/.test(said.lookup) && /stares up at the camera/.test(said.lookup));
  // the engine is never given the card's words: a ready-made take is directed exactly as it always was
  for (const i of TAKE_IDEAS) for (const c of i.cams || HAND_CAMS) assert.ok(!takePrompt(i, c).includes(i.premise.slice(0, 30)), `${i.key}/${c}`);
});

test("A CARD IS A STARTER, decided on the server: its words left as they were → the ready-made take, exactly as before; changed → the member's own, written FROM the card; no card → their own words alone", async () => {
  const { cardUnchanged, footageJob, footageScare, sameWords } = await import("../app/lib/take.ts");
  const smile = footageScare("smile")!, traffic = footageScare("traffic")!, overbed = footageScare("overbed")!;
  // LEFT AS THEY WERE — no words, or the card's own, whatever the spacing, capitals, dashes, apostrophes or full stop
  const before = footageJob({ scare: "smile", camera: "phone" });
  assert.ok(before.ok && before.payload.takeIdea === "smile" && !("takeOwn" in before.payload) && !("takeFrom" in before.payload) && before.name === "She's smiling");
  for (const own of ["", smile.premise, `  ${smile.premise.toUpperCase()}  `, smile.premise.replace(/ — /g, " - ").replace(/\.$/, "")]) {
    assert.deepEqual(footageJob({ scare: "smile", own, camera: "phone" }), before, JSON.stringify(own.slice(0, 30)));
  }
  const curly = footageJob({ scare: "traffic", own: traffic.premise.replace(/'/g, "’"), camera: "bodycam" });
  assert.ok(curly.ok && curly.payload.takeIdea === "traffic" && !("takeOwn" in curly.payload), "a curly apostrophe is no change");
  // …and in the member's own language: the card's words as the page showed them (the server is handed the same translation)
  const ZZ = "ZZ-TEST: mi novia de prueba está al fondo del pasillo, sonriendo demasiado.";
  const shown = (s: string) => (s === smile.premise ? ZZ : s);
  const back = footageJob({ scare: "smile", own: ZZ, camera: "phone" }, shown);
  assert.ok(back.ok && back.payload.takeIdea === "smile" && !("takeOwn" in back.payload));
  const noLang = footageJob({ scare: "smile", own: ZZ, camera: "phone" });
  assert.ok(noLang.ok && noLang.payload.takeFrom === "smile", "without that language, the same words are a change");

  // CHANGED — the member's own take, written FROM the card: their words, and the card they started from
  const mine = footageJob({ scare: "smile", own: ZORBLAT, camera: "camcorder", aspect: "9:16" });
  assert.ok(mine.ok);
  assert.equal(mine.ok && mine.payload.takeOwn, ZORBLAT);
  assert.equal(mine.ok && mine.payload.takeFrom, "smile");
  assert.ok(mine.ok && !("takeIdea" in mine.payload) && mine.payload.takeCamera === "camcorder" && mine.payload.takeAspect === "9:16");
  // (named for their words; the Archive's tile shows the card it started from while it is made)
  assert.ok(mine.ok && mine.name.endsWith("…") && mine.name.length <= 45 && mine.payload.productTitle === `Found Footage — ${mine.name}` && mine.payload.productImageUrl === smile.img);
  // a card's words changed still have to say something; and a camera that cannot film the card is still refused
  assert.deepEqual(footageJob({ scare: "smile", own: "boo", camera: "phone" }), { ok: false, error: "Say what happens, in a few words." });
  assert.deepEqual(footageJob({ scare: "smile", own: ZORBLAT, camera: "house" }), { ok: false, error: "That camera can't film that one — pick another." });
  // quotation marks are made safe, as a take of their own words always had them
  const quoted = footageJob({ scare: "bed", own: 'Under the TEST bed: a "mime" is lying there, staring back.', camera: "phone" });
  assert.ok(quoted.ok && quoted.payload.takeOwn === "Under the TEST bed: a 'mime' is lying there, staring back." && quoted.payload.takeFrom === "bed");

  // NO CARD — their own words alone, any camera, as before
  const free = footageJob({ scare: "own", own: ZORBLAT, camera: "bare" });
  assert.ok(free.ok && free.payload.takeOwn === ZORBLAT && !("takeFrom" in free.payload) && !("takeIdea" in free.payload) && !("productImageUrl" in free.payload));

  // THE POLICE DRAMA'S words changed — the drama, written from the traffic stop
  const stop = footageJob({ scare: "traffic", own: "A TEST traffic stop outside the Zorblat County diner: the driver is a mime who won't talk, then hands over a balloon dog and gets a warning.", camera: "bodycam" });
  assert.ok(stop.ok && stop.payload.takeFrom === "traffic" && typeof stop.payload.takeOwn === "string" && stop.payload.takeAspect === "16:9");

  // A HOUSE CARD'S words changed: the room picked, else the card's; its time-lapse as the card has it, unless set
  const TALL = "A very tall TEST mime walks into the room and stands over the sleeping cat — for hours. Then it backs out the door.";
  const hb = footageJob({ scare: "overbed", own: TALL, camera: "house" });
  assert.ok(hb.ok && hb.payload.takeFrom === "overbed" && hb.payload.takeOwn === TALL && hb.payload.takeRoom === "bedroom" && hb.payload.takeLapse === true && hb.payload.takeIr === true && !("takeIdea" in hb.payload));
  const hk = footageJob({ scare: "overbed", own: TALL, camera: "house", room: "kitchen", lapse: "0" });
  assert.ok(hk.ok && hk.payload.takeRoom === "kitchen" && hk.payload.takeLapse === false);
  // …while the card left as it was keeps its own room, whatever room is sent
  const kept = footageJob({ scare: "overbed", own: overbed.premise, camera: "house", room: "kitchen" });
  assert.ok(kept.ok && kept.payload.takeIdea === "overbed" && kept.payload.takeRoom === "bedroom" && !("takeOwn" in kept.payload));

  // THE TEST ITSELF: the same words in any script; no words are never "the same"
  assert.ok(sameWords("我妹妹，梦游进厨房。", "我妹妹 梦游进厨房") && sameWords("یہ کبھی نہیں بولتا۔", "یہ کبھی نہیں بولتا") && !sameWords("我妹妹", "我弟弟"));
  assert.ok(!sameWords("", "") && !sameWords("...", "!!!"));
  assert.ok(cardUnchanged("", smile.premise) && cardUnchanged("   ", smile.premise) && !cardUnchanged("x", smile.premise));
});

test("THE WRITER STARTS FROM THE CARD: its own direction — what the member's words keep, it keeps; what they change, it changes", () => {
  const smile = takeIdea("smile")!;
  const brief = takeWriterBrief(ZORBLAT, "phone", smile);
  assert.ok(brief.includes(`THE IDEA: ${ZORBLAT}`));
  assert.ok(brief.includes(`IT STARTS FROM A READY-MADE TAKE, "She's smiling". Its own words were: ${smile.premise}`));
  assert.ok(brief.indexOf("THE IDEA:") < brief.indexOf("IT STARTS FROM") && brief.indexOf("IT STARTS FROM") < brief.indexOf("It is built the way a scare is built."));
  // every part of the card's direction is there to start from
  for (const part of [`- the scene it arrives at: ${smile.still}`, `- where the camera looks first: ${smile.opens}`, `- the first two seconds: ${smile.first}`, `- how the camera finds it: the camera ${smile.finds}`, `- (1) ${smile.beats[0]}`, `- (2) ${smile.beats[1]}`, `- (3) ${smile.beats[2]}`, `- what the one filming says: "${smile.says[0]}" (on seeing it), then "${smile.says[1]}"`, `- the sound: ${smile.sound}`]) assert.ok(brief.includes(part), part.slice(0, 60));
  assert.ok(brief.includes("Start from that direction and change it to fit THE IDEA: keep everything the idea keeps (and every detail it does not mention), and change everything it changes — who or what it is, where it is, what is wrong with it, what it does, how it ends. Where the idea says the same as the card, keep the card's own words."));
  assert.ok(takeWriterBrief(ZORBLAT, "phone", takeIdea("bed")!).includes(`"${takeIdea("bed")!.says[0]}" (while still looking)`));
  // the body cam's welfare check: its radio call is part of what is started from — and a radio call is asked for
  const w = takeIdea("welfare")!;
  const wb = takeWriterBrief("A welfare check at a TEST lighthouse: the keeper is standing at the top of the stairs.", "bodycam", w);
  assert.ok(wb.includes(`- the radio, as the take opens: "${w.radio}"`) && wb.includes('"radio": what a dispatcher says over the radio'));
  // with no card: no card
  assert.ok(!takeWriterBrief(ZORBLAT, "phone").includes("IT STARTS FROM") && !takeWriterBrief(ZORBLAT, "phone").includes(smile.still));
});

test("THE END IS THEIRS: the last beat follows the member's words — only words with no ending come at the lens — and the direction loosens one rule, only for the ending that needs it", async () => {
  const { TAKE_ENDS, TAKE_SCHEMA } = await import("../app/lib/take.ts");
  const brief = takeWriterBrief("a TEST ghost of a mime in the hall");
  // the end their words give: gone when the light comes back, right there when the camera turns back, the one filming runs, someone they know
  assert.ok(brief.includes("(3) THE END — whatever THE IDEA says happens at the end: it is gone when the light comes back; the camera turns away, turns back, and it is right there; the one filming runs; it was someone they know."));
  assert.ok(brief.includes("Only when the idea gives no ending does IT COME — slowly, smoothly, toward the camera, never taking its eyes off the lens, while the camera backs away, until it fills the frame."));
  assert.ok(!brief.includes("(3) IT COMES"), "the one fixed ending is gone");
  // still one continuous shot that a camera could film
  assert.ok(brief.includes("All of it is ONE continuous shot of about twelve seconds that a real camera could film: no cut, no jump in time, nothing a second camera would have to see. If the end needs the camera to leave it, the camera swings away; if it needs the dark, the light goes out — no flash — and comes back."));
  // THE CRAFT THAT WORKS STAYS: off the subject, the camera finds it, stillness, one impossible movement; slow; a mouth that never moves; nearly human, no gore
  for (const rule of ["FIRST, for two seconds, the camera is NOT on the thing", "THEN the camera moves and FINDS it", "(1) STILLNESS — the thing is there, perfectly still, looking at the camera.", "(2) ONE WRONG MOVEMENT — small, slow, impossible for a person", "What frightens is slowness and stillness.", "ITS MOUTH NEVER MOVES.", "nearly human and slightly wrong", "No blood, no gore, no wounds."]) assert.ok(brief.includes(rule), rule);
  // the writer says how it ends
  assert.deepEqual([...TAKE_ENDS], ["comes", "stays", "dark", "away"]);
  assert.ok(brief.includes('"ends": how THE END ends — "comes" (it comes toward the camera), "stays" (the camera stays on it and the light does not change), "dark" (the light goes out or changes), "away" (the camera turns or swings away from it)'));
  assert.ok(TAKE_SCHEMA.schema.required.includes("ends"));
  assert.deepEqual(TAKE_SCHEMA.schema.properties.ends, { type: "string", enum: ["comes", "stays", "dark", "away"] });

  // THE DIRECTION of a written take whose light goes out — or whose camera turns away
  const answer = { title: "TEST The Mime", who: "the mime", still: "A TEST mime in white face paint stands at the end of a dark hallway, perfectly still, its painted smile far too wide.", opens: "the camera looks down at bare floorboards in its own small light, nobody in the picture.", first: "the camera looks down at the floor as the one filming walks.", finds: "swings up to the hallway ahead", beats: ["the mime stands perfectly still at the end of the hall.", "its head tilts much too far, slowly.", "the light goes out; when it comes back, the hallway is empty."], says: ["Hello?", "no"], asks: "found", sound: "a floorboard creaks" };
  const comes = takePrompt(parseTake(answer)!);
  const stays = takePrompt(parseTake({ ...answer, ends: "stays" })!);
  const dark = takePrompt(parseTake({ ...answer, ends: "dark" })!);
  const away = takePrompt(parseTake({ ...answer, ends: "away" })!);
  // coming at the lens, or staying on it: the rules every ready-made scare is directed with, word for word
  assert.equal(stays, comes);
  assert.ok(comes.includes("Once the camera has found the mime it never leaves the mime: it never swings away, never drops, never falls.") && comes.includes("Nothing flashes; the light does not change; the picture never glitches or tears."));
  // "dark": the light may change — only as the last four seconds say; the camera still never leaves it
  assert.ok(dark.includes("Nothing flashes; the light changes only as the last four seconds say; the picture never glitches or tears.") && !dark.includes("the light does not change") && dark.includes("it never leaves the mime: it never swings away"));
  // "away": the camera stays on it until the last four seconds; the light still never changes
  assert.ok(away.includes("Once the camera has found the mime it stays on the mime until the last four seconds: it never drops, never falls.") && !away.includes("never swings away") && away.includes("the light does not change"));
  // whatever the ending: nobody speaks, its mouth never moves, the one filming is never seen, nothing quoted, it fits
  for (const p of [comes, dark, away]) {
    assert.ok(p.includes("NOBODY SPEAKS in this shot") && p.includes("never moves its mouth, never mouths a word") && p.includes("The one filming is never in the picture: no legs, no feet, no body."));
    assert.ok(p.includes("LAST FOUR SECONDS: the light goes out; when it comes back, the hallway is empty.") && !/["“”]/.test(p) && p.length <= TAKE_PROMPT_MAX);
  }
  // the writer's ending is read: "comes" is never written down (it is the default); an unknown one is dropped
  assert.equal(parseTake({ ...answer, ends: "DARK" })!.ends, "dark");
  assert.ok(!("ends" in parseTake({ ...answer, ends: "comes" })!) && !("ends" in parseTake({ ...answer, ends: "sideways" })!) && !("ends" in parseTake(answer)!));
  // EVERY READY-MADE SCARE ends as it always did — it comes, and fills the frame
  for (const i of SCARES) assert.ok(!i.ends && takePrompt(i).includes("it never swings away, never drops, never falls.") && takePrompt(i).includes("the light does not change"), i.key);
});

test("THE POLICE DRAMA IS A STARTER TOO: changed, it is written by a DRAMA writer — the person on camera's lines, the officer's, the radio — inside the same bounds, and nobody the default", async () => {
  const { castPick, dramaWriterBrief, DRAMA_BOUNDS, DRAMA_SCHEMA } = await import("../app/lib/take.ts");
  const tr = takeIdea("traffic")!;
  const idea = "A TEST traffic stop outside the Zorblat County diner: the driver is a mime who won't talk, then hands over a balloon dog and gets a warning.";
  const who = castPick(tr, 2)!;
  const brief = dramaWriterBrief(idea, tr, who);
  // a drama, not a scare: none of the creature's words
  assert.ok(brief.startsWith("You are directing ONE continuous fifteen-second shot of body-camera footage — a FICTIONAL police drama, not a horror"));
  for (const creature of [TAKE_WRONG, TAKE_HIDDEN, "ITS MOUTH NEVER MOVES", "nearly human", "slightly wrong", "creature"]) assert.ok(!brief.includes(creature), creature);
  // it starts from the traffic stop's own direction — with this take's person in it
  assert.ok(brief.includes(`THE IDEA: ${idea}`) && brief.includes(`IT STARTS FROM A READY-MADE TAKE, "Traffic stop". Its own words were: ${tr.premise}`));
  assert.ok(brief.includes(`- the scene it arrives at: ${tr.still.replace("{driver}", who)}`) && !brief.includes("{driver}"));
  assert.ok(brief.includes(`- how the camera finds them: the camera ${tr.finds}, and stops at the window`));
  for (const s of [...tr.speaks!, ...tr.script!]) assert.ok(brief.includes(`at ${s.at} s, "${s.text}"`), s.text);
  assert.ok(brief.includes(`- the radio, as the take opens: "${tr.radio}"`));
  assert.ok(brief.includes("keep everything the idea keeps (and every detail it does not mention), and change everything it changes — who is on camera, where it is, what they say, what they do, how it ends."));
  // NOBODY IS THE DEFAULT: when the idea does not say who, it is one of the cast — picked for each take
  assert.ok(brief.includes(`If the idea does not say who the person on camera is, it is ${who}. Never make them one kind of person by default; never mock or stereotype anyone.`));
  assert.equal(new Set([0, 1, 2, 3, 4, 5].map((s) => castPick(tr, s))).size, 6);
  assert.equal(castPick(takeIdea("smile")!, 3), undefined, "a scare has no cast");
  assert.ok(dramaWriterBrief(idea, tr).includes(`it is ${tr.cast![0]}.`), "never nobody");
  // the shape that films well, at its seconds
  for (const rule of ["the first four seconds are THE WALK-UP, in silence", "BY THE FIFTH SECOND the camera has found the person and stopped on them, their face in full view", "FROM THE NINTH SECOND, THE TURN", "THE LAST FOUR SECONDS, THE END", "All of it is ONE continuous shot a real body camera could film: no cut, no jump in time."]) assert.ok(brief.includes(rule), rule);
  // THE BOUNDS (DRAMA_BOUNDS, said to the writer)
  for (const rule of ['it is FICTION: a generic unit ("Unit twelve") of a made-up county', "no real police department, agency, badge, patch, insignia or lettering; no real place, street, person or event", "No weapon is drawn, pointed or fired; nobody is struck, nobody is hurt, no blood.", "Resisting is refusing, pulling away and a short chase; it may end in handcuffs."]) assert.ok(brief.includes(rule), rule);
  assert.ok(DRAMA_BOUNDS.includes("no weapon drawn; nobody hurt"));
  // WHO SPEAKS: the person on camera, in the shot (the mouth the engine moves is theirs); the officer never — their lines and the radio are laid on after
  assert.ok(brief.includes("the person on camera's own lines are said IN the shot — the video model moves their mouth to them — so each is short (under fifteen words), said once, after the sixth second, once their face is in view."));
  assert.ok(brief.includes("The officer wearing the camera is never seen except their hands and never speaks in the shot: the officer's lines are recorded on their own and laid over the take"));
  // the answer's shape
  for (const k of ['"speaks": [{"at":', '"script": [{"at":', '"stops":', '"radio":', '"beats":', "Answer with JSON only, in English whatever language the idea is in:"]) assert.ok(brief.includes(k), k);
  assert.deepEqual(DRAMA_SCHEMA.schema.required, ["title", "who", "still", "opens", "first", "finds", "stops", "beats", "speaks", "script", "radio", "sound"]);
  assert.deepEqual(DRAMA_SCHEMA.schema.properties.speaks.items.required, ["at", "text"]);
});

test("parseTake on a DRAMA answer: the lines with their seconds, the bounds — and it is filmed exactly as the ready-made drama is", async () => {
  const { DRAMA_LINE_ROOM, DRAMA_SECONDS, DRAMA_WINDOW_AT, dramaPrompt } = await import("../app/lib/take.ts");
  const good = {
    title: "TEST The Mime Stop", who: "The Driver",
    still: "Through the open driver's window of a small TEST hatchback stopped outside a closed roadside diner at night, washed red and blue by the patrol car's lights: a mime in white face paint and a striped shirt, looking up at the camera, silent.",
    opens: "the camera looks down at the wet asphalt of a diner parking lot in the patrol car's headlights, the back of a small hatchback at the top of the picture.",
    first: "the camera looks down at the asphalt as the officer wearing it walks to the hatchback.",
    finds: "The camera lifts to the driver's open window",
    stops: "At the window.",
    beats: ["the mime looks up at the camera, silent, both hands on the wheel.", "the mime slowly hands a balloon dog out of the window.", "the officer's hand takes the balloon dog; the mime bows, and the officer steps back from the car."],
    speaks: [{ at: 7, text: 'Officer, I am "in character".' }, { at: 12.4, text: "Thank you, officer." }],
    script: [{ at: 4.6, text: "License and registration, please." }, { at: 8, text: "Is that a balloon dog?" }, { at: 11, text: "This one's a warning." }],
    radio: "Unit twelve, copy your stop outside the TEST diner on Zorblat Road.",
    sound: "a buzzing neon sign, an idling engine",
  };
  const d = parseTake(good, "drama")!;
  assert.ok(d, "a whole drama is read");
  assert.ok(d.genre === "drama" && d.seconds === DRAMA_SECONDS && DRAMA_SECONDS === 15 && d.asks === "found");
  assert.ok(d.who === "the driver" && d.finds === "lifts to the driver's open window" && d.stops === "at the window" && d.radio === good.radio);
  // the person on camera's lines — quoted to the engine, so their quotation marks are made safe
  assert.deepEqual(d.speaks, [{ at: 7, text: "Officer, I am 'in character'." }, { at: 12.4, text: "Thank you, officer." }]);
  // the officer's — never laid over the person's: the line at 8 waits until the answer at 7 has been said
  assert.deepEqual(d.script, [{ at: 4.6, text: "License and registration, please." }, { at: 7 + DRAMA_LINE_ROOM, text: "Is that a balloon dog?" }, { at: 11, text: "This one's a warning." }]);
  assert.deepEqual(d.says, ["License and registration, please.", "This one's a warning."]);
  // FILMED AS THE READY-MADE DRAMA IS: the drama's direction, the person's own lines quoted once each, after the window
  const p = takePrompt(d, "bodycam");
  assert.equal(p, dramaPrompt(d, "bodycam", "<<<image_1>>>"));
  assert.ok(p.includes("A FICTIONAL police drama, and nobody is hurt") && p.includes("Only now, with the camera at the window and the driver's face in full view, the driver speaks."));
  assert.ok(p.includes(`AT THE SEVENTH SECOND — not before — the driver says, once: "Officer, I am 'in character'."`) && p.includes(`AT THE TWELFTH SECOND — not before — the driver says, once: "Thank you, officer."`));
  assert.equal([...p.matchAll(/"([^"]+)"/g)].length, 2, "only the person on camera's lines are quoted");
  // …and the officer's lines and the radio are NOT in it in any form: their own voices, laid on after
  for (const s of d.script!) assert.ok(!p.includes(s.text.replace(/[?.,]+$/, "")), s.text);
  assert.ok(!p.includes("Zorblat Road") && p.length <= TAKE_PROMPT_MAX);
  assert.deepEqual(takeLines(d), [
    { at: 0.2, text: "Unit twelve, copy your stop outside the TEST diner on Zorblat Road.", radio: true },
    { at: 4.6, text: "License and registration, please." },
    { at: 9.4, text: "Is that a balloon dog?" },
    { at: 11, text: "This one's a warning." },
  ]);
  // a person's line timed in the walk-up is said after the window; a place that is not one is not kept
  assert.deepEqual(parseTake({ ...good, speaks: [{ at: 1, text: "Leave me alone." }] }, "drama")!.speaks, [{ at: DRAMA_WINDOW_AT + 1, text: "Leave me alone." }]);
  const nowhere = parseTake({ ...good, stops: "whenever" }, "drama")!;
  assert.ok(!("stops" in nowhere) && takePrompt(nowhere, "bodycam").includes("Only now, with the camera stopped and the driver's face in full view, the driver speaks."));
  // REFUSED — no line for the person, none for the officer, a weapon, a blow or a wound anywhere, half a direction
  for (const bad of [
    { ...good, speaks: [] },
    { ...good, script: [] },
    { ...good, speaks: [{ at: "soon", text: "Hi." }] },
    { ...good, beats: [good.beats[0], "the officer draws his gun and points it at the driver.", good.beats[2]] },
    // (this line has no room left after the driver's at 12.4 and would be left out — the answer is refused all the same)
    { ...good, script: [...good.script, { at: 13, text: "Drop the knife!" }] },
    { ...good, beats: [good.beats[0], good.beats[1], "the driver is tased and falls, bleeding."] },
    { ...good, radio: "Unit twelve, shots fired at the TEST diner." },
    { ...good, beats: good.beats.slice(0, 2) },
    { ...good, opens: "" },
  ]) assert.equal(parseTake(bad, "drama"), null, JSON.stringify(bad).slice(0, 90));
  // …the bounds said back are not a weapon
  assert.ok(parseTake({ ...good, still: `${good.still} No weapon is drawn, no blood, nobody is hurt.` }, "drama"));
  // read as a scare, a drama's answer is no take (it has no worried question for the one filming)
  assert.equal(parseTake(good), null);
});

test("THE MAKING of a take written from a card: the card goes to its writer — the drama's to the drama writer — and a writer that fails falls back to that card, as it is", () => {
  const srv = read("app", "lib", "take.server.ts");
  assert.ok(srv.includes("const card = ready ? undefined : takeIdea(opts.from);"));
  assert.ok(srv.includes("const from = card && (card.cams || HAND_CAMS).includes(camera) ? card : undefined;"), "only a card this camera can film");
  assert.ok(srv.includes('const drama = from?.genre === "drama";'));
  assert.ok(srv.includes('written = parseTake(await anthropicText(drama && from ? dramaWriterBrief(opts.idea || "", from, castPick(from, seed)) : takeWriterBrief(opts.idea || "", camera, from), {'));
  assert.ok(srv.includes("maxTokens: drama ? 2400 : 1600,") && srv.includes("jsonSchema: drama ? DRAMA_SCHEMA : TAKE_SCHEMA,") && srv.includes('}), drama ? "drama" : undefined);'));
  assert.ok(srv.includes("const fallback = from ? castTake(from, seed) : fallbackFor(camera);") && srv.includes("take = written || { ...fallback, title: fallback.name };"));
  // a written drama is made as the ready-made one is: its fifteen seconds, the person's words not rolled away, the officer's voice
  assert.ok(srv.includes("const seconds = take.seconds || TAKE_SECONDS;") && srv.includes('const silent = take.genre !== "drama";') && srv.includes('const voice = l.radio ? TAKE_RADIO_VOICE : take.genre === "drama" ? TAKE_OFFICER_VOICE : TAKE_VOICE;'));
  // the piece says which card it was written from, and how it ends
  assert.ok(srv.includes("...(from && opts.idea ? { from: from.key } : {}),") && srv.includes("...(take.ends ? { ends: take.ends } : {}),"));
});

/* 2026-11-25, the owner, of a take made from his own words ("The Hallway at 3AM"): "weird cut in that one … 1 second to
 * 2 second the cut is far too obvious"; "why the fuck is the camera man a generic as 'roomate what are you doing no no'";
 * "voice sounds like shit he is in monotone - no fear, the wording choice is fucking sad". */

/** That take's own frames (its phone overlay cropped away), as ffmpeg measured them: [second, brightness, scene score]. */
const HALLWAY: Array<[number, number, number]> = [
  // the cut: the dark hall, then — one frame later — her, grinning, from another angle; the light hardly changes
  [1.958333, 36.2229, 0.000445], [2, 36.3948, 0.000711], [2.041667, 36.4112, 0.001929], [2.083333, 34.5999, 0.113012],
  [2.125, 35.1542, 0.041297], [2.166667, 35.7034, 0.00646], [2.208333, 38.702, 0.023573],
  // the lamp goes out (a higher score than the cut — and NOT a cut)
  [7.666667, 40.8003, 0.009094], [7.708333, 40.6661, 0.001491], [7.75, 22.5515, 0.160988], [7.791667, 22.5405, 0.001392],
  // …on again, and out again
  [10.166667, 22.2656, 0.000183], [10.208333, 28.2101, 0.058463], [10.25, 35.0488, 0.009579],
  [10.708333, 38.376, 0.001147], [10.75, 37.1048, 0.000602], [10.791667, 24.7832, 0.108775], [10.833333, 24.8449, 0.003406],
];

test("A CUT IN A ONE-SHOT TAKE (\"the cut is far too obvious\"): found by how unlike the frame before it is while the light stays — a lamp going out is not one", async () => {
  const { CUT_LIGHT, CUT_SCORE, TRIM_WITHIN, cutLookArgs, cutsAt, framesOf } = await import("../app/lib/take.ts");
  const frames = HALLWAY.map(([t, y, s]) => ({ t, y, s }));
  assert.deepEqual(cutsAt(frames), [2.08], "the cut he saw — and neither lamp");
  assert.deepEqual([CUT_SCORE, CUT_LIGHT, TRIM_WITHIN], [0.08, 5, 4]);
  // a camera swung fast is several unlike frames in a row, not one
  const swing = [0.004, 0.07, 0.11, 0.09, 0.02].map((s, i) => ({ t: i / 24, y: 30 + i, s }));
  assert.deepEqual(cutsAt(swing), []);
  // a black frame either side is the dark, not a cut
  assert.deepEqual(cutsAt([{ t: 0, y: 4, s: 0 }, { t: 0.04, y: 6, s: 0.2 }, { t: 0.08, y: 6, s: 0 }]), []);
  // read from ffmpeg's own log: one record per frame, its brightness and its score (signalstats logs more than YAVG)
  const log = [
    "[Parsed_metadata_4 @ 000002c325cacd40] frame:49   pts:25600   pts_time:2.08333",
    "[Parsed_metadata_4 @ 000002c325cacd40] lavfi.signalstats.YMIN=16",
    "[Parsed_metadata_4 @ 000002c325cacd40] lavfi.signalstats.YAVG=34.5999",
    "[Parsed_metadata_4 @ 000002c325cacd40] lavfi.signalstats.UAVG=127.1",
    "[Parsed_metadata_4 @ 000002c325cacd40] lavfi.scene_score=0.113012",
  ].join("\r\n");
  assert.deepEqual(framesOf(log), [{ t: 2.08333, y: 34.5999, s: 0.113012 }]);
  // THE REAL THING: ffmpeg run the way the server runs it, on a stand-in take — a picture that jumps to another
  // angle at 2 s, and one whose light drops at 2 s
  if (spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status !== 0) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "take-cut-"));
  try {
    const make = (name: string, second: string): string => {
      const out = path.join(dir, `${name}.mp4`);
      const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=360x640:r=24:d=2", "-f", "lavfi", "-i", "testsrc2=s=360x640:r=24:d=2",
        "-filter_complex", `[1:v]${second}[b];[0:v][b]concat=n=2:v=1[v]`, "-map", "[v]", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", out], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      return out;
    };
    const look = (file: string) => cutsAt(framesOf(spawnSync("ffmpeg", cutLookArgs(file), { encoding: "utf8", maxBuffer: 1 << 26 }).stderr));
    const cut = look(make("cut", "hflip,vflip"));
    assert.equal(cut.length, 1, `one cut: ${cut}`);
    assert.ok(Math.abs(cut[0] - 2) < 0.05, `at 2 s: ${cut}`);
    assert.deepEqual(look(make("lamp", "eq=brightness=-0.25")), [], "the light dropping is not a cut");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("A ROLL THAT CUTS IS ROLLED AGAIN, the better roll kept — and a cut still in its first seconds is cut off, its lines coming that much earlier", async () => {
  const { betterRoll, rollFaulty, shiftLines } = await import("../app/lib/take.ts");
  // which roll is kept: fewer cuts first; then, in a take that must be silent, fewer words — never an unheard one for its words
  assert.equal(betterRoll({ cuts: 0, words: 3 }, { cuts: 1, words: 0 }, true), true, "a cut is worse than a few words (those are under the voice)");
  assert.equal(betterRoll({ cuts: 0, words: null }, { cuts: 1, words: 0 }, true), true);
  assert.equal(betterRoll({ cuts: 0, words: 0 }, { cuts: 0, words: 4 }, true), true);
  assert.equal(betterRoll({ cuts: 0, words: null }, { cuts: 0, words: 4 }, true), false, "not known to be quieter");
  assert.equal(betterRoll({ cuts: 0, words: 0 }, { cuts: 0, words: 4 }, false), false, "a drama's driver is meant to speak");
  assert.equal(betterRoll({ cuts: 1, words: 0 }, { cuts: 1, words: 0 }, true), false);
  // what is rolled again: a cut, any take; words, only a silent one
  assert.equal(rollFaulty({ cuts: 1, words: 0 }, false), true);
  assert.equal(rollFaulty({ cuts: 0, words: 5 }, false), false);
  assert.equal(rollFaulty({ cuts: 0, words: 5 }, true), true);
  assert.equal(rollFaulty({ cuts: 0, words: null }, true), false);
  // a take that starts 2.08 s in: the question on finding her comes 0.72 s in (the camera has found her at once), the
  // plea 6.52 s in — still inside its last four seconds — and never before the take's first moment; the radio at its own
  assert.deepEqual(shiftLines(takeLines(takeIdea("smile")!), 2.08).map((l) => l.at), [0.72, 6.52]);
  assert.deepEqual(shiftLines([{ at: 0.3, text: "a" }, { at: 0.2, text: "r", radio: true as const }], 2.08).map((l) => l.at), [0.3, 0.2]);
  assert.deepEqual(shiftLines(takeLines(takeIdea("smile")!), 0), takeLines(takeIdea("smile")!), "no cut: as it was");

  const srv = read("app", "lib", "take.server.ts");
  // looked at as it is made, the way ffmpeg logs it (a whole take's log is far longer than `run` keeps)
  assert.ok(srv.includes('const p = spawn("ffmpeg", cutLookArgs(file), { stdio: ["ignore", "ignore", "pipe"] });') && srv.includes("resolve(code === 0 ? cutsAt(framesOf(kept)) : []);"));
  assert.ok(srv.includes("cuts = await cutsIn(path.join(dir, rawName));") && srv.includes("const nextCuts = await cutsIn(path.join(dir, next));"));
  // a cut before TRIM_WITHIN is cut off — once — and the take must still be more than four seconds long
  assert.ok(srv.includes("const early = cuts.find((t) => t > 0.3 && t < TRIM_WITHIN);") && srv.includes('if (!trimmed && early != null && !rawName.startsWith("takecut-")) {'));
  assert.ok(srv.includes('"-ss", Math.max(0, early - 0.005).toFixed(3), "-i", path.join(dir, rawName), "-c:v", "libx264", "-preset", "fast", "-tune", "film", "-crf", "18"'));
  assert.ok(srv.includes("(await secondsOf(path.join(dir, cutName))) > 4") && srv.includes("await ckpt({ ckRaw: rawName, ckTrim: String(early) });"));
  assert.ok(srv.includes("const voiced = await voiceTake(rawName, take, trimmed);") && srv.includes("const asked = shiftLines(takeLines(take), trimmed);"));
  // …and a job that restarts keeps what it found
  assert.ok(read("app", "lib", "job-queue.server.ts").includes('ckSpoke: ck("ckSpoke"), ckCuts: ck("ckCuts"), ckTrim: ck("ckTrim") },'));
  assert.ok(srv.includes("...(cuts.length ? { cuts } : {}), ...(trimmed ? { trimmed } : {}),"), "the piece says where it cut");
  // a 1080p roll (the pro tier) is dressed at 1080p, not shrunk to 720
  assert.ok(srv.includes("const hd = Math.max(rolledAt.w, rolledAt.h) >= 1800;") && srv.includes('(hd ? { w: 1080, h: 1920 } : { w: 720, h: 1280 })'));
  // THE LEVEL every film plays at: the finished take (never the roll) is levelled before its copy is kept — the
  // hallway take came out at −28 LUFS, its voice at −30, where the catalogue is −16
  assert.ok(srv.includes('import { levelFilm } from "./film-loudness.server";'));
  const lvl = srv.indexOf("if (outName !== rawName) { try { await levelFilm(outPath); } catch { /* left as it was */ } }");
  assert.ok(lvl > 0 && lvl < srv.indexOf("if (outName !== rawName) { try { await mirrorRender(outName, fs.readFileSync(outPath)); }"), "levelled before it is mirrored");
});

test("THE ONE FILMING IS PERFORMED (\"he is in monotone - no fear\") and says what a real person in THAT situation would (\"the wording choice is fucking sad\")", async () => {
  const { TAKE_ACTED, takeActing } = await import("../app/lib/take.ts");
  // ElevenLabs v3, a man's voice, low stability for a bigger performance — scared, then terrified on the last line
  assert.deepEqual(TAKE_ACTED, { voice: "Mark", stability: 0.2, style: 0.85, speed: 1 });
  assert.equal(takeActing(0, 2), "[scared] [shaky breath] [whispering]");
  assert.equal(takeActing(1, 2), "[terrified] [breathing heavily] [whispering]");
  assert.equal(takeActing(0, 1), "[scared] [shaky breath] [whispering]", "one line: said as they see it");
  const srv = read("app", "lib", "take.server.ts");
  assert.ok(srv.includes('repCreate("elevenlabs/v3", input)') && srv.includes("prompt: `${acting} ${text}`, voice: TAKE_ACTED.voice, stability: TAKE_ACTED.stability, style: TAKE_ACTED.style"));
  // the one filming in a scare is acted; a drama's officer and the radio keep their own voices; the plain voice behind it
  // (`l.mood`: a found-footage FILM's line carries the mood its writer picked; one take's lines carry none, and are
  //  said exactly as above — takeActing(0, 2) and moodVoice(voice) with no mood are the take's own two manners)
  assert.ok(srv.includes('const acted = !l.radio && take.genre !== "drama" ? await actLine(l.text, takeActing(own.indexOf(l), own.length, l.mood)) : "";'));
  assert.ok(srv.includes("const file = acted || await sayLine(l.text, moodVoice(voice, l.mood));"));
  const { moodVoice } = await import("../app/lib/take.ts");
  assert.equal(moodVoice(TAKE_VOICE), TAKE_VOICE, "no mood: the voice as it is");
  assert.equal(takeActing(0, 2, undefined), "[scared] [shaky breath] [whispering]");
  // THE WORDS: specific to what the idea says they know, broken off — never a stock line, never just "no no"
  const brief = takeWriterBrief("my roommate is standing in the hallway at 3am staring at me");
  for (const rule of ["what a real, frightened person would actually blurt in THIS situation", "the name of the person they live with", "never a stock line (\"what are you doing\", \"who is there\", \"hello?\" on its own)", "what they have just UNDERSTOOD, said out loud and broken off", "never \"no\", \"no no\", \"oh god\" or \"what the\""]) assert.ok(brief.includes(rule), rule);
  // THE CARD'S LINES ARE NEVER KEPT under the member's own words (the writer of the hallway take kept the smile card's
  // "no... no..." — what the owner heard as "roommate what are you doing no no")
  const fromCard = takeWriterBrief("my roommate is standing in the hallway at 3am staring at me", "phone", takeIdea("smile")!);
  assert.ok(fromCard.includes("BUT NEVER what the one filming says: write their words NEW, for THE IDEA (see \"says\") — not one of the card's lines, and not their shape."));
  assert.ok(!takeWriterBrief("x").includes("BUT NEVER what the one filming says"), "no card, nothing to keep");
  // …and no ready-made scare ends on "no" any more: the plea is what they understand, out loud
  assert.deepEqual(SCARES.map((i) => i.says[1]), ["babe... you're scaring me... stop—", "don't come down... please don't come down—", "it's coming out... it's coming out—", "ma'am... stop... please..."]);
  for (const i of SCARES) assert.ok(!/^\s*(oh\s+)?no\b/i.test(i.says[1]) && !/\bno[.,!\s]+no\b/i.test(i.says[1]), `${i.key}: "${i.says[1]}"`);
  assert.ok(SCARES.every((i) => i.says[0].endsWith("?")));
});

/* 2026-11-25, the owner: "Found footage needs redone … It currently appears to pipeline singular events But needs to be
 * more like \"Found Footage\" House cam, Body cam, phone or cam recording, with describe events flow like the others -
 * make it look banging and not limited". A FILM (app/lib/footage-film.ts) is several takes; what it asks of a take is
 * held here: one that is NOT a scare, and a mood for each line of the one filming. */

/** a TEST take that is no scare: a dog at a fridge */
const DOG = {
  genre: "plain" as const, who: "the dog",
  still: "A small brown TEST terrier stands on its hind legs at an open fridge in a dim kitchen, its front paws on the bottom shelf, a packet of sausages in its mouth, looking back over its shoulder at the camera.",
  opens: "the camera looks along a dim kitchen floor from the doorway — floor tiles, the leg of a table, the fridge door standing open, its light spilling out; the fridge itself is out of the picture.",
  first: "the camera looks along the kitchen floor from the doorway while the one filming stands still.",
  finds: "lifts to the open fridge",
  beats: ["the small brown terrier stands on its hind legs at the open fridge, its front paws on the bottom shelf, a packet of sausages in its mouth.", "the dog looks back over its shoulder at the camera and freezes, the packet still in its mouth.", "the dog drops to all fours and trots out of the kitchen past the camera with the packet."] as [string, string, string],
  says: ["Biscuit? ... Is that the sausages?", "oh you little thief—"] as [string, string], asks: "found" as const,
  sound: "a fridge humming, claws on floor tiles",
};

test("A TAKE THAT IS NOT A SCARE (\"make it look banging and not limited\"): no creature in its picture or its direction — and everything a take keeps, kept", async () => {
  const { PLAIN_BOUNDS, PLAIN_CAUGHT, hurtIn, plainPrompt } = await import("../app/lib/take.ts");
  // THE PICTURE: caught as it happened, in whatever light there was — never the creature recipe
  const p = takeStillPrompt(DOG, "16:9");
  assert.equal(p, `Wide 16:9 picture. ${PLAIN_CAUGHT} ${DOG.still} ${PLAIN_BOUNDS} Nothing written anywhere in the picture. No watermark, no signature.`);
  for (const creature of [TAKE_CAUGHT, TAKE_WRONG, TAKE_HIDDEN]) assert.ok(!p.includes(creature));
  assert.ok(/never CGI, never a 3D render, never an illustration/.test(PLAIN_CAUGHT) && !/night|underexposed/.test(PLAIN_CAUGHT), "real footage, and no night is claimed");
  assert.equal(PLAIN_BOUNDS, "Everyone in it is fully clothed. No blood, no gore, nobody hurt.");
  // THE WAY IN: the same place a moment earlier, in the light its scene has — what it is about is not there yet
  const o = takeOpensPrompt(DOG);
  assert.ok(o.startsWith("Vertical 9:16 picture. The SAME place and the SAME camera as the reference image, a moment earlier: the camera looks along a dim kitchen floor"));
  assert.ok(o.includes("What the camera is about to find is NOT in the picture yet. The same light and the same look as the reference image — real footage, never a render.") && o.endsWith("Nothing written anywhere."));
  assert.ok(!o.includes("the camera's own small weak light") && !o.includes("underexposed"));
  // THE DIRECTION, on every camera and both hosts
  for (const camera of ["phone", "camcorder", "bare", "bodycam", "house"] as const) for (const ref of [TAKE_REF.replicate, TAKE_REF.fal]) {
    const d = takePrompt(DOG, camera, ref);
    assert.equal(d, plainPrompt(DOG, camera, ref), "a plain take is directed by plainPrompt");
    // what every take keeps
    assert.ok(d.includes("One continuous take, no cuts, nothing written on screen. NOBODY SPEAKS in this shot: no voice, no words, no whisper — only the sound of the place."), camera);
    const at = ["FIRST TWO SECONDS:", "THEN the camera ", "THEN: ", "LAST FOUR SECONDS:"].map((m) => d.indexOf(m));
    assert.ok(at[0] > 0 && at[0] < at[1] && at[1] < at[2] && at[2] < at[3], `${camera}: four parts in order`);
    assert.ok(d.includes(`THEN the camera lifts to the open fridge — in the same shot, one smooth unbroken move, never a cut — and stops: there, exactly as in ${ref}, the small brown terrier stands`), `${camera}: found by a move, exactly as in the reference`);
    assert.ok(d.includes("Nobody in the picture speaks or mouths a word. The one filming is never in the picture: no legs, no feet, no body. Nothing flashes; the picture never glitches or tears."));
    assert.ok(d.endsWith("Sound: a fridge humming, claws on floor tiles. No voice at all. No music.") && d.length <= TAKE_PROMPT_MAX);
    // NO WORD FOR THE ENGINE: nothing quoted, and neither line of the one filming
    assert.ok(!/["“”]/.test(d) && !d.includes("Biscuit?") && !d.includes("thief"), camera);
    // nothing of the creature's: no stillness to hold, no mouth to keep shut, no list of what it never does, no night claimed
    for (const scare of ["never runs", "never flinches", "never looks away", "mouth stays exactly", "THEN, slowly:", "a quiet house at night", "at night"]) assert.ok(!d.includes(scare), `${camera}: ${scare}`);
  }
  // a body camera's keeps the drama's bounds — fiction, nobody hurt — and nobody else's does
  assert.ok(takePrompt(DOG, "bodycam").includes("A FICTIONAL scene, and nobody is hurt: no weapon is drawn or fired, nobody is struck, no blood."));
  assert.ok(!takePrompt(DOG, "phone").includes("FICTIONAL"));
  assert.equal(hurtIn("He draws his gun."), true);
  assert.equal(hurtIn("No weapon is drawn, no blood, nobody is hurt."), false);
  assert.equal(hurtIn("The dog trots out with the sausages."), false);
  // A SHORT MOMENT (a film's glimpse, under eight seconds: two of them are its way in) ends in its last THREE seconds —
  // a plain one and a scare alike; from eight seconds up, and with no length said, the last four as always
  assert.ok(takePrompt({ ...DOG, seconds: 6 }).includes("LAST THREE SECONDS: the dog drops to all fours") && !takePrompt({ ...DOG, seconds: 6 }).includes("LAST FOUR"));
  assert.ok(takePrompt({ ...DOG, seconds: 8 }).includes("LAST FOUR SECONDS:"));
  const smile = takeIdea("smile")!;
  const brief = takePrompt({ ...smile, seconds: 7, ends: "away" });
  assert.ok(brief.includes("LAST THREE SECONDS:") && brief.includes("until the last three seconds: it never drops, never falls.") && !brief.includes("four"));
  assert.ok(takePrompt({ ...smile, seconds: 7, ends: "dark" }).includes("the light changes only as the last three seconds say"));
  assert.equal(takePrompt({ ...smile, seconds: 12 }), takePrompt(smile), "twelve seconds said is twelve seconds unsaid");
});

test("A MOOD FOR EACH LINE (a film is not all terror; a plain one is never whispered in terror): a closed list, its acting tags, the plain voice behind it", async () => {
  const { TAKE_MOODS, moodVoice, takeActing, takeMood } = await import("../app/lib/take.ts");
  assert.deepEqual([...TAKE_MOODS], ["scared", "terrified", "whispering", "calm", "excited", "laughing", "annoyed", "shouting"]);
  assert.equal(takeMood(" Calm "), "calm");
  for (const not of ["furious", "", null, undefined, 3]) assert.equal(takeMood(not), undefined);
  // each mood is performed with tags of its own — tags only (the acted voice reads them and does not say them)
  const tags = TAKE_MOODS.map((m) => takeActing(0, 2, m));
  assert.equal(new Set(tags).size, TAKE_MOODS.length);
  for (const t of tags) assert.ok(/^(\[[a-z ]+\])( \[[a-z ]+\])*$/.test(t), t);
  // the first two are one take's own two manners, word for word
  assert.equal(takeActing(1, 2, "scared"), takeActing(0, 2));
  assert.equal(takeActing(0, 2, "terrified"), takeActing(1, 2));
  assert.equal(takeActing(1, 2, "calm"), "[calm] [casual]", "the mood wins over the line's place");
  assert.ok(!/whisper|scared|terrified/.test(takeActing(1, 2, "laughing") + takeActing(1, 2, "annoyed") + takeActing(1, 2, "excited") + takeActing(1, 2, "calm")));
  // the plain voice behind it: the same voice at the same speed, asked for the mood in the speech model's own words
  assert.deepEqual(moodVoice(TAKE_VOICE, "annoyed"), { ...TAKE_VOICE, emotion: "angry" });
  assert.deepEqual(moodVoice(TAKE_VOICE, "scared"), TAKE_VOICE);
  for (const m of TAKE_MOODS) assert.ok(["fearful", "neutral", "happy", "angry", "surprised"].includes(moodVoice(TAKE_VOICE, m).emotion), m);
  // the lines carry it from a take's script to the voice — a mood nobody listed is dropped, and a line without one has none
  assert.deepEqual(takeLines({ says: ["", ""], asks: "found", script: [{ at: 2.8, text: "Biscuit?", mood: "calm" }, { at: 6.6, text: "oh you little thief—", mood: "laughing" }, { at: 9, text: "hey", mood: "furious" as never }] }), [
    { at: 2.8, text: "Biscuit?", mood: "calm" }, { at: 6.6, text: "oh you little thief—", mood: "laughing" }, { at: 9, text: "hey" },
  ]);
  // …and one take's script (the traffic stop's) is what it was: no mood on any line
  assert.ok(takeLines(takeIdea("traffic")!).every((l) => !("mood" in l)));
});

/* 2026-11-25. A roll is paid for from the moment it is ASKED for — minutes before it exists — and a found-footage film
 * has three in the air at once. A job stopped in those minutes (a restart) used to ask for the roll again on its
 * resume, and pay for it twice: only the roll on the disk (ckRaw) was remembered. */
test("A ROLL IN THE AIR IS WAITED FOR, NOT PAID FOR AGAIN: the asking is kept the moment it is made, and a job that stopped mid-roll takes that roll up", () => {
  const srv = read("app", "lib", "take.server.ts");
  const roll = srv.slice(srv.indexOf("export async function rollTake("), srv.indexOf("export function inTheAir("));
  // the asking is said — its host, its model, its id — on every host, the moment the host has answered with an id
  assert.ok(roll.includes("const asked = async (host: string, model: string, id: string): Promise<string> => { try { await o.onSubmit?.(`${host}|${model}|${id}`); } catch { /* the roll is what matters */ } return id; };"));
  assert.ok(roll.includes("falVideoPoll(model, await asked(host, model, await falVideoSubmit(model, {") && roll.includes('repPoll(await asked("replicate kling 3 omni", REP_OMNI, await repCreate(REP_OMNI, {'));
  // A ROLL LEFT IN THE AIR is waited for on the host it was asked of — before any host is asked for a new one
  const waits = roll.indexOf("if (o.pending) {"), asks = roll.indexOf("const order: Array<{ host: string; fal: boolean; go: () => Promise<string> }> = [");
  assert.ok(waits > 0 && waits < asks);
  assert.ok(roll.includes('const [host, model, id] = o.pending.split("|");') && roll.includes('try { return { url: host.startsWith("fal") ? await falVideoPoll(model, id, TAKE_POLL_MS) : await repPoll(id, TAKE_POLL_MS, "take"), host }; }'));
  // …and when it cannot be had (it failed; its host has forgotten it) the take is rolled afresh, as ever
  assert.ok(roll.includes("catch (e) { console.error(`[take] the roll left in the air could not be had — rolled afresh:"));
  // handed over ONCE, for the take's first roll — a roll asked for after that (the roll again) is a new one — and
  // never when the roll is already on the disk
  assert.ok(srv.includes("let pending = left;\n  return () => { const p = pending; pending = undefined; return { ...(p ? { pending: p } : {}), onSubmit: (handle: string) => ckpt({ ckRoll: handle }) }; };"));
  assert.ok(srv.includes("const flying = inTheAir(rawName ? undefined : resume.ckRoll, ckpt);"));
  assert.ok(srv.includes("const rolled = await rollTake({ ...flying(), first: imageRef(base, firstFrame), scene: imageRef(base, still), direction, aspect, seconds });"));
  // the kept roll says where it was rolled, so a take resumed after it still does (a job that hands none back: "", as ever)
  assert.ok(srv.includes("await ckpt({ ckRaw: rawName });\n    await ckpt({ ckHost: host });") && srv.includes('let host = (rawName && resume.ckHost) || "";'));
  // a house take's the same; and the queue hands both back to both makers of one take
  const house = read("app", "lib", "house-take.server.ts");
  assert.ok(house.includes("const flying = inTheAir(rawName ? undefined : resume.ckRoll, ckpt);") && house.includes("await ckpt({ ckRaw: rawName, ckHost: host });") && house.includes('let host = (rawName && resume.ckHost) || "";'));
  const q = read("app", "lib", "job-queue.server.ts");
  assert.equal(q.split('ckRoll: ck("ckRoll"), ckRaw: ck("ckRaw"), ckHost: ck("ckHost"),').length - 1, 2);
});
