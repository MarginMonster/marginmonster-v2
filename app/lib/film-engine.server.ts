// The long-form FILM engine — EasyMode's premium "serious filmmaker" tier.
//
// A generalization of faceless-video.server.ts: instead of cheap Ken-Burns
// STILLS, each scene is a real AI i2v CLIP (the quality upgrade the owner asked
// for — "high budget, not cheap"). One engine, many TEMPLATES:
//   musicvideo — sung/instrumental track + beat-synced visual scenes   (Film tab)
//   kidstv     — bright preschool cartoon, recurring characters  (Film tab)
//   movie      — Dhar Mann-style NARRATED dramatic short + moral       (Film tab)
//   skit       — funny product skit, real product pin-sharp            (marketing flow)
//   youtube    — long-form narrative                                   (planned)
//
// Consistency is handled per template:
//   • recurring-character templates (kidstv, movie) → a one-time CAST reference
//     image every scene seed is conditioned on (renderStyledSeed) + a cast bible.
//   • product templates (skit) → the real PRODUCT photo takes the image-
//     conditioning slot so it stays pin-sharp, + a product-truth clause.
//   • narrated templates (movie) → a narrator VOICEOVER reads the per-scene
//     narration lines; the VO is the primary audio, music ducked under. (True
//     character DIALOGUE is the planned next upgrade — the scene-audio fork.)
//
// PRICING: the Film-tab templates are METERED by scene count (plan-config:
// estimateFilmTokens) — the SAME pure function quotes and charges. The marketing
// Skit is charged a FLAT TOKEN_COST.video (capped at 3 scenes) in its own route.
// Charged up front; the queue's refundPrepaidOnce returns it on terminal failure.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db.server";
import { anthropicText } from "./anthropic.server";
import { animateCreate, animatePoll, checkpointJob, download, downloadBuffer, ffprobeDuration, repCreate, repPoll, resolveTextFont, runFfmpeg } from "./ugc-ad-pipeline.server";
import { renderCreativeSeed, renderStyledSeed } from "./image-generation.server";
import { SCENE_PROMPT_MAX, SHEET_PROMPT_MAX, VISUAL_STANDS_ALONE, castSheetPrompt, sceneFromSheetPrompt, sceneInWordsPrompt } from "./film-cast-sheet";
import { musicBedToDisk, singToDisk } from "./music-generation.server";
import { CONTENT_LANGS, normalizeContentLang, voiceLangOpts } from "./content-lang";
import { mirrorRender } from "./object-storage.server";
import { trimTitle } from "./text-trim";
import { dropOrgEndorsementPossessive } from "./ad-claims";
import { MV_MAX_SECONDS, SHOT_NOTES, defaultRole, shotSlot, type SceneSeconds, type ShotRole } from "./mv-pace";
import { MAX_COSTARS, singerOf } from "./mv-cast";
import { FEATURE_MIN_SECONDS, defaultFeaturePlan, featureRoles } from "./mv-feature";
import { SHORT_ENGINE_WORDS, SING_RATE, fullSongLines, lyricAsk, lyricFit, lyricWords, pickLyric, sceneWordRange, sceneWordsFor, songEngineFor, songWordsFor, wordsAsLineCount, wordsAsLines } from "./mv-song";
import { SENSE_RULES, sameCar, sameTime } from "./mv-sense";
import { MOTION_GENTLE, MOTION_KEEPS_CAST, MOTION_NEGATIVE, fitFilter, fitScenesToSong, sceneSpans } from "./sung-fit";
import { lyricLinesOf, sceneLineTimes } from "./lyric-sync";
import { ORIGINAL_LYRICS_RULE } from "./lyrics-rules";
import { episodeTitle, seriesWriterBrief, type SeriesBrief } from "./film-series";
import { LINE_WORDS_MAX, fitAsk, linesTooLong, saidWords, takeRewrites } from "./dialogue-fit";
import { takeSeen, unseenAsk, unseenLines } from "./dialogue-cast";
// (2026-11-24) a told story's places: a scene set at one says so in its own words
import { WHAT_FRIGHTENS, inheritPlaces, keepGuess, placeNamed, placesAsk, takePlaces } from "./story-picture";
import { HORROR_SAFETY, IDEA_CHECK, IDEA_MAX, PREMISE_WINS, REAL_WORLD, STORY_SAFETY, chosenThreat } from "./premise-rules";
import { DRAMA_BRIEF, GENRE_FILMS, genreTemplate, nudgeFor, startLine } from "./film-genres";
// (2026-11-26) the anime maker: six drawn styles, each a told template of its own
import { ANIME_STYLES, DRAWN_WORLD, animeBrief, animeTemplate } from "./anime-styles";
import { tellerVisual } from "./character-series";
import { planShots, shotInWords, shotListBrief } from "./story-shots";
import { dealFresh, freshBrief, freshKeys, usedBefore, type Fresh, type Used } from "./story-variety";
// (2026-11-24) an acted film: every shot is something that HAPPENS, and the camera is dealt, not written
import { AGES_FIT_RELATION, AGE_RULES, CAMERA_IS_DEALT, DONE_STAYS_DONE, HEARD_BEFORE_SAID, LINE_IN_EVERY_SHOT, LINE_IN_EVERY_SHOT_BUT_THE_LAST, ONE_TAKE, SEEN_AT_THE_END, SEEN_WHEN_SEEN, TWO_ALWAYS, ageAsk, ageOf, castAgeProblem, eventIdeas, happensBrief, ownTitle, repairAges, storyThreat, takeAgeFix, titleAsk, wordless } from "./acted-staging";
// (2026-11-25) films up to five minutes: one limit for every story format, and a long script written in parts
import { clampShots, maxShots, minShots, partBrief, planBrief, planSchema, scriptParts, takePlan, type FilmPlan, type FilmWay } from "./film-length";

const RENDERS = () => path.join(process.cwd(), "data", "renders");
// i2v clips routinely run a few minutes on fal/Replicate; give each a generous
// ceiling so a slow-but-successful render is never thrown away (and re-billed).
const CLIP_POLL_MS = 8 * 60_000;
const CLIP_SECONDS = 5; // the default i2v clip length; total video ≈ scenes × this
// A trustworthy MiniMax narrator voice (same pool faceless uses).
const NARRATOR_VOICE = "English_Trustworth_Man";

// Product-fidelity clause (mirrors video-generation's productTruth) — woven into
// the seed + motion prompts for product templates so an i2v model can't melt a
// label or morph the product as the scene animates.
const PRODUCT_TRUTH =
  " The product must stay EXACTLY as in the reference photo — same shape, proportions," +
  " colours, materials, logos and every printed word and number, unchanged and legible." +
  " Never redraw, relabel, recolour or resize it; invent no on-product text of your own.";

// ---- Templates --------------------------------------------------------------
export interface FilmTemplate {
  key: string;
  name: string;
  /** How the treatment writer is briefed. */
  brief: string;
  /** Per-scene visual hint appended to the writer's instruction + the seed/motion prompts. */
  sceneHint: string;
  /** How the PEOPLE in a picture look, where the format has a say. A cast drawn from smiling portraits
   *  smiles: both horror films made on 2026-11-22 opened with someone grinning through a frightened
   *  line (the acted one) or pushing a mop through a haunted theatre beaming (the narrated one). */
  faceMood?: string;
  /** The genre's world is its own, not today's (Fantasy — film-genres.ts → GenreFilm.ownWorld): its writer is
   *  not told "IT IS TODAY'S REAL WORLD … no castle, no cottage" (premise-rules.ts → REAL_WORLD). */
  ownWorld?: boolean;
  /** THE TEMPLATE'S PICTURES ARE DRAWN — an anime style (anime-styles.ts → animeTemplate), never photographed: every
   *  picture of it is told so first (narrated-story.server.ts → `safe`), and its writer is told so after REAL_WORLD
   *  (DRAWN_WORLD). Told only: an acted film is welded to photographs or a 3D cartoon, and is never offered one. */
  drawn?: boolean;
  /** Music mood the track generator falls back to. */
  musicHint: string;
  defaultScenes: number;
  minScenes: number;
  /** The most scenes it has. EVERY ACTED FORMAT's is ACTED_MAX_SHOTS (below) — five minutes — and a format
   *  derived from one of them inherits it; the engines hold a film to it through filmShots(), whatever a
   *  template says here. A sung format keeps its own (a music video is two minutes of song). */
  maxScenes: number;
  /** Burn the per-scene caption line over its clip (lyrics / narration / hook). */
  captions: boolean;
  /** Recurring-character template: the treatment yields a CAST bible and… */
  castBible?: boolean;
  /** …each scene seed is conditioned on a one-time cast reference image. */
  referenceSeed?: boolean;
  /** Enforce wholesome, G-rated content in the treatment + seed/motion prompts. */
  childSafe?: boolean;
  /** Requires a real product (title + photo); scenes are conditioned on the
   *  product photo so it stays pin-sharp (product-fidelity compositing). */
  needsProduct?: boolean;
  /** Narrated template (Dhar Mann short film): a narrator voiceover reads the
   *  per-scene narration lines; VO is the primary audio, music ducked under. */
  narrated?: boolean;
  /** Musical template (music video, kids cartoon): generate a SUNG song from the
   *  scene lyric lines (reuses the Anthem singing engine) and use it as the audio. */
  sung?: boolean;
  /** Dialogue template (Test Movie): the script writes CHARACTER DIALOGUE and each
   *  scene is a Veo clip where the character SPEAKS it, chained last-frame to next.
   *  Routed to a SEPARATE engine (generateTestMovie) — generateFilm never sees it,
   *  so the main pipeline is untouched. */
  dialogue?: boolean;
  /** Render the dialogue pipeline in CARTOON style (kids cartoon) instead of
   *  photoreal — the two-shot master + clip prompts swap to 3D-animated. */
  cartoon?: boolean;
  /** The characters SING their lines (music video) instead of speaking them —
   *  the clip + voice prompts ask for lip-synced singing with a melody. */
  sing?: boolean;
  /** LIP-SYNC MUSIC VIDEO (adult Music Video): a FULL ~2-min genre song (one
   *  coherent minimax track), ONE consistent artist, and OmniHuman lip-syncs the
   *  artist to the song across several settings. Routed to generateMusicVideo —
   *  a dedicated engine; generateFilm never sees it. Picks a GENRE (see GENRES). */
  lipSyncSinger?: boolean;
  /** Whether this template is wired end-to-end on the FILM TAB (route offers
   *  these). Skit lives in the marketing flow instead, so it is false here. */
  live: boolean;
}

/** Music-video GENRES — each maps to the sung-song STYLE (fed to minimax) and a
 *  VISUAL VIBE (fed to the artist + scene seeds). The user picks one per video;
 *  the picker on the Film tab offers these. Keys are stable; labels are shown. */
// `perform` = HOW the artist carries themselves on camera, matched to the genre's EMOTION. Without
// it the motion prompt defaulted to "raps with high energy," which turned a warm country song into
// rap-aggression (snarling, repeated fist-pumps). Drives the hero, the seed expression and the i2v.
export const GENRES: Record<string, { label: string; song: string; look: string; perform: string }> = {
  rap:    { label: "Rap / Hip-Hop", song: "hard-hitting modern hip-hop / rap, punchy 808 bass, crisp trap hi-hats, rhythmic confident rapped vocals with attitude", look: "a PREMIUM, aspirational hip-hop music video — a stylish city rooftop at night, an upscale modern street, a sleek studio or a luxe interior; sharp designer streetwear; high-production and cinematic — NOT run-down, poor, gritty or a 'poverty' setting", perform: "raps to camera with confident, charismatic swagger — relaxed rhythmic head nods and easy natural hand gestures to the beat, cool and self-assured" },
  pop:    { label: "Pop / Dance / EDM", song: "catchy mainstream pop / dance-pop with an EDM drop, bright synths, four-on-the-floor beat, big sing-along chorus, polished radio vocals", look: "a PREMIUM pop music video — a sleek stage, a bright modern studio, a chic rooftop or a stylish interior; fashionable wardrobe; polished, high-production and cinematic", perform: "sings to camera with bright, upbeat, joyful charisma — lively and fun, warm and smiling, light rhythmic movement" },
  rock:   { label: "Rock / Punk / Alt", song: "driving alt-rock / punk, distorted electric guitars, live drums, raw energetic vocals with attitude", look: "a PREMIUM rock music video — a real concert stage, a cool industrial loft or a moody studio; stylish; cinematic and high-production, edgy but never cheap or run-down", perform: "performs to camera with raw, passionate intensity — powerful and into the music but controlled and natural, not forced" },
  rnb:    { label: "R&B / Soul / Afrobeats", song: "smooth soulful R&B with an Afrobeats groove, warm bass, laid-back percussion, silky emotive vocals and harmonies", look: "a PREMIUM R&B music video — a luxe interior, a rooftop at golden hour, a stylish lounge; elegant fashion; a warm, cinematic, high-production look", perform: "sings to camera with smooth, soulful, intimate emotion — relaxed, expressive and heartfelt, gentle swaying movement" },
  country:{ label: "Country", song: "heartfelt modern country, acoustic and slide guitar, warm storytelling vocals, catchy singalong chorus", look: "a PREMIUM country music video — a scenic ranch, open golden-hour fields or a stylish rustic-modern setting; cinematic, aspirational and high-production", perform: "sings to camera with warm, earnest, heartfelt sincerity — relaxed and genuine, a warm friendly expression and gentle natural movement; NOT aggressive, angry, snarling or hyped-up" },
};
export const GENRE_KEYS = Object.keys(GENRES);
export function genreOrDefault(k: string | undefined): string { return (k && GENRES[k]) ? k : "rap"; }

/** Music-video PROPS — "cool shit" the user can drop into their video. Each key maps to a label
 *  (shown in the picker) + a phrase woven into a scene's prompt. Props are DISTRIBUTED across the
 *  scenes (one per scene, round-robin) so they feel intentional, not crammed into every shot. */
export const PROPS: Record<string, { label: string; phrase: string }> = {
  tiger:     { label: "🐯 Tiger", phrase: "a real tiger right beside the artist" },
  lion:      { label: "🦁 Lion", phrase: "a majestic lion in the scene with the artist" },
  horse:     { label: "🐴 Horse", phrase: "a powerful horse the artist stands with" },
  car:       { label: "🏎️ Luxury car", phrase: "a luxury supercar (Lamborghini / Rolls-Royce) the artist poses on" },
  moto:      { label: "🏍️ Motorcycle", phrase: "a sleek motorcycle the artist is on" },
  chains:    { label: "💎 Diamond chains", phrase: "heavy iced-out diamond chains and jewelry on the artist" },
  cash:      { label: "💵 Stacks of cash", phrase: "thick stacks of cash in the artist's hands" },
  champagne: { label: "🥂 Champagne", phrase: "champagne bottles being popped" },
  jet:       { label: "✈️ Private jet", phrase: "a private jet behind the artist" },
  katana:    { label: "🗡️ Katana", phrase: "a gleaming katana sword the artist holds" },
  snake:     { label: "🐍 Snake", phrase: "a large snake draped around the artist" },
  yacht:     { label: "🛥️ Yacht", phrase: "a luxury yacht the artist stands on" },
  fire:      { label: "🔥 Fire", phrase: "dramatic flames framing the artist" },
};
export const PROP_KEYS = Object.keys(PROPS);

/** HOW LONG AN ACTED FILM MAY BE, in shots: five minutes of them (film-length.ts) — for every acted format alike.
 *  It was `maxScenes: 6` written into each template (thirty seconds); the owner, 2026-11-25: "a sexy slider
 *  allowing up to 5 minutes". One constant, so a genre added tomorrow is as long as the rest. */
export const ACTED_MAX_SHOTS = maxShots("acted");

