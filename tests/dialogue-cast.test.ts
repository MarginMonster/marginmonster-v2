/* ONLY THE TWO ON SCREEN SPEAK.
 *
 * Made as a customer on 2026-11-23, "Moral Film — The Wallet at the Market": a girl finds a wallet at a
 * street market and her grandfather helps her give it back. The writer closed on the fruit seller's
 * thanks — and the fruit seller was never on screen. The film is a two-shot; the video model put the line
 * in the grandfather's mouth, and he was seen thanking his own granddaughter for his own wallet. Found by
 * listening to the finished film (four lines, timed) and looking at whose mouth moved.
 *
 * The lines below are that film's, word for word. app/lib/dialogue-cast.ts is run; the writer's
 * instructions and the check in film-engine.server.ts are pinned by reading them. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { castForWriter, castOnScreen, castRoleOf, castThreat, pickedAsCast, speakerKey, takeSeen, unseenAsk, unseenLines } from "../app/lib/dialogue-cast.ts";
import { saidWords } from "../app/lib/dialogue-fit.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

const WALLET = [
  "MIA: Grandpa, look what I just found on the ground, it's stuffed full of money!",
  "GRANDPA JOE: That's a lot of cash, sweetheart, and somewhere out there someone is panicking right now.",
  "MIA: You're right, I'd feel awful if I lost something this important and nobody gave it back.",
  "MR. ALVAREZ: I can't thank you enough, young lady, this wallet means more to me than you know.",
];

test("who is who: the last word of a label, bare", () => {
  assert.equal(speakerKey("GRANDPA JOE"), "joe");
  assert.equal(speakerKey("Joe"), "joe", "the same man, however the writer labels him");
  assert.equal(speakerKey("MR. ALVAREZ"), "alvarez");
  assert.equal(speakerKey("Mia"), "mia");
  assert.equal(speakerKey("  "), "");
  assert.equal(speakerKey(null), "");
  // (the shot builder reads a speaker the same way: one word before the colon)
  assert.ok(read("app", "lib", "film-dialogue.server.ts").includes("const re = /(\\p{Lu}[\\p{L}'’-]{1,20}):/gu;"));
});

test("the film as it was written: the last line is nobody's who can be seen", () => {
  assert.deepEqual(unseenLines(WALLET), [3]);
  const cast = castOnScreen(WALLET);
  assert.deepEqual(cast[3], { two: ["MIA", "GRANDPA JOE"], seen: false });
  assert.ok(cast.slice(0, 3).every((x) => x.seen));
  // a film of two people has nothing to mend
  assert.deepEqual(unseenLines(WALLET.slice(0, 3)), []);
  assert.deepEqual(unseenLines(["JOE: One.", "Grandpa Joe: Two.", "MIA: Three.", "Joe: Four."]), [], "one man under two labels is one man");
  // a line with no label is nobody's in particular and is left alone; so is an empty one
  assert.deepEqual(unseenLines(["MIA: Look.", "A wallet, full of cash.", "", "JOE: Well."]), []);
  assert.deepEqual(unseenLines([]), []);
});

test("a NEW place has its own two — the third voice is only unseen where it has no place", () => {
  const lines = ["MIA: We should give it back.", "JOE: Then let's find him.", "ALVAREZ: My wallet! You found it!", "MIA: It was on the ground by your stall."];
  // all in one place: Alvarez cannot be seen
  assert.deepEqual(unseenLines(lines, ["the market", "the market", "the market", "the market"]), [2]);
  assert.deepEqual(unseenLines(lines), [2], "no places given: one place");
  // the story MOVES to his stall, where he and Mia are the two: nothing to mend
  assert.deepEqual(unseenLines(lines, ["the market", "", "Mr. Alvarez's fruit stall", ""]), []);
  assert.deepEqual(castOnScreen(lines, ["the market", "", "Mr. Alvarez's fruit stall", ""])[3].two, ["ALVAREZ", "MIA"]);
  // …but a third voice at the stall is unseen there
  assert.deepEqual(unseenLines([...lines, "JOE: Told you he'd be glad."], ["the market", "", "the stall", "", ""]), [4]);
  // the same place written twice is the same place
  assert.deepEqual(unseenLines(lines, ["The Market", "the  market", "THE MARKET", "the market"]), [2]);
});

test("the one request: every line shown, the unseen one marked with who IS there", () => {
  const ask = unseenAsk(WALLET);
  assert.ok(ask.includes("4. [NOT ON SCREEN — only MIA and GRANDPA JOE can be seen and heard here] MR. ALVAREZ: I can't thank you enough"));
  assert.ok(ask.includes("1. MIA: Grandpa, look what I just found"), "the lines before it are there to be answered");
  assert.ok(!ask.includes("1. [NOT ON SCREEN"));
  assert.ok(ask.includes("REPORTED or reacted to by the speaker"));
  assert.ok(ask.includes('Return "lines": exactly 4 entries'));
  assert.ok(ask.includes("14 to 18 spoken words"));
});

test("a rewrite is taken only when one of the two says it — and it is still a line", () => {
  const good = [...WALLET.slice(0, 3), "Grandpa Joe: Look at his face, Mia — he says he can't thank you enough, that wallet meant the world."];
  const out = takeSeen(WALLET, good);
  assert.equal(out[3], "GRANDPA JOE: Look at his face, Mia — he says he can't thank you enough, that wallet meant the world.", "under the label the cast is matched by");
  assert.deepEqual(out.slice(0, 3), WALLET.slice(0, 3), "no other line can change");
  assert.deepEqual(unseenLines(out), [], "the film can now be shot");
  assert.ok(saidWords(out[3]) >= 14 && saidWords(out[3]) <= 20);
  // numbered or still marked: tidied
  assert.equal(takeSeen(WALLET, [...WALLET.slice(0, 3), "4. [NOT ON SCREEN] MIA: He says he can't thank us enough, Grandpa — look how happy he is now!"])[3], "MIA: He says he can't thank us enough, Grandpa — look how happy he is now!");
  // still the third man's line, a line by nobody, three words, or far too long: the original stands
  for (const bad of [
    "MR. ALVAREZ: Thank you so much, young lady, you have no idea what this means to me today.",
    "Thank you so much, you have no idea what this means to me and my family today.",
    "JOE: He says thanks.",
    `MIA: ${"word ".repeat(40).trim()}`,
    42, null,
  ]) assert.equal(takeSeen(WALLET, [...WALLET.slice(0, 3), bad])[3], WALLET[3], String(bad).slice(0, 30));
  // a seen line the rewriter touched anyway is NOT taken
  assert.equal(takeSeen(WALLET, ["MIA: Something else entirely, said in a completely different way than before, yes.", ...good.slice(1)])[0], WALLET[0]);
  // the wrong number of lines, or not a list: nothing changes
  assert.deepEqual(takeSeen(WALLET, good.slice(1)), WALLET);
  assert.deepEqual(takeSeen(WALLET, "nope"), WALLET);
  assert.deepEqual(takeSeen(WALLET, undefined), WALLET);
});

test("the writer is told — and then it is checked, before the lengths are", () => {
  const engine = read("app", "lib", "film-engine.server.ts");
  // told: an acted scene's invented cast is TWO, each with one word for a name
  assert.ok(engine.includes('First invent the TWO characters who carry this scene and return them as "cast": exactly two entries'));
  assert.ok(engine.includes('a simple ONE-WORD first name'));
  assert.ok(engine.includes('never a title or two words such as "Grandpa Joe" or "Mr. Alvarez"'));
  assert.ok(engine.includes("      : tmpl.dialogue && !narrated\n      ? `\\nFirst invent the TWO characters"), "only for an acted scene — a told story and a song keep their casts");
  assert.ok(engine.includes('First invent a small RECURRING CAST (2-3 characters)'), "…which are still two or three");
  // told: only the two speak
  assert.ok(engine.includes("ONLY the two people in the shot ever speak: the NAME before the colon is always one of their two names, the same single word every time."));
  assert.ok(engine.includes("is talked ABOUT or stands silent in the background, and is never heard"));
  // checked: once, with the places, before the long lines are counted — and any trouble changes nothing
  const check = engine.indexOf("const unseen = unseenLines(written, wheres);");
  const lengths = engine.indexOf("const long = linesTooLong(written);");
  assert.ok(check > 0 && lengths > check, "a rewritten line is counted like any other");
  assert.ok(engine.includes("const next = takeSeen(written, (JSON.parse(raw) as { lines?: unknown }).lines, wheres);"));
  assert.ok(engine.includes("the lines by somebody off screen could not be rewritten, kept as written"));
  assert.ok(engine.includes("...(castNote ? { castFit: castNote } : {}),"), "what happened rides back with the script");
});

/* THE CAST PICKED BEFORE A WORD WAS WRITTEN. Made as a customer on 2026-11-24, to look at an acted film's
 * poster: Short Film, OMAR + ROSA picked on the Cast card ("THE STARS · OMAR + ROSA"), Generate pressed
 * without opening the storyboard. The film that came back — "Found Between Us" — was acted by a woman with
 * a dark bun and a man in a flat cap; its record said nobody was cast; it had no poster and no "Starring".
 * The picks were sent with the form and used only for a told story. */
