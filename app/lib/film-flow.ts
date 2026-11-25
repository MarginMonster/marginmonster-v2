/* THE SCRIPT AS PLACES — an acted film's flat list of shots, grouped the way a person reads it.
 *
 * A script is a flat list of shots; each shot is one spoken line ("NAME: what they say") with the place it
 * happens in (`where`) and, when the maker added one by hand, a camera angle (`shot`). To be read — and
 * directed — it is grouped: consecutive shots in the same place are one PLACE (a scene on the board), and
 * inside a place consecutive shots at the same angle are one ANGLE (the first is the place's own take; a
 * later one is a close-up the maker cut to).
 *
 * All of this lived inline in the Movie Maker's one big component (routes/web.film.tsx, "Each beat carries
 * where (location) + shot (camera angle)…"), where nothing could test it and nothing else could use it. It
 * is copied out here AS IT STOOD on 2026-11-25 — same grouping, same edits, same words put into a new line —
 * because the script editor is being rebuilt as a board (components/film/SceneBoard.tsx; the owner, that
 * morning, of the old one: "Scene design also comes across as fucking boring and a chore") and the board
 * and the page have to agree on what a place is, to the index. tests/film-kit.test.ts holds every function
 * here against the page's own code on the same scripts.
 *
 * EVERY EDIT IS A FUNCTION FROM THE FLAT LIST TO A NEW FLAT LIST. The page keeps the script in state and
 * posts it as it is (approvedTreatment), so an edit that returned anything else would have to be undone
 * before the film is made. A scene index is always an index into the FLAT list; a place index is an index
 * into flowOf(scenes).
 *
 * Two edits are NEW: a place can be moved earlier or later (movePlace) and removed whole (removePlace).
 *
 * Plain logic: no React, nothing from the server. */

import { nameTok } from "./character-prompts.ts";

/** What the board needs of a shot. The page's own Scene has more fields (a music video's `kind`, `singer`);
 *  every function here is generic over them and hands them back untouched. */
export type FlowScene = { visual: string; caption?: string; where?: string; shot?: string; tone?: string };

/** One spoken line, by its place in the flat list. */
export type FlowBeat = { idx: number; speaker: string; line: string };
/** The lines of a place that are filmed at one angle. `lastIdx` is where a new line of it goes after. */
export type FlowAngle = { shot: string; beats: FlowBeat[]; lastIdx: number };
/** A place: the run of shots set there, as its angles. */
export type FlowLoc = { where: string; firstIdx: number; lastIdx: number; angles: FlowAngle[] };

/** The angle of a shot that names none: the place's own take. */
export const WIDE = "wide two-shot";

/** "NAME: what they say" → its two parts. A line with no label has no speaker. */
export const parseBeat = (cap?: string | null): { speaker: string; line: string } => {
  const m = (cap || "").match(/^\s*([^:]{1,40}):\s*([\s\S]*)$/);
  return m ? { speaker: m[1].trim(), line: m[2].trim() } : { speaker: "", line: (cap || "").trim() };
};

/** The place a shot is in: its own `where`; with none, the place before it; with none of those, the first
 *  clause of what is seen; and a script that says nothing at all is still somewhere. */
export const whereOf = (s: FlowScene, prev: string): string =>
  (s.where || "").trim() || prev || (s.visual || "").split(/[.;]/)[0].trim().slice(0, 80) || "A cinematic location";

/** The script, grouped: places → angles → lines. */
export function flowOf(scenes: ReadonlyArray<FlowScene> | null | undefined): FlowLoc[] {
  const locs: FlowLoc[] = [];
  let prevWhere = "";
  (scenes || []).forEach((s, idx) => {
    const where = whereOf(s, prevWhere);
    prevWhere = where;
    const shot = (s.shot || "").trim() || WIDE;
    let loc = locs[locs.length - 1];
    if (!loc || loc.where !== where) { loc = { where, firstIdx: idx, lastIdx: idx, angles: [] }; locs.push(loc); }
    loc.lastIdx = idx;
    let ang = loc.angles[loc.angles.length - 1];
    if (!ang || ang.shot !== shot) { ang = { shot, beats: [], lastIdx: idx }; loc.angles.push(ang); }
    ang.lastIdx = idx;
    const { speaker, line } = parseBeat(s.caption);
    ang.beats.push({ idx, speaker, line });
  });
  return locs;
}

/** Who speaks, in the order the board deals sides by: the cast's own spelling of each name first, then
 *  anybody the script has speaking who is not in the cast. One entry per person (told apart by nameTok). */
