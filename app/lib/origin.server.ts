/** The site's real, external origin.
 *
 *  `new URL(request.url).origin` is not it. Render terminates TLS at its edge
 *  and forwards to the container over plain HTTP, so request.url says
 *  "http://easymodeapp.com" on a page the visitor loaded over HTTPS. Meta tags
 *  built from that advertise an http:// og:url and og:image, which unfurlers
 *  treat as mixed content on an https page and quietly drop — no preview.
 *
 *  X-Forwarded-Proto carries what the visitor actually used. It can be a
 *  comma-separated list when more than one proxy is in front of us; the first
 *  entry is the client-facing one. */
export function externalOrigin(request: Request): string {
  const url = new URL(request.url);
  const fwd = request.headers.get("x-forwarded-proto");
  if (fwd) {
    const proto = fwd.split(",")[0].trim().toLowerCase();
    if (proto === "http" || proto === "https") url.protocol = `${proto}:`;
  }
  const host = request.headers.get("x-forwarded-host");
  if (host) url.host = host.split(",")[0].trim();
  return url.origin;
}
