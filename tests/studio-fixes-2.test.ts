/* The Creator and the Ad Maker (app/routes/web.studio.tsx), the SECOND half of the page: twelve more things
 * from the same read-through, 2026-11-22. Nine needed a change and are pinned here, under the numbers they
 * were reported with.
 *
 * The other three were checked against the file as the first batch left it, and were already right — they
 * are pinned in studio-fixes.test.ts, not again here:
 *   3 — typing a product name, or reusing a past shot made with another presenter, no longer drops the
 *       frame (its tests 1 and 5);
 *   5 — Make / Pro / Ultra all stay off while a piece of that kind is cooking (its last test);
 *   7 — the picked video style and the written words survive "‹ Content type" and a tab round trip (its
 *       test 10).
 * (So was the first half of 9 — a refused "Create a background" says why: its test 6. The second half,
 *  the store import, is here.)
 *
 * As there: the page cannot be loaded here (loader, action and JSX in one file), so each test reads it as
 * text and pins the lines that carry the fix — and, where the rule is small enough to state, runs the rule
 * itself beside the line it was copied from. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CREATE_MODELS, createModelSurcharge, normalizeCreateModelKey } from "../app/lib/create-models.ts";
import { TOKEN_COST } from "../app/lib/plan-config.ts";

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

test("1 — a photo edit with a second photo is priced as what it is charged: Ultra", () => {
  // SEEN: a 2nd photo makes the edit a two-photo combine. The submit forces the model, and so does the
  // action — 16 tokens — while the line under "Edit photo" and the Model pill went on showing Pro, 5.
  assert.ok(ui.includes("if (editFile2) { fd.set(\"productPhoto2\", editFile2); fd.set(\"createModel\", \"ultra\"); }"), "what the page sends");
  assert.ok(ui.includes("const editModel = sourceImageUrl2 ? normalizeCreateModelKey(\"ultra\") : normalizeCreateModelKey((form.get(\"createModel\") as string) || \"\");"), "what the action charges for");
  assert.ok(ui.includes("const editEach = TOKEN_COST.image + createModelSurcharge(editModel);"));

  // THE FIX: one key says which model is charged, and the fee is read from it
  assert.ok(ui.includes("const feeModel = isEdit && editFile2 ? \"ultra\" : createModel;"));
  assert.ok(ui.includes("const createFee = (isCreate || isEdit) ? createModelSurcharge(feeModel) : 0;"));
  assert.ok(!ui.includes("createModelSurcharge(createModel) : 0;"), "the fee no longer reads the pill alone");
  // …it is the price on the button's line (and what `shortBy` holds the wallet against)…
  assert.ok(ui.includes(": tab === \"image\" ? d.costs.image :"), "an edit's base price is the image price, as in the action");
  assert.ok(ui.includes("const cost = isVideoEdit ? d.costs.videoEdit : baseCost + engineFee + createFee + facelessFee;"));
  assert.ok(ui.includes("const shortBy = d.hasPlan ? Math.max(0, cost * effBurst - d.tokens) : 0;"));
  // …the model that line names…
  assert.ok(ui.includes("createFee ? t(\" · incl. {n} {model}\", { n: createFee, model: CREATE_MODELS.find((m) => m.key === feeModel)?.name || t(\"premium\") })"));
  assert.ok(!ui.includes("CREATE_MODELS.find((m) => m.key === createModel)?.name"));
  // …and the pill that is lit, with its description
  assert.ok(ui.includes("<button type=\"button\" key={m.key} role=\"radio\" aria-checked={feeModel === m.key}"));
  assert.ok(ui.includes("className={`ws-model${feeModel === m.key ? \" sel\" : \"\"}`} onClick={() => setCreateModel(m.key)}>"), "a tap still records the pick — it comes back when photo 2 is removed");
  assert.ok(ui.includes("{t(CREATE_MODELS.find((m) => m.key === feeModel)?.blurb || \"\")}"));

  // what that decides, for every model that can be picked, with and without a second photo
  const charged = (photo2: boolean, picked: string) => TOKEN_COST.image + createModelSurcharge(photo2 ? normalizeCreateModelKey("ultra") : normalizeCreateModelKey(picked));
  const feeModel = (photo2: boolean, picked: string) => (photo2 ? "ultra" : picked);
  const quoted = (photo2: boolean, picked: string) => TOKEN_COST.image + createModelSurcharge(feeModel(photo2, picked));
  const quotedBefore = (_photo2: boolean, picked: string) => TOKEN_COST.image + createModelSurcharge(picked);
  for (const photo2 of [false, true]) {
    for (const m of CREATE_MODELS) assert.equal(quoted(photo2, m.key), charged(photo2, m.key), `${m.key}${photo2 ? " + photo 2" : ""}`);
  }
  assert.equal(charged(true, "pro"), 16);
  assert.equal(quotedBefore(true, "pro"), 5, "the case that was shown wrong");
  assert.equal(CREATE_MODELS.find((m) => m.key === feeModel(true, "pro"))?.name, "Ultra");
  assert.equal(CREATE_MODELS.find((m) => m.key === feeModel(false, "pro"))?.name, "Pro");
  // a wallet of 10: the button was live and the action refused it; now it says how many it is short
  const shortBy = (cost: number, tokens: number) => Math.max(0, cost - tokens);
  assert.equal(shortBy(quotedBefore(true, "pro"), 10), 0);
  assert.equal(shortBy(quoted(true, "pro"), 10), 6);
});

test("2 — touching the presenter, product, size or hold/wear keeps the chosen Setting", () => {
  // SEEN: the reset that runs on any of those blanked the scene text and left the selected card alone — the
  // card still said "Kitchen", the hidden combineScene was empty, and the next 16-token Combine had no setting.
  assert.ok(ui.includes("<input type=\"hidden\" name=\"combineScene\" value={combineScene} />"), "what a Combine sends");
  assert.ok(ui.includes("const combineScene = ((form.get(\"combineScene\") as string) || \"\").trim().slice(0, 200) || undefined;"), "…and what the action composes with");
  assert.ok(ui.includes("onClick={() => { if (settingKey !== s.key) clearCombineFrame(); setSettingKey(s.key); setCombineScene(s.scene); setHubPick(null); }}>"), "a card sets both");

  const reset = cut("const resetCombine = () => {", "const combineFetcher = useFetcher");
  assert.ok(!reset.includes("setCombineScene(\"\")"), "the scene is not simply blanked");
  assert.ok(reset.includes("setCombineScene((typed) => (settingKey === \"custom\" ? typed : COMBINE_SETTINGS.find((s) => s.key === settingKey)?.scene || \"\"));"));
  // the rest of the reset is what it was: the frame, the wait and the Edit box go
  assert.ok(reset.includes("setCombineUrl(null); setCombineErr(null); setCombining(false); setCombineJobId(null);"));
  assert.ok(reset.includes("setCombineEdit(\"\"); setCombineGenerated(false);"));

  // the rule, on the page's own table of settings
  const settings = new Map<string, string>();
  for (const m of ui.matchAll(/\{ key: "([a-z]+)", name: "[^"]+", scene: "([^"]*)", emoji: /g)) settings.set(m[1], m[2]);
  assert.equal(settings.size, 8, "Auto and the seven presets");
  const sceneAfterReset = (settingKey: string, typed: string) => (settingKey === "custom" ? typed : settings.get(settingKey) || "");
  assert.equal(sceneAfterReset("kitchen", ""), "in a bright, modern kitchen");
  assert.equal(sceneAfterReset("kitchen", "in a bright, modern kitchen, green shirt"), "in a bright, modern kitchen", "a change Edit stacked on goes with its frame");
  for (const [key, scene] of settings) assert.equal(sceneAfterReset(key, "anything"), scene, key);
  assert.equal(sceneAfterReset("auto", "left over"), "", "Auto has no scene");
  assert.equal(sceneAfterReset("bg:ck1abc", "left over"), "", "a saved backdrop rides as its URL, not as text");
  assert.equal(sceneAfterReset("custom", "a sunny rooftop café"), "a sunny rooftop café", "a background being typed is not wiped");
  // the ✕ on the frame is a different act, and still puts the setting back to Auto — card and text together
  assert.ok(ui.includes("setCombineUrl(null); setCombineGenerated(false); setCombineScene(\"\"); setCombineEdit(\"\"); setCombineErr(null); setSettingKey(\"auto\"); clearBgUpload();"));
});

test("4 — Return in an empty “Describe a change” box does not buy another take", () => {
  // SEEN: with the box empty, applyCombineEdit means Retry — 16 tokens, and the approved frame replaced.
  // The box called it on Return whatever it held; the twin box (a reused / uploaded shot) required text.
  assert.ok(ui.includes("doCombine({ scene: combineScene || undefined });"), "the empty branch: another take");
  assert.ok(!ui.includes("onKeyDown={(e) => { if (e.key === \"Enter\" && !combining && !busy) { e.preventDefault(); applyCombineEdit(); } }}"));
  assert.equal(count(ui, "onKeyDown={(e) => { if (e.key === \"Enter\" && !combining && !busy && combineEdit.trim()) { e.preventDefault(); applyCombineEdit(); } }}"), 1);
  assert.equal(count(ui, "onKeyDown={(e) => { if (e.key === \"Enter\" && !combining && !busy && combineEdit.trim()) { e.preventDefault(); applyFrameEdit(); } }}"), 1, "the twin, as it was");
  const sends = (key: string, combining: boolean, busy: boolean, text: string) => key === "Enter" && !combining && !busy && !!text.trim();
  assert.equal(sends("Enter", false, false, ""), false, "the case that was charged");
  assert.equal(sends("Enter", false, false, "   "), false);
  assert.equal(sends("Enter", false, false, "green shirt"), true);
  assert.equal(sends("Enter", true, false, "green shirt"), false);
  // Retry is still there — on the button, which says so and shows its price
  assert.ok(ui.includes("<button type=\"button\" className=\"ws-tweak primary\" onClick={applyCombineEdit} disabled={combining || busy} title={combineEdit.trim() ? t(\"Apply your change\") : t(\"Another take of this shot\")}>"));
  // (and Return never submits the form: the form's own handler stops it for every <input>)
  assert.ok(ui.includes("if (e.key === \"Enter\" && (e.target as HTMLElement).tagName === \"INPUT\") e.preventDefault();"));
});

test("6 — a tab change clears an uploaded photo, not a product picked from the store", () => {
  // SEEN: the effect that tidies up on a tab change set the product source to null whatever it was — and
  // it also runs on mount, after the ?product= preselect had just set "store". Helpurr's "Make an image ad
  // for {product}" link landed with the product filled in, no source selected and Generate off; "From your
  // store" then blanked the photo. Any tab tap dropped the chosen product the same way.
  const tabEffect = cut("// Casual tabs (Make / Edit / Music / Faceless) toggle in place too", "}, [tab]);");
  const body = tabEffect.slice(tabEffect.lastIndexOf("useEffect(() => {"));
  assert.ok(body.includes("setProdSource((p) => (p === \"upload\" ? null : p));"));
  assert.ok(!body.includes("setProdSource(null);"));
  assert.ok(body.startsWith("useEffect(() => {\n    clearUpload();\n"), "an uploaded photo and the frame still go");
  // the preselect is declared first, so on mount its update is queued first and the tab effect's lands on it
  const preselect = cut("const didPreselectRef = useRef(false);", "// WHAT IS ON SCREEN, NOT WHAT IS IN THE DATABASE.");
  assert.ok(preselect.includes("setProdSource(\"store\");") && preselect.includes("  }, []);"));
  assert.ok(ui.indexOf("const didPreselectRef = useRef(false);") < ui.indexOf("// Casual tabs (Make / Edit / Music / Faceless) toggle in place too"));
  type Source = "store" | "upload" | "link" | null;
  const after = (start: Source, queue: Array<Source | ((p: Source) => Source)>) => queue.reduce<Source>((s, u) => (typeof u === "function" ? u(s) : u), start);
  const keepStore = (p: Source): Source => (p === "upload" ? null : p);
  assert.equal(after(null, ["store", null]), null, "what it did: the link's product had no source");
  assert.equal(after(null, ["store", keepStore]), "store", "the link's product arrives selected");
  assert.equal(after("store", [keepStore]), "store", "a tab tap keeps a store pick");
  assert.equal(after("upload", [keepStore]), null, "…and drops the upload source, whose file was just cleared");
  assert.equal(after(null, [keepStore]), null);
  // why a null source mattered: nothing counts as a product without one, and choosing "store" reads as a switch
  // (a product read from a pasted link is a third source since 2026-11-22 — tests/studio-product-link.test.ts;
  //  a tab tap keeps it exactly as it keeps a store pick: only the upload source is dropped)
  assert.equal(after("link", [keepStore]), "link");
  assert.ok(ui.includes("const hasMarketingProduct = (prodSource === \"store\" && !!imageUrl.trim()) || (prodSource === \"upload\" && (hasFile || !!imageUrl.trim())) || (prodSource === \"link\" && !!imageUrl.trim());"));
  assert.ok(ui.includes("const chooseStore = () => { if (prodSource !== \"store\") { dropPickedName(); setImageUrl(\"\"); setPickedUrl(\"\"); } setProdSource(\"store\");"));

  // AND IN CREATOR: the same effect clears `hasFile`, which the photo editor shares with the upload source —
  // while the photo being edited stays on the Stage (it lives in editFile). "Edit photo" went dead with the
  // photo in plain view. The photo that the submit sends now counts as a photo.
  assert.ok(ui.includes("&& (casual ? (!hasFile && !(isEdit && editFile) && !imageUrl.trim()) : !hasMarketingProduct);"));
  assert.ok(!ui.includes("&& (casual ? (!hasFile && !imageUrl.trim()) : !hasMarketingProduct);"));
  assert.ok(ui.includes("if (isEdit && (editFile || imageUrl.trim())) {"), "what the submit goes by");
  assert.ok(ui.includes("if (editFile) fd.set(\"productPhoto\", editFile);"));
  const casualNeedsPhoto = (hasFile: boolean, isEdit: boolean, editFile: boolean, imageUrl: string) => !hasFile && !(isEdit && editFile) && !imageUrl.trim();
  assert.equal(casualNeedsPhoto(false, true, true, ""), false, "back from another tab: the photo on the Stage is enough");
  assert.equal(casualNeedsPhoto(false, true, false, ""), true, "no photo: still asked for");
  assert.equal(casualNeedsPhoto(false, false, true, ""), true, "only the editor counts it");
  assert.equal(casualNeedsPhoto(false, true, false, "/renders/x.png"), false, "a piece opened from the Archive, as before");
});

test("8 — “Make another” is offered only when it can make something", () => {
  // SEEN: all it does is press the make button — and a disabled button ignores a click. It is disabled
  // right after an uploaded photo's edit lands (the photo is cleared with the result), with an empty
  // describe box, and with too few tokens: the tap did nothing and said nothing.
  assert.ok(ui.includes("<button ref={makeBtnRef} className=\"wb-btn\" name=\"intent\" value={submitIntent} disabled={ctaDisabled} style={showTwoCta ? { display: \"none\" } : undefined}>"));
  assert.equal(count(ui, "makeBtnRef.current?.click()"), 1);
  assert.ok(ui.includes("{!ctaDisabled && <button type=\"button\" className=\"ws-verb\" onClick={() => makeBtnRef.current?.click()}>↻ {t(\"Make another\")}</button>}"));
  // the result's other verbs do not depend on it
  const verbs = cut("<div className=\"ws-resultctl\">", "<input ref={stageUploadRef}");
  assert.ok(verbs.includes("onClick={() => downloadMedia(stageResult.media)}>⤓ {t(\"Download\")}</button>"));
  assert.ok(verbs.includes("onClick={() => setStageResult(null)}>✕ {t(\"Clear\")}</button>"));
});

test("9 — a refused store import says why inside the Avatar hub's product chooser", () => {
  // SEEN: "Pull my products in" answers a bad address (or one import too many in an hour) with
  // catalogError. That was drawn on the Import tab and in the classic layout — not in the chooser the hub
  // uses, where the button closed its own row and nothing else happened.
  assert.ok(ui.includes("return json({ catalogError: e instanceof Error ? e.message : tr(lang, \"That doesn't look like a web address.\") });"));
  const chooser = cut("const productChooserUI = (", "// (The product source chooser stays inline in step 2");
  assert.ok(chooser.includes("onClick={() => { submit({ intent: \"importCatalog\", storeUrl: storeInput.trim() }, { method: \"post\" }); setShowConnect(false); }}>"));
  const shown = "<div className=\"wb-err\" style={{ marginTop: 8 }}>{(actionData as { catalogError?: string }).catalogError}</div>";
  assert.ok(chooser.includes("{prodSource === \"store\" && !serviceForced && (actionData as { catalogError?: string } | null)?.catalogError && ("));
  assert.ok(chooser.includes(shown));
  assert.ok(chooser.indexOf(shown) > chooser.indexOf("{t(\"Pull my products in\")}"), "under the row it belongs to");
  // one of the two is on screen at a time: this chooser is the hub's, the other block is the classic layout's
  assert.equal(count(ui, shown), 2);
  assert.equal(count(ui, "<div className=\"ws-hub-reveal\" hidden={hubPick !== \"product\"}>{productChooserUI}</div>"), 1);
  assert.equal(count(ui, "{productChooserUI}"), 1);
  const classicFrom = ui.indexOf("{!avatarVideoHub && (<>");
  const classicTo = ui.indexOf("</>)}{/* /!avatarVideoHub classic layout */}");
  const second = ui.lastIndexOf(shown);
  assert.ok(classicFrom > 0 && classicFrom < second && second < classicTo);
});

