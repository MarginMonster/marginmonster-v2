/* THE PLACE REMEMBERS WHAT WAS DONE TO IT — A ZIPPED TENT STAYS ZIPPED (2026-11-25, stream S12).
 *
 * The owner, of two horror films in a tent by a lake: "they say "close the tent up" then "put the bag in front of the
 * door" but they never actually zipped the tent doors up. Causing the slop, then in a frame out of nowhere the tent doors
 * are fully open again and the monster lady is standing in front of door". Looked at, frame by frame:
 *   · Part 1, shot 4: "Mireille yanks the tent zipper shut with one hard pull" — she lunges at the opening; NOTHING
 *     closes. Its reveal drew a glowing face STANDING IN THE OPEN DOORWAY between them.
 *   · Episode 2, every shot: the two crouched at the door, the flaps OPEN on a gap of moonlit lake. Shot 1 "claws the
 *     zipper pull down hard, sealing the gap" — the gap never closes; shot 2 wedges the duffel bag "against the sealed
 *     zipper seam" — he puts it INTO the open gap; the reveal stood her in the open doorway again.
 * Why: a place's picture is its MASTER, drawn once from its FIRST scene — the moment before anything is done — and every
 * re-anchor, new angle, sighting and the reveal grew out of it (or of a sighting); nothing recorded that a door was shut,
 * so no picture ever showed it shut, and the clip was told the action in words from an open-door still.
 *
 * So what a scene DOES to its place is read off its own words, here: which opening is shut or opened (placeChangeIn),
 * what is put against it, and what is true of the place when each later shot begins (placeStateAt). The film draws the
 * change, ends the shot on it, grows every later picture there out of it and tells every later clip it stays so
 * (film-dialogue.server.ts); the writer is told to write it down (acted-staging.ts → DONE_STAYS_DONE).
 *
 * Pure, no imports: tests/place-state.test.ts holds it, on the films' own words. */

export type PlaceNow = "shut" | "open";
/** What one scene DOES to its place. `what` = the opening as the words name it ("the tent door", "the front door", "the
 *  window", "the curtains"); `now` = what it is when the shot is done (null: the scene only puts something against it);
 *  `end` = ONE plain sentence of what the picture shows when it is done ("" with `now` null); `by` = who does it, when
 *  the words say; `also` = what is put against it, as one sentence ("The duffel bag is wedged against the bottom of the
 *  shut tent door."), and `put` the same in parts (placeStateAt words it again with what is true then). */
export type PlaceChange = { what: string; now: PlaceNow | null; end: string; by?: string; also?: string; put?: PutAgainst };
/** Something put against an opening: "The heavy duffel bag" "wedged" "against" "the tent door". */
export type PutAgainst = { thing: string; how: string; prep: string; what: string; plural: boolean; shut: boolean };
/** What is true of a place when a shot begins: every opening a scene there changed, as the latest change left it, and
 *  everything put against one that is still shut. */
export type PlaceState = { openings: Array<{ what: string; now: PlaceNow; end: string }>; also: PutAgainst[] };

const one = (s: unknown): string => (typeof s === "string" ? s : "").replace(/\s+/g, " ").trim();
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
const low = (s: string): string => (s ? s[0].toLowerCase() + s.slice(1) : s);

/* ---- THE WORDS ---- */

const DET = "(?:the|a|an|its|their|his|her|my|our|your|that|this)";
/** Words that end a noun phrase (a preposition, a joint, a pronoun, a verb of being). */
const STOP = "(?:on|at|in|into|onto|against|through|with|of|to|from|and|but|or|as|while|then|over|under|toward|towards|behind|across|before|after|until|so|for|by|it|them|him|herself|himself|themselves|is|are|was|were|hard|tight|shut|closed|open|down|up|back|aside)";
/** Up to three words between the article and the noun ("the heavy wooden front door", "the back door") — never a
 *  preposition. */
