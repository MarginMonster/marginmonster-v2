/* HINDI AND URDU — written, spoken and captioned.
 *
 * 2026-11-24, a tester in Pakistan: "why we not add option like voice in different languages rather than
 * english like our urdu, indians hindhi because this app use world wide". The owner: "correct everything".
 *
 * What it took, and what these hold:
 *   WRITTEN   the writer is told the SCRIPT (Devanagari; Urdu script — never Roman Urdu) and the register
 *   SPOKEN    MiniMax reads Hindi (and, with the Hindi boost, Urdu script); a story's stock narrator is read
 *             by a native voice of the same kind — Hindi by MiniMax's Hindi voices, Urdu by ElevenLabs v3
 *   CAPTIONED drawtext on the server cannot SHAPE these scripts, so every look is drawn by the subtitle
 *             renderer (libass): the marks are kept, the cards are cut where the language breathes, Urdu
 *             runs right to left, in fonts shipped in public/fonts — and anything that only has drawtext
 *             draws no words, never broken ones.
 * The last tests really render frames with ffmpeg and look at where the lit word is. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  CONTENT_LANGS, CONTENT_LANG_NATIVE, LANG_VOICES, LANG_VOICE_BACKUP, askedContentLang, hasRtl, langDirective, nativeVoice, needsShaping, normalizeContentLang, voiceLangOpts,
} from "../app/lib/content-lang.ts";
import { speechModelVoice, storyReader } from "../app/lib/story-voice.ts";
import { AVATAR_VOICES } from "../app/lib/avatar-voice-catalog.ts";
import { SHAPED_FACES, fontMagic, shapedFaceFor } from "../app/lib/caption-font.ts";
import { canDraw, readFontMetrics } from "../app/lib/font-metrics.ts";
import { passagesOf } from "../app/lib/character-voice-core.ts";
import {
  HIGHLIGHT_RGB, boldCards, captionFilters, drawable, nativeMarks, saidUnits, sceneWindows, scriptWordTimes, shapedAss, subtitleCards, subtitleChars, textWidth, type Card, type WordT,
} from "../app/lib/narrated-core.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

/** every word of every line heard, 0.3 s apart, half a second between scenes */
function told(lines: string[], lang: string) {
  const words: WordT[] = [];
  let t = 0.2;
  for (const l of lines) { for (const u of saidUnits(l)) { words.push({ word: u, start: t, end: t + 0.25 }); t += 0.3; } t += 0.5; }
  const win = sceneWindows(lines, words, t);
  const timed = scriptWordTimes(lines, words, win);
  return { words, win, timed, total: t, bold: boldCards(timed, lang) };
}
const events = (ass: string) => ass.split("\n").filter((l) => l.startsWith("Dialogue: ")).map((l) => {
  const f = l.slice("Dialogue: ".length).split(",");
  return { start: f[1], end: f[2], style: f[3], text: f.slice(9).join(",") };
});

// ---- WRITTEN ---------------------------------------------------------------------------------------------

test("Hindi and Urdu are content languages, by their own names, with the script named for the writer", () => {
  assert.deepEqual(Object.keys(CONTENT_LANGS), ["en", "es", "fr", "de", "zh", "hi", "ur"]);
  assert.deepEqual(Object.keys(CONTENT_LANG_NATIVE), Object.keys(CONTENT_LANGS), "a native name for every one");
  assert.equal(CONTENT_LANG_NATIVE.hi, "हिन्दी");
  assert.equal(CONTENT_LANG_NATIVE.ur, "اردو");
  assert.match(CONTENT_LANGS.hi, /^Hindi \(.*Devanagari script\)$/);
  assert.match(CONTENT_LANGS.ur, /^Urdu \(.*Urdu script\)$/);
  // a store's locale, a page's pick
  assert.equal(normalizeContentLang("hi-IN"), "hi");
  assert.equal(normalizeContentLang("ur_PK"), "ur");
  assert.equal(askedContentLang("ur"), "ur");
  assert.equal(askedContentLang(" HI "), "hi");
  assert.equal(askedContentLang("ja"), null, "not one of ours: the caller keeps its own (not English)");
  assert.equal(askedContentLang(""), null);
  assert.equal(askedContentLang(undefined), null);
  assert.equal(askedContentLang(42), null);
});

