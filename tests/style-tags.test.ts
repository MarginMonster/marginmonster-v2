/* A stylesheet must never be a React CHILD of <style>.
 *
 * On the server React escapes the text of every child — `>` becomes `&gt;`, `"` becomes `&quot;`,
 * `'` becomes `&#x27;` — and <style> is a raw-text element, so the browser never turns them back.
 * Two things then go wrong on every single page load:
 *   - until the scripts arrive, every rule with a child selector (`.a>b`) or a quoted value
 *     (`content:""`, a font name) is broken CSS, so the page paints half-styled;
 *   - React finds the server's text different from its own, gives up on hydrating
 *     (errors #418 / #425 in the console) and renders the whole page again from scratch.
 *
 * Found 2026-11-17 on /web/presenters and /web/film (and four admin pages) — the rest of the app
 * already injected its CSS raw, and a note in lp.$slug.tsx explains why. This is the standing rule. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const APP = new URL("../app/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

test("no stylesheet is passed to <style> as a child", () => {
  const offenders: string[] = [];
  for (const file of walk(APP)) {
    const rel = path.relative(path.join(APP, ".."), file).replace(/\\/g, "/");
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
      // <style>{CSS}</style> or <style>{`…`}</style>: an expression as the tag's child (prose that merely names the tag is fine)
      if (/<style(\s[^>]*)?>\s*\{/.test(line)) offenders.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], `use <style dangerouslySetInnerHTML={{ __html: CSS }} /> — React escapes a child's text and <style> never unescapes it:\n  ${offenders.join("\n  ")}`);
});
