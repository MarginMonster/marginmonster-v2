/* THE SCENE BOARD IS THE MOVIE MAKER'S SCRIPT EDITOR.
 *
 * The owner, 2026-11-25, of an acted film's script editor — a fieldset per place, a title input, a row of nine
 * grey text chips, a text box per line with a seconds bar under every one: "Scene design also comes across as
 * fucking boring and a chore". The film kit built the answer (components/film/SceneBoard.tsx: a sheet per place
 * with a pencil sketch, the lines as speech bubbles beside the cast's faces, one-tap director's notes); this file
 * holds the page (app/routes/web.film.tsx) using it as THE editor:
 *   · it is mounted where the old editor was, for the same films, with every handler — and every edit the old
 *     one made still goes through the same mutateScenes, now made on the LATEST script;
 *   · sketches are asked for when a script arrives and when a place's words change — never per keystroke;
 *   · a director's note sends the whole script, the place and the note's KEY; the reply goes through
 *     mutateScenes; a failure says one line and changes nothing;
 *   · "Rewrite all" still asks first; the old editor's markup and rules are gone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { FILM_GENRES, backdropsOf, notesOf } from "../app/lib/film-genres.ts";
import { addLine, flowOf, movePlace, parseBeat, removePlace, setWhere, type FlowScene } from "../app/lib/film-flow.ts";
import { NEW_TAKE, REWRITE_FAILED, applyRewrite, noteByKey } from "../app/lib/film-rewrite.ts";
import { keepSketches, placesForSketch, sketchesFor, unsketched, sketchKey } from "../app/lib/film-sketch.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const page = read("app", "routes", "web.film.tsx");
const ui = page.slice(0, page.indexOf("const FS_STYLE = `"));
const css = page.slice(page.indexOf("const FS_STYLE = `"), page.indexOf("\n`;", page.indexOf("const FS_STYLE = `")));
const board = read("app", "components", "film", "SceneBoard.tsx");
const dict = read("app", "lib", "ui-i18n-dict.ts");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const between = (hay: string, a: string, b: string) => { const i = hay.indexOf(a); assert.ok(i >= 0, a); const j = hay.indexOf(b, i + a.length); assert.ok(j > i, b); return hay.slice(i, j); };

/** The board's JSX on the page, from its opening tag to its last prop. */
const mount = between(ui, "          <SceneBoard\n", "t={t} />") + "t={t} />";

// a made-up script: two places, three lines, a close-up
const KITCHEN = "TEST a lighthouse kitchen at night, one lamp burning";
const STAIRS = "TEST the spiral stairs inside the lighthouse, wet stone";
const SCRIPT: FlowScene[] = [
  { visual: "Wren sets down a lantern", where: KITCHEN, caption: "Wren: The lamp went out again." },
  { visual: "Odo looks up", where: KITCHEN, caption: "Odo: Then somebody is up there." },
  { visual: "Odo looks up", where: KITCHEN, shot: "close-up on Odo", caption: "Odo: Listen." },
  { visual: "They climb", where: STAIRS, caption: "Wren: Count the steps with me." },
];

