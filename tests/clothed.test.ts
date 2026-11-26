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
// (stream S8, 2026-11-25: everybody in every film picture — clothed.server.ts → keepClothed, below)

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
  // …in what suits where that figure IS (review of S8, 2026-11-25): the look runs on every film picture now — a dry
  // headshot or somebody asleep is never put in a soaked nightgown; a man in water wears what dressedInWater gives him
  assert.ok(clothedEdit("").includes("now wears a long, soaked, pale nightgown"), "nothing said of where: the lake's edit, as it was");
  assert.ok(clothedEdit("far left, waist-deep in the lake").includes("now wears a long, soaked, pale nightgown"));
  assert.equal(clothedEdit("the man waist-deep in the river").includes("now wears a shirt and trousers, soaked and clinging."), true);
  for (const dry of ["the headshot, centre, bare shoulders", "in the bed on the left", "the woman by the window"]) {
    const e = clothedEdit(dry);
    assert.ok(e.includes("now wears clothes that suit who they are and where they are — an ordinary person ordinary everyday clothes (in bed, pajamas); a ghost, a corpse or a creature a ragged, dark, shapeless old garment — covering the body from the neck down.") && !e.includes("nightgown") && !e.includes("soaked"), dry);
  }
  assert.ok(clothedEdit("a woman standing in the shallows").includes("nightgown") && clothedEdit("women in the lake").includes("nightgown"), "a woman is never read as a man");
});

test("a film's master is looked at before it is kept: drawn again clothes-first, then dressed by an edit — and never lost to the look", () => {
  const src = read("app", "lib", "image-generation.server.ts");
  // the moment's own words dress a person in water, in the staged prompt and the classic one
  assert.ok(src.includes('const action = dressedInWater(opts.action || "");'));
  assert.ok(src.includes('const act = action.replace(/\\s+/g, " ").trim().slice(0, 240);') && src.includes('act: action.replace(/\\s+/g, " ").trim().slice(0, 560), mood,'));
  // the look comes after the draw and BEFORE the picture is kept
  // (since 2026-11-25 the steps are the ONE look every film picture has — clothed.server.ts → keepClothed — moved there
  //  as they were: a pure refactor, its behaviour run with stand-ins below)
  const look = src.indexOf("url = (await keepClothed({");
  const kept = src.indexOf('const durable = await persistRemote(url, "jpg");', look);
  assert.ok(look > 0 && kept > look, "looked at before it is persisted");
  const cl = read("app", "lib", "clothed.server.ts");
  assert.ok(cl.includes('return parseUnclothed(String((await anthropicVision(unclothedPrompt(), [ref], { maxTokens: 120, model: "claude-sonnet-4-6" })) || ""));'));
  assert.ok(cl.includes("} catch { return NOBODY; }"), "a look that cannot be made keeps the picture");
  // once more with the clothes said first, on the model that drew it; then the edit, on the good model, of THAT picture
  assert.ok(src.includes("redraw: () => repRun(used, storyPictureInput(used, { prompt: `${CLOTHED_FIRST} ${staged || prompt}`, refs, aspect: ar }), 150_000),"));
  assert.ok(src.includes("edit: (u, who) => repRun(STORY_MODEL, storyPictureInput(STORY_MODEL, { prompt: clothedEdit(who), refs: [u], aspect: ar }), 150_000),"));
  assert.ok(cl.includes("const edited = await o.edit(ref(o.url), seen.who);"), "the edit is of the picture as first drawn, told where that figure is");
  // a redraw or an edit replaces the picture only when ITS look is clean — except the last resort, which is kept and said
  assert.ok(cl.includes("if (again && !(await look(again)).unclothed) return again;") && cl.includes("if (!(await look(edited)).unclothed) { say(\"dressed by one edit\"); return edited; }"));
  assert.ok(src.includes('still: "keep",') && cl.includes("STILL an unclothed figure after the edit — the edited picture is kept; look at this film"));
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
  assert.ok(night > 0 && night < src.indexOf("url = (await keepClothed({"));
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
  // a hand or an arm on its own is not a body (live 2026-11-26: a ghost's hand pressed to glass, called unclothed)
  assert.ok(sp.UNCLOTHED_ASKED.endsWith(`${sp.PART_ALONE} ${sp.COATED}`) && unclothedPrompt().includes(`${sp.PART_ALONE} ${sp.COATED}`));
  assert.ok(sp.PART_ALONE.includes("with no body seen with it counts as CLOTHED too") && !/torso|chest/i.test(sp.PART_ALONE), "nothing about a bare torso changes");
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
  // (…and a night drawn as day beside them since 2026-11-25 — 30 in all; a dressed day picture is kept before an undressed
  //  night one: tests/told-night.test.ts)
  assert.equal(sp.storyFaults({ ...worst, notNight: true }), 30);
  assert.ok(sp.storyFaults({ seen: [true], panels: false, unclothed: true }) > sp.storyFaults({ ...worst, notNight: true }), "unclothed alone outweighs all of them, the night too");
  assert.equal(sp.storyFaults({ seen: [true], panels: false, unclothed: true }), sp.UNCLOTHED_FAULT);
  assert.equal(sp.storyFaults({ seen: [true], panels: false, unclothed: false }), 0);
  // the fix: CLOTHED_FIRST, said ahead of everything on the next go; nothing for any other fault
  assert.equal(sp.storyFirst({ seen: [true], panels: false, unclothed: true, unclothedWho: "in the lake" }), `${CLOTHED_FIRST} `);
  for (const c of [{ seen: [false], panels: true, extra: true }, null, undefined]) assert.equal(sp.storyFirst(c), "");
  // a picture kept with somebody STILL unclothed is written down for the operator
  assert.deepEqual(sp.keptFaults([{ seen: [true], panels: false, unclothed: true, who: ["Farida"] }, { seen: [true], panels: false, who: ["Farida"] }]), [{ scene: 1, missing: [], unclothed: true }]);
});

