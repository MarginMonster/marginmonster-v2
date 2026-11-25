/* LOOKING AT A CHARACTER'S FIRST PICTURE — a writer reads the maker's words before it is drawn, and a reader
 * looks at what came back. Pure and client-safe (the calls are made in character-preview.server.ts), so the
 * tests can read them.
 *
 * The owner, 2026-11-24, of a Creature preview that drew a grey alien for "Demonic woman human body with a mouth
 * too large to be human blue eyes blonde hair off putting unsettling hyper realistic": "it's kind of difficult
 * to make accurate generations from scratch in regards to accuracy how can we improve?" The words now lead the
 * prompt (character-prompts.ts); these two looks make sure of it. EACH ONE FAILS OPEN: a look that cannot be had
 * — no key, no credit, a slow answer, an answer that cannot be read — never costs the maker a preview.
 *   BEFORE  the WRITER: every attribute the words state, listed, and the picture said in plain visual terms
 *           ("a mouth too large to be human" said as what it LOOKS like). Typed fast, with no commas, a
 *           description is a run-on a picture model reads as one blur.
 *   AFTER   the READER: which of those attributes the picture shows, and what it ADDED that changes what the
 *           character is (Seedream gave the same woman pointed elf ears and vampire fangs for "demonic"). A miss
 *           → drawn ONCE more, told exactly what; the better of the two is kept. It is still one free look. */

import { firstJson } from "./first-json.ts";
import { CHAR_DESC_MAX, creatureBody, moodWords, type CharBrief, type CharKind } from "./character-prompts.ts";
import { STORY_LAST_MODEL, STORY_MODEL, STORY_SECOND_MODEL } from "./story-picture.ts";

/* ---- WHICH PICTURE MODEL ----
 * Measured on the owner's own cases, 2026-11-24 (scratchpad forge/1124): nano-banana REFUSED his description
 * outright, as a creature and as a person; Seedream 4.5 (4¢, like nano-banana) drew everything and was the more
 * literal on a cartoon cat, a fisherman and a werewolf — but told "Demonic woman" it drew a vampire with elf ears
 * four times in four, and given a picture it re-imagined it; nano-banana-pro (15¢) did what it was told every time.
 * Spelled out by the writer's brief, Seedream drew his woman right, as a creature and as a person. */

/** The models a FIRST look is drawn on, in order — everyday-priced (about 4¢) unless only the strongest (about
 *  15¢) can be trusted with the words:
 *    a picture added                  nano-banana, then Seedream: the picture is the truth, and Seedream
 *                                     re-imagined one (a grinning woman came back with corpse make-up and blood)
 *    a human with a mood, no brief    nano-banana-pro first: without the writer's brief, "demonic woman" was a
 *                                     vampire on Seedream and a refusal on nano-banana
 *    anything else                    Seedream, then nano-banana */
export function previewLadder(o: { kind: CharKind; desc: string; hasRef: boolean; brief: boolean }): string[] {
  if (o.hasRef) return [STORY_LAST_MODEL, STORY_SECOND_MODEL];
  const human = o.kind === "person" || (o.kind === "monster" && creatureBody(o.desc) === "uncanny");
  if (!o.brief && human && moodWords(o.desc).length) return [STORY_MODEL, STORY_SECOND_MODEL, STORY_LAST_MODEL];
  return [STORY_SECOND_MODEL, STORY_LAST_MODEL];
}

/** …and the ONE more go after a look that missed, and every EDIT: the strongest first. It does what it is told —
 *  "leave it out" included (Seedream, told to leave out the fangs, drew fangs and blood) — and an edit on it changed
 *  her hair to red and not one other thing. */
export const STRONG_LADDER: ReadonlyArray<string> = [STORY_MODEL, STORY_LAST_MODEL, STORY_SECOND_MODEL];

const clean = (s: unknown, max = 90): string => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
const tidy = (desc: string): string => clean(desc, CHAR_DESC_MAX);

const KIND_SAID: Record<CharKind, string> = {
  person: "a person — a real-looking human, photographed",
  cartoon: "a cartoon character",
  monster: "a creature, for horror — photographed like a horror film's",
};

/* ---- BEFORE: THE WRITER ---- */

/** The forced-tool schema the writer answers through (anthropic.server.ts → jsonSchema). */
export const CHARACTER_BRIEF_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    attributes: { type: "array", items: { type: "string" } },
    picture: { type: "string" },
  },
  required: ["attributes", "picture"],
  additionalProperties: false,
};

