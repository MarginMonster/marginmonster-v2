// Avatar-voice SINGING — the merchant's avatar sings the song in their OWN voice.
//
// minimax/music has no voice-clone input, so a generated song comes back in minimax's own voice. We KEEP
// that song (the music the owner validated) and RE-VOICE its lead vocal with RVC — the standard "AI
// cover" method, prototyped 2026-11-16 against the owner's avatar "Madalynn" before being wired in:
//
//   1. TRAIN — once per voice id, cached on the renders disk. Synthesize ~5 minutes of speech in the
//      avatar's MiniMax voice → 8-second clips → a dataset zip → replicate/train-rvc-model → a voice
//      model zip (~145 MB). Measured: ~70 s of speech synthesis + ~4-6 min of training.
//   2. COVER — per song. zsxkib/realistic-voice-cloning separates the vocal, converts it to the trained
//      voice and remixes it over the untouched instrumental. Measured: ~60-90 s; same duration out as in.
//
// Both are COMMUNITY models, so they run version-pinned through /predictions with the version resolved
// at runtime (the versionless /models endpoint 404s for community models, like musicgen). Every function
// here THROWS on failure — the music-video pipeline catches and keeps the normal sung track, so a voice
// hiccup can never fail a render.
//
// (History: the first cut of this feature called "azer/seed-vc", which is a GitHub repo and was never a
// published Replicate model — every call 404'd and fell back. Model slugs below were verified against
// Replicate's API, input schemas included, before this was written.)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { repCreate, repPoll, download, runFfmpeg, ffprobeDuration } from "./ugc-ad-pipeline.server";
import { trackF0, medianHz, semitonesToMatch } from "./pitch";

const RENDERS = () => path.join(process.cwd(), "data", "renders");
const rid = () => crypto.randomBytes(6).toString("hex");

const TRAIN_MODEL = "replicate/train-rvc-model";
const COVER_MODEL = "zsxkib/realistic-voice-cloning";
const TRAIN_EPOCHS = 60;              // 60 epochs on ~5 min of clean speech ≈ 4 min of GPU time
const TRAIN_MAX_MS = 25 * 60_000;     // incl. a cold boot; past this the render carries on with the normal voice
const COVER_MAX_MS = 12 * 60_000;

// ---- Replicate community models (version-pinned) ------------------------------------------------------

const versionCache = new Map<string, string>();
async function communityVersion(model: string): Promise<string> {
  const hit = versionCache.get(model);
  if (hit) return hit;
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not set");
  const res = await fetch(`https://api.replicate.com/v1/models/${model}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${model} lookup ${res.status}`);
  const id = ((await res.json()) as { latest_version?: { id?: string } }).latest_version?.id;
  if (!id) throw new Error(`${model} has no published version`);
  versionCache.set(model, id);
  return id;
}

/** Start a version-pinned prediction on a community model; returns the prediction id. */
async function createCommunity(model: string, input: Record<string, unknown>): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not set");
  const version = await communityVersion(model);
  for (let a = 0; a < 6; a++) {
    const res = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ version, input }),
    });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 12_000)); continue; }
    if (!res.ok) throw new Error(`${model} create ${res.status}: ${(await res.text()).slice(0, 180)}`);
    return ((await res.json()) as { id: string }).id;
  }
  throw new Error(`${model}: rate-limited too long`);
}

// ---- A dependency-free STORE zip (the dataset the trainer wants) ---------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Uncompressed zip with forward-slash entry names (WAV barely compresses, and the trainer only needs the
 *  `dataset/<name>/split_<i>.wav` layout). */
function zipStore(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nm = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, nm, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nm);
    offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

// ---- 1. TRAIN: a voice model per voice id ---------------------------------------------------------------

