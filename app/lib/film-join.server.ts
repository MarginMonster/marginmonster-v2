// THE JOIN, RUN — for every pipeline that joins clips which carry their OWN sound into one film (the acted film:
// film-dialogue.server.ts; the avatar dialogue: film-dialogue-avatar.server.ts). Each clip is measured, the join's
// graph is made (acted-staging.ts → joinGraph — where the whole story of it is told: knock4, 2026-11-24, whose
// reveal vanished from the picture while its 5 s of sound played on, because every dissolve was placed by each
// clip's CONTAINER length, the longer of its picture and its sound), the finished file is MEASURED (joinCheck),
// joined again the plain way when it is not whole, and THROWN otherwise: the job fails, and a film whose picture
// and sound do not match is never shipped.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { ffprobeBin, ffprobeDuration, hasAudioStream, runFfmpeg } from "./ugc-ad-pipeline.server";
import { FILM_FPS, clipFrames, joinCheck, joinGraph, type Seam } from "./acted-staging";

/** ffprobe's answer as JSON ({} when it gives none). */
const probeJson = (file: string, args: string[]): { streams?: Array<Record<string, unknown>> } => {
  try { return JSON.parse(spawnSync(ffprobeBin(), ["-v", "error", ...args, "-of", "json", file], { encoding: "utf8", timeout: 20_000 }).stdout || "{}"); } catch { return {}; }
};

/** A CLIP'S LENGTH, in frames at the film's 30 fps — read off its PICTURE, never off the file's own length, which
 *  is the longer of its picture and its sound (a few hundredths of a second of sound past the last frame of the
 *  shots before it is what took knock4's reveal out of the picture). The picture stream's own length; when a file
 *  does not say it, its frame count over its frame rate; failing both, the file's length. */
export function pictureFrames(file: string): number {
  const v = probeJson(file, ["-select_streams", "v:0", "-show_entries", "stream=duration,nb_frames,avg_frame_rate"]).streams?.[0] || {};
  let secs = parseFloat(String(v.duration ?? ""));
  if (!(secs > 0)) {
    const [num, den] = String(v.avg_frame_rate ?? "").split("/").map(Number);
    const count = parseInt(String(v.nb_frames ?? ""), 10);
    if (num > 0 && den > 0 && count > 0) secs = count / (num / den);
  }
  if (!(secs > 0)) secs = ffprobeDuration(file);
  return Math.max(1, Math.round(secs * FILM_FPS));
}

/** A file's picture and sound lengths (s): `audio` null when it has no sound stream, NaN when it has one whose
 *  length cannot be read (which never passes joinCheck). */
export function streamSeconds(file: string): { video: number | null; audio: number | null } {
  const streams = probeJson(file, ["-show_entries", "stream=codec_type,duration"]).streams || [];
  const len = (kind: string): number | null => {
    const s = streams.find((x) => x.codec_type === kind);
    if (!s) return null;
    const d = parseFloat(String(s.duration ?? ""));
    return d > 0 ? d : NaN;
  };
  return { video: len("video"), audio: len("audio") };
}

/** JOIN THE CLIPS INTO ONE FILM, WHOLE — or throw. `prep` = each clip's picture filters (crop, scale, …, fps=30);
 *  `seams[i]` = how clip i is joined to the one before (a kind, or a dissolve in frames; 0 a straight join);
 *  `length` = how long each clip is in the film (acted-staging.ts → clipFrames: its picture, or the longer of its
 *  picture and its sound); `encode` = the encoder's arguments (the output path is added); `label` = the log's
 *  prefix. Joined with its dissolves, MEASURED; not whole → joined again with every seam a straight join, MEASURED;
 *  still not → throws. Returns the film's length in frames. */
export async function joinWhole(o: { clips: string[]; outPath: string; prep: string; seams: ReadonlyArray<Seam>; length?: "picture" | "longer"; encode: string[]; label: string; beat?: () => Promise<void> }): Promise<number> {
  const { clips, outPath, label } = o;
  if (!clips.length) throw new Error(`${label} no clips`);
  const sizes = clips.map((c) => {
    try {
      const picture = pictureFrames(c) / FILM_FPS;
      return { picture, frames: clipFrames({ picture, sound: o.length === "longer" ? streamSeconds(c).audio : null, length: o.length }) };
    } catch { return { picture: 0, frames: 0 }; }
  });
  const unmeasured = sizes.findIndex((s) => !(s.frames > 0));
  if (unmeasured >= 0) throw new Error(`${label} shot ${unmeasured + 1}'s picture could not be measured (${clips[unmeasured]})`);
  const frames = sizes.map((s) => s.frames);
  // (as long as a last frame may have to be held: the most any clip's length passes its own picture)
  const hold = Math.max(...sizes.map((s) => s.frames / FILM_FPS - s.picture)) + 1;
  const silent = clips.map((c) => { try { return !hasAudioStream(c); } catch { return false; } });
  const inputs = clips.flatMap((c) => ["-i", c]);
  const failed: string[] = [];
  for (const [how, plan] of [
    ["with its dissolves", joinGraph({ frames, seams: o.seams, prep: o.prep, silent, hold })],
    ["the plain way, every seam a straight join", joinGraph({ frames, seams: o.seams, prep: o.prep, silent, hold, dissolve: false })],
  ] as Array<[string, { graph: string; frames: number }]>) {
    const run = await runFfmpeg(["-y", ...inputs, "-filter_complex", plan.graph, "-map", "[vc]", "-map", "[ac]", ...o.encode, outPath]);
    const whole = run.status === 0 && fs.existsSync(outPath)
      ? joinCheck({ ...streamSeconds(outPath), frames: plan.frames })
      : { ok: false, why: `ffmpeg stopped: ${(run.stderr || "").slice(-200)}` };
    if (whole.ok) {
      if (failed.length) console.error(`${label} the film was joined ${how} after: ${failed.join("; ")}`);
      return plan.frames;
    }
    failed.push(`${how} — ${whole.why}`);
    console.error(`${label} the film did not come out whole ${how}: ${whole.why}`);
    if (o.beat) await o.beat();
  }
  // NEVER SHIPPED: the job fails here, and a film missing a shot's picture (or its sound) never reaches anybody
  throw new Error(`${label} the film could not be joined whole — ${failed.join("; ")}`);
}
