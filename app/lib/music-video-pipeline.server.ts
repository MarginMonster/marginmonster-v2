// Lip-sync MUSIC VIDEO engine (Film tab · "Music Video" template).
//
// A real, full-length (~2-minute) genre music video where ONE consistent artist
// actually SINGS the song on camera — DaBaby / Oliver Tree style. Isolated from
// generateFilm (sung-over-stills) and generateTestMovie (spoken dialogue): its own
// engine so neither is touched.
//
// Pipeline:
//   1. SCRIPT  — previewFilmTreatment writes a FULL ~2-min song (lyric chunks, one
//                per scene) + N distinct performance settings, flavoured by GENRE.
//   2. SONG    — singToDisk (minimax) renders ONE coherent genre track; we measure
//                its real duration and split it into N contiguous segments.
//   3. ARTIST  — one reference portrait locks the look; every scene image is
//                conditioned on it so the artist never morphs.
//   4. PERFORM — OmniHuman lip-syncs the artist (in each setting) to that scene's
//                song SEGMENT. A failed scene falls back to a still-over-audio clip
//                so one bad beat never kills the whole (expensive) render.
//   5. ASSEMBLE— hard-cut concat KEEPING each clip's audio: the segments play back
//                in order, so the full song is reconstructed gaplessly with the
//                artist lip-synced throughout.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db.server";
import { renderCreativeSeed, editSubjectIntoScene, renderStyledSeedMulti } from "./image-generation.server";
import { anthropicVision } from "./anthropic.server";
import { checkpointJob, download, ffprobeDuration, runFfmpeg } from "./ugc-ad-pipeline.server";
import { falVideoSubmit, falVideoPoll, falLipSync, falEnabled } from "./fal-video.server";
import { mirrorRender } from "./object-storage.server";
import { filmTemplate, previewFilmTreatment, GENRES, genreOrDefault, PROPS, type FilmTreatment } from "./film-engine.server";
import { singToDisk } from "./music-generation.server";

const RENDERS = () => path.join(process.cwd(), "data", "renders");
const rid = () => crypto.randomBytes(6).toString("hex");
// Real, PREMIUM look — cinematic high-end music video, but real photography (not CGI/AI-looking).
const REALISM = "Photorealistic and cinematic like a real high-end music video — shot on a real camera, realistic skin texture and fine detail, premium production value and colour; NOT plastic, waxy, cartoonish, CGI or obviously AI-generated. Keep it tasteful and genuinely cool — NOT cheesy, corny or over-the-top; NO fireworks, confetti, lasers, sparks, glitter or gimmicky effects.";
// There is exactly ONE artist. Wide / full-body shots otherwise sometimes composed or animated a
// SECOND copy of the same person standing beside them (the "two artists in the barn" glitch).
const ONE_PERSON = "There is exactly ONE artist in the shot — a single person; never a duplicate, twin, clone or second copy of them.";
// MOTION engine: silent image-to-video with real body + camera movement (fixes the static-background
// complaint). Kling 2.5-turbo-pro = fast + good motion. The mouth is driven SEPARATELY by the
// dedicated sync-lipsync model afterwards — OmniHuman did both at once and was "pitiful" at the mouth.
const I2V_MODEL = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";
// Backup motion engine — if the primary blips (a transient fal outage stilled a whole render once),
// each scene retries on this before falling back to a static still, so one provider hiccup can't
// turn the video into a slideshow.
const I2V_FALLBACK = "fal-ai/kling-video/v2.6/pro/image-to-video";
const CLIP_MAX = 10; // the i2v clip length cap (Kling 2.x); segments are sliced to match so the song stays continuous
// DIRECTOR'S SHOT LIST — a real music video is EDITED like a real music video: a FEW performance
// shots (artist to camera) intercut with lots of B-ROLL — dancing, the car/prop in action, lifestyle
// and narrative cutaways, establishing wides, detail shots. The artist is NOT singing to camera every
// scene (owner: "they're not just the singer singing in every scene — cut scenes come in with props,
// dancing, cars"). This reads premium AND hides the lip-sync: only the `perform` shots carry a synced
// mouth (now just ~1 in 3), and the b-roll rides the song over motion — fewer mouths = fewer sync
// mistakes. `propOk` marks shots where a big prop (a car, a tiger, chains) actually FITS and should be
// FEATURED — a performance medium/wide or the dedicated prop-hero cutaway. Tight face close-ups and
// distant atmospheric b-roll are propOk:false (a horse shoved into a face close-up just gets cropped).
const SHOTLIST: Array<{ role: "perform" | "broll"; frame: string; cam: string; propOk?: boolean }> = [
  { role: "broll",   frame: "a cinematic WIDE ESTABLISHING shot of the whole location that sets the mood — the artist is small in the frame or walking through it, NOT facing camera", cam: "a slow cinematic push-in" },
  { role: "perform", frame: "a MEDIUM shot of the artist performing straight to camera, framed from the waist up", cam: "a smooth handheld sway", propOk: true },
  { role: "broll",   frame: "a dynamic, energetic B-ROLL shot of DANCING or movement — backup dancers or the artist moving stylishly through the scene, full of rhythm, NOT facing camera and NOT singing", cam: "a sweeping pan that follows the movement" },
  { role: "perform", frame: "a tight, intense CLOSE-UP on the artist's face performing to camera, shallow depth of field", cam: "a slow subtle drift-in" },
  { role: "broll",   frame: "a cinematic HERO B-ROLL shot that FEATURES the prop in action — e.g. the car rolling, the chains gleaming, the motorcycle revving, the animal prowling — the artist near it but NOT singing to camera", cam: "a slow orbit showing it off", propOk: true },
  { role: "broll",   frame: "a stylish LIFESTYLE / NARRATIVE cutaway that tells the story — the artist walking, riding, arriving or living the moment, cinematic and aspirational, NOT facing camera singing", cam: "a smooth handheld follow" },
  { role: "perform", frame: "a cool, composed WIDE shot of the artist performing to camera, full body, confident and stylish", cam: "a slow orbit around the artist", propOk: true },
  { role: "broll",   frame: "an atmospheric detail B-ROLL shot — striking textures, the scenery in motion or a moody cinematic flourish, premium and filmic — the artist a small part of the frame or absent", cam: "a slow tracking move" },
];