export function speakersOf(scenes: ReadonlyArray<FlowScene> | null | undefined, castNames: ReadonlyArray<string | null | undefined> = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (nm: string) => { const k = nameTok(nm); if (nm && k && !seen.has(k)) { seen.add(k); out.push(nm); } };
  castNames.forEach((n) => n && add(n));
  (scenes || []).forEach((s) => { const sp = parseBeat(s.caption).speaker; if (sp) add(sp); });
  return out;
}

/** The speaker after this one (round the cast); with nobody to choose from, the same one. */
export function nextSpeaker(cur: string, speakers: ReadonlyArray<string>): string {
  if (!speakers.length) return cur;
  const i = speakers.findIndex((n) => nameTok(n) === nameTok(cur));
  return speakers[((i < 0 ? -1 : i) + 1) % speakers.length];
}

/** Which side of the conversation a speaker's lines sit on. The second of the cast answers from the right;
 *  with more than two, they alternate in cast order. Somebody the cast does not know is on the left. */
export function sideOf(speaker: string, speakers: ReadonlyArray<string>): "left" | "right" {
  const i = speakers.findIndex((n) => nameTok(n) === nameTok(speaker));
  return i > 0 && i % 2 === 1 ? "right" : "left";
}

/** Is this the place a scene is in? A backdrop's key as a WHOLE WORD of the scene's `where` — a lighthouse
 *  lit up the "Old house" chip, and a carpark would have lit "Car" and "Park" (seen 2026-11-22). */
export const backdropIs = (where: string, key: string): boolean =>
  !!key && new RegExp(`(^|[^a-z])${key.replace(/[^a-z0-9]/gi, "")}([^a-z]|$)`, "i").test(where || "");

/** Seconds as a clock: 26 → "0:26", 90 → "1:30", 300 → "5:00". */
export function filmClock(seconds: number): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* ---- the edits ------------------------------------------------------------------------------------- */

const insertAt = <S>(ss: ReadonlyArray<S>, at: number, s: S): S[] => {
  const out = ss.slice();
  out.splice(Math.min(Math.max(0, at), out.length), 0, s);
  return out;
};
const locOf = (flow: FlowLoc[], idx: number): FlowLoc | undefined => flow.find((l) => idx >= l.firstIdx && idx <= l.lastIdx);
const angOf = (loc: FlowLoc | undefined, idx: number): FlowAngle | undefined => loc?.angles.find((a) => a.beats.some((b) => b.idx === idx));

/** What is said in one shot. (A line that had no speaker gets the first of the cast, as the page gave it.) */
export function setLine<S extends FlowScene>(scenes: ReadonlyArray<S>, idx: number, line: string, speakers: ReadonlyArray<string>): S[] {
  return scenes.map((s, j) => (j === idx ? { ...s, caption: `${parseBeat(s.caption).speaker || speakers[0] || "Name"}: ${line}` } : s));
}

/** Who says one shot's line. */
export function setSpeaker<S extends FlowScene>(scenes: ReadonlyArray<S>, idx: number, name: string): S[] {
  return scenes.map((s, j) => (j === idx ? { ...s, caption: `${name}: ${parseBeat(s.caption).line}` } : s));
}

/** A tap on a line's face or name: the next of the cast says it. */
export function cycleSpeaker<S extends FlowScene>(scenes: ReadonlyArray<S>, idx: number, speakers: ReadonlyArray<string>): S[] {
  const s = scenes[idx];
  return s ? setSpeaker(scenes, idx, nextSpeaker(parseBeat(s.caption).speaker, speakers)) : scenes.slice();
}

/** "+ line": a new, empty line after the last one of the angle shot `idx` is in — at that angle, in that
 *  place, for whoever did not speak last. */
export function addLine<S extends FlowScene>(scenes: ReadonlyArray<S>, idx: number, speakers: ReadonlyArray<string>): S[] {
  const loc = locOf(flowOf(scenes), idx);
  const ang = angOf(loc, idx);
  if (!loc || !ang) return scenes.slice();
  const base = scenes[loc.firstIdx];
  const prevSpk = ang.beats[ang.beats.length - 1]?.speaker || speakers[0] || "";
  return insertAt(scenes, ang.lastIdx + 1, { visual: base?.visual || loc.where, where: loc.where, shot: ang.shot, caption: `${nextSpeaker(prevSpk, speakers)}: ` } as S);
}

/** "close-up": the place shot `idx` is in cuts to a close-up on the first of the cast, with one empty line —
 *  after everything else there. */
