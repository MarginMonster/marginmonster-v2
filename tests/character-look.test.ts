/* A character's first picture, looked at: the writer's brief before it is drawn, the reader's check after, the one
 * more go, an EDIT that keeps the face — and which picture model draws which look.
 *
 * The owner, 2026-11-24: a Creature described as "Demonic woman human body with a mouth too large to be human blue
 * eyes blonde hair off putting unsettling hyper realistic" came back a grey alien; his own picture of a woman, as a
 * Creature with no words, came back "a hairy, horned, clawed monster body with a woman's grinning face"; and
 * "I tried to edit her hair to blonde and it changed her face". */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHARACTER_BRIEF_SCHEMA, STRONG_LADDER, characterBriefAsk, characterCheckAsk, characterEditCheckAsk, characterEditFix,
  characterFaults, characterFix, editFaults, keepSecond, keepSecondEdit, previewLadder, readCharacterBrief,
  readCharacterCheck, readCharacterEditCheck,
} from "../app/lib/character-look.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HIS = "Demonic woman human body with a mouth too large to be human blue eyes blonde hair off putting unsettling hyper realistic";
const PRO = "google/nano-banana-pro", SEEDREAM = "bytedance/seedream-4.5", EVERYDAY = "google/nano-banana";

test("which model draws a first look: everyday-priced, unless only the strongest can be trusted with the words", () => {
  // words alone → Seedream (it drew every test case; nano-banana refused his), then nano-banana
  assert.deepEqual(previewLadder({ kind: "cartoon", desc: "a friendly orange tabby cat mascot in a chef's hat", hasRef: false, brief: true }), [SEEDREAM, EVERYDAY]);
  assert.deepEqual(previewLadder({ kind: "monster", desc: "a werewolf in a torn red plaid shirt", hasRef: false, brief: false }), [SEEDREAM, EVERYDAY]);
  assert.deepEqual(previewLadder({ kind: "person", desc: "an old fisherman with a white beard", hasRef: false, brief: false }), [SEEDREAM, EVERYDAY]);
  // a picture is the truth → nano-banana first (Seedream re-imagined a picture: corpse make-up and blood)
  assert.deepEqual(previewLadder({ kind: "monster", desc: "", hasRef: true, brief: false }), [EVERYDAY, SEEDREAM]);
  // his words: with the writer's brief, Seedream drew her right — without it, a vampire four times in four
  assert.deepEqual(previewLadder({ kind: "monster", desc: HIS, hasRef: false, brief: true }), [SEEDREAM, EVERYDAY]);
  assert.deepEqual(previewLadder({ kind: "monster", desc: HIS, hasRef: false, brief: false }), [PRO, SEEDREAM, EVERYDAY]);
  assert.deepEqual(previewLadder({ kind: "person", desc: HIS, hasRef: false, brief: false }), [PRO, SEEDREAM, EVERYDAY]);
  // the one more go and every edit: the strongest first
  assert.deepEqual([...STRONG_LADDER], [PRO, EVERYDAY, SEEDREAM]);
});

