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
import { checkpointJob, download, ffprobeDuration, repPoll, runFfmpeg } from "./ugc-ad-pipeline.server";
import { createWhisperx, wordsFromWhisperx } from "./faceless-video.server";
import { falVideoSubmit, falVideoPoll, falLipSync, falEnabled } from "./fal-video.server";
import { mirrorRender } from "./object-storage.server";
import { filmTemplate, previewFilmTreatment, GENRES, genreOrDefault, PROPS, type FilmTreatment } from "./film-engine.server";
import { singToDisk } from "./music-generation.server";
import { ensureVoiceModel, coverSongInVoice, matchLoudness } from "./singing-voice.server";
import { MV_MAX_SECONDS, beatTimes, defaultRole, editPlan, paceFor, planFilter, sceneSecondsOf, shotSlot, type Cut, type Pace } from "./mv-pace";
import {
  CAST_PROMPT_MAX, MAX_COSTARS, MIC_MOTION_LINE, NO_NEW_MIC_LINE, SOLO_EDIT_MAX,
  castCheckPrompt, castFaults, castFix, castMotionLine, castStillPrompt, micFits, parseCastCheck, sceneCast, singerOf, soloEditPrompt, soloStillPrompt,
  type CastCheck,
} from "./mv-cast";
import { bestLag, featureMixFilter, featuredIn, pitchChangeFor, vocalGaps, voiceWindows, type Gap, type VoiceWindow } from "./mv-feature";

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
// `short` = the same framing in a few words, for a shot that has CO-STARS in it: that prompt has to say
// who everyone is before it says anything else, and the picture model reads a limited length (mv-cast.ts).
const SHOTLIST: Array<{ role: "perform" | "broll"; frame: string; short: string; cam: string; propOk?: boolean }> = [
  { role: "broll",   frame: "a cinematic WIDE ESTABLISHING shot of the whole location that sets the mood — the artist is small in the frame or walking through it, NOT facing camera", short: "Wide establishing shot of the whole place, the people small in it and not looking at the camera", cam: "a slow cinematic push-in" },
  { role: "perform", frame: "a MEDIUM shot of the artist performing straight to camera, framed from the waist up", short: "Medium-wide shot, everyone visible from the knees up", cam: "a smooth handheld sway", propOk: true },
  { role: "broll",   frame: "a dynamic, energetic B-ROLL shot of DANCING or movement — backup dancers or the artist moving stylishly through the scene, full of rhythm, NOT facing camera and NOT singing", short: "Wide dynamic shot of all of them dancing, not looking at the camera", cam: "a sweeping pan that follows the movement" },
  { role: "perform", frame: "a MEDIUM CLOSE-UP of the artist performing to camera — head and shoulders in frame, NOT a tight face-filling extreme close-up, a natural relaxed expression, shallow depth of field", short: "Medium shot, everyone visible from the waist up", cam: "a slow subtle drift-in" },
  { role: "broll",   frame: "a cinematic HERO B-ROLL shot that FEATURES the prop in action — e.g. the car rolling, the chains gleaming, the motorcycle revving, the animal prowling — the artist near it but NOT singing to camera", short: "Cinematic hero shot of them in the place, not looking at the camera", cam: "a slow orbit showing it off", propOk: true },
  { role: "broll",   frame: "a stylish LIFESTYLE / NARRATIVE cutaway that tells the story — the artist walking, riding, arriving or living the moment, cinematic and aspirational, NOT facing camera singing", short: "Lifestyle shot of them walking through the scene together, not looking at the camera", cam: "a smooth handheld follow" },
  { role: "perform", frame: "a cool, composed WIDE shot of the artist performing to camera, full body, confident and stylish", short: "Wide full-body shot", cam: "a slow orbit around the artist", propOk: true },
  { role: "broll",   frame: "an atmospheric detail B-ROLL shot — striking textures, the scenery in motion or a moody cinematic flourish, premium and filmic — the artist a small part of the frame or absent", short: "Atmospheric wide shot, the people a small part of it", cam: "a slow tracking move" },
];

type Shot = (typeof SHOTLIST)[number] & { slot: number };

/** The shot for scene i of n: what the scene was written or set as (scene.kind), else the default for
 *  its place (mv-pace.ts defaultRole — a short video leads with the performance), framed by the shot-list
 *  slot of that kind (mv-pace.ts shotSlot — a flipped scene gets a real framing of its own kind, where it
 *  used to get one generic "medium shot" or "b-roll cutaway" however many were flipped). */
function shotFor(s: { kind?: "perform" | "broll" } | undefined, i: number, n: number, sceneSec: number = 10): Shot {
  const role = (s && s.kind) || defaultRole(i, n, sceneSec);
  const slot = shotSlot(role, i);
  return { ...SHOTLIST[slot], slot };
}

/** WHICH SCENES GET A PROP. Props land only on shots where one fits (propOk — a performance medium or
 *  wide, the prop-hero cut scene), round-robin among the picks, one a scene at most: a recurring motif,
 *  not a herd. A performance in a CO-STAR's own verse is skipped — a prop is the artist's (its anchor
 *  picture is the artist with it), and that shot is the co-star's. One function for the storyboard and
 *  the render, so a prop the maker saw is the prop that is filmed. */
function placeProps(scenes: FilmTreatment["scenes"], propList: string[], sceneSec: number, castNames: string[]): Record<number, string> {
  const out: Record<number, string> = {};
  if (!propList.length) return out;
  const fits = scenes.map((_, i) => i).filter((i) => {
    const shot = shotFor(scenes[i], i, scenes.length, sceneSec);
    return !!shot.propOk && !(shot.role === "perform" && singerOf(scenes[i], castNames) >= 0);
  });
  fits.forEach((sceneI, k) => { out[sceneI] = propList[k % propList.length]; });
  return out;
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

/** The lyric sheet for the FULL-LENGTH song engine (1:00+ videos): the scene lyrics with ARRANGEMENT TAGS.
 *  The tags are what make music-2.5 arrange a whole song — intro, verses, a returning chorus, outro —
 *  rather than rattle the lines off: tagged sheets came back at a steady ~4.6–5.5 s per line (15 lines →
 *  82 s, 22 → 104 s, 30 → 139 s), while the same kind of lyrics with no tags swung from 44 s to 108 s.
 *  A scene whose lines are mostly REPEATS of lines sung elsewhere is the chorus (the writer is told to
 *  write the chorus out every time it returns). */
function fullSongSheet(scenes: Array<{ caption?: string }>): string {
  const sceneLines = scenes.map((s) => (s.caption || "").split(/\s*\/\s*/).map((l) => l.trim()).filter(Boolean));
  const norm = (l: string) => l.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, "").replace(/\s+/g, " ").trim();
  const seen = new Map<string, number>();
  for (const ls of sceneLines) for (const l of ls) seen.set(norm(l), (seen.get(norm(l)) || 0) + 1);
  const out: string[] = ["[Intro]"];
  let prev = "";
  for (const ls of sceneLines) {
    if (!ls.length) continue;
    const repeats = ls.filter((l) => (seen.get(norm(l)) || 0) > 1).length;
    const part = repeats * 2 >= ls.length ? "[Chorus]" : "[Verse]";
    if (part !== prev) { out.push(part); prev = part; }
    out.push(...ls);
  }
  out.push("[Outro]");
  return out.join("\n");
}

/** Force the song to EXACTLY `targetSec` seconds so the finished video lands on the length the merchant
 *  PICKED (and is billed for). minimax returns an unpredictable "full song" length, so without this the
 *  video came out however long the song happened to be — the tester's "I set 20s, got 40s" bug. Long song
 *  → trim to target with a soft tail fade; short song → loop it past the target, then trim + fade (covers
 *  the 2-minute tier when minimax sings short). Fails OPEN (returns the original path) so a fit hiccup
 *  never kills a render. */
