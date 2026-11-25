/* A FOUND-FOOTAGE FILM, MADE — several moments from one camera, a card before each, start to Archive.
 *
 * What it is and why: footage-film.ts (the outline a member sees and edits, the build, the direction, the pictures'
 * wording, the clocks, the cards, the join). The owner, 2026-11-25: "Found footage needs redone … It currently
 * appears to pipeline singular events But needs to be more like \"Found Footage\" House cam, Body cam, phone or cam
 * recording, with describe events flow like the others - make it look banging and not limited". This file is the
 * making:
 *
 *   1. THE OUTLINE    the one the member approved (cleaned again: it is never trusted), else written now from their
 *                     idea. A writer that fails twice → ONE take of their idea, made the way one take always is
 *                     (take.server.ts / house-take.server.ts) — a job is never lost for want of an outline.
 *   2. THE DIRECTION  one writer call turns every line into its take's parts; each is checked by one take's own
 *                     rules, the moments that fail are asked for ONCE more, and one that still fails is left out. A
 *                     film needs two: fewer → the one take, as above.
 *   3. THE PICTURES   handheld and worn cameras: the first moment's scene from words; the thing's payoff FROM it;
 *                     every other scene from those; each moment's way in from its own scene — on the strongest
 *                     picture model at 2K, the everyday one behind it ("upgrade the best image possible"). A house
 *                     camera draws from the kept house, as its takes always have.
 *   4. THE TAKES      every moment is one continuous roll made by ONE take's own maker (makeTake / makeHouseTake:
 *                     the roll, the listening and the looking, the roll again, the cut cut off, the voice, the
 *                     camera). Handheld moments roll THREE at a time and are encoded one at a time (the server has
 *                     2 GB); a house camera's go one after another — its house is kept from each to the next. One
 *                     more roll for any moment at most, THREE for the whole film. A moment that will not roll is
 *                     LEFT OUT and the film goes on with what it has.
 *   5. THE CARDS      each moment's "when" on black, in the camera's mono face, at the film's own size and rate.
 *   6. THE JOIN       cards and moments, straight cuts, MEASURED — picture and sound the same length, and the length
 *                     they add up to — or the job fails here and no half-film is shipped. Then the level every film
 *                     plays at (a house camera's is not levelled: nobody speaks, and its room would be turned up
 *                     into hiss).
 *   7. THE PIECE      one VIDEO_AD, `kind: "take"` — so the Archive's footage family, its cover and its labels are
 *                     the ones a take has.
 *
 * RESUME. The job can stop at any point, and a resumed film NEVER pays twice for a roll or a picture it has: the
 * outline and the direction are kept as `ckFo` the moment they exist, and every moment keeps its own record —
 * `ckFm0`, `ckFm1`, … one JSON text each: its two pictures, its roll, what was heard and seen in it, its finished
 * file, or why it was left out — written the moment each exists, one write at a time. `resume` reads them back.
 *
 * NOT YET FILMED: written 2026-11-25 without a roll and without the writer (the local writer has no credit; a roll
 * costs money). What could be run locally was: the cards and the join, with real ffmpeg (tests/footage-film.test.ts). */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { db } from "../db.server";
import { anthropicText } from "./anthropic.server";
import { cameraLookOf, type CameraLook, type HouseClock } from "./camera-dress";
import { ffmpegTurn } from "./ffmpeg-turn";
import { streamSeconds } from "./film-join.server";
import { levelFilm } from "./film-loudness.server";
import {
  FOOTAGE_DIRECTED_AT_ONCE, FOOTAGE_OUTLINE_UNREADABLE, FOOTAGE_REROLLS, FOOTAGE_ROLLS_AT_ONCE,
  camStamp, cleanFootageOutline, footageCardArgs, footageClocks, footageDirectionBrief, footageDirectionSchema, footageFps, footageFrom, footageIdea,
  footageJoinCheck, footageJoinGraph, footageMomentBrief, footageMomentSchema, footageOpensPrompt, footageOutlineBrief, footageOutlineSchema, footageScenePlan,
  footageScenePrompt, momentCount, parseFootageDirection, parseFootageMoment, parseFootageOutline, undirected, withDirected, directionFaults,
  nightTitle, onNight,
  type DirectedMoment, type FootageDirection, type FootageMoment, type FootageOutline,
} from "./footage-film";
import { footageContinues, footageNightOf, footageNightRecord, footageSeriesFromPayload, footageSeriesOf, latestNight, seriesKeyOf, seriesMeta, type FootageSeries } from "./film-series";
import { houseRoom, keptHouseOf, type KeptHouse } from "./house-cam";
import { generateHouseTake, keptHouseFor, makeHouseTake } from "./house-take.server";
import { mirrorRender } from "./object-storage.server";
import { overlayFonts } from "./overlay-fonts.server";
import { TAKE_REF, sameWords, shapeFor, type TakeLine } from "./take";
import { camToday, drawClothed, drawPicture, generateTake, imageRef, makeTake, renders, rerolls, run, stamp, type TakeDress } from "./take.server";
import { dressedInWater } from "./story-picture";
import { checkpointJob, ffprobeBin, runFfmpeg } from "./ugc-ad-pipeline.server";

/** The writer of a film's outline and direction — the model the films' scripts are written on. */
const WRITER = "claude-sonnet-5";
/** Why a writer's page-facing call did not answer, in words the page can show (and translate). */
export const FOOTAGE_WRITER_BUSY = "The writer didn't answer — try again in a moment.";
export const FOOTAGE_NEEDS_IDEA = "Say what happens, in a few words.";

const short = (e: unknown, n = 160): string => (e instanceof Error ? e.message : String(e)).slice(0, n);