test("the writer is told the script, the everyday register — and never Roman letters", () => {
  const hi = langDirective("hi"), ur = langDirective("ur");
  assert.ok(hi.startsWith(" IMPORTANT: Write ALL output in Hindi (everyday spoken Hindi, in Devanagari script) — every sentence, headline and line."), hi);
  assert.ok(hi.includes("in the Devanagari script, never in Roman letters"), hi);
  assert.ok(ur.startsWith(" IMPORTANT: Write ALL output in Urdu (everyday spoken Urdu, in Urdu script) — every sentence, headline and line."), ur);
  assert.ok(ur.includes("in the Urdu (Perso-Arabic) script, never in Roman letters or Devanagari"), ur);
  for (const d of [hi, ur]) assert.ok(d.includes("Keep the brand and product names exactly as given"), "brand names stay");
  assert.equal(langDirective("en"), "", "English prompts stay byte-identical");
  assert.equal(langDirective("es"), " IMPORTANT: Write ALL output in Spanish — every sentence, headline and line. Keep the brand and product names exactly as given (do not translate them).", "the other languages are as they were");
  // the film writer, the translator and the title read the same name (film-engine → langName)
  assert.ok(read("app", "lib", "film-engine.server.ts").includes("const langName = CONTENT_LANGS[langCode] || \"English\";"));
  // …and the dashboard's own list shows the name alone
  assert.ok(read("app", "routes", "web._index.tsx").includes("{String(name).replace(/ \\(.*\\)$/, \"\")}"));
});

// ---- SPOKEN ----------------------------------------------------------------------------------------------

test("the speech model is told Hindi for both — it has no Urdu, and its Hindi model reads Urdu script", () => {
  assert.deepEqual(voiceLangOpts("hi"), { language_boost: "Hindi", english_normalization: false });
  assert.deepEqual(voiceLangOpts("ur"), { language_boost: "Hindi", english_normalization: false });
  assert.deepEqual(voiceLangOpts("en"), { language_boost: "English", english_normalization: true }, "English as it was");
  assert.deepEqual(voiceLangOpts("zh"), { language_boost: "Chinese", english_normalization: false });
});

test("a stock narrator is read by a native voice of the same kind in Hindi and Urdu — and reads the rest itself", () => {
  assert.deepEqual(nativeVoice("hi", "m"), { engine: "minimax", voice: "hindi_male_1_v2" });
  assert.deepEqual(nativeVoice("hi", "f"), { engine: "minimax", voice: "hindi_female_2_v1" });
  assert.deepEqual(nativeVoice("ur", "m"), { engine: "eleven", voice: "Mark" });
  assert.deepEqual(nativeVoice("ur", "f"), { engine: "eleven", voice: "Hope" });
  for (const l of ["en", "es", "fr", "de", "zh", null, "xx"]) assert.equal(nativeVoice(l, "m"), null, String(l));
  for (const v of AVATAR_VOICES) {
    // every stock voice, both languages: a voice of ITS gender
    assert.deepEqual(storyReader(v.id, "hi"), LANG_VOICES.hi[v.gender], v.id);
    assert.deepEqual(storyReader(v.id, "ur"), { ...LANG_VOICES.ur[v.gender], backup: LANG_VOICE_BACKUP.ur[v.gender] }, v.id);
    for (const l of ["en", "es", "zh"]) assert.deepEqual(storyReader(v.id, l), { engine: "minimax", voice: v.id }, `${v.id} reads ${l} itself`);
  }
  // the formats' own narrators keep their kind: a deep man for horror, a calm woman for a bedtime story
  assert.equal(storyReader("English_ManWithDeepVoice", "ur").voice, "Mark");
  assert.equal(storyReader("English_CalmWoman", "hi").voice, "hindi_female_2_v1");
  // the Urdu backup is the Hindi voice of the same kind, on the speech model with the Hindi boost
  assert.equal(storyReader("English_CalmWoman", "ur").backup, "hindi_female_2_v1");
  // a character voice, or a member's own voice, is not a stock voice: it reads the language itself
  for (const id of ["char:keeper", "moss_audio_0123", ""]) assert.deepEqual(storyReader(id, "ur"), { engine: "minimax", voice: id }, id);
});

