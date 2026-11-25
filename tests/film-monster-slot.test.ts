/* THE MONSTER IS CAST (2026-11-25) — the page half of "Monster should be castable also".
 *
 * The eighth render of the lake idea ("Two friends camping by a quiet lake wake at 3am to someone softly calling
 * their names from the water… a woman is standing waist-deep in the lake, perfectly still, smiling") was right
 * until its last shot, where the reveal drew a different creature. The owner: "It looked really good till that
 * last scene bro" — then "Monster should be castable also". The engine (tests/acted-sighting.test.ts) gives a
 * film ONE picture of its thing: the cast entry with `role: "threat"`, or a portrait of the script's own threat.
 * This is the page's half, in the Movie Maker's Cast step:
 *   - a Horror film (acted and told — no other format has a monster) has a row "The monster" under the stars:
 *     "We invent it" (the default) or one of the cast's monsters, one at most, a second tap un-picks;
 *   - monsters are not stars in Horror: the two places are for the two who talk;
 *   - the monster rides in the same cast JSON as the stars, as the one entry with `role: "threat"`;
 *   - once an acted Horror film has a script, the row shows the film's thing: the monster picked, or the threat
 *     the writer wrote, with ONE button, "See it · free", that draws it now with the engine's own recipe
 *     (acted-staging.ts → threatPortrait) through ONE new free intent; the drawn picture is then sent as the
 *     `role: "threat"` entry, so the engine never draws it again;
 *   - the Cast card says it after the stars: "… and the Drowned Bride" / "… and a monster we invent".
 *
 * The page cannot run here (no local database, and the writer's key has no credit): the three pure helpers and
 * the action's cast parsing are RUN below, compiled from the route's own source; the wiring is pinned; and the
 * markup was photographed in a TEST harness compiled from the route's own Cast card and panel JSX. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { storyThreat, threatFromWords, threatPortrait } from "../app/lib/acted-staging.ts";
import { castEntry } from "../app/lib/story-picture.ts";
import { nameTok } from "../app/lib/character-prompts.ts";
import { castRoleOf, castThreat } from "../app/lib/dialogue-cast.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const ui = read("app", "routes", "web.film.tsx");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const between = (s: string, from: string, to: string) => {
  const a = s.indexOf(from);
  assert.ok(a >= 0, `missing: ${from}`);
  const b = s.indexOf(to, a + from.length);
  assert.ok(b > a, `missing after ${from}: ${to}`);
  return s.slice(a, b);
};
const ts = createRequire(import.meta.url)("typescript");
/** Compile a slice of the route as it stands and hand back what it defines — with the route's own imports given in. */
const compile = <T,>(src: string, names: string[], deps: Record<string, unknown>): T => {
  const js: string = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(deps), `${js}\nreturn { ${names.join(", ")} };`)(...Object.values(deps)) as T;
};

// THE CAST STEP: its card, its panel, its state; the story form; the action
const card = between(ui, "            {/* 1 · Cast — the ONE place a film is cast.", "            {/* (How it's told is not a step any more");
const panel = between(ui, '            {storyCard === "cast" && (', '            {storyCard === "length" && (');
const picker = between(panel, "{(!scripted || castOver) && (<>", "                </>)}\n              </div>");
const after = between(panel, "{scripted && (<>", "{(!scripted || castOver) && (<>");
const state = between(ui, "  // THE MONSTER (2026-11-25 — \"Monster should be castable also\")", "  // THE NARRATOR");
// (the story's form, by the signature it keeps at submit — main's form now also refuses an empty idea first)
const form = between(ui, "sigAtSubmit.current = storySig; }}>", "</Form>");

/* THE THREE HELPERS, RUN — the route's own functions, compiled as they stand. */
type Thing = { name: string; img: string | null; look: string; picked: boolean; see: boolean } | null;
const helpers = compile<{
  scriptThing: (tr: unknown, picked?: string | null, idea?: string | null, names?: string[]) => { entry: string; name: string; look: string } | null;
  filmThing: (o: unknown) => Thing;
  thingCastEntry: (t: Thing) => Record<string, unknown> | null;
}>(between(ui, "function scriptThing(", "\n\n// Backdrop presets"), ["scriptThing", "filmThing", "thingCastEntry"], { storyThreat, threatFromWords, castEntry, nameTok });

