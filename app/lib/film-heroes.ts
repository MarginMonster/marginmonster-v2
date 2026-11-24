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
  name: string;
  /** the line under the name, and the note after it — together they must fit two lines of a phone card
   *  (about 45 characters: "…your cast on…" was cut off on a 390-px screen, seen 2026-11-22) */
  kick: string;
  meta: string;
  tint: string;
};

export const FILM_HEROES: FilmHero[] = [
  { id: "musicvideo", tmpl: "musicvideo", told: null, media: "musicvideo", name: "Music Video", kick: "Your artist sings on camera", meta: "up to 2 min", tint: "t-mv" },
  { id: "kidstv", tmpl: "kidstv", told: "acted", media: "kidstv", name: "Kids Cartoon", kick: "A cartoon for little ones", meta: "acted out", tint: "t-kids" },
  { id: "kidsmusicvideo", tmpl: "kidsmusicvideo", told: null, media: "kidsmusicvideo", name: "Kids Music Video", kick: "A sing-along for little ones", meta: "about 20 sec", tint: "t-kmv" },
  { id: "moral", tmpl: "moral", told: "narrated", media: "moralstory", name: "Moral Story", kick: "A story with a lesson", meta: "narrated in minutes", tint: "t-moral" },
  { id: "moralfilm", tmpl: "moral", told: "acted", media: "moral", name: "Moral Film", kick: "A lesson, scripted and acted out", meta: "", tint: "t-moral" },
  { id: "horror", tmpl: "horror", told: "narrated", media: "horrorstory", name: "Horror Story", kick: "A scary story", meta: "narrated in minutes", tint: "t-horror" },
  { id: "horrorfilm", tmpl: "horror", told: "acted", media: "horror", name: "Horror Film", kick: "A scare, scripted and acted out", meta: "", tint: "t-horror" },
  { id: "shortstory", tmpl: "testmovie", told: "narrated", media: "shortstory", name: "Short Story", kick: "Your story", meta: "narrated in minutes", tint: "t-film" },
  { id: "testmovie", tmpl: "testmovie", told: "acted", media: "testmovie", name: "Short Film", kick: "Your story, scripted and acted out", meta: "", tint: "t-film" },
];

export const heroById = (id: string | null | undefined): FilmHero | undefined => FILM_HEROES.find((h) => h.id === id);

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