/** The shot for scene i — honoring the pre-editor's per-scene Performance/Cut-scene override
 *  (scene.kind) over the default SHOTLIST cadence. Flipping a scene swaps in a role-appropriate
 *  generic framing so a performance beat doesn't get stuck with a b-roll frame (or vice versa). */
function shotFor(s: { kind?: "perform" | "broll" } | undefined, i: number): { role: "perform" | "broll"; frame: string; cam: string; propOk?: boolean } {
  const base = SHOTLIST[i % SHOTLIST.length];
  const role = (s && s.kind) || base.role;
  if (role === base.role) return base;
  return role === "perform"
    ? { role: "perform", frame: "a MEDIUM shot of the artist performing to camera, waist up, confident and stylish", cam: "a smooth handheld sway", propOk: true }
    : { role: "broll", frame: "a cinematic B-ROLL cutaway (no singer performing) — props, movement or scenery, premium and filmic", cam: "a slow cinematic move", propOk: true };
}

/** Run async work over items with a bounded number in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

/** Persist a /renders file to the S3 mirror (non-fatal) and return its public URL. */
async function hostRender(base: string, absPath: string): Promise<string> {
  const name = path.basename(absPath);
  try { await mirrorRender(name, fs.readFileSync(absPath)); } catch { /* local /renders is enough for fal to fetch */ }
  return `${base}/renders/${name}`;
}

/** Slice [start,start+len] out of the song into its own /renders mp3. Re-encodes
 *  (not -c copy) so the cut lands on an exact sample, not a keyframe. */
async function sliceAudio(songPath: string, start: number, len: number): Promise<string> {
  const name = `mvseg-${Date.now()}-${rid()}.mp3`;
  const out = path.join(RENDERS(), name);
  await runFfmpeg(["-y", "-ss", start.toFixed(2), "-t", len.toFixed(2), "-i", songPath, "-c:a", "libmp3lame", "-q:a", "4", out]);
  if (!fs.existsSync(out)) throw new Error("[musicvideo] segment slice failed");
  return out;
}

/** Fallback clip when OmniHuman can't sing a scene: the still image held for the
 *  segment's length with the segment audio — so the song stays continuous and the
 *  render still completes (just a static shot for that beat). */
async function stillClip(imgPath: string, segAudioPath: string, dur: number, W: number, H: number): Promise<string> {
  const out = path.join(RENDERS(), `mv-still-${Date.now()}-${rid()}.mp4`);
  await runFfmpeg([
    "-y", "-loop", "1", "-i", imgPath, "-i", segAudioPath,
    "-t", dur.toFixed(2),
    "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out,
  ]);
  if (!fs.existsSync(out)) throw new Error("[musicvideo] still-clip fallback failed");
  return out;
}

/** Assemble the clips into the finished music video. The MUSIC must never cut at a seam (the owner's
 *  "on the transition the music cuts" fix): each clip carried its OWN sliced segment, and cross-fading
 *  two adjacent slices left an audible break. So instead we (1) normalise every clip to EXACTLY D sec
 *  of SILENT video, (2) hard-join them on the beat (exact timeline = N×D), then (3) lay the ONE ORIGINAL
 *  continuous song over the whole thing. Continuous music carries across each cut so it reads smooth
 *  (how real music videos cut), and because every clip sits at its exact song position the lip-sync
 *  stays aligned. Falls back to a plain per-clip concat if anything here fails, so it never dies. */
