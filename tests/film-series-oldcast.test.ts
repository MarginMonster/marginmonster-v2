/* NEXT EPISODE OF A FILM MADE BEFORE FILMS KEPT THEIR CAST.
 *
 * meta.cast is written from 2026-11-23 on. Tried as a customer the same day: "Make episode 2 of One
 * Umbrella" (a film from the day before) opened with "0/3 cast" — untouched, episode 2 would have been
 * played by invented faces. The job that rendered the film still holds who the maker picked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { castFromJobPayloads, filmFileNames } from "../app/lib/film-series.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const J = JSON.stringify;

const acted = {
  metaJson: J({ kind: "testmovie", template: "shortfilm", shots: [{ url: "/renders/tm-aaa-1.mp4" }, { url: "/renders/tm-aaa-2.mp4?v=2" }] }),
  bodyJson: J({ videoUrl: "/renders/film-aaa.mp4" }),
};
const CAST = [
  { name: "Omar", faceUrl: "/avatars/omar_0.jpg?v=3", voiceId: "voice-omar", look: "a warm man" },
  { name: "Keiko", faceUrl: "/avatars/keiko_0.jpg?v=3", voiceId: "voice-keiko" },
];
const want = [
  { name: "Omar", faceUrl: "/avatars/omar_0.jpg?v=3", voiceId: "voice-omar" },
  { name: "Keiko", faceUrl: "/avatars/keiko_0.jpg?v=3", voiceId: "voice-keiko" },
];

test("the film's files: its video and every shot, by file name", () => {
  assert.deepEqual(filmFileNames(acted), ["film-aaa.mp4", "tm-aaa-1.mp4", "tm-aaa-2.mp4"]);
  assert.deepEqual(filmFileNames({ metaJson: "nope", bodyJson: "" }), []);
});

test("the job that checkpointed one of the film's clips is the film's job", () => {
  const mine = { filmTemplate: "shortfilm", cast: CAST, ckClips: ["C:\\app\\data\\renders\\tm-aaa-1.mp4", "/app/data/renders/tm-aaa-2.mp4"] };
  const other = { filmTemplate: "shortfilm", cast: [{ name: "Zed", faceUrl: "/avatars/zed.jpg" }], ckClips: ["/app/data/renders/tm-zzz-1.mp4"] };
  assert.deepEqual(castFromJobPayloads(acted, [J(other), J(mine)]), want);
  assert.deepEqual(castFromJobPayloads(acted, [mine, other]), want, "a parsed payload is read the same");
});

test("no file in common: one candidate of the same format is taken, two are a guess and nobody is cast", () => {
  const a = { filmTemplate: "shortfilm", cast: CAST };
  const b = { filmTemplate: "shortfilm", cast: [{ name: "Zed", faceUrl: "/avatars/zed.jpg" }] };
  assert.deepEqual(castFromJobPayloads(acted, [J(a)]), want);
  assert.deepEqual(castFromJobPayloads(acted, [J(a), J(b)]), []);
  assert.deepEqual(castFromJobPayloads(acted, []), []);
});

test("another format's job, a job with no cast, and the other way of telling are never the film's", () => {
  assert.deepEqual(castFromJobPayloads(acted, [J({ filmTemplate: "horror", cast: CAST })]), [], "another format");
  assert.deepEqual(castFromJobPayloads(acted, [J({ filmTemplate: "shortfilm", cast: [] }), J({ filmTemplate: "shortfilm" }), "not json", null]), [], "nobody was picked");
  assert.deepEqual(castFromJobPayloads(acted, [J({ filmTemplate: "shortfilm", filmMode: "narrated", cast: CAST })]), [], "a narrated job is not an acted film's");
  const narrated = { metaJson: J({ kind: "narrated", template: "horror" }), bodyJson: J({ videoUrl: "/renders/nar-1.mp4" }) };
  assert.deepEqual(castFromJobPayloads(narrated, [J({ filmTemplate: "horror", filmMode: "narrated", cast: CAST })]), want, "a narrated story checkpoints no clips: the only candidate");
  assert.deepEqual(castFromJobPayloads(narrated, [J({ filmTemplate: "horror", cast: CAST })]), [], "an acted job is not a narrated story's");
  // an ad or a Creator video rendered in the same minutes has no cast and no film template
  assert.deepEqual(castFromJobPayloads(acted, [J({ contentType: "commercial", productTitle: "Monchichi" }), J({ filmTemplate: "shortfilm", cast: CAST })]), want);
});

test("the Movie Maker asks only for older films, only this shop's finished renders, and survives a miss", () => {
  const src = read("app", "routes", "web.film.tsx");
  assert.ok(src.includes("const nextEpisodes = nextEpisodeCards(storyFilms, 3);"));
  assert.ok(src.includes("if (card.setup.cast.length) return;"), "a film that kept its cast is never looked up");
  assert.ok(src.includes("for (const card of nextEpisodes) await castBack(card, storyFilms);"));
  assert.ok(src.includes("where: { shopId: shop.id, type: \"GENERATE_VIDEO_AD\", status: \"COMPLETED\", processedAt: { gte: new Date(at - 2 * 60_000), lte: new Date(at + 10 * 60_000) } },"));
  assert.ok(src.includes("card.setup.cast = castFromJobPayloads(film, jobs.map((j) => j.payload));"));
  assert.ok(src.includes("} catch { /* nobody cast, as before */ }"));
  // what the job is known to hold: the payload a film is queued with
  assert.ok(src.includes("...(cast ? { cast } : {}),"));
  assert.ok(src.includes("...(narrated ? { filmMode: \"narrated\", ...(filmNarrator ? { filmNarrator } : {}) } : {}),"));
  assert.ok(src.includes("filmTemplate: tmpl.key, filmTopic: topic, filmScenes: scenes,"));
  assert.ok(read("app", "lib", "film-dialogue.server.ts").includes("await ckpt({ ckClips: clips });"));
});
