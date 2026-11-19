/* THE BRAND KIT, server half: read a store's homepage (and a few of its theme stylesheets) through the
 * app's SSRF-guarded fetch, keep the logo on our own render disk, and save the kit on the brand profile
 * (visualJson.kit) — never overwriting the other things the profile carries. What the merchant edits on
 * the Brand Kit page is saved here too. */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db.server";
import { safeFetch, upgradeImageResolution } from "./product-scrape.server";
import { extractBrandKit, themeStylesheets, normalizeHex, type BrandKit } from "./brand-kit";
import { runFfmpeg } from "./ugc-ad-pipeline.server";
import { mirrorRender } from "./object-storage.server";

/** A kit as kept: what was read (or edited), the logo as we serve it, and where it came from. */
export type SavedKit = BrandKit & { logoLocal?: string | null; from?: string; at?: string; edited?: boolean };

const UA = { "User-Agent": "Mozilla/5.0 (compatible; EasyModeBrandKit/1.0; +https://easymodeapp.com)", Accept: "text/html,text/css,image/*,*/*;q=0.5" };
const RENDERS = () => path.join(process.cwd(), "data", "renders");

async function readBody(url: string, cap: number, ms: number): Promise<{ buf: Buffer; type: string; url: string } | null> {
  try {
    const r = await safeFetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    const len = Number(r.headers.get("content-length") || 0);
    if (len > cap * 3) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return { buf: buf.subarray(0, cap), type: (r.headers.get("content-type") || "").toLowerCase(), url: r.url || url };
  } catch { return null; }
}

/** The logo onto our own disk (a store's CDN link can change or vanish): PNG/JPEG/WebP kept as they are,
 *  an icon or a GIF turned into a PNG. An SVG stays a link — browsers draw it; nothing here rasterises it. */
async function keepLogo(shopId: string, url: string): Promise<string | null> {
  const got = await readBody(upgradeImageResolution(url), 4_000_000, 12_000);
  if (!got || got.buf.length < 200) return null;
  const t = got.type;
  const ext = /png/.test(t) ? "png" : /jpe?g/.test(t) ? "jpg" : /webp/.test(t) ? "webp" : /icon|ico|gif/.test(t) ? "convert" : /svg/.test(t) ? "svg" : "";
  if (!ext || ext === "svg") return null;
  const name = `brandlogo-${shopId.slice(-8)}-${crypto.createHash("sha1").update(got.buf).digest("hex").slice(0, 10)}`;
  const dir = RENDERS();
  fs.mkdirSync(dir, { recursive: true });
  if (ext !== "convert") {
    const file = `${name}.${ext}`;
    fs.writeFileSync(path.join(dir, file), got.buf);
    try { await mirrorRender(file, got.buf); } catch { /* the disk copy is served */ }
    return `/renders/${file}`;
  }
  const src = path.join(dir, `${name}.src`);
  const out = path.join(dir, `${name}.png`);
  try {
    fs.writeFileSync(src, got.buf);
    const r = await runFfmpeg(["-y", "-i", src, "-frames:v", "1", out]);
    if (r.status !== 0 || !fs.existsSync(out)) return null;
    try { await mirrorRender(`${name}.png`, fs.readFileSync(out)); } catch { /* the disk copy is served */ }
    return `/renders/${name}.png`;
  } finally { try { fs.unlinkSync(src); } catch { /* best effort */ } }
}

/** Read a store's look off its homepage. Null when the page can't be read. */
export async function readStoreKit(shopId: string, storeUrl: string): Promise<SavedKit | null> {
  const page = await readBody(storeUrl, 1_500_000, 15_000);
  if (!page || !/html/.test(page.type || "text/html")) return null;
  const html = page.buf.toString("utf8");
  let css = "";
  for (const u of themeStylesheets(html, page.url)) {
    const c = await readBody(u, 600_000, 8_000);
    if (c) css += c.buf.toString("utf8") + "\n";
  }
  const kit = extractBrandKit(html, page.url, css);
  const logoLocal = kit.logo ? await keepLogo(shopId, kit.logo) : null;
  return { ...kit, logoLocal, from: page.url, at: new Date().toISOString() };
}

const parse = (s: string | null | undefined): Record<string, unknown> => { try { const v = JSON.parse(s || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}; } catch { return {}; } };

/** The kit on file for a shop (null when there is none yet). */
export async function kitFor(shopId: string): Promise<SavedKit | null> {
  const p = await db.brandProfile.findUnique({ where: { shopId }, select: { visualJson: true } });
  const kit = parse(p?.visualJson).kit as SavedKit | undefined;
  return kit && typeof kit === "object" ? kit : null;
}

/** Save a kit on the shop's brand profile (creating the profile if this is the first brand info), merged
 *  into what visualJson already holds and pinned to the row it was read from. Colours and fonts are
 *  cleaned here, whoever sent them. */
export async function saveKit(shopId: string, kit: SavedKit): Promise<boolean> {
  const clean: SavedKit = {
    name: String(kit.name || "").slice(0, 80),
    tagline: String(kit.tagline || "").slice(0, 200),
    logo: kit.logo && /^https?:\/\//.test(kit.logo) ? kit.logo.slice(0, 600) : null,
    logoLocal: kit.logoLocal && /^\/renders\/[A-Za-z0-9._-]+$/.test(kit.logoLocal) ? kit.logoLocal : null,
    colors: (kit.colors || []).map((c) => normalizeHex(c)).filter((c): c is string => !!c).slice(0, 6),
    fonts: (kit.fonts || []).map((f) => String(f).replace(/[{}<>;"]/g, "").trim().slice(0, 40)).filter(Boolean).slice(0, 3),
    from: kit.from ? String(kit.from).slice(0, 300) : undefined,
    at: new Date().toISOString(),
    edited: !!kit.edited,
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const p = await db.brandProfile.findUnique({ where: { shopId }, select: { visualJson: true } });
    if (!p) {
      try {
        await db.brandProfile.create({ data: { shopId, voiceJson: "{}", productJson: "{}", visualJson: JSON.stringify({ kit: clean }) } });
        return true;
      } catch { continue; } // created meanwhile — merge into it
    }
    const saved = await db.brandProfile.updateMany({ where: { shopId, visualJson: p.visualJson }, data: { visualJson: JSON.stringify({ ...parse(p.visualJson), kit: clean }) } });
    if (saved.count === 1) return true;
  }
  return false;
}
