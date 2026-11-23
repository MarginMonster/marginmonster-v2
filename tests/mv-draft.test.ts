/* A MUSIC VIDEO IN THE MAKING IS KEPT.
 *
 * A storyboard — the song, the pictures, who is in each, what they wear, the lines re-written by hand —
 * lived only in the open page. A refresh lost it, and so did every update we shipped: the next tap landed
 * on "EasyMode just updated", and its reload came back to an empty Movie Maker (seen while testing on the
 * live site, 2026-11-22). It is now written to the browser as it changes and offered back with one card.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MV_DRAFT_HOURS, MV_DRAFT_KEY, MV_DRAFT_MAX_CHARS, draftScenes, packDraft, readDraft, type MvDraft } from "../app/lib/mv-draft.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");
const NOW = 1_795_000_000_000;
const video = (): Omit<MvDraft, "v" | "at"> => ({
  template: "musicvideo", topic: "late night drive through the city", genre: "pop", pace: "", seconds: 30, scenes: 6,
  aspect: "9:16", lyrics: "subtitles", artist: "/avatars/omar_0.jpg", artistGender: "m", singVoice: false,
  customArtists: [], cast: [{ img: "/avatars/valentina_0.jpg", name: "VALENTINA" }, { img: "/avatars/keiko_0.jpg", name: "KEIKO" }], feat: [],
  props: [], customProps: [], songSource: "write", songUrl: "",
  seeds: {
    imgs: ["/renders/a.jpg", "/renders/b.jpg", null],
    treatment: { title: "Neon Hearts", scenes: [{ visual: "A street at night." }, { visual: "KEIKO sings under a streetlamp.", caption: "Say you feel it now", kind: "perform", singer: "KEIKO" }, { visual: "A rooftop at night." }] },
    propForScene: { 1: "car" }, artistRef: "/renders/ref-o.jpg", castRef: null, castRefs: ["/renders/ref-v.jpg", "/renders/ref-k.jpg"],
    faults: [0, null, 2], checks: [null, { people: 1 }, null],
  },
  castForScene: { 1: [] , 2: ["/avatars/valentina_0.jpg"] },
  sceneOutfits: { 1: { "/avatars/keiko_0.jpg": "a silver sequin jacket over a black top" } },
});

test("what is kept comes back exactly: the song, the pictures, who sings, who is in each scene, what they wear", () => {
  const text = packDraft(video(), NOW);
  const back = readDraft(text, NOW + 60_000);
  assert.ok(back);
  assert.deepEqual({ ...back, v: undefined, at: undefined }, { ...video(), v: undefined, at: undefined });
  assert.equal(back!.at, NOW);
  // the things that are easiest to lose and hardest to remake
  assert.equal((back!.seeds.treatment.scenes[1] as { singer?: string }).singer, "KEIKO", "a scene handed to a co-star stays hers");
  assert.deepEqual(back!.sceneOutfits[1], { "/avatars/keiko_0.jpg": "a silver sequin jacket over a black top" });
  assert.deepEqual(back!.castForScene[1], [], "a scene emptied of co-stars stays emptied (an empty pick is a pick)");
  assert.equal(draftScenes(back!), 2, "the card counts the scenes that have their picture");
});

test("a kept video is offered only while it is fresh, whole and ours", () => {
  const text = packDraft(video(), NOW);
  assert.ok(readDraft(text, NOW + (MV_DRAFT_HOURS - 1) * 3_600_000), "still offered a day or two later");
  assert.equal(readDraft(text, NOW + (MV_DRAFT_HOURS + 1) * 3_600_000), null, "not after three days");
  assert.equal(readDraft(text, NOW - 5_000), null, "a stamp from the future is not trusted");
  assert.equal(readDraft(null, NOW), null);
  assert.equal(readDraft("", NOW), null);
  assert.equal(readDraft("not json", NOW), null);
  assert.equal(readDraft("[1,2,3]", NOW), null);
  assert.equal(readDraft(JSON.stringify({ ...JSON.parse(text), v: 2 }), NOW), null, "another version of the shape is not read as this one");
  // nothing worth picking up: no storyboard, no picture at all, or pictures and scenes that do not line up
  const j = JSON.parse(text);
  assert.equal(readDraft(JSON.stringify({ ...j, seeds: null }), NOW), null);
  assert.equal(readDraft(JSON.stringify({ ...j, seeds: { ...j.seeds, imgs: [null, null, null] } }), NOW), null);
  assert.equal(readDraft(JSON.stringify({ ...j, seeds: { ...j.seeds, imgs: ["/renders/a.jpg"] } }), NOW), null);
  assert.equal(readDraft(JSON.stringify({ ...j, template: "" }), NOW), null);
});

test("what comes back is only ever the shapes the builder expects", () => {
  const j = JSON.parse(packDraft(video(), NOW));
  const odd = readDraft(JSON.stringify({
    ...j,
    topic: "x".repeat(900), aspect: "4:3", artistGender: "robot", singVoice: "yes", songSource: "pirate",
    cast: [{ img: "/a.jpg", name: 7 }, { name: "no picture" }, "nobody", ...Array.from({ length: 9 }, (_, k) => ({ img: `/c${k}.jpg`, name: "x" }))],
    feat: ["/a.jpg", 5, null], props: "tiger",
    castForScene: { 0: "everyone", 1: ["/a.jpg", 3], 999: ["/b.jpg"], "-1": ["/c.jpg"], x: ["/d.jpg"] },
    sceneOutfits: { 0: ["a hat"], 1: { "/a.jpg": "a red dress", "/b.jpg": 12 } },
    extra: { anything: "else" },
  }), NOW)!;
  assert.ok(odd);
  assert.equal(odd.topic.length, 300);
  assert.equal(odd.aspect, "9:16");
  assert.equal(odd.artistGender, "m");
  assert.equal(odd.singVoice, false);
  assert.equal(odd.songSource, "write");
  assert.deepEqual(odd.cast.map((c) => c.img), ["/a.jpg", "/c0.jpg", "/c1.jpg", "/c2.jpg"], "four people at most, each with a picture");
  assert.equal(odd.cast[0].name, "");
  assert.deepEqual(odd.feat, ["/a.jpg"]);
  assert.deepEqual(odd.props, []);
  assert.deepEqual(odd.castForScene, { 1: ["/a.jpg"] });
  assert.deepEqual(odd.sceneOutfits, { 1: { "/a.jpg": "a red dress" } });
  assert.ok(!("extra" in odd));
  // far too big to be a storyboard: not written, and not read
  const huge = { ...video(), topic: "x".repeat(MV_DRAFT_MAX_CHARS) };
  assert.equal(packDraft(huge, NOW), "");
  assert.equal(readDraft("x".repeat(MV_DRAFT_MAX_CHARS + 1), NOW), null);
});

test("the page: kept as it changes, offered on arrival, put back on one tap — and never thrown away unasked", () => {
  const ui = read("app", "routes", "web.film.tsx");
  // WRITTEN whenever a music video's storyboard changes; a storyboard that is gone erases nothing
  assert.ok(ui.includes("if (typeof localStorage === \"undefined\" || !tmpl?.lipSyncSinger || !seeds) return;"));
  assert.ok(ui.includes("try { localStorage.setItem(MV_DRAFT_KEY, text); } catch { /* quota / private mode */ }"));
  assert.ok(!ui.includes("localStorage.removeItem(MV_DRAFT_KEY)"), "a kept video is replaced only by the next storyboard, or by its own age");
  for (const part of ["topic,", "genre: filmGenre,", "pace: pacePick,", "seconds: mvSeconds,", "aspect: mvAspect,", "lyrics: mvLyrics,", "artist: artistPick,", "cast: castExtra,", "feat: featPick,", "songUrl: filmSongUrl,", "seeds,", "castForScene,", "sceneOutfits }"]) {
    assert.ok(ui.slice(ui.indexOf("const text = packDraft({"), ui.indexOf("const text = packDraft({") + 520).includes(part), part);
  }
  // FOUND on arrival and offered — a card, never a silent restore
  assert.ok(ui.includes("try { kept = readDraft(localStorage.getItem(MV_DRAFT_KEY), Date.now()); } catch { kept = null; }"));
  assert.ok(ui.includes("if (kept && d.templates.some((x) => x.key === kept!.template && x.lipSyncSinger)) setDraft(kept);"));
  const card = ui.slice(ui.indexOf("{draft && !seeds && ("), ui.indexOf("<div className=\"fs-switch\">"));
  assert.ok(card.includes("{t(\"Your music video is still here\")}") && card.includes("t(\"{n} scenes drawn\", { n: draftScenes(draft) })"));
  assert.ok(card.includes("<button type=\"button\" className=\"mm-kept-go\" onClick={resumeDraft}>{t(\"Pick it up\")}</button>"));
  // "Not now" only puts the card away
  assert.ok(card.includes("onClick={() => setDraft(null)} aria-label={t(\"Not now\")}"));
  // PUT BACK: everything at once — and the effects that rightly start a storyboard over when the idea, the
  // cast or the shape is changed by hand stand down while it happens
  const resume = ui.slice(ui.indexOf("const resumeDraft = () => {"), ui.indexOf("const resumeDraft = () => {") + 1500);
  assert.ok(resume.includes("restoring.current = true;") && resume.includes("window.setTimeout(() => { restoring.current = false; }, 600);"));
  // (…and the HERO it is: the grid is a poster per hero since 2026-11-22 — tests/film-heroes.test.ts)
  for (const set of ["setTemplate(k.template); setHeroId(FILM_HEROES.find((h) => h.tmpl === k.template)?.id || k.template); setEntered(true);", "setTopic(k.topic);", "setArtistPick(k.artist);", "setCastExtra(k.cast);", "setMvAspect(k.aspect);", "setSeeds(k.seeds as unknown as NonNullable<typeof seeds>);", "setCastForScene(k.castForScene); setSceneOutfits(k.sceneOutfits);", "setDraft(null);"]) {
    assert.ok(resume.includes(set), set);
  }
  assert.ok(resume.indexOf("restoring.current = true;") < resume.indexOf("setTopic("), "the guard is up before anything is set");
  // (the fifth: the story formats' way-of-telling effect, which stands down while a NEXT EPISODE is set up —
  //  film-series.ts — so the hero's default length and shape do not land on top of the episode's own)
  assert.equal(ui.split("if (restoring.current) return;").length - 1, 5, "the four effects that reset the song, the scenes or the voice, and the story's way-of-telling one");
  assert.ok(ui.includes("useEffect(() => { if (restoring.current) return; setSeeds(null); setCastForScene({}); setSceneCastPick(null); setSceneOutfits({}); }, [filmGenre,"));
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Your music video is still here", "{n} scenes drawn", "Pick it up", "Not now"]) {
    assert.equal(dict.split(`\n  ${JSON.stringify(k)}:`).length - 1, 5, k);
  }
  assert.equal(MV_DRAFT_KEY, "mm-mv-draft-v1");
});
