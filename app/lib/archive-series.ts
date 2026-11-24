/* A SERIES IS ONE CARD ON THE SHELF.
 *
 * The owner, 2026-11-24: "archive should show Series as a cover with number of episodes inside like a
 * netflix listing wink wink, that way there isnt 10 episodes cluttering the archive but a singular
 * storyline being stored".
 *
 * Two kinds of series exist, both written on a finished film's own meta:
 *   · a FILM SERIES ("Next episode" — film-series.ts): meta.series = { id, title, episode }. `id` is the
 *     asset id of the series' FIRST film, and that first film carries no `series` of its own — it is
 *     episode 1 only once a second has been made.
 *   · a CHARACTER'S SHOW (character-series.ts): meta.show = { id, name, episode, star }. A show with one
 *     episode so far is still a show.
 *
 * What the Archive does with them, in two steps:
 *   1. THE LOADER tags every loaded film that belongs to a series (seriesTags): a short key, the series'
 *      title, which episode it is. The key is a HASH — the page's address never carries a show's id (the
 *      page is never given one) or a film's.
 *   2. THE PAGE turns its shelf into ITEMS (archiveShelf): the films of one series collapse into one item
 *      standing where the newest of them stood; everything else stays the piece it was.
 *
 * A story told again in another language (meta.translatedFrom — story-translate.ts) is not an episode of
 * anything: it stays a piece of its own.
 *
 * Pure: no database, no React — two small readers of a film's meta and plain arithmetic.
 * tests/archive-series.test.ts holds it. */

import { seriesOf } from "./film-series.ts";
import { showMeta, showMetaNeedle } from "./character-series.ts";

/** What a film in a series carries on the page: its series' key and title, and which episode it is. */
export type SeriesTag = { key: string; title: string; episode: number };

/** A piece as the shelf has it — only what the grouping reads. */
export type ShelfPiece = { id: string; when: string; media?: string | null; poster?: string | null; series?: SeriesTag | null };

/** One series, as one card. */
export type SeriesItem = {
  kind: "series";
  /** the series' key (seriesKey) — what `?series=` carries */
  key: string;
  title: string;
  /** how many of its episodes are on this shelf */
  count: number;
  /** its cover: the newest episode's poster, else that episode's first frame — what the shelf shows a film as */
  cover: string | null;
  /** the first frame of the film the cover came from: the same address as `cover` when that film has no
   *  poster, and what to fall back to when a poster's file is missing */
  frame: string | null;
  /** its episodes' ids in EPISODE order — 1, 2, 3… */
  episodes: string[];
  /** when the newest of them was made (as the pieces carry it: an ISO time) */
  latestWhen: string;
};
export type ShelfItem = { kind: "piece"; id: string } | SeriesItem;

/** A short, stable key for a series: a hash of its kind and id, in base 36 — one letter for the kind ("f" a
 *  film series, "s" a show), then 53 bits (cyrb53). The same series always gets the same key; the id cannot
 *  be read back out of it. */
