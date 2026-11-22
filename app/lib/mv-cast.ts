/* WHO IS IN A MUSIC-VIDEO SHOT, and what each of them is doing.
 *
 * A tester picked a star and two back characters and got videos with ONE back character — who was
 * holding the microphone (2026-11-21). Two causes, both here now:
 *
 *  1. WHO. The default put one co-star, in rotation, in each performance and none in a cut scene, so a
 *     short video could never show the second. A performance now has EVERY picked co-star (two at most).
 *
 *  2. WHAT THEY DO. The picture model was handed three faces and a setting and left to guess the rest —
 *     and its prompt was cut at 460 characters, before the sentence that said who was there. The prompt
 *     built here says it FIRST and briefly: how many people, the artist front and centre and the only
 *     one singing, the others dancing with their mouths closed, and whether a microphone belongs at all
 *     (the owner: "Mics only if necessary or fitting, most music videos don't use a mic").
 *
 * Pure (its one import, mv-sense.ts, is pure too): the builder, the pipeline and the tests share it. */

import type { ShotRole } from "./mv-pace";
// (an explicit .ts: node --test loads this file directly and resolves like a browser — see tsconfig.json)
import { RIDE_MAX_COSTARS, rideScene } from "./mv-sense.ts";

/** The most co-stars one shot holds beside the artist (three faces is what the picture model keeps apart). */
export const MAX_COSTARS = 2;

/** Does a microphone BELONG in this setting? Only a live stage or a recording booth — or a scene whose
 *  own words ask for one. Everywhere else a music video is mimed to the track, and a mic in the hand is a
 *  prop nobody asked for. */
export function micFits(visual: string | null | undefined): boolean {
  const v = visual || "";
  // "no microphone", "without a mic" — the scene says there is none
  if (/\b(?:no|without|never)\b[^.;]{0,24}\bmic(?:rophone)?s?\b/i.test(v)) return false;
  // a LIVE show, a booth, or the scene's own words
  if (/\b(?:on ?stage|concert|live (?:show|set|gig|band|performance)|gig|festival|karaoke|(?:recording|vocal|sound) booth|mic(?:rophone)?s?)\b/i.test(v)) return true;
  // a "stage" on its own is a SET — "a sleek rooftop stage with bright lighting" is where a video is
  // filmed, not a concert — and is only a live one with a crowd or a venue in the scene. (The pop look
  // offers "a sleek stage", so nearly every pop performance was written on one and handed a microphone:
  // the owner's "most music videos don't use a mic" was being lost to one word, 2026-11-22.)
  return /\bstage\b/i.test(v) && /\b(?:crowd|audience|fans|packed|sold[- ]out|arena|stadium|venue|club|theat(?:er|re)|tour)\b/i.test(v);
}

/** The SHOTLIST slot that is the dance cut scene (see music-video-pipeline.server.ts). */
export const DANCE_SLOT = 2;

/** Which of the picked co-stars (by index) are in a scene unless the maker says otherwise:
 *   - a PERFORMANCE: all of them — they were picked to be seen with the artist;
 *   - a CUT SCENE: whoever the writer named in it; the dance cut scene has them all (they ARE the
 *     dancers); any other cut scene belongs to the artist or the scenery. */