// ~5 minutes of varied speech: conversational, excited, calm, instructive, lists and odd consonants — the
// spread of tone and phonemes is what lets the model carry the voice across a sung melody.
const VOICE_SCRIPT: string[] = [
  "Hey, it's me. I want to tell you about the best night I've had in a long, long time. We drove out past the city just as the sun was going down, windows open, music loud, and nobody was in a hurry to be anywhere. Honestly, that's my favorite kind of evening. The sky went orange, then pink, then this deep quiet blue, and for a minute nobody said a word. Have you ever had a moment like that? Where everything just feels easy? I think about it all the time.",
  "Okay, real talk. When I started out, I had no idea what I was doing. None. I made every mistake you can imagine, and a few you probably can't. But here's the thing: each one taught me something useful. Why wait for perfect? Perfect never shows up. You begin, you adjust, you keep moving, and one day you look back and you're amazed at how far you've come. So if you're unsure, jump in anyway. Ask the question. Make the call. Try the weird idea. What's the worst that could happen?",
  "Let me walk you through my morning. I wake up early, usually before six, and the very first thing I do is open the window. Fresh air, every single day. Then coffee, black, no sugar, and ten quiet minutes with a notebook. I write down three things: what I'm grateful for, what I'm working on, and one thing I'll do just for fun. After that it's a quick workout, a long shower, and my favorite playlist while I get ready. Simple, right? But those small routines change everything about how the day goes.",
  "Whoa, wait a second. Did you see that? Unbelievable! I've been waiting years to watch something like this happen, and it was even better than I pictured. The crowd went wild, people were jumping, cheering, hugging total strangers. Yes! That's exactly the energy I love. Zero doubt, zero fear, just pure joy and a little bit of chaos. If you ever get the chance to be part of a night like this one, take it. Bring your friends, wear something bright, and sing as loud as you possibly can.",
  "Numbers matter, so let's go through them slowly. One, two, three, four, five. Six, seven, eight, nine, ten. Twenty, thirty, forty, fifty, a hundred, a thousand. Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday. January through December, summer through winter, north, south, east, and west. Blue jeans, yellow shoes, a quiet zebra, a fuzzy peach, the vision of a judge, a measure of pleasure. Above, below, around, and through. Easy does it. Smooth and steady wins every time.",
  "I'll be honest with you, I was nervous. My hands were shaking and my heart was pounding like a drum. But the moment the lights came up, something shifted. I took a deep breath, looked out at all those faces, and thought, this is what I came here to do. So I smiled, I stepped forward, and I gave it everything I had. Afterward a little girl ran up and told me she wanted to do the same thing someday. That, right there, made every late night worth it.",
  "Picture this. A tiny kitchen, rain tapping on the glass, and a pot of something warm bubbling on the stove. My grandmother used to hum while she cooked, low and slow, the same three songs over and over. She'd hand me a wooden spoon and say, taste it, tell me what it needs. Usually it needed nothing at all. Garlic, butter, a pinch of salt, a squeeze of lemon. To this day, whenever I smell onions frying, I'm right back in that kitchen, eight years old and completely happy.",
  "Listen up, because this part is important. Nobody is coming to do it for you. Not your boss, not your best friend, not some lucky break. You want the life you keep daydreaming about? Then get up. Move. Show up when it's raining, when you're tired, when nobody is clapping. Stack small wins until they turn into big ones. And when people ask how you pulled it off, tell them the truth: you just refused to quit. Now go. Clock's ticking, and you've got work to do.",
  "Shh, come closer, I'll tell you a secret. The ocean is loudest right before dawn, when the tide rolls in and the gulls haven't woken up yet. I like to walk the shoreline then, shoes in one hand, coffee in the other, watching the horizon turn from charcoal to gold. Sometimes a dolphin breaks the surface. Sometimes it's only me and the waves, back and forth, whoosh and hush. It's the calmest hour of the whole day, and almost nobody ever sees it. Their loss, don't you think?",
  "Alright team, quick update! We launched on Thursday, and the response has been unreal. Orders tripled overnight, the reviews are glowing, and our inbox is overflowing with thank-you notes. Huge shout-out to everybody who stayed late, fixed the bugs, packed the boxes, and answered the phones. You are the reason this works. Next week we roll out two new colors, a bigger size, and free shipping for our loyal customers. Exciting, right? Let's keep that momentum going. High five, everyone!",
];

