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
import { firstJson } from "./first-json.ts";

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
/** …and what is handed to the storyboard about a picture that was KEPT with something still wrong (the
 *  best of its goes): the reading, and who was looked for — in the order of `seen` — so the scene's flag
 *  can say who is missing. */
export type StoryKept = StoryCheck & { who: string[] };

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
  return `${who} For EACH character, first write down in a few words what identifies them in their OWN image — for a person: hair colour, hair length and style, skin tone, apparent age, beard or none; for a creature or cartoon: what kind of creature, HOW IT IS BUILT (standing upright on two legs like a person, or going on four legs like an animal; a body covered in fur, scales or bare skin), its colours, the shape of its ears, its markings, and what it wears — and then the one in the first image who is closest to that, in the same few words (or "nobody"). Then COMPARE the two descriptions you wrote and say whether that character IS in the first image. It is the same individual only if the hair colour, the skin tone and the apparent age all agree (for a creature or cartoon: the kind of creature, how it is built, its colours, its ears and its markings). Seen from behind, small in the frame or in different clothes still counts — for a PERSON clothes do NOT matter, a story dresses people for the part. A creature or cartoon is another matter: an ordinary animal on four legs is NOT an upright creature, and a human being with that creature's head — a person's body in ordinary clothes — is NOT that creature either. If your two descriptions differ in hair colour (silver against brown, red against black), in skin tone or clearly in age — or, for a creature, in what kind of creature it is, in how it is built, in its colour, its ears or its markings — the answer is false. Reply with ONLY this JSON: {"own": ["…" for each character], "inPicture": ["…" for each], "seen": [true or false for each, in order]}.`;
}

/** ONE PICTURE OR SEVERAL. Asked outright ("is it split into panels?") the reader passed a picture that
 *  was two near-identical views stacked. Told to describe it HALF BY HALF first, it saw the same path
 *  twice and said so — and still passed a desk edge, a window, a counter and a horizon. */
export function storyPanelsPrompt(): string {
  return `The first image is a picture from an illustrated story. Check whether it is ONE picture or SEVERAL pictures joined together. Look at it in halves: describe in a few words what the TOP half shows and what the BOTTOM half shows, then what the LEFT half and the RIGHT half show. It is split into panels if a straight edge divides it into separate pictures — for example the same place, object or person drawn TWICE (once in each half), two different camera views stacked or side by side, or a before-and-after. A window, a mirror, a doorway, a table edge or a horizon inside one scene is NOT a split. Reply with ONLY this JSON: {"top": "…", "bottom": "…", "left": "…", "right": "…", "panels": true or false}.`;
}

const jsonIn = firstJson; // the FIRST complete object in an answer (first-json.ts)
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
export function storyFix(c: StoryCheck, names: string[], kinds: ReadonlyArray<string | undefined> = []): string {
  const out: string[] = [];
  if (c.panels) out.push("The last try was split into panels — draw ONE single picture of one moment that fills the whole frame");
  const missing = c.seen.map((s, k) => (s ? -1 : k)).filter((k) => k >= 0);
  const gone = missing.map((k) => names[k] || `the character in reference image ${k + 1}`);
  if (gone.length) out.push(`${gone.join(" and ")} ${gone.length === 1 ? "was" : "were"} missing or drawn as someone else in the last try — draw ${gone.length === 1 ? "them" : "each of them"} EXACTLY as in their reference image: the same face, hair colour and hair`);
  // (a creature that came back as an animal, or as a person, is told what it IS)
  const beasts = missing.filter((k) => kinds[k] === "monster" || kinds[k] === "cartoon").map((k) => names[k]).filter(Boolean);
  if (beasts.length) out.push(`${beasts.join(" and ")} must have the reference image's own BODY — the same build, standing the same way, covered in the same fur or skin, in the same clothing in the same state: not an ordinary animal, and not a human being with that head`);
  return out.length ? ` ${out.join(". ")}.` : "";
}

/** A CREATURE STAYS THAT CREATURE. The line a scene's picture is given for each of its cast who is not a
 *  person: a werewolf whose scene said "crouches" came back an ordinary black wolf (three goes running), and
 *  one whose sleeve was gripped came back a man with a wolf's head, in a clean shirt and a wristwatch (live,
 *  2026-11-24). "" for a person. */
