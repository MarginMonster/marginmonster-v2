/* THE ADDRESS A PROVIDER CAN FETCH ONE OF OUR OWN FILES AT.
 *
 * Everything we save is returned as "/renders/<file>" or "/uploads/<file>" — a path on OUR server.
 * A video or image engine on someone else's servers needs a whole URL, and each pipeline grew its
 * own two-line `abs()` for that. The Creator video path never got one: its seed still went to the
 * engines as a bare path, both turned it away ("start_image: Does not match format 'uri'"), and every
 * described Creator video failed and refunded from 2026-10-27 until a customer-view test on 2026-11-23.
 *
 * (public-url.ts is the OTHER question — the address a person clicks. A machine may fetch from any
 * host that serves the file, so this one resolves against SHOPIFY_APP_URL like every pipeline's abs().)
 *
 * Returns undefined when there is no address to give (no base configured, or something that is not a
 * path at all), so a caller can tell "nothing to send" from "send this" — a seed an engine cannot
 * fetch must never be sent. Pure: no imports, tested in tests/creator-video-seed.test.ts. */
export function fetchableUrl(u: string | null | undefined, base: string | undefined = process.env.SHOPIFY_APP_URL): string | undefined {
  const s = (u || "").trim();
  if (/^https?:\/\//i.test(s)) return s;
  const b = (base || "").trim().replace(/\/+$/, "");
  return s.startsWith("/") && !s.startsWith("//") && /^https?:\/\//i.test(b) ? `${b}${s}` : undefined;
}