/** The writer's question: the maker's words → every attribute they state, and the picture in plain terms. */
export function characterBriefAsk(kind: CharKind, desc: string, hasRef: boolean): string {
  return [
    `A member of our app is creating a character. They chose: ${KIND_SAID[kind]}${hasRef ? " — and they added a picture of it, which the drawing follows" : ""}. In their own words:`,
    `«${tidy(desc)}»`,
    `A picture model will draw it, and it must draw EXACTLY what they wrote. Read their words closely — they are often typed fast, with no commas, in any language — and give, in English:`,
    `1. "attributes": EVERY separate thing their words state about the character, one short item each, in THEIR words where you can: what it is, its body, face, eyes, hair, skin, colours, clothes, anything strange or wrong about it, its mood, and the look they asked for. For example "Tall old man long grey beard eyes too far apart creepy realistic" → "an old man", "tall", "a long grey beard", "eyes set too far apart", "creepy", "realistic". Never an item they did not state.`,
    `2. "picture": ONE paragraph of 40 to 90 words saying what the picture model must draw, in plain visual terms. Every attribute is in it, each made concrete and VISIBLE — say what a strange feature LOOKS like (how far it stretches, what shows) — and it adds NOTHING else about what the character is. A word of mood (demonic, creepy, unsettling) is shown in the expression, the stare and the light — never as horns, pointed ears, fangs, claws, spines, scales, wings, extra limbs or any other part they did not name. If they describe a human being ("a woman", "human body"), it is a real, ordinary human being apart from exactly the wrongness they name. Leave out the background, the framing and the camera.`,
  ].join("\n");
}

// Parts that make a person a monster — a writer must not hand them to a human being the maker did not give them to.
const MONSTER_PART = /\b(?:horns?|antlers?|pointed ears?|elf(?:in)? ears?|fangs?|tusks?|claws?|talons?|spines?|spikes?|scales?|wings?|tentacles?|tails?|hooves|mandibles?|carapace|exoskeleton|extra (?:arms?|legs?|limbs?|eyes?)|skull(?:-like)? (?:face|head)|glowing eyes?)\b/gi;

/** The writer's answer, checked: 1–12 attributes and a picture of 20–700 characters. Null — the plain prompt is
 *  used — when it cannot be read, or when it gives a HUMAN character (a person, or a creature whose words make it
 *  a human being) a monster's part the maker's words never named: that is the wrongness growing, not the brief. */
export function readCharacterBrief(raw: string | null | undefined, kind: CharKind, desc: string): CharBrief | null {
  const j = firstJson(raw);
  if (!j) return null;
  const seen = new Set<string>();
  const attributes = (Array.isArray(j.attributes) ? j.attributes : [])
    .map((a) => clean(a))
    .filter((a) => a && !seen.has(a.toLowerCase()) && !!seen.add(a.toLowerCase()))
    .slice(0, 12);
  const picture = clean(j.picture, 700);
  if (!attributes.length || picture.length < 20) return null;
  const human = kind === "person" || (kind === "monster" && creatureBody(desc) === "uncanny");
  if (human) {
    const said = String(desc || "").toLowerCase();
    const named = (part: string) => said.includes(part.toLowerCase().replace(/s$/, ""));
    const grown = [...`${picture} ${attributes.join(" ")}`.matchAll(MONSTER_PART)].map((m) => m[0]).filter((p) => !named(p));
    if (grown.length) return null;
  }
  return { picture, attributes };
}

/* ---- AFTER: THE READER ---- */

/** The reader's question. The FIRST image is the picture. `attributes`: the writer's list, when there is one —
 *  otherwise the reader lists them itself, from the words. */
export function characterCheckAsk(kind: CharKind, desc: string, attributes: ReadonlyArray<string> = []): string {
  const list = attributes.map((a) => clean(a)).filter(Boolean).slice(0, 12);
  return [
    `The image is the first picture of a character that a member of our app described in their own words (they chose: ${KIND_SAID[kind]}):`,
    `«${tidy(desc)}»`,
    list.length
      ? `Their words state these things: ${list.map((a, i) => `(${i + 1}) ${a}`).join(" ")}. These, in this order, are "stated".`
      : `First list EVERY separate thing their words state about the character, one short item each, in their words where you can: what it is, its body, face, eyes, hair, skin, colours, clothes, anything strange or wrong about it, its mood, and the look they asked for. Those are "stated".`,
    `For EACH stated thing, look at the picture and say whether it is clearly shown — true or false. Be strict about what the character IS and about its body: "a woman" with "a human body" is false for a monster or an alien that only has a woman's hair; a wrongness they name ("a mouth too large to be human") must be plain to see, not hinted. A mood counts as shown when the face and the light carry it.`,
    `Then list what the picture ADDS that their words never asked for and that changes what the character is or how strange it is: horns, pointed ears, fangs, claws, spines, scales, wings, extra limbs, a skull for a head, grey, rotting or alien skin on a human, another kind of creature, a cartoon where they asked for a photograph. Never list what their words leave open — the pose, clothes when they name none, the background, the light.`,
    `Reply with ONLY this JSON: {"stated": ["…"], "shown": [true or false for each, in order], "added": ["…", or none]}`,
  ].join("\n");
}

/** What the reader saw: the stated things, which were shown, which were MISSED, and what was ADDED. */
export type CharCheck = { stated: string[]; shown: boolean[]; missing: string[]; added: string[] };

