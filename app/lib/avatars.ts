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
  /** What has to stay true BELOW the face when this presenter is composed
   *  into a new shot. The compose prompt locks "same face, same hairstyle,
   *  same outfit" — which is everything a human presenter needs, and not
   *  enough for a character: a golden-green ogre kept coming back with
   *  ordinary human hands on the product, because nothing ever said his skin
   *  continues past his chin. Blank for the human cast. */
  continuity?: string;
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

/* ---- Private cast ----
 * Presenters visible ONLY to the accounts listed as owners — the founder's
 * Magic Monster brand advocate lives here, not in the public cast. An owner
 * entry is matched (case-insensitively) against the viewer's web account
 * email or Shopify shop domain, whichever surface they're on. Portraits use
 * the same public/avatars/{id}_{variant}.jpg convention. */
export const PRIVATE_AVATARS: Array<Avatar & { owners: string[] }> = [
  {
    id: "monster",
    name: "Magic Monster",
    vibe: "Brand advocate",
    desc: "a photorealistic friendly muscular golden-green ogre gentleman with a bald head, large pointed ears, chunky black rectangular glasses and a warm confident grin",
    gender: "m",
    ageBand: "mid",
    energy: "hype",
    continuity: "His hands, fingers, forearms, neck and ears are the SAME golden-green skin as his face — the same colour and the same texture, never human flesh tone. Any part of him touching or holding the product is that same golden-green.",
    // The founder's EasyMode account and their personal address — both, because
    // which one they happen to be signed into is not something the picker
    // should have an opinion about.
    owners: ["magicmonstermarket@gmail.com", "slyshoffner@gmail.com"],
  },
];

/** The private presenters these identities own.
 *
 *  Takes SEVERAL identities on purpose — a person is their web account email,
 *  their shop id and their store domain, and which one a given route happens
 *  to hold is an implementation detail the caller shouldn't have to think
 *  about. The single-identity version failed silently and invisibly: sign up
 *  with a different address than the one hardcoded below and your own private
 *  avatar just isn't in the picker, with nothing to explain why.
 *
 *  PRIVATE_AVATAR_OWNERS (comma-separated) extends the list from the
 *  environment, so adding an owner is a config change rather than a deploy —
 *  a hardcoded email in source is a bad place to keep something a merchant
 *  can change in their account settings. */
export function privateCastFor(...identities: (string | null | undefined)[]): Avatar[] {
  const envOwners = (process.env.PRIVATE_AVATAR_OWNERS || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const mine = identities
    .map((i) => (i || "").trim().toLowerCase())
    .filter(Boolean);
  if (!mine.length) return [];
  return PRIVATE_AVATARS
    .filter((a) => {
      const owners = [...a.owners.map((o) => o.toLowerCase()), ...envOwners];
      return owners.some((o) => mine.includes(o));
    })
    .map(({ owners: _owners, ...a }) => a);
}

/* Lookups include the private cast — generation pipelines resolve by id
 * after the picker has already enforced visibility. */
export const AVATAR_BY_ID: Record<string, Avatar> = Object.fromEntries(
  [...AVATARS, ...PRIVATE_AVATARS.map(({ owners: _owners, ...a }) => a)].map((a) => [a.id, a])
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
