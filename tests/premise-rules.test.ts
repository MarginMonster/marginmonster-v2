/* WHAT THE MEMBER WROTE IS THE STORY (premise-rules.ts) — a tester's day of making one of everything, 2026-11-24:
 * "Horror story still need betterment they not pick what we ask to create exactly"; "Horror Film need more work bro
 * they not exact follow command what we tell". His two children came back as two adults, his boy as a grown man
 * with a werewolf beside him in a lit bedroom, and his Short Story's idea reached the writer cut off mid-word. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CHILDREN_STAY, HORROR_SAFETY, IDEA_CHECK, IDEA_MAX, PREMISE_WINS, STORY_SAFETY, chosenThreat } from "../app/lib/premise-rules.ts";
import { STORY_SHOTS } from "../app/lib/story-shots.ts";

const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), "utf8");

test("children stay children — and a child in a frightening story is never hurt", () => {
  // the rule that turned them into grown-ups is gone from every safety line
  for (const line of [HORROR_SAFETY, STORY_SAFETY]) {
    assert.ok(line.includes(CHILDREN_STAY), "both say it the same way");
    assert.ok(!/recast|CAST ONLY ADULTS|is an ADULT/i.test(line), line.slice(0, 80));
  }
  assert.ok(CHILDREN_STAY.includes("never a teenager, never a grown-up"));
  // …what may happen to a child is limited instead
  assert.ok(CHILDREN_STAY.includes("NEVER HURT") && CHILDREN_STAY.includes("Nothing grabs, touches, wounds, takes or kills a child"));
  assert.ok(CHILDREN_STAY.includes("the threat is never close to one: it is outside a window or a door, at the far end of a hall, deep in the dark, or only heard"));
  assert.ok(CHILDREN_STAY.includes("no blood, no violence and nothing graphic"));
  // a story with no child in it still has grown-ups, and a grown-up horror may still be bloody
  assert.ok(CHILDREN_STAY.endsWith("When the idea has no child in it, its people are grown-ups."));
  assert.ok(HORROR_SAFETY.includes("When everybody in it is a grown-up, violence, death, blood and disturbing imagery are fine"));
  assert.ok(HORROR_SAFETY.includes("no gratuitous, lingering torture or graphic mutilation"));
});

test("the idea is the story: its people, its place, its events in order, and its threat as it says", () => {
  for (const said of ["two children stay two children, a boy stays a boy", "a house stays a house, a bedroom stays a bedroom", "The SAME EVENTS, in the SAME ORDER", "\"a dark shadow\" stays a shadow, \"a ghost lady\" stays a ghost woman", "never turned into a werewolf, a demon, a monster or anything it did not name", "THE IDEA WINS (the safety limits at the very end still hold)"]) {
    assert.ok(PREMISE_WINS.includes(said), said);
  }
  // THE FIRST LIVE PREVIEWS with these rules (2026-11-24): the two children stayed children — but "they locked
  // the door" came back "locked the door in her mind", the mother "away from home" was turned into the woman on
  // the porch by a twist, and the film's boy never ran to his parents' room
  assert.ok(PREMISE_WINS.includes("when the idea MOVES them (\"he ran to his parents' room\"), the story moves there too"));
  assert.ok(PREMISE_WINS.includes("for real, never as a figure of speech (\"they locked the door\" is a door being locked)"));
  assert.ok(PREMISE_WINS.includes("a twist may come only AFTER its last event, and never undoes or contradicts anything it said (\"their mom is away from home\" stays away)"));
  // an idea is a paragraph, not a line (a tester's came to the writer ending "…the roots of a big tr")
  assert.equal(IDEA_MAX, 1200);
});

test("a creature the maker chose plays the idea's threat — in an acted film it is the THING, not one of the two", () => {
  assert.equal(chosenThreat([], true), "");
  const acted = chosenThreat(["Howl"], true);
  assert.ok(acted.includes("Howl IS that threat, and NOT one of the two who talk"));
  assert.ok(acted.includes("Howl has no \"cast\" entry") && acted.includes("SEEN only in the last shot"));
  assert.ok(acted.includes("Only when the idea itself has Howl talking with somebody face to face it is one of the two."));
  const told = chosenThreat(["Howl"], false);
  assert.ok(told.includes("Howl IS that threat and it is seen only the way the idea sees it"));
  assert.ok(!told.includes("cast\" entry"), "a told story keeps every chosen character in its cast");
  assert.ok(chosenThreat(["Howl", "Mara"], true).includes("THE CHOSEN CREATURES (Howl and Mara)"));
});

test("the writer is given all of it — the idea's rules right after the idea, and the idea whole", () => {
  const eng = read("app", "lib", "film-engine.server.ts");
  assert.ok(eng.includes("import { HORROR_SAFETY, IDEA_CHECK, IDEA_MAX, PREMISE_WINS, STORY_SAFETY, chosenThreat } from \"./premise-rules\";"));
  assert.ok(eng.includes("\"${topic.slice(0, IDEA_MAX)}\". Tell EXACTLY this") && eng.includes("${storyFormat ? `${PREMISE_WINS}\\n` : \"\"}"), "said right after the idea, in every story format");
  assert.ok(eng.includes("    ? HORROR_SAFETY\n    : STORY_SAFETY;") || eng.includes("    ? HORROR_SAFETY\r\n    : STORY_SAFETY;"));
  assert.ok(!eng.includes("CAST ONLY ADULTS") && !eng.includes("recast any such role as an adult"));
  // a chosen creature in a horror idea: by its look; an acted film's two are then the idea's own people
  assert.ok(eng.includes("const threatNames = tmpl.key === \"horror\" ? picked.filter((c) => c.kind === \"monster\" || (!c.kind && keepGuess(c.desc).kind === \"monster\")).map((c) => c.name) : [];"));
  // WHAT IT IS RIDES ALONG from the page (the third live preview: the werewolf's film look, "a huge, lean werewolf
  // that…", was guessed a person — cut at its comma — and kept in the cast)
  assert.ok(eng.includes("kind: c?.kind === \"monster\" || c?.kind === \"cartoon\" ? c.kind : undefined"));
  const film = read("app", "routes", "web.film.tsx");
  assert.equal(film.split("cast: storyCast.map((c) => ({ name: c.name, desc: c.look, kind: c.kind }))").length - 1, 2, "the free write and the one-press story");
  assert.ok(read("app", "lib", "narrated-story.server.ts").includes("cast: (opts.cast || []).map((c) => ({ name: c.name, desc: c.look, kind: c.kind }))"));
  // A TOLD story keeps the creature in its cast (seen only the way the idea sees it)…
  assert.ok(eng.includes("${noSlop}${actedThreat ? \"\" : chosenThreat(threatNames, acted)}`"));
  // …an ACTED film is given only the chosen PEOPLE as its cast (none: it invents the two, as any acted film does),
  // and the creature after it as THE THREAT — told both at once, the second live preview kept the werewolf in "cast"
  assert.ok(eng.includes("const castChosen = actedThreat ? picked.filter((c) => !threatNames.includes(c.name)) : picked;"));
  assert.ok(eng.includes("const pickedLine = castChosen.length") && eng.includes("    castLine +\n    threatBrief +\n") || eng.includes("    castLine +\r\n    threatBrief +\r\n"));
  assert.ok(eng.includes("? `\\nTHE THREAT — chosen by the maker: ${picked.filter((c) => threatNames.includes(c.name))"));
  // …and whatever "cast" comes back is held to it: the threat is taken out, so it never stands in every shot
  assert.ok(eng.includes("const kept = cast.filter((e) => !threatNames.some((n) => named(e) === n.trim().toLowerCase()));") && eng.includes("cast.splice(0, cast.length, ...kept);"));
  // THE IDEA IS CHECKED LAST OF ALL (the second live preview still ended on the away-mother "never left")
  assert.ok(IDEA_CHECK.startsWith("LAST, BEFORE YOU ANSWER: read your story against the idea once more") && IDEA_CHECK.includes("nothing it said made untrue by your ending"));
  assert.ok(eng.includes("(storyFormat && topic ? `\\n${IDEA_CHECK}` : \"\");"));
  assert.ok(eng.includes("a twist that leaves every fact of the idea TRUE"));
  // an acted film goes where the idea goes
  assert.ok(eng.includes("but when the IDEA moves them (\"he ran to his parents' room\"), that IS such a move: the shots that come after it are in the new place."));
  // the Movie Maker sends the whole idea
  const page = read("app", "routes", "web.film.tsx");
  assert.ok(page.includes("const topic = ((form.get(\"filmTopic\") as string) || \"\").trim().slice(0, IDEA_MAX);"));
  assert.equal(page.split("maxLength={IDEA_MAX}").length - 1, 2, "both idea boxes");
});

test("a told story's detail shot shows ONE person's hands — two people's hands on one thing melt together", () => {
  const detail = STORY_SHOTS.detail;
  assert.ok(detail.write.includes("ONE person's hand (or their two hands)") && detail.write.includes("Never two people's hands together on one thing"));
  assert.ok(detail.camera.includes("at most one person's hands"));
});

/* ROUND FIVE — the first finished Horror Story made from the tester's idea on the new rules (2026-11-24): the idea
 * kept, the pictures sharp — but its opening shot ("the house sits alone at dusk") had a man walking up to the house,
 * the little brother was drawn OUTSIDE on the porch while his sister locked the door, and in the last picture he sat
 * on the sofa AND stood on the porch. And the acted film's last shot never showed the werewolf the maker chose. */