/** One clip of speech in the avatar's voice → `out` (mp3). speech-02-hd, then turbo if hd blips. */
async function synthSpeech(voiceId: string, text: string, out: string): Promise<void> {
  let lastErr: unknown = null;
  for (const model of ["minimax/speech-02-hd", "minimax/speech-02-turbo"]) {
    try {
      const url = await repPoll(await repCreate(model, { text, voice_id: voiceId }), 4 * 60_000, "voice-train-tts");
      if (typeof url === "string" && /^https?:\/\//.test(url)) { await download(url, out); return; }
    } catch (e) { lastErr = e; }
  }
  throw new Error(`[voice] speech synthesis failed: ${lastErr instanceof Error ? lastErr.message.slice(0, 140) : lastErr}`);
}

/** Stable, unguessable file key for a voice id (the model zip is served from /renders by name). */
function voiceKey(voiceId: string): string {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET || "easymode-voice").update(voiceId).digest("hex").slice(0, 24);
}

async function trainVoiceModel(voiceId: string, key: string, base: string, finalPath: string): Promise<void> {
  const work = path.join(RENDERS(), `rvcwork-${key}-${rid()}`);
  const dataZip = path.join(RENDERS(), `rvcdata-${key}-${rid()}.zip`);
  fs.mkdirSync(path.join(work, "split"), { recursive: true });
  try {
    // a) speech in the avatar's voice, three clips at a time
    const clips = VOICE_SCRIPT.map((_, i) => path.join(work, `speech_${i}.mp3`));
    let next = 0;
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (next < VOICE_SCRIPT.length) { const i = next++; await synthSpeech(voiceId, VOICE_SCRIPT[i], clips[i]); }
    }));
    // b) one take → 8-second mono 40 kHz WAV clips
    const list = path.join(work, "concat.txt");
    fs.writeFileSync(list, clips.map((c) => `file '${c.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
    const seg = await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", list, "-f", "segment", "-segment_time", "8",
      "-ar", "40000", "-ac", "1", "-c:a", "pcm_s16le", path.join(work, "split", "split_%d.wav")]);
    const wavs = fs.readdirSync(path.join(work, "split")).filter((f) => f.endsWith(".wav"))
      .sort((a, b) => parseInt(a.split("_")[1], 10) - parseInt(b.split("_")[1], 10));
    if (seg.status !== 0 || wavs.length < 12) throw new Error(`[voice] dataset split failed (${wavs.length} clips)`);
    // c) dataset zip, served to the trainer from /renders
    const name = `v${key.slice(0, 12)}`;
    fs.writeFileSync(dataZip, zipStore(wavs.map((f) => ({ name: `dataset/${name}/${f}`, data: fs.readFileSync(path.join(work, "split", f)) }))));
    // d) train
    const id = await createCommunity(TRAIN_MODEL, {
      dataset_zip: `${base}/renders/${path.basename(dataZip)}`,
      sample_rate: "40k", version: "v2", f0method: "rmvpe_gpu", epoch: TRAIN_EPOCHS, batch_size: "7",
    });
    const modelUrl = await repPoll(id, TRAIN_MAX_MS, "voice-train");
    if (typeof modelUrl !== "string" || !/^https?:\/\//.test(modelUrl)) throw new Error("[voice] training returned no model");
    // e) keep the model (atomic: a half-written zip must never look like a finished one)
    const tmp = `${finalPath}.part-${rid()}`;
    try {
      await download(modelUrl, tmp);
      if (fs.statSync(tmp).size < 5_000_000) throw new Error("[voice] trained model came back too small");
      fs.renameSync(tmp, finalPath);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
      throw e;
    }
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(dataZip, { force: true }); } catch { /* best-effort */ }
  }
}

const training = new Map<string, Promise<void>>();

/** The public URL of this voice's trained model, training it first if it doesn't exist yet. `base` is the
 *  app's public origin (Replicate downloads the dataset + model from /renders). */
export async function ensureVoiceModel(voiceId: string, base: string): Promise<{ url: string; trained: boolean }> {
  const vid = (voiceId || "").trim();
  if (!vid) throw new Error("[voice] no voice id");
  if (!base) throw new Error("[voice] no public base url");
  const key = voiceKey(vid);
  const file = path.join(RENDERS(), `rvcvoice-${key}.zip`);
  const url = `${base}/renders/${path.basename(file)}`;
  if (fs.existsSync(file) && fs.statSync(file).size > 5_000_000) return { url, trained: false };
  let job = training.get(key);
  if (!job) {
    fs.mkdirSync(RENDERS(), { recursive: true });
    job = trainVoiceModel(vid, key, base, file).finally(() => training.delete(key));
    training.set(key, job);
  }
  await job;
  return { url, trained: true };
}

// ---- 1b. PITCH: where a voice naturally speaks ------------------------------------------------------------
//
// The re-voice keeps whatever pitch it is handed. Handed a line the video model acted far from the picked
// voice's own range, it comes out wrong in proportion: a 93 Hz stock voice driven at a child's 320 Hz was
// "a demon" (owner, 2026-11-17). So a spoken line is first moved to where the picked voice speaks.

/** Median speaking pitch (Hz) of the voice in an audio or video file; null when there is too little
 *  voiced speech to say. Looks at the first 40 seconds, in slices, yielding between them — the worker
 *  shares its event loop with every request. */
export async function medianPitchOf(file: string): Promise<number | null> {
  const raw = path.join(RENDERS(), `pitch-${rid()}.raw`);
  try {
    const r = await runFfmpeg(["-y", "-i", file, "-vn", "-t", "40", "-ac", "1", "-ar", "16000", "-f", "s16le", raw]);
    if (r.status !== 0 || !fs.existsSync(raw)) return null;
    const b = fs.readFileSync(raw);
    const n = b.length >> 1;
    const SLICE = 16000 * 2; // 2 s at a time
    const f0s: number[] = [];
    for (let at = 0; at < n; at += SLICE) {
      const len = Math.min(SLICE + 16000 / 4, n - at); // a little overlap so no frame is lost at the seam
      const x = new Float32Array(len);
      for (let i = 0; i < len; i++) x[i] = b.readInt16LE((at + i) * 2) / 32768;
      for (const f of trackF0(x, 16000)) f0s.push(f);
      await new Promise<void>((res) => setImmediate(res));
    }
    return medianHz(f0s);
  } catch {
    return null;
  } finally {
    try { fs.rmSync(raw, { force: true }); } catch { /* temp file */ }
  }
}

const PITCH_REFERENCE_LINE = "Okay, so this is the thing. I was going to tell you all about it yesterday, but honestly, today is even better.";
const pitchFile = (voiceId: string) => path.join(RENDERS(), `rvcvoice-${voiceKey(voiceId)}.pitch.json`);
const voicePitchJobs = new Map<string, Promise<number | null>>();

/** The pitch a voice naturally speaks at (Hz), measured once and kept beside its model: from the
 *  same short line read plainly in that voice (the picker's sample if that can't be synthesized).
 *  Null when it can't be measured — the caller then leaves the line's pitch alone. */
export function voicePitch(voiceId: string): Promise<number | null> {
  const vid = (voiceId || "").trim();
  if (!vid) return Promise.resolve(null);
  let job = voicePitchJobs.get(vid);
  if (!job) {
    job = (async () => {
      const cache = pitchFile(vid);
      try { const hz = Number(JSON.parse(fs.readFileSync(cache, "utf8")).hz); if (hz > 40 && hz < 800) return hz; } catch { /* not measured yet */ }
      // ONE yardstick for every voice: a plain read of the same two sentences. (The picker's stock
      // samples are rendered "happy" and sit 3-5 semitones above the same voice reading plainly —
      // "Playful" is 326 Hz there and ~250 Hz in a plain read — so mixing the two as references put
      // different characters on different scales.) The sample is only the fallback.
      let hz: number | null = null;
      const tmp = path.join(RENDERS(), `pitchsrc-${rid()}.mp3`);
      try {
        await synthSpeech(vid, PITCH_REFERENCE_LINE, tmp);
        hz = await medianPitchOf(tmp);
      } catch { /* fall back to the sample below */ } finally {
        try { fs.rmSync(tmp, { force: true }); } catch { /* temp file */ }
      }
      if (!hz) {
        const sample = path.join(process.cwd(), "public", "voice-samples", `${vid}.mp3`);
        if (/^[\w-]+$/.test(vid) && fs.existsSync(sample)) hz = await medianPitchOf(sample);
      }
      if (hz) { try { fs.writeFileSync(cache, JSON.stringify({ hz: Math.round(hz) })); } catch { /* cache only */ } }
      return hz;
    })().catch(() => null).finally(() => voicePitchJobs.delete(vid));
    voicePitchJobs.set(vid, job);
  }
  return job;
}

// ---- 2. COVER: re-voice a song --------------------------------------------------------------------------

/** Re-voice `songUrl` (a public mp3) with the trained voice at `modelUrl`. Returns the ABSOLUTE disk path
 *  of the new mix (mp3, same duration as the input). `speech` = spoken dialogue rather than a song: the
 *  model's default studio reverb on the converted voice is right for a sung vocal and wrong for a line
 *  spoken in a room (the room's own sound stays in the untouched background track), so it's switched off. */
export async function coverSongInVoice(songUrl: string, modelUrl: string, opts: { speech?: boolean; semitones?: number; pitchChange?: "no-change" | "male-to-female" | "female-to-male" } = {}): Promise<string> {
  // `semitones` moves the whole track (voice and background alike) — right for a spoken line, whose
  // background is only room tone; a SONG keeps its key, so the singing path never passes it.
  // `pitchChange` moves the VOCAL ALONE by an octave and leaves the music where it is: for a singer of
  // the other sex than the one the song was sung by (a featured verse — mv-feature.ts). An octave keeps
  // the song in key.
  const semitones = Math.max(-12, Math.min(12, Math.round(opts.semitones || 0)));
  const pitchChange = opts.pitchChange === "male-to-female" || opts.pitchChange === "female-to-male" ? opts.pitchChange : "no-change";
  const id = await createCommunity(COVER_MODEL, {
    song_input: songUrl, rvc_model: "CUSTOM", custom_rvc_model_download_url: modelUrl,
    pitch_change: pitchChange, output_format: "mp3",
    ...(semitones ? { pitch_change_all: semitones } : {}),
    ...(opts.speech ? { reverb_wetness: 0, reverb_dryness: 1 } : {}),
  });
  const url = await repPoll(id, COVER_MAX_MS, "voice-cover");
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) throw new Error("[voice] cover returned no audio");
  const out = path.join(RENDERS(), `vcover-${Date.now()}-${rid()}.mp3`);
  await download(url, out);
  if (!fs.existsSync(out) || fs.statSync(out).size < 2_000) throw new Error("[voice] cover came back empty");
  return out;
}

/** Re-voice the SPEECH in a finished video clip with a trained voice — the picture, the timing (so the
 *  lip-sync) and the background sound all stay; only the voice's timbre changes. This is how a dialogue
 *  film's character speaks in the voice the merchant gave them: the video model acts the line in a voice
 *  of its own, and this swaps that voice for the character's. Returns the ABSOLUTE path of a NEW clip of
 *  exactly the same duration (file name `tmv-…`, which the dialogue pipeline reads as "already done").
 *  Throws on any failure so the caller keeps the original clip.
 *
 *  `voiceId` (the voice the model was trained on) makes it PITCH-AWARE: the line is moved to where
 *  that voice naturally speaks before it is converted. Without that a low voice put on a high-pitched
 *  performance comes out stretched and wrong — and the same character would sit at a different pitch
 *  in every shot, because the video model invents a new voice each time. */
export async function revoiceClip(clipPath: string, modelUrl: string, base: string, opts: { voiceId?: string } = {}): Promise<string> {
  if (!base) throw new Error("[voice] no public base url");
  const src = path.join(RENDERS(), `vsrc-${Date.now()}-${rid()}.mp3`);
  let covered = "";
  let leveled = "";
  try {
    const ex = await runFfmpeg(["-y", "-i", clipPath, "-vn", "-c:a", "libmp3lame", "-q:a", "2", src]);
    if (ex.status !== 0 || !fs.existsSync(src) || fs.statSync(src).size < 2_000) throw new Error("[voice] the clip has no audio to re-voice");
    let semitones = 0;
    if (opts.voiceId) {
      const [from, to] = await Promise.all([medianPitchOf(src), voicePitch(opts.voiceId)]);
      semitones = semitonesToMatch(from, to);
      console.log(`[voice] line at ${from ? Math.round(from) : "?"} Hz, voice speaks at ${to ? Math.round(to) : "?"} Hz -> ${semitones ? `moved ${semitones > 0 ? "+" : ""}${semitones} semitones` : "pitch left as is"}`);
    }
    covered = await coverSongInVoice(`${base}/renders/${path.basename(src)}`, modelUrl, { speech: true, semitones });
    leveled = await matchLoudness(covered, src);
    const seconds = ffprobeDuration(clipPath);
    const out = path.join(RENDERS(), `tmv-${Date.now()}-${rid()}.mp4`);
    // same picture (stream-copied), new voice, padded/cut to the clip's exact length
    const mux = await runFfmpeg(["-y", "-i", clipPath, "-i", leveled, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
      "-c:a", "aac", "-b:a", "192k", "-af", "apad", "-t", seconds.toFixed(3), "-movflags", "+faststart", out]);
    if (mux.status !== 0 || !fs.existsSync(out) || !(ffprobeDuration(out) > 0.5)) throw new Error("[voice] couldn't put the new voice back on the clip");
    return out;
  } finally {
    for (const f of [src, covered, leveled]) {
      if (f) { try { fs.rmSync(f, { force: true }); } catch { /* temp file — best-effort */ } }
    }
  }
}

async function meanVolumeDb(file: string): Promise<number | null> {
  const r = await runFfmpeg(["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"]);
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(r.stderr || "");
  return m ? parseFloat(m[1]) : null;
}

/** The cover model's remix comes back ~7 dB quieter than the song it was given (measured). Bring it back
 *  to the reference's level so a voice-matched video isn't noticeably quieter than a normal one. Fails
 *  open — returns the input path untouched. */
export async function matchLoudness(file: string, reference: string): Promise<string> {
  try {
    const [a, b] = [await meanVolumeDb(file), await meanVolumeDb(reference)];
    if (a == null || b == null) return file;
    const gain = Math.max(-6, Math.min(12, b - a));
    if (Math.abs(gain) < 1) return file;
    const out = path.join(RENDERS(), `vcoverl-${Date.now()}-${rid()}.mp3`);
    const r = await runFfmpeg(["-y", "-i", file, "-af", `volume=${gain.toFixed(1)}dB,alimiter=limit=0.95`, "-c:a", "libmp3lame", "-q:a", "2", out]);
    if (r.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 2_000) return out;
  } catch { /* keep the unmatched cover */ }
  return file;
}
