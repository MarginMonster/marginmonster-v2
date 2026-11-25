/* THE STORY FORMATS (Kids Cartoon, Moral Story, Horror Story, Short Film) DO NOT THROW WORK AWAY.
 *
 * An audit of the Movie Maker's other formats (2026-11-22) found the music video's lessons had not reached
 * them: one tap on another face, on Acted/Narrated, on a length or on "Rewrite" started the script over
 * without a word; typing in the idea box wiped the drawn scenes on the first keystroke; "Generate" went
 * straight back to live after queueing a film, so a second tap queued it twice; and stepping out to the
 * posters and back into the same format came back blank.
 *
 * And from the first monster music video (same day): a solo scene was drawn in the shape of the
 * reference picture, not of the video.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// (line endings made the same: a fresh checkout on Windows has CRLF, and two tests here failed on it alone)
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/
/g, "
");
const ui = read("app", "routes", "web.film.tsx");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

test("a tap that would start the story over is armed first, and done on the second tap", () => {
  // one helper: nothing written yet → one tap, as before; the same tap again → it goes ahead
  assert.ok(ui.includes("const storyHasWork = !tmpl?.lipSyncSinger && (!!treatment || !!seeds);"));
  assert.ok(ui.includes("if (!wipes || !storyHasWork || wipeArm === key) { setWipeArm(\"\"); go(); } else setWipeArm(key);"));
  // the arm is dropped when the card is closed, the format changes, or the work is gone
  assert.ok(ui.includes("useEffect(() => { setWipeArm(\"\"); }, [storyCard, template, storyHasWork]);"));
  // every control that starts the script over goes through it
  assert.ok(ui.includes("onClick={() => orArm(\"cast:\", storyPick.length > 0, () => setStoryPick([]))}"));
  assert.ok(ui.includes("onClick={() => orArm(`cast:${r.id}`, true, () => toggleStoryPick(r.id))}"));
  // (Acted | Narrated is not one of them any more: how a story is told is the HERO that was picked —
  //  tests/film-heroes.test.ts — so there is no switch in the builder to arm)
  assert.ok(!ui.includes("orArm(\"told:") && !ui.includes("storyCard === \"told\""));
  assert.ok(ui.includes("onClick={() => orArm(`len:${n}`, !!treatment && treatment.scenes.length !== n, () => setStoryLen(n))}"));
  assert.ok(ui.includes("onClick={() => orArm(\"bump:-1\", !!treatment, () => bump(-1))}") && ui.includes("onClick={() => orArm(\"bump:1\", !!treatment, () => bump(1))}"));
  assert.ok(ui.includes("onClick={() => orArm(\"rewrite\", true, writeTreatment)}"));
  // …and none of them is still wired straight to the thing that wipes
  for (const direct of ["onClick={() => toggleStoryPick(r.id)}", "onClick={() => setTold(\"acted\")}", "onClick={() => setTold(\"narrated\")}", "onClick={() => setStoryLen(n)}", "onClick={() => bump(-1)}", "onClick={() => bump(1)}", "className=\"fs-rewrite\" onClick={writeTreatment}"]) {
    assert.ok(!ui.includes(direct), direct);
  }
  // it SAYS what the second tap does, beside the control
  for (const prefix of ["cast:", "len:", "bump:"]) assert.ok(ui.includes(`{wipeNote(${JSON.stringify(prefix)})}`), prefix);
  assert.ok(ui.includes("{wipeArm === \"rewrite\" ? t(\"Tap again to rewrite\") : t(\"Rewrite\")}"));
  assert.ok(ui.includes("{wipeArm === \"rewrite\" && <p className=\"mm-note mm-shape-warn\" role=\"status\">{t(\"A rewrite replaces every line, your edits too. The cast you picked stays.\")}</p>}"));
});

test("a new shape asks before it redraws a story's pictures — and an acted film's frames go with the old shape", () => {
  assert.ok(ui.includes("onClick={() => orArm(`shape:${a}`, filmAspect !== a && (!!seeds || frames.some(Boolean)), () => setFilmAspect(a))}"));
  assert.ok(ui.includes("{wipeArm.startsWith(\"shape:\") && <p className=\"mm-note mm-shape-warn\" role=\"status\">{t(\"A new shape draws every scene again, and your scene edits start over.\")}</p>}"));
  // frames drawn in the old shape were still sent as the shots' seeds
  assert.ok(ui.includes("useEffect(() => { if (!tmpl?.lipSyncSinger) { setSeeds(null); setFrames([]); } }, [filmAspect]);"));
});

test("a rewrite keeps its casting: the same name keeps the face and the voice it was given", () => {
  const fn = ui.slice(ui.indexOf("const keepCasting = ("), ui.indexOf("const keepCasting = (") + 700);
  assert.ok(fn.includes("if (!prev.length) return next;"), "a first script has nothing to carry");
  assert.ok(fn.includes("const was = prev.find((p) => nameTok(p.name) === nameTok(c.name));"));
  assert.ok(fn.includes("const face = !c.faceUrl && was.faceUrl ? { faceUrl: was.faceUrl, kind: was.kind, look: was.look } : {};"), "a face already brought by a picked presenter wins");
  assert.ok(fn.includes("const voice = was.voiceId && was.autoVoice === false && c.autoVoice !== false ? { voiceId: was.voiceId, autoVoice: false } : {};"), "only a voice the maker CHOSE is carried");
  // (a next episode's cast — face and voice by name, film-series.ts — is laid in between: castFromSeries)
  assert.ok(ui.includes("setCast((prev) => keepCasting(castFromSeries(castFromPicked(deriveCast(tr2))), prev));"));
  assert.ok(!ui.includes("setCast(castFromPicked(deriveCast(tr2)));"));
});

test("the idea box does not wipe what is made: it stays until the maker starts it over", () => {
  // the storyboard's reset no longer listens to the idea
  const reset = ui.slice(ui.indexOf("setSeeds(null); setCastForScene({}); setSceneCastPick(null); setSceneOutfits({}); }, ["), ui.indexOf("setSeeds(null); setCastForScene({}); setSceneCastPick(null); setSceneOutfits({}); }, [") + 260);
  assert.ok(!/[\[ ]topic[,\]]/.test(reset), "typing must not clear the drawn scenes");
  assert.ok(reset.includes("[filmGenre, JSON.stringify(filmProps), scenes, songSource, filmSongUrl, artistPick, mvAspect, featKey, JSON.stringify(outfits)]"));
  // typed with work on the page → only a flag; a music video's song with NO pictures yet is still rewritten for the new idea
  assert.ok(ui.includes("if (seeds || (treatment && !tmpl?.lipSyncSinger)) setIdeaChanged(true);"));
  assert.ok(ui.includes("else if (tmpl?.lipSyncSinger) setTreatment(null);"));
  // pictures gone another way → the old idea's song goes with them, and the note has nothing left to say
  const after = ui.slice(ui.indexOf("if (seeds || !ideaChanged) return;"), ui.indexOf("if (seeds || !ideaChanged) return;") + 260);
  assert.ok(after.includes("if (tmpl?.lipSyncSinger) setTreatment(null);") && after.includes("if (tmpl?.lipSyncSinger || !treatment) setIdeaChanged(false);"));
  // a freshly written script or song is made from the idea as it stands
  assert.ok(ui.includes("setCast((prev) => keepCasting(castFromSeries(castFromPicked(deriveCast(tr2))), prev)); setIdeaChanged(false); }"));
  // said under both idea boxes
  assert.ok(ui.includes("{ideaChanged && seeds && <p className=\"mm-note mm-idea-kept\" role=\"status\">{t(\"What you've made stays as it is — start over to use the new idea.\")}</p>}"));
  assert.ok(ui.includes("{ideaChanged && (seeds || treatment) && <p className=\"mm-note mm-idea-kept\" role=\"status\">{isStoryboard && !narrated ? t(\"Your script stays as it is — Rewrite to use the new idea.\") : t(\"What you've made stays as it is — start over to use the new idea.\")}</p>}"));
});

test("Generate says the film was sent, and stays sent until something in the film changes", () => {
  // (the idea counts only until a script exists: typing in the idea box afterwards must not make the button live again)
  // (…and the series it is an episode of: dropping it with ✕ makes it a different film)
  assert.ok(ui.includes("const storySig = `story:${JSON.stringify([template, treatment ? \"\" : topic, scenes, told, storyPick, filmAspect, captions, narratorId, dialogueEngine, lockVoices, prodTitle, prodImage, treatment, frames, seeds?.imgs || null, cast.map((c) => [c.name, c.faceUrl, c.voiceId]), series?.from || \"\"])}`;"));
  assert.ok(ui.includes("const storySent = sentSig === storySig;"));
  assert.ok(ui.includes("<Form method=\"post\" onSubmit={() => { sigAtSubmit.current = storySig; }}>"));
  assert.ok(ui.includes("<button type=\"submit\" className={`fs-go${storySent ? \" is-sent\" : \"\"}`} disabled={!canGo || storySent}>"));
  assert.ok(ui.includes("storySent ? <><Ico n=\"check\" size={16} /> {t(\"Rendering — it lands in your Archive\")}</>"));
  // declared after everything it reads (a `const` read before its line throws when the page renders)
  for (const dep of ["const [lockVoices, setLockVoices]", "const [dialogueEngine, setDialogueEngine]", "const [prodImage, setProdImage]", "const [capPick, setCapPick]", "const [sentSig, setSentSig]"]) {
    assert.ok(ui.indexOf(dep) > 0 && ui.indexOf(dep) < ui.indexOf("const storySig ="), dep);
  }
  assert.ok(ui.includes(".fs-go.is-sent:disabled{opacity:1;background:#E4F4EA;color:#0A5E37;"));
});

test("back to the posters and into the same format again keeps what was being made", () => {
  // (judged on the HERO since 2026-11-22: two heroes can share a template — tests/film-heroes.test.ts)
  assert.ok(ui.includes("window.setTimeout(() => { if (key !== heroId) switchHero(key); setEntered(true); setAnim(\"\"); setZoomKey(null); }, reduce ? 0 : 400);"));
});

test("phone: the story editor's small controls have a full-size place to tap", () => {
  const css = ui.slice(ui.indexOf("/* phone: the story editor's small controls get a full-size place to tap"), ui.indexOf("/* phone: the story editor's small controls get a full-size place to tap") + 1200);
  assert.ok(css.startsWith("/* phone: the story editor's small controls get a full-size place to tap — the look stays as it is */\n@media(max-width:640px){"));
  assert.ok(css.includes(".fs-stepper button{width:44px;height:44px;}"));
  for (const sel of [".fs-rewrite::after", ".fs-beat-add::after", ".fs-loc-addangle::after", ".fs-bchip::after", ".fs-actor-del::after", ".fs-msg-spk::after", ".fs-actor-recast::after", ".fs-shot-own summary::after"]) assert.ok(css.includes(sel), sel);
  assert.ok(css.includes("{content:\"\";position:absolute;left:0;right:0;top:50%;height:44px;transform:translateY(-50%);}"));
  assert.ok(css.includes(".fs-msg-x::after,.fs-anglecut-x::after{content:\"\";position:absolute;left:50%;top:50%;width:44px;height:44px;transform:translate(-50%,-50%);}"));
  // (.fs-shot-own summary keeps its "+" in ::before; the tap area is the ::after)
  assert.ok(ui.includes(".fs-shot-own summary::before{content:\"+\""));
});

