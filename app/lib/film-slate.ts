/* THE SLATE — what is written on it.
 *
 * Pressing Generate is "action!", so the Movie Maker claps a slate (routes/web.film.tsx → Slate) — and it is
 * THIS film's slate, not a picture of one: its title, its format, how many scenes, today's date, and its
 * director: you. (The owner, 2026-11-24: "genius level artistic detail additions that make the app feel
 * alive".) Pure: the page draws it.
 */

/** What a film's slate is headed with: its title once it has one; before a word is written, the first
 *  words of the idea (seven, then "…"); with no idea either, the format's own name. One line of plain
 *  text, eighty characters at most. */
export function slateTitle(title: string | null | undefined, idea: string | null | undefined, format: string): string {
  const own = String(title || "").replace(/\s+/g, " ").trim();
  if (own) return own.slice(0, 80);
  const words = String(idea || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length) return `${words.slice(0, 7).join(" ")}${words.length > 7 ? "…" : ""}`.slice(0, 80);
  return String(format || "").trim();
}