// the lake film's own shape, with made-up people
const LAKE = {
  cast: [
    "Mara, TEST — thirties, a fleece over a flannel shirt, short dark hair",
    "Jonah, TEST — thirties, a beanie and a down vest",
    "the woman in the lake, a pale woman in a soaked white nightgown, long black hair over her face, her smile far too wide",
  ],
  scenes: [
    { visual: "Inside the tent at 3am, the two of them wake.", caption: "Mara: Did you hear that? Someone said my name." },
    { visual: "Jonah unzips the flap and shines the flashlight at the water.", caption: "Jonah: There's someone standing in the lake." },
    { visual: "The woman in the lake stands close behind them in the dark.", caption: "" },
  ],
};

test("RUN: which of a script's cast lines is the film's thing — found the way the film finds it", () => {
  const found = helpers.scriptThing(LAKE);
  assert.ok(found);
  assert.equal(found.entry, LAKE.cast[2]);
  assert.equal(found.name, "the woman in the lake");
  assert.equal(found.look, "a pale woman in a soaked white nightgown, long black hair over her face, her smile far too wide");
  // …exactly the one the engine draws (acted-staging.ts → storyThreat, with the two who talk)
  assert.equal(storyThreat({ cast: LAKE.cast, speakers: ["Mara", "Jonah"], last: LAKE.scenes[2].visual })?.entry, found.entry);
  // a script that gives its thing NO cast line (the ninth lake film): the first figure its words put in view — exactly
  // the one the engine falls back to (acted-staging.ts → threatFromWords), so the row can show it and draw it
  const noLine = { cast: LAKE.cast.slice(0, 2), scenes: LAKE.scenes };
  const fromWords = helpers.scriptThing(noLine, null, "TEST: two friends by a lake hear their names from the water", ["Mara", "Jonah"]);
  const engine = threatFromWords({ visuals: LAKE.scenes.map((s) => s.visual), said: LAKE.scenes.map((s) => s.caption), idea: "TEST: two friends by a lake hear their names from the water", speakers: ["Mara", "Jonah"], cast: noLine.cast, names: ["Mara", "Jonah"] });
  assert.ok(fromWords && engine);
  assert.equal(fromWords.entry, engine.entry);
  assert.equal(fromWords.name, "the woman in the lake");
  assert.ok(!noLine.cast.includes(fromWords.entry), "never a line of the script's: no talking row is taken away");
  // …and the maker's idea when no scene shows anyone
  const quiet = { cast: LAKE.cast.slice(0, 2), scenes: [{ visual: "Inside the tent at 3am, the two of them wake.", caption: "Mara: Did you hear that?" }, { visual: "Jonah unzips the flap.", caption: "Jonah: Nothing out there." }] };
  assert.equal(helpers.scriptThing(quiet, null, "TEST: a pale woman stands waist-deep in the lake, smiling", ["Mara", "Jonah"])?.name, "the woman in the lake");
  // a script and an idea with no figure anywhere: nothing — the row says "A monster we invent"
  assert.equal(helpers.scriptThing(quiet, null, "TEST: two friends camp by a lake", ["Mara", "Jonah"]), null);
  assert.equal(helpers.scriptThing({ cast: [], scenes: [] }), null);
  assert.equal(helpers.scriptThing(null), null);
  // one who TALKS is never the thing, even with a figure word in their name
  const talks = { cast: ["Mara, TEST", "the old man, TEST — a neighbour"], scenes: [{ visual: "x", caption: "Mara: Hello?" }, { visual: "y", caption: "the old man: Go home." }] };
  assert.equal(helpers.scriptThing(talks), null);
  // A PICKED monster: its own line, if the writer gave it one (so it is not a talking row) — never if it talks
  const howl = { cast: ["Mara, TEST", "Jonah, TEST", "Howl, TEST — a huge werewolf"], scenes: LAKE.scenes };
  assert.equal(helpers.scriptThing(howl, "Howl")?.entry, "Howl, TEST — a huge werewolf");
  assert.equal(helpers.scriptThing(LAKE, "Howl"), null, "no line of its own: nothing to keep out of the rows");
  assert.equal(helpers.scriptThing({ ...howl, scenes: [...howl.scenes, { visual: "z", caption: "Howl: Grr." }] }, "Howl"), null);
});