test("TOLD STORIES: the lake scene's words dress her before the picture model reads them; the look, the redraw, the edit", async () => {
  const sp = await import("../app/lib/story-picture.ts");
  // the words a told story's picture is drawn from — tidied to one moment and nothing written, then dressed
  const lake = "WIDE: Farida shines the flashlight across the black water, and a pale woman stands waist-deep in the lake, perfectly still, smiling.";
  const visual = dressedInWater(sp.oneMoment(sp.noLettering(lake)));
  assert.equal(visual, `${lake} She is fully clothed: a long pale nightgown, soaked and clinging, covering her from neck to knee.`);
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("const visual = dressedInWater(oneMoment(noLettering(written)));") && nar.includes("${safe}${visual.slice(0, 600)}"), "what the picture model reads");
  // the look: in the question that lists the people (no fifth call), read back into the story's check
  assert.ok(nar.includes("const bare = parseStoryUnclothed(String(extrasRaw || \"\"));") && nar.includes("...(bare?.unclothed ? { unclothed: true, unclothedWho: bare.who } : {}) };"));
  assert.equal((nar.match(/anthropicVision\(/g) || []).length, 4, "still four questions to a picture");
  // the redraw: told CLOTHED_FIRST ahead of everything on the next go
  assert.ok(nar.includes("first = storyFirst(seenAs);") && nar.includes("const got = await drawScene(`${first}${promptOf(withPlace)}${fix}`, withPlace ? refs : people, aspect);"));
  // the edit: a best-of still unclothed is dressed by ONE edit and looked at again — before it is kept, still bare → flagged
  const edit = nar.indexOf("if (!img && best?.check.unclothed) {");
  assert.ok(edit > 0 && edit < nar.indexOf("if (!img && best) { img = best.img;"));
  assert.ok(nar.includes("const dressed = await keepClothed({ url: was.img, ref: (u) => abs(u) || u, seen: { unclothed: true, who: was.check.unclothedWho || \"\" }, edit: (u, bare) => clothedEditOn(u, bare, aspect), still: \"drop\", log: (l) => console.log(`[narrated] scene ${i + 1}: ${l}`) });"));
  assert.ok(nar.includes("best = { img: dressed, faults: storyFaults(rest), check: rest };") && nar.includes("if (!best.faults) img = dressed;"), "dressed, it keeps whatever else its look found");
  // the portraits every scene is drawn from: dressed in their words, looked at, drawn again clothes first, edited — or none
  assert.ok(nar.includes("return img ? keepClothed({ url: img, ref: (u) => abs(u) || u, redraw: () => drawScene(`${CLOTHED_FIRST} ${ask}`, [], PORTRAIT_ASPECT), edit: (u, bare) => clothedEditOn(u, bare, PORTRAIT_ASPECT), still: \"drop\","));
  // …a letterboxed picture kept because every go was letterboxed (never looked at by the story's look): looked at, kept
  //  (review of S8, 2026-11-25)
  assert.ok(nar.includes("if (!img && barred) img = await keepClothed({ url: barred, ref: (u) => abs(u) || u, edit: (u, bare) => clothedEditOn(u, bare, aspect), log:") && !nar.includes("if (!img) img = barred;"));
  // …and the lenient last path: dressed words, looked at, kept
  // (…a night scene's night said first in it since 2026-11-25 — tests/told-night.test.ts; a drawn story's cut longer by
  //  its lead since 2026-11-26 — tests/anime-shelf.test.ts)
  assert.ok(nar.includes("renderCreativeSeed(`${safe}${night ? `${NIGHT_LINE} ` : \"\"}${dressedInWater((scene.visual || \"\").slice(0, 300))}. ${tmpl.sceneHint}`, aspect, 500 + (tmpl.drawn ? drawnLead(tmpl.key).length : 0));") && nar.includes("img = lenient ? await keepClothed({ url: lenient,"));
});

