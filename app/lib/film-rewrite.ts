/* A DIRECTOR'S NOTE — one scene of an acted film, rewritten in one tap.
 *
 * The owner, 2026-11-25, of the script editor: "Scene design also comes across as fucking boring and a
 * chore". It was a form: to change a scene you retyped it, text box by text box. A director does not retype
 * a scene; a director says "scarier", "shorter", "again" — and the writer goes away and comes back with it.
 * So under every scene on the board (components/film/SceneBoard.tsx) there is a row of notes: the genre's
 * own four (film-genres.ts → notesOf) and "New take". A tap sends the WHOLE script, the one scene, and the
 * note to the writer, and that scene's lines come back rewritten. Most people will never type.
 *
 * This file is what the writer is told and what is taken back from it (plain logic —
 * tests/film-kit.test.ts); the call is film-rewrite.server.ts.
 *
 * WHAT NEVER BENDS, whatever the note says — each of these is a way a rewritten scene would break the film
 * that is made from it:
 *   the same speakers        an acted film shows two people in a place, and only those two can be heard
 *                            (dialogue-cast.ts: a line by anybody else comes out of the wrong mouth)
 *   the same place           the place is a picture already (and a sketch on the board): the lines cannot
 *                            move the scene somewhere else
 *   the same number, ±1      every line is one shot: the film's length and its price are the count
 *   ten seconds a line       a shot is at most ten seconds (speech-meter.ts); a longer line is cut off
 *   only what is said        the video engine SPEAKS whatever a line holds — "(whispering)" is said aloud
 *   it still joins up        the scenes before and after were not rewritten, and still have to follow
 * The writer is told all six — and then what comes back is CHECKED (parseRewrite): a line by somebody who
 * is not in the scene, an empty line, a line far too long, or the wrong number of lines, and the whole
 * rewrite is refused and the scene stays as it was. A scene is never half taken. */

import { flowOf, parseBeat, type FlowScene } from "./film-flow.ts";
import { nameTok } from "./character-prompts.ts";
import { LINE_WORDS_MAX, LINE_WORDS_MIN, LINE_WORDS_WANT } from "./dialogue-fit.ts";
import { speakerKey } from "./dialogue-cast.ts";

/** A one-tap note: the chip's key and word, and the sentence the writer is handed. (The genres' own notes
 *  are film-genres.ts; this is their shape.) */
export type DirectorNote = { key: string; label: string; ask: string };

/** "New take" (the dice): the same moment, written again. On every scene, whatever the genre. */
export const NEW_TAKE: DirectorNote = {
  key: "newtake",
  label: "New take",
  ask: "Write this scene again from scratch: the same moment of the story and the same outcome, said a different way — new lines, a different rhythm, none of the wording above kept.",
};

/** Four notes that fit any story, for a format that has none of its own yet. */
export const GENERIC_NOTES: ReadonlyArray<DirectorNote> = [
  { key: "stakes", label: "Raise the stakes", ask: "Raise the stakes: make it plain what each of them stands to lose in this scene, and let that push every line." },
  { key: "tension", label: "More tension", ask: "More tension: they hold back more than they say, each line presses on the one before, and nothing is settled until the scene's last line." },
  { key: "shorter", label: "Shorter", ask: "Shorter: cut this scene to what cannot be lost — one line fewer if it can spare one, and every line tighter." },
  { key: "twist", label: "Add a twist", ask: "Add a twist: one of them says or reveals something in this scene that changes what the other — and the viewer — thought was going on, without breaking the scenes after it." },
];

/** The note a key names, among the ones this scene offers ("New take" is always one of them). */
export function noteByKey(notes: ReadonlyArray<DirectorNote> | null | undefined, key: unknown): DirectorNote | null {
  const k = String(key ?? "").trim();
  if (!k) return null;
  return [...(notes || []), NEW_TAKE].find((n) => n.key === k) || null;
}

export type RewriteTreatment = { title?: string; scenes: ReadonlyArray<FlowScene> };
/** What the format is, as much of it as the writer needs: its name, its promise, and whether it is for
 *  small children. */
export type RewriteTemplate = { key?: string; name?: string; brief?: string; childSafe?: boolean };
/** One rewritten line: "NAME: what they say", and how it is delivered. */
export type RewrittenLine = { caption: string; tone?: string };

