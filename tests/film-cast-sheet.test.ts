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
import { SCENE_PROMPT_MAX, SHEET_LEAD, SHEET_PROMPT_MAX, VISUAL_STANDS_ALONE, castSheetPrompt, sceneFromSheetPrompt, sceneInWordsPrompt, whoIsWho } from "../app/lib/film-cast-sheet.ts";

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
  assert.equal(eng.split("await sceneSeed({ tmpl, safe: safePhrase, visual: scene.visual, where: scene.where, cast: treatment.cast || [], castSheet: productAbs ? undefined : castRefAbs, productRef: productAbs || undefined, productPrompt: seedPrompt })").length - 1, 2, "the preview's scenes and the render's");
  assert.ok(eng.includes("renderStyledSeed(sceneFromSheetPrompt({ safe: safePhrase, visual: opts.sceneVisual, where: opts.where, cast: opts.cast, style: tmpl.sceneHint }), refAbs, \"9:16\", SCENE_PROMPT_MAX)"), "a re-rolled scene too");
  const helper = eng.slice(eng.indexOf("async function sceneSeed("), eng.indexOf("export async function previewFilmSceneSeeds("));
  // a film with a PRODUCT keeps the prompt and the reference it always had (the product photo is not a cast sheet)
  assert.ok(helper.includes("if (o.productRef) return (await renderStyledSeed(o.productPrompt, o.productRef, \"9:16\")) || (await renderCreativeSeed(o.productPrompt, \"9:16\"));"));
  assert.ok(helper.includes("if (o.castSheet) return (await renderStyledSeed(sceneFromSheetPrompt({ safe: o.safe, visual: o.visual, where: o.where, cast: o.cast, style: o.tmpl.sceneHint }), o.castSheet, \"9:16\", SCENE_PROMPT_MAX))"));
  assert.ok(helper.includes("const inWords = sceneInWordsPrompt({ safe: o.safe, visual: o.visual, where: o.where, cast: o.cast, style: o.tmpl.sceneHint });"));
  assert.ok(helper.trimEnd().endsWith("return renderCreativeSeed(inWords, \"9:16\", SCENE_PROMPT_MAX);\n}"), "never left bare");
  const img = read("app", "lib", "image-generation.server.ts");
  assert.ok(img.includes("export async function renderCreativeSeed(prompt: string, aspect = \"9:16\", maxPrompt = 500): Promise<string | null> {"));
  assert.ok(img.includes("export async function renderStyledSeed(prompt: string, refImageUrl: string, aspect = \"9:16\", maxPrompt = 500): Promise<string | null> {"));
  assert.equal(img.split(".slice(0, Math.max(200, Math.min(2000, maxPrompt)))}. No watermark, no signature.`;").length - 1, 2, "every other caller still gets the 500 it always had");
  assert.ok(SCENE_PROMPT_MAX <= 2000, "…and a scene's prompt is never longer than the picture call lets through");
});

/* THE SAME FILM, MADE AGAIN AFTER THE SHEET WAS FIXED ("One Umbrella, Three Little Ducks", 2026-11-22): the
 * three ducks were the same three in all four scenes. What was still wrong, and why:
 *   - "Puddleton leaps feet-first into a big round puddle…" — the duck that leapt was Bibbles. The scene
 *     calls its characters by NAME and a cast sheet has no name tags.
 *   - a rainy-day song's third scene was drawn on a sunny lawn. The writer's "where" for it ("center of the
 *     rainy street beside the biggest puddle") was never among the words the picture was drawn from.
 *   - the "one umbrella" the song is about was blue, yellow and red in one scene and white with red dots in
 *     the next: the writer called it "one big round polka-dot umbrella" and "the one open polka-dot umbrella".
 * Drawn again from the same sheet with the prompt below, on the real picture model: Puddleton leapt, and
 * scene three was on the wet street in the rain. */
const DUCKS = [
  "Puddleton, a round cheerful baby duck with bright yellow fluff, an orange beak, big sparkly blue eyes and a tiny red rain boot on each webbed foot",
  "Quacky, a small blue-fluffed duckling with a daisy-yellow beak, big round brown eyes and a polka-dot bow on her head",
  "Bibbles, a small green-fluffed duckling with a soft orange beak, big round green eyes and a striped scarf around his neck",
];
const LEAP = "Puddleton leaps feet-first into a big round puddle, splashing droplets shaped like tiny hearts, while Quacky and Bibbles clap and bounce beside him with big open-mouthed smiles";

