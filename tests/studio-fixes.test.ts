/* The Creator and the Ad Maker (app/routes/web.studio.tsx): twelve things found by reading the page end to
 * end, 2026-11-22 — and a thirteenth found while checking the others.
 *
 * Most of them are about MONEY that had already moved: a paid frame thrown away by a keystroke, a paid
 * piece that never reached the Stage, a wait that ended by offering the same paid button again while the
 * first job was still in the queue. The rest are about a tap that looked like it did nothing.
 *
 * The page cannot be loaded here (it is a route: loader, action and JSX in one file), so each test reads
 * it as text and pins the lines that carry the fix — and, where the rule is small enough to state, runs
 * the rule itself beside the line it was copied from. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const ui = read("app", "routes", "web.studio.tsx");
/** The source between two landmarks (the first `from`, and the first `to` after it). */
const cut = (from: string, to: string): string => {
  const a = ui.indexOf(from);
  assert.ok(a >= 0, `landmark not found: ${from}`);
  const b = ui.indexOf(to, a + from.length);
  assert.ok(b > a, `landmark not found after it: ${to}`);
  return ui.slice(a, b);
};
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

test("1 — typing the product name never drops the shot: hold/wear is pinned with the shot it was taken with", () => {
  // In the Avatar hub the Product name box comes AFTER Combine. Hold/wear was auto-detected from that name
  // on every keystroke, and it is one of the things the stale-frame effect watches — so a name that merely
  // PASSES THROUGH an apparel word flipped it, and the approved, paid frame was gone without a word.
  const m = /const APPAREL_RE = \/(.+)\/i;/.exec(ui);
  assert.ok(m, "the detector is where it was");
  const apparel = (s: string) => new RegExp(m[1], "i").test(s);
  const typed = (word: string) => [...word].map((_, i) => word.slice(0, i + 1));
  assert.deepEqual(typed("Bracelet").filter(apparel), ["Bra"], "a bracelet is 'apparel' for exactly one keystroke");
  assert.deepEqual(typed("Topaz ring").filter(apparel), ["Top"]);
  // …and `wear` is still a reason to drop a frame (a real hold/wear flip does make it stale)
  assert.ok(ui.includes("const wear = wearOverride === null ? apparel : wearOverride;"));
  assert.ok(ui.includes("}, [avatarId, imageUrl, wear, contentType, productSize]);"));

  // THE FIX. Detection only leads while there is no shot to lose…
  assert.ok(ui.includes("useEffect(() => { if (!combineUrl && !combining) setWearOverride(null); }, [apparel]);"));
  assert.ok(!ui.includes("useEffect(() => { setWearOverride(null); }, [apparel]);"), "the unguarded reset is gone");
  // …and whatever takes a shot pins the choice it was taken with. A Combine, first thing:
  const combine = cut("const doCombine = (over?: { variant?: number; scene?: string }) => {", "const applyCombineEdit = () => {");
  assert.ok(combine.includes("setWearOverride(wear);"));
  assert.ok(combine.indexOf("setWearOverride(wear);") < combine.indexOf("const formEl = formRef.current;"), "at the top");
  // a reused shot (to what the name it now sits beside detects) and an uploaded one — neither goes
  // through doCombine, and an uploaded shot is not in the reuse strip: dropped, it is uploaded again
  const reuse = cut("const useFrame = (f: {", "const clearCombineFrame = () => {");
  assert.ok(reuse.includes("const nextWear = wearOverride === null ? isApparel(name) : wearOverride;"));
  assert.ok(reuse.includes("if (wearOverride === null) setWearOverride(nextWear);"));
  assert.ok(ui.includes("if (data.frameUrl) { setWearOverride(wear); setCombineScene(\"\");"));
  // A DIFFERENT PRODUCT starts from detection again: the guard reads the OLD shot at the moment a new
  // product is picked, so without this a shot of a mug left "Holding it" pinned for the hoodie picked next.
  assert.ok(ui.includes("useEffect(() => { setWearOverride(null); }, [imageUrl]);"));
});

