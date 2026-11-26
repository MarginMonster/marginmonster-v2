/* THE ANIME MAKER, IN STYLES — one table the told engine and the Movie Maker's shelf share.
 *
 * The owner, 2026-11-26: "Maybe just make it an additional tier on the actual movie maker (would look like more
 * options) also would like to add an Anime maker with different styles".
 *
 * ONE STYLE IS ONE TEMPLATE (SPEC-S15). Each row here becomes a real FILM_TEMPLATES entry (film-engine.server.ts →
 * animeTemplate), the way the seven movie categories became templates from GENRE_FILMS on 2026-11-25 — so the style
 * rides the TEMPLATE KEY through everything that exists: the job, `meta.template`, the Archive's name ("Dream Anime
 * Story — …"), Edit story, Next episode and Another language. No new field is threaded through four picture paths,
 * and a poster on the shelf is one tap to the same story builder, already in that style. (A style picked INSIDE the
 * builder was weighed and dropped: it needed a new field through the job, the scene seeds, meta and every carry, the
 * Archive name could not say it, and changing it once pictures existed meant an armed redraw.)
 *
 * EACH STYLE IS TOLD AS A KIND OF STORY — its `kin`, one of the movie categories (film-genres.ts → GENRE_FILMS). A
 * genre is a promise about what HAPPENS; a drawing style alone promises nothing. So a style takes its kin's narrated
 * brief, starter ideas and director's notes, its faces and its world, and only its LOOK is its own: "Neon City · A
 * neon-lit what-if". In anime the two go together anyway — the cosy slice-of-life, the neon-city what-if, the
 * luminous romance after the rain.
 *
 * TOLD ONLY. A told story takes its whole look from its template (portraits, place sheets, scenes and the writer's
 * VISUAL all say `sceneHint`). The acted engine is welded to "photorealistic live-action" or a 3D preschool cartoon
 * in a dozen places, and Kling's lip-sync on drawn mouths has never been rendered: an anime template is never offered
 * acted (SPEC-S15 → S15d, after one acted anime shot has been rendered and LOOKED at).
 *
 * NAMED DESCRIPTIVELY, NEVER BY THE IP THAT MADE A LOOK FAMOUS — never a studio, a director, a show, a film or a game,
 * in a look, a card, a name or a kick (the cartoon ad pipeline's own rule, cartoon-ad-pipeline.server.ts →
 * CARTOON_RECIPES: "named descriptively (never by the IP that popularized them)"). A picture model asked for a named
 * studio's look draws that studio's characters; asked for the look in plain words, it draws ours. The test holds a ban
 * list.
 *
 * NEVER COMBINED WITH THE "CAST SEX APPEAL" ASK (his, 2026-11-24, open). Anime models draw grown-ups young — big eyes,
 * small faces, slight builds — so an anime style is never offered with it: every anime picture says its grown-ups are
 * drawn with adult faces and adult proportions, and everyone modestly dressed (ANIME_TAIL), and that line is not to be
 * loosened for any feature.
 *
 * Dream and Retro are the two anime recipes the cartoon AD pipeline has drawn in production (app/lib/cartoon-styles.json
 * `dreamanime` / `retroanime` = cartoon-ad-pipeline.server.ts CARTOON_RECIPES, which that file keeps in sync) — here
 * with the ad's own words taken out ("film still", "OVA", "stylish confident character poses", "big warm eyes",
 * "cinematic"). This table is a THIRD copy of those two looks: tune one of them there, and weigh tuning it here.
 *
 * Pure: no imports. tests/anime-styles.test.ts. */

export type AnimeStyle = {
  /** the template key = the hero's id = its poster's media ("animedream") */
  key: string;
  /** the movie category it is TOLD as (a GENRE_FILMS key): its narrated brief, starters, notes, faces and world */
  kin: string;
  /** the word on its poster ("Dream") */
  card: string;
  /** what a finished one is called in the Archive ("Dream Anime Story") — always ends " Anime Story" */
  name: string;
  /** one plain promise; with " · narrated in minutes" after it, it still fits a phone's card (≤ 45 characters) */
  kick: string;
  /** a tint class the Movie Maker already draws (t-film, t-kids, t-horror, t-mv, t-kmv, t-moral) */
  tint: string;
  /** the style in a few words — said FIRST in every picture of the story (drawnLead); ≤ 60 characters */
  short: string;
  /** the LOOK: its line, its colour, its light and its places — said to the writer and to every picture */
  look: string;
  /** the score the track falls back to (the writer gives a musicMood of its own) */
  musicHint: string;
  /** the narrator's voice id; unset, the kin's (narrated-story.server.ts → DEFAULT_NARRATOR) */
  narrator?: string;
};

