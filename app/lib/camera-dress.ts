/* THE CAMERA A FOUND-FOOTAGE TAKE WAS "SHOT ON".
 *
 * The owner, 2026-11-24: "Would be cool to also get a \"found Footage\" style pipeline, that would do blair
 * witch style creatives" — and then the brief:
 *   "For the found footage style there needs to be a crystal clear iPhone recording overlay ( phone layout
 *    9:16) and for the wider that could be cam corder style, or maybe it's selectable, with no actual overlay
 *    + found footage would need some slight shake to make it appear real, or graininess, idk experiment and
 *    run with it. You know what I want make it easymode and selectable good UI interface"
 *
 * So a finished take can be DRESSED as one of three cameras, and which one is the maker's pick:
 *
 *   phone      a phone's own recording screen, drawn sharp over a clean picture: the red timer counting
 *              up, the zoom dots, the stop button. A hand holds it — it sways a little. No grain: a phone
 *              in 2026 is crystal clear, and the overlay is what says "somebody filmed this".
 *   camcorder  a tape camcorder: REC with its blinking dot, the battery, the tape counter, the date burned
 *              into the corner; soft, grainy, the colours slipping a little, faint scan lines. It sways more.
 *   bare       no overlay at all — only the hand (the sway) and the grain. For when the picture should not
 *              explain itself.
 *
 * HOW. One ffmpeg filter graph per look, built here as plain text: the picture is enlarged by a small
 * margin, turned and slid inside that margin by a few slow sines that never line up (a hand, not a
 * machine), graded, and then the camera's own marks are drawn on top — every mark is drawn by ffmpeg
 * itself (boxes, discs made with geq, text), so there is no picture file to ship and nothing to go soft
 * when the frame is another size. Everything is sized from the frame's own width.
 *
 * Pure: no ffmpeg is run here (tests/camera-dress.test.ts reads the graphs; the looks themselves were
 * LOOKED at, frame by frame, on a real take — scratchpad t45/camera/). */

export type CameraLook = "phone" | "camcorder" | "bare" | "house" | "bodycam";

export const CAMERA_LOOKS: ReadonlyArray<{ key: CameraLook; name: string; line: string }> = [
  { key: "phone", name: "Phone", line: "A phone's recording screen over a clear picture." },
  { key: "camcorder", name: "Camcorder", line: "Tape: REC, the date in the corner, grain." },
  { key: "bare", name: "No overlay", line: "Only a shaky hand and a little grain." },
  { key: "house", name: "House camera", line: "A camera high in the corner, its clock running." },
  { key: "bodycam", name: "Body cam", line: "Worn on a chest: it bobs with every step." },
];

export const cameraLookOf = (v: unknown): CameraLook | null => {
  const k = String(v ?? "").trim().toLowerCase();
  return k === "phone" || k === "camcorder" || k === "bare" || k === "house" || k === "bodycam" ? k : null;
};

/** What every body-cam piece says it is, in its corner (see the body cam in dressFilter). */
export const BODYCAM_MARK = "AI DRAMATIZATION";

/** THE CHEST. A body camera is worn, not held: the picture rises and drops with every step (twice a stride,
 *  at a walking cadence) and rolls a little from side to side once a stride. Like the hand (handheld), the
 *  picture is enlarged by a margin and a window of the original size moves inside it, so the frame's edge
 *  never shows. */
export function chestBob(w: number, h: number): string {
  const margin = 0.035;
  const W = even(w * (1 + 2 * margin)), H = even(h * (1 + 2 * margin));
  const sx = (w * margin * 0.35).toFixed(2), sy = (h * margin * 0.8).toFixed(2);
  // (|sin| gives the step's drop-and-rise at 1.85 steps a second; a slower sway rides on it)
  const X = `(iw-ow)/2+${sx}*(sin(2*PI*0.925*t)+0.3*sin(2*PI*2.3*t+0.6))/1.3`;
  const Y = `(ih-oh)/2+${sy}*(abs(sin(PI*1.85*t))-0.5+0.25*sin(2*PI*0.41*t+1.1))/1.25`;
  return [
    `scale=${W}:${H}:flags=bicubic`,
    `rotate=a='0.006*sin(2*PI*0.925*t+0.4)':fillcolor=black`,
    `crop=${even(w)}:${even(h)}:x='${X}':y='${Y}'`,
  ].join(",");
}

