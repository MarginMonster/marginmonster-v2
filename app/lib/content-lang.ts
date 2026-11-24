/* Content language — the language the AI GENERATES in (scripts, captions,
 * lyrics, articles, ad copy). Stored per shop (Shop.contentLang):
 *   · web accounts: seeded from the landing-page language at signup,
 *     changeable on the dashboard
 *   · Shopify merchants: auto-detected once from the store's primary locale
 * "en" / null = English. Pure data + string helpers; client-safe. */

/* HINDI AND URDU (2026-11-24). A tester in Pakistan: "why we not add option like voice in different
 * languages rather than english like our urdu, indians hindhi because this app use world wide". Both are
 * written in scripts that have to be SHAPED to be drawn (see needsShaping), Urdu right to left — and the
 * writer is told the SCRIPT as part of the name every prompt reads: a member in Pakistan may well type
 * the idea in Roman Urdu, and a story written back in Roman letters is neither read aloud nor put on the
 * screen the way an Urdu one is. */
export const CONTENT_LANGS: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  zh: "Simplified Chinese",
  hi: "Hindi (everyday spoken Hindi, in Devanagari script)",
  ur: "Urdu (everyday spoken Urdu, in Urdu script)",
};

/** Native display names for the language toggle (friendlier than the English
 *  names above). Same keys as CONTENT_LANGS. Client-safe. */
export const CONTENT_LANG_NATIVE: Record<string, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  zh: "中文",
  hi: "हिन्दी",
  ur: "اردو",
};

export function normalizeContentLang(v: string | null | undefined): string {
  if (!v) return "en";
  const code = v.toLowerCase().slice(0, 2);
  return CONTENT_LANGS[code] ? code : "en";
}

/** A language a page ASKED for: its code when it is one of ours, else null (so the caller keeps its own —
 *  normalizeContentLang would make anything unknown English). */
export function askedContentLang(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const code = v.trim().toLowerCase().slice(0, 2);
  return Object.prototype.hasOwnProperty.call(CONTENT_LANGS, code) ? code : null;
}

/** How the words are to SOUND, for the two languages a writer most often gets wrong: stiff, bookish Hindi
 *  and Urdu, or either one in Roman letters. Said after the language line. */
const WRITE_NOTE: Record<string, string> = {
  hi: " Write the Hindi people really speak — natural and everyday, not formal or Sanskritised — in the Devanagari script, never in Roman letters.",
  ur: " Write the Urdu people in Pakistan really speak — natural and everyday, not formal or literary — in the Urdu (Perso-Arabic) script, never in Roman letters or Devanagari.",
};

/** Instruction line appended to every text-generation prompt. Empty for
 *  English so existing prompts stay byte-identical. */
export function langDirective(code: string | null | undefined): string {
  const c = normalizeContentLang(code);
  if (c === "en") return "";
  return ` IMPORTANT: Write ALL output in ${CONTENT_LANGS[c]} — every sentence, headline and line. Keep the brand and product names exactly as given (do not translate them).${WRITE_NOTE[c] || ""}`;
}

/** True when the text needs a CJK-capable font for ffmpeg drawtext. */
export function hasCJK(s: string): boolean {
  return /[　-鿿豈-﫿぀-ヿ]/.test(s);
}

/* SCRIPTS THAT HAVE TO BE SHAPED. In Devanagari (Hindi) a vowel sign is written BEFORE the letter it is
 * said after and consonants fuse into one glyph; in Arabic script (Urdu) every letter takes another form by
 * its neighbours, and the line runs right to left. ffmpeg's drawtext on the server (Debian bookworm's 5.1:
 * no HarfBuzz) draws such text letter by letter, in the order it is stored — Hindi with its vowels on the
 * wrong side, Urdu as a row of loose, unjoined letters, backwards. The subtitle renderer (libass, the `ass`
 * filter) shapes them, so captions in these scripts are drawn by it (caption-burn.server.ts); anything that
 * only has drawtext draws no words for them (ugc-ad-pipeline.server.ts → resolveTextFont).
 * Hebrew, Arabic and the scripts around them; the Indic scripts; Thai, Lao, Tibetan, Myanmar, Khmer. */