async function assembleMusicVideo(clips: string[], songPath: string, D: number, outPath: string, W: number, H: number): Promise<void> {
  const N = clips.length;
  if (!N) throw new Error("[musicvideo] no clips to assemble");

  try {
    // 1) each clip → EXACTLY D sec, silent, uniform WxH/fps (tpad clones the last frame if a clip came
    //    back short, then -t trims to D — so the video lands exactly on the song's segment grid).
    const norm: string[] = [];
    for (let i = 0; i < N; i++) {
      const o = path.join(RENDERS(), `mvn-${Date.now()}-${i}-${rid()}.mp4`);
      const r = await runFfmpeg(["-y", "-i", clips[i], "-an",
        "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=2`,
        "-t", D.toFixed(2), "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", o]);
      if (r.status === 0 && fs.existsSync(o) && ffprobeDuration(o) > 0.5) norm.push(o);
      else throw new Error(`[musicvideo] clip ${i} normalise failed`);
    }
    // 2) hard-join the uniform clips (exact timeline, no overlap).
    const listPath = path.join(RENDERS(), `mvlist-${Date.now()}-${rid()}.txt`);
    fs.writeFileSync(listPath, norm.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
    const silent = path.join(RENDERS(), `mvcat-${Date.now()}-${rid()}.mp4`);
    const rc = await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-an", silent]);
    if (rc.status !== 0 || !fs.existsSync(silent)) throw new Error("[musicvideo] concat failed");
    // 3) lay the ORIGINAL continuous song over the whole cut (no seam, no per-slice crossfade). End on
    //    the music (trim to the shorter of the video grid and the real song) so there's no dead air.
    const songLen = ffprobeDuration(songPath);
    const total = songLen > 1 ? Math.min(N * D, songLen) : N * D;
    const ra = await runFfmpeg(["-y", "-i", silent, "-i", songPath,
      "-map", "0:v", "-map", "1:a", "-t", total.toFixed(2),
      "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outPath]);
    if (ra.status === 0 && fs.existsSync(outPath) && ffprobeDuration(outPath) > 1) return;
  } catch { /* fall through to the per-clip concat */ }

  // FALLBACK: plain hard-cut concat keeping each clip's audio.
  const args: string[] = ["-y"];
  clips.forEach((c) => args.push("-i", c));
  const f: string[] = [];
  const labels: string[] = [];
  clips.forEach((_, i) => {
    f.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30[v${i}]`);
    f.push(`[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    labels.push(`[v${i}][a${i}]`);
  });
  f.push(`${labels.join("")}concat=n=${N}:v=1:a=1[vo][ao]`);
  args.push("-filter_complex", f.join(";"), "-map", "[vo]", "-map", "[ao]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outPath);
  const r = await runFfmpeg(args);
  if (r.status === 0 && fs.existsSync(outPath)) return;
  fs.copyFileSync(clips[0], outPath);
}

/** Vision gate for props: is the picked prop (a tiger, a horse…) actually visible in this scene
 *  image? Country treatments keep writing their OWN animals (a "loyal dog") that crowd the prop out,
 *  and an edit occasionally just drops it — this catches both so we can re-roll. Fails OPEN (accept)
 *  on a vision outage so a QA hiccup never blocks a render. sonnet-4-6 (not haiku): the strict reader,
 *  same model as the cartoon product-in-hand gate. */
async function sceneShowsProp(imgUrl: string, noun: string): Promise<boolean> {
  try {
    const ans = await anthropicVision(
      `Look at this music-video frame. Is a real, recognizable ${noun} clearly visible in it? Reply with ONE word, YES or NO.\nYES = a ${noun} is clearly present in the shot.\nNO = there is no ${noun} — only people, or a different animal such as a dog, or no animal at all.`,
      [imgUrl], { maxTokens: 8, model: "claude-sonnet-4-6" }
    );
    return /\byes\b/i.test(ans);
  } catch { return true; }
}

/** Build the per-scene SEED stills (the storyboard): the hero portrait → a locked single-animal
 *  reference + an artist-anchor per prop → one edited, vision-gated still per scene. SHARED by
 *  generateMusicVideo and the FREE pre-seed PREVIEW, so what the owner approves in the storyboard is
 *  EXACTLY what the video renders from — no surprise after a long render. Returns absolute scene-image
 *  URLs (a null for a scene that totally failed; the caller falls back on the hero). */
async function buildMusicVideoSeeds(p: {
  genre: string;
  props?: string[];
  /** The merchant's OWN props — AI-made or an uploaded photo. Each carries its image, which IS the
   *  prop reference (no "generate a tiger" guesswork — the render uses the exact thing they chose). */
  customProps?: Array<{ key: string; label: string; img: string }>;
  scenes: FilmTreatment["scenes"];
  propForScene: Record<number, string>;
  artistBible: string;
  /** The merchant PICKED one of their avatars to BE the artist — lock THAT face for the whole video. */
  heroUrl?: string;
  /** Extra named cast beyond the lead (co-stars, dancers) — each face is styled into the genre then
   *  composed INTO perform scenes alongside the artist (identity-locked, never blended). */
  castExtra?: Array<{ img: string; name: string }>;
  jobId?: string;
  resume?: Record<string, string | undefined>;
  base: string;
}): Promise<{ artistRef: string | null; sceneImgs: (string | null)[] }> {
  const g = GENRES[genreOrDefault(p.genre)];
  const custom = p.customProps || [];
  const customOf = (k: string) => custom.find((c) => c.key === k);
  const propList = (p.props || []).filter((k) => PROPS[k] || customOf(k));
  const propNoun = (k: string): string => { const c = customOf(k); return (c ? c.label : (PROPS[k]?.label || k)).replace(/^[^\p{L}]+/u, "").trim().toLowerCase() || k; };
  const propPhrase = (k: string): string => { const c = customOf(k); return c ? `the ${c.label}` : (PROPS[k]?.phrase || `a ${propNoun(k)}`); };
  // The "only animal, no dog" guard was tuned for the ANIMAL catalog props; a custom skateboard
  // isn't an animal, so only apply it to catalog props (custom props seed from their own photo).
  const animalGuard = (k: string, noun: string): string => (customOf(k) ? "" : ` The ONLY animal in frame is this one ${noun}: do NOT add a dog or any other animal.`);
  const resume = p.resume || {};
  const ckpt = async (patch: Record<string, unknown>) => { if (p.jobId) await checkpointJob(p.jobId, patch); };
  const abs = (u: string | null | undefined): string | null => (u ? (u.startsWith("http") ? u : `${p.base}${u}`) : null);
  const scenes = p.scenes;
  const propForScene = p.propForScene;

  // ARTIST hero — ONE realistic portrait that locks the look (face + wardrobe) for the WHOLE video.
  // If the merchant PICKED one of their avatars, lock THAT face as the artist — style it into the genre
  // (keep the exact identity) so the person they chose is who performs every scene. Otherwise generate
  // a fresh artist that fits the genre.
  let artistRef = abs(resume.ckArtist);
  if (!artistRef) {
    const picked = abs(p.heroUrl);
    let ref: string | null = null;
    if (picked) {
      const styled = await editSubjectIntoScene(picked, `Keep this EXACT person's face and identity identical — same face, hair, skin and build; do NOT swap them for anyone else. Make it a realistic ${g.label} music-video shot of them, who ${g.perform}, to camera. ${g.look}. Clear sharp face with a natural, genuine expression that fits the song's emotion — NOT angry, snarling or aggressive. ${REALISM}`);
      ref = styled || picked;
    } else {
      ref = await renderCreativeSeed(`A realistic ${g.label} music-video shot of the artist, who ${g.perform}, to camera: ${p.artistBible}. ${g.look}. Clear sharp face with a natural, genuine expression that fits the song's emotion — NOT angry, snarling or aggressive. ${REALISM}`, "9:16");
    }
    if (ref) { await ckpt({ ckArtist: ref }); artistRef = abs(ref); }
  }

  // EXTRA CAST — style each picked co-star into the genre like the lead (identity locked), so they can
  // be composed INTO perform scenes alongside the artist. Cached per member so a restart doesn't redo it.
  const castExtra = (p.castExtra || []).filter((m) => m && m.img).slice(0, 2); // artist + up to 2 = 3-ref cap
  const castRefs: string[] = [];
  for (let ci = 0; ci < castExtra.length; ci++) {
    const m = castExtra[ci];
    let cref = abs(resume[`ckCast_${ci}`]) || null;
    if (!cref) {
      const src = abs(m.img);
      if (src) {
        const styled = await editSubjectIntoScene(src, `Keep this EXACT person's face and identity identical — same face, hair, skin and build; do NOT swap them for anyone else. Make it a realistic ${g.label} music-video shot of them. ${g.look}. Clear sharp face with a natural, genuine expression. ${REALISM}`);
        cref = abs(styled) || src;
        if (cref && !resume[`ckCast_${ci}`]) await ckpt({ [`ckCast_${ci}`]: cref });
      }
    }
    if (cref) castRefs.push(cref);
  }
  const castNames = castExtra.map((m) => (m.name || "").trim()).filter(Boolean).join(", ");

  // PROP references + artist-anchors — the robust "props must actually show" path (single locked
  // animal per prop + an artist+prop anchor; every prompt says this is the ONLY animal, no dog).
  const propRefs: Record<string, string> = {};
  const propAnchors: Record<string, string> = {};
  if (artistRef) {
    for (const k of propList) {
      const noun = propNoun(k);
      const c = customOf(k);
      // Custom prop: its OWN photo IS the reference. Catalog prop: render one locked single-subject shot.
      let pr = abs(resume[`ckPropRef_${k}`]) || (c ? abs(c.img) : null);
      if (!pr) { const r = await renderCreativeSeed(`A single real ${noun} — exactly ONE ${noun}, full body, photorealistic, plain neutral background. The only subject is this one ${noun}. ${REALISM}`, "9:16"); pr = abs(r); }
      if (pr) { propRefs[k] = pr; if (!resume[`ckPropRef_${k}`]) await ckpt({ [`ckPropRef_${k}`]: pr }); }
      const cached = abs(resume[`ckProp_${k}`]);
      if (cached) { propAnchors[k] = cached; continue; }
      const a = await editSubjectIntoScene(artistRef, `Keep this EXACT person identical. Place them together with exactly ONE ${propPhrase(k)} — a SINGLE ${noun}, only one.${animalGuard(k, noun)} Full body, neutral studio backdrop. ${REALISM}`);
      propAnchors[k] = a ? (abs(a) || artistRef) : artistRef;
      await ckpt({ [`ckProp_${k}`]: propAnchors[k] });
    }
  }

  // PER-SCENE stills — edit the hero (or the artist+prop anchor) into each setting; VISION-GATE props
  // (if the picked prop didn't survive the edit, force it in with a hard-locked [artist, prop] compose).
  const sceneImgs = await mapLimit(scenes, 3, async (s, i) => {
    const shot = shotFor(s, i);
    const propKey = propForScene[i];
    const noun = propKey ? propNoun(propKey) : "";
    const srcRef = (propKey && propAnchors[propKey]) || artistRef;
    const propClause = propKey ? ` Keep the SAME single ${noun} from the reference in the shot — exactly one ${noun}, no duplicates.${animalGuard(propKey, noun)}` : "";
    const performNote = shot.role === "perform" ? ` The artist ${g.perform}, with a natural, genuine expression — NOT angry, snarling or aggressive.` : "";
    const prompt = `Keep this EXACT person identical — same face, hair, skin, build, wardrobe and jewelry; do NOT change who they are or swap them for a different person. Compose the shot as ${shot.frame}, in this setting: ${s.visual}.${propClause}${performNote} ${g.look}. ${REALISM} ${ONE_PERSON}`;
    // Perform scene WITH extra cast → compose the artist + co-stars together (identity-locked, no blend).
    let img = (shot.role === "perform" && castRefs.length && artistRef)
      ? await renderStyledSeedMulti(`A cinematic ${g.label} music-video shot. Compose it as ${shot.frame}, in this setting: ${s.visual}. Feature the artist together with ${castNames || "the co-stars"} — keep EACH person's face and identity EXACTLY as in their reference photo; do NOT blend, merge, duplicate or swap faces.${propClause}${performNote} ${g.look}. ${REALISM}`, [artistRef, ...castRefs].slice(0, 3), "9:16")
      : srcRef
        ? await editSubjectIntoScene(srcRef, prompt)
        : await renderCreativeSeed(`${shot.frame}. ${s.visual}. ${g.look}. ${REALISM}`, "9:16");
    if (propKey && artistRef && propRefs[propKey]) {
      const cur = img ? abs(img) : null;
      if (!cur || !(await sceneShowsProp(cur, noun))) {
        const forced = await renderStyledSeedMulti(`${shot.frame}, in this setting: ${s.visual}. The artist with exactly ONE ${noun} beside them — a single ${noun}, no duplicates.${animalGuard(propKey, noun)} ${g.look}. ${REALISM} ${ONE_PERSON}`, [artistRef, propRefs[propKey]], "9:16");
        if (forced) img = forced;
      }
    }
    return img ? abs(img) : srcRef;
  });

  return { artistRef, sceneImgs };
}

/** FREE pre-seed PREVIEW: generate the storyboard stills (one per scene, props placed) WITHOUT
 *  rendering the ~40-minute video, so the owner can check accuracy + confirm the prop is in each
 *  scene BEFORE committing (the "limit the surprise" ask). The approved stills ride back into
 *  generateMusicVideo as `approvedSceneImgs` so it renders EXACTLY what was previewed. */
export async function previewMusicVideoScenes(opts: {
  shopId: string; topic?: string; genre?: string; sceneCount?: number; props?: string[]; customProps?: Array<{ key: string; label: string; img: string }>; treatment?: FilmTreatment; heroUrl?: string; castExtra?: Array<{ img: string; name: string }>;
}): Promise<{ treatment: FilmTreatment; sceneImgs: (string | null)[]; propForScene: Record<number, string>; artistRef: string | null }> {
  const tmpl = filmTemplate("musicvideo");
  const genre = genreOrDefault(opts.genre);
  const g = GENRES[genre];
  const N = Math.max(tmpl.minScenes, Math.min(tmpl.maxScenes, opts.sceneCount ?? tmpl.defaultScenes));
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const propList = (opts.props || []).filter((k) => PROPS[k] || (opts.customProps || []).some((c) => c.key === k));

  let treatment: FilmTreatment = opts.treatment && opts.treatment.scenes?.length
    ? opts.treatment
    : await previewFilmTreatment({ shopId: opts.shopId, template: "musicvideo", topic: opts.topic, sceneCount: N, genre });
  treatment.scenes = treatment.scenes.slice(0, N);
  const scenes = treatment.scenes;

  const propForScene: Record<number, string> = {};
  if (propList.length) {
    const propScenes = scenes.map((_, i) => i).filter((i) => { const sh = SHOTLIST[i % SHOTLIST.length]; return sh.propOk; });
    propScenes.forEach((sceneI, k) => { propForScene[sceneI] = propList[k % propList.length]; });
  }
  const artistBible = (treatment.cast && treatment.cast[0]) || `a charismatic ${g.label} artist`;

  const { sceneImgs, artistRef } = await buildMusicVideoSeeds({ genre, props: opts.props, customProps: opts.customProps, scenes, propForScene, artistBible, heroUrl: opts.heroUrl, castExtra: opts.castExtra, resume: {}, base });
  return { treatment, sceneImgs, propForScene, artistRef };
}

/** Re-roll ONE storyboard scene — regenerate just that still, reusing the SAME artist hero so the
 *  person stays consistent, for when a scene comes back wrong (the prop missing, or an uninvited
 *  character — "the tiger scene was an old lady"). Fast (one scene) vs re-rolling the whole batch.
 *  Mirrors buildMusicVideoSeeds' per-scene path (edit the hero/anchor into the setting + vision-gate
 *  the prop) — keep the prompts in sync with that function. */
export async function rerollMusicVideoScene(opts: {
  artistRef: string; sceneVisual: string; sceneIndex: number; propKey?: string; genre?: string;
}): Promise<string | null> {
  const g = GENRES[genreOrDefault(opts.genre)];
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const abs = (u: string | null | undefined): string | null => (u ? (u.startsWith("http") ? u : `${base}${u}`) : null);
  const propNoun = (k: string): string => (PROPS[k]?.label || k).replace(/^[^\p{L}]+/u, "").trim().toLowerCase() || k;
  const artistRef = abs(opts.artistRef);
  if (!artistRef) return null;
  const shot = SHOTLIST[opts.sceneIndex % SHOTLIST.length];
  const propKey = opts.propKey && PROPS[opts.propKey] ? opts.propKey : undefined;
  const noun = propKey ? propNoun(propKey) : "";

  // For a prop scene, rebuild its locked single-animal ref + artist-anchor so the one prop lands.
  let srcRef: string | null = artistRef;
  let propRef: string | null = null;
  if (propKey) {
    const pr = await renderCreativeSeed(`A single real ${noun} — exactly ONE ${noun}, full body, photorealistic, plain neutral background. The only subject is this one ${noun}. ${REALISM}`, "9:16");
    propRef = abs(pr);
    const a = await editSubjectIntoScene(artistRef, `Keep this EXACT person identical. Place them together with exactly ONE ${PROPS[propKey].phrase} — a SINGLE ${noun}, only one. The ONLY animal in the image is this one ${noun}: do NOT include a dog or any other animal. Full body, neutral studio backdrop. ${REALISM}`);
    srcRef = a ? (abs(a) || artistRef) : artistRef;
  }
  const propClause = propKey ? ` Keep the SAME single ${noun} from the reference in the shot — exactly one ${noun}, the ONLY animal in frame; do NOT add more ${noun}, a dog, or any other animal.` : "";
  const performNote = shot.role === "perform" ? ` The artist ${g.perform}, with a natural, genuine expression — NOT angry, snarling or aggressive.` : "";
  const prompt = `Keep this EXACT person identical — same face, hair, skin, build, wardrobe and jewelry; do NOT change who they are or swap them for a different person. Compose the shot as ${shot.frame}, in this setting: ${opts.sceneVisual}.${propClause}${performNote} ${g.look}. ${REALISM} ${ONE_PERSON}`;
  let img = srcRef ? await editSubjectIntoScene(srcRef, prompt) : null;
  if (propKey && propRef) {
    const cur = img ? abs(img) : null;
    if (!cur || !(await sceneShowsProp(cur, noun))) {
      const forced = await renderStyledSeedMulti(`${shot.frame}, in this setting: ${opts.sceneVisual}. The artist with exactly ONE ${noun} beside them — a single ${noun}, the ONLY animal in frame, no dog or other animals. ${g.look}. ${REALISM} ${ONE_PERSON}`, [artistRef, propRef], "9:16");
      if (forced) img = forced;
    }
  }
  return img ? abs(img) : null;
}

export async function generateMusicVideo(opts: {
  shopId: string;
  topic?: string;
  genre?: string;
  sceneCount?: number;
  section?: string;
  jobId?: string;
  treatment?: FilmTreatment;
  /** BYO-song: a merchant-uploaded audio track to use INSTEAD of generating one with minimax. */
  songUrl?: string;
  /** PROPS (keys from film-engine PROPS) to weave into the scenes — tiger, luxury car, chains… */
  props?: string[];
  /** The merchant's OWN props (AI-made or uploaded photos) — each carries its image to seed from. */
  customProps?: Array<{ key: string; label: string; img: string }>;
  /** The merchant PICKED one of their avatars to BE the artist — lock THAT face for the whole video. */
  heroUrl?: string;
  /** Extra named cast beyond the lead — composed into perform scenes alongside the artist. */
  castExtra?: Array<{ img: string; name: string }>;
  /** Owner PREVIEWED + approved these exact per-scene stills — render them, don't re-seed (no surprise).
   *  Index-aligned with scenes; a null entry means that scene fell back and should seed fresh. */
  approvedSceneImgs?: (string | null)[];
  resume?: { ckTreatment?: string; ckSong?: string; ckArtist?: string; [k: string]: string | undefined };
}): Promise<string> {
  const tmpl = filmTemplate("musicvideo");
  const genre = genreOrDefault(opts.genre);
  const g = GENRES[genre];
  // Props the merchant picked. The "several tigers" fix = treat each prop like the movie pipeline
  // treats its cast: establish it ONCE as a single locked reference entity, then SEED the scenes
  // that feature it from THAT reference — instead of re-describing "a tiger" in text every scene,
  // which spawned a different (and sometimes multiplied) tiger each time. `propNoun` gives a short
  // singular noun ("tiger", "luxury car") so we can say "the SAME single X, exactly one" everywhere.
  const customOf = (k: string) => (opts.customProps || []).find((c) => c.key === k);
  const propList = (opts.props || []).filter((k) => PROPS[k] || customOf(k));
  const propNoun = (k: string): string => { const c = customOf(k); return (c ? c.label : (PROPS[k]?.label || k)).replace(/^[^\p{L}]+/u, "").trim().toLowerCase() || k; };
  const [W, H] = [720, 1280]; // vertical music video (Shorts/TikTok/Reels)
  const N = Math.max(tmpl.minScenes, Math.min(tmpl.maxScenes, opts.sceneCount ?? tmpl.defaultScenes));
  const jobId = opts.jobId;
  const resume = opts.resume || {};
  const ckpt = async (patch: Record<string, unknown>) => { if (jobId) await checkpointJob(jobId, patch); };
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const abs = (u: string | null | undefined): string | null => (u ? (u.startsWith("http") ? u : `${base}${u}`) : null);

  if (!falEnabled()) throw new Error("[musicvideo] FAL_KEY not set — i2v + lip-sync unavailable");

  // 1) SCRIPT — full ~2-min genre song (lyric chunk per scene) + N settings.
  let treatment: FilmTreatment;
  if (resume.ckTreatment) treatment = JSON.parse(resume.ckTreatment);
  else if (opts.treatment && opts.treatment.scenes?.length) treatment = opts.treatment;
  else treatment = await previewFilmTreatment({ shopId: opts.shopId, template: "musicvideo", topic: opts.topic, sceneCount: N, genre });
  treatment.scenes = treatment.scenes.slice(0, N);
  await ckpt({ ckTreatment: JSON.stringify(treatment) });
  const scenes = treatment.scenes;
  // Prop PLACEMENT: props land ONLY on PERFORMANCE shots (artist prominent, facing camera) and
  // round-robin among the picks — at most one prop per scene. B-roll / wide atmospheric shots stay
  // prop-free (a lone animal in an empty wide is where duplicates + weirdness creep in). This also
  // naturally limits how often each prop appears, so it reads as a recurring motif, not a herd.
  const propForScene: Record<number, string> = {};
  if (propList.length) {
    const propScenes = scenes.map((_, i) => i).filter((i) => { const sh = SHOTLIST[i % SHOTLIST.length]; return sh.propOk; });
    propScenes.forEach((sceneI, k) => { propForScene[sceneI] = propList[k % propList.length]; });
  }
  const artistBible = (treatment.cast && treatment.cast[0]) || `a charismatic ${g.label} artist`;
  const lyrics = scenes.map((s) => (s.caption || "").replace(/\s*\/\s*/g, "\n")).filter(Boolean).join("\n");
  if (!lyrics.trim()) throw new Error("[musicvideo] no lyrics");

  // 2) SONG — one coherent genre track; measure its REAL length (the 2-min target
  //    is only as long as minimax gives) and split into N contiguous segments.
  let songPath = resume.ckSong && fs.existsSync(resume.ckSong) ? resume.ckSong : "";
  if (!songPath && opts.songUrl) {
    // BYO-song: the merchant uploaded their OWN track — use it instead of generating one. The
    // upload endpoint wrote it to this server's /renders, so it's usually already local.
    const local = path.join(RENDERS(), path.basename(opts.songUrl.split("?")[0]));
    if (fs.existsSync(local)) songPath = local;
    else { const dl = path.join(RENDERS(), `mvsong-dl-${rid()}.mp3`); await download(opts.songUrl, dl); songPath = dl; }
    await ckpt({ ckSong: songPath });
  }
  if (!songPath) {
    songPath = await singToDisk(lyrics, `${g.song}. ${treatment.musicMood || ""}`.slice(0, 300));
    await ckpt({ ckSong: songPath });
  }
  const songDur = ffprobeDuration(songPath);
  if (!(songDur > 3)) throw new Error("[musicvideo] song came back too short");
  // Each scene is ONE i2v clip; slice the song into contiguous D-second segments so the clips
  // concat into a continuous song. CRITICAL: Kling image-to-video only accepts a duration of
  // "5" or "10" — any other value (e.g. 6 or 7 from a short song / N) silently 422s and the whole
  // scene falls back to a STILL (the "no video, just still images" bug). So D snaps to 5 or 10.
  const D = (songDur / N) >= 7.5 ? 10 : 5;

  // 3+4) SCENE SEEDS — the storyboard stills. If the owner PREVIEWED + approved them, render those
  //      EXACT stills (what you saw IS what renders — no surprise); otherwise build them now via the
  //      SHARED seed path the preview uses (hero + prop anchors + vision-gated per-scene edits).
  const sceneImgs = opts.approvedSceneImgs && opts.approvedSceneImgs.length === N
    ? opts.approvedSceneImgs.map((u) => abs(u))
    : (await buildMusicVideoSeeds({ genre, props: opts.props, customProps: opts.customProps, scenes, propForScene, artistBible, heroUrl: opts.heroUrl, castExtra: opts.castExtra, jobId, resume, base })).sceneImgs;

  // 5) song SEGMENTS (local mp3 + hosted url for the lip-sync model to drive the mouth to).
  const segs: Array<{ localPath: string; url: string }> = [];
  for (let i = 0; i < N; i++) {
    const p = await sliceAudio(songPath, i * D, D);
    segs.push({ localPath: p, url: await hostRender(base, p) });
  }

  // 6) PERFORM — TWO engines so each does one job well (OmniHuman did both and the mouth was
  //    "pitiful"): (a) MOTION — a SILENT i2v clip where the artist + camera actually move (fixes
  //    the static-background note); (b) MOUTH — the dedicated sync-lipsync model re-drives the lips
  //    on that footage to the song segment. Retry; fall back to a still-over-audio clip.
  const clips = await mapLimit(scenes, 3, async (_s, i) => {
    const imgAbs = sceneImgs[i];
    const seg = segs[i];
    const shot = shotFor(_s, i);
    if (!imgAbs) return null;
    const imgLocal = path.join(RENDERS(), path.basename(imgAbs));
    const pKey = propForScene[i];
    // Reference the prop already baked into the seed image — never "add a tiger" (which spawns new
    // ones); just hold the single one in frame and forbid duplicates as the clip animates.
    const keepProp = pKey ? ` The single ${propNoun(pKey)} already in the shot stays in frame — exactly one; do NOT add or duplicate any ${propNoun(pKey)}, a dog, or any other animal.` : "";
    const motionPrompt = shot.role === "perform"
      ? `A premium ${g.label} music video. ${shot.frame}. The camera does ${shot.cam}. The artist ${g.perform}. Keep the movement NATURAL and VARIED — do NOT repeat the same gesture over and over, no exaggerated or aggressive motions, and no angry or snarling faces. Keep the head mostly steady and facing camera so the singing reads clearly and the lips stay in sync with the vocals.${keepProp} There is NO microphone — the artist never holds a mic. Keep the SAME person identical; photoreal, cinematic, high-production. ${ONE_PERSON}`
      : `A premium ${g.label} music video — cinematic B-ROLL. ${shot.frame}. The camera does ${shot.cam}; the scene is alive with natural, flowing motion (no repeated or jittery movement).${keepProp} Keep the SAME person identical; photoreal, cinematic, high-production. ${ONE_PERSON}`;
    for (const i2vModel of [I2V_MODEL, I2V_FALLBACK]) {
      try {
        // silent motion clip — primary engine, then the backup if it blips (so a provider outage
        // can't still a whole scene the way it once stilled an entire render)
        const reqId = await falVideoSubmit(i2vModel, { startImage: imgAbs, prompt: motionPrompt, durationSec: D, generateAudio: false });
        const motionUrl = await falVideoPoll(i2vModel, reqId, 12 * 60_000);
        const out = path.join(RENDERS(), `mv-${Date.now()}-${i}-${rid()}.mp4`);
        if (shot.role === "perform") {
          // PERFORMANCE: dedicated lip-sync drives the mouth to this song segment. RETRY it — a single
          // transient fal hiccup used to drop the whole clip to "motion-only", where the mouth keeps the
          // i2v's generic singing motion that matches NOTHING (owner: "moving lips but not with the words
          // whatsoever"). Three tries with backoff turns an intermittent failure into a synced mouth.
          let finalUrl = motionUrl, synced = false;
          for (let att = 0; att < 3 && !synced; att++) {
            try { finalUrl = await falLipSync(motionUrl, seg.url); synced = true; }
            catch (e) {
              if (att === 2) console.error(`[musicvideo] scene ${i + 1} lipsync FAILED after 3 tries, motion-only (mouth won't match): ${e instanceof Error ? e.message.slice(0, 140) : e}`);
              else await new Promise((r) => setTimeout(r, 2500));
            }
          }
          await download(finalUrl, out);
        } else {
          // B-ROLL: lay the song segment over the silent motion clip (no mouth to sync). If the mux
          // fails, `out` stays invalid and the still fallback (which has audio) takes over.
          const vtmp = path.join(RENDERS(), `mvv-${Date.now()}-${i}-${rid()}.mp4`);
          await download(motionUrl, vtmp);
          await runFfmpeg(["-y", "-i", vtmp, "-i", seg.localPath, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out]);
        }
        if (fs.existsSync(out) && ffprobeDuration(out) > 1) { await ckpt({ [`ckClip${i}`]: out }); return out; }
      } catch (e) {
        console.error(`[musicvideo] scene ${i + 1} (${shot.role}) i2v ${i2vModel} failed: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
      }
    }
    // Fallback: still image held over the segment audio (keeps the song continuous).
    try {
      if (fs.existsSync(imgLocal)) return await stillClip(imgLocal, seg.localPath, D, W, H);
    } catch (e) { console.error(`[musicvideo] scene ${i + 1} still fallback failed: ${e instanceof Error ? e.message.slice(0, 120) : e}`); }
    return null;
  });
  const good = clips.filter((c): c is string => !!c);
  if (!good.length) {
    const nullImgs = sceneImgs.filter((x) => !x).length;
    throw new Error(`[musicvideo] every scene failed to render (nullSceneImgs=${nullImgs}/${N}, approved=${opts.approvedSceneImgs ? "yes" : "no"}, fal=${falEnabled() ? "on" : "off"})`);
  }

  // 7) ASSEMBLE — hard-cut concat keeping audio → the full song under the performance.
  const outName = `mv-${Date.now()}-${rid()}.mp4`;
  const outPath = path.join(RENDERS(), outName);
  await assembleMusicVideo(good, songPath, D, outPath, W, H);
  const finalDur = ffprobeDuration(outPath);
  try { await mirrorRender(outName, fs.readFileSync(outPath)); } catch { /* non-fatal */ }
  const storedUrl = `/renders/${outName}`;

  const asset = await db.asset.create({
    data: {
      shopId: opts.shopId,
      type: "VIDEO_AD",
      status: "PENDING",
      title: `Music Video — ${(treatment.title || opts.topic || g.label).slice(0, 60)}`,
      bodyJson: JSON.stringify({ style: "MUSICVIDEO", videoUrl: storedUrl, prompt: opts.topic || "", genre, treatment }),
      metaJson: JSON.stringify({
        kind: "musicvideo", template: "musicvideo", section: opts.section || "creator",
        genre, genreLabel: g.label, scenes: good.length, lipSynced: good.length, aspect: "9:16",
        songSeconds: Math.round(songDur), seconds: Math.round(finalDur), engine: "kling2.5+synclipsync",
      }),
    },
  });
  return asset.id;
}