/* ---- THE HOUSE CAMERA'S CLOCK ----
 * The owner, 2026-11-24: "Found footage from house camera POVs also" — "Like this overlay" (a home security
 * camera: a fixed, high, wide view of a room, the date and time burned into its top-left corner in a blocky
 * white face with a dark edge) — and: "Need designated editing tools for found footage (like time lapse) hours
 * go by on the counter in seconds and the creepy hero stands over someone sleeping … if we put it as a scene
 * setting it would maximize easiness". So the clock is the camera's own, and a TIME-LAPSE is a setting, not a
 * prompt: the first part of the take is played fast while its clock races through the hours, then the take
 * drops to real time — and the clock with it. */

/** The weekday a camera prints after its date (MON … SUN). */
export const CAM_DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

export type HouseClock = {
  /** the date as the camera prints it, e.g. "2026-11-16 MON" */
  date: string;
  /** the time on the clock when the take starts, in seconds after midnight */
  start: number;
};
/** A TIME-LAPSE: `fast` seconds of the take, starting `from` seconds in (0 when unset), are played `speed`
 *  times faster, and while they are, the clock races through `hours` hours; before and after, real time.
 *  (The owner, on a take where the thing appeared DURING the fast part: "he needs to walk into the room no
 *  time lapse, then time lapse, it appeared that he just spawned in instead of it being genuinely cinematic"
 *  — so the fast part can come after the thing has arrived: it walks in at real time, THEN the hours go by
 *  while it stands there.) */
export type TimeLapse = { fast: number; speed: number; hours: number; from?: number };

/** The date a camera prints for a day (the weekday is the day's own). */
export function camDate(y: number, m: number, d: number): string {
  const day = CAM_DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")} ${day}`;
}

/** A time-lapse as it can safely be played: at least one second of the take stays fast, at least two stay
 *  real time, the speed is 2–24× and the clock passes between a minute and twelve hours. Null when there is
 *  not enough take for both parts. */
export function timeLapseOf(t: Partial<TimeLapse> | null | undefined, takeSeconds: number): TimeLapse | null {
  if (!t) return null;
  const fast = Number(t.fast), speed = Number(t.speed), hours = Number(t.hours);
  const from = Math.max(0, Number(t.from) || 0);
  // (the fast part must fit inside the take, and at least two seconds of it must stay real time)
  if (!(fast >= 1) || !(takeSeconds - from - fast >= 0) || !(takeSeconds - fast >= 2)) return null;
  return {
    fast: Math.round(fast * 100) / 100,
    speed: Math.max(2, Math.min(24, Number.isFinite(speed) ? speed : 8)),
    hours: Math.max(1 / 60, Math.min(12, Number.isFinite(hours) ? hours : 2)),
    ...(from > 0 ? { from: Math.round(from * 100) / 100 } : {}),
  };
}

/** The clock's seconds after midnight at the dressed take's time `t`, as an ffmpeg expression (and the same
 *  sum as a number, for tests): real time; or, in a time-lapse, racing while the fast part is being played. */
export function clockExpr(clock: HouseClock, lapse: TimeLapse | null): string {
  const s0 = Math.max(0, Math.round(clock.start));
  if (!lapse) return `(${s0}+t)`;
  const shown = lapse.fast / lapse.speed;                  // how long the fast part lasts once it is played fast
  const rate = (lapse.hours * 3600) / shown;               // clock seconds for every second shown
  const from = lapse.from || 0;
  if (!from) return `(${s0}+if(lt(t,${shown.toFixed(4)}),t*${rate.toFixed(3)},${(shown * rate).toFixed(3)}+t-${shown.toFixed(4)}))`;
  const end = from + shown;
  return `(${s0}+if(lt(t,${from.toFixed(4)}),t,if(lt(t,${end.toFixed(4)}),${from.toFixed(4)}+(t-${from.toFixed(4)})*${rate.toFixed(3)},${(from + shown * rate).toFixed(3)}+t-${end.toFixed(4)})))`;
}
export function clockAt(clock: HouseClock, lapse: TimeLapse | null, t: number): number {
  const s0 = Math.max(0, Math.round(clock.start));
  if (!lapse) return s0 + t;
  const shown = lapse.fast / lapse.speed, rate = (lapse.hours * 3600) / shown, from = lapse.from || 0;
  if (t < from) return s0 + t;
  if (t < from + shown) return s0 + from + (t - from) * rate;
  return s0 + from + shown * rate + (t - from - shown);
}
/** "HH:MM:SS" for seconds after midnight (a clock that passes midnight starts the day again). */
export const clockText = (secs: number): string => {
  const s = ((Math.floor(secs) % 86400) + 86400) % 86400;
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":");
};

/** A path as an ffmpeg FILTER wants it: forward slashes, and the drive's colon escaped. */
export const filterPath = (p: string): string => p.replace(/\\/g, "/").replace(/:/g, "\\:");