test("RUN: what the film's thing IS — the monster picked, else the script's threat (and its drawn face, by name), else ours to invent", () => {
  const script = { name: "the woman in the lake", look: "a pale woman in a soaked white nightgown" };
  // not Horror: no thing at all (no row, no card line, nothing sent)
  assert.equal(helpers.filmThing({ on: false, picked: { name: "Test Wolf", img: "/avatars/howl_0.jpg" }, script }), null);
  // a picked monster wins, as picked
  assert.deepEqual(helpers.filmThing({ on: true, picked: { name: "Test Wolf", img: "/avatars/howl_0.jpg", look: " a TEST werewolf " }, script }), { name: "Test Wolf", img: "/avatars/howl_0.jpg", look: "a TEST werewolf", picked: true, see: false });
  // the script's threat: named, no face yet, and the row offers to draw it
  assert.deepEqual(helpers.filmThing({ on: true, picked: null, script, face: null }), { name: "the woman in the lake", img: null, look: script.look, picked: false, see: true });
  // its drawn portrait is its face — kept by NAME (a rewrite with the same threat keeps it; another threat does not get it)
  assert.equal(helpers.filmThing({ on: true, script, face: { name: "The Woman in the Lake ", url: "/renders/test-lake.jpg" } })?.img, "/renders/test-lake.jpg");
  assert.equal(helpers.filmThing({ on: true, script: { name: "the pale man", look: "" }, face: { name: "the woman in the lake", url: "/renders/test-lake.jpg" } })?.img, null);
  // nothing known yet: "a monster we invent"
  assert.deepEqual(helpers.filmThing({ on: true }), { name: "", img: null, look: "", picked: false, see: false });
});

test("RUN: as the film is sent — ONE `role: \"threat\"` entry, only with a picture, never with a voice", () => {
  // no picture, no entry (the engine then draws the script's own threat itself, as it does)
  assert.equal(helpers.thingCastEntry(null), null);
  assert.equal(helpers.thingCastEntry({ name: "the woman in the lake", img: null, look: "x", picked: false, see: true }), null);
  assert.equal(helpers.thingCastEntry({ name: "", img: null, look: "", picked: false, see: false }), null);
  // a picked monster says what it is
  const wolf = helpers.thingCastEntry({ name: "Test Wolf", img: "/avatars/howl_0.jpg", look: "a TEST werewolf", picked: true, see: false });
  assert.deepEqual(wolf, { name: "Test Wolf", faceUrl: "/avatars/howl_0.jpg", voiceId: null, kind: "monster", look: "a TEST werewolf", role: "threat" });
  // the threat a script invented is a FIGURE — no kind, so the engine photographs it, never "a practical-effects creature"
  const lake = helpers.thingCastEntry({ name: "the woman in the lake", img: "/renders/test-lake.jpg", look: "a pale   woman\nin a soaked nightgown", picked: false, see: true });
  assert.deepEqual(lake, { name: "the woman in the lake", faceUrl: "/renders/test-lake.jpg", voiceId: null, look: "a pale woman in a soaked nightgown", role: "threat" });
  // …and that is what the engine reads as its thing (dialogue-cast.ts → castThreat)
  assert.equal(castThreat([{ name: "Mara", faceUrl: "/renders/m.jpg" }, lake as { name: string; faceUrl: string; role: string }]), lake);
});

test("the monster has its OWN row — Horror only — and monsters are not stars there", () => {
  // Horror only, acted and told: the story builder with the horror template (no other format has a monster)
  assert.equal(count(ui, 'const monsterOn = isStoryboard && template === "horror";'), 1);
  assert.ok(state.includes('const pickedMonster = monsterOn && storyMonster ? d.roster.find((r) => r.id === storyMonster && r.kind === "monster") || null : null;'));
  assert.ok(state.includes("const thing = filmThing({ on: monsterOn,"), "no thing outside Horror: no row after a script, no line on the card");
  // the stars are PEOPLE in Horror; the monster row offers the cast's monsters (stock and the member's own) and nothing else
  assert.ok(state.includes('const starRoster = monsterOn ? rosterFor(template).filter((r) => r.kind !== "monster") : rosterFor(template);'));
  assert.ok(state.includes('const monsterRoster = monsterOn ? rosterFor(template).filter((r) => r.kind === "monster") : [];'));
  assert.ok(picker.includes("{starRoster.map((r) => {") && !picker.includes("{rosterFor(template).map("));
  // the row, under the stars' strip and above the hint and the "tap again" line — in the picker of before a script
  // (and of "Start over"), never a new section
  const row = between(picker, "{monsterOn && (<>", "                </>)}");
  assert.ok(picker.indexOf("{monsterOn && (<>") > picker.indexOf('<div className="mm-artistpick">'));
  assert.ok(picker.indexOf("{monsterOn && (<>") < picker.indexOf("{peekHint}") && picker.indexOf("{peekHint}") < picker.indexOf('{wipeNote("cast:")}'));
  assert.ok(row.includes('<div className="mm-monster-h"><b>{t("The monster")}</b><small>{t("It never speaks — the story is about it.")}</small></div>'));
  assert.ok(row.includes('<div className="mm-artistpick mm-monsterpick" role="group" aria-label={t("The monster")}>'));
  // "We invent it" — the default, ticked
  assert.ok(row.includes('<button type="button" className={`fs-rface mm-autoface${!storyMonster ? " on" : ""}${wipeArm === "cast:monster:" ? " is-arm" : ""}`} aria-pressed={!storyMonster} onClick={() => orArm("cast:monster:", !!storyMonster, () => setStoryMonster(null))} title={t("We invent it")}>'));
  assert.ok(row.includes('{!storyMonster && <span className="fs-rface-chk" aria-hidden="true"><Ico n="check" size={11} /></span>}'));
  assert.ok(state.includes("const [storyMonster, setStoryMonster] = useState<string | null>(null);"), "nothing picked to begin with");
  // a monster: one tap picks, a second un-picks — through the same asking twice as the stars when a script exists
  assert.ok(row.includes("{monsterRoster.map((r) => {"));
  assert.ok(row.includes("onClick={() => orArm(`cast:monster:${r.id}`, true, () => pickMonster(r.id))}"));
  assert.ok(row.includes("{...peekOn(`monster:${r.id}`, r, on, () => orArm(`cast:monster:${r.id}`, true, () => pickMonster(r.id)))}>"));
  // (its arming keys start "cast:", so the line under the faces says what the second tap does)
  assert.ok(ui.includes('const wipeNote = (prefix: string) => (wipeArm.startsWith(prefix)'));
});

