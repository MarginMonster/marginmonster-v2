/* A CREATURE CAN FRONT A MUSIC VIDEO — and the lip-sync model is kept off a mouth it cannot drive.
 *
 * First monster music video (a werewolf fronting a rock song, a ghost bride on bass, 2026-11-22): it worked
 * first try, and his jaw moved with the song. The lip-sync model, built for human faces, found no face on
 * him in most frames and left them alone — and for three frames at 8.2 s it did find one, and pasted a
 * blurred human mouth onto his muzzle.
 *
 * The question was put to the real reader on the live site for all six stock characters and two people:
 * werewolf, hooded skull, cartoon puppy, capybara and dinosaur → "other"; ghost bride and both people →
 * "human". 8 of 8.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MOUTH_CHECK_PROMPT, parseMouthCheck, pictureFile } from "../app/lib/mv-cast.ts";
import { STOCK_CHARACTERS } from "../app/lib/stock-characters.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");

test("the question names what a human mouth is, what is not one, and asks for one of two words", () => {
  assert.ok(MOUTH_CHECK_PROMPT.includes("HUMAN mouth"));
  for (const kind of ["ghost", "muzzle", "snout", "beak", "skull", "cartoon animal"]) assert.ok(MOUTH_CHECK_PROMPT.includes(kind), kind);
  assert.ok(MOUTH_CHECK_PROMPT.endsWith(`Reply with ONLY this JSON: {"mouth":"human"} or {"mouth":"other"}.`));
});

test("the answer is read whatever it is wrapped in, and an unusable one is nothing at all", () => {
  assert.equal(parseMouthCheck(`{"mouth":"other"}`), "other");
  assert.equal(parseMouthCheck(`{"mouth":"human"}`), "human");
  assert.equal(parseMouthCheck("```json\n{ \"mouth\" : \"Other\" }\n```"), "other");
  assert.equal(parseMouthCheck("It is a werewolf. {\"mouth\":\"other\"}"), "other");
  assert.equal(parseMouthCheck("I can't tell."), null);
  assert.equal(parseMouthCheck(""), null);
  assert.equal(parseMouthCheck(`{"mouth":"maybe"}`), null);
});

test("a cast picture is recognised by its file, however its address is written", () => {
  assert.equal(pictureFile("/avatars/howl_0.jpg"), "howl_0.jpg");
  assert.equal(pictureFile("https://easymodeapp.com/avatars/howl_0.jpg?v=3"), "howl_0.jpg");
  assert.equal(pictureFile("https://x.onrender.com/renders/ca-123.png#top"), "ca-123.png");
  assert.equal(pictureFile(""), "");
  assert.equal(pictureFile(null), "");
});

test("who is a character is the SERVER'S own knowledge: the stock characters and the shop's own", () => {
  const kinds = read("app", "lib", "cast-kinds.server.ts");
  assert.ok(kinds.includes("for (const a of STOCK_CHARACTERS) if (a.kind && a.kind !== \"person\") files.add(pictureFile(avatarImg(a.id, 0)));"));
  assert.ok(kinds.includes("for (const c of await customCastFor(shopId)) {") && kinds.includes("if (!c.kind || c.kind === \"person\") continue;"));
  // every stock character is a character (none would slip past as a person)
  assert.ok(STOCK_CHARACTERS.length >= 6 && STOCK_CHARACTERS.every((a) => a.kind === "cartoon" || a.kind === "monster"));
  // the page sends no "kind" for a music video's cast — nothing there for anyone to edit
  const ui = read("app", "routes", "web.film.tsx");
  assert.ok(!/name="film(Hero|Cast)Kind/.test(ui));
});

test("the lip-sync model runs on a performance only where it fits the singer's mouth", () => {
  const mv = read("app", "lib", "music-video-pipeline.server.ts");
  // people are never asked about; a character is looked at once, by picture
  const fits = mv.slice(mv.indexOf("const lipSyncFits = (i: number): Promise<boolean> => {"), mv.indexOf("// 5) song SEGMENTS"));
  assert.ok(fits.includes("const k = singers[i];") && fits.includes("const img = k >= 0 ? extraUrls[k] : heroAbs;"), "the scene's own singer: the artist, or the co-star whose verse it is");
  assert.ok(fits.includes("if (!img || !characterFiles.has(pictureFile(img))) return Promise.resolve(true);"));
  assert.ok(fits.includes("let look = mouthLooks.get(img);") && fits.includes("mouthLooks.set(img, look);"), "one look per character per render");
  assert.ok(fits.includes("parseMouthCheck(String(await anthropicVision(MOUTH_CHECK_PROMPT, [img], { maxTokens: 60, model: \"claude-sonnet-4-6\" })))"));
  assert.ok(fits.includes("return said !== \"other\";"), "only a clear NO turns the lip-sync model off");
  // anything that goes wrong leaves the render exactly as it was
  assert.ok(fits.includes("return true;") && mv.includes("try { return await (await import(\"./cast-kinds.server\")).characterPictureFiles(opts.shopId); } catch { return new Set<string>(); }"));
  // the gate itself: a performance the model cannot drive is finished like a cut scene (song laid over the
  // motion clip) — but it was FILMED as a performance, so the jaw works
  assert.ok(mv.includes("if (shot.role === \"perform\" && await lipSyncFits(i)) {"));
  assert.ok(!mv.includes("if (shot.role === \"perform\") {\n          // PERFORMANCE: dedicated lip-sync"));
  const prompt = mv.slice(mv.indexOf("const motionPrompt = shot.role === \"perform\""), mv.indexOf("const quietFaces ="));
  assert.ok(prompt.includes("The artist ${g.perform}."), "the motion prompt still asks for the singing");
  assert.ok(mv.includes("const quietFaces = shot.role === \"perform\" ? \"\" :"), "and its mouth is not told to stay shut");
});
