/* A LONG TOLD STORY IS CUT IN PARTS — and read in parts when it is longer than the voice can read at once.
 *
 * The owner, 2026-11-25, of the Length step: "a sexy slider allowing up to 5 minutes". A told story
 * (narrated-story.server.ts) was at most twelve scenes, about two minutes, and its cut was ONE ffmpeg: every
 * scene's picture or clip opened at once, the captions drawn over all of it, the voice and the music mixed in,
 * and the whole story encoded in Full HD at the finer setting the stories have had since that same morning.
 * Five minutes is thirty-two scenes (film-length.ts): thirty-two Full-HD inputs open together on a server with
 * 2 GB, and nine thousand frames in one encode, which is stopped at ten minutes (ugc-ad-pipeline.server.ts →
 * runFfmpeg) — and then tried again, a rung lower, for ten more. So a story of more than STORY_ONE_CUT scenes is
 * cut in PARTS: a handful of scenes each, their pictures and their words drawn exactly as the single cut draws
 * them (each part told where in the story it begins), encoded without sound; the sound is mixed ONCE, for the
 * whole story; and the parts are put end to end with it, their picture copied as it is. A told story's scenes
 * meet in straight cuts, so the edge of a part is a cut the story already has.
 * A story of up to twelve scenes is cut exactly as it always was.
 *
 * Pure (no server file): tests/story-join.test.ts cuts a story of fifteen stand-in scenes both ways, with the very
 * arguments below, and compares the two frame by frame. */

import { kenBurns } from "./narrated-core.ts";
import { motionChain } from "./story-motion.ts";

const FPS = 30;

/** The most scenes ONE ffmpeg cuts: what a told story was at most until 2026-11-25, cut on the live server every day. */
export const STORY_ONE_CUT = 12;
/** …and once a story is longer, the most scenes one part of its cut has (an acted film's parts open six clips:
 *  acted-staging.ts → JOIN_PART_CLIPS). */
export const STORY_PART_SCENES = 6;

/** One part of a story's cut: its scenes (from `from` up to, not including, `to`), how many frames they come to,
 *  the frame of the story it begins on — and `clock`, the story's clock at that frame as ONE cut keeps it: in
 *  millionths of a second, each scene before it counted as its own length rounded to the millionth (ffmpeg's concat
 *  runs on that clock, and adds the scenes up so). A part's words are drawn on it (partGraph). */
export type StoryPart = { from: number; to: number; frames: number; start: number; clock: number };

/** A scene's length on one cut's clock: its frames at 30 a second, in millionths, rounded as ffmpeg rounds them. */
const onClock = (frames: number): number => Math.round((frames * 1_000_000) / FPS);

/** THE STORY'S CUT, DEALT INTO PARTS: one part — the whole story, as it always was — up to STORY_ONE_CUT scenes;
 *  else as few parts of at most `most` scenes as hold it, as even as they come (the longer ones first).
 *  `frames` = each scene's length in frames, as the cut gives it. */
export function storyParts(frames: ReadonlyArray<number>, most = STORY_PART_SCENES): StoryPart[] {
  const n = frames.map((f) => Math.max(0, Math.round(Number(f) || 0)));
  const N = n.length;
  if (!N) return [];
  const k = N <= STORY_ONE_CUT ? 1 : Math.ceil(N / Math.max(1, Math.round(most)));
  const parts: StoryPart[] = [];
  let from = 0;
  let start = 0;
  let clock = 0;
  for (let p = 0; p < k; p++) {
    const size = Math.floor(N / k) + (p < N % k ? 1 : 0);
    const to = from + size;
    const own = n.slice(from, to);
    const frames = own.reduce((a, b) => a + b, 0);
    parts.push({ from, to, frames, start, clock });
    from = to;
    start += frames;
    clock += own.reduce((a, f) => a + onClock(f), 0);
  }
  return parts;
}

