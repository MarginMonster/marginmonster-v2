/* "YOUR FILM IS READY" — SAID ON WHATEVER PAGE THE MEMBER IS ON.
 *
 * A film takes fifteen to twenty minutes to render. The page that starts it says "it'll land in your
 * Archive when it's done. You can keep working" — and then nothing, anywhere, ever said that it WAS done.
 * The member kept working (or made another one, or went to look at the cast) and had to remember to go
 * and check. Found by doing exactly that, three films in a row, 2026-11-23.
 *
 * The shell looks every twenty seconds WHILE something is rendering (and once on every load), and when a
 * video newer than anything this browser has been told about turns up, it says so, with a link that opens
 * it. This file is the deciding part — pure, so it can be tested without a browser. The reading is
 * ready-notice.server.ts; the notice itself is in routes/web.tsx.
 */

/** The newest finished video of the signed-in shop. */
export type ReadyPiece = { id: string; title: string; at: string; /** the film's own poster, when it made one (story-poster.ts) — it is then announced as a premiere */ poster?: string | null; /** who is in it, as its "Starring" row has them — three at most */ cast?: string[] };
/** What one look returns: how many pieces are rendering now, and the newest finished video (if any). */
export type ReadyState = { cooking: number; newest: ReadyPiece | null };

/** How often the shell looks while something is rendering. */
export const READY_POLL_MS = 20_000;
/** A video is only announced this soon after it was finished: opening the app tomorrow is not news. */
export const READY_FRESH_MS = 2 * 3600_000;
/** Where a browser remembers the newest video it has already been told about or shown (an ISO time). */
export const READY_SEEN_KEY = "emReadySeen";
/** How long the notice stays up by itself. */
export const READY_SHOW_MS = 25_000;

const time = (iso: string | null | undefined): number => {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? t : NaN;
};

/**
 * The video to announce after this look — or null.
 *
 *  - `seenAt` is what this browser remembers (READY_SEEN_KEY); null means it has never looked before, and
 *    then nothing is announced: nobody was waiting here.
 *  - Only a video newer than that, finished within READY_FRESH_MS.
 *  - Never on the Archive itself — a piece lands there in front of the member's eyes.
 */
export function pieceToAnnounce(cur: ReadyState, seenAt: string | null, nowMs: number, onArchive: boolean): ReadyPiece | null {
  const p = cur.newest;
  if (!p || !p.id) return null;
  const at = time(p.at);
  if (Number.isNaN(at)) return null;
  if (seenAt === null) return null;
  const seen = time(seenAt);
  if (!Number.isNaN(seen) && at <= seen) return null;
  if (nowMs - at > READY_FRESH_MS) return null;
  if (onArchive) return null;
  return p;
}

/** What the browser remembers after a look — the newest video's time, announced or not. A member with no
 *  videos yet remembers the beginning of time, so their FIRST film is announced. Never moves backwards. */
export function seenAfter(cur: ReadyState, seenAt: string | null): string {
  const seen = time(seenAt);
  const at = cur.newest ? time(cur.newest.at) : NaN;
  const best = Math.max(Number.isNaN(seen) ? 0 : seen, Number.isNaN(at) ? 0 : at);
  return new Date(best).toISOString();
}

/** The name the notice says: the piece's title, cut at a word when it is long. */
export function readyName(title: string | null | undefined, max = 64): string {
  const t = (title || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > 20 ? cut.slice(0, at) : t.slice(0, max)).replace(/[\s,;:\-–—]+$/, "")}…`;
}