test("RUN: one monster at most — a second tap un-picks, another replaces; never in the stars' two places", () => {
  const pick = (state.match(/const pickMonster = \(id: string\) => setStoryMonster\((\(cur\) => \(cur === id \? null : id\))\);/) || [])[1];
  assert.ok(pick, "pickMonster sets ONE id");
  const updater = (id: string) => new Function("id", `return ${pick};`)(id) as (cur: string | null) => string | null;
  assert.equal(updater("test-wolf")(null), "test-wolf");
  assert.equal(updater("test-wolf")("test-wolf"), null, "a second tap un-picks");
  assert.equal(updater("test-bride")("test-wolf"), "test-bride", "another replaces it — one at most");
  // the stars' cap is untouched and counts only stars (the monster is never in storyPick)
  assert.ok(ui.includes("const toggleStoryPick = (id: string) => setStoryPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= maxPick ? p : [...p, id]));"));
  assert.ok(!/setStoryPick\([^)]*storyMonster/.test(ui));
  // a monster that comes back among the picks (a next episode, a told story opened to edit) moves to its own row
  assert.ok(state.includes("setStoryPick((p) => p.filter((id) => !isMonster(id)));\n    setStoryMonster(m);"));
  // another format — and every next episode or story opened to edit (they open through switchHero, even onto the
  // same hero) — starts the monster over exactly where it starts the stars over
  assert.ok(ui.includes('setTold(openNarrated ? "narrated" : "acted"); setStoryPick([]); setStoryMonster(null);'));
  assert.equal(count(ui, "setStoryMonster(null)"), 2, "switchHero, and \"We invent it\"");
  // and another monster is another story: the script starts over (asked first, the page's orArm)
  assert.ok(ui.includes('useEffect(() => { setTreatment(null); setSeeds(null); setFrames([]); setCast([]); }, [told, storyPick.join(","), storyMonster]);'));
});