const tidy = (s: unknown, max: number): string => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const CJK = /[぀-ヿ㐀-鿿가-힯]/;
const spoken = (caption: string | null | undefined): boolean => /[\p{L}\p{N}]/u.test(parseBeat(caption).line);
const sameSpeaker = (a: string, b: string): boolean => !!a && !!b && (nameTok(a) === nameTok(b) || speakerKey(a) === speakerKey(b));

/** Who may speak in a place: the people its lines are already spoken by; a place with fewer than two is
 *  filled from the film's cast — a scene is two people. */
export function speakersInPlace(scenes: ReadonlyArray<FlowScene>, placeIndex: number, speakers: ReadonlyArray<string> = []): string[] {
  const loc = flowOf(scenes)[placeIndex];
  const out: string[] = [];
  const add = (n: string) => { if (n && nameTok(n) && !out.some((o) => sameSpeaker(o, n))) out.push(speakers.find((s) => sameSpeaker(s, n)) || n); };
  if (loc) scenes.slice(loc.firstIdx, loc.lastIdx + 1).forEach((s) => add(parseBeat(s.caption).speaker));
  for (const s of speakers) { if (out.length >= 2) break; add(s); }
  return out;
}

/** The request's schema: the scene's new lines, in order — who says each, the words, and how it is said. */
export const rewriteSchema = {
  type: "object",
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: { speaker: { type: "string" }, line: { type: "string" }, tone: { type: "string" } },
        required: ["speaker", "line"],
        additionalProperties: false,
      },
    },
  },
  required: ["lines"],
  additionalProperties: false,
} as const;

/** WHAT THE WRITER IS TOLD: the whole script for context, the one scene to rewrite, the note, and the rules
 *  that never bend (the list at the top of this file, in the writer's words). */
