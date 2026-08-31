/* The single guard behind every outbound fetch the server makes on a merchant's
 * behalf: Add-by-URL, the photo field, the catalogue crawler, and safeFetch's
 * per-hop redirect check. A gap here is a gap in all of them.
 *
 * The importer returns the fetched page's <title> and og:image in its JSON
 * response, so a bypass is not blind — it reads back. That is what makes this
 * worth a test file rather than a comment.
 *
 * Every "was allowed" case below was reproduced against the real URL parser
 * before the fix, and one of them (::ffff:127.0.0.1) was confirmed to actually
 * connect to a server bound to 127.0.0.1. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlockedHost } from "../app/lib/blocked-host.ts";

/** What the guard actually receives: URL.hostname, brackets and all. */
const hostOf = (u: string) => new URL(u).hostname;
const blocks = (u: string) => isBlockedHost(hostOf(u));

test("plain loopback and private addresses are blocked", () => {
  for (const u of [
    "http://127.0.0.1/",
    "http://127.0.0.53/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://169.254.169.254/",
    "http://0.0.0.0/",
    "http://[::1]/",
  ]) {
    assert.equal(blocks(u), true, `${u} (${hostOf(u)}) should be blocked`);
  }
});

test("obfuscated IPv4 is blocked — the URL parser normalises it for us", () => {
  // These were already safe; asserted so a future rewrite cannot lose it.
  assert.equal(hostOf("http://2130706433/"), "127.0.0.1");
  assert.equal(hostOf("http://0x7f000001/"), "127.0.0.1");
  assert.equal(hostOf("http://017700000001/"), "127.0.0.1");
  assert.equal(hostOf("http://127.1/"), "127.0.0.1");
  for (const u of ["http://2130706433/", "http://0x7f000001/", "http://017700000001/", "http://127.1/"]) {
    assert.equal(blocks(u), true, `${u} should be blocked`);
  }
});

test("IPv4-mapped IPv6 is blocked — the bypass that was live", () => {
  // new URL() renders these as [::ffff:7f00:1] / [::ffff:a9fe:a9fe], which no
  // string prefix over "127." or "169.254." can ever match. A fetch to
  // http://[::ffff:127.0.0.1]:PORT/ reached a server bound to 127.0.0.1 and
  // returned its body.
  assert.equal(hostOf("http://[::ffff:127.0.0.1]/"), "[::ffff:7f00:1]");
  assert.equal(hostOf("http://[::ffff:169.254.169.254]/"), "[::ffff:a9fe:a9fe]");

  assert.equal(blocks("http://[::ffff:127.0.0.1]/"), true);
  assert.equal(blocks("http://[::ffff:169.254.169.254]/"), true);
  assert.equal(blocks("http://[::ffff:10.0.0.1]/"), true);
  assert.equal(blocks("http://[::ffff:192.168.0.1]/"), true);
  // Both spellings must unmap the same way.
  assert.equal(isBlockedHost("::ffff:7f00:1"), true);
  assert.equal(isBlockedHost("[::ffff:7f00:1]"), true);
  assert.equal(isBlockedHost("::ffff:127.0.0.1"), true);
});

test("the other IPv6 ranges that were allowed", () => {
  assert.equal(blocks("http://[::]/"), true, "unspecified — routes to loopback");
  assert.equal(blocks("http://[fd00::1]/"), true, "unique local");
  assert.equal(blocks("http://[fc00::abcd]/"), true, "unique local");
  assert.equal(blocks("http://[fe80::1]/"), true, "link-local");
  assert.equal(blocks("http://[ff02::1]/"), true, "multicast");
});

test("CGNAT is blocked — Render's private range lives there", () => {
  assert.equal(blocks("http://100.64.0.1/"), true);
  assert.equal(blocks("http://100.127.255.254/"), true);
  // 100.0.0.0/8 outside 64-127 is ordinary public space.
  assert.equal(blocks("http://100.63.0.1/"), false);
  assert.equal(blocks("http://100.128.0.1/"), false);
});

test("single-label hostnames are blocked — that is what internal services look like", () => {
  // Render's private service and database hostnames have no dot.
  assert.equal(blocks("http://dpg-abc123-a/"), true);
  assert.equal(blocks("http://my-postgres/"), true);
  assert.equal(blocks("http://redis/"), true);
  assert.equal(isBlockedHost("localhost"), true);
  assert.equal(isBlockedHost("api.local"), true);
  assert.equal(isBlockedHost("svc.internal"), true);
  assert.equal(isBlockedHost("thing.home.arpa"), true);
  assert.equal(isBlockedHost("app.localhost"), true);
});

test("real storefronts are still allowed — the guard must not break the product", () => {
  for (const u of [
    "https://shop.example.com/products/thing",
    "https://www.myshop.co.uk/",
    "https://magic-monster.myshopify.com/products/x",
    "https://cdn.shopify.com/s/files/1/x.jpg",
    "http://8.8.8.8/",
    "https://100.63.255.255/",
    "https://[2606:4700:4700::1111]/",
  ]) {
    assert.equal(blocks(u), false, `${u} should be allowed`);
  }
});

test("empty and malformed hosts are refused rather than waved through", () => {
  assert.equal(isBlockedHost(""), true);
  assert.equal(isBlockedHost("   "), true);
  assert.equal(isBlockedHost("[]"), true);
  // A dotted quad with an out-of-range octet is not an IP to net.isIP, and it
  // has dots, so it falls to the name branch — which is correct, since DNS is
  // what would resolve it.
  assert.equal(isBlockedHost("999.999.999.999"), false);
});

test("case does not matter", () => {
  assert.equal(isBlockedHost("LOCALHOST"), true);
  assert.equal(isBlockedHost("[::FFFF:127.0.0.1]"), true);
  assert.equal(isBlockedHost("API.INTERNAL"), true);
});
