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
import { captionGraph } from "./caption-burn.server";
import { listenAgain, listenQuality, listenedWords, sureWords, timingRecord, type Span } from "./narrated-core";
import { persistRemote, renderCreativeSeed, repRun } from "./image-generation.server";
import { createWhisperx } from "./faceless-video.server";
import { musicBedToDisk } from "./music-generation.server";
import { mirrorRender } from "./object-storage.server";
import { voiceLangOpts, normalizeContentLang } from "./content-lang";
import { AVATAR_VOICE_IDS } from "./avatar-voice-catalog";
import { characterVoice, isCharacterVoice } from "./character-voices";
import { heroName } from "./film-heroes";
import { posterFilters, posterLayout, posterName, posterScene } from "./story-poster";
import { trimTitle } from "./text-trim";
import { readVoiceSound } from "./voice-sound.server";
import { STORY_MOTION_ENGINE, fitMotion, motionChain, seedName } from "./story-motion";
import { animateScenes, storyMotionOn, type MotionResult } from "./story-motion.server";
import { NOTHING_WRITTEN, ONE_PICTURE, PLACE_FRAMING, PLACE_SHEET_ASPECT, PORTRAIT_ASPECT, STORY_CAST_MAX, STORY_MODEL, castEntry, castStillIn, castToken, noLettering, oneMoment, parseStoryCast, parseStoryPanels, placeKey, placeNote, placeSheetPrompt, placesStillIn, portraitPrompt, readCastToken, recurringPlaces, sameCharacter, sceneModel, storyCastPrompt, storyFaults, storyFix, storyPanelsPrompt, type StoryCastRef, type StoryCheck, type StoryKept, type StoryPlaceRef } from "./story-picture";
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
async function drawScene(prompt: string, refs: string[], aspect: string, people = refs.length): Promise<string | null> {
  // (three people from three pictures go to the stronger model — story-picture.ts → sceneModel; if it
  //  cannot be reached, the everyday one still draws the scene. `people`: how many of the references are
  //  characters — a place's design sheet is not one: two people and their place drew right on the
  //  everyday model four times out of four)
  const model = sceneModel(people);
  const run = async (m: string): Promise<string> => persistRemote(await repRun(m, { prompt: `${frameWords(aspect)} ${prompt} No watermark, no signature.`, ...(refs.length ? { image_input: refs } : {}), aspect_ratio: aspect, output_format: "jpg", ...(m === STORY_MODEL ? {} : { resolution: "1K" }) }, 150_000), "jpg");
  try {
    return await run(model);
  } catch (e) {
    console.error(`[narrated] a scene picture failed (${refs.length} refs, ${model.split("/")[1]}): ${e instanceof Error ? e.message.slice(0, 140) : e}`);
    if (model === STORY_MODEL) return null;
    try { return await run(STORY_MODEL); } catch { return null; }
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

/** THE POSTER (story-poster.ts): the film's cover on the shelf. One ffmpeg frame — the picture with the most
 *  of the cast in it, cropped to the shelf's shape, with the title and the cast's names. Returns its
 *  /renders address; null when there is nothing to draw it from. Throws when it cannot be drawn (no font
 *  for these words, ffmpeg) — the caller ships the film without one. */
async function makeStoryPoster(o: { stills: string[]; visuals: string[]; names: string[]; title: string; videoName: string }): Promise<string | null> {
  const layout = posterLayout({ title: o.title, cast: o.names });
  if (!layout) return null;
  const k = posterScene(o.visuals, o.names, o.stills.map((s) => !!s && fs.existsSync(s)));
  if (k < 0) return null;
  // (the same resolver the captions use: it THROWS for words no font here can draw — then no poster, never boxes)
  const font = await resolveTextFont([...layout.lines, layout.cast, layout.episode].join(" "));
  const name = posterName(o.videoName);
  const outPath = path.join(RENDERS(), name);
  const r = await runFfmpeg(["-y", "-i", o.stills[k], "-vf", posterFilters(layout, font), "-frames:v", "1", "-q:v", "3", outPath]);
  if (r.status !== 0 || !fs.existsSync(outPath) || fs.statSync(outPath).size < 5000) throw new Error(`poster ffmpeg ${r.status}: ${r.stderr.slice(-200)}`);
  try { await mirrorRender(name, fs.readFileSync(outPath)); } catch { /* non-fatal, as everywhere else */ }
  return `/renders/${name}`;
}

/** One still per scene. WHO is in a picture is whoever its VISUAL names (see sceneCast) — a scene that
 *  names nobody is drawn with nobody. Cast the maker picked are drawn FROM their own pictures; the
 *  story's other recurring characters from one cast sheet, so they look the same throughout. `only`
 *  re-draws a single scene. Returns /renders URLs made absolute (null where a still could not be made). */
export async function narratedSceneSeeds(o: {
  template?: string; treatment: FilmTreatment; cast?: StoryCast; aspect?: string; /** draw only this scene, or only these */ only?: number | number[]; castRef?: string | null;
}): Promise<{ sceneImgs: (string | null)[]; castRef: string | null; /** the story's own characters, each with its portrait — to be shown */ castCards: StoryCastRef[]; /** the places the story comes back to, each with its design sheet — to be shown */ placeCards: StoryPlaceRef[]; /** for each scene drawn: how wrong the picture that was KEPT still is (0 = nothing; null = not drawn here), and what the look read off it */ sceneFaults: (number | null)[]; sceneChecks: (StoryKept | null)[] }> {
  const tmpl = filmTemplate(o.template);
  const { aspect } = storyFrame(o.aspect);
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const abs = (u: string | null | undefined): string | null => (u ? (u.startsWith("http") ? u : `${base}${u}`) : null);
  const safe = tmpl.childSafe ? "Wholesome, child-safe, G-rated, bright and friendly. " : "";
  const picked = (o.cast || []).filter((c) => c && c.name && c.faceUrl);
  // the story's recurring characters nobody gave a picture to
  const others = (o.treatment.cast || []).filter((e) => !!e && !picked.some((c) => namedIn(c.name, entryName(e)) || namedIn(entryName(e), c.name)));
  const scenes = o.treatment.scenes;
  const todo = (Array.isArray(o.only) ? o.only : typeof o.only === "number" ? [o.only] : scenes.map((_, i) => i)).filter((i, k, a) => Number.isInteger(i) && i >= 0 && i < scenes.length && a.indexOf(i) === k);
  const who = todo.map((i) => sceneCast(scenes[i]?.visual || "", picked.map((c) => c.name), others));

  // THE STORY'S OWN CAST (story-picture.ts): every character the story invented that a scene being drawn
  // needs gets ONE portrait of its own — drawn once, carried between the storyboard's calls in `castRef` —
  // and is then cast like a character the maker picked. (They used to share one sheet, and nobody looked
  // whether the man in scene 3 was the man in scene 2.) A storyboard opened before this still carries the
  // address of that one sheet, and is drawn from it the way it was.
  const carried = readCastToken(o.castRef);
  const sheetRef = carried.sheet ? abs(carried.sheet) : null;
  // (only who THIS story still has a character for, and only a portrait that is still on our disk: the
  //  next episode of a series arrives with last episode's cast, and a missing file is drawn again)
  const cards: StoryCastRef[] = castStillIn(carried.refs, others).filter((c) => fs.existsSync(path.join(RENDERS(), path.basename(c.img))));

  // THE STORY'S PLACES (story-picture.ts): a place at least two scenes are set at gets ONE design sheet —
  // drawn once, beside the portraits, carried in the same token — and every scene set there is drawn with
  // it, so the ferry of scene 1 is the ferry of scene 6. (STORY_PLACES=off: places are drawn from words.)
  const placeList = (o.treatment.places || []).filter((e): e is string => typeof e === "string" && !!e.trim());
  const wanted = process.env.STORY_PLACES !== "off" && !sheetRef ? recurringPlaces(scenes.map((s) => s?.visual || ""), placeList) : [];
  const placeCards: StoryPlaceRef[] = placesStillIn(carried.places, placeList).filter((c) => fs.existsSync(path.join(RENDERS(), path.basename(c.img))));
  const sheetFor = (name: string): StoryPlaceRef | undefined => placeCards.find((c) => placeKey(c.name) === placeKey(name));
  const needPlaces = wanted.filter((p) => p.scenes.some((i) => todo.includes(i)) && !sheetFor(p.name));
  // (started now, awaited after the portraits: the two are drawn side by side, so a story's pictures take no longer)
  const sheetsDrawing = Promise.all(needPlaces.map(async (p) => ({ p, img: await drawScene(placeSheetPrompt(p, tmpl.sceneHint, safe), [], PLACE_SHEET_ASPECT) })));

  if (!sheetRef) {
    const need = others
      .filter((e) => who.some((w) => w.others.includes(e)) && !!castEntry(e).name && !cards.some((c) => sameCharacter(c.name, castEntry(e).name)))
      .slice(0, Math.max(0, STORY_CAST_MAX - cards.length));
    const drawn = await Promise.all(need.map(async (e) => ({ e, img: await drawScene(portraitPrompt(e, tmpl.sceneHint, safe), [], PORTRAIT_ASPECT) })));
    // (one more go, on its own, for a portrait that did not come back — the whole story is drawn from it)
    for (const d of drawn) if (!d.img) d.img = await drawScene(portraitPrompt(d.e, tmpl.sceneHint, safe), [], PORTRAIT_ASPECT);
    for (const d of drawn) if (d.img) cards.push({ ...castEntry(d.e), img: d.img });
    if (need.length) console.log(`[narrated] the story's own cast: ${drawn.filter((d) => d.img).length} of ${need.length} portraits drawn (${need.map((e) => entryName(e)).join(", ")})`);
  }
  const cardFor = (e: string): StoryCastRef | undefined => cards.find((c) => sameCharacter(c.name, castEntry(e).name));
  for (const d of await sheetsDrawing) if (d.img) placeCards.push({ name: d.p.name, look: d.p.look, img: d.img });
  if (needPlaces.length) console.log(`[narrated] the story's places: ${needPlaces.filter((p) => sheetFor(p.name)).length} of ${needPlaces.length} design sheets drawn (${needPlaces.map((p) => `${p.name} ×${p.scenes.length}`).join(", ")})`);

  const out: (string | null)[] = new Array(scenes.length).fill(null);
  // A PICTURE KEPT WITH SOMETHING STILL WRONG SAYS SO (the best of three goes can still be missing someone):
  // the storyboard flags that scene and says why, so the maker re-rolls the one that needs it.
  const faultsOut: (number | null)[] = new Array(scenes.length).fill(null);
  const checksOut: (StoryKept | null)[] = new Array(scenes.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const k = next++;
      const i = todo[k];
      const scene = scenes[i];
      // WHO IS DRAWN FROM A PICTURE HERE: the maker's own cast first, then the story's own characters, each
      // from its portrait — three reference pictures at most (an older storyboard's sheet counts as one).
      const sheet = who[k].others.length && sheetRef ? sheetRef : null;
      const chosen = who[k].picked.map((p) => picked[p]).slice(0, sheet ? 2 : 3);
      const own = sheet ? [] : who[k].others.map(cardFor).filter((c): c is StoryCastRef => !!c).slice(0, Math.max(0, 3 - chosen.length));
      const here: Array<{ name: string; look?: string; faceUrl?: string | null }> = [...chosen, ...own.map((c) => ({ name: c.name, look: c.look, faceUrl: c.img }))];
      const people = [...here.map((c) => abs(c.faceUrl)).filter((u): u is string => !!u), ...(sheet ? [sheet] : [])];
      // WHERE IT IS SET: the design sheet of the place this scene's words name, as one more reference —
      // after the people, and not counted as one of them when the picture model is chosen
      const setAt = wanted.find((p) => p.scenes.includes(i));
      const place = setAt ? sheetFor(setAt.name) : undefined;
      const placeUrl = place ? abs(place.img) : null;
      const refs = [...people, ...(placeUrl ? [placeUrl] : [])];
      const notes: string[] = [];
      here.forEach((c, n) => notes.push(`${c.name} is the character in reference image ${n + 1}${c.look ? ` (${c.look.slice(0, 160)})` : ""}.`));
      if (sheet) notes.push(`Reference image ${here.length + 1} is a sheet of other characters: from it take ONLY ${who[k].others.map((e) => e.slice(0, 200)).join("; and ")}.`);
      if (place && placeUrl) { notes.push(placeNote(refs.length, place)); if (here.length) notes.push(PLACE_FRAMING); }
      // (a character with no picture of its own here — its portrait could not be drawn, or it is a fourth
      //  in one scene — is drawn from its words, as every invented character once was)
      const unpictured = sheet ? [] : who[k].others.filter((e) => !own.some((c) => c === cardFor(e)));
      if (unpictured.length) notes.push(`In this picture: ${unpictured.map((e) => e.slice(0, 200)).join("; and ")}.`);
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
      let best: { img: string; faults: number; check: StoryCheck } | null = null;
      let fix = "";
      for (let a = 0; a < 3 && !img; a++) {
        const got = await drawScene(`${prompt}${fix}`, refs, aspect, people.length);
        if (got && (await letterboxed(got))) { barred = got; console.error(`[narrated] scene ${i + 1} came back letterboxed — drawing it again`); continue; }
        if (!got) { if (a >= 1) break; continue; } // two plain failures: stop asking this way
        const seenAs = await lookAt(got);
        const faults = seenAs ? storyFaults(seenAs) : 0;
        if (!faults) { img = got; break; }
        if (!best || faults < best.faults) best = { img: got, faults, check: seenAs! };
        fix = storyFix(seenAs!, here.map((c) => c.name));
        console.log(`[narrated] scene ${i + 1} try ${a + 1}: ${seenAs!.panels ? "split into panels" : ""}${seenAs!.panels && seenAs!.seen.includes(false) ? ", " : ""}${seenAs!.seen.includes(false) ? `cast not in it (${here.filter((_, n) => !seenAs!.seen[n]).map((c) => c.name).join(", ")})` : ""} — drawing it again`);
      }
      if (!img && best) { img = best.img; faultsOut[i] = best.faults; checksOut[i] = { ...best.check, who: here.map((c) => c.name) }; }
      if (!img) img = barred;
      // the lenient path last: its safety and outage fallbacks still get a picture (without the cast's own looks)
      if (!img) { try { img = await renderCreativeSeed(`${safe}${(scene.visual || "").slice(0, 300)}. ${tmpl.sceneHint}`, aspect); } catch { img = null; } }
      out[i] = img;
      if (img && faultsOut[i] == null) faultsOut[i] = 0;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, todo.length) }, () => worker()));
  // (the cast is billed in the story's own order — a character drawn again does not move to the end of the row)
  const billed = (c: StoryCastRef): number => { const k = others.findIndex((e) => sameCharacter(c.name, castEntry(e).name)); return k < 0 ? others.length : k; };
  cards.sort((a, b) => billed(a) - billed(b));
  return { sceneImgs: out.map((u) => abs(u)), castRef: carried.sheet || castToken(cards, placeCards) || null, castCards: cards, placeCards, sceneFaults: faultsOut, sceneChecks: checksOut };
}

