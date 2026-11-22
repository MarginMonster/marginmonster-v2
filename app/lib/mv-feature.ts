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
 *   - the takes are CROSS-FADED: the co-star's is heard while the co-star is SEEN singing — their own
 *     performance shot — and the lead's everywhere else, cut scenes included. The switch sits on the cut
 *     into and out of their shot, nudged to a breath between words when one is close by;
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

/** Every place one sung word ends and the next begins — where a voice can change without splitting a
 *  word when there is no real breath close enough. */
export const wordJoins = (words: Array<{ start: number; end: number }>): Gap[] => vocalGaps(words, 0);

/** How far from a cut the hand-over may move to land in a breath (seconds) — on the side of the cut
 *  where NOBODY is seen singing. On a side where someone is, it may only move a hair. */
export const HANDOVER_REACH = 0.45;
const HANDOVER_HAIR = 0.12;

/** WHEN each co-star's voice is heard: while they are SEEN singing, and at no other time.
 *
 *  `singers[i]` is who sings scene i (the plan, or the maker's pick), `roles[i]` whether that scene is a
 *  performance, `D` the length of a scene. A co-star's voice is their PERFORMANCE shots — every cut scene
 *  is the artist's voice, whoever's verse it sits in. The voice changes at the cut into and out of their
 *  shot, moved to a breath when there is one within HANDOVER_REACH on the cut-scene side (so one singer
 *  does not hand over mid-word) and never further — and no more than a hair into a shot where the OTHER
 *  singer is seen singing. With no breath in reach it moves to the nearest place BETWEEN two words
 *  (`joins`) inside that same reach: a line may be shared, a word is not split between two voices.
 *
 *  It used to be wider: the voice changed anywhere in the cut scenes between the two singers'
 *  performances, aimed at where the co-star's written lines were sung, and the cut scene after their
 *  performance was theirs too. On a real song that ran a little behind its scenes, with few breaths in
 *  it, a co-star's voice came in at 11.7 s and went out at 27.8 s of a 30-second video — sixteen seconds,
 *  of which she was on screen singing for under five. For the rest the picture was the ARTIST, on a car
 *  and walking, his mouth moving: the owner's "the male singing some of the female lines" (2026-11-22).
 *  You hear a singer when you see them sing. */
