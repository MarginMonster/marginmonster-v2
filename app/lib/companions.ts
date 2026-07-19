/* The companion gallery — THE TROOP: 26 chibi pixel monkeys forged under the
 * OG hard standard (island era, 2026-07), plus the ten surviving legends of
 * the old 48 the user chose to keep. Every companion has three flipbook
 * frames (base/blink/cheer) at public/companions/{id}.png, {id}_b.png,
 * {id}_c.png — troop frames start as static copies and upgrade to true
 * flicker frames as the animation program lands. Client-safe: no server
 * imports. */

export type CompanionCategory = "troop" | "others";

export type CompanionDef = {
  id: string;
  name: string;
  vibe: string;
  cat: CompanionCategory;
  accent: string; // aura color
};

export const COMPANION_V = "3"; // bump to bust image cache on regen

export const CATEGORY_LABEL: Record<CompanionCategory, string> = {
  troop: "🐒 Partner Monkeys",
  others: "✨ Others",
};

export const COMPANIONS: CompanionDef[] = [
  // 🐒 The Troop
  { id: "og", name: "OG", vibe: "The original easy", cat: "troop", accent: "#F0B429" },
  { id: "shades", name: "SHADES", vibe: "Too cool to hustle", cat: "troop", accent: "#4cc3ff" },
  { id: "wig", name: "WIG", vibe: "Fabulous and viral", cat: "troop", accent: "#f5ce62" },
  { id: "female", name: "FEMALE", vibe: "Runs this island", cat: "troop", accent: "#f2a3c4" },
  { id: "strong", name: "STRONG", vibe: "Lifts heavy, posts daily", cat: "troop", accent: "#e2503c" },
  { id: "skeleton", name: "SKELETON", vibe: "Dead inside, still posting", cat: "troop", accent: "#d9d4c9" },
  { id: "zombie", name: "ZOMBIE", vibe: "Brains and brand awareness", cat: "troop", accent: "#7fae6a" },
  { id: "tiny", name: "TINY", vibe: "Absolute unit", cat: "troop", accent: "#c9a25e" },
  { id: "biggie", name: "BIGGIE", vibe: "Small but mighty", cat: "troop", accent: "#ffd76a" },
  { id: "cowboy", name: "COWBOY", vibe: "Yeehaw economics", cat: "troop", accent: "#a86832" },
  { id: "moneybags", name: "MONEYBAGS", vibe: "Old money energy", cat: "troop", accent: "#f0b429" },
  { id: "midas", name: "MIDAS", vibe: "Posts turn to gold", cat: "troop", accent: "#ffe066" },
  { id: "bolt", name: "BOLT", vibe: "Beep means banana", cat: "troop", accent: "#c0c8d8" },
  { id: "servo", name: "SERVO", vibe: "Wound up and ready", cat: "troop", accent: "#d8555a" },
  { id: "circuit", name: "CIRCUIT", vibe: "Runs on ones and zeros", cat: "troop", accent: "#38e0d0" },
  { id: "capn", name: "CAP'N BANANAS", vibe: "Plunders the algorithm", cat: "troop", accent: "#d84848" },
  { id: "hex", name: "HEX", vibe: "Casts engagement +2", cat: "troop", accent: "#7c5cff" },
  { id: "comet", name: "COMET", vibe: "One small step for sales", cat: "troop", accent: "#9ad8ff" },
  { id: "kongfu", name: "KONG-FU", vibe: "Strikes while trending", cat: "troop", accent: "#5c5c74" },
  { id: "rex", name: "REX", vibe: "The crown fits", cat: "troop", accent: "#b77bff" },
  { id: "sizzle", name: "SIZZLE", vibe: "Cooks content daily", cat: "troop", accent: "#ff9d4d" },
  { id: "tubes", name: "TUBES", vibe: "Rides every wave", cat: "troop", accent: "#4cc3e8" },
  { id: "mchammock", name: "MC HAMMOCK", vibe: "Drops beats and drops", cat: "troop", accent: "#f5ce62" },
  { id: "sprout", name: "SPROUT", vibe: "Fresh growth", cat: "troop", accent: "#3ed598" },
  { id: "lobster", name: "LOBSTER", vibe: "Snappy campaigns", cat: "troop", accent: "#e24b4a" },
  { id: "knight", name: "SIR MONKALOT", vibe: "Defends the brand", cat: "troop", accent: "#c9ccd6" },
  // Legends of the old world
  { id: "mummsy", name: "WRAPS", vibe: "Fully bandaged brand", cat: "others", accent: "#d9c9a0" },
  { id: "ghosty", name: "BOOBERT", vibe: "Transparent reporting", cat: "others", accent: "#cfd0ee" },
  { id: "shroom", name: "PORTOBELLO", vibe: "Fun guy", cat: "others", accent: "#e24b4a" },
  { id: "viking", name: "BJORN", vibe: "Raids the charts", cat: "others", accent: "#38bdf8" },
  { id: "greyby", name: "ZORP", vibe: "Definitely not spying", cat: "others", accent: "#8ee89c" },
  { id: "robo", name: "BLEEP", vibe: "Beep boop, budget optimized", cat: "others", accent: "#34E7E4" },
  { id: "mechacat", name: "NEKO-9", vibe: "Purrs in binary", cat: "others", accent: "#38bdf8" },
  { id: "ufosquid", name: "UFSEO", vibe: "Probing the market", cat: "others", accent: "#c084fc" },
  { id: "droid", name: "UNIT-7", vibe: "Compliance is joy", cat: "others", accent: "#e8e8f0" },
  { id: "unicot", name: "PRISM", vibe: "Actually a unicorn", cat: "others", accent: "#f2a3c4" },
];

export const COMPANION_BY_ID: Record<string, CompanionDef> = Object.fromEntries(
  COMPANIONS.map((c) => [c.id, c])
);

export function companionSrcs(id: string): { a: string; b: string; c: string } {
  const v = `?v=${COMPANION_V}`;
  return {
    a: `/companions/${id}.png${v}`,
    b: `/companions/${id}_b.png${v}`,
    c: `/companions/${id}_c.png${v}`,
  };
}
