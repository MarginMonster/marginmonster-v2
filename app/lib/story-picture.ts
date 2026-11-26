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
 * Clothes are NOT judged here: a story dresses its people for the part (the baker wears an apron). Whether anybody
 * is UNCLOTHED is (2026-11-25 — UNCLOTHED_ASKED, storyFirst; the sequence is clothed.server.ts → keepClothed).
 * And a NIGHT scene's sky is (2026-11-25 — storyNight, NIGHT_ASKED, NOT_NIGHT_FAULT: night is night, as in the acted films).
 */
import { firstJson } from "./first-json.ts";
// EVERY PICTURE FILLS ITS FRAME (2026-11-26, the bakery with an empty cream band under it): measured, not asked — full-frame.ts
import { bandCuttable, bandFault, bandFix, type FrameBand } from "./full-frame.ts";
// WHAT A CHARACTER ALWAYS HAS (2026-11-26, SPEC-S16): a tag at the end of the cast entry, peeled off before the look is read
import { peelMark, portraitHas, type CharacterMark } from "./character-mark.ts";

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
/** NOBODY ELSE (2026-11-24, a Horror Story made from a tester's idea): its first scene was "the house sits alone at
 *  dusk" — and the picture model put a man walking up to it; its last had the little brother on the sofa AND a
 *  second of him outside on the porch. */
export const NO_EXTRAS = "Nobody is in the picture whom these words do not put there — no passer-by, no figure in the distance, no one at a window or a door — and every character in it appears exactly ONCE.";
/** INSIDE STAYS INSIDE (2026-11-24, the owner of the same story: "the monster is outside trying to get in, but in
 *  one of the scenes the kid is outside with the monster, like the fuck?"). Its words were "from behind Mira's dark
 *  shoulder, INSIDE at the round porthole window, looking out at the ghost lady standing on the porch" — and the
 *  picture model stood Mira on the porch beside her. Said whenever a picture has a window, a door or an outside. */
/** (…and whoever LOOKS OUT is inside too: the re-made story's words were "At the front door: Leni, near the camera at
 *  the window's edge, peers out while far down the dark porch the ghost lady stands" — no "inside" — and Leni was
 *  drawn standing out on the porch with her, 2026-11-24) */
export const INSIDE_STAYS = "Whoever these words put INSIDE — and whoever looks OUT or peers out through a window or a door — stays inside: what is outside is seen THROUGH the glass of the window, the gap of the door or the thin wall of the tent — its frame and its glass between them — never standing beside them. And whoever these words put OUTSIDE — on the porch, at the glass from outside, at the door — stays OUTSIDE, on the far side of the glass from the room: never drawn behind the window among the room's curtains, never in the room.";
// (…and a TENT, a car: "inside the tent, Oksana's hand grips the zipper pull … far beyond the thin orange nylon wall"
//  was drawn with her OUTSIDE the tent zipping it from the grass, 2026-11-25 — none of these words was in the list)
const INSIDE_OUT = /\b(?:window|windows|door|doors|doorway|glass|porch|outside|through the|peers?|peering|peeks?|peeking|tent|nylon|canvas|zipper|flap|windshield|car)\b/i;
export const insideNote = (visual: string): string => (INSIDE_OUT.test(String(visual || "")) ? INSIDE_STAYS : "");
/** NOBODY LOOKS INTO THE CAMERA (2026-11-25, the tester's "three knocks" made as a told story: the boy grips his
 *  parents' doorframe and both parents, "turning toward him in alarm", sat up in bed looking straight at the lens
 *  — the owner, of a film the day before: "talking about something outside yet looking towards the camera"). */
export const NO_LENS = "Nobody looks into the camera: each one looks at whoever or whatever this moment has them looking at — each other, the door, the window — the way people in a film never notice the camera.";
/** A DOOR THE WORDS DO NOT OPEN IS SHUT (2026-11-25): the kids' story's last picture — the children on the sofa after
 *  they locked the front door — stood the front door wide open onto the lit porch; its "turning the lock" picture
 *  turned a bolt on a door standing open. */
export const DOORS_SHUT = "Every door in the picture is SHUT unless these words open it.";
/** A SHADOW IS A SHADOW (the owner, 2026-11-25: "why the train station guy appearing outside of the window"): the
 *  idea's "dark shadow standing under the old tree", written "a tall dark shadow stands motionless … its shape barely
 *  distinct from the branches", was drawn as a man in a hooded raincoat standing in the rain. Said to a picture
 *  whose words have a shadow STANDING somewhere — never for shadows that fall, fill or are cast. */
export const SHADOW_SHAPE = "A shadow in these words is drawn as a shadow: a tall human shape of flat, featureless black — no face, no clothes, no hood, no coat, no hat, its edges soft — the dark itself standing there; never a person.";
const SHADOW_FIGURE = /\b(?:a|the|that)\s+(?:[\p{L}-]+\s+){0,2}(?:shadows?\b(?![-\s]*(?:of|on|across|over|fills?|filling|falls?|falling|cast|pools?|pooling|play|dances?|stretch(?:es)?|from))|shadowy\s+(?:figure|shape|form|man|woman|person|thing)\b)/iu;
export const shadowNote = (visual: string): string => (SHADOW_FIGURE.test(String(visual || "")) ? SHADOW_SHAPE : "");
/** A SOUND IS NEVER DRAWN in a picture either (the same night's film drew its knocks as a glowing ring on a window). */
export const STORY_SOUND = "A sound is never drawn: nothing glows, rings or lights up where a knock, a bell or a voice comes from — and whoever makes it is not in the picture unless these words put them there.";
/** TODAY'S REAL WORLD, IN THE PICTURE TOO. The writer is told a home is an ordinary modern home (premise-rules.ts →
 *  REAL_WORLD) — but a place's words seldom say how OLD it is ("the front door: a narrow wooden door set in a dark
 *  porch wall"), and the horror picture model, left to guess, built the children's house of rough grey stone twice
 *  (the owner, 2026-11-24: "looks like the kids live in a cobblestone house from a fairytale"). Said to every
 *  picture, and every place's design sheet, of a story that is not a children's cartoon. */
/** A HOME IS LIVED IN (the owner, 2026-11-25, of the "three knocks" story: "why are the walls dingy and not just a
 *  regular household?"). The horror look every picture is given — 35mm, underexposed, a cold desaturated grade —
 *  pulled the rooms toward an abandoned house: stained grey walls, a bare peeling bedroom, a dusty window. The
 *  dark is the night's, not the house's. (Said inside TODAY_LOOK, so every picture and sheet that gets one gets both.) */
// (…and a place in use is KEPT: "The Dent in the Pillow", 2026-11-25 — room 14 of a working small-town hospital, unused for
//  a year, was drawn with peeling, cracked plaster, like a ruined asylum)
export const LIVED_IN = "A family's home is clean, cared for and lived in — fresh paint, a rug, framed photos, a lamp, everyday things left about (in a child's room: toys, posters, a nightlight) — never stained, peeling, damp, dusty, bare or abandoned unless these words say so: it is dark because it is night, not because the house is falling apart. A place people work in or use every day — a hospital, a school, an office, a hotel, a shop — is clean and kept the same way, even a room in it nobody has used for a while: never peeling, cracked, stained or abandoned unless these words say so.";
/** EVERYONE IS DRESSED (2026-11-25, "She Walked From Still Water": told only "a pale woman standing waist-deep in the lake",
 *  the picture model drew her bare — a bather — and the video engine kept what its first frame had). Said in every
 *  grown-up picture (TODAY_LOOK), every reveal (acted-staging.ts) and every children's picture. */
export const DRESSED = "Everyone in the picture is fully clothed in ordinary clothes — a figure standing in water too, its own clothes soaked and clinging (a nightgown, a dress, a coat).";
/** …AND SAID WHERE THE FIGURE IS SAID (2026-11-25, "Still Water Calls Twice"): DRESSED sat at the end of a long prompt and
 *  the woman "standing waist-deep in the lake" was still drawn bare — three films running, none of them sent. A picture
 *  model draws a person in water as a bather unless the words that put them there also dress them. So the sentence
 *  that puts a person in water gets their clothes right behind it — unless that sentence or the next already does. */
const IN_WATER = /\b(?:waist|chest|knee|neck|ankle|shoulder)[- ]deep\b|\b(?:in|into|from|out of|under) the (?:lake|water|river|sea|ocean|pond|pool|creek|stream|swamp|marsh|bath|bathtub|tub|shower|surf|waves|shallows)\b|\b(?:wading|wades|swimming|swims|floating|floats|bathing|submerged)\b/i;
const A_PERSON = /\b(woman|lady|girl|bride|mother|man|boy|figure|stranger|someone|somebody|person|child|kid|swimmer|she|he|women|men|girls|boys|kids|children|people|friends|they)\b/i;
/** …in a bath or a shower nobody wears a nightgown: only the head and shoulders are seen. */
const A_BATH = /\b(?:bath|bathtub|tub|shower)\b/i;
const CLOTHES = /\b(?:dress|gown|nightgown|nightdress|coat|raincoat|shirt|blouse|clothes|clothing|clothed|suit|uniform|jacket|sweater|hoodie|robe|jeans|trousers|skirt|shroud|cloak|wearing|wears|dressed|swimsuit|wetsuit|trunks)\b/i;
const SWIM = /\b(?:swimming|swims|swimmer|pool|beach|bathing)\b/i;
export function dressedInWater(text: string): string {
  const t = String(text || "");
  if (!IN_WATER.test(t)) return t;
  const sentences = t.split(/(?<=[.!?])\s+/);
  const at = sentences.findIndex((s) => IN_WATER.test(s));
  if (at < 0) return t;
  const near = `${sentences[at]} ${sentences[at + 1] || ""}`;
  const who = A_PERSON.exec(sentences[at]) || A_PERSON.exec(t);
  if (!who || CLOTHES.test(near)) return t;
  const w = who[1].toLowerCase();
  const garment = A_BATH.test(near) ? "Only the head and shoulders show above the water and the foam — nothing else of the body is seen."
    : SWIM.test(near) || /^(?:women|men|girls|boys|kids|children|people|friends|they)$/.test(w) ? "Everyone in the water wears a modest swimsuit."
    : /^(?:woman|lady|girl|bride|mother|she)$/.test(w) ? "She is fully clothed: a long pale nightgown, soaked and clinging, covering her from neck to knee."
    : /^(?:man|boy|he)$/.test(w) ? "He is fully clothed: a shirt and trousers, soaked and clinging."
    : "The one in the water is fully clothed: plain everyday clothes, soaked and clinging, from neck to knee.";
  sentences.splice(at + 1, 0, garment);
  return sentences.join(" ");
}
/** …AND THE PICTURE IS LOOKED AT: is anybody in it unclothed? (Asked of a film's master before it is kept —
 *  image-generation.server.ts → renderSideBySideTwoShot. A picture with an unclothed figure is never the one a film is
 *  shot from: it is drawn again with the clothes said FIRST, and if the model still will not, the figure is dressed by
 *  an edit of that picture.) */
