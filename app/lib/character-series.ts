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
export function episodeIdeaPrompt(o: { seriesName: string; about: string; show: Show; star: ShowStar; recent: ReadonlyArray<string>; episode: number; /** FRESH EVERY TIME (story-variety.ts): the angle this episode was dealt */ angle?: string }): string {
  const what = o.star.kind === "person" ? "" : o.star.kind === "monster" ? " (a creature — it stays one)" : " (a cartoon character — it stays one)";
  const recent = (o.recent || []).map((t) => oneLine(t)).filter(Boolean).slice(-12);
  return (
    `You are the head writer of a short-video series called "${oneLine(o.seriesName).replace(/"/g, "'")}".\n` +
    `Its star, in every episode: ${o.star.name}${what}${o.star.look ? ` — ${o.star.look}` : ""}.\n` +
    (oneLine(o.about) ? `What the show is about, in its maker's words: "${oneLine(o.about).replace(/"/g, "'").slice(0, 160)}".\n` : "") +
    `The kind of show: ${o.show.brief}.\n` +
    `Give the premise of EPISODE ${Math.max(1, Math.floor(o.episode || 1))}: ONE line, at most 25 words — what happens to ${o.star.name}, specific and new. No title, no quotes, no numbering, no hashtags.\n` +
    // (two episodes of one werewolf's show, a day apart, were the same story — a woman alone in the woods,
    //  and something worse than the werewolf behind her: an angle is DEALT, so episode 7 is not episode 3)
    (oneLine(o.angle) ? `This episode's angle, dealt for it alone — follow it unless what the show is about rules it out: ${oneLine(o.angle).slice(0, 240)}.\n` : "") +
    (recent.length ? `It must NOT repeat or closely resemble any of these earlier episodes — not their situation, not their setting, not who the star meets:\n- ${recent.join("\n- ")}\n` : "") +
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
 *  is kept under it): the premise, and nothing else. The cast and the sign-off travel beside it.
 *  (It used to end `(An episode of "<show>", starring <star>.)` — and the first episode made on the live
 *  site, 2026-11-24, came back TITLED with the show's name: "Howl: Night Tales — What Follows the Trail",
 *  which the Archive then prefixed again and the poster ran together. The show's name is ours to put on
 *  an episode — film-series.ts → episodeTitle — never the writer's.) */
export function episodeTopic(o: { idea: string; seriesName: string; star: ShowStar }): string {
  return oneLine(o.idea).slice(0, 298);
}

/* THE STAR TELLS IT. A show whose star has a voice is told IN that voice — and the first live episode was
 * a werewolf's growl telling a story about "Howl" in the third person: "But Howl did not lunge. It
 * pointed…". A character with their own show and their own voice is its HOST: the story is theirs, told
 * as "I" (film-engine.server.ts → the TELLER line). A picture, though, is drawn from its words — and "I"
 * is nobody — so a scene's VISUAL keeps calling them by name; the writer is told so, and this puts the
 * name back wherever a first-person word slipped into one. */

/** A scene's VISUAL with the teller's first-person words turned back into their name. */
export function tellerVisual(visual: string, name: string): string {
  const n = oneLine(name);
  const v = String(visual || "");
  // ("mine" is left alone: in a story it is as often a place as a pronoun)
  if (!n || !/\b(?:I|me|[Mm]y|[Mm]yself)\b/.test(v)) return v;
  return v
    .replace(/\bI(?:'|’)m\b|\bI am\b/g, `${n} is`)
    .replace(/\bI(?:'|’)ve\b|\bI have\b/g, `${n} has`)
    .replace(/\bI(?:'|’)d\b/g, `${n} would`)
    .replace(/\bI(?:'|’)ll\b/g, `${n} will`)
    .replace(/\b[Mm]yself\b/g, n)
    .replace(/\b[Mm]y\b/g, `${n}'s`)
    .replace(/\bme\b/g, n)
    .replace(/\bI\b/g, n);
}

/** Who tells a show's episodes: the star, when they have a voice of their own to tell it in — else nobody
 *  in particular (the format's own storyteller, in the third person). */
export const showTeller = (star: ShowStar | null | undefined): string => (star && star.voiceId ? star.name : "");

/** What a finished episode keeps about its show (meta.show): whose it is, which episode, and — once it is
 *  written — the episode's OWN name (its title is "<Show> — Episode <N>: <name>", cut to fit a shelf; this
 *  is the name in full). */
export type ShowMeta = { id: string; name: string; episode: number; star: string; title?: string };
export function showMeta(raw: unknown): ShowMeta | null {
  let v: unknown = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const id = oneLine(o.id).slice(0, 64);
  const name = oneLine(o.name).slice(0, 60);
  const episode = typeof o.episode === "number" && Number.isFinite(o.episode) && o.episode >= 1 ? Math.floor(o.episode) : 0;
  const title = oneLine(o.title).slice(0, 80);
  return id && name && episode ? { id, name, episode, star: oneLine(o.star).slice(0, 40), ...(title ? { title } : {}) } : null;
}

/** An episode's OWN name, from what its writer called it: the part after "Episode <N>:" when the title is
 *  already an episode's, the show's name taken off its front, "" when nothing of its own is left. */
export function episodeOwnName(title: string | null | undefined, showName: string | null | undefined): string {
  let t = oneLine(title);
  const after = t.match(/\b(?:episode|ep\.?)\s*\d+\s*[:—–\-]\s*(.+)$/i);
  if (after) return oneLine(after[1]).slice(0, 80);
  if (/\b(?:episode|ep\.?)\s*\d+\s*$/i.test(t)) return "";
  const show = oneLine(showName).toLowerCase();
  if (show && t.toLowerCase().startsWith(show)) t = t.slice(show.length).replace(/^[\s:—–\-|,]+/, "");
  // (a shelf title — "Horror Story — <show> — <name>" — keeps only what follows its last long dash)
  else if (t.includes(" — ")) t = t.slice(t.lastIndexOf(" — ") + 3);
  return t.replace(/^["“”']+|["“”']+$/g, "").trim().slice(0, 80);
}

/** The key a finished episode is found by: the exact text its meta holds for its show (JSON, as written by
 *  narrated-story.server.ts — `"show":{"id":"<id>"`). A show's own page lists its episodes by it. */
export const showMetaNeedle = (showId: string): string => `"show":{"id":${JSON.stringify(oneLine(showId).slice(0, 64))}`;

/** One finished episode, as a show's card lists it. */
export type ShowEpisode = { assetId: string; showId: string; episode: number; title: string; poster: string | null };

/** The episodes of each show among these pieces, newest episode first, `max` a show. `rows` are assets
 *  (id, title, metaJson) in any order; a piece that is not an episode of one of `showIds` is skipped. */
export function episodesByShow(rows: ReadonlyArray<{ id: string; title?: string | null; metaJson?: unknown }>, showIds: ReadonlyArray<string>, max = 4): Record<string, ShowEpisode[]> {
  const out: Record<string, ShowEpisode[]> = {};
  for (const r of rows || []) {
    let m: unknown = r.metaJson;
    if (typeof m === "string") { try { m = JSON.parse(m); } catch { continue; } }
    if (!m || typeof m !== "object" || Array.isArray(m)) continue;
    const meta = m as Record<string, unknown>;
    const s = showMeta(meta.show);
    if (!s || !showIds.includes(s.id)) continue;
    const p = typeof meta.poster === "string" && /^\/renders\/[a-zA-Z0-9_-]+-poster\.jpg$/.test(meta.poster) ? meta.poster : null;
    (out[s.id] ||= []).push({ assetId: r.id, showId: s.id, episode: s.episode, title: s.title || episodeOwnName(r.title, s.name), poster: p });
  }
  for (const id of Object.keys(out)) out[id] = out[id].sort((a, b) => b.episode - a.episode).slice(0, Math.max(1, max));
  return out;
}
