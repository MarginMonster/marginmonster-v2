/* WHAT THE MEMBER WROTE IS THE STORY — the writer's rules for a story or film made from a member's own idea.
 *
 * A tester, 2026-11-24, after a day of making one of everything: "Horror story still need betterment they not
 * pick what we ask to create exactly" and "Horror Film need more work bro they not exact follow command what we
 * tell". Two of his ideas, and what came back:
 *   · "Two children in house alone in door bell wring they see through window one ghost lady ask to open the door
 *     but they locked the door and set on sofa both and call her mom that away from home." → two ADULTS, and a
 *     hut in a forest.
 *   · "At midnight, a boy heard three slow knocks coming from his bedroom window. When he looked outside, he saw
 *     a dark shadow standing under the old tree. …" → a grown MAN, with a werewolf standing beside him in a
 *     lit bedroom from the first shot.
 * The writer was TOLD to do the first: every horror story was "CAST ONLY ADULTS … recast any endangered character
 * as an adult (the AI render models refuse minors-in-danger, which hard-fails the whole video)", and every other
 * story "Anyone who faces danger, threat, fear or menace is an ADULT". That rule came last in the prompt, so it
 * beat "Tell EXACTLY this". It was a guess about the picture models, and a wrong one: on the same day the
 * tester's own two scenes — two children on a sofa, one on the phone, a pale woman outside the window; a boy in
 * pyjamas at his window, a tall dark shadow under the old tree — were drawn by nano-banana-pro, Seedream 4.5 and
 * nano-banana alike, six pictures out of six, none refused (scratchpad probe, 2026-11-24).
 *
 * So: children stay children — and what may happen to a child in a story is limited instead (CHILDREN_STAY).
 * And the member's idea is the story — its people, its place, its events and its threat (PREMISE_WINS) — said
 * right after the idea itself, with every later rule told it gives way.
 *
 * Pure strings (tests/premise-rules.test.ts); film-engine.server.ts puts them in the writer's prompt. */

/** HOW LONG AN IDEA MAY BE — the Movie Maker's idea box, the form that sends it and the writer's prompt. It was
 *  300 characters in all three, and the same tester's Short Story came to the writer cut off mid-word: "…Their
 *  home was built around the roots of a big tr". An idea is a member's whole story; a paragraph fits. */
export const IDEA_MAX = 1200;

/** Said right after the member's idea. */
export const PREMISE_WINS =
  "THE IDEA IS THE STORY — keep what it says. The SAME PEOPLE: as many as it says, as old as it says, related as it says (two children stay two children, a boy stays a boy, a grandmother stays a grandmother — never older, never younger, never more of them). The SAME PLACE: a house stays a house, a bedroom stays a bedroom, a village stays a village — and when the idea MOVES them (\"he ran to his parents' room\"), the story moves there too. The SAME EVENTS, in the SAME ORDER: every thing it says happens, happens — for real, never as a figure of speech (\"they locked the door\" is a door being locked), told or shown, none left out, none swapped for another. Whatever it says the threat is, the threat is exactly that — \"a dark shadow\" stays a shadow, \"a ghost lady\" stays a ghost woman — never turned into a werewolf, a demon, a monster or anything it did not name. Add only what joins its events together and makes them land: a twist may come only AFTER its last event, and never undoes or contradicts anything it said (\"their mom is away from home\" stays away). Where a rule below would change any of that, THE IDEA WINS (the safety limits at the very end still hold).";

/** Said LAST, after everything else (the writer weighs the last words most): the second live preview still
 *  ended on "their mother … never left the house that evening" — the mother the idea sends away from home. */
export const IDEA_CHECK =
  "LAST, BEFORE YOU ANSWER: read your story against the idea once more — the same people at the same ages, the same place, every event it names in its order and for real, the threat as it named it, and nothing it said made untrue by your ending. Then read it as somebody who has only heard it: the ending makes sense from what the story told, and turns on nothing it never told. Change whatever is not.";

