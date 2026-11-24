/* A POSTER FOR EVERY STORY FILM — the film's cover on the Archive's shelf.
 *
 * A film used to be shown as its first frame (often a picture with a caption card half across it). Now a
 * story film makes a poster when it is made: its most "cast" picture cropped to the shelf's own shape, the
 * title, and the cast's names — one ffmpeg frame, no model asked, and never a reason for a film to fail.
 *
 * Seven were drawn from real story pictures on 2026-11-24 and LOOKED at before any of this was wired in:
 * the first design set every title as big as it would go (three 96-px lines buried the two people it was
 * billing), used the app's green-black ink for the foot (their faces went green) and laid it in 24 visible
 * stripes. What is pinned below is the design after that look.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  POSTER_CAST_MAX, POSTER_FOOT_CURVE, POSTER_FOOT_DEPTH, POSTER_FOOT_RISE, POSTER_H, POSTER_SIZES, POSTER_W,
  castPosterGraph, posterDress, posterFilters, posterLayout, posterLines, posterName, posterOf, posterScene, posterTitle,
} from "../app/lib/story-poster.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// (a checkout with CRLF line endings must read the same as one with LF)
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("the poster is the shelf's own shape, so nothing of it is cropped there", () => {
  assert.deepEqual([POSTER_W, POSTER_H], [800, 1000]);
  assert.equal(POSTER_W / POSTER_H, 4 / 5);
  // …the shape the Archive draws every tile in
  const arc = read("app", "routes", "web.archive.tsx");
  assert.ok(arc.includes(".wa-poster video,.wa-poster img{width:100%;aspect-ratio:4/5;height:auto;object-fit:cover;"));
});

test("which picture: the one with the most of the cast in it — the earliest of those", () => {
  const boat = [
    "Tobias stands atop the lighthouse gallery at dawn", "Ines rows her small wooden boat", "Tobias sits on the lighthouse steps",
    "Tobias climbs down a rocky shoreline path", "Ines limps along the rocky shoreline", "Tobias and Ines sit together on the lighthouse steps",
  ];
  assert.equal(posterScene(boat, ["Tobias", "Ines"]), 5, "the one picture with both of them");
  assert.equal(posterScene(boat, ["Tobias"]), 0, "one star: the first picture he is in — not the ending");
  assert.equal(posterScene(boat, []), 0, "nobody to bill: the opening picture");
  // a scene whose picture is missing is not a poster
  assert.equal(posterScene(boat, ["Tobias", "Ines"], [true, true, true, true, true, false]), 0);
  assert.equal(posterScene(boat, ["Tobias", "Ines"], boat.map(() => false)), -1);
  assert.equal(posterScene([], ["Tobias"]), -1);
});

test("an episode's title is the series' title, with the episode on a line of its own", () => {
  assert.deepEqual(posterTitle("The Week the Boat Didn't Come — Episode 2: The Mended Hull"), { title: "The Week the Boat Didn't Come", episode: "Episode 2", episodeName: "The Mended Hull" });
  assert.deepEqual(posterTitle("The Week the Boat Didn't Come — Episode 3"), { title: "The Week the Boat Didn't Come", episode: "Episode 3", episodeName: "" });
  assert.deepEqual(posterTitle("The Patience of Bread"), { title: "The Patience of Bread", episode: "", episodeName: "" });
  assert.deepEqual(posterTitle("  Tide  "), { title: "Tide", episode: "", episodeName: "" });
  // a title that only mentions an episode in passing is left alone
  assert.equal(posterTitle("Episode 2").title, "Episode 2");
});

test("the title's lines: as few as it fits in, filled evenly, words kept whole", () => {
  assert.deepEqual(posterLines("Tide", 11), ["Tide"]);
  assert.deepEqual(posterLines("The Warm Corner", 13), ["The Warm", "Corner"]);
  assert.deepEqual(posterLines("The Week the Boat Didn't Come", 17), ["The Week the Boat", "Didn’t Come"], "the apostrophe is the one that can be drawn");
  assert.deepEqual(posterLines("An Empty Shore at Dawn", 13), ["An Empty", "Shore at Dawn"]);
  // it does not fit three lines of this width → nothing, and the next smaller size is tried
  assert.deepEqual(posterLines("The Lighthouse Keeper Who Waited Every Tuesday", 11), []);
  assert.deepEqual(posterLines("", 20), []);
  // a script written without spaces is cut by its glyphs (each about 1.7 letters wide)
  const zh = posterLines("灯塔守护人与邮差的故事", 13);
  assert.ok(zh.length >= 2 && zh.join("") === "灯塔守护人与邮差的故事", JSON.stringify(zh));
});

test("a BIG size is for a short title; three lines only once the type is modest", () => {
  assert.deepEqual(POSTER_SIZES[0], [96, 11, 1]);
  assert.ok(POSTER_SIZES.every(([size, , most], k) => (k === 0 || size < POSTER_SIZES[k - 1][0]) && (size >= 60 ? most <= 2 : most === 3)), "sizes fall, and big type never takes three lines");
  const lay = (title: string, cast: string[] = []) => posterLayout({ title, cast })!;
  assert.deepEqual([lay("Tide").size, lay("Tide").lines], [96, ["Tide"]]);
  assert.deepEqual([lay("The Warm Corner").size, lay("The Warm Corner").lines], [84, ["The Warm", "Corner"]]);
  // (the first design: 96 px on THREE lines, over the faces it was billing)
  assert.deepEqual([lay("The Week the Boat Didn't Come").size, lay("The Week the Boat Didn't Come").lines], [62, ["The Week the Boat", "Didn’t Come"]]);
  // a very long title: the smallest size, three lines, cut with an ellipsis — never a fourth line
  const long = lay("The Lighthouse Keeper Who Waited Every Tuesday for a Boat That Was Always on Time Until It Was Not");
  assert.equal(long.size, 36);
  assert.equal(long.lines.length, 3);
  assert.ok(long.lines[2].endsWith("…"), long.lines[2]);
  assert.equal(posterLayout({ title: "" }), null, "no title, no poster");
  assert.equal(posterLayout({ title: "🎬🎬" }), null, "nothing drawable, no poster");
});

test("the billing: the cast's names in capitals, three at most, never running off the picture", () => {
  const lay = (cast: string[], title = "The Week the Boat Didn't Come") => posterLayout({ title, cast })!;
  assert.equal(lay(["Tobias", "Ines"]).cast, "TOBIAS  ·  INES");
  assert.equal(lay(["Tobias", "Ines", "Marta", "Odile"]).cast, "TOBIAS  ·  INES  ·  MARTA");
  assert.equal(lay(["Tobias", "tobias", ""]).cast, "TOBIAS", "nobody twice");
  assert.equal(lay([]).cast, "");
  // names too long to share a line: fewer are billed rather than a line that leaves the frame
  const longNames = lay(["Bartholomew Fitzwilliam", "Persephone Montgomery", "Alexandrina Featherstone"]).cast;
  assert.ok(longNames.length <= 40 && !longNames.includes("ALEXANDRINA"), longNames);
  // the episode line: number and name — and a name that will not fit on it goes on in a second line
  // (it used to be left off: on a character's show the name IS the episode)
  assert.equal(lay(["Tobias"], "The Week the Boat Didn't Come — Episode 2: The Mended Hull").episode, "EPISODE 2  ·  THE MENDED HULL");
  assert.equal(lay(["Tobias"], "The Week the Boat Didn't Come — Episode 2: The Mended Hull").episode2, undefined);
  const wrapped = lay(["Tobias"], "The Week the Boat Didn't Come — Episode 2: The Night the Whole Harbour Came Out to Mend One Small Boat");
  assert.equal(wrapped.episode, "EPISODE 2  ·  THE NIGHT THE WHOLE");
  assert.equal(wrapped.episode2, "HARBOUR CAME OUT TO MEND ONE SMALL BOAT", "whole words, and all of it");
  assert.equal(lay(["Tobias"]).episode, "");
});

test("the frame: cropped to 4:5, a foot that darkens without changing a colour, a gold rule, then the words — nothing an ffmpeg filter chokes on", () => {
  const layout = posterLayout({ title: "The Week the Boat Didn't Come — Episode 2: The Mended Hull", cast: ["Tobias", "Ines", "Marta"] })!;
  const f = posterFilters(layout, "C:\\fonts\\Poppins-Bold.ttf");
  assert.ok(f.startsWith("scale=800:1000:force_original_aspect_ratio=increase,crop=800:1000,setsar=1,format=gbrp,geq="));
  // THE FOOT is ONE gradient, computed in RGB: every channel of a pixel is scaled by the same factor.
  // (Stacked translucent sheets of black — 24, then 60 — were both tried and LOOKED at: the first showed as
  //  stripes on a pale sky, the second left a green cast, because each tiny blend rounds every channel and
  //  the brightness fell while the colour did not. A grey blanket came out moss on the first live poster.)
  assert.ok(!f.includes("drawbox=x=0:"), "no stacked sheets");
  const geq = /geq=r='r\(X,Y\)\*(\([^']+\))':g='g\(X,Y\)\*(\([^']+\))':b='b\(X,Y\)\*(\([^']+\))'/.exec(f);
  assert.ok(geq, "one geq, three channels");
  assert.ok(geq![1] === geq![2] && geq![2] === geq![3], "the SAME factor for red, green and blue");
  const m = /^\(1-([\d.]+)\*pow\(clip\(\(Y-(\d+)\)\/(\d+),0,1\),([\d.]+)\)\)$/.exec(geq![1]);
  assert.ok(m, geq![1]);
  const [depth, from, span, curve] = [Number(m![1]), Number(m![2]), Number(m![3]), Number(m![4])];
  assert.deepEqual([depth, curve], [POSTER_FOOT_DEPTH, POSTER_FOOT_CURVE]);
  assert.equal(from + span, 1000 - 56, "it reaches its full depth at the bottom margin");
  assert.ok(POSTER_FOOT_DEPTH >= 0.85 && POSTER_FOOT_DEPTH <= 0.95 && POSTER_FOOT_CURVE < 1 && POSTER_FOOT_RISE <= 180);
  // how dark the picture is where the words begin (the rule), by that very formula: enough to read white type on
  const ruleY = Number(/drawbox=x=56:y=(\d+):w=72:h=5:color=0xE7C879@1:t=fill/.exec(f)![1]);
  assert.equal(ruleY - from, POSTER_FOOT_RISE, "the foot begins a fixed rise above the words");
  const darkAtRule = depth * Math.pow((ruleY - from) / span, curve);
  assert.ok(darkAtRule > 0.3 && darkAtRule < 0.6, `where the words begin the picture is ${Math.round(darkAtRule * 100)}% darker`);
  // the words: billing in gold, the title in white, the episode in gold; every one with the font and no expansion
  const texts = f.split(",drawtext=").slice(1);
  assert.equal(texts.length, 1 + layout.lines.length + 1);
  assert.ok(texts.every((t) => t.startsWith("expansion=none:fontfile='C\\:/fonts/Poppins-Bold.ttf':text='")), "a Windows path is written so the filter can read it");
  assert.ok(texts[0].includes("text='TOBIAS  ·  INES  ·  MARTA'") && texts[0].includes("fontcolor=0xE7C879"));
  assert.ok(texts[1].includes("text='The Week the Boat'") && texts[1].includes("fontsize=62:fontcolor=white"));
  assert.ok(texts[texts.length - 1].includes("text='EPISODE 2  ·  THE MENDED HULL'"));
  // nothing that ends a filter's text early: no straight quote, colon, comma-free check is the filter split above
  for (const t of texts) { const body = /text='([^']*)'/.exec(t)![1]; assert.ok(!/[':\\%]/.test(body), body); }
  // the words sit inside the frame: the title's last line ends above the bottom margin
  const titleYs = texts.slice(1, 1 + layout.lines.length).map((t) => Number(/:y=(\d+)$/.exec(t)![1]));
  assert.ok(titleYs.every((y) => y > 500 && y < 1000 - 56));
  // without a cast or an episode there are simply fewer lines
  assert.equal(posterFilters(posterLayout({ title: "Tide" })!, "/app/public/fonts/Poppins-Bold.ttf").split(",drawtext=").length - 1, 1);
});

test("its name and its record: one dot (the renders route serves nothing else), and only our own picture is believed", () => {
  assert.equal(posterName("nar-1795480525311-5caa66b0f78a.mp4"), "nar-1795480525311-5caa66b0f78a-poster.jpg");
  assert.equal(posterName("../../etc/passwd.mp4"), "etcpasswd-poster.jpg");
  assert.equal(posterOf({ poster: "/renders/nar-1-abc-poster.jpg" }), "/renders/nar-1-abc-poster.jpg");
  assert.equal(posterOf(JSON.stringify({ kind: "narrated", poster: "/renders/nar-1-abc-poster.jpg" })), "/renders/nar-1-abc-poster.jpg");
  for (const bad of [{ poster: "https://evil.example/x-poster.jpg" }, { poster: "/renders/../x-poster.jpg" }, { poster: "/renders/a.b-poster.jpg" }, { poster: "/renders/film.mp4" }, { poster: 4 }, {}, null, "{", ""]) {
    assert.equal(posterOf(bad), null, JSON.stringify(bad));
  }
});

test("a story makes its poster when it is made — and never fails for want of one", () => {
  const nar = read("app", "lib", "narrated-story.server.ts");
  const fn = nar.slice(nar.indexOf("async function makeStoryPoster("), nar.indexOf("/** One still per scene."));
  assert.ok(fn.includes("const k = posterScene(o.visuals, o.names, o.stills.map((s) => !!s && fs.existsSync(s)));") && fn.includes("if (k < 0) return null;"));
  assert.ok(fn.includes("const font = await resolveTextFont([...layout.lines, layout.cast, layout.episode].join(\" \"));"), "the captions' own font rule: no font for these words → no words drawn, never boxes");
  assert.ok(fn.includes("const r = await runFfmpeg([\"-y\", \"-i\", o.stills[k], \"-vf\", posterFilters(layout, font), \"-frames:v\", \"1\", \"-q:v\", \"3\", outPath]);"));
  assert.ok(!/repRun|anthropic|fal/i.test(fn), "no model is asked: it costs nothing");
  // made after the film itself is safe on disk, inside a try: a film without a poster is still a film
  const at = nar.indexOf("poster = await makeStoryPoster({ stills, visuals: treatment.scenes.map((s) => s.visual || \"\"), names: billed, title: billedAs, videoName: outName });");
  assert.ok(at > nar.indexOf("await assembleNarrated({ stills, clips: motion?.clips"), "after the cut");
  assert.ok(nar.includes("if (process.env.STORY_POSTER !== \"off\") {"), "one switch turns it off");
  assert.ok(nar.includes("} catch (e) { console.error(`[narrated] no poster (the shelf shows the first frame): ${e instanceof Error ? e.message.slice(0, 160) : e}`); }"));
  assert.ok(nar.includes("const billed = [...(opts.cast || []).map((c) => c?.name || \"\"), ...readCastToken(storyCastRef).refs.map((c) => c.name)].filter(Boolean);"), "the maker's picks first, then the story's own");
  assert.ok(nar.includes("...(poster ? { poster } : {}),"));
});

test("an ACTED film's poster is its cast: their own portraits side by side, in the same dress", () => {
  // (an acted film's pictures are wide two-shots — cropped to 4:5 both faces would be cut in half; drawn
  //  from stock portraits and looked at on 2026-11-24: one fills it, two stand side by side, three share it)
  const layout = posterLayout({ title: "The Wallet at the Market", cast: ["Abdul", "Amara"] })!;
  const font = "/app/public/fonts/Poppins-Bold.ttf";
  const dress = posterDress(layout, font);
  // a story's poster and a cast poster wear ONE dress — the same foot, rule, billing and title
  assert.equal(posterFilters(layout, font), `scale=800:1000:force_original_aspect_ratio=increase,crop=800:1000,setsar=1,${dress}`);
  assert.equal(POSTER_CAST_MAX, 3);
  const widths = (g: string) => [...g.matchAll(/\[(\d):v\]scale=(\d+):1000:force_original_aspect_ratio=increase,crop=(\d+):1000,setsar=1\[p\1\]/g)].map((m) => { assert.equal(m[2], m[3]); return Number(m[2]); });
  const one = castPosterGraph(1, layout, font);
  assert.deepEqual(widths(one), [800]);
  assert.equal(one, `[0:v]scale=800:1000:force_original_aspect_ratio=increase,crop=800:1000,setsar=1[p0];[p0]${dress}`, "one star fills it — nothing to join");
  const two = castPosterGraph(2, layout, font);
  assert.deepEqual(widths(two), [400, 400]);
  assert.ok(two.endsWith(`;[p0][p1]hstack=inputs=2,${dress}`));
  const three = castPosterGraph(3, layout, font);
  assert.deepEqual(widths(three), [267, 267, 266], "the shares add up to the whole width — no black sliver at the edge");
  assert.ok(three.endsWith(`;[p0][p1][p2]hstack=inputs=3,${dress}`));
  // more than three were cast: three are shown (and three are billed — posterLayout's own limit)
  assert.equal(castPosterGraph(7, layout, font), three);
  for (const none of [0, -1, NaN]) assert.equal(castPosterGraph(none, layout, font), "", "nobody with a picture: no poster");
});

test("an acted film makes its poster from pictures already on the disk — and never fails for want of one", () => {
  const srv = read("app", "lib", "story-poster.server.ts");
  assert.ok(!/repRun|anthropic|fal\.|replicate/i.test(srv), "no model is asked: it costs nothing");
  // only the cast with a picture, nobody twice, three at most; nobody pictured → no poster (an invented cast)
  assert.ok(srv.includes(".filter((c): c is { name: string; input: string } => !!c.name && !!c.input)"));
  assert.ok(srv.includes(".filter((c, k, a) => a.findIndex((x) => x.input === c.input) === k)"));
  assert.ok(srv.includes(".slice(0, POSTER_CAST_MAX);") && srv.includes("if (!pictured.length) return null;"));
  assert.ok(srv.includes("const layout = posterLayout({ title: o.title, cast: pictured.map((c) => c.name) });"), "the billing is the people shown, in the order shown");
  assert.ok(srv.includes("const font = await resolveTextFont([...layout.lines, layout.cast, layout.episode].join(\" \"));"), "the captions' own font rule");
  assert.ok(srv.includes("\"-filter_complex\", castPosterGraph(pictured.length, layout, font), \"-frames:v\", \"1\", \"-q:v\", \"3\", outPath]);"));
  // a picture is opened as a FILE of ours when it is one (a stock portrait, a render, an upload), by its
  // bare name only — a name that could climb out of its folder is never joined to a path
  assert.ok(srv.includes("const name = path.basename(p);"));
  assert.ok(srv.includes("const safe = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\\.(?:jpe?g|png|webp)$/i.test(name) && !name.includes(\"..\");"));
  assert.ok(srv.includes("if (/^https:\\/\\/[^\\s\"']+$/.test(raw)) return raw;"), "…else its https address; never plain http, never a local path of the caller's choosing");
  // made once the film itself is safe on disk, inside a try: a film without a poster is still a film
  const film = read("app", "lib", "film-dialogue.server.ts");
  const at = film.indexOf("try { poster = await makeCastPoster({ cast: opts.cast, title: treatment.title || opts.topic || \"\", videoName: outName }); }");
  assert.ok(at > film.indexOf("try { await mirrorRender(outName, outBuf); } catch { /* non-fatal */ }") && at < film.indexOf("const asset = await db.asset.create({", at), "after the film is stored, before its record is written");
  assert.ok(film.slice(at - 120, at).includes("if (process.env.STORY_POSTER !== \"off\") {"), "the same one switch turns it off");
  assert.ok(film.includes("catch (e) { console.error(`[testmovie] no poster (the shelf shows the first frame): ${e instanceof Error ? e.message.slice(0, 160) : e}`); }"));
  assert.ok(film.includes("...(poster ? { poster } : {}),"));
});