test("a faceless video (the speech model only) is read by MiniMax's own Hindi voice of the same kind, in both", () => {
  assert.equal(speechModelVoice("English_CalmWoman", "hi"), "hindi_female_2_v1");
  assert.equal(speechModelVoice("English_Trustworth_Man", "ur"), "hindi_male_1_v2", "Urdu script, read by the Hindi model");
  assert.equal(speechModelVoice("English_CalmWoman", "es"), "English_CalmWoman", "the rest as they were");
  assert.equal(speechModelVoice("moss_audio_mine", "ur"), "moss_audio_mine", "the member's own voice is theirs");
  assert.ok(read("app", "lib", "faceless-video.server.ts").includes("const voiceId = ownVoice || speechModelVoice(VOICE_MAP[opts.voiceKey || \"\"] || VOICE_MAP[`${script.voiceGender || \"f\"}-warm`] || VOICE_MAP[\"f-warm\"], lang);"));
});

test("the narration takes that road: Urdu by ElevenLabs first, the Hindi voice if that fails; every call names the language", () => {
  const nar = read("app", "lib", "narrated-story.server.ts");
  const fn = nar.slice(nar.indexOf("export async function narrate("), nar.indexOf("/** Put it together:"));
  assert.ok(fn.indexOf("if (isCharacterVoice(voice)) {") < fn.indexOf("const reader = storyReader(voice, lang);"), "a character voice is its own");
  assert.ok(fn.includes("const made = await speakStock(reader.voice, text, { lang: normalizeContentLang(lang), stage: \"narration\" });"));
  assert.ok(fn.includes("const reads = reader.engine === \"eleven\" ? reader.backup || voice : reader.voice;"));
  assert.ok(fn.includes("repCreate(\"minimax/speech-02-hd\", { text, voice_id: reads, ...voiceLangOpts(lang) })"));
  assert.ok(fn.includes("repCreate(\"minimax/speech-02-turbo\", { text, voice_id: reads, ...voiceLangOpts(lang) })"));
  const cv = read("app", "lib", "character-voice.server.ts");
  assert.ok(cv.includes("export async function speakStock(elevenVoice: string, text: string, opts: { lang?: string | null; stage?: string } = {}): Promise<SpokenLine> {"));
  assert.ok(cv.includes("acting: { voice: elevenVoice, before: \"\", stability: 0.5, style: 0, speed: 1 },"), "plainly: no acting tags, no creature chain");
});

test("a long story in Urdu or Hindi is cut into passages at its own full stops, never mid-sentence", () => {
  const ur = Array.from({ length: 14 }, (_, i) => `یہ کہانی کا جملہ نمبر ${i + 1} ہے جو ایک پرانی حویلی کے بارے میں ہے؟`.replace(/؟$/, i % 3 ? "۔" : "؟")).join(" ");
  const hi = Array.from({ length: 14 }, (_, i) => `यह कहानी का वाक्य नंबर ${i + 1} है जो एक पुरानी हवेली के बारे में है।`).join(" ");
  for (const [text, end] of [[ur, /[۔؟]$/], [hi, /।$/]] as const) {
    const ps = passagesOf(text);
    assert.ok(ps.length >= 2, `${ps.length} passages`);
    for (const p of ps) assert.match(p, end, `a passage ends with its sentence: …${p.slice(-20)}`);
    assert.equal(ps.join(" "), text, "nothing dropped, nothing moved");
  }
});

// ---- CAPTIONED: the words ------------------------------------------------------------------------------

test("the words keep their marks — a Hindi vowel sign is half of every word", () => {
  assert.equal(drawable("पुरानी हवेली में दीया जल उठा।"), "पुरानी हवेली में दीया जल उठा.", "vowel signs, nasal marks — and the danda read as a full stop");
  assert.equal(drawable("क्षेत्र, धर्म और कार्य॥"), "क्षेत्र, धर्म और कार्य.", "conjuncts (virama) and the double danda");
  assert.equal(drawable("اس رات چراغ جل اٹھا۔"), "اس رات چراغ جل اٹھا.");
  assert.equal(drawable("بیٹا، صبر کرو؛ کیا یہ سچ ہے؟"), "بیٹا, صبر کرو, کیا یہ سچ ہے?", "Urdu's comma, semicolon and question mark read as ours");
  assert.equal(drawable("سو ٪ سچ"), "سو % سچ");
  // (the old allow-list kept letters only: "पुरानी" became "परन")
  assert.notEqual(drawable("पुरानी"), "परन");
  // everything else exactly as before
  assert.equal(drawable("Take 20% off: today!"), "Take 20% off today!");
  assert.equal(drawable("Don't stop — believin'!"), "Don’t stop believin’!");
});

