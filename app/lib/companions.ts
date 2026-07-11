/* The companion gallery — 48 chibi partners across the archetypes merchants
 * actually love (beast-folk, monsters, undead, fantasy, humans, sci-fi,
 * mythics). Every one has three flipbook frames (base/blink/cheer) at
 * public/companions/{id}.png, {id}_b.png, {id}_c.png — same animation
 * language as the OG partner monsters. Client-safe: no server imports. */

export type CompanionCategory = "beast" | "monster" | "undead" | "fantasy" | "human" | "scifi" | "mythic";

export type CompanionDef = {
  id: string;
  name: string;
  vibe: string;
  cat: CompanionCategory;
  accent: string; // aura color
};

export const COMPANION_V = "1"; // bump to bust image cache on regen

export const CATEGORY_LABEL: Record<CompanionCategory, string> = {
  beast: "🦊 Beast-folk",
  monster: "👾 Monsters",
  undead: "💀 Undead",
  fantasy: "⚔️ Fantasy",
  human: "🧑 Humans",
  scifi: "🛸 Sci-fi",
  mythic: "🐉 Mythics",
};

export const COMPANIONS: CompanionDef[] = [
  // Beast-folk
  { id: "foxy", name: "FOXY", vibe: "Twin-tail trickster", cat: "beast", accent: "#ff8845" },
  { id: "wolfpup", name: "WOLFPUP", vibe: "Loyal to the end", cat: "beast", accent: "#9aa8c9" },
  { id: "catmage", name: "CATMAGE", vibe: "Knows one spell: nap", cat: "beast", accent: "#7c5cff" },
  { id: "redpanda", name: "RUSTY", vibe: "Snack-driven", cat: "beast", accent: "#e8842a" },
  { id: "capy", name: "CAPPY", vibe: "Unbothered. Moisturized.", cat: "beast", accent: "#c9a25e" },
  { id: "froggy", name: "HOPKINS", vibe: "Lilypad executive", cat: "beast", accent: "#4ade80" },
  { id: "sharkbro", name: "CHOMP", vibe: "All smiles, mostly teeth", cat: "beast", accent: "#38bdf8" },
  { id: "owlsage", name: "PROFESSOR HOOT", vibe: "Read the docs", cat: "beast", accent: "#c9b98f" },
  // Monsters
  { id: "slimey", name: "GLOOP", vibe: "Morale in blob form", cat: "monster", accent: "#34E7E4" },
  { id: "drago", name: "EMBER", vibe: "Fresh out the egg", cat: "monster", accent: "#ff6b6b" },
  { id: "golem", name: "PEBBLE", vibe: "Rock solid work ethic", cat: "monster", accent: "#8a94b8" },
  { id: "impish", name: "SNICKER", vibe: "Chaotic marketing energy", cat: "monster", accent: "#b77bff" },
  { id: "yetibud", name: "SNOWBALL", vibe: "Warm hugs, cold hands", cat: "monster", accent: "#dff2ff" },
  { id: "cyclo", name: "WINKY", vibe: "Eye on the prize", cat: "monster", accent: "#ffd76a" },
  { id: "shroom", name: "PORTOBELLO", vibe: "Fun guy", cat: "monster", accent: "#e24b4a" },
  { id: "octo", name: "INKWELL", vibe: "Eight-armed multitasker", cat: "monster", accent: "#c084fc" },
  // Undead
  { id: "bones", name: "SIR RATTLES", vibe: "No skin in the game", cat: "undead", accent: "#e8e8f0" },
  { id: "zombo", name: "LURCH", vibe: "Shuffles the algorithm", cat: "undead", accent: "#8ee89c" },
  { id: "ghosty", name: "BOOBERT", vibe: "Transparent reporting", cat: "undead", accent: "#cfd0ee" },
  { id: "vampy", name: "COUNT CLICKULA", vibe: "Thirsty for engagement", cat: "undead", accent: "#e24b4a" },
  { id: "mummsy", name: "WRAPS", vibe: "Fully bandaged brand", cat: "undead", accent: "#d9c9a0" },
  { id: "lichy", name: "GRIMWALD", vibe: "Eternal ROI", cat: "undead", accent: "#4ade80" },
  // Fantasy
  { id: "wizzy", name: "MERLIN JR", vibe: "Hat bigger than doubts", cat: "fantasy", accent: "#7c5cff" },
  { id: "knighty", name: "SIR CLANKS", vibe: "Full plate, full send", cat: "fantasy", accent: "#b8c4dd" },
  { id: "elfy", name: "WILLOW", vibe: "Never misses a trend", cat: "fantasy", accent: "#4ade80" },
  { id: "dwarfy", name: "FORGE", vibe: "Beard of steel", cat: "fantasy", accent: "#e8842a" },
  { id: "fae", name: "GLIMMER", vibe: "Sparkle department", cat: "fantasy", accent: "#f2a3c4" },
  { id: "orky", name: "GRUK", vibe: "Big heart, bigger tusks", cat: "fantasy", accent: "#8ee89c" },
  { id: "gobby", name: "PENNY", vibe: "Margin monster literally", cat: "fantasy", accent: "#ffd76a" },
  { id: "bardy", name: "LUTE", vibe: "Main character energy", cat: "fantasy", accent: "#e24b8a" },
  // Humans
  { id: "astro", name: "MAJOR TOM", vibe: "To the moon", cat: "human", accent: "#dff2ff" },
  { id: "ninja", name: "SHADOW", vibe: "Silent conversions", cat: "human", accent: "#5d5d8a" },
  { id: "capn", name: "CAPTAIN REDD", vibe: "Plunders the feed", cat: "human", accent: "#e24b4a" },
  { id: "viking", name: "BJORN", vibe: "Raids the charts", cat: "human", accent: "#38bdf8" },
  { id: "ronin", name: "KAI", vibe: "One take, one kill", cat: "human", accent: "#3a6ea8" },
  { id: "chefy", name: "GUSTEAU", vibe: "Cooks content daily", cat: "human", accent: "#f4f0e6" },
  // Sci-fi
  { id: "greyby", name: "ZORP", vibe: "Definitely not spying", cat: "scifi", accent: "#8ee89c" },
  { id: "robo", name: "BLEEP", vibe: "Beep boop, budget optimized", cat: "scifi", accent: "#34E7E4" },
  { id: "mechacat", name: "NEKO-9", vibe: "Purrs in binary", cat: "scifi", accent: "#38bdf8" },
  { id: "starblob", name: "NOVA", vibe: "Sleepy cosmic intern", cat: "scifi", accent: "#ffd76a" },
  { id: "ufosquid", name: "SQUIDLEY", vibe: "Probing the market", cat: "scifi", accent: "#c084fc" },
  { id: "droid", name: "UNIT-7", vibe: "Compliance is joy", cat: "scifi", accent: "#e8e8f0" },
  // Mythics
  { id: "phoenixchick", name: "CINDER", vibe: "Rises from flop eras", cat: "mythic", accent: "#ff9d4d" },
  { id: "unicot", name: "PRISM", vibe: "Actually a unicorn", cat: "mythic", accent: "#f2a3c4" },
  { id: "griff", name: "SKYPAW", vibe: "Half eagle, all business", cat: "mythic", accent: "#e8c15a" },
  { id: "krakey", name: "KRAKS", vibe: "Releases himself", cat: "mythic", accent: "#2f7a68" },
  { id: "cerby", name: "TRIPLET", vibe: "Three heads, one goal", cat: "mythic", accent: "#8a5f38" },
  { id: "hydry", name: "TRIO", vibe: "Cut one ad, two appear", cat: "mythic", accent: "#4ade80" },
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
