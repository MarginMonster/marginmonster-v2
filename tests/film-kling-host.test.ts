/* Kling 3 Omni is the model every approved film was made with. Replicate charges $0.28 a second for it
 * (pro, with audio); fal sells the same model as "O3" for $0.14 (pro) and $0.112 (standard). The owner
 * picked fal standard by ear (2026-11-19), so it is the default; FILM_KLING_HOST moves it back, the same
 * model on the other hosts is the fallback, and an admin ENGINE TEST renders a shot or a whole film on
 * another host without touching the film. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("fal's Kling 3 Omni endpoints are the O3 ones, and fal's PRO tier (1080p) is the default host", () => {
  const src = read("app/lib/film-dialogue.server.ts");
  assert.ok(src.includes('const FAL_KLING3_OMNI = "fal-ai/kling-video/o3/pro/image-to-video";'));
  assert.ok(src.includes('const FAL_KLING3_OMNI_STD = "fal-ai/kling-video/o3/standard/image-to-video";'));
  const fn = src.slice(src.indexOf("export function filmKlingHost"), src.indexOf("export function filmKlingHost") + 400);
  assert.ok(fn.includes('process.env.FILM_KLING_HOST'), "read from the environment");
  // (fal standard — the owner's pick by ear, 2026-11-19 — until 2026-11-25: "yes obviously upgrade the best image
  //  possible". The same Kling 3 Omni; the pro tier is 1080p, standard 720p.)
  assert.ok(/: "fal";\s*\n\}/.test(fn), "unset (or anything unknown) means fal's pro tier");
  assert.ok(fn.includes('v === "fal-std" ? "fal-std"'), "FILM_KLING_HOST=fal-std moves films back to the standard tier");
  assert.ok(fn.includes('v === "replicate" ? "replicate"'), "FILM_KLING_HOST=replicate still moves films back");
  const body = src.slice(src.indexOf("async function klingDialogueClip"), src.indexOf("async function dialogueClip"));
  const pro = body.slice(body.lastIndexOf(": ["));
  const a = pro.indexOf('name: "fal kling 3 omni"'), b = pro.indexOf('name: "fal kling 3 omni standard"'), c = pro.indexOf('name: "replicate kling 3 omni"');
  assert.ok(a > 0 && b > a && c > b, "fal pro: pro → the same model's standard tier → Replicate");
});

test("each host falls back to the same model on the other host before fal's different Kling 3 Pro", () => {
  const src = read("app/lib/film-dialogue.server.ts");
  const body = src.slice(src.indexOf("async function klingDialogueClip"), src.indexOf("async function dialogueClip"));
  const rep = body.slice(body.indexOf('host === "replicate"'), body.indexOf(": ["));
  const a = body.indexOf('name: "replicate kling 3 omni"'), b = body.indexOf('name: "fal kling 3 omni"'), c = body.indexOf('name: "fal kling 3 pro"');
  assert.ok(a > 0 && b > a && c > b, "replicate host: replicate omni → fal omni → fal kling 3 pro");
  assert.ok(rep.length > 0);
  assert.ok(body.includes('mode: "pro"'), "Replicate keeps the pro mode every approved film used");
  assert.ok(body.includes("generateAudio: true"), "fal renders with native audio");
});

test("the engine test never re-cuts the film it was taken from", () => {
  const src = read("app/lib/film-edit.server.ts");
  const fn = src.slice(src.indexOf("export async function engineTestFilmShot"));
  assert.ok(fn.length > 100);
  assert.ok(!fn.includes("saveCut("), "the film is not touched");
  assert.ok(fn.includes('kind: "enginetest"'), "kept as its own piece");
  const route = read("app/routes/web.filmedit.$id.tsx");
  const op = route.slice(route.indexOf('if (op === "enginetest")'), route.indexOf('if (op === "regen")'));
  assert.ok(op.includes("isAdminEmail(account.email)"), "admins only");
});

test("fal standard falls back to fal's pro tier (still half Replicate's price) before Replicate", () => {
  const src = read("app/lib/film-dialogue.server.ts");
  const body = src.slice(src.indexOf("async function klingDialogueClip"), src.indexOf("async function dialogueClip"));
  const std = body.slice(body.indexOf('host === "fal-std"'));
  const a = std.indexOf('name: "fal kling 3 omni standard"'), b = std.indexOf('name: "fal kling 3 omni"'), c = std.indexOf('name: "replicate kling 3 omni"'), d = std.indexOf('name: "fal kling 3 pro"');
  assert.ok(a > 0 && b > a && c > b && d > c, "fal-std: standard → fal pro → Replicate → fal kling 3 pro");
});

test("the whole-film engine test is cut like a render and never touches the film it came from", () => {
  const src = read("app/lib/film-edit.server.ts");
  const fn = src.slice(src.indexOf("export async function engineTestFilm("));
  assert.ok(fn.length > 100);
  assert.ok(!fn.includes("saveCut("), "the original film is not touched");
  assert.ok(fn.includes("finishCut("), "cut, levelled and captioned the way the render finishes a film");
  assert.ok(fn.includes("shot.chained && prevLast ? prevLast"), "a continuing shot continues THIS version's previous take");
  assert.ok(fn.includes("applyShotVoice("), "the film's cast voices go on its new takes");
  assert.ok(fn.includes('kind: "enginetest", whole: true'), "kept as its own film");
  const q = read("app/lib/job-queue.server.ts");
  assert.ok(q.includes("abHost && payload.whole === true"), "queued as the whole-film variant of the engine test");
});
