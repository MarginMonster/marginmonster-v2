/* A cast member who is not a person, in an ACTED film. The dialogue engine's picture prompts were
 * written for people ("the same face, the same hair, skin tone, apparent age"), which is how a werewolf
 * comes back as a hairy man. These pin the character-aware forms and that the engine actually uses them. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { MIXED_CAST_LOCK, characterInRef, nameTok } from "../app/lib/character-prompts.ts";

const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("a name is keyed by its first word that is not 'the'", () => {
  assert.equal(nameTok("The Ganve"), "ganve");
  assert.equal(nameTok("GANVE"), "ganve", "the script's speaker label finds the same cast member");
  assert.equal(nameTok("THE GANVE"), "ganve");
  assert.equal(nameTok("Howl"), "howl");
  assert.equal(nameTok("Mourning Mary, a ghostly bride"), "mourning");
  assert.equal(nameTok("The"), "the", "a name that is only 'The' is still a name");
  assert.equal(nameTok("An Nguyen"), "an", "'An' is a name, not an article to skip");
  assert.equal(nameTok(""), "");
  assert.equal(nameTok(null), "");
});

test("a creature is bound to its picture as a creature — never by face, hair and age", () => {
  const s = characterInRef("Howl", 2, "a huge werewolf with shaggy dark-grey fur");
  assert.ok(s.startsWith("Howl — EXACTLY the character in reference image 2 (a huge werewolf with shaggy dark-grey fur)"));
  assert.ok(/NOT a human being/.test(s) && /no human face/.test(s));
  assert.ok(!/apparent age|skin tone|hairstyle/i.test(s), "none of the words that make a monster a man");
  assert.ok(/creature stays a creature/.test(MIXED_CAST_LOCK) && /never given a human face/.test(MIXED_CAST_LOCK));
  assert.ok(/real person stays the exact same individual/.test(MIXED_CAST_LOCK), "and the people beside it are still locked");
});

test("the dialogue engine treats a cartoon or monster cast member as what it is", () => {
  const eng = read("app/lib/film-dialogue.server.ts");
  // its look is what it was designed as, or read as a CHARACTER — not "apparent age range, hair colour"
  assert.ok(eng.includes(`if (isCreature(c) && (c.look || "").trim().length > 12)`));
  assert.ok(eng.includes("Describe this character's visible look"));
  // the master two-shot, the cast-is-in-frame check and the which-side question all know
  assert.ok(eng.includes("creatureA: creatureNamed(spkA), creatureB: creatureNamed(spkB)"));
  // (…the in-frame check: a PERSON by their look in words, as every approved film was; a CHARACTER by its
  //  own picture since 2026-11-22 — a cartoon puppy's description also fitted the fox-eared dog one scene
  //  of a Kids Cartoon drew in his place. The question is story-picture.ts's, tested in tests/story-picture.test.ts.)
  // (…and a person the STORY invented, with no look in words, by the face the film first showed — the lake film's
  //  redhead came back at the lake with a long auburn ponytail, 2026-11-25; the first master itself is not checked:
  //  it is where those faces are cut from)
  assert.ok(eng.includes("const firstSeen = !castLooks[firstName(sp)] && !!firstFaces[firstName(sp)];"));
  assert.ok(eng.includes(`const there = creatureNamed(sp) || firstSeen ? await characterIsIn(abs(tryUrl), faceFor(sp)) : await castIsIn(abs(tryUrl), castLooks[firstName(sp)] || "", false);`));
  assert.ok(eng.includes(`parseStoryCast(String((await anthropicVision(storyCastPrompt(1), [twoShotAbs, picture], { maxTokens: 400, model: "claude-sonnet-4-6" })) || ""), 1)`));
  assert.ok(eng.includes("return said ? said[0] : true;"), "a look that cannot be read never blocks a film");
  assert.ok(eng.includes("Two characters are together in this image. Character A is:"));
  // a shot composed from cast pictures is locked as a mixed cast
  assert.ok(eng.includes("opts.creatureCast ? MIXED_CAST_LOCK : undefined"));
  assert.ok(eng.includes("creatureCast: castHasCreature"));
  // one name key everywhere in the engine (no private first-token copies left)
  assert.ok(!/toLowerCase\(\)\.split\(\/\[\\s,\]\/\)\[0\]/.test(eng), "every name key goes through nameTok");
  const img = read("app/lib/image-generation.server.ts");
  assert.ok(img.includes("characterInRef(name, refNo(face), look)"));
  assert.ok(img.includes("a creature stays a creature — never given a human face, skin or hands"));
});

test("the page sends what a cast member is, however it was cast", () => {
  const page = read("app/routes/web.film.tsx");
  assert.ok(page.includes(`kind: r.kind || "person", look: r.look || ""`), "'Pick a presenter' carries kind and look");
  assert.ok(page.includes(`...(c.faceUrl && c.kind && c.kind !== "person" ? { kind: c.kind, look: c.look || "" } : {})`), "and the render is told");
  assert.ok(page.includes(`x.kind === "cartoon" || x.kind === "monster"`), "the action accepts only the two character kinds");
  // a face from anywhere else makes them a person again
  assert.ok(page.includes("faceUrl: u || null, kind: undefined, look: undefined"));
});
