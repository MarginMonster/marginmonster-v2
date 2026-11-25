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
import { NOTHING_WRITTEN, PORTRAIT_ASPECT, STORY_CAST_MAX, STORY_LADDER, STORY_LAST_MODEL, STORY_MODEL, STORY_SECOND_MODEL, castCardsOf, castEntry, castStillIn, castToken, portraitPrompt, readCastToken, sameCharacter, storyPictureInput, storyStars } from "../app/lib/story-picture.ts";
import { entryName } from "../app/lib/narrated-core.ts";
import { storyToEditFrom } from "../app/lib/story-edit.ts";
import { nextEpisodeCards } from "../app/lib/film-series.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// (a checkout with CRLF line endings must read the same as one with LF: some pins below span two lines)
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

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
  assert.deepEqual(readCastToken(token), { refs: [{ name: "Walter", look: "an elderly night watchman", img: "/renders/ab12cd34ef56.jpg" }, { name: "Mara", look: "a young baker", img: "/renders/0011223344aa.jpg" }], sheet: null, places: [] });
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
  for (const t of ["", null, undefined, "{", "{}", "[1,2]", JSON.stringify({ v: 1, c: [] }), "not a token"]) assert.deepEqual(readCastToken(t as string), { refs: [], sheet: null, places: [] }, String(t));
  // a storyboard opened BEFORE this still hands back the address of the one sheet — used the way it was
  assert.deepEqual(readCastToken("https://easymodeapp.com/renders/sheet123.jpg"), { refs: [], sheet: "https://easymodeapp.com/renders/sheet123.jpg", places: [] });
  assert.deepEqual(readCastToken("/renders/sheet123.jpg"), { refs: [], sheet: "/renders/sheet123.jpg", places: [] });
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
  assert.ok(fn.includes("const here: Array<{ name: string; look?: string; faceUrl?: string | null; kind?: \"person\" | \"cartoon\" | \"monster\" }> = [...chosen, ...own.map((c) => ({ name: c.name, look: c.look, faceUrl: c.img, kind: characterKind(c.name, c.look) }))];"), "each with what KIND of somebody they are (a creature is told to stay one) — read from its name as well as its look");
  assert.ok(fn.includes("here.forEach((c, n) => notes.push(`${c.name} is the character in reference image ${n + 1}${c.look ? ` (${c.look.slice(0, 160)})` : \"\"}.`));"));
  // …a character with no portrait is still drawn, from its words
  assert.ok(fn.includes("const unpictured = sheet ? [] : who[k].others.filter((e) => !own.some((c) => c === cardFor(e)));"));
  assert.ok(fn.includes("if (unpictured.length) notes.push(`In this picture: ${unpictured.map((e) => e.slice(0, 200)).join(\"; and \")}.`);"));
  // THE LOOK now asks about them too — the question and the fix are the ones the picked cast always had
  assert.ok(fn.includes("const castPics = here.map((c) => abs(c.faceUrl)).filter((u): u is string => !!u);"));
  assert.ok(fn.includes("castPics.length ? anthropicVision(storyCastPrompt(castPics.length), [pic, ...castPics], { maxTokens: 500, model: \"claude-sonnet-4-6\" }) : Promise.resolve(\"\"),"));
  assert.ok(fn.includes("fix = storyFix(seenAs!, here.map((c) => c.name), here.map((c) => c.kind || \"person\"));"), "the fix says what a creature must be");
  // what goes back: the pictures, the token, and the cards to show (an older storyboard keeps its sheet)
  assert.ok(fn.includes("return { sceneImgs: out.map((u) => abs(u)), castRef: carried.sheet || castToken(cards, placeCards) || null, castCards: cards, placeCards, sceneFaults: faultsOut, sceneChecks: checksOut };"), "…and the story's places travel in the same token (tests/story-places.test.ts)");
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
  assert.ok(page.includes("const castRefIn = (name: string): string => { const t = readCastToken(((form.get(name) as string) || \"\").trim().slice(0, 4000)); return castToken(t.refs, t.places); };"));
  assert.ok(page.includes("...(narrated && (castRefIn(\"filmCastRef\") || seriesCastRef) ? { filmCastRef: castRefIn(\"filmCastRef\") || seriesCastRef } : {}),"));
  assert.ok(page.includes("{narrated && seeds?.castRef && <input type=\"hidden\" name=\"filmCastRef\" value={seeds.castRef} />}"));
  // drawing them all: the cards come back with the pictures; the next episode opens with the last one's faces
  assert.ok(page.includes("const r = await narratedSceneSeeds({ template: tmpl.key, treatment: tr0, cast: storyCast, aspect: filmAspect, castRef: seriesCastRef || null });"));
  assert.ok(page.includes("return json({ ok: true, sceneImgs: r.sceneImgs, sceneFaults: r.sceneFaults, sceneChecks: r.sceneChecks, treatment: tr0, propForScene: {}, castRef: r.castRef, castCards: r.castCards });"));
  assert.ok(page.includes("const seriesCastRef = seriesHit?.ownCast || \"\";"));
  // re-drawing one: the same portraits go in, and a character first seen there comes back with its own
  assert.ok(page.includes("ownCast = { castRef: r.castRef, castCards: r.castCards };"));
  assert.ok(page.includes("const cast = typeof rd.castRef === \"string\" && rd.castRef && Array.isArray(rd.castCards) ? { castRef: rd.castRef, castCards: rd.castCards } : null;"));
  assert.ok(page.includes("setSeeds((prev) => (prev ? { ...prev, ...(cast || {}),"));
  // an edited story opens with the cast it was made with
  assert.ok(page.includes("castRef: st.castRef || null, castRefs: [], faults: [], checks: [], castCards: st.ownCast || [] });"));
  // …and the same story told in another language has the same people in it
  assert.ok(read("app", "lib", "story-translate.server.ts").includes("...(castToken(castCardsOf(meta), placesOf(meta)) ? { filmCastRef: castToken(castCardsOf(meta), placesOf(meta)) } : {}),"), "…and its places");
});

