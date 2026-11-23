/* A presenter's "character kit" — what the Presenters section shows when you open one of them:
 * a full-body still you can turn around like a character on a select screen, cut out of its
 * background so every presenter stands on the SAME backdrop.
 *
 * How a kit is made (each step proven by hand on the stock presenter "mei" first, 2026-11-17):
 *   1. full-body still   google/nano-banana from the half-body portrait — same face, hair, outfit
 *   2. turntable         bytedance/seedance-1-pro, the still as BOTH first and last frame with a locked
 *                        camera: the model turns the person through one full rotation and has to land
 *                        back on the exact frame it started from, so the sequence loops
 *   3. matte             arielreplicate/robust_video_matting → an alpha mask for every frame, run over the
 *                        clip forwards AND backwards and merged (fillMatte) so nothing that has just
 *                        come into view is left half see-through. That model only sees PEOPLE: a
 *                        character that is not one (a cartoon pup, a monster) is cut out frame by
 *                        frame with the portrait cut-out model instead (matteByFrames)
 *   4. frames            ffmpeg: alpha-merge, one shared crop (so the feet never slide), N WebP frames
 * and separately the head-and-shoulders portraits are cut out with 851-labs/background-remover.
 *
 * What did NOT work, so nobody tries it again: asking the camera to "orbit" (the clip stayed still),
 * image→3D mesh (TRELLIS: a waxwork, not the person), and the cheaper seedance-1-lite (rejects a last frame).
 *
 * This file imports nothing from the app on purpose. The stock cast's kits are built on a developer
 * machine by scripts/build-presenter-kits.ts and committed under public/kits/, a merchant's own
 * presenter is built on the server by presenter-kit.server.ts — both call the functions here. */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const KIT_FRAMES = 60;
export const KIT_FRAME_HEIGHT = 900;
/** Portrait cut-outs keep the portrait's own canvas (so every card frames its presenter the same way). */
export const KIT_PORTRAIT_WIDTH = 720;

const REP = "https://api.replicate.com/v1";
const NANO_BANANA = "google/nano-banana";
const SEEDANCE = "bytedance/seedance-1-pro";
// Community models are addressed by version; pinned so a new upload can't change a kit's look unannounced.
const MATTING_VERSION = "73d2128a371922d5d1abf0712a1d974be0e4e2358cc1218e4e34714767232bac"; // arielreplicate/robust_video_matting
const CUTOUT_VERSION = "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc"; // 851-labs/background-remover

export type KitTools = {
  /** Replicate API token. */
  token: string;
  ffmpeg: string;
  ffprobe: string;
  log?: (msg: string) => void;
  /** Runs an ffmpeg job when it is its turn. The server passes its one-at-a-time lane: two ffmpeg runs
   *  side by side (a build's matting pass next to the render worker) is how the box ran out of memory.
   *  Absent (the stock build script), ffmpeg just runs. */
  lane?: <T>(job: () => Promise<T>) => Promise<T>;
  /** Runs ONE ffmpeg process when no other encode is running anywhere in the server (ffmpeg-turn.ts).
   *  The lane above keeps two kit runs apart; it does not know about the render worker, and a build's
   *  matting pass (about 450 MB at full size) next to a film's encode is exactly the pair that ran the
   *  box out of memory. Applied to the single process, never to a whole job: the lane is re-entrant and
   *  wraps jobs made of many runs, and a turn taken around one of those would wait on itself. */
  turn?: <T>(run: () => Promise<T>) => Promise<T>;
};
const inLane = <T>(t: KitTools, job: () => Promise<T>): Promise<T> => {
  const alone = t.turn ? () => t.turn!(job) : job;
  return t.lane ? t.lane(alone) : alone();
};

