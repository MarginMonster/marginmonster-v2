/* A SCENE'S WORDS FOLLOW ITS CAST.
 *
 * Seen on the live site, 2026-11-22: scene 2 of a storyboard was handed to KEIKO, to sing alone. Its words
 * still read "OMAR sings straight to camera under a glowing streetlamp, VALENTINA dancing softly beside
 * him, the black 1969 Mustang convertible parked behind them reflecting neon light." The picture is drawn
 * FROM those words: it came back with KEIKO in front and an invented woman walking at her side, and the
 * card said "OMAR sings" under a photograph of KEIKO. With the words corrected by hand the same re-roll
 * drew KEIKO alone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VISUAL_MAX, mentions, notInScene, recastAccept, recastNeeded, recastPrompt, recastVisual, type Recast } from "../app/lib/mv-recast.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");
const names = ["OMAR", "VALENTINA", "KEIKO"];
const LIVE = "OMAR sings straight to camera under a glowing streetlamp, VALENTINA dancing softly beside him, the black 1969 Mustang convertible parked behind them reflecting neon light.";
const who = (lead: string, wasLead: string, beside: string[] = []): Recast => ({ names, lead, wasLead, beside });

test("a name is a whole word, whatever its case", () => {
  assert.ok(mentions("omar leans on the car", "OMAR"));
  assert.ok(mentions("Behind them, KEIKO.", "keiko"));
  assert.ok(!mentions("OMARION sings", "OMAR"), "never the name inside a longer one");
  assert.ok(!mentions("a romarin bush", "OMAR"));
  assert.ok(mentions("The Ganve walks in", "The Ganve"), "a name of two words");
  assert.ok(!mentions("anything", ""), "a star with no name is named nowhere");
  assert.deepEqual(notInScene(who("KEIKO", "OMAR")), ["OMAR", "VALENTINA"]);
  assert.deepEqual(notInScene(who("KEIKO", "OMAR", ["OMAR"])), ["VALENTINA"]);
  assert.deepEqual(notInScene(who("OMAR", "OMAR", ["VALENTINA", "KEIKO"])), []);
});

test("words that are still true are never touched", () => {
  // nobody left, nobody new in front: they may be the maker's own words
  assert.equal(recastNeeded(LIVE, who("OMAR", "OMAR", ["VALENTINA", "KEIKO"])), false);
  assert.equal(recastVisual(LIVE, who("OMAR", "OMAR", ["VALENTINA", "KEIKO"])), LIVE);
  // someone was ADDED who the words do not name — the pictures carry them; the words stay
  assert.equal(recastNeeded("OMAR walks alone down the avenue.", who("OMAR", "OMAR", ["KEIKO"])), false);
  // a scene with nobody named in it
  assert.equal(recastNeeded("The skyline at blue hour, rain on the glass.", who("OMAR", "OMAR")), false);
  assert.equal(recastNeeded("", who("KEIKO", "OMAR")), false);
});

test("they must change when someone else leads the scene, or they name someone who has left it", () => {
  assert.equal(recastNeeded(LIVE, who("KEIKO", "OMAR")), true, "the live case");
  assert.equal(recastNeeded(LIVE, who("OMAR", "OMAR", ["KEIKO"])), true, "VALENTINA was taken out");
  assert.equal(recastNeeded("OMAR sings to camera on the roof.", who("KEIKO", "OMAR", ["OMAR"])), true, "the old lead stays, beside her");
  assert.equal(recastNeeded("The singer walks the pier at dawn.", who("KEIKO", "")), true, "a new lead the words do not name");
});

test("the plain rewrite: the live case reads right, and the stray person is gone", () => {
  assert.equal(recastVisual(LIVE, who("KEIKO", "OMAR")),
    "KEIKO sings straight to camera under a glowing streetlamp, the black 1969 Mustang convertible parked behind them reflecting neon light.");
  // a co-star taken out, the lead unchanged
  assert.equal(recastVisual(LIVE, who("OMAR", "OMAR", ["KEIKO"])),
    "OMAR sings straight to camera under a glowing streetlamp, the black 1969 Mustang convertible parked behind them reflecting neon light.");
  // the phrase where the NEW lead was only standing by goes with the swap
  assert.equal(recastVisual("OMAR sings to camera on the rooftop, KEIKO dancing behind him, string lights overhead.", who("KEIKO", "OMAR")),
    "KEIKO sings to camera on the rooftop, string lights overhead.");
  // the scene goes back to the star
  assert.equal(recastVisual("KEIKO alone sings straight to camera in a purple-lit lounge, the city glittering behind her.", who("OMAR", "KEIKO", ["VALENTINA"])),
    "OMAR alone sings straight to camera in a purple-lit lounge, the city glittering behind her.");
});

test("the plain rewrite never leaves the name of someone who is not in the scene", () => {
  const cases: Array<[string, Recast]> = [
    [LIVE, who("KEIKO", "OMAR")],
    ["OMAR and VALENTINA dance freely across an empty neon-lit parking garage rooftop, moving in rhythm under string lights.", who("OMAR", "OMAR")],
    ["VALENTINA and OMAR walk together along a glowing riverside promenade; KEIKO waits at the railing.", who("OMAR", "OMAR")],
    ["OMAR, VALENTINA and KEIKO at a rooftop railing, the skyline behind.", who("OMAR", "OMAR", ["KEIKO"])],
    ["OMAR leans on the hood with VALENTINA — the avenue empty behind them.", who("OMAR", "OMAR")],
    ["VALENTINA dances alone under the sign.", who("OMAR", "OMAR")],
    ["OMAR sings beside VALENTINA, KEIKO a step behind.", who("KEIKO", "OMAR")],
  ];
  for (const [text, o] of cases) {
    const out = recastVisual(text, o);
    assert.ok(out.length > 0 && out.length <= VISUAL_MAX, text);
    for (const n of notInScene(o)) assert.ok(!mentions(out, n), `${n} is still in: ${out}`);
    assert.match(out, /^[A-Z0-9]/, `starts like a sentence: ${out}`);
    assert.doesNotMatch(out, /\s{2,}|\s[,;.]|^[,;]/, `tidy: ${out}`);
  }
  // a phrase that keeps someone loses only the other name
  assert.equal(recastVisual("OMAR and VALENTINA dance on the roof, the city behind.", who("OMAR", "OMAR")), "OMAR dance on the roof, the city behind.");
  assert.equal(recastVisual("OMAR leans on the hood with VALENTINA, the avenue empty.", who("OMAR", "OMAR")), "OMAR leans on the hood, the avenue empty.");
  // "and" inside a word is not the joining word
  assert.equal(recastVisual("OMAR plays with the band VALENTINA booked, on a small stage.", who("OMAR", "OMAR")), "OMAR plays with the band booked, on a small stage.");
  // every phrase was about someone who left: the words stay, the names go
  assert.ok(!mentions(recastVisual("VALENTINA dances alone under the sign.", who("OMAR", "OMAR")), "VALENTINA"));
});

test("the instruction to the writer: who is in the shot, who is not, and the fewest changes", () => {
  const p = recastPrompt(LIVE, who("KEIKO", "OMAR"), true);
  assert.ok(p.includes(LIVE));
  assert.ok(p.includes("- In front, singing straight to camera: KEIKO"));
  assert.ok(p.includes("- With them: nobody else — they are alone in the shot"));
  assert.ok(p.includes("- NOT in the shot (they must not be mentioned at all): OMAR, VALENTINA"));
  assert.ok(p.includes("FEWEST changes") && p.includes("Never say what anyone wears."), "the wardrobe is locked: the words never dress anyone");
  assert.ok(p.includes(`at most ${VISUAL_MAX} characters`));
  const q = recastPrompt("OMAR sings on the roof.", who("KEIKO", "OMAR", ["OMAR"]), false);
  assert.ok(q.includes("- In front: KEIKO") && q.includes("- With them: OMAR"));
  assert.ok(!q.includes("NOT in the shot (they must not be mentioned at all): OMAR"), "he is beside her: only VALENTINA is out");
  assert.ok(q.includes("NOT in the shot (they must not be mentioned at all): VALENTINA"));
  // a star with no name is still someone
  assert.ok(recastPrompt("KEIKO sings on the pier.", who("", "KEIKO"), true).includes("- In front, singing straight to camera: the singer"));
});

test("the writer's answer is used only if it is one true description", () => {
  const o = who("KEIKO", "OMAR");
  const good = "KEIKO sings straight to camera under a glowing streetlamp, the black 1969 Mustang convertible parked behind her reflecting neon light.";
  assert.equal(recastAccept(good, LIVE, o), good);
  assert.equal(recastAccept(`  "${good}"  `, LIVE, o), good, "quotation marks round it are taken off");
  assert.equal(recastAccept(`Corrected description: ${good}`, LIVE, o), good);
  // it still names someone who is not in the scene
  assert.equal(recastAccept(good.replace("streetlamp,", "streetlamp, VALENTINA beside her,"), LIVE, o), null);
  assert.equal(recastAccept(LIVE, LIVE, o), null, "the old words are not an answer");
  // the old words named the lead; the new ones must name the new lead
  assert.equal(recastAccept("She sings straight to camera under a glowing streetlamp, the black 1969 Mustang parked behind her.", LIVE, o), null);
  // not a description at all
  assert.equal(recastAccept("", LIVE, o), null);
  assert.equal(recastAccept("I'm sorry, but I can't rewrite that.", LIVE, o), null);
  assert.equal(recastAccept("KEIKO sings.", LIVE, o), null, "the scene was thrown away");
  assert.equal(recastAccept(`KEIKO ${"sings and sings ".repeat(40)}`, LIVE, o), null, "an essay");
  // a short scene may stay short
  assert.equal(recastAccept("KEIKO walks the pier.", "OMAR walks the pier.", o), "KEIKO walks the pier.");
});

test("the server: the writer does the language, the plain rewrite stands behind it, and nothing waits long", () => {
  const srv = read("app", "lib", "mv-recast.server.ts");
  assert.ok(srv.includes("if (!recastNeeded(visual, who)) return { visual, by: \"kept\" };"), "true words are never sent anywhere");
  assert.ok(srv.includes("const plain = recastVisual(visual, who);"));
  assert.ok(srv.includes("anthropicText(recastPrompt(visual, who, performing), { model: \"claude-sonnet-5\", maxTokens: 220 })"));
  assert.ok(srv.includes("const ok = recastAccept(raw, visual, who);") && srv.includes("if (ok) return { visual: ok, by: \"writer\" };"));
  assert.ok(srv.includes("return { visual: plain, by: \"rule\" };"));
  assert.ok(srv.includes("Promise.race([") && srv.includes("RECAST_WAIT_MS = 12_000"), "the scene is about to be drawn: a slow writer is not waited for");
  assert.ok(!srv.includes("throw "), "it never fails the re-roll");
});

test("the page: the Cast editor says who is in the scene, the re-roll rewrites the words, the card shows them", () => {
  const ui = read("app", "routes", "web.film.tsx");
  // WHO, by name — sent only from the Cast editor's one button (a plain re-roll keeps the maker's words)
  const confirm = ui.slice(ui.indexOf("const confirmSceneCastMv"), ui.indexOf("// ---- Wardrobe (owner edit)"));
  assert.ok(confirm.includes("const who = { names: [artistName, ...castNamesAll].map((n) => (n || \"\").trim()).filter(Boolean), lead: singer || (artistName || \"\").trim(), wasLead: sceneSingerName(scenesArr[i], i, scenesArr.length) || (artistName || \"\").trim(), beside: sceneCastDraft.map((img) => castMemberName(img).trim()).filter(Boolean) };"));
  assert.ok(confirm.includes("rerollScene(i, undefined, sceneCastDraft, newSinger ? singer : undefined, wear, who);"));
  assert.ok(ui.includes("...(who ? { sceneWho: JSON.stringify(who) } : {})"));
  assert.equal(ui.split("sceneWho: JSON.stringify(who)").length - 1, 1);
  // THE ACTION: reads it carefully, rewrites, draws from the NEW words, and hands them back
  const act = ui.slice(ui.indexOf("if (intent === \"rerollFilmScene\") {"), ui.indexOf("if (intent === \"rerollFilmScene\") {") + 5200);
  assert.ok(act.includes("const who = parseSceneWho(form.get(\"sceneWho\") as string);"));
  assert.ok(act.includes("const { recastSceneText } = await import(\"../lib/mv-recast.server\");"));
  assert.ok(act.includes("const rc = await recastSceneText(sceneVisual, who, rerollKind === \"perform\");"));
  assert.ok(act.includes("sceneVisual: visualNow,"), "the picture is drawn from the new words");
  assert.ok(act.includes("...(visualNow !== sceneVisual ? { visual: visualNow } : {})"));
  const parse = ui.slice(ui.indexOf("function parseSceneWho"), ui.indexOf("function parseSceneWho") + 900);
  assert.ok(parse.includes(".slice(0, 6)") && parse.includes(".slice(0, 40)"), "a short list of short names, whatever was sent");
  // the card takes the new words when the picture lands
  assert.ok(ui.includes("const nv = typeof rd.visual === \"string\" && rd.visual.trim() ? rd.visual.trim().slice(0, 400) : null;"));
  assert.ok(ui.includes("treatment: nv ? { ...prev.treatment, scenes: prev.treatment.scenes.map((s, j) => (j === idx ? { ...s, visual: nv } : s)) } : prev.treatment,"));
});