test("the storyboard opens on the story's cast — the maker's picks and the story's own, one row", () => {
  const page = read("app", "routes", "web.film.tsx");
  assert.ok(page.includes("{narrated && seeds && (() => {"));
  assert.ok(page.includes("...pickedCast.map((r) => ({ name: r.name, look: r.kind && r.kind !== \"person\" ? (r.look || \"\") : \"\", img: r.img })),"));
  assert.ok(page.includes("...own.filter((c) => !pickedCast.some((r) => nameTok(r.name) === nameTok(c.name))),"), "nobody is shown twice");
  assert.ok(page.includes("if (!stars.length && !places.length) return null;"), "a story with nobody in it — and no place it comes back to — has no row");
  assert.ok(page.includes("<div className=\"mm-stars-h\"><b>{t(\"Starring\")}</b>{recasting") && page.includes(": (own.length > 0 || places.length > 0) && <span>{places.length > 0 && own.length === 0 ? t(\"It looks like this in every scene.\") : t(\"They look like this in every scene.\")}</span>}</div>"));
  assert.ok(page.includes("<button type=\"button\" className=\"mm-star-pic\" onClick={() => setZoomImg(c.img)} title={c.look ? `${c.name} — ${c.look}` : c.name}>"), "a face opens whole");
  // a phone: the row scrolls sideways inside itself, a face is a finger wide
  assert.ok(page.includes(".mm-stars-row{display:flex;gap:10px;overflow-x:auto;"));
  assert.ok(page.includes(".mm-star{position:relative;flex:0 0 108px;width:108px;min-width:0;"));
  assert.ok(page.includes(".mm-star-pic{position:relative;display:block;width:108px;height:144px;") && page.includes(".mm-star-pic img{display:block;width:100%;height:100%;object-fit:cover;object-position:center top;}"), "a full-length portrait is shown from the head down");
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Starring", "They look like this in every scene."]) assert.equal(dict.split(`${JSON.stringify(k)}:`).length - 1, 5, k);
});

