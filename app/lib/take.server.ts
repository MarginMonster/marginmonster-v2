/* A TAKE, MADE — one continuous twelve-second shot of found footage, start to Archive.
 *
 * What it is and why it is built the way it is: take.ts (the recipe) and camera-dress.ts (the camera it was
 * "shot on"). This file is the making:
 *
 *   1. THE TAKE'S PARTS  a ready-made scare, or the member's own idea written into the same parts (a writer
 *                        that fails or half-answers falls back to the first ready-made one — a take is
 *                        never made from half a direction).
 *   2. THE SCENE         the picture the take ARRIVES at, drawn by the creature recipe.
 *   3. THE WAY IN        the take's first frame — the same place a moment earlier, off its subject — drawn
 *                        FROM the scene (the owner: "a 2 second off of subject at the beggining then pans
 *                        to the actual scene"). When it will not draw, the take starts on the scene itself.
 *   4. THE TAKE          Kling 3 Omni with its own sound, started on the way in and told to find the scene
 *                        "exactly as in" the reference picture. fal's standard tier first (what the acted
 *                        films render on), then the same model elsewhere.
 *   5. NO WORDS          the engine is given none (it lip-syncs any line onto the only mouth it can see —
 *                        "bro the monster literally lipsynced every word"), and the take is LISTENED to: if
 *                        the engine spoke anyway, it is rolled once more and the quieter roll is kept.
 *   6. THE VOICE         what the one filming says is the app's own speaking voice, laid over the take with
 *                        the room lifted to a real level (take.ts → takeSound). The picture is never touched.
 *   7. THE CAMERA        the take is dressed as a phone, a camcorder, or nothing (camera-dress.ts), at a
 *                        capped bit-rate — grain is incompressible, and an uncapped camcorder take was 130 MB.
 *   8. THE PIECE         a VIDEO_AD in the Archive, named for what it is.
 *
 * Every step after the take itself degrades instead of failing: no way in → it starts on the scene; not
 * heard → kept unheard; a voice that will not speak → the take without it; a look that will not render → the
 * plain take is the piece. The seconds that cost money are never thrown away.
 *
 * NOT WIRED YET (2026-11-24): nothing queues this. It waits on the owner's name and price for the paid tier
 * ("Red Carpet" / "Premium Takes"), and on a place in the Movie Maker. */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { db } from "../db.server";
import { anthropicText } from "./anthropic.server";
import { cameraLookOf, dressFilter, type CameraLook } from "./camera-dress";
import { createWhisperx, wordsFromWhisperx } from "./faceless-video.server";
import { falEnabled, falVideoPoll, falVideoSubmit } from "./fal-video.server";
import { persistRemote, repRun } from "./image-generation.server";
import { mirrorRender } from "./object-storage.server";
import { overlayFonts } from "./overlay-fonts.server";
import { TAKE_HISS, TAKE_IDEAS, TAKE_REF, TAKE_SECONDS, TAKE_VOICE, parseTake, placeLines, takeIdea, takeLines, takeOpensPrompt, takePrompt, takeSound, takeStillPrompt, takeWriterBrief, type Take } from "./take";
import { checkpointJob, repCreate, repPoll } from "./ugc-ad-pipeline.server";

// (the same model, three hosts. The two fal ids are its "reference" endpoint — a first frame AND a picture to
//  arrive at, fal-video-body.ts — at the two tiers the acted films use, in film-dialogue.server.ts's order.)
const FAL_OMNI_STD = "fal-ai/kling-video/o3/standard/reference-to-video";
const FAL_OMNI = "fal-ai/kling-video/o3/pro/reference-to-video";
const REP_OMNI = "kwaivgi/kling-v3-omni-video";
const TAKE_POLL_MS = 20 * 60_000;
/** How many times a take is rolled again because the engine SPOKE (0 = never). Each one is a whole take
 *  paid for a second time — the owner's to turn off: TAKE_REROLLS=0. */
const rerolls = (): number => { const n = Number(process.env.TAKE_REROLLS); return Number.isFinite(n) && n >= 0 ? Math.min(2, Math.floor(n)) : 1; };

