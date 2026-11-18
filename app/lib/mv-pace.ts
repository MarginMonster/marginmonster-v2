/* The PACE of a music video — how often the picture cuts.
 *
 * The owner, 2026-11-17: "We need logic on the cutscene performance generator on genre selection for
 * music videos, Rap would be fast more scene changes. Unless we do a set the pace or style". Both: the
 * genre sets the pace, and a Pace control overrides it.
 *
 * A music video here is N scenes of exactly D seconds each (one generated clip a scene), joined on the
 * song. That is ONE cut every ten seconds whatever the song — right for a country ballad, wrong for rap.
 * A faster pace does not generate more footage; it EDITS what was generated the way an editor would:
 *
 *   - a CUT SCENE trades beats with the other cut scenes (its own shot, another's, back to its own…);
 *   - a PERFORMANCE holds on the singer, and on a fast cut drops away for one beat and comes back.
 *
 * The one rule that cannot bend: footage of the artist SINGING plays only at its own place in the song.
 * It was lip-synced to that stretch of the track, so a performance shot is never moved in time — it is
 * only ever cut away FROM. Everything that is moved is cut-scene footage, which has no mouth to sync.
 *
 * Pure and import-free: the pipeline builds the cut list with it, the builder shows the default, and the
 * tests hold the sync rule. */

export type Pace = "slow" | "medium" | "fast";
export type ShotRole = "perform" | "broll";

export const PACE_KEYS: Pace[] = ["slow", "medium", "fast"];

/** `beats` = how many beats a ten-second scene is cut into. */
export const PACES: Record<Pace, { label: string; blurb: string; beats: number }> = {
  slow: { label: "Slow", blurb: "Long, lingering shots", beats: 1 },
  medium: { label: "Medium", blurb: "Cut scenes trade places every few seconds", beats: 2 },
  fast: { label: "Fast", blurb: "Quick cuts, lots of scene changes", beats: 4 },
};

/** The pace each genre is cut at unless the maker picks another. Country keeps the long shots its
 *  approved videos were cut with. */
export const GENRE_PACE: Record<string, Pace> = { rap: "fast", pop: "fast", rock: "medium", rnb: "medium", country: "slow" };

export const isPace = (v: unknown): v is Pace => v === "slow" || v === "medium" || v === "fast";

/** The pace a video is cut at: the maker's pick, else the genre's, else medium. */
export const paceFor = (genre: string | null | undefined, picked?: unknown): Pace => (isPace(picked) ? picked : GENRE_PACE[genre || ""] || "medium");

/** One piece of the finished video: `dur` seconds of scene `src`'s clip, starting `start` seconds in. */
export type Cut = { src: number; start: number; dur: number };

/** The cut list for a video whose scenes have these roles, each clip `D` seconds long, in timeline order.
 *  It always adds up to exactly roles.length × D, and a performance clip only ever appears at its own
 *  position (start === where it falls in its own scene). Slow — and any video with nothing to cut away
 *  to — is every clip whole, exactly as before pace existed. */
export function editPlan(roles: ShotRole[], D: number, pace: Pace): Cut[] {
  const n = roles.length;
  const beats = PACES[pace].beats;
  const whole = (): Cut[] => roles.map((_, i) => ({ src: i, start: 0, dur: D }));
  const cutScenes = roles.map((r, i) => (r === "broll" ? i : -1)).filter((i) => i >= 0);
  if (beats <= 1 || n < 2 || !cutScenes.length) return whole();
  const c = D / beats;

  /** Another cut scene's clip, `step` places along from scene i (i itself only when it is the only one). */
  const otherCutScene = (i: number, step: number): number => {
    if (cutScenes.length < 2) return i;
    const at = cutScenes.indexOf(i);
    return cutScenes[(at + 1 + (step % (cutScenes.length - 1))) % cutScenes.length];
  };
  /** Where a performance cuts away to: the next cut scene (a glimpse of where the video is going),
   *  else the one before. */
  const cutawayFor = (i: number): number => cutScenes.find((b) => b > i) ?? cutScenes[cutScenes.length - 1];

  const plan: Cut[] = [];
  let lent = 0; // cutaways so far — walks the borrowed windows so the same one is not shown twice running
  roles.forEach((role, i) => {
    for (let j = 0; j < beats; j++) {
      const own: Cut = { src: i, start: j * c, dur: c };
      if (role === "perform") {
        // The singer holds the shot. On a fast cut the second-to-last beat drops away to a cut scene and
        // the last beat comes back — still in sync, because the performance was never moved.
        if (pace === "fast" && j === beats - 2) {
          // a window HALF a beat off the grid: never the same frames another cut of that clip shows
          plan.push({ src: cutawayFor(i), start: ((lent++ % (beats - 1)) + 0.5) * c, dur: c });
        } else plan.push(own);
      } else {
        // A cut scene gives every other beat to another cut scene's footage (same stretch of that clip).
        const from = j % 2 === 1 ? otherCutScene(i, Math.floor(j / 2)) : i;
        plan.push(from === i ? own : { src: from, start: j * c, dur: c });
      }
    }
  });

  // pieces of one clip that simply continue are one shot, not two cuts
  const merged: Cut[] = [];
  for (const cut of plan) {
    const last = merged[merged.length - 1];
    if (last && last.src === cut.src && Math.abs(last.start + last.dur - cut.start) < 1e-6) last.dur += cut.dur;
    else merged.push({ ...cut });
  }
  return merged;
}

/** The ffmpeg filter graph that edits `n` clips (inputs 0…n-1, each already exactly the same length and
 *  frame rate) to a cut list — hard cuts, frame-exact, ending in [v]. Cut boundaries are rounded on the
 *  TIMELINE, so the frames always add up to the whole video and a performance shot's source frame is its
 *  timeline frame (it stays in sync to the frame). */
export function planFilter(cuts: Cut[], n: number, fps: number): string {
  const uses = Array.from({ length: n }, () => 0);
  for (const c of cuts) uses[c.src]++;
  const f: string[] = [];
  uses.forEach((u, i) => { if (u > 1) f.push(`[${i}:v]split=${u}${Array.from({ length: u }, (_, k) => `[s${i}_${k}]`).join("")}`); });
  const taken = Array.from({ length: n }, () => 0);
  const labels: string[] = [];
  let t = 0;
  cuts.forEach((c, q) => {
    const input = uses[c.src] > 1 ? `[s${c.src}_${taken[c.src]++}]` : `[${c.src}:v]`;
    const first = Math.round(c.start * fps);
    const frames = Math.round((t + c.dur) * fps) - Math.round(t * fps);
    f.push(`${input}trim=start_frame=${first}:end_frame=${first + frames},setpts=PTS-STARTPTS[q${q}]`);
    labels.push(`[q${q}]`);
    t += c.dur;
  });
  f.push(`${labels.join("")}concat=n=${cuts.length}:v=1:a=0[v]`);
  return f.join(";");
}

/** How many times the picture changes in a video of these scenes at this pace (for the builder). */
export const cutCount = (roles: ShotRole[], D: number, pace: Pace): number => Math.max(0, editPlan(roles, D, pace).length - 1);
