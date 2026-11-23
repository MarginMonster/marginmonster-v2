/* EVERY AD WRITER KNOWS THE PRICE — OR KNOWS THERE IS NONE.
 *
 * The Ad Maker shows the same three quick directions under every style; one is "fast + funny, lead with the
 * price". Only the image-ad writer and (since 3e9d4d01) the Commercial were given the product's real price.
 * The talking script, the jingle and the cartoon voice-over were not — a writer told to lead with a price it
 * does not have invents price talk ("the lowest price around"). One rule now, in one place, for all of them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claimFaults, cleanPrice, priceRule, saysAPrice } from "../app/lib/ad-claims.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("the catalogue has the price: that figure, once, and nothing else about price", () => {
  const r = priceRule("  $43.14 \n", "fast + funny, lead with the price");
  assert.equal(r, "PRICE: the real price is $43.14. If the direction asks for the price, say exactly that figure, once. Say NOTHING else about price — never \"lowest\", \"best\", \"cheapest\", \"deal\", a discount, a saving or a comparison with anyone.");
  assert.equal(cleanPrice("  $43.14 \n USD "), "$43.14 USD");
  assert.equal(cleanPrice(null), "");
  assert.equal(cleanPrice("x".repeat(90)).length, 40);
});

test("no catalogue price, but the merchant typed one: theirs, exactly as written", () => {
  const r = priceRule(null, "Weekly lawn care. tell them it's $49 a month");
  assert.ok(r.startsWith("PRICE: the only price you may say is the figure written in the merchant's own words above — exactly as they wrote it, once."));
  assert.ok(r.endsWith("unless those words are the merchant's own too."));
  for (const said of ["$49 a month", "only 49 dollars", "Rs. 500 per box", "€12,50", "USD 1,200", "£5", "20 bucks", "99 cents", "₹250"]) assert.equal(saysAPrice(said), true, said);
});

test("nobody gave a price: no price talk at all, whatever the direction asks", () => {
  const none = "PRICE: no price was given. Do not mention price, cost, deals, savings or value for money at all — even if the direction asks for the price, sell on the product itself.";
  assert.equal(priceRule(null, "fast + funny, lead with the price"), none);
  assert.equal(priceRule("", ""), none);
  assert.equal(priceRule(undefined, undefined), none);
  // numbers that are not prices do not open the door
  for (const said of ["16 per set", "a 12-pack, 2024 series", "ages 3 and up", "100% cotton", "lead with the price", "V2, size 40", ""]) assert.equal(saysAPrice(said), false, said);
  assert.equal(saysAPrice(null), false);
});

test("the figure a writer was given is the merchant's to say; the claims reader agrees", () => {
  // the catalogue price is part of what the merchant said — saying it is not a fault…
  assert.deepEqual(claimFaults("Forty-three fourteen. That's $43.14 for sixteen boxes.", "Palmsize Wonders \n $43.14"), []);
  // …and the price talk the rule forbids is still caught when the writer adds it
  assert.deepEqual(claimFaults("Just $43.14, the lowest price around.", "Palmsize Wonders \n $43.14"), ["lowest price", "price around"]);
});

test("every writer whose words go out in an ad is given the rule and the catalogue's price", () => {
  const commercial = read("app", "lib", "commercial-ad-pipeline.server.ts");
  assert.ok(commercial.includes("priceRule(price, [productDescription, direction].filter(Boolean).join(\" \")),"));

  const ugc = read("app", "lib", "ugc-ad-pipeline.server.ts");
  assert.ok(ugc.includes("priceRule(p.price, [p.productDescription, p.direction].filter(Boolean).join(\" \")),"));
  assert.ok(ugc.includes("const priced = { ...params, price: params.serviceMode ? null : await catalogPriceFor(params.shopId, params.productTitle) };"), "the free preview");
  assert.ok(ugc.includes("const priced = { ...params, price: params.serviceMode || params.resume?.script ? null : await catalogPriceFor(params.shopId, params.productTitle) };"), "the paid render — not looked up when the member's own approved words are used");
  // the old "you have only the name" line no longer forbids a price the writer was just given
  assert.ok(ugc.includes("state no specific spec, material, size, count, ingredient${p.price ? \"\" : \", price\"} or result;"));

  const jingle = read("app", "lib", "jingle-ad-pipeline.server.ts");
  assert.ok(jingle.includes("priceRule(p.price, [p.productDescription, p.direction].filter(Boolean).join(\" \")),"));
  assert.equal(jingle.split("const priced = { ...params, price: params.serviceMode ? null : await catalogPriceFor(params.shopId, params.productTitle) };").length - 1, 2, "the preview and the render");

  const cartoon = read("app", "lib", "cartoon-ad-pipeline.server.ts");
  assert.ok(cartoon.includes("priceRule(o.price, [o.productDescription, o.direction].filter(Boolean).join(\" \")),"));
  assert.ok(cartoon.includes("price: params.serviceMode ? null : await catalogPriceFor(params.shopId, params.productTitle),"));

  // one lookup, shared; it never throws (a paid job must not fail over it)
  const cat = read("app", "lib", "catalog-import.server.ts");
  assert.ok(cat.includes("export async function catalogPriceFor(shopId: string, productTitle?: string | null): Promise<string | null> {"));
  assert.ok(/catalogPriceFor[\s\S]{0,420}\} catch \{\s*return null;\s*\}/.test(cat));
  for (const f of ["commercial-ad-pipeline.server.ts", "ugc-ad-pipeline.server.ts", "jingle-ad-pipeline.server.ts", "cartoon-ad-pipeline.server.ts"]) {
    assert.ok(read("app", "lib", f).includes("import { catalogPriceFor } from \"./catalog-import.server\";"), f);
  }
  // the quick direction that started this is still offered under every style
  assert.ok(read("app", "routes", "web.studio.tsx").includes("\"fast + funny, lead with the price\""));
});