test("…and are drawn with the script's own marks again", () => {
  assert.equal(nativeMarks("اس رات چراغ جل اٹھا."), "اس رات چراغ جل اٹھا۔");
  assert.equal(nativeMarks("بیٹا, صبر کرو, کیا یہ سچ ہے?"), "بیٹا، صبر کرو، کیا یہ سچ ہے؟");
  assert.equal(nativeMarks("उसने कहा. क्या तुम आओगे?"), "उसने कहा। क्या तुम आओगे?", "Hindi has the danda — and a Latin question mark");
  assert.equal(nativeMarks("LABUBU 3.5, ok."), "LABUBU 3.5, ok.", "only after the script's own letters");
  for (const s of ["پرانی حویلی۔", "پرانی، حویلی؟", "पुरानी हवेली।"]) assert.equal(nativeMarks(drawable(s)), s, `round trip: ${s}`);
});

test("a mark that sits on its letter takes no room", () => {
  assert.equal(textWidth("पुरानी"), 5, "प ु र ा न ी — the ु under प is not a letter's width");
  assert.equal(textWidth("में"), 1, "म, with े and ं sitting on it");
  assert.equal(textWidth("HOUSE"), 5);
  assert.equal(textWidth("人们"), 3.4, "Chinese as before");
});

test("a card is cut where Hindi and Urdu breathe — never opening on a postposition", () => {
  const hi = told(["रात को गाँव की पुरानी हवेली में एक दीया अपने आप जल उठा और सब लोग डर गए।"], "hi").bold.map((c) => c.text);
  const ur = told(["رات کو گاؤں کی پرانی حویلی میں ایک چراغ خود بخود جل اٹھا اور سب لوگ ڈر گئے۔"], "ur").bold.map((c) => c.text);
  assert.deepEqual(hi, ["रात को", "गाँव की पुरानी", "हवेली में", "एक दीया", "अपने आप जल", "उठा और सब", "लोग डर गए"]);
  assert.deepEqual(ur, ["رات کو", "گاؤں کی پرانی", "حویلی میں", "ایک چراغ خود", "بخود جل اٹھا", "اور سب لوگ", "ڈر گئے"]);
  // without the languages' own rules (cut as English) cards opened on "की" / "में" and "کی" / "میں"
  const asEn = told(["रात को गाँव की पुरानी हवेली में एक दीया अपने आप जल उठा और सब लोग डर गए।"], "en").bold.map((c) => c.text);
  assert.ok(asEn.some((c) => /^(की|में) /.test(c)), asEn.join(" | "));
  for (const c of [...hi, ...ur]) assert.ok(!/^(का|की|के|को|में|से|ने|کا|کی|کے|کو|میں|سے|نے) /.test(c), c);
  // every card carries its words, so one can be lit while it is said
  for (const c of told(["رات کو گاؤں کی پرانی حویلی میں ایک چراغ جل اٹھا۔"], "ur").bold) {
    assert.ok(c.words && c.words.length >= 1, c.text);
    assert.equal(c.words!.map((w) => w.text).join(""), c.text);
  }
});

test("a sentence ends at the script's own full stop — the subtitles break there", () => {
  const ur = told(["پہلا جملہ یہاں ہے۔ دوسرا جملہ، کیا یہ سچ ہے؟", "تیسرا منظر۔"], "ur");
  const subs = subtitleCards(["پہلا جملہ یہاں ہے۔ دوسرا جملہ، کیا یہ سچ ہے؟", "تیسرا منظر۔"], ur.win, subtitleChars(720, 1280), ur.timed);
  assert.deepEqual(subs.map((c) => c.text), ["پہلا جملہ یہاں ہے.\nدوسرا جملہ, کیا یہ سچ ہے?", "تیسرا منظر."], "a line per sentence; the marks are put back when drawn");
});

// ---- CAPTIONED: the faces ------------------------------------------------------------------------------

