/* Character voices — voices that are PERFORMED, for the cast members who are not people.
 *
 * The owner, 2026-11-17, looking at his own monster with "Trustworthy · Warm and steady" under it:
 * "Voices are my biggest stress rn, how are we going to get the proper for horror or cartoon peeps".
 * A stock announcer voice pitched up or down was thrown out by ear ("ass cheeks with syrup"). What he
 * picked instead, over three rounds of listening, is in this file:
 *
 *   - an ACTED take: ElevenLabs v3 (Replicate `elevenlabs/v3`) — a named voice given acting directions
 *     as [tags] inside the line, at low stability (a bigger performance);
 *   - and, for a monster, that take put through a CREATURE CHAIN the way a film does it — the clean take
 *     "still missed the mark"; the chain is what he chose (see character-voice.server.ts for the graphs).
 *
 * Each of the six is the voice of one stock character AND a voice any cartoon or creature a maker
 * creates can wear. Ids are "char:<key>": never a MiniMax voice id, never a merchant's cloned voice —
 * everything that takes a voice id must ask isCharacterVoice() before it sends one to a speech model.
 *
 * Client-safe and import-free: the pickers, the server and the tests all read it. */

export type CreatureChain = "hollow" | "feral2" | "ghost";

export type CharacterVoice = {
  /** "char:<key>" — what is stored on a presenter. */
  id: string;
  /** Also the sample's file name: public/voice-samples/characters/<key>.mp3 (the take he approved). */
  key: string;
  /** Short name on the chip, and one line of character under it. */
  label: string;
  blurb: string;
  /** Which kind of character it was made for — a cartoon voice is offered to cartoons first. */
  kind: "cartoon" | "monster";
  gender: "f" | "m";
  /** The voice in words, for the film models that perform a voice themselves from a description. */
  style: string;
  /** How it is performed. `before` opens every passage, `between` is dropped in once after its first
   *  sentence, `after` closes the whole piece — the shape of the takes that were approved. */
  acting: { voice: string; before: string; between?: string; after?: string; stability: number; style: number; speed: number; chain?: CreatureChain };
};

export const CHAR_VOICE_PREFIX = "char:";

export const CHARACTER_VOICES: CharacterVoice[] = [
  {
    id: "char:pip", key: "pip", label: "Bouncy", blurb: "A giggly, excitable cartoon kid", kind: "cartoon", gender: "m",
    style: "a bright, squeaky, excitable little-boy cartoon voice, always a breath away from a giggle",
    acting: { voice: "Kuon", before: "[excited] [giggling]", stability: 0.3, style: 0.7, speed: 1.08 },
  },
  {
    id: "char:dot", key: "dot", label: "Tiny", blurb: "A sweet little one, full of wonder", kind: "cartoon", gender: "f",
    style: "a tiny, sweet, giggly toddler voice with a little lisp",
    acting: { voice: "Kuon", before: "[childlike] [amazed] [giggles]", stability: 0.3, style: 0.8, speed: 1.0 },
  },
  {
    id: "char:coco", key: "coco", label: "Sleepy", blurb: "A slow, mellow, half-asleep drawl", kind: "cartoon", gender: "m",
    style: "a slow, mellow, sleepy drawl — warm and unbothered, like someone half-way through a nap",
    acting: { voice: "Austin", before: "[sleepy] [slow drawl]", after: "[yawns]", stability: 0.35, style: 0.6, speed: 0.9 },
  },
  {
    id: "char:howl", key: "howl", label: "Feral", blurb: "A snarling growl through bared teeth", kind: "monster", gender: "m",
    style: "a low, gravelly growl of a voice, every word pushed out through bared teeth",
    acting: { voice: "Reginald", before: "[guttural] [feral snarl]", between: "[low growl]", after: "[roars]", stability: 0.15, style: 1.0, speed: 0.9, chain: "feral2" },
  },
  {
    id: "char:mary", key: "mary", label: "Ghost", blurb: "A weeping whisper from another room", kind: "monster", gender: "f",
    style: "a soft, mournful, breathy whisper that seems to come from another room",
    acting: { voice: "Hope", before: "[ghostly] [breathy whisper] [weeping]", between: "[soft sob]", stability: 0.15, style: 1.0, speed: 0.85, chain: "ghost" },
  },
  {
    id: "char:keeper", key: "keeper", label: "Hollow", blurb: "Deep, slow and echoing, like a voice in a well", kind: "monster", gender: "m",
    style: "a deep, hollow, echoing voice, slow and deliberate, as if spoken from the bottom of a well",
    acting: { voice: "Reginald", before: "[deep] [slow] [menacing whisper]", stability: 0.3, style: 0.8, speed: 0.85, chain: "hollow" },
  },
];

const BY_ID: Record<string, CharacterVoice> = Object.fromEntries(CHARACTER_VOICES.map((v) => [v.id, v]));

/** Is this id one of the performed character voices? (Not merely "starts with char:" — a made-up id is
 *  not a voice, and must fall back like any other unknown id.) */
export const isCharacterVoice = (id: string | null | undefined): boolean => !!id && Object.prototype.hasOwnProperty.call(BY_ID, id);

export const characterVoice = (id: string | null | undefined): CharacterVoice | null => (id && Object.prototype.hasOwnProperty.call(BY_ID, id) ? BY_ID[id] : null);

/** The approved take, as a file the browser can play. */
export const characterVoiceSample = (id: string): string => `/voice-samples/characters/${id.slice(CHAR_VOICE_PREFIX.length)}.mp3`;

/** The voice a newly made cartoon or creature starts with, until its maker picks another. */
export const DEFAULT_CHARACTER_VOICE: Record<"cartoon" | "monster", Record<"f" | "m", string>> = {
  cartoon: { m: "char:pip", f: "char:dot" },
  monster: { m: "char:keeper", f: "char:mary" },
};

/** The line every character-voice sample was approved on is its own; this is what a NEW sample would
 *  say (kept short: a maker judges a voice in a few seconds). */
export const CHARACTER_SAMPLE_TEXT: Record<"cartoon" | "monster", string> = {
  cartoon: "Hi! I've got something to show you, and you are going to love it!",
  monster: "You shouldn't have come out here. Not tonight.",
};