export const FILM_TEMPLATES: Record<string, FilmTemplate> = {
  musicvideo: {
    key: "musicvideo",
    name: "Music Video",
    brief: "a full ~2-minute MUSIC VIDEO — ONE artist actually sings a real genre song on camera (lip-synced) across several vivid settings, like a real DaBaby / Oliver Tree video",
    sceneHint: "a vivid, cinematic, stylized music-video scene full of energy and mood, featuring the SAME artist performing to camera — dynamic lighting, strong composition; NO on-screen text, logos or real named people",
    musicHint: "a catchy full-length genre song with clear sung/rapped vocals, real music-video energy",
    // EXACT LENGTH, PICKED IN SECONDS (10s→2:00). Each scene is one generated clip of 10 seconds (a slow
    // video) or 5 (a medium or fast one — see SCENE_SECONDS in mv-pace.ts), so N = seconds ÷ scene length:
    // min 1 (a 10s single-shot video is valid), max 24 (two minutes of five-second scenes). The song is fit
    // to EXACTLY that many seconds, so the finished video lands on the picked length.
    defaultScenes: 3,
    minScenes: 1,
    maxScenes: 24,
    captions: false, // a performance music video, not a lyric/karaoke video
    castBible: true,
    referenceSeed: true,
    sung: true,
    lipSyncSinger: true,
    live: true,
  },
  kidstv: {
    key: "kidstv",
    name: "Kids Cartoon",
    brief: "a bright, wholesome kids cartoon where a small cast of cute characters TALK their way through a simple, happy little story a toddler would love — tell EXACTLY the story the user describes, kept gentle, clear and G-rated",
    sceneHint: "bright glossy 3D-animated cartoon, rounded friendly character designs, big expressive eyes, soft candy colors, simple cheerful backgrounds, wholesome and child-safe (G-rated), like a modern preschool cartoon",
    musicHint: "cheerful bouncy nursery-rhyme sing-along, upbeat and sweet",
    defaultScenes: 4,
    minScenes: 2,
    maxScenes: ACTED_MAX_SHOTS,
    captions: true,
    castBible: true,
    referenceSeed: true,
    childSafe: true,
    dialogue: true,
    cartoon: true,
    live: true,
  },
  kidsmusicvideo: {
    key: "kidsmusicvideo",
    name: "Kids Music Video",
    brief: "a preschool nursery-rhyme SING-ALONG — cute ORIGINAL cartoon characters (never a character from an existing show) sing one simple, catchy, wholesome song with a hook a toddler can sing along to",
    sceneHint: "bright glossy 3D-animated cartoon, rounded friendly character designs, big expressive eyes, soft candy colors, simple cheerful backgrounds, wholesome child-safe (G-rated), like a modern preschool sing-along cartoon",
    musicHint: "cheerful bouncy nursery-rhyme sing-along, upbeat sweet and simple, clear child-friendly vocals with a catchy repeating hook",
    defaultScenes: 4,
    minScenes: 2,
    maxScenes: 8,
    captions: true,
    castBible: true,
    referenceSeed: true,
    childSafe: true,
    sung: true,
    cartoon: true,
    live: true,
  },
  moral: {
    key: "moral",
    name: "Moral Story",
    brief: "a short SCRIPTED MORAL STORY (Dhar Mann style): a relatable everyday situation where a small recurring cast TALK IT OUT in their own spoken dialogue, building to a clear, uplifting life-lesson payoff",
    sceneHint: "a cinematic, emotionally-expressive dramatic scene, photoreal, real-world setting, natural lighting",
    musicHint: "warm, heartfelt, uplifting cinematic score",
    defaultScenes: 4,
    minScenes: 2,
    maxScenes: ACTED_MAX_SHOTS,
    captions: true,
    castBible: true,
    referenceSeed: true,
    dialogue: true,
    live: true,
  },
  horror: {
    key: "horror",
    name: "Horror Story",
    brief: "a short SUSPENSEFUL HORROR STORY: a creepy, atmospheric scene where a small cast speak their own tense dialogue, building dread to a chilling twist; unsettling and spooky, NOT gory or graphically violent",
    sceneHint: "a dark, moody, cinematic horror scene, photorealistic like a frame from a live-action horror film — deep shadows that hide more than they show, shot on 35mm at night, underexposed, film grain, eerie atmosphere, cold desaturated color grade, practical effects (never CGI, never an illustration), suspenseful; unsettling but not graphically gory",
    musicHint: "tense, eerie, suspenseful horror score — low drones, uneasy strings",
    faceMood: "Every living person in it looks tense, wary or afraid — nobody smiles, grins or laughs.",
    defaultScenes: 4,
    minScenes: 2,
    maxScenes: ACTED_MAX_SHOTS,
    captions: true,
    castBible: true,
    referenceSeed: true,
    dialogue: true,
    live: true,
  },
  shortfilm: {
    key: "shortfilm",
    name: "Short Film",
    brief: "a short cinematic SCRIPTED STORY on the given theme, with a small recurring cast, a clear beginning-middle-end and a satisfying ending — told by a narrator",
    sceneHint: "a cinematic, filmic dramatic scene, photoreal, strong composition and lighting",
    musicHint: "a cinematic score matched to the story's mood",
    defaultScenes: 8,
    minScenes: 5,
    maxScenes: 24,
    captions: true,
    castBible: true,
    referenceSeed: true,
    narrated: true,
    live: false, // removed from the picker (owner 11-09) — engine def kept for old assets
  },
  // THE SHORT FILM IS DRAMA (film-genres.ts). The owner, 2026-11-25: "Our genres need to be movie categories
  // (drama, horror, comedy, etch)". Its key is what it was — every saved draft, link and finished film holds
  // "testmovie" — and its brief, which was a line of our own praise ("a cinematic SHORT FILM where your cast
  // actually SPEAKS real dialogue … The flagship movie maker."), now says what HAPPENS in a drama.
  testmovie: {
    key: "testmovie",
    name: "Drama Film",
    brief: DRAMA_BRIEF,
    sceneHint: "a cinematic, photorealistic live-action film scene — natural lighting, filmic composition, real-looking people; a clean, uncluttered set with NO readable text, documents, papers, bulletin boards, signage, posters or screens visible",
    musicHint: "subtle cinematic underscore",
    defaultScenes: 2,
    minScenes: 1,
    maxScenes: ACTED_MAX_SHOTS,
    captions: true,
    castBible: true,
    dialogue: true,
    live: true,
  },
  avatardialogue: {
    key: "avatardialogue",
    name: "Dialogue · Actors",
    brief: "the SAME dialogue scene, built a DIFFERENT way: each character is a locked 'actor' (one fixed face + one fixed voice) lip-synced line by line and intercut shot/reverse-shot — rock-solid face + voice consistency, no morphing",
    sceneHint: "a photorealistic cinematic close-up talking-head portrait — natural film lighting, a real-looking person; clean, no text",
    musicHint: "subtle cinematic underscore",
    defaultScenes: 2,
    minScenes: 1,
    maxScenes: 8,
    captions: false,
    castBible: true,
    dialogue: true,
    live: false, // Dialogue·Actors removed from the picker (owner 11-09) — dead-end experiment
  },
  skit: {
    key: "skit",
    name: "Skit",
    brief: "a FUNNY short commercial skit: a tiny cast acts out a comedic bit where the product is the hero of the joke — a quick setup, then a punchline payoff",
    sceneHint: "a funny, characterful cinematic scene that features the product, expressive comedic acting, clear bright lighting, photoreal",
    musicHint: "playful, bouncy, comedic background music",
    defaultScenes: 3,
    minScenes: 1,
    maxScenes: 3,
    captions: true,
    castBible: true,
    needsProduct: true,
    // Removed from the Film picker (owner 11-09). Engine + product path stay ready for a
    // future marketing re-home (its own /web/skit entry); just off the Movie Maker grid.
    live: false,
  },
  // Planned — the engine drives it generically; out of the picker until wired.
  youtube: { key: "youtube", name: "YouTube Video", brief: "a long-form narrative YouTube video with a hook, body and payoff", sceneHint: "a clear, engaging cinematic scene", musicHint: "upbeat background music", defaultScenes: 10, minScenes: 6, maxScenes: 40, captions: true, live: false },
};
// THE NEW MOVIE CATEGORIES (film-genres.ts → GENRE_FILMS): Comedy, Thriller, Action, Romance, Sci-Fi, Fantasy,
// Mystery. Each is the Short Film's template with its own key, name, briefing, look, score and faces — so
// every pipeline that takes a template key (the acted engine, the narrator, the storyboard, the Archive)
// makes it with no code of its own, and its lengths are the Short Film's by construction (genreTemplate).
for (const g of GENRE_FILMS) FILM_TEMPLATES[g.key] = genreTemplate(FILM_TEMPLATES.testmovie, g);
// THE ANIME STYLES (anime-styles.ts; the owner, 2026-11-26: "also would like to add an Anime maker with different
// styles"): each is its KIN's template — a movie category above, so it exists by now — with the style's own key, name,
// drawn look and score, and `drawn`. Told only: its faces, world, brief and lengths are the kin's.
for (const s of ANIME_STYLES) FILM_TEMPLATES[s.key] = animeTemplate(FILM_TEMPLATES[s.kin], s);

export function filmTemplate(key: string | undefined): FilmTemplate {
  return (key && FILM_TEMPLATES[key]) || FILM_TEMPLATES.musicvideo;
}
/** The templates the FILM TAB offers today (end-to-end wired, not marketing-only). */
export const LIVE_FILM_TEMPLATES = Object.values(FILM_TEMPLATES).filter((t) => t.live);

// ---- Treatment (the free, pre-paid script preview) --------------------------
export interface FilmScene {
  visual: string;
  caption?: string;
  /** Test Movie location/angle model: `where` = the location this beat happens in (a
   *  change starts a new scene = new master shot + a deliberate cut, cast carried); `shot`
   *  = the camera angle within that location (a change re-frames the master = a cinematic
   *  cut that holds the room + faces). Absent on both → one continuous location (the
   *  validated seamless behaviour). `tone` = HOW the line is delivered (the emotion), fed
   *  to the render so the voice isn't flat/monotone (e.g. "coldly, with quiet menace").
   *  (2026-11-24: an acted film's WRITER no longer sets `shot` — how each location is framed is dealt by
   *  acted-staging.ts; a `shot` here is an angle the maker added by hand in the storyboard.) */
  where?: string;
  shot?: string;
  tone?: string;
  /** A TOLD story's SHOT PLAN (story-shots.ts): how this scene is SEEN — "wide", "walk", "depth", "over",
   *  "close", "low", "two" or "detail". Dealt before the story is written; the picture and its motion follow
   *  it. Absent on every story written before 2026-11-24, and on a scene the maker added by hand. */
  cam?: string;
  /** Music Video pre-editor override: "perform" = the artist sings (lip-synced); "broll" = a cut
   *  scene (props/dancing/scenery, no lip-sync). Absent → the pipeline's SHOTLIST cadence decides. */
  kind?: "perform" | "broll";
  /** Music Video FEATURED VERSE: the NAME of the co-star who sings this scene's lines, in their own
   *  voice (mv-feature.ts). Absent → the artist sings it, as in every video before 2026-11-21. */
  singer?: string;
}
export interface FilmTreatment {
  title?: string; scenes: FilmScene[]; musicMood: string; cast?: string[];
  /** THE STARTER this story was written from, when the maker's own idea was under three words (film-genres.ts
   *  → nudgeFor): one of the genre's starter ideas, word for word — the page shows it, so "we wrote you a
   *  random scene" becomes "we started from THIS; change it". Absent when the maker's idea was used. */
  nudge?: string;
  /** A NARRATED story's places (story-picture.ts → "the story's places"): the one or two places or things it
   *  keeps coming back to, each as "name: look" — every scene whose words name one is drawn from that
   *  place's own design sheet, so it is the same place each time. */
  places?: string[];
  /** FRESH EVERY TIME (story-variety.ts): what this story was dealt — the kind of opening and, where its
   *  idea left it open, its angle. Kept so the maker's NEXT story is dealt something else. */
  fresh?: { hook?: string; kind?: string; ending?: string; theme?: string; world?: string; place?: string };
  /** A music video's lyric, counted against what its video needs — set when the sheet had to be rewritten
   *  to fit (film-engine previewFilmTreatment): how many words it has now, how many are wanted, how many
   *  it was written with, the rounds of rewriting, whether it fits, and what went wrong if anything did. */
  lyricFit?: { words: number; want: number; was: number; rounds: number; fits: boolean; note?: string };
  /** An acted film's lines, counted against the shot each is spoken in — set when a line was too long
   *  (dialogue-fit.ts): the spoken words of each long line as written, what each came to, and what went
   *  wrong if anything did. */
  lineFit?: { was: number[]; now: number[]; note?: string };
  /** An ACTED film's lines by somebody who is not on screen (dialogue-cast.ts): how many there were, how
   *  many were rewritten for one of the two who are, and what went wrong if anything did. */
  castFit?: { unseen: number; fixed: number; note?: string };
  /** A cast of two whose stated ages broke what they are to each other (acted-staging.ts → castAgeProblem):
   *  the relation, the ages as written, as they are now, and whether the writer rewrote them or they were put
   *  right here. */
  ageFit?: { relation: string; was: string[]; now: string[]; how: "rewritten" | "repaired" };
  /** AN ACTED FILM WHOSE SHOTS HAPPEN (acted-staging.ts): every scene's VISUAL is the ONE thing that is done
   *  in that shot while its line is spoken — names and an action, no looks, no camera — so each clip is told
   *  it. Absent on every script written before 2026-11-24 (their VISUALs describe a still two-shot, and are
   *  not said to the video engine). */
  events?: boolean;
  /** A LONG FILM'S PLAN (film-length.ts → A LONG SCRIPT IS WRITTEN IN PARTS): what each part it was written in
   *  is — and, for an acted film, the one place that scene is set in — with how many of the script's scenes are
   *  that part's. Absent on a film short enough to be written in one answer. */
  acts?: Array<{ what: string; where?: string; scenes: number }>;
}

const TREATMENT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    musicMood: { type: "string" },
    cast: { type: "array", items: { type: "string" } },
    places: { type: "array", items: { type: "string" } },
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: { visual: { type: "string" }, caption: { type: "string" }, where: { type: "string" }, place: { type: "string" }, shot: { type: "string" }, tone: { type: "string" }, singer: { type: "string" } },
        required: ["visual"],
      },
    },
  },
  // THE TITLE IS ASKED FOR, NOT HOPED FOR. It was optional, and a writer that left it out had its story
  // named after the maker's idea, cut where eighty characters ran out: "Moral Story — A boastful young
  // rooster named Bram wants the whole…" (a story made on the live site, 2026-11-23; the one before it,
  // from the same button, was "Pip and the Last Apples of Autumn").
  required: ["scenes", "musicMood", "title"],
} as const;
/* A TOLD STORY MUST SAY ITS PLACES (an empty list when it has none). Left optional, the writer skipped it
 * for a story that goes back to "the well" in five of its six pictures (a Moral Story made on the live site,
 * 2026-11-24) — and the well was a ring of rubble, then a well with a pulley, then a square one under
 * trees. The two stories before it had listed theirs. Asked for outright, it is always answered. */
const NARRATED_SCHEMA = { ...TREATMENT_SCHEMA, required: [...TREATMENT_SCHEMA.required, "places"] } as const;

/* NARRATED stories — one storyteller, illustrated scenes. Each scene is 2-3 spoken sentences (about ten
 * seconds), so the length is the scene count: 4 ≈ 45 s, 6 ≈ a minute, 12 ≈ 2 minutes — and, since 2026-11-25,
 * up to five minutes: 32 (film-length.ts, where the page's numbers and these limits are the same numbers; it
 * was twelve). */
export const NARRATED_MIN_SCENES = minShots("narrated");
export const NARRATED_MAX_SCENES = maxShots("narrated");
export const NARRATED_DEFAULT_SCENES = 6;
export const clampNarrated = (n: number): number => clampShots("narrated", n, { fallback: NARRATED_DEFAULT_SCENES });
/** What the writer is asked for when a story format is NARRATED rather than acted. */
const NARRATED_BRIEF: Record<string, string> = {
  horror: "a short NARRATED HORROR STORY — the kind a scary-story channel tells: one creepy, atmospheric tale in a storyteller's voice, dread building line by line to a chilling twist",
  moral: "a short NARRATED MORAL STORY: a relatable everyday situation told by a storyteller, building to a clear, uplifting life lesson",
  kidstv: "a gentle NARRATED STORY for little ones — a storybook read aloud: a small cast of cute characters, one simple happy adventure, warm and G-rated, with a cosy ending",
  // (told, the Short Film is a Drama Story — film-genres.ts. It read "a short NARRATED STORY on the given theme
  //  — a storyteller's voice, a clear beginning, middle and end, and an ending that lands": any story at all.)
  testmovie: "a short NARRATED DRAMA — a storyteller's voice tells of people who matter to each other: somebody wants something, something real is in the way, and it ends on what they choose and what it costs them; a clear beginning, middle and end, and no speeches",
  // …and every new movie category can be told too, each to its own brief (film-genres.ts → GENRE_FILMS)
  ...Object.fromEntries(GENRE_FILMS.map((g) => [g.key, g.narrated])),
};
// …and every anime style is told as its kin is told, with every picture of it a drawn frame (anime-styles.ts)
for (const s of ANIME_STYLES) NARRATED_BRIEF[s.key] = animeBrief(NARRATED_BRIEF[s.kin], s);
/** The templates that can be told by a narrator (for the page that offers the choice). */
export const NARRATABLE_KEYS: string[] = Object.keys(NARRATED_BRIEF);
/* (HOW a format is told is no longer a default plus a switch: it is the HERO that was picked — one format
 *  told one way, each with its own poster. See film-heroes.ts; the owner, 2026-11-22: "we don't use a toggle
 *  but create a new hero". Made side by side that day, a narrated horror story was 83 s of six pictures
 *  with captions, ready in about two minutes for a few cents; the acted one was 28 s of a single two-shot,
 *  eleven minutes and about $3 of video model.) */
/** Which templates can be told by a narrator instead of acted. */
export const canNarrate = (key: string | undefined): boolean => !!key && Object.prototype.hasOwnProperty.call(NARRATED_BRIEF, key);

function clampScenes(t: FilmTemplate, n: number): number {
  // AN ACTED FORMAT (film-length.ts): the one ceiling every one of them has — five minutes — with the format's own
  // floor (a horror film is a line and then the scare: two) and its own usual length when none was asked for
  if (t.dialogue && !t.lipSyncSinger && !t.sung) return clampShots("acted", n, { min: t.minScenes, fallback: t.defaultScenes });
  return Math.max(t.minScenes, Math.min(t.maxScenes, Math.round(n || t.defaultScenes)));
}

/** A CHECKPOINT AN ENGINE WROTE FOR ITSELF, read back from the job's own row. The worker hands a restarted job
 *  the checkpoints it knows by name (job-queue.server.ts → the `resume` it builds for each engine); what a long
 *  film also needs to be picked up whole — how its finished shots were cut together, which of its pictures were
 *  already drawn — is written with them and read here, so that neither engine waits on that list to be
 *  lengthened. Undefined when there is no job, no such checkpoint, or the row cannot be read (the film then
 *  carries on as one did before there was any). */
export async function ownCheckpoint(jobId: string | undefined, key: string): Promise<string | undefined> {
  if (!jobId) return undefined;
  try {
    const job = await db.job.findUnique({ where: { id: jobId }, select: { payload: true } });
    const v = (JSON.parse(job?.payload || "{}") as Record<string, unknown>)[key];
    return typeof v === "string" && v ? v : undefined;
  } catch { return undefined; }
}

/** THE ONE LIMIT, FOR WHOEVER ASKS (the page's action, both engines): how many shots — or, told by a narrator,
 *  scenes — a film of this format has, from whatever number was asked for. A told story: three to five minutes'
 *  worth (clampNarrated). An acted film: its format's floor to five minutes' worth. A sung format: its template's
 *  own limits, as before (a music video's length in seconds is the caller's to hold as well). */
export function filmShots(template: string | undefined, narrated: boolean, n: unknown): number {
  const t = filmTemplate(template);
  return narrated && canNarrate(t.key) ? clampNarrated(Number(n)) : clampScenes(t, Number(n));
}

