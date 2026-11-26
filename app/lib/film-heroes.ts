/* THE MOVIE MAKER'S HEROES — a format AS IT IS TOLD.
 *
 * A story can be made two ways: ACTED (a script, the cast speak on camera, shot by shot) or NARRATED (a
 * storyteller's voice over a picture for every scene, the words on screen). That used to be a switch inside
 * a format ("The Style: Acted | Narrated"). The owner, 2026-11-22: "I still think we don't use a toggle but
 * create a new hero (scripted horror stories) then Classic Ai Horror stories or something. Same for short
 * story: scripted and acted out vs a different hero altogether that matches the narration model."
 *
 * So the way it is told is part of WHAT YOU PICK, not a setting: each hero below is one format told one
 * way, with its own name, its own poster and its own banner — and the switch is gone from the builder.
 * The rule a maker can read off the grid: a FILM is acted, a STORY is told.
 *
 *   Horror Film  — scripted and acted out          Horror Story — narrated
 *   Short Film   — scripted and acted out          Short Story  — narrated
 *   Moral Film   — scripted and acted out          Moral Story  — narrated
 *   Kids Cartoon — acted (the characters talk)
 *
 * (Moral Film came back on 2026-11-23. The first grid had Moral Story narrated ONLY — and a tester who had
 * been making the acted one said so the same week: "Moral story section previous model do amazing, set this
 * like previous." The engine never lost it; the grid had simply stopped offering it.)
 *
 * The names are a first proposal, each one line to change. `tmpl` is the engine's template key (unchanged:
 * the engine still takes a template and a mode); `media` is the key of the poster files in public/landing
 * (film-loop-<media>.mp4, film-still-<media>.jpg …) — a narrated hero's poster is cut from a real narrated
 * film, so the poster looks like what it makes.
 *
 * THE GENRES ARE MOVIE CATEGORIES (2026-11-25). The owner: "Our genres need to be movie categories (drama,
 * horror, comedy, etch)". The cards were our own formats — "Short Film", "Moral Story", "Horror Story". Now
 * each shelf is a film shelf: Drama, Comedy, Horror, Thriller, Action, Romance, Sci-Fi, Fantasy, Mystery
 * (then Moral, and the Kids Cartoon), the same word on the Stories shelf and on the Films shelf — the SHELF
 * says how it is told. So a hero has two names:
 *
 *   `card`  the one word on its poster ("Comedy");
 *   `name`  what a finished film is called in the Archive, where there is no shelf to say how it was told
 *           ("Comedy Film", "Comedy Story") — still "a FILM is acted, a STORY is told".
 *
 * The Short Film is Drama: its template key (`testmovie`) and both ids (`testmovie`, `shortstory`) are what
 * they were — saved drafts, links and every finished film hold them — and only the words changed ("Drama
 * Film", "Drama Story"). Seven genres are new templates (film-genres.ts → GENRE_FILMS); each is acted and,
 * but for Action, told. What a genre offers inside the builder — its places, starter ideas and director's
 * notes — is film-genres.ts, by template key.
 *
 * THE ANIME MAKER (2026-11-26). The owner: "Maybe just make it an additional tier on the actual movie maker (would
 * look like more options) also would like to add an Anime maker with different styles". A poster is how the home
 * offers an option, so the anime maker is ONE MORE SHELF — "Anime", a poster per style — and each poster opens the
 * SAME story builder the Stories use, already in its style. One style is one template is one hero (SPEC-S15,
 * anime-styles.ts): the style rides the TEMPLATE KEY through the job, `meta.template`, the Archive's name ("Dream
 * Anime Story — …"), Edit story, Next episode and Another language, as every Story's genre does — no new field, no
 * new carry. So the heroes are built FROM the table, never copied by hand: id = template = poster media = the
 * style's key, told by a narrator (an anime style is never acted: S15d), each standing on a shelf of its own
 * (`shelf: "anime"`). Its kick promises what HAPPENS — the kind of story it is told as, its kin — and its card names
 * the look.
 */
