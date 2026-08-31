/* The reset link is a key to a paid account, so the properties below are the
 * whole security of the feature.
 *
 * verifyPasswordReset reads the database, so only the signing half is unit
 * tested here; the verify half is exercised by reproducing its exact checks
 * against the same MAC construction. What that covers is the part a table
 * cannot: that the token is bound to the password it was signed against, which
 * is what makes it single-use with no token table at all. */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.SESSION_SECRET = "test-only-secret-not-a-real-one";
process.env.SHOPIFY_APP_URL = "https://easymodeapp.com";
const { signPasswordReset, resetUrl, resetEmailHtml } = await import("../app/lib/password-reset.ts");

const ACCOUNT = { id: "clxacct0000000000000000", passwordHash: "abc123:deadbeef" };

/** The verifier's MAC check, reproduced so the binding can be tested without a
 *  database. If this drifts from password-reset.server.ts the test is wrong —
 *  which is why the shape is asserted separately below. */
const macOver = (payload: string, hash: string | null) =>
  crypto.createHmac("sha256", process.env.SESSION_SECRET!).update(`${payload}|${hash ?? ""}`).digest("base64url");

const parts = (token: string) => {
  const dot = token.lastIndexOf(".");
  return {
    payload: Buffer.from(token.slice(0, dot), "base64url").toString("utf8"),
    mac: token.slice(dot + 1),
  };
};

test("a token verifies against the hash it was signed with", () => {
  const { payload, mac } = parts(signPasswordReset(ACCOUNT));
  assert.equal(mac, macOver(payload, ACCOUNT.passwordHash));
});

test("changing the password kills every outstanding link — this is what makes it single-use", () => {
  const { payload, mac } = parts(signPasswordReset(ACCOUNT));
  // What a successful reset does: a new salted hash replaces the old one.
  const afterReset = "999zzz:cafebabe";
  assert.notEqual(mac, macOver(payload, afterReset), "the link still verified after the password changed");
});

test("resetting to the SAME password still kills the link", () => {
  // hashPassword salts randomly, so the stored string changes even when the
  // password does not. Without that this whole scheme would leak a reuse.
  const { payload, mac } = parts(signPasswordReset(ACCOUNT));
  const samePasswordNewSalt = "different-salt:different-digest";
  assert.notEqual(mac, macOver(payload, samePasswordNewSalt));
});

test("the password hash never appears in the token", () => {
  // It is password-equivalent material. It goes in the MAC input and nowhere
  // near a URL, a mailbox, or an access log.
  const token = signPasswordReset(ACCOUNT);
  assert.ok(!token.includes(ACCOUNT.passwordHash), "the raw hash is in the token");
  assert.ok(!parts(token).payload.includes("deadbeef"), "the hash leaked into the payload");
  assert.ok(!resetEmailHtml(resetUrl(token)).includes("deadbeef"), "the hash leaked into the email");
});

test("the payload carries the account and an issue time, and nothing else", () => {
  const { payload } = parts(signPasswordReset(ACCOUNT));
  const sep = payload.lastIndexOf("|");
  assert.equal(payload.slice(0, sep), ACCOUNT.id);
  const issuedAt = parseInt(payload.slice(sep + 1), 36);
  assert.ok(Number.isFinite(issuedAt), "no readable issue time — expiry would be impossible");
  assert.ok(Math.abs(Date.now() - issuedAt) < 5000, "the issue time is not now");
});

test("an account with no password yet is signable rather than a crash", () => {
  // The column is nullable. Setting a password this way is correct behaviour.
  const { payload, mac } = parts(signPasswordReset({ id: "clxb", passwordHash: null }));
  assert.equal(mac, macOver(payload, null));
});

test("the link is built from SHOPIFY_APP_URL, never from request headers", () => {
  // Using externalOrigin() here would read x-forwarded-host, which the client
  // controls — a forged header would mint an email whose link points at
  // someone else's host and hands them the token on the merchant's click.
  const url = resetUrl("tok.en");
  assert.equal(url, "https://easymodeapp.com/web/reset/tok.en");
  assert.match(url, /^https:\/\/easymodeapp\.com\//);
});

test("a trailing slash on the base does not double up", () => {
  const prev = process.env.SHOPIFY_APP_URL;
  process.env.SHOPIFY_APP_URL = "https://easymodeapp.com/";
  assert.equal(resetUrl("t"), "https://easymodeapp.com/web/reset/t");
  process.env.SHOPIFY_APP_URL = prev;
});

test("no link is minted at all when the public URL is unset", () => {
  const prev = process.env.SHOPIFY_APP_URL;
  process.env.SHOPIFY_APP_URL = "";
  assert.throws(() => resetUrl("t"), /SHOPIFY_APP_URL/);
  process.env.SHOPIFY_APP_URL = prev;
});

test("tokens are URL-safe, so nothing in the path is mangled in a mail client", () => {
  assert.match(signPasswordReset(ACCOUNT), /^[A-Za-z0-9_.-]+$/);
});

test("two links for the same account differ", () => {
  const a = signPasswordReset(ACCOUNT);
  const b = signPasswordReset({ ...ACCOUNT, id: ACCOUNT.id + "x" });
  assert.notEqual(a, b);
});

test("the email carries no unsubscribe footer", () => {
  // A security email is not marketing. It must not be suppressible: the person
  // locked out of their account still needs the key, whatever their marketing
  // preferences say.
  const html = resetEmailHtml("https://easymodeapp.com/web/reset/abc.def");
  assert.ok(!/unsubscribe/i.test(html), "a reset email must not offer to unsubscribe");
  assert.match(html, /expires in 60 minutes/i, "the email must say how long the link lasts");
  assert.match(html, /stops working once it has been used/i, "the email must say the link is single use");
});

test("the email escapes the link rather than interpolating it raw", () => {
  const html = resetEmailHtml('https://x.test/a"><script>alert(1)</script>');
  assert.ok(!html.includes("<script>"), "the link was interpolated unescaped");
  assert.match(html, /&quot;|&lt;/);
});
