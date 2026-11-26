/* THE FULL-FRAME CHECK ON A PICTURE ON OUR RENDERS DISK — full-frame.ts has the why, the measure and the rule.
 * Free: one small ffmpeg read (the picture at 96 × 96, grey) and, for a picture kept with a band, one crop. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { runFfmpeg } from "./ugc-ad-pipeline.server";
import { mirrorRender } from "./object-storage.server";
import { BAND_SIZE, bandCuttable, coverCrop, frameBand, pictureSize, type FrameBand } from "./full-frame";

const RENDERS = () => path.join(process.cwd(), "data", "renders");

/** The file of one of our /renders pictures (a full address or a bare path) — null when it is not on this disk. */
export function rendersFile(url: string | null | undefined): string | null {
  const name = path.basename(String(url || "").split(/[?#]/)[0]);
  if (!/^[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$/.test(name)) return null;
  const file = path.join(RENDERS(), name);
  return fs.existsSync(file) ? file : null;
}

/** A picture's band or doubled strip, measured — null when it has neither, or cannot be read (a picture that cannot be
 *  read is never called banded: the check must never cost a story its picture). */
export async function bandOf(url: string | null | undefined): Promise<FrameBand | null> {
  const file = rendersFile(url);
  if (!file) return null;
  const raw = path.join(os.tmpdir(), `band-${crypto.randomBytes(6).toString("hex")}.gray`);
  try {
    const r = await runFfmpeg(["-y", "-i", file, "-vf", `scale=${BAND_SIZE}:${BAND_SIZE}:flags=area,format=gray`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", raw]);
    const size = pictureSize(r.stderr);
    if (r.status !== 0 || !size || !fs.existsSync(raw)) return null;
    return frameBand(new Uint8Array(fs.readFileSync(raw)), size.w, size.h);
  } catch { return null; }
  finally { try { fs.unlinkSync(raw); } catch { /* nothing to clear */ } }
}

/** The picture cut to its own content and that content's middle scaled to COVER its frame (full-frame.ts → coverCrop) —
 *  a new /renders picture the same size as the old one. Null when it cannot be made (the caller keeps what it had). */
export async function coverBand(url: string | null | undefined, band: FrameBand): Promise<string | null> {
  const file = rendersFile(url);
  if (!file) return null;
  const { w: W, h: H } = band.size;
  const c = coverCrop(band, W, H);
  const name = `img-${Date.now()}-${crypto.randomBytes(9).toString("hex")}.jpg`;
  const out = path.join(RENDERS(), name);
  try {
    const r = await runFfmpeg(["-y", "-i", file, "-vf", `crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${W}:${H}:flags=lanczos,setsar=1`, "-frames:v", "1", "-q:v", "2", out]);
    if (r.status !== 0 || !fs.existsSync(out) || fs.statSync(out).size < 5_000) return null;
    try { await mirrorRender(name, fs.readFileSync(out)); } catch { /* the disk copy is what is used */ }
    return `/renders/${name}`;
  } catch { return null; }
}

/** …the two together, for a picture made where nothing draws it again (an acted film's masters and edits —
 *  film-dialogue.server.ts → removeLetterbox): covered when cutting the band off leaves a right picture (full-frame.ts →
 *  bandCuttable: most of it kept, not views on a plain ground), else left as it is. Null when nothing was done. */
export async function coveredIfBanded(url: string | null | undefined): Promise<string | null> {
  const band = await bandOf(url);
  if (!band || !bandCuttable(band)) return null;
  const covered = await coverBand(url, band);
  if (covered) console.log(`[full-frame] ${path.basename(String(url))} had ${band.sides.length ? `an empty band (${band.sides.join(", ")})` : ""}${band.sides.length && band.doubled.length ? " and " : ""}${band.doubled.length ? `a doubled strip (${band.doubled.join(", ")})` : ""} — covered from its content (${Math.round(band.keeps * 100)}% kept)`);
  return covered;
}
