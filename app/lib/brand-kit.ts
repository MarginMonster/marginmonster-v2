/* THE BRAND KIT — a store's look, read off its own homepage: name, the line it describes itself with, the
 * logo, the colours and the fonts. Pure (HTML/CSS text in, a kit out), so it is tested; the fetching and
 * saving live in brand-kit.server.ts. Every value here is a SUGGESTION the merchant sees and can change
 * on the Brand Kit page before anything is made with it. Client-safe. */

export type BrandKit = {
  name: string;
  tagline: string;
  logo: string | null;
  colors: string[];
  fonts: string[];
};

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();
const attr = (tag: string, name: string): string => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : "";
};
const metaContent = (html: string, key: "name" | "property", value: string): string => {
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) if (attr(m[0], key).toLowerCase() === value) return attr(m[0], "content");
  return "";
};

/** A URL as the page meant it: protocol-relative (Shopify's //cdn…) and relative paths resolved. */
export function absUrl(u: string, base: string): string | null {
  const s = (u || "").trim().split(/\s+/)[0];
  if (!s || /^(data|javascript|blob):/i.test(s)) return null;
  try { const r = new URL(s.startsWith("//") ? `https:${s}` : s, base); return /^https?:$/.test(r.protocol) ? r.toString() : null; } catch { return null; }
}

/** The logo: an <img> that calls itself a logo (class, id, alt or file name — the header's comes first in
 *  the page), else the touch icon (made for home screens, usually 180 px), else the favicon. */
export function findLogo(html: string, base: string): string | null {
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  for (const tag of imgs) {
    const hint = `${attr(tag, "class")} ${attr(tag, "id")} ${attr(tag, "alt")} ${attr(tag, "src")}`.toLowerCase();
    if (!/logo/.test(hint)) continue;
    const src = attr(tag, "src") || attr(tag, "data-src") || attr(tag, "srcset").split(",").pop()?.trim().split(/\s+/)[0] || "";
    const u = absUrl(src, base);
    if (u) return u;
  }
  const links = html.match(/<link\b[^>]*>/gi) || [];
  const byRel = (want: RegExp) => { for (const tag of links) if (want.test(attr(tag, "rel"))) { const u = absUrl(attr(tag, "href"), base); if (u) return u; } return null; };
  return byRel(/apple-touch-icon/i) || byRel(/(^|\s)icon(\s|$)|shortcut icon/i);
}

type RGB = [number, number, number];
const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
const toHex = ([r, g, b]: RGB) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
function parseHex(h: string): RGB | null {
  const s = h.replace("#", "");
  if (s.length === 3) return [0, 1, 2].map((i) => parseInt(s[i] + s[i], 16)) as RGB;
  if (s.length === 6) return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as RGB;
  return null;
}
/** Saturation and lightness (HSL), 0–1. */
function sl([r, g, b]: RGB): { s: number; l: number } {
  const x = [r, g, b].map((v) => v / 255);
  const max = Math.max(...x), min = Math.min(...x);
  const l = (max + min) / 2;
  const d = max - min;
  return { s: d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), l };
}

/** The brand's colours: every colour the page and its theme CSS name — hex, rgb(), and the bare
 *  "18, 18, 18" triplets Shopify themes keep in custom properties — counted, with the theme-color meta
 *  counted heavily. Greys, near-white and near-black are left out (every site has them; they say nothing
 *  about the brand); the most-used remaining colours come first, near-duplicates merged. */
export function findColors(text: string, themeColor = "", max = 5): string[] {
  const count = new Map<string, number>();
  const add = (rgb: RGB | null, w = 1) => {
    if (!rgb || rgb.some((v) => !Number.isFinite(v))) return;
    const { s, l } = sl(rgb);
    if (s < 0.22 || l > 0.93 || l < 0.08) return;
    const k = toHex(rgb);
    count.set(k, (count.get(k) || 0) + w);
  };
  for (const m of text.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) add(parseHex(m[0]));
  for (const m of text.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi)) add([+m[1], +m[2], +m[3]]);
  for (const m of text.matchAll(/--[\w-]*colou?r[\w-]*\s*:\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*[;}]/gi)) add([+m[1], +m[2], +m[3]], 2);
  const tc = parseHex(themeColor.trim());
  if (tc) add(tc, 25);
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => parseHex(k) as RGB);
  const out: RGB[] = [];
  for (const c of ranked) {
    // a shade within ~10% of one already picked is the same brand colour
    if (out.some((o) => Math.hypot(o[0] - c[0], o[1] - c[1], o[2] - c[2]) < 40)) continue;
    out.push(c);
    if (out.length >= max) break;
  }
  return out.map(toHex);
}

const GENERIC = new Set(["sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui", "-apple-system", "blinkmacsystemfont", "inherit", "initial", "unset", "var", "arial", "helvetica", "helvetica neue", "segoe ui", "roboto", "times new roman", "times", "georgia", "verdana", "tahoma", "courier new", "ui-sans-serif", "ui-serif", "ui-monospace", "apple color emoji", "segoe ui emoji", "segoe ui symbol", "noto color emoji", "emoji"]);
// icon fonts are not the brand's type
const ICON_FONT = /icon|awesome|slick|swiper|material|dashicons|glyph|fontello|icomoon|feather|lucide|remixicon|social/i;
/** A family name as people say it. Builders ship machine names: Wix "poppins-v2",
 *  "avenir-lt-w01_35-light1475496" → "Poppins", "Avenir Lt". */
