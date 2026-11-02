// The long-form FILM engine — EasyMode's premium "serious filmmaker" tier.
//
// A generalization of faceless-video.server.ts: instead of cheap Ken-Burns
// STILLS, each scene is a real AI i2v CLIP (the quality upgrade the owner asked
// for — "high budget, not cheap"). One engine, many TEMPLATES:
//   musicvideo — sung/instrumental track + beat-synced visual scenes   (SHIPPED)
//   kidstv     — CoComelon-style bright cartoon, recurring characters  (SHIPPED)
//   skit       — 1-3 funny scenes, product in the gag                  (planned)
//   movie      — Dhar Mann-style scripted drama + payoff               (planned)
//   youtube    — long-form narrative                                   (planned)
//
// Recurring-character templates (kidstv) solve consistency with a one-time CAST
// reference image that every scene seed is conditioned on (renderStyledSeed),
// plus a fixed cast "bible" injected into every seed + motion prompt.
//
// PRICING is METERED by scene count (plan-config: estimateFilmTokens) — the
// SAME pure function drives the estimate shown before Generate and the amount
// charged, so they can never drift. Charged up front in the route; the queue's
// refundPrepaidOnce returns it on terminal failure.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db.server";
import { anthropicText } from "./anthropic.server";
import { animateCreate, animatePoll, checkpointJob, download, ffprobeDuration, resolveTextFont, runFfmpeg } from "./ugc-ad-pipeline.server";
import { renderCreativeSeed, renderStyledSeed } from "./image-generation.server";
import { musicBedToDisk } from "./music-generation.server";
import { mirrorRender } from "./object-storage.server";
import { dropOrgEndorsementPossessive } from "./ad-claims";

const RENDERS = () => path.join(process.cwd(), "data", "renders");
// i2v clips routinely run a few minutes on fal/Replicate; give each a generous
// ceiling so a slow-but-successful render is never thrown away (and re-billed).
const CLIP_POLL_MS = 8 * 60_000;
const CLIP_SECONDS = 5; // the default i2v clip length; total video ≈ scenes × this

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
  /** Burn the per-scene caption line over its clip (lyrics / on-screen text). */
  captions: boolean;
  /** Recurring-character template: the treatment yields a CAST bible and… */
  castBible?: boolean;
  /** …each scene seed is conditioned on a one-time cast reference image. */
  referenceSeed?: boolean;
  /** Enforce wholesome, G-rated content in the treatment + seed/motion prompts. */
  childSafe?: boolean;
  /** Whether this template is wired end-to-end yet (route only offers these). */
  live: boolean;
}

export const FILM_TEMPLATES: Record<string, FilmTemplate> = {
  musicvideo: {
    key: "musicvideo",
    name: "Music Video",
    brief: "a short MUSIC VIDEO: a catchy sung-style hook broken into beat-synced visual scenes that tell a loose vibe/story",
    sceneHint: "a vivid, cinematic, music-video visual (dynamic, stylized, full of energy) — NO text, words, logos or real named people in the image",
    musicHint: "an original catchy upbeat instrumental, music-video energy",
    defaultScenes: 6,
    minScenes: 4,
    maxScenes: 24,
    captions: true,
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
    live: true,
  },
  // Planned templates — the engine already drives them generically; they stay
  // OUT of the route picker (live:false) until their specifics land (skit =
  // product-in-scene compositing; movie = scripted dialogue, the talking-cast
  // engine fork).
  skit: { key: "skit", name: "Skit", brief: "a funny short commercial skit with a tiny cast and the product inside the gag", sceneHint: "a funny cinematic scene", musicHint: "playful, comedic background music", defaultScenes: 3, minScenes: 1, maxScenes: 5, captions: true, live: false },
  movie: { key: "movie", name: "Short Film", brief: "a short scripted dramatic film with a cast and a meaningful payoff (Dhar Mann style)", sceneHint: "a cinematic dramatic scene", musicHint: "emotional cinematic score", defaultScenes: 12, minScenes: 6, maxScenes: 40, captions: false, castBible: true, referenceSeed: true, live: false },
  youtube: { key: "youtube", name: "YouTube Video", brief: "a long-form narrative YouTube video with a hook, body and payoff", sceneHint: "a clear, engaging cinematic scene", musicHint: "upbeat background music", defaultScenes: 10, minScenes: 6, maxScenes: 40, captions: true, live: false },
};

