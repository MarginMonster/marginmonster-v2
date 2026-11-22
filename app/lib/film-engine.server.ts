// The long-form FILM engine — EasyMode's premium "serious filmmaker" tier.
//
// A generalization of faceless-video.server.ts: instead of cheap Ken-Burns
// STILLS, each scene is a real AI i2v CLIP (the quality upgrade the owner asked
// for — "high budget, not cheap"). One engine, many TEMPLATES:
//   musicvideo — sung/instrumental track + beat-synced visual scenes   (Film tab)
//   kidstv     — CoComelon-style bright cartoon, recurring characters  (Film tab)
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
import { musicBedToDisk, singToDisk } from "./music-generation.server";
import { mirrorRender } from "./object-storage.server";
import { dropOrgEndorsementPossessive } from "./ad-claims";
import { MV_MAX_SECONDS, SHOT_NOTES, defaultRole, shotSlot, type SceneSeconds, type ShotRole } from "./mv-pace";
import { MAX_COSTARS, singerOf } from "./mv-cast";
import { FEATURE_MIN_SECONDS, defaultFeaturePlan, featureRoles } from "./mv-feature";
import { SHORT_ENGINE_WORDS, SING_RATE, fullSongLines, lyricAsk, lyricFit, lyricWords, pickLyric, sceneWordRange, sceneWordsFor, songEngineFor, songWordsFor, wordsAsLineCount, wordsAsLines } from "./mv-song";
import { SENSE_RULES, sameCar, sameTime } from "./mv-sense";
import { ORIGINAL_LYRICS_RULE } from "./lyrics-rules";

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
  /** Music mood the track generator falls back to. */
  musicHint: string;
  defaultScenes: number;
  minScenes: number;
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
    maxScenes: 6,
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
    brief: "a CoComelon-style kids SING-ALONG — cute cartoon characters sing one simple, catchy, wholesome song with a hook a toddler can sing along to",
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
    maxScenes: 6,
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
    sceneHint: "a dark, moody, cinematic horror scene — deep shadows, eerie atmosphere, cold desaturated color grade, suspenseful; unsettling but not graphically gory",
    musicHint: "tense, eerie, suspenseful horror score — low drones, uneasy strings",
    defaultScenes: 4,
    minScenes: 2,
    maxScenes: 6,
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
  testmovie: {
    key: "testmovie",
    name: "Short Film",
    brief: "a cinematic SHORT FILM where your cast actually SPEAKS real dialogue to each other — scene by scene, with seamless flow and real emotion. The flagship movie maker.",
    sceneHint: "a cinematic, photorealistic live-action film scene — natural lighting, filmic composition, real-looking people; a clean, uncluttered set with NO readable text, documents, papers, bulletin boards, signage, posters or screens visible",
    musicHint: "subtle cinematic underscore",
    defaultScenes: 2,
    minScenes: 1,
    maxScenes: 6,
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
   *  to the render so the voice isn't flat/monotone (e.g. "coldly, with quiet menace"). */
  where?: string;
  shot?: string;
  tone?: string;
  /** Music Video pre-editor override: "perform" = the artist sings (lip-synced); "broll" = a cut
   *  scene (props/dancing/scenery, no lip-sync). Absent → the pipeline's SHOTLIST cadence decides. */
  kind?: "perform" | "broll";
  /** Music Video FEATURED VERSE: the NAME of the co-star who sings this scene's lines, in their own
   *  voice (mv-feature.ts). Absent → the artist sings it, as in every video before 2026-11-21. */
  singer?: string;
}
export interface FilmTreatment {
  title?: string; scenes: FilmScene[]; musicMood: string; cast?: string[];
  /** A music video's lyric, counted against what its video needs — set when the sheet had to be rewritten
   *  to fit (film-engine previewFilmTreatment): how many words it has now, how many are wanted, how many
   *  it was written with, the rounds of rewriting, whether it fits, and what went wrong if anything did. */
  lyricFit?: { words: number; want: number; was: number; rounds: number; fits: boolean; note?: string };
}

