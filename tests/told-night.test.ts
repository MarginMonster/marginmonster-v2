/* NIGHT IS NIGHT IN A TOLD STORY TOO.
 *
 * 2026-11-25, "Mystery Story — Eleven Went Aboard", the first long told story (13 scenes, two minutes): its idea said "A
 * night ferry crosses a foggy harbour…" and every one of its pictures was pale misty daylight. The acted film's master had
 * had a night look since that morning (story-picture.ts → NIGHT_SAID, nightLookPrompt, NIGHT_FIRST; image-generation →
 * renderSideBySideTwoShot); a told story's pictures had none. Now a told scene that is at night is told so in its picture's
 * words (the acted master's NIGHT_LINE), its sky is looked at in the question that already looks at the place, and a sky
 * that reads as dusk or day is drawn again with NIGHT_FIRST said first. When a scene is at night is the acted engine's own
 * rule (acted-staging.ts → nightSetting), not a second one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as sp from "../app/lib/story-picture.ts";
import { NIGHT_LINE, nightSetting } from "../app/lib/acted-staging.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

// the ferry story, as its writer would write it (made-up names; the idea is the live story's own first sentence)
const FERRY = "A night ferry crosses a foggy harbour with eleven passengers aboard. When it docks at the far pier, only ten step off.";
const PLACE = "the ferry: an old low black wooden ferry with a glass wheelhouse, brass deck lamps and a long rail of worn rope";
const night = (words: string, said = "", o: { idea?: string; place?: string; childSafe?: boolean; cartoon?: boolean } = {}) =>
  sp.storyNight({ words, said, place: o.place ?? PLACE, idea: o.idea ?? FERRY, childSafe: o.childSafe, cartoon: o.cartoon }, nightSetting);

test("WHEN: the night ferry's scenes are at night wherever their own words name no other time of day", () => {
  // the scenes that were drawn in pale misty daylight: their words say no time at all — the idea says night
  for (const [words, said] of [
    ["WIDE: The old ferry slides out from the pier into thick fog, its deck lamps glowing, eleven passengers huddled at the rail.", "Eleven people went aboard the last ferry out."],
    ["CLOSE: Inspector Tamsin Vale counts heads by the wheelhouse door, her breath clouding.", "Vale counted them twice."],
    ["A DETAIL: an empty bench on the deck with a wet umbrella lying across it.", "Somebody had sat there."],
    ["OVER THE SHOULDER: from behind Vale, the dark water slides past the hull.", ""],
  ]) assert.equal(night(words, said), true, words);
  // …a day scene in the night idea that names its morning stays day — in its picture's words, or in its narration
  assert.equal(night("WIDE: The ferry noses into the far pier at dawn; ten passengers file down the gangway.", "Ten came off."), false);
  assert.equal(night("Vale grips the rail and stares at the empty bench.", "By morning the fog had lifted."), false);
  // …and a night that is not THIS scene's is not its time: the morning after stays the morning
  assert.equal(night("The next morning, Vale stands on the empty deck where the eleventh passenger stood last night.", "Nobody remembered the eleventh."), false);
  assert.equal(night("Vale reads the ticket stubs from the night before at her desk.", "", { idea: "A detective counts ticket stubs." }), false, "no night of its own, no night idea");
});

test("WHEN: its own words, its narration or its place say night — whatever the idea says", () => {
  const day = "Two old friends open a bakery on the corner.";
  assert.equal(night("Mira locks the bakery door at midnight, the street empty.", "", { idea: day }), true);
  assert.equal(night("Mira looks up at the moonlit sky above the bakery.", "", { idea: day }), true);
  assert.equal(night("Mira wipes down the counter.", "At 2am, the bell over the door rang.", { idea: day }), true, "the narration says it, the picture names no time");
  assert.equal(night("Mira wipes down the counter in the afternoon light.", "That night she would not sleep.", { idea: day }), false, "the picture's own words win");
  assert.equal(night("Mira hurries between the stalls.", "", { idea: day, place: "the night market: rows of canvas stalls strung with bare bulbs" }), true, "the place it is set at");
  assert.equal(night("Mira hurries between the stalls in the late afternoon sun.", "", { idea: day, place: "the night market: rows of canvas stalls" }), false);
  // words that name a day time AS WELL are left to their words: the look never calls a dawn sky a fault
  assert.equal(night("As dusk turns to night, the ferry pulls away.", "", { idea: day }), false);
  // a job named for the night is a person, not the hour
  assert.equal(night("Walter the night watchman sweeps the step.", "", { idea: "An old night watchman leaves bread out for a stray dog." }), false);
  // no idea handed in (a storyboard that has not sent it yet): only the scene's own words and its place
  assert.equal(sp.storyNight({ words: "Vale grips the rail." }, nightSetting), false);
  assert.equal(sp.storyNight({ words: "Vale grips the rail at midnight." }, nightSetting), true);
});

test("WHEN is the acted engine's own rule, handed in — never a second one", () => {
  // the idea's verdict IS nightSetting's, for words that name no time of their own
  for (const [words, idea] of [
    ["inside the tent", "Two friends camping by a quiet lake wake at 3am to someone calling their names."],
    ["inside the tent", "Two friends go camping by a quiet lake."],
    ["the campsite", "They hear a voice after dark."],
    ["the kitchen", ""],
  ]) assert.equal(sp.storyNight({ words, idea, place: "" }, nightSetting), nightSetting(words, idea) !== words, `${words} / ${idea}`);
  // …and it is the rule that is asked: a rule that never says night makes no scene night by its idea
  assert.equal(sp.storyNight({ words: "the deck", idea: FERRY }, (s) => s), false);
  // story-picture.ts never imports acted-staging.ts (which imports it): the rule is handed in
  const src = read("app", "lib", "story-picture.ts");
  assert.ok(!src.includes('from "./acted-staging') && src.includes("export type NightRule = (setting: string, idea: string | null | undefined, shot?: string | null) => string;"));
});

test("NEVER IN A CHILDREN'S STORY'S DAYTIME, NEVER IN A CARTOON UNLESS THE STORY SAYS NIGHT", () => {
  const picnic = "Pip the bunny has a moonlit picnic with her friends.";
  // the idea alone never darkens a children's picture or a cartoon's
  assert.equal(night("Pip spreads a red blanket on the hill.", "", { idea: picnic, place: "", childSafe: true, cartoon: true }), false);
  assert.equal(night("Pip spreads a red blanket on the hill.", "", { idea: picnic, place: "", cartoon: true }), false);
  // …the scene itself saying night does
  assert.equal(night("Under the moonlit sky, Pip spreads a red blanket on the hill.", "", { idea: picnic, place: "", childSafe: true, cartoon: true }), true);
  assert.equal(night("Pip spreads a red blanket on the hill.", "That night, the stars came out to watch.", { idea: picnic, place: "", childSafe: true, cartoon: true }), true);
  // …and a children's day stays day
  assert.equal(night("Pip waves goodbye in the sunny morning.", "", { idea: picnic, place: "", childSafe: true, cartoon: true }), false);
  // a grown-up story of any genre — Fantasy's own world too — is told its idea's night (only childSafe and cartoon are asked)
  assert.equal(night("Wren lifts the lantern in the timber hall.", "", { idea: "A night raid on the old king's hall.", place: "" }), true);
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("childSafe: tmpl.childSafe, cartoon: tmpl.cartoon }, nightSetting);"));
});

test("THE LOOK: asked last in the question that looks at the place — a day scene's question word for word as it was", () => {
  const v = "WIDE: The old ferry slides out from the pier into thick fog, its deck lamps glowing.";
  const day = sp.storyGrimePrompt(v);
  const dark = sp.storyGrimePrompt(v, true);
  assert.equal(sp.storyGrimePrompt(v, false), day);
  assert.ok(!day.includes("MIDDLE OF THE NIGHT") && !day.includes('"sky"'));
  assert.ok(day.endsWith('{"place": "…", "grimy": true or false, "corners": "what is in each corner, in a few words", "inset": true or false}.'));
  // the night question is the day one with NIGHT_ASKED before the reply, and two more fields — nothing else moved
  assert.equal(dark.replace(` ${sp.NIGHT_ASKED}`, "").replace(', "outdoors": "how the sky and the outdoors are lit, in a few words", "sky": "night" or "dusk" or "day"', ""), day);
  assert.ok(dark.indexOf(sp.NIGHT_ASKED) > dark.indexOf("is NOT an inset.") && dark.indexOf(sp.NIGHT_ASKED) < dark.indexOf("Reply with ONLY this JSON"));
  assert.ok(dark.endsWith('"inset": true or false, "outdoors": "how the sky and the outdoors are lit, in a few words", "sky": "night" or "dusk" or "day"}.'));
  // the master's own question (nightLookPrompt), in its words — and the ferry's daylight, and a drawn night, named
  for (const part of ["MIDDLE OF THE NIGHT", "seen through a window, a door or a tent opening", "a black or near-black sky", "the outdoors dark except for lamps, torches or the moon", "dusk, twilight, blue hour, an overcast evening, pale misty daylight or day", 'If no sky and nothing outdoors can be seen at all, "sky" is "night".']) assert.ok(sp.NIGHT_ASKED.includes(part), part);
  for (const part of ["MIDDLE OF THE NIGHT", "seen through a window, a door or a tent opening", "a black or near-black sky", "If no sky and nothing outdoors can be seen at all"]) assert.ok(sp.nightLookPrompt().includes(part), `the master asks it the same way: ${part}`);
  assert.ok(sp.NIGHT_ASKED.includes("fog, if there is any, dark except where a lamp lights it") && sp.NIGHT_ASKED.includes("fog pale with daylight"), "fog lit by a lamp is night; fog lit by day is not");
  assert.ok(sp.NIGHT_ASKED.includes("(in a drawn picture, a deep night-blue one with the moon or stars)"));
});

test("THE ANSWER: only a clear dusk or day is the fault — an answer that cannot be read is night", () => {
  assert.equal(sp.parseStoryNight('{"place":"a ferry deck, wet planks","grimy":false,"corners":"fog, rail, lamp, bench","inset":false,"outdoors":"pale grey fog lit evenly by daylight","sky":"day"}'), false);
  assert.equal(sp.parseStoryNight('{"sky": "dusk"}'), false);
  assert.equal(sp.parseStoryNight('{"sky":" Day "}'), false);
  assert.equal(sp.parseStoryNight('{"outdoors":"black sky, fog lit only round the deck lamps","sky":"night"}'), true);
  // the FIRST complete answer is the one read (a reader that answers, then keeps writing)
  assert.equal(sp.parseStoryNight('{"sky":"night"} and on second thought {"sky":"day"}'), true);
  // nothing said → null, and the caller takes it as night (no fault)
  for (const junk of ["", "no idea", '{"grimy":false,"inset":false}', '{"sky": 3}', "{broken"]) assert.equal(sp.parseStoryNight(junk), null, junk);
});

test("THE FAULT: under the clothed one, over the cosmetic ones — and NIGHT_FIRST said first on the next go", () => {
  const nightOnly = { seen: [true], panels: false, notNight: true };
  assert.equal(sp.NOT_NIGHT_FAULT, 3);
  assert.equal(sp.storyFaults(nightOnly), 3);
  // over a stare or a run-down room; the same as somebody missing or a stranger; under a split picture that cannot be used
  assert.ok(sp.storyFaults(nightOnly) > sp.storyFaults({ seen: [true], panels: false, lens: ["Vale"] }));
  assert.ok(sp.storyFaults(nightOnly) > sp.storyFaults({ seen: [true], panels: false, grimy: true }));
  assert.equal(sp.storyFaults(nightOnly), sp.storyFaults({ seen: [true], panels: false, extra: true }));
  assert.ok(sp.storyFaults(nightOnly) < sp.storyFaults({ seen: [true], panels: true }) && sp.storyFaults(nightOnly) < sp.storyFaults({ seen: [true], panels: false, inset: true }));
  // a dressed day picture — with every other fault there is — is kept before an undressed night one
  const everything = { seen: [false, false, false], panels: true, extra: true, outside: true, lens: ["Vale"], grimy: true, inset: true, notNight: true };
  assert.ok(sp.storyFaults({ seen: [true], panels: false, unclothed: true }) > sp.storyFaults(everything));
  // the best of the goes is the night one when the faults are otherwise the same
  assert.ok(sp.storyFaults({ seen: [true], panels: false, lens: ["Vale"] }) < sp.storyFaults({ seen: [true], panels: false, lens: ["Vale"], notNight: true }));
  // the fix: the master's own redraw line, said FIRST — after the clothes, which weigh more
  assert.equal(sp.storyFirst(nightOnly), `${sp.NIGHT_FIRST} `);
  assert.equal(sp.storyFirst({ seen: [true], panels: false, notNight: true, unclothed: true }), `${sp.CLOTHED_FIRST} ${sp.NIGHT_FIRST} `);
  assert.equal(sp.storyFirst({ seen: [true], panels: false }), "");
  assert.equal(sp.storyFix(nightOnly, ["Vale"]), "", "nothing more at the end: said first is what works");
  // a picture KEPT still drawn as day is written down for the operator
  assert.deepEqual(sp.keptFaults([{ ...nightOnly, who: ["Vale"] }, { seen: [true], panels: false, who: ["Vale"] }]), [{ scene: 1, missing: [], notNight: true }]);
});

test("THE WORDS: a night scene's picture is told the night right behind its words, from its first go", () => {
  // the acted master's sentence, word for word
  assert.ok(NIGHT_LINE.startsWith("It is the middle of the night: the sky outside is black") && NIGHT_LINE.includes("never dusk, twilight or a blue evening glow"));
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("const promptOf = (withPlace: boolean): string => `${safe}${visual.slice(0, 600)}${/[.!?]$/.test(visual) ? \"\" : \".\"}${night ? ` ${NIGHT_LINE}` : \"\"} Style: ${tmpl.sceneHint}."));
  // the lenient last path: said FIRST (its prompt is cut at 500 characters — the night must not be what is cut)
  assert.ok(nar.includes("renderCreativeSeed(`${safe}${night ? `${NIGHT_LINE} ` : \"\"}${dressedInWater((scene.visual || \"\").slice(0, 300))}. ${tmpl.sceneHint}`, aspect);"));
});

test("WIRING: decided once a scene, from its words, its narration, its place and the idea; looked at in the place question; the idea reaches every draw", () => {
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes('import { NIGHT_LINE, nightSetting } from "./acted-staging";') && nar.includes('import { parseStoryNight, storyNight } from "./story-picture";'));
  // the idea: the maker's, and the starter the story was written from when theirs was too short
  assert.ok(nar.includes("idea?: string | null;") && nar.includes('const idea = `${o.idea || ""} ${o.treatment.nudge || ""}`.trim();'));
  const fn = nar.slice(nar.indexOf("export async function narratedSceneSeeds("), nar.indexOf("/** DRAW ONE CHARACTER AGAIN."));
  const decided = fn.indexOf("const night = storyNight({ words: visual, said: scene.caption, place: setAt ? `${setAt.name}: ${setAt.look}` : \"\", idea, childSafe: tmpl.childSafe, cartoon: tmpl.cartoon }, nightSetting);");
  assert.ok(decided > fn.indexOf("const visual = dressedInWater(oneMoment(noLettering(written)));") && decided < fn.indexOf("const promptOf = "), "from the words the picture is drawn from, before the prompt");
  // looked at in the question that already looks at the place — still four questions to a picture, never a fifth
  assert.ok(fn.includes("anthropicVision(storyGrimePrompt(visual, night), [pic], { maxTokens: night ? 420 : 360, model: \"claude-sonnet-4-6\" }).catch(() => \"\"),"));
  assert.equal((nar.match(/anthropicVision\(/g) || []).length, 4);
  assert.ok(fn.includes("const dark = night ? parseStoryNight(String(grimeRaw || \"\")) : null;"));
  assert.ok(fn.includes("&& bare == null && dark == null) return null;") && fn.includes("...(dark === false ? { notNight: true } : {}),"), "only a clear dusk or day is the fault");
  // the next go is told FIRST (storyFirst), and the log says why it was drawn again
  assert.ok(fn.includes("first = storyFirst(seenAs);") && fn.includes('seenAs!.notNight ? "a night scene drawn as dusk or day" : ""'));
  // the best of the goes is kept, as always — never a story lost to the look
  assert.ok(fn.includes("if (!img && best) { img = best.img; faultsOut[i] = best.faults; checksOut[i] = { ...best.check, who: here.map((c) => c.name) }; }"));
  // the idea reaches the render's own drawing and a character drawn again
  assert.ok(nar.includes("beat: () => ckpt({ ckBeat: Date.now() }), idea: opts.topic });"));
  assert.ok(nar.includes("only: scenes, castRef: castToken(kept, carried.places) || null, idea: o.idea });"));
  // the acted master's own night look is untouched
  const img = read("app", "lib", "image-generation.server.ts");
  assert.ok(img.includes("if (!cartoon && NIGHT_SAID.test(`${setting} ${action}`)) {") && img.includes("storyPictureInput(used, { prompt: `${NIGHT_FIRST} ${staged || prompt}`, refs, aspect: ar })"));
});