/* WHY EACH PIECE OF THE TAIL IS THERE — said after every look, so no style can forget one:
 *   · "2D hand-drawn animation — never a 3D render and never photographic": the picture model's own drift. Asked for
 *     "anime", it slides toward a glossy 3D toon or, with a real place in the words, a photograph with an anime face
 *     pasted in; and every other told story's rules talk in photographs (REAL_WORLD, the place sheet's "scale model
 *     photographed on a table").
 *   · "every character an original design, not any existing anime, manga or game character": the IP rule above, said
 *     to the picture too — an anime model's favourite faces are famous ones.
 *   · "every grown-up drawn with an adult face and adult proportions, and everyone modestly dressed": anime models draw
 *     grown-ups young, and the unclothed look (story-picture.ts → UNCLOTHED_ASKED) sees bare skin, not a revealing
 *     outfit — so the modesty is said in every picture, not only looked for.
 *   · "one single full frame of the film — never a manga page, panels, speech bubbles, sound effects or lettering":
 *     "anime" pulls in its printed cousin; a told story is one picture a scene (story-picture.ts → ONE_PICTURE).
 *   · "nothing readable anywhere": the app's rule for every picture (NOTHING_WRITTEN) — an anime city is all signs. */
export const ANIME_TAIL =
  "2D hand-drawn animation — never a 3D render and never photographic; every character an original design, not any existing anime, manga or game character; every grown-up drawn with an adult face and adult proportions, and everyone modestly dressed; one single full frame of the film — never a manga page, panels, speech bubbles, sound effects or lettering; nothing readable anywhere";

export const ANIME_STYLES: readonly AnimeStyle[] = [
  {
    key: "animedream",
    kin: "fantasy",
    card: "Dream",
    name: "Dream Anime Story",
    kick: "A gentle adventure",
    tint: "t-moral",
    // (the voice the Dream Anime ad recipe was narrated by in production — cartoon-styles.json → dreamanime)
    narrator: "English_SereneWoman",
    short: "dreamy hand-painted countryside anime",
    look: "a frame from a hand-painted 2D anime feature film: soft watercolour-washed skies with big painterly clouds, richly detailed hand-painted backgrounds of meadows, old towns and warm kitchens, gentle expressive characters with soft rounded features, delicate clean line art, soft cel shading, warm golden light, a calm nostalgic wonder",
    musicHint: "gentle orchestral strings, piano and a light wooden flute",
  },
  {
    key: "animeretro",
    kin: "thriller",
    card: "Retro",
    name: "Retro Anime Story",
    kick: "A retro thriller",
    tint: "t-film",
    // (the voice the Retro Anime ad recipe was narrated by in production — cartoon-styles.json → retroanime)
    narrator: "English_ConfidentWoman",
    short: "1990s hand-painted cel anime",
    look: "a frame from a 1990s hand-painted cel anime: crisp confident ink lines, hard-edged cel shadows with a single highlight tone, a saturated sunset palette of magenta, teal and amber, airbrushed painted skies, a soft analogue grain and glow",
    musicHint: "90s synth thriller score with analogue pads and a gated snare",
  },
  {
    key: "animeneon",
    kin: "scifi",
    card: "Neon City",
    name: "Neon City Anime Story",
    kick: "A neon-lit what-if",
    tint: "t-kmv",
    short: "neon-lit cyber-city anime",
    look: "a frame from a cyber-noir anime: a rain-slick city after dark, neon magenta and cyan light where every sign is only a shape of light, dense hand-drawn architecture and machinery, steam and haze, hard rim light on the people, sharp angular line art, deep shadows",
    musicHint: "a dark synth pulse, deep bass and glassy arpeggios",
  },
  {
    key: "animesky",
    kin: "romance",
    card: "Skyglow",
    name: "Skyglow Anime Story",
    kick: "Love after the rain",
    tint: "t-mv",
    short: "luminous modern anime with glowing skies",
    look: "a frame from a luminous modern anime film: carefully painted real-world places (train platforms, rooftops, rainy crossings, lit shop windows), a glowing gradient sky at dusk or just after rain, soft shafts of light, sparkling reflections on wet streets, characters in crisp thin line art with soft two-tone shading, rose, peach and blue-violet light",
    musicHint: "soft piano and strings with a light shimmer",
  },
  {
    key: "animeink",
    kin: "mystery",
    card: "Dark Ink",
    name: "Dark Ink Anime Story",
    kick: "A shadowy mystery",
    tint: "t-horror",
    short: "dark anime of ink-black shadows",
    look: "a frame from a dark, moody anime: deep ink-black shadows, a muted grey-blue palette with one deep-red accent, sharp faces in thin hard line art, heavy shadow shapes and fine hatching, lit by moonlight, one lamp or one candle, an unsettling stillness; eerie, never gory",
    musicHint: "a low cello drone, a music box and sparse piano",
  },
  {
    key: "animepastel",
    kin: "comedy",
    card: "Pastel Days",
    name: "Pastel Days Anime Story",
    kick: "An everyday comedy",
    tint: "t-kids",
    short: "soft pastel slice-of-life anime",
    look: "a frame from a soft slice-of-life anime: a bright pastel palette of mint, peach and sky blue, clean thin line art, simple flat shading with a soft bloom, bright expressive eyes, cosy everyday places (cafés, small apartments, bookshops, sunny streets), light and cheerful",
    musicHint: "bouncy ukulele, glockenspiel and light handclaps",
  },
];