import { CAMERA_LOOKS, type CameraLook } from "./camera-dress.ts";
import type { StoryPictures } from "./story-motion.ts";
import { ANIME_STYLES } from "./anime-styles.ts";

export type Told = "acted" | "narrated";
export type FilmHero = {
  /** what the page calls it (and the grid's key) */
  id: string;
  /** the engine template it runs */
  tmpl: string;
  /** how it is told — null for the sung formats, where the question does not arise */
  told: Told | null;
  /** key of its poster media in public/landing */
  media: string;
  /** the word on its poster: the movie category ("Drama") — the shelf it stands on says how it is told */
  card: string;
  /** what a finished film is called in the Archive ("Drama Film", "Drama Story") */
  name: string;
  /** the line under the name, and the note after it — together they must fit two lines of a phone card
   *  (about 45 characters: "…your cast on…" was cut off on a 390-px screen, seen 2026-11-22) */
  kick: string;
  meta: string;
  tint: string;
  /** a hero that stands on a shelf of its OWN rather than its way's: the anime styles (heroShelves) */
  shelf?: "anime";
};

/* THE ORDER HERE IS THE ORDER ON EACH SHELF (heroShelves keeps it): Drama, Comedy, Horror, Thriller, Action,
 * Romance, Sci-Fi, Fantasy, Mystery, Moral — and the Kids Cartoon last on the Films shelf. A genre's Story
 * stands right before its Film, so the pair is one glance in this list. An existing `id` NEVER changes.
 * Each kick is one plain promise, and no other company's film or show is named (two once said the names of
 * children's shows; the owner, 2026-11-17: "they can't say those things").
 * The tints are the ones the page already has (t-film, t-kids, t-horror, t-mv, t-kmv, t-moral): a new genre
 * borrows the nearest, and a tint of its own is one class to add on the page. */
