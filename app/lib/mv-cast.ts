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
 * Pure and import-free (types aside): the builder, the pipeline and the tests share it. */

import type { ShotRole } from "./mv-pace";

/** The most co-stars one shot holds beside the artist (three faces is what the picture model keeps apart). */
export const MAX_COSTARS = 2;

/** Does a microphone BELONG in this setting? Only a live stage or a recording booth — or a scene whose
 *  own words ask for one. Everywhere else a music video is mimed to the track, and a mic in the hand is a
 *  prop nobody asked for. */
export function micFits(visual: string | null | undefined): boolean {
  const v = visual || "";
  // "no microphone", "without a mic" — the scene says there is none
  if (/\b(?:no|without|never)\b[^.;]{0,24}\bmic(?:rophone)?s?\b/i.test(v)) return false;
  return /\b(?:on ?stage|stage|concert|live (?:show|set|gig|band|performance)|gig|festival|karaoke|(?:recording|vocal|sound) booth|mic(?:rophone)?s?)\b/i.test(v);
}

/** The SHOTLIST slot that is the dance cut scene (see music-video-pipeline.server.ts). */
export const DANCE_SLOT = 2;

/** Which of the picked co-stars (by index) are in a scene unless the maker says otherwise:
 *   - a PERFORMANCE: all of them — they were picked to be seen with the artist;
 *   - a CUT SCENE: whoever the writer named in it; the dance cut scene has them all (they ARE the
 *     dancers); any other cut scene belongs to the artist or the scenery. */