/** DRAW ONE CHARACTER AGAIN. The maker does not like how Walter came out: his portrait is dropped, a new one
 *  is drawn, and every scene that names him is drawn again from it — nobody else changes, and no other
 *  scene is touched. Null when there is nothing to do: the story has no such character of its own, no
 *  scene names them, or it is an older storyboard that still draws from one sheet. */
export async function recastStoryCharacter(o: {
  template?: string; treatment: FilmTreatment; cast?: StoryCast; aspect?: string; castRef?: string | null; name: string;
}): Promise<(Awaited<ReturnType<typeof narratedSceneSeeds>> & { scenes: number[] }) | null> {
  const carried = readCastToken(o.castRef);
  if (carried.sheet) return null;
  const entry = (o.treatment.cast || []).find((e) => !!e && sameCharacter(castEntry(e).name, o.name));
  if (!entry) return null;
  const scenes = o.treatment.scenes.map((s, i) => (namedIn(entryName(entry), s?.visual || "") ? i : -1)).filter((i) => i >= 0);
  if (!scenes.length) return null;
  const kept = carried.refs.filter((r) => !sameCharacter(r.name, o.name));
  const r = await narratedSceneSeeds({ template: o.template, treatment: o.treatment, cast: o.cast, aspect: o.aspect, only: scenes, castRef: castToken(kept, carried.places) || null });
  return { ...r, scenes };
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
  catch { url = await repPoll(await repCreate("minimax/speech-02-turbo", { text, voice_id: voice, ...voiceLangOpts(lang) }), 4 * 60_000, "narration"); }
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
/** A picture as it goes into the cut: one that was kept with black bars baked in has them cropped off
 *  (to a file beside it), anything else is the picture itself. */
export async function withoutBars(s: string): Promise<string> {
  const n = seedName(s);
  let crop: string[] = [];
  try { const box = barBox((await runFfmpeg(["-loop", "1", "-i", s, "-vf", "cropdetect=limit=10:round=2:reset=0", "-frames:v", "5", "-f", "null", "-"])).stderr); if (box) crop = ["-vf", `crop=${box.w}:${box.h}:${box.x}:${box.y}`]; } catch { /* as it is */ }
  const c = await runFfmpeg(["-y", "-i", s, ...crop, "-frames:v", "1", n]);
  return c.status === 0 && fs.existsSync(n) ? n : s;
}

export async function assembleNarrated(o: {
  stills: string[]; windows: Window[]; voPath: string; musicPath: string | null; cards: Card[]; style: CaptionStyle;
  fontFile: string; W: number; H: number; outPath: string; jobId?: string;
  /** THE PICTURES MOVE (story-motion.ts): a scene's clip, where it has one — it plays in place of the
   *  still. Index-aligned with `stills`; a scene without one keeps its still and its slow push-in. */
  clips?: (string | null)[];
}): Promise<void> {
  const beat = async () => { if (o.jobId) await checkpointJob(o.jobId, { ckBeat: Date.now() }); };
  const N = o.stills.length;
  const FPS = 30;
  const total = o.windows[N - 1].t1 + TAIL_S;
  // every picture for its window (the last holds through the tail), in whole frames that add up exactly
  const frames = o.windows.map((w, i) => Math.round((i === N - 1 ? total : w.t1) * FPS) - Math.round(w.t0 * FPS));
  const norm: string[] = [];
  // a picture that was kept with black bars baked in has them cropped off here, not shown
  for (const s of o.stills) norm.push(await withoutBars(s));
  await beat();
  // the scenes that MOVE: a clip that is there and plays, and how it fills its window (story-motion.ts)
  const moves = norm.map((_, i) => {
    const c = o.clips?.[i];
    if (!c || !fs.existsSync(c)) return null;
    let have = 0;
    try { have = ffprobeDuration(c); } catch { have = 0; }
    return have > 1 ? { file: c, fit: fitMotion(have, frames[i] / FPS) } : null;
  });
  const anyMoves = moves.some(Boolean);
  const hasMusic = !!o.musicPath && fs.existsSync(o.musicPath);
  // the look that was asked for (Highlight is a file for the subtitle renderer), and the same cards as
  // plain drawn text behind it: a renderer that fails must not cost the story its words (caption-burn)
  const cap = captionGraph(o.cards, o.style, o.fontFile, o.W, o.H);
  const captions = cap.plain;

  const build = (useCaptions: boolean, moving: boolean, useMusic: boolean, styled = false, useClips = true): string[] => {
    const a: string[] = ["-y"];
    const clipOf = (i: number) => (useClips && moving ? moves[i] : null);
    norm.forEach((s, i) => {
      const m = clipOf(i);
      if (m) a.push("-i", m.file);
      else if (moving) a.push("-i", s);
      else a.push("-loop", "1", "-t", (frames[i] / FPS).toFixed(3), "-i", s);
    });
    a.push("-i", o.voPath);
    const musicOn = useMusic && hasMusic;
    if (musicOn) a.push("-stream_loop", "-1", "-i", o.musicPath!);
    const f: string[] = [];
    norm.forEach((_, i) => {
      const m = clipOf(i);
      f.push(m
        ? `[${i}:v]${motionChain(m.fit, frames[i], o.W, o.H)}[c${i}]`
        : moving
        ? `[${i}:v]${kenBurns(i, frames[i], o.W, o.H)},format=yuv420p[c${i}]`
        : `[${i}:v]scale=${o.W}:${o.H}:force_original_aspect_ratio=increase,crop=${o.W}:${o.H},setsar=1,fps=${FPS},format=yuv420p[c${i}]`);
    });
    f.push(`${norm.map((_, i) => `[c${i}]`).join("")}concat=n=${N}:v=1:a=0[vcat]`);
    let v = "[vcat]";
    if (useCaptions && captions.length) { f.push(`[vcat]${(styled && cap.styled ? cap.styled : captions).join(",")}[vf]`); v = "[vf]"; }
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
  try {
    // the styled look first, when there is one — and if THAT cannot be drawn, the same cards plain
    if (cap.styled) {
      const run = await runFfmpeg(build(true, true, true, true));
      if (run.status === 0 && produced()) return;
      console.error(`[narrated] the highlight captions could not be drawn — drawn as Bold instead: ${(run.stderr || "").slice(-200)}`);
      await beat();
    }
    // A CLIP MUST NEVER COST THE STORY: with the moving scenes first, and — should that cut fail — the
    // same story from its still pictures, exactly as it was made before the pictures moved.
    if (anyMoves) {
      const run = await runFfmpeg(build(true, true, true));
      if (run.status === 0 && produced()) return;
      console.error(`[narrated] the cut with moving scenes failed — cut from the still pictures instead: ${(run.stderr || "").slice(-240)}`);
      await beat();
    }
    for (const [withCaps, kb, mus] of rungs) {
      const run = await runFfmpeg(build(withCaps, kb, mus, false, false));
      if (run.status === 0 && produced()) {
        if (!withCaps && captions.length) console.error("[narrated] the captions could not be drawn — the story shipped without them");
        return;
      }
      lastErr = (run.stderr || "").slice(-240);
      await beat();
    }
  } finally { cap.cleanup(); }
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
  /** THE STORY'S OWN CAST as the storyboard drew it (story-picture.ts → castToken): the portraits a scene
   *  drawn here is drawn from, and who the piece says is in it. */
  castRef?: string | null;
  resume?: { ckTreatment?: string; ckApproved?: string; ckVoPath?: string; ckVoUrl?: string; ckWords?: string; ckImages?: string; ckMusic?: string; ckMotion?: string; ckCast?: string };
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

  // 3) TIMING — the narration's own word timings, listened for IN THE LANGUAGE IT IS TOLD IN.
  //    (Until 2026-11-23 only an English story was listened to; a Spanish one had its pictures and its
  //    captions timed by the length of the written sentences, a beat off the voice. Measured that day on
  //    real stories: Spanish 174 of 174 words timed, Chinese 278 glyphs, about 13 seconds each. The
  //    language is always named — told a Spanish voice is English, the listener TRANSLATES it.)
  let words: WordT[] = [];
  // (for the piece's timing record: what the first listen had heard when a second was made, and which was kept)
  let firstShare: number | undefined;
  let keptSoft = false;
  if (resume.ckWords) { try { words = JSON.parse(resume.ckWords) as WordT[]; } catch { words = []; } }
  else {
    if (voUrl) {
      try { words = listenedWords(await repPoll(await createWhisperx(voUrl, normalizeContentLang(lang)), 5 * 60_000, "narration-align")); }
      catch (e) { console.error(`[narrated] alignment failed — pictures and captions are timed by length instead: ${e instanceof Error ? e.message.slice(0, 140) : e}`); }
      // A LISTEN THAT MISSED PART OF THE STORY IS DONE AGAIN, SOFTER (narrated-core → LISTEN_AGAIN_UNDER): a
      // performed voice's quiet opening is not taken for speech by the stock voice detector. The better
      // of the two listens is kept; a second one that fails leaves the first as it was.
      // …AND SO IS ONE THAT FITTED WORDS WHERE IT WAS NOT SURE OF THEM (narrated-core → sureWords): such
      // words do not count as heard, so the listen that is sure of more of the story is the one kept.
      const first = listenQuality(lines, words);
      if (listenAgain(first)) {
        firstShare = first.share;
        try {
          const again = listenedWords(await repPoll(await createWhisperx(voUrl, normalizeContentLang(lang), { sung: true }), 5 * 60_000, "narration-align-soft"));
          const second = listenQuality(lines, again);
          console.log(`[narrated] the first listen heard ${Math.round(first.share * 100)}% of the story${first.doubted ? ` (and was not sure of ${first.doubted} words)` : ""} — a softer one heard ${Math.round(second.share * 100)}%`);
          if (second.share > first.share) { words = again; keptSoft = true; }
        } catch (e) { console.error(`[narrated] the softer listen failed — keeping the first: ${e instanceof Error ? e.message.slice(0, 120) : e}`); }
      }
    }
    await ckpt({ ckWords: JSON.stringify(words) });
  }
  // a creature chain can lead the voice in by a second: every heard word is where it is IN THE FILE,
  // so nothing needs shifting — the windows are simply read off what was heard
  // WORDS THE LISTENER WAS NOT SURE OF ARE NOT BELIEVED (narrated-core → sureWords: a line of this very
  // story was once drawn in the pause before it was spoken, and gone while it was said). Everything
  // below is timed by the words it WAS sure of; `listened` is all of them, kept for the record.
  const listened = words;
  const doubt = sureWords(listened);
  words = doubt.sure;
  const windows = sceneWindows(lines, words, voDur);
  // the captions say what was WRITTEN, timed by what was heard (a transcriber's spelling never reaches
  // the screen) — and, when nothing was heard, each scene's words spread across its window: the same
  // cards either way (the unheard ones used to be whole sentences in capitals, full stops and all)
  // …and a word nobody heard goes where the voice track is SOUNDING (voice-sound.server.ts): a whispered
  // last line came up in the pause before it — 1.7 seconds early, the ending given away — when unheard
  // words were laid straight on from the last heard one.
  const sound: { speech: Span[][]; unread?: string } = words.length ? await readVoiceSound(voPath, voDur) : { speech: [] };
  const speech = sound.speech;
  const timed = scriptWordTimes(lines, words, windows, undefined, speech, doubt.squeezed);
  // WHAT THE TIMING WAS MADE FROM stays with the piece (narrated-core → timingRecord): nobody can read
  // this server's log, and a film listened to again afterwards does not hear what was heard here.
  const timing = timingRecord({ lines, listened, speech, seconds: voDur, timed, plain: scriptWordTimes(lines, words, windows), first: firstShare, soft: keptSoft, unread: sound.unread });
  const cards: Card[] = style === "bold" || style === "highlight"
    ? boldCards(timed, normalizeContentLang(lang))
    : style === "subtitles" ? subtitleCards(lines, windows, subtitleChars(W, H), words.length ? timed : undefined) : [];

  // 4) THE PICTURES — the ones the maker approved, else drawn now
  // (…and the story's own cast: what the storyboard drew, or what is drawn here — kept across a restart)
  let storyCastRef = resume.ckCast || opts.castRef || "";
  let imgs: (string | null)[] = [];
  if (resume.ckImages) { try { imgs = JSON.parse(resume.ckImages) as (string | null)[]; } catch { imgs = []; } }
  if (imgs.length !== treatment.scenes.length) {
    if (approved.length === treatment.scenes.length && approved.every(Boolean)) imgs = approved;
    else {
      // ONLY THE SCENES WITH NO PICTURE ARE DRAWN. (One scene added to an approved storyboard used to
      // have EVERY picture drawn again — and all but that one thrown away for the approved ones.)
      const missing = treatment.scenes.map((_, i) => i).filter((i) => !approved[i]);
      const drawn = await narratedSceneSeeds({ template: tmpl.key, treatment, cast: opts.cast, aspect, only: missing, castRef: storyCastRef || null });
      if (drawn.castRef) storyCastRef = drawn.castRef;
      imgs = treatment.scenes.map((_, i) => approved[i] || drawn.sceneImgs[i] || null);
    }
    await ckpt({ ckImages: JSON.stringify(imgs), ...(storyCastRef ? { ckCast: storyCastRef } : {}) });
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

  // 4b) THE PICTURES MOVE (story-motion.ts) — each scene's own picture, played as one continuous shot for
  //     as long as the scene is told. A scene whose clip cannot be made keeps its still; the story is
  //     never held up or failed by it.
  let motion: MotionResult | null = null;
  if (storyMotionOn()) {
    try {
      const seeds: string[] = [];
      for (const s of stills) seeds.push(await withoutBars(s));
      const end = windows[windows.length - 1].t1 + TAIL_S;
      motion = await animateScenes({
        seeds, visuals: treatment.scenes.map((s) => s.visual || s.caption || ""),
        told: windows.map((w, i) => (i === windows.length - 1 ? end : w.t1) - w.t0),
        base, W, H, jobId, ckMotion: resume.ckMotion,
      });
    } catch (e) { console.error(`[narrated] the pictures could not be brought to life — told over the still pictures: ${e instanceof Error ? e.message.slice(0, 160) : e}`); }
  }

  // 5) MUSIC (the story ships without it rather than fail) and THE CUT
  let musicPath: string | null = resume.ckMusic && fs.existsSync(resume.ckMusic) ? resume.ckMusic : null;
  if (!musicPath) {
    try { musicPath = await musicBedToDisk(`${treatment.musicMood || tmpl.musicHint}, instrumental, loopable`); await ckpt({ ckMusic: musicPath }); }
    catch (e) { console.error(`[narrated] no music bed (continuing without): ${e instanceof Error ? e.message.slice(0, 120) : e}`); }
  }
  let fontFile = path.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");
  // (the resolver only fails for words Poppins cannot draw — Chinese with no font fetched: the story is
  //  then told without words on screen. Drawing them with Poppins made every caption a row of boxes.)
  let wordsDrawable = true;
  try { fontFile = await resolveTextFont(lines.join(" ")); }
  catch (e) { wordsDrawable = false; console.error(`[narrated] no font for these words — told without captions: ${e instanceof Error ? e.message.slice(0, 140) : e}`); }
  const outName = `nar-${Date.now()}-${rid()}.mp4`;
  const outPath = path.join(RENDERS(), outName);
  await assembleNarrated({ stills, clips: motion?.clips, windows, voPath, musicPath, cards: wordsDrawable ? cards : [], style, fontFile, W, H, outPath, jobId });
  try { await mirrorRender(outName, fs.readFileSync(outPath)); } catch { /* non-fatal */ }

  // THE POSTER — who is billed: the cast the maker picked, then the story's own. It never fails the film:
  // without one the shelf shows the first frame, as it always did. (STORY_POSTER=off turns it off.)
  let poster: string | null = null;
  if (process.env.STORY_POSTER !== "off") {
    try {
      const billed = [...(opts.cast || []).map((c) => c?.name || ""), ...readCastToken(storyCastRef).refs.map((c) => c.name)].filter(Boolean);
      poster = await makeStoryPoster({ stills, visuals: treatment.scenes.map((s) => s.visual || ""), names: billed, title: treatment.title || opts.topic || "", videoName: outName });
    } catch (e) { console.error(`[narrated] no poster (the shelf shows the first frame): ${e instanceof Error ? e.message.slice(0, 160) : e}`); }
  }

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
        // THE POSTER (story-poster.ts): its cover on the shelf — the title and the cast over its most "cast" picture
        ...(poster ? { poster } : {}),
        ...(musicPath ? { music: path.basename(musicPath) } : {}),
        ...(opts.translatedFrom ? { translatedFrom: String(opts.translatedFrom).slice(0, 64) } : {}),
        // THE STORY'S OWN CAST: the characters it invented, each with its portrait (story-picture.ts)
        ...(readCastToken(storyCastRef).refs.length ? { castCards: readCastToken(storyCastRef).refs } : {}),
        // …and its PLACES: the design sheet each recurring place was drawn from (story-picture.ts)
        ...(readCastToken(storyCastRef).places.length ? { places: readCastToken(storyCastRef).places } : {}),
        // what its timing was made from — for the operator alone (web.archive's loader)
        timing,
        // THE PICTURES MOVE: how many scenes do, what was asked for now (seconds = what was paid for), and
        // why any scene kept its still
        ...(motion ? { motion: { engine: STORY_MOTION_ENGINE, scenes: motion.clips.filter(Boolean).length, of: stills.length, made: motion.made, reused: motion.reused, seconds: motion.seconds, ...(motion.faults.length ? { faults: motion.faults.slice(0, 8) } : {}) } } : {}),
      }),
    },
  });
  return asset.id;
}
