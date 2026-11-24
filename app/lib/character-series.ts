/* A CHARACTER'S SHOW — a series that belongs to one of the cast and runs by itself.
 *
 * The owner, 2026-11-24: "i would like to try to give character the chance to have a "series" which would
 * directly connect with autoposting, characters could have multiple series. Series being selectable and
 * would run in background like a campaign simulating posts and stories or entertainent types similar to
 * Quiet wolf on facebook".
 *
 * (Quiet Wolf, looked up that day: one recurring wolf, a lesson an episode — "a wolf, a lesson, and things
 * no one taught you" — short narrated videos that all end on the same line.)
 *
 * What it is here: a Channel (CreatorSeries, the autopilot that already makes and posts faceless videos on
 * a cadence — creator-series.server.ts) whose every drop is an EPISODE: a narrated story starring that
 * character, drawn from their own picture, told in their own voice when they have one, ending on the
 * show's sign-off. A character can have several shows; a show is picked from a short list (SHOWS).
 *
 * Pure: the scheduler, the writer and the render are the caller's.
 */

/** The star of a show, as the cast has them: who, their picture, what they are, what they look like, and
 *  the voice they speak in (a stock or character voice — it tells the story when it can). */
export type ShowStar = { id: string; name: string; faceUrl: string; kind: "person" | "cartoon" | "monster"; look: string; voiceId: string | null };

/** A kind of show a character can be given. `template` is the story format each episode is told in
 *  (film-engine's narrated formats); `brief` is what the idea-writer is told an episode IS. */
export type Show = { key: string; name: string; line: string; template: "moral" | "testmovie" | "horror"; brief: string };

export const SHOWS: readonly Show[] = [
  {
    key: "lessons", name: "Lessons", line: "One thing nobody taught you, every episode", template: "moral",
    brief: "each episode is ONE short story that lands on a clear lesson about people, money, work or life — the kind nobody teaches you — shown through something that happens, never preached",
  },
  {
    key: "tales", name: "Tales", line: "A new short story every episode", template: "testmovie",
    brief: "each episode is ONE self-contained short story — a small adventure, a meeting, a mystery — with a beginning, a middle and an ending that lands",
  },
  {
    key: "nights", name: "Night tales", line: "A scare before bed, every episode", template: "horror",
    brief: "each episode is ONE creepy tale told at night, dread building line by line to a chilling last moment",
  },
];
export const showOf = (key: string | null | undefined): Show | null => SHOWS.find((s) => s.key === key) || null;

/** How many shows a shop may have running at once (every episode is a film of ours to make). */
export const CHARACTER_SERIES_MAX = 3;
/** An episode's length: six scenes, about a minute. */
export const SHOW_SCENES = 6;
/** How often a show can run. Not twice a day: an episode is a film, not a clip. */
export const SHOW_CADENCES: readonly string[] = ["3x_week", "daily"];

const oneLine = (s: unknown): string => (typeof s === "string" ? s : "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

/** The star, checked: a name and a picture (one of the site's own paths, or https) — or null. It comes from
 *  the page when a show is made and from the database when it runs; it is believed in neither case. */
export function parseStar(raw: unknown): ShowStar | null {
  let v: unknown = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const name = oneLine(o.name).slice(0, 40);
  const faceUrl = oneLine(o.faceUrl).slice(0, 2000);
  if (!name || !/^(?:\/[\w./-]+(?:\?[\w.=&-]*)?|https:\/\/[^\s"'<>]+)$/.test(faceUrl) || faceUrl.includes("..")) return null;
  const kind: ShowStar["kind"] = o.kind === "cartoon" || o.kind === "monster" ? o.kind : "person";
  const voice = oneLine(o.voiceId).slice(0, 80);
  return { id: oneLine(o.id).slice(0, 80), name, faceUrl, kind, look: oneLine(o.look).slice(0, 220), voiceId: voice || null };
}

/** The line every episode ends on ("Evolve quietly, until you're the wolf.") — one line, or none. */
export const signoffOf = (raw: unknown): string => oneLine(raw).replace(/^["“”']+|["“”']+$/g, "").slice(0, 120);

/** What the idea-writer is asked: ONE fresh premise for the next episode of this character's show. */
export function episodeIdeaPrompt(o: { seriesName: string; about: string; show: Show; star: ShowStar; recent: ReadonlyArray<string>; episode: number }): string {
  const what = o.star.kind === "person" ? "" : o.star.kind === "monster" ? " (a creature — it stays one)" : " (a cartoon character — it stays one)";
  const recent = (o.recent || []).map((t) => oneLine(t)).filter(Boolean).slice(-12);
  return (
    `You are the head writer of a short-video series called "${oneLine(o.seriesName).replace(/"/g, "'")}".\n` +
    `Its star, in every episode: ${o.star.name}${what}${o.star.look ? ` — ${o.star.look}` : ""}.\n` +
    (oneLine(o.about) ? `What the show is about, in its maker's words: "${oneLine(o.about).replace(/"/g, "'").slice(0, 160)}".\n` : "") +
    `The kind of show: ${o.show.brief}.\n` +
    `Give the premise of EPISODE ${Math.max(1, Math.floor(o.episode || 1))}: ONE line, at most 25 words — what happens to ${o.star.name}, specific and new. No title, no quotes, no numbering, no hashtags.\n` +
    (recent.length ? `It must NOT repeat or closely resemble any of these earlier episodes:\n- ${recent.join("\n- ")}\n` : "") +
    `Keep it true to life and general: no real named people, brands, prices or statistics. Anyone in danger is an adult.\n` +
    `Return ONLY the premise line.`
  );
}

/** The idea-writer's answer as one clean line — or the fallback when it gave nothing usable. */
export function tidyIdea(raw: unknown, fallback: string): string {
  const line = String(typeof raw === "string" ? raw : "").split("\n")
    .map((s) => s.replace(/^["'`\-\d.)\s]+/, "").replace(/["'`]+$/, "").trim())
    .find(Boolean) || "";
  return oneLine(line).slice(0, 170) || oneLine(fallback).slice(0, 170);
}

/** What the story's own writer is told the episode is about (it is cut at 300 characters there, so this
 *  is kept under it): the premise, then whose show it is. The cast and the sign-off travel beside it. */
export function episodeTopic(o: { idea: string; seriesName: string; star: ShowStar }): string {
  const tail = ` (An episode of "${oneLine(o.seriesName).replace(/"/g, "'").slice(0, 50)}", starring ${o.star.name}.)`;
  return `${oneLine(o.idea).slice(0, 298 - tail.length)}${tail}`;
}

/** What a finished episode keeps about its show (meta.show): whose it is and which episode. */
export type ShowMeta = { id: string; name: string; episode: number; star: string };
export function showMeta(raw: unknown): ShowMeta | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = oneLine(o.id).slice(0, 64);
  const name = oneLine(o.name).slice(0, 60);
  const episode = typeof o.episode === "number" && Number.isFinite(o.episode) && o.episode >= 1 ? Math.floor(o.episode) : 0;
  return id && name && episode ? { id, name, episode, star: oneLine(o.star).slice(0, 40) } : null;
}
