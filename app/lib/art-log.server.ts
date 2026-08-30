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

/* Which sources are safe to show without the diagnostics key.
 *
 * /art-status is an unauthenticated page, and it was publishing this log
 * whole. The infra builders only ever describe the app's OWN assets — the
 * style tiles and the 49 ad-format previews, which ship with the product.
 * "image-ad" is different: those entries are written while rendering a
 * particular merchant's ad, and they quote the QA gate's findings, which
 * carry that merchant's product names and ad copy verbatim. Serving them on
 * a public URL showed one shop's unreleased campaign text to anyone who
 * asked, including a competitor. */
const PUBLIC_SOURCES = new Set(["ad-templates", "style-tiles", "ad-formats", "stripe"]);

/** The log. Pass includeMerchantWork only behind the diagnostics key. */
export function artLogEntries(includeMerchantWork = false): ArtLogEntry[] {
  const all = [...entries].reverse(); // newest first
  return includeMerchantWork ? all : all.filter((e) => PUBLIC_SOURCES.has(e.src));
}
