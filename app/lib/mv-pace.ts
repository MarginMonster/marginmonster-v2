/* The PACE of a music video — how often the picture cuts.
 *
 * The owner, 2026-11-17: "We need logic on the cutscene performance generator on genre selection for
 * music videos, Rap would be fast more scene changes. Unless we do a set the pace or style". Both: the
 * genre sets the pace, and a Pace control overrides it.
 *
 * A music video here is N scenes of exactly D seconds each (one generated clip a scene), joined on the
 * song. At ten seconds a scene that is ONE cut every ten seconds whatever the song — right for a country
 * ballad, wrong for rap. A faster pace does two things:
 *
 *   1. MORE SCENES (since 2026-11-21): the length is picked in seconds, and a medium or fast video is made
 *      of five-second scenes — twice as many pictures for the same length (see SCENE_SECONDS below);
 *   2. THE EDIT: what was generated is cut the way an editor would:
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

/** `beats` = how many beats TEN SECONDS of video are cut into (a five-second scene gets half as many). */
export const PACES: Record<Pace, { label: string; blurb: string; beats: number }> = {
  slow: { label: "Slow", blurb: "Long, lingering shots", beats: 1 },
  medium: { label: "Medium", blurb: "A new scene every few seconds", beats: 2 },
  fast: { label: "Fast", blurb: "Quick cuts, lots of scene changes", beats: 4 },
};

/* ---- length is picked in SECONDS; the pace decides how many scenes that is ----
 * The owner, 2026-11-21: "we have it by seconds and not scenes — that way there could potentially be many
 * scenes to come out and it works better with pace". The video model renders a clip of 5 or 10 seconds,
 * so a slow video is made of ten-second scenes and a medium or fast one of five-second scenes: the same
 * 30 seconds is 3 scenes slow, 6 scenes medium or fast. */

/** How long one generated scene is. */
export type SceneSeconds = 5 | 10;
export const SCENE_SECONDS: Record<Pace, SceneSeconds> = { slow: 10, medium: 5, fast: 5 };
export const sceneSecondsFor = (pace: Pace): SceneSeconds => SCENE_SECONDS[pace];
export const sceneSecondsOf = (v: unknown): SceneSeconds => (v === 5 || v === "5" ? 5 : 10);

/** The lengths a music video can be picked at, in seconds. */
export const MV_SECONDS = [10, 20, 30, 60, 90, 120];
export const MV_MAX_SECONDS = 120;
export const MV_DEFAULT_SECONDS = 30;

/** How many scenes make a video of `seconds` out of scenes `sceneSec` long (never fewer than one, never
 *  more than two minutes' worth). */
export const sceneCountFor = (seconds: number, sceneSec: number): number =>
  Math.max(1, Math.round(Math.max(sceneSec, Math.min(MV_MAX_SECONDS, seconds || 0)) / sceneSec));

/** What a music video is PRICED as: its length, in ten-second scenes — two five-second scenes are one
 *  ten-second scene's worth, so 30 seconds costs the same at any pace. */
export const mvBillScenes = (scenes: number, sceneSec: number): number => Math.max(1, Math.ceil((Math.max(1, scenes) * sceneSec) / 10));

