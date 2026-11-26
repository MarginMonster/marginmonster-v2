/* THE CAMERA OF A STILL STORY, WHERE IT IS PICKED AND HOW IT TRAVELS (2026-11-26).
 *
 * The owner: "Image still story line needs optional selects for the image similar to other providers (shake, slight
 * motion, etch etch)". A row of small live tiles under Still in the Length step (CameraPick: each tile the format's own
 * picture doing its move); the same row on one picture of the storyboard (its first tile the story's camera). The pick
 * rides the job (`filmStillCamera`, and `camera` on a scene of the approved story), is kept on the piece
 * (meta.stillCamera; a scene's own on its scene in the treatment), and comes back for Edit story, Next episode and
 * Another language. The cut is tests/story-still-camera.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { storyToEditFrom } from "../app/lib/story-edit.ts";
import { nextEpisodeCards } from "../app/lib/film-series.ts";
import { STILL_CAMERA_NAMES } from "../app/lib/story-motion.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const film = read("app", "routes", "web.film.tsx");
const lengthPanel = () => film.slice(film.indexOf('{storyCard === "length" && ('), film.indexOf('{storyCard === "shape" && ('));
const pick = film.slice(film.indexOf("function CameraPick("), film.indexOf("/* ───────── THE LYRIC VIDEO BUILDER"));

test("the Length step: under Still, a row of live tiles — one each camera, Gentle picked until another is — and nothing for a moving story", () => {
  const panel = lengthPanel();
  // after the Still / Moving tiles; only while the story is told over its stills (Still picked, or a server whose
  // pictures cannot move at all — lenStill, the same test the price follows)
  assert.ok(panel.indexOf("<CameraPick ") > panel.indexOf("<PicturesPick "));
  assert.ok(panel.includes("{lenStill && (\n                  <div className=\"mm-camrow\">"));
  assert.ok(panel.includes('<CameraPick value={stillCamera} onPick={(k) => setStillCamera(k || "gentle")} pic={posterPicOf(heroById(heroId)?.media || "shortstory")} t={t} />'));
  assert.ok(film.includes('const lenStill = narrated && (!d.storyMotion || pictures === "still");'));
  assert.ok(film.includes('const [stillCamera, setStillCamera] = useState<StillCamera>("gentle");'));
  // the tiles: every camera, each its own move by class, its name under it; the picked one ticked; on a storyboard
  // picture the STORY'S camera first
  assert.ok(pick.includes("...STILL_CAMERAS.map((k) => ({ k, name: STILL_CAMERA_NAMES[k], moves: k })),"));
  assert.ok(pick.includes("...(story ? [{ k: null, name: \"Story's camera\", moves: story }] : []),"));
  assert.ok(pick.includes('className={`mm-cam is-${o.moves}${o.k ? "" : " is-story"}${on ? " on" : ""}`} aria-pressed={on}'));
  assert.ok(pick.includes('<span className="mm-cam-nm">{t(o.name)}</span>'));
  // NO PARAGRAPH: the tile is the explanation — no sentence in the row at all
  assert.ok(!/<small|<p /.test(pick), "no words but the names");
  // choosing a camera throws nothing away
  assert.ok(!/orArm|setSeeds|setTreatment/.test(pick));
  // a new format is Gentle again
  assert.ok(film.includes('setStoryCard(null); setStoryDone({}); setPictures("moving");\n    setStillCamera("gentle"); setCamPick(null);'));
  // and the Length card says a camera that is not Gentle beside "Still pictures"
  assert.ok(film.includes('{pictures === "still" && stillCamera !== "gentle" ? <> · {t(STILL_CAMERA_NAMES[stillCamera])}</> : null}'));
});

test("the tiles MOVE, each as its camera does — live, on the picture itself — and stand still for less motion; four a row on a phone", () => {
  const css = film.slice(film.indexOf("/* THE CAMERA OF A STILL STORY (CameraPick"), film.indexOf(".mm-cam-drawer .mm-cams{margin-top:2px;}"));
  for (const [cls, kf] of [["is-gentle img", "mmCamGentle"], ["is-zoomin img", "mmCamIn"], ["is-zoomout img", "mmCamOut"], ["is-pan img", "mmCamPan"], ["is-handheld .mm-cam-hand", "mmCamSway"], ["is-handheld img", "mmCamTilt"], ["is-shake .mm-cam-hand", "mmCamJit"]]) {
    assert.ok(css.includes(`.mm-cam.${cls}{animation:${kf} `), cls);
    assert.ok(css.includes(`@keyframes ${kf}{`), kf);
  }
  assert.ok(!css.includes(".mm-cam.is-still"), "No move does not move");
  assert.ok(css.includes("@media(prefers-reduced-motion:reduce){.mm-cam img,.mm-cam .mm-cam-hand{animation:none !important;}}"));
  assert.ok(css.includes(".mm-cams{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;}"), "phone first: four a row");
  // the zoom tiles dip to dark between goes — a cut, not a snap back
  assert.ok(css.includes("@keyframes mmCamIn{0%{transform:scale(1);opacity:0;}"));
  // a storyboard picture's chip reaches 44 px to the finger
  assert.ok(css.includes(".mm-sc-cam::after{content:\"\";position:absolute;inset:-10px -4px;}"));
});

test("a storyboard picture: a chip on it says its camera; a tap opens the row under its card; a pick is kept ON the scene", () => {
  const sb = film.slice(film.indexOf("const storyboard = (autofill = false"), film.indexOf("const editCaption = (i: number, v: string) => {"));
  // the chip — a told story over its stills, once its pictures are drawn: the story's camera quietly, its own in green
  assert.ok(sb.includes("{narrated && lenStill && !!seeds && (() => {\n                      const own = stillCameraOf(sc?.camera);"));
  assert.ok(sb.includes('<button type="button" className={`mm-sc-cam${own ? " is-own" : ""}${camPick === i ? " open" : ""}`} onClick={() => setCamPick(camPick === i ? null : i)} aria-expanded={camPick === i} aria-label={said} title={said}>'));
  assert.ok(sb.includes("<Ico n=\"camera\" size={11} /><span>{t(STILL_CAMERA_NAMES[own || stillCamera])}</span>"));
  // the row: the same CameraPick, on THIS picture, the story's camera first; a pick closes it
  assert.ok(sb.includes("{narrated && lenStill && !!seeds && camPick === i && ("));
  assert.ok(sb.includes('<CameraPick value={stillCameraOf(sc?.camera)} story={stillCamera} pic={u || posterPicOf(heroById(heroId)?.media || "shortstory")} onPick={(k) => { setSceneCamera(i, k); setCamPick(null); }} t={t} />'));
  // kept on the scene (so it goes where the scene goes, and rides the approved story); the story's = no key at all
  assert.ok(film.includes("const as = (s: Scene): Scene => { if (cam) return { ...s, camera: cam }; const { camera: _drop, ...rest } = s; return rest; };"));
  assert.ok(film.includes("type Scene = { visual: string; caption?: string; where?: string; shot?: string; tone?: string; kind?: \"perform\" | \"broll\"; singer?: string; /** a told story's still picture's OWN camera (CameraPick on the storyboard) */ camera?: StillCamera };"));
  assert.ok(film.includes('{(seeds?.treatment || treatment) && <input type="hidden" name="approvedTreatment" value={JSON.stringify(seeds?.treatment || treatment)} />}'), "the scenes go as they are");
});

