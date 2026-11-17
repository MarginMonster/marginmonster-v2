import type { Avatar } from "./avatars";

/* ---- Stock characters ----
 * Not people: cartoon characters for the kids formats and monsters for the horror ones, in EVERY
 * account's cast. They are there to show what a cast can be — the owner, 2026-11-17: "to hint towards
 * the creativity capabilities… these will be stock characters included all accounts with 3D models",
 * and he picked each of these six from candidate sheets himself. Original designs, one look each (no
 * wardrobe). Portraits: public/avatars/<id>_0.jpg; kits like everyone else's (public/kits/<id>/).
 *
 * `voiceId` is each one's own PERFORMED voice — "char:<id>", the take the owner picked by ear (see
 * character-voices.ts, which also holds how it is acted and processed). It is spoken by
 * character-voice.server.ts; it is not a MiniMax voice id and not anybody's cloned voice, and everything
 * that takes a voice id asks isCharacterVoice() before sending one to a speech model. A test pins that
 * every stock character's voice is one of them.
 * `voiceStyle` is the same voice in words, for the film models that perform one from a description.
 * `continuity` is what a picture model must not "fix": a puppy does not wear trousers.
 *
 * In a file of its own, importing nothing but a type, so the tests can read it (avatars.ts imports JSON). */

export const STOCK_CHARACTERS: Avatar[] = [
  {
    id: "pip", name: "Pip", vibe: "Cartoon pup", kind: "cartoon",
    desc: "a marigold-yellow cartoon puppy who stands upright, with one ear standing up and one ear flopped down, a white star-shaped patch around his left eye, big brown eyes and a red paisley bandana",
    gender: "m", ageBand: "young", energy: "hype",
    voiceId: "char:pip",
    voiceStyle: "a bright, squeaky, excitable little-boy cartoon voice, always a breath away from a giggle",
    continuity: "He is a 3D-animated cartoon puppy covered in marigold-yellow fur with a cream belly: bare paws, no clothes at all except the red paisley bandana round his neck. Keep the white star-shaped patch round his left eye, one ear up and one ear flopped down.",
  },
  {
    id: "coco", name: "Coco", vibe: "Cartoon capybara", kind: "cartoon",
    desc: "a round, calm, toffee-brown cartoon capybara with sleepy half-closed eyes and a small content smile, who balances a single bright orange fruit on top of his head",
    gender: "m", ageBand: "mid", energy: "calm",
    voiceId: "char:coco",
    voiceStyle: "a slow, mellow, sleepy drawl — warm and unbothered, like someone half-way through a nap",
    continuity: "He is a 3D-animated cartoon capybara: a round barrel of toffee-brown fur on four short legs with small dark paws, no clothes. The bright orange fruit stays balanced on top of his head.",
  },
  {
    id: "dot", name: "Dot", vibe: "Cartoon dino", kind: "cartoon",
    desc: "a chubby mint-green cartoon baby dinosaur with a cream belly, big brown eyes and a tiny horn on her nose, wearing a sunshine-yellow raincoat with the hood up and little flying goggles on the hood",
    gender: "f", ageBand: "young", energy: "warm",
    voiceId: "char:dot",
    voiceStyle: "a tiny, sweet, giggly toddler voice with a little lisp",
    continuity: "She is a 3D-animated cartoon baby dinosaur: mint-green skin, cream belly, bare three-toed feet, no shoes. She wears only the sunshine-yellow raincoat with its hood up and the goggles on the hood.",
  },
  {
    id: "howl", name: "Howl", vibe: "Werewolf", kind: "monster",
    desc: "a huge werewolf standing upright, with shaggy dark-grey fur, glowing yellow eyes and bared fangs, wearing the torn remains of a red plaid shirt",
    gender: "m", ageBand: "mid", energy: "hype",
    voiceId: "char:howl",
    voiceStyle: "a low, gravelly growl of a voice, every word pushed out through bared teeth",
    continuity: "He is a werewolf: dark-grey fur over his whole body, clawed hands and clawed wolf feet — no shoes, no trousers beyond the fur, only the torn red plaid shirt. Glowing yellow eyes.",
  },
  {
    id: "mary", name: "Mourning Mary", vibe: "Ghost bride", kind: "monster",
    desc: "a ghostly bride with long black hair, hollow dark eyes and skin like cracked white porcelain, wearing a tattered ivory lace wedding dress and a torn veil",
    gender: "f", ageBand: "mid", energy: "calm",
    voiceId: "char:mary",
    voiceStyle: "a soft, mournful, breathy whisper that seems to come from another room",
    continuity: "She is a ghost: cracked white-porcelain skin on her face, arms and hands, hollow dark eyes, long black hair. The tattered ivory lace wedding dress falls all the way to the floor and hides her feet.",
  },
  {
    id: "keeper", name: "The Keeper", vibe: "Hooded reaper", kind: "monster",
    desc: "a tall skeletal figure in a heavy charcoal hooded robe, with a weathered bone skull for a face, small cold-blue flames burning in the eye sockets and long bony hands",
    gender: "m", ageBand: "mature", energy: "calm",
    voiceId: "char:keeper",
    voiceStyle: "a deep, hollow, echoing voice, slow and deliberate, as if spoken from the bottom of a well",
    continuity: "He is a skeleton in a robe: a bone skull face with cold-blue flames in the eye sockets, bone hands — never skin. The heavy charcoal hooded robe falls to the floor and hides his feet.",
  },
];