export type KitSpin = {
  /** How many frames the rotation has. */
  frames: number;
  /** Pixel size of every frame. */
  w: number;
  h: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** An image the models can read: a public URL as it is, a local file as a data URI. */
export function imageRef(src: string): string {
  if (/^https?:\/\//i.test(src) || src.startsWith("data:")) return src;
  const ext = path.extname(src).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(src).toString("base64")}`;
}

/** Run one Replicate prediction to the end and return its (first) output URL. */
async function repRun(
  t: KitTools,
  target: { model: string } | { version: string },
  input: Record<string, unknown>,
  what: string,
  maxMs: number,
): Promise<string> {
  const headers = { Authorization: `Bearer ${t.token}`, "Content-Type": "application/json" };
  const url = "model" in target ? `${REP}/models/${target.model}/predictions` : `${REP}/predictions`;
  const body = JSON.stringify("model" in target ? { input } : { version: target.version, input });
  let id = "";
  let refused = "";
  let throttled = 0;
  for (let attempt = 0; attempt < 8 && !id; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers, body });
    } catch (e) {
      // the connection dropped before an answer — nothing was started, so asking again is safe
      refused = e instanceof Error ? e.message : String(e);
      await sleep(3000 + attempt * 2000);
      continue;
    }
    if (res.status === 429) {
      // "Slow down" is not a failure: wait as long as we are told and ask again, without using up
      // the tries kept for real trouble. (A turn cut out frame by frame is ~145 requests in a few
      // minutes; being held back is the normal state of affairs, and giving up after eight
      // refusals threw away turns that were three-quarters done.) Ten minutes of it is enough.
      const hint = Number(res.headers.get("retry-after"));
      refused = `429 ${(await res.text().catch(() => "")).slice(0, 160)}`;
      if (++throttled > 60) break;
      attempt--;
      await sleep((Number.isFinite(hint) && hint > 0 ? Math.min(hint, 30) : 8) * 1000 + 500 + Math.round(Math.random() * 1500));
      continue;
    }
    // A gateway hiccup (502 / 503 / 504, an HTML error page) is the provider's front door, not a
    // verdict on the request. A turn cut out frame by frame makes ~145 requests; before this was
    // retried, one such hiccup threw away the whole turn — five of the first six characters.
    if (res.status >= 500) {
      refused = `${res.status}`;
      await res.text().catch(() => "");
      await sleep(3000 + attempt * 3000);
      continue;
    }
    if (!res.ok) throw new Error(`[kit:${what}] create ${res.status}: ${(await res.text()).slice(0, 240)}`);
    id = ((await res.json()) as { id: string }).id;
  }
  if (!id) throw new Error(`[kit:${what}] could not start (${refused || "no answer"}) after 8 tries`);
  const started = Date.now();
  let unreadable = 0;
  while (Date.now() - started < maxMs) {
    await sleep(3500);
    type Poll = { status?: string; output?: unknown; error?: unknown };
    let j: Poll | null = null;
    try {
      const res = await fetch(`${REP}/predictions/${id}`, { headers });
      if (res.ok) j = (await res.json()) as Poll;
      else await res.text().catch(() => "");
    } catch { /* a bad poll never abandons a prediction that is still running */ }
    if (!j || typeof j.status !== "string") {
      if (++unreadable >= 12) throw new Error(`[kit:${what}] prediction unreadable ${unreadable}x in a row`);
      continue;
    }
    unreadable = 0;
    if (j.status === "succeeded") {
      const out = Array.isArray(j.output) ? j.output[0] : j.output;
      if (typeof out !== "string" || !out) throw new Error(`[kit:${what}] finished with no output`);
      t.log?.(`${what}: ${Math.round((Date.now() - started) / 1000)} s`);
      return out;
    }
    if (j.status === "failed" || j.status === "canceled") throw new Error(`[kit:${what}] ${String(j.error || j.status).slice(0, 240)}`);
  }
  throw new Error(`[kit:${what}] timed out after ${Math.round(maxMs / 1000)} s`);
}

async function save(url: string, file: string): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
      if (res.ok) { fs.writeFileSync(file, Buffer.from(await res.arrayBuffer())); return; }
      last = new Error(`[kit] download ${res.status}`);
      if (res.status < 500 && res.status !== 429) break; // gone or refused: asking again won't help
    } catch (e) { last = e; }
    await sleep(2000 + attempt * 3000);
  }
  throw last instanceof Error ? last : new Error("[kit] download failed");
}

/** No single run of a binary here is allowed past this. A wedged ffmpeg never ends by itself, and these
 *  runs hold a place in line that every other encode on the server is waiting behind (KitTools.turn).
 *  The heaviest real one — a full-size matting pass — takes a minute or two. */
const RUN_CEILING_MS = 10 * 60_000;

/** Run a binary without blocking the event loop (on the server this shares a process with every request). */
function run(bin: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const keep = (s: string, add: string) => (s + add).slice(-2_000_000); // ffmpeg is chatty; the tail is what matters
    const kill = setTimeout(() => { err = keep(err, `\n[kit] killed after ${RUN_CEILING_MS / 60_000} min (wedged)`); try { p.kill("SIGKILL"); } catch { /* already gone */ } }, RUN_CEILING_MS);
    p.stdout.on("data", (d) => { out = keep(out, String(d)); });
    p.stderr.on("data", (d) => { err = keep(err, String(d)); });
    p.on("error", (e) => { clearTimeout(kill); reject(e); });
    p.on("close", (code) => { clearTimeout(kill); resolve({ code: code ?? 1, out, err }); });
  });
}

/** The same, for a command whose stdout is raw bytes (frames piped out of ffmpeg). */
function runBytes(bin: string, args: string[]): Promise<{ code: number; out: Buffer; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let err = "";
    const kill = setTimeout(() => { err = (err + `\n[kit] killed after ${RUN_CEILING_MS / 60_000} min (wedged)`).slice(-20_000); try { p.kill("SIGKILL"); } catch { /* already gone */ } }, RUN_CEILING_MS);
    p.stdout.on("data", (d: Buffer) => { chunks.push(d); });
    p.stderr.on("data", (d) => { err = (err + String(d)).slice(-20_000); });
    p.on("error", (e) => { clearTimeout(kill); reject(e); });
    p.on("close", (code) => { clearTimeout(kill); resolve({ code: code ?? 1, out: Buffer.concat(chunks), err }); });
  });
}

async function ff(t: KitTools, args: string[], what: string): Promise<string> {
  const r = await inLane(t, () => run(t.ffmpeg, ["-hide_banner", "-y", ...args]));
  if (r.code !== 0) throw new Error(`[kit:${what}] ffmpeg failed: ${r.err.slice(-400)}`);
  return r.err;
}

async function probe(t: KitTools, file: string): Promise<{ w: number; h: number; frames: number }> {
  const r = await run(t.ffprobe, ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=width,height,nb_read_frames", "-of", "csv=p=0", file]);
  const [w, h, n] = r.out.trim().split(",").map((x) => parseInt(x, 10));
  if (!w || !h || !n) throw new Error(`[kit] could not read ${path.basename(file)}`);
  return { w, h, frames: n };
}

/* ---------- the prompts ---------- */

/** What the still has to know about who it is drawing: extra words for a presenter that isn't an
 *  ordinary person (a mascot whose skin has to stay green below the chin), and `kind` — "cartoon" or
 *  "monster" — for a character that is not a person at all. */
export type KitLook = { continuity?: string; kind?: string };

export function stillPrompt(look: KitLook = {}): string {
  // A character is REDRAWN whole, in its own art style, with nothing added. The wording for people
  // ("studio photograph… continued down to matching trousers or skirt and shoes") would photograph a
  // cartoon and put trousers on a puppy.
  if (look.kind === "cartoon" || look.kind === "monster") {
    return [
      "A full-body picture of the exact same character as in the reference image, head to toe, in EXACTLY the same art style and rendering as the reference:",
      "the same design, proportions, colours, markings, face and expression, and the same clothing and accessories — add nothing that is not in the reference, and leave nothing out.",
      look.continuity || "",
      "The character stands upright and relaxed, facing the camera, arms loose at its sides, the whole body visible down to the floor, centred, with a little space above the head and below the feet.",
      "Seamless plain light-grey studio backdrop that curves into the floor, soft even light, a faint contact shadow on the floor, sharp focus.",
      "No text, no props, nothing in the hands, nobody else.",
    ].filter(Boolean).join(" ");
  }
  return [
    "Full-body studio photograph of the exact same person or character as in the reference image, head to toe:",
    "the same face, hair, skin, age, build and the same outfit as in the reference, continued naturally down to matching trousers or skirt and shoes.",
    look.continuity || "",
    "They stand upright and relaxed, facing the camera, arms loose at their sides, both feet fully visible on the floor, centred, with a little space above the head and below the feet.",
    "Seamless plain light-grey studio backdrop that curves into the floor, soft even light, a faint contact shadow under the feet, sharp focus.",
    "No text, no props, nothing in the hands, nobody else.",
  ].filter(Boolean).join(" ");
}

export const TURN_PROMPT =
  "A slow product-turntable shot: the subject stands still on a rotating platform and is turned through exactly one full 360-degree rotation at a constant speed — front, side, back, other side, front again — keeping the same pose, with the whole body in frame from head to toe. " +
  "The camera is locked off and does not move or zoom. Plain seamless studio backdrop, even lighting, no cuts.";

/* ---------- the steps ---------- */

/** Step 1 — a head-to-toe still of the presenter, from their half-body portrait. Returns the image URL. */
export async function fullBodyStill(t: KitTools, portrait: string, look: KitLook = {}): Promise<string> {
  let last: unknown;
  // The picture model's safety filter sometimes turns a perfectly ordinary portrait away on the first
  // ask (seen on about half of the child references in the film tests) and takes it on the second.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await repRun(t, { model: NANO_BANANA }, { prompt: stillPrompt(look), image_input: [imageRef(portrait)], aspect_ratio: "9:16", output_format: "jpg" }, "still", 4 * 60_000);
    } catch (e) {
      last = e;
      t.log?.(`still attempt ${attempt + 1} failed: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    }
  }
  throw last instanceof Error ? last : new Error("[kit:still] failed");
}