test("the writer is asked for every attribute in English, and the picture in plain visual terms", () => {
  const ask = characterBriefAsk("monster", `  ${HIS}\n`, false);
  assert.ok(ask.includes(`«${HIS}»`), "the maker's words, verbatim and tidied");
  assert.match(ask, /a creature, for horror/);
  assert.match(ask, /give, in English:/);
  assert.match(ask, /EVERY separate thing their words state/);
  assert.match(ask, /Never an item they did not state/);
  assert.match(ask, /say what a strange feature LOOKS like/);
  assert.match(ask, /never as horns, pointed ears, fangs, claws/);
  assert.match(ask, /a real, ordinary human being apart from exactly the wrongness they name/);
  assert.doesNotMatch(ask, /a mouth too large to be human" →/, "its example is not his own case");
  assert.match(characterBriefAsk("person", "x y z", true), /they added a picture of it/);
  assert.deepEqual((CHARACTER_BRIEF_SCHEMA as { required: string[] }).required, ["attributes", "picture"]);
});

test("the writer's brief is read, tidied — and turned away when it grows a monster's part on a human", () => {
  const good = readCharacterBrief(JSON.stringify({
    attributes: ["a woman", " an ordinary  human body ", "a woman", "a mouth too large to be human", ""],
    picture: "A real adult woman, blonde, with pale blue eyes; her grin runs almost from ear to ear.",
  }), "monster", HIS);
  assert.deepEqual(good?.attributes, ["a woman", "an ordinary human body", "a mouth too large to be human"], "trimmed, de-duplicated, blanks dropped");
  assert.match(good?.picture || "", /ear to ear/);
  // a human being the maker did not give fangs or pointed ears is not given them by the writer
  for (const grown of ["She has long fangs and a wide mouth.", "A woman with pointed ears and a wide grin.", "A woman with glowing eyes and a wide grin, claws for nails."]) {
    assert.equal(readCharacterBrief(JSON.stringify({ attributes: ["a woman"], picture: grown }), "monster", HIS), null, grown);
    assert.equal(readCharacterBrief(JSON.stringify({ attributes: ["a woman"], picture: grown }), "person", HIS), null, `${grown} (as a person)`);
  }
  // …but what the maker named is theirs, and a beast keeps its claws
  assert.ok(readCharacterBrief(JSON.stringify({ attributes: ["a woman", "fangs"], picture: "A pale woman whose grin shows two long fangs, too wide for her face." }), "monster", "a pale woman with fangs and a grin too wide"));
  assert.ok(readCharacterBrief(JSON.stringify({ attributes: ["a werewolf"], picture: "A werewolf with grey fur, yellow eyes and long claws, in a torn red plaid shirt." }), "monster", "a werewolf in a torn red plaid shirt"));
  // what cannot be read, or says too little, is not a brief
  for (const bad of ["", "no json here", "{}", JSON.stringify({ attributes: [], picture: "A long enough picture of a woman." }), JSON.stringify({ attributes: ["a woman"], picture: "short" })]) {
    assert.equal(readCharacterBrief(bad, "monster", HIS), null, bad);
  }
});

test("the reader is asked about every stated thing — strictly about what the character IS — and what was ADDED", () => {
  const listed = characterCheckAsk("monster", HIS, ["a woman", "an ordinary human body", "a mouth too large to be human"]);
  assert.match(listed, /\(1\) a woman \(2\) an ordinary human body \(3\) a mouth too large to be human/);
  assert.match(listed, /These, in this order, are "stated"/);
  assert.match(listed, /false for a monster or an alien that only has a woman's hair/);
  assert.match(listed, /what the picture ADDS that their words never asked for/);
  assert.match(listed, /Never list what their words leave open/);
  assert.match(listed, /\{"stated": \["…"\], "shown": \[true or false for each, in order\], "added": \["…", or none\]\}/);
  // with no writer's list, the reader makes its own from the words
  assert.match(characterCheckAsk("cartoon", "a fox cub in a green scarf"), /First list EVERY separate thing their words state/);
});

test("the reader's answer: what was missed and what was added — and an answer that cannot be read keeps the picture", () => {
  const c = readCharacterCheck(`Here you go: {"stated": ["a woman", "an ordinary human body", "a mouth too large to be human", "blue eyes"], "shown": [true, true, false, true], "added": ["pointed elf ears", "vampire fangs", "none"]} Wait, let me re-check {"stated": []}`);
  assert.deepEqual(c?.missing, ["a mouth too large to be human"]);
  assert.deepEqual(c?.added, ["pointed elf ears", "vampire fangs"], "'none' is not something added");
  assert.equal(characterFaults(c), 3);
  assert.equal(characterFix(c), " The last try missed what the maker asked for — this time each of these is plain to see: a mouth too large to be human. The last try added what the maker never asked for — leave it out: pointed elf ears; vampire fangs.");
  const clean = readCharacterCheck(JSON.stringify({ stated: ["a werewolf", "a torn red plaid shirt"], shown: [true, true], added: [] }));
  assert.equal(characterFaults(clean), 0);
  assert.equal(characterFix(clean), "");
  for (const bad of ["", "the picture looks right", JSON.stringify({ stated: ["a"], shown: ["yes"] }), JSON.stringify({ stated: ["a", "b"], shown: [true] }), JSON.stringify({ stated: [], shown: [] })]) {
    assert.equal(readCharacterCheck(bad), null, bad);
  }
  assert.equal(characterFaults(null), 0, "no reading, no faults: the picture is kept");
});

test("after the one more go, the second picture is shown unless the reader found it WORSE", () => {
  const one = readCharacterCheck(JSON.stringify({ stated: ["a", "b"], shown: [false, true], added: ["fangs"] }));
  const better = readCharacterCheck(JSON.stringify({ stated: ["a", "b"], shown: [true, true], added: [] }));
  const same = readCharacterCheck(JSON.stringify({ stated: ["a", "b"], shown: [true, false], added: ["ears"] }));
  const worse = readCharacterCheck(JSON.stringify({ stated: ["a", "b"], shown: [false, false], added: ["fangs", "ears"] }));
  assert.equal(keepSecond(one, better), true);
  assert.equal(keepSecond(one, same), true, "as many faults: the one drawn to put things right");
  assert.equal(keepSecond(one, worse), false);
  assert.equal(keepSecond(one, null), true, "a second the reader could not read was still drawn to put things right");
});

test("AN EDIT is looked at beside the look it came from: the same individual, the change made, nothing else changed", () => {
  const ask = characterEditCheckAsk("person", "", "blonde hair");
  assert.match(ask, /^The FIRST image is an edit of the SECOND/);
  assert.doesNotMatch(ask, /drawn from their words/, "a look from a picture alone had no words");
  assert.match(ask, /They changed the words to «blonde hair»/);
  assert.match(ask, /"same": is the first image the SAME individual as the second/);
  assert.match(ask, /a different face does/);
  assert.match(characterEditCheckAsk("monster", HIS, HIS.replace("blonde", "red")), /drawn from their words «Demonic woman/);

  const curls = readCharacterEditCheck(JSON.stringify({ same: true, missing: [], unasked: ["the hair went from loose waves to tight curls"] }));
  assert.equal(editFaults(curls), 1);
  assert.match(characterEditFix(curls), /keep these exactly as in the reference: the hair went from loose waves to tight curls/);
  const someoneElse = readCharacterEditCheck(JSON.stringify({ same: false, missing: ["blonde hair"], unasked: ["none"] }));
  assert.equal(editFaults(someoneElse), 4, "another face counts the most");
  assert.match(characterEditFix(someoneElse), /^ The last try turned them into someone else — this time they are the EXACT same individual as in the reference image, with the very same face\. And it did not make the change that was asked for — this time make it plain: blonde hair\.$/);
  assert.equal(readCharacterEditCheck(JSON.stringify({ missing: [] })), null, "no verdict on the face, no reading");
  assert.equal(keepSecondEdit(someoneElse, curls), true);
  assert.equal(keepSecondEdit(curls, someoneElse), false);
  assert.equal(keepSecondEdit(curls, null), true);
});

test("the dialog: 'Edit description' edits the look on screen, keeps it in view, and can start fresh", () => {
  const cf = fs.readFileSync(path.join(root, "app", "components", "CharacterForge.tsx"), "utf8").replace(/\r\n/g, "\n");
  assert.ok(cf.includes("onClick={() => { setEditing({ file: preview.file, refFile: preview.refFile }); setPreview(null); }}><Ico n=\"pencil\" size={13} /> {t(\"Edit description\")}"), "the look being edited is kept");
  assert.ok(cf.includes("if (base) fd.set(\"editOf\", base);"), "…and sent as the one to edit");
  assert.ok(cf.includes("editing ? askPreview(editing.refFile, editing.file) : askPreview()"));
  assert.ok(cf.includes("setKind(k); setPreview(null); setEditing(null);"), "another kind is another drawing, not an edit");
  assert.ok(cf.includes("{t(\"Editing this look — only what you change in the words will change\")}") && cf.includes("{t(\"Start fresh\")}"));
  assert.ok(cf.includes("onClick={() => setEditing(null)}>{t(\"Start fresh\")}"));
  // the two new lines are translated for every language the dialog speaks
  const dict = fs.readFileSync(path.join(root, "app", "lib", "ui-i18n-dict.ts"), "utf8");
  for (const s of ["Editing this look — only what you change in the words will change", "Start fresh"]) assert.equal(dict.split(`${JSON.stringify(s)}:`).length - 1, 5, s);
});

test("the server: two looks that fail open, ONE more go at most, an edit drawn FROM the look — still one free look", () => {
  const src = fs.readFileSync(path.join(root, "app", "lib", "character-preview.server.ts"), "utf8").replace(/\r\n/g, "\n");
  // the switch, and the waits a maker can be held to
  assert.ok(src.includes('(process.env.CHARACTER_LOOK || "").trim().toLowerCase() !== "off"'), "CHARACTER_LOOK=off turns both looks off");
  assert.match(src, /const BRIEF_MS = 15_000;/);
  assert.match(src, /const CHECK_MS = 25_000;/);
  // every Anthropic step is inside a try that answers null — a look that cannot be had never costs a preview
  for (const fn of ["async function briefFor", "async function checkPreview", "async function checkEdit"]) {
    const body = src.slice(src.indexOf(fn), src.indexOf("\n}\n", src.indexOf(fn)));
    assert.match(body, /try \{[\s\S]*\} catch \(e\) \{[\s\S]*return null;/, `${fn} fails open`);
    assert.match(body, /within\(ask, (BRIEF_MS|CHECK_MS)\)/, `${fn} waits only so long`);
  }
  // an edit is drawn from the look the maker saw, on the strongest model, and checked beside it
  const edit = src.slice(src.indexOf("async function editPreview"), src.indexOf("\n}\n", src.indexOf("async function editPreview")));
  assert.match(edit, /const refUrl = `\$\{base\}\/uploads\/\$\{o\.edit\.file\}`;/);
  assert.match(edit, /characterEditPrompt\(o\.kind, o\.edit\.desc, o\.desc\)/);
  assert.equal(edit.split("drawPreview(").length - 1, 2, "an edit and, at most, one more go");
  assert.ok(edit.split("STRONG_LADDER").length - 1 >= 2);
  // and the route still takes ONE of the day's looks per request, edit or not
  const route = fs.readFileSync(path.join(root, "app", "routes", "api.character.tsx"), "utf8").replace(/\r\n/g, "\n");
  const preview = route.slice(route.indexOf('if (intent === "preview")'), route.indexOf('if (intent === "adopt")'));
  assert.equal(preview.split("pv.reservePreview(shop.id)").length - 1, 1);
  assert.match(preview, /const editRec = editOf \? pv\.previewRecord\(shop\.id, editOf\) : null;/, "only one of this shop's own previews is edited");
  assert.match(preview, /editRec && editRec\.kind === kind/, "…of the kind being drawn");
  assert.ok(preview.indexOf("const editOf") < preview.indexOf("pv.reservePreview(shop.id)"), "the edit is settled before the look is taken");
});
