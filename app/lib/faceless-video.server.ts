// Faceless social video — the Creator section's flagship. topic → AI script →
// AI voiceover → WhisperX word timings → AI b-roll stills → Ken-Burns beats
// timed to the VO → word-synced captions → looped music bed → 9:16 MP4.
//
// ~85% reuses the existing video stack (see faceless-video design, 2026-10-08).
// The ONLY net-new provider dependency is WhisperX for word timings; everything
// else is the shipped Replicate/ffmpeg/worker plumbing. Default path = cheap
// flux stills + Ken-Burns (NO AI clips) → image-class COGS (~$0.15-0.40), priced
// at TOKEN_COST.faceless. Caps enforced by the caller (beats<=8, VO<=~45s).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db.server";
import { anthropicText } from "./anthropic.server";
import { repCreate, repPoll, downloadBuffer, runFfmpeg, ffprobeDuration, resolveTextFont, checkpointJob } from "./ugc-ad-pipeline.server";
import { fluxStill } from "./image-generation.server";
import { musicBedToDisk } from "./music-generation.server";
import { mirrorRender } from "./object-storage.server";

const RENDERS = () => path.join(process.cwd(), "data", "renders");

// WhisperX word-timestamp model — VERSIONED (versionless /models 404s), run via
// /predictions. align_output:true yields per-word start/end over clean TTS audio.
const WHISPERX_VERSION = "655845d6190ef70573c669245f245892cd039df4b880a1e3a65852c09252f5cc";

// No-avatar voice picker over the verified MiniMax speech-02 pool (see ugc VOICES).
const VOICE_MAP: Record<string, string> = {
  "f-hype": "English_ConfidentWoman",
  "f-warm": "English_FriendlyPerson",
  "m-hype": "English_magnetic_voiced_man",
  "m-warm": "English_Trustworth_Man",
};
export const FACELESS_VOICES = Object.keys(VOICE_MAP);

export const FACELESS_FORMATS: Record<string, string> = {
  motivational: "motivational / inspirational — punchy, uplifting, building to a payoff",
  facts: "fascinating facts / 'did you know' — surprising, curiosity-driven",
  storytime: "storytime — a short gripping narrative with a hook and a turn",
  listicle: "a quick list — 'N things about …', each beat one item",
};

type Beat = { line: string; visual: string };
type Script = { beats: Beat[]; musicMood: string; voiceGender?: "m" | "f" };

const SCRIPT_SCHEMA = {
  type: "object",
  properties: {
    beats: {
      type: "array",
      items: {
        type: "object",
        properties: { line: { type: "string" }, visual: { type: "string" } },
        required: ["line", "visual"],
      },
    },
    musicMood: { type: "string" },
    voiceGender: { type: "string", enum: ["m", "f"] },
  },
  required: ["beats", "musicMood"],
} as const;

