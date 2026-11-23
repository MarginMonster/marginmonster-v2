/* Collections in the Archive, and "Add to queue" — added 2026-11-22 and pinned here.
 *
 *   1. COLLECTIONS — named shelves ("Summer launch") a piece can sit on. Found from a Collections menu beside
 *      the presenter / product menus (?col= in the URL, applied by the LOADER with the search and the When
 *      window, and counted the same way); filled from Select mode's bar and from an opened piece; renamed
 *      and deleted while open. The database work is app/lib/collections.server.ts, every query scoped by
 *      the shop.
 *   2. ADD TO QUEUE — two buttons that hand pieces to the Auto-post page's queue (POST /web/autopost,
 *      intent=queueAdd). No queue logic lives here.
 *
 * As in archive-features.test.ts: what decides is kept in pure blocks — one in the route, one in the
 * server file — lifted out of the source and RUN; the wiring around them is pinned by reading the source.
 * (Nothing here was seen in a browser: there is no local database. See the report for what that leaves.) */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const src = read("app", "routes", "web.archive.tsx");
const lib = read("app", "lib", "collections.server.ts");
const loader = src.slice(src.indexOf("export const loader"), src.indexOf("export const action"));
const action = src.slice(src.indexOf("export const action"), src.indexOf("/** Countdown text, or the truth"));

/** Lift a block out of a source between two markers and run it, returning the names asked for. */
function lift<T>(hay: string, start: string, end: string, names: string[]): { block: string; fns: T } {
  const at = hay.indexOf(start);
  const to = hay.indexOf(end, at);
  assert.ok(at > 0 && to > at, `the block "${start}" is there`);
  assert.equal(count(hay, start), 1);
  const block = hay.slice(at, to);
  const js = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return { block, fns: new Function(`${js}\nreturn { ${names.join(", ")} };`)() as T };
}

// ── the server file's pure part: the name rules and the id list ──────────────────────────────────────
type LibPure = {
  COL_NAME_MAX: number;
  COL_MAX: number;
  cleanColName: (v: unknown) => string;
  colNameProblem: (name: string) => "empty" | "long" | null;
  sameColName: (a: string, b: string) => boolean;
  parseAssetIds: (v: unknown) => string[];
};
const LIB_NAMES = ["COL_NAME_MAX", "COL_MAX", "cleanColName", "colNameProblem", "sameColName", "parseAssetIds"];
const libPart = lift<LibPure>(lib, "/* ── COLLECTIONS · THE PURE PART", "/* ── end of the pure part", LIB_NAMES);

// ── the route's pure part: what the queue buttons send and what the page says ────────────────────────
type QueueAnswer = { ok: true; queued: number; skipped: number; firstDueAt: string | null; lastDueAt: string | null } | { error: string };
type Said = { error: string } | { parts: Array<{ s: string; p: Record<string, string | number> }> };
type RoutePure = {
  queueableIds: (pieces: Array<{ id: string; type: string; media: string | null }>) => string[];
  queueWhen: (iso: string, nowMs: number, locale?: string) => string;
  queueSay: (a: QueueAnswer, when: string) => Said;
  colSay: (op: string, n: number) => string;
};
const ROUTE_NAMES = ["queueableIds", "queueWhen", "queueSay", "colSay"];
const routePart = lift<RoutePure>(src, "/* ── COLLECTIONS & THE QUEUE · THE PURE PART", "/* ── end of the collections & queue part", ROUTE_NAMES);

/** What t() does with a source string and its values (the English side of the page's translator). */
const fill = (s: string, p: Record<string, string | number> = {}) => Object.keys(p).reduce((out, k) => out.split(`{${k}}`).join(String(p[k])), s);

test("both pure parts really are pure — so what runs here is what the server and the page run", () => {
  for (const [name, block] of [["collections.server.ts", libPart.block], ["web.archive.tsx", routePart.block]] as const) {
    for (const banned of ["import ", "export ", "useState", "useEffect", "db.", "await ", "document.", "window.", "fetch(", "Date.now("]) {
      assert.ok(!block.includes(banned), `${name}: the pure part must not contain "${banned}"`);
    }
  }
  for (const n of LIB_NAMES) assert.ok(n in libPart.fns, n);
  for (const n of ROUTE_NAMES) assert.ok(n in routePart.fns, n);
  // each function is defined once, inside its block, and used
  for (const fn of ["cleanColName", "colNameProblem", "sameColName", "parseAssetIds"]) {
    assert.equal(count(lib, `function ${fn}(`), 1, fn);
    assert.ok(count(lib, `${fn}(`) >= 2, `${fn} is called`);
  }
  for (const fn of ["queueableIds", "queueWhen", "queueSay", "colSay"]) {
    assert.equal(count(src, `function ${fn}(`), 1, fn);
    assert.ok(count(src, `${fn}(`) >= 2, `${fn} is called`);
  }
  // the Archive's first pure part (archive-features.test.ts) is still exactly one block, and this one sits after it
  assert.ok(src.indexOf("/* ── end of the pure part") < src.indexOf("/* ── COLLECTIONS & THE QUEUE · THE PURE PART"));
});

