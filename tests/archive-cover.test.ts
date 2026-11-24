/* A COVER FOR EVERY PIECE — the Archive's shelf, sorted by eye (archive-cover.ts).
 *
 * The owner, 2026-11-24: "Each creation in archive needs its own cover like the films (dedicated style) like
 * music, horror, narration, better segregation this way".
 *
 * Every video and every track wears a cover in its FAMILY's style — a told story its poster, an acted film a
 * marquee, horror a black one-sheet, music a record sleeve, an ad the Ad Maker's green, a Creator video a
 * sticker, found footage a viewfinder. The Archive makes them itself, on demand, from what each piece
 * already has. Drawn from real pictures and LOOKED at on 2026-11-24 (scratchpad covers/render.mjs) before any
 * of this was pinned — and what looking found is pinned too: a frame from inside a video arrived after the
 * shapes drawn beside it and two families came out with empty cards; a fine noise, blurred, left the horror
 * title clean; a crop set by the room left over cut the faces off a cartoon.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AD_LADDER, CAPTION_LINE, COVER_FAMILIES, COVER_H, COVER_LABEL, COVER_V, COVER_W, CREATOR_LADDER, FILM_LADDER, FOCUS_Y, FOOTAGE_LADDER,
  HORROR_LADDER, MUSIC_LADDER, bestFrame, billingLine, canDraw, coverAsk, coverGraph, coverKind, coverName, coverOf, coverText, coverWords, horrorGamma,
  cropWindow, cutToFit, emWidth, episodeLine, episodeOf, fitLines, fitTitle, frameScore, frameStats, frameTimes, framesGraph, localMedia,
  posterIsCover, safeBox, seedOf, storyLayout, type CoverFamily, type CoverSpec,
} from "../app/lib/archive-cover.ts";
import { POSTER_H, POSTER_W, posterDress, posterFilters } from "../app/lib/story-poster.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const V = (title: string, meta: Record<string, unknown> = {}, body: Record<string, unknown> = {}) => ({ type: "VIDEO_AD", title, meta, body });
const fam = (p: ReturnType<typeof V> | { type: string; title?: string; meta?: unknown; body?: unknown }) => { const k = coverKind(p); return k ? `${k.family}${k.kids ? "+kids" : ""}` : null; };

test("every piece is sorted into its family from what it already says about itself — as each pipeline writes it", () => {
  // SUNG (music-video-pipeline.server.ts; the older engine's kids' song; an A/B test of one)
  assert.equal(fam(V("Music Video — Neon Hearts", { kind: "musicvideo", template: "musicvideo", genre: "pop" }, { style: "MUSICVIDEO" })), "music");
  assert.equal(fam(V("Kids Music Video — Tidy Up Time", { kind: "film", template: "kidsmusicvideo" }, { style: "FILM" })), "music+kids");
  assert.equal(fam(V("Kids Music Video · Kling — X", { kind: "testmovie", template: "kidsmusic" })), "music+kids");
  // HORROR, told or acted (narrated-story.server.ts, film-dialogue.server.ts, the older film engine)
  assert.equal(fam(V("Horror Story — The Ferry at Night", { kind: "narrated", template: "horror" }, { style: "NARRATED" })), "horror");
  assert.equal(fam(V("Horror Film — The Knock", { kind: "testmovie", template: "horror" }, { style: "TESTMOVIE" })), "horror");
  assert.equal(fam(V("Horror Story — Old one", { kind: "film", template: "horror" })), "horror");
  // TOLD
  assert.equal(fam(V("Moral Story — The Warm Corner", { kind: "narrated", template: "moral" })), "story");
  assert.equal(fam(V("Short Story — Tide", { kind: "narrated", template: "testmovie" })), "story");
  assert.equal(fam(V("Moral Story — Older", { kind: "film", template: "moral" })), "story", "the older stills-and-clips engine told its films");
  // ACTED
  assert.equal(fam(V("Short Film — Finders, Keepers", { kind: "testmovie", template: "testmovie" })), "film");
  assert.equal(fam(V("Moral Film — The Wallet", { kind: "testmovie", template: "moral" })), "film");
  assert.equal(fam(V("Kids Cartoon — Pip", { kind: "testmovie", template: "kidstv" })), "film+kids");
  assert.equal(fam(V("Dialogue (Actors) — Two Friends", { kind: "avatardialogue", template: "avatardialogue" })), "film");
  assert.equal(fam(V("Engine test · fal · shot 2 of Short Film — X", { kind: "enginetest" })), "film");
  // FOUND FOOTAGE (take.server.ts)
  assert.equal(fam(V("Found Footage — The Hallway Smile", { kind: "take", template: "foundfootage" }, { style: "TAKE" })), "footage");
  // CREATOR: faceless, a described video (stamped, or known by its brief), an edit, a presenter with no product
  assert.equal(fam(V("Faceless video — Five Facts", { kind: "faceless" }, { style: "FACELESS" })), "creator");
  assert.equal(fam(V("Video — a cat surfing", { style: "PRODUCT_HIGHLIGHT", creative: true })), "creator");
  assert.equal(fam(V("Product video — a cat surfing", { style: "PRODUCT_HIGHLIGHT" }, { prompt: "Cinematic short video. A cat surfs." })), "creator");
  assert.equal(fam(V("Edited video — trim", { style: "VIDEO_EDIT" })), "creator");
  assert.equal(fam(V("Mara presents — My salon", { style: "AI_AVATAR", serviceMode: true })), "creator", "the talking head: the Ad Maker's \"No product\"");
  // ADS: everything else the Ad Maker made
  assert.equal(fam(V("Commercial — Snack Box", { style: "COMMERCIAL" }, { style: "COMMERCIAL", engine: "easymode-cinematic" })), "ad");
  assert.equal(fam(V("Mara presents — Glow Serum", { style: "AI_AVATAR", productTitle: "Glow Serum" })), "ad");
  assert.equal(fam(V("Pixar cartoon — Glow Serum", { style: "CARTOON" })), "ad");
  assert.equal(fam(V("Anthem — Glow Serum", { style: "JINGLE" })), "ad");
  assert.equal(fam(V("Product video — Glow Serum", { style: "UNBOXING" })), "ad");
  // pieces made before their pipeline wrote a kind: the name it gave them
  assert.equal(fam(V("Horror Film — No meta")), "horror");
  assert.equal(fam(V("Music Video — No meta")), "music");
  assert.equal(fam(V("Moral Film — No meta")), "film");
  assert.equal(fam(V("Short Story — No meta")), "story");
  assert.equal(fam(V("Found Footage — No meta")), "footage");
  assert.equal(fam(V("Commercial — No meta")), "ad");
  // a meta kept as text reads the same as one already read
  assert.equal(fam({ type: "VIDEO_AD", title: "x", meta: JSON.stringify({ kind: "take" }), body: "{" }), "footage");
  // a track is music; a picture is its own cover, an article a row
  assert.equal(fam({ type: "AUDIO", title: "lo-fi rain", meta: { kind: "song" } }), "music");
  assert.equal(coverKind({ type: "IMAGE_AD", title: "x" }), null);
  assert.equal(coverKind({ type: "BLOG_POST", title: "x" }), null);
  // seven families, each with its name under the tile
  assert.deepEqual([...COVER_FAMILIES].sort(), ["ad", "creator", "film", "footage", "horror", "music", "story"]);
  for (const f of COVER_FAMILIES) assert.ok(COVER_LABEL[f], f);
});

test("what a cover says is the piece's own: its title without the kind in front, and the names it bills", () => {
  const w = (p: ReturnType<typeof V>) => coverWords(p, coverKind(p)!);
  assert.deepEqual(w(V("Music Video — Neon Hearts", { kind: "musicvideo", featured: ["Sample Singer", "sample singer", ""] })), { title: "Neon Hearts", names: ["Sample Singer"] });
  assert.deepEqual(w(V("Mara presents — Glow Serum 30 ml", { style: "AI_AVATAR" })), { title: "Glow Serum 30 ml", names: ["Mara"] });
  assert.equal(w(V("Pixar cartoon — Glow Serum", { style: "CARTOON" })).title, "Glow Serum");
  assert.equal(w(V("Engine test · fal · ½ price · shot 2 of Short Film — The Knock", { kind: "enginetest" })).title, "The Knock");
  assert.equal(w(V("Found Footage — The Hallway Smile", { kind: "take" })).title, "The Hallway Smile");
  assert.equal(w(V("Faceless video — Five Facts", { kind: "faceless" })).title, "Five Facts");
  // a story's or a film's cast: who the maker cast, then the story's own — nobody twice, three at most
  const cast = w(V("Moral Story — The Warm Corner", { kind: "narrated", template: "moral", cast: [{ name: "Gallo" }, { name: "Pim" }], castCards: [{ name: "pim" }, { name: "Odile" }, { name: "Marta" }] }));
  assert.deepEqual(cast, { title: "The Warm Corner", names: ["Gallo", "Pim", "Odile"] });
  // an episode keeps its episode (the cover sets it on a line of its own)
  assert.equal(w(V("Horror Story — Howl: Night tales — Episode 3: The Door", { kind: "narrated", template: "horror" })).title, "Howl: Night tales — Episode 3: The Door");
  // an ad names nobody it was not told to; a Creator video names nobody
  assert.deepEqual(w(V("Commercial — Snack Box", { style: "COMMERCIAL", cast: [{ name: "Nope" }] })).names, []);
  assert.deepEqual(w(V("Video — a cat", { creative: true })).names, []);
});

test("a told story's poster IS its cover; every other family wears the Archive's own", () => {
  assert.deepEqual(COVER_FAMILIES.filter(posterIsCover), ["story"]);
  const ask = (family: CoverFamily, o: Partial<Parameters<typeof coverAsk>[0]> = {}) => coverAsk({ kind: { family, kids: false }, media: "/renders/mv-1-abc.mp4", expired: false, poster: null, cover: null, ...o });
  assert.equal(ask("story", { poster: "/renders/nar-1-poster.jpg" }), false, "a story with its poster asks for nothing");
  assert.equal(ask("story"), true, "a story made before posters gets one");
  for (const f of ["film", "horror"] as const) assert.equal(ask(f, { poster: "/renders/tm-1-poster.jpg" }), true, `${f}: its poster stays its poster; the shelf wears the family's cover`);
  assert.equal(ask("music", { expired: true }), false, "nothing for media that is gone");
  assert.equal(ask("music", { media: "https://replicate.delivery/x/out.mp4" }), false, "nothing for a provider's address");
  assert.equal(ask("music", { media: null }), false);
  assert.equal(ask("music", { cover: { v: COVER_V } }), false, "one made, once");
  assert.equal(ask("music", { cover: { v: COVER_V - 1 } }), true, "an older design is drawn again (and shown meanwhile)");
  assert.equal(coverAsk({ kind: null, media: "/renders/a.mp4", expired: false, poster: null, cover: null }), false);
  assert.equal(coverAsk({ kind: { family: "music", kids: false }, media: "/renders/song-1.mp3", expired: false, poster: null, cover: null }), true, "a track");
});

test("its record: a file of ours beside the media, the design's version in its name, one dot", () => {
  const tag = (id: string) => seedOf(`cover:${id}`).toString(36);
  assert.equal(coverName("/renders/mv-1794304903337-f19c58693526.mp4", "cmpiece1"), `mv-1794304903337-f19c58693526-${tag("cmpiece1")}-cover${COVER_V}.jpg`);
  assert.equal(coverName("/renders/song.one-x.mp3?x=1", "p"), `songone-x-${tag("p")}-cover${COVER_V}.jpg`, "one dot — the renders route serves nothing else");
  assert.equal(coverName("../../etc/passwd.mp4", "p"), `passwd-${tag("p")}-cover${COVER_V}.jpg`, "its bare name only");
  for (const n of [coverName("/renders/x y$z.mp4", "p"), coverName("", "")]) assert.ok(/^[a-zA-Z0-9_-]*-[a-z0-9]+-cover\d+\.jpg$/.test(n), n);
  // two pieces made from one file have covers of their own (the harness drew them over each other's)
  assert.notEqual(coverName("/renders/a.mp4", "cmpiece1"), coverName("/renders/a.mp4", "cmpiece2"));
  assert.ok(!coverName("/renders/a.mp4", "cmpiece1").includes("cmpiece1"), "the piece's id is not in the name");
  // …and what the record accepts is exactly what is written
  assert.deepEqual(coverOf({ cover: `/renders/${coverName("/renders/a.mp4", "cmpiece1")}` }), { src: `/renders/${coverName("/renders/a.mp4", "cmpiece1")}`, v: COVER_V });
  assert.deepEqual(coverOf({ cover: "/renders/mv-1-abc-cover1.jpg" }), { src: "/renders/mv-1-abc-cover1.jpg", v: 1 });
  assert.deepEqual(coverOf(JSON.stringify({ cover: "/renders/a-cover12.jpg" })), { src: "/renders/a-cover12.jpg", v: 12 });
  for (const bad of [{ cover: "https://evil.example/a-cover1.jpg" }, { cover: "/renders/../a-cover1.jpg" }, { cover: "/renders/a.b-cover1.jpg" }, { cover: "/renders/a-poster.jpg" }, { cover: "/renders/a-cover.jpg" }, { cover: 3 }, {}, null, "{"]) {
    assert.equal(coverOf(bad), null, JSON.stringify(bad));
  }
  assert.equal(localMedia("/renders/mv-1.mp4"), "mv-1.mp4");
  assert.equal(localMedia("/renders/song-1.mp3?v=2"), "song-1.mp3");
  for (const bad of ["https://fal.media/files/x.mp4", "/renders/../x.mp4", "/renders/x.jpg", "/uploads/x.mp4", "", null]) assert.equal(localMedia(bad), null, String(bad));
});

test("the picture: frames from inside the video, the best of them, its bars and its captions left out", () => {
  // never the first second (a fade from black, a title card) nor the end card
  const ts = frameTimes(40, 6);
  assert.equal(ts.length, 6);
  assert.ok(ts[0] >= 40 * 0.15 && ts[5] <= 40 * 0.85 && ts.every((t, i) => i === 0 || t > ts[i - 1]), JSON.stringify(ts));
  assert.deepEqual(frameTimes(0), [0]);
  assert.deepEqual(frameTimes(Number.NaN), [0]);
  // the analysis: each candidate a strip of grey, side by side, in ONE run
  assert.equal(framesGraph(1, 48, 86), "[0:v]scale=48:86,setsar=1,format=gray[o]");
  assert.ok(framesGraph(3, 48, 86).endsWith("[g0][g1][g2]hstack=inputs=3[o]"));
  // a candidate's numbers, from synthetic frames: black; letterboxed; lit and detailed
  const W = 10, H = 20;
  const frame = (f: (x: number, y: number) => number) => { const g = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = f(x, y); return g; };
  const black = frameStats(frame(() => 3), W, H, 0, W);
  assert.equal(frameScore(black), 0);
  const boxed = frameStats(frame((x, y) => (y < 4 || y >= 16 ? 2 : 90 + ((x * 37 + y * 53) % 90))), W, H, 0, W);
  assert.deepEqual([boxed.top, boxed.bottom], [0.2, 0.8], "the bars are found");
  const lit = frameStats(frame((x, y) => 60 + ((x * 37 + y * 53) % 140)), W, H, 0, W);
  assert.deepEqual([lit.top, lit.bottom], [0, 1]);
  assert.ok(frameScore(lit) > frameScore(boxed), "a full frame beats a letterboxed one");
  const flat = frameStats(frame(() => 128), W, H, 0, W);
  assert.ok(frameScore(lit) > frameScore(flat), "something in it beats nothing in it");
  const dim = frameStats(frame((x, y) => 18 + ((x + y) % 8)), W, H, 0, W);
  assert.ok(frameScore(dim) < frameScore(lit) * 0.2, "a frame nobody can see into is not a cover");
  assert.equal(bestFrame([black, boxed, lit, flat]), 2);
  assert.equal(bestFrame([black, black]), -1, "none worth a cover");
  // two candidates side by side in one strip: each read from its own columns
  const two = new Uint8Array(W * 2 * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W * 2; x++) two[y * W * 2 + x] = x < W ? 3 : 60 + ((x * 37 + y * 53) % 140);
  assert.equal(bestFrame([frameStats(two, W * 2, H, 0, W), frameStats(two, W * 2, H, W, W)]), 1);
  // a FINISHED video's captions: the cover stays above them — unless that would leave less than half
  assert.equal(CAPTION_LINE.tall, 0.6);
  assert.deepEqual(safeBox({ w: 720, h: 1280 }, { top: 0, bottom: 1 }, true), { top: 0, bottom: 0.6 });
  assert.deepEqual(safeBox({ w: 1280, h: 720 }, { top: 0, bottom: 1 }, true), { top: 0, bottom: 0.8 });
  assert.deepEqual(safeBox({ w: 720, h: 1280 }, { top: 0, bottom: 1 }, false), { top: 0, bottom: 1 }, "a still, a shot, a take: all of it");
  assert.deepEqual(safeBox({ w: 720, h: 1280 }, { top: 0.4, bottom: 0.9 }, true), { top: 0.4, bottom: 0.9 }, "a letterboxed picture is not cut to a sliver");
});

test("the crop: the largest window of the shape, inside the safe part, centred on where the eye goes", () => {
  const within = (c: { x: number; y: number; w: number; h: number }, W: number, H: number) => c.x >= 0 && c.y >= 0 && c.x + c.w <= W && c.y + c.h <= H && c.w % 2 === 0 && c.h % 2 === 0;
  // a tall frame of a finished video, cut to the shelf's 4:5 above its captions
  const tall = cropWindow({ w: 720, h: 1280 }, { top: 0, bottom: 0.6 }, 0.8);
  assert.ok(within(tall, 720, 1280) && tall.y + tall.h <= 0.6 * 1280 + 1, JSON.stringify(tall));
  assert.ok(Math.abs(tall.w / tall.h - 0.8) < 0.01);
  // an acted film's wide frame into the marquee's panel: the whole height, both faces (a third in from each side) kept
  const wide = cropWindow({ w: 1280, h: 720 }, { top: 0, bottom: 1 }, 800 / 636);
  assert.ok(within(wide, 1280, 720) && wide.h === 720 && wide.x < 1280 / 3 - 60 && wide.x + wide.w > (2 * 1280) / 3 + 60, JSON.stringify(wide));
  // (a crop set by the room LEFT OVER put a cartoon's faces under the panel's foot — it is centred on FOCUS_Y)
  assert.ok(FOCUS_Y > 0.35 && FOCUS_Y < 0.5);
  const panel = cropWindow({ w: 720, h: 1280 }, { top: 0, bottom: 0.6 }, 800 / 636);
  assert.ok(panel.y > 0 && panel.y + panel.h / 2 > 0.3 * 1280, "centred down toward the middle, not stuck to the top");
  // inside its bars
  const boxed = cropWindow({ w: 720, h: 1280 }, { top: 0.34, bottom: 0.66 }, 1);
  assert.ok(boxed.y >= 0.34 * 1280 - 1 && boxed.y + boxed.h <= 0.66 * 1280 + 1, JSON.stringify(boxed));
});

test("the words, set: real Poppins widths, as big as they fit, a colon kept and broken at, cut with an ellipsis", () => {
  assert.ok(emWidth("MOM") > emWidth("ILL") * 1.8, "the font's own widths, not a letter count");
  assert.equal(emWidth("灯塔"), 2);
  assert.deepEqual(fitLines("Howl: Night tales", 6, 2), ["Howl:", "Night tales"]);
  assert.deepEqual(fitLines("Neon Rooftop Nights", 100, 2), ["Neon Rooftop Nights"]);
  const zh = fitLines("灯塔守护人与邮差的故事", 4, 3);
  assert.ok(zh.length === 3 && zh.join("") === "灯塔守护人与邮差的故事", JSON.stringify(zh));
  // the biggest size it fits at — and every line inside its box
  const ladders: Array<[string, number, readonly (readonly [number, number])[], boolean]> = [
    ["film", 640, FILM_LADDER, false], ["horror", 680, HORROR_LADDER, true], ["music", 720, MUSIC_LADDER, false],
    ["ad", 704, AD_LADDER, false], ["creator", 600, CREATOR_LADDER, false], ["footage", 680, FOOTAGE_LADDER, true],
  ];
  for (const [name, box, ladder, caps] of ladders) {
    assert.ok(ladder.every(([s], k) => k === 0 || s < ladder[k - 1][0]), `${name}: sizes fall`);
    for (const title of ["Tide", "The Knock Next Door", "The Lighthouse Keeper Who Waited Every Tuesday for a Boat That Was Always on Time Until It Was Not", "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM"]) {
      const f = fitTitle(title, box, ladder, caps)!;
      assert.ok(f && f.lines.length >= 1 && f.lines.length <= ladder[0][1] + 2, `${name}: ${title}`);
      for (const ln of f.lines) assert.ok(emWidth(ln) * f.size <= box + 0.5, `${name} «${ln}» at ${f.size}px is ${Math.round(emWidth(ln) * f.size)} of ${box}`);
      if (caps) assert.equal(f.lines.join(" "), f.lines.join(" ").toUpperCase());
    }
    assert.equal(fitTitle("Tide", box, ladder, caps)!.size, ladder[0][0], `${name}: a short title is set big`);
  }
  const huge = "The Lighthouse Keeper Who Waited Every Tuesday for a Boat That Was Always on Time Until It Was Not, and Then Waited Some More";
  const long = fitTitle(huge, 600, CREATOR_LADDER)!;
  assert.ok(long.lines[long.lines.length - 1].endsWith("…") && long.size === CREATOR_LADDER[CREATOR_LADDER.length - 1][0] && long.lines.length === CREATOR_LADDER[CREATOR_LADDER.length - 1][1], JSON.stringify(long));
  assert.ok(cutToFit("Wandering wandering wandering", 6).endsWith("…") && emWidth(cutToFit("Wandering wandering wandering", 6)) <= 6);
  // only what can be drawn: no boxes, no letters left unjoined
  assert.equal(canDraw("Café — Ñandú"), true);
  assert.equal(canDraw("灯塔"), true);
  for (const s of ["Сказка", "قصة", "کہانی", "कहानी", "Ιστορία"]) { assert.equal(canDraw(s), false, s); assert.equal(fitTitle(s, 600, CREATOR_LADDER), null, s); }
  assert.equal(fitTitle("", 600, CREATOR_LADDER), null);
  // the billing: as many names as fit, in capitals, a dot between; a name that cannot be drawn is left off
  assert.equal(billingLine(["Omar", "Rosa"], 640, 24), "OMAR  ·  ROSA");
  assert.equal(billingLine(["Омар", "Rosa"], 640, 24), "ROSA");
  assert.ok(emWidth(billingLine(["Bartholomew Fitzwilliam", "Persephone Montgomery", "Alexandrina Featherstone"], 300, 24)) * 24 <= 300);
  // an episode on a line of its own
  assert.deepEqual(episodeOf("Howl: Night tales — Episode 3: The Door"), { title: "Howl: Night tales", episode: "Episode 3", episodeName: "The Door" });
  assert.equal(episodeLine(episodeOf("Howl: Night tales — Episode 3: The Door"), 640, 22), "EPISODE 3  ·  THE DOOR");
  assert.equal(episodeLine(episodeOf("Tide"), 640, 22), "");
});

const FONT = "C:\\fonts\\Poppins-Bold.ttf";
const pic = (w: number, h: number, top = 0, bottom = 1) => ({ w, h, safe: { top, bottom } });
const spec = (family: CoverFamily, o: Partial<CoverSpec> = {}): CoverSpec => ({ kind: { family, kids: false }, title: "TEST The Knock: Next Door", names: ["Omar", "Rosa"], font: FONT, picture: pic(720, 1280, 0, 0.6), seed: 42, stamp: "2026.11.24  03:12", seconds: 12, ...o });

test("each family's graph: one frame out, every picture's clock set to nought, every word drawable", () => {
  const graphs = Object.fromEntries(COVER_FAMILIES.map((f) => [f, coverGraph(spec(f))])) as Record<CoverFamily, string>;
  graphs.story = coverGraph(spec("story"));
  for (const [f, g] of Object.entries(graphs)) {
    assert.ok(g.endsWith(",format=yuvj444p[out]"), `${f}: [out], in full colour`);
    assert.equal(g.split("[out]").length - 1, 1, f);
    // a frame from inside a video arrives a moment after the shapes beside it: its clock is reset, or the
    // first frame out has an empty card (the ad and the sticker came out so — 2026-11-24)
    for (const m of g.matchAll(/\[(\d+):v\]([^;[]*)/g)) assert.ok(f === "story" || m[2].startsWith("setpts=PTS-STARTPTS,"), `${f}: input ${m[1]}`);
    // every drawn word: the font, no expansion (a "%" is a letter), no bare colon or quote inside the words
    const texts = [...g.matchAll(/drawtext=([^,]*?)text='([^']*)'/g)];
    assert.ok(texts.length >= 1, f);
    for (const t of texts) {
      assert.ok(t[1].startsWith("expansion=none:fontfile='C\\:/fonts/Poppins-Bold.ttf':"), `${f}: ${t[1]}`);
      assert.ok(!/(?:^|[^\\]):/.test(t[2]), `${f}: «${t[2]}»`);
    }
    // never sheets of translucent black stacked for a shade (they turn a picture green — story-poster.ts)
    assert.ok(!/(drawbox=[^,]*black@0\.[0-9]+:t=fill,){3}/.test(g), f);
  }
  // …and each family is its own: what only it draws
  assert.ok(graphs.film.includes("[base][bulbs]overlay=0:636") && graphs.film.includes("lutrgb=r='255'"), "the marquee's bulbs");
  assert.ok(graphs.horror.includes("colorbalance=rs=0.17") && graphs.horror.includes("[cc][cm]alphamerge[claw]") && graphs.horror.includes("blend=all_mode=multiply"), "drained, bloodied, clawed, worn");
  assert.ok(graphs.music.includes("[bg][disc]overlay=") && graphs.music.includes("[d3][sleeve]overlay=40:60"), "the record and its sleeve");
  assert.ok(graphs.ad.includes("geq=r='9+30*pow(1-Y/1000") && graphs.ad.includes("[a3][tag]overlay="), "the Ad Maker's green, the hang tag");
  assert.ok(graphs.creator.includes("rotate=-0.055:c=none") && graphs.creator.includes("[c3][lab]overlay="), "the tilted card, the label");
  assert.ok(graphs.footage.includes("text='REC'") && graphs.footage.includes("text='00\\:00\\:12'") && graphs.footage.includes("text='2026.11.24  03\\:12'"), "the viewfinder: REC, its length, its date");
  const marks = ["[bulbs]", "[claw]", "[disc]", "[tag]", "rotate=", "text='REC'"];
  for (const m of marks) assert.equal(COVER_FAMILIES.filter((f) => graphs[f].includes(m)).length, 1, `${m} belongs to one family`);
  // a kids' film: candy bulbs; a kids' song: a pink label
  assert.ok(coverGraph(spec("film", { kind: { family: "film", kids: true } })).includes("[m1]format=rgb24,geq=r='if("));
  assert.ok(coverGraph(spec("music", { kind: { family: "music", kids: true } })).includes("color=c=0xFF7AB6"));
  // an acted film cast from the member's presenters: their portraits side by side, the shares the whole width
  const cast = coverGraph(spec("film", { picture: null, portraits: [pic(768, 1024), pic(768, 1024), pic(768, 1024)] }));
  assert.ok(cast.includes("[f0][f1][f2]hstack=inputs=3[pic]"));
  assert.deepEqual([...cast.matchAll(/scale=(\d+):636:flags=lanczos/g)].map((m) => Number(m[1])), [267, 267, 266]);
  // a track: its sleeve is its own sound
  const track = coverGraph(spec("music", { picture: null }));
  assert.ok(track.startsWith("[0:a]dynaudnorm") && track.includes("showwavespic=") && !track.includes("[0:v]"));
  // horror lifts a DARK frame's middle tones before it crushes it (an acted horror's night interior came out a
  // black page with its face lost — 2026-11-24); a frame of ordinary light, or one never measured, is not lifted
  assert.equal(horrorGamma(undefined), 1);
  assert.equal(horrorGamma(140), 1);
  assert.ok(horrorGamma(44) > 1.3 && horrorGamma(44) <= 1.45 && horrorGamma(0) === 1.45);
  assert.ok(coverGraph(spec("horror", { picture: { ...pic(1280, 720), mean: 44 } })).includes(`saturation=0.22:gamma=${horrorGamma(44)},colorbalance`));
  assert.ok(!coverGraph(spec("horror", { picture: pic(1280, 720) })).includes("gamma="));
});

test("a told story's cover is its poster's very dress — a still cropped as its pipeline crops one", () => {
  const s = spec("story", { title: "TEST The Lantern Keeper", names: ["Tobias", "Ines"], picture: pic(720, 1280), still: true });
  const layout = storyLayout(s)!;
  assert.equal(coverGraph(s), `[0:v]${posterFilters(layout, FONT)},format=yuvj444p[out]`);
  // a frame of a finished video: cut above its captions first, then the same dress
  const g = coverGraph({ ...s, still: false, picture: pic(720, 1280, 0, 0.6) });
  assert.ok(g.startsWith("[0:v]setpts=PTS-STARTPTS,crop=") && g.endsWith(`,${posterDress(layout, FONT)},format=yuvj444p[out]`));
  assert.deepEqual([COVER_W, COVER_H], [POSTER_W, POSTER_H]);
  // a name no font here can draw is not billed; a title that cannot be drawn leaves the dress without words
  assert.equal(storyLayout({ title: "TEST Tide", names: ["Омар", "Ines"] })!.cast, "INES");
  assert.equal(storyLayout({ title: "Сказка", names: [] }), null);
});

test("the words the graph draws are the words the font is chosen for", () => {
  assert.equal(coverText({ title: "灯塔", names: ["Ines"], stamp: "2026.11.24  03:12" }), "灯塔 Ines 2026.11.24  03:12");
  assert.ok(Number.isInteger(seedOf("x")) && seedOf("x") === seedOf("x") && seedOf("x") !== seedOf("y"));
});

test("the server draws one piece at a time, from what the piece has, and a failure changes nothing", () => {
  const srv = read("app", "lib", "archive-cover.server.ts");
  assert.ok(!/repRun|anthropic|fal\.|replicate|spawnSync/i.test(srv.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "no model is asked, and nothing blocks the server");
  // never two for one piece; a few at a time; a short queue; a failure not retried for hours
  assert.ok(srv.includes("const same = drawing.get(key);\n  if (same) return same;"));
  assert.ok(srv.includes("export const COVER_AT_ONCE = 2;") && srv.includes("export const COVER_WAITING_MAX = 12;"));
  assert.ok(srv.includes("if (running + queue.length >= COVER_AT_ONCE + COVER_WAITING_MAX) return Promise.resolve({ ok: false, why: \"busy\" });"));
  assert.ok(srv.includes("export const COVER_RETRY_MS = 6 * 60 * 60_000;") && srv.includes("export const COVER_RETRY_ERROR_MS = 10 * 60_000;"));
  assert.ok(srv.includes("failed.set(key, Date.now() + (r.why.startsWith(\"error\") ? COVER_RETRY_ERROR_MS : COVER_RETRY_MS));"), "the piece's own failure for hours; a database blip for minutes");
  // what needs no ffmpeg is answered at once (in the harness a "not a video" waited 3.4 s behind drawings);
  // only the drawing waits for a turn — and a burst is bounded again once the pieces are read
  const make = srv.slice(srv.indexOf("export function makeArchiveCover("), srv.indexOf("type Obj = Record<string, unknown>;"));
  assert.ok(make.indexOf("const plan = await planCover(o);") < make.indexOf("if (running >= COVER_AT_ONCE) await new Promise<void>((go) => queue.push(go));"));
  assert.ok(make.includes("if (!(\"draw\" in plan)) return plan;"));
  assert.equal(make.split("if (running + queue.length >= COVER_AT_ONCE + COVER_WAITING_MAX)").length - 1, 2);
  // nothing for media that is not ours, or gone; a story with its poster asks for nothing
  assert.ok(srv.includes("const name = localMedia(str(audio ? body.audioUrl : body.videoUrl));\n  if (!name) return { ok: false, why: \"not-local\" };"));
  assert.ok(srv.includes("if (body.needsRegen === true) return { ok: false, why: \"expired\" };"));
  assert.ok(srv.includes("if (posterOf(meta) && posterIsCover(kind.family)) return { ok: false, why: \"has-poster\" };"));
  // only the shop's own piece
  assert.ok(srv.includes("db.asset.findFirst({ where: { id: o.assetId, shopId: o.shopId }"));
  // the font rule the captions keep: words no font can draw → no cover, never boxes
  assert.ok(srv.includes("try { font = await resolveTextFont(coverText(spec)); } catch (e) { return { ok: false, why: `font: "));
  // written beside, moved into place; copied to storage; recorded by compare-and-swap
  assert.ok(srv.includes("const part = `${out}.${process.pid}-${Date.now()}.part`;") && srv.includes("fs.renameSync(part, out);"));
  assert.ok(srv.includes("try { await mirrorRender(file, fs.readFileSync(out)); } catch { /* non-fatal, as everywhere else */ }"));
  assert.ok(srv.includes("db.asset.updateMany({ where: { id: a.id, shopId: o.shopId, metaJson: cur.metaJson }, data: { metaJson: JSON.stringify({ ...m, cover: src }) } })"));
  // a picture is opened as a FILE of ours, by its bare name only
  assert.ok(srv.includes("const name = path.basename(p);") && srv.includes("name.includes(\"..\")"));
  // where each family's picture comes from: a story's own still, an acted film's cast or shots, an ad's
  // keyframes, a take's still — and last, always, frames from inside the video (above its captions)
  for (const s of ["case \"story\": tries.push(() => storyStill(meta, body, names)); break;", "case \"film\": tries.push(() => castPortraits(meta), () => fromShots(meta)); break;", "tries.push(() => fromVideo(media, captioned));"]) assert.ok(srv.includes(s), s);
  // the pipelines are not touched: none of them knows covers exist
  for (const f of ["film-dialogue.server.ts", "film-engine.server.ts", "narrated-story.server.ts", "music-video-pipeline.server.ts", "take.server.ts", "ugc-ad-pipeline.server.ts", "commercial-ad-pipeline.server.ts", "faceless-video.server.ts"]) {
    assert.ok(!read("app", "lib", f).includes("archive-cover"), f);
  }
});

