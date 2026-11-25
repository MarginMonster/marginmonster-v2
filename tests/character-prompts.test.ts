/* Creating a character: the words that draw the first picture, and what they must never say.
 *
 * What went wrong (2026-11-17): the only way to create a character was "upload a photo → pay 60 tokens",
 * and the one prompt behind it asked for "a clean professional presenter photo… The character wears a
 * relaxed casual outfit". Given a drawing of a hulking antlered creature it returned a man in a shirt
 * with a deer skull for a head — in four outfits. These pin the fix: a creature is never dressed or
 * made more human, a cartoon stays a cartoon, and only a person is photographed as a presenter. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHAR_DESC_MAX, charKindOf, characterContinuity, characterEditPrompt, characterPreviewPrompt, creatureBody, moodWords, ordinaryParts } from "../app/lib/character-prompts.ts";
import { STORY_LAST_MODEL, STORY_MODEL, STORY_SECOND_MODEL } from "../app/lib/story-picture.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The owner's own words, 2026-11-24 — a Creature that came back a grey alien with a star-shaped maw. */
const HIS = "Demonic woman human body with a mouth too large to be human blue eyes blonde hair off putting unsettling hyper realistic";

test("a creature is redrawn as itself — never dressed, never made more human", () => {
  const p = characterPreviewPrompt("monster", "Demonic creature, with arms too long, black eyes and mouth with unhinged jaw", true);
  assert.match(p, /SAME creature/);
  // The first drafts kept the antlers and lost the beast — a hulking, hunched mass came back lean and
  // upright. Its mass and its own stance are named outright.
  assert.match(p, /the same silhouette and the same MASS/);
  assert.match(p, /never slimmer, taller or more athletic/);
  assert.match(p, /jaws and teeth wherever they are on the body/);
  assert.match(p, /do not dress it/i);
  assert.match(p, /no human face, no human hands, no human physique/);
  assert.match(p, /arms too long, black eyes and mouth with unhinged jaw\./, "the maker's own words ride along");
  assert.match(p, /whole creature is in frame from the top of its head to its feet, in its own natural stance/);
  assert.match(p, /Ignore any icons, borders, captions or interface marks around the reference/, "a reference is often a screenshot");
  for (const banned of [/presenter/i, /outfit/i, /wears/i, /half-body/i, /waist up/i]) assert.doesNotMatch(p, banned, `a creature prompt must not say ${banned}`);
});

test("a free preview is drawn on everyday-priced models first, so a free button costs what the character earns", () => {
  // 20 tokens (~87¢) has to cover the 3D view (~53¢) AND every preview its maker looked at. On the
  // premium model a preview is 15¢ — three of them and the character is sold at a loss; on an everyday-
  // priced one it is 4¢. Which model draws which look is character-look.ts → previewLadder (its own tests);
  // here: the dear fallback (fal) is still only for when every rung FAILED, never for a rate limit.
  assert.equal(STORY_SECOND_MODEL, "bytedance/seedream-4.5");
  assert.equal(STORY_LAST_MODEL, "google/nano-banana");
  assert.equal(STORY_MODEL, "google/nano-banana-pro");
  const src = fs.readFileSync(path.join(root, "app", "lib", "character-preview.server.ts"), "utf8").replace(/\r\n/g, "\n");
  const draw = src.slice(src.indexOf("async function drawPreview"), src.indexOf("/* ---- THE TWO LOOKS"));
  const loop = draw.indexOf("for (const m of ladder)");
  const premium = draw.indexOf("brandStill(");
  assert.ok(loop > 0 && premium > loop, "the premium model comes after the ladder, never first");
  assert.match(draw.slice(loop, premium), /catch[\s\S]*if \(!url\)[\s\S]*worthThePremium\(last\)/, "…and only when every rung failed, and not merely for a rate limit");
  // a FIRST look is drawn on previewLadder; the strongest model only for the one more go and for an edit
  const fresh = src.slice(src.indexOf("async function drawFresh"));
  const body = fresh.slice(0, fresh.indexOf("\n}\n"));
  assert.ok(body.includes("drawPreview(prompt, refUrl, kind, previewLadder({ kind, desc, hasRef: !!refUrl, brief: !!brief }))"), "a first look goes up the everyday ladder");
  assert.equal(body.split("drawPreview(").length - 1, 2, "a first look and, at most, ONE more go");
  assert.match(body, /drawPreview\(`\$\{prompt\}\$\{characterFix\(first\)\}`, refUrl, kind, STRONG_LADDER\)/, "…the one more go told what was missed, on the strongest model");
});