test("2 — a Trim with no End is refused before a token moves, and a failed video edit reaches the Stage", () => {
  const branch = cut("if (intent === \"videoedit\") {", "if (intent === \"image\") {");
  // SEEN: Trim is the preselected op and its button was live with both boxes empty. A blank box is not
  // sent at all, and Number(null) is 0 — so End arrived as 0, five tokens were taken, and the worker
  // refused the job on every attempt.
  assert.equal(Number(null), 0);
  assert.equal(Number(""), 0);
  assert.ok(!branch.includes("Number(form.get("), "no field is read that way any more");
  assert.ok(read("app", "lib", "video-edit.server.ts").includes("if (!Number.isFinite(end) || end <= start) throw new Error(\"[video-edit] trim needs endSec > startSec\");"), "the rule the worker enforces");

  // THE FIX, server: a missing or empty field is ABSENT…
  assert.ok(branch.includes("const secField = (name: string): number | undefined => {"));
  assert.ok(branch.includes("if (typeof raw !== \"string\" || !raw.trim()) return undefined;"));
  assert.ok(branch.includes("return Number.isFinite(n) ? n : undefined;"));
  const secField = (form: FormData, name: string): number | undefined => {
    const raw = form.get(name);
    if (typeof raw !== "string" || !raw.trim()) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  const form = new FormData();
  form.set("blank", ""); form.set("spaces", "  "); form.set("ten", "10"); form.set("half", "0.5"); form.set("junk", "abc");
  assert.equal(secField(form, "missing"), undefined);
  assert.equal(secField(form, "blank"), undefined);
  assert.equal(secField(form, "spaces"), undefined);
  assert.equal(secField(form, "junk"), undefined);
  assert.equal(secField(form, "ten"), 10);
  assert.equal(secField(form, "half"), 0.5);
  // …a Trim starts at 0 when Start is left blank (the box's own placeholder)…
  assert.ok(branch.includes("const startSec = editOp === \"trim\" ? (secField(\"startSec\") ?? 0) : secField(\"startSec\");"));
  // …and is refused unless End is after Start — BEFORE the one place this branch spends
  assert.ok(branch.includes("if (editOp === \"trim\" && (startSec === undefined || startSec < 0 || endSec === undefined || endSec <= startSec)) {"));
  const refusal = branch.indexOf("return json({ error: tr(lang, \"Set an End time that is after the Start.\") });");
  const spend = branch.indexOf("spendTokens(shop.id, TOKEN_COST.videoEdit)");
  assert.ok(refusal > 0 && spend > refusal, "refused before it is charged");
  assert.equal(count(branch, "spendTokens("), 1);
  const refused = (startSec: number | undefined, endSec: number | undefined) => startSec === undefined || startSec < 0 || endSec === undefined || endSec <= startSec;
  assert.equal(refused(0, undefined), true, "both boxes empty — the case that was charged");
  assert.equal(refused(5, 5), true);
  assert.equal(refused(5, 3), true);
  assert.equal(refused(-1, 3), true);
  assert.equal(refused(0, 10), false);
  assert.equal(refused(2.5, 2.6), false);

  // THE FIX, page: the same rule decides whether the button is live — and the page says why it is not
  assert.ok(ui.includes("const trimFrom = trimStart.trim() === \"\" ? 0 : Number(trimStart);"));
  assert.ok(ui.includes("const trimTo = trimEnd.trim() === \"\" ? NaN : Number(trimEnd);"));
  assert.ok(ui.includes("const trimReady = trimFrom >= 0 && trimTo > trimFrom;"));
  assert.ok(ui.includes("const videoEditReady = isVideoEdit && (videoEditOp !== \"caption\" || !!videoCaption.trim()) && (videoEditOp !== \"trim\" || trimReady);"));
  assert.ok(ui.includes("|| (isVideoEdit && !videoEditReady) ||"), "…and that is part of what disables the button");
  const ready = (start: string, end: string) => {
    const trimFrom = start.trim() === "" ? 0 : Number(start);
    const trimTo = end.trim() === "" ? NaN : Number(end);
    return trimFrom >= 0 && trimTo > trimFrom;
  };
  assert.equal(ready("", ""), false, "both boxes empty: not live");
  assert.equal(ready("3", ""), false);
  assert.equal(ready("", "10"), true, "a blank Start is the start of the clip");
  assert.equal(ready("4", "4"), false);
  assert.equal(ready("4", "9.5"), true);
  for (const [s, e] of [["", ""], ["3", ""], ["", "10"], ["4", "4"], ["4", "9.5"], ["-1", "3"]] as const) {
    const f = new FormData();
    if (s.trim() !== "") f.set("startSec", s); // the page sends a box only when it has something in it
    if (e.trim() !== "") f.set("endSec", e);
    assert.equal(ready(s, e), !refused(secField(f, "startSec") ?? 0, secField(f, "endSec")), `the page and the action agree on "${s}" → "${e}"`);
  }
  assert.ok(ui.includes("{videoEditOp === \"trim\" && !trimReady && <p className=\"ws-note\" style={{ margin: 0 }}>{t(\"Set an End time that is after the Start.\")}</p>}"));

  // AND THE STAGE HEARS ABOUT IT. The loader's "newest Creator job" probe is what stops "Making your
  // video…" when a job fails; EDIT_VIDEO was not on its list, so that line had nothing to stop it.
  assert.ok(ui.includes("type: { in: [\"GENERATE_IMAGE_AD\", \"GENERATE_VIDEO_AD\", \"GENERATE_SONG\", \"EDIT_VIDEO\"] }, payload: { contains: '\"section\":\"creator\"' } },"));
  assert.ok(branch.includes("section: \"creator\", sourceVideoUrl, editOp, startSec, endSec, captionText, speed, title: editTitle,"), "a video edit is tagged the way the probe looks for");
  // a video edit carries an editOp too — without its own line it would have been read as a PHOTO edit
  const kind = cut("const kind = lastGenRow.type === \"GENERATE_SONG\" ? \"song\"", "const source =");
  assert.ok(kind.includes(": lastGenRow.type === \"EDIT_VIDEO\" ? \"video\""));
  assert.ok(kind.indexOf("\"EDIT_VIDEO\" ? \"video\"") < kind.indexOf(": p.editOp ? \"photo\" : \"image\";"));
});

test("3 — a long wait never offers the paid button again: the SAME job is followed until it answers", () => {
  // SEEN: Combine gave up after 4 minutes ("try Combine again") and "Create a background" after 2 ("or try
  // again") — each re-enabling a PAID button while the first, already-charged job was still queued. The
  // worker runs one job at a time for every shop, so that wait is ordinary behind someone else's video;
  // both jobs then finished and both were charged.
  assert.ok(!ui.includes("That took too long — try Combine again."));
  assert.ok(!ui.includes("That background is taking a while"));

  // COMBINE: the clock only changes the line under the spinner; the job is still asked about, by id
  const poll = cut("if (!combining || !combineJobId) return;", "const iv = setInterval(tick, 4000);");
  assert.ok(poll.includes("if (Date.now() - combineStartRef.current > 4 * 60_000) setCombineSlow(true);"));
  assert.ok(poll.includes("statusFetcher.load(`/web/studio?combineJob=${encodeURIComponent(combineJobId)}`);"));
  assert.ok(!poll.includes("setCombining(false)") && !poll.includes("setCombineErr(") && !poll.includes("return;\n      }"), "nothing in the timer ends the wait");
  assert.equal(count(ui, "{combineSlow ? t(\"Still in line — it shows up here when it's ready.\") : t(\"This usually takes up to a minute — hang tight.\")}"), 2);
  assert.ok(ui.includes("useEffect(() => { if (!combining) setCombineSlow(false); }, [combining]);"), "the next Combine starts with the usual line");
  // …the button stays off for as long as it waits, and only the job's own answer ends it
  assert.ok(ui.includes("<button type=\"button\" className=\"wb-btn ws-combine-btn\" disabled={combining || busy}"));
  const answer = cut("const r = statusFetcher.data?.combineResult;", "}, [statusFetcher.data, combining, combineJobId]);");
  assert.ok(answer.includes("if (!r || r.jobId !== combineJobId) return;"));
  assert.equal(count(answer, "setCombining(false)"), 3, "the frame landed · the job failed · the job finished with no frame");

  // CREATE A BACKGROUND: the same — and it now HAS a job to follow. The action always answered with the
  // job's id; the page kept it nowhere, so the only thing it could do with a long wait was give up.
  assert.ok(ui.includes("return json({ ok: true, bgJobId });"));
  assert.ok(ui.includes("else if (bd.bgJobId) setBgJobId(bd.bgJobId);"));
  const bgPoll = cut("if (!bgGenerating) return;\n    const iv = window.setInterval(() => {", "}, 3500);");
  assert.ok(bgPoll.includes("if (Date.now() - bgGenStartRef.current > 120000) setBgSlow(true);"));
  assert.ok(bgPoll.includes("if (bgRev.state === \"idle\") bgRev.revalidate();"), "the new Backdrop is still found the way it always was");
  assert.ok(bgPoll.includes("if (bgJobId) bgStatusFetcher.load(`/web/studio?combineJob=${encodeURIComponent(bgJobId)}`);"));
  assert.ok(!bgPoll.includes("setBgGenerating(false)") && !bgPoll.includes("setCombineErr(") && !bgPoll.includes("clearInterval"), "nothing in the timer ends the wait");
  assert.ok(ui.includes("{bgGenerating && bgSlow ? t(\"Still in line — it shows up here when it's ready.\") : t(\"We’ll make the scene ({n} tok) so you can see it before you combine.\", { n: d.costs.createImage })}"));
  assert.ok(ui.includes("disabled={bgGenerating || !combineScene.trim()}"), "Create stays off while it waits");
  // the loader's ?combineJob= probe reads ANY image job's status, so the background's job can be asked too
  assert.ok(ui.includes("where: { id: combineJobId, shopId: shop.id, type: \"GENERATE_IMAGE_AD\" },"));
  assert.ok(ui.includes("combineResult = { jobId: combineJobId, done: cjob.status === \"COMPLETED\" || cjob.status === \"FAILED\", failed: cjob.status === \"FAILED\", media };"));
  // …and only its answer ends the wait: failed (the queue has refunded it), or finished with nothing kept
  const bgAnswer = cut("const st = bgStatusFetcher.data;", "}, [bgStatusFetcher.data, bgGenerating, bgJobId]);");
  assert.ok(bgAnswer.includes("if (!r || r.jobId !== bgJobId || !r.done) return;"));
  assert.equal(count(bgAnswer, "setBgGenerating(false)"), 2);
  assert.ok(bgAnswer.includes("} else if (!(st?.backdrops ?? []).some((b) => !bgKnownIdsRef.current.has(b.id))) {"));
  // a second background is a second job: the first one's answer must not be read as its own
  const create = cut("const createBackground = () => {", "backdropFetcher.submit(fd, { method: \"post\" });");
  assert.ok(create.includes("setBgJobId(null);") && create.includes("setBgSlow(false);"));
});

test("4 — looking at a past creation changes nothing else: the piece that is cooking still arrives", () => {
  // SEEN: every shelf thumbnail calls loadToStage, which stopped `making` — and the only poll runs while
  // `making` is true. Tap a past piece while a new one cooks and the new, PAID one never reached the Stage.
  // It also threw away a photo loaded for editing while hasFile stayed true: "Edit photo" stayed live and
  // posted with no photo.
  const load = cut("const loadToStage = (p: StagePiece) => {", "const onStagePhoto = (");
  assert.ok(load.includes("setStageResult(p);"));
  assert.ok(!load.includes("setMaking(false)"), "the watch keeps running");
  assert.ok(!load.includes("setEditPreview(") && !load.includes("setEditFile(null)"), "the photo stays loaded");
  assert.ok(!load.includes("setEditingSrc(null)"), "…and so does the photo that is cooking");
  assert.ok(ui.includes("<button type=\"button\" onClick={() => p.media && loadToStage({ id: p.id, isVideo: p.isVideo, isAudio: p.isAudio, media: p.media, title: p.title, notMade: p.notMade, returned: p.returned })} key={p.id} className=\"ws-shelf-piece\""));
  // WHY NONE OF IT WAS NEEDED: the Stage draws a result above both the photo being edited and the
  // cooking state — so the past piece shows either way, and both are back when it is cleared.
  const stage = cut("<aside className=\"ws-stage\">", "{/* RESULT CONTROLS");
  const order = ["{stageResult ? (", ") : genError ? (", ") : (isEdit && editPreview) ? (", ") : cookingPhoto ? ("].map((s) => stage.indexOf(s));
  assert.ok(order.every((n, i) => n >= 0 && (i === 0 || n > order[i - 1])), `the result branch comes first: ${order.join(", ")}`);
  // the poll it used to stop, and the landing it used to prevent
  assert.ok(ui.includes("if (stageRev.state === \"idle\") stageRev.revalidate();"));
  assert.ok(ui.includes("const fresh = d.recent.find((p) => p.media && !preIdsRef.current.includes(p.id));"));
});

test("5 — reusing a past shot keeps that shot, and never types over the product name", () => {
  // SEEN, one tap: the reuse re-matched the presenter to the shot — a thing the stale-frame effect watches
  // — and that effect wiped the frame the tap had just set (a shot made with another presenter needed a
  // second tap). And it wrote the shot's stored name over whatever was typed: the literal "product" for a
  // Combine made before the product was named, or an Archive title such as "Photo edit — edited".
  assert.ok(ui.includes("productTitle: productTitle || \"product\", ...(noProductCombine ? {} : { productImageUrl }), productUrl,"), "where the stand-in comes from");

  // THE NAME: the loader offers the name the shot was MADE with, or none…
  assert.ok(ui.includes("productTitle: m.productTitle && m.productTitle !== \"product\" ? m.productTitle : null,"));
  assert.ok(!ui.includes("m.productTitle || a.title"));
  const offered = (m: { productTitle?: string }) => (m.productTitle && m.productTitle !== "product" ? m.productTitle : null);
  assert.equal(offered({ productTitle: "product" }), null);
  assert.equal(offered({}), null, "an Archive title is not a product name");
  assert.equal(offered({ productTitle: "Midnight Roast" }), "Midnight Roast");
  // …and the page fills only an EMPTY box
  const reuse = cut("const useFrame = (f: {", "const clearCombineFrame = () => {");
  assert.ok(reuse.includes("const name = productTitle.trim() ? productTitle : (f.productTitle || productTitle);"));
  assert.ok(reuse.includes("if (name !== productTitle) setProductTitle(name);"));
  assert.ok(!ui.includes("if (f.productTitle) setProductTitle(f.productTitle);"));
  const filled = (typed: string, stored: string | null) => (typed.trim() ? typed : (stored || typed));
  assert.equal(filled("My own name", "Midnight Roast"), "My own name");
  assert.equal(filled("", "Midnight Roast"), "Midnight Roast");
  assert.equal(filled("  ", null), "  ");

  // THE FRAME: the reuse leaves a note of what it changes the effect's inputs TO, and the effect lets
  // exactly that through — once. The note and the effect read the same five things, in the same order.
  assert.ok(reuse.includes("reusedFrameRef.current = frameDepsKey(nextAvatar, imageUrl, nextWear, contentType, productSize);"));
  assert.ok(reuse.indexOf("reusedFrameRef.current = ") < reuse.indexOf("setCombineUrl(f.media);"));
  const stale = cut("const reused = reusedFrameRef.current;", "}, [avatarId, imageUrl, wear, contentType, productSize]);");
  assert.ok(stale.includes("reusedFrameRef.current = null;"), "read once");
  assert.ok(stale.includes("if (reused === frameDepsKey(avatarId, imageUrl, wear, contentType, productSize)) return;"));
  assert.ok(stale.indexOf("return;") < stale.indexOf("resetCombine();"));
  // what that decides, for a shot made with another presenter
  const key = (...deps: unknown[]) => JSON.stringify(deps);
  const note = key("rosa", "https://x/p.jpg", false, "avatar", "");
  assert.equal(note === key("rosa", "https://x/p.jpg", false, "avatar", ""), true, "the reuse's own change: the frame stays");
  assert.equal(note === key("omar", "https://x/p.jpg", false, "avatar", ""), false, "a presenter picked afterwards: the frame goes");
  assert.equal(note === key("rosa", "https://x/p.jpg", true, "avatar", ""), false, "a hold/wear flip afterwards: the frame goes");
  assert.equal(null === (key("rosa", "", false, "avatar", "") as string | null), false, "no reuse, no shield");
});

test("6 — “Create a background” says why it was refused", () => {
  // SEEN: the button has no plan or token gate of its own, and the action refuses BEFORE it queues — not
  // enough tokens, no plan, no brand voice, a plan that cannot make images — answering { error } as every
  // other intent does. The page read only `backdropError`: the "Creating…" card spun for two minutes and
  // then blamed the wait.
  assert.ok(ui.includes("if (!shop.activePlan?.active) return json({ error: tr(lang, \"Pick a plan on the Dashboard first — content runs on tokens.\") });"));
  assert.ok(ui.includes("return json({ error: e instanceof Error ? e.message : tr(lang, \"Couldn't queue that.\") });"), "…and a refused spend lands here");
  assert.ok(ui.includes("else if (bd.error) { setCombineErr(bd.error); setBgGenerating(false); setBgUploading(false); }"));
  assert.ok(ui.includes("backdropRenamed?: { id: string; label: string }; error?: string; bgJobId?: string }>();"), "the answer's shape says so too");
  // the reason is shown in the panel the button belongs to
  assert.ok(ui.includes("{combineErr && <p className=\"ws-note ws-err\" style={{ marginTop: 8 }}>{combineErr}</p>}"));
});

test("7 — a paid Edit that fails gives the shot back, and the change as it was typed", () => {
  // SEEN: Edit (of your own shot) and Edit / Retry (of a combined one) clear the shot and the box the
  // moment they are sent, and no failure path put either back. An uploaded shot is not in the reuse strip,
  // so it had to be uploaded again. A failed frame edit also left frame-edit mode ON, so the next real
  // Combine was labelled "your own shot" and given the wrong Edit path.
  const edit = cut("const applyFrameEdit = () => {", "const doFrameUpload = (");
  assert.ok(edit.includes("prevShotRef.current = { url: combineUrl, edit: combineEdit, scene: combineScene };"));
  assert.ok(edit.indexOf("prevShotRef.current = ") < edit.indexOf("setCombineUrl(null);"), "kept before it is cleared");
  const combine = cut("const doCombine = (over?: { variant?: number; scene?: string }) => {", "const applyCombineEdit = () => {");
  assert.ok(combine.includes("prevShotRef.current = combineUrl ? { url: combineUrl, edit: combineEdit, scene: combineScene } : null;"));
  assert.ok(combine.indexOf("prevShotRef.current = ") < combine.indexOf("setCombineUrl(null);"));
  assert.ok(combine.includes("frameEditModeRef.current = false;"), "a re-compose is never a frame edit");

  // the way back: the shot, the typed change, and the look it had (an Edit stacks its change onto the
  // look before it is sent — put back without that, the same change would be stacked twice)
  const back = cut("const restoreShot = () => {", "const reusedFrameRef = ");
  assert.ok(back.includes("frameEditModeRef.current = false;"));
  assert.ok(back.includes("setCombineUrl(prev.url); setCombineEdit(prev.edit); setCombineScene(prev.scene);"));
  assert.ok(back.includes("if (!prev || !combining) return;"), "only while that wait is still the one on screen");
  // every way an Edit can fail takes it: refused by the action · the job failed · it finished with no frame
  assert.equal(count(ui, "restoreShot();"), 3);
  assert.ok(ui.includes("if (data.error) { setCombining(false); setCombineErr(data.error); restoreShot(); return; }"));
  const answer = cut("const r = statusFetcher.data?.combineResult;", "}, [statusFetcher.data, combining, combineJobId]);");
  assert.equal(count(answer, "restoreShot();"), 2);
  assert.ok(answer.indexOf("if (r.failed) {") < answer.indexOf("restoreShot();"));
  // …and a shot that lands is not followed by the one it replaced
  assert.ok(answer.includes("prevShotRef.current = null;"));
  // (the stage shows a frame before it shows the wait — so a restored shot is simply there again)
  assert.ok(count(ui, "{combineUrl ? (\n                    <div className=\"ws-combine-frame\">") >= 1);
});

test("8 — an account without the Ad Maker is told so when it picks the Ad Maker", () => {
  // SEEN: for an account without `autopost` the "Ad Maker" tab landed back on Creator in silence. The one
  // explanation — the upsell — is shown when socialLockOpen is true, and the only line that touched it set
  // it FALSE.
  assert.ok(!ui.includes("setSocialLockOpen(false); } }, [socialUnlocked, mode]);"));
  const gate = cut("const lockGateRanRef = useRef(false);", "}, [socialUnlocked, mode]);");
  assert.ok(gate.includes("if (socialUnlocked || mode === \"casual\") return;"));
  assert.ok(gate.includes("if (pickedAdMaker && !creatorLink) setSocialLockOpen(true);"));
  assert.ok(!gate.includes("setSocialLockOpen(false)"), "the gate only ever opens it; “Not now” closes it");
  assert.ok(ui.includes("{socialLockOpen && !socialUnlocked && ("));

  // WHEN. A browser that never picked a mode merely STARTS in "marketing" — it has asked for nothing, and
  // every new account is such a browser. So it opens when the Ad Maker was PICKED: the shell stores the
  // pick before the Studio's gate runs…
  const shell = read("app", "routes", "web.tsx");
  assert.ok(shell.includes("useState<ShellMode>(savedMode || \"marketing\")"), "the default the gate must not mistake for a pick");
  assert.ok(shell.includes("const chooseMode = (m: ShellMode) => { setMode(m); writeModeCookie(m); try { localStorage.setItem(\"emMode\", m); } catch { /* ignore */ } };"));
  assert.ok(shell.includes("document.cookie = `emMode=${m}; Path=/;"));
  assert.ok(shell.includes("to=\"/web/studio\" onClick={() => chooseMode(\"marketing\")}>{t(\"Ad Maker\")}</Link>"));
  // …and the gate reads it BEFORE it sends them back to Creator (which stores "casual" as the pick)
  assert.ok(gate.includes("pickedAdMaker = /(?:^|;\\s*)emMode=marketing(?:;|$)/.test(document.cookie) || localStorage.getItem(\"emMode\") === \"marketing\";"));
  assert.ok(gate.indexOf("pickedAdMaker = ") < gate.indexOf("setMode(\"casual\");"));
  const picked = (cookie: string) => /(?:^|;\s*)emMode=marketing(?:;|$)/.test(cookie);
  assert.equal(picked("emMode=marketing"), true);
  assert.equal(picked("uiLang=es; emMode=marketing; other=1"), true);
  assert.equal(picked("emMode=casual"), false);
  assert.equal(picked(""), false, "never picked: nothing to be told");
  assert.equal(picked("oldemMode=marketing"), false);
  // …and never over a link that ARRIVED asking for one of Creator's own flows
  assert.ok(gate.includes("const creatorLink = arriving && doParam !== \"presenter\" && (initTab === \"video\" || initTab === \"image\" || initTab === \"music\" || initTab === \"faceless\");"));
  const opens = (o: { picked: boolean; arriving: boolean; doParam: string | null; initTab: string | undefined }) => {
    const creatorLink = o.arriving && o.doParam !== "presenter" && (o.initTab === "video" || o.initTab === "image" || o.initTab === "music" || o.initTab === "faceless");
    return o.picked && !creatorLink;
  };
  assert.equal(opens({ picked: true, arriving: true, doParam: null, initTab: undefined }), true, "the Ad Maker tab, from another page");
  assert.equal(opens({ picked: true, arriving: false, doParam: "edit", initTab: "image" }), true, "the Ad Maker tab, tapped while on a Creator link");
  assert.equal(opens({ picked: false, arriving: true, doParam: null, initTab: undefined }), false, "a first visit");
  assert.equal(opens({ picked: true, arriving: true, doParam: "edit", initTab: "image" }), false, "“Edit” from the Archive");
  assert.equal(opens({ picked: true, arriving: true, doParam: null, initTab: "import" }), true, "Import your store is the Ad Maker's");
  assert.equal(opens({ picked: true, arriving: true, doParam: "presenter", initTab: "image" }), true, "…and so is an ad with a presenter");

  // WHAT IT SAYS: the tab they tapped is called "Ad Maker" — it said "Social Marketing"
  assert.ok(!ui.includes("Social Marketing is a Starter feature") && !ui.includes("switch into Social Marketing mode"));
  assert.ok(ui.includes("{t(\"{name} is a {tier} feature\", { name: t(\"Ad Maker\"), tier: \"Starter\" })}"));
  assert.ok(ui.includes("{t(\"Upgrade to Starter ($19/mo) to open the Ad Maker — product ads, spokesperson videos & auto-posting. Everything you already make comes along.\")}"));
});

test("9 — the Stage's wait has an end, and it does not end by asking for a second paid piece", () => {
  // SEEN: the poll's cap counted from a clock started INSIDE the effect, and the effect depends on the
  // revalidator — a new object whenever the revalidation state changes. Every 5-second poll re-ran the
  // effect and reset the clock: 3 / 6 minutes could never pass, and a piece that never landed left
  // "Making your …" spinning for good.
  const watch = cut("const capMs = (makingNounRef.current === \"video\") ? 6 * 60_000 : 3 * 60_000;", "}, [making, stageRev]);");
  assert.ok(!ui.includes("const started = Date.now();"));
  assert.ok(watch.includes("if (Date.now() - watchStartedRef.current > capMs) {"));
  assert.ok(watch.includes("if (stageRev.state === \"idle\") stageRev.revalidate();"), "…which is what makes the effect re-run");
  // the clock starts where `making` begins — both places, and there are only two
  assert.equal(count(ui, "setMaking(true)"), 2);
  assert.ok(ui.includes("watchStartedRef.current = Date.now();\n      setMaking(true);"), "queued from this page");
  assert.ok(ui.includes("watchStartedRef.current = Date.now();\n    setMaking(true);"), "picked back up after the page was rebuilt");
  assert.equal(count(ui, "watchStartedRef.current = "), 2);
  // what a clock restarted every 5 s does, and what one that is not does
  const reaches = (restartEveryPoll: boolean) => {
    let started = 0;
    for (let now = 5_000; now <= 10 * 60_000; now += 5_000) {
      if (now - started > 3 * 60_000) return true;
      if (restartEveryPoll) started = now;
    }
    return false;
  };
  assert.equal(reaches(true), false);
  assert.equal(reaches(false), true);

  // WHAT IT SAYS. It said "your gallery" (the tab is "Archive") and "or try again" — which, for a piece
  // that is only waiting its turn behind someone else's video, means paying for a second one.
  assert.ok(!ui.includes("It may still land in your gallery shortly — or try again."));
  assert.ok(watch.includes("t(\"This is taking longer than usual. It will show up in your Archive when it's ready — no need to make it again.\")"));
});

test("10 — the words written for a video are kept: leaving the hub, or tapping the other style, erases nothing", () => {
  // SEEN: a tap on the Image or "Import your store" tab and back erased the chosen style and a script or
  // lyrics edited by hand; so did a tap on the other style card. No warning, no way back.
  assert.ok(ui.includes("if (!avatarVideoHub) { setHubPick(null); setNoProduct(false); }"));
  assert.ok(!ui.includes("setNoProduct(false); setVideoStyle(null);"));
  assert.ok(!ui.includes("setWordsDraft(\"\"); setPlanDraft(null); setWordsReady(false)"), "…in either place");
  // WHY NOTHING NEEDED IT: every field that submits them is mounted only inside the hub
  for (const field of ["name=\"videoStyle\"", "name=\"approvedLyrics\"", "name=\"approvedScript\"", "name=\"approvedPlan\"", "name=\"jingleStyle\""]) {
    const at = ui.indexOf(`<input type="hidden" ${field}`);
    assert.ok(at > 0, field);
    assert.ok(ui.slice(ui.lastIndexOf("\n", at), at).trim().startsWith("{avatarVideoHub && "), `${field} is sent only from the hub`);
    assert.equal(count(ui, `<input type="hidden" ${field}`), 1, field);
  }

  // each style keeps its OWN words (lyrics are not a script): the ones being left are put aside, and the
  // style being picked gets back whatever it had
  const pick = cut("const pickVideoStyle = (", "const writeWords = () => {");
  assert.ok(pick.includes("if (videoStyle) wordsByStyleRef.current[videoStyle] = { words: wordsDraft, plan: planDraft, ready: wordsReady };"));
  assert.ok(pick.includes("const kept = wordsByStyleRef.current[s];"));
  assert.ok(pick.includes("setWordsDraft(kept?.words ?? \"\"); setPlanDraft(kept?.plan ?? null); setWordsReady(kept?.ready ?? false);"));
  type Draft = { words: string; ready: boolean };
  const drafts: Record<string, Draft> = {};
  let style: string | null = null;
  let now: Draft = { words: "", ready: false };
  const pickStyle = (s: string) => { if (s === style) return; if (style) drafts[style] = now; const kept = drafts[s]; style = s; now = { words: kept?.words ?? "", ready: kept?.ready ?? false }; };
  pickStyle("talking"); now = { words: "My script, edited by hand.", ready: true };
  pickStyle("anthem");
  assert.deepEqual(now, { words: "", ready: false }, "a script is never offered as lyrics");
  now = { words: "La la la", ready: true };
  pickStyle("talking");
  assert.deepEqual(now, { words: "My script, edited by hand.", ready: true }, "…and it is still there");
  pickStyle("anthem");
  assert.deepEqual(now, { words: "La la la", ready: true });
});

test("11 — “Write the script — free” says what went wrong beside the button", () => {
  // SEEN: every failure of the free "write the words" step went to combineErr, which is drawn only inside
  // the Combine panel — a screen or more above on a phone. The tap looked like it did nothing.
  assert.ok(ui.includes("const [wordsErr, setWordsErr] = useState<string | null>(null);"));
  const write = cut("const writeWords = () => {", "previewFetcher.submit(fd, { method: \"post\" });");
  assert.ok(write.includes("if (!titleForPreview) { setWordsErr(noProduct ? t(\"Tell me what they talk about first.\") : t(\"Add the product name first.\")); return; }"), "the same two lines, in the new place");
  assert.ok(write.includes("setWordsErr(null);") && !write.includes("setCombineErr("));
  assert.ok(ui.includes("if (r.error) { setWordsErr(r.error); return; }"));
  assert.ok(!ui.includes("if (r.error) { setCombineErr(r.error); return; }"));
  // drawn in the row the button is in — both rows: Write, and Rewrite
  const rows = ui.split("<div className=\"ws-vsetup-row\">").slice(1).map((r) => r.slice(0, r.indexOf("</div>")));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.ok(row.includes("onClick={writeWords}"));
    assert.ok(row.includes("{wordsErr && <p className=\"ws-note ws-err\" role=\"alert\" style={{ flex: \"1 1 100%\", margin: 0 }}>{wordsErr}</p>}"));
  }
});

