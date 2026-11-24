/* A SERIES IS ONE CARD ON THE SHELF — and the top of the Archive on a phone is two rows, not seven.
 *
 * The owner, 2026-11-24: "archive should show Series as a cover with number of episodes inside like a
 * netflix listing wink wink, that way there isnt 10 episodes cluttering the archive but a singular
 * storyline being stored". And, the same day, looking at the page on his phone: "the archive looks …
 * bananas with all the tiny cards and options" — seven rows of controls stood before the first piece.
 *
 * What is held here:
 *   1. app/lib/archive-series.ts — which loaded films are episodes of one series (a film series, or a
 *      character's show), and the shelf as ITEMS: a series collapses into one card standing where its
 *      newest episode stood; everything else stays the piece it was.
 *   2. the page: a series' card is a way IN and nothing else (never a way to keep, delete or pick its
 *      episodes at once); ?series=<key> opens it, in episode order, under a header with the way back.
 *   3. the phone: tabs, then ONE row — search · Filter · Select — and every filter behind "Filter",
 *      unchanged; the two explanatory lines at the foot; a card is its cover, its title and one badge.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { archiveShelf, episodeOwnLabel, firstFrameOf, seriesKey, seriesOnShelf, seriesTags, type ShelfItem, type ShelfPiece } from "../app/lib/archive-series.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// (a checkout with CRLF line endings must read the same as one with LF)
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const J = JSON.stringify;

/* ---- the films a page might load, NEWEST FIRST (every name is made up) ---- */
const story = (extra: Record<string, unknown> = {}) => J({ kind: "narrated", template: "testmovie", ...extra });
const UMBRELLA = { id: "u1", title: "TEST One Umbrella" };
const HOWL = { id: "showA", name: "TEST Howl: Night tales", star: "Howl" };
const ROWS = [
  { id: "u3", metaJson: story({ series: { ...UMBRELLA, episode: 3 } }) },
  { id: "h2", metaJson: story({ show: { ...HOWL, episode: 2 } }) },
  { id: "x1", metaJson: story() }, // a film nobody has continued
  { id: "u2fr", metaJson: story({ series: { ...UMBRELLA, episode: 2 }, translatedFrom: "u2", lang: "fr" }) }, // episode 2, told again in French
  { id: "u2", metaJson: story({ series: { ...UMBRELLA, episode: 2 } }) },
  { id: "h1", metaJson: story({ show: { ...HOWL, episode: 1 } }) },
  { id: "p1", metaJson: story({ show: { id: "showB", name: "TEST Pip: Lessons", episode: 1, star: "Pip" } }) }, // a show with one episode so far
  { id: "u1", metaJson: story() }, // the film the series started from: it says nothing of a series itself
  { id: "mv", metaJson: J({ kind: "musicvideo" }) },
  { id: "bad", metaJson: "{" },
];
const T0 = Date.UTC(2026, 10, 24, 12, 0);
const TAGS = seriesTags(ROWS);
/** the same films as the page's shelf has them: an hour apart, each with its video; every other one made a poster */
const SHELF: ShelfPiece[] = ROWS.map((r, i) => ({ id: r.id, when: new Date(T0 - i * 3_600_000).toISOString(), media: `/renders/${r.id}.mp4`, poster: i % 2 ? null : `/renders/${r.id}-poster.jpg`, series: TAGS.get(r.id) || null }));
const brief = (items: ShelfItem[]) => items.map((it) => (it.kind === "series" ? `${it.title} ×${it.count} [${it.episodes.join(",")}]` : it.id));

test("a series' key: short, stable, one letter for its kind — and never the id itself", () => {
  // (pinned: a key is in people's addresses — a change of hash would break every one of them)
  assert.equal(seriesKey("film", "u1"), "f15zgn5i8kx7");
  assert.equal(seriesKey("show", "showA"), "s20tc23n564z");
  assert.equal(seriesKey("film", "u1"), seriesKey("film", "u1"), "the same series, the same key");
  const id = "cmhq2k7x90001abcd1234efgh";
  const film = seriesKey("film", id), show = seriesKey("show", id);
  assert.notEqual(film.slice(1), show.slice(1), "a film and a show with one id are two series");
  for (const k of [film, show, seriesKey("show", ""), seriesKey("film", "é ü 漢字 \" < > &")]) {
    assert.match(k, /^[fs][0-9a-z]{1,11}$/, k);
    assert.ok(k.length <= 12);
  }
  assert.ok(!film.includes(id) && !show.includes(id) && !show.includes(id.slice(0, 8)), "the database id cannot be read off the address");
});