test("a story picture has nobody the words do not put there, and everybody in it ONCE", async () => {
  const sp = await import("../app/lib/story-picture.ts");
  assert.ok(sp.NO_EXTRAS.includes("no passer-by, no figure in the distance, no one at a window or a door") && sp.NO_EXTRAS.includes("appears exactly ONCE"));
  assert.ok(read("app", "lib", "narrated-story.server.ts").includes("${ONE_PICTURE} ${NO_EXTRAS} ${NOTHING_WRITTEN}`;"));
  // the look asks who is drawn twice — and an answer that does not say means nobody
  assert.ok(sp.storyCastPrompt(2).includes("look across the WHOLE first image for a second copy of them"));
  assert.deepEqual(sp.parseStoryTwice('{"seen":[true,true],"twice":[false,true]}', 2), [false, true]);
  assert.equal(sp.parseStoryTwice('{"seen":[true,true]}', 2), null);
  assert.equal(sp.parseStoryTwice('{"twice":[true]}', 2), null, "one answer for two is no answer");
  // a character drawn twice is a fault like a missing one — and is told so on the next go
  assert.equal(sp.storyFaults({ seen: [true, true], panels: false, twice: [false, true] }), 3);
  assert.equal(sp.storyFaults({ seen: [true, false], panels: false, twice: [false, true] }), 3, "missing is not ALSO twice");
  assert.equal(sp.storyFaults({ seen: [true, true], panels: false }), 0, "an older reading: nothing more");
  assert.ok(sp.storyFix({ seen: [true, true], panels: false, twice: [false, true] }, ["Nessa", "Dovey"]).includes("Dovey was drawn TWICE in the last try — they appear exactly ONCE in this picture, nowhere else in it"));
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("const twice = castPics.length ? parseStoryTwice(String(castRaw || \"\"), castPics.length) : null;") && nar.includes("panels: panels === true, ...(twice ? { twice } : {}) };"));
});

test("a told story's picture says which side of a door or a window everybody is on", () => {
  assert.ok(read("app", "lib", "film-engine.server.ts").includes("When a door or a window is in the picture, say which SIDE of it each person is on"));
});

test("an acted film's chosen threat is SEEN at the end, whatever the writer's last shot said", () => {
  const eng = read("app", "lib", "film-engine.server.ts");
  assert.ok(eng.includes("if (!threatNames.some((n) => said.toLowerCase().includes(n.trim().toLowerCase()))) {"));
  assert.ok(eng.includes("visual: `${said.replace(/[\\s.;,]+$/, \"\")}; in the dark behind them, ${threatNames[0]} is there — a tall shape, only its face in the light`"));
  // …after the cast is held to the two, and before the film draws it from its own picture (film-dialogue → thing)
  assert.ok(eng.indexOf("cast.splice(0, cast.length, ...kept);") < eng.indexOf("in the dark behind them, ${threatNames[0]} is there"));
});