async function fitSongToLength(songPath: string, targetSec: number): Promise<string> {
  try {
    const cur = ffprobeDuration(songPath);
    if (!(targetSec > 0) || !(cur > 0.5)) return songPath;
    if (Math.abs(cur - targetSec) < 0.25) return songPath; // already on target within a frame
    const out = path.join(RENDERS(), `mvfit-${Date.now()}-${rid()}.mp3`);
    const fade = Math.min(1.2, targetSec * 0.15);            // soft ending so the cut never clips mid-note
    const fadeStart = Math.max(0, targetSec - fade).toFixed(2);
    const afade = `afade=t=out:st=${fadeStart}:d=${fade.toFixed(2)}`;
    if (cur >= targetSec) {
      const r = await runFfmpeg(["-y", "-t", targetSec.toFixed(2), "-i", songPath,
        "-af", afade, "-c:a", "libmp3lame", "-q:a", "4", out]);
      if (r.status === 0 && fs.existsSync(out) && ffprobeDuration(out) > 1) return out;
    } else {
      const loops = Math.ceil(targetSec / cur); // -stream_loop N repeats the input N extra times
      const r = await runFfmpeg(["-y", "-stream_loop", String(loops), "-i", songPath,
        "-t", targetSec.toFixed(2), "-af", afade, "-c:a", "libmp3lame", "-q:a", "4", out]);
      if (r.status === 0 && fs.existsSync(out) && ffprobeDuration(out) > 1) return out;
    }
  } catch { /* fall through to the original song */ }
  return songPath;
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
/** The beats of the finished song, found by listening to it — so a paced edit can cut on them. Never
 *  fatal: no beats (a song with no steady pulse, a decode that fails) means the cuts stay on the grid. */
async function songBeats(songPath: string): Promise<number[]> {
  const raw = path.join(RENDERS(), `beats-${Date.now()}-${rid()}.f32`);
  try {
    const r = await runFfmpeg(["-y", "-i", songPath, "-ac", "1", "-ar", "11025", "-f", "f32le", raw]);
    if (r.status !== 0 || !fs.existsSync(raw)) return [];
    const buf = fs.readFileSync(raw);
    const pcm = new Float32Array(buf.byteLength >> 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = buf.readFloatLE(i * 4);
    const beats = beatTimes(pcm, 11025);
    if (beats.length > 2) console.log(`[musicvideo] the song's beat: about ${Math.round(60 / ((beats[beats.length - 1] - beats[0]) / (beats.length - 1)))} a minute (${beats.length} beats)`);
    return beats;
  } catch (e) {
    console.error(`[musicvideo] could not find the song's beat — cuts stay on the grid: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
    return [];
  } finally { try { fs.unlinkSync(raw); } catch { /* nothing to clean */ } }
}

async function assembleMusicVideo(clips: string[], songPath: string, D: number, outPath: string, W: number, H: number, cuts?: Cut[]): Promise<void> {
  const N = clips.length;
  if (!N) throw new Error("[musicvideo] no clips to assemble");
  // a cut list that is just "every clip whole, in order" is the plain join below
  const edit = cuts && cuts.length > N && cuts.every((c) => c.src >= 0 && c.src < N && c.start >= 0 && c.dur > 0 && c.start + c.dur <= D + 1e-6) ? cuts : null;

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
    // 2) hard-join the uniform clips (exact timeline, no overlap) — or, at a faster PACE, cut them to the
    //    edit: the same footage, more scene changes, every performance shot still at its own place in the
    //    song (see mv-pace.ts). If that edit cannot be made the plain join below still makes the video.
    const silent = path.join(RENDERS(), `mvcat-${Date.now()}-${rid()}.mp4`);
    let joined = false;
    if (edit) {
      const args = ["-y"];
      norm.forEach((p) => args.push("-i", p));
      const re = await runFfmpeg([...args, "-filter_complex", planFilter(edit, N, 30), "-map", "[v]", "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", silent]);
      joined = re.status === 0 && fs.existsSync(silent) && Math.abs(ffprobeDuration(silent) - N * D) < 0.5;
      if (!joined) console.error(`[musicvideo] the paced edit (${edit.length} cuts) could not be made — joining the clips whole: ${(re.stderr || "").slice(-200)}`);
    }
    if (!joined) {
      const listPath = path.join(RENDERS(), `mvlist-${Date.now()}-${rid()}.txt`);
      fs.writeFileSync(listPath, norm.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
      const rc = await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-an", silent]);
      if (rc.status !== 0 || !fs.existsSync(silent)) throw new Error("[musicvideo] concat failed");
    }
    // 3) lay the ORIGINAL continuous song over the whole cut (no seam, no per-slice crossfade). End on
    //    the music (trim to the shorter of the video grid and the real song) so there's no dead air.
    //    The song was FIT to the grid upstream; a re-encoded or re-voiced track can land a few ms short of
    //    it, so pad those with silence (apad) and cut on the grid — the file is EXACTLY the picked length.
    //    Only a genuinely short song (a fit that failed open) still ends the video early.
    const songLen = ffprobeDuration(songPath);
    const grid = N * D;
    const total = songLen > 1 ? (songLen >= grid - 0.5 ? grid : Math.min(grid, songLen)) : grid;
    const ra = await runFfmpeg(["-y", "-i", silent, "-i", songPath,
      "-map", "0:v", "-map", "1:a", "-af", "apad", "-t", total.toFixed(2),
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

/** What the checker sees in a cast still: how many people, WHICH of the cast (it is shown their
 *  reference pictures after the frame), whether anyone is in it twice or blended, who holds a
 *  microphone, whether the prop is there. Null when it cannot be read — a vision outage never blocks a
 *  render. sonnet-4-6, the strict reader (the same model as the prop gate above). */
async function readCast(imgUrl: string, castRefs: string[], prop?: string): Promise<CastCheck | null> {
  try {
    const refs = castRefs.slice(0, 3);
    return parseCastCheck(await anthropicVision(castCheckPrompt({ refs: refs.length, prop }), [imgUrl, ...refs], { maxTokens: 90, model: "claude-sonnet-4-6" }));
  } catch { return null; }
}

/** A cast still and how it fared when it was looked at: `faults` 0 = right, more = what was still wrong
 *  with the best of the tries (the storyboard flags that scene for a re-roll); null = it could not be
 *  checked. */
type CheckedStill = { img: string | null; faults: number | null };

/** ONE still with more than one of the cast in it. A tester picked a star and two back characters and
 *  got one back character, holding the microphone (2026-11-21) — so this picture is no longer taken on
 *  trust. The prompt says who is who before anything else (mv-cast.ts), and the result is LOOKED AT: the
 *  right number of people, a microphone only where one belongs and only in the singer's hand, the prop
 *  if the scene has one. A wrong picture is made again (twice at most) with the fault named; the best of
 *  the tries is kept, so a check that keeps failing still never costs the scene. */
async function castStill(o: {
  /** the genre's label ("Rap / Hip-Hop") */
  genre: string;
  shot: Shot;
  visual: string;
  /** who leads the shot — front and centre, and the one singing in a performance — then everyone else */
  leadRef: string;
  otherRefs: string[];
  asp: string;
  prop?: { noun: string; phrase: string; ref?: string | null; animal?: boolean };
  abs: (u: string | null | undefined) => string | null;
  tag?: string;
}): Promise<CheckedStill> {
  const others = o.otherRefs.filter((r) => r && r !== o.leadRef).slice(0, MAX_COSTARS);
  const k = others.length;
  const performing = o.shot.role === "perform";
  const micOk = micFits(o.visual);
  // three reference pictures at most: the cast first, the prop when there is room for it
  const people = [o.leadRef, ...others];
  const refs = people.slice();
  const propRefIn = !!(o.prop && o.prop.ref && refs.length < 3);
  if (propRefIn) refs.push(o.prop!.ref!);
  const propLine = !o.prop ? "" : `Also in the shot: ${propRefIn ? `the ${o.prop.noun} from the 3rd reference image` : o.prop.phrase} — exactly one${o.prop.animal ? ", and no other animal" : ""}`;
  // the establishing wide and the atmosphere shot have the people small in the frame: nobody to count
  const expect = o.shot.slot === 0 || o.shot.slot === 7 ? null : k + 1;
  let best: { img: string; faults: number } | null = null;
  let fix = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const prompt = castStillPrompt({ genre: o.genre, role: o.shot.role, frame: o.shot.short, visual: o.visual, costars: k, micOk, extra: [propLine, fix].filter(Boolean).join(". ") });
    let img: string | null = null;
    try { img = await renderStyledSeedMulti(prompt, refs, o.asp, undefined, CAST_PROMPT_MAX); } catch { img = null; }
    if (!img) continue;
    const seen = await readCast(o.abs(img) || img, people.map((r) => o.abs(r) || r), o.prop?.noun);
    if (!seen) return { img, faults: null }; // the checker is out: the picture is taken as it is
    const faults = castFaults(seen, expect, micOk, performing, !!o.prop);
    if (!best || faults < best.faults) best = { img, faults };
    if (!faults) break;
    fix = castFix(seen, expect, micOk, performing, o.prop?.noun);
    console.log(`[musicvideo] ${o.tag || "cast shot"}: try ${attempt + 1} had ${seen.people} of ${expect ?? "any"} people, seen=${JSON.stringify(seen.seen || null)}, twin=${seen.twin ?? "?"}, mic=${seen.mic}${o.prop ? `, prop=${seen.prop}` : ""}${attempt < 2 ? " — making it again" : " — keeping the best of three"}`);
  }
  return best || { img: null, faults: null };
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
  /** Per-scene cast (owner edit): scene index → the cast IMAGES to feature in THAT scene (the artist's
   *  hero img and/or co-star imgs). Lets each scene differ — star-only here, star+co-star there, or a
   *  set-only b-roll. When unset for a scene, falls back to "all cast in every perform scene" (legacy). */
  castForScene?: Record<number, string[]>;
  /** Wardrobe (owner edit): cast member IMG → an outfit description ("a sharp black suit"). Applied when
   *  that member is styled into the genre, so they wear it for the whole video. */
  outfits?: Record<string, string>;
  /** Output shape — "9:16" (default), "16:9" or "1:1". Drives the seed render aspect (clips follow). */
  aspect?: string;
  /** How long each scene is (5 or 10) — a short video leads with the performance (mv-pace.ts defaultRole). */
  sceneSeconds?: number;
  jobId?: string;
  resume?: Record<string, string | undefined>;
  base: string;
}): Promise<{ artistRef: string | null; sceneImgs: (string | null)[]; sceneFaults: (number | null)[]; castRefs: string[] }> {
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
  const asp = (p.aspect === "16:9" || p.aspect === "1:1") ? p.aspect : "9:16";
  // Wardrobe: an owner-chosen outfit for a cast member rides their genre-styling prompt (kept for the
  // whole video, since the scenes inherit the styled ref's wardrobe).
  const outfitClause = (img: string | null | undefined): string => {
    const o = img && p.outfits ? (p.outfits[img] || "").trim() : "";
    return o ? ` They are wearing ${o.slice(0, 160)} — keep this outfit consistent in every shot.` : "";
  };

  // ARTIST hero — ONE realistic portrait that locks the look (face + wardrobe) for the WHOLE video.
  // If the merchant PICKED one of their avatars, lock THAT face as the artist — style it into the genre
  // (keep the exact identity) so the person they chose is who performs every scene. Otherwise generate
  // a fresh artist that fits the genre.
  const styleArtist = async (): Promise<string | null> => {
    const cached = abs(resume.ckArtist);
    if (cached) return cached;
    const picked = abs(p.heroUrl);
    let ref: string | null = null;
    if (picked) {
      const styled = await editSubjectIntoScene(picked, `Keep this EXACT person's face and identity identical — same face, hair, skin and build; do NOT swap them for anyone else. Make it a realistic ${g.label} music-video shot of them, who ${g.perform}, to camera.${outfitClause(p.heroUrl)} ${g.look}. Clear sharp face with a natural, genuine expression that fits the song's emotion — NOT angry, snarling or aggressive. ${REALISM}`);
      ref = styled || picked;
    } else {
      ref = await renderCreativeSeed(`A realistic ${g.label} music-video shot of the artist, who ${g.perform}, to camera: ${p.artistBible}. ${g.look}. Clear sharp face with a natural, genuine expression that fits the song's emotion — NOT angry, snarling or aggressive. ${REALISM}`, "9:16");
    }
    if (ref) await ckpt({ ckArtist: ref });
    return abs(ref);
  };

  // EXTRA CAST — style each picked co-star into the genre like the lead (identity locked), so they can
  // be composed INTO perform scenes alongside the artist. Cached per member so a restart doesn't redo it.
  const castExtra = (p.castExtra || []).filter((m) => m && m.img).slice(0, MAX_COSTARS); // 1 star + up to 2 co-stars = 3-ref compositing max (more faces break the render)
  const styleCostar = async (m: { img: string; name: string }, ci: number): Promise<string | null> => {
    const cached = abs(resume[`ckCast_${ci}`]);
    if (cached) return cached;
    const src = abs(m.img);
    if (!src) return null;
    const styled = await editSubjectIntoScene(src, `Keep this EXACT person's face and identity identical — same face, hair, skin and build; do NOT swap them for anyone else. Make it a realistic ${g.label} music-video shot of them.${outfitClause(m.img)} ${g.look}. Clear sharp face with a natural, genuine expression. ${REALISM}`);
    const cref = abs(styled) || src;
    await ckpt({ [`ckCast_${ci}`]: cref });
    return cref;
  };
  // The star and the co-stars are dressed AT THE SAME TIME: one after another they were most of the wait
  // for a storyboard (the first live one with two co-stars: about a minute and a half before a single
  // scene was drawn, of two and a half in all).
  const [artistStyled, ...costarStyled] = await Promise.all([styleArtist(), ...castExtra.map((m, ci) => styleCostar(m, ci).catch(() => abs(m.img)))]);
  const artistRef: string | null = artistStyled;
  // index-aligned with castExtra (a co-star whose styling failed keeps their own picture)
  const castRefs: string[] = castExtra.map((m, ci) => costarStyled[ci] || abs(m.img) || "");
  const castNameList = castExtra.map((m) => (m.name || "").trim());
  const sceneSec = sceneSecondsOf(p.sceneSeconds);
  // WHO a cast picture is: -1 = the artist, k = co-star k (a per-scene cast list stores source pictures).
  const heroAbs = abs(p.heroUrl);
  const whoOfImg = (img: string): number | null => {
    const a = abs(img);
    if (!a) return null;
    if (heroAbs && a === heroAbs) return -1;
    const k = castExtra.findIndex((m) => abs(m.img) === a);
    return k >= 0 ? k : null;
  };
  const refOf = (w: number): string | null => (w < 0 ? artistRef : castRefs[w] || null);

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
  const made = await mapLimit(scenes, 3, async (s, i): Promise<CheckedStill> => {
    const shot = shotFor(s, i, scenes.length, sceneSec);
    // WHO is in this scene (mv-cast.ts sceneCast): who LEADS it and who is beside them. The artist leads
    // every scene but a performance in a co-star's own verse, which that co-star leads — it is their
    // voice there, so their mouth. Beside the lead: the maker's per-scene pick (castForScene stores
    // source pictures), else the shared default — every co-star in the artist's performance, the ones a
    // cut scene names (all of them in the dance scene), nobody in a co-star's own performance.
    const picked = p.castForScene ? p.castForScene[i] : undefined;
    const cast = sceneCast({ scene: s, role: shot.role, slot: shot.slot, names: castNameList, listed: picked ? picked.map(whoOfImg).filter((w): w is number => w != null) : undefined });
    const featLead = cast.lead >= 0 && !!refOf(cast.lead);
    const leadRef = (featLead ? refOf(cast.lead) : artistRef) || artistRef;
    const otherRefs = Array.from(new Set(cast.others.map(refOf).filter((r): r is string => !!r && r !== leadRef))).slice(0, MAX_COSTARS);
    // (a prop is the ARTIST's — its anchor picture is the artist with it — so a co-star's own shot has none)
    const propKey = featLead ? undefined : propForScene[i];
    const noun = propKey ? propNoun(propKey) : "";
    const srcRef = featLead ? leadRef : ((propKey && propAnchors[propKey]) || artistRef);
    const micOk = micFits(s.visual);
    const propClause = propKey ? ` Keep the SAME single ${noun} from the reference in the shot — exactly one ${noun}, no duplicates.${animalGuard(propKey, noun)}` : "";
    const performNote = shot.role === "perform" ? ` The artist ${g.perform}, with a natural, genuine expression — NOT angry, snarling or aggressive.` : "";
    // Compose the scene still, three ways (the prompts are built in mv-cast.ts — who is in the shot and
    // the microphone rule come FIRST there, because each picture call reads a limited length):
    //   · the lead WITH others  → composed from everyone's reference, then checked by eye (castStill);
    //   · the lead alone, wide or square → composed from their reference at that shape;
    //   · the lead alone, upright → their own picture edited into the scene (the proven path).
    const multiCast = otherRefs.length > 0 && !!leadRef; // the scene's cast in ANY scene (barn band, truck riders), not just a performance
    let faults: number | null = null;
    const genPrimary = async (): Promise<string | null> => {
      if (multiCast && leadRef) {
        const r = await castStill({ genre: g.label, shot, visual: s.visual, leadRef, otherRefs, asp, abs, tag: `scene ${i + 1}`,
          prop: propKey ? { noun, phrase: propPhrase(propKey), ref: propRefs[propKey], animal: !customOf(propKey) } : undefined });
        faults = r.faults;
        return r.img;
      }
      if (srcRef && asp !== "9:16") return renderStyledSeedMulti(soloStillPrompt({ genre: g.label, role: shot.role, frame: shot.frame, visual: s.visual, micOk, extra: propClause }), [srcRef], asp, undefined, CAST_PROMPT_MAX);
      if (srcRef) return editSubjectIntoScene(srcRef, soloEditPrompt({ role: shot.role, frame: shot.frame, visual: s.visual, micOk, extra: `${propClause}${performNote}` }), SOLO_EDIT_MAX);
      return renderCreativeSeed(`${shot.frame}. ${s.visual}. ${g.look}. ${REALISM}`, asp);
    };
    // RETRY before giving up — a transient gen blip otherwise fell back to the raw artist portrait, which
    // came out IDENTICAL across failed scenes AND in the portrait's 9:16 (ignoring the chosen shape).
    let img: string | null = null;
    for (let attempt = 0; attempt < 2 && !img; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1500));
      try { img = await genPrimary(); } catch { img = null; }
    }
    // Last resort = a scene-only render at the CHOSEN aspect (distinct per scene, correct shape) — NEVER
    // the portrait fallback that produced the duplicate 9:16 stills.
    if (!img) { try { img = await renderCreativeSeed(`A cinematic ${g.label} music-video shot: ${shot.frame}, ${s.visual}. ${g.look}. ${REALISM}`, asp); } catch { /* keep null */ } }
    // (a shot with co-stars has already had its prop checked, in castStill — and the forced compose
    //  below is the artist and the prop ONLY, which would throw the co-stars out of their own scene)
    if (propKey && artistRef && propRefs[propKey] && !multiCast) {
      const cur = img ? abs(img) : null;
      if (!cur || !(await sceneShowsProp(cur, noun))) {
        // (what must be in the picture is said first — it used to come after the setting, past where the
        //  picture call stops reading)
        const forced = await renderStyledSeedMulti(`The artist (the person in the 1st reference image) with exactly ONE ${noun} beside them (the ${noun} in the 2nd reference image) — a single ${noun}, no duplicates.${animalGuard(propKey, noun)} ${ONE_PERSON} Composed as ${shot.frame}, in this setting: ${s.visual}`, [artistRef, propRefs[propKey]], asp, undefined, CAST_PROMPT_MAX);
        if (forced) img = forced;
      }
    }
    return { img: img ? abs(img) : srcRef, faults };
  });

  return { artistRef, sceneImgs: made.map((m) => m.img), sceneFaults: made.map((m) => m.faults), castRefs };
}

