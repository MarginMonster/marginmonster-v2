/* A STORY'S PICTURES MOVE — the doing part (story-motion.ts says what and why).
 *
 * One clip a scene, asked for from the picture the scene already has, as long as the scene is told. A few
 * at a time; each one by itself — a clip that cannot be made leaves its scene the still it had, and is
 * written down (the piece's own meta, for the operator) instead of failing the story.
 *
 * A clip is KEPT beside its picture, under the picture's name (motionName): the same pictures told again
 * — another language, a changed line — move without being paid for twice, and a job that starts again
 * finds what it had already made. What was still being made when a job stopped is picked up by its
 * request id (ckMotion), not asked for again. */
import fs from "node:fs";
import path from "node:path";
import { falEnabled, falVideoPoll, falVideoSubmit } from "./fal-video.server";
import { checkpointJob, download, ffprobeDuration, runFfmpeg } from "./ugc-ad-pipeline.server";
import { MOTION_MAX_SCENES, STORY_MOTION_MODEL, motionName, motionOn, motionPrompt, motionReusable, motionSeconds, servable } from "./story-motion";

const RENDERS = () => path.join(process.cwd(), "data", "renders");
/** How many clips are asked for at once. */
const AT_ONCE = 3;
/** How long one clip is waited for (they take about a minute). */
const CLIP_WAIT_MS = 7 * 60_000;

export type MotionResult = {
  /** one per scene: the clip on our own disk, or null where the scene keeps its still */
  clips: (string | null)[];
  /** clips made now, clips found already made, and the seconds that were asked (and paid) for now */
  made: number;
  reused: number;
  seconds: number;
  faults: Array<{ scene: number; error: string }>;
};

export const storyMotionOn = (): boolean => motionOn(process.env, falEnabled());

const seconds = (file: string): number => { try { return ffprobeDuration(file); } catch { return 0; } };

export async function animateScenes(o: {
  /** each scene's picture, on our own disk under data/renders (the engine fetches it by its /renders address) */
  seeds: string[];
  /** each scene as its writer described it */
  visuals: string[];
  /** how each scene is SEEN (story-shots.ts) — the motion follows it; absent for a story with no shot plan */
  cams?: Array<string | null | undefined>;
  /** how long each scene is told, in seconds */
  told: number[];
  /** this app's own origin */
  base: string;
  W: number; H: number;
  jobId?: string;
  /** request ids of clips a stopped job was still waiting for: picture name → id (JSON) */
  ckMotion?: string;
}): Promise<MotionResult> {
  const N = o.seeds.length;
  const out: MotionResult = { clips: new Array(N).fill(null), made: 0, reused: 0, seconds: 0, faults: [] };
  if (!N || !o.base) return out;
  let ids: Record<string, string> = {};
  try { const j = JSON.parse(o.ckMotion || "{}"); if (j && typeof j === "object") ids = j as Record<string, string>; } catch { ids = {}; }
  const saveIds = async () => { if (o.jobId) await checkpointJob(o.jobId, { ckMotion: JSON.stringify(ids) }); };
  // the job says it is alive while clips are waited for (a story lane job is watched like any other)
  const alive = o.jobId ? setInterval(() => { void checkpointJob(o.jobId!, { ckBeat: Date.now() }).catch(() => undefined); }, 45_000) : null;

  // one clip per PICTURE: a scene that borrowed its neighbour's picture shares its neighbour's clip
  const making = new Map<string, Promise<string>>();
  const clipFor = (i: number): Promise<string> => {
    const seed = o.seeds[i];
    const name = motionName(seed);
    const file = path.join(RENDERS(), name);
    const had = making.get(name);
    if (had) return had;
    const p = (async (): Promise<string> => {
      const need = o.told[i];
      if (fs.existsSync(file) && motionReusable(seconds(file), need)) { out.reused++; return file; }
      const ask = motionSeconds(need);
      let id = ids[name];
      if (!id) {
        // the engine fetches the picture from this app's own address — a name that address will not serve
        // is a clip that cannot be made, and is said so here rather than by the provider a minute later
        if (!servable(path.basename(seed)) || !fs.existsSync(seed)) throw new Error(`the picture cannot be fetched (${path.basename(seed)})`);
        id = await falVideoSubmit(STORY_MOTION_MODEL, { startImage: `${o.base}/renders/${path.basename(seed)}`, prompt: motionPrompt(o.visuals[i] || "", o.cams?.[i]), durationSec: ask });
        ids[name] = id;
        await saveIds();
      }
      let url: string;
      try { url = await falVideoPoll(STORY_MOTION_MODEL, id, CLIP_WAIT_MS); }
      catch (e) {
        // a clip that failed in the queue is not waited for again by a job that starts over
        if (!/still running/.test(e instanceof Error ? e.message : "")) { delete ids[name]; await saveIds().catch(() => undefined); }
        throw e;
      }
      const raw = `${file}.raw.mp4`, tmp = `${file}.part.mp4`;
      try {
        await download(url, raw);
        if (!(seconds(raw) > 1)) throw new Error("the clip that came back does not play");
        // the story's own size and nothing more — a clip is kept for days, and six of them a story add up
        const r = await runFfmpeg(["-y", "-i", raw, "-an", "-vf", `scale=${o.W}:${o.H}:force_original_aspect_ratio=increase,crop=${o.W}:${o.H},setsar=1`,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", tmp]);
        if (r.status === 0 && seconds(tmp) > 1) fs.renameSync(tmp, file);
        else fs.renameSync(raw, file); // as it came: larger, and it plays
      } finally {
        for (const f of [raw, tmp]) { try { fs.rmSync(f, { force: true }); } catch { /* not there */ } }
      }
      delete ids[name];
      await saveIds().catch(() => undefined);
      out.made++;
      out.seconds += ask; // counted when the clip is MADE: a request the provider refuses is not paid for
      return file;
    })();
    making.set(name, p);
    return p;
  };

  try {
    let next = 0;
    const worker = async () => {
      while (next < Math.min(N, MOTION_MAX_SCENES)) {
        const i = next++;
        try { out.clips[i] = await clipFor(i); }
        catch (e) { out.faults.push({ scene: i + 1, error: (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 180) }); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, N) }, () => worker()));
  } finally {
    if (alive) clearInterval(alive);
  }
  out.faults.sort((a, b) => a.scene - b.scene);
  if (out.faults.length) console.error(`[story-motion] ${out.faults.length} of ${N} scenes keep their still: ${out.faults.map((f) => `#${f.scene} ${f.error}`).join(" | ").slice(0, 400)}`);
  console.log(`[story-motion] ${out.made} made, ${out.reused} already there, ${out.seconds}s asked for`);
  return out;
}