test("the route: asked by POST, by a signed-in shop, for its own piece — never a redirect", () => {
  const route = read("app", "routes", "web.archive-cover.tsx");
  assert.ok(route.includes("const id = await getWebIdentity(request);") && !route.includes("requireWebIdentity"));
  assert.ok(route.includes("if (!/^[a-z0-9]{8,64}$/i.test(assetId))"));
  assert.ok(route.includes("const r = await makeArchiveCover({ shopId: id.shop.id, assetId });"));
  assert.ok(route.includes("export const loader = () => new Response(\"Not found\", { status: 404, headers });"));
});

test("the Archive asks for covers as it shows pieces, a couple at a time, and shows one only once it has loaded", () => {
  const page = read("app", "routes", "web.archive.tsx");
  // the loader: which family, the cover made, whether to ask (not for a piece that failed lately)
  assert.ok(page.includes("const kind = coverKind({ type: a.type, title: a.title, meta: m, body });"));
  assert.ok(page.includes("const ask = coverAsk({ kind, media: rawMedia, expired, poster: a.type === \"VIDEO_AD\" ? posterOf(m) : null, cover }) && !coverFailedLately(a.id);"));
  // the face: the cover made (this visit or before), else the poster — a series' card is built from faces
  assert.ok(page.includes("const c = madeCovers[p.id] || p.cover;\n    return c && c !== p.poster ? { ...p, poster: c } : p;"));
  assert.ok(page.includes("archiveShelf(visibleShelf.map(faceOf))"));
  // as it comes into view; two at a time; each once a visit; shown once LOADED
  assert.ok(page.includes("new IntersectionObserver(") && page.includes("while (e.alive && e.busy < 2 && e.queue.length)"));
  assert.ok(page.includes("if (!id || e.asked.has(id)) continue;"));
  assert.ok(page.includes("fetch(\"/web/archive-cover\", { method: \"POST\", body, credentials: \"same-origin\", signal: e.ctl.signal })"));
  assert.ok(page.includes("img.onload = () => { if (e.alive) setMadeCovers((m) => (m[id] ? m : { ...m, [id]: src })); };"));
  assert.ok(page.includes("data-cover-ask={askFor(c.a)}") && page.includes("data-series={s.key} data-cover-ask={askFor(seriesFace(s))}"));
  // a missing cover file falls back to the first frame (the poster's own fallback) — never a broken image
  assert.ok(page.includes("if (a.poster && el.dataset.fell !== \"1\") { el.dataset.fell = \"1\"; el.src = first; } else el.style.visibility = \"hidden\";"));
  // a track's cover over its tile, the glyph under it
  assert.ok(page.includes("{a.poster && <img className=\"wa-audiocover\" src={a.poster} alt=\"\" loading=\"lazy\" decoding=\"async\" onError={(e) => { e.currentTarget.style.visibility = \"hidden\"; }} />}"));
  // a cover arriving develops in place — and holds still for reduced motion
  const css = page.slice(page.indexOf("const WA_CSS = `"));
  assert.ok(css.includes(".wb-asset.wa-fresh .wa-poster img{animation:waDevelop") && css.includes("@media(prefers-reduced-motion:reduce){.wb-asset.wa-fresh .wa-poster img{animation:none;}}"));
  // the viewer opens the piece itself: its "Poster" is the one its film made
  assert.ok(page.includes("setViewer(c.a))}"));
});

test("every word the shelf says about a family is in all five languages", () => {
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of Object.values(COVER_LABEL)) assert.equal(dict.split(`\n  ${JSON.stringify(k)}:`).length - 1, 5, k);
});