test("the faces are the shipped files, measured as the renderer measures them", () => {
  for (const face of Object.values(SHAPED_FACES)) {
    const file = path.join(root, "public", "fonts", face.file);
    assert.ok(fs.existsSync(file), `${face.file} is shipped`);
    const bytes = new Uint8Array(fs.readFileSync(file));
    assert.ok(fontMagic(bytes), `${face.file} is a font`);
    const m = readFontMetrics(bytes)!;
    assert.ok(m, face.file);
    for (const k of ["box", "top", "bottom"] as const) assert.ok(Math.abs(m[k] - face[k]) < 0.001, `${face.file} ${k}: ${m[k]} vs ${face[k]}`);
  }
  const nastaliq = readFontMetrics(new Uint8Array(fs.readFileSync(path.join(root, "public", "fonts", SHAPED_FACES.urdu.file))))!;
  assert.ok(canDraw(nastaliq, "اس رات گاؤں کی پرانی حویلی میں ٹوپی ڈاکٹر پڑھا ۔ ، ؟"), "every Urdu letter");
  assert.ok(canDraw(nastaliq, "LABUBU Labubu 2026"), "and Latin: a brand name in an Urdu line is the same face");
  assert.equal(fs.statSync(path.join(root, "public", "fonts", SHAPED_FACES.urdu.file)).size, 296168, "the Noto build the frames were looked at in");
  const poppins = readFontMetrics(new Uint8Array(fs.readFileSync(path.join(root, "public", "fonts", SHAPED_FACES.deva.file))))!;
  assert.ok(canDraw(poppins, "क्षेत्र धर्म विद्यालय स्त्री क्रिकेट शुद्ध कार्य हिन्दी"), "Poppins has Devanagari");
  assert.equal(shapedFaceFor("اس رات"), SHAPED_FACES.urdu);
  assert.equal(shapedFaceFor("Labubu کی کہانی"), SHAPED_FACES.urdu);
  assert.equal(shapedFaceFor("उस रात"), SHAPED_FACES.deva);
  assert.equal(shapedFaceFor("The old house"), null);
  assert.equal(shapedFaceFor("สวัสดี"), null, "another shaped script has no face: no words, never boxes");
});

test("needsShaping knows the scripts drawtext cannot draw; hasRtl the ones that run right to left", () => {
  for (const s of ["उस रात", "اس رات", "שלום", "สวัสดี", "বাংলা", "Labubu کی"]) assert.equal(needsShaping(s), true, s);
  for (const s of ["The old house", "Ça va, naïve résumé", "人们都说", "Über", "", null]) assert.equal(needsShaping(s), false, String(s));
  assert.equal(hasRtl("Labubu کی کہانی"), true);
  assert.equal(hasRtl("उस रात"), false);
});

// ---- CAPTIONED: the file the renderer draws ---------------------------------------------------------------

const urduCard = (): Card[] => [{ text: "LABUBU کی کہانی", t0: 0, t1: 2, words: [{ text: "LABUBU", t0: 0, t1: 1 }, { text: " کی", t0: 1, t1: 1.5 }, { text: " کہانی", t0: 1.5, t1: 2 }] }];
const hindiCard = (): Card[] => [{ text: "उस रात", t0: 0, t1: 2, words: [{ text: "उस", t0: 0, t1: 1 }, { text: " रात", t0: 1, t1: 2 }] }];

