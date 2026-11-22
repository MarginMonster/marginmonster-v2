/* Five things the Archive got wrong, each found by using it (2026-11-22) and pinned here.
 *
 *   1. A second "Post to socials" on the same piece sat on "Writing a caption for you…" for good, with
 *      Post now dead: the caption is cached per piece, so the second answer was the same string, and the
 *      effect that puts it in the box was keyed on the string.
 *   2. The gold "Remix · N tokens" showed on every video and image — and on a Creator image, a photo
 *      edit, a film, a faceless video or a scene still it could only ever answer "made before we started
 *      saving its product photo… Remake it from the Studio".
 *   3. After "Post now" the open piece still had a live heart; one tap turned a PUBLISHED piece back
 *      into APPROVED — "Kept" instead of "Posted", and no longer safe from a bulk delete.
 *   4. On a phone the search chip's ✕ was 20px, the Keep heart 38px and flush against the close button,
 *      the ad pack's Copy 32px, and five text buttons 36px — all under the 44px floor the page has.
 *   5. Two notes said to "hit Keep" (the opened piece has no button that reads Keep — it is the heart),
 *      and four delete tooltips said "can't be undone" above a five-second Undo. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const src = read("app", "routes", "web.archive.tsx");

test("a second \"Post to socials\" on the same piece gets its caption — and a failed draft does not hang the box", () => {
  // SEEN: Post to socials → Cancel → Post to socials again, same piece: the box stayed disabled on
  // "Writing a caption for you…". The effect that applies a draft ran only when the draft's TEXT changed.
  assert.ok(!src.includes("}, [draftText]);"), "nothing is keyed on the caption's text any more");
  // it runs for every ANSWER the action gives, and an answer that is an error ends the wait too
  assert.ok(src.includes([
    "  useEffect(() => {",
    "    if (draftText != null) { setCaption(draftText); setDraftPending(false); }",
    "    else if (err != null) setDraftPending(false);",
    "  }, [actionData]); // eslint-disable-line react-hooks/exhaustive-deps",
  ].join("\n")));
  // both things it reads come off that one answer…
  assert.ok(src.includes('const draftText = actionData && "draft" in actionData ? (actionData as { draft: string }).draft : null;'));
  assert.ok(src.includes('const err = actionData && "error" in actionData ? (actionData as { error: string }).error : null;'));
  // …which is where a draft's answer arrives: it is asked for with submit(), not a fetcher
  assert.ok(src.includes('const startPost = (assetId: string) => { setActedId(assetId); setCaption(""); setCapOpen(true); setDraftPending(true); submit({ intent: "draft", assetId }, { method: "post" }); };'));
  // the flag that was never cleared is what the box and the button hang on
  assert.ok(src.includes("disabled={draftPending}"));
  assert.ok(src.includes("disabled={busy || draftPending || !caption.trim()}"));

  // what the key decides: an effect runs again only when a dependency is not the value it saw last
  const first = { draft: "Fresh drop ✨ #EasyModeAi" };
  const second = JSON.parse(JSON.stringify(first)) as typeof first; // the same piece asked again — the kept caption
  assert.equal(Object.is(first.draft, second.draft), true, "by its text, the second answer is no change at all");
  assert.equal(Object.is(first, second), false, "by the answer itself it is one — so the same words land again");

  // why the two answers are identical (and rightly so — one caption per piece, written once)…
  const draft = src.slice(src.indexOf('if (intent === "draft") {'), src.indexOf('if (intent === "post") {'));
  assert.ok(draft.includes("const captions = await getOrMakeCaptions(id, shop.id, { productTitle: title, isVideo, platforms });"));
  // …and the answer a draft gives when it fails: an error, with no draft in it
  assert.ok(draft.includes('if (!asset) return json({ error: tr(lang, "That piece is gone — refresh and try again.") });'));
});

test("Remix is offered only on a piece the remix action will take", () => {
  const loader = src.slice(src.indexOf("export const loader"), src.indexOf("export const action"));
  const action = src.slice(src.indexOf('if (intent === "remix") {'), src.indexOf('if (intent === "draft") {'));
  // THE ACTION'S TEST — not touched: videos, images and articles; a product title; and for a video or an
  // image, service mode, the photo kept on the piece, or the catalogue's photo under the same title
  assert.ok(action.includes('type: { in: ["VIDEO_AD", "IMAGE_AD", "BLOG_POST"] }'));
  assert.ok(action.includes('const productTitle = (meta.productTitle || asset.title || "").trim();'));
  assert.ok(action.includes("? meta.productImageUrl || (await catalogImageFor(shop.id, productTitle)) || undefined"));
  assert.ok(action.includes('if (asset.type !== "BLOG_POST" && !meta.serviceMode && !productImageUrl) {'));
  // …and what it does once it runs is as it was
  assert.ok(action.includes('await enqueueJob(shop.id, "GENERATE_VIDEO_AD", { section: assetSection, productTitle, style, contentType,'));
  assert.ok(action.includes("return json({ remixed: type, free });"));

  // THE LOADER RUNS THE SAME TEST, and sends the answer with every piece
  assert.ok(loader.includes('const title = ((typeof m.productTitle === "string" && m.productTitle) || a.title || "").trim();'));
  assert.ok(loader.includes('return { title, settled: a.type === "BLOG_POST" || !!m.serviceMode || !!m.productImageUrl };'));
  assert.ok(loader.includes('if (a.type === "AUDIO") return false;'));
  assert.ok(loader.includes("return !!b.title && (b.settled || catalogueHas.has(b.title));"));
  assert.ok(loader.includes("canRemix: remixable(a),"));
  // the catalogue is asked ONCE for the page (up to 780 pieces), the way the action asks it for one title
  assert.ok(loader.includes("const rows = await db.catalogProduct.findMany({ where: { shopId: shop.id, title: { in: askCatalogue }, imageUrl: { not: null } }, select: { title: true, imageUrl: true } });"));
  assert.ok(loader.includes("catalogueHas = new Set(rows.filter((r) => r.imageUrl).map((r) => r.title));"));
  assert.equal(count(loader, "db.catalogProduct."), 1, "one catalogue query, never one per piece");
  const lookup = read("app", "lib", "catalog-import.server.ts");
  const one = lookup.slice(lookup.indexOf("export async function catalogImageFor"));
  assert.ok(one.includes("where: { shopId, title: t, imageUrl: { not: null } },"), "the action's lookup: this shop, this title, a photo");
  assert.ok(one.includes("return hit?.imageUrl || null;"));

  // what those lines decide, on the meta each kind of piece really carries
  const inCatalogue = new Set(["Blue Mug"]);
  const can = (a: { type: string; title: string | null; meta: unknown }) => {
    if (a.type === "AUDIO") return false;
    let m: { productTitle?: unknown; productImageUrl?: unknown; serviceMode?: unknown } = {};
    try { m = JSON.parse(typeof a.meta === "string" ? a.meta : JSON.stringify(a.meta)) || {}; } catch { /* no meta */ }
    const title = ((typeof m.productTitle === "string" && m.productTitle) || a.title || "").trim();
    const settled = a.type === "BLOG_POST" || !!m.serviceMode || !!m.productImageUrl;
    return !!title && (settled || inCatalogue.has(title));
  };
  // a Studio ad keeps its product photo
  assert.equal(can({ type: "VIDEO_AD", title: "Red Kettle", meta: { style: "AI_AVATAR", productTitle: "Red Kettle", productImageUrl: "https://cdn.example/kettle.jpg", serviceMode: false } }), true);
  assert.equal(can({ type: "IMAGE_AD", title: "Red Kettle", meta: { productTitle: "Red Kettle", productImageUrl: "https://cdn.example/kettle.jpg", formatKey: "callout" } }), true);
  // a service has no photo to need
  assert.equal(can({ type: "VIDEO_AD", title: "Dog walking", meta: { productTitle: "Dog walking", productImageUrl: null, serviceMode: true } }), true);
  // an ad from before the photo was kept: the catalogue still has the product → yes; it has since gone → no
  assert.equal(can({ type: "IMAGE_AD", title: "Blue Mug", meta: { productTitle: "Blue Mug" } }), true);
  assert.equal(can({ type: "IMAGE_AD", title: "Retired Mug", meta: { productTitle: "Retired Mug" } }), false);
  // an article needs only its product's name
  assert.equal(can({ type: "BLOG_POST", title: "Five ways to use a kettle", meta: { planType: "GROWTH", productTitle: "Red Kettle" } }), true);
  assert.equal(can({ type: "BLOG_POST", title: null, meta: {} }), false);
  // THE ONES THAT COULD ONLY REFUSE: no product photo was ever part of them
  for (const [what, a] of [
    ["a Creator image", { type: "IMAGE_AD", title: "a fox in the snow", meta: { kind: "create", section: "creator", style: null, model: "flux", engine: "flux", aspect: "1:1" } }],
    ["a photo edit", { type: "IMAGE_AD", title: "Edit — make it sunset", meta: { kind: "edit", section: "creator", editOp: "restyle", sourceImageUrl: "/renders/up-1.jpg" } }],
    ["a Movie Maker film", { type: "VIDEO_AD", title: "Short Film — The Last Slice", meta: { kind: "film", template: "moral", section: "creator", scenes: 6, aspect: "vertical" } }],
    ["a music video", { type: "VIDEO_AD", title: "Neon Summer", meta: { kind: "musicvideo", section: "creator", aspect: "9:16" } }],
    ["a faceless video (its `product` is not a product photo)", { type: "VIDEO_AD", title: "5 facts about tea", meta: { kind: "faceless", section: "creator", format: "facts", topic: "tea", aspect: "vertical", product: "Blue Mug" } }],
    ["a scene still", { type: "IMAGE_AD", title: "Scene 2", meta: { kind: "musicvideo-scene", section: "creator", genre: "pop", scene: 2 } }],
  ] as const) assert.equal(can(a), false, what);
  // a song is not remixed here at all, whatever it is called
  assert.equal(can({ type: "AUDIO", title: "Blue Mug", meta: { kind: "song", section: "creator", engine: "musicgen" } }), false);
  // meta that cannot be read: the action falls back to the title too
  assert.equal(can({ type: "IMAGE_AD", title: "Blue Mug", meta: "{not json" }), true);
  assert.equal(can({ type: "IMAGE_AD", title: "   ", meta: "{not json" }), false);

  // THE VIEWER: both Remix buttons wait on it (the paid Remix and the free "Make it again" are one button)
  assert.equal(count(src, "onClick={() => remix(viewer.id)}"), 2);
  assert.ok(src.includes("{!viewer.isAudio && viewer.canRemix && (\n                      <button type=\"button\" className=\"wa-vbtn gold\" disabled={busy} title={viewer.freeRemake ? "));
  assert.ok(src.includes("{viewer.canRemix && <button type=\"button\" className=\"wa-vbtn gold\" disabled={busy} title={t(\"Write a fresh article on the same product\")} onClick={() => remix(viewer.id)}>"));
  assert.ok(!src.includes("{!viewer.isAudio && (\n"), "\"everything but audio\" is gone");
  // …and the note that names the button names it only where the button is
  assert.ok(src.includes("{viewer.canRemix && <> <b>{t(\"Remix\")}</b> {t(\"re-rolls it.\")}</>}"));
});

