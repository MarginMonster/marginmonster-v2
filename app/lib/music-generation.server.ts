// Standalone AI Music generator (Creator section) — "describe a track, get a
// song." Mirrors createImage(): validate → run the model → persist → write ONE
// Asset row (type AUDIO) → return its id. Billed at TOKEN_COST.music (10) at
// enqueue in the route; the queue refunds on terminal failure.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db.server";
import { repCreate, repPoll } from "./ugc-ad-pipeline.server";
import { persistRemoteAudio } from "./image-generation.server";

// meta/musicgen is a VERSIONED community model — it 404s on the versionless
// /models/{owner}/{name}/predictions endpoint, so it MUST be run via the
// /predictions endpoint with a pinned version. (Verified live: the models
// endpoint returns 404.) Pin bumps are a one-line change.
const MUSICGEN_VERSION = "671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb";

/** Start a musicgen prediction by version. Returns the prediction id. Mirrors
 *  the rate-limit tolerance of the repo's other create helpers. */
async function createMusicgen(input: Record<string, unknown>): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not set");
  for (let a = 0; a < 6; a++) {
    const res = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ version: MUSICGEN_VERSION, input }),
    });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 12_000)); continue; }
    if (!res.ok) throw new Error(`musicgen create ${res.status}: ${(await res.text()).slice(0, 180)}`);
    return ((await res.json()) as { id: string }).id;
  }
  throw new Error("musicgen: rate-limited too long");
}

/** Music models can hand back a bare url, an array, or an object keyed
 *  audio/audio_out/audio_url. repPoll already unwraps string|string[]; this
 *  catches the object shapes too. Returns a url or throws. */
function audioUrlOf(raw: unknown, stage: string): string {
  if (typeof raw === "string" && raw) return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  const o = raw as { audio_out?: string; audio?: string | { url?: string }; audio_url?: string } | null;
  const url = o?.audio_out || o?.audio_url || (typeof o?.audio === "string" ? o.audio : o?.audio?.url);
  if (url) return url;
  throw new Error(`[music:${stage}] no audio url in result`);
}

/** Generate a music track from a free-text prompt and persist it as an AUDIO
 *  asset. Returns the new asset id. Throws on total engine failure (→ refund). */
export async function generateMusic(opts: {
  shopId: string;
  prompt: string;
  title?: string;
}): Promise<string> {
  const prompt = (opts.prompt || "").trim();
  if (!prompt) throw new Error("Describe the music you want.");

  // meta/musicgen — text → instrumental track, prompt-native, no lyrics, cheap.
  // stereo-large is pure text-to-music (no melody conditioning); a second config
  // (plain large) covers a schema/capacity hiccup. Total failure → queue refund.
  const attempts: Record<string, unknown>[] = [
    { prompt, duration: 12, output_format: "mp3", normalization_strategy: "peak", model_version: "stereo-large" },
    { prompt, duration: 10, output_format: "mp3", model_version: "large" },
  ];
  const errors: string[] = [];
  let remoteUrl = "";
  for (const input of attempts) {
    try {
      const id = await createMusicgen(input);
      const raw = (await repPoll(id, 5 * 60_000, "music")) as unknown;
      remoteUrl = audioUrlOf(raw, "musicgen");
      break;
    } catch (e) {
      errors.push((e as Error).message.slice(0, 180));
    }
  }
  if (!remoteUrl) throw new Error(`[music] every engine failed: ${errors.join(" | ")}`);

  const audioUrl = await persistRemoteAudio(remoteUrl);
  const title = (opts.title || prompt).slice(0, 80);
  const asset = await db.asset.create({
    data: {
      shopId: opts.shopId,
      type: "AUDIO",
      status: "PENDING",
      title,
      bodyJson: JSON.stringify({ audioUrl, prompt, engine: "musicgen" }),
      metaJson: JSON.stringify({ kind: "song", section: "creator", engine: "musicgen" }),
    },
  });
  return asset.id;
}

/** Generate a short musicgen track and return its ABSOLUTE disk path — a raw
 *  background-music bed for pipelines (faceless video), NOT a gallery asset. */
