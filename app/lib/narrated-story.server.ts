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
import os from "node:os";
import { db } from "../db.server";
import { checkpointJob, downloadBuffer, ffprobeDuration, repCreate, repPoll, resolveCaptionFont, resolveTextFont, runFfmpeg } from "./ugc-ad-pipeline.server";
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
import { MOTION_MAX_SCENES, STORY_MOTION_ENGINE, fitMotion, motionChain, seedName, stillCameraOf, storyPicturesOf, type StillCamera } from "./story-motion";
import { animateScenes, storyMotionOn, type MotionResult } from "./story-motion.server";
import { cameraLine, sceneShot } from "./story-shots";
// EVERYBODY IN EVERY PICTURE IS CLOTHED (2026-11-25 — clothed.server.ts → keepClothed; story-picture.ts → UNCLOTHED_ASKED)
import { CLOTHED_FIRST, dressedInWater, parseStoryUnclothed, storyFirst } from "./story-picture";
import { clothedEditOn, keepClothed } from "./clothed.server";
import { DOORS_SHUT, DRESSED, FRAMED_FIX, FRAMED_SIZE, framedIn, INSIDE_STAYS, NO_EXTRAS, NO_LENS, NOTHING_WRITTEN, ONE_PICTURE, SHADOW_SHAPE, shadowNote, STORY_SOUND, TODAY_LOOK, TRUE_SIZE, parseStoryGrime, parseStoryInset, storyGrimePrompt, PLACE_FRAMING, PLACE_SHEET_ASPECT, PORTRAIT_ASPECT, STORY_CAST_MAX, STORY_LADDER, castEntry, characterKind, creatureHidden, creatureNote, keptFaults, castStillIn, castToken, noLettering, oneMoment, parseStoryCast, parseStoryExtras, parseStoryLens, parseStoryOutside, parseStoryPanels, parseStoryTwice, placeKey, placeNote, placeSheetPrompt, placesStillIn, portraitPrompt, readCastToken, recurringPlaces, sameCharacter, insideNote, storyCastPrompt, storyExtrasPrompt, storyPictureInput, storyFaults, storyFix, storyPanelsPrompt, type StoryCastRef, type StoryCheck, type StoryKept, type StoryPlaceRef } from "./story-picture";
import { clampNarrated, filmTemplate, previewFilmTreatment, type FilmTreatment } from "./film-engine.server";
// (2026-11-25, stories up to five minutes: a long story is cut in parts, and read in parts when it is that long)
import { STORY_ONE_CUT, cardsDuring, readingParts, sceneIn, storyJoinArgs, storyPartArgs, storyParts, storySoundArgs } from "./story-join";
import { joinList } from "./acted-staging";
// NIGHT IS NIGHT (2026-11-25): the acted engine's own night rule and night sentence — story-picture.ts → storyNight
import { NIGHT_LINE, nightSetting } from "./acted-staging";
import { NIGHT_STYLE_LIGHT, parseStoryNight, storyNight } from "./story-picture";
import { streamSeconds } from "./film-join.server";
import { castForMeta, episodeTitle, seriesMeta, type SeriesBrief } from "./film-series";
import { episodeOwnName, type ShowMeta } from "./character-series";
import { barBox, barsIn, boldCards, cameraMove, keepToldScenes, captionFilters, captionStyleOf, entryName, frameWords, namedIn, presentIn, sceneCast, sceneWindows, scriptWordTimes, stillHeld, stillMoves, storyFrame, subtitleCards, subtitleChars, type CaptionStyle, type Card, type Window, type WordT } from "./narrated-core";

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
  // (a familiar documentary voice, not a creature's: the owner, 2026-11-24 — "Narrated needs the 'discovery
  //  channel guy' or similar yanno, something familiar". The creature voices are still there to be picked.)
  horror: "English_ManWithDeepVoice",
  moral: "English_Trustworth_Man",
  kidstv: "English_CalmWoman",
  testmovie: "English_ManWithDeepVoice",
  // THE NEW MOVIE CATEGORIES (2026-11-25, "Our genres need to be movie categories") are told by the same familiar
  // documentary voice he asked for the day before — each brief already sets its pace (deadpan, tight, at a run,
  // warm and unhurried). Without an entry they fell to the generic default.
  comedy: "English_ManWithDeepVoice",
  thriller: "English_ManWithDeepVoice",
  action: "English_ManWithDeepVoice",
  romance: "English_ManWithDeepVoice",
  scifi: "English_ManWithDeepVoice",
  fantasy: "English_ManWithDeepVoice",
  mystery: "English_ManWithDeepVoice",
};
export const narratorFor = (template: string | undefined, picked?: string | null): string => {
  const want = (picked || "").trim();
  if (want && (isCharacterVoice(want) || AVATAR_VOICE_IDS.has(want))) return want;
  return DEFAULT_NARRATOR[template || ""] || "English_Trustworth_Man";
};

/** What a picture model must keep about the characters it is shown. Said once, for people and
 *  creatures alike — and it draws ONLY who the scene names, whoever else is on a reference. */
const CAST_LOCK = "CRITICAL: every character taken from a reference image is the EXACT same one here — the same face, body, colours, fur or skin, markings, hair and clothing, and nothing added to what it wears. A creature stays a creature and a cartoon character stays a cartoon character: never made human, never redrawn in another style. A real person stays the exact same individual at the same age. Each keeps its own colours whatever this scene's lighting. Draw ONLY the characters named for this picture — nobody else from the reference images.";

/** One picture from a prompt of any length (the shared helpers cut a prompt at ~460 characters, which is where
 *  a scene's cast notes live), on the good model — and, when it refuses or cannot be reached, on the next one
 *  down (story-picture.ts → STORY_LADDER). Null when none of them draws it. */
async function drawScene(prompt: string, refs: string[], aspect: string): Promise<string | null> {
  const full = `${frameWords(aspect)} ${prompt} No watermark, no signature.`;
  for (const m of STORY_LADDER) {
    try {
      return await persistRemote(await repRun(m, storyPictureInput(m, { prompt: full, refs, aspect }), 150_000), "jpg");
    } catch (e) {
      console.error(`[narrated] a picture failed on ${m.split("/")[1]} (${refs.length} refs): ${e instanceof Error ? e.message.slice(0, 140) : e}`);
    }
  }
  return null;
}

/** A picture that came back with black bars baked in (a wide composition inside a tall frame)? */
async function letterboxed(rendersUrl: string | null): Promise<boolean> {
  if (!rendersUrl) return false;
  const file = path.join(RENDERS(), path.basename(rendersUrl.split("?")[0]));
  if (!fs.existsSync(file)) return false;
  try { return barsIn((await runFfmpeg(["-loop", "1", "-i", file, "-vf", "cropdetect=limit=10:round=2:reset=0", "-frames:v", "5", "-f", "null", "-"])).stderr); }
  catch { return false; }
}

/** A picture that came back as a small framed panel sitting on a plain ground — the look of a place's design
 *  sheet, copied (story-picture.ts → framedIn)? Read from the picture itself at a small size; a picture that
 *  cannot be read is not called one. */
