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

/* ---- EVERYWHERE A PICTURE IS DRAWN FOR A FILM (2026-11-25, stream S8) ----
 * The master's look is now ONE sequence (clothed.server.ts → keepClothed) that every film picture goes through: a told
 * story's scenes and portraits, a found-footage take's scene, a house camera's room as the take finds it, the acted
 * reveal, the thing's portrait and the sighting. Run here with stand-ins for the reader and the picture models. */
type Look = { unclothed: boolean; who: string };
const stand = (answers: Record<string, Look>) => {
  const asked: string[] = [];
  return { asked, look: async (u: string): Promise<Look> => { asked.push(u); return answers[u] || { unclothed: false, who: "" }; } };
};
const BARE: Look = { unclothed: true, who: "far left, waist-deep in the lake" };

test("keepClothed: a clothed picture costs one look and nothing else", async () => {
  const { keepClothed } = await import("../app/lib/clothed.server.ts");
  const r = stand({});
  let drawn = 0, edited = 0;
  const out = await keepClothed({ url: "/renders/a.jpg", ref: (u) => `https://x.test${u}`, look: r.look, redraw: async () => { drawn++; return "/renders/b.jpg"; }, edit: async () => { edited++; return "/renders/c.jpg"; } });
  assert.equal(out, "/renders/a.jpg");
  assert.deepEqual(r.asked, ["https://x.test/renders/a.jpg"], "looked at once, as a model is handed it");
  assert.equal(drawn + edited, 0, "a redraw or an edit only on a fault");
  // …and a look the caller already made is not asked again
  const r2 = stand({});
  assert.equal(await keepClothed({ url: "/renders/a.jpg", seen: { unclothed: false, who: "" }, look: r2.look }), "/renders/a.jpg");
  assert.equal(r2.asked.length, 0);
});

test("keepClothed: unclothed → drawn again clothes first, kept only if ITS look is clean; else ONE edit of the first picture", async () => {
  const { keepClothed } = await import("../app/lib/clothed.server.ts");
  // the redraw is clean: it is the picture, and no edit is made
  let edits = 0;
  const a = stand({ "/renders/a.jpg": BARE });
  assert.equal(await keepClothed({ url: "/renders/a.jpg", look: a.look, redraw: async () => "/renders/b.jpg", edit: async () => { edits++; return "/renders/c.jpg"; } }), "/renders/b.jpg");
  assert.deepEqual(a.asked, ["/renders/a.jpg", "/renders/b.jpg"]);
  assert.equal(edits, 0);
  // the redraw is bare too: the edit is made of the FIRST picture, told where the figure is — and its look is clean
  const b = stand({ "https://x.test/renders/a.jpg": BARE, "https://x.test/renders/b.jpg": BARE });
  const handed: string[] = [];
  const said: string[] = [];
  assert.equal(await keepClothed({ url: "/renders/a.jpg", ref: (u) => `https://x.test${u}`, look: b.look, redraw: async () => "/renders/b.jpg", edit: async (u, who) => { handed.push(`${u} | ${who}`); return "/renders/c.jpg"; }, log: (l) => said.push(l) }), "/renders/c.jpg");
  assert.deepEqual(handed, ["https://x.test/renders/a.jpg | far left, waist-deep in the lake"]);
  assert.deepEqual(b.asked, ["https://x.test/renders/a.jpg", "https://x.test/renders/b.jpg", "https://x.test/renders/c.jpg"], "three looks at most: the picture, the redraw, the edit");
  assert.ok(said[0].startsWith("an unclothed figure (far left, waist-deep in the lake)") && said.includes("dressed by one edit"), said.join(" / "));
  // no redraw asked for: straight to the edit (a told story's best-of has had its goes; a ladder's next model is the redraw)
  const c = stand({ "/renders/a.jpg": BARE });
  assert.equal(await keepClothed({ url: "/renders/a.jpg", look: c.look, edit: async () => "/renders/c.jpg", still: "drop" }), "/renders/c.jpg");
});