test("every look is a file for the renderer: the face, the size, the foot, Urdu right to left", () => {
  for (const [W, H] of [[720, 1280], [1280, 720], [720, 720]]) {
    const u = Math.min(W, H) / 720;
    for (const [face, cards] of [[SHAPED_FACES.urdu, urduCard()], [SHAPED_FACES.deva, hindiCard()]] as const) {
      const bold = shapedAss(cards, "bold", face, W, H);
      assert.ok(bold.includes(`\nStyle: Cap,${face.family},`) && bold.includes(`\nStyle: Sub,${face.family},`), "the face that has the script");
      for (const l of bold.split("\n").filter((x) => x.startsWith("Style: "))) assert.ok(l.endsWith(",-1"), `${l}: the renderer finds each line's direction (Encoding -1)`);
      const ev = events(bold);
      assert.equal(ev.length, 1, "one line for a Bold card");
      const m = /^\{\\an2\\pos\((\d+),(\d+)\)\\fs(\d+)\}/.exec(ev[0].text)!;
      assert.ok(m, ev[0].text);
      assert.equal(Number(m[1]), Math.round(W / 2), "centred");
      assert.ok(Number(m[2]) <= H - Math.round(4 * u) && Number(m[2]) > H * 0.5, `${W}x${H}: the foot ${m[2]} is in the lower half and inside the frame`);
      // the Latin card's size for this many letters, times the face's own scale — no bigger than the frame holds
      const w = textWidth(cards[0].text);
      const emLat = Math.round(Math.max(30, Math.min(54, Math.floor((720 * 0.9) / (Math.max(18, w) * 0.62)))) * u);
      const em = Math.min(emLat * face.scale, (720 * 0.9 * u) / (w * face.glyph));
      assert.equal(Number(m[3]), Math.round(em * face.box), `${face.family} ${W}x${H}: the renderer's size is the em times the font's box`);
      assert.ok(em * w * face.glyph <= 0.9 * 720 * u + 1, "it fits");
      assert.equal(ev[0].text.includes("‏"), face === SHAPED_FACES.urdu, "an Urdu line opens with a right-to-left mark; a Hindi one does not");
    }
  }
  assert.equal(shapedAss([], "bold", SHAPED_FACES.urdu, 720, 1280), "");
  assert.equal(shapedAss([{ text: "", t0: 0, t1: 1 }], "bold", SHAPED_FACES.urdu, 720, 1280), "");
});

test("Highlight: one line per word, the word being said lit — the pieces in the order they are said", () => {
  const ev = events(shapedAss(urduCard(), "highlight", SHAPED_FACES.urdu, 720, 1280));
  const lit = `{\\c&H00${HIGHLIGHT_RGB.slice(4, 6)}${HIGHLIGHT_RGB.slice(2, 4)}${HIGHLIGHT_RGB.slice(0, 2)}&}`;
  assert.equal(ev.length, 3);
  const litWord = (t: string) => /\{\\c&H00[0-9A-F]{6}&\}([^{]*)\{\\c&H00FFFFFF&\}/.exec(t)![1];
  assert.deepEqual(ev.map((e) => litWord(e.text)), ["LABUBU", "کی", "کہانی"]);
  for (const e of ev) {
    assert.ok(e.text.includes(lit));
    assert.equal(e.text.replace(/\{[^}]*\}/g, ""), "‏LABUBU کی کہانی", "every line shows the whole card");
  }
  assert.deepEqual(ev.map((e) => [e.start, e.end]), [["0:00:00.00", "0:00:01.00"], ["0:00:01.00", "0:00:01.50"], ["0:00:01.50", "0:00:02.00"]]);
});

test("Subtitles: each line on its own baseline, the script's marks back — Hindi on a dark box, Urdu outlined", () => {
  const cards: Card[] = [{ text: "پہلا جملہ یہاں ہے.\nدوسرا جملہ, کیا یہ سچ ہے?", t0: 0, t1: 3 }];
  const ass = shapedAss(cards, "subtitles", SHAPED_FACES.urdu, 720, 1280);
  const ev = events(ass);
  assert.equal(ev.length, 2, "a line each");
  assert.deepEqual(ev.map((e) => e.text.replace(/\{[^}]*\}/g, "")), ["‏پہلا جملہ یہاں ہے۔", "‏دوسرا جملہ، کیا یہ سچ ہے؟"]);
  const feet = ev.map((e) => Number(/\\pos\(\d+,(\d+)\)/.exec(e.text)![1]));
  const em = Math.min(34 * SHAPED_FACES.urdu.scale, (720 * 0.92) / (Math.max(...["پہلا جملہ یہاں ہے.", "دوسرا جملہ, کیا یہ سچ ہے?"].map(textWidth)) * SHAPED_FACES.urdu.glyph));
  assert.ok(Math.abs(feet[1] - feet[0] - SHAPED_FACES.urdu.lineGap * em) <= 1, `the lines ${feet[1] - feet[0]} px apart`);
  assert.ok(ev.every((e) => e.style === "Sub"));
  assert.match(ass, /\nStyle: Sub,Noto Nastaliq Urdu,\d+,&H00FFFFFF&,&H00FFFFFF&,&H26000000&,&H80000000&,-1,0,0,0,100,100,0,0,1,\d+,\d+,2,0,0,0,-1\n/, "Urdu: outlined, with a shadow");
  assert.match(shapedAss([{ text: "पहला वाक्य.", t0: 0, t1: 1 }], "subtitles", SHAPED_FACES.deva, 720, 1280), /\nStyle: Sub,Poppins,\d+,&H00FFFFFF&,&H00FFFFFF&,&H8C000000&,&H8C000000&,-1,0,0,0,100,100,0,0,3,\d+,0,2,0,0,0,-1\n/, "Hindi: on the Latin line's dark box");
  assert.equal(events(shapedAss([{ text: "पहला वाक्य.", t0: 0, t1: 1 }], "subtitles", SHAPED_FACES.deva, 720, 1280))[0].text.replace(/\{[^}]*\}/g, ""), "पहला वाक्य।");
});

