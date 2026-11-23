/* Everything EasyMode posts is made with AI: besides the #EasyModeAi tag in the caption, every post sets
 * the platforms' own AI-generated label (upload-post's is_ai_generated alias → TikTok is_aigc, Instagram,
 * YouTube, X, Threads; Facebook Reels via facebook_is_ai_generated).
 *
 * (2026-11-22: the form fields moved from publishPost into planPublish in social-networks.ts, which
 *  publishPost appends in order before the request goes out — the pins follow them there.) */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("every post carries the platforms' native AI-generated label", () => {
  const src = fs.readFileSync(new URL("../app/lib/social-provider.server.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function publishPost"));
  const plan = fs.readFileSync(new URL("../app/lib/social-networks.ts", import.meta.url), "utf8");
  const planFn = plan.slice(plan.indexOf("export function planPublish"));
  assert.ok(planFn.includes('fields.push(["is_ai_generated", "true"]);'), "the alias on every upload");
  assert.ok(planFn.includes('fields.push(["facebook_is_ai_generated", "true"]);'), "Facebook Reels' own field");
  assert.ok(fn.includes("for (const [k, v] of plan.fields) form.append(k, v);"), "publishPost sends the plan's fields");
  assert.ok(fn.indexOf("plan.fields") < fn.indexOf("await fetch("), "set before the request goes out");
});