export const FILM_HEROES: FilmHero[] = [
  { id: "musicvideo", tmpl: "musicvideo", told: null, media: "musicvideo", card: "Music Video", name: "Music Video", kick: "Your artist sings on camera", meta: "up to 2 min", tint: "t-mv" },
  { id: "kidsmusicvideo", tmpl: "kidsmusicvideo", told: null, media: "kidsmusicvideo", card: "Kids Music Video", name: "Kids Music Video", kick: "A sing-along for little ones", meta: "about 20 sec", tint: "t-kmv" },
  { id: "shortstory", tmpl: "testmovie", told: "narrated", media: "shortstory", card: "Drama", name: "Drama Story", kick: "A choice that costs", meta: "narrated in minutes", tint: "t-film" },
  { id: "testmovie", tmpl: "testmovie", told: "acted", media: "testmovie", card: "Drama", name: "Drama Film", kick: "A hard choice, scripted and acted out", meta: "", tint: "t-film" },
  { id: "comedy", tmpl: "comedy", told: "narrated", media: "comedystory", card: "Comedy", name: "Comedy Story", kick: "A plan goes wrong", meta: "narrated in minutes", tint: "t-kids" },
  { id: "comedyfilm", tmpl: "comedy", told: "acted", media: "comedy", card: "Comedy", name: "Comedy Film", kick: "Laughs, scripted and acted out", meta: "", tint: "t-kids" },
  { id: "horror", tmpl: "horror", told: "narrated", media: "horrorstory", card: "Horror", name: "Horror Story", kick: "A scary story", meta: "narrated in minutes", tint: "t-horror" },
  { id: "horrorfilm", tmpl: "horror", told: "acted", media: "horror", card: "Horror", name: "Horror Film", kick: "A scare, scripted and acted out", meta: "", tint: "t-horror" },
  { id: "thriller", tmpl: "thriller", told: "narrated", media: "thrillerstory", card: "Thriller", name: "Thriller Story", kick: "A secret and a clock", meta: "narrated in minutes", tint: "t-film" },
  { id: "thrillerfilm", tmpl: "thriller", told: "acted", media: "thriller", card: "Thriller", name: "Thriller Film", kick: "Suspense, scripted and acted out", meta: "", tint: "t-film" },
  // (Action is acted only: a chase is something to SEE — a narrator telling one over pictures is not it)
  { id: "actionfilm", tmpl: "action", told: "acted", media: "action", card: "Action", name: "Action Film", kick: "A chase, scripted and acted out", meta: "", tint: "t-kids" },
  { id: "romance", tmpl: "romance", told: "narrated", media: "romancestory", card: "Romance", name: "Romance Story", kick: "A love story", meta: "narrated in minutes", tint: "t-mv" },
  { id: "romancefilm", tmpl: "romance", told: "acted", media: "romance", card: "Romance", name: "Romance Film", kick: "A love story, scripted and acted out", meta: "", tint: "t-mv" },
  { id: "scifi", tmpl: "scifi", told: "narrated", media: "scifistory", card: "Sci-Fi", name: "Sci-Fi Story", kick: "A near-future what-if", meta: "narrated in minutes", tint: "t-kmv" },
  { id: "scififilm", tmpl: "scifi", told: "acted", media: "scifi", card: "Sci-Fi", name: "Sci-Fi Film", kick: "A what-if, scripted and acted out", meta: "", tint: "t-kmv" },
  { id: "fantasy", tmpl: "fantasy", told: "narrated", media: "fantasystory", card: "Fantasy", name: "Fantasy Story", kick: "Magic with a price", meta: "narrated in minutes", tint: "t-moral" },
  { id: "fantasyfilm", tmpl: "fantasy", told: "acted", media: "fantasy", card: "Fantasy", name: "Fantasy Film", kick: "Magic, scripted and acted out", meta: "", tint: "t-moral" },
  { id: "mystery", tmpl: "mystery", told: "narrated", media: "mysterystory", card: "Mystery", name: "Mystery Story", kick: "A puzzle to solve", meta: "narrated in minutes", tint: "t-horror" },
  { id: "mysteryfilm", tmpl: "mystery", told: "acted", media: "mystery", card: "Mystery", name: "Mystery Film", kick: "A puzzle, scripted and acted out", meta: "", tint: "t-horror" },
  { id: "moral", tmpl: "moral", told: "narrated", media: "moralstory", card: "Moral", name: "Moral Story", kick: "A story with a lesson", meta: "narrated in minutes", tint: "t-moral" },
  { id: "moralfilm", tmpl: "moral", told: "acted", media: "moral", card: "Moral", name: "Moral Film", kick: "A lesson, scripted and acted out", meta: "", tint: "t-moral" },
  { id: "kidstv", tmpl: "kidstv", told: "acted", media: "kidstv", card: "Kids Cartoon", name: "Kids Cartoon", kick: "A cartoon for little ones", meta: "acted out", tint: "t-kids" },
  // THE ANIME STYLES (anime-styles.ts → ANIME_STYLES, in the table's order — the Anime shelf's): one told hero each,
  // built from the row — Dream, Retro, Neon City, Skyglow, Dark Ink, Pastel Days
  ...ANIME_STYLES.map((s): FilmHero => ({ id: s.key, tmpl: s.key, told: "narrated", media: s.key, card: s.card, name: s.name, kick: s.kick, meta: "narrated in minutes", tint: s.tint, shelf: "anime" })),
];

/** What a hero's films were called before 2026-11-25. The Archive still holds pieces titled "Short Film — …"
 *  and "Short Story — …": whatever reads a format's name off a title (film-series.ts → isFormatName,
 *  archive-cover.ts → the cover's words) must go on knowing these. */
export const FORMER_HERO_NAMES: readonly string[] = ["Short Film", "Short Story"];

/* THE POSTER FILES. Every hero has a wide still (film-still-<media>.jpg) and a phone one
 * (film-still-<media>-tall.jpg, 4:5) — but for the two whose wide picture is simply cropped on a phone. Only
 * the first nine have a LOOP (film-loop-<media>.mp4 / -tall.mp4 / .jpg): the genres added on 2026-11-25 stand
 * on their still until a real film of each has been made to cut one from. The page and the sign-in lobby
 * keep their own lists of these keys; tests/film-genres.test.ts holds the files to them.
 * (2026-11-26: the six anime styles' covers too — cut from the style's own TEST pictures, drawn with the told
 *  engine's real prompt pieces: three upright moments wide, one for a phone. No loop: no anime story has moved yet.) */
