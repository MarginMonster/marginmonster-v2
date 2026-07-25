/* Tiny in-memory activity log for the self-forging art systems (style tiles,
 * ad templates). The builders run fire-and-forget on the server, so when a
 * render fails the reason only ever reached Render's logs — invisible from
 * the app. Everything logged here shows up on /art-status. */

type ArtLogEntry = { t: string; src: string; msg: string };

const MAX_ENTRIES = 100;
const entries: ArtLogEntry[] = [];

export function artLog(src: string, msg: string): void {
  entries.push({ t: new Date().toISOString(), src, msg: msg.slice(0, 400) });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export function artLogEntries(): ArtLogEntry[] {
  return [...entries].reverse(); // newest first
}