export function unclothedPrompt(): string {
  return `Look at every person and every human-like figure in this picture, however small, far away or pale. Is ANY of them unclothed — a bare chest or bare torso, or a body with no clothing visible on it? Bare arms, bare legs, bare feet and a swimsuit all count as CLOTHED; a figure whose body is hidden by water, dark or distance and shows no bare torso counts as clothed. ${PART_ALONE} ${COATED} Reply with ONLY this JSON: {"unclothed": true or false, "who": "where that figure is, in a few words — an empty string when nobody is"}`;
}
/** …AN ANIMAL WEARS ITS OWN COAT (2026-11-25, when the look went from an acted film's master to every picture of the
 *  app's films — a children's story's portraits and scenes among them): a cartoon rabbit or a fox standing upright
 *  has "a body with no clothing visible on it", and told "unclothed", the redraw and the edit would put a nightgown
 *  on it — and the cast look would then find it was not the rabbit of its own portrait. Foreseen, not yet seen: said
 *  so that a reader never has to guess. A nearly-human thing with bare skin is still a figure, and is dressed. */
export const COATED = "An animal, or a creature covered in its own fur, feathers or scales — real or a cartoon — counts as CLOTHED.";
/** …A HAND ON ITS OWN IS NOT A BODY (2026-11-26, live): a horror story's ghost was a pale hand pressed to the inside
 *  of a claw machine's glass, and the look called it unclothed — "the pale hand and partial arm … show bare skin with
 *  no clothing" — a hard fault, drawn again twice. A hand or an arm with no body seen with it is clothed, as bare arms
 *  already were; nothing else about the question changes. */
export const PART_ALONE = "A hand or an arm seen on its own — reaching out of the dark, pressed to a glass, coming in from the picture's edge — with no body seen with it counts as CLOTHED too.";
export function parseUnclothed(raw: string): { unclothed: boolean; who: string } {
  try {
    const m = /\{[\s\S]*\}/.exec(String(raw || ""));
    const j = m ? JSON.parse(m[0]) : null;
    return { unclothed: j?.unclothed === true, who: typeof j?.who === "string" ? j.who.replace(/\s+/g, " ").trim().slice(0, 80) : "" };
  } catch { return { unclothed: false, who: "" }; }
}
/** Said FIRST when a picture is drawn again because somebody in it was not dressed. */
export const CLOTHED_FIRST = "EVERY person and every figure in this picture is fully clothed, the far and the pale ones too: anyone standing in water wears a long, soaked, pale nightgown or their own soaked everyday clothes, covering the body from neck to knee.";
/** …and the edit that dresses the one figure when the model will not draw it dressed.
 *  (…in what suits where that figure IS — review of stream S8, 2026-11-25: the edit was written for the woman in the lake,
 *  and the look now runs on every film picture: a casting headshot cropped at bare shoulders, somebody asleep in a house
 *  camera's bedroom, a story's portrait. Told "a long, soaked, pale nightgown" for every one of them, a dry man in a
 *  headshot would be cast in a wet nightgown — and every shot is drawn "wearing what they wear in that photo". So: the
 *  figure the look places in water keeps the lake's nightgown — a man in water a shirt and trousers, as dressedInWater
 *  says — and anybody dry wears ordinary clothes that suit the place. Where the look did not say where the figure is,
 *  the lake's edit, as it always was.) */
const WET_WHO = /\b(?:water|lake|river|sea|ocean|pond|pool|creek|stream|swamp|marsh|surf|waves|shallows|wading|wades|swimming|floating|submerged|soaked|wet)\b|\b(?:waist|chest|knee|neck|ankle|shoulder)[- ]deep\b/i;
const A_MAN = /\b(?:man|men|boy|boys|he|him|his|guy|father|dad|husband)\b/i;
export const clothedEdit = (who: string): string => {
  const w = String(who || "").trim();
  // (…a dry thing of a horror film — the pale crawler in the hallway — in a ragged old garment, never a sweater)
  const wear = w && !WET_WHO.test(w) ? "clothes that suit who they are and where they are — an ordinary person ordinary everyday clothes (in bed, pajamas); a ghost, a corpse or a creature a ragged, dark, shapeless old garment — covering the body from the neck down"
    : w && A_MAN.test(w) ? "a shirt and trousers, soaked and clinging"
    : "a long, soaked, pale nightgown that covers the body from neck to knee";
  return `Edit this photo and change ONE thing: the figure ${w ? `(${w}) ` : ""}who has no clothes on now wears ${wear}. Everything else stays exactly as it is — the same place, light, framing, people, faces, hair and what the others wear. No text anywhere.`;
};
/** NIGHT IS NIGHT — LOOKED AT (2026-11-25, "Who Smiles In Still Water": the idea said 3am, the master was told "the sky
 *  outside is black … never dusk, twilight or a blue evening glow", and the lake outside the tent was drawn under a pale
 *  blue evening sky again — the fourth film that day). Asked of a film's master when its place or moment says night:
 *  a sky that reads as dusk or day means one redraw with the night said FIRST. */
export const NIGHT_SAID = /\b(?:night|nighttime|midnight|[1-4]\s?am|three in the morning|after dark|pitch[- ]dark|pitch black|moonlight|moonlit)\b/i;
export function nightLookPrompt(): string {
  return 'This picture is meant to be set in the MIDDLE OF THE NIGHT. Look at the sky and at whatever is outdoors or seen through a window, a door or a tent opening. Is it night there — a black or near-black sky, the outdoors dark except for lamps, torches or the moon? Or does it read as dusk, twilight, blue hour, an overcast evening or day — a sky that is blue, grey or lit? If no sky and nothing outdoors can be seen at all, answer "night". Reply with ONLY this JSON: {"sky": "night" or "dusk" or "day"}';
}
export function parseNightLook(raw: string): boolean {
  try {
    const m = /\{[\s\S]*\}/.exec(String(raw || ""));
    const sky = m ? String(JSON.parse(m[0])?.sky || "").toLowerCase() : "";
    return sky !== "dusk" && sky !== "day";   // only a clear "dusk" or "day" is a fault (an unreadable answer never costs a film)
  } catch { return true; }
}
/** Said FIRST when a night picture came back as dusk or day. */
export const NIGHT_FIRST = "NIGHT, about three in the morning: the sky is BLACK, with no blue in it and no glow on the horizon; water and land outdoors are black shapes; the only light is what is really there — a lantern, a torch, a phone — and it falls off fast into darkness.";

/* ---- NIGHT IS NIGHT IN A TOLD STORY TOO ----
 * 2026-11-25, "Mystery Story — Eleven Went Aboard", the first long told story (13 scenes, two minutes): its idea said "A
 * night ferry crosses a foggy harbour…" and every one of its pictures was pale misty daylight. The acted film's master had
 * had its night look since that morning (above); a told story's pictures had none — and the owner's lake films had failed
 * the same way before the acted fix ("the tent shots still dusk-blue"). So a told scene that is at night says so in its
 * picture's words (acted-staging.ts → NIGHT_LINE, narrated-story.server.ts), its picture is LOOKED at for it in the
 * question that already looks at the place (NIGHT_ASKED in storyGrimePrompt — no extra call), and a picture whose sky
 * reads as dusk or day is drawn again with NIGHT_FIRST said first (storyFirst). The best of its goes is kept, as always. */

/** The acted engine's rule for a place whose own words name no time of day (acted-staging.ts → nightSetting), handed in:
 *  acted-staging imports this file, so this file never imports it back. */
export type NightRule = (setting: string, idea: string | null | undefined, shot?: string | null) => string;
/** A NIGHT THAT IS NOT THIS SCENE'S. "The next morning, Vale stands where the eleventh passenger stood last night" is a
 *  morning; and a job named for the night is a person, not the hour — "Walter, an elderly night watchman" (The Patience of
 *  Bread, 2026-11-23) also works at first light. Foreseen, not yet seen: said so a scene's time is never guessed from
 *  them. (A night ferry, a night bus, a night shift ARE the night: they stay.) */
const OTHER_NIGHT = /\b(?:last|previous|other|tomorrow)\s+night\b|\b(?:the\s+)?night\s+before\b|\bnight[- ](?:watchm[ae]n|guards?|porters?|nurses?)\b/gi;
/** …AND THE SMALL HOURS WRITTEN ANOTHER WAY ARE THE NIGHT (review of S11, 2026-11-25): NIGHT_SAID knows "3am" and "three
 *  in the morning", but a writer also writes "3 a.m.", "2:30am" and "two in the morning" — and the "morning" in that
 *  one is a day word to the rule, so "Vale climbs the stairs at 2 in the morning" in the night ferry came out DAY. Read
 *  as the night they are, before anything else is asked. */
