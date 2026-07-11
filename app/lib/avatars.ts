/* The Video Studio cast — 100 presenter avatars, each with 4 wardrobe
 * variants. Client-safe (no server imports). Portraits live at
 * public/avatars/{id}_{variant}.jpg (variant 0-3); the chosen portrait seeds
 * the video model's first frame so the presenter you cast — in the outfit you
 * picked — is who appears. Persona data: avatars-data.json. */

import RAW from "./avatars-data.json";

export type Avatar = {
  id: string;
  name: string;
  vibe: string; // short label under the name
  desc: string; // prompt descriptor injected into the generation
};

export const AVATARS: Avatar[] = (RAW as [string, string, string, string][]).map(
  ([id, name, vibe, desc]) => ({ id, name, vibe, desc })
);

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