export function rewriteBrief({ treatment, placeIndex, note, speakers, template }: {
  treatment: RewriteTreatment; placeIndex: number; note: DirectorNote; speakers: ReadonlyArray<string>; template?: RewriteTemplate | null;
}): string {
  const scenes = (treatment?.scenes || []).slice(0, 80);
  const flow = flowOf(scenes);
  const loc = flow[placeIndex];
  if (!loc) return "";
  const n = placeIndex + 1;
  const own = scenes.slice(loc.firstIdx, loc.lastIdx + 1);
  const said = own.filter((s) => spoken(s.caption));
  const k = said.length;
  // (a horror film ends on a shot nobody speaks in — acted-staging.ts, SEEN_AT_THE_END: it is not a line, and stays)
  const endsUnsaid = own.length > 0 && !spoken(own[own.length - 1].caption) && k > 0;
  const who = speakersInPlace(scenes, placeIndex, speakers);
  const isClose = (s: FlowScene): boolean => /^close-?up on\s+\S/i.test(tidy(s.shot, 80));
  const hasClose = own.some(isClose);
  let num = 0;
  const sheet = flow.map((l, li) => {
    const head = `SCENE ${li + 1} — ${tidy(l.where, 160)}${li === placeIndex ? "   <<< THE SCENE TO REWRITE" : ""}`;
    const body = scenes.slice(l.firstIdx, l.lastIdx + 1).map((s) => {
      num += 1;
      const line = spoken(s.caption) ? tidy(s.caption, 400) : "(no line — this shot is seen, not said)";
      // what is DONE while the line is spoken is shown for the scene being rewritten: the new lines have to fit it
      const seen = li === placeIndex && tidy(s.visual, 300) && tidy(s.visual, 300) !== tidy(l.where, 160) ? `   [what we see: ${tidy(s.visual, 300)}]` : "";
      // (a close-up the maker cut to is ON somebody: the line filmed in it has to stay theirs)
      const close = li === placeIndex && isClose(s) ? `   [${tidy(s.shot, 80)}]` : "";
      return `${num}. ${line}${seen}${close}`;
    }).join("\n");
    return `${head}\n${body}`;
  }).join("\n\n");
  const lastSaid = (l: (typeof flow)[number] | undefined, first: boolean): string => {
    if (!l) return "";
    const lines = scenes.slice(l.firstIdx, l.lastIdx + 1).filter((s) => spoken(s.caption));
    return tidy((first ? lines[0] : lines[lines.length - 1])?.caption, 400);
  };
  const before = lastSaid(flow[placeIndex - 1], false);
  const after = lastSaid(flow[placeIndex + 1], true);
  const joins = before && after
    ? `the scene before it ends on "${before}" and the scene after it opens on "${after}" — the rewritten scene starts from the one and hands over to the other`
    : before ? `the scene before it ends on "${before}" — the rewritten scene starts from there, and it is where the film ENDS: its last line lands the story`
    : after ? `it is where the film OPENS, and the scene after it opens on "${after}" — the rewritten scene still sets that up`
    : `it is the whole film: it still opens the story and lands its ending`;
  const lo = Math.max(1, k - 1);
  const name = tidy(template?.name, 60);
  const promise = tidy(template?.brief, 600);
  return (
    `You are rewriting ONE scene of a short acted film${name ? ` (${name})` : ""}${treatment?.title ? ` called "${tidy(treatment.title, 100)}"` : ""}, on a note from its director.` +
    `${promise ? ` The film is ${promise}.` : ""}\n\n` +
    `THE WHOLE SCRIPT, for context — scene by scene, one speaker to a line, each written "NAME: what they say":\n\n${sheet}\n\n` +
    `THE DIRECTOR'S NOTE on scene ${n}: "${tidy(note.ask, 400)}"\n\n` +
    `Rewrite the lines of scene ${n}, and only scene ${n}, to follow the note. What never bends:\n` +
    `• THE SAME SPEAKERS — only ${who.join(" and ") || "the people already speaking in it"} speak${who.length ? `, called exactly "${who.join('" and "')}"` : ""}: one speaker to a line, and it stays a conversation — each line answers the one before it. Nobody else is heard; what anybody else said or did is reported by one of them.\n` +
    `• THE SAME PLACE — it all still happens in "${tidy(loc.where, 160)}". Nobody leaves it, and no line puts them anywhere else.\n` +
    (k > 0
      ? `• THE SAME NUMBER OF LINES, give or take one — the scene has ${k} spoken line${k === 1 ? "" : "s"} now: return ${lo} to ${k + 1}. Every line is one shot of the film.\n`
      : `• A SHORT SCENE — it has no lines yet: write 2 to 4. Every line is one shot of the film.\n`) +
    `• EVERY LINE CAN BE SAID IN TEN SECONDS — ${LINE_WORDS_MIN} to ${LINE_WORDS_WANT[1]} spoken words, and never more than ${LINE_WORDS_MAX}: a longer line is cut off at the end of its shot. Count them.\n` +
    `• ONLY WHAT IS SAID — a line is the spoken words and nothing else: no stage directions, nothing in brackets or asterisks, no "(whispering)", no sound effects, no description of what anybody does. Whatever is in a line is spoken aloud.\n` +
    `• IT STILL JOINS UP — ${joins}. Anything the other scenes rely on (a name, a thing, what somebody knows) is still true when this scene ends.\n` +
    `• WHAT WE SEE STAYS — the bracketed "what we see" beside each line of scene ${n} is what is done on screen while that shot's line is spoken, in that order: it is not rewritten, so the new lines must fit it.${hasClose ? ` A shot marked "[close-up on NAME]" is filmed on that person: its line is still theirs.` : ""}\n` +
    (endsUnsaid ? `• THE SHOT WITH NO LINE STAYS — scene ${n} ends on a shot nobody speaks in: it is not yours to write. Your last line is the last thing said before it.\n` : "") +
    `• THE SAME LANGUAGE as the lines above.\n` +
    (template?.childSafe ? `• FOR VERY YOUNG CHILDREN — happy, gentle and safe: nothing scary, sad, violent or unkind, whatever the note says.\n` : "") +
    `\nReturn "lines": scene ${n}'s new lines in order. Each has "speaker" (one of the names above, exactly), "line" (the spoken words only) and "tone" (a few words on HOW it is delivered, matching the words — "quietly, not looking up").`
  );
}

/** A line as it came back, made safe to film: anything in brackets is a stage direction and goes, and so is
 *  an asterisked aside at either end ("*sighs* I told you."); asterisks round a word in the middle are
 *  emphasis — the word stays, the asterisks go; wrapping quotes go. What is left is the words. */
function sayable(text: unknown): string {
  const flat = String(text ?? "").replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  const ends = flat.replace(/^\*[^*]*\*\s*/, "").replace(/\s*\*[^*]*\*$/, "");
  // (a whole line in asterisks is a line somebody stressed, not an aside: keep its words)
  return (/[\p{L}\p{N}]/u.test(ends) ? ends : flat)
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“”‘’«»]+|["“”‘’«»]+$/g, "")
    .trim();
}

/** The rewrite, read back — every line with its tone, or null when ANY of it cannot be used: not a list of
 *  lines, no lines, a line by somebody who is not one of `speakers`, a line with no words, a line that
 *  could not be said in a shot (over LINE_WORDS_MAX + 4 words), or — when `expect` says how many lines the
 *  scene had — a count more than one away from it. Speakers come back in the cast's own spelling. */
