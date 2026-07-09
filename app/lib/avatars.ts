/* The Video Studio cast — Zeely-style presenter avatars. Client-safe (no
 * server imports) so the CAST SELECT grid can render from it. Each avatar's
 * `desc` feeds the video prompt, and its portrait (public/avatars/{id}.jpg)
 * seeds the video model's first frame so the presenter you pick is the
 * presenter you get. */

export type Avatar = {
  id: string;
  name: string;
  vibe: string; // short label under the name
  desc: string; // prompt descriptor injected into the generation
};

export const AVATARS: Avatar[] = [
  { id: "maya", name: "MAYA", vibe: "Gen-Z Energy", desc: "an energetic young woman in her early twenties with a bright smile and casual pastel streetwear" },
  { id: "jake", name: "JAKE", vibe: "Fitness Hype", desc: "an athletic man in his late twenties in a fitted training tee with a confident grin" },
  { id: "sophia", name: "SOPHIA", vibe: "Luxury Polish", desc: "an elegant woman in her thirties in a tailored cream blazer with a refined, polished delivery" },
  { id: "marcus", name: "MARCUS", vibe: "Trusted Pro", desc: "a warm, trustworthy man in his mid forties with a salt-and-pepper beard in a smart-casual navy shirt" },
  { id: "lena", name: "LENA", vibe: "Everyday Real", desc: "a friendly woman in her mid thirties in a cozy knit sweater with a soft approachable smile" },
  { id: "kai", name: "KAI", vibe: "Street Style", desc: "a stylish young man in his early twenties in a streetwear hoodie and chain with upbeat energy" },
  { id: "grace", name: "GRACE", vibe: "Calm Aesthetic", desc: "a serene woman in her late twenties in a minimalist beige turtleneck with a calm, soothing delivery" },
  { id: "diego", name: "DIEGO", vibe: "Comedy Energy", desc: "an expressive man in his twenties with curly hair and a playful grin in a colorful graphic tee" },
];

export const AVATAR_BY_ID: Record<string, Avatar> = Object.fromEntries(
  AVATARS.map((a) => [a.id, a])
);

/* Quick-direction chips — one tap inserts proven video angles into the prompt
 * so merchants feel (and are) in control without writing from scratch. */
export const DIRECTION_CHIPS = [
  "Unboxing reveal",
  "Before & after",
  "Slow-mo close-ups",
  "POV honest review",
  "Big excited reaction",
  "Luxury aesthetic",
  "ASMR calm & quiet",
  "Street interview vibe",
];
