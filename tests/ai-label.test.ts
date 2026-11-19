/* Everything EasyMode posts is made with AI: besides the #EasyModeAi tag in the caption, every post sets
 * the platforms' own AI-generated label (upload-post's is_ai_generated alias → TikTok is_aigc, Instagram,
 * YouTube, X; Facebook Reels via facebook_is_ai_generated). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("every post carries the platforms' native AI-generated label", () => {
  const src = fs.readFileSync(new URL("../app/lib/social-provider.server.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function publishPost"));
  assert.ok(fn.includes('form.append("is_ai_generated", "true")'), "the alias on every upload");
  assert.ok(fn.includes('form.append("facebook_is_ai_generated", "true")'), "Facebook Reels' own field");
  assert.ok(fn.indexOf('"is_ai_generated"') < fn.indexOf("await fetch("), "set before the request goes out");
});
