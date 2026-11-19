// Make (once) and keep a finished video in another ad shape — see ad-sizes.ts for the shapes and the
// no-crop fill. Runs on this server with ffmpeg, no AI and no tokens. One at a time: the same machine
// renders films, and two 1080p encodes beside a render is how it ran out of memory before.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { AD_SIZES, sameShape, sizeGraph, type AdSize } from "./ad-sizes.ts";

const RENDERS = () => path.join(process.cwd(), "data", "renders");
const MAX_SECONDS = 5 * 60;

function ffmpegBin(): string | null {
  for (const p of ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", path.join(process.cwd(), "bin", "ffmpeg")]) {
    if (fs.existsSync(p)) return p;
  }
  const s = ffmpegPath as unknown as string;
  return s && fs.existsSync(s) ? s : null;
}

function run(bin: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; err: string }> {
  return new Promise((resolve) => {
    let err = "";
    let done = false;
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    const timer = setTimeout(() => { if (!done) { done = true; try { p.kill("SIGKILL"); } catch { /* */ } resolve({ ok: false, err: "timed out" }); } }, timeoutMs);
    p.stderr.on("data", (c) => { if (err.length < 20000) err += String(c); });
    p.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, err: e.message }); } });
    p.on("close", (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: code === 0, err }); } });
  });
}

/** Width, height and length of a video, read off ffmpeg's own description of it. */
async function probe(bin: string, file: string): Promise<{ w: number; h: number; seconds: number; audio: boolean }> {
  const r = await run(bin, ["-hide_banner", "-i", file], 30_000); // exits non-zero (no output named) — stderr is what we want
  const v = r.err.match(/Stream #[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/);
  const d = r.err.match(/Duration: (\d+):(\d+):([\d.]+)/);
  // a phone video can carry a rotation; ffmpeg turns it on decode, so the shape is the turned one
  const rot = /rotate\s*:\s*-?(90|270)\b/.test(r.err) || /rotation of -?(90|270)/.test(r.err);
  const w = v ? +v[1] : 0, h = v ? +v[2] : 0;
  return { w: rot ? h : w, h: rot ? w : h, seconds: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0, audio: /Stream #[^\n]*Audio:/.test(r.err) };
}

let lane: Promise<unknown> = Promise.resolve();

export type SizedResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * The video at `srcRel` (a /renders file) in `size`, as a /renders URL. Made once and kept beside the
 * original (name-size.mp4), so asking again is instant. A video already in that shape comes back as
 * itself. `opts` lets tests point at their own folder and ffmpeg build.
 */
export async function sizedVideo(srcRel: string, size: AdSize, opts: { dir?: string; ffmpeg?: string | null; mirror?: (name: string, buf: Buffer) => Promise<unknown> } = {}): Promise<SizedResult> {
  const m = (srcRel || "").split("?")[0].match(/^\/renders\/([A-Za-z0-9._-]+\.mp4)$/);
  if (!m) return { ok: false, error: "not-local" };
  const dir = opts.dir || RENDERS();
  const src = path.join(dir, m[1]);
  if (!fs.existsSync(src)) return { ok: false, error: "missing" };
  const bin = opts.ffmpeg === undefined ? ffmpegBin() : opts.ffmpeg;
  if (!bin) return { ok: false, error: "no-ffmpeg" };
  const { w, h } = AD_SIZES[size];
  const name = `${m[1].replace(/\.mp4$/, "")}-${size}.mp4`;
  const out = path.join(dir, name);
  if (fs.existsSync(out) && fs.statSync(out).size > 10_000) return { ok: true, url: `/renders/${name}` };

  const job = lane.then(async (): Promise<SizedResult> => {
    if (fs.existsSync(out) && fs.statSync(out).size > 10_000) return { ok: true, url: `/renders/${name}` }; // made while we waited
    const info = await probe(bin, src);
    if (!(info.w > 0 && info.h > 0)) return { ok: false, error: "unreadable" };
    if (info.seconds > MAX_SECONDS) return { ok: false, error: "too-long" };
    // already this shape AND this size: the original is the answer
    if (sameShape(info.w, info.h, w, h) && info.w === w && info.h === h) return { ok: true, url: `/renders/${m[1]}` };
    const tmp = path.join(dir, `tmp-${crypto.randomBytes(6).toString("hex")}-${name}`);
    const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", src,
      "-filter_complex", sizeGraph(info.w, info.h, w, h), "-map", "[v]", ...(info.audio ? ["-map", "0:a:0", "-c:a", "aac", "-b:a", "160k"] : []),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-threads", "2", "-movflags", "+faststart", tmp];
    const r = await run(bin, args, 4 * 60_000);
    if (!r.ok || !fs.existsSync(tmp) || fs.statSync(tmp).size < 10_000) {
      try { fs.unlinkSync(tmp); } catch { /* */ }
      console.error(`[adsize] ${m[1]} → ${size} failed: ${(r.err || "no output").slice(0, 300)}`);
      return { ok: false, error: "render" };
    }
    fs.renameSync(tmp, out); // whole file or nothing: a second request never gets half a video
    if (opts.mirror) { try { await opts.mirror(name, fs.readFileSync(out)); } catch { /* the disk copy is what serves it */ } }
    return { ok: true, url: `/renders/${name}` };
  });
  lane = job.catch(() => undefined);
  return job;
}