test("the pick rides the job: the form, the action (only a camera passes), the queue, the cut (only over stills), the piece", () => {
  assert.ok(film.includes('{isStoryboard && lenStill && stillCamera !== "gentle" && <input type="hidden" name="filmStillCamera" value={stillCamera} />}'));
  assert.ok(film.includes('...(narrated && stillCameraOf(form.get("filmStillCamera")) ? { filmStillCamera: stillCameraOf(form.get("filmStillCamera")) } : {}),'));
  assert.ok(read("app", "lib", "job-queue.server.ts").includes('stillCamera: typeof payload.filmStillCamera === "string" ? payload.filmStillCamera : undefined,'));
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes('const stillCamera = stillCameraOf(opts.stillCamera) || "gentle";'));
  // a moving story is the engine's: the cameras are given only when its pictures are not brought to life; each scene's
  // own (from the approved story) before the story's
  assert.ok(nar.includes("const cameras = !storyMotionOn(opts.pictures) ? treatment.scenes.map((s) => stillCameraOf((s as { camera?: unknown }).camera) || stillCamera) : undefined;"));
  assert.ok(nar.includes("await assembleNarrated({ stills, clips: motion?.clips, windows, voPath, musicPath, cards: wordsDrawable ? cards : [], style, fontFile, W, H, outPath, jobId, cameras });"));
  // kept on the piece; the treatment (with each scene's own) is kept on its body as it always was
  assert.ok(nar.includes('...(cameras && stillCamera !== "gentle" ? { stillCamera } : {}),'));
  assert.ok(nar.includes('bodyJson: JSON.stringify({ style: "NARRATED", videoUrl: `/renders/${outName}`, prompt: opts.topic || "", script: lines.join(" "), treatment }),'));
});

