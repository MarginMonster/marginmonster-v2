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
import { castOnScreen, speakerKey, takeSeen, unseenAsk, unseenLines } from "../app/lib/dialogue-cast.ts";
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
