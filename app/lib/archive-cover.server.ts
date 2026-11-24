/* THE ARCHIVE'S COVERS — drawn on demand, one piece at a time (the families and their graphs are in
 * archive-cover.ts).
 *
 * No pipeline makes these. The Archive asks for a cover when it shows a piece that has none (POST
 * /web/archive-cover), and the tile shows what it always showed until the cover is there. So every piece
 * already on the shelf gets one the first time it is looked at, and every new one the first time it is seen.
 *
 *   · ONE ffmpeg frame from what the piece already has: a story's own picture, an acted film's cast or one of
 *     its shots, a frame from inside a video (chosen, never its first second), a track's own sound. No model
 *     is asked — it costs nothing.
 *   · Never two for one piece at once (a second ask waits for the first); a few at a time across the server,
 *     and a short queue beyond that ("busy" — the page asks again later).
 *   · Nothing for a piece whose media is not on our own disk (a provider's address dies within the hour) or is
 *     marked gone.
 *   · A failure changes nothing on the piece: no record is written, the tile keeps its first frame, and this
 *     process does not try that piece again for a while.
 *   · Written beside, then moved into place (a half-written file is never served), copied to object storage
 *     where that is on, and recorded on the piece's meta (`cover`) by compare-and-swap — a keep, a share or a
 *     caption written meanwhile is never lost.
 * Web requests are not jobs, so these encodes do not wait behind a film's (ffmpeg-turn.ts) — the same as a
 * video's first-frame thumbnail. */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { db } from "../db.server";
import { ffmpegBin, ffprobeBin, resolveTextFont } from "./ugc-ad-pipeline.server";
import { mirrorRender } from "./object-storage.server";
import { posterOf, posterScene } from "./story-poster";
import {
  COVER_HELD, COVER_VERSION, bestFrame, coverGraph, coverKind, coverName, coverOf, coverText, coverWords, creatorChannel, frameStats, frameTimes,
  framesGraph, localMedia, posterIsCover, safeBox, seedOf, type CoverKind, type CoverPicture, type CoverSpec,
} from "./archive-cover";

const RENDERS = () => path.join(process.cwd(), "data", "renders");

/** How many covers are drawn at once on this server, and how many more may wait their turn. */
export const COVER_AT_ONCE = 2;
export const COVER_WAITING_MAX = 12;
/** A piece whose cover could not be drawn is not tried again by this process for this long. */
export const COVER_RETRY_MS = 6 * 60 * 60_000;
/** The longest one ffmpeg run of a cover may take before it is stopped. */
const RUN_MS = 45_000;

export type CoverResult = { ok: true; cover: string } | { ok: false; why: string };

const drawing = new Map<string, Promise<CoverResult>>();
const failed = new Map<string, number>(); // a piece → when it may be tried again
let running = 0;
const queue: Array<() => void> = [];

/** A failure that is not the piece's own (the database, a process that would not start) is tried again soon. */
export const COVER_RETRY_ERROR_MS = 10 * 60_000;

/** True when this piece's cover failed lately (the loader does not ask for it again meanwhile). */
export function coverFailedLately(assetId: string, now = Date.now()): boolean {
  const until = failed.get(assetId);
  if (until == null) return false;
  if (now >= until) { failed.delete(assetId); return false; }
  return true;
}

/** MAKE ONE PIECE'S COVER (or return the one it has). Never throws. */
export function makeArchiveCover(o: { shopId: string; assetId: string }): Promise<CoverResult> {
  const key = o.assetId;
  const same = drawing.get(key);
  if (same) return same; // never two for one piece at once: a second ask gets the first's answer
  if (coverFailedLately(key)) return Promise.resolve({ ok: false, why: "failed-lately" });
  if (running + queue.length >= COVER_AT_ONCE + COVER_WAITING_MAX) return Promise.resolve({ ok: false, why: "busy" });
  const p = (async (): Promise<CoverResult> => {
    // (what needs no ffmpeg is answered at once — a piece with its cover already, one that wants none —
    //  and only the drawing waits for a turn)
    const plan = await planCover(o);
    if (!("draw" in plan)) return plan;
    // (asked again now: a burst of asks all pass the door before any of them has read its piece)
    if (running + queue.length >= COVER_AT_ONCE + COVER_WAITING_MAX) return { ok: false, why: "busy" };
    if (running >= COVER_AT_ONCE) await new Promise<void>((go) => queue.push(go));
    running++;
    try { return await plan.draw(); }
    finally { running--; const next = queue.shift(); if (next) next(); }
  })()
    .catch((e): CoverResult => ({ ok: false, why: `error: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}` }))
    .then((r) => {
      // (only a real failure is remembered — the piece's own for hours, anything else for minutes; a piece that
      //  simply wants no cover is answered at once anyway)
      if (!r.ok && /^(error|draw|no-picture|missing|font)/.test(r.why)) failed.set(key, Date.now() + (r.why.startsWith("error") ? COVER_RETRY_ERROR_MS : COVER_RETRY_MS));
      if (!r.ok && !/^(busy|failed-lately|has-poster|held|not-|gone|expired)/.test(r.why)) console.error(`[cover] ${key}: ${r.why}`);
      return r;
    })
    .finally(() => drawing.delete(key));
  drawing.set(key, p);
  return p;
}

