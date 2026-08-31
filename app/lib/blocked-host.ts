/* Which hosts the server refuses to fetch.
 *
 * This is the single guard behind every "safe" outbound fetch in the app — the
 * Add-by-URL importer, the photo field, the catalogue crawler, and safeFetch's
 * per-hop redirect check. A gap here is a gap in all of them at once.
 *
 * It was written as string prefixes over the hostname, which is right for the
 * plain forms and blind to everything else. Verified against this runtime:
 *
 *   http://2130706433/            -> 127.0.0.1        blocked   (URL normalises)
 *   http://0x7f000001/            -> 127.0.0.1        blocked
 *   http://127.1/                 -> 127.0.0.1        blocked
 *   http://[::ffff:127.0.0.1]/    -> [::ffff:7f00:1]  ALLOWED   <-- and it connects
 *   http://[::ffff:169.254.169.254]/ -> [::ffff:a9fe:a9fe]  ALLOWED
 *   http://[::]/                  -> [::]             ALLOWED
 *   http://[fd00::1]/             -> [fd00::1]        ALLOWED
 *   http://100.64.1.1/            -> 100.64.1.1       ALLOWED
 *   http://dpg-abc123-a/          -> dpg-abc123-a     ALLOWED
 *
 * A fetch to http://[::ffff:127.0.0.1]:PORT/ reached a server bound to
 * 127.0.0.1 and returned its body. Since the importer hands the fetched page's
 * <title> and og:image back in its JSON response, that is a read channel into
 * anything the container can reach — localhost services and Render's private
 * network, whose service names are exactly the single-label form above.
 *
 * So: parse the address rather than pattern-matching its spelling.
 *
 * This does NOT close DNS rebinding — a name that resolves publicly here and
 * privately at connect time still passes, as safeFetch's comment already says.
 * Blocking that needs filtering at the socket.
 *
 * Pure and dependency-free apart from node:net, so it is testable — see
 * tests/blocked-host.test.ts.
 */

import net from "node:net";

/** IPv4 ranges that must never be reachable. */
function blockedV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 || // "this network"
    a === 127 || // loopback
    a === 10 || // private
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 169 && b === 254) || // link-local, incl. cloud metadata
    (a === 100 && b >= 64 && b <= 127) || // CGNAT — Render's private range lives here
    a >= 224 // multicast and reserved
  );
}

/** The IPv4 address inside an IPv4-mapped or IPv4-compatible IPv6 address.
 *  Node prints these either as ::ffff:127.0.0.1 or as ::ffff:7f00:1 depending
 *  on how they were written, and both must unmap to the same thing. */
function unmapV4(ip6: string): string | null {
  const h = ip6.toLowerCase();
  const dotted = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1];
  const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  }
  return null;
}

/** IPv6 ranges that must never be reachable. */
function blockedV6(ip: string): boolean {
  const h = ip.toLowerCase();
  if (h === "::" || h === "::1") return true; // unspecified (routes to loopback) and loopback
  const head = h.split(":")[0];
  const lead = parseInt(head || "0", 16);
  if (Number.isNaN(lead)) return true;
  if ((lead & 0xfe00) === 0xfc00) return true; // fc00::/7  unique local
  if ((lead & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if (lead === 0xff02 || (lead & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** Reject loopback, private, link-local and internal targets before we fetch
 *  them. Takes a URL.hostname, so an IPv6 literal arrives in brackets. */
export function isBlockedHost(host: string): boolean {
  const raw = (host || "").trim().toLowerCase();
  if (!raw) return true;

  // Brackets first: URL.hostname keeps them on IPv6 literals, and every check
  // below — including the single-label test — needs the bare address.
  const bare = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;

  const kind = net.isIP(bare);
  if (kind === 4) return blockedV4(bare);
  if (kind === 6) {
    const mapped = unmapV4(bare);
    // An IPv4 address wearing an IPv6 coat is still that IPv4 address.
    if (mapped) return blockedV4(mapped);
    return blockedV6(bare);
  }

  // Not an IP — a name.
  if (bare === "localhost" || bare.endsWith(".localhost")) return true;
  if (bare.endsWith(".local") || bare.endsWith(".internal") || bare.endsWith(".home.arpa")) return true;
  // A name with no dot is not a public host. It is a container alias, a service
  // name on a private network, or a search-domain lookup — which is precisely
  // the shape of Render's internal service and database hostnames.
  if (!bare.includes(".")) return true;

  return false;
}
