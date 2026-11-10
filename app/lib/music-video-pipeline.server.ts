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
import { renderCreativeSeed, editSubjectIntoScene } from "./image-generation.server";
import { checkpointJob, download, ffprobeDuration, runFfmpeg } from "./ugc-ad-pipeline.server";
import { falVideoSubmit, falVideoPoll, falLipSync, falEnabled } from "./fal-video.server";
import { mirrorRender } from "./object-storage.server";
import { filmTemplate, previewFilmTreatment, GENRES, genreOrDefault, PROPS, type FilmTreatment } from "./film-engine.server";
import { singToDisk } from "./music-generation.server";

const RENDERS = () => path.join(process.cwd(), "data", "renders");
const rid = () => crypto.randomBytes(6).toString("hex");
// Real, PREMIUM look — cinematic high-end music video, but real photography (not CGI/AI-looking).
const REALISM = "Photorealistic and cinematic like a real high-end music video — shot on a real camera, realistic skin texture and fine detail, premium production value and colour; NOT plastic, waxy, cartoonish, CGI or obviously AI-generated. Keep it tasteful and genuinely cool — NOT cheesy, corny or over-the-top; NO fireworks, confetti, lasers, sparks, glitter or gimmicky effects.";
// MOTION engine: silent image-to-video with real body + camera movement (fixes the static-background
// complaint). Kling 2.5-turbo-pro = fast + good motion. The mouth is driven SEPARATELY by the
// dedicated sync-lipsync model afterwards — OmniHuman did both at once and was "pitiful" at the mouth.
const I2V_MODEL = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";
// Backup motion engine — if the primary blips (a transient fal outage stilled a whole render once),
// each scene retries on this before falling back to a static still, so one provider hiccup can't
// turn the video into a slideshow.
const I2V_FALLBACK = "fal-ai/kling-video/v2.6/pro/image-to-video";
const CLIP_MAX = 10; // the i2v clip length cap (Kling 2.x); segments are sliced to match so the song stays continuous
// DIRECTOR'S SHOT LIST — a real music video is EDITED: performance shots intercut with b-roll,
// establishing wides, close-ups and cutaways (never the artist lip-syncing end-to-end). Each scene
// takes the next shot; `perform` shots get lip-synced, `broll` shots just ride the song over motion.
// This reads premium AND hides the lip-sync (only tight performance shots carry a mouth).
const SHOTLIST: Array<{ role: "perform" | "broll"; frame: string; cam: string }> = [
  { role: "broll",   frame: "a cinematic WIDE ESTABLISHING shot of the whole location that sets the mood — the artist is small in the frame or walking through it, NOT facing camera", cam: "a slow cinematic push-in" },
  { role: "perform", frame: "a MEDIUM shot of the artist performing straight to camera, framed from the waist up", cam: "a smooth handheld sway" },
  { role: "perform", frame: "a tight, intense CLOSE-UP on the artist's face performing to camera, shallow depth of field", cam: "a slow subtle drift-in" },
  { role: "broll",   frame: "a dynamic B-ROLL cutaway of the scenery, street or striking details of the location in motion — the artist is seen from behind or the side, NOT facing camera", cam: "a sweeping camera pan across the scene" },
  { role: "perform", frame: "a cool, composed WIDE shot of the artist performing to camera, full body, confident and stylish", cam: "a slow orbit around the artist" },
  { role: "broll",   frame: "an atmospheric B-ROLL shot of the location from a fresh cinematic angle, moody and premium — the artist a small part of the frame, NOT facing camera", cam: "a slow tracking move" },
];

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

/** Assemble the clips into the finished music video. PREFERRED: a short CROSS-DISSOLVE on the
 *  video + an AUDIO crossfade at every seam — smooth transitions, not a rocky hard cut, and no
 *  audio pop (the owner's "transitions are rocky + audio rocky" fix). Each clip keeps its OWN
 *  synced segment audio, and the video + audio shrink together by the overlap, so the lip-sync
 *  stays aligned. Falls back to a plain hard-cut concat, then the first clip, so it never dies. */
