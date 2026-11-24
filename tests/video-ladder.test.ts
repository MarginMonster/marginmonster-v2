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

test("the maker's choice is a sixth card on a told story's storyboard — Moving or Still", () => {
  const film = read("app", "routes", "web.film.tsx");
  // the card: only on a told story, and only where the server can make pictures move at all
  assert.ok(film.includes('{narrated && d.storyMotion && (\n              <button type="button" style={{ order: 13 }} className={`mm-card${storyCard === "motion" ? " on" : ""}${storyDone.motion ? " done" : ""}`} onClick={() => tapStory("motion")}>'));
  assert.ok(film.includes('<span className="mm-val">{pictures === "still" ? t("Still · told over the pictures") : t("Moving · every picture comes to life")}</span>'));
  // moving unless its maker says otherwise — and a new format starts from moving again
  assert.ok(film.includes('const [pictures, setPictures] = useState<StoryPictures>("moving");'));
  assert.ok(film.includes('setStoryCard(null); setStoryDone({}); setPictures("moving");'));
  // two options, each saying what it is; nothing is redrawn by choosing (no "start over" arm)
  assert.ok(film.includes('{([["moving", "Moving", "every picture comes to life"], ["still", "Still", "told over the pictures · ready sooner"]] as const).map(([k, name, line]) => ('));
  assert.ok(film.includes('aria-pressed={pictures === k} onClick={() => setPictures(k)}>'));
  // the form carries it only when it is "still"; the action puts it on the job only for a told story
  assert.ok(film.includes('{isStoryboard && narrated && pictures === "still" && <input type="hidden" name="filmPictures" value="still" />}'));
  assert.ok(film.includes('...(narrated && storyPicturesOf(form.get("filmPictures")) === "still" ? { filmPictures: "still" } : {}),'));
  // what the page promises follows it: the time estimate, and the line about moving pictures
  assert.ok(film.includes('narrated, moves: d.storyMotion && pictures !== "still", scenes, engine: dialogueEngine })}</b>'));
  assert.ok(film.includes('{d.storyMotion && pictures !== "still" ? <> {t("In the finished story every picture moves.")}</> : null}'));
  // with it a told story has six cards: full rows of two on a phone, of three on a desktop
  assert.ok(film.includes(".mm-grid{display:grid;grid-template-columns:1fr 1fr;") && film.includes("@media (min-width:960px){.mm-grid{grid-template-columns:repeat(3,minmax(0,1fr));}}"));
  // every word of it in all five languages
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["The pictures", "Motion", "Still · told over the pictures", "Moving · every picture comes to life", "Do the pictures move?", "Moving", "Still", "every picture comes to life", "told over the pictures · ready sooner"]) {
    assert.ok(dict.split(`\n  ${JSON.stringify(k)}:`).length - 1 >= 5, k);
  }
});