async function framedPanel(rendersUrl: string | null): Promise<boolean> {
  if (!rendersUrl) return false;
  const file = path.join(RENDERS(), path.basename(rendersUrl.split("?")[0]));
  if (!fs.existsSync(file)) return false;
  const raw = path.join(os.tmpdir(), `framed-${crypto.randomBytes(6).toString("hex")}.rgb`);
  try {
    const r = await runFfmpeg(["-y", "-i", file, "-vf", `scale=${FRAMED_SIZE}:${FRAMED_SIZE}`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", raw]);
    if (r.status !== 0 || !fs.existsSync(raw)) return false;
    return framedIn(new Uint8Array(fs.readFileSync(raw)));
  } catch { return false; }
  finally { try { fs.unlinkSync(raw); } catch { /* nothing to clear */ } }
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
  const font = await resolveTextFont([...layout.lines, layout.cast, layout.episode, layout.episode2 || ""].join(" "));
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
  /** A JOB THAT IS DRAWING SAYS SO (2026-11-25, stories up to five minutes): called whenever a picture comes back.
   *  The worker took a job nobody had touched for 25 minutes to be dead and started it again beside itself
   *  (job-queue.server.ts → reclaimOrphanJobs; five minutes since 2026-11-25, when the worker began to beat every
   *  job it runs itself — job-beat.ts — so this is a second voice); twelve pictures four at a time were a few minutes, thirty-two —
   *  each up to three goes, each go up to two and a half minutes on each model of the ladder — can be longer
   *  than that. Called at a real step, never on a timer, so a job that is truly stuck still says nothing. */
  beat?: () => unknown;
  /** THE MAKER'S IDEA (2026-11-25): a story whose idea says night ("A night ferry crosses a foggy harbour…") is drawn at
   *  night wherever a scene's own words name no other time of day — story-picture.ts → storyNight. Unset: a scene is at
   *  night only where its own words, its narration or its place say so. */
  idea?: string | null;
}): Promise<{ sceneImgs: (string | null)[]; castRef: string | null; /** the story's own characters, each with its portrait — to be shown */ castCards: StoryCastRef[]; /** the places the story comes back to, each with its design sheet — to be shown */ placeCards: StoryPlaceRef[]; /** for each scene drawn: how wrong the picture that was KEPT still is (0 = nothing; null = not drawn here), and what the look read off it */ sceneFaults: (number | null)[]; sceneChecks: (StoryKept | null)[] }> {
  const tmpl = filmTemplate(o.template);
  const { aspect } = storyFrame(o.aspect);
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const abs = (u: string | null | undefined): string | null => (u ? (u.startsWith("http") ? u : `${base}${u}`) : null);
  const safe = tmpl.childSafe ? "Wholesome, child-safe, G-rated, bright and friendly. " : "";
  // (the idea the story was written from: the maker's — and the starter it was written from when theirs was too short,
  //  which the treatment keeps: film-engine.server.ts → FilmTreatment.nudge)
  const idea = `${o.idea || ""} ${o.treatment.nudge || ""}`.trim();
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
  const placeCards: StoryPlaceRef[] = placesStillIn(carried.places, placeList).filter((c) => fs.existsSync(path.join(RENDERS(), path.basename(c.img))));
  // (a place that came in WITH its sheet — the last episode's — is used from its first scene)
  const wanted = process.env.STORY_PLACES !== "off" && !sheetRef ? recurringPlaces(scenes.map((s) => s?.visual || ""), placeList, placeCards.map((c) => c.name)) : [];
  const sheetFor = (name: string): StoryPlaceRef | undefined => placeCards.find((c) => placeKey(c.name) === placeKey(name));
  const needPlaces = wanted.filter((p) => p.scenes.some((i) => todo.includes(i)) && !sheetFor(p.name));
  // (started now, awaited after the portraits: the two are drawn side by side, so a story's pictures take no longer)
  // (a story that is not a children's cartoon is set in today's world unless its words say otherwise — the
  //  children's house came back rough grey stone twice: story-picture.ts → TODAY_LOOK)
  // (…and a genre whose world is its OWN is not — a Fantasy tale's hall drawn as a modern flat, "no cottage and no castle
  //  unless they name one": film-genres.ts → ownWorld, 2026-11-25. A sheet has nobody in it to dress.)
  const sheetsDrawing = Promise.all(needPlaces.map(async (p) => ({ p, img: await drawScene(placeSheetPrompt(p, tmpl.sceneHint, safe, !tmpl.childSafe && !tmpl.ownWorld), [], PLACE_SHEET_ASPECT) })));

  if (!sheetRef) {
    const need = others
      .filter((e) => who.some((w) => w.others.includes(e)) && !!castEntry(e).name && !cards.some((c) => sameCharacter(c.name, castEntry(e).name)))
      .slice(0, Math.max(0, STORY_CAST_MAX - cards.length));
    // A PORTRAIT IS CLOTHED — in its words and LOOKED AT (2026-11-25, clothed.server.ts → keepClothed). Every scene of
    // that character is drawn FROM it ("the same clothing, and nothing added to what it wears" — CAST_LOCK), so a bare
    // portrait would be a bare figure in every picture of the story: one in water is dressed where it is said
    // (dressedInWater); one drawn unclothed is drawn again with the clothes said first, then dressed by one edit — and if
    // it is still bare it is not a portrait at all (the one more go below, and then the character is drawn from words).
    const portrait = async (e: string): Promise<string | null> => {
      const ask = portraitPrompt(dressedInWater(e), tmpl.sceneHint, safe);
      const img = await drawScene(ask, [], PORTRAIT_ASPECT);
      return img ? keepClothed({ url: img, ref: (u) => abs(u) || u, redraw: () => drawScene(`${CLOTHED_FIRST} ${ask}`, [], PORTRAIT_ASPECT), edit: (u, bare) => clothedEditOn(u, bare, PORTRAIT_ASPECT), still: "drop", log: (l) => console.log(`[narrated] the portrait of ${entryName(e)}: ${l}`) }) : null;
    };
    const drawn = await Promise.all(need.map(async (e) => ({ e, img: await portrait(e) })));
    // (one more go, on its own, for a portrait that did not come back — the whole story is drawn from it)
    for (const d of drawn) if (!d.img) d.img = await portrait(d.e);
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
  // (the job is at work — said whenever a picture comes back: see `beat`, above. A beat that fails is skipped.)
  const alive = async (): Promise<void> => { try { await o.beat?.(); } catch { /* skipped */ } };
  await alive();
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
      const here: Array<{ name: string; look?: string; faceUrl?: string | null; kind?: "person" | "cartoon" | "monster" }> = [...chosen, ...own.map((c) => ({ name: c.name, look: c.look, faceUrl: c.img, kind: characterKind(c.name, c.look) }))];
      // HOW THIS SCENE IS SEEN (story-shots.ts): the camera line its picture is given — none for a scene with no plan
      // (…what its own words say first — a storyboard written before the words won, or words the maker changed:
      //  story-shots.ts → sceneShot)
      const cam = sceneShot(scene);
      const people = [...here.map((c) => abs(c.faceUrl)).filter((u): u is string => !!u), ...(sheet ? [sheet] : [])];
      // WHERE IT IS SET: the design sheet of the place this scene's words name, as one more reference —
      // after the people, and not counted as one of them when the picture model is chosen
      const setAt = wanted.find((p) => p.scenes.includes(i));
      const place = setAt ? sheetFor(setAt.name) : undefined;
      const placeUrl = place ? abs(place.img) : null;
      const refs = [...people, ...(placeUrl ? [placeUrl] : [])];
      const notes: string[] = [];
      here.forEach((c, n) => notes.push(`${c.name} is the character in reference image ${n + 1}${c.look ? ` (${c.look.slice(0, 160)})` : ""}.`));
      // A CREATURE STAYS THAT CREATURE (story-picture.ts → creatureNote): a werewolf asked to "crouch" came back
      // an ordinary wolf, and one gripped by the sleeve came back a man with a wolf's head in a clean shirt.
      here.forEach((c) => { const note = creatureNote(c.name, c.kind); if (note) notes.push(note); });
      // WHAT FRIGHTENS (story-picture.ts): a creature the STORY invented is mostly hidden — never a cast
      // member the maker chose (a show's own star is seen), never in a children's format
      // (…a creature by its NAME as well as its look: "the ghost lady, a tall woman who…" was drawn whole and lit,
      //  grinning and waving at the window — story-picture.ts → characterKind)
      if (!tmpl.childSafe) own.forEach((c) => { if (characterKind(c.name, c.look) === "monster") notes.push(creatureHidden(c.name)); });
      if (sheet) notes.push(`Reference image ${here.length + 1} is a sheet of other characters: from it take ONLY ${who[k].others.map((e) => e.slice(0, 200)).join("; and ")}.`);
      // (the place's own lines are kept apart: a scene that keeps coming back as a framed panel is drawn once
      //  more WITHOUT its place's sheet — from its words, as every scene was before there were sheets)
      // (the "camera is near them" line is for a scene with NO camera line of its own — it made every picture
      //  at a place the same medium two-shot; a planned scene says where the camera is itself)
      const placeNotes = place && placeUrl ? [placeNote(refs.length, place), ...(here.length && !cam ? [PLACE_FRAMING] : [])] : [];
      // (a character with no picture of its own here — its portrait could not be drawn, or it is a fourth
      //  in one scene — is drawn from its words, as every invented character once was)
      const unpictured = sheet ? [] : who[k].others.filter((e) => !own.some((c) => c === cardFor(e)));
      if (unpictured.length) notes.push(`In this picture: ${unpictured.map((e) => e.slice(0, 200)).join("; and ")}.`);
      // THE WORDS THE PICTURE IS DRAWN FROM are tidied first (story-picture.ts): one moment, nothing written.
      // (…and a person the words put IN WATER is dressed in the same words, right behind them — DRESSED at the end of a
      //  long prompt did not dress the woman in the lake: story-picture.ts → dressedInWater, 2026-11-25)
      const written = (scene.visual || "").replace(/\s+/g, " ").trim();
      const visual = dressedInWater(oneMoment(noLettering(written)));
      const twoMoments = oneMoment(written) !== written;
      // NIGHT IS NIGHT (2026-11-25, "Eleven Went Aboard": the idea said "A night ferry crosses a foggy harbour…" and all
      // thirteen pictures were pale misty daylight): is this scene at night — by its picture's words, its narration, its
      // place or the story's idea (story-picture.ts → storyNight, on the acted engine's own rule)? Then its picture is told
      // so right behind its words, from the first go (the acted master's NIGHT_LINE), and its sky is looked at.
      // (…and told to take only the night's light from its style: the Mystery's offers "flat grey daylight through rain" —
      //  story-picture.ts → NIGHT_STYLE_LIGHT, review of S11)
      const night = storyNight({ words: visual, said: scene.caption, place: setAt ? `${setAt.name}: ${setAt.look}` : "", idea, childSafe: tmpl.childSafe, cartoon: tmpl.cartoon }, nightSetting);
      // (a genre whose world is its OWN — Fantasy, film-genres.ts → ownWorld — is told everybody is clothed, and not that
      //  its places look the way they look TODAY: "no cottage and no castle unless they name one", 2026-11-25)
      const promptOf = (withPlace: boolean): string => `${safe}${visual.slice(0, 600)}${/[.!?]$/.test(visual) ? "" : "."}${night ? ` ${NIGHT_LINE} ${NIGHT_STYLE_LIGHT}` : ""} Style: ${tmpl.sceneHint}.${tmpl.faceMood ? ` ${tmpl.faceMood}` : ""}${cam ? ` ${cameraLine(cam)}` : ""} ${[...notes, ...(withPlace ? placeNotes : [])].join(" ")}${(withPlace ? refs : people).length ? ` ${CAST_LOCK}` : ""} ${ONE_PICTURE} ${NO_EXTRAS}${here.length ? ` ${NO_LENS}` : ""}${insideNote(visual) ? ` ${INSIDE_STAYS} ${DOORS_SHUT} ${TRUE_SIZE}` : ""}${tmpl.childSafe || tmpl.ownWorld ? ` ${DRESSED}` : ` ${TODAY_LOOK}`}${!tmpl.childSafe && shadowNote(visual) ? ` ${SHADOW_SHAPE}` : ""} ${STORY_SOUND} ${NOTHING_WRITTEN}`;
      // …and THE PICTURE IS LOOKED AT before it is kept: is each of the maker's cast in it (never asked
      // about clothes — a story dresses people for the part), and is it one picture. The cast is looked for
      // whenever the scene has any; panels only where the words described two moments (that is when a
      // picture model stacks two views). A look that cannot be made, or says nothing, keeps the picture.
      const castPics = here.map((c) => abs(c.faceUrl)).filter((u): u is string => !!u);
      // (who is who, by their looks — so the look can tell the girl at the window from the ghost on the porch)
      const whoIsWho = here.map((c) => (c.look ? `${c.name}: ${c.look.slice(0, 120)}` : c.name));
      const lookAt = async (got: string): Promise<StoryCheck | null> => {
        const pic = abs(got);
        // (every picture is looked at now — at least for anybody its words do not put there: an empty room at
        //  night came back with a grown man at a screen in it, a house at dusk with a man walking up to it)
        if (!pic) return null;
        try {
          const { anthropicVision } = await import("./anthropic.server");
          const [castRaw, panelsRaw, extrasRaw, grimeRaw] = await Promise.all([
            castPics.length ? anthropicVision(storyCastPrompt(castPics.length), [pic, ...castPics], { maxTokens: 500, model: "claude-sonnet-4-6" }) : Promise.resolve(""),
            twoMoments ? anthropicVision(storyPanelsPrompt(), [pic], { maxTokens: 320, model: "claude-sonnet-4-6" }) : Promise.resolve(""),
            // (…its answer a line longer since it also says whether anybody is unclothed: story-picture.ts → UNCLOTHED_ASKED)
            anthropicVision(storyExtrasPrompt(visual, whoIsWho), [pic], { maxTokens: 600, model: "claude-sonnet-4-6" }).catch(() => ""),
            // (…and a place drawn run-down that its words do not call one — a grown-up story's — or a smaller picture
            //  pasted into a corner of it — any story's: story-picture.ts)
            // (…and a NIGHT scene's sky, last in the same question — no extra call; its answer a line longer: NIGHT_ASKED)
            anthropicVision(storyGrimePrompt(visual, night), [pic], { maxTokens: night ? 420 : 360, model: "claude-sonnet-4-6" }).catch(() => ""),
          ]);
          const seen = castPics.length ? parseStoryCast(String(castRaw || ""), castPics.length) : [];
          // (…and whoever is drawn TWICE — the little brother on the sofa and again on the porch: story-picture.ts)
          const twice = castPics.length ? parseStoryTwice(String(castRaw || ""), castPics.length) : null;
          const panels = twoMoments ? parseStoryPanels(String(panelsRaw || "")) : false;
          const extra = parseStoryExtras(String(extrasRaw || ""));
          // (…and whoever looks OUT, drawn standing out there with what they look at: story-picture.ts)
          const outside = parseStoryOutside(String(extrasRaw || ""));
          // (…and whoever stares into the lens: story-picture.ts → parseStoryLens)
          const lens = parseStoryLens(String(extrasRaw || ""));
          const grimy = tmpl.childSafe ? null : parseStoryGrime(String(grimeRaw || ""));
          const inset = parseStoryInset(String(grimeRaw || ""));
          // (…and anybody UNCLOTHED — any story's, a children's too: story-picture.ts → parseStoryUnclothed)
          const bare = parseStoryUnclothed(String(extrasRaw || ""));
          // (…and a night scene's sky read as dusk or day — only a clear "dusk" or "day" is the fault: story-picture.ts → parseStoryNight)
          const dark = night ? parseStoryNight(String(grimeRaw || "")) : null;
          if (seen == null && panels == null && extra == null && outside == null && lens == null && grimy == null && inset == null && bare == null && dark == null) return null;
          return { seen: seen || castPics.map(() => true), panels: panels === true, ...(twice ? { twice } : {}), ...(extra ? { extra: true } : {}), ...(outside ? { outside: true } : {}), ...(lens?.length ? { lens } : {}), ...(grimy ? { grimy: true } : {}), ...(inset ? { inset: true } : {}), ...(dark === false ? { notNight: true } : {}), ...(bare?.unclothed ? { unclothed: true, unclothedWho: bare.who } : {}) };
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
      // (…and what the next go is told FIRST: a go that came back with somebody unclothed — CLOTHED_FIRST, ahead of
      //  everything, as the acted master's redraw is told: story-picture.ts → storyFirst)
      let first = "";
      // A FRAMED PANEL (the design sheet's look, copied) is never kept: it is drawn again, told so — and
      // after two of them the scene is drawn without its place's sheet
      let framedGoes = 0;
      for (let a = 0; a < 3 && !img; a++) {
        const withPlace = placeNotes.length > 0 && framedGoes < 2;
        // (every go is on the good model now — story-picture.ts → STORY_LADDER; the last go of a scene whose cast
        //  came out wrong twice used to be the one moved up to it)
        const got = await drawScene(`${first}${promptOf(withPlace)}${fix}`, withPlace ? refs : people, aspect);
        await alive();
        if (got && (await letterboxed(got))) { barred = got; console.error(`[narrated] scene ${i + 1} came back letterboxed — drawing it again`); continue; }
        if (got && withPlace && (await framedPanel(got))) { framedGoes++; fix = FRAMED_FIX; console.error(`[narrated] scene ${i + 1} came back as a framed panel on a plain ground (${place?.name}) — drawing it again${framedGoes >= 2 ? " without the place's sheet" : ""}`); continue; }
        if (!got) { if (a >= 1) break; continue; } // two plain failures: stop asking this way
        const seenAs = await lookAt(got);
        const faults = seenAs ? storyFaults(seenAs) : 0;
        if (!faults) { img = got; break; }
        if (!best || faults < best.faults) best = { img: got, faults, check: seenAs! };
        fix = storyFix(seenAs!, here.map((c) => c.name), here.map((c) => c.kind || "person"));
        first = storyFirst(seenAs);
        console.log(`[narrated] scene ${i + 1} try ${a + 1}: ${[seenAs!.unclothed ? `somebody unclothed (${seenAs!.unclothedWho || "somewhere in it"})` : "", seenAs!.panels ? "split into panels" : "", seenAs!.seen.includes(false) ? `cast not in it (${here.filter((_, n) => !seenAs!.seen[n]).map((c) => c.name).join(", ")})` : "", (seenAs!.twice || []).some(Boolean) ? "somebody drawn twice" : "", seenAs!.extra ? "somebody the words do not put there" : "", seenAs!.outside ? "whoever looks out stood outside" : "", seenAs!.lens?.length ? `${seenAs!.lens.join(" and ")} stared into the lens` : "", seenAs!.grimy ? "the place came out run-down" : "", seenAs!.inset ? "a smaller picture pasted into it" : "", seenAs!.notNight ? "a night scene drawn as dusk or day" : ""].filter(Boolean).join(", ")} — drawing it again`);
      }
      // THE BEST OF THE GOES STILL HAS SOMEBODY UNCLOTHED (every go had: one without it would have weighed less —
      // story-picture.ts → UNCLOTHED_FAULT): that picture is dressed by ONE edit on the story's best model and looked at
      // again (clothed.server.ts → keepClothed). Dressed, it is kept with whatever else its look found; still bare, the
      // picture is kept as it was and its scene is flagged — "Needs clothes" — for the maker to draw again.
      if (!img && best?.check.unclothed) {
        const was = best;
        const dressed = await keepClothed({ url: was.img, ref: (u) => abs(u) || u, seen: { unclothed: true, who: was.check.unclothedWho || "" }, edit: (u, bare) => clothedEditOn(u, bare, aspect), still: "drop", log: (l) => console.log(`[narrated] scene ${i + 1}: ${l}`) });
        if (dressed) {
          const { unclothed: _bare, unclothedWho: _where, ...rest } = was.check;
          best = { img: dressed, faults: storyFaults(rest), check: rest };
          if (!best.faults) img = dressed;
        }
        await alive();
      }
      if (!img && best) { img = best.img; faultsOut[i] = best.faults; checksOut[i] = { ...best.check, who: here.map((c) => c.name) }; }
      // (…a letterboxed picture kept because every go was letterboxed was never looked at — review of S8, 2026-11-25:
      //  it is looked at for anybody unclothed now, dressed by one edit if it must be, else kept as it is)
      if (!img && barred) img = await keepClothed({ url: barred, ref: (u) => abs(u) || u, edit: (u, bare) => clothedEditOn(u, bare, aspect), log: (l) => console.log(`[narrated] scene ${i + 1} (letterboxed, kept): ${l}`) });
      // the lenient path last: its safety and outage fallbacks still get a picture (without the cast's own looks)
      // (…its words dressed too, and the picture looked at: dressed by one edit, else kept as it is — clothed.server.ts)
      // (…and a night scene's night said FIRST: this prompt is cut at 500 characters, and the night must not be what is cut)
      if (!img) {
        try {
          const lenient = await renderCreativeSeed(`${safe}${night ? `${NIGHT_LINE} ` : ""}${dressedInWater((scene.visual || "").slice(0, 300))}. ${tmpl.sceneHint}`, aspect);
          img = lenient ? await keepClothed({ url: lenient, ref: (u) => abs(u) || u, edit: (u, bare) => clothedEditOn(u, bare, aspect), log: (l) => console.log(`[narrated] scene ${i + 1} (the lenient path): ${l}`) }) : null;
        } catch { img = null; }
      }
      out[i] = img;
      if (img && faultsOut[i] == null) faultsOut[i] = 0;
      await alive();
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
  /** the maker's idea — a night story's scenes are drawn again at night (narratedSceneSeeds → idea) */
  idea?: string | null;
}): Promise<(Awaited<ReturnType<typeof narratedSceneSeeds>> & { scenes: number[] }) | null> {
  const carried = readCastToken(o.castRef);
  if (carried.sheet) return null;
  const entry = (o.treatment.cast || []).find((e) => !!e && sameCharacter(castEntry(e).name, o.name));
  if (!entry) return null;
  const scenes = o.treatment.scenes.map((s, i) => (presentIn(entryName(entry), s?.visual || "") ? i : -1)).filter((i) => i >= 0);
  if (!scenes.length) return null;
  const kept = carried.refs.filter((r) => !sameCharacter(r.name, o.name));
  const r = await narratedSceneSeeds({ template: o.template, treatment: o.treatment, cast: o.cast, aspect: o.aspect, only: scenes, castRef: castToken(kept, carried.places) || null, idea: o.idea });
  return { ...r, scenes };
}

/** THE PICTURES MOVE, A RUN AT A TIME (2026-11-25, stories up to five minutes). story-motion.server.ts brings at most
 *  MOTION_MAX_SCENES scenes of a story to life — the most a story had: twelve — "so a story never moves for ten scenes
 *  and stands still for its last two". A story of thirty-two would have moved for twelve and stood still for twenty.
 *  So a long one is handed over in runs of that many, one after another, and what comes back is put together in the
 *  story's own order (a scene's number in a fault or a look is its number in the story). A story of twelve scenes or
 *  fewer is one run, exactly as before; and the runs share the checkpoint of the clips still being waited for, which
 *  is kept by picture, so a story picked up again neither waits for nor pays for a clip twice. */
async function animateInRuns(o: Parameters<typeof animateScenes>[0]): Promise<MotionResult> {
  const N = o.seeds.length;
  if (N <= MOTION_MAX_SCENES) return animateScenes(o);
  const out: MotionResult = { clips: new Array(N).fill(null), made: 0, reused: 0, seconds: 0, faults: [], looks: [] };
  for (let from = 0; from < N; from += MOTION_MAX_SCENES) {
    const to = Math.min(N, from + MOTION_MAX_SCENES);
    const run = await animateScenes({ ...o, seeds: o.seeds.slice(from, to), visuals: o.visuals.slice(from, to), cams: o.cams?.slice(from, to), told: o.told.slice(from, to), still: o.still?.slice(from, to) });
    run.clips.forEach((c, k) => { out.clips[from + k] = c; });
    out.made += run.made; out.reused += run.reused; out.seconds += run.seconds;
    out.faults.push(...run.faults.map((f) => ({ ...f, scene: f.scene + from })));
    out.looks.push(...run.looks.map((l) => ({ ...l, scene: l.scene + from })));
  }
  console.log(`[narrated] ${N} scenes brought to life in runs of ${MOTION_MAX_SCENES}: ${out.clips.filter(Boolean).length} move`);
  return out;
}

/** The readings of a long story, read ONE AFTER ANOTHER (each by `read`), in order. */
async function readingsInTurn(readings: string[], read: (text: string, stage: string) => Promise<{ buf: Buffer }>): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for (let k = 0; k < readings.length; k++) out.push((await read(readings[k], `narration-${k + 1}-of-${readings.length}`)).buf);
  console.log(`[narrated] the story was read in ${readings.length} parts (${readings.map((r) => r.length).join(", ")} characters)`);
  return out;
}

/** The readings joined into one narration: each in its turn, a quarter-second breath between them (the pause the
 *  speech model leaves at a sentence's end is kept as it is). */
async function joinReadings(takes: Buffer[]): Promise<Buffer> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvo-"));
  try {
    const files = takes.map((b, k) => { const f = path.join(tmp, `take-${k}.mp3`); fs.writeFileSync(f, b); return f; });
    const out = path.join(tmp, "joined.mp3");
    const graph = `${files.map((_, k) => `[${k}:a]aresample=44100,aformat=channel_layouts=mono${k < files.length - 1 ? ",apad=pad_dur=0.25" : ""}[p${k}]`).join(";")};${files.map((_, k) => `[p${k}]`).join("")}concat=n=${files.length}:v=0:a=1[j]`;
    const r = await runFfmpeg(["-y", ...files.flatMap((f) => ["-i", f]), "-filter_complex", graph, "-map", "[j]", "-ar", "44100", "-b:a", "160k", out]);
    if (r.status !== 0 || !fs.existsSync(out) || fs.statSync(out).size < 8_000) throw new Error(`[narrated] the readings could not be joined: ${r.stderr.slice(-200)}`);
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
  // HINDI AND URDU are read by a native voice of the narrator's own kind (story-voice.ts) — Urdu by
  // ElevenLabs, and should that fail, by the Hindi voice on the speech model below
  const { storyReader } = await import("./story-voice");
  const reader = storyReader(voice, lang);
  if (reader.engine === "eleven") {
    try {
      const { speakStock } = await import("./character-voice.server");
      const made = await speakStock(reader.voice, text, { lang: normalizeContentLang(lang), stage: "narration" });
      return { path: made.path, url: `${base}${made.url}` };
    } catch (e) { console.error(`[narrated] ${reader.voice} could not read the story — ${reader.backup} reads it: ${e instanceof Error ? e.message.slice(0, 140) : e}`); }
  }
  const reads = reader.engine === "eleven" ? reader.backup || voice : reader.voice;
  /** one reading by the speech model, as it came back */
  const readOnce = async (text: string, stage: string): Promise<{ buf: Buffer; url: string }> => {
    let url = "";
    try { url = await repPoll(await repCreate("minimax/speech-02-hd", { text, voice_id: reads, ...voiceLangOpts(lang) }), 4 * 60_000, stage); }
    catch { url = await repPoll(await repCreate("minimax/speech-02-turbo", { text, voice_id: reads, ...voiceLangOpts(lang) }), 4 * 60_000, stage); }
    const buf = await downloadBuffer(url);
    if (buf.length < 8_000) throw new Error("[narrated] the narration came back empty");
    return { buf, url };
  };
  // A STORY LONGER THAN THE SPEECH MODEL READS AT ONCE (story-join.ts → readingParts: 10,000 characters, and five
  // minutes of story can come near it) is read in parts, each ending where a sentence does, one after another in
  // the same voice, and joined with a breath between — the way a character's passages are (character-voice.server.ts).
  // A story that fits is read in one go, exactly as it always was.
  const readings = readingParts(text);
  const { buf, url } = readings.length > 1 ? { buf: await joinReadings(await readingsInTurn(readings, readOnce)), url: "" } : await readOnce(text, "narration");
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
  /** THE CAMERA OF A STILL STORY (story-motion.ts → StillCamera): how each still picture moves, index-aligned with
   *  `stills` — given only for a story told over its stills; none, or a scene with none, moves as it always did
   *  (Gentle: narrated-core.ts → cameraMove). */
  cameras?: (StillCamera | null)[];
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
  // A LONG STORY IS CUT IN PARTS (story-join.ts): more scenes than one cut has ever had here are never opened by one
  // ffmpeg. A story of twelve scenes or fewer is cut below, exactly as it always was.
  if (N > STORY_ONE_CUT) return cutInParts({ ...o, norm, frames, moves, total, hasMusic, beat });
  // (each still's move, by its camera — narrated-core.ts → THE CAMERA OF A STILL STORY)
  const stillMoveOf = (i: number) => cameraMove(o.cameras?.[i], i);
  // the look that was asked for (Highlight is a file for the subtitle renderer), and the same cards as
  // plain drawn text behind it: a renderer that fails must not cost the story its words (caption-burn)
  const cap = captionGraph(o.cards, o.style, o.fontFile, o.W, o.H);
  const captions = cap.plain;

  const build = (useCaptions: boolean, moving: boolean, useMusic: boolean, styled = false, useClips = true): string[] => {
    const a: string[] = ["-y"];
    const clipOf = (i: number) => (useClips && moving ? moves[i] : null);
    // (one decoding thread a scene, as a long story's parts have — story-join.ts → storyPartArgs: measured 2026-11-25)
    norm.forEach((s, i) => {
      const m = clipOf(i);
      if (m) a.push("-threads", "1", "-i", m.file);
      else if (moving) a.push("-threads", "1", "-i", s);
      else a.push("-threads", "1", "-loop", "1", "-t", (frames[i] / FPS).toFixed(3), "-i", s);
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
        ? `[${i}:v]${stillHeld(frames[i], o.W, o.H)}[c${i}]`
        : `[${i}:v]scale=${o.W}:${o.H}:force_original_aspect_ratio=increase,crop=${o.W}:${o.H},setsar=1,fps=${FPS},format=yuv420p[c${i}]`);
    });
    f.push(`${norm.map((_, i) => `[c${i}]`).join("")}concat=n=${N}:v=1:a=0[vcat]`);
    let v = "[vcat]";
    // THE STILLS' SLOW MOVES (narrated-core.ts → A STILL PICTURE'S SLOW MOVE): each held picture moved by its own move
    // over its own frames, in ONE pass over the joined picture — before the words, which stay where they are
    const still = moving ? stillMoves(norm.map((_, i) => ({ move: clipOf(i) ? null : stillMoveOf(i), frames: frames[i] }))) : "";
    if (still) { f.push(`[vcat]${still}[vmv]`); v = "[vmv]"; }
    if (useCaptions && captions.length) { f.push(`${v}${(styled && cap.styled ? cap.styled : captions).join(",")}[vf]`); v = "[vf]"; }
    f.push(`[${N}:a]aresample=44100,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100,apad=pad_dur=${TAIL_S}[vo]`);
    let aMap = "[vo]";
    if (musicOn) {
      f.push(`[${N + 1}:a]aresample=44100,volume=0.18,afade=t=out:st=${Math.max(0, total - 1.6).toFixed(2)}:d=1.6[bg]`);
      f.push(`[vo][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`);
      aMap = "[aout]";
    }
    a.push("-filter_complex", f.join(";"), "-map", v, "-map", aMap, "-t", total.toFixed(2),
      "-threads", "2", "-filter_complex_threads", "2",
      // (THE FINISH: the owner, 2026-11-25, of the night-time horror stories: "quality looks rough". Encoded
      //  "veryfast" at CRF 21 they came out at 1.3 Mbps for 720p — and dark, grainy night pictures are what an
      //  encoder starves first: the shadows went to blocks. A finer encode costs a few more seconds of the
      //  server's time and nothing else.)
      "-c:v", "libx264", "-preset", "fast", "-tune", "film", "-crf", "18", "-pix_fmt", "yuv420p",
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

/** THE SAME CUT, FOR A STORY TOO LONG FOR ONE ffmpeg (story-join.ts → A LONG TOLD STORY IS CUT IN PARTS).
 *  1) THE SOUND, once, for the whole story: the voice levelled and given its tail, the music ducked under it — the
 *     single cut's own mix (and without the music, should that fail).
 *  2) THE PICTURE, a few scenes at a time, each scene by the chain the single cut gives it and each part's words
 *     drawn on the story's own clock — down the single cut's own ladder: the styled words over the moving scenes,
 *     the plain words over them, the plain words over the still pictures and their slow push-in, no words, the
 *     plain still pictures. Every part is MEASURED: its picture exactly the frames its scenes add up to.
 *  3) The parts end to end, their picture copied as it is, with the sound — and the story MEASURED once more.
 *  A rung any part of which cannot be made is climbed down whole: a story never changes its look halfway. The
 *  parts' files are gone when it returns; it throws when no rung makes the story, as the single cut does. */
async function cutInParts(o: {
  voPath: string; musicPath: string | null; cards: Card[]; style: CaptionStyle; fontFile: string; W: number; H: number; outPath: string;
  norm: string[]; frames: number[]; moves: Array<{ file: string; fit: { speed: number; hold: number } } | null>; total: number; hasMusic: boolean; beat: () => Promise<void>;
  cameras?: (StillCamera | null)[];
}): Promise<void> {
  const FPS = 30;
  const parts = storyParts(o.frames);
  const files = parts.map((_, p) => `${o.outPath}.part${p + 1}.mp4`);
  const sound = `${o.outPath}.sound.wav`;
  const list = `${o.outPath}.parts.txt`;
  // what words the story has, and whether it has the styled look — asked of all its cards, as the single cut asks
  const whole = captionGraph(o.cards, o.style, o.fontFile, o.W, o.H);
  const hasStyled = !!whole.styled;
  const hasWords = whole.plain.length > 0;
  whole.cleanup();
  type Rung = { words: "styled" | "plain" | "none"; clips: boolean; moving: boolean; how: string };
  const rungs: Rung[] = [
    ...(hasStyled ? [{ words: "styled", clips: true, moving: true, how: "with its styled words" } as Rung] : []),
    ...(o.moves.some(Boolean) ? [{ words: "plain", clips: true, moving: true, how: "with its moving scenes" } as Rung] : []),
    { words: hasWords ? "plain" : "none", clips: false, moving: true, how: "over its still pictures" },
    ...(hasWords ? [{ words: "none", clips: false, moving: true, how: "without its words" } as Rung] : []),
    { words: "none", clips: false, moving: false, how: "as plain still pictures" },
  ];
  const tried: string[] = [];
  try {
    // 1) THE SOUND
    let mixed = "";
    for (const music of o.hasMusic ? [true, false] : [false]) {
      const run = await runFfmpeg(storySoundArgs({ voice: o.voPath, music: music ? o.musicPath : null, total: o.total, tail: TAIL_S, out: sound }));
      if (run.status === 0 && fs.existsSync(sound)) { mixed = music ? "with its music" : "with no music"; break; }
      console.error(`[narrated] the long story's sound could not be mixed ${music ? "with its music — mixed without it" : ""}: ${(run.stderr || "").slice(-200)}`);
    }
    if (!mixed) throw new Error("[narrated] the story's sound could not be mixed");
    await o.beat();
    for (const rung of rungs) {
      // 2) THE PICTURE, part by part
      let why = "";
      for (let p = 0; p < parts.length && !why; p++) {
        const part = parts[p];
        const from = part.start / FPS;
        const cap = rung.words === "none" ? null : captionGraph(cardsDuring(o.cards, from, from + part.frames / FPS), o.style, o.fontFile, o.W, o.H);
        try {
          const words = !cap ? [] : rung.words === "styled" ? cap.styled || cap.plain : cap.plain;
          const scenes = Array.from({ length: part.to - part.from }, (_, k) => {
            const i = part.from + k;
            return sceneIn(i, { still: o.norm[i], clip: o.moves[i], camera: o.cameras?.[i] }, o.frames[i], o.W, o.H, rung);
          });
          const run = await runFfmpeg(storyPartArgs(scenes, o.frames.slice(part.from, part.to), words, part.clock, files[p]));
          const got = run.status === 0 && fs.existsSync(files[p]) ? streamSeconds(files[p]).video : null;
          if (!(got && Math.abs(got - part.frames / FPS) <= 1.5 / FPS)) {
            why = `part ${p + 1} of ${parts.length} (scenes ${part.from + 1} to ${part.to}): ${run.status === 0 ? `its picture is ${got} s, its scenes ${(part.frames / FPS).toFixed(3)} s` : `ffmpeg stopped: ${(run.stderr || "").slice(-200)}`}`;
          }
        } finally { cap?.cleanup(); }
        await o.beat();
      }
      if (!why) {
        // 3) TOGETHER — each part starting on the frame the one before it ended, and the sound under all of them
        fs.writeFileSync(list, joinList(files, parts.map((x) => x.frames)), "utf8");
        const run = await runFfmpeg(storyJoinArgs({ list, sound, total: o.total, out: o.outPath }));
        const made = run.status === 0 && fs.existsSync(o.outPath) ? streamSeconds(o.outPath) : null;
        const sum = parts.reduce((s, x) => s + x.frames, 0) / FPS;
        if (made && made.video && Math.abs(made.video - sum) <= 2 / FPS && made.audio && made.audio > 1) {
          console.log(`[narrated] ${o.norm.length} scenes cut in ${parts.length} parts (${parts.map((x) => x.to - x.from).join(", ")} scenes) ${rung.how}, ${mixed}: ${sum.toFixed(1)} s`);
          if (tried.length) console.error(`[narrated] the story was cut ${rung.how} after: ${tried.join("; ")}`);
          if (rung.words === "none" && hasWords) console.error("[narrated] the captions could not be drawn — the story shipped without them");
          return;
        }
        why = `the parts put together: ${run.status === 0 ? `its picture ${made?.video} s against ${sum.toFixed(3)} s, its sound ${made?.audio} s` : `ffmpeg stopped: ${(run.stderr || "").slice(-200)}`}`;
      }
      tried.push(`${rung.how} — ${why}`);
      console.error(`[narrated] the long story could not be cut ${rung.how}: ${why}`);
      await o.beat();
    }
  } finally {
    for (const f of [...files, list, sound]) { try { fs.rmSync(f, { force: true }); } catch { /* best effort */ } }
  }
  throw new Error(`[narrated] the story could not be cut in parts — ${tried.join("; ")}`);
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
  /** A CHARACTER'S SHOW (character-series.ts): the line every episode ends on, and which episode of which
   *  show this is (kept on the piece as meta.show). */
  signoff?: string;
  show?: ShowMeta | null;
  /** …and who TELLS it: the star's name, when the story is told in the star's own voice — it is then
   *  written as theirs, in the first person (film-engine.server.ts → the TELLER line). */
  teller?: string;
  /** TOLD AGAIN IN ANOTHER LANGUAGE (story-translate.ts): the language to tell it in — the narrator's
   *  voice, the timing and the words on screen all follow it. Unset = the shop's own content language. */
  lang?: string | null;
  /** …and the story it is a re-telling of (its asset id), recorded on the new one. */
  translatedFrom?: string | null;
  /** THE STORY'S OWN CAST as the storyboard drew it (story-picture.ts → castToken): the portraits a scene
   *  drawn here is drawn from, and who the piece says is in it. */
  castRef?: string | null;
  /** THE LADDER's first two rungs (story-motion.ts): "still" = told over its still pictures; anything
   *  else = they move. */
  pictures?: string | null;
  /** …and, told over its stills, how they move (story-motion.ts → StillCamera; unset = Gentle). A scene of the
   *  approved story may name its own (`camera` on the scene: the storyboard's chip on its picture). */
  stillCamera?: string | null;
  resume?: { ckTreatment?: string; ckApproved?: string; ckVoPath?: string; ckVoUrl?: string; ckWords?: string; ckImages?: string; ckMusic?: string; ckMotion?: string; ckCast?: string; ckPictureFaults?: string };
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
  // (a five-minute story is written here in five answers or more, the job saying it is at work as each comes back)
  else treatment = await previewFilmTreatment({ shopId: opts.shopId, template: tmpl.key, topic: opts.topic, sceneCount: opts.sceneCount, beat: () => ckpt({ ckBeat: Date.now() }), contentLang: lang, mode: "narrated", cast: (opts.cast || []).map((c) => ({ name: c.name, desc: c.look, kind: c.kind })), ...(opts.signoff ? { signoff: opts.signoff } : {}), ...(opts.teller ? { teller: opts.teller } : {}), series: opts.series });
  // (an episode of a show: its OWN name, in full, as its writer gave it — before the show's name goes on)
  const showEpisodeName = opts.show ? episodeOwnName(treatment.title, opts.show.name) : "";
  // an episode is called "<Series> — Episode <N>", however its story was written
  if (opts.series) treatment.title = episodeTitle(opts.series.title, opts.series.episode, treatment.title);
  // …and so is an episode of A CHARACTER'S SHOW: "<Show> — Episode <N>: <its own name>". The show's name is
  // put on it here, the same way every time, so its poster bills the show and names the episode under it
  // (story-poster.ts → posterTitle). Idempotent, so a restart leaves it as it is.
  else if (opts.show) treatment.title = episodeTitle(opts.show.name, opts.show.episode, treatment.title);
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
  let pictureFaults: ReturnType<typeof keptFaults> = [];
  if (resume.ckPictureFaults) { try { const p = JSON.parse(resume.ckPictureFaults); if (Array.isArray(p)) pictureFaults = p; } catch { /* none kept */ } }
  let imgs: (string | null)[] = [];
  if (resume.ckImages) { try { imgs = JSON.parse(resume.ckImages) as (string | null)[]; } catch { imgs = []; } }
  if (imgs.length !== treatment.scenes.length) {
    if (approved.length === treatment.scenes.length && approved.every(Boolean)) imgs = approved;
    else {
      // ONLY THE SCENES WITH NO PICTURE ARE DRAWN. (One scene added to an approved storyboard used to
      // have EVERY picture drawn again — and all but that one thrown away for the approved ones.)
      const missing = treatment.scenes.map((_, i) => i).filter((i) => !approved[i]);
      // (…saying the job is at work whenever a picture comes back: a five-minute story is thirty-two of them)
      // (…and the idea it was written from: a night story's pictures are drawn at night — story-picture.ts → storyNight)
      const drawn = await narratedSceneSeeds({ template: tmpl.key, treatment, cast: opts.cast, aspect, only: missing, castRef: storyCastRef || null, beat: () => ckpt({ ckBeat: Date.now() }), idea: opts.topic });
      if (drawn.castRef) storyCastRef = drawn.castRef;
      // (a picture KEPT with somebody still wrong — the best of its goes — is written down: nobody reads
      //  this server's log, and a story made in one press has no storyboard to flag it on)
      pictureFaults = keptFaults(drawn.sceneChecks);
      if (pictureFaults.length) await ckpt({ ckPictureFaults: JSON.stringify(pictureFaults) });
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
  if (storyMotionOn(opts.pictures)) {
    try {
      const seeds: string[] = [];
      for (const s of stills) seeds.push(await withoutBars(s));
      const end = windows[windows.length - 1].t1 + TAIL_S;
      // (a CREATURE'S face seen close stays still — its picture's slow push-in: the engine softened the lake woman's
      //  too-wide smile into an ordinary face as her close-up moved, 2026-11-25. Only a creature the story invented:
      //  a show's own star moves.)
      const creatures = (treatment.cast || []).map((e) => castEntry(e)).filter((c) => !!c.name && characterKind(c.name, c.look) === "monster").map((c) => c.name);
      const still = treatment.scenes.map((s) => sceneShot(s) === "close" && creatures.some((n) => presentIn(n, s.visual || "")));
      // (…a run of twelve at a time, for a story longer than that: animateInRuns, above)
      motion = await animateInRuns({
        seeds, visuals: treatment.scenes.map((s) => s.visual || s.caption || ""), cams: treatment.scenes.map((s) => sceneShot(s)),
        told: windows.map((w, i) => (i === windows.length - 1 ? end : w.t1) - w.t0),
        base, W, H, jobId, ckMotion: resume.ckMotion, still,
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
  // (Hindi, Urdu: the face that has the script — the subtitle renderer draws them, caption-burn.server.ts)
  let wordsDrawable = true;
  try { fontFile = await resolveCaptionFont(lines.join(" ")); }
  catch (e) { wordsDrawable = false; console.error(`[narrated] no font for these words — told without captions: ${e instanceof Error ? e.message.slice(0, 140) : e}`); }
  const outName = `nar-${Date.now()}-${rid()}.mp4`;
  const outPath = path.join(RENDERS(), outName);
  // THE CAMERA OF A STILL STORY (story-motion.ts → StillCamera; the owner, 2026-11-26: "optional selects for the image
  // similar to other providers (shake, slight motion, etch etch)") — for a story told over its stills, and only then: a
  // moving story is the engine's to animate, and a scene of one whose clip could not be made keeps its gentle move.
  // Each scene by its own camera when the storyboard gave it one, else the story's.
  const stillCamera = stillCameraOf(opts.stillCamera) || "gentle";
  const cameras = !storyMotionOn(opts.pictures) ? treatment.scenes.map((s) => stillCameraOf((s as { camera?: unknown }).camera) || stillCamera) : undefined;
  await assembleNarrated({ stills, clips: motion?.clips, windows, voPath, musicPath, cards: wordsDrawable ? cards : [], style, fontFile, W, H, outPath, jobId, cameras });
  try { await mirrorRender(outName, fs.readFileSync(outPath)); } catch { /* non-fatal */ }

  // THE POSTER — who is billed: the cast the maker picked, then the story's own. It never fails the film:
  // without one the shelf shows the first frame, as it always did. (STORY_POSTER=off turns it off.)
  let poster: string | null = null;
  if (process.env.STORY_POSTER !== "off") {
    try {
      const billed = [...(opts.cast || []).map((c) => c?.name || ""), ...readCastToken(storyCastRef).refs.map((c) => c.name)].filter(Boolean);
      // (an episode of a show is billed with its own name IN FULL — the shelf's title is cut to fit a shelf)
      const billedAs = opts.show ? `${opts.show.name} — Episode ${opts.show.episode}${showEpisodeName ? `: ${showEpisodeName}` : ""}` : treatment.title || opts.topic || "";
      poster = await makeStoryPoster({ stills, visuals: treatment.scenes.map((s) => s.visual || ""), names: billed, title: billedAs, videoName: outName });
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
        // A CHARACTER'S SHOW: which episode of whose show this is (character-series.ts)
        ...(opts.show ? { show: { ...opts.show, ...(showEpisodeName ? { title: showEpisodeName } : {}) } } : {}),
        // what its timing was made from — for the operator alone (web.archive's loader)
        timing,
        // …and which of its pictures were KEPT with somebody still not right (the best of three goes)
        ...(pictureFaults.length ? { pictureFaults } : {}),
        // THE PICTURES MOVE: how many scenes do, what was asked for now (seconds = what was paid for), and
        // why any scene kept its still
        // (a story its maker asked for over STILL pictures says so — it did not lose its motion, it never
        //  asked for any; one told again from it stays still. Under its OWN key, `rung`: it was written as
        //  `pictures: "still"`, over the picture list just above — so a still story lost its pictures, and
        //  Another language, Edit story and its Archive cover had none to reuse. Found in review of S13.)
        ...(storyPicturesOf(opts.pictures) === "still" ? { rung: "still" } : {}),
        // …and THE CAMERA its stills were told with, when its maker picked one (Edit story, Next episode and Another
        // language tell it again with it — story-motion.ts → storyCameraOf); a scene's own stays on the scene
        ...(cameras && stillCamera !== "gentle" ? { stillCamera } : {}),
        ...(motion ? { motion: { engine: STORY_MOTION_ENGINE, scenes: motion.clips.filter(Boolean).length, of: stills.length, made: motion.made, reused: motion.reused, seconds: motion.seconds, ...(motion.faults.length ? { faults: motion.faults.slice(0, 8) } : {}), ...(motion.looks.length ? { looks: motion.looks.slice(0, 12) } : {}) } } : {}),
      }),
    },
  });
  return asset.id;
}