/** Step 2 — one full turn that ends where it began. `still` is a URL or a local file. Returns the video URL. */
export async function turntable(t: KitTools, still: string, seconds = 6): Promise<string> {
  const img = imageRef(still);
  return repRun(t, { model: SEEDANCE }, { prompt: TURN_PROMPT, image: img, last_frame_image: img, duration: seconds, resolution: "720p", camera_fixed: true }, "turntable", 12 * 60_000);
}

/** Step 3 — the alpha mask of that clip. `videoUrl` must be a URL the model can fetch. Returns the mask video URL. */
export async function matte(t: KitTools, videoUrl: string): Promise<string> {
  return repRun(t, { version: MATTING_VERSION }, { input_video: videoUrl, output_type: "alpha-mask" }, "matte", 10 * 60_000);
}

/** Is this a character that is not a person? (The video matting model above only knows people.) */
const isCharacter = (look?: KitLook): boolean => look?.kind === "cartoon" || look?.kind === "monster";

/** Step 3 for a character that is NOT a person — the mask, frame by frame.
 *
 *  The video matting model is trained on people and simply does not see anybody else: the first
 *  capybara it was shown came back as an empty mask, a puppy as nothing, a werewolf as scraps. The
 *  model that cuts out the portraits takes any subject, so every frame of the turn is cut out with it
 *  (at half size — the mask is only an outline, and the frames end up smaller than that anyway) and
 *  the alphas are joined back into one mask video the size and speed of the clip. Each frame is seen
 *  on its own, so there is nothing to lag behind and no second pass to run.
 *  About 145 small predictions a turn, four at a time: a couple of minutes and a few cents. */
