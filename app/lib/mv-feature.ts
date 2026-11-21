/* A FEATURED VERSE — another cast member sings part of the song, in their own voice.
 *
 * The owner, 2026-11-21: "need a feature thing also (another cast member sings that part of the song in
 * their voice like real music)".
 *
 * How it is made:
 *   - the WRITER gives the featured co-star a verse of their own and marks those scenes ("singer": name);
 *   - the SONG is generated as one track, as always (the music engine has one singer);
 *   - the whole track is then RE-VOICED in the co-star's voice (the same re-voice "sing in my own voice"
 *     uses), giving two takes of one song — the same music, the same timing, two singers;
 *   - the takes are CROSS-FADED: the co-star's is heard during their verse, the lead's everywhere else.
 *     The switch is put in a breath between words and — because footage of someone singing shows their
 *     mouth — never while a performance by the OTHER singer is on screen;
 *   - the PICTURE: in the co-star's performance scenes it is the co-star on camera, lip-synced to the
 *     finished track, which at that moment is their own voice.
 *
 * Pure and import-free (types aside): the pipeline does the audio, the page shows who sings what, the
 * tests hold the rules. */

import type { ShotRole } from "./mv-pace";

/** Who sings, or who is in a shot: -1 = the artist, 0… = a co-star, by their place in the cast. */
export type Who = number;
export const ARTIST: Who = -1;

/** The shortest music video a co-star can have a verse in: the artist needs a turn too. */
export const FEATURE_MIN_SECONDS = 20;

/** A stretch of the song a co-star sings. */
export type VoiceWindow = { who: Who; start: number; end: number };

/** A breath in the singing: a moment nobody is mid-word, where one voice can hand over to another. */
export type Gap = { t: number; gap: number };

/** The breaths in a song, from the words heard in it (each with when it starts and ends): the middle of
 *  every silence at least `minGap` seconds long between one word and the next. */
export function vocalGaps(words: Array<{ start: number; end: number }>, minGap = 0.28): Gap[] {
  const w = (words || []).filter((x) => x && Number.isFinite(x.start) && Number.isFinite(x.end) && x.end >= x.start).sort((a, b) => a.start - b.start);
  const out: Gap[] = [];
  for (let i = 0; i + 1 < w.length; i++) {
    const gap = w[i + 1].start - w[i].end;
    if (gap >= minGap) out.push({ t: (w[i].end + w[i + 1].start) / 2, gap });
  }
  return out;
}

/** WHEN each co-star's voice is heard.
 *
 *  `singers[i]` is who sings scene i (the writer's mark, or the maker's), `roles[i]` whether that scene
 *  is a performance, `D` the length of a scene. Scenes sung by the same person in a row are one stretch;
 *  between two stretches the voice changes ONCE, at the breath nearest to where the scenes change — but
 *  only inside the cut scenes between the two singers' performances, so nobody is ever seen singing in
 *  somebody else's voice. With no breath to be found there it changes exactly where the scenes do. */
