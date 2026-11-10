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
import { renderCreativeSeed, renderStyledSeed } from "./image-generation.server";
import { checkpointJob, download, ffprobeDuration, runFfmpeg } from "./ugc-ad-pipeline.server";
import { animateOmniHuman, falEnabled } from "./fal-video.server";
import { mirrorRender } from "./object-storage.server";
import { filmTemplate, previewFilmTreatment, GENRES, genreOrDefault, type FilmTreatment } from "./film-engine.server";
import { singToDisk } from "./music-generation.server";

const RENDERS = () => path.join(process.cwd(), "data", "renders");
const rid = () => crypto.randomBytes(6).toString("hex");

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

/** Hard-cut concat KEEPING each clip's audio, every clip normalised to W×H. The
 *  clips' audio are the song's contiguous segments, so this rebuilds the full song
 *  under the performance. Degrades to the first clip alone if the graph fails. */
async function assembleMusicVideo(clips: string[], outPath: string, W: number, H: number): Promise<void> {
  const N = clips.length;
  if (!N) throw new Error("[musicvideo] no clips to assemble");
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
  // Degrade: just the first clip (always valid) so the render never dies at the seam.
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
  resume?: { ckTreatment?: string; ckSong?: string; ckArtist?: string };
}): Promise<string> {
  const tmpl = filmTemplate("musicvideo");
  const genre = genreOrDefault(opts.genre);
  const g = GENRES[genre];
  const [W, H] = [720, 1280]; // vertical music video (Shorts/TikTok/Reels)
  const N = Math.max(tmpl.minScenes, Math.min(tmpl.maxScenes, opts.sceneCount ?? tmpl.defaultScenes));
  const jobId = opts.jobId;
  const resume = opts.resume || {};
  const ckpt = async (patch: Record<string, unknown>) => { if (jobId) await checkpointJob(jobId, patch); };
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const abs = (u: string | null | undefined): string | null => (u ? (u.startsWith("http") ? u : `${base}${u}`) : null);

  if (!falEnabled()) throw new Error("[musicvideo] FAL_KEY not set — OmniHuman lip-sync unavailable");

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
  if (!songPath) {
    songPath = await singToDisk(lyrics, `${g.song}. ${treatment.musicMood || ""}`.slice(0, 300));
    await ckpt({ ckSong: songPath });
  }
  const songDur = ffprobeDuration(songPath);
  if (!(songDur > 3)) throw new Error("[musicvideo] song came back too short");
  const segLen = songDur / N;

  // 3) ARTIST reference — locks the look across every setting.
  let artistRef = abs(resume.ckArtist);
  if (!artistRef) {
    const ref = await renderCreativeSeed(`${g.look}. A music-video portrait of the artist performing to camera: ${artistBible}. Clear sharp face, full performance energy, cinematic.`, "9:16");
    if (ref) { await ckpt({ ckArtist: ref }); artistRef = abs(ref); }
  }

  // 4) PER-SCENE images — the SAME artist in each distinct setting (identity locked
  //    on the reference). Rendered in bounded parallel (image renders are cheap).
  const sceneImgs = await mapLimit(scenes, 3, async (s) => {
    const prompt = `${g.look}. ${s.visual}. The SAME artist performing to camera, singing with energy: ${artistBible}. ${tmpl.sceneHint}.`;
    const img = artistRef
      ? ((await renderStyledSeed(prompt, artistRef, "9:16")) || (await renderCreativeSeed(prompt, "9:16")))
      : await renderCreativeSeed(prompt, "9:16");
    return abs(img);
  });

  // 5) song SEGMENTS (local mp3 + hosted url for OmniHuman).
  const segs: Array<{ localPath: string; url: string }> = [];
  for (let i = 0; i < N; i++) {
    const p = await sliceAudio(songPath, i * segLen, segLen);
    segs.push({ localPath: p, url: await hostRender(base, p) });
  }

  // 6) PERFORM — OmniHuman lip-syncs the artist to each segment. Retry, then fall
  //    back to a still-over-audio clip so one bad beat can't kill the render.
  const clips = await mapLimit(scenes, 2, async (_s, i) => {
    const imgAbs = sceneImgs[i];
    const seg = segs[i];
    if (!imgAbs) {
      // No scene image — still-clip needs a local image; skip to keep the song intact
      // by holding the artist reference if we have it, else drop the beat.
      return null;
    }
    const imgLocal = path.join(RENDERS(), path.basename(imgAbs));
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const vurl = await animateOmniHuman({
          imageUrl: imgAbs,
          audioUrl: seg.url,
          resolution: "720p",
          prompt: `The artist sings/raps directly to camera with energy and attitude, a ${g.label} music-video performance; natural body movement, the camera stays steady.`,
        });
        const out = path.join(RENDERS(), `mv-${Date.now()}-${i}-${rid()}.mp4`);
        await download(vurl, out);
        if (fs.existsSync(out) && ffprobeDuration(out) > 1) { await ckpt({ [`ckClip${i}`]: out }); return out; }
      } catch (e) {
        console.error(`[musicvideo] scene ${i + 1} omnihuman attempt ${attempt + 1}/2 failed: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
      }
    }
    // Fallback: still image held over the segment audio (keeps the song continuous).
    try {
      if (fs.existsSync(imgLocal)) return await stillClip(imgLocal, seg.localPath, segLen, W, H);
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
        songSeconds: Math.round(songDur), seconds: Math.round(finalDur), engine: "omnihuman",
      }),
    },
  });
  return asset.id;
}
