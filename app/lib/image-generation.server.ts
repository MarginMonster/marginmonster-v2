import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { db } from "../db.server";
import type { BrandProfile, Plan } from "@prisma/client";
import { mirrorRender } from "./object-storage.server";
import { anthropicText, anthropicVision } from "./anthropic.server";
import { artLog } from "./art-log.server";
import { merchantBusy } from "./art-throttle.server";
import { hasCJK, langDirective } from "./content-lang";

/* ── On-image ad copy ──────────────────────────────────────────────────────
 * A high-quality still isn't a finished ad — real creatives carry a headline
 * and a call to action. Diffusion models garble text, so we generate the words
 * with Claude and composite them onto the image with ffmpeg (same font/engine
 * the video captions use). Everything here is best-effort: any failure falls
 * back to the clean image, never blocking generation. */

/** Poster-grade ad copy: a STATEMENT headline (the kind award ads open with),
 *  an optional small support line, and a short CTA. */
async function adCopy(productTitle: string, tone: string | undefined, direction: string | undefined, serviceMode: boolean, contentLang?: string | null): Promise<{ headline: string; sub: string; cta: string } | null> {
  try {
    const prompt = [
      `Write poster-style ad copy to overlay on a ${serviceMode ? "service/offer" : "product"} image ad — think award-winning print ads: a bold STATEMENT headline that stops the scroll, not a generic tagline.${langDirective(contentLang)}`,
      `${serviceMode ? "Offer" : "Product"}: "${productTitle}".`,
      tone ? `Brand tone: ${tone}.` : "",
      direction ? `Angle: ${direction.slice(0, 160)}.` : "",
      `Return ONLY JSON: {"headline":"...","sub":"...","cta":"..."}.`,
      `headline: 3 to 7 words, a confident, witty or provocative STATEMENT (a period at the end is allowed and often stronger).`,
      `sub: MAX 8 words, one small supporting line that lands the benefit — or "" if the headline says it all.`,
      `cta: MAX 3 words (e.g. "Shop now", "Get yours", "Start free").`,
      `NEVER invent a discount, percentage, sale, coupon or saving — we do not know whether this merchant is running one, and a made-up offer is a promise their shop never agreed to honour.`,
      `No quotes, emoji, or hashtags inside the values.`,
    ].filter(Boolean).join("\n");
    const raw = await anthropicText(prompt, { model: "claude-sonnet-5", maxTokens: 160 });
    const m = raw && raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]) as { headline?: string; sub?: string; cta?: string };
    const clean = (s: string | undefined, n: number) => (s || "").replace(/["'“”]/g, "").trim().split(/\s+/).slice(0, n).join(" ");
    const headline = clean(j.headline, 8);
    const sub = clean(j.sub, 9);
    const cta = clean(j.cta, 3);
    if (!headline) return null;
    return { headline, sub, cta };
  } catch { return null; }
}

// drawtext is picky: escape the characters that break its filter parser.
// Unicode-aware so accents and CJK survive (the old \w filter erased them).
const dt = (s: string) => s.replace(/\\/g, "").replace(/[':%]/g, "").replace(/[^\p{L}\p{N} \-!?.&]/gu, "").trim();

/**
 * Composite the ad copy onto a square still with ffmpeg — ADAPTIVE poster
 * typography, the way real print ads set type: dark ink on light images,
 * white on dark, a legibility fade only when the region is genuinely mid-
 * contrast, and the CTA set as a solid button chip. Brand-neutral always —
 * no EasyMode colors on merchant creative. Returns the new file name, or
 * null on any failure (caller keeps the clean image). ~1024px square input.
 */
function ffmpegBin(): string | null {
  // System ffmpeg first — the ffmpeg-static Linux build ships WITHOUT drawtext,
  // which is exactly what we need here (same reason the video pipeline does this).
  for (const p of ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", path.join(process.cwd(), "bin", "ffmpeg")]) {
    if (fs.existsSync(p)) return p;
  }
  return (ffmpegPath as unknown as string) || null;
}

/** Run a short ffmpeg still job with a HARD kill timeout. A wedged ffmpeg (bad
 *  input, stalled filter) never fires 'close', so the promise stayed pending
 *  FOREVER — and the worker is serial, so one wedged still stalled every other
 *  merchant's job behind it. SIGKILL, then resolve as a failure. */
const FFMPEG_STILL_TIMEOUT_MS = 90_000;
function runFfmpegStill(
  bin: string,
  args: string[],
  // captureStderr: ffmpeg says exactly what is wrong with a filter graph on
  // stderr and we were throwing it away, so a broken graph could only ever be
  // reported as "it failed". Off by default — it is only worth the pipe when
  // the caller intends to surface the message.
  opts: { captureStdout?: boolean; captureStderr?: boolean; timeoutMs?: number } = {}
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let out = "";
    let err = "";
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ ok, stdout: out, stderr: err });
    };
    try {
      const p = spawn(bin, args, {
        stdio: ["ignore", opts.captureStdout ? "pipe" : "ignore", opts.captureStderr ? "pipe" : "ignore"],
      });
      timer = setTimeout(() => {
        console.error(`[image-ad] ffmpeg wedged past ${Math.round((opts.timeoutMs ?? FFMPEG_STILL_TIMEOUT_MS) / 1000)}s — killing it`);
        try { p.kill("SIGKILL"); } catch { /* already gone */ }
        finish(false);
      }, opts.timeoutMs ?? FFMPEG_STILL_TIMEOUT_MS);
      p.stdout?.on("data", (c: Buffer) => { out += c.toString(); });
      p.stderr?.on("data", (c: Buffer) => { err = (err + c.toString()).slice(-2000); });
      p.on("error", (e) => { err = err || e.message; finish(false); });
      p.on("close", (code) => finish(code === 0));
    } catch (e) { err = err || (e as Error).message; finish(false); }
  });
}

/** Average luma (0-255) of a horizontal band of the image, so text color can
 *  adapt to what it sits on. band: fraction offsets of height (0=top). */
async function bandLuma(bin: string, src: string, yFrac: number, hFrac: number): Promise<number | null> {
  const vf = `crop=iw:ih*${hFrac}:0:ih*${yFrac},scale=64:64,signalstats,metadata=print:file=-`;
  const { stdout } = await runFfmpegStill(bin, ["-i", src, "-vf", vf, "-frames:v", "1", "-f", "null", "-"], {
    captureStdout: true,
    timeoutMs: 30_000, // a 64x64 probe; anything slower is wedged
  });
  const m = stdout.match(/signalstats\.YAVG=([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

/** Read a JPEG or PNG's dimensions out of its own header.
 *
 *  Both probes below shell out to ffprobe, derived from the ffmpeg path — but
 *  ffmpeg-static ships ffmpeg ALONE, and the GitHub runner image no longer
 *  carries a system ffmpeg. So on CI the derived ffprobe path pointed at a
 *  file that does not exist, every probe returned null, and the presenter
 *  composite bailed out before it ever pasted anything. The bytes are already
 *  on disk and both formats state their size in the first few hundred bytes;
 *  no subprocess required. */
function headerSize(file: string): { w: number; h: number } | null {
  try {
    // Whole file: fal's frames carry ~130 KB of ICC and XMP ahead of the SOF
    // marker, so a fixed head buffer misses it and reports nothing. Stills are
    // a couple of megabytes at worst.
    const buf = fs.readFileSync(file);
    const read = buf.length;
    if (read < 24) return null;
    // PNG: IHDR is always the first chunk, width/height at bytes 16..24.
    if (buf.readUInt32BE(0) === 0x89504e47) {
      const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
      return w > 0 && h > 0 ? { w, h } : null;
    }
    // JPEG: walk the segment chain to the first SOF marker, which carries them.
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < read) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        const len = buf.readUInt16BE(i + 2);
        // SOF0-SOF15, excluding the DHT/JPG/DAC markers interleaved in that range.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** width:height of a product photo, so a blank stand-in can be asked for with
 *  roughly the right footprint. Undefined when the bytes can't be read — the
 *  prompt just omits the shape hint rather than guessing one. */
async function productAspect(url: string): Promise<number | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return undefined;
    const dir = path.join(process.cwd(), "data", "renders");
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    const size = headerSize(tmp);
    fs.rmSync(tmp, { force: true });
    return size ? size.w / size.h : undefined;
  } catch {
    return undefined;
  }
}

/** Pixel width of a still. The text overlay sizes against it, and guessing
 *  wrong slices the headline off the edge. Null when ffprobe can't read it —
 *  callers fall back to the old 1024 assumption. */
async function probeHeight(bin: string, file: string): Promise<number | null> {
  const hdr = headerSize(file);
  if (hdr) return hdr.h;
  try {
    const { execFileSync } = await import("node:child_process");
    const probe = bin.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace(/ffmpeg/i, "ffprobe"));
    const out = execFileSync(probe, [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=height", "-of", "csv=p=0", file,
    ], { encoding: "utf8", timeout: 8000 }).trim();
    const h = parseInt(out, 10);
    return Number.isFinite(h) && h > 0 ? h : null;
  } catch {
    return null;
  }
}

async function probeWidth(bin: string, file: string): Promise<number | null> {
  const hdr = headerSize(file);
  if (hdr) return hdr.w;
  try {
    const { execFileSync } = await import("node:child_process");
    const probe = bin.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace(/ffmpeg/i, "ffprobe"));
    const out = execFileSync(probe, [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width", "-of", "csv=p=0", file,
    ], { encoding: "utf8", timeout: 8000 }).trim();
    const w = parseInt(out, 10);
    return Number.isFinite(w) && w > 0 ? w : null;
  } catch {
    return null;
  }
}

async function overlayAdText(dir: string, srcName: string, headline: string, cta: string, sub = ""): Promise<string | null> {
  const bin = ffmpegBin();
  if (!bin) return null;
  const src = path.join(dir, srcName);
  if (!fs.existsSync(src)) return null;
  const outName = srcName.replace(/\.jpg$/, "") + "-ad.jpg";
  const out = path.join(dir, outName);
  // CJK copy needs the Noto font (fetched once to persistent disk); if it
  // can't be had, skip the overlay rather than burn tofu boxes.
  let fontFile = path.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");
  try {
    const { resolveTextFont } = await import("./ugc-ad-pipeline.server");
    fontFile = await resolveTextFont(`${headline} ${sub} ${cta}`);
  } catch { return null; }
  if (!fs.existsSync(fontFile)) return null;
  const font = fontFile.replace(/\\/g, "/").replace(/:/g, "\\:");
  const hl = dt(headline).toUpperCase();
  const sb = dt(sub).toUpperCase();
  const ct = dt(cta).toUpperCase();
  if (!hl) return null;

  // What's under the type? Sample the headline band and the CTA band.
  const topLuma = (await bandLuma(bin, src, 0, 0.3)) ?? 100; // mid default = safe white+fade
  const botLuma = (await bandLuma(bin, src, 0.86, 0.14)) ?? 100;

  // Ink rules (the print-ad way): bright region → near-black ink, clean, no
  // fade. Dark region → white ink, no fade. Mid region → white ink over a
  // gentle localized fade so it never floats illegibly.
  const inkFor = (luma: number) => (luma > 150 ? "dark" : luma < 90 ? "light" : "mid");
  const topInk = inkFor(topLuma);
  const botInk = inkFor(botLuma);
  const hlColor = topInk === "dark" ? "0x1A1A1A" : "white";
  const hlShadow = topInk === "dark"
    ? `shadowcolor=white@0.25:shadowx=0:shadowy=2`
    : `shadowcolor=black@0.35:shadowx=0:shadowy=3`;
  const subColor = topInk === "dark" ? "0x3D3D3D@0.9" : "white@0.9";
  // CTA is a solid button chip (drawtext's own box) — always readable.
  const ctaBox = botInk === "dark" ? "black@0.88" : "white@0.94";
  const ctaColor = botInk === "dark" ? "white" : "0x141414";

  // POSTER layout: BIG statement headline across the top (auto-balanced onto
  // two lines so it stays huge), small support line, button CTA at the bottom.
  const words = hl.split(" ");
  let line1 = hl, line2 = "";
  if (hl.length > 16 && words.length > 2) {
    let best = 1, bestDiff = Infinity;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(" ").length, b = words.slice(i).join(" ").length;
      const diff = Math.abs(a - b) + Math.max(0, Math.max(a, b) - 18) * 4;
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    line1 = words.slice(0, best).join(" ");
    line2 = words.slice(best).join(" ");
  }
  // The size ladder below was tuned for Latin caps (~0.62×fontsize per glyph).
  // CJK glyphs run ~1.05× — the SAME character count is ~1.7× wider, so
  // Chinese headlines bled off the canvas. Measure in Latin-equivalent width
  // (buildCaptionFilters does the same), then hard-clamp to the 1024px frame
  // so no headline can overflow whatever the script.
  const glyph = hasCJK(hl) ? 1.05 : 0.62;
  const longestChars = Math.max(line1.length, line2.length, 1);
  const longest = longestChars * (glyph / 0.62);
  const ladder = longest > 18 ? 58 : longest > 12 ? 72 : 84;
  // The clamp used to assume a 1024px canvas. Renders aren't always 1024 —
  // a portrait frame is narrower, and there the clamp did nothing, so a long
  // headline overflowed and drawtext's x=(w-text_w)/2 went NEGATIVE, slicing
  // the first characters off the left edge ("CASE X12" arriving as "ASE X12").
  // Measure the actual frame and clamp to that.
  const canvasW = (await probeWidth(bin, src)) || 1024;
  const hlSize = Math.min(ladder, Math.floor((canvasW * 0.92) / (longestChars * glyph)));
  const topY = 84;
  const line2Y = topY + Math.round(hlSize * 1.14);
  const subY = (line2 ? line2Y : topY) + Math.round(hlSize * 1.2);

  const filters = [
    // legibility fade ONLY when the band is genuinely mid-contrast
    topInk === "mid" ? `drawbox=x=0:y=0:w=iw:h=280:color=black@0.18:t=fill,drawbox=x=0:y=0:w=iw:h=170:color=black@0.2:t=fill` : "",
    `drawtext=fontfile='${font}':text='${line1}':fontsize=${hlSize}:fontcolor=${hlColor}:${hlShadow}:x=(w-text_w)/2:y=${topY}`,
    line2 ? `drawtext=fontfile='${font}':text='${line2}':fontsize=${hlSize}:fontcolor=${hlColor}:${hlShadow}:x=(w-text_w)/2:y=${line2Y}` : "",
    sb ? `drawtext=fontfile='${font}':text='${sb}':fontsize=27:fontcolor=${subColor}:x=(w-text_w)/2:y=${subY}` : "",
    ct ? `drawtext=fontfile='${font}':text='${ct}':fontsize=27:fontcolor=${ctaColor}:box=1:boxcolor=${ctaBox}:boxborderw=16:x=(w-text_w)/2:y=h-82` : "",
  ].filter(Boolean).join(",");
  const args = ["-y", "-i", src, "-vf", filters, "-frames:v", "1", "-q:v", "3", out];
  const { ok } = await runFfmpegStill(bin, args);
  if (ok && fs.existsSync(out) && fs.statSync(out).size > 5000) return outName;
  return null;
}

/* ── Accuracy ladder for product stills ────────────────────────────────────
 * "Close enough" isn't sellable. Two modes:
 *   PHOTO-TRUE (default / backdrop styles): the REAL product photo is cut out
 *     and composited onto a generated empty backdrop — the product is pixel-
 *     identical by construction. Zero hallucination possible.
 *   SCENE (integrated styles / custom directions): identity-strongest editor
 *     (nano-banana, kontext fallback) + a Claude-vision QA gate that rejects
 *     warped products, wrong scale, deformed hands, or off-brief lighting —
 *     one automatic retry before shipping. */

function repHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`, "Content-Type": "application/json" };
}

/** Create + poll a Replicate official-model prediction; returns the first output URL. */
async function repRun(model: string, input: Record<string, unknown>, maxMs = 120_000): Promise<string> {
  // 429 = Replicate per-model rate limit, and it is TRANSIENT. Throwing on it
  // terminal-failed merchant image ads whenever background art forging (or a
  // burst of merchant work) saturated the model — the single biggest cause of
  // "my image failed over and over". Mirror the video pipeline: honour
  // retry_after / Retry-After with backoff before giving up.
  // …but the worker is SERIAL: sleeping here holds up EVERY other merchant's
  // job. Cap the cumulative wait — past the budget we throw, the job requeues,
  // and the rate limit gets its cool-down without blocking the queue.
  const RATE_LIMIT_BUDGET_MS = 90_000;
  let waitedMs = 0;
  let create: Response | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    create = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: "POST", headers: repHeaders(), body: JSON.stringify({ input }),
    });
    if (create.status !== 429) break;
    const body = (await create.clone().json().catch(() => ({}))) as { retry_after?: number };
    const headerWait = Number(create.headers.get("retry-after") || 0);
    const waitSec = body.retry_after || headerWait || Math.min(30, 2 ** attempt);
    const waitMs = Math.min(60, waitSec) * 1000;
    if (waitedMs + waitMs > RATE_LIMIT_BUDGET_MS) {
      console.log(`[replicate] ${model} still rate-limited after ${Math.round(waitedMs / 1000)}s — requeueing rather than holding the serial worker`);
      break;
    }
    waitedMs += waitMs;
    console.log(`[replicate] ${model} rate-limited (429) — waiting ${waitSec}s (attempt ${attempt + 1}/8)`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  if (!create || !create.ok) throw new Error(`${model} create ${create?.status}: ${(await (create?.text() ?? Promise.resolve(""))).slice(0, 160)}`);
  const { id } = (await create.json()) as { id: string };
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`https://api.replicate.com/v1/predictions/${id}`, { headers: repHeaders() });
    const j = (await poll.json()) as { status: string; output?: string | string[]; error?: string };
    if (j.status === "succeeded" && j.output) return Array.isArray(j.output) ? j.output[0] : j.output;
    if (j.status === "failed" || j.status === "canceled") throw new Error(`${model}: ${j.error || j.status}`);
  }
  throw new Error(`${model}: timed out`);
}

/** flux-dev poster still with ONE retry. Every ladder's LAST rung used to be a
 *  bare call: a provider 5xx or repRun's 120s timeout escaped generateImageAd
 *  and terminal-failed an ad the merchant had already paid for. A retry costs
 *  ~$0.003 and converts the common transient blip into a delivered ad. */