test("the board IS the script editor: mounted where the old one was, for the same films, once a script exists", () => {
  assert.ok(page.includes("import { SceneBoard } from \"../components/film/SceneBoard\";"));
  assert.equal(count(ui, "<SceneBoard\n"), 1);
  // the same condition as the old editor (an acted story — the narrated one has its storyboard), with a script
  const at = ui.indexOf("<SceneBoard\n");
  const before = ui.slice(ui.lastIndexOf("{isStoryboard && narrated ? (", at), at);
  assert.ok(before.includes("      ) : isStoryboard && treatment ? (\n        <>\n"), "after the told story's card, for an acted script");
  // before a script: the card that writes one stays — "Write the dialogue — free", the empty box asks first
  const card = between(ui, "      ) : isStoryboard ? (\n        <div className=\"fs-card fs-scenecard\">", "      ) : (\n        <div className=\"fs-card\">");
  assert.ok(card.includes("<button type=\"button\" className=\"fs-write\" onClick={writeTreatment} disabled={writing}>"));
  assert.ok(card.includes("{writing ? <>… {t(\"Writing\")}</> : <><Ico n=\"wand\" size={14} /> {t(\"Write the dialogue — free\")}</>}"));
  assert.ok(card.includes("t(\"We'll write the dialogue — then you direct it on a storyboard: tap a line to change it, a note to rewrite a scene. No tokens until you Generate.\")"));
  assert.ok(!card.includes("treatment ?") && !card.includes("flow.map"), "the card no longer holds a script");
  // the old editor is gone, markup and rules (its pins moved: tests/film-story-fixes.test.ts)
  for (const gone of ["fs-flow", "fs-loc", "fs-msg", "fs-chat", "fs-meter", "fs-bchip", "fs-backdrops", "fs-scenetop", "fs-rewrite", "fs-anglecut", "fs-beat-add", "fs-addscene", "fs-scenecut", "fs-filmlen", "fs-who"]) {
    assert.ok(!new RegExp(`\\b${gone}\\b`).test(ui), `${gone}: markup`);
    assert.ok(!new RegExp(`\\.${gone}\\b`).test(css), `${gone}: rules`);
  }
  for (const gone of ["const setBeatLine", "const setBeatSpeaker", "const addBeat", "const addAngle", "const removeBeat", "const firstTok", "const WIDE", "const whereOf", "const backdropIs"]) assert.ok(!ui.includes(gone), gone);
  assert.ok(!/\b(clipFill|secondsLabel)\b/.test(page), "the old meter's helpers are no longer imported");
});

