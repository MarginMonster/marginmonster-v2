/* CHANGE A QUEUED POST BEFORE IT GOES — added 2026-11-23.
 *
 * A waiting row on the Auto-post page ("Coming up") opens in place: the words that will go out, in a box,
 * and the linked networks that can take the piece, each a tick box. One Save for both.
 *
 *   1. THE RULES (the pure part of app/lib/post-queue.server.ts, lifted out and RUN here): the member's
 *      words are trimmed and at most 860 characters; empty = the automatic caption (null); every network
 *      ticked = [] (so an account linked later is included); none ticked is refused; only networks that
 *      take the piece are offered.
 *   2. THE SAFETY (pinned by reading the source — there is no local database): every write is scoped by
 *      shopId and pinned to PENDING, nothing here can post, the draft is loaded only when a row is opened
 *      (never by the loader), and the worker still hands the row's caption and networks to the post.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { POSTABLE_PLATFORMS, takes } from "../app/lib/social-networks.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const q = read("app", "lib", "post-queue.server.ts");
const pa = read("app", "lib", "post-asset.server.ts");
const route = read("app", "routes", "web.autopost.tsx");
const archive = read("app", "routes", "web.archive.tsx");

/** The body of `name` (from its declaration to the next top-level closing brace). */
const fnBody = (hay: string, decl: string) => {
  const at = hay.indexOf(decl);
  assert.ok(at >= 0, `${decl} is there`);
  return hay.slice(at, hay.indexOf("\n}\n", at) + 2);
};

// ── 1. the rules, run ────────────────────────────────────────────────────────────────────────────────
type Pure = {
  QUEUE_CAPTION_MAX: number;
  cleanQueueCaption: (v: unknown) => { caption: string | null } | { error: "too-long" };
  pickQueuePlatforms: (raw: unknown, offered: readonly string[]) => { platforms: string[] } | { error: "none-picked" };
  queueNetworkBoxes: (
    linked: readonly string[], isVideo: boolean, want: readonly string[], postable: readonly string[],
    canTake: (k: string, v: boolean) => boolean,
  ) => Array<{ key: string; on: boolean }>;
};
const START = "/* ── QUEUE EDIT · THE PURE PART";
const END = "/* ── end of the pure part";
const block = q.slice(q.indexOf(START), q.indexOf(END));
const pure = (() => {
  assert.equal(count(q, START), 1);
  assert.ok(block.length > 0);
  const js = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return new Function(`${js}\nreturn { QUEUE_CAPTION_MAX, cleanQueueCaption, pickQueuePlatforms, queueNetworkBoxes };`)() as Pure;
})();

test("the pure part really is pure", () => {
  for (const banned of ["import ", "export ", "db.", "await ", "fetch(", "Date.now("]) assert.ok(!block.includes(banned), banned);
});

test("the words: trimmed, at most 860 characters, empty = the automatic caption", () => {
  assert.equal(pure.QUEUE_CAPTION_MAX, 860);
  assert.deepEqual(pure.cleanQueueCaption("  Fresh drop today  "), { caption: "Fresh drop today" });
  for (const v of ["", "   \n ", null, undefined, 42]) assert.deepEqual(pure.cleanQueueCaption(v), { caption: null });
  assert.deepEqual(pure.cleanQueueCaption("a".repeat(860)), { caption: "a".repeat(860) });
  assert.deepEqual(pure.cleanQueueCaption(` ${"a".repeat(860)} `), { caption: "a".repeat(860) }, "the limit counts the trimmed words");
  assert.deepEqual(pure.cleanQueueCaption("a".repeat(861)), { error: "too-long" }, "refused, never cut silently");
  // the same 860 everywhere: the page's counter and box, and the post itself
  assert.ok(route.includes("const CAPTION_MAX = 860;"));
  assert.ok(route.includes("maxLength={CAPTION_MAX}"));
  assert.ok(route.includes('t("{n} of {max} characters", { n: text.length, max: CAPTION_MAX })'));
  assert.ok(pa.includes("const capBase = custom.slice(0, 860);"));
});

test("where it goes: every box ticked stores [], a few store those, none is refused", () => {
  const offered = ["instagram", "tiktok", "facebook"];
  assert.deepEqual(pure.pickQueuePlatforms("instagram,tiktok,facebook", offered), { platforms: [] });
  assert.deepEqual(pure.pickQueuePlatforms("facebook, tiktok", offered), { platforms: ["tiktok", "facebook"] }, "kept in the offered order");
  assert.deepEqual(pure.pickQueuePlatforms("", offered), { error: "none-picked" });
  assert.deepEqual(pure.pickQueuePlatforms(null, offered), { error: "none-picked" });
  assert.deepEqual(pure.pickQueuePlatforms("youtube,myspace", offered), { error: "none-picked" }, "keys not offered are ignored");
  assert.deepEqual(pure.pickQueuePlatforms("instagram,youtube", offered), { platforms: ["instagram"] });
  assert.deepEqual(pure.pickQueuePlatforms("", []), { platforms: [] }, "nothing linked: nothing to choose");
});