test("FANTASY KEEPS ITS OWN WORLD: everybody clothed, but never told its places look the way they look TODAY", async () => {
  const sp = await import("../app/lib/story-picture.ts");
  const nar = read("app", "lib", "narrated-story.server.ts");
  // a told story's picture: a children's story and a world of its own get DRESSED; everything else TODAY_LOOK (which ends with it)
  assert.ok(nar.includes("${tmpl.childSafe || tmpl.ownWorld ? ` ${DRESSED}` : ` ${TODAY_LOOK}`}"));
  assert.ok(sp.TODAY_LOOK.endsWith(sp.DRESSED) && sp.TODAY_LOOK.includes("no cottage and no castle unless they name one"));
  // …its places' sheets too (nobody in a sheet to dress)
  assert.ok(nar.includes("placeSheetPrompt(p, tmpl.sceneHint, safe, !tmpl.childSafe && !tmpl.ownWorld)"));
  assert.ok(!sp.placeSheetPrompt({ name: "the hall", look: "a long timber hall with a stone hearth" }, "fantasy", "", false).includes("TODAY"));
  // the genre that is its own world is Fantasy, and only Fantasy
  const g = await import("../app/lib/film-genres.ts");
  assert.deepEqual(g.GENRE_FILMS.filter((x: { ownWorld?: boolean }) => x.ownWorld).map((x: { key: string }) => x.key), ["fantasy"]);
  // THE ACTED MASTER: the one line that chooses it (acted-staging.ts → actedRealism), and the film's template reaching it
  const st = await import("../app/lib/acted-staging.ts");
  const today = st.actedRealism(false, "Wren lifts the lantern in the timber hall", "a long timber hall at night");
  const own = st.actedRealism(false, "Wren lifts the lantern in the timber hall", "a long timber hall at night", true);
  assert.ok(today.includes(sp.TODAY_LOOK) && !own.includes("TODAY") && own.includes(sp.DRESSED) && own.includes(st.NIGHT_LINE), "clothed, its night still night — never today's world");
  assert.equal(st.actedRealism(false, "x", "y", false), st.actedRealism(false, "x", "y"), "every other film word for word as it was");
  assert.equal(st.actedRealism(true, "x", "y", true), "", "a cartoon is left as it was");
  const staged = st.stagedTwoShot({ staging: "walk", setting: "a long timber hall", personA: "Wren", personB: "Oda", act: "Wren lifts the lantern", consistency: "Keep them distinct.", comp: "wide cinematic landscape composition", ownWorld: true });
  assert.ok(staged.includes(sp.DRESSED) && !staged.includes("TODAY"), "the staged master of a fantasy");
  assert.ok(read("app", "lib", "image-generation.server.ts").includes("comp, ownWorld: opts.ownWorld }) : \"\";"));
  assert.ok(read("app", "lib", "film-dialogue.server.ts").includes("look: threat.look } : null, ownWorld: tmpl.ownWorld }));"));
});