type Obj = Record<string, unknown>;
const parse = (s: string | null | undefined): Obj => { try { const o = JSON.parse(s || "{}"); return o && typeof o === "object" && !Array.isArray(o) ? (o as Obj) : {}; } catch { return {}; } };
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** A picture or a video of OURS, as a file on this disk: a render, an upload, a stock portrait. By its bare
 *  name only — a name that could climb out of its folder is never joined to a path. null when it is not here. */
export function localFile(url: unknown): string | null {
  const raw = str(url);
  if (!raw) return null;
  const p = raw.replace(/^https?:\/\/[^/]+/, "").split(/[?#]/)[0];
  const name = path.basename(p);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.(?:jpe?g|png|webp|mp4|mov|webm|m4v|mp3|m4a|wav)$/i.test(name) || name.includes("..")) return null;
  const candidates = p.startsWith("/renders/") ? [path.join(RENDERS(), name)]
    : p.startsWith("/uploads/") ? [path.join(RENDERS(), "uploads", name)]
    : p.startsWith("/avatars/") ? [path.join(process.cwd(), "public", "avatars", name), path.join(process.cwd(), "build", "client", "avatars", name)]
    : [];
  return candidates.find((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } }) || null;
}

/** Run ffmpeg or ffprobe, never blocking this process, stopped at a ceiling: its status, what it printed, its errors. */
function run(bin: string, args: string[], ms = RUN_MS): Promise<{ status: number; out: Buffer; err: string }> {
  return new Promise((resolve) => {
    let p: ReturnType<typeof spawn>;
    try { p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { resolve({ status: -1, out: Buffer.alloc(0), err: String(e) }); return; }
    const chunks: Buffer[] = [];
    let size = 0, err = "";
    const timer = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* gone */ } }, ms);
    p.stdout?.on("data", (c: Buffer) => { if (size < 8 << 20) { chunks.push(c); size += c.length; } });
    p.stderr?.on("data", (c: Buffer) => { err = (err + c.toString()).slice(-4000); });
    p.on("error", (e) => { clearTimeout(timer); resolve({ status: -1, out: Buffer.alloc(0), err: String(e) }); });
    p.on("close", (code) => { clearTimeout(timer); resolve({ status: code ?? -1, out: Buffer.concat(chunks), err }); });
  });
}

/** A file's picture size and length (0 when it has none). */
async function probe(file: string): Promise<{ w: number; h: number; d: number }> {
  const r = await run(ffprobeBin(), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], 15_000);
  try {
    const j = JSON.parse(r.out.toString("utf8") || "{}") as { streams?: Array<{ width?: number; height?: number }>; format?: { duration?: string } };
    const s = j.streams?.[0] || {};
    return { w: Number(s.width) || 0, h: Number(s.height) || 0, d: Number(j.format?.duration) || 0 };
  } catch { return { w: 0, h: 0, d: 0 }; }
}

/** One candidate picture: a still, or a moment of a video. */
type Candidate = { file: string; t?: number };
/** What the cover is drawn from: ffmpeg's inputs, and the picture's shape and safe part. */
type Source = { inputs: string[]; picture: CoverPicture | null; portraits?: CoverPicture[]; still?: boolean };

/** THE BEST OF SEVERAL PICTURES: each shrunk to a strip of grey, side by side in ONE ffmpeg run, and scored
 *  (bright enough, something in it, not mostly black, no bars) — the picture worth a cover, and where its
 *  bars end. `captioned`: these are frames of a finished video, so the cover stays above its captions. */