const ADJS = `((?:(?!${STOP.replace("|back|", "|")}\\b)[\\p{L}'’-]+\\s+){0,3}?)`;
/** What can be shut or opened. */
const OPENING = "(doorway|doors|door|flaps|flap|entrance|zipper|zip|seam|hatch|trapdoor|trap door|windowpane|windows|window|shutters|curtains|curtain|blinds|gate|opening)";
/** …and a tent, as the thing zipped ("zips up the tent"). */
const OPENING_OR_TENT = OPENING.replace("(doorway", "(tent(?!\\s+(?:bag|poles?|pegs?|stakes?|floor|wall|walls|roof|light|lantern))|doorway");
/** Verbs that shut what they are done to ("slams the front door", "zips the tent door"). */
const SHUT_V = "(?:shut|shuts|shutting|close|closes|closed|closing|slam|slams|slammed|slamming|lock|locks|locked|locking|bolt|bolts|bolted|bolting|bar|bars|barred|barring|latch|latches|latched|latching|seal|seals|sealed|sealing|zip|zips|zipped|zipping|fasten|fastens|fastened|fastening|secure|secures|secured|securing)";
/** Verbs that move it — and say which way after it ("yanks the zipper shut", "flings the door open"). */
const MOVE_V = "(?:pull|pulls|pulled|pulling|yank|yanks|yanked|yanking|tug|tugs|tugged|tugging|drag|drags|dragged|dragging|claw|claws|clawed|clawing|jerk|jerks|jerked|jerking|swing|swings|swung|swinging|kick|kicks|kicked|kicking|push|pushes|pushed|pushing|shove|shoves|shoved|shoving|slide|slides|slid|sliding|ease|eases|eased|easing|haul|hauls|hauled|hauling|wrench|wrenches|wrenched|wrenching|snap|snaps|snapped|snapping|draw|draws|drew|drawing|rip|rips|ripped|ripping|bang|bangs|banged|banging|whip|whips|whipped|whipping|run|runs|ran|running|zip|zips|zipped|zipping|force|forces|forced|forcing|throw|throws|threw|throwing|fling|flings|flung|flinging|tear|tears|tore|tearing|heave|heaves|heaved|heaving|slam|slams|slammed|slamming)";
/** An adverb or two between the opening and the way it went ("the zipper pull down hard"). */
const MANNER = "(?:\\s+(?:pull|tab|cord))?(?:\\s+(?:[\\p{L}]+ly|hard|fast|wide|tight|firmly|all the way|halfway))?";
/** "pulls the door to" is shut — "pulls the door to her" is not. */
const TO_SHUT = "to(?!\\s+(?:her|him|them|me|us|it|the|a|an|his|their|its|my|our|your|where|face|look|see)\\b)";
/** What it is not, when it is said before the verb: tried, about to, never. */
const NOT_DONE = /(?:\bnot|\bnever|n['’]t|\btries to|\btry to|\btrying to|\btried to|\bfails? to|\bfailed to|\bunable to|\babout to|\breaches for|\breaching for|\breached for|\bwants to|\bwould|\bshould|\bcould|\bstarts to reach|\bbegins to reach|\bgoes to|\bmoves to)\s+(?:[\p{L}'’-]+\s+){0,2}$/iu;
/** Openings a pull DOWN shuts (a zipper, a blind, a sash window, a hatch) — "pulls the door down" is nothing. */
const DOWN_SHUTS = /^(?:zipper|zip|blinds|shutters|window|windows|windowpane|hatch|trapdoor|trap door)$/i;
/** …and openings a push UP opens (a sash window, blinds, a hatch). A zipper pulled up from inside is not read: which
 *  way a tent's zipper closes is not in the words. */
const UP_OPENS = /^(?:window|windows|windowpane|blinds|shutters|hatch|trapdoor|trap door)$/i;

type Hit = { at: number; now: PlaceNow; noun: string; adjs: string; verb: string; agent: boolean };