test("which loaded films are episodes: a film series from its second film on, a show from its first", () => {
  const got = Object.fromEntries([...TAGS].map(([id, s]) => [id, `${s.title} #${s.episode}`]));
  assert.deepEqual(got, {
    u3: "TEST One Umbrella #3", u2: "TEST One Umbrella #2",
    u1: "TEST One Umbrella #1", // the first film joins as episode 1 — because a later film names it
    h2: "TEST Howl: Night tales #2", h1: "TEST Howl: Night tales #1",
    p1: "TEST Pip: Lessons #1", // a show with a single episode IS a series: it is a show
  });
  // one key per series, and a film series' key is made from its first film
  assert.equal(new Set(["u1", "u2", "u3"].map((id) => TAGS.get(id)!.key)).size, 1);
  assert.equal(TAGS.get("u1")!.key, seriesKey("film", "u1"));
  assert.equal(TAGS.get("h1")!.key, seriesKey("show", "showA"));
  assert.notEqual(TAGS.get("h1")!.key, TAGS.get("p1")!.key);
  // a film with no second episode is a plain piece; so is a music video; so is meta nothing can be made of
  for (const id of ["x1", "mv", "bad"]) assert.equal(TAGS.has(id), false, id);
  // A TELLING IN ANOTHER LANGUAGE is not an episode — even though it carries its source's series
  assert.equal(TAGS.has("u2fr"), false);
  // …and it does not make a first film an episode either: a film whose only "sequel" is a telling stays a piece
  const lone = seriesTags([{ id: "t", metaJson: story({ series: { id: "f", title: "TEST Kite", episode: 2 }, translatedFrom: "gone" }) }, { id: "f", metaJson: story() }]);
  assert.equal(lone.size, 0);
  // the first film is not on the page (older than what was loaded, or outside a search): the episodes still are a series
  const tail = seriesTags(ROWS.filter((r) => r.id !== "u1"));
  assert.deepEqual([tail.get("u3")?.episode, tail.get("u2")?.episode, tail.has("u1")], [3, 2, false]);
  // …and the first film alone is the plain piece it always was
  assert.equal(seriesTags(ROWS.filter((r) => r.id === "u1" || r.id === "x1")).size, 0);
  // a series is titled as its NEWEST episode titles it (a show renamed since its first episode)
  const renamed = seriesTags([
    { id: "b", metaJson: story({ show: { id: "s", name: "TEST New name", episode: 2, star: "A" } }) },
    { id: "a", metaJson: story({ show: { id: "s", name: "TEST Old name", episode: 1, star: "A" } }) },
  ]);
  const [card] = archiveShelf([{ id: "b", when: "2026-11-24T10:00:00Z", series: renamed.get("b") }, { id: "a", when: "2026-11-20T10:00:00Z", series: renamed.get("a") }]);
  assert.ok(card.kind === "series" && card.title === "TEST New name" && card.count === 2);
  // a piece is in ONE series — its own. An episode of a show that somebody continued as a film series stays
  // in its show, and the continuation is a series of what follows it
  const both = seriesTags([
    { id: "c2", metaJson: story({ series: { id: "h1", title: "TEST The Trail", episode: 2 } }) },
    { id: "h1", metaJson: story({ show: { ...HOWL, episode: 1 } }) },
  ]);
  assert.equal(both.get("h1")!.key, seriesKey("show", "showA"));
  assert.equal(both.get("c2")!.key, seriesKey("film", "h1"));
  // the meta may be an object already, and nothing here throws on rubbish
  assert.equal(seriesTags([{ id: "o", metaJson: { show: { ...HOWL, episode: 4 } } }]).get("o")?.episode, 4);
  assert.equal(seriesTags([{ id: "", metaJson: story({ show: { ...HOWL, episode: 4 } }) }, { id: "n", metaJson: null }, { id: "z", metaJson: 7 }] as never).size, 0);
  assert.equal(seriesTags([]).size, 0);
});

test("the shelf as items: one card a series, standing where its newest episode stood; everything else as it was", () => {
  const items = archiveShelf(SHELF);
  assert.deepEqual(brief(items), [
    "TEST One Umbrella ×3 [u1,u2,u3]", // where u3 — its newest — stood; inside, episode order
    "TEST Howl: Night tales ×2 [h1,h2]",
    "x1",
    "u2fr", // the French telling: a piece of its own
    "TEST Pip: Lessons ×1 [p1]",
    "mv",
    "bad",
  ]);
  // ten films, seven cards — and no film is on the shelf twice or missing from it
  const ids = items.flatMap((it) => (it.kind === "series" ? it.episodes : [it.id]));
  assert.deepEqual([...ids].sort(), SHELF.map((p) => p.id).sort());
  const umbrella = items[0];
  assert.ok(umbrella.kind === "series");
  assert.equal(umbrella.key, seriesKey("film", "u1"));
  assert.equal(umbrella.latestWhen, SHELF[0].when, "when its newest episode was made");
  // nothing in an item is a database id of a show; a card carries only what it shows and its key
  assert.deepEqual(Object.keys(umbrella).sort(), ["count", "cover", "episodes", "frame", "key", "kind", "latestWhen", "title"]);
  assert.ok(!J(items).includes("showA") && !J(items).includes("showB"));
  // a shelf with no series on it is exactly its pieces
  const plain = SHELF.filter((p) => !p.series);
  assert.deepEqual(archiveShelf(plain), plain.map((p) => ({ kind: "piece", id: p.id })));
  assert.deepEqual(archiveShelf([]), []);
  // the page's list is not touched
  const frozen = SHELF.map((p) => Object.freeze({ ...p }));
  assert.doesNotThrow(() => archiveShelf(Object.freeze(frozen) as ShelfPiece[]));
});

test("a narrowed shelf: a series is what is left of it — it still shows as its card", () => {
  // a search that matched only episode 2; a chip that left only the first film; one show episode from today
  assert.deepEqual(brief(archiveShelf(SHELF.filter((p) => p.id === "u2" || p.id === "mv"))), ["TEST One Umbrella ×1 [u2]", "mv"]);
  assert.deepEqual(brief(archiveShelf(SHELF.filter((p) => p.id === "u1"))), ["TEST One Umbrella ×1 [u1]"], "tagged by the loader, so a chip cannot turn it back into a loose film");
  assert.deepEqual(brief(archiveShelf(SHELF.filter((p) => p.id === "h2" || p.id === "x1"))), ["TEST Howl: Night tales ×1 [h2]", "x1"]);
  // the card stands where the newest of what is LEFT stood
  assert.deepEqual(brief(archiveShelf(SHELF.filter((p) => ["x1", "u2", "u1"].includes(p.id)))), ["x1", "TEST One Umbrella ×2 [u1,u2]"]);
});

