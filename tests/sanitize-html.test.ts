/* Model-generated article HTML is stored, rendered into the merchant's Archive
 * with dangerouslySetInnerHTML, and published to their storefront. Nothing
 * sanitized it at any point.
 *
 * The realistic failure is the model emitting markup it shouldn't — a <script>,
 * an onerror=, a javascript: href — because something in a product description
 * looked like HTML. It then runs in the merchant's own dashboard and on their
 * own domain.
 *
 * An allowlist is asserted here rather than a denylist: the test for "something
 * nobody thought of" is that it is dropped by default. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeArticleHtml as clean } from "../app/lib/sanitize-html.ts";

test("ordinary article markup survives intact", () => {
  const html =
    "<h2>Why it works</h2><p>Some <strong>bold</strong> and <em>italic</em> copy.</p>" +
    "<ul><li>One</li><li>Two</li></ul>" +
    '<p><a href="https://shop.example.com/p/1" title="Buy">Buy it</a></p>' +
    '<figure><img src="https://cdn.example.com/a.jpg" alt="A thing" /><figcaption>Caption</figcaption></figure>';
  const out = clean(html);
  assert.match(out, /<h2>Why it works<\/h2>/);
  assert.match(out, /<strong>bold<\/strong>/);
  assert.match(out, /<li>One<\/li>/);
  assert.match(out, /href="https:\/\/shop\.example\.com\/p\/1"/);
  assert.match(out, /src="https:\/\/cdn\.example\.com\/a\.jpg"/);
  assert.match(out, /alt="A thing"/);
  assert.match(out, /<figcaption>Caption<\/figcaption>/);
});

test("scripts go, and so does their body", () => {
  // Dropping only the tag would leave the source as visible article text.
  const out = clean('<p>Before</p><script>alert(1)</script><p>After</p>');
  assert.ok(!/script/i.test(out), out);
  assert.ok(!out.includes("alert(1)"), "the script body was left behind as text");
  assert.match(out, /<p>Before<\/p>/);
  assert.match(out, /<p>After<\/p>/);
});

test("an unterminated script does not survive by being unclosed", () => {
  const out = clean('<p>ok</p><script>alert(1)');
  assert.ok(!/alert/.test(out), out);
  assert.match(out, /<p>ok<\/p>/);
});

test("style, iframe, object, embed and svg go with their contents", () => {
  for (const [markup, needle] of [
    ["<style>body{display:none}</style>", "display:none"],
    ['<iframe src="https://evil.test/"></iframe>', "evil.test"],
    ["<object data=x></object>", "object"],
    ["<embed src=x>", "embed"],
    ["<svg><script>alert(1)</script></svg>", "alert"],
  ] as const) {
    const out = clean(`<p>keep</p>${markup}`);
    assert.ok(!out.includes(needle), `${markup} left ${needle} behind: ${out}`);
    assert.match(out, /<p>keep<\/p>/);
  }
});

test("event handlers are dropped — by omission, not by enumeration", () => {
  const out = clean('<img src="https://x.test/a.jpg" onerror="alert(1)" onload="x()" ONCLICK="y()">');
  assert.ok(!/onerror|onload|onclick/i.test(out), out);
  assert.match(out, /src="https:\/\/x\.test\/a\.jpg"/, "the legitimate attribute should survive");
});

test("javascript: and data: URLs are refused", () => {
  for (const bad of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox',
  ]) {
    const out = clean(`<a href="${bad}">click</a>`);
    assert.ok(!/href=/.test(out), `${bad} produced ${out}`);
    assert.match(out, /<a>click<\/a>/, "the link text should remain, just not the destination");
  }
});

test("the classic obfuscations of javascript: are refused too", () => {
  for (const bad of ["java\tscript:alert(1)", "java\nscript:alert(1)", "&#106;avascript:alert(1)", " javascript:alert(1)"]) {
    const out = clean(`<a href="${bad}">x</a>`);
    assert.ok(!/href=/.test(out), `${JSON.stringify(bad)} produced ${out}`);
  }
});

test("relative and anchor links still work", () => {
  assert.match(clean('<a href="/products/thing">x</a>'), /href="\/products\/thing"/);
  assert.match(clean('<a href="#section">x</a>'), /href="#section"/);
  assert.match(clean('<a href="//cdn.example.com/x">x</a>'), /href="\/\/cdn\.example\.com\/x"/);
});

test("a tag nobody thought of is dropped by default", () => {
  // The whole point of an allowlist.
  const out = clean("<marquee>hi</marquee><blink>no</blink><form><input value=x></form>");
  assert.ok(!/marquee|blink|form|input/i.test(out), out);
  assert.match(out, /hi/, "inner text of a dropped tag is kept — only the tag goes");
});

test("an external link is given rel=noopener", () => {
  const out = clean('<a href="https://x.test/" target="_blank">x</a>');
  assert.match(out, /rel="noopener noreferrer"/);
});

test("attribute values are escaped, so a quote cannot break out", () => {
  const out = clean('<a href="https://x.test/a" title=\'He said "hi"\'>x</a>');
  assert.ok(!/title="He said "hi""/.test(out), `unescaped quote survived: ${out}`);
  assert.match(out, /&quot;/);
});

test("empty and missing input are safe", () => {
  assert.equal(clean(""), "");
  assert.equal(clean(null), "");
  assert.equal(clean(undefined), "");
});

test("comments are removed rather than trusted", () => {
  const out = clean("<p>a</p><!-- <script>alert(1)</script> --><p>b</p>");
  assert.ok(!/alert|script/i.test(out), out);
});