/* ---- THE WRITER, FOR THE PAGE: free, before anything is spent ---- */

/** WRITE THE MOMENTS — a free preview for the page ("describe events flow like the others"): the member's idea, a
 *  camera and how many moments → the outline they will read, edit and approve. `from`: the key of the ready-made
 *  take their words started from. Asked twice at most; throws in words the page can show. */
export async function writeFootageOutline(o: { idea: string; camera: CameraLook; aspect: "9:16" | "16:9"; count: number; from?: string; night?: FootageSeries | null }): Promise<FootageOutline> {
  const idea = String(o.idea || "").replace(/\s+/g, " ").trim();
  // (a NEXT NIGHT starts from no card, and needs no words: the footage so far is its idea — S10c)
  const night = o.night || null;
  const card = night ? undefined : footageFrom(o.from, o.camera);
  if (idea.length < 8 && !card && !night) throw new Error(FOOTAGE_NEEDS_IDEA);
  const n = Math.max(2, momentCount(o.count));
  const brief = footageOutlineBrief(night && idea.length < 8 ? "" : idea, o.camera, n, card, night);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const outline = parseFootageOutline(await anthropicText(brief, { model: WRITER, maxTokens: 700 + 240 * n, jsonSchema: footageOutlineSchema(n, o.camera === "house") }), o.camera, shapeFor(o.camera, o.aspect), n);
      // (…and held to its series: the title, the kind, the place and the thing word for word, the cards going on)
      if (outline) return night ? onNight(outline, night) : outline;
      console.error(`[footage-film] the outline came back half written (attempt ${attempt + 1})`);
    } catch (e) { console.error(`[footage-film] the outline's writer did not answer (attempt ${attempt + 1}): ${short(e)}`); }
  }
  throw new Error(FOOTAGE_WRITER_BUSY);
}

/** THE NEXT NIGHT OF A PIECE (S10c) — for the builder's ?next=<id> and its every post, read here from the piece's OWN
 *  ROW, never from the page: only this shop's own pieces; and the series always goes on from its LATEST finished piece,
 *  whichever one was named (a stale tab, an older night — a series never forks: film-series.ts → latestNight). Null when
 *  the piece is gone, another shop's, or not found footage that can go on. */
export async function footageNextFor(shopId: string, askedId: unknown): Promise<FootageSeries | null> {
  const id = String(askedId ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  if (!id || !shopId) return null;
  const pick = { id: true, title: true, metaJson: true, bodyJson: true, status: true } as const;
  const asked = await db.asset.findFirst({ where: { id, shopId, type: "VIDEO_AD", status: { not: "FAILED" } }, select: pick });
  if (!asked || !footageContinues(asked.metaJson)) return null;
  let from = asked;
  try {
    const later = await db.asset.findMany({
      where: { shopId, type: "VIDEO_AD", status: { not: "FAILED" }, id: { not: asked.id }, metaJson: { contains: `"id":"${seriesKeyOf(asked).replace(/[^A-Za-z0-9_-]/g, "")}"` } },
      orderBy: { createdAt: "desc" }, take: 12, select: pick,
    });
    from = latestNight(asked, [...later, asked]);
  } catch { /* goes on from the piece that was named */ }
  return footageSeriesOf(from);
}

/** ANOTHER TAKE ON THIS MOMENT — a free preview for the page: moment `index` of the outline the member is editing,
 *  written again (`note`: what they asked for). The outline is cleaned first, like anything the page sends. Throws in
 *  words the page can show. */
export async function rewriteFootageMoment(o: { outline: FootageOutline; index: number; note?: string }): Promise<FootageMoment> {
  const outline = cleanFootageOutline(o.outline);
  const i = Math.floor(Number(o.index));
  if (!outline || !(i >= 0 && i < outline.moments.length)) throw new Error(FOOTAGE_OUTLINE_UNREADABLE);
  const brief = footageMomentBrief(outline, i, o.note);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const m = parseFootageMoment(await anthropicText(brief, { model: WRITER, maxTokens: 500, jsonSchema: footageMomentSchema(outline.camera === "house") }), outline.camera, i, outline.moments[i]);
      if (m) return m;
    } catch (e) { console.error(`[footage-film] a moment's writer did not answer (attempt ${attempt + 1}): ${short(e)}`); }
  }
  throw new Error(FOOTAGE_WRITER_BUSY);
}

/** THE DIRECTION: the whole film asked for at once; the moments not answered well are asked for ONCE more.
 *  A film of more than FOOTAGE_DIRECTED_AT_ONCE moments is asked for in two halves, side by side — each call is shown
 *  the WHOLE outline and writes its own half — so that no one answer is long enough to run into the request's own
 *  time limit (http-retry.server.ts gives one attempt 120 seconds; eight moments' parts are some four thousand
 *  tokens). */
async function directFootage(outline: FootageOutline): Promise<FootageDirection> {
  const all = outline.moments.map((_, i) => i);
  const ask = async (only?: number[]): Promise<FootageDirection> => {
    const raw = await anthropicText(footageDirectionBrief(outline, only), { model: WRITER, maxTokens: 600 + 700 * (only?.length || all.length), jsonSchema: footageDirectionSchema(outline.camera) });
    const d = parseFootageDirection(raw, outline, only);
    // (a refused moment says WHY — the first live film lost all three of its moments with nothing in the log to say why)
    if ((only || all).some((i) => !d[i])) for (const why of directionFaults(raw, outline, only)) console.error(`[footage-film] refused — ${why}`);
    return d;
  };
  const asked = async (only: number[] | undefined, what: string): Promise<FootageDirection> => {
    try { return await ask(only); }
    catch (e) { console.error(`[footage-film] the direction's writer did not answer ${what}: ${short(e)}`); return all.map(() => null); }
  };
  const half = Math.ceil(all.length / 2);
  const parts: Array<number[] | undefined> = all.length > FOOTAGE_DIRECTED_AT_ONCE ? [all.slice(0, half), all.slice(half)] : [undefined];
  let direction = (await Promise.all(parts.map((only) => asked(only, "the first time")))).reduce(withDirected, all.map(() => null) as FootageDirection);
  const again = undirected(direction);
  if (again.length) {
    console.log(`[footage-film] moment${again.length > 1 ? "s" : ""} ${again.map((i) => i + 1).join(", ")} asked for once more`);
    direction = withDirected(direction, await asked(again, "the second time"));
  }
  return direction;
}