async function fluxDevStill(prompt: string, stage: string): Promise<string> {
  const input = { prompt, num_inference_steps: 30, guidance: 3, aspect_ratio: "1:1", output_format: "jpg", output_quality: 92 };
  try {
    return await repRun("black-forest-labs/flux-dev", input);
  } catch (e) {
    console.log(`[image-ad] ${stage} flux-dev failed (${e instanceof Error ? e.message.slice(0, 120) : e}) — one retry`);
    return await repRun("black-forest-labs/flux-dev", input);
  }
}

/** Cut the product out of its photo (transparent PNG). Bria on Replicate,
 *  then fal birefnet, then null (caller falls back to scene mode). */
async function removeBackground(imageUrl: string): Promise<string | null> {
  try {
    return await repRun("bria/remove-background", { image: imageUrl }, 60_000);
  } catch (e) {
    console.log("[image-ad] bria rembg failed:", e instanceof Error ? e.message.slice(0, 120) : e);
  }
  if (process.env.FAL_KEY) {
    try {
      const submit = await fetch("https://queue.fal.run/fal-ai/birefnet/v2", {
        method: "POST",
        headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: imageUrl }),
      });
      if (!submit.ok) throw new Error(`submit ${submit.status}`);
      const q = (await submit.json()) as { status_url?: string; response_url?: string };
      if (!q.status_url?.startsWith("https://queue.fal.run/") || !q.response_url?.startsWith("https://queue.fal.run/")) throw new Error("no queue urls");
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const s = await fetch(q.status_url, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
        if (!s.ok) continue;
        const sj = (await s.json()) as { status?: string };
        if (sj.status === "COMPLETED") break;
        if (sj.status === "FAILED" || sj.status === "ERROR") throw new Error(sj.status);
      }
      const res = await fetch(q.response_url, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
      const rj = (await res.json()) as { image?: { url?: string } };
      if (rj.image?.url) return rj.image.url;
    } catch (e) {
      console.log("[image-ad] fal rembg failed:", e instanceof Error ? e.message.slice(0, 120) : e);
    }
  }
  return null;
}

/** Composite the exact product cutout onto the generated backdrop with a soft
 *  drop shadow. Writes straight into data/renders; returns the file name. */
async function compositeProductStill(backdropUrl: string, cutoutUrl: string): Promise<string | null> {
  const bin = ffmpegBin();
  if (!bin) return null;
  const dir = path.join(process.cwd(), "data", "renders");
  fs.mkdirSync(dir, { recursive: true });
  // Date.now() alone COLLIDES: two composites started in the same millisecond
  // (template self-heal beside a merchant job) overwrote each other's temp
  // files and the finally-block deleted the other's sources mid-encode.
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpBg = path.join(dir, `.bg-${stamp}.jpg`);
  const tmpCut = path.join(dir, `.cut-${stamp}.png`);
  const fileName = `img-${stamp}.jpg`;
  const out = path.join(dir, fileName);
  try {
    // Sources can be remote URLs or absolute local paths (template plates and
    // the statue live on the durable disk).
    for (const [src2, file] of [[backdropUrl, tmpBg], [cutoutUrl, tmpCut]] as const) {
      if (src2.startsWith("/") && fs.existsSync(src2)) {
        fs.copyFileSync(src2, file);
      } else {
        const res = await fetch(src2);
        if (!res.ok) return null;
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      }
    }
    const filters =
      "[0:v]scale=1024:1024:force_original_aspect_ratio=increase,crop=1024:1024[bg];" +
      "[1:v]scale=660:600:force_original_aspect_ratio=decrease[cut];" +
      "[cut]split[c1][c2];" +
      "[c2]colorchannelmixer=rr=0:gg=0:bb=0,gblur=sigma=14,colorchannelmixer=aa=0.38[sh];" +
      "[bg][sh]overlay=x=(W-w)/2+10:y=H-h-46+22[b1];" +
      "[b1][c1]overlay=x=(W-w)/2:y=H-h-46[outv]";
    const args = ["-y", "-i", tmpBg, "-i", tmpCut, "-filter_complex", filters, "-map", "[outv]", "-frames:v", "1", "-q:v", "3", out];
    const { ok } = await runFfmpegStill(bin, args);
    if (ok && fs.existsSync(out) && fs.statSync(out).size > 20_000) return fileName;
    return null;
  } finally {
    try { fs.rmSync(tmpBg, { force: true }); fs.rmSync(tmpCut, { force: true }); } catch { /* best-effort */ }
  }
}

/** Vision QA: does the generated ad actually show THIS product, undamaged,
 *  on-brief? Never blocks on its own failure — QA that errors passes. */
async function qaFidelity(productUrl: string, genUrl: string, wantBright: boolean): Promise<{ pass: boolean; reason: string }> {
  try {
    const raw = await anthropicVision(
      [
        `Image 1 is the REAL product photo. Image 2 is an AI-generated ad made from it.`,
        `Return ONLY JSON: {"pass": true|false, "reason": "short"}.`,
        `FAIL if ANY of these: the product's shape, colors, logos, text or details are changed/warped; the product became a different object; the product is at a wrong real-world scale (e.g. large item shrunk to hand-size); the product appears duplicated; any person shown has deformed hands or face;${wantBright ? " the image is dark/moody or on a black background (the brief is bright);" : ""} heavy visual artifacts.`,
        `Otherwise PASS. Judge fidelity and defects only — not taste.`,
      ].join("\n"),
      [productUrl, genUrl],
      { maxTokens: 200 }
    );
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { pass: true, reason: "qa-unparseable" };
    const j = JSON.parse(m[0]) as { pass?: boolean; reason?: string };
    return { pass: j.pass !== false, reason: (j.reason || "").slice(0, 200) };
  } catch (e) {
    return { pass: true, reason: `qa-error: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}` };
  }
}

/** Vision gate for a presenter-holding still. This rung shipped un-checked,
 *  which is why a 6-box display case arrived palm-sized with two boxes in it:
 *  the composer both SHRANK the product and simplified it, and nothing looked.
 *  Judges the two failures that actually happen here — wrong scale against the
 *  body, and a product that isn't the same product any more. */
async function qaPresenterHold(
  productUrl: string,
  genUrl: string,
  scalePhrase: string | undefined
): Promise<{ pass: boolean; reason: string; bad: string[] }> {
  try {
    // The real product photo goes up as BYTES. Passed as a URL, the API's own
    // fetcher receives AVIF from Shopify's CDN for some originals and the
    // whole gate call 400s — which the catch below treats as a QA outage and
    // FAILS OPEN. Inlined bytes go through the client's sniff-and-reencode,
    // so the merchant's image format can never un-gate the merchant.
    let productRef = productUrl;
    try {
      // Fetch the vision-sized RENDITION, not the raw original — Shopify
      // originals routinely exceed the API's 8000px limit, which is the bug
      // visionSafeUrl already fixed once. Never reintroduce it via bytes.
      const { visionSafeUrl } = await import("./anthropic.server");
      const pres = await fetch(visionSafeUrl(productUrl));
      if (pres.ok) {
        const pbuf = Buffer.from(await pres.arrayBuffer());
        if (pbuf.length > 5_000) productRef = `data:image/jpeg;base64,${pbuf.toString("base64")}`;
      }
    } catch { /* URL fallback — no worse than before */ }
    const raw = await anthropicVision(
      [
        `Image 1 is the REAL product photo. Image 2 is an AI-composed shot of a presenter holding that product.`,
        `Answer each field INDEPENDENTLY. Do not let a good overall impression carry a field that is actually wrong.`,
        ``,
        // The failure merchants actually see: a box of the right SHAPE with
        // completely different art on it. "Same product?" gets a yes, because
        // it is the same kind of thing. So ask about the ARTWORK, panel by
        // panel, as its own question.
        `artworkMatches: compare the PRINTED ARTWORK panel by panel. The characters or images shown on the packaging, their colours, their positions, the logo placement, the background colour of the box. A package of the same SHAPE carrying different character art, different colours or a different layout is a FAILURE — it is not the merchant's product. Be strict: this is the single most common defect.`,
        // A flattened case passed "artworkMatches" because the art on the flat
        // card did roughly match. Same picture, different object.
        `sameObject: is this the SAME PHYSICAL THING, built the same way? Same three-dimensional form, same depth, same construction, the same faces and panels visible. A deep display case or tray rendered as a flat printed card or poster is a FAILURE even when the artwork on it looks right. So is a case whose lid, side panel or inner rows have disappeared.`,
        `notSimplified: does image 2 show the same number of visible units, boxes, windows or panels as image 1? Fewer is a failure.`,
        // Our own repair step produced this: the real case pasted on top of the
        // drawn one, two copies of the product stacked in a single frame.
        `singleProduct: does image 2 contain exactly ONE of the product? Two overlapping or stacked copies of the same item — one behind the other, or one floating in front of another — is a FAILURE, even if one of them looks correct.`,
        `textFaithful: is the packaging lettering the same words in the same colours? A gold logo rendered purple is a failure.`,
        scalePhrase
          ? `correctScale: the product's real size is ${scalePhrase}. Is it that size against the person? A case or box shrunk to palm-size is the most common scale failure.`
          : `correctScale: judging by what the product obviously is, is it a believable size against the person?`,
        `noSourceText: has marketing text, a caption, a price flash or a shop watermark from image 1's BACKGROUND been copied in, or packaging text duplicated? Answer true if NOT.`,
        `handsOk: if no hand is visible in the picture, answer true — a product resting on a surface does not need one. Otherwise COUNT THE DIGITS on every visible hand — four fingers plus one thumb, five total, never six. Five visible fingers with a thumb hidden behind the product is still six: failure. Exactly TWO hands in the whole image, both attached to the presenter, no third or disembodied hand.`,
        // Counting digits is not the same as looking at them. A frame came back
        // with the right NUMBER of fingers rendered as pale wooden dolls'
        // fingers with drawn-on knuckle lines, and a count-only question waved
        // it through as "hands ok".
        `handsHuman: if no hand is visible, answer true. Otherwise LOOK AT the fingers, ignoring how many there are. Are they living human fingers — skin the same tone as the wrists and arms they grow from, tapering naturally, with real nails and knuckles? A failure is fingers that look wooden, plastic, doll-like, prosthetic or mannequin; pale sausage shapes with painted-on joint lines; fingers that do not join the hand; fingers melting into the product. If they would make a viewer flinch, this is false.`,
        `faceVisible: is the presenter's whole face — eyes, nose AND mouth — unobstructed? A product held up covering the mouth or chin is a failure; the presenter is meant to be selling to camera.`,
        `notSelfie: is the presenter NOT reaching an arm toward the lens as though holding the camera? An outstretched arm while both hands hold the product implies a third arm off-frame.`,
        `reason: if anything is false, one short phrase naming the worst problem. Otherwise "clean".`,
        ``,
        `Judge fidelity, scale and anatomy only — not lighting or taste.`,
        `Reply ONLY JSON: {"artworkMatches":bool,"sameObject":bool,"notSimplified":bool,"singleProduct":bool,"textFaithful":bool,"correctScale":bool,"noSourceText":bool,"handsOk":bool,"handsHuman":bool,"faceVisible":bool,"notSelfie":bool,"reason":"..."}`,
      ].filter(Boolean).join("\n"),
      [productRef, genUrl],
      // The cheap vision model looked straight at plastic doll fingers with
      // painted-on joints and answered "hands human". It is fine at reading
      // packaging text; it is not reliable at judging anatomy. This gate runs
      // at most three times per presenter ad, so it can afford the better one.
      //
      // The token budget is generous on purpose: ten fields and a reason
      // string at 300 tokens came back truncated, the closing brace never
      // arrived, and every frame in a four-presenter sweep — including one
      // holding a red lunchbox — was recorded as a PASS.
      { maxTokens: 1000, model: "claude-sonnet-5" }
    );
    const m = raw.match(/\{[\s\S]*\}/);
    // An answer we could not read is NOT an approval. It used to return
    // pass:true, so every parse failure shipped as a clean frame and the
    // report said the gate was happy.
    if (!m) {
      console.warn(`[presenter:gate] unreadable verdict, treating as a failure: ${raw.slice(0, 160)}`);
      return { pass: false, reason: "gate could not read its own verdict", bad: ["unreadable"] };
    }
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const bad = (["artworkMatches", "sameObject", "notSimplified", "singleProduct", "textFaithful", "correctScale", "noSourceText", "handsOk", "handsHuman", "faceVisible", "notSelfie"] as const)
      .filter((k) => j[k] === false) as string[];
    if (!bad.length) return { pass: true, reason: "clean", bad };
    const why = typeof j.reason === "string" && j.reason ? j.reason : bad.join(", ");
    return { pass: false, reason: `${bad.join("/")}: ${why}`.slice(0, 200), bad };
  } catch (e) {
    // A QA OUTAGE is different from an unreadable verdict: the model never
    // answered at all, and blocking a paid render on our own downtime would
    // be worse than shipping. Distinguished from "unreadable" above, which
    // means the model did answer and the answer was not usable.
    return { pass: true, reason: `qa-error: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`, bad: [] };
  }
}

/** Paste the merchant's ACTUAL product over the one the model drew.
 *
 *  Asking a generative model to reproduce packaging faithfully is a losing
 *  game — a twelve-box display came back as one box with a logo reading "POP
 *  MILLMART". The pixels of the real product already exist, so the model only
 *  needs to get the POSE right: a presenter holding something of roughly that
 *  shape. Then the real thing goes on top.
 *
 *  Same machinery the exact-template path has used all along — removeBackground
 *  for a transparent cutout, ffmpeg to overlay it with a soft contact shadow —
 *  just never wired to presenter holds.
 *
 *  Returns null on any failure so the caller keeps the generative frame: a
 *  mispasted product is worse than an approximated one.
 *
 *  Every bail says WHY on the way out. The first run of this shipped silent
 *  returns, the sweep reported "drawn" for both presenters, and there was no
 *  way to tell which of four steps had given up. */
type PasteResult =
  | { ok: true; file: string; absPath: string; cutoutPath: string; rect: { x: number; y: number; w: number; h: number }; frame: { w: number; h: number } }
  | { ok: false; failed: string };

