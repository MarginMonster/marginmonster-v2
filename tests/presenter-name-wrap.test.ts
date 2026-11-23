/* A CAST MEMBER'S NAME IS NOT CUT ON THEIR OWN CARD.
 *
 * Looked at phone-first, 2026-11-23: three cards across on a 390px phone leaves a name 69px beside the ▶,
 * and "Mourning Mary" read "Mourning M…". A long name now takes a second line there (measured: two lines,
 * the three cards of the row still the same height, nothing else clipped). Wider screens are unchanged.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "app", "routes", "web.presenters.tsx"), "utf8").replace(/\r\n/g, "\n");

test("on a phone a long name wraps to a second line; on a wide screen it is one line as before", () => {
  const wide = ".ph-face-nm{font-family:Poppins,sans-serif;font-size:14px;font-weight:700;line-height:1.25;color:var(--ink,#14201A);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}";
  const phone = ".ph-face-nm{font-size:12px;white-space:normal;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;}";
  assert.ok(src.includes(wide));
  assert.ok(src.includes(phone));
  assert.ok(src.indexOf(phone) > src.indexOf(wide), "the phone rule comes after the one it changes");
  // …inside the block that makes the grid three across
  const grid = src.indexOf(".ph-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}");
  assert.ok(grid > 0 && src.indexOf(phone) > grid && src.indexOf(phone) - grid < 900);
  // two lines at most: a very long custom name still ends in an ellipsis rather than growing the card without limit
  assert.ok(phone.includes("-webkit-line-clamp:2;"));
});
