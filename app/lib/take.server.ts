/* A TAKE, MADE — one continuous twelve-second shot of found footage, start to Archive.
 *
 * What it is and why it is built the way it is: take.ts (the recipe) and camera-dress.ts (the camera it was
 * "shot on"). This file is the making:
 *
 *   1. THE TAKE'S PARTS  a ready-made scare, or the member's own idea written into the same parts — FROM the card
 *                        their words started from, when they changed a card's words (the police drama's by a drama
 *                        writer: the person on camera's lines, the officer's, the radio — inside the bounds). A
 *                        writer that fails or half-answers falls back to that card as it is, else to the first
 *                        ready-made one written for that camera — a take is never made from half a direction.
 *   2. THE SCENE         the picture the take ARRIVES at, drawn by the creature recipe.
 *   3. THE WAY IN        the take's first frame — the same place a moment earlier, off its subject — drawn
 *                        FROM the scene (the owner: "a 2 second off of subject at the beggining then pans
 *                        to the actual scene"). When it will not draw, the take starts on the scene itself.
 *   4. THE TAKE          Kling 3 Omni with its own sound, started on the way in and told to find the scene
 *                        "exactly as in" the reference picture — in one unbroken move. fal's pro tier first
 *                        (1080p, what the acted films render on), then its standard tier, then elsewhere.
 *   5. NO WORDS, NO CUT  the engine is given no words (it lip-syncs any line onto the only mouth it can see —
 *                        "bro the monster literally lipsynced every word"), and the take is LISTENED to and
 *                        LOOKED at: if the engine spoke anyway, or CUT ("the cut is far too obvious"), it is
 *                        rolled once more and the better roll kept; a cut still in its first seconds is cut
 *                        off — the take starts on the frame after it, and its lines come that much earlier.
 *   6. THE VOICE         what the one filming says is PERFORMED (ElevenLabs v3: scared, then terrified —
 *                        "he is in monotone - no fear"), the plain voice behind it, laid over the take with
 *                        the room lifted to a real level (take.ts → takeSound) — and, on a body cam, the
 *                        dispatcher's call over the radio, in a voice of its own. The picture is never touched.
 *   7. THE CAMERA        the take is dressed as a phone, a camcorder, nothing, or a body cam (camera-dress.ts),
 *                        at a capped bit-rate — grain is incompressible, and an uncapped camcorder take was 130 MB.
 *   8. THE PIECE         a VIDEO_AD in the Archive, named for what it is.
 *
 * Every step after the take itself degrades instead of failing: no way in → it starts on the scene; not
 * heard → kept unheard; a voice that will not speak → the take without it; a look that will not render → the
 * plain take is the piece. The seconds that cost money are never thrown away.
 *
 * Queued by the found-footage builder (routes/web.found-footage.tsx → job-queue, contentType "take"); a house
 * camera's take is house-take.server.ts, which makes its takes with the steps exported here. */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { db } from "../db.server";
import { anthropicText } from "./anthropic.server";
import { cameraLookOf, dressFilter, type CameraLook, type DressOptions } from "./camera-dress";
import { createWhisperx, wordsFromWhisperx } from "./faceless-video.server";
import { falEnabled, falVideoPoll, falVideoSubmit } from "./fal-video.server";
import { levelFilm } from "./film-loudness.server";
import { persistRemote, repRun } from "./image-generation.server";
import { mirrorRender } from "./object-storage.server";
import { overlayFonts } from "./overlay-fonts.server";
import { DRAMA_SCHEMA, TAKE_ACTED, TAKE_HISS, TAKE_IDEAS, TAKE_OFFICER_VOICE, TAKE_RADIO_VOICE, TAKE_REF, TAKE_SCHEMA, TAKE_SECONDS, TAKE_VOICE, TRIM_WITHIN, HAND_CAMS, betterRoll, cutLookArgs, cutsAt, framesOf, rollFaulty, shiftLines, takeActing, castPick, castTake, dramaWriterBrief, parseTake, placeLines, shapeFor, takeIdea, takeLines, takeOpensPrompt, takePrompt, takeSound, takeStillPrompt, takeWriterBrief, type Take, type TakeIdea } from "./take";
import { checkpointJob, repCreate, repPoll } from "./ugc-ad-pipeline.server";