test("keepClothed: still unclothed after the edit — the caller says: kept (and said), or dropped; never a film lost to a look", async () => {
  const { keepClothed } = await import("../app/lib/clothed.server.ts");
  const allBare = stand({ "/renders/a.jpg": BARE, "/renders/b.jpg": BARE, "/renders/c.jpg": BARE });
  const said: string[] = [];
  assert.equal(await keepClothed({ url: "/renders/a.jpg", look: allBare.look, redraw: async () => "/renders/b.jpg", edit: async () => "/renders/c.jpg", log: (l) => said.push(l) }), "/renders/c.jpg", "keep: the edited picture (the master's own last resort)");
  assert.ok(said.includes("STILL an unclothed figure after the edit — the edited picture is kept; look at this film"));
  assert.equal(await keepClothed({ url: "/renders/a.jpg", look: allBare.look, edit: async () => "/renders/c.jpg", still: "drop" }), null, "drop: the caller goes on without it");
  // an edit that fails or throws: kept as it was — or dropped
  for (const edit of [async () => null, async () => { throw new Error("refused"); }]) {
    const s = stand({ "/renders/a.jpg": BARE });
    assert.equal(await keepClothed({ url: "/renders/a.jpg", look: s.look, edit }), "/renders/a.jpg");
    assert.equal(await keepClothed({ url: "/renders/a.jpg", look: s.look, edit, still: "drop" }), null);
  }
  // a redraw that throws goes on to the edit
  const r = stand({ "/renders/a.jpg": BARE });
  assert.equal(await keepClothed({ url: "/renders/a.jpg", look: r.look, redraw: async () => { throw new Error("down"); }, edit: async () => "/renders/c.jpg" }), "/renders/c.jpg");
  // a look that cannot be made reads as clothed: the picture is kept, nothing is spent
  let spent = 0;
  assert.equal(await keepClothed({ url: "/renders/a.jpg", look: async () => { throw new Error("no credit"); }, redraw: async () => { spent++; return "x"; }, edit: async () => { spent++; return "y"; }, still: "drop" }), "/renders/a.jpg");
  assert.equal(spent, 0);
});

test("the told story's look asks it in the SAME question that lists the people — one question more, never a fifth call", async () => {
  const sp = await import("../app/lib/story-picture.ts");
  const q = sp.storyExtrasPrompt("A pale woman stands waist-deep in the lake. She is fully clothed: a long pale nightgown, soaked and clinging, covering her from neck to knee.", ["Farida: a woman in a red raincoat"]);
  assert.ok(q.includes(sp.UNCLOTHED_ASKED) && q.indexOf("First list every person or creature you can see in it") < q.indexOf(sp.UNCLOTHED_ASKED), "after the people are written down");
  assert.ok(q.includes('"unclothed": true or false, "unclothedWho": "where that one is, in a few words — an empty string when nobody is"}.'));
  // the master's own words — and an animal wears its own coat, in both
  assert.ok(sp.UNCLOTHED_ASKED.includes("a bare chest or bare torso, or a body with no clothing visible on it? Bare arms, bare legs, bare feet and a swimsuit all count as CLOTHED"));
  assert.ok(sp.UNCLOTHED_ASKED.endsWith(sp.COATED) && unclothedPrompt().includes(sp.COATED));
  assert.equal(sp.COATED, "An animal, or a creature covered in its own fur, feathers or scales — real or a cartoon — counts as CLOTHED.");
  // its answer — null when the answer does not say (an older reading: nobody is taken to be unclothed)
  assert.deepEqual(sp.parseStoryUnclothed('{"people":["a woman in the lake"],"uninvited":false,"intoLens":[],"unclothed":true,"unclothedWho":"in the lake,   far right"}'), { unclothed: true, who: "in the lake, far right" });
  assert.deepEqual(sp.parseStoryUnclothed('{"unclothed":false,"unclothedWho":""}'), { unclothed: false, who: "" });
  for (const junk of ['{"uninvited":false}', '{"unclothed":"yes"}', "no idea", ""]) assert.equal(sp.parseStoryUnclothed(junk), null, junk);
});

test("a picture with somebody unclothed is never the one kept while one without exists — and the next go is told FIRST", async () => {
  const sp = await import("../app/lib/story-picture.ts");
  // every other fault at once (three looked for and none there, split, pasted inset, a stranger, stood outside, a stare, run-down)
  const worst = { seen: [false, false, false], panels: true, extra: true, outside: true, lens: ["Farida"], grimy: true, inset: true };
  assert.equal(sp.storyFaults(worst), 27);
  assert.ok(sp.storyFaults({ seen: [true], panels: false, unclothed: true }) > sp.storyFaults(worst), "unclothed alone outweighs all of them");
  assert.equal(sp.storyFaults({ seen: [true], panels: false, unclothed: true }), sp.UNCLOTHED_FAULT);
  assert.equal(sp.storyFaults({ seen: [true], panels: false, unclothed: false }), 0);
  // the fix: CLOTHED_FIRST, said ahead of everything on the next go; nothing for any other fault
  assert.equal(sp.storyFirst({ seen: [true], panels: false, unclothed: true, unclothedWho: "in the lake" }), `${CLOTHED_FIRST} `);
  for (const c of [{ seen: [false], panels: true, extra: true }, null, undefined]) assert.equal(sp.storyFirst(c), "");
  // a picture kept with somebody STILL unclothed is written down for the operator
  assert.deepEqual(sp.keptFaults([{ seen: [true], panels: false, unclothed: true, who: ["Farida"] }, { seen: [true], panels: false, who: ["Farida"] }]), [{ scene: 1, missing: [], unclothed: true }]);
});
