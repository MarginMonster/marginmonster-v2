/* PROPS & MOVES — the thing a character always has, and the move they are known for (SPEC-S16).
 *
 * The owner, 2026-11-26, four messages in a row: "Anime characters would have specific clothing's - specific props (like
 * luffy from one piece hat) Or goku and his signature moves yanno? This may need a a new category or addition to character
 * I'd cards (props) that often show in scenes" · "Specific swords or styles" · "You know what I mean" · "Keep working".
 *
 * A character is RECOGNISED by what comes back in every scene: the hat, the sword, the coat, the way they fight. He named
 * famous characters only as EXAMPLES of the idea. We never reproduce theirs — not their names, not their items, not their
 * moves: the app helps a member make ORIGINAL ones in that spirit (FRANCHISE, ORIGINAL_CAST, below).
 *
 * TWO PARTS, NOT FIVE (SPEC-S16 Decision 1): `has` — the one or two things they always wear or carry ("a long cobalt scarf
 * and a folded steel fan"); `move` — how they fight, or the one move they are known for, with a name of its own ("the Paper
 * Gale — a low spin that sweeps the open fan through the air"). Worn and carried things are drawn the same way (into the
 * one portrait every scene is drawn from, and said again in every scene they are in); only the move is different: words
 * for the writer, and one more line in the one or two scenes that show it. A sword is a thing they carry, not a field.
 *
 * WHY `mark` AND NEVER "signature" (in code or in a prompt): "signature" already means the designed VOICE (CastIdCard's
 * "Signature" voice word; web.presenters.tsx Member.signature) — and every picture ask ends "No watermark, no signature."
 * (narrated-story.server.ts → drawScene): a picture model told about "his signature sword" may write a signature on it.
 * The prompts here say "always has". Never "signature", "trademark" or "iconic" (tests/character-mark.test.ts reads it).
 *
 * WHERE IT RIDES: a tag at the END of the character's cast entry —
 *   "Kai, a lanky courier in his twenties with a black undercut [always: a long cobalt scarf and a folded steel fan | move:
 *    the Paper Gale — a low spin that sweeps the open fan through the air]"
 * The cast entry already goes everywhere a character goes (the writer's answer, the storyboard's approvedTreatment,
 * re-roll, recast, Edit story, Next episode, Another language), so nothing new is threaded through a job, a meta or a
 * token. It is at the END because a name is read from an entry's START (story-picture.ts castEntry, narrated-core
 * entryName, film-series leadName) — and A COMMA ALWAYS FOLLOWS THE NAME: those readers stop at the first comma, colon,
 * dash or bracket, and the tag has a colon, so "Kai [always: a scarf]" would be named "Kai [always" (withMark writes
 * "Kai, [always: a scarf]"). Everything that reads the LOOK peels the tag off first (story-picture.ts castEntry): the cast
 * token, the scene note, whoIsWho and characterKind see exactly the look they always saw.
 *
 * THE SAFETY RULES (SPEC-S16 Decision 6): a children's story never has a weapon (markForFormat drops it, and the writer is
 * told); a horror story has no move, and the writer gives no weapon; a move is aimed at a thing, an obstacle or the air,
 * never at a person, and nobody is hurt; what a character always has is never revealing and never carries writing
 * (markProblem refuses both at a member's save — S16c); in a photoreal story nothing they have glows and no move is magic.
 *
 * Pure: no imports. tests/character-mark.test.ts holds it. */

export type CharacterMark = { has?: string; move?: string };
/** "a long cobalt scarf and a folded steel fan" — said in every scene the character is in */
export const MARK_HAS_MAX = 60;
/** "the Paper Gale — a low spin that sweeps the open fan through the air" */
export const MARK_MOVE_MAX = 90;
/** A story shows a move in this many scenes at most: its biggest moments, one picture each. */
export const MOVE_SCENES_MAX = 2;

/* ---- reading and writing the tag ---- */

