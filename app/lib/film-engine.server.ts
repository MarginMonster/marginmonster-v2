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
  /** Whether this template is wired end-to-end on the FILM TAB (route offers
   *  these). Skit lives in the marketing flow instead, so it is false here. */
  live: boolean;
}

export const FILM_TEMPLATES: Record<string, FilmTemplate> = {
  musicvideo: {
    key: "musicvideo",
    name: "Music Video",
    brief: "a short MUSIC VIDEO: a catchy sung-style hook broken into beat-synced visual scenes that tell a loose vibe/story",
    sceneHint: "a vivid, cinematic, music-video visual (dynamic, stylized, full of energy) — NO text, words, logos or real named people in the image",
    musicHint: "an original catchy upbeat pop song with clear sung vocals, music-video energy",
    defaultScenes: 6,
    minScenes: 4,
    maxScenes: 24,
    captions: true,
    sung: true,
    live: true,
  },
  kidstv: {
    key: "kidstv",
    name: "Kids Cartoon",
    brief: "a bright, wholesome kids cartoon episode (CoComelon-style) with a small recurring cast and a sing-along — a simple, happy little story a toddler would love",
    sceneHint: "bright glossy 3D-animated cartoon, rounded friendly character designs, big expressive eyes, soft candy colors, simple cheerful backgrounds, wholesome and child-safe (G-rated), like a modern preschool cartoon",
    musicHint: "cheerful bouncy nursery-rhyme sing-along, upbeat and sweet",
    defaultScenes: 6,
    minScenes: 4,
    maxScenes: 16,
    captions: true,
    castBible: true,
    referenceSeed: true,
    childSafe: true,
    sung: true,
    live: true,
  },
  moral: {
    key: "moral",
    name: "Moral Story",
    brief: "a short SCRIPTED MORAL STORY (Dhar Mann style): a relatable everyday situation with a small recurring cast, building to a clear, uplifting life-lesson payoff — told by a narrator",
    sceneHint: "a cinematic, emotionally-expressive dramatic scene, photoreal, real-world setting, natural lighting",
    musicHint: "warm, heartfelt, uplifting cinematic score",
    defaultScenes: 8,
    minScenes: 5,
    maxScenes: 24,
    captions: true,
    castBible: true,
    referenceSeed: true,
    narrated: true,
    live: true,
  },
  horror: {
    key: "horror",
    name: "Horror Story",
    brief: "a short SUSPENSEFUL HORROR STORY: a creepy, atmospheric tale with a small recurring cast and a chilling twist — told by a narrator; unsettling and spooky, NOT gory or graphically violent",
    sceneHint: "a dark, moody, cinematic horror scene — deep shadows, eerie atmosphere, cold desaturated color grade, suspenseful; unsettling but not graphically gory",
    musicHint: "tense, eerie, suspenseful horror score — low drones, uneasy strings",
    defaultScenes: 8,
    minScenes: 5,
    maxScenes: 24,
    captions: true,
    castBible: true,
    referenceSeed: true,
    narrated: true,
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
    live: true,
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
    // TEMP live on the Film tab: Skit's marketing re-home (its own /web/skit entry,
    // per the owner's "Skit → social marketing" call) is a separate push. Flipping
    // this to false NOW would leave Skit unreachable with no home, so it stays here
    // until the marketing entry ships. Engine + product path are ready either way.
    live: true,
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
export interface FilmScene { visual: string; caption?: string }
export interface FilmTreatment { title?: string; scenes: FilmScene[]; musicMood: string; cast?: string[] }

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
        properties: { visual: { type: "string" }, caption: { type: "string" } },
        required: ["visual"],
      },
    },
  },
  required: ["scenes", "musicMood"],
} as const;

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
}): Promise<FilmTreatment> {
  const tmpl = filmTemplate(opts.template);
  const scenes = clampScenes(tmpl, opts.sceneCount ?? tmpl.defaultScenes);
  const topic = (opts.topic || "").trim();
  const langLine = opts.contentLang && opts.contentLang !== "en" ? `\nWrite all captions in this language code: ${opts.contentLang}.` : "";
  const castLine = tmpl.castBible
    ? `\nFirst invent a small RECURRING CAST (2-3 characters) and return it as "cast": an array where each entry is ONE vivid, FIXED visual description to reuse in every scene (e.g. "Pip, a cheerful 3-year-old boy with curly brown hair, round cheeks, a red-striped shirt and blue overalls"). Every scene's VISUAL must feature these same named characters, described the same way.`
    : "";
  const prodLine = tmpl.needsProduct && opts.productTitle
    ? `\nTHE PRODUCT being advertised: "${opts.productTitle.slice(0, 80)}"${opts.productDescription ? ` — ${opts.productDescription.slice(0, 300)}` : ""}. Make it the HERO of the gag — the funny payoff features or revolves around this exact product. Say ONLY what is true of it; invent no claims, specs, prices or reviews.`
    : "";
  // Narrated templates want each caption to BE the narrator's spoken line for
  // that beat (a flowing voiceover); others want a short on-screen hook.
  const captionLine = tmpl.sung
    ? `\nReturn EXACTLY ${scenes} scenes. Each scene = a VISUAL (${tmpl.sceneHint}) and a CAPTION that is the SUNG LYRIC LINE for that beat — one short, catchy, singable line (<=10 words) that rhymes/flows with the others; read in order the captions ARE the song's lyrics.\n`
    : tmpl.narrated
    ? `\nReturn EXACTLY ${scenes} scenes. Each scene = a VISUAL (${tmpl.sceneHint}) and a CAPTION that is the NARRATOR'S spoken line for that beat — ONE natural sentence, <=14 words, moving the story forward; read in order the captions are a continuous, emotive voiceover that tells the whole story and lands the ending.\n`
    : `\nReturn EXACTLY ${scenes} scenes. Each scene = a VISUAL (${tmpl.sceneHint}) and a short CAPTION (one punchy on-screen line, <=8 words; the hook or the joke's line for that beat).\n`;
  const safetyLine = tmpl.childSafe
    ? `SAFETY: this is for very young children — keep it 100% wholesome and G-rated: happy, gentle and safe. NOTHING scary, sad, violent, adult or unsafe; no real named people or brands; invent no claims.`
    : tmpl.key === "horror"
    ? `This is FICTIONAL horror for an entertainment video (a horror-short / scary-story channel). Write a GENUINELY SCARY, intense, DARK horror story — real menace, dread, danger, frightening imagery and a chilling twist; a horror-FILM feel, NOT a watered-down kids' version. Violence, death, blood and disturbing imagery are fine when they serve the scare, portrayed with cinematic intent. The ONLY limit: no gratuitous, lingering torture or graphic mutilation purely for shock, and no real named people. Take the premise and make it as frightening as you can within that.`
    : `SAFETY: keep it general and true — invent NO statistics, prices, claims, reviews, ratings or endorsements; no defamation or real named people; nothing adult or unsafe.`;
  const prompt =
    `Write ${tmpl.brief}.\n` +
    (topic ? `THEME / what it's about: "${topic.slice(0, 300)}".\n` : `Pick a fun, broadly-appealing theme.\n`) +
    castLine +
    prodLine +
    captionLine +
    `Also give musicMood (a short phrase for the backing track) and a short title.${langLine}\n` +
    safetyLine;
  const write = async (p: string): Promise<FilmTreatment> => {
    const raw = await anthropicText(p, {
      model: "claude-sonnet-5",
      maxTokens: 1500,
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
  let list = (parsed.scenes || []).filter((s) => s && s.visual).slice(0, scenes);
  // FTC backstop (captions are burned on screen): strip an endorsement
  // possessive from a third-party trademark the writer may have slipped in.
  list = list.map((s) => ({ visual: s.visual, caption: s.caption ? dropOrgEndorsementPossessive(s.caption) : undefined }));
  if (list.length < 1) throw new Error("[film] treatment came back empty");
  const cast = Array.isArray(parsed.cast) ? parsed.cast.filter((c) => typeof c === "string" && c.trim()).slice(0, 4) : undefined;
  return { title: (parsed.title || topic || tmpl.name).slice(0, 80), scenes: list, musicMood: parsed.musicMood || tmpl.musicHint, cast };
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
        const size = Math.max(30, Math.min(48, Math.floor((720 * 0.92) / (Math.max(1, text.length) * 0.60))));
        const t0 = starts[i].toFixed(2);
        const t1 = (starts[i] + durs[i]).toFixed(2);
        draws.push(
          `drawtext=fontfile='${font}':text='${text}':fontsize=${size}:fontcolor=white:` +
          `borderw=7:bordercolor=black:x=(w-text_w)/2:y=h-360:enable='gte(t,${t0})*lt(t,${t1})'`
        );
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
      try { castRef = await renderCreativeSeed(`${safePhrase}Character reference sheet: ${castBible} ${tmpl.sceneHint}. All characters together, full body, clean neutral background, character-design sheet.`, "9:16"); }
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

    let seedUrl: string | null = null;
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
      if (!made && seedUrl && seedUrl.startsWith("/renders/")) {
        const stillDisk = path.join(RENDERS(), path.basename(seedUrl));
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