/** ALL-CAPS, filter-safe caption text (mirrors faceless captionSafe). */
function captionSafe(s: string): string {
  return (s || "").toUpperCase().replace(/[']/g, "’").replace(/[^\p{L}\p{N} .,!?$%’-]/gu, "").replace(/\s+/g, " ").trim();
}

/** Write (or re-write, on Randomize) the treatment as free Anthropic TEXT — no
 *  token spend, our account. Returns scenes + a music mood (+ a recurring cast
 *  for character-locked templates). The caller shows it for approval/edit; the
 *  approved object rides into generateFilm.resume. */
export async function previewFilmTreatment(opts: {
  shopId: string;
  template?: string;
  topic?: string;
  sceneCount?: number;
  contentLang?: string | null;
  productTitle?: string;
  productDescription?: string;
  /** Music Video genre (rap/pop/rock/rnb/country) — flavours the song + visuals. */
  genre?: string;
  /** The picked avatar's name — the singer uses THIS name instead of an invented one. */
  artistName?: string;
  /** Named co-stars (extra cast) — the writer uses THESE names, not invented ones. */
  castNames?: string[];
  /** The lead's gender + each known co-star's — so the writer never casts a man in a woman's role/dress. */
  artistGender?: "m" | "f";
  castGenders?: Array<{ name: string; gender: "m" | "f" }>;
  /** NARRATED: a storyteller tells the story over illustrated scenes — nobody speaks on camera —
   *  whatever the template's own way of telling it. (The cheap, quick, popular kind of story video.) */
  mode?: "narrated";
  /** The cast the maker PICKED for a story format, before a word was written: each one's name and what
   *  they are. The writer writes FOR them instead of inventing a cast of its own. */
  cast?: Array<{ name: string; desc?: string; /** what it is, when it is not a person */ kind?: string }>;
  /** Music Video: how long each scene is — 10 seconds (the default) or 5. The video runs
   *  sceneCount × this many seconds, and the song is written for THAT length. */
  sceneSeconds?: SceneSeconds;
  /** Music Video FEATURED VERSE: the names of the co-stars (from castNames) who sing a verse of their
   *  own. The writer gives each one a verse and marks its scenes with "singer". */
  featureNames?: string[];
  /** NEXT EPISODE (film-series.ts): this story continues a series — the writer is told the series, the
   *  episode number and a quoted recap of the last episode. Story formats only; ignored for sung ones. */
  series?: SeriesBrief | null;
  /** A CHARACTER'S SHOW (character-series.ts): the line the storyteller ends every episode on. */
  signoff?: string;
  /** …and WHO TELLS IT: the name of the one of the chosen cast whose own voice narrates. The story is then
   *  theirs, told as "I" — a told story only, and only for somebody who is in `cast`. */
  teller?: string;
  /** A JOB THAT IS WRITING SAYS SO (2026-11-25, films up to five minutes): called when a long film's plan, and each
   *  of its parts, comes back. A five-minute script written inside a job is ten answers or more one after another
   *  — each up to two minutes, and asked again down the rungs — and the worker took a job nobody had touched for 25
   *  minutes to be dead (job-queue.server.ts → reclaimOrphanJobs; five since 2026-11-25, when the worker began to
   *  beat every job it runs itself — job-beat.ts — this is a second voice). Never called for a film written in one answer. */
  beat?: () => unknown;
}): Promise<FilmTreatment> {
  const tmpl = filmTemplate(opts.template);
  const narrated = opts.mode === "narrated" && !tmpl.lipSyncSinger && !tmpl.sung;
  const signoff = narrated ? String(opts.signoff || "").replace(/["“”]/g, "'").replace(/\s+/g, " ").trim().slice(0, 120) : "";
  // (a music video or a sing-along is never an episode)
  const series = !tmpl.lipSyncSinger && !tmpl.sung && opts.series ? opts.series : null;
  // a music video is never longer than two minutes, however short its scenes
  const sceneSec: SceneSeconds = tmpl.lipSyncSinger && opts.sceneSeconds === 5 ? 5 : 10;
  const scenes = narrated ? clampNarrated(opts.sceneCount ?? NARRATED_DEFAULT_SCENES)
    : tmpl.lipSyncSinger ? Math.min(clampScenes(tmpl, opts.sceneCount ?? tmpl.defaultScenes), Math.floor(MV_MAX_SECONDS / sceneSec))
    : clampScenes(tmpl, opts.sceneCount ?? tmpl.defaultScenes);
  /** how long the finished music video runs */
  const videoSecs = scenes * sceneSec;
  // who the maker cast (story formats only — a music video names its artist its own way)
  const picked = tmpl.lipSyncSinger ? [] : (opts.cast || [])
    .map((c) => ({ name: (c?.name || "").trim().slice(0, 40), desc: (c?.desc || "").trim().replace(/\s+/g, " ").slice(0, 220), kind: c?.kind === "monster" || c?.kind === "cartoon" ? c.kind : undefined }))
    .filter((c) => c.name).slice(0, 4);
  // THE TELLER (a character's show): one of the chosen cast, by their own name as it is in `picked`
  const tellerWanted = narrated ? String(opts.teller || "").replace(/\s+/g, " ").trim().toLowerCase() : "";
  const teller = tellerWanted ? picked.find((c) => c.name.toLowerCase() === tellerWanted)?.name || "" : "";
  // THE WRITER IS NEVER HANDED NOTHING (film-genres.ts → nudgeFor). The owner, 2026-11-25: "the "write your
  // dialogue" button generates a random scene and dialogue, atleast need a starter "nudge" couple sentences to
  // hand to the writer". With the idea box empty the writer was told only "Pick a fun, broadly-appealing theme"
  // — and picked its usual one. Now an idea of fewer than three words becomes one of the genre's own starters
  // (a word or two the maker did type picks the starter, or rides along to be worked in; a cast the maker chose
  // is the starter's people — startLine, said right after the theme), and the starter that
  // was dealt goes back on the treatment (`nudge`) so the page can show what the story was written from. Story
  // genres only — a music video names its own theme — and never an episode: a series decides what happens next
  // from its own recap. Every caller that has no approved script comes through here (the page's preview, a
  // one-press acted film, a one-press told story), so this is the one place.
  const typedIdea = (opts.topic || "").trim();
  const nudged = series ? null : nudgeFor(tmpl.key, typedIdea, Math.floor(Math.random() * 0x7fffffff));
  const topic = nudged ? nudged.topic : typedIdea;
  if (nudged) console.log(`[film] ${typedIdea ? `the idea was only "${typedIdea.slice(0, 40)}"` : "no idea was given"} — a ${tmpl.key} starter was dealt: "${nudged.nudge.slice(0, 80)}…"`);
  // Lip-sync Music Video: the chosen genre drives the song style, the artist and
  // every setting; folded into the writer prompt so lyrics + visuals match it.
  const genreKey = tmpl.lipSyncSinger ? genreOrDefault(opts.genre) : "";
  const g = genreKey ? GENRES[genreKey] : null;
  const genreLabel = g ? g.label : "pop";
  const genreLine = g ? `\nGENRE: ${g.label}. The song must sound like authentic ${g.label} — ${g.song}. The artist and EVERY setting must look like a real ${g.label} music video — ${g.look}.` : "";
  // THE LANGUAGE THE WORDS ARE IN: the one asked for (a story told again names its own), else the shop's.
  // Until 2026-11-23 a caller that passed none meant English — three fallbacks did — and the line said
  // only "Write all captions in this language code: es": the title stayed English. What is HEARD and
  // SHOWN follows the language: every caption, lyric and the title. A "visual" stays in English — it is
  // an instruction for the picture, never shown.
  let shopLang: string | null | undefined = opts.contentLang;
  if (shopLang === undefined || shopLang === null || shopLang === "") {
    try { shopLang = (await db.shop.findUnique({ where: { id: opts.shopId }, select: { contentLang: true } }))?.contentLang; } catch { shopLang = null; }
  }
  const langCode = normalizeContentLang(shopLang);
  const langName = CONTENT_LANGS[langCode] || "English";
  const langLine = langCode === "en" ? "" : `\nLANGUAGE: write every caption — the words that are spoken, narrated or sung — and the title in ${langName}. Keep every name exactly as given. Each "visual" and the musicMood stay in English: they are instructions for the picture and the music, never shown or said.`;
  /** the same, for an ask that is about the words alone (a re-fit of the lyrics) */
  const langWordsLine = langCode === "en" ? "" : ` The words stay in ${langName}.`;
  // FRESH EVERY TIME (story-variety.ts) — a STORY format is dealt its names, its kind of opening and, where
  // the idea leaves it open, its angle; never what this maker's last stories were dealt. (The owner,
  // 2026-11-24: "some of the stories or character generic names seem to be similar or repetetive".)
  // …and A TOLD STORY IS DEALT ITS SHOT PLAN (story-shots.ts): how each scene is SEEN.
  const storyFormat = !!tmpl.dialogue && !tmpl.lipSyncSinger && !tmpl.sung;
  // A LONG SCRIPT IS WRITTEN IN PARTS (film-length.ts): one answer up to six acted shots or twelve told scenes —
  // a whole film until 2026-11-25 — and a longer one PLANNED first, then written a part at a time, each by the
  // brief below. `partSizes` has one entry for a film short enough to be written as it always was.
  const way: FilmWay = narrated ? "narrated" : "acted";
  const partSizes = storyFormat ? scriptParts(way, scenes) : [scenes];
  const inParts = partSizes.length > 1;
  let usedByMaker: Used = { names: [], openers: [], keys: [] };
  if (storyFormat) {
    try {
      usedByMaker = usedBefore(await db.asset.findMany({ where: { shopId: opts.shopId, type: "VIDEO_AD" }, orderBy: { createdAt: "desc" }, take: 14, select: { bodyJson: true } }));
    } catch { /* a story is written without the list */ }
  }
  // (names that must stay usable: the cast the maker chose, and a series' own people)
  const keptNames = [...picked.map((c) => c.name), ...(series?.characters || []).map((c) => String(c).split(/[,:—–(]/)[0].trim()).filter(Boolean)];
  const fresh: Fresh | null = storyFormat ? dealFresh(tmpl.key, Math.random, { ...usedByMaker, names: usedByMaker.names.filter((n) => !keptNames.some((k) => k.toLowerCase() === n.toLowerCase())) }, keptNames) : null;
  const freshLine = fresh
    ? freshBrief({ template: tmpl.key, fresh, used: { ...usedByMaker, names: usedByMaker.names.filter((n) => !keptNames.some((k) => k.toLowerCase() === n.toLowerCase())) }, narrated, open: !series, english: langCode === "en", small: !!tmpl.childSafe, language: langName })
    : "";
  // (a story told in parts is planned a part at a time: each opens by showing where we are and ends on somebody —
  //  and a plan is dealt for twenty-four scenes at most)
  let camPlan = narrated ? (inParts ? partSizes.flatMap((n) => planShots(n)) : planShots(scenes)) : [];
  // …and AN ACTED FILM'S SHOTS HAPPEN (acted-staging.ts). The KIND of thing that happens in a shot is shown
  // to its writer by a few examples DEALT for this film — a fixed example comes back as the story.
  const acted = !!tmpl.dialogue && !narrated;
  const actIdeas = acted ? eventIdeas(Math.random, 4, !!tmpl.childSafe) : [];
  // (the example a cast is described by carries a DEALT name: the one it used to carry, "Pip", came back
  //  as a character's name in story after story)
  const exName = fresh ? (tmpl.childSafe ? fresh.names.small[0] : fresh.names.f[0]) || "Pip" : "Pip";
  const exLook = tmpl.childSafe
    ? "a cheerful 3-year-old boy with curly brown hair, round cheeks, a red-striped shirt and blue overalls"
    : "a wiry night-bus driver in her forties with a shaved head, round glasses, a mustard cardigan and a steel thermos";
  const artistName = (opts.artistName || "").trim().slice(0, 60);
  const castNames = (opts.castNames || []).map((n) => (n || "").trim()).filter(Boolean).slice(0, 4);
  const coStars = castNames.length
    ? ` Named co-stars who ALSO appear — use THESE EXACT names and NEVER invent other named people: ${castNames.join(", ")}. In every scene where more than the singer appears (a band, friends, a dance, a crowd of known faces), NAME which of them is there IN that scene's visual (e.g. "${castNames[0]} plays guitar beside ${artistName || "the singer"}"), so those scenes feature the real cast — not strangers. Everyone a VISUAL names is DRAWN in that picture: name someone only when they are IN the shot — never as the owner of a thing ("${castNames[0]}'s car"; say "a car").`
    // No co-stars picked = a SOLO artist. The old wording ("you may add ONE unnamed bandmate") still got a
    // NAMED stranger written into the cast and the lyrics ("Treyvon on the beat" in a solo video).
    : " You may put ONE unnamed bandmate or dancer in a scene's visual — but NEVER give them a name, NEVER list them in \"cast\" and NEVER mention them in the lyrics: \"cast\" has exactly ONE entry, the artist.";
  // Each avatar HAS a gender (the tester's bug: a female avatar got written — and sung — as male). State
  // it so the writer never casts a man in a woman's role/clothing (or a dress) or vice versa.
  const genderBits: string[] = [];
  if (artistName && opts.artistGender) genderBits.push(`${artistName} is ${opts.artistGender === "f" ? "FEMALE (a woman)" : "MALE (a man)"}`);
  for (const c of (opts.castGenders || [])) if (c && c.name && (c.gender === "m" || c.gender === "f")) genderBits.push(`${c.name} is ${c.gender === "f" ? "FEMALE (a woman)" : "MALE (a man)"}`);
  const genderLine = genderBits.length ? `\nCAST GENDERS — honour these EXACTLY: ${genderBits.join("; ")}. NEVER put a man in a woman's role, description or clothing (a dress, "his girlfriend"), nor a woman in a man's — match each person's stated gender in every scene, outfit and pronoun.` : "";
  // Kill "AI slop" names/pets WITHOUT banning atmosphere: the writer kept inventing a dog + NAMED
  // extras nobody asked for, but a crowd at a show or passersby on a street are fine and wanted.
  const noSlop = " Do NOT invent any uninvited NAMED or featured characters, or animals/pets (no dogs, cats) — the only recurring, named people are the cast above. Incidental UNNAMED background people (a crowd at a show, dancers, passersby on a street) are fine and encouraged where the setting calls for them.";
  // A CREATURE THE MAKER CHOSE FOR A HORROR IDEA THAT CALLS ITS THREAT SOMETHING ELSE (premise-rules.ts →
  // chosenThreat): the tester's "a dark shadow standing under the old tree", made with the werewolf chosen, came
  // back with the werewolf standing beside the boy — a grown man by then — in a lit bedroom from the first shot.
  // In an acted film the chosen creature is then the THING, not one of the two who talk.
  // (what each one IS comes from the page when it knows — a guess from the look's first words read "a huge, lean
  //  werewolf that…" as a person, cut at its comma, and the third live preview kept the werewolf in the cast)
  const threatNames = tmpl.key === "horror" ? picked.filter((c) => c.kind === "monster" || (!c.kind && keepGuess(c.desc).kind === "monster")).map((c) => c.name) : [];
  const actedThreat = acted && threatNames.length > 0;
  // …and in an ACTED film it is told apart from the cast, not as one of it: told "the cast is already chosen:
  // Howl … (a chosen creature that is the threat excepted)", the writer kept Howl in "cast" and invented one boy
  // — the two the film puts in every shot, the werewolf beside the boy again (live preview, 2026-11-24). Now
  // the cast it is given is the chosen PEOPLE only (none: it invents the two, as for any acted film), and the
  // creature comes after, as THE THREAT; whatever "cast" comes back is held to that below.
  const castChosen = actedThreat ? picked.filter((c) => !threatNames.includes(c.name)) : picked;
  const threatBrief = actedThreat
    ? `\nTHE THREAT — chosen by the maker: ${picked.filter((c) => threatNames.includes(c.name)).map((c) => `${c.name}${c.desc ? ` — ${c.desc}` : ""}`).join("; ")}.${chosenThreat(threatNames, true)}`
    : "";
  const pickedLine = castChosen.length
    ? `\nTHE CAST IS ALREADY CHOSEN — write the story for exactly these characters: ${castChosen.map((c) => `${c.name}${c.desc ? ` — ${c.desc}` : ""}`).join("; ")}. Return them as "cast": ONE entry each, in this order, EACH STARTING WITH THE CHARACTER'S EXACT NAME followed by that fixed look (e.g. "${castChosen[0].name}, …"). Use these exact names in every scene and never rename them. A character who is a creature or a cartoon stays exactly that — never turn them into a person.${narrated ? " If the story needs someone else who comes back (a victim, a friend, a parent), you may add up to TWO more recurring characters: give each a simple first name and add them to \"cast\" after the chosen ones, each entry starting with the name followed by one fixed, vivid look." : castChosen.length < 2 ? " The story needs a second voice: invent ONE more character with a simple first name, described just as vividly, and add them to \"cast\" after the first." : " Do NOT add any other named character."}${noSlop}${actedThreat ? "" : chosenThreat(threatNames, acted)}`
    : "";
  const castLine = pickedLine ? pickedLine : tmpl.castBible
    ? (tmpl.sing && !tmpl.childSafe
      ? (artistName
        ? `\nThe artist is named "${artistName}" — use THIS EXACT name everywhere; do NOT give them a stage name, alias, rap name or ANY other name. Return "cast" as an array of vivid FIXED visual descriptions, EACH STARTING WITH THE PERSON'S EXACT NAME: the FIRST entry is ${artistName} (e.g. "${artistName}, a singer with long dark wavy hair and a black leather jacket")${castNames.length ? `, then ONE entry for EACH co-star, in this order and with these EXACT names — ${castNames.map((n) => `"${n}"`).join(", ")} (e.g. "${castNames[0]}, …")` : ""}. Every scene's VISUAL and caption must use ONLY these exact names — NEVER a made-up or stage name.${coStars} Every scene's VISUAL features this SAME performer.${noSlop}`
        : `\nFirst invent the ARTIST and return it as "cast": an array whose FIRST entry is ONE vivid, FIXED visual description of the singer to reuse in every scene (e.g. "Mia, a 25-year-old singer with long dark wavy hair, a black leather jacket and silver hoop earrings").${coStars} Every scene's VISUAL must feature this SAME performer, described the same way.${noSlop}`)
      // AN ACTED SCENE IS TWO PEOPLE (dialogue-cast.ts): the film is shot as a two-shot, so the cast the
      // writer invents for one is exactly two, each with ONE word for a name — "Grandpa Joe" was read as
      // "Joe" by the shot builder and matched nobody's portrait, and a third character had no mouth at all.
      : tmpl.dialogue && !narrated
      ? `\nFirst invent the TWO characters who carry this scene and return them as "cast": exactly two entries, each ONE vivid, FIXED visual description to reuse in every shot, starting with the character's name — a simple ONE-WORD first name (e.g. "${exName}, ${exLook}"; never a title or two words such as "Grandpa Joe" or "Mr. Alvarez"). Every shot's VISUAL has these same two in it, called by these exact names — their looks are said HERE, once, and never repeated in a VISUAL.${noSlop}`
      : `\nFirst invent a small RECURRING CAST (2-3 characters) and return it as "cast": an array where each entry is ONE vivid, FIXED visual description to reuse in every scene (e.g. "${exName}, ${exLook}"). Every scene's VISUAL must feature these same named characters, described the same way.${noSlop}`)
    : "";
  const prodLine = tmpl.needsProduct && opts.productTitle
    ? `\nTHE PRODUCT being advertised: "${opts.productTitle.slice(0, 80)}"${opts.productDescription ? ` — ${opts.productDescription.slice(0, 300)}` : ""}. Make it the HERO of the gag — the funny payoff features or revolves around this exact product. Say ONLY what is true of it; invent no claims, specs, prices or reviews.`
    : "";
  // Narrated templates want each caption to BE the narrator's spoken line for
  // that beat (a flowing voiceover); others want a short on-screen hook.
  // EXACT-LENGTH short cuts (10s / 20s): the video is cut to exactly scenes×10 seconds, and the music
  // engine sings roughly ONE lyric line every 5 seconds then stops (measured on music-1.5: 2 lines → 11s,
  // 4 → 20s, 6 → 26s, 8 → 34s). A full verse-chorus song written for a 10-second video just gets chopped
  // off mid-verse, so the short cuts get a hook sized to their length instead.
  // (All of this goes by the video's length in SECONDS — a 20-second video is a short cut whether it is
  // two ten-second scenes or four five-second ones.)
  const shortCut = videoSecs <= 20;
  // THE SONG IS WRITTEN TO THE LENGTH ITS ENGINE WILL SING IT AT (mv-song.ts — measured, and shared with
  // the render so the song that is written is the song the engine it is given to can sing):
  //  · the FULL-LENGTH engine (a minute and up) arranges a whole song at a line every 4-5 seconds: about
  //    videoSecs ÷ 4.2 lines — a little LONGER than the video, so it is trimmed with a fade rather than
  //    repeated;
  //  · the SHORT engine sings the sheet once at the genre's pace (rap and rock about 3.2 words a second,
  //    pop 2.2, country 2.0) and stops: about that many words for every second of video, up to what the
  //    engine takes. (It used to be given "a line a scene" — six lines for 30 seconds — and had sung them
  //    all by 15–17 s: the first live videos of five-second scenes repeated their first half.)
  const fullSong = songEngineFor(videoSecs) === "full";
  const fullLines = fullSongLines(videoSecs);
  const songWords = songWordsFor(genreKey, videoSecs);
  const sceneWords = sceneWordsFor(genreKey, sceneSec, videoSecs);
  // how much lyric falls in one scene — on the short engine a RANGE with both ends, said as lines too
  // (mv-song.ts sceneWordRange: "about 11 words" got 13-14, "about 11, never more than 13" got 7-9)
  const sceneRange = sceneWordRange(genreKey, sceneSec, videoSecs);
  const perScene = fullSong
    ? (sceneSec === 5 ? "1 line, 2 at the very most" : "2-3 lines")
    : `between ${sceneRange.lo} and ${sceneRange.hi} words (${wordsAsLineCount(sceneWords)})`;
  const songShape = fullSong
    ? `This video runs ${videoSecs} seconds and the music engine sings about one line every 4-5 seconds, so write a FULL song of about ${fullLines} short lyric lines in TOTAL (${perScene} per scene): verses that carry the story forward and a catchy chorus hook that comes back two or three times — WRITE THE CHORUS LINES OUT again every time they are sung. Keep every line short (10 words or fewer).`
    : `This video runs ${videoSecs} seconds. In this genre the music engine sings about ${SING_RATE[genreKey] || 2.2} words a second and STOPS when the words run out, so the lyrics must be the right LENGTH: about ${songWords} words in TOTAL (${wordsAsLines(songWords)}), spread evenly — ${perScene} in every scene. Count them. Too few and the song ends before the video does; and never more than ${Math.min(SHORT_ENGINE_WORDS + 3, Math.round(songWords * 1.12))} words or 570 characters (the engine takes no more). ${shortCut ? "It is a short cut: one hook, with no verse to set it up." : "A short verse, a hook that comes back, a second short verse, the hook again — WRITE THE HOOK OUT each time it is sung."}`;
  const captionShape = fullSong
    ? `• CAPTION — the SHORT lyric line${sceneSec === 5 ? "" : "s"} sung in THIS scene (${perScene}), separated by " / ". Read in order, all ${scenes} captions joined ARE the complete ${genreLabel} song, with the chorus written out each time it returns. Authentic to ${genreLabel}.\n`
    // (both ends of the range are said: fewer and the song runs out before the video, more and each
    //  scene's words are sung a scene late — both seen on live featured tests)
    : `• CAPTION — the lyric sung in THIS scene: ${perScene}, its lines separated by " / ". COUNT the words of every caption — fewer than ${sceneRange.lo} and the song runs out before the video ends, more than ${sceneRange.hi} and they cannot be sung while the scene is on screen. EVERY scene has one — a cut scene too: the song does not stop for it. Read in order, all ${scenes} captions joined ARE the complete ${genreLabel} ${shortCut ? "hook" : "song"}. Authentic to ${genreLabel}.\n`;
  // WHAT EACH SCENE IS FILMED AS. A music video is a few performances intercut with cut scenes, and which
  // is which is decided by the shot list — so the writer is told, scene by scene, and writes a scene that
  // fits its shot (see SHOT_NOTES).
  // A FEATURED VERSE (mv-feature.ts): co-stars the maker asked to SING part of the song, in their own
  // voice. Only a picked co-star can be featured, and only in a video long enough to share. With one,
  // the roles are dealt so there is a second performance for them to be seen singing.
  const castList = castNames.slice(0, MAX_COSTARS);
  const featured = tmpl.lipSyncSinger && videoSecs >= FEATURE_MIN_SECONDS
    ? castList.filter((n) => (opts.featureNames || []).some((f) => singerOf({ singer: f }, [n]) === 0))
    : [];
  const rolesFor = (n: number): ShotRole[] => {
    const cadence = Array.from({ length: n }, (_, i) => defaultRole(i, n, sceneSec));
    return featured.length ? featureRoles(cadence) : cadence;
  };
  const roles = rolesFor(scenes);
  // WHO SINGS EACH SCENE is dealt BEFORE the song is written (mv-feature.ts defaultFeaturePlan) and the
  // writer is told it scene by scene, in the shot list. It used to be left to the writer ("give them two
  // or three scenes in a row…") and re-dealt by rule when its marks could not be filmed — which left the
  // PICTURES behind: a sheet came back with the co-star's performance written into the last cut scene
  // ("KEIKO sings to camera alone…") and the artist singing in the scene that was dealt to her
  // (2026-11-22). One plan, said before and used after.
  const featPlan: number[] = featured.length ? defaultFeaturePlan(roles, sceneSec, featured.map((n) => castList.indexOf(n))) : [];
  // (a co-star's verse is a PERFORMANCE of theirs and nothing else — they are heard only while they are
  //  seen singing: mv-feature.ts voiceWindows)
  const shotLine = (i: number): string => {
    const who = roles[i] === "perform" && featPlan[i] >= 0 ? castList[featPlan[i]] : "";
    return who
      ? `  ${i + 1}. PERFORMANCE — ${who}'S VERSE: ${who} sings straight to camera, ALONE in the shot (the artist is not in it); "singer": "${who}"`
      : `  ${i + 1}. ${SHOT_NOTES[shotSlot(roles[i], i)]}`;
  };
  const shotPlan = tmpl.lipSyncSinger ? Array.from({ length: scenes }, (_, i) => shotLine(i)).join("\n") : "";
  const hasCoStars = castNames.length > 0;
  const featNames = featured.join(" and ");
  const featLine = featured.length
    ? `A FEATURED VERSE — ${featNames} ${featured.length === 1 ? "sings" : "each sing"} part of this song, like a featured artist on a real record. The scene marked "…'S VERSE" in the shot list IS that verse: set "singer" to their exact name in it and in no other scene. Its lyric lines are THEIR words, in their own voice: their side of the story, answering the artist — a complete thought that starts and ends inside that one scene, because they are heard only while they are on screen. Every other scene is the artist's — leave "singer" out of it. End the title with "(feat. ${featNames})".\n`
    : "";
  // WHAT A STORY'S PLACES ARE, and how a scene says which one it is set at — the two halves of what a told story's
  // writer is asked about its places (below), apart so that a long story's PLANNER can be asked the first and each
  // of its parts told the second (film-length.ts → planBrief).
  const PLACES_ARE = `the ONE or TWO places or things this story keeps coming back to — a house, a boat, a shop, a street, a car — each written as "name: look": a short plain name ("the ferry", "the lighthouse", "the bakery"), a colon, then ONE fixed description of 15-30 words — its shape, colours and materials, and two or three details that make it THIS one and no other (e.g. "the ferry: an old low black wooden river ferry with a small square wheelhouse at its stern, one iron lantern hook at its bow and a worn plank deck with a low rail"). Only what at least TWO pictures are set at, in or on; never a person or an animal; no weather or time of day in it; an empty list when the story has no such place.`;
  const PLACE_FIELD = `Every VISUAL set there calls it by that exact name ("on the ferry", "at the door of the lighthouse"). And every scene also has a third field, PLACE: the name of the one of them that picture is set at, in or on — exactly as it is written in "places" — or "" when it is set somewhere else.`;
  // (the last words of ONE_TAKE, acted-staging.ts — true of a film written in one answer, and not said to one
  //  scene of a long film: whether the film comes back to a place is its plan's)
  const NEVER_BACK = " For the same reason the film never comes BACK to a place it has left.";
  /** THE BRIEF — for a whole film (`part` null: the brief exactly as it was before a film could be long), for the
   *  PLAN of a long one ("plan"), or for ONE PART of it: `scenes` shots, seen as `camPlan` says, standing where
   *  `part` says in the plan. (Not indented, on purpose: every line down to `return prompt` is the brief as it has
   *  been written, failure by failure — it reads the same in a blame, and merges with a change to any one line.) */
  type PartOf = { plan: FilmPlan; index: number; /** the lines already written, part by part */ said: string[][]; seenAs?: string };
  const promptFor = (scenes: number, camPlan: ReturnType<typeof planShots>, part: PartOf | "plan" | null): string => {
  const one = part && part !== "plan" ? part : null;
  // (a whole film opens and ends in the one answer; of a long film's parts only the first opens it, only the last ends it)
  const opens = !one || one.index === 0;
  const ends = !one || one.index === one.plan.parts.length - 1;
  const captionLine = tmpl.lipSyncSinger
    ? `\nWrite a catchy ${genreLabel} SONG for ONE artist${featured.length ? `, with a featured verse by ${featNames}` : ""}, plus ${scenes} VIDEO SCENE${scenes === 1 ? "" : "S"} of ${sceneSec} seconds each. ${songShape} Return EXACTLY ${scenes} scene${scenes === 1 ? "" : "s"}. Each scene has TWO fields${featured.length ? ` (and "singer" where it is not the artist)` : ""}:\n` +
      // (ONE moment: "OMAR steps out of the car … all walking toward the entrance" was drawn as OMAR
      //  twice — once getting out, once walking — on the first live storyboard, 2026-11-21)
      `• VISUAL — what we SEE in that scene, in at most 40 words: a vivid ${genreLabel} setting (${tmpl.sceneHint}) and what is happening in it. ONE moment — a single frame of film, never a sequence of actions (not "steps out of the car and walks in"). A different location in every scene for visual variety — but ONE WORLD: the same time of day and the same kind of light in every scene (a night video never cuts to daylight), said in each VISUAL; NO on-screen text, logos or real named people.\n` +
      captionShape +
      `THE SHOT LIST — scene by scene, this is what each one is filmed as; write each VISUAL to fit its line:\n${shotPlan}\n` +
      featLine +
      (featured.length
        ? `WHO DOES WHAT — the ARTIST sings the song; ${featNames} sing${featured.length === 1 ? "s" : ""} ONLY in ${featured.length === 1 ? "their" : "their own"} verse. Nobody else ever sings. In the artist's PERFORMANCES the co-stars are in the shot WITH the artist: beside or just behind them, dancing or moving to the music — never singing, never the centre of the shot. In a CUT SCENE nobody sings to camera.\n`
        : `WHO DOES WHAT — only the ARTIST ever sings.${hasCoStars ? ` In every PERFORMANCE the co-stars are in the shot WITH the artist: beside or just behind them, dancing or moving to the music — never singing, never the centre of the shot.` : ""} In a CUT SCENE nobody sings to camera.\n`) +
      `MICROPHONES — most music videos have none: the song is mimed. Do NOT put a microphone or mic stand in a VISUAL unless that scene is a live stage show or a recording booth — and then ONLY the artist has one.\n` +
      // (a song about a night drive had its dance scene written in a moving convertible, and the cast
      //  was drawn — and animated — on their feet in it: the owner's "walking in place in car", 2026-11-22)
      SENSE_RULES +
      `RENDER-SAFE — these scenes become AI video and some things glitch badly when animated. UNLESS the theme above explicitly calls for it, AVOID: fire, flames, bonfires, sparks or embers; riding in the BED of a moving truck or any fast open-air wind (the wind + flames warp into a mess); extreme tight face-filling close-ups; and exaggerated or extreme facial emotions (screaming, sobbing, snarling). Prefer steady medium and wide shots, grounded settings, gentle believable motion, and natural, genuine expressions.\n`
    : narrated
    ? `\nWrite it as a NARRATED STORY: a storyteller's voice tells it over illustrated scenes — nobody speaks on camera. Return EXACTLY ${scenes} scenes. Each scene has TWO fields:\n` +
      `• VISUAL — the ONE picture we see while that part is told, in at most 45 words: a single vivid, specific moment (${tmpl.sceneHint}) — who is in it, where, doing what, the light and the mood. Call every character who is IN the picture by their NAME exactly as in "cast" (never just "he", "she", "the creature" or "the clerk"); a picture nobody is in names nobody. Whoever a VISUAL names is DRAWN in it — so a place or thing that belongs to somebody who is NOT in the picture is called by what it is ("the blue house on the corner"), never by their name ("NAME's house"). Anything that is seen in more than one picture (a kite, a car, a house, a toy) is described with the SAME few words every time, so it is drawn the same. A different moment every scene. It is ONE moment only — a picture cannot show two times: never "then", "until", "later" or a before-and-after in a VISUAL (three stories made on 2026-11-22: a scene written as two moments was drawn as two panels). A picture has the story's cast and at most ONE other person — never an extra "unnamed" figure beside two of the cast (the picture model then leaves one of the cast out). When a door or a window is in the picture, say which SIDE of it each person is on ("inside, at the locked front door"; "outside on the porch") — a picture model left to guess put a little brother on the porch while his sister locked him out. Whoever looks OUT through a window or a door is INSIDE, and the VISUAL says the word ("inside at the window, the girl peers out at …") — "peers out" alone got a girl drawn standing out on the porch beside the ghost she was peering at. Something OUTSIDE at a window or a door — a face at the glass, a hand on the door — is seen from INSIDE the room, through the glass ("from inside the dark living room, the ghost's face at the window glass"): a camera outside looking at a window drew the ghost's face behind the glass, in the room with the children. What the CAPTION over a picture says is SEEN at that moment is IN that VISUAL ("they saw her standing on the porch" → she is on the porch, through the glass): an empty porch under "they saw her" reads as a mistake. And nothing in it is WRITTEN: no sign with words, label, notice, number or name on a door — say what a thing looks like, never what it says.\n` +
      `• CAPTION — the NARRATOR'S words for that scene, written to be READ ALOUD: 2-3 sentences, about 25-35 words. Plain, vivid, concrete storytelling — no "NAME:" labels, no stage directions, no headings. ${opens ? "The FIRST scene opens with a hook that makes a viewer stay. " : ""}Each scene picks up exactly where the last one left off.${!ends ? "" : ` The LAST scene lands the ending${tmpl.key === "moral" ? " and says the lesson in one clear closing line" : tmpl.key === "horror" ? " on the chilling twist — the last line should make the skin crawl — a twist that leaves every fact of the idea TRUE: it adds what was not known, it never reveals that something the idea said was false (a mother the idea says is away stays away) — and a viewer who has heard only this story understands it at once: it turns on something the story already showed or said, never on an event it never told (\"who called the house phone first\", when no call was ever made)" : ""}.`}\n` +
      (one ? `Read in order, the captions carry this part of the story on, in the one voice that tells all of it.\n` : `Read in order, the captions are the whole story, start to finish, in one voice.\n`) +
      // THE STAR TELLS IT (character-series.ts): a show told in its star's own voice is told BY them. The
      // first live episode, 2026-11-24, was a werewolf's growl saying "But Howl did not lunge. It pointed…"
      // — its own star, in the third person. A picture is still drawn from its words, so VISUALs keep the name.
      // …and with NO teller the storyteller stands outside the story. A Horror Story was written as "I" — a
      // cleaning woman's night — and told in the storyteller's voice, a man's (live, 2026-11-24: "that clip
      // is told in the creature voice - but from the womens perspective").
      (teller ? "" : `THE STORYTELLER is outside the story — a narrator, the kind a documentary has: every CAPTION is in the third person (the characters by their names, "she", "he", "they"), never "I", "me", "my" or "we"; what a character says is reported, not spoken as them.\n`) +
      (teller ? `THE TELLER: ${teller} tells this story THEMSELVES — it is ${teller}'s own voice we hear, start to finish. Every CAPTION is ${teller} speaking in the first person ("I", "me", "my"): it happened to ${teller}, and ${teller} is telling us about it. The captions never say "${teller}" and never call ${teller} "he", "she", "it" or "they". The VISUALS do not change: every VISUAL still calls ${teller} by NAME and never says "I", "me" or "my" — a picture is drawn from its words, and "I" is nobody.\n` : "") +
      // (a character's show ends every episode on the same line — the storyteller's very last words)
      (signoff && ends ? `THE SIGN-OFF: the last scene's CAPTION ends with exactly these words, after its own last sentence, changed in no way: "${signoff}"\n` : "") +
      // THE STORY'S PLACES (story-picture.ts): the first Horror Story made in one press had a ferry that was
      // a rowing boat, then a ship, then a ferry — each picture drew "the ferry" from the word. A place the
      // story comes back to is described ONCE, here, and drawn from one design sheet of it.
      (one
        // (a part of a long story: its places were chosen by its plan — film-length.ts)
        ? `THE STORY'S PLACES are already chosen${one.plan.places.length ? ` — ${one.plan.places.join("; ")}` : ": it has none that it comes back to"}. Return "places" exactly as they are here. ${PLACE_FIELD}\n`
        : `Also return "places": ${PLACES_ARE} ${PLACE_FIELD}\n`)
    : tmpl.dialogue
    // AN ACTED FILM'S SHOTS HAPPEN (acted-staging.ts). The owner, 2026-11-24, of a Horror Film made on the live
    // site: "aside from them on screen there is no actual things occurring, it's just them speaking". That is
    // what this brief asked for: VISUAL was "a TWO-SHOT framing BOTH characters … they STAY put … a still,
    // tense TALKING beat", and SHOT was 'EXACTLY "wide two-shot" for EVERY beat'. Now a shot's VISUAL is the
    // one thing that is DONE in it, and how the two are placed and filmed is dealt, location by location, by
    // the film itself (film-dialogue → dealStagings) — the writer does not choose it.
    ? `\nWrite it as a SHORT FILM SCENE with CHARACTER DIALOGUE. Return EXACTLY ${scenes} consecutive SHOTS. Each shot has FOUR fields:\n` +
      `• VISUAL — ${happensBrief(actIdeas)}\n` +
      `• CAPTION — formatted EXACTLY as "NAME: what they say", ONE speaker per shot. Each line fills MOST of the ~10-second shot WITHOUT overrunning it: a two-sentence beat of about 15-18 words (~7-9 seconds of speech). This is a HARD window — NEVER a short one-liner (a line that doesn't fill the shot leaves dead air, which makes the AI voice stall or repeat words), and NEVER more than 18 words, because a longer line overruns the 10-second clip and gets cut off at the end. Count the words and stay inside 15-18. The speaker ALTERNATES shot to shot, building a real back-and-forth with a clear turn at the end; use the cast's names, and make each line a genuine REPLY to the one before it (never a non-sequitur). ONLY the two people in the shot ever speak: the NAME before the colon is always one of their two names, the same single word every time. Anyone else the story needs — a shopkeeper, a parent, a stranger — is talked ABOUT or stands silent in the background, and is never heard; when what they say or do matters, one of the two reports it (\"He says he can't thank us enough!\"). ${tmpl.key === "horror" && ends ? LINE_IN_EVERY_SHOT_BUT_THE_LAST : LINE_IN_EVERY_SHOT}\n` +
      `• WHERE — the LOCATION this beat happens in, as a short vivid label (e.g. "a dim old diner at night, rain on the windows"). EVERY shot has one, and while the place stays the same it is the SAME words, letter for letter — other words are read as another place.\n` +
      `• TONE — HOW this exact line is delivered: a short emotional direction for the voice (e.g. "coldly, with quiet menace", "voice rising in anger", "quietly, barely holding it together"). It must MATCH the words so the read is never flat or monotone.\n` +
      `${CAMERA_IS_DEALT}\n` +
      // (one scene of a long film: which places the film is set in, and whether it comes back to one, is its PLAN's)
      `${one ? ONE_TAKE.replace(NEVER_BACK, "") : ONE_TAKE}\n` +
      `${TWO_ALWAYS}\n` +
      // (a sound comes FIRST, in the shot whose line answers it; heard from out of sight, it is made by nothing
      //  on screen; and what is said about it is what is heard — the owner's knocking film, 2026-11-24)
      `${HEARD_BEFORE_SAID}\n` +
      // (what is DONE to a place stays done, said in so many words — the owner, 2026-11-25, of the tent films: "the writer
      //  may need to be more deliberate on what it's telling the ai to do … they never actually zipped the tent doors up";
      //  the film draws what a VISUAL says was done, and keeps it: acted-staging.ts, place-state.ts)
      `${DONE_STAYS_DONE}\n` +
      // (…and so is its place: a scene of a long film is told where it is set — film-length.ts → partBrief)
      (one ? "" : `Keep the WHOLE conversation in ONE location unless the story genuinely moves the SAME characters somewhere else — only then start a NEW "where" (a real scene change; everyone is present in the new place). Prefer one flowing location over cutting between places — but when the IDEA moves them ("he ran to his parents' room"), that IS such a move: the shots that come after it are in the new place — and the move happens BEFORE the last shot, never in it: the last shot is in the same place as the shot before it (THE LAST SHOT, below).\n`) +
      // (a horror film ends on something SEEN — said last, so it is read as the exception to the line above)
      // (…the FILM does: only the scene that ends a long one is told how it ends)
      (tmpl.key === "horror" ? `${SEEN_WHEN_SEEN}\n${ends ? `${SEEN_AT_THE_END}\n` : ""}` : "")
    : tmpl.sung
    ? `\nReturn EXACTLY ${scenes} scenes. Each scene = a VISUAL (${tmpl.sceneHint}, featuring the artist/cast performing) and a CAPTION that is the SUNG LYRIC LINE for that beat — one short, catchy, singable line (<=10 words) that rhymes and flows with the others. Read in order the captions ARE the song's lyrics: give the whole thing a clear, repeating, sing-along HOOK${tmpl.childSafe ? " a toddler can sing along to" : ""}, like a real ${tmpl.childSafe ? "preschool nursery sing-along" : "pop song"}.\n${VISUAL_STANDS_ALONE}\n`
    : tmpl.narrated
    ? `\nReturn EXACTLY ${scenes} scenes. Each scene = a VISUAL (${tmpl.sceneHint}) and a CAPTION that is the NARRATOR'S spoken line for that beat — ONE natural sentence, <=14 words, moving the story forward; read in order the captions are a continuous, emotive voiceover that tells the whole story and lands the ending.\n${VISUAL_STANDS_ALONE}\n`
    : `\nReturn EXACTLY ${scenes} scenes. Each scene = a VISUAL (${tmpl.sceneHint}) and a short CAPTION (one punchy on-screen line, <=8 words; the hook or the joke's line for that beat).\n${VISUAL_STANDS_ALONE}\n`;
  // CHILDREN STAY CHILDREN (premise-rules.ts). Both lines below used to end "recast any … as an adult" — and the
  // tester's two children, and his boy, came back grown-ups.
  const safetyLine = tmpl.childSafe
    ? `SAFETY: this is for very young children — keep it 100% wholesome and G-rated: happy, gentle and safe. NOTHING scary, sad, violent, adult or unsafe; no real named people or brands; invent no claims.`
    : tmpl.key === "horror"
    ? HORROR_SAFETY
    : STORY_SAFETY;
  // The template brief says "a full ~2-minute MUSIC VIDEO … across several vivid settings" — say what a
  // short cut actually is, so the brief doesn't fight the hook-sized lyric budget above.
  const brief = tmpl.lipSyncSinger && shortCut
    ? `a SHORT ${videoSecs}-second MUSIC VIDEO cut — ONE artist actually sings a real genre hook on camera (lip-synced) ${scenes === 1 ? "in one vivid setting" : `across ${scenes} vivid settings`}`
    : narrated ? (NARRATED_BRIEF[tmpl.key] || NARRATED_BRIEF.testmovie)
    : tmpl.brief;
  // (the idea, as its writer is handed it — a whole film's below, and a long film's PLAN; a dealt starter with it)
  const ideaLine = topic
      ? `${series ? "WHAT HAPPENS IN THIS EPISODE" : "THEME / what it's about"}: "${topic.slice(0, IDEA_MAX)}". Tell EXACTLY this — stay faithful to what is described and build the story around it; do NOT swap in a different premise or pad it with extra characters, settings or events the user did not ask for.\n${nudged ? startLine(nudged, castChosen.some((c) => !threatNames.includes(c.name)), threatNames.length > 0) : ""}${storyFormat ? `${PREMISE_WINS}\n` : ""}`
      : series ? `Decide what happens next in this episode.\n` : `Pick a fun, broadly-appealing theme.\n`;
  const prompt =
    `Write ${brief}.\n` +
    // NEXT EPISODE: the series, the recap (fenced, quoted) and the rules of a next episode (film-series.ts)
    (series ? seriesWriterBrief(series) : "") +
    ideaLine +
    // a sung piece: the words are ours, whatever song the theme names
    (tmpl.lipSyncSinger || tmpl.sung ? `${ORIGINAL_LYRICS_RULE}\n` : "") +
    genreLine +
    castLine +
    threatBrief +
    // PEOPLE WHO ARE RELATED ARE THE RIGHT AGES FOR IT (acted-staging.ts): each one's age said plainly, and fitting
    // what they are to each other — the owner, of a live film: "they are "sisters" but one of them is 130 and the
    // other looks 30". (Checked below, after the writing.) Story formats only: a music video casts its own way.
    (storyFormat ? `\n${AGES_FIT_RELATION}` : "") +
    genderLine +
    prodLine +
    captionLine +
    // HOW EACH SCENE IS SEEN (story-shots.ts), and what keeps this story unlike the last (story-variety.ts)
    shotListBrief(camPlan) +
    freshLine +
    // WHAT FRIGHTENS (story-picture.ts): a horror story's own creature is nearly human, slightly wrong, half seen
    (tmpl.key === "horror" ? `${WHAT_FRIGHTENS}\n` : "") +
    // TODAY'S REAL WORLD (premise-rules.ts): never a fairytale cottage for "a house" — not in a children's format
    // (…nor in a genre whose world is its own: said to a Fantasy, "no castle, no lone stone cottage, no cabin"
    //  forbids the genre — film-genres.ts → ownWorld, 2026-11-25)
    // (…and right after it, A DRAWN STORY — an anime style, whatever its world — is told what that rule means for it:
    //  "look like a photograph of a real place" is a real place's shapes and materials, said in words; the picture is
    //  drawn, and no VISUAL asks for a photograph — anime-styles.ts → DRAWN_WORLD, 2026-11-26)
    (storyFormat && !tmpl.childSafe && !tmpl.ownWorld ? `${REAL_WORLD}\n` : "") +
    (tmpl.drawn ? `${DRAWN_WORLD}\n` : "") +
    `Also give musicMood (a short phrase for the backing track) and a short title.${langLine}\n` +
    safetyLine +
    // (the idea checked last of all — premise-rules.ts → IDEA_CHECK)
    (storyFormat && topic ? `\n${IDEA_CHECK}` : "");
  if (!part) return prompt;
  // A LONG FILM (film-length.ts → A LONG SCRIPT IS WRITTEN IN PARTS). Its PLAN is asked for with everything a whole
  // film's writer is told about the idea, the cast and the world — the idea is kept, and checked, THERE — and what
  // a plan is in place of what a script is.
  if (part === "plan") {
    // (how this format's last part ends, in the words its own brief ends a film with)
    const ending = narrated
      ? (tmpl.key === "moral" ? "and says the lesson in one clear closing line" : tmpl.key === "horror" ? "on the chilling twist — one that leaves every fact of the idea TRUE and turns on something the story already told" : "")
      : (tmpl.key === "horror" ? "on what the two SEE: the thing the film has circled, found where they already are, with no line said over it" : tmpl.key === "moral" ? "on its lesson, landed plainly by what one of the two does or says" : "");
    return (
      `Write the PLAN of ${brief}.\n` +
      (series ? seriesWriterBrief(series) : "") +
      ideaLine +
      castLine +
      threatBrief +
      `\n${AGES_FIT_RELATION}` +
      genderLine +
      planBrief(way, { sizes: partSizes, ending, placesAsk: narrated ? PLACES_ARE : undefined }) +
      freshLine +
      (tmpl.key === "horror" ? `${WHAT_FRIGHTENS}\n` : "") +
      // (a genre whose world is its own is never told today's real world — not in its plan either: film-genres.ts → ownWorld)
      // (…and a drawn story's plan is told it is drawn, as its whole is: DRAWN_WORLD)
      (!tmpl.childSafe && !tmpl.ownWorld ? `${REAL_WORLD}\n` : "") +
      (tmpl.drawn ? `${DRAWN_WORLD}\n` : "") +
      `Also give musicMood (a short phrase for the backing track) and a short title.${langLine}\n` +
      safetyLine +
      (topic ? `\n${IDEA_CHECK}` : "")
    );
  }
  // ONE PART OF IT: where it stands in the plan, the cast the plan chose, and then the brief every film is written
  // by — its shots, its lines, its world. The idea is not handed over to be told again from the top (that is the
  // plan's), nor checked here: a part tells its own line of the plan.
  const chosen = one!.plan.cast.join("; ");
  // (an acted film's plan may cast its own THREAT beside the two — WHAT FRIGHTENS asks a threat the idea names for a
  //  "cast" entry, and the film draws its one picture from it: acted-staging.ts → storyThreat. Handed on as one of
  //  "THE TWO", every part would be told to put it in every shot: the werewolf beside the boy from the first shot,
  //  2026-11-24. So it is said apart.)
  const thing = !narrated && one!.plan.cast.length > 2 ? storyThreat({ cast: one!.plan.cast }) : null;
  const two = thing ? one!.plan.cast.filter((e) => e !== thing.entry).join("; ") : chosen;
  const partCast = narrated
    ? `\nTHE CAST of the whole story is already chosen — ${chosen}. Return them as "cast" exactly as they are here. Call each of them by that exact name in every VISUAL they are in, never rename them, and give nobody else a name.${noSlop}${chosenThreat(threatNames, false)}`
    : `\nTHE TWO who carry the whole film are already chosen — ${two}. Return them as "cast" exactly as they are here.${thing ? ` After them "cast" has the film's own threat, also exactly as it is here: ${thing.entry} — it is NOT one of the two, it never speaks, and it is in a VISUAL only where the rules below put it.` : ""} Every shot's VISUAL has these same two in it, called by these exact names — their looks are said HERE, once, and never repeated in a VISUAL.${noSlop}`;
  // (a creature the maker chose as an acted film's threat is SEEN in the film's last shot — premise-rules.ts →
  //  chosenThreat — so only the scene that ends the film is told so; before it, it is heard and glimpsed)
  const partThreat = !actedThreat ? "" : ends ? threatBrief
    : `\nTHE THREAT — chosen by the maker: ${picked.filter((c) => threatNames.includes(c.name)).map((c) => `${c.name}${c.desc ? ` — ${c.desc}` : ""}`).join("; ")}. It is NOT one of the two, it has no "cast" entry, and it is NOT SEEN in this scene: it is only heard, or glimpsed far off, the way the idea says.`;
  return (
    `Write ONE ${narrated ? "PART" : "SCENE"} of ${brief}.\n` +
    partBrief(way, { plan: one!.plan, index: one!.index, shots: scenes, idea: topic.slice(0, IDEA_MAX), said: one!.said, seenAs: one!.seenAs }) +
    partCast +
    partThreat +
    genderLine +
    captionLine +
    shotListBrief(camPlan) +
    // (a told story's first part is dealt its opening, as a whole story is — story-variety.ts)
    (narrated && opens ? freshLine : "") +
    (tmpl.key === "horror" ? `${WHAT_FRIGHTENS}\n` : "") +
    // (…nor in any of its parts: a Fantasy told "no castle" in scene 4 of 9 is the genre forbidden halfway through)
    // (…and every part of a drawn story is told it is drawn: DRAWN_WORLD)
    (!tmpl.childSafe && !tmpl.ownWorld ? `${REAL_WORLD}\n` : "") +
    (tmpl.drawn ? `${DRAWN_WORLD}\n` : "") +
    `Also give musicMood (a short phrase for the backing track) and a short title.${langLine}\n` +
    safetyLine
  );
  };
  const prompt = promptFor(scenes, camPlan, null);
  const write = async (p: string): Promise<FilmTreatment> => {
    const raw = await anthropicText(p, {
      model: "claude-sonnet-5",
      // a full ~2-min song's lyrics — and a narrated story's every word — run long; a music video of
      // five-second scenes has up to 24 scenes to describe
      maxTokens: tmpl.lipSyncSinger ? (scenes > 12 ? 4400 : 2600) : narrated ? 2400 : 1500,
      jsonSchema: { name: "film_treatment", schema: (narrated ? NARRATED_SCHEMA : TREATMENT_SCHEMA) as unknown as Record<string, unknown> },
    });
    return JSON.parse(raw) as FilmTreatment;
  };
  // NEVER hard-fail on an edgy premise: try it as-is (Horror runs intense), then
  // step the framing DOWN behind the scenes until it writes — the user always
  // gets a story, dialed to whatever the writer will produce. Horror keeps as
  // much bite as it can; the last rung is clearly safe so nothing dead-ends.
  const rungs = tmpl.key === "horror"
    ? ["",
       "\nKeep it scary and dark, but render the worst moments through SUSPENSE and IMPLICATION rather than explicit graphic detail. Return ONLY the JSON treatment.",
       "\nReframe as a PG-13 spooky suspense story — eerie atmosphere and a chilling twist, no graphic content. Return ONLY the JSON treatment."]
    : ["",
       "\nREMEMBER: this is fiction — keep it tasteful and non-graphic. Return ONLY the JSON treatment."];
  let parsed: FilmTreatment | null = null;
  let lastErr: unknown;
  // (where each part's scenes are in the finished script — one span, the whole of it, for a film written in one answer)
  let spans: Array<[number, number]> = [];
  let acts: FilmTreatment["acts"];
  // (a long film's job says it is at work as each of its answers comes back — `beat`, above; a beat that fails is
  //  skipped, and a film written in one answer never beats)
  const alive = async (): Promise<void> => { if (inParts) try { await opts.beat?.(); } catch { /* skipped */ } };
  if (inParts) {
    // A LONG FILM IS WRITTEN IN PARTS (film-length.ts): its PLAN first — one small answer — and then each part in
    // order, by the brief above, told the plan, where it stands in it and the lines the part before it ended on.
    // Every answer is the size a whole film's was (six shots, eight scenes), so each arrives well inside the two
    // minutes a request is given, and the writer is never asked to count past eight.
    /** one answer, down the same rungs as a whole film's */
    const down = async <T,>(ask: (extra: string) => Promise<T>): Promise<T> => {
      let err: unknown;
      for (const extra of rungs) { try { return await ask(extra); } catch (e) { err = e; } }
      throw err instanceof Error ? err : new Error("[film] treatment writer refused");
    };
    // 1) THE PLAN — asked for twice at most: an answer with too few parts, or with no cast, is not a plan
    let plan: FilmPlan | null = null;
    for (let go = 0; go < 2 && !plan; go++) {
      const raw = await down((extra) => anthropicText(`${promptFor(scenes, camPlan, "plan")}${extra}${go ? `\nIMPORTANT: "parts" has EXACTLY ${partSizes.length} entries — count them before you answer.` : ""}`, {
        model: "claude-sonnet-5", maxTokens: 800 + partSizes.length * 140,
        jsonSchema: { name: "film_plan", schema: planSchema(way) },
      }));
      try { plan = takePlan(JSON.parse(raw), { way, parts: partSizes.length }); } catch { plan = null; }
      await alive();
    }
    // (never a shorter film than was asked for, written the old way: the maker is told, and tries again)
    if (!plan) throw new Error(`[film] a ${scenes}-${narrated ? "scene story" : "shot film"} could not be planned in ${partSizes.length} parts`);
    const planned: FilmPlan = plan;
    console.log(`[film] a ${scenes}-${narrated ? "scene story" : "shot film"} is written in ${partSizes.length} parts (${partSizes.join(", ")})${narrated ? "" : ` — its places: ${planned.parts.map((p) => p.where.slice(0, 30)).join(" | ").slice(0, 300)}`}`);
    // 2) THE PARTS, in order
    const all: FilmScene[] = [];
    const seenAs: ReturnType<typeof planShots> = [];
    for (let j = 0; j < partSizes.length; j++) {
      const n = partSizes[j];
      const from = partSizes.slice(0, j).reduce((a, b) => a + b, 0);
      const cams = camPlan.slice(from, from + n);
      // (the film has been in this place before: its picture was drawn from the first shot written there —
      //  acted-staging.ts → ONE_TAKE — and this scene is told so)
      const first = narrated ? undefined : all.find((s) => s.where === planned.parts[j].where);
      // (…and it is handed EVERY line the parts before it wrote, not a summary of them: film-length.ts → partBrief)
      const ask = promptFor(n, cams, { plan: planned, index: j, said: spans.map(([a, b]) => all.slice(a, b).map((s) => s.caption || "").filter(Boolean)), ...(first ? { seenAs: first.visual } : {}) });
      let got: FilmScene[] = [];
      for (let go = 0; go < 2 && got.length < n; go++) {
        try {
          const t = await down((extra) => write(`${ask}${extra}${go ? `\nIMPORTANT: your last answer had ${got.length} ${narrated ? "scenes" : "shots"}. Return EXACTLY ${n} — count them before you answer.` : ""}`));
          const came = (t.scenes || []).filter((s) => s && s.visual).slice(0, n);
          if (came.length > got.length) got = came;
          await alive();
        } catch (e) {
          // (asked again only because the first answer was short: what it had is kept)
          if (!got.length) throw e;
        }
      }
      if (!got.length) throw new Error(`[film] part ${j + 1} of ${partSizes.length} came back empty`);
      spans.push([all.length, all.length + got.length]);
      seenAs.push(...cams.slice(0, got.length));
      // (an acted scene is in the ONE place its plan gave it — the same words every time the film is there, so
      //  that it is the same picture: other words are read as another place)
      all.push(...got.map((s) => (narrated ? s : { ...s, where: planned.parts[j].where })));
    }
    // (each scene keeps the way of seeing it was WRITTEN to, should a part have come back a scene short)
    camPlan = seenAs;
    parsed = { title: planned.title, musicMood: planned.musicMood, cast: planned.cast, ...(narrated ? { places: planned.places } : {}), scenes: all };
    acts = planned.parts.map((p, j) => ({ what: p.what, ...(p.where ? { where: p.where } : {}), scenes: spans[j][1] - spans[j][0] }));
  } else for (const extra of rungs) {
    try { parsed = await write(prompt + extra); break; } catch (e) { lastErr = e; }
  }
  if (!parsed) throw lastErr instanceof Error ? lastErr : new Error("[film] treatment writer refused");
  // A music video is EXACTLY the picked number of scenes (its length was picked to the second, and with
  // five-second scenes there can be 24 of them). A writer that came back short is asked once more, told
  // so; if it is short again the fuller answer is kept and the video is that much shorter.
  const usable = (t: FilmTreatment | null): number => (t?.scenes || []).filter((s) => s && s.visual).length;
  if (tmpl.lipSyncSinger && usable(parsed) < scenes) {
    try {
      const again = await write(`${prompt}\nIMPORTANT: your last answer had ${usable(parsed)} scenes. Return EXACTLY ${scenes} scenes — count them before you answer.`);
      if (usable(again) > usable(parsed)) parsed = again;
    } catch { /* keep the first answer */ }
  }
  // THE LYRIC MUST FIT ITS VIDEO (the short engine sings the sheet once, at the genre's pace, and stops).
  // The writer is told the range and misses it either way: 13-14 words a scene where 11 fit (the song ran
  // a scene late), then 7-9, then 6-8 — forty-two words for a song that needs sixty-six — and, asked to
  // add "3 to 5 more words" to each scene, came back with ninety-four. It cannot count; the code can.
  // So the sheet is COUNTED (mv-song.ts lyricFit), and while it is off the writer is asked for every
  // scene's lyric at THREE lengths and each scene keeps whichever version is nearest the length it needs
  // (pickLyric) — twice at most, and only if the sheet then fits better. What happened rides back on the
  // treatment ("lyricFit"), so a sheet that would not come right is seen.
  let fitNote: FilmTreatment["lyricFit"];
  if (tmpl.lipSyncSinger && !fullSong) {
    const sung = (parsed.scenes || []).filter((s) => s && s.visual).slice(0, scenes);
    const first = lyricFit(sung.map((s) => s.caption), genreKey, sceneSec, videoSecs);
    let now = first;
    let rounds = 0;
    let trouble = "";
    while (sung.length && now.off > 0 && rounds < 2) {
      rounds++;
      try {
        const sheet = sung.map((s, i) => `${i + 1}. [${lyricAsk(lyricWords(s.caption), now.lo, now.hi)}] ${s.caption || ""}`).join("\n");
        const refit =
          `These are the lyrics of a ${genreLabel} song for a ${videoSecs}-second music video — one entry for each of its ${sung.length} scenes (${sceneSec} seconds each), a scene's lines separated by " / ". In square brackets: how many words that scene has now, and what it needs.\n${sheet}\n` +
          `In this genre the song is sung at about ${SING_RATE[genreKey] || 2.2} words a second, so EVERY scene needs between ${now.lo} and ${now.hi} words (${wordsAsLineCount(sceneWords)}). As written the song has ${now.total} words and needs about ${now.want} — ${now.total < now.want ? "it would run out before the video ends" : "its words could not all be sung in time"}.\n` +
          // THREE LENGTHS of every scene, and the code picks: asked to rewrite to the range it went from 50
          // words to 94 ("needs 3 to 5 MORE" a scene, and it added eight). It cannot count — we can.
          `For EVERY scene write THREE versions of its lyric — the same meaning and the same rhyme at three LENGTHS: a short one of about ${Math.max(4, sceneWords - 3)} words, a middle one of about ${sceneWords} words, a long one of about ${sceneWords + 3} words — by tightening or lengthening its own lines. Keep the story, the order and the hook. ${ORIGINAL_LYRICS_RULE}${langWordsLine}\n` +
          `Return "scenes": exactly ${sung.length} entries in scene order, each a list of that scene's three versions (shortest first), a version's lines joined by " / " — nothing in them but the lyric (no numbers, no brackets).`;
        const raw = await anthropicText(refit, {
          model: "claude-sonnet-5", maxTokens: scenes > 12 ? 3600 : 1600,
          jsonSchema: { name: "lyric_fit", schema: { type: "object", properties: { scenes: { type: "array", items: { type: "array", items: { type: "string" } } } }, required: ["scenes"], additionalProperties: false } },
        });
        const vs = (JSON.parse(raw) as { scenes?: unknown }).scenes;
        const tidy = (c: unknown): string => (typeof c === "string" ? c.replace(/^\s*\d+\.\s*/, "").replace(/^\s*\[[^\]]*\]\s*/, "").trim() : "");
        if (!Array.isArray(vs) || vs.length !== sung.length || vs.some((v) => !Array.isArray(v))) { trouble = `the versions came back for ${Array.isArray(vs) ? vs.length : "no"} scenes of ${sung.length}`; continue; }
        // each scene keeps whichever of its versions — the one it has included — is nearest the length it needs
        const caps = sung.map((s, i) => pickLyric([s.caption || "", ...(vs[i] as unknown[]).map(tidy)], sceneWords));
        const after = lyricFit(caps, genreKey, sceneSec, videoSecs);
        if (after.off < now.off) { sung.forEach((s, i) => { s.caption = caps[i]; }); now = after; trouble = ""; }
        else trouble = `no version of ${(vs as unknown[][]).map((v) => v.map((c) => lyricWords(tidy(c))).join("/")).join(" ").slice(0, 90)} words fitted better`;
      } catch (e) { trouble = `a rewrite could not be made: ${e instanceof Error ? e.message.slice(0, 100) : e}`; }
    }
    if (rounds) {
      console.log(`[film] the lyric had ${first.total} words for about ${first.want} — ${now.total === first.total ? "kept as written" : `rewritten to ${now.total}`} after ${rounds} round${rounds === 1 ? "" : "s"}${trouble ? ` (${trouble})` : ""}`);
      fitNote = { words: now.total, want: now.want, was: first.total, rounds, fits: now.off === 0, ...(trouble ? { note: trouble } : {}) };
    }
  }
  let list = (parsed.scenes || []).filter((s) => s && s.visual).slice(0, scenes);
  // WHO SINGS EACH SCENE (a featured verse): the plan the writer was given (featPlan above) — the same
  // rule, dealt again for the scenes that actually came back, so it is the plan even if the writer
  // returned a scene short. The writer's own "singer" marks are not what decides it: when they differed
  // from the plan, the scenes had been WRITTEN to one and were filmed to the other.
  const outRoles = tmpl.lipSyncSinger ? rolesFor(list.length) : [];
  const featIdx = featured.map((n) => castList.indexOf(n));
  const singers: number[] = featured.length ? defaultFeaturePlan(outRoles, sceneSec, featIdx) : list.map(() => -1);
  // FTC backstop (captions are burned on screen): strip an endorsement
  // possessive from a third-party trademark the writer may have slipped in.
  // (a told story's writer marks which of the story's places each scene is set at — read here, before the
  //  scenes are tidied, and folded into the scene's own words at the end: story-picture.ts → placeNamed)
  const saidPlaces = list.map((s) => (typeof (s as { place?: unknown }).place === "string" ? String((s as { place?: unknown }).place) : ""));
  list = list.map((s, i) => ({
    visual: s.visual,
    // (AN ACTED SHOT NOBODY SPEAKS IN has no caption at all — acted-staging.ts → wordless. A horror film's
    //  last shot is written without a line; and a writer that marks one as "(silence)" or "—" instead of
    //  leaving it empty must not have that spoken, or drawn as a caption.)
    caption: s.caption && !(acted && wordless(s.caption)) ? dropOrgEndorsementPossessive(s.caption) : undefined,
    where: typeof s.where === "string" && s.where.trim() ? s.where.trim().slice(0, 120) : undefined,
    // (an ACTED film's writer no longer chooses the camera — acted-staging.ts. Whatever it put here is not
    //  kept, so every beat of a place stays ONE continuous take, as when it was told 'EXACTLY "wide two-shot"';
    //  an angle the maker adds by hand in the storyboard is theirs, and is kept as it always was.)
    shot: !acted && typeof s.shot === "string" && s.shot.trim() ? s.shot.trim().slice(0, 60) : undefined,
    tone: typeof s.tone === "string" && s.tone.trim() ? s.tone.trim().slice(0, 100) : undefined,
    // A music-video scene carries what it was WRITTEN as (performance or cut scene): the role then
    // travels with the scene when the maker reorders or removes scenes, instead of being re-dealt by
    // position — which turned a scene written as a performance into a cut scene.
    ...(tmpl.lipSyncSinger ? { kind: outRoles[i] } : {}),
    ...(featured.length && singers[i] >= 0 ? { singer: castList[singers[i]] } : {}),
  }));
  if (list.length < 1) throw new Error("[film] treatment came back empty");
  // A SPOKEN LINE FITS ITS SHOT (dialogue-fit.ts). The writer is told 15-18 words a line and cannot count:
  // a kids' cartoon set to "≈ 20s · 4 shots" came back with lines of 26-30 words, every shot ran its full
  // ten seconds, and the film was 40 seconds (2026-11-23). The lines are counted; the ones over the limit
  // go back ONCE, each asked for at THREE lengths, and the code picks the one that fits (asked simply for
  // "14 to 18 words" again, the live site got 25, 29 and 26). Any trouble at all and the lines stay as they
  // were written. What happened rides back on the treatment ("lineFit").
  // ONLY THE TWO ON SCREEN SPEAK (dialogue-cast.ts). The writer is told so above and still closed a film on
  // a third character's line — and the grandfather was seen saying the fruit seller's thanks (a film made
  // on the live site, 2026-11-23). A line by anyone who is not one of the two in its place goes back ONCE
  // to be rewritten for one of them; any trouble and the lines stay as they were written. What happened
  // rides back on the treatment ("castFit").
  // A LONG FILM'S LINES ARE CHECKED A PART AT A TIME — each of the two asks below is then the size a whole film's
  // was (both hand every line back, and fifty would not fit the answer), and "the two in its place" are one
  // scene's two. A film written in one answer is one part: the two asks exactly as they were. (The checks are
  // not indented under the function, on purpose: they are as they were written, and read the same in a blame.)
  const script = list;
  if (!spans.length) spans = [[0, script.length]];
  /** one part's lines, checked — and what happened to them */
  const checkPart = async ([from, to]: [number, number]): Promise<{ list: typeof script; castNote: FilmTreatment["castFit"]; lineNote: FilmTreatment["lineFit"] }> => {
  let list = script.slice(from, to);
  let castNote: FilmTreatment["castFit"];
  if (tmpl.dialogue && !narrated) {
    const written = list.map((s) => s.caption || "");
    const wheres = list.map((s) => s.where || "");
    const unseen = unseenLines(written, wheres);
    if (unseen.length) {
      try {
        const raw = await anthropicText(unseenAsk(written, wheres), {
          model: "claude-sonnet-5", maxTokens: 1500,
          jsonSchema: { name: "dialogue_cast", schema: { type: "object", properties: { lines: { type: "array", items: { type: "string" } } }, required: ["lines"], additionalProperties: false } },
        });
        const next = takeSeen(written, (JSON.parse(raw) as { lines?: unknown }).lines, wheres);
        const took = unseen.filter((i) => next[i] !== written[i]);
        console.log(`[film] ${unseen.length} line${unseen.length === 1 ? "" : "s"} spoken by somebody who is not on screen — ${took.length} rewritten for one of the two who are`);
        list = list.map((s, i) => (next[i] && next[i] !== written[i] ? { ...s, caption: next[i] } : s));
        castNote = { unseen: unseen.length, fixed: took.length, ...(took.length < unseen.length ? { note: `${unseen.length - took.length} of ${unseen.length} had no usable rewrite` } : {}) };
      } catch (e) {
        const why = e instanceof Error ? e.message.slice(0, 140) : String(e);
        console.error(`[film] the lines by somebody off screen could not be rewritten, kept as written: ${why}`);
        castNote = { unseen: unseen.length, fixed: 0, note: `a rewrite could not be made: ${why}` };
      }
    }
  }
  let lineNote: FilmTreatment["lineFit"];
  if (tmpl.dialogue && !narrated) {
    const written = list.map((s) => s.caption || "");
    const long = linesTooLong(written);
    if (long.length) {
      try {
        const raw = await anthropicText(fitAsk(written, long), {
          model: "claude-sonnet-5", maxTokens: 1500,
          jsonSchema: { name: "dialogue_fit", schema: { type: "object", properties: { lines: { type: "array", items: { type: "array", items: { type: "string" } } } }, required: ["lines"], additionalProperties: false } },
        });
        const next = takeRewrites(written, long, (JSON.parse(raw) as { lines?: unknown }).lines);
        const took = long.filter((i) => next[i] !== written[i]);
        console.log(`[film] ${long.length} line${long.length === 1 ? "" : "s"} over ${LINE_WORDS_MAX} words (${long.map((i) => saidWords(written[i])).join(", ")}) — ${took.length} rewritten shorter (${took.map((i) => saidWords(next[i])).join(", ") || "none taken"})`);
        list = list.map((s, i) => (next[i] && next[i] !== written[i] ? { ...s, caption: next[i] } : s));
        lineNote = { was: long.map((i) => saidWords(written[i])), now: long.map((i) => saidWords(next[i])), ...(took.length < long.length ? { note: `${long.length - took.length} of ${long.length} had no usable shorter version` } : {}) };
      } catch (e) {
        const why = e instanceof Error ? e.message.slice(0, 140) : String(e);
        console.error(`[film] the long lines could not be rewritten, kept as written: ${why}`);
        lineNote = { was: long.map((i) => saidWords(written[i])), now: long.map((i) => saidWords(written[i])), note: `a rewrite could not be made: ${why}` };
      }
    }
  }
  return { list, castNote, lineNote };
  };
  // (the parts of a long film are checked THREE AT A TIME: each check is one answer of its own, and nine of them
  //  one after another kept the maker waiting minutes longer for a script — while each part's two asks stay in
  //  their order. A film written in one answer is one part, checked exactly as before.)
  const done: Array<Awaited<ReturnType<typeof checkPart>>> = new Array(spans.length);
  let nextPart = 0;
  await Promise.all(Array.from({ length: Math.min(3, spans.length) }, async () => {
    while (nextPart < spans.length) { const k = nextPart++; done[k] = await checkPart(spans[k]); await alive(); }
  }));
  list = done.flatMap((d) => d.list);
  const castNotes = done.map((d) => d.castNote).filter((n): n is NonNullable<FilmTreatment["castFit"]> => !!n);
  const lineNotes = done.map((d) => d.lineNote).filter((n): n is NonNullable<FilmTreatment["lineFit"]> => !!n);
  // (what happened to the whole script: every part's count, and the last thing that went wrong)
  const castNote: FilmTreatment["castFit"] = castNotes.length
    ? { unseen: castNotes.reduce((n, c) => n + c.unseen, 0), fixed: castNotes.reduce((n, c) => n + c.fixed, 0), ...(castNotes.some((c) => c.note) ? { note: castNotes.filter((c) => c.note).map((c) => c.note).pop() } : {}) }
    : undefined;
  const lineNote: FilmTreatment["lineFit"] = lineNotes.length
    ? { was: lineNotes.flatMap((l) => l.was), now: lineNotes.flatMap((l) => l.now), ...(lineNotes.some((l) => l.note) ? { note: lineNotes.filter((l) => l.note).map((l) => l.note).pop() } : {}) }
    : undefined;
  const cast = Array.isArray(parsed.cast) ? parsed.cast.filter((c) => typeof c === "string" && c.trim()).slice(0, 5) : undefined;
  // AN ACTED FILM'S CHOSEN THREAT IS NEVER ONE OF ITS CAST, whatever the writer returned (premise-rules.ts →
  // chosenThreat): the film puts its cast in every shot, so a werewolf left in "cast" stands beside the boy
  // from the first shot. Taken out here; it is seen where the shots' own words put it.
  if (actedThreat && cast) {
    const named = (e: string) => (e.split(/[,—:–(]/)[0] || "").trim().toLowerCase();
    const kept = cast.filter((e) => !threatNames.some((n) => named(e) === n.trim().toLowerCase()));
    if (kept.length !== cast.length) {
      console.log(`[film] the chosen threat (${threatNames.join(", ")}) was in the cast — taken out: the film's two are ${kept.map((e) => named(e)).join(" and ") || "nobody"}`);
      cast.splice(0, cast.length, ...kept);
    }
  }
  // …AND IT IS SEEN AT THE END: the fourth live preview's last shot was the two running into the parents' room —
  // the werewolf the maker chose was never in the film at all. A last shot whose words do not name it has it
  // added the way THE LAST SHOT shows a thing (acted-staging.ts → SEEN_AT_THE_END): in the dark behind them, only
  // its face in the light. The reveal then draws it from its own picture (film-dialogue → the chosen creature).
  if (actedThreat && list.length) {
    const lastAt = list.length - 1;
    const said = String(list[lastAt].visual || "");
    if (!threatNames.some((n) => said.toLowerCase().includes(n.trim().toLowerCase()))) {
      list[lastAt] = { ...list[lastAt], visual: `${said.replace(/[\s.;,]+$/, "")}; in the dark behind them, ${threatNames[0]} is there — a tall shape, only its face in the light` };
      console.log(`[film] the chosen threat (${threatNames[0]}) was not in the last shot — it is found there now`);
    }
  }
  // THE TITLE, MADE SURE OF (acted-staging.ts → ownTitle). The schema's "required" is not enforced on a forced
  // tool call: a Horror Film made on the live site, 2026-11-24, came back with no title of its own and was
  // called after its idea ("Two sisters clearing out their late mother's house at…") — the one made from the
  // same idea before it was "The Knock She Kept". A missing title, or the idea handed back as one, is asked for
  // once more on its own (a story format only — a song names itself its own way); still none, and the idea
  // stands in as before.
  parsed.title = ownTitle(parsed.title, topic) || undefined;
  if (!parsed.title && storyFormat && list.length) {
    try {
      const raw = await anthropicText(titleAsk({ idea: topic, scenes: list, language: langName }), {
        model: "claude-sonnet-5", maxTokens: 120,
        jsonSchema: { name: "film_title", schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false } },
      });
      parsed.title = ownTitle((JSON.parse(raw) as { title?: unknown }).title, topic) || undefined;
      console.log(`[film] the writer gave the story no title of its own — asked again: ${parsed.title ? `"${parsed.title}"` : "still none, the idea stands in"}`);
    } catch (e) {
      console.error(`[film] the title could not be asked for — the idea stands in: ${e instanceof Error ? e.message.slice(0, 140) : e}`);
    }
  }
  let outTitle = (parsed.title || topic || tmpl.name).slice(0, 80);
  // NAME ENFORCEMENT (robust). The writer keeps inventing stage names (Kai Monroe, Wyatt, Vex, Dalla…)
  // despite being told the EXACT names. So read the name it ACTUALLY used for each cast slot (the leading
  // token of that cast description) and HARD-SUBSTITUTE it with the provided name across the whole
  // treatment — the only thing that reliably kills "AI slop" names + lets the per-scene cast match.
  // (a chosen creature that is an acted film's THREAT has no cast entry — premise-rules.ts → chosenThreat — so it
  //  is not one of the names the cast is held to: matched by place, the boy in the first entry was renamed after it)
  const castPicked = castChosen;
  if (cast && cast.length && (artistName || castNames.length || castPicked.length)) {
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const subs: Array<{ from: string; to: string }> = [];
    cast.forEach((desc, i) => {
      const want = castPicked.length ? castPicked[i]?.name : i === 0 ? artistName : castNames[i - 1];
      if (!want) return;
      const used = (desc.split(/[,—:–(-]/)[0] || "").trim();
      // Only treat the leading token as a name to swap if it LOOKS like one (1-3 capitalised words) and differs.
      if (used && used !== want && used.length <= 40 && /^\p{Lu}[\p{L}.'-]*(?:\s+\p{Lu}[\p{L}.'-]*){0,2}$/u.test(used)) subs.push({ from: used, to: want });
    });
    if (subs.length) {
      const apply = (txt?: string): string => { let o = txt || ""; for (const s of subs) o = o.replace(new RegExp(`\\b${esc(s.from)}\\b`, "g"), s.to); return o; };
      list = list.map((s) => ({ ...s, visual: apply(s.visual), caption: s.caption ? apply(s.caption) : undefined }));
      for (let i = 0; i < cast.length; i++) cast[i] = apply(cast[i]);
      outTitle = apply(outTitle);
    }
  }
  // PEOPLE WHO ARE RELATED ARE THE RIGHT AGES FOR IT (acted-staging.ts → castAgeProblem) — told above, and
  // CHECKED here, on the cast as it now stands: a cast of two whom the idea, the lines or the cast make related
  // (sisters, a mother and her daughter…) and whose stated ages break it is asked for once more; when that does
  // not put it right, only one of them's AGE WORDS are said again where the relation puts them (repairAges).
  // Never filmed as written: the pictures are drawn from these words (the owner: "they are "sisters" but one of
  // them is 130 and the other looks 30" — the cast had read "in her fifties" and "in her thirties").
  // Only a cast the WRITER invented: people the maker picked are drawn from their own photos (film-dialogue
  // keeps the written look of anybody with a cast photo out of every prompt), and their ages are the maker's.
  let ageNote: FilmTreatment["ageFit"];
  if (storyFormat && !castPicked.length && cast && cast.length === 2) {
    const spoken = list.map((s) => s.caption || "");
    const problem = castAgeProblem({ idea: topic, cast, lines: spoken });
    if (problem) {
      let fixed: string[] | null = null;
      try {
        const raw = await anthropicText(ageAsk(cast, problem), {
          model: "claude-sonnet-5", maxTokens: 600,
          jsonSchema: { name: "cast_ages", schema: { type: "object", properties: { cast: { type: "array", items: { type: "string" } } }, required: ["cast"], additionalProperties: false } },
        });
        fixed = takeAgeFix(cast, (JSON.parse(raw) as { cast?: unknown }).cast, { idea: topic, lines: spoken });
      } catch (e) {
        console.error(`[film] the cast's ages could not be asked for again — put right here: ${e instanceof Error ? e.message.slice(0, 140) : e}`);
      }
      const how: "rewritten" | "repaired" = fixed ? "rewritten" : "repaired";
      const now = fixed || repairAges(cast, problem);
      for (let i = 0; i < cast.length; i++) cast[i] = now[i];
      ageNote = { relation: problem.relation, was: problem.ages.map((a) => a.said), now: now.map((e) => ageOf(e)?.said || ""), how };
      console.log(`[film] the cast are ${AGE_RULES[problem.relation].says} but were written "${problem.ages[0].said}" and "${problem.ages[1].said}" — ${how}: "${ageNote.now.join('" and "')}"`);
    }
  }
  // ONE CAR, the same in every scene it is in (mv-sense.ts sameCar): each picture is drawn from its own
  // scene's words, and "the Mustang convertible" two scenes after "a black 1969 Mustang convertible" was
  // drawn red.
  if (tmpl.lipSyncSinger) {
    const carried = sameCar(list.map((s) => s.visual));
    list = list.map((s, i) => ({ ...s, visual: carried[i] || s.visual }));
    // …and ONE TIME OF DAY, said in every scene (mv-sense.ts sameTime): a scene whose words left it out
    // was drawn at sunset in a night video
    const timed = sameTime(list.map((s) => s.visual));
    list = list.map((s, i) => ({ ...s, visual: timed[i] || s.visual }));
  }
  // THE STAR TELLS IT: the words are "I", the pictures are still drawn from a NAME (character-series.ts)
  if (teller) list = list.map((s) => ({ ...s, visual: tellerVisual(s.visual, teller) }));
  // THE SHOT PLAN: each scene keeps how it is seen — the picture and its motion are made to it
  // (…or the way its own words say it is seen, when the writer wrote it as another line of the plan: the sofa
  //  scene "Wide shot of the living room…" was tagged "over the shoulder" and drawn with a dark figure looming
  //  in front — story-shots.ts → shotInWords)
  if (camPlan.length) list = list.map((s, i) => { const cam = shotInWords(s.visual) ?? camPlan[i]; return cam ? { ...s, cam } : s; });
  // an episode is called "<Series> — Episode <N>" (the writer's short episode name may follow a colon)
  // (the WRITER'S OWN title only: with none, an episode is just "<Series> — Episode <N>". It used to borrow
  //  the idea box or the format's name — an episode made from an empty idea box was "… Episode 2: Short Film")
  if (series) outTitle = episodeTitle(series.title, series.episode, parsed.title ? outTitle : "");
  // A TOLD STORY'S PLACES (story-picture.ts): two at most, each "name: look", as the writer gave them
  const listed = narrated && Array.isArray(parsed.places)
    ? parsed.places.filter((p): p is string => typeof p === "string").map((p) => p.replace(/\s+/g, " ").trim().slice(0, 400)).filter((p) => p.length > 12).slice(0, 2)
    : [];
  // …and THE SERIES' OWN PLACES are kept whether or not this episode's writer listed them: a place of the
  // series that these scenes name is listed under its own name and words, so it is drawn from its own sheet
  // (story-picture.ts → inheritPlaces: an episode 2 named "the clock tower" five times and listed nothing)
  let places = narrated ? inheritPlaces(listed, series?.places || [], list.map((s) => s.visual)) : [];
  let placeMarks = saidPlaces;
  // THE WRITER LISTED NO PLACE: it is asked again, about nothing else (story-picture.ts → placesAsk). One
  // short question, only then; a story it cannot be answered for is drawn from its words, as before.
  if (narrated && !places.length && list.length >= 3 && process.env.STORY_PLACES !== "off") {
    try {
      const raw = await anthropicText(placesAsk(list.map((s) => s.visual)), {
        model: "claude-sonnet-5", maxTokens: 600,
        jsonSchema: { name: "story_places", schema: { type: "object", properties: { places: { type: "array", items: { type: "string" } }, scenes: { type: "array", items: { type: "string" } } }, required: ["places", "scenes"], additionalProperties: false } },
      });
      const asked = takePlaces(JSON.parse(raw), list.length);
      console.log(`[film] the writer listed no place — asked again: ${asked.places.length ? asked.places.map((p) => p.split(":")[0]).join(", ") : "none shared by two pictures"}`);
      if (asked.places.length) { places = asked.places; placeMarks = asked.marks; }
    } catch (e) {
      console.error(`[film] the places could not be asked for, the story is drawn from its words: ${e instanceof Error ? e.message.slice(0, 140) : e}`);
    }
  }
  // …and a scene set at one of them says so in its own words ("At the ferry: …") when they did not already
  if (places.length) list = list.map((s, i) => ({ ...s, visual: placeNamed(s.visual, placeMarks[i], places) }));
  // (what it was dealt, so the maker's next story is dealt something else)
  const dealt = fresh ? { hook: fresh.hook, ...Object.fromEntries(freshKeys(series ? null : fresh).map((k) => k.split(":"))) } : null;
  // (an acted film written here says so: its scenes' VISUALs are things that HAPPEN, and each clip is told its own)
  // (…and the starter it was written from, when the maker gave no idea of their own — film-genres.ts → nudgeFor)
  // (…and a long film says how it was planned: `acts` — film-length.ts)
  return { title: outTitle, scenes: list, ...(nudged ? { nudge: nudged.nudge } : {}), ...(acts ? { acts } : {}), ...(ageNote ? { ageFit: ageNote } : {}), musicMood: parsed.musicMood || tmpl.musicHint, ...(acted ? { events: true } : {}), ...(dealt ? { fresh: dealt } : {}), ...(places.length ? { places } : {}), cast, ...(lineNote ? { lineFit: lineNote } : {}), ...(castNote ? { castFit: castNote } : {}), ...(fitNote ? { lyricFit: fitNote } : {}) };
}

// ---- Assembly ---------------------------------------------------------------
/** Concatenate the per-scene clips into one 720x1280 video, lay audio under it
 *  (a narrator VO as the primary track with music ducked beneath, or music
 *  alone), and burn each scene's caption over its own clip window. Degrade
 *  ladder: full → drop captions → drop music → silent — every rung a complete,
 *  independently-valid graph, so a drawtext/mix hiccup falls back instead of
 *  killing a paid render. */
async function assembleFilm(opts: {
  clips: string[]; captions: (string | undefined)[]; musicPath: string | null; musicIsSung?: boolean; voPath?: string | null; fontFile: string; outPath: string; jobId?: string;
}): Promise<void> {
  const beat = async () => { if (opts.jobId) await checkpointJob(opts.jobId, { ckBeat: Date.now() }); };
  const N = opts.clips.length;
  if (!N) throw new Error("[film] no clips to assemble");

  // Per-clip real durations → caption windows + the total runtime.
  const durs = opts.clips.map((c) => { const d = ffprobeDuration(c); return d > 0.3 ? d : CLIP_SECONDS; });
  const total = durs.reduce((a, b) => a + b, 0);
  const starts: number[] = [];
  durs.reduce((acc, d, i) => { starts[i] = acc; return acc + d; }, 0);
  const hasVo = !!opts.voPath && fs.existsSync(opts.voPath);
  const hasMusic = !!opts.musicPath && fs.existsSync(opts.musicPath);
  const font = opts.fontFile.replace(/\\/g, "/").replace(/:/g, "\\:");
  const fadeAt = Math.max(0, total - 1.5).toFixed(2);

  const buildArgs = (useCaptions: boolean, useVo: boolean, useMusic: boolean): string[] => {
    const a: string[] = ["-y"];
    // (ONE DECODING THREAD A CLIP — 2026-11-25: a Kids Music Video is up to eight Full-HD clips in this one ffmpeg; at a
    //  16-core host's thread counts, measured on TEST stand-ins, 469 MB with every decoder sized to the cores, 319 MB
    //  with one thread each, in the same time — the clips are played one after another anyway)
    opts.clips.forEach((c) => a.push("-threads", "1", "-i", c));
    const voOn = useVo && hasVo;
    const musicOn = useMusic && hasMusic;
    let idx = N;
    let voIdx = -1, musicIdx = -1;
    if (voOn) { voIdx = idx++; a.push("-i", opts.voPath!); }
    if (musicOn) { musicIdx = idx++; a.push("-stream_loop", "-1", "-i", opts.musicPath!); }

    const f: string[] = [];
    const labels: string[] = [];
    opts.clips.forEach((_, i) => {
      f.push(`[${i}:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30[c${i}]`);
      labels.push(`[c${i}]`);
    });
    f.push(`${labels.join("")}concat=n=${N}:v=1:a=0[vcat]`);

    let vLabel = "[vcat]";
    if (useCaptions) {
      const draws: string[] = [];
      opts.captions.forEach((cap, i) => {
        if (i >= opts.clips.length) return; // a dropped scene left fewer clips than captions — skip the orphan line
        const text = captionSafe(cap || "");
        if (!text) return;
        // Word-wrap so a long narration/lyric line never runs off both frame
        // edges (the old single-line sizing overflowed on anything long).
        const MAXCH = 22, FS = 40, LINE_H = 52;
        const lines: string[] = [];
        let cur = "";
        for (const w of text.split(" ")) {
          if (cur && (cur.length + 1 + w.length) > MAXCH) { lines.push(cur); cur = w; }
          else cur = cur ? `${cur} ${w}` : w;
        }
        if (cur) lines.push(cur);
        const t0 = starts[i].toFixed(2);
        const t1 = (starts[i] + durs[i]).toFixed(2);
        // Stack the wrapped lines, bottom-anchored above the lower third.
        lines.forEach((ln, li) => {
          const y = `h-300-${(lines.length - 1 - li) * LINE_H}`;
          draws.push(
            `drawtext=expansion=none:fontfile='${font}':text='${ln}':fontsize=${FS}:fontcolor=white:` +
            `borderw=7:bordercolor=black:x=(w-text_w)/2:y=${y}:enable='gte(t,${t0})*lt(t,${t1})'`
          );
        });
      });
      if (draws.length) { f.push(`[vcat]${draws.join(",")}[vf]`); vLabel = "[vf]"; }
    }

    const graph = [...f];
    let aMap: string | null = null;
    if (voOn && musicOn) {
      graph.push(`[${voIdx}:a]atrim=0:${total.toFixed(2)},volume=1.0[vo]`);
      graph.push(`[${musicIdx}:a]atrim=0:${total.toFixed(2)},volume=0.20,afade=t=out:st=${fadeAt}:d=1.5[bg]`);
      graph.push(`[vo][bg]amix=inputs=2:duration=first:dropout_transition=0[aout]`);
      aMap = "[aout]";
    } else if (voOn) {
      graph.push(`[${voIdx}:a]atrim=0:${total.toFixed(2)},volume=1.0[aout]`);
      aMap = "[aout]";
    } else if (musicOn) {
      // A sung song IS the track (vocals + music) → play it loud; an instrumental
      // bed sits quieter under the visuals.
      const mvol = opts.musicIsSung ? "0.95" : "0.7";
      graph.push(`[${musicIdx}:a]atrim=0:${total.toFixed(2)},volume=${mvol},afade=t=out:st=${fadeAt}:d=1.5[aout]`);
      aMap = "[aout]";
    }

    a.push("-filter_complex", graph.join(";"), "-map", vLabel);
    if (aMap) a.push("-map", aMap);
    a.push(
      "-t", total.toFixed(2),
      "-threads", "2", "-filter_complex_threads", "2",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
      opts.outPath,
    );
    return a;
  };

  const produced = (): boolean => { try { return fs.existsSync(opts.outPath) && ffprobeDuration(opts.outPath) > 1; } catch { return false; } };
  // Narrated → protect the VO (it's the story): drop captions, then music, but
  // keep VO until the last silent rung. Non-narrated → the music path.
  const rungs: Array<[cap: boolean, vo: boolean, mus: boolean]> = hasVo
    ? [[true, true, true], [false, true, true], [false, true, false], [false, false, false]]
    : [[true, false, true], [false, false, true], [false, false, false]];
  await beat();
  let lastErr = "";
  for (const [cap, vo, mus] of rungs) {
    const run = await runFfmpeg(buildArgs(cap, vo, mus));
    if (run.status === 0 && produced()) return;
    lastErr = (run.stderr || "").slice(-240);
    await beat();
  }
  throw new Error(`[film] ffmpeg failed after ${rungs.length} rungs: ${lastErr}`);
}

/** Turn a still (disk path) into a short static clip — the per-scene fallback so
 *  one failed i2v render still fills its beat instead of dropping a paid scene. */
async function stillToClip(stillPath: string, outPath: string): Promise<boolean> {
  try {
    const r = await runFfmpeg([
      "-y", "-loop", "1", "-t", String(CLIP_SECONDS), "-i", stillPath,
      "-vf", "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", outPath,
    ]);
    return r.status === 0 && fs.existsSync(outPath) && ffprobeDuration(outPath) > 1;
  } catch { return false; }
}

/** FREE pre-seed PREVIEW for the generateFilm engine (sung / narrated formats — Kids Music Video and
 *  the story genres): render each scene's SEED still (cast-locked, same as the render) WITHOUT the
 *  video, so the owner checks accuracy + fixes a bad scene before paying. Mirrors generateFilm's seed
 *  phase (one cast sheet → per-scene renderStyledSeed) — keep in sync. Returns the stills + treatment
 *  + the cast ref (so a single scene can be re-rolled against the same cast). */
/** ONE SCENE'S STILL for the story engine (film-cast-sheet.ts):
 *   · a film with a product → drawn from the product photo, with the prompt it always had;
 *   · a film with a cast sheet → drawn FROM the sheet, and told the sheet is its cast;
 *   · neither (the sheet could not be made) → the cast in words, in full.
 *  Each falls back to a picture from words alone, so a scene is never left bare. */
async function sceneSeed(o: { tmpl: FilmTemplate; safe: string; visual: string; where?: string; cast: string[]; castSheet?: string; productRef?: string; productPrompt: string }): Promise<string | null> {
  if (o.productRef) return (await renderStyledSeed(o.productPrompt, o.productRef, "9:16")) || (await renderCreativeSeed(o.productPrompt, "9:16"));
  const inWords = sceneInWordsPrompt({ safe: o.safe, visual: o.visual, where: o.where, cast: o.cast, style: o.tmpl.sceneHint });
  if (o.castSheet) return (await renderStyledSeed(sceneFromSheetPrompt({ safe: o.safe, visual: o.visual, where: o.where, cast: o.cast, style: o.tmpl.sceneHint }), o.castSheet, "9:16", SCENE_PROMPT_MAX)) || (await renderCreativeSeed(inWords, "9:16", SCENE_PROMPT_MAX));
  return renderCreativeSeed(inWords, "9:16", SCENE_PROMPT_MAX);
}

export async function previewFilmSceneSeeds(opts: {
  shopId: string; template?: string; topic?: string; sceneCount?: number; treatment?: FilmTreatment;
  product?: { title?: string; imageUrl?: string; description?: string };
}): Promise<{ treatment: FilmTreatment; sceneImgs: (string | null)[]; castRef: string | null }> {
  const tmpl = filmTemplate(opts.template);
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const abs = (u: string | null | undefined): string | null => (u ? (u.startsWith("http") ? u : `${base}${u}`) : null);

  let treatment: FilmTreatment = opts.treatment && opts.treatment.scenes?.length
    ? opts.treatment
    : await previewFilmTreatment({ shopId: opts.shopId, template: tmpl.key, topic: opts.topic, sceneCount: opts.sceneCount, productTitle: opts.product?.title, productDescription: opts.product?.description });
  treatment.scenes = treatment.scenes.slice(0, clampScenes(tmpl, opts.sceneCount ?? treatment.scenes.length));

  const castBible = treatment.cast && treatment.cast.length ? `Recurring cast, keep EVERY character identical in every scene: ${treatment.cast.join("; ")}.` : "";
  const safePhrase = tmpl.childSafe ? "Wholesome, child-safe, G-rated, bright and friendly. " : "";
  const product = opts.product && opts.product.imageUrl ? opts.product : undefined;
  const productAbs = product?.imageUrl ? abs(product.imageUrl) : undefined;
  const productLine = productAbs && product ? ` The scene features this exact product: ${(product.title || "the product").slice(0, 80)}.${PRODUCT_TRUTH}` : "";

  // One cast sheet, conditioned per scene (character-locked templates without a product) — same seed
  // path the render uses, so the previewed stills match what will render.
  let castRefAbs: string | undefined;
  if (tmpl.referenceSeed && castBible && !productAbs) {
    const castRef = await renderCreativeSeed(castSheetPrompt({ safe: safePhrase, cast: treatment.cast || [], style: tmpl.sceneHint }), "9:16", SHEET_PROMPT_MAX).catch(() => null);
    if (castRef) castRefAbs = abs(castRef) || undefined;
  }
  const refAbs = productAbs || castRefAbs;

  const N = treatment.scenes.length;
  const sceneImgs: (string | null)[] = new Array(N).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < N) {
      const i = next++;
      const scene = treatment.scenes[i];
      const seedPrompt = `${safePhrase}${scene.visual}. ${castBible}${productLine} ${tmpl.sceneHint}. Richly detailed, high quality.`;
      let seedUrl: string | null = null;
      for (let a = 0; a < 2 && !seedUrl; a++) {
        try { seedUrl = await sceneSeed({ tmpl, safe: safePhrase, visual: scene.visual, where: scene.where, cast: treatment.cast || [], castSheet: productAbs ? undefined : castRefAbs, productRef: productAbs || undefined, productPrompt: seedPrompt }); } catch { /* retry once */ }
      }
      sceneImgs[i] = abs(seedUrl);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, N) }, () => worker()));

  return { treatment, sceneImgs, castRef: castRefAbs || null };
}

