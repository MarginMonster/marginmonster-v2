/* PROPS & MOVES — the thing a character always has, and the move they are known for (SPEC-S16, the told engine: S16a).
 *
 * The owner, 2026-11-26: "Anime characters would have specific clothing's - specific props (like luffy from one piece hat)
 * Or goku and his signature moves yanno? … (props) that often show in scenes" · "Specific swords or styles". He named
 * famous characters only as EXAMPLES: we make ORIGINAL ones, and never write theirs.
 *
 * What is held here: the tag that rides at the END of a cast entry (character-mark.ts), peeled off before the look is
 * read (story-picture.ts castEntry), drawn into the portrait, said in every scene, the move only where its scene calls for
 * it — and the IP table, the safety rules and the words. Every name and thing below is invented for these tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRANCHISE, LETTERING, MARK_HAS_MAX, MARK_LEAD_KEYS, MARK_MOVE_MAX, MARK_THINGS, MOVE_SCENES_MAX, ORIGINAL_CAST, REVEALING, WEAPON,
  castMoves, dealMarkThings, fitEntry, franchiseIn, markForFormat, markLead, markLine, markOf, markProblem, markTag, markWriter,
  moveLine, normalizeCastEntry, peelMark, pictureText, portraitHas, scrubFranchise, setMarkIn, withMark,
} from "../app/lib/character-mark.ts";
import { castEntry, castMarks, characterKind, portraitPrompt } from "../app/lib/story-picture.ts";
import { entryName } from "../app/lib/narrated-core.ts";
import { GENRE_FILMS, startersOf } from "../app/lib/film-genres.ts";
import { ANIME_STYLES, drawnLead } from "../app/lib/anime-styles.ts";
import { seriesCharacters, seriesFromPayload } from "../app/lib/film-series.ts";
import { storyToEditFrom } from "../app/lib/story-edit.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// (a checkout with CRLF line endings must read the same as one with LF)
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

// TEST cast — invented people with invented things (SPEC-S16a, "Verify by LOOKING")
const KAI = "Kai, a lanky courier in his twenties with a black undercut [always: a long cobalt scarf and a folded steel fan | move: the Paper Gale — a low spin that sweeps the open fan through the air]";
const BRAM = "Bram Tolliver, a broad-shouldered ferryman in his fifties with a grey braid [always: a dented brass lantern on a long pole | move: the Long Reach — a lunge that hooks the lantern pole over a gap]";
const REN = "Ren Okafor, a wiry mechanic in her thirties with a shaved head [always: a red-lacquered wooden sword across her back | move: the Lantern Cut — a leaping downward stroke that splits a falling crate]";

test("the tag round trip: markTag ↔ peelMark — both parts, one part, none", () => {
  const both = { has: "a long cobalt scarf", move: "the Paper Gale — a low spin" };
  assert.equal(markTag(both), "[always: a long cobalt scarf | move: the Paper Gale — a low spin]");
  assert.deepEqual(peelMark(`Kai, a courier ${markTag(both)}`), { text: "Kai, a courier", mark: both });
  assert.equal(markTag({ has: "a dented brass lantern" }), "[always: a dented brass lantern]");
  assert.deepEqual(peelMark("Bram, a ferryman [always: a dented brass lantern]"), { text: "Bram, a ferryman", mark: { has: "a dented brass lantern" } });
  assert.equal(markTag({ move: "the Long Reach — a lunge" }), "[move: the Long Reach — a lunge]");
  assert.deepEqual(peelMark("Bram, a ferryman [move: the Long Reach — a lunge]"), { text: "Bram, a ferryman", mark: { move: "the Long Reach — a lunge" } });
  for (const none of [null, undefined, {}, { has: "  ", move: "" }]) assert.equal(markTag(none as never), "");
  // capitals and spaces tolerated; a ";" for a "|"; a tag cut off before its "]"
  assert.deepEqual(peelMark("Kai, a courier [ Always : a scarf |MOVE:the Gale ]"), { text: "Kai, a courier", mark: { has: "a scarf", move: "the Gale" } });
  assert.deepEqual(peelMark("Kai, a courier [always: a scarf; move: the Gale — a spin]").mark, { has: "a scarf", move: "the Gale — a spin" });
  assert.deepEqual(peelMark("Kai, a courier [always: a scarf | move: the Gale"), { text: "Kai, a courier", mark: { has: "a scarf", move: "the Gale" } });
  // "[", "]" and "|" inside a part are dropped — they would break the tag
  assert.equal(markTag({ has: "a [red] | scarf", move: "the ]Gale[" }), "[always: a red scarf | move: the Gale]");
  // wherever it is in the string — the FIRST one; what is left is tidied (no double space, no comma before an end)
  assert.deepEqual(peelMark("Kai [always: a scarf], a lanky courier"), { text: "Kai, a lanky courier", mark: { has: "a scarf" } });
  assert.deepEqual(peelMark("Kai [always: a scarf] a lanky courier"), { text: "Kai, a lanky courier", mark: { has: "a scarf" } }, "the name keeps its comma");
  assert.deepEqual(peelMark("MARA (a young baker [always: a red apron])"), { text: "MARA (a young baker)", mark: { has: "a red apron" } });
  assert.deepEqual(peelMark("Kai, [always: a scarf]"), { text: "Kai", mark: { has: "a scarf" } });
  // a string with no tag comes back byte for byte — spaces, brackets and all
  for (const s of ["  Walter,  an elderly watchman  ", "MARA (a young baker)", "Pip — a terrier [with one white ear]", "", "the ferry: an old black boat"]) assert.equal(peelMark(s).text, s);
});

test("markOf reads a mark checked: an object or a JSON string, each part one line and cut on a word", () => {
  assert.deepEqual(markOf({ has: "  a long\ncobalt scarf.  ", move: "the Gale" }), { has: "a long cobalt scarf", move: "the Gale" });
  assert.deepEqual(markOf(JSON.stringify({ has: "a brass lantern" })), { has: "a brass lantern" });
  for (const bad of [null, undefined, "", "a scarf", "{", "[1]", 7, [], { has: 4 }, { has: "", move: " " }]) assert.equal(markOf(bad), null, String(bad));
  const long = markOf({ has: "a very long patched and weathered travelling cloak of deep wine-red wool with brass buttons", move: "the Long Reach — a lunge that hooks the lantern pole over a gap and swings the whole ferry round to the jetty" })!;
  assert.ok(long.has!.length <= MARK_HAS_MAX && long.move!.length <= MARK_MOVE_MAX, JSON.stringify(long));
  assert.ok("a very long patched and weathered travelling cloak of deep wine-red wool with brass buttons".startsWith(long.has!) && !/\s$/.test(long.has!), "cut on a word");
});

test("withMark / fitEntry: the body is cut, never the tag; an untagged entry is cut exactly as .slice was", () => {
  const body = `Bram Tolliver, a broad-shouldered ferryman ${"with a weathered face and a patched coat ".repeat(9)}`.trim();
  const tag = "[always: a dented brass lantern on a long pole | move: the Long Reach — a lunge that hooks the lantern pole over a gap]";
  const entry = `${body} ${tag}`;
  assert.ok(entry.length > 400);
  const fit = fitEntry(entry, 200);
  assert.ok(fit.length <= 200, `${fit.length}`);
  assert.ok(fit.endsWith(` ${tag}`), "the whole tag, at the end");
  const kept = fit.slice(0, fit.length - tag.length - 1);
  assert.ok(body.startsWith(kept) && body.charAt(kept.length) === " ", "the body cut at a word");
  assert.deepEqual(peelMark(fit).mark, { has: "a dented brass lantern on a long pole", move: "the Long Reach — a lunge that hooks the lantern pole over a gap" });
  // (the word boundary is for a TAGGED entry only: an untagged one is `.slice(0, max)`, byte for byte — every entry
  //  written before props is carried exactly as it was)
  for (const s of ["x".repeat(450), `Walter, ${"an elderly night watchman ".repeat(20)}`, "Nessa"]) assert.equal(fitEntry(s, 200), s.slice(0, 200));
  // a tag written mid-entry goes to the end; a name with nothing after it keeps a comma
  assert.equal(fitEntry("Kai [always: a scarf], a lanky courier", 300), "Kai, a lanky courier [always: a scarf]");
  assert.equal(withMark("Kai", { has: "a scarf" }), "Kai, [always: a scarf]");
  assert.equal(withMark("Kai, a courier [always: an old tag] [move: another]", { move: "the Gale" }), "Kai, a courier [move: the Gale]", "every old tag out, the new one in");
  assert.equal(withMark("Kai, a courier", null), "Kai, a courier");
  // S16b's "Draw {name} again": the tag replaced, or taken out
  assert.equal(setMarkIn(KAI, { has: "a red umbrella" }), "Kai, a lanky courier in his twenties with a black undercut [always: a red umbrella]");
  assert.equal(setMarkIn(KAI, null), "Kai, a lanky courier in his twenties with a black undercut");
});

test("pictureText: a character drawn from words has the thing too — never the move, never the tag", () => {
  assert.equal(pictureText(KAI), "Kai, a lanky courier in his twenties with a black undercut, always with a long cobalt scarf and a folded steel fan");
  assert.equal(pictureText("Kai, a courier [move: the Paper Gale — a low spin]"), "Kai, a courier");
  for (const s of ["Walter, a watchman", "  MARA (a baker)  ", ""]) assert.equal(pictureText(s), s, "no tag: as it was");
  assert.ok(!/Gale|\[|move/.test(pictureText(KAI)));
  // cut at 200 (the scene lines): the BODY is cut at a word, the thing kept whole — review of S16a: a writer's entry runs
  // 150-250 characters, and ".slice(0, 200)" after it cut the thing off most of them
  const long = `Bram Tolliver, a broad-shouldered ferryman ${"with a weathered face and a patched coat ".repeat(5)}[always: a dented brass lantern on a long pole]`;
  const cut = pictureText(long, 200);
  assert.ok(cut.length <= 200 && cut.endsWith(", always with a dented brass lantern on a long pole"), cut);
  assert.ok(long.startsWith(cut.slice(0, cut.indexOf(", always with "))));
  // no tag: exactly .slice(0, 200), byte for byte
  for (const s of ["x".repeat(450), `Walter, ${"an elderly night watchman ".repeat(20)}`, "Nessa"]) assert.equal(pictureText(s, 200), s.slice(0, 200));
});

test("castEntry peels the tag first: the look is what it always was, and the mark comes back beside it", () => {
  assert.deepEqual(castEntry(KAI), { name: "Kai", look: "a lanky courier in his twenties with a black undercut", mark: { has: "a long cobalt scarf and a folded steel fan", move: "the Paper Gale — a low spin that sweeps the open fan through the air" } });
  assert.deepEqual(castEntry("Walter, an elderly night watchman"), { name: "Walter", look: "an elderly night watchman" }, "no tag: no `mark` key at all");
  // unpeeled, a wolf-fur cloak reads as a cartoon (wol(f)) and glowing eyes as a monster: a hero made a creature
  const wolf = castEntry("Kai, a courier [always: a wolf-fur cloak]");
  assert.ok(!/wolf/.test(wolf.look) && characterKind(wolf.name, wolf.look) === "person");
  const mask = castEntry("Kai [always: a mask with glowing eyes]");
  assert.deepEqual([mask.name, mask.look], ["Kai", ""]);
  assert.equal(characterKind(mask.name, mask.look), "person");
});

test("castMarks: every named entry's mark, by its name in lower case — invented and picked alike", () => {
  const picked = "Odessa Lark, the fixed look the maker's card gave her [always: a moss-green raincoat]";
  const m = castMarks([KAI, "Walter, an elderly watchman", picked, "", "Nameless [move: a spin]"]);
  assert.deepEqual([...m.keys()], ["kai", "odessa lark", "nameless"]);
  assert.deepEqual(m.get("kai"), { has: "a long cobalt scarf and a folded steel fan", move: "the Paper Gale — a low spin that sweeps the open fan through the air" });
  assert.equal(m.get("walter"), undefined, "no tag, no mark");
  assert.deepEqual(m.get("odessa lark"), { has: "a moss-green raincoat" }, "a picked face returned with its tag gives its mark");
});

test("the name rule: a comma always follows the name, so entryName and castEntry agree", () => {
  const fmt = { childSafe: false, horror: false };
  for (const e of ["Kai [always: a scarf]", "Kai: a courier [move: the Gale — a spin]", "Kai, a courier [always: a scarf]", "Kai [always: a scarf] a courier"]) {
    const n = normalizeCastEntry(e, fmt);
    assert.equal(entryName(n), "Kai", n);
    assert.equal(castEntry(n).name, "Kai", n);
  }
  assert.equal(normalizeCastEntry("Kai [always: a scarf]", fmt), "Kai, [always: a scarf]");
  // the tag moved to the end, its parts capped, the whole capped at 400 with the tag whole
  assert.equal(normalizeCastEntry("Kai [always: a scarf] a lanky courier", fmt), "Kai, a lanky courier [always: a scarf]");
  const fat = normalizeCastEntry(`Kai, ${"a courier ".repeat(60)}[always: a scarf]`, fmt);
  assert.ok(fat.length <= 400 && fat.endsWith(" [always: a scarf]"));
  // …made fit for the story, and someone else's character taken out
  assert.equal(normalizeCastEntry(REN, { childSafe: true, horror: false }), "Ren Okafor, a wiry mechanic in her thirties with a shaved head");
  assert.equal(normalizeCastEntry(KAI, { childSafe: false, horror: true }), "Kai, a lanky courier in his twenties with a black undercut [always: a long cobalt scarf and a folded steel fan]");
  assert.equal(normalizeCastEntry("Taro, a young fighter [move: a Kamehameha wave]", fmt), "Taro, a young fighter [move: an energy blast wave]");
  assert.equal(normalizeCastEntry("Walter, an elderly watchman", fmt), "Walter, an elderly watchman", "no tag: as it was");
});

test("portraitPrompt: the thing is drawn into the portrait, never the move — and an untagged entry is asked for exactly as before", () => {
  const hint = "soft hand-drawn anime";
  const p = portraitPrompt(KAI, hint, drawnLead("animedream"));
  assert.ok(p.includes(portraitHas("Kai", "a long cobalt scarf and a folded steel fan")), p);
  assert.ok(p.includes("on a plain neutral background. Kai always has a long cobalt scarf and a folded steel fan: it is clearly seen in this portrait — worn, held or carried where it shows from the front. In the exact art style of the story."), "after the ground, before the style");
  assert.ok(!/move|\[|Paper Gale/.test(p), "no move, no tag");
  assert.ok(p.includes("A character portrait of Kai, a lanky courier in his twenties with a black undercut — this ONE character alone"));
  // a creature's portrait (photographed: a grown-up story, nothing said first) has its thing too
  const c = portraitPrompt("The Hollow Man, a tall pale ghoul with a grin far too wide [always: a rusted iron lantern]", "a dark horror scene");
  assert.ok(c.includes("wardrobe-test photograph of The Hollow Man, a tall pale ghoul with a grin far too wide — this ONE creature alone") && c.includes("so that everything about it can be seen. The Hollow Man always has a rusted iron lantern:"));
  // THE SNAPSHOT: three untagged entries, as portraitPrompt drew them on 2026-11-26 BEFORE props existed
  const NOTHING = "Nothing in the picture is written: no signs with words, labels, notices, numbers, letters or captions — a door, a shopfront or a page is drawn plain.";
  assert.equal(portraitPrompt("Walter, an elderly night watchman with a grey moustache, a flat cap and a long brown coat", "moody painterly storybook illustration", "Wholesome, child-safe, G-rated, bright and friendly. "),
    `Wholesome, child-safe, G-rated, bright and friendly. moody painterly storybook illustration. A character portrait of Walter, an elderly night watchman with a grey moustache, a flat cap and a long brown coat — this ONE character alone, the whole body from head to feet, standing, turned a little toward the viewer, the face clearly seen, on a plain neutral background. In the exact art style of the story. ${NOTHING}`);
  assert.equal(portraitPrompt("The Smiler, a tall pale ghoul with a grin far too wide and eyes sunk in black sockets", "a dark horror scene", ""),
    `a dark horror scene. It is PHOTOGRAPHED: a practical-effects creature as a 1970s horror film would build it — real skin, real hair, real teeth — caught on 35mm film, underexposed, grainy, a little soft. Never CGI, never a 3D render, never an illustration, never a clean studio look. A wardrobe-test photograph of The Smiler, a tall pale ghoul with a grin far too wide and eyes sunk in black sockets — this ONE creature alone, the whole figure from head to feet, standing, turned a little toward the camera, against a plain dark wall under one hard light from above, so that everything about it can be seen. ${NOTHING}`);
  assert.equal(portraitPrompt("Odessa Lark, a woman in her thirties with a short black bob", "soft hand-drawn anime", drawnLead("animedream")),
    `EVERYTHING IN THIS PICTURE IS DRAWN, in one hand-drawn 2D anime style — dreamy hand-painted countryside anime: never a photograph and never a 3D render, whatever any word below says. soft hand-drawn anime. A character portrait of Odessa Lark, a woman in her thirties with a short black bob — this ONE character alone, the whole body from head to feet, standing, turned a little toward the viewer, the face clearly seen, on a plain neutral background. In the exact art style of the story. ${NOTHING}`);
});

test("markForFormat: a children's story never has a weapon; a horror story has no move", () => {
  const kids = { childSafe: true, horror: false };
  assert.equal(markForFormat({ has: "a red-lacquered wooden sword" }, kids), null, "a sword dropped");
  assert.deepEqual(markForFormat({ has: "a long cobalt scarf" }, kids), { has: "a long cobalt scarf" }, "a scarf kept");
  assert.deepEqual(markForFormat({ has: "a scarf", move: "the Leaf Cut — a spin of the blade" }, kids), { has: "a scarf" }, "a move with a blade dropped");
  assert.equal(markForFormat({ has: "a wooden sword", move: "the Leaf Cut — a spin that swings it" }, kids), null, "the sword's own move goes with it");
  assert.deepEqual(markForFormat({ has: "a scarf", move: "the Big Bounce — a giant bounce" }, kids), { has: "a scarf", move: "the Big Bounce — a giant bounce" });
  const horror = { childSafe: false, horror: true };
  assert.deepEqual(markForFormat({ has: "an old sword across the back", move: "the Long Reach" }, horror), { has: "an old sword across the back" }, "the move dropped, the has kept (sheathed: the writer is told)");
  assert.equal(markForFormat({ move: "the Long Reach" }, horror), null);
  const grown = { childSafe: false, horror: false };
  assert.deepEqual(markForFormat({ has: "a red-lacquered wooden sword", move: "the Lantern Cut — a leaping stroke" }, grown), { has: "a red-lacquered wooden sword", move: "the Lantern Cut — a leaping stroke" }, "otherwise unchanged");
  // what counts as a weapon — and what does not
  for (const w of ["a sword", "twin katanas", "a hunting knife", "two knives", "a war hammer", "a warhammer", "bow and arrows", "a crossbow", "a water pistol", "nunchaku", "a whip", "a spear"]) assert.ok(WEAPON.test(w), w);
  for (const n of ["a golf club", "a walking staff", "a long cobalt scarf", "roller blades", "a blade of grass", "a saber-toothed cat charm", "a bubble gun", "a whipped-cream hat", "swordfish socks"]) assert.ok(!WEAPON.test(n), n);
});

test("markProblem: someone else's first, then writing, then anything revealing", () => {
  assert.deepEqual(markProblem({ has: "a Kamehameha wave" }), { kind: "franchise", word: "Kamehameha", as: "an energy blast" });
  assert.deepEqual(markProblem({ has: "a scarf", move: "a Rasengan" }), { kind: "franchise", word: "Rasengan", as: "a spinning ball of wind" });
  assert.deepEqual(markProblem({ has: "a Pikachu backpack with my initials" }), { kind: "franchise", word: "Pikachu", as: "a small creature" }, "franchise first");
  assert.deepEqual(markProblem({ has: "a headband with kanji" }), { kind: "lettering" });
  assert.deepEqual(markProblem({ has: "a jersey with the number nine" }), { kind: "lettering" });
  assert.deepEqual(markProblem({ has: "shirtless" }), { kind: "revealing" });
  assert.deepEqual(markProblem({ has: "a bikini top" }), { kind: "revealing" });
  for (const ok of ["a long cobalt scarf", "a sword", "a staff", "a sword and a broadsword"]) assert.equal(markProblem({ has: ok }), null, ok);
  assert.ok(!LETTERING.test("a sword") && LETTERING.test("a sign with words") && REVEALING.test("bare-chested"));
});

test("FRANCHISE: every row is found; ordinary words, common names and legend are not", () => {
  for (const r of FRANCHISE) {
    assert.ok(r.word && r.as && !/^[A-Z]/.test(r.as), r.word);
    const f = franchiseIn(`In this story the hero meets ${r.word} at the harbour.`);
    assert.ok(f, `${r.word} is found in a sentence`);
    assert.equal(f!.as, r.as, r.word);
  }
  for (const t of ["Pokemon", "Mjölnir", "Spiderman", "spider man", "Hadoken", "light saber", "Gomu-Gomu", "SUPER SAIYAN", "Hunter × Hunter", "dragonball z", "Tanjirō", "Studio Ghibli"]) assert.ok(franchiseIn(t), t);
  for (const t of ["a one-piece swimsuit", "a golf club", "Mario the baker", "a link in the chain", "frozen lake", "Elsa", "Excalibur", "Robin Hood", "Dracula", "a street fighter", "a demon slayer", "a death note", "a master swordsman", "King Kamehameha's island", "Thor", "Sonic boom", "Zelda", "Marvel at it", "bleach", "a swordsman"]) assert.equal(franchiseIn(t), null, t);
  assert.equal(scrubFranchise("Goku fights a dragon"), "a martial artist fights a dragon");
  assert.equal(scrubFranchise("a Goku fights a dragon"), "a martial artist fights a dragon", "no double article");
  assert.equal(scrubFranchise("two Jedis with lightsabers meet a Pokémon"), "two knights with energy swords meet pocket creatures");
  assert.equal(scrubFranchise("in the style of Studio Ghibli"), "in the style of hand-painted anime");
  assert.equal(scrubFranchise("a one-piece swimsuit at King Kamehameha's beach"), "a one-piece swimsuit at King Kamehameha's beach", "nothing to take out: as it was");
  assert.equal(franchiseIn("Goku and Naruto")!.word, "Goku", "the first one");
  // our own starter ideas never carry one (they are said to the writer as they are)
  for (const k of [...GENRE_FILMS.map((g) => g.key), "horror", "moral", "kidstv", "testmovie", ...ANIME_STYLES.map((s) => s.key)]) for (const s of startersOf(k)) assert.equal(franchiseIn(s), null, `${k}: ${s}`);
});

// REVIEW OF S16a (2026-11-26): what a quick read missed
test("a picked name is never scrubbed: a member's own 'Gojo Tanaka' stays himself in the cast, the scenes and the idea", () => {
  const keep = ["Gojo Tanaka", "Tessa"];
  assert.equal(scrubFranchise("Gojo Tanaka climbs the stairs; Gojo grins", keep), "Gojo Tanaka climbs the stairs; Gojo grins");
  assert.equal(scrubFranchise("Gojo meets Goku on the pier", keep), "Gojo meets a martial artist on the pier", "only the picked name is kept");
  assert.equal(franchiseIn("Gojo Tanaka waves", keep), null);
  assert.equal(franchiseIn("Gojo Tanaka waves at Pikachu", keep)!.word, "Pikachu", "the next one is still found");
  assert.equal(normalizeCastEntry("Gojo Tanaka, a tall courier [always: a grey felt hat]", { childSafe: false, horror: false }, 400, keep), "Gojo Tanaka, a tall courier [always: a grey felt hat]");
  assert.equal(castEntry(normalizeCastEntry("Gojo Tanaka, a tall courier", { childSafe: false, horror: false }, 400, keep)).name, "Gojo Tanaka");
  // with no picked names, as before
  assert.equal(scrubFranchise("Gojo grins"), "a sorcerer grins");
  assert.equal(scrubFranchise("Gojo grins", []), "a sorcerer grins");
});

test("ALL CAPITALS has no capitals to read: 'ONE PIECE OF CAKE' is an ordinary phrase; a theme park stays a place", () => {
  for (const t of ["ONE PIECE OF CAKE LEFT", "A DEATH NOTE ON THE DOOR", "THE MASTER SWORD OF THE KEEP", "A STREET FIGHTER", "THE DEMON SLAYER RETURNS", "A DRAGON BALL OF GLASS"]) assert.equal(franchiseIn(t), null, t);
  assert.equal(franchiseIn("they read One Piece")!.word, "One Piece", "with its own capitals, still found");
  assert.equal(scrubFranchise("our trip to Disney World"), "our trip to a theme park");
  assert.equal(scrubFranchise("a day at Disneyland with Grandma"), "a day at a theme park with Grandma");
  assert.equal(scrubFranchise("a Disney film night"), "an animated film film night");
});

test("a mark never says 'signature', 'trademark' or 'iconic' — beside 'No watermark, no signature.' a model may write one", () => {
  assert.deepEqual(markOf({ has: "her signature crimson scarf", move: "his trademark spin — the Gale" }), { has: "her crimson scarf", move: "his spin — the Gale" });
  assert.deepEqual(peelMark("Kai, a courier [always: an Iconic brass lantern]").mark, { has: "a brass lantern" });
  assert.deepEqual(markOf({ has: "A signature old umbrella" }), { has: "An old umbrella" });
  assert.deepEqual(markOf({ has: "a pen for his signature" }), { has: "a pen for his signature" }, "only before a thing");
  assert.ok(!/signature/i.test(normalizeCastEntry("Kai, a courier [always: his signature steel fan]", { childSafe: false, horror: false })));
});

test("two tags written for one character keep both parts", () => {
  assert.equal(normalizeCastEntry("Kai, a courier [always: a scarf] [move: the Gale — a spin]", { childSafe: false, horror: false }), "Kai, a courier [always: a scarf | move: the Gale — a spin]");
  assert.equal(normalizeCastEntry("Kai, a courier [always: a scarf] [always: a fan]", { childSafe: false, horror: false }), "Kai, a courier [always: a scarf]", "the first of each part");
  assert.equal(normalizeCastEntry("Ren, a mechanic [always: a scarf] [move: the Cut — a sword stroke]", { childSafe: true, horror: false }), "Ren, a mechanic [always: a scarf]", "and still fit for the story");
});

test("castMoves: a move only on a scene that names somebody who has one, and two scenes at most", () => {
  assert.equal(MOVE_SCENES_MAX, 2);
  assert.deepEqual(castMoves([{ move: "Kai" }, {}, { move: "Nobody" }, { move: "kai" }, { move: "Kai" }], ["Kai"]), ["Kai", undefined, undefined, "Kai", undefined]);
  assert.deepEqual(castMoves([{ move: "Bram" }, { move: "Kai's" }, null, { move: 4 }], ["Bram Tolliver", "Kai"]), ["Bram Tolliver", "Kai", undefined, undefined], "a first name, a possessive");
  assert.deepEqual(castMoves([{ move: "Kai" }], []), [undefined], "nobody has a move (a horror story): none kept");
});

test("the words: what the writer and the pictures are told", () => {
  // never "signature" (the designed voice; "No watermark, no signature."), "trademark" or "iconic" — anywhere in the file
  const src = read("app", "lib", "character-mark.ts");
  // (…but for the one line that takes them OUT of a mark: BRAG — review of S16a)
  const said = src.split("\n").filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l) && !l.startsWith("const BRAG = /")).join("\n");
  assert.equal(src.split("\n").filter((l) => l.startsWith("const BRAG = /")).length, 1);
  assert.ok(!/signature|trademark|iconic/i.test(said), "no line said to a model, or written in code, has those words");
  const all = (o: { drawn: boolean; childSafe: boolean; horror: boolean }) => [markWriter({ ...o, lead: true }), markWriter({ ...o, lead: false, chosen: true }), moveLine("Kai", "the Paper Gale — a low spin", o), markLine("Kai", "a scarf", 1), portraitHas("Kai", "a scarf")];
  for (const o of [{ drawn: true, childSafe: false, horror: false }, { drawn: false, childSafe: false, horror: false }, { drawn: false, childSafe: true, horror: false }, { drawn: false, childSafe: false, horror: true }]) for (const l of all(o)) assert.ok(!/signature|trademark|iconic/i.test(l), l);
  assert.ok(!/signature|trademark|iconic/i.test(ORIGINAL_CAST));
  // horror: no move sentence at all; kids: never a weapon
  const horror = markWriter({ drawn: false, childSafe: false, horror: true, lead: false });
  assert.ok(!/move/i.test(horror), horror);
  assert.ok(horror.includes("never a weapon") && horror.includes("stays sheathed") && horror.includes("[always: …]"));
  const kids = markWriter({ drawn: false, childSafe: true, horror: false, lead: false });
  assert.ok(kids.includes("something cheerful, never a weapon.") && kids.includes("a playful one that hits nobody"));
  assert.ok(!/sword/.test(kids) && !/sword/.test(horror), "no weapon among the examples a story that has none is shown");
  // drawn: no stunt; photoreal: nothing glows (the move's picture) and no beam (the writer)
  const drawn = markWriter({ drawn: true, childSafe: false, horror: false, lead: true });
  const photo = markWriter({ drawn: false, childSafe: false, horror: false, lead: true });
  assert.ok(!/stunt/.test(drawn) && !/stunt/.test(moveLine("Kai", "the Gale", { drawn: true, childSafe: false })));
  assert.ok(photo.includes("no beam") && moveLine("Kai", "the Gale", { drawn: false, childSafe: false }).includes("Nothing glows"));
  for (const o of [{ drawn: true, childSafe: false }, { drawn: false, childSafe: false }, { drawn: false, childSafe: true }]) {
    const l = moveLine("Kai", "the Gale", o);
    assert.ok(l.includes("never at the") && l.includes("Nobody is struck or hurt"), l);
  }
  assert.ok(moveLine("Kai", "the Gale", { drawn: false, childSafe: true }).endsWith(" It is a game: nobody is hit and nothing breaks."));
  assert.ok(moveLine("Kai", "the Gale", { drawn: true, childSafe: false }).includes("no second panel, no words"));
  // (the first drawn move came back with the blade already in the crate, a white flash and sparks — LOOKED at, 2026-11-26)
  assert.ok(moveLine("Kai", "the Gale", { drawn: true, childSafe: false }).includes("around it — never a flash, sparks, a glow or a beam of light. Nobody is struck or hurt — it is the instant before it lands, and nothing has been hit yet."));
  assert.ok(moveLine("Kai", "the Gale", { drawn: false, childSafe: false }).includes("it is the instant before it lands, and nothing has been hit yet."));
  // the lead, the tag's form, the chosen cast, the dealt name
  assert.ok(photo.startsWith("WHAT THEY ALWAYS HAVE. Each lead of this story has ONE thing they always have with them — worn or carried ("));
  assert.ok(photo.includes(`exactly so: [always: … | move: …] — leave out a part they do not have. An entry that already has one keeps it word for word.`));
  assert.ok(markWriter({ drawn: false, childSafe: false, horror: false, lead: false }).startsWith("WHAT THEY ALWAYS HAVE. A character may have ONE thing they always have with them, where it fits the story"));
  const chosen = markWriter({ drawn: false, childSafe: false, horror: false, lead: true, chosen: true });
  assert.ok(chosen.includes("A character may have ONE thing") && chosen.includes("and a character the maker chose is given none of their own."), "a picked face brings only its card's");
  const named = markWriter({ drawn: false, childSafe: false, horror: false, lead: true, name: "Tamsin", things: [{ thing: "a moth-eaten crimson cloak", seen: "the crimson cloak billowing", noun: "cloak" }] });
  assert.ok(named.includes(`("Tamsin, the crimson cloak billowing, …" — never only "Tamsin's cloak")`) && named.includes("(a moth-eaten crimson cloak)"));
  assert.ok(photo.includes("each one seen WIDE or FROM BELOW so that the whole body is in the frame") && photo.includes("never at a person, and nobody is hurt"));
  assert.ok(ORIGINAL_CAST.startsWith("EVERY CHARACTER IS OUR OWN:") && ORIGINAL_CAST.endsWith("Never write its name, its famous item or the name of its move."));
  // the lines a picture is told
  assert.equal(markLine("Kai", "a long cobalt scarf", 2), "Kai always has a long cobalt scarf: in this picture too, the same shape, size and colours as in reference image 2, worn or carried the same way — unless these words have Kai put it down.");
  assert.equal(portraitHas("Kai", "a long cobalt scarf"), " Kai always has a long cobalt scarf: it is clearly seen in this portrait — worn, held or carried where it shows from the front.");
});

test("the carries: Next episode and Edit story keep the tag whole, and the scene's move", () => {
  const long = `Bram Tolliver, a broad-shouldered ferryman in his fifties ${"with a weathered face and a patched oilskin coat ".repeat(6)}[always: a dented brass lantern on a long pole | move: the Long Reach — a lunge that hooks the lantern pole over a gap]`;
  assert.ok(long.length > 300);
  const body = JSON.stringify({ treatment: { title: "TEST Ferry", cast: [long, "Walter, an elderly watchman"], scenes: [] } });
  const chars = seriesCharacters(body);
  assert.ok(chars[0].length <= 200 && chars[0].endsWith("[always: a dented brass lantern on a long pole | move: the Long Reach — a lunge that hooks the lantern pole over a gap]"), chars[0]);
  assert.equal(chars[1], "Walter, an elderly watchman");
  const s = seriesFromPayload({ id: "s1", title: "TEST Ferry", episode: 2, recap: "The ferry crossed.", characters: [long] });
  assert.ok(s && s.characters[0] === chars[0], "the same through the queue");
  // Edit story: the cast list cut at 300 keeps the tag; a scene's move comes back with it
  const meta = JSON.stringify({ kind: "narrated", template: "fantasy", aspect: "9:16", captions: "bold" });
  const scenes = [1, 2, 3].map((n) => ({ visual: `WIDE: Bram on the jetty, part ${n}`, caption: `Line ${n} of the TEST story.`, ...(n === 2 ? { move: "Bram Tolliver" } : {}) }));
  const st = storyToEditFrom({ id: "t1", title: "TEST Ferry", metaJson: meta, bodyJson: JSON.stringify({ prompt: "a ferryman", treatment: { title: "TEST Ferry", musicMood: "folk", cast: [long], scenes } }) }, null);
  assert.ok(st);
  assert.ok(st!.treatment.cast[0].length <= 300 && st!.treatment.cast[0].endsWith("over a gap]"));
  assert.deepEqual(st!.treatment.scenes.map((x) => x.move), [undefined, "Bram Tolliver", undefined]);
  assert.ok(!("move" in st!.treatment.scenes[0]), "no move, no key");
});

test("wiring that cannot run here (no writer, no picture model locally) — pinned at the source", () => {
  const eng = read("app", "lib", "film-engine.server.ts");
  const fn = eng.slice(eng.indexOf("export async function previewFilmTreatment("), eng.indexOf("// ---- Assembly"));
  // the scene's move is asked for; the scene keeps it
  assert.ok(eng.includes("singer: { type: \"string\" }, move: { type: \"string\" } },"));
  assert.ok(eng.includes("  move?: string;\n}\nexport interface FilmTreatment {"));
  assert.ok(fn.includes("...(narrated && typeof s.move === \"string\" && s.move.trim() ? { move: s.move.replace(/\\s+/g, \" \").trim().slice(0, 40) } : {}),"));
  // a picked face's card: told only, at the END of its look, fit for the story — and nobody else's character in it
  assert.ok(fn.includes("const markFmt = { childSafe: !!tmpl.childSafe, horror: tmpl.key === \"horror\" };"));
  // (the picked names are never scrubbed out of anything — review of S16a: a member's own "Gojo" would match no face)
  assert.ok(fn.includes("const keepNames = (opts.cast || []).map((c) => (c?.name || \"\").trim().slice(0, 40)).filter(Boolean);") && fn.indexOf("const keepNames = ") < fn.indexOf("const picked = "));
  assert.ok(fn.includes("const cut = scrubFranchise((c?.desc || \"\").trim().replace(/\\s+/g, \" \"), keepNames).slice(0, 220);"));
  assert.ok(fn.includes("desc: narrated ? scrubFranchise(withMark(cut, markForFormat(markOf(c?.mark), markFmt)), keepNames) : cut,"));
  assert.ok(fn.includes("const typedIdea = scrubFranchise((opts.topic || \"\").trim(), keepNames);") && fn.indexOf("const typedIdea = ") < fn.indexOf("const nudged = "), "scrubbed before a starter is chosen from it");
  // the writer's lines: ORIGINAL_CAST after the idea (whole, plan) and the part's brief; markBrief after the cast — 3 each
  assert.ok(fn.includes("const markBrief = narrated && storyFormat ? `\\n${markWriter({ drawn: !!tmpl.drawn, childSafe: !!tmpl.childSafe, horror: tmpl.key === \"horror\", lead: markLead(tmpl.key, !!tmpl.drawn), chosen: castChosen.length > 0, name: exName, things: dealMarkThings(Math.random, { weapons: !tmpl.childSafe && tmpl.key !== \"horror\" }) })}` : \"\";"));
  const count = (s: string, x: string) => s.split(x).length - 1;
  assert.equal(count(fn, "(storyFormat ? `${ORIGINAL_CAST}\\n` : \"\") +"), 3);
  assert.equal(count(fn, "markBrief +\n"), 3);
  assert.ok(fn.includes("    ideaLine +\n    // EVERY CHARACTER IS OUR OWN"));
  assert.ok(fn.includes("    castLine +\n    threatBrief +\n    // WHAT THEY ALWAYS HAVE, and their moves (character-mark.ts → markWriter): a told story only\n    markBrief +\n"), "whole: right after the cast and the threat");
  assert.ok(fn.includes("      ideaLine +\n      // (every character our own") && fn.includes("      castLine +\n      threatBrief +\n      markBrief +\n      `\\n${AGES_FIT_RELATION}` +"), "the plan");
  assert.ok(fn.includes("seenAs: one!.seenAs }) +\n    // (every part is told") && fn.includes("    partCast +\n    partThreat +\n    markBrief +\n"), "each part");
  // the answer: the cast normalised; a chosen face keeps only its card's; a move only where somebody has one; the scrub
  assert.ok(fn.includes("const cast = Array.isArray(parsed.cast) ? parsed.cast.filter((c) => typeof c === \"string\" && c.trim()).slice(0, 5).map((e) => (narrated ? normalizeCastEntry(e, markFmt, 400, keepNames) : e)) : undefined;"));
  assert.ok(fn.includes("(typeof e === \"string\" ? franchiseIn(e, keepNames) : null)"));
  // (an entry the ages' second ask returned is made whole again, and gets back a tag it lost — review of S16a)
  const props = fn.slice(fn.indexOf("  // PROPS & MOVES, AS THE STORY LEAVES ITS WRITER"));
  assert.ok(props.includes("cast[i] = normalizeCastEntry(cast[i], markFmt, 400, keepNames);") && props.includes("if (was) cast[i] = setMarkIn(cast[i], was.mark);"));
  assert.ok(fn.indexOf("const marksWritten = ") > fn.indexOf("const cast = Array.isArray(parsed.cast)") && fn.indexOf("const marksWritten = ") < fn.indexOf("const problem = castAgeProblem("), "read before the ages' second ask");
  assert.ok(props.indexOf("normalizeCastEntry(cast[i]") < props.indexOf("if (own) cast[i] = setMarkIn("), "before a chosen face is given its card's");
  assert.ok(fn.includes("if (own) cast[i] = setMarkIn(cast[i], markForFormat(peelMark(own.desc).mark, markFmt));"));
  assert.ok(fn.includes("const movers = (cast || []).map((e) => castEntry(e)).filter((c) => !!c.name && !!c.mark?.move).map((c) => c.name);") && fn.includes("const moves = castMoves(list, movers);"));
  assert.ok(fn.includes("console.log(`[film] an existing character's name was taken out: \"${ip.word}\" → \"${ip.as}\"`);"));
  assert.ok(fn.includes("list = list.map((s) => ({ ...s, visual: scrubFranchise(s.visual, keepNames), ...(s.caption ? { caption: scrubFranchise(s.caption, keepNames) } : {}) }));") && fn.includes("outTitle = scrubFranchise(outTitle, keepNames);") && fn.includes("places = places.map((p) => scrubFranchise(p, keepNames));"));
  assert.ok(fn.includes(".map((t) => franchiseIn(t, keepNames)).find(Boolean)"));
  assert.ok(fn.indexOf("const moves = castMoves(list, movers);") > fn.indexOf("if (places.length) list = list.map((s, i) => ({ ...s, visual: placeNamed("), "after the places are named in the scenes");
  assert.ok(fn.indexOf("const moves = castMoves(list, movers);") < fn.indexOf("return { title: outTitle, scenes: list,"));

  const nar = read("app", "lib", "narrated-story.server.ts");
  // the last net: every picture ask, scrubbed whole
  assert.ok(nar.includes("const full = scrubFranchise(`${frameWords(aspect)} ${prompt} No watermark, no signature.`);"));
  const seeds = nar.slice(nar.indexOf("export async function narratedSceneSeeds("), nar.indexOf("/** The narrator reads the whole story."));
  assert.ok(seeds.includes("const marks = castMarks(o.treatment.cast || []);") && seeds.includes("const fit = markForFormat(m, { childSafe: !!tmpl.childSafe, horror: tmpl.key === \"horror\" }); if (fit) marks.set(k, fit); else marks.delete(k);"));
  const note = seeds.indexOf("here.forEach((c) => { const note = creatureNote(c.name, c.kind); if (note) notes.push(note); });");
  const mark = seeds.indexOf("here.forEach((c, n) => { const m = marks.get(c.name.trim().toLowerCase()); if (m?.has) notes.push(markLine(c.name, m.has, n + 1)); });");
  assert.ok(note > 0 && mark > note && mark < seeds.indexOf("notes.push(creatureHidden(c.name))"), "a forEach of its own, after the creature note");
  assert.ok(seeds.includes("const mover = scene.move ? here.find((c) => sameCharacter(c.name, scene.move!)) : undefined;"));
  assert.ok(seeds.includes("const mv = mover ? marks.get(mover.name.trim().toLowerCase())?.move : undefined;"));
  assert.ok(seeds.includes("if (mover && mv) notes.push(moveLine(mover.name, mv, { drawn: !!tmpl.drawn, childSafe: !!tmpl.childSafe }));"));
  assert.ok(seeds.includes("who[k].others.map((e) => pictureText(e, 200)).join(\"; and \")") && seeds.includes("unpictured.map((e) => pictureText(e, 200)).join(\"; and \")"));
  assert.ok(!seeds.includes("e.slice(0, 200)"), "no character said from words with its tag");
  // untouched: the scene note, the portrait call (portraitPrompt peels the tag itself)
  assert.ok(seeds.includes("here.forEach((c, n) => notes.push(`${c.name} is the character in reference image ${n + 1}${c.look ? ` (${c.look.slice(0, 160)})` : \"\"}.`));"));
  assert.ok(seeds.includes("const ask = portraitPrompt(dressedInWater(e), tmpl.sceneHint, safe);"));

  // the carries
  const series = read("app", "lib", "film-series.ts");
  assert.equal(series.split("fitEntry(oneLine(str(c)).replace(/<{3,}|>{3,}/g, \" \"), 200)").length - 1, 2, "both of the series' character cuts");
  const edit = read("app", "lib", "story-edit.ts");
  assert.ok(edit.includes("const castList = (Array.isArray(tr.cast) ? tr.cast : []).map((c) => fitEntry(oneLine(str(c)), 300)).filter(Boolean).slice(0, 8);"));
  assert.ok(edit.includes("...(oneLine(str(s.move)) ? { move: oneLine(str(s.move)).slice(0, 40) } : {}),"));
  // Another language copies each scene WHOLE ({ ...s, caption }): its move rides along with nothing to change there
  assert.ok(read("app", "lib", "story-translate.ts").includes("scenes: treatment.scenes.map((s, i) => ({ ...s, caption: told[i] }))"));
});

test("the leads, and the examples a story is dealt", () => {
  for (const k of MARK_LEAD_KEYS) assert.ok(GENRE_FILMS.some((g) => g.key === k), `${k} is a movie category`);
  assert.deepEqual([...MARK_LEAD_KEYS].sort(), ["action", "fantasy", "scifi", "thriller"]);
  assert.ok(markLead("fantasy", false) && !markLead("comedy", false) && !markLead("horror", false));
  for (const s of ANIME_STYLES) assert.ok(markLead(s.key, true), `${s.key}: every anime lead has one`);
  // dealt, three, nobody's, never a weapon where a story has none
  const seq = (xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };
  const a = dealMarkThings(seq([0, 0, 0]), { weapons: true });
  const b = dealMarkThings(seq([0.99, 0.5, 0.2]), { weapons: true });
  assert.equal(a.length, 3);
  assert.notDeepEqual(a, b, "not fixed");
  assert.equal(new Set(a.map((t) => t.thing)).size, 3);
  for (let k = 0; k < 40; k++) for (const t of dealMarkThings(Math.random, { weapons: false })) assert.ok(!WEAPON.test(t.thing), t.thing);
  for (const t of MARK_THINGS) {
    assert.equal(franchiseIn(t.thing), null, t.thing);
    assert.ok(t.thing.length <= MARK_HAS_MAX && !LETTERING.test(t.thing) && !REVEALING.test(t.thing), t.thing);
    assert.equal(!!t.weapon, WEAPON.test(t.thing), `${t.thing}: marked a weapon exactly when it is one`);
    assert.ok(t.seen.includes(t.noun), t.thing);
  }
});
