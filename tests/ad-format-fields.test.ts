import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { AD_FORMATS } from "../app/lib/ad-formats.ts";

/* Every ad format declares the copy `fields` it needs, and a layout prompt in
 * image-generation.server.ts draws them. Those two lists are maintained by hand
 * in different files, and nothing checked that they agree.
 *
 * Both directions are real, silent bugs:
 *
 *   declared but never drawn  — the copywriter is asked for a string, spends
 *                               tokens writing it, and it appears nowhere on
 *                               the finished ad.
 *   drawn but never declared  — formatCopy never asks for it, so `c.X` is
 *                               undefined and the layout prompt literally reads
 *                               'a small label reading exactly: "undefined"' —
 *                               which the image model will happily letter onto
 *                               the merchant's ad.
 *
 * This test reads the actual source rather than duplicating the mapping,
 * so it cannot drift from the thing it is checking.
 */

const SRC = fs.readFileSync(new URL("../app/lib/image-generation.server.ts", import.meta.url), "utf8");

/** The body of formatLayoutPrompt's switch, one entry per format key. */
function layoutBodies(): Map<string, string> {
  const start = SRC.indexOf("function formatLayoutPrompt(");
  assert.notEqual(start, -1, "formatLayoutPrompt moved — this test needs updating");
  const swAt = SRC.indexOf("switch (key) {", start);
  assert.notEqual(swAt, -1, "the layout switch moved");
  const body = SRC.slice(swAt);

  const out = new Map<string, string>();
  const caseRe = /^\s{4}case "([a-z0-9]+)":/gm;
  const marks: { key: string; at: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = caseRe.exec(body))) marks.push({ key: m[1], at: m.index });
  assert.ok(marks.length > 20, `expected the full format switch, found ${marks.length} cases`);

  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].at : body.length;
    out.set(marks[i].key, body.slice(marks[i].at, end));
  }
  return out;
}

/** `${c.headline}` / `${c.c1}` references inside one case body, ignoring
 *  anything inside a // or /* comment. */
function drawnFields(caseBody: string): Set<string> {
  const code = caseBody
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
  const found = new Set<string>();
  for (const m of code.matchAll(/\$\{c\.([A-Za-z0-9_]+)\}/g)) found.add(m[1]);
  return found;
}

test("every format the catalogue lists has a layout that draws it", () => {
  const bodies = layoutBodies();
  const missing = AD_FORMATS.filter((f) => !bodies.has(f.key)).map((f) => f.key);
  assert.deepEqual(missing, [], `formats with no layout prompt — they fall through to the default and the merchant gets a generic ad: ${missing.join(", ")}`);
});

test("no layout draws a field the copywriter is never asked for", () => {
  const bodies = layoutBodies();
  const byKey = new Map(AD_FORMATS.map((f) => [f.key, f]));
  const broken: string[] = [];
  for (const [key, body] of bodies) {
    const fmt = byKey.get(key);
    if (!fmt) continue; // a case with no catalogue entry is the other test's problem
    const declared = new Set(fmt.fields);
    for (const drawn of drawnFields(body)) {
      if (!declared.has(drawn)) broken.push(`${key}: layout draws c.${drawn}, fields does not list it → the prompt renders "undefined" onto the ad`);
    }
  }
  assert.deepEqual(broken, [], broken.join("\n"));
});

test("no format pays for copy that never reaches the ad", () => {
  const bodies = layoutBodies();
  const wasted: string[] = [];
  for (const fmt of AD_FORMATS) {
    const body = bodies.get(fmt.key);
    if (!body) continue;
    const drawn = drawnFields(body);
    for (const declared of fmt.fields) {
      if (!drawn.has(declared)) wasted.push(`${fmt.key}: fields declares "${declared}", the layout never draws it`);
    }
  }
  assert.deepEqual(wasted, [], wasted.join("\n"));
});

test("every declared field has an entry in the copywriter's field guide", () => {
  // formatCopy's guide is one long string; a field with no guidance gets
  // whatever length and tone the model feels like, which is how a caption ends
  // up too long for its box.
  const guideAt = SRC.indexOf("Field guide:");
  assert.notEqual(guideAt, -1, "the field guide moved");
  // The guide is one very long single-line template literal; take a generous
  // window rather than trying to find its end precisely.
  const guide = SRC.slice(guideAt, guideAt + 12000);
  // The guide writes families as ranges — c1-c4, s1-s3, step1-3, tq1-tq3 —
  // so a literal substring search reports every middle member as ungoverned.
  // Expand the ranges, then look for each field by name.
  const covered = new Set<string>();
  for (const m of guide.matchAll(/([a-z]+)(\d+)\s*-\s*([a-z]*)(\d+)/g)) {
    const [, prefix, from0, prefix2, to0] = m;
    if (prefix2 && prefix2 !== prefix) continue;
    for (let i = Number(from0); i <= Number(to0); i++) covered.add(prefix + i);
  }
  for (const m of guide.matchAll(/\b[a-z][a-z0-9]*\b/g)) covered.add(m[0]);

  const ungoverned = new Set<string>();
  for (const fmt of AD_FORMATS) {
    for (const f of fmt.fields) {
      if (!covered.has(f.toLowerCase())) ungoverned.add(`${f} (used by ${fmt.key})`);
    }
  }
  assert.deepEqual([...ungoverned], [], `fields with no guidance in formatCopy:\n${[...ungoverned].join("\n")}`);
});

test("every format's preview fills exactly the fields it declares", () => {
  // The picker renders each format from `preview`. A preview missing a field
  // shows the merchant a sample that is not what the format actually makes.
  const wrong: string[] = [];
  for (const fmt of AD_FORMATS) {
    const preview = new Set(Object.keys(fmt.preview || {}));
    for (const f of fmt.fields) if (!preview.has(f)) wrong.push(`${fmt.key}: preview has no "${f}"`);
    for (const p of preview) if (!fmt.fields.includes(p)) wrong.push(`${fmt.key}: preview has an extra "${p}"`);
  }
  assert.deepEqual(wrong, [], wrong.join("\n"));
});