const TREATMENT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    musicMood: { type: "string" },
    cast: { type: "array", items: { type: "string" } },
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: { visual: { type: "string" }, caption: { type: "string" }, where: { type: "string" }, shot: { type: "string" }, tone: { type: "string" }, singer: { type: "string" } },
        required: ["visual"],
      },
    },
  },
  required: ["scenes", "musicMood"],
} as const;

/* NARRATED stories — one storyteller, illustrated scenes. Each scene is 2-3 spoken sentences (about ten
 * seconds), so the length is the scene count: 4 ≈ 45 s, 6 ≈ a minute, 9 ≈ 1:30, 12 ≈ 2 minutes. */
export const NARRATED_MIN_SCENES = 3;
export const NARRATED_MAX_SCENES = 12;
export const NARRATED_DEFAULT_SCENES = 6;
export const clampNarrated = (n: number): number => Math.max(NARRATED_MIN_SCENES, Math.min(NARRATED_MAX_SCENES, Math.round(n || NARRATED_DEFAULT_SCENES)));
/** What the writer is asked for when a story format is NARRATED rather than acted. */
const NARRATED_BRIEF: Record<string, string> = {
  horror: "a short NARRATED HORROR STORY — the kind a scary-story channel tells: one creepy, atmospheric tale in a storyteller's voice, dread building line by line to a chilling twist",
  moral: "a short NARRATED MORAL STORY: a relatable everyday situation told by a storyteller, building to a clear, uplifting life lesson",
  kidstv: "a gentle NARRATED STORY for little ones — a storybook read aloud: a small cast of cute characters, one simple happy adventure, warm and G-rated, with a cosy ending",
  testmovie: "a short NARRATED STORY on the given theme — a storyteller's voice, a clear beginning, middle and end, and an ending that lands",
};
/** The templates that can be told by a narrator (for the page that offers the choice). */
export const NARRATABLE_KEYS: string[] = Object.keys(NARRATED_BRIEF);
/** The formats that OPEN narrated — the maker can still switch to Acted in The Style. A scary story and a
 *  story with a lesson are TOLD: it is the form story channels post. Made side by side on 2026-11-22, the
 *  narrated horror story was 83 s of six pictures with captions, ready in about two minutes for a few
 *  cents; the acted one was 28 s of a single two-shot, eleven minutes and about $3 of video model.
 *  (Owner, same day: "Should horror story be narrated?" — one list, so it is one line to change back.) */
export const NARRATED_FIRST_KEYS: string[] = ["horror", "moral"];
/** Which templates can be told by a narrator instead of acted. */
export const canNarrate = (key: string | undefined): boolean => !!key && Object.prototype.hasOwnProperty.call(NARRATED_BRIEF, key);

function clampScenes(t: FilmTemplate, n: number): number {
  return Math.max(t.minScenes, Math.min(t.maxScenes, Math.round(n || t.defaultScenes)));
}