test("nothing in a card can break the file", () => {
  const ass = shapedAss([{ text: "کی {\\b1}بات\\N", t0: 0, t1: 1, words: [{ text: "کی", t0: 0, t1: 0.5 }, { text: " {\\b1}بات\\N", t0: 0.5, t1: 1 }] }], "highlight", SHAPED_FACES.urdu, 720, 1280);
  for (const e of events(ass)) assert.ok(!/\\b1|\\N/.test(e.text.replace(/\{\\(an2|c&H00[0-9A-F]{6}&)[^}]*\}/g, "")), e.text);
});

// ---- WHERE IT IS WIRED ---------------------------------------------------------------------------------

test("captions in these scripts go to the renderer — and anything that only has drawtext draws no words", () => {
  const burn = read("app", "lib", "caption-burn.server.ts");
  assert.ok(burn.indexOf("if (style !== \"off\" && cards.some((c) => needsShaping(c.text))) return shapedGraph(cards, style, fontFile, W, H);") < burn.indexOf("const plain = captionFilters(cards, style, fontFile, W, H);"), "before any drawtext");
  assert.ok(burn.includes("const plain = filterFor(shapedAss(cards, style === \"subtitles\" ? \"subtitles\" : \"bold\", face, W, H));"), "the plain look is the renderer's too");
  assert.ok(burn.includes("if (!face || !fs.existsSync(path.join(fontsDir, face.file))) {"), "no face: no words");
  const ugc = read("app", "lib", "ugc-ad-pipeline.server.ts");
  const at = ugc.indexOf("export async function resolveTextFont(text: string): Promise<string> {");
  assert.ok(ugc.slice(at, ugc.indexOf("if (!hasCJK(text)) return poppins;", at)).includes("if (needsShaping(text)) throw new Error("), "the drawtext font refuses them first");
  assert.ok(ugc.includes("export async function resolveCaptionFont(text: string): Promise<string> {"));
  assert.ok(ugc.includes("if (needsShaping(script)) { console.log(\"[assemble] words drawtext cannot shape (Hindi, Urdu…) — no burned-in captions\"); script = \"\"; }"), "an ad's drawtext captions: none");
  // the pipelines whose captions the renderer can draw ask for the face
  assert.ok(read("app", "lib", "narrated-story.server.ts").includes("try { fontFile = await resolveCaptionFont(lines.join(\" \")); }"), "a told story");
  assert.ok(read("app", "lib", "film-captions.server.ts").includes("try { font = await resolveCaptionFont(sample); }"), "an acted film, a commercial");
  const faceless = read("app", "lib", "faceless-video.server.ts");
  assert.ok(faceless.includes("try { fontFile = await resolveCaptionFont(fullScript); }") && faceless.includes("} finally { cap.cleanup(); }"), "a faceless video");
  const edit = read("app", "lib", "video-edit.server.ts");
  assert.ok(edit.includes("} else if (op === \"caption\" && needsShaping(params.captionText)) {"), "the Creator video editor's Caption…");
  assert.ok(edit.includes("const cap = captionGraph(cards, \"subtitles\", await resolveCaptionFont(text), W, H);") && edit.includes("captionCleanup();"), "…as subtitles, by the renderer");
  // a story's poster is drawtext's: none for these words (the shelf shows the first frame)
  assert.ok(read("app", "lib", "narrated-story.server.ts").includes("const font = await resolveTextFont([...layout.lines, layout.cast, layout.episode, layout.episode2 || \"\"].join(\" \"));"));
});