/** FREE pre-seed PREVIEW: generate the storyboard stills (one per scene, props placed) WITHOUT
 *  rendering the ~40-minute video, so the owner can check accuracy + confirm the prop is in each
 *  scene BEFORE committing (the "limit the surprise" ask). The approved stills ride back into
 *  generateMusicVideo as `approvedSceneImgs` so it renders EXACTLY what was previewed. */
export async function previewMusicVideoScenes(opts: {
  shopId: string; topic?: string; genre?: string; sceneCount?: number; props?: string[]; customProps?: Array<{ key: string; label: string; img: string }>; treatment?: FilmTreatment; heroUrl?: string; castExtra?: Array<{ img: string; name: string }>; castForScene?: Record<number, string[]>; outfits?: Record<string, string>; aspect?: string; artistName?: string; castNames?: string[]; artistGender?: "m" | "f"; castGenders?: Array<{ name: string; gender: "m" | "f" }>;
  /** How long each scene is — 5 or 10 seconds (the pace decides; unset = 10, as every video was before). */
  sceneSeconds?: number;
  /** A FEATURED VERSE: the names of the co-stars who sing a verse of their own (mv-feature.ts). */
  featureNames?: string[];
}): Promise<{ treatment: FilmTreatment; sceneImgs: (string | null)[]; sceneFaults: (number | null)[]; propForScene: Record<number, string>; artistRef: string | null; castRefs: string[] }> {
  const tmpl = filmTemplate("musicvideo");
  const genre = genreOrDefault(opts.genre);
  const g = GENRES[genre];
  const D = sceneSecondsOf(opts.sceneSeconds);
  const N = Math.max(tmpl.minScenes, Math.min(tmpl.maxScenes, Math.floor(MV_MAX_SECONDS / D), opts.sceneCount ?? tmpl.defaultScenes));
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const propList = (opts.props || []).filter((k) => PROPS[k] || (opts.customProps || []).some((c) => c.key === k));

  let treatment: FilmTreatment = opts.treatment && opts.treatment.scenes?.length
    ? opts.treatment
    : await previewFilmTreatment({ shopId: opts.shopId, template: "musicvideo", topic: opts.topic, sceneCount: N, sceneSeconds: D, genre, artistName: opts.artistName, castNames: opts.castNames, artistGender: opts.artistGender, castGenders: opts.castGenders, featureNames: opts.featureNames });
  treatment.scenes = treatment.scenes.slice(0, N);
  const scenes = treatment.scenes;

  const propForScene = placeProps(scenes, propList, D, (opts.castExtra || []).map((m) => (m?.name || "").trim()));
  const artistBible = (treatment.cast && treatment.cast[0]) || `a charismatic ${g.label} artist`;

  const { sceneImgs, sceneFaults, artistRef, castRefs } = await buildMusicVideoSeeds({ genre, props: opts.props, customProps: opts.customProps, scenes, propForScene, artistBible, heroUrl: opts.heroUrl, castExtra: opts.castExtra, castForScene: opts.castForScene, outfits: opts.outfits, aspect: opts.aspect, sceneSeconds: D, resume: {}, base });
  // Archive every scene still the owner generates here, so their scene generations are saved (not just
  // ephemeral preview frames). Best-effort + parallel — never block or fail the preview on it.
  try {
    const title = (treatment.title || opts.topic || g.label).slice(0, 48);
    await Promise.all(sceneImgs.map((u, i) => (u
      ? db.asset.create({ data: {
          shopId: opts.shopId, type: "IMAGE_AD", status: "PENDING",
          title: `Scene ${i + 1} — ${title}`,
          bodyJson: JSON.stringify({ imageUrl: u, url: u, style: "MUSICVIDEO_SCENE", scene: i + 1 }),
          metaJson: JSON.stringify({ kind: "musicvideo-scene", section: "creator", genre, scene: i + 1 }),
        } }).catch(() => null)
      : Promise.resolve(null))));
  } catch { /* archive is best-effort */ }
  return { treatment, sceneImgs, sceneFaults, propForScene, artistRef, castRefs };
}