test("a scene drawn from the sheet is told WHO IS WHO — each name with the look the writer gave it", () => {
  const key = whoIsWho(DUCKS);
  assert.ok(key.startsWith(" Who is who on the cast sheet (only the ones the scene names are in the picture): "), "a legend, not a guest list");
  assert.ok(key.includes("Puddleton = a round cheerful baby duck with bright yellow fluff, an orange beak, big sparkly blue eyes and a tiny red rain boot on each webbed foot;"), "whole — the boots are what tell him apart");
  assert.ok(key.includes("Quacky = a small blue-fluffed duckling") && key.includes("a polka-dot bow on her head;"));
  assert.ok(key.endsWith("Bibbles = a small green-fluffed duckling with a soft orange beak, big round green eyes and a striped scarf around his neck."));
  // names are read up to the first comma, dash, colon or bracket; an entry with no look to give is left out
  assert.ok(whoIsWho(["Nana Quacks — a gentle mama duck in a floral apron", "Mo: a tiny snail", "Just a name"]).includes("Nana Quacks = a gentle mama duck in a floral apron; Mo = a tiny snail."));
  assert.equal(whoIsWho([]), "");
  assert.equal(whoIsWho(["no look given here at all"]), "");
  // a cast too long for the room: the short looks stay whole, the long ones share what is left, and
  // nothing ends on a joining word
  const long = whoIsWho(["Ada, a tall heron", `Bo, a bear ${"with very thick brown fur and ".repeat(12)}a hat`, `Cy, a cat ${"with long white whiskers and ".repeat(12)}a bell`]);
  assert.ok(long.includes("Ada = a tall heron;"));
  assert.ok(long.length < 560, `${long.length}`);
  for (const part of long.split(";")) assert.ok(!/\b(?:and|with|a|the|of)\s*\.?$/i.test(part.trim()), part.slice(-30));
  // six at most
  assert.equal(whoIsWho(Array.from({ length: 9 }, (_, k) => `N${k}, a duck`)).split(" = ").length - 1, 6);
});

test("…and WHERE the scene is, with the scene's own words whole and the style never cut off the end", () => {
  const p = sceneFromSheetPrompt({ safe: SAFE, visual: LEAP, where: "the same candy-colored rainy street, closer on the biggest puddle.", cast: DUCKS, style: STYLE });
  assert.ok(p.startsWith(`${SAFE}${SHEET_LEAD}${LEAP}. Where: the same candy-colored rainy street, closer on the biggest puddle. Who is who on the cast sheet`));
  assert.ok(p.endsWith(` Style: ${STYLE}.`) && p.length <= SCENE_PROMPT_MAX, `${p.length}`);
  // no where, no cast: exactly the prompt it was before
  assert.equal(sceneFromSheetPrompt({ safe: SAFE, visual: VISUAL, style: STYLE }), `${SAFE}${SHEET_LEAD}${VISUAL} Style: ${STYLE}.`);
  // room runs short → it is the scene's own words that give, at a whole word — never the style
  const crowded = sceneFromSheetPrompt({ safe: SAFE, visual: `${"A very long scene description that goes on and on. ".repeat(20)}`, where: "a rainy street", cast: Array.from({ length: 6 }, (_, k) => `Name${k}, ${"a duck with a hat and ".repeat(8)}boots`), style: STYLE });
  assert.ok(crowded.length <= SCENE_PROMPT_MAX && crowded.endsWith(` Style: ${STYLE}.`) && crowded.includes(" Where: a rainy street."));
  // the picture from words alone (no sheet) says where too
  assert.ok(sceneInWordsPrompt({ safe: SAFE, visual: LEAP, where: "a rainy street", cast: DUCKS, style: STYLE }).includes("smiles. Where: a rainy street. Recurring cast"));
});

test("the WRITER is told each picture stands alone — names, the same words for the same thing, a where", () => {
  // (names ALONE: told to use a name "exactly as in cast", the writer of the next film pasted each
  //  character's whole description into every scene — four near-identical paragraphs for the customer to read)
  for (const must of ["drawn ON ITS OWN", "called by their NAME alone, spelt as in \"cast\" (the name only — never their description again: the artist has the cast sheet)", "ITS COLOURS INCLUDED", "never just \"the umbrella\"", "return \"where\" for every scene", "a rainy-day story is raining in every scene", "Nothing in a picture is WRITTEN"]) {
    assert.ok(VISUAL_STANDS_ALONE.includes(must), must);
  }
  const eng = read("app", "lib", "film-engine.server.ts");
  assert.equal(eng.split("${VISUAL_STANDS_ALONE}").length - 1, 3, "the sung, the told and the plain story formats (music videos, narrated stories and acted films have rules of their own)");
  // a re-rolled scene is told who is who and where as well: the page sends them, the action passes them on
  const ui = read("app", "routes", "web.film.tsx");
  assert.ok(ui.includes("sceneWhere: seeds.treatment.scenes[i]?.where || \"\", ...(seeds.treatment.cast?.length ? { sceneCastWords: JSON.stringify(seeds.treatment.cast) } : {}),"));
  assert.ok(ui.includes("img = await rerollFilmSceneSeed({ template: tmpl.key, sceneVisual, castRef: castRef || undefined, cast: castWords, where: sceneWhere || undefined });"));
});
