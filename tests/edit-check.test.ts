/* AN EDIT THE MODEL DID NOT MAKE IS NOT CHARGED.
 *
 * A photo edit is one paid ask of a picture model. Now and then the model hands the photo back unchanged,
 * with no error, and the customer has paid for their own picture (the owner's "Make him a demon",
 * 2026-11-18 — 5 tokens for nothing). Rival tools' reviews name this more than almost anything else:
 * credits spent on a result that is not what was asked for.
 *
 * Counting pixels cannot tell (the "unchanged" copy differed from its source MORE than a real eye-colour
 * edit did — 7.8 against 2.2, measured), so the result is looked at. The question, on the real reader:
 * two identical pairs → "differences: none, made: false"; two changed pairs → the differences listed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EDIT_RETRY_LEAD, canBeDeclined, editCheckPrompt, editNote, parseEditCheck } from "../app/lib/edit-check.ts";
import { firstJson } from "../app/lib/first-json.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("the question: write down what differs, then say whether the change was made", () => {
  const q = editCheckPrompt("  make the shirt   a purple hoodie ");
  assert.ok(q.startsWith(`Image 1 is a photo. Image 2 is what came back after this edit was requested: "make the shirt a purple hoodie".`));
  assert.ok(q.includes("First write down, in a few words, every visible difference between image 1 and image 2"));
  // generous: partly made, or an honest attempt, is made — only "the same picture" is not
  assert.ok(q.includes("Made fully or partly counts as made") && q.includes("clearly an attempt at it"));
  assert.ok(q.includes("NOT made only if image 2 is the same picture as image 1"));
  assert.ok(q.includes("sharpness, a slight colour shift, compression or a small crop"));
  assert.ok(q.endsWith(`Reply with ONLY this JSON: {"differences": "…", "made": true or false}.`));
  assert.ok(editCheckPrompt("x".repeat(900)).length < 1000, "a long request is cut, not sent whole");
});

test("the answer is read; an unreadable one is nothing (and then nothing changes)", () => {
  assert.deepEqual(parseEditCheck(`{"differences": "none", "made": false}`), { made: false, differences: "none" });
  assert.deepEqual(parseEditCheck("```json\n{\"differences\": \"the shirt is now a purple hoodie\", \"made\": true}\n```"), { made: true, differences: "the shirt is now a purple hoodie" });
  assert.equal(parseEditCheck(`{"differences": "none", "made": "no"}`), null);
  assert.equal(parseEditCheck("I can't compare these."), null);
  assert.equal(parseEditCheck(""), null);
  assert.equal(parseEditCheck(`{"differences": "${"x".repeat(500)}", "made": true}`)!.differences.length, 200);
});

test("the first complete answer is the one read — a reader that second-guesses itself cannot undo it", () => {
  assert.deepEqual(firstJson(`{"made": false} Wait, let me look again. {"made": true}`), { made: false });
  assert.deepEqual(firstJson("```json\n{\"a\": \"a } brace and a \\\"quote\\\"\", \"b\": {\"c\": 1}}\n``` trailing }"), { a: "a } brace and a \"quote\"", b: { c: 1 } });
  assert.equal(firstJson("no json here"), null);
  assert.equal(firstJson("{ cut off"), null);
  assert.equal(firstJson("[1, 2, 3]"), null);
  assert.equal(firstJson(null), null);
});

test("only an edit a model can quietly decline is looked at", () => {
  for (const op of ["describe", "replace", "restyle", "cartoonize"]) assert.equal(canBeDeclined(op), true, op);
  // mechanical edits have nothing to decline
  for (const op of ["bgremove", "bgswap", "colorize", "upscale", ""]) assert.equal(canBeDeclined(op), false, op);
  assert.ok(EDIT_RETRY_LEAD.startsWith("Apply this change clearly and visibly"));
});

test("the edit: looked at, asked once more when not made, and marked declined when it still is not", () => {
  const img = read("app", "lib", "image-generation.server.ts");
  const edit = img.slice(img.indexOf("export async function editImage(opts: {"), img.indexOf("/** Creator \"Make an image\""));
  assert.ok(edit.includes("if (canBeDeclined(editOp)) {"));
  assert.ok(edit.includes("let seen = await editWasMade(sourceImageUrl, localUrl, request);"));
  // the second ask is the same edit, said more plainly
  assert.equal(edit.split("`${EDIT_RETRY_LEAD}").length - 1, 2, "for a described edit and for a restyle");
  assert.ok(edit.includes("if (seen && !seen.made && redo) {"));
  // the second result replaces the first only when it is not known to be unchanged too
  assert.ok(edit.includes("if (!seenAgain || seenAgain.made) { localUrl = again.localUrl; usedEngine = again.engine; seen = seenAgain; }"));
  assert.ok(edit.includes("declined = !!seen && !seen.made;"), "a look that could not be made declines nothing");
  // the result is KEPT (it is shown, with the reason) and the asset says so
  assert.ok(edit.includes("...(declined ? { declined: true } : {})") && edit.includes("...(editCheck ? { editCheck } : {})"));
  assert.ok(edit.indexOf("declined = !!seen && !seen.made;") < edit.indexOf("const asset = await db.asset.create({"));
  // the look itself: original first, result second, and never fatal
  const look = img.slice(img.indexOf("async function editWasMade("), img.indexOf("async function editWasMade(") + 900);
  assert.ok(look.includes("anthropicVision(editCheckPrompt(request), [sourceUrl, result], { maxTokens: 300, model: \"claude-sonnet-4-6\" })"));
  assert.ok(look.includes("return null;") && look.includes("the result could not be looked at (the edit stands)"));
});

test("the tokens go back once: claimed, credited, recorded — and a free make has nothing to return", () => {
  const q = read("app", "lib", "job-queue.server.ts");
  assert.ok(q.includes("const editedId = await editImage({") && q.includes("await returnDeclinedEdit({ assetId: editedId, shopId, jobType: type, payload });"));
  const fn = q.slice(q.indexOf("async function returnDeclinedEdit("), q.indexOf("/** Refund a terminally-failed pre-paid job EXACTLY ONCE."));
  assert.ok(fn.includes("if (p.freeGen || !p.prePaid || p.ckDeclinedRefunded) return;"));
  assert.ok(fn.includes("if (meta.declined !== true) return;"), "only an edit the look marked");
  assert.ok(fn.includes("const charged = typeof p.chargedTokens === \"number\" && p.chargedTokens > 0 ? p.chargedTokens : REFUND_BY_TYPE[o.jobType] || 0;"), "what was really charged (an Ultra edit costs more)");
  const claim = fn.indexOf("await checkpointJob(jobId, { ckDeclinedRefunded: true });");
  const credit = fn.indexOf("await refundTokens(o.shopId, charged, typeof p.chargedFromExtra === \"number\" ? p.chargedFromExtra : 0);");
  const record = fn.indexOf("await checkpointJob(jobId, { ckDeclinedRefundedAmount: charged });");
  assert.ok(claim > 0 && claim < credit && credit < record, "claim, then credit, then record the amount");
  assert.ok(fn.includes("tokensReturned: charged"), "the piece itself says what came back, for the page to show");
  assert.ok(fn.includes("DECLINED-EDIT REFUND FAILED after being claimed"), "a failed credit is loud");
  // a later terminal failure does not pay it again
  assert.ok(q.includes("(typeof p.ckDeclinedRefundedAmount === \"number\" && p.ckDeclinedRefundedAmount > 0 ? p.ckDeclinedRefundedAmount : 0);"));
  // and the job is NOT failed for it: no throw in the helper's happy path
  assert.ok(!fn.includes("throw "));
});

/* …AND THE PAGE SAYS SO (2026-11-22). The refund was silent: the picture came back as it went in, and
 * nothing on the Stage said why, or that it had cost nothing — it read as "it charged me and did nothing". */