const renders = () => path.join(process.cwd(), "data", "renders");
const stamp = () => `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;

function run(cmd: string, args: string[], maxMs = 180_000): Promise<{ code: number; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err = (err + String(d)).slice(-4000); });
    const timer = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* gone */ } }, maxMs);
    p.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, err }); });
    p.on("error", (e) => { clearTimeout(timer); resolve({ code: 1, err: String(e) }); });
  });
}

/** The take itself, started on `first` and told to arrive at `scene`: fal's standard tier, then the same
 *  model elsewhere. A refused or failed render is not billed, so falling through never pays twice. */
async function rollTake(o: { first: string; scene: string; direction: (ref: string) => string; aspect: "9:16" | "16:9" }): Promise<{ url: string; host: string }> {
  const viaFal = (model: string) => async () => falVideoPoll(model, await falVideoSubmit(model, { startImage: o.first, referenceImages: [o.scene], prompt: o.direction(TAKE_REF.fal), generateAudio: true, durationSec: TAKE_SECONDS, aspect: o.aspect }), TAKE_POLL_MS);
  const order: Array<{ host: string; fal: boolean; go: () => Promise<string> }> = [
    { host: "fal kling 3 omni standard", fal: true, go: viaFal(FAL_OMNI_STD) },
    { host: "fal kling 3 omni", fal: true, go: viaFal(FAL_OMNI) },
    { host: "replicate kling 3 omni", fal: false, go: async () => repPoll(await repCreate(REP_OMNI, { prompt: o.direction(TAKE_REF.replicate), start_image: o.first, reference_images: [o.scene], generate_audio: true, duration: TAKE_SECONDS, mode: "pro" }), TAKE_POLL_MS, "take") },
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
async function keepRoll(url: string): Promise<string> {
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
async function heard(base: string, fileName: string): Promise<Array<{ at: number; text: string }> | null> {
  if (!base || !process.env.REPLICATE_API_TOKEN) return null;
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
const wordsIn = (said: Array<{ text: string }> | null): number => (said || []).reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);

/** How long a sound or a film is, in seconds (0 when it cannot be read). */
async function secondsOf(file: string): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (d) => { out += String(d); });
    p.on("close", () => resolve(Number(out.trim()) || 0));
    p.on("error", () => resolve(0));
  });
}

/** One line in the voice of the one filming → a sound file on the disk (its name), or "" when the voice would
 *  not speak. The better voice model first, the quick one if it blips. */
async function sayLine(text: string): Promise<string> {
  for (const model of ["minimax/speech-02-hd", "minimax/speech-02-turbo"]) {
    try {
      const url = await repPoll(await repCreate(model, { text, voice_id: TAKE_VOICE.id, emotion: TAKE_VOICE.emotion, speed: TAKE_VOICE.speed }), 3 * 60_000, "take-voice");
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

/** THE VOICE BEHIND THE CAMERA, laid over the take's own room (take.ts → takeSound). Returns the voiced
 *  take's file name and the lines as they were placed — or null when nothing could be laid on (the caller
 *  keeps the take as it is). The picture is copied, never re-encoded. */
async function voiceTake(rawName: string, take: Take): Promise<{ name: string; lines: Array<{ at: number; text: string }> } | null> {
  const dir = renders();
  const said: string[] = [];
  try {
    const asked = takeLines(take);
    if (!asked.length) return null;
    const spoken: Array<{ at: number; text: string; file: string; seconds: number }> = [];
    for (const l of asked) {
      const file = await sayLine(l.text);
      if (!file) continue;
      said.push(file);
      spoken.push({ ...l, file, seconds: await secondsOf(path.join(dir, file)) });
    }
    const rawPath = path.join(dir, rawName);
    const total = (await secondsOf(rawPath)) || TAKE_SECONDS;
    const placed = placeLines(spoken, total);
    if (!placed.length) return null;
    // how loud the take's own room is, and whether it has a sound at all
    const probe = await run("ffmpeg", ["-v", "info", "-i", rawPath, "-vn", "-af", "volumedetect", "-f", "null", "-"], 60_000);
    const hasSound = /Audio:/.test(probe.err);
    const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(probe.err);
    const out = `takevoiced-${stamp()}.mp4`;
    const args = ["-v", "error", "-y", "-i", rawPath];
    for (const l of placed) args.push("-i", path.join(dir, l.file));
    args.push("-f", "lavfi", "-t", String(total), "-i", TAKE_HISS,
      "-filter_complex", takeSound({ lines: placed, roomDb: mean ? Number(mean[1]) : null, hasSound }),
      "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", String(total), "-movflags", "+faststart", path.join(dir, out));
    const r = await run("ffmpeg", args, 120_000);
    if (r.code !== 0 || !fs.existsSync(path.join(dir, out)) || fs.statSync(path.join(dir, out)).size < 50_000) throw new Error(r.err.slice(-240) || "no file");
    return { name: out, lines: placed.map((l) => ({ at: l.at, text: l.text })) };
  } catch (e) {
    console.error(`[take] the voice could not be laid on — the take ships without it: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
    return null;
  } finally {
    for (const f of said) fs.rmSync(path.join(dir, f), { force: true });
  }
}

/** The take dressed as its camera. Null when the look would not render — the caller then ships the take
 *  as it is. */
