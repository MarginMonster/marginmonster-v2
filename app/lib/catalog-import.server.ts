/* Pull a merchant's WHOLE catalogue in from one storefront URL.
 *
 * Shopify-embedded shops read their products live off the Admin API. Web
 * accounts have no such API, so pasting a link and retyping the title on every
 * generation was the only option — which is a tax the merchant pays forever.
 * This mirrors their catalogue once so the Studio can offer a picker instead.
 *
 * Three strategies, cheapest first. The first two are exact machine-readable
 * feeds; the third is a crawl and is therefore capped and rate-limited, because
 * it hits the merchant's own server once per product.
 *
 *   1. Shopify      /products.json           — paginated, complete, ~1 call/250
 *   2. WooCommerce  /wp-json/wc/store/products — Store API, public, no auth
 *   3. Anything else: sitemap.xml → product URLs → scrapeProductPage each
 *
 * SSRF: every host goes through isBlockedHost before we fetch it. */

import { db } from "../db.server";
import { fetchRetry } from "./http-retry.server";
import { isBlockedHost, scrapeProductPage, upgradeImageResolution } from "./product-scrape.server";

export interface DiscoveredProduct {
  title: string;
  url: string;
  imageUrl?: string;
  handle?: string;
  priceText?: string;
}

/** Hard ceiling on ONE import. A crawl costs the merchant's own server a
 *  request per product, and nobody picks from a 4,000-tile grid anyway. */
export const CATALOG_CAP = 300;
/** Sitemap crawling only: how many product pages we fetch at once. Deliberately
 *  small — this is someone's live storefront, not a scraping target. */
const CRAWL_CONCURRENCY = 4;

const UA: Record<string, string> = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  accept: "application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

/** Normalise whatever the merchant typed into a storefront origin. */
export function storeOrigin(raw: string): URL {
  const t = (raw || "").trim();
  if (!t) throw new Error("Paste your store's web address first.");
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    throw new Error("That doesn't look like a web address.");
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("That address isn't allowed.");
  if (isBlockedHost(u.hostname)) throw new Error("That address isn't allowed.");
  return u;
}

const json = async (url: string, timeoutMs = 12_000): Promise<unknown | null> => {
  try {
    const res = await fetchRetry(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) }, { attempts: 2 });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("json")) return null;
    return await res.json();
  } catch {
    return null;
  }
};

/* ---------- 1) Shopify: /products.json ---------- */

type ShopifyProduct = {
  title?: string;
  handle?: string;
  images?: { src?: string }[];
  variants?: { price?: string }[];
};

async function fromShopify(origin: URL, cap: number): Promise<DiscoveredProduct[]> {
  const out: DiscoveredProduct[] = [];
  for (let page = 1; page <= 12 && out.length < cap; page++) {
    const data = (await json(`${origin.origin}/products.json?limit=250&page=${page}`)) as
      | { products?: ShopifyProduct[] }
      | null;
    const list = data?.products;
    if (!Array.isArray(list) || list.length === 0) break;
    for (const p of list) {
      if (!p?.title || !p?.handle) continue;
      out.push({
        title: p.title.slice(0, 200),
        url: `${origin.origin}/products/${p.handle}`,
        imageUrl: p.images?.[0]?.src ? upgradeImageResolution(p.images[0].src) : undefined,
        handle: p.handle,
        priceText: p.variants?.[0]?.price ? `$${p.variants[0].price}` : undefined,
      });
      if (out.length >= cap) break;
    }
    if (list.length < 250) break; // last page
  }
  return out;
}

/* ---------- 2) WooCommerce: the public Store API ---------- */

type WooProduct = {
  name?: string;
  permalink?: string;
  slug?: string;
  images?: { src?: string }[];
  prices?: { price?: string; currency_prefix?: string };
};