async function bestOf(cands: Candidate[], captioned: boolean, at?: number[], known?: { w: number; h: number }): Promise<Source | null> {
  const list = cands.slice(0, 8);
  if (!list.length) return null;
  const dims = known && known.w > 0 ? known : await probe(list[0].file);
  if (!(dims.w > 0 && dims.h > 0)) return null;
  const W = 48, H = Math.max(2, Math.round((W * dims.h) / dims.w / 2) * 2);
  const args = ["-v", "error"];
  for (const c of list) { if (c.t != null) args.push("-ss", c.t.toFixed(2)); args.push("-i", c.file); }
  args.push("-filter_complex", framesGraph(list.length, W, H), "-map", "[o]", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-");
  const r = await run(ffmpegBin(), args);
  let i = Math.floor(list.length / 2);
  let frame: { top: number; bottom: number; mean?: number; edge?: number } = { top: 0, bottom: 1 };
  if (r.status === 0 && r.out.length >= W * H * list.length) {
    const gray = new Uint8Array(r.out.buffer, r.out.byteOffset, r.out.length);
    const stats = list.map((_, k) => frameStats(gray, W * list.length, H, k * W, W));
    const k = bestFrame(stats, at);
    if (k >= 0) i = k;
    frame = stats[i];
  }
  // (the chosen picture's own size: candidates from several shots need not share one)
  const own = list[i].file === list[0].file ? dims : await probe(list[i].file);
  const size = own.w > 0 ? own : dims;
  const c = list[i];
  return { inputs: [...(c.t != null ? ["-ss", c.t.toFixed(2)] : []), "-i", c.file], picture: { w: size.w, h: size.h, safe: safeBox(size, frame, captioned), ...(frame.mean != null ? { mean: Math.round(frame.mean) } : {}), ...(frame.edge != null ? { edge: Math.round(frame.edge) } : {}) } };
}

/** Frames from inside a video: a few moments across its middle, the best of them. */
async function fromVideo(file: string, captioned: boolean): Promise<Source | null> {
  const dims = await probe(file);
  const times = frameTimes(dims.d, 6);
  return bestOf(times.map((t) => ({ file, t })), captioned, times.map((t) => (dims.d > 0 ? t / dims.d : 0.5)), dims);
}

/** A still, as it is. */
async function fromStill(file: string): Promise<Source | null> {
  const s = await probe(file);
  return s.w > 0 && s.h > 0 ? { inputs: ["-i", file], picture: { w: s.w, h: s.h, safe: { top: 0, bottom: 1 } } } : null;
}

/** A told story's own picture — the one with most of its cast in it, as its poster would have chosen. */
async function storyStill(meta: Obj, body: Obj, names: ReadonlyArray<string>): Promise<Source | null> {
  const pics = Array.isArray(meta.pictures) ? meta.pictures : [];
  const files = pics.map((u) => localFile(u));
  if (!files.some(Boolean)) return null;
  const scenes = Array.isArray((body.treatment as Obj | undefined)?.scenes) ? ((body.treatment as Obj).scenes as unknown[]) : [];
  const visuals = files.map((_, i) => str((scenes[i] as Obj | undefined)?.visual));
  const k = posterScene(visuals, [...names], files.map((f) => !!f));
  const file = k >= 0 ? files[k] : files.find(Boolean);
  if (!file) return null;
  const s = await fromStill(file);
  return s ? { ...s, still: true } : null;
}

/** An acted film's shots (each one's middle — a shot is caption-free: the film's captions are drawn at the cut). */
async function fromShots(meta: Obj): Promise<Source | null> {
  const shots = (Array.isArray(meta.shots) ? meta.shots : []).map((s) => localFile((s as Obj | undefined)?.url)).filter((f): f is string => !!f);
  if (!shots.length) return null;
  const pick = shots.length <= 6 ? shots : Array.from({ length: 6 }, (_, i) => shots[Math.round((i * (shots.length - 1)) / 5)]);
  const durs = await Promise.all(pick.map((f) => probe(f)));
  return bestOf(pick.map((file, i) => ({ file, t: Math.max(0, durs[i].d * 0.55) })), false, pick.map((_, i) => (i + 0.5) / pick.length));
}

/** An acted film's cast, as the member cast them: their own portraits (three at most). */
async function castPortraits(meta: Obj): Promise<Source | null> {
  const cast = Array.isArray(meta.cast) ? meta.cast : [];
  const files = [...new Set(cast.map((c) => localFile((c as Obj | undefined)?.faceUrl)).filter((f): f is string => !!f))].slice(0, 3);
  if (!files.length) return null;
  const dims = await Promise.all(files.map((f) => probe(f)));
  if (dims.some((d) => !(d.w > 0 && d.h > 0))) return null;
  return { inputs: files.flatMap((f) => ["-i", f]), picture: null, portraits: dims.map((d) => ({ w: d.w, h: d.h, safe: { top: 0, bottom: 1 } })) };
}

/** WHERE THE COVER'S PICTURE COMES FROM, family by family — the first of these that this disk has. */
async function sourceFor(kind: CoverKind, meta: Obj, body: Obj, media: string, names: ReadonlyArray<string>, audio: boolean): Promise<Source | null> {
  if (audio) return { inputs: ["-i", media], picture: null };
  const told = str(meta.kind) === "narrated";
  const tries: Array<() => Promise<Source | null>> = [];
  switch (kind.family) {
    case "story": tries.push(() => storyStill(meta, body, names)); break;
    case "horror": tries.push(() => (told ? storyStill(meta, body, names) : fromShots(meta))); break;
    case "film": tries.push(() => castPortraits(meta), () => fromShots(meta)); break;
    case "ad": {
      const keys = [...(Array.isArray(body.keyframeUrls) ? body.keyframeUrls : []), body.keyframeUrl].map((u) => localFile(u)).filter((f): f is string => !!f && /\.(jpe?g|png|webp)$/i.test(f));
      if (keys.length) tries.push(() => bestOf(keys.map((file) => ({ file })), false));
      break;
    }
    case "footage": {
      const take = (meta.take && typeof meta.take === "object" ? meta.take : {}) as Obj;
      const still = localFile(take.still), raw = localFile(take.raw);
      if (still && /\.(jpe?g|png|webp)$/i.test(still)) tries.push(() => fromStill(still));
      // (a take opens OFF its subject and turns to it — its frames from the second half)
      if (raw) tries.push(async () => { const dims = await probe(raw); return bestOf(frameTimes(dims.d, 6).filter((t) => t >= dims.d * 0.45).map((t) => ({ file: raw, t })), false, undefined, dims); });
      break;
    }
    default: break;
  }
  // …and always, last: frames from inside the finished video — above its captions (a Creator video made
  // from a description has none)
  const captioned = !(kind.family === "creator" && meta.creative === true);
  tries.push(() => fromVideo(media, captioned));
  for (const t of tries) {
    try { const s = await t(); if (s) return s; } catch { /* the next one */ }
  }
  return null;
}

/** The date a piece was made, as a camera stamps it — digits only, in the shop's own time when it has one. */
function stampOf(at: Date, timeZone?: string | null): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
    const g = (t: string) => parts.find((p) => p.type === t)?.value || "00";
    return `${g("year")}.${g("month")}.${g("day")}  ${g("hour")}:${g("minute")}`;
  } catch { return at.toISOString().slice(0, 16).replace(/-/g, ".").replace("T", "  "); }
}

