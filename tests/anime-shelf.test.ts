/* THE ANIME SHELF — six style posters on the Movie Maker, each opening the story builder in its style (2026-11-26).
 *
 * The owner: "Maybe just make it an additional tier on the actual movie maker (would look like more options) also would
 * like to add an Anime maker with different styles". A poster is how the home offers an option, so the anime maker is
 * one more shelf — "Anime" — with a poster per style (anime-styles.ts). One style is one template is one hero: the
 * style rides the template key through the job, the Archive's name, Edit story, Next episode and Another language.
 * Told only; operators only until he has priced anime and looked at a live one; an anime story draws its own cast.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ANIME_STYLES, drawnLead } from "../app/lib/anime-styles.ts";
import { FILM_HEROES, TALL_STILL_MEDIA, LOOP_MEDIA, heroById, heroName, heroOf, heroShelves, heroesFor, posterKey } from "../app/lib/film-heroes.ts";
import { storyHeroOf, isFormatName } from "../app/lib/film-series.ts";
import { coverKind, coverWords } from "../app/lib/archive-cover.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// (a checkout with CRLF line endings must read the same as one with LF)
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const page = read("app", "routes", "web.film.tsx");
const nar = read("app", "lib", "narrated-story.server.ts");
const dict = read("app", "lib", "ui-i18n-dict.ts");
const KEYS = ANIME_STYLES.map((s) => s.key);
const anime = FILM_HEROES.filter((h) => h.shelf === "anime");

test("one told hero per style, built FROM the table: id = template = poster = the style's key", () => {
  assert.equal(anime.length, ANIME_STYLES.length);
  assert.equal(ANIME_STYLES.length, 6);
  ANIME_STYLES.forEach((s, i) => {
    assert.deepEqual(anime[i], { id: s.key, tmpl: s.key, told: "narrated", media: s.key, card: s.card, name: s.name, kick: s.kick, meta: "narrated in minutes", tint: s.tint, shelf: "anime" }, s.key);
  });
  // …and they come last, after the Kids Cartoon: no existing hero moved (an id NEVER changes; heroOf takes the first match)
  assert.deepEqual(FILM_HEROES.slice(-6).map((h) => h.id), KEYS);
  assert.equal(FILM_HEROES.findIndex((h) => h.id === "kidstv"), FILM_HEROES.length - 7);
  // built, not copied: the file says ANIME_STYLES.map, and no style's key is written into it by hand
  const src = read("app", "lib", "film-heroes.ts");
  assert.ok(src.includes("...ANIME_STYLES.map((s): FilmHero => ({ id: s.key, tmpl: s.key, told: \"narrated\", media: s.key, card: s.card, name: s.name, kick: s.kick, meta: \"narrated in minutes\", tint: s.tint, shelf: \"anime\" })),"));
  assert.ok(src.includes("import { ANIME_STYLES } from \"./anime-styles.ts\";"));
  assert.ok(!/id: "anime/.test(src), "no anime hero written out by hand");
  // a poster's two lines fit a phone card, and its tint is one the page draws
  for (const h of anime) assert.ok(`${h.kick} · ${h.meta}`.length <= 45 && page.includes(`.${h.tint}{background:`), h.id);
});

test("the Anime shelf stands right after the Still Stories and lists exactly the six, in the table's order; the Stories list none", () => {
  const shelves = heroShelves(FILM_HEROES);
  // (2026-11-26, THE WAYS — the owner's "A", then "Those need to be on display": Anime is a card of "Only on EasyMode",
  //  tagged New, its row "Pick a style")
  assert.deepEqual(shelves.map((s) => s.key), ["still", "told", "acted", "anime", "kids", "sung"]);
  const sh = shelves.find((s) => s.key === "anime")!;
  assert.deepEqual([sh.name, sh.tag, sh.line, sh.pick, sh.group], ["Anime", "New", "A narrator tells it over hand-drawn anime pictures", "Pick a style", "only"]);
  assert.deepEqual(sh.heroes.map((h) => h.id), KEYS);
  // (the Stories hold the movie categories; an anime story is picked by its look — and told over stills by picking Still
  //  in its Length panel, where every told story's rung is picked)
  for (const k of ["told", "still"]) assert.ok(!shelves.find((s) => s.key === k)!.heroes.some((h) => h.shelf), `${k}: no anime hero`);
  // NO RUNG: S15a's motion test brought Dream and Neon City to life on Seedance and both held flat and 2D ("holds") — so a
  // poster opens on moving pictures, as a Story's does. (Had they drifted toward 3D or a photograph, it would open on Still.)
  assert.equal(sh.rung, undefined);
  const heroesSrc = read("app", "lib", "film-heroes.ts");
  assert.ok(heroesSrc.includes("{ key: \"anime\", name: \"Anime\", tag: \"New\", line: \"A narrator tells it over hand-drawn anime pictures\", short: \"Hand-drawn, six styles\", pick: \"Pick a style\", group: \"only\",") && heroesSrc.includes("has: (h) => h.shelf === \"anime\" },"));
  // (where pictures cannot move at all the shelf stays: its stories are told over stills there, like every story)
  assert.ok(heroShelves(FILM_HEROES, { still: false }).some((s) => s.key === "anime"));
  // each poster its own zoom key; a page that is not offered the anime templates has no Anime shelf, never an empty one
  for (const h of sh.heroes) assert.equal(posterKey(h.id, sh.rung), h.id);
  const member = heroesFor(FILM_HEROES.map((h) => h.tmpl).filter((t) => !KEYS.includes(t)), FILM_HEROES.filter((h) => h.told === "narrated").map((h) => h.tmpl).filter((t) => !KEYS.includes(t)));
  assert.ok(!heroShelves(member).some((s) => s.key === "anime"));
  assert.ok(!member.some((h) => h.shelf));
});

test("a finished anime story reads back as its style: the Archive's name, Edit story, Next episode", () => {
  for (const s of ANIME_STYLES) {
    assert.equal(heroOf(s.key, true)?.id, s.key);
    assert.equal(heroById(s.key)?.name, s.name);
    assert.equal(heroName(s.key, true, "Dream Anime"), s.name, "the Archive calls it by its style");
    assert.equal(storyHeroOf(JSON.stringify({ kind: "narrated", template: s.key }))?.id, s.key, "a next episode keeps its style");
    // (never acted: there is no acted anime hero — S15d)
    assert.equal(heroOf(s.key, false), undefined);
    assert.equal(storyHeroOf(JSON.stringify({ kind: "testmovie", template: s.key })), null);
    // the writer's own name for it is a format's name, not a title
    assert.equal(isFormatName(s.name), true, s.name);
  }
});

/** A JPEG's width and height, from its own frame header (as tests/film-genres.test.ts reads them). */
function jpegSize(file: string): { w: number; h: number } {
  const b = fs.readFileSync(file);
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error(`no frame header in ${file}`);
}

