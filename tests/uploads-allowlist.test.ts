/* /uploads/:file serves merchant-uploaded product and mascot photographs, and
 * its only access control is that the filenames are unguessable. The allowlist
 * therefore has to admit exactly the names the app writes — no more, no less.
 *
 * It did not: the pattern was written for the product-photo shape and the
 * mascot upload was added later with an extra hyphen, so every mascot 404'd and
 * the custom-presenter forge could never fetch its own input. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isServableUploadName, uploadFileName } from "../app/lib/upload-names.ts";

const SHOP = "cmtabc123xyz";
const HEX = "a1b2c3d4e5f6a7b8";

test("serves a product photo — <shopid>-<hex>.<ext>", () => {
  for (const ext of ["jpg", "png", "webp"]) {
    assert.ok(isServableUploadName(`${SHOP}-${HEX}.${ext}`), ext);
  }
});

test("serves a brand mascot — <shopid>-mascot-<hex>.<ext>", () => {
  // The exact shape web.studio.tsx writes. This is what used to 404.
  for (const ext of ["jpg", "png", "webp"]) {
    assert.ok(isServableUploadName(`${SHOP}-mascot-${HEX}.${ext}`), ext);
  }
});

test("refuses path traversal and anything outside the directory", () => {
  for (const bad of [
    "../secret.jpg",
    "..%2fsecret.jpg",
    "sub/dir.jpg",
    "sub\\dir.jpg",
    ".env",
    "file.jpg.exe",
    "file..jpg",
    "",
  ]) {
    assert.equal(isServableUploadName(bad), false, `should refuse ${JSON.stringify(bad)}`);
  }
});

test("refuses unexpected extensions", () => {
  for (const bad of [`${SHOP}-${HEX}.svg`, `${SHOP}-${HEX}.gif`, `${SHOP}-${HEX}.html`, `${SHOP}-${HEX}`]) {
    assert.equal(isServableUploadName(bad), false, bad);
  }
});

test("refuses uppercase, which the writers never produce", () => {
  assert.equal(isServableUploadName(`${SHOP.toUpperCase()}-${HEX}.jpg`), false);
});

test("every name the app WRITES is a name the route will serve", () => {
  // The actual defect: the writer and the allowlist disagreed. Assert they
  // cannot, for both upload kinds and every extension.
  const hex = "a1b2c3d4e5f6a7b8";
  for (const shopId of ["cmtabc123xyz", "CMT-Abc_123", "shop.myshopify.com"]) {
    for (const ext of ["jpg", "png", "webp"] as const) {
      for (const kind of [undefined, "mascot" as const]) {
        const name = uploadFileName(shopId, hex, ext, kind);
        assert.ok(isServableUploadName(name), `writer produced an unservable name: ${name}`);
      }
    }
  }
});
