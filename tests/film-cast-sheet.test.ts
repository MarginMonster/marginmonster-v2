/* A FILM'S INVENTED CAST LOOKS THE SAME IN EVERY SCENE — the cast sheet has to show the CAST.
 *
 * A Kids Music Video made as a customer (2026-11-22): the script's three ducks were a white duck and two
 * ducklings in one scene, three yellow chicks in the next, and a duckling, a PINK CAT and a duck in glasses
 * in the last. Reproduced on the real picture model: the cast sheet's prompt put the style first and the
 * cast last, and the picture call cut it at 500 characters — the kids format's style text alone is over
 * 200 — so the model never read the cast and drew one of its own (a bear, a sun, a caterpillar, an
 * elephant). With a sheet that really shows the cast, scenes drawn from it held all three characters.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCENE_PROMPT_MAX, SHEET_LEAD, SHEET_PROMPT_MAX, castSheetPrompt, sceneFromSheetPrompt, sceneInWordsPrompt } from "../app/lib/film-cast-sheet.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

// the real ones, from the film that went wrong
const SAFE = "Wholesome, child-safe, G-rated, bright and friendly. ";
const STYLE = "bright glossy 3D-animated cartoon, rounded friendly character designs, big expressive eyes, soft candy colors, simple cheerful backgrounds, wholesome child-safe (G-rated), like a modern preschool sing-along cartoon";
const CAST = [
  "Pip, a cheerful 5-year-old boy duckling with round yellow fluffy body, a tiny orange beak, big sparkly brown eyes and a little blue rain hat",
  "Dot, a giggly little girl duckling with soft yellow feathers, a pink polka-dot bow between her eyes, big round hazel eyes and tiny red rain boots",
  "Nana Quacks, a gentle mama duck with cream and yellow feathers, a floral apron, kind oval glasses and a warm orange beak",
];
const VISUAL = "Pip the duckling jumps mid-air with a joyful splash into the first puddle, droplets shaped like cute little hearts and stars flying up, Dot claps her wings nearby bouncing with excitement, Nana Quacks smiles warmly watching from behind, soft candy-colored background with round fluffy clouds.";

test("the sheet's prompt names the whole cast BEFORE the style — and all of it survives the cut", () => {
  const p = castSheetPrompt({ safe: SAFE, cast: CAST, style: STYLE });
  for (const c of CAST) assert.ok(p.includes(c), `the whole of: ${c.slice(0, 30)}…`);
  assert.ok(p.indexOf(CAST[2]) < p.indexOf(STYLE), "who, then how it is drawn");
  assert.ok(p.includes(STYLE), "the style is all there too");
  assert.ok(p.length <= SHEET_PROMPT_MAX);
  assert.ok(p.includes("exactly these and nobody else") && p.endsWith("No text."));
  // the old shape, cut where the picture call cut it, had none of the cast in it
  const old = `${SAFE}${STYLE}. A group portrait of the recurring cast standing together — full body, clear consistent faces, plain neutral background, IN THE EXACT SAME ART STYLE as the rest of the film. The cast: Recurring cast, keep EVERY character identical in every scene: ${CAST.join("; ")}.`.slice(0, 500);
  assert.ok(!old.includes("duckling"), "this is the bug: not one duck reached the model");
  // a very long cast is trimmed character by character, never dropped whole
  const many = castSheetPrompt({ cast: Array.from({ length: 9 }, (_, k) => `Character${k}, ${"very ".repeat(80)}tall`), style: STYLE });
  assert.ok(many.length <= SHEET_PROMPT_MAX && many.includes("Character0") && many.includes("Character5") && !many.includes("Character6"), "six at most on a sheet");
});

test("a scene drawn from the sheet is TOLD the sheet is its cast, and keeps its own words and style", () => {
  const p = sceneFromSheetPrompt({ safe: SAFE, visual: VISUAL, style: STYLE });
  assert.ok(p.startsWith(`${SAFE}${SHEET_LEAD}`));
  assert.ok(SHEET_LEAD.includes("CAST SHEET") && SHEET_LEAD.includes("no new character is added"));
  assert.ok(p.includes(VISUAL) && p.includes(`Style: ${STYLE}.`));
  assert.ok(p.length <= SCENE_PROMPT_MAX);
  // the old shape lost the style and the cast notes to the same 500-character cut
  const old = `${SAFE}${VISUAL}. Recurring cast, keep EVERY character identical in every scene: ${CAST.join("; ")}. ${STYLE}. Richly detailed, high quality.`.slice(0, 500);
  assert.ok(!old.includes("3D-animated"), "the style never reached the model either");
});

test("with no sheet to draw from, the cast is in the words — in full", () => {
  const p = sceneInWordsPrompt({ safe: SAFE, visual: VISUAL, cast: CAST, style: STYLE });
  for (const name of ["Pip, a cheerful", "Dot, a giggly", "Nana Quacks, a gentle"]) assert.ok(p.includes(name), name);
  assert.ok(p.includes("keep EVERY character identical in every scene") && p.includes("Style: "));
  assert.ok(p.length <= SCENE_PROMPT_MAX);
  assert.ok(!sceneInWordsPrompt({ visual: "An empty field at dawn", cast: [], style: STYLE }).includes("Recurring cast"), "a film with no cast says nothing about one");
});

test("no writer or picture brief names somebody else's show", () => {
  // The kids sing-along's WRITER brief said "a CoComelon-style kids SING-ALONG" — an instruction to imitate
  // a real programme, in a format whose whole promise is the customer's OWN characters. (The on-screen copy
  // lost such names on 2026-11-17; this was the brief behind it.)
  for (const f of ["film-engine.server.ts", "film-dialogue.server.ts", "narrated-story.server.ts", "film-cast-sheet.ts", "story-picture.ts"]) {
    const src = read("app", "lib", f);
    for (const name of ["CoComelon", "Peppa", "Bluey", "Pixar", "Disney", "Paw Patrol", "Sesame"]) {
      assert.ok(!new RegExp(name, "i").test(src), `${f} names ${name}`);
    }
  }
  assert.ok(read("app", "lib", "film-engine.server.ts").includes("cute ORIGINAL cartoon characters (never a character from an existing show)"));
});

test("the engine uses them in all three places, and the picture calls are given the room", () => {
  const eng = read("app", "lib", "film-engine.server.ts");
  assert.equal(eng.split("renderCreativeSeed(castSheetPrompt({ safe: safePhrase, cast: treatment.cast || [], style: tmpl.sceneHint }), \"9:16\", SHEET_PROMPT_MAX)").length - 1, 2, "the preview's sheet and the render's");
  assert.ok(!eng.includes("A group portrait of the recurring cast standing together"), "the style-first sheet prompt is gone");
  assert.equal(eng.split("await sceneSeed({ tmpl, safe: safePhrase, visual: scene.visual, cast: treatment.cast || [], castSheet: productAbs ? undefined : castRefAbs, productRef: productAbs || undefined, productPrompt: seedPrompt })").length - 1, 2, "the preview's scenes and the render's");
  assert.ok(eng.includes("renderStyledSeed(sceneFromSheetPrompt({ safe: safePhrase, visual: opts.sceneVisual, style: tmpl.sceneHint }), refAbs, \"9:16\", SCENE_PROMPT_MAX)"), "a re-rolled scene too");
  const helper = eng.slice(eng.indexOf("async function sceneSeed("), eng.indexOf("export async function previewFilmSceneSeeds("));
  // a film with a PRODUCT keeps the prompt and the reference it always had (the product photo is not a cast sheet)
  assert.ok(helper.includes("if (o.productRef) return (await renderStyledSeed(o.productPrompt, o.productRef, \"9:16\")) || (await renderCreativeSeed(o.productPrompt, \"9:16\"));"));
  assert.ok(helper.includes("if (o.castSheet) return (await renderStyledSeed(sceneFromSheetPrompt("));
  assert.ok(helper.trimEnd().endsWith("return renderCreativeSeed(inWords, \"9:16\", SCENE_PROMPT_MAX);\n}"), "never left bare");
  const img = read("app", "lib", "image-generation.server.ts");
  assert.ok(img.includes("export async function renderCreativeSeed(prompt: string, aspect = \"9:16\", maxPrompt = 500): Promise<string | null> {"));
  assert.ok(img.includes("export async function renderStyledSeed(prompt: string, refImageUrl: string, aspect = \"9:16\", maxPrompt = 500): Promise<string | null> {"));
  assert.equal(img.split(".slice(0, Math.max(200, Math.min(1400, maxPrompt)))}. No watermark, no signature.`;").length - 1, 2, "every other caller still gets the 500 it always had");
});
