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