export function parseRewriteLines(raw: unknown, speakers: ReadonlyArray<string>, expect?: number): RewrittenLine[] | null {
  let v: unknown = raw;
  if (typeof raw === "string") { try { v = JSON.parse(raw); } catch { return null; } }
  const list = (v && typeof v === "object" ? (v as { lines?: unknown }).lines : null);
  if (!Array.isArray(list) || !list.length || list.length > 24) return null;
  if (typeof expect === "number" && expect > 0 && Math.abs(list.length - expect) > 1) return null;
  const out: RewrittenLine[] = [];
  for (const item of list) {
    let name = "";
    let text = "";
    let tone = "";
    if (typeof item === "string") {
      const p = parseBeat(item.replace(/^\s*\d+[.)]\s*/, ""));
      name = p.speaker; text = p.line;
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      name = tidy(o.speaker, 60);
      text = String(o.line ?? "");
      tone = tidy(o.tone, 120);
      // (a writer that put the label in the line as well: "ODO: Look at the glass.")
      const p = parseBeat(text);
      if (p.speaker && sameSpeaker(p.speaker, name)) text = p.line;
    } else return null;
    const who = speakers.find((s) => sameSpeaker(s, name));
    const said = sayable(text).slice(0, 400);
    if (!who || !/[\p{L}\p{N}]/u.test(said)) return null;
    if (!CJK.test(said) && (said.match(/\S+/g) || []).length > LINE_WORDS_MAX + 4) return null;
    out.push({ caption: `${who}: ${said}`, ...(tone ? { tone } : {}) });
  }
  return out;
}

/** The rewrite as the scene's new captions ("NAME: what they say"), or null — see parseRewriteLines. */
export function parseRewrite(raw: unknown, speakers: ReadonlyArray<string>, expect?: number): string[] | null {
  return parseRewriteLines(raw, speakers, expect)?.map((l) => l.caption) ?? null;
}

/** THE SCENE, REPLACED — the flat script with one place's spoken lines swapped for the rewritten ones.
 *  Nothing else moves: the place, each shot's picture and angle, every other scene. With one line more, the
 *  new shot is in the same place at the same angle as the last (as a line added by hand is); with one
 *  fewer, the place's last spoken shot goes. A shot nobody speaks in stays where it is. */
export function applyRewrite<S extends FlowScene>(scenes: ReadonlyArray<S>, placeIndex: number, lines: ReadonlyArray<RewrittenLine | string>): S[] {
  const loc = flowOf(scenes)[placeIndex];
  const next = lines.map((l) => (typeof l === "string" ? { caption: l } : l)).filter((l) => l && l.caption);
  if (!loc || !next.length) return scenes.slice();
  const own = scenes.slice(loc.firstIdx, loc.lastIdx + 1).map((s) => ((s.where || "").trim() === loc.where ? s : { ...s, where: loc.where }));
  const slots = own.map((s, i) => (spoken(s.caption) ? i : -1)).filter((i) => i >= 0);
  // (how a line was delivered goes with the line: a rewritten line that came back with no tone has none)
  const put = (s: S, l: RewrittenLine): S => {
    const o = { ...s, caption: l.caption } as S & { tone?: string };
    if (l.tone) o.tone = l.tone; else delete o.tone;
    return o;
  };
  let out: S[];
  if (!slots.length) {
    // (a place with nothing said in it yet — lines somebody added and never typed: the new lines take their
    //  place; a shot with no line at all, which is seen and not said, stays after them)
    out = [...next.map((l) => put({ ...own[0] }, l)), ...own.filter((s) => !(s.caption || "").trim())];
  } else {
    out = own.slice();
    const shared = Math.min(slots.length, next.length);
    for (let i = 0; i < shared; i++) out[slots[i]] = put(own[slots[i]], next[i]);
    if (next.length > slots.length) {
      const lastSlot = slots[slots.length - 1];
      const extra = next.slice(slots.length).map((l) => put({ ...own[lastSlot], visual: own[0]?.visual || loc.where }, l));
      out.splice(lastSlot + 1, 0, ...extra);
    } else if (next.length < slots.length) {
      const drop = new Set(slots.slice(next.length));
      out = out.filter((_, i) => !drop.has(i));
    }
  }
  return [...scenes.slice(0, loc.firstIdx), ...out, ...scenes.slice(loc.lastIdx + 1)];
}
