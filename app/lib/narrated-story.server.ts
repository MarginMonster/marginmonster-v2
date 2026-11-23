/* NARRATED STORIES — one storyteller's voice over a run of pictures, with the words on screen.
 *
 * The owner, 2026-11-17: "We also need to add routes for your stereotypical ai narrated story models
 * (cheaper and popular) either by toggle or by new cards and routes". In Movie Maker a story format can
 * be told two ways: ACTED (the cast speak on camera — film-dialogue.server.ts) or NARRATED (this file).
 *
 * What it costs us, and why it is the cheap, quick one: an acted minute is six generated video clips;
 * a narrated minute is one narration, one alignment pass, six stills and a music bed — about a third of
 * a dollar, done in a couple of minutes.
 *
 *   1. STORY     the approved treatment (each scene: the picture, and the narrator's words for it)
 *   2. VOICE     the narrator reads it — a stock voice, the maker's own, or a PERFORMED character voice
 *                (the Keeper's hollow voice telling a horror story is the point of having one)
 *   3. TIMING    the narration's real word timings → each picture is up exactly as long as its words
 *   4. PICTURES  one still a scene; cast members the maker picked are drawn from their own pictures
 *   5. CUT       a slow move on every still, captions in the chosen style, music ducked under the voice
 *
 * The plain logic (windows, caption cards, the filters) is in narrated-core.ts, where it is tested. */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db.server";
import { checkpointJob, downloadBuffer, ffprobeDuration, repCreate, repPoll, resolveTextFont, runFfmpeg } from "./ugc-ad-pipeline.server";
import { persistRemote, renderCreativeSeed, repRun } from "./image-generation.server";
import { createWhisperx, wordsFromWhisperx } from "./faceless-video.server";
import { musicBedToDisk } from "./music-generation.server";
import { mirrorRender } from "./object-storage.server";
import { voiceLangOpts, normalizeContentLang } from "./content-lang";
import { AVATAR_VOICE_IDS } from "./avatar-voice-catalog";
import { characterVoice, isCharacterVoice } from "./character-voices";
import { heroName } from "./film-heroes";
import { trimTitle } from "./text-trim";
import { NOTHING_WRITTEN, ONE_PICTURE, noLettering, oneMoment, parseStoryCast, parseStoryPanels, storyCastPrompt, storyFaults, storyFix, storyPanelsPrompt, type StoryCheck } from "./story-picture";
import { clampNarrated, filmTemplate, previewFilmTreatment, type FilmTreatment } from "./film-engine.server";
import { castForMeta, episodeTitle, seriesMeta, type SeriesBrief } from "./film-series";
import { barBox, barsIn, boldCards, keepToldScenes, captionFilters, captionStyleOf, entryName, frameWords, kenBurns, namedIn, sceneCast, sceneWindows, scriptWordTimes, storyFrame, subtitleCards, subtitleChars, type CaptionStyle, type Card, type Window, type WordT } from "./narrated-core";

const RENDERS = () => path.join(process.cwd(), "data", "renders");
const rid = () => crypto.randomBytes(6).toString("hex");
/** A breath after the last word before the video ends. */
const TAIL_S = 0.8;

/** A cast member the maker picked: their picture is what they look like in every scene they are in. */
export type StoryCast = Array<{ name: string; faceUrl?: string | null; kind?: "person" | "cartoon" | "monster"; look?: string }>;

/** The narrator a story format is told by unless the maker picks another: a voice that suits the genre.
 *  Horror is told by the Hollow voice — a creature voice the owner approved, and exactly what a
 *  scary-story narrator should sound like. */
export const DEFAULT_NARRATOR: Record<string, string> = {
  horror: "char:keeper",
  moral: "English_Trustworth_Man",
  kidstv: "English_CalmWoman",
  testmovie: "English_ManWithDeepVoice",
};
export const narratorFor = (template: string | undefined, picked?: string | null): string => {
  const want = (picked || "").trim();
  if (want && (isCharacterVoice(want) || AVATAR_VOICE_IDS.has(want))) return want;
  return DEFAULT_NARRATOR[template || ""] || "English_Trustworth_Man";
};

/** What a picture model must keep about the characters it is shown. Said once, for people and
 *  creatures alike — and it draws ONLY who the scene names, whoever else is on a reference. */