test("every anime poster is on disk: three upright moments 1600×900, one for a phone 1080×1350, each under 350 KB", () => {
  const landing = (f: string) => path.join(root, "public", "landing", f);
  for (const h of anime) {
    const wide = landing(`film-still-${h.media}.jpg`), tall = landing(`film-still-${h.media}-tall.jpg`);
    assert.deepEqual(jpegSize(wide), { w: 1600, h: 900 }, wide);
    assert.deepEqual(jpegSize(tall), { w: 1080, h: 1350 }, tall);
    for (const f of [wide, tall]) { const kb = fs.statSync(f).size / 1000; assert.ok(kb > 60 && kb <= 350, `${path.basename(f)} is ${kb.toFixed(0)} KB`); }
    // a phone still, and no loop (no anime story has moved on the site yet)
    assert.ok(TALL_STILL_MEDIA.includes(h.media) && !LOOP_MEDIA.includes(h.media), h.media);
    assert.ok(!fs.existsSync(landing(`film-loop-${h.media}.mp4`)));
  }
  // the page shows the phone covers (its banner, its posters, and the camera tiles of the Length panel, which preview on
  // the style's own poster: posterPicOf) — the page's list within film-heroes.ts's, and the sign-in lobby's the same list
  const listOf = (src: string) => [...(/const TALL_STILLS = new Set\(\[([^\]]+)\]\)/.exec(src) || ["", ""])[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const film = listOf(page), lobby = listOf(read("app", "components", "AuthLobby.tsx"));
  for (const k of film) assert.ok(TALL_STILL_MEDIA.includes(k), k);
  assert.deepEqual(film, lobby, "the same list, in the same order");
  assert.deepEqual(film.slice(-6), KEYS);
  assert.ok(page.includes("const posterPicOf = (media: string): string => (TALL_STILLS.has(media) ? `/landing/film-still-${media}-tall.jpg?v=${STILL_V}` : stillOf(media));"));
});

test("THE PAGE'S LOADER: the anime templates are an operator's — a member is offered neither the template nor its told hero", () => {
  const loader = page.slice(page.indexOf("export const loader = async"), page.indexOf("export const action = async"));
  assert.ok(loader.includes("const offered = (t: { drawn?: boolean } | undefined) => !t?.drawn || isAdminEmail(account.email);"));
  assert.ok(loader.includes("const templates = LIVE_FILM_TEMPLATES.filter(offered).map((t) => ({"));
  assert.ok(loader.includes("sung: !!t.sung, drawn: !!t.drawn,"), "the page knows a drawn template");
  assert.ok(loader.includes("const narratable = NARRATABLE_KEYS.filter((k) => offered(FILM_TEMPLATES[k]));") && loader.includes("    narratable,\n"));
  assert.ok(!loader.includes("(await import(\"../lib/film-engine.server\")).NARRATABLE_KEYS"), "no second, unfiltered list");
  assert.ok(loader.includes("Films are\n  // free while they are being finished") && loader.includes("operators only until he has"));
  // the posters are what heroesFor gives that list — the line it always was
  assert.equal(count(page, "const heroes = heroesFor(d.templates.map((x) => x.key), d.narratable || []);"), 1);
});

test("THE PAGE'S ACTION: an anime style is refused for a member, always TOLD, and never cast with a picked photo", () => {
  const action = page.slice(page.indexOf("export const action = async"), page.indexOf("export const action = async") + 14000);
  const at = (s: string) => { const i = action.indexOf(s); assert.ok(i > 0, s); return i; };
  // (the guard S15a's review put in, kept as it is: answered like a format that does not exist, and an acted ask refused)
  const known = at("const tmpl = filmTemplate(templateKey || undefined);");
  const guard = at("if (tmpl.drawn && !isAdminEmail(account.email)) {");
  assert.ok(known < guard && guard < at("const narrated = "));
  assert.ok(action.includes("detail: `not offered \"${templateKey.slice(0, 40)}\"` }, { status: 400 });"));
  // ALWAYS TOLD: whatever filmMode says — so the scenes, a re-roll, a recast and the render are all the told engine's
  assert.ok(action.includes("const narrated = (!!tmpl.drawn || ((form.get(\"filmMode\") as string) || \"\").trim() === \"narrated\") && canNarrate(tmpl.key);"));
  // NO PICKED CAST: its storyCast is empty whatever the form says
  assert.ok(action.includes("const storyCast = tmpl.lipSyncSinger || tmpl.drawn ? [] : parseStoryCast(form.get(\"filmCast\") as string);"));
  assert.equal(count(page, "parseStoryCast(form.get(\"filmCast\")"), 1, "the one place the picks are read");
  // (the other places that make a film job cannot name an anime style: a character's show is told in one of three
  //  formats, and Another language tells again a piece the shop already made — an operator's, for an anime one)
  assert.ok(read("app", "lib", "character-series.ts").includes("template: \"moral\" | \"testmovie\" | \"horror\";"));
  assert.ok(!read("app", "routes", "api.buddy.tsx").includes("contentType: \"film\""), "the buddy makes no film");
});

test("THE CAST CARD: an anime story's says, in one line, that it draws its own cast — no faces to pick, the narrator kept", () => {
  const line = "Anime stories draw their own cast, in the style.";
  // nobody is picked for one, so no `filmCast` is sent with any of its asks
  assert.ok(page.includes("  const castDrawn = !!tmpl?.drawn;\n  const pickedStars = castDrawn ? [] : storyPick.map((id) => d.roster.find((r) => r.id === id))"));
  assert.ok(page.includes("{isStoryboard && pickedCast.length > 0 && <input type=\"hidden\" name=\"filmCast\" value={filmCastJson} />}"));
  // the card says it where it said "We invent them · or pick your own"
  assert.ok(page.includes(`: castDrawn ? t("${line}") : t("We invent them · or pick your own")}</span>`));
  // the panel: the line, and none of the picker under it
  const panel = page.slice(page.indexOf("            {storyCard === \"cast\" && ("), page.indexOf("            {storyCard === \"length\" && ("));
  assert.ok(panel.includes(`<div className="mm-opts-sub">{castDrawn ? t("${line}") : narrated`));
  const pickerAt = panel.indexOf("{!castDrawn && (<>\n                <div className=\"mm-artistpick\">");
  assert.ok(pickerAt > panel.indexOf(`t("${line}")`));
  assert.ok(panel.indexOf("{peekHint}") > pickerAt && panel.indexOf("{t(\"Create a new character\")}") > pickerAt);
  // the narrator is its own step, untouched
  assert.ok(page.includes("{storyCard === \"voice\" && narrated && ("));
});

test("THE SHELF'S LOOK: a cherry-pink accent, a spark on its heading and on each poster's badge", () => {
  const css = page.slice(page.indexOf("const FS_STYLE = `"));
  assert.ok(css.includes(".fs-shelf.is-anime{--shelf:#CA3254;--shelf-soft:rgba(202,50,84,.08);}"));
  // warm: red leads, and it is none of the other four accents (the sums are tests/film-theater.test.ts's)
  const [r, g, b] = [1, 3, 5].map((i) => parseInt("#CA3254".slice(i, i + 2), 16));
  assert.ok(r > b && b > g && r - b > 100);
  for (const other of ["#A8741B", "#3E6A8E", "#0C7A46", "#6B4BC8"]) assert.ok(css.includes(`--shelf:${other};`), other);
  // (2026-11-26: every way's heading icon from one map — the Anime row's is still the spark)
  assert.ok(page.includes("<Ico n={WAY_ICON[sh.key]} size={18} />") && page.includes("anime: \"sparkle\""));
  assert.ok(read("app", "lib", "icons.tsx").includes("  sparkle: <>"));
  const fmt = page.slice(page.indexOf("  const fmtIcon = (key: string, told = false) => {"), page.indexOf("  const fmtIcon = (key: string, told = false) => {") + 900);
  assert.ok(fmt.indexOf("if (animeStyleOf(key)) return <svg") > 0 && fmt.indexOf("if (animeStyleOf(key)) return <svg") < fmt.indexOf("if (told) return"), "a style's spark before the told book");
  assert.ok(page.includes("import { animeStyleOf } from \"../lib/anime-styles\";"));
});

test("THE PICTURES' LOOKS: every drawn picture is asked about panels; the grime verdict is off for one; its lenient cut has room for its lead", () => {
  // (i) panels: anime and manga styling invites them whatever the words say — both places
  assert.ok(nar.includes("(twoMoments || tmpl.drawn) ? anthropicVision(storyPanelsPrompt(), [pic], { maxTokens: 320, model: \"claude-sonnet-4-6\" }) : Promise.resolve(\"\"),"));
  assert.ok(nar.includes("const panels = (twoMoments || tmpl.drawn) ? parseStoryPanels(String(panelsRaw || \"\")) : false;"));
  assert.equal(count(nar, "twoMoments ?"), 0, "no place still asks about panels only where the words said two moments");
  // (ii) grime: washes, grain and hatching read as "stained, dusty" to a reader tuned on photographs — its inset and its
  //      night sky, the other halves of the same question, are still read
  assert.ok(nar.includes("const grimy = tmpl.childSafe || tmpl.drawn || wornHere ? null : parseStoryGrime(String(grimeRaw || \"\"));"), "with S14b's worn-place pass beside it");
  assert.ok(nar.includes("const inset = parseStoryInset(String(grimeRaw || \"\"));") && nar.includes("const dark = night ? parseStoryNight(String(grimeRaw || \"\")) : null;"));
  // the lenient last path's cut (500 characters) is longer by the drawn lead it says first — review of S15a: on a night
  // scene the lead and the night left 130–145 characters of the scene's own words
  assert.ok(nar.includes("${tmpl.sceneHint}`, aspect, 500 + (tmpl.drawn ? drawnLead(tmpl.key).length : 0));"));
  for (const s of ANIME_STYLES) { const n = drawnLead(s.key).length; assert.ok(n > 150 && n <= 200, `${s.key}: ${n}`); }
  assert.ok(read("app", "lib", "image-generation.server.ts").includes("export async function renderCreativeSeed(prompt: string, aspect = \"9:16\", maxPrompt = 500): Promise<string | null> {"));
  // (iii) the place sheets came back DRAWN in S15a's look test (not a photographed model), so placeSheetPrompt is as it was
  assert.ok(nar.includes("placeSheetPrompt(p, tmpl.sceneHint, safe, !tmpl.childSafe && !tmpl.ownWorld)"));
});

test("THE ARCHIVE: a cover says the title without the style's name, and a title-only piece is a story", () => {
  const V = (title: string, meta: Record<string, unknown> = {}) => ({ type: "VIDEO_AD", title, meta, body: {} });
  for (const s of ANIME_STYLES) {
    const p = V(`${s.name} — The Lantern Ferry`, { kind: "narrated", template: s.key });
    const k = coverKind(p)!;
    assert.equal(k.family, "story", s.name);
    assert.equal(coverWords(p, k).title, "The Lantern Ferry", s.name);
    // a piece that says nothing about itself but its name is still a story
    const bare = V(`${s.name} — Night Bus`);
    assert.equal(coverKind(bare)?.family, "story", `${s.name}, title only`);
    assert.equal(coverWords(bare, coverKind(bare)!).title, "Night Bus");
  }
  // (a title that merely begins with a style's word is nobody's format)
  assert.equal(coverWords(V("Dream Anime Stories We Loved"), { family: "ad", kids: false }).title, "Dream Anime Stories We Loved");
  // the names are read off the table, escaped — never copied
  const src = read("app", "lib", "archive-cover.ts");
  assert.ok(src.includes("const ANIME_NAMES = ANIME_STYLES.map((s) => s.name.toLowerCase().replace(/[.*+?^${}()|[\\]\\\\]/g, \"\\\\$&\")).join(\"|\");"));
});

test("every word of the shelf is in all five languages, at the top of each block — and \"Anime\" is there exactly five times", () => {
  const words = [
    "Anime", "Narrated", "A narrator tells it over hand-drawn anime pictures", "Anime stories draw their own cast, in the style.", "narrated in minutes",
    ...ANIME_STYLES.flatMap((s) => [s.card, s.name, s.kick]),
  ];
  for (const k of words) assert.equal(count(dict, `\n  ${JSON.stringify(k)}: `), 5, k);
  for (const lang of ["es", "fr", "de", "zh", "ur"]) {
    const open = `const ${lang}: Record<string, string> = {\n`;
    // (zh and ur already said "Anime" — 动漫, اینیمے — so it was added to es, fr and de only: a second key is a TS error)
    // (…near the top: the Movie Maker's ways, 2026-11-26, added their lines above them since)
    const at = dict.indexOf(open);
    assert.ok(at >= 0 && dict.slice(at, at + 4000).includes(`${lang === "zh" || lang === "ur" ? "" : "  \"Anime\": \"Anime\",\n"}  "A narrator tells it over hand-drawn anime pictures": `), `${lang}: inserted at the top of its block`);
  }
});