async function fromWoo(origin: URL, cap: number): Promise<DiscoveredProduct[]> {
  const out: DiscoveredProduct[] = [];
  for (let page = 1; page <= 12 && out.length < cap; page++) {
    const data = (await json(`${origin.origin}/wp-json/wc/store/products?per_page=100&page=${page}`)) as
      | WooProduct[]
      | null;
    if (!Array.isArray(data) || data.length === 0) break;
    for (const p of data) {
      if (!p?.name || !p?.permalink) continue;
      out.push({
        title: p.name.slice(0, 200),
        url: p.permalink,
        imageUrl: p.images?.[0]?.src ? upgradeImageResolution(p.images[0].src) : undefined,
        handle: p.slug,
        // Store API prices are minor units as a string; leave formatting to it.
        priceText: p.prices?.price ? `${p.prices.currency_prefix || ""}${p.prices.price}` : undefined,
      });
      if (out.length >= cap) break;
    }
    if (data.length < 100) break;
  }
  return out;
}

/* ---------- 3) Everyone else: sitemap → product pages ---------- */

const PRODUCT_URL = /\/(products?|product-page|shop|item|p)\//i;

async function fetchText(url: string, timeoutMs = 12_000): Promise<string | null> {
  try {
    const res = await fetchRetry(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) }, { attempts: 2 });
    if (!res.ok) return null;
    return (await res.text()).slice(0, 3_000_000);
  } catch {
    return null;
  }
}

/** Walk sitemap.xml (following sitemap indexes one level) for product URLs. */
async function productUrlsFromSitemaps(origin: URL, cap: number): Promise<string[]> {
  const seen = new Set<string>();
  const roots = [`${origin.origin}/sitemap.xml`, `${origin.origin}/sitemap_index.xml`, `${origin.origin}/sitemap-index.xml`];
  const queue: string[] = [];

  for (const root of roots) {
    const xml = await fetchText(root);
    if (!xml) continue;
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    // A sitemap index points at more sitemaps; a urlset points at pages.
    const isIndex = /<sitemapindex/i.test(xml);
    if (isIndex) {
      // Prefer children that look product-ish so we don't pull the blog too.
      // Match on the PATH, not the whole URL — a domain like
      // shopmagicmonster.com contains "shop" and would match everything. And
      // anchor the words: the literal substring "item" lives inside the word
      // "sitemap", so an unanchored test matched every child sitemap and this
      // filter silently did nothing on every store.
      const productish = /(^|[/_-])(products?|shop|store|items?|collections?)([/_.-]|$)/i;
      const kids = locs.filter((l) => {
        try { return productish.test(new URL(l).pathname); } catch { return false; }
      });
      queue.push(...(kids.length ? kids : locs).slice(0, 25));
    } else {
      for (const l of locs) if (PRODUCT_URL.test(l)) seen.add(l);
    }
    if (seen.size >= cap) break;
  }

  for (const sm of queue) {
    if (seen.size >= cap) break;
    const xml = await fetchText(sm);
    if (!xml) continue;
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      if (PRODUCT_URL.test(m[1])) seen.add(m[1]);
      if (seen.size >= cap) break;
    }
  }
  return [...seen].slice(0, cap);
}

/** Scrape a list of product pages with a small worker pool. */
async function crawlProductPages(urls: string[], onProgress?: (n: number) => void): Promise<DiscoveredProduct[]> {
  const out: DiscoveredProduct[] = [];
  let i = 0;
  const worker = async () => {
    for (;;) {
      const idx = i++;
      if (idx >= urls.length) return;
      const url = urls[idx];
      try {
        const p = await scrapeProductPage(url);
        if (p.title) {
          // priceText comes through here too — the Shopify and Woo feeds carry
          // a price, and a crawled store has one in its JSON-LD/OG tags, so a
          // sitemap-imported catalogue is no longer priceless.
          out.push({ title: p.title.slice(0, 200), url, imageUrl: p.image, handle: undefined, priceText: p.price });
        }
      } catch { /* one dead product page never kills the import */ }
      onProgress?.(out.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CRAWL_CONCURRENCY, urls.length) }, worker));
  return out;
}

