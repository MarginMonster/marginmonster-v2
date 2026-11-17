/* Speaking pitch — measured, because a voice's NAME says nothing reliable about it.
 *
 * "English_FriendlyPerson" was the app's default FEMALE voice for months. It speaks at ~100 Hz: a man.
 * Put on a girl in a film it came out "like a demon" (owner, 2026-11-17) — a low voice driven at a
 * child's pitch. The tracker here is what found it, and what now moves a line into the range the
 * picked voice really speaks in before it is re-voiced. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { trackF0, medianHz, semitonesToMatch } from "../app/lib/pitch.ts";
import { AVATAR_VOICES, DEFAULT_AVATAR_VOICE, autoCastVoices, ageOfDescription, genderOfDescription, voicesForCharacter } from "../app/lib/avatar-voice-catalog.ts";

/** A voiced-sounding test tone: a fundamental plus a few harmonics, like a sung vowel. */
function tone(hz: number, seconds = 1.2, sr = 16000): Float32Array {
  const x = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    x[i] = 0.35 * Math.sin(2 * Math.PI * hz * t) + 0.2 * Math.sin(2 * Math.PI * 2 * hz * t) + 0.1 * Math.sin(2 * Math.PI * 3 * hz * t);
  }
  return x;
}

test("the tracker reads the pitch of a voiced sound, low or high", () => {
  for (const hz of [95, 150, 220, 320, 440]) {
    const got = medianHz(trackF0(tone(hz)));
    assert.ok(got !== null && Math.abs(got - hz) / hz < 0.03, `${hz} Hz read as ${got}`);
  }
});

test("silence and noise are not mistaken for a voice", () => {
  assert.equal(medianHz(trackF0(new Float32Array(16000))), null);
  let seed = 7;
  const noise = Float32Array.from({ length: 16000 }, () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff - 0.5) * 0.5; });
  assert.equal(medianHz(trackF0(noise)), null);
});

test("a line is moved to where the picked voice speaks — in whole semitones, within an octave", () => {
  assert.equal(semitonesToMatch(320, 285), -2);   // a girl's line → a woman's voice
  assert.equal(semitonesToMatch(252, 285), 2);
  assert.equal(semitonesToMatch(320, 326), 0);    // close enough: leave it
  assert.equal(semitonesToMatch(320, 93), -12);   // capped at an octave
  assert.equal(semitonesToMatch(100, 330), 12);
  assert.equal(semitonesToMatch(null, 200), 0);   // nothing measured → nothing moved
  assert.equal(semitonesToMatch(200, null), 0);
});

// The stock voices' own pre-rendered samples, decoded with ffmpeg when it is available.
const sample = (id: string) => new URL(`../public/voice-samples/${id}.mp3`, import.meta.url);
const haveFfmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0;
function pitchOfSample(id: string): number | null {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", sample(id).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], { maxBuffer: 1 << 27 });
  if (r.status !== 0) return null;
  const b = r.stdout as Buffer;
  const x = new Float32Array(b.length >> 1);
  for (let i = 0; i < x.length; i++) x[i] = b.readInt16LE(i * 2) / 32768;
  return medianHz(trackF0(x));
}

test("every voice in the catalog has a sample to play", () => {
  for (const v of AVATAR_VOICES) assert.ok(existsSync(sample(v.id)) && readFileSync(sample(v.id)).length > 5000, `${v.id} has no sample`);
});

test("no voice filed under FEMALE speaks in a man's register, and none under MALE in a girl's", { skip: !haveFfmpeg && "ffmpeg not available" }, () => {
  for (const v of AVATAR_VOICES) {
    const hz = pitchOfSample(v.id);
    assert.ok(hz !== null, `couldn't measure ${v.id}`);
    // adult speech: men ~85–180 Hz, women ~165–260 Hz, children higher. "Warm & wise" is an older
    // woman at ~147 Hz, so the floor for the female list is set under her and well over the men's 100.
    if (v.gender === "f") assert.ok(hz! >= 135, `${v.id} is listed as female but speaks at ${hz!.toFixed(0)} Hz`);
    else assert.ok(hz! <= 200, `${v.id} is listed as male but speaks at ${hz!.toFixed(0)} Hz`);
  }
});

test("the default female voice is a woman's", { skip: !haveFfmpeg && "ffmpeg not available" }, () => {
  const hz = pitchOfSample(DEFAULT_AVATAR_VOICE.f);
  assert.ok(hz !== null && hz > 180, `default female voice speaks at ${hz} Hz`);
  const def = AVATAR_VOICES.find((v) => v.id === DEFAULT_AVATAR_VOICE.f);
  assert.equal(def?.gender, "f");
  assert.equal(AVATAR_VOICES.find((v) => v.id === DEFAULT_AVATAR_VOICE.m)?.gender, "m");
});

test("a written character's gender and age are read from the description", () => {
  assert.equal(genderOfDescription("June, a 11-year-old girl with a short dark bob"), "f");
  assert.equal(genderOfDescription("Marcus, a tired man in his fifties"), "m");
  assert.equal(genderOfDescription("Sam, a barista"), null);
  assert.equal(ageOfDescription("June, a 11-year-old girl with a short dark bob"), "young");
  assert.equal(ageOfDescription("Madalynn, a 14-year-old girl"), "young");
  assert.equal(ageOfDescription("Rosa, her grandmother"), "mature");
  assert.equal(ageOfDescription("Eli, a 72-year-old fisherman"), "mature");
  assert.equal(ageOfDescription("Dana, his girlfriend, a nurse"), "adult");
  assert.equal(ageOfDescription("Marcus, a tired detective"), "adult");
});

test("a child is given the young voice and an elder the mature one", () => {
  assert.equal(voicesForCharacter("f", "young")[0], "English_PlayfulGirl");
  assert.equal(voicesForCharacter("f", "mature")[0], "English_Wiselady");
  assert.equal(voicesForCharacter("m", "young")[0], "English_Comedian");
  // an adult is not handed the child's or the elder's voice while an adult one is free
  const adultF = voicesForCharacter("f", "adult");
  assert.ok(!["English_PlayfulGirl", "English_Wiselady"].includes(adultF[0]));
  assert.equal(new Set(adultF).size, AVATAR_VOICES.filter((v) => v.gender === "f").length, "every female voice stays reachable");
});

test("two people in a scene never share a voice, and a presenter's voice is left alone", () => {
  const sisters = [
    { desc: "Madalynn, a 14-year-old girl", voiceId: null, auto: true },
    { desc: "June, a 11-year-old girl", voiceId: null, auto: true },
  ];
  const first = autoCastVoices(sisters);
  assert.equal(first[0], "English_PlayfulGirl");
  assert.ok(first[1] && first[1] !== first[0]);
  // Madalynn is then cast with a presenter who brings her own voice: June's pick moves to the best free one
  const cast = autoCastVoices([{ ...sisters[0], voiceId: "English_ConfidentWoman", auto: false }, sisters[1]]);
  assert.deepEqual(cast, ["English_ConfidentWoman", "English_PlayfulGirl"]);
  // every pick is a voice of the character's own gender
  const mixed = autoCastVoices([{ desc: "Ana, a woman", voiceId: null, auto: true }, { desc: "Ben, a man", voiceId: null, auto: true }, { desc: "the robot", voiceId: null, auto: true }]);
  assert.equal(AVATAR_VOICES.find((v) => v.id === mixed[0])?.gender, "f");
  assert.equal(AVATAR_VOICES.find((v) => v.id === mixed[1])?.gender, "m");
  assert.equal(mixed[2], null);
});