test("NAMES: trimmed, 1–40 characters, one per name per shop whatever the case — and 50 collections at most", () => {
  const { COL_NAME_MAX, COL_MAX, cleanColName, colNameProblem, sameColName } = libPart.fns;
  assert.equal(COL_NAME_MAX, 40);
  assert.equal(COL_MAX, 50);
  // trimmed, and a run of spaces (a pasted tab or newline) is one space
  assert.equal(cleanColName("  Summer launch  "), "Summer launch");
  assert.equal(cleanColName("Summer\t\n  launch"), "Summer launch");
  for (const junk of [null, undefined, 7, {}, ["x"]]) assert.equal(cleanColName(junk), "", JSON.stringify(junk));
  // 1–40 characters once trimmed
  assert.equal(colNameProblem(cleanColName("   ")), "empty");
  assert.equal(colNameProblem(""), "empty");
  assert.equal(colNameProblem("a"), null);
  assert.equal(colNameProblem("x".repeat(40)), null);
  assert.equal(colNameProblem("x".repeat(41)), "long");
  // counted in characters, not UTF-16 halves: forty emoji are forty characters
  assert.equal(colNameProblem("🎄".repeat(40)), null);
  assert.equal(colNameProblem("🎄".repeat(41)), "long");
  // a clash is any case
  assert.equal(sameColName("Summer launch", "summer LAUNCH"), true);
  assert.equal(sameColName("Summer launch", "Summer launch 2"), false);

  // the server uses exactly these rules, for a new collection and for a rename…
  const create = lib.slice(lib.indexOf("export async function createCollection("), lib.indexOf("export async function addToCollection("));
  const rename = lib.slice(lib.indexOf("export async function renameCollection("), lib.indexOf("export async function deleteCollection("));
  for (const [name, fn] of [["create", create], ["rename", rename]] as const) {
    assert.ok(fn.includes("const name = cleanColName(rawName);"), name);
    assert.ok(fn.includes("const bad = colNameProblem(name);\n  if (bad) return { ok: false, problem: bad };"), name);
    assert.ok(fn.includes('return { ok: false, problem: "taken", name };'), `${name}: a clash says so`);
    assert.ok(fn.includes("if (isUniqueClash(e)) return { ok: false, problem: \"taken\", name };"), `${name}: and a race the unique index catches says the same`);
  }
  // …the clash is asked of the database without regard to case, and checked again with the same rule
  assert.ok(lib.includes('where: { shopId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },'));
  assert.ok(lib.includes("return hits.some((h) => sameColName(h.name, name));"));
  assert.ok(rename.includes("if (await nameTaken(shopId, name, found.id))"), "a collection's own old name is no clash");
  // …and the 50th is the last
  assert.ok(create.includes('if ((await db.collection.count({ where: { shopId } })) >= COL_MAX) return { ok: false, problem: "full" };'));
  assert.ok(!rename.includes("COL_MAX"), "a rename never counts against the limit");

  // EVERY problem is a whole sentence, in the member's language
  const sentence = src.slice(src.indexOf("function colProblemSentence("), src.indexOf("export const action"));
  for (const s of [
    'tr(lang, "Give the collection a name.")',
    'tr(lang, "Keep the name to 40 characters or fewer.")',
    'tr(lang, "You already have a collection called “{name}” — pick another name.", { name: name || "" })',
    'tr(lang, "You have 50 collections, the most there can be — delete one to make another.")',
    'tr(lang, "That collection is gone — refresh and try again.")',
    'tr(lang, "Those pieces are gone — refresh and try again.")',
  ]) assert.ok(sentence.includes(s), s);
  // the box itself stops at 40
  assert.ok(src.includes('<input autoFocus value={v} maxLength={40} onChange={(e) => setV(e.target.value)} placeholder={t("Collection name")} aria-label={t("Collection name")} />'));
});