async function overlayRealProduct(
  frameUrl: string,
  productImageUrl: string,
  opts: { blank?: boolean; whole?: boolean; sizeClass?: string } = {}
): Promise<PasteResult> {
  // On the blank path the product COVERS the stand-in — it fills the box's
  // width and its height, overhanging in whichever direction it must.
  //
  // Fitting inside gave a postage-stamp product on a white box. Filling only
  // the width left the box's upper half exposed, and handing a diffusion
  // model a large empty region to repair got exactly what a large empty
  // region gets: it drew a SECOND product there. The reliable answer is to
  // leave it almost nothing to fill.
  // ALWAYS cover, on both paths.
  //
  // With the blend switched off the composite still had two products in it,
  // and the mask proved the blend never touched that region. It is the repair
  // path: the frame underneath is the model's own drawn box, the real
  // photograph was fitted INSIDE its bounding box, and the drawn one stayed
  // visible around the edges. A real product with a fake one framing it.
  //
  // Covering overhangs rather than distorts, and a product slightly larger
  // than the one it replaces is not a defect — a visible counterfeit behind
  // it is.
  const cover = true;
  const give = (why: string): PasteResult => { console.warn(`[presenter:paste] skipped — ${why}`); return { ok: false, failed: why }; };
  const bin = ffmpegBin();
  if (!bin) return give("no ffmpeg binary");

  // Where did the model put it? Percentages so the answer is resolution-free.
  let box: { x: number; y: number; w: number; h: number } | null = null;
  let boxNote = "vision returned no JSON box";
  try {
    const raw = await anthropicVision(
      [
        opts.blank
          ? `This photo contains a PLAIN UNMARKED BOX — either held up to the camera or resting on a surface in front of the person.`
          : `The person in this photo is holding a product up to the camera.`,
        opts.whole
          // On a counter the box is seen at an angle, so its front face is a
          // fraction of the object. Pasting to the FACE left the top and side
          // panels showing under the product — which every rejection called a
          // "white pedestal". Take the whole silhouette instead.
          ? `Return the bounding box of the ENTIRE box as it appears — every part of it, including its top face and any side face turned toward the camera, from its leftmost to its rightmost edge and from its highest point to where it meets the surface. Not the hands, not the arms, not the surface.`
          : opts.blank
          ? `Return the bounding box of that blank box's FRONT FACE — the flat panel facing the camera. Not the hands, not the arms, not the side faces.`
          : `Return the bounding box of THE PRODUCT ONLY — the box or package itself, not the hands, not the arms.`,
        `Use percentages of the image dimensions, where x,y is the TOP-LEFT corner.`,
        `Be tight: the box should touch the product's outer edges with no margin.`,
        `Reply ONLY JSON: {"x":number,"y":number,"w":number,"h":number}`,
      ].join(" "),
      [frameUrl],
      { maxTokens: 120 }
    );
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const j = JSON.parse(m[0]) as Record<string, number>;
      const ok = ["x", "y", "w", "h"].every((k) => typeof j[k] === "number" && j[k] >= 0 && j[k] <= 100);
      // A box that covers almost everything, or almost nothing, is a bad read
      // rather than a real answer — better to keep the generative frame.
      if (!ok) boxNote = `box out of range: ${m[0].slice(0, 80)}`;
      else if (!(j.w > 8 && j.h > 8 && j.w < 95 && j.h < 95)) boxNote = `implausible box ${Math.round(j.w)}×${Math.round(j.h)}%`;
      else box = { x: j.x, y: j.y, w: j.w, h: j.h };
    }
  } catch (e) {
    boxNote = `vision failed: ${(e as Error).message.slice(0, 120)}`;
  }
  if (!box && boxNote.startsWith("implausible")) {
    // A single bad read killed an entire composite ("implausible box 0×1%").
    // The question is cheap; ask it once more before giving up on the paste.
    try {
      const raw2 = await anthropicVision(
        [
          `Find the ${opts.blank ? "plain unmarked box" : "product"} in this photo — it may be held up or sitting on a surface.`,
          `Reply ONLY JSON with its bounding box as percentages of the image, x,y being the TOP-LEFT corner:`,
          `{"x":number,"y":number,"w":number,"h":number}`,
        ].join(" "),
        [frameUrl],
        { maxTokens: 120 }
      );
      const m2 = raw2.match(/\{[\s\S]*\}/);
      if (m2) {
        const j2 = JSON.parse(m2[0]) as Record<string, number>;
        if (["x", "y", "w", "h"].every((k) => typeof j2[k] === "number") && j2.w > 8 && j2.h > 8 && j2.w < 95 && j2.h < 95) {
          box = { x: j2.x, y: j2.y, w: j2.w, h: j2.h };
        }
      }
    } catch { /* second read failed too — fall through to the bail below */ }
  }
  if (!box) return give(boxNote);

  // WHERE IS THE FACE. Asked as a measurement, not a yes/no. The gate's
  // faceVisible question answered "true" on a frame with the header card over
  // the presenter's mouth — one wrong word from a vision model shipped the
  // day's only bad frame. A rectangle-intersection test cannot be charmed.
  let face: { x: number; y: number; w: number; h: number } | null = null;
  // The failure reason travels WITH the rejection so a sweep shows why the
  // precise chin test didn't run — a whole week of face reads failed silently
  // (null → guard skipped → the Hirono full-face paste shipped) and nothing
  // in any report said so.
  let faceNote = "";
  try {
    const rawF = await anthropicVision(
      `Return the bounding box of the person's FACE — forehead to chin, ear to ear. Use PERCENTAGES of the image (0-100), x,y = TOP-LEFT corner. Reply ONLY JSON, no prose: {"x":number,"y":number,"w":number,"h":number}`,
      [frameUrl],
      // sonnet-5: haiku's box answers never parsed (silently, 100% of the
      // time). With thinking disabled sonnet-5 is budget-safe at this size.
      { maxTokens: 200, model: "claude-sonnet-5" }
    );
    const mF = rawF.match(/\{[\s\S]*\}/);
    if (mF) {
      const jF = JSON.parse(mF[0]) as Record<string, number>;
      if (["x", "y", "w", "h"].every((k) => typeof jF[k] === "number") && jF.w > 2 && jF.h > 2 && jF.w < 60 && jF.h < 60) {
        face = { x: jF.x, y: jF.y, w: jF.w, h: jF.h };
      } else {
        faceNote = ` (face box implausible: ${mF[0].slice(0, 60)})`;
      }
    } else {
      faceNote = ` (face read unparseable: ${rawF.slice(0, 60)})`;
    }
  } catch (e) {
    faceNote = ` (face read error: ${(e instanceof Error ? e.message : String(e)).slice(0, 90)})`;
  }

  const cutout = await removeBackground(productImageUrl);
  if (!cutout) return give("background removal returned nothing");

  const dir = path.join(process.cwd(), "data", "renders");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpFrame = path.join(dir, `.hf-${stamp}.jpg`);
  const tmpCut = path.join(dir, `.hc-${stamp}.png`);
  const fileName = `img-${stamp}.jpg`;
  const out = path.join(dir, fileName);
  try {
    for (const [src, file] of [[frameUrl, tmpFrame], [cutout, tmpCut]] as const) {
      const res = await fetch(src);
      if (!res.ok) return give(`download ${res.status} for ${src.slice(0, 60)}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    const W = await probeWidth(bin, tmpFrame);
    const H = await probeHeight(bin, tmpFrame);
    if (!W || !H) return give("could not probe frame dimensions");

    // The bounding box the model reported, inflated a little so the paste
    // swallows the drawn outline rather than stopping exactly on it.
    const pad = 1.08;
    const bw = Math.round((box.w / 100) * W * pad);
    const bh = Math.round((box.h / 100) * H * pad);
    const bx = Math.round((box.x / 100) * W - ((box.w / 100) * W * (pad - 1)) / 2);
    const bottom = Math.round(((box.y + box.h) / 100) * H + ((box.h / 100) * H * (pad - 1)) / 2);
    // Size it from the cutout's own aspect ratio: fill the box's width, and
    // only fall back to fitting by height if that would make it wildly taller
    // than the space the model left for it.
    // SIZE FROM THE BODY, NOT FROM THE STAND-IN.
    //
    // Matching the stand-in exactly is faithful and wrong: the composer draws
    // a small box on the counter, the paste matches it, and every rejection
    // reads "palm-size instead of spanning torso". The stand-in's JOB is to
    // fix the pose and the lighting; how big the product should be is
    // something we already know from its real dimensions, and a fraction of
    // the frame is a measurement the composer cannot get wrong for us.
    const bodyFrac: Record<string, number> = { palm: 0.24, "two-hand": 0.46, large: 0.62, floor: 0.74 };
    const wantW = opts.sizeClass ? Math.round(W * (bodyFrac[opts.sizeClass] ?? 0)) : 0;

    const cut = headerSize(tmpCut);
    let tw = bw;
    let th = cut ? Math.round((bw * cut.h) / cut.w) : bh;
    if (cover && cut) {
      // Cover the stand-in in both directions, then take the body-derived
      // width if it is bigger. Never smaller: the stand-in must stay hidden.
      tw = Math.max(bw, Math.round((bh * cut.w) / cut.h), wantW);
      th = Math.round((tw * cut.h) / cut.w);
    } else if (cut && th > bh * 1.6) {
      th = bh; tw = Math.round((bh * cut.w) / cut.h);
    }
    // TOP-ALIGNED when covering. Centring split the extra height between top
    // and bottom, and the top half went straight into the presenter's face —
    // the one thing the composite still failed on. The top edge now stays
    // exactly where the box it replaces began, which the compose prompt
    // already keeps below the chin, and every extra pixel goes downward over
    // the chest where there is nothing to obscure.
    // On a counter it sits on the surface, so the bottom edge is fixed and it
    // grows upward into empty chest. Held, it grows downward, away from the face.
    let anchorY = opts.whole ? bottom - th : cover ? Math.round(bottom - bh) : bottom - th;
    // FACE GUARD — deterministic. If the paste's top edge would cross the
    // chin, the composition is unusable no matter how good the paste is:
    // fail this candidate and let another stand-in win. Shifting it down was
    // considered and rejected, because that exposes the stand-in above the
    // paste and trades a blocked face for a floating box.
    if (face) {
      const chinY = ((face.y + face.h) / 100) * H;
      if (anchorY < chinY + H * 0.02) {
        return give(`paste would cover the face (top ${Math.round((anchorY / H) * 100)}% vs chin ${Math.round((chinY / H) * 100)}%)`);
      }
    } else if (anchorY < H * 0.36) {
      // NO FACE READ IS NOT AN ALIBI. When the face couldn't be located the
      // guard used to skip entirely, and a full-height paste shipped with the
      // presenter's head completely behind it (the Hirono sheet — gate said
      // "face clear" six times). The compose prompt keeps the head in the top
      // third, so a paste whose top edge reaches the top ~36% of the frame is
      // covering where a face lives, bbox or no bbox.
      return give(`paste top at ${Math.round((anchorY / H) * 100)}% with no face read — would cover the head zone${faceNote}`);
    }
    const filters =
      `[1:v]scale=${tw}:${th}[cut];` +
      `[cut]split[c1][c2];` +
      // A hard paste reads as a sticker. A blurred dark copy behind it gives
      // the product contact with the hands holding it.
      `[c2]colorchannelmixer=rr=0:gg=0:bb=0,gblur=sigma=10,colorchannelmixer=aa=0.34[sh];` +
      // Bottom-aligned normally, so a drawn product stays sitting in the
      // hands. Centred on the stand-in, which the product is allowed to
      // overhang in both directions.
      `[0:v][sh]overlay=x=${bx}+(${bw}-w)/2+6:y=${anchorY}+8[b1];` +
      `[b1][c1]overlay=x=${bx}+(${bw}-w)/2:y=${anchorY}[outv]`;
    const { ok } = await runFfmpegStill(bin, ["-y", "-i", tmpFrame, "-i", tmpCut, "-filter_complex", filters, "-map", "[outv]", "-frames:v", "1", "-q:v", "3", out]);
    if (ok && fs.existsSync(out) && fs.statSync(out).size > 20_000) {
      // Where the product ACTUALLY landed, so the edge blend can build its
      // mask around the real thing rather than around the model's guess.
      const px = bx + Math.round((bw - tw) / 2);
      return { ok: true, file: fileName, absPath: out, cutoutPath: tmpCut, rect: { x: px, y: anchorY, w: tw, h: th }, frame: { w: W, h: H } };
    }
    return give(ok ? "ffmpeg wrote nothing usable" : "ffmpeg overlay failed");
  } catch (e) {
    return give(`overlay threw: ${(e as Error).message.slice(0, 120)}`);
  } finally {
    // tmpCut deliberately survives: the edge blend masks by the product's own
    // silhouette, and re-running background removal to get it back would cost
    // another call for bytes we already have. The blend deletes it.
    try { fs.rmSync(tmpFrame, { force: true }); } catch { /* best-effort */ }
  }
}


/** Put the fingers back over the pasted product's edges.
 *
 *  A flat paste is exact but dead: it covers the hands that were gripping the
 *  stand-in, so the product ends up floating in front of two hands rather than
 *  held by them. Everyone doing AI product imagery solves this the same way —
 *  freeze the product, regenerate around it — so that is what this does. A
 *  mask exposes a RING around the pasted rectangle and nothing else; the
 *  product's own pixels are not in the editable region at all, so the
 *  packaging cannot be redrawn, misspelt or turned into a lunchbox.
 *
 *  Returns null on any failure, leaving the flat paste in place. */
type BlendResult =
  | { ok: true; file: string; absPath: string; maskPath: string }
  | { ok: false; why: string; maskPath?: string };

async function blendProductEdges(
  pasted: { absPath: string; cutoutPath: string; rect: { x: number; y: number; w: number; h: number }; frame: { w: number; h: number } },
  // How far beyond the product the editable area reaches, as a fraction of
  // the product's width. A ring is enough to put fingers back on a product
  // the model drew. A stand-in needs far more, because the plain box is
  // BIGGER than the photo pasted onto it and whatever is left outside the
  // work area survives — which is exactly what "a flat printed poster glued
  // onto a plain shipping box" means.
  dilate = 0.10
): Promise<BlendResult> {
  // Third time writing this note: a reason in console.warn is a reason nobody
  // reads. The blend failed on every frame of a sweep and the report could
  // only say "no blend".
  const give = (why: string): BlendResult => { console.warn(`[presenter:blend] ${why}`); return { ok: false, why }; };
  const bin = ffmpegBin();
  if (!bin) return give("no ffmpeg binary");
  const { inpaintFill } = await import("./fal-image.server");
  const dir = path.join(process.cwd(), "data", "renders");
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const maskFile = path.join(dir, `.mk-${stamp}.png`);
  const { rect, frame } = pasted;
  const out = Math.max(24, Math.round(rect.w * dilate));
  const ox = Math.max(0, rect.x - out);
  const oy = Math.max(0, rect.y - out);
  const ow = Math.min(frame.w - ox, rect.w + out * 2);
  const oh = Math.min(frame.h - oy, rect.h + out * 2);
  try {
    fs.mkdirSync(dir, { recursive: true });
    // Protect the product by its OWN SILHOUETTE, not by a rectangle.
    //
    // A rectangle left the stand-in's blank corners showing around an angled
    // display case, and the gate called it exactly right: "3D display box
    // reduced to a flat printed image on a card". Masking by the cutout's
    // alpha means everything that is not the product — including whatever is
    // left of the plain box — is editable, so the case becomes the object in
    // the hands instead of a picture stuck to one.
    //
    // NO lavfi SOURCE. Both earlier versions of this died with
    // "vost#0:0/png … return code -22 (Invalid argument) · Conversion
    // failed!", and the one thing they shared was a `color=` filter source
    // feeding a PNG output. Every ffmpeg call in this file that works — the
    // paste, the text overlay — feeds only decoded files. So both canvases
    // are made by flooding a copy of the pasted frame with drawbox, which
    // costs nothing and keeps the graph on the path that is known good.
    //
    //   box   = black frame, white over the work area
    //   prot  = white frame, product silhouette in black
    //   mask  = box × prot → white only where editing is allowed
    const soft = Math.max(1, Math.round(rect.w * 0.006)); // feather, so the seam is not a cliff
    const graph =
      `[0:v]split=2[a][b];` +
      `[a]drawbox=x=0:y=0:w=${frame.w}:h=${frame.h}:color=black@1.0:t=fill,` +
      `drawbox=x=${ox}:y=${oy}:w=${ow}:h=${oh}:color=white@1.0:t=fill,format=gbrp[box];` +
      `[b]drawbox=x=0:y=0:w=${frame.w}:h=${frame.h}:color=white@1.0:t=fill,format=gbrp[cv];` +
      `[1:v]scale=${rect.w}:${rect.h},alphaextract,gblur=sigma=${soft},negate,format=gbrp[pa];` +
      `[cv][pa]overlay=x=${rect.x}:y=${rect.y}[prot];` +
      `[box][prot]blend=all_mode=multiply,format=gray[mask]`;
    const mk = await runFfmpegStill(
      bin,
      ["-y", "-i", pasted.absPath, "-i", pasted.cutoutPath, "-filter_complex", graph, "-map", "[mask]", "-frames:v", "1", maskFile],
      { captureStderr: true }
    );
    const why = (r: { stderr: string }) =>
      (r.stderr || "").split("\n").filter((l) => /error|invalid|unable|no such|not within|failed/i.test(l)).slice(-2).join(" · ").slice(0, 180);

    if (!mk.ok || !fs.existsSync(maskFile)) {
      // The silhouette needs the cutout to carry an alpha channel. If
      // background removal handed back something flat, alphaextract has
      // nothing to read — fall back to a plain ring around the product, which
      // still buys fingers over the edges and a contact shadow, and say which
      // one was used rather than pretending they are the same thing.
      const ring = await runFfmpegStill(
        bin,
        ["-y", "-i", pasted.absPath, "-filter_complex",
          `[0:v]drawbox=x=0:y=0:w=${frame.w}:h=${frame.h}:color=black@1.0:t=fill,` +
          `drawbox=x=${ox}:y=${oy}:w=${ow}:h=${oh}:color=white@1.0:t=fill,` +
          `drawbox=x=${rect.x + soft * 2}:y=${rect.y + soft * 2}:w=${Math.max(1, rect.w - soft * 4)}:h=${Math.max(1, rect.h - soft * 4)}:color=black@1.0:t=fill,` +
          `format=gray[mask]`,
          "-map", "[mask]", "-frames:v", "1", maskFile],
        { captureStderr: true }
      );
      if (!ring.ok || !fs.existsSync(maskFile)) {
        return give(`mask filter failed: ${why(mk) || "(no stderr)"} · ring fallback also failed: ${why(ring) || "(no stderr)"}`);
      }
      console.warn(`[presenter:blend] silhouette mask failed (${why(mk)}) — using the rectangular ring`);
    }

    const edited = await inpaintFill(
      `data:image/jpeg;base64,${fs.readFileSync(pasted.absPath).toString("base64")}`,
      `data:image/png;base64,${fs.readFileSync(maskFile).toString("base64")}`,
      "The person's two hands holding the object shown: fingers wrap around its left and right edges, thumbs near the lower corners, its weight resting in both palms, with a soft contact shadow where it meets the skin. " +
      "Everywhere else is the person's plain unprinted t-shirt and the ordinary room behind them, continuing naturally. There is no white box, no cardboard, no card, no tray and no panel — anything like that is removed and replaced by clothing and background. " +
      "Absolutely no writing anywhere: no text, letters, words, labels, logos, barcodes or printing of any kind outside the object itself."
    );
    if (!edited) return give("inpaint returned nothing");

    const res = await fetch(edited, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return give(`inpaint download ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 20_000) return give(`inpaint result too small (${buf.length}b)`);
    const fileName = `img-${stamp}-blend.jpg`;
    const abs = path.join(dir, fileName);
    fs.writeFileSync(abs, buf);
    return { ok: true, file: fileName, absPath: abs, maskPath: maskFile };
  } catch (e) {
    return give(`threw: ${(e as Error).message.slice(0, 140)}`);
  } finally {
    // The mask deliberately survives. Which region was editable is the single
    // most useful fact about a bad composite, and inferring it from the
    // output is guesswork — two runs were spent staring at frames trying to
    // work out which object the model had invented and which was the paste.
    try { fs.rmSync(pasted.cutoutPath, { force: true }); } catch { /* best-effort */ }
  }
}

/** The presenter-hold rung: compose the presenter holding the real product,
 *  gate it, and re-compose once with the failure shouted back.
 *
 *  Extracted so the QA harness drives the SAME code merchants hit. This is the
 *  path that produced cases with the right shape and the wrong artwork, and it
 *  was the one part of the image pipeline the harness could not reach. */
/** The gate fields that mean "this is not the merchant's product". Scale and
 *  anatomy are defects; these are a different item. */
const IDENTITY_FIELDS = ["artworkMatches", "sameObject", "notSimplified", "textFaithful"];

export interface PresenterHoldResult {
  url: string | null;
  pass: boolean;
  reason: string;
  retried: boolean;
  /** True when the merchant's real product photo was pasted over the drawn one. */
  composited?: boolean;
  /** On-disk path of the composited frame, when there is one. The QA harness
   *  publishes these bytes; production only needs the URL. */
  localPath?: string;
  /** What happened on the blank stand-in attempt, in one line. Lives on the
   *  result rather than in a console warning because a console warning is not
   *  in the report, and anything not in the report does not exist. */
  standIn?: string;
  /** The bare stand-in frame, so a run can show whether the blank box itself
   *  came out usable. */
  standInUrl?: string;
  /** The composite that was built, whether or not it was accepted. Without
   *  this a rejected attempt is invisible: the report shows the frame that
   *  shipped instead, and the thing being iterated on can never be looked at. */
  attemptPath?: string;
  /** The inpaint mask — white is what the model was allowed to redraw. */
  maskPath?: string;
  /** The composite BEFORE the blend. With this and the mask, which step
   *  introduced a defect is a fact rather than a deduction from the output. */
  prePastePath?: string;
  /** How the delivered frame was made: the merchant's photograph pasted onto
   *  a blank stand-in, the same paste used to repair a bad generative frame,
   *  or a purely generated product. */
  via: "blank-standin" | "paste-repair" | "drawn";
  /** Which gate fields came back false, so callers can act on WHICH defect
   *  rather than sniffing the reason string. */
  failed: string[];
  /** True when the delivered frame does not show the merchant's actual product
   *  — wrong artwork, wrong object, or units missing — and the paste did not
   *  rescue it. Shipping one of these is the complaint that started all this. */
  wrongProduct: boolean;
}

/** Which framing this presenter × product pair gets. A hand-sized item is
 *  held; anything bigger goes on the counter with the presenter behind it
 *  (showcase); apparel is worn. PRESENTER_LAYOUT=hold|showcase forces one
 *  everywhere — the backburner switch for the pre-showcase pipeline.
 *
 *  This is THE layout decision — runPresenterHold obeys it and the shot
 *  library keys on it, so a cached shot is always the same framing the
 *  pipeline would have generated. */
export function presenterLayout(sizeClass?: string, wear?: boolean): "hold" | "showcase" | "wear" {
  const forced = (process.env.PRESENTER_LAYOUT || "").trim().toLowerCase();
  const showcase = forced === "showcase"
    || (forced !== "hold" && !wear && ["two-hand", "large", "floor"].includes(sizeClass || ""));
  if (showcase) return "showcase";
  return wear ? "wear" : "hold";
}

