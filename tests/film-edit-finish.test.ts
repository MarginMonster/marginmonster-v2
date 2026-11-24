/* A film edited in the shot editor (trim · speed · volume · delete · regenerate) is cut again from its
 * shots. That cut used to be the bare assembler: the film lost its captions, the loudness it was levelled
 * to (it came back ~8 dB quieter) and its soft seams. Every edit now finishes the cut the way the render
 * finishes a film. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("every saved edit is finished like a render: soft seams, loudness, captions", () => {
  const src = read("app/lib/film-edit.server.ts");
  const save = src.slice(src.indexOf("async function saveCut"), src.indexOf("export async function editFilmShot"));
  assert.ok(save.includes("finishCut("), "saveCut finishes the cut");
  assert.ok(!save.includes("assembleTestMovie("), "no bare re-assembly left in saveCut");
  const fin = src.slice(src.indexOf("async function finishCut"), src.indexOf("async function saveCut"));
  assert.ok(fin.includes("outPath, undefined, soft, film.aspect, hard)"), "a new picture keeps its softer dissolve — and a cut to another place stays straight");
  assert.ok(fin.includes("if (i > 0 && p.shot.cut === \"hard\") hard.add(i); else if (i > 0 && !p.shot.chained) soft.add(i);"));
  assert.ok(fin.includes("!p.shot.chained"), "only a continuing shot gets the invisible short dissolve");
  assert.ok(fin.includes("levelFilm(outPath)"), "levelled to the catalogue's loudness");
  assert.ok(fin.includes("captionFilm("), "captions drawn again");
  assert.ok(fin.includes("captionStyleOf(film.meta.captions"), "only when the film was made with captions");
});

test("the quick edits don't hold the request open for minutes waiting on the captions", () => {
  const src = read("app/lib/film-edit.server.ts");
  const edit = src.slice(src.indexOf("export async function editFilmShot"), src.indexOf("async function applyShotVoice"));
  assert.ok(/QUICK = \{ listenMs: \d+_000 \}/.test(edit));
  assert.equal((edit.match(/, QUICK\)/g) || []).length, 2, "delete and trim/speed/volume both pass the cap");
  const cap = read("app/lib/film-captions.server.ts");
  assert.ok(cap.includes("o.listenMs"), "the captioner honours the cap");
});

test("a re-rolled last shot keeps its beat of quiet, and its cast voice", () => {
  const src = read("app/lib/film-edit.server.ts");
  const regen = src.slice(src.indexOf("export async function regenerateFilmShot"), src.indexOf("export async function engineTestFilmShot"));
  assert.ok(regen.includes("last: i === film.shots.length - 1"));
  assert.ok(regen.includes("applyShotVoice(newClip, shot)"));
  const dlg = read("app/lib/film-dialogue.server.ts");
  const fn = dlg.slice(dlg.indexOf("export async function renderDialogueClipTo"), dlg.indexOf("export async function renderDialogueClipTo") + 900);
  assert.ok(fn.includes("last: !!opts.last"), "the trim is told it is the film's last shot");
});