export function filmTemplate(key: string | undefined): FilmTemplate {
  return (key && FILM_TEMPLATES[key]) || FILM_TEMPLATES.musicvideo;
}
/** The templates the route offers today (end-to-end wired). */
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
}): Promise<FilmTreatment> {
  const tmpl = filmTemplate(opts.template);
  const scenes = clampScenes(tmpl, opts.sceneCount ?? tmpl.defaultScenes);
  const topic = (opts.topic || "").trim();
  const langLine = opts.contentLang && opts.contentLang !== "en" ? `\nWrite all captions in this language code: ${opts.contentLang}.` : "";
  const castLine = tmpl.castBible
    ? `\nFirst invent a small RECURRING CAST (2-3 characters) and return it as "cast": an array where each entry is ONE vivid, FIXED visual description to reuse in every scene (e.g. "Pip, a cheerful 3-year-old boy with curly brown hair, round cheeks, a red-striped shirt and blue overalls"). Every scene's VISUAL must feature these same named characters, described the same way.`
    : "";
  const safetyLine = tmpl.childSafe
    ? `SAFETY: this is for very young children — keep it 100% wholesome and G-rated: happy, gentle and safe. NOTHING scary, sad, violent, adult or unsafe; no real named people or brands; invent no claims.`
    : `SAFETY: keep it general and true — invent NO statistics, prices, claims, reviews, ratings or endorsements; no defamation or real named people; nothing adult or unsafe.`;
  const prompt =
    `Write ${tmpl.brief}.\n` +
    (topic ? `THEME / what it's about: "${topic.slice(0, 300)}".\n` : `Pick a fun, broadly-appealing theme.\n`) +
    castLine +
    `\nReturn EXACTLY ${scenes} scenes. Each scene = a VISUAL (${tmpl.sceneHint}) and a short CAPTION (one punchy on-screen line, <=8 words; the sung/spoken hook for that beat).\n` +
    `Also give musicMood (a short phrase for the backing track) and a short title.${langLine}\n` +
    safetyLine;
  const raw = await anthropicText(prompt, {
    model: "claude-sonnet-5",
    maxTokens: 1500,
    jsonSchema: { name: "film_treatment", schema: TREATMENT_SCHEMA as unknown as Record<string, unknown> },
  });
  const parsed = JSON.parse(raw) as FilmTreatment;
  let list = (parsed.scenes || []).filter((s) => s && s.visual).slice(0, scenes);
  // FTC backstop (captions are burned on screen): strip an endorsement
  // possessive from a third-party trademark the writer may have slipped in.
  list = list.map((s) => ({ visual: s.visual, caption: s.caption ? dropOrgEndorsementPossessive(s.caption) : undefined }));
  if (list.length < 1) throw new Error("[film] treatment came back empty");
  const cast = Array.isArray(parsed.cast) ? parsed.cast.filter((c) => typeof c === "string" && c.trim()).slice(0, 4) : undefined;
  return { title: (parsed.title || topic || tmpl.name).slice(0, 80), scenes: list, musicMood: parsed.musicMood || tmpl.musicHint, cast };
}

// ---- Assembly ---------------------------------------------------------------
/** Concatenate the per-scene clips into one 720x1280 video, lay the (looped)
 *  music track under it, and burn each scene's caption over its own clip window.
 *  Degrade ladder: full → no captions → silent slideshow — every rung a complete,
 *  independently-valid graph (never a string-spliced one), so a drawtext/music
 *  hiccup falls back instead of killing a paid render. */