test("the finished film says who is in it: the maker's cast, then the story's own — nobody twice", () => {
  const meta = {
    kind: "narrated", template: "testmovie",
    cast: [
      { name: " Maya ", faceUrl: "/avatars/maya.png", voiceId: null },
      { name: "Nobody", faceUrl: "" },
      { name: "Sneaky", faceUrl: "javascript:alert(1)" },
      { name: "Dots", faceUrl: "/renders/../x.jpg" },
      { name: "Far", faceUrl: "https://cdn.example.com/far.webp" },
      { name: "maya", faceUrl: "/avatars/other.png" },
      7,
    ],
    castCards: [
      { name: "Tobias", look: "a weathered lighthouse keeper", img: "/renders/t1.jpg" },
      { name: "Maya", look: "a duplicate of a picked name", img: "/renders/m1.jpg" },
      { name: "Ines", look: "", img: "/renders/i1.jpg" },
    ],
  };
  assert.deepEqual(storyStars(meta), [
    { name: "Maya", img: "/avatars/maya.png" },
    { name: "Far", img: "https://cdn.example.com/far.webp" },
    { name: "Tobias", img: "/renders/t1.jpg", look: "a weathered lighthouse keeper", own: true },
    { name: "Ines", img: "/renders/i1.jpg", own: true },
  ]);
  assert.deepEqual(storyStars(JSON.stringify(meta)).map((s) => s.name), ["Maya", "Far", "Tobias", "Ines"]);
  // a film made before films kept a cast, and nonsense: no row at all
  for (const m of [null, undefined, "", "{", 3, [], {}, { cast: "x", castCards: 4 }]) assert.deepEqual(storyStars(m), []);
  // six at most
  assert.equal(storyStars({ cast: Array.from({ length: 9 }, (_, k) => ({ name: `P${k}`, faceUrl: `/avatars/p${k}.png` })) }).length, 6);
  // a stock presenter's picture carries its version — "/avatars/omar_0.jpg?v=3" — and that is part of its
  // address: a film cast with stock presenters showed NOBODY under "Starring" (found 2026-11-24)
  assert.deepEqual(storyStars({ cast: [{ name: "OMAR", faceUrl: "/avatars/omar_0.jpg?v=3" }, { name: "ROSA", faceUrl: "/avatars/rosa_0.jpg?v=3&w=2" }, { name: "Bad", faceUrl: "/avatars/x.jpg?v=3\"><script>" }, { name: "Odd", faceUrl: "/avatars/x.jpg?next=//evil.example" }] }), [
    { name: "OMAR", img: "/avatars/omar_0.jpg?v=3" },
    { name: "ROSA", img: "/avatars/rosa_0.jpg?v=3&w=2" },
  ]);
  // the Archive: story films only, under the title
  const a = read("app", "routes", "web.archive.tsx");
  assert.ok(a.includes("stars: a.type === \"VIDEO_AD\" && (!!storyHeroOf(a.metaJson) || isNarratedStory(a.metaJson)) ? storyStars(a.metaJson) : [],"), "story films — and a story told again in another language");
  assert.ok(a.includes("{viewer.stars && viewer.stars.length > 0 && ("));
  assert.ok(a.includes("<b>{t(\"Starring\")}</b>"));
  assert.ok(a.includes("<span key={`${c.name}|${c.img}`} className=\"wa-vstar\" title={c.look ? `${c.name} — ${c.look}` : c.name}><img src={c.img} alt=\"\" loading=\"lazy\" /><i>{c.name}</i></span>"));
  assert.ok(a.includes(".wa-vstar img{display:block;width:58px;height:77px;object-fit:cover;object-position:center top;"));
});