const oneLine = (s: string): string => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
/** The separators a name ends at (story-picture.ts castEntry, narrated-core entryName). */
const NAME_ENDS = /[,:—–(]/;

/** Cut to at most `max` characters at a word, from the start; no separator left hanging at the end. */
function headWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return (at > 0 ? cut.slice(0, at) : s.slice(0, max)).replace(/[\s,;:—–\-(/]+$/, "");
}

/** "signature", "trademark", "iconic" before a thing — and the article before them, set right for the word after. */
const BRAG = /(?<![\p{L}\p{N}])(?:(an?)\s+)?(?:signature|trademark|iconic)\s+(?=(\p{L}))/giu;

/** One part of a mark: one line, nothing that would break the tag ([, ] and |), no quotes round it, no full stop
 *  after it, cut at `max` on a word. */
function part(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  // (…and never "signature", "trademark" or "iconic" before the thing — a writer's favourite words, "[always: her signature
  //  crimson scarf]": said in every scene's line beside "No watermark, no signature.", a picture model may write a
  //  signature on the scarf. Review of S16a, 2026-11-26.)
  const s = oneLine(v.replace(/[[\]|]/g, " ").replace(BRAG, (_m, art: string | undefined, next: string) => (art ? `${/^[aeiou]/i.test(next) ? (art[0] === "A" ? "An" : "an") : art[0] === "A" ? "A" : "a"} ` : ""))).replace(/^["“”'‘]+|["“”]+$/g, "").replace(/[\s.,;:—–-]+$/, "").trim();
  return s.length > max ? headPhrase(s, max) : s;
}
/* …AND A PART CUT AT ITS MAX ENDS ON A WHOLE CLAUSE (2026-11-26, live — an anime story's lead: "[move: the kite-step, a
 * running leap off a ledge onto a taut cord, arms flung wide to catch the]"). Cut on a word, it may still end mid-phrase:
 * back to its last whole clause (a comma, a dash, a semicolon) when that keeps at least half of it, else the small words
 * left hanging at its end go ("…to catch the" → "…to catch"). Only a mark's parts: a look is cut as it always was. */
const DANGLING = /\s+(?:the|a|an|to|of|and|or|with|onto|into|at|in|on|for|by|from|his|her|their|its|as|that|which|who|while|then|so)$/i;
function headPhrase(s: string, max: number): string {
  let out = headWords(s, max);
  const clause = Math.max(out.lastIndexOf(", "), out.lastIndexOf(" — "), out.lastIndexOf("; "));
  if (clause >= max * 0.5) out = out.slice(0, clause);
  else for (let k = 0; k < 4 && DANGLING.test(out); k++) out = out.replace(DANGLING, "");
  return out.replace(/[\s,;:—–\-(/]+$/, "");
}

/** A mark, read checked: an object or a JSON string `{has, move}`. Each part one line, tidied and cut at its max on a
 *  word; an empty part dropped. null when nothing is left. */
export function markOf(raw: unknown): CharacterMark | null {
  let v: unknown = raw;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t.startsWith("{")) return null;
    try { v = JSON.parse(t); } catch { return null; }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const has = part((v as { has?: unknown }).has, MARK_HAS_MAX);
  const move = part((v as { move?: unknown }).move, MARK_MOVE_MAX);
  return has || move ? { ...(has ? { has } : {}), ...(move ? { move } : {}) } : null;
}

/** The tag: "[always: <has> | move: <move>]", or the one part it has; "" for none. */
export function markTag(m: CharacterMark | null | undefined): string {
  const k = markOf(m);
  if (!k) return "";
  return `[${[k.has ? `always: ${k.has}` : "", k.move ? `move: ${k.move}` : ""].filter(Boolean).join(" | ")}]`;
}

// (a tag the writer wrote: "[always: …]", "[Always : … | move: …]", "[move: …]" alone — and one cut off before its "]")
const TAG = /\[\s*(?:always|move)\s*:[^\]]*(?:\]|$)/i;
const LABEL = /(?:^|[|;])\s*(always|move)\s*:\s*/gi;

function findTag(text: string): { at: number; len: number; mark: CharacterMark | null } | null {
  const m = TAG.exec(text);
  if (!m) return null;
  const inner = m[0].replace(/^\[/, "").replace(/\]$/, "").trim();
  const labels = [...inner.matchAll(LABEL)].map((x) => ({ k: x[1].toLowerCase(), from: x.index ?? 0, to: (x.index ?? 0) + x[0].length }));
  const valueOf = (k: string): string => {
    const i = labels.findIndex((l) => l.k === k);
    return i < 0 ? "" : inner.slice(labels[i].to, i + 1 < labels.length ? labels[i + 1].from : inner.length);
  };
  return { at: m.index, len: m[0].length, mark: markOf({ has: valueOf("always"), move: valueOf("move") }) };
}

/** What is left of an entry once a tag is out of it: no double spaces, no space before a comma or a bracket, no comma
 *  (or colon, or dash) before an end. */
const tidyLeft = (s: string): string => oneLine(s)
  .replace(/\s+([,.;:!?)])/g, "$1")
  .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
  .replace(/\(\s+/g, "(")
  .replace(/[\s,;:—–-]+(?=\)|$)/g, "")
  .trim();