test("RUN: the cast JSON carries `role: \"threat\"` for the monster — and only for it; told and acted alike", () => {
  const stmt = between(ui, "  const filmCastJson = ", ";\n  const toggleStoryPick");
  const run = (pickedCast: unknown[], pickedMonster: unknown) => JSON.parse(new Function("pickedCast", "pickedMonster", `${ts.transpileModule(stmt, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}\nreturn filmCastJson;`)(pickedCast, pickedMonster));
  const mara = { id: "t1", name: "Test Mara", img: "/avatars/amara_0.jpg", kind: "person", look: "a TEST woman", voiceId: "v-test-1" };
  const wolf = { id: "t2", name: "Test Wolf", img: "/avatars/howl_0.jpg", kind: "monster", look: "a TEST werewolf", voiceId: "char:test" };
  const sent = run([mara, wolf], wolf);
  assert.deepEqual(sent, [
    { name: "Test Mara", faceUrl: "/avatars/amara_0.jpg", kind: "person", look: "a TEST woman", voiceId: "v-test-1" },
    { name: "Test Wolf", faceUrl: "/avatars/howl_0.jpg", kind: "monster", look: "a TEST werewolf", voiceId: null, role: "threat" },
  ]);
  assert.equal(sent.filter((c: { role?: string }) => c.role === "threat").length, 1);
  // with no monster picked, nothing has a role — the stars go exactly as they went
  assert.deepEqual(run([mara], null), [{ name: "Test Mara", faceUrl: "/avatars/amara_0.jpg", kind: "person", look: "a TEST woman", voiceId: "v-test-1" }]);
  // the monster rides with the stars wherever the stars ride: every write and the form send `filmCast` when anyone
  // is picked — a monster alone included (pickedCast = the stars, then the monster)
  assert.ok(state.includes("const pickedCast = pickedMonster ? [...pickedStars, pickedMonster] : pickedStars;"));
  assert.ok(form.includes('{isStoryboard && pickedCast.length > 0 && <input type="hidden" name="filmCast" value={filmCastJson} />}'));
  assert.ok(ui.includes("...(!tmpl?.lipSyncSinger && pickedCast.length ? { filmCast: filmCastJson } : {})"), "the writer hears it — and writes ABOUT it");
  // the told story draws it from its own picture like any picked character (its cast list on the storyboard)
  assert.ok(ui.includes('...pickedCast.map((r) => ({ name: r.name, look: r.kind && r.kind !== "person" ? (r.look || "") : "", img: r.img })),'));
});

test("RUN: the action reads it — `parseStoryCast` and the posted `cast` keep the role (one at most) and the thing's look", () => {
  // parseStoryCast, compiled as it stands
  const { parseStoryCast } = compile<{ parseStoryCast: (raw: string | null) => Array<Record<string, unknown>> }>(between(ui, "type StoryCastIn = ", "\n}\n") + "\n}\n", ["parseStoryCast"], { castRoleOf });
  const picks = parseStoryCast(JSON.stringify([
    { name: "Test Mara", faceUrl: "/avatars/amara_0.jpg", kind: "person", look: "a TEST woman", voiceId: "v-test-1" },
    { name: "Test Wolf", faceUrl: "/avatars/howl_0.jpg", kind: "monster", look: "a TEST werewolf", voiceId: null, role: "threat" },
    { name: "Test Other", faceUrl: "/avatars/ali_0.jpg", role: "hero" },
  ]));
  assert.deepEqual(picks.map((c) => c.role || ""), ["", "threat", ""], "nothing else is ever a role");
  assert.equal(picks[1].kind, "monster");
  // the posted storyboard cast, through the action's own mapping
  const block = between(ui, "          const named = c.filter((x) => x && typeof x.name === \"string\" && x.name.trim());", "          if (mapped.length) cast = mapped;");
  const map = (c: unknown[]) => new Function("c", "castRoleOf", `${ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}\nreturn mapped;`)(c, castRoleOf) as Array<Record<string, unknown>>;
  const nine = [...["A", "B", "C", "D", "E", "F", "G", "H"].map((n) => ({ name: `Test ${n}`, faceUrl: null, voiceId: "v-test-1" })),
    { name: "the woman in the lake", faceUrl: "/renders/test-lake.jpg", voiceId: null, look: "a pale woman in a soaked nightgown", role: "threat" },
    { name: "a second thing", faceUrl: "/renders/x.jpg", voiceId: null, role: "threat" }];
  const mapped = map(nine);
  // the cast's own eight, and after them its thing — a FIGURE, kept with its look; a second "threat" is dropped
  assert.equal(mapped.length, 9);
  assert.deepEqual(mapped[8], { name: "the woman in the lake", faceUrl: "/renders/test-lake.jpg", voiceId: null, look: "a pale woman in a soaked nightgown", role: "threat" });
  assert.equal(mapped.filter((c) => c.role).length, 1);
  // an old payload reads exactly as it did: eight at most, no role, a person's look not kept
  const old = map([...nine.slice(0, 8), { name: "Test I", faceUrl: null, voiceId: null, look: "a person's look" }]);
  assert.equal(old.length, 8);
  assert.ok(old.every((c) => !("role" in c) && !("look" in c)));
  assert.deepEqual(map([{ name: "Howl", faceUrl: "/avatars/howl_0.jpg", voiceId: null, kind: "monster", look: "a werewolf" }])[0], { name: "Howl", faceUrl: "/avatars/howl_0.jpg", voiceId: null, kind: "monster", look: "a werewolf" });
  // a storyboard cast sent without its thing still gets the picked monster, from the picks
  assert.ok(ui.includes('const pickedThing = storyCast.find((c) => c.role === "threat" && !!c.faceUrl);'));
  assert.ok(ui.includes('if (pickedThing && tmpl.dialogue && !narrated && approvedTreatment && !(cast || []).some((c) => c.role === "threat")) {'));
  // …and on to the job (the worker's type says so)
  assert.ok(read("app", "lib", "job-queue.server.ts").includes('cast: payload.cast as Array<{ name: string; faceUrl?: string | null; voiceId?: string | null; kind?: "person" | "cartoon" | "monster"; look?: string; role?: "threat" }> | undefined,'));
});

