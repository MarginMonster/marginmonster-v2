/* Starred presenters ("favourites") and the cast filters — the plain parts, client-safe and tested.
 * A star puts your go-to presenters first wherever you pick one: the cast on Presenters, the Studio's
 * presenters, the Movie Maker's roster. */

/** Starred ones first, everyone else after — each group in the order it came in. */
export function favouritesFirst<T extends { id: string }>(list: T[], favs: Iterable<string>): T[] {
  const set = new Set(favs);
  if (!set.size) return list;
  return [...list.filter((x) => set.has(x.id)), ...list.filter((x) => !set.has(x.id))];
}

export type AgeBand = "" | "20" | "30" | "40";
/** A presenter's stated age ("Mid 20s", "Early 30s", "Late 50s") → the filter band: 20s, 30s, or 40s and
 *  up. "" when the description states no age (a custom presenter, a character) — such a presenter is not
 *  shown under an age filter rather than guessed into one. */
export function ageBand(age: string): AgeBand {
  const m = /\b(\d)0s\b/.exec(age || "");
  if (!m) return "";
  const d = Number(m[1]);
  return d <= 2 ? "20" : d === 3 ? "30" : "40";
}

export type CastFilter = { sex: "" | "f" | "m"; age: AgeBand; energy: "" | "hype" | "warm" | "calm" };
export const NO_FILTER: CastFilter = { sex: "", age: "", energy: "" };

/** Does this member pass the refine chips? An unset chip passes everyone. */
export function passes(m: { gender: string; age: string; energy: string }, f: CastFilter): boolean {
  if (f.sex && m.gender !== f.sex) return false;
  if (f.age && ageBand(m.age) !== f.age) return false;
  if (f.energy && m.energy !== f.energy) return false;
  return true;
}
