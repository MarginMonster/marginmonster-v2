/* Character voices: the takes the owner picked by ear are what the app performs — and a character
 * voice id never reaches a speech model that does not know it.
 *
 * What went wrong before (2026-11-17): the six stock characters "spoke" in ordinary announcer voices
 * (his monster showed "Trustworthy · Warm and steady"), pitch-shifted announcers were thrown out by ear,
 * and the voices he then approved — acted takes, the monsters' through creature chains — sat in a
 * comment, wired to nothing. These pin the wiring: the recipe that is performed is the recipe that was
 * approved, shaped the way the approved takes were, and every pipeline asks "is this a character voice?"
 * before it sends a voice id anywhere. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CHARACTER_VOICES, DEFAULT_CHARACTER_VOICE, characterVoice, characterVoiceSample, isCharacterVoice } from "../app/lib/character-voices.ts";
import { CREATURE_CHAINS, GHOST_LEAD_S, PASSAGE_MAX, actedPassages, chainGraph, elevenInput, passagesOf } from "../app/lib/character-voice-core.ts";
import { AVATAR_VOICE_IDS, isPersonalVoice, safeVoiceId } from "../app/lib/avatar-voice-catalog.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const voice = (id: string) => { const v = characterVoice(id); assert.ok(v, `${id} is not a character voice`); return v!; };

test("the six voices the owner approved are the catalog, each with its approved take on the disk", () => {
  assert.deepEqual(CHARACTER_VOICES.map((v) => v.id).sort(), ["char:coco", "char:dot", "char:howl", "char:keeper", "char:mary", "char:pip"]);
  for (const v of CHARACTER_VOICES) {
    assert.equal(v.id, `char:${v.key}`);
    const sample = path.join(root, "public", characterVoiceSample(v.id));
    assert.ok(fs.existsSync(sample) && fs.statSync(sample).size > 5000, `${v.id}: ${characterVoiceSample(v.id)} is missing`);
    assert.ok(v.label && v.blurb && v.style.length > 20, `${v.id} needs a name, a line of character and its voice in words`);
  }
  // what he picked, by ear: cartoons as they come (round 2, option A); monsters acted AND chained (round 3)
  assert.deepEqual(voice("char:pip").acting, { voice: "Kuon", before: "[excited] [giggling]", stability: 0.3, style: 0.7, speed: 1.08 });
  assert.deepEqual(voice("char:dot").acting, { voice: "Kuon", before: "[childlike] [amazed] [giggles]", stability: 0.3, style: 0.8, speed: 1.0 });
  assert.deepEqual(voice("char:coco").acting, { voice: "Austin", before: "[sleepy] [slow drawl]", after: "[yawns]", stability: 0.35, style: 0.6, speed: 0.9 });
  assert.equal(voice("char:howl").acting.chain, "feral2");
  assert.equal(voice("char:mary").acting.chain, "ghost");
  assert.equal(voice("char:keeper").acting.chain, "hollow");
  for (const id of ["char:pip", "char:dot", "char:coco"]) assert.equal(voice(id).acting.chain, undefined, `${id}: a cartoon voice is used as it comes`);
});

test("a character voice is not a stock voice, not a cloned voice, and not whatever starts with char:", () => {
  for (const v of CHARACTER_VOICES) {
    assert.equal(isCharacterVoice(v.id), true);
    assert.equal(AVATAR_VOICE_IDS.has(v.id), false, `${v.id} must not be in the stock catalog — it is not a MiniMax voice`);
    // "personal" = somebody's own cloned voice: those are sent to voice conversion and refused substitution
    assert.equal(isPersonalVoice(v.id), false, `${v.id} would be treated as a merchant's cloned voice`);
  }
  for (const junk of ["char:", "char:zzz", "char:__proto__", "char:constructor", "howl", "", null, undefined]) {
    assert.equal(isCharacterVoice(junk as string), false, `${String(junk)} is not a character voice`);
    assert.equal(characterVoice(junk as string), null);
  }
  // an id nobody knows still falls back to a stock voice everywhere a stock voice is expected
  assert.equal(safeVoiceId("char:zzz", "f"), "English_CalmWoman");
});

test("a new cartoon or creature starts with a voice of its own kind", () => {
  for (const kind of ["cartoon", "monster"] as const) {
    for (const g of ["f", "m"] as const) {
      const v = voice(DEFAULT_CHARACTER_VOICE[kind][g]);
      assert.equal(v.kind, kind);
      assert.equal(v.gender, g);
    }
  }
});

test("a line is acted in the shape of the takes that were approved", () => {
  // Howl's approved take: "[guttural] [feral snarl] You shouldn't have come out here. [low growl] Not... tonight. [roars]"
  assert.deepEqual(actedPassages(voice("char:howl"), "You shouldn't have come out here. Not... tonight."),
    ["[guttural] [feral snarl] You shouldn't have come out here. [low growl] Not... tonight. [roars]"]);
  // Mary's: the sob falls between her sentences, nothing after
  assert.deepEqual(actedPassages(voice("char:mary"), "I've been waiting... such a long time. Won't you stay with me?"),
    ["[ghostly] [breathy whisper] [weeping] I've been waiting... such a long time. [soft sob] Won't you stay with me?"]);
  // one sentence: there is no "between" to put anywhere
  assert.deepEqual(actedPassages(voice("char:howl"), "Run."), ["[guttural] [feral snarl] Run. [roars]"]);
  // a cartoon: opening directions only (and Coco's yawn to finish)
  assert.deepEqual(actedPassages(voice("char:pip"), "Hi! Want to see my bandana?"), ["[excited] [giggling] Hi! Want to see my bandana?"]);
  assert.deepEqual(actedPassages(voice("char:coco"), "No rush, friend."), ["[sleepy] [slow drawl] No rush, friend. [yawns]"]);
  assert.deepEqual(actedPassages(voice("char:pip"), "   "), [], "nothing to say, nothing to act");
});

test("a maker's own text cannot direct the voice model", () => {
  const [p] = actedPassages(voice("char:keeper"), "Open the door [screams] and come in [laughs].");
  assert.equal(p, "[deep] [slow] [menacing whisper] Open the door (screams) and come in (laughs).");
});

test("a long narration is acted passage by passage — nothing dropped, nothing reordered, one ending", () => {
  const story = Array.from({ length: 40 }, (_, i) => `Sentence number ${i + 1} walks slowly down the long dark hallway of the old house.`).join(" ");
  const passages = passagesOf(story);
  assert.ok(passages.length >= 4, `only ${passages.length} passages for ${story.length} characters`);
  for (const p of passages) assert.ok(p.length <= PASSAGE_MAX, `a passage of ${p.length} characters`);
  assert.equal(passages.join(" "), story, "every word, in order");
  const acted = actedPassages(voice("char:howl"), story);
  assert.equal(acted.length, passages.length);
  for (const [i, a] of acted.entries()) {
    assert.ok(a.startsWith("[guttural] [feral snarl] "), "every passage opens in character");
    assert.equal(a.endsWith("[roars]"), i === acted.length - 1, "the closing roar comes once, at the very end");
    assert.equal((a.match(/\[low growl\]/g) || []).length, 1, "one growl a passage, not one a sentence");
  }
  // a single sentence longer than a passage is cut at a word, not lost
  const run = `${"word ".repeat(400)}end.`;
  assert.equal(passagesOf(run).join(" ").replace(/\s+/g, " "), run);
});

test("the voice model is asked for the approved voice, with the approved settings", () => {
  const v = voice("char:keeper");
  assert.deepEqual(elevenInput(v, "x", "en"), { prompt: "x", voice: "Reginald", stability: 0.3, style: 0.8, speed: 0.85, similarity_boost: 0.75, language_code: "en" });
  assert.equal(elevenInput(v, "x", "es").language_code, "es");
  for (const odd of [null, undefined, "", "english", "en-US"]) assert.equal(elevenInput(v, "x", odd as string).language_code, "en");
});

test("the creature chains are the ones the approved takes went through", () => {
  // hollow: formants down 0.88, a sub layer, three echoes, the top rolled off at 3.2 kHz
  assert.match(CREATURE_CHAINS.hollow, /asetrate=44100\*0\.88,aresample=44100,atempo=1\.1364,asubboost,aecho=0\.8:0\.75:90\|180\|270:0\.4\|0\.25\|0\.15,lowpass=f=3200\[o\]$/);
  // feral2: formants down 0.84 into soft clipping, an octave-down double, a chorus
  assert.match(CREATURE_CHAINS.feral2, /asetrate=44100\*0\.84,aresample=44100,atempo=1\.1905,volume=5dB,asoftclip=type=atan:threshold=0\.5/);
  assert.match(CREATURE_CHAINS.feral2, /asetrate=44100\*0\.5,aresample=44100,atempo=2\.0,lowpass=f=700,volume=0\.7/);
  assert.match(CREATURE_CHAINS.feral2, /chorus=0\.6:0\.9:25:0\.4:0\.25:2\[o\]$/);
  // ghost: reverse-reverb swell, a whisper double 40 ms late and 3 % up, a long echo
  assert.match(CREATURE_CHAINS.ghost, /highpass=f=150,asplit=3/);
  assert.match(CREATURE_CHAINS.ghost, /areverse,apad=pad_dur=1\.0,aecho=0\.8:0\.9:350\|700:0\.55\|0\.35,areverse,volume=0\.7/);
  assert.match(CREATURE_CHAINS.ghost, /adelay=1040:all=1,asetrate=44100\*1\.03,aresample=44100,atempo=0\.9709,volume=0\.35/);
  assert.match(CREATURE_CHAINS.ghost, /aecho=0\.8:0\.8:180\|420:0\.3\|0\.2\[o\]$/);
  // every finished line leaves at one loudness; a voice with no chain is only levelled
  assert.equal(chainGraph(undefined), "[0:a]aresample=44100,loudnorm=I=-16:TP=-1.5:LRA=11[n]");
  for (const c of ["hollow", "feral2", "ghost"] as const) assert.ok(chainGraph(c).endsWith(";[o]loudnorm=I=-16:TP=-1.5:LRA=11[n]"));
  // on a film clip the ghost's lead-in is trimmed back off, so her words stay under her mouth
  assert.equal(GHOST_LEAD_S, 1);
  assert.ok(chainGraph("ghost", { inSync: true }).endsWith(";[o]atrim=start=1,asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=11[n]"));
  assert.equal(chainGraph("hollow", { inSync: true }), chainGraph("hollow"), "the other chains keep time already");
});

test("every chain is a graph ffmpeg accepts, and keeps a line the length it was", { skip: spawnSync("ffmpeg", ["-version"]).status !== 0 && "ffmpeg is not on this machine" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chain-"));
  try {
    const src = path.join(dir, "in.wav");
    // three seconds of a voiced-ish tone with gaps: enough for every filter to have something to chew on
    let r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=180:duration=3", "-af", "tremolo=f=4:d=0.9", "-ar", "44100", "-ac", "1", src], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const len = (f: string) => parseFloat(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).stdout.trim());
    for (const c of [undefined, "hollow", "feral2", "ghost"] as const) {
      for (const inSync of [false, true]) {
        const out = path.join(dir, `${c || "plain"}-${inSync}.wav`);
        r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-filter_complex", chainGraph(c, { inSync }), "-map", "[n]", "-ar", "44100", out], { encoding: "utf8" });
        assert.equal(r.status, 0, `${c || "plain"} (inSync ${inSync}): ${r.stderr.slice(-300)}`);
        const d = len(out);
        // echoes ring on after the line (and the ghost's voice-over version leads in) — never shorter than the line
        assert.ok(d >= 2.9, `${c || "plain"} (inSync ${inSync}) came out ${d.toFixed(2)}s from a 3s line`);
        if (c === "ghost") assert.ok(inSync ? d < 4.6 : d >= 3.9, `ghost inSync=${inSync}: ${d.toFixed(2)}s`);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("no pipeline sends a character voice to a speech model that does not know it", () => {
  // Talking ads: the character branch comes before either stock-voice call.
  const ugc = read("app/lib/ugc-ad-pipeline.server.ts");
  const fresh = ugc.slice(ugc.indexOf("const freshTts = async (): Promise<string> => {"));
  const charAt = fresh.indexOf("if (isCharacterVoice(delivery.voice))");
  assert.ok(charAt > 0 && charAt < fresh.indexOf('delivery.voice.startsWith("ttv-")') && charAt < fresh.indexOf('repCreate("minimax/speech-02-hd"'), "talking ads: character voices are spoken by their own engine first");
  assert.match(fresh.slice(charAt, charAt + 900), /speakCharacter\(delivery\.voice, script/);
  // Cartoon ads: a presenter's character voice is kept, and performed, not sent to MiniMax.
  const toon = read("app/lib/cartoon-ad-pipeline.server.ts");
  assert.match(toon, /isPersonalVoice\(own\) \|\| isCharacterVoice\(own\)/);
  const tts = toon.slice(toon.indexOf("let audioUrl: string;"));
  assert.ok(tts.indexOf("if (isCharacterVoice(cartoonVoice))") < tts.indexOf('repCreate("minimax/speech-02-hd"'), "cartoon ads: the character branch precedes the stock speech call");
  // Films: a character voice is described to the video model and its chain laid over the line — it is
  // never handed to the voice-conversion trainer, which only knows stock and cloned voices.
  const film = read("app/lib/film-dialogue.server.ts");
  assert.match(film, /!isCharacterVoice\(v\) && \(opts\.lockVoices \|\| isPersonalVoice\(v\)\)/, "films: character voices stay out of the re-voice trainer");
  assert.match(film, /characterVoice\(a\.voiceId\)/, "films: the character's voice is described to the video model");
  assert.match(film, /chainClipVoice\(/, "films: a creature's chain is laid over its own lines");
  // Saving a voice: the three places an id is checked all accept a character voice.
  assert.match(read("app/lib/voice-clone.server.ts"), /AVATAR_VOICE_IDS\.has\(want\) \|\| isCharacterVoice\(want\)/);
  assert.match(read("app/lib/custom-avatars.server.ts"), /AVATAR_VOICE_IDS\.has\(voiceId\) \|\| isCharacterVoice\(voiceId\)/);
});
