/* The 49 ad formats are data on one side and a switch of prompt templates on
 * the other, and nothing ties them together. Two ways that can silently break a
 * merchant's ad:
 *
 *  1. A layout prompt interpolates ${c.something} that the format never asks
 *     the copywriter for. formatCopy is given exactly `fields`, so the model
 *     never returns that key and the string "undefined" goes to the image model
 *     as an instruction.
 *  2. A format declares a field with no preview copy, so the picker tile — the
 *     thing a merchant chooses from — renders the same way.
 *
 * Both hold today. These keep them holding when the fiftieth format is added.
 *
 * The prompt side is checked against the SOURCE because formatLayoutPrompt
 * lives in a module that imports the database and cannot be loaded here. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AD_FORMATS } from "../app/lib/ad-formats.ts";

test("there are formats to check, and each has a key and fields", () => {
  assert.ok(AD_FORMATS.length >= 40, `expected the full format set, got ${AD_FORMATS.length}`);
  for (const f of AD_FORMATS) {
    assert.ok(f.key, "a format has no key");
    assert.ok(Array.isArray(f.fields) && f.fields.length > 0, `${f.key} declares no copy fields`);
  }
});

test("every declared field has preview copy, so no picker tile renders undefined", () => {
  for (const f of AD_FORMATS) {
    for (const field of f.fields) {
      const value = (f.preview as Record<string, string> | undefined)?.[field];
      assert.ok(
        value !== undefined && value !== "",
        `format "${f.key}" declares field "${field}" with no preview copy`
      );
    }
  }
});

test("no preview carries copy the format never asks for", () => {
  for (const f of AD_FORMATS) {
    for (const key of Object.keys((f.preview as Record<string, string>) || {})) {
      assert.ok(f.fields.includes(key), `format "${f.key}" previews "${key}", which is not one of its fields`);
    }
  }
});

test("no layout prompt interpolates a key the copywriter is never asked for", () => {
  const src = readFileSync(new URL("../app/lib/image-generation.server.ts", import.meta.url), "utf8");
  const start = src.indexOf("function formatLayoutPrompt");
  assert.ok(start > 0, "formatLayoutPrompt not found — did it move?");
  const end = src.indexOf("\nfunction ", start + 10);
  const body = src.slice(start, end > 0 ? end : undefined);

  const byKey = new Map(AD_FORMATS.map((f) => [f.key, f]));
  const caseRe = /case "([a-z0-9]+)":([\s\S]*?)(?=\n    case "|\n    default:)/g;
  let scanned = 0;
  let m: RegExpExecArray | null;
  while ((m = caseRe.exec(body))) {
    const [, key, block] = m;
    scanned++;
    const fmt = byKey.get(key);
    assert.ok(fmt, `formatLayoutPrompt handles "${key}" but AD_FORMATS has no such format`);
    const used = [...new Set([...block.matchAll(/\$\{c\.([a-zA-Z0-9_]+)\}/g)].map((x) => x[1]))];
    for (const u of used) {
      assert.ok(
        fmt!.fields.includes(u),
        `format "${key}" interpolates c.${u} but never requests it — it would render as "undefined" in the prompt`
      );
    }
  }
  assert.ok(scanned >= 40, `only scanned ${scanned} prompt cases — the parser probably drifted from the source`);
});