test("every edit the old editor made still goes through mutateScenes — and the board's two new ones too", () => {
  assert.ok(page.includes("import { addCloseUp, addLine, addScene, cycleSpeaker, flowOf, movePlace, parseBeat, removeAngle, removeLine, removePlace, setAngleShot, setLine, setWhere, speakersOf } from \"../lib/film-flow\";"));
  for (const prop of [
    "onLine={(i, text) => mutateScenes((ss) => setLine(ss, i, text, speakerNames))}",
    "onSpeaker={(i) => mutateScenes((ss) => cycleSpeaker(ss, i, speakerNames))}",
    "onAddLine={(i) => mutateScenes((ss) => addLine(ss, i, speakerNames))}",
    "onRemoveLine={(i) => mutateScenes((ss) => removeLine(ss, i))}",
    "onCloseUp={(i) => mutateScenes((ss) => addCloseUp(ss, i, speakerNames))}",
    "onAngleShot={(i, text) => mutateScenes((ss) => setAngleShot(ss, i, text))}",
    "onRemoveAngle={(i) => mutateScenes((ss) => removeAngle(ss, i))}",
    "onWhere={(li, where) => mutateScenes((ss) => setWhere(ss, li, where))}",
    // NEW: a place moved earlier or later, a place removed (the board asks twice itself)
    "onMove={(li, dir) => mutateScenes((ss) => movePlace(ss, li, dir))}",
    "onRemovePlace={(li) => mutateScenes((ss) => removePlace(ss, li))}",
    "onAddScene={() => mutateScenes((ss) => addScene(ss, speakerNames))}",
    "onNote={noteScene}",
    "onRewriteAll={() => orArm(\"rewrite\", true, writeTreatment)}",
  ]) assert.equal(count(mount, prop), 1, prop);
  // every prop the board takes is given
  const props = [...between(board, "export type SceneBoardProps = {", "\n};").matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
  assert.ok(props.length >= 30);
  for (const p of props.filter((x) => x !== "busy" && x !== "rewriteArmed")) assert.ok(new RegExp(`\\b${p}=\\{`).test(mount), p);
  assert.ok(mount.includes("busy={writing}") && mount.includes("rewriteArmed={wipeArm === \"rewrite\"}"));
  // the grouping and the speakers are film-flow's (the page's inline copies are gone)
  assert.ok(ui.includes("const flow = flowOf(treatment?.scenes);"));
  assert.ok(ui.includes("const speakerNames = speakersOf(treatment?.scenes, cast.map((c) => c.name));"));
});

test("mutateScenes is FUNCTIONAL: two edits in one tap both land", () => {
  const line = "  const mutateScenes = (fn: (scenes: Scene[]) => Scene[]) => setTreatment((tr) => (tr ? { ...tr, scenes: fn(tr.scenes.slice()) } : tr));";
  assert.ok(ui.includes(line + "\n"));
  // the scene count follows the script — an acted film's (a music video's count drives resets of its own)
  assert.ok(ui.includes("const actedScript = !!treatment && isStoryboard && !narrated && !tmpl?.lipSyncSinger;"));
  assert.ok(ui.includes("useEffect(() => { if (treatment && actedScript) setScenes(treatment.scenes.length); }, [treatment?.scenes.length]);"));
  // RUN the page's own line against a setTreatment that queues updaters as React does
  type Tr = { title?: string; scenes: FlowScene[] };
  const ts = createRequire(import.meta.url)("typescript");
  const js: string = ts.transpileModule(`type Scene = any;\n${line.trim()}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = (start: Tr, edits: ((ss: FlowScene[]) => FlowScene[])[]) => {
    let state: Tr | null = start;
    const queue: ((tr: Tr | null) => Tr | null)[] = [];
    const setTreatment = (u: (tr: Tr | null) => Tr | null) => queue.push(u);
    const mutateScenes = new Function("setTreatment", `${js}\nreturn mutateScenes;`)(setTreatment);
    for (const e of edits) mutateScenes(e);
    for (const u of queue) state = u(state);
    return state as Tr;
  };
  // the board's settle(): the place being retyped is sent, then the move — in one tap
  const after = run({ title: "TEST", scenes: SCRIPT }, [(ss) => setWhere(ss, 1, "TEST the lamp room at the top"), (ss) => movePlace(ss, 1, -1)]);
  assert.deepEqual(flowOf(after.scenes).map((l) => l.where), ["TEST the lamp room at the top", KITCHEN], "renamed AND moved");
  assert.equal(after.title, "TEST");
  // (built from the render's copy, as it was, the second edit dropped the first)
  const stale = SCRIPT;
  const old = [(ss: FlowScene[]) => setWhere(ss, 1, "TEST the lamp room at the top"), (ss: FlowScene[]) => movePlace(ss, 1, -1)].map((fn) => fn(stale.slice())).pop() as FlowScene[];
  assert.deepEqual(flowOf(old).map((l) => l.where), [STAIRS, KITCHEN], "the rename was lost");
  // nothing to edit: nothing happens
  assert.equal(run(null as unknown as Tr, [(ss) => addLine(ss, 0, ["Wren"])]), null);
});

test("the board's places are the genre's — each with its `where` — and its notes are the genre's", () => {
  assert.ok(mount.includes("backdrops={[...backdropsOf(template)]}"));
  // a backdrop MUST keep its `where`: without one a tap writes the LABEL ("Old house") into the scene
  for (const g of FILM_GENRES) for (const b of backdropsOf(g.tmpl)) assert.ok(b.where && b.where.length > b.label.length, `${g.tmpl}: ${b.key}`);
  assert.ok(board.includes("const where = (bd.where || t(bd.label)).trim();"), "the board writes `where` when it has one");
  assert.ok(mount.includes("notes={notesOf(template).map(({ key, label }) => ({ key, label }))}"), "only the key and the word go to the browser");
  // …and every note a board can send (the genre's four and "New take") is one the server finds by its key
  for (const g of FILM_GENRES) for (const key of [...notesOf(g.tmpl).map((n) => n.key), NEW_TAKE.key]) assert.ok(noteByKey(notesOf(g.tmpl), key), `${g.tmpl}: ${key}`);
  assert.equal(noteByKey(notesOf("horror"), "write it as a song"), null, "a key the genre does not offer is no note");
  for (const g of FILM_GENRES) for (const n of notesOf(g.tmpl)) assert.equal(count(dict, `\n  ${JSON.stringify(n.label)}:`), 5, n.label);
});

test("the film's shape, the cast's faces and the page's own length reach the board; a face tap cycles who speaks", () => {
  assert.ok(mount.includes("aspect={filmAspect} title={treatment.title}"));
  assert.ok(mount.includes("flow={flow} speakers={speakerNames} faceOf={faceOf} displayName={displayName}"));
  // the faces are the cast's — the Cast step edits that same cast, so a face cast there shows here at once
  assert.ok(ui.includes("const faceOf = (name: string) => cast.find((c) => c.name && name && nameTok(c.name) === nameTok(name))?.faceUrl || null;"));
  assert.ok(ui.includes("const displayName = (sp: string) => speakerNames.find((n) => nameTok(n) === nameTok(sp)) || sp;"));
  // a tap on a face (or a name) gives the line to the next of the cast — nothing on the board casts a face
  assert.ok(board.includes("<button type=\"button\" className=\"fk-face\" onClick={() => props.onSpeaker(b.idx)}"));
  assert.ok(!/tapStory|castCardRef/.test(mount));
  // the total is the page's own estimate of the spoken length; a long line shows its quiet mark by the same measure
  assert.ok(mount.includes("totalSeconds={treatment.scenes.reduce((a, s) => a + estimateSpeakSeconds(parseBeat(s.caption).line), 0)}"));
  assert.ok(mount.includes("secondsOf={estimateSpeakSeconds} maxSeconds={CLIP_MAX_SECONDS}"));
  // RUN: the estimate over the made-up script is the sum of its lines'
  assert.equal(SCRIPT.map((s) => parseBeat(s.caption).line).join("|"), "The lamp went out again.|Then somebody is up there.|Listen.|Count the steps with me.");
});

test("SKETCHES: one free intent — asked when a script arrives and when a place's words change, never per keystroke", () => {
  // the action: after the template and plan checks, before the product guard; free; the member's hourly budget
  const act = between(page, "  if (intent === \"sketchFilmScenes\") {", "\n  }\n");
  assert.ok(page.indexOf("if (intent === \"sketchFilmScenes\")") > page.indexOf("if (!shop.activePlan?.active) return json(") && page.indexOf("if (intent === \"sketchFilmScenes\")") > page.indexOf("const tmpl = filmTemplate(templateKey || undefined);"));
  assert.ok(page.indexOf("if (intent === \"sketchFilmScenes\")") < page.indexOf("if (tmpl.needsProduct && !productImageUrl) {"));
  assert.ok(act.includes("const places = parseSketchPlaces(form.get(\"places\"));"));
  assert.ok(act.includes("return json({ sketches: places.length ? await sketchPlaces(places, sketchAspect(form.get(\"filmAspect\")), undefined, shop.id) : [] });"));
  assert.ok(!/spendTokens|enqueueJob/.test(act), "free, and nothing is made of the film");
  // the page: one debounced effect — on the places' WORDS (placesKey), not on every edit; 900ms after the last
  const fx = between(ui, "  useEffect(() => {\n    if (!actedScript || sketchFetcher.state !== \"idle\") return;", "}, [placesKey, sketchFetcher.state, actedScript]);");
  assert.ok(ui.includes("const placesKey = flow.map((l) => l.where).join(\"|\");"));
  assert.ok(fx.includes("const places = unsketched(placesForSketch(scriptNow.current?.scenes), sketchByWhere, sketchTried.current);"));
  assert.ok(fx.includes("places.forEach((p) => sketchTried.current.add(sketchKey(p.where)));"), "a failed sketch is not asked for again and again");
  assert.ok(fx.includes("sketchFetcher.submit({ intent: \"sketchFilmScenes\", template, filmAspect, places: JSON.stringify(places) }, { method: \"post\" });"));
  assert.ok(fx.includes("}, 900);") && fx.includes("return () => window.clearTimeout(id);"));
  // the board sends a place only when it is closed — on blur or Enter — never as it is typed
  assert.ok(board.includes("onChange={(e) => setWhereDraft(e.target.value.replace(/[\\r\\n]+/g, \" \"))} onBlur={() => sendWhere(li)}"));
  assert.ok(board.includes("if (e.key === \"Enter\") { e.preventDefault(); sendWhere(li); setOpenPlace(null); }"));
  // what comes back is kept by the place's words; a new script gives failed ones one more chance; a new shape redraws
  assert.ok(ui.includes("if (got?.sketches) setSketchByWhere((k) => keepSketches(k, sent, got.sketches || []));"));
  assert.ok(ui.includes("useEffect(() => { scriptGen.current += 1; sketchTried.current = new Set(); }, [treatmentFetcher.data, !treatment]);"));
  assert.ok(ui.includes("useEffect(() => { setSketchByWhere({}); sketchTried.current = new Set(); sketchSent.current = null; }, [filmAspect, template]);"));
  assert.ok(mount.includes("sketches={sketchesFor(flow, sketchByWhere)} sketching={sketchFetcher.state !== \"idle\"}"));
  // RUN, with the film kit's own functions, what that effect does: a script arrives → every place is asked for;
  // a place renamed → only that one; the same one again (it failed) → nothing
  const tried = new Set<string>();
  const ask = (scenes: FlowScene[], kept: Record<string, string>) => { const p = unsketched(placesForSketch(scenes), kept, tried); p.forEach((x) => tried.add(sketchKey(x.where))); return p.map((x) => x.where); };
  assert.deepEqual(ask(SCRIPT, {}), [KITCHEN, STAIRS]);
  const kept = keepSketches({}, placesForSketch(SCRIPT), ["/renders/test-1.jpg", null]);
  assert.deepEqual(sketchesFor(flowOf(SCRIPT), kept), ["/renders/test-1.jpg", null]);
  const renamed = setWhere(SCRIPT, 0, "TEST a fishing hut by the shore");
  assert.deepEqual(ask(renamed, kept), ["TEST a fishing hut by the shore"]);
  assert.deepEqual(ask(renamed, kept), [], "asked once");
  // moved: the sketch goes with its place (kept by its words)
  assert.deepEqual(sketchesFor(flowOf(movePlace(SCRIPT, 0, 1)), kept), [null, "/renders/test-1.jpg"]);
});

test("DIRECTOR'S NOTES: one free intent — the whole script, the place and the note's KEY; the reply goes through mutateScenes", () => {
  const act = between(page, "  if (intent === \"rewriteFilmScene\") {", "\n  }\n");
  assert.ok(page.indexOf("if (intent === \"rewriteFilmScene\")") < page.indexOf("if (tmpl.needsProduct && !productImageUrl) {"));
  // the sentence the writer reads is looked up on the server by key, from the genre's notes — never sent by a browser
  assert.ok(act.includes("const note = noteByKey(notesOf(tmpl.key), form.get(\"note\"));"));
  assert.ok(act.includes("const placeIndex = parseInt((form.get(\"placeIndex\") as string) || \"\", 10);"));
  assert.ok(act.includes("treatment = { title: typeof t0.title === \"string\" ? t0.title : undefined, scenes: t0.scenes.slice(0, 80) };"));
  assert.ok(act.includes(".slice(0, 4);"), "at most four speakers, each cut to 40");
  assert.ok(act.includes("if (!note || !treatment || !(placeIndex >= 0)) return json({ error: tr(lang, REWRITE_FAILED), placeIndex });"));
  assert.ok(act.includes("const lines = await rewritePlace({ treatment, placeIndex, note, speakers, template: { key: tmpl.key, name: tmpl.name, brief: tmpl.brief, childSafe: tmpl.childSafe } });"));
  assert.ok(act.includes("return lines ? json({ rewrite: { placeIndex, lines } }) : json({ error: tr(lang, REWRITE_FAILED), placeIndex });"));
  assert.ok(!/spendTokens|enqueueJob/.test(act));
  // the page: the sheet is held while the writer has it; what is sent is the script as it stands a moment
  // after the tap (the board puts a place being retyped into it in the same tap)
  const send = between(ui, "  const noteScene = (li: number, key: string) => {", "\n  };\n");
  assert.ok(send.includes("if (!treatment || notingPlace !== null || rewriteFetcher.state !== \"idle\" || writing) return;"));
  assert.ok(send.includes("setNotingPlace(li); setNoteFail(null);") && send.includes("noteAt.current = scriptGen.current;"));
  assert.ok(send.includes("rewriteFetcher.submit({ intent: \"rewriteFilmScene\", template, placeIndex: String(li), note: key, approvedTreatment: JSON.stringify(tr), speakers: JSON.stringify(speakersOf(tr.scenes, cast.map((c) => c.name))) }, { method: \"post\" });"));
  assert.ok(send.includes("const tr = scriptNow.current;") && send.includes("}, 0);"));
  assert.ok(mount.includes("noting={notingPlace}"));
  // the reply: through mutateScenes (onto the latest script) — unless the script was replaced meanwhile
  const got = between(ui, "    if (rewriteFetcher.state !== \"idle\" || !noteSent.current) return;", "}, [rewriteFetcher.state, rewriteFetcher.data]);");
  assert.ok(got.includes("if (got?.rewrite && noteAt.current === scriptGen.current) { const { placeIndex, lines } = got.rewrite; mutateScenes((ss) => applyRewrite(ss, placeIndex, lines)); }"));
  // a failure: one calm line, and nothing changes; the board lets go either way
  assert.ok(got.includes("else if (!got?.rewrite) setNoteFail({ place: typeof got?.placeIndex === \"number\" ? got.placeIndex : notingPlace ?? 0, text: got?.error || t(REWRITE_FAILED) });"));
  assert.ok(got.includes("setNotingPlace(null);"));
  assert.ok(ui.includes("{noteFail && createPortal(<p className=\"fs-notefail\" role=\"status\">{t(\"Scene {n}: {where}\", { n: noteFail.place + 1, where: noteFail.text })}</p>, document.body)}"));
  assert.ok(ui.includes("useEffect(() => { if (!noteFail) return; const id = window.setTimeout(() => setNoteFail(null), 7000); return () => window.clearTimeout(id); }, [noteFail]);"));
  assert.ok(css.includes(".fs-notefail{position:fixed;") && css.includes("@media(max-width:760px){.fs-notefail{bottom:calc(92px + env(safe-area-inset-bottom,0px));}}") && css.includes("@media(prefers-reduced-motion:reduce){.fs-notefail{animation:none;}}"));
  for (const k of [REWRITE_FAILED, "Scene {n}: {where}"]) assert.equal(count(dict, `\n  ${JSON.stringify(k)}:`), 5, k);
  // RUN: a reply replaces that place's lines and leaves every other line, and the place, as it was
  const done = applyRewrite(SCRIPT, 0, [{ caption: "Wren: TEST it went out by itself." }, { caption: "Odo: TEST then we go up." }]);
  assert.deepEqual(flowOf(done).map((l) => l.where), [KITCHEN, STAIRS]);
  assert.deepEqual(done.map((s) => s.caption).slice(-1), ["Wren: Count the steps with me."]);
  assert.ok(done.some((s) => s.caption === "Odo: TEST then we go up."));
});

test("REWRITE ALL still asks first, and what it says stays with the board", () => {
  assert.ok(mount.includes("onRewriteAll={() => orArm(\"rewrite\", true, writeTreatment)}"));
  assert.ok(ui.includes("if (!wipes || !storyHasWork || wipeArm === key) { setWipeArm(\"\"); go(); } else setWipeArm(key);"));
  const after = ui.slice(ui.indexOf("t={t} />", ui.indexOf("<SceneBoard\n")), ui.indexOf("      ) : isStoryboard ? (\n        <div className=\"fs-card fs-scenecard\">"));
  assert.ok(after.includes("{wipeArm === \"rewrite\" && <p className=\"mm-note mm-shape-warn\" role=\"status\">{t(\"A rewrite replaces every line, your edits too. The cast you picked stays.\")}</p>}"));
  assert.ok(after.includes("{treatmentFetcher.data?.error && <p className=\"fs-err fs-boarderr\">{treatmentFetcher.data.error}</p>}"));
  // while the whole script is written again, the board holds
  assert.ok(mount.includes("busy={writing}"));
  // the notes under the board stand on the page — their own paper, in both themes
  assert.ok(css.includes(".fk-board ~ .mm-shape-warn,.fk-board ~ .fs-boarderr{margin:12px 2px 0;text-align:left;}") && css.includes(".fs-boarderr{background:#FFF4EF;"));
});

test("the board's look is its own sheet, mounted once in both themes; every new word is translated", () => {
  assert.equal(count(ui, "<style dangerouslySetInnerHTML={{ __html: FILM_KIT_CSS }} />"), 1);
  assert.ok(!/\.fk-[a-z]/.test(css.replace(/\.fk-board ~ /g, "")), "no fk- rules in the page's sheet but the notes under it");
  const k = "We'll write the dialogue — then you direct it on a storyboard: tap a line to change it, a note to rewrite a scene. No tokens until you Generate.";
  assert.equal(count(dict, `\n  ${JSON.stringify(k)}:`), 5);
  // every word the board says is in the dictionary already (tests/film-kit.test.ts holds them, five times over)
  for (const m of board.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)) assert.equal(count(dict, `\n  ${JSON.stringify(JSON.parse(`"${m[1]}"`))}:`), 5, m[1]);
});

test("review of 2026-11-25: Generate waits for a note being written, and the board's asks do not reload the page's data", () => {
  // sent mid-note, the film was made without the note just tapped — and a second press made a second render
  assert.ok(ui.includes("<button type=\"submit\" className={`fs-go${storySent ? \" is-sent\" : \"\"}`} disabled={!canGo || storySent || notingPlace !== null}>"));
  // (declared before the JSX reads it — a `const` read before its line throws when the page renders)
  assert.ok(ui.indexOf("const [notingPlace, setNotingPlace] = useState<number | null>(null);") < ui.indexOf("disabled={!canGo || storySent || notingPlace !== null}"));
  // a sketch or a note moves nothing the loader reads: its answer does not re-run the loader; everything else does
  // (…and the guide box's reading of an idea too — tests/idea-route.test.ts)
  assert.ok(page.includes("const BOARD_INTENTS = new Set([\"sketchFilmScenes\", \"rewriteFilmScene\", \"readIdea\"]);"));
  assert.ok(page.includes("export const shouldRevalidate: ShouldRevalidateFunction = ({ formData, defaultShouldRevalidate }) =>\n  BOARD_INTENTS.has(String(formData?.get(\"intent\") || \"\")) ? false : defaultShouldRevalidate;"));
  // RUN the rule with a few intents
  const BOARD = new Set(["sketchFilmScenes", "rewriteFilmScene"]);
  const sr = (intent: string | null, dflt: boolean) => { const fd = new FormData(); if (intent) fd.set("intent", intent); return BOARD.has(String(fd.get("intent") || "")) ? false : dflt; };
  assert.equal(sr("sketchFilmScenes", true), false);
  assert.equal(sr("rewriteFilmScene", true), false);
  for (const other of ["previewFilmTreatment", "previewFilmPortrait", "film", null]) assert.equal(sr(other, true), true, String(other));
});

test("removing a place is asked twice by the board, and a script keeps at least one place", () => {
  assert.ok(board.includes("if (armed !== li) { setArmed(li); return; }"));
  assert.deepEqual(flowOf(removePlace(SCRIPT, 1)).map((l) => l.where), [KITCHEN]);
  assert.deepEqual(removePlace(removePlace(SCRIPT, 1), 0), removePlace(SCRIPT, 1), "the last place stays");
});
