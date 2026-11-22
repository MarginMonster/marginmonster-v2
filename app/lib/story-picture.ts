/* A NARRATED STORY'S PICTURES ARE LOOKED AT BEFORE THEY ARE SHOWN.
 *
 * A told story is a picture for every scene. Three stories made as a customer on 2026-11-22 (a horror
 * story, a short story, a moral story — eighteen stills) came back with four pictures nobody had checked:
 *   · a scene drawn as TWO PANELS stacked — its text described two moments ("the loaf sits on the step …
 *     until it is gone moments later");
 *   · a cast member drawn as SOMEONE ELSE (twice — once when the text named three people and she was the
 *     one left out, once with her hair turned dark);
 *   · a door "marked with" something, drawn as a sign of gibberish glyphs.
 * Each was put right by a re-roll, by hand. This is the same look, taken before the maker has to:
 *   · the scene's words are tidied to ONE moment and to nothing written (oneMoment, noLettering);
 *   · the picture is then read — is each cast member in it, is it one picture — and drawn again when it
 *     is not (storyCheckPrompt / parseStoryCheck / storyFaults / storyFix).
 * Clothes are NOT judged here: a story dresses its people for the part (the baker wears an apron).
 */

/** Words that start a SECOND moment in a picture's description. */
const NEXT_MOMENT = /[\s,;—–-]+(?:and then|then|until|moments? later|seconds? later|minutes? later|a (?:moment|beat|second) later|soon after|shortly after|afterwards?|later on|later|before (?:finally|eventually))\b/i;

/** A picture shows ONE moment. A description that runs on into a second one ("…, until the bundle is gone
 *  moments later") is cut where the second begins — but only when what is left is still a scene (six
 *  words or more); otherwise it is left alone, and the picture check has the last word. */
export function oneMoment(visual: string): string {
  const v = (visual || "").replace(/\s+/g, " ").trim();
  const m = NEXT_MOMENT.exec(v);
  if (!m || m.index <= 0) return v;
  const kept = v.slice(0, m.index).replace(/[\s,;:—–-]+$/, "").trim();
  return kept.split(" ").length >= 6 ? `${kept}.` : v;
}

/** A picture model cannot write: asked for a door "marked with" a ward number or a sign that "reads" a
 *  name, it draws glyphs. The thing stays in the picture; what is written on it is taken out of the words. */