/** Every shut and every open in the words, where it is said. */
function hitsIn(text: string): Hit[] {
  const hits: Hit[] = [];
  const add = (re: RegExp, now: PlaceNow | ((m: RegExpExecArray) => PlaceNow | null), pick: (m: RegExpExecArray) => { noun: string; adjs: string; verb: string }, agent = true) => {
    for (const m of text.matchAll(new RegExp(re.source, "giu"))) {
      const mm = m as RegExpExecArray;
      const n = typeof now === "function" ? now(mm) : now;
      if (!n) continue;
      if (NOT_DONE.test(text.slice(Math.max(0, (mm.index ?? 0) - 40), mm.index))) continue;
      hits.push({ at: mm.index ?? 0, now: n, ...pick(mm), agent });
    }
  };
  // SHUT — "slams the front door", "zips the tent door", "zips up the tent", "draws the curtains" (drawn, they are shut).
  //  (A tent itself is only zipped, closed, shut or sealed: "secures the tent" is its pegs.)
  add(new RegExp(`\\b(${SHUT_V})\\s+(?:up\\s+)?${DET}\\s+${ADJS}${OPENING_OR_TENT}\\b(?!\\s+(?:open|back|aside|wide))`), (m) => (!/^tent$/i.test(m[3]) || /^(?:zip|clos|shut|seal)/i.test(m[1]) ? "shut" : null), (m) => ({ verb: m[1], adjs: m[2], noun: m[3] }));
  add(new RegExp(`\\b(draw|draws|drew|drawing)\\s+${DET}\\s+${ADJS}(curtains|curtain|blinds)\\b(?!\\s+(?:open|back|aside|apart|up))`), "shut", (m) => ({ verb: m[1], adjs: m[2], noun: m[3] }));
  // …"yanks the tent zipper shut", "claws the zipper pull down hard", "pulls the door to" (never "pulls the door to her")
  add(new RegExp(`\\b(${MOVE_V})\\s+${DET}\\s+${ADJS}${OPENING}${MANNER}\\s+(shut|closed|${TO_SHUT}|tight|down)\\b`), (m) => (m[4].toLowerCase() === "down" && !DOWN_SHUTS.test(m[3]) ? null : "shut"), (m) => ({ verb: m[1], adjs: m[2], noun: m[3] }));
  // …"slams it shut", "zips it up" (what "it" is: the opening named before it — placeChangeIn, below)
  add(new RegExp(`\\b(${SHUT_V}|${MOVE_V})\\s+(it|them)\\s+(?:[\\p{L}]+ly\\s+|hard\\s+)?(shut|closed|up|down)\\b`), (m) => (/^(?:up|down)$/i.test(m[3]) && !/^zip/i.test(m[1]) ? null : "shut"), (m) => ({ verb: m[1], adjs: "", noun: m[2] }));
  // …"the door slams shut", "the door slams behind them", "the window drops down"
  add(new RegExp(`\\b${DET}\\s+${ADJS}${OPENING}\\s+(?:[\\p{L}]+ly\\s+)?(slams|slammed|swings|swung|bangs|banged|clicks|clicked|snaps|snapped|slides|slid|falls|fell|thuds|thudded|eases|eased|blows|blew|drops|dropped|zips|zipped|thumps|thumped)\\s+(shut|closed|${TO_SHUT}|down)\\b`), (m) => (m[4].toLowerCase() === "down" && !DOWN_SHUTS.test(m[2]) ? null : "shut"), (m) => ({ verb: m[3], adjs: m[1], noun: m[2] }), false);
  add(new RegExp(`\\b${DET}\\s+${ADJS}${OPENING}\\s+(slams|slammed)\\b(?!\\s+(?:open|against|into|on|shut|closed))`), "shut", (m) => ({ verb: m[3], adjs: m[1], noun: m[2] }), false);
  // …"sealing the gap"; "closes the opening" (never "closes the gap": that is two people coming nearer)
  add(new RegExp(`\\b(seal|seals|sealed|sealing)\\s+${DET}\\s+(gap|opening|entrance|entry)\\b(?!\\s+between)`), "shut", (m) => ({ verb: m[1], adjs: "", noun: m[2] }));
  add(new RegExp(`\\b(close|closes|closed|closing|shut|shuts|shutting)\\s+${DET}\\s+(opening|entrance|entry)\\b`), "shut", (m) => ({ verb: m[1], adjs: "", noun: m[2] }));
  // …"until the tent door is zipped completely shut" (a result: the writer's own way of saying it is done)
  add(new RegExp(`\\buntil\\s+${DET}\\s+${ADJS}${OPENING_OR_TENT}\\s+(?:is|are)\\s+(?:[\\p{L}]+\\s+){0,2}?(shut|closed|zipped|sealed|locked|bolted|drawn)\\b`), "shut", (m) => ({ verb: m[3], adjs: m[1], noun: m[2] }), false);
  add(new RegExp(`\\buntil\\s+${DET}\\s+${ADJS}${OPENING_OR_TENT}\\s+(?:is|are|stands|stand|hangs|hang)\\s+(?:wide\\s+)?(open)\\b`), "open", (m) => ({ verb: m[3], adjs: m[1], noun: m[2] }), false);
  // …"the door is slammed shut" (done, in the passive — never "the door is shut", which only says what it is)
  add(new RegExp(`\\b${DET}\\s+${ADJS}${OPENING_OR_TENT}\\s+(?:is|are|gets|get)\\s+(slammed|yanked|swung|kicked|banged|snapped|wrenched|jerked|pulled|pushed)\\s+(shut|closed)\\b`), "shut", (m) => ({ verb: m[3], adjs: m[1], noun: m[2] }), false);
  // OPEN — "opens the window", "unzips the tent door"
  add(new RegExp(`\\b(open|opens|opened|opening|unzip|unzips|unzipped|unzipping)\\s+(?:up\\s+)?${DET}\\s+${ADJS}${OPENING_OR_TENT}\\b`), "open", (m) => ({ verb: m[1], adjs: m[2], noun: m[3] }));
  // …"flings the door open", "pulls the curtain aside", "forces the window up"
  add(new RegExp(`\\b(${MOVE_V})\\s+${DET}\\s+${ADJS}${OPENING}${MANNER}\\s+(open|aside|back|apart|up|wide)\\b`), (m) => (m[4].toLowerCase() === "up" && !UP_OPENS.test(m[3]) ? null : "open"), (m) => ({ verb: m[1], adjs: m[2], noun: m[3] }));
  // …"throws open the door", "draws back the curtain"
  add(new RegExp(`\\b(${MOVE_V}|open|opens)\\s+(open|back|aside|apart|up)\\s+${DET}\\s+${ADJS}${OPENING}\\b`), (m) => (m[2].toLowerCase() === "up" && !UP_OPENS.test(m[4]) ? null : "open"), (m) => ({ verb: m[1], adjs: m[3], noun: m[4] }));
  // …"the door creaks open", "the bedroom door creaks slowly open"
  add(new RegExp(`\\b${DET}\\s+${ADJS}${OPENING}\\s+(?:[\\p{L}]+ly\\s+)?(?:(?:starts|begins|started|began) to\\s+)?(swings?|swung|creaks?|creaked|eases?|eased|bursts?|flies|flew|slides?|slid|falls?|fell|blows?|blew|bangs?|banged|slams?|slammed|cracks?|cracked|drifts?|drifted|peels?|peeled|inches|inched|gapes?|gaped|yawns?|yawned|jerks?|jerked|rolls?|rolled)\\s+(?:slowly\\s+|wide\\s+|silently\\s+|quietly\\s+)?open\\b`), "open", (m) => ({ verb: m[3], adjs: m[1], noun: m[2] }), false);
  // …"the zipper creeps up an inch" (moving by itself — from outside), "the zipper is pulled up from outside"
  add(new RegExp(`\\b(?:${DET}\\s+)?${ADJS}(zipper|zip)(?:\\s+(?:pull|tab))?(?:\\s+(?:of|on)\\s+${DET}\\s+(?:[\\p{L}'’-]+\\s+){0,2}?(?:door|flap|tent|entrance))?\\s+(?:[\\p{L}]+ly\\s+)?(?:(?:starts|begins|started|began) to\\s+)?(slides?|slid|sliding|creeps?|crept|creeping|crawls?|crawled|crawling|inches|inched|inching|rises?|rose|rising|moves?|moved|moving|lifts?|lifted|ticks?|ticked|is (?:pulled|drawn|dragged|tugged|yanked)|gets (?:pulled|drawn|dragged|tugged|yanked))\\s+(?:[\\p{L}]+ly\\s+)?(?:back\\s+)?(up|upward|upwards|open)\\b`), "open", (m) => ({ verb: m[3], adjs: m[1], noun: m[2] }), false);
  // …"the zipper gives"
  add(/\b(zipper|zip|seam|stitching)\s+(gives way|gives|gave way|gave|splits|split|tears|tore|bursts|burst|parts|parted)\b/, "open", (m) => ({ verb: m[2], adjs: "", noun: m[1] }), false);
  // …"the door is flung open", "the tent is unzipped"
  add(new RegExp(`\\b${DET}\\s+${ADJS}${OPENING_OR_TENT}\\s+(?:is|are|gets|get)\\s+(flung|thrown|yanked|pulled|pushed|ripped|torn|kicked|forced|wrenched|eased|jerked|swung|slid|drawn|peeled)\\s+(?:wide\\s+|back\\s+)?(open|aside|back)\\b`), "open", (m) => ({ verb: m[3], adjs: m[1], noun: m[2] }), false);
  add(new RegExp(`\\b${DET}\\s+${ADJS}${OPENING_OR_TENT}\\s+(?:is|are|gets|get)\\s+(unzipped|opened)\\b`), "open", (m) => ({ verb: m[3], adjs: m[1], noun: m[2] }), false);
  return hits.sort((a, b) => a.at - b.at);
}

