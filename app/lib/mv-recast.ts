/* A SCENE'S WORDS FOLLOW ITS CAST.
 *
 * A storyboard scene is two things: a picture, and the words that describe it ("OMAR sings straight to
 * camera under a streetlamp, VALENTINA dancing softly beside him…"). The picture is drawn FROM the words,
 * and so is the motion of the finished shot. The scene's Cast editor changes who is in the scene — who
 * sings it, who stands beside them — and it used to leave the words alone.
 *
 * Seen on the live site, 2026-11-22: a scene was handed to KEIKO, to sing alone. Its words still said
 * "OMAR sings … VALENTINA dancing softly beside him", so the picture came back with KEIKO in front and an
 * invented woman at her side — the model drew the "VALENTINA" it was told about and had no picture of —
 * and the card read "OMAR sings" under a photograph of KEIKO.
 *
 * So when the people in a scene change, its words are rewritten for who is in it now, the picture is drawn
 * from the new words, and the card shows them. The rewrite is a small language job (names, pronouns, verb
 * agreement, "the three of them") and is done by the writer model on the server; what is HERE is everything
 * around it that can be checked without one: whether a rewrite is needed at all, the instruction, the test
 * its answer must pass — and a plain rewrite, by rule, that is used whenever the writer cannot be reached
 * or answers badly. Pure: no network, no clock.
 */

/** Who is in a scene now, by name. `names` is everyone in the video (the star and the co-stars);
 *  `lead` is whoever is in front (sings it, in a performance) and `wasLead` who that was before the edit;
 *  `beside` is whoever stands with them. A name may be "" (a star with no name). */
export type Recast = { names: string[]; lead: string; wasLead: string; beside: string[] };

/** The most a scene's words may run to (the box on the card holds 400). */
export const VISUAL_MAX = 400;

