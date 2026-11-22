/* NO RAW CONTROL CHARACTERS IN THE SOURCE.
 *
 * A patch script that loses one level of backslashes writes a regex `\b` into a file as a raw BACKSPACE
 * byte. The file still type-checks and builds; the regex simply never matches again, and a terminal
 * shows nothing where the byte is. Found 2026-11-22, when a new regex of mine failed its test — and two
 * more were already live:
 *
 *   - film-dialogue.server.ts — "anything but a clear A or B is asked once more": the test for a clear
 *     answer could never pass, so the short film's who-stands-where question was ALWAYS asked twice and
 *     the first answer thrown away. Fixed here.
 *   - image-generation.server.ts — `brandWantsDark` is always false, so a store whose brand look is dark
 *     or moody has been getting bright default backdrops since 2026-08-30. NOT fixed here: putting it
 *     right changes how those stores' product ads look, which is the owner's call. It is pinned below
 *     so that it is the only one, and so that fixing it means touching this test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...sources(rel));
    else if (/\.(ts|tsx|mts|cjs|mjs|js|css)$/.test(e.name)) out.push(rel);
  }
  return out;
}

test("no source file carries a raw control character", () => {
  const found: string[] = [];
  for (const file of [...sources("app"), ...sources("tests")]) {
    fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/).forEach((line) => {
      if (CONTROL.test(line)) found.push(`${file} | ${line.trim().replace(new RegExp(CONTROL.source, "g"), "<?>").slice(0, 36)}`);
    });
  }
  assert.deepEqual(found, [
    // known, and waiting on the owner (see the note at the top): a backspace where `\b` was meant
    "app/lib/image-generation.server.ts | const brandWantsDark = /<?>(dark|moo",
    // a raw NUL as the low end of a character class — it means what `\x00` would, so it works as written
    'app/lib/sanitize-html.ts | .replace(/[<?>- ]/g, "")',
  ]);
});

test("the short film keeps a clear first answer about who stands where", () => {
  const src = fs.readFileSync(path.join(root, "app", "lib", "film-dialogue.server.ts"), "utf8");
  assert.ok(src.includes("if (!/^[AB]\\b/.test(ans)) ans = ((await ask()) || \"\").trim().toUpperCase();"));
  // what that line decides: a clear letter stands, anything else is asked again
  const clear = (ans: string) => /^[AB]\b/.test(ans);
  for (const a of ["A", "B", "A.", "B — the woman"]) assert.equal(clear(a), true, a);
  for (const a of ["", "AB", "BOTH", "THE LEFT ONE", "ANSWER: A"]) assert.equal(clear(a), false, a);
});