test("the Movie Maker: 'Told in' with हिन्दी and اردو, sent with every write and the render", () => {
  const f = read("app", "routes", "web.film.tsx");
  assert.ok(f.includes("<LangToggle value={storyLang} labels={CONTENT_LANG_NATIVE} align=\"left\" onPick={pickStoryLang}"));
  assert.ok(f.includes("const langOn = isStoryboard && !tmpl?.lipSyncSinger && !tmpl?.sung && !editing;"), "the story formats; not a song, not a story being edited");
  assert.ok(f.includes("langFetcher.submit({ intent: \"setLang\", contentLang: code }, { method: \"post\", action: \"/web\" });"), "the account's content language — the Studio's 'Writing in'");
  assert.ok(f.includes("orArm(`lang:${code}`, true, () => {"), "a written story is asked about before it starts over");
  assert.equal(f.split("...(langOn ? { filmLang: storyLang } : {})").length - 1, 2, "the script and the storyboard are written in it");
  assert.ok(f.includes("{narrated && langOn && <input type=\"hidden\" name=\"filmLang\" value={storyLang} />}"), "…and the story is told in it");
  assert.ok(f.includes("const askedLang = tmpl.lipSyncSinger || tmpl.sung ? null : askedContentLang(form.get(\"filmLang\"));"));
  assert.equal(f.split("contentLang: writeLang").length - 1, 2, "both writers");
  assert.ok(f.includes("...(narrated && askedLang ? { filmLang: askedLang } : {}),"));
  assert.ok(f.indexOf("...(narrated && askedLang ? { filmLang: askedLang } : {})") < f.indexOf("...(edited ? { filmLang: edited.lang"), "an edited story's own language still wins");
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Told in", "The language the story is written, spoken and captioned in", "Told in {lang}, a people's voice is read by a native speaker of the same kind — a man's by a man, a woman's by a woman. Character voices and your own voice speak it themselves."]) {
    assert.equal(dict.split(`${JSON.stringify(k)}:`).length - 1, 5, k);
  }
});

// ---- the renderer really draws it ------------------------------------------------------------------------
const ff = spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" });
const hasAss = ff.status === 0 && / ass +V->V/.test(ff.stdout);
const FONT_DIR = path.join(root, "public", "fonts");

test("ffmpeg's subtitle renderer draws them: Urdu right to left, Hindi left to right, the lit word where it is said", { skip: !hasAss }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hu-"));
  try {
    const W = 720, H = 1280;
    const esc = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:");
    /** how much highlight colour is in the left and in the right half of the caption band at time t */
    const warmth = (ass: string, t: number): [number, number] => {
      const file = path.join(dir, `c-${Math.random().toString(36).slice(2)}.ass`);
      fs.writeFileSync(file, ass, "utf8");
      const top = H - Math.round(H * 0.28) - 160;
      const r = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `color=c=black:s=${W}x${H}:d=3`, "-vf", `ass=filename='${esc(file)}':fontsdir='${esc(FONT_DIR)}',crop=${W}:320:0:${top}`, "-ss", String(t), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer", maxBuffer: 1 << 26 });
      assert.equal(r.status, 0, r.stderr.toString().slice(-300));
      const px = r.stdout;
      let left = 0, right = 0;
      for (let i = 0; i + 2 < px.length; i += 3) {
        const x = (i / 3) % W;
        if (px[i] > 150 && px[i + 2] < 120 && px[i] - px[i + 2] > 80) { if (x < W / 2) left++; else right++; } // yellow: red without blue
      }
      return [left, right];
    };
    const ur = shapedAss(urduCard(), "highlight", SHAPED_FACES.urdu, W, H);
    const [l0, r0] = warmth(ur, 0.5); // "LABUBU" lit — the FIRST word of a right-to-left line is on the right
    assert.ok(r0 > 200 && r0 > 4 * l0, `LABUBU lit on the right: left ${l0} right ${r0}`);
    const [l2, r2] = warmth(ur, 1.75); // "کہانی", the last word, is on the left
    assert.ok(l2 > 200 && l2 > 4 * r2, `کہانی lit on the left: left ${l2} right ${r2}`);
    const hi = shapedAss(hindiCard(), "highlight", SHAPED_FACES.deva, W, H);
    const [hl, hr] = warmth(hi, 0.5); // "उस" lit — a Hindi line runs left to right
    assert.ok(hl > 100 && hl > 4 * hr, `उस lit on the left: left ${hl} right ${hr}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
