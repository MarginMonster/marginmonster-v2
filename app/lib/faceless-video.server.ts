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
import { brollStill } from "./image-generation.server";
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
  const hasMusic = !!opts.musicPath && fs.existsSync(opts.musicPath);
  const captions = timedCaptionFilters(opts.caps, opts.fontFile);

  // Build the whole ffmpeg arg list for a given quality rung. Captions, the
  // music bed and the Ken-Burns motion are all nice-to-have; the VO over the
  // stills is the product. Each toggle lets a failed encode DEGRADE to a
  // simpler-but-valid graph — rebuilt from parts, so there is never the
  // dangling ";;" that a string-replace on the joined filtergraph used to leave
  // behind (which made the old no-caption "fallback" itself unparseable, so ANY
  // encode hiccup hard-failed all three attempts → "didn't make it" + refund).
  const buildArgs = (useCaptions: boolean, useKenBurns: boolean, useMusic: boolean): string[] => {
    const a: string[] = ["-y"];
    norm.forEach((s) => {
      // Ken-Burns gets its duration from zoompan d=; the plain rung instead
      // holds each still for `seg` seconds with -loop 1 -t.
      if (useKenBurns) a.push("-i", s);
      else a.push("-loop", "1", "-t", seg.toFixed(3), "-i", s);
    });
    a.push("-i", opts.voPath); // input N
    const musicOn = useMusic && hasMusic;
    if (musicOn) a.push("-stream_loop", "-1", "-i", opts.musicPath!); // input N+1 (looped)

    const f: string[] = [];
    const labels: string[] = [];
    norm.forEach((_, i) => {
      if (useKenBurns) {
        const frames = Math.max(18, Math.round(seg * 30));
        const z = i % 2 === 0 ? `1+0.12*on/${frames - 1}` : `max(1.12-0.12*on/${frames - 1},1.001)`;
        f.push(
          `[${i}:v]scale=1440:2560:force_original_aspect_ratio=increase,crop=1440:2560,` +
          `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=720x1280:fps=30,setsar=1[c${i}]`
        );
      } else {
        f.push(`[${i}:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30[c${i}]`);
      }
      labels.push(`[c${i}]`);
    });
    f.push(`${labels.join("")}concat=n=${N}:v=1:a=0[vcat]`);

    let vLabel = "[vcat]";
    if (useCaptions && captions.length) { f.push(`[vcat]${captions.join(",")}[vf]`); vLabel = "[vf]"; }

    let aMap = `${N}:a`;
    if (musicOn) {
      f.push(`[${N + 1}:a]volume=0.20,afade=t=out:st=${Math.max(0, voDur - 1.5).toFixed(2)}:d=1.5[bg]`);
      f.push(`[${N}:a][bg]amix=inputs=2:duration=first:dropout_transition=0[aout]`);
      aMap = "[aout]";
    }

    a.push(
      "-filter_complex", f.join(";"),
      "-map", vLabel, "-map", aMap,
      "-t", voDur.toFixed(2),
      "-threads", "2", "-filter_complex_threads", "2",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
      opts.outPath,
    );
    return a;
  };

  // OUTPUT QA: a 0-status encode that wrote a zero-duration/garbage file must
  // NOT ship as a paid video — accept a rung only if it produced a playable MP4.
  const produced = (): boolean => { try { return fs.existsSync(opts.outPath) && ffprobeDuration(opts.outPath) > 1; } catch { return false; } };

  // Degrade ladder: full → drop captions → plain slideshow (no Ken-Burns, no
  // music). Each rung is a complete, independently-valid graph, so a zoompan or
  // drawtext failure falls back to a static slideshow instead of killing the job.
  const rungs: Array<[cap: boolean, kb: boolean, mus: boolean]> = [[true, true, true]];
  if (captions.length) rungs.push([false, true, true]);
  rungs.push([false, false, false]);

  await beat();
  let lastErr = "";
  for (const [cap, kb, mus] of rungs) {
    const run = await runFfmpeg(buildArgs(cap, kb, mus));
    if (run.status === 0 && produced()) return;
    lastErr = (run.stderr || "").slice(-240);
    await beat(); // heartbeat between rungs so a multi-encode assembly can't near the 25-min reaper
  }
  throw new Error(`[faceless] ffmpeg failed after ${rungs.length} rungs: ${lastErr}`);
}

/** Product Channel angles — how a faceless PRODUCT drop is pitched. Grounded in
 *  the product's real description; never invents specs/prices/claims. */
export const PRODUCT_ANGLES: Record<string, string> = {
  spotlight: "a clean product spotlight — show it off, lead with the single best real benefit",
  hype: "high-energy hype — fast, exciting, 'you need this', without overclaiming",
  story: "a relatable mini-story — a real problem this product solves, then the reveal",
  value: "value-led — why it's worth it and who it's for (never invent a price or discount)",
};
export const PRODUCT_ANGLE_KEYS = Object.keys(PRODUCT_ANGLES);