/* ---- THE MAKING ---- */

/** `work` for every item, `atOnce` of them at a time, each started as one before it ends. (`work` never throws:
 *  each moment catches its own failure and is left out.) */
async function inTurns<T>(items: readonly T[], atOnce: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const hand = async () => { while (next < items.length) await work(items[next++]); };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(atOnce, items.length)) }, hand));
}

/** A moment as it was made — what the piece records of it, and what a resumed job finds in its place. */
type MadeMoment = {
  /** the finished (dressed) file and the take as the engine made it, on the renders disk */
  out: string;
  raw: string;
  dressed: boolean;
  host: string;
  rolls: number;
  cuts?: number[];
  trimmed?: number;
  still: string;
  opens: string | null;
  /** what the one filming says, in the moment's own seconds */
  lines: TakeLine[] | null;
  spoke: Array<{ at: number; text: string }> | null;
  direction: string;
  /** house camera: its camera's name and the room */
  cam?: string;
  room?: string;
};
/** A moment's own record (`ckFm<i>`): the checkpoints of the take it is made by, how many times it was rolled again,
 *  what it came to (`done`) — or why it was left out (`left`). */
type MomentRecord = Record<string, unknown> & { rerolls?: number; left?: string; done?: MadeMoment };

const readJson = (text: string | undefined): Record<string, unknown> | null => {
  try { const o = text ? JSON.parse(text) : null; return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; }
};
const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
/** a whole number from words: the same film gets the same seconds on its clocks however often its job restarts */
const seedOf = (s: string): number => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 1_000_000;

/** A file's picture: its size, its frame rate and its length in seconds (the PICTURE's own — never the container's,
 *  which is the longer of picture and sound: acted-staging.ts tells what that cost a film). */