const CAST_LOCK = "CRITICAL: every character taken from a reference image is the EXACT same one here — the same face, body, colours, fur or skin, markings, hair and clothing, and nothing added to what it wears. A creature stays a creature and a cartoon character stays a cartoon character: never made human, never redrawn in another style. A real person stays the exact same individual at the same age. Each keeps its own colours whatever this scene's lighting. Draw ONLY the characters named for this picture — nobody else from the reference images.";

/** One picture, on the everyday picture model, from a prompt of any length (the shared helpers cut a
 *  prompt at ~460 characters, which is where a scene's cast notes live). Null when it cannot be drawn. */
async function drawScene(prompt: string, refs: string[], aspect: string): Promise<string | null> {
  try {
    const url = await repRun("google/nano-banana", { prompt: `${frameWords(aspect)} ${prompt} No watermark, no signature.`, ...(refs.length ? { image_input: refs } : {}), aspect_ratio: aspect, output_format: "jpg" }, 150_000);
    return await persistRemote(url, "jpg");
  } catch (e) {
    console.error(`[narrated] a scene picture failed (${refs.length} refs): ${e instanceof Error ? e.message.slice(0, 140) : e}`);
    return null;
  }
}

/** A picture that came back with black bars baked in (a wide composition inside a tall frame)? */
async function letterboxed(rendersUrl: string | null): Promise<boolean> {
  if (!rendersUrl) return false;
  const file = path.join(RENDERS(), path.basename(rendersUrl.split("?")[0]));
  if (!fs.existsSync(file)) return false;
  try { return barsIn((await runFfmpeg(["-loop", "1", "-i", file, "-vf", "cropdetect=limit=10:round=2:reset=0", "-frames:v", "5", "-f", "null", "-"])).stderr); }
  catch { return false; }
}

/** One still per scene. WHO is in a picture is whoever its VISUAL names (see sceneCast) — a scene that
 *  names nobody is drawn with nobody. Cast the maker picked are drawn FROM their own pictures; the
 *  story's other recurring characters from one cast sheet, so they look the same throughout. `only`
 *  re-draws a single scene. Returns /renders URLs made absolute (null where a still could not be made). */
