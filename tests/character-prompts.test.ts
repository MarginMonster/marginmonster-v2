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
import { CHAR_DESC_MAX, charKindOf, characterContinuity, characterPreviewPrompt } from "../app/lib/character-prompts.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

test("a free preview is drawn on the everyday image model, so a free button cannot cost more than the character earns", () => {
  // 20 tokens (~87¢) has to cover the 3D view (~53¢) AND every preview its maker looked at. On the
  // premium model a preview is 15¢ — three of them and the character is sold at a loss; on the everyday
  // one it is 4¢, and all eight of a day's previews still fit. The premium model is only the fallback.
  const src = fs.readFileSync(path.join(root, "app", "lib", "character-preview.server.ts"), "utf8").replace(/\r\n/g, "\n");
  const make = src.slice(src.indexOf("export async function makeCharacterPreview"));
  const cheap = make.indexOf('repRun("google/nano-banana"');
  const premium = make.indexOf("brandStill(");
  assert.ok(cheap > 0, "the preview goes to the everyday image model first");
  assert.ok(premium > cheap, "the premium model is the fallback, not the first call");
  assert.match(make.slice(cheap, premium), /catch/, "…and only when the first one fails");
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
