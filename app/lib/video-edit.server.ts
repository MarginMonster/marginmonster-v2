/* Creator "upload a video, edit it" — the ffmpeg half.
 *
 * A merchant uploads a clip (web studio / Creator) which lands on the
 * persistent disk at data/renders/uploads/<name> and is served at
 * ${base}/uploads/<name>. editVideo takes that public URL plus one edit op
 * (trim / caption / speed), runs a single re-encode, and STORES THE RESULT THE
 * SAME WAY every finished video does — data/renders/<name>, mirrored to object
 * storage, returned as a /renders/<name> URL — so the job worker can drop it
 * straight onto Asset.videoUrl with no special-casing.
 *
 * Deliberately NOT a pipeline: no provider calls, no token spend, no vertical
 * canvas. We keep the source's own dimensions and orientation (a landscape clip
 * stays landscape) and lean entirely on the shared ffmpeg plumbing in
 * ugc-ad-pipeline.server.ts — runFfmpeg (async spawn + 10-min wedge timeout),
 * ffprobeDuration/probeVideoDims (ffprobe), resolveTextFont (the same
 * Poppins/Noto font the UGC captions use) and assertPlayableVideo (output QA).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  runFfmpeg,
  ffprobeDuration,
  probeVideoDims,
  resolveTextFont,
  assertPlayableVideo,
  download,
} from "./ugc-ad-pipeline.server";
import { mirrorRender, storageEnabled } from "./object-storage.server";

export type VideoEditOp = "trim" | "caption" | "speed";

export interface EditVideoParams {
  sourceVideoUrl: string; // uploaded source video public URL (or /uploads/<name>)
  op: VideoEditOp;
  startSec?: number; // trim start
  endSec?: number; // trim end
  captionText?: string; // caption to burn in
  speed?: number; // playback multiplier (0.5 = slower, 2 = faster)
}

const rendersDir = () => path.join(process.cwd(), "data", "renders");

/** The uploaded source's name iff the URL points at our own /uploads/<name>.
 *  Those files live on this instance's disk at data/renders/uploads/<name>, so
 *  reading them directly avoids a pointless network round-trip to ourselves
 *  (same trick api.buddy.tsx uses for attached photos). Name-allowlisted so a
 *  crafted URL can never walk out of the uploads directory. */