// (the same model, three hosts. The two fal ids are its "reference" endpoint — a first frame AND a picture to
//  arrive at, fal-video-body.ts — at the two tiers the acted films use, in film-dialogue.server.ts's order.)
const FAL_OMNI_STD = "fal-ai/kling-video/o3/standard/reference-to-video";
const FAL_OMNI = "fal-ai/kling-video/o3/pro/reference-to-video";
const REP_OMNI = "kwaivgi/kling-v3-omni-video";
const TAKE_POLL_MS = 20 * 60_000;
/** How many times a take is rolled again because the engine SPOKE or CUT (0 = never). Each one is a whole take
 *  paid for a second time — the owner's to turn off: TAKE_REROLLS=0. */
export const rerolls = (): number => { const n = Number(process.env.TAKE_REROLLS); return Number.isFinite(n) && n >= 0 ? Math.min(2, Math.floor(n)) : 1; };

export const renders = () => path.join(process.cwd(), "data", "renders");
export const stamp = () => `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;

export function run(cmd: string, args: string[], maxMs = 180_000): Promise<{ code: number; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err = (err + String(d)).slice(-4000); });
    const timer = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* gone */ } }, maxMs);
    p.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, err }); });
    p.on("error", (e) => { clearTimeout(timer); resolve({ code: 1, err: String(e) }); });
  });
}

/** True on a machine whose renders are NOT on the public site (RENDERS_INLINE=1 — a local run): the models
 *  cannot fetch a picture by its address there, so it is handed over inline, and a take cannot be listened to. */
const inline = () => process.env.RENDERS_INLINE === "1";

/** How a picture on the renders disk is handed to a model: its public address — or, on a local run, the
 *  picture itself. */
export function imageRef(base: string, rel: string): string {
  if (inline()) {
    const f = path.join(renders(), path.basename(rel.split("?")[0]));
    if (fs.existsSync(f)) return `data:image/${/\.png$/i.test(f) ? "png" : "jpeg"};base64,${fs.readFileSync(f).toString("base64")}`;
  }
  return `${base}${rel}`;
}

/** The take itself, started on `first` and told to arrive at `scene`: fal's standard tier, then the same
 *  model elsewhere. A refused or failed render is not billed, so falling through never pays twice. `seconds`:
 *  a handheld take is TAKE_SECONDS; a house take is longer. */
export async function rollTake(o: { first: string; scene: string; direction: (ref: string) => string; aspect: "9:16" | "16:9"; seconds?: number }): Promise<{ url: string; host: string }> {
  const secs = Math.max(3, Math.min(15, Math.round(o.seconds ?? TAKE_SECONDS)));
  const viaFal = (model: string) => async () => falVideoPoll(model, await falVideoSubmit(model, { startImage: o.first, referenceImages: [o.scene], prompt: o.direction(TAKE_REF.fal), generateAudio: true, durationSec: secs, aspect: o.aspect }), TAKE_POLL_MS);
  // (the pro tier — 1080p — first: the owner, of the picture, 2026-11-24: "upgrade the best image possible")
  const order: Array<{ host: string; fal: boolean; go: () => Promise<string> }> = [
    { host: "fal kling 3 omni", fal: true, go: viaFal(FAL_OMNI) },
    { host: "fal kling 3 omni standard", fal: true, go: viaFal(FAL_OMNI_STD) },
    { host: "replicate kling 3 omni", fal: false, go: async () => repPoll(await repCreate(REP_OMNI, { prompt: o.direction(TAKE_REF.replicate), start_image: o.first, reference_images: [o.scene], generate_audio: true, duration: secs, mode: "pro" }), TAKE_POLL_MS, "take") },
  ];
  let last = "no host";
  for (const h of order) {
    if (h.fal && !falEnabled()) continue;
    if (!h.fal && !process.env.REPLICATE_API_TOKEN) continue;
    try { return { url: await h.go(), host: h.host }; }
    catch (e) { last = `${h.host}: ${e instanceof Error ? e.message.slice(0, 160) : e}`; console.error(`[take] ${last}`); }
  }
  throw new Error(`[take] the take could not be rolled — ${last}`);
}

/** A rolled take, fetched and on the disk the moment it exists. */
export async function keepRoll(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[take] the take could not be fetched: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100_000) throw new Error("[take] the take came back empty");
  const name = `takeraw-${stamp()}.mp4`;
  fs.writeFileSync(path.join(renders(), name), buf);
  try { await mirrorRender(name, buf); } catch { /* the disk copy is what is used */ }
  return name;
}

/** What is said in a take, as lines with their times — or null when it could not be heard. (No alignment:
 *  a take with nothing said in it is the usual case, and the aligner fails on one.) */
export async function heard(base: string, fileName: string): Promise<Array<{ at: number; text: string }> | null> {
  if (!base || !process.env.REPLICATE_API_TOKEN || inline()) return null;
  try {
    const words = wordsFromWhisperx(await repPoll(await createWhisperx(`${base}/renders/${fileName}`, "en"), 90_000, "take-words")) as Array<{ start: number; end: number; word?: string; text?: string }>;
    const lines: Array<{ at: number; text: string }> = [];
    let prevEnd = -9;
    for (const w of words) {
      const t = String(w.word ?? w.text ?? "").trim();
      if (!t) continue;
      if (lines.length && w.start - prevEnd < 0.7) lines[lines.length - 1].text += ` ${t}`;
      else lines.push({ at: Math.round(w.start * 10) / 10, text: t });
      prevEnd = w.end;
    }
    return lines.slice(0, 12);
  } catch (e) {
    console.error(`[take] not heard: ${e instanceof Error ? e.message.slice(0, 140) : e}`);
    return null;
  }
}
export const wordsIn = (said: Array<{ text: string }> | null): number => (said || []).reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);

/** How long a sound or a film is, in seconds (0 when it cannot be read). */
export async function secondsOf(file: string): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (d) => { out += String(d); });
    p.on("close", () => resolve(Number(out.trim()) || 0));
    p.on("error", () => resolve(0));
  });
}

/** A film's picture size (0×0 when it cannot be read). */
export async function sizeOf(file: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (d) => { out += String(d); });
    p.on("close", () => { const [w, h] = out.trim().split(",").map(Number); resolve({ w: w || 0, h: h || 0 }); });
    p.on("error", () => resolve({ w: 0, h: 0 }));
  });
}

/** One line in a voice → a sound file on the disk (its name), or "" when the voice would not speak. The better
 *  voice model first, the quick one if it blips. */
async function sayLine(text: string, voice: { id: string; emotion: string; speed: number }): Promise<string> {
  for (const model of ["minimax/speech-02-hd", "minimax/speech-02-turbo"]) {
    try {
      const url = await repPoll(await repCreate(model, { text, voice_id: voice.id, emotion: voice.emotion, speed: voice.speed }), 3 * 60_000, "take-voice");
      const res = await fetch(String(url));
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 2_000) throw new Error("empty");
      const name = `takesay-${stamp()}.mp3`;
      fs.writeFileSync(path.join(renders(), name), buf);
      return name;
    } catch (e) { console.error(`[take] ${model} would not speak: ${e instanceof Error ? e.message.slice(0, 120) : e}`); }
  }
  return "";
}

/** One line of the one filming, PERFORMED (take.ts → TAKE_ACTED): ElevenLabs v3 told how to say it — "" when it would
 *  not speak (the caller falls back to sayLine). */
async function actLine(text: string, acting: string): Promise<string> {
  try {
    const input = { prompt: `${acting} ${text}`, voice: TAKE_ACTED.voice, stability: TAKE_ACTED.stability, style: TAKE_ACTED.style, speed: TAKE_ACTED.speed, similarity_boost: 0.75, language_code: "en" };
    const url = await repPoll(await repCreate("elevenlabs/v3", input), 3 * 60_000, "take-voice");
    const res = await fetch(String(url));
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2_000) throw new Error("empty");
    const name = `takesay-${stamp()}.mp3`;
    fs.writeFileSync(path.join(renders(), name), buf);
    return name;
  } catch (e) { console.error(`[take] the acted voice would not speak — the plain one says it: ${e instanceof Error ? e.message.slice(0, 120) : e}`); return ""; }
}

/** THE SECONDS A TAKE CUTS AT (take.ts → cutsAt — the owner: "the cut is far too obvious"): every frame's brightness
 *  and scene score, read from ffmpeg as it goes (a whole take's log is far longer than `run` keeps). [] when it
 *  cannot be read — a take that cannot be looked at is kept as it is. */
export function cutsIn(file: string, maxMs = 120_000): Promise<number[]> {
  return new Promise((resolve) => {
    const p = spawn("ffmpeg", cutLookArgs(file), { stdio: ["ignore", "ignore", "pipe"] });
    let kept = "", rest = "";
    const keep = (text: string) => { for (const l of text.split("\n")) if (/pts_time:|YAVG=|scene_score=/.test(l)) kept += `${l}\n`; };
    p.stderr.on("data", (d) => { rest += String(d); const i = rest.lastIndexOf("\n"); if (i >= 0) { keep(rest.slice(0, i)); rest = rest.slice(i + 1); } });
    const timer = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* gone */ } }, maxMs);
    p.on("close", (code) => { clearTimeout(timer); keep(rest); resolve(code === 0 ? cutsAt(framesOf(kept)) : []); });
    p.on("error", () => { clearTimeout(timer); resolve([]); });
  });
}

/** How loud a take's own room is, and whether it has a sound at all. */
async function roomOf(file: string): Promise<{ hasSound: boolean; roomDb: number | null }> {
  const probe = await run("ffmpeg", ["-v", "info", "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"], 60_000);
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(probe.err);
  return { hasSound: /Audio:/.test(probe.err), roomDb: mean ? Number(mean[1]) : null };
}

/** THE VOICE BEHIND THE CAMERA, laid over the take's own room (take.ts → takeSound). Returns the voiced
 *  take's file name and the lines as they were placed — or null when nothing could be laid on (the caller
 *  keeps the take as it is). The picture is copied, never re-encoded. */
async function voiceTake(rawName: string, take: Take, trimmed = 0): Promise<{ name: string; lines: Array<{ at: number; text: string; radio?: true }> } | null> {
  const dir = renders();
  const said: string[] = [];
  try {
    // (a take that starts after its cut: every line that much earlier)
    const asked = shiftLines(takeLines(take), trimmed);
    if (!asked.length) return null;
    const spoken: Array<{ at: number; text: string; radio?: true; file: string; seconds: number }> = [];
    const own = asked.filter((l) => !l.radio);
    for (const l of asked) {
      // (the one filming in a scare: PERFORMED — scared and whispered, then terrified (take.ts → TAKE_ACTED); the plain
      //  fearful voice only when that will not speak. An officer in a drama, firm; the dispatcher in a radio's own)
      const voice = l.radio ? TAKE_RADIO_VOICE : take.genre === "drama" ? TAKE_OFFICER_VOICE : TAKE_VOICE;
      const acted = !l.radio && take.genre !== "drama" ? await actLine(l.text, takeActing(own.indexOf(l), own.length)) : "";
      const file = acted || await sayLine(l.text, voice);
      if (!file) continue;
      said.push(file);
      spoken.push({ ...l, file, seconds: await secondsOf(path.join(dir, file)) });
    }
    const rawPath = path.join(dir, rawName);
    const total = (await secondsOf(rawPath)) || TAKE_SECONDS;
    const placed = placeLines(spoken, total);
    if (!placed.length) return null;
    // how loud the take's own room is, and whether it has a sound at all
    const { hasSound, roomDb } = await roomOf(rawPath);
    const out = `takevoiced-${stamp()}.mp4`;
    const args = ["-v", "error", "-y", "-i", rawPath];
    for (const l of placed) args.push("-i", path.join(dir, l.file));
    args.push("-f", "lavfi", "-t", String(total), "-i", TAKE_HISS,
      "-filter_complex", takeSound({ lines: placed, roomDb, hasSound }),
      "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", String(total), "-movflags", "+faststart", path.join(dir, out));
    const r = await run("ffmpeg", args, 120_000);
    if (r.code !== 0 || !fs.existsSync(path.join(dir, out)) || fs.statSync(path.join(dir, out)).size < 50_000) throw new Error(r.err.slice(-240) || "no file");
    return { name: out, lines: placed.map((l) => ({ at: l.at, text: l.text, ...(l.radio ? { radio: true as const } : {}) })) };
  } catch (e) {
    console.error(`[take] the voice could not be laid on — the take ships without it: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
    return null;
  } finally {
    for (const f of said) fs.rmSync(path.join(dir, f), { force: true });
  }
}