/** ALL-CAPS, filter-safe caption text (mirrors faceless captionSafe). */
function captionSafe(s: string): string {
  return (s || "").toUpperCase().replace(/[']/g, "’").replace(/[^\p{L}\p{N} .,!?$’-]/gu, "").replace(/\s+/g, " ").trim();
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
  cast?: Array<{ name: string; desc?: string }>;
  /** Music Video: how long each scene is — 10 seconds (the default) or 5. The video runs
   *  sceneCount × this many seconds, and the song is written for THAT length. */
  sceneSeconds?: SceneSeconds;
  /** Music Video FEATURED VERSE: the names of the co-stars (from castNames) who sing a verse of their
   *  own. The writer gives each one a verse and marks its scenes with "singer". */
  featureNames?: string[];
}): Promise<FilmTreatment> {
  const tmpl = filmTemplate(opts.template);
  const narrated = opts.mode === "narrated" && !tmpl.lipSyncSinger && !tmpl.sung;
  // a music video is never longer than two minutes, however short its scenes
  const sceneSec: SceneSeconds = tmpl.lipSyncSinger && opts.sceneSeconds === 5 ? 5 : 10;
  const scenes = narrated ? clampNarrated(opts.sceneCount ?? NARRATED_DEFAULT_SCENES)
    : tmpl.lipSyncSinger ? Math.min(clampScenes(tmpl, opts.sceneCount ?? tmpl.defaultScenes), Math.floor(MV_MAX_SECONDS / sceneSec))
    : clampScenes(tmpl, opts.sceneCount ?? tmpl.defaultScenes);
  /** how long the finished music video runs */
  const videoSecs = scenes * sceneSec;
  // who the maker cast (story formats only — a music video names its artist its own way)
  const picked = tmpl.lipSyncSinger ? [] : (opts.cast || [])
    .map((c) => ({ name: (c?.name || "").trim().slice(0, 40), desc: (c?.desc || "").trim().replace(/\s+/g, " ").slice(0, 220) }))
    .filter((c) => c.name).slice(0, 4);
  const topic = (opts.topic || "").trim();
  // Lip-sync Music Video: the chosen genre drives the song style, the artist and
  // every setting; folded into the writer prompt so lyrics + visuals match it.
  const genreKey = tmpl.lipSyncSinger ? genreOrDefault(opts.genre) : "";
  const g = genreKey ? GENRES[genreKey] : null;
  const genreLabel = g ? g.label : "pop";
  const genreLine = g ? `\nGENRE: ${g.label}. The song must sound like authentic ${g.label} — ${g.song}. The artist and EVERY setting must look like a real ${g.label} music video — ${g.look}.` : "";
  const langLine = opts.contentLang && opts.contentLang !== "en" ? `\nWrite all captions in this language code: ${opts.contentLang}.` : "";
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
  const pickedLine = picked.length
    ? `\nTHE CAST IS ALREADY CHOSEN — write the story for exactly these characters: ${picked.map((c) => `${c.name}${c.desc ? ` — ${c.desc}` : ""}`).join("; ")}. Return them as "cast": ONE entry each, in this order, EACH STARTING WITH THE CHARACTER'S EXACT NAME followed by that fixed look (e.g. "${picked[0].name}, …"). Use these exact names in every scene and never rename them. A character who is a creature or a cartoon stays exactly that — never turn them into a person.${narrated ? " If the story needs someone else who comes back (a victim, a friend, a parent), you may add up to TWO more recurring characters: give each a simple first name and add them to \"cast\" after the chosen ones, each entry starting with the name followed by one fixed, vivid look." : picked.length < 2 ? " The story needs a second voice: invent ONE more character with a simple first name, described just as vividly, and add them to \"cast\" after the first." : " Do NOT add any other named character."}${noSlop}`
    : "";
  const castLine = pickedLine ? pickedLine : tmpl.castBible
    ? (tmpl.sing && !tmpl.childSafe
      ? (artistName
        ? `\nThe artist is named "${artistName}" — use THIS EXACT name everywhere; do NOT give them a stage name, alias, rap name or ANY other name. Return "cast" as an array of vivid FIXED visual descriptions, EACH STARTING WITH THE PERSON'S EXACT NAME: the FIRST entry is ${artistName} (e.g. "${artistName}, a singer with long dark wavy hair and a black leather jacket")${castNames.length ? `, then ONE entry for EACH co-star, in this order and with these EXACT names — ${castNames.map((n) => `"${n}"`).join(", ")} (e.g. "${castNames[0]}, …")` : ""}. Every scene's VISUAL and caption must use ONLY these exact names — NEVER a made-up or stage name.${coStars} Every scene's VISUAL features this SAME performer.${noSlop}`
        : `\nFirst invent the ARTIST and return it as "cast": an array whose FIRST entry is ONE vivid, FIXED visual description of the singer to reuse in every scene (e.g. "Mia, a 25-year-old singer with long dark wavy hair, a black leather jacket and silver hoop earrings").${coStars} Every scene's VISUAL must feature this SAME performer, described the same way.${noSlop}`)
      : `\nFirst invent a small RECURRING CAST (2-3 characters) and return it as "cast": an array where each entry is ONE vivid, FIXED visual description to reuse in every scene (e.g. "Pip, a cheerful 3-year-old boy with curly brown hair, round cheeks, a red-striped shirt and blue overalls"). Every scene's VISUAL must feature these same named characters, described the same way.${noSlop}`)
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
      `• VISUAL — the ONE picture we see while that part is told, in at most 45 words: a single vivid, specific moment (${tmpl.sceneHint}) — who is in it, where, doing what, the light and the mood. Call every character who is IN the picture by their NAME exactly as in "cast" (never just "he", "she", "the creature" or "the clerk"); a picture nobody is in names nobody. Anything that is seen in more than one picture (a kite, a car, a house, a toy) is described with the SAME few words every time, so it is drawn the same. A different moment every scene, and no readable text anywhere in it.\n` +
      `• CAPTION — the NARRATOR'S words for that scene, written to be READ ALOUD: 2-3 sentences, about 25-35 words. Plain, vivid, concrete storytelling — no "NAME:" labels, no stage directions, no headings. The FIRST scene opens with a hook that makes a viewer stay. Each scene picks up exactly where the last one left off. The LAST scene lands the ending${tmpl.key === "moral" ? " and says the lesson in one clear closing line" : tmpl.key === "horror" ? " on the chilling twist — the last line should make the skin crawl" : ""}.\n` +
      `Read in order, the captions are the whole story, start to finish, in one voice.\n`
    : tmpl.dialogue
    ? `\nWrite it as a SHORT FILM SCENE with CHARACTER DIALOGUE. Return EXACTLY ${scenes} consecutive SHOTS. Each shot has FIVE fields:\n` +
      `• VISUAL — what we SEE: a TWO-SHOT framing BOTH characters together in the place; they STAY put (NO standing up, sitting down, walking, turning away or crossing — big moves make the AI morph faces/clothing); a still, tense TALKING beat with only small gestures and changing expressions; keep hands EMPTY by default — do NOT add cigarettes, drinks, phones or handheld props for flavour (they warp badly in AI video), only include one if the user's theme specifically involves it; NO readable text, documents, papers, boards, signage or screens in view.\n` +
      `• CAPTION — formatted EXACTLY as "NAME: what they say", ONE speaker per shot. Each line fills MOST of the ~10-second shot WITHOUT overrunning it: a two-sentence beat of about 15-18 words (~7-9 seconds of speech). This is a HARD window — NEVER a short one-liner (a line that doesn't fill the shot leaves dead air, which makes the AI voice stall or repeat words), and NEVER more than 18 words, because a longer line overruns the 10-second clip and gets cut off at the end. Count the words and stay inside 15-18. The speaker ALTERNATES shot to shot, building a real back-and-forth with a clear turn at the end; use the cast's names, and make each line a genuine REPLY to the one before it (never a non-sequitur).\n` +
      `• WHERE — the LOCATION this beat happens in, as a short vivid label (e.g. "a dim old diner at night, rain on the windows").\n` +
      `• SHOT — set this to EXACTLY "wide two-shot" for EVERY beat. Do NOT use close-ups, reverse angles or any other framing — the director adds those by hand later. Every beat in a scene MUST share the same "wide two-shot" so the whole scene plays as ONE seamless, continuous take.\n` +
      `• TONE — HOW this exact line is delivered: a short emotional direction for the voice (e.g. "coldly, with quiet menace", "voice rising in anger", "quietly, barely holding it together"). It must MATCH the words so the read is never flat or monotone.\n` +
      `Keep the WHOLE conversation in ONE location unless the story genuinely moves the SAME characters somewhere else — only then start a NEW "where" (a real scene change; everyone is present in the new place). Prefer one flowing location over cutting between places.\n`
    : tmpl.sung
    ? `\nReturn EXACTLY ${scenes} scenes. Each scene = a VISUAL (${tmpl.sceneHint}, featuring the artist/cast performing) and a CAPTION that is the SUNG LYRIC LINE for that beat — one short, catchy, singable line (<=10 words) that rhymes and flows with the others. Read in order the captions ARE the song's lyrics: give the whole thing a clear, repeating, sing-along HOOK${tmpl.childSafe ? " a toddler can sing along to" : ""}, like a real ${tmpl.childSafe ? "preschool nursery sing-along" : "pop song"}.\n`
    : tmpl.narrated
    ? `\nReturn EXACTLY ${scenes} scenes. Each scene = a VISUAL (${tmpl.sceneHint}) and a CAPTION that is the NARRATOR'S spoken line for that beat — ONE natural sentence, <=14 words, moving the story forward; read in order the captions are a continuous, emotive voiceover that tells the whole story and lands the ending.\n`
    : `\nReturn EXACTLY ${scenes} scenes. Each scene = a VISUAL (${tmpl.sceneHint}) and a short CAPTION (one punchy on-screen line, <=8 words; the hook or the joke's line for that beat).\n`;
  const safetyLine = tmpl.childSafe
    ? `SAFETY: this is for very young children — keep it 100% wholesome and G-rated: happy, gentle and safe. NOTHING scary, sad, violent, adult or unsafe; no real named people or brands; invent no claims.`
    : tmpl.key === "horror"
    ? `This is FICTIONAL horror for an entertainment video (a horror-short / scary-story channel). Write a GENUINELY SCARY, intense, DARK horror story — real menace, dread, danger, frightening imagery and a chilling twist; a horror-FILM feel, NOT a watered-down kids' version. Violence, death, blood and disturbing imagery are fine when they serve the scare, portrayed with cinematic intent. CAST ONLY ADULTS: every character — victim and threat alike — is a grown adult; never write a child, teenager, infant or any minor into the story, and never place a young person in peril (the AI render models refuse minors-in-danger, which hard-fails the whole video — so recast any endangered character as an adult). The ONLY other limits: no gratuitous, lingering torture or graphic mutilation purely for shock, and no real named people. Take the premise and make it as frightening as you can within that.`
    : `SAFETY: keep it general and true — invent NO statistics, prices, claims, reviews, ratings or endorsements; no defamation or real named people; nothing adult or unsafe. Anyone who faces danger, threat, fear or menace is an ADULT — never place a child, teenager, infant or any minor in peril and never depict a minor being threatened, hunted, harmed or frightened; recast any such role as an adult (the AI render models refuse minors-in-danger, which hard-fails the video).`;
  // The template brief says "a full ~2-minute MUSIC VIDEO … across several vivid settings" — say what a
  // short cut actually is, so the brief doesn't fight the hook-sized lyric budget above.
  const brief = tmpl.lipSyncSinger && shortCut
    ? `a SHORT ${videoSecs}-second MUSIC VIDEO cut — ONE artist actually sings a real genre hook on camera (lip-synced) ${scenes === 1 ? "in one vivid setting" : `across ${scenes} vivid settings`}`
    : narrated ? (NARRATED_BRIEF[tmpl.key] || NARRATED_BRIEF.testmovie)
    : tmpl.brief;
  const prompt =
    `Write ${brief}.\n` +
    (topic ? `THEME / what it's about: "${topic.slice(0, 300)}". Tell EXACTLY this — stay faithful to what is described and build the story around it; do NOT swap in a different premise or pad it with extra characters, settings or events the user did not ask for.\n` : `Pick a fun, broadly-appealing theme.\n`) +
    // a sung piece: the words are ours, whatever song the theme names
    (tmpl.lipSyncSinger || tmpl.sung ? `${ORIGINAL_LYRICS_RULE}\n` : "") +
    genreLine +
    castLine +
    genderLine +
    prodLine +
    captionLine +
    `Also give musicMood (a short phrase for the backing track) and a short title.${langLine}\n` +
    safetyLine;
  const write = async (p: string): Promise<FilmTreatment> => {
    const raw = await anthropicText(p, {
      model: "claude-sonnet-5",
      // a full ~2-min song's lyrics — and a narrated story's every word — run long; a music video of
      // five-second scenes has up to 24 scenes to describe
      maxTokens: tmpl.lipSyncSinger ? (scenes > 12 ? 4400 : 2600) : narrated ? 2400 : 1500,
      jsonSchema: { name: "film_treatment", schema: TREATMENT_SCHEMA as unknown as Record<string, unknown> },
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
  for (const extra of rungs) {
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
          `For EVERY scene write THREE versions of its lyric — the same meaning and the same rhyme at three LENGTHS: a short one of about ${Math.max(4, sceneWords - 3)} words, a middle one of about ${sceneWords} words, a long one of about ${sceneWords + 3} words — by tightening or lengthening its own lines. Keep the story, the order and the hook. ${ORIGINAL_LYRICS_RULE}${langLine}\n` +
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
  list = list.map((s, i) => ({
    visual: s.visual,
    caption: s.caption ? dropOrgEndorsementPossessive(s.caption) : undefined,
    where: typeof s.where === "string" && s.where.trim() ? s.where.trim().slice(0, 120) : undefined,
    shot: typeof s.shot === "string" && s.shot.trim() ? s.shot.trim().slice(0, 60) : undefined,
    tone: typeof s.tone === "string" && s.tone.trim() ? s.tone.trim().slice(0, 100) : undefined,
    // A music-video scene carries what it was WRITTEN as (performance or cut scene): the role then
    // travels with the scene when the maker reorders or removes scenes, instead of being re-dealt by
    // position — which turned a scene written as a performance into a cut scene.
    ...(tmpl.lipSyncSinger ? { kind: outRoles[i] } : {}),
    ...(featured.length && singers[i] >= 0 ? { singer: castList[singers[i]] } : {}),
  }));
  if (list.length < 1) throw new Error("[film] treatment came back empty");
  const cast = Array.isArray(parsed.cast) ? parsed.cast.filter((c) => typeof c === "string" && c.trim()).slice(0, 5) : undefined;
  let outTitle = (parsed.title || topic || tmpl.name).slice(0, 80);
  // NAME ENFORCEMENT (robust). The writer keeps inventing stage names (Kai Monroe, Wyatt, Vex, Dalla…)
  // despite being told the EXACT names. So read the name it ACTUALLY used for each cast slot (the leading
  // token of that cast description) and HARD-SUBSTITUTE it with the provided name across the whole
  // treatment — the only thing that reliably kills "AI slop" names + lets the per-scene cast match.
  if (cast && cast.length && (artistName || castNames.length || picked.length)) {
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const subs: Array<{ from: string; to: string }> = [];
    cast.forEach((desc, i) => {
      const want = picked.length ? picked[i]?.name : i === 0 ? artistName : castNames[i - 1];
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
  return { title: outTitle, scenes: list, musicMood: parsed.musicMood || tmpl.musicHint, cast, ...(fitNote ? { lyricFit: fitNote } : {}) };
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
    opts.clips.forEach((c) => a.push("-i", c));
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
            `drawtext=fontfile='${font}':text='${ln}':fontsize=${FS}:fontcolor=white:` +
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
    const castRef = await renderCreativeSeed(`${safePhrase}${tmpl.sceneHint}. A group portrait of the recurring cast standing together — full body, clear consistent faces, plain neutral background, IN THE EXACT SAME ART STYLE as the rest of the film. The cast: ${castBible}`, "9:16").catch(() => null);
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
        try { seedUrl = refAbs ? ((await renderStyledSeed(seedPrompt, refAbs, "9:16")) || (await renderCreativeSeed(seedPrompt, "9:16"))) : await renderCreativeSeed(seedPrompt, "9:16"); } catch { /* retry once */ }
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
}): Promise<string | null> {
  const tmpl = filmTemplate(opts.template);
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const abs = (u: string | null | undefined): string | null => (u ? (u.startsWith("http") ? u : `${base}${u}`) : null);
  const safePhrase = tmpl.childSafe ? "Wholesome, child-safe, G-rated, bright and friendly. " : "";
  const refAbs = opts.castRef ? abs(opts.castRef) : null;
  const seedPrompt = `${safePhrase}${opts.sceneVisual}. ${tmpl.sceneHint}. Richly detailed, high quality.`;
  let seedUrl: string | null = null;
  for (let a = 0; a < 2 && !seedUrl; a++) {
    try { seedUrl = refAbs ? ((await renderStyledSeed(seedPrompt, refAbs, "9:16")) || (await renderCreativeSeed(seedPrompt, "9:16"))) : await renderCreativeSeed(seedPrompt, "9:16"); } catch { /* retry once */ }
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
      try { castRef = await renderCreativeSeed(`${safePhrase}${tmpl.sceneHint}. A group portrait of the recurring cast standing together — full body, clear consistent faces, plain neutral background, IN THE EXACT SAME ART STYLE as the rest of the film. The cast: ${castBible}`, "9:16"); }
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
        seedUrl = refAbs
          ? ((await renderStyledSeed(seedPrompt, refAbs, "9:16")) || (await renderCreativeSeed(seedPrompt, "9:16")))
          : await renderCreativeSeed(seedPrompt, "9:16");
      } catch { /* retry once */ }
    }
    const seedAbs = seedUrl ? (seedUrl.startsWith("http") ? seedUrl : `${base}${seedUrl}`) : undefined;

    let made = false;
    if (seedAbs) {
      const motion = `${safePhrase}${scene.visual}. ${castBible}${productLine} ${tmpl.sceneHint}. Smooth, confident cinematic camera motion, vertical 9:16. Add no text, caption, logo or watermark of your own.`;
      for (let a = 0; a < 2 && !made; a++) {
        try {
          const created = await animateCreate(undefined, { startImage: seedAbs, prompt: motion, durationSec: CLIP_SECONDS });
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
        try { voUrl = await repPoll(await repCreate("minimax/speech-02-hd", { text: narration, voice_id: NARRATOR_VOICE, english_normalization: true, language_boost: "English" }), 3 * 60_000, "film-vo"); }
        catch { voUrl = await repPoll(await repCreate("minimax/speech-02-turbo", { text: narration, voice_id: NARRATOR_VOICE }), 3 * 60_000, "film-vo"); }
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
  try { fontFile = await resolveTextFont(treatment.scenes.map((s) => s.caption || "").join(" ")); } catch { /* keep Poppins */ }
  const outName = `film-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp4`;
  const outPath = path.join(RENDERS(), outName);
  await assembleFilm({
    clips,
    captions: tmpl.captions ? treatment.scenes.map((s) => s.caption) : treatment.scenes.map(() => undefined),
    musicPath, musicIsSung, voPath, fontFile, outPath, jobId,
  });
  const outBuf = fs.readFileSync(outPath);
  try { await mirrorRender(outName, outBuf); } catch { /* non-fatal */ }
  const storedUrl = `/renders/${outName}`;

  // 5) PERSIST — a VIDEO_AD asset tagged for the Creator gallery.
  const asset = await db.asset.create({
    data: {
      shopId: opts.shopId,
      type: "VIDEO_AD",
      status: "PENDING",
      title: `${tmpl.name} — ${(treatment.title || opts.topic || product?.title || "").slice(0, 60)}`,
      bodyJson: JSON.stringify({ style: "FILM", videoUrl: storedUrl, prompt: opts.topic || "", treatment }),
      metaJson: JSON.stringify({ kind: "film", template: tmpl.key, section: opts.section || "creator", scenes: clips.length, aspect: "vertical", ...(product ? { product: product.title } : {}) }),
    },
  });
  return asset.id;
}
