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

// GENDER IS MEASURED, NOT ASSUMED FROM THE NAME. "English_FriendlyPerson" sat at the top of the female
// list — and was the default voice for every female presenter and the "Female · calm" narrator — for
// months. It is a man's voice: its pre-rendered sample speaks at a median of 106 Hz and a 30-second
// read at 93 Hz, the same register as "Trustworthy" (103 Hz); the female voices here sit at 250-330 Hz.
// (Found 2026-11-17 when it was put on a girl in a film and came out "like a demon".) Before adding a
// voice, measure its sample — tests/voice-catalog.test.ts holds the numbers.
export const AVATAR_VOICES: AvatarVoice[] = [
  // female — neutral American English, no accent
  { id: "English_CalmWoman", label: "Calm", blurb: "Soft and soothing", gender: "f" },
  { id: "English_ConfidentWoman", label: "Confident", blurb: "Bold and upbeat", gender: "f" },
  { id: "English_PlayfulGirl", label: "Playful", blurb: "Young and energetic", gender: "f" },
  { id: "English_Wiselady", label: "Warm & wise", blurb: "Mature and reassuring", gender: "f" },
  // male — neutral American English, no accent
  { id: "English_Trustworth_Man", label: "Trustworthy", blurb: "Warm and steady", gender: "m" },
  { id: "English_FriendlyPerson", label: "Friendly", blurb: "Warm and approachable", gender: "m" },
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
  f: "English_CalmWoman",
  m: "English_Trustworth_Man",
};

/** Which catalog voice suits a character of this gender and rough age — used when a voice has to be
 *  picked FOR someone (a film's auto-cast). A child gets the young voice, an elder the mature one,
 *  everyone else the gender's adult voices in catalog order. Returns ids, best first. */
export function voicesForCharacter(gender: "f" | "m", age: "young" | "adult" | "mature"): string[] {
  const all = AVATAR_VOICES.filter((v) => v.gender === gender).map((v) => v.id);
  const young = gender === "f" ? "English_PlayfulGirl" : "English_Comedian";
  const mature = gender === "f" ? "English_Wiselady" : "English_ManWithDeepVoice";
  const lead = age === "young" ? young : age === "mature" ? mature : "";
  const rest = all.filter((id) => id !== lead && (age !== "adult" || (id !== young && id !== mature)));
  const tail = all.filter((id) => id !== lead && !rest.includes(id));
  return [...(lead ? [lead] : []), ...rest, ...tail];
}

/** The gender a written character reads as, or null when the description doesn't say. */
export function genderOfDescription(desc: string): "f" | "m" | null {
  const low = (desc || "").toLowerCase();
  const fem = /\b(she|her|hers|woman|women|girl|mother|mom|mum|daughter|sister|lady|businesswoman|actress|queen|wife|aunt|grandmother|grandma|granny|female)\b/.test(low);
  const masc = /\b(he|him|his|man|men|boy|father|dad|son|brother|guy|businessman|actor|king|husband|uncle|grandfather|grandpa|male)\b/.test(low);
  return fem && !masc ? "f" : masc && !fem ? "m" : null;
}

/** Voices for a cast, one per member, in order. A member whose voice was CHOSEN (`auto: false` — picked
 *  by the merchant, or brought by the presenter cast in the part) keeps it; every other member gets the
 *  best voice for their written gender and age that nobody else in the cast is using — so two people in
 *  one scene never share a voice, and a child isn't handed a grown-up's. Null = gender unknown. */
export function autoCastVoices(members: Array<{ desc: string; voiceId: string | null; auto: boolean }>): Array<string | null> {
  const taken = new Set<string>();
  for (const m of members) if (!m.auto && m.voiceId) taken.add(m.voiceId);
  return members.map((m) => {
    if (!m.auto) return m.voiceId;
    const g = genderOfDescription(m.desc);
    if (!g) return null;
    const order = voicesForCharacter(g, ageOfDescription(m.desc));
    const pick = order.find((id) => !taken.has(id)) || order[0] || null;
    if (pick) taken.add(pick);
    return pick;
  });
}

/** Rough age of a written character ("a 11-year-old girl", "her grandmother", "a tired detective"). */
export function ageOfDescription(desc: string): "young" | "adult" | "mature" {
  const low = (desc || "").toLowerCase();
  const years = /(\d{1,3})\s*[- ]?\s*(?:year|yr)s?[- ]?old/.exec(low);
  if (years) { const n = parseInt(years[1], 10); if (n <= 17) return "young"; if (n >= 60) return "mature"; return "adult"; }
  if (/\b(kid|child|little girl|little boy|girl|boy|teen|teenager|teenage|toddler|schoolgirl|schoolboy|daughter|son|young)\b/.test(low) && !/\b(girlfriend|boyfriend|young (wo)?man|young adult)\b/.test(low)) return "young";
  if (/\b(grandmother|grandfather|grandma|grandpa|granny|elderly|old (wo)?man|old lady|senior|retired|white-haired|gray-haired|grey-haired)\b/.test(low)) return "mature";
  return "adult";
}

/** Coerce an incoming voice id to a known one, falling back to the gender
 *  default. Keeps a bad/stale id from ever reaching the TTS model. */
export function safeVoiceId(id: string | null | undefined, gender: "f" | "m"): string {
  return id && AVATAR_VOICE_IDS.has(id) ? id : DEFAULT_AVATAR_VOICE[gender];
}

/** True when a CUSTOM presenter's stored voice is somebody's OWN — a cloned "My voice" — rather than one
 *  of the stock catalog voices above. Pass the presenter's `voiceId` field (only custom presenters have
 *  one). Pipelines use it to REFUSE to substitute the voice: a stranger's voice in the merchant's own
 *  mouth is worse than a failed, refunded render. Pure and dependency-free, so it is safe anywhere. */
export function isPersonalVoice(voiceId: string | null | undefined): boolean {
  return !!voiceId && !AVATAR_VOICE_IDS.has(voiceId) && !voiceId.startsWith("ttv-");
}

/** The phrase every preview sample speaks — kept short and upbeat so a merchant
 *  can judge tone in ~4 seconds. Also used by the sample generator. */
export const VOICE_SAMPLE_TEXT = "Hey! Let me show you something I think you're really going to love.";