function cleanFamily(f: string): string {
  let n = decode(f).replace(/!important/gi, "").replace(/^['"\s]+|['"\s]+$/g, "").replace(/\+/g, " ").replace(/\s+/g, " ").trim();
  if (/^[a-z0-9_-]+$/.test(n) && /[-_]/.test(n)) {
    n = n.replace(/_\d.*$/, "").replace(/-w\d{2}(?:-.*)?$/i, "").replace(/-v\d+$/i, "").replace(/[-_]+/g, " ").trim();
    n = n.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  }
  return n;
}

/** The brand's fonts: Google Fonts families the page loads, the families its @font-face rules and
 *  font-family declarations name (Shopify themes: --font-heading-family / --font-body-family; a value
 *  that is var(--x) is looked up once) — most-used first, the system, generic and icon fonts left out. */
export function findFonts(text: string, max = 3): string[] {
  const count = new Map<string, number>();
  const resolve = (v: string): string => {
    const m = /^\s*var\(\s*(--[\w-]+)/.exec(v);
    if (!m) return v;
    const def = new RegExp(`${m[1].replace(/[-]/g, "\\-")}\\s*:\\s*([^;}]+)`).exec(text);
    return def && !/^\s*var\(/.test(def[1]) ? def[1] : "";
  };
  const add = (raw: string, w = 1) => {
    // the generic/system names are checked as written ("-apple-system"), before any tidying renames them
    const first = decode(resolve(raw).split(",")[0]).replace(/!important/gi, "").replace(/^['"\s]+|['"\s]+$/g, "");
    if (!first || GENERIC.has(first.toLowerCase())) return;
    const name = cleanFamily(first);
    if (!name || name.length > 40 || /[{}<>;$()]/.test(name) || GENERIC.has(name.toLowerCase()) || ICON_FONT.test(name)) return;
    const key = name.toLowerCase();
    const shown = [...count.keys()].find((k) => k.toLowerCase() === key) || name;
    count.set(shown, (count.get(shown) || 0) + w);
  };
  for (const m of text.matchAll(/fonts\.googleapis\.com\/css2?\?[^"'\s>]*/gi)) {
    for (const fam of m[0].matchAll(/family=([^&:"']+)/gi)) add(fam[1].split(":")[0], 6);
  }
  for (const m of text.matchAll(/--font-[\w-]*family\s*:\s*([^;}]+)/gi)) add(m[1].split(",")[0], 5);
  for (const m of text.matchAll(/@font-face\s*{[^}]*?font-family\s*:\s*([^;}]+)/gi)) add(m[1].split(",")[0], 2);
  for (const m of text.matchAll(/font-family\s*:\s*([^;}]+)/gi)) add(m[1].split(",")[0]);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => k);
}

/** The whole kit from a homepage (and, optionally, the text of its theme CSS). */
export function extractBrandKit(html: string, base: string, css = ""): BrandKit {
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "").replace(/\s+/g, " ");
  const name = metaContent(html, "property", "og:site_name") || decode(title).split(/\s[|–—-]\s/)[0] || "";
  const tagline = (metaContent(html, "name", "description") || metaContent(html, "property", "og:description")).slice(0, 200);
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n") + "\n" + [...html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).join("\n");
  const fontsText = `${html.match(/<link\b[^>]*fonts\.googleapis\.com[^>]*>/gi)?.join("\n") || ""}\n${styles}\n${css}`;
  return {
    name: decode(name).slice(0, 80),
    tagline: decode(tagline),
    logo: findLogo(html, base),
    colors: findColors(`${styles}\n${css}`, metaContent(html, "name", "theme-color")),
    fonts: findFonts(fontsText),
  };
}

/** Theme stylesheets worth reading for colours and fonts: the page's own CSS (the theme's base.css /
 *  theme.css / styles), first few only. */
export function themeStylesheets(html: string, base: string, max = 3): string[] {
  const out: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (!/stylesheet/i.test(attr(tag, "rel"))) continue;
    const u = absUrl(attr(tag, "href"), base);
    if (!u || /fonts\.googleapis|font-awesome|bootstrap|cdnjs|jsdelivr|unpkg/i.test(u)) continue;
    out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

/** The kit's colours as one clause for an image prompt — the set, props, backdrop and lighting, never the
 *  product (a recoloured product is not the merchant's product). "" when the brand has no kit colours, so
 *  every prompt without a kit is unchanged. */
export function paletteLine(visual: unknown): string {
  const kit = visual && typeof visual === "object" ? (visual as { kit?: { colors?: unknown } }).kit : undefined;
  const cs = Array.isArray(kit?.colors) ? kit!.colors.map((c) => normalizeHex(String(c))).filter((c): c is string => !!c).slice(0, 4) : [];
  return cs.length ? `Brand colour palette for the set, props, backdrop and lighting accents: ${cs.join(", ")} — never recolour the product itself.` : "";
}

/** "#0C7A46" / "0c7a46" / "#abc" → "#0c7a46"; anything else → null. */
export function normalizeHex(v: string): string | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec((v || "").trim());
  if (!m) return null;
  const rgb = parseHex(m[1]);
  return rgb ? toHex(rgb) : null;
}