export function defaultCostars(scene: { visual?: string; caption?: string } | undefined, role: ShotRole, slot: number, names: string[]): number[] {
  const all = names.map((_, k) => k).slice(0, MAX_COSTARS);
  if (!names.length) return [];
  if (role === "perform") return all;
  const text = `${scene?.visual || ""} ${scene?.caption || ""}`;
  const named = names
    .map((n, k) => ({ n: (n || "").trim(), k }))
    .filter((x) => x.n.length > 1 && new RegExp(`(^|[^\\p{L}])${x.n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "iu").test(text))
    .map((x) => x.k);
  if (named.length) return named.slice(0, MAX_COSTARS);
  return ((slot % 8) + 8) % 8 === DANCE_SLOT ? all : [];
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
    : "NO microphones or mic stands anywhere — nobody holds one.";
}

/** The still for a shot that has the artist AND co-stars in it. Reference image 1 is the artist; 2 (and
 *  3) the co-stars, in that order. Everything the model must get right comes before the setting, and the
 *  whole thing stays under CAST_PROMPT_MAX so none of it is cut off. */
export const CAST_PROMPT_MAX = 760;
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
  const roles = performing
    ? `the ARTIST (the person in the ${ORDINALS[0]} reference image) is front and centre, nearest the camera, facing it and singing; ${others} ${k === 1 ? "is" : "are"} beside and a step behind the artist, dancing to the music, mouth${k === 1 ? "" : "s"} closed, NOT singing`
    : `the artist (the person in the ${ORDINALS[0]} reference image) with ${others}, all moving together`;
  const head = `A photoreal frame from a real ${o.genre} music video. EXACTLY ${COUNT_WORD[n]} people, each shown ONCE: ${roles}. ${micLine(o.micOk, performing)} ${o.frame.replace(/[.\s]+$/, "")}.`;
  const tail = (o.extra || "").trim().replace(/[.\s]+$/, "");
  const room = Math.max(80, CAST_PROMPT_MAX - head.length - tail.length - 12);
  // (no closing full stop: the picture call adds its own before the identity lock)
  return `${head} Setting: ${cutAtWord(o.visual, room).replace(/[.\s]+$/, "")}${tail ? `. ${tail}` : ""}`;
}

/** The still for a shot of the artist ALONE that is composed from their reference picture (any shape).
 *  The artist appears once — a wide shot otherwise sometimes grew a second copy of them — and the
 *  microphone rule is said before the setting, where it is read. */
export function soloStillPrompt(o: { genre: string; role: ShotRole; frame: string; visual: string; micOk: boolean; extra?: string }): string {
  const performing = o.role === "perform";
  const head = `A photoreal frame from a real ${o.genre} music video of the artist (the person in the reference image), who appears ONCE — never a twin or second copy of them${performing ? "; they face the camera, singing" : ""}. ${micLine(o.micOk, performing)} Composed as ${o.frame.replace(/[.\s]+$/, "")}.`;
  const tail = (o.extra || "").trim().replace(/[.\s]+$/, "");
  const room = Math.max(80, CAST_PROMPT_MAX - head.length - tail.length - 12);
  return `${head} Setting: ${cutAtWord(o.visual, room).replace(/[.\s]+$/, "")}${tail ? `. ${tail}` : ""}`;
}

/** The same shot made the other way: the artist's own picture EDITED into the scene (the upright path the
 *  approved videos were made on). Who they are, the microphone rule, the framing, then as much of the
 *  setting as fits — it used to lose most of a long setting to the length limit, mid-sentence. */
export const SOLO_EDIT_MAX = 700;
export function soloEditPrompt(o: { role: ShotRole; frame: string; visual: string; micOk: boolean; extra?: string }): string {
  const performing = o.role === "perform";
  // (on a stage the model, left to itself, holds the microphone right at the mouth — and the mouth is what
  //  the lip-sync has to move; seen on the first test still, 2026-11-21)
  const mic = o.micOk && performing ? " If they hold a microphone it stays LOW at the chest — the mouth fully visible." : " NO microphone anywhere.";
  const head = `Keep this EXACT person identical — same face, hair, skin, build, wardrobe and jewelry; do NOT swap them for a different person.${mic} Compose the shot as ${o.frame.replace(/[.\s]+$/, "")}, in this setting: `;
  const tail = (o.extra || "").trim();
  const room = Math.max(90, Math.min(300, SOLO_EDIT_MAX - head.length - tail.length - 4));
  return `${head}${cutAtWord(o.visual, room).replace(/[.\s]+$/, "")}.${tail ? ` ${tail}` : ""}`.slice(0, SOLO_EDIT_MAX);
}

/** What the vision check read off a still: people in the foreground, who holds a microphone, and — when
 *  the scene has a prop — whether the prop can be seen. */
export type CastCheck = { people: number; mic: "none" | "front" | "other" | "several"; prop?: boolean };

/** The question put to the vision model about a cast still (`prop` = the thing that must also be in it). */
export function castCheckPrompt(prop?: string): string {
  const p = (prop || "").trim();
  return (
    `Look at this music-video frame. Count the people who are clearly IN the shot as its subjects — in the foreground or mid-ground, recognisable. Do NOT count an audience, a crowd, silhouettes, or small blurred figures far in the background.\n` +
    `Then say who is HOLDING a microphone (a mic on an empty stand that nobody holds counts as none).\n` +
    (p ? `Then say whether a real, recognisable ${p} is clearly visible.\n` : "") +
    `Reply with ONLY this JSON: {"people": <number>, "mic": "none" | "front" | "other" | "several"${p ? `, "prop": true | false` : ""}}\n` +
    `"front" = only the person who is front-and-centre / nearest the camera holds one. "other" = someone else holds one and the front person does not. "several" = more than one person holds one.`
  );
}

/** Read the vision model's answer (JSON, possibly with words around it). Null when it can't be read. */
export function parseCastCheck(raw: string): CastCheck | null {
  const m = /\{[^{}]*\}/.exec(raw || "");
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { people?: unknown; mic?: unknown; prop?: unknown };
    const people = Number(j.people);
    const mic = String(j.mic || "").toLowerCase();
    if (j.people == null || !Number.isFinite(people) || people < 0 || people > 20) return null;
    if (mic !== "none" && mic !== "front" && mic !== "other" && mic !== "several") return null;
    return { people: Math.round(people), mic, ...(typeof j.prop === "boolean" ? { prop: j.prop } : {}) };
  } catch { return null; }
}

/** How wrong a still is, 0 = right: the people it should have (`expectPeople` null = a wide shot where
 *  they are too small to count), a microphone only where one belongs and only in the artist's hand, and
 *  the prop when the scene has one. The wrong head-count is worse than a stray mic. */
export function castFaults(c: CastCheck, expectPeople: number | null, micOk: boolean, performing: boolean, wantProp = false): number {
  const count = expectPeople == null || c.people === expectPeople ? 0 : 2 + Math.min(3, Math.abs(c.people - expectPeople));
  const micWrong = c.mic === "none" ? 0 : c.mic === "front" && micOk && performing ? 0 : c.mic === "front" ? 1 : 2;
  const propGone = wantProp && c.prop === false ? 2 : 0;
  return count + micWrong + propGone;
}

/** What to tell the picture model when a still came back wrong and is being made again: the fault, named. */
export function castFix(c: CastCheck, expectPeople: number | null, micOk: boolean, performing: boolean, prop?: string): string {
  const out: string[] = [];
  if (expectPeople != null && c.people < expectPeople) out.push(`ALL ${COUNT_WORD[expectPeople] || expectPeople} people must be clearly visible — leave nobody out`);
  if (expectPeople != null && c.people > expectPeople) out.push(`ONLY ${COUNT_WORD[expectPeople] || expectPeople} people — no extra person and no copy of anyone`);
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
