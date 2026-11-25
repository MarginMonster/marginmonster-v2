/* "NEXT EPISODE" LIVES WHERE THE FILM IS WATCHED.
 *
 * The cards for a next episode were only on the Movie Maker's poster page. A finished film is watched in the
 * Archive — that is where "what happens next?" is asked — so a story film's viewer has the button, and the
 * Movie Maker opens straight on that series' next episode. Asked from episode 1 when episode 2 is already
 * made, it is episode 3: a series continues from its latest episode and never forks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { episodeCardFor, latestEpisode, seriesKeyOf } from "../app/lib/film-series.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const J = JSON.stringify;

const film = (id: string, title: string, meta: Record<string, unknown>, video = `/renders/${id}.mp4`) => ({
  id, title, metaJson: J({ kind: "testmovie", template: "testmovie", aspect: "16:9", engine: "kling3", scenes: 4, ...meta }), bodyJson: J({ videoUrl: video, treatment: { title: title.replace(/^Short Film — /, ""), scenes: [] } }),
});
const ep1 = film("ep1", "Short Film — One Umbrella", {});
const ep2 = film("ep2", "Short Film — One Umbrella — Episode 2: The Café", { series: { id: "ep1", title: "One Umbrella", episode: 2 }, cast: [{ name: "Omar", faceUrl: "/avatars/omar_0.jpg", voiceId: "v1" }] });
const other = film("x1", "Short Film — Last Train", {});
const mv = { id: "mv1", title: "Music Video — Neon Rain", metaJson: J({ kind: "musicvideo" }), bodyJson: J({ videoUrl: "/renders/mv1.mp4" }) };

test("a film's series key is the id of the film that started the series", () => {
  assert.equal(seriesKeyOf(ep1), "ep1");
  assert.equal(seriesKeyOf(ep2), "ep1");
  assert.equal(seriesKeyOf(other), "x1");
});

test("asked from any episode, the card is for the series' LATEST episode", () => {
  const rows = [ep2, other, ep1]; // newest first, as the loader reads them
  const fromFirst = episodeCardFor("ep1", rows);
  assert.equal(fromFirst?.from, "ep2", "continues from episode 2, not from the film that was tapped");
  assert.equal(fromFirst?.episode, 3);
  assert.equal(fromFirst?.title, "One Umbrella");
  assert.deepEqual(fromFirst?.setup.cast.map((c) => c.name), ["Omar"], "and with the cast the latest episode kept");
  assert.deepEqual(episodeCardFor("ep2", rows), fromFirst, "the same card whichever episode asks");
  // a film that is a series of one
  const single = episodeCardFor("x1", rows);
  assert.equal(single?.from, "x1");
  assert.equal(single?.episode, 2);
  assert.equal(single?.title, "Last Train");
});

test("the server does not trust the page: named an older episode, it still continues from the latest", () => {
  // (a hand-made request named episode 1 on the live site and got a second "Episode 2", 2026-11-23)
  assert.equal(latestEpisode(ep1, [ep2, other, ep1]).id, "ep2");
  assert.equal(latestEpisode(ep2, [ep2, ep1]).id, "ep2");
  assert.equal(latestEpisode(other, [ep2, other, ep1]).id, "x1", "another series is never mixed in");
  assert.equal(latestEpisode(ep1, []).id, "ep1", "nothing found: the film that was named");
  // an unfinished later episode is not continued from
  const ep3 = film("ep3", "Short Film — One Umbrella — Episode 3", { series: { id: "ep1", title: "One Umbrella", episode: 3 } }, "");
  assert.equal(latestEpisode(ep1, [ep3, ep2, ep1]).id, "ep2");
});

test("only a finished story film of the rows given can be continued", () => {
  assert.equal(episodeCardFor("nope", [ep2, ep1]), null, "not one of this shop's films");
  assert.equal(episodeCardFor("mv1", [mv, ep1]), null, "a music video is never a series");
  assert.equal(episodeCardFor("", [ep1]), null);
  // the latest episode has no video yet (still rendering, or lost): the one before it is the latest FINISHED one
  const ep3 = film("ep3", "Short Film — One Umbrella — Episode 3", { series: { id: "ep1", title: "One Umbrella", episode: 3 } }, "");
  const card = episodeCardFor("ep1", [ep3, ep2, ep1]);
  assert.equal(card?.from, "ep2");
  assert.equal(card?.episode, 3);
});

test("the Archive viewer offers it on a story film, and the Movie Maker opens that episode once", () => {
  const archive = read("app", "routes", "web.archive.tsx");
  // (2026-11-25: what a piece offers next is its MARK — film-series.ts → nextMarks — and the viewer's button is a
  //  primary one, the first in its row, worded as the card is; it names the series' LATEST film, which is the one
  //  continued from. tests/make-it-a-series.test.ts holds the rest.)
  assert.ok(archive.includes("const m: NextMark | undefined = a.type === \"VIDEO_AD\" ? nextOf.get(a.id) : undefined;"));
  // (…and a found-footage piece's leads to its own builder, as its next night — S10c: nextHref, nextTitle)
  assert.ok(archive.includes("{viewer.next && viewer.media && !viewer.expired && <a className=\"wa-vbtn full wa-vnext\" href={nextHref(viewer.next)} title={nextTitle(viewer.next)}><Ico n={viewer.next.footage ? \"camera\" : \"filmreel\"} /> {viewer.next.state === \"start\" ? t(\"Make it a series\") : viewer.next.footage ? t(\"Film night {n}\", { n: viewer.next.night || viewer.next.next }) : t(\"Make episode {n}\", { n: viewer.next.next })}<span className=\"c\">{t(\"Picks up where it left off\")}</span></a>}"));
  assert.ok(archive.includes("const nextHref = (n: Pick<PieceNext, \"from\" | \"footage\">) => (n.footage ? `/web/found-footage?next=${n.from}` : `/web/film?episode=${n.from}`);"));
  assert.ok(archive.includes("const nextTitle = (n: Pick<PieceNext, \"footage\">) => (n.footage ? t(\"Continue this footage — the next night, on the same camera\") : t(\"Continue this story — the next episode, with the same cast\"));"));
  assert.ok(archive.includes("import { storyHeroOf } from \"../lib/film-series\";"));
  assert.ok(archive.includes("import { continuable, nextMarks, seriesKeyOf, type NextMark } from \"../lib/film-series\";"));

  const film = read("app", "routes", "web.film.tsx");
  // the id from the address is reduced to id characters before it goes anywhere near a query
  assert.ok(film.includes("const askedEpisode = (new URL(request.url).searchParams.get(\"episode\") || \"\").replace(/[^A-Za-z0-9_-]/g, \"\").slice(0, 64);"));
  // only this shop's own films are read
  assert.ok(film.includes("const one = await db.asset.findFirst({ where: { id: askedEpisode, shopId: shop.id, type: \"VIDEO_AD\", status: { not: \"FAILED\" } }, select: pick });"));
  assert.ok(film.includes("where: { shopId: shop.id, type: \"VIDEO_AD\", status: { not: \"FAILED\" }, id: { not: one.id }, metaJson: { contains: `\"id\":\"${seriesKeyOf(one).replace(/[^A-Za-z0-9_-]/g, \"\")}\"` } },"));
  assert.ok(film.includes("openEpisode = episodeCardFor(askedEpisode, rows);"));
  assert.ok(film.includes("if (openEpisode) await castBack(openEpisode, rows);"), "an older film gets its cast back here too");
  // the page opens it once, and tidies the address so a refresh starts from the posters
  assert.ok(film.includes("if (!d.openEpisode || openedEpisode.current) return;"));
  assert.ok(film.includes("startEpisode(d.openEpisode);"));
  assert.ok(film.includes("navigate(\"/web/film\", { replace: true, preventScrollReset: true });"), "through the router — history.replaceState behind its back did not hold");
  assert.ok(!film.includes("window.history.replaceState("));
});

test("the new sentence is in all five languages", () => {
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  assert.equal(dict.split("\"Continue this story — the next episode, with the same cast\":").length - 1, 5);
  assert.ok(dict.split("\"Next episode\":").length - 1 >= 5);
});
