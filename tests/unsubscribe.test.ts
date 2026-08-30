/* Every automated email footer used to read
 *   Sent with EasyMode · <a href="#">Unsubscribe</a>
 * and no unsubscribe route existed. A recipient clicking it got nothing, and
 * the next flow mailed them again — not a lawful opt-out anywhere these
 * merchants sell.
 *
 * The link is now HMAC-signed, so the thing that has to hold is that one
 * recipient cannot unsubscribe another by editing the URL. */

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET = "test-only-secret-not-a-real-one";
const { signUnsubscribe, verifyUnsubscribe, unsubscribeUrl } = await import("../app/lib/unsubscribe.server.ts");

const SHOP = "clxyz0000shopid";
const MAIL = "buyer@example.com";

test("a link we minted verifies back to the same shop and address", () => {
  assert.deepEqual(verifyUnsubscribe(signUnsubscribe(SHOP, MAIL)), { shopId: SHOP, email: MAIL });
});

test("the address is normalised, so casing in the mail header still matches the row", () => {
  assert.deepEqual(verifyUnsubscribe(signUnsubscribe(SHOP, "Buyer@Example.COM")), { shopId: SHOP, email: MAIL });
});

test("one recipient cannot unsubscribe another by editing the URL", () => {
  const mine = signUnsubscribe(SHOP, MAIL);
  const mac = mine.slice(mine.lastIndexOf(".") + 1);
  const forged = Buffer.from(`${SHOP}|victim@example.com`, "utf8").toString("base64url") + "." + mac;
  assert.equal(verifyUnsubscribe(forged), null);
});

test("a token for one shop does not unsubscribe the same address at another", () => {
  const a = signUnsubscribe("shop-a", MAIL);
  const b = signUnsubscribe("shop-b", MAIL);
  assert.notEqual(a, b);
  assert.equal(verifyUnsubscribe(a)!.shopId, "shop-a");
  assert.equal(verifyUnsubscribe(b)!.shopId, "shop-b");
});

test("a corrupted signature is rejected", () => {
  const good = signUnsubscribe(SHOP, MAIL);
  assert.equal(verifyUnsubscribe(good.slice(0, good.lastIndexOf(".")) + ".deadbeef"), null);
});

test("malformed input is rejected rather than throwing", () => {
  for (const bad of [null, undefined, "", "no-dot-here", ".onlyamac", "...", "%%%.%%%"]) {
    assert.equal(verifyUnsubscribe(bad as string | null), null, `threw or accepted ${JSON.stringify(bad)}`);
  }
});

test("the link never expires — mail sits in a mailbox for years", () => {
  // The payload carries no timestamp, on purpose. An opt-out that stops working
  // is an opt-out that sends the recipient to the spam button instead.
  const payload = Buffer.from(signUnsubscribe(SHOP, MAIL).split(".")[0], "base64url").toString("utf8");
  assert.equal(payload, `${SHOP}|${MAIL}`);
});

test("the shop side of the payload is the constrained one", () => {
  // Payload is shopId|email split at the FIRST separator. shopId is a cuid and
  // never contains one; anything after it belongs to the address.
  const odd = "we|ird@example.com";
  assert.deepEqual(verifyUnsubscribe(signUnsubscribe(SHOP, odd)), { shopId: SHOP, email: odd });
});

test("the footer URL is absolute and survives a trailing slash on the base", () => {
  const a = unsubscribeUrl("https://easymodeapp.com", SHOP, MAIL);
  const b = unsubscribeUrl("https://easymodeapp.com/", SHOP, MAIL);
  assert.equal(a, b);
  assert.match(a, /^https:\/\/easymodeapp\.com\/u\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test("tokens are URL-safe — no padding or slashes to break the path", () => {
  for (const mail of ["a+b@example.com", "x".repeat(60) + "@example.co.uk", "ünïcode@example.com"]) {
    const t = signUnsubscribe(SHOP, mail);
    assert.match(t, /^[A-Za-z0-9_.-]+$/, `not URL-safe for ${mail}`);
    assert.equal(verifyUnsubscribe(t)!.email, mail.toLowerCase());
  }
});