export function creatureNote(name: string, kind: string | null | undefined): string {
  const n = String(name || "").replace(/\s+/g, " ").trim();
  if (!n || (kind !== "monster" && kind !== "cartoon")) return "";
  const what = kind === "monster" ? "a creature" : "a cartoon character";
  return `${n} is ${what} — not a person and not an ordinary animal: whatever ${n} is doing here (standing, crouching, walking, seen from behind), ${n} has exactly the BODY of the reference image — the same build, upright or not as it is there, the same fur, skin and colours all over, and the same clothing in the same state. Never drawn as an everyday animal; never as a human being wearing that head, a mask or a costume.`;
}

/** What a piece records about the pictures it KEPT with somebody still not right (the best of three goes):
 *  which scene, who, and whether it was split into panels. [] when every picture passed its look. */
export function keptFaults(checks: ReadonlyArray<StoryKept | null | undefined>): Array<{ scene: number; missing: string[]; panels?: true }> {
  const out: Array<{ scene: number; missing: string[]; panels?: true }> = [];
  (checks || []).forEach((c, i) => {
    if (!c || !storyFaults(c)) return;
    out.push({ scene: i + 1, missing: (c.who || []).filter((_, k) => c.seen[k] === false).map((n) => String(n).slice(0, 40)).slice(0, 3), ...(c.panels ? { panels: true as const } : {}) });
  });
  return out.slice(0, 24);
}

/* ---- THE STORY'S OWN CAST ----
 * A story invents its characters, and until 2026-11-23 they had ONE sheet between them — everybody side by
 * side in one picture, handed to the picture model with "from it take ONLY Walter". In "The Patience of
 * Bread" (made as a customer that day) the old watchman was three different men: tall and clean-faced with
 * a lantern, then balding in a brown jacket, then grey-haired with a moustache. And nobody looked: the
 * look above checks the cast the MAKER picked, never a character the story made up.
 *
 * So a character the story invents is cast like one the maker picked. It gets ONE portrait of its own, drawn
 * once; that portrait is its reference in every scene it is in; and it is looked for in every picture that
 * is kept, with the same question (storyCastPrompt) — a scene where it came out as someone else is drawn
 * again. The portraits are also SHOWN: the storyboard opens on the story's cast, the way a film does.
 *
 * Between the storyboard's calls (draw them all → re-draw one → generate) the portraits travel as one
 * token the page hands back unread (castToken / readCastToken). */