export function voiceWindows(o: { singers: Who[]; roles: ShotRole[]; D: number; gaps?: Gap[] }): VoiceWindow[] {
  const n = Math.min(o.singers.length, o.roles.length);
  const D = o.D;
  if (!n || !(D > 0)) return [];
  const total = n * D;
  const runs: Array<{ who: Who; from: number; to: number }> = [];
  for (let i = 0; i < n; i++) {
    const w = Number.isInteger(o.singers[i]) && o.singers[i] >= 0 ? o.singers[i] : ARTIST;
    const last = runs[runs.length - 1];
    if (last && last.who === w) last.to = i;
    else runs.push({ who: w, from: i, to: i });
  }
  if (runs.length < 2) return runs[0] && runs[0].who >= 0 ? [{ who: runs[0].who, start: 0, end: total }] : [];
  const gaps = (o.gaps || []).filter((g) => g && Number.isFinite(g.t)).sort((a, b) => a.t - b.t);
  const switches: number[] = [];
  let prev = 0;
  for (let r = 0; r + 1 < runs.length; r++) {
    const a = runs[r], b = runs[r + 1];
    const T = b.from * D;
    // the last moment the outgoing singer is SEEN singing, and the first moment the incoming one is
    let lo = a.from * D;
    for (let i = a.to; i >= a.from; i--) if (o.roles[i] === "perform") { lo = (i + 1) * D; break; }
    let hi = (b.to + 1) * D;
    for (let i = b.from; i <= b.to; i++) if (o.roles[i] === "perform") { hi = i * D; break; }
    // two performances back to back leave no cut scene to change in: look a little either side
    if (hi - lo < 0.5) { lo = T - 0.75; hi = T + 0.75; }
    // never further than one scene from where the scenes change, never before the last change
    lo = Math.max(lo, T - D, prev + 1, 0.2);
    hi = Math.min(hi, T + D, total - 0.2);
    let at = Math.max(lo, Math.min(hi, T));
    if (hi > lo) {
      let best = -1;
      for (const g of gaps) {
        if (g.t < lo || g.t > hi) continue;
        if (best < 0 || Math.abs(g.t - T) < Math.abs(best - T)) best = g.t;
      }
      if (best >= 0) at = best;
    }
    switches.push(at);
    prev = at;
  }
  const out: VoiceWindow[] = [];
  runs.forEach((run, r) => {
    if (run.who < 0) return;
    const start = r === 0 ? 0 : switches[r - 1];
    const end = r === runs.length - 1 ? total : switches[r];
    if (end - start > 0.25) out.push({ who: run.who, start, end });
  });
  return out;
}

const num = (x: number): string => (Math.round(x * 1000) / 1000).toString();

/** The ffmpeg volume expression that is 1 inside these stretches and 0 outside, with a straight ramp
 *  `fade` seconds long centred on each edge. Two takes of the same song faded this way against each
 *  other always add up to one song: the music under the voices never dips or doubles. An edge at the very
 *  start or end of the song has no ramp. "0" when there is nothing to hear. */
export function envelopeExpr(windows: Array<{ start: number; end: number }>, total: number, fade = 0.12): string {
  const ws = (windows || []).filter((w) => w && w.end > w.start);
  if (!ws.length) return "0";
  const f = Math.max(0.02, fade);
  const parts = ws.map((w) => {
    const rise = w.start <= 0.001 ? "" : `clip((t-${num(w.start - f / 2)})/${num(f)},0,1)`;
    const fall = w.end >= total - 0.001 ? "" : `clip((${num(w.end + f / 2)}-t)/${num(f)},0,1)`;
    return rise && fall ? `${rise}*${fall}` : rise || fall || "1";
  });
  return parts.length === 1 ? parts[0] : `min(1,${parts.join("+")})`;
}

/** The whole mix: input 0 is the lead's take of the song, inputs 1… the co-stars' takes (`voices[k]` =
 *  the stretches co-star take k is heard in). Every take is brought to one format, faded by its
 *  envelope, and summed — the lead's envelope is whatever the others leave. Ends in [a]. */
export function featureMixFilter(voices: Array<Array<{ start: number; end: number }>>, total: number, fade = 0.12): string {
  const exprs = voices.map((w) => envelopeExpr(w, total, fade));
  const lead = `max(0,1-(${exprs.join("+") || "0"}))`;
  // small audio frames, so a ramp a tenth of a second long is a ramp and not three steps
  const prep = "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,asetnsamples=n=256:p=0";
  const f: string[] = [`[0:a]${prep},volume='${lead}':eval=frame[m0]`];
  exprs.forEach((e, k) => f.push(`[${k + 1}:a]${prep},volume='${e}':eval=frame[m${k + 1}]`));
  f.push(`${exprs.map((_, k) => `[m${k}]`).join("")}[m${exprs.length}]amix=inputs=${exprs.length + 1}:normalize=0:dropout_transition=0[a]`);
  return f.join(";");
}

/** How the re-voice should move the VOCAL (never the music) when the co-star is not the lead's sex: the
 *  song was sung in the lead's range, and a woman's voice an octave down — or a man's an octave up — is
 *  not their voice. An octave keeps the song in key. */
export function pitchChangeFor(lead: "m" | "f" | undefined, featured: "m" | "f" | undefined): "no-change" | "male-to-female" | "female-to-male" {
  if (!lead || !featured || lead === featured) return "no-change";
  return lead === "m" ? "male-to-female" : "female-to-male";
}