const r = (n: number) => Math.round(n);
/** even, so a crop or a scale never lands on a half pixel of chroma */
const even = (n: number) => Math.max(2, 2 * Math.round(n / 2));

/** THE HAND. The picture is enlarged by `margin` (a share of its size) and a window of the original size is
 *  moved inside it. Each axis is three sines whose periods share no factor, so the path does not repeat
 *  within any take; a small turn goes with it. `amount` 1 = a steady hand, 2 = somebody walking. */
export function handheld(w: number, h: number, amount: number): string {
  const a = Math.max(0, Math.min(3, amount));
  const margin = 0.02 + 0.012 * a;                      // 3.2% … 5.6% of the frame all round
  const W = even(w * (1 + 2 * margin)), H = even(h * (1 + 2 * margin));
  const sx = (w * margin * 0.62).toFixed(2), sy = (h * margin * 0.62).toFixed(2);
  const turn = (0.0022 * a).toFixed(4);                 // radians: a degree-ish at most
  const X = `(iw-ow)/2+${sx}*(sin(2*PI*0.31*t)+0.55*sin(2*PI*0.83*t+1.3)+0.3*sin(2*PI*2.17*t+0.4))/1.85`;
  const Y = `(ih-oh)/2+${sy}*(sin(2*PI*0.27*t+0.7)+0.5*sin(2*PI*0.97*t+2.1)+0.35*sin(2*PI*2.61*t+1.1))/1.85`;
  return [
    `scale=${W}:${H}:flags=bicubic`,
    `rotate=a='${turn}*(sin(2*PI*0.23*t+0.5)+0.6*sin(2*PI*0.71*t+1.9))':fillcolor=black`,
    `crop=${even(w)}:${even(h)}:x='${X}':y='${Y}'`,
  ].join(",");
}

/** A filled disc as a little picture of its own (for overlaying): a square source with an alpha that is
 *  255 inside the circle, feathered over one pixel. */
const disc = (d: number, rgb: [number, number, number], alpha = 255) =>
  `color=c=black@0:s=${d}x${d}:r=30,format=rgba,geq=r=${rgb[0]}:g=${rgb[1]}:b=${rgb[2]}:a='${alpha}*clip(${d / 2}-hypot(X-${d / 2}+0.5,Y-${d / 2}+0.5),0,1)'`;
/** A ring (a disc with a hole). */
const ring = (d: number, t: number, rgb: [number, number, number]) =>
  `color=c=black@0:s=${d}x${d}:r=30,format=rgba,geq=r=${rgb[0]}:g=${rgb[1]}:b=${rgb[2]}:a='255*clip(${d / 2}-hypot(X-${d / 2}+0.5,Y-${d / 2}+0.5),0,1)*clip(hypot(X-${d / 2}+0.5,Y-${d / 2}+0.5)-${d / 2 - t},0,1)'`;
/** A rounded rectangle. */
const pill = (w: number, h: number, rad: number, rgb: [number, number, number], alpha = 255) =>
  `color=c=black@0:s=${w}x${h}:r=30,format=rgba,geq=r=${rgb[0]}:g=${rgb[1]}:b=${rgb[2]}:a='${alpha}*clip(${rad}-hypot(max(abs(X-${w / 2}+0.5)-${w / 2 - rad},0),max(abs(Y-${h / 2}+0.5)-${h / 2 - rad},0)),0,1)'`;

export type DressOptions = {
  look: CameraLook;
  w: number;
  h: number;
  /** a font file ffmpeg can open (the app's own bold face) */
  font: string;
  /** …and, for the phone's screen, a regular-weight face and a monospaced one (a phone's camera sets its
   *  labels light and its numbers in fixed-width figures). Each falls back to the one before it. */
  fontThin?: string;
  fontMono?: string;
  /** what a camcorder burns into the corner — the day and the hour the take says it was shot */
  stamp?: { date: string; time: string };
  /** 0…3: how unsteady the hand is. Unset = the look's own (phone 1, camcorder 1.6, bare 1.4). */
  shake?: number;
  /** THE HOUSE CAMERA: its clock (unset: a night in November, 03:12:00) … */
  clock?: HouseClock;
  /** …a time-lapse, when the scene is one (house camera only) … */
  timelapse?: TimeLapse | null;
  /** …the length of the take in seconds (needed for a time-lapse) … */
  seconds?: number;
  /** …the camera's own name in the corner (e.g. "CAM 2"), when there is more than one … */
  camName?: string;
  /** …and night vision: the picture in the camera's infrared grey. */
  ir?: boolean;
};

