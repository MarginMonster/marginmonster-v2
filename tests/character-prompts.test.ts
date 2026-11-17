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
  assert.match(p, /silhouette, build, bulk and posture/);
  assert.match(p, /do not dress it/i);
  assert.match(p, /no human face, no human hands/);
  assert.match(p, /arms too long, black eyes and mouth with unhinged jaw\./, "the maker's own words ride along");
  assert.match(p, /whole figure is in frame from head to feet/);
  for (const banned of [/presenter/i, /outfit/i, /wears/i, /half-body/i, /waist up/i]) assert.doesNotMatch(p, banned, `a creature prompt must not say ${banned}`);
});

test("a creature can be made from words alone", () => {
  const p = characterPreviewPrompt("monster", "a swamp thing with antlers", false);
  assert.doesNotMatch(p, /reference/i, "there is no reference to speak of");
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

test("a character is charged only after its maker has seen it", () => {
  // The Studio's action: registering needs the preview's file name, and the price follows the kind.
  const studio = fs.readFileSync(path.join(root, "app", "routes", "web.studio.tsx"), "utf8").replace(/\r\n/g, "\n");
  const forge = studio.slice(studio.indexOf('if (intent === "forgeAvatar")'), studio.indexOf("// Managing your OWN presenters"));
  assert.ok(forge.length > 500, "the forge action was not found");
  const needsPreview = forge.indexOf('form.get("previewFile")');
  const spends = forge.indexOf("spendTokens(");
  assert.ok(needsPreview > 0 && spends > needsPreview, "the approved preview is checked before any tokens are spent");
  assert.match(forge, /ownsUpload\(shop\.id, fileName\)/, "the preview's name comes from the browser — it is checked, not trusted");
  assert.match(forge, /kind === "person" \? TOKEN_COST\.avatarForge : TOKEN_COST\.characterForge/);
  assert.doesNotMatch(forge, /form\.get\("avatarPhoto"\)/, "no path left that charges straight from an upload");
  // and the preview step itself never touches the wallet
  const preview = studio.slice(studio.indexOf('if (intent === "previewCharacter")'), studio.indexOf('if (intent === "forgeAvatar")'));
  assert.ok(preview.length > 500, "the preview action was not found");
  assert.doesNotMatch(preview, /spendTokens|enqueueJob/);
  assert.match(preview, /previewsLeft\(shop\.id\) <= 0/, "free previews are counted");
  assert.match(preview, /screenCreatePrompt/, "what the maker typed is screened before it is drawn");
});