function localUploadName(url: string): string | null {
  const m = url.match(/\/uploads\/([A-Za-z0-9._-]+)(?:[?#]|$)/);
  if (!m) return null;
  const name = m[1];
  // no "..", no slashes (the regex already excludes slashes); defang any dot-dot
  if (name.includes("..")) return null;
  return name;
}

/** Put the source clip on local disk and hand back its path. Prefers the
 *  on-disk upload (data/renders/uploads/<name>); falls back to streaming a
 *  remote URL into the temp dir via the shared, timeout-guarded `download`
 *  helper. Throws a clear Error if neither yields readable bytes. */
async function materializeSource(url: string, tmpDir: string): Promise<string> {
  if (!url || typeof url !== "string") throw new Error("[video-edit] sourceVideoUrl is required");

  const name = localUploadName(url);
  if (name) {
    const onDisk = path.join(rendersDir(), "uploads", name);
    try {
      const st = fs.statSync(onDisk);
      if (st.isFile() && st.size > 0) return onDisk; // read in place — no copy needed
    } catch {
      /* not on this instance's disk (multi-instance, or a remote /uploads host) — fall through to fetch */
    }
  }

  if (!/^https?:\/\//i.test(url)) {
    // A /uploads path we couldn't find locally and can't fetch (no origin) is unrecoverable.
    throw new Error(`[video-edit] source not found on disk and not a fetchable URL: ${url.slice(0, 120)}`);
  }
  const ext = (path.extname(new URL(url).pathname) || ".mp4").slice(0, 5) || ".mp4";
  const dl = path.join(tmpDir, `src-${crypto.randomBytes(6).toString("hex")}${ext}`);
  await download(url, dl); // streams to disk, 10-min timeout, throws on non-2xx
  const st = fs.statSync(dl);
  if (!st.size) throw new Error("[video-edit] downloaded source is empty");
  return dl;
}

/** Store a finished edit EXACTLY like every other finished video: a unique
 *  vid-<ts>-<hex>.mp4 on the persistent disk under data/renders, mirrored to
 *  object storage when it's enabled, served via the /renders/:file route.
 *  Returns the absolute public URL (so the worker can save Asset.videoUrl) when
 *  SHOPIFY_APP_URL is set, otherwise the relative /renders/<name> path — the
 *  same shape persistRemoteVideo returns in video-generation.server.ts. */
async function storeResult(filePath: string, fileName: string): Promise<string> {
  // Mirror to durable storage so a missing local file can be rehydrated by
  // /renders/:file on another instance — best-effort, the disk copy is enough.
  if (storageEnabled()) {
    try {
      await mirrorRender(fileName, fs.readFileSync(filePath));
    } catch (e) {
      console.warn(`[video-edit] mirror failed (keeping disk copy): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  return base ? `${base}/renders/${fileName}` : `/renders/${fileName}`;
}

/** atempo only accepts 0.5–2.0 per filter, so a speed outside that range is
 *  expressed as a CHAIN (e.g. 4x → atempo=2.0,atempo=2.0; 0.25x →
 *  atempo=0.5,atempo=0.5). Video side uses setpts=PTS/<speed> directly, which
 *  has no such limit. Returns the comma-joined atempo chain. */
function atempoChain(speed: number): string {
  const factors: number[] = [];
  let remaining = speed;
  while (remaining > 2.0 + 1e-9) {
    factors.push(2.0);
    remaining /= 2.0;
  }
  while (remaining < 0.5 - 1e-9) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  factors.push(Number(remaining.toFixed(6)));
  return factors.map((f) => `atempo=${f}`).join(",");
}

/** drawtext-safe caption text. Mirrors ugc-ad-pipeline's captionSafe (which
 *  isn't exported): bold UGC caps, the straight apostrophe folded to a curly
 *  U+2019 (a straight ' closes drawtext's text='...' quote early), and
 *  everything else the filter parser chokes on stripped. Unicode-aware so
 *  accents/umlauts/CJK survive for resolveTextFont to pick the right font. */
function captionSafe(s: string): string {
  return s
    .toUpperCase()
    .replace(/[']/g, "’")
    .replace(/[^\p{L}\p{N} .,!?$’-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Shared x264 output tail: frame-accurate re-encode, 2 threads (x264 memory
 *  scales with thread count and containers report the HOST's core count —
 *  uncapped it can blow a small instance), faststart for progressive playback. */
function encodeTail(outPath: string): string[] {
  return [
    "-threads", "2",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    outPath,
  ];
}

/**
 * Edit an uploaded video with a single op and return the stored public URL.
 *
 *  - trim    — `-ss <start> -to <end>` with a frame-accurate re-encode. Validates
 *              0 <= startSec < endSec and clamps endSec to the probed duration.
 *  - caption — burns captionText near the bottom, large + readable (white fill,
 *              thick black outline), using the same bundled font as the UGC
 *              captions. Re-encode.
 *  - speed   — video setpts=PTS/<speed>, audio atempo chain. Re-encode.
 *
 *  Keeps the source's native dimensions/orientation (never forces vertical).
 *  Throws a clear Error on bad params or an unplayable result; cleans up temp
 *  files in all cases.
 */
export async function editVideo(params: EditVideoParams): Promise<string> {
  const { op } = params;
  if (op !== "trim" && op !== "caption" && op !== "speed") {
    throw new Error(`[video-edit] unknown op: ${String(op)}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vedit-"));
  // The result lands on the PERSISTENT disk (data/renders), not the temp dir —
  // only the source download + any work files are transient.
  fs.mkdirSync(rendersDir(), { recursive: true });
  const fileName = `vid-${Date.now()}-${crypto.randomBytes(9).toString("hex")}.mp4`;
  const outPath = path.join(rendersDir(), fileName);

  try {
    const srcPath = await materializeSource(params.sourceVideoUrl, tmpDir);

    let args: string[];

    if (op === "trim") {
      const start = Number(params.startSec);
      let end = Number(params.endSec);
      if (!Number.isFinite(start) || start < 0) throw new Error("[video-edit] trim needs startSec >= 0");
      if (!Number.isFinite(end) || end <= start) throw new Error("[video-edit] trim needs endSec > startSec");
      // Clamp the end to the real duration so an over-long request doesn't ask
      // ffmpeg to seek past EOF (which yields an empty/near-empty output).
      const dur = ffprobeDuration(srcPath);
      if (end > dur) end = dur;
      if (end - start < 0.1) throw new Error(`[video-edit] trim window too small after clamping to ${dur.toFixed(2)}s`);
      // -ss/-to as OUTPUT options (after -i) for frame-accurate, re-encoded cuts.
      args = ["-y", "-i", srcPath, "-ss", start.toFixed(3), "-to", end.toFixed(3), ...encodeTail(outPath)];
    } else if (op === "caption") {
      const safe = captionSafe(params.captionText || "");
      if (!safe) throw new Error("[video-edit] caption needs non-empty captionText");
      // Scale caption size to the source WIDTH (not a fixed 720 canvas) so it
      // reads on any orientation; keep every line inside ~92% of the frame.
      const dims = probeVideoDims(srcPath);
      const w = dims?.w && dims.w > 0 ? dims.w : 720;
      // Latin caps run ~0.62x fontsize wide; clamp to a sane 28–64px band.
      const size = Math.max(28, Math.min(64, Math.floor((w * 0.92) / Math.max(1, safe.length * 0.62))));
      const fontFile = await resolveTextFont(safe); // Poppins (Latin) or fetched Noto (CJK)
      // fontfile path: forward slashes + escaped colon for the filter parser.
      const font = fontFile.replace(/\\/g, "/").replace(/:/g, "\\:");
      // Thick black outline + a semi-opaque black box behind the line = readable
      // over any footage; anchored near the bottom with a small margin.
      const drawtext =
        `drawtext=fontfile='${font}':text='${safe}':fontsize=${size}:fontcolor=white:` +
        `borderw=7:bordercolor=black:box=1:boxcolor=black@0.45:boxborderw=18:` +
        `x=(w-text_w)/2:y=h-text_h-80`;
      args = ["-y", "-i", srcPath, "-vf", drawtext, ...encodeTail(outPath)];
    } else {
      // speed
      const speed = Number(params.speed);
      if (!Number.isFinite(speed) || speed <= 0) throw new Error("[video-edit] speed must be a positive multiplier");
      if (speed < 0.1 || speed > 10) throw new Error("[video-edit] speed must be between 0.1x and 10x");
      const vpts = `setpts=PTS/${speed.toFixed(6)}`;
      const atempo = atempoChain(speed);
      // -map 0:a? — a source with no audio track still re-times its video
      // instead of ffmpeg erroring on a missing stream.
      args = [
        "-y", "-i", srcPath,
        "-filter_complex", `[0:v]${vpts}[v];[0:a]${atempo}[a]`,
        "-map", "[v]", "-map", "[a]",
        ...encodeTail(outPath),
      ];
      // If the source is silent, the [0:a] filter errors; retry video-only.
      const run = await runFfmpeg(args);
      if (run.status !== 0 || !fs.existsSync(outPath)) {
        const silentArgs = ["-y", "-i", srcPath, "-filter:v", vpts, "-an", ...encodeTail(outPath)];
        const retry = await runFfmpeg(silentArgs);
        if (retry.status !== 0 || !fs.existsSync(outPath)) {
          throw new Error(`[video-edit] speed re-encode failed: ${(run.stderr || retry.stderr || "").slice(-400)}`);
        }
      }
      assertPlayableVideo(outPath); // throws on a missing/zero-duration/unprobeable result
      return await storeResult(outPath, fileName);
    }

    const run = await runFfmpeg(args);
    if (run.status !== 0 || !fs.existsSync(outPath)) {
      throw new Error(`[video-edit] ${op} re-encode failed: ${(run.stderr || "").slice(-400)}`);
    }
    assertPlayableVideo(outPath); // throws on a missing/zero-duration/unprobeable result
    return await storeResult(outPath, fileName);
  } catch (e) {
    // Don't leave a half-written output behind on failure.
    try { fs.rmSync(outPath, { force: true }); } catch { /* nothing to remove */ }
    throw e instanceof Error ? e : new Error(`[video-edit] ${String(e)}`);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}