test("SHOP SCOPING: every query in collections.server.ts names the shop, and a piece is linked only once it is read back as the shop's", () => {
  // every database call in the file…
  const calls = [...lib.matchAll(/db\.(\w+)\.(\w+)\(/g)].map((m) => ({ at: m.index!, call: `${m[1]}.${m[2]}` }));
  assert.ok(calls.length >= 12, `found ${calls.length} calls`);
  for (const c of calls) {
    const body = lib.slice(c.at, lib.indexOf(";", c.at));
    if (c.call === "collectionItem.createMany") continue; // a write of links, checked on its own just below
    assert.ok(/shopId/.test(body), `${c.call} names the shop: ${body.slice(0, 90)}`);
  }
  // the one write that has no `where`: its links are built ONLY from the shop's own assets (read back first)
  // and from a collection found by id AND shop (or just made for the shop)
  const add = lib.slice(lib.indexOf("export async function addToCollection("), lib.indexOf("export async function removeFromCollection("));
  assert.ok(add.includes("const owned = await db.asset.findMany({ where: { id: { in: ids }, shopId }, select: { id: true } });"));
  assert.ok(add.includes('if (!owned.length) return { ok: false, problem: "none" };'));
  assert.ok(add.includes("collection = await db.collection.findFirst({ where: { id: target.collectionId, shopId }, select: { id: true, name: true } });"));
  assert.ok(add.includes("const made = await createCollection(shopId, target.newName);"));
  assert.ok(add.includes("data: owned.map((a) => ({ collectionId: collection!.id, assetId: a.id })),"));
  assert.ok(add.includes("skipDuplicates: true,"), "a piece already there is left alone — and not counted as added");
  assert.ok(add.includes("return { ok: true, collection, n: r.count };"));
  // the pieces are checked BEFORE a new collection is made, so a request with none of the shop's pieces makes nothing
  assert.ok(add.indexOf("const owned = await db.asset.findMany(") < add.indexOf("createCollection(shopId, target.newName)"));
  // removing: from the shop's collection only (the collection read by id + shop, and the delete scoped through it)
  const remove = lib.slice(lib.indexOf("export async function removeFromCollection("), lib.indexOf("export async function renameCollection("));
  assert.ok(remove.includes("await db.collectionItem.deleteMany({ where: { collectionId: collection.id, collection: { shopId }, assetId: { in: ids } } });"));
  // rename and delete write with the shop in their where, so a stolen id does nothing
  assert.ok(lib.includes("await db.collection.updateMany({ where: { id: found.id, shopId }, data: { name } });"));
  assert.ok(lib.includes("await db.collection.deleteMany({ where: { id: found.id, shopId } });"));
  // deleting a collection never deletes a piece
  assert.ok(!lib.includes("db.asset.delete"), "no piece is ever deleted here");
  assert.ok(!lib.includes("db.asset.update"), "nor changed");
  // the viewer's chips: links of the shop's collections only
  assert.ok(lib.includes("where: { assetId: { in: assetIds }, collection: { shopId } },"));

  // the ids from the form: well-formed, each once, a page at most (the same shape keepMany takes)
  const { parseAssetIds } = libPart.fns;
  assert.deepEqual(parseAssetIds("cm1abcdefgh1, cm1abcdefgh2,cm1abcdefgh1"), ["cm1abcdefgh1", "cm1abcdefgh2"]);
  assert.deepEqual(parseAssetIds("short,../../etc,cm1abcdefgh1'; drop"), []);
  assert.deepEqual(parseAssetIds(null), []);
  assert.equal(parseAssetIds(Array.from({ length: 400 }, (_, i) => `cm1asset${String(i).padStart(5, "0")}`).join(",")).length, 300);

  // the ROUTE does no collection database work of its own — it reads the form and says what happened
  assert.ok(!src.includes("db.collection"), "no collection query in the route");
  assert.ok(src.includes('import { addToCollection, collectionIdsByAsset, createCollection, deleteCollection, listCollections, removeFromCollection, renameCollection, type ColProblem } from "../lib/collections.server";'));
});

test("THE ACTION: five intents, kept thin, answered under their own key — and the post branch left alone", () => {
  const block = action.slice(action.indexOf('if (intent === "colCreate"'), action.indexOf('if (intent === "retryJob")'));
  assert.ok(block.startsWith('if (intent === "colCreate" || intent === "colAdd" || intent === "colRemove" || intent === "colRename" || intent === "colDelete") {'));
  assert.ok(block.includes('intent === "colCreate" ? await createCollection(shop.id, form.get("name"))'));
  assert.ok(block.includes('intent === "colAdd" ? await addToCollection(shop.id, collectionId ? { collectionId } : { newName: form.get("newName") }, form.get("assetIds"))'));
  assert.ok(block.includes('intent === "colRemove" ? await removeFromCollection(shop.id, collectionId, form.get("assetIds"))'));
  assert.ok(block.includes('intent === "colRename" ? await renameCollection(shop.id, collectionId, form.get("name"))'));
  assert.ok(block.includes(": await deleteCollection(shop.id, collectionId);"));
  assert.ok(block.includes("if (!r.ok) return json({ col: { ok: false as const, op: intent, error: colProblemSentence(lang, r.problem, r.name) } });"));
  assert.ok(block.includes("return json({ col: { ok: true as const, op: intent, id: r.collection.id, name: r.collection.name, n: r.n } });"));
  assert.ok(block.split("\n").length < 16, "thin");
  // every server function is handed THIS shop
  assert.equal(count(block, "(shop.id,"), 5);
  // the queue is someone else's: the action knows nothing of it
  assert.ok(!action.includes("queueAdd"));
  // the post branch is the one it was (its first and last lines, and nothing about collections or queues in it)
  const post = action.slice(action.indexOf('if (intent === "post") {'));
  assert.ok(post.startsWith('if (intent === "post") {\n    if (!socialProviderEnabled()) return json({ error: tr(lang, "Social posting is coming online — check back shortly.") });'));
  assert.ok(!/col[A-Z]|[Cc]ollection|queueAdd/.test(post), "untouched by this feature");
  // collection changes DO reload the shelf (counts and chips); only the ad pack is spared that
  assert.ok(src.includes('const AD_PACK_INTENTS = new Set(["adsize", "adsrt", "adcopy", "share", "unshare"]);'));
});

test("THE FILTER: ?col= is one of the shop's collections, joins the search and the When window, and narrows every count", () => {
  // read from the address and believed only when it is one of this shop's collections
  assert.ok(loader.includes("const collections = await listCollections(shop.id);"));
  assert.ok(loader.includes('const colParam = new URL(request.url).searchParams.get("col") || "";'));
  assert.ok(loader.includes('const col = collections.some((c) => c.id === colParam) ? colParam : "";'));
  assert.ok(loader.includes("const colWhere = col ? { collectionItems: { some: { collectionId: col } } } : {};"));
  // it rides in the same where as the search…
  assert.ok(loader.includes('const titleWhere = { ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}), ...colWhere };'));
  // …which every count and every shelf query applies: the all-time per-tab totals, the stills total, the two
  // reads the When chips are counted from, the newest of each kind, and the stills shelf
  assert.equal(count(loader, "...titleWhere"), 6);
  assert.ok(loader.includes('where: { shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD", "AUDIO", "BLOG_POST"] }, NOT: galleryWhere, ...titleWhere },\n    _count: { _all: true },'));
  assert.ok(loader.includes('totals.stills = await db.asset.count({ where: { shopId: shop.id, type: "IMAGE_AD", ...galleryWhere, ...titleWhere } });'));
  assert.ok(loader.includes("where: { shopId: shop.id, type, NOT: galleryWhere, ...titleWhere, ...whenWhere },"));
  assert.ok(loader.includes('where: { shopId: shop.id, type: "IMAGE_AD", ...galleryWhere, ...titleWhere, ...whenWhere },'));
  assert.equal(count(loader, "...titleWhere, createdAt: { gte: monthSince } }"), 2);
  // and the page is told which is open, and what there is to choose from
  assert.ok(loader.includes("    collections,\n    col,\n"));
  assert.ok(loader.includes("cols: colsOf[a.id] || [],"));
  assert.ok(loader.includes("const colsOf = collections.length ? await collectionIdsByAsset(shop.id, [...assets, ...stills].map((a) => a.id)) : {};"));
  // a piece still being made is on no collection: no cooking tile and no cooking count while one is open
  assert.ok(src.includes("const genCards = colOpen ? [] : cookingCards.filter("));
  assert.ok(src.includes("const failCards = colOpen ? [] : cookingCards.filter("));
  assert.ok(src.includes('+ (colOpen ? 0 : cookingCards.filter((j) => j.kind === k && j.status === "generating").length);'));

  // EVERY LINK THAT RELOADS THE SHELF KEEPS IT — and a collection link keeps the rest
  assert.ok(src.includes("const colOpen = collections.find((c) => c.id === col) || null;"));
  assert.ok(src.includes("const colQ = colOpen ? `&col=${encodeURIComponent(colOpen.id)}` : \"\";"));
  assert.ok(src.includes('const colHref = (id: string) => `?tab=${tab}${whenQ}${q ? `&q=${encodeURIComponent(q)}` : ""}${id ? `&col=${encodeURIComponent(id)}` : ""}${isCreator ? "&section=creator" : ""}`;'));
  assert.ok(src.includes('const whenHref = (k: AWhen) => `?tab=${tab}${k !== "all" ? `&when=${k}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}${colQ}${isCreator ? "&section=creator" : ""}`;'));
  assert.ok(src.includes('{colOpen && <input type="hidden" name="col" value={colOpen.id} />}'), "a search keeps it (a GET form's fields ARE the address)");
  assert.equal(count(src, 'to={`?tab=${tab}${whenQ}${colQ}${isCreator ? "&section=creator" : ""}`}'), 2, "clearing the search keeps it");
  assert.ok(src.includes("&tab=${tab}${whenQ}${q ? `&q=${encodeURIComponent(q)}` : \"\"}${colQ}${isCreator"), "Show older keeps it");
  // what those links write, the loader reads back — with the others intact
  const colHref = (tab: string, whenQ: string, q: string, id: string, isCreator: boolean) => `?tab=${tab}${whenQ}${q ? `&q=${encodeURIComponent(q)}` : ""}${id ? `&col=${encodeURIComponent(id)}` : ""}${isCreator ? "&section=creator" : ""}`;
  const href = colHref("image", "&when=week", "red mug", "cm1col0000001", true);
  assert.equal(href, "?tab=image&when=week&q=red%20mug&col=cm1col0000001&section=creator");
  const p = new URLSearchParams(href);
  assert.deepEqual([p.get("tab"), p.get("when"), p.get("q"), p.get("col"), p.get("section")], ["image", "week", "red mug", "cm1col0000001", "creator"]);
  assert.equal(colHref("video", "&when=today", "x", "", false), "?tab=video&when=today&q=x", "clearing it keeps the window and the search");
  // what the loader makes of an id that is not the shop's: no filter
  const believe = (param: string, mine: string[]) => (mine.some((id) => id === param) ? param : "");
  assert.equal(believe("cm1col0000001", ["cm1col0000001"]), "cm1col0000001");
  assert.equal(believe("cm1someoneelse", ["cm1col0000001"]), "");
  assert.equal(believe("", []), "");
});

test("THE MENU, THE OPEN COLLECTION, AND ITS EMPTY STATE", () => {
  // the menu sits with the presenter and product menus, built the same way (a chip over a native select)
  const pick = src.slice(src.indexOf('<div className="wa-filters wa-pick"'), src.indexOf("{/* Select mode: tap pieces, then Keep or Delete them together */}"));
  assert.ok(src.includes("{(whoOpts.length > 1 || prodOpts.length > 1 || who || prod || collections.length > 0) && ("));
  assert.ok(pick.indexOf('<Ico n="presenter" />') < pick.indexOf('<Ico n="box" />') && pick.indexOf('<Ico n="box" />') < pick.indexOf('<Ico n="bookcase" />'), "presenter, product, collection");
  assert.ok(pick.includes('<label className={`wa-filterchip wa-select${colOpen ? " on" : ""}`}>'));
  assert.ok(pick.includes("{collections.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.count}</option>)}"), "each with its count");
  assert.ok(pick.indexOf("{collections.map((c) =>") < pick.indexOf('<option value="__new">{t("New collection…")}</option>'), "ending with New collection…");
  assert.ok(pick.includes('onChange={(e) => { const v = e.target.value; if (v === "__new") askColForm("filter"); else openCol(v); }}>'));
  // choosing one is a new shelf, like a When chip: it ends a selection
  assert.ok(src.includes("const openCol = (id: string) => { endSelect(); setColForm(null); setArmColDel(false); navigate(colHref(id), { preventScrollReset: true }); };"));
  // the open one is named ONCE beside the chooser — not again as a chip in the search row (it was, on the
  // first day, and the page named it three times). The menu's first entry and the manage line leave it.
  const bar = src.slice(src.indexOf('<div className="wa-bar">'), src.indexOf('<div className="wa-filters wa-when"'));
  assert.equal(count(bar, '<span className="wa-qchip">'), 1, "the search's chip only");
  assert.ok(!bar.includes("{colOpen.name}"));
  assert.ok(pick.includes('<option value="">{colOpen ? t("Show all") : t("Collections")}</option>'));
  assert.ok(src.includes('<Link to={colHref("")} preventScrollReset className="wa-linkbtn" onClick={() => { endSelect(); setColForm(null); setArmColDel(false); }}>{t("Show all")}</Link>'));
  // MANAGE: Rename, and Delete armed — the second tap deletes, and the line says the pieces stay
  assert.ok(src.includes('{armColDel ? t("Tap again to delete it — the pieces stay") : t("Delete collection")}'));
  const del = src.slice(src.indexOf("const deleteCol = () => {"), src.indexOf("useEffect(() => {", src.indexOf("const deleteCol = () => {")));
  assert.ok(del.includes("if (!armColDel) { setArmColDel(true); return; }"));
  assert.ok(del.includes('colSubmit({ intent: "colDelete", collectionId: colOpen.id });'));
  assert.ok(src.includes("useEffect(() => { if (!armColDel) return; const tm = setTimeout(() => setArmColDel(false), 4000); return () => clearTimeout(tm); }, [armColDel]);"), "the arm clears itself, as the page's other deletes do");
  assert.ok(src.includes('onSave={(name) => colSubmit({ intent: "colRename", collectionId: colOpen.id, name })}'));
  // after a delete the address loses the collection (the shelf goes back to everything)
  assert.ok(src.includes('if (r.op === "colDelete") { setSelecting(false); setPicked(new Set()); navigate(colHref(""), { preventScrollReset: true }); }'));
  // an open collection with nothing of this kind: its own words and the way back — never "open the Studio"
  assert.ok(src.includes("const colEmpty = !!colOpen && !q && !whenEmpty && shelf.length === 0 && tabTotal === 0 && tabEver === 0;"));
  assert.ok(src.includes("{!whenEmpty && !colEmpty && !q && shelf.length === 0 && tabTotal === 0 && genCards.length === 0 && failCards.length === 0 && ("));
  assert.ok(src.includes('<Link to={colHref("")} preventScrollReset className="wb-btn wa-empty-cta" onClick={endSelect}>{t("Show all")}</Link>'));
});

test("ADD: from the select bar (the list, or a new name in the same step) and from an opened piece (chips with ✕, + Collection)", () => {
  const bar = src.slice(src.indexOf('<div className="wa-bulk" ref={bulkRef}'), src.lastIndexOf("</div>\n  );"));
  assert.ok(bar.length > 1000);
  // Keep / Delete / Download are where they were; the new ones come after Delete, before Done
  const at = (s: string) => bar.indexOf(s);
  assert.ok(at('className="wa-bulk-btn keep"') < at('className="wa-bulk-btn queue"'));
  assert.ok(at('className="wa-bulk-btn queue"') < at('t("Add to collection")'));
  assert.ok(at('t("Add to collection")') < at('className="wa-bulk-done"'));
  // ONE collection control: Add while none is open; Remove from collection while one is
  assert.ok(bar.includes('{colOpen ? (\n            <button type="button" className="wa-bulk-btn" disabled={!picked.size || colBusy} onClick={removePicked}><Ico n="x" /> {t("Remove from collection")}</button>'));
  assert.ok(bar.includes('onChange={(e) => { const v = e.target.value; if (v === "__new") askColForm("bulk"); else if (v) addPickedTo({ collectionId: v }); }}>'));
  assert.ok(bar.includes('onSave={(name) => addPickedTo({ newName: name })}'), "a new name adds in the same step");
  assert.ok(src.includes('colSubmit({ intent: "colAdd", ...target, assetIds: ids.join(",") });'));
  assert.ok(src.includes('colSubmit({ intent: "colRemove", collectionId: colOpen.id, assetIds: ids.join(",") });'));
  // what it says when done: how many were added (a piece already there is not counted)
  const { colSay } = routePart.fns;
  assert.equal(fill(colSay("colAdd", 3), { n: 3, name: "Summer launch" }), "3 added to “Summer launch”.");
  assert.equal(fill(colSay("colAdd", 1), { n: 1, name: "Summer launch" }), "1 added to “Summer launch”.");
  assert.equal(fill(colSay("colAdd", 0), { n: 0, name: "Summer launch" }), "Already in “Summer launch”.");
  assert.equal(fill(colSay("colRemove", 2), { n: 2, name: "Gifts" }), "2 removed from “Gifts”.");
  assert.equal(fill(colSay("colRename", 0), { n: 0, name: "Gifts 2" }), "Renamed to “Gifts 2”.");
  assert.equal(fill(colSay("colDelete", 0), { n: 0, name: "Gifts" }), "“Gifts” deleted — its pieces are still in your Archive.");
  assert.ok(src.includes("setToast({ msg: t(colSay(r.op, r.n), { n: r.n, name: r.name }) });"));
  // a refused name keeps its box open with the sentence in it; anything else is said in the toast
  assert.ok(src.includes("if (!r.ok) { if (colForm) setColErr(r.error); else setToast({ msg: r.error }); return; }"));
  // THE OPENED PIECE: its collections from the freshest data, each a chip whose ✕ takes it off that one
  assert.ok(src.includes("const viewerCols = viewer ? (([...assets, ...stills].find((a) => a.id === viewer.id) ?? viewer).cols || [])"));
  assert.ok(src.includes('onClick={() => colSubmit({ intent: "colRemove", collectionId: c.id, assetIds: viewer.id })}><Ico n="x" size={12} /></button>'));
  assert.ok(src.includes('aria-label={t("Take it off “{name}”", { name: c.name })}'));
  // + Collection offers only the collections it is not on yet, then New collection…
  assert.ok(src.includes("{collections.filter((c) => !viewerCols.some((v) => v.id === c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}"));
  assert.ok(src.includes('onSave={(name) => colSubmit({ intent: "colAdd", newName: name, assetIds: viewer.id })}'));
  // one fetcher for all of it — the page's own actionData (posts, remixes) is never overwritten by a collection change
  assert.equal(count(src, "colFetcher.submit("), 1);
  assert.ok(!/submit\(\{ intent: "col/.test(src), "never through the page's own submit");
});

test("ADD TO QUEUE: exactly the call the Auto-post page expects, videos and image ads only, and what it says", () => {
  // THE CALL — a fetcher to /web/autopost, intent=queueAdd, assetIds comma-separated; nothing else
  assert.ok(src.includes("const queueFetcher = useFetcher<QueueAnswer>();"));
  assert.ok(src.includes('const queueIds = (ids: string[]) => queueFetcher.submit({ intent: "queueAdd", assetIds: ids.join(",") }, { method: "post", action: "/web/autopost" });'));
  assert.equal(count(src, "queueFetcher.submit("), 1);
  assert.equal(count(src, '"queueAdd"'), 1);
  assert.ok(src.includes('type QueueAnswer = { ok: true; queued: number; skipped: number; firstDueAt: string | null; lastDueAt: string | null } | { error: string };'));
  // the two buttons: in an opened video or image ad, beside Post…
  const viewer = src.slice(src.indexOf("{viewer && mounted ? createPortal("), src.indexOf("{/* Delete / retry confirmation toast."));
  const postAt = viewer.indexOf('onClick={() => startPost(viewer.id)}');
  const queueAt = viewer.indexOf("onClick={() => queueIds([viewer.id])}");
  assert.ok(postAt > 0 && queueAt > postAt && queueAt - postAt < 600, "right after Post to socials");
  assert.ok(viewer.includes('{(viewer.isVideo || viewer.type === "IMAGE_AD") && viewer.media && !viewer.expired && (\n                      <button type="button" className="wa-vbtn ghost" disabled={queueBusy} onClick={() => queueIds([viewer.id])}>'));
  // …and "Queue" in the select bar, for the picked videos and image ads (not on Music or Articles)
  assert.ok(src.includes('{tab !== "music" && tab !== "blog" && (\n            <button type="button" className="wa-bulk-btn queue" disabled={!picked.size || queueBusy} onClick={queuePicked}><Ico n="rocket" /> {t("Queue")}</button>'));
  assert.ok(src.includes("const ids = queueableIds(shelf.filter((a) => picked.has(a.id)));"));
  assert.ok(src.includes('if (!ids.length) { setToast({ msg: t("Only videos and image ads can be queued.") }); return; }'));
  const { queueableIds, queueSay, queueWhen } = routePart.fns;
  assert.deepEqual(queueableIds([
    { id: "v", type: "VIDEO_AD", media: "/renders/v.mp4" },
    { id: "i", type: "IMAGE_AD", media: "/renders/i.png" },
    { id: "gone", type: "VIDEO_AD", media: null },
    { id: "song", type: "AUDIO", media: "/renders/s.mp3" },
    { id: "post", type: "BLOG_POST", media: null },
  ]), ["v", "i"]);

  // WHAT IT SAYS — with the first post's time in the member's locale…
  const say = (a: QueueAnswer, when: string) => { const r = queueSay(a, when); return "error" in r ? `ERROR ${r.error}` : r.parts.map((x) => fill(x.s, x.p)).join(" "); };
  const ok = (queued: number, skipped: number, first: string | null): QueueAnswer => ({ ok: true, queued, skipped, firstDueAt: first, lastDueAt: first });
  assert.equal(say(ok(3, 0, "x"), "Tue 6:00 PM"), "3 added to your queue — the first posts Tue 6:00 PM.");
  assert.equal(say(ok(1, 0, "x"), "Tue 6:00 PM"), "1 added to your queue — it posts Tue 6:00 PM.");
  assert.equal(say(ok(2, 0, null), ""), "2 added to your queue.");
  assert.equal(say(ok(2, 1, "x"), "Wed 9:30 AM"), "2 added to your queue — the first posts Wed 9:30 AM. 1 was already in it or can't be posted.");
  assert.equal(say(ok(0, 4, null), ""), "Nothing new to queue — those are already in it or can't be posted.");
  // …and the endpoint's own sentence as it is
  assert.equal(say({ error: "Link your socials first on the Auto-post page." }, ""), "ERROR Link your socials first on the Auto-post page.");
  assert.ok(src.includes('if ("error" in said) { setToast({ msg: said.error, ms: 6000 }); return; }'));
  // the confirmation links to the queue
  assert.ok(src.includes('setToast({ msg: said.parts.map((x) => t(x.s, x.p)).join(" "), link: { to: "/web/autopost", label: t("See the queue") }, ms: 8000 });'));
  assert.ok(src.includes('{toast.link && <Link to={toast.link.to} className="wa-toast-link" onClick={() => setToast(null)}>{toast.link.label} →</Link>}'));
  assert.ok(src.includes('queueSay(a, !("error" in a) && a.firstDueAt ? queueWhen(a.firstDueAt, Date.now()) : "")'), "the browser's own locale (none given)");

  // THE TIME: weekday and time within the week ahead, the date further out
  const now = Date.UTC(2026, 10, 22, 12, 0);
  const soon = queueWhen(new Date(now + 2 * 86_400_000).toISOString(), now, "en-US");
  assert.match(soon, /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}:\d{2}\s(AM|PM)$/, soon);
  const later = queueWhen(new Date(now + 10 * 86_400_000).toISOString(), now, "en-US");
  assert.match(later, /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{1,2}:\d{2}\s(AM|PM)$/, later);
  assert.equal(queueWhen("not a time", now, "en-US"), "", "a time nothing can be made of is left out, not \"Invalid Date\"");
  assert.notEqual(queueWhen(new Date(now + 86_400_000).toISOString(), now, "de-DE"), queueWhen(new Date(now + 86_400_000).toISOString(), now, "en-US"), "the locale is honoured");
});

test("ON A PHONE: every new control is 44px to the thumb, and the native picker is what a tap opens", () => {
  const cssAt = src.indexOf("const WA_CSS = `");
  const css = src.slice(cssAt, src.indexOf("`;", cssAt));
  // the select laid invisibly over the chip / bar button, 16px so iOS does not zoom when it opens
  assert.ok(css.includes(".wa-pickover select{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;font-size:16px;border:0;margin:0;padding:0;}"));
  const phoneAt = css.indexOf("@media(max-width:640px){\n  .wa-colchip,.wa-colmanage .wa-linkbtn,.wa-colform input,.wa-colform-go,.wa-colform-x,.wa-toast-link{min-height:44px;}");
  assert.ok(phoneAt > 0);
  const phone = css.slice(phoneAt, css.indexOf("\n}", phoneAt));
  // a chip's ✕ keeps its 22px look with a hit box out to 44
  assert.ok(css.includes(".wa-colchip button{position:relative;display:inline-grid;place-items:center;width:22px;height:22px;"));
  assert.ok(phone.includes('.wa-colchip button::before{content:"";position:absolute;inset:-11px;}'));
  assert.ok(22 + 2 * 11 >= 44);
  // the new bar buttons are .wa-bulk-btn, which the page already makes 44px and lets share a row on a phone
  assert.ok(css.includes(".wa-bulk-btn,.wa-bulk-done{flex:1 1 auto;justify-content:center;min-height:44px;}"));
  // the menu is a .wa-filterchip — 44px on a phone by the page's own rule
  assert.ok(css.includes("@media(max-width:640px){.wa-filterchip{min-height:44px;box-sizing:border-box;}}"));
  // nothing of this sits inside the page's 44px floor block, which tests/archive-fixes.test.ts cuts out by position
  const floorAt = css.indexOf("44px tap-target floor");
  assert.ok(phoneAt > css.indexOf("@media(max-width:620px){", floorAt));
});

test("every new word goes through t() — and these are all of them", () => {
  // The dictionary (app/lib/ui-i18n-dict.ts) is someone else's file: these are reported for translation.
  const NEW_PAGE = [
    "Collections", "New collection…", "Collection name", "Create", "Rename", "Delete collection",
    "Tap again to delete it — the pieces stay", "1 piece in “{name}”.", "{n} pieces in “{name}”.",
    "Nothing of this kind in “{name}” yet. Show all your pieces, tap Select, pick some, then Add to collection.",
    "Filter by presenter, product or collection", "Collection", "Add to collection", "Take it off “{name}”",
    "Remove from collection", "Queue", "Add to queue", "Adding…", "Only videos and image ads can be queued.", "See the queue",
  ];
  for (const s of NEW_PAGE) assert.ok(src.includes(`t("${s}"`), s);
  // the ones held as data are handed to t() where they are shown
  const { colSay, queueSay } = routePart.fns;
  const said = new Set<string>([
    ...["colAdd", "colRemove", "colRename", "colDelete", "colCreate"].flatMap((op) => [0, 1, 2].map((n) => colSay(op, n))),
    ...[[1, 0, "w"], [2, 0, "w"], [1, 0, ""], [2, 0, ""], [2, 1, "w"], [2, 2, "w"], [0, 1, ""]].flatMap(([q, s, w]) => {
      const r = queueSay({ ok: true, queued: q as number, skipped: s as number, firstDueAt: null, lastDueAt: null }, w as string);
      return "parts" in r ? r.parts.map((p) => p.s) : [];
    }),
  ]);
  assert.deepEqual([...said].sort(), [
    "1 added to your queue — it posts {when}.", "1 added to your queue.", "1 added to “{name}”.", "1 removed from “{name}”.",
    "1 was already in it or can't be posted.", "Already in “{name}”.", "Nothing new to queue — those are already in it or can't be posted.",
    "Renamed to “{name}”.", "{n} added to your queue — the first posts {when}.", "{n} added to your queue.", "{n} added to “{name}”.",
    "{n} removed from “{name}”.", "{n} were already in it or can't be posted.", "“{name}” deleted — its pieces are still in your Archive.", "“{name}” is ready.",
  ].sort());
  assert.ok(src.includes("t(colSay(r.op, r.n), { n: r.n, name: r.name })"));
  assert.ok(src.includes("said.parts.map((x) => t(x.s, x.p))"));
  // the action's sentences go through tr()
  for (const s of ["Give the collection a name.", "Keep the name to 40 characters or fewer.", "That collection is gone — refresh and try again.", "Those pieces are gone — refresh and try again."]) {
    assert.ok(src.includes(`tr(lang, "${s}")`), s);
  }
});
