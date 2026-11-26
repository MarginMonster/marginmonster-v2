/* THE LADDER — the owner, 2026-11-24: "I'm thinking like a hierarchy for the video system (narrated with
 * stills / simple, narrated with stills to video mid, and acted premium)".
 *
 * Until then a told story's pictures moved or did not by ONE switch for the whole server (STORY_MOTION). The
 * first two rungs are one way of telling made two ways, so which one is the MAKER'S choice, story by story —
 * and the simple rung must spend nothing on motion. (The third rung is another way of telling: acted.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { motionOn, storyPicturesOf, videoRung } from "../app/lib/story-motion.ts";
import { priceWay, renderMinutes, secondsFor, tokensFor } from "../app/lib/film-length.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("a told story's pictures are still or moving — and moving unless it says otherwise", () => {
  assert.equal(storyPicturesOf("still"), "still");
  assert.equal(storyPicturesOf(" STILL "), "still");
  for (const v of [undefined, null, "", "moving", "on", "yes", 0, "stills-please"]) assert.equal(storyPicturesOf(v), "moving", String(v));
});

test("the three rungs, by what a piece is", () => {
  assert.equal(videoRung({ narrated: true, pictures: "still" }), "simple");
  assert.equal(videoRung({ narrated: true }), "moving");
  assert.equal(videoRung({ narrated: true, pictures: "moving" }), "moving");
  // an acted film is the third rung whatever else is said about it
  assert.equal(videoRung({ narrated: false }), "acted");
  assert.equal(videoRung({ narrated: false, pictures: "still" }), "acted");
});

test("the simple rung spends nothing on motion; the server's own switch still rules them all", () => {
  assert.equal(motionOn({}, true, "still"), false, "its maker asked for still pictures");
  assert.equal(motionOn({}, true, "moving"), true);
  assert.equal(motionOn({}, true), true, "a story that says nothing moves, as before");
  assert.equal(motionOn({ STORY_MOTION: "off" }, true, "moving"), false, "off for the whole server is off for every story");
  assert.equal(motionOn({}, false, "moving"), false, "no provider key: told over stills");
});

test("the choice travels: form → job → engine → the piece → a retelling of it", () => {
  const engine = read("app", "lib", "narrated-story.server.ts");
  assert.ok(engine.includes("if (storyMotionOn(opts.pictures)) {"), "the engine asks about THIS story");
  assert.ok(engine.includes('...(storyPicturesOf(opts.pictures) === "still" ? { pictures: "still" } : {}),'), "a still story says so on the piece");
  assert.ok(read("app", "lib", "story-motion.server.ts").includes("export const storyMotionOn = (pictures?: unknown): boolean => motionOn(process.env, falEnabled(), pictures);"));
  assert.ok(read("app", "lib", "job-queue.server.ts").includes('pictures: typeof payload.filmPictures === "string" ? payload.filmPictures : undefined,'));
  // told again in another language, a still story stays a still story (it would otherwise start costing motion)
  assert.ok(read("app", "lib", "story-translate.server.ts").includes('...(meta.pictures === "still" ? { filmPictures: "still" } : {}),'));
});

/* STILL OR MOVING, WHERE THE LENGTH AND THE PRICE ARE (2026-11-25). The choice was a sixth card ("The pictures ·
 * Motion"), the last of six, with no price on it — and the owner, with a photo of the Stories shelf, had never met it:
 * "Stories narrated moving pictures - we also need the timeless pictures with narration as an extremely cheap base
 * tier". It is now two tiles under the Length slider, each with its own estimate; the slider's follows the pick. */
const film = read("app", "routes", "web.film.tsx");
const lengthPanel = () => film.slice(film.indexOf('{storyCard === "length" && ('), film.indexOf('{storyCard === "shape" && ('));