/** A caption card, as narrated-core.ts makes them: when it is up (seconds into the story) and, for the look that
 *  lights each word, when each word is said. */
type Timed = { t0: number; t1: number };
type CardLike = Timed & { words?: Timed[] };

/** THE CARDS A PART SHOWS: every card that is up at any moment between `from` and `to` (seconds into the story),
 *  untouched — a part's words are drawn on the story's own clock (partGraph), so a card is up on the frames it is
 *  up on in one cut. (Shifted to the part's own times instead, every card that began or ended exactly on a frame
 *  came out a frame late: its time is said to the hundredth, and a clock counted in frames does not round as one
 *  counted in millionths — tests/story-join.test.ts caught six in one story. On the one cut's clock, at most one of
 *  those six is a frame off: ffmpeg counts a moving scene's length to the millionth its own way.) */
export function cardsDuring<C extends CardLike>(cards: ReadonlyArray<C>, from: number, to: number): C[] {
  return cards.filter((c) => c.t1 > from && c.t0 < to);
}

/** A scene as it goes into a cut: its picture, and the clip that plays in place of it where it has one (with how
 *  that clip fills the scene: story-motion.ts → fitMotion). */
export type StoryScene = { still: string; clip?: { file: string; fit: { speed: number; hold: number } } | null };

/** HOW SCENE `i` GOES INTO A CUT — its input and its picture's chain, exactly as the single cut takes it
 *  (narrated-story.server.ts → assembleNarrated → build): its clip, when clips are used and it has one; else its
 *  picture with the slow push-in (`moving`); else its picture held for the scene. */
export function sceneIn(i: number, s: StoryScene, frames: number, W: number, H: number, how: { clips: boolean; moving: boolean }): { input: string[]; chain: string } {
  const m = how.clips && how.moving ? s.clip : null;
  if (m) return { input: ["-i", m.file], chain: motionChain(m.fit, frames, W, H) };
  if (how.moving) return { input: ["-i", s.still], chain: `${kenBurns(i, frames, W, H)},format=yuv420p` };
  return { input: ["-loop", "1", "-t", (frames / FPS).toFixed(3), "-i", s.still], chain: `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},format=yuv420p` };
}

/** How a scene's picture becomes exactly `frames` frames in a part — whatever its own chain gave: its last frame
 *  held as long as it must be, then cut. (The single cut of a whole story ends where the story's length says; a
 *  part has to end on its own last frame.) */
export const exactly = (frames: number): string =>
  `tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${Math.max(1, Math.round(frames))},setpts=PTS-STARTPTS`;

/** THE PICTURE OF ONE PART: each of its scenes by its own chain (`chains[k]`, for input k of the part), made
 *  exactly as long as it is in the story, end to end, and the part's words drawn over them (`captions`: filters;
 *  none = no words) — on the story's own clock: while the words are drawn, the part's frames are timed in
 *  millionths of a second from `clock` (StoryPart → clock: where one cut's clock stands at the part's first frame),
 *  and from 0 again after. Out: [v]. */
export function partGraph(chains: ReadonlyArray<string>, frames: ReadonlyArray<number>, captions: ReadonlyArray<string>, clock = 0): string {
  const g = chains.map((c, k) => `[${k}:v]${c},${exactly(frames[k])}[c${k}]`);
  g.push(`${chains.map((_, k) => `[c${k}]`).join("")}concat=n=${chains.length}:v=1:a=0[vcat]`);
  g.push(captions.length ? `[vcat]settb=AVTB,setpts=PTS+${Math.max(0, Math.round(clock))},${captions.join(",")},setpts=PTS-STARTPTS[v]` : "[vcat]null[v]");
  return g.join(";");
}

/** The picture's encoder — the single cut's own (the finer setting of 2026-11-25: "quality looks rough"). */
export const STORY_PICTURE = ["-threads", "2", "-filter_complex_threads", "2", "-c:v", "libx264", "-preset", "fast", "-tune", "film", "-crf", "18", "-pix_fmt", "yuv420p"] as const;

