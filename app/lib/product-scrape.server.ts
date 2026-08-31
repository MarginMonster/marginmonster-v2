import { isBlockedHost } from "./blocked-host";
/* Pull a product's title + hero image out of ANY storefront page.
 *
 * Merchants paste product LINKS, not image files — that's the natural thing to
 * do, and demanding a direct .jpg URL is us pushing our plumbing onto them.
 * This scrapes the page instead: Shopify's /products/*.js shortcut first (exact
 * data, no parsing), then JSON-LD Product, then Open Graph / Twitter cards,
 * then a last-ditch sweep of <img> tags. Works on Shopify, Wix, Squarespace,
 * WooCommerce, Etsy and anything else that ships standard meta tags.
 *
 * Used by the studios' "Add by URL" importer AND by the photo field itself: if
 * what you pasted isn't an image, we scrape it rather than erroring.
 *
 * SSRF: private/loopback hosts are refused — this fetches attacker-suppliable
 * URLs from inside our network. */

export interface ScrapedProduct {
  title?: string;
  image?: string;
  /** Display-formatted price ("$126.98"). Only set when the page actually
   *  states one — we never guess, because a wrong price in an ad is worse
   *  than no price at all. */
  price?: string;
  url: string;
}

/** Format a raw price + currency the way a shopper would see it. Falls back to
 *  "CODE amount" for currencies without a well-known symbol rather than
 *  inventing one. */
function formatPrice(amount: string | number | undefined, currency?: string): string | undefined {
  if (amount === undefined || amount === null || amount === "") return undefined;
  const n = typeof amount === "number" ? amount : parseFloat(String(amount).replace(/[^0-9.]/g, ""));
  if (!isFinite(n) || n <= 0) return undefined;
  const SYMBOL: Record<string, string> = { USD: "$", CAD: "$", AUD: "$", NZD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥" };
  const code = (currency || "USD").toUpperCase();
  const sym = SYMBOL[code];
  const shown = code === "JPY" ? String(Math.round(n)) : n.toFixed(2);
  return sym ? `${sym}${shown}` : `${code} ${shown}`;
}

// Wix, Squarespace and anything behind Cloudflare routinely 403 a "bot"
// user-agent. We are fetching a page the merchant owns and pasted to us, so
// present as an ordinary browser; BOT_UA is kept only as a polite retry.
const UA: Record<string, string> = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
};
const BOT_UA: Record<string, string> = { ...UA, "user-agent": "Mozilla/5.0 (compatible; EasyModeBot/1.0; +https://easymodeapp.com)" };

/** Fetch a page as a browser would, retrying once with the bot UA if the host
 *  refuses. Storefronts differ on which they trust. */
async function fetchPage(url: string, timeoutMs = 12_000): Promise<Response> {
  let res = await safeFetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 403 || res.status === 406 || res.status === 429) {
    res = await safeFetch(url, { headers: BOT_UA, signal: AbortSignal.timeout(timeoutMs) });
  }
  return res;
}

const decodeEntities = (s: string) => s
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));

/* Reject loopback/private/link-local targets before we fetch them.
 *
 * Moved to ./blocked-host so it can be tested directly, and rewritten to
 * PARSE the address rather than pattern-match its spelling: the old string
 * prefixes were blind to [::ffff:127.0.0.1], which the URL parser renders as
 * [::ffff:7f00:1] — and which connects to loopback. Re-exported here so every
 * existing caller, including catalog-import, is unchanged. */
export { isBlockedHost } from "./blocked-host";
import { isBlockedIp } from "./blocked-host";
import dns from "node:dns/promises";
import net from "node:net";

/** A public NAME that resolves to a private ADDRESS.
 *
 *  isBlockedHost reads the hostname as written, so evil.example.com pointing
 *  at 169.254.169.254 sailed straight through — the one-line version of the
 *  rebinding hole the comment below describes. Resolving here and rejecting
 *  if ANY answer is private closes that; it does not close true rebinding,
 *  where the address changes between this lookup and the socket, but it turns
 *  a trivial attack into a race.
 *
 *  A lookup that fails is not treated as hostile: fetch does its own
 *  resolution and will fail on its own if the name is genuinely bad, and
 *  refusing every transient DNS hiccup would break real storefront imports.
 */
async function resolvesSomewhereForbidden(hostname: string): Promise<boolean> {
  if (net.isIP(hostname.replace(/^[|]$/g, ""))) return false; // already checked literally
  try {
    const answers = await dns.lookup(hostname, { all: true });
    return answers.length === 0 || answers.some((a) => isBlockedIp(a.address));
  } catch {
    return false;
  }
}