export type StoryCastRef = { name: string; look: string; img: string };
/** No more of a story's own characters than this get a portrait (a told story has two or three). */
export const STORY_CAST_MAX = 4;
const OWN_RENDER = /^\/renders\/[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$/;

/** A cast-list entry as a character: "Walter, an elderly night watchman with…" → his name and his look.
 *  The name is what the entry STARTS with, up to the first comma, colon, dash or bracket — the same rule
 *  the scenes are matched by (narrated-core's entryName), so a portrait is always found for its entry. */
export function castEntry(entry: string): { name: string; look: string } {
  const e = String(entry || "").replace(/\s+/g, " ").trim();
  const head = e.split(/[,:—–(]/)[0] || "";
  const bracketed = e.charAt(head.length) === "(";
  const rest = e.slice(head.length).replace(/^[\s,:—–(]+/, "");
  return { name: head.trim().slice(0, 40).trim(), look: (bracketed ? rest.replace(/\)\s*\.?\s*$/, "") : rest).trim() };
}

/** Are two names the same character's? (As they are written, whatever the capitals.) */
export const sameCharacter = (a: string, b: string): boolean => !!a && a.trim().toLowerCase() === (b || "").trim().toLowerCase();

/** A portrait is always drawn TALL, whatever shape the story is: a standing figure fills a tall frame. */
export const PORTRAIT_ASPECT = "9:16";

/** What the picture model is asked for: THIS one character, whole, on a plain ground, in the story's style. */
export function portraitPrompt(entry: string, sceneHint: string, safe = ""): string {
  return `${safe}${sceneHint}. A character portrait of ${String(entry || "").replace(/\s+/g, " ").trim().slice(0, 320)} — this ONE character alone, the whole body from head to feet, standing, turned a little toward the viewer, the face clearly seen, on a plain neutral background. In the exact art style of the story. ${NOTHING_WRITTEN}`;
}

/* THREE PEOPLE FROM THREE PICTURES is more than the everyday picture model holds. Asked for "Tobias stands
 * at the workshop doorway watching Marta and Ines sand the hull" with their three portraits, it drew TWO
 * people — six times out of six in a direct test (2026-11-23), whether or not the prompt said how many
 * there were, and once it merged the two women into one. The stronger model, given the very same prompt
 * and portraits, drew all three, both times. It costs about four times as much a picture and takes twice
 * as long, so it draws ONLY a picture made from three reference pictures; everything else stays where it was. */
export const STORY_MODEL = "google/nano-banana";
export const STORY_CROWD_MODEL = "google/nano-banana-pro";
/** How many reference pictures make a "crowd". */
export const STORY_CROWD_REFS = 3;
export const sceneModel = (refs: number): string => (refs >= STORY_CROWD_REFS ? STORY_CROWD_MODEL : STORY_MODEL);

/** The token: the portraits — and the story's PLACES (below), which travel with them — each by its own
 *  address on OUR renders disk and nothing else (it comes back from a browser — an address anywhere else
 *  is not a picture of ours and is dropped). "" = none. */
export function castToken(refs: ReadonlyArray<StoryCastRef>, places: ReadonlyArray<StoryPlaceRef> = []): string {
  const pack = (list: ReadonlyArray<{ name?: string; look?: string; img?: string }>, most: number) => (list || [])
    .map((r) => ({ n: String(r?.name || "").trim().slice(0, 40), l: String(r?.look || "").trim().slice(0, 200), i: String(r?.img || "").replace(/^https?:\/\/[^/]+/, "").split("?")[0] }))
    .filter((r) => r.n && OWN_RENDER.test(r.i))
    .slice(0, most);
  const kept = pack(refs, STORY_CAST_MAX);
  const where = pack(places, STORY_PLACE_MAX);
  return kept.length || where.length ? JSON.stringify({ v: 2, c: kept, ...(where.length ? { p: where } : {}) }) : "";
}

/** Read it back. A storyboard opened before this carries the address of the one SHEET instead — handed
 *  back as `sheet`, and used the way it was. Anything else is nothing at all. */
export function readCastToken(token: string | null | undefined): { refs: StoryCastRef[]; sheet: string | null; places: StoryPlaceRef[] } {
  const t = String(token || "").trim();
  if (!t) return { refs: [], sheet: null, places: [] };
  if (!t.startsWith("{")) return { refs: [], sheet: /^(?:https?:\/\/[^\s"']+|\/renders\/[a-zA-Z0-9_.-]+)$/.test(t) ? t : null, places: [] };
  try {
    const j = JSON.parse(t) as { v?: unknown; c?: unknown; p?: unknown };
    if (j?.v !== 2 || !Array.isArray(j.c)) return { refs: [], sheet: null, places: [] };
    const unpack = (list: unknown, most: number): StoryCastRef[] => {
      const out: StoryCastRef[] = [];
      for (const r of (Array.isArray(list) ? list : []) as Array<{ n?: unknown; l?: unknown; i?: unknown }>) {
        const name = typeof r?.n === "string" ? r.n.trim().slice(0, 40) : "";
        const img = typeof r?.i === "string" ? r.i : "";
        if (name && OWN_RENDER.test(img) && !out.some((x) => sameCharacter(x.name, name))) out.push({ name, look: typeof r?.l === "string" ? r.l.slice(0, 200) : "", img });
      }
      return out.slice(0, most);
    };
    return { refs: unpack(j.c, STORY_CAST_MAX), sheet: null, places: unpack(j.p, STORY_PLACE_MAX) };
  } catch { return { refs: [], sheet: null, places: [] }; }
}

/** The cast a FINISHED story kept (its meta.castCards), checked the way the token is — so a story opened
 *  again to be edited, and a story that is continued, start with the same faces. */
export function castCardsOf(meta: unknown): StoryCastRef[] {
  let m: unknown = meta;
  if (typeof m === "string") { try { m = JSON.parse(m); } catch { return []; } }
  const cards = m && typeof m === "object" && !Array.isArray(m) ? (m as { castCards?: unknown }).castCards : null;
  return Array.isArray(cards) ? readCastToken(castToken(cards as StoryCastRef[])).refs : [];
}

/* ---- THE STORY'S PLACES ----
 * The people of a story hold still now; its world did not. In the first Horror Story made in one press
 * (2026-11-24) the night ferry was a rowing boat in scene 1, a ship with a great wheel in scene 3 and a
 * ferry with a wheelhouse in scene 6 — every picture drew "the ferry" from the word alone.
 *
 * Tried on two worlds before a line of this was written (the ferry, a lighthouse — the same scenes drawn
 * three ways and LOOKED at): saying the place in the same words every time still gave three different
 * buildings; ONE picture of the place, given as a reference, gave the same place in every scene. But not any
 * picture: handed an establishing view, the everyday picture model gives that same view back with a tiny
 * figure painted into it (3 of 6). What it cannot copy as a scene is a DESIGN SHEET — the place on a plain
 * background, three views, no scenery — and with one line saying how near the camera is, it drew a new
 * view of the right place every time (6 of 6; 4 of 4 with two people in it as well).
 *
 * So a place the story comes back to gets one design sheet, drawn once, and every scene whose words name
 * that place is drawn with it. The sheets travel in the cast's token (castToken) and are shown with the
 * cast: a story has its people and its places. */
export type StoryPlaceRef = { name: string; look: string; img: string };
/** No more places than this get a sheet (a short story comes back to one, sometimes two). */
export const STORY_PLACE_MAX = 2;
/** A design sheet is square: three views side by side and above one another. */
export const PLACE_SHEET_ASPECT = "1:1";

/** A places-list entry as a place: "the ferry: an old low black wooden ferry with…" → its name and its look. */
export function placeEntry(entry: string): { name: string; look: string } {
  const e = String(entry || "").replace(/\s+/g, " ").trim();
  const head = e.split(/[,:—–(]/)[0] || "";
  return { name: head.trim().slice(0, 40).trim(), look: e.slice(head.length).replace(/^[\s,:—–(]+/, "").replace(/\)\s*\.?\s*$/, "").trim().slice(0, 320) };
}

const placeWords = (s: string): string[] => String(s || "").toLowerCase().replace(/[’']s\b/g, "").replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
/** What a place is called by in a scene's words: its name without the article — "the old ferry" → "old ferry". */
export const placeKey = (name: string): string => placeWords(name).filter((w, k) => k > 0 || !/^(?:the|a|an|this|that|his|her|their|our|my)$/.test(w)).join(" ");

/** Do a scene's words set it at this place? They call it by its name ("the ferry", "the ferry's wheel"),
 *  or by the last word of a longer name ("the old ferry" is also "the ferry"). */
export function placeIn(visual: string, name: string): boolean {
  const key = placeKey(name);
  if (!key) return false;
  const text = ` ${placeWords(visual).join(" ")} `;
  if (text.includes(` ${key} `)) return true;
  const last = key.split(" ").pop() || "";
  return key.includes(" ") && last.length >= 4 && text.includes(` ${last} `);
}

/** THE WORDS SAY WHERE. The writer also states which of the story's places each scene is set at; a scene whose
 *  own words do not name it ("inside the wheelhouse doorway" — the ferry's; found on the first live story
 *  with places, 2026-11-24: that one scene was drawn with no sheet) gets the name put in front of them:
 *  "At the ferry: …". So a scene's words stay the ONE thing its picture is drawn from — and the maker can
 *  read where it is set, and change it. Words that already name one of the story's places are believed
 *  as they are, whatever the writer's mark says. */
export function placeNamed(visual: string | null | undefined, place: string | null | undefined, entries: ReadonlyArray<string | null | undefined>): string {
  const v = String(visual || "").trim();
  const want = placeKey(String(place || ""));
  if (!v || !want) return v;
  const places = (entries || []).map((e) => placeEntry(String(e || ""))).filter((p) => p.name);
  const hit = places.find((p) => placeKey(p.name) === want);
  if (!hit || places.some((p) => placeIn(v, p.name))) return v;
  return `At ${hit.name}: ${v}`;
}

/** Which of the story's places a scene is set at: the first in the list that its words name — or -1. */
export const scenePlace = (visual: string, places: ReadonlyArray<{ name: string }>): number => places.findIndex((p) => placeIn(visual || "", p.name));

/** The places worth a sheet: the ones at least TWO of the story's scenes are set at (a place seen once
 *  cannot drift) — the most used first, STORY_PLACE_MAX at most — each with the scenes that are set there
 *  (a scene is set at one place: the first of the list it names). */
export function recurringPlaces(visuals: ReadonlyArray<string | null | undefined>, entries: ReadonlyArray<string | null | undefined>, have: ReadonlyArray<string> = []): Array<{ name: string; look: string; scenes: number[] }> {
  const places = (entries || []).map((e) => placeEntry(String(e || ""))).filter((p, k, a) => p.name && p.look.length > 12 && a.findIndex((x) => placeKey(x.name) === placeKey(p.name)) === k);
  const at = (visuals || []).map((v) => scenePlace(String(v || ""), places));
  return places
    .map((p, k) => ({ ...p, scenes: at.map((x, i) => (x === k ? i : -1)).filter((i) => i >= 0), k }))
    // (`have`: places that ALREADY have a sheet — the last episode's. One scene there is enough: seen once in
    //  this episode, it can still drift from how it looked in the last)
    .filter((p) => p.scenes.length >= (have.some((n) => placeKey(n) === placeKey(p.name)) ? 1 : 2))
    .sort((a, b) => b.scenes.length - a.scenes.length || a.k - b.k)
    .slice(0, STORY_PLACE_MAX)
    .map(({ name, look, scenes }) => ({ name, look, scenes }));
}

/** THE PLACES A STORY INHERITED ARE KEPT WHETHER OR NOT ITS WRITER LISTS THEM (told, then checked). The second
 *  episode of a story set at a clock tower named "the clock tower" in five of its six scenes and listed no
 *  places at all (live, 2026-11-24) — so the tower's own sheet went unused and the tower, drawn from words,
 *  came out as a church with a spire. A place the story before it had, that this story's scenes name (or its
 *  writer listed under the same name), is listed under THAT name and THOSE words — first — so it is drawn
 *  from its own sheet. `earlier`: the earlier story's entries ("name: look"). Two at most. */
export function inheritPlaces(listed: ReadonlyArray<string | null | undefined>, earlier: ReadonlyArray<string | null | undefined>, visuals: ReadonlyArray<string | null | undefined>): string[] {
  const named = (e: string): string => placeKey(placeEntry(e).name);
  const mine = (listed || []).map((e) => String(e || "")).filter((e) => !!named(e));
  const old = (earlier || []).map((e) => String(e || "")).filter((e, k, a) => {
    const key = named(e);
    if (!key || a.findIndex((x) => named(String(x || "")) === key) !== k) return false;
    return mine.some((m) => named(m) === key) || (visuals || []).some((v) => placeIn(String(v || ""), placeEntry(e).name));
  });
  const rest = mine.filter((m) => !old.some((o) => named(o) === named(m)));
  return [...old, ...rest].slice(0, STORY_PLACE_MAX);
}

/** What the picture model is asked for: the place and nothing else, as a sheet an artist copies a design from. */
export function placeSheetPrompt(place: { name: string; look: string }, sceneHint: string, safe = ""): string {
  return `${safe}A DESIGN SHEET of one place, for artists to copy it from: ${place.name} — ${place.look}. The same place is shown in three views on a plain pale-grey studio background — two different views of the whole of it, and one close view of its most recognisable part — like a scale model photographed on a table: no scenery, no sky, no ground, no weather around it. Style: ${sceneHint}. No people, no animals, no figures anywhere. ${NOTHING_WRITTEN}`;
}

/** What a scene's picture is told about the place it is set at, given as reference image `n`. */
export function placeNote(n: number, place: { name: string; look: string }): string {
  return `Reference image ${n} is a design sheet of ${place.name} (${place.look.slice(0, 220)}) — the PLACE this picture is set in. It is the SAME one here: the same shapes, colours, materials and details. Show it from wherever this moment is seen (on it, inside it, beside it, far off): a NEW view of the same place. The sheet's plain background and its three views are NOT part of this picture: this is a scene that fills the whole frame — never a sheet, a panel or a framed picture on a background.`;
}
/** …and, when the scene has people in it, how near the camera is. (Without it a figure comes out small.) */
export const PLACE_FRAMING = "FRAMING: this is a picture of the CHARACTERS in that place, not a picture of the place. The camera is near them — each one fills at least a third of the picture's height, and their faces are clear — and only the part of the place around them is in view.";

/* A SCENE THAT CAME BACK AS A PANEL ON THE SHEET'S GROUND. In the well story (a Moral Story made on the live
 * site, 2026-11-24) five scenes drew their place right; the sixth — "Inside the burrow, Rusk lies curled…" —
 * came back as a small framed picture floating in a pale-grey frame: the LOOK of the design sheet, copied.
 * The black-bar check does not see it (the surround is not black), so it is measured: a picture whose four
 * edges are one flat colour, the same colour all the way round, with a picture inside whose sides are
 * straight. Measured on every picture saved that night before it was trusted. */
/** The side of the small square the picture is read at (RGB, 3 bytes a pixel). */
export const FRAMED_SIZE = 96;
/** What is measured: how far the flattest…least flat edge strays from one colour (`flat`), how far the four
 *  edges' colours are from each other (`same`), and which sides of the inside picture are straight. */
export function framedMeasure(rgb: Uint8Array, size = FRAMED_SIZE): { flat: number; same: number; left: boolean; right: boolean; top: boolean; bottom: boolean } | null {
  const S = size;
  if (!rgb || rgb.length < S * S * 3) return null;
  const at = (x: number, y: number): [number, number, number] => { const k = (y * S + x) * 3; return [rgb[k], rgb[k + 1], rgb[k + 2]]; };
  const t = Math.max(2, Math.round(S * 0.04));
  const strip = (x0: number, y0: number, x1: number, y1: number) => {
    const sum = [0, 0, 0]; let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = at(x, y); sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; n++; }
    const mean = sum.map((v) => v / Math.max(1, n));
    let dev = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = at(x, y); dev = Math.max(dev, Math.abs(p[0] - mean[0]), Math.abs(p[1] - mean[1]), Math.abs(p[2] - mean[2])); }
    return { mean, dev };
  };
  const strips = [strip(0, 0, S, t), strip(0, S - t, S, S), strip(0, 0, t, S), strip(S - t, 0, S, S)];
  const flat = Math.max(...strips.map((s) => s.dev));
  const ground = [0, 1, 2].map((c) => strips.reduce((a, s) => a + s.mean[c], 0) / 4);
  const same = Math.max(...strips.map((s) => Math.max(...[0, 1, 2].map((c) => Math.abs(s.mean[c] - ground[c])))));
  // where the colour first leaves the surround, along three lines each way: the same place on all three
  // (and not at the very edge) is a straight side
  const off = (p: [number, number, number]): boolean => Math.max(Math.abs(p[0] - ground[0]), Math.abs(p[1] - ground[1]), Math.abs(p[2] - ground[2])) > 40;
  const lines = [0.3, 0.5, 0.7].map((f) => Math.round(S * f));
  const first = (line: number, across: boolean, back: boolean): number => {
    for (let k = 0; k < S; k++) { const v = back ? S - 1 - k : k; if (off(across ? at(v, line) : at(line, v))) return k; }
    return -1;
  };
  const straight = (across: boolean, back: boolean): boolean => {
    const d = lines.map((l) => first(l, across, back));
    return d.every((v) => v > t) && Math.max(...d) - Math.min(...d) <= 2;
  };
  return { flat, same, left: straight(true, false), right: straight(true, true), top: straight(false, false), bottom: straight(false, true) };
}
/** Is this picture a smaller picture sitting on a plain ground — the design sheet's look, copied? */
export function framedIn(rgb: Uint8Array, size = FRAMED_SIZE): boolean {
  const m = framedMeasure(rgb, size);
  return !!m && m.flat <= 34 && m.same <= 18 && ((m.left && m.right) || (m.top && m.bottom));
}
/** What the picture model is told on the next go after one. */
export const FRAMED_FIX = " The last try came out as a small framed picture sitting on a plain background — that is the design sheet's look, not a scene. Draw ONE picture of this moment that fills the whole frame from edge to edge, with the place around the characters.";

/** The places a FINISHED story kept (its meta.places), checked the way the token is. */
export function placesOf(meta: unknown): StoryPlaceRef[] {
  let m: unknown = meta;
  if (typeof m === "string") { try { m = JSON.parse(m); } catch { return []; } }
  const places = m && typeof m === "object" && !Array.isArray(m) ? (m as { places?: unknown }).places : null;
  return Array.isArray(places) ? readCastToken(castToken([], places as StoryPlaceRef[])).places : [];
}

/** The carried sheets this story still has a place for (by name) — a storyboard whose place was renamed, or
 *  the next telling of another story, does not inherit a sheet that is not its own. */
export const placesStillIn = (refs: ReadonlyArray<StoryPlaceRef>, entries: ReadonlyArray<string | null | undefined>): StoryPlaceRef[] =>
  (refs || []).filter((r) => (entries || []).some((e) => placeKey(placeEntry(String(e || "")).name) === placeKey(r.name)));

/* ---- THE REEL: WHILE IT RENDERS, IT IS ALREADY A FILM ----
 * A story's pictures exist minutes before its film does: a storyboard's are sent with the job, and a story
 * made in one press keeps each as it is drawn. So the tile that says "Rendering · ~3 min left" need not be a
 * spinner on a green card — the story's own pictures pass behind it, four frames spread over the story,
 * and it carries the story's title as soon as the writer has given it one. (The owner, 2026-11-24: "genius
 * level artistic detail additions that make the app feel alive".) Read from the job's own payload; only
 * pictures on our own renders disk are ever shown. */
export const REEL_FRAMES = 4;
const payloadOf = (payload: unknown): Record<string, unknown> => {
  let p = payload;
  if (typeof p === "string") { try { p = JSON.parse(p); } catch { return {}; } }
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
};
/** The frames of a rendering story's reel: REEL_FRAMES of its pictures, first to last — or none when it
 *  has fewer than two pictures yet (one picture is not a reel). */
export function cookingReel(payload: unknown): string[] {
  const o = payloadOf(payload);
  const listOf = (v: unknown): unknown[] => {
    let l = v;
    if (typeof l === "string") { try { l = JSON.parse(l); } catch { l = []; } }
    return Array.isArray(l) ? l : [];
  };
  const sent = listOf(o.approvedSceneImgs);
  const list = sent.some(Boolean) ? sent : listOf(o.ckImages);
  const own = list.map((u) => ownRenderPath(typeof u === "string" ? u : "")).filter((u): u is string => !!u).filter((u, k, a) => a.indexOf(u) === k);
  if (own.length < 2) return [];
  return Array.from({ length: REEL_FRAMES }, (_, k) => own[Math.round((k * (own.length - 1)) / (REEL_FRAMES - 1))]);
}
/** The title of a film that is still rendering, once it has one (its approved or checkpointed script). */
export function cookingTitle(payload: unknown): string {
  const o = payloadOf(payload);
  for (const key of ["ckTreatment", "approvedTreatment"]) {
    const t = payloadOf(o[key]).title;
    if (typeof t === "string" && t.trim()) return t.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  }
  return "";
}

/* ---- KEEP IN MY CAST ----
 * A character a story invented can be kept: the portrait the story drew becomes one of the maker's own
 * characters (app/routes/api.character.tsx, intent "adopt" → the same "Register" as any other character),
 * and can then be cast in any film. Nothing is drawn again — it is the face they saw in every scene. */

/** One of OUR render pictures, as a bare path — or null. (The address comes back from a browser.) */
export function ownRenderPath(u: string | null | undefined): string | null {
  const p = String(u || "").trim().replace(/^https?:\/\/[^/]+/, "").split(/[?#]/)[0];
  return OWN_RENDER.test(p) ? p : null;
}

const MONSTERS = /\b(?:ghosts?|ghouls?|wraiths?|spirits?|phantoms?|spect(?:re|er)s?|apparitions?|demons?|devils?|monsters?|creatures?|beasts?|werewol(?:f|ves)|vampires?|zombies?|skeletons?|undead|banshees?|revenants?|goblins?|ogres?|trolls?|dragons?|kraken|scarecrows?|shadow figure)\b/i;
const CARTOONS = /\b(?:roosters?|hens?|chickens?|chicks?|ducks?|ducklings?|geese|goose|mice|mouse|rats?|cats?|kittens?|dogs?|pupp(?:y|ies)|terriers?|fox(?:es)?|wol(?:f|ves)|bears?|cubs?|rabbits?|bunn(?:y|ies)|hares?|owls?|birds?|sparrows?|crows?|ravens?|parrots?|pigs?|piglets?|cows?|cal(?:f|ves)|horses?|pon(?:y|ies)|donkeys?|goats?|sheep|lambs?|deer|fawns?|squirrels?|hedgehogs?|badgers?|otters?|beavers?|frogs?|toads?|turtles?|tortoises?|snails?|fish|whales?|dolphins?|seals?|penguins?|lions?|tigers?|elephants?|monkeys?|giraffes?|zebras?|kangaroos?|koalas?|pandas?|bees?|butterfl(?:y|ies)|ants?|spiders?|caterpillars?|ladybugs?|dinosaurs?|dinos?|robots?|tedd(?:y|ies)|dolls?|snowm[ae]n|unicorns?|fair(?:y|ies)|el(?:f|ves)|gnomes?|capybaras?|hamsters?|raccoons?|sloths?)\b/i;
const WOMEN = /\b(?:woman|girl|lady|she|her|hers|mother|mom|mum|grandmother|grandma|granny|daughter|sister|aunt|wife|queen|princess|witch|bride|widow|nun|postwoman|waitress|actress|duchess|businesswoman|policewoman|fisherwoman|female|hen|mare|ewe|vixen)\b/i;
// A human word made a creature by what is said OF it — "a pale drowned bride", "a headless rider", "a dead
// king" — and a body no living person has, wherever the description mentions it. (The first one-press Horror
// Story's ghost was written as "a pale drowned bride … skin tinged blue-grey": no monster word in it, and she
// was offered as a PERSON.) Kept narrow: "half-drowned", "dead-eyed" and "ghostly pale" are living people.
const UNDEAD = /(?<!half-)\b(?:drowned|dead(?![- ]eyed)|undead|ghostly(?! pale| white| quiet)|spectral|skeletal|rotting|decaying|decayed|headless|faceless|eyeless|possessed|demonic|monstrous|mummified|corpses?|cadavers?|mumm(?:y|ies))\b/i;
const UNNATURAL = /\b(?:empty (?:eye )?sockets|glowing (?:\w+ )?eyes|translucent|see-through|rotting (?:flesh|skin)|skin tinged (?:blue|grey|gray|green)|fangs|tentacles)\b/i;

/** WHAT a story's character most likely is, read off the words the writer described them with — only a
 *  first guess, which the maker can change before anything is charged (the price follows the kind):
 *    monster  the thing itself is a ghost, a beast, a creature… or a human word the description has made one
 *             ("a drowned bride", "a headless rider"), or a body no living person has ("skin tinged blue-grey")
 *    cartoon  the thing itself is an animal, a toy, a robot…  (kept in the ONE look the story gave it)
 *    person   anything else — a real-looking human, later given outfits
 *  "The thing itself" is the start of the description, before what they wear or carry: "a young
 *  postwoman with a dog at her heels" is a person. `gender` picks which voices are offered first. */
export function keepGuess(look: string): { kind: "person" | "cartoon" | "monster"; gender: "f" | "m" } {
  const said = String(look || "").replace(/\s+/g, " ").trim();
  const head = said.split(/\b(?:with|in|who|whose|wearing|carrying|holding|beside|and)\b|[,;(]/i)[0] || "";
  // (a robot "with glowing eyes" stays a cartoon: what the thing IS is asked first, its body last)
  const kind = MONSTERS.test(head) || UNDEAD.test(head) ? "monster" : CARTOONS.test(head) ? "cartoon" : UNNATURAL.test(said) ? "monster" : "person";
  return { kind, gender: WOMEN.test(head) || (!/\b(?:man|boy|he|his|father|grandfather|son|brother|uncle|king|prince|rooster|stallion)\b/i.test(head) && WOMEN.test(said)) ? "f" : "m" };
}

/** WHO A FINISHED FILM SAYS IS IN IT, for showing on the piece itself: the cast the maker picked (each by
 *  their own picture — meta.cast), then the characters the story invented (meta.castCards). Nobody twice,
 *  nobody without a picture, six at most. A picture is one of the site's own paths or an https address —
 *  it is only ever drawn as an image, for the member whose piece it is. */
export type StoryStar = { name: string; img: string; look?: string; /** a character the story made up (its picture is a full-length portrait) */ own?: boolean };
// (a stock presenter's picture is "/avatars/omar_0.jpg?v=3": the version on the end is part of its address —
//  without it here, a film cast with stock presenters showed nobody under "Starring")
const SHOWABLE = /^(?:\/[\w./-]+(?:\?[\w.=&-]*)?|https:\/\/[^\s"'<>]+)$/;
export function storyStars(meta: unknown): StoryStar[] {
  let m: unknown = meta;
  if (typeof m === "string") { try { m = JSON.parse(m); } catch { return []; } }
  if (!m || typeof m !== "object" || Array.isArray(m)) return [];
  const cast = (m as { cast?: unknown }).cast;
  const picked: StoryStar[] = [];
  for (const c of Array.isArray(cast) ? cast : []) {
    if (!c || typeof c !== "object") continue;
    const name = typeof (c as { name?: unknown }).name === "string" ? ((c as { name: string }).name).replace(/\s+/g, " ").trim().slice(0, 40) : "";
    const img = typeof (c as { faceUrl?: unknown }).faceUrl === "string" ? ((c as { faceUrl: string }).faceUrl).trim() : "";
    if (name && SHOWABLE.test(img) && !img.includes("..") && !picked.some((p) => sameCharacter(p.name, name))) picked.push({ name, img });
  }
  const own = castCardsOf(m).filter((c) => !picked.some((p) => sameCharacter(p.name, c.name)));
  return [...picked, ...own.map((c): StoryStar => ({ name: c.name, img: c.img, ...(c.look ? { look: c.look } : {}), own: true }))].slice(0, 6);
}

/** Of the portraits carried in, the ones THIS story still has a character for (its cast list names them).
 *  A re-written story, or one that continues another, does not show — or draw from — someone not in it. */
export function castStillIn(refs: ReadonlyArray<StoryCastRef>, castList: ReadonlyArray<string>): StoryCastRef[] {
  const names = castList.map((e) => castEntry(e).name).filter(Boolean);
  return refs.filter((r) => names.some((n) => sameCharacter(n, r.name)));
}
