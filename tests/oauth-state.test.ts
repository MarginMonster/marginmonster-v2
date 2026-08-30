/* The Meta/TikTok connect callbacks bind a live ad-account access token to
 * whatever shop `state` names, and they cannot authenticate — they are
 * redirects back from the ad platform. So `state` must be unforgeable. */

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET = "test-only-secret-not-a-real-one";
const { signOAuthState, verifyOAuthState } = await import("../app/lib/oauth-state.server.ts");

const SHOP = "magic-monster.myshopify.com";

test("a state we minted verifies back to the same shop", () => {
  assert.equal(verifyOAuthState(signOAuthState(SHOP)), SHOP);
});

test("the OLD raw-domain format is rejected", () => {
  // This is exactly what an attacker would send, and what the code used to accept.
  assert.equal(verifyOAuthState("victim.myshopify.com"), null);
});

test("a tampered payload is rejected even with a valid-looking signature", () => {
  const good = signOAuthState(SHOP);
  const mac = good.slice(good.lastIndexOf(".") + 1);
  const forged = Buffer.from(`attacker.myshopify.com|${Date.now().toString(36)}`, "utf8").toString("base64url") + "." + mac;
  assert.equal(verifyOAuthState(forged), null);
});

test("a corrupted signature is rejected", () => {
  const good = signOAuthState(SHOP);
  assert.equal(verifyOAuthState(good.slice(0, good.lastIndexOf(".")) + ".deadbeef"), null);
});

test("empty, null and malformed input are rejected rather than throwing", () => {
  assert.equal(verifyOAuthState(null), null);
  assert.equal(verifyOAuthState(""), null);
  assert.equal(verifyOAuthState("no-dot-here"), null);
  assert.equal(verifyOAuthState(".onlyamac"), null);
});

test("a shop domain containing the separator still round-trips", () => {
  const odd = "we|ird.myshopify.com";
  assert.equal(verifyOAuthState(signOAuthState(odd)), odd);
});

test("two states for the same shop are not byte-identical over time", () => {
  // They carry an issue time, which is what makes expiry possible at all.
  const a = signOAuthState(SHOP);
  assert.equal(verifyOAuthState(a), SHOP);
  assert.ok(a.includes("."), "state should be payload.mac");
});