test("only the linked networks that take the piece are offered — a photo is never offered to YouTube", () => {
  const linked = ["instagram", "youtube", "tiktok", "myspace", "instagram"];
  const photo = pure.queueNetworkBoxes(linked, false, [], POSTABLE_PLATFORMS, takes);
  assert.deepEqual(photo, [{ key: "instagram", on: true }, { key: "tiktok", on: true }]);
  const video = pure.queueNetworkBoxes(linked, true, [], POSTABLE_PLATFORMS, takes);
  assert.deepEqual(video.map((b) => b.key), ["instagram", "youtube", "tiktok"]);
  assert.ok(video.every((b) => b.on), "[] = every box ticked");
  const some = pure.queueNetworkBoxes(linked, true, ["youtube"], POSTABLE_PLATFORMS, takes);
  assert.deepEqual(some, [{ key: "instagram", on: false }, { key: "youtube", on: true }, { key: "tiktok", on: false }]);
  assert.deepEqual(pure.queueNetworkBoxes([], true, [], POSTABLE_PLATFORMS, takes), []);
});

// ── 2. the safety, pinned ────────────────────────────────────────────────────────────────────────────

test("the one write is scoped by shopId, pinned to PENDING, and changes only the words and the networks", () => {
  const edit = fnBody(q, "export async function queueEdit(");
  assert.equal(count(edit, "db.scheduledPost.updateMany("), 1);
  assert.ok(edit.includes('where: { id, shopId, status: "PENDING" },\n    data: { caption: c.caption, platformsJson: JSON.stringify(picked.platforms) },'));
  assert.ok(!/status:\s*"(POSTING|POSTED|FAILED|CANCELLED)"\s*[,}]/.test(edit.replace('now?.status === "POSTING"', "")), "never moves the row's status");
  // the rules run BEFORE the write
  assert.ok(edit.indexOf("cleanQueueCaption(") < edit.indexOf("updateMany("));
  assert.ok(edit.indexOf("pickQueuePlatforms(") < edit.indexOf("updateMany("));
  // the read that decides is scoped too, and a row that has started posting says so
  const row = fnBody(q, "async function pendingRow(");
  assert.ok(row.includes("where: { id, shopId },"));
  assert.ok(row.includes('if (row.status === "POSTING") return { error: "posting" as const };'));
  assert.ok(row.includes('if (row.status !== "PENDING") return { error: "not-found" as const };'));
  // …in the sentence the page already uses for it
  assert.ok(route.includes('posting: tr(lang, "That piece is posting right now, so it can\'t be stopped."),'));
});

test("nothing here can post", () => {
  for (const fn of ["async function pendingRow(", "export async function queueDraft(", "export async function queueEdit("]) {
    const body = fnBody(q, fn);
    for (const banned of ["postAssetToSocials", "publishPost", "sendOne", "dueAt"]) assert.ok(!body.includes(banned), `${fn} must not touch ${banned}`);
  }
  const draft = fnBody(pa, "export async function draftCaptionFor(");
  for (const banned of ["publishPost", "ensureProfile", "spendTokens", ".update(", "updateMany"]) assert.ok(!draft.includes(banned), banned);
});

test("the draft is the Archive's own draft, written only when a row is opened", () => {
  const draft = fnBody(pa, "export async function draftCaptionFor(");
  assert.ok(draft.includes('db.asset.findFirst({ where: { id: assetId, shopId, type: { in: ["VIDEO_AD", "IMAGE_AD"] } } })'), "scoped to the shop");
  assert.ok(draft.includes('const tune = platforms.includes("instagram") ? "instagram" : platforms[0];'));
  assert.ok(archive.includes('const tune = platforms.includes("instagram") ? "instagram" : platforms[0];'));
  assert.ok(draft.includes("const buyUrl = await productLinkFor(shopId, title);"));
  assert.ok(draft.includes("buildPostTitle(captions[tune], buyUrl, fbText, undefined, tune)"));
  assert.ok(archive.includes("buildPostTitle(captions[tune], buyUrl, fbText, undefined, tune)"), "the same words the Archive's viewer shows");
  // the member's own words are shown as they are — no caption is written for them
  const qd = fnBody(q, "export async function queueDraft(");
  assert.ok(qd.includes("if (!ownWords) {\n    const d = await draftCaptionFor(shopId, p.row.assetId);"));
  // never on page load: not in the loader, only through the action — and opening a row does not reload the page
  const loader = route.slice(route.indexOf("export const loader"), route.indexOf("/* The queue's endpoint."));
  assert.ok(loader.includes("const queue = await loadComingUp(shop.id, linked);"));
  for (const banned of ["queueDraft", "draftCaptionFor", "getOrMakeCaptions"]) assert.ok(!loader.includes(banned), banned);
  assert.ok(!fnBody(q, "export async function loadComingUp(").includes("draftCaptionFor"));
  assert.ok(route.includes('dr.submit({ intent: "queueDraft", id: r.id }, { method: "post" });'));
  assert.equal(count(route, 'intent: "queueDraft"'), 1, "submitted from one place: the Edit tap");
  assert.ok(route.includes('formData?.get("intent") === "queueDraft" ? false : defaultShouldRevalidate;'));
});