test("the Stage says an edit was not made, and that the tokens came back", () => {
  // what is read off the piece
  assert.deepEqual(editNote(JSON.stringify({ kind: "edit", declined: true, tokensReturned: 5 })), { notMade: true, returned: 5 });
  assert.deepEqual(editNote(JSON.stringify({ kind: "edit", declined: true })), { notMade: true }, "saved, the refund not noted yet — or a free make");
  assert.deepEqual(editNote(JSON.stringify({ kind: "edit", declined: true, tokensReturned: 0 })), { notMade: true });
  assert.deepEqual(editNote(JSON.stringify({ kind: "edit", declined: false, tokensReturned: 5 })), {}, "an edit that was made says nothing");
  assert.deepEqual(editNote(JSON.stringify({ kind: "edit" })), {});
  assert.deepEqual(editNote("not json"), {});
  assert.deepEqual(editNote(null), {});
  assert.deepEqual(editNote("null"), {});
  // the Studio: its shelf rows carry it, the Stage piece carries it, and the note is drawn above the controls
  const ui = read("app", "routes", "web.studio.tsx");
  assert.ok(ui.includes("select: { id: true, type: true, bodyJson: true, metaJson: true, title: true, createdAt: true },"));
  assert.ok(ui.includes("const made = editNote(a.metaJson);") && ui.includes("at: a.createdAt.toISOString(), ...made };"));
  assert.ok(ui.includes("type StagePiece = { id: string; isVideo: boolean; isAudio: boolean; media: string; title: string; notMade?: boolean; returned?: number };"));
  assert.equal(ui.split("notMade: fresh.notMade, returned: fresh.returned").length - 1, 1, "the piece that just landed");
  assert.equal(ui.split("notMade: p.notMade, returned: p.returned").length - 1, 1, "…and one opened from the shelf");
  assert.ok(ui.includes("{stageResult?.notMade && (\n             <p className=\"ws-notmade\" role=\"status\">"));
  assert.ok(ui.includes("t(\"The model didn’t make that change, so this one is on us — your {n} tokens are back. Try saying it another way.\", { n: stageResult.returned })"));
  assert.ok(ui.includes(".ws-notmade{"));
  // the tokens go back a beat AFTER the piece is saved: the note waits for them (six seconds at most)
  const land = ui.slice(ui.indexOf("const fresh = d.recent.find((p) => p.media && !preIdsRef.current.includes(p.id) && ofKind(p));"), ui.indexOf("setStageResult({ id: fresh.id"));
  assert.ok(land.includes("if (fresh.notMade && !fresh.returned) {") && land.includes("if (!notMadeSeenRef.current) { notMadeSeenRef.current = Date.now(); return; }") && land.includes("if (Date.now() - notMadeSeenRef.current < 6000) return;"));
  // both sentences in all five languages
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  assert.equal(dict.split("  \"The model didn’t make that change, so this one is on us — your {n} tokens are back. Try saying it another way.\": ").length - 1, 5);
  assert.equal(dict.split("  \"The model didn’t make that change. Try saying it another way.\": ").length - 1, 5);
});

test("…and the Archive's viewer says the same, for a piece opened later", () => {
  const arc = read("app", "routes", "web.archive.tsx");
  assert.ok(arc.includes("import { editNote } from \"../lib/edit-check\";"));
  assert.ok(arc.includes("        ...editNote(a.metaJson),"), "every card carries it from the loader");
  const note = arc.slice(arc.indexOf("{viewer.notMade && ("), arc.indexOf("{viewer.missed && ("));
  assert.ok(note.includes("className=\"wa-vmissed\"") && note.includes("{ n: viewer.returned }"), "the note the viewer already has a place and a look for");
  assert.ok(note.includes("t(\"The model didn’t make that change. Try saying it another way.\")"), "the same two sentences as the Stage — translated once");
});