/* ---------- Orchestration ---------- */

export interface DiscoverResult {
  products: DiscoveredProduct[];
  source: "shopify" | "woocommerce" | "sitemap";
}

/** Find as much of a storefront's catalogue as we reasonably can. */
export async function discoverCatalog(rawUrl: string, cap = CATALOG_CAP): Promise<DiscoverResult> {
  const origin = storeOrigin(rawUrl);

  const shopify = await fromShopify(origin, cap);
  if (shopify.length) return { products: shopify, source: "shopify" };

  const woo = await fromWoo(origin, cap);
  if (woo.length) return { products: woo, source: "woocommerce" };

  const urls = await productUrlsFromSitemaps(origin, cap);
  if (!urls.length) {
    throw new Error(
      "We couldn't find a product list on that site. Double-check the address — or keep pasting individual product links, which always works."
    );
  }
  const crawled = await crawlProductPages(urls);
  if (!crawled.length) throw new Error("We found product pages but couldn't read any of them.");
  return { products: crawled, source: "sitemap" };
}

/** Discover + persist. Returns what changed so the UI can be honest about it. */
export async function importCatalog(
  shopId: string,
  rawUrl: string,
  cap = CATALOG_CAP
): Promise<{ imported: number; removed: number; source: string }> {
  const { products, source } = await discoverCatalog(rawUrl, cap);
  const startedAt = new Date();

  let position = 0;
  for (const p of products) {
    const data = {
      title: p.title,
      imageUrl: p.imageUrl || null,
      handle: p.handle || null,
      priceText: p.priceText || null,
      position: position++,
      lastSeenAt: startedAt,
    };
    try {
      await db.catalogProduct.upsert({
        where: { shopId_url: { shopId, url: p.url } },
        create: { shopId, url: p.url, ...data },
        update: data,
      });
    } catch (e) {
      console.error("[catalog] upsert failed for", p.url, e instanceof Error ? e.message.slice(0, 120) : e);
    }
  }

  // Anything the newest sync didn't see is delisted upstream. Only sweep when
  // the import actually returned a healthy set — a half-failed crawl must never
  // wipe a catalogue the merchant already has.
  let removed = 0;
  if (products.length >= 5) {
    const gone = await db.catalogProduct.deleteMany({
      where: { shopId, lastSeenAt: { lt: startedAt } },
    });
    removed = gone.count;
  }

  return { imported: products.length, removed, source };
}

/** The merchant's own product page for a title we generated an ad about.
 *
 *  Matched on title rather than threaded through every pipeline's metaJson:
 *  the title came FROM the picker, so it matches exactly, and this works
 *  retroactively for everything already in the Archive. Empty string when
 *  there's no catalogue or no match — callers treat that as "no link". */
export async function productLinkFor(shopId: string, productTitle?: string | null): Promise<string> {
  const t = (productTitle || "").trim();
  if (!t) return "";
  try {
    const hit = await db.catalogProduct.findFirst({
      where: { shopId, title: t },
      select: { url: true },
    });
    return hit?.url || "";
  } catch {
    return "";
  }
}

/** The catalogue image for a product we generated an ad about.
 *
 *  Ads made before metaJson carried the photo have no way to rebuild — but if
 *  the merchant has since mirrored their store, the photo is sitting right
 *  there under the same title. Recovers the whole back catalogue for remixing
 *  instead of stranding it. */
export async function catalogImageFor(shopId: string, productTitle?: string | null): Promise<string | null> {
  const t = (productTitle || "").trim();
  if (!t) return null;
  try {
    const hit = await db.catalogProduct.findFirst({
      where: { shopId, title: t, imageUrl: { not: null } },
      select: { imageUrl: true },
    });
    return hit?.imageUrl || null;
  } catch {
    return null;
  }
}