export function seriesKey(kind: "film" | "show", id: string): string {
  const s = `${kind}:${id}`;
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (kind === "show" ? "s" : "f") + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

type Obj = Record<string, unknown>;
const metaOf = (raw: unknown): Obj => {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Obj;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try { const o = JSON.parse(raw); return o && typeof o === "object" && !Array.isArray(o) ? (o as Obj) : {}; } catch { return {}; }
};

/** The series a film SAYS it belongs to, from its own meta: a film series first (the way its title was
 *  made — narrated-story.server.ts), else a show. */
function ownSeries(meta: Obj): { kind: "film" | "show"; id: string; title: string; episode: number } | null {
  const film = seriesOf(meta);
  if (film) return { kind: "film", id: film.id, title: film.title, episode: film.episode };
  const show = showMeta(meta.show);
  return show ? { kind: "show", id: show.id, title: show.name, episode: show.episode } : null;
}

/** THE LOADER'S STEP. Of the films a page loaded — NEWEST FIRST, each with its id and its meta — which
 *  belong to a series, as a tag per film id:
 *    · a film whose meta names a film series or a show is an episode of it;
 *    · the film a film series STARTED from (its id is the series' id) joins as episode 1 — but only when
 *      another loaded film names it: a film with no second episode is a plain piece;
 *    · a telling in another language is never an episode, and never makes a first film one.
 *  A series is titled as its newest episode titles it. */
export function seriesTags(rows: ReadonlyArray<{ id: string; metaJson?: unknown }>): Map<string, SeriesTag> {
  const out = new Map<string, SeriesTag>();
  const started = new Map<string, string>(); // a film series' first film → the series' title
  const loose: string[] = []; // films that name no series themselves: a first film is one of these
  for (const r of rows || []) {
    if (!r || typeof r.id !== "string" || !r.id) continue;
    const meta = metaOf(r.metaJson);
    if (typeof meta.translatedFrom === "string" && meta.translatedFrom.trim()) continue;
    const s = ownSeries(meta);
    if (!s) { loose.push(r.id); continue; }
    out.set(r.id, { key: seriesKey(s.kind, s.id), title: s.title, episode: s.episode });
    if (s.kind === "film" && !started.has(s.id)) started.set(s.id, s.title);
  }
  for (const id of loose) {
    const title = started.get(id);
    if (title) out.set(id, { key: seriesKey("film", id), title, episode: 1 });
  }
  return out;
}

/** A SERIES' TRUE SIZE. The page loads the newest sixty films, so the episodes ON THE SHELF can be fewer
 *  than the series has — and a cover that says "1 episode" over a six-episode show is wrong about the one
 *  thing it is there to say. So the loader counts each series on its page once (seriesRefs → one small
 *  count each), and the cover shows that number.
 *
 *  seriesRefs: the series among the loaded films, each once, newest first — its key (what the page knows it
 *  by) and what it is (which the page is never told). */
export type SeriesRef = { key: string; kind: "film" | "show"; id: string };
export function seriesRefs(rows: ReadonlyArray<{ id: string; metaJson?: unknown }>): SeriesRef[] {
  const out: SeriesRef[] = [];
  const seen = new Set<string>();
  for (const r of rows || []) {
    if (!r || typeof r.id !== "string" || !r.id) continue;
    const meta = metaOf(r.metaJson);
    if (typeof meta.translatedFrom === "string" && meta.translatedFrom.trim()) continue;
    const s = ownSeries(meta);
    if (!s) continue;
    const key = seriesKey(s.kind, s.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, kind: s.kind, id: s.id });
  }
  return out;
}
/** The text every episode of a series carries in its stored meta (both writers put the id first:
 *  film-series.ts → seriesMeta, character-series.ts → showMetaNeedle). A film series' FIRST film names no
 *  series — it is counted apart, by its own id. */
export const seriesNeedle = (ref: { kind: "film" | "show"; id: string }): string =>
  ref.kind === "show" ? showMetaNeedle(ref.id) : `"series":{"id":${JSON.stringify(String(ref.id).slice(0, 64))}`;
/** What a cover says: the series' own count when it is known and larger than what the shelf holds. */
export const episodesOf = (onShelf: number, total: number | null | undefined): number => {
  const t = typeof total === "number" && Number.isFinite(total) ? Math.floor(total) : 0;
  return Math.max(Math.max(0, Math.floor(onShelf || 0)), t);
};

/** INSIDE ITS SERIES an episode is called by its OWN name. The band above the cards already says the series'
 *  name and the small line above each title already says which episode it is — so "The Lighthouse Keeper —
 *  Episode 2: The Storm" is "The Storm" there. A title with no name of its own after its number stays whole
 *  (episode 1 is the first film, still called what it was called; so is an episode its writer never named).
 *  (The word is always "Episode": film-series.ts writes it so, whatever language the story is told in.) */
