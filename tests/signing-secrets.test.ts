import { test } from "node:test";
import assert from "node:assert/strict";
import { signingSecrets, signInput, verifyInput, hmacB64url } from "../app/lib/signing-secrets.ts";

/* Four modules used a single `SESSION_SECRET || SHOPIFY_API_SECRET` for both
 * signing and verifying. SESSION_SECRET is unset in production, so the Shopify
 * client secret has been signing everything — and SETTING SESSION_SECRET, the
 * obvious fix, would have logged out every merchant and permanently killed
 * every unsubscribe link ever emailed. The list form makes rotation a non-event. */

const withEnv = (vars: Record<string, string | undefined>, fn: () => void) => {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { fn(); } finally { for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } }
};

test("today's production shape: only SHOPIFY_API_SECRET set — it signs and verifies", () => {
  withEnv({ SESSION_SECRET: undefined, SHOPIFY_API_SECRET: "shopify-secret", NODE_ENV: "production" }, () => {
    assert.deepEqual(signingSecrets(), ["shopify-secret"]);
    const mac = signInput("hello");
    assert.equal(mac, hmacB64url("shopify-secret", "hello"));
    assert.equal(verifyInput("hello", mac), true);
  });
});

test("THE ROTATION: setting SESSION_SECRET later keeps everything the old key signed", () => {
  let oldMac = "";
  withEnv({ SESSION_SECRET: undefined, SHOPIFY_API_SECRET: "shopify-secret" }, () => {
    oldMac = signInput("acct_123|t0"); // a cookie / unsubscribe link minted today
  });
  withEnv({ SESSION_SECRET: "brand-new-dedicated-secret", SHOPIFY_API_SECRET: "shopify-secret" }, () => {
    // New material signs with the NEW key...
    assert.equal(signingSecrets()[0], "brand-new-dedicated-secret");
    assert.equal(signInput("acct_123|t0"), hmacB64url("brand-new-dedicated-secret", "acct_123|t0"));
    // ...and the old link still verifies. Nobody is logged out, no mailbox link dies.
    assert.equal(verifyInput("acct_123|t0", oldMac), true, "rotation invalidated a token signed with the previous key");
  });
});

test("retiring the old key is the owner's choice, and then it really is retired", () => {
  let oldMac = "";
  withEnv({ SESSION_SECRET: undefined, SHOPIFY_API_SECRET: "shopify-secret" }, () => { oldMac = signInput("x"); });
  withEnv({ SESSION_SECRET: "new", SHOPIFY_API_SECRET: undefined }, () => {
    assert.equal(verifyInput("x", oldMac), false);
  });
});

test("a tampered MAC and a MAC for a different input are both rejected under every key", () => {
  withEnv({ SESSION_SECRET: "a", SHOPIFY_API_SECRET: "b" }, () => {
    const mac = signInput("payload");
    assert.equal(verifyInput("payload", mac), true);
    assert.equal(verifyInput("payload", mac.slice(0, -1) + (mac.endsWith("A") ? "B" : "A")), false);
    assert.equal(verifyInput("payload2", mac), false);
    assert.equal(verifyInput("payload", ""), false);
    assert.equal(verifyInput("payload", null), false);
    assert.equal(verifyInput("payload", undefined), false);
  });
});

test("the same value under both names is ONE key, not two", () => {
  withEnv({ SESSION_SECRET: "same", SHOPIFY_API_SECRET: "same" }, () => {
    assert.deepEqual(signingSecrets(), ["same"]);
  });
});

test("whitespace-only values do not count as a configured secret", () => {
  withEnv({ SESSION_SECRET: "   ", SHOPIFY_API_SECRET: "real" }, () => {
    assert.deepEqual(signingSecrets(), ["real"]);
  });
});

test("production with NO secret refuses rather than falling back to the published dev constant", () => {
  withEnv({ SESSION_SECRET: undefined, SHOPIFY_API_SECRET: undefined, NODE_ENV: "production" }, () => {
    assert.throws(() => signingSecrets(), /Refusing to start/);
    assert.throws(() => signInput("x"), /Refusing to start/);
  });
});

test("outside production with no secret, the dev constant is used and is obviously not a secret", () => {
  withEnv({ SESSION_SECRET: undefined, SHOPIFY_API_SECRET: undefined, NODE_ENV: "test" }, () => {
    assert.deepEqual(signingSecrets(), ["em-dev-secret"]);
  });
});