test("a posted piece stays posted: Keep only flips an un-kept piece, and the open viewer knows it was posted", () => {
  // SEEN: Post now, then a tap on the heart of the same open piece → the piece read "Kept", not "Posted".
  const keep = src.slice(src.indexOf('if (intent === "keep") {'), src.indexOf('if (intent === "keepMany") {'));
  assert.ok(keep.includes('await db.asset.updateMany({ where: { id: (form.get("assetId") as string) || "", shopId: shop.id, status: "PENDING" }, data: { status: "APPROVED" } });'));
  assert.ok(!keep.includes('shopId: shop.id }, data: { status: "APPROVED" }'), "no Keep without a status in its where");
  // the guard the bulk Keep already had
  const keepMany = src.slice(src.indexOf('if (intent === "keepMany") {'), src.indexOf('if (intent === "deleteMany") {'));
  assert.ok(keepMany.includes('shopId: shop.id, status: "PENDING" }, data: { status: "APPROVED" }'));
  // what the where decides, status by status: only an un-kept piece changes
  const afterKeep = (status: string) => (status === "PENDING" ? "APPROVED" : status);
  assert.equal(afterKeep("PENDING"), "APPROVED");
  assert.equal(afterKeep("PUBLISHED"), "PUBLISHED", "it used to come back APPROVED");
  assert.equal(afterKeep("APPROVED"), "APPROVED");
  // what a posted piece had to lose: the bulk delete leaves PUBLISHED pieces alone, and only those
  assert.ok(src.includes('const r = await db.asset.deleteMany({ where: { id: { in: ids }, shopId: shop.id, status: { not: "PUBLISHED" } } });'));

  // THE OPEN VIEWER. A post marks the piece PUBLISHED and says which piece it was…
  const post = src.slice(src.indexOf('if (intent === "post") {'), src.indexOf("/** Countdown text, or the truth"));
  assert.ok(post.includes('data: { status: "PUBLISHED", metaJson: JSON.stringify(m) },'));
  assert.ok(post.includes("postedAssetId: id,"));
  // …the viewer is not closed by a post, so it takes that status in place — that piece, and no other
  assert.ok(src.includes('else if (postedAssetId) setViewer((v) => (v && v.id === postedAssetId ? { ...v, status: "PUBLISHED" } : v));'));
  const flip = (v: { id: string; status: string } | null, postedAssetId: string) => (v && v.id === postedAssetId ? { ...v, status: "PUBLISHED" } : v);
  assert.deepEqual(flip({ id: "a1", status: "PENDING" }, "a1"), { id: "a1", status: "PUBLISHED" });
  assert.deepEqual(flip({ id: "b2", status: "PENDING" }, "a1"), { id: "b2", status: "PENDING" }, "the merchant has moved on to another piece");
  assert.equal(flip(null, "a1"), null);
  // …which is what locks the heart: a published piece's heart is gold, disabled, and does nothing
  assert.ok(src.includes('const published = viewer.status === "PUBLISHED";'));
  assert.ok(src.includes("disabled={busy || published}"));
  assert.ok(src.includes('onClick={() => { if (published) return; if (viewer.status === "APPROVED") unkeepAsset(viewer.id); else keepAsset(viewer.id); }}>'));
});