export async function runPresenterHold(opts: {
  portraitUrl: string;
  productImageUrl: string;
  productTitle: string;
  wear?: boolean;
  scene?: string;
  scalePhrase?: string;
  /** palm | two-hand | large | floor, from product-scale. Decides whether the
   *  presenter holds the product or stands behind it. */
  sizeClass?: string;
}): Promise<PresenterHoldResult> {
  // LAYOUT. A hand-sized item gets held; anything bigger gets set down in
  // front of the presenter, which is how creators actually shoot it and the
  // only framing where a large product and a visible face coexist. Holding a
  // twelve-count display case chest-up put it over the presenter's mouth in
  // every single attempt, because that is what would happen in real life.
  //
  // PRESENTER_LAYOUT=hold forces the old behaviour for everything, so the
  // previous pipeline stays one environment variable away.
  let preComposed: string | undefined;
  let preQa: { pass: boolean; reason: string; bad: string[] } | undefined;
  const showcase = presenterLayout(opts.sizeClass, opts.wear) === "showcase";

  const { submitCompose, pollCompose } = await import("./fal-image.server");
  const runCompose = async (
    hint: string | undefined,
    mode: "hold" | "wear" | "blank" | "showcase" = opts.wear ? "wear" : "hold",
    aspect?: number
  ): Promise<string | undefined> => {
    const q = await submitCompose(opts.portraitUrl, opts.productImageUrl, opts.productTitle, 1, mode, opts.scene, hint, aspect);
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const p = await pollCompose(q.statusUrl, q.responseUrl);
      if (p.done) return p.urls?.[0];
    }
    return undefined;
  };

  // ── CANDIDATES, THEN PICK ───────────────────────────────────────────────
  //
  // One fixed ladder was the mistake. Whichever rung ran first had to be right
  // for every product, so each new failure got answered by re-ordering the
  // ladder and the previous good behaviour was lost. The plain generative hold
  // was producing natural, well-composed frames before today and got buried
  // under machinery aimed at a different defect.
  //
  // So compose two candidates at once and let the gate choose. Cheap (~$0.03
  // each, run in parallel) and it means the simplest path wins whenever it is
  // good enough, which for a hand-sized product it usually is.
  let standIn = "not attempted";
  let standInUrl: string | undefined;
  let attemptPath: string | undefined;
  let maskPath: string | undefined;
  let prePastePath: string | undefined;

  if (!opts.wear) {
    const aspect = await productAspect(opts.productImageUrl);
    // Order = preference when both pass. A real photograph beats a drawn one
    // for a large product, where the drawing has the most to get wrong; a
    // natural hold beats a composite for something hand-sized.
    //
    // THREE stand-ins, not one. Across four sweeps the showcase path passed
    // exactly once per run and it was a different presenter every time —
    // grace, then diego, then aditi. That is not a defect that needs another
    // geometry fix, it is variance: roughly one stand-in in four comes out
    // usable and we were only ever drawing one card. The gate already picks
    // the winner, so give it more to pick from. Three tries at ~25% each is
    // the difference between a coin flip and a reliable path.
    // Five draws by default: measured stand-in hit rate is ~25-33%, and at
    // that rate three draws still left a ~34% chance of delivering nothing.
    const tries = Number(process.env.PRESENTER_TRIES || 5);
    // NO BLANK BOX ANYWHERE. Every candidate composes the real product and
    // gets the real photograph pasted over the drawn one — the drawn version
    // is the paste's colour-matched camouflage, so coverage misses read as
    // depth instead of a white slab. The bare hold stays in the pool ungated
    // by paste because for unbranded products the drawn item can pass as-is,
    // and when it does it is the most natural frame available.
    const plan: { name: string; mode: "hold" | "showcase"; paste: boolean }[] = showcase
      ? [
          ...Array.from({ length: tries }, (_, i) => ({ name: `showcase ${i + 1}`, mode: "showcase" as const, paste: true })),
          { name: "hold", mode: "hold" as const, paste: false },
        ]
      : [
          { name: "hold", mode: "hold" as const, paste: false },
          ...Array.from({ length: tries }, (_, i) => ({ name: `hold+paste ${i + 1}`, mode: "hold" as const, paste: true })),
        ];

    const tried = await Promise.all(plan.map(async (c) => {
      try {
        const frame = await runCompose(opts.scalePhrase, c.mode, aspect);
        if (!frame) return { c, note: `${c.name}: compose returned nothing` };
        if (!c.paste) {
          const qa = await qaPresenterHold(opts.productImageUrl, frame, opts.scalePhrase);
          return { c, frame, qa, note: `${c.name}: ${qa.pass ? "passed" : `rejected — ${qa.reason}`}` };
        }
        const put = await overlayRealProduct(frame, opts.productImageUrl, { whole: c.mode === "showcase", sizeClass: opts.sizeClass });
        if (!put.ok) return { c, frame, note: `${c.name}: paste failed — ${put.failed}` };
        const inline = `data:image/jpeg;base64,${fs.readFileSync(put.absPath).toString("base64")}`;
        const qa = await qaPresenterHold(opts.productImageUrl, inline, opts.scalePhrase);
        return { c, frame, put, qa, note: `${c.name}: pasted, ${qa.pass ? "passed" : `rejected — ${qa.reason}`}` };
      } catch (e) {
        return { c, note: `${c.name}: threw — ${(e as Error).message.slice(0, 80)}` };
      }
    }));

    standIn = tried.map((t) => t.note).join(" · ");
    standInUrl = tried.find((t) => t.c.paste)?.frame;
    const winner = tried.find((t) => t.qa?.pass);
    if (winner) {
      const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
      const local = winner.put?.absPath;
      attemptPath = local;
      prePastePath = local;
      return {
        url: local && base ? `${base}/renders/${winner.put!.file}` : winner.frame!,
        pass: true,
        reason: `${winner.c.name} · ${winner.qa!.reason}`,
        retried: false,
        composited: !!local,
        localPath: local,
        standIn,
        standInUrl,
        attemptPath,
        maskPath,
        prePastePath,
        via: local ? "blank-standin" : "drawn",
        failed: [],
        wrongProduct: false,
      };
    }
    // Nothing passed. Carry the best generative frame into the retry-and-
    // repair path below rather than composing a third time from scratch.
    const fallback = tried.find((t) => t.c.mode === "hold" && t.frame) || tried.find((t) => t.frame);
    if (fallback?.frame) {
      preComposed = fallback.frame;
      preQa = fallback.c.paste ? undefined : fallback.qa;
    }
  }

  let composed = preComposed || (await runCompose(opts.scalePhrase));
  if (!composed) return { url: null, pass: false, reason: "compose returned nothing", retried: false, composited: false, via: "drawn", failed: [], wrongProduct: false };
  if (opts.wear) return { url: composed, pass: true, reason: "wear-path (ungated)", retried: false, composited: false, via: "drawn", failed: [], wrongProduct: false };

  let qa = preQa || (await qaPresenterHold(opts.productImageUrl, composed, opts.scalePhrase));
  let retried = false;
  if (!qa.pass) {
    // The retry SHOUTS the requirement rather than repeating it — a second
    // identical attempt tends to reproduce the same mistake.
    retried = true;
    const louder = `${opts.scalePhrase || ""} CRITICAL: the previous attempt failed because "${qa.reason}". The product must appear at its stated real-world size, carry the EXACT printed artwork from the reference photo — same characters, same colours, same layout, same logos — and show EVERY unit, box and panel visible in it. Do not simplify it, do not redraw the artwork, do not invent a similar-looking package, do not shrink it to fit a hand.`.trim();
    const second = await runCompose(louder);
    if (second) {
      const qa2 = await qaPresenterHold(opts.productImageUrl, second, opts.scalePhrase);
      // Keep the retry only if it's actually better; a worse second take
      // shouldn't replace a merely-imperfect first one.
      if (qa2.pass) { composed = second; qa = qa2; }
    }
  }
  // THE REAL PRODUCT GOES ON TOP — but ONLY when the drawn one is wrong.
  //
  // The paste exists because the composer used to redraw packaging as a
  // lookalike. Once the finger-anatomy noise came out of the prompt, the
  // composer started getting the packaging RIGHT, and pasting over a correct
  // product just stacked a second copy on top of the first: two cases in one
  // frame, which is worse than the thing it was fixing. So it is a repair,
  // not a step — it runs when the identity check failed, and never otherwise.
  const needsRepair = qa.bad.some((k) => IDENTITY_FIELDS.includes(k));
  const repair = needsRepair ? await overlayRealProduct(composed, opts.productImageUrl) : null;
  if (repair && !repair.ok) standIn = `${standIn} · repair paste failed: ${repair.failed}`;
  const pasted = repair?.ok ? repair : null;
  if (pasted) {
    // The repair paste needs the same edge blend as the stand-in one. Without
    // it the delivered frame carries a hard rectangular cut, the old drawn box
    // showing past its sides, and no fingers in front of the product — a
    // photograph held up rather than a product held.
    prePastePath = pasted.absPath;
    const rBlend = process.env.PRESENTER_EDGE_BLEND === "1"
      ? await blendProductEdges(pasted)
      : ({ ok: false, why: "disabled (PRESENTER_EDGE_BLEND unset)" } as BlendResult);
    maskPath = rBlend.maskPath || maskPath;
    if (!rBlend.ok) standIn = `${standIn} · repair blend failed: ${rBlend.why}`;
    const best = rBlend.ok ? rBlend : pasted;
    // Grade the BYTES, not a URL. The composite exists on the render disk
    // before it has a public address, and off production there is no public
    // address to give it — the first cut built one from SHOPIFY_APP_URL, which
    // is unset in CI, so the paste could never be scored there.
    attemptPath = best.absPath;
    const inline = `data:image/jpeg;base64,${fs.readFileSync(best.absPath).toString("base64")}`;
    const qa3 = await qaPresenterHold(opts.productImageUrl, inline, opts.scalePhrase);
    // Take the repair only if it actually repaired something. The old
    // condition also accepted it whenever the ORIGINAL had failed, which is
    // how a frame with the real case pasted below the drawn one — two
    // products, neither held — came back as the delivered ad.
    if (qa3.pass) {
      const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
      return {
        url: base ? `${base}/renders/${best.file}` : composed,
        pass: qa3.pass,
        reason: `real-product-composite${rBlend.ok ? " + edge-blend" : ""} · ${qa3.reason}`,
        retried,
        composited: true,
        localPath: best.absPath,
        via: "paste-repair",
        standIn,
        standInUrl,
        attemptPath,
        maskPath,
        prePastePath,
        failed: qa3.bad,
        // Ship ONLY what passed. Field-list drop rules kept growing a hole at
        // a time — identity, then faceVisible, and tonight a sweep shipped
        // frames rejected for scale and frames whose verdict was unreadable,
        // because neither was on the list. An affirmative rejection is a
        // rejection; the sole exception stays the qa-error outage path, which
        // fails OPEN upstream (pass=true) and never reaches this branch.
        wrongProduct: !qa3.pass,
      };
    }
  }
  return {
    url: composed,
    pass: qa.pass,
    reason: qa.reason,
    retried,
    composited: false,
    via: "drawn",
    standIn,
    standInUrl,
    attemptPath,
    maskPath,
    prePastePath,
    failed: qa.bad,
    wrongProduct: !qa.pass,
  };
}

/** Which mode fits a style when the caller didn't say: integrated scenes need
 *  generative placement; display/backdrop looks get the photo-true composite. */
function inferStyleMode(stylePrompt?: string): "backdrop" | "scene" {
  if (!stylePrompt) return "backdrop";
  if (/lived-in|golden-hour|user-generated|splash|mist|person|people|holding|wearing|in use|outdoor/i.test(stylePrompt)) return "scene";
  return "backdrop";
}

/* ── Ad Templates: plates + stand-in previews, self-built on this server ───
 * Each template renders ONCE as an empty plate. The EASYMODE stand-in bottle
 * (white bottle, green cap, EASYMODE label) is composited onto the plate with
 * placeholder copy → that's the preview merchants browse. Exact delivery
 * composites the merchant's product cutout onto the SAME plate, so preview
 * and result match pixel-for-pixel except bottle→product. */

// Under data/renders: the only persistent-disk path on Render (render.yaml
// mountPath) — plates/previews/statue must survive deploys or the picker
// flaps back to fallbacks after every push.
const AD_TEMPLATE_DIR = path.join(process.cwd(), "data", "renders", "ad-templates");
/// v10: the statue is EXTRACTED from the approved cinematic Product Highlight
// render (phcover) — one bottle everywhere, no parallel bottle designs. v9
// rendered its own bottle from a text prompt and drifted from the approved look.
const AD_TEMPLATE_VERSION = 10;
// Plates version separately: they only rebuild when their PROMPTS change.
// The v6 plates rendered fresh and bright, so the v7 statue swap reuses the
// exact scenes merchants already saw.
const PLATE_VERSION = 6;
const templateInFlight = new Set<string>();

