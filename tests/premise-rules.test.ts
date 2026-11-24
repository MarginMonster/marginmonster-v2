/* WHAT THE MEMBER WROTE IS THE STORY (premise-rules.ts) — a tester's day of making one of everything, 2026-11-24:
 * "Horror story still need betterment they not pick what we ask to create exactly"; "Horror Film need more work bro
 * they not exact follow command what we tell". His two children came back as two adults, his boy as a grown man
 * with a werewolf beside him in a lit bedroom, and his Short Story's idea reached the writer cut off mid-word. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CHILDREN_STAY, HORROR_SAFETY, IDEA_MAX, PREMISE_WINS, STORY_SAFETY, chosenThreat } from "../app/lib/premise-rules.ts";
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
  assert.ok(eng.includes("import { HORROR_SAFETY, IDEA_MAX, PREMISE_WINS, STORY_SAFETY, chosenThreat } from \"./premise-rules\";"));
  assert.ok(eng.includes("\"${topic.slice(0, IDEA_MAX)}\". Tell EXACTLY this") && eng.includes("${storyFormat ? `${PREMISE_WINS}\\n` : \"\"}"), "said right after the idea, in every story format");
  assert.ok(eng.includes("    ? HORROR_SAFETY\n    : STORY_SAFETY;") || eng.includes("    ? HORROR_SAFETY\r\n    : STORY_SAFETY;"));
  assert.ok(!eng.includes("CAST ONLY ADULTS") && !eng.includes("recast any such role as an adult"));
  // a chosen creature in a horror idea: by its look; an acted film's two are then the idea's own people
  assert.ok(eng.includes("const threatNames = tmpl.key === \"horror\" ? picked.filter((c) => keepGuess(c.desc).kind === \"monster\").map((c) => c.name) : [];"));
  assert.ok(eng.includes("${noSlop}${chosenThreat(threatNames, acted)}`"));
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
