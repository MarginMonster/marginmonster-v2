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
 */
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
];

/** What a hero's films were called before 2026-11-25. The Archive still holds pieces titled "Short Film — …"
 *  and "Short Story — …": whatever reads a format's name off a title (film-series.ts → isFormatName,
 *  archive-cover.ts → the cover's words) must go on knowing these. */
export const FORMER_HERO_NAMES: readonly string[] = ["Short Film", "Short Story"];

/* THE POSTER FILES. Every hero has a wide still (film-still-<media>.jpg) and a phone one
 * (film-still-<media>-tall.jpg, 4:5) — but for the two whose wide picture is simply cropped on a phone. Only
 * the first nine have a LOOP (film-loop-<media>.mp4 / -tall.mp4 / .jpg): the genres added on 2026-11-25 stand
 * on their still until a real film of each has been made to cut one from. The page and the sign-in lobby
 * keep their own lists of these keys; tests/film-genres.test.ts holds the files to them. */
export const LOOP_MEDIA: readonly string[] = ["musicvideo", "testmovie", "shortstory", "kidstv", "moralstory", "moral", "horrorstory", "horror", "kidsmusicvideo"];
export const TALL_STILL_MEDIA: readonly string[] = [
  "kidstv", "kidsmusicvideo", "testmovie", "moral", "horrorstory", "shortstory", "moralstory",
  "comedy", "comedystory", "thriller", "thrillerstory", "action", "romance", "romancestory", "scifi", "scifistory", "fantasy", "fantasystory", "mystery", "mysterystory",
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
 * minutes. (Which shelf leads is his to change — the order of `SHELVES` is the order on the page.) */
export type HeroShelf = { key: "told" | "acted" | "sung"; name: string; tag: string; line: string; heroes: FilmHero[] };
const SHELVES: ReadonlyArray<Omit<HeroShelf, "heroes"> & { has: (h: FilmHero) => boolean }> = [
  { key: "told", name: "Stories", tag: "Narrated", line: "A narrator tells it over moving pictures · ready in minutes", has: (h) => h.told === "narrated" },
  { key: "acted", name: "Films", tag: "Acted", line: "Actors speak the lines on camera", has: (h) => h.told === "acted" },
  { key: "sung", name: "Music videos", tag: "Sung", line: "Your artist sings on camera", has: (h) => h.told === null },
];
/** The heroes a page offers, as its shelves — every hero on exactly one, in the heroes' own order; a shelf
 *  with nothing on it is not shown. */
export function heroShelves(heroes: ReadonlyArray<FilmHero>): HeroShelf[] {
  return SHELVES.map(({ has, ...s }) => ({ ...s, heroes: heroes.filter(has) })).filter((s) => s.heroes.length > 0);
}