export async function matteByFrames(t: KitTools, turnFile: string, matteFile: string, tmpDir: string): Promise<void> {
  const src = await probe(t, turnFile);
  const rate = (await run(t.ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", turnFile])).out.trim() || "24";
  // The cut-outs are kept until the mask is finished, so a run that stops part-way (one request in
  // 145 failing for good) picks up where it left off instead of paying for every frame again. They
  // belong to ONE turn: a different turn.mp4 (a re-roll) starts from nothing.
  const dir = path.join(tmpDir, "matte-frames");
  const stat = fs.statSync(turnFile);
  const sig = `${stat.size}-${Math.round(stat.mtimeMs)}`;
  const sigFile = path.join(dir, "turn.sig");
  if (!fs.existsSync(sigFile) || fs.readFileSync(sigFile, "utf8") !== sig) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  {
    if (!fs.existsSync(sigFile)) {
      const h = Math.min(src.h, 960);
      const w = Math.round((src.w * h) / src.h / 2) * 2;
      await ff(t, ["-i", turnFile, "-vf", `scale=${w}:${h}:flags=area`, "-q:v", "3", "-start_number", "0", path.join(dir, "f%04d.jpg")], "matte-frames");
      fs.writeFileSync(sigFile, sig);
    }
    const frames = fs.readdirSync(dir).filter((f) => /^f\d{4}\.jpg$/.test(f)).sort();
    if (frames.length !== src.frames) throw new Error(`[kit:matte] wrote ${frames.length} frames of ${src.frames}`);
    const quiet: KitTools = { ...t, log: undefined }; // not 145 lines of "cut-out: 3 s"
    let next = 0;
    const started = Date.now();
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (;;) {
        const i = next++;
        if (i >= frames.length) return;
        const cut = path.join(dir, `c${String(i).padStart(4, "0")}.png`);
        if (fs.existsSync(cut) && fs.statSync(cut).size > 500) continue; // from a run that stopped part-way
        const url = await repRun(quiet, { version: CUTOUT_VERSION }, { image: imageRef(path.join(dir, frames[i])), format: "png", background_type: "rgba" }, `cut-out ${i}`, 4 * 60_000);
        await save(url, `${cut}.part`);
        fs.renameSync(`${cut}.part`, cut);
      }
    }));
    await ff(t, [
      "-framerate", rate, "-start_number", "0", "-i", path.join(dir, "c%04d.png"),
      "-vf", `alphaextract,scale=${src.w}:${src.h}:flags=bilinear,format=yuv420p`,
      "-an", "-c:v", "libx264", "-crf", "10", "-preset", "veryfast", matteFile,
    ], "matte-video");
    const made = await probe(t, matteFile);
    if (made.frames !== src.frames) throw new Error(`[kit:matte] the mask has ${made.frames} frames, the clip ${src.frames}`);
    t.log?.(`matte, frame by frame: ${Math.round((Date.now() - started) / 1000)} s`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Hand a local file to a model: uploaded to Replicate's file store, which gives back a URL its models can read. */
async function upload(t: KitTools, file: string, mime: string): Promise<{ id: string; url: string }> {
  const form = new FormData();
  form.append("content", new Blob([fs.readFileSync(file)], { type: mime }), path.basename(file));
  const res = await fetch(`${REP}/files`, { method: "POST", headers: { Authorization: `Bearer ${t.token}` }, body: form, signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok) throw new Error(`[kit:upload] ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { id?: string; urls?: { get?: string } };
  if (!j.id || !j.urls?.get) throw new Error("[kit:upload] the file store returned no address");
  return { id: j.id, url: j.urls.get };
}

/** Step 3b — fill in what the mask misses.
 *
 *  The matting model carries what it has seen from one frame to the next, so a part of the presenter
 *  that has only just come into view — the far shoe as they turn, the gap between the legs as it
 *  closes — stays half see-through for a few frames: a washed-out shoe, a pale streak down a trouser
 *  leg (found on 6 of the 25 stock turns by looking at every frame). Played BACKWARDS that same part
 *  is on its way OUT of view and the model already knows it. So the clip is matted in reverse as well,
 *  and for every pixel the more opaque of the two masks is kept.
 *
 *  The reversed pass runs at half size: reversing a clip means holding every frame of it in memory at
 *  once (about 450 MB at full size, on a server that shares its memory with the film renderer). Its
 *  mask is shrunk by a pixel before it is merged, so it can fill a hole but never widen the outline.
 *  `matteFile` is replaced by the merged mask; if anything here fails it is left exactly as it was. */
export async function fillMatte(t: KitTools, turnFile: string, matteFile: string, tmpDir: string): Promise<void> {
  const src = await probe(t, turnFile);
  const mask = await probe(t, matteFile);
  const w = Math.max(2, Math.round(src.w / 4) * 2);
  const h = Math.max(2, Math.round(src.h / 4) * 2);
  const rev = path.join(tmpDir, "turn-rev.mp4");
  const revMatte = path.join(tmpDir, "matte-rev.mp4");
  const merged = path.join(tmpDir, "matte-filled.mp4");
  try {
    await ff(t, ["-i", turnFile, "-vf", `scale=${w}:${h}:flags=area,reverse`, "-an", "-c:v", "libx264", "-crf", "14", "-preset", "veryfast", "-pix_fmt", "yuv420p", rev], "reverse");
    const up = await upload(t, rev, "video/mp4");
    try {
      await save(await matte(t, up.url), revMatte);
    } finally {
      // best effort: an upload that isn't deleted expires by itself
      await fetch(`${REP}/files/${up.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${t.token}` } }).catch(() => undefined);
    }
    const back = await probe(t, revMatte);
    if (back.frames !== mask.frames) throw new Error(`[kit:fill] the reversed mask has ${back.frames} frames, the mask ${mask.frames}`);
    await ff(t, [
      "-i", matteFile, "-i", revMatte,
      "-filter_complex",
      `[1:v]format=gray,reverse,erosion,scale=${mask.w}:${mask.h}:flags=bilinear[b];[0:v]format=gray[a];[a][b]blend=all_mode=lighten,format=yuv420p[v]`,
      "-map", "[v]", "-an", "-c:v", "libx264", "-crf", "10", "-preset", "veryfast", merged,
    ], "fill");
    const out = await probe(t, merged);
    if (out.frames !== mask.frames) throw new Error(`[kit:fill] the merged mask has ${out.frames} frames, the mask ${mask.frames}`);
    fs.renameSync(merged, matteFile);
  } finally {
    for (const f of [rev, revMatte, merged]) fs.rmSync(f, { force: true });
  }
}

/** The box that holds the presenter in EVERY frame of the mask (so one crop fits the whole turn), padded a little. */
export function spinCrop(cropdetectStderr: string, frame: { w: number; h: number }): { w: number; h: number; x: number; y: number } | null {
  let box: { w: number; h: number; x: number; y: number } | null = null;
  for (const m of cropdetectStderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)) {
    box = { w: +m[1], h: +m[2], x: +m[3], y: +m[4] }; // cropdetect with reset=0 only ever grows — the last line is the union
  }
  if (!box || box.w < 16 || box.h < 16) return null;
  const padX = Math.round(box.w * 0.06);
  const padTop = Math.round(box.h * 0.03);
  const padBottom = Math.round(box.h * 0.02);
  const x0 = Math.max(0, box.x - padX);
  const y0 = Math.max(0, box.y - padTop);
  const x1 = Math.min(frame.w, box.x + box.w + padX);
  const y1 = Math.min(frame.h, box.y + box.h + padBottom);
  const even = (n: number) => n - (n % 2);
  return { w: even(x1 - x0), h: even(y1 - y0), x: x0, y: y0 };
}

/** Which source frames make the rotation: up to `want` of them, never the last one (it is the first again).
 *
 *  NOT evenly spread in time. The video model eases into the turn and out of it — a quarter to a third
 *  of every clip is the presenter standing almost still, facing front. Frames picked evenly in time
 *  hand that stillness to the viewer as a dead zone: you drag, nothing happens, then they whip round.
 *  So frames are picked evenly along how far the presenter has actually TURNED: `steps[i]` is how far
 *  their surface moved between source frame i and i+1 (see stepSize). A stretch where they barely move
 *  is given a tenth of the room; anything at or above the clip's usual pace counts as one full step. */
export function spinFramePicks(steps: number[], want: number): number[] {
  const usable = steps.length; // frames 0 … usable-1; frame `usable` is the first one again
  if (usable <= want) return Array.from({ length: Math.max(1, usable) }, (_, i) => i);
  const sorted = steps.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  // "the usual pace" = a step from the turning part of the clip. The 65th percentile, not the median:
  // it is still a turning step when more than half the clip is the presenter standing still.
  const usual = sorted[Math.floor(sorted.length * 0.65)] || 1;
  // where each frame sits along the evened-out turn
  const at: number[] = [0];
  for (let i = 0; i < usable; i++) at.push(at[i] + Math.min(Number.isFinite(steps[i]) ? steps[i] : usual, usual) / usual + 0.1);
  const total = at[usable];
  const picks: number[] = [];
  let k = 0;
  for (let j = 0; j < want; j++) {
    const target = (j * total) / want;
    while (k < usable - 1 && Math.abs(at[k + 1] - target) <= Math.abs(at[k] - target)) k++;
    if (picks.length && k <= picks[picks.length - 1]) k = picks[picks.length - 1] + 1; // never the same frame twice
    if (k > usable - 1) break;
    picks.push(k);
  }
  return picks;
}

/** Roughly how many pixels the presenter's surface moved between two frames (`w`×`h` bytes each: alpha
 *  mask and picture in grey) — how much the picture changed from one frame to the next, divided by how
 *  much it changes from one pixel to the next. The division is the point: the same turn changes a face
 *  far more than a plain shirt, and without it the busy side of a presenter would be handed more frames
 *  than their back. Counted only where both frames have the presenter, so the moving outline stays out of it. */
export function stepSize(maskA: Uint8Array, greyA: Uint8Array, maskB: Uint8Array, greyB: Uint8Array, w: number, h: number): number {
  let overTime = 0;
  let acrossPicture = 0;
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (maskA[p] <= 128 || maskB[p] <= 128 || maskA[p - 1] <= 128 || maskA[p + 1] <= 128) continue;
      overTime += Math.abs(greyB[p] - greyA[p]);
      acrossPicture += Math.abs(greyA[p + 1] - greyA[p - 1]) / 2;
      count++;
    }
  }
  if (count < 40) return NaN;
  return overTime / (acrossPicture + count * 0.5); // + half a grey level a pixel, so a flat surface can't divide by nothing
}

/** One video as small grey frames. */
async function greyFrames(t: KitTools, file: string, w: number, h: number): Promise<Buffer> {
  const r = await inLane(t, () => runBytes(t.ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `scale=${w}:${h}`, "-f", "rawvideo", "-pix_fmt", "gray", "-"]));
  if (r.code !== 0) throw new Error(`[kit:motion] ffmpeg failed: ${r.err.slice(-300)}`);
  return r.out;
}

/** How far the presenter turned between each source frame and the next (stepSize). */
async function turnSteps(t: KitTools, turnFile: string, matteFile: string): Promise<number[]> {
  const w = 136;
  const h = 240;
  const size = w * h;
  const grey = await greyFrames(t, turnFile, w, h);
  const masks = await greyFrames(t, matteFile, w, h);
  const n = Math.min(Math.floor(grey.length / size), Math.floor(masks.length / size));
  const at = (buf: Buffer, i: number) => buf.subarray(i * size, (i + 1) * size);
  return Array.from({ length: Math.max(0, n - 1) }, (_, i) => stepSize(at(masks, i), at(grey, i), at(masks, i + 1), at(grey, i + 1), w, h));
}

/** Step 4 — the turn + its mask → `frames` transparent WebP frames named `<prefix>s00.webp …` in `outDir`. */
export async function spinFrames(
  t: KitTools,
  turnFile: string,
  matteFile: string,
  outDir: string,
  prefix: string,
  want = KIT_FRAMES,
): Promise<KitSpin> {
  const src = await probe(t, turnFile);
  const mask = await probe(t, matteFile);
  const total = Math.min(src.frames, mask.frames);
  const detect = await ff(t, ["-i", matteFile, "-vf", "cropdetect=limit=24:round=2:reset=0", "-f", "null", "-"], "bbox");
  const crop = spinCrop(detect, { w: mask.w, h: mask.h });
  if (!crop) throw new Error("[kit:frames] the mask is empty — nobody to cut out");
  // The mask can come back at a different size than the clip; bring it to the clip's size first.
  const sx = src.w / mask.w;
  const sy = src.h / mask.h;
  const c = { w: Math.round(crop.w * sx), h: Math.round(crop.h * sy), x: Math.round(crop.x * sx), y: Math.round(crop.y * sy) };
  c.w -= c.w % 2; c.h -= c.h % 2;
  const idx = spinFramePicks((await turnSteps(t, turnFile, matteFile)).slice(0, Math.max(1, total - 1)), want);
  const pick = idx.map((n) => `eq(n\\,${n})`).join("+");
  const outH = Math.min(KIT_FRAME_HEIGHT, c.h);
  const outW = Math.round((c.w * outH) / c.h / 2) * 2;
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (f.startsWith(`${prefix}s`) && f.endsWith(".webp")) fs.rmSync(path.join(outDir, f));
  await ff(t, [
    "-i", turnFile, "-i", matteFile,
    "-filter_complex",
    `[1:v]scale=${src.w}:${src.h},format=gray[m];[0:v][m]alphamerge,select='${pick}',crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${outW}:${outH}:flags=lanczos[v]`,
    "-map", "[v]", "-fps_mode", "vfr", "-c:v", "libwebp", "-quality", "72", "-compression_level", "4", "-pix_fmt", "yuva420p",
    "-start_number", "0", path.join(outDir, `${prefix}s%02d.webp`),
  ], "frames");
  const made = fs.readdirSync(outDir).filter((f) => f.startsWith(`${prefix}s`) && f.endsWith(".webp")).length;
  if (made !== idx.length) throw new Error(`[kit:frames] wrote ${made} frames, expected ${idx.length}`);
  return { frames: made, w: outW, h: outH };
}

/* ---------- is it really one full turn? ---------- */

/** What a finished rotation measures as.
 *  `first` / `second`: how far the presenter's visible surface slides sideways from one frame to the
 *  next (as a fraction of the frame width, + = toward the right of the picture), averaged over the
 *  first and the second half of the turn.
 *  `back`: how wide the shoulders get in the middle of the turn, relative to the front view (1 = as wide). */
export type TurnShape = { first: number; second: number; back: number; full: boolean; dir: 1 | -1 };

/** The video model is told to start and end on the same frame, and it has two lazy ways of getting
 *  there that both loop, both look fine on a contact sheet at a glance, and both got past me:
 *
 *  1. THERE AND BACK — it turns the presenter half-way and brings them back (3 of the first 22 stock
 *     kits). A drag plays it as a wobble.
 *     The tell: whatever side of a turning body faces us slides across the picture in the direction of
 *     the turn, and keeps sliding that SAME way for the whole of a real rotation (front, side, back,
 *     other side: the part we can see is always the near part). Turn back, and it slides the other
 *     way. So the slide must have the same sign through the first half of the frames and the second.
 *
 *  2. THE PAPER FLIP — the head turns all the way round but the body never shows its back: it goes
 *     from one side view to the other as if it were a cardboard cut-out being flipped. (Stock presenter
 *     "rosa", after a re-roll — it passed check 1, shipped, and the owner found it in minutes: "Rosa
 *     stuff is a bit glitched".)
 *     The tell: shoulders are wide from the front, narrow from the side, and WIDE AGAIN from behind.
 *     A flip stays narrow all the way through the middle. Every one of the other 24 stock rotations
 *     gets at least as wide at the back as at the front (1.01–1.16); rosa's reached 0.69.
 *
 *  `dir` falls out of check 1 — the way the surface slides is the way the face swings first, which is
 *  what lets the viewer make a drag to the right turn the presenter to the right.
 *
 *  Three other ideas were tried on the real kits and dropped because they mis-read good turns whose
 *  owner stood with one foot forward: which way the feet point, the narrowest frame, mirror symmetry.
 *  Arithmetic on the frames themselves — no model to ask (tests/presenter-kit.test.ts runs it on every
 *  committed rotation, and on a there-and-back and a flip built from real frames). */
export function turnShape(slides: number[], widths: number[]): TurnShape {
  const n = slides.length;
  const mean = (a: number, b: number) => {
    const part = slides.slice(Math.round(a * n), Math.round(b * n)).filter((x) => Number.isFinite(x));
    return part.length ? part.reduce((s, x) => s + x, 0) / part.length : 0;
  };
  const first = mean(0.1, 0.45);
  const second = mean(0.55, 0.9);
  const least = 0.002; // a fifth of a percent of the frame width per step; real turns measure 0.5–4 %
  const oneWay = Math.abs(first) >= least && Math.abs(second) >= least && Math.sign(first) === Math.sign(second);
  // the front: the first frames and the last one (the turn ends where it began)
  const frontParts = [widths[0], widths[1], widths[widths.length - 1]].filter((x) => Number.isFinite(x) && x > 0);
  const front = frontParts.length ? frontParts.reduce((s, x) => s + x, 0) / frontParts.length : 0;
  const middle = widths.slice(Math.round(0.35 * widths.length), Math.round(0.65 * widths.length)).filter((x) => Number.isFinite(x));
  const back = front > 0 && middle.length ? Math.max(...middle) / front : 0;
  return { first, second, back, full: oneWay && back >= 0.85, dir: first > 0 ? 1 : -1 };
}

/** The top and bottom rows of the figure in one frame's alpha mask, or null when nobody is there. */
function figureSpan(mask: Uint8Array, w: number, h: number): { top: number; bottom: number } | null {
  const rowHas = (y: number) => { for (let x = 0; x < w; x++) if (mask[y * w + x] > 128) return true; return false; };
  let top = 0;
  while (top < h && !rowHas(top)) top++;
  let bottom = h - 1;
  while (bottom > top && !rowHas(bottom)) bottom--;
  return bottom > top ? { top, bottom } : null;
}

/** How wide the shoulders are in one frame (`w`×`h` alpha mask), in pixels: the widest row between the
 *  neck and the chest. That band on purpose — lower down, arms hanging away from the body make a side
 *  view look as wide as a front one. NaN when nobody is in the frame. */
export function shoulderWidth(mask: Uint8Array, w: number, h: number): number {
  const fig = figureSpan(mask, w, h);
  if (!fig) return NaN;
  const tall = fig.bottom - fig.top;
  let best = 0;
  for (let y = fig.top + Math.round(0.16 * tall); y <= fig.top + Math.round(0.3 * tall); y++) {
    let lo = w;
    let hi = -1;
    for (let x = 0; x < w; x++) if (mask[y * w + x] > 128) { if (x < lo) lo = x; if (x > hi) hi = x; }
    if (hi - lo > best) best = hi - lo;
  }
  return best;
}

/** How many pixels the middle of the presenter's head and torso moved sideways between two frames
 *  (`w`×`h` bytes each: the alpha mask and the picture in grey). The middle, because that is the part
 *  of a turning body nearest the camera, where the surface moves most and the outline doesn't confuse it. */
export function slideBetween(maskA: Uint8Array, greyA: Uint8Array, maskB: Uint8Array, greyB: Uint8Array, w: number, h: number): number {
  const reach = Math.max(2, Math.round(w * 0.055));
  const fig = figureSpan(maskA, w, h);
  if (!fig) return NaN;
  const tall = fig.bottom - fig.top;
  const cost = new Float64Array(2 * reach + 1);
  const seen = new Float64Array(2 * reach + 1);
  for (let y = fig.top + Math.round(0.04 * tall); y <= fig.top + Math.round(0.55 * tall); y++) {
    let lo = w;
    let hi = -1;
    for (let x = 0; x < w; x++) if (maskA[y * w + x] > 128) { if (x < lo) lo = x; if (x > hi) hi = x; }
    if (hi - lo < 12) continue;
    const mid = (lo + hi) / 2;
    const half = (hi - lo) * 0.3;
    for (let x = Math.ceil(mid - half); x <= Math.floor(mid + half); x++) {
      const a = greyA[y * w + x];
      for (let s = -reach; s <= reach; s++) {
        const xb = x + s;
        if (xb < 0 || xb >= w || maskB[y * w + xb] <= 128) continue;
        cost[s + reach] += Math.abs(a - greyB[y * w + xb]);
        seen[s + reach]++;
      }
    }
  }
  let best = NaN;
  let bestCost = Infinity;
  for (let s = -reach; s <= reach; s++) {
    if (seen[s + reach] < 50) continue;
    const c = cost[s + reach] / seen[s + reach];
    if (c < bestCost) { bestCost = c; best = s; }
  }
  return best;
}

/** Measure a finished rotation (the frames `<prefix>s00.webp …` in `dir`). */
export async function measureTurn(t: KitTools, dir: string, prefix: string, spin: KitSpin): Promise<TurnShape> {
  const w = Math.max(2, Math.round(spin.w / 2));
  const h = Math.max(2, Math.round(spin.h / 2));
  const size = w * h;
  const read = async (filter: string, what: string): Promise<Buffer> => {
    const r = await inLane(t, () => runBytes(t.ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-start_number", "0", "-i", path.join(dir, `${prefix}s%02d.webp`),
      "-vf", `${filter}scale=${w}:${h}`, "-f", "rawvideo", "-pix_fmt", "gray", "-",
    ]));
    if (r.code !== 0) throw new Error(`[kit:measure] ffmpeg failed (${what}): ${r.err.slice(-300)}`);
    if (Math.floor(r.out.length / size) < spin.frames) throw new Error(`[kit:measure] read ${Math.floor(r.out.length / size)} of ${spin.frames} frames (${what})`);
    return r.out;
  };
  const masks = await read("alphaextract,", "mask");
  const grey = await read("", "picture");
  const at = (buf: Buffer, i: number) => buf.subarray((i % spin.frames) * size, ((i % spin.frames) + 1) * size);
  const slides = Array.from({ length: spin.frames }, (_, i) => slideBetween(at(masks, i), at(grey, i), at(masks, i + 1), at(grey, i + 1), w, h) / w);
  const widths = Array.from({ length: spin.frames }, (_, i) => shoulderWidth(at(masks, i), w, h));
  return turnShape(slides, widths);
}

/** A strip of the rotation on a plain backdrop, for a person to check the turn looks right. */
export async function spinSheet(t: KitTools, dir: string, prefix: string, spin: KitSpin, outFile: string, cells = 8): Promise<void> {
  const picks = Array.from({ length: cells }, (_, i) => Math.round((i * spin.frames) / cells) % spin.frames);
  const inputs = picks.flatMap((n) => ["-i", path.join(dir, `${prefix}s${String(n).padStart(2, "0")}.webp`)]);
  const cellW = Math.round((spin.w * 480) / spin.h / 2) * 2;
  const chains = picks.map((_, i) => `color=c=0xEFE9DA:s=${cellW}x480[b${i}];[${i}:v]scale=${cellW}:480[f${i}];[b${i}][f${i}]overlay=shortest=1[c${i}]`).join(";");
  await ff(t, [...inputs, "-filter_complex", `${chains};${picks.map((_, i) => `[c${i}]`).join("")}hstack=inputs=${cells}[o]`, "-map", "[o]", "-frames:v", "1", "-q:v", "3", outFile], "sheet");
}

/** A portrait with its background removed, saved as a transparent WebP on the portrait's own canvas. */
export async function cutOutPortrait(t: KitTools, portrait: string, outFile: string, tmpDir: string): Promise<void> {
  const url = await repRun(t, { version: CUTOUT_VERSION }, { image: imageRef(portrait), format: "png", background_type: "rgba" }, "cut-out", 3 * 60_000);
  fs.mkdirSync(tmpDir, { recursive: true });
  const png = path.join(tmpDir, `cut-${process.pid}-${Date.now()}-${Math.round(Math.random() * 1e6)}.png`);
  try {
    await save(url, png);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    await ff(t, ["-i", png, "-vf", `scale='min(${KIT_PORTRAIT_WIDTH},iw)':-2:flags=lanczos`, "-c:v", "libwebp", "-quality", "82", "-compression_level", "6", "-pix_fmt", "yuva420p", "-frames:v", "1", outFile], "cut-out");
  } finally {
    fs.rmSync(png, { force: true });
  }
}

export type KitSources = { stillFile: string; turnFile: string; matteFile: string };
export type KitBuild = KitSpin & KitSources;

/** Steps 1–3 for one presenter in one outfit: everything that is GENERATED (and paid for). The files
 *  land in `tmpDir` (still.jpg, turn.mp4, matte.mp4); one that is already there is reused, so a re-run
 *  only pays for what is missing — and deleting turn.mp4 is how a bad turn is rolled again. */
export async function spinSources(t: KitTools, o: { portrait: string; tmpDir: string; look?: KitLook }): Promise<KitSources> {
  fs.mkdirSync(o.tmpDir, { recursive: true });
  const stillFile = path.join(o.tmpDir, "still.jpg");
  const turnFile = path.join(o.tmpDir, "turn.mp4");
  const matteFile = path.join(o.tmpDir, "matte.mp4");
  const have = (file: string) => fs.existsSync(file) && fs.statSync(file).size > 2000;
  if (!have(stillFile)) await save(await fullBodyStill(t, o.portrait, o.look), stillFile);
  let turnUrl = "";
  if (!have(turnFile)) {
    fs.rmSync(matteFile, { force: true }); // a mask belongs to one turn
    turnUrl = await turntable(t, stillFile);
    await save(turnUrl, turnFile);
  }
  if (!have(matteFile)) {
    if (isCharacter(o.look)) {
      await matteByFrames(t, turnFile, matteFile, o.tmpDir);
    } else {
      // a turn saved by an earlier run has no address the model can read any more — give it one
      const stored = turnUrl ? null : await upload(t, turnFile, "video/mp4");
      try {
        await save(await matte(t, turnUrl || (stored as { url: string }).url), matteFile);
      } finally {
        if (stored) await fetch(`${REP}/files/${stored.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${t.token}` } }).catch(() => undefined);
      }
      // The second pass only ever improves the mask; a turn is not thrown away (and paid for again)
      // because it could not be run — the one-way mask is what every kit had before it existed.
      try { await fillMatte(t, turnFile, matteFile, o.tmpDir); }
      catch (e) { t.log?.(`second matting pass did not run — keeping the one-way mask: ${e instanceof Error ? e.message.slice(0, 200) : e}`); }
    }
  }
  return { stillFile, turnFile, matteFile };
}

/** Steps 1–4 in one go (what the stock build script uses). */
export async function buildSpin(
  t: KitTools,
  o: { portrait: string; outDir: string; prefix: string; tmpDir: string; look?: KitLook; want?: number },
): Promise<KitBuild> {
  const src = await spinSources(t, o);
  const spin = await spinFrames(t, src.turnFile, src.matteFile, o.outDir, o.prefix, o.want);
  return { ...spin, ...src };
}
