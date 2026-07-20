/* The Video Studio cast — 100 presenter avatars, each with 4 wardrobe
 * variants. Client-safe (no server imports). Portraits live at
 * public/avatars/{id}_{variant}.jpg (variant 0-3); the chosen portrait seeds
 * the video model's first frame so the presenter you cast — in the outfit you
 * picked — is who appears. Persona data: avatars-data.json. */

import RAW from "./avatars-data.json";
import LEDGER from "./voice-design-ledger.json";

export type Gender = "f" | "m";
export type AgeBand = "young" | "mid" | "mature"; // ~20s / 30s-40s / 50s+
export type Energy = "hype" | "warm" | "calm";

export type Avatar = {
  id: string;
  name: string;
  vibe: string; // short label under the name
  desc: string; // prompt descriptor injected into the generation
  gender: Gender; // explicit — drives voice selection (no more coin-flip)
  ageBand: AgeBand; // so the voice's age fits the face
  energy: Energy; // so the voice's character fits the persona
};

/* Derive persona traits from the desc + vibe (the cast is authored with clear
 * age/energy cues). Explicit optional overrides can be added as a 5th JSON
 * element later; until then these read cleanly for all 100. */
function deriveGender(desc: string): Gender {
  return /\b(woman|girl|lady|female|mom|grandma|abuela|she|her|her's)\b/i.test(desc) &&
    !/\b(man|guy|male|gentleman|dad|grandpa)\b/i.test(desc)
    ? "f"
    : /\b(man|men|guy|male|gentleman|boy|dad|uncle|grandpa|bloke|dude|him|his)\b/i.test(desc)
      ? "m"
      : "f";
}
function deriveAge(desc: string): AgeBand {
  const d = desc.toLowerCase();
  if (/\b(fifties|sixties|seventies|grandma|grandpa|grandmother|grandfather|older|senior|silver-haired|salt-and-pepper|graying|elderly)\b/.test(d)) return "mature";
  if (/\b(thirties|forties|mid thirties|late thirties|mother|father|middle-aged)\b/.test(d)) return "mid";
  if (/\b(twenties|early twenties|late twenties|teen|young|gen-z|college|student)\b/.test(d)) return "young";
  return "mid";
}
function deriveEnergy(vibe: string, desc: string): Energy {
  const s = `${vibe} ${desc}`.toLowerCase();
  if (/\b(energy|hype|playful|excited|bubbly|upbeat|bold|street|vibrant|fun|bright|lively|spunky)\b/.test(s)) return "hype";
  if (/\b(elegant|luxury|serene|calm|refined|polished|graceful|soft|gentle|soothing|quiet|zen|minimal)\b/.test(s)) return "calm";
  return "warm";
}

/** Presenters with hand-designed premium voices (accent/ethnicity matched via
 *  MiniMax Voice Design) — they lead the cast picker and wear the ✦ sampler. */
export const DESIGNED_VOICES: Set<string> = new Set(Object.keys((LEDGER as { designed: Record<string, unknown> }).designed || {}));

const ALL_AVATARS: Avatar[] = (RAW as [string, string, string, string][]).map(
  ([id, name, vibe, desc]) => ({
    id, name, vibe, desc,
    gender: deriveGender(desc),
    ageBand: deriveAge(desc),
    energy: deriveEnergy(vibe, desc),
  })
);

// premium-voiced cast first (stable order within both groups)
export const AVATARS: Avatar[] = [
  ...ALL_AVATARS.filter((a) => DESIGNED_VOICES.has(a.id)),
  ...ALL_AVATARS.filter((a) => !DESIGNED_VOICES.has(a.id)),
];

export const AVATAR_BY_ID: Record<string, Avatar> = Object.fromEntries(
  AVATARS.map((a) => [a.id, a])
);

/* Wardrobe — 4 outfit variants per avatar. `desc` feeds both the portrait
 * generation and the video prompt so the outfit carries through. */
export const OUTFITS = [
  { label: "Casual", desc: "a relaxed casual outfit with a soft cotton tee or light open overshirt" },
  { label: "Smart", desc: "a smart polished outfit with a tailored blazer or crisp button-up" },
  { label: "Active", desc: "sporty athletic wear with a fitted training top or light zip-up" },
  { label: "Street", desc: "trendy streetwear with a graphic hoodie or denim jacket" },
] as const;

// bump when the portrait set is replaced so browsers reload (not the stale cache)
export const AVATAR_V = "2";

export function avatarImg(id: string, variant: number = 0): string {
  const v = Math.max(0, Math.min(OUTFITS.length - 1, Math.floor(variant)));
  return `/avatars/${id}_${v}.jpg?v=${AVATAR_V}`;
}

/* How many avatars show before "VIEW MORE" expands the full cast. */
export const CAST_PREVIEW_COUNT = 12;

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
