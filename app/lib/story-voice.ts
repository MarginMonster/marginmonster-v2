/* WHO ACTUALLY READS A STORY — the narrator the maker picked (or the format's own), in the language the
 * story is told in.
 *
 * In English, Spanish, French, German and Chinese the narrator reads it: the speech model is told the
 * language (content-lang.ts → voiceLangOpts). In HINDI and URDU a stock narrator — an English speaker —
 * is read by a native voice of the same kind instead, a man's by a man and a woman's by a woman, so the
 * format's own pick stays what it is (content-lang.ts → LANG_VOICES, with what was measured):
 *   Hindi  MiniMax's own Hindi voices, on the everyday speech model
 *   Urdu   ElevenLabs v3 (the speech model has no Urdu) — and, should that fail, the Hindi voice on the
 *          speech model, which reads Urdu script (`backup`)
 * A character voice and a member's own voice are not here: they are theirs, and read the language
 * themselves (narrated-story.server.ts → narrate).
 *
 * Pure: the tests hold it. */
import { AVATAR_VOICES } from "./avatar-voice-catalog.ts";
import { LANG_VOICE_BACKUP, nativeVoice, normalizeContentLang } from "./content-lang.ts";

export type StoryReader = { engine: "minimax" | "eleven"; voice: string; backup?: string };

/** Who reads a story told in `lang` by the narrator `voiceId` (a stock voice id, or anything else, which
 *  then reads it itself on the speech model). */
export function storyReader(voiceId: string, lang: string | null | undefined): StoryReader {
  const stock = AVATAR_VOICES.find((v) => v.id === voiceId);
  const native = stock ? nativeVoice(lang, stock.gender) : null;
  if (!stock || !native) return { engine: "minimax", voice: voiceId };
  if (native.engine === "eleven") return { ...native, backup: LANG_VOICE_BACKUP[normalizeContentLang(lang)]?.[stock.gender] || voiceId };
  return native;
}

/** The same choice for a pipeline that has only the everyday speech model (a faceless video): in Hindi and
 *  Urdu a stock voice is read by MiniMax's own Hindi voice of its kind — its Hindi model reads Urdu script
 *  (content-lang.ts → MINIMAX_BOOST) — and anything else by the voice itself. */
export function speechModelVoice(voiceId: string, lang: string | null | undefined): string {
  const r = storyReader(voiceId, lang);
  return r.engine === "minimax" ? r.voice : r.backup || voiceId;
}