test("after a script: the row shows the film's thing — the monster picked, or the writer's threat with ONE button, free", () => {
  // under the people's rows, above "+ Add a character" — seen WITHOUT opening "Start over"
  assert.ok(after.indexOf("{thing && (") > after.indexOf('<div className="fs-cast">'));
  assert.ok(after.indexOf("{thing && (") < after.indexOf('<button type="button" className="fs-cast-add"'));
  const row = between(after, "{thing && (", '<button type="button" className="fs-cast-add"');
  assert.ok(row.includes('<div className={`mm-thing${thing.img ? " has-face" : ""}${thing.picked ? " is-picked" : ""}`} role="group" aria-label={t("The monster")}>'));
  // its face (keyed by picture, so a new look develops in again), its name, its look in one short line
  assert.ok(row.includes('? <img key={thing.img} className="mm-thing-img" src={thing.img} alt={thing.name} />'));
  assert.ok(row.includes('<b className="mm-thing-name">{thing.name || t("A monster we invent")}</b>'));
  assert.ok(row.includes(`<span className="mm-thing-look">{thing.picked ? t("It never speaks — the story is about it.") : thing.look || t("It is drawn from the script's own words, when it shows.")}</span>`));
  // ONE button, only for the script's own threat: "See it · free", then "Another look" — nothing else is offered
  assert.ok(row.includes('{thing.see && (\n                          <button type="button" className="mm-thing-see" disabled={threatDrawing} onClick={seeThreat}>'));
  assert.ok(row.includes('{threatDrawing ? t("Drawing it…") : thing.img ? t("Another look") : t("See it · free")}'));
  assert.equal(count(row, "<button"), 1);
  // a failure: one calm line, the row as it was (the film draws it itself when it is made)
  assert.ok(row.includes(`<span className="mm-thing-err" role="status">{t("It wouldn't draw just now — the film draws it when it's made.")}</span>`));
  // the threat is the row's — never a talking row with a voice, never one of "1/2 cast"
  assert.ok(ui.includes("const entries = (Array.isArray(tr2.cast) ? tr2.cast : []).filter((entry) => entry !== thingEntry).slice(0, 8);"));
  assert.ok(ui.includes("const thingEntry = monsterOn && !narrated ? scriptThing(tr2, pickedMonster?.name)?.entry : undefined;"));
  // (with the idea and the cast's people, as the film is given them — so a thing with no cast line is found too)
  assert.ok(state.includes("const storyThing = monsterOn && !narrated && !pickedMonster && treatment ? scriptThing(treatment, null, topic, cast.map((c) => c.name)) : null;"));
});