test("a music video's solo scene is drawn in the VIDEO'S shape, not the reference picture's", () => {
  const img = read("app", "lib", "image-generation.server.ts");
  assert.ok(img.includes("export async function editSubjectIntoScene(subjectUrl: string, prompt: string, maxPrompt = 480, shape?: \"9:16\" | \"16:9\" | \"1:1\"): Promise<string | null> {"));
  assert.ok(img.includes("\"google/nano-banana-pro\", undefined, shape);"));
  assert.ok(img.includes("const shaped: Record<string, unknown> = shape ? { aspect_ratio: shape } : {};"));
  // on the first try, on the retry without the resolution, and on the fallback engine
  assert.equal(count(img, "...shaped }"), 3);
  // a photo EDIT still gives the user their own photo's shape back: no other caller passes one
  // (seven callers since the photo edit's second ask — tests/edit-check.test.ts — and still only one passes a shape)
  assert.equal(count(img, "await editImg2Img("), 7);
  assert.equal(count(img, ", undefined, shape)"), 1);
  const mv = read("app", "lib", "music-video-pipeline.server.ts");
  assert.equal(count(mv, "${senseNote}${fillNote}` }), SOLO_EDIT_MAX, asp)"), 2, "the storyboard's still and a re-rolled one");
  assert.ok(!mv.includes("${senseNote}${fillNote}` }), SOLO_EDIT_MAX)"));
  // the reference pictures themselves (the styled cast, the artist-with-prop anchor) keep their own shape
  assert.equal(count(mv, "editSubjectIntoScene("), 6);
});

