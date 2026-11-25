/* EVERYBODY IN A FILM'S PICTURE IS CLOTHED — in its words, and LOOKED AT.
 *
 * 2026-11-25: three acted lake films in a row ("She Rises Without a Ripple", "She Walked From Still Water", "Still
 * Water Calls Twice") drew the woman "standing waist-deep in the lake" bare — whatever the prompt's last line said
 * about everyone being clothed — and none of them could be sent to the owner. A picture model draws a person in
 * water as a bather unless the words that put them there also dress them; and a rule nobody checks is a hope.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLOTHED_FIRST, clothedEdit, dressedInWater, parseUnclothed, unclothedPrompt } from "../app/lib/story-picture.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("the sentence that puts a person in water also dresses them — right behind it, and only when nothing already does", () => {
  // the lake film's own moment: her clothes are said where SHE is said, not at the end of a long prompt
  assert.equal(
    dressedInWater("Farida shines the flashlight across the water. A pale woman stands waist-deep in the lake, perfectly still, smiling. Abena grabs her arm."),
    "Farida shines the flashlight across the water. A pale woman stands waist-deep in the lake, perfectly still, smiling. She is fully clothed: a long pale nightgown, soaked and clinging, covering her from neck to knee. Abena grabs her arm.",
  );
  assert.equal(dressedInWater("A man wades into the river after his dog."), "A man wades into the river after his dog. He is fully clothed: a shirt and trousers, soaked and clinging.");
  assert.ok(dressedInWater("Something pale floats in the pond. A figure stands in the water beside it.").includes("The one in the water is fully clothed"));
  // swimmers wear swimsuits; a bath shows a head and shoulders — nobody bathes in a nightgown
  assert.equal(dressedInWater("The kids are swimming in the pool while Dad grills."), "The kids are swimming in the pool while Dad grills. Everyone in the water wears a modest swimsuit.");
  assert.equal(dressedInWater("She lowers herself into the bath. Steam rises."), "She lowers herself into the bath. Only the head and shoulders show above the water and the foam — nothing else of the body is seen. Steam rises.");
  // words that already dress them are left alone — in that sentence or the next
  for (const said of [
    "A woman in a soaked white dress stands waist-deep in the lake.",
    "A woman stands waist-deep in the lake. Her nightgown floats around her.",
    "A diver in a black wetsuit surfaces in the lake.",
  ]) assert.equal(dressedInWater(said), said);
  // …a jacket two sentences away is somebody else's
  assert.ok(dressedInWater("Farida zips her jacket. They walk to the shore. A woman stands waist-deep in the lake.").endsWith("covering her from neck to knee."));
  // no water, no person in it: untouched
  for (const dry of ["They sit in the kitchen, talking.", "Rain falls on the empty lake.", ""]) assert.equal(dressedInWater(dry), dry);
});

test("the look: one question, an answer that can only say yes when it says so, and what is done about it", () => {
  const q = unclothedPrompt();
  for (const part of ["however small, far away or pale", "a bare chest or bare torso", "Bare arms, bare legs, bare feet and a swimsuit all count as CLOTHED", '{"unclothed": true or false, "who":']) assert.ok(q.includes(part), part);
  assert.deepEqual(parseUnclothed('Here: {"unclothed": true, "who": "far left, standing in the water"}'), { unclothed: true, who: "far left, standing in the water" });
  assert.deepEqual(parseUnclothed('{"unclothed": false, "who": ""}'), { unclothed: false, who: "" });
  // an answer that cannot be read never calls a picture bare (a film is never lost to its check)
  for (const junk of ["", "yes", "{broken", '{"unclothed": "true"}']) assert.equal(parseUnclothed(junk).unclothed, false, junk);
  assert.ok(CLOTHED_FIRST.startsWith("EVERY person and every figure in this picture is fully clothed, the far and the pale ones too"));
  assert.ok(clothedEdit("far left, in the water").includes("the figure (far left, in the water) who has no clothes on now wears a long, soaked, pale nightgown") && clothedEdit("").includes("Everything else stays exactly as it is"));
});

test("a film's master is looked at before it is kept: drawn again clothes-first, then dressed by an edit — and never lost to the look", () => {
  const src = read("app", "lib", "image-generation.server.ts");
  // the moment's own words dress a person in water, in the staged prompt and the classic one
  assert.ok(src.includes('const action = dressedInWater(opts.action || "");'));
  assert.ok(src.includes('const act = action.replace(/\\s+/g, " ").trim().slice(0, 240);') && src.includes('act: action.replace(/\\s+/g, " ").trim().slice(0, 560), mood,'));
  // the look comes after the draw and BEFORE the picture is kept
  const look = src.indexOf("let seen = await bare(url);");
  const kept = src.indexOf('const durable = await persistRemote(url, "jpg");', look);
  assert.ok(look > 0 && kept > look, "looked at before it is persisted");
  assert.ok(src.includes('parseUnclothed(String((await anthropicVision(unclothedPrompt(), [u], { maxTokens: 120, model: "claude-sonnet-4-6" })) || ""))'));
  assert.ok(src.includes("catch { return { unclothed: false, who: \"\" }; } };"), "a look that cannot be made keeps the picture");
  // once more with the clothes said first, on the model that drew it; then the edit, on the good model, of THAT picture
  assert.ok(src.includes("storyPictureInput(used, { prompt: `${CLOTHED_FIRST} ${staged || prompt}`, refs, aspect: ar })"));
  assert.ok(src.includes("storyPictureInput(STORY_MODEL, { prompt: clothedEdit(seen.who), refs: [url], aspect: ar })"));
  // a redraw or an edit replaces the picture only when ITS look is clean — except the last resort, which is kept and said
  assert.ok(src.includes("if (again && !look.unclothed) { url = again; seen = look; }") && src.includes("if (edited && !look.unclothed) { url = edited; seen = look; }"));
  assert.ok(src.includes("STILL an unclothed figure after the edit — the edited picture is kept; look at this film"));
});

test("NIGHT IS NIGHT, LOOKED AT: a night film's master whose sky reads as dusk or day is drawn once more with the night said first", async () => {
  const { NIGHT_FIRST, NIGHT_SAID, nightLookPrompt, parseNightLook } = await import("../app/lib/story-picture.ts");
  // ("Who Smiles In Still Water", 2026-11-25: told the sky was black, the lake outside the tent was a pale blue evening again)
  for (const said of ["inside the tent, in the middle of the night", "they wake at 3am", "a moonlit road", "the lake after dark"]) assert.ok(NIGHT_SAID.test(said), said);
  for (const day of ["a sunny kitchen", "the lake at dawn", "an office"]) assert.ok(!NIGHT_SAID.test(day), day);
  const q = nightLookPrompt();
  for (const part of ["MIDDLE OF THE NIGHT", "seen through a window, a door or a tent opening", "dusk, twilight, blue hour, an overcast evening or day", '{"sky": "night" or "dusk" or "day"}']) assert.ok(q.includes(part), part);
  // only a clear "dusk" or "day" is a fault: an answer that cannot be read never costs a film
  assert.equal(parseNightLook('{"sky": "dusk"}'), false);
  assert.equal(parseNightLook('{"sky":"day"}'), false);
  for (const fine of ['{"sky": "night"}', "", "junk", '{"sky": 3}']) assert.equal(parseNightLook(fine), true, fine);
  assert.ok(NIGHT_FIRST.startsWith("NIGHT, about three in the morning: the sky is BLACK, with no blue in it"));
  const src = read("app", "lib", "image-generation.server.ts");
  // asked only of a photographed film whose place or moment says night — and BEFORE the clothed look
  const night = src.indexOf("if (!cartoon && NIGHT_SAID.test(`${setting} ${action}`)) {");
  assert.ok(night > 0 && night < src.indexOf("let seen = await bare(url);"));
  assert.ok(src.includes("storyPictureInput(used, { prompt: `${NIGHT_FIRST} ${staged || prompt}`, refs, aspect: ar })"));
  assert.ok(src.includes("if (again && (await night(again))) url = again;"), "the redraw is kept only if ITS sky is night");
});
