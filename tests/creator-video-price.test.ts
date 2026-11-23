/* A CREATOR VIDEO IS PRICED BY THE SECOND, AND THE PRICE CLEARS THE OWNER'S FLOOR ON THE CHEAPEST PLAN.
 *
 * It was 50 tokens for 5 seconds and 65 for 10, sized for a silent Kling 2.5 clip at $0.07 a second. From
 * 2026-11-06 the clip was really a Kling 3 Pro one with sound ($0.168 a second, never priced): $0.88 of
 * cost for a 50-token ($0.70) video and $1.72 for a 65-token ($0.91) one on the $6.99 Creator plan.
 * The owner's rule is at least 20% profit on every generation. These tests do the arithmetic, so the next
 * engine or price change has to do it too.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CREATOR_PRICE, CREATOR_SURCHARGE_MULT, CREATOR_VIDEO_SECONDS, CREATOR_VIDEO_TOKENS_PER_SECOND, PLAN_TIERS, TOKEN_COST, creatorVideoSeconds, creatorVideoTokens } from "../app/lib/plan-config.ts";
import { engineSurcharge } from "../app/lib/video-engines.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

test("three lengths, one rate", () => {
  assert.deepEqual([...CREATOR_VIDEO_SECONDS], [5, 10, 15]);
  assert.equal(CREATOR_VIDEO_TOKENS_PER_SECOND, 12);
  assert.deepEqual(CREATOR_VIDEO_SECONDS.map((s) => creatorVideoTokens(s)), [60, 120, 180], "twice as long costs twice as much");
  assert.equal(TOKEN_COST.casualVideo, creatorVideoTokens(5), "the price everything else quotes is the 5-second one");
});

test("anything that is not a length on offer is the shortest one", () => {
  for (const v of [undefined, null, "", "abc", 0, 3, 7, 20, "600", -10]) {
    assert.equal(creatorVideoSeconds(v), 5, String(v));
    assert.equal(creatorVideoTokens(v), 60, String(v));
  }
  assert.equal(creatorVideoSeconds("10"), 10);
  assert.equal(creatorVideoSeconds(15), 15);
});

test("every length clears 20% on the cheapest plan that can make one", () => {
  const creator = PLAN_TIERS.find((p) => p.key === "CREATOR");
  assert.ok(creator, "the standalone Creator plan");
  assert.equal(creator.price, CREATOR_PRICE);
  const perToken = creator.price / creator.monthlyTokens; // $6.99 / 500
  // fal's price page, 2026-11-23: Kling 3 Omni standard, with sound — and the seed still
  const PER_SECOND = 0.112, SEED = 0.04;
  for (const s of CREATOR_VIDEO_SECONDS) {
    const cost = s * PER_SECOND + SEED;
    const revenue = creatorVideoTokens(s) * perToken;
    const margin = 1 - cost / revenue;
    assert.ok(margin >= 0.2, `${s}s: ${(margin * 100).toFixed(1)}% (cost $${cost.toFixed(2)} on $${revenue.toFixed(2)})`);
  }
  // …and the worst engine in the fallback chain (Kling 3 Pro with sound, $0.168) is never a loss
  for (const s of CREATOR_VIDEO_SECONDS) assert.ok(s * 0.168 + SEED < creatorVideoTokens(s) * perToken * 1.06, `${s}s on the fallback`);
});

test("the server charges what the page quotes", () => {
  const ui = read("app", "routes", "web.studio.tsx");
  // the charge
  assert.ok(ui.includes("const durationHonored = casualMode && !effectiveEngine;"), "a length is honoured, and charged, on the default engine only");
  assert.ok(ui.includes("const videoDurationSec = durationHonored ? creatorVideoSeconds(form.get(\"videoDurationSec\")) : 5;"));
  assert.ok(ui.includes("const videoBase = casualMode ? creatorVideoTokens(videoDurationSec) : TOKEN_COST.video;"));
  assert.ok(ui.includes("const each = videoBase + engineSurcharge(effectiveEngine) * (casualMode ? CREATOR_SURCHARGE_MULT : 1);"));
  // the quote: the Pro button, the line under the wallet, and each length's own tile
  assert.ok(ui.includes("creatorVideoTokens(videoDurationSec) + engineSurcharge(\"auto\") * CREATOR_SURCHARGE_MULT, () => makeVideoQ(\"auto\")),"));
  assert.ok(ui.includes("(casual ? (videoEngine && videoEngine !== \"auto\" ? d.costs.casualVideo : creatorVideoTokens(videoDurationSec)) : d.costs.video)"));
  assert.ok(ui.includes("{CREATOR_VIDEO_SECONDS.map((sec) => ("));
  assert.ok(ui.includes("{t(\"{n} tokens\", { n: creatorVideoTokens(sec) })}"));
  assert.ok(ui.includes("<input type=\"hidden\" name=\"videoDurationSec\" value={String(videoDurationSec)} />"));
  // the picked engine makes one fixed clip: the 5-second price plus its surcharge, whatever the length
  assert.ok(ui.includes("d.costs.casualVideo + engineSurcharge(\"veo31\") * CREATOR_SURCHARGE_MULT, () => makeVideoQ(\"veo31\")),"));
  assert.equal(TOKEN_COST.casualVideo + engineSurcharge("veo31") * CREATOR_SURCHARGE_MULT, 285);
  // the old flat length fee is gone everywhere
  assert.equal(count(ui, "DURATION_SURCHARGE_10S"), 0);
  assert.equal(count(read("app", "lib", "plan-config.ts"), "export const DURATION_SURCHARGE_10S"), 0);
});

test("the length reaches the engine", () => {
  const jq = read("app", "lib", "job-queue.server.ts");
  assert.ok(jq.includes("durationSec: typeof payload.videoDurationSec === \"number\" ? payload.videoDurationSec : (payload.videoDurationSec ? Number(payload.videoDurationSec) : undefined),"));
  const vid = read("app", "lib", "video-generation.server.ts");
  assert.ok(vid.includes("const created = await animateCreate(engineKey, { startImage: seedImage, prompt, durationSec: params.durationSec, generateAudio: true });"));
});