test("FOUND FOOTAGE: a take's scene, each moment's, and a house camera's — dressed words, looked at, drawn again clothes first, edited", () => {
  const take = read("app", "lib", "take.server.ts");
  // the one way a found-footage picture somebody may be in is drawn: drawPicture → keepClothed (redraw on the same rung, edit at its shape)
  const fn = take.slice(take.indexOf("export async function drawClothed("), take.indexOf("/** The take itself, started on `first`"));
  assert.ok(fn.includes("const drawn = await drawPicture(input, best);"));
  assert.ok(fn.includes("redraw: () => drawPicture({ ...input, prompt: `${CLOTHED_FIRST} ${input.prompt}` }, best),"));
  assert.ok(fn.includes("edit: (u, who) => clothedEditOn(u, who, input.aspect_ratio),") && fn.includes("})) || drawn;"), "never a take lost to a look");
  // ONE TAKE: its scene's words dressed; the picture used is the one checkpointed; the way in (nobody in it) as it was
  assert.ok(take.includes("still = await drawClothed({ prompt: takeStillPrompt({ ...take, still: dressedInWater(take.still) }, aspect), aspect_ratio: aspect, output_format: \"jpg\" }, false, \"[take] the scene:\");\n    await ckpt({ ckStill: still });"));
  assert.ok(take.includes("prompt: takeOpensPrompt(take, aspect), image_input: [imageRef(base, still)]"));
  // A FILM: each moment's scene; its way in drawn from it as it was
  const film = read("app", "lib", "footage-film.server.ts");
  assert.ok(film.includes("still: dressedInWater(d.take.still)") && film.includes("try { await save(i, { ckStill: await drawClothed({ prompt,"));
  // A HOUSE: the room as the take finds it (somebody asleep) and the scene; the empty room is drawn as it was
  const house = read("app", "lib", "house-take.server.ts");
  assert.ok(house.includes("drawClothed({ prompt: dressedInWater(prompt), ...(refs.length ? { image_input: refs.map((r) => imageRef(base, r)) } : {}), aspect_ratio: \"16:9\", output_format: \"jpg\" }, !!o.best, `[house-take] ${what}:`);"));
  assert.ok(house.includes("house = withRoom(house, room.key, await draw(roomPrompt(room, plan.first), plan.from ? [plan.from] : []));"), "NOBODY is in the room");
  assert.ok(house.indexOf("scene = await drawDressed(") > 0 && house.indexOf("scene = await drawDressed(") < house.indexOf("await ckpt({ ckScene: scene });"));
});

