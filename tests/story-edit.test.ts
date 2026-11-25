/* EDIT A FINISHED NARRATED STORY — its words, with the pictures it already has.
 *
 * A finished story could not be touched: one wrong word meant making it all again — new pictures, a
 * different-looking story. The Movie Maker's storyboard already edits a story's words and pictures
 * before it is made, and the render already takes approved pictures and draws none of them again; so
 * "Edit story" in the Archive opens THAT storyboard with the finished story loaded (story-edit.ts).
 *
 * Also pinned here, both found the same night by making pieces as a customer:
 *   - a story with one scene added to an approved storyboard had EVERY picture drawn again;
 *   - a faceless video whose first picture failed opened on 3.6 seconds of a blank dark screen. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EDIT_MAX_SCENES, EDIT_MIN_SCENES, editCarry, storyToEditFrom } from "../app/lib/story-edit.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const J = JSON.stringify;

const SCENES = [
  { visual: "Gus and Isla push a cleaning cart under a cobwebbed chandelier", caption: "They say the old theatre never fully empties after midnight.", kind: "broll" },
  { visual: "Isla looks up at a flickering royal box", caption: "A light flickered in the royal box, sealed since opening night.", where: "the auditorium" },
  { visual: "Gus forces a door with a torch in his hand", caption: "Gus forced the door that had not opened in fifty years.", kind: "nonsense" },
  { visual: "A bride in a dusty chair", caption: "She was still there, waiting." },
];
const asset = (meta: Record<string, unknown> = {}, body: Record<string, unknown> = {}) => ({
  id: "story1",
  title: "Horror Story — The Second Bride",
  metaJson: J({ kind: "narrated", template: "horror", narrator: "English_Trustworth_Man", captions: "bold", aspect: "9:16", cast: [{ name: "GUS", faceUrl: "/avatars/gus.jpg" }, { name: "ISLA", faceUrl: "/avatars/isla.jpg" }, { name: "" }], ...meta }),
  bodyJson: J({ style: "NARRATED", prompt: "two night cleaners at an old theatre", treatment: { title: "The Second Bride", scenes: SCENES, musicMood: "eerie strings", cast: ["Mourning Mary, a pale bride"] }, ...body }),
});
const PICS = ["/renders/nst-1.jpg", "/renders/nst-2.jpg", "/renders/nst-3.jpg", "/renders/nst-4.jpg"];

test("a finished narrated story is handed to the storyboard as it was made: words, pictures, format, voice", () => {
  const s = storyToEditFrom(asset(), PICS, "en")!;
  assert.equal(s.from, "story1");
  assert.equal(s.title, "The Second Bride");
  assert.equal(s.heroId, "horror", "the narrated horror card — not the acted Horror Film");
  assert.equal(s.template, "horror");
  assert.deepEqual([s.aspect, s.captions, s.narrator, s.lang], ["9:16", "bold", "English_Trustworth_Man", "en"]);
  assert.deepEqual(s.cast, [{ name: "GUS", faceUrl: "/avatars/gus.jpg" }, { name: "ISLA", faceUrl: "/avatars/isla.jpg" }], "a nameless entry is left out");
  assert.equal(s.topic, "two night cleaners at an old theatre");
  assert.deepEqual(s.treatment.scenes.map((x) => x.caption), SCENES.map((x) => x.caption), "every scene's words, in order");
  assert.equal(s.treatment.scenes[0].kind, "broll");
  assert.equal(s.treatment.scenes[1].where, "the auditorium");
  assert.equal("kind" in s.treatment.scenes[2], false, "only the kinds the storyboard knows");
  assert.equal(s.treatment.musicMood, "eerie strings");
  assert.deepEqual(s.treatment.cast, ["Mourning Mary, a pale bride"]);
  assert.deepEqual(s.pictures, PICS);
  assert.equal(s.picturesKept, true);
});

test("pictures that were not kept are said so — never half a set", () => {
  for (const pics of [null, [], PICS.slice(0, 3), [...PICS.slice(0, 3), ""]]) {
    const s = storyToEditFrom(asset(), pics as string[] | null, "en")!;
    assert.equal(s.picturesKept, false);
    assert.deepEqual(s.pictures, [null, null, null, null], "one empty place per scene: the storyboard draws them");
  }
});

test("a telling in another language is edited IN that language; an old story in the shop's", () => {
  assert.equal(storyToEditFrom(asset({ lang: "es", translatedFrom: "first" }), PICS, "en")!.lang, "es");
  assert.equal(storyToEditFrom(asset(), PICS, "fr")!.lang, "fr");
  assert.deepEqual(editCarry(asset({ lang: "es", translatedFrom: "first", music: "/renders/mus-9.mp3?x=1" }).metaJson, "en"), { lang: "es", translatedFrom: "first", music: "mus-9.mp3" });
  assert.deepEqual(editCarry(asset().metaJson, "en"), { lang: "en", translatedFrom: "", music: "" });
  assert.equal(editCarry(J({ kind: "testmovie" }), "en"), null, "an acted film carries nothing");
  assert.equal(editCarry(asset({ translatedFrom: "../../etc" }).metaJson, "en")!.translatedFrom, "etc", "an id is only ever an id");
});

test("only a narrated story that can still be a story opens", () => {
  assert.equal(storyToEditFrom({ ...asset(), metaJson: J({ kind: "testmovie", template: "horror" }) }, PICS), null, "an acted film");
  assert.equal(storyToEditFrom({ ...asset(), metaJson: J({ kind: "faceless" }) }, PICS), null);
  assert.equal(storyToEditFrom(asset({ template: "no-such-format" }), PICS), null, "a format that no longer exists");
  assert.equal(storyToEditFrom(asset({}, { treatment: { scenes: SCENES.slice(0, 2) } }), PICS.slice(0, 2)), null, `fewer than ${EDIT_MIN_SCENES} scenes`);
  assert.equal(storyToEditFrom(asset({}, { treatment: { scenes: [...SCENES.slice(0, 2), { visual: "x", caption: "" }, { visual: "y", caption: " " }] } }), PICS), null, "scenes with nothing to say do not count");
  assert.equal(storyToEditFrom(asset({}, { treatment: "nope" }), PICS), null);
  assert.equal(storyToEditFrom({ ...asset(), bodyJson: "{not json" }, PICS), null);
  const long = storyToEditFrom(asset({}, { treatment: { scenes: Array.from({ length: EDIT_MAX_SCENES }, (_, i) => ({ visual: `v${i}`, caption: `Scene ${i} has words.` })) } }), null)!;
  assert.equal(long.treatment.scenes.length, EDIT_MAX_SCENES);
});

test("the Movie Maker opens it once, in its own storyboard, and Generate says where it came from", () => {
  const f = read("app", "routes", "web.film.tsx");
  // the loader: this shop's own story, never together with a next episode
  assert.ok(f.includes("const askedEdit = (new URL(request.url).searchParams.get(\"edit\") || \"\").replace(/[^A-Za-z0-9_-]/g, \"\").slice(0, 64);"));
  assert.ok(f.includes("if (askedEdit && !openEpisode) { try { openStory = await storyToEdit(shop.id, askedEdit, shop.contentLang); } catch { openStory = null; } }"));
  // the page: once, tidied through the router, the storyboard set a moment AFTER the setup
  assert.ok(f.includes("if (!d.openStory || openedStory.current) return;"));
  const at = f.indexOf("const startEdit = (st: StoryToEdit) => {");
  const fn = f.slice(at, f.indexOf("const openedStory = useRef(false);", at));
  assert.ok(at > 0 && fn.length > 600);
  assert.ok(fn.indexOf("switchHero(h.id);") < fn.indexOf("setScenes(") && fn.indexOf("setScenes(") < fn.indexOf("setSeeds({ imgs: st.pictures, treatment: st.treatment,"), "the format first, then its setup, then the storyboard");
  assert.ok(fn.includes("restoring.current = true;") && fn.includes("}, 160);"), "inside the restoring window, after the effects that would clear it");
  assert.ok(fn.includes("setEditing({ from: st.from, title: st.title, kept: st.picturesKept });"));
  assert.ok(f.includes("useEffect(() => { if (!seeds) setEditing(null); }, [seeds]);"), "the edit ends with the storyboard it loaded");
  // Generate: the id only; what is carried over is read on the server from the shop's own story
  assert.ok(f.includes("{isStoryboard && narrated && editing && <input type=\"hidden\" name=\"editFrom\" value={editing.from} />}"));
  assert.ok(f.includes("const edited = narrated && editFrom ? await editCarryFor(shop.id, editFrom, shop.contentLang) : null;"));
  assert.ok(f.includes("...(edited ? { filmLang: edited.lang, ...(edited.translatedFrom ? { filmTranslatedFrom: edited.translatedFrom } : {}), ...(edited.musicFile ? { ckMusic: edited.musicFile } : {}) } : {}),"));
  const srv = read("app", "lib", "story-edit.server.ts");
  assert.equal(srv.split("where: { id: assetId, shopId, type: \"VIDEO_AD\", status: { not: \"FAILED\" } },").length - 1, 2, "both reads are scoped by the shop");
  assert.ok(!/db\.\w+\.(update|updateMany|delete|deleteMany|create|upsert)\(/.test(srv), "the original is only ever read");
  // the Archive: on a narrated story, beside Next episode
  const a = read("app", "routes", "web.archive.tsx");
  assert.ok(a.includes("{viewer.tellIn && viewer.media && !viewer.expired && <a className=\"wa-vbtn ghost\" href={`/web/film?edit=${viewer.id}`} title={t(\"Change the words — it is told again with the same pictures\")}><Ico n=\"sliders\" /> {t(\"Edit story\")}</a>}"));
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Edit story", "Change the words — it is told again with the same pictures", "Editing “{title}” — its pictures are kept. Change the words below, then Generate: it lands as a new piece.", "Editing “{title}” — its pictures were not kept, so they will be drawn again."]) {
    assert.equal(dict.split(`${JSON.stringify(k)}:`).length - 1, 5, k);
  }
});

test("a story draws only the pictures it does not have", () => {
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("const missing = treatment.scenes.map((_, i) => i).filter((i) => !approved[i]);"));
  // (…from the story's own cast portraits, when it has them: tests/story-cast.test.ts)
  // (…and, since stories can be five minutes long, 2026-11-25, saying the job is at work as each picture comes back:
  //  tests/story-join.test.ts)
  assert.ok(nar.includes("const drawn = await narratedSceneSeeds({ template: tmpl.key, treatment, cast: opts.cast, aspect, only: missing, castRef: storyCastRef || null, beat: () => ckpt({ ckBeat: Date.now() }) });"));
  assert.ok(nar.includes("only?: number | number[];"));
  assert.ok(nar.includes("const todo = (Array.isArray(o.only) ? o.only : typeof o.only === \"number\" ? [o.only] : scenes.map((_, i) => i)).filter((i, k, a) => Number.isInteger(i) && i >= 0 && i < scenes.length && a.indexOf(i) === k);"));
  // the pictures both features re-use come from one place, and must all be on our disk
  const tr = read("app", "lib", "story-translate.server.ts");
  assert.ok(tr.includes("export async function storyPicturesOnDisk("));
  assert.ok(tr.includes("if (!found.pictures.every(onDisk)) return null;"));
  assert.ok(tr.includes("const found = await storyPicturesOnDisk(shopId, asset, words.captions.length);"));
  assert.ok(read("app", "lib", "story-edit.server.ts").includes("pictures = (await storyPicturesOnDisk(shopId, asset, scenes))?.pictures || null;"));
});

test("a faceless beat whose picture could not be made shows its neighbour's — never a blank screen", () => {
  const src = read("app", "lib", "faceless-video.server.ts");
  assert.ok(src.includes("for (let attempt = 0; attempt < 4 && !still; attempt++) {"));
  assert.ok(src.includes("if (attempt < 3) await new Promise((r) => setTimeout(r, [2000, 6000, 15000][attempt]));"), "long enough to outlast a rate limit");
  // the last two tries ask a second way (the same words four times are four refusals), and why a picture
  // failed is written down with the video — for the operator only
  assert.ok(src.includes("const secondWay = refused || attempt >= 2;\n      try { still = await brollStill(secondWay ? plain : prompt, quality); if (still && secondWay) plainer = true; }"));
  // a REFUSAL goes to the second way at once (read from a live video's note, 2026-11-23: "flagged as sensitive")
  assert.ok(src.includes("if (!secondWay && pictureRefused(why)) { refused = true; continue; }"));
  assert.ok(src.includes("return /flagged as sensitive|sensitive content|safety (filter|system)|content polic|nsfw|\\(E005\\)/i.test(message);"));
  assert.ok(src.includes("const plain = `A realistic cinematic photograph for this moment of a short video, the look of documentary b-roll, natural colour: "), "the second way looks like the rest of the video");
  assert.ok(src.includes("...(stillFaults.length ? { stillFaults: stillFaults.slice(0, 8) } : {})"));
  const arch = read("app", "routes", "web.archive.tsx");
  assert.ok(arch.includes("const operator = isAdminEmail(account.email);"));
  assert.ok(arch.includes("opsNote: operator ? (() => {"), "never sent to a member");
  assert.ok(!arch.includes("viewer.opsNote") && !arch.includes("a.opsNote"), "and never drawn");
  assert.ok(src.includes("const isPlaceholder = (p: string): boolean => path.basename(p).startsWith(\"bg-\");"));
  assert.ok(src.includes("if (stills.every(isPlaceholder)) throw new Error(\"[faceless] no b-roll could be made\");"), "no picture at all is a failed (refunded) video, not a blank one");
  assert.ok(src.includes("await assembleFaceless({ stills: shown, voPath, musicPath, caps, windows: beatWindows, fontFile, outPath, jobId });"));
  // the choice itself, as the code makes it
  const isPlaceholder = (p: string) => path.basename(p).startsWith("bg-");
  const shownOf = (stills: string[]) => stills.map((s, i) => {
    if (!isPlaceholder(s)) return s;
    for (let d = 1; d < stills.length; d++) {
      const after = stills[i + d], before = stills[i - d];
      if (after && !isPlaceholder(after)) return after;
      if (before && !isPlaceholder(before)) return before;
    }
    return s;
  });
  assert.deepEqual(shownOf(["/r/bg-1.jpg", "/r/a.jpg", "/r/b.jpg"]), ["/r/a.jpg", "/r/a.jpg", "/r/b.jpg"], "a failed opening borrows the next picture");
  assert.deepEqual(shownOf(["/r/bg-1.jpg", "/r/bg-1.jpg", "/r/b.jpg"]), ["/r/b.jpg", "/r/b.jpg", "/r/b.jpg"]);
  assert.deepEqual(shownOf(["/r/prod-1.jpg", "/r/a.jpg"]), ["/r/prod-1.jpg", "/r/a.jpg"], "a product photo is a real picture");
  assert.ok(src.includes(shownOf.toString().includes("after") ? "const after = stills[i + d], before = stills[i - d];" : ""), "the same rule is in the pipeline");
});

test("titles are cut at a word, the panel says when every language is told, and a faceless line is long enough", () => {
  // what the storyboard calls the story it has open: one line on a phone
  const long = storyToEditFrom(asset({}, { treatment: { title: "Zwei Nachtreinigungskräfte in einem alten Theater finden eine Braut, die in der Loge wartet", scenes: SCENES, musicMood: "" } }), PICS, "de")!;
  assert.ok(long.title.length <= 48 && long.title.endsWith("…") && !/\s…$/.test(long.title), long.title);
  assert.ok("Zwei Nachtreinigungskräfte in einem alten Theater finden eine Braut, die in der Loge wartet".startsWith(long.title.slice(0, -1)), "whole words only");
  assert.equal(long.treatment.title.endsWith("wartet"), true, "the story's own title is not shortened");
  // a telling's title (it came back "…finden eine Braut, die in der")
  const tr = read("app", "lib", "story-translate.ts");
  assert.ok(tr.includes("const title = trimTitle(oneLine(str(a.title)), 80);"));
  assert.ok(!tr.includes("oneLine(str(a.title)).slice(0, 80)"));
  // every language already told: the panel says so instead of offering to tell it "again"
  const a = read("app", "routes", "web.archive.tsx");
  assert.ok(a.includes("{viewer.tellIn.every((l) => l.have) ? t(\"This story is told in every language — tap one to open it.\") : t(\"Tell this story again in another language — the same pictures and the same storyteller. It lands here as its own piece.\")}"));
  assert.equal(read("app", "lib", "ui-i18n-dict.ts").split(`${JSON.stringify("This story is told in every language — tap one to open it.")}:`).length - 1, 5);
  // a faceless video is priced as about half a minute: lines of 8-9 words made a 21-second one
  const fl = read("app", "lib", "faceless-video.server.ts");
  assert.equal(fl.split("one conversational sentence of 12 to 16 words;").length - 1, 2, "both scripts");
  assert.ok(!fl.includes("~8-16 words"));
});