test("10 — nine more controls get a 44px place to tap on a phone, and three boxes stop zooming iOS", () => {
  const css = ui.slice(ui.indexOf("const WS_STYLE = `"));
  const floor = cut("@media(max-width:620px){\n  .ws-addurl{min-height:44px;", "/* Cinematic Studio hero");
  const base = css.replace(floor, "");
  const shell = read("app", "routes", "web.tsx"); // .ws-back lives in the shell's stylesheet
  const rule = (sheet: string, cls: string) => {
    const m = new RegExp(`(?:^|\\n|\\})\\.${cls}\\{([^}]*)\\}`).exec(sheet);
    assert.ok(m, `no rule for .${cls}`);
    return m[1];
  };

  // SEEN, the sizes they are drawn at — none of them was in the phone block
  assert.ok(rule(base, "ws-hubtile-sound").includes("width:34px;height:34px"));
  assert.ok(rule(base, "ws-combine-clear").includes("width:32px;height:32px"));
  assert.ok(rule(base, "ws-setmore").includes("height:26px"));
  assert.ok(rule(base, "ws-setcard-x").includes("width:22px;height:22px"));
  assert.ok(rule(base, "ws-combine2-x").includes("width:20px;height:20px"));
  assert.ok(rule(base, "ws-noprod").includes("padding:4px 10px 4px 9px") && rule(base, "ws-noprod").includes("font-size:11px"));
  assert.ok(rule(base, "ws-vedit-entry").includes("padding:4px 0") && rule(base, "ws-vedit-entry").includes("font-size:12.5px"));
  assert.ok(rule(base, "ws-setcard-ren").includes("font-size:12px") && rule(base, "ws-setcard-ren").includes("padding:2px"));
  assert.ok(rule(shell, "ws-back").includes("font-size:13px") && rule(shell, "ws-back").includes("padding:0"));

  // THE FIX: one see-through shape, 44px tall and at least 44px wide, centred on the control…
  const shape = "{content:\"\";position:absolute;top:50%;left:50%;width:100%;min-width:44px;height:44px;transform:translate(-50%,-50%)}";
  const at = floor.indexOf(shape);
  assert.ok(at > 0, "the shape is in the phone block");
  const hosts = floor.slice(floor.lastIndexOf("\n", at) + 1, at).trim().split(",").map((s) => s.trim());
  assert.deepEqual([...hosts].sort(), [".ws-back::after", ".ws-combine-clear::after", ".ws-combine2-x::after", ".ws-hubtile-sound::after", ".ws-setcard-ren::after", ".ws-setcard-x::after", ".ws-setmore::after", ".ws-vedit-entry::after"]);
  // …and the No-product switch, measured up from just below it (it hangs 11px under its tile)
  assert.ok(rule(base, "ws-noprod").includes("bottom:-11px"));
  assert.ok(floor.includes(".ws-noprod::after{content:\"\";position:absolute;left:0;right:0;bottom:-6px;height:44px}"));

  // A hit area only exists if three things hold for the control it hangs on. Each is checked, not assumed:
  const madeRelative = [".ws-back", ".ws-vedit-entry", ".ws-setcard-ren"];
  assert.ok(floor.includes(`${madeRelative.join(",")}{position:relative}`));
  for (const host of [...hosts, ".ws-noprod::after"]) {
    const cls = host.replace("::after", "").slice(1);
    const decl = rule(cls === "ws-back" ? shell : base, cls);
    // 1. the control is positioned, so the ::after is anchored to IT — made relative here only if it was not
    const positioned = /position:(absolute|relative)/.test(decl);
    assert.equal(madeRelative.includes(`.${cls}`), !positioned, `.${cls}: ${positioned ? "keeps the position it had" : "is made relative"}`);
    // 2. its ::after is free — nothing else on the page already draws with it
    assert.ok(!base.includes(`.${cls}::after`) && !shell.includes(`.${cls}::after`), `.${cls}::after was not in use`);
    // 3. it does not clip its own children (a clipped ::after cannot be tapped)
    if (/overflow:hidden/.test(decl)) assert.ok(floor.includes(`.${cls}{overflow:visible;`), `.${cls} is unclipped on a phone`);
  }
  // the one that does clip: the backdrop ✕ (for its slide to "Delete") — unclipped on a phone, the swap instant
  assert.ok(rule(base, "ws-setcard-x").includes("overflow:hidden") && rule(base, "ws-setcard-x").includes("transition:width .17s ease,background .14s"));
  assert.ok(floor.includes(".ws-setcard-x{overflow:visible;transition:background .14s}"));
  // WHY NOT AN INSET, as the block's earlier lines use: an inset is counted from inside the border, and the
  // clear-frame button has one — 6px each side of it would have come to 41px, not 44.
  assert.ok(rule(base, "ws-combine-clear").includes("border:1.5px solid"));
  assert.equal(32 - 2 * 1.5 + 2 * 6, 41);

  // THREE BOXES typed in at under 16px: iOS Safari zooms the page on focus, and leaves it zoomed
  assert.ok(rule(base, "ws-combine-editbox").includes("font-size:13px"));
  assert.ok(rule(base, "ws-setcustom").includes("font-size:13px"));
  assert.ok(rule(base, "ws-setcard-rename").includes("font-size:12px"));
  assert.ok(floor.includes(".ws-combine-editbox,.ws-setcustom,.ws-setcard-rename{font-size:16px}"));
  // the phone block is the last word on them (same weight of selector, later in the sheet)
  const floorAt = css.indexOf(floor);
  for (const cls of ["ws-combine-editbox", "ws-setcustom", "ws-setcard-rename"]) {
    const baseAt = css.indexOf(`\n.${cls}{`);
    assert.ok(baseAt > 0 && baseAt < floorAt, `${cls}: its own rule comes first`);
    assert.equal(count(css.slice(floorAt + floor.length), `.${cls}`), 0, `${cls} is not restyled after the phone block`);
  }
});