test("ACTED FILMS: the thing's portrait, a sighting and the REVEAL all go through the one look — clothed, or dropped for the next editor", () => {
  const eng = read("app", "lib", "film-dialogue.server.ts");
  // one way of doing it: the local name is a thin call of keepClothed (no look, no edit of its own), and the job says it is at work
  const fn = eng.slice(eng.indexOf("const clothedOrDropped = async (rel: string, ar: string): Promise<string | null> => {"), eng.indexOf("const sightOn = staged && horror && !cartoon && isTwoHander;"));
  assert.ok(fn.includes("const kept = await keepClothed({ url: rel, ref: (u) => abs(u) || u, edit: (u, bare) => clothedEditOn(u, bare, ar), still: \"drop\", log: (l) => console.log(`[testmovie] ${l}`) });\n    await say(alive);\n    return kept;"));
  assert.ok(!eng.includes("unclothedPrompt()") && !eng.includes("clothedEdit(seen.who)"), "no second copy of the look");
  // the thing's portrait (a cast line, or the first figure its words put in view — threatFromWords) and the sighting
  assert.ok(eng.includes("img = (await clothedOrDropped(drawn, PORTRAIT_ASPECT)) || \"\";"));
  assert.ok(eng.includes("pic = drawn ? (await clothedOrDropped(drawn, aspect)) || \"\" : \"\";"));
  // THE REVEAL: looked at before it is used; dropped → the next editor of its ladder, else the fallback it always had
  const reveal = eng.indexOf("if (!seedAbs && lastHorror && master?.url && stagingOf(master)) {");
  const look = eng.indexOf("seedAbs = drawn ? abs(await clothedOrDropped(drawn, aspect)) : undefined;", reveal);
  assert.ok(reveal > 0 && look > reveal && look < eng.indexOf("if (seedAbs) { revealed = true;", reveal));
  assert.ok(eng.includes("if (!ask || seedAbs) break;"), "a dropped reveal is drawn by the next editor");
  // the casting portrait a member draws on the page: looked at, dressed by one edit if it must be — kept either way
  const actor = eng.slice(eng.indexOf("export async function renderActorPortrait("), eng.indexOf("function actorsInScene("));
  assert.ok(actor.includes("return keepClothed({ url, ref: (u) => (u.startsWith(\"http\") ? u : `${base}${u}`), edit: (u, bare) => clothedEditOn(u, bare, \"9:16\"),") && !actor.includes("still: \"drop\""));
  // …and the storyboard's PREVIEW FRAME (the clothed stream's review): a frame the maker approves is that shot's seed as it
  // is, past the master and its look — so it is looked at where it is drawn, every path of it, and kept either way
  const frame = eng.slice(eng.indexOf("export async function renderSceneFrame("), eng.indexOf("export async function previewFilmSceneFrame("));
  assert.ok(frame.includes("try { url = await draw(); } catch { return null; }"));
  assert.ok(frame.includes("return keepClothed({ url, ref: (u) => (u.startsWith(\"http\") ? u : `${base}${u}`), edit: (u, bare) => clothedEditOn(u, bare, ar), log: (l) => console.log(`[storyboard] a preview frame: ${l}`) });") && !frame.includes("still: \"drop\""));
});

test("the storyboard says it: a scene still unclothed after its goes and its edit is flagged first, in every language", () => {
  const film = read("app", "routes", "web.film.tsx");
  const fn = film.slice(film.indexOf("const flagWhy = (i: number): string => {"), film.indexOf("// Tap a scene still to inspect it big (lightbox)."));
  // (two short words: the flag is a third of a phone-wide card — "Someone unclothed" broke as "unclothe-d" in the mock)
  const bare = fn.indexOf("if (c.unclothed === true) return t(\"Needs clothes\");");
  assert.ok(bare > 0 && bare < fn.indexOf("if (c.panels === true || c.inset === true) return t(\"Split picture\");"), "the heaviest fault, said first");
  assert.equal(read("app", "lib", "ui-i18n-dict.ts").split("\"Needs clothes\":").length - 1, 5, "es, fr, de, zh and ur");
});

test("the take's own words: a person in the water is dressed where they are said, inside the scene's prompt", async () => {
  const { takeStillPrompt } = await import("../app/lib/take.ts");
  const still = "A TEST phone light sweeps the black pond: a pale woman stands waist-deep in the water among the reeds, perfectly still, facing the camera.";
  const p = takeStillPrompt({ still: dressedInWater(still) }, "9:16");
  assert.ok(p.includes(`${still} She is fully clothed: a long pale nightgown, soaked and clinging, covering her from neck to knee.`));
});