test("the endpoint: queueDraft and queueEdit beside the intents that were already there", () => {
  const action = route.slice(route.indexOf("export const action"));
  assert.ok(action.includes("const { shop } = await requireWebIdentity(request);"));
  assert.ok(action.includes('const r = await queueDraft(shop.id, field("id"));'));
  assert.ok(action.includes("return json({ ok: true as const, caption: r.caption, own: r.own, networks: r.networks });"));
  assert.ok(action.includes('if (intent === "queueEdit") r = await queueEdit(shop.id, field("id"), String(form.get("caption") ?? ""), field("platforms"));'));
  for (const intent of ["queueAdd", "queueRemove", "queuePostNow", "queueRetry", "queuePerDay", "skipDrop"]) assert.ok(action.includes(`intent === "${intent}"`), intent);
});

test("the worker still sends the row's own words and networks — and the #EasyModeAi tag is added at post time", () => {
  assert.ok(q.includes("select: { id: true, shopId: true, assetId: true, platformsJson: true, caption: true },"));
  assert.ok(q.includes("postAssetToSocials({ shopId: row.shopId, assetId: row.assetId, caption: row.caption, platforms: parseList(row.platformsJson) })"));
  assert.ok(pa.includes("if (opts.platforms && opts.platforms.length) platforms = platforms.filter((p) => opts.platforms!.includes(p));"), "[] = every linked network");
  assert.ok(pa.includes("? capBase : `${capBase}\\n\\n#${AI_DISCLOSURE_TAG}`"));
  assert.ok(route.includes('t("The #EasyModeAi tag is always added.")'));
});

test("the page: Edit only on a waiting row, opened in place, one Save that says why it can't", () => {
  assert.ok(route.includes('const canEdit = r.kind === "piece" && r.status === "PENDING";'));
  assert.ok(route.includes("const open = canEdit && !!editing && !saved;"));
  // Post now and Remove are where they were, Edit between them
  const acts = route.slice(route.indexOf('<span className="ap-q-acts">'));
  const postNow = acts.indexOf('button("queuePostNow"');
  const edit = acts.indexOf("onClick={toggleEdit}");
  const remove = acts.indexOf('button("queueRemove"');
  assert.ok(postNow > 0 && edit > postNow && remove > edit);
  // untouched automatic words stay automatic; the reset is in the box, the Save is one
  assert.ok(route.includes('p.onSave(isAuto ? "" : text.trim(), on.join(","));'));
  assert.ok(route.includes("const autoText = draft.own ? \"\" : draft.caption;"));
  assert.ok(route.includes('const none = draft.networks.length > 0 && on.length === 0;'));
  assert.ok(route.includes('{none ? t("Tick at least one network") : p.saving ? t("Saving…") : t("Save")}'));
  assert.equal(count(route, 'intent: "queueEdit"'), 1);
  // closed, the row says what was changed
  assert.ok(route.includes('{r.ownCaption && <span className="ap-q-mark"><Ico n="pencil" size={11} /> {t("Your caption")}</span>}'));
  assert.ok(route.includes('{r.fewerNetworks && <span className="ap-q-mark">{t("Only some networks")}</span>}'));
  assert.ok(q.includes("ownCaption: !!(r.caption || \"\").trim(),"));
  assert.ok(q.includes("fewerNetworks: goes.length < boxes.length,"));
});

test("answers are read only once the fetchers are idle — derived, with no effect at all", () => {
  assert.ok(!route.includes("useEffect"), "nothing on this page waits on fetcher.data in an effect");
  assert.ok(route.includes('const saved = !!editing && ed.state === "idle" && !!ed.data && "ok" in ed.data && ed.data !== editing.saveBase;'));
  assert.ok(route.includes('const fresh = !!editing && dr.state === "idle" && dr.data !== editing.draftBase;'));
});

test("phone-first: the box never zooms iOS, every tap target is 44 px", () => {
  const css = route.slice(route.indexOf("const AP_CSS"));
  const box = css.slice(css.indexOf(".ap-q-text{"), css.indexOf("}", css.indexOf(".ap-q-text{")));
  assert.ok(/font-size:16px/.test(box), "16 px or iOS zooms the page on focus");
  for (const sel of [".ap-q-net{", ".ap-q-link{", ".ap-q-btn{"]) {
    const rule = css.slice(css.indexOf(sel), css.indexOf("}", css.indexOf(sel)));
    assert.ok(rule.includes("min-height:44px"), sel);
  }
});