/* ---- WHAT IT IS CALLED, AND WHAT IT LOOKS LIKE DONE ---- */

const TENT = /\btents?\b/i;
const TENT_DOOR = /^(?:zipper|zip|seam|flap|flaps|entrance|entry|opening|gap|doorway|door|tent)$/i;
/** Words that say WHICH door or window ("the front door", "the kitchen window") — kept; any other word is a look. */
const WHICH = new Set(["front", "back", "side", "bedroom", "kitchen", "cellar", "basement", "bathroom", "closet", "cabin", "barn", "shed", "garage", "hallway", "porch", "screen", "storm", "car", "van", "trailer", "attic", "office", "apartment", "nursery", "study", "pantry", "bedroom", "living-room", "cabin", "hotel", "motel", "cottage", "house", "farmhouse"]);
type Kind = "tent" | "door" | "window" | "curtain" | "blinds" | "shutters" | "hatch";

/** The opening as the words name it — "the tent door", "the front door", "the window", "the curtains". */
function nameOf(noun: string, adjs: string, ctx: string): string {
  const n = noun.toLowerCase().replace(/\s+/g, " ").replace(/^zipper seam$/, "zipper");
  const words = one(adjs).toLowerCase().split(" ").filter(Boolean);
  const which = words.filter((w) => WHICH.has(w)).slice(-1)[0];
  // (a zipper, a flap, the gap, the door — in a tent, the tent's door; "the cabin door" is the cabin's, tent or no tent)
  if (n === "tent" || words.includes("tent") || (TENT_DOOR.test(n) && TENT.test(ctx) && !which)) return "the tent door";
  const pre = which ? `the ${which} ` : "the ";
  if (/^(?:door|doors|doorway)$/.test(n)) return `${pre}${n === "doorway" ? "door" : n}`;
  if (/^(?:zipper|zip|seam)$/.test(n)) return `${pre}door`;
  if (/^(?:window|windows|windowpane)$/.test(n)) return `${pre}${n === "windowpane" ? "window" : n}`;
  if (/^trap ?door$/.test(n)) return "the trapdoor";
  return `${pre}${n}`;
}
const kindOf = (what: string): Kind => {
  const w = what.toLowerCase();
  if (/\btent door\b/.test(w)) return "tent";
  if (/\bcurtains?\b/.test(w)) return "curtain";
  if (/\bblinds\b/.test(w)) return "blinds";
  if (/\bshutters\b/.test(w)) return "shutters";
  if (/\bwindows?\b/.test(w)) return "window";
  if (/\b(?:hatch|trapdoor)\b/.test(w)) return "hatch";
  return "door";
};
const plural = (what: string): boolean => /(?:doors|windows|curtains|blinds|shutters|flaps)$/i.test(what);
/** The same opening: the same kind, and the same words — or one of the two is only "the door" / "the window". */
export function sameOpening(a: string, b: string): boolean {
  const x = one(a).toLowerCase(), y = one(b).toLowerCase();
  if (!x || !y || kindOf(x) !== kindOf(y)) return false;
  const bare = (s: string): boolean => /^the (?:door|doors|window|windows|curtain|curtains|blinds|shutters|flap|flaps|hatch|trapdoor|gate|entrance|opening)$/.test(s);
  return x === y || bare(x) || bare(y) || kindOf(x) === "tent";
}