export async function narratedSceneSeeds(o: {
  template?: string; treatment: FilmTreatment; cast?: StoryCast; aspect?: string; only?: number; castRef?: string | null;
}): Promise<{ sceneImgs: (string | null)[]; castRef: string | null }> {
  const tmpl = filmTemplate(o.template);
  const { aspect } = storyFrame(o.aspect);
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const abs = (u: string | null | undefined): string | null => (u ? (u.startsWith("http") ? u : `${base}${u}`) : null);
  const safe = tmpl.childSafe ? "Wholesome, child-safe, G-rated, bright and friendly. " : "";
  const picked = (o.cast || []).filter((c) => c && c.name && c.faceUrl);
  // the story's recurring characters nobody gave a picture to
  const others = (o.treatment.cast || []).filter((e) => !!e && !picked.some((c) => namedIn(c.name, entryName(e)) || namedIn(entryName(e), c.name)));
  const scenes = o.treatment.scenes;
  const todo = typeof o.only === "number" ? [o.only].filter((i) => i >= 0 && i < scenes.length) : scenes.map((_, i) => i);
  const who = todo.map((i) => sceneCast(scenes[i]?.visual || "", picked.map((c) => c.name), others));

  // ONE sheet of the unpictured characters, only if a scene being drawn needs one of them
  let castRef = o.castRef ? abs(o.castRef) : null;
  if (!castRef && who.some((w) => w.others.length)) {
    castRef = abs(await drawScene(`${safe}${tmpl.sceneHint}. A character sheet: ${others.join("; ")} — standing side by side, full body, each clearly separate, clear consistent faces, plain neutral background, IN THE EXACT ART STYLE of the rest of the story. No text.`, [], aspect));
  }

  const out: (string | null)[] = new Array(scenes.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const k = next++;
      const i = todo[k];
      const scene = scenes[i];
      const sheet = who[k].others.length && castRef ? castRef : null;
      const here = who[k].picked.map((p) => picked[p]).slice(0, sheet ? 2 : 3);
      const refs = [...here.map((c) => abs(c.faceUrl)).filter((u): u is string => !!u), ...(sheet ? [sheet] : [])];
      const notes: string[] = [];
      here.forEach((c, n) => notes.push(`${c.name} is the character in reference image ${n + 1}${c.look ? ` (${c.look.slice(0, 160)})` : ""}.`));
      if (sheet) notes.push(`Reference image ${here.length + 1} is a sheet of other characters: from it take ONLY ${who[k].others.map((e) => e.slice(0, 200)).join("; and ")}.`);
      else if (who[k].others.length) notes.push(`In this picture: ${who[k].others.map((e) => e.slice(0, 200)).join("; and ")}.`);
      // THE WORDS THE PICTURE IS DRAWN FROM are tidied first (story-picture.ts): one moment, nothing written.
      const written = (scene.visual || "").replace(/\s+/g, " ").trim();
      const visual = oneMoment(noLettering(written));
      const twoMoments = oneMoment(written) !== written;
      const prompt = `${safe}${visual.slice(0, 600)}${/[.!?]$/.test(visual) ? "" : "."} Style: ${tmpl.sceneHint}.${tmpl.faceMood ? ` ${tmpl.faceMood}` : ""} ${notes.join(" ")}${refs.length ? ` ${CAST_LOCK}` : ""} ${ONE_PICTURE} ${NOTHING_WRITTEN}`;
      // …and THE PICTURE IS LOOKED AT before it is kept: is each of the maker's cast in it (never asked
      // about clothes — a story dresses people for the part), and is it one picture. The cast is looked for
      // whenever the scene has any; panels only where the words described two moments (that is when a
      // picture model stacks two views). A look that cannot be made, or says nothing, keeps the picture.
      const castPics = here.map((c) => abs(c.faceUrl)).filter((u): u is string => !!u);
      const lookAt = async (got: string): Promise<StoryCheck | null> => {
        const pic = abs(got);
        if (!pic || (!castPics.length && !twoMoments)) return null;
        try {
          const { anthropicVision } = await import("./anthropic.server");
          const [castRaw, panelsRaw] = await Promise.all([
            castPics.length ? anthropicVision(storyCastPrompt(castPics.length), [pic, ...castPics], { maxTokens: 500, model: "claude-sonnet-4-6" }) : Promise.resolve(""),
            twoMoments ? anthropicVision(storyPanelsPrompt(), [pic], { maxTokens: 320, model: "claude-sonnet-4-6" }) : Promise.resolve(""),
          ]);
          const seen = castPics.length ? parseStoryCast(String(castRaw || ""), castPics.length) : [];
          const panels = twoMoments ? parseStoryPanels(String(panelsRaw || "")) : false;
          if (seen == null && panels == null) return null;
          return { seen: seen || castPics.map(() => true), panels: panels === true };
        } catch (e) {
          console.error(`[narrated] scene ${i + 1}: the picture could not be looked at, keeping it: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
          return null;
        }
      };
      // up to three goes: a failed draw is tried again, so is a picture that came back letterboxed (kept
      // only if every go did, and then the cut crops into it), and so is one the look found wrong — told
      // what was wrong. The best of the goes is kept, so a picky look can never leave a scene bare.
      let img: string | null = null;
      let barred: string | null = null;
      let best: { img: string; faults: number } | null = null;
      let fix = "";
      for (let a = 0; a < 3 && !img; a++) {
        const got = await drawScene(`${prompt}${fix}`, refs, aspect);
        if (got && (await letterboxed(got))) { barred = got; console.error(`[narrated] scene ${i + 1} came back letterboxed — drawing it again`); continue; }
        if (!got) { if (a >= 1) break; continue; } // two plain failures: stop asking this way
        const seenAs = await lookAt(got);
        const faults = seenAs ? storyFaults(seenAs) : 0;
        if (!faults) { img = got; break; }
        if (!best || faults < best.faults) best = { img: got, faults };
        fix = storyFix(seenAs!, here.map((c) => c.name));
        console.log(`[narrated] scene ${i + 1} try ${a + 1}: ${seenAs!.panels ? "split into panels" : ""}${seenAs!.panels && seenAs!.seen.includes(false) ? ", " : ""}${seenAs!.seen.includes(false) ? `cast not in it (${here.filter((_, n) => !seenAs!.seen[n]).map((c) => c.name).join(", ")})` : ""} — drawing it again`);
      }
      if (!img && best) img = best.img;
      if (!img) img = barred;
      // the lenient path last: its safety and outage fallbacks still get a picture (without the cast's own looks)
      if (!img) { try { img = await renderCreativeSeed(`${safe}${(scene.visual || "").slice(0, 300)}. ${tmpl.sceneHint}`, aspect); } catch { img = null; } }
      out[i] = img;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, todo.length) }, () => worker()));
  return { sceneImgs: out.map((u) => abs(u)), castRef };
}

/** The narrator reads the whole story. Returns the mp3 on the renders disk and a URL a provider can
 *  fetch it from (the aligner needs one). A character voice is PERFORMED (character-voice.server.ts); a
 *  stock or cloned voice is read by the speech model. */
export async function narrate(text: string, voice: string, lang: string | null | undefined): Promise<{ path: string; url: string }> {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  if (isCharacterVoice(voice)) {
    const { speakCharacter } = await import("./character-voice.server");
    const made = await speakCharacter(voice, text, { lang: normalizeContentLang(lang), stage: "narration" });
    return { path: made.path, url: `${base}${made.url}` };
  }
  let url = "";
  try { url = await repPoll(await repCreate("minimax/speech-02-hd", { text, voice_id: voice, ...voiceLangOpts(lang) }), 4 * 60_000, "narration"); }
  catch { url = await repPoll(await repCreate("minimax/speech-02-turbo", { text, voice_id: voice }), 4 * 60_000, "narration"); }
  const buf = await downloadBuffer(url);
  if (buf.length < 8_000) throw new Error("[narrated] the narration came back empty");
  fs.mkdirSync(RENDERS(), { recursive: true });
  const name = `nvo-${Date.now()}-${rid()}.mp3`;
  const file = path.join(RENDERS(), name);
  fs.writeFileSync(file, buf);
  try { await mirrorRender(name, buf); } catch { /* the disk copy is what is used */ }
  return { path: file, url: base ? `${base}/renders/${name}` : url };
}

/** Put it together: each still for its window with a slow move, captions, the voice over a ducked
 *  music bed. Degrades rather than fails — drop the captions, then the moves and the music — so a
 *  drawing hiccup never costs a finished story. */
export async function assembleNarrated(o: {
  stills: string[]; windows: Window[]; voPath: string; musicPath: string | null; cards: Card[]; style: CaptionStyle;
  fontFile: string; W: number; H: number; outPath: string; jobId?: string;
}): Promise<void> {
  const beat = async () => { if (o.jobId) await checkpointJob(o.jobId, { ckBeat: Date.now() }); };
  const N = o.stills.length;
  const FPS = 30;
  const total = o.windows[N - 1].t1 + TAIL_S;
  // every picture for its window (the last holds through the tail), in whole frames that add up exactly
  const frames = o.windows.map((w, i) => Math.round((i === N - 1 ? total : w.t1) * FPS) - Math.round(w.t0 * FPS));
  const norm: string[] = [];
  for (const s of o.stills) {
    const n = `${s}.n.jpg`;
    // a picture that was kept with black bars baked in has them cropped off here, not shown
    let crop: string[] = [];
    try { const box = barBox((await runFfmpeg(["-loop", "1", "-i", s, "-vf", "cropdetect=limit=10:round=2:reset=0", "-frames:v", "5", "-f", "null", "-"])).stderr); if (box) crop = ["-vf", `crop=${box.w}:${box.h}:${box.x}:${box.y}`]; } catch { /* as it is */ }
    const c = await runFfmpeg(["-y", "-i", s, ...crop, "-frames:v", "1", n]);
    norm.push(c.status === 0 && fs.existsSync(n) ? n : s);
  }
  await beat();
  const hasMusic = !!o.musicPath && fs.existsSync(o.musicPath);
  const captions = captionFilters(o.cards, o.style, o.fontFile, o.W, o.H);

  const build = (useCaptions: boolean, moving: boolean, useMusic: boolean): string[] => {
    const a: string[] = ["-y"];
    norm.forEach((s, i) => { if (moving) a.push("-i", s); else a.push("-loop", "1", "-t", (frames[i] / FPS).toFixed(3), "-i", s); });
    a.push("-i", o.voPath);
    const musicOn = useMusic && hasMusic;
    if (musicOn) a.push("-stream_loop", "-1", "-i", o.musicPath!);
    const f: string[] = [];
    norm.forEach((_, i) => {
      f.push(moving
        ? `[${i}:v]${kenBurns(i, frames[i], o.W, o.H)}[c${i}]`
        : `[${i}:v]scale=${o.W}:${o.H}:force_original_aspect_ratio=increase,crop=${o.W}:${o.H},setsar=1,fps=${FPS}[c${i}]`);
    });
    f.push(`${norm.map((_, i) => `[c${i}]`).join("")}concat=n=${N}:v=1:a=0[vcat]`);
    let v = "[vcat]";
    if (useCaptions && captions.length) { f.push(`[vcat]${captions.join(",")}[vf]`); v = "[vf]"; }
    f.push(`[${N}:a]aresample=44100,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100,apad=pad_dur=${TAIL_S}[vo]`);
    let aMap = "[vo]";
    if (musicOn) {
      f.push(`[${N + 1}:a]aresample=44100,volume=0.18,afade=t=out:st=${Math.max(0, total - 1.6).toFixed(2)}:d=1.6[bg]`);
      f.push(`[vo][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`);
      aMap = "[aout]";
    }
    a.push("-filter_complex", f.join(";"), "-map", v, "-map", aMap, "-t", total.toFixed(2),
      "-threads", "2", "-filter_complex_threads", "2",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", o.outPath);
    return a;
  };
  const produced = (): boolean => { try { return fs.existsSync(o.outPath) && ffprobeDuration(o.outPath) > 1; } catch { return false; } };
  const rungs: Array<[boolean, boolean, boolean]> = [[true, true, true]];
  if (captions.length) rungs.push([false, true, true]);
  rungs.push([false, false, false]);
  let lastErr = "";
  for (const [cap, kb, mus] of rungs) {
    const run = await runFfmpeg(build(cap, kb, mus));
    if (run.status === 0 && produced()) {
      if (!cap && captions.length) console.error("[narrated] the captions could not be drawn — the story shipped without them");
      return;
    }
    lastErr = (run.stderr || "").slice(-240);
    await beat();
  }
  throw new Error(`[narrated] ffmpeg failed after ${rungs.length} rungs: ${lastErr}`);
}

export async function generateNarratedStory(opts: {
  shopId: string;
  template?: string;
  topic?: string;
  /** The maker-approved story — told word for word. */
  treatment?: FilmTreatment;
  sceneCount?: number;
  /** The narrator: a character voice ("char:…"), a stock voice id, or one of the shop's own voices. */
  narrator?: string;
  captions?: string;
  aspect?: string;
  cast?: StoryCast;
  /** Stills the maker previewed and approved — used as they are. Index-aligned with the scenes. */
  approvedSceneImgs?: (string | null)[];
  section?: string;
  jobId?: string;
  /** NEXT EPISODE (film-series.ts): the series this story continues — told to the writer when the story
   *  is written here, and stored on the asset as meta.series. */
  series?: SeriesBrief | null;
  /** TOLD AGAIN IN ANOTHER LANGUAGE (story-translate.ts): the language to tell it in — the narrator's
   *  voice, the timing and the words on screen all follow it. Unset = the shop's own content language. */
  lang?: string | null;
  /** …and the story it is a re-telling of (its asset id), recorded on the new one. */
  translatedFrom?: string | null;
  resume?: { ckTreatment?: string; ckApproved?: string; ckVoPath?: string; ckVoUrl?: string; ckWords?: string; ckImages?: string; ckMusic?: string };
}): Promise<string> {
  const tmpl = filmTemplate(opts.template);
  const { aspect, W, H } = storyFrame(opts.aspect);
  const style = captionStyleOf(opts.captions, "bold");
  const jobId = opts.jobId;
  const resume = opts.resume || {};
  const ckpt = async (patch: Record<string, unknown>) => { if (jobId) await checkpointJob(jobId, patch); };
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const lang = opts.lang || (await db.shop.findUnique({ where: { id: opts.shopId }, select: { contentLang: true } }))?.contentLang;

  // 1) THE STORY
  let treatment: FilmTreatment;
  if (resume.ckTreatment) treatment = JSON.parse(resume.ckTreatment);
  else if (opts.treatment && opts.treatment.scenes?.length) treatment = opts.treatment;
  else treatment = await previewFilmTreatment({ shopId: opts.shopId, template: tmpl.key, topic: opts.topic, sceneCount: opts.sceneCount, contentLang: lang, mode: "narrated", cast: (opts.cast || []).map((c) => ({ name: c.name, desc: c.look })), series: opts.series });
  // an episode is called "<Series> — Episode <N>", however its story was written
  if (opts.series) treatment.title = episodeTitle(opts.series.title, opts.series.episode, treatment.title);
  // The scenes it is told in, each with the picture the maker approved for it. On a RESTART both were
  // saved together (ckApproved exists only then). NB the approved story arrives in resume.ckTreatment on
  // the first run too — that field alone does not mean a restart (the first live film re-drew every
  // approved picture because this once assumed it did).
  let approved: (string | null)[] = [];
  let restored = false;
  if (resume.ckApproved) { try { const a = JSON.parse(resume.ckApproved); if (Array.isArray(a)) { approved = a as (string | null)[]; restored = true; } } catch { /* fall through */ } }
  if (!restored) {
    const kept = keepToldScenes(treatment.scenes, opts.approvedSceneImgs || [], clampNarrated(opts.sceneCount ?? treatment.scenes.length));
    treatment.scenes = kept.scenes;
    approved = kept.approved;
  }
  if (treatment.scenes.length < 2) throw new Error("[narrated] the story has nothing to tell");
  await ckpt({ ckTreatment: JSON.stringify(treatment), ckApproved: JSON.stringify(approved) });
  const lines = treatment.scenes.map((s) => (s.caption || "").replace(/\s+/g, " ").trim());

  // 2) THE VOICE — a narrator the shop may use. One of its own voices is checked HERE, at render.
  let narrator = narratorFor(tmpl.key, opts.narrator);
  const wanted = (opts.narrator || "").trim();
  if (wanted && wanted !== narrator) {
    const mine = await db.voiceClone.findFirst({ where: { shopId: opts.shopId, voiceId: wanted, status: "ready" }, select: { voiceId: true } });
    if (mine?.voiceId) narrator = mine.voiceId;
  }
  let voPath = resume.ckVoPath && fs.existsSync(resume.ckVoPath) ? resume.ckVoPath : "";
  let voUrl = voPath ? (resume.ckVoUrl || "") : "";
  if (!voPath) {
    const made = await narrate(lines.join(" "), narrator, lang);
    voPath = made.path; voUrl = made.url;
    await ckpt({ ckVoPath: voPath, ckVoUrl: voUrl });
  }
  const voDur = ffprobeDuration(voPath);
  if (!(voDur > 2)) throw new Error("[narrated] the narration is too short to be a story");

  // 3) TIMING — the narration's own word timings (English; other languages share the track by length)
  let words: WordT[] = [];
  if (resume.ckWords) { try { words = JSON.parse(resume.ckWords) as WordT[]; } catch { words = []; } }
  else {
    if (normalizeContentLang(lang) === "en" && voUrl) {
      try { words = wordsFromWhisperx(await repPoll(await createWhisperx(voUrl), 5 * 60_000, "narration-align")); }
      catch (e) { console.error(`[narrated] alignment failed — pictures and captions are timed by length instead: ${e instanceof Error ? e.message.slice(0, 140) : e}`); }
    }
    await ckpt({ ckWords: JSON.stringify(words) });
  }
  // a creature chain can lead the voice in by a second: every heard word is where it is IN THE FILE,
  // so nothing needs shifting — the windows are simply read off what was heard
  const windows = sceneWindows(lines, words, voDur);
  // the captions say what was WRITTEN, timed by what was heard (a transcriber's spelling never reaches the screen)
  const timed = words.length ? scriptWordTimes(lines, words, windows) : undefined;
  const cards: Card[] = style === "bold"
    ? (timed ? boldCards(timed) : subtitleCards(lines.map((l) => l.toUpperCase()), windows, 18))
    : style === "subtitles" ? subtitleCards(lines, windows, subtitleChars(W, H), timed) : [];

  // 4) THE PICTURES — the ones the maker approved, else drawn now
  let imgs: (string | null)[] = [];
  if (resume.ckImages) { try { imgs = JSON.parse(resume.ckImages) as (string | null)[]; } catch { imgs = []; } }
  if (imgs.length !== treatment.scenes.length) {
    if (approved.length === treatment.scenes.length && approved.every(Boolean)) imgs = approved;
    else {
      const drawn = await narratedSceneSeeds({ template: tmpl.key, treatment, cast: opts.cast, aspect });
      imgs = treatment.scenes.map((_, i) => approved[i] || drawn.sceneImgs[i] || null);
    }
    await ckpt({ ckImages: JSON.stringify(imgs) });
  }
  // every scene needs a picture on the disk: fetch what is not there, and let a missing one borrow its neighbour's
  const stills: string[] = [];
  for (let i = 0; i < imgs.length; i++) {
    let file = "";
    const u = imgs[i];
    if (u) {
      const local = path.join(RENDERS(), path.basename(u.split("?")[0]));
      if (fs.existsSync(local)) file = local;
      else {
        try {
          const buf = await downloadBuffer(u.startsWith("http") ? u : `${base}${u}`);
          if (buf.length > 3000) { file = path.join(RENDERS(), `nst-${Date.now()}-${i}-${rid()}.jpg`); fs.writeFileSync(file, buf); }
        } catch { /* falls through to a neighbour */ }
      }
    }
    stills.push(file);
  }
  for (let i = 0; i < stills.length; i++) if (!stills[i]) stills[i] = stills.slice(0, i).reverse().find(Boolean) || stills.slice(i + 1).find(Boolean) || "";
  if (stills.some((s) => !s)) throw new Error("[narrated] no pictures could be made for the story");

  // 5) MUSIC (the story ships without it rather than fail) and THE CUT
  let musicPath: string | null = resume.ckMusic && fs.existsSync(resume.ckMusic) ? resume.ckMusic : null;
  if (!musicPath) {
    try { musicPath = await musicBedToDisk(`${treatment.musicMood || tmpl.musicHint}, instrumental, loopable`); await ckpt({ ckMusic: musicPath }); }
    catch (e) { console.error(`[narrated] no music bed (continuing without): ${e instanceof Error ? e.message.slice(0, 120) : e}`); }
  }
  let fontFile = path.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");
  try { fontFile = await resolveTextFont(lines.join(" ")); } catch { /* keep Poppins */ }
  const outName = `nar-${Date.now()}-${rid()}.mp4`;
  const outPath = path.join(RENDERS(), outName);
  await assembleNarrated({ stills, windows, voPath, musicPath, cards, style, fontFile, W, H, outPath, jobId });
  try { await mirrorRender(outName, fs.readFileSync(outPath)); } catch { /* non-fatal */ }

  const voiceName = characterVoice(narrator)?.label || narrator;
  const asset = await db.asset.create({
    data: {
      shopId: opts.shopId,
      type: "VIDEO_AD",
      status: "PENDING",
      // (named after the HERO it was made as — a narrated Short Film is a "Short Story": film-heroes.ts)
      title: `${heroName(tmpl.key, true, tmpl.name)} — ${trimTitle(treatment.title || opts.topic || "a story", 60)}`,
      bodyJson: JSON.stringify({ style: "NARRATED", videoUrl: `/renders/${outName}`, prompt: opts.topic || "", script: lines.join(" "), treatment }),
      metaJson: JSON.stringify({
        kind: "narrated", template: tmpl.key, section: opts.section || "creator", scenes: stills.length,
        aspect, captions: style, narrator, narratorName: voiceName, seconds: Math.round(voDur + TAIL_S),
        // which voice ACTUALLY told it, and whether its pictures were timed to the words or by length
        timedToWords: words.length > 0,
        // how many of its pictures were the ones approved in the storyboard (the rest were drawn at render)
        approvedPictures: approved.filter(Boolean).length,
        // NEXT EPISODE (film-series.ts): who was cast (so the next episode casts them again), and the
        // series this story is an episode of — an ordinary story has no `series`
        cast: castForMeta(opts.cast),
        ...(opts.series ? { series: seriesMeta(opts.series) } : {}),
        // TOLD AGAIN IN ANOTHER LANGUAGE (story-translate.ts): the language this one is told in, and what a
        // re-telling reuses — its pictures (one per scene, on our own disk) and its music bed. A re-telling
        // says which story it came from.
        lang: normalizeContentLang(lang),
        pictures: stills.map((f) => `/renders/${path.basename(f)}`),
        ...(musicPath ? { music: path.basename(musicPath) } : {}),
        ...(opts.translatedFrom ? { translatedFrom: String(opts.translatedFrom).slice(0, 64) } : {}),
      }),
    },
  });
  return asset.id;
}
