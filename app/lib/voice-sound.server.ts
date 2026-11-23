/* WHERE A VOICE TRACK IS SOUNDING — read off the track itself, for the words the listener did not hear.
 *
 * The reading and the rule are in narrated-core.ts ("where the voice is sounding"); this is only the one
 * pass of ffmpeg that measures the track: its level every 50 ms, printed into a small text file beside
 * the temp files (the print goes to a FILE because the runner keeps ffmpeg's messages, not its output).
 *
 * It never throws and never fails a render: an empty answer means "not read", and the captions are timed
 * exactly as they were before this existed. */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runFfmpeg } from "./ugc-ad-pipeline.server";
import { levelFrames, soundLevels, type Span } from "./narrated-core";

/** The ffmpeg filter that prints the level of each 50 ms of a track into `file`. The file name sits
 *  inside a filter description, where a backslash or a colon is syntax: forward slashes, the colon
 *  escaped, and the whole name in quotes. (Tried with ffmpeg on a path with a drive letter, 2026-11-23:
 *  the escaped colon alone is "Error parsing a filter description"; quoted, it is written.) */
export function levelFilter(file: string): string {
  const name = file.replace(/\\/g, "/").replace(/:/g, "\\:");
  return `aresample=16000,asetnsamples=n=800,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file='${name}'`;
}

/** Where the voice in `voPath` (the narrator ALONE — before any music is mixed in) is sounding, as two
 *  readings, the clear voice first. `total` is the track's length in seconds. */
export async function voiceSound(voPath: string, total: number): Promise<Span[][]> {
  const out = path.join(os.tmpdir(), `lv-${Date.now()}-${crypto.randomBytes(5).toString("hex")}.txt`);
  try {
    if (!voPath || !fs.existsSync(voPath) || !(total > 0)) return [];
    const r = await runFfmpeg(["-hide_banner", "-nostats", "-y", "-i", voPath, "-af", levelFilter(out), "-f", "null", "-"]);
    if (r.status !== 0 || !fs.existsSync(out)) return [];
    return soundLevels(levelFrames(fs.readFileSync(out, "utf8")), total);
  } catch (e) {
    console.error(`[voice-sound] the track could not be read — unheard words are placed the older way: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
    return [];
  } finally {
    try { fs.rmSync(out, { force: true }); } catch { /* nothing written */ }
  }
}