/** ONE plain sentence of what the picture shows when it is done — what an edit is told, and what the clip is told it
 *  ends on. Said the way a picture model can draw it: what is joined, what no longer shows. */
export function endOf(what: string, now: PlaceNow, verb = ""): string {
  const W = cap(what);
  const are = plural(what) ? "are" : "is";
  const v = verb.toLowerCase();
  switch (kindOf(what)) {
    case "tent": return now === "shut"
      ? `${W} is zipped completely shut — the two flaps joined edge to edge, the zipper closed to the floor; nothing of the outside shows through it.`
      : `${W} hangs open — its zipper undone, its flaps parted on the outside.`;
    case "curtain": return now === "shut"
      ? `${W} ${are} drawn shut — closed edge to edge; nothing of the window shows between them.`
      : `${W} ${are} drawn back from the window.`;
    case "blinds": return now === "shut" ? `${W} are pulled down and closed; nothing of the window shows through them.` : `${W} are pulled up off the window.`;
    case "shutters": return now === "shut" ? `${W} are closed tight over the window.` : `${W} stand open from the window.`;
    case "window": return now === "shut"
      ? `${W} ${are} shut — the glass closed tight in ${plural(what) ? "their frames" : "its frame"}.`
      : `${W} ${are} pushed open — a clear gap in ${plural(what) ? "their frames" : "its frame"}.`;
    case "hatch": return now === "shut" ? `${W} is shut flat.` : `${W} stands open.`;
    default: {
      if (now === "open") return `${W} ${plural(what) ? "stand" : "stands"} open.`;
      const locked = /^(?:lock|bolt|bar|latch)/.test(v) ? ` and ${v.startsWith("bar") ? "barred" : v.startsWith("bolt") ? "bolted" : v.startsWith("latch") ? "latched" : "locked"}` : "";
      return `${W} ${are} shut${locked} — tight in ${plural(what) ? "their frames" : "its frame"}, no gap at ${plural(what) ? "their edges" : "its edge"}.`;
    }
  }
}

/* ---- WHAT IS PUT AGAINST IT ---- */

const PUT_V = "(?:wedge|wedges|wedged|wedging|shove|shoves|shoved|shoving|drag|drags|dragged|dragging|jam|jams|jammed|jamming|brace|braces|braced|bracing|push|pushes|pushed|pushing|prop|props|propped|propping|pile|piles|piled|piling|stack|stacks|stacked|stacking|lean|leans|leaned|leaning|haul|hauls|hauled|hauling|slide|slides|slid|sliding|set|sets|setting|put|puts|putting|heave|heaves|heaved|heaving|ram|rams|rammed|ramming|place|places|placed|placing|wrestle|wrestles|wrestled|wrestling)";
const PARTICIPLE: Record<string, string> = { wedge: "wedged", shove: "shoved", drag: "dragged", jam: "jammed", brace: "braced", push: "pushed", prop: "propped", pile: "piled", stack: "stacked", lean: "leaned", haul: "hauled", slide: "slid", set: "set", put: "put", heave: "heaved", ram: "rammed", place: "placed", wrestle: "wrestled" };
const stemOf = (verb: string): string => {
  const v = verb.toLowerCase();
  for (const s of Object.keys(PARTICIPLE)) if (v === s || v === `${s}s` || v === `${s}es` || v.startsWith(s.replace(/e$/, "")) && v.length <= s.length + 4) return s;
  return v;
};
const TARGET = "(zipper seam|zipper|zip|seam|doorway|doors|door|flaps|flap|entrance|windows|window|hatch|trapdoor|gate|opening)";
const PREP = "(up against|against|in front of|across|up to|under|beneath|before)";
const NP = `(${DET}\\s+(?:(?!${STOP}\\b)[\\p{L}'’-]+\\s+){0,3}?(?!${STOP}\\b)[\\p{L}'’-]+)`;
const BODY = /^(?:palm|palms|hand|hands|back|shoulder|shoulders|body|weight|foot|feet|knee|knees|ear|ears|face|forehead|cheek|fingers|finger|fist|fists|arm|arms|hip|hips|head|side|chest|spine|self|forearm|forearms)$/i;
/** What moved it there before "it" ("drags their heavy duffel bag … and wedges it …"). */
const CARRY_V = "(?:drags|drag|dragged|hauls|haul|hauled|lifts|lift|lifted|carries|carry|carried|grabs|grab|grabbed|picks up|picked up|pulls|pulled|pushes|pushed|shoves|shoved|heaves|heaved|slides|slid|rolls|rolled|tips|tipped|takes|took|wrestles|wrestled|hoists|hoisted|hefts|hefted|drags over|hauls over)";

