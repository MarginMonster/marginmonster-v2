/* FRESH EVERY TIME — the variety is dealt, not hoped for.
 *
 * The owner, 2026-11-24: "one fear id like to note also is the creativity and uniqueness of the writer, some
 * of the stories or character generic names seem to be similar or repetetive. This would be drastically
 * abundant for twisted horror also".
 *
 * Counted on his own shelf that day: 7 of 50 stories opened "They say…", 13 opened "Every morning / autumn /
 * evening…", and five different stories invented a "Mar—" name (Marion, Marla, Marren, Maren, Marta).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOOKS, HORROR_ENDINGS, HORROR_KINDS, MORAL_THEMES, MORAL_WORLDS, NAMES_F, NAMES_M, NAMES_SMALL, SHORT_KINDS, SHORT_PLACES, WORN_OPENERS,
  dealFresh, freshAngle, freshBrief, freshKeys, soundsLike, usedBefore,
} from "../app/lib/story-variety.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const dice = (seed: number) => { let s = (Math.imul(seed, 2654435761) ^ 0x9e3779b9) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

test("the pools are large, one word each, and hold none of the names a writer gives unasked", () => {
  assert.ok(NAMES_F.length >= 140 && NAMES_M.length >= 140 && NAMES_SMALL.length >= 50);
  for (const pool of [NAMES_F, NAMES_M, NAMES_SMALL]) {
    assert.equal(new Set(pool).size, pool.length, "nobody twice");
    for (const n of pool) assert.ok(/^[A-Z][a-z]{1,11}$/.test(n), `one plain word, easy to say: ${n}`);
  }
  // the ones counted on the owner's shelf, and a writer's other usual ones
  for (const worn of ["Marion", "Marla", "Maren", "Marren", "Marta", "Tobias", "Ines", "Edda", "Finn", "Pip", "Elara", "Mara", "Elias", "Silas", "Lena", "Nora", "Corin", "Luna", "Kai", "Bram"]) {
    assert.ok(![...NAMES_F, ...NAMES_M, ...NAMES_SMALL].includes(worn), worn);
  }
  // the decks: enough of each that two stories in a row are unlike
  assert.ok(HORROR_KINDS.length >= 28 && HORROR_ENDINGS.length >= 14 && MORAL_THEMES.length >= 24 && MORAL_WORLDS.length >= 20 && SHORT_KINDS.length >= 20 && SHORT_PLACES.length >= 18 && HOOKS.length >= 10);
  for (const deck of [HORROR_KINDS, HORROR_ENDINGS, MORAL_THEMES, MORAL_WORLDS, SHORT_KINDS, SHORT_PLACES]) assert.equal(new Set(deck.map((d) => d[0])).size, deck.length, "every key once");
  // every opener counted on the shelf is on the list of the refused
  for (const w of ["They say", "Every morning", "Every autumn", "Every evening", "Every week", "Once upon a time"]) assert.ok(WORN_OPENERS.includes(w), w);
});

test("names that sound alike are one name: the five Mar— stories", () => {
  assert.ok(soundsLike("Marla", "Marion") && soundsLike("Maren", "Marta") && soundsLike("marren", "MARLA"));
  assert.ok(soundsLike("Ines", "Ines") && soundsLike("Rosalind", "Rosa"));
  assert.ok(!soundsLike("Greta", "Hedda") && !soundsLike("Bao", "Feng") && !soundsLike("", "Greta"));
});

test("a story is dealt a hand: its own names, a kind of opening, and — per format — an angle never just used", () => {
  const used = { names: ["Marla", "Tobias", "Ines"], openers: ["They say the woods go quiet"], keys: ["kind:mirror", "ending:teller"] };
  for (let seed = 1; seed <= 300; seed++) {
    const f = dealFresh("horror", dice(seed), used, ["Howl"]);
    assert.equal(f.names.f.length, 5);
    assert.equal(f.names.m.length, 5);
    assert.equal(f.names.small.length, 4);
    for (const n of [...f.names.f, ...f.names.m, ...f.names.small]) {
      assert.ok(!["Marla", "Tobias", "Ines", "Howl"].some((u) => soundsLike(u, n)), `${n} sounds like one already used (seed ${seed})`);
    }
    assert.ok(HOOKS.includes(f.hook));
    assert.ok(f.kind && f.kind !== "mirror" && HORROR_KINDS.some((d) => d[0] === f.kind), `kind ${f.kind}`);
    assert.ok(f.ending && f.ending !== "teller" && HORROR_ENDINGS.some((d) => d[0] === f.ending), `ending ${f.ending}`);
    assert.equal(f.theme, undefined);
  }
  // dealt, not fixed: across stories the hands differ, and every kind of horror turns up
  const kinds = new Set<string>(), firsts = new Set<string>();
  for (let seed = 1; seed <= 400; seed++) { const f = dealFresh("horror", dice(seed)); kinds.add(f.kind!); firsts.add(f.names.f[0]); }
  assert.equal(kinds.size, HORROR_KINDS.length);
  assert.ok(firsts.size > 60, `${firsts.size} different first names led a hand`);
  // each story format has its own decks; a format without any is dealt names and an opening only
  const moral = dealFresh("moral", dice(5));
  assert.ok(moral.theme && moral.world && !moral.kind && !moral.ending);
  const short = dealFresh("testmovie", dice(5));
  assert.ok(short.kind && short.place && SHORT_KINDS.some((d) => d[0] === short.kind));
  const kids = dealFresh("kidstv", dice(5));
  assert.deepEqual(freshKeys(kids), []);
  assert.deepEqual(freshKeys(dealFresh("horror", dice(9))).map((k) => k.split(":")[0]), ["kind", "ending"]);
  assert.deepEqual(freshKeys(null), []);
});

test("what the writer is told: names from the hand, the opening, and an angle only where the idea leaves it open", () => {
  const fresh = dealFresh("horror", dice(11));
  const used = { names: ["Marla", "Marion"], openers: ["They say the woods go quiet right before"], keys: [] };
  const brief = freshBrief({ template: "horror", fresh, used, narrated: true, open: true, english: true });
  assert.ok(brief.startsWith("FRESH EVERY TIME — this must not read like the last story, or like anybody else's:\n• NAMES — every character YOU invent (never one of a cast already chosen) is named from this hand, dealt for this story alone;"));
  assert.ok(brief.includes(`women: ${fresh.names.f.join(", ")}; men: ${fresh.names.m.join(", ")};`));
  assert.ok(brief.includes("Never one of these, which this maker's stories have already used, nor a name that sounds like one: Marla, Marion."));
  assert.ok(brief.includes(`• THE OPENING — ${fresh.hook}. Never begin with "They say", "Legend has it", "Every morning",`));
  assert.ok(brief.includes('And not the way these began: "They say the woods go quiet right before…".'));
  assert.ok(brief.includes("• WHERE THE THEME LEAVES IT OPEN — the theme above always wins; but for whatever it does not decide, do not fall back on the usual: the kind of horror: "));
  assert.ok(brief.includes("; how it ends: "));
  // THE TITLE: six stories from one empty idea gave "The X That Y" three times and "The Thirteenth Z" twice
  assert.ok(brief.includes("• THE TITLE — two to five words, and its own: never \"The … That …\", never \"The … of …\" with a number in it (\"The Thirteenth …\", \"The Seventh …\"), never \"The Last …\" or \"The Keeper …\"."));
  assert.ok(!brief.includes("And unlike these earlier ones"), "nothing to steer away from yet");
  assert.ok(freshBrief({ template: "horror", fresh, used: { ...used, titles: ["The Buyer in the Glass", 'Say "Listen"'] }, narrated: true, open: true, english: true }).includes("And unlike these earlier ones in shape and in words: \"The Buyer in the Glass\", \"Say 'Listen'\"."));
  // an episode of a series keeps its own world: names and the opening only
  const episode = freshBrief({ template: "horror", fresh, used, narrated: true, open: false, english: true });
  assert.ok(episode.includes("• NAMES") && episode.includes("• THE OPENING") && !episode.includes("WHERE THE THEME LEAVES IT OPEN"));
  // an acted film has no storyteller's opening
  assert.ok(!freshBrief({ template: "horror", fresh, used, narrated: false, open: true, english: true }).includes("• THE OPENING"));
  // another language is asked for names natural to it — the English hand is not given
  const es = freshBrief({ template: "moral", fresh: dealFresh("moral", dice(2)), used, narrated: true, open: true, english: false, language: "Spanish" });
  assert.ok(es.includes("gets a name natural to Spanish that is not one of its ten most common.") && !es.includes("women: "));
  // a children's format names small somebodies first
  const kids = dealFresh("kidstv", dice(4));
  assert.ok(freshBrief({ template: "kidstv", fresh: kids, narrated: false, open: true, english: true, small: true }).includes(`for a creature, an animal or a small cartoon somebody: ${kids.names.small.join(", ")}`));
  // a show's next premise is dealt the KIND, not the ending (that is dealt to the story's own writer)
  assert.ok(/^the kind of horror: .+$/.test(freshAngle("horror", { ...fresh, ending: undefined })));
  assert.ok(freshAngle("moral", dealFresh("moral", dice(3))).startsWith("what it is about underneath: "));
  assert.equal(freshAngle("kidstv", kids), "");
});

test("what this maker's stories already used is read off the stories themselves", () => {
  const piece = (cast: string[], script: string, fresh?: Record<string, string>) => ({ bodyJson: JSON.stringify({ script, treatment: { cast, scenes: [{ caption: script }], ...(fresh ? { fresh } : {}) } }) });
  const used = usedBefore([
    piece(["Howl, a huge werewolf standing upright", "Marla, a lean camper in a mud-streaked olive jacket"], "I smelled her fear before I saw her, sharp and sour in the pines.", { hook: "open with a sound", kind: "outpost", ending: "carried" }),
    piece(["Old Edda — the clock keeper", "Mr. Alder, a baker", "marla, again"], "They say the woods go quiet right before something terrible happens."),
    piece(["OMAR: a seller", "Rosa (a seller)"], "OMAR: I saw it first, it is mine."),
    { bodyJson: "{" }, { bodyJson: null }, {},
  ]);
  assert.deepEqual(used.names, ["Howl", "Marla", "Edda", "Alder", "OMAR", "Rosa"], "the name each entry starts with — a title taken off, nobody twice");
  assert.deepEqual(used.openers, ["I smelled her fear before I saw", "They say the woods go quiet right"], "how each TOLD story began — a film's first line of dialogue is not an opening");
  assert.deepEqual(used.keys, ["kind:outpost", "ending:carried"]);
  assert.deepEqual(usedBefore([]), { names: [], openers: [], keys: [], titles: [] });
  // …and their titles — a story's own; an episode's title is its show's
  const titled = usedBefore([
    { bodyJson: JSON.stringify({ treatment: { title: "The Tide That Knows Your Name", scenes: [] } }) },
    { bodyJson: JSON.stringify({ treatment: { title: "Howl: Night tales — Episode 2: What Hunts the Hunter", scenes: [] } }) },
    { bodyJson: JSON.stringify({ treatment: { title: "the tide that knows your name", scenes: [] } }) },
  ]);
  assert.deepEqual(titled.titles, ["The Tide That Knows Your Name", "What Hunts the Hunter"], "an episode's OWN name counts; its show's name does not");
});

test("the writer is dealt its hand where the story is written — a story format only, and the cast it was given keeps its names", () => {
  const engine = read("app", "lib", "film-engine.server.ts");
  assert.ok(engine.includes("const storyFormat = !!tmpl.dialogue && !tmpl.lipSyncSinger && !tmpl.sung;"), "never a music video or a sing-along");
  assert.ok(engine.includes("usedByMaker = usedBefore(await db.asset.findMany({ where: { shopId: opts.shopId, type: \"VIDEO_AD\" }, orderBy: { createdAt: \"desc\" }, take: 14, select: { bodyJson: true } }));"), "this maker's own last stories");
  assert.ok(engine.includes("} catch { /* a story is written without the list */ }"), "never fatal");
  assert.ok(engine.includes("const keptNames = [...picked.map((c) => c.name), ...(series?.characters || []).map("), "the chosen cast and a series' own people keep their names");
  assert.ok(engine.includes("open: !series, english: langCode === \"en\", small: !!tmpl.childSafe, language: langName })"));
  // the example a cast is described by carries a DEALT name — the old one came back as a character
  assert.ok(!engine.includes("\"Pip, a cheerful"), "no fixed example name left in the writer's brief");
  assert.ok(engine.includes("(e.g. \"${exName}, ${exLook}\"; never a title") && engine.includes("(e.g. \"${exName}, ${exLook}\"). Every scene's VISUAL must feature"));
  // what it was dealt rides back on the treatment, so the next story is dealt something else
  assert.ok(engine.includes("const dealt = fresh ? { hook: fresh.hook, ...Object.fromEntries(freshKeys(series ? null : fresh).map((k) => k.split(\":\"))) } : null;"));
  assert.ok(engine.includes("...(dealt ? { fresh: dealt } : {}), ...(places.length ? { places } : {}), cast, ...(lineNote"));
  // Horror Story is photographed — its own poster is, and a story half painted, half photographed is two films
  assert.ok(engine.includes("a dark, moody, cinematic horror scene, photorealistic like a frame from a live-action horror film — deep shadows"));
});
