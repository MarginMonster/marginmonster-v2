/* A share link opens a public page for ONE piece — its media and title only — and only while the piece
 * still carries the token the link was made with. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the public page reads one asset's media and title — never the shop", () => {
  const src = read("app/routes/s.$assetId.$token.tsx");
  assert.ok(src.includes("select: { title: true, type: true, bodyJson: true, metaJson: true }"), "only these columns");
  assert.ok(!/include:\s*\{\s*shop/.test(src) && !src.includes("db.shop"), "no shop row on a public page");
  assert.ok(src.includes("timingSafeEqual"), "the token is compared in constant time");
  assert.ok(src.includes('"X-Robots-Tag": "noindex"') && src.includes('{ name: "robots", content: "noindex" }'), "kept out of search engines");
  assert.ok(src.includes("utm_source=share"), "the badge is tracked");
});

test("sharing is the owner's, per piece, and stopping it kills the link", () => {
  const src = read("app/routes/web.archive.tsx");
  const act = src.slice(src.indexOf('if (intent === "share" || intent === "unshare")'), src.indexOf("// AD PACK · AD COPY"));
  assert.ok(act.includes("shopId: shop.id"), "only the shop's own pieces");
  assert.ok(act.includes("randomBytes(12)"), "an unguessable token");
  assert.ok(/updateMany\(\{ where: \{ id: a\.id, shopId: shop\.id, metaJson: a\.metaJson \}/.test(act), "pinned writes");
  assert.ok(act.includes('filter(([k]) => k !== "share")'), "unshare removes the token");
});

test("the page itself carries noindex (not only its data requests)", () => {
  const src = read("app/routes/s.$assetId.$token.tsx");
  assert.ok(src.includes("export const headers: HeadersFunction"), "document headers exported");
});