test("THE MAKER'S WORDS WIN: his Creature is a real woman with ONLY the wrongness he named", () => {
  // 2026-11-24: "Demonic woman human body with a mouth too large to be human…" came back a grey, emaciated alien
  // with a star-shaped maw for a head, spines and claws. The recipe said "a creature" first, then forbade what he
  // asked for ("no human face, no human hands, no human physique"), and quoted him last.
  const p = characterPreviewPrompt("monster", HIS, false);
  assert.ok(p.indexOf("In the maker's words: Demonic woman") < 160, "his words come first, as the subject");
  for (const contradiction of [/no human face/i, /no human physique/i, /Do NOT make it more human/i, /character design of a creature/i, /do not dress it/i]) {
    assert.doesNotMatch(p, contradiction, `nothing may contradict "woman human body": ${contradiction}`);
  }
  assert.match(p, /A photograph of a real person/);
  assert.match(p, /They are a real human being: an ordinary human body and face/);
  assert.match(p, /The ONLY things wrong with them are the ones those words name — each shown plainly and unmistakably, never toned down/);
  assert.match(p, /dressed in plain ordinary clothes unless the words name others/, "a human being is never drawn naked");
  // what the words do not mention is said as what it IS — never as a list of monster parts (Seedream drew those)
  assert.match(p, /Their ears, teeth, nails, skin and hands are an ordinary person's\./);
  assert.doesNotMatch(p, /\b(?:horns?|fangs?|pointed ears|claws?|spines?|tentacles?)\b/i, "no monster part is named to a human being, not even as a 'no'");
  // "demonic", "off putting", "unsettling" are a mood: the face and the light, never the body
  assert.match(p, /Every word of mood in that description is carried only by the expression, the stare, the stillness and the light — never by changing the body/);
  assert.match(p, /PHOTOGRAPHED, as real as a frame of a film/);
  assert.match(p, /down to the knees[^.]*the face — and anything wrong with it — is clearly seen/, "the wrongness in a face is not lost at head-to-feet size");
});

test("…the same words as a Person keep the wrongness; a werewolf stays a werewolf in its shirt", () => {
  const person = characterPreviewPrompt("person", HIS, false);
  assert.match(person, /never smoothed over, beautified or made normal/);
  assert.match(person, /Every word of mood in that description is carried only by the expression/);
  assert.match(person, /in the clothes those words give them — or, if they name none, a relaxed everyday outfit/);
  const wolf = characterPreviewPrompt("monster", "a werewolf in a torn red plaid shirt", false);
  assert.match(wolf, /In the maker's words: a werewolf in a torn red plaid shirt\./);
  assert.match(wolf, /It is a creature, not a person in a costume or a mask/);
  assert.match(wolf, /no clothes unless they are asked for/, "…and the shirt WAS asked for");
  assert.match(wolf, /in its own natural stance/);
  assert.doesNotMatch(wolf, /Every word of mood/, "no mood words, no mood line");
  const cat = characterPreviewPrompt("cartoon", "a friendly orange tabby cat mascot in a chef's hat", false);
  assert.match(cat, /no accessories beyond the ones the words name/);
  assert.ok(cat.indexOf("In the maker's words") < cat.indexOf("It is a cartoon character"), "a cartoon's words come before its rules too");
});

test("what the words make a creature's BODY", () => {
  const table: Array<[string, string]> = [
    [HIS, "uncanny"],
    ["Tall, pale woman with a smile far too wide", "uncanny"],
    ["a figure with a human body and no face", "uncanny"],
    ["a pale drowned girl", "uncanny"],
    ["a cat-like woman with slit pupils", "uncanny"],
    ["a woman with the head of a wolf", "uncanny"],
    ["a vampire with slicked-back hair", "humanlike"],
    ["a ghost bride in a torn lace dress", "humanlike"],
    ["a demon woman with red skin", "humanlike"],
    ["a woman demon", "humanlike"],
    ["a thing with a woman's face", "humanlike"],
    ["a hulking beast with a human face", "humanlike"],
    ["a werewolf in a torn red plaid shirt", "beast"],
    ["a swamp thing with antlers", "beast"],
    ["Demonic creature, with arms too long, black eyes and mouth with unhinged jaw", "beast"],
    ["a man-eating plant with teeth", "beast"],
    ["spiky and wet", "beast"],
    ["", "beast"],
  ];
  for (const [desc, want] of table) assert.equal(creatureBody(desc), want, desc);
});

test("mood words are found once each; the parts the words leave alone are named as ordinary", () => {
  assert.deepEqual(moodWords(HIS), ["demonic", "off putting", "unsettling"]);
  assert.deepEqual(moodWords("a creepy, CREEPY old doll"), ["creepy"]);
  assert.deepEqual(moodWords("an old fisherman"), []);
  assert.equal(ordinaryParts("a woman with sharp teeth and long nails"), "Their ears, eyes, skin and hands are an ordinary person's.");
  assert.equal(ordinaryParts("ears teeth eyes nails skin hands"), "");
  assert.equal(ordinaryParts("ears teeth eyes nails skin"), "Their hands are an ordinary person's.");
});

test("A PICTURE IS THE TRUTH: a Creature made from a picture with no words is that picture's own being, plus nothing", () => {
  // 2026-11-24: his picture of a grinning woman, as a Creature with no words → "a hairy, horned, clawed monster
  // body with a woman's grinning face". The beast's wording (horns, spikes, fur; never more human) was said of
  // every picture.
  const p = characterPreviewPrompt("monster", "", true);
  assert.match(p, /^Photograph EXACTLY the one in the reference image/);
  assert.match(p, /the same being, whatever it is: a person, a creature, or anything between/);
  assert.match(p, /Nothing is added and nothing is taken away: it is made neither more human nor more monstrous than the reference shows it/);
  assert.match(p, /Framed as the reference is framed/, "a face is not given an invented monster's body below it");
  for (const added of [/horns?/i, /antlers?/i, /spikes?/i, /\bfur\b/i, /claws?/i, /no human/i, /more human and do not dress/i, /whole creature is in frame/i]) {
    assert.doesNotMatch(p, added, `a picture with no words is not told ${added}`);
  }
  // …and words that do not name a beast ("blonde hair") change only what they say
  const blonde = characterPreviewPrompt("monster", "blonde hair", true);
  assert.match(blonde, /In the maker's words: blonde hair\./);
  assert.match(blonde, /Where those words ask for something the reference does not show, change only that/);
  // the 3D figure of such a character is not told "never a human face" either
  assert.doesNotMatch(characterContinuity("monster", ""), /Never human skin/);
  assert.match(characterContinuity("monster", ""), /never made more human and never more monstrous than it is in the reference/);
});

test("AN EDIT IS AN EDIT: the look already seen is changed only where the new words change it", () => {
  // 2026-11-24: "I tried to edit her hair to blonde and it changed her face."
  const p = characterEditPrompt("person", "a woman with dark brown hair and a wide grin", "a woman with blonde hair and a wide grin");
  assert.match(p, /^Edit the reference image: it is the character exactly as the maker has already seen it\./);
  assert.match(p, /It was drawn from these words: a woman with dark brown hair and a wide grin\./);
  assert.match(p, /The maker has changed the words to: a woman with blonde hair and a wide grin\./);
  assert.match(p, /Change ONLY what the new words change from the old ones — nothing else/);
  assert.match(p, /above all the same person, with the same face and every feature on it/);
  const fromPicture = characterEditPrompt("monster", "", "blonde hair");
  assert.doesNotMatch(fromPicture, /It was drawn from these words/, "a look from a picture alone had no words");
  assert.match(fromPicture, /The maker now asks for: blonde hair\./);
  assert.match(fromPicture, /the same being/);
  assert.match(characterEditPrompt("cartoon", "a fox cub", "a fox cub in a red scarf"), /the same cartoon character, in the same art style/);
});

test("a writer's brief rides AFTER the maker's words, and only as a picture — never as a list", () => {
  const brief = { picture: "A real woman whose grin stretches almost from ear to ear", attributes: ["a woman", "a mouth too large to be human"] };
  const p = characterPreviewPrompt("monster", HIS, false, brief);
  assert.ok(p.indexOf("In the maker's words:") < p.indexOf("In plain picture terms: A real woman whose grin stretches almost from ear to ear."), "the words lead, the brief follows");
  // set out as a list, Seedream drew its items as separate things (a second, giant smiling face for a body)
  assert.doesNotMatch(p, /Each of these is clearly visible/);
  assert.doesNotMatch(characterPreviewPrompt("monster", "", true, brief), /In plain picture terms/, "no words, no brief");
});

test("a creature can be made from words alone", () => {
  const p = characterPreviewPrompt("monster", "a swamp thing with antlers", false);
  assert.doesNotMatch(p, /reference/i, "there is no reference to speak of");
  assert.match(p, /in its own natural stance/);
  assert.match(p, /a swamp thing with antlers\./);
  assert.match(p, /No blood/);
});

test("a cartoon stays a cartoon: its own style from a picture, a film-quality one from words", () => {
  const fromPicture = characterPreviewPrompt("cartoon", "", true);
  assert.match(fromPicture, /in the reference's own art style/);
  assert.match(fromPicture, /Add nothing that is not there/);
  const fromWords = characterPreviewPrompt("cartoon", "a round orange fox cub with a green scarf", false);
  assert.match(fromWords, /Unless the maker asks for another style: feature-film quality 3D animation/);
  assert.match(fromWords, /not a person in a costume/);
  assert.doesNotMatch(fromWords, /photograph/i);
});

test("only a person is photographed as a presenter, waist up", () => {
  const p = characterPreviewPrompt("person", "warm smile, early 30s, short dark curls", true);
  assert.match(p, /EXACT same one/);
  assert.match(p, /waist up/);
  assert.match(characterPreviewPrompt("person", "a baker in her fifties", false), /photorealistic professional portrait photograph of one person/);
});

test("a description is bounded and tidied before it reaches the picture model", () => {
  const long = `${"very ".repeat(200)}tall`;
  const p = characterPreviewPrompt("monster", `  spiky\n\n   and   wet  `, false);
  assert.match(p, /In the maker's words: spiky and wet\./);
  assert.ok(characterPreviewPrompt("cartoon", long, false).length < 1200 + CHAR_DESC_MAX);
  assert.doesNotMatch(characterPreviewPrompt("person", "", false), /maker's words/, "nothing said, nothing quoted");
});

test("the kind that comes back from a form is one of the three", () => {
  assert.equal(charKindOf("cartoon"), "cartoon");
  assert.equal(charKindOf("monster"), "monster");
  for (const junk of ["", "person", "robot", null, undefined, 7, "MONSTER"]) assert.equal(charKindOf(junk), "person");
});

test("what must not be 'fixed' about a character rides with it; a person needs no such note", () => {
  assert.equal(characterContinuity("person", "a baker"), "");
  assert.match(characterContinuity("monster", "antlered swamp thing"), /Never human skin, human hands or a human face/);
  assert.match(characterContinuity("monster", "antlered swamp thing"), /antlered swamp thing/);
  assert.match(characterContinuity("cartoon", "fox cub"), /only the clothes and accessories it already has/);
});

test("a character is charged only after its maker has seen it — and for what they saw", () => {
  // The dialog's own route (it used to be two intents inside the Studio's action).
  const route = fs.readFileSync(path.join(root, "app", "routes", "api.character.tsx"), "utf8").split("\r\n").join("\n");
  const preview = route.slice(route.indexOf('if (intent === "preview")'), route.indexOf('if (intent === "register")'));
  const register = route.slice(route.indexOf('if (intent === "register")'));
  assert.ok(preview.length > 500 && register.length > 500, "the two steps were not found");
  const count = (hay: string, needle: string) => hay.split(needle).length - 1;

  // STEP ONE never touches the wallet, is screened, and is counted BEFORE anything is awaited — a burst
  // of parallel requests used to all pass the check and then all draw.
  assert.ok(!preview.includes("spendTokens") && !preview.includes("enqueueJob"), "a preview never touches the wallet or the queue");
  const take = preview.indexOf("pv.reservePreview(shop.id)");
  assert.ok(take > 0, "a free preview is taken from the day's allowance");
  assert.ok(take < preview.indexOf("screenCreatePrompt") && take < preview.indexOf("makeCharacterPreview"), "…before the screen and the draw are awaited");
  assert.ok(preview.includes("screenCreatePrompt(desc)"), "what the maker typed is screened before it is drawn");
  assert.ok(count(preview, "giveBack()") >= 2, "a preview that draws nothing is given back (refused by the screen, or failed)");
  assert.ok(preview.includes("pv.sniffImage(upload)"), "an upload is an image because its bytes say so");

  // STEP TWO: the preview is CLAIMED (so it cannot be registered twice) before any tokens are spent,
  // and what it costs follows the kind it was DRAWN as — never a field the browser sends.
  const claim = register.indexOf("pv.claimPreview(shop.id, fileName)");
  const spend = register.indexOf("spendTokens(");
  assert.ok(claim > 0 && spend > claim, "the approved preview is claimed before any tokens are spent");
  assert.ok(register.includes("const kind = rec.kind;"), "the kind comes from the record made when the preview was drawn");
  assert.ok(register.includes('kind === "person" ? TOKEN_COST.avatarForge : TOKEN_COST.characterForge'), "the price follows the kind");
  for (const field of ['form.get("charKind")', 'form.get("avatarDesc")', 'form.get("avatarPhoto")']) assert.ok(!register.includes(field), `registration must not read ${field}`);
  // after the spend, every way out either made the character or gave the tokens back
  const after = register.slice(spend);
  assert.ok(after.includes("refundTokens(shop.id, forgeCost, fromExtra)"), "a failure after the spend refunds");
  assert.ok(after.includes("pv.unclaimPreview(shop.id, fileName, rec)"), "a registration that fails leaves the preview registrable again");
  assert.ok(after.includes("pv.settlePreviews(shop.id, rec)"), "the pictures that were not chosen are cleaned up");

  // both steps are gated on a plan that can create characters
  const gates = route.slice(route.indexOf("export async function action"), route.indexOf('if (intent === "preview")'));
  assert.ok(gates.includes("shop.activePlan?.active"), "an active plan is required");
  assert.ok(gates.includes('capabilitiesFor(shop.activePlan).has("video")'), "…one that can make videos");

  // …and the Studio no longer carries its own copy of either step
  const studio = fs.readFileSync(path.join(root, "app", "routes", "web.studio.tsx"), "utf8");
  assert.ok(!studio.includes('intent === "forgeAvatar"') && !studio.includes('intent === "previewCharacter"'), "the Studio still has its own copy");
});