/** ALL-CAPS, filter-safe caption text (mirrors ugc captionSafe). */
function captionSafe(s: string): string {
  return s.toUpperCase().replace(/[']/g, "’").replace(/[^\p{L}\p{N} .,!?$’-]/gu, "").replace(/\s+/g, " ").trim();
}

/** Start a WhisperX prediction by version; returns the prediction id. */
async function createWhisperx(audioUrl: string): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not set");
  const res = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ version: WHISPERX_VERSION, input: { audio_file: audioUrl, align_output: true, language: "en", batch_size: 16 } }),
  });
  if (!res.ok) throw new Error(`whisperx create ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return ((await res.json()) as { id: string }).id;
}

type WordT = { word: string; start: number; end: number };
/** Pull per-word timings out of a WhisperX result (segments[].words[]). */
function wordsFromWhisperx(raw: unknown): WordT[] {
  const r = raw as { segments?: Array<{ words?: Array<{ word?: string; start?: number; end?: number }> }> } | null;
  const out: WordT[] = [];
  for (const seg of r?.segments || []) {
    for (const w of seg.words || []) {
      if (typeof w.word === "string" && typeof w.start === "number" && typeof w.end === "number" && w.end > w.start) {
        out.push({ word: w.word, start: w.start, end: w.end });
      }
    }
  }
  return out;
}

type Cap = { text: string; t0: number; t1: number };
/** Group words into short caption cards (~3 words / ~18 chars), carrying real
 *  start/end times — the word-synced look. */
function groupCaptions(words: WordT[]): Cap[] {
  const caps: Cap[] = [];
  let cur: WordT[] = [];
  const flush = () => {
    if (!cur.length) return;
    const text = captionSafe(cur.map((w) => w.word).join(" "));
    if (text) caps.push({ text, t0: cur[0].start, t1: cur[cur.length - 1].end });
    cur = [];
  };
  for (const w of words) {
    cur.push(w);
    const chars = cur.reduce((n, x) => n + x.word.length + 1, 0);
    if (cur.length >= 3 || chars >= 20) flush();
  }
  flush();
  return caps;
}

/** drawtext filters from timed caption cards (word-synced). */
function timedCaptionFilters(caps: Cap[], fontFile: string): string[] {
  const font = fontFile.replace(/\\/g, "/").replace(/:/g, "\\:");
  return caps.map((c) => {
    const size = Math.max(32, Math.min(52, Math.floor((720 * 0.92) / (c.text.length * 0.62))));
    return (
      `drawtext=fontfile='${font}':text='${c.text}':fontsize=${size}:fontcolor=white:` +
      `borderw=8:bordercolor=black:x=(w-text_w)/2:y=h-360:enable='gte(t,${c.t0.toFixed(2)})*lt(t,${c.t1.toFixed(2)})'`
    );
  });
}

/** The faceless compositor: N stills as Ken-Burns beats across the VO, captions
 *  burned in, VO over a looped music bed, 720x1280. Reuses runFfmpeg's budget. */
async function assembleFaceless(opts: {
  stills: string[]; voPath: string; musicPath: string | null; caps: Cap[]; fontFile: string; outPath: string; jobId?: string;
}): Promise<void> {
  const beat = async () => { if (opts.jobId) await checkpointJob(opts.jobId, { ckBeat: Date.now() }); };
  const voDur = ffprobeDuration(opts.voPath);
  if (!(voDur > 1)) throw new Error("[faceless] voiceover duration unreadable");

  // Normalize each still to a clean jpg frame (flux ships webp-in-.jpg; this
  // makes zoompan input boring + reliable).
  const norm: string[] = [];
  for (const s of opts.stills) {
    const n = `${s}.n.jpg`;
    const c = await runFfmpeg(["-y", "-i", s, "-frames:v", "1", n]);
    norm.push(c.status === 0 && fs.existsSync(n) ? n : s);
  }
  await beat();

  const N = norm.length;
  const seg = voDur / N;
  const args: string[] = ["-y"];
  norm.forEach((s) => args.push("-i", s)); // inputs 0..N-1
  args.push("-i", opts.voPath); // input N
  const hasMusic = !!opts.musicPath && fs.existsSync(opts.musicPath);
  if (hasMusic) args.push("-stream_loop", "-1", "-i", opts.musicPath!); // input N+1 (looped)

  const filters: string[] = [];
  const labels: string[] = [];
  norm.forEach((_, i) => {
    const frames = Math.max(18, Math.round(seg * 30));
    const z = i % 2 === 0 ? `1+0.12*on/${frames - 1}` : `max(1.12-0.12*on/${frames - 1},1.001)`;
    filters.push(
      `[${i}:v]scale=1440:2560:force_original_aspect_ratio=increase,crop=1440:2560,` +
      `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=720x1280:fps=30,setsar=1[c${i}]`
    );
    labels.push(`[c${i}]`);
  });
  filters.push(`${labels.join("")}concat=n=${N}:v=1:a=0[vcat]`);

  let vLabel = "[vcat]";
  const captions = timedCaptionFilters(opts.caps, opts.fontFile);
  if (captions.length) { filters.push(`[vcat]${captions.join(",")}[vf]`); vLabel = "[vf]"; }

  let aMap = `${N}:a`;
  if (hasMusic) {
    filters.push(`[${N + 1}:a]volume=0.20,afade=t=out:st=${Math.max(0, voDur - 1.5).toFixed(2)}:d=1.5[bg]`);
    filters.push(`[${N}:a][bg]amix=inputs=2:duration=first:dropout_transition=0[aout]`);
    aMap = "[aout]";
  }

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", vLabel, "-map", aMap,
    "-t", voDur.toFixed(2),
    "-threads", "2", "-filter_complex_threads", "2",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
    opts.outPath,
  );
  await beat();
  const run = await runFfmpeg(args);
  if (run.status !== 0 || !fs.existsSync(opts.outPath)) {
    // CAPTIONS/MUSIC ARE NICE-TO-HAVE; the video is the product. Retry once with
    // no captions (the commonest drawtext/font failure) before giving up.
    if (captions.length) {
      const bare = args.slice();
      const fcIdx = bare.indexOf("-filter_complex") + 1;
      bare[fcIdx] = bare[fcIdx].replace(`[vcat]${captions.join(",")}[vf]`, "");
      const vIdx = bare.lastIndexOf(vLabel); if (vIdx > -1) bare[vIdx] = "[vcat]";
      const run2 = await runFfmpeg(bare);
      if (run2.status === 0 && fs.existsSync(opts.outPath)) return;
    }
    throw new Error(`[faceless] ffmpeg failed: ${(run.stderr || "").slice(-240)}`);
  }
}

export async function generateFacelessVideo(opts: {
  shopId: string;
  topic: string;
  format?: string;
  voiceKey?: string;
  jobId?: string;
  resume?: { ckScript?: string; ckAudioUrl?: string; ckVoPath?: string; ckTimings?: string; ckImages?: string[]; ckMusic?: string };
}): Promise<string> {
  const topic = (opts.topic || "").trim();
  if (!topic) throw new Error("Give the video a topic.");
  const jobId = opts.jobId;
  const resume = opts.resume || {};
  const ckpt = async (patch: Record<string, unknown>) => { if (jobId) await checkpointJob(jobId, patch); };
  const fmtKey = opts.format && FACELESS_FORMATS[opts.format] ? opts.format : "facts";

  // 1) SCRIPT — structured beats (line + visual) in one forced-tool call.
  let script: Script;
  if (resume.ckScript) {
    script = JSON.parse(resume.ckScript);
  } else {
    const prompt =
      `Write a short FACELESS social video for TikTok/Reels about: "${topic}".\n` +
      `Style: ${FACELESS_FORMATS[fmtKey]}.\n` +
      `Return 6-7 beats. Each beat = a spoken LINE (one short conversational sentence, ~8-16 words; the FIRST line is a scroll-stopping hook) + a VISUAL (a vivid, specific, cinematic image description for AI b-roll that matches the line — NO text/words/logos in the image, no real named people).\n` +
      `Total spoken length ~30-40 seconds. Also give musicMood (a short phrase describing background music) and voiceGender.\n` +
      `SAFETY: keep it general and true — do NOT invent specific statistics, prices, dates, medical or financial advice, or claims you are unsure of; no defamation of real people or brands.`;
    const raw = await anthropicText(prompt, { model: "claude-sonnet-5", maxTokens: 1200, jsonSchema: { name: "faceless_script", schema: SCRIPT_SCHEMA as unknown as Record<string, unknown> } });
    script = JSON.parse(raw) as Script;
    script.beats = (script.beats || []).filter((b) => b && b.line && b.visual).slice(0, 8);
    if (script.beats.length < 2) throw new Error("[faceless] script too short");
    await ckpt({ ckScript: JSON.stringify(script) });
  }
  const fullScript = script.beats.map((b) => b.line).join(" ");
  const voiceId = VOICE_MAP[opts.voiceKey || ""] || VOICE_MAP[`${script.voiceGender || "f"}-warm`] || VOICE_MAP["f-warm"];

  // 2) VOICEOVER — one MiniMax read (turbo fallback). Persist to a public
  //    /renders mp3 so WhisperX can fetch it and it survives a restart.
  let voUrl = resume.ckAudioUrl || "";
  let voPath = resume.ckVoPath && fs.existsSync(resume.ckVoPath) ? resume.ckVoPath : "";
  if (!voPath) {
    if (!voUrl) {
      try {
        const id = await repCreate("minimax/speech-02-hd", { text: fullScript, voice_id: voiceId, english_normalization: true, language_boost: "English" });
        voUrl = await repPoll(id, 3 * 60_000, "faceless-tts");
      } catch {
        const id = await repCreate("minimax/speech-02-turbo", { text: fullScript, voice_id: voiceId });
        voUrl = await repPoll(id, 3 * 60_000, "faceless-tts");
      }
    }
    const buf = await downloadBuffer(voUrl);
    if (buf.length < 8_000) throw new Error("[faceless] voiceover came back empty");
    fs.mkdirSync(RENDERS(), { recursive: true });
    const voName = `vo-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp3`;
    voPath = path.join(RENDERS(), voName);
    fs.writeFileSync(voPath, buf);
    try { await mirrorRender(voName, buf); } catch { /* non-fatal */ }
    await ckpt({ ckAudioUrl: voUrl, ckVoPath: voPath });
  }

  // 3) WORD TIMINGS — WhisperX over the VO (its Replicate CDN url is still fresh
  //    here). Cached in ckTimings so it never re-bills on resume.
  let caps: Cap[];
  if (resume.ckTimings) {
    caps = JSON.parse(resume.ckTimings);
  } else {
    try {
      const id = await createWhisperx(voUrl);
      const raw = (await repPoll(id, 5 * 60_000, "faceless-align")) as unknown;
      caps = groupCaptions(wordsFromWhisperx(raw));
    } catch (e) {
      console.error("[faceless] whisperx failed, falling back to even-division captions:", (e as Error).message);
      caps = [];
    }
    // Fallback: even-division across the VO from the script chunks (rung c).
    if (!caps.length) {
      const voDur = ffprobeDuration(voPath) || 35;
      const chunks = captionSafe(fullScript).split(" ").reduce<string[]>((acc, w) => {
        const last = acc[acc.length - 1];
        if (!last || (last.length + w.length + 1) > 20 || last.split(" ").length >= 3) acc.push(w); else acc[acc.length - 1] = `${last} ${w}`;
        return acc;
      }, []);
      const per = voDur / Math.max(1, chunks.length);
      caps = chunks.map((text, i) => ({ text, t0: i * per, t1: (i + 1) * per }));
    }
    await ckpt({ ckTimings: JSON.stringify(caps) });
  }

  // 4) B-ROLL STILLS — one 9:16 flux still per beat (sequential = no 429). Banked
  //    contiguously so a restart keeps what already rendered.
  const stills: string[] = (resume.ckImages || []).filter((p) => p && fs.existsSync(p));
  for (let i = stills.length; i < script.beats.length; i++) {
    // 720x1280 = exact 9:16 AND within flux-schnell's height<=1280 cap (1344 → 422);
    // also the final video's own frame size. The assembler oversamples for Ken-Burns.
    const p = await fluxStill(`${script.beats[i].visual}. Vertical 9:16, cinematic, high detail, no text, no watermark.`, 720, 1280);
    stills.push(p);
    await ckpt({ ckImages: stills });
  }
  if (!stills.length) throw new Error("[faceless] no b-roll generated");

  // 5) MUSIC BED (best-effort — video ships without it rather than fail).
  let musicPath: string | null = resume.ckMusic && fs.existsSync(resume.ckMusic) ? resume.ckMusic : null;
  if (!musicPath) {
    try { musicPath = await musicBedToDisk(`${script.musicMood || "uplifting background music"}, instrumental, loopable`); await ckpt({ ckMusic: musicPath }); }
    catch (e) { console.error("[faceless] music bed failed (continuing silent):", (e as Error).message); musicPath = null; }
  }

  // 6) ASSEMBLE → 9:16 MP4.
  let fontFile = path.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");
  try { fontFile = await resolveTextFont(fullScript); } catch { /* keep Poppins */ }
  const outName = `vid-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp4`;
  const outPath = path.join(RENDERS(), outName);
  await assembleFaceless({ stills, voPath, musicPath, caps, fontFile, outPath, jobId });
  const outBuf = fs.readFileSync(outPath);
  try { await mirrorRender(outName, outBuf); } catch { /* non-fatal */ }
  const storedUrl = `/renders/${outName}`;

  // 7) PERSIST — a VIDEO_AD asset tagged for the Creator gallery.
  const asset = await db.asset.create({
    data: {
      shopId: opts.shopId,
      type: "VIDEO_AD",
      status: "PENDING",
      title: `Faceless video — ${topic.slice(0, 60)}`,
      bodyJson: JSON.stringify({ style: "FACELESS", videoUrl: storedUrl, prompt: topic, script: fullScript }),
      metaJson: JSON.stringify({ kind: "faceless", section: "creator", format: fmtKey, topic, aspect: "vertical" }),
    },
  });
  return asset.id;
}
