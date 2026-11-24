/* FRESH EVERY TIME — what keeps one story from sounding like the last.
 *
 * The owner, 2026-11-24: "one fear id like to note also is the creativity and uniqueness of the writer, some
 * of the stories or character generic names seem to be similar or repetetive. This would be drastically
 * abundant for twisted horror also".
 *
 * Measured on his own Archive that day (50 story pieces): 7 opened "They say…", 13 opened "Every morning /
 * autumn / evening…", and five different stories invented a "Mar—" name (Marion, Marla, Marren, Maren,
 * Marta). Two episodes of one werewolf's show, a day apart, were the same story: a woman alone in the woods,
 * and something worse than the werewolf behind her.
 *
 * A writer asked for "a name" gives the name it always gives; asked for "a scary story" it reaches for the
 * same three. Telling it to "be original" changes nothing. So the variety is DEALT, not hoped for:
 *
 *   · NAMES come from a hand dealt out of a large, mixed pool — a different hand every story — and never
 *     one this maker's stories have used;
 *   · THE OPENING is of a kind drawn for this story, and the worn openers are named and refused;
 *   · WHERE THE IDEA LEAVES IT OPEN, the kind of story, its world and — for horror — the kind of ENDING
 *     are drawn too, never one of the last few used. What the maker typed always wins over all of it.
 *
 * Pure: the caller reads the maker's earlier pieces and supplies the dice. tests/story-variety.test.ts. */