/** How far take `b` runs BEHIND take `a` of the same song, in seconds (negative = ahead): the shift at
 *  which they line up best. The re-voice hands back the same song, but re-encoded, and an encoder may add
 *  a few hundredths of a second at the front — enough to hear as a flutter while two takes are faded
 *  across each other. Both are mono samples at `sr` Hz; looks `maxLag` seconds either way. 0 when there
 *  is too little to compare or nothing lines up. */
export function bestLag(a: Float32Array, b: Float32Array, sr: number, maxLag = 0.25): number {
  const n = Math.min(a.length, b.length);
  const L = Math.round(maxLag * sr);
  if (!(sr > 0) || n < L * 4 || L < 1) return 0;
  let best = 0, bestScore = -Infinity, zero = 0;
  for (let lag = -L; lag <= L; lag++) {
    let s = 0;
    const from = Math.max(0, -lag), to = Math.min(n, n - lag);
    for (let i = from; i < to; i++) s += a[i] * b[i + lag];
    s /= Math.max(1, to - from);
    if (lag === 0) zero = s;
    if (s > bestScore) { bestScore = s; best = lag; }
  }
  // only a clear winner moves anything: an ambiguous match leaves the take where it was
  if (!(bestScore > 0) || bestScore < zero * 1.02) return 0;
  return best / sr;
}

/** The featured co-stars of a video, from its scenes: who sings at least one scene, in cast order. */
export function featuredIn(singers: Who[]): Who[] {
  return Array.from(new Set(singers.filter((w) => Number.isInteger(w) && w >= 0))).sort((x, y) => x - y);
}

/** The roles of a video that has a featured verse. A co-star with a verse must be SEEN singing it, so
 *  there have to be two performances — and, where the video is long enough, a cut scene between them for
 *  the voice to change in. Five scenes and up already are that (the director's cadence, passed in); a
 *  shorter video is dealt its own: two scenes = the artist's performance, then the co-star's; three or
 *  four = performance, cut scene, performance(, cut scene). */
export function featureRoles(cadence: ShotRole[]): ShotRole[] {
  const n = cadence.length;
  if (n >= 5 && cadence.filter((r) => r === "perform").length >= 2) return cadence.slice();
  if (n <= 1) return cadence.slice();
  if (n === 2) return ["perform", "perform"];
  return Array.from({ length: n }, (_, i) => (i % 2 === 0 ? "perform" : "broll")) as ShotRole[];
}

/** WHO SINGS EACH SCENE when the writer was asked for a featured verse and did not mark one (or marked
 *  one nobody is seen singing): give each featured co-star a verse ourselves. The artist opens. Each
 *  co-star takes one performance that is not the artist's first — the nearest to the middle of the song
 *  first — and the cut scene after it; everything else is the artist's. `roles` should already be
 *  featureRoles(). All the artist's (-1) when the video is too short to share. */
export function defaultFeaturePlan(roles: ShotRole[], D: number, featured: Who[]): Who[] {
  const n = roles.length;
  const plan: Who[] = Array.from({ length: n }, () => ARTIST);
  if (n < 2 || n * D < FEATURE_MIN_SECONDS || !featured.length) return plan;
  const first = roles.findIndex((r) => r === "perform");
  const free = roles.map((r, i) => (r === "perform" && i !== first ? i : -1)).filter((i) => i >= 0);
  const mid = (n - 1) / 2;
  for (const who of featured) {
    if (!free.length) break;
    free.sort((x, y) => Math.abs(x - mid) - Math.abs(y - mid) || x - y);
    const mine = free.shift() as number;
    plan[mine] = who;
    if (mine + 1 < n && roles[mine + 1] === "broll" && plan[mine + 1] === ARTIST) plan[mine + 1] = who;
  }
  return plan;
}

/** Is a plan of who-sings-what worth making? A co-star's verse only counts if they have a PERFORMANCE in
 *  it (else they are heard and never seen), and the artist must keep a performance too. */
export function planIsSound(singers: Who[], roles: ShotRole[]): boolean {
  const feat = featuredIn(singers);
  if (!feat.length) return false;
  const seen = (w: Who) => singers.some((s, i) => s === w && roles[i] === "perform");
  return feat.every(seen) && singers.some((s, i) => (s < 0 || !Number.isInteger(s)) && roles[i] === "perform");
}