/** fetch() that re-checks the host on EVERY redirect hop.
 *
 *  isBlockedHost was applied once, to the URL the merchant typed, and then
 *  every fetch ran with redirect: "follow". A hostile storefront only had to
 *  answer 302 Location: http://169.254.169.254/… and our server would follow
 *  it straight to the cloud metadata endpoint, or to 127.0.0.1, and hand the
 *  body back to the caller. The guard was checking the one URL that was never
 *  the dangerous one.
 *
 *  Redirects are now followed by hand so each destination faces the same
 *  check as the first. Note this closes the redirect hole, not DNS rebinding:
 *  a hostname that resolves publicly here and privately at connect time would
 *  still pass. Blocking that needs IP-level filtering at the socket. */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  maxHops = 5
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= maxHops; hop++) {
    let u: URL;
    try { u = new URL(current); } catch { throw new Error("That URL isn't allowed."); }
    if (!/^https?:$/.test(u.protocol) || isBlockedHost(u.hostname)) {
      throw new Error("That URL isn't allowed.");
    }
    if (await resolvesSomewhereForbidden(u.hostname)) {
      throw new Error("That URL isn't allowed.");
    }
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get("location");
    if (!loc) return res; // a 3xx with nowhere to go — let the caller judge it
    try { current = new URL(loc, current).toString(); } catch { throw new Error("That URL isn't allowed."); }
  }
  throw new Error("Too many redirects.");
}

/** Storefronts advertise a SMALL share-card image (Wix serves 500x500 for a
 *  1257x1735 original). Generating an ad from a thumbnail throws away detail we
 *  can never get back, so rewrite known CDN transforms to the full-size file. */
export function upgradeImageResolution(url: string): string {
  try {
    // Wix: .../media/<id>.jpg/v1/fit/w_500,h_500,q_90/file.jpg → .../media/<id>.jpg
    const wix = url.match(/^(https?:\/\/static\.wixstatic\.com\/media\/[^/]+)\/v1\/[^?]*$/i);
    if (wix) return wix[1];
    // Shopify CDN: product_800x800.jpg / product_small.jpg → product.jpg
    if (/cdn\.shopify\.com|\/cdn\/shop\//i.test(url)) {
      return url.replace(/_(?:\d+x\d*|\d*x\d+|small|medium|large|grande|compact|icon|thumb|pico)(?=\.[a-z]{3,4}(?:$|\?))/i, "");
    }
    // Squarespace: ?format=750w → a much larger render
    if (/squarespace-cdn\.com|images\.squarespace/i.test(url)) {
      return url.replace(/([?&]format=)\d+w/i, "$12500w");
    }
    return url;
  } catch {
    return url;
  }
}

/** Storefront <title>/og:title usually carries a site-name suffix
 *  ("Product | Store"). Merchants want the product, not our best guess at
 *  their SEO template. */
export function cleanProductTitle(raw: string, siteName?: string): string {
  let t = decodeEntities(raw).trim();
  if (siteName) {
    const esc = siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`\\s*[|\u2013\u2014-]\\s*${esc}\\s*$`, "i"), "");
  }
  // Fall back to trimming a trailing " | Anything" segment.
  const parts = t.split(/\s+[|\u2013\u2014]\s+/);
  if (parts.length > 1 && parts[parts.length - 1].length <= 40) t = parts.slice(0, -1).join(" | ");
  return t.trim().slice(0, 120);
}

/** Absolutise and normalise an image URL found in markup. */
function absolutise(src: string, pageUrl: URL): string | undefined {
  const raw = decodeEntities(src.trim());
  if (!raw || raw.startsWith("data:")) return undefined;
  try {
    if (raw.startsWith("//")) return `https:${raw}`;
    return new URL(raw, pageUrl).href;
  } catch {
    return undefined;
  }
}

/** Is this URL already a direct image? Cheap HEAD (ranged GET where HEAD is
 *  refused). Used to decide "use it as-is" vs "scrape the page behind it". */
export async function isDirectImage(url: string, timeoutMs = 6000): Promise<boolean> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    let res = await safeFetch(url, { method: "HEAD", signal: ac.signal, headers: UA });
    if (res.status === 405 || res.status === 501 || res.status === 403) {
      res = await safeFetch(url, { method: "GET", headers: { ...UA, Range: "bytes=0-1023" }, signal: ac.signal });
    }
    if (!res.ok && res.status !== 206) return false;
    return (res.headers.get("content-type") || "").toLowerCase().startsWith("image/");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Scrape a storefront page for its product title + hero image. Throws a
 *  human-readable Error the caller can surface verbatim. */