/** Re-roll ONE generateFilm scene seed (reusing the cast ref so characters stay consistent) — the
 *  story-engine counterpart of rerollMusicVideoScene. */
export async function rerollFilmSceneSeed(opts: {
  template?: string; sceneVisual: string; castRef?: string;
  /** the film's cast in the writer's words, and where this scene is — so a re-rolled scene is told who is
   *  who and where, exactly as a first-drawn one is (film-cast-sheet.ts) */
  cast?: string[]; where?: string;
}): Promise<string | null> {
  const tmpl = filmTemplate(opts.template);
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const abs = (u: string | null | undefined): string | null => (u ? (u.startsWith("http") ? u : `${base}${u}`) : null);
  const safePhrase = tmpl.childSafe ? "Wholesome, child-safe, G-rated, bright and friendly. " : "";
  const refAbs = opts.castRef ? abs(opts.castRef) : null;
  const seedPrompt = `${safePhrase}${opts.sceneVisual}. ${tmpl.sceneHint}. Richly detailed, high quality.`;
  let seedUrl: string | null = null;
  for (let a = 0; a < 2 && !seedUrl; a++) {
    try { seedUrl = refAbs ? ((await renderStyledSeed(sceneFromSheetPrompt({ safe: safePhrase, visual: opts.sceneVisual, where: opts.where, cast: opts.cast, style: tmpl.sceneHint }), refAbs, "9:16", SCENE_PROMPT_MAX)) || (await renderCreativeSeed(seedPrompt, "9:16"))) : await renderCreativeSeed(seedPrompt, "9:16"); } catch { /* retry once */ }
  }
  return abs(seedUrl);
}

