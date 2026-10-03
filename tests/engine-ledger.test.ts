import { test } from "node:test";
import assert from "node:assert/strict";
import { surchargeOwed, engineLedger } from "../app/lib/engine-ledger.ts";

/* The Studio charges the +25/+75 engine fee for any content type that submits
 * no presenter — Commercial always, Anthem/Cartoon when no presenter is picked.
 * Only ONE of the four video pipelines ever reconciled a downgrade; the other
 * three discarded animateCreate's model one destructure short. A commercial
 * renders one clip per beat, so "which engine ran" is a set, not a value. */

const VEO = "fal-ai/veo3.1/fast/image-to-video";
const DEFAULT = "kwaivgi/kling-v2.5-turbo-pro";

test("paid for veo31 and every clip ran it — owe nothing", () => {
  assert.equal(surchargeOwed("veo31", [VEO, VEO, VEO]), 0);
});

test("THE BUG: paid for veo31, every clip rendered on the free default", () => {
  // No FAL_KEY, or fal rejected: animateModelFor has no veo31 case.
  assert.equal(surchargeOwed("veo31", [DEFAULT, DEFAULT, DEFAULT]), 75);
});

test("ONE beat on the default still owes the surcharge — they bought the engine, not a majority of it", () => {
  // renderMotionClip deliberately re-renders a safety-filtered beat on the
  // default engine, so a mixed set is a real outcome, not a hypothetical.
  assert.equal(surchargeOwed("veo31", [VEO, DEFAULT, VEO]), 75);
  assert.equal(surchargeOwed("veo31", [VEO, VEO, DEFAULT]), 75);
});

test("the 25-token engines reconcile the same way", () => {
  assert.equal(surchargeOwed("hailuo", [DEFAULT]), 25);
  assert.equal(surchargeOwed("hailuo", ["minimax/hailuo-02"]), 0);
  assert.equal(surchargeOwed("seedance", ["bytedance/seedance-1-pro", DEFAULT]), 25);
});

test("no surcharge was charged, so nothing is ever owed", () => {
  assert.equal(surchargeOwed("auto", [DEFAULT]), 0);
  assert.equal(surchargeOwed(undefined, [DEFAULT]), 0);
  assert.equal(surchargeOwed(null, [DEFAULT, VEO]), 0);
});

test("an EMPTY set never invents a refund", () => {
  // A resumed prediction that never went through the adapter. Reading "" as a
  // total downgrade would refund a premium render that actually succeeded.
  assert.equal(surchargeOwed("veo31", []), 0);
  assert.equal(surchargeOwed("veo31", [null, undefined, ""]), 0);
});

test("the ledger collects models and reports blindness", () => {
  const l = engineLedger();
  assert.equal(l.blind(), true);
  assert.equal(l.owed("veo31"), 0, "a blind ledger must not owe anything");

  l.note(VEO);
  l.note(DEFAULT);
  assert.equal(l.blind(), false);
  assert.deepEqual(l.models(), [VEO, DEFAULT]);
  assert.equal(l.owed("veo31"), 75);
  assert.equal(l.owed("auto"), 0);
});

test("the ledger ignores the empty notes a fallback path can hand it", () => {
  const l = engineLedger();
  l.note(null);
  l.note(undefined);
  l.note("");
  assert.equal(l.blind(), true, "empty notes must not look like a recorded render");
  l.note(DEFAULT);
  assert.equal(l.blind(), false);
  assert.equal(l.owed("veo31"), 75);
});

test("note is passable as a bare callback — renderMotionClip's return type must not change", () => {
  // It has a dozen callers in scripts/video-qa.ts; breaking them to fix a
  // billing bug would be the wrong trade.
  const l = engineLedger();
  const cb: (m: string) => void = l.note;
  [VEO, DEFAULT].forEach(cb);
  assert.equal(l.owed("veo31"), 75);
});