export async function generateFacelessVideo(opts: {
  shopId: string;
  topic: string;
  format?: string;
  voiceKey?: string;
  jobId?: string;
  // Which Archive section this lands in: "creator" (vibe channels / manual) or
  // "marketing" (Product Channels). tagAssetSection only ever tags "creator", so
  // the asset must carry the right section itself.
  section?: string;
  // Product Channel drop: a faceless video SELLING a real catalogue product,
  // grounded in its description, with its real image as the opening b-roll.
  product?: { title: string; imageUrl?: string; description?: string };
  // B-roll quality: "pro" = nano-banana (default), "ultra" = nano-banana-pro @2K.
  quality?: "pro" | "ultra";
  resume?: { ckScript?: string; ckAudioUrl?: string; ckVoPath?: string; ckTimings?: string; ckImages?: string[]; ckMusic?: string };
}): Promise<string> {
  const topic = (opts.topic || "").trim();
  if (!topic) throw new Error("Give the video a topic.");
  const quality: "pro" | "ultra" = opts.quality === "ultra" ? "ultra" : "pro";
  const jobId = opts.jobId;
  const resume = opts.resume || {};
  const product = opts.product;
  const ckpt = async (patch: Record<string, unknown>) => { if (jobId) await checkpointJob(jobId, patch); };
  const fmtKey = opts.format && FACELESS_FORMATS[opts.format] ? opts.format : "facts";

  // 1) SCRIPT — structured beats (line + visual) in one forced-tool call.
  let script: Script;
  if (resume.ckScript) {
    script = JSON.parse(resume.ckScript);
  } else {
    const prompt = product
      ? // PRODUCT CHANNEL — a faceless video selling a real catalogue product,
        // grounded ONLY in its description (FTC-safe: no invented specs/prices).
        `Write a short FACELESS product video for TikTok/Reels selling this product.\n` +
        `PRODUCT: "${product.title}".\n` +
        (product.description ? `DETAILS (use ONLY what's here — do not invent anything beyond it): ${product.description.slice(0, 600)}.\n` : "") +
        `Angle: ${PRODUCT_ANGLES[opts.format || ""] || PRODUCT_ANGLES.spotlight}.\n` +
        `Return 5-6 beats. Each beat = a spoken LINE (one short conversational sentence, ~8-16 words; the FIRST line is a scroll-stopping hook about the product; the LAST line is a soft call to action like "link's right here" or "grab yours") + a VISUAL (a vivid cinematic lifestyle scene that features or complements the product — NO text/words/logos in the image, no real named people).\n` +
        `Total spoken length ~25-35 seconds. Also give musicMood (a short phrase) and voiceGender.\n` +
        `SAFETY: say ONLY what is true from the DETAILS above — NEVER invent statistics, prices, discounts, sales, guarantees, reviews, ratings, awards or endorsements. No "best", "#1" or superlatives you cannot back up.`
      : `Write a short FACELESS social video for TikTok/Reels about: "${topic}".\n` +
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
  // Product Channel: open on the REAL product photo (the "here it is" hook), then
  // AI lifestyle b-roll. Downloaded once; on any failure we fall through to all-AI
  // b-roll so a drop never dies on a bad image URL. It takes beat 0's still slot,
  // so the total stays beats.length.
  if (!stills.length && product?.imageUrl) {
    try {
      const buf = await downloadBuffer(product.imageUrl);
      if (buf.length > 3000) {
        fs.mkdirSync(RENDERS(), { recursive: true });
        const pn = path.join(RENDERS(), `prod-${Date.now()}-${crypto.randomBytes(5).toString("hex")}.jpg`);
        fs.writeFileSync(pn, buf);
        stills.push(pn);
        await ckpt({ ckImages: stills });
      }
    } catch { /* fall through to AI b-roll */ }
  }
  // Last-resort neutral frame (brand ink) so one unrenderable beat can never
  // sink a whole paid render when there's nothing earlier to reuse.
  const neutralFrame = async (): Promise<string | null> => {
    try {
      fs.mkdirSync(RENDERS(), { recursive: true });
      const pn = path.join(RENDERS(), `bg-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.jpg`);
      const c = await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=0x14201A:s=720x1280", "-frames:v", "1", pn]);
      return c.status === 0 && fs.existsSync(pn) ? pn : null;
    } catch { return null; }
  };
  for (let i = stills.length; i < script.beats.length; i++) {
    // The assembler oversamples each still for the Ken-Burns crop, so a bigger,
    // sharper source (nano-banana / nano-banana-pro) reads as real b-roll, not
    // the flux-schnell slop it replaced.
    const beat = script.beats[i % script.beats.length];
    const prompt = `${beat.visual}. Vertical 9:16, cinematic, high detail, no text, no watermark.`;
    // Up to 3 tries per beat: a 429/transient refusal under load used to kill
    // the whole render (no retry, no catch). No schnell fallback — it's retired.
    let still: string | null = null;
    for (let attempt = 0; attempt < 3 && !still; attempt++) {
      try { still = await brollStill(prompt, quality); }
      catch { if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); }
    }
    // Never skip a beat (the resume/checkpoint logic maps stills[i] → beat i):
    // fall back to repeating the previous still, or a neutral frame for beat 0.
    if (!still) still = stills.length ? stills[stills.length - 1] : await neutralFrame();
    if (!still) throw new Error("[faceless] b-roll generation failed for the opening beat");
    stills.push(still);
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
      metaJson: JSON.stringify({ kind: "faceless", section: opts.section || "creator", format: fmtKey, topic, aspect: "vertical", ...(product ? { product: product.title } : {}) }),
    },
  });
  return asset.id;
}
