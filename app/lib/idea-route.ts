/* THE GUIDE BOX'S ANSWER — where an idea typed at the top of the Movie Maker would be made (2026-11-26).
 *
 * The owner, of the box at the top: "I'm not really sure what the describe box at the top hero will be for, unless it
 * guides user on page to actual prompt to use". That is its job: a GUIDE, never a second way to make. A member types an
 * idea; the line under the box says WHERE it would be made ("We'd make this: Story ▾ Horror ▾"); Start takes them into
 * that builder with the idea already in its own prompt box (the shared `topic`), and nothing is made or spent until they
 * press Generate there. Found Footage's camera (an operator's) takes the idea through this tab's sessionStorage.
 *
 * THE GUESS IS KEYWORDS: free, instant, the same every time, testable offline — a wrong guess costs one tap, because the
 * chips are right there. Pure (types only from elsewhere): tests/idea-route.test.ts. */
import type { FilmHero, WayKey } from "./film-heroes.ts";
import type { StoryPictures } from "./story-motion.ts";
import type { CameraLook } from "./camera-dress.ts";

export type IdeaRoute = { way: WayKey; heroId: string | null; rung?: StoryPictures; camera?: CameraLook };

/** A term found in the text: a whole word on both sides (an English plural allowed); `stem*` open on the right; a
 *  phrase with the same ends; CJK / Urdu as a substring (no gaps between words to find). */