export function defaultCostars(scene: { visual?: string; caption?: string } | undefined, role: ShotRole, slot: number, names: string[]): number[] {
  // a ride in a car holds the artist and ONE other (mv-sense.ts RIDE_MAX_COSTARS — three in a car came
  // back with somebody doubled more often than not); the maker can still put more in
  const cap = rideScene(scene?.visual) ? RIDE_MAX_COSTARS : MAX_COSTARS;
  const all = names.map((_, k) => k).slice(0, cap);
  if (!names.length) return [];
  if (role === "perform") return all;
  const text = `${scene?.visual || ""} ${scene?.caption || ""}`;
  const named = names
    .map((n, k) => ({ n: (n || "").trim(), k }))
    .filter((x) => x.n.length > 1 && new RegExp(`(^|[^\\p{L}])${x.n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "iu").test(text))
    .map((x) => x.k);
  if (named.length) return named.slice(0, cap);
  return ((slot % 8) + 8) % 8 === DANCE_SLOT ? all : [];
}

const sameName = (s: string | null | undefined): string => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

/** WHO SINGS a scene: the index of the co-star whose verse it is, or -1 for the artist. A scene's
 *  "singer" is a NAME — the song writer's mark, or the maker's pick (a featured verse: mv-feature.ts) —
 *  and a name that is nobody's in the cast is the artist. */
export function singerOf(scene: { singer?: string } | null | undefined, names: string[]): number {
  const want = sameName(scene?.singer);
  if (!want) return -1;
  return names.slice(0, MAX_COSTARS).findIndex((n) => sameName(n) === want);
}

/** WHO IS IN A SHOT: who leads it and who is beside them (-1 = the artist, 0… = a co-star by index).
 *
 *  The artist leads every scene but one kind: a PERFORMANCE in a co-star's own verse, which the co-star
 *  leads — it is their voice at that moment, so it is their mouth on camera. By default they have that
 *  shot to themselves (one face is what the lip-sync does best); the maker can put others beside them.
 *  `listed` is the maker's pick for the scene, already resolved to who (it may name the artist, -1);
 *  with no pick it is the default (defaultCostars). */
export function sceneCast(o: { scene: { visual?: string; caption?: string; singer?: string } | undefined; role: ShotRole; slot: number; names: string[]; listed?: number[] }): { lead: number; others: number[] } {
  const uniq = (xs: number[]): number[] => Array.from(new Set(xs.filter((x) => Number.isInteger(x) && x >= -1 && x < MAX_COSTARS)));
  const k = o.role === "perform" ? singerOf(o.scene || undefined, o.names) : -1;
  if (k >= 0) return { lead: k, others: uniq(o.listed || []).filter((w) => w !== k).slice(0, MAX_COSTARS) };
  const beside = o.listed ?? defaultCostars(o.scene, o.role, o.slot, o.names);
  return { lead: -1, others: uniq(beside).filter((w) => w >= 0).slice(0, MAX_COSTARS) };
}

/** Cut `s` to at most `max` characters at a word. */
export function cutAtWord(s: string, max: number): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max + 1);
  const at = head.lastIndexOf(" ");
  return (at > max * 0.6 ? head.slice(0, at) : t.slice(0, max)).replace(/[\s,;:.—–-]+$/, "");
}

const COUNT_WORD = ["zero", "one", "two", "three", "four"];
const ORDINALS = ["1st", "2nd", "3rd", "4th"];

/** The microphone rule for one shot, as the picture model is told it. */
export function micLine(micOk: boolean, performing: boolean): string {
  if (!performing) return "Nobody sings and there are NO microphones.";
  return micOk
    ? "Only the artist may hold a microphone — low, clear of the mouth; nobody else has one."
    // (the hands are given something to do: told only "nobody holds one", the picture model drew a singer
    //  with a microphone three tries running — a hand at the mouth is how it draws singing. Told this,
    //  six stills of six had none. Asking it to take one OUT of a finished picture does not work: it
    //  redrew the singer holding it lower. 2026-11-22)
    : "NO microphones or mic stands anywhere — the singer's hands are EMPTY, open and gesturing at chest height.";
}

/* ---- THE WARDROBE IS LOCKED ----
 * The owner, 2026-11-22: "outfits are changing but - we made outfits selectable for cast in the setup and
 * avatar selection … should we lock the selected wardrobe?"
 *
 * What was happening: every cast member is first "styled into the genre" — one picture of them that all
 * their scenes are then drawn from. That styling prompt carried the genre's look, and the looks say what
 * to WEAR ("fashionable wardrobe", "sharp designer streetwear"). So with "Own look" picked, a presenter
 * in a navy suit came out in a sequin bomber in one video and a black blazer in the next; and an outfit
 * the maker had generated and approved in the wardrobe row went to the render as its DESCRIPTION only,
 * to be drawn again from scratch.
 *
 * Now what is picked is what is worn: the styling keeps exactly the clothes in the picture it is given —
 * the presenter's own picture, or the approved picture of the outfit — the genre's look no longer speaks
 * about clothes, and the scene prompts say each person is dressed as in their reference picture. */

/** A genre's look WITHOUT what it says about clothes: the places and the finish stay. */
export function lookWithoutWardrobe(look: string): string {
  const PLACE = /\b(stage|studio|rooftop|interior|street|loft|lounge|club|bar|setting|music video)\b/i;
  const CLOTHES = /\b(wardrobe|streetwear|fashion\w*|outfits?|attire|dressed|clothes|clothing|stylish)\b/i;
  return (look || "").split(/\s*;\s*/).filter((part) => part.trim() && (!CLOTHES.test(part) || PLACE.test(part))).join("; ");
}

/** HOW A CAST MEMBER IS DRESSED INTO THE GENRE — the one picture every scene of theirs is drawn from.
 *  `outfit` = the outfit the maker picked for them, in words ("" = their own look); `outfitPictured` =
 *  the picture being edited already shows them in it (the approved outfit picture). The clothes rule
 *  comes FIRST, then how they are framed (their face has to be big enough to draw every scene from),
 *  then the genre's places: the picture call reads STYLE_PROMPT_MAX characters, and the end of this
 *  prompt is what it loses. */
export const STYLE_PROMPT_MAX = 700;
export function castStylePrompt(o: { genreLabel: string; look: string; perform?: string; outfit?: string; outfitPictured?: boolean; realism?: string }): string {
  const outfit = (o.outfit || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const dressed = outfit && !o.outfitPictured
    // an outfit that was described but never drawn: the words are all there is to go on
    ? `Keep this EXACT person's face and identity identical — same face, hair, skin and build; do NOT swap them for anyone else. Dress them in ${outfit} — that outfit and no other.`
    : `Keep this EXACT person identical — same face, hair, skin and build — and keep EXACTLY the clothes they wear in this picture${outfit ? ` (${outfit})` : ""}: same garments, colours and accessories. Do NOT restyle or re-dress them, and do NOT swap them for anyone else.`;
  // (hands empty: styled onto "a sleek stage", a co-star came back holding a microphone — and every scene
  //  of theirs is drawn from this picture; 2026-11-22)
  // (framed from the knees up: left to itself one styling came back a small figure on a huge stage,
  //  and a face that small cannot carry a likeness into the scenes)
  const shot = `Their hands are empty — no microphone. Make it a realistic ${o.genreLabel} music-video shot of them${o.perform ? `, who ${o.perform}, to camera` : ""} — framed from the knees up, the face clear and sharp, with a natural, genuine expression${o.perform ? " that fits the song (never angry or snarling)" : ""}.`;
  return `${dressed} ${shot} ${lookWithoutWardrobe(o.look)}. ${o.realism || ""}`.replace(/\s+/g, " ").trim();
}

/** The still for a shot that has the artist AND co-stars in it. Reference image 1 is the artist; 2 (and
 *  3) the co-stars, in that order. Everything the model must get right comes before the setting, and the
 *  whole thing stays under CAST_PROMPT_MAX so none of it is cut off. (880: a ride in a car needs its own
 *  longer framing and the sit-in-your-seat rule, and at 760 they left the setting 110 characters; the
 *  picture call itself reads up to 900.) */
export const CAST_PROMPT_MAX = 880;
/** How the people of a CUT SCENE are told to dress — the locked wardrobe, in so many words… */
export const CUT_SCENE_DRESSED = "each with their own face and hair, and each DRESSED EXACTLY as in their reference image — the same garments, the same colours";
/** …said only while the setting keeps at least this much room to be read. */
export const CUT_SCENE_SETTING_MIN = 150;
export function castStillPrompt(o: {
  /** e.g. "Rap / Hip-Hop" */
  genre: string;
  role: ShotRole;
  /** the framing, in a few words ("medium-wide shot, everyone from the knees up") */
  frame: string;
  /** the scene's setting, as written */
  visual: string;
  /** how many co-stars are in the shot (1 or 2) */
  costars: number;
  micOk: boolean;
  /** anything that must also be in the shot (the prop clause) */
  extra?: string;
}): string {
  const k = Math.max(1, Math.min(MAX_COSTARS, o.costars));
  const n = k + 1;
  const others = k === 1 ? `the other person (the ${ORDINALS[1]} reference image)` : `the other two (the ${ORDINALS[1]} and ${ORDINALS[2]} reference images)`;
  const performing = o.role === "perform";
  // (THE WARDROBE IS LOCKED in a cut scene too. "each with their own face, hair and clothes" was not
  //  enough: a two-person cut scene came back re-dressed — the live render of 2026-11-22. It is said
  //  plainly wherever the setting keeps room to be read; a ride in a car is framed in so many words that
  //  the plain form would cut its setting to a stub, and keeps the short one. The check LOOKS, either way.)
  const rolesWith = (dress: string): string => performing
    ? `the ARTIST (the person in the ${ORDINALS[0]} reference image) is front and centre, nearest the camera, facing it and singing; ${others} ${k === 1 ? "is" : "are"} beside and a step behind the artist, dancing to the music, mouth${k === 1 ? "" : "s"} closed, NOT singing; everyone dressed exactly as in their reference image`
    // ("each doing what the setting describes": it used to say "all moving together", and with a framing
    //  of "all of them dancing" a scene set in a car came back with the cast standing up in it — mv-sense.ts)
    : `the artist (the person in the ${ORDINALS[0]} reference image) with ${others}, each doing what the setting describes, ${dress}`;
  // ("DIFFERENT": told only the count, the model made the count with the artist twice and a co-star
  //  missing, and with two co-stars blended into one — the first live storyboard, 2026-11-21)
  const headWith = (dress: string): string => `A photoreal frame from a real ${o.genre} music video. EXACTLY ${COUNT_WORD[n]} DIFFERENT people, each shown ONCE: ${rolesWith(dress)}. ${micLine(o.micOk, performing)} ${o.frame.replace(/[.\s]+$/, "")}.`;
  const tail = (o.extra || "").trim().replace(/[.\s]+$/, "");
  const roomWith = (h: string): number => CAST_PROMPT_MAX - h.length - tail.length - 12;
  const plain = headWith(CUT_SCENE_DRESSED);
  const head = performing || roomWith(plain) >= CUT_SCENE_SETTING_MIN ? plain : headWith("each with their own face, hair and clothes");
  const room = Math.max(80, roomWith(head));
  // (no closing full stop: the picture call adds its own before the identity lock)
  return `${head} Setting: ${cutAtWord(o.visual, room).replace(/[.\s]+$/, "")}${tail ? `. ${tail}` : ""}`;
}

/** The still for a shot of the artist ALONE that is composed from their reference picture (any shape).
 *  The artist appears once — a wide shot otherwise sometimes grew a second copy of them — and the
 *  microphone rule is said before the setting, where it is read. */
export function soloStillPrompt(o: { genre: string; role: ShotRole; frame: string; visual: string; micOk: boolean; extra?: string }): string {
  const performing = o.role === "perform";
  const head = `A photoreal frame from a real ${o.genre} music video of the artist (the person in the reference image, dressed exactly as in it), who appears ONCE — never a twin or second copy of them${performing ? "; they face the camera, singing" : ""}. ${micLine(o.micOk, performing)} Composed as ${o.frame.replace(/[.\s]+$/, "")}.`;
  const tail = (o.extra || "").trim().replace(/[.\s]+$/, "");
  const room = Math.max(80, CAST_PROMPT_MAX - head.length - tail.length - 12);
  return `${head} Setting: ${cutAtWord(o.visual, room).replace(/[.\s]+$/, "")}${tail ? `. ${tail}` : ""}`;
}

/** The same shot made the other way: the artist's own picture EDITED into the scene (the upright path the
 *  approved videos were made on). Who they are, the microphone rule, the framing, then as much of the
 *  setting as fits — it used to lose most of a long setting to the length limit, mid-sentence. */
export const SOLO_EDIT_MAX = 860;
export function soloEditPrompt(o: { role: ShotRole; frame: string; visual: string; micOk: boolean; extra?: string }): string {
  const performing = o.role === "perform";
  // (on a stage the model, left to itself, holds the microphone right at the mouth — and the mouth is what
  //  the lip-sync has to move; seen on the first test still, 2026-11-21)
  const mic = o.micOk && performing ? " If they hold a microphone it stays LOW at the chest — the mouth fully visible." : " NO microphone anywhere.";
  // ("whatever the setting says": the wardrobe is locked, and a setting that mentioned a jacket had dressed
  //  the singer in it)
  const head = `Keep this EXACT person identical — same face, hair, skin, build, and the clothes and jewelry of this picture whatever the setting says they wear; do NOT swap them for a different person.${mic} Compose the shot as ${o.frame.replace(/[.\s]+$/, "")}, in this setting: `;
  const tail = (o.extra || "").trim();
  const room = Math.max(90, Math.min(300, SOLO_EDIT_MAX - head.length - tail.length - 4));
  return `${head}${cutAtWord(o.visual, room).replace(/[.\s]+$/, "")}.${tail ? ` ${tail}` : ""}`.slice(0, SOLO_EDIT_MAX);
}

/** What the vision check read off a still: people in the foreground; for each cast member in the order
 *  of their reference pictures, whether someone matching them is there (`seen`); whether anyone is in it
 *  twice or is a blend of two of them (`twin`); who holds a microphone; whether anybody is doing
 *  something no real person could be filmed doing there (`odd` — two of the cast were drawn standing up
 *  in the back of a moving convertible: the first featured-verse video, 2026-11-22); and — when the scene
 *  has a prop — whether the prop can be seen. */
export type CastCheck = {
  people: number; mic: "none" | "front" | "other" | "several"; seen?: boolean[]; twin?: boolean; odd?: boolean; prop?: boolean;
  /** THE WARDROBE IS LOCKED — and looked at: for each cast member, in the order of their reference pictures,
   *  whether they wear what their picture wears. The styling kept everyone's clothes and the prompt asked
   *  for them, and a two-person cut scene still came back with the star in a patterned bomber and his
   *  co-star in a sequin dress and a white coat (the live render of 2026-11-22; scenes either side of it
   *  were right). The check read faces and hair, passed it, and it was rendered. */
  dressed?: boolean[];
};

/** The question put to the vision model about a cast still. The frame is the FIRST image it is shown;
 *  `refs` more follow — the cast's reference pictures, in order — when the check is to say WHO is there
 *  and not only how many (a count of three passed a picture with the artist in it twice and a co-star
 *  missing, and another where two co-stars had been blended into one woman: the first live storyboard,
 *  2026-11-21). `prop` = the thing that must also be in the picture. */
export function castCheckPrompt(o: { refs?: number; prop?: string } = {}): string {
  const p = (o.prop || "").trim();
  const n = Math.max(0, Math.min(3, Math.round(o.refs || 0)));
  const who = n
    ? `The FIRST image is a frame from a music video. The ${n === 1 ? "image after it is the one person" : `${COUNT_WORD[n]} images after it are the ${COUNT_WORD[n]} people`} who must be in it (person 1 is the 2nd image${n > 1 ? ", person 2 the 3rd" : ""}${n > 2 ? ", person 3 the 4th" : ""}). Go only by what can be seen: hair (colour, length, style), facial hair, build, apparent age and clothing.\n`
    : `Look at this music-video frame.\n`;
  return (
    who +
    `Count the people who are clearly IN the frame as its subjects — in the foreground or mid-ground, recognisable. Do NOT count an audience, a crowd, silhouettes, or small blurred figures far in the background.\n` +
    (n ? `For each of the ${COUNT_WORD[n]} people, in order: is someone matching them in the frame?\nIs anyone in the frame there TWICE (a twin or copy of the same person), or a BLEND of two of them (one person's hair on another's clothes)?\n` : "") +
    // (the wardrobe is locked: the same clothes in every scene. The question is about the KIND of garment,
    //  not its colour: tried on the stills of a real storyboard, "the same colours" called a green velvet
    //  suit wrong because blue light made it look teal — and a false alarm redraws a good picture and
    //  flags it. A bomber for a suit jacket, a dress for a trouser suit, an added coat: that is the drift.)
    (n ? `For each of the ${COUNT_WORD[n]} people, in order: are they wearing the SAME OUTFIT as in their own image? Judge the KIND of garments, not their colour — coloured light, shadow and distance change how a colour looks, so an outfit that looks darker, bluer or warmer here is still the same outfit. Answer false only when a garment is plainly a different kind (a bomber or casual jacket where their image has a tailored suit jacket; a dress or skirt where it has trousers; jeans where it has suit trousers) or something big has been added or taken away (a coat, a hat). If they are small, far away or partly hidden and you cannot tell, answer true. If they are not in the frame, answer true.\n` : "") +
    `Say who is HOLDING a microphone (a mic on an empty stand that nobody holds counts as none).\n` +
    `Is anybody doing something a real person could NOT really be filmed doing there — standing, walking or dancing in or on a car or other vehicle (people in a vehicle sit in its seats), floating, a body passing through something solid, or standing on a ledge, an unrailed roof edge or a glass floor over a drop?\n` +
    (p ? `Say whether a real, recognisable ${p} is clearly visible.\n` : "") +
    `Reply with ONLY this JSON: {"people": <number>${n ? `, "seen": [${Array.from({ length: n }, () => "true | false").join(", ")}], "twin": true | false, "dressed": [${Array.from({ length: n }, () => "true | false").join(", ")}]` : ""}, "mic": "none" | "front" | "other" | "several", "odd": true | false${p ? `, "prop": true | false` : ""}}\n` +
    `"front" = only the person who is front-and-centre / nearest the camera holds one. "other" = someone else holds one and the front person does not. "several" = more than one person holds one.`
  );
}

/** Read the vision model's answer (JSON, possibly with words around it). Null when it can't be read. */
export function parseCastCheck(raw: string): CastCheck | null {
  const m = /\{[^{}]*\}/.exec(raw || "");
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { people?: unknown; mic?: unknown; prop?: unknown; seen?: unknown; twin?: unknown; odd?: unknown; dressed?: unknown };
    const people = Number(j.people);
    const mic = String(j.mic || "").toLowerCase();
    if (j.people == null || !Number.isFinite(people) || people < 0 || people > 20) return null;
    if (mic !== "none" && mic !== "front" && mic !== "other" && mic !== "several") return null;
    const flags = (v: unknown): boolean[] | undefined => (Array.isArray(v) && v.length <= 3 && v.every((x) => typeof x === "boolean") ? (v as boolean[]) : undefined);
    const seen = flags(j.seen), dressed = flags(j.dressed);
    return { people: Math.round(people), mic, ...(seen ? { seen } : {}), ...(typeof j.twin === "boolean" ? { twin: j.twin } : {}), ...(dressed ? { dressed } : {}), ...(typeof j.odd === "boolean" ? { odd: j.odd } : {}), ...(typeof j.prop === "boolean" ? { prop: j.prop } : {}) };
  } catch { return null; }
}

/** How wrong a still is, 0 = right: the people it should have (`expectPeople` null = a wide shot where
 *  they are too small to count); every cast member there, each once and nobody blended; nobody doing the
 *  physically impossible; a microphone only where one belongs and only in the singer's hand; and the prop
 *  when the scene has one. A missing or doubled person — or one standing up in a moving car — is worse
 *  than a stray mic. */
export function castFaults(c: CastCheck, expectPeople: number | null, micOk: boolean, performing: boolean, wantProp = false): number {
  const count = expectPeople == null || c.people === expectPeople ? 0 : 2 + Math.min(3, Math.abs(c.people - expectPeople));
  const missing = expectPeople == null ? 0 : 3 * (c.seen || []).filter((s) => s === false).length;
  const twin = expectPeople != null && c.twin === true ? 3 : 0;
  // (someone in the wrong clothes — counted only for someone who IS there, and only in a shot where the
  //  people are big enough to read: a missing person is already counted, and worse)
  const redressed = expectPeople == null ? 0 : 2 * redressedIn(c).length;
  const odd = c.odd === true ? 3 : 0;
  const micWrong = c.mic === "none" ? 0 : c.mic === "front" && micOk && performing ? 0 : c.mic === "front" ? 1 : 2;
  const propGone = wantProp && c.prop === false ? 2 : 0;
  return count + missing + twin + redressed + odd + micWrong + propGone;
}

/** Which of the cast (0 = the first reference picture) are in the still but NOT in their own clothes. */
export function redressedIn(c: CastCheck): number[] {
  return (c.dressed || []).map((d, k) => (d === false && (c.seen || [])[k] !== false ? k : -1)).filter((k) => k >= 0);
}

/** What to tell the picture model when a still came back wrong and is being made again: the fault, named. */
export function castFix(c: CastCheck, expectPeople: number | null, micOk: boolean, performing: boolean, prop?: string): string {
  const out: string[] = [];
  const gone = expectPeople == null ? [] : (c.seen || []).map((s, k) => (s === false ? ORDINALS[k] : "")).filter(Boolean);
  if (gone.length) out.push(`The person in the ${gone.join(" and ")} reference image is MISSING — put them in, with their own face, hair and clothes`);
  if (expectPeople != null && c.twin === true) out.push(`Nobody appears twice and no two people are blended into one — ${COUNT_WORD[expectPeople] || expectPeople} DIFFERENT people`);
  if (!gone.length && expectPeople != null && c.people < expectPeople) out.push(`ALL ${COUNT_WORD[expectPeople] || expectPeople} people must be clearly visible — leave nobody out`);
  if (expectPeople != null && c.people > expectPeople) out.push(`ONLY ${COUNT_WORD[expectPeople] || expectPeople} people — no extra person and no copy of anyone`);
  const wrongClothes = expectPeople == null ? [] : redressedIn(c).map((k) => ORDINALS[k]).filter(Boolean);
  if (wrongClothes.length) out.push(`The person in the ${wrongClothes.join(" and ")} reference image is in the WRONG CLOTHES — dress them EXACTLY as in their reference image: the same garments, the same colours, nothing added`);
  if (c.odd === true) out.push("Everyone does something a real person could really be filmed doing: people in a vehicle SIT in its seats — nobody stands, walks or dances in or on it; up high, everyone is on solid floor back from the edge, behind a wall or railing");
  if (c.mic !== "none" && !(c.mic === "front" && micOk && performing)) out.push(micOk && performing ? "ONLY the artist holds a microphone — nobody else" : "Remove every microphone");
  if (prop && c.prop === false) out.push(`The ${prop} must be clearly visible`);
  return out.join(". ");
}

/** What the VIDEO model is told about the people in a shot it is about to animate. `costars` = how many
 *  are in the still beside the artist. */
export function castMotionLine(costars: number, performing: boolean): string {
  const k = Math.max(0, Math.min(MAX_COSTARS, costars));
  if (!k) return "";
  const n = k + 1;
  return performing
    ? ` The artist — front and centre — is the ONLY one singing: only the artist's mouth forms the words. The ${k === 1 ? "other person dances" : "other two dance"} and move${k === 1 ? "s" : ""} to the beat with ${k === 1 ? "their mouth" : "their mouths"} closed and never sing${k === 1 ? "s" : ""}. The same ${COUNT_WORD[n]} people stay in frame the whole time — nobody appears, vanishes or is duplicated.`
    : ` The same ${COUNT_WORD[n]} people stay in frame the whole time — nobody appears, vanishes or is duplicated — and nobody sings.`;
}

/** The video model must not invent a microphone (it loves to hand a singer one), and must not take away
 *  one that the still already shows. */
export const MIC_MOTION_LINE = " Do NOT add a microphone: if none is visible in the first frame, there is none in the whole shot. If the singer already holds one, they keep holding it the same way, low and clear of the mouth.";
/** The same rule for a cut scene, where nobody sings. */
export const NO_NEW_MIC_LINE = " Do NOT add a microphone that is not already in the first frame.";