test("an acted film made in one press is cast with the people the maker picked", () => {
  const stock = new Set(["English_ManWithDeepVoice", "English_CalmWoman"]);
  const ok = (v: string) => stock.has(v);
  const picks = [
    { name: " OMAR ", faceUrl: "/avatars/omar_0.jpg?v=3", kind: "person" as const, look: "a warm man in his thirties with a short black beard", voiceId: "English_ManWithDeepVoice" },
    { name: "ROSA", faceUrl: "/avatars/rosa_0.jpg?v=3", kind: "person" as const, look: "a woman in her seventies with short silver hair", voiceId: "someone-elses-cloned-voice" },
    { name: "Howl", faceUrl: "/uploads/howl.png", kind: "monster" as const, look: "a huge upright werewolf with shaggy dark-grey fur", voiceId: null },
    { name: "omar", faceUrl: "/avatars/omar_1.jpg", kind: "person" as const, look: "", voiceId: null },
    { name: "Ghost", faceUrl: null, kind: "person" as const, look: "nobody has drawn them", voiceId: null },
    null,
  ];
  assert.deepEqual(pickedAsCast(picks, ok), [
    { name: "OMAR", faceUrl: "/avatars/omar_0.jpg?v=3", voiceId: "English_ManWithDeepVoice", look: "a warm man in his thirties with a short black beard" },
    // a voice this shop may not use is dropped (the engine chooses) — never an id the page made up
    { name: "ROSA", faceUrl: "/avatars/rosa_0.jpg?v=3", voiceId: null, look: "a woman in her seventies with short silver hair" },
    // a creature stays a creature: what it IS rides along
    { name: "Howl", faceUrl: "/uploads/howl.png", voiceId: null, kind: "monster", look: "a huge upright werewolf with shaggy dark-grey fur" },
  ], "nobody twice, nobody without a picture");
  assert.deepEqual(pickedAsCast([], ok), []);
  // …and the WRITER is told who they are, so the script is written for them
  assert.deepEqual(castForWriter(pickedAsCast(picks, ok)), [
    { name: "OMAR", desc: "a warm man in his thirties with a short black beard" },
    { name: "ROSA", desc: "a woman in her seventies with short silver hair" },
    // (…and what it IS, when it is not a person — the writer used to guess it from the look's first words)
    { name: "Howl", desc: "a huge upright werewolf with shaggy dark-grey fur", kind: "monster" },
  ]);
  assert.deepEqual(castForWriter([{ name: "Maya", faceUrl: "/avatars/maya.png" }, { name: "Uncast", faceUrl: null }, { name: " ", faceUrl: "/x.png" }, null]), [{ name: "Maya", desc: "" }], "only who has a picture: an uncast role is the writer's to invent");
  assert.deepEqual(castForWriter(undefined), []);
  // THE MONSTER IS CASTABLE (2026-11-25, "Monster should be castable also"): one entry may be the film's THING — it keeps
  // its role, one at most; the writer is told it as a creature (the threat, no line, no "cast" entry), whatever it is
  const withThreat = pickedAsCast([
    { name: "Omarine", faceUrl: "/avatars/omarine.jpg", kind: "person", look: "a TEST woman in a green coat", voiceId: null },
    { name: "Howlette", faceUrl: "/uploads/howlette.png", kind: "monster", look: "a TEST werewolf with grey fur", voiceId: null, role: "threat" },
    { name: "the lake lady", faceUrl: "/renders/lady.jpg", kind: "person", look: "a TEST pale woman in a soaked dress", voiceId: null, role: "threat" },
  ], ok);
  assert.deepEqual(withThreat.map((c) => c.role || ""), ["", "threat", ""], "one thing at most: the first");
  assert.deepEqual(castThreat(withThreat), withThreat[1]);
  assert.equal(castThreat(pickedAsCast(picks, ok)), null, "an old payload has none");
  assert.equal(castThreat([{ name: "x", faceUrl: "", role: "threat" }]), null, "a thing with no picture is no thing to draw from");
  assert.deepEqual(castForWriter([{ name: "the lake lady", faceUrl: "/renders/lady.jpg", look: "a pale woman", role: "threat" }]), [{ name: "the lake lady", desc: "a pale woman", kind: "monster" }]);
  // …and how a reader of a posted cast keeps it: nothing else is ever a role
  assert.deepEqual(castRoleOf({ role: "threat" }), { role: "threat" });
  for (const x of [{ role: "hero" }, { role: "THREAT" }, {}, null, "threat"]) assert.deepEqual(castRoleOf(x), {});

  // THE ACTION: with no storyboard, the picks ARE the cast — for an acted film only, voices checked
  const page = read("app", "routes", "web.film.tsx");
  const at = page.indexOf("else if (narrated) cast = storyCast.map((c) => ({ name: c.name, faceUrl: c.faceUrl, voiceId: null, kind: c.kind, look: c.look }));");
  const branch = page.slice(at, at + 1400);
  assert.ok(at > 0 && branch.includes("else if (tmpl.dialogue && !approvedTreatment) {"), "one press only: with a storyboard the page sends the cast it shows");
  assert.ok(branch.includes("const acted = pickedAsCast(storyCast, (v) => AVATAR_VOICE_IDS.has(v) || isCharacterVoice(v) || mine.has(v));"));
  assert.ok(branch.includes("if (acted.length) cast = acted;"));
  assert.ok(page.includes("const storyCast = tmpl.lipSyncSinger ? [] : parseStoryCast(form.get(\"filmCast\") as string);"), "a music video's cast is its own affair");
  assert.ok(page.includes("{isStoryboard && pickedCast.length > 0 && <input type=\"hidden\" name=\"filmCast\" value={filmCastJson} />}"), "the picks ride with the form");
  assert.ok(page.includes("...(cast ? { cast } : {}),"), "…and on to the job");
  // THE FILM: when it writes its own script, the writer hears who was cast
  const film = read("app", "lib", "film-dialogue.server.ts");
  assert.ok(film.includes("else treatment = await previewFilmTreatment({ shopId: opts.shopId, template: tmpl.key, topic: opts.topic, sceneCount: opts.sceneCount, ...(castForWriter(opts.cast).length ? { cast: castForWriter(opts.cast) } : {}), series: opts.series });"));
  const engine = read("app", "lib", "film-engine.server.ts");
  assert.ok(engine.includes("THE CAST IS ALREADY CHOSEN — write the story for exactly these characters:"));
});