export const LOOP_MEDIA: readonly string[] = ["musicvideo", "testmovie", "shortstory", "kidstv", "moralstory", "moral", "horrorstory", "horror", "kidsmusicvideo"];
export const TALL_STILL_MEDIA: readonly string[] = [
  "kidstv", "kidsmusicvideo", "testmovie", "moral", "horrorstory", "shortstory", "moralstory",
  "comedy", "comedystory", "thriller", "thrillerstory", "action", "romance", "romancestory", "scifi", "scifistory", "fantasy", "fantasystory", "mystery", "mysterystory",
  "animedream", "animeretro", "animeneon", "animesky", "animeink", "animepastel",
];

export const heroById = (id: string | null | undefined): FilmHero | undefined => FILM_HEROES.find((h) => h.id === id);

/* THE LYRIC VIDEO (lyric-video.ts) — the owner, 2026-11-24: "Add to music section "Lyric Video creator"". A member's
 * own song, its words big and timed over pictures cut on its beat. It is not a film template (nothing is written,
 * acted or sung by us), so it is NOT one of FILM_HEROES and heroById does not know it: the Movie Maker stands its
 * poster on the "Music videos" shelf after the sung heroes, and opens its own builder — for operators only until
 * the owner sets a price. (Its two lines fit a phone card: 44 characters.) */
export const LYRIC_HERO: FilmHero = { id: "lyricvideo", tmpl: "lyricvideo", told: null, media: "lyricvideo", card: "Lyric Video", name: "Lyric Video", kick: "Your song, words on screen", meta: "cut on the beat", tint: "t-lyric" };

/* THE WAY INTO FOUND FOOTAGE — the owner, 2026-11-24: "Put found footage routes into the app and body cam". Found
 * footage has its own builder (routes/web.found-footage.tsx — a phone, a house camera, a body cam), so it is a DOOR on
 * the Films shelf, not a hero this page builds: its poster leads there. Operators only, like the builder itself.
 * (Deep links work too: ?camera=bodycam, ?scare=traffic, ?scare=overbed.) Its two lines fit a phone card: 45. */
export const FOUND_FOOTAGE_DOOR = {
  id: "foundfootage",
  href: "/web/found-footage",
  name: "Found Footage",
  kick: "Caught on camera",
  meta: "phone, house cam, body cam",
  still: "/landing/ff-scare-smile.jpg",
  clip: "/landing/ff-cam-house.mp4",
  tint: "t-ff",
} as const;

/** The hero a film WAS made as — from the engine's own two facts (template, narrated or not). */
export const heroOf = (tmplKey: string, narrated: boolean): FilmHero | undefined =>
  FILM_HEROES.find((h) => h.tmpl === tmplKey && (h.told === null || (h.told === "narrated") === narrated));

/** What a finished film is called in the Archive: its hero's name (an acted horror story is a "Horror
 *  Film"), else the template's own name. */
export const heroName = (tmplKey: string, narrated: boolean, fallback: string): string => heroOf(tmplKey, narrated)?.name || fallback;

/** The heroes a page may offer: those whose template exists, and — for a narrated one — whose template
 *  can be narrated at all. */
export function heroesFor(templateKeys: string[], narratableKeys: string[]): FilmHero[] {
  return FILM_HEROES.filter((h) => templateKeys.includes(h.tmpl) && (h.told !== "narrated" || narratableKeys.includes(h.tmpl)));
}

