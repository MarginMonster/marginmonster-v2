/* A finished film, levelled to the loudness the rest of the catalogue plays at.
 *
 * Measured once (ffmpeg loudnorm, measurement only), then moved by ONE gain for the whole film with a
 * limiter as a safety net for the peaks — the picture is not touched. It can never cost a film: any
 * failure leaves the file exactly as it was. The plain logic (reading the report, choosing the gain) is
 * in narrated-core.ts, where it is tested. */

import fs from "node:fs";
import { ffprobeDuration, runFfmpeg } from "./ugc-ad-pipeline.server";
import { levelGain, parseLoudness } from "./narrated-core";

export async function levelFilm(filmPath: string, target = -16): Promise<{ from: number; gain: number } | null> {
  if (!fs.existsSync(filmPath)) return null;
  const tmp = filmPath.replace(/\.mp4$/, "") + ".lvl.mp4";
  try {
    const probe = await runFfmpeg(["-i", filmPath, "-vn", "-af", `loudnorm=I=${target}:TP=-1.5:LRA=11:print_format=json`, "-f", "null", "-"]);
    const m = parseLoudness(probe.stderr);
    if (!m) return null;
    const gain = levelGain(m, target);
    if (!gain) return { from: m.i, gain: 0 };
    const total = ffprobeDuration(filmPath);
    // one gain for the whole film; the limiter only ever touches a peak the gain pushed over the top
    const run = await runFfmpeg(["-y", "-i", filmPath, "-c:v", "copy", "-af", `volume=${gain}dB,alimiter=limit=0.89:level=disabled`, "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", tmp]);
    if (run.status !== 0 || !fs.existsSync(tmp) || Math.abs(ffprobeDuration(tmp) - total) > 0.3) return null;
    fs.renameSync(tmp, filmPath);
    console.log(`[loudness] ${m.i.toFixed(1)} LUFS → ${target} (${gain > 0 ? "+" : ""}${gain} dB)`);
    return { from: m.i, gain };
  } catch (e) {
    console.error(`[loudness] left as it was: ${e instanceof Error ? e.message.slice(0, 140) : e}`);
    return null;
  } finally { try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* best effort */ } }
}