async function assembleMusicVideo(clips: string[], outPath: string, W: number, H: number): Promise<void> {
  const N = clips.length;
  if (!N) throw new Error("[musicvideo] no clips to assemble");

  if (N >= 2) {
    try {
      const XF = 0.3; // a clean, short cross-dissolve — smooth, not a gimmicky wipe
      const durs = clips.map((c) => { const d = ffprobeDuration(c); return d > 0.6 ? d : 2; });
      const a: string[] = ["-y"];
      clips.forEach((c) => a.push("-i", c));
      const f: string[] = [];
      clips.forEach((_, i) => {
        f.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30,format=yuv420p[v${i}]`);
        f.push(`[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
      });
      let pv = "[v0]", pa = "[a0]", off = durs[0] - XF;
      for (let i = 1; i < N; i++) {
        const vo = i === N - 1 ? "[vout]" : `[vx${i}]`;
        const ao = i === N - 1 ? "[aout]" : `[ax${i}]`;
        f.push(`${pv}[v${i}]xfade=transition=fade:duration=${XF}:offset=${off.toFixed(3)}${vo}`);
        f.push(`${pa}[a${i}]acrossfade=d=${XF}${ao}`);
        pv = vo; pa = ao; off += durs[i] - XF;
      }
      a.push("-filter_complex", f.join(";"), "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outPath);
      const r = await runFfmpeg(a);
      if (r.status === 0 && fs.existsSync(outPath) && ffprobeDuration(outPath) > 1) return;
    } catch { /* fall through to the hard-cut concat */ }
  }

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
  resume?: { ckTreatment?: string; ckSong?: string; ckArtist?: string };
}): Promise<string> {
  const tmpl = filmTemplate("musicvideo");
  const genre = genreOrDefault(opts.genre);
  const g = GENRES[genre];
  // Props the merchant picked, distributed ONE per scene (round-robin) so they feel intentional.
  const propList = (opts.props || []).filter((k) => PROPS[k]);
  const propFor = (i: number): string => (propList.length ? ` Prominently feature ${PROPS[propList[i % propList.length]].phrase} in this shot.` : "");
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

  // 3) ARTIST hero — ONE realistic portrait that locks the look (face + wardrobe) for the WHOLE
  //    video. Every scene is an EDIT of THIS exact image, so the artist can never drift.
  let artistRef = abs(resume.ckArtist);
  if (!artistRef) {
    const ref = await renderCreativeSeed(`A realistic ${g.label} music-video shot of the artist performing/rapping to camera: ${artistBible}. ${g.look}. Clear sharp face, full performance energy. ${REALISM}`, "9:16");
    if (ref) { await ckpt({ ckArtist: ref }); artistRef = abs(ref); }
  }

  // 4) PER-SCENE images — EDIT the one hero into each NEW setting (nano-banana-pro @2K). Editing
  //    the same source preserves the face (the "it changes the singer" fix) and pro @2K reads as
  //    real photography (the "AI as fuck" fix). Falls back to the hero itself if an edit fails.
  const sceneImgs = await mapLimit(scenes, 3, async (s, i) => {
    const shot = SHOTLIST[i % SHOTLIST.length];
    const prompt = `Keep this EXACT person identical — same face, hair, skin, build, wardrobe and jewelry; do NOT change who they are or swap them for a different person. Compose the shot as ${shot.frame}, in this setting: ${s.visual}.${propFor(i)} ${g.look}. ${REALISM}`;
    const img = artistRef
      ? await editSubjectIntoScene(artistRef, prompt)
      : await renderCreativeSeed(`${shot.frame}. ${s.visual}. ${g.look}. ${REALISM}`, "9:16");
    return img ? abs(img) : artistRef; // same artist (the hero) if an edit fails
  });

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
    const shot = SHOTLIST[i % SHOTLIST.length];
    if (!imgAbs) return null;
    const imgLocal = path.join(RENDERS(), path.basename(imgAbs));
    const motionPrompt = shot.role === "perform"
      ? `A premium ${g.label} music video. ${shot.frame}. The camera does ${shot.cam}. The artist performs/raps with high energy — head bobbing, body moving to the beat.${propFor(i)} There is NO microphone — the artist never holds a mic. Keep the SAME person identical; photoreal, cinematic, high-production.`
      : `A premium ${g.label} music video — cinematic B-ROLL. ${shot.frame}. The camera does ${shot.cam}; the scene is alive with natural motion.${propFor(i)} Keep the SAME person identical; photoreal, cinematic, high-production.`;
    for (const i2vModel of [I2V_MODEL, I2V_FALLBACK]) {
      try {
        // silent motion clip — primary engine, then the backup if it blips (so a provider outage
        // can't still a whole scene the way it once stilled an entire render)
        const reqId = await falVideoSubmit(i2vModel, { startImage: imgAbs, prompt: motionPrompt, durationSec: D, generateAudio: false });
        const motionUrl = await falVideoPoll(i2vModel, reqId, 12 * 60_000);
        const out = path.join(RENDERS(), `mv-${Date.now()}-${i}-${rid()}.mp4`);
        if (shot.role === "perform") {
          // PERFORMANCE: dedicated lip-sync drives the mouth to this song segment
          let finalUrl = motionUrl;
          try { finalUrl = await falLipSync(motionUrl, seg.url); }
          catch (e) { console.error(`[musicvideo] scene ${i + 1} lipsync failed, motion-only: ${e instanceof Error ? e.message.slice(0, 120) : e}`); }
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
  if (!good.length) throw new Error("[musicvideo] every scene failed to render");

  // 7) ASSEMBLE — hard-cut concat keeping audio → the full song under the performance.
  const outName = `mv-${Date.now()}-${rid()}.mp4`;
  const outPath = path.join(RENDERS(), outName);
  await assembleMusicVideo(good, outPath, W, H);
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