/** The template keys of the anime styles, in the shelf's order. */
export const ANIME_KEYS: readonly string[] = ANIME_STYLES.map((s) => s.key);

const BY_KEY: Record<string, AnimeStyle> = Object.fromEntries(ANIME_STYLES.map((s) => [s.key, s]));
/** The anime style a template key is — undefined for every other template. */
export const animeStyleOf = (key: string | null | undefined): AnimeStyle | undefined => (key ? BY_KEY[key] : undefined);

/** A style's whole look, as its template's `sceneHint`: its own words, then the tail every anime picture is told. */
export const animeSceneHint = (s: AnimeStyle): string => `${s.look}; ${ANIME_TAIL}`;

/** WHAT EVERY PICTURE OF A DRAWN STORY IS TOLD FIRST (narrated-story.server.ts → `safe`): that it is DRAWN, in which
 *  style. First, because a told story's picture asks are full of photographs said by rules made for photographs — the
 *  place sheet's "like a scale model photographed on a table", REAL_WORLD in the writer's words, the creature portrait
 *  (story-picture.ts → portraitPrompt photographs an invented creature only when this lead is EMPTY) — and because the
 *  lenient fallback cuts its prompt at 500 characters, which a style said last does not survive. "" for any template
 *  that is not an anime style. */
export function drawnLead(key: string | null | undefined): string {
  const s = animeStyleOf(key);
  return s ? `EVERYTHING IN THIS PICTURE IS DRAWN, in one hand-drawn 2D anime style — ${s.short}: never a photograph and never a 3D render, whatever any word below says. ` : "";
}

/** WHAT THE WRITER OF A DRAWN STORY IS TOLD (film-engine.server.ts, after each REAL_WORLD — said whatever the story's
 *  world). REAL_WORLD ends "Every picture should look like a photograph of a real place": for a drawn story that means
 *  a real place's shapes and materials, said in words — and the VISUALs, which every picture is drawn from, never ask
 *  for a photograph themselves. */
export const DRAWN_WORLD =
  "THIS STORY IS DRAWN: every picture is one frame of a hand-drawn 2D anime film in this story's own style. Where a rule here says a picture should look like a photograph of a real place, it means a real place's shapes and materials, said in the VISUAL's words — the picture itself is drawn. A VISUAL never says photo, photograph, photorealistic, lens, live-action or 3D.";

/** How a drawn story is briefed when told: its kin's narrated brief, and that every picture of it is drawn. */
export const animeBrief = (kinNarrated: string, s: AnimeStyle): string =>
  `${kinNarrated} — every picture of it a frame of a hand-drawn anime film (${s.short})`;

/** A style's template: its KIN's, with the style's own key, name, look and score, and `drawn`. Everything else is the
 *  kin's and stays so — its brief, its faces, its world, its scene counts, and `dialogue` (the story builder opens
 *  only a dialogue format, and a told story is one: web.film.tsx → canTell, switchHero's openNarrated). Its name is
 *  the Archive's without " Story" ("Dream Anime"): what heroName falls back to. */
export function animeTemplate<T extends { key: string; name: string; sceneHint: string; musicHint: string; drawn?: boolean }>(base: T, s: AnimeStyle): T {
  return { ...base, key: s.key, name: s.name.replace(/ Story$/, ""), sceneHint: animeSceneHint(s), musicHint: s.musicHint, drawn: true };
}