test("the Archive shows it as the film's cover, falls back to the first frame, and lets the maker keep it", () => {
  const arc = read("app", "routes", "web.archive.tsx");
  assert.ok(arc.includes("poster: a.type === \"VIDEO_AD\" ? posterOf(a.metaJson) : null,"));
  assert.ok(arc.includes("{a.isVideo && a.media && <img src={a.poster || `/vthumb/${a.media.split(\"?\")[0].split(\"/\").pop()}`} alt={a.title} loading=\"lazy\" decoding=\"async\""));
  assert.ok(arc.includes("if (a.poster && el.dataset.fell !== \"1\") { el.dataset.fell = \"1\"; el.src = first; } else el.style.visibility = \"hidden\";"), "a missing poster → the first frame, once");
  assert.ok(arc.includes("{viewer.poster && !viewer.expired && <a className=\"wa-vbtn ghost\" href={viewer.poster} download={"));
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Poster", "Save this film's poster — its title and cast over its best picture"]) assert.equal(dict.split(`${JSON.stringify(k)}:`).length - 1, 5, k);
});

test("a show's poster: its name keeps its colon, and a long episode name takes a second line instead of vanishing", async () => {
  const { billable, posterLayout, posterDress } = await import("../app/lib/story-poster.ts");
  // (the first poster made for a show, live, 2026-11-24, read "Howl Night Tales What Follows the Trail")
  assert.equal(billable("Howl: Night tales"), "Howl: Night tales");
  assert.equal(billable("Howl:Night tales"), "Howl: Night tales");
  assert.equal(billable(" : Howl :: Night — tales: "), "Howl: Night tales");
  assert.equal(billable("The 10:30 Ferry"), "The 10:30 Ferry", "a time is not pulled apart");
  assert.equal(billable("Don't Look: It's \"Here\"; <now>"), "Don’t Look: It’s Here now", "everything else `drawable` drops stays dropped");
  assert.equal(billable("夜话:狼"), "夜话狼", "a script cut by its glyphs is exactly what it was");
  const short = posterLayout({ title: "Howl: Night tales — Episode 2: The Well", cast: ["Howl", "Marion"] })!;
  assert.deepEqual(short.lines, ["Howl:", "Night tales"], "a short name is set big, on two lines — and breaks AT its colon (it read \"Howl: Night\" / \"tales\")");
  // …only when it needs two lines and both halves fit: a long name is filled evenly as before
  assert.deepEqual(posterLayout({ title: "Pip: Lessons" })!.lines.join(" | "), "Pip: Lessons");
  assert.ok(posterLayout({ title: "The Quiet Wolf of Hollow Pine Ridge: Night tales" })!.lines.length >= 2);
  assert.equal(short.episode, "EPISODE 2  ·  THE WELL");
  assert.equal(short.episode2, undefined);
  // a name too long for its line goes on in a second one, whole words
  const long = posterLayout({ title: "Howl: Night tales — Episode 3: The Door That Was Never There Before the Rain", cast: ["Howl"] })!;
  assert.ok(long.episode.startsWith("EPISODE 3  ·  THE DOOR"), long.episode);
  assert.ok(long.episode2 && !long.episode2.startsWith(" ") && `${long.episode} ${long.episode2}`.replace("EPISODE 3  ·  ", "") === "THE DOOR THAT WAS NEVER THERE BEFORE THE RAIN", `${long.episode} / ${long.episode2}`);
  // …and one too long even for two lines ends in an ellipsis
  const huge = posterLayout({ title: `S — Episode 9: ${"Wandering ".repeat(14)}`, cast: [] })!;
  assert.ok(huge.episode2 && huge.episode2.endsWith("…"), huge.episode2);
  // the colon is escaped where it is drawn — once (checked on a real ffmpeg: unescaped, the filter is refused)
  const dress = posterDress(short, "C:/fonts/Poppins-Bold.ttf");
  assert.ok(dress.includes("text='Howl\\:'"), dress);
  const drawn = [...dress.matchAll(/text='([^']*)'/g)].map((m) => m[1]);
  assert.equal(drawn.length, 4, "the billing, two title lines, the episode");
  assert.ok(drawn.every((s) => !/(?:^|[^\\]):/.test(s)), "no bare colon inside any drawn text");
  // two episode lines stand one above the other, and the title moves up to make room
  const two = posterDress(long, "f.ttf");
  const ys = [...two.matchAll(/fontsize=26:fontcolor=0xE7C879[^,]*:y=(\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(ys.slice(-2), [1000 - 56 - 30 - 34, 1000 - 56 - 30], "the last two gold lines");
  const titleY = (d: string) => Number(/fontcolor=white[^,]*:y=(\d+)/.exec(d)![1]);
  assert.equal(titleY(posterDress({ ...long, episode2: undefined }, "f.ttf")) - titleY(two), 34);
});
