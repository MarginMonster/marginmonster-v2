import type { Avatar } from "./avatars";

/* ---- Stock characters ----
 * Not people: cartoon characters for the kids formats and monsters for the horror ones, in EVERY
 * account's cast. They are there to show what a cast can be — the owner, 2026-11-17: "to hint towards
 * the creativity capabilities… these will be stock characters included all accounts with 3D models",
 * and he picked each of these six from candidate sheets himself. Original designs, one look each (no
 * wardrobe). Portraits: public/avatars/<id>_0.jpg; kits like everyone else's (public/kits/<id>/).
 *
 * `voiceId` is the voice they speak with wherever a stock voice id is what the engine takes (talking
 * ads) — an ordinary CATALOG voice, named honestly in the UI, until each has a voice designed for it.
 * It has to be one from avatar-voice-catalog.ts: any other id is taken for a merchant's own cloned
 * voice (isPersonalVoice) and sent down the cloned-voice paths. A test pins this.
 * `voiceStyle` is the voice in words, for the film models that perform one from a description.
 * `continuity` is what a picture model must not "fix": a puppy does not wear trousers.
 *
 * In a file of its own, importing nothing but a type, so the tests can read it (avatars.ts imports JSON). */

/** How each character's voice is PERFORMED — what the owner picked by ear on 2026-11-17, after throwing
 *  out pitch-shifted stock voices ("ass cheeks with syrup").
 *
 *  Engine: ElevenLabs v3 (Replicate `elevenlabs/v3`) — a named voice, ACTING directions as [tags] inside the
 *  line, low stability = a bigger performance. The cartoon voices are used as they come.
 *  A monster's clean take "still missed the mark"; what he picked is the take put through a CREATURE
 *  CHAIN, the way a film does it (ffmpeg, 44.1 kHz; "big(r)" = asetrate=44100*r,aresample=44100,atempo=1/r,
 *  which lowers pitch AND formants — a bigger throat, not a slowed-down voice):
 *    hollow  big(0.88), asubboost, aecho 90|180|270 ms, lowpass 3.2 kHz
 *    feral2  big(0.84) +5 dB into asoftclip(atan), mixed with an octave-down copy (lowpass 700 Hz, 0.7), chorus
 *    ghost   highpass 150 Hz; the dry line + a reverse-reverb swell (areverse, aecho 350|700 ms, areverse)
 *            + a whisper double 40 ms late and 3 % up at 0.35; then aecho 180|420 ms
 *  The picked clips are public/voice-samples/characters/<id>.mp3. A transcriber gets every word of each.
 *  ⚠ Not wired into any pipeline yet — until it is, nothing in the app may claim a character
 *  "speaks in" this voice. */
