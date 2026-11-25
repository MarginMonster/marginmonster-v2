/* EVERY FFMPEG THE APP RUNS HAS A THREAD CAP.
 *
 * Measured on the live server, 2026-11-25 22:05–22:14 UTC (/art-status memory.lastMinutes): a TEST told story
 * of three scenes. Idle ≈ 130–150 MB → 1,080 / 1,081 / 1,093 MB for three minutes → 609 / 668 MB (the cut) →
 * 148 MB. The Render log put the 1.08 GB plateau exactly on "[story-motion] 3 made" — not the cut. story-motion
 * re-encodes every clip it downloads to Full HD (libx264 -preset fast -tune film -crf 18) with NO -threads, and
 * its decoder had none either. ffmpeg sizes its threads — x264's frame threads and lookahead, the H.264
 * decoder's, slice-threaded filters — by the CORES IT SEES. On Render that is the HOST's count, not our share of
 * a CPU, and every one of those threads holds frames. The told cut, which already says `-threads 2
 * -filter_complex_threads 2` and one decoding thread an input, measured far less for the same pictures; R1 saw
 * the same effect on decoders with `-cpucount 16` standing in for a 16-core host. R1 capped the decoders of the
 * many-input joins only; ~119 other runs were still uncapped.
 *
 * So the runners (runFfmpeg and every other place that spawns ffmpeg) put every run through `capThreads`:
 *   - `-filter_threads 2` and `-filter_complex_threads 2`, once, when the run does not say them itself;
 *   - `-threads 1` among the options of every INPUT that does not set its own (its decoder: one thread);
 *   - `-threads 2` among the options of every OUTPUT that encodes video and does not set its own (x264).
 * The caller's own -threads always wins. Nothing else is moved, and no VALUE is ever looked inside: a filter
 * string or a path with "-i" in it is a value, and is only ever stepped over whole.
 *
 * Only ffmpeg's own options (ffmpeg 5.1 — production is Debian bookworm's — has every one used here) are added.
 * When the arguments cannot be read with certainty (an option left without its value, a value that looks like
 * an option name such as "-i" or "-c:v", an option whose arity changed between ffmpeg versions), they are handed
 * back exactly as given: a run without a cap is the old behaviour, a run with a cap in the
 * wrong place would be a broken encode.
 *
 * FFMPEG_THREAD_CAP=off turns it off everywhere (the switch is read on every run). */

/** ffmpeg's options that take NO value (ffmpeg 5.1, fftools/ffmpeg_opt.c + cmdutils). Every other option takes
 *  exactly one. A boolean may also be written with "no" in front (-nostats, -nostdin, -noautorotate). Only TRUE
 *  booleans may be listed here: a valued option listed by mistake would have its value read as an output path,
 *  and a cap put between the two. An unlisted boolean is NOT safe either: the option after it would be read as
 *  its value and the next token as a path ("-flag -c:v libx264 o.mp4" → a cap between "-c:v" and "libx264"), so a
 *  value that looks like an option name makes readArgs give up (the run goes as written).
 *  Checked against ffmpeg 6.1 (the npm build, nearest to production's 5.1) and 8.1 by tests/ffmpeg-threads.test.ts. */
export const FFMPEG_FLAGS: ReadonlySet<string> = new Set([
  // global
  "y", "n", "hide_banner", "report", "stats", "stdin", "benchmark", "benchmark_all", "dump", "hex", "xerror",
  "debug_ts", "ignore_unknown", "copy_unknown", "recast_media", "copyts", "start_at_zero", "vstats", "qphist",
  // per input / per output
  "re", "accurate_seek", "find_stream_info", "bitexact", "shortest", "an", "vn", "sn", "dn",
  "copyinkf", "fix_sub_duration", "force_fps",
  // the ones that print something and stop (no output is ever named with them)
  "L", "license", "version", "buildconf", "formats", "muxers", "demuxers", "devices", "codecs", "decoders",
  "encoders", "bsfs", "protocols", "filters", "pix_fmts", "layouts", "sample_fmts", "dispositions", "colors", "hwaccels",
]);

/** Booleans that TAKE A VALUE in some ffmpeg versions and none in others. In 5.1 and 6.1 (HAS_ARG | OPT_BOOL)
 *  "-autorotate" and "-autoscale" swallow the next token ("-autorotate 0"); in 7.0 and later they take none.
 *  (Seen 2026-11-25 on the npm 6.1 build: "-autorotate zzvalue.mp4" read "zzvalue.mp4" as its argument.) No
 *  reading is right for both, so a run that says either is handed back as written. Their "no" forms
 *  (-noautorotate, which upright-photo uses) take no value in every version. */
export const FFMPEG_VERSIONED_FLAGS: ReadonlySet<string> = new Set(["autorotate", "autoscale"]);

/** The threads the cap gives: an input's decoder, an output's encoder, a filter graph. */
export const DECODE_THREADS = "1";
export const ENCODE_THREADS = "2";
export const FILTER_THREADS = "2";

/** "-threads", "-threads:v" … → "threads". Not an option (a value, or a path) → null. "-" alone is stdout. */
function optName(tok: string): string | null {
  if (tok.length < 2 || tok[0] !== "-") return null;
  return tok.slice(1).split(":")[0];
}