const oneLine = (s: unknown): string => (typeof s === "string" ? s : "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

/* ---- NAMES ---- one word each, easy to say aloud, from everywhere; none of a writer's usual ones. */
export const NAMES_F: readonly string[] = (
  "Agnes Beatrix Cordelia Dorothea Ottilie Winifred Philippa Rosalind Sybil Verity Greta Hedda Ingrid Solveig Astrid Dagny Signe Tove Maeve Bronagh " +
  "Catriona Morag Carys Bronwen Odile Margaux Solange Delphine Colette Josephine Bettina Annika Frieda Lotte Ursula Chiara Ottavia Serafina Vittoria Pilar " +
  "Consuelo Ximena Araceli Dolores Catalina Yolanda Zofia Halina Danuta Ludmila Vesna Milena Katya Oksana Darya Anoush Shirin Laleh Parisa Soraya " +
  "Yasmin Farida Nadira Amal Rania Samira Meera Kavita Lakshmi Indira Sunita Anjali Nandini Deepa Ayesha Sana Bushra Mei Lan Jia " +
  "Hana Emi Sachiko Noriko Chiyo Linh Thuy Malia Leilani Aroha Adaeze Ngozi Folake Abena Akosua Wanjiru Thandiwe Nomvula Makena Halima " +
  "Amina Safiya Desta Selam Marisol Itzel Jacinta Tallulah Winona Juniper Opal Pearl Mabel Edith Etta Lottie Nell Peggy Queenie Birdie " +
  "Goldie Trudy Wanda Tamsin Demelza Morwenna Hester Prudence Clementine Georgina Imelda Leonie Rhiannon Saskia Petra Brigid Fenella Isolde Lavinia Octavia " +
  "Rosamund Tabitha Zelda Yvette Bernadette Claudine Mireille Simone Paloma Rocio Lourdes Esperanza Graciela Nieves"
).split(" ");
export const NAMES_M: readonly string[] = (
  "Ambrose Barnaby Cornelius Desmond Ignatius Leopold Percival Rupert Thaddeus Wilfred Alaric Bertram Dunstan Godfrey Humphrey Lionel Mortimer Reginald Sylvester Auberon " +
  "Gunnar Halvard Leif Magnus Sigurd Torsten Anders Stellan Cormac Declan Fergus Lorcan Seamus Angus Callum Hamish Lachlan Gethin Emrys Rhodri " +
  "Anselm Bastien Etienne Gaspard Lucien Remy Thibault Yves Dieter Falk Gerhard Konrad Lothar Ulrich Wendel Aldo Dante Ettore Fausto Renzo " +
  "Alonso Braulio Eusebio Fermin Gonzalo Horacio Jacinto Lisandro Nicanor Octavio Ramiro Bogdan Casimir Dragan Goran Jaroslav Lubomir Miroslav Radek Stanislav " +
  "Vadim Yuri Arash Babak Dariush Farhad Kaveh Navid Omid Reza Faisal Hamza Idris Karim Malik Nabil Rashid Tariq Yusuf Zaid " +
  "Arjun Bhaskar Girish Harish Kiran Mohan Nikhil Pradeep Rajan Suresh Vikram Bilal Imran Junaid Usman Waqar Bao Feng Hiro Isamu " +
  "Jiro Kenji Masato Ryota Taro Minh Quang Tuan Manu Tane Chidi Emeka Obinna Tunde Kwame Kofi Kamau Otieno Sipho Themba " +
  "Bongani Jabari Abebe Tesfaye Caetano Elmer Clyde Earl Floyd Gus Hank Irving Lester Morris Ned Otis Roscoe Virgil Walt Wendell " +
  "Zeke Amos Enoch Gideon Jethro Obadiah"
).split(" ");
/** For a creature, an animal or a small cartoon somebody: short, and nobody's real name. */
export const NAMES_SMALL: readonly string[] = (
  "Bix Dabble Fen Moss Nib Pock Quill Sprig Tuck Wick Clover Dot Fig Hob Jib Kip Mote Nettle Pebble Rook " +
  "Snip Thistle Tansy Burr Cobble Dew Flit Gorse Inch Jot Knot Lark Mallow Oat Reed Sorrel Tumble Umber Vetch Whisk " +
  "Yarrow Zest Bodkin Crumb Dapple Fennel Gimlet Hopper Jinx Loam Midge Noggin Plum Scrap Tinder Wobble"
).split(" ");

/* ---- THE OPENING ---- */
export const HOOKS: readonly string[] = [
  "open in the middle of something already happening",
  "open on one specific, strange object",
  "open with a rule that must not be broken",
  "open with an exact time or an exact number",
  "open with a question the story then answers",
  "open with something somebody said, as the teller reports it",
  "open with something one of them will never admit",
  "open with a sound",
  "open with the aftermath, then go back to how it came to this",
  "open with one ordinary detail that is very slightly wrong",
  "open with what everybody in the place knows and never says",
  "open with one short sentence of five words or fewer",
];
/** The openers a writer reaches for unasked — every one of them counted on the owner's own shelf. */
export const WORN_OPENERS: readonly string[] = ["They say", "Legend has it", "Every morning", "Every night", "Every evening", "Every week", "Every autumn", "Once upon a time", "It was a", "In a small", "In a quiet", "There was once", "Nobody knew"];

/* ---- WHERE THE IDEA LEAVES IT OPEN ---- (each deck is [key, words]; the key is what the piece remembers) */
type Deck = ReadonlyArray<readonly [string, string]>;
export const HORROR_KINDS: Deck = [
  ["custom", "folk horror — an old custom a place still keeps, and what it is really for"],
  ["object", "a haunted object that changes hands"],
  ["double", "a double — somebody who looks exactly like a person they know, and is not"],
  ["noplace", "a place that should not be there: a floor, a door, a street on no map"],
  ["recording", "something recorded — a tape, a voicemail, a photograph — that shows more each time it is played"],
  ["water", "deep water, and what lives where the light stops"],
  ["walls", "the thing inside the walls of an ordinary home"],
  ["mirror", "a reflection that is a moment behind — or a moment ahead"],
  ["hour", "an hour that goes missing every night"],
  ["silence", "a town where everybody has agreed never to mention one thing"],
  ["invited", "a visitor who had to be invited in"],
  ["bargain", "a bargain made long ago, coming due tonight"],
  ["rules", "a set of rules that must be followed exactly — and the one nobody will explain"],
  ["debt", "a debt owed by a family, and the one it falls on"],
  ["nightshift", "the night shift somewhere that should be empty"],
  ["snowed", "winter isolation — snowed in, and counting heads"],
  ["inherit", "an inheritance: a house, a key, a locked room"],
  ["sound", "a sound that comes at the same time every night"],
  ["returned", "somebody who was missing and has come back — almost right"],
  ["loop", "the same night lived again, a little worse each time"],
  ["call", "a call from a number that cannot be calling"],
  ["bedside", "the figure at the foot of the bed that only one person can see"],
  ["lastride", "the last train, bus or ferry of the night, and its other passenger"],
  ["roadside", "a roadside stop on an empty road"],
  ["growing", "something growing where it should not — in a garden, a cellar, a body"],
  ["kindness", "a kindness done for a stranger, and what it let in"],
  ["job", "a job that pays far too well for what it asks"],
  ["mask", "a mask, a costume or a uniform that will not come off"],
  ["game", "a game with simple rules that grown people should never have started"],
  ["outpost", "a tower, a station or a lookout at the edge of things, and its log book"],
];
export const HORROR_ENDINGS: Deck = [
  ["protector", "what they feared was protecting them from something worse"],
  ["teller", "the one telling it is the danger"],
  ["keptin", "it was never trying to get in — it was keeping something in"],
  ["rescue", "the rescue is the trap"],
  ["rule", "the rule was followed exactly — and following it is what did it"],
  ["before", "it has all happened before, to this same person"],
  ["listener", "the last line turns to whoever is listening: they are next"],
  ["changed", "what was lost comes back, and is not the same"],
  ["paid", "somebody else already paid the price — and they are in the room"],
  ["two", "there were two of them all along"],
  ["safe", "the safe place is the worst place"],
  ["onewrong", "everything is put right — and then one small thing is wrong"],
  ["notwist", "no twist at all: exactly what was dreaded happens, slowly, and we watch"],
  ["carried", "they get away — and take it with them without knowing"],
  ["watched", "they were the one being waited for, from the very first line"],
  ["grief", "the monster is grieving, and that is worse"],
];
export const MORAL_THEMES: Deck = [
  ["gratitude", "gratitude that comes almost too late"], ["truth", "telling the truth when it costs something"], ["patience", "patience — the slow way was the fast way"],
  ["envy", "envy, and what it stops you seeing"], ["promise", "a promise kept when nobody would have known"], ["listening", "really listening"],
  ["pride", "pride, before a small and public fall"], ["unseen", "generosity with no audience"], ["sorry", "being the first to say sorry"],
  ["shortcut", "the shortcut that cost more"], ["compare", "comparing yourself to someone you do not really know"], ["daily", "a little, every day"],
  ["no", "saying no kindly"], ["stop", "knowing when to stop"], ["stranger", "kindness to somebody who cannot repay it"],
  ["hoard", "saving against hoarding"], ["basics", "the master who still practises the basics"], ["help", "asking for help"],
  ["quiet", "work that nobody sees"], ["trust", "trust, once broken, rebuilt slowly"], ["forgive", "forgiving yourself"],
  ["enough", "having enough"], ["gossip", "what gossip costs"], ["wait", "the reward that had to wait"],
  ["alone", "being the only one who says so"], ["credit", "giving the credit away"], ["fear", "anger that was really fear"],
  ["sure", "the thing you were certain of, and were wrong about"], ["luck", "luck against preparation"],
];
export const MORAL_WORLDS: Deck = [
  ["citynight", "people in a city at night"], ["market", "a market at dawn"], ["mountain", "a mountain village"], ["harbour", "a fishing harbour"],
  ["caravan", "a desert caravan stop"], ["workshop", "a workshop — a tailor's, a clockmaker's, a potter's"], ["kitchen", "the kitchen behind a busy restaurant"],
  ["nightbus", "a long-distance bus or a night train"], ["harvest", "a farm at harvest"], ["river", "a river crossing"], ["rooftop", "a rooftop garden"],
  ["woodland", "woodland animals"], ["wire", "birds on a wire above a street"], ["tidepool", "creatures of a tide pool"], ["meadow", "insects in a meadow"],
  ["waterhole", "animals at a water hole on the savannah"], ["barnyard", "barnyard animals"], ["reef", "sea creatures on a reef"], ["sled", "sled dogs in the far north"],
  ["rivals", "two rival shopkeepers"], ["apprentice", "an old craftsman and an apprentice"], ["siblings", "grown siblings who have not spoken in years"], ["shelter", "strangers sharing a shelter in a storm"],
];
export const SHORT_KINDS: Deck = [
  ["mystery", "a small mystery with an ordinary answer"], ["latelove", "a quiet love story between two people past fifty"], ["heist", "a heist that goes gently wrong"],
  ["road", "a road story — two people, one car, one long day"], ["firstday", "a first day at something"], ["lastday", "a last day at something"],
  ["kindghost", "a ghost story where the ghost is kind"], ["nearfuture", "a near-future moment — one small invention, one ordinary life"], ["underdog", "an underdog's one chance"],
  ["reunion", "a reunion that nearly did not happen"], ["rivalry", "a rivalry that turns into something else"], ["lateletter", "a letter that arrives decades late"],
  ["coincidence", "a coincidence too neat to be one"], ["delayed", "two strangers on a delayed train"], ["found", "something lost, and who finds it"],
  ["storm", "the night of a storm"], ["festival", "a festival in a small town"], ["recipe", "a recipe handed down, and what it carries"],
  ["newcountry", "somebody's first week in a new country"], ["secret", "a secret kept for someone else's sake"], ["wager", "a wager between friends"],
  ["oddjob", "a job nobody else wanted"], ["wrongnumber", "a wrong number"], ["wedding", "a wedding where one thing goes missing"],
];
export const SHORT_PLACES: Deck = [
  ["launderette", "a launderette at midnight"], ["hut", "a mountain hut"], ["allotment", "an allotment"], ["repair", "a repair shop"], ["nightmarket", "a night market"],
  ["arcade", "a seaside arcade in winter"], ["border", "a border crossing"], ["carpark", "a hospital car park"], ["radio", "a small radio station"], ["vineyard", "a vineyard at harvest"],
  ["truckstop", "a truck stop"], ["library", "a library on its last day"], ["gym", "a boxing gym"], ["flowers", "a flower stall"], ["observatory", "an observatory"],
  ["hotelkitchen", "a hotel kitchen"], ["depot", "a bus depot"], ["houseboat", "a houseboat"], ["postoffice", "a village post office"], ["cinema", "an old cinema"],
];

/** What one story was dealt: its names, the kind of opening, and — for a story format — its angle. The keys
 *  are what the piece remembers (treatment.fresh), so the next story is dealt something else. */
export type Fresh = { names: { f: string[]; m: string[]; small: string[] }; hook: string; kind?: string; ending?: string; theme?: string; world?: string; place?: string };
/** What this maker's earlier stories already used. */
export type Used = { names: string[]; openers: string[]; keys: string[]; titles?: string[] };

const lettersOf = (s: string): string => s.toLowerCase().replace(/[^\p{L}]/gu, "");
/** Do two names sound like each other? The same first three letters ("Marla" / "Marion" / "Maren"), or one
 *  inside the other. */
export const soundsLike = (a: string, b: string): boolean => {
  const x = lettersOf(a), y = lettersOf(b);
  if (!x || !y) return false;
  return x === y || x.slice(0, 3) === y.slice(0, 3) || (x.length > 3 && y.includes(x)) || (y.length > 3 && x.includes(y));
};

/** `n` different items of `pool` (an item `skip` refuses is left out), in the order they were drawn. */
function draw<T>(pool: ReadonlyArray<T>, n: number, rand: () => number, skip: (v: T) => boolean = () => false): T[] {
  const left = pool.filter((v) => !skip(v));
  const from = left.length >= n ? left : [...pool];
  const out: T[] = [];
  while (out.length < n && from.length) out.push(from.splice(Math.min(from.length - 1, Math.floor(rand() * from.length)), 1)[0]);
  return out;
}

/** The format's own decks: which angle a story of this kind is dealt. */
const anglesOf = (template: string): Array<{ field: "kind" | "ending" | "theme" | "world" | "place"; deck: Deck }> =>
  template === "horror" ? [{ field: "kind", deck: HORROR_KINDS }, { field: "ending", deck: HORROR_ENDINGS }]
    : template === "moral" ? [{ field: "theme", deck: MORAL_THEMES }, { field: "world", deck: MORAL_WORLDS }]
    : template === "testmovie" ? [{ field: "kind", deck: SHORT_KINDS }, { field: "place", deck: SHORT_PLACES }]
    : [];

/** Deal a story its hand. `used` is what the maker's earlier stories had; `keep` are names that must stay
 *  usable whatever was used before (the cast already chosen, a series' own cast). */
export function dealFresh(template: string, rand: () => number = Math.random, used: Used = { names: [], openers: [], keys: [], titles: [] }, keep: ReadonlyArray<string> = []): Fresh {
  const taken = [...used.names, ...keep];
  const clash = (n: string): boolean => taken.some((t) => soundsLike(t, n));
  const fresh: Fresh = {
    names: { f: draw(NAMES_F, 5, rand, clash), m: draw(NAMES_M, 5, rand, clash), small: draw(NAMES_SMALL, 4, rand, clash) },
    hook: draw(HOOKS, 1, rand)[0],
  };
  for (const a of anglesOf(template)) {
    const [key] = draw(a.deck, 1, rand, (d) => used.keys.includes(`${a.field}:${d[0]}`));
    if (key) fresh[a.field] = key[0];
  }
  return fresh;
}

const wordsOf = (deck: Deck, key: string | undefined): string => deck.find((d) => d[0] === key)?.[1] || "";
/** The keys a hand used, as a later story reads them back ("kind:mirror", "ending:teller"). */
export const freshKeys = (f: Partial<Fresh> | null | undefined): string[] =>
  (["kind", "ending", "theme", "world", "place"] as const).map((k) => (f && typeof f[k] === "string" && f[k] ? `${k}:${f[k]}` : "")).filter(Boolean);

/** What the writer is told. `o.narrated`: a storyteller's voice (it has an OPENING; an acted film does not).
 *  `o.open`: how much the maker left open — an episode of a series keeps its own world, so only names and
 *  the opening are dealt. `o.english`: the name hand is English-speaking; another language asks for names
 *  natural to it. `o.small`: the format's characters are creatures or small cartoon somebodies. */
export function freshBrief(o: { template: string; fresh: Fresh; used?: Used; narrated: boolean; open: boolean; english: boolean; small?: boolean; language?: string }): string {
  const f = o.fresh;
  const used = o.used || { names: [], openers: [], keys: [] };
  const lines: string[] = [];
  const avoid = used.names.slice(0, 24);
  const never = avoid.length ? ` Never one of these, which this maker's stories have already used, nor a name that sounds like one: ${avoid.join(", ")}.` : "";
  if (o.english) {
    const hand = o.small
      ? `for a creature, an animal or a small cartoon somebody: ${f.names.small.join(", ")}; for a person: ${[...f.names.f.slice(0, 2), ...f.names.m.slice(0, 2)].join(", ")}`
      : `women: ${f.names.f.join(", ")}; men: ${f.names.m.join(", ")}; a creature or an animal: ${f.names.small.slice(0, 3).join(", ")}`;
    lines.push(`• NAMES — every character YOU invent (never one of a cast already chosen) is named from this hand, dealt for this story alone; take the ones that suit its world: ${hand}. Any other name must be as uncommon as these.${never}`);
  } else {
    lines.push(`• NAMES — every character YOU invent gets a name natural to ${o.language || "the story's language"} that is not one of its ten most common.${never}`);
  }
  if (o.narrated) {
    const before = used.openers.slice(0, 6).map((s) => `"${s.replace(/"/g, "'")}…"`).join("; ");
    lines.push(`• THE OPENING — ${f.hook}. Never begin with ${WORN_OPENERS.map((w) => `"${w}"`).join(", ")}, or anything shaped like them.${before ? ` And not the way these began: ${before}.` : ""}`);
  }
  // THE TITLE: a writer left alone titles everything "The X That Y" or "The Thirteenth Z"
  const titled = (used.titles || []).slice(0, 8).map((s) => `"${s.replace(/"/g, "'")}"`).join(", ");
  lines.push(`• THE TITLE — two to five words, and its own: never "The … That …", never "The … of …" with a number in it ("The Thirteenth …", "The Seventh …"), never "The Last …" or "The Keeper …".${titled ? ` And unlike these earlier ones in shape and in words: ${titled}.` : ""}`);
  if (o.open) {
    const angle: string[] = [];
    if (o.template === "horror") {
      if (f.kind) angle.push(`the kind of horror: ${wordsOf(HORROR_KINDS, f.kind)}`);
      if (f.ending) angle.push(`how it ends: ${wordsOf(HORROR_ENDINGS, f.ending)}`);
    } else if (o.template === "moral") {
      if (f.theme) angle.push(`what it is about underneath: ${wordsOf(MORAL_THEMES, f.theme)}`);
      if (f.world) angle.push(`who and where: ${wordsOf(MORAL_WORLDS, f.world)}`);
    } else if (o.template === "testmovie") {
      if (f.kind) angle.push(`the kind of story: ${wordsOf(SHORT_KINDS, f.kind)}`);
      if (f.place) angle.push(`where: ${wordsOf(SHORT_PLACES, f.place)}`);
    }
    if (angle.length) lines.push(`• WHERE THE THEME LEAVES IT OPEN — the theme above always wins; but for whatever it does not decide, do not fall back on the usual: ${angle.join("; ")}.`);
  }
  return lines.length ? `FRESH EVERY TIME — this must not read like the last story, or like anybody else's:\n${lines.join("\n")}\n` : "";
}

/** One line of angle for a show's next episode — the idea-writer is dealt it, so episode 7 is not episode 3
 *  in another coat. "" for a format with no decks. */
export function freshAngle(template: string, f: Fresh): string {
  if (template === "horror") return [f.kind ? `the kind of horror: ${wordsOf(HORROR_KINDS, f.kind)}` : "", f.ending ? `how it ends: ${wordsOf(HORROR_ENDINGS, f.ending)}` : ""].filter(Boolean).join("; ");
  if (template === "moral") return [f.theme ? `what it is about underneath: ${wordsOf(MORAL_THEMES, f.theme)}` : "", f.world ? `who and where: ${wordsOf(MORAL_WORLDS, f.world)}` : ""].filter(Boolean).join("; ");
  if (template === "testmovie") return [f.kind ? `the kind of story: ${wordsOf(SHORT_KINDS, f.kind)}` : "", f.place ? `where: ${wordsOf(SHORT_PLACES, f.place)}` : ""].filter(Boolean).join("; ");
  return "";
}

/** What this maker's earlier pieces used: the names their stories invented, how each began, and the angles
 *  they were dealt. `rows` are assets (bodyJson holds the treatment and the told words), newest first. */
export function usedBefore(rows: ReadonlyArray<{ bodyJson?: unknown }>): Used {
  const names: string[] = [];
  const openers: string[] = [];
  const keys: string[] = [];
  const titles: string[] = [];
  for (const r of rows || []) {
    let b: unknown = r.bodyJson;
    if (typeof b === "string") { try { b = JSON.parse(b); } catch { continue; } }
    if (!b || typeof b !== "object" || Array.isArray(b)) continue;
    const body = b as Record<string, unknown>;
    const t = body.treatment && typeof body.treatment === "object" && !Array.isArray(body.treatment) ? (body.treatment as Record<string, unknown>) : {};
    for (const c of Array.isArray(t.cast) ? t.cast : []) {
      const n = oneLine(typeof c === "string" ? c.split(/[,:—–(]/)[0] : "").replace(/^(?:Mr|Mrs|Ms|Miss|Dr|Old|Young|Little|Aunt|Uncle|Grandma|Grandpa)\.?\s+/i, "");
      if (n && n.length <= 24 && /^\p{Lu}/u.test(n) && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
    }
    const scenes = Array.isArray(t.scenes) ? t.scenes : [];
    const first = oneLine(typeof body.script === "string" && body.script ? body.script : scenes[0] && typeof scenes[0] === "object" ? (scenes[0] as Record<string, unknown>).caption : "");
    // (an acted film's first words are "NAME: …" — that is a line, not a storyteller's opening)
    const open = first && !/^[\p{L}][\p{L} .'-]{0,30}:\s/u.test(first) ? first.split(" ").slice(0, 7).join(" ").replace(/[.,;:!?…]+$/, "") : "";
    if (open && !openers.some((x) => x.toLowerCase() === open.toLowerCase())) openers.push(open);
    for (const k of freshKeys(t.fresh as Partial<Fresh>)) if (!keys.includes(k)) keys.push(k);
    // (an episode's title is its show's or its series' — what is steered away from is its OWN name: three
    //  episodes of one show were "What Follows the Trail", "What Hunts the Hunter", "What Answers in the Pines")
    const whole = oneLine(t.title);
    const own = /\b(?:episode|ep\.?)\s*\d+\s*[:—–-]\s*(.+)$/i.exec(whole);
    const title = own ? oneLine(own[1]) : /\b(?:episode|ep\.?)\s*\d+\b/i.test(whole) ? "" : whole;
    if (title && title.length <= 70 && !titles.some((x) => x.toLowerCase() === title.toLowerCase())) titles.push(title);
  }
  return { names: names.slice(0, 40), openers: openers.slice(0, 8), keys: keys.slice(0, 16), titles: titles.slice(0, 8) };
}