test("the choice is in the Length step, under the slider: two tiles, Still and Moving, each with its own estimate", () => {
  // the sixth card and its panel are gone — a told story has the five step cards an acted film has
  assert.ok(!film.includes('tapStory("motion")'), "no Motion card");
  assert.ok(!film.includes('storyCard === "motion"'), "no Motion panel");
  assert.ok(!film.includes(".mm-motionpick"), "nor its styles");
  // in the Length panel, after the slider: only on a told story, and only where the server can make pictures move at all
  const panel = lengthPanel();
  assert.ok(panel.indexOf("<LengthSlider ") > 0 && panel.indexOf("<PicturesPick ") > panel.indexOf("<LengthSlider "));
  assert.ok(panel.includes("{narrated && d.storyMotion && (\n                  <PicturesPick value={pictures} onPick={setPictures} media={heroById(heroId)?.media || \"shortstory\"} tokens={picTokens} t={t} />"));
  // moving unless its maker says otherwise — and a new format starts from moving again
  assert.ok(film.includes('const [pictures, setPictures] = useState<StoryPictures>("moving");'));
  assert.ok(film.includes('setStoryCard(null); setStoryDone({}); setPictures("moving");'));
  // the tiles: still first, each saying what it is and what the story at the slider's length comes to; still marked the
  // cheapest while it is; nothing is redrawn by choosing (no "start over" arm)
  const pick = film.slice(film.indexOf("function PicturesPick("), film.indexOf("/* ───────── THE LYRIC VIDEO BUILDER"));
  assert.ok(pick.includes('{ k: "still", name: "Still pictures", line: "a slow camera move on each · ready sooner", n: still },'));
  assert.ok(pick.includes('{ k: "moving", name: "Moving pictures", line: "every picture comes to life", n: moving },'));
  assert.ok(pick.indexOf('k: "still"') < pick.indexOf('k: "moving"'), "the cheapest first");
  assert.ok(pick.includes("aria-pressed={value === o.k} onClick={() => onPick(o.k)}>"));
  assert.ok(pick.includes('{o.k === "still" && still < moving && <em className="mm-pic-tag">{t("Cheapest")}</em>}'));
  assert.ok(pick.includes('<span className="mm-pic-cost">{t("≈ {n} tokens", { n: o.n.toLocaleString("en-US") })}</span>'));
  assert.ok(!/orArm|setSeeds|setTreatment/.test(pick), "choosing throws nothing away");
  // the form carries it only when it is "still"; the action puts it on the job only for a told story
  assert.ok(film.includes('{isStoryboard && narrated && pictures === "still" && <input type="hidden" name="filmPictures" value="still" />}'));
  assert.ok(film.includes('...(narrated && storyPicturesOf(form.get("filmPictures")) === "still" ? { filmPictures: "still" } : {}),'));
  // the Length card says the rung too, and what the story comes to
  assert.ok(film.includes('<span className={`mm-val mm-val-pics is-${pictures}`}>{t(pictures === "still" ? "Still pictures" : "Moving pictures")} · <b>{t("≈ {n} tokens", { n: lenTokens(scenes).toLocaleString("en-US") })}</b></span>'));
  // every word of it in all five languages
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["The pictures", "Still pictures", "Moving pictures", "Cheapest", "a slow camera move on each · ready sooner", "every picture comes to life", "≈ {n} tokens"]) {
    assert.ok(dict.split(`\n  ${JSON.stringify(k)}:`).length - 1 >= 5, k);
  }
});

test("what the page promises follows the pick: the estimate (each tile's, the slider's, the card's), the render time, the line about moving pictures", () => {
  // a told story over stills is the still rung — and so is every told story where the server cannot move pictures
  assert.ok(film.includes('const lenStill = narrated && (!d.storyMotion || pictures === "still");'));
  assert.ok(film.includes("const lenTokens = (n: number) => (cost > 0 ? estimateFilmTokens(n) : tokensFor(priceWay(lenWay, lenStill), lenSecs(n)));"));
  // each tile: the story at the length the slider shows, told that way (a length waiting on "Rewrite" included)
  assert.ok(film.includes('const picTokens = (k: StoryPictures) => (cost > 0 ? estimateFilmTokens(lenPending ?? scenes) : tokensFor(priceWay(lenWay, k === "still"), lenSecs(lenPending ?? scenes)));'));
  // the slider takes lenTokens, as it always did
  assert.ok(lengthPanel().includes("tokensOf={lenTokens}"));
  // the time: the slider's, and Generate's
  assert.ok(film.includes('const lenMinutes = (n: number): [number, number] => storyMinutes(lenWay, n, { moves: d.storyMotion && pictures !== "still", per: lenPer, veo: dialogueEngine === "veo" });'));
  assert.ok(film.includes('narrated, moves: d.storyMotion && pictures !== "still", scenes, engine: dialogueEngine })}</b>'));
  assert.ok(film.includes('{d.storyMotion && pictures !== "still" ? <> {t("In the finished story every picture moves.")}</> : null}'));
  // the numbers the tiles show for a one-minute story, and still the quicker
  const sec = secondsFor("narrated", 6);
  assert.equal(tokensFor(priceWay("narrated", true), sec), 60);
  assert.equal(tokensFor(priceWay("narrated", false), sec), 145);
  assert.ok(renderMinutes("narrated", 6, { moves: false })[1] < renderMinutes("narrated", 6, { moves: true })[1]);
});

test("the tiles share the row on a phone and stand side by side on a desktop; the moves respect reduced motion", () => {
  const css = film.slice(film.indexOf("/* STILL OR MOVING (PicturesPick"), film.indexOf("/* …and the Length CARD says the rung too"));
  assert.ok(css.includes(".mm-pics-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}"));
  assert.ok(css.includes("@media(min-width:700px){\n  .mm-pic{flex-direction:row;}"));
  assert.ok(css.includes("@media(prefers-reduced-motion:reduce){.mm-pic .mm-pic-view img,.mm-pic .mm-pic-view::before,.mm-pic .mm-pic-view::after{animation:none;}}"));
  // the clip in the moving tile plays only for a viewer who has not asked for less motion
  const pick = film.slice(film.indexOf("function PicturesPick("), film.indexOf("/* ───────── THE LYRIC VIDEO BUILDER"));
  assert.ok(pick.includes('if (!v || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) return;'));
});