/** Does ffmpeg's option `name` (no dash, no stream specifier) take a value, as this file reads it? */
export function takesValue(name: string): boolean {
  if (FFMPEG_FLAGS.has(name)) return false;
  if (name.startsWith("no") && (FFMPEG_FLAGS.has(name.slice(2)) || FFMPEG_VERSIONED_FLAGS.has(name.slice(2)))) return false;
  return true;
}

type Group = { opts: [string, string | null][]; at: number };
type Read = { globals: Set<string>; inputs: Group[]; outputs: Group[] };

/** The arguments read as ffmpeg reads them: each input's options up to its "-i" (`at` = the index of "-i"),
 *  each output's options up to its path (`at` = the index of the path). null when they cannot be read. */
function readArgs(args: readonly string[]): Read | null {
  const globals = new Set<string>();
  const inputs: Group[] = [];
  const outputs: Group[] = [];
  let opts: [string, string | null][] = [];
  for (let i = 0; i < args.length; i++) {
    const tok = String(args[i]);
    const name = optName(tok);
    if (name === null) { // a path: an output (inputs come after "-i")
      outputs.push({ opts, at: i });
      opts = [];
      continue;
    }
    if (name === "i") {
      if (i + 1 >= args.length) return null;
      inputs.push({ opts, at: i });
      opts = [];
      i++;
      continue;
    }
    const full = tok.slice(1); // the name with its stream specifier ("c:v")
    if (FFMPEG_VERSIONED_FLAGS.has(name)) return null; // a value in 5.1, none in 7+: no reading is right for both
    if (!takesValue(name)) { opts.push([full, null]); continue; }
    if (i + 1 >= args.length) return null; // an option left without its value
    const value = String(args[i + 1]);
    // A value that looks like an option name ("-i", "-c:v", "-threads") means something before it is a flag this
    // file does not know, and every token after it would be misread. Values that start with a dash are numbers
    // ("-1", "-0.5", "-2") everywhere in the app; none starts with a dash and a letter.
    if (/^-[A-Za-z_]/.test(value)) return null;
    opts.push([full, value]);
    if (name === "filter_threads" || name === "filter_complex_threads") globals.add(name);
    i++;
  }
  return { globals, inputs, outputs };
}

const setsThreads = (g: Group) => g.opts.some(([n]) => n.split(":")[0] === "threads");

/** Does this output encode a picture? Not when it says -vn, and not when its video codec is "copy" (-c copy,
 *  -c:v copy, -vcodec copy …; the last one said wins, as in ffmpeg — "-c copy -c:v libx264" encodes). A codec
 *  given for another stream ("-c:a aac") does not count. Anything else might encode a picture, and is capped. */
function encodesVideo(g: Group): boolean {
  let codec = "";
  for (const [tok, v] of g.opts) {
    const [n, spec] = tok.split(":");
    if (n === "vn") return false;
    if (v === null) continue;
    if (n === "vcodec") codec = v;
    else if ((n === "c" || n === "codec") && (spec === undefined || spec === "v" || spec === "V")) codec = v;
  }
  return codec !== "copy";
}

/** The arguments with every thread count set (see the top of this file). Pure; idempotent; returns the very
 *  same tokens, in the same order, with only `-threads N` / `-filter_threads 2` / `-filter_complex_threads 2`
 *  added — or the arguments untouched when they cannot be read, or name no output (a probe: `-i file` alone). */
export function capThreads(args: readonly string[]): string[] {
  const all = args.map(String);
  const read = readArgs(all);
  if (!read || read.outputs.length === 0) return all;
  const before = new Map<number, string[]>(); // index → tokens to put in front of it
  const add = (at: number, toks: string[]) => before.set(at, [...(before.get(at) || []), ...toks]);
  for (const g of read.inputs) if (!setsThreads(g)) add(g.at, ["-threads", DECODE_THREADS]);
  for (const g of read.outputs) if (!setsThreads(g) && encodesVideo(g)) add(g.at, ["-threads", ENCODE_THREADS]);
  const head: string[] = [];
  if (!read.globals.has("filter_threads")) head.push("-filter_threads", FILTER_THREADS);
  if (!read.globals.has("filter_complex_threads")) head.push("-filter_complex_threads", FILTER_THREADS);
  const out: string[] = [...head];
  all.forEach((tok, i) => { const pre = before.get(i); if (pre) out.push(...pre); out.push(tok); });
  return out;
}

/** The switch: FFMPEG_THREAD_CAP=off (or 0 / false / no) leaves every run as its caller wrote it. Default on. */
export function threadCapOn(env: Record<string, string | undefined> = process.env): boolean {
  return !/^(off|0|false|no)$/i.test(String(env.FFMPEG_THREAD_CAP ?? "").trim());
}

/** What a runner hands ffmpeg: the capped arguments, unless the switch is off. */
export function withThreadCap(args: readonly string[], env: Record<string, string | undefined> = process.env): string[] {
  return threadCapOn(env) ? capThreads(args) : args.map(String);
}

/** Is this binary ffmpeg (not ffprobe, not yt-dlp)? For runners that run more than one tool. */
export function isFfmpegBin(bin: string): boolean {
  const base = String(bin || "").split(/[\\/]/).pop() || "";
  return /^ffmpeg(\.exe)?$/i.test(base);
}

/** The arguments a runner should spawn `bin` with: capped when `bin` is ffmpeg, untouched otherwise. */
export function ffmpegArgsFor(bin: string, args: readonly string[], env: Record<string, string | undefined> = process.env): string[] {
  return isFfmpegBin(bin) ? withThreadCap(args, env) : args.map(String);
}