test("11 — the line over a dead Generate button points at the thing that is missing", () => {
  const block = cut("const avatarHubBlock: string | null =", "// The three casual \"make\" flows");
  // SEEN (a): "Add a product name up in “Your scene”." — the Product name box is not in that panel. In the
  // hub it comes after the panel and before the make bar, where this line is shown.
  assert.ok(!ui.includes("Add a product name up in “Your scene”."));
  assert.ok(block.includes(": (!noProduct && !productTitle.trim()) ? t(\"Add a product name in the “Product name” box above.\")"));
  const panel = ui.indexOf("<div className={`ws-combine ws-scene${combining ? \" combining\" : \"\"}${combineUrl ? \" done\" : \"\"}`}>");
  const label = ui.indexOf("<div className=\"ws-lbl\"><span>{t(\"Product name\")}</span>", ui.indexOf("{avatarVideoHub && (noProduct ? ("));
  const box = ui.indexOf("<input className=\"wb-in\" name=\"productTitle\" required maxLength={120} value={productTitle}");
  const line = ui.indexOf("<p className=\"ws-hubblock\" role=\"status\">{avatarHubBlock}</p>");
  assert.ok(panel > 0 && panel < label && label < box && box < line, "panel, then the box under its “Product name” label, then the line");

  // SEEN (b): with "No product" on and "What do they say?" empty it said: Tap “Write the script” — and that
  // button refuses, for want of exactly that text. It now asks for the text, in the Write button's own words.
  assert.ok(block.includes(": (noProduct && videoStyle !== \"anthem\" && !direction.trim()) ? t(\"Tell me what they talk about first.\")"));
  assert.ok(block.indexOf("Add a product name in the “Product name” box above.") < block.indexOf("Tell me what they talk about first."));
  assert.ok(block.indexOf("Tell me what they talk about first.") < block.indexOf(": !videoStyle ? t(\"Pick a style above.\")"), "before the style and the words: it is the first thing missing");
  assert.ok(ui.includes("|| (noProduct && videoStyle !== \"anthem\" && !direction.trim()) || needsPhoto ||"), "the same test that turns the button off");
  const write = cut("const writeWords = () => {", "previewFetcher.submit(fd, { method: \"post\" });");
  assert.ok(write.includes("? (direction.trim() || (videoStyle === \"anthem\" ? \"our brand\" : \"\")).slice(0, 60)\n      : productTitle.trim();"));
  assert.ok(write.includes("if (!titleForPreview) { setWordsErr(noProduct ? t(\"Tell me what they talk about first.\") : t(\"Add the product name first.\")); return; }"));

  // the two rules side by side: whenever the line says "tap Write", Write does not refuse
  type Style = "anthem" | "talking" | "commercial" | null;
  type S = { presenter: boolean; shot: boolean; noProduct: boolean; needsPhoto: boolean; name: string; say: string; style: Style; words: boolean };
  const says = (s: S, fixed: boolean): string | null =>
    (!s.presenter && !s.shot) ? "presenter"
    : (!s.noProduct && s.needsPhoto) ? "photo"
    : (!s.noProduct && !s.name.trim()) ? "name"
    : (fixed && s.noProduct && s.style !== "anthem" && !s.say.trim()) ? "topic"
    : !s.style ? "style"
    : !s.words ? "write"
    : null;
  const writeRefuses = (s: S) => !(s.noProduct ? (s.say.trim() || (s.style === "anthem" ? "our brand" : "")).slice(0, 60) : s.name.trim());
  const off = (s: S) => (!s.noProduct && !s.name.trim()) || (s.noProduct && s.style !== "anthem" && !s.say.trim()) || (!s.noProduct && s.needsPhoto) || (!s.presenter && !s.shot) || !s.style || !s.words;
  let deadEnds = 0, silent = 0;
  for (const noProduct of [false, true]) for (const name of ["", "Midnight Roast"]) for (const say of ["", "why I started"]) {
    for (const style of [null, "anthem", "talking", "commercial"] as Style[]) for (const words of [false, true]) {
      const s: S = { presenter: true, shot: false, noProduct, needsPhoto: false, name, say, style, words };
      if (says(s, false) === "write" && writeRefuses(s)) deadEnds++;
      if (off(s) && says(s, false) === null) silent++;
      assert.equal(says(s, true) === "write" && writeRefuses(s), false, JSON.stringify(s));
      assert.equal(off(s), says(s, true) !== null, `a dead button always has its reason: ${JSON.stringify(s)}`);
    }
  }
  assert.ok(deadEnds > 0, "the old line did send people to a button that refuses");
  assert.ok(silent > 0, "…and, once the words were written, said nothing at all when the topic was cleared");
  assert.equal(says({ presenter: true, shot: false, noProduct: true, needsPhoto: false, name: "", say: "", style: "talking", words: false }, true), "topic");
  assert.equal(says({ presenter: true, shot: false, noProduct: true, needsPhoto: false, name: "", say: "", style: "anthem", words: false }, true), "write", "a jingle needs no topic");

  // the line it borrows is in every language already (the new one is added with this change)
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  const languages = count(dict, ": Record<string, string> = {");
  assert.ok(languages >= 5);
  assert.equal(count(dict, "\n  \"Tell me what they talk about first.\": "), languages);
});

