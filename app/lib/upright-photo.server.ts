// Stand an uploaded photo upright before anything else sees it. See exif-orientation.ts for why: a phone
// stores a portrait photo sideways plus a "rotate me" tag; browsers obey the tag, image models do not, so
// edits of phone photos came back lying on their side. Every user photo upload passes through here once,
// at save time, so the pixels on disk are already the right way up and carry no tag (a tag left on the
// turned pixels would make browsers turn them a second time).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { ffmpegArgsFor } from "./ffmpeg-threads.ts";
import ffmpegPath from "ffmpeg-static";
import { jpegOrientation, orientationFilter } from "./exif-orientation.ts";

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
    // capped like every ffmpeg run (ffmpeg-threads.ts: one decoding thread an input, two for the encoder; ffprobe untouched)
    const p = spawn(bin, ffmpegArgsFor(bin, args), { stdio: ["ignore", "ignore", "pipe"] });
    const timer = setTimeout(() => { if (!done) { done = true; try { p.kill("SIGKILL"); } catch { /* */ } resolve({ ok: false, err: "timed out" }); } }, timeoutMs);
    p.stderr.on("data", (c) => { if (err.length < 4000) err += String(c); });
    p.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, err: e.message }); } });
    p.on("close", (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: code === 0, err }); } });
  });
}

/**
 * The photo with its pixels turned the way its EXIF orientation says, and no orientation tag left on it.
 * A photo that is already upright (or is not a JPEG) comes back untouched, byte for byte. If ffmpeg is
 * missing or fails, the original comes back and the failure is logged — an upload is never refused over
 * this; the worst case is the old behaviour (a sideways edit), and the log says so.
 */
export async function uprightPhoto(buf: Buffer, ffmpeg?: string | null): Promise<Buffer> {
  const o = jpegOrientation(buf);
  const vf = orientationFilter(o);
  if (!vf) return buf;
  const bin = ffmpeg === undefined ? ffmpegBin() : ffmpeg; // tests pass each ffmpeg build explicitly
  if (!bin) { console.error(`[upright] no ffmpeg — photo kept sideways (EXIF orientation ${o})`); return buf; }
  const base = path.join(os.tmpdir(), `upright-${crypto.randomBytes(6).toString("hex")}`);
  const inF = `${base}-in.jpg`;
  const outF = `${base}-out.jpg`;
  try {
    fs.writeFileSync(inF, buf);
    // -noautorotate: newer ffmpeg builds read the EXIF tag themselves; without this they would turn the
    // photo AND we would turn it again. -map_metadata -1: the turned photo must not carry the tag.
    const r = await run(bin, ["-hide_banner", "-loglevel", "error", "-y", "-noautorotate", "-i", inF,
      "-vf", vf, "-map_metadata", "-1", "-frames:v", "1", "-q:v", "2", outF], 60_000);
    const out = r.ok && fs.existsSync(outF) ? fs.readFileSync(outF) : null;
    if (!out || out.length < 200 || out[0] !== 0xff || out[1] !== 0xd8) {
      console.error(`[upright] could not turn a photo with EXIF orientation ${o} — kept as uploaded: ${(r.err || "no output").slice(0, 300)}`);
      return buf;
    }
    return out;
  } catch (e) {
    console.error(`[upright] could not turn a photo with EXIF orientation ${o} — kept as uploaded: ${(e as Error).message}`);
    return buf;
  } finally {
    for (const f of [inF, outF]) { try { fs.unlinkSync(f); } catch { /* */ } }
  }
}