async function dress(inPath: string, look: CameraLook, w: number, h: number): Promise<string | null> {
  try {
    const fonts = await overlayFonts(8_000);
    const d = dressFilter({ look, w, h, font: fonts.font, fontThin: fonts.thin, fontMono: fonts.mono });
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
    const r = await run("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex_script", script, "-map", "[v]", "-map", "0:a?", ...(d.audio ? ["-af", d.audio] : []),
      "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-maxrate", "7M", "-bufsize", "14M", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out], 300_000);
    fs.rmSync(script, { force: true });
    for (const f of fs.readdirSync(dir)) if (f.startsWith(`take-${id}-chrome`)) fs.rmSync(path.join(dir, f), { force: true });
    if (r.code !== 0 || !fs.existsSync(out) || fs.statSync(out).size < 50_000) throw new Error(r.err.slice(-240) || "no file");
    return out;
  } catch (e) {
    console.error(`[take] the ${look} look did not render — shipping the take as it is: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
    return null;
  }
}

export type TakeOptions = {
  shopId: string;
  /** a ready-made scare (take.ts → TAKE_IDEAS)… */
  ideaKey?: string;
  /** …or the member's own idea, in a line */
  idea?: string;
  camera?: string;
  aspect?: string;
  section?: string;
  jobId?: string;
  resume?: { ckTake?: string; ckStill?: string; ckOpens?: string; ckRaw?: string; ckSpoke?: string };
};

/** Make one take. Returns the new piece's id. */
export async function generateTake(opts: TakeOptions): Promise<string> {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const camera: CameraLook = cameraLookOf(opts.camera) || "phone";
  const aspect: "9:16" | "16:9" = opts.aspect === "16:9" ? "16:9" : "9:16";
  const resume = opts.resume || {};
  const ckpt = async (patch: Record<string, unknown>) => { if (opts.jobId) await checkpointJob(opts.jobId, patch); };
  const dir = renders();
  fs.mkdirSync(dir, { recursive: true });

  // 1) the take's parts
  let take: Take & { title: string; key?: string };
  const ready = takeIdea(opts.ideaKey);
  if (resume.ckTake) take = JSON.parse(resume.ckTake);
  else if (ready) take = { ...ready, title: ready.name };
  else {
    let written: (Take & { title: string }) | null = null;
    try {
      written = parseTake(await anthropicText(takeWriterBrief(opts.idea || ""), {
        maxTokens: 1600,
        jsonSchema: { name: "take", schema: { type: "object", additionalProperties: false, required: ["title", "who", "still", "opens", "first", "finds", "beats", "says", "asks", "sound"], properties: { title: { type: "string" }, who: { type: "string" }, still: { type: "string" }, opens: { type: "string" }, first: { type: "string" }, finds: { type: "string" }, beats: { type: "array", items: { type: "string" } }, says: { type: "array", items: { type: "string" } }, asks: { type: "string", enum: ["looking", "found"] }, sound: { type: "string" } } } },
      }));
    } catch (e) { console.error(`[take] the writer did not answer — a ready-made scare is used: ${e instanceof Error ? e.message.slice(0, 140) : e}`); }
    take = written || { ...TAKE_IDEAS[0], title: TAKE_IDEAS[0].name };
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
    try { opens = await persistRemote(await repRun("google/nano-banana", { prompt: takeOpensPrompt(take, aspect), image_input: [`${base}${still}`], aspect_ratio: aspect, output_format: "jpg" }), "jpg"); }
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
  const roll = async (): Promise<string> => {
    const rolled = await rollTake({ first: `${base}${firstFrame}`, scene: `${base}${still}`, direction, aspect });
    host = rolled.host; rolls++;
    return keepRoll(rolled.url);
  };
  let spoke: Array<{ at: number; text: string }> | null = resume.ckSpoke ? JSON.parse(resume.ckSpoke) : null;
  if (!rawName) {
    rawName = await roll();
    await ckpt({ ckRaw: rawName });
    spoke = await heard(base, rawName);
    for (let again = 0; again < rerolls() && wordsIn(spoke) > 0; again++) {
      console.log(`[take] the engine spoke (${wordsIn(spoke)} words) — rolled again`);
      try {
        const next = await roll();
        const nextSpoke = await heard(base, next);
        // (a roll that could not be heard is not known to be quieter: the one that was heard is kept)
        if (nextSpoke !== null && wordsIn(nextSpoke) < wordsIn(spoke)) { rawName = next; spoke = nextSpoke; await ckpt({ ckRaw: rawName }); }
      } catch (e) { console.error(`[take] the second roll failed — the first is kept: ${e instanceof Error ? e.message.slice(0, 140) : e}`); break; }
    }
    await ckpt({ ckSpoke: JSON.stringify(spoke) });
  }

  // 6) the voice behind the camera
  const voiced = await voiceTake(rawName, take);
  const soundName = voiced?.name || rawName;

  // 7) the camera
  const size = aspect === "16:9" ? { w: 1280, h: 720 } : { w: 720, h: 1280 };
  const dressed = await dress(path.join(dir, soundName), camera, size.w, size.h);
  const outPath = dressed || path.join(dir, soundName);
  const outName = path.basename(outPath);
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
        kind: "take", template: "foundfootage", section: opts.section || "creator", aspect, seconds: TAKE_SECONDS,
        // what it was made from, so a take can be looked into (and rolled again) later
        take: { ...(take.key ? { idea: take.key } : {}), camera, dressed: !!dressed, host, rolls, still, opens: firstFrame === still ? null : opens, raw: `/renders/${rawName}`, direction: direction(TAKE_REF.replicate).slice(0, 2400) },
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
