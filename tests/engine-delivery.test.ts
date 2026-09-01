import { test } from "node:test";
import assert from "node:assert/strict";
import { engineKeyForModel, surchargeShortfall, downgradeNote } from "../app/lib/engine-delivery.ts";

/* Surcharges live in video-engines.ts: veo31 +75, veo +75, hailuo +25,
 * seedance +25, everything else 0. */

test("the fal-only premium engine is recognised when it really ran", () => {
  assert.equal(engineKeyForModel("fal-ai/veo3.1/fast/image-to-video"), "veo31");
  // paid for veo31, got veo31 — owe nothing
  assert.equal(surchargeShortfall("veo31", "fal-ai/veo3.1/fast/image-to-video"), 0);
});

test("THE BUG: veo31 paid for, default engine delivered", () => {
  // no FAL_KEY or a fal reject -> animateModelFor has no veo31 case -> DEFAULT
  assert.equal(surchargeShortfall("veo31", "kwaivgi/kling-v2.5-turbo-pro"), 75);
  assert.equal(surchargeShortfall("veo31", "fal-ai/kling-video/v2.6/pro/image-to-video"), 75);
});

test("veo 3 downgraded to the default is also 75", () => {
  assert.equal(surchargeShortfall("veo", "kwaivgi/kling-v2.5-turbo-pro"), 75);
  assert.equal(surchargeShortfall("veo", "google/veo-3-fast"), 0);
});

test("the 25-token engines are reconciled too", () => {
  assert.equal(surchargeShortfall("hailuo", "kwaivgi/kling-v2.5-turbo-pro"), 25);
  assert.equal(surchargeShortfall("seedance", "kwaivgi/kling-v2.5-turbo-pro"), 25);
  // ...and NOT refunded when they actually ran
  assert.equal(surchargeShortfall("hailuo", "minimax/hailuo-02"), 0);
  assert.equal(surchargeShortfall("seedance", "bytedance/seedance-1-pro"), 0);
});

test("a free engine owes nothing however it is routed", () => {
  for (const m of [
    "fal-ai/kling-video/v2.6/pro/image-to-video",
    "kwaivgi/kling-v2.5-turbo-pro",
    "kwaivgi/kling-v1.6-standard",
  ]) {
    assert.equal(surchargeShortfall("kling", m), 0, m);
    assert.equal(surchargeShortfall("auto", m), 0, m);
    assert.equal(surchargeShortfall(undefined, m), 0, m);
  }
});

test("a better engine than was paid for is a gift, never a negative charge", () => {
  // paid nothing, got Veo — must not produce a negative refund
  assert.equal(surchargeShortfall("kling", "fal-ai/veo3.1/fast/image-to-video"), 0);
  assert.equal(surchargeShortfall("hailuo", "fal-ai/veo3.1/fast/image-to-video"), 0);
});

test("an unknown model refunds rather than silently keeping the surcharge", () => {
  // conservative on purpose: if we cannot identify what ran, we do not get to
  // claim we delivered a premium engine
  assert.equal(engineKeyForModel("some/model-we-added-later"), "auto");
  assert.equal(surchargeShortfall("veo31", "some/model-we-added-later"), 75);
  assert.equal(surchargeShortfall("veo31", null), 75);
  assert.equal(surchargeShortfall("veo31", ""), 75);
});

test("the downgrade note names both engines and the amount, and is empty when nothing is owed", () => {
  const n = downgradeNote("veo31", "kwaivgi/kling-v2.5-turbo-pro");
  assert.match(n, /veo31/);
  assert.match(n, /kling-v2\.5-turbo-pro/);
  assert.match(n, /75 tokens returned/);
  assert.equal(downgradeNote("veo31", "fal-ai/veo3.1/fast/image-to-video"), "");
  assert.equal(downgradeNote("kling", "kwaivgi/kling-v2.5-turbo-pro"), "");
});