/** Re-roll ONE storyboard scene — regenerate just that still, reusing the SAME artist hero so the
 *  person stays consistent, for when a scene comes back wrong (the prop missing, or an uninvited
 *  character — "the tiger scene was an old lady"). Fast (one scene) vs re-rolling the whole batch.
 *  Mirrors buildMusicVideoSeeds' per-scene path (edit the hero/anchor into the setting + vision-gate
 *  the prop) — keep the prompts in sync with that function. */
export async function rerollMusicVideoScene(opts: {
  artistRef: string; sceneVisual: string; sceneIndex: number; propKey?: string; genre?: string;
  /** The scene's co-star styled refs (per-scene cast edit) — composed alongside the artist. */
  castRefs?: string[]; aspect?: string;
  /** The merchant's OWN props (AI-made / uploaded) — so a per-scene custom prop re-rolls from its photo. */
  customProps?: Array<{ key: string; label: string; img: string }>;
  /** The scene's CURRENT Performance/Cut-scene setting + the video's scene count, so a re-roll frames the
   *  shot for what the scene IS now. (It used to re-roll from the default cadence only — flip scene 1 to
   *  Performance, re-roll, and you got another establishing wide.) */
  kind?: "perform" | "broll";
  sceneCount?: number;
  /** How long each scene of this video is (5 or 10) — with the count, it sets the scene's default kind. */
  sceneSeconds?: number;
  /** A FEATURED VERSE: the styled reference of the co-star who LEADS this scene — a performance in their
   *  own verse, sung in their voice (mv-feature.ts). Then `castRefs` is whoever is beside THEM (it may
   *  hold the artist). Unset = the artist leads, as in every scene before. */
  leadRef?: string;
}): Promise<CheckedStill> {
  const g = GENRES[genreOrDefault(opts.genre)];
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const abs = (u: string | null | undefined): string | null => (u ? (u.startsWith("http") ? u : `${base}${u}`) : null);
  const asp = (opts.aspect === "16:9" || opts.aspect === "1:1") ? opts.aspect : "9:16";
  const propNoun = (k: string): string => (PROPS[k]?.label || k).replace(/^[^\p{L}]+/u, "").trim().toLowerCase() || k;
  const artistRef = abs(opts.artistRef);
  if (!artistRef) return { img: null, faults: null };
  const shot = shotFor({ kind: opts.kind }, opts.sceneIndex, opts.sceneCount && opts.sceneCount > 0 ? opts.sceneCount : SHOTLIST.length, sceneSecondsOf(opts.sceneSeconds));
  const micOk = micFits(opts.sceneVisual);
  // who leads: a co-star in their own performance, else the artist
  const featRef = shot.role === "perform" ? abs(opts.leadRef) : null;
  const leadRef = featRef || artistRef;
  // Accept a CATALOG prop OR one of the merchant's OWN custom props (which seed from their photo).
  // (a prop is the artist's: a co-star's own shot has none)
  const custom = (opts.customProps || []).find((c) => c.key === opts.propKey && c.img);
  const propKey = !featRef && opts.propKey && (PROPS[opts.propKey] || custom) ? opts.propKey : undefined;
  const noun = !propKey ? "" : (custom ? ((custom.label || "").replace(/^[^\p{L}]+/u, "").trim().toLowerCase() || "prop") : propNoun(propKey));
  const propPhrase = !propKey ? "" : (custom ? `the ${custom.label}` : (PROPS[propKey].phrase || `a ${noun}`));
  const animalG = (custom || !propKey) ? "" : ` The ONLY animal in the image is this one ${noun}: do NOT include a dog or any other animal.`;
  const costarRefs = Array.from(new Set((opts.castRefs || []).map((r) => abs(r)).filter((r): r is string => !!r && r !== leadRef))).slice(0, MAX_COSTARS);
  const multiCast = costarRefs.length > 0; // the scene's cast in ANY scene type, not just a performance

  // For a prop scene, rebuild its locked single-subject ref so the one prop lands (a custom prop IS its
  // own photo; a catalog prop renders one locked single-subject shot) — and, for a shot of the artist
  // alone, the artist-with-prop anchor the scene is edited from.
  let srcRef: string | null = leadRef;
  let propRef: string | null = null;
  if (propKey) {
    propRef = custom ? abs(custom.img) : abs(await renderCreativeSeed(`A single real ${noun} — exactly ONE ${noun}, full body, photorealistic, plain neutral background. The only subject is this one ${noun}. ${REALISM}`, "9:16"));
    if (!multiCast) {
      const a = await editSubjectIntoScene(artistRef, `Keep this EXACT person identical. Place them together with exactly ONE ${propPhrase} — a SINGLE ${noun}, only one.${animalG} Full body, neutral studio backdrop. ${REALISM}`);
      srcRef = a ? (abs(a) || artistRef) : artistRef;
    }
  }
  const animalNote = custom || !propKey ? "" : ` The ONLY animal in frame is this one ${noun}; do NOT add a dog or any other animal.`;
  const propClause = propKey ? ` Keep the SAME single ${noun} from the reference in the shot — exactly one ${noun}, no duplicates.${animalNote}` : "";
  const performNote = shot.role === "perform" ? ` The artist ${g.perform}, with a natural, genuine expression — NOT angry, snarling or aggressive.` : "";
  // The same three ways a scene still is made in buildMusicVideoSeeds — and the same prompts (mv-cast.ts).
  let img: string | null;
  let faults: number | null = null;
  if (multiCast) {
    const r = await castStill({ genre: g.label, shot, visual: opts.sceneVisual, leadRef, otherRefs: costarRefs, asp, abs, tag: `scene ${opts.sceneIndex + 1} (again)`,
      prop: propKey ? { noun, phrase: propPhrase, ref: propRef, animal: !custom } : undefined });
    img = r.img; faults = r.faults;
  } else if (asp !== "9:16") {
    img = await renderStyledSeedMulti(soloStillPrompt({ genre: g.label, role: shot.role, frame: shot.frame, visual: opts.sceneVisual, micOk, extra: propClause }), [srcRef || leadRef], asp, undefined, CAST_PROMPT_MAX);
  } else {
    img = srcRef ? await editSubjectIntoScene(srcRef, soloEditPrompt({ role: shot.role, frame: shot.frame, visual: opts.sceneVisual, micOk, extra: `${propClause}${performNote}` }), SOLO_EDIT_MAX) : null;
  }
  if (propKey && propRef && !multiCast) {
    const cur = img ? abs(img) : null;
    if (!cur || !(await sceneShowsProp(cur, noun))) {
      const forced = await renderStyledSeedMulti(`The artist (the person in the 1st reference image) with exactly ONE ${noun} beside them (the ${noun} in the 2nd reference image) — a single ${noun}, no duplicates.${animalNote} ${ONE_PERSON} Composed as ${shot.frame}, in this setting: ${opts.sceneVisual}`, [artistRef, propRef], asp, undefined, CAST_PROMPT_MAX);
      if (forced) img = forced;
    }
  }
  return { img: img ? abs(img) : null, faults };
}