/** IT IS TODAY'S REAL WORLD. The owner, of a Horror Story made from the tester's "two children in house alone"
 *  (2026-11-24): "there isn't much realism … looks like the kids live in a cobblestone house from a fairytale" —
 *  the writer had made the house a lone stone cottage with a round porthole window and a dark green door. */
export const REAL_WORLD =
  "IT IS TODAY'S REAL WORLD unless the idea says otherwise: places look the way real people live in them now — a house is an ordinary modern home of the kind real families in the story's own country live in today (painted walls, an ordinary front door, ordinary rectangular windows, electric lights, ordinary furniture), a street is a real street. Never a storybook or fairytale place — no lone stone cottage, no round porthole window, no hobbit door, no castle, no gothic mansion, no cabin in the woods — unless the idea itself names one. Every picture should look like a photograph of a real place — so SAY it in the words the pictures are drawn from: a home's look names today's materials (painted siding or plaster walls, an ordinary front door, rectangular windows), because a picture model left to guess builds a frightening story's house of rough old stone.";

/* THE SAME RULES WITHOUT HORROR'S EXAMPLES (2026-11-26 — the owner: "Review the horror prompt and see if there is any
 * 'horror' words in the prompt to assure comedy wouldn't get a twisted turn"). The Comedy writer's prompt, captured whole,
 * carried "a dark shadow", "a ghost lady", "a werewolf, a demon, a monster", "a twist", "a frightening story", "the threat",
 * "deep in the dark", "blood" — every one from these shared rules' examples. A genre that is not a frightening one gets
 * the SAME rule in plain words; Horror, Thriller and Mystery keep theirs exactly (frightens(), below). */
export const FRIGHTENING_GENRES: ReadonlySet<string> = new Set(["horror", "thriller", "mystery"]);
export const frightens = (tmplKey: string | null | undefined): boolean => FRIGHTENING_GENRES.has(String(tmplKey || ""));
export const PREMISE_WINS_PLAIN = PREMISE_WINS
  .replace("Whatever it says the threat is, the threat is exactly that — \"a dark shadow\" stays a shadow, \"a ghost lady\" stays a ghost woman — never turned into a werewolf, a demon, a monster or anything it did not name.", "Whatever it says the trouble is, the trouble is exactly that — never swapped for something it did not name.")
  .replace("a twist may come only AFTER its last event", "a surprise may come only AFTER its last event");
export const IDEA_CHECK_PLAIN = IDEA_CHECK.replace("the threat as it named it", "the trouble as it named it");
export const REAL_WORLD_PLAIN = REAL_WORLD.replace("a frightening story's house of rough old stone", "a story's house of rough old stone");

/** Children in a story: they stay children, and nothing happens to them. */
export const CHILDREN_STAY =
  "CHILDREN STAY CHILDREN — a child, a boy or a girl in the idea is that age in the story and in every picture: never a teenager, never a grown-up. A child in a frightening story is NEVER HURT — the fear is suspense: they hear it, see it, hide, run, lock a door, call for help, and they are safe. Nothing grabs, touches, wounds, takes or kills a child, and the threat is never close to one: it is outside a window or a door, at the far end of a hall, deep in the dark, or only heard. In a story with a child in it there is no blood, no violence and nothing graphic — not even in how a child looks: no scraped or bloody knees, no bruise, no bandage, no torn clothes. When the idea has no child in it, its people are grown-ups.";

/** The horror format's safety line. */
export const HORROR_SAFETY =
  `This is FICTIONAL horror for an entertainment video (a horror-short / scary-story channel). Write a GENUINELY SCARY horror story — real menace, dread, danger, frightening imagery and a chilling twist; a horror-FILM feel, NOT a watered-down kids' version. ${CHILDREN_STAY} When everybody in it is a grown-up, violence, death, blood and disturbing imagery are fine when they serve the scare, portrayed with cinematic intent. The ONLY other limits: no gratuitous, lingering torture or graphic mutilation purely for shock, and no real named people. Take the idea and make it as frightening as you can within that.`;