// ---- The engine -------------------------------------------------------------
export async function generateFilm(opts: {
  shopId: string;
  template?: string;
  topic?: string;
  /** Merchant-approved treatment from the free preview — rendered VERBATIM. */
  treatment?: FilmTreatment;
  sceneCount?: number;
  /** Product templates (skit): the real product to keep pin-sharp in every scene. */
  product?: { title?: string; imageUrl?: string; description?: string };
  section?: string;
  jobId?: string;
  /** Owner PREVIEWED + approved these per-scene seed stills — render them, don't re-seed (no surprise). */
  approvedSceneImgs?: (string | null)[];
  resume?: { ckTreatment?: string; ckCastRef?: string; ckClips?: string[]; ckMusic?: string; ckVo?: string };
}): Promise<string> {
  const tmpl = filmTemplate(opts.template);
  const jobId = opts.jobId;
  const resume = opts.resume || {};
  const ckpt = async (patch: Record<string, unknown>) => { if (jobId) await checkpointJob(jobId, patch); };
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");

  // 1) TREATMENT — the merchant-approved one wins; else the checkpoint; else write one.
  let treatment: FilmTreatment;
  if (resume.ckTreatment) treatment = JSON.parse(resume.ckTreatment);
  else if (opts.treatment && opts.treatment.scenes?.length) treatment = opts.treatment;
  else treatment = await previewFilmTreatment({ shopId: opts.shopId, template: tmpl.key, topic: opts.topic, sceneCount: opts.sceneCount, productTitle: opts.product?.title, productDescription: opts.product?.description });
  treatment.scenes = treatment.scenes.slice(0, clampScenes(tmpl, opts.sceneCount ?? treatment.scenes.length));
  await ckpt({ ckTreatment: JSON.stringify(treatment) });

  const castBible = treatment.cast && treatment.cast.length ? `Recurring cast, keep EVERY character identical in every scene: ${treatment.cast.join("; ")}.` : "";
  const safePhrase = tmpl.childSafe ? "Wholesome, child-safe, G-rated, bright and friendly. " : "";

  // PRODUCT (skit): the real product photo takes the image-conditioning slot.
  const product = opts.product && opts.product.imageUrl ? opts.product : undefined;
  const productAbs = product?.imageUrl ? (product.imageUrl.startsWith("http") ? product.imageUrl : `${base}${product.imageUrl}`) : undefined;
  const productLine = productAbs && product ? ` The scene features this exact product: ${(product.title || "the product").slice(0, 80)}.${PRODUCT_TRUTH}` : "";

  // CAST REFERENCE (character-locked templates WITHOUT a product): render ONE
  // cast sheet up front and condition every scene on it. Checkpointed; fail-open.
  let castRefAbs: string | undefined;
  if (tmpl.referenceSeed && castBible && !productAbs) {
    let castRef: string | null = resume.ckCastRef && resume.ckCastRef.trim() ? resume.ckCastRef : null;
    if (!castRef) {
      // The reference must be in the TEMPLATE'S style (photoreal for stories,
      // 3D-cartoon for kids) — the old "character-design sheet" wording made
      // nano-banana draw a flat illustration, so scenes built on it came out
      // cartoonish while the text-fallback scenes came out photoreal → one video,
      // two clashing looks. Lead with the scene style and lock it.
      try { castRef = await renderCreativeSeed(castSheetPrompt({ safe: safePhrase, cast: treatment.cast || [], style: tmpl.sceneHint }), "9:16", SHEET_PROMPT_MAX); }
      catch { castRef = null; }
      if (castRef) await ckpt({ ckCastRef: castRef });
    }
    if (castRef) castRefAbs = castRef.startsWith("http") ? castRef : `${base}${castRef}`;
  }

  // 2) PER-SCENE CLIPS — seed still → i2v clip (default engine), rendered in
  //    BOUNDED PARALLEL. THE BIG SPEED WIN: sequential i2v made a 6-scene film
  //    take 30-45 min (six clips one after another). Each scene is independent
  //    (it shares the cast/product reference computed above), so they fan out —
  //    a film now renders in roughly one wave's time instead of the sum. The
  //    per-clip fallback (static seed-clip → neutral frame) is unchanged; a scene
  //    that can't produce even a neutral frame throws → terminal fail → refund.
  //    Checkpointed once at the end: a worker restart re-renders, which is cheap
  //    now that a whole render is minutes, not the stale per-clip bank.
  const refAbs = productAbs || castRefAbs; // product fidelity wins the conditioning slot
  const CLIP_CONCURRENCY = 4; // bounded so we don't trip the provider's rate limit
  const clips: string[] = (resume.ckClips || []).filter((p) => p && fs.existsSync(p));

  const renderScene = async (i: number): Promise<string> => {
    const scene = treatment.scenes[i];
    const outPath = path.join(RENDERS(), `film-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp4`);
    const seedPrompt = `${safePhrase}${scene.visual}. ${castBible}${productLine} ${tmpl.sceneHint}. Richly detailed, high quality.`;

    // An owner-approved storyboard still wins (render EXACTLY what was previewed); else seed fresh.
    let seedUrl: string | null = opts.approvedSceneImgs?.[i] ?? null;
    for (let a = 0; a < 2 && !seedUrl; a++) {
      try {
        seedUrl = await sceneSeed({ tmpl, safe: safePhrase, visual: scene.visual, where: scene.where, cast: treatment.cast || [], castSheet: productAbs ? undefined : castRefAbs, productRef: productAbs || undefined, productPrompt: seedPrompt });
      } catch { /* retry once */ }
    }
    const seedAbs = seedUrl ? (seedUrl.startsWith("http") ? seedUrl : `${base}${seedUrl}`) : undefined;

    let made = false;
    if (seedAbs) {
      // (sung-fit.ts MOTION_KEEPS_CAST: a duckling that "leaps into a puddle" sank into it and was gone)
      const motion = `${safePhrase}${MOTION_KEEPS_CAST}${tmpl.childSafe ? MOTION_GENTLE : ""}${scene.visual}. ${castBible}${productLine} ${tmpl.sceneHint}. Smooth, confident cinematic camera motion, vertical 9:16. Add no text, caption, logo or watermark of your own.`;
      for (let a = 0; a < 2 && !made; a++) {
        try {
          const created = await animateCreate(undefined, { startImage: seedAbs, prompt: motion, negativePrompt: MOTION_NEGATIVE, durationSec: CLIP_SECONDS });
          const clipUrl = await animatePoll(created.id, CLIP_POLL_MS, `film-clip-${i}`);
          await download(clipUrl, outPath);
          made = fs.existsSync(outPath) && ffprobeDuration(outPath) > 1;
        } catch { if (a < 1) await new Promise((r) => setTimeout(r, 1500)); }
      }
      if (!made && seedUrl) {
        const stillDisk = path.join(RENDERS(), path.basename(seedUrl.split("?")[0]));
        if (fs.existsSync(stillDisk)) made = await stillToClip(stillDisk, outPath);
      }
    }
    if (!made) {
      const neutral = path.join(RENDERS(), `bg-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.jpg`);
      try {
        const c = await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=0x14201A:s=720x1280", "-frames:v", "1", neutral]);
        if (c.status === 0 && fs.existsSync(neutral)) made = await stillToClip(neutral, outPath);
      } catch { /* fall through */ }
    }
    if (!made) throw new Error(`[film] scene ${i + 1} could not render`);
    await ckpt({ ckBeat: Date.now() }); // heartbeat so a multi-clip render can't near the reaper
    return outPath;
  };

  if (clips.length < treatment.scenes.length) {
    // Keep any resumed clips by scene index; fan the rest out, bounded.
    const results: (string | undefined)[] = treatment.scenes.map((_, i) => clips[i]);
    const todo: number[] = [];
    for (let i = 0; i < treatment.scenes.length; i++) if (!results[i]) todo.push(i);
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const idx = todo[next++];
        // Resilient: a single scene that can't render (a refused horror seed, a
        // rate-limit, a provider hiccup) is DROPPED, not fatal — the film
        // assembles from the scenes that DID make it. Only an all-scenes-failed
        // render throws (→ refund). One bad clip no longer sinks the whole video.
        try { results[idx] = await renderScene(idx); }
        catch (e) { console.error(`[film] scene ${idx + 1} failed — dropping it:`, e instanceof Error ? e.message.slice(0, 160) : e); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CLIP_CONCURRENCY, todo.length) }, () => worker()));
    clips.length = 0;
    for (let i = 0; i < treatment.scenes.length; i++) { const c = results[i]; if (c) clips.push(c); }
    await ckpt({ ckClips: clips });
  }
  if (!clips.length) throw new Error("[film] no scenes rendered");

  // 3) AUDIO TRACK. Sung templates (music video, kids cartoon) get a real SUNG
  //    song from the scene lyric lines (the Anthem singing engine); everything
  //    else gets an instrumental bed. Best-effort — ships silent rather than fail.
  let musicPath: string | null = resume.ckMusic && fs.existsSync(resume.ckMusic) ? resume.ckMusic : null;
  let musicIsSung = !!(tmpl.sung && musicPath); // a resumed sung track
  if (!musicPath && tmpl.sung) {
    const lyrics = treatment.scenes.map((s) => (s.caption || "").trim()).filter(Boolean).join("\n");
    if (lyrics) {
      try { musicPath = await singToDisk(lyrics, `${treatment.musicMood || tmpl.musicHint}, clear vocals`); musicIsSung = true; await ckpt({ ckMusic: musicPath }); }
      catch (e) { console.error("[film] singing failed (falling back to instrumental):", (e as Error).message); }
    }
  }
  if (!musicPath) {
    try { musicPath = await musicBedToDisk(`${treatment.musicMood || tmpl.musicHint}, instrumental, loopable`); await ckpt({ ckMusic: musicPath }); }
    catch (e) { console.error("[film] music failed (continuing silent):", (e as Error).message); musicPath = null; }
  }

  // 3b) NARRATOR VOICEOVER (narrated templates — Dhar Mann). One MiniMax read of
  //     the per-scene narration lines; it becomes the primary audio, music ducked
  //     under. Best-effort: ships music-only on failure. (True character dialogue
  //     is the planned next upgrade — the scene-audio engine fork.)
  let voPath: string | null = resume.ckVo && fs.existsSync(resume.ckVo) ? resume.ckVo : null;
  if (tmpl.narrated && !voPath) {
    const narration = treatment.scenes.map((s) => (s.caption || "").trim()).filter(Boolean).join(" ").slice(0, 2500);
    if (narration) {
      try {
        let voUrl = "";
        // (the narrator reads the language the story was written in: the shop's)
        const voLang = voiceLangOpts((await db.shop.findUnique({ where: { id: opts.shopId }, select: { contentLang: true } }))?.contentLang);
        try { voUrl = await repPoll(await repCreate("minimax/speech-02-hd", { text: narration, voice_id: NARRATOR_VOICE, ...voLang }), 3 * 60_000, "film-vo"); }
        catch { voUrl = await repPoll(await repCreate("minimax/speech-02-turbo", { text: narration, voice_id: NARRATOR_VOICE, ...voLang }), 3 * 60_000, "film-vo"); }
        const buf = await downloadBuffer(voUrl);
        if (buf.length > 8_000) {
          const voName = `filmvo-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp3`;
          const vp = path.join(RENDERS(), voName);
          fs.writeFileSync(vp, buf);
          try { await mirrorRender(voName, buf); } catch { /* non-fatal */ }
          voPath = vp;
          await ckpt({ ckVo: voPath });
        }
      } catch (e) { console.error("[film] narrator VO failed (continuing music-only):", (e as Error).message); voPath = null; }
    }
  }

  // 4) ASSEMBLE → one 720x1280 MP4.
  let fontFile = path.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");
  // (the resolver only fails for words Poppins cannot draw — Chinese with no font fetched: the film is
  //  then cut without its words. Drawing them with Poppins made every caption a row of boxes.)
  let wordsDrawable = true;
  try { fontFile = await resolveTextFont(treatment.scenes.map((s) => s.caption || "").join(" ")); }
  catch (e) { wordsDrawable = false; console.error(`[film] no font for these words — cut without captions: ${e instanceof Error ? e.message.slice(0, 140) : e}`); }
  const outName = `film-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp4`;
  const outPath = path.join(RENDERS(), outName);
  // A SUNG FILM FOLLOWS ITS SONG (sung-fit.ts): the song is listened to and every scene is on screen
  // exactly while its own line is sung — a clip cut short for a quick line, slowed a little or held
  // for a slow one — so the words on a scene are the words being sung, and the song never loops.
  // Anything that goes wrong here leaves the film as it always was: five seconds a scene.
  let filmClips = clips;
  if (tmpl.sung && musicIsSung && musicPath && clips.length === treatment.scenes.length) {
    try {
      const { hearSong } = await import("./film-captions.server");
      const heard = await hearSong({ songPath: musicPath, lyricLines: lyricLinesOf(treatment.scenes), jobId });
      const fit = fitScenesToSong(sceneSpans(clips.length, sceneLineTimes(treatment.scenes, heard)), ffprobeDuration(musicPath), CLIP_SECONDS);
      if (!fit) console.log("[film] the song could not be followed line by line — scenes keep their own length");
      else {
        const fitted: string[] = [];
        for (let i = 0; i < clips.length; i++) {
          const out = clips[i].replace(/\.mp4$/i, "") + "-fit.mp4";
          const run = await runFfmpeg(["-y", "-i", clips[i], "-vf", fitFilter(fit[i]), "-t", fit[i].dur.toFixed(2), "-an", "-threads", "2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", out]);
          if (run.status !== 0 || !fs.existsSync(out) || Math.abs(ffprobeDuration(out) - fit[i].dur) > 0.4) throw new Error(`scene ${i + 1} could not be fitted: ${(run.stderr || "").slice(-160)}`);
          fitted.push(out);
        }
        filmClips = fitted;
        console.log(`[film] scenes fitted to the song: ${fit.map((f) => `${f.dur}s${f.slow > 1 ? ` (slowed ${f.slow}x${f.hold ? `, held ${f.hold}s` : ""})` : ""}`).join(" · ")}`);
      }
    } catch (e) {
      console.error("[film] could not fit the scenes to the song (keeping five seconds a scene):", e instanceof Error ? e.message.slice(0, 200) : e);
      filmClips = clips;
      // (a fit that stopped half-way leaves nothing behind)
      for (const c of clips) { try { const half = c.replace(/\.mp4$/i, "") + "-fit.mp4"; if (fs.existsSync(half)) fs.unlinkSync(half); } catch { /* best effort */ } }
    }
  }
  await assembleFilm({
    clips: filmClips,
    captions: tmpl.captions && wordsDrawable ? treatment.scenes.map((s) => s.caption) : treatment.scenes.map(() => undefined),
    musicPath, musicIsSung, voPath, fontFile, outPath, jobId,
  });
  for (const f of filmClips) { if (!clips.includes(f)) { try { fs.unlinkSync(f); } catch { /* best effort */ } } }
  // ONE LOUDNESS: a sung film plays where the music videos do. (Two kids' songs made within the hour came
  // out at -14.5 and -10.8 LUFS — the song engine's own level, passed straight through.) Never costs the film.
  if (musicIsSung) { try { const { levelFilm } = await import("./film-loudness.server"); await levelFilm(outPath, -14); } catch { /* left as it was */ } }
  const outBuf = fs.readFileSync(outPath);
  try { await mirrorRender(outName, outBuf); } catch { /* non-fatal */ }
  const storedUrl = `/renders/${outName}`;

  // 5) PERSIST — a VIDEO_AD asset tagged for the Creator gallery.
  const asset = await db.asset.create({
    data: {
      shopId: opts.shopId,
      type: "VIDEO_AD",
      status: "PENDING",
      title: `${tmpl.name} — ${trimTitle(treatment.title || opts.topic || product?.title || "", 60)}`,
      bodyJson: JSON.stringify({ style: "FILM", videoUrl: storedUrl, prompt: opts.topic || "", treatment }),
      metaJson: JSON.stringify({ kind: "film", template: tmpl.key, section: opts.section || "creator", scenes: clips.length, aspect: "vertical", ...(product ? { product: product.title } : {}) }),
    },
  });
  return asset.id;
}