test("\"See it · free\": ONE new intent beside the portrait intent — free, guarded like the page's other stills, on the engine's own recipe", () => {
  // the page asks for it with the script's own line for the thing
  assert.ok(state.includes('threatFetcher.submit({ intent: "previewFilmThreat", template, threatEntry: storyThing.entry }, { method: "post" });'));
  assert.equal(count(ui, 'intent === "previewFilmThreat"'), 1);
  // beside `previewFilmPortrait`, after the plan's guard (a plan, and video in it) — like every free still
  const at = ui.indexOf('if (intent === "previewFilmThreat") {');
  assert.ok(at > ui.indexOf('if (intent === "previewFilmPortrait") {') && at < ui.indexOf('if (intent === "editFilmFrame") {'));
  assert.ok(at > ui.indexOf('if (!shop.activePlan?.active) return json({ error: tr(lang, "Pick a plan on the Dashboard first — film runs on tokens.") });'));
  assert.ok(at > ui.indexOf('if (!capabilitiesFor(shop.activePlan).has("creatorvideo")) {'));
  const intent = between(ui, 'if (intent === "previewFilmThreat") {', 'if (intent === "editFilmFrame") {');
  // FREE: nothing spent, nothing queued
  assert.ok(!/spendTokens|enqueueJob|refundTokens/.test(intent));
  // Horror only, and a line of the cast to draw (capped like the portrait's description)
  assert.ok(intent.includes('const threatEntry = ((form.get("threatEntry") as string) || "").replace(/\\s+/g, " ").trim().slice(0, 600);'));
  assert.ok(intent.includes('if (tmpl.key !== "horror" || !castEntry(threatEntry).name) return json('));
  // THE ENGINE'S OWN RECIPE — S7's threatPortrait — on the told stories' ladder, tall; no second recipe here
  assert.ok(intent.includes('const { threatPortrait } = await import("../lib/acted-staging");'));
  assert.ok(intent.includes("const prompt = threatPortrait(threatEntry, tmpl.sceneHint);"));
  assert.ok(intent.includes("for (const model of pic.STORY_LADDER) {"));
  assert.ok(intent.includes("pic.storyPictureInput(model, { prompt, refs: [], aspect: pic.PORTRAIT_ASPECT })"));
  assert.ok(!/A (clean|realistic)[^"]*portrait/.test(intent), "no portrait words of its own");
  // LOOKED AT for an unclothed figure, as the engine looks: edited once, else not used
  assert.ok(intent.includes("pic.parseUnclothed(String((await anthropicVision(pic.unclothedPrompt(), [absOf(u)], { maxTokens: 120, model: \"claude-sonnet-4-6\" })) || \"\"))"));
  assert.ok(intent.includes("pic.clothedEdit(seen.who)"));
  assert.ok(intent.includes('if ((await bare(drawn)).unclothed) drawn = "";'));
  assert.ok(intent.includes("return json({ threatUrl });"));
  // the recipe it calls is S7's: photographed, clothed, nothing glowing — and a person-like threat is a figure
  const p = threatPortrait(LAKE.cast[2], "a TEST horror scene");
  assert.ok(p.includes("this ONE figure alone") && !p.includes("practical-effects creature"));
});

test("a drawn portrait IS the film's thing: it is sent with the threat, and the engine never draws it again", () => {
  // it lands only on the very line it was drawn from (a story started over or rewritten while it drew has another one, or none)
  assert.ok(state.includes("threatAsked.current = { entry: storyThing.entry, name: storyThing.name };"));
  assert.ok(state.includes("threatNow.current = storyThing?.entry || \"\";"));
  assert.ok(state.includes("if (asked.entry !== threatNow.current) return;"));
  assert.ok(state.includes("if (threatFetcher.data?.threatUrl) setThreatFace({ name: asked.name, entry: asked.entry, url: threatFetcher.data.threatUrl });"));
  // …and it stays its face only while the script's line is the one it was drawn from: the same name in a new look
  // is drawn again, never sent with another look's words
  assert.ok(state.includes("script: storyThing, face: threatFace && storyThing && threatFace.entry === storyThing.entry ? threatFace : null });"));
  assert.ok(state.includes("else setThreatErr(asked.name);"));
  // a story started over loses it
  assert.ok(state.includes('useEffect(() => { if (!treatment) { setThreatFace(null); setThreatErr(""); } }, [treatment]);'));
  // what the film is sent: once a script is on the page, the thing (picked or drawn) after the cast's own rows
  assert.ok(state.includes("const thingPost = treatment && !narrated ? thingCastEntry(thing) : null;"));
  assert.ok(form.includes('{isStoryboard && !narrated && (cast.some((c) => c.faceUrl || c.voiceId) || !!thingPost) && <input type="hidden" name="cast" value={JSON.stringify([...cast.map((c) => ({ name: c.name, faceUrl: c.faceUrl, voiceId: c.voiceId, ...(c.faceUrl && c.kind && c.kind !== "person" ? { kind: c.kind, look: c.look || "" } : {}) })), ...(thingPost ? [thingPost] : [])])} />}'));
  // another face for the thing is another film (Generate is live again)
  const storySig = (ui.match(/\n  const storySig = [^\n]+;\n/) || [""])[0];
  assert.ok(storySig.includes("storyPick, storyMonster, thing?.img || \"\","));
});

test("THE CARD tells the truth: after the stars, \"and the Drowned Bride\" / \"and a monster we invent\" — with its little face", () => {
  const line = between(ui, "        const thingLine = thing ? (", "        ) : null;");
  assert.ok(line.includes('{thing.img && <span className="mm-cast-thingface" style={{ backgroundImage: `url(${thing.img})` }} aria-hidden="true" />}'));
  assert.ok(line.includes('{thing.name ? t("and {name}", { name: thing.name }) : t("and a monster we invent")}'));
  // after a script: right under the names; before one: after the stars (the STARS — a monster is not one of them)
  const afterCard = between(card, "{scripted ? (<>", "              </>) : (<>");
  assert.ok(afterCard.includes('<span className="mm-val mm-cast-names">{castSum.names}</span>\n                {thingLine}'));
  const beforeCard = card.slice(card.indexOf("              </>) : (<>"));
  assert.ok(beforeCard.includes("{thingLine}"));
  assert.ok(beforeCard.includes("{pickedStars.length ? <><Ico n=\"check\" size={12} /> {pickedStars.map((r) => r.name).join(\" + \")}</>"));
  assert.ok(!beforeCard.includes("pickedCast"), "the card names the stars, then the thing — never the thing twice");
  // the count and the nudge are about the people: the thing is never "uncast"
  assert.ok(ui.includes("        const castNudge = scripted && !castSeen && !castSum.all;"));
  assert.equal(count(ui, "castCardSummary(cast)"), 1);
  // RUN: what the line says, made-up names
  const say = (thing: Thing) => (thing ? (thing.name ? `and ${thing.name}` : "and a monster we invent") : "");
  assert.equal(say(helpers.filmThing({ on: true, picked: { name: "the Drowned Bride", img: "/avatars/mary_0.jpg" } })), "and the Drowned Bride");
  assert.equal(say(helpers.filmThing({ on: true })), "and a monster we invent");
  assert.equal(say(helpers.filmThing({ on: true, script: { name: "the woman in the lake", look: "" } })), "and the woman in the lake");
  assert.equal(say(helpers.filmThing({ on: false })), "", "not Horror: the card is as it was");
});

test("phone first, dark and light, a little menace — and less motion honoured", () => {
  // the picked monster's ring breathes red, once; its portrait develops out of the dark, once
  assert.ok(ui.includes(".mm-story .mm-monsterpick .fs-rface.on:not(.is-arm):not(.mm-autoface){animation:mmThingBreath 3.2s ease-in-out .15s 1;}"));
  assert.ok(ui.includes(".mm-thing-img{display:block;width:100%;height:100%;object-fit:cover;object-position:center top;animation:mmDevelop 2.8s cubic-bezier(.35,.1,.25,1) both;}"));
  assert.ok(ui.includes("@keyframes mmDevelop{0%{opacity:0;filter:brightness(0) contrast(1.6) blur(5px);}"));
  // less motion: the develop is a fade, and nothing breathes
  assert.ok(ui.includes("@media(prefers-reduced-motion:reduce){.mm-thing-img{animation:mmDevelopFade .5s ease-out both;}.mm-story .mm-monsterpick .fs-rface.on:not(.is-arm):not(.mm-autoface){animation:none;}}"));
  // (the breath rule comes after the stars' own green halo, which it replaces on the monster row)
  assert.ok(ui.indexOf(".mm-story .mm-monsterpick .fs-rface.on:not(.is-arm){") > ui.indexOf(".mm-story .mm-artistpick .fs-rface.on:not(.is-arm){"));
  // a face you can see: 98px wide on a phone, 120 on a desk; the button 44px tall, the full width on a phone
  assert.ok(ui.includes(".mm-thing{display:grid;grid-template-columns:98px minmax(0,1fr);"));
  assert.ok(ui.includes(".mm-thing-face{position:relative;display:grid;place-items:center;width:98px;aspect-ratio:3/4;"));
  assert.ok(ui.includes(".mm-thing-see{display:inline-flex;align-items:center;gap:7px;min-height:44px;"));
  assert.ok(ui.includes("@media(max-width:560px){.mm-thing{padding:10px;gap:6px 12px;}.mm-thing-see{width:100%;justify-content:center;}}"));
  // the row's strip is the stars' strip (it scrolls inside itself, never the page)
  assert.ok(ui.includes(".mm-artistpick{display:flex;gap:9px;overflow-x:auto;overflow-y:hidden;"));
  // a long name never pushes the card wider than its column
  assert.ok(ui.includes(".mm-cast-thingname{min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;}"));
});

test("every new line is translated, in all five languages", () => {
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["The monster", "We invent it", "It never speaks — the story is about it.", "A monster we invent", "It is drawn from the script's own words, when it shows.", "See it · free", "Drawing it…", "Another look", "It wouldn't draw just now — the film draws it when it's made.", "and {name}", "and a monster we invent"]) {
    assert.ok(ui.includes(`t(${JSON.stringify(k)}`) || ui.includes(`tr(lang, ${JSON.stringify(k)})`), k);
    assert.equal(count(dict, `\n  ${JSON.stringify(k)}:`), 5, k);
  }
  // the placeholder survives every translation
  for (const m of dict.matchAll(/\n {2}"and \{name\}": "([^"]*)"/g)) assert.ok(m[1].includes("{name}"), m[1]);
});
