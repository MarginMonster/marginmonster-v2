/* The words that draw a character — client-safe and import-free, so the tests can read them.
 *
 * Creating a character used to be one step: upload a photo, pay, get "a clean professional presenter
 * photo" in four human outfits. The owner gave it a rough ink drawing of a hulking antlered creature
 * and got back a man in an open shirt with a deer skull for a head, in Casual / Smart / Active / Street
 * (2026-11-17: "a humanoid monster not even close to reference image").
 *
 * So there are now three KINDS of character, each drawn its own way, and the first picture is a
 * PREVIEW the maker sees before anything is charged:
 *   person   a real-looking presenter, waist up — later forged into four outfits
 *   cartoon  a cartoon character, whole figure — one look, never re-dressed
 *   monster  a creature — one look, photographed like a horror film's
 *
 * THE MAKER'S WORDS WIN (2026-11-24). The owner picked Creature and wrote "Demonic woman human body with a
 * mouth too large to be human blue eyes blonde hair off putting unsettling hyper realistic" — he meant a REAL
 * woman whose grin is far too wide. He got a grey, emaciated alien with a star-shaped maw for a head, spines
 * and claws (with the blonde hair and the blue eyes). The creature recipe had named the subject first ("a
 * character design of a creature"), then forbidden what he asked for ("Do NOT make it more human … no human
 * face, no human hands, no human physique") — and only then quoted him, as an afterthought. So now:
 *   · the words come FIRST, as the subject of the picture;
 *   · the kind sets the style, the framing and whatever the words leave open — never what they say;
 *   · a creature is kept from being made human only when the words do not make it human themselves
 *     (creatureBody): "a woman … human body" is a real woman with ONLY the wrongness the words name;
 *   · a word of mood ("demonic", "unsettling") is shown in the face and the light, never as more body. */

export type CharKind = "person" | "cartoon" | "monster";

export const charKindOf = (v: unknown): CharKind => (v === "cartoon" || v === "monster" ? v : "person");

/** The longest description a maker can give. */
export const CHAR_DESC_MAX = 400;

const FIGURE = "The whole figure is in frame from head to feet, facing the camera, centred, with a little space above the head.";
// A creature is not stood up straight like a model: a hunched beast stays hunched.
const CREATURE_FIGURE = "The whole creature is in frame from the top of its head to its feet, in its own natural stance, facing the camera, centred, with a little space above it.";
// A real-looking body whose wrongness is mostly in the FACE (a grin too wide, eyes too far apart) is lost at
// head-to-feet size — a 3:4 frame gives the face a tenth of its height. The knees keep the hands and the arms.
const UNCANNY_FIGURE = "Framed from the top of the head down to the knees, facing the camera, centred, close enough that the face — and anything wrong with it — is clearly seen.";
const CLEAN = "No text, no logo, no watermark, nobody else in the picture.";
// A reference is often a screenshot or a photo of a drawing: the phone's icons and the page around it are not the character.
const REF_ONLY = "Ignore any icons, borders, captions or interface marks around the reference.";

/* ---- WHAT THE WORDS MAKE A CREATURE ----
 * Read off the first thing the description NAMES (whatever adjectives come before it) and the words that run on
 * with it up to its first "with", "in", "wearing" or comma: "Demonic woman human body with a mouth…" names a
 * woman; "a werewolf in a torn shirt" a werewolf; "a woman with the head of a wolf" is a woman; "a demon woman"
 * is both. A hyphen makes a word a quality, not the thing: a "cat-like woman" is a woman, a "man-eating plant"
 * is no man. */