const SMALL_HOURS = /\b(?:[1-4](?::[0-5]\d)?\s?a\.?m\b\.?|(?:[1-4]|one|two|three|four)(?::[0-5]\d)?(?:\s*o'?clock)?\s+in\s+the\s+morning\b)/gi;
const otherNight = (s: string | null | undefined): string => String(s || "").replace(OTHER_NIGHT, " ").replace(SMALL_HOURS, " at night ");
const NIGHT_EVERY = new RegExp(NIGHT_SAID.source, "gi");
/** IS THIS TOLD SCENE AT NIGHT? Its picture's own words decide first, then its narration: either one that says night
 *  (NIGHT_SAID) — and names no time of day as well ("at dawn, the night watchman…", "as dusk turns to night" are left to
 *  their words) — makes it night; either one that names another time of day makes it not. When neither names a time at
 *  all, the place it is set at, or the story's IDEA, says it — the acted engine's own rule, word for word (`rule`):
 *  "A night ferry crosses a foggy harbour" makes "the ferry slides out from the pier into thick fog" night, and "the
 *  ferry noses into the far pier at dawn" stays dawn.
 *  NEVER IN A CHILDREN'S STORY'S DAYTIME, NEVER IN A CARTOON UNLESS THE STORY SAYS NIGHT: a children's story and a cartoon
 *  are at night only where the scene itself or its place says so — the idea alone never darkens a picture they would draw
 *  by day ("bright and friendly"). A world of its own (Fantasy) is told the night like any grown-up story. */
export function storyNight(o: { words: string; said?: string | null; place?: string | null; idea?: string | null; childSafe?: boolean; cartoon?: boolean }, rule: NightRule): boolean {
  const pic = otherNight(o.words);
  const said = otherNight(o.said);
  // (do these words name a time of day besides the night? Asked of the rule itself, never a second list: told the idea is
  //  night, it leaves alone only words that already name a time — and the night's own words are taken out first)
  const dayIn = (w: string): boolean => { const left = w.replace(NIGHT_EVERY, " "); return rule(left, "night") === left; };
  for (const own of [pic, said]) {
    if (NIGHT_SAID.test(own)) return !dayIn(own);
    if (dayIn(own)) return false;
  }
  const by = (wider: string | null | undefined): boolean => rule(pic, otherNight(wider), said) !== pic;
  return by(o.place) || (!o.childSafe && !o.cartoon && by(o.idea));
}
/** …AND THE STYLE'S OWN DAYLIGHT IS NOT ITS LIGHT (review of S11, 2026-11-25). A told picture's words end with its genre's
 *  style, and most styles offer a day light beside a night one: the Mystery's — "Eleven Went Aboard" was a Mystery Story —
 *  is "pools of lamplight in a dim room, or flat grey daylight through rain"; the Romance's "soft window light or golden
 *  hour"; the Comedy's "bright even daylight or warm household lamps" (film-genres.ts). Told the night and then offered
 *  flat grey daylight, the model is free to draw what the ferry was drawn as. Said right behind NIGHT_LINE, before the
 *  style it is about. */
export const NIGHT_STYLE_LIGHT = "Of the light the style below names, this picture takes only a night's — lamps, street lights, firelight, a torch, the moon — never daylight, sun, golden hour or grey daylight through fog or rain.";
/** …ASKED IN THE QUESTION THAT LOOKS AT THE PLACE (storyGrimePrompt), last — the master's own question (nightLookPrompt)
 *  in its words, with the ferry's daylight named ("pale misty daylight": fog lit by day is not fog lit by a lamp) and a
 *  drawn night allowed its deep night-blue (a cartoon's night is told as one only where its own words say night). The
 *  reader says what it sees outside before it answers.
 *  (Review of S11, 2026-11-25, read as the reader will read it: the day side said "a sky that is … grey or lit", and the
 *  ferry's own right answer — thick fog at night, glowing round the deck lamps under a dark grey murk — is a grey, lit sky.
 *  Told both, a reader may call the very picture we want "dusk", and every night scene in fog is drawn three times and
 *  kept flagged. So fog that glows round the lamps and fades to dark is named as night, and the day side's grey is a
 *  LIGHT grey, its fog pale with daylight all the way across.) */
export const NIGHT_ASKED = 'Last, this picture is meant to be set in the MIDDLE OF THE NIGHT. Look at the sky and at whatever is outdoors or seen through a window, a door or a tent opening, and say in a few words how it is lit ("outdoors"). "sky" is "night" if it is night there: a black or near-black sky (in a drawn picture, a deep night-blue one with the moon or stars), the outdoors dark except for lamps, torches or the moon, and fog, if there is any, dark except where a lamp lights it — fog that glows round the lamps and fades to dark away from them is night. "sky" is "dusk" or "day" if it reads as dusk, twilight, blue hour, an overcast evening, pale misty daylight or day: a sky that is pale, blue or light grey, fog pale with daylight all the way across, or daylight falling in through a window or a door. If no sky and nothing outdoors can be seen at all, "sky" is "night".';
/** …its answer: true = night, false = the sky reads as dusk or day (the fault), null = the answer does not say — and then
 *  it is night (as parseNightLook: an answer that cannot be read never costs a story its picture). */
export function parseStoryNight(raw: string): boolean | null {
  const sky = jsonIn(raw)?.sky;
  if (typeof sky !== "string") return null;
  const s = sky.trim().toLowerCase();
  return s !== "dusk" && s !== "day";
}
export const TODAY_LOOK = "Where these words do not say how old a place is, it looks the way such a place looks TODAY — a home is an ordinary modern house (outside, painted siding or plaster; inside, plain painted walls), with ordinary rectangular windows and an ordinary front door — never older, rougher or more storybook than the words say: no rough stone walls, no cottage and no castle unless they name one. " + LIVED_IN + " " + DRESSED;

/** What the look reads off a story picture: for each cast member, in the order of their reference
 *  pictures, whether that same character is in it; and whether the picture is split into panels. */
export type StoryCheck = { seen: boolean[]; panels: boolean; /** each character drawn more than once (absent: not asked) */ twice?: boolean[]; /** somebody the words do not put there */ extra?: boolean; /** whoever looks OUT, drawn out there with what they look at */ outside?: boolean; /** who stares into the lens (absent: nobody, or not asked) */ lens?: string[]; /** the place drawn run-down when its words do not say so */ grimy?: boolean; /** a smaller picture pasted into it */ inset?: boolean; /** somebody in it UNCLOTHED (absent: nobody, or not asked) — and where that one is, in a few words */ unclothed?: boolean; unclothedWho?: string; /** a NIGHT scene whose sky reads as dusk or day (absent: night, not a night scene, or not asked) */ notNight?: boolean; /** an empty band or a doubled strip at its edges, MEASURED (full-frame.ts — absent: none) */ band?: FrameBand };
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
  return `${who} For EACH character, first write down in a few words what identifies them in their OWN image — for a person: hair colour, hair length and style, skin tone, apparent age, beard or none; for a creature or cartoon: what kind of creature, HOW IT IS BUILT (standing upright on two legs like a person, or going on four legs like an animal; a body covered in fur, scales or bare skin), its colours, the shape of its ears, its markings, and what it wears — and then the one in the first image who is closest to that, in the same few words (or "nobody"). Then COMPARE the two descriptions you wrote and say whether that character IS in the first image. It is the same individual only if the hair colour, the skin tone and the apparent age all agree (for a creature or cartoon: the kind of creature, how it is built, its colours, its ears and its markings). Seen from behind, small in the frame or in different clothes still counts — for a PERSON clothes do NOT matter, a story dresses people for the part. A creature or cartoon is another matter: an ordinary animal on four legs is NOT an upright creature, and a human being with that creature's head — a person's body in ordinary clothes — is NOT that creature either. If your two descriptions differ in hair colour (silver against brown, red against black), in skin tone or clearly in age — or, for a creature, in what kind of creature it is, in how it is built, in its colour, its ears or its markings — the answer is false. Last, for EACH character, look across the WHOLE first image for a second copy of them — the same person drawn again somewhere else in the same picture (on the sofa and again outside the window), not a reflection in a mirror or glass. Reply with ONLY this JSON: {"own": ["…" for each character], "inPicture": ["…" for each], "seen": [true or false for each, in order], "twice": [true if that character is drawn more than once, else false — for each, in order]}.`;
}

/** ANYBODY THE WORDS DO NOT PUT THERE — asked of every picture, with its own words (2026-11-24: a told horror
 *  story's last picture was "the ghost woman's face at the window … inside the dark room only the television
 *  flickers", and the picture model sat a grown man at a screen in that room; the owner, of an earlier one: "the
 *  kid is outside with the monster, like the fuck?"). NO_EXTRAS asks the picture model; this LOOKS.
 *  …and, in the same answer, WHOEVER LOOKS OUT, DRAWN OUT THERE: the story made again with INSIDE_STAYS in every
 *  prompt still stood Leni out on the porch with the ghost lady she was peering out at (2026-11-24) — asking had
 *  not been enough there either.
 *
 *  HOW IT IS ASKED, tried on the live reader with seven real stills (two drawn out on the porch, five rightly
 *  inside), 2026-11-24: asked "is the glass between them?", the reader answered from the WORDS ("she peers out
 *  through the glass pane", of a girl standing on the porch boards); asked "indoors or outdoors?", it called a girl
 *  leaning in an open window "outdoors" and mixed up which figure was the girl. Told who is who by their looks,
 *  asked about THE LOOKER ONLY, and given "outdoors" as STANDING on the porch boards, the yard or the street:
 *  twelve of twelve inside pictures passed, and the clear porch picture was caught three times of four (a scene
 *  has three goes). `who`: "Name: look" for each of the people in the scene. */
export function storyExtrasPrompt(visual: string, who: ReadonlyArray<string> = []): string {
  const words = String(visual || "").replace(/\s+/g, " ").replace(/"/g, "'").trim().replace(/[.\s]+$/, "").slice(0, 600);
  const names = (who || []).map((w) => String(w || "").replace(/\s+/g, " ").replace(/"/g, "'").trim().slice(0, 160)).filter(Boolean).slice(0, 4);
  return `The image is a picture from an illustrated story. It was asked to show exactly this: "${words}".${names.length ? ` Who is who: ${names.join("; ")}.` : ""} First list every person or creature you can see in it (not a reflection, not a picture on a wall, not a statue), each in a few words with where it is. Then say whether ANY of them is somebody those words do not put there — a stranger, a passer-by, somebody sitting, standing or watching who is not described. Next, only if those words have somebody INSIDE looking OUT — peering out, looking or watching through a window, a glass pane or a door — at somebody or something out there (on a porch, in a yard, in the street, in the dark): that person is the LOOKER (otherwise there is none). Find the looker in the picture by how they look, and say where THEY are — the looker, not what they look at — judged only by what you SEE, not by what the words wanted. "outdoors": you can see the looker STANDING out on the porch boards, its steps, a yard or a street — the same open floor or ground as what they look at, nothing but open air between. "indoors": anything else — in a room or a hallway, behind a window's glass, or seen in a window's frame behind its sill (glass or no glass). Last: does any PERSON in it — not a creature, a ghost or a shadow — look straight into the camera, eyes on the lens as if posing for a photograph? Somebody looking at something to one side of the camera, or seen from the side or from behind, does not. ${EYES_FIRST} ${UNCLOTHED_ASKED} Reply with ONLY this JSON: {"people": ["…" for each], "uninvited": true or false, "looker": "the looker's name, or an empty string", "lookerIs": "what the looker stands on and what is around the looker, in a few words", "lookerStands": "indoors" or "outdoors" or "", "eyes": ["whose face, and where its eyes point, in a few words — for each face you can see"], "intoLens": ["the name of each person looking straight into the camera — an empty list when nobody does"], "unclothed": true or false, "unclothedWho": "where that one is, in a few words — an empty string when nobody is"}.`;
}
/** …AND WHERE THE EYES POINT IS WRITTEN DOWN BEFORE THE STARE IS ANSWERED (2026-11-26, the live log's rejected pictures,
 *  LOOKED at: Delphine walking at us with her eyes well off to one side, and Delphine "frozen mid-breath, her eyes locked on
 *  something just past the camera's edge" — both answered "stared into the lens"). The reader writes down what it sees
 *  before it answers, as the cast question has since 2026-11-22. Not re-asked here (no reader credit on this desk): its
 *  rate is read on the live log — "[narrated] scene N try K: … stared into the lens". */
export const EYES_FIRST = "Before you answer, write down for each face you can see where its eyes point (\"eyes\"): only eyes that meet the lens itself count — eyes on something just beside the camera or past its edge, or a face turned even a little away, do not.";
/** …AND, IN THE SAME ANSWER, ANYBODY UNCLOTHED (2026-11-25: three acted lake films in a row drew the woman "standing
 *  waist-deep in the lake" bare; a told story is drawn by the same picture models from the same kind of words, and was
 *  never looked at for it). Asked in the question that already lists every person in the picture — one question
 *  more, never a fifth call — in the master's own words (unclothedPrompt), after the people are written down. */
export const UNCLOTHED_ASKED = `And: is ANY person or human-like figure in it — however small, far away or pale — unclothed: a bare chest or bare torso, or a body with no clothing visible on it? Bare arms, bare legs, bare feet and a swimsuit all count as CLOTHED; a figure whose body is hidden by water, dark or distance and shows no bare torso counts as clothed. ${PART_ALONE} ${COATED}`;
/** …its answer: whether anybody is unclothed, and where — null when the answer does not say (an older reading, or one
 *  that cannot be read: then nobody is taken to be). */
export function parseStoryUnclothed(raw: string): { unclothed: boolean; who: string } | null {
  const j = jsonIn(raw);
  const bare = j ? j.unclothed : undefined;
  if (!j || typeof bare !== "boolean") return null;
  const where = j.unclothedWho;
  return { unclothed: bare, who: typeof where === "string" ? where.replace(/\s+/g, " ").trim().slice(0, 80) : "" };
}
/** A RUN-DOWN PLACE THE WORDS DO NOT CALL ONE — asked on its own (2026-11-25: LIVED_IN in every grown-up story
 *  picture, and the kids' hallway still came back with peeling, stained wallpaper — the owner: "why are the walls
 *  dingy and not just a regular household?"). Asked on the live reader with nine real stills, twice each: both
 *  clearly grimy rooms caught every time, all six clean ones passed every time (a bedroom that is only dark
 *  passed too). A size question asked beside it ("a face as large as a window") caught nothing — not asked. */
/** …and, in the same answer, A PICTURE PASTED INTO THE PICTURE (2026-11-25: "What the Lake Learned", a DETAIL of a hand
 *  on a flashlight, came back as the wide shore with the hand in a small framed box in its top-left corner — the
 *  panel look-out only runs where the words describe two moments). Asked on the live reader with five real stills,
 *  three times each: the inset caught every time, none seen in the four without one, the grime answers unchanged. */
// (…and, for a NIGHT scene only, its sky — NIGHT_ASKED, 2026-11-25: a day scene's question is word for word as it was tuned)
export function storyGrimePrompt(visual: string, night = false): string {
  const words = String(visual || "").replace(/\s+/g, " ").replace(/"/g, "'").trim().replace(/[.\s]+$/, "").slice(0, 600);
  return `The image is a picture from an illustrated story. It was asked to show exactly this: "${words}". First look at the PLACE and describe in a few words its walls, floor and windows and the state they are in. "grimy" is true only if the place looks dirty, stained, damp, peeling, cracked, crumbling, dusty or abandoned — and those words do not say it is old, abandoned or ruined; an ordinary clean home that is simply dark at night is NOT grimy. Then look at the WHOLE frame, corner to corner: "inset" is true only if a SMALLER separate picture sits inside this one — a framed box, a picture-in-picture, a second view or a close-up pasted into a corner or along an edge. A window, a mirror, a screen or a doorway that belongs to the scene is NOT an inset.${night ? ` ${NIGHT_ASKED}` : ""} Reply with ONLY this JSON: {"place": "…", "grimy": true or false, "corners": "what is in each corner, in a few words", "inset": true or false${night ? ', "outdoors": "how the sky and the outdoors are lit, in a few words", "sky": "night" or "dusk" or "day"' : ""}}.`;
}
/** …its answer — null when it cannot be read. */
export function parseStoryGrime(raw: string): boolean | null {
  const g = jsonIn(raw)?.grimy;
  return typeof g === "boolean" ? g : null;
}

/* A WORN PLACE THE STORY ASKS FOR IS NOT A FAULT (2026-11-26). Read off the live log of a day of told stories (eleven of
 * them, 59 scenes): 29 pictures were drawn again for "the place came out run-down" — and the story had asked for worn in
 * most of them. "Circling in the Dark" is a night guard's rounds at an OLD roller rink ("The old roller rink had been
 * closed for hours…", "…gliding an inch above the scarred old floor"): six of its pictures were drawn again for it, the
 * one kept the same rink. "Eleven Went Aboard" was redrawn three times for "the worn concrete pier" its own words put
 * there; "Two Sets of Footprints" for the "boot-prints dark in dust" of its; "The Hour It Arrives" for "the dusty velvet
 * rope". The look is told the place may be old only when the VISUAL it is shown says so — the narration, the place's own
 * words and the rest of the story were never shown to it. So the run-down look COUNTS only where no words of the story
 * ask for a worn place; and it goes on doing the job it was made for — the ordinary home (LIVED_IN: "why are the walls
 * dingy and not just a regular household?") and the working hospital room ("The Dent in the Pillow"), whose words never
 * call them old. Of that day's 29, the story's own words answer 19; the ten still counted are the two hospital stories'
 * seven, the lake's two and a lighthouse's lantern room. */
/** A place, or a part of one, that words can call worn. */
const WORN_PLACE = "(?:rinks?|floors?|floorboards|boards|planks?|walls?|wallpaper|paint|plaster|ceilings?|beams|rafters|roofs?|stairs|staircases?|stairwells?|steps|doors?|doorways?|windows?|shutters|carpets?|curtains|furniture|rooms?|halls?|hallways?|corridors?|lobby|lobbies|kitchens?|bedrooms?|bathrooms?|attics?|cellars?|basements?|houses?|homes?|cottages?|cabins?|farmhouses?|barns?|sheds?|mills?|factory|factories|warehouses?|garages?|workshops?|bakery|shops?|stores?|diners?|bars?|pubs?|inns?|hotels?|motels?|hospitals?|asylums?|sanatoriums?|wards?|schools?|classrooms?|churche?s?|chapels?|theat(?:re|er)s?|cinemas?|arcades?|malls?|stations?|platforms?|depots?|piers?|docks?|jett(?:y|ies)|wharf|wharves|harbou?rs?|boats?|ships?|ferr(?:y|ies)|decks?|lighthouses?|towers?|manors?|mansions?|castles?|forts?|ruins|mines?|tunnels?|bridges?|museums?|librar(?:y|ies)|offices?|apartments?|flats?|buildings?|places?|streets?|alley(?:way)?s?|trailers?|caravans?|carriages?|trains?|buses|bus|vans?|elevators?|lifts?|porch(?:es)?|fences?|gates?|greenhouses?|playgrounds?|fairgrounds?|carnivals?|motor ?homes?|counters?|pews|benches|railings?|rails?)";
/** Words that make a place worn on their own, whatever they are said of: a place in ruin, or left to rot.
 *  (Review of S14b, 2026-11-26, LIVED_IN: words a warm, ordinary home's story says of a PERSON or a THING — "Grandma
 *  peeling apples", "wipes the grime from his face", "his filthy hands", "a rusty bike", "the cake ruined", "she felt
 *  abandoned" — switched the run-down look off for the whole scene. They count only said OF a place: WORN_STATE. And dust
 *  in the light is a sunny room's — "dust motes drifting in the light", "dusty sunlight" — never a dingy one's.) */
const WORN_ALONE = "(?:derelict|dilapidated|disused|condemned|boarded[- ]up|run[- ]down|rundown|ramshackle|(?<!flour[- ]|snow[- ]|star|saw)dust(?:y|-covered|-coated)?(?!\\s+(?:motes?|specks?|particles?)\\b)(?![^.;,]{0,32}\\b(?:light|sunlight|sunbeams?|sunshine|sun|beams?|rays?|glow)\\b)|cobweb(?:s|bed)?|mildew(?:ed)?|water-stained|overgrown)";
/** …words of dirt and ruin that count only said OF a place: "the abandoned mill", "peeling wallpaper", "the house was
 *  abandoned". */
const WORN_STATE = "(?:abandoned|ruined|crumbling|decaying|decayed|rotting|rotten|grime|grimy|grubby|filthy|dirty|stained(?![- ]glass)|cracked|rust(?:ed|ing|y)?(?![- ]colou?red)|peeling|mou?ldy|mou?ldering|sooty)";
/** Words that make a place worn when they are said OF a place ("the worn concrete pier", "the shabby flat"). */
const WEAR_OF = `(?:age-worn|worn|worn-out|battered|scarred|scuffed|shabby|dingy|neglected|forgotten|deserted|shuttered|closed-down|long-closed|rickety|sagging|${WORN_STATE}|${WORN_ALONE})`;
/** …and words of a place's AGE: "the old roller rink", "an old low black wooden ferry" — worn there; but an old HOME is a
 *  home its people live in, and LIVED_IN is about exactly that ("why are the walls dingy and not just a regular
 *  household?"): "their grandmother's old house", "the old family farmhouse kitchen, warm and bright" ask for no grime
 *  (DOMESTIC, below — review of S14b, 2026-11-26). */
const AGE_OF = "(?:old|older|aging|ageing|ancient|weathered|faded)";
const WORN_OF = `(?:${WEAR_OF}|${AGE_OF})`;
const A_WEAR = new RegExp(`^${WEAR_OF}$`, "iu");
/** (…said first in the phrase, two words or one: "boarded up", "run down") */
const WEAR_FIRST = new RegExp(`^${WEAR_OF}(?![\\p{L}'’-])`, "iu");
/** A home and the parts of one: its age alone never asks for a worn place. */
const DOMESTIC = /^(?:houses?|homes?|cottages?|cabins?|farmhouses?|apartments?|flats?|kitchens?|bedrooms?|bathrooms?|rooms?|halls?|hallways?|stairs|staircases?|steps|attics?|cellars?|basements?|walls?|wallpaper|paint|plaster|ceilings?|floors?|floorboards|boards|planks?|beams|rafters|roofs?|doors?|doorways?|windows?|shutters|carpets?|curtains|furniture|porch(?:es)?|fences?|gates?|garages?|sheds?|trailers?|caravans?|counters?)$/iu;
/** …the small words a worn word never reaches across to its place ("an old photo ON THE wall" is not an old wall). */
const NOT_BETWEEN = "(?:on|in|at|of|by|with|from|to|into|onto|over|under|the|a|an|his|her|their|its|our|my|your|and|or|but|beside|near|behind|across|through|against|toward|towards|while|as|is|was|are|were)";
// (…word by word, a hyphened word whole: "a faded pastel roller-rink dress" is a dress, not a rink)
const WORN_OF_PLACE = new RegExp(`\\b${WORN_OF}(?:\\s+(?!${NOT_BETWEEN}\\b)[\\p{L}'’-]+){0,3}\\s+(${WORN_PLACE})(?![\\p{L}'’-])`, "giu");
const A_PLACE = new RegExp(`^${WORN_PLACE}$`, "iu");
/** …whose place it is, said just before it: "the FERRY's worn plank deck". */
const OWNER_BEFORE = new RegExp(`(${WORN_PLACE})['’]s\\s+$`, "iu");
const PLACE_IS_WORN = new RegExp(`\\b(${WORN_PLACE})\\s+(?:is|was|has been|had been|stood|stands|sat|sits|lay|lies|looks|looked)\\s+(?:long\\s+|now\\s+|still\\s+|half\\s+|all\\s+)?(${WEAR_OF}|${AGE_OF}|empty for (?:years|decades)|closed (?:down|for (?:years|decades|months|good))|shut down|falling apart|in ruins)\\b`, "giu");
const AN_AGE = new RegExp(`^${AGE_OF}$`, "iu");
const WORN_ANYWHERE = new RegExp(`\\b${WORN_ALONE}\\b`, "giu");
/** "no dust", "never peeling", "not old": said NOT to be worn. */
const DENIED = /\b(?:no|not|never|without|nothing|free of|spotless|clean of)\s+(?:[\p{L}'’-]+\s+)?$/iu;
const unDenied = (text: string, re: RegExp): RegExpExecArray[] => [...text.matchAll(re)].filter((m) => !DENIED.test(text.slice(Math.max(0, (m.index || 0) - 24), m.index)));
/** One of a place word: "ferries" → "ferry", "benches" → "bench", "stairs" → "stair", "bus" stays. */
const oneOf = (w: string): string => {
  const p = w.toLowerCase();
  if (/ies$/.test(p)) return p.replace(/ies$/, "y");
  if (/(?:ch|sh|ss|x|us)es$/.test(p)) return p.replace(/es$/, "");
  return /[^su]s$/.test(p) ? p.slice(0, -1) : p;
};
/** The places these words call worn — "the old roller rink" → ["rink"], "the ferry's worn plank deck" → ["plank", "deck",
 *  "ferry"]. */
export function wornPlaces(text: string | null | undefined): string[] {
  const t = String(text || "").replace(/\s+/g, " ");
  const found: string[] = [];
  // (sentence by sentence: a home called only OLD counts where the same sentence says it is worn — "the old kitchen, its
  //  peeling wallpaper" — and is left out where nothing does — "their old house, the family laughing": DOMESTIC)
  for (const said of t.split(/(?<=[.!?;])\s+/)) {
    const got: Array<{ place: string; worn: boolean }> = [];
    // (every place word in the phrase — "the worn plank deck" is the deck's planks: both — and whose it is, said before it)
    for (const m of unDenied(said, WORN_OF_PLACE)) {
      const ws = m[0].split(" ");
      const worn = WEAR_FIRST.test(m[0]) || ws.some((w) => !A_PLACE.test(w) && A_WEAR.test(w));
      for (const w of ws.slice(1)) if (A_PLACE.test(w)) got.push({ place: w, worn });
      const owner = OWNER_BEFORE.exec(said.slice(Math.max(0, (m.index || 0) - 40), m.index));
      if (owner) got.push({ place: owner[1], worn });
    }
    for (const m of unDenied(said, PLACE_IS_WORN)) got.push({ place: m[1], worn: !AN_AGE.test(m[2]) });
    const wornHere = got.some((g) => g.worn) || unDenied(said, WORN_ANYWHERE).length > 0;
    for (const g of got) if (g.worn || wornHere || !DOMESTIC.test(g.place)) found.push(oneOf(g.place));
  }
  return found.filter((p, k) => found.indexOf(p) === k);
}
/** Do these words — a scene's own: its VISUAL, its narration, the place it is set at — ask for a worn place? */
export function wornSaid(text: string | null | undefined): boolean {
  const t = String(text || "").replace(/\s+/g, " ");
  return wornPlaces(t).length > 0 || unDenied(t, WORN_ANYWHERE).length > 0;
}
/** IS A WORN PLACE ASKED FOR HERE? The scene's own words say so — or the STORY's words (its idea, its other scenes, its
 *  places) call a place worn that this scene's words name: "The old roller rink…" in the first scene's narration makes
 *  "far across the dark rink floor" in the third worn too. Then a picture the look calls run-down is not drawn again. */
/*  (…and THE MEMBER'S OWN IDEA sets every scene's place — 2026-11-26, live: the idea was "a derelict, boarded-up seaside
 *  arcade, closed for years"; scene 3, close on the claw machine's glass, named only the machine, never the arcade, and was
 *  drawn again for looking run-down — in the derelict arcade the idea asked for. When the idea itself calls a place worn,
 *  no scene of that story is drawn again for looking worn. An idea that calls a home only OLD does not: DOMESTIC, as above.) */
export function wornAsked(scene: string | null | undefined, story: string | null | undefined = "", idea: string | null | undefined = ""): boolean {
  const s = String(scene || "").replace(/\s+/g, " ");
  if (wornSaid(s)) return true;
  if (idea && wornSaid(idea)) return true;
  const words = ` ${s.toLowerCase().replace(/[^\p{L}\p{N}'’ -]/gu, " ")} `;
  // (the place's word as the scene writes it: one or many, or its own — "the ferry's wheel")
  const named = (p: string): RegExp => new RegExp(`[\\s-]${p.endsWith("y") ? `${p.slice(0, -1)}(?:y|ies)` : `${p}(?:s|es)?`}(?:['’]s?)?[\\s-]`, "u");
  return wornPlaces(story).some((p) => named(p).test(words));
}
/** …and whether a smaller picture was pasted into it — null when the answer does not say. */
export function parseStoryInset(raw: string): boolean | null {
  const i = jsonIn(raw)?.inset;
  return typeof i === "boolean" ? i : null;
}
/** A FACE AT A WINDOW IS A FACE'S SIZE (2026-11-25: the ghost lady's face at the living-room window came back as
 *  large as the window). Said with INSIDE_STAYS — whenever a picture has a window, a door or an outside. */
export const TRUE_SIZE = "Everyone is at their true size beside the room: a face at a window or a door is the size of a face — the window and the door are far bigger than it.";

/** …and who stares INTO THE LENS — a list of names (empty: nobody), or null when the answer does not say.
 *  (2026-11-25: a boy "at the window looking out", seen close, came back as a portrait staring at us; the parents
 *  "turning toward him in alarm" faced the lens. Asked on the live reader with four real stills, three times each:
 *  both stares caught every time, both pictures without one passed every time.) */
export function parseStoryLens(raw: string): string[] | null {
  const l = jsonIn(raw)?.intoLens;
  if (!Array.isArray(l)) return null;
  return l.map((n) => String(n ?? "").replace(/\s+/g, " ").trim().slice(0, 40)).filter(Boolean);
}

/* A STARE IS A FAULT ONLY WHERE THE SHOT IS NOT FACING US (2026-11-26). Read off the live log of a day of told stories
 * (eleven of them, 59 scenes): 58 pictures were called "stared into the lens" — the most of any check — and of
 * the eleven of them that could be LOOKED at (the rejected goes of "Circling in the Dark" and "The Warmth by the Oven"),
 * two were stares. The other nine were the shot itself:
 *   · WALKING — "Delphine strides toward the camera through the dark rink lobby": walking at us, she faces us, three goes
 *     running (the third looking well off to one side, called a stare all the same);
 *   · OVER THE SHOULDER — over Fergus's shoulder, Imelda looks up at HIM, three goes: whoever faces the shoulder looks
 *     just past the lens, which is how every film shoots two people;
 *   · WIDE — Fergus small in the bakery doorway, facing in;
 *   · a close-up whose own words have them look our way — "her eyes locked on something just past the camera's edge":
 *     two goes of Delphine drawn exactly so.
 * The log's own words say the same of the stories that could not be looked at: Ottavia carrying the loaf "toward the
 * camera", three goes; the woman from the lake walking at us out of the water — the horror itself — three; over a
 * shoulder, twelve more. Of the 58, the rule below leaves 20: close-ups and a face near the lens.
 * The two that WERE stares: "NEAR AND FAR: Delphine stands close at the edge of the frame…" — a face near the lens
 * looking straight down it while the moment is the skater far behind her. So: a face that fills the frame, or stands
 * near the lens, looking straight down it in a moment about something else is still drawn again; in a WALKING, an
 * OVER THE SHOULDER or a WIDE shot, or where the words have them look toward the camera, it is not a fault. (The look
 * is still asked — one question among several — and its answer is not counted there.) */
const FACING_SHOTS: ReadonlySet<string> = new Set(["walk", "over", "wide"]);
const LOOKS_OUR_WAY = /\b(?:toward|towards|into|at|past|beside)\s+(?:the\s+)?(?:camera|lens|viewer)\b|\b(?:toward|towards|at|past)\s+us\b|\bcamera['’]s\s+edge\b|\bfac(?:e|es|ing)\s+(?:the\s+)?(?:camera|lens|viewer|us)\b/i;
/** Does a stare into the lens count as a fault in this picture? `shot`: how the scene is seen (story-shots.ts →
 *  sceneShot), `words`: its VISUAL. */
export function stareCounts(shot: string | null | undefined, words: string | null | undefined): boolean {
  if (shot && FACING_SHOTS.has(shot)) return false;
  return !LOOKS_OUR_WAY.test(String(words || "").replace(/\s+/g, " "));
}
/** …its answer: true / false, or null when it cannot be read (the picture is then kept as it is). */
export function parseStoryExtras(raw: string): boolean | null {
  const u = jsonIn(raw)?.uninvited;
  return typeof u === "boolean" ? u : null;
}
/** …and whether the looker was drawn standing OUT THERE: true only for a named looker said to be "outdoors"; false
 *  for indoors, or nobody looking out; null when the answer does not say (the picture is then kept as it is). */
export function parseStoryOutside(raw: string): boolean | null {
  const j = jsonIn(raw);
  const at = j?.lookerStands;
  const looker = j?.looker;
  if (typeof at !== "string") return null;
  return at.trim().toLowerCase() === "outdoors" && typeof looker === "string" && !!looker.trim();
}

/** Who was drawn TWICE, in the order asked — null when the answer does not say (an older reading, or one that
 *  cannot be read: then nobody is taken to be twice). */
export function parseStoryTwice(raw: string, refs: number): boolean[] | null {
  const n = Math.max(1, Math.min(3, Math.round(refs || 1)));
  const twice = jsonIn(raw)?.twice;
  if (!Array.isArray(twice) || twice.length < n || twice.slice(0, n).some((s) => typeof s !== "boolean")) return null;
  return twice.slice(0, n) as boolean[];
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
/** …and SOMEBODY UNCLOTHED is worse than all of them together (2026-11-25: a lake film nobody could send — whatever
 *  else is right in it). Every other fault at once comes to 30 (three looked for, none there; split; inset; a stranger;
 *  stood outside; a stare; run-down; a night drawn as day), so a picture with it is never the one kept while one without
 *  it exists. (It was 30 while every other came to 27 — raised when the night came in beside them.)
 *  (…and an empty band, 2026-11-26: 4 at most — full-frame.ts → bandFault — every other fault at once now 34, still under.) */
export const UNCLOTHED_FAULT = 40;
/** …and A NIGHT SCENE DRAWN AS DUSK OR DAY (2026-11-25, the night ferry told over thirteen daylight pictures) weighs what
 *  the other faults that break the story weigh — somebody missing, a stranger, the looker stood outside — over the
 *  cosmetic ones (a stare, a run-down room), under a split picture that cannot be used at all, and far under somebody
 *  unclothed: a dressed day picture is kept before an undressed night one. */
export const NOT_NIGHT_FAULT = 3;
// (…and AN EMPTY BAND OR A DOUBLED STRIP weighs what a split picture weighs — it cannot be shown as it is — unless a crop
//  that covers the frame keeps most of the picture: then 1, a sliver cut off at the end. full-frame.ts → bandFault, 2026-11-26)
export const storyFaults = (c: StoryCheck): number => (c.panels ? 4 : 0) + 3 * c.seen.filter((s) => !s).length + 3 * (c.twice || []).filter((t, k) => t && c.seen[k] !== false).length + (c.extra ? 3 : 0) + (c.outside ? 3 : 0) + (c.lens?.length ? 2 : 0) + (c.grimy ? 2 : 0) + (c.inset ? 4 : 0) + (c.notNight ? NOT_NIGHT_FAULT : 0) + (c.unclothed ? UNCLOTHED_FAULT : 0) + bandFault(c.band);

/** What the next go is told FIRST about the last one (the master's own lesson, image-generation.server.ts: DRESSED said
 *  at the end of a long prompt did not dress the woman in the lake; said first, it did). A picture that came back with
 *  somebody unclothed → CLOTHED_FIRST, ahead of everything; anything else → "" (its fault is named at the end, storyFix). */
// (…and a night scene whose sky came out dusk or day → NIGHT_FIRST, the master's own redraw line — after the clothes,
//  which weigh more: 2026-11-25)
export const storyFirst = (c: StoryCheck | null | undefined): string => {
  const first = [c?.unclothed ? CLOTHED_FIRST : "", c?.notNight ? NIGHT_FIRST : ""].filter(Boolean).join(" ");
  return first ? `${first} ` : "";
};

/** What to tell the picture model on the next go: the fault, named. `names` in the order of the references. */
export function storyFix(c: StoryCheck, names: string[], kinds: ReadonlyArray<string | undefined> = []): string {
  const out: string[] = [];
  // (an empty band or a doubled strip is said FIRST of the faults, with its edge and the frame's shape — full-frame.ts → bandFix)
  const band = bandFix(c.band);
  if (band) out.push(band);
  if (c.panels) out.push("The last try was split into panels — draw ONE single picture of one moment that fills the whole frame");
  if (c.inset) out.push("The last try had a smaller picture pasted into a corner of it — draw ONE picture that fills the whole frame, with no box, inset, close-up or second view inside it");
  const missing = c.seen.map((s, k) => (s ? -1 : k)).filter((k) => k >= 0);
  const gone = missing.map((k) => names[k] || `the character in reference image ${k + 1}`);
  if (gone.length) out.push(`${gone.join(" and ")} ${gone.length === 1 ? "was" : "were"} missing or drawn as someone else in the last try — draw ${gone.length === 1 ? "them" : "each of them"} EXACTLY as in their reference image: the same face, hair colour and hair`);
  // (a creature that came back as an animal, or as a person, is told what it IS)
  // (somebody the words do not put there is told to be gone)
  if (c.extra) out.push("The last try had somebody in it whom these words do not put there — draw NOBODY but who they name: no stranger, no passer-by, nobody sitting, standing or watching anywhere in the picture");
  // (whoever looks out, drawn standing out there with what they look at, is told where they are)
  if (c.outside) out.push("The last try stood whoever looks out OUTSIDE, out there with what they look at — they are INSIDE the house: behind the glass of the window or inside the doorway, the glass or the door between them and what is out there, never out on the porch or in the yard with it");
  // (whoever stared into the lens is told where their eyes are)
  if (c.lens?.length) out.push(`${c.lens.join(" and ")} stared straight into the camera in the last try — nobody looks at the camera: their eyes are on what this moment has them looking at (the window, the door, each other, the dark), turned away from the lens`);
  // (a place drawn run-down that its words do not call one is told it is cared for)
  if (c.grimy) out.push("The last try made the place look dirty and run-down — it is an ordinary, clean, cared-for place: freshly painted walls, clean floors and windows, nothing stained, peeling or damp; it is dark only because it is night");
  // (a character drawn twice is told it is in the picture ONCE)
  const doubled = (c.twice || []).map((t, k) => (t && c.seen[k] !== false ? names[k] || `the character in reference image ${k + 1}` : "")).filter(Boolean);
  if (doubled.length) out.push(`${doubled.join(" and ")} ${doubled.length === 1 ? "was" : "were"} drawn TWICE in the last try — ${doubled.length === 1 ? "they appear" : "each of them appears"} exactly ONCE in this picture, nowhere else in it`);
  const beasts = missing.filter((k) => kinds[k] === "monster" || kinds[k] === "cartoon").map((k) => names[k]).filter(Boolean);
  if (beasts.length) out.push(`${beasts.join(" and ")} must have the reference image's own BODY — the same build, standing the same way, covered in the same fur or skin, in the same clothing in the same state: not an ordinary animal, and not a human being with that head`);
  return out.length ? ` ${out.join(". ")}.` : "";
}

/* A STORY'S REDRAWS ARE COUNTED (2026-11-26). Read off the live log of a day of told stories — eleven of them, 59 scenes —
 * they drew 122 scene pictures: 2.07 a scene, at $0.15 a picture and about $0.035 of looks at each. "Circling in the
 * Dark" drew 10 for its 4 scenes (13 with its two portraits and its rink's sheet); three of its scenes took every go there
 * was, and kept the SECOND — a check that is wrong does not make the kept picture better, it keeps the best of three. The
 * still tier's 1 token a second holds the owner's 20% only to about 1.6 draws a scene (film-length.ts). So a story — each
 * drawing of its scenes: a storyboard, one press of the Movie Maker, a re-roll — may spend at most HALF ITS SCENES, rounded
 * up, on redraws for a SOFT fault beyond the first draw each (redrawCap: 4 scenes 2, 5 scenes 3, 13 scenes 7, one
 * re-rolled scene 1). Past it a picture keeps its best try, and its fault is written down for the storyboard and the
 * operator's record as it always was.
 * A HARD fault — one that breaks the story or cannot be shown: somebody unclothed, a split picture, a band no crop puts
 * right, a smaller picture pasted in, somebody missing or drawn twice, a stranger, the looker stood outside, a night drawn
 * as day, a picture letterboxed or framed on a sheet's ground — is never let through to save money (review of S14b): it
 * is drawn again up to its three goes, as before, and what it spends counts against the cap, so it leaves less for the
 * soft ones. A SOFT fault may spend only what is left of the cap: a run-down room its words never asked for (the
 * owner's own "why are the walls dingy and not just a regular household?" — LIVED_IN) all of what is left; a STARE, the
 * softest — nine of the eleven looked at were the shot itself — never more than the cap's first half (rounded up), so a
 * dingy home that comes back after the stares still has its redraw. The cap cuts the soft faults, and only them. A story
 * whose hard faults alone pass the cap draws more than 1.5 a scene; the log line "[narrated] the pictures: …" says so.
 * (Four scenes are drawn at a time: there is no waiting to see them all. The same day replayed with the checks that
 * listen to the story and this cap — tests/redraw-economy.test.ts: 84 pictures, 1.42 a scene, was 122.) */
export type FaultTier = "hard" | "soft" | "stare" | "";
/** How bad the worst thing wrong with a picture is: "hard", "soft" (a run-down room), "stare" (only a stare) or "". A
 *  band a crop cuts off is no fault to draw again for (coverNow). */
export function faultTier(c: StoryCheck | null | undefined): FaultTier {
  if (!c) return "";
  const { lens: _lens, grimy: _grimy, band, ...rest } = c;
  if (storyFaults({ ...rest, ...(band && !bandCuttable(band) ? { band } : {}) })) return "hard";
  return c.grimy ? "soft" : c.lens?.length ? "stare" : "";
}
/** A BAND A CROP PUTS RIGHT, AND NOTHING ELSE WRONG, IS COVERED AT ONCE — never drawn again (review of S14: it paid for up to
 *  two redraws, about $0.15 and four looks each, before it was covered for nothing at the end). */
export const coverNow = (c: StoryCheck | null | undefined): boolean => !!c?.band && bandCuttable(c.band) && faultTier(c) === "";
/** The most redraws a drawing of `scenes` scenes may spend on soft faults (hard ones are counted in it, never refused). */
export const redrawCap = (scenes: number): number => Math.ceil(Math.max(0, Math.floor(Number(scenes) || 0)) / 2);
/** What one drawing of a story has spent, and may: a run-down room only while `spent` is under `cap`; a stare only while
 *  `spent` is under `cap` and `spentStares` under `stares`; a hard fault always (counted in `spent`, which may then pass
 *  `cap`). */
export type RedrawPurse = { cap: number; stares: number; spent: number; spentStares: number };
export function redrawPurse(scenes: number, capped = true): RedrawPurse {
  // (uncapped — STORY_REDRAW_CAP=off — every scene has its three goes, as before 2026-11-26)
  const cap = capped ? redrawCap(scenes) : 2 * Math.max(0, Math.floor(Number(scenes) || 0));
  return { cap, stares: capped ? Math.ceil(cap / 2) : cap, spent: 0, spentStares: 0 };
}
/** May a scene whose last go came back with a fault of this tier be drawn again? Yes spends one from the purse.
 *  (Called and answered at once — the four scenes drawing side by side never spend the same redraw twice.) */
export function spendRedraw(p: RedrawPurse, tier: FaultTier): boolean {
  if (!tier) return false;
  // (a HARD fault is never let through to save money — review of S14b, 2026-11-26: once stares had spent the purse, a
  //  scene with somebody missing, a stranger in it, split into panels or bare kept that picture after one go, and a framed
  //  panel fell to the lenient path, drawn without the cast's looks. It is drawn again — up to its three goes, as before —
  //  and what it spends is counted, so it leaves less for the soft faults after it: the cap cuts stares and run-down rooms.)
  if (tier === "hard") { p.spent++; return true; }
  if (p.spent >= p.cap || (tier === "stare" && p.spentStares >= p.stares)) return false;
  p.spent++;
  if (tier === "stare") p.spentStares++;
  return true;
}

/* THE PLACES, ASKED FOR ON THEIR OWN. The story's writer is asked for them with everything else, and may
 * answer with an empty list — it did three times out of three on the live site once its brief also carried
 * a shot list (2026-11-24), and a story's ring of stones was then low boulders, tall megaliths and an arch.
 * A story whose writer listed no place is asked again, about nothing else: its pictures' own words, in
 * order, and which place two or more of them share. */

/** The question. `visuals` are the scenes' picture descriptions, in order. */
export function placesAsk(visuals: ReadonlyArray<string>): string {
  const list = (visuals || []).map((v, i) => `${i + 1}. ${String(v || "").replace(/\s+/g, " ").trim().slice(0, 400)}`).join("\n");
  return (
    `These are the pictures of ONE illustrated story, in order:\n${list}\n\n` +
    `Name the ONE or TWO places or things that at least TWO of these pictures are set at, in, on or beside — a house, a clearing, a boat, a ring of stones. Write each as "name: look": a short plain name beginning with "the" (use the words the pictures already use for it), a colon, then ONE fixed description of 15-30 words — its shape, colours and materials, and two or three details that make it THIS one and no other — true to every picture set there. Never a person or an animal; no weather and no time of day in it.\n` +
    `Then, for EACH picture in order, give the name of the one of them that picture is set at — exactly as you wrote it — or "" when it is set somewhere else.\n` +
    `If no place is shared by two pictures, both lists are empty. Reply with ONLY this JSON: {"places": ["name: look"], "scenes": ["a name, or an empty string, for each picture"]}.`
  );
}

/** Its answer, checked: two places at most, each "name: look"; one mark per scene, and only a name that
 *  was listed. Nothing usable → no places (the story is drawn from its words, as before). */
export function takePlaces(answer: unknown, scenes: number): { places: string[]; marks: string[] } {
  const a = answer && typeof answer === "object" && !Array.isArray(answer) ? (answer as Record<string, unknown>) : {};
  const places = (Array.isArray(a.places) ? a.places : [])
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.replace(/\s+/g, " ").trim().slice(0, 400))
    .filter((p) => p.length > 12 && !!placeEntry(p).name && !!placeEntry(p).look)
    .slice(0, STORY_PLACE_MAX);
  const n = Math.max(0, Math.floor(scenes || 0));
  const said = Array.isArray(a.scenes) ? a.scenes : [];
  const marks = Array.from({ length: n }, (_, i) => {
    const m = typeof said[i] === "string" ? String(said[i]).replace(/\s+/g, " ").trim() : "";
    const hit = m ? places.find((p) => placeKey(placeEntry(p).name) === placeKey(m)) : undefined;
    return hit ? placeEntry(hit).name : "";
  });
  // (a place only ONE scene is set at is no recurring place)
  const kept = places.filter((p) => marks.filter((m) => placeKey(m) === placeKey(placeEntry(p).name)).length >= 2);
  return { places: kept, marks: marks.map((m) => (kept.some((p) => placeKey(placeEntry(p).name) === placeKey(m)) ? m : "")) };
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
// (…and whether somebody in it is STILL unclothed — after its goes and its one edit: the operator's record says so)
// (…and whether a night scene was still drawn as dusk or day after its goes, 2026-11-25)
// (…and whether its picture was a narrow middle cut from a banded one — full-frame.ts, 2026-11-26)
export function keptFaults(checks: ReadonlyArray<StoryKept | null | undefined>): Array<{ scene: number; missing: string[]; panels?: true; unclothed?: true; notNight?: true; band?: true }> {
  const out: Array<{ scene: number; missing: string[]; panels?: true; unclothed?: true; notNight?: true; band?: true }> = [];
  (checks || []).forEach((c, i) => {
    if (!c || !storyFaults(c)) return;
    out.push({ scene: i + 1, missing: (c.who || []).filter((_, k) => c.seen[k] === false).map((n) => String(n).slice(0, 40)).slice(0, 3), ...(c.panels ? { panels: true as const } : {}), ...(c.unclothed ? { unclothed: true as const } : {}), ...(c.notNight ? { notNight: true as const } : {}), ...(c.band ? { band: true as const } : {}) });
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
 *  the scenes are matched by (narrated-core's entryName), so a portrait is always found for its entry.
 *  WHAT THEY ALWAYS HAVE rides at the END of the entry as a tag (character-mark.ts, SPEC-S16 — the owner, 2026-11-26:
 *  "specific clothing's - specific props … that often show in scenes"): "…a black undercut [always: a long cobalt scarf
 *  | move: the Paper Gale — …]". It is PEELED OFF FIRST and handed back as `mark` (only when there is one), so the look
 *  stays exactly what it was for everything that reads it — the cast token and the Starring row, the scene note, whoIsWho,
 *  and characterKind, which reads "the thing itself" from the look's first words: unpeeled, "Kai [always: a wolf-fur
 *  cloak]" reads as a cartoon (`wol(f)`), and "Kai [always: a mask with glowing eyes]" as a monster (UNNATURAL) — a hero
 *  made a creature, photographed and hidden in the dark. */
export function castEntry(entry: string): { name: string; look: string; mark?: CharacterMark } {
  const peeled = peelMark(String(entry || ""));
  const e = peeled.text.replace(/\s+/g, " ").trim();
  const head = e.split(/[,:—–(]/)[0] || "";
  const bracketed = e.charAt(head.length) === "(";
  const rest = e.slice(head.length).replace(/^[\s,:—–(]+/, "");
  return { name: head.trim().slice(0, 40).trim(), look: (bracketed ? rest.replace(/\)\s*\.?\s*$/, "") : rest).trim(), ...(peeled.mark ? { mark: peeled.mark } : {}) };
}

/** WHAT EACH OF A STORY'S CHARACTERS ALWAYS HAS (character-mark.ts): each named entry's mark, keyed by its name in lower
 *  case — an entry with no tag has none. It is the ONE place a story's marks are read from: an invented character's AND
 *  a picked face's, whose entry the writer returns "followed by that fixed look", its tag word for word
 *  (film-engine.server.ts → pickedLine). */
export function castMarks(cast: ReadonlyArray<string>): Map<string, CharacterMark> {
  const out = new Map<string, CharacterMark>();
  for (const e of cast || []) {
    const c = castEntry(typeof e === "string" ? e : "");
    const key = c.name.trim().toLowerCase();
    if (key && c.mark && !out.has(key)) out.set(key, c.mark);
  }
  return out;
}

/** Are two names the same character's? (As they are written, whatever the capitals.) */
export const sameCharacter = (a: string, b: string): boolean => !!a && a.trim().toLowerCase() === (b || "").trim().toLowerCase();

/** A portrait is always drawn TALL, whatever shape the story is: a standing figure fills a tall frame. */
export const PORTRAIT_ASPECT = "9:16";

/* WHAT FRIGHTENS. Three references from the owner, 2026-11-24 ("actual realistic scary as fuck ass creatures
 * like this"), and the same four ideas drawn two ways on this very picture model: worded as the app worded
 * them, they came out as Halloween illustrations; worded by how the thing was CAUGHT, what is slightly WRONG
 * with it and what stays HIDDEN, they came out as his references. The three parts live here. */

/** How a creature is made real: photographed, built, under-lit — never rendered. */
export const CREATURE_REAL = "It is PHOTOGRAPHED: a practical-effects creature as a 1970s horror film would build it — real skin, real hair, real teeth — caught on 35mm film, underexposed, grainy, a little soft. Never CGI, never a 3D render, never an illustration, never a clean studio look.";

/** What a scene's picture is told about a creature the story invented: most of it is not seen. */
export function creatureHidden(name: string): string {
  const n = String(name || "").replace(/\s+/g, " ").trim();
  // (…and never beside somebody who would see it: "The Dent in the Pillow", 2026-11-25 — the figure stood full length in
  //  the hallway behind the nurse, then right next to her in the room, in her phone's light, while she looked at a bed)
  return n ? `${n} is never shown whole or well lit: darkness, distance, or something in the way hides most of ${n} — we see less than we want to, and what we do see is exactly as in the reference image. ${n} is never in the light of anyone's lamp, torch or phone, and never within arm's reach of anybody who is not looking straight at ${n}: unnoticed, ${n} is far back in the dark, small in the frame.` : "";
}

/** What the story's writer is told a creature of its own must be (a horror story only). */
export const WHAT_FRIGHTENS = "WHAT FRIGHTENS — if this story has a creature, a ghost or a thing that YOU invent, it is NEARLY human and slightly wrong: give it ONE or TWO exact wrongnesses and nothing more — a smile far too wide, crowded with thin teeth; eyes sunk in dark sockets with one wet glint; fingers or a neck too long; skin like candle wax; a way of standing perfectly still. Never horns, wings, tentacles, armour, glowing magic, flames or a bare skull — those are costumes. Its \"cast\" entry says exactly what is wrong with it, plainly — and a threat the IDEA names (\"a dark shadow\", \"a ghost lady\", \"a figure\") always has a \"cast\" entry of its own, named as the idea names it. A threat the idea calls a SHADOW is one: its look is \"a tall human shape of flat, featureless black, no face, no clothes — the dark itself standing there\", never a person in a coat or a hood (a shadow left without a look was drawn as a man in a hooded raincoat waiting under the tree). Its \"cast\" entry also says what it WEARS — a soaked nightgown, an old coat, a hospital gown: it is always dressed. And it is never fully seen: in most VISUALS it is half in darkness, behind something, far off, or only a part of it is in the frame — a hand on a door frame, a face at the edge of the light.";

/** WHAT A STORY'S OWN CHARACTER IS — read from its NAME as well as its look. The writer is told a creature it invents
 *  is "NEARLY human" (WHAT_FRIGHTENS), so its look reads like a person's ("a tall woman who stands unnaturally
 *  still, her pale gown hanging damp…") and only its NAME says what it is: "the ghost lady". Read from the look
 *  alone she was a PERSON — drawn whole and evenly lit, grinning and waving at the window like a decoration, in a
 *  story the owner called "still shotty" (2026-11-25). A descriptive name ("the ghost lady", "the shadow", "the
 *  thing in the well") that names a creature makes it one; a proper name ("Howl", "Mr. Fox") never decides it. */
// (…the creature word must be what the name IS: last, or followed by who it is or where — "the ghost LADY", "the
//  shadow FIGURE", "the thing IN the well". "The ghost hunter" and "the shadow puppeteer" are people.)
// ("the figure in Room 14" — the threat of "The Dent in the Pillow", 2026-11-25 — was read as a PERSON, drawn whole in
//  plain light like the nurse herself; a story names its threat as the idea does, and "a figure" is one)
const THREAT_ALONE = /^(?:shadows?|things?|presence|entity|figures?)$/i;
const BEING_AFTER = /^(?:lady|woman|man|girl|boy|child|kid|baby|bride|groom|king|queen|mother|father|sister|brother|twins?|figure|rider|horseman|doll|nun|sailor|soldier|knight)$/i;
const PLACE_AFTER = /^(?:in|under|at|from|behind|beneath|below|outside|inside|on|by|of|near|across)$/i;
export function characterKind(name: string | null | undefined, look: string | null | undefined): "person" | "cartoon" | "monster" {
  const words = String(name || "").replace(/\s+/g, " ").trim().split(" ").map((w) => w.replace(/[^\p{L}'’-]/gu, ""));
  if (/^(?:the|a|an)$/i.test(words[0] || "")) {
    for (let k = 1; k < words.length; k++) {
      const w = words[k];
      if (!w || !(MONSTERS.test(w) || UNDEAD.test(w) || THREAT_ALONE.test(w))) continue;
      const next = words[k + 1] || "";
      if (!next || BEING_AFTER.test(next) || PLACE_AFTER.test(next)) return "monster";
    }
  }
  return keepGuess(String(look || "")).kind;
}

/** What the picture model is asked for: THIS one character, whole, on a plain ground, in the story's style. */
export function portraitPrompt(entry: string, sceneHint: string, safe = ""): string {
  // WHAT THEY ALWAYS HAVE (character-mark.ts, SPEC-S16) is drawn INTO the portrait — the one picture every scene of theirs
  // is drawn from, and CAST_LOCK holds what a reference shows ("the same … clothing, and nothing added to what it wears";
  // the places proved that words alone draw a thing differently every time, and one reference picture draws it the same).
  // The entry is said WITHOUT its tag, and the thing in a line of its own after the ground. Never the move: a portrait is
  // a standing figure. An entry with no tag is asked for exactly as before.
  const { text: said, mark } = peelMark(String(entry || ""));
  const who = castEntry(said);
  const has = mark?.has ? portraitHas(who.name || "This character", mark.has) : "";
  // A CREATURE A GROWN-UP STORY INVENTS is photographed, not illustrated (below): its portrait is what
  // every scene is drawn from, and a clean, evenly lit, rendered monster stays one in all of them.
  // (…a creature by its NAME as well: "the ghost lady, a tall woman who…" — characterKind)
  if (!safe && characterKind(who.name, who.look || said) === "monster") {
    return `${sceneHint}. ${CREATURE_REAL} A wardrobe-test photograph of ${said.replace(/\s+/g, " ").trim().slice(0, 320)} — this ONE creature alone, the whole figure from head to feet, standing, turned a little toward the camera, against a plain dark wall under one hard light from above, so that everything about it can be seen.${has} ${NOTHING_WRITTEN}`;
  }
  return `${safe}${sceneHint}. A character portrait of ${said.replace(/\s+/g, " ").trim().slice(0, 320)} — this ONE character alone, the whole body from head to feet, standing, turned a little toward the viewer, the face clearly seen, on a plain neutral background.${has} In the exact art style of the story. ${NOTHING_WRITTEN}`;
}

/* A TOLD STORY IS DRAWN ON THE GOOD MODEL — every picture of it: its portraits, its places' sheets and its scenes.
 *
 * It used to be the everyday model (nano-banana) for everything but a picture made from three reference
 * pictures (more than that model holds: asked for "Tobias stands at the workshop doorway watching Marta and Ines
 * sand the hull" with their three portraits, it drew TWO people six times out of six, 2026-11-23). The owner,
 * 2026-11-24, of a tester's Horror Story: "looks like our narrated horror is running a poop engine for the stills
 * and not the good one". He was right twice over. A scene the everyday model would not draw (a scary one — it
 * refuses those now and then) fell through to the lenient path, whose own fallback on a refusal was flux-dev: the
 * tester's "two children in a house" came back as a murky hut in a forest. And what it did draw was soft and
 * airbrushed beside the stronger model: the tester's own two scenes drawn side by side by all three (2026-11-24 —
 * two children on a sofa, one on the phone, a pale woman outside the window; a boy at his bedroom window, a dark
 * shadow under the old tree) — the everyday model put the woman INSIDE the room and drew the boy as a speck;
 * nano-banana-pro drew both like frames of a film; Seedream 4.5 nearly as well. None refused.
 * So: nano-banana-pro first (about 15 cents a picture, twice the time); Seedream 4.5 when it refuses or cannot be
 * reached — a different maker's model, that takes the same reference pictures, so the cast keep their looks;
 * the everyday model last. */
export const STORY_MODEL = "google/nano-banana-pro";
export const STORY_SECOND_MODEL = "bytedance/seedream-4.5";
export const STORY_LAST_MODEL = "google/nano-banana";
/** The models a told story's picture is tried on, in order. */
export const STORY_LADDER: ReadonlyArray<string> = [STORY_MODEL, STORY_SECOND_MODEL, STORY_LAST_MODEL];
/** What each of them is asked — the same picture, in each one's own words: nano-banana-pro at 2K, Seedream at 2K,
 *  the everyday model as it was. (nano-banana-pro was asked for 1K — "what the story is cut at" — until the owner
 *  called the stories' look "rough", 2026-11-25: its 2K is the same price as its 1K ($0.15 a picture; 4K is
 *  $0.30), and a story's slow push-in and the motion engine both start from this picture.) */
export function storyPictureInput(model: string, o: { prompt: string; refs: ReadonlyArray<string>; aspect: string }): Record<string, unknown> {
  const refs = o.refs.length ? { image_input: [...o.refs] } : {};
  if (model === STORY_SECOND_MODEL) return { prompt: o.prompt, ...refs, aspect_ratio: o.aspect, size: "2K", max_images: 1 };
  if (model === STORY_LAST_MODEL) return { prompt: o.prompt, ...refs, aspect_ratio: o.aspect, output_format: "jpg" };
  return { prompt: o.prompt, ...refs, aspect_ratio: o.aspect, output_format: "jpg", resolution: "2K" };
}

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
export function placeSheetPrompt(place: { name: string; look: string }, sceneHint: string, safe = "", today = false): string {
  return `${safe}A DESIGN SHEET of one place, for artists to copy it from: ${place.name} — ${place.look}. The same place is shown in three views on a plain pale-grey studio background — two different views of the whole of it, and one close view of its most recognisable part — like a scale model photographed on a table: no scenery, no sky, no ground, no weather around it. Style: ${sceneHint}.${today ? ` ${TODAY_LOOK}` : ""} No people, no animals, no figures anywhere. ${NOTHING_WRITTEN}`;
}

/** What a scene's picture is told about the place it is set at, given as reference image `n`. */
export function placeNote(n: number, place: { name: string; look: string }): string {
  return `Reference image ${n} is a design sheet of ${place.name} (${place.look.slice(0, 220)}) — the PLACE this picture is set in. It is the SAME one here: the same shapes, colours, materials and details. Show it from wherever this moment is seen (on it, inside it, beside it, far off): a NEW view of the same place. ${PLACE_INSIDE} The sheet's plain background and its three views are NOT part of this picture: this is a scene that fills the whole frame — never a sheet, a panel or a framed picture on a background. ${PLACE_FULL_SIZE}`;
}
/** THE SHEET'S SCALE MODEL IS NOT THE PLACE (2026-11-26). The sheet is drawn "like a scale model photographed on a table",
 *  and a WIDE scene drawn from it came back as that model: the bakery's walls cut off part-way up with plain studio
 *  ground above them, the room set on a plain ground with an empty band below it, the sheet's two views stacked — four of
 *  five test draws of "What His Hands Remember"'s bakery scene (full-frame.ts measures the bands it leaves). */
// (…and a place seen from OUTSIDE, far off, is still drawn whole under it — review of S14: a lighthouse on a headland,
//  WIDE, 9:16, drawn with its sheet, two goes: the whole tower and its sky both times, nothing cut off at the top)
export const PLACE_FULL_SIZE = "The sheet shows it as a scale model on a table; here it is the REAL place at full size, seen from where a person would stand — its walls run up to its ceiling or out of the top of the frame, its floor or ground out of the bottom — never a cut-away model with plain background above it, below it or around it.";
/** INSIDE A PLACE, ITS OUTSIDE IS NOT DRAWN (2026-11-24): the kids' horror story's house had a sheet of its outside
 *  ("pale painted siding, a plain white front door"), and its hallway scene, drawn with it, came back with siding
 *  on the walls INSIDE — a hallway that read as a porch. */
export const PLACE_INSIDE = "When this moment is INSIDE it, its rooms have ordinary indoor walls, floors and ceilings — its outside walls (siding, brick, stone, planks) are never drawn indoors; from the sheet take what is seen from inside: its doors, its windows, its colours.";
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
// (…and the "nearly human, slightly wrong" the horror writer is told to give a thing it invents (WHAT_FRIGHTENS): "a
//  woman … her smile far too wide and crowded with thin teeth, eyes sunk in dark wet sockets" was read as a PERSON —
//  drawn whole and lit, and her close-up's smile softened as it moved, 2026-11-25)
const UNNATURAL = /\b(?:empty (?:eye )?sockets|glowing (?:\w+ )?eyes|translucent|see-through|rotting (?:flesh|skin)|skin tinged (?:blue|grey|gray|green)|fangs|tentacles|smile (?:far |much |way )?too wide|too-wide smile|crowded with (?:thin |small |sharp |grey |gray |yellow )?teeth|(?:eyes )?sunk(?:en)? (?:deep )?in(?:to)? (?:dark |black )?(?:wet )?(?:sockets|hollows)|skin (?:like|the colou?r of) (?:[\w-]+ ){0,2}candle ?wax|candle[- ]wax skin|(?:[\w-]+[- ]shaped |shapeless |formless )presence|(?:fingers|neck|arms|limbs) (?:far |much )?too long|unnaturally (?:long|tall|still))\b/i;

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
