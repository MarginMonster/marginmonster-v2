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
  return (await readVoiceSound(voPath, total)).speech;
}

/** The same reading — and, when the track could NOT be read, why (`unread`). Nobody can read the server's
 *  log, so the reason is kept with the piece (narrated-core → timingRecord): a reading that quietly came
 *  back empty looked, from outside, exactly like one that worked. */
export async function readVoiceSound(voPath: string, total: number): Promise<{ speech: Span[][]; unread?: string }> {
  const out = path.join(os.tmpdir(), `lv-${Date.now()}-${crypto.randomBytes(5).toString("hex")}.txt`);
  try {
    if (!voPath || !fs.existsSync(voPath)) return { speech: [], unread: "no voice file" };
    if (!(total > 0)) return { speech: [], unread: "no length" };
    const r = await runFfmpeg(["-hide_banner", "-nostats", "-y", "-i", voPath, "-af", levelFilter(out), "-f", "null", "-"]);
    if (r.status !== 0) return { speech: [], unread: `ffmpeg ${r.status}: ${String(r.stderr || "").replace(/\s+/g, " ").trim().slice(-140)}` };
    if (!fs.existsSync(out)) return { speech: [], unread: "nothing was printed" };
    const frames = levelFrames(fs.readFileSync(out, "utf8"));
    const speech = soundLevels(frames, total);
    return speech.length ? { speech } : { speech, unread: frames.length ? `${frames.length} frames, none with sound` : "the print-out had no levels in it" };
  } catch (e) {
    const why = e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120);
    console.error(`[voice-sound] the track could not be read — unheard words are placed the older way: ${why}`);
    return { speech: [], unread: why };
  } finally {
    try { fs.rmSync(out, { force: true }); } catch { /* nothing written */ }
  }
}
