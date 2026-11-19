/* The Brand Kit read off a store's homepage: name, tagline, logo, colours, fonts. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractBrandKit, findColors, findFonts, findLogo, absUrl, themeStylesheets, normalizeHex } from "../app/lib/brand-kit.ts";

// A cut-down Shopify (Dawn-style) homepage — the shapes these themes really use.
const HTML = `<!doctype html><html><head>
<title>Magic Monster Vending – Snacks &amp; Toys</title>
<meta name="description" content="Claw machines, candy and capsule toys for game rooms and arcades.">
<meta property="og:site_name" content="Magic Monster Vending">
<meta name="theme-color" content="#5B2C83">
<link rel="apple-touch-icon" href="/cdn/shop/files/icon-180.png">
<link rel="icon" type="image/png" href="//magicmonster.com/cdn/shop/files/favicon_32x32.png">
<link href="https://fonts.googleapis.com/css2?family=Bungee&family=Nunito+Sans:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="//magicmonster.com/cdn/shop/t/4/assets/base.css?v=123" media="all">
<style>
:root{--font-body-family: Nunito Sans, sans-serif; --font-heading-family: Bungee, sans-serif;
--color-base-text: 18, 18, 18; --color-base-accent-1: 91, 44, 131; --color-base-accent-2: 255, 196, 0;
--color-base-background-1: 255, 255, 255;}
.button{background:#5b2c83;color:#ffffff}.badge{background:#FFC400}.muted{color:#777}
</style></head><body>
<header><a href="/"><img src="//magicmonster.com/cdn/shop/files/MM_logo_wide.png?v=1&width=300" class="header__heading-logo" alt="Magic Monster Vending"></a></header>
<img src="/cdn/shop/products/claw.jpg" alt="Claw machine">
</body></html>`;

test("the whole kit comes off a Shopify homepage", () => {
  const kit = extractBrandKit(HTML, "https://magicmonster.com/");
  assert.equal(kit.name, "Magic Monster Vending");
  assert.equal(kit.tagline, "Claw machines, candy and capsule toys for game rooms and arcades.");
  assert.equal(kit.logo, "https://magicmonster.com/cdn/shop/files/MM_logo_wide.png?v=1&width=300", "the header's logo, protocol-relative resolved");
  assert.equal(kit.colors[0], "#5b2c83", "theme-color + the accent the buttons use lead");
  assert.ok(kit.colors.includes("#ffc400"), "the second accent is in");
  assert.ok(!kit.colors.includes("#121212") && !kit.colors.includes("#777777") && !kit.colors.includes("#ffffff"), "no greys, black or white");
  assert.deepEqual(kit.fonts.slice(0, 2).sort(), ["Bungee", "Nunito Sans"]);
});

test("no logo image → the touch icon → the favicon", () => {
  const noImg = HTML.replace(/<img[^>]*header__heading-logo[^>]*>/, "");
  assert.equal(findLogo(noImg, "https://magicmonster.com/"), "https://magicmonster.com/cdn/shop/files/icon-180.png");
  const onlyFav = noImg.replace(/<link rel="apple-touch-icon"[^>]*>/, "");
  assert.equal(findLogo(onlyFav, "https://magicmonster.com/"), "https://magicmonster.com/cdn/shop/files/favicon_32x32.png");
  assert.equal(findLogo("<html></html>", "https://x.com/"), null);
});

test("colours: near-duplicates merge, greys never count", () => {
  const c = findColors("a{color:#0c7a46}b{color:#0d7b47}c{color:#0c7a46}d{color:#cccccc}e{color:#111}f{color:rgb(231,200,121)}");
  assert.deepEqual(c, ["#0c7a46", "#e7c879"]);
  assert.deepEqual(findColors("", "#12A85E"), ["#12a85e"], "theme-color alone");
});

test("fonts: generic fallbacks are not fonts", () => {
  assert.deepEqual(findFonts("body{font-family:-apple-system, BlinkMacSystemFont, sans-serif}"), []);
  assert.deepEqual(findFonts("h1{font-family:'Playfair Display', serif} p{font-family:Inter,sans-serif} h2{font-family:'Playfair Display'}"), ["Playfair Display", "Inter"]);
});

test("urls, stylesheets and hex inputs", () => {
  assert.equal(absUrl("//cdn.shopify.com/a.png", "https://x.com/"), "https://cdn.shopify.com/a.png");
  assert.equal(absUrl("javascript:alert(1)", "https://x.com/"), null);
  assert.equal(absUrl("data:image/png;base64,AAA", "https://x.com/"), null);
  assert.deepEqual(themeStylesheets(HTML, "https://magicmonster.com/"), ["https://magicmonster.com/cdn/shop/t/4/assets/base.css?v=123"], "the theme's own CSS, not Google Fonts");
  assert.equal(normalizeHex("#0C7A46"), "#0c7a46");
  assert.equal(normalizeHex("abc"), "#aabbcc");
  assert.equal(normalizeHex("red"), null);
});

test("fonts as builders write them: var() looked up, icon fonts and !important dropped, Wix names cleaned", () => {
  const css = ":root{--font-sans: Geograph, Arial, sans-serif} body{font-family:var(--font-sans)!important} .slick-arrow{font-family:slick} h1{font-family:var(--font-sans)}";
  assert.deepEqual(findFonts(css), ["Geograph"]);
  assert.deepEqual(findFonts("p{font-family:poppins-v2}p{font-family:poppins-v2}h{font-family:avenir-lt-w01_35-light1475496}"), ["Poppins", "Avenir Lt"]);
  assert.deepEqual(findFonts("i{font-family:'Font Awesome 6 Free'}"), []);
});

import { paletteLine } from "../app/lib/brand-kit.ts";
import fs from "node:fs";
test("image ads get the kit's colours as accents — and nothing changes without a kit", () => {
  assert.equal(paletteLine({}), "");
  assert.equal(paletteLine({ kit: { colors: [] } }), "");
  const line = paletteLine({ kit: { colors: ["#5B2C83", "ffc400", "nope"] } });
  assert.ok(line.includes("#5b2c83, #ffc400") && !line.includes("nope"));
  assert.ok(/never recolour the product/.test(line));
  const img = fs.readFileSync(new URL("../app/lib/image-generation.server.ts", import.meta.url), "utf8");
  assert.equal((img.match(/withPalette\(visual\.imageStyle/g) || []).length, 3, "every place the brand's image style goes into a prompt");
});

test("the Brand Kit page saves pinned, uploads upright, and fetches through the SSRF guard", () => {
  const page = fs.readFileSync(new URL("../app/routes/web.brand.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("await uprightPhoto("), "an uploaded logo is stood upright like every user photo");
  assert.ok(/updateMany\(\{ where: \{ shopId: shop\.id, voiceJson: p\.voiceJson \}/.test(page), "the voice merge is pinned");
  const srv = fs.readFileSync(new URL("../app/lib/brand-kit.server.ts", import.meta.url), "utf8");
  assert.ok(srv.includes("safeFetch(") && !/\bfetch\(/.test(srv.replace(/safeFetch\(/g, "")), "every outbound read goes through safeFetch");
  assert.ok(/updateMany\(\{ where: \{ shopId, visualJson: p\.visualJson \}/.test(srv), "the kit save is pinned");
});

test("reading the store shows a kit; only Save applies it", () => {
  const page = fs.readFileSync(new URL("../app/routes/web.brand.tsx", import.meta.url), "utf8");
  const read = page.slice(page.indexOf('if (intent === "read")'), page.indexOf('if (intent === "save")'));
  assert.ok(read.includes("readStoreKit(") && !read.includes("saveKit("), "a read is never saved by itself");
});