export async function scrapeProductPage(rawInput: string): Promise<ScrapedProduct> {
  const raw = (rawInput || "").trim();
  if (!raw) throw new Error("Paste a product link first.");
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error("That doesn't look like a web address.");
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("That URL isn't allowed.");
  if (isBlockedHost(u.hostname)) throw new Error("That URL isn't allowed.");

  // Shopify storefronts expose exact product JSON — no parsing guesswork.
  if (/\/products\/[^/?#]+\/?$/.test(u.pathname)) {
    try {
      const jres = await safeFetch(`${u.origin}${u.pathname.replace(/\/$/, "")}.js`, { signal: AbortSignal.timeout(8000), headers: UA });
      if (jres.ok) {
        const pj = (await jres.json()) as { title?: string; featured_image?: string; images?: string[]; price?: number };
        if (pj?.title) {
          const first = pj.featured_image || pj.images?.[0];
          return {
            title: pj.title.slice(0, 120),
            image: first ? absolutise(first, u) : undefined,
            // Shopify's product JSON quotes price in minor units (cents).
            price: typeof pj.price === "number" ? formatPrice(pj.price / 100) : undefined,
            url: u.href,
          };
        }
      }
    } catch { /* fall through to HTML parsing */ }
  }

  const res = await fetchPage(u.href);
  if (!res.ok) throw new Error(`Couldn't reach that page (${res.status}).`);
  const html = (await res.text()).slice(0, 900_000);

  let title: string | undefined;
  let image: string | undefined;
  let price: string | undefined;

  // 1) JSON-LD Product — the richest, most reliable source when present.
  const ldBlocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of ldBlocks) {
    try {
      const data = JSON.parse(block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, ""));
      const nodes: Record<string, unknown>[] = Array.isArray(data)
        ? data
        : (data as { "@graph"?: Record<string, unknown>[] })?.["@graph"] || [data];
      const prod = nodes.find((n) => {
        const t = n?.["@type"];
        return t === "Product" || (Array.isArray(t) && (t as unknown[]).includes("Product"));
      });
      if (prod) {
        title = typeof prod.name === "string" ? prod.name : title;
        const im = Array.isArray(prod.image) ? prod.image[0] : prod.image;
        const src = typeof im === "object" && im
          ? ((im as { url?: string; contentUrl?: string; "@id"?: string }).contentUrl
            || (im as { url?: string }).url
            || (im as { "@id"?: string })["@id"])
          : (im as string | undefined);
        if (src) image = absolutise(src, u);
        // offers is either a single Offer, an array of them, or an
        // AggregateOffer carrying lowPrice. Take the cheapest thing stated —
        // that is the number the storefront leads with.
        const offers = prod.offers as
          | { price?: string | number; lowPrice?: string | number; priceCurrency?: string }
          | { price?: string | number; priceCurrency?: string }[]
          | undefined;
        const offer = Array.isArray(offers) ? offers[0] : offers;
        if (offer) {
          const amt = (offer as { price?: string | number }).price
            ?? (offer as { lowPrice?: string | number }).lowPrice;
          price = price || formatPrice(amt, offer.priceCurrency);
        }
        if (title || image) break;
      }
    } catch { /* try the next block */ }
  }

  // 2) Open Graph / Twitter cards — what Wix, Squarespace, Woo and most
  //    platforms render server-side even when the page body is JS-driven.
  const meta = (prop: string): string | undefined =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1] ||
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i"))?.[1];

  title = title || meta("og:title") || meta("twitter:title") || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  if (!image) {
    const m = meta("og:image:secure_url") || meta("og:image") || meta("twitter:image") || meta("twitter:image:src")
      || html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i)?.[1];
    if (m) image = absolutise(m, u);
  }

  // 3) Last resort: the biggest-looking <img> on the page. Skips sprites,
  //    icons, logos and tracking pixels, which are never the product shot.
  if (!image) {
    const srcs = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
    const candidate = srcs.find((s) => /\.(jpe?g|png|webp)/i.test(s) && !/(sprite|icon|logo|favicon|pixel|badge|avatar|placeholder)/i.test(s));
    if (candidate) image = absolutise(candidate, u);
  }

  // Open Graph product tags are the standard fallback when a store ships no
  // JSON-LD (older Woo themes, hand-rolled storefronts).
  if (!price) {
    price = formatPrice(
      meta("product:price:amount") || meta("og:price:amount"),
      meta("product:price:currency") || meta("og:price:currency")
    );
  }

  if (!title && !image) throw new Error("Couldn't find product info on that page.");
  const siteName = meta("og:site_name");
  return {
    title: title ? cleanProductTitle(title, siteName) : undefined,
    image: image ? upgradeImageResolution(image) : undefined,
    price,
    url: u.href,
  };
}

/** Resolve whatever the merchant pasted into the PHOTO field into a usable
 *  image URL: pass direct images through, scrape product pages for their hero
 *  image. Returns null when nothing usable is behind the link. */
export async function resolveImageOrPage(input: string): Promise<{ image: string | null; scrapedTitle?: string; why?: string }> {
  const url = (input || "").trim();
  if (!url) return { image: null };
  if (await isDirectImage(url)) return { image: url };
  try {
    const p = await scrapeProductPage(url);
    if (p.image && (await isDirectImage(p.image))) return { image: p.image, scrapedTitle: p.title };
    // "Trust it" applied to a URL the SCRAPED PAGE chose, not one the merchant
    // typed — an og:image pointing at a private host would be handed straight
    // to the render pipeline, which downloads it with no check of its own. The
    // host still has to pass; only the is-it-really-an-image part is trusted.
    if (p.image) {
      try {
        const iu = new URL(p.image);
        if (!/^https?:$/.test(iu.protocol) || isBlockedHost(iu.hostname)) return { image: null, why: "that page’s image link isn’t allowed" };
      } catch { return { image: null, why: "that page’s image link couldn’t be read" }; }
      return { image: p.image, scrapedTitle: p.title };
    }
    return { image: null, why: "we couldn't find a product image on that page" };
  } catch (e) {
    return { image: null, why: e instanceof Error ? e.message.replace(/\.$/, "") : "we couldn't read that link" };
  }
}