test("a told story is drawn on the good model — every picture of it — and on the next one down when it refuses", () => {
  // (2026-11-23: three people from three portraits were TWO people on the everyday model six times out of six,
  //  all three on the stronger one. 2026-11-24, the owner of a tester's Horror Story: "running a poop engine for
  //  the stills and not the good one" — a refused scene fell to flux-dev. The tester's two scenes drawn by all
  //  three models: the stronger one best, Seedream 4.5 close, the everyday one weakest; none refused.)
  assert.deepEqual([STORY_MODEL, STORY_SECOND_MODEL, STORY_LAST_MODEL], ["google/nano-banana-pro", "bytedance/seedream-4.5", "google/nano-banana"]);
  assert.deepEqual([...STORY_LADDER], [STORY_MODEL, STORY_SECOND_MODEL, STORY_LAST_MODEL]);
  // each is asked in its own words — the same picture, the same references, the same shape
  const refs = ["https://x.example/renders/a.jpg", "https://x.example/renders/b.jpg"];
  // (2K: the same price as 1K on this model — the owner called the stories' look "rough", 2026-11-25)
  assert.deepEqual(storyPictureInput(STORY_MODEL, { prompt: "p", refs, aspect: "16:9" }), { prompt: "p", image_input: refs, aspect_ratio: "16:9", output_format: "jpg", resolution: "2K" });
  assert.deepEqual(storyPictureInput(STORY_SECOND_MODEL, { prompt: "p", refs, aspect: "9:16" }), { prompt: "p", image_input: refs, aspect_ratio: "9:16", size: "2K", max_images: 1 });
  assert.deepEqual(storyPictureInput(STORY_LAST_MODEL, { prompt: "p", refs: [], aspect: "1:1" }), { prompt: "p", aspect_ratio: "1:1", output_format: "jpg" });
  const nar = read("app", "lib", "narrated-story.server.ts");
  const fn = nar.slice(nar.indexOf("async function drawScene("), nar.indexOf("/** A picture that came back with black bars baked in"));
  assert.ok(fn.includes("async function drawScene(prompt: string, refs: string[], aspect: string): Promise<string | null> {"));
  assert.ok(fn.includes("for (const m of STORY_LADDER) {") && fn.includes("return await persistRemote(await repRun(m, storyPictureInput(m, { prompt: full, refs, aspect }), 150_000), \"jpg\");"), "down the ladder until one draws it");
  assert.ok(!/flux-dev|STORY_CROWD|sceneModel|strong/.test(fn), "no other way in, and no more 'stronger last go'");
  // the portraits and the places' sheets go the same way
  assert.ok(nar.includes("drawScene(portraitPrompt(e, tmpl.sceneHint, safe), [], PORTRAIT_ASPECT)"));
  assert.ok(!nar.includes("castCountNote") && !read("app", "lib", "story-picture.ts").includes("castCountNote"), "the sentence that did nothing is not in the prompt");
});