function peel(text: string): { text: string; mark: CharacterMark | null; found: boolean } {
  const s = String(text ?? "");
  const t = findTag(s);
  if (!t) return { text: s, mark: null, found: false };
  const before = s.slice(0, t.at);
  const after = s.slice(t.at + t.len);
  // (a tag written between the name and the look — "Kai [always: a scarf] a lanky courier" — leaves the name its comma)
  const joint = /\S/.test(before) && !NAME_ENDS.test(before) && /^\s*[^\s,:;.—–(]/.test(after) ? ", " : " ";
  return { text: tidyLeft(before + joint + after), mark: t.mark, found: true };
}

/** The FIRST tag taken out of a string, wherever it is (capitals and spaces tolerated), and what is left, tidied. A
 *  string with no tag comes back exactly as it was. */
export function peelMark(text: string): { text: string; mark: CharacterMark | null } {
  const p = peel(text);
  return { text: p.text, mark: p.mark };
}

/** The text without any tag, then the mark's tag — after a comma when nothing else ends the name. Over `max`, the TEXT
 *  is cut (at a word), never the tag. With no mark it is the text as it was, cut exactly as `.slice(0, max)` would. */
export function withMark(text: string, mark: CharacterMark | null | undefined, max = Infinity): string {
  let body = String(text ?? "");
  for (let k = 0; k < 6; k++) { const p = peel(body); if (!p.found) break; body = p.text; }
  const tag = markTag(mark);
  if (!tag) return body.slice(0, Math.max(0, max));
  const join = (b: string): string => (b ? `${b}${NAME_ENDS.test(b) ? " " : ", "}${tag}` : tag);
  const whole = join(body);
  return whole.length <= max ? whole : join(headWords(body, Math.max(0, max - tag.length - 2)));
}

/** A cast entry cut to `max` that keeps its tag whole (the series' characters at 200, Edit story's cast list at 300).
 *  An entry with no tag is exactly `entry.slice(0, max)` — no word boundary — so every entry written before props is
 *  carried byte for byte as it was. */
export function fitEntry(entry: string, max: number): string {
  const p = peel(entry);
  return withMark(p.text, p.mark, max);
}

/** The entry with its tag replaced (S16b's "Draw {name} again" after the thing is changed); null takes it out. */
export function setMarkIn(entry: string, mark: CharacterMark | null | undefined): string {
  return withMark(peel(entry).text, mark);
}

/** What a picture may be told about a character drawn from WORDS (no portrait of its own): the entry without its tag,
 *  and ", always with <has>" when it has one. Never the move — that is only for the one scene that shows it. An entry
 *  with no tag comes back exactly as it was — cut at `max` exactly as `.slice(0, max)` would be.
 *  (Cut at `max`, the BODY is cut at a word and never the thing: a writer's entry runs 150-250 characters, and the
 *   scene lines that say it are cut at 200 — "…, always with a long cobalt scarf" at the end was cut off from most of
 *   them. Review of S16a, 2026-11-26.) */
export function pictureText(entry: string, max = Infinity): string {
  const p = peel(entry);
  if (!p.found) return p.text.slice(0, Math.max(0, max));
  let body = p.text;
  for (let k = 0; k < 6; k++) { const q = peel(body); if (!q.found) break; body = q.text; }
  const has = p.mark?.has;
  if (!has) return body.length <= max ? body : headWords(body, Math.max(0, max));
  const tail = `always with ${has}`;
  const whole = `${body}${body ? ", " : ""}${tail}`;
  if (whole.length <= max) return whole;
  const cut = headWords(body, Math.max(0, max - tail.length - 2));
  return `${cut}${cut ? ", " : ""}${tail}`.slice(0, Math.max(0, max));
}

/* ---- the safety readers ---- */

const B = "(?<![\\p{L}\\p{N}])";
const E = "(?![\\p{L}\\p{N}])";
/** A weapon named. Never "club" (a golf club) or "staff" (a walking staff); not a shoulder blade, a roller blade, a
 *  blade of grass, a sabre-toothed cat or a bubble gun. */
export const WEAPON = new RegExp(`${B}(?:${[
  "swords?", "katanas?", "sabres?(?!-tooth)", "sabers?(?!-tooth)", "(?<!roller[\\s-]?)(?<!shoulder\\s)blades?(?!\\s+of\\s+grass)",
  "daggers?", "knife", "knives", "axes?", "hatchets?", "spears?", "lances?", "halberds?", "scythes?", "maces?",
  "nunchakus?", "shuriken", "throwing\\s+stars?", "bows?\\s+and\\s+arrows?", "arrows?", "crossbows?",
  "(?<!bubble\\s)guns?", "pistols?", "revolvers?", "rifles?", "shotguns?", "(?<!bubble\\s)blasters?", "whips?", "war[\\s-]?hammers?",
].join("|")})${E}`, "iu");
/** A revealing word: what a character always has is never one (the unclothed check, fault 40, would trip in every
 *  picture — and anime must never meet the open "cast sex appeal" ask: anime-styles.ts). */
export const REVEALING = new RegExp(`${B}(?:bikinis?|lingerie|underwear|thongs?|topless|shirtless|bare[\\s-]?chested|nude|naked|see[\\s-]?through|skimpy)${E}`, "iu");
/** Writing on a thing: every told picture is told NOTHING_WRITTEN, and a "jersey with the number 9" fights it in every
 *  scene. On word boundaries: "sword" is not "word". */
export const LETTERING = new RegExp(`${B}(?:letters?|lettering|words?|writing|written|kanji|logos?|initials?|numbers?|numbered|name[\\s-]?tags?|text)${E}`, "iu");

/** A mark as a story of this kind may have it:
 *   · a children's story never has a weapon — a `has` that names one is dropped, and so is the move that went with it
 *     (a member's swordsman in a kids story keeps his face, without the sword, and without the sword's move); a move
 *     that names one is dropped;
 *   · a horror story has no move (the craft is the unseen threat; a hero's move turns suspense into a slasher) — the
 *     `has` stays, and the writer is told a weapon in it stays sheathed;
 *   · anything else, unchanged. */
export function markForFormat(m: CharacterMark | null | undefined, o: { childSafe: boolean; horror: boolean }): CharacterMark | null {
  const k = markOf(m);
  if (!k) return null;
  let { has, move } = k;
  if (o.childSafe) {
    if (has && WEAPON.test(has)) { has = undefined; move = undefined; }
    if (move && WEAPON.test(move)) move = undefined;
  }
  if (o.horror) move = undefined;
  return has || move ? { ...(has ? { has } : {}), ...(move ? { move } : {}) } : null;
}

/* ---- THE IP TABLE ----
 * Words that mean nothing BUT someone else's character, item, move, show, game or studio — each with the KIND of thing
 * it is, which is what our own will be. THE RULE FOR ADDING A ROW: never an ordinary word or a common first name — leave
 * out Link, Mario, Elsa, Bleach, Frozen, Marvel, Thor, Sonic, Zelda, or catch them only in a form that cannot be anything
 * else ("Super Mario", "Sonic the Hedgehog", "Legend of Zelda"). A title that is also an everyday phrase is matched only
 * with its capitals ("One Piece" — "a one-piece swimsuit" is not it; "a street fighter", "a demon slayer", "a death
 * note", "a master sword" are ordinary words). Public-domain legend is fine: never Excalibur, Robin Hood, Dracula — nor a
 * king of Hawaii ("King Kamehameha").
 * (…and never in ALL CAPITALS for those: a member who types in capitals has no capitals to read — "ONE PIECE OF CAKE
 *  LEFT" was "a pirate adventure OF CAKE LEFT". A place keeps its kind too: "our trip to Disney World" is a theme park,
 *  never "an animated film World". Review of S16a, 2026-11-26.) */
const S = "[\\s-]?";
const SP = "[\\s-]+";
const row = (src: string, word: string, as: string, caseSensitive = false): { re: RegExp; word: string; as: string } => ({ re: new RegExp(`${B}(?:${src})${E}`, caseSensitive ? "u" : "iu"), word, as });
export const FRANCHISE: ReadonlyArray<{ re: RegExp; word: string; as: string }> = [
  row("Luffy", "Luffy", "a young pirate"),
  row("Zoro", "Zoro", "a swordsman"),
  row(`(?:Son${SP})?Goku`, "Goku", "a martial artist"),
  row("Vegeta", "Vegeta", "a proud rival fighter"),
  row("Naruto", "Naruto", "a young ninja"),
  row("Sasuke", "Sasuke", "a rival ninja"),
  row("Kakashi", "Kakashi", "a masked teacher"),
  row("Ichigo", "Ichigo", "a young swordsman"),
  row("Tanjir[oō]u?", "Tanjiro", "a young swordsman"),
  row("Nezuko", "Nezuko", "a quiet girl"),
  row("Pikachu", "Pikachu", "a small creature"),
  row("Goj[oō]", "Gojo", "a sorcerer"),
  row("Doraemon", "Doraemon", "a robot cat"),
  row("Totoro", "Totoro", "a big forest spirit"),
  row(`Sailor${SP}Moon`, "Sailor Moon", "a magical girl"),
  row(`Spider${S}Man`, "Spider-Man", "a masked hero"),
  row("Batman", "Batman", "a caped hero"),
  row("Superman", "Superman", "a flying hero"),
  row(`Darth${SP}Vader`, "Darth Vader", "a masked villain"),
  row(`Harry${SP}Potter`, "Harry Potter", "a young wizard"),
  row(`Mickey${SP}Mouse`, "Mickey Mouse", "a cartoon mouse"),
  row("Shrek", "Shrek", "a friendly ogre"),
  row(`Super${SP}Mario(?:${SP}(?:Bros|Brothers))?`, "Super Mario", "a plumber hero"),
  row(`Sonic${SP}the${SP}Hedgehog`, "Sonic the Hedgehog", "a fast hedgehog"),
  row(`(?:The${SP})?Legend${SP}of${SP}Zelda`, "Legend of Zelda", "a fantasy adventure"),
  row("Pok[eé]mons?", "Pokémon", "pocket creatures"),
  row("(?<!King\\s)Kamehameha", "Kamehameha", "an energy blast"),
  row("Rasengan", "Rasengan", "a spinning ball of wind"),
  row("Chidori", "Chidori", "a lightning strike"),
  row("Sharingan", "Sharingan", "a strange eye"),
  row("Bankai", "Bankai", "a powered-up form"),
  row(`Super${SP}Saiyans?`, "Super Saiyan", "a powered-up form"),
  row("Saiyans?", "Saiyan", "a powered-up form"),
  row("Hadou?ken", "Hadouken", "an energy blast"),
  row("Sh[oō]ry[uū]ken", "Shoryuken", "a rising uppercut"),
  row(`Gomu${S}Gomu`, "Gomu Gomu", "a stretching punch"),
  row(`Getsuga(?:${SP}Tensh[oō])?`, "Getsuga", "a slash of energy"),
  row(`light${S}sab(?:er|re)s?`, "lightsaber", "an energy sword"),
  row("Mj[oö]lnir", "Mjolnir", "a war hammer"),
  row("Keyblades?", "Keyblade", "a key-shaped sword"),
  row("Expelliarmus", "Expelliarmus", "a spell"),
  row(`Avada${SP}Kedavra`, "Avada Kedavra", "a spell"),
  row(`Death${SP}Note`, "Death Note", "a black notebook", true),
  row(`Infinity${SP}Gauntlet`, "Infinity Gauntlet", "a jewelled gauntlet"),
  row(`Master${SP}Sword`, "Master Sword", "an old sword", true),
  row(`One${SP}Piece`, "One Piece", "a pirate adventure", true),
  row(`Dragon${SP}Ball(?:${SP}(?:Z|GT|Super))?`, "Dragon Ball", "a martial-arts adventure", true),
  row("Dragonball(?:\\s?Z)?", "Dragon Ball", "a martial-arts adventure"),
  row(`Demon${SP}Slayer`, "Demon Slayer", "a sword adventure", true),
  row(`Jujutsu${SP}Kaisen`, "Jujutsu Kaisen", "a sorcery adventure"),
  row(`Attack${SP}on${SP}Titan`, "Attack on Titan", "a story of giants"),
  row(`My${SP}Hero${SP}Academia`, "My Hero Academia", "a hero-school story"),
  row(`Hunter${S}[x×]${S}Hunter`, "Hunter x Hunter", "an adventure"),
  row(`Sword${SP}Art${SP}Online`, "Sword Art Online", "a game-world adventure"),
  row(`(?:Neon${SP}Genesis${SP})?Evangelion`, "Evangelion", "a giant-robot story"),
  row("Gundams?", "Gundam", "a giant robot"),
  row(`Star${SP}Wars`, "Star Wars", "a space adventure"),
  row("Jedis?", "Jedi", "a knight"),
  row("Hogwarts", "Hogwarts", "a school of magic"),
  row(`Street${SP}Fighter`, "Street Fighter", "a fighting game", true),
  row(`Mortal${SP}Kombat`, "Mortal Kombat", "a fighting game"),
  row("Fortnite", "Fortnite", "a game"),
  row("Minecraft", "Minecraft", "a world of blocks"),
  row(`Studio${SP}Ghibli`, "Studio Ghibli", "hand-painted anime"),
  row("Ghibli", "Ghibli", "hand-painted anime"),
  row(`(?:Walt${SP})?Disney${S}(?:World|Land)|Disneyland`, "Disney World", "a theme park"),
  row(`Walt${SP}Disney`, "Walt Disney", "an animated film"),
  row("Disney", "Disney", "an animated film"),
  row("Pixar", "Pixar", "an animated film"),
];

/** A found word that is (a word of) one of `keep` — the names of the characters the MAKER picked. Never taken out of
 *  what is written: a picked name is matched by its exact spelling everywhere after (the writer's name rules, the
 *  portrait it is drawn from, the scene notes), and a member's own "Gojo Tanaka" made before the card's door refused such
 *  a name (S16c) would be renamed "a sorcerer" in the cast and every scene, and drawn in none. (Review of S16a.) */
function kept(found: string, keep: ReadonlyArray<string> | undefined): boolean {
  if (!keep || !keep.length) return false;
  const esc = found.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const re = new RegExp(`${B}${esc}${E}`, "iu");
  return keep.some((k) => !!k && re.test(k));
}

/** The first word in `text` that is someone else's character, item, move, show, game or studio — and the kind of thing
 *  it is. null when there is none. (`keep`: the picked cast's names, never counted — see `kept`.) */
export function franchiseIn(text: string | null | undefined, keep?: ReadonlyArray<string>): { word: string; as: string } | null {
  const t = String(text ?? "");
  let best: { at: number; len: number; word: string; as: string } | null = null;
  for (const r of FRANCHISE) {
    const g = new RegExp(r.re.source, `${r.re.flags}g`);
    for (const m of t.matchAll(g)) {
      if (kept(m[0], keep)) continue;
      const at = m.index ?? 0;
      if (!best || at < best.at || (at === best.at && m[0].length > best.len)) best = { at, len: m[0].length, word: r.word, as: r.as };
      break;
    }
  }
  return best ? { word: best.word, as: best.as } : null;
}

const ARTICLE = /^(?:a|an|the)\s/i;
/** Every one of them replaced by its kind, the sentence kept readable: "a Goku" → "a martial artist" (no double
 *  article), "two Jedis" → "two knights". (`keep`: the picked cast's names, left as they are — see `kept`.) */
export function scrubFranchise(text: string | null | undefined, keep?: ReadonlyArray<string>): string {
  let out = String(text ?? "");
  for (const r of FRANCHISE) {
    const g = new RegExp(r.re.source, `${r.re.flags}g`);
    if (!g.test(out)) continue;
    g.lastIndex = 0;
    let built = "";
    let last = 0;
    for (const m of out.matchAll(g)) {
      if (kept(m[0], keep)) continue;
      let before = out.slice(last, m.index);
      let as = r.as;
      // (more than one of them: "two lightsabers" → "two energy swords")
      if (/s$/i.test(m[0]) && !/s$/i.test(r.word) && /^an?\s/i.test(as)) as = `${as.replace(/^an?\s+/i, "")}s`;
      if (ARTICLE.test(as)) before = before.replace(/(^|[^\p{L}\p{N}])(?:a|an|the)\s+$/iu, "$1");
      // (…and a kind with no article of its own is no longer "a" one: "a Pokémon" → "pocket creatures")
      else before = before.replace(/(^|[^\p{L}\p{N}])an?\s+$/iu, "$1");
      built += before + as;
      last = (m.index ?? 0) + m[0].length;
    }
    out = built + out.slice(last);
  }
  return out;
}

/** What is wrong with a mark a MEMBER typed, before it is saved (S16c): someone else's character, item or move first
 *  (with the kind of thing to make instead); then writing on what they always have; then anything revealing. null when
 *  nothing is. */
export function markProblem(m: CharacterMark | null | undefined): { kind: "franchise"; word: string; as: string } | { kind: "lettering" | "revealing" } | null {
  const has = String(m?.has ?? "");
  const move = String(m?.move ?? "");
  const f = franchiseIn(has) || franchiseIn(move);
  if (f) return { kind: "franchise", word: f.word, as: f.as };
  if (LETTERING.test(has)) return { kind: "lettering" };
  if (REVEALING.test(has) || REVEALING.test(move)) return { kind: "revealing" };
  return null;
}

/** A cast entry as it leaves the writer of a TOLD story: someone else's character taken out, one line, the tag moved
 *  to the END with its parts capped and fit for the story (markForFormat), a comma after the name, at most `max`
 *  characters with the tag whole. An entry with no tag is only scrubbed, made one line and cut at `max`.
 *  (A writer that wrote its two parts as two tags — "[always: a scarf] [move: the Gale — a spin]" — keeps both: the
 *  first of each part is kept. `keep`: the picked cast's names, never scrubbed — see `kept`.) */
export function normalizeCastEntry(e: string, fmt: { childSafe: boolean; horror: boolean }, max = 400, keep?: ReadonlyArray<string>): string {
  let p = peel(oneLine(scrubFranchise(e, keep)));
  let mark: CharacterMark | null = p.mark;
  for (let k = 0; k < 5 && p.found; k++) {
    const q = peel(p.text);
    if (!q.found) break;
    mark = markOf({ has: mark?.has || q.mark?.has, move: mark?.move || q.mark?.move });
    p = q;
  }
  return withMark(p.text, markForFormat(mark, fmt), max);
}

/** Which scenes show a move, as the writer marked them — each kept only when it names somebody whose entry HAS a move
 *  (`movers`, as the cast spells them), and only the first MOVE_SCENES_MAX of them. Returns, for each scene, the name
 *  it shows, or undefined. */
export function castMoves(scenes: ReadonlyArray<{ move?: unknown } | null | undefined>, movers: ReadonlyArray<string>): Array<string | undefined> {
  let n = 0;
  return scenes.map((s) => {
    const want = typeof s?.move === "string" ? oneLine(s.move).replace(/['’]s$/i, "").toLowerCase() : "";
    if (!want || n >= MOVE_SCENES_MAX) return undefined;
    const who = movers.find((m) => m.trim().toLowerCase() === want) || movers.find((m) => m.trim().toLowerCase().split(" ")[0] === want);
    if (!who) return undefined;
    n++;
    return who;
  });
}

/* ---- THE WORDS ---- */

/** EVERY STORY FORMAT'S WRITER, told and acted, whole, plan and part (film-engine.server.ts) — modelled on
 *  ORIGINAL_LYRICS_RULE. A named or DESCRIBED famous character is only a hint at the KIND of hero: this is the layer that
 *  catches a described copy no word list can (a straw hat with a red band and a scar under one eye). PREMISE_WINS ("the
 *  idea is the story") stays; this says what it means for someone else's character. */
export const ORIGINAL_CAST =
  "EVERY CHARACTER IS OUR OWN: when the idea names or describes a character, a show, a film, a game or a move that already exists, it is only a hint at the KIND of story and of hero. Write an original character with a new name, and a look, a thing and a move of their own — different in shape, colour and name, so that nobody would think of that one. Never write its name, its famous item or the name of its move.";

/** The kinds of thing a character may always have, shown to the writer as examples. DEALT for each story (three of
 *  them), never fixed: a fixed example comes back as the story — the cast example's "Pip" came back as a character's
 *  name in story after story, and an acted film's fixed event example came back as its events (film-engine.server.ts →
 *  exName, eventIdeas). None of them is anybody else's: no straw hat, no orange suit, no headband with a symbol. */
export const MARK_THINGS: ReadonlyArray<{ thing: string; seen: string; noun: string; weapon?: true }> = [
  { thing: "a long cobalt scarf", seen: "the cobalt scarf whipping behind", noun: "scarf" },
  { thing: "a dented brass lantern", seen: "the brass lantern held high", noun: "lantern" },
  { thing: "a red-lacquered wooden sword across the back", seen: "the red wooden sword across the back", noun: "sword", weapon: true },
  { thing: "a battered leather satchel stuffed with maps", seen: "the leather satchel bumping at the hip", noun: "satchel" },
  { thing: "round brass goggles pushed up on the forehead", seen: "the brass goggles pushed up", noun: "goggles" },
  { thing: "a moss-green raincoat with deep pockets", seen: "the green raincoat flapping", noun: "raincoat" },
  { thing: "a knotted walking staff of pale ash", seen: "the ash staff planted in the mud", noun: "staff" },
  { thing: "a folded steel fan", seen: "the steel fan snapped open", noun: "fan" },
  { thing: "a moth-eaten crimson cloak", seen: "the crimson cloak billowing", noun: "cloak" },
  { thing: "a patched canvas tool belt", seen: "the tool belt slung low", noun: "belt" },
  { thing: "a bright yellow kite rolled under one arm", seen: "the yellow kite under one arm", noun: "kite" },
  { thing: "a grey felt hat with a jay's feather in the band", seen: "the grey felt hat pulled low", noun: "hat" },
];
/** The three examples a story is shown: dealt from MARK_THINGS by `rand` — never a weapon for a children's story or a
 *  horror story (both are told "never a weapon"). */
export function dealMarkThings(rand: () => number, o: { weapons: boolean }, n = 3): Array<{ thing: string; seen: string; noun: string }> {
  const pool = MARK_THINGS.filter((t) => o.weapons || !t.weapon).slice();
  const out: Array<{ thing: string; seen: string; noun: string }> = [];
  while (out.length < n && pool.length) {
    const t = pool.splice(Math.min(pool.length - 1, Math.floor(Math.max(0, rand()) * pool.length)), 1)[0];
    out.push({ thing: t.thing, seen: t.seen, noun: t.noun });
  }
  return out;
}
/** The examples the design was written with (SPEC-S16), when none are dealt. */
const FIRST_THINGS = MARK_THINGS.slice(0, 3);

/** The told genres whose every lead has one thing (the others MAY: "where it fits the story"). Every anime style is
 *  drawn, and every drawn lead has one (markLead). Keys of GENRE_FILMS (film-genres.ts). */
export const MARK_LEAD_KEYS: ReadonlySet<string> = new Set(["fantasy", "scifi", "thriller", "action"]);
export const markLead = (tmplKey: string | null | undefined, drawn: boolean): boolean => drawn || MARK_LEAD_KEYS.has(String(tmplKey || ""));

/** WHAT A TOLD STORY'S WRITER IS TOLD about what its characters always have, and their moves (film-engine.server.ts —
 *  the whole story, its plan and each part). `chosen`: the maker picked the cast — a face picked from its card brings
 *  only what its card gives it (SPEC-S16 Decision 2): its reference is its own photo, which shows nothing new, and a
 *  thing said only in words is drawn differently in every picture (the places proved it: story-picture.ts). `name` is
 *  the story's dealt example name, `things` its dealt examples (dealMarkThings). */
export function markWriter(o: { drawn: boolean; childSafe: boolean; horror: boolean; lead: boolean; chosen?: boolean; invent?: boolean; name?: string; things?: ReadonlyArray<{ thing: string; seen: string; noun: string }> }): string {
  const noWeapon = o.childSafe || o.horror;
  const things = (o.things && o.things.length ? o.things : FIRST_THINGS).filter((t) => !noWeapon || !WEAPON.test(t.thing));
  const ex = things[0] || FIRST_THINGS[0];
  const name = String(o.name || "").replace(/["“”]/g, "").trim() || "Kai";
  // NOTHING INVENTED (2026-11-26 — every story that is not drawn: film-engine.server.ts → inventMarks). Only a character the
  // maker chose can have a tag, from their own card: the writer keeps it, says the thing where it shows and the move where
  // the story has a moment for it — and gives nobody else anything. No examples are shown: an example comes back as the story.
  if (o.invent === false) {
    return (
      `WHAT THEY ALWAYS HAVE. A character the maker chose whose cast entry ends with a tag in square brackets (${o.horror ? "[always: …]" : "[always: … | move: …]"}) always has that with them: keep the tag word for word at the END of their entry. Give NOBODY else a thing they always have or a move of their own, and write no tag for anybody else — this story is the idea as it is told, with nothing added to its people.` +
      ` Every VISUAL a character with an [always: …] tag is in names the thing in the same few words while it is in view, with the character as the one who has it ("${name}, ${ex.seen}, …" — never only "${name}'s ${ex.noun}").` +
      (o.horror ? "" : ` A character whose tag has a move may show it once or twice, at the story's biggest moments — only where the idea has a moment for it: a scene that shows it sets "move" to their name, seen WIDE or FROM BELOW so the whole body is in the frame; its VISUAL is the instant the move is done, aimed at a thing, an obstacle or the air, never at a person, and nobody is hurt.`) +
      (o.drawn ? "" : " Nothing they have glows (a lit lamp is only a light)" + (o.horror ? "." : ", and the move is one a stunt performer could really do: no beam, no magic.")) +
      " Nothing they have carries letters, numbers or a logo."
    );
  }
  const lead = o.lead && !o.chosen
    ? "Each lead of this story has ONE thing they always have with them"
    : "A character may have ONE thing they always have with them, where it fits the story";
  return (
    `WHAT THEY ALWAYS HAVE. ${lead} — worn or carried (${things.map((t) => t.thing).join("; ")})` +
    // (a horror story's craft is the unseen threat: a hero's sword turns suspense into a slasher — SPEC-S16 Decision 6)
    (o.horror ? ", never a weapon — and a weapon an entry already has stays sheathed, never used." : o.childSafe ? ", something cheerful, never a weapon." : ".") +
    (o.horror ? "" : ` If the story has a moment for it, they may also have ONE special move of their own: what their body does, in plain physical words, with a short name you invent${o.childSafe ? " — a playful one that hits nobody (a giant bounce, a whistle that calls the birds)" : ""}.`) +
    ` Write it at the END of that character's "cast" entry, in square brackets, exactly so: ${o.horror ? "[always: …]" : "[always: … | move: …] — leave out a part they do not have"}. An entry that already has one keeps it word for word${o.chosen ? ", and a character the maker chose is given none of their own" : ""}.` +
    // (…named WITH its character: "Kai's fan flashes" leaves Kai out of the picture — a possessive counts as being there only
    //  for a part of them, narrated-core.ts → OF_THEIR_OWN)
    ` Every VISUAL they are in names the thing in the same few words while it is in view, with the character as the one who has it ("${name}, ${ex.seen}, …" — never only "${name}'s ${ex.noun}").` +
    // (…seen far enough back for a whole body: the shot list's own names, which the VISUAL opens with — story-shots.ts)
    (o.horror ? "" : ` A scene that shows the move sets "move" to their name: at most two scenes, the story's biggest moments, each one seen WIDE or FROM BELOW so that the whole body is in the frame. Its VISUAL is the instant the move is done, aimed at a thing, an obstacle or the air, never at a person, and nobody is hurt. The narrator may say the move's name there.`) +
    (o.drawn ? "" : o.horror ? " Nothing they have glows (a lit lamp is only a light)." : " Nothing they have glows (a lit lamp is only a light), and the move is one a stunt performer could really do: no beam, no magic.") +
    " Nothing they have carries letters, numbers or a logo."
  );
}

/** The portrait (story-picture.ts → portraitPrompt): the thing is drawn into the one picture every scene is drawn from —
 *  CAST_LOCK then holds it ("the same … clothing, and nothing added to what it wears"). Never the move: a portrait is a
 *  standing figure. */
export const portraitHas = (name: string, has: string): string => ` ${name} always has ${has}: it is clearly seen in this portrait — worn, held or carried where it shows from the front.`;

/** Every scene the character is in, drawn from their portrait as reference image `n` (narrated-story.server.ts, beside
 *  the creature note — a line of its own, so the pinned scene note is untouched). */
export const markLine = (name: string, has: string, n: number): string => `${name} always has ${has}: in this picture too, the same shape, size and colours as in reference image ${n}, worn or carried the same way — unless these words have ${name} put it down.`;

/** Only the scene whose `move` names them (SPEC-S16 Decision 4). A told picture is one instant: the move at its PEAK,
 *  aimed at what it is aimed at and never at the lens (NO_LENS and the lens check would redraw a hero posing to camera),
 *  and nobody hurt — the instant before it lands. Drawn: anime's own effects, drawn wind and speed lines, one picture,
 *  no lettering. Photoreal: a stunt performer's real move frozen by a fast shutter (the Action look's own words), nothing
 *  glowing or appearing from nowhere — NOTHING_GLOWS, HORROR_CLIP_REAL, Fantasy's "no visual effects".
 *  (…and in a drawn one, "never a flash, sparks, a glow or a beam of light", and in both "nothing has been hit yet":
 *   the first drawn move made for this, 2026-11-26 — a TEST mechanic's leaping stroke at a falling crate, Neon City —
 *   came back with the wooden sword already IN the crate, a white flash bursting from it and orange sparks at the crane
 *   hook. Told the same with these words, it came back as the instant before the blow — tests/character-mark.test.ts.) */
export function moveLine(name: string, move: string, o: { drawn: boolean; childSafe: boolean }): string {
  const line = o.drawn
    ? `This picture is ${name}'s special move, ${move}: drawn at its peak, one frozen instant with ${name}'s whole body in it, aimed at what the move is aimed at and never at the viewer, with drawn speed lines and a swirl of drawn wind, dust, water or leaves around it — never a flash, sparks, a glow or a beam of light. Nobody is struck or hurt — it is the instant before it lands, and nothing has been hit yet. One picture: no second panel, no words.`
    : `This picture is ${name}'s special move, ${move}: a real move a trained stunt performer could do, caught at its peak by a fast shutter, with ${name}'s whole body in it, aimed at what the move is aimed at and never at the camera. Nothing glows and nothing appears from nowhere: no beam, no sparks, no trail of light, no magic — only the body, what ${name} always has, and what the move stirs (dust, water, leaves, a door). Nobody is struck or hurt — it is the instant before it lands, and nothing has been hit yet.`;
  return o.childSafe ? `${line} It is a game: nobody is hit and nothing breaks.` : line;
}