const clean = (s: string | null | undefined): string => (s || "").replace(/\s+/g, " ").trim();
const same = (a: string, b: string): boolean => clean(a).toLowerCase() === clean(b).toLowerCase();
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** `name` as a whole word, whatever its case — never the "OMAR" inside "OMARION". */
const nameRe = (name: string, flags = "iu"): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(clean(name))}(?![\\p{L}\\p{N}])`, flags);

/** Do these words name this person? */
export function mentions(text: string | null | undefined, name: string | null | undefined): boolean {
  return !!clean(name) && nameRe(name as string).test(text || "");
}

/** Everyone named in the video who is NOT in this scene now. */
export function notInScene(o: Recast): string[] {
  const here = [o.lead, ...o.beside].map(clean).filter(Boolean);
  const out: string[] = [];
  for (const n of o.names.map(clean)) if (n && !here.some((h) => same(h, n)) && !out.some((x) => same(x, n))) out.push(n);
  return out;
}

/** Do the words have to change? Only when they would now be WRONG: someone else leads the scene, or
 *  they name a person who is no longer in it. Words that are still true are never touched — they may be
 *  the maker's own. */
export function recastNeeded(visual: string | null | undefined, o: Recast): boolean {
  const text = clean(visual);
  if (!text) return false;
  if (!same(o.lead, o.wasLead) && (mentions(text, o.wasLead) || (!!clean(o.lead) && !mentions(text, o.lead)))) return true;
  return notInScene(o).some((n) => mentions(text, n));
}

/** Take one person out of a phrase that keeps someone else: "OMAR and VALENTINA" → "OMAR". */
function dropName(clause: string, name: string): string {
  const n = escapeRe(clean(name));
  const edge = (re: string) => new RegExp(re, "giu");
  return clause
    .replace(edge(`(?:\\s*,)?\\s*(?<![\\p{L}\\p{N}])(?:and|&|with|alongside|beside|next to|plus)\\s+${n}(?![\\p{L}\\p{N}])`), "")
    .replace(edge(`(?<![\\p{L}\\p{N}])${n}\\s*(?:,|and(?![\\p{L}\\p{N}])|&)\\s*`), "")
    .replace(edge(`(?<![\\p{L}\\p{N}])${n}(?![\\p{L}\\p{N}])`), "")
    .replace(/\s+/g, " ").trim();
}

/** THE PLAIN REWRITE, by rule — used when the writer model cannot be reached or its answer fails
 *  `recastAccept`. It works phrase by phrase (a scene is written as phrases joined by commas):
 *   · a phrase about the old lead becomes a phrase about the new one;
 *   · the phrase where the new lead was only standing by goes;
 *   · a phrase that is only about someone who is no longer in the scene goes;
 *   · a phrase that keeps someone and names someone who left loses that name.
 *  It does not repair grammar (pronouns, verb agreement) — that is the writer's part — but what it
 *  returns never names a person who is not in the scene. */
export function recastVisual(visual: string | null | undefined, o: Recast): string {
  const text = clean(visual);
  if (!text || !recastNeeded(text, o)) return text;
  const lead = clean(o.lead), was = clean(o.wasLead);
  const here = [lead, ...o.beside.map(clean)].filter(Boolean);
  const gone = notInScene(o);
  const swap = !!was && !!lead && !same(lead, was) && mentions(text, was);
  const bits = text.split(/(\s*[,;]\s+|\s+[—–-]\s+)/u); // phrase, what joined it, phrase, …
  const kept: Array<{ join: string; phrase: string }> = [];
  for (let k = 0; k < bits.length; k += 2) {
    let phrase = bits[k];
    if (!clean(phrase)) continue;
    if (swap) {
      const hasWas = mentions(phrase, was), hasLead = mentions(phrase, lead);
      if (hasWas && !hasLead) phrase = phrase.replace(nameRe(was, "giu"), lead);
      else if (hasLead && !hasWas) continue; // where the new lead was only standing by
    }
    const left = gone.filter((n) => mentions(phrase, n));
    if (left.length) {
      if (!here.some((n) => mentions(phrase, n))) continue; // only about someone who is not here
      for (const n of left) phrase = dropName(phrase, n);
      if (!clean(phrase)) continue;
    }
    kept.push({ join: k > 0 ? bits[k - 1] : "", phrase });
  }
  let out: string;
  if (kept.length) out = kept.map((x, k) => (k === 0 ? "" : x.join) + x.phrase).join("");
  else {
    // every phrase was about someone who left: keep the words, lose the names
    out = swap ? text.replace(nameRe(was, "giu"), lead) : text;
    for (const n of gone) out = dropName(out, n);
  }
  out = clean(out).replace(/\s+([,;.!?])/g, "$1").replace(/^[,;\s—–-]+/u, "");
  if (!out) return text;
  out = out.charAt(0).toUpperCase() + out.slice(1);
  if (/[.!?]$/.test(text) && !/[.!?]$/.test(out)) out += ".";
  return out.slice(0, VISUAL_MAX);
}

/** THE INSTRUCTION for the writer: the fewest changes that make the words true. */
export function recastPrompt(visual: string, o: Recast, performing: boolean): string {
  const lead = clean(o.lead) || "the singer";
  const beside = o.beside.map(clean).filter(Boolean);
  const gone = notInScene(o);
  return [
    "You are correcting ONE shot description from a music-video storyboard so that it matches who is in the shot now.",
    "",
    "SHOT DESCRIPTION:",
    clean(visual),
    "",
    "WHO IS IN THE SHOT NOW:",
    `- In front${performing ? ", singing straight to camera" : ""}: ${lead}`,
    `- With them: ${beside.length ? beside.join(", ") : "nobody else — they are alone in the shot"}`,
    ...(gone.length ? [`- NOT in the shot (they must not be mentioned at all): ${gone.join(", ")}`] : []),
    "",
    "Rewrite the description with the FEWEST changes that make it true.",
    "- Keep the place, the light, the objects, the framing and the action exactly as written.",
    "- Change only what who-is-in-it forces: names, pronouns, verb agreement, head-counts such as \"the three of them\".",
    "- A phrase that exists only to describe someone who is not in the shot is removed.",
    "- Add nothing: no new people, no clothes, no objects, no new details. Never say what anyone wears.",
    "- Write every name exactly as it is given above.",
    `Answer with the corrected description only — one or two sentences, at most ${VISUAL_MAX} characters, no quotation marks, nothing before or after it.`,
  ].join("\n");
}

/** THE TEST the writer's answer must pass — else the plain rewrite is used. It must be one short
 *  description (not an essay, not an apology), name nobody who has left the scene, name the new lead where
 *  the old words named the old one, and not have thrown the scene away. Returns it cleaned, or null. */
export function recastAccept(candidate: string | null | undefined, visual: string, o: Recast): string | null {
  let c = clean(candidate).replace(/^["“”'`]+|["“”'`]+$/gu, "").trim();
  c = c.replace(/^(?:corrected|rewritten|new)?\s*(?:shot\s+)?description\s*:\s*/i, "").trim();
  const before = clean(visual);
  if (!c || c.length > VISUAL_MAX) return null;
  if (before && c.length < Math.min(40, Math.floor(before.length * 0.3))) return null; // the scene was thrown away
  if (notInScene(o).some((n) => mentions(c, n))) return null;
  const lead = clean(o.lead);
  if (lead && !same(lead, o.wasLead) && mentions(before, o.wasLead) && !mentions(c, lead)) return null;
  if (/\b(?:I cannot|I can't|I'm sorry|as an AI|here is|here's the)\b/i.test(c)) return null;
  return c;
}
