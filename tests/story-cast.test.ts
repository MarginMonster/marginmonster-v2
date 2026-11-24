/* THE STORY'S OWN CAST — a character a story invents is the same person in every scene, and is shown.
 *
 * "The Patience of Bread" (made as a customer, 2026-11-23): the old watchman was three different men in
 * six pictures — tall and clean-faced with a lantern, then balding in a brown jacket, then grey-haired
 * with a moustache. The story's invented characters shared ONE sheet, and the look that checks a picture
 * only ever asked about the cast the MAKER picked.
 *
 * Now each invented character gets one portrait; that portrait is its reference in every scene it is in;
 * it is looked for in every picture kept; and the storyboard opens on the story's cast ("Starring").
 * The portraits travel between the storyboard's calls as a token the page hands back unread, are kept on
 * the finished story, and come back when it is edited or continued as the next episode.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NOTHING_WRITTEN, PORTRAIT_ASPECT, STORY_CAST_MAX, castCardsOf, castEntry, castStillIn, castToken, portraitPrompt, readCastToken, sameCharacter } from "../app/lib/story-picture.ts";
import { entryName } from "../app/lib/narrated-core.ts";
import { storyToEditFrom } from "../app/lib/story-edit.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");

const WALTER = "Walter, an elderly night watchman with a grey moustache, a flat cap and a long brown coat";
const MARA = "MARA (a young baker with flour on her apron and a red headscarf)";
const PIP = "Pip — a small scruffy terrier with one white ear";

test("a cast-list entry is a character: the name it starts with, and the look after it", () => {
  assert.deepEqual(castEntry(WALTER), { name: "Walter", look: "an elderly night watchman with a grey moustache, a flat cap and a long brown coat" });
  assert.deepEqual(castEntry(MARA), { name: "MARA", look: "a young baker with flour on her apron and a red headscarf" });
  assert.deepEqual(castEntry(PIP), { name: "Pip", look: "a small scruffy terrier with one white ear" });
  assert.deepEqual(castEntry("Old Tom: the lighthouse keeper"), { name: "Old Tom", look: "the lighthouse keeper" });
  assert.deepEqual(castEntry("  Nessa  "), { name: "Nessa", look: "" });
  assert.deepEqual(castEntry(""), { name: "", look: "" });
  // THE SAME NAME RULE the scenes are matched by — or a portrait would never be found for its own entry
  for (const e of [WALTER, MARA, PIP, "Old Tom: the lighthouse keeper", "Nessa"]) assert.equal(castEntry(e).name, entryName(e), e);
  assert.ok(sameCharacter("walter", "Walter ") && !sameCharacter("Walter", "Walt") && !sameCharacter("", ""));
});

test("the portrait asks for ONE character, whole, on a plain ground, in the story's own style", () => {
  const p = portraitPrompt(WALTER, "moody painterly storybook illustration", "Wholesome, child-safe, G-rated, bright and friendly. ");
  assert.ok(p.startsWith("Wholesome, child-safe, G-rated, bright and friendly. moody painterly storybook illustration. A character portrait of Walter, an elderly night watchman"));
  assert.match(p, /this ONE character alone, the whole body from head to feet, standing, turned a little toward the viewer, the face clearly seen, on a plain neutral background\./);
  assert.match(p, /In the exact art style of the story\./);
  assert.ok(p.endsWith(NOTHING_WRITTEN), "a portrait has no name plate");
  assert.ok(portraitPrompt("x".repeat(900), "s").length < 900, "a runaway entry is cut");
  assert.equal(PORTRAIT_ASPECT, "9:16", "a standing figure fills a tall frame, whatever shape the story is");
});

test("the token carries the portraits — and only pictures on our own renders disk", () => {
  const cards = [
    { name: "Walter", look: "an elderly night watchman", img: "/renders/ab12cd34ef56.jpg" },
    { name: "Mara", look: "a young baker", img: "https://easymodeapp.com/renders/0011223344aa.jpg?v=2" },
  ];
  const token = castToken(cards);
  assert.equal(token, JSON.stringify({ v: 2, c: [{ n: "Walter", l: "an elderly night watchman", i: "/renders/ab12cd34ef56.jpg" }, { n: "Mara", l: "a young baker", i: "/renders/0011223344aa.jpg" }] }));
  assert.deepEqual(readCastToken(token), { refs: [{ name: "Walter", look: "an elderly night watchman", img: "/renders/ab12cd34ef56.jpg" }, { name: "Mara", look: "a young baker", img: "/renders/0011223344aa.jpg" }], sheet: null });
  // what is NOT a portrait of ours never gets in, written or read
  const bad = [
    { name: "A", look: "", img: "https://evil.example/x.jpg" },
    { name: "B", look: "", img: "/renders/../secret.jpg" },
    { name: "C", look: "", img: "/renders/pic.jpg.n.jpg" },
    { name: "D", look: "", img: "/avatars/tom.png" },
    { name: "", look: "", img: "/renders/ok.jpg" },
  ];
  assert.equal(castToken(bad), "", "nothing left → no token at all");
  assert.deepEqual(readCastToken(JSON.stringify({ v: 2, c: [{ n: "A", l: "", i: "https://evil.example/x.jpg" }, { n: "B", l: "", i: "/renders/../secret.jpg" }, { n: "W", l: 4, i: "/renders/w.png" }] })).refs, [{ name: "W", look: "", img: "/renders/w.png" }]);
  // no more than a story's few, and nobody twice
  const many = Array.from({ length: 9 }, (_, k) => ({ name: `N${k}`, look: "", img: `/renders/p${k}.jpg` }));
  assert.equal(readCastToken(castToken(many)).refs.length, STORY_CAST_MAX);
  assert.equal(readCastToken(JSON.stringify({ v: 2, c: [{ n: "Walter", l: "", i: "/renders/a.jpg" }, { n: "walter", l: "", i: "/renders/b.jpg" }] })).refs.length, 1);
  // a long look is cut, so the token always fits the form field it rides in (4,000)
  const fat = Array.from({ length: 4 }, (_, k) => ({ name: "N".repeat(60) + k, look: "l".repeat(900), img: `/renders/${"a".repeat(40)}${k}.jpg` }));
  assert.ok(castToken(fat).length < 1400, `a full token is ${castToken(fat).length} characters`);
  // nothing, and nonsense
  for (const t of ["", null, undefined, "{", "{}", "[1,2]", JSON.stringify({ v: 1, c: [] }), "not a token"]) assert.deepEqual(readCastToken(t as string), { refs: [], sheet: null }, String(t));
  // a storyboard opened BEFORE this still hands back the address of the one sheet — used the way it was
  assert.deepEqual(readCastToken("https://easymodeapp.com/renders/sheet123.jpg"), { refs: [], sheet: "https://easymodeapp.com/renders/sheet123.jpg" });
  assert.deepEqual(readCastToken("/renders/sheet123.jpg"), { refs: [], sheet: "/renders/sheet123.jpg" });
});

test("a finished story keeps its cast; only who is still in the story is carried on", () => {
  const cards = [{ name: "Walter", look: "an elderly night watchman", img: "/renders/w.jpg" }, { name: "Mara", look: "a young baker", img: "/renders/m.jpg" }];
  assert.deepEqual(castCardsOf({ castCards: cards }), cards);
  assert.deepEqual(castCardsOf(JSON.stringify({ kind: "narrated", castCards: cards })), cards);
  assert.deepEqual(castCardsOf({ castCards: [{ name: "X", img: "https://evil.example/x.jpg" }, 7, null] }), []);
  for (const m of [null, undefined, "", "{", 4, [], { castCards: "no" }]) assert.deepEqual(castCardsOf(m), []);
  // the next episode has Walter and a newcomer: Mara's portrait is not drawn from, and not shown
  assert.deepEqual(castStillIn(cards, [WALTER, "Odile, a travelling clockmaker"]).map((c) => c.name), ["Walter"]);
  assert.deepEqual(castStillIn(cards, []), []);
});

test("a story opened to be edited comes back with its cast", () => {
  const meta = JSON.stringify({ kind: "narrated", template: "testmovie", aspect: "9:16", captions: "bold", narrator: "English_Trustworth_Man", castCards: [{ name: "Walter", look: "an elderly night watchman", img: "/renders/w.jpg" }, { name: "Gone", look: "someone the story no longer has", img: "/renders/g.jpg" }] });
  const body = JSON.stringify({ prompt: "a baker and a watchman", treatment: { title: "The Patience of Bread", musicMood: "warm", cast: [WALTER, MARA], scenes: [1, 2, 3].map((n) => ({ visual: `Walter walks past the bakery, part ${n}`, caption: `Line ${n} of the story.` })) } });
  const st = storyToEditFrom({ id: "a1", title: "Short Story — The Patience of Bread", metaJson: meta, bodyJson: body }, ["/renders/1.jpg", "/renders/2.jpg", "/renders/3.jpg"]);
  assert.ok(st);
  assert.deepEqual(st!.ownCast, [{ name: "Walter", look: "an elderly night watchman", img: "/renders/w.jpg" }]);
  assert.deepEqual(readCastToken(st!.castRef).refs, st!.ownCast);
  // a story made before stories kept a cast: nothing, and no token
  const old = storyToEditFrom({ id: "a2", title: "t", metaJson: JSON.stringify({ kind: "narrated", template: "testmovie" }), bodyJson: body }, null);
  assert.deepEqual([old!.ownCast, old!.castRef], [[], ""]);
});

test("where the pictures are drawn: a portrait each, the reference in every scene, looked for in every picture", () => {
  const nar = read("app", "lib", "narrated-story.server.ts");
  const fn = nar.slice(nar.indexOf("export async function narratedSceneSeeds("), nar.indexOf("/** The narrator reads the whole story."));
  // who needs one: an invented character a scene being drawn names, that has none yet
  assert.ok(fn.includes(".filter((e) => who.some((w) => w.others.includes(e)) && !!castEntry(e).name && !cards.some((c) => sameCharacter(c.name, castEntry(e).name)))"));
  assert.ok(fn.includes(".slice(0, Math.max(0, STORY_CAST_MAX - cards.length));"));
  assert.ok(fn.includes("const drawn = await Promise.all(need.map(async (e) => ({ e, img: await drawScene(portraitPrompt(e, tmpl.sceneHint, safe), [], PORTRAIT_ASPECT) })));"), "drawn together, tall, from the words alone");
  assert.ok(fn.includes("for (const d of drawn) if (d.img) cards.push({ ...castEntry(d.e), img: d.img });"), "a portrait that could not be drawn is simply not a card");
  // what comes in: only who this story still has, and only a file that is still there
  assert.ok(fn.includes("const cards: StoryCastRef[] = castStillIn(carried.refs, others).filter((c) => fs.existsSync(path.join(RENDERS(), path.basename(c.img))));"));
  // in a scene: the maker's cast first, then the story's own — three reference pictures at most
  assert.ok(fn.includes("const own = sheet ? [] : who[k].others.map(cardFor).filter((c): c is StoryCastRef => !!c).slice(0, Math.max(0, 3 - chosen.length));"));
  assert.ok(fn.includes("const here: Array<{ name: string; look?: string; faceUrl?: string | null }> = [...chosen, ...own.map((c) => ({ name: c.name, look: c.look, faceUrl: c.img }))];"));
  assert.ok(fn.includes("here.forEach((c, n) => notes.push(`${c.name} is the character in reference image ${n + 1}${c.look ? ` (${c.look.slice(0, 160)})` : \"\"}.`));"));
  // …a character with no portrait is still drawn, from its words
  assert.ok(fn.includes("const unpictured = sheet ? [] : who[k].others.filter((e) => !own.some((c) => c === cardFor(e)));"));
  assert.ok(fn.includes("if (unpictured.length) notes.push(`In this picture: ${unpictured.map((e) => e.slice(0, 200)).join(\"; and \")}.`);"));
  // THE LOOK now asks about them too — the question and the fix are the ones the picked cast always had
  assert.ok(fn.includes("const castPics = here.map((c) => abs(c.faceUrl)).filter((u): u is string => !!u);"));
  assert.ok(fn.includes("castPics.length ? anthropicVision(storyCastPrompt(castPics.length), [pic, ...castPics], { maxTokens: 500, model: \"claude-sonnet-4-6\" }) : Promise.resolve(\"\"),"));
  assert.ok(fn.includes("fix = storyFix(seenAs!, here.map((c) => c.name));"));
  // what goes back: the pictures, the token, and the cards to show (an older storyboard keeps its sheet)
  assert.ok(fn.includes("return { sceneImgs: out.map((u) => abs(u)), castRef: carried.sheet || castToken(cards) || null, castCards: cards };"));
  assert.ok(fn.includes("const sheet = who[k].others.length && sheetRef ? sheetRef : null;"));
});

test("the cast rides with the story: storyboard → job → the finished piece", () => {
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("let storyCastRef = resume.ckCast || opts.castRef || \"\";"), "a restart keeps the cast it had drawn");
  assert.ok(nar.includes("if (drawn.castRef) storyCastRef = drawn.castRef;"));
  assert.ok(nar.includes("await ckpt({ ckImages: JSON.stringify(imgs), ...(storyCastRef ? { ckCast: storyCastRef } : {}) });"));
  assert.ok(nar.includes("...(readCastToken(storyCastRef).refs.length ? { castCards: readCastToken(storyCastRef).refs } : {}),"), "the piece says who is in it");
  const jq = read("app", "lib", "job-queue.server.ts");
  assert.ok(jq.includes("castRef: typeof payload.filmCastRef === \"string\" ? payload.filmCastRef : undefined,"));
  assert.ok(jq.includes("ckCast: payload.ckCast as string | undefined,"));
  const page = read("app", "routes", "web.film.tsx");
  // the action never trusts the page's token: it is read and written again, and only then queued
  assert.ok(page.includes("const castRefIn = (name: string): string => castToken(readCastToken(((form.get(name) as string) || \"\").trim().slice(0, 4000)).refs);"));
  assert.ok(page.includes("...(narrated && (castRefIn(\"filmCastRef\") || seriesCastRef) ? { filmCastRef: castRefIn(\"filmCastRef\") || seriesCastRef } : {}),"));
  assert.ok(page.includes("{narrated && seeds?.castRef && <input type=\"hidden\" name=\"filmCastRef\" value={seeds.castRef} />}"));
  // drawing them all: the cards come back with the pictures; the next episode opens with the last one's faces
  assert.ok(page.includes("const r = await narratedSceneSeeds({ template: tmpl.key, treatment: tr0, cast: storyCast, aspect: filmAspect, castRef: seriesCastRef || null });"));
  assert.ok(page.includes("return json({ ok: true, sceneImgs: r.sceneImgs, treatment: tr0, propForScene: {}, castRef: r.castRef, castCards: r.castCards });"));
  assert.ok(page.includes("const seriesCastRef = seriesHit?.ownCast || \"\";"));
  // re-drawing one: the same portraits go in, and a character first seen there comes back with its own
  assert.ok(page.includes("ownCast = { castRef: r.castRef, castCards: r.castCards };"));
  assert.ok(page.includes("const cast = typeof rd.castRef === \"string\" && rd.castRef && Array.isArray(rd.castCards) ? { castRef: rd.castRef, castCards: rd.castCards } : null;"));
  assert.ok(page.includes("setSeeds((prev) => (prev ? { ...prev, ...(cast || {}),"));
  // an edited story opens with the cast it was made with
  assert.ok(page.includes("castRef: st.castRef || null, castRefs: [], faults: [], checks: [], castCards: st.ownCast || [] });"));
});

test("the storyboard opens on the story's cast — the maker's picks and the story's own, one row", () => {
  const page = read("app", "routes", "web.film.tsx");
  assert.ok(page.includes("{narrated && seeds && (() => {"));
  assert.ok(page.includes("...pickedCast.map((r) => ({ name: r.name, look: r.kind && r.kind !== \"person\" ? (r.look || \"\") : \"\", img: r.img })),"));
  assert.ok(page.includes("...own.filter((c) => !pickedCast.some((r) => nameTok(r.name) === nameTok(c.name))),"), "nobody is shown twice");
  assert.ok(page.includes("if (!stars.length) return null;"), "a story with nobody in it has no row");
  assert.ok(page.includes("<div className=\"mm-stars-h\"><b>{t(\"Starring\")}</b>{own.length > 0 && <span>{t(\"They look like this in every scene.\")}</span>}</div>"));
  assert.ok(page.includes("<button type=\"button\" key={`${c.name}|${c.img}`} className=\"mm-star\" onClick={() => setZoomImg(c.img)} title={c.look ? `${c.name} — ${c.look}` : c.name}>"), "a face opens whole");
  // a phone: the row scrolls sideways inside itself, a face is a finger wide
  assert.ok(page.includes(".mm-stars-row{display:flex;gap:10px;overflow-x:auto;"));
  assert.ok(page.includes(".mm-star{flex:0 0 108px;width:108px;min-width:0;"));
  assert.ok(page.includes(".mm-star img{display:block;width:108px;height:144px;object-fit:cover;object-position:center top;"), "a full-length portrait is shown from the head down");
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Starring", "They look like this in every scene."]) assert.equal(dict.split(`${JSON.stringify(k)}:`).length - 1, 5, k);
});