const meta = (extra: Record<string, unknown>) => JSON.stringify({ kind: "narrated", template: "testmovie", aspect: "9:16", captions: "bold", narrator: "", rung: "still", ...extra });
const body = (cams: Array<unknown>) => JSON.stringify({
  prompt: "TEST idea", videoUrl: "/renders/nar-TEST.mp4",
  treatment: { title: "TEST Story", musicMood: "", cast: [], scenes: [1, 2, 3].map((n, k) => ({ visual: `TEST scene ${n}`, caption: `TEST line ${n}.`, ...(cams[k] !== undefined ? { camera: cams[k] } : {}) })) },
});

test("EDIT STORY: the story's camera comes back, and each picture's own on its scene (anything that is not a camera does not)", () => {
  const st = storyToEditFrom({ id: "a_TEST", metaJson: meta({ stillCamera: "handheld" }), bodyJson: body(["shake", undefined, "warp-drive"]) }, null);
  assert.ok(st);
  assert.equal(st!.camera, "handheld");
  assert.equal(st!.treatment.scenes[0].camera, "shake");
  assert.equal("camera" in st!.treatment.scenes[1], false);
  assert.equal("camera" in st!.treatment.scenes[2], false, "not a camera: dropped");
  const plain = storyToEditFrom({ id: "b_TEST", metaJson: meta({}), bodyJson: body([]) }, null);
  assert.equal(plain!.camera, "gentle", "a story that never said is Gentle");
  // the page: after switchHero (which sets Gentle), so the story's wins; the scenes come with the storyboard
  assert.ok(film.includes("if (st.camera) setStillCamera(st.camera);"));
  assert.ok(film.indexOf("if (st.camera) setStillCamera(st.camera);") > film.indexOf("const startEdit = (st: StoryToEdit) => {"));
  assert.ok(film.includes("setTreatment(st.treatment);"));
});

test("NEXT EPISODE: it moves as the last one did; ANOTHER LANGUAGE: told again with the same camera, each scene's own on its scene", () => {
  const rows = [
    { id: "ep1_TEST", title: "TEST", metaJson: meta({ stillCamera: "shake" }), bodyJson: body([]) },
  ];
  const [card] = nextEpisodeCards(rows);
  assert.ok(card, "a TEST story gives a Next episode card");
  assert.equal(card.setup.camera, "shake");
  assert.equal(card.setup.still, true);
  const [gentle] = nextEpisodeCards([{ ...rows[0], metaJson: meta({}) }]);
  assert.equal("camera" in gentle.setup, false, "Gentle is said by saying nothing");
  assert.ok(film.includes("if (isNarr && s.camera) setStillCamera(s.camera);"));
  assert.ok(film.indexOf("if (isNarr && s.camera) setStillCamera(s.camera);") > film.indexOf("const startEpisode = (c: NextEpisodeCard) => {"));
  // Another language: the job is told the camera; the treatment it re-tells (each scene's own camera on it) is the
  // story's own, its captions translated (story-translate.ts → translatedTreatment keeps every other field of a scene)
  const tr = read("app", "lib", "story-translate.server.ts");
  assert.ok(tr.includes('...(storyCameraOf(meta) !== "gentle" ? { filmStillCamera: storyCameraOf(meta) } : {}),'));
  assert.ok(read("app", "lib", "story-translate.ts").includes("scenes: treatment.scenes.map((s, i) => ({ ...s, caption: told[i] }))"));
});

test("every word of it in all five languages", () => {
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  const blocks = ["es", "fr", "de", "zh", "ur"].map((l) => {
    const at = dict.indexOf(`const ${l}: Record<string, string> = {`);
    return dict.slice(at, dict.indexOf("\n};", at));
  });
  const words = ["The camera", "Story's camera", "Scene {n} · camera: {name}", ...Object.values(STILL_CAMERA_NAMES)];
  for (const w of words) for (const [k, b] of blocks.entries()) assert.ok(b.includes(`\n  ${JSON.stringify(w)}: `), `${w} — ${["es", "fr", "de", "zh", "ur"][k]}`);
  // (a placeholder kept as it is in every language)
  for (const b of blocks) { const line = b.slice(b.indexOf('"Scene {n} · camera: {name}"')); const v = line.slice(0, line.indexOf("\n")); assert.ok(v.split(":").slice(1).join(":").includes("{n}") && v.includes("{name}", v.indexOf(": ") + 2), v); }
});