export function voiceWindows(o: {
  singers: Who[]; roles: ShotRole[]; D: number; gaps?: Gap[];
  /** every boundary between two sung words (wordJoins) — the fallback when no breath is in reach */
  joins?: Gap[];
  /** WHEN each scene's own clip is really on screen (mv-pace.ts shotTimes) — a paced edit moves its cuts
   *  onto the beat, so a performance dealt 15–20 s may run 15.0–19.75. Without it a scene is its slot. */
  shots?: Array<{ start: number; end: number } | null | undefined>;
}): VoiceWindow[] {
  const n = Math.min(o.singers.length, o.roles.length);
  const D = o.D;
  if (!n || !(D > 0)) return [];
  const total = n * D;
  const performs = (i: number): boolean => i >= 0 && i < n && o.roles[i] === "perform";
  // whose voice each scene is: a co-star's only in a performance that is theirs
  const voice: Who[] = Array.from({ length: n }, (_, i) => (performs(i) && Number.isInteger(o.singers[i]) && o.singers[i] >= 0 ? o.singers[i] : ARTIST));
  const tidy = (l?: Gap[]): Gap[] => (l || []).filter((g) => g && Number.isFinite(g.t)).sort((a, b) => a.t - b.t);
  const gaps = tidy(o.gaps), joins = tidy(o.joins);
  const shotOf = (i: number): { start: number; end: number } => {
    const s = o.shots ? o.shots[i] : null;
    return s && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start ? { start: Math.max(0, s.start), end: Math.min(total, s.end) } : { start: i * D, end: (i + 1) * D };
  };
  const nearest = (list: Gap[], cut: number, lo: number, hi: number): number => {
    let best = -1;
    for (const g of list) {
      if (g.t < lo || g.t > hi) continue;
      if (best < 0 || Math.abs(g.t - cut) < Math.abs(best - cut)) best = g.t;
    }
    return best;
  };
  /** the breath nearest a cut, no further from it than [lo, hi] — else the nearest place between two
   *  words in that reach — else the cut itself */
  const nearBreath = (cut: number, lo: number, hi: number): number => {
    const breath = nearest(gaps, cut, lo, hi);
    if (breath >= 0) return breath;
    const join = nearest(joins, cut, lo, hi);
    return join >= 0 ? join : cut;
  };
  const out: VoiceWindow[] = [];
  for (let i = 0; i < n; i++) {
    if (voice[i] < 0) continue;
    let j = i;
    while (j + 1 < n && voice[j + 1] === voice[i]) j++;
    // their shot(s), from the cut in to the cut out — a hair inside it at most (their mouth is on
    // screen), and outside it only as far as a breath close by, less still if the shot next door is
    // somebody else singing
    const a = shotOf(i).start, b = shotOf(j).end;
    const start = a <= 0.05 ? 0 : nearBreath(a, Math.max(0.05, a - (performs(i - 1) ? HANDOVER_HAIR : HANDOVER_REACH)), a + HANDOVER_HAIR);
    const end = b >= total - 0.05 ? total : nearBreath(b, b - HANDOVER_HAIR, Math.min(total - 0.05, b + (performs(j + 1) ? HANDOVER_HAIR : HANDOVER_REACH)));
    if (end - start > 0.25) out.push({ who: voice[i], start, end });
    i = j;
  }
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

/* ---- which octave the co-star sings in ----
 * The re-voice keeps whatever pitch the song was sung at, and can move the VOCAL (never the music) by an
 * octave — an octave keeps the song in key. The first cut of this moved it by the two singers' sexes: a
 * woman's verse on a man's song went UP an octave. Then the songs were measured (2026-11-22, six finished
 * videos): the music engine's lead sits at about 250–280 Hz WHATEVER its sex — a tenor's range, and a
 * comfortable one for a woman. An octave up from there is over 500 Hz. So the octave is chosen from where
 * the song actually is and where the co-star's voice naturally sits: it moves only when that is clearly
 * the better fit. */

/** Where a sung voice is comfortable, by the singer's sex (Hz — the middle of an everyday pop range). */
export const SING_CENTRE: Record<"m" | "f", number> = { f: 290, m: 165 };
/** Where the music engine's lead vocal has sat when measured (see above) — the stand-in when a song's
 *  own pitch cannot be read. */
export const TYPICAL_LEAD_HZ = 265;

/** A move must be better than staying by this much (in octaves) — a near-tie never moves the verse. Small
 *  enough that a man's verse comes down across the whole range the engine's leads were measured at
 *  (247–281 Hz), so two songs a few hertz apart are not treated differently. */
export const OCTAVE_MARGIN = 0.1;

/** How far to move the co-star's VOCAL, in semitones: -12, 0 or +12. `leadHz` is where the song's vocal
 *  sits (null = could not be read). The verse stays where the song is unless an octave away is closer to
 *  the singer's own range by OCTAVE_MARGIN. */
export function octaveShiftFor(leadHz: number | null | undefined, singer: "m" | "f" | undefined): -12 | 0 | 12 {
  if (singer !== "m" && singer !== "f") return 0;
  const f = leadHz && leadHz > 60 && leadHz < 900 ? leadHz : TYPICAL_LEAD_HZ;
  const off = (s: number): number => Math.abs(Math.log2((f * Math.pow(2, s / 12)) / SING_CENTRE[singer]));
  const down = off(-12), stay = off(0), up = off(12);
  if (down < up) return stay - down > OCTAVE_MARGIN ? -12 : 0;
  return stay - up > OCTAVE_MARGIN ? 12 : 0;
}

/** That move, in the words the re-voice model takes (its two settings are simply an octave up and an
 *  octave down, whoever is singing). */
export const pitchChangeOf = (shift: number): "no-change" | "male-to-female" | "female-to-male" => (shift > 0 ? "male-to-female" : shift < 0 ? "female-to-male" : "no-change");

/** HOW LOUD the co-star's vocal is asked for, against the re-voice model's own setting (dB).
 *
 *  The re-voice hands back the song with its vocal further FORWARD than it was. Measured 2026-11-22, each
 *  song split into its vocal and its music before and after: a custom-trained voice on a pop song — vocal
 *  5.6 dB down, music 7.4 dB down; the model's stand-in voice on a rap song — vocal 2.7 down, music 4.3
 *  down. Either way the vocal comes back 1.6–1.8 dB hotter against the music than the song had it. Once
 *  the take is brought back to the song's level, a co-star's verse is that much louder than the lead's
 *  either side of it (the first live featured verse: the guest about 2 dB over the lead where she handed
 *  back). Asked for 1.7 dB lower, the take came back with the song's own balance to 0.2 dB (vocal against
 *  music +1.0 dB, the song +0.8) — so across a hand-over neither the voice nor the music changes level.
 *  Only a featured take is asked for this way: a video sung whole in one voice has no other voice to be
 *  level with, and keeps the balance it was approved at. */
export const FEATURE_VOCAL_TRIM_DB = -1.7;

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

/** WHO SINGS EACH SCENE of a video with a featured verse. The artist opens. Each featured co-star takes
 *  one PERFORMANCE that is not the artist's first — the nearest to the middle of the song first — and
 *  everything else is the artist's. `roles` should already be featureRoles(). All the artist's (-1) when
 *  the video is too short to share.
 *  (The cut scene after their performance used to be dealt to them as well. A cut scene shows whoever it
 *  shows — usually the artist — so their voice played over somebody else's face: see voiceWindows.) */
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
    plan[free.shift() as number] = who;
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