/** The reader's answer — null when it cannot be read (the picture is then kept as it is). */
export function readCharacterCheck(raw: string | null | undefined): CharCheck | null {
  const j = firstJson(raw);
  if (!j || !Array.isArray(j.stated) || !Array.isArray(j.shown)) return null;
  const stated = j.stated.map((s) => clean(s));
  const shown = j.shown.slice(0, stated.length);
  if (!stated.length || shown.length < stated.length || shown.some((s) => typeof s !== "boolean")) return null;
  const keep = stated.map((s, i) => ({ s, ok: shown[i] as boolean })).filter((x) => x.s).slice(0, 12);
  if (!keep.length) return null;
  const added = (Array.isArray(j.added) ? j.added : []).map((a) => clean(a)).filter((a) => a && !/^(?:none|nothing|n\/?a|-)$/i.test(a)).slice(0, 5);
  return { stated: keep.map((x) => x.s), shown: keep.map((x) => x.ok), missing: keep.filter((x) => !x.ok).map((x) => x.s).slice(0, 8), added };
}

/** How wrong a picture is: each stated thing it misses, each thing it adds. 0 = keep it. */
export const characterFaults = (c: CharCheck | null | undefined): number => (c ? c.missing.length + c.added.length : 0);

/** What the picture model is told on the one more go: what was missed, named; what was added, named. */
export function characterFix(c: CharCheck | null | undefined): string {
  if (!c) return "";
  const out: string[] = [];
  if (c.missing.length) out.push(`The last try missed what the maker asked for — this time each of these is plain to see: ${c.missing.join("; ")}`);
  if (c.added.length) out.push(`The last try added what the maker never asked for — leave it out: ${c.added.join("; ")}`);
  return out.length ? ` ${out.join(". ")}.` : "";
}

/** Which picture a maker is shown after the one more go: the new one, unless the reader found it WORSE than the
 *  first. (A new one the reader could not read is kept: it was drawn to put right what the first got wrong.) */
export const keepSecond = (first: CharCheck | null | undefined, second: CharCheck | null | undefined): boolean =>
  !second || characterFaults(second) <= characterFaults(first);

/* ---- AN EDIT, LOOKED AT (character-prompts.ts → characterEditPrompt) ----
 * The owner, 2026-11-24: "I tried to edit her hair to blonde and it changed her face." An edit is drawn FROM the
 * look the maker saw; this asks whether it is still that same individual, whether the change they asked for is
 * there, and what else changed that they never asked to change. */

/** The reader's question about an edit. The FIRST image is the edit, the SECOND the look it was made from. */
export function characterEditCheckAsk(kind: CharKind, before: string, after: string): string {
  const was = tidy(before);
  return [
    `The FIRST image is an edit of the SECOND. The second is a character a member of our app had already seen (they chose: ${KIND_SAID[kind]})${was ? `, drawn from their words «${was}»` : ""}. They changed the words to «${tidy(after)}», and the first image must change ONLY what the new words change.`,
    `1. "same": is the first image the SAME individual as the second — the same face and features, the same person or creature? A change the new words ask for (the hair colour, the clothes) does not make someone else; a different face does. true or false.`,
    `2. "missing": each change the new words ask for that the first image does NOT show — or none.`,
    `3. "unasked": each thing that changed between the two images that the new words did NOT ask to change — the face, the age, the body, the expression, the clothes, the pose, the background — or none. Ignore small differences of light, grain and sharpness.`,
    `Reply with ONLY this JSON: {"same": true or false, "missing": ["…"], "unasked": ["…"]}`,
  ].join("\n");
}

/** What the reader saw of an edit: still the same individual, the asked-for changes it misses, and what else changed. */
export type EditCheck = { same: boolean; missing: string[]; unasked: string[] };
const listOf = (v: unknown, most: number): string[] => (Array.isArray(v) ? v : []).map((a) => clean(a)).filter((a) => a && !/^(?:none|nothing|n\/?a|-)$/i.test(a)).slice(0, most);

/** The reader's answer about an edit — null when it cannot be read (the edit is then kept as it is). */
export function readCharacterEditCheck(raw: string | null | undefined): EditCheck | null {
  const j = firstJson(raw);
  if (!j || typeof j.same !== "boolean") return null;
  return { same: j.same, missing: listOf(j.missing, 5), unasked: listOf(j.unasked, 5) };
}

/** How wrong an edit is: someone else's face counts the most, then each change missed or not asked for. */
export const editFaults = (c: EditCheck | null | undefined): number => (c ? (c.same ? 0 : 3) + c.missing.length + c.unasked.length : 0);

/** What the picture model is told on the one more go of an edit. */
export function characterEditFix(c: EditCheck | null | undefined): string {
  if (!c) return "";
  const out: string[] = [];
  if (!c.same) out.push("The last try turned them into someone else — this time they are the EXACT same individual as in the reference image, with the very same face");
  if (c.unasked.length) out.push(`It also changed what the new words never asked to change — keep these exactly as in the reference: ${c.unasked.join("; ")}`);
  if (c.missing.length) out.push(`And it did not make the change that was asked for — this time make it plain: ${c.missing.join("; ")}`);
  return out.length ? ` ${out.join(". ")}.` : "";
}

/** …and which edit is shown: the second, unless the reader found it worse. */
export const keepSecondEdit = (first: EditCheck | null | undefined, second: EditCheck | null | undefined): boolean =>
  !second || editFaults(second) <= editFaults(first);