function putIn(text: string, ctx: string): (PutAgainst & { at: number }) | null {
  let found: (PutAgainst & { at: number }) | null = null;
  const re = new RegExp(`\\b(${PUT_V})\\s+(it|them|${NP.slice(1, -1)})\\s+(?:(?:[\\p{L}]+ly|hard|tight|firmly|right|flat|up|back|down|over|all the way)\\s+){0,3}?${PREP}\\s+(?:${DET}\\s+(?:bottom|foot|base|middle|front|side)\\s+of\\s+)?${DET}\\s+((?:[\\p{L}'’-]+\\s+){0,3}?)${TARGET}\\b`, "giu");
  for (const m of text.matchAll(re)) {
    if (NOT_DONE.test(text.slice(Math.max(0, (m.index ?? 0) - 40), m.index))) continue;
    let obj = m[2];
    if (/^(?:it|them)$/i.test(obj)) {
      // (what "it" is: the last thing moved before it in the same words)
      const before = text.slice(0, m.index);
      const carried = [...before.matchAll(new RegExp(`\\b${CARRY_V}\\s+${NP}(?=\\s+${STOP}\\b|[,.;]|\\s*$)`, "giu"))].pop();
      if (!carried) continue;
      obj = carried[1];
    }
    const head = (obj.split(/\s+/).pop() || "").toLowerCase();
    if (BODY.test(head) || /^(?:herself|himself|themselves|him|her|me|us|you|one)$/i.test(head)) continue;
    const thing = cap(obj.replace(/^(?:their|his|her|my|our|your|its)\s+/i, "the "));
    const targetWords = one(m[4]).toLowerCase();
    found = {
      at: m.index ?? 0,
      thing,
      how: PARTICIPLE[stemOf(m[1])] || m[1].toLowerCase(),
      prep: m[3].toLowerCase(),
      what: nameOf(m[5], m[4], ctx),
      plural: /[^s]s$/i.test(head),
      shut: /\b(?:sealed|shut|closed|zipped|zipped-shut|locked|bolted|barred)\b/.test(targetWords),
    };
  }
  return found;
}

/** The sentence for something put against an opening — "The heavy duffel bag is wedged against the bottom of the shut
 *  tent door." `shut` = said of it as shut (the words say so, or it is shut when this is said). */
export function putLine(p: PutAgainst, shut = p.shut): string {
  const door = /(?:door|doors|gate|flap|flaps|entrance|hatch|trapdoor)$/i.test(p.what) || kindOf(p.what) === "tent";
  const target = `the ${shut ? "shut " : ""}${p.what.replace(/^the\s+/i, "")}`;
  const where = /against|up to/.test(p.prep) ? (door ? `against the bottom of ${target}` : `against ${target}`) : p.prep === "before" ? `in front of ${target}` : p.prep === "beneath" ? `under ${target}` : `${p.prep} ${target}`;
  return `${cap(p.thing)} ${p.plural ? "are" : "is"} ${p.how} ${where}.`;
}

/* ---- WHO DID IT ---- */