test("12 — Manage presenters can be tapped: every control has a 44px target on a phone", () => {
  // SEEN: Close is a 32px disc, Voice / trash / Delete about 30px tall and Keep about 27 — none of them
  // in the page's 44px block.
  assert.ok(ui.includes("<button type=\"button\" className=\"ws-forgem-x\" onClick={onClose} aria-label={t(\"Close\")}>"));
  assert.ok(ui.includes("<button type=\"button\" className=\"ws-mp-undo\" onClick={() => setArmed(null)}>{t(\"Keep\")}</button>"));
  const floor = cut("@media(max-width:620px){\n  .ws-addurl{min-height:44px;", "/* Cinematic Studio hero");
  assert.ok(floor.includes(".ws-mp-act,.ws-mp-undo{min-height:44px}"));
  assert.ok(floor.includes(".ws-forgem-x::after{content:\"\";position:absolute;inset:-6px}"));
  // the disc keeps its size; the hit area is 32 + 6 + 6, anchored to the button itself
  assert.ok(ui.includes(".ws-forgem-x{position:absolute;top:12px;inset-inline-end:12px;width:32px;height:32px;"));
  assert.equal(32 + 6 + 6, 44);
});

test("and one more — Make stays off while a piece of that kind is still cooking", () => {
  // SEEN while checking the others: the guard on Make / Pro / Ultra was `busy` alone — over the moment the
  // action answers. The buttons were live again while the piece was still cooking; a second tap was a
  // second charge, its result never showed on the Stage (which watches ONE piece), and it reset the watch
  // on the first.
  assert.ok(ui.includes("const cookingSame = casual && making && makingNounRef.current === noun;"));
  assert.ok(ui.includes("if (!f || busy || cookingSame) return;"), "Pro / Ultra");
  assert.ok(!ui.includes("if (!f || busy) return;"));
  assert.ok(ui.includes("const ctaDisabled = busy || cookingSame || !d.hasPlan || combining || "), "the one button");
  assert.ok(ui.includes("const base = busy || cookingSame || !d.hasPlan || combining || !direction.trim();"), "the two buttons");
  // it ends when the piece lands, fails, or the wait's cap is reached (test 9: the cap is real now)
  assert.equal(count(ui, "setMaking(false)"), 4, "blocked before it was queued · the cap · it landed · it failed");
});