test("12 — the place is called “Archive”, and the Stage does not link to it twice", () => {
  // SEEN: Creator's copy said "gallery" / "Open gallery" / "View gallery". There is no gallery: the tab and
  // the page are "Archive". And a result on the Stage carried a second "Open gallery" link right above the
  // shelf's own.
  for (const old of ["t(\"Open gallery\")", "t(\"gallery\")", "t(\"View gallery\")"]) assert.equal(count(ui, old), 0, old);
  assert.equal(count(ui, "t(\"Open Archive\")"), 1);
  assert.ok(ui.includes("<div className=\"ws-shelf-h\"><b>{t(\"Your creations\")}</b><Link to=\"/web/archive?section=creator\" className=\"ws-shelf-all\">{t(\"Open Archive\")} ›</Link></div>"), "the shelf's link stays");
  const verbs = cut("<div className=\"ws-resultctl\">", "<input ref={stageUploadRef}");
  assert.equal(count(verbs, "<Link"), 0, "the result's controls no longer repeat it");
  // (the shelf is there whenever a result is: a result comes from the same list the shelf draws)
  assert.ok(ui.includes("{casual && d.recent.length > 0 && (\n        <section className=\"ws-shelf\">"));
  assert.ok(ui.includes("const fresh = d.recent.find((p) => p.media && !preIdsRef.current.includes(p.id));"));
  // the header, and the "being made" card
  assert.ok(ui.includes("<Link to=\"/web/archive?section=creator\">{t(\"Archive\")}</Link>.</>"));
  assert.equal(count(ui, "<b>{t(\"Archive\")}</b>"), 2);
  assert.ok(ui.includes("${casual ? \"&section=creator\" : \"\"}`}>{t(\"View Archive\")} ›</Link>"), "Creator still lands in its own section of it");
  // the names used are in every language
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  const languages = count(dict, ": Record<string, string> = {");
  for (const s of ["Open Archive", "Archive", "View Archive"]) assert.equal(count(dict, `\n  "${s}": `), languages, s);
});