/** WHETHER, AND FROM WHAT: the piece read (this shop's own), every reason to make nothing answered here — and
 *  otherwise the drawing, to be run when its turn comes. */
async function planCover(o: { shopId: string; assetId: string }): Promise<CoverResult | { draw: () => Promise<CoverResult> }> {
  const a = await db.asset.findFirst({ where: { id: o.assetId, shopId: o.shopId }, select: { id: true, type: true, title: true, createdAt: true, metaJson: true, bodyJson: true, shop: { select: { timezone: true } } } });
  if (!a) return { ok: false, why: "gone" };
  const meta = parse(a.metaJson), body = parse(a.bodyJson);
  const piece = { type: a.type, title: a.title, meta, body };
  const kind = coverKind(piece);
  if (!kind) return { ok: false, why: "not-a-video" };
  // (a family whose design is being drawn again is not drawn at all meanwhile — whoever asks)
  if (COVER_HELD.has(kind.family)) return { ok: false, why: "held" };
  const audio = a.type === "AUDIO";
  const name = localMedia(str(audio ? body.audioUrl : body.videoUrl));
  if (!name) return { ok: false, why: "not-local" };
  if (body.needsRegen === true) return { ok: false, why: "expired" };
  if (posterOf(meta) && posterIsCover(kind.family)) return { ok: false, why: "has-poster" };
  const had = coverOf(meta);
  if (had && had.v >= COVER_VERSION[kind.family] && fs.existsSync(path.join(RENDERS(), path.basename(had.src)))) return { ok: true, cover: had.src };
  const media = path.join(RENDERS(), name);
  if (!fs.existsSync(media)) return { ok: false, why: "missing" };
  return { draw: () => drawCover(o, a, { meta, body, piece, kind, audio, name, media }) };
}