export function episodeOwnLabel(title: string | null | undefined): string {
  const whole = String(title || "").trim();
  const m = /\b(?:episode|ep\.?)\s*\d+\s*[:—–-]\s*(\S.*)$/i.exec(whole);
  return m ? m[1].trim() : whole;
}

/** A video's first frame, as the shelf asks for it (the cached still of that file). */
export function firstFrameOf(media: string | null | undefined): string | null {
  const name = String(media || "").split("?")[0].split("/").pop() || "";
  return name ? `/vthumb/${name}` : null;
}

const tagOf = (p: ShelfPiece): SeriesTag | null => {
  const s = p.series;
  return s && typeof s.key === "string" && s.key && typeof s.title === "string" ? s : null;
};
const timeOf = (when: string): number => { const t = Date.parse(when); return Number.isFinite(t) ? t : 0; };
const episodeOf = (p: ShelfPiece): number => { const n = tagOf(p)?.episode; return typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1; };

/** THE PAGE'S STEP. The pieces of a shelf, in shelf order (newest first), as ITEMS: every film of one
 *  series collapses into ONE item — standing where the NEWEST of them stood, titled and covered by it —
 *  and everything else stays `{ kind: "piece", id }` in its own place.
 *
 *  Given a shelf that a filter has already narrowed, a series is what is left of it: it still shows as its
 *  card, counting the episodes that are on the shelf. */
export function archiveShelf(pieces: ReadonlyArray<ShelfPiece>): ShelfItem[] {
  type Member = { p: ShelfPiece; at: number };
  const groups = new Map<string, { members: Member[]; newest: Member }>();
  (pieces || []).forEach((p, at) => {
    const s = tagOf(p);
    if (!s) return;
    const m = { p, at };
    const g = groups.get(s.key);
    if (!g) { groups.set(s.key, { members: [m], newest: m }); return; }
    g.members.push(m);
    // (made at the same moment: the one higher on the shelf is the newest)
    if (timeOf(p.when) > timeOf(g.newest.p.when)) g.newest = m;
  });
  const out: ShelfItem[] = [];
  (pieces || []).forEach((p, at) => {
    const s = tagOf(p);
    const g = s ? groups.get(s.key) : undefined;
    if (!s || !g) { out.push({ kind: "piece", id: p.id }); return; }
    if (g.newest.at !== at) return; // inside its series' card
    // THE COVER: the newest episode that still has its film — its poster, else its first frame; a series
    // whose films are all gone keeps the newest poster it has
    const newestFirst = [...g.members].sort((a, b) => timeOf(b.p.when) - timeOf(a.p.when) || a.at - b.at);
    const withFilm = newestFirst.find((m) => !!m.p.media);
    const face = withFilm || newestFirst.find((m) => !!m.p.poster) || null;
    const frame = face ? firstFrameOf(face.p.media) : null;
    out.push({
      kind: "series",
      key: s.key,
      title: tagOf(g.newest.p)!.title,
      count: g.members.length,
      cover: face ? face.p.poster || frame : null,
      frame,
      // 1, 2, 3…; two films of one number (an episode made twice) stand oldest first
      episodes: [...g.members].sort((a, b) => episodeOf(a.p) - episodeOf(b.p) || timeOf(a.p.when) - timeOf(b.p.when) || b.at - a.at).map((m) => m.p.id),
      latestWhen: g.newest.p.when,
    });
  });
  return out;
}

/** The series with this key on a shelf — or null: no such series there (a key from an old address, a
 *  series whose films are gone or filtered out). */
export function seriesOnShelf(pieces: ReadonlyArray<ShelfPiece>, key: string | null | undefined): SeriesItem | null {
  if (!key) return null;
  for (const it of archiveShelf(pieces)) if (it.kind === "series" && it.key === key) return it;
  return null;
}