/** A song (or a take of one) as mono samples at `sr` Hz — the first `seconds` of it. Null if it cannot
 *  be read. */
async function monoSamples(file: string, sr: number, seconds: number): Promise<Float32Array | null> {
  const raw = path.join(RENDERS(), `lag-${Date.now()}-${rid()}.f32`);
  try {
    const r = await runFfmpeg(["-y", "-t", String(seconds), "-i", file, "-ac", "1", "-ar", String(sr), "-f", "f32le", raw]);
    if (r.status !== 0 || !fs.existsSync(raw)) return null;
    const buf = fs.readFileSync(raw);
    const pcm = new Float32Array(buf.byteLength >> 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = buf.readFloatLE(i * 4);
    return pcm;
  } catch { return null; } finally { try { fs.unlinkSync(raw); } catch { /* nothing to clean */ } }
}

/** Line a re-voiced take up with the song it was made from. The re-voice hands back the same song, but
 *  re-encoded, and an encoder may add a few hundredths of a second at the front — enough to hear as a
 *  flutter in the music while two takes are faded across each other. Measured (mv-feature.ts bestLag) and
 *  taken out; anything that goes wrong leaves the take as it was. */
async function alignTake(songPath: string, takePath: string): Promise<string> {
  try {
    const SR = 2000;
    const [a, b] = await Promise.all([monoSamples(songPath, SR, 20), monoSamples(takePath, SR, 20)]);
    if (!a || !b) return takePath;
    const lag = bestLag(a, b, SR, 0.25);
    if (Math.abs(lag) < 0.004) return takePath;
    const out = path.join(RENDERS(), `vcovera-${Date.now()}-${rid()}.mp3`);
    // the take runs LATE → drop its first `lag` seconds; EARLY → put that much silence in front
    const r = lag > 0
      ? await runFfmpeg(["-y", "-ss", lag.toFixed(3), "-i", takePath, "-c:a", "libmp3lame", "-q:a", "2", out])
      : await runFfmpeg(["-y", "-i", takePath, "-af", `adelay=${Math.round(-lag * 1000)}:all=1`, "-c:a", "libmp3lame", "-q:a", "2", out]);
    if (r.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 2_000) {
      console.log(`[musicvideo] featured take lined up with the song (it ran ${Math.round(Math.abs(lag) * 1000)} ms ${lag > 0 ? "late" : "early"})`);
      return out;
    }
  } catch { /* keep the take as it came */ }
  return takePath;
}

/** THE FEATURED VERSE, as sound (mv-feature.ts has the rules): find the breaths in the song, decide
 *  when each co-star's voice is heard, make each one's take of the whole song (their voice model, then
 *  the re-voice — an octave up or down when they are not the lead's sex), and cross-fade the takes into
 *  one track of exactly the song's length. Null when no co-star has a stretch to sing; throws when the
 *  takes could not be made (the caller keeps the song as it was). */
async function mixFeaturedVoices(o: {
  songPath: string; base: string; singers: number[]; roles: Array<"perform" | "broll">; D: number;
  /** `pitch` = how the VOCAL moves for this singer (an octave, or not); `speechPitch` = the speaking
   *  signature their voice is cast at, which their voice model is learned at */
  featured: Array<{ who: number; name: string; voiceId: string; pitch: "no-change" | "male-to-female" | "female-to-male"; speechPitch?: number }>;
}): Promise<{ path: string; names: string[]; windows: VoiceWindow[] } | null> {
  const total = o.singers.length * o.D;
  const songUrl = await hostRender(o.base, o.songPath);
  // 1) the breaths — so one voice hands over to the other between words. Not finding any is no failure:
  //    the voice then changes exactly where the scenes do.
  let gaps: Gap[] = [];
  try { gaps = vocalGaps(wordsFromWhisperx(await repPoll(await createWhisperx(songUrl, null), 4 * 60_000, "feature-words"))); }
  catch (e) { console.error(`[musicvideo] could not hear the words for the featured verse — the voice changes on the scene: ${e instanceof Error ? e.message.slice(0, 120) : e}`); }
  const windows = voiceWindows({ singers: o.singers, roles: o.roles, D: o.D, gaps });
  const singing = o.featured.filter((f) => windows.some((w) => w.who === f.who));
  if (!singing.length) return null;
  // 2) each co-star's take of the whole song, side by side (a voice is learned once, then kept)
  const takes = (await Promise.all(singing.map(async (f) => {
    try {
      const model = await ensureVoiceModel(f.voiceId, o.base, { pitch: f.speechPitch });
      const covered = await coverSongInVoice(songUrl, model.url, { pitchChange: f.pitch });
      const level = await matchLoudness(covered, o.songPath);
      return { ...f, file: await alignTake(o.songPath, level), trained: model.trained };
    } catch (e) {
      console.error(`[musicvideo] ${f.name}'s take of the song could not be made: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
      return null;
    }
  }))).filter((t): t is NonNullable<typeof t> => !!t);
  if (!takes.length) throw new Error("[musicvideo] no featured take could be made");
  // 3) one track: the co-stars' takes during their stretches, the lead's everywhere else
  const out = path.join(RENDERS(), `mvfeat-${Date.now()}-${rid()}.mp3`);
  const args: string[] = ["-y", "-i", o.songPath];
  takes.forEach((t) => args.push("-i", t.file));
  const filter = featureMixFilter(takes.map((t) => windows.filter((w) => w.who === t.who)), total);
  const r = await runFfmpeg([...args, "-filter_complex", filter, "-map", "[a]", "-t", total.toFixed(2), "-c:a", "libmp3lame", "-q:a", "2", out]);
  if (r.status !== 0 || !fs.existsSync(out) || Math.abs(ffprobeDuration(out) - total) > 0.6) throw new Error(`[musicvideo] the featured mix failed: ${(r.stderr || "").slice(-200)}`);
  return { path: out, names: takes.map((t) => t.name), windows: windows.filter((w) => takes.some((t) => t.who === w.who)) };
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
  /** Per-scene cast (owner edit): scene index → the cast IMAGES to feature in that scene. */
  castForScene?: Record<number, string[]>;
  /** Wardrobe (owner edit): cast member IMG → an outfit description, applied when they're styled. */
  outfits?: Record<string, string>;
  /** The picked avatar's name + co-star names — the writer uses THESE, not invented "AI slop" names. */
  artistName?: string;
  castNames?: string[];
  /** The lead's gender (drives the SUNG voice) + known co-star genders (drive casting). */
  artistGender?: "m" | "f";
  castGenders?: Array<{ name: string; gender: "m" | "f" }>;
  /** Avatar-voice singing (opt-in beta): re-timbre the song to the picked avatar's OWN voice via seed-vc.
   *  `artistVoiceId` is that avatar's MiniMax voice id (custom avatars only). Guarded — falls back to the
   *  normal sung voice on any failure. */
  singVoice?: boolean;
  artistVoiceId?: string;
  /** A FEATURED VERSE: the voice of each co-star who sings one (by name — the scenes they sing are
   *  marked in the treatment, `scene.singer`). Their gender decides whether the vocal moves an octave.
   *  A featured co-star with no voice here is not heard: the artist sings their scenes. */
  featureVoices?: Array<{ name: string; voiceId: string; /** the speaking pitch the voice is cast at */ pitch?: number; gender?: "m" | "f" }>;
  /** Output shape — "9:16" (default), "16:9" or "1:1". */
  aspect?: string;
  /** How fast the video is CUT — "slow" | "medium" | "fast". Unset = the genre's own pace (rap is cut
   *  fast, country slow). It changes the edit, not what is generated: see mv-pace.ts. */
  pace?: string;
  /** How long each scene is — 5 or 10 seconds. The length is picked in seconds and the pace decides this
   *  (a slow video is ten-second scenes, a medium or fast one five — mv-pace.ts). Unset = 10, which is
   *  what every video queued before 2026-11-21 was made of. */
  sceneSeconds?: number;
  /** Owner PREVIEWED + approved these exact per-scene stills — render them, don't re-seed (no surprise).
   *  Index-aligned with scenes; a null entry means that scene fell back and should seed fresh. */
  approvedSceneImgs?: (string | null)[];
  /** LYRICS ON SCREEN — "bold" (big words in time) | "subtitles" (each line along the bottom) | "off". */
  captions?: "off" | "bold" | "subtitles";
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
  // Output dimensions follow the CHOSEN shape — this is what the final mux crops/scales every clip to.
  // It was hardcoded 720×1280, so a 16:9 pick still rendered a 9:16 video (the wide scene got cropped).
  const vidAspect = (opts.aspect === "16:9" || opts.aspect === "1:1") ? opts.aspect : "9:16";
  const [W, H] = vidAspect === "16:9" ? [1280, 720] : vidAspect === "1:1" ? [1080, 1080] : [720, 1280];
  // Every scene is ONE clip from the video model, which makes clips of 5 or 10 seconds. The video is
  // N × D seconds exactly (two minutes at most), and the song is fit to that.
  const D = sceneSecondsOf(opts.sceneSeconds);
  const N = Math.max(tmpl.minScenes, Math.min(tmpl.maxScenes, Math.floor(MV_MAX_SECONDS / D), opts.sceneCount ?? tmpl.defaultScenes));
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
  else treatment = await previewFilmTreatment({ shopId: opts.shopId, template: "musicvideo", topic: opts.topic, sceneCount: N, sceneSeconds: D, genre, artistName: opts.artistName, castNames: opts.castNames, artistGender: opts.artistGender, castGenders: opts.castGenders });
  treatment.scenes = treatment.scenes.slice(0, N);
  await ckpt({ ckTreatment: JSON.stringify(treatment) });
  const scenes = treatment.scenes;
  // THE CAST beside the artist (two at most), and WHO SINGS each scene: the artist (-1) unless the scene
  // is part of a co-star's featured verse (mv-feature.ts).
  const extras = (opts.castExtra || []).filter((m) => m && m.img).slice(0, MAX_COSTARS);
  const extraNames = extras.map((m) => (m.name || "").trim());
  const singers = scenes.map((s) => singerOf(s, extraNames));
  // Prop PLACEMENT (placeProps): props land only on shots where one fits, round-robin among the picks,
  // one a scene at most — a recurring motif, not a herd.
  const propForScene = placeProps(scenes, propList, D, extraNames);
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
    // Lead the style with the singer's gender so the VOICE matches the avatar (tester: a female
    // character was singing in a male voice). Empty when unknown → minimax picks as before.
    const voiceSex = opts.artistGender === "f" ? "female vocals, a woman singing lead. " : opts.artistGender === "m" ? "male vocals, a man singing lead. " : "";
    // 1:00 and longer → the full-length song engine: one real track sized to the video, sent as a tagged
    // sheet, instead of a one-minute song repeated to fill the time.
    const fullLength = N * D >= 60;
    songPath = await singToDisk(fullLength ? fullSongSheet(scenes) : lyrics, `${voiceSex}${g.song}. ${treatment.musicMood || ""}`.slice(0, 300), { fullLength, minSeconds: N * D });
    await ckpt({ ckSong: songPath });
  }
  // EXACT LENGTH — the finished video must be the length the merchant PICKED (and was billed for), not
  // whatever minimax happened to sing (the "set 20s, got 40s" bug). Every scene is one Kling clip of D
  // seconds (it only makes 5 or 10), so the target is N×D; fit the song to exactly that grid (trim-long /
  // loop-short), cached so a resume doesn't re-fit. BYO songs are fit too, so an uploaded track also
  // honours the picked length.
  const targetLen = N * D;
  if (resume.ckSongFit && fs.existsSync(resume.ckSongFit)) songPath = resume.ckSongFit;
  else { songPath = await fitSongToLength(songPath, targetLen); await ckpt({ ckSongFit: songPath }); }
  // AVATAR VOICE (opt-in beta) — make the avatar actually SING in their OWN voice: keep the song, re-voice
  // its lead vocal with an RVC model trained on the avatar's voice (trained once per voice, then reused —
  // see singing-voice.server.ts). Runs on the already length-fit song, so it converts only what's used.
  // Fully guarded — any hiccup keeps the normal sung track, so a render never fails over this. Cached so a
  // resume doesn't redo it.
  let voiceMatched = false;
  if (opts.singVoice && opts.artistVoiceId) {
    if (resume.ckSongVoice && fs.existsSync(resume.ckSongVoice)) { songPath = resume.ckSongVoice; voiceMatched = true; }
    else {
      try {
        const t0 = Date.now();
        const model = await ensureVoiceModel(opts.artistVoiceId, base);
        const covered = await coverSongInVoice(await hostRender(base, songPath), model.url);
        songPath = await matchLoudness(covered, songPath);
        voiceMatched = true;
        await ckpt({ ckSongVoice: songPath });
        console.log(`[musicvideo] avatar voice applied in ${Math.round((Date.now() - t0) / 1000)}s (${model.trained ? "trained a new voice model" : "reused the saved voice model"})`);
      } catch (e) {
        console.error(`[musicvideo] avatar-voice conversion failed, keeping the normal sung voice: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
      }
    }
  }
  // A FEATURED VERSE (mv-feature.ts) — a co-star sings part of the song in THEIR voice, "like real
  // music". The song stays one track; a second take of it is re-voiced as the co-star, and the two are
  // cross-faded so the co-star's take is heard for their verse. Runs on the finished lead track (fit to
  // length, the artist's own voice already on it if that was asked for), so both takes are the same song
  // to the sample. Guarded like the artist's voice above: if it cannot be made the song keeps one singer
  // and the video still renders. Cached, so a resume does not train or convert again.
  const roles = scenes.map((s, i) => shotFor(s, i, scenes.length, D).role);
  const featuredWho = featuredIn(singers);
  let featuredNames: string[] = [];
  if (featuredWho.length) {
    if (resume.ckSongFeat && fs.existsSync(resume.ckSongFeat)) { songPath = resume.ckSongFeat; featuredNames = (resume.ckFeatNames || "").split("|").filter(Boolean); }
    else {
      const voiceFor = (name: string) => (opts.featureVoices || []).find((v) => v && v.voiceId && singerOf({ singer: v.name }, [name]) === 0);
      const genderFor = (name: string): "m" | "f" | undefined => voiceFor(name)?.gender || (opts.castGenders || []).find((c) => c && singerOf({ singer: c.name }, [name]) === 0)?.gender;
      const cast = featuredWho.map((who) => ({ who, name: extraNames[who], voiceId: voiceFor(extraNames[who])?.voiceId || "", speechPitch: voiceFor(extraNames[who])?.pitch || 0, pitch: pitchChangeFor(opts.artistGender, genderFor(extraNames[who])) })).filter((f) => f.voiceId);
      if (!cast.length) console.error(`[musicvideo] a featured verse was written for ${featuredWho.map((w) => extraNames[w]).join(", ")} but no voice came with them — the artist sings it`);
      for (let attempt = 0; attempt < 2 && cast.length && !featuredNames.length; attempt++) {
        try {
          const t0 = Date.now();
          const mixed = await mixFeaturedVoices({ songPath, base, singers, roles, D, featured: cast });
          if (!mixed) break; // nothing of theirs to hear (their scenes were removed)
          songPath = mixed.path;
          featuredNames = mixed.names;
          await ckpt({ ckSongFeat: songPath, ckFeatNames: mixed.names.join("|") });
          console.log(`[musicvideo] featured verse: ${mixed.names.join(", ")} sing${mixed.names.length === 1 ? "s" : ""} ${mixed.windows.map((w) => `${w.start.toFixed(1)}–${w.end.toFixed(1)}s`).join(", ")} (made in ${Math.round((Date.now() - t0) / 1000)}s)`);
        } catch (e) {
          console.error(`[musicvideo] featured verse could not be made${attempt ? " — the artist sings the whole song" : ", trying once more"}: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
        }
      }
    }
  }
  const songDur = ffprobeDuration(songPath);
  if (!(songDur > 3)) throw new Error("[musicvideo] song came back too short");

  // 3+4) SCENE SEEDS — the storyboard stills. If the owner PREVIEWED + approved them, render those
  //      EXACT stills (what you saw IS what renders — no surprise); otherwise build them now via the
  //      SHARED seed path the preview uses (hero + prop anchors + vision-gated per-scene edits).
  const sceneImgs = opts.approvedSceneImgs && opts.approvedSceneImgs.length === N
    ? opts.approvedSceneImgs.map((u) => abs(u))
    : (await buildMusicVideoSeeds({ genre, props: opts.props, customProps: opts.customProps, scenes, propForScene, artistBible, heroUrl: opts.heroUrl, castExtra: opts.castExtra, castForScene: opts.castForScene, outfits: opts.outfits, aspect: opts.aspect, sceneSeconds: D, jobId, resume, base })).sceneImgs;

  // WHO is in each scene's picture beside whoever leads it (mv-cast.ts sceneCast — the same answer the
  // storyboard was drawn from): the video model is told how many people there are and that only the one
  // at the front sings.
  const extraUrls = extras.map((m) => abs(m.img));
  const heroAbs = abs(opts.heroUrl);
  const whoOfImg = (img: string): number | null => {
    const a = abs(img);
    if (!a) return null;
    if (heroAbs && a === heroAbs) return -1;
    const k = extraUrls.indexOf(a);
    return k >= 0 ? k : null;
  };
  const besideIn = (i: number): number => {
    if (!extras.length) return 0;
    const shot = shotFor(scenes[i], i, scenes.length, D);
    const picked = opts.castForScene ? opts.castForScene[i] : undefined;
    return sceneCast({ scene: scenes[i], role: shot.role, slot: shot.slot, names: extraNames, listed: picked ? picked.map(whoOfImg).filter((w): w is number => w != null) : undefined }).others.length;
  };

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
    const shot = shotFor(_s, i, scenes.length, D);
    if (!imgAbs) return null;
    const imgLocal = path.join(RENDERS(), path.basename(imgAbs));
    const pKey = propForScene[i];
    // Reference the prop already baked into the seed image — never "add a tiger" (which spawns new
    // ones); just hold the single one in frame and forbid duplicates as the clip animates.
    const keepProp = pKey ? ` The single ${propNoun(pKey)} already in the shot stays in frame — exactly one; do NOT add or duplicate any ${propNoun(pKey)}, a dog, or any other animal.` : "";
    // The PEOPLE in the picture. Alone, the artist is told to stay one person (wide shots grew a twin).
    // With co-stars in the still, the model is told how many there are, that they all stay, and that only
    // the artist sings — it used to be told "exactly ONE artist … a single person" over a picture of three.
    const k = besideIn(i);
    const who = k ? castMotionLine(k, shot.role === "perform") : ` ${ONE_PERSON}`;
    const framing = k ? shot.short : shot.frame;
    const same = k ? "Keep the SAME people identical" : "Keep the SAME person identical";
    const closeupSteady = !k && /close-?up/i.test(shot.frame) ? " This is a TIGHT CLOSE-UP on the face: keep the head and camera almost perfectly still — only subtle, natural micro-motion — so the mouth stays crisp and the lip-sync reads cleanly; NO fast head turns or large moves." : "";
    // MICROPHONES: the still decides (a mic is in it only where one belongs — mv-cast.ts micFits); the
    // video model must neither hand the singer one nor take theirs away. (It used to be told flatly
    // "there is NO microphone", which fought a stage scene whose still showed one.)
    const motionPrompt = shot.role === "perform"
      ? `A premium ${g.label} music video. ${framing}. The camera does ${shot.cam}. The artist ${g.perform}. Keep the movement NATURAL and VARIED — do NOT repeat the same gesture over and over, no exaggerated or aggressive motions, and no angry or snarling faces. Keep the artist's head mostly steady and facing camera so the singing reads clearly and the lips stay in sync with the vocals.${closeupSteady}${keepProp}${MIC_MOTION_LINE} ${same}; photoreal, cinematic, high-production.${who}`
      : `A premium ${g.label} music video — cinematic B-ROLL. ${framing}. The camera does ${shot.cam}; the scene is alive with natural, flowing motion (no repeated or jittery movement).${keepProp}${NO_NEW_MIC_LINE} ${same}; photoreal, cinematic, high-production.${who}`;
    for (const i2vModel of [I2V_MODEL, I2V_FALLBACK, I2V_MODEL, I2V_FALLBACK]) { // TWO passes — a transient i2v/mux blip shouldn't drop a whole scene to a static still (owner: "first cutscene is a still not video")
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
        await new Promise((r) => setTimeout(r, 2000)); // brief backoff before the next attempt
      }
    }
    // Fallback: still image held over the segment audio (keeps the song continuous).
    try {
      if (fs.existsSync(imgLocal)) return await stillClip(imgLocal, seg.localPath, D, W, H);
    } catch (e) { console.error(`[musicvideo] scene ${i + 1} still fallback failed: ${e instanceof Error ? e.message.slice(0, 120) : e}`); }
    return null;
  });
  const good = clips.filter((c): c is string => !!c);
  // PACE — cut what was rendered to the genre's pace (or the maker's pick). Roles are read off the scenes
  // that actually made it, in order, so the list always describes the clips being joined.
  const pace: Pace = paceFor(genre, opts.pace);
  const keptRoles = clips.map((c, i) => (c ? shotFor(scenes[i], i, scenes.length, D).role : null)).filter((r): r is "perform" | "broll" => !!r);
  // only when nothing was dropped: with a scene missing, later performance clips no longer sit at their
  // own place in the song, and an edit built on "its own place" would be built on sand
  // …and a paced edit cuts ON the song's beat (slow keeps every clip whole, so there is nothing to move)
  const onBeat = good.length === scenes.length && pace !== "slow" ? await songBeats(songPath) : [];
  const cuts = good.length === scenes.length ? editPlan(keptRoles, D, pace, onBeat) : undefined;
  if (!good.length) {
    const nullImgs = sceneImgs.filter((x) => !x).length;
    throw new Error(`[musicvideo] every scene failed to render (nullSceneImgs=${nullImgs}/${N}, approved=${opts.approvedSceneImgs ? "yes" : "no"}, fal=${falEnabled() ? "on" : "off"})`);
  }

  // 7) ASSEMBLE — hard-cut concat keeping audio → the full song under the performance.
  const outName = `mv-${Date.now()}-${rid()}.mp4`;
  const outPath = path.join(RENDERS(), outName);
  await assembleMusicVideo(good, songPath, D, outPath, W, H, cuts);
  // 7a) LYRICS ON SCREEN (the maker's choice): the lyric lines, timed to the singing as it was actually
  //     sung — the song engine decides when each line comes, so the scenes can't say. Never costs the video.
  let captions: string = "off";
  if (opts.captions && opts.captions !== "off") {
    const { captionLyrics } = await import("./film-captions.server");
    const { lyricLinesOf } = await import("./lyric-sync");
    captions = await captionLyrics({ filmPath: outPath, lyricLines: opts.songUrl ? [] : lyricLinesOf(scenes), style: opts.captions, jobId });
  }
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
        genre, genreLabel: g.label, scenes: good.length, lipSynced: good.length, aspect: (opts.aspect === "16:9" || opts.aspect === "1:1") ? opts.aspect : "9:16",
        targetSeconds: targetLen, sceneSeconds: D, songSeconds: Math.round(songDur), seconds: Math.round(finalDur), voiceMatched, engine: "kling2.5+synclipsync",
        pace, cuts: cuts ? Math.max(0, cuts.length - 1) : Math.max(0, good.length - 1), cutOnBeat: onBeat.length > 2,
        captions,
        // who sang a verse of their own, in their own voice (empty = one singer, as before)
        ...(featuredNames.length ? { featured: featuredNames } : {}),
      }),
    },
  });
  return asset.id;
}
