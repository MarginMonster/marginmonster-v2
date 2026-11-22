/* A SING-ALONG'S PICTURES FOLLOW ITS SONG.
 *
 * The story engine's sung format (Kids Music Video) writes one lyric line per scene, has the song sung
 * from those lines, and gave every scene the same five seconds with its line written across it. But the
 * SINGER decides how long a line takes. On a film made as a customer (2026-11-22, "One Umbrella, Three
 * Little Ducks", four scenes = 20 s) the four lines were sung in fifteen seconds:
 *
 *     line 1 sung 0.6–4.3 s    on screen  0–5 s
 *     line 2 sung 4.6–8.0 s    on screen  5–10 s
 *     line 3 sung 8.3–10.6 s   on screen 10–15 s     ← its words came up as the singer finished line 4
 *     line 4 sung 11–15 s      on screen 15–20 s     ← while the song, looped to fill the video, sang line 1 again
 *
 * A sing-along whose words are not the words being sung is not a sing-along. So the song is listened to,
 * and each scene is on screen exactly while ITS line is sung: scene k runs from just before its line
 * starts to just before the next line starts, and the last one to a moment after the song's last word.
 * A scene's clip is cut short when its line is quick, slowed a little when its line is slow, and held on
 * its last frame for whatever is left. The video is then as long as the song — nothing loops.
 *
 * Pure: what is decided here is arithmetic, so it is tested. */

/** How one scene's clip is fitted: on screen for `dur` seconds — the clip played at 1/`slow` speed
 *  (`slow` ≥ 1; 1 = as filmed) and then held on its last frame for `hold` seconds. */
export type SceneFit = { dur: number; slow: number; hold: number };

export const SUNG_FIT = {
  /** the picture changes this long before the next line's first word */
  lead: 0.15,
  /** no scene is shorter than this, however quick its line */
  minScene: 1.6,
  /** a clip is slowed by no more than this — past it the last frame is held */
  maxSlow: 1.4,
  /** the last scene stays this long after the song's last word (when the song runs that long) */
  tail: 2.2,
} as const;

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** `spans[k]` = when scene k's own line is sung (null: it was not heard). `songLen` = how long the song
 *  runs, `clipLen` = how long each filmed clip is. Returns how every scene is fitted — or null when the
 *  song cannot be followed (a line was not heard, the lines are out of order, there is no song), in which
 *  case the film is made the way it always was. */
export function fitScenesToSong(spans: Array<{ start: number; end: number } | null>, songLen: number, clipLen = 5): SceneFit[] | null {
  const n = spans.length;
  if (!n || !(songLen > 2) || !(clipLen > 0.5)) return null;
  const ok = spans.every((s) => !!s && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end >= s.start && s.start >= 0);
  if (!ok) return null;
  const sp = spans as Array<{ start: number; end: number }>;
  for (let k = 1; k < n; k++) if (sp[k].start < sp[k - 1].start) return null; // sung out of order: not ours to re-cut
  // where the picture changes: at 0, then just ahead of each next line — never leaving a scene too short
  const cuts: number[] = [0];
  for (let k = 1; k < n; k++) cuts.push(Math.max(cuts[k - 1] + SUNG_FIT.minScene, sp[k].start - SUNG_FIT.lead));
  // The last scene: to the END OF THE SONG when its clip can last that long (a song that closes on a few
  // bars of music ends where it ends — the film is not faded out half-way through them); if the song
  // runs on past that, as far as the clip can, and never less than a moment after the last word.
  const reach = cuts[n - 1] + clipLen * SUNG_FIT.maxSlow;
  const end = Math.min(songLen, Math.max(sp[n - 1].end + SUNG_FIT.tail, cuts[n - 1] + SUNG_FIT.minScene, Math.min(songLen, reach)));
  if (!(end > cuts[n - 1] + 0.5)) return null; // the song ran out before the last scene could have its line
  cuts.push(end);
  return cuts.slice(0, n).map((c, k) => {
    const dur = cuts[k + 1] - c;
    if (dur <= clipLen) return { dur: r2(dur), slow: 1, hold: 0 };
    // (rounded UP to the hundredth the filter is written with, so the slowed clip is never a frame short)
    const slow = Math.min(SUNG_FIT.maxSlow, Math.ceil((dur / clipLen) * 100) / 100);
    return { dur: r2(dur), slow, hold: r2(Math.max(0, dur - clipLen * slow)) };
  });
}

/** Each scene's sung span, from the lines heard (lyric-sync.ts sceneLineTimes): a scene with two lines
 *  runs from its first to its last; a scene whose line was not heard is null. */
export function sceneSpans(sceneCount: number, lineTimes: Array<{ scene: number; start: number; end: number }>): Array<{ start: number; end: number } | null> {
  const out: Array<{ start: number; end: number } | null> = Array.from({ length: Math.max(0, sceneCount) }, () => null);
  for (const t of lineTimes) {
    if (!(t.scene >= 0 && t.scene < out.length)) continue;
    const cur = out[t.scene];
    out[t.scene] = cur ? { start: Math.min(cur.start, t.start), end: Math.max(cur.end, t.end) } : { start: t.start, end: t.end };
  }
  return out;
}

/** The ffmpeg video filter that fits one clip (see SceneFit); the caller adds `-t dur`. */
export function fitFilter(f: SceneFit): string {
  const parts: string[] = [];
  if (f.slow > 1.001) parts.push(`setpts=${f.slow.toFixed(2)}*PTS`);
  if (f.hold > 0.02) parts.push(`tpad=stop_mode=clone:stop_duration=${(f.hold + 0.2).toFixed(2)}`);
  parts.push("fps=30");
  return parts.join(",");
}

/** WHAT THE ANIMATOR IS TOLD FIRST, in the story engine's films. Same film: "Puddleton leaps feet-first
 *  into a big round puddle" was animated as the duckling jumping IN — he sank into the puddle and was
 *  gone for the rest of the scene. In a video for toddlers. Whoever is in the picture stays in it. */
export const MOTION_KEEPS_CAST = "Everyone in the picture stays in the picture — whole, in sight and unchanged from the first frame to the last. Nobody leaves the frame, sinks, goes under water, vanishes, melts or changes shape, and nobody new appears. ";
/** …and, for little ones, how they move. */
export const MOTION_GENTLE = "Small, gentle, bouncy movements on the spot. ";
/** What the animator is told NOT to do (the engines that take a negative prompt). */
export const MOTION_NEGATIVE = "a character disappearing, a character vanishing, a character leaving the frame, a character sinking or going under water, melting, morphing, changing shape, a new character appearing, extra limbs, flickering, distortion, text, watermark, blur";
