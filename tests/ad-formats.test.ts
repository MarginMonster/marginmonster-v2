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
import { AD_FORMATS, AD_FORMAT_BY_KEY, FORMAT_GROUPS } from "../app/lib/ad-formats.ts";

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

test("every format-group key points at a live format, and every live format has a home group", () => {
  const live = new Set(AD_FORMATS.map((f) => f.key));
  // Nothing in a group should be a typo or a retired key — the picker would
  // render a dead tile (or crash the .filter) otherwise.
  for (const g of FORMAT_GROUPS) {
    assert.ok(g.formats.length > 0, `group "${g.key}" lists no formats`);
    for (const k of g.formats) {
      assert.ok(live.has(k), `group "${g.key}" lists "${k}", which is not a live format`);
    }
  }
  // "popular" is a fast lane, not a home — every live format must be reachable
  // from a real category so nothing is findable only via the "All" chip.
  const homed = new Set(FORMAT_GROUPS.filter((g) => g.key !== "popular").flatMap((g) => g.formats));
  for (const f of AD_FORMATS) {
    assert.ok(homed.has(f.key), `format "${f.key}" belongs to no category group — it would only appear under "All"`);
  }
  assert.ok(FORMAT_GROUPS.some((g) => g.key === "popular"), "the picker expects a 'popular' group to lead with");
});

test("no layout prompt interpolates a key the copywriter is never asked for", () => {
  const src = readFileSync(new URL("../app/lib/image-generation.server.ts", import.meta.url), "utf8");
  const start = src.indexOf("function formatLayoutPrompt");
  assert.ok(start > 0, "formatLayoutPrompt not found — did it move?");
  const end = src.indexOf("\nfunction ", start + 10);
  const body = src.slice(start, end > 0 ? end : undefined);

  // Check against the FULL key set, retired formats included: formatLayoutPrompt
  // intentionally keeps a case for every retired format so remixing an older
  // asset never hits an undefined key (see AD_FORMAT_BY_KEY's note). Using the
  // live-only list here went red the moment the first format was retired.
  const byKey = new Map(Object.values(AD_FORMAT_BY_KEY).map((f) => [f.key, f]));
  const caseRe = /case "([a-z0-9]+)":([\s\S]*?)(?=\n    case "|\n    default:)/g;
  let scanned = 0;
  let m: RegExpExecArray | null;
  while ((m = caseRe.exec(body))) {
    const [, key, block] = m;
    scanned++;
    const fmt = byKey.get(key);
    assert.ok(fmt, `formatLayoutPrompt handles "${key}" but no such format exists`);
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
