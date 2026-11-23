/* PAID FOR A BACKGROUND, GOT NONE.
 *
 * "Create a background" in the Studio is a paid picture that is then SAVED as a reusable Backdrop card.
 * The save was "non-fatal": when it failed — or the picture's address could not be read — the job still
 * completed, the tokens stayed spent, and no card ever appeared (the page waited and then said "That
 * didn't finish"). Found in the Studio audit of 2026-11-22.
 *
 * A background that is not saved was not delivered. The job now FAILS in that case, which is what the
 * app's one refund path acts on (refundPrepaidOnce) and what the page already reports.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const q = fs.readFileSync(path.join(root, "app", "lib", "job-queue.server.ts"), "utf8").replace(/\r\n/g, "\n");
const block = q.slice(q.indexOf("if (payload.saveAsBackdrop) {"), q.indexOf("// CARTOON COMBINE"));

test("a background that was not saved fails its job — the tokens go back the way every failed job's do", () => {
  assert.ok(block.length > 200, "the save-as-backdrop block is where it was");
  assert.ok(block.includes("let saved = false;"));
  // only the save itself decides it…
  assert.ok(block.indexOf("await db.backdrop.create({ data: { shopId, url: abs, label: \"Created\" } });") < block.indexOf("saved = true;"));
  assert.ok(block.indexOf("saved = true;") < block.indexOf("await db.backdrop.deleteMany("), "trimming the older cards comes after, and may fail quietly");
  assert.ok(block.indexOf("saved = true;") < block.indexOf("await tagAssetSection(createdAssetId, \"backdrop\", payload.__jobId as string | undefined);"), "so may tagging the picture");
  // …and without it the job throws (outside the try, so nothing swallows it)
  const thrown = block.indexOf("if (!saved) throw new Error(");
  assert.ok(thrown > block.lastIndexOf("} catch (e) {"), "the throw is after the catch, not inside the try");
  assert.ok(block.includes("if (!saved) throw new Error(\"The background was made but could not be saved, so it was not charged — try again.\");"));
  assert.ok(thrown < block.lastIndexOf("break;"));
  // a picture that was never made at all is not "saved" either
  assert.ok(block.includes("if (typeof createdAssetId === \"string\") {") && !q.includes("if (payload.saveAsBackdrop && typeof createdAssetId === \"string\") {"));
});

test("the refund itself is the existing one: a prepaid job that ends failed is refunded exactly once", () => {
  // (nothing new is credited here: the change only makes "nothing delivered" a failure)
  assert.ok(!block.includes("refundTokens("), "no second refund path");
  assert.ok(q.includes("if (!p.prePaid || !REFUND_BY_TYPE[job.type]) return;"));
  assert.ok(q.includes("if (claimed.count !== 1) return; // someone else is refunding this one"));
});