export function adTemplateFile(kind: "preview" | "plate" | "statue", key = ""): string | null {
  if (key && !/^[a-z]+$/.test(key)) return null;
  if (kind === "statue") {
    const p = path.join(AD_TEMPLATE_DIR, `statue-v${AD_TEMPLATE_VERSION}.png`);
    return fs.existsSync(p) ? p : null;
  }
  if (kind === "plate") {
    // Exact current plate version only — previews and deliveries must build
    // on the SAME scene, and stale plates are how the dark-preview bug happened.
    const p = path.join(AD_TEMPLATE_DIR, `plate-v${PLATE_VERSION}-${key}.jpg`);
    return fs.existsSync(p) ? p : null;
  }
  // Previews: current version first, then older real builds — a version bump
  // upgrades in place, it never regresses the picker while rebuilding.
  for (let v = AD_TEMPLATE_VERSION; v >= 1; v--) {
    const p = path.join(AD_TEMPLATE_DIR, `preview-v${v}-${key}.jpg`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function currentTemplateFile(kind: "preview" | "plate", key: string): string {
  const v = kind === "plate" ? PLATE_VERSION : AD_TEMPLATE_VERSION;
  return path.join(AD_TEMPLATE_DIR, `${kind}-v${v}-${key}.jpg`);
}

async function ensureStatue(): Promise<string | null> {
  const existing = adTemplateFile("statue");
  if (existing) return existing;
  // ONE bottle everywhere: extract the exact bottle from the approved
  // cinematic Product Highlight render. Only if that render doesn't exist yet
  // does the old text-prompt path run (same look family, then replaced on the
  // next self-heal once phcover lands).
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  let raw: string;
  if (phCoverFile() && base) {
    raw = await repRun("google/nano-banana", {
      prompt:
        'Extract the exact bottle from this image as a clean studio product shot: the SAME tall sleek bottle, same emerald drink, same black sport cap, and the same wordmark reading exactly "EASYMODE" — clearly legible, right-side-up, label facing the camera. The bottle stands perfectly upright and centered on a pure white seamless background, soft even studio lighting, the full bottle in frame, photorealistic, nothing else in the frame.',
      image_input: [`${base}/ad-templates/phcover.jpg`],
      output_format: "jpg",
    });
  } else {
    const prompt = `${BOTTLE_BASE} ${BOTTLE_VARIANTS.emerald}`;
    try {
      raw = await repRun("google/nano-banana", { prompt, output_format: "jpg" });
    } catch {
      raw = await repRun("black-forest-labs/flux-dev", {
        prompt, num_inference_steps: 30, guidance: 3.5, aspect_ratio: "1:1", output_format: "jpg", output_quality: 92,
      });
    }
  }
  // Spelling QA — a misspelled stand-in poisons every preview. One kontext
  // text-fix retry; QA itself is best-effort (no key → ship what we have).
  try {
    const { anthropicVision } = await import("./anthropic.server");
    const verdict = await anthropicVision(
      'Does the text on this bottle\'s label read exactly "EASYMODE" (one word, spelled E-A-S-Y-M-O-D-E, right-side up)? Reply with only YES or NO.',
      [raw]
    );
    if (!/\bYES\b/i.test(verdict)) {
      artLog("ad-templates", "statue: label misspelled on first render — applying kontext text fix");
      console.log("[ad-templates] statue label misspelled — applying kontext text fix");
      raw = await repRun("black-forest-labs/flux-kontext-pro", {
        prompt: 'Replace the text on the bottle\'s label so it reads exactly "EASYMODE" in bold black uppercase letters, clean and legible. Keep everything else about the bottle and image identical.',
        input_image: raw, aspect_ratio: "1:1", output_format: "jpg",
      });
    }
  } catch (e) {
    console.error("[ad-templates] statue spelling QA skipped:", e instanceof Error ? e.message.slice(0, 120) : e);
  }
  const cutout = await removeBackground(raw);
  if (!cutout) return null;
  const res = await fetch(cutout);
  if (!res.ok) return null;
  fs.mkdirSync(AD_TEMPLATE_DIR, { recursive: true });
  const out = path.join(AD_TEMPLATE_DIR, `statue-v${AD_TEMPLATE_VERSION}.png`);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  artLog("ad-templates", `statue v${AD_TEMPLATE_VERSION} forged OK`);
  console.log("[ad-templates] statue forged (v" + AD_TEMPLATE_VERSION + ")");
  return out;
}

/* ── Bottle variant previews — PROD renders these itself and serves them at
 * /ad-templates/bottle-{variant}.jpg so candidates can be reviewed by link
 * (no GitHub secret required). Approved variant becomes the statue prompt. */
// v2: "wide flat screw cap" read as a MEDICINE/supplement jar. It's a DRINK:
// clear plastic, colored liquid inside, black sport spout cap, condensation.
const BOTTLE_VERSION = 2;
const BOTTLE_BASE =
  'Professional studio product photograph of a premium sports hydration DRINK, exactly the style of a viral sports drink bottle: a tall sleek CLEAR plastic beverage bottle FILLED with vividly colored liquid, topped with a black sport spout cap (flip-top drinking cap), fine condensation droplets on the plastic, and a full-wrap label with the wordmark "EASYMODE" printed in huge bold uppercase letters running VERTICALLY down the height of the bottle, spelled exactly E-A-S-Y-M-O-D-E, perfectly legible. It is unmistakably a refreshing DRINK — NOT a pill bottle, NOT a supplement jar, no pharmacy or medicine styling. Centered on a pure white seamless studio background, bright soft even studio lighting, crisp sharp focus, high-end commercial beverage photography. No other objects, no hands, no people, no extra text.';
export const BOTTLE_VARIANTS: Record<string, string> = {
  emerald: "The liquid inside is deep EMERALD GREEN and the wordmark is metallic GOLD.",
  kelly: "The liquid inside is bright electric KELLY GREEN and the wordmark is crisp bold WHITE.",
  cream: "The liquid inside is a creamy vanilla WHITE and the wordmark is bold EMERALD GREEN, with a thin gold ring accent on the cap.",
  duotone: "The liquid inside transitions from deep EMERALD GREEN at the top to a warm GOLDEN amber at the base, and the wordmark is bold CREAM.",
};
const bottleInFlight = new Set<string>();

export function bottlePreviewFile(variant: string): string | null {
  if (!BOTTLE_VARIANTS[variant]) return null;
  const p = path.join(AD_TEMPLATE_DIR, `bottle-${variant}-v${BOTTLE_VERSION}.jpg`);
  return fs.existsSync(p) ? p : null;
}

export function ensureBottlePreview(variant: string): void {
  if (!BOTTLE_VARIANTS[variant] || bottlePreviewFile(variant) || bottleInFlight.has(variant)) return;
  if (!process.env.REPLICATE_API_TOKEN) return;
  bottleInFlight.add(variant);
  (async () => {
    try {
      const url = await repRun("google/nano-banana", { prompt: `${BOTTLE_BASE} ${BOTTLE_VARIANTS[variant]}`, output_format: "jpg" });
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      fs.mkdirSync(AD_TEMPLATE_DIR, { recursive: true });
      fs.writeFileSync(path.join(AD_TEMPLATE_DIR, `bottle-${variant}-v${BOTTLE_VERSION}.jpg`), Buffer.from(await res.arrayBuffer()));
      artLog("ad-templates", `bottle-${variant}: candidate rendered OK`);
    } catch (e) {
      artLog("ad-templates", `bottle-${variant}: FAILED — ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    } finally {
      bottleInFlight.delete(variant);
    }
  })();
}

/* ── AD FORMATS: the statistically-proven static compositions (callouts,
 * review card, text convo, us-vs-them, before/after, offer, feed-native).
 * Copy per product from Claude, layout rendered by nano-banana AROUND the
 * real product photo, vision-QA'd for spelling + product fidelity. */

function formatLayoutPrompt(key: string, c: Record<string, string>, hero?: string): string {
  // Real merchant ads pass the product photo as image_input; self-forged
  // previews describe an EasyMode-branded hero product in text instead.
  const productClause = hero
    ? `The hero product is ${hero}. Any wordmark or label on it must read exactly "EASYMODE" — spelled E-A-S-Y-M-O-D-E in clean capital letters — and contain no other readable words.`
    : "The product from the provided image must stay perfectly identical — same shape, colors, label and logos, never redrawn or warped.";
  const base = `Modern high-converting DTC e-commerce static ad, crisp clean design, square 1:1, professional advertising typography. Every text string below must appear EXACTLY as written, perfectly spelled, with NO other words, gibberish or invented text anywhere. Each string appears ONCE and reads as grammatical English — never repeat or stutter a word or phrase inside a sentence ("we still each still got", "first try first try" are failures), never re-render the same line twice. ${productClause}`;
  switch (key) {
    case "callout":
      return `${base} Layout: the product large in the center on a soft solid-color studio background that complements its palette. Four thin dark annotation lines point to different parts of the product, each ending in a small bold label chip reading exactly: "${c.c1}", "${c.c2}", "${c.c3}", "${c.c4}". Bold headline at the top: "${c.headline}". A small rounded button at the bottom center: "${c.cta}".`;
    case "review":
      return `${base} Layout: a large white rounded testimonial card on a soft complementary pastel background. Inside the card: a row of five gold stars, then the quote "${c.quote}" in bold dark serif-ish text, then smaller grey text: "— ${c.name}, Verified Buyer". The product stands at the bottom-right, slightly overlapping the card with a natural soft shadow.`;
    case "chat":
      return `${base} Layout: a smartphone text-message conversation, iMessage style, on a soft neutral background. Four chat bubbles top to bottom: grey left bubble "${c.m1}", blue right bubble "${c.m2}", grey left bubble "${c.m3}", blue right bubble "${c.m4}". Between the second and third bubble, the product appears as a shared picture message with rounded corners. Clean readable phone UI, realistic spacing.`;
    case "versus":
      return `${base} Layout: bold headline at the top: "${c.headline}". Below it a clean two-column comparison: left column header "US" with the product beneath it and three rows each with a green checkmark and exactly: "${c.r1}", "${c.r2}", "${c.r3}". Right column header "THEM", slightly greyed out, three rows each with a red X and exactly: "${c.t1}", "${c.t2}", "${c.t3}".`;
    case "beforeafter":
      return `${base} Layout: a split-screen ad. Left half: slightly desaturated, labeled "BEFORE" in a small chip, caption "${c.before}" — a dull scene missing the product. Right half: bright and vivid, labeled "AFTER" in a small chip, caption "${c.after}" — the product as the hero of a fresh energetic scene. Bold headline across the top spanning both halves: "${c.headline}".`;
    case "offer":
      return `${base} Layout: the product hero-centered on a bold vibrant background that complements its colors, dramatic studio lighting. A large eye-catching starburst badge in the upper right reading exactly: "${c.offer}". Bold headline at the top left: "${c.headline}". A rounded button at the bottom center: "${c.cta}". High-energy sale aesthetic without looking cheap.`;
    case "ugcframe":
      return `${base} Layout: an authentic-feeling customer phone photo of the product on a real table in natural light (slightly imperfect framing, believable home setting). Overlaid at the bottom, a social-video caption bar in bold white text with black outline reading exactly: "${c.caption}". On the right edge, small white heart, comment and share icons stacked vertically. It should look native to a social feed, not like an ad.`;
    case "stat":
      return `${base} Layout: the value "${c.stat}" rendered HUGE — filling most of the upper half in ultra-bold type on a soft complementary background — with "${c.statlabel}" in smaller text directly beneath it. The product stands in the lower right, hero-lit. Small confident headline at the bottom left: "${c.headline}". A rounded button bottom center: "${c.cta}".`;
    case "magazine":
      return `${base} Layout: a glossy premium magazine cover. Masthead across the top in elegant bold letters: "${c.masthead}". The product is the cover star, large and centered with dramatic studio lighting. Two cover lines in editorial type: left side "${c.cover1}", right side "${c.cover2}". A tiny barcode in the bottom corner. Chic fashion-magazine energy.`;
    case "macro":
      return `${base} Layout: three vertical panels side by side, each an EXTREME close-up crop of a different part of the product (its texture, its cap or edge, its label detail) — luxurious macro photography with shallow depth of field. Each panel has a small bold label chip at its base reading exactly: "${c.d1}", "${c.d2}", "${c.d3}".`;
    case "unbox":
      return `${base} Layout: a clean top-down flat-lay on a soft solid background: the product centered, styled like an unboxing spread. Three thin annotation lines point at it and its details, each ending in a small label chip reading exactly: "${c.i1}", "${c.i2}", "${c.i3}". Bold headline across the top: "${c.headline}".`;
    case "founder":
      return `${base} Layout: a warm cream paper note card filling most of the frame, with handwriting-style dark ink text reading exactly: "${c.note}" and beneath it a signature-style line: "— ${c.founder}". The product rests at the bottom right corner of the card with a soft natural shadow. Honest, personal, letter-from-the-maker energy.`;
    case "poll":
      return `${base} Layout: a playful side-by-side choice card. Question in bold at the top: "${c.question}". Two framed options below: LEFT a deliberately dull, generic grey alternative labeled "${c.left}" with an empty circle; RIGHT the product, bright and hero-lit, labeled "${c.right}" with a big green check in its circle. The right side clearly wins.`;
    case "breakout":
      return `${base} Layout: a 3D "breaking out of the feed" ad. Across the middle of the frame sits a GENERIC, UNBRANDED social post card — a plain white horizontal panel with a small round profile circle, the name "${c.handle}" beside it, a row of simple outline icons (heart, speech bubble, paper-plane) and the caption "${c.caption}" in ordinary UI text. Do NOT reproduce any real social network's logo, wordmark, colors or exact interface — it is a generic placeholder card. The product BURSTS OUT of that card in full 3D: rendered large and in front, overflowing well past the card's top and bottom edges, casting a soft realistic drop shadow onto the card so it reads as physically escaping the screen. Behind and around the card, a simple complementary scene or surface. A small rounded button near the bottom: "${c.cta}". Dramatic pop-out depth, photorealistic product, no other text.`;
    case "poster":
      return `${base} Layout: a full-bleed statement poster. The product large and hero-centered with dramatic cinematic studio lighting on a bold solid background that complements its colors. Massive ultra-bold headline across the top: "${c.headline}". A smaller sub-line beneath it: "${c.sub}". A rounded button at the bottom center: "${c.cta}". Award-winning print-advertisement energy.`;
    case "tweet":
      return `${base} Layout: a white social-media post card on a soft pastel background. At the top a small round avatar circle, bold display name "${c.name}" with grey username "${c.handle}" beside it. The post text below in clean dark type: "${c.tweet}". Under the text, the product appears as the post's attached photo with rounded corners. A row of small grey outline icons (heart, repost, share) at the bottom of the card. Realistic social app UI, no other text.`;
    case "search":
      return `${base} Layout: a clean search-engine page on a white background. A large rounded search bar at the top with a magnifier icon and the typed query "${c.query}" with a text cursor. Directly beneath, a dropdown panel of three autocomplete suggestions, each on its own row with a small magnifier: "${c.s1}", "${c.s2}", "${c.s3}". The product stands hero-lit at the bottom right as the obvious answer.`;
    case "notes":
      return `${base} Layout: a phone notes-app screen filling the frame, soft warm paper background. Note title in bold at the top: "${c.title}". Below it four checklist rows, each with a small round checked circle and the text: "${c.n1}", "${c.n2}", "${c.n3}", "${c.n4}". The product appears as a small photo attached at the bottom of the note. Believable notes-app typography.`;
    case "reminder":
      return `${base} Layout: a phone lock screen. Large thin clock digits near the top reading "7:30". Below the clock, a white rounded notification banner with a small app icon square, bold title "${c.alerttitle}" and message text "${c.alertbody}". The wallpaper behind is a softly blurred photo of the product. Realistic phone UI spacing.`;
    case "threereasons":
      return `${base} Layout: bold headline at the top: "${c.headline}". The product hero-lit on the left third. On the right, three stacked rows, each led by a bold number in a filled circle — 1, 2, 3 — followed by the reason text: "${c.w1}", "${c.w2}", "${c.w3}". Clean editorial spacing, confident type.`;
    case "handheld":
      return `${base} Layout: a first-person photo — a real hand holding the product out toward the camera at arm's length, natural daylight, believable casual setting slightly out of focus behind. A small white sticky-note style caption near the bottom reading exactly: "${c.caption}", with a thin hand-drawn arrow pointing from the note to the product.`;
    case "pricemath":
      return `${base} Layout: a bold receipt-style card. Headline at the top: "${c.headline}". The cost line "${c.math}" rendered HUGE in the center in ultra-bold type. The punchline "${c.punchline}" in smaller confident text beneath. The product stands beside the card, hero-lit on a complementary background.`;
    case "faq":
      return `${base} Layout: a large bold question at the top: "${c.question}". Beneath it a white rounded answer card containing a green check mark and the answer text: "${c.answer}". The product hero-lit at the bottom right, slightly overlapping the card with a soft shadow.`;
    case "press":
      return `${base} Layout: a minimalist editorial page with generous whitespace. An oversized decorative quotation mark, then the pull quote in large elegant serif type: "${c.praise}". A small attribution line beneath: "— ${c.outlet}". The product displayed beneath on a simple pedestal with soft gallery lighting.`;
    case "steps":
      return `${base} Layout: headline across the top: "${c.headline}". Three side-by-side panels, each led by a big bold numeral — 1, 2, 3 — showing the product at a different moment of use, with a short caption under each: "${c.step1}", "${c.step2}", "${c.step3}". Clean instructional design that still looks premium.`;
    case "gift":
      return `${base} Layout: a tasteful gift-guide card. A corner ribbon badge reading "${c.badge}". Headline in elegant bold type: "${c.headline}". Sub-line beneath: "${c.sub}". The product centered on a softly textured wrapping-paper background with a thin ribbon running under it. Festive but premium, never tacky.`;
    case "restock":
      return `${base} Layout: the product hero-lit on a clean retail shelf with several empty spots beside it where others clearly sold. Bold headline at the top: "${c.headline}". A small urgent chip near the product: "${c.urgency}". A rounded button at the bottom center: "${c.cta}". Energetic but premium.`;
    case "ingredients":
      return `${base} Layout: the product centered with its raw natural ingredients artfully floating around it in an exploded view, each connected by a thin line to a small label chip reading exactly: "${c.g1}", "${c.g2}", "${c.g3}". Bold headline at the top: "${c.headline}". Soft studio light, premium clean look.`;
    case "checklist":
      return `${base} Layout: bold headline at the top: "${c.headline}". Below it four rows, each with a large green checked checkbox and casual lowercase text: "${c.k1}", "${c.k2}", "${c.k3}", "${c.k4}". The product hero-lit at the bottom right. Clean card design on a soft background.`;
    case "warning":
      return `${base} Layout: an advertorial-style card. A slim attention bar at the top, then the bold headline: "${c.headline}". Below, three numbered rows — 1, 2, 3 — reading exactly: "${c.f1}", "${c.f2}", "${c.f3}". The product stands to the right, hero-lit. Serious editorial tone that still looks premium.`;
    case "routine":
      return `${base} Layout: headline at the top: "${c.headline}". A vertical timeline with two nodes: a sun icon beside "${c.am}", then a moon icon beside "${c.pm}". The product(s) displayed beside the timeline with soft shadows. Calm spa-like palette.`;
    case "testimonialwall":
      return `${base} Layout: three stacked white rounded review cards, each with a row of five small gold stars, a short quote and a name: "${c.tq1}" — ${c.tn1}; "${c.tq2}" — ${c.tn2}; "${c.tq3}" — ${c.tn3}. The product stands at the right edge overlapping the cards with a soft shadow.`;
    case "pov":
      return `${base} Layout: a large bold caption at the top in social-video style white text with subtle dark outline: "${c.pov}". The product in a cozy authentic lifestyle scene filling the frame. Small sub-line near the bottom: "${c.sub}". Feels like a screenshot from a viral video.`;
    case "splitpanel":
      return `${base} Layout: a clean 50/50 vertical split. Left half: the product on a minimal studio background. Right half: the product in a warm real-life scene being used. Headline across the top spanning both halves: "${c.headline}". Sub-line: "${c.sub}". A small button bottom center: "${c.cta}". Catalog-cover polish.`;
    case "seasonal":
      return `${base} Layout: a festive but premium seasonal card — soft snow or seasonal texture in the background. A corner ribbon reading "${c.badge}". Headline in elegant bold type: "${c.headline}". The product centered, warmly lit. A rounded button at the bottom: "${c.cta}".`;
    case "bundle":
      return `${base} Layout: the full kit arranged neatly like a premium flat-lay, the main product centered. Headline at the top: "${c.headline}". Three check-marked rows listing exactly: "${c.b1}", "${c.b2}", "${c.b3}". A rounded button at the bottom: "${c.cta}".`;
    case "minimal":
      return `${base} Layout: extreme luxury minimalism — vast empty background in a single soft tone, the product small and perfectly centered with a delicate shadow. One word in elegant type above it: "${c.word}". A tiny sub-line beneath the product: "${c.sub}". Gallery-poster restraint.`;
    case "neon":
      return `${base} Layout: a dark moody scene, the product hero-lit with a soft colored glow that matches its accents, subtle neon light reflections on a dark surface. Bold glowing headline at the top: "${c.headline}". A small glowing-outline button at the bottom: "${c.cta}".`;
    case "chalkboard":
      return `${base} Layout: a charming cafe A-frame chalkboard sign, hand-chalked lettering reading exactly: "${c.line1}" and beneath it "${c.line2}", with small chalk flourishes. The product sits on a wooden stool beside the sign in warm morning light. Local-shop warmth.`;
    case "speech":
      return `${base} Layout: the product hero-centered with a clean comic-style white speech bubble coming from it reading exactly: "${c.bubble}". Bold headline beneath: "${c.headline}". Soft solid background that complements the product. Playful but premium.`;
    case "statgrid":
      return `${base} Layout: headline at the top: "${c.headline}". Two large stat blocks side by side: "${c.v1}" in huge bold type with "${c.l1}" beneath it, and "${c.v2}" in huge bold type with "${c.l2}" beneath it. The product across the bottom, hero-lit. Engineered, technical-premium look.`;
    case "origin":
      return `${base} Layout: a warm editorial card with a subtle vintage-map or craft-paper texture. Headline in elegant serif: "${c.headline}". A single line beneath: "${c.origin}". The product displayed on natural material (wood, linen or stone) in warm side light. Artisan provenance energy.`;
    case "guarantee":
      return `${base} Layout: the product hero-lit in the center. A bold circular badge beside it reading exactly: "${c.badge}". Headline at the top: "${c.headline}". Sub-line at the bottom: "${c.sub}". Confident, trustworthy design with a strong single accent color.`;
    case "calendar":
      return `${base} Layout: a clean monthly calendar grid with the first three weeks of days marked with bold green checkmarks. Headline at the top: "${c.headline}". Sub-line beneath: "${c.tagline}". The product rests at the bottom right corner over the calendar with a soft shadow.`;
    case "weather":
      return `${base} Layout: the product hero-shot against a dramatic weather backdrop (falling snow, mist or rain matched to the product's purpose), crisp and premium. Bold headline at the top: "${c.headline}". Sub-line: "${c.sub}". A rounded button at the bottom: "${c.cta}".`;
    case "duo":
      return `${base} Layout: two complementary products side by side, angled slightly toward each other like a pair, on a soft complementary background. Headline at the top: "${c.headline}". A small label chip under the left item: "${c.pair1}" and under the right item: "${c.pair2}". A plus sign floats between them.`;
    case "receipt":
      return `${base} Layout: a tall paper receipt filling one side, printed with the item line "${c.item}" and the price "${c.price}", plus a stamped note reading "${c.memo}". Bold headline beside it: "${c.headline}". The product stands next to the receipt, hero-lit. Charming price-anchoring energy.`;
    case "tierlist":
      return `${base} Layout: a ranking card: a large glowing "S" tier badge at the top left with the product sitting proudly on that row. Headline: "${c.headline}". Sub-line: "${c.tagline}". Game-culture aesthetic that still looks clean and premium.`;
    case "swatch":
      return `${base} Layout: the product line-up shown in four color variants side by side, each above a small round color swatch dot with its name in a small chip: "${c.sw1}", "${c.sw2}", "${c.sw3}", "${c.sw4}". Headline at the top: "${c.headline}". Collect-them-all retail energy.`;
    default:
      return base;
  }
}

async function formatCopy(
  formatKey: string,
  fields: string[],
  productTitle: string,
  tone: string | undefined,
  direction: string | undefined,
  contentLang?: string | null,
  merchantOffer?: string | null
): Promise<Record<string, string> | null> {
  try {
    const prompt = [
      `You write short, punchy copy for a "${formatKey}" style e-commerce static ad.${langDirective(contentLang)}`,
      `Product: "${productTitle}".`,
      tone ? `Brand tone: ${tone}.` : "",
      direction ? `Angle: ${direction.slice(0, 160)}.` : "",
      `Return ONLY JSON with exactly these string fields: ${fields.map((f) => `"${f}"`).join(", ")}.`,
      `Field guide: headline ≤ 6 words (a confident statement); c1-c4 are benefit labels of 2-3 words each; cta ≤ 3 words; quote is a believable customer review of 8-13 words (first person, specific, no hype-words like "amazing"); name is a first name + last initial; m1-m4 are casual lowercase text messages of 4-12 words that read like real friends (m2 and m4 are from the person who owns the product); r1-r3 are 2-4 word advantages, t1-t3 the competitor's matching 2-4 word weaknesses; before/after are 3-6 word captions, each a natural phrase a person would say out loud, not a keyword string; offer is a benefit or invitation flash of 2-4 words ("Own the set", "New arrival") and MUST NOT contain a number, a percentage, a currency amount, or the words sale/off/free/save/deal/discount; caption is a lowercase social caption of 6-11 words; sub ≤ 8 words; stat is a REAL product fact as a short number ("300mg", "12", "10 sec") with statlabel 2-4 words — NEVER an invented customer statistic, survey result or percentage of buyers; masthead is the brand or product name, one or two words; cover1/cover2 are witty magazine cover lines ≤ 7 words; d1-d3 are 2-3 word sensory detail labels; i1-i3 are 2-4 word included-item or benefit labels; note is a sincere founder note of 12-16 words, one or two short sentences, with zero hype; founder is "FirstName, founder"; question ≤ 6 words and playful; left is the boring generic alternative in 2-3 words; right is the product's short name; tweet is a casual lowercase first-person post of 10-16 words, specific and funny, no hashtags; handle is @ plus a short lowercase invented username (never a real person); query is a "best <category> for <need>" search of 3-6 words; s1-s3 are autocomplete suggestions that extend the query, 3-6 words; title is a lowercase notes-list title ≤ 6 words; n1-n4 are lowercase checklist items of 3-6 words; alerttitle is the brand or product name; alertbody is a friendly ≤ 10 word nudge; w1-w3 are full reasons of 3-6 words; math is a simple real cost-per-use line like "$0.40 per serving" derived from plausible pricing; punchline ≤ 7 words; answer is a confident specific 6-12 word answer; praise is an editorial one-liner ≤ 12 words in third person; outlet is an INVENTED tasteful publication name of 2-3 words — NEVER a real magazine, newspaper or website; step1-3 are 2-5 word action steps in order; badge is 2-3 words like "Editor's Pick"; urgency is a truthful availability line like "Limited run" or "Restocked today" — NEVER an invented sales number or count; g1-g3 are real ingredient or component names of 1-3 words; k1-k4 are lowercase relatable "that's me" moments of 3-5 words; f1-f3 are punchy truthful product facts of 3-7 words; am starts "Morning:" and pm starts "Night:", each ≤ 6 words after the colon; tq1-tq3 are mini review quotes of 3-6 words with tn1-tn3 as first name + last initial; pov starts "POV:" and is 5-9 words; b1-b3 are included-item lines of 2-5 words; word is ONE powerful word ending in a period; line1/line2 are warm chalkboard lines of 3-6 words; bubble is the product playfully "speaking" in 2-6 words — it must be a natural, grammatical phrase a person would actually say; never force a pun that breaks the sentence; v1/v2 are REAL product spec numbers with l1/l2 as their 2-4 word labels — never invented customer stats; origin is one truthful craft or materials line of 5-10 words (no fake place claims); tagline is a witty 4-8 word line; pair1/pair2 are short names for the two paired items; item is the product's short name, price a plausible price like "$29", memo a lowercase 3-5 word aside; sw1-sw4 are evocative one-or-two-word color names; handle is the brand name in caps, no @ and no invented engagement numbers; caption for the breakout format is a scroll-stopping 5-10 word line.`,
      // The merchant is the ONLY source of a discount. Anything we invent is a
      // promise their shop never agreed to honour.
      merchantOffer
        ? `The merchant IS running this promotion, word for word: "${merchantOffer.slice(0, 60)}". Use it verbatim wherever an offer appears.`
        : `The merchant is NOT running any promotion. NEVER invent a discount, percentage, sale, coupon, price cut, free shipping or any saving. Sell the product on what it IS.`,
      // From a full 49-template sweep: every remaining defect was text. Two of
      // them were written wrong before anything was rendered — an apostrophe
      // dropped ("thats"), and a Versus ad whose two columns contradicted each
      // other. Neither is the image model's fault.
      `Punctuation must be correct — write "that's", "you're", "it's" with apostrophes, never "thats" or "youre".`,
      `Fields that pair up must agree and never contradict: the US column must not claim something the THEM column also claims, before/after must describe the same situation improving, and no two fields may make opposite promises about the same thing.`,
      // The renderer draws this text into a fixed layout, and the sweep's
      // cut-offs ("duplica" for "duplicates") were simply strings too long for
      // the space they were given.
      `Keep every value SHORT. Long strings get cut off mid-word when drawn into the layout, so prefer the low end of each range and never exceed it.`,
      `No emoji, no hashtags, no quotes inside values.`,
    ].filter(Boolean).join("\n");
    const raw = await anthropicText(prompt, { model: "claude-sonnet-5", maxTokens: 300 });
    const m = raw && raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const f of fields) {
      const v = typeof j[f] === "string" ? (j[f] as string).replace(/["“”]/g, "").trim() : "";
      if (!v) return null;
      out[f] = v;
    }
    // Belt and braces on the one field that can promise the merchant's money
    // away: their exact words win, and any invented discount that survived the
    // instruction gets scrubbed rather than shipped.
    if (out.offer) {
      const invented = /\d|%|\$|\b(off|sale|free|save|deal|discount|coupon)\b/i.test(out.offer);
      out.offer = merchantOffer ? merchantOffer.slice(0, 40) : invented ? "Own the set" : out.offer;
    }
    return out;
  } catch { return null; }
}

/** The format rung, end to end: copy → layout → render → QA → one corrective
 *  retry. Extracted so the QA harness (scripts/ad-qa.mts) exercises the SAME
 *  code path merchants hit, rather than a parallel re-implementation that can
 *  drift from it — a harness testing a copy of the pipeline proves nothing.
 *
 *  Deliberately free of the DB, tokens, plans and asset writing that wrap it
 *  in generateImageAd, so it can be run in CI against a product photo alone. */
export interface FormatRunResult {
  imageUrl: string | null;
  copy: Record<string, string> | null;
  prompt: string | null;
  qaPass: boolean;
  qaReason: string;
  retried: boolean;
  /** Set when the rung gave up — the caller falls through to the scene ladder. */
  fallback: string | null;
}

export async function runFormatRung(opts: {
  formatKey: string;
  fields: string[];
  productTitle: string;
  productImageUrl: string;
  tone?: string;
  direction?: string;
  contentLang?: string | null;
  merchantOffer?: string | null;
}): Promise<FormatRunResult> {
  const nil = (fallback: string): FormatRunResult =>
    ({ imageUrl: null, copy: null, prompt: null, qaPass: false, qaReason: "", retried: false, fallback });

  // The merchant PICKED this format. Losing it silently and shipping a generic
  // scene instead is the worst possible outcome, so copy gets a second chance.
  let copy = await formatCopy(opts.formatKey, opts.fields, opts.productTitle, opts.tone, opts.direction, opts.contentLang, opts.merchantOffer);
  if (!copy) copy = await formatCopy(opts.formatKey, opts.fields, opts.productTitle, opts.tone, opts.direction, opts.contentLang, opts.merchantOffer);
  if (!copy) return nil("copy-failed");

  const prompt = formatLayoutPrompt(opts.formatKey, copy);
  // The rejection reason goes into an IMAGE prompt, and the QA reply often
  // quotes the offending words back ('repeated word "still"'). Handing quoted
  // words to an image model is a good way to get them drawn into the picture —
  // the correction becoming the next defect. So the retry gets the CATEGORY of
  // failure, never the reviewer's prose.
  const correction = (reason: string): string => {
    const r = reason.toLowerCase();
    const notes: string[] = [];
    if (/textsensible|repeat|duplicat|stutter|garbl|nonsense/.test(r)) {
      notes.push("the previous attempt rendered a word or phrase twice — write each line ONCE, as clean grammatical English");
    }
    if (/textmatches|missing|cut off|misspell|spell/.test(r)) {
      notes.push("the previous attempt mis-rendered or dropped some of the required text — reproduce every requested string exactly and completely");
    }
    if (/productintact|warp|distort|reinvent|restyl/.test(r)) {
      notes.push("the previous attempt altered the product — keep it pixel-faithful to the reference photo");
    }
    if (/nosourcetext|watermark|badge|caption/.test(r)) {
      notes.push("the previous attempt copied text from the reference photo's background — reproduce only the product itself");
    }
    if (!notes.length) notes.push("the previous attempt was rejected for text quality — render every string once, correctly spelled");
    return ` Retry: ${notes.join("; ")}.`;
  };
  const renderOnce = (fix?: string) => repRun("google/nano-banana", {
    prompt: fix ? `${prompt}${correction(fix)}` : prompt,
    image_input: [opts.productImageUrl],
    output_format: "jpg",
  });

  let imageUrl = await renderOnce();
  let qa = await qaFormat(imageUrl, opts.productImageUrl, Object.values(copy));
  let retried = false;
  if (!qa.pass) {
    // A blind re-roll of the identical prompt repeats the same mistake as often
    // as not. Tell it what went wrong.
    retried = true;
    imageUrl = await renderOnce(qa.reason);
    qa = await qaFormat(imageUrl, opts.productImageUrl, Object.values(copy));
  }
  return {
    imageUrl,
    copy,
    prompt,
    qaPass: qa.pass,
    qaReason: qa.reason,
    retried,
    fallback: qa.pass ? null : `qa-failed: ${qa.reason}`,
  };
}

/** Vision QA for format ads.
 *
 *  Asks each question SEPARATELY and derives pass/fail from the answers.
 *
 *  This used to ask for one combined verdict, and the golden-set harness
 *  showed exactly what that cost: the gate passed 96% of ads while an
 *  independent per-dimension review found a third of them had garbled text.
 *  Same model, same images, same wording about duplicated words — the only
 *  difference was being asked "is this ad OK?" versus being asked "is the
 *  text sensible?" as its own question. A lumped verdict anchors on whether
 *  the ad broadly looks right, and a stutter is easy to miss when it does.
 *
 *  Failing open on an outage is deliberate: a QA hiccup must never turn into
 *  a merchant losing the format they paid for. */
async function qaFormat(imageUrl: string, productImageUrl: string | null, expected: string[]): Promise<{ pass: boolean; reason: string }> {
  try {
    const urls = productImageUrl ? [productImageUrl, imageUrl] : [imageUrl];
    const raw = await anthropicVision(
      [
        productImageUrl
          ? `Image 1 is the real product photo. Image 2 is an ad our system built around that product.`
          : `Judge this generated ad.`,
        `These EXACT text strings were requested: ${expected.slice(0, 10).map((s) => `"${s.slice(0, 90)}"`).join(", ")}.`,
        ``,
        `Answer each field INDEPENDENTLY — do not let a good overall impression carry a field that is actually wrong.`,
        productImageUrl
          ? `productIntact: is the product in the ad the same product as image 1 — same shape, colors, packaging artwork, logos — not warped, restyled or reinvented?`
          : `productIntact: answer true.`,
        `textSensible: does every line of the ad's own text read as grammatical English that makes sense? A repeated word or phrase ("we still each still got", "first try first try") is a FAILURE even though every word in it is spelled correctly. Read each sentence back for SENSE, not spelling.`,
        `textMatches: does the ad's text say the requested strings above — none missing, none cut off mid-word, none invented?`,
        `noSourceText: has any marketing text, watermark, price badge or caption from the SOURCE photo's background been copied into the ad? Answer true if NOT (the product's own packaging text is expected and fine).`,
        `reason: if anything is false, one short phrase naming the worst problem. Otherwise "clean".`,
        ``,
        // The merchant's product may be covered in Chinese, Japanese, Korean or
        // any other script — that is THEIR PACKAGING, not our typography, and
        // judging it as "gibberish" threw away the format the merchant chose
        // and shipped a generic ad instead.
        `IMPORTANT: ignore text printed on the product or its packaging, including non-Latin scripts and small print. Only judge the ad's added layout text. Non-English packaging is never a failure.`,
        `Reply ONLY JSON: {"productIntact":bool,"textSensible":bool,"textMatches":bool,"noSourceText":bool,"reason":"..."}`,
      ].join(" "),
      urls
    );
    const m = raw && raw.match(/\{[\s\S]*\}/);
    if (!m) return { pass: true, reason: "qa-unavailable" };
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const bad = (["productIntact", "textSensible", "textMatches", "noSourceText"] as const)
      .filter((k) => j[k] === false);
    if (!bad.length) return { pass: true, reason: "clean" };
    const why = typeof j.reason === "string" && j.reason ? j.reason : bad.join(", ");
    return { pass: false, reason: `${bad.join("/")}: ${why}`.slice(0, 160) };
  } catch { return { pass: true, reason: "qa-error" }; }
}

/* Self-forged format previews — each tile stars a DIFFERENT EasyMode-branded
 * hero product (skincare, sneakers, coffee, headphones…) from the category
 * that most uses that format, so the picker reads "every product type", not
 * "we make drink ads". v2 = per-format hero products (v1 was all-bottle). */
const FORMAT_PREVIEW_VERSION = 2;
// Per-key bumps (mirrors the tile system): poster v3 composites the canonical
// statue bottle instead of describing a drink in text — one bottle everywhere.
const FORMAT_PREVIEW_KEY_VERSIONS: Record<string, number> = { poster: 3 };
const fpVersion = (key: string) => FORMAT_PREVIEW_KEY_VERSIONS[key] ?? FORMAT_PREVIEW_VERSION;
const formatPreviewInFlight = new Set<string>();

/** Exact current-version check (the serial walker needs "is this one done?",
 *  not the version-fallback lookup the router uses). */
function formatPreviewFileExact(key: string): boolean {
  return fs.existsSync(path.join(AD_TEMPLATE_DIR, `format-${key}-v${fpVersion(key)}.jpg`));
}

export function formatPreviewFile(key: string): string | null {
  // Serve with version fallback: an old preview stands in while the current
  // version forges. ensureFormatPreview checks the exact current version.
  for (let v = fpVersion(key); v >= 1; v--) {
    const p = path.join(AD_TEMPLATE_DIR, `format-${key}-v${v}.jpg`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function ensureFormatPreview(key: string): void {
  const current = path.join(AD_TEMPLATE_DIR, `format-${key}-v${fpVersion(key)}.jpg`);
  if (fs.existsSync(current) || formatPreviewInFlight.has(key) || !process.env.REPLICATE_API_TOKEN) return;
  formatPreviewInFlight.add(key);
  (async () => {
    try {
      const { AD_FORMAT_BY_KEY } = await import("./ad-formats");
      const f = AD_FORMAT_BY_KEY[key];
      if (!f) return;
      // heroRef "statue" → composite the ONE canonical bottle render; never a
      // text-described bottle (text-rendered bottles drift from the brand).
      const useStatue = f.heroRef === "statue";
      const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
      if (useStatue && (!statueFile() || !base)) return; // wait for the statue; self-heal retries
      const prompt = useStatue
        ? formatLayoutPrompt(key, f.preview)
        : formatLayoutPrompt(key, f.preview, f.hero);
      const expected = Object.values(f.preview);
      let buf: Buffer | null = null;
      for (let attempt = 0; attempt < 2 && !buf; attempt++) {
        const input: Record<string, unknown> = { prompt, output_format: "jpg" };
        if (useStatue) input.image_input = [`${base}/ad-templates/statue.png`];
        const url = await repRun("google/nano-banana", input);
        const qa = await qaFormat(url, null, expected);
        // A SECOND failure used to be ignored and the gibberish written anyway,
        // where it sits in the picker forever. Never write art that failed QA:
        // leave the tile unbuilt and let the 10-min self-heal try again.
        if (!qa.pass) {
          artLog("ad-formats", `${key}: preview QA failed (${qa.reason})${attempt === 0 ? " — retrying" : " twice — leaving it for the next tick"}`);
          continue;
        }
        const res = await fetch(url);
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        buf = Buffer.from(await res.arrayBuffer());
      }
      if (!buf) throw new Error("no render");
      fs.mkdirSync(AD_TEMPLATE_DIR, { recursive: true });
      fs.writeFileSync(current, buf);
      artLog("ad-formats", `${key}: preview v${fpVersion(key)} forged OK`);
    } catch (e) {
      artLog("ad-formats", `${key}: preview FAILED — ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    } finally {
      formatPreviewInFlight.delete(key);
    }
  })();
}

export async function ensureAllFormatPreviews(): Promise<void> {
  const { AD_FORMATS } = await import("./ad-formats");
  // ONE preview per call. Firing all 48 at once saturated the per-model rate
  // limit and 429'd paying merchants' image ads; cosmetic art also stands
  // down entirely while merchant work is queued. The 10-min self-heal tick
  // walks the list until it's complete.
  if (await merchantBusy()) return;
  for (const f of AD_FORMATS) {
    if (formatPreviewFileExact(f.key)) continue;
    ensureFormatPreview(f.key);
    return;
  }
}

export function statueFile(): string | null {
  return adTemplateFile("statue");
}

export function ensureAdTemplate(key: string): void {
  if (fs.existsSync(currentTemplateFile("preview", key)) || templateInFlight.has(key)) return;
  if (!process.env.REPLICATE_API_TOKEN) { artLog("ad-templates", `${key}: skipped — REPLICATE_API_TOKEN not set`); return; }
  templateInFlight.add(key);
  (async () => {
    try {
      const { AD_TEMPLATE_BY_KEY } = await import("./ad-templates");
      const t = AD_TEMPLATE_BY_KEY[key];
      if (!t) return;
      const statue = await ensureStatue();
      if (!statue) return;
      fs.mkdirSync(AD_TEMPLATE_DIR, { recursive: true });
      // adTemplateFile("plate") is exact-current-version — the build never
      // inherits a stale plate, or the new preview just re-dresses the old scene.
      let platePath = adTemplateFile("plate", key);
      if (!platePath) {
        const plateUrl = await repRun("black-forest-labs/flux-dev", {
          prompt: `${t.plate}. Iconic award-winning print-advertisement photography quality.`, num_inference_steps: 30, guidance: 3, aspect_ratio: "1:1", output_format: "jpg", output_quality: 92,
        });
        const res = await fetch(plateUrl);
        if (!res.ok) return;
        platePath = currentTemplateFile("plate", key);
        fs.writeFileSync(platePath, Buffer.from(await res.arrayBuffer()));
      }
      // Preview = statue on the plate + placeholder copy (real ads write
      // fresh copy per product — the preview says so).
      const compositeName = await compositeProductStill(platePath, statue);
      if (!compositeName) return;
      const rendersDir = path.join(process.cwd(), "data", "renders");
      const withText = await overlayAdText(rendersDir, compositeName, "Your headline here", "Shop now", "ad text adapts to your product");
      const finalSrc = path.join(rendersDir, withText || compositeName);
      fs.copyFileSync(finalSrc, path.join(AD_TEMPLATE_DIR, `preview-v${AD_TEMPLATE_VERSION}-${key}.jpg`));
      try { fs.rmSync(path.join(rendersDir, compositeName), { force: true }); if (withText) fs.rmSync(finalSrc, { force: true }); } catch { /* tidy */ }
      artLog("ad-templates", `${key}: preview v${AD_TEMPLATE_VERSION} built OK`);
      console.log(`[ad-templates] built ${key}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 300) : String(e);
      artLog("ad-templates", `${key}: FAILED — ${msg}`);
      console.error(`[ad-templates] ${key} build failed:`, msg.slice(0, 160));
    } finally {
      templateInFlight.delete(key);
    }
  })();
}

/* ── Product Highlight cover — a CINEMATIC hero shot of the EASYMODE bottle
 * (the merchant-facing "this is what cinematic product video looks like"
 * tile). Self-forges once; nano-banana keeps the label spelled right. */
const PH_COVER_VERSION = 2; // v2: drink bottle (sport cap, liquid), not a jar
let phCoverInFlight = false;

export function phCoverFile(): string | null {
  const p = path.join(AD_TEMPLATE_DIR, `phcover-v${PH_COVER_VERSION}.jpg`);
  return fs.existsSync(p) ? p : null;
}

export function ensurePhCover(): void {
  if (phCoverFile() || phCoverInFlight || !process.env.REPLICATE_API_TOKEN) return;
  phCoverInFlight = true;
  (async () => {
    try {
      const url = await repRun("google/nano-banana", {
        prompt:
          'Cinematic hero product shot for a premium TV commercial: a tall sleek CLEAR plastic sports hydration drink bottle FILLED with deep EMERALD GREEN liquid, black sport spout cap, condensation droplets on the plastic, the wordmark "EASYMODE" in bold metallic GOLD uppercase letters running VERTICALLY down the label, spelled exactly E-A-S-Y-M-O-D-E. Unmistakably a refreshing DRINK — not a pill bottle, no medicine styling. The bottle stands on a wet glossy black stone pedestal, dramatic golden rim light carving its silhouette, a soft swirl of cool mist at the base, deep emerald-black studio background with a faint warm glow, ultra sharp focus, luxurious big-budget advertising photography, wide landscape composition. No people, no hands, no other text.',
        output_format: "jpg",
      });
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      fs.mkdirSync(AD_TEMPLATE_DIR, { recursive: true });
      fs.writeFileSync(path.join(AD_TEMPLATE_DIR, `phcover-v${PH_COVER_VERSION}.jpg`), Buffer.from(await res.arrayBuffer()));
      artLog("ad-templates", "phcover: cinematic Product Highlight cover forged OK");
    } catch (e) {
      artLog("ad-templates", `phcover: FAILED — ${e instanceof Error ? e.message.slice(0, 200) : e}`);
    } finally {
      phCoverInFlight = false;
    }
  })();
}

export async function ensureAllAdTemplates(): Promise<void> {
  if (await merchantBusy()) return;
  ensurePhCover();
  const { AD_TEMPLATES } = await import("./ad-templates");
  // One template per tick — see ensureAllFormatPreviews for why.
  for (const t of AD_TEMPLATES) {
    if (fs.existsSync(currentTemplateFile("preview", t.key))) continue;
    ensureAdTemplate(t.key);
    return;
  }
}

const BRIGHT_DEFAULT = "Bright, light-filled scene: a fresh clean backdrop in a soft light color that complements the product, generous even daylight-quality lighting, airy and inviting — NOT dark, NOT moody, NOT a black background";

/** SELF-HEALING BACKFILL — image ads forged before durable storage carry
 *  replicate.delivery URLs that expired (~1h), leaving blank cards. Re-forge
 *  a few per worker tick from their stored prompts (~$0.003 each) and point
 *  them at the durable disk. Runs until no dead images remain. */
let lastBackfillScan = 0;
const BACKFILL_EVERY_MS = 10 * 60 * 1000; // worker ticks every ~8s — heal gently

/** Hosts whose delivery URLs expire — replicate AND fal (fal-hosted presenter
 *  stills were invisible to the healer, so they could never be flagged). */
const EXPIRING_HOSTS = ["replicate.delivery", "fal.media", "queue.fal.run", "v3.fal.media"];
const isExpiringUrl = (u?: string) => !!u && EXPIRING_HOSTS.some((h) => u.includes(h));

/** Assets forged before genMeta carry no `method`, and they're the exact
 *  population this healer exists for. Their prompt is unambiguous though: the
 *  product-image ladders all read "Place this exact product…" / "presenter
 *  holding…", while a text-to-image poster describes itself. */
const looksText2img = (p?: string) =>
  !!p && /advertising poster photograph of /i.test(p) && !/place this exact product|presenter holding/i.test(p);

export async function backfillDeadImages(): Promise<void> {
  if (Date.now() - lastBackfillScan < BACKFILL_EVERY_MS) return;
  lastBackfillScan = Date.now();
  const candidates = await db.asset.findMany({
    where: {
      type: "IMAGE_AD",
      OR: EXPIRING_HOSTS.map((h) => ({ bodyJson: { contains: h } })),
      // Already triaged as un-healable — skip, or the same 3 rows fill every
      // tick forever and nothing else ever gets healed.
      NOT: { bodyJson: { contains: '"needsRegen":true' } },
    },
    orderBy: { createdAt: "desc" },
    take: 3, // gentle per tick — burst-limits stay happy
  });
  for (const a of candidates) {
    try {
      const body = JSON.parse(a.bodyJson) as { imageUrl?: string; prompt?: string; sourceUrl?: string; method?: string };
      if (!isExpiringUrl(body.imageUrl)) {
        // contains() matched sourceUrl only — already healed; strip the marker
        await db.asset.update({ where: { id: a.id }, data: { bodyJson: JSON.stringify({ ...body, sourceUrl: undefined }) } });
        continue;
      }
      // Re-forging from the stored prompt only reproduces PROMPT-ONLY ads.
      // A scene ad's prompt is "Place this exact product, unchanged…", a format
      // ad's is a layout brief, a presenter still's is "presenter holding X" —
      // running any of those through flux-schnell with NO product image
      // silently replaced the merchant's ad with a generic, product-less
      // picture. Flag those for regeneration instead of corrupting them.
      const method = body.method || (looksText2img(body.prompt) ? "text2img" : "");
      if (method !== "text2img" && method !== "lifestyle") {
        await db.asset.update({
          where: { id: a.id },
          data: { bodyJson: JSON.stringify({ ...body, needsRegen: true, healSkipped: method || "unknown" }) },
        });
        console.log(`[image-backfill] asset ${a.id} (${method || "unknown"}) can't be re-forged from its prompt — flagged for regeneration`);
        continue;
      }
      const prompt = body.prompt || "clean product photography, professional advertising quality, 1:1, vibrant colors";
      const localUrl = await fluxToDisk(prompt);
      await db.asset.update({
        where: { id: a.id },
        data: { bodyJson: JSON.stringify({ ...body, imageUrl: localUrl, sourceUrl: undefined, healed: true }) },
      });
      console.log(`[image-backfill] healed asset ${a.id}`);
    } catch (e) {
      console.error(`[image-backfill] asset ${a.id} failed (will retry next tick):`, e instanceof Error ? e.message : e);
    }
  }
}

/** Generate with flux-schnell and persist straight to the durable disk. */
async function fluxToDisk(prompt: string): Promise<string> {
  const replicateToken = process.env.REPLICATE_API_TOKEN;
  if (!replicateToken) throw new Error("REPLICATE_API_TOKEN not set");
  const createRes = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: { Authorization: `Bearer ${replicateToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      version: "5f24084160c9089501c1b3545d9be3c27883ae2239b6f412990e82d4a6210f8f",
      input: { prompt, num_inference_steps: 4, width: 1024, height: 1024 },
    }),
  });
  if (!createRes.ok) throw new Error(`Replicate create failed: ${createRes.status}`);
  const prediction = (await createRes.json()) as { id: string };
  let imageUrl: string | null = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: { Authorization: `Bearer ${replicateToken}` },
    });
    const pollData = (await pollRes.json()) as { status: string; output?: string[] | null; error?: string };
    if (pollData.status === "succeeded" && pollData.output) {
      imageUrl = Array.isArray(pollData.output) ? pollData.output[0] : pollData.output;
      break;
    }
    if (pollData.status === "failed") throw new Error(`Replicate generation failed: ${pollData.error}`);
  }
  if (!imageUrl) throw new Error("Replicate timed out");
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5_000) throw new Error("image too small");
  const dir = path.join(process.cwd(), "data", "renders");
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  fs.writeFileSync(path.join(dir, fileName), buf);
  try { await mirrorRender(fileName, buf); } catch { /* non-fatal */ }
  return `/renders/${fileName}`;
}

const PLAN_VISUAL_DIRECTION: Record<string, string> = {
  GROW_SALES: "lifestyle product shot, natural lighting, aspirational mood, conversion-optimized",
  LAUNCH_PRODUCT: "bold hero shot, dramatic lighting, excitement and novelty, launch energy",
  CLEAR_INVENTORY: "clean product on white, urgency cues, sale badge aesthetic",
  BUILD_AWARENESS: "brand story visual, emotional resonance, people + product, editorial style",
};

/** Render a single AD-FORMAT still and return its URL — no asset, no tokens.
 *  The video pipeline uses this to build a Breakout keyframe (the product
 *  bursting out of a mock post card) before animating it, so the motion ad and
 *  the image ad share one definition of the look. Returns null on any failure;
 *  callers fall back to the plain product photo. */
export async function renderFormatFrame(
  formatKey: string,
  productTitle: string,
  productImageUrl: string,
  tone?: string,
  direction?: string,
  contentLang?: string | null
): Promise<string | null> {
  try {
    const { AD_FORMAT_BY_KEY } = await import("./ad-formats");
    const f = AD_FORMAT_BY_KEY[formatKey];
    if (!f) return null;
    const copy = await formatCopy(f.key, f.fields, productTitle, tone, direction, contentLang);
    if (!copy) return null;
    const prompt = formatLayoutPrompt(f.key, copy);
    const url = await repRun("google/nano-banana", { prompt, image_input: [productImageUrl], output_format: "jpg" });
    artLog("image-ad", `format ${f.key}: keyframe rendered for a video ad`);
    return url;
  } catch (e) {
    artLog("image-ad", `format ${formatKey}: video keyframe failed — ${e instanceof Error ? e.message.slice(0, 120) : e}`);
    return null;
  }
}

export async function generateImageAd(
  shopId: string,
  brandProfile: BrandProfile,
  plan: Plan,
  productTitle: string,
  productImageUrl?: string,
  stylePrompt?: string,
  avatarId?: string,
  avatarVariant?: number,
  wear?: boolean,
  scene?: string,
  serviceMode?: boolean,
  styleMode?: "backdrop" | "scene",
  templateKey?: string,
  formatKey?: string,
  /** A promotion the merchant says they ARE running. Nothing else may put an
   *  offer on an ad — see formatCopy. */
  merchantOffer?: string,
  /** Merchant's explicit size class; beats the inferred one. */
  productSize?: string
): Promise<string> {
  // Generate copy in the shop's content language (web toggle / store locale).
  const contentLang = (await db.shop.findUnique({ where: { id: shopId }, select: { contentLang: true } }))?.contentLang;
  // PRESENTER STILL — an avatar holding the product (Content Studio presenter
  // path). Uses the same two-image compose engine as UGC video frames. Needs a
  // real product photo; falls through to the product still if unavailable.
  // Services have nothing to hold → skip straight to the outcome scene.
  if (!serviceMode && avatarId && productImageUrl && /^https?:\/\//.test(productImageUrl)) {
    try {
      const { falImageEnabled } = await import("./fal-image.server");
      if (falImageEnabled()) {
        const { resolvePortraitFile } = await import("./ugc-ad-pipeline.server");
        const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
        const portraitUrl = `${base}/avatars/${path.basename(resolvePortraitFile(avatarId, avatarVariant || 0))}`;
        const { inferProductScale, scaleFromChoice } = await import("./product-scale.server");
        const scaleHint = scaleFromChoice(productSize) || (await inferProductScale(productTitle, stylePrompt));

        // THE SHOT LIBRARY. The presenter × product composite is the one
        // genuinely risky generative step in this pipeline, so it runs ONCE:
        // the first gate-passed frame for a pair is frozen on disk and every
        // later ad for the same pair reuses it — fresh copy overlay, zero
        // compose/QA spend, zero new chance of drift. This is how the big
        // creators' tools all work (generate once, human-gate, freeze).
        const { shotLibraryEnabled, presenterShotKey, findPresenterShot, savePresenterShot } =
          await import("./presenter-shots.server");
        const layout = presenterLayout(scaleHint?.sizeClass, wear);
        const shotKey = presenterShotKey(avatarId, avatarVariant || 0, productImageUrl, layout);
        const cachedShot = shotLibraryEnabled() ? await findPresenterShot(shopId, shotKey) : null;

        let buf: Buffer | null = null;
        let fileName = "";
        let composed: string | undefined;
        let freezeReason: string | undefined; // set only for a fresh gate-passed frame
        if (cachedShot) {
          buf = cachedShot.buf;
          fileName = cachedShot.fileName;
          artLog("image-ad", `presenter shot library: reusing the frozen ${layout} shot for this presenter — instant, no generation`);
        } else {
          const held = await runPresenterHold({
            portraitUrl, productImageUrl, productTitle, wear, scene,
            scalePhrase: scaleHint?.phrase, sizeClass: scaleHint?.sizeClass,
          });
          if (!held.pass) artLog("image-ad", `presenter hold: ${held.reason}${held.retried ? " (after a retry)" : ""}`);
          // A presenter holding something that merely RESEMBLES the product is
          // the complaint this whole path exists to answer, and until now the
          // gate only wrote a log line before shipping the frame anyway. Two
          // composes and a paste have already had their turn; if the thing in
          // his hands still isn't the merchant's item, fall through to the
          // product still, which is the real photograph.
          composed = held.wrongProduct ? undefined : (held.url || undefined);
          if (held.wrongProduct) {
            artLog("image-ad", `presenter hold: not the merchant's product (${held.failed.join(", ")}) — shipping a product still instead`);
          }
          if (composed) {
            // fal delivery URLs expire in ~an hour and the healer can't re-forge
            // a presenter still from its prompt — storing the raw fal URL means
            // a card that goes permanently blank. Try a few times, then let the
            // ladder deliver a product still instead of a dying link.
            // A pasted composite is already on our own disk; re-fetching it
            // over HTTP from ourselves is a round trip that can only fail.
            let fresh: Buffer | null = held.localPath && fs.existsSync(held.localPath) ? fs.readFileSync(held.localPath) : null;
            let res: Response | null = null;
            for (let i = 0; i < 3 && !fresh && !res?.ok; i++) {
              if (i) await new Promise((r) => setTimeout(r, 1500));
              res = await fetch(composed).catch(() => null);
            }
            if (fresh || res?.ok) {
              fresh = fresh || Buffer.from(await res!.arrayBuffer());
              if (fresh.length > 5_000) {
                buf = fresh;
                if (held.pass && !held.wrongProduct) freezeReason = held.reason;
              }
            }
          }
        }
        if (buf) {
          let localUrl = "";
          try {
            const dir = path.join(process.cwd(), "data", "renders");
            fs.mkdirSync(dir, { recursive: true });
            if (!fileName) {
              fileName = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
              fs.writeFileSync(path.join(dir, fileName), buf);
              try { await mirrorRender(fileName, buf); } catch { /* non-fatal */ }
              if (freezeReason !== undefined) {
                // Freeze the CLEAN composite (pre text-overlay) so every
                // reuse can carry its own headline and CTA.
                await savePresenterShot({ shopId, cacheKey: shotKey, avatarId, layout, fileName, gateReason: freezeReason });
                artLog("image-ad", "presenter shot library: froze this gate-passed shot — future ads for this pair are instant");
              }
            }
            localUrl = `/renders/${fileName}`;
            // Overlay headline + CTA (best-effort) so the presenter still is a real ad.
            try {
              const voiceTone = (() => { try { return JSON.parse(brandProfile.voiceJson || "{}").tone as string | undefined; } catch { return undefined; } })();
              // Retry once: a single flaky copy call was the difference
              // between a presenter still that carries our poster headline
              // and one that ships bare. "Sometimes" is not a standard.
              let copy = await adCopy(productTitle, voiceTone, stylePrompt, false, contentLang);
              if (!copy) copy = await adCopy(productTitle, voiceTone, stylePrompt, false, contentLang);
              if (!copy) artLog("image-ad", "presenter still: ad copy failed twice — shipping without the poster overlay");
              if (copy) {
                const adName = await overlayAdText(dir, fileName, copy.headline, copy.cta, copy.sub);
                if (adName) { localUrl = `/renders/${adName}`; try { await mirrorRender(adName, fs.readFileSync(path.join(dir, adName))); } catch { /* non-fatal */ } }
              }
            } catch (e) { console.error("[image-ad] presenter overlay skipped:", e instanceof Error ? e.message : e); }
          } catch (e) { console.error("[image-ad] presenter still persist failed:", e); }
          // No durable copy → don't mint a card that dies in an hour; the
          // ladder below still delivers a real (product) ad for this job.
          if (!localUrl) throw new Error("[image-ad] presenter still could not be persisted (fal url expires and can't be healed)");
          const asset = await db.asset.create({
            data: {
              shopId, type: "IMAGE_AD", status: "PENDING",
              title: `${productTitle} — held by presenter`,
              bodyJson: JSON.stringify({ imageUrl: localUrl, sourceUrl: composed || null, prompt: `presenter holding ${productTitle}`, method: "presenter", avatarId, shotReused: !!cachedShot }),
              metaJson: JSON.stringify({
                campaignGoal: plan.campaignGoal, productTitle, avatarId,
                avatarVariant: avatarVariant ?? 0,
                productImageUrl: productImageUrl || null,
                direction: stylePrompt || null,
                wear: !!wear,
              }),
            },
          });
          return asset.id;
        }
      }
    } catch (e) {
      console.error("[image-ad] presenter compose failed, falling back to product still:", e instanceof Error ? e.message : e);
    }
    // fall through to a normal product still if compose is unavailable/failed
  }

  const visual = JSON.parse(brandProfile.visualJson);
  const direction =
    PLAN_VISUAL_DIRECTION[plan.campaignGoal] || PLAN_VISUAL_DIRECTION.GROW_SALES;

  const replicateToken = process.env.REPLICATE_API_TOKEN;
  if (!replicateToken) throw new Error("REPLICATE_API_TOKEN not set");

  const jsonHeaders = { Authorization: `Bearer ${replicateToken}`, "Content-Type": "application/json" };
  const hasProductImg = !serviceMode && !!productImageUrl && /^https?:\/\//.test(productImageUrl);

  // SERVICE / offer → there's no product to photograph, so we sell the OUTCOME:
  // an aspirational lifestyle scene of someone enjoying the result. Text-heavy
  // "offer cards" render as garbled glyphs in diffusion models, so we stay
  // photoreal and let the caption carry the words.
  // The prompt actually used, captured across branches so it can be stored on
  // the asset. (A prior version referenced a block-scoped `prompt` at asset
  // creation, which threw ReferenceError in the Node worker and failed every
  // non-presenter image ad.)
  let usedPrompt = "";
  let imageUrl: string | null = null; // remote result (downloaded + persisted below)
  let localFileName: string | null = null; // photo-true composite, already on disk
  const genMeta: Record<string, unknown> = {};

  if (serviceMode) {
    usedPrompt = `${stylePrompt ? `${stylePrompt}. ` : ""}Premium lifestyle advertising photograph that sells the OUTCOME of "${productTitle}". ${stylePrompt ? "" : `${direction}. `}Show a happy, successful person clearly enjoying the benefit or result — aspirational, authentic, relatable, bright warm natural lighting (never dark or moody unless the style asks for it). ${visual.imageStyle || "clean modern commercial photography"}. Poster-ready composition: subject in the lower two-thirds with clean uncluttered space across the top of the frame for a headline. Photorealistic, sharp focus, natural realistic human anatomy and faces, flawless proportions, magazine-quality. Absolutely NO text, letters, words, watermarks, logos, charts, graphs or app screenshots.`;
    // Only rung on this path — an unretried blip here terminal-failed a paid ad.
    imageUrl = await fluxDevStill(usedPrompt, "service-outcome");
    genMeta.method = "lifestyle";
  } else if (hasProductImg) {
    const wantBright = !stylePrompt || !/deliberately dark|noir|dark charcoal/i.test(stylePrompt);
    const mode: "backdrop" | "scene" = styleMode === "scene" || styleMode === "backdrop" ? styleMode : inferStyleMode(stylePrompt);
    const styleDesc = stylePrompt || BRIGHT_DEFAULT;

    // RUNG -1 — AD FORMAT: a genuinely different creative COMPOSITION
    // (callouts / review card / text convo / versus / before-after / offer /
    // feed-native). Claude writes exact copy, nano-banana builds the layout
    // around the real product photo, vision QA rejects gibberish or a warped
    // product with one retry. Any failure falls through the normal ladder.
    if (formatKey && formatKey !== "poster") {
      try {
        const { AD_FORMAT_BY_KEY } = await import("./ad-formats");
        const f = AD_FORMAT_BY_KEY[formatKey];
        if (f) {
          const voiceTone = (() => { try { return JSON.parse(brandProfile.voiceJson || "{}").tone as string | undefined; } catch { return undefined; } })();
          const r = await runFormatRung({
            formatKey: f.key, fields: f.fields, productTitle, productImageUrl: productImageUrl!,
            tone: voiceTone, direction: stylePrompt, contentLang, merchantOffer,
          });
          if (r.qaPass && r.imageUrl) {
            imageUrl = r.imageUrl;
            usedPrompt = r.prompt || usedPrompt;
            genMeta.method = `format:${f.key}`;
            genMeta.formatCopy = r.copy;
            artLog("image-ad", `format ${f.key}: rendered OK${r.retried ? " (on retry)" : ""}`);
          } else {
            imageUrl = null; // fall through to the ladder — never ship garbled text
            genMeta.formatFallback = r.fallback || "unknown";
            artLog("image-ad", `format ${f.key}: ${r.fallback} — falling back to a scene ad`);
            console.log(`[image-ad] format ${f.key} failed (${r.fallback}) — falling to ladder`);
          }
        }
      } catch (e) {
        imageUrl = null;
        genMeta.formatFallback = `error: ${e instanceof Error ? e.message.slice(0, 120) : e}`;
        artLog("image-ad", `format ${formatKey}: render failed (${e instanceof Error ? e.message.slice(0, 120) : e}) — falling back to a scene ad`);
        console.error("[image-ad] format rung failed, falling to ladder:", e instanceof Error ? e.message.slice(0, 160) : e);
      }
    }

    // RUNG 0 — AD TEMPLATE: the merchant picked a statue-preview template, so
    // deliver EXACTLY what the preview showed. Exact templates composite the
    // real product cutout onto the same plate the preview used; staged
    // templates re-stage the scene with the identity model + QA.
    if (!imageUrl && !localFileName && templateKey) {
      try {
        const { AD_TEMPLATE_BY_KEY } = await import("./ad-templates");
        const t = AD_TEMPLATE_BY_KEY[templateKey];
        const platePath = t ? adTemplateFile("plate", t.key) : null;
        if (t && !platePath) ensureAdTemplate(t.key); // build for next time; fall through this run
        // Merchant tweak text on an exact template → re-stage the same scene
        // with the edits applied (a composite can't repaint the wall).
        if (t && platePath && t.kind === "exact" && !stylePrompt) {
          const cutout = await removeBackground(productImageUrl!);
          if (cutout) {
            const fn = await compositeProductStill(platePath, cutout);
            if (fn) { usedPrompt = t.plate; localFileName = fn; genMeta.method = `template:${t.key}`; }
          }
        } else if (t && platePath) {
          const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
          const plateUrl = base ? `${base}/ad-templates/plate-${t.key}.jpg` : null;
          usedPrompt = `Recreate the FIRST image's scene exactly — same composition, lighting, colors and style — with the SECOND image's product ${t.placement || "placed naturally as the hero"}.${stylePrompt ? ` Apply this one change the merchant asked for: ${stylePrompt.slice(0, 200)}.` : ""} The product stays identical to its photo: same shape, colors, logos and details, at its TRUE real-world scale. Any hands shown are anatomically correct with five fingers. Photorealistic, magazine-quality, no added text or watermark.`;
          const stagedOnce = async (): Promise<string> => {
            const inputs = plateUrl ? [plateUrl, productImageUrl] : [productImageUrl];
            try { return await repRun("google/nano-banana", { prompt: usedPrompt, image_input: inputs, output_format: "jpg" }); }
            catch { return await repRun("black-forest-labs/flux-kontext-pro", { prompt: `${t.plate}. ${usedPrompt}`, input_image: productImageUrl, aspect_ratio: "1:1", output_format: "jpg" }); }
          };
          imageUrl = await stagedOnce();
          let qa = await qaFidelity(productImageUrl!, imageUrl, true);
          if (!qa.pass) {
            console.log(`[image-ad] template QA rejected (${qa.reason}) — retrying`);
            imageUrl = await stagedOnce();
            qa = await qaFidelity(productImageUrl!, imageUrl, true);
          }
          genMeta.method = `template-staged:${t.key}`;
          genMeta.qa = qa;
          if (!qa.pass) {
            // deterministic last resort: exact composite on the plate
            const cutout = await removeBackground(productImageUrl!);
            const fn = cutout ? await compositeProductStill(platePath, cutout) : null;
            if (fn) {
              usedPrompt = t.plate; localFileName = fn; imageUrl = null; genMeta.method = `template-fallback:${t.key}`;
              // The staged take was DISCARDED — its failing verdict must not
              // travel with the composite that shipped instead (which was never
              // QA'd, and can't be wrong: the product is never redrawn).
              genMeta.qa = { pass: true, reason: "photo-true composite (staged take rejected)" };
              genMeta.rejectedQa = qa;
            }
          }
        }
      } catch (e) {
        console.error("[image-ad] template rung failed, falling to ladder:", e instanceof Error ? e.message.slice(0, 160) : e);
      }
    }

    // RUNG 1 — PHOTO-TRUE: the real photo composited onto a generated empty
    // backdrop. The product cannot be wrong because it is never redrawn.
    if (!localFileName && !imageUrl && mode === "backdrop") {
      try {
        const cutout = await removeBackground(productImageUrl!);
        if (cutout) {
          const bgPrompt = `Empty advertising backdrop photograph — ${styleDesc}. ${direction}. Completely empty scene: NO products, NO objects, NO people — just a beautiful empty display area (clean surface, tabletop or seamless floor) across the lower third where a product will be placed, and clean uncluttered space across the top for a headline. ${visual.imageStyle || "clean professional product photography"}. Photorealistic, magazine-quality, soft believable ground shadow area, no text, no watermark.`;
          const bgUrl = await fluxDevStill(bgPrompt, "photo-true-backdrop");
          const fn = await compositeProductStill(bgUrl, cutout);
          if (fn) {
            usedPrompt = bgPrompt;
            localFileName = fn;
            imageUrl = bgUrl; // stored as sourceUrl for the backfill healer
            genMeta.method = "photo-true";
          }
        }
      } catch (e) {
        console.error("[image-ad] photo-true rung failed, falling to scene gen:", e instanceof Error ? e.message.slice(0, 160) : e);
      }
    }

    // RUNG 2 — SCENE: identity-strongest editor + vision QA with one retry.
    if (!localFileName && !imageUrl) {
      usedPrompt = `Place this exact product, unchanged, as the hero of a premium advertising poster photograph. ${styleDesc}. ${direction}. ${visual.imageStyle || "clean professional product photography"}. Print-ad composition: the product commanding the lower two-thirds of the frame, clean uncluttered space across the top for a headline. Keep the product identical in shape, color, materials, logos and every detail, at its TRUE real-world scale — never shrunk, never turned into a different object. Any hands shown are anatomically correct with five fingers. Photorealistic, magazine-quality commercial photography, sharp focus, no added text or watermark.`;
      const genOnce = async (): Promise<string> => {
        try {
          return await repRun("google/nano-banana", { prompt: usedPrompt, image_input: [productImageUrl], output_format: "jpg" });
        } catch (e) {
          console.log("[image-ad] nano-banana unavailable, using kontext:", e instanceof Error ? e.message.slice(0, 120) : e);
          return await repRun("black-forest-labs/flux-kontext-pro", { prompt: usedPrompt, input_image: productImageUrl, aspect_ratio: "1:1", output_format: "jpg" });
        }
      };
      // Backdrop composite from the real cutout — the deterministic degrade
      // used both by the QA-failure path and by the catch below.
      const backdropComposite = async (stage: string): Promise<boolean> => {
        const cutout = await removeBackground(productImageUrl!);
        if (!cutout) return false;
        const bgPrompt = `Empty advertising backdrop photograph — ${styleDesc}. ${direction}. Completely empty scene: NO products, NO objects, NO people — just a beautiful empty display area across the lower third, clean space at the top for a headline. Photorealistic, magazine-quality, no text, no watermark.`;
        const bgUrl = await fluxDevStill(bgPrompt, stage);
        const fn = await compositeProductStill(bgUrl, cutout);
        if (!fn) return false;
        usedPrompt = bgPrompt;
        localFileName = fn;
        imageUrl = bgUrl;
        return true;
      };

      // THIS RUNG ALWAYS RUNS on the most common path and, unlike every rung
      // above it, used to have NO catch: a kontext 5xx or repRun's 120s timeout
      // escaped generateImageAd and terminal-failed an ad the merchant paid for.
      // Degrade through the product-true composite, then a plain poster, and
      // only throw when even that fails (then the queue refunds).
      try {
        imageUrl = await genOnce();
        genMeta.method = "scene";
        let qa = await qaFidelity(productImageUrl!, imageUrl, wantBright);
        if (!qa.pass) {
          console.log(`[image-ad] QA rejected first take (${qa.reason}) — retrying`);
          imageUrl = await genOnce();
          qa = await qaFidelity(productImageUrl!, imageUrl, wantBright);
          genMeta.qaRetried = true;
        }
        genMeta.qa = qa;
        // Still failing? Last rung: photo-true composite so the merchant gets a
        // product-accurate ad instead of a warped one.
        if (!qa.pass && mode === "scene") {
          try {
            if (await backdropComposite("photo-true-fallback")) {
              genMeta.method = "photo-true-fallback";
              // the shipped image is the composite, not the QA'd scene take
              genMeta.qa = { pass: true, reason: "photo-true composite (scene take rejected)" };
              genMeta.rejectedQa = qa;
            }
          } catch { /* ship the best scene take — merchant reviews before posting */ }
        }
      } catch (e) {
        console.error("[image-ad] scene rung failed — degrading rather than failing the job:", e instanceof Error ? e.message.slice(0, 160) : e);
        imageUrl = null;
        genMeta.degradedFrom = "scene";
        genMeta.degradeReason = e instanceof Error ? e.message.slice(0, 200) : String(e);
        try {
          if (await backdropComposite("scene-degrade-backdrop")) genMeta.method = "photo-true-degraded";
        } catch (e2) {
          console.error("[image-ad] degrade to photo-true failed too:", e2 instanceof Error ? e2.message.slice(0, 160) : e2);
        }
        if (!localFileName) {
          // Nothing product-true available. A clean generated poster still beats
          // a terminal failure; if THIS throws the job fails and refunds.
          usedPrompt = `${stylePrompt ? `${stylePrompt}. ` : `${BRIGHT_DEFAULT}. `}Premium advertising poster photograph of ${productTitle}. ${direction}. ${visual.imageStyle || "clean professional product photography"}. Print-ad composition: the product commanding the lower two-thirds of the frame, clean uncluttered space across the top for a headline. Photorealistic, sharp focus, magazine-quality commercial photography, no text, no watermark, no logo, no distortion.`;
          imageUrl = await fluxDevStill(usedPrompt, "scene-degrade-poster");
          genMeta.method = "text2img-degraded";
        }
      }
    }
  } else {
    usedPrompt = `${stylePrompt ? `${stylePrompt}. ` : `${BRIGHT_DEFAULT}. `}Premium advertising poster photograph of ${productTitle}. ${direction}. ${visual.imageStyle || "clean professional product photography"}. Print-ad composition: the product commanding the lower two-thirds of the frame, clean uncluttered space across the top for a headline. Photorealistic, ultra high resolution, sharp focus, natural realistic human anatomy and faces, flawless proportions, magazine-quality commercial photography, no text, no watermark, no logo, no distortion.`;
    // Only rung on this path (no product photo) — retry rather than fail the job.
    imageUrl = await fluxDevStill(usedPrompt, "text2img");
    genMeta.method = "text2img";
  }

  if (!imageUrl && !localFileName) throw new Error("Image generation produced no output");

  // Replicate delivery URLs EXPIRE (~1h) — ads were going blank in the queue
  // and auto-posting would fetch a dead link days later. Persist the bytes to
  // the durable renders disk and serve our own URL, like videos. Photo-true
  // composites are already on disk.
  const dir = path.join(process.cwd(), "data", "renders");
  fs.mkdirSync(dir, { recursive: true });
  let fileName: string | null = localFileName;
  let localUrl = imageUrl || "";
  if (!fileName && imageUrl) {
    try {
      const res = await fetch(imageUrl);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 5_000) {
          fileName = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
          fs.writeFileSync(path.join(dir, fileName), buf);
        }
      }
    } catch (e) {
      console.error("[image-ad] persist failed, keeping remote url:", e);
    }
  }
  if (fileName) {
    try { await mirrorRender(fileName, fs.readFileSync(path.join(dir, fileName))); } catch { /* non-fatal */ }
    localUrl = `/renders/${fileName}`;
    // Make it an actual AD: overlay a headline + CTA. Best-effort — if the
    // copy or the ffmpeg composite fails, we keep the clean still.
    // FORMAT ads already carry their own typography — never double-text them.
    const isFormatAd = typeof genMeta.method === "string" && genMeta.method.startsWith("format:");
    if (!isFormatAd) try {
      const voiceTone = (() => { try { return JSON.parse(brandProfile.voiceJson || "{}").tone as string | undefined; } catch { return undefined; } })();
      const copy = await adCopy(productTitle, voiceTone, stylePrompt, !!serviceMode, contentLang);
      if (copy) {
        const adName = await overlayAdText(dir, fileName, copy.headline, copy.cta, copy.sub);
        if (adName) {
          localUrl = `/renders/${adName}`;
          try { await mirrorRender(adName, fs.readFileSync(path.join(dir, adName))); } catch { /* non-fatal */ }
        }
      }
    } catch (e) { console.error("[image-ad] text overlay skipped:", e instanceof Error ? e.message : e); }
  }

  const asset = await db.asset.create({
    data: {
      shopId,
      type: "IMAGE_AD",
      status: "PENDING",
      title: `Ad image for ${productTitle}`,
      bodyJson: JSON.stringify({ imageUrl: localUrl, sourceUrl: imageUrl, prompt: usedPrompt, ...genMeta }),
      // Everything a REMIX needs to rebuild this ad. Without the photo here,
      // remixing regenerated from the title alone — which is the AI-slop path
      // we closed in the Studio, quietly reachable from the Remix button.
      metaJson: JSON.stringify({
        campaignGoal: plan.campaignGoal,
        productTitle,
        productImageUrl: productImageUrl || null,
        formatKey: formatKey || null,
        templateKey: templateKey || null,
        direction: stylePrompt || null,
        serviceMode: !!serviceMode,
        styleMode: styleMode || null,
      }),
    },
  });

  return asset.id;
}