async function assembleFilm(opts: {
  clips: string[]; captions: (string | undefined)[]; musicPath: string | null; fontFile: string; outPath: string; jobId?: string;
}): Promise<void> {
  const beat = async () => { if (opts.jobId) await checkpointJob(opts.jobId, { ckBeat: Date.now() }); };
  const N = opts.clips.length;
  if (!N) throw new Error("[film] no clips to assemble");

  // Per-clip real durations → caption windows + the total runtime.
  const durs = opts.clips.map((c) => { const d = ffprobeDuration(c); return d > 0.3 ? d : CLIP_SECONDS; });
  const total = durs.reduce((a, b) => a + b, 0);
  const starts: number[] = [];
  durs.reduce((acc, d, i) => { starts[i] = acc; return acc + d; }, 0);
  const hasMusic = !!opts.musicPath && fs.existsSync(opts.musicPath);
  const font = opts.fontFile.replace(/\\/g, "/").replace(/:/g, "\\:");

  const buildArgs = (useCaptions: boolean, useMusic: boolean): string[] => {
    const a: string[] = ["-y"];
    opts.clips.forEach((c) => a.push("-i", c));
    const musicOn = useMusic && hasMusic;
    if (musicOn) a.push("-stream_loop", "-1", "-i", opts.musicPath!); // input index N

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
        const text = captionSafe(cap || "");
        if (!text) return;
        const size = Math.max(32, Math.min(52, Math.floor((720 * 0.92) / (text.length * 0.62))));
        const t0 = starts[i].toFixed(2);
        const t1 = (starts[i] + durs[i]).toFixed(2);
        draws.push(
          `drawtext=fontfile='${font}':text='${text}':fontsize=${size}:fontcolor=white:` +
          `borderw=8:bordercolor=black:x=(w-text_w)/2:y=h-360:enable='gte(t,${t0})*lt(t,${t1})'`
        );
      });
      if (draws.length) { f.push(`[vcat]${draws.join(",")}[vf]`); vLabel = "[vf]"; }
    }

    const graph = [...f];
    let aMap: string | null = null;
    if (musicOn) {
      graph.push(`[${N}:a]atrim=0:${total.toFixed(2)},volume=0.7,afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5[aout]`);
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
  const rungs: Array<[cap: boolean, mus: boolean]> = [[true, true], [false, true], [false, false]];
  await beat();
  let lastErr = "";
  for (const [cap, mus] of rungs) {
    const run = await runFfmpeg(buildArgs(cap, mus));
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
  /** Merchant-approved treatment from the free preview — rendered VERBATIM (no
   *  re-write), exactly like the avatar step-2 approved-words flow. */
  treatment?: FilmTreatment;
  sceneCount?: number;
  section?: string;
  jobId?: string;
  resume?: { ckTreatment?: string; ckCastRef?: string; ckClips?: string[]; ckMusic?: string };
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
  else treatment = await previewFilmTreatment({ shopId: opts.shopId, template: tmpl.key, topic: opts.topic, sceneCount: opts.sceneCount });
  treatment.scenes = treatment.scenes.slice(0, clampScenes(tmpl, opts.sceneCount ?? treatment.scenes.length));
  await ckpt({ ckTreatment: JSON.stringify(treatment) });

  // Cast bible + child-safe phrase woven into every seed + motion prompt so the
  // characters and tone stay consistent across the whole film.
  const castBible = treatment.cast && treatment.cast.length ? `Recurring cast, keep EVERY character identical in every scene: ${treatment.cast.join("; ")}.` : "";
  const safePhrase = tmpl.childSafe ? "Wholesome, child-safe, G-rated, bright and friendly. " : "";

  // CAST REFERENCE (character-locked templates): render ONE cast sheet up front,
  // then condition every scene's seed on it so the characters keep the same look.
  // Checkpointed so a restart never re-bills it; fail-open to text-only seeds.
  let castRefAbs: string | undefined;
  if (tmpl.referenceSeed && castBible) {
    let castRef: string | null = resume.ckCastRef && resume.ckCastRef.trim() ? resume.ckCastRef : null;
    if (!castRef) {
      try { castRef = await renderCreativeSeed(`${safePhrase}Character reference sheet: ${castBible} ${tmpl.sceneHint}. All characters together, full body, clean neutral bright background, character-design sheet.`, "9:16"); }
      catch { castRef = null; }
      if (castRef) await ckpt({ ckCastRef: castRef });
    }
    if (castRef) castRefAbs = castRef.startsWith("http") ? castRef : `${base}${castRef}`;
  }

  // 2) PER-SCENE CLIPS — seed still → i2v clip (default engine). Banked
  //    contiguously so a restart keeps finished clips.
  const clips: string[] = (resume.ckClips || []).filter((p) => p && fs.existsSync(p));
  for (let i = clips.length; i < treatment.scenes.length; i++) {
    const scene = treatment.scenes[i];
    const outPath = path.join(RENDERS(), `film-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp4`);
    const seedPrompt = `${safePhrase}${scene.visual}. ${castBible} ${tmpl.sceneHint}. Richly detailed, high quality.`;

    // Scene SEED still (/renders URL). Reference-conditioned when we have a cast
    // sheet (keeps characters consistent); else text-to-image. Absolutize for the
    // i2v provider fetch.
    let seedUrl: string | null = null;
    for (let a = 0; a < 2 && !seedUrl; a++) {
      try {
        seedUrl = castRefAbs
          ? ((await renderStyledSeed(seedPrompt, castRefAbs, "9:16")) || (await renderCreativeSeed(seedPrompt, "9:16")))
          : await renderCreativeSeed(seedPrompt, "9:16");
      } catch { /* retry once */ }
    }
    const seedAbs = seedUrl ? (seedUrl.startsWith("http") ? seedUrl : `${base}${seedUrl}`) : undefined;

    // Animate the seed. Up to 2 tries; falls back to a static clip of the seed
    // so a flaky i2v tick never drops a scene the merchant paid for.
    let made = false;
    if (seedAbs) {
      const motion = `${safePhrase}${scene.visual}. ${castBible} ${tmpl.sceneHint}. Smooth, confident cinematic camera motion, vertical 9:16. Add no text, caption, logo or watermark of your own.`;
      for (let a = 0; a < 2 && !made; a++) {
        try {
          const created = await animateCreate(undefined, { startImage: seedAbs, prompt: motion, durationSec: CLIP_SECONDS });
          const clipUrl = await animatePoll(created.id, CLIP_POLL_MS, `film-clip-${i}`);
          await download(clipUrl, outPath);
          made = fs.existsSync(outPath) && ffprobeDuration(outPath) > 1;
        } catch { if (a < 1) await new Promise((r) => setTimeout(r, 1500)); }
      }
      // Fallback: static clip from the seed still (derive its disk path).
      if (!made && seedUrl && seedUrl.startsWith("/renders/")) {
        const stillDisk = path.join(RENDERS(), path.basename(seedUrl));
        if (fs.existsSync(stillDisk)) made = await stillToClip(stillDisk, outPath);
      }
    }
    if (!made) {
      // No seed and no clip: a last-resort neutral frame so assembly never dies
      // on a single unrenderable scene.
      const neutral = path.join(RENDERS(), `bg-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.jpg`);
      try {
        const c = await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=0x14201A:s=720x1280", "-frames:v", "1", neutral]);
        if (c.status === 0 && fs.existsSync(neutral)) made = await stillToClip(neutral, outPath);
      } catch { /* fall through */ }
    }
    if (!made) throw new Error(`[film] scene ${i + 1} could not render`);
    clips.push(outPath);
    await ckpt({ ckClips: clips });
  }
  if (!clips.length) throw new Error("[film] no scenes rendered");

  // 3) MUSIC TRACK (best-effort — ships silent rather than failing).
  let musicPath: string | null = resume.ckMusic && fs.existsSync(resume.ckMusic) ? resume.ckMusic : null;
  if (!musicPath) {
    try { musicPath = await musicBedToDisk(`${treatment.musicMood || tmpl.musicHint}, instrumental, loopable`); await ckpt({ ckMusic: musicPath }); }
    catch (e) { console.error("[film] music failed (continuing silent):", (e as Error).message); musicPath = null; }
  }

  // 4) ASSEMBLE → one 720x1280 MP4.
  let fontFile = path.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");
  try { fontFile = await resolveTextFont(treatment.scenes.map((s) => s.caption || "").join(" ")); } catch { /* keep Poppins */ }
  const outName = `film-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp4`;
  const outPath = path.join(RENDERS(), outName);
  await assembleFilm({
    clips,
    captions: tmpl.captions ? treatment.scenes.map((s) => s.caption) : treatment.scenes.map(() => undefined),
    musicPath, fontFile, outPath, jobId,
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
      title: `${tmpl.name} — ${(treatment.title || opts.topic || "").slice(0, 60)}`,
      bodyJson: JSON.stringify({ style: "FILM", videoUrl: storedUrl, prompt: opts.topic || "", treatment }),
      metaJson: JSON.stringify({ kind: "film", template: tmpl.key, section: opts.section || "creator", scenes: clips.length, aspect: "vertical" }),
    },
  });
  return asset.id;
}