/** ffmpeg's arguments for ONE PART: its scenes (`sceneIn`, in order), their lengths, its words and the story's
 *  clock at its first frame (partGraph), into `out` — the picture alone. */
export function storyPartArgs(scenes: ReadonlyArray<{ input: string[]; chain: string }>, frames: ReadonlyArray<number>, captions: ReadonlyArray<string>, clock: number, out: string): string[] {
  return ["-y", ...scenes.flatMap((s) => s.input), "-filter_complex", partGraph(scenes.map((s) => s.chain), frames, captions, clock), "-map", "[v]", "-an", ...STORY_PICTURE, "-f", "mp4", out];
}

/** ffmpeg's arguments for THE STORY'S SOUND, once, for all of it — the single cut's own mix: the voice levelled and
 *  given its `tail` of quiet, the music (when there is one) looped, ducked under it and faded out at the end;
 *  `total` seconds long; kept uncompressed until the last pass. */
export function storySoundArgs(o: { voice: string; music?: string | null; total: number; tail: number; out: string }): string[] {
  const f = [`[0:a]aresample=44100,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100,apad=pad_dur=${o.tail}[vo]`];
  if (o.music) f.push(`[1:a]aresample=44100,volume=0.18,afade=t=out:st=${Math.max(0, o.total - 1.6).toFixed(2)}:d=1.6[bg]`, "[vo][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]");
  return ["-y", "-i", o.voice, ...(o.music ? ["-stream_loop", "-1", "-i", o.music] : []), "-filter_complex", f.join(";"), "-map", o.music ? "[aout]" : "[vo]", "-t", o.total.toFixed(2), "-c:a", "pcm_s16le", "-f", "wav", o.out];
}

/** ffmpeg's arguments for THE LAST PASS: the parts end to end (`list`: acted-staging.ts → joinList, each part's file
 *  and its exact length), their picture copied as it is, with the sound encoded once. */
export function storyJoinArgs(o: { list: string; sound: string; total: number; out: string }): string[] {
  return ["-y", "-f", "concat", "-safe", "0", "-i", o.list, "-i", o.sound, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", o.total.toFixed(2), "-movflags", "+faststart", o.out];
}

/** The most characters the narrator's voice is asked to read at once: the speech model reads 10,000 at most
 *  (Replicate's own page for minimax/speech-02-hd and -turbo, read 2026-11-25). Five minutes is about 1,100 words
 *  — some 7,000 characters in English, more in a language of longer words: a story past this is read in parts,
 *  and the parts are joined. */
export const NARRATION_MAX_CHARS = 9000;

/** THE NARRATION, DEALT INTO READINGS of at most `max` characters, each ending where a sentence does (a sentence
 *  longer than that alone ends where a word does): one reading — the whole text, as it always was — when it fits;
 *  else as few as hold it, as even as the sentences allow, so that no reading is a scrap. */
export function readingParts(text: string, max = NARRATION_MAX_CHARS): string[] {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t ? [t] : [];
  const sentences = (t.match(/[^.!?…。！？]+(?:[.!?…。！？]+["'”’»)\]]*|$)\s*/g) || [t]).map((s) => s.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const s of sentences) {
    if (s.length <= max) { pieces.push(s); continue; }
    let rest = s;
    while (rest.length > max) {
      const cut = rest.lastIndexOf(" ", max);
      const at = cut > max / 2 ? cut : max;
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) pieces.push(rest);
  }
  const aim = t.length / Math.ceil(t.length / max);
  const out: string[] = [];
  let cur = "";
  for (const p of pieces) {
    const next = cur ? `${cur} ${p}` : p;
    // a reading ends once it has its share — or before a piece that would carry it past the limit
    if (cur && (next.length > max || cur.length >= aim)) { out.push(cur); cur = p; }
    else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}