test("a picture kept with someone still missing says so: the scene is flagged, by name", () => {
  // Episode 2 of the lighthouse story (live, 2026-11-23): "Tobias … watching Marta and Ines sand the hull"
  // came back with Tobias and Ines — the best of three goes — and nothing told the maker Marta was not in it.
  const nar = read("app", "lib", "narrated-story.server.ts");
  const fn = nar.slice(nar.indexOf("export async function narratedSceneSeeds("), nar.indexOf("/** The narrator reads the whole story."));
  assert.ok(fn.includes("const faultsOut: (number | null)[] = new Array(scenes.length).fill(null);"));
  assert.ok(fn.includes("const checksOut: (StoryKept | null)[] = new Array(scenes.length).fill(null);"));
  assert.ok(fn.includes("if (!img && best) { img = best.img; faultsOut[i] = best.faults; checksOut[i] = { ...best.check, who: here.map((c) => c.name) }; }"), "who was looked for rides with the reading");
  assert.ok(fn.includes("if (img && faultsOut[i] == null) faultsOut[i] = 0;"), "a clean picture is a 0, a scene not drawn here stays null");
  const page = read("app", "routes", "web.film.tsx");
  // re-drawing one scene answers for THAT scene
  assert.ok(page.includes("faults = r.sceneFaults[sceneIndex] ?? null; check = r.sceneChecks[sceneIndex] ?? null;"));
  // the flag is the music video's own — one thing to learn — and a told story's says WHO
  assert.ok(page.includes("const flagged = (isMv || narrated) && !!seeds && ((seeds.faults || [])[i] || 0) > 0 && rerollingScene !== i;"));
  assert.ok(page.includes("if (c.panels === true || c.inset === true) return t(\"Split picture\");"), "(a smaller picture pasted into it is the same fault to a viewer)");
  assert.ok(page.includes("if (gone.length === 1 && gone[0].length <= 16 && (c.seen || []).filter((x) => x === false).length === 1) return t(\"{name} is missing\", { name: gone[0] });"), "one missing, with a name short enough for the flag");
  assert.ok(page.indexOf("return t(\"{name} is missing\"") < page.indexOf("return t(\"Missing someone\");"), "the name first; two missing is 'Missing someone'");
  assert.ok(page.includes("title={narrated ? t(\"We checked this picture and something looks off. Tap to draw it again.\") : t("));
  // on a phone the picture is a third of the card: the flag wraps inside it — and stops short of the
  // re-roll button that shares its row (30 px in the corner; in a mock the flag ran under it)
  assert.ok(page.includes(".mm-sb-list.is-told .mm-sb-flag{max-width:calc(100% - 48px);white-space:normal;"));
  assert.ok(page.includes(".mm-sc .mm-sb-reroll{top:auto;bottom:6px;right:6px;width:28px;height:28px;}"), "the button the flag must leave room for");
  // the wait is said honestly: portraits first, then four pictures at a time, each drawn and looked at
  assert.ok(page.includes("const seedWaveSec = narrated ? 24 : !tmpl?.lipSyncSinger ? 9 : mvCast ? 27 : mvAspect === \"9:16\" ? 25 : 12;"));
  assert.ok(page.includes(": narrated ? 15 : 0) + Math.ceil(scenes / (narrated ? 4 : 3)) * seedWaveSec);"));
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Split picture", "{name} is missing", "We checked this picture and something looks off. Tap to draw it again."]) assert.equal(dict.split(`${JSON.stringify(k)}:`).length - 1, 5, k);
});

test("one character can be drawn again: a new portrait, and only the scenes that name them follow", () => {
  const nar = read("app", "lib", "narrated-story.server.ts");
  const fn = nar.slice(nar.indexOf("export async function recastStoryCharacter("), nar.indexOf("/** The narrator reads the whole story."));
  assert.ok(fn.includes("if (carried.sheet) return null;"), "an older storyboard draws from one sheet: nothing to recast");
  assert.ok(fn.includes("const entry = (o.treatment.cast || []).find((e) => !!e && sameCharacter(castEntry(e).name, o.name));") && fn.includes("if (!entry) return null;"), "only a character the story has");
  assert.ok(fn.includes("const scenes = o.treatment.scenes.map((s, i) => (presentIn(entryName(entry), s?.visual || \"\") ? i : -1)).filter((i) => i >= 0);"), "the scenes they are IN — the same rule the drawing uses");
  assert.ok(fn.includes("if (!scenes.length) return null;"));
  // their portrait is dropped from what is carried in → the drawing makes a new one; everyone else is kept
  assert.ok(fn.includes("const kept = carried.refs.filter((r) => !sameCharacter(r.name, o.name));"));
  assert.ok(fn.includes("const r = await narratedSceneSeeds({ template: o.template, treatment: o.treatment, cast: o.cast, aspect: o.aspect, only: scenes, castRef: castToken(kept, carried.places) || null });"), "nobody else changes — and neither do the story's places");
  // …and the cast stays in the story's own order (a redrawn character does not move to the end of the row)
  assert.ok(nar.includes("cards.sort((a, b) => billed(a) - billed(b));"));
  const page = read("app", "routes", "web.film.tsx");
  // the action: a told story only, the words as they are now, never a rewrite
  assert.ok(page.includes("if (intent === \"recastStoryCharacter\") {"));
  assert.ok(page.includes("if (!narrated || !name) return json({ error: tr(lang, \"Preview the scenes first.\") });"));
  assert.ok(page.includes("return json({ ok: true, recastName: name, scenes: r.scenes, sceneImgs: r.sceneImgs, sceneFaults: r.sceneFaults, sceneChecks: r.sceneChecks, castRef: r.castRef, castCards: r.castCards });"));
  // the page: the ↻ is the scenes' own control, on the story's OWN characters only; one thing is drawn at a time
  assert.ok(page.includes("const mine = own.some((o) => o.name === c.name && o.img === c.img);"));
  assert.ok(page.includes("{mine && <button type=\"button\" className=\"mm-sb-reroll\" onClick={() => recastCharacter(c.name)} disabled={!!recasting || rerollingScene !== null}"));
  assert.ok(page.includes("if (!seeds || !narrated || recasting || rerollingScene !== null) return;"));
  assert.ok(page.includes("if (!seeds || recasting || (!narrated && !seeds.artistRef && !seeds.castRef)) return;"), "no scene is re-rolled while a character is being drawn");
  assert.ok(page.includes("{(rerollingScene === i || !!recasting?.scenes.includes(i)) && <span className=\"mm-sb-busy mm-sb-busy-rose\">"), "the scenes that follow show it");
  // only the pictures that came back replace the old ones; the cast and the flags come with them
  assert.ok(page.includes("const got = (j: number) => done.includes(j) && !!imgs[j];"));
  assert.ok(page.includes("imgs: prev.imgs.map((u, j) => (got(j) ? imgs[j] : u)),"));
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Draw {name} again", "Draw {name} again — the scenes they are in are drawn again too", "Drawing {name} again — the scenes they are in follow.", "Couldn't draw {name} again — try again."]) assert.equal(dict.split(`${JSON.stringify(k)}:`).length - 1, 5, k);
});