export function noLettering(visual: string): string {
  return (visual || "")
    // …a sign reading "Ward C" / that says 'CLOSED'
    .replace(/\s*,?\s*(?:that|which)?\s*(?:reads?|says?|reading|saying|spelling(?: out)?)\s+["“'‘][^"”'’]{1,80}["”'’]/gi, "")
    // …marked / labelled / stamped (with) "…"
    .replace(/\s*,?\s*(?:marked|labell?ed|stamped|painted|printed|inscribed|engraved|lettered|titled)\s+(?:with\s+)?(?:the\s+(?:words?|name|number)\s+)?["“'‘][^"”'’]{1,80}["”'’]/gi, "")
    // …marked with a faded ward number / labelled with her name
    .replace(/\s*,?\s*(?:marked|labell?ed|stamped|inscribed|engraved|lettered)\s+with\s+(?:(?:a|an|the|its|his|her|their)\s+)?(?:[\w'’-]+\s+){0,3}(?:numbers?|numerals?|letters?|lettering|words?|names?|initials|writing|text|labels?)\b/gi, "")
    // anything else in double quotes is something to be read
    .replace(/\s*["“][^"”]{1,80}["”]/g, "")
    .replace(/\s+([,.;])/g, "$1").replace(/,(?:\s*,)+/g, ",").replace(/\s{2,}/g, " ").trim();
}

/** What is asked of the picture model, said in the prompt itself. */
export const ONE_PICTURE = "ONE single continuous picture of ONE moment, filling the whole frame — never a split screen, a collage, comic panels, a before-and-after or a grid.";
export const NOTHING_WRITTEN = "Nothing in the picture is written: no signs with words, labels, notices, numbers, letters or captions — a door, a shopfront or a page is drawn plain.";

/** What the look reads off a story picture: for each cast member, in the order of their reference
 *  pictures, whether that same character is in it; and whether the picture is split into panels. */
export type StoryCheck = { seen: boolean[]; panels: boolean };

/* TWO QUESTIONS, ASKED SEPARATELY. One long question that did both let a wrong cast member through: the
 * reader wrote "silver-grey bob" for her own picture and "brown hair up" for the woman in the scene — and
 * then answered "seen: true". Asked on their own, each was right every time on the real reader with the
 * day's own stills (2026-11-22): the cast question 7 of 7 (a wrong woman caught, a deliberate mismatch
 * refused, five right pictures passed — one seen only from behind), the panels question 5 of 5. */

const NTH = ["2nd", "3rd", "4th"];
/** WHO IS IN IT. The picture is the FIRST image shown; `refs` (1–3) cast pictures follow it. The reader
 *  writes down what it sees of each character BEFORE it answers, and is told to COMPARE what it wrote —
 *  asked for the answer alone, a reader says "the same". */
export function storyCastPrompt(refs: number): string {
  const n = Math.max(1, Math.min(3, Math.round(refs || 1)));
  const who = `The FIRST image is a picture from an illustrated story. The ${n === 1 ? "image after it is the one character" : `${n} images after it are the ${n} characters`} who must be in it (${Array.from({ length: n }, (_, k) => `character ${k + 1} is the ${NTH[k]} image`).join(", ")}).`;
  return `${who} For EACH character, first write down in a few words what identifies them in their OWN image — for a person: hair colour, hair length and style, skin tone, apparent age, beard or none; for a creature or cartoon: what kind of creature, its colours and markings — and then the one in the first image who is closest to that, in the same few words (or "nobody"). Then COMPARE the two descriptions you wrote and say whether that character IS in the first image. It is the same individual only if the hair colour, the skin tone and the apparent age all agree (for a creature: the kind of creature, its colours and its markings). Seen from behind, small in the frame or in different clothes still counts — clothes do NOT matter, a story dresses people for the part. If your two descriptions differ in hair colour (silver against brown, red against black), in skin tone or clearly in age, the answer is false. Reply with ONLY this JSON: {"own": ["…" for each character], "inPicture": ["…" for each], "seen": [true or false for each, in order]}.`;
}

/** ONE PICTURE OR SEVERAL. Asked outright ("is it split into panels?") the reader passed a picture that
 *  was two near-identical views stacked. Told to describe it HALF BY HALF first, it saw the same path
 *  twice and said so — and still passed a desk edge, a window, a counter and a horizon. */
export function storyPanelsPrompt(): string {
  return `The first image is a picture from an illustrated story. Check whether it is ONE picture or SEVERAL pictures joined together. Look at it in halves: describe in a few words what the TOP half shows and what the BOTTOM half shows, then what the LEFT half and the RIGHT half show. It is split into panels if a straight edge divides it into separate pictures — for example the same place, object or person drawn TWICE (once in each half), two different camera views stacked or side by side, or a before-and-after. A window, a mirror, a doorway, a table edge or a horizon inside one scene is NOT a split. Reply with ONLY this JSON: {"top": "…", "bottom": "…", "left": "…", "right": "…", "panels": true or false}.`;
}

const jsonIn = (raw: string): Record<string, unknown> | null => {
  const text = String(raw || "");
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { const j = JSON.parse(text.slice(a, b + 1)); return j && typeof j === "object" ? (j as Record<string, unknown>) : null; } catch { return null; }
};
/** Who was seen, in the order asked — null when the answer cannot be read (the caller then keeps the
 *  picture: a look that says nothing must never cost a story its picture). */
export function parseStoryCast(raw: string, refs: number): boolean[] | null {
  const n = Math.max(1, Math.min(3, Math.round(refs || 1)));
  const seen = jsonIn(raw)?.seen;
  if (!Array.isArray(seen) || seen.length < n || seen.slice(0, n).some((s) => typeof s !== "boolean")) return null;
  return seen.slice(0, n) as boolean[];
}
/** Split into panels? — null when the answer cannot be read. */
export function parseStoryPanels(raw: string): boolean | null {
  const p = jsonIn(raw)?.panels;
  return typeof p === "boolean" ? p : null;
}

/** How wrong a picture is: a split picture is the worst (it cannot be used at all), then each cast member
 *  who is not in it. 0 = keep it. */
export const storyFaults = (c: StoryCheck): number => (c.panels ? 4 : 0) + 3 * c.seen.filter((s) => !s).length;

/** What to tell the picture model on the next go: the fault, named. `names` in the order of the references. */
export function storyFix(c: StoryCheck, names: string[]): string {
  const out: string[] = [];
  if (c.panels) out.push("The last try was split into panels — draw ONE single picture of one moment that fills the whole frame");
  const gone = c.seen.map((s, k) => (s ? "" : (names[k] || `the character in reference image ${k + 1}`))).filter(Boolean);
  if (gone.length) out.push(`${gone.join(" and ")} ${gone.length === 1 ? "was" : "were"} missing or drawn as someone else in the last try — draw ${gone.length === 1 ? "them" : "each of them"} EXACTLY as in their reference image: the same face, hair colour and hair`);
  return out.length ? ` ${out.join(". ")}.` : "";
}