type Read = { meta: Obj; body: Obj; piece: { type: string; title: string | null; meta: Obj; body: Obj }; kind: CoverKind; audio: boolean; name: string; media: string };
async function drawCover(o: { shopId: string; assetId: string }, a: { id: string; title: string | null; createdAt: Date; shop?: { timezone: string | null } | null }, r0: Read): Promise<CoverResult> {
  const { meta, body, piece, kind, audio, name, media } = r0;
  const words = coverWords(piece, kind);
  const source = await sourceFor(kind, meta, body, media, words.names, audio);
  if (!source) return { ok: false, why: "no-picture" };
  // its length, as a player shows it (an ad's chip, a Creator video's line, a take's clock)
  const seconds = Number(meta.seconds) || Number(meta.lengthSec) || (kind.family === "ad" || kind.family === "creator" ? Math.round((await probe(media)).d) : 0);
  // AN AD's product, as its own photo shows it — the photo it was made from, or a service's end card — when
  // that is a picture of ours on this disk (the next input after the cover's picture)
  const shot = kind.family === "ad" ? [meta.productImageUrl, meta.endcardUrl].map((u) => localFile(u)).find((f) => !!f && /\.(jpe?g|png|webp)$/i.test(f)) || null : null;
  const packshot = shot ? await bestOf([{ file: shot }], false) : null;
  const spec: Omit<CoverSpec, "font"> = {
    kind, title: words.title, names: words.names, picture: source.picture, portraits: source.portraits, still: source.still,
    ...(kind.family === "footage" ? { stamp: stampOf(a.createdAt, a.shop?.timezone), seconds } : {}),
    ...(kind.family === "ad" || kind.family === "creator" ? { seconds } : {}),
    ...(packshot?.picture ? { packshot: packshot.picture } : {}),
    ...(kind.family === "creator" ? { channel: creatorChannel(meta, body) } : {}),
    seed: seedOf(`${a.id}:${a.title || ""}`),
  };
  // (the captions' own rule: words no font here can draw → no cover, never boxes; it is tried again later)
  let font: string;
  try { font = await resolveTextFont(coverText(spec)); } catch (e) { return { ok: false, why: `font: ${e instanceof Error ? e.message.slice(0, 120) : e}` }; }
  const graph = coverGraph({ ...spec, font });

  const file = coverName(name, a.id, kind.family);
  const out = path.join(RENDERS(), file);
  const part = `${out}.${process.pid}-${Date.now()}.part`;
  const inputs = [...source.inputs, ...(packshot?.picture && shot ? ["-i", shot] : [])];
  const r = await run(ffmpegBin(), ["-y", "-v", "error", ...inputs, "-filter_complex", graph, "-map", "[out]", "-frames:v", "1", "-q:v", "3", "-f", "mjpeg", part]);
  let made = false;
  try {
    if (r.status === 0 && fs.statSync(part).size > 5000) { fs.renameSync(part, out); made = true; }
  } catch { /* not written */ }
  if (!made) { try { fs.rmSync(part, { force: true }); } catch { /* never written */ } return { ok: false, why: `draw: ffmpeg ${r.status}: ${r.err.slice(-240)}` }; }
  try { await mirrorRender(file, fs.readFileSync(out)); } catch { /* non-fatal, as everywhere else */ }

  // ON THE PIECE: its meta gains `cover` — written only over the meta it was read with, so nothing written
  // meanwhile (a keep, a share, a caption) is lost; a write that loses the race reads again and retries
  const src = `/renders/${file}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await db.asset.findFirst({ where: { id: a.id, shopId: o.shopId }, select: { metaJson: true } });
    if (!cur) return { ok: false, why: "gone" };
    const m = parse(cur.metaJson);
    if (m.cover === src) return { ok: true, cover: src };
    const saved = await db.asset.updateMany({ where: { id: a.id, shopId: o.shopId, metaJson: cur.metaJson }, data: { metaJson: JSON.stringify({ ...m, cover: src }) } });
    if (saved.count === 1) return { ok: true, cover: src };
  }
  return { ok: false, why: "busy" };
}