export const CHARACTER_ACTING: Record<string, { voice: string; before: string; after?: string; stability: number; style: number; speed: number; chain?: "hollow" | "feral2" | "ghost" }> = {
  pip: { voice: "Kuon", before: "[excited] [giggling]", stability: 0.3, style: 0.7, speed: 1.08 },
  dot: { voice: "Kuon", before: "[childlike] [amazed] [giggles]", stability: 0.3, style: 0.8, speed: 1.0 },
  coco: { voice: "Austin", before: "[sleepy] [slow drawl]", after: "[yawns]", stability: 0.35, style: 0.6, speed: 0.9 },
  howl: { voice: "Reginald", before: "[guttural] [feral snarl]", after: "[roars]", stability: 0.15, style: 1.0, speed: 0.9, chain: "feral2" },
  mary: { voice: "Hope", before: "[ghostly] [breathy whisper] [weeping]", after: "[soft sob]", stability: 0.15, style: 1.0, speed: 0.85, chain: "ghost" },
  keeper: { voice: "Reginald", before: "[deep] [slow] [menacing whisper]", stability: 0.3, style: 0.8, speed: 0.85, chain: "hollow" },
};
export const STOCK_CHARACTERS: Avatar[] = [
  {
    id: "pip", name: "Pip", vibe: "Cartoon pup", kind: "cartoon",
    desc: "a marigold-yellow cartoon puppy who stands upright, with one ear standing up and one ear flopped down, a white star-shaped patch around his left eye, big brown eyes and a red paisley bandana",
    gender: "m", ageBand: "young", energy: "hype",
    voiceId: "English_Comedian",
    voiceStyle: "a bright, squeaky, excitable little-boy cartoon voice, always a breath away from a giggle",
    continuity: "He is a 3D-animated cartoon puppy covered in marigold-yellow fur with a cream belly: bare paws, no clothes at all except the red paisley bandana round his neck. Keep the white star-shaped patch round his left eye, one ear up and one ear flopped down.",
  },
  {
    id: "coco", name: "Coco", vibe: "Cartoon capybara", kind: "cartoon",
    desc: "a round, calm, toffee-brown cartoon capybara with sleepy half-closed eyes and a small content smile, who balances a single bright orange fruit on top of his head",
    gender: "m", ageBand: "mid", energy: "calm",
    voiceId: "English_PatientMan",
    voiceStyle: "a slow, mellow, sleepy drawl — warm and unbothered, like someone half-way through a nap",
    continuity: "He is a 3D-animated cartoon capybara: a round barrel of toffee-brown fur on four short legs with small dark paws, no clothes. The bright orange fruit stays balanced on top of his head.",
  },
  {
    id: "dot", name: "Dot", vibe: "Cartoon dino", kind: "cartoon",
    desc: "a chubby mint-green cartoon baby dinosaur with a cream belly, big brown eyes and a tiny horn on her nose, wearing a sunshine-yellow raincoat with the hood up and little flying goggles on the hood",
    gender: "f", ageBand: "young", energy: "warm",
    voiceId: "English_PlayfulGirl",
    voiceStyle: "a tiny, sweet, giggly toddler voice with a little lisp",
    continuity: "She is a 3D-animated cartoon baby dinosaur: mint-green skin, cream belly, bare three-toed feet, no shoes. She wears only the sunshine-yellow raincoat with its hood up and the goggles on the hood.",
  },
  {
    id: "howl", name: "Howl", vibe: "Werewolf", kind: "monster",
    desc: "a huge werewolf standing upright, with shaggy dark-grey fur, glowing yellow eyes and bared fangs, wearing the torn remains of a red plaid shirt",
    gender: "m", ageBand: "mid", energy: "hype",
    voiceId: "English_ManWithDeepVoice",
    voiceStyle: "a low, gravelly growl of a voice, every word pushed out through bared teeth",
    continuity: "He is a werewolf: dark-grey fur over his whole body, clawed hands and clawed wolf feet — no shoes, no trousers beyond the fur, only the torn red plaid shirt. Glowing yellow eyes.",
  },
  {
    id: "mary", name: "Mourning Mary", vibe: "Ghost bride", kind: "monster",
    desc: "a ghostly bride with long black hair, hollow dark eyes and skin like cracked white porcelain, wearing a tattered ivory lace wedding dress and a torn veil",
    gender: "f", ageBand: "mid", energy: "calm",
    voiceId: "English_CalmWoman",
    voiceStyle: "a soft, mournful, breathy whisper that seems to come from another room",
    continuity: "She is a ghost: cracked white-porcelain skin on her face, arms and hands, hollow dark eyes, long black hair. The tattered ivory lace wedding dress falls all the way to the floor and hides her feet.",
  },
  {
    id: "keeper", name: "The Keeper", vibe: "Hooded reaper", kind: "monster",
    desc: "a tall skeletal figure in a heavy charcoal hooded robe, with a weathered bone skull for a face, small cold-blue flames burning in the eye sockets and long bony hands",
    gender: "m", ageBand: "mature", energy: "calm",
    voiceId: "English_Trustworth_Man",
    voiceStyle: "a deep, hollow, echoing voice, slow and deliberate, as if spoken from the bottom of a well",
    continuity: "He is a skeleton in a robe: a bone skull face with cold-blue flames in the eye sockets, bone hands — never skin. The heavy charcoal hooded robe falls to the floor and hides his feet.",
  },
];