/** THE ROOM ON ITS OWN — a take nobody speaks over (a house camera's): its room lifted to a real level with the
 *  microphone's low hiss under it (takeSound with no lines). The file's name, or null (the take is kept as it
 *  is). The picture is copied, never re-encoded. */
export async function roomTake(rawName: string): Promise<string | null> {
  const dir = renders(), rawPath = path.join(dir, rawName);
  try {
    const total = (await secondsOf(rawPath)) || TAKE_SECONDS;
    const { hasSound, roomDb } = await roomOf(rawPath);
    const out = `takeroom-${stamp()}.mp4`;
    const r = await run("ffmpeg", ["-v", "error", "-y", "-i", rawPath, "-f", "lavfi", "-t", String(total), "-i", TAKE_HISS,
      "-filter_complex", takeSound({ lines: [], roomDb, hasSound }),
      "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", String(total), "-movflags", "+faststart", path.join(dir, out)], 120_000);
    if (r.code !== 0 || !fs.existsSync(path.join(dir, out)) || fs.statSync(path.join(dir, out)).size < 50_000) throw new Error(r.err.slice(-240) || "no file");
    return out;
  } catch (e) {
    console.error(`[take] the room could not be lifted — the take keeps its own sound: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
    return null;
  }
}

/** What a take is dressed with — everything camera-dress.ts takes but the fonts, which are found here. */
export type TakeDress = Omit<DressOptions, "font" | "fontThin" | "fontMono">;

/** The take dressed as its camera. Null when the look would not render — the caller then ships the take
 *  as it is. */
export async function dressTake(inPath: string, look: TakeDress): Promise<string | null> {
  try {
    const fonts = await overlayFonts(8_000);
    const d = dressFilter({ ...look, font: fonts.font, fontThin: fonts.thin, fontMono: fonts.mono });
    const dir = renders(), id = stamp();
    const inputs = ["-i", inPath];
    if (d.chrome) {
      const cs = path.join(dir, `take-${id}-chrome.txt`), png = path.join(dir, `take-${id}-chrome.png`);
      fs.writeFileSync(cs, d.chrome);
      const c = await run("ffmpeg", ["-v", "error", "-y", "-filter_complex_script", cs, "-map", "[c]", "-frames:v", "1", png], 60_000);
      fs.rmSync(cs, { force: true });
      if (c.code !== 0) throw new Error(`chrome: ${c.err.slice(-200)}`);
      inputs.push("-i", png);
    }
    const script = path.join(dir, `take-${id}-graph.txt`), out = path.join(dir, `take-${id}.mp4`);
    fs.writeFileSync(script, d.filter);
    // (a time-lapse re-times the sound with the picture, inside the graph: [a] is its sound then)
    const sound = d.audioInGraph ? ["-map", "[a]"] : ["-map", "0:a?", ...(d.audio ? ["-af", d.audio] : [])];
    // (1080p has twice the pixels of 720p: a little more room for its grain)
    const hd = look.w * look.h > 1_500_000;
    const r = await run("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex_script", script, "-map", "[v]", ...sound,
      "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-maxrate", hd ? "10M" : "7M", "-bufsize", hd ? "20M" : "14M", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out], 300_000);
    fs.rmSync(script, { force: true });
    for (const f of fs.readdirSync(dir)) if (f.startsWith(`take-${id}-chrome`)) fs.rmSync(path.join(dir, f), { force: true });
    if (r.code !== 0 || !fs.existsSync(out) || fs.statSync(out).size < 50_000) throw new Error(r.err.slice(-240) || "no file");
    return out;
  } catch (e) {
    console.error(`[take] the ${look.look} look did not render — shipping the take as it is: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
    return null;
  }
}

/** Today as a camera prints its date (YYYY-MM-DD). */
export const camToday = (): string => new Date().toISOString().slice(0, 10);

/** The first ready-made scare written for a camera — what a writer that fails falls back to. */
const fallbackFor = (camera: CameraLook): TakeIdea => TAKE_IDEAS.find((i) => (i.cams || HAND_CAMS).includes(camera)) || TAKE_IDEAS[0];

export type TakeOptions = {
  shopId: string;
  /** a ready-made scare (take.ts → TAKE_IDEAS)… */
  ideaKey?: string;
  /** …or the member's own idea, in a line */
  idea?: string;
  /** the card that idea started from (they changed its words in the builder's box) — its direction is where the
   *  writer starts, and what a writer that fails falls back to */
  from?: string;
  camera?: string;
  aspect?: string;
  section?: string;
  jobId?: string;
  resume?: { ckTake?: string; ckStill?: string; ckOpens?: string; ckRaw?: string; ckSpoke?: string; ckCuts?: string; ckTrim?: string };
};

/** Make one take. Returns the new piece's id. */
export async function generateTake(opts: TakeOptions): Promise<string> {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const camera: CameraLook = cameraLookOf(opts.camera) || "phone";
  const aspect: "9:16" | "16:9" = shapeFor(camera, opts.aspect);
  const resume = opts.resume || {};
  const ckpt = async (patch: Record<string, unknown>) => { if (opts.jobId) await checkpointJob(opts.jobId, patch); };
  const dir = renders();
  fs.mkdirSync(dir, { recursive: true });

  // 1) the take's parts
  let take: Take & { title: string; key?: string };
  const ready = takeIdea(opts.ideaKey);
  // (the card the member's words started from — only ever one this camera can film)
  const card = ready ? undefined : takeIdea(opts.from);
  const from = card && (card.cams || HAND_CAMS).includes(camera) ? card : undefined;
  const seed = parseInt(stamp().slice(-6), 16);
  if (resume.ckTake) take = JSON.parse(resume.ckTake);
  // (a drama's somebody is picked for this take, from its cast — and kept with the take, so a resumed job keeps them)
  else if (ready) take = { ...castTake(ready, seed), title: ready.name };
  else {
    // THE POLICE DRAMA, its words changed, is written by the drama writer — the person on camera's lines, the officer's,
    // the radio — and filmed exactly as the ready-made one is (genre, speaks, script, fifteen seconds); anything else
    // by the scare writer, starting from the card when there is one
    const drama = from?.genre === "drama";
    let written: (Take & { title: string }) | null = null;
    try {
      written = parseTake(await anthropicText(drama && from ? dramaWriterBrief(opts.idea || "", from, castPick(from, seed)) : takeWriterBrief(opts.idea || "", camera, from), {
        maxTokens: drama ? 2400 : 1600,
        jsonSchema: drama ? DRAMA_SCHEMA : TAKE_SCHEMA,
      }), drama ? "drama" : undefined);
    } catch (e) { console.error(`[take] the writer did not answer — a ready-made scare is used: ${e instanceof Error ? e.message.slice(0, 140) : e}`); }
    // (a body cam's radio call is kept only on a body cam)
    if (written && camera !== "bodycam") delete written.radio;
    // (a writer that fails: the card their words started from, as it is — else the first one written for this camera)
    const fallback = from ? castTake(from, seed) : fallbackFor(camera);
    take = written || { ...fallback, title: fallback.name };
  }
  await ckpt({ ckTake: JSON.stringify(take) });

  // 2) the scene the take arrives at
  let still = resume.ckStill || "";
  if (!still) {
    still = await persistRemote(await repRun("google/nano-banana", { prompt: takeStillPrompt(take, aspect), aspect_ratio: aspect, output_format: "jpg" }), "jpg");
    await ckpt({ ckStill: still });
  }

  // 3) the way in: the same place a moment earlier, drawn FROM the scene. ("-" = it would not draw, and the
  //    take starts on the scene itself — remembered, so a resumed take does not try again.)
  let opens = resume.ckOpens || "";
  if (!opens) {
    try { opens = await persistRemote(await repRun("google/nano-banana", { prompt: takeOpensPrompt(take, aspect), image_input: [imageRef(base, still)], aspect_ratio: aspect, output_format: "jpg" }), "jpg"); }
    catch (e) { opens = "-"; console.error(`[take] the way in would not draw — the take starts on its scene: ${e instanceof Error ? e.message.slice(0, 140) : e}`); }
    await ckpt({ ckOpens: opens });
  }
  const firstFrame = opens && opens !== "-" ? opens : still;

  // 4) the take (the seconds that cost money: on the disk the moment they exist) — and 5) no words: it is
  //    listened to, and rolled once more if the engine spoke
  let rawName = resume.ckRaw && fs.existsSync(path.join(dir, resume.ckRaw)) ? resume.ckRaw : "";
  let host = "";
  let rolls = 0;
  const direction = (ref: string) => takePrompt(take, camera, ref);
  const seconds = take.seconds || TAKE_SECONDS;
  const roll = async (): Promise<string> => {
    const rolled = await rollTake({ first: imageRef(base, firstFrame), scene: imageRef(base, still), direction, aspect, seconds });
    host = rolled.host; rolls++;
    return keepRoll(rolled.url);
  };
  // (a DRAMA's driver is meant to speak — only a scare that spoke is rolled again)
  const silent = take.genre !== "drama";
  let spoke: Array<{ at: number; text: string }> | null = resume.ckSpoke ? JSON.parse(resume.ckSpoke) : null;
  // (and A CUT — take.ts → cutsAt — the owner: "the cut is far too obvious": a roll that cuts is rolled again too, in
  //  the same one roll more, and the roll with fewer cuts kept)
  let cuts: number[] = resume.ckCuts ? JSON.parse(resume.ckCuts) : [];
  const said = (s: typeof spoke) => (s === null ? null : wordsIn(s));
  if (!rawName) {
    rawName = await roll();
    await ckpt({ ckRaw: rawName });
    spoke = await heard(base, rawName);
    cuts = await cutsIn(path.join(dir, rawName));
    for (let again = 0; again < rerolls() && rollFaulty({ cuts: cuts.length, words: said(spoke) }, silent); again++) {
      console.log(`[take] ${cuts.length ? `the take cuts (at ${cuts.join("s, ")}s)` : `the engine spoke (${wordsIn(spoke)} words)`} — rolled again`);
      try {
        const next = await roll();
        const nextSpoke = await heard(base, next);
        const nextCuts = await cutsIn(path.join(dir, next));
        if (betterRoll({ cuts: nextCuts.length, words: said(nextSpoke) }, { cuts: cuts.length, words: said(spoke) }, silent)) { rawName = next; spoke = nextSpoke; cuts = nextCuts; await ckpt({ ckRaw: rawName }); }
      } catch (e) { console.error(`[take] the second roll failed — the first is kept: ${e instanceof Error ? e.message.slice(0, 140) : e}`); break; }
    }
    await ckpt({ ckSpoke: JSON.stringify(spoke), ckCuts: JSON.stringify(cuts) });
  }

  // 5½) A CUT IN ITS FIRST SECONDS IS CUT OFF: the take starts on the frame after it (a later one stays — too much of the
  //     take would go). Once: a take already started after its cut is not trimmed again.
  let trimmed = Number(resume.ckTrim) || 0;
  const early = cuts.find((t) => t > 0.3 && t < TRIM_WITHIN);
  if (!trimmed && early != null && !rawName.startsWith("takecut-")) {
    const cutName = `takecut-${stamp()}.mp4`;
    const r = await run("ffmpeg", ["-v", "error", "-y", "-ss", Math.max(0, early - 0.005).toFixed(3), "-i", path.join(dir, rawName), "-c:v", "libx264", "-preset", "fast", "-tune", "film", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", path.join(dir, cutName)], 180_000);
    if (r.code === 0 && fs.existsSync(path.join(dir, cutName)) && (await secondsOf(path.join(dir, cutName))) > 4) {
      console.log(`[take] a cut at ${early}s in a one-shot take — it starts after it`);
      rawName = cutName;
      trimmed = early;
      await ckpt({ ckRaw: rawName, ckTrim: String(early) });
    }
  }

  // 6) the voice behind the camera (and a body cam's radio)
  const voiced = await voiceTake(rawName, take, trimmed);
  const soundName = voiced?.name || rawName;

  // 7) the camera (a body cam prints the night it was worn: today, a little before midnight) — at the size it was
  //    rolled at: a 1080p roll (the pro tier) is dressed at 1080p
  const rolledAt = await sizeOf(path.join(dir, soundName));
  const hd = Math.max(rolledAt.w, rolledAt.h) >= 1800;
  const size = aspect === "16:9" ? (hd ? { w: 1920, h: 1080 } : { w: 1280, h: 720 }) : (hd ? { w: 1080, h: 1920 } : { w: 720, h: 1280 });
  const worn = camera === "bodycam" ? { clock: { date: camToday(), start: 23 * 3600 + 5 * 60 + (parseInt(stamp().slice(-4), 16) % 2900) } } : {};
  const dressed = await dressTake(path.join(dir, soundName), { look: camera, w: size.w, h: size.h, ...worn });
  const outPath = dressed || path.join(dir, soundName);
  const outName = path.basename(outPath);
  // 7½) THE LEVEL every film and story plays at (film-loudness.server.ts: one gain for the whole take, a limiter for its
  //     peaks — the picture is copied). A take came out at −28 LUFS with its voice at −30, where the rest of the
  //     catalogue is −16: on a phone the one filming was barely there (2026-11-25). Never the roll itself.
  if (outName !== rawName) { try { await levelFilm(outPath); } catch { /* left as it was */ } }
  if (outName !== rawName) { try { await mirrorRender(outName, fs.readFileSync(outPath)); } catch { /* non-fatal */ } }
  if (dressed && voiced) fs.rmSync(path.join(dir, voiced.name), { force: true });

  // 8) the piece
  const asset = await db.asset.create({
    data: {
      shopId: opts.shopId,
      type: "VIDEO_AD",
      status: "PENDING",
      title: `Found Footage — ${String(take.title || "a take").slice(0, 60)}`,
      bodyJson: JSON.stringify({ style: "TAKE", videoUrl: `/renders/${outName}`, prompt: opts.idea || take.title || "", script: (voiced?.lines || []).map((l) => l.text).join(" … ") }),
      metaJson: JSON.stringify({
        kind: "take", template: "foundfootage", section: opts.section || "creator", aspect, seconds,
        // the job that made it (what waits for "my piece" asks for exactly this)
        ...(opts.jobId ? { jobId: opts.jobId } : {}),
        // what it was made from, so a take can be looked into (and rolled again) later
        // (`cuts`: where the kept roll cut, in its own seconds; `trimmed`: the seconds cut off its start, a cut with them)
        take: { ...(take.key ? { idea: take.key } : {}), ...(from && opts.idea ? { from: from.key } : {}), ...(take.genre ? { genre: take.genre } : {}), ...(take.ends ? { ends: take.ends } : {}), camera, dressed: !!dressed, host, rolls, ...(cuts.length ? { cuts } : {}), ...(trimmed ? { trimmed } : {}), still, opens: firstFrame === still ? null : opens, raw: `/renders/${rawName}`, direction: direction(TAKE_REF.replicate).slice(0, 2400) },
        // what the one filming says, and when — laid on afterwards (null: the take has no voice on it)
        lines: voiced?.lines || null,
        // what the listening model heard in the take AS THE ENGINE MADE IT — it is given no words, so this
        // should be empty (null = it could not be heard)
        spoke,
      }),
    },
  });
  return asset.id;
}