const SHAPED = /[֐-ࣿऀ-෿฀-࿿က-႟ក-៿יִ-﷿ﹰ-﻿]/;
const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
/** Does this text need a renderer that shapes it (Hindi, Urdu…)? */
export const needsShaping = (s: string | null | undefined): boolean => SHAPED.test(s || "");
/** Is any of it written right to left (Urdu, Arabic, Hebrew…)? */
export const hasRtl = (s: string | null | undefined): boolean => RTL.test(s || "");

/* MiniMax TTS settings for a content language.
 *
 * Every voice call in the codebase sent `language_boost: "English"` and
 * `english_normalization: true` as literals, while the script sitting right
 * above them had been generated in French, Spanish, German or Chinese by
 * langDirective. So the merchant got their own language read by a model told
 * to expect English — mispronounced, and with English number/date
 * normalisation applied to text that is not English.
 *
 * `english_normalization` expands "3" to "three" and "1/2" to "January
 * second" using English rules; it must only ever be on for English.
 *
 * URDU IS READ WITH THE HINDI BOOST. MiniMax lists no Urdu (its 43 language_boost values, read from the
 * model's own schema on Replicate, 2026-11-24) — but spoken Urdu and Hindi are one language, and its Hindi
 * model reads Urdu SCRIPT: an Urdu test sentence read with the "Hindi" boost came back from the listener
 * (whisperx, told "ur") word for word, 13 of 13; with "Automatic" it ran words together and dropped some.
 * A longer one, 24 of 26 (ض said as "d", one word misheard). Where a story can, Urdu is read by ElevenLabs
 * instead (LANG_VOICES). */
const MINIMAX_BOOST: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  zh: "Chinese",
  hi: "Hindi",
  ur: "Hindi",
};

export function voiceLangOpts(code: string | null | undefined): {
  language_boost: string;
  english_normalization: boolean;
} {
  const c = normalizeContentLang(code);
  return { language_boost: MINIMAX_BOOST[c] || "English", english_normalization: c === "en" };
}

/* WHO READS A STORY TOLD IN HINDI OR URDU. The stock narrators (avatar-voice-catalog.ts) are English
 * speakers: told the language they read it, with an accent — the format's own deep narrator read a Hindi
 * test sentence with one word in thirteen wrong, and an Urdu passage with four in twenty-six. So in these
 * two languages a stock narrator is READ BY a native voice of the same kind — a man's by a man, a woman's
 * by a woman (the format's own pick stays what it is: a deep man for horror, a calm woman for a bedtime
 * story). Measured 2026-11-24 with the app's own listener on test takes (scratchpad langs/):
 *   hi   MiniMax's own Hindi voices — "Trustworthy Advisor" (man, 96 Hz) and "Tranquil Woman" (178 Hz):
 *        every word back (the man also on a longer sentence with four conjuncts in it)
 *   ur   ElevenLabs v3 (`elevenlabs/v3` on Replicate — already the character voices' engine) told "ur":
 *        Mark (106 Hz) and Hope (216 Hz) — a 26-word passage back word for word, ض ق ص all right, where
 *        MiniMax's Hindi model (the backup, LANG_VOICE_BACKUP) got two or three wrong.
 * Nobody here could LISTEN to them: the owner's ears decide (the takes are kept for him).
 * A character voice and a member's own voice are theirs, and read the language themselves. */
export type LangVoice = { engine: "minimax" | "eleven"; voice: string };
export const LANG_VOICES: Record<string, Record<"m" | "f", LangVoice>> = {
  hi: { m: { engine: "minimax", voice: "hindi_male_1_v2" }, f: { engine: "minimax", voice: "hindi_female_2_v1" } },
  ur: { m: { engine: "eleven", voice: "Mark" }, f: { engine: "eleven", voice: "Hope" } },
};
/** …and if the voice that reads Urdu cannot be reached, the Hindi voice of the same kind reads it (with the
 *  Hindi boost — see MINIMAX_BOOST). */
export const LANG_VOICE_BACKUP: Record<string, Record<"m" | "f", string>> = {
  ur: { m: "hindi_male_1_v2", f: "hindi_female_2_v1" },
};

/** The native voice that reads `lang` in place of a stock narrator of this gender — null when the stock
 *  voice reads it itself (English, Spanish, French, German, Chinese). */
export function nativeVoice(lang: string | null | undefined, gender: "m" | "f"): LangVoice | null {
  const v = LANG_VOICES[normalizeContentLang(lang)];
  return v ? v[gender] : null;
}