test("what a Creator photo edit shows it costs is what it costs: one edit, and no second photo left behind", () => {
  // a "×5" left over from the Ad Maker read "Edit 5 photos · 25 tokens" over an edit made and charged once
  assert.ok(ui.includes("const effBurst = isVideoEdit || isEdit || (casual && tab === \"video\") ? 1 : burst;"));
  // the second photo of a two-photo edit stayed loaded: the next edit went out as two photos (16 tokens, not 5)
  const landed = ui.slice(ui.indexOf("// The new piece has landed → show it on the Stage."), ui.indexOf("// The new piece has landed → show it on the Stage.") + 2400); // (2400: the landing now waits a beat for a not-made edit, ahead of these lines)
  assert.ok(landed.includes("setEditFile(null);") && landed.includes("clearPhoto2();"));
  assert.ok(landed.indexOf("clearPhoto2();") > landed.indexOf("setEditFile(null);"));
  assert.ok(ui.indexOf("const clearPhoto2 = () => {") < ui.indexOf("// The new piece has landed → show it on the Stage."), "declared before the effect that calls it");
});

test("the quick-edit button that spends says what it spends", () => {
  // made as a customer (2026-11-22): "Apply Zoom out", with the price only in the heading above the options
  const ui = read("app", "routes", "web.studio.tsx");
  assert.ok(ui.includes("t(\"Apply {label} · {n} tokens\", { label: QUICK_OPS.find((o) => o.key === quickSel)?.label || \"\", n: d.costs.quickEdit })"));
  assert.ok(!ui.includes("t(\"Apply {label}\", {"));
  assert.equal(read("app", "lib", "ui-i18n-dict.ts").split("  \"Apply {label} · {n} tokens\": ").length - 1, 5);
});