/** Every other story format's safety line (a children's format has its own). */
export const STORY_SAFETY =
  `SAFETY: keep it general and true — invent NO statistics, prices, claims, reviews, ratings or endorsements; no defamation or real named people; nothing adult or unsafe. ${CHILDREN_STAY}`;
/** …the same limits for a genre that is not a frightening one, with no fear, threat, dark or blood in its words */
export const CHILDREN_STAY_PLAIN =
  "CHILDREN STAY CHILDREN — a child, a boy or a girl in the idea is that age in the story and in every picture: never a teenager, never a grown-up. Nothing harms a child, and nothing about a child is graphic — not a scrape, a bruise, a bandage or a torn sleeve. When the idea has no child in it, its people are grown-ups.";
export const STORY_SAFETY_PLAIN =
  `SAFETY: keep it general and true — invent NO statistics, prices, claims, reviews, ratings or endorsements; no defamation or real named people; nothing adult or unsafe. ${CHILDREN_STAY_PLAIN}`;

/** A creature the maker CHOSE for a horror story or film, when the idea calls the threat something else ("a dark
 *  shadow under the old tree", "a voice"): the creature IS that threat, and is seen only the way the idea sees
 *  it. In an ACTED film the two who talk are the idea's own people — the creature is the thing they hear,
 *  glimpse and, in the last shot, see (the film's two speakers are on screen in every shot, faces large: a
 *  creature that is one of them stands beside the other in plain light from the first shot — the werewolf in
 *  the bedroom). `acted`: the film format.
 *  (2026-11-25 — THE MONSTER IS CASTABLE, and WHEN THEY SEE IT, WE SEE IT: the film now draws the thing from its own
 *  picture in every shot that shows it, and a shot whose words put it in view far off is drawn with it there —
 *  acted-staging.ts → sightingOf. So the writer may show it when the idea has the two see it, far off, instead of
 *  "SEEN only in the last shot"; and it calls it by its NAME in every VISUAL that shows it, which is how the film
 *  knows it is the one in the picture.) */
export function chosenThreat(names: ReadonlyArray<string>, acted: boolean): string {
  const list = names.map((n) => String(n || "").trim()).filter(Boolean);
  if (!list.length) return "";
  const who = list.join(" and ");
  const it = list.length > 1 ? "they are" : "it is";
  const is = list.length > 1 ? "are" : "is";
  return acted
    ? ` THE CHOSEN CREATURE${list.length > 1 ? "S" : ""} (${who}): when the idea's threat is something unseen, far off or hidden — a shadow, a voice, a knock, something outside — ${who} ${list.length > 1 ? "ARE" : "IS"} that threat, and NOT one of the two who talk: the two in "cast" are the idea's own people (who it is about, and whoever the idea gives them — a parent, a sister, a friend), and ${who} ${list.length > 1 ? "have" : "has"} no "cast" entry. ${who} ${is} heard and glimpsed the way the idea says (a dark shape under the tree, a whisper through the glass); when the idea has the two SEE ${list.length > 1 ? "them" : "it"} before the end, the VISUAL of that shot shows ${who} there, far off and half in the dark — close only in the last shot. Every VISUAL that shows ${who} calls ${list.length > 1 ? `them by their names (${list.map((n) => `"${n}"`).join(", ")})` : `it by name, "${who}"`} — never just "a figure" or "something": the film draws ${who} from ${list.length > 1 ? "their" : "its"} own picture wherever that name is. Only when the idea itself has ${who} talking with somebody face to face ${it} one of the two.`
    : ` THE CHOSEN CREATURE${list.length > 1 ? "S" : ""} (${who}): when the idea calls its threat something else — a shadow, a figure, a voice — ${who} ${list.length > 1 ? "ARE" : "IS"} that threat and ${it} seen only the way the idea sees it: a dark shape far off, a face at the glass, a sound — whole and in the light only when the idea says so, or at the very end.`;
}