function hit(text: string, term: string): boolean {
  if (/[぀-ヿ㐀-鿿؀-ۿ]/.test(term)) return text.includes(term);
  const stem = term.endsWith("*");
  const body = (stem ? term.slice(0, -1) : term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^\\p{L}])${body}${stem ? "" : "(?:e?s)?(?=$|[^\\p{L}])"}`, "iu").test(text);
}
const any = (text: string, terms: readonly string[]): boolean => terms.some((t) => hit(text, t));

const CAM = ["doorbell", "door cam", "security cam", "security camera", "cctv", "nanny cam", "baby monitor", "house cam", "home camera", "trail cam", "caught on cam", "caught on camera", "caught on tape", "caught on video", "found footage", "footage", "body cam", "bodycam", "camcorder", "vhs", "home video", "filmed on my phone", "filmed on a phone", "filmed on her phone", "filmed on his phone", "phone video", "selfie video", "vlog", "livestream", "live stream", "监控", "摄像头", "cámara de seguridad", "caméra de surveillance", "überwachungskamera"];
const CAM_BODY = ["body cam", "bodycam", "police", "officer", "cop", "patrol"];
const CAM_TAPE = ["camcorder", "vhs", "home video", "tape"];
const CAM_PHONE = ["phone", "selfie", "vlog", "livestream", "live stream", "filmed"];
const ANIME = ["anime", "manga", "cel-shaded", "动漫", "アニメ", "اینیمے"];
const ANIME_STYLE: ReadonlyArray<[string, readonly string[]]> = [
  ["animeneon", ["neon", "cyberpunk", "city lights"]],
  ["animeretro", ["retro", "80s", "90s", "synthwave"]],
  ["animeink", ["ink", "samurai", "noir", "sword"]],
  ["animepastel", ["pastel", "cute", "café", "cafe", "bakery", "slice of life"]],
  ["animesky", ["sky", "cloud", "summer", "rain", "train", "umbrella"]],
];
// (audience words only: a story ABOUT a child is not a cartoon FOR one)
const KIDS = ["for kids", "for my kids", "for children", "for my son", "for my daughter", "for little ones", "little ones", "toddler", "preschool*", "bedtime", "nursery", "lullaby", "sing-along", "cartoon", "para niños", "pour les enfants", "pour enfants", "für kinder", "kinderlied", "儿童", "宝宝", "动画片", "بچوں"];
// (never "singer", "rapper", "verse", "band": a story about a singer is still a story)
const SONG = ["song", "sing", "singing", "music video", "lyrics", "chorus", "rap", "anthem", "ballad", "lullaby", "sing-along", "canción", "chanson", "ein lied", "liedtext", "kinderlied", "歌", "唱", "گانا", "گیت"];
/** The genres, in the order they are tried; the template key of each (a Story's and a Film's). Drama is the rest. */
const GENRE_WORDS: ReadonlyArray<[string, readonly string[]]> = [
  ["horror", ["ghost", "haunt*", "monster", "creature", "demon", "horror", "scary", "zombie", "vampire", "werewolf", "possessed", "nightmare", "creepy", "eerie", "reaper", "curse*", "fantasma", "fantôme", "gespenst", "鬼", "بھوت"]],
  ["comedy", ["funny", "comedy", "prank", "hilarious", "goes wrong", "mix-up", "silly", "loses the ring*", "chaos", "joke*", "laugh*", "slapstick", "sitcom", "ridiculous", "awkward"]],
  ["romance", ["love", "romance", "first date", "wedding", "crush", "kiss", "proposal", "valentine", "falls for", "boyfriend", "girlfriend", "amor", "amour", "liebe", "爱情", "محبت"]],
  ["scifi", ["robot", "space", "alien", "future", "android", "planet", "time travel", "spaceship", "cyborg", "artificial intelligence", "mars", "galaxy"]],
  ["fantasy", ["dragon", "magic", "wizard", "spell", "fairy", "kingdom", "elf", "elves", "unicorn", "enchanted", "quest", "witch"]],
  ["mystery", ["detective", "clue", "missing", "murder", "mystery", "who did", "investigat*", "disappear*", "suspect", "1952 letter", "old letter"]],
  ["thriller", ["heist", "kidnap*", "hostage", "thriller", "conspiracy", "spy", "hitman", "getaway", "on the run", "stalk*", "victim", "derail*", "ransom", "blackmail*", "assassin*", "bomb", "countdown"]],
  ["action", ["fight", "explosion", "car chase", "martial art*", "battle", "action", "chase"]],
  ["moral", ["lesson", "kindness", "honest*", "greed", "never judge", "moral", "learns that", "forgive*"]],
];
const GENRE_OF = (text: string): string => GENRE_WORDS.find(([, terms]) => any(text, terms))?.[0] || "testmovie";

const storyOf = (heroes: readonly FilmHero[], tmpl: string): FilmHero | undefined => heroes.find((h) => h.tmpl === tmpl && h.told === "narrated" && !h.shelf);
const filmOf = (heroes: readonly FilmHero[], tmpl: string): FilmHero | undefined => heroes.find((h) => h.tmpl === tmpl && h.told === "acted");

/** What an idea IS, as far as where it is made goes: its genre (a template key — Drama is "testmovie"), whether it is for
 *  little ones, a song, footage caught on a camera (which one), or an anime. The keywords give one at once (signalsOf);
 *  the small model's reading gives a better one a moment later (readIdea → parseIdeaRead). */
export type IdeaSignals = { genre: string; kids: boolean; song: boolean; camera: CameraLook | null; anime: boolean };
function signalsOf(text: string): IdeaSignals {
  return {
    genre: GENRE_OF(text),
    kids: any(text, KIDS),
    song: any(text, SONG),
    camera: any(text, CAM) ? (any(text, CAM_BODY) ? "bodycam" : any(text, CAM_TAPE) ? "camcorder" : any(text, CAM_PHONE) ? "phone" : "house") : null,
    anime: any(text, ANIME),
  };
}

/** Where this idea would be made. `ways`: the ways this viewer is offered (an operator's include "cam" and "anime");
 *  `current`: the way lit on the page; `held`: the member TAPPED that way — then only the pick inside it is guessed, so
 *  their own tap is never overruled by a keyword. */
export function routeIdea(idea: string, o: { heroes: readonly FilmHero[]; ways: readonly WayKey[]; current: WayKey; held?: boolean }): IdeaRoute {
  const text = String(idea || "").toLowerCase();
  return routeOf(signalsOf(text), text, o);
}

/** …and where it would be made from what the small model READ in it (readIdea): the same rules, its signals instead of
 *  the keywords' — an anime's style is still read off its words (the model is not asked for one). */
export function routeFromRead(read: IdeaSignals, idea: string, o: { heroes: readonly FilmHero[]; ways: readonly WayKey[]; current: WayKey; held?: boolean }): IdeaRoute {
  return routeOf(read, String(idea || "").toLowerCase(), o);
}

function routeOf(sig: IdeaSignals, text: string, o: { heroes: readonly FilmHero[]; ways: readonly WayKey[]; current: WayKey; held?: boolean }): IdeaRoute {
  const has = (w: WayKey) => o.ways.includes(w);
  const camOf = (): CameraLook => sig.camera || (any(text, CAM_BODY) ? "bodycam" : any(text, CAM_TAPE) ? "camcorder" : any(text, CAM_PHONE) ? "phone" : "house");
  const animeOf = (): string | null => {
    const k = ANIME_STYLE.find(([, terms]) => any(text, terms))?.[0] || "animedream";
    return o.heroes.some((h) => h.id === k) ? k : o.heroes.find((h) => h.shelf === "anime")?.id || null;
  };
  const kidsOf = (): string => (sig.song && o.heroes.some((h) => h.id === "kidsmusicvideo") ? "kidsmusicvideo" : "kidstv");
  const genreIn = (way: WayKey): IdeaRoute => {
    let g = sig.genre;
    if (way === "acted") {
      const f = filmOf(o.heroes, g) || filmOf(o.heroes, "testmovie");
      return { way, heroId: f?.id || null };
    }
    // (there is no Action Story: action told by a narrator is the nearest told genre, Thriller)
    if (g === "action") g = "thriller";
    const s = storyOf(o.heroes, g) || storyOf(o.heroes, "testmovie");
    return { way, heroId: s?.id || null, rung: way === "still" ? "still" : "moving" };
  };
  if (o.held && has(o.current)) {
    if (o.current === "cam") return { way: "cam", heroId: null, camera: camOf() };
    if (o.current === "anime") return { way: "anime", heroId: animeOf() };
    if (o.current === "kids") return { way: "kids", heroId: kidsOf() };
    if (o.current === "sung") return { way: "sung", heroId: "musicvideo" };
    return genreIn(o.current);
  }
  if (has("cam") && sig.camera) return { way: "cam", heroId: null, camera: camOf() };
  if (has("anime") && sig.anime) { const a = animeOf(); if (a) return { way: "anime", heroId: a }; }
  if (has("kids") && sig.kids) return { way: "kids", heroId: kidsOf() };
  if (has("sung") && sig.song) return { way: "sung", heroId: "musicvideo" };
  // a story: in the way lit on the page when it is a story's (Picture Book, Story or Film), else as a Story
  const way: WayKey = o.current === "still" || o.current === "told" || o.current === "acted" ? o.current : "told";
  return genreIn(has(way) ? way : "told");
}

/* THE IDEA, READ (2026-11-26 — the owner: "This layout looks good, but not routing things properly now"). The keywords sent
 * four of a tester's six real ideas to a Drama: a crown-jewels farce (no "funny" in it), a train-derailment thriller (no
 * "heist"), a puppy's bedtime story (no "for kids"). So once the member stops typing, a small model reads the idea and
 * says what KIND of film it is; that reading is the guess, and the keywords answer only until it comes back. It is still
 * only a guess — the chips change it, and nothing is made or spent from the box. */
export const IDEA_READ_GENRES = ["drama", "comedy", "horror", "thriller", "romance", "scifi", "fantasy", "mystery", "moral", "action"] as const;
const READ_CAMERAS: ReadonlyArray<CameraLook> = ["house", "bodycam", "phone", "camcorder"];
/** The ask: one short JSON answer. */
export function ideaReadAsk(idea: string): string {
  return (
    `A member typed this idea for a short film into a movie maker:\n"""${String(idea || "").replace(/"""/g, "\"").slice(0, 1200)}"""\n` +
    `Say what KIND of film it is. Answer with ONE line of JSON and nothing else: {"genre": …, "kids": …, "song": …, "camera": …, "anime": …}\n` +
    `- genre: the ONE that fits best — ${IDEA_READ_GENRES.map((g) => `"${g}"`).join(", ")}. A farce, a prank, a slapstick mix-up — an idea played MAINLY for laughs — is "comedy"; danger against a clock, a trap, a stalker or a deadly secret is "thriller"; a ghost, a monster or dread is "horror"; a crime to solve is "mystery"; a story told to teach a lesson is "moral"; fights and chases are "action"; a family argument, a secret coming out, a betrayal or a hard choice is "drama", even with a witty line in it.\n` +
    `- kids: true only if it is made FOR young children (a cartoon, a sing-along, a gentle story for little ones) — a story ABOUT a child is not.\n` +
    `- song: true only if it is a song or a music video.\n` +
    `- camera: "house", "bodycam", "phone" or "camcorder" only if the idea says it is footage caught on that kind of camera (a doorbell or security camera is "house"; a police body camera "bodycam"); otherwise null.\n` +
    `- anime: true only if it asks for anime or manga.`
  );
}
/** The reading, checked: every field one of its own values, or null for an answer that is not one. */
export function parseIdeaRead(raw: string): IdeaSignals | null {
  const m = /\{[\s\S]*\}/.exec(String(raw || ""));
  if (!m) return null;
  let v: Record<string, unknown>;
  try { v = JSON.parse(m[0]) as Record<string, unknown>; } catch { return null; }
  const g = String(v.genre ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  const genre = g === "scifi" || g === "sciencefiction" ? "scifi" : (IDEA_READ_GENRES as readonly string[]).includes(g) ? g : "";
  if (!genre) return null;
  const cam = String(v.camera ?? "").trim().toLowerCase();
  return {
    genre: genre === "drama" ? "testmovie" : genre,
    kids: v.kids === true,
    song: v.song === true,
    camera: (READ_CAMERAS as readonly string[]).includes(cam) ? (cam as CameraLook) : null,
    anime: v.anime === true,
  };
}

/** THE STARTERS under the box: one Story, one Film and one original the viewer can make — dealt by the day, so the
 *  server and the browser deal the same three. Each carries its own route (the guess while the box holds its text). */
export type HeroStarter = { text: string; route: IdeaRoute; needs?: WayKey };
export const HERO_STARTERS: { story: HeroStarter[]; film: HeroStarter[]; only: HeroStarter[] } = {
  story: [
    { text: "A night guard hears skates after closing", route: { way: "told", heroId: "horror", rung: "moving" } },
    { text: "Two sisters, one house, one will", route: { way: "told", heroId: "shortstory", rung: "moving" } },
    { text: "A lighthouse keeper finds a 1952 letter", route: { way: "told", heroId: "mystery", rung: "moving" } },
  ],
  film: [
    { text: "A best man loses the rings", route: { way: "acted", heroId: "comedyfilm" } },
    { text: "The getaway driver never shows up", route: { way: "acted", heroId: "thrillerfilm" } },
  ],
  only: [
    { text: "Caught on a doorbell cam at 3 AM", route: { way: "cam", heroId: null, camera: "house" }, needs: "cam" },
    { text: "A bedtime cartoon about a brave little bus", route: { way: "kids", heroId: "kidstv" }, needs: "kids" },
    { text: "A summer song for a drive at dusk", route: { way: "sung", heroId: "musicvideo" }, needs: "sung" },
  ],
};
export function dealHeroStarters(ways: readonly WayKey[], day: number): HeroStarter[] {
  const d = Math.abs(Math.floor(day || 0));
  const pick = <T,>(list: readonly T[]): T | undefined => (list.length ? list[d % list.length] : undefined);
  const story = ways.includes("told") ? pick(HERO_STARTERS.story) : undefined;
  const film = ways.includes("acted") ? pick(HERO_STARTERS.film) : undefined;
  // (an operator always gets the doorbell — the original the owner named first; a member, Kids or a song by the day)
  const only = ways.includes("cam") ? HERO_STARTERS.only[0] : pick(HERO_STARTERS.only.filter((s) => s.needs && ways.includes(s.needs)));
  return [story, film, only].filter((s): s is HeroStarter => !!s);
}

/** THE HANDOFF to Found Footage: the idea rides this TAB's sessionStorage — never the address, never a server log —
 *  for ten minutes, and the builder puts it in its own box once. */
export const IDEA_HANDOFF_KEY = "em-idea-handoff";
export const IDEA_HANDOFF_MS = 10 * 60_000;
export function packHandoff(idea: string, now: number): string {
  return JSON.stringify({ idea: String(idea || "").replace(/\s+/g, " ").trim().slice(0, 400), at: now });
}
export function readHandoff(raw: string | null, now: number): string | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { idea?: unknown; at?: unknown };
    const idea = typeof v.idea === "string" ? v.idea.replace(/\s+/g, " ").trim().slice(0, 400) : "";
    const at = typeof v.at === "number" ? v.at : NaN;
    if (!idea || !Number.isFinite(at) || at > now + 60_000 || now - at > IDEA_HANDOFF_MS) return null;
    return idea;
  } catch {
    return null;
  }
}