export type Dress = {
  /** THE CHROME, when the look has one: a graph that draws every mark that does not move onto ONE clear
   *  frame and writes [c] — render it once to a PNG (ffmpeg -filter_complex <chrome> -map "[c]" -frames:v 1),
   *  and give that PNG to the main graph as its second input. */
  chrome?: string;
  /** an ffmpeg -filter_complex graph: reads [0:v] (and [1:v], the chrome, when there is one), writes [v] */
  filter: string;
  /** an -af chain for the take's sound, or null to leave it as it is */
  audio: string | null;
  /** true when the graph itself writes the sound as [a] (a time-lapse re-times the sound with the picture):
   *  the caller maps "[a]" instead of the take's own sound, and passes no -af. */
  audioInGraph?: boolean;
};

/** The graph that dresses a take as one camera. */
export function dressFilter(o: DressOptions): Dress {
  const w = even(o.w), h = even(o.h);
  const u = w / 1080;                                   // every mark is sized from the frame's width
  const font = filterPath(o.font);
  const tall = h >= w;
  const text = (s: string, size: number, x: string, y: string, color = "white", extra = "") =>
    `drawtext=fontfile='${font}':text='${s}':fontsize=${r(size)}:fontcolor=${color}:x=${x}:y=${y}${extra}`;

  if (o.look === "bodycam") {
    // THE BODY CAM (the owner, 2026-11-24: "What about body cam footage police shot channel"). Worn on a
    // chest: it bobs with every step (chestBob); a small, hard sensor — over-sharpened, a little washed, noisy
    // in the dark; thirty frames a second; and in its top-right corner the date with a T before the time and
    // the zone after it, and under it the camera's own number. A generic camera on purpose: no maker's name
    // or mark is drawn.
    const clock = o.clock || { date: camDate(2026, 11, 24).slice(0, 10), start: 3 * 3600 + 12 * 60 + 44 };
    const day = clock.date.slice(0, 10).replace(/:/g, "");
    const mono = filterPath(o.fontMono || o.font);
    const fsz = r(0.025 * w), m = r(0.022 * w), edge = Math.max(2, r(fsz / 12));
    const C = clockExpr(clock, null);
    const part = (e: string) => `%{eif\\:${e}\\:d\\:2}`;
    const time = [part(`mod(floor(${C}/3600),24)`), part(`mod(floor(${C}/60),60)`), part(`mod(floor(${C}),60)`)].join("\\:");
    const face = `fontfile='${mono}':fontcolor=white:borderw=${edge}:bordercolor=0x0A0A0A`;
    const unit = (o.camName || "BODYCAM 412").replace(/['\\%:]/g, "").slice(0, 28);
    // THE MARK. Realistic police footage that is not real gets taken for real — and the platforms strike
    // realistic AI video posted without a label. So every body-cam piece carries, small in its bottom-left
    // corner, what it is. (The owner asked for traffic stops and arrests, not only horror: this is the line
    // that keeps those honest.)
    const mark = `drawtext=${face}:fontsize=${r(fsz * 0.62)}:fontcolor=white@0.72:x=${m}:y=h-th-${m}:expansion=none:text='${BODYCAM_MARK}'`;
    const look = [
      chestBob(w, h),
      "unsharp=5:5:0.9:5:5:0",
      "eq=contrast=1.1:saturation=0.82:gamma=0.97",
      "noise=alls=10:allf=t",
      "fps=30",
      `drawtext=${face}:fontsize=${fsz}:x=w-tw-${m}:y=${m}:text='${day} T${time} -0500'`,
      `drawtext=${face}:fontsize=${fsz}:x=w-tw-${m}:y=${m + r(fsz * 1.3)}:expansion=none:text='${unit}'`,
      mark,
    ].join(",");
    // a body camera's microphone: close, thin and a little crunchy
    return { filter: `[0:v]${look},format=yuv420p[v]`, audio: "highpass=f=220,lowpass=f=6000,acompressor=threshold=-22dB:ratio=4:attack=5:release=120" };
  }

  if (o.look === "house") {
    // THE HOUSE CAMERA. Nobody holds it: no sway, no hand. It records at a camera's own low frame rate (the
    // motion steps a little), its picture is a little soft and noisy, and its clock is burned into the top-left
    // corner the way the owner's reference shows it — a blocky white face with a dark edge, the date, the
    // weekday and the time — counting, or racing through the hours in a time-lapse.
    const lapse = timeLapseOf(o.timelapse, Number(o.seconds) || 0);
    const clock = o.clock || { date: camDate(2026, 11, 16), start: 3 * 3600 + 12 * 60 };
    const mono = filterPath(o.fontMono || o.font);
    const fsz = r(0.031 * w), m = r(0.019 * w), edge = Math.max(2, r(fsz / 14));
    const C = clockExpr(clock, lapse);
    // (the time is three numbers worked out from the clock, each two digits; the colons between them are the
    //  camera's own. Separators inside %{…} and every literal colon are escaped for the filter's own parser.)
    const part = (e: string) => `%{eif\\:${e}\\:d\\:2}`;
    const time = [part(`mod(floor(${C}/3600),24)`), part(`mod(floor(${C}/60),60)`), part(`mod(floor(${C}),60)`)].join("\\:");
    const face = `fontfile='${mono}':fontcolor=white:borderw=${edge}:bordercolor=0x101010`;
    const stamp = `drawtext=${face}:fontsize=${fsz}:x=${m}:y=${r(m * 1.15)}:text='${clock.date.replace(/'/g, "").replace(/:/g, "\\:")} ${time}'`;
    const name = o.camName ? `,drawtext=${face}:fontsize=${r(fsz * 0.78)}:x=${m}:y=h-th-${r(m * 1.15)}:expansion=none:text='${o.camName.replace(/['\\%:]/g, "").slice(0, 24)}'` : "";
    const look = [
      // the camera's own picture: a little soft, a little noise that moves, its stepped frame rate
      `gblur=sigma=${(0.55 * Math.max(1, u)).toFixed(2)}`,
      ...(o.ir ? ["hue=s=0", "eq=contrast=1.08:brightness=0.02"] : ["eq=contrast=1.03:saturation=0.9"]),
      "noise=alls=7:allf=t",
      "fps=15",
    ].join(",");
    if (!lapse) {
      return { filter: `[0:v]${look},${stamp}${name},format=yuv420p[v]`, audio: null };
    }
    // THE TIME-LAPSE: part of the take played fast (its sound dropped — a camera's time-lapse is silent), the
    // rest at real time with its own sound, joined at the cuts.
    const shown = lapse.fast / lapse.speed;
    const from = lapse.from || 0;
    if (from > 0) {
      // real time first (the thing walks in), THEN the hours go by, then real time again
      const to = from + lapse.fast;
      const fmt = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";
      return {
        filter: [
          `[0:v]split=3[tl0][tl1][tl2]`,
          `[tl0]trim=end=${from},setpts=PTS-STARTPTS[tla]`,
          `[tl1]trim=start=${from}:end=${to},setpts=(PTS-STARTPTS)/${lapse.speed}[tlf]`,
          `[tl2]trim=start=${to},setpts=PTS-STARTPTS[tlr]`,
          `[tla][tlf][tlr]concat=n=3:v=1:a=0,${look},${stamp}${name},format=yuv420p[v]`,
          `[0:a]${fmt},asplit=2[sa][sb]`,
          `[sa]atrim=end=${from},asetpts=PTS-STARTPTS[a1]`,
          `anullsrc=r=48000:cl=stereo,atrim=duration=${shown.toFixed(4)},${fmt},asetpts=PTS-STARTPTS[a2]`,
          `[sb]atrim=start=${to},asetpts=PTS-STARTPTS[a3]`,
          `[a1][a2][a3]concat=n=3:v=0:a=1[a]`,
        ].join(";"),
        audio: null,
        audioInGraph: true,
      };
    }
    const ms = Math.round(shown * 1000);
    return {
      filter: [
        `[0:v]split=2[tl0][tl1]`,
        `[tl0]trim=end=${lapse.fast},setpts=(PTS-STARTPTS)/${lapse.speed}[tlf]`,
        `[tl1]trim=start=${lapse.fast},setpts=PTS-STARTPTS[tlr]`,
        `[tlf][tlr]concat=n=2:v=1:a=0,${look},${stamp}${name},format=yuv420p[v]`,
        `[0:a]atrim=start=${lapse.fast},asetpts=PTS-STARTPTS,adelay=${ms}|${ms},apad=pad_dur=0.1[a]`,
      ].join(";"),
      audio: null,
      audioInGraph: true,
    };
  }

  if (o.look === "bare") {
    const hand = handheld(w, h, o.shake ?? 1.4);
    return {
      filter: `[0:v]${hand},noise=alls=9:allf=t,eq=contrast=1.04:saturation=0.94,format=yuv420p[v]`,
      audio: null,
    };
  }

  if (o.look === "camcorder") {
    const hand = handheld(w, h, o.shake ?? 1.6);
    const m = r(46 * u);                                // the marks' margin from the frame's edge
    const fs = r(40 * u);
    const dot = even(30 * u);
    const stamp = o.stamp || { date: "NOV 24 2026", time: "11\\:47 PM" };
    const date = stamp.date.replace(/:/g, "\\:"), time = stamp.time.replace(/(?<!\\):/g, "\\:");
    const shadow = `:shadowcolor=black@0.6:shadowx=${Math.max(1, r(2 * u))}:shadowy=${Math.max(1, r(2 * u))}`;
    // battery: an outline, three bars, a nub
    const bw = r(74 * u), bh = r(34 * u), bx = w - m - bw, by = m;
    const bt = Math.max(2, r(3 * u));
    const bars = [0, 1, 2].map((i) => `drawbox=x=${bx + bt * 2 + i * r(21 * u)}:y=${by + bt * 2}:w=${r(16 * u)}:h=${bh - bt * 4}:color=white@0.9:t=fill`).join(",");
    // viewfinder corners
    const cl = r(64 * u), ct = Math.max(2, r(4 * u)), ci = r(26 * u);
    const corner = (x: number, y: number, dx: number, dy: number) =>
      `drawbox=x=${dx > 0 ? x : x - cl}:y=${dy > 0 ? y : y - ct}:w=${cl}:h=${ct}:color=white@0.75:t=fill,drawbox=x=${dx > 0 ? x : x - ct}:y=${dy > 0 ? y : y - cl}:w=${ct}:h=${cl}:color=white@0.75:t=fill`;
    const look = [
      hand,
      // tape: a little soft, the colours slipping sideways, less of them, a faint line every few rows
      `gblur=sigma=${(0.7 * Math.max(1, u)).toFixed(2)}`,
      `chromashift=cbh=${r(3 * u)}:crh=${-r(3 * u)}`,
      "eq=saturation=0.82:contrast=1.07:gamma=0.96",
      "noise=alls=15:allf=t",
      `drawgrid=w=iw:h=${Math.max(3, r(4 * u))}:t=1:c=black@0.10`,
      "vignette=PI/5",
      // the marks
      corner(ci, ci, 1, 1), corner(w - ci, ci, -1, 1), corner(ci, h - ci, 1, -1), corner(w - ci, h - ci, -1, -1),
      text("REC", fs, `${m + dot + r(14 * u)}`, `${m - r(3 * u)}`, "white", shadow),
      `drawbox=x=${bx}:y=${by}:w=${bw}:h=${bh}:color=white@0.9:t=${bt}`,
      `drawbox=x=${bx + bw}:y=${by + r(bh * 0.28)}:w=${r(6 * u)}:h=${r(bh * 0.44)}:color=white@0.9:t=fill`,
      bars,
      // the tape counter runs; the date does not
      text(`SP  %{pts\\:gmtime\\:0\\:%H\\\\\\:%M\\\\\\:%S}`, fs * 0.9, `${m}`, `h-${m}-${r(fs * 0.9)}`, "white", shadow),
      text(date, fs * 0.9, `w-tw-${m}`, `h-${m}-${r(fs * 2.05)}`, "0xFFD27A", shadow),
      text(time, fs * 0.9, `w-tw-${m}`, `h-${m}-${r(fs * 0.9)}`, "0xFFD27A", shadow),
    ].join(",");
    // the REC dot blinks: on for 0.7 s of every 1.2
    return {
      filter: `[0:v]${look}[base];${disc(dot, [235, 38, 38])}[dot];[base][dot]overlay=x=${m}:y=${m + r(4 * u)}:enable='lt(mod(t,1.2),0.7)':shortest=1,format=yuv420p[v]`,
      // a small built-in microphone: no deep bass, no air
      audio: "highpass=f=170,lowpass=f=6800,acompressor=threshold=-20dB:ratio=3:attack=8:release=160",
    };
  }

  // PHONE — a phone's own camera screen, RECORDING. Laid out from a real one: the owner sent a screenshot of
  // his phone's camera beside ours (2026-11-24: "for reference here is the real iPhone video overlay and what
  // ours currently looks like"). What a real one has, and the first version did not: the picture is NOT the
  // whole screen — a black band stands above it and a taller one below, and the controls live in them; the
  // resolution pill (HD · 30) and the flash / more pill ride the picture's top corners; the zoom steps are
  // bare numbers with only the chosen one in a dot; the shutter is a soft ring, not a white line; and the
  // bottom band holds the last shot's thumbnail, VIDEO | PHOTO, and the flip button. Recording adds what
  // recording adds: the red time pill at the top, the red square in the ring.
  // Every length below is the reference screenshot's own, in pixels of its 924-px width.
  const s = w / 924;
  const thin = filterPath(o.fontThin || o.font), mono = filterPath(o.fontMono || o.fontThin || o.font);
  const px = (n: number) => r(n * s);
  const topH = even(125 * s), botH = even(190 * s);     // the bands (a 9:16 frame is shorter than a phone: a little less of each)
  const vh = even(h - topH - botH), vfB = topH + vh;    // the viewfinder, and its bottom edge
  const cy = r((h - vh) * 0.3);                         // the picture gives up more of its foot than of its head
  const hand = handheld(w, h, o.shake ?? 1);
  const pillH = even(75 * s), pillY = topH + px(35);
  const tlX = px(35), tlW = even(246 * s), trW = even(150 * s), trX = w - px(39) - trW;
  const tmW = even(190 * s), tmH = even(54 * s), tmY = r(topH * 0.62 - tmH / 2);
  const zoomY = vfB - px(317), zd = even(82 * s), zStep = px(85);
  const shY = vfB - px(120), ringD = even(172 * s), ringT = Math.max(4, px(9)), sq = even(62 * s);
  const ctlY = vfB + r(botH / 2), thD = even(104 * s), thX = px(125);
  const modeW = even(378 * s), modeH = even(100 * s), selW = even(190 * s), selH = even(86 * s), modeX = r((w - modeW) / 2);
  const flipD = even(104 * s), flipX = w - px(125), arcD = even(50 * s), arcT = Math.max(3, px(5));
  const boltW = even(26 * s), boltH = even(40 * s), gridW = even(40 * s), gridH = even(26 * s), dotD = even(12 * s);

  // a triangle's inside, as a geq alpha term (which side of each edge the third corner is on)
  const tri = (p: [number, number][]) => {
    const e = (a: [number, number], b: [number, number]) => `((X-${a[0]})*${b[1] - a[1]}-(Y-${a[1]})*${b[0] - a[0]})`;
    const sgn = ((p[2][0] - p[0][0]) * (p[1][1] - p[0][1]) - (p[2][1] - p[0][1]) * (p[1][0] - p[0][0])) >= 0 ? 1 : -1;
    return `gte(${sgn}*${e(p[0], p[1])},0)*gte(${sgn}*${e(p[1], p[2])},0)*gte(${sgn}*${e(p[2], p[0])},0)`;
  };
  const shape = (bw: number, bh: number, rgb: [number, number, number], alpha: string) =>
    `color=c=black@0:s=${bw}x${bh}:r=1:d=1,format=rgba,geq=r=${rgb[0]}:g=${rgb[1]}:b=${rgb[2]}:a='${alpha}'`;
  const one = (src: string) => src.replace(":r=30,", ":r=1:d=1,");   // the chrome is one still frame
  // the flash bolt: two triangles
  const bolt = shape(boltW, boltH, [255, 214, 10], `255*max(${tri([[boltW * 0.62, 0], [boltW * 0.12, boltH * 0.58], [boltW * 0.56, boltH * 0.58]])},${tri([[boltW * 0.44, boltH * 0.42], [boltW * 0.88, boltH * 0.42], [boltW * 0.38, boltH]])})`);
  // "more": six dots, three by two
  const dots: string[] = [];
  for (const gy of [0.25, 0.75]) for (const gx of [0.16, 0.5, 0.84]) dots.push(`clip(${(gridH * 0.2).toFixed(2)}-hypot(X-${(gridW * gx).toFixed(2)},Y-${(gridH * gy).toFixed(2)}),0,1)`);
  const grid = shape(gridW, gridH, [255, 255, 255], `255*${dots.reduce((a, b) => `max(${a},${b})`)}`);
  // "flip": a ring with two breaks
  const R = arcD / 2;
  const flip = shape(arcD, arcD, [255, 255, 255], `255*clip(${R}-hypot(X-${R}+0.5,Y-${R}+0.5),0,1)*clip(hypot(X-${R}+0.5,Y-${R}+0.5)-${R - arcT},0,1)*(1-clip(${(arcD * 0.2).toFixed(2)}-hypot(X-${(arcD * 0.86).toFixed(2)},Y-${(arcD * 0.2).toFixed(2)}),0,1))*(1-clip(${(arcD * 0.2).toFixed(2)}-hypot(X-${(arcD * 0.14).toFixed(2)},Y-${(arcD * 0.8).toFixed(2)}),0,1))`);
  // THE CHROME: every shape that does not move, drawn once onto a clear frame
  const layers: Array<[string, number, number]> = [
    [one(pill(tlW, pillH, pillH / 2, [44, 44, 46], 168)), tlX, pillY],
    [one(pill(trW, pillH, pillH / 2, [44, 44, 46], 168)), trX, pillY],
    [bolt, trX + px(30), pillY + r((pillH - boltH) / 2)],
    [grid, trX + trW - px(28) - gridW, pillY + r((pillH - gridH) / 2)],
    [one(pill(tmW, tmH, r(tmH * 0.28), [235, 69, 62])), r((w - tmW) / 2), tmY],
    [one(disc(zd, [28, 28, 30], 150)), r((w - zd) / 2), zoomY - zd / 2],
    [one(ring(ringD, ringT, [150, 150, 152])), r((w - ringD) / 2), shY - ringD / 2],
    [one(pill(sq, sq, r(sq * 0.24), [235, 69, 62])), r((w - sq) / 2), shY - sq / 2],
    [one(pill(modeW, modeH, modeH / 2, [28, 28, 30])), modeX, ctlY - modeH / 2],
    [one(pill(selW, selH, selH / 2, [48, 48, 51])), modeX + px(7), ctlY - selH / 2],
    [one(disc(flipD, [28, 28, 30])), flipX - flipD / 2, ctlY - flipD / 2],
    [flip, flipX - arcD / 2, ctlY - arcD / 2],
    // the little green light a phone shows while its camera is on
    [one(disc(even(12 * s), [48, 209, 88])), r(w * 0.766), r(topH * 0.14)],
  ];
  let chrome = `color=c=black@0:s=${w}x${h}:r=1:d=1,format=rgba[c0]`;
  layers.forEach(([src, x, y], i) => { chrome += `;${src}[l${i}];[c${i}][l${i}]overlay=x=${r(x)}:y=${r(y)}:format=auto[c${i + 1}]`; });
  chrome += `;[c${layers.length}]null[c]`;

  const tx = (font2: string, str: string, size: number, x: string, y: string, color = "white") =>
    `drawtext=fontfile='${font2}':text='${str}':fontsize=${r(size * s)}:fontcolor=${color}:x=${x}:y=${y}`;
  const mid = (cyy: number) => `${r(cyy)}-th/2`;
  const texts = [
    tx(mono, `%{pts\\:gmtime\\:0\\:%H\\\\\\:%M\\\\\\:%S}`, 31, "(w-tw)/2", mid(tmY + tmH / 2)),
    tx(thin, "HD", 34, `${tlX + px(24)}`, mid(pillY + pillH / 2 + px(2))),
    tx(thin, "RES", 15, `${tlX + px(75)}`, `${pillY + px(24)}`, "0xB4B4B8"),
    tx(thin, "30", 34, `${tlX + px(142)}`, mid(pillY + pillH / 2 + px(2))),
    tx(thin, "FPS", 15, `${tlX + px(184)}`, `${pillY + px(24)}`, "0xB4B4B8"),
    tx(mono, "0.5", 30, `(w-tw)/2-${zStep}`, mid(zoomY)),
    tx(mono, "1×", 30, "(w-tw)/2", mid(zoomY), "0xFFD60A"),
    tx(mono, "2.5", 30, `(w-tw)/2+${zStep}`, mid(zoomY)),
    tx(thin, "VIDEO", 27, `${modeX + px(7) + r(selW / 2)}-tw/2`, mid(ctlY), "0xFFD60A"),
    tx(thin, "PHOTO", 27, `${modeX + r((modeW + selW) / 2) + px(3)}-tw/2`, mid(ctlY)),
  ].join(",");
  const TH = thD / 2;
  const filter = [
    `[0:v]split=2[pic][shot]`,
    // the picture: a hand holds it; clean and a little crisp ("crystal clear"); between the two bands
    `[pic]${hand},unsharp=5:5:0.45:5:5:0,eq=contrast=1.03:saturation=1.05,crop=${w}:${vh}:0:${cy},pad=${w}:${h}:0:${topH}:black,format=rgba[base]`,
    // the last shot's thumbnail: this take's own first frame, in a circle
    `[shot]select='eq(n,0)',scale=${thD}:${thD}:force_original_aspect_ratio=increase,crop=${thD}:${thD},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*clip(${TH}-hypot(X-${TH}+0.5,Y-${TH}+0.5),0,1)',loop=loop=-1:size=1:start=0,setpts=N/FRAME_RATE/TB[thumb]`,
    `[base][1:v]overlay=0:0:format=auto[a1]`,
    `[a1][thumb]overlay=x=${thX - TH}:y=${ctlY - TH}:shortest=1:format=auto[a2]`,
    `[a2]${texts},format=yuv420p[v]`,
  ].join(";");
  return { chrome, filter, audio: null };
}