/** "30s" / "1:30" / "2:00". */
export const lengthLabel = (seconds: number): string => (seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`);

/** The director's cadence, as roles (the pipeline's SHOTLIST carries the framing for each slot — a test
 *  holds the two in step): a few performances intercut with cut scenes. */
export const SHOT_ROLES: ShotRole[] = ["broll", "perform", "broll", "perform", "broll", "broll", "perform", "broll"];

/** The role of scene i of an n-scene video whose scenes are `sceneSec` long, unless the maker flips it.
 *  A SHORT video (20 seconds or less) leads with the performance and alternates: a 10-second video must
 *  BE the artist singing, not a lone establishing wide. Anything longer follows the director's cadence. */
export function defaultRole(i: number, n: number, sceneSec: number = 10): ShotRole {
  if (n <= 1) return "perform";
  if (n * sceneSec <= 20) return i % 2 === 0 ? "perform" : "broll";
  return SHOT_ROLES[((i % SHOT_ROLES.length) + SHOT_ROLES.length) % SHOT_ROLES.length];
}

/** What each slot of the shot list IS, in the words the song WRITER is given — so the scene it writes
 *  for that slot is the kind of shot it will be filmed as. (It used to be told every scene was "the
 *  artist performing to camera", and then two scenes in three were filmed as cut scenes: an establishing
 *  wide of a scene written as a close performance.) The dance scene says WHERE dancing can happen and
 *  the lifestyle scene no longer says "riding": a song about a night drive had its dance scene written
 *  in a moving convertible, and the cast was drawn standing up in it (mv-sense.ts). */
export const SHOT_NOTES: string[] = [
  "CUT SCENE — a wide establishing shot of a striking place; the artist small in it or walking through it, not singing",
  "PERFORMANCE — the artist sings straight to camera, medium shot",
  "CUT SCENE — dancing and movement, full of rhythm: on foot, somewhere with room to dance (never in a vehicle, never sitting); nobody sings to camera",
  "PERFORMANCE — the artist sings to camera, a closer shot",
  "CUT SCENE — a hero moment that shows off the place or the prop; the artist near it, not singing",
  "CUT SCENE — lifestyle: the artist walking, arriving, leaning back and taking in the place — living the moment; not singing",
  "PERFORMANCE — the artist sings to camera, a wide full-body shot",
  "CUT SCENE — atmosphere and detail: textures, scenery in motion; the artist a small part of it or absent",
];

const SLOTS_OF = (role: ShotRole): number[] => SHOT_ROLES.map((r, k) => (r === role ? k : -1)).filter((k) => k >= 0);
/** Which slot of the shot list FRAMES scene i when it plays `role`. On the director's cadence that is
 *  simply slot i; a scene whose role is not the cadence's (a flipped scene, a short performance-first
 *  video) takes the next framing of its own kind instead of a generic one — so two performances in a
 *  row are a medium and then a wide, not the same shot twice. */
export function shotSlot(role: ShotRole, i: number): number {
  const at = ((i % SHOT_ROLES.length) + SHOT_ROLES.length) % SHOT_ROLES.length;
  if (SHOT_ROLES[at] === role) return at;
  const pool = SLOTS_OF(role);
  return pool[(((i >> 1) % pool.length) + pool.length) % pool.length];
}

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
 *  to — is every clip whole, exactly as before pace existed.
 *  With `songBeats` (the song's own beat times — see beatTimes) each cut is moved onto the nearest beat. */
export function editPlan(roles: ShotRole[], D: number, pace: Pace, songBeats?: number[]): Cut[] {
  const n = roles.length;
  // the pace is a number of beats per TEN seconds; a five-second scene is cut into half as many — so a
  // medium video of five-second scenes plays each scene whole (the scene changes ARE its cuts), and a
  // fast one splits its cut scenes in two
  const beats = Math.max(1, Math.round((PACES[pace].beats * D) / 10));
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
        // The singer holds the shot. On a fast cut of a ten-second scene the second-to-last beat drops
        // away to a cut scene and the last beat comes back — still in sync, because the performance was
        // never moved. (A five-second performance is too short to leave: it is held whole.)
        if (pace === "fast" && beats >= 4 && j === beats - 2) {
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
  return songBeats && songBeats.length ? snapToBeats(merged, roles, D, songBeats, Math.min(0.6, c * 0.4)) : merged;
}

/* ---- on the beat ----
 * The grid above cuts every D/beats seconds whatever the song is doing. An editor cuts ON the beat: the
 * song is listened to, and each cut is moved to the nearest beat — a fraction of a second at most. */

/** Move each cut of a plan onto the nearest beat (within `maxShift` seconds), keeping everything the plan
 *  promised: the same total length; every piece at least `minPiece` long; a shot of the singer still at
 *  exactly its own place in the song, inside its own clip; no cut scene asked for more footage than its
 *  clip has. A cut that cannot move without breaking one of those stays where it was. */
export function snapToBeats(cuts: Cut[], roles: ShotRole[], D: number, beats: number[], maxShift = 0.6, minPiece = 1): Cut[] {
  if (cuts.length < 2 || !beats.length) return cuts;
  const B: number[] = [0];
  for (const c of cuts) B.push(B[B.length - 1] + c.dur);
  const sorted = [...beats].sort((a, b) => a - b);
  /** The beats either side of a time, nearest first. */
  const around = (t: number): number[] => {
    let lo = 0, hi = sorted.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (sorted[mid] < t) lo = mid; else hi = mid; }
    const pair = lo === hi ? [sorted[lo]] : [sorted[lo], sorted[hi]];
    return pair.sort((x, y) => Math.abs(x - t) - Math.abs(y - t));
  };
  for (let k = 1; k < cuts.length; k++) {
    const left = cuts[k - 1], right = cuts[k];
    for (const b of around(B[k])) {
      if (Math.abs(b - B[k]) > maxShift) break;
      if (Math.abs(b - B[k]) < 1e-6) break; // already on a beat
      // each side keeps a watchable length…
      if (b - B[k - 1] < minPiece || B[k + 1] - b < minPiece) continue;
      // …a shot of the singer stays inside its own ten seconds of the song…
      if (roles[left.src] === "perform" && b > (left.src + 1) * D + 1e-9) continue;
      if (roles[right.src] === "perform" && b < right.src * D - 1e-9) continue;
      // …and a cut scene is never asked for more footage than its clip has
      if (roles[left.src] !== "perform" && b - B[k - 1] > D + 1e-9) continue;
      if (roles[right.src] !== "perform" && B[k + 1] - b > D + 1e-9) continue;
      B[k] = b;
      break;
    }
  }
  return cuts.map((c, q) => {
    const dur = B[q + 1] - B[q];
    // the singer's footage is never moved in time: where it starts is where it falls in the song
    // (a cut scene's piece is kept a frame and a half clear of the end of its clip: boundaries that are
    // no longer on round numbers get rounded to frames, and a piece that rounds one frame past the clip
    // comes back a frame short — the real 50-second test video was 1499 frames, not 1500)
    const start = roles[c.src] === "perform" ? B[q] - c.src * D : Math.max(0, Math.min(c.start, D - dur - 0.05));
    return { src: c.src, start, dur };
  });
}

/** The beats of a song, from its samples (mono PCM at `sr` Hz): how suddenly the sound gets louder is
 *  measured frame by frame (drums and strummed chords are spikes), the tempo is the gap at which those
 *  spikes line up with themselves best (70–180 a minute), and the song is then walked beat by beat,
 *  each one settling on the spike nearest to where it was expected (so a tempo that is a hair off does
 *  not drift over two minutes). Returns [] when no steady pulse can be heard — then cuts stay on the grid. */
export function beatTimes(pcm: Float32Array, sr: number): number[] {
  const hop = Math.max(1, Math.round(sr * 0.0116));
  const win = hop * 2;
  const n = Math.floor((pcm.length - win) / hop);
  if (n < 430) return []; // under about five seconds there is no tempo to find
  const fps = sr / hop;
  const env = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let e = 0;
    const o = i * hop;
    for (let k = 0; k < win; k++) { const x = pcm[o + k]; e += x * x; }
    const l = Math.log(1e-8 + e / win);
    env[i] = i ? Math.max(0, l - prev) : 0;
    prev = l;
  }
  // take the slow swell out, keep the spikes
  const span = Math.max(2, Math.round(fps * 0.5));
  const flat = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += env[i];
    if (i >= span) acc -= env[i - span];
    flat[i] = Math.max(0, env[i] - acc / Math.min(i + 1, span));
  }
  const score = (bpm: number): number => {
    const lag = (60 / bpm) * fps;
    let sc = 0;
    for (let i = 0; i + 2 * lag + 1 < n; i++) {
      const x = flat[i];
      if (!x) continue;
      sc += x * (flat[Math.round(i + lag)] + 0.5 * flat[Math.round(i + 2 * lag)]);
    }
    return sc * Math.exp(-0.5 * Math.pow(Math.log2(bpm / 115) / 0.8, 2)); // most songs sit near the middle
  };
  let best = 0, bestBpm = 0, total = 0, tried = 0;
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const sc = score(bpm);
    total += sc; tried++;
    if (sc > best) { best = sc; bestBpm = bpm; }
  }
  if (!(best > 0) || best < 1.5 * (total / tried)) return [];
  const coarse = (60 / bestBpm) * fps;
  // Where the first beats fall: the offset that catches the most spikes in the opening ten seconds (the
  // envelope has a frame every 11.6 ms, so the tempo above is only good to about half a beat a minute —
  // over ten seconds that has not drifted; over the whole song it would have).
  const opening = Math.min(n, Math.round(fps * 10));
  let phase = 0, top = -1;
  for (let ph = 0; ph < coarse; ph += 0.5) {
    let sum = 0;
    for (let t = ph; t < opening; t += coarse) sum += flat[Math.round(t)] || 0;
    if (sum > top) { top = sum; phase = ph; }
  }
  /** Walk the song a beat at a time from `start`, `period` frames apart. Each beat is only NUDGED towards
   *  a spike close to where it was expected (a fifth of the way, within an eighth of a beat): enough to
   *  follow a tempo that breathes or is a hair out, never enough to wander onto the off-beat of a busy
   *  pattern (the first real rap video did exactly that when the pull was stronger). */
  const walk = (period: number, start: number): { beats: number[]; hits: Array<[number, number, number]> } => {
    const beatsAt: number[] = [];
    const hits: Array<[number, number, number]> = [];
    const reach = Math.max(1, Math.round(period * 0.125));
    let t = start, k = 0;
    while (t < n) {
      const c0 = Math.round(t);
      let at = c0, peak = 0;
      for (let q = Math.max(0, c0 - reach); q <= Math.min(n - 1, c0 + reach); q++) if (flat[q] > peak) { peak = flat[q]; at = q; }
      if (peak > 0) { hits.push([k, at, peak]); t += 0.2 * (at - t); }
      beatsAt.push(t);
      t += period; k++;
    }
    return { beats: beatsAt, hits };
  };
  const first = walk(coarse, phase);
  // The tempo, exactly: a straight line (beat number → frame) through the stronger half of the hits.
  let period = coarse, start = phase;
  const strong = [...first.hits].sort((x, y) => y[2] - x[2]).slice(0, Math.max(8, Math.ceil(first.hits.length / 2)));
  if (strong.length >= 8) {
    const mk = strong.reduce((acc, h) => acc + h[0], 0) / strong.length;
    const mf = strong.reduce((acc, h) => acc + h[1], 0) / strong.length;
    let num = 0, den = 0;
    for (const h of strong) { num += (h[0] - mk) * (h[1] - mf); den += (h[0] - mk) * (h[0] - mk); }
    const slope = den > 0 ? num / den : coarse;
    if (Math.abs(slope - coarse) / coarse < 0.02) { period = slope; start = mf - slope * mk; while (start < 0) start += period; }
  }
  const out = walk(period, start).beats.map((fr) => (fr * hop + win / 2) / sr);
  return out;
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