export async function musicBedToDisk(prompt: string): Promise<string> {
  const id = await createMusicgen({ prompt, duration: 12, output_format: "mp3", model_version: "stereo-large" });
  const raw = (await repPoll(id, 5 * 60_000, "music-bed")) as unknown;
  const url = audioUrlOf(raw, "music-bed");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`music-bed fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 2_000) throw new Error("music-bed came back empty");
  const dir = path.join(process.cwd(), "data", "renders");
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `mbed-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp3`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, buf);
  return filePath;
}

/** Generate a SUNG song (vocals + music) from lyrics via minimax/music-1.5 — the
 *  SAME engine the Anthem uses to sing — and return its ABSOLUTE disk path. For
 *  the Film engine's musical templates (music video, kids cartoon): a real sung
 *  track, not an instrumental bed. Falls back to music-01. Throws on total
 *  failure so the caller can fall back to musicBedToDisk. */
export async function singToDisk(lyrics: string, stylePrompt: string): Promise<string> {
  // minimax HARD-CAPS lyrics at 600 characters (E006) — longer input is rejected
  // outright, so trim here. The model still returns a FULL song (it pads with
  // intro/outro + repeats the chorus), so a tight <=590-char lyric sheet is enough
  // for a full-length track. And `prompt` is REQUIRED on every attempt (422 without).
  const clean = (lyrics || "").trim().slice(0, 590);
  if (!clean) throw new Error("[sing] no lyrics");
  const style = stylePrompt || "catchy upbeat song with clear vocals";
  const attempts: Array<{ model: string; input: Record<string, unknown> }> = [
    { model: "minimax/music-1.5", input: { lyrics: clean, prompt: style } },
    { model: "minimax/music-1.5", input: { lyrics: clean, prompt: style } },
    { model: "minimax/music-01", input: { lyrics: clean, prompt: style } },
  ];
  let url = "";
  const errors: string[] = [];
  for (const a of attempts) {
    try { url = audioUrlOf(await repPoll(await repCreate(a.model, a.input), 5 * 60_000, "sing"), a.model); if (url) break; }
    catch (e) { errors.push((e as Error).message.slice(0, 160)); }
  }
  if (!url) throw new Error(`[sing] every engine failed: ${errors.join(" | ")}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[sing] fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 2_000) throw new Error("[sing] came back empty");
  const dir = path.join(process.cwd(), "data", "renders");
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `sing-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp3`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, buf);
  return filePath;
}

// ---- Avatar-voice SINGING (the merchant's own avatar actually sings the song) -----------------------
// minimax/music has NO voice-clone input, so a generated song comes back in minimax's OWN voice. To make
// it the AVATAR'S voice (owner: "custom avatar, custom voice — song sung in that voice") we (1) synth a
// short reference clip in the avatar's real MiniMax voice, then (2) run zero-shot SINGING VOICE
// CONVERSION (seed-vc) to re-timbre the song's vocals to that reference. seed-vc is a COMMUNITY model, so
// it runs VERSION-PINNED via /predictions (the versionless /models endpoint 404s for community models,
// like musicgen). Experimental: every caller guards it and falls back to the plain sung track.

/** Resolve azer/seed-vc's current version id at runtime (cached), so no hash is hardcoded to rot. Runs on
 *  the server where REPLICATE_API_TOKEN lives. */
let SEED_VC_VERSION = "";
async function seedVcVersion(): Promise<string> {
  if (SEED_VC_VERSION) return SEED_VC_VERSION;
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not set");
  const res = await fetch("https://api.replicate.com/v1/models/azer/seed-vc", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`seed-vc model lookup ${res.status}`);
  const j = (await res.json()) as { latest_version?: { id?: string } };
  const id = j.latest_version?.id;
  if (!id) throw new Error("seed-vc has no latest_version");
  SEED_VC_VERSION = id;
  return id;
}

/** POST a version-pinned seed-vc prediction; returns the prediction id. Rate-limit tolerant like musicgen. */
async function createSeedVc(input: Record<string, unknown>): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not set");
  const version = await seedVcVersion();
  for (let a = 0; a < 6; a++) {
    const res = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ version, input }),
    });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 12_000)); continue; }
    if (!res.ok) throw new Error(`seed-vc create ${res.status}: ${(await res.text()).slice(0, 180)}`);
    return ((await res.json()) as { id: string }).id;
  }
  throw new Error("seed-vc: rate-limited too long");
}

/** Synthesize a short SPEECH reference in the avatar's own MiniMax voice (speech-02-hd) and return its
 *  ABSOLUTE disk path — the target-voice sample for seed-vc (which uses the first ~25s). Throws on failure
 *  so the caller falls back to the plain song. */
export async function synthVoiceSampleToDisk(voiceId: string): Promise<string> {
  const vid = (voiceId || "").trim();
  if (!vid) throw new Error("[voice-sample] no voiceId");
  const text = "Hey, this is my voice. I'm about to sing you a song, so let's bring the energy and keep it smooth. Here we go now, nice and clear, from the very top.";
  const url = audioUrlOf(await repPoll(await repCreate("minimax/speech-02-hd", { text, voice_id: vid }), 5 * 60_000, "voice-sample"), "voice-sample");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[voice-sample] fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 2_000) throw new Error("[voice-sample] came back empty");
  const dir = path.join(process.cwd(), "data", "renders");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `vsample-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp3`);
  fs.writeFileSync(filePath, buf);
  return filePath;
}

/** Zero-shot SINGING voice conversion: re-timbre `songUrl`'s vocals to the voice in `sampleUrl` via
 *  seed-vc. Both MUST be public urls (Replicate fetches them). Returns the converted track's ABSOLUTE disk
 *  path. Throws on any failure so the caller keeps the original song. */
export async function seedVcConvert(songUrl: string, sampleUrl: string, pitchShift = 0): Promise<string> {
  const id = await createSeedVc({ audio: songUrl, voice_sample: sampleUrl, pitch_shift: Math.max(-12, Math.min(12, Math.round(pitchShift))) });
  const url = audioUrlOf(await repPoll(id, 8 * 60_000, "seed-vc"), "seed-vc");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[seed-vc] fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 2_000) throw new Error("[seed-vc] came back empty");
  const dir = path.join(process.cwd(), "data", "renders");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `vconv-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.wav`);
  fs.writeFileSync(filePath, buf);
  return filePath;
}