/* THE SHELVES — told, acted, sung: each under its own heading.
 *
 * The nine posters stood in one grid, a Story beside its Film beside the next Story. The owner, 2026-11-24,
 * with a photo of that grid: "Narrated and acted need segregated in an attractive way my friend, currently
 * it's a bit confusing without clicking through". So the grid is three shelves, and each says in a line what
 * every poster on it has in common — before anything is clicked. The stories first: they are ready in
 * minutes. (Which shelf leads is his to change — the order of `SHELVES` is the order on the page.)
 *
 * A TOLD STORY'S CHEAPEST RUNG IS A SHELF OF ITS OWN (2026-11-26). A story can be told over its STILL pictures, each
 * with a slow camera move — the cheapest thing the Movie Maker makes (film-length.ts → 1 token a second against 2.5
 * moving). The owner asked for it on 2026-11-25, with a photo of the Stories heading: "Stories narrated moving
 * pictures - we also need the timeless pictures with narration as an extremely cheap base tier" — and it went INTO
 * the builder's Length step (Still / Moving, each with its estimate), the Stories line saying "…or cheaper stills".
 * The next day, of that: "Maybe just make it an additional tier on the actual movie maker (would look like more
 * options)". So the still rung stands on the home too, as a shelf right after the Stories (the order is his):
 * "Still Stories" — the same told heroes, in their own order, each opening its builder on the still rung. The Stories
 * shelf says moving pictures again: two headings in a row both saying "or cheaper stills" was noise.
 *
 * THE RULE. Every hero stands on exactly one WAY shelf — told, acted, sung — which is how it is made. A RUNG shelf
 * (`rung`) re-lists the told heroes and opens each one on that rung (web.film.tsx → enterFormat(id, rung)); it adds
 * no hero. That is why the still posters are not FilmHero entries: a template told one way is ONE hero (heroOf and
 * film-series.ts → storyHeroOf read the first match), and a piece made from a still poster is that Story with
 * `meta.rung = "still"` (story-motion.ts → storyIsStill), which Edit story, Next episode and Another language carry.
 * The Stories shelf carries the "moving" rung, so a poster on it opens on moving pictures whatever was picked before.
 * Where a server's pictures cannot move at all (no motion engine), every story is told over stills and the still
 * shelf would only repeat the Stories: heroShelves(…, { still: false }) leaves it out.
 *
 * The still shelf's name, tag and line are a first proposal, each one line to change; so is its place.
 *
 * AN ANIME STORY STANDS ON A SHELF OF ITS OWN (2026-11-26 — the owner: "also would like to add an Anime maker with
 * different styles"). "Anime" comes right after the Still Stories (the order is his: one line to move): a poster per
 * style, each a told hero whose `shelf` is "anime" — so the Stories and the Still Stories do not list it (they hold the
 * movie categories; an anime story is picked by its LOOK, and its maker picks Still for it in its Length panel, where
 * every told story's rung is picked). It is the anime heroes' one shelf, as Stories is the other told heroes'. It
 * carries no rung: the motion test drew Dream and Neon City to life and both drawings held flat and 2D (S15a's verdict,
 * "holds"), so a poster opens on moving pictures like any Story's. Its name, tag and line are a first proposal too. */
/* THE WAYS (2026-11-26). The owner, with a photo of the Stories and the Still Stories rows showing the same nine posters:
 * "This has become repetitive and unorganized and confusing, need ideas to simplify and make it more attractive and
 * billion dollar esc". He picked "A" — one row of big WAY cards, each thing ONCE — and then: "But I don't want to lose our
 * distinctive categories like caught on cam, found footage, and our other uniques" / "Those need to be on display". So the
 * home is a row of way cards — THE LADDER, how a story is told from the cheapest to the most cinematic (Picture Book ·
 * Story · Film), then "Only on EasyMode" (Caught on Cam · Anime · Kids · Music Video) — and under it ONE row: the chosen
 * way's posters. A way is still a shelf here (heroShelves): every hero on exactly one non-rung way, Picture Book
 * re-listing the Story heroes on the still rung (that is not a copy on screen any more: one way's row shows at a time, and
 * Picture Book's posters are pages). The order of SHELVES is the order of the cards — his to change, one line each. */