test("every new line is translated", () => {
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of [
    "That starts your script over — tap it again to go ahead.",
    "Tap again to rewrite",
    "A rewrite replaces every line, your edits too. The cast you picked stays.",
    "What you've made stays as it is — start over to use the new idea.",
    "Your script stays as it is — Rewrite to use the new idea.",
  ]) {
    assert.ok(ui.includes(`t(${JSON.stringify(k)})`), k);
    assert.equal(count(dict, `\n  ${JSON.stringify(k)}:`), 5, k);
  }
});

test("each story format offers its own places — a kids' cartoon is not asked about a Bar", () => {
  const lists = ui.slice(ui.indexOf("const BACKDROPS_BY_FORMAT:"), ui.indexOf("const backdropsFor ="));
  const of = (fmt: string) => lists.slice(lists.indexOf(`\n  ${fmt}: [`), lists.indexOf("\n  ],", lists.indexOf(`\n  ${fmt}: [`)));
  const rows = (fmt: string) => [...of(fmt).matchAll(/\{ key: "([^"]+)", label: "([^"]+)", where: "([^"]+)" \}/g)].map((m) => ({ key: m[1], label: m[2], where: m[3] }));
  for (const fmt of ["kidstv", "horror", "moral"]) {
    const list = rows(fmt);
    assert.equal(list.length, 9, fmt);
    // the chip of the place a scene is in lights up by finding its key in the scene's `where`
    for (const b of list) assert.ok(b.where.toLowerCase().includes(b.key), `${fmt}: ${b.key}`);
    // …and no other chip of the same format lights up with it
    for (const b of list) assert.equal(list.filter((o) => b.where.toLowerCase().includes(o.key)).length, 1, `${fmt}: ${b.where}`);
  }
  for (const grown of ["Bar", "Diner", "Warehouse", "Office"]) assert.ok(!rows("kidstv").some((b) => b.label === grown), grown);
  for (const b of rows("horror")) assert.ok(/night|bare bulb/.test(b.where), `a horror place is dark: ${b.where}`);
  assert.ok(ui.includes("const backdropsFor = (format: string) => BACKDROPS_BY_FORMAT[format] || FILM_BACKDROPS;"), "Short Film keeps the general list");
  assert.ok(ui.includes("{backdropsFor(template).map((bd) => (") && !ui.includes("{FILM_BACKDROPS.map((bd) => ("));
  // the chip that lights is the place's key as a WHOLE WORD: a lighthouse lit "Old house" (seen 2026-11-22)
  assert.ok(ui.includes("const backdropIs = (where: string, key: string): boolean => new RegExp(`(^|[^a-z])${key}([^a-z]|$)`, \"i\").test(where || \"\");"));
  assert.ok(ui.includes("className={`fs-bchip${backdropIs(loc.where, bd.key) ? \" on\" : \"\"}`}") && !ui.includes("loc.where.toLowerCase().includes(bd.key)"));
  const is = (where: string, key: string) => new RegExp(`(^|[^a-z])${key}([^a-z]|$)`, "i").test(where);
  assert.equal(is("a lighthouse lamp room at night, the sea black beyond the glass", "house"), false);
  assert.equal(is("the hallway of an old house at night", "house"), true);
  assert.equal(is("a multi-storey carpark at night", "car"), false);
  assert.equal(is("Inside a parked car at night", "car"), true);
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const fmt of ["kidstv", "horror", "moral"]) for (const b of rows(fmt)) assert.equal(count(dict, `\n  ${JSON.stringify(b.label)}:`), 5, b.label);
});