const HUMAN = /\b(?:(?:wom|m)[ae]n|girls?|boys?|lad(?:y|ies)|gentlem[ae]n|guys?|gals?|persons?|people|child(?:ren)?|kids?|teen(?:ager)?s?|toddlers?|bab(?:y|ies)|adults?|mothers?|moms?|mums?|fathers?|dads?|grand(?:mother|ma|father|pa)s?|grann(?:y|ies)|daughters?|sons?|sisters?|brothers?|aunts?|uncles?|wi(?:fe|ves)|husbands?|brides?|grooms?|widow(?:er)?s?|nuns?|priests?|monks?|nurses?|doctors?|soldiers?|sailors?|fisher(?:m[ae]n|wom[ae]n)|farmers?|cowboys?|cowgirls?|pirates?|clowns?|witch(?:es)?|wizards?|kings?|queens?|princes?|princess(?:es)?|knights?|hunters?|maids?|butlers?|teachers?|students?|chefs?|cooks?|police(?:m[ae]n|wom[ae]n)?|officers?|detectives?|athletes?|dancers?|singers?|actors?|actress(?:es)?|business(?:m[ae]n|wom[ae]n)|astronauts?|cheerleaders?|hikers?|twins?)\b(?!-)/i;
// Human-shaped, and not ordinary people: drawn as the words say, neither forced human nor forbidden it.
const HUMANLIKE = /\b(?:vampires?|zombies?|ghosts?|ghouls?|wraiths?|spirits?|phantoms?|spect(?:re|er)s?|apparitions?|banshees?|revenants?|poltergeists?|mumm(?:y|ies)|corpses?|cadavers?|undead|lich(?:es)?|succub(?:us|i)|incub(?:us|i)|sirens?|mer(?:maids?|m[ae]n)|el(?:f|ves)|fair(?:y|ies)|nymphs?|dolls?|puppets?|mannequins?|scarecrows?|skeletons?|reapers?|angels?|hags?|doppelg(?:a|ä)ngers?|changelings?|androids?|cyborgs?)\b(?!-)/i;
const NON_HUMAN = /\b(?:werewol(?:f|ves)|wol(?:f|ves)|lycans?|beasts?|creatures?|monsters?|demons?|devils?|fiends?|aliens?|dragons?|trolls?|ogres?|goblins?|orcs?|gremlins?|imps?|minotaurs?|gargoyles?|golems?|krakens?|hydras?|wyverns?|basilisks?|chimeras?|griffins?|hellhounds?|hounds?|insects?|spiders?|arachnids?|snakes?|serpents?|lizards?|reptiles?|sharks?|octop(?:us|uses|i)|squids?|crabs?|worms?|slugs?|beetles?|mantis(?:es)?|moths?|bats?|rats?|dogs?|cats?|bears?|apes?|gorillas?|robots?|droids?|mechs?|mutants?|cryptids?|bigfoot|sasquatch(?:es)?|yetis?|chupacabras?|wendigos?|skinwalkers?|mothman|blobs?|slimes?|abominations?|things?|entit(?:y|ies))\b(?!-)/i;
// The words say the BODY is a person's…
const HUMAN_BODY = /\b(?:(?:ordinary|normal|real|regular|average|plain) (?:human|person|woman|man)|human[- ](?:body|bodies|form|figure|beings?|shape|proportions|anatomy|physique|looking)|looks? (?:(?:almost|nearly|completely|fully|totally|perfectly|very) )?human)\b/i;
// …or give it a person's parts ("with a human face", "a woman's hands")
const HUMAN_PART = /\b(?:human[- ](?:face|faces|hands?|skin|eyes|mouth|head|teeth|feet|legs|arms|torso)|human-?like|humanoid|(?:wom[ae]n|m[ae]n|girl|boy|child|person|human|lady)['’]s)\b/i;
const HEAD_END = /\b(?:with|who|whose|wearing|carrying|holding|in|that|which|and)\b|[,;:(.!?]/i;

/** What a creature's words make its BODY:
 *    uncanny    a human being ("a woman", "an old man", "human body") — real, ordinary, with ONLY the
 *               wrongness the words name
 *    humanlike  human-shaped but not an ordinary person (a vampire, a ghost, "a demon woman", "a thing with a
 *               woman's face") — drawn as the words say, neither made human nor forbidden it
 *    beast      anything else (a werewolf, a swamp thing, a demon) — never made human unless the words say so */
export type CreatureBody = "uncanny" | "humanlike" | "beast";
export function creatureBody(desc: string): CreatureBody {
  const said = String(desc || "").replace(/\s+/g, " ").trim();
  const hits = [HUMAN, HUMANLIKE, NON_HUMAN]
    .map((re, k) => { const m = re.exec(said); return m ? { k, at: m.index } : null; })
    .filter((h): h is { k: number; at: number } => !!h)
    .sort((a, b) => a.at - b.at);
  const first = hits[0];
  if (!first) return HUMAN_BODY.test(said) ? "uncanny" : HUMAN_PART.test(said) ? "humanlike" : "beast";
  const head = said.slice(first.at).split(HEAD_END)[0] || "";
  if (first.k === 0) return HUMANLIKE.test(head) || NON_HUMAN.test(head) ? "humanlike" : "uncanny";
  if (first.k === 1) return "humanlike";
  return HUMAN.test(head) || HUMANLIKE.test(head) || HUMAN_BODY.test(said) || HUMAN_PART.test(said) ? "humanlike" : "beast";
}

/** The words of MOOD in a description ("demonic", "off putting", "unsettling"), as written — each once. A mood is
 *  how a character comes across; drawn as more body, "demonic" grew spines and claws on a woman. */
const MOOD = /\b(?:demonic|devilish|evil|wicked|sinister|creepy|scary|spooky|eerie|unsettling|disturbing|off[- ]?putting|menacing|uncanny|terrifying|horrifying|frightening|nightmarish|haunting|ominous|malevolent|malicious|twisted|cursed|possessed|hellish|unholy|unnerving|freaky|threatening)\b/gi;
export function moodWords(desc: string): string[] {
  const out: string[] = [];
  for (const m of String(desc || "").matchAll(MOOD)) {
    const w = m[0].toLowerCase();
    if (!out.includes(w)) out.push(w);
  }
  return out.slice(0, 6);
}
// (the mood words are NOT said again here: told "demonic" twice, Seedream gave the woman a vampire's fangs and
//  an elf's ears — and naming "no fangs, no pointed ears" drew them all the same, so this names no part at all)
const moodLine = (said: string): string =>
  moodWords(said).length ? "Every word of mood in that description is carried only by the expression, the stare, the stillness and the light — never by changing the body." : "";

/* WHAT THE WORDS DO NOT MENTION IS ORDINARY — said as what it IS, never as a list of what it is not: a picture
 * model told "no fangs, no pointed ears" draws fangs and pointed ears (Seedream 4.5, 2026-11-24, twice). */
const PARTS: ReadonlyArray<[string, RegExp]> = [
  ["ears", /\bears?\b/i],
  ["teeth", /\b(?:teeth|tooth|fangs?|tusks?)\b/i],
  ["eyes", /\beyes?\b/i],
  ["nails", /\b(?:(?:finger)?nails?|claws?|talons?)\b/i],
  ["skin", /\b(?:skin|flesh|complexion)\b/i],
  ["hands", /\b(?:hands?|fingers?)\b/i],
];
/** "Their ears, teeth, nails, skin and hands are an ordinary person's." — every one of those parts the words do
 *  not mention (a part they DO mention is theirs to describe). "" when they mention them all. */
export function ordinaryParts(desc: string): string {
  const free = PARTS.filter(([, re]) => !re.test(String(desc || ""))).map(([p]) => p);
  if (!free.length) return "";
  const list = free.length === 1 ? free[0] : `${free.slice(0, -1).join(", ")} and ${free[free.length - 1]}`;
  return `Their ${list} ${free.length === 1 && !/s$/.test(free[0]) ? "is" : "are"} an ordinary person's.`;
}

/** A writer's reading of the words, when there is one (character-look.ts): the picture said in plain visual
 *  terms, and every attribute the words state. Only the PICTURE rides into the prompt — the list is for the
 *  reader: set out as a list, Seedream drew its items as separate things (a second, giant smiling face where the
 *  woman's body should be). */
export type CharBrief = { picture: string; attributes: string[] };
const briefLines = (b: CharBrief | null | undefined): string => {
  const picture = String(b?.picture || "").replace(/\s+/g, " ").trim();
  return picture ? `In plain picture terms: ${picture}${/[.!?]$/.test(picture) ? "" : "."}` : "";
};

/** The prompt for the one picture a maker sees first. `hasRef`: they added a picture of the character.
 *  `brief`: the writer's reading of their words (none when it could not be had — the words alone still lead). */
export function characterPreviewPrompt(kind: CharKind, desc: string, hasRef: boolean, brief?: CharBrief | null): string {
  const said = desc.trim().replace(/\s+/g, " ").slice(0, CHAR_DESC_MAX);
  const words = said ? `In the maker's words: ${said}${/[.!?]$/.test(said) ? "" : "."}` : "";
  const plain = said ? briefLines(brief) : "";
  if (kind === "monster") {
    const body = creatureBody(said);
    // A PICTURE IS THE TRUTH (the owner, 2026-11-24: his own picture of a grinning woman, as a Creature with no
    // words, came back "a hairy, horned, clawed monster body with a woman's grinning face" — "Creature seems to be
    // creating and adding things when it shouldn't be unless prompted"). The BEAST's wording — every horn, spike
    // and inch of fur kept, never made more human — is for a picture whose words say it IS a beast. Any other
    // picture, and every picture without words, is given back as the very being it shows, photographed: nothing
    // added, nothing taken away.
    // (not "as a horror film would": told that, Seedream gave the grinning woman corpse make-up and blood)
    if (hasRef && !(body === "beast" && NON_HUMAN.test(said))) {
      return [
        "Photograph EXACTLY the one in the reference image — the same being, whatever it is: a person, a creature, or anything between.",
        words,
        plain,
        said ? "Where those words ask for something the reference does not show, change only that." : "",
        "It keeps the same body and build, the same face and every feature on it, the same skin, hair, colours and clothes, in its own stance. Nothing is added and nothing is taken away: it is made neither more human nor more monstrous than the reference shows it.",
        moodLine(said),
        "It is PHOTOGRAPHED: real skin, real hair, fine film grain — never CGI, a 3D render or an illustration.",
        "Framed as the reference is framed — as much of it as the reference shows, and no more — facing the camera.",
        "Plain seamless mid-grey studio backdrop, moody soft light. No blood.",
        REF_ONLY,
        CLEAN,
      ].filter(Boolean).join(" ");
    }
    const real = body === "uncanny" && !hasRef;
    return [
      hasRef
        ? "Redraw the creature in the reference image as a finished, highly detailed character design: a photorealistic practical-effects creature from a horror film, eerie rather than gory."
        : real
          ? "A photograph of a real person, as a horror film would shoot them — exactly the character the maker describes."
          : `A photograph of ${body === "humanlike" ? "a character" : "a creature"} from a horror film — exactly the one the maker describes.`,
      words,
      plain,
      // The first drafts kept the antlers and lost the BEAST: a hulking, hunched mass came back as a tall
      // lean athlete. Mass and stance are named outright, and so is every part a model likes to tidy away.
      hasRef
        ? "It must stay the SAME creature — the same silhouette and the same MASS: where the reference is hulking, hunched, bloated or heavy, it is every bit as hulking, hunched, bloated or heavy here, never slimmer, taller or more athletic. The same stance, the same head and every feature on it, the same eyes, jaws and teeth wherever they are on the body, the same horns or antlers, spikes, fur, limbs and body, the same colours and surface."
        : "",
      // WHAT IT IS — said only as far as the words leave it open
      body === "beast"
        ? hasRef
          ? "Do NOT make it more human and do not dress it: no human face, no human hands, no human physique, no clothes unless they are asked for or shown."
          : "It is a creature, not a person in a costume or a mask: no human face, human skin or human hands unless those words give it them, and no clothes unless they are asked for."
        : real
          ? `They are a real human being: an ordinary human body and face, with natural human proportions, dressed in plain ordinary clothes unless the words name others. The ONLY things wrong with them are the ones those words name — each shown plainly and unmistakably, never toned down — and everything else about them is completely, ordinarily human. ${ordinaryParts(said)}`.trim()
          : "Draw it exactly as those words describe it — as human as they make it and no more monstrous than they ask for — dressed as they say, or, if they say nothing, as such a character usually is.",
      !said ? ""
        : real
          ? "Every detail in those words is shown exactly as written — who they are, their body, face, eyes, hair, skin, colours and clothes, and anything strange or wrong about them — and nothing is added that changes what they are."
          : "Every detail in those words is shown exactly as written — what it is, its body, face, eyes, hair, skin, colours and clothes, and anything strange or wrong about it — and nothing is added that changes what it is.",
      moodLine(said),
      // HOW IT IS SEEN: photographed, never rendered (story-picture.ts CREATURE_REAL is the story's own take on it)
      hasRef
        ? ""
        : real
          ? "Unless those words ask for another style, it is PHOTOGRAPHED, as real as a frame of a film: real skin with pores, real hair, real teeth, fine film grain — never CGI, a 3D render, an illustration, concept art, a mask or a costume."
          : "Unless those words ask for another style, it is PHOTOGRAPHED: a practical-effects creature as a horror film would build it — real skin, fur, hair and teeth — eerie rather than gory, with fine film grain; never CGI, a 3D render, an illustration or concept art.",
      real ? UNCANNY_FIGURE : CREATURE_FIGURE,
      "Plain seamless mid-grey studio backdrop, moody soft light. No blood.",
      hasRef ? REF_ONLY : "",
      CLEAN,
    ].filter(Boolean).join(" ");
  }
  if (kind === "cartoon") {
    return [
      hasRef
        ? "Redraw the character in the reference image as a finished, polished character design, in the reference's own art style."
        : "A finished, polished cartoon character design. Unless the maker asks for another style: feature-film quality 3D animation, with appealing stylised proportions, large expressive eyes and richly detailed fur, skin and fabric.",
      words,
      plain,
      hasRef
        ? "It must stay the SAME character — the same design, proportions, colours, markings, face, and the same clothing and accessories. Add nothing that is not there."
        : "A bold recognisable silhouette, and no accessories beyond the ones the words name.",
      said ? "Every detail in those words is shown exactly as written — what the character is, its colours, markings, face, clothes and accessories — and nothing is added that changes what it is." : "",
      "It is a cartoon character, not a person in a costume.",
      FIGURE,
      "Plain seamless light-grey studio backdrop, soft even studio light.",
      CLEAN,
    ].filter(Boolean).join(" ");
  }
  return [
    hasRef
      ? "The reference image shows a person or a brand character. Recreate the EXACT same one — identical face, hair, colours and features — as a clean professional portrait photograph."
      : "A photorealistic professional portrait photograph of one person.",
    words,
    plain,
    // (a person's portrait was where "a mouth too large to be human" was most at risk of being tidied away)
    said ? `Every detail in those words is shown exactly as written — who they are, their face, eyes, hair, skin, build and clothes, and anything unusual or unsettling about them, which is never smoothed over, beautified or made normal — and nothing is added that changes who they are. ${ordinaryParts(said)}`.trim() : "",
    moodLine(said),
    `Half-body framing: waist up, facing the camera, arms relaxed and visible, ${said ? "in the clothes those words give them — or, if they name none, a relaxed everyday outfit" : "a relaxed everyday outfit"}.`,
    "Soft even studio light on a plain warm neutral backdrop, sharp focus.",
    CLEAN,
  ].filter(Boolean).join(" ");
}

/** What a picture model must not "fix" about a character when it draws them again (a full-body still, a
 *  scene): a creature has no human hands, a cartoon pup wears no trousers. Empty for a person. A creature
 *  whose words make it a real-looking human (creatureBody) is told to stay one — with its wrongness — and
 *  never the opposite: told "never a human face", the 3D figure of a woman would come back a monster. */
export function characterContinuity(kind: CharKind, desc: string): string {
  if (kind === "person") return "";
  const said = desc.trim().replace(/\s+/g, " ").slice(0, 240);
  if (kind === "cartoon") return `This is a cartoon character, not a person${said ? ` (${said})` : ""}. Its whole body stays exactly as in the reference, in the same art style — the same design, colours and markings, and only the clothes and accessories it already has.`;
  const body = creatureBody(said);
  if (body === "uncanny") return `This character looks like a real human being${said ? ` (${said})` : ""}: an ordinary human body, face, skin and hands, wrong ONLY where the reference shows it. Everything stays exactly as in the reference — the same face and the same wrongness, never smoothed away, the same hair, skin, build and clothes — and nothing more monstrous is added.`;
  // (a creature made from a picture with no words is whatever that picture shows — never told "not a person")
  if (body === "humanlike" || !NON_HUMAN.test(said)) return `This is a creature${said ? ` (${said})` : ""}. Its whole body stays exactly as in the reference — the same face, anatomy, skin, hair, limbs and proportions, and only the clothes it has there — never made more human and never more monstrous than it is in the reference.`;
  return `This is a creature, not a person${said ? ` (${said})` : ""}. Its whole body stays exactly as in the reference — the same anatomy, hide, limbs, claws and proportions. Never human skin, human hands or a human face, and no clothes that are not in the reference.`;
}

/** AN EDIT IS AN EDIT (the owner, 2026-11-24: "I tried to edit her hair to blonde and it changed her face"). "Edit
 *  description" used to draw the character afresh from the new words — a new face every time. Now the look the
 *  maker has already seen is the reference, and only what the new words change is changed. `before`: the words
 *  that look was drawn from ("" when it came from a picture alone). */
export function characterEditPrompt(kind: CharKind, before: string, after: string): string {
  const was = before.trim().replace(/\s+/g, " ").slice(0, CHAR_DESC_MAX);
  const now = after.trim().replace(/\s+/g, " ").slice(0, CHAR_DESC_MAX);
  const end = (s: string) => `${s}${/[.!?]$/.test(s) ? "" : "."}`;
  const who = kind === "cartoon" ? "the same cartoon character, in the same art style" : kind === "monster" ? "the same being" : "the same person";
  return [
    "Edit the reference image: it is the character exactly as the maker has already seen it.",
    was ? `It was drawn from these words: ${end(was)}` : "",
    now ? (was ? `The maker has changed the words to: ${end(now)}` : `The maker now asks for: ${end(now)}`) : "",
    `Change ONLY what the new words ${was ? "change from the old ones" : "ask for"} — nothing else. Keep everything else exactly as it is in the reference: above all ${who}, with the same face and every feature on it — and, wherever the new words do not change them, the same expression, body, build, skin, hair, clothes, pose, framing, light, background and style.`,
    CLEAN,
  ].filter(Boolean).join(" ");
}

/* ---- a character in a FILM's cast ----
 * The film engines compose shots from the cast's pictures. Their identity locks were written for people
 * ("same face, same hair, same skin, same age"); told that about a werewolf, a picture model gives it a
 * man's face. These say the same thing for a cast that is not all people. */

/** The lock for a shot composed from cast pictures when at least one of them is not a person. */
export const MIXED_CAST_LOCK = "CRITICAL: every character from the reference images is the EXACT same one here — the same face, body, colours, fur or skin, markings, hair and clothing, and nothing added to what it wears. A creature stays a creature and a cartoon character stays a cartoon character: never made human, never given a human face, human skin or human hands, never redrawn in another style. Any real person stays the exact same individual at the same age — never beautified, restyled or swapped.";

/** How to tell a picture model that reference image `n` IS this cast member, for a character who is not a person. */
export const characterInRef = (name: string, n: number, look?: string): string =>
  `${name} — EXACTLY the character in reference image ${n}${look ? ` (${look.trim().slice(0, 200)})` : ""}: the same creature design — the same head and face, eyes, fur or skin, colours and markings, body shape and size — wearing only what it wears in that picture. It is NOT a human being: no human face, no human skin, no human hands`;

/** The word a character goes by in name keys: the first word of the name that is not "the", lower-cased
 *  ("The Ganve" → "ganve", "Mourning Mary" → "mourning", "Howl" → "howl"). */
export const nameTok = (n: string | null | undefined): string => {
  const w = (n || "").toLowerCase().split(/[\s,]+/).filter(Boolean);
  return w.find((x) => x !== "the") || w[0] || "";
};