test("on a phone, what the 44px floor missed is 44px to the thumb", () => {
  // (Measured in headless Chrome at 390 and 320 wide, on a test page built from this CSS: the heart 44×44,
  //  6px from the close button and level with it; the chip's ✕ 44×44 to the thumb; Copy 68×44; the text
  //  buttons 44 high. At 1100 wide nothing moved.)
  const cssAt = src.indexOf("const WA_CSS = `");
  const css = src.slice(cssAt, src.indexOf("`;", cssAt));
  const floorAt = css.indexOf("44px tap-target floor");
  assert.ok(floorAt > 0);
  const floor = css.slice(css.indexOf("@media(max-width:640px){", floorAt), css.indexOf("@media(max-width:620px){", floorAt));
  assert.ok(floor.startsWith("@media(max-width:640px){"), "the phone's rules, nobody else's");
  const num = (s: string, re: RegExp) => { const m = s.match(re); assert.ok(m, String(re)); return Number(m![1]); };

  // THE KEEP HEART. It was 38px, and began 52px in from the right — exactly where the phone's close
  // button (8px in, 44 wide) ends: two round buttons touching.
  const closeTop = num(css, /\.wa-vx\{top:(\d+)px;right:8px;width:32px;height:32px;font-size:14px;\}/);
  const closeRight = num(css, /\.wa-vx\{top:8px;right:(\d+)px;width:32px;height:32px;font-size:14px;\}/);
  const closeSize = num(floor, /\.wa-vx\{width:(\d+)px;height:44px;font-size:14px\}/);
  assert.equal(num(css, /\.wa-vheart\{position:absolute;top:10px;right:(\d+)px;z-index:6;width:38px;height:38px;/), closeRight + closeSize, "what it was: flush");
  const heart = floor.match(/\.wa-vheart\{width:(\d+)px;height:(\d+)px;right:(\d+)px;top:(\d+)px\}/);
  assert.ok(heart, "the heart has a phone rule");
  const [hw, hh, hr, ht] = heart!.slice(1).map(Number);
  assert.ok(hw >= 44 && hh >= 44, "full size");
  assert.ok(hr - (closeRight + closeSize) >= 6, "clear of the close button");
  assert.equal(ht, closeTop, "and level with it");

  // THE SEARCH CHIP'S ✕ keeps its 20px look; its hit box reaches 12px further each way
  const chip = num(css, /\.wa-qchip a\{display:inline-grid;place-items:center;width:(\d+)px;height:20px;/);
  assert.ok(floor.includes(".wa-qchip a{position:relative}"), "the hit box hangs on the link");
  const chipOut = num(floor, /\.wa-qchip a::before\{content:"";position:absolute;inset:-(\d+)px\}/);
  assert.ok(chip + 2 * chipOut >= 44);

  // THE AD PACK'S COPY keeps its 32px look. It is positioned already (so the hit box has something to hang
  // on), and inset is counted from INSIDE its 1px border: -6 measured 42px, -7 is 44
  const copy = css.match(/\.wa-copy-btn\{position:absolute;top:(\d+)px;right:(\d+)px;min-height:(\d+)px;padding:0 12px;border-radius:999px;border:(\d+)px solid /);
  assert.ok(copy, "the Copy button's own rule");
  const [cTop, cRight, cMin, cBorder] = copy!.slice(1).map(Number);
  const copyOut = num(floor, /\.wa-copy-row \.wa-copy-btn::before\{content:"";position:absolute;inset:-(\d+)px\}/);
  assert.ok(cMin - 2 * cBorder + 2 * copyOut >= 44);
  assert.ok(copyOut - cBorder <= Math.min(cTop, cRight), "and the hit box stays inside the row the button sits in");

  // THE TEXT BUTTONS: Write another / Share… / Open, the share Copy, Stop sharing, Read, Select all
  assert.ok(floor.includes(".wa-copy-again,.wa-share-acts .wa-share-btn,.wa-share-stop,.wa-read-btn,.wa-bulk-link{min-height:44px;box-sizing:border-box}"));
  // each is a real rule, written ABOVE the floor (between equals, the later rule wins)…
  for (const base of [
    ".wa-copy-again{align-self:flex-start;min-height:36px;",
    ".wa-share-acts .wa-share-btn{position:static;min-height:36px;}",
    ".wa-share-stop{min-height:36px;",
    ".wa-read-btn{align-self:center;",
    ".wa-bulk-link{border:0;",
    ".wa-vheart{position:absolute;",
    ".wa-qchip a{display:inline-grid;",
    ".wa-copy-btn{position:absolute;",
  ]) {
    const at = css.indexOf(base);
    assert.ok(at > 0 && at < floorAt, base);
  }
  // …and the share Copy is named WITH its parent: its 36px comes from a two-class rule, which a bare
  // ".wa-share-btn" in the floor would lose to
  assert.ok(count(floor, ".wa-share-btn") > 0);
  assert.equal(count(floor, ".wa-share-btn"), count(floor, ".wa-share-acts .wa-share-btn"));

  // every one of them is on the page
  for (const used of [
    "className={`wa-vheart${kept ? \" on\" : \"\"}`}",
    "<span className=\"wa-qchip\">",
    "<div key={r.k} className=\"wa-copy-row\">",
    "<button type=\"button\" className=\"wa-copy-btn\" onClick={() => copyText(r.k, r.v)}>",
    "<div className=\"wa-share-acts\">",
    "<button type=\"button\" className=\"wa-copy-btn wa-share-btn\" onClick={copy}>",
    "<button type=\"button\" className=\"wa-copy-again\" disabled={writing}",
    "<a className=\"wa-copy-again\" href={url}",
    "<button type=\"button\" className=\"wa-share-stop\"",
    "<button type=\"button\" className=\"wa-read-btn\"",
    "<button type=\"button\" className=\"wa-bulk-link\"",
  ]) assert.ok(src.includes(used), used);
});

test("the notes say what is on the screen: keeping is the heart, and a delete can be undone", () => {
  // KEEP. The shelf note and the countdown badge's tooltip said to open a piece and "hit Keep".
  assert.ok(src.includes('{t("Un-kept videos & photos clear after 30 days — open a piece and tap the heart to save it for good.")}'));
  assert.ok(src.includes('t("Auto-clears in {n} day — open it and tap the heart to keep it", { n: a.daysLeft })'));
  assert.ok(src.includes('t("Auto-clears in {n} days — open it and tap the heart to keep it", { n: a.daysLeft })'));
  for (const gone of ['open a piece and hit")', 'open it and hit Keep"', '<b>{t("Keep")}</b>', 't("to save it for good.")']) assert.ok(!src.includes(gone), gone);
  // …the words the opened piece has used all along
  assert.ok(src.includes('{t("tap the heart to save it for good.")}'));
  // in the opened piece Keep IS a heart, with no word on it (its name is there for a screen reader)
  const viewer = src.slice(src.indexOf("{viewer && mounted ? createPortal("), src.indexOf("{/* Delete / retry confirmation toast."));
  assert.ok(viewer.length > 2000);
  assert.ok(viewer.includes('aria-label={kept ? t("Kept") : t("Keep")}'));
  assert.ok(viewer.includes('<Ico n="heart" size={20} style={kept ? { fill: "currentColor" } : undefined} />'));
  assert.ok(!/>\s*\{t\("Keep"\)\}\s*</.test(viewer), "no button in the opened piece reads Keep");

  // DELETE. Four armed tooltips said "can't be undone".
  assert.ok(!src.includes("t(\"Tap again to delete — can't be undone\")"));
  const armed = src.split("\n").filter((l) => l.includes("title={armedDel === ") && l.includes('? t("Tap again to delete") : '));
  assert.equal(armed.length, 4, "the article row, the tile, and the Delete button of an opened article and of an opened piece");
  // every one of them goes through askDelete…
  for (const l of armed) assert.ok(/onClick=\{\(\) => askDelete\((?:a|viewer)\.id\)\}/.test(l), l.trim().slice(0, 80));
  // …which deletes nothing for five seconds, and offers Undo for as long
  const ask = src.slice(src.indexOf("const askDelete = (assetId: string) => {"), src.indexOf("// Retry a failed job and confirm it"));
  assert.ok(ask.includes("const pending = setTimeout(() => { setToast(null); deleteAsset(assetId); }, 5000);"));
  assert.ok(ask.includes('undo: () => { clearTimeout(pending); setToast({ msg: t("Restored.") }); },'));
  assert.ok(src.includes('{toast.undo && <button type="button" className="wa-toast-undo" onClick={toast.undo}>{t("Undo")}</button>}'));
  // and nothing on the page deletes one piece any other way
  assert.equal(count(src, "deleteAsset("), 1, "only askDelete's timer");
  assert.equal(count(src, 'intent: "delete"'), 1);
});