test("the cover: the newest episode's poster, else its first frame — and never a blank when an older episode has a picture", () => {
  const tag = TAGS.get("u1")!;
  const ep = (id: string, hoursAgo: number, episode: number, over: Partial<ShelfPiece> = {}): ShelfPiece => ({ id, when: new Date(T0 - hoursAgo * 3_600_000).toISOString(), media: `/renders/${id}.mp4`, poster: null, series: { ...tag, episode }, ...over });
  const cover = (list: ShelfPiece[]) => { const it = archiveShelf(list)[0]; assert.ok(it.kind === "series"); return [it.cover, it.frame]; };
  // its poster — with the same film's first frame to fall back to if the poster's file is ever missing
  assert.deepEqual(cover([ep("c", 1, 3, { poster: "/renders/c-poster.jpg" }), ep("b", 2, 2), ep("a", 3, 1)]), ["/renders/c-poster.jpg", "/vthumb/c.mp4"]);
  // no poster: its first frame, exactly as the shelf shows any film (cover === frame says "this is not a poster")
  assert.deepEqual(cover([ep("c", 1, 3), ep("b", 2, 2, { poster: "/renders/b-poster.jpg" })]), ["/vthumb/c.mp4", "/vthumb/c.mp4"]);
  // the newest episode's render is gone: the newest that still has its film
  assert.deepEqual(cover([ep("c", 1, 3, { media: null }), ep("b", 2, 2, { poster: "/renders/b-poster.jpg" })]), ["/renders/b-poster.jpg", "/vthumb/b.mp4"]);
  // every render gone, one poster left: the poster; nothing at all: no cover (the card draws a film glyph)
  assert.deepEqual(cover([ep("c", 1, 3, { media: null }), ep("b", 2, 2, { media: null, poster: "/renders/b-poster.jpg" })]), ["/renders/b-poster.jpg", null]);
  assert.deepEqual(cover([ep("c", 1, 3, { media: null })]), [null, null]);
  // a first frame is asked for by the file's own name, whatever host or query the address carries
  assert.equal(firstFrameOf("https://cdn.example/renders/a.mp4?x=1"), "/vthumb/a.mp4");
  assert.equal(firstFrameOf("/renders/nar-9.mp4"), "/vthumb/nar-9.mp4");
  assert.equal(firstFrameOf(null), null);
  assert.equal(firstFrameOf(""), null);
  // …which is the page's own way of asking for one
  assert.ok(read("app", "routes", "web.archive.tsx").includes("`/vthumb/${a.media.split(\"?\")[0].split(\"/\").pop()}`"));
});

test("episode order is 1, 2, 3… whatever order the films were made or listed in", () => {
  const tag = TAGS.get("h1")!;
  const ep = (id: string, hoursAgo: number, episode: number): ShelfPiece => ({ id, when: new Date(T0 - hoursAgo * 3_600_000).toISOString(), media: `/renders/${id}.mp4`, series: { ...tag, episode } });
  // episode 1 was told again yesterday (a newer film than episode 3): the card stands where THAT film stands
  // and wears its cover — the shelf is newest first — while inside it is still 1, 2, 3
  const list = [ep("one-again", 1, 1), { id: "loose", when: new Date(T0 - 2 * 3_600_000).toISOString() }, ep("three", 5, 3), ep("two", 9, 2), ep("one", 30, 1)];
  const items = archiveShelf(list);
  assert.deepEqual(brief(items), ["TEST Howl: Night tales ×4 [one,one-again,two,three]", "loose"], "two films of one number: the older first");
  assert.ok(items[0].kind === "series" && items[0].cover === "/vthumb/one-again.mp4" && items[0].latestWhen === list[0].when);
  // a list that is NOT newest first: the series still stands at its newest film's place
  const shuffled = [ep("two", 9, 2), { id: "loose", when: new Date(T0 - 2 * 3_600_000).toISOString() }, ep("three", 5, 3), ep("one", 30, 1)];
  assert.deepEqual(brief(archiveShelf(shuffled)), ["loose", "TEST Howl: Night tales ×3 [one,two,three]"]);
  // an episode number nothing can be made of counts as 1, and a time nothing can be made of as the oldest
  const odd = archiveShelf([{ id: "a", when: "not a time", series: { ...tag, episode: Number.NaN } }, ep("b", 3, 2)]);
  assert.deepEqual(brief(odd), ["TEST Howl: Night tales ×2 [a,b]"]);
});

test("a series is found by its key — and a key that matches nothing is no series at all", () => {
  const found = seriesOnShelf(SHELF, seriesKey("show", "showA"));
  assert.deepEqual([found?.title, found?.count, found?.episodes], ["TEST Howl: Night tales", 2, ["h1", "h2"]]);
  for (const k of ["", null, undefined, "nope", "f000000", seriesKey("film", "x1"), seriesKey("show", "u1")]) assert.equal(seriesOnShelf(SHELF, k), null, String(k));
  // a series whose every film a filter has hidden is not on that shelf
  assert.equal(seriesOnShelf(SHELF.filter((p) => !p.series), seriesKey("film", "u1")), null);
});

/* ---- THE PAGE ---- */
const src = read("app", "routes", "web.archive.tsx");
const cssAt = src.indexOf("const WA_CSS = `");
const css = src.slice(cssAt, src.indexOf("`;", cssAt));
const loader = src.slice(src.indexOf("export const loader"), src.indexOf("export const action"));
const page = src.slice(src.indexOf("export default function WebArchive()"));