export function addCloseUp<S extends FlowScene>(scenes: ReadonlyArray<S>, idx: number, speakers: ReadonlyArray<string>): S[] {
  const loc = locOf(flowOf(scenes), idx);
  if (!loc) return scenes.slice();
  const base = scenes[loc.firstIdx];
  const who = speakers[0] || "Name";
  return insertAt(scenes, loc.lastIdx + 1, { visual: base?.visual || loc.where, where: loc.where, shot: `close-up on ${who}`, caption: `${who}: ` } as S);
}

/** "+ New scene": they go somewhere else. */
export function addScene<S extends FlowScene>(scenes: ReadonlyArray<S>, speakers: ReadonlyArray<string>): S[] {
  return [...scenes, { visual: "A new location", where: "A new location", shot: WIDE, caption: `${speakers[0] || "Name"}: ` } as S];
}

/** Where a place is. Every shot of it gets the new words; a shot whose picture was only the old place's
 *  name is seen in the new one. */
export function setWhere<S extends FlowScene>(scenes: ReadonlyArray<S>, placeIndex: number, where: string): S[] {
  const loc = flowOf(scenes)[placeIndex];
  if (!loc) return scenes.slice();
  return scenes.map((s, j) => (j >= loc.firstIdx && j <= loc.lastIdx ? { ...s, where, visual: s.visual && s.visual !== loc.where ? s.visual : where } : s));
}

/** What a close-up is on: every line of the angle shot `idx` is in. */
export function setAngleShot<S extends FlowScene>(scenes: ReadonlyArray<S>, idx: number, shot: string): S[] {
  const ang = angOf(locOf(flowOf(scenes), idx), idx);
  if (!ang) return scenes.slice();
  return scenes.map((s, j) => (ang.beats.some((b) => b.idx === j) ? { ...s, shot } : s));
}

/** Take a close-up away: its lines go back into the place's FIRST angle, so they rejoin the one seamless
 *  take (the only things that keep a cut are the maker's own "close-up" and a new scene). */
export function removeAngle<S extends FlowScene>(scenes: ReadonlyArray<S>, idx: number): S[] {
  const loc = locOf(flowOf(scenes), idx);
  const ang = angOf(loc, idx);
  if (!loc || !ang) return scenes.slice();
  const base = loc.angles[0]?.shot || WIDE;
  return scenes.map((s, j) => (ang.beats.some((b) => b.idx === j) ? { ...s, shot: base } : s));
}

/** Take one line out. A script keeps at least one. */
export function removeLine<S extends FlowScene>(scenes: ReadonlyArray<S>, idx: number): S[] {
  return scenes.length > 1 ? scenes.filter((_, j) => j !== idx) : scenes.slice();
}

/* A shot with no `where` of its own is in the place before it — true only while it STAYS after that place.
 * So before places change order (or one is taken out) every shot is given the place it is in, in so many
 * words; then a run of shots can go anywhere and still be the place it was. */
const pinned = <S extends FlowScene>(scenes: ReadonlyArray<S>, flow: FlowLoc[]): S[][] =>
  flow.map((loc) => scenes.slice(loc.firstIdx, loc.lastIdx + 1).map((s) => ((s.where || "").trim() === loc.where ? s : { ...s, where: loc.where })));

/** NEW (2026-11-25): move a place one earlier (-1) or one later (+1). Every shot is kept, and the shots of a
 *  place stay in the order they were in. A move off either end changes nothing. (Two places with the very
 *  same `where` that end up next to each other read as one place afterwards — that is what a place is.) */
export function movePlace<S extends FlowScene>(scenes: ReadonlyArray<S>, placeIndex: number, dir: -1 | 1): S[] {
  const flow = flowOf(scenes);
  const to = placeIndex + (dir < 0 ? -1 : 1);
  if (!flow[placeIndex] || !flow[to]) return scenes.slice();
  const runs = pinned(scenes, flow);
  [runs[placeIndex], runs[to]] = [runs[to], runs[placeIndex]];
  return runs.flat();
}

/** NEW (2026-11-25): take a whole place out, with every line in it. A script keeps at least one place. */
export function removePlace<S extends FlowScene>(scenes: ReadonlyArray<S>, placeIndex: number): S[] {
  const flow = flowOf(scenes);
  if (flow.length < 2 || !flow[placeIndex]) return scenes.slice();
  return pinned(scenes, flow).filter((_, k) => k !== placeIndex).flat();
}

/** The lines of one place, in order, as the flat list has them ("NAME: what they say"). */
export function placeLines(scenes: ReadonlyArray<FlowScene>, placeIndex: number): string[] {
  const loc = flowOf(scenes)[placeIndex];
  return loc ? scenes.slice(loc.firstIdx, loc.lastIdx + 1).map((s) => (s.caption || "").trim()) : [];
}
