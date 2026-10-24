/* The voice picker for custom presenters.
 *
 * WHY THIS EXISTS: a forged presenter had no voice field, so voice fell through
 * to pickVoice() — an algorithm that scores MiniMax system voices by
 * gender/age/energy. Whatever scored highest won, and some of those reads carry
 * an accent the merchant never asked for (the "my character got an Indian voice"
 * bug). This is a hand-curated, deliberately SMALL shortlist of clean, neutral
 * American-English MiniMax system voices — every one chosen so nothing here
 * surprises a merchant with an accent. The forge stores the chosen id on the
 * CustomAvatar row and castFor() uses it verbatim, so the merchant hears exactly
 * what they picked.
 *
 * Shared, dependency-free: the forge UI imports it for the picker, the action
 * imports it to validate the submitted id, and the pipeline could import the set
 * to sanity-check. Keep it free of server-only imports.
 *
 * Preview samples: scripts/voices/gen-samples.cjs renders one short MP3 per
 * voice (the SAME emotion/speed castFor uses for custom presenters) to
 * public/voice-samples/<id>.mp3, so the picker's ▶ plays the real thing for free. */

export type AvatarVoice = {
  id: string; // MiniMax speech-02 system voice id (also the sample filename)
  label: string; // short name shown on the chip
  blurb: string; // one-line character description
  gender: "f" | "m"; // which gender toggle surfaces it first
};

export const AVATAR_VOICES: AvatarVoice[] = [
  // female — neutral American English, no accent
  { id: "English_FriendlyPerson", label: "Friendly", blurb: "Warm and approachable", gender: "f" },
  { id: "English_ConfidentWoman", label: "Confident", blurb: "Bold and upbeat", gender: "f" },
  { id: "English_PlayfulGirl", label: "Playful", blurb: "Young and energetic", gender: "f" },
  { id: "English_CalmWoman", label: "Calm", blurb: "Soft and soothing", gender: "f" },
  { id: "English_Wiselady", label: "Warm & wise", blurb: "Mature and reassuring", gender: "f" },
  // male — neutral American English, no accent
  { id: "English_Trustworth_Man", label: "Trustworthy", blurb: "Warm and steady", gender: "m" },
  { id: "English_magnetic_voiced_man", label: "Magnetic", blurb: "Bold and upbeat", gender: "m" },
  { id: "English_Comedian", label: "Upbeat", blurb: "Young and energetic", gender: "m" },
  { id: "English_PatientMan", label: "Easygoing", blurb: "Calm and steady", gender: "m" },
  { id: "English_ManWithDeepVoice", label: "Deep", blurb: "Mature and cinematic", gender: "m" },
];

export const AVATAR_VOICE_IDS: Set<string> = new Set(AVATAR_VOICES.map((v) => v.id));

/** Sensible default when a merchant doesn't pick — a clean, friendly read that
 *  fits the gender toggle. Used by the forge action and as the picker's initial
 *  selection. */
export const DEFAULT_AVATAR_VOICE: Record<"f" | "m", string> = {
  f: "English_FriendlyPerson",
  m: "English_Trustworth_Man",
};

/** Coerce an incoming voice id to a known one, falling back to the gender
 *  default. Keeps a bad/stale id from ever reaching the TTS model. */
export function safeVoiceId(id: string | null | undefined, gender: "f" | "m"): string {
  return id && AVATAR_VOICE_IDS.has(id) ? id : DEFAULT_AVATAR_VOICE[gender];
}

/** The phrase every preview sample speaks — kept short and upbeat so a merchant
 *  can judge tone in ~4 seconds. Also used by the sample generator. */
export const VOICE_SAMPLE_TEXT = "Hey! Let me show you something I think you're really going to love.";