test("the loader tags the films it already loaded — nothing more is read, and no id goes to the page", () => {
  assert.ok(src.includes('import { archiveShelf, episodeOwnLabel, seriesOnShelf, seriesTags, type SeriesItem } from "../lib/archive-series";'));
  assert.ok(loader.includes('const seriesTagOf = seriesTags(assets.filter((a) => a.type === "VIDEO_AD"));'), "worked out over the films of this page — no query, no await");
  assert.ok(loader.includes("series: seriesTagOf.get(a.id) || null,"));
  assert.ok(loader.indexOf("const seriesTagOf = ") < loader.indexOf("const mapAsset = "));
  // the show's own line is exactly what it was: its name and number, never its id
  assert.ok(loader.includes("const s = showMeta(JSON.parse(a.metaJson || \"{}\").show); return s ? { name: s.name, episode: s.episode } : null;"));
  // the module reads a film's meta and nothing else
  const lib = read("app", "lib", "archive-series.ts");
  assert.deepEqual([...lib.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]), ["./film-series.ts", "./character-series.ts"]);
  assert.ok(!/\bdb\.|react|\.server/.test(lib.replace(/\/\*[\s\S]*?\*\//g, "")), "pure: no database, no React, nothing server-only");
});

test("on the Videos tab a series is one card; inside an open series the shelf is its episodes in order", () => {
  // the open series comes from the address, at once (as a When chip lights at once), and only on Videos
  assert.ok(page.includes([
    '  const seriesGoing = nav.state === "loading" && nav.location && typeof window !== "undefined" && nav.location.pathname === window.location.pathname',
    '    ? new URLSearchParams(nav.location.search).get("series") || ""',
    "    : null;",
    '  const seriesAsked = (seriesGoing ?? searchParams.get("series") ?? "").slice(0, 40);',
  ].join("\n")));
  assert.ok(page.includes('const openSeries = tab === "video" && seriesAsked ? seriesOnShelf(shelf, seriesAsked) : null;'), "found on the tab's whole shelf — a chip cannot throw the member out of it");
  // what the chips sift, count and keep: its episodes in order — or the tab's shelf, as before
  assert.ok(page.includes("const sift = openSeries ? openSeries.episodes.flatMap((id) => { const a = pieceById.get(id); return a ? [a] : []; }) : shelf;"));
  assert.ok(page.includes("const clearingCount = sift.filter((a) => a.daysLeft != null).length;"));
  assert.ok(page.includes("const clearingIds = sift.filter((a) => a.daysLeft != null).map((a) => a.id);"), "\"Keep all\" inside a series keeps that series' own");
  assert.ok(page.includes('{t("All")} · {sift.length}</button>'));
  // the library's own lines are still the library's
  assert.ok(page.includes('const shelf = tab === "stills" ? stills : assets.filter((a) => A_KIND[a.type] === tab);'));
  assert.ok(page.includes("const tabTotal = totals?.[tab] ?? shelf.length;"));
  // what is drawn: series as cards on Videos, pieces everywhere else and inside a series
  assert.ok(page.includes([
    '  const shelfCards: ShelfCard[] = tab === "video" && !openSeries',
    '    ? archiveShelf(visibleShelf).flatMap((it): ShelfCard[] => { if (it.kind === "series") return [{ series: it }]; const a = pieceById.get(it.id); return a ? [{ a }] : []; })',
    "    : visibleShelf.map((a) => ({ a }));",
  ].join("\n")));
  assert.ok(page.includes("{shelfCards.map((c, k) => {"));
  assert.ok(page.includes("{visibleShelf.map((a) => {"), "the Articles rows are as they were");
  // the header of an open series: the way back, its title, how many — and its episodes say which they are
  const head = page.slice(page.indexOf("{openSeries && (\n        <div className=\"wa-serieshead\""), page.indexOf("{/* Finished pieces: poster-frame tiles"));
  assert.ok(head.includes('<Link to={shelfHref} preventScrollReset className="wa-series-back"><Ico n="arrow" size={13} /> {t("Back")}</Link>'));
  assert.ok(head.includes("<b>{openSeries.title}</b>") && head.includes("{episodesLabel(openSeries.count)}"));
  assert.ok(page.includes('const episodesLabel = (n: number) => (n === 1 ? t("1 episode") : t("{n} episodes", { n }));'));
  assert.ok(page.includes('{openSeries && a.series && <span className="wa-epno">{t("Episode {n}", { n: a.series.episode })}</span>}'));
  // an episode's own card is the card it always was (the lines other tests hold are still here)
  assert.ok(page.includes("onClick={() => (selecting ? togglePick(a.id) : setViewer(a))}"));
});

test("the address: a series is one more thing in it, and everything else in it is kept", () => {
  assert.ok(page.includes('const seriesHref = (key: string) => { const n = new URLSearchParams(searchParams); n.delete("open"); n.set("tab", tab); n.set("series", key); return `?${n.toString()}`; };'));
  assert.ok(page.includes('const shelfHref = (() => { const n = new URLSearchParams(searchParams); n.delete("open"); n.delete("series"); n.set("tab", tab); return `?${n.toString()}`; })();'));
  // what those two write (the search, the window, the collection, the section, how much is loaded — all kept)
  const here = "tab=video&when=week&q=howl&col=cm1col&section=creator&show=120";
  const seriesHref = (cur: string, tab: string, key: string) => { const n = new URLSearchParams(cur); n.delete("open"); n.set("tab", tab); n.set("series", key); return `?${n.toString()}`; };
  const shelfHref = (cur: string, tab: string) => { const n = new URLSearchParams(cur); n.delete("open"); n.delete("series"); n.set("tab", tab); return `?${n.toString()}`; };
  const inside = seriesHref(here, "video", "s20tc23n564z");
  assert.equal(inside, `?${here}&series=s20tc23n564z`);
  assert.equal(shelfHref(inside.slice(1), "video"), `?${here}`, "and Back is exactly where the member was");
  assert.equal(seriesHref("open=abc", "video", "f1"), "?tab=video&series=f1", "a piece is not re-opened by the way in");
  // a change of tab leaves the series; so does nothing else by accident
  assert.ok(page.includes("onClick={() => { setTab(k); setFilter(\"all\"); setWho(\"\"); setProd(\"\"); endSelect(); setSheet(false); leaveSeries(); }}>"));
  assert.ok(page.includes('const leaveSeries = () => { if (searchParams.get("series")) setSearchParams((p) => { const n = new URLSearchParams(p); n.delete("series"); return n; }, { replace: true, preventScrollReset: true }); };'));
  // ?open=<id> still opens a piece that is inside a series: it is looked for among EVERY loaded piece…
  assert.ok(page.includes("const it = assets.find((a) => a.id === openId);"));
  // …and its arrows walk its own series, in order
  assert.ok(page.includes("const viewerSeries = viewer?.series && tab === \"video\" && !cardPieces.some((c) => c.id === viewer.id) ? seriesOnShelf(visibleShelf, viewer.series.key) : null;"));
  assert.ok(page.includes("const vIdx = viewer ? viewShelf.findIndex((c) => c.id === viewer.id) : -1;"));
  assert.ok(page.includes("{viewShelf.length > 1 && vIdx >= 0 && ("));
  // opening brings the header to the top, leaving returns to the card, and a new shelf ends a selection
  const fx = page.slice(page.indexOf("const seriesWas = useRef<string | null>(null);"), page.indexOf("// \"Keep all\": what is on the clock"));
  assert.ok(fx.includes('seriesHead.current?.scrollIntoView({ block: "start" });'));
  assert.ok(fx.includes('?.scrollIntoView({ block: "center" });'));
  assert.equal(count(fx, "if (selecting) endSelect();"), 2);
  assert.ok(!fx.includes("smooth"), "no glide: it is simply there (and nothing to turn off for reduced motion)");
});

test("a series' card is a way in and nothing else: nothing on the page keeps, deletes or picks a whole series in one press", () => {
  const card = page.slice(page.indexOf("            if (c.series) {"), page.indexOf("            const a = c.a;"));
  assert.ok(card.length > 800 && card.length < 3200, "the series' card, and only it");
  assert.ok(card.includes("<Link key={`series|${s.key}`} to={seriesHref(s.key)} preventScrollReset data-series={s.key}"));
  for (const never of ["askDelete", "deleteAsset", "keepAsset", "togglePick", "picked", "submit(", "intent", "wa-icon", "wa-sel\"", "setViewer"]) assert.ok(!card.includes(never), never);
  // while pieces are being picked it stands aside — it cannot be tapped, tabbed to or ticked
  assert.ok(card.includes("className={`wb-asset wa-series${selecting ? \" off\" : \"\"}`} aria-disabled={selecting || undefined} tabIndex={selecting ? -1 : undefined}"));
  assert.ok(card.includes("onClick={(e) => { if (selecting) e.preventDefault(); }}"));
  // what it shows: its cover (a poster catches the light like any poster), the count, its title
  assert.ok(card.includes("const isPoster = !!s.cover && s.cover !== s.frame;"));
  assert.ok(card.includes('<span className="wa-series-tag"><Ico n="film" size={12} /> {episodesLabel(s.count)}</span>'));
  assert.ok(card.includes('<span className="wa-title">{s.title}</span>'));
  assert.ok(card.includes("el.src = s.frame;"), "a poster whose file is missing falls back to the film's first frame");
  // "Select all" and the Select button count the pieces that stand on the shelf as their own cards
  assert.ok(page.includes("const cardPieces = shelfCards.flatMap((c) => (c.a ? [c.a] : []));"));
  assert.ok(page.includes("onClick={() => setPicked(picked.size >= cardPieces.length ? new Set() : new Set(cardPieces.map((a) => a.id)))}>"));
  assert.ok(page.includes('{picked.size >= cardPieces.length ? t("Clear") : t("Select all {n}", { n: cardPieces.length })}'));
  assert.ok(page.includes('{tab !== "blog" && cardPieces.length >= 2 && ('));
  assert.ok(!page.includes("new Set(visibleShelf.map("), "never the episodes hidden inside a card");
  // the action has no way to act on a series either: it was not touched
  const action = src.slice(src.indexOf("export const action"), src.indexOf("/** Countdown text, or the truth"));
  assert.ok(action.length > 5000 && !/series/i.test(action), "the action does not know what a series is");
  // …and one piece is still deleted one way only: askDelete's timer (tests/archive-fixes.test.ts holds it too)
  assert.equal(count(src, "deleteAsset("), 1);
});

test("the series' card and header: a calm stack in the film section's own gold, 44px to the thumb, still for reduced motion", () => {
  // the two edges sit in the gap ABOVE the card, so the card is the size of its neighbours (16px gap; 12px on a phone)
  assert.ok(css.includes(".wb-asset.wa-series{position:relative;display:flex;flex-direction:column;overflow:visible;"));
  const edge = (re: RegExp) => { const m = css.match(re); assert.ok(m, String(re)); return m!.slice(1).map(Number); };
  const [nearTop] = edge(/\.wa-series::before\{left:7%;right:7%;top:-(\d+)px;opacity:\.72;\}/);
  const [farTop] = edge(/\.wa-series::after\{left:15%;right:15%;top:-(\d+)px;opacity:\.36;\}/);
  assert.ok(farTop > nearTop && farTop < 16, "inside the grid's 16px gap");
  const phoneAt = css.indexOf("@media(max-width:640px){\n  .wa-autonote{display:none;}");
  assert.ok(phoneAt > 0);
  const phone = css.slice(phoneAt, css.indexOf("\n}", phoneAt));
  const [pFar] = edge(/\.wa-series::after\{top:-(\d+)px;height:5px;\}/);
  assert.ok(phone.includes(`.wa-series::after{top:-${pFar}px;height:5px;}`) && pFar < 12, "inside the phone's 12px gap");
  assert.ok(css.includes(".wb-assets{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}"), "two across on a phone, as before");
  // gold on the app's own deep green (the owner on the first lobby's brown-black, 2026-11-24: "maybe we do
  // a dark green background instead of the brown") — and no brown-black left on any series surface
  assert.ok(css.includes("background:rgba(16,42,29,.92);color:#E7C879;font:800 11.5px/1.2 Poppins,sans-serif;"));
  assert.ok(!/1B1410|27,20,16/i.test(css.slice(css.indexOf(".wb-asset.wa-series{"))), "the series' surfaces are green");
  assert.ok(css.includes(".wa-serieshead{display:flex;align-items:center;gap:12px;margin:2px 0 14px;padding:10px 14px 10px 10px;border-radius:16px;background:#102A1D;color:#F6E7C1;"));
  // nothing here can push the page sideways: the title wraps, the text column may shrink
  assert.ok(css.includes(".wa-serieshead-txt{flex:1 1 auto;min-width:0;"));
  assert.ok(css.includes("font-weight:800;line-height:1.25;overflow-wrap:anywhere;}"));
  assert.ok(css.includes(".wa-series .m{overflow-wrap:anywhere;}"));
  assert.ok(!/\.wa-series[^{]*\{[^}]*\b(?:width|min-width):\s*\d{3,}px/.test(css), "no fixed width anywhere in it");
  // the way back is 44px on a phone; the card itself is a whole card
  assert.ok(phone.includes(".wa-series-back{min-height:44px;}"));
  // the back arrow points back — and the other way where the page reads right to left
  assert.ok(css.includes(".wa-series-back svg{transform:scaleX(-1);}") && css.includes('[dir="rtl"] .wa-series-back svg{transform:none;}'));
  assert.ok(css.includes("inset-inline-start:8px;"), "the tag sits at the start edge in either direction");
  // reduced motion: the edges hold still (the cover's own light is the poster's rule, held elsewhere)
  assert.ok(css.includes("@media(prefers-reduced-motion:reduce){.wa-series::before,.wa-series::after{transition:none;}.wa-series:hover::before,.wa-series:hover::after{transform:none;}}"));
  assert.ok(css.includes("@media(hover:hover){\n  .wa-series:not(.off):hover::before{transform:translateY(-1px);}"), "a pointer only");
});

/* ---- THE TOP OF THE ARCHIVE ON A PHONE ---- */

test("on a phone every filter lives behind ONE button — and each is exactly the control it was", () => {
  const bar = src.slice(src.indexOf('<div className="wa-bar">'), src.indexOf("{/* COLLECTIONS (2026-11-22): a new one from the Collections menu"));
  // the order in the bar: search, its chip, Filter, the panel — holding the three groups of filters — Select, the count
  const at = ['<Form method="get" className="wa-search"', '<span className="wa-qchip">', "className={`wa-filterchip wa-filterbtn", '<div id="wa-sheet"', '<div className="wa-filters wa-when"', '<div className="wa-filters" role="group" aria-label={t("Filter pieces")}>', '<div className="wa-filters wa-pick"', "        </div>\n        {/* Select mode: tap pieces, then Keep or Delete them together */}", "wa-filterchip wa-selbtn", "<p className={`wa-count"].map((s) => bar.indexOf(s));
  assert.ok(at.every((v) => v > 0), `all there (${at.join(", ")})`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, "in that order: the panel wraps the filters and nothing else");
  // the button: how many are on, and whether its panel is open
  assert.ok(bar.includes('<button type="button" className={`wa-filterchip wa-filterbtn${filtersOn > 0 ? " on" : ""}`} aria-expanded={sheet} aria-controls="wa-sheet" onClick={() => setSheet((v) => !v)}>'));
  assert.ok(bar.includes('<Ico n="sliders" /> {t("Filter")}{filtersOn > 0 && <b className="wa-filterbtn-n">{filtersOn}</b>}'));
  // a choice made in the panel shuts it: a chip (link or button) by its click, a menu by its change — the
  // chips' own handlers are not touched
  assert.ok(bar.includes('onClick={(e) => { if ((e.target as Element).closest("a.wa-filterchip, button.wa-filterchip")) setSheet(false); }} onChange={() => setSheet(false)}>'));
  // WHAT IT HOLDS IS UNCHANGED: the same links (same address), the same buttons, the same counts
  assert.ok(bar.includes('<Link key={k} to={whenHref(k)} preventScrollReset className={`wa-filterchip${whenLit === k ? " on" : ""}`} aria-current={whenLit === k ? "true" : undefined} onClick={endSelect}>'));
  assert.ok(bar.includes('onClick={() => setFilter("films")}><Ico n="film" /> {t("Films")} · {filmCount}</button>'));
  assert.ok(bar.includes('onClick={() => setFilter("clearing")}><Ico n="hourglass" /> {t("Clearing soon")} · {clearingCount}</button>'));
  assert.ok(bar.includes('<select value={prod} onChange={(e) => setProd(e.target.value)} aria-label={t("Product")}>'));
  assert.ok(page.includes('const whenHref = (k: AWhen) => `?tab=${tab}${k !== "all" ? `&when=${k}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}${colQ}${isCreator ? "&section=creator" : ""}`;'));
  // no button when there is nothing to sift
  assert.ok(page.includes("const sheetHas = showWhen || canFilter || whoOpts.length > 1 || prodOpts.length > 1 || !!who || !!prod || collections.length > 0;"));
  assert.ok(bar.includes("{sheetHas && (\n          <button type=\"button\" className={`wa-filterchip wa-filterbtn"));

  // THE CSS. A wide screen: no button, and the panel is not a box — its chips stand in the bar as they did
  assert.ok(css.includes(".wa-filterbtn,.wa-onfilters,.wa-foot,.wa-cd.wa-cd-st{display:none;}"));
  assert.ok(css.includes(".wa-sheet{display:contents;}"));
  const phoneAt = css.indexOf("@media(max-width:640px){\n  .wa-autonote{display:none;}");
  const phone = css.slice(phoneAt, css.indexOf("\n}", phoneAt));
  // a phone: ONE row — the search box takes what is left, Filter and Select beside it…
  assert.ok(phone.includes(".wa-bar .wa-search{order:0;flex:1 1 0;min-width:0;}"));
  assert.ok(phone.includes(".wa-filterbtn{display:inline-flex;order:1;flex:0 0 auto;}"));
  assert.ok(phone.includes(".wa-bar .wa-selbtn{order:2;flex:0 0 auto;align-self:center;}"));
  // …and what is not always there takes a row only when it is: the search's chip, the open panel
  assert.ok(phone.includes(".wa-bar .wa-qchip{order:3;flex:1 1 100%;"));
  assert.ok(phone.includes(".wa-sheet{order:4;flex:1 1 100%;display:none;flex-direction:column;"));
  assert.ok(phone.includes(".wa-sheet.open{display:flex;animation:waSheetIn .18s ease;}"));
  assert.ok(css.includes("@media(prefers-reduced-motion:reduce){.wa-sheet.open{animation:none;}}"));
  // inside the panel the date chips WRAP (in the bar they scroll sideways, edge to edge: that rule is still there)
  assert.ok(phone.includes(".wa-sheet .wa-when{flex-wrap:wrap;overflow:visible;max-width:100%;margin-inline:0;padding:0;}"));
  assert.ok(css.includes("@media(max-width:640px){.wa-when{flex:1 1 100%;max-width:none;margin-inline:-16px;padding-inline:16px;}.wa-when .wa-filterchip{min-height:44px;}}"));
  assert.ok(phoneAt > css.indexOf("@media(max-width:640px){.wa-when{flex:1 1 100%;"), "…and this comes after it");
  // everything in it is a .wa-filterchip — 44px on a phone by the page's own rule; so is the Filter button
  assert.ok(css.includes("@media(max-width:640px){.wa-filterchip{min-height:44px;box-sizing:border-box;}}"));
  // all of this was added AFTER the page's older phone rules, which other tests cut out by position
  assert.ok(css.indexOf("SERIES ON THE SHELF") > css.indexOf(".wa-toast-link{display:inline-flex;align-items:center;box-sizing:border-box;}"));
  assert.ok(css.indexOf("44px tap-target floor") < css.indexOf("SERIES ON THE SHELF"));
});

test("a filter that is on is never out of sight: one quiet line names it, with a one-tap Clear", () => {
  assert.ok(page.includes([
    "  const onLabels = [",
    '    whenOpen !== "all" ? t(WHEN_LABEL[whenOpen]) : "",',
    '    chipOn ? t(filter === "films" ? "Films" : filter === "faceless" ? "Faceless" : filter === "clearing" ? "Clearing soon" : "Kept") : "",',
    "    who,",
    "    prod.length > 42 ? `${prod.slice(0, 40)}…` : prod,",
    "  ].filter(Boolean);",
    "  const filtersOn = onLabels.length + (colOpen ? 1 : 0);",
  ].join("\n")), "the words on the chips themselves; the open collection is counted, and named by its own line");
  assert.ok(page.includes("const chipOn = canFilter && filter !== \"all\";"));
  assert.ok(page.includes([
    "      {onLabels.length > 0 && (",
    '        <p className="wa-onfilters" role="status">',
    '          <Ico n="sliders" size={13} /> <span>{onLabels.join(" · ")}</span>',
    '          <button type="button" className="wa-linkbtn" onClick={clearFilters}>{t("Clear")}</button>',
    "        </p>",
    "      )}",
  ].join("\n")));
  // Clear: the chips and menus at once, and the window through the address — the search, the collection and
  // an open series each keep their own way out
  const clear = page.slice(page.indexOf("const clearFilters = () => {"), page.indexOf("// The way to auto-posting, in one line"));
  assert.ok(clear.includes('setFilter("all"); setWho(""); setProd(""); setSheet(false);'));
  assert.ok(clear.includes('if (whenOpen === "all") return;'), "no trip to the server when only chips were on");
  assert.ok(clear.includes('n.delete("when"); n.delete("show"); n.delete("open"); n.set("tab", tab);'));
  assert.ok(!clear.includes('n.delete("q")') && !clear.includes('n.delete("col")') && !clear.includes('n.delete("series")'));
  const cleared = (cur: string, tab: string) => { const n = new URLSearchParams(cur); n.delete("when"); n.delete("show"); n.delete("open"); n.set("tab", tab); return `?${n.toString()}`; };
  assert.equal(cleared("tab=video&when=week&q=howl&col=cm1col&show=120&series=s1", "video"), "?tab=video&q=howl&col=cm1col&series=s1");
  // what the line and the number say, filter by filter
  const on = (o: { when?: string; chip?: string; who?: string; prod?: string; col?: boolean }) => {
    const labels = [o.when || "", o.chip || "", o.who || "", o.prod || ""].filter(Boolean);
    return [labels.join(" · "), labels.length + (o.col ? 1 : 0)] as const;
  };
  assert.deepEqual(on({}), ["", 0], "nothing on: no line, no number");
  assert.deepEqual(on({ when: "This week", chip: "Films" }), ["This week · Films", 2]);
  assert.deepEqual(on({ col: true }), ["", 1], "a collection alone: the number, and its own line below");
  assert.deepEqual(on({ chip: "Clearing soon", prod: "TEST Blue Mug", col: true }), ["Clearing soon · TEST Blue Mug", 3]);
  // a phone's line: a wide screen shows the lit chips themselves
  const phoneAt = css.indexOf("@media(max-width:640px){\n  .wa-autonote{display:none;}");
  const phone = css.slice(phoneAt, css.indexOf("\n}", phoneAt));
  assert.ok(phone.includes(".wa-onfilters{display:flex;align-items:center;gap:8px;"));
  assert.ok(phone.includes(".wa-onfilters > span{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}"), "one line, however many are on");
  assert.ok(phone.includes(".wa-onfilters .wa-linkbtn{flex:0 0 auto;min-width:44px;min-height:44px;"), "Clear is 44px to the thumb both ways");
});

test("the two explanatory lines leave the top of a phone: older pieces are asked for at the END of the shelf, the notes at the foot", () => {
  const phoneAt = css.indexOf("@media(max-width:640px){\n  .wa-autonote{display:none;}");
  const phone = css.slice(phoneAt, css.indexOf("\n}", phoneAt));
  // "Showing 60 of 208 videos. Show older pieces" — the bar's line is a wide screen's…
  assert.ok(phone.includes(".wa-bar .wa-count{display:none;}"));
  // …and at the end of the shelf it is offered on exactly the same terms, at every width
  const older = page.slice(page.indexOf("{/* OLDER PIECES, ASKED FOR WHERE THEY ARE WANTED"), page.indexOf("{/* Wipeouts live below the finished work"));
  assert.ok(older.includes("{nextShow != null && shelf.length < tabTotal && (\n        <p className=\"wa-older\">"));
  assert.ok(src.includes("        {nextShow != null && shelf.length < tabTotal && (\n          // The oldest pieces are the ones nearest the 30-day clear"), "the bar's own condition, word for word");
  assert.ok(older.includes('<Link to={olderHref} preventScrollReset className="wa-older-btn">{t("Show older pieces")} →</Link>'));
  assert.ok(page.indexOf("{shelfCards.map((c, k) => {") < page.indexOf('<p className="wa-older">'), "after the last card");
  // the same address with more loaded — and everything else in it kept (an open series too)
  assert.ok(page.includes('const olderHref = (() => { const n = new URLSearchParams(searchParams); n.delete("open"); n.set("tab", tab); n.set("show", String(nextShow ?? "")); return `?${n.toString()}`; })();'));
  const olderHref = (cur: string, tab: string, nextShow: number) => { const n = new URLSearchParams(cur); n.delete("open"); n.set("tab", tab); n.set("show", String(nextShow)); return `?${n.toString()}`; };
  assert.equal(olderHref("tab=video&when=month&q=x&col=c1&section=creator&series=s9", "video", 120), "?tab=video&when=month&q=x&col=c1&section=creator&series=s9&show=120");
  assert.equal(olderHref("tab=video&show=120", "video", 180), "?tab=video&show=180");
  // (inside an open series the bar's line steps aside on a wide screen too: its link would leave the series)
  assert.ok(page.includes("<p className={`wa-count${openSeries ? \" in-series\" : \"\"}`}>") && css.includes(".wa-count.in-series{display:none;}"));
  assert.ok(phone.includes(".wa-older-btn{min-height:44px;}"));

  // "Un-kept videos & photos clear after 30 days…" — at the foot on a phone; up top only while "Clearing
  // soon" is on, which is where "Keep all" is
  assert.ok(page.includes("<p className={`wa-shelfnote wa-clearnote${filter === \"clearing\" ? \" is-rescue\" : \"\"}`}><Ico n=\"hourglass\" /> {t(\"Un-kept videos & photos clear after 30 days — open a piece and tap the heart to save it for good.\")}"));
  assert.ok(phone.includes(".wa-clearnote{display:none;}") && phone.includes(".wa-clearnote.is-rescue{display:flex;}"));
  const foot = page.slice(page.indexOf('<div className="wa-foot">'), page.indexOf("{/* Fullscreen viewer: media plays big"));
  assert.ok(foot.includes('{(tab === "video" || tab === "image") && shelf.some((a) => a.daysLeft != null) && filter !== "clearing" && ('), "never said twice");
  assert.ok(foot.includes('{t("Un-kept videos & photos clear after 30 days — open a piece and tap the heart to save it for good.")}'));
  // the way to auto-posting: one line, under the heading on a wide screen, at the foot on a phone
  assert.equal(count(page, "{autoNote}"), 2);
  assert.ok(foot.includes("{autoNote}"));
  assert.ok(phone.includes(".wa-autonote{display:none;}") && phone.includes(".wa-foot .wa-autonote{display:flex;margin:0;}"));
  assert.ok(phone.includes(".wa-foot{display:block;"));
  assert.ok(page.indexOf('<div className="wa-foot">') > page.indexOf('<div className="wa-failsec">'), "the foot of the page: after everything on the shelf");
});

test("a card on a phone: its cover, its title, when — and ONE badge, on the cover", () => {
  const phoneAt = css.indexOf("@media(max-width:640px){\n  .wa-autonote{display:none;}");
  const phone = css.slice(phoneAt, css.indexOf("\n}", phoneAt));
  // the row of chip + download + delete under every title is a wide screen's: those three live in the opened
  // piece (Download, Delete) and in Select — the JSX is all still there
  assert.ok(phone.includes(".wa-tileacts{display:none;}"));
  assert.ok(page.includes('<div className="wa-tileacts">\n                    <span className={`wa-chip ${cc}`}>{cl}</span>'));
  const viewer = page.slice(page.indexOf("{viewer && mounted ? createPortal("), page.indexOf("{/* Delete / retry confirmation toast."));
  assert.ok(viewer.includes('download={dlName(viewer.title, viewer.isVideo, viewer.isAudio)}><Ico n="download" /> {t("Download")}</a>'));
  assert.ok(viewer.includes('onClick={() => askDelete(viewer.id)}>{armedDel === viewer.id ? t("Tap again to delete") : t("Delete")}</button>'));
  // ONE badge: the countdown for a piece on the clock; "Kept" / "Posted" for one that is not — never both
  // (only an un-kept piece has a countdown: the loader sets daysLeft for a PENDING video or image alone)
  assert.ok(loader.includes('const unkeptMedia = a.status === "PENDING" && (a.type === "VIDEO_AD" || a.type === "IMAGE_AD");'));
  assert.ok(page.includes('{isKept(a) && a.media && <span className="wa-cd wa-cd-st"><Ico n={a.status === "PUBLISHED" ? "check" : "heart"} /> {cl}</span>}'));
  assert.ok(page.includes('const isKept = (a: { status: string }) => a.status === "APPROVED" || a.status === "PUBLISHED";'));
  assert.ok(phone.includes(".wa-cd.wa-cd-st{display:block;}"));
  // the words under the cover: the title (three lines at most) and the date — "Video" is what the tab already says
  // (inside an opened series an episode is called by its own name — the band above already says the series')
  assert.ok(page.includes('<span className="wa-title">{openSeries && a.series ? episodeOwnLabel(a.title) : a.title}</span>'));
  assert.ok(page.includes('<div className="s"><span className="wa-kind">{a.isVideo ? t("Video") : a.isAudio ? t("Music") : t("Image ad")} · </span><span suppressHydrationWarning>{new Date(a.when).toLocaleDateString()}</span></div>'));
  assert.ok(phone.includes(".wa-kind{display:none;}"));
  assert.ok(phone.includes(".wa-title{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;}"));
  // nothing on it is smaller than it was: the title is the wide screen's 13px, the date 11px
  const size = (re: RegExp) => { const m = phone.match(re); assert.ok(m, String(re)); return Number(m![1]); };
  assert.ok(size(/\.wb-asset \.m\{padding:9px 10px 11px;font-size:([\d.]+)px;line-height:1\.3;\}/) >= 13);
  assert.ok(size(/\.wb-asset \.s\{font-size:([\d.]+)px;margin-top:3px;\}/) >= 11);
  // while selecting, the Select button is its lit tick alone (the bar below has "Done") — its name stays for a screen reader
  assert.ok(page.includes('<Ico n="check" /> <span className="wa-selbtn-l">{selecting ? t("Done selecting") : t("Select")}</span>'));
  assert.ok(phone.includes(".wa-selbtn.on .wa-selbtn-l{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}"));
});

test("every word of it is in all five languages", () => {
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Series", "Filter", "1 episode", "{n} episodes", "All episodes", "Episode {n}", "Back", "Clear", "Show older pieces", "Showing", "Kept", "Posted", "Films", "Faceless", "Clearing soon"]) {
    assert.ok(dict.split(`\n  ${J(k)}:`).length - 1 >= 5, k);
  }
});

test("inside its series an episode is called by its own name", () => {
  // the band above the cards says the series' name; the small line above each title says which episode
  assert.equal(episodeOwnLabel("The Lighthouse Keeper — Episode 2: The Storm"), "The Storm");
  assert.equal(episodeOwnLabel("Howl: Night tales — Episode 3: What The Lake Keeps"), "What The Lake Keeps");
  assert.equal(episodeOwnLabel("Night tales — Episode 12 — The Long Way Round"), "The Long Way Round");
  assert.equal(episodeOwnLabel("Night tales - Ep. 4: Low Tide"), "Low Tide");
  // a colon that belongs to the SHOW's name is not an episode's ("Howl: Night tales")
  assert.equal(episodeOwnLabel("Howl: Night tales"), "Howl: Night tales");
  // no name of its own after its number: it stays whole (episode 1 is the first film, called what it was called)
  assert.equal(episodeOwnLabel("Short Story — The Lighthouse Keeper"), "Short Story — The Lighthouse Keeper");
  assert.equal(episodeOwnLabel("The Lighthouse Keeper — Episode 2"), "The Lighthouse Keeper — Episode 2");
  assert.equal(episodeOwnLabel("The Lighthouse Keeper — Episode 2: "), "The Lighthouse Keeper — Episode 2:");
  assert.equal(episodeOwnLabel(""), "");
  assert.equal(episodeOwnLabel(null), "");
});