test("the next episode says who comes back, before a word is written", () => {
  const meta = JSON.stringify({ kind: "narrated", template: "testmovie", aspect: "9:16", captions: "bold", scenes: 6, castCards: [{ name: "Tobias", look: "a weathered lighthouse keeper", img: "/renders/t1.jpg" }, { name: "Ines", look: "a young postwoman", img: "/renders/i1.jpg" }] });
  const body = JSON.stringify({ videoUrl: "/renders/boat.mp4", treatment: { title: "The Week the Boat Didn't Come", scenes: [] } });
  const [card] = nextEpisodeCards([{ id: "a1", title: "Short Story — The Week the Boat Didn't Come", metaJson: meta, bodyJson: body }], 3);
  assert.deepEqual(card.setup.returning, [{ name: "Tobias", img: "/renders/t1.jpg" }, { name: "Ines", img: "/renders/i1.jpg" }]);
  // an ACTED film's invented people have no portraits (its cast is the presenters picked): nobody "returns"
  const acted = JSON.stringify({ kind: "testmovie", template: "testmovie", castCards: [{ name: "X", look: "", img: "/renders/x.jpg" }] });
  assert.deepEqual(nextEpisodeCards([{ id: "b1", title: "Short Film — x", metaJson: acted, bodyJson: body }], 3)[0].setup.returning, []);
  const page = read("app", "routes", "web.film.tsx");
  // (…but since S10b an acted film RECORDS its invented people's faces in meta.cast — film-series.ts → carryRecord — and
  //  the card it opens says they are back: every carried face no roster pick holds. tests/series-carry.test.ts)
  assert.ok(page.includes("setSeriesOwn(isNarr ? (s.returning || []) : s.cast.filter((m) => !!m.faceUrl && !d.roster.some((r) => r.img === m.faceUrl)).map((m) => ({ name: m.name, img: m.faceUrl as string })));"));
  assert.ok(page.includes(": seriesOwn.length ? <><Ico n=\"check\" size={12} /> {t(\"Back: {names}\", { names: seriesOwn.map((r) => r.name).join(\" + \") })}</>"));
  assert.ok(page.includes("? <span className=\"mm-card-face\" style={{ backgroundImage: `url(${seriesOwn[0].img})`, backgroundPosition: \"center top\" }} aria-hidden=\"true\" />"), "a full-length portrait is shown from the head down");
  assert.ok(page.includes("{!pickedCast.length && seriesOwn.length > 1 && ("), "the maker's own picks take the card over");
  assert.equal(read("app", "lib", "ui-i18n-dict.ts").split(`${JSON.stringify("Back: {names}")}:`).length - 1, 5);
});