const NOT_A_NAME = /^(?:The|A|An|Then|Now|She|He|They|It|We|I|You|Moments|Later|Inside|Outside|Suddenly|Both|Its|Their|His|Her|Something|Someone|Somebody|Nobody|Nothing|Behind|Above|Below|Against|Through|With|As|When|While|Before|After|Finally|Still|Only|Slowly|Quickly|One|Two|In|On|At|From|Into|Over|Under|Across|Far|Near|Down|Up|Out|Back|Again|Every|All|Each|No|Not|Just|Even|So|Yet|But|And|Or|If|Until)$/;
/** The last name before the deed in its own sentence ("Moments later, Mireille claws …" → Mireille). */
function byOf(text: string, at: number): string | undefined {
  const clause = text.slice(0, at).split(/[.!?;]\s/).pop() || "";
  const names = [...clause.matchAll(/(\p{Lu}[\p{L}'’-]+)(?!['’]s\b)/gu)].map((m) => m[1]).filter((n) => !NOT_A_NAME.test(n) && !/['’]s$/.test(n));
  return names.pop();
}

/* ---- ONE SCENE ---- */

/** WHAT THIS SCENE DOES TO ITS PLACE — or null when it does nothing to it. Read off the scene's own words (`visual`):
 *  zips / zipped / the zipper pulled, yanked, clawed down or shut, "sealing the gap"; shuts, closes, slams, locks,
 *  bolts, bars or latches a door, a flap, a hatch, a window, the curtains, the shutters; and the reverse — unzips, the
 *  zipper slides or creeps up or gives, a door pulled, flung or eased open, creaking open. And what is PUT against it:
 *  wedged, shoved, dragged, jammed, braced… against, in front of, across or up to the door, the zipper, the seam, the
 *  flap. A sentence that only MENTIONS what it is ("she stares at the zipped door", "the door is shut") is no change,
 *  and neither is one that only tries ("tries to shut the door"). When the words do two things, the later one is
 *  what it is at the end ("zips it shut, but the zipper creeps up again" → open). `said` = the shot's line, `o.where`
 *  = its place: only to name the opening (a zipper in a tent is the tent's door). */
export function placeChangeIn(visual: string | null | undefined, said?: string | null, o: { where?: string | null } = {}): PlaceChange | null {
  const text = one(visual).replace(/["“”]/g, "");
  if (!text) return null;
  const ctx = `${text} ${one(said)} ${one(o.where)}`;
  const hits = hitsIn(text);
  const last = hits[hits.length - 1] || null;
  const put = putIn(text, ctx);
  if (!last && !put) return null;
  let what = "";
  if (last) {
    let noun = last.noun, adjs = last.adjs;
    if (/^(?:it|them)$/i.test(noun)) {
      // ("slams it shut": the opening named before it, else the place's door)
      const named = [...text.slice(0, last.at).matchAll(new RegExp(`\\b${DET}\\s+${ADJS}${OPENING_OR_TENT}\\b`, "giu"))].pop();
      noun = named ? named[2] : TENT.test(ctx) ? "tent" : "door";
      adjs = named ? named[1] : "";
    }
    what = nameOf(noun, adjs, ctx);
  }
  const by = last ? (last.agent ? byOf(text, last.at) : undefined) : put ? byOf(text, put.at) : undefined;
  const p: PutAgainst | undefined = put ? { thing: put.thing, how: put.how, prep: put.prep, what: last && sameOpening(put.what, what) ? what : put.what, plural: put.plural, shut: put.shut || (!!last && last.now === "shut" && sameOpening(put.what, what)) } : undefined;
  if (!last) return { what: p!.what, now: null, end: "", ...(by ? { by } : {}), also: putLine(p!), put: p };
  return { what, now: last.now, end: endOf(what, last.now, last.verb), ...(by ? { by } : {}), ...(p ? { also: putLine(p), put: p } : {}) };
}

/* ---- WHAT IS TRUE WHEN A SHOT BEGINS ---- */

/** A change, laid on what was true before it: the latest word on an opening wins (shut, then opened again, is open), and
 *  whatever was put against an opening goes when it is opened. */
export function applyChange(state: PlaceState | null, c: PlaceChange | null): PlaceState | null {
  const st: PlaceState = { openings: [...(state?.openings || [])], also: [...(state?.also || [])] };
  if (c?.now) {
    const k = st.openings.findIndex((o) => sameOpening(o.what, c.what));
    const entry = { what: k >= 0 && /^the (?:door|window)$/.test(c.what) ? st.openings[k].what : c.what, now: c.now, end: c.end };
    if (k >= 0) st.openings[k] = { ...entry, end: entry.what === c.what ? c.end : endOf(entry.what, c.now) }; else st.openings.push(entry);
    if (c.now === "open") st.also = st.also.filter((a) => !sameOpening(a.what, c.what));
  }
  if (c?.put) st.also = [...st.also.filter((a) => a.thing.toLowerCase() !== c.put!.thing.toLowerCase()), c.put];
  return st.openings.length || st.also.length ? st : null;
}

/** WHAT IS TRUE OF THE PLACE WHEN SHOT `i` BEGINS — every change a scene there made since the film came to it, in
 *  order, the later one winning. `scenes` = the film's scenes (their `visual`, `caption`, `where`); `samePlace(j)` =
 *  scene j is in the same place as shot i, and after the film came to it (film-dialogue → arrivedAt). Null: nothing
 *  was done to it. */
export function placeStateAt(scenes: ReadonlyArray<{ visual?: string | null; caption?: string | null; where?: string | null } | null | undefined>, i: number, samePlace: (j: number) => boolean = () => true): PlaceState | null {
  let st: PlaceState | null = null;
  for (let j = 0; j < Math.min(i, scenes.length); j++) {
    if (!samePlace(j)) continue;
    const s = scenes[j];
    st = applyChange(st, placeChangeIn(s?.visual, s?.caption, { where: s?.where }));
  }
  return st;
}

/** WHAT WAS DONE THERE BEFORE, APART FROM WHAT THIS CHANGE DOES — what the picture of a change is told is already so,
 *  and kept (the door already zipped shut, while this shot wedges the bag against it). Null: nothing else. */
export function stateApart(st: PlaceState | null | undefined, c: PlaceChange | null | undefined): PlaceState | null {
  if (!st) return null;
  const openings = st.openings.filter((o) => !(c?.now && sameOpening(o.what, c.what)));
  const also = st.also.filter((a) => !(c?.put && a.thing.toLowerCase() === c.put.thing.toLowerCase()) && !(c?.now === "open" && sameOpening(a.what, c.what)));
  return openings.length || also.length ? { openings, also } : null;
}

/** Is this opening shut in this state? */
const shutIn = (st: PlaceState | null | undefined, what: string): boolean => !!st?.openings.some((o) => o.now === "shut" && sameOpening(o.what, what));
/** The openings shut in a state that is made of cloth — a tent's door, a curtain: what is outside presses it, throws
 *  its shadow on it, or opens it (acted-staging.ts → the reveal's fabric placing, the sighting's shadow). */
export const shutCloth = (st: PlaceState | null | undefined): boolean => !!st?.openings.some((o) => o.now === "shut" && (kindOf(o.what) === "tent" || kindOf(o.what) === "curtain"));

/** THE PLACE AS IT NOW IS, in plain sentences — every opening a scene changed as it was left, and what is against one
 *  that is shut. "" when nothing was done to it. What a picture of it is told (a re-anchor, a new angle, the reveal),
 *  and what the next episode's writer is told it was left like. */
export function stateNow(st: PlaceState | null | undefined): string {
  if (!st) return "";
  return [
    ...st.openings.map((o) => o.end),
    ...st.also.map((a) => putLine(a, a.shut || shutIn(st, a.what))),
  ].filter(Boolean).join(" ");
}

/** The one line every LATER clip in that place is told while something there is shut: "The tent door stays zipped shut
 *  the whole shot — nothing opens it." (and "The duffel bag stays wedged against the bottom of the tent door."). Not
 *  said of an opening THIS shot's own scene opens (`own`): that shot is the opening. "" when nothing there is shut. */
export function stateLine(st: PlaceState | null | undefined, own?: PlaceChange | null): string {
  if (!st) return "";
  const opens = (what: string): boolean => !!own && own.now === "open" && sameOpening(own.what, what);
  const out: string[] = [];
  for (const o of st.openings) {
    if (o.now !== "shut" || opens(o.what)) continue;
    const k = kindOf(o.what);
    const stays = plural(o.what) ? "stay" : "stays";
    const how = k === "tent" ? "zipped shut" : k === "curtain" ? "drawn shut" : k === "blinds" || k === "shutters" ? "closed" : "shut";
    out.push(`${cap(o.what)} ${stays} ${how} the whole shot — nothing opens it.`);
  }
  for (const a of st.also) {
    if (opens(a.what)) continue;
    out.push(`${cap(a.thing)} ${a.plural ? "stay" : "stays"} ${a.how} ${/against|up to/.test(a.prep) ? "against" : a.prep === "before" ? "in front of" : a.prep} ${a.what}.`);
  }
  return out.join(" ");
}

/** What a shot whose scene CHANGES its place is told it ends on: "By the end of the shot the tent door is zipped
 *  completely shut — …". (Read off a stored prompt, so a shot rolled again later is trimmed the way it was:
 *  clipEndsOnChange.) "" for no change. */
export const CHANGE_END_LEAD = "By the end of the shot";
export function changeEndLine(c: PlaceChange | null | undefined): string {
  if (!c) return "";
  const parts = [c.now ? c.end : "", c.also || ""].filter(Boolean).join(" ");
  return parts ? `${CHANGE_END_LEAD} ${low(parts)}` : "";
}
/** Does this clip END on a change of its place? Then its last seconds are where the change is done, and are kept: the
 *  trim that takes the quiet off a take's tail would cut the door before it is shut. */
export const clipEndsOnChange = (prompt: string | null | undefined): boolean => String(prompt || "").includes(`${CHANGE_END_LEAD} `);

/** Does a change change anything — is it not already so? (A door "shut" again when it is already shut, a bag put where
 *  it already is: no picture to draw.) */
export function changesState(before: PlaceState | null | undefined, c: PlaceChange | null | undefined): boolean {
  if (!c) return false;
  const already = !!c.now && !!before?.openings.some((o) => sameOpening(o.what, c.what) && o.now === c.now);
  const put = !!c.put && !before?.also.some((a) => a.thing.toLowerCase() === c.put!.thing.toLowerCase() && sameOpening(a.what, c.put!.what));
  return (!!c.now && !already) || put;
}

/** IS THIS PLACE MADE OF CLOTH, OR DOES THE MOMENT PRESS ON CLOTH? A tent (by its place's words), or a moment in which
 *  something presses, pushes or shows through the fabric, canvas, the tent wall or roof, a curtain or a sheet. Then what
 *  is outside stays outside: it presses the cloth in (acted-staging.ts → revealPart "fabric"). */
const CLOTH = /\b(?:fabric|canvas|cloth|nylon|tent wall|tent's wall|tent roof|tent's roof|tent walls|curtain|curtains|sheet)\b/i;
const PRESSES = /\b(?:press|presses|pressed|pressing|push|pushes|pushed|pushing|through|bulge|bulges|bulged|bulging|sag|sags|sagged|sagging|stretch|stretches|stretched|stretching|outlined|dents?|dented)\b/i;
export function clothPlace(where: string | null | undefined, moment?: string | null): boolean {
  const m = one(moment);
  return TENT.test(one(where)) || (CLOTH.test(m) && PRESSES.test(m));
}
