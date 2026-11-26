/* A NARRATED STORY'S PICTURES ARE LOOKED AT BEFORE THEY ARE SHOWN.
 *
 * Three stories made as a customer on 2026-11-22 (a horror story, a short story, a moral story — eighteen
 * stills) came back with four pictures nobody had checked: one drawn as two panels stacked, two with a
 * cast member drawn as someone else, one with a door "marked with" gibberish. Each was put right by a
 * re-roll, by hand.
 *
 * The two questions were put to the real reader on the live site with those very stills: the cast question
 * 7 of 7 (the wrong woman caught, a deliberate mismatch refused, five right pictures passed — one of them
 * seen only from behind), the panels question 5 of 5 (the split caught; a desk edge, a window, a counter
 * and a foggy street passed). One long question that asked both let the wrong woman through.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NOTHING_WRITTEN, ONE_PICTURE, noLettering, oneMoment, parseStoryCast, parseStoryPanels, storyCastPrompt, storyFaults, storyFix, storyPanelsPrompt } from "../app/lib/story-picture.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");

test("a picture's words are one moment: a description that runs on into a second is cut where it begins", () => {
  // the scene that was drawn as two panels
  assert.equal(
    oneMoment("The same wrapped loaf sits on the doorstep at first light; morning fog, no one visible, until the bundle is gone moments later, cloth left folded neatly behind."),
    "The same wrapped loaf sits on the doorstep at first light; morning fog, no one visible.",
  );
  assert.equal(oneMoment("ISLA reaches for the chained door, then the lights go out across the whole ward."), "ISLA reaches for the chained door.");
  assert.equal(oneMoment("A man waits at the bus stop in the rain and then, moments later, boards the last bus."), "A man waits at the bus stop in the rain.");
  // one moment already: untouched, word for word
  for (const one of [
    "TUNDE laughs with VALENTINA inside the bakery, both covered in flour, golden light spilling over trays of dough.",
    "KEIKO sits alone at her kitchen table at night, bills spread before her under a dim lamp.",
    "A lantern hangs over the well, older than the village itself.",
  ]) assert.equal(oneMoment(one), one);
  // what would be left is not a scene: left alone (the picture check has the last word)
  assert.equal(oneMoment("She waits, then runs."), "She waits, then runs.");
  assert.equal(oneMoment(""), "");
});

test("nothing in a picture is written: what a sign or a door SAYS is taken out of the words", () => {
  assert.equal(noLettering("ISLA stares down a corridor toward a locked ward door marked with a faded number."), "ISLA stares down a corridor toward a locked ward door.");
  assert.equal(noLettering("A shopfront with a sign reading \"CLOSED\" hangs crooked in the window."), "A shopfront with a sign hangs crooked in the window.");
  assert.equal(noLettering("An envelope labelled 'For Keiko' lies on the counter."), "An envelope lies on the counter.");
  assert.equal(noLettering("A neon sign that says \"OPEN\" flickers above the bar."), "A neon sign flickers above the bar.");
  assert.equal(noLettering("He holds up a poster, “LOST DOG”, to the passing crowd."), "He holds up a poster, to the passing crowd.");
  // the thing itself stays, and words that are not lettering are left alone
  assert.equal(noLettering("KEIKO stands outside her shuttered shop, staring at an overdue notice taped to the glass door."), "KEIKO stands outside her shuttered shop, staring at an overdue notice taped to the glass door.");
  assert.equal(noLettering("A marked trail winds through the pines."), "A marked trail winds through the pines.");
  assert.equal(noLettering("Mourning Mary's dress, it's torn at the hem."), "Mourning Mary's dress, it's torn at the hem.");
});

test("the cast question: write down each character in their own picture and in the scene, COMPARE, then answer", () => {
  const q2 = storyCastPrompt(2);
  assert.ok(q2.startsWith("The FIRST image is a picture from an illustrated story. The 2 images after it are the 2 characters who must be in it (character 1 is the 2nd image, character 2 is the 3rd image)."));
  assert.ok(storyCastPrompt(1).includes("The image after it is the one character who must be in it (character 1 is the 2nd image)."));
  assert.ok(q2.includes("first write down in a few words what identifies them in their OWN image"));
  assert.ok(q2.includes("Then COMPARE the two descriptions you wrote"));
  assert.ok(q2.includes("clothes do NOT matter, a story dresses people for the part"), "a baker in an apron is still the baker");
  assert.ok(q2.includes("Seen from behind, small in the frame or in different clothes still counts"));
  assert.ok(q2.includes("If your two descriptions differ in hair colour"));
  assert.ok(q2.endsWith(`Reply with ONLY this JSON: {"own": ["…" for each character], "inPicture": ["…" for each], "seen": [true or false for each, in order], "twice": [true if that character is drawn more than once, else false — for each, in order]}.`));
  assert.ok(!/panel/i.test(q2), "one question, one job");
  // creatures and cartoons are told apart their own way — ears included (a cartoon puppy became a fox-eared
  // dog between two scenes of a Kids Cartoon, 2026-11-22). This wording, on the real reader: 9 of 9 story
  // and music-video stills right (people, a ghost, a werewolf), and a werewolf refused as a puppy.
  assert.ok(q2.includes("for a creature or cartoon: what kind of creature, HOW IT IS BUILT (standing upright on two legs like a person, or going on four legs like an animal; a body covered in fur, scales or bare skin), its colours, the shape of its ears, its markings, and what it wears"));
  // (a werewolf drawn as an ordinary wolf, or as a man with a wolf's head, is not that werewolf — live, 2026-11-24)
  assert.ok(q2.includes("an ordinary animal on four legs is NOT an upright creature, and a human being with that creature's head — a person's body in ordinary clothes — is NOT that creature either."));
  assert.ok(q2.includes("for a PERSON clothes do NOT matter, a story dresses people for the part."));
  assert.ok(q2.includes("or, for a creature, in what kind of creature it is, in how it is built, in its colour, its ears or its markings — the answer is false"));
});

test("the FIRST complete answer is the one that is read", () => {
  // the real reader, asked whether a capybara was the puppy: it answered — rightly — and then kept writing
  const rambled = "```json\n{\"own\": [\"cartoon puppy, golden fur, one ear up one floppy, white star marking\"], \"inPicture\": [\"nobody — a cartoon capybara with a fruit on its head\"], \"seen\": [false]}\n```\n\nWait, let me re-read the prompt. Character 1 is the 2nd image.\n\n```json\n{\"own\": [\"cartoon capybara\"], \"inPicture\": [\"cartoon capybara\"], \"seen\": [true]}\n```";
  assert.deepEqual(parseStoryCast(rambled, 1), [false]);
  // braces and quotes inside the written descriptions do not end the answer early
  assert.deepEqual(parseStoryCast("{\"own\": [\"a sign that says \\\"{open}\\\"\"], \"inPicture\": [\"same } brace\"], \"seen\": [true]} and then more {\"seen\": [false]}", 1), [true]);
  assert.equal(parseStoryPanels("{\"top\": \"a } in the text\", \"panels\": true} trailing {\"panels\": false}"), true);
});

test("the panels question: describe it half by half first", () => {
  const q = storyPanelsPrompt();
  assert.ok(q.includes("describe in a few words what the TOP half shows and what the BOTTOM half shows, then what the LEFT half and the RIGHT half show"));
  assert.ok(q.includes("the same place, object or person drawn TWICE"));
  assert.ok(q.includes("A window, a mirror, a doorway, a table edge or a horizon inside one scene is NOT a split."));
  assert.ok(q.endsWith(`Reply with ONLY this JSON: {"top": "…", "bottom": "…", "left": "…", "right": "…", "panels": true or false}.`));
});

test("the answers are read whatever they are wrapped in — and an unreadable one is nothing", () => {
  // the real reader's own answers (2026-11-22)
  assert.deepEqual(parseStoryCast("```json\n{\"own\": [\"dark hair short, medium skin, young man, short beard\", \"silver-grey bob, East Asian, middle-aged\"], \"inPicture\": [\"dark hair short, beard, apron\", \"brown hair up, medium skin, middle-aged\"], \"seen\": [true, false]}\n```", 2), [true, false]);
  assert.deepEqual(parseStoryCast("{\"own\":[\"a\"],\"inPicture\":[\"a\"],\"seen\":[true]}", 1), [true]);
  assert.equal(parseStoryCast("{\"seen\":[true]}", 2), null, "an answer for fewer characters than were asked about");
  assert.equal(parseStoryCast("{\"seen\":[\"yes\",true]}", 2), null);
  assert.equal(parseStoryCast("I could not open the image.", 2), null);
  assert.equal(parseStoryCast("{\"own\": [\"silver bob\"", 1), null, "cut off mid-answer");
  assert.equal(parseStoryPanels("{\"top\": \"foggy stone path\", \"bottom\": \"same foggy stone path with a shadowy figure\", \"left\": \"wall\", \"right\": \"trees\", \"panels\": true}"), true);
  assert.equal(parseStoryPanels("{\"top\":\"lights\",\"bottom\":\"desk\",\"left\":\"wall\",\"right\":\"corridor\",\"panels\":false}"), false);
  assert.equal(parseStoryPanels("{\"panels\":\"maybe\"}"), null);
  assert.equal(parseStoryPanels(""), null);
});

test("a split picture is the worst fault, then each cast member who is not in it — and the redraw is told which", () => {
  assert.equal(storyFaults({ seen: [true, true], panels: false }), 0);
  assert.equal(storyFaults({ seen: [true, false], panels: false }), 3);
  assert.equal(storyFaults({ seen: [], panels: true }), 4);
  assert.equal(storyFaults({ seen: [false, false], panels: true }), 10);
  assert.equal(storyFix({ seen: [true, true], panels: false }, ["OMAR", "KEIKO"]), "");
  const missing = storyFix({ seen: [true, false], panels: false }, ["OMAR", "KEIKO"]);
  assert.ok(missing.includes("KEIKO was missing or drawn as someone else in the last try") && !missing.includes("OMAR"));
  assert.ok(missing.includes("EXACTLY as in their reference image: the same face, hair colour and hair"));
  assert.ok(storyFix({ seen: [], panels: true }, []).includes("split into panels — draw ONE single picture of one moment that fills the whole frame"));
  assert.ok(storyFix({ seen: [false], panels: false }, []).includes("the character in reference image 1 was missing"));
});

test("the pipeline: words tidied, picture drawn, picture looked at, drawn again when wrong — and never left bare", () => {
  const s = read("app", "lib", "narrated-story.server.ts");
  // (…and a person the words put in water is dressed in those same words — story-picture.ts → dressedInWater, 2026-11-25)
  assert.ok(s.includes("const visual = dressedInWater(oneMoment(noLettering(written)));"));
  assert.ok(s.includes("${ONE_PICTURE} ${NO_EXTRAS}${here.length ? ` ${NO_LENS}` : \"\"}${insideNote(visual) ? ` ${INSIDE_STAYS} ${DOORS_SHUT} ${TRUE_SIZE}` : \"\"}${tmpl.childSafe || tmpl.ownWorld ? ` ${DRESSED}` : ` ${TODAY_LOOK}`}${!tmpl.childSafe && shadowNote(visual) ? ` ${SHADOW_SHAPE}` : \"\"} ${STORY_SOUND} ${NOTHING_WRITTEN}`;") && !s.includes("No readable text, captions or lettering anywhere."));
  assert.ok(ONE_PICTURE.includes("never a split screen, a collage, comic panels, a before-and-after or a grid") && NOTHING_WRITTEN.includes("no signs with words, labels, notices, numbers, letters or captions"));
  // WHO is looked for: the maker's own cast in this scene — by their own pictures, never the sheet of invented characters
  assert.ok(s.includes("const castPics = here.map((c) => abs(c.faceUrl)).filter((u): u is string => !!u);"));
  assert.ok(s.includes("anthropicVision(storyCastPrompt(castPics.length), [pic, ...castPics], { maxTokens: 500, model: \"claude-sonnet-4-6\" })"));
  // panels are looked for only where the words described two moments
  assert.ok(s.includes("const twoMoments = oneMoment(written) !== written;") && s.includes("twoMoments ? anthropicVision(storyPanelsPrompt(), [pic], { maxTokens: 320, model: \"claude-sonnet-4-6\" })"));
  // (every picture is looked at now — at least for anybody its words do not put there: an empty room at night came
  //  back with a grown man at a screen in it; storyExtrasPrompt)
  // (…its answer a line longer since 2026-11-25: it also says whether anybody is unclothed — UNCLOTHED_ASKED)
  // (…and longer again since 2026-11-26: every face and where its eyes point — EYES_FIRST. 600 could cut a crowd's answer
  //  off, and a cut-off answer loses its unclothed and stranger answers with it — so it has room for 900)
  assert.ok(s.includes("if (!pic) return null;") && s.includes("anthropicVision(storyExtrasPrompt(visual, whoIsWho), [pic], { maxTokens: 900, model: \"claude-sonnet-4-6\" }).catch(() => \"\"),"), "every picture is looked at for strangers");
  // a look that fails or says nothing keeps the picture
  // (…a night scene's sky is one more answer since 2026-11-25: tests/told-night.test.ts)
  assert.ok(s.includes("if (seen == null && panels == null && extra == null && outside == null && lens == null && grimy == null && inset == null && bare == null && dark == null) return null;") && s.includes("const faults = seenAs ? storyFaults(seenAs) : 0;"));
  // wrong → drawn again with the fault named; the best of three goes is kept
  assert.ok(s.includes("fix = storyFix(seenAs!, here.map((c) => c.name), here.map((c) => c.kind || \"person\"));") && s.includes("const got = await drawScene(`${first}${promptOf(withPlace)}${fix}`, withPlace ? refs : people, aspect);"));
  // (…and a best-of that is still wrong SAYS so: the storyboard flags that scene — tests/story-cast.test.ts)
  assert.ok(s.includes("if (!best || faults < best.faults) best = { img: got, faults, check: seenAs! };") && s.includes("if (!img && best) { img = best.img; faultsOut[i] = best.faults; checksOut[i] = { ...best.check, who: here.map((c) => c.name) }; }"));
  // (…the letterboxed one LOOKED at for anybody unclothed since the review of S8, 2026-11-25: tests/clothed.test.ts)
  assert.ok(s.indexOf("if (!img && best) { img = best.img;") < s.indexOf("if (!img && barred) img = await keepClothed({ url: barred,"), "a looked-at picture is preferred to a letterboxed one");
  // …and the writer is told the same three things
  const w = read("app", "lib", "film-engine.server.ts");
  assert.ok(w.includes("It is ONE moment only — a picture cannot show two times") && w.includes("at most ONE other person") && w.includes("nothing in it is WRITTEN"));
});

test("a horror cast does not grin: the format's own line reaches the narrated pictures and the acted two-shot", () => {
  const engine = read("app", "lib", "film-engine.server.ts");
  assert.ok(engine.includes("faceMood: \"Every living person in it looks tense, wary or afraid — nobody smiles, grins or laughs.\","));
  // only horror has a say (a kids' cartoon, a moral story and a short film keep whatever the scene calls for)
  assert.equal(engine.split("\n    faceMood: ").length - 1, 1);
  // (the camera line takes the frame's shape since 2026-11-26 — story-shots.ts → frameShapeLine; tests/full-frame.test.ts)
  assert.ok(read("app", "lib", "narrated-story.server.ts").includes("Style: ${tmpl.sceneHint}.${tmpl.faceMood ? ` ${tmpl.faceMood}` : \"\"}${cam ? ` ${cameraLine(cam, aspect)}` : \"\"} ${[...notes, ...(withPlace ? placeNotes : [])].join(\" \")}"));
  // (…the film's THING by its own picture rides after it since 2026-11-25 — tests/acted-sighting.test.ts — and the
  //  genre's own world after that: tests/clothed.test.ts)
  assert.ok(read("app", "lib", "film-dialogue.server.ts").includes("action, mood: tmpl.faceMood, setting: nightSetting(cleanSetting(where), opts.topic, action), style: twoStyle, aspect, thing: thingIn && threat ? { url: abs(threat.img) || threat.img, name: threat.name, look: threat.look } : null, ownWorld: tmpl.ownWorld }));"));
  const img = read("app", "lib", "image-generation.server.ts");
  assert.ok(img.includes("const mood = (opts.mood || \"\").replace(/\\s+/g, \" \").trim().slice(0, 160);"));
  assert.ok(img.includes("${moment}${mood ? ` ${mood}` : \"\"} ${consistencyNote}"));
});