/** A way card's picture: a real file with NO burnt-in captions (the -tall Story loops have captions: never used). */
export type WayArt = { still: string; clip?: string; /** a wide three-panel strip: only its MIDDLE panel is shown */ strip?: boolean; /** CSS object-position */ at?: string };
export type WayKey = "still" | "told" | "acted" | "anime" | "kids" | "sung" | "cam";
export type HeroShelf = {
  key: "told" | "still" | "anime" | "acted" | "sung" | "kids";
  name: string;
  tag: string;
  line: string;
  /** the row's header line, under the cards ("Pick a genre") */
  pick: string;
  /** the card's SHORT line — what a phone shows under its name (the long `line` shows from 640px): 2026-11-26, the owner
   *  of the phone view: "need better descriptions here" */
  short: string;
  /** the ladder (how a story is told) or "Only on EasyMode" */
  group: "ladder" | "only";
  /** the way card's art */
  art: WayArt;
  /** a RUNG shelf: the told story's rung its posters open on (the told shelf's is "moving") */
  rung?: StoryPictures;
  heroes: FilmHero[];
};
/** The kids' formats: a way of their own — a different audience and a different look; as the 11th poster of the
 *  photoreal Film row they were buried off a phone's screen. So Film and Music Video do not list them. */
export const KIDS_HEROES: readonly string[] = ["kidstv", "kidsmusicvideo"];
/** CAUGHT ON CAM — Found Footage's way on the home (operators only, as its builder is): its row is the builder's
 *  cameras, each opening the builder on that camera (?camera=). Not a shelf: nothing here is a FilmHero. */
