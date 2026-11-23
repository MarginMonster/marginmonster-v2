/* THE WORDS ON AN IMAGE AD — what its viewer shows, instead of our brief to the image model.
 *
 * Opened as a customer, 2026-11-23: an image ad's viewer had a block titled "Prompt". On one ad it held the
 * text "deterministic-callout" — an internal tag for how the picture was put together. On the next it held
 * our own brief to the image model ("Modern high-converting DTC e-commerce static ad, crisp clean design,
 * square 1:1 … Every text string below must appear EXACTLY as written …"). Neither is the merchant's, and
 * neither is of any use to them. What IS of use is what the ad says — the headline, the points, the
 * button — to read back, check, and paste into a post.
 *
 * Pure. The format copy is stored with the picture (bodyJson.formatCopy: field → text).
 */

/** Fields that open an ad, in the order tried. */
const LEADS = ["headline", "masthead", "question", "title", "word", "query", "pov"];
/** Fields that close it. */
const TAILS = ["cta"];
/** Fields that are not the ad speaking: bylines, handles and labels that only make sense in the layout. */
const SKIP = new Set(["name", "founder", "handle", "outlet", "tn1", "tn2", "tn3", "l1", "l2", "statlabel"]);

/** The ad's words, one to a line, in reading order — or null when the picture has no stored copy. Repeats
 *  are said once; at most `max` lines (the viewer shows six). */
export function adWordsOf(copy: unknown, max = 6): string | null {
  if (!copy || typeof copy !== "object" || Array.isArray(copy)) return null;
  const o = copy as Record<string, unknown>;
  const val = (k: string): string => (typeof o[k] === "string" ? (o[k] as string).replace(/\s+/g, " ").trim() : "");
  const lead = LEADS.filter((k) => val(k));
  const tail = TAILS.filter((k) => val(k));
  const middle = Object.keys(o).filter((k) => !LEADS.includes(k) && !TAILS.includes(k) && !SKIP.has(k) && val(k));
  const seen = new Set<string>();
  const lines: string[] = [];
  const push = (k: string) => {
    const v = val(k);
    const key = v.toLowerCase();
    if (!v || seen.has(key)) return;
    seen.add(key);
    lines.push(v);
  };
  lead.forEach(push);
  // room is kept for the button, which is what the ad asks for
  const room = Math.max(0, max - lines.length - (tail.length ? 1 : 0));
  middle.slice(0, room).forEach(push);
  tail.forEach(push);
  return lines.length ? lines.slice(0, max).join("\n") : null;
}