function pictureOf(file: string): { w: number; h: number; fps: number; seconds: number } {
  let v: Record<string, unknown> = {};
  try { v = (JSON.parse(spawnSync(ffprobeBin(), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,duration,nb_frames,avg_frame_rate,r_frame_rate", "-of", "json", file], { encoding: "utf8", timeout: 20_000 }).stdout || "{}").streams || [])[0] || {}; } catch { v = {}; }
  const rate = (r: unknown) => { const [a, b] = String(r ?? "").split("/").map(Number); return a > 0 && b > 0 ? a / b : 0; };
  const fps = rate(v.avg_frame_rate) || rate(v.r_frame_rate);
  let seconds = parseFloat(String(v.duration ?? ""));
  if (!(seconds > 0) && fps > 0 && Number(v.nb_frames) > 0) seconds = Number(v.nb_frames) / fps;
  return { w: Number(v.width) || 0, h: Number(v.height) || 0, fps, seconds: seconds > 0 ? seconds : 0 };
}

/** What a moment's dressing prints, from its clock: a body camera prints the clock itself; a camcorder burns the
 *  date and the hour into its corner; a phone and the bare hand print nothing. */
const lookFor = (camera: CameraLook, clock: HouseClock | undefined): Pick<TakeDress, "clock" | "stamp"> | undefined =>
  !clock ? undefined : camera === "bodycam" ? { clock } : camera === "camcorder" ? { stamp: camStamp(clock) } : undefined;

/** How a joined film is encoded: the dressed takes' own rate control (take.server.ts → dressTake: grain is
 *  incompressible, so it is capped), a little finer — it is their second encode. Two threads: the server has 2 GB. */
const filmEncode = (hd: boolean): string[] => ["-threads", "2", "-filter_complex_threads", "2", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-maxrate", hd ? "10M" : "7M", "-bufsize", hd ? "20M" : "14M", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"];

/** CARDS AND MOMENTS, JOINED AND MEASURED. `moments`: the finished moments' files, in order, each with its card's
 *  words. Returns the film's file name, its size and rate, its length, and where each moment starts in it — or throws
 *  (a film whose picture and sound do not match, or that is missing a piece, is never shipped). A card that will not
 *  draw is left out, never the film. */
export async function joinFootage(moments: ReadonlyArray<{ file: string; when: string }>, o: { label?: string } = {}): Promise<{ name: string; w: number; h: number; fps: number; seconds: number; starts: number[]; cards: boolean }> {
  const dir = renders(), label = o.label || "[footage-film]";
  const shots = moments.map((m) => ({ ...m, ...pictureOf(m.file) }));
  const lost = shots.findIndex((s) => !(s.seconds > 0) || !(s.w > 0));
  if (lost >= 0) throw new Error(`${label} moment ${lost + 1}'s picture could not be measured (${moments[lost].file})`);
  // ONE SIZE — the takes' own, and the largest of them (a roll that came back at 1080p is never shrunk) — and ONE
  // RATE: the takes' own when they agree (a phone's 24, a house camera's 15: nothing is re-timed), else 30
  const big = shots.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
  const rates = [...new Set(shots.map((s) => Math.round(s.fps)))];
  const fps = rates.length === 1 ? footageFps(rates[0]) : 30;
  const fonts = await overlayFonts(8_000);
  const made: string[] = [];
  const pieces: Array<{ file: string; moment: boolean }> = [];
  try {
    for (const s of shots) {
      // THE CARD before it — in the camera's mono face; the app's own face when that will not draw; no card rather than no film
      let card = "";
      for (const font of [...new Set([fonts.mono, fonts.font])]) {
        const out = path.join(dir, `footcard-${stamp()}.mp4`);
        const r = await ffmpegTurn(() => run("ffmpeg", footageCardArgs({ when: s.when, w: big.w, h: big.h, fps, font, out }), 60_000));
        if (r.code === 0 && fs.existsSync(out) && fs.statSync(out).size > 1_000) { card = out; made.push(out); break; }
        fs.rmSync(out, { force: true });
        console.error(`${label} a card would not draw in ${path.basename(font)}: ${r.err.slice(-160)}`);
      }
      if (card) pieces.push({ file: card, moment: false });
      pieces.push({ file: s.file, moment: true });
    }
    const frames = pieces.map((p) => Math.max(1, Math.round(pictureOf(p.file).seconds * fps)));
    const silent = pieces.map((p) => streamSeconds(p.file).audio === null);
    const plan = footageJoinGraph({ frames, fps, w: big.w, h: big.h, silent });
    const name = `footage-${stamp()}.mp4`, outPath = path.join(dir, name);
    // (one decoding thread for each piece: sixteen 1080p decoders at the machine's own thread count is memory the
    //  server does not have)
    const joined = await runFfmpeg(["-y", ...pieces.flatMap((p) => ["-threads", "1", "-i", p.file]), "-filter_complex", plan.graph, "-map", "[vc]", "-map", "[ac]", ...filmEncode(big.w * big.h > 1_500_000), outPath]);
    const whole = joined.status === 0 && fs.existsSync(outPath)
      ? footageJoinCheck({ ...streamSeconds(outPath), frames: plan.frames, fps })
      : { ok: false, why: `ffmpeg stopped: ${(joined.stderr || "").slice(-200)}` };
    // NEVER SHIPPED: the job fails here, and a film missing a moment's picture (or its sound) never reaches anybody
    if (!whole.ok) { fs.rmSync(outPath, { force: true }); throw new Error(`${label} the film could not be joined whole — ${whole.why}`); }
    const starts: number[] = [];
    let at = 0;
    pieces.forEach((p, k) => { if (p.moment) starts.push(Math.round((at / fps) * 100) / 100); at += frames[k]; });
    return { name, w: big.w, h: big.h, fps, seconds: Math.round((plan.frames / fps) * 100) / 100, starts, cards: made.length === shots.length };
  } finally {
    for (const f of made) fs.rmSync(f, { force: true });
  }
}

export type FootageFilmOptions = {
  shopId: string;
  /** the outline the member approved… */
  outline?: FootageOutline;
  /** …or their idea (and the ready-made take it started from), and how many moments to write */
  idea?: string;
  from?: string;
  camera?: string;
  aspect?: string;
  moments?: number;
  /** house camera: the time-lapse setting (it plays on a fifteen-second moment where the thing stands still) and
   *  night vision (unset: on) */
  lapse?: boolean;
  ir?: boolean;
  section?: string;
  jobId?: string;
  /** A NEXT NIGHT (S10c): the series it goes on — as the builder's action read it off the piece it continues
   *  (footageNextFor), carried in the payload as `takeNight`; checked again here. Unset: read off the payload through
   *  `resume` (it is one of the payload's strings), so the queue needs no line of its own for it. */
  night?: unknown;
  /** a getter over the job's payload: what this film — or the one take it fell back to — checkpointed before */
  resume: (key: string) => string | undefined;
};

/** Make one found-footage film. Returns the new piece's id. */
export async function generateFootageFilm(opts: FootageFilmOptions): Promise<string> {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const resume = opts.resume || (() => undefined);
  const dir = renders();
  fs.mkdirSync(dir, { recursive: true });
  // ONE WRITE AT A TIME: three moments checkpoint at once, and a checkpoint that loses its race is a roll paid for
  // again on a resume (ugc-ad-pipeline.server.ts → checkpointJob merges onto what is there, four tries)
  let writing: Promise<void> = Promise.resolve();
  const ckpt = (patch: Record<string, unknown>): Promise<void> => {
    writing = writing.then(async () => { if (opts.jobId) await checkpointJob(opts.jobId, patch); }).catch(() => undefined);
    return writing;
  };

  // (the piece is written already: the job stopped between its last two steps)
  const written = resume("ckFa");
  if (written && (await db.asset.findUnique({ where: { id: written }, select: { id: true } }))) return written;

  // THE NEXT NIGHT (S10c): the series this footage goes on — read by the builder's action off the piece it continues,
  // carried by the queue, checked again here (film-series.ts → footageSeriesFromPayload). Its camera is the series'.
  const night = footageSeriesFromPayload(opts.night ?? resume("takeNight"));
  const approved = cleanFootageOutline(opts.outline);
  const camera: CameraLook = approved?.camera || night?.last.camera || cameraLookOf(opts.camera) || "phone";
  const aspect = shapeFor(camera, approved?.aspect || opts.aspect || night?.last.aspect);
  // …AND THE PICTURES IT CARRIES: the place's first still ("refs 1": the same place) and the thing's ("refs 2": the same
  // one) — while they are still on our disk; one that is not is drawn from words, as a first night is
  const onDisk = (p: string | undefined): string => (p && fs.existsSync(path.join(dir, path.basename(p))) ? p : "");
  const carriedPlace = night && camera !== "house" ? onDisk(night.last.placePic) : "";
  const carriedThing = night ? onDisk(night.last.thingPic) : "";
  if (night) console.log(`[footage-film] night ${night.night} of "${night.title}" — goes on from ${night.from}${carriedPlace ? "; the same place" : ""}${carriedThing ? "; the same thing" : ""}`);

  // ONE TAKE IN A FILM'S PLACE KEEPS WHAT ITS NEXT NIGHT NEEDS — the record, read off the take it is (film-series.ts →
  // footageNightOf) with the outline's words and the series' pictures — and, on a next night, it stays in its series
  // under the night's own title. Best effort: the take is made either way.
  const keepNightOn = async (id: string, outline?: FootageOutline | null): Promise<string> => {
    try {
      const row = await db.asset.findUnique({ where: { id }, select: { metaJson: true, bodyJson: true } });
      const meta = readJson(row?.metaJson || undefined);
      const took = row && meta ? footageNightOf(meta, row.bodyJson) : null;
      if (!meta || !took) return id;
      const payoff = outline?.moments[outline.moments.length - 1];
      const record = footageNightRecord({
        camera: took.camera, aspect: took.aspect, kind: outline?.kind || night?.last.kind || took.kind, place: outline?.place, thing: outline?.thing,
        moments: [{ when: payoff?.when || "", line: payoff?.line || took.line, room: payoff?.room || took.rooms[0] }],
        placePic: carriedPlace || took.placePic, thingPic: carriedThing || took.thingPic, night: night?.night, before: night?.last,
      });
      await db.asset.update({
        where: { id },
        data: {
          ...(night ? { title: `Found Footage — ${nightTitle(night.title, night.night)}` } : {}),
          metaJson: JSON.stringify({ ...meta, ...(night ? { series: seriesMeta(night) } : {}), ...(record ? { nextNight: record } : {}) }),
        },
      });
    } catch (e) { console.error(`[footage-film] the one take's next night could not be kept: ${short(e)}`); }
    return id;
  };

  // ONE TAKE, THE WAY ONE TAKE IS ALWAYS MADE — what a film falls back to, so that a job is never lost for want of a
  // writer. Remembered (ckFo), so a resumed job goes straight back to its take and its own checkpoints.
  const oneTake = async (why: string, outline?: FootageOutline | null): Promise<string> => {
    console.error(`[footage-film] ${why} — ONE take is made instead`);
    await ckpt({ ckFo: JSON.stringify({ v: 1, single: why, ...(outline ? { outline } : {}) }) });
    const card = night ? undefined : footageFrom(opts.from, camera);
    const idea = String(opts.idea || "").trim() || (outline ? footageIdea(outline) : "");
    // (a card whose own words are the idea is that card, exactly as it is; anything else is written, from the card)
    const ready = card && (!idea || sameWords(idea, card.premise)) ? card.key : undefined;
    // (a next night with no outline and no words of its own: one take of where the last night stopped)
    const said = idea || (night ? night.last.line : "");
    const keep = (id: string) => keepNightOn(id, outline);
    if (camera === "house") {
      return generateHouseTake({
        shopId: opts.shopId, ...(ready ? { scareKey: ready } : { idea: said, from: card?.key, room: outline?.moments[outline.moments.length - 1]?.room || night?.last.rooms[night.last.rooms.length - 1] }),
        lapse: opts.lapse, ir: opts.ir, section: opts.section, jobId: opts.jobId,
        resume: { ckScare: resume("ckScare"), ckHouse: resume("ckHouse"), ckSet: resume("ckSet"), ckScene: resume("ckScene"), ckRoll: resume("ckRoll"), ckRaw: resume("ckRaw"), ckHost: resume("ckHost"), ckSpoke: resume("ckSpoke"), ckCut: resume("ckCut") },
      }).then(keep);
    }
    return generateTake({
      shopId: opts.shopId, ...(ready ? { ideaKey: ready } : { idea: said, from: card?.key }), camera, aspect, section: opts.section, jobId: opts.jobId,
      resume: { ckTake: resume("ckTake"), ckStill: resume("ckStill"), ckOpens: resume("ckOpens"), ckRoll: resume("ckRoll"), ckRaw: resume("ckRaw"), ckHost: resume("ckHost"), ckSpoke: resume("ckSpoke"), ckCuts: resume("ckCuts"), ckTrim: resume("ckTrim") },
    }).then(keep);
  };

  // 1) THE OUTLINE and 2) THE DIRECTION — kept as ckFo the moment each exists
  const kept = readJson(resume("ckFo"));
  if (kept && typeof kept.single === "string") return oneTake(kept.single, cleanFootageOutline(kept.outline));
  let outline = approved || cleanFootageOutline(kept?.outline);
  if (!outline) {
    if (!String(opts.idea || "").trim() && !footageFrom(opts.from, camera) && !night) throw new Error("[footage-film] nothing to film: no outline, and no idea to write one from");
    try { outline = await writeFootageOutline({ idea: opts.idea || "", camera, aspect, count: momentCount(opts.moments ?? 3), from: opts.from, night }); }
    catch (e) { return oneTake(`the outline could not be written (${short(e, 80)})`); }
  }
  if (outline.moments.length < 2) return oneTake("the outline has one moment", outline);
  // (the day the footage is "found" and the seed its clocks' seconds are picked by: kept, so a film resumed after
  //  midnight prints the dates it began with)
  const today = text(kept?.today) || camToday();
  const seed = kept?.seed != null && Number.isFinite(Number(kept?.seed)) ? Number(kept?.seed) : seedOf(`${opts.jobId || stamp()}${outline.title}`);
  let direction: FootageDirection = Array.isArray(kept?.direction) && kept.direction.length === outline.moments.length ? (kept.direction as FootageDirection) : [];
  if (!direction.length) {
    await ckpt({ ckFo: JSON.stringify({ v: 1, outline, today, seed }) });
    direction = await directFootage(outline);
    if (direction.filter(Boolean).length < 2) return oneTake("the direction came back with fewer than two moments", outline);
    await ckpt({ ckFo: JSON.stringify({ v: 1, outline, today, seed, direction }) });
  }
  const film = outline;
  const clocks = footageClocks(film.moments.map((m) => m.when), today, seed);

  // every moment's own record, and its one writer
  const records: MomentRecord[] = film.moments.map((_, i) => (readJson(resume(`ckFm${i}`)) as MomentRecord | null) || {});
  // (ckTake / ckScare are the moment's direction, which ckFo already holds: not kept twice)
  const save = (i: number, patch: Record<string, unknown>): Promise<void> => {
    const { ckTake: _take, ckScare: _scare, ...own } = patch;
    if (!Object.keys(own).length) return writing;
    Object.assign(records[i], own);
    return ckpt({ [`ckFm${i}`]: JSON.stringify(records[i]) });
  };
  const leave = (i: number, why: string): Promise<void> => {
    console.error(`[footage-film] moment ${i + 1} is left out: ${why}`);
    return save(i, { left: why.slice(0, 160) });
  };
  const live = (): number[] => direction.map((d, i) => (d && !records[i].left ? i : -1)).filter((i) => i >= 0);
  direction.forEach((d, i) => { if (!d && !records[i].left) records[i].left = "its direction could not be written"; });
  const finished = (i: number): MadeMoment | null => { const d = records[i].done; return d && d.out && fs.existsSync(path.join(dir, d.out)) ? d : null; };

  // A ROLL AGAIN: one for any moment, FOOTAGE_REROLLS for the whole film (and none at all when TAKE_REROLLS=0)
  let again = Math.max(0, FOOTAGE_REROLLS - records.reduce((n, r) => n + (Number(r.rerolls) || 0), 0));
  const mayRoll = (i: number) => () => (rerolls() > 0 && again > 0 && !(Number(records[i].rerolls) > 0) ? 1 : 0);
  const rolledAgain = (i: number) => () => { again--; void save(i, { rerolls: (Number(records[i].rerolls) || 0) + 1 }); };
  // (how many times a moment was rolled, for its record: what its maker counted — or, when the job was resumed after
  //  its roll and the maker rolled nothing, the one it has and any it was rolled again)
  const rolled = (i: number, counted: number) => counted || 1 + (Number(records[i].rerolls) || 0);

  // THE JOB IS ALIVE while its rolls are in the air: a roll can take twenty minutes, and the queue's reaper reads a
  // row untouched for twenty-five as abandoned
  const alive = setInterval(() => { void ckpt({ ckFbeat: Date.now() }); }, 4 * 60_000);
  if (typeof alive.unref === "function") alive.unref();
  let house: KeptHouse | null = null;
  // (what this footage's NEXT night is drawn from — the place's first still and the thing's: kept on the piece, S10c)
  let placeShot = "", filmThing = "";
  try {
    if (camera === "house") {
      // 3+4) A HOUSE CAMERA: one moment after another — the house (its rooms, drawn once) is kept from each to the
      //      next, and the picture the thing was first drawn in is the second reference of every later moment
      //      (on a next night, the one the series' thing was drawn in: the same one walks in again — S10c)
      house = keptHouseOf(resume("ckFh")) || (await keptHouseFor(opts.shopId));
      let thingPic = resume("ckFt") || carriedThing;
      for (const i of live()) {
        if (finished(i)) continue;
        const d = direction[i] as Extract<DirectedMoment, { cam: "house" }>;
        try {
          const m = await makeHouseTake({
            shopId: opts.shopId, scare: d.scare, room: d.scare.room, seconds: film.moments[i].seconds,
            lapse: opts.lapse === true && d.lapse, ir: opts.ir, clock: clocks[i], best: true,
            ...(d.seen && thingPic ? { thingPic } : {}),
            rerolls: mayRoll(i), onReroll: rolledAgain(i),
            resume: { ckHouse: text(records[i].ckHouse), ckSet: text(records[i].ckSet), ckScene: text(records[i].ckScene), ckRoll: text(records[i].ckRoll), ckRaw: text(records[i].ckRaw), ckHost: text(records[i].ckHost), ckSpoke: text(records[i].ckSpoke) },
            house,
          }, (patch) => save(i, patch));
          house = m.house;
          if (d.seen && !thingPic) { thingPic = m.scene; await ckpt({ ckFt: thingPic }); }
          await ckpt({ ckFh: JSON.stringify(house) });
          const done: MadeMoment = { out: m.outName, raw: m.rawName, dressed: m.dressed, host: m.host, rolls: rolled(i, m.rolls), still: m.scene, opens: m.set, lines: null, spoke: m.spoke, direction: m.direction.slice(0, 2400), cam: m.cam, room: d.scare.room };
          await save(i, { done });
        } catch (e) { await leave(i, `it would not roll (${short(e, 100)})`); }
      }
      filmThing = thingPic;
    } else {
      // 3) THE PICTURES — on the strongest picture model at 2K. The place first (from words), then the thing's payoff
      //    (from the place), then the rest three at a time (from both); a scene that will not draw leaves its moment out
      // (…EVERYBODY IN IT CLOTHED, 2026-11-25: each moment's words dressed where they put somebody in water, its picture
      //  looked at, drawn again clothes first, dressed by one edit — take.server.ts → drawClothed — and the picture that
      //  is used is the one its record keeps; the ways in, drawn from these with nobody in them, need nothing)
      const drawScene = async (i: number, refs: string[]): Promise<void> => {
        const d = direction[i] as Extract<DirectedMoment, { cam: "hand" }>;
        const prompt = footageScenePrompt(film, { still: dressedInWater(d.take.still), seen: d.seen, who: d.take.who }, refs.length as 0 | 1 | 2);
        try { await save(i, { ckStill: await drawClothed({ prompt, ...(refs.length ? { image_input: refs.map((r) => imageRef(base, r)) } : {}), aspect_ratio: aspect, output_format: "jpg" }, true, `[footage-film] moment ${i + 1}'s scene:`) }); }
        catch (e) { await leave(i, `its picture would not draw (${short(e, 100)})`); }
      };
      // (the thing is drawn up close once and then handed on — only when there IS one thing that recurs: a scare whose
      //  writer named none has a different something in each moment it is seen in, each drawn from the place alone)
      // (A NEXT NIGHT, S10c: its first still is drawn FROM the carried place — "refs 1", the same place — and any moment
      //  the thing is in FROM the carried thing too — "refs 2", the same one. Nothing carried: as a first night is drawn.)
      const thingIn = (i: number): boolean => !!film.thing && !!(direction[i] as DirectedMoment | null)?.seen;
      for (;;) {
        const plan = footageScenePlan(direction.map((d, i) => (d && d.cam === "hand" && !records[i].left ? d.seen && !!film.thing : null)));
        if (!plan) break;
        if (!text(records[plan.place].ckStill)) { await drawScene(plan.place, carriedPlace ? [carriedPlace, ...(carriedThing && thingIn(plan.place) ? [carriedThing] : [])] : []); continue; }
        const placePic = text(records[plan.place].ckStill) as string;
        placeShot = placePic;
        if (plan.thing !== null && plan.thing !== plan.place && !text(records[plan.thing].ckStill)) { await drawScene(plan.thing, carriedThing ? [placePic, carriedThing] : [placePic]); continue; }
        const thingPic = carriedThing || (plan.thing !== null && plan.thing !== plan.place ? text(records[plan.thing].ckStill) : undefined);
        filmThing = carriedThing || (plan.thing !== null ? text(records[plan.thing].ckStill) || "" : "");
        await inTurns(plan.rest.filter((i) => !text(records[i].ckStill)), FOOTAGE_ROLLS_AT_ONCE, (i) => drawScene(i, (direction[i] as DirectedMoment).seen && thingPic ? [placePic, thingPic] : [placePic]));
        break;
      }
      // …and each moment's WAY IN, from its own scene ("-": it would not draw, and the moment starts on its scene)
      await inTurns(live().filter((i) => !text(records[i].ckOpens)), FOOTAGE_ROLLS_AT_ONCE, async (i) => {
        const d = direction[i] as Extract<DirectedMoment, { cam: "hand" }>;
        let opens = "-";
        try { opens = await drawPicture({ prompt: footageOpensPrompt(film, d.take), image_input: [imageRef(base, text(records[i].ckStill) as string)], aspect_ratio: aspect, output_format: "jpg" }, true); }
        catch (e) { console.error(`[footage-film] moment ${i + 1}'s way in would not draw — it starts on its scene: ${short(e, 100)}`); }
        await save(i, { ckOpens: opens });
      });

      // 4) THE TAKES — three rolling at once, their encodes taking turns with every other job's (ffmpeg-turn.ts)
      await inTurns(live().filter((i) => !finished(i)), FOOTAGE_ROLLS_AT_ONCE, async (i) => {
        const d = direction[i] as Extract<DirectedMoment, { cam: "hand" }>;
        const r = records[i];
        try {
          const m = await makeTake({
            shopId: opts.shopId, camera, aspect,
            // (its parts and its two pictures arrive made: makeTake writes and draws nothing for a film)
            resume: { ckTake: JSON.stringify(d.take), ckStill: text(r.ckStill), ckOpens: text(r.ckOpens), ckRoll: text(r.ckRoll), ckRaw: text(r.ckRaw), ckHost: text(r.ckHost), ckSpoke: text(r.ckSpoke), ckCuts: text(r.ckCuts), ckTrim: text(r.ckTrim) },
            rerolls: mayRoll(i), onReroll: rolledAgain(i),
            turn: ffmpegTurn,
            look: lookFor(camera, clocks[i]),
          }, (patch) => save(i, patch));
          const done: MadeMoment = {
            out: m.outName, raw: m.rawName, dressed: !!m.dressed, host: m.host, rolls: rolled(i, m.rolls), ...(m.cuts.length ? { cuts: m.cuts } : {}), ...(m.trimmed ? { trimmed: m.trimmed } : {}),
            still: m.still, opens: m.firstFrame === m.still ? null : m.opens, lines: m.voiced?.lines || null, spoke: m.spoke, direction: m.direction(TAKE_REF.replicate).slice(0, 2400),
          };
          await save(i, { done });
        } catch (e) { await leave(i, `it would not roll (${short(e, 100)})`); }
      });
    }
  } finally { clearInterval(alive); }
  await writing;

  // what was made, in order
  const made = film.moments.map((_, i) => ({ i, m: finished(i) })).filter((x): x is { i: number; m: MadeMoment } => !!x.m);
  // (nothing at all: the one take is tried, the way it is always made — and if that cannot be made either, the job fails)
  if (!made.length) return oneTake("no moment of the film could be made", film);

  // 5+6) THE CARDS AND THE JOIN — measured, or the job fails here. ONE moment left is the piece as it is: one take.
  let outName = made[0].m.out, seconds = film.moments[made[0].i].seconds, starts = [0], cards = false;
  if (made.length > 1) {
    const kept = text(resume("ckFj")), joined = kept ? readJson(kept) : null;
    const reuse = joined && typeof joined.name === "string" && fs.existsSync(path.join(dir, joined.name)) && Array.isArray(joined.starts) && joined.starts.length === made.length;
    const j = reuse
      ? (joined as unknown as Awaited<ReturnType<typeof joinFootage>>)
      : await joinFootage(made.map((x) => ({ file: path.join(dir, x.m.out), when: film.moments[x.i].when })));
    if (!reuse) {
      // THE LEVEL every film plays at — where somebody speaks. A house camera's film is the room alone: levelled, it
      // would be turned up into hiss (house-take.server.ts does not level one take either)
      if (camera !== "house") { try { await levelFilm(path.join(dir, j.name)); } catch { /* left as it was */ } }
      try { await mirrorRender(j.name, fs.readFileSync(path.join(dir, j.name))); } catch { /* the disk copy is what is used */ }
      await ckpt({ ckFj: JSON.stringify(j) });
      await writing;
    }
    outName = j.name; seconds = j.seconds; starts = j.starts; cards = j.cards;
  } else {
    seconds = Math.round((pictureOf(path.join(dir, outName)).seconds || seconds) * 100) / 100;
  }

  // 7) THE PIECE
  const at = (k: number, t: number) => Math.round((starts[k] + t) * 100) / 100;
  const lines = made.flatMap((x, k) => (x.m.lines || []).map((l) => ({ ...l, at: at(k, l.at) })));
  const heardAny = made.some((x) => x.m.spoke !== null);
  const spoke = heardAny ? made.flatMap((x, k) => (x.m.spoke || []).map((l) => ({ ...l, at: at(k, l.at) }))) : null;
  const madeAt = new Map(made.map((x) => [x.i, x.m]));
  // WHAT ITS NEXT NIGHT NEEDS (S10c — film-series.ts → footageNightRecord): the moments as they were made, after the
  // footage before them; the series' own pictures first (every night is drawn from the same place and the same one as
  // the first), else this footage's — its place's first still and its thing's
  const nextNight = footageNightRecord({
    camera, aspect, kind: film.kind, place: film.place, thing: film.thing,
    moments: made.map((x) => film.moments[x.i]),
    placePic: carriedPlace || placeShot, thingPic: carriedThing || filmThing, night: night?.night, before: night?.last,
  });
  const asset = await db.asset.create({
    data: {
      shopId: opts.shopId,
      type: "VIDEO_AD",
      status: "PENDING",
      title: `Found Footage — ${String(film.title || "a film").slice(0, 60)}`,
      bodyJson: JSON.stringify({ style: "TAKE", videoUrl: `/renders/${outName}`, prompt: opts.idea || film.title || "", script: lines.map((l) => l.text).join(" … ") }),
      metaJson: JSON.stringify({
        // (`kind` stays "take": the Archive's footage family, its cover and its labels are a take's)
        kind: "take", template: "foundfootage", section: opts.section || "creator", aspect, seconds,
        // the job that made it (what waits for "my piece" asks for exactly this)
        ...(opts.jobId ? { jobId: opts.jobId } : {}),
        // what it was made on, in one line each — as a take's record has it (the moments' own are under `footage`)
        take: {
          ...(opts.from && footageFrom(opts.from, camera) ? { from: opts.from } : {}), camera, film: made.length > 1, moments: made.length,
          dressed: made.every((x) => x.m.dressed), host: [...new Set(made.map((x) => x.m.host).filter(Boolean))].join(" + "), rolls: made.reduce((n, x) => n + x.m.rolls, 0),
          still: made[0].m.still, raw: `/renders/${made[0].m.raw}`,
          ...(camera === "house" ? { ir: opts.ir !== false } : {}),
        },
        // THE FILM: what was outlined, and what became of every moment — its files, where it starts, or why it was left out
        footage: {
          v: 1, kind: film.kind, place: film.place, thing: film.thing,
          moments: film.moments.map((m, i) => {
            const done = madeAt.get(i), k = made.findIndex((x) => x.i === i);
            return {
              when: m.when, line: m.line, seconds: m.seconds, ...(m.room ? { room: m.room, roomName: houseRoom(m.room)?.name } : {}),
              ...(done
                ? { at: starts[k], raw: `/renders/${done.raw}`, out: `/renders/${done.out}`, still: done.still, opens: done.opens, host: done.host, rolls: done.rolls, ...(done.cuts?.length ? { cuts: done.cuts } : {}), ...(done.trimmed ? { trimmed: done.trimmed } : {}), ...(done.cam ? { cam: done.cam } : {}), clock: clocks[i], direction: done.direction }
                : { left: String(records[i].left || "it was not made") }),
            };
          }),
          cards,
        },
        // THE HOUSE as it now stands (a house camera's film): the next house take starts here
        ...(camera === "house" && house ? { house } : {}),
        // A NEXT NIGHT is an episode of its series — grouped and numbered in the Archive as a film series is (S10c)
        ...(night ? { series: seriesMeta(night) } : {}),
        // …and every piece says what ITS next night needs
        ...(nextNight ? { nextNight } : {}),
        // what the one filming says, and when in the FILM — laid on afterwards (null: nobody speaks in it)
        lines: lines.length ? lines : null,
        // what the listening model heard in the takes AS THE ENGINE MADE THEM — it is given no words, so this
        // should be empty (null = none of them could be heard)
        spoke,
      }),
    },
  });
  await ckpt({ ckFa: asset.id });
  await writing;
  return asset.id;
}