export const CAUGHT_ON_CAM = {
  key: "cam" as const,
  name: "Caught on Cam",
  tag: "Found footage",
  line: FOUND_FOOTAGE_DOOR.meta,
  pick: "Pick the camera",
  short: "Phone, house & body cams",
  group: "only" as const,
  art: { still: "/landing/ff-cam-house.jpg", clip: FOUND_FOOTAGE_DOOR.clip, at: "28% 50%" } as WayArt,
  // (each camera's card has its own footage — 2026-11-26, the owner: "Phone needs to be the smiling woman video with iPhone
  //  overlay, camcorder needs to have the camcorder overlay (different video hero)". The phone's and the camcorder's are cut
  //  as a window centered on its own blurred copy, so a phone's 4:5 card and a wide 16:9 one both keep the whole overlay:
  //  the phone's from a real take of "She's smiling" with its recording screen, the camcorder's from the real camcorder film
  //  "What Circled the Tent" with its tape overlay drawn inside the window)
  cameras: (["house", "bodycam", "phone", "camcorder"] as CameraLook[]).map((k) => ({
    key: k,
    name: CAMERA_LOOKS.find((c) => c.key === k)?.name || k,
    still: k === "phone" || k === "camcorder" ? `/landing/ff-way-${k}.jpg` : `/landing/ff-cam-${k}.jpg`,
    clip: k === "phone" || k === "camcorder" ? `/landing/ff-way-${k}.mp4` : `/landing/ff-cam-${k}.mp4`,
  })),
};
const SHELVES: ReadonlyArray<Omit<HeroShelf, "heroes"> & { has: (h: FilmHero) => boolean }> = [
  // (NAMES, 2026-11-26 — the owner, of the phone view: "Picture book sounds like a physical book / story / film come across as
  //  confusing need better descriptions here". The ladder is his own hierarchy, in his words: "narrated with stills / simple,
  //  narrated with stills to video mid, and acted premium" → Narrated Pictures · Narrated Video · Acted Film.)
  { key: "still", name: "Narrated Pictures", tag: "Cheapest", line: "A narrator tells it over still pictures that slowly move", short: "Still images, read aloud", pick: "Pick a genre", group: "ladder", rung: "still",
    art: { still: "/landing/film-still-fantasystory-tall.jpg" }, has: (h) => h.told === "narrated" && !h.shelf },
  { key: "told", name: "Narrated Video", tag: "Most popular", line: "A narrator tells it over moving pictures", short: "Every scene moves", pick: "Pick a genre", group: "ladder", rung: "moving",
    art: { still: "/landing/film-loop-horrorstory.jpg", clip: "/landing/film-loop-horrorstory.mp4", strip: true }, has: (h) => h.told === "narrated" && !h.shelf },
  { key: "acted", name: "Acted Film", tag: "Premium", line: "Actors speak the lines on camera", short: "Characters talk on camera", pick: "Pick a genre", group: "ladder",
    art: { still: "/landing/film-still-testmovie-tall.jpg", clip: "/landing/film-loop-testmovie-tall.mp4" }, has: (h) => h.told === "acted" && !KIDS_HEROES.includes(h.id) },
  { key: "anime", name: "Anime", tag: "New", line: "A narrator tells it over hand-drawn anime pictures", short: "Hand-drawn, six styles", pick: "Pick a style", group: "only",
    art: { still: "/landing/film-still-animesky-tall.jpg", at: "50% 30%" }, has: (h) => h.shelf === "anime" },
  { key: "kids", name: "Kids", tag: "For little ones", line: "Cartoons and sing-alongs", short: "Cartoons & sing-alongs", pick: "Pick one", group: "only",
    art: { still: "/landing/film-still-kidstv-tall.jpg", clip: "/landing/film-loop-kidstv-tall.mp4" }, has: (h) => KIDS_HEROES.includes(h.id) },
  { key: "sung", name: "Music Video", tag: "Sung", line: "Your artist sings on camera", short: "Your artist sings", pick: "Pick one", group: "only",
    art: { still: "/landing/film-loop-musicvideo.jpg", clip: "/landing/film-loop-musicvideo-tall.mp4", at: "50% 25%" }, has: (h) => h.told === null && !KIDS_HEROES.includes(h.id) },
];
/** The heroes a page offers, as its shelves — every hero on exactly one WAY shelf (or, an anime style, on its own), in
 *  the heroes' own order, and the told heroes again on a rung shelf; a shelf with nothing on it is not shown (a page
 *  that is not offered the anime templates has no Anime shelf). `still: false` (a server whose
 *  pictures cannot move) leaves out the shelves whose rung is "still" — and the Stories there say what they are
 *  then told over, the still shelf's own line. (Review of S13c, 2026-11-26: the Stories' line had become "…over moving
 *  pictures" alone, and STORY_MOTION=off — the kill switch — would have left it promising motion over a story told
 *  over stills; the line it replaced at least named the stills.) */
export function heroShelves(heroes: ReadonlyArray<FilmHero>, o: { still?: boolean } = {}): HeroShelf[] {
  const still = o.still !== false;
  const stillWay = SHELVES.find((s) => s.rung === "still")!;
  // (where nothing can move, the Story says what it is told over then — and shows no motion: Picture Book's art)
  return SHELVES.filter((s) => still || s.rung !== "still")
    // (the Kids' row in its own order: the cartoon first — the bigger draw — then the sing-along)
    .map(({ has, ...s }) => ({ ...s, ...(!still && s.rung === "moving" ? { line: stillWay.line, art: stillWay.art } : {}), heroes: s.key === "kids" ? heroes.filter(has).sort((a, b) => KIDS_HEROES.indexOf(a.id) - KIDS_HEROES.indexOf(b.id)) : heroes.filter(has) }))
    .filter((s) => s.heroes.length > 0);
}
/** A way named in a link (?way=…) — one of the ways' keys, or null. */
export const wayParamOf = (v: unknown): WayKey | null => {
  const k = String(v ?? "").trim().toLowerCase();
  return k === "still" || k === "told" || k === "acted" || k === "anime" || k === "kids" || k === "sung" || k === "cam" ? k : null;
};

/** A poster's key on the page — the zoom key, so the same hero standing on two shelves pops only where it was
 *  tapped: `still:<id>` on the still shelf, the plain id everywhere else. */
export const posterKey = (id: string, rung?: StoryPictures): string => (rung === "still" ? `still:${id}` : id);
