import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { db } from "../db.server";
import type { BrandProfile, Plan } from "@prisma/client";
import { mirrorRender } from "./object-storage.server";
import { trimToWord } from "./text-trim";
import { CLAIMS_GUARDRAIL, stripPromoTag, dropOrgEndorsementPossessive } from "./ad-claims";
import { anthropicText, anthropicVision } from "./anthropic.server";
import { artLog } from "./art-log.server";
import { merchantBusy, releaseArtSlot, takeArtSlot } from "./art-throttle.server";
import { findCorruptedWord } from "./text-gate";
import { hasCJK, langDirective } from "./content-lang";
import { tidyAdCopy } from "./ad-copy-tidy";
import { occupiedPlate } from "./plate-scene";
import { parseGateVerdict, outageReason } from "./gate-verdict";
import { presenterSprayEnabled } from "./feature-flags.server";

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
    // This poster/scene path is the fallback the whole studio lands on — every
    // format null-gates to it, so it must carry the SAME grounding discipline as
    // formatCopy, not less. It did not, and a prod QA sweep showed the gap: a
    // "– Comic-Con Pick" curation tag in the title came back as "COMIC-CON'S
    // PICK", "COMIC-CON'S FAVORITE", "COMIC-CON'S MOST WANTED" on 9 of 14 texted
    // renders — an invented event endorsement + superlative on a reseller item.
    // Strip the store's promo tag from the title BEFORE the model sees it (so it
    // never has "Comic-Con" to inflate), and attach the shared claims guardrail.
    const title = stripPromoTag(productTitle);
    const prompt = [
      `Write poster-style ad copy to overlay on a ${serviceMode ? "service/offer" : "product"} image ad — think award-winning print ads: a bold STATEMENT headline that stops the scroll, not a generic tagline.${langDirective(contentLang)}`,
      `${serviceMode ? "Offer" : "Product"}: "${title}".`,
      tone ? `Brand tone: ${tone}.` : "",
      direction ? `Angle: ${direction.slice(0, 160)}.` : "",
      `Return ONLY JSON: {"headline":"...","sub":"...","cta":"..."}.`,
      `headline: 3 to 7 words, a confident, witty or provocative STATEMENT (a period at the end is allowed and often stronger).`,
      `sub: MAX 8 words, one small supporting line that lands the benefit — or "" if the headline says it all.`,
      `cta: MAX 3 words (e.g. "Shop now", "Get yours", "Start free").`,
      `NEVER invent a discount, percentage, sale, coupon or saving — we do not know whether this merchant is running one, and a made-up offer is a promise their shop never agreed to honour.`,
      CLAIMS_GUARDRAIL,
      `No quotes, emoji, or hashtags inside the values.`,
    ].filter(Boolean).join("\n");
    const raw = await anthropicText(prompt, { model: "claude-sonnet-5", maxTokens: 160 });
    const m = raw && raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]) as { headline?: string; sub?: string; cta?: string };
    // THE APOSTROPHE WAS BEING DELETED RIGHT HERE.
    //
    // This character class contained the apostrophe, so every one the model
    // was just instructed to write got stripped on the way out: won’t left
    // this function as wont and was drawn into the image that way. A live ad
    // in the Archive reads FINALLY A CAKE THAT WONT CRUMBLE, and the prompt
    // was never at fault.
    //
    // Only the DOUBLE quotes need removing, because they would show up as
    // stray marks in the layout. Curly single quotes are folded to a straight
    // one rather than dropped — image models render that fine.
    //
    // The word cap is a cap, not a chop: slicing a sentence at N words ships
    // half a thought onto a finished ad.
    const clean = (s: string | undefined, n: number) =>
      dropOrgEndorsementPossessive(
        tidyAdCopy(
          (s || "")
            .replace(/["“”]/g, "")
            .replace(/[‘’]/g, "'")
            .trim()
            .split(/\s+/)
            .slice(0, n)
            .join(" ")
        )
      );
    const headline = clean(j.headline, 8);
    // A sub-line is OPTIONAL — so drop one the model wrote too long rather than
    // slice it mid-phrase. A live render shipped "…ONE SURPRISE AT" with "a time"
    // chopped off by the word cap; a dangling fragment on a finished ad reads
    // worse than no sub at all (the headline already carries it).
    const subWordCount = (j.sub || "").trim().split(/\s+/).filter(Boolean).length;
    const sub = subWordCount > 9 ? "" : clean(j.sub, 9);
    const cta = clean(j.cta, 3);
    if (!headline) return null;
    return { headline, sub, cta };
  } catch { return null; }
}

// drawtext is picky: escape the characters that break its filter parser.
// Unicode-aware so accents and CJK survive (the old \w filter erased them).
//
// THE APOSTROPHE AND THE COMMA BOTH SURVIVE NOW.
//
// This dropped ' along with the : and % it was actually aiming at, and the
// allow-list on the end then dropped the comma too — so a poster headline
// came out reading DONT SETTLE, YOURE READY, and a subhead lost the pause
// that made it a sentence. Verified with this repo's own ffmpeg and Poppins:
// a STRAIGHT apostrophe inside text='...' is silently swallowed by the filter
// parser, but U+2019 renders correctly and needs no escaping at all — it is a
// letter to ffmpeg, not syntax. It is also the right mark for a contraction,
// so the type simply looks better. Same fix as captionSafe in the UGC
// pipeline.
const dt = (s: string) =>
  s
    .replace(/\\/g, "")
    .replace(/[']/g, "’")   // fold BEFORE the allow-list, or it is stripped
    .replace(/[:%]/g, "")
    .replace(/[^\p{L}\p{N} \-!?.,&’]/gu, "")
    .trim();

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
    const tmp = path.join(dir, `.pa-${Date.now()}-${crypto.randomBytes(9).toString("hex")}`);
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
  const stamp = `${Date.now()}-${crypto.randomBytes(9).toString("hex")}`;
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
 *  on-brief?
 *
 *  IT USED TO FAIL OPEN. An unparseable verdict and a thrown vision call both
 *  returned pass:true, and this is the only gate on RUNG 2 (scene) — the
 *  most-travelled path for any ad built from a product photo. A vision outage
 *  therefore did not slow anything down; it switched the quality gate off and
 *  wrote “pass” into genMeta, which is also what the QA harness reads back.
 *  Every warped, duplicated or wrong-scale product shipped, logged as fine.
 *
 *  It fails closed now — but a gate that CANNOT JUDGE is not the same as one
 *  that judged and rejected, and the difference costs real money: both callers
 *  retry once on a rejection, which is a second paid generation. `degraded`
 *  says which happened, so an outage drops straight to the deterministic
 *  composite instead of burning a re-roll against a gate that is down. */
async function qaFidelity(productUrl: string, genUrl: string, wantBright: boolean): Promise<{ pass: boolean; reason: string; degraded?: boolean }> {
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
    const v = parseGateVerdict(raw, "pass", "reason", 200);
    if (v.degraded) console.error(`[image-ad] qaFidelity got no usable verdict from: ${String(raw).slice(0, 300)}`);
    return { pass: v.ok, reason: v.reason, degraded: v.degraded };
  } catch (e) {
    return { pass: false, reason: outageReason(e), degraded: true };
  }
}

/** The keys a vision verdict MUST answer with a real boolean. Anything else
 *  — omitted, null, 0/1, the string "false" — means that question was not
 *  answered, and an unanswered question is not a pass. */
function unanswered(j: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.filter((k) => typeof j[k] !== "boolean");
}

/** Vision gate for a presenter-holding still. Exported because the UGC video
 *  pipeline composes the same kind of frame and was accepting it on file size
 *  alone — and there every frame of the clip inherits the mistake.
 *
 *  This rung shipped un-checked,
 *  which is why a 6-box display case arrived palm-sized with two boxes in it:
 *  the composer both SHRANK the product and simplified it, and nothing looked.
 *  Judges the two failures that actually happen here — wrong scale against the
 *  body, and a product that isn't the same product any more. */
export async function qaPresenterHold(
  productUrl: string,
  genUrl: string,
  scalePhrase: string | undefined,
  sizeClass?: string,
  cm?: number,
  /** Worn apparel. The scale questions below are meaningless for a garment —
   *  it spans the torso because it is being worn — so they are dropped. Every
   *  fidelity and anatomy question still applies, and artworkMatches most of
   *  all: a tee rendered with different print art is the same defect as a box
   *  rendered with different box art. */
  wear?: boolean
): Promise<{ pass: boolean; reason: string; bad: string[]; soft: string[] }> {
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
    // The COMPOSED frame also goes up as vision-sized BYTES when it lives on
    // a URL. A 4K compose is a ~20MB PNG on a short-lived fal link; the API's
    // own fetcher times out downloading it and the timeout lands in the catch
    // below as a rejection — so the harder the engine tried, the more the
    // gate broke. Downscale to grading size first; the fields being judged
    // (artwork, object, headline text, scale, hands) all survive 1568px.
    let genRef = genUrl;
    if (/^https?:/i.test(genUrl)) {
      try {
        const gres = await fetch(genUrl);
        if (gres.ok) {
          const gbuf = Buffer.from(await gres.arrayBuffer());
          let out: Buffer | null = gbuf.length > 5_000 ? gbuf : null;
          const bin = ffmpegBin();
          if (out && out.length > 2_000_000 && bin) {
            const { execFileSync } = await import("node:child_process");
            const os = await import("node:os");
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
            try {
              const inP = path.join(tmp, "in.img");
              const outP = path.join(tmp, "out.jpg");
              fs.writeFileSync(inP, out);
              execFileSync(bin, ["-y", "-i", inP, "-vf", "scale='min(1568,iw)':-2", "-q:v", "3", outP], { timeout: 30_000, stdio: "ignore" });
              if (fs.existsSync(outP)) out = fs.readFileSync(outP);
            } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
          }
          // The API caps a base64 image around 5MB — an un-shrunk giant is
          // worse inlined than fetched, so it keeps its URL and its luck.
          if (out && out.length < 4_500_000) genRef = `data:image/jpeg;base64,${out.toString("base64")}`;
        }
      } catch { /* URL fallback — no worse than before */ }
    }
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
        // Fine print is judged separately and never blocks. At feed resolution
        // nobody can read a contact label; a wrong BRAND NAME everyone can.
        `textFaithful: judge ONLY the PROMINENT lettering — brand names, logos, the product title, any heading large enough to read at a glance. Same words, same colours? A gold logo rendered purple, or a brand name misspelled, is a failure. IGNORE small paragraph text, legal print, contact details and anything smaller than the title lettering for this field.`,
        `finePrintFaithful: now the SMALL print only — paragraph text, legal lines, contact labels. Is it faithful and legible? (This field is advisory; answer honestly but it does not block.)`,
        // Scale is a CLASSIFICATION, not a bool. The old yes/no question made
        // one strictness fit every merchant: it killed a wholesale case held at
        // the chest (one class small — a human would ship it) with the same
        // severity as a lip balm drawn as a shoebox (a lie). The gate now
        // reports which size band the render READS as and the caller measures
        // the distance from the expected band, both directions.
        wear
          ? `wornCorrectly: the garment is being WORN by the presenter and hangs like real fabric on a real body — not floating, not pasted flat over them, not draped on a hanger or mannequin.`
          : `renderedSize: against the person, how big does the product READ in image 2? Answer exactly one of: "palm" (fits in one palm), "two-hands" (needs both hands, smaller than the torso), "torso" (spans the torso or needs arms wrapped around), "floor" (furniture-sized or larger).${scalePhrase ? ` For context, the real product is ${scalePhrase}.` : ""}`,
        // Bands are too coarse to catch a lie WITHIN a band — a 20cm bottle
        // drawn at 45cm is "two-hands" either way and twice life size. So
        // also take an absolute measurement against the one ruler always in
        // frame: the presenter's own head.
        `headHeights: measure the product's longest visible dimension in image 2 against the presenter's HEAD (chin to top of head). Answer a decimal number — e.g. 0.5 if it is half a head tall, 2 if it is two heads tall. Measure what is DRAWN, not what the product should be.`,
        wear ? "" : `scalePlausible: judging by what the product obviously is, is it a believable size against the person?`,
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
        // the shape must match the questions actually asked above, or the
        // judge answers a scale question we did not ask and skips the fit one
        wear
          ? `Reply ONLY JSON: {"artworkMatches":bool,"sameObject":bool,"notSimplified":bool,"singleProduct":bool,"textFaithful":bool,"finePrintFaithful":bool,"wornCorrectly":bool,"noSourceText":bool,"handsOk":bool,"handsHuman":bool,"faceVisible":bool,"notSelfie":bool,"reason":"..."}`
          : `Reply ONLY JSON: {"artworkMatches":bool,"sameObject":bool,"notSimplified":bool,"singleProduct":bool,"textFaithful":bool,"finePrintFaithful":bool,"renderedSize":"palm|two-hands|torso|floor","headHeights":number,"scalePlausible":bool,"noSourceText":bool,"handsOk":bool,"handsHuman":bool,"faceVisible":bool,"notSelfie":bool,"reason":"..."}`,
      ].filter(Boolean).join("\n"),
      [productRef, genRef],
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
      return { pass: false, reason: "gate could not read its own verdict", bad: ["unreadable"], soft: [] };
    }
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    // HARD fails block the frame: these are lies about the merchant's product
    // or anatomy a viewer would flinch at. Everything else is a soft note.
    const HARD = ["artworkMatches", "sameObject", "notSimplified", "singleProduct", "textFaithful", "noSourceText", "handsOk", "handsHuman", "faceVisible", "notSelfie"] as const;
    // A question the judge did not answer is not an answer of "fine".
    const skipped = unanswered(j, HARD);
    if (skipped.length) {
      console.warn(`[presenter:gate] verdict left ${skipped.join("/")} unanswered — treating as a failure`);
      return { pass: false, reason: `gate did not answer: ${skipped.join(", ")}`, bad: skipped, soft: [] };
    }
    const bad = HARD.filter((k) => j[k] === false) as string[];
    const soft: string[] = [];
    if (j.finePrintFaithful === false) soft.push("finePrint");
    // Size-class distance, DIRECTION-AWARE. Two or more bands off blocks in
    // either direction (a lip balm as a shoebox, a case as a palm trinket).
    // One band off is asymmetric: a wholesale case held at the chest reads
    // fine (soft note), but a PALM product one band UP is a familiar handheld
    // object drawn at twice life size — a 200ml Ramune bottle shipped as a
    // half-metre jug before this rule — and every viewer knows how big a
    // bottle is. Oversizing the small stuff blocks.
    // A worn garment has no meaningful size band — it is the size of the
    // person wearing it — so the whole scale block is skipped and the fit
    // question stands in its place.
    if (wear && j.wornCorrectly === false) bad.push("wornCorrectly");
    const ORD: Record<string, number> = wear ? {} : { palm: 0, "two-hand": 1, "two-hands": 1, large: 2, torso: 2, floor: 3 };
    const expected = ORD[(sizeClass || "").trim()];
    const rendered = ORD[String(j.renderedSize || "").trim().toLowerCase()];
    if (expected !== undefined && rendered !== undefined) {
      const diff = Math.abs(expected - rendered);
      if (diff >= 2) bad.push("scaleFar");
      else if (diff === 1 && expected === 0 && rendered > expected) bad.push("scaleUp");
      else if (diff === 1) soft.push("scaleNear");
    } else if (j.scalePlausible === false) {
      bad.push("scalePlausible");
    }
    // Absolute check, catches within-band lies the coarse bands cannot: the
    // real size in cm against the drawn size measured in head-heights (an
    // adult head is ~23cm chin to crown and is always in a presenter frame).
    // A 20cm bottle drawn two heads tall shipped before this — same band as
    // life size, twice the size. 1.8x either way is a visible lie.
    const heads = Number(j.headHeights);
    if (!wear && cm && Number.isFinite(heads) && heads > 0) {
      const ratio = (heads * 23) / cm;
      if ((ratio >= 1.8 || ratio <= 0.55) && !bad.includes("scaleFar") && !bad.includes("scaleUp")) {
        bad.push(ratio >= 1.8 ? "scaleUp" : "scaleFar");
      }
    }
    if (!bad.length) return { pass: true, reason: soft.length ? `clean (soft: ${soft.join(", ")})` : "clean", bad, soft };
    const why = typeof j.reason === "string" && j.reason ? j.reason : bad.join(", ");
    return { pass: false, reason: `${bad.join("/")}: ${why}`.slice(0, 200), bad, soft };
  } catch (e) {
    // A QA outage FAILS CLOSED. This used to pass on the theory that
    // blocking a paid render on our own downtime was worse than shipping —
    // then an exhausted API balance shipped six UNGATED drawn frames in one
    // sweep. The fallback for a failed gate is the merchant's real product
    // photo, which is always safe; an ungated drawn product is the one thing
    // this whole pipeline exists to prevent. The merchant loses nothing but
    // the presenter flourish while the outage lasts.
    return { pass: false, reason: `qa-outage: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`, bad: ["qa-outage"], soft: [] };
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

  // CHEST-UP FRAMES CAN'T BE SAVED — reject them before paying for a paste.
  // With the chin below ~52% of the frame there is no rectangle that hides
  // the stand-in, clears the chin, and reads torso-scale (six sweeps of
  // arithmetic say so). The composer is prompted for a wide half-body shot;
  // a candidate that came back framed close is a bad candidate, and saying
  // so here costs nothing while a paste costs a rembg call and an encode.
  if (opts.whole && face && (face.y + face.h) > 52) {
    return give(`composer framed presenter too close (chin at ${Math.round(face.y + face.h)}%) — no room for the product below the face`);
  }

  const cutout = await removeBackground(productImageUrl);
  if (!cutout) return give("background removal returned nothing");

  const dir = path.join(process.cwd(), "data", "renders");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = `${Date.now()}-${crypto.randomBytes(9).toString("hex")}`;
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
      const minTop = chinY + H * 0.02;
      if (anchorY < minTop) {
        // FIT BELOW THE CHIN before giving up. With the face read finally
        // working, a hard reject here killed every showcase candidate in a
        // sweep where the composer framed presenters chest-up (chin at
        // 45-66% of frame height) — a torso-scale paste anchored at the
        // counter ALWAYS topped out above those chins. Shrink the paste so
        // its top lands at the chin line, bottom edge staying put; accept
        // only a modest shrink, because past that the product reads
        // palm-sized and the gate would reject it anyway (and the gate still
        // arbitrates correctScale on whatever ships).
        const pasteBottom = anchorY + th;
        const maxH = pasteBottom - minTop;
        // The shrink must respect BOTH standing invariants: modest (past
        // ~28% the product reads palm-sized) AND still big enough to hide
        // the drawn stand-in — a paste smaller than the stand-in leaves
        // drawn box edges peeking out, which the judge correctly flags as a
        // doubled/different object. If the chin line, the stand-in size and
        // the 28% cap can't all be satisfied, the candidate is unsaveable.
        const shrunkW = cut ? Math.round((maxH * cut.w) / cut.h) : 0;
        if (cut && maxH > th * 0.72 && maxH >= bh && shrunkW >= bw) {
          th = Math.floor(maxH);
          tw = shrunkW;
          anchorY = pasteBottom - th;
        } else {
          return give(`paste would cover the face (top ${Math.round((anchorY / H) * 100)}% vs chin ${Math.round((chinY / H) * 100)}%, no fit below chin that still hides the stand-in)`);
        }
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

// Formats where the product is a single hero object with ONE clear bounding box
// — safe to swap the model's redrawn product for the real one without disturbing
// the surrounding layout. Multi-panel / multi-product / card formats (versus,
// beforeafter, splitpanel, duo, bundle, unbox, steps, routine, review, faq …)
// are excluded: there is no single box to cover, or the product is incidental.
const PASTE_SAFE = new Set([
  "callout", "offer", "stat", "breakout", "poster", "gift", "restock",
  "seasonal", "minimal", "neon", "chalkboard", "speech", "origin", "weather",
  "swatch", "pov",
]);

/** THE REAL FIX for a garbled brand on a format ad: keep the LAYOUT the merchant
 *  picked, but swap the model's redrawn product for the REAL one, so a wordmark
 *  the generator mangles ("HERO"->"MERO", "Blokees"->"Blokes") ships
 *  pixel-faithful. Finds the product's box in the FINISHED ad, removes the real
 *  product's background, and pastes it to COVER that box (so no drawn edge peeks
 *  out) with a soft contact shadow. Returns null on any failure — a bad paste is
 *  worse than falling to the scene ad, which is exactly what the caller does. */
async function pasteProductIntoAd(frameUrl: string, productImageUrl: string): Promise<{ file: string; absPath: string } | null> {
  const bin = ffmpegBin();
  if (!bin) return null;
  // Where is the product in the finished ad? Percentages, so resolution-free.
  let box: { x: number; y: number; w: number; h: number } | null = null;
  try {
    const raw = await anthropicVision(
      [
        `This is a product advertisement. Find the single main PRODUCT being advertised (its box, package or item) — NOT any headline, annotation line, text label, chip, button or badge drawn around it.`,
        `Return the bounding box of the ENTIRE product as it appears — its full outer silhouette, every face or panel visible, from its leftmost to its rightmost edge and from its highest point to where it meets the surface.`,
        `Use percentages of the image dimensions, where x,y is the TOP-LEFT corner. Be tight to the product's outer edges.`,
        `Reply ONLY JSON: {"x":number,"y":number,"w":number,"h":number}`,
      ].join(" "),
      [frameUrl],
      { maxTokens: 120 }
    );
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const b = JSON.parse(m[0]) as Record<string, unknown>;
      if (["x", "y", "w", "h"].every((k) => typeof b[k] === "number")) {
        box = { x: b.x as number, y: b.y as number, w: b.w as number, h: b.h as number };
      }
    }
  } catch { /* fall through to the null guard */ }
  // A box that is nearly the whole frame (the reader grabbed everything) or a
  // sliver (it grabbed a chip) is a bad read — never paste on a guess.
  if (!box || box.w < 8 || box.h < 8 || box.w > 96 || box.h > 96) return null;

  const cutout = await removeBackground(productImageUrl);
  if (!cutout) return null;

  const dir = path.join(process.cwd(), "data", "renders");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = `${Date.now()}-${crypto.randomBytes(9).toString("hex")}`;
  const tmpFrame = path.join(dir, `.af-${stamp}.jpg`);
  const tmpCut = path.join(dir, `.ac-${stamp}.png`);
  const fileName = `img-${stamp}.jpg`;
  const out = path.join(dir, fileName);
  try {
    for (const [src, file] of [[frameUrl, tmpFrame], [cutout, tmpCut]] as const) {
      const res = await fetch(src);
      if (!res.ok) return null;
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    const W = await probeWidth(bin, tmpFrame);
    const H = await probeHeight(bin, tmpFrame);
    if (!W || !H) return null;
    // Inflate the reported box a little so the paste swallows the drawn outline.
    const pad = 1.08;
    const bw = (box.w / 100) * W * pad;
    const bh = (box.h / 100) * H * pad;
    const bcx = ((box.x + box.w / 2) / 100) * W; // box centre
    const bcy = ((box.y + box.h / 2) / 100) * H;
    const cut = headerSize(tmpCut);
    // Cover the drawn product in BOTH dimensions from the cutout's own aspect,
    // so no drawn edge peeks out around the real one; centre it on the box.
    let tw = Math.round(bw);
    let th = Math.round(bh);
    if (cut) {
      tw = Math.round(Math.max(bw, (bh * cut.w) / cut.h));
      th = Math.round((tw * cut.h) / cut.w);
    }
    const ox = Math.round(bcx - tw / 2);
    const oy = Math.round(bcy - th / 2);
    const filters =
      `[1:v]scale=${tw}:${th}[cut];` +
      `[cut]split[c1][c2];` +
      `[c2]colorchannelmixer=rr=0:gg=0:bb=0,gblur=sigma=10,colorchannelmixer=aa=0.30[sh];` +
      `[0:v][sh]overlay=x=${ox}+6:y=${oy}+8[b1];` +
      `[b1][c1]overlay=x=${ox}:y=${oy}[outv]`;
    const { ok } = await runFfmpegStill(bin, ["-y", "-i", tmpFrame, "-i", tmpCut, "-filter_complex", filters, "-map", "[outv]", "-frames:v", "1", "-q:v", "3", out]);
    if (ok && fs.existsSync(out) && fs.statSync(out).size > 20_000) return { file: fileName, absPath: out };
    return null;
  } catch {
    return null;
  } finally {
    try { fs.rmSync(tmpFrame, { force: true }); fs.rmSync(tmpCut, { force: true }); } catch { /* best-effort */ }
  }
}

/** THE DETERMINISTIC CALLOUT — the only sure cure for the image model misspelling
 *  its OWN overlay text ("Buildable" -> "Buidlable", "Collector" -> "Sollector"),
 *  which the prod logs showed is the real reason callouts collapse to a scene ad.
 *  Instead of asking the model to draw the chips/headline/lines, we composite the
 *  REAL product cutout onto a clean, text-free backdrop and draw EVERY word
 *  ourselves with ffmpeg — so the text is ALWAYS perfectly spelled and the brand
 *  is ALWAYS pixel-faithful. The model only renders an empty backdrop, which it
 *  does flawlessly. Returns the finished file, or null on any failure (the caller
 *  then falls back to the paste / scene ad, exactly as before). */
async function renderCalloutComposite(opts: {
  productImageUrl: string;
  headline: string;
  cta: string;
  chips: string[];
  contentLang?: string | null;
  styleDesc: string;
}): Promise<{ file: string; absPath: string } | null> {
  const bin = ffmpegBin();
  if (!bin) return null;
  const chips = opts.chips.map((s) => (s || "").trim()).filter(Boolean).slice(0, 4);
  if (chips.length < 2) return null; // a callout needs at least two points

  const cutout = await removeBackground(opts.productImageUrl);
  if (!cutout) return null;

  const W = 1024, H = 1024;
  const dir = path.join(process.cwd(), "data", "renders");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = `${Date.now()}-${crypto.randomBytes(9).toString("hex")}`;
  const tmpBg = path.join(dir, `.cb-${stamp}.jpg`);
  const tmpCut = path.join(dir, `.cc-${stamp}.png`);
  const tmpStill = path.join(dir, `.cs-${stamp}.jpg`);
  const fileName = `img-${stamp}.jpg`;
  const out = path.join(dir, fileName);
  try {
    // 1) A clean, EMPTY, text-free backdrop — generated for a premium look, with
    //    a warm-cream ffmpeg fallback so a flux hiccup never loses the ad.
    let gotBg = false;
    try {
      const bgPrompt = `Empty advertising backdrop photograph — ${opts.styleDesc}. Completely empty scene: NO product, NO objects, NO people, NO text, NO logos — just a clean premium surface and softly-lit backdrop with even space across the whole frame. Photorealistic, magazine-quality, soft believable shadow area, no text, no watermark.`;
      const bgUrl = await fluxDevStill(bgPrompt, "callout-backdrop");
      if (bgUrl) {
        const res = await fetch(bgUrl);
        if (res.ok) { fs.writeFileSync(tmpBg, Buffer.from(await res.arrayBuffer())); gotBg = true; }
      }
    } catch { /* fall back to a solid colour */ }
    {
      const r = await fetch(cutout);
      if (!r.ok) return null;
      fs.writeFileSync(tmpCut, Buffer.from(await r.arrayBuffer()));
    }

    // 2) Composite the cutout CENTERED at a KNOWN rect, so the leader lines can
    //    aim at it deterministically.
    const cut = headerSize(tmpCut);
    const boxW = 430, boxH = 470;
    const cx = W / 2, cy = Math.round(H * 0.52);
    let pw = boxW, ph = boxH;
    if (cut) {
      const s = Math.min(boxW / cut.w, boxH / cut.h);
      pw = Math.round(cut.w * s); ph = Math.round(cut.h * s);
    }
    const px = Math.round(cx - pw / 2), py = Math.round(cy - ph / 2);
    const pLeft = px, pRight = px + pw;

    const bgInput = gotBg ? ["-i", tmpBg] : ["-f", "lavfi", "-i", `color=c=0xEFE7DA:s=${W}x${H}`];
    const composite =
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}[bg];` +
      `[1:v]scale=${pw}:${ph}[cut];` +
      `[cut]split[c1][c2];` +
      `[c2]colorchannelmixer=rr=0:gg=0:bb=0,gblur=sigma=12,colorchannelmixer=aa=0.33[sh];` +
      `[bg][sh]overlay=x=${px}+8:y=${py}+14[b1];` +
      `[b1][c1]overlay=x=${px}:y=${py}[outv]`;
    const comp = await runFfmpegStill(bin, ["-y", ...bgInput, "-i", tmpCut, "-filter_complex", composite, "-map", "[outv]", "-frames:v", "1", "-q:v", "3", tmpStill]);
    if (!comp.ok || !fs.existsSync(tmpStill)) return null;

    // 3) Draw EVERY word ourselves — perfect spelling, always.
    let fontFile = path.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");
    try {
      const { resolveTextFont } = await import("./ugc-ad-pipeline.server");
      fontFile = await resolveTextFont(`${opts.headline} ${opts.cta} ${chips.join(" ")}`);
    } catch { /* keep default */ }
    if (!fs.existsSync(fontFile)) return null;
    const font = fontFile.replace(/\\/g, "/").replace(/:/g, "\\:");

    const hl = dt(opts.headline).toUpperCase();
    const ct = dt(opts.cta).toUpperCase();
    if (!hl) return null;

    const words = hl.split(" ");
    let line1 = hl, line2 = "";
    if (hl.length > 16 && words.length > 2) {
      let best = 1, bestDiff = Infinity;
      for (let i = 1; i < words.length; i++) {
        const a = words.slice(0, i).join(" ").length, b = words.slice(i).join(" ").length;
        const d = Math.abs(a - b) + Math.max(0, Math.max(a, b) - 18) * 4;
        if (d < bestDiff) { bestDiff = d; best = i; }
      }
      line1 = words.slice(0, best).join(" "); line2 = words.slice(best).join(" ");
    }
    const glyph = hasCJK(hl) ? 1.05 : 0.62;
    const longestChars = Math.max(line1.length, line2.length, 1);
    const hlSize = Math.min((longestChars * (glyph / 0.62)) > 18 ? 54 : 66, Math.floor((W * 0.9) / (longestChars * glyph)));
    const topY = 72;
    const line2Y = topY + Math.round(hlSize * 1.14);

    const topLuma = (await bandLuma(bin, tmpStill, 0, 0.22)) ?? 180;
    const darkText = topLuma > 150;
    const hlColor = darkText ? "0x1A1A1A" : "white";
    const hlShadow = darkText ? "shadowcolor=white@0.3:shadowx=0:shadowy=2" : "shadowcolor=black@0.45:shadowx=0:shadowy=3";

    // Chips: left chips right-aligned to RX, right chips left-aligned to LX, each
    // with a horizontal leader line + a dot at the product edge at the chip's row.
    // Per-chip font is sized DOWN to the room available on that side so a long
    // label can never run off the frame edge (a fixed size overflowed "NINE
    // BLIND BOXES" off the left in local testing).
    const RX = pLeft - 52;
    const LX = pRight + 52;
    const rows = chips.length <= 2 ? [Math.round(H * 0.5)]
      : chips.length === 3 ? [Math.round(H * 0.4), Math.round(H * 0.63)]
        : [Math.round(H * 0.38), Math.round(H * 0.64)];
    const chipFilters: string[] = [];
    chips.forEach((label, i) => {
      const lab = dt(label); if (!lab) return;
      const left = i % 2 === 0;
      const avail = (left ? RX : (W - LX)) - 44; // usable width on that side
      const gf = hasCJK(lab) ? 1.05 : 0.62;
      const cs = Math.max(17, Math.min(30, Math.floor(avail / (Math.max(1, lab.length) * gf))));
      const rowY = rows[Math.floor(i / 2)] ?? Math.round(H * 0.5);
      const ty = rowY - Math.round(cs * 0.7);
      if (left) {
        chipFilters.push(`drawtext=fontfile='${font}':text='${lab}':fontsize=${cs}:fontcolor=0x141414:box=1:boxcolor=white@0.92:boxborderw=12:x=${RX}-text_w:y=${ty}`);
        chipFilters.push(`drawbox=x=${RX + 14}:y=${rowY - 2}:w=${Math.max(10, pLeft - (RX + 14) - 8)}:h=4:color=0x141414@0.85:t=fill`);
        chipFilters.push(`drawbox=x=${pLeft - 6}:y=${rowY - 6}:w=12:h=12:color=0x141414:t=fill`);
      } else {
        chipFilters.push(`drawtext=fontfile='${font}':text='${lab}':fontsize=${cs}:fontcolor=0x141414:box=1:boxcolor=white@0.92:boxborderw=12:x=${LX}:y=${ty}`);
        chipFilters.push(`drawbox=x=${pRight + 8}:y=${rowY - 2}:w=${Math.max(10, (LX - 14) - (pRight + 8))}:h=4:color=0x141414@0.85:t=fill`);
        chipFilters.push(`drawbox=x=${pRight - 6}:y=${rowY - 6}:w=12:h=12:color=0x141414:t=fill`);
      }
    });

    const vf = [
      darkText ? "" : "drawbox=x=0:y=0:w=iw:h=210:color=black@0.16:t=fill",
      `drawtext=fontfile='${font}':text='${line1}':fontsize=${hlSize}:fontcolor=${hlColor}:${hlShadow}:x=(w-text_w)/2:y=${topY}`,
      line2 ? `drawtext=fontfile='${font}':text='${line2}':fontsize=${hlSize}:fontcolor=${hlColor}:${hlShadow}:x=(w-text_w)/2:y=${line2Y}` : "",
      ...chipFilters,
      ct ? `drawtext=fontfile='${font}':text='${ct}':fontsize=30:fontcolor=white:box=1:boxcolor=0x141414@0.92:boxborderw=18:x=(w-text_w)/2:y=h-96` : "",
    ].filter(Boolean).join(",");

    const fin = await runFfmpegStill(bin, ["-y", "-i", tmpStill, "-vf", vf, "-frames:v", "1", "-q:v", "3", out]);
    if (fin.ok && fs.existsSync(out) && fs.statSync(out).size > 20_000) return { file: fileName, absPath: out };
    return null;
  } catch {
    return null;
  } finally {
    for (const f of [tmpBg, tmpCut, tmpStill]) { try { fs.rmSync(f, { force: true }); } catch { /* best-effort */ } }
  }
}

/** THE DETERMINISTIC NUMBER FLEX (stat) — the callout composite's twin, for the
 *  one-big-number format. Same root problem: the generative render re-letters the
 *  product's own brand wordmark ("HERO" -> "AEERD") and can mangle the hero
 *  number's unit, and a stat ad lives or dies on that number being exactly right.
 *  So we composite the REAL product cutout on a clean, text-free backdrop and
 *  draw the huge number, its label, the headline and the CTA ourselves — number,
 *  every word and the brand are then always perfect. The model only renders an
 *  empty backdrop. Returns the finished file, or null on any failure (the caller
 *  then falls straight through to the generative render, exactly as before). */
async function renderStatComposite(opts: {
  productImageUrl: string;
  stat: string;
  statlabel: string;
  headline: string;
  cta: string;
  contentLang?: string | null;
  styleDesc: string;
}): Promise<{ file: string; absPath: string } | null> {
  const bin = ffmpegBin();
  if (!bin) return null;
  const statRaw = (opts.stat || "").trim();
  if (!statRaw || !/\d/.test(statRaw)) return null; // Number Flex needs a real number

  const cutout = await removeBackground(opts.productImageUrl);
  if (!cutout) return null;

  const W = 1024, H = 1024;
  const dir = path.join(process.cwd(), "data", "renders");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = `${Date.now()}-${crypto.randomBytes(9).toString("hex")}`;
  const tmpBg = path.join(dir, `.sb-${stamp}.jpg`);
  const tmpCut = path.join(dir, `.sc-${stamp}.png`);
  const tmpStill = path.join(dir, `.ss-${stamp}.jpg`);
  const fileName = `img-${stamp}.jpg`;
  const out = path.join(dir, fileName);
  try {
    // 1) A clean, EMPTY, text-free backdrop (flux), warm-cream ffmpeg fallback —
    //    identical to the callout composite so a flux hiccup never loses the ad.
    let gotBg = false;
    try {
      const bgPrompt = `Empty advertising backdrop photograph — ${opts.styleDesc}. Completely empty scene: NO product, NO objects, NO people, NO text, NO logos — just a clean premium surface and softly-lit backdrop with even space across the whole frame. Photorealistic, magazine-quality, soft believable shadow area, no text, no watermark.`;
      const bgUrl = await fluxDevStill(bgPrompt, "stat-backdrop");
      if (bgUrl) {
        const res = await fetch(bgUrl);
        if (res.ok) { fs.writeFileSync(tmpBg, Buffer.from(await res.arrayBuffer())); gotBg = true; }
      }
    } catch { /* fall back to a solid colour */ }
    {
      const r = await fetch(cutout);
      if (!r.ok) return null;
      fs.writeFileSync(tmpCut, Buffer.from(await r.arrayBuffer()));
    }

    // 2) Composite the cutout in the LOWER-CENTER — the hero number owns the top
    //    half, so the product sits below it with a soft drop shadow.
    const cut = headerSize(tmpCut);
    // Bigger product, pulled up so it reads as the hero — the first cut sat small
    // and floating with a dead band under the number. Box grows 360² → 450×420
    // (~1.4× area) and the center rises so the product tucks just under the label.
    const boxW = 450, boxH = 420;
    const cx = W / 2, cy = Math.round(H * 0.575);
    let pw = boxW, ph = boxH;
    if (cut) {
      const s = Math.min(boxW / cut.w, boxH / cut.h);
      pw = Math.round(cut.w * s); ph = Math.round(cut.h * s);
    }
    const px = Math.round(cx - pw / 2), py = Math.round(cy - ph / 2);

    const bgInput = gotBg ? ["-i", tmpBg] : ["-f", "lavfi", "-i", `color=c=0xEFE7DA:s=${W}x${H}`];
    // GROUNDED contact shadow (not an offset drop shadow): squash the product's
    // own silhouette into a flat, heavily-blurred dark blob at its base, so the
    // product sits ON the surface instead of floating in front of it.
    const shW = Math.round(pw * 0.94), shH = Math.max(10, Math.round(ph * 0.13));
    const shX = px + Math.round((pw - shW) / 2), shY = py + ph - Math.round(ph * 0.06);
    const composite =
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}[bg];` +
      `[1:v]scale=${pw}:${ph}[cut];` +
      `[cut]split[c1][c2];` +
      `[c2]scale=${shW}:${shH},colorchannelmixer=rr=0:gg=0:bb=0,gblur=sigma=16,colorchannelmixer=aa=0.42[sh];` +
      `[bg][sh]overlay=x=${shX}:y=${shY}[b1];` +
      `[b1][c1]overlay=x=${px}:y=${py}[outv]`;
    const comp = await runFfmpegStill(bin, ["-y", ...bgInput, "-i", tmpCut, "-filter_complex", composite, "-map", "[outv]", "-frames:v", "1", "-q:v", "3", tmpStill]);
    if (!comp.ok || !fs.existsSync(tmpStill)) return null;

    // 3) Draw the number, its label, the headline and the CTA ourselves.
    let fontFile = path.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");
    try {
      const { resolveTextFont } = await import("./ugc-ad-pipeline.server");
      fontFile = await resolveTextFont(`${statRaw} ${opts.statlabel} ${opts.headline} ${opts.cta}`);
    } catch { /* keep default */ }
    if (!fs.existsSync(fontFile)) return null;
    const font = fontFile.replace(/\\/g, "/").replace(/:/g, "\\:");

    const statTxt = dt(statRaw).toUpperCase();
    const labelTxt = dt(opts.statlabel).toUpperCase();
    const hlTxt = dt(opts.headline).toUpperCase();
    const ct = dt(opts.cta).toUpperCase();
    if (!statTxt) return null;

    // Hero number: as big as fits ~86% of the width, capped so a single digit
    // stays dramatic without overflowing. It grows UPWARD from a fixed label
    // line, so the number+label block sits in the same place for any value.
    const sg = hasCJK(statTxt) ? 1.05 : 0.60;
    const statSize = Math.max(90, Math.min(230, Math.floor((W * 0.86) / (Math.max(1, statTxt.length) * sg))));
    const labelY = 312; // sits just above the (now larger, higher) product
    const statY = Math.max(40, labelY - statSize - 10);

    // Label and headline are width-capped single lines, so neither can overflow.
    const lg = hasCJK(labelTxt) ? 1.05 : 0.52;
    const labelSize = labelTxt ? Math.max(20, Math.min(46, Math.floor((W * 0.80) / (Math.max(1, labelTxt.length) * lg)))) : 0;
    const hg = hasCJK(hlTxt) ? 1.05 : 0.52;
    const hlSize = hlTxt ? Math.max(20, Math.min(36, Math.floor((W * 0.84) / (Math.max(1, hlTxt.length) * hg)))) : 0;
    const hlY = Math.round(H * 0.82);

    // Auto-contrast, sampled where each block actually sits.
    const topLuma = (await bandLuma(bin, tmpStill, 0, 0.32)) ?? 180;
    const topDark = topLuma > 150; // dark text on a light top
    const statColor = topDark ? "0x141414" : "white";
    const statShadow = topDark ? "shadowcolor=white@0.35:shadowx=0:shadowy=2" : "shadowcolor=black@0.5:shadowx=0:shadowy=3";
    const hlLuma = (await bandLuma(bin, tmpStill, 0.80, 0.14)) ?? 180;
    const hlDark = hlLuma > 150;
    const hlColor = hlDark ? "0x141414" : "white";
    const hlShadow = hlDark ? "shadowcolor=white@0.35:shadowx=0:shadowy=2" : "shadowcolor=black@0.5:shadowx=0:shadowy=3";

    const vf = [
      // lift a bright top a touch so a white number still reads (mirrors callout)
      topDark ? "" : "drawbox=x=0:y=0:w=iw:h=380:color=black@0.16:t=fill",
      `drawtext=fontfile='${font}':text='${statTxt}':fontsize=${statSize}:fontcolor=${statColor}:${statShadow}:x=(w-text_w)/2:y=${statY}`,
      labelTxt ? `drawtext=fontfile='${font}':text='${labelTxt}':fontsize=${labelSize}:fontcolor=${statColor}:${statShadow}:x=(w-text_w)/2:y=${labelY}` : "",
      hlTxt ? `drawtext=fontfile='${font}':text='${hlTxt}':fontsize=${hlSize}:fontcolor=${hlColor}:${hlShadow}:x=(w-text_w)/2:y=${hlY}` : "",
      ct ? `drawtext=fontfile='${font}':text='${ct}':fontsize=30:fontcolor=white:box=1:boxcolor=0x141414@0.92:boxborderw=18:x=(w-text_w)/2:y=h-84` : "",
    ].filter(Boolean).join(",");

    const fin = await runFfmpegStill(bin, ["-y", "-i", tmpStill, "-vf", vf, "-frames:v", "1", "-q:v", "3", out]);
    if (fin.ok && fs.existsSync(out) && fs.statSync(out).size > 20_000) return { file: fileName, absPath: out };
    return null;
  } catch {
    return null;
  } finally {
    for (const f of [tmpBg, tmpCut, tmpStill]) { try { fs.rmSync(f, { force: true }); } catch { /* best-effort */ } }
  }
}

/** THE DETERMINISTIC US-VS-THEM (versus) — the comparison table is the most
 *  structurally complex format, so the generative render BOTH drifts off the
 *  two-column layout AND re-letters the text/brand. We build it ourselves: the
 *  real product cutout as the hero, then a clean US (green ✓) vs THEM (red ✗)
 *  table drawn with ffmpeg, so the structure, the checks/crosses, every label
 *  and the brand are always perfect. Poppins has no ✓/✗ glyph, so the marks are
 *  generated as small badge PNGs (green circle + white check, red circle + white
 *  cross). Returns the finished file, or null on any failure (caller then falls
 *  through to the generative render, exactly as before). */
async function renderVersusComposite(opts: {
  productImageUrl: string;
  headline: string;
  us: string[];
  them: string[];
  contentLang?: string | null;
  styleDesc: string;
}): Promise<{ file: string; absPath: string } | null> {
  const bin = ffmpegBin();
  if (!bin) return null;
  const us = opts.us.map((s) => (s || "").trim()).filter(Boolean);
  const them = opts.them.map((s) => (s || "").trim()).filter(Boolean);
  const rows = Math.min(us.length, them.length, 3);
  if (rows < 2) return null; // a comparison needs at least two paired rows

  const cutout = await removeBackground(opts.productImageUrl);
  if (!cutout) return null;

  const W = 1024, H = 1024;
  const dir = path.join(process.cwd(), "data", "renders");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = `${Date.now()}-${crypto.randomBytes(9).toString("hex")}`;
  const tmpBg = path.join(dir, `.vb-${stamp}.jpg`);
  const tmpCut = path.join(dir, `.vc-${stamp}.png`);
  const tmpS1 = path.join(dir, `.v1-${stamp}.jpg`);
  const tmpS2 = path.join(dir, `.v2-${stamp}.jpg`);
  const tmpChk = path.join(dir, `.vk-${stamp}.png`);
  const tmpX = path.join(dir, `.vx-${stamp}.png`);
  const fileName = `img-${stamp}.jpg`;
  const out = path.join(dir, fileName);
  const tmps = [tmpBg, tmpCut, tmpS1, tmpS2, tmpChk, tmpX];
  try {
    // 1) Clean, light backdrop (flux), cream fallback — the table cells are drawn
    //    on solid fills, so a subtle backdrop stays readable.
    let gotBg = false;
    try {
      const bgPrompt = `Empty advertising backdrop photograph — ${opts.styleDesc}. Completely empty scene: NO product, NO objects, NO people, NO text, NO logos — just a clean premium surface and softly-lit backdrop with even space across the whole frame. Photorealistic, magazine-quality, soft believable shadow area, no text, no watermark.`;
      const bgUrl = await fluxDevStill(bgPrompt, "versus-backdrop");
      if (bgUrl) { const r = await fetch(bgUrl); if (r.ok) { fs.writeFileSync(tmpBg, Buffer.from(await r.arrayBuffer())); gotBg = true; } }
    } catch { /* cream fallback */ }
    { const r = await fetch(cutout); if (!r.ok) return null; fs.writeFileSync(tmpCut, Buffer.from(await r.arrayBuffer())); }

    // 2) Build the ✓ and ✗ mark badges (Poppins lacks the glyphs): a coloured
    //    circle (geq alpha mask) with two white rotated bars for the stroke(s).
    const BADGE = 46;
    const circle = (hex: string) => `color=c=${hex}:s=64x64,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte((X-32)*(X-32)+(Y-32)*(Y-32),30*30),255,0)'`;
    const mkCheck = ["-y", "-f", "lavfi", "-i", circle("0x16A34A"),
      "-f", "lavfi", "-i", "color=c=white:s=18x8,format=rgba",
      "-f", "lavfi", "-i", "color=c=white:s=34x8,format=rgba",
      "-filter_complex", "[1]rotate=0.785:c=none:ow=rotw(0.785):oh=roth(0.785)[s1];[2]rotate=-0.785:c=none:ow=rotw(-0.785):oh=roth(-0.785)[s2];[0][s1]overlay=9:25[a];[a][s2]overlay=21:13[o]",
      "-map", "[o]", "-frames:v", "1", tmpChk];
    const mkX = ["-y", "-f", "lavfi", "-i", circle("0xDC2626"),
      "-f", "lavfi", "-i", "color=c=white:s=34x8,format=rgba",
      "-f", "lavfi", "-i", "color=c=white:s=34x8,format=rgba",
      "-filter_complex", "[1]rotate=0.785:c=none:ow=rotw(0.785):oh=roth(0.785)[s1];[2]rotate=-0.785:c=none:ow=rotw(-0.785):oh=roth(-0.785)[s2];[0][s1]overlay=(W-w)/2:(H-h)/2[a];[a][s2]overlay=(W-w)/2:(H-h)/2[o]",
      "-map", "[o]", "-frames:v", "1", tmpX];
    if (!(await runFfmpegStill(bin, mkCheck)).ok || !(await runFfmpegStill(bin, mkX)).ok) return null;
    if (!fs.existsSync(tmpChk) || !fs.existsSync(tmpX)) return null;

    // 3) Product hero cutout, centered in the upper third, soft drop shadow.
    const cut = headerSize(tmpCut);
    const boxW = 340, boxH = 235;
    const cx = W / 2, cy = Math.round(H * 0.26);
    let pw = boxW, ph = boxH;
    if (cut) { const s = Math.min(boxW / cut.w, boxH / cut.h); pw = Math.round(cut.w * s); ph = Math.round(cut.h * s); }
    const px = Math.round(cx - pw / 2), py = Math.round(cy - ph / 2);
    const bgInput = gotBg ? ["-i", tmpBg] : ["-f", "lavfi", "-i", `color=c=0xF4EFE6:s=${W}x${H}`];
    const comp1 =
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}[bg];` +
      `[1:v]scale=${pw}:${ph}[cut];` +
      `[cut]split[c1][c2];` +
      `[c2]colorchannelmixer=rr=0:gg=0:bb=0,gblur=sigma=12,colorchannelmixer=aa=0.30[sh];` +
      `[bg][sh]overlay=x=${px}+6:y=${py}+12[b1];` +
      `[b1][c1]overlay=x=${px}:y=${py}[outv]`;
    if (!(await runFfmpegStill(bin, ["-y", ...bgInput, "-i", tmpCut, "-filter_complex", comp1, "-map", "[outv]", "-frames:v", "1", "-q:v", "3", tmpS1])).ok || !fs.existsSync(tmpS1)) return null;

    // 4) Table geometry.
    const mL = 44, gap = 28;
    const cellW = Math.round((W - mL * 2 - gap) / 2);
    const leftX = mL, rightX = mL + cellW + gap;
    const leftCx = leftX + Math.round(cellW / 2), rightCx = rightX + Math.round(cellW / 2);
    const headerY = 442;
    const tableTop = 490, rowH = 128, rowGap = 18;
    const rowTop = (i: number) => tableTop + i * (rowH + rowGap);
    const rowMid = (i: number) => rowTop(i) + Math.round(rowH / 2);
    const pillH = 48, pillW = 150;

    // 5) Cells + header pills (drawbox), then overlay the badges (filter_complex).
    const boxes: string[] = [];
    for (let i = 0; i < rows; i++) {
      boxes.push(`drawbox=x=${leftX}:y=${rowTop(i)}:w=${cellW}:h=${rowH}:color=0xE7F6ED:t=fill`);
      boxes.push(`drawbox=x=${rightX}:y=${rowTop(i)}:w=${cellW}:h=${rowH}:color=0xF1F1F1:t=fill`);
    }
    boxes.push(`drawbox=x=${leftCx - pillW / 2}:y=${headerY - pillH / 2}:w=${pillW}:h=${pillH}:color=0x16A34A:t=fill`);
    boxes.push(`drawbox=x=${rightCx - pillW / 2}:y=${headerY - pillH / 2}:w=${pillW}:h=${pillH}:color=0x9CA3AF:t=fill`);
    const drawboxChain = boxes.join(",");
    const chkLabels = Array.from({ length: rows }, (_, i) => `[k${i}]`).join("");
    const xLabels = Array.from({ length: rows }, (_, i) => `[m${i}]`).join("");
    let graph = `[1:v]scale=${BADGE}:${BADGE},split=${rows}${chkLabels};[2:v]scale=${BADGE}:${BADGE},split=${rows}${xLabels};[0:v]${drawboxChain}[s0];`;
    let cur = "s0", step = 0;
    for (let i = 0; i < rows; i++) {
      const ky = rowMid(i) - Math.round(BADGE / 2);
      const n1 = `s${++step}`;
      graph += `[${cur}][k${i}]overlay=${leftX + 22}:${ky}[${n1}];`;
      const n2 = `s${++step}`;
      graph += `[${n1}][m${i}]overlay=${rightX + 22}:${ky}[${n2}];`;
      cur = n2;
    }
    graph = graph.replace(/;$/, "");
    if (!(await runFfmpegStill(bin, ["-y", "-i", tmpS1, "-i", tmpChk, "-i", tmpX, "-filter_complex", `${graph}`, "-map", `[${cur}]`, "-frames:v", "1", "-q:v", "3", tmpS2])).ok || !fs.existsSync(tmpS2)) return null;

    // 6) All the text, drawn ourselves — perfectly spelled, always.
    let fontFile = path.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");
    try { const { resolveTextFont } = await import("./ugc-ad-pipeline.server"); fontFile = await resolveTextFont(`${opts.headline} ${us.join(" ")} ${them.join(" ")}`); } catch { /* keep default */ }
    if (!fs.existsSync(fontFile)) return null;
    const font = fontFile.replace(/\\/g, "/").replace(/:/g, "\\:");

    const hl = dt(opts.headline).toUpperCase();
    if (!hl) return null;
    // headline wraps to two balanced lines when long (same as the callout).
    const words = hl.split(" ");
    let line1 = hl, line2 = "";
    if (hl.length > 20 && words.length > 2) {
      let best = 1, bestDiff = Infinity;
      for (let i = 1; i < words.length; i++) {
        const a = words.slice(0, i).join(" ").length, b = words.slice(i).join(" ").length;
        const d = Math.abs(a - b) + Math.max(0, Math.max(a, b) - 20) * 4;
        if (d < bestDiff) { bestDiff = d; best = i; }
      }
      line1 = words.slice(0, best).join(" "); line2 = words.slice(best).join(" ");
    }
    const hlGlyph = hasCJK(hl) ? 1.05 : 0.60;
    const hlLongest = Math.max(line1.length, line2.length, 1);
    const hlSize = Math.min(line2 ? 48 : 56, Math.floor((W * 0.9) / (hlLongest * hlGlyph)));
    const topY = 40, line2Y = topY + Math.round(hlSize * 1.12);

    const hlLuma = (await bandLuma(bin, tmpS2, 0, 0.08)) ?? 180;
    const hlDark = hlLuma > 150;
    const hlColor = hlDark ? "0x14201A" : "white";
    const hlShadow = hlDark ? "shadowcolor=white@0.3:shadowx=0:shadowy=2" : "shadowcolor=black@0.45:shadowx=0:shadowy=3";

    // per-label font, width-capped to the room left of the badge in a cell.
    // Poppins-Bold caps measure ~0.61×fontsize, so the width factor must match or
    // a mid-length label (e.g. "SECRET VARIANT CHANCE") sized at the cap runs to
    // the cell edge — local measurement confirmed it. 0.62 + a lower cap keeps a
    // comfortable right margin for every realistic 2-4 word label.
    const labelAvail = cellW - BADGE - 22 - 22 - 16;
    const labelSize = (s: string) => Math.max(16, Math.min(28, Math.floor(labelAvail / (Math.max(1, s.length) * (hasCJK(s) ? 1.10 : 0.62)))));
    const labelX = (base: number) => base + 22 + BADGE + 16;

    const draw: string[] = [
      `drawtext=fontfile='${font}':text='${line1}':fontsize=${hlSize}:fontcolor=${hlColor}:${hlShadow}:x=(w-text_w)/2:y=${topY}`,
      line2 ? `drawtext=fontfile='${font}':text='${line2}':fontsize=${hlSize}:fontcolor=${hlColor}:${hlShadow}:x=(w-text_w)/2:y=${line2Y}` : "",
      `drawtext=fontfile='${font}':text='US':fontsize=26:fontcolor=white:x=${leftCx}-text_w/2:y=${headerY - 15}`,
      `drawtext=fontfile='${font}':text='THEM':fontsize=26:fontcolor=white:x=${rightCx}-text_w/2:y=${headerY - 15}`,
      `drawtext=fontfile='${font}':text='VS':fontsize=30:fontcolor=white:box=1:boxcolor=0x14201A:boxborderw=16:x=(w-text_w)/2:y=${headerY - 18}`,
    ];
    for (let i = 0; i < rows; i++) {
      const u = dt(us[i]).toUpperCase(), t = dt(them[i]).toUpperCase();
      const uy = rowMid(i) - Math.round(labelSize(u) * 0.62);
      const ty = rowMid(i) - Math.round(labelSize(t) * 0.62);
      draw.push(`drawtext=fontfile='${font}':text='${u}':fontsize=${labelSize(u)}:fontcolor=0x14532D:x=${labelX(leftX)}:y=${uy}`);
      draw.push(`drawtext=fontfile='${font}':text='${t}':fontsize=${labelSize(t)}:fontcolor=0x6B7280:x=${labelX(rightX)}:y=${ty}`);
    }
    const vf = draw.filter(Boolean).join(",");
    const fin = await runFfmpegStill(bin, ["-y", "-i", tmpS2, "-vf", vf, "-frames:v", "1", "-q:v", "3", out]);
    if (fin.ok && fs.existsSync(out) && fs.statSync(out).size > 20_000) return { file: fileName, absPath: out };
    return null;
  } catch {
    return null;
  } finally {
    for (const f of tmps) { try { fs.rmSync(f, { force: true }); } catch { /* best-effort */ } }
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
  const stamp = `${Date.now()}-${crypto.randomBytes(9).toString("hex")}`;
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

/** The shot plan: what a person would actually DO with this product on
 *  camera, decided by LOOKING at it. One static prompt written for boxes
 *  gave every product a two-hand chest-height grip — which is exactly how a
 *  one-hand soda bottle came out two-handed and twice life size. */
export type ShotPlan = { gripDetail?: string; sizeAnchor?: string; textElements?: string[] };

/** Keyed by product image URL: the plan describes the product, not the pair,
 *  so a merchant's catalogue plans once per product per process. */
const shotPlans = new Map<string, ShotPlan | null>();

async function planShot(
  productImageUrl: string,
  productTitle: string,
  scalePhrase?: string,
  cm?: number
): Promise<ShotPlan | null> {
  // ON BY DEFAULT since the A/B: the generic-prompt arm shipped a fully
  // INVENTED Pocky box (gorgeous, plausible, nonexistent) that only the
  // independent judge caught, while the planner arm — told what the object
  // actually is — drew the merchant's real bare stick. 4/9 judge-clean with
  // the planner vs 1/9 without, and zero judge-bad ships on the planner arm.
  // PRESENTER_PLANNER=0 is the off switch.
  if (process.env.PRESENTER_PLANNER === "0") return null;
  const hit = shotPlans.get(productImageUrl);
  if (hit !== undefined) return hit;
  try {
    // Bytes, same as the gate — Shopify originals can be AVIF or >8000px.
    let ref = productImageUrl;
    try {
      const { visionSafeUrl } = await import("./anthropic.server");
      const r = await fetch(visionSafeUrl(productImageUrl));
      if (r.ok) {
        const b = Buffer.from(await r.arrayBuffer());
        if (b.length > 5_000) ref = `data:image/jpeg;base64,${b.toString("base64")}`;
      }
    } catch { /* URL fallback */ }
    const raw = await anthropicVision(
      [
        `This is a merchant's product photo: "${productTitle}".${scalePhrase ? ` Its real size: ${scalePhrase}.` : ""}${cm ? ` Longest dimension roughly ${cm}cm.` : ""}`,
        `A presenter will hold or show this product to camera in a UGC-style ad. Plan the shot from what the product actually IS:`,
        ``,
        `gripDetail: how a real person presents THIS object, one short phrase (max 12 words). E.g. "in one hand, fingers around the bottle's narrow waist" for a small bottle; "cradled with both hands under its base" for a boxed case. Small light items take ONE hand.`,
        `sizeAnchor: its honest size expressed against the presenter's own body, one short phrase (max 12 words). E.g. "about as tall as her face — small in one hand". Use head/hand/torso as the ruler; never centimetres.`,
        `textElements: the up-to-3 most prominent printed elements that MUST appear faithfully, each max 6 words. E.g. ["red katakana logo", "blue whale illustration"].`,
        ``,
        `Reply ONLY JSON: {"gripDetail":"...","sizeAnchor":"...","textElements":["..."]}`,
      ].join("\n"),
      [ref],
      { maxTokens: 300, model: "claude-sonnet-5" }
    );
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("no JSON in plan");
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const clamp = (s: unknown, words: number) =>
      typeof s === "string" && s.trim() ? s.trim().split(/\s+/).slice(0, words).join(" ") : undefined;
    const plan: ShotPlan = {
      gripDetail: clamp(j.gripDetail, 14),
      sizeAnchor: clamp(j.sizeAnchor, 14),
      textElements: Array.isArray(j.textElements)
        ? (j.textElements.map((t) => clamp(t, 7)).filter(Boolean) as string[]).slice(0, 3)
        : undefined,
    };
    shotPlans.set(productImageUrl, plan);
    console.log(`[presenter:plan] ${productTitle.slice(0, 40)}: ${plan.gripDetail || "—"} · ${plan.sizeAnchor || "—"} · ${(plan.textElements || []).join(" / ") || "—"}`);
    return plan;
  } catch (e) {
    // A failed plan means the generic prompt — the path that exists today —
    // never a blocked render.
    console.warn(`[presenter:plan] failed, using generic prompt: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`);
    shotPlans.set(productImageUrl, null);
    return null;
  }
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
  /** Real longest dimension in cm (product-scale) — powers the gate's
   *  absolute head-height scale check. */
  cm?: number;
  /** avatars.ts `continuity` — what stays true below this presenter's face.
   *  Human presenters need nothing; a character does, or the composer gives
   *  them ordinary human hands on the product. */
  continuity?: string;
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
  // The plan is per-product and cached; a failure degrades to the generic
  // prompt, so this can sit on the hot path.
  const plan = opts.wear ? null : await planShot(opts.productImageUrl, opts.productTitle, opts.scalePhrase, opts.cm);
  const runCompose = async (
    hint: string | undefined,
    mode: "hold" | "wear" | "blank" | "showcase" = opts.wear ? "wear" : "hold",
    aspect?: number
  ): Promise<string | undefined> => {
    const q = await submitCompose(opts.portraitUrl, opts.productImageUrl, opts.productTitle, 1, mode, opts.scene, hint, aspect, plan || undefined, opts.continuity);
    // 3 minutes, not 90 seconds: a 4K compose regularly outlives the old
    // window, and an expired poll reads as "compose returned nothing" — the
    // render finishes anyway, billed, and thrown away.
    for (let i = 0; i < 90; i++) {
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

  // ONE SHOT BY DEFAULT. The candidate spray below was built for engines that
  // drew the product wrong most of the time — five paste candidates existed
  // because each had a ~25% survival rate against a gate that had plenty to
  // catch. Nano Banana Pro draws accurate packaging, so production now takes
  // one compose, gates it on hard fails only, retries once on a hard fail and
  // then falls back to the product still. PRESENTER_SPRAY=1 resurrects the
  // spray for CI experiments.
  if (!opts.wear && presenterSprayEnabled()) {
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
          const qa = await qaPresenterHold(opts.productImageUrl, frame, opts.scalePhrase, opts.sizeClass, opts.cm);
          return { c, frame, qa, note: `${c.name}: ${qa.pass ? "passed" : `rejected — ${qa.reason}`}` };
        }
        const put = await overlayRealProduct(frame, opts.productImageUrl, { whole: c.mode === "showcase", sizeClass: opts.sizeClass });
        if (!put.ok) return { c, frame, note: `${c.name}: paste failed — ${put.failed}` };
        const inline = `data:image/jpeg;base64,${fs.readFileSync(put.absPath).toString("base64")}`;
        const qa = await qaPresenterHold(opts.productImageUrl, inline, opts.scalePhrase, opts.sizeClass, opts.cm);
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

  // Large products compose in showcase framing even on the one-shot path —
  // the mode used to be picked inside the spray block, so skipping the spray
  // silently demoted every wholesale case to a chest-up hold.
  const oneMode = opts.wear ? ("wear" as const) : showcase ? ("showcase" as const) : ("hold" as const);
  let composed = preComposed || (await runCompose(opts.scalePhrase, oneMode));
  if (!composed) return { url: null, pass: false, reason: "compose returned nothing", retried: false, composited: false, via: "drawn", failed: [], wrongProduct: false };
  // Apparel used to return pass:true here without ever looking. It is gated
  // now, minus the scale questions that a worn garment cannot answer.
  let qa = preQa || (await qaPresenterHold(opts.productImageUrl, composed, opts.scalePhrase, opts.sizeClass, opts.cm, opts.wear));
  let retried = false;
  if (!qa.pass) {
    // The retry SHOUTS the requirement rather than repeating it — a second
    // identical attempt tends to reproduce the same mistake.
    retried = true;
    const louder = `${opts.scalePhrase || ""} CRITICAL: the previous attempt failed because "${qa.reason}". The product must appear at its stated real-world size, carry the EXACT printed artwork from the reference photo — same characters, same colours, same layout, same logos — and show EVERY unit, box and panel visible in it. Do not simplify it, do not redraw the artwork, do not invent a similar-looking package, do not shrink it to fit a hand.`.trim();
    const second = await runCompose(louder, oneMode);
    if (second) {
      const qa2 = await qaPresenterHold(opts.productImageUrl, second, opts.scalePhrase, opts.sizeClass, opts.cm);
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
  // The paste repair rides with the spray: an engine accurate enough for
  // one-shot delivery doesn't need a photograph glued over its work, and the
  // paste is where the double-product frames came from. PRESENTER_PASTE=1
  // turns it back on alongside PRESENTER_SPRAY for experiments.
  const needsRepair = process.env.PRESENTER_PASTE === "1" && qa.bad.some((k) => IDENTITY_FIELDS.includes(k));
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
    const qa3 = await qaPresenterHold(opts.productImageUrl, inline, opts.scalePhrase, opts.sizeClass, opts.cm);
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
  if (!takeArtSlot()) return; // shared cosmetic-render ceiling
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
      releaseArtSlot();
    }
  })();
}

/* ── AD FORMATS: the statistically-proven static compositions (callouts,
 * review card, text convo, us-vs-them, before/after, offer, feed-native).
 * Copy per product from Claude, layout rendered by nano-banana AROUND the
 * real product photo, vision-QA'd for spelling + product fidelity. */

function formatLayoutPrompt(
  key: string,
  c: Record<string, string>,
  hero?: string,
  /** The finished shape this frame is rendered at. Defaults to the square the
   *  ad formats were designed for; the video keyframe path renders 9:16 and
   *  used to inherit "square 1:1" here, telling the model to compose for one
   *  shape while asking the renderer for another. */
  shape = "square 1:1",
  /** The rotated surface/backdrop/light for THIS render, so a burst of one
   *  product does not come back as N identical centred-box studio shots. Only
   *  the real-merchant format path passes it; previews and video keyframes omit
   *  it and keep the stable default so the format gallery never shifts. Used
   *  only by the formats whose backdrop was generic to begin with — themed
   *  layouts (neon dark, seasonal snow, origin craft, gift wrap, weather) keep
   *  their own look. */
  backdrop?: string,
): string {
  const bg = backdrop || "a soft solid-color studio background that complements its palette";
  // Real merchant ads pass the product photo as image_input; self-forged
  // previews describe an EasyMode-branded hero product in text instead.
  const productClause = hero
    ? `The hero product is ${hero}. Any wordmark or label on it must read exactly "EASYMODE" — spelled E-A-S-Y-M-O-D-E in clean capital letters — and contain no other readable words.`
    // The second sentence is the one qaFormat hard-fails on and nothing here
    // was asking for it: the gate rejects an ad that copied a watermark, price
    // badge or marketing caption out of the SOURCE photo's background, while
    // the prompt only ever locked the product's OWN printing. Merchants
    // photograph products against their supplier's branded backdrop all the
    // time, so the model copied it in good faith and the render was thrown
    // away. Same clause the compose modes use, word for word.
    : "The product from the provided image must stay perfectly identical — same shape, colors, label, logos, and every printed code, serial and number reproduced character for character, never redrawn, re-numbered or warped. Keep every BRAND NAME and LOGO WORDMARK on the product spelled exactly as it appears — never re-letter it (do not turn \"HERO\" into \"MERO\" or \"Blokees\" into \"Blokes\"); if a word cannot be reproduced cleanly, keep the original pixels rather than inventing letters. Reproduce only the physical product; ignore any marketing text or watermark on the reference photo’s background.";
  const base = `Modern high-converting DTC e-commerce static ad, crisp clean design, ${shape}, professional advertising typography. Every text string below must appear EXACTLY as written, perfectly spelled, and you must not INVENT any additional layout text, gibberish or filler anywhere. This rule is about the ad's own copy only: the words already printed on the product itself are part of the product and must be reproduced exactly as they appear in the photograph — every character, code, serial and number identical, never re-lettered, never re-numbered, never tidied up. Each string appears ONCE, in the SAME LANGUAGE it is written in above — reproduce it exactly, never translate it, never transliterate it — and it must read as correct, grammatical text in that language: never repeat or stutter a word or phrase inside a sentence ("we still each still got", "first try first try" are failures), never re-render the same line twice. ${productClause}`;
  switch (key) {
    case "callout": {
      // Count-adaptive: formatCopy may have deleted duplicate chips, so draw one
      // annotation line per SURVIVING distinct label rather than always asking
      // for four (which would leave an empty chip or re-double the deleted one).
      const chips = [c.c1, c.c2, c.c3, c.c4].map((s) => (s || "").trim()).filter(Boolean);
      const n = chips.length;
      const word = n >= 4 ? "Four" : n === 3 ? "Three" : n === 2 ? "Two" : "One";
      const list = chips.map((s) => `"${s}"`).join(", ");
      return `${base} Layout: the product large in the center on ${bg}. ${word} thin dark annotation line${n === 1 ? "" : "s"} point to different parts of the product, each ending in a small bold label chip reading exactly: ${list}. Bold headline at the top: "${c.headline}". A small rounded button at the bottom center: "${c.cta}".`;
    }
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
      return `${base} Layout: the value "${c.stat}" rendered HUGE — filling most of the upper half in ultra-bold type on ${bg} — with "${c.statlabel}" in smaller text directly beneath it. The product stands in the lower right, hero-lit. Small confident headline at the bottom left: "${c.headline}". A rounded button bottom center: "${c.cta}".`;
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
      return `${base} Layout: two complementary products side by side, angled slightly toward each other like a pair, on ${bg}. Headline at the top: "${c.headline}". A small label chip under the left item: "${c.pair1}" and under the right item: "${c.pair2}". A plus sign floats between them.`;
    case "receipt":
      return `${base} Layout: a tall paper receipt filling one side, printed with the item line "${c.item}" and the price "${c.price}", plus a stamped note reading "${c.memo}". Bold headline beside it: "${c.headline}". The product stands next to the receipt, hero-lit. Charming price-anchoring energy.`;
    case "tierlist":
      return `${base} Layout: a ranking card: a large glowing "S" tier badge at the top left with the product sitting proudly on that row. Headline: "${c.headline}". Sub-line: "${c.tagline}". Game-culture aesthetic that still looks clean and premium.`;
    case "swatch":
      // A COLOUR STORY, NOT FOUR COLOURWAYS.
      //
      // This used to ask for "the product line-up shown in four color
      // variants" while `base` in the same string demands the product stay
      // identical, "same colors ... never redrawn". The model either drew four
      // identical units under four different colour names, or repainted three —
      // which is precisely what qaFormat's productIntact question is written to
      // reject, so the format failed QA twice and the merchant silently got a
      // generic scene ad instead of the format they paid for.
      //
      // And there was no truth behind it either: CatalogProduct stores no
      // variant data, so sw1-sw4 were invented names. Every other field in the
      // guide forbids inventing facts — real spec numbers, no fake outlets, no
      // invented sales counts — while this one advertised colourways the store
      // may not sell.
      //
      // The palette is now presented AS a palette, drawn from the product's own
      // colours, which is honest and needs no data we do not have.
      return `${base} Layout: the product shown ONCE, exactly as photographed, standing to the right on a clean editorial backdrop. Down the left, a vertical column of four large round colour dots in a harmonious palette taken from the product's OWN colours, each with its name in a small chip beside it: "${c.sw1}", "${c.sw2}", "${c.sw3}", "${c.sw4}". These dots are a colour palette that accompanies the product — they are NOT alternative versions of it: never recolour, repaint, duplicate or restyle the product itself, and never show more than one of it. Headline at the top: "${c.headline}". Calm editorial colour-story energy.`;
    default:
      return base;
  }
}

// With no merchant direction, every ×N take and every catalogue product reaches
// for the same hook — the live-QA sweep saw a "{N} {items}. ZERO/ONE..."
// skeleton on 5 of 8 outputs and the exact phrase "ZERO GUARANTEES" on two ads
// for one product. Rotating a lead angle per generation spreads them apart
// without touching grounding (it steers the ANGLE, never the facts).
const AD_ANGLE_LENSES = [
  "lead with the single biggest benefit of owning it",
  "open with a curiosity gap or a question already in the buyer's head",
  "lead with the exact moment or use-case where it earns its place",
  "lead with what sets it apart from the obvious alternative",
  "lead with the feeling of owning it, not a feature list",
  "lead with who it's perfect for",
];

// The COPY angle rotated per take, but the BACKDROP never did: with no merchant
// direction every scene ad fell back to one BRIGHT_DEFAULT studio wash and every
// generic format hard-coded "a soft solid-color studio background", so a ×10
// burst of one product came back as ten near-identical centred-box shots that
// differed only in headline — a prod QA sweep called the set "repetitive" (one
// composition, only the tint moved). Rotate the SURFACE/BACKDROP/LIGHT per
// render too. Every preset is bright, clean and premium (the fidelity gate
// rejects dark/murky), reads correctly after "on " in a format layout AND stands
// alone as a scene brief, and names no objects/props/people so it stays
// compatible with the "completely empty scene" backdrop prompt.
const BACKDROP_PRESETS = [
  "a soft seamless studio sweep in a gentle color that complements the product, even daylight-quality light",
  "a natural wood tabletop with a soft, bright, out-of-focus backdrop, warm gentle light and soft shadows",
  "a smooth pale stone or concrete surface with a clean bright backdrop, crisp editorial light",
  "a soft pastel paper-gradient backdrop that complements the product, bright and airy",
  "a polished light marble surface with a soft bright backdrop, premium glossy light",
  "a warm neutral linen-fabric surface with a softly lit bright backdrop, cozy diffused light",
  "a minimalist raised pedestal against a soft complementary backdrop, clean directional side light",
  "a bright tabletop with soft daylight and gentle natural shadows, fresh and airy",
];
// A rotating cursor, not Math.random(): burst jobs run back-to-back through the
// worker, so stepping the cursor hands consecutive takes different backdrops
// instead of letting random collisions re-cluster them. Resets per process; that
// is fine — it only needs to spread the takes within a run.
let backdropCursor = 0;
const pickBackdrop = () => BACKDROP_PRESETS[backdropCursor++ % BACKDROP_PRESETS.length];

async function formatCopy(
  formatKey: string,
  fields: string[],
  productTitle: string,
  tone: string | undefined,
  direction: string | undefined,
  contentLang?: string | null,
  merchantOffer?: string | null,
  /** The merchant's ACTUAL price for this product, verbatim from the
   *  catalogue. Undefined when we do not know it — in which case no format
   *  may print a number. */
  productPrice?: string | null,
  /** The merchant's own product description, verbatim from the catalogue/scrape.
   *  The ONLY source the copywriter may draw specs from; null when unknown, in
   *  which case the copy stays on benefits rather than inventing specifics. */
  productDetails?: string | null
): Promise<Record<string, string> | null> {
  try {
    const angleLens = direction
      ? null
      : AD_ANGLE_LENSES[Math.floor(Math.random() * AD_ANGLE_LENSES.length)];
    // Drop the merchant's "– Comic-Con Pick" / "– Hot Deal" promo suffix so the
    // copywriter writes from the real product, not a store label it would inflate
    // into "COMIC-CON'S PICK" or just echo (also frees it to vary the hook).
    const title = stripPromoTag(productTitle);
    const prompt = [
      `You write short, punchy copy for a "${formatKey}" style e-commerce static ad.${langDirective(contentLang)}`,
      `Product: "${title}".`,
      productDetails
        ? `The merchant's own description of this product — the ONLY facts you may treat as true, so draw the real specifics from here:\n"${productDetails}"`
        : "",
      tone ? `Brand tone: ${tone}.` : "",
      direction ? `Angle: ${direction.slice(0, 160)}.` : `Lead angle for THIS take: ${angleLens}.`,
      `Return ONLY JSON with exactly these string fields: ${fields.map((f) => `"${f}"`).join(", ")}.`,
      `Field guide: headline ≤ 6 words (a confident statement); c1-c4 are benefit labels of 1-2 SHORT, plainly-spelled, common words each (the image renderer garbles long or unusual words, so prefer "Model kits", "Blind box", "9 figures" over "Buildable", "Collector appeal" or "Crossover"); cta ≤ 3 words; quote is a believable customer review of 8-13 words (first person, specific, no hype-words like "amazing"); name is a first name + last initial; m1-m4 are casual lowercase text messages of 4-12 words that read like real friends (m2 and m4 are from the person who owns the product); r1-r3 are 2-4 word advantages of THIS product; t1-t3 are the matching 2-4 word weaknesses of the GENERIC/ordinary alternative in general — never a named competitor and never an invented specific claim; before/after are 3-6 word captions, each a natural phrase a person would say out loud, not a keyword string, and must not claim a specific measurable result or timeframe unless the product details state it; offer is a benefit or invitation flash of 2-4 words ("Own the set", "New arrival") and MUST NOT contain a number, a percentage, a currency amount, or the words sale/off/free/save/deal/discount; caption is a lowercase social caption of 6-11 words; sub ≤ 8 words; stat is a REAL product fact as a short number ("300mg", "12", "10 sec") with statlabel 2-4 words — NEVER an invented customer statistic, survey result or percentage of buyers; masthead is the brand or product name, one or two words; cover1/cover2 are witty magazine cover lines ≤ 7 words; d1-d3 are 2-3 word sensory/texture/finish labels — a MATERIAL name (e.g. "full-grain leather") only if it is in the product details, otherwise a feel or finish word; i1-i3 are 2-4 word included-item or benefit labels — an included ITEM only if the product details confirm it is in the box; note is a sincere founder note of 12-16 words, one or two short sentences, with zero hype; founder is "FirstName, founder"; question ≤ 6 words and playful; left is the boring generic alternative in 2-3 words; right is the product's short name; tweet is a casual lowercase first-person post of 10-16 words, specific and funny, no hashtags; handle for the tweet format is @ plus a short lowercase invented username (never a real person); query is a "<category> for <need>" search of 3-6 words — no "best"/"top" superlative; s1-s3 are autocomplete suggestions that extend the query, 3-6 words; title is a lowercase notes-list title ≤ 6 words; n1-n4 are lowercase checklist items of 3-6 words; alerttitle is the brand or product name; alertbody is a friendly ≤ 10 word nudge; w1-w3 are full reasons of 3-6 words; math is a cost-per-use line ONLY when BOTH the real price AND the real unit count (servings/uses) are given — arithmetic on those two numbers, never an invented count or price; punchline ≤ 7 words; answer is a confident 6-12 word answer grounded in the product's real given features or benefits — never an unsupported efficacy or results promise ("yes it works", "guaranteed results"); praise is an editorial one-liner ≤ 12 words in third person; outlet is an INVENTED tasteful publication name of 2-3 words — NEVER a real magazine, newspaper or website; step1-3 are 2-5 word action steps in order; badge is a 2-3 word FACTUAL tag drawn from the product details (a real material, included item or truthful status) — NEVER an invented award, ranking or endorsement ("Editor's Pick", "#1", "Award winner") and never a scarcity claim; urgency is an availability line ONLY if the product details state it (e.g. "Restocked today") — NEVER invent scarcity ("Limited run", "selling fast", "last chance", "almost gone") or a sales number or count; g1-g3 are real ingredient or component names of 1-3 words; k1-k4 are lowercase relatable "that's me" moments of 3-5 words; f1-f3 are punchy TRUE facts about THIS product only (3-7 words) — never a "most people…"/category statistic or a claim about competitors; am starts "Morning:" and pm starts "Night:", each ≤ 6 words after the colon; tq1-tq3 are mini review quotes of 3-6 words with tn1-tn3 as first name + last initial; pov starts "POV:" and is 5-9 words; b1-b3 are included-item lines of 2-5 words — only items the product details confirm are included in the kit; word is ONE powerful word ending in a period; line1/line2 are warm chalkboard lines of 3-6 words; bubble is the product playfully "speaking" in 2-6 words — it must be a natural, grammatical phrase a person would actually say; never force a pun that breaks the sentence; v1/v2 are REAL product spec numbers with l1/l2 as their 2-4 word labels — never invented customer stats; origin is one craft or materials line of 5-10 words drawn from the product details — never an invented "hand-made"/"small-batch"/"one workshop" or place claim; if no craft facts are given, write a benefit line instead; tagline is a witty 4-8 word line; pair1/pair2 are short names for the two paired items; item is the product's short name, price a plausible price like "$29", memo is a lowercase 3-5 word benefit or price-anchor aside — never a first-person ownership or durability claim ("survived three winters"); sw1-sw4 are one-or-two-word names for colours that are ACTUALLY PRESENT IN THE PRODUCT PHOTO — they label a palette drawn from the product itself, NEVER alternative colourways or variants, which the store may not sell; handle for the breakout format is the brand name in caps, no @ and no invented engagement numbers; caption for the breakout format is a scroll-stopping 5-10 word line.`,
      `Within ANY numbered set of labels (c1-c4, i1-i3, g1-g3, r1-r3, t1-t3, b1-b3, d1-d3, s1-s3, w1-w3, k1-k4, n1-n4, cover1-cover2, v1-v2), every entry must be DISTINCT — never repeat a phrase and never merely restate the same point twice. Each must add something new.`,
      `RENDERABILITY: every short overlay label (the chips, badges, CTA, stat labels, checklist and callout lines) must use SHORT, common, plainly-spelled words. The image model drops or doubles letters in long or unusual words — "Buildable" comes back "Buildale", "Collector" becomes "Sollector" — so choose a shorter, simpler synonym the renderer can spell. Keep each such label to words of about seven letters or fewer where you can.`,
      // The merchant is the ONLY source of a discount. Anything we invent is a
      // promise their shop never agreed to honour.
      merchantOffer
        ? `The merchant IS running this promotion, word for word: "${trimToWord(merchantOffer, 60)}". Use it verbatim wherever an offer appears.`
        : `The merchant is NOT running any promotion. NEVER invent a discount, percentage, sale, coupon, price cut, free shipping or any saving. Sell the product on what it IS.`,
      // THE PRICE IS NOT OURS TO INVENT EITHER.
      //
      // The guide used to say: price a plausible price like "$29", and math a
      // cost-per-use line "derived from plausible pricing". Those strings are
      // then printed as the headline number of a receipt ad or rendered HUGE
      // in the centre of the frame. A merchant selling a $79 product got an
      // ad announcing $29 — a false advertised price, worse than the invented
      // discount three lines above, because the shopper clicks through
      // expecting the number. The real one is in CatalogProduct.priceText and
      // was simply never forwarded.
      productPrice
        ? `The product’s REAL price is "${productPrice}". Wherever a price appears, reproduce that string EXACTLY — never round it, never restate it in another currency, never make up a different one. Any per-use or per-serving figure must be arithmetic on that number and nothing else.`
        : `You do NOT know this product’s price. Never write a currency amount anywhere — no price, no cost-per-use, no per-serving figure, no “from $…”. Sell it on what it is instead.`,
      // GROUND EVERY SPEC, AND MAKE IT SPECIFIC. The copy prints on a paid ad
      // the merchant runs as fact: an invented spec ("14-day battery", "2%
      // hyaluronic acid") is a false-advertising claim they are liable for, and
      // generic copy that would fit any product is why a catalogue's ads all
      // read alike. Real description text fixes both at once.
      `Only state a concrete spec, measurement, material, ingredient, capacity, battery life, size, certification, award, guarantee/warranty/return policy, origin, craft or handmade process, included item, quantity or number if it appears in the product details above${productDetails ? "" : " — and NONE were provided for this product"}. If a specific is not given, do NOT invent one: write a benefit, feeling or use-case instead. Invent no customer counts, star ratings, "#1"/"best-seller"/tier rankings, press quotes, awards, guarantees, warranties or scarcity figures. Make every line SPECIFIC to THIS product's real details — never a generic line that would fit any product.`,
      // The sweep's "sameness" finding: with grounding on, the copy was accurate
      // but every blind-box product got the same "{N} {items}. ZERO/ONE..."
      // headline shape, so a feed of them reads as one duplicated ad.
      `VARY THE STRUCTURE. Do not default to a numeral-count opener ("Nine heroes", "Six dolls") or a "{Number} X. One/Zero Y." template — that one skeleton makes a catalogue's ads read alike. Pick a different headline shape: a question, a benefit claim, a use-case, a contrast, or the feeling of owning it. Never reuse hook words you would put on a different product.`,
      // Grounding stopped invented SPECS; the live-QA sweep then caught invented
      // CLAIMS built on the real nouns — a "Comic-Con Pick" tag rewritten as
      // "COMIC-CON'S MOST-HUNTED" (implied endorsement) and a Chinese Pokémon
      // pack sold as "Authentic Pokémon TCG" (unverifiable provenance). Same
      // paid-ad liability as a false spec; shared rule so every generator agrees.
      CLAIMS_GUARDRAIL,
      // From a full 49-template sweep: every remaining defect was text. Two of
      // them were written wrong before anything was rendered — an apostrophe
      // dropped ("thats"), and a Versus ad whose two columns contradicted each
      // other. Neither is the image model's fault.
      `Punctuation must be correct — write "that's", "you're", "it's", "won't", "can't", "don't" with apostrophes, never "thats", "youre", "wont" or "cant".`,
      // A live ad shipped with the subhead "REUSABLE BIRTHDAY DRAMA ZERO
      // CALORIES." — three ideas jammed together with no grammar between
      // them. The before/after fields already carried a "not a keyword
      // string" rule because the same thing happened there; every prose
      // field needs it, not just those two.
      `Every field that is a phrase or a sentence — headline, sub, quote, caption, note, praise, answer, punchline, tagline, origin, before, after, bubble, tweet, alertbody, pov — must be NATURAL LANGUAGE a person would actually say out loud, with the small words left in. Never a keyword string: "Reusable birthday drama zero calories" is three ideas with the grammar removed, and it reads as broken on the finished ad. If it will not fit as a sentence, say less, not more.`,
      `Fields that pair up must agree and never contradict: the US column must not claim something the THEM column also claims, before/after must describe the same situation improving, and no two fields may make opposite promises about the same thing.`,
      // The renderer draws this text into a fixed layout, and the sweep's
      // cut-offs ("duplica" for "duplicates") were simply strings too long for
      // the space they were given.
      `Keep every value SHORT. Long strings get cut off mid-word when drawn into the layout, so prefer the low end of each range and never exceed it.`,
      `No emoji, no hashtags, no quotes inside values.`,
    ].filter(Boolean).join("\n");
    // Which label slots may be empty without failing the format (reused in the
    // field loop below). Defined up here so the tool schema can mark them
    // non-required: c1 and c2 are needed (a callout needs two points), c3/c4 may
    // drop out. A model that cannot fill an optional chip still returns valid copy.
    const OPTIONAL: Record<string, Set<string>> = { callout: new Set(["c3", "c4"]) };
    const optional = OPTIONAL[formatKey] || new Set<string>();
    let raw: string;
    try {
      // sonnet-5, left to free text on this huge prompt, answered in PROSE ~3 of
      // every 4 tries (live logs: "no-json len≈1300") and it 400s on the "{"
      // prefill trick. A FORCED tool call is the supported way to compel a JSON
      // object; anthropicText returns JSON.stringify(tool input), so the parse
      // path below is unchanged. maxTokens 600 is ample; output is billed as used.
      const schema = {
        type: "object",
        properties: Object.fromEntries(fields.map((f) => [f, { type: "string" }])),
        required: fields.filter((f) => !optional.has(f)),
      };
      raw = await anthropicText(prompt, { model: "claude-sonnet-5", maxTokens: 600, jsonSchema: { name: "ad_copy", schema } });
    } catch (e) {
      // anthropicText THROWS on a 4xx/5xx that outlived its retries (a 429 in a
      // ×N burst is the usual one). That throw used to be swallowed as a bare
      // "copy-failed", indistinguishable from the model returning unusable copy.
      // Name it so the logs separate an API outage from a real copy problem.
      console.log(`[image-ad] formatCopy ${formatKey} api-error: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
      return null;
    }
    const m = raw && raw.match(/\{[\s\S]*\}/);
    if (!m) {
      console.log(`[image-ad] formatCopy ${formatKey} no-json (len=${(raw || "").length})`);
      return null;
    }
    // Tolerate the one well-formed-but-unparseable quirk the {…} slice doesn't
    // already handle: a trailing comma before a closing brace/bracket. (A ```json
    // fence is harmless — the slice starts at the first "{".)
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(m[0].replace(/,\s*([}\]])/g, "$1")) as Record<string, unknown>;
    } catch (e) {
      console.log(`[image-ad] formatCopy ${formatKey} parse-error: ${(e instanceof Error ? e.message : "").slice(0, 80)}`);
      return null;
    }
    const out: Record<string, string> = {};
    // (OPTIONAL / optional defined above, before the tool call, so the schema and
    // this loop agree on which slots may drop out.)
    for (const f of fields) {
      // tidyAdCopy is a DETERMINISTIC repair, not a second opinion. Once this
      // string reaches the image model it is baked into pixels, so a dropped
      // apostrophe is not a typo the merchant can edit — it is a re-render, or
      // an ad they post with a spelling mistake on it. A live ad shipped
      // reading "FINALLY A CAKE THAT WONT CRUMBLE" despite the instruction
      // below spelling out the rule. Instructions lower the rate; this takes
      // the mechanically-decidable part of it to zero.
      // dropOrgEndorsementPossessive is the deterministic backstop to the claims
      // guardrail: "COMIC-CON'S PICK" -> "COMIC-CON PICK" even when the model
      // ignores the prompt rule (it did, when the tag sat in the product title).
      const v = dropOrgEndorsementPossessive(tidyAdCopy(typeof j[f] === "string" ? (j[f] as string).replace(/["“”]/g, "") : ""));
      if (!v) {
        if (optional.has(f)) continue; // drop an optional empty chip; don't fail the format
        console.log(`[image-ad] formatCopy ${formatKey} empty-required-field: ${f}`);
        return null;
      }
      out[f] = v;
    }
    // Belt and braces on the one field that can promise the merchant's money
    // away: their exact words win, and any invented discount that survived the
    // instruction gets scrubbed rather than shipped.
    // The same belt-and-braces as `offer`, for the same reason: an invented
    // number that survived the instruction must not reach the canvas.
    if (typeof out.price === "string") {
      if (productPrice) out.price = productPrice;
      else if (/[\d$£€¥]/.test(out.price)) return null; // no price on file — this format cannot run truthfully
    }
    if (typeof out.math === "string" && !productPrice && /[\d$£€¥]/.test(out.math)) return null;

    // These formats' required fields ARE the factual claim — a hero number
    // (stat / statgrid), the ingredient list (ingredients), the kit contents
    // (bundle). With no merchant description to ground them the model can only
    // fabricate, so bail to the scene ladder, exactly like price/math above.
    if (!productDetails && ["stat", "statgrid", "ingredients", "bundle"].includes(formatKey)) return null;
    // Number Flex / Spec Sheet are pointless without a real number — if the model
    // could not surface one it wrote a word, so don't ship a fabricated hero.
    if (typeof out.stat === "string" && !/\d/.test(out.stat)) return null;
    if (typeof out.v1 === "string" && typeof out.v2 === "string" && !/\d/.test(out.v1 + out.v2)) return null;
    // Badge backstop: an invented award, ranking, guarantee or scarcity badge
    // that survived the field-guide rule is swapped for a neutral non-claim
    // rather than shipped (the deterministic twin of the claims guardrail).
    if (typeof out.badge === "string" && /editor'?s?\s*pick|staff\s*pick|#\s*1|\bbest\s*sell|award|limited|exclusive|\brare\b|sold\s*out|selling\s*fast|last\s*chance|lifetime|forever|guarantee|guaranteed|warranty|money.?back|refund|satisfaction/i.test(out.badge)) {
      out.badge = formatKey === "seasonal" ? "New drop" : "Gift ready";
    }

    if (out.offer) {
      const invented = /\d|%|\$|\b(off|sale|free|save|deal|discount|coupon|limited|exclusive|hurry|last\s*chance|selling\s*fast|while\s*supplies)\b/i.test(out.offer);
      out.offer = merchantOffer ? trimToWord(merchantOffer, 40) : invented ? "Own the set" : out.offer;
    }
    // No two callout benefit chips may be identical — a repeat renders a doubled
    // label on the ad ("Nine to collect" twice). Drop later duplicates
    // (case/punctuation-insensitive). Deleting the key (not blanking) keeps the
    // chip out of Object.values(copy), so the QA gate's expected-strings list
    // matches what the count-adaptive callout layout actually draws.
    if (formatKey === "callout") {
      const seen = new Set<string>();
      for (const k of ["c1", "c2", "c3", "c4"]) {
        const norm = (out[k] || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
        if (!norm || seen.has(norm)) delete out[k];
        else seen.add(norm);
      }
    }
    return out;
  } catch (e) {
    // The field-processing path (tidyAdCopy, the guardrail scrubs) threw. Rare,
    // but it was silent; name it so no copy-failed cause stays invisible.
    console.log(`[image-ad] formatCopy ${formatKey} threw: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
    return null;
  }
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
  /** The merchant's real price, when the catalogue has one. */
  productPrice?: string | null;
  /** The merchant's real product description — the only source of truth for
   *  specs. Null when unknown; copy then avoids specifics. */
  productDetails?: string | null;
}): Promise<FormatRunResult> {
  const nil = (fallback: string): FormatRunResult =>
    ({ imageUrl: null, copy: null, prompt: null, qaPass: false, qaReason: "", retried: false, fallback });

  // The merchant PICKED this format. Losing it silently and shipping a generic
  // scene instead is the worst possible outcome, so copy gets THREE chances —
  // the live logs showed "copy-failed" (the copywriter returning unparseable or
  // short JSON) was a leading callout reject, and each attempt is independent.
  let copy = await formatCopy(opts.formatKey, opts.fields, opts.productTitle, opts.tone, opts.direction, opts.contentLang, opts.merchantOffer, opts.productPrice, opts.productDetails);
  if (!copy) copy = await formatCopy(opts.formatKey, opts.fields, opts.productTitle, opts.tone, opts.direction, opts.contentLang, opts.merchantOffer, opts.productPrice, opts.productDetails);
  if (!copy) copy = await formatCopy(opts.formatKey, opts.fields, opts.productTitle, opts.tone, opts.direction, opts.contentLang, opts.merchantOffer, opts.productPrice, opts.productDetails);
  if (!copy) {
    // Two formats need real money on the canvas. With no price in the
    // catalogue for this product the copywriter is forbidden to write one, so
    // the rung genuinely cannot run — and falling to a scene ad is the right
    // outcome, but it must be SAID rather than looking like a random failure.
    const needsMoney = opts.formatKey === "receipt" || opts.formatKey === "pricemath";
    if (needsMoney && !opts.productPrice) {
      console.log(`[image-ad] format ${opts.formatKey} needs the product’s real price and the catalogue has none for “${opts.productTitle}” — falling to a scene ad rather than printing a made-up number`);
      return nil("no-price-on-file");
    }
    return nil("copy-failed");
  }

  // CALLOUT → DETERMINISTIC FIRST. A prod burst showed the generative callout,
  // even when the short-word steering lets its text pass the gate, still (a)
  // lets the image model add a DUPLICATE chip it was never asked for and (b)
  // re-letters the brand ("HERO" -> "ARERO"). Drawing the chips/headline
  // ourselves on the real cutout fixes BOTH and guarantees perfect spelling, so
  // for callout we prefer it outright rather than only as a failure repair. The
  // generative path below is the safety net: if the composite can't be produced
  // or its re-QA fails, we fall straight through to it, so a bug here can never
  // break callouts.
  if (opts.formatKey === "callout") {
    const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    const chips = [copy.c1, copy.c2, copy.c3, copy.c4].map((c) => (c || "").trim()).filter(Boolean);
    if (base && chips.length >= 2) {
      const det = await renderCalloutComposite({
        productImageUrl: opts.productImageUrl,
        headline: copy.headline || "",
        cta: copy.cta || "",
        chips,
        contentLang: opts.contentLang,
        styleDesc: pickBackdrop(),
      });
      if (det) {
        const detUrl = `${base}/renders/${det.file}`;
        const qaD = await qaFormat(detUrl, opts.productImageUrl, Object.values(copy), [opts.productTitle]);
        if (qaD.pass) {
          console.log(`[image-ad] format callout: deterministic text-overlay (primary) — perfect text + real product`);
          return { imageUrl: detUrl, copy, prompt: "deterministic-callout", qaPass: true, qaReason: "clean (deterministic callout)", retried: false, fallback: null };
        }
        console.log(`[image-ad] format callout: deterministic (primary) re-QA failed (${qaD.reason}) — trying generative`);
      } else {
        console.log(`[image-ad] format callout: deterministic (primary) not produced — trying generative`);
      }
    }
  }

  // NUMBER FLEX (stat) → DETERMINISTIC FIRST, same reasoning as callout: the
  // generative render re-letters the product's brand wordmark and can mangle the
  // hero number's unit — and a stat ad is nothing if the number is wrong.
  // Drawing the number/label/headline on the real cutout makes the number and
  // brand exact. The generative path below stays the safety net: a null composite
  // or a re-QA failure falls straight through, so a bug here can't break stat ads.
  if (opts.formatKey === "stat") {
    const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    if (base && (copy.stat || "").trim()) {
      const det = await renderStatComposite({
        productImageUrl: opts.productImageUrl,
        stat: copy.stat || "",
        statlabel: copy.statlabel || "",
        headline: copy.headline || "",
        cta: copy.cta || "",
        contentLang: opts.contentLang,
        styleDesc: pickBackdrop(),
      });
      if (det) {
        const detUrl = `${base}/renders/${det.file}`;
        const qaD = await qaFormat(detUrl, opts.productImageUrl, Object.values(copy), [opts.productTitle]);
        if (qaD.pass) {
          console.log(`[image-ad] format stat: deterministic number-flex (primary) — perfect number + real product`);
          return { imageUrl: detUrl, copy, prompt: "deterministic-stat", qaPass: true, qaReason: "clean (deterministic stat)", retried: false, fallback: null };
        }
        console.log(`[image-ad] format stat: deterministic (primary) re-QA failed (${qaD.reason}) — trying generative`);
      } else {
        console.log(`[image-ad] format stat: deterministic (primary) not produced — trying generative`);
      }
    }
  }

  // US-VS-THEM (versus) → DETERMINISTIC FIRST. Versus is the most structurally
  // complex format, so the generative render both DRIFTS off the two-column
  // layout (logs showed it collapsing to a hero) and re-letters text/brand.
  // Drawing the whole comparison table ourselves guarantees the structure, the
  // ✓/✗ marks, every label and the brand. Generative stays the safety net.
  if (opts.formatKey === "versus") {
    const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    const us = [copy.r1, copy.r2, copy.r3].map((c) => (c || "").trim()).filter(Boolean);
    const them = [copy.t1, copy.t2, copy.t3].map((c) => (c || "").trim()).filter(Boolean);
    if (base && us.length >= 2 && them.length >= 2) {
      const det = await renderVersusComposite({
        productImageUrl: opts.productImageUrl,
        headline: copy.headline || "",
        us,
        them,
        contentLang: opts.contentLang,
        styleDesc: pickBackdrop(),
      });
      if (det) {
        const detUrl = `${base}/renders/${det.file}`;
        const qaD = await qaFormat(detUrl, opts.productImageUrl, Object.values(copy), [opts.productTitle]);
        if (qaD.pass) {
          console.log(`[image-ad] format versus: deterministic us-vs-them (primary) — perfect table + real product`);
          return { imageUrl: detUrl, copy, prompt: "deterministic-versus", qaPass: true, qaReason: "clean (deterministic versus)", retried: false, fallback: null };
        }
        console.log(`[image-ad] format versus: deterministic (primary) re-QA failed (${qaD.reason}) — trying generative`);
      } else {
        console.log(`[image-ad] format versus: deterministic (primary) not produced — trying generative`);
      }
    }
  }

  const prompt = formatLayoutPrompt(opts.formatKey, copy, undefined, undefined, pickBackdrop());
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
    // nano-banana defaults aspect_ratio to "match_input_image", so without
    // this the ad came out shaped like whatever photo the merchant uploaded.
    // Measured across one real account: 71 image ads in NINE different
    // sizes, five of them landscape — auto-posted to feeds that are not.
    // Every layout prompt already asks for "square 1:1" and every kontext
    // fallback below already pins 1:1; only the primary path was letting
    // the input photo decide.
    aspect_ratio: "1:1",
    output_format: "jpg",
  });

  let imageUrl = await renderOnce();
  let qa = await qaFormat(imageUrl, opts.productImageUrl, Object.values(copy), [opts.productTitle]);
  // Retry a REJECTION — the reason tells the model what to fix. Never retry
  // an OUTAGE: the gate learned nothing about this take, so another paid render
  // is money for no information.
  //
  // MORE THAN ONE RETRY, because the live logs proved one was not enough. The
  // dominant format-reject is the image model dropping a letter from its OWN
  // overlay text — "Buildable" came back "Buildale", "Buitdable", "Buidile" on
  // three different tries of the SAME word, so the garble is STOCHASTIC, not a
  // word it simply cannot spell. Independent re-rolls therefore compound: if a
  // clean render is ~40% likely, one try lands 40%, three lands ~78%. Each retry
  // carries the category of what went wrong, never the reviewer's prose.
  const MAX_FORMAT_ATTEMPTS = 3;
  let attempts = 1;
  while (!qa.pass && !qa.degraded && attempts < MAX_FORMAT_ATTEMPTS) {
    attempts++;
    imageUrl = await renderOnce(qa.reason);
    qa = await qaFormat(imageUrl, opts.productImageUrl, Object.values(copy), [opts.productTitle]);
  }
  const retried = attempts > 1;
  if (!qa.pass && !qa.degraded) {
    console.log(`[image-ad] format ${opts.formatKey}: still rejected after ${attempts} attempts (${qa.reason})`);
  }
  // LAST-RESORT REPAIR before the scene fallback. The format rendered but the
  // gate still rejects it — and on a single-hero-product format that is most
  // often the PRODUCT itself (a re-lettered brand wordmark the generator can't
  // spell, a warped box), not the layout text. So keep the format the merchant
  // picked and swap the model's redrawn product for the REAL one, then let the
  // gate judge the result: the re-QA rejects a paste that covered required text
  // or didn't actually help, so only a genuinely-repaired ad ships. Anything
  // else falls through to the scene ad exactly as before. Only on a real
  // rejection (not an outage) and only where a single product box exists.
  let repairedBy = "";
  if (!qa.pass && !qa.degraded) {
    const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    // DETERMINISTIC CALLOUT first. The generative render's TEXT is garbled and no
    // re-roll fixed it (the prod logs proved that is the dominant reject — the
    // model mangling its own chip words), so stop trusting the model to draw
    // words: composite the real product and draw the chips/headline/CTA
    // ourselves. Perfect text, pixel-faithful brand. Re-QA confirms (it will: the
    // exact requested strings are drawn on the real cutout) and a broken
    // composite still falls through to the paste / scene.
    if (opts.formatKey === "callout" && base) {
      const chips = [copy.c1, copy.c2, copy.c3, copy.c4].map((c) => (c || "").trim()).filter(Boolean);
      const det = chips.length >= 2
        ? await renderCalloutComposite({
            productImageUrl: opts.productImageUrl,
            headline: copy.headline || "",
            cta: copy.cta || "",
            chips,
            contentLang: opts.contentLang,
            styleDesc: pickBackdrop(),
          })
        : null;
      if (det) {
        const detUrl = `${base}/renders/${det.file}`;
        const qa2 = await qaFormat(detUrl, opts.productImageUrl, Object.values(copy), [opts.productTitle]);
        if (qa2.pass) {
          console.log(`[image-ad] format callout: deterministic text-overlay kept the format (generative reject was "${qa.reason}")`);
          imageUrl = detUrl; qa = qa2; repairedBy = "deterministic callout";
        } else {
          console.log(`[image-ad] format callout: deterministic overlay re-QA failed (${qa2.reason}) — trying paste/scene`);
        }
      } else {
        console.log(`[image-ad] format callout: deterministic overlay not produced (backdrop/cutout/ffmpeg failed) — trying paste/scene`);
      }
    }
    // PASTE for the other single-hero formats (and callout if the deterministic
    // path could not run): swap the model's redrawn product for the real one.
    if (!repairedBy && PASTE_SAFE.has(opts.formatKey) && base) {
      const pasted = await pasteProductIntoAd(imageUrl, opts.productImageUrl);
      if (!pasted) {
        console.log(`[image-ad] format ${opts.formatKey}: paste-repair not applied (no product box or paste failed); reject was "${qa.reason}"`);
      } else {
        const pastedUrl = `${base}/renders/${pasted.file}`;
        const qa2 = await qaFormat(pastedUrl, opts.productImageUrl, Object.values(copy), [opts.productTitle]);
        if (qa2.pass) {
          console.log(`[image-ad] format ${opts.formatKey}: real-product paste kept the format past a product-fidelity reject (${qa.reason})`);
          imageUrl = pastedUrl; qa = qa2; repairedBy = "real-product paste";
        } else {
          // The paste fixed the product but the gate still rejects — almost always
          // because the ad's OWN overlay text is garbled (which a product swap
          // cannot fix). Logged so the recovery ceiling is visible, not a mystery.
          console.log(`[image-ad] format ${opts.formatKey}: paste fixed the product but re-QA still rejects (${qa2.reason}) — falling to scene`);
        }
      }
    }
  }
  return {
    imageUrl,
    copy,
    prompt,
    qaPass: qa.pass,
    qaReason: repairedBy ? `clean (${repairedBy})` : qa.reason,
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
/** The format gate. FAILS CLOSED, for the same reason qaFidelity does: this
 *  is the only thing standing between a garbled render and the merchant's
 *  feed, and a gate that answers “pass” when it could not look is not a gate.
 *  `degraded` marks “could not judge” so the caller does not spend a second
 *  render arguing with a vision API that is down. */
async function qaFormat(imageUrl: string, productImageUrl: string | null, expected: string[], protect: string[] = []): Promise<{ pass: boolean; reason: string; degraded?: boolean }> {
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
          ? `productIntact: is the product in the ad the same product as image 1 — same shape, colors, packaging artwork, logos — not warped, restyled or reinvented? Compare any printed codes, serials or numbers on the packaging CHARACTER BY CHARACTER against image 1 and answer false if a single character differs. ALSO compare the product's prominent BRAND NAME / LOGO WORDMARK letter by letter: if the ad re-lettered it into a different word — a real render turned "HERO" into "MERO" and "Blokees" into "Blokes" — answer false. (The later rule about ignoring packaging text governs the AD's-own-text checks, NOT this one: here a mangled brand wordmark on the product IS a product-integrity failure.) This is a comparison between the two images, so script and language do not matter — you are checking the ad did not re-letter the product, not whether you personally can read it.`
          : `productIntact: answer true.`,
        `textSensible: does every line of the ad's own text read as grammatical English that makes sense? A repeated word or phrase ("we still each still got", "first try first try") is a FAILURE even though every word in it is spelled correctly. Read each sentence back for SENSE, not spelling.`,
        `textMatches: does the ad's text say the requested strings above — none missing, none cut off mid-word, none invented?`,
        // TRANSCRIBE, don't judge. Asking "does it match?" is a perceptual call,
        // and a one-character corruption of an unfamiliar proper noun reads as a
        // match every time — a real ad shipped "Teraastal Umbreon" for a product
        // called "Terastal Umbreon" and both textSensible and textMatches passed
        // it (textSensible is deliberately told SENSE-not-spelling, and a brand
        // name is not a grammar error). A verbatim transcription lets us diff it
        // in CODE, which turns a judgment call into a string comparison.
        `transcript: transcribe EVERY word of the ad's own added layout text, exactly as rendered, LETTER FOR LETTER, in reading order, space-separated. Copy the GLYPHS you actually see — never the word you expect. If the image shows "Buidable" you write "Buidable"; if it shows "Teraastal" you write "Teraastal"; if a letter is missing or doubled, keep it missing or doubled. Do NOT silently fix a misspelling. Do NOT include text printed on the product packaging.`,
        `noSourceText: has any marketing text, watermark, price badge or caption from the SOURCE photo's background been copied into the ad? Answer true if NOT (the product's own packaging text is expected and fine).`,
        `reason: if anything is false, one short phrase naming the worst problem. Otherwise "clean".`,
        ``,
        // The merchant's product may be covered in Chinese, Japanese, Korean or
        // any other script — that is THEIR PACKAGING, not our typography, and
        // judging it as "gibberish" threw away the format the merchant chose
        // and shipped a generic ad instead.
        `IMPORTANT: ignore text printed on the product or its packaging, including non-Latin scripts and small print. Only judge the ad's added layout text. Non-English packaging is never a failure.`,
        `Reply ONLY JSON: {"productIntact":bool,"textSensible":bool,"textMatches":bool,"noSourceText":bool,"transcript":"...","reason":"..."}`,
      ].join(" "),
      urls,
      // The code-side spell diff (findCorruptedWord) is only as good as this
      // transcript, and the cheap reader SILENTLY AUTO-CORRECTS what it reads —
      // it wrote "Buildable" for a rendered "Buidale", so the diff had nothing
      // to bite on and the garble shipped. sonnet-5 is the reader the rest of
      // this pipeline already trusts for anything quality-critical; the format
      // gate is the last thing between a mangled render and a paid feed, so it
      // gets the same reader. 700 tokens so the transcript never truncates into
      // an unparseable verdict (which would fail-closed and lose the format).
      { model: "claude-sonnet-5", maxTokens: 700 }
    );
    const m = raw && raw.match(/\{[\s\S]*\}/);
    if (!m) {
      console.error(`[image-ad] qaFormat could not parse a verdict from: ${String(raw).slice(0, 300)}`);
      return { pass: false, reason: "qa-unparseable", degraded: true };
    }
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const HARD_FMT = ["productIntact", "textSensible", "textMatches", "noSourceText"] as const;
    const skippedFmt = unanswered(j, HARD_FMT);
    if (skippedFmt.length) {
      console.warn(`[image-ad] qaFormat verdict left ${skippedFmt.join("/")} unanswered`);
      return { pass: false, reason: "qa-unparseable", degraded: true };
    }
    const bad = HARD_FMT.filter((k) => j[k] === false);

    // Mechanical spell-check of the RENDERED words against the words we asked
    // for. Only flags a word that is a near-miss of an expected word — same
    // length ±1 and one edit away — so genuine extra copy the model added is
    // left alone and only corruption of OUR strings fails.
    //
    // MIN_FLAG=6 is load-bearing, not caution. Short English words sit one edit
    // from each other constantly: a "Ship" in the ad against a "Shop" in the
    // requested copy is a one-edit, equal-length match and would fail a
    // perfectly good ad. Corrupted brand names — "Teraastal", "Umbreonn" — are
    // comfortably longer, so the floor costs us nothing real.
    // One shared, tested implementation — see app/lib/text-gate.ts. This and
    // the QA harness had drifted into two different rules.
    const corrupted = findCorruptedWord(expected, protect, typeof j.transcript === "string" ? j.transcript : "");
    if (corrupted && !bad.length) {
      return { pass: false, reason: `textMatches: rendered "${corrupted}" — not the requested spelling`.slice(0, 160) };
    }

    if (!bad.length) return { pass: true, reason: "clean" };
    const why = typeof j.reason === "string" && j.reason ? j.reason : bad.join(", ");
    return { pass: false, reason: `${bad.join("/")}: ${why}`.slice(0, 160) };
  } catch (e) {
    return { pass: false, reason: `qa-outage: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`, degraded: true };
  }
}

/* Self-forged format previews — each tile stars a DIFFERENT EasyMode-branded
 * hero product (skincare, sneakers, coffee, headphones…) from the category
 * that most uses that format, so the picker reads "every product type", not
 * "we make drink ads". v2 = per-format hero products (v1 was all-bottle). */
const FORMAT_PREVIEW_VERSION = 2;
// Per-key bumps (mirrors the tile system): poster v3 composites the canonical
// statue bottle instead of describing a drink in text — one bottle everywhere.
const FORMAT_PREVIEW_KEY_VERSIONS: Record<string, number> = {
  // v2 showed four colourways; the format is a colour story now.
  swatch: 3,
  poster: 3,
  // v2 shipped a headline the format never asked for — testimonialwall requests
  // three review cards and nothing else — and misspelled it: "FALL ASALEP
  // FASTER". It sat in the format picker every merchant browses. The base
  // prompt already forbids invented text; the model added it anyway, so the
  // only remedy is to forge the tile again.
  testimonialwall: 3,
};
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
  if (!takeArtSlot()) return; // shared cosmetic-render ceiling
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
      releaseArtSlot();
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
  if (!takeArtSlot()) return; // shared cosmetic-render ceiling
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
      releaseArtSlot();
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
  if (!takeArtSlot()) return; // shared cosmetic-render ceiling
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
      releaseArtSlot();
    }
  })();
}

/* Covers for the three PRESET content types in the Studio picker (UGC
 * Review / Unboxing / Satisfying Close-Up). Composited from the canonical
 * statue bottle — same reference as every other tile — so the picker reads
 * as one brand. Self-forge once, same lifecycle as phcover. */
const CT_COVER_VERSION: Record<string, number> = { review: 1, unboxing: 1, asmr: 1 };
// KEEP IN SYNC with the COVERS list in scripts/video-qa.ts (QA_FLANKS) — the
// harness renders approval previews from these exact prompts.
const CT_COVER_PROMPTS: Record<string, string> = {
  review: "Selfie-style UGC frame: a young woman creator filming herself on her phone in a cozy bedroom lit by a warm ring-light glow, holding the bottle from the reference image up to the lens, mid-review expression, authentic social-feed energy, slightly casual framing.",
  unboxing: "First-impressions unboxing moment: hands lifting the bottle from the reference image out of an open kraft shipping box with crinkled tissue paper, on a warm wooden desk in soft daylight, close and personal framing, genuine excitement in the scene.",
  asmr: "Extreme macro close-up of the bottle from the reference image, condensation droplets rolling down the plastic, dark glossy background, one dramatic beam of light carving the silhouette — oddly satisfying, mesmerizing product photography.",
};
const ctCoverInFlight = new Set<string>();

export function ctCoverFile(key: string): string | null {
  if (!CT_COVER_VERSION[key]) return null;
  const p = path.join(AD_TEMPLATE_DIR, `ctcover-${key}-v${CT_COVER_VERSION[key]}.jpg`);
  return fs.existsSync(p) ? p : null;
}

export function ensureCtCover(key: string): void {
  if (!CT_COVER_PROMPTS[key] || ctCoverFile(key) || ctCoverInFlight.has(key) || !process.env.REPLICATE_API_TOKEN) return;
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  if (!statueFile() || !base) return; // wait for the statue; the next request retries
  if (!takeArtSlot()) return; // shared cosmetic-render ceiling
  ctCoverInFlight.add(key);
  (async () => {
    try {
      const url = await repRun("google/nano-banana", {
        prompt: CT_COVER_PROMPTS[key],
        image_input: [`${base}/ad-templates/statue.png`],
        output_format: "jpg",
      });
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      fs.mkdirSync(AD_TEMPLATE_DIR, { recursive: true });
      fs.writeFileSync(path.join(AD_TEMPLATE_DIR, `ctcover-${key}-v${CT_COVER_VERSION[key]}.jpg`), Buffer.from(await res.arrayBuffer()));
      artLog("ad-templates", `ctcover-${key}: content-type cover forged OK`);
    } catch (e) {
      artLog("ad-templates", `ctcover-${key}: FAILED — ${e instanceof Error ? e.message.slice(0, 200) : e}`);
    } finally {
      ctCoverInFlight.delete(key);
      releaseArtSlot();
    }
  })();
}

export async function ensureAllAdTemplates(): Promise<void> {
  if (await merchantBusy()) return;
  ensurePhCover();
  for (const k of Object.keys(CT_COVER_VERSION)) ensureCtCover(k);
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
export const isExpiringUrl = (u?: string) => !!u && EXPIRING_HOSTS.some((h) => u.includes(h));

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
        // Conditional for the same reason as the heal write below: the caption
        // cache writes this column from a route while this runs in the tick.
        await db.asset.updateMany({ where: { id: a.id, bodyJson: a.bodyJson }, data: { bodyJson: JSON.stringify({ ...body, sourceUrl: undefined }) } });
        continue;
      }
      // Re-forging from the stored prompt only reproduces PROMPT-ONLY ads.
      // A scene ad's prompt is "Place this exact product, unchanged…", a format
      // ad's is a layout brief, a presenter still's is "presenter holding X" —
      // running any of those through flux-schnell with NO product image
      // silently replaced the merchant's ad with a generic, product-less
      // picture. Flag those for regeneration instead of corrupting them.
      const method = body.method || (looksText2img(body.prompt) ? "text2img" : "");
      // AND THERE HAS TO BE A PROMPT TO RE-FORGE FROM.
      //
      // The method check is only half the guard. `method` can be set on an asset
      // whose `prompt` is missing — and that is exactly the population this
      // backfill exists for, since these are old rows written before the prompt
      // was reliably captured (see the ReferenceError note further down). The
      // re-forge then fell back to a generic stock brief and stamped the result
      // healed:true, doing precisely the thing the comment above says must never
      // happen: the merchant opens their Archive and finds a stranger's product
      // where their ad used to be, marked as fine.
      const reforgeable = method === "text2img" || method === "lifestyle";
      if (!reforgeable || !body.prompt) {
        await db.asset.update({
          where: { id: a.id },
          data: {
            bodyJson: JSON.stringify({
              ...body,
              needsRegen: true,
              healSkipped: reforgeable ? "no-prompt" : method || "unknown",
            }),
          },
        });
        console.log(`[image-backfill] asset ${a.id} (${method || "unknown"}) can't be re-forged from its prompt — flagged for regeneration`);
        continue;
      }
      const localUrl = await fluxToDisk(body.prompt);
      // Conditional: the caption cache writes this same column from a route
      // while this runs in the worker tick, and a stale write here would drop
      // the captions a merchant just paid to generate.
      await db.asset.updateMany({
        where: { id: a.id, bodyJson: a.bodyJson },
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
  const fileName = `img-${Date.now()}-${crypto.randomBytes(9).toString("hex")}.jpg`;
  fs.writeFileSync(path.join(dir, fileName), buf);
  try { await mirrorRender(fileName, buf); } catch { /* non-fatal */ }
  return `/renders/${fileName}`;
}

const PLAN_VISUAL_DIRECTION: Record<string, string> = {
  GROW_SALES: "lifestyle product shot, natural lighting, aspirational mood, conversion-optimized",
  LAUNCH_PRODUCT: "bold hero shot, dramatic lighting, excitement and novelty, launch energy",
  // NOT "sale badge aesthetic". Every prompt that interpolates this table ends
  // with "no text, no watermark" — a badge is text, so that phrasing could only
  // ever pull against the instruction, and the model resolves the argument by
  // painting a garbled sticker. The urgency is carried by light and contrast
  // instead; the actual offer copy is the caption's job.
  CLEAR_INVENTORY: "clean product on white, urgent high-contrast clearance energy, bright and punchy",
  BUILD_AWARENESS: "brand story visual, emotional resonance, people + product, editorial style",
};

/* THE SAME DIRECTION, WITH THE SUBJECTS TAKEN OUT.
 *
 * The table above describes the finished AD, and it names its subjects: a
 * "product shot", "people + product", a "sale badge". That reads correctly in
 * the poster and scene prompts, where a product is exactly what we want.
 *
 * On the photo-true rung it is a straight contradiction. That prompt asks for
 * an EMPTY backdrop — "NO products, NO objects, NO people" — because the
 * merchant's real photograph is composited onto it afterwards, which is what
 * makes that rung the one where the product cannot come out wrong. Handing the
 * model "lifestyle product shot" and "NO products" in the same breath invites
 * it to paint a product anyway, and a stray extra product (or a person, under
 * BUILD_AWARENESS) standing next to the merchant's real one ruins the
 * composite. "Sale badge aesthetic" pulls the same way against "no text".
 *
 * Same mood and lighting, no subjects. */
const PLAN_MOOD_DIRECTION: Record<string, string> = {
  GROW_SALES: "natural daylight, warm aspirational everyday mood",
  LAUNCH_PRODUCT: "dramatic directional lighting, high-energy launch mood",
  CLEAR_INVENTORY: "bright clean white-studio look, crisp and uncluttered",
  BUILD_AWARENESS: "editorial magazine-feature mood, warm and emotive",
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
    const prompt = formatLayoutPrompt(f.key, copy, undefined, "vertical 9:16");
    // 9:16, not 1:1: this frame is only ever used to seed a video
    // (video-generation.server.ts is its sole caller). Seeding a square
    // still means a square clip that then has to be padded back to
    // vertical; asking for the finished shape up front means the model
    // COMPOSES for it and no bars are needed at all.
    const url = await repRun("google/nano-banana", { prompt, image_input: [productImageUrl], aspect_ratio: "9:16", output_format: "jpg" });
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
  productSize?: string,
  /** Skip the Presenter Shot Library for this render.
   *
   *  The library exists so a repeat ad for the same presenter x product is
   *  instant and free — it freezes one gate-passed composite and reuses it
   *  forever. Correct for a repeat, wrong for a BURST: the cache key is
   *  (avatar, variant, product photo, layout), which is identical across every
   *  item in a burst, so the first one composed and the other nine handed back
   *  the same frozen bytes. Ten renders, one picture.
   *
   *  A burst is a request for OPTIONS, so it composes fresh every time — and
   *  it leaves the library alone rather than churning the same key ten times. */
  freshShot?: boolean
): Promise<string> {
  // Generate copy in the shop's content language (web toggle / store locale).
  const contentLang = (await db.shop.findUnique({ where: { id: shopId }, select: { contentLang: true } }))?.contentLang;
  // PRESENTER STILL — an avatar holding the product (Content Studio presenter
  // path). Uses the same two-image compose engine as UGC video frames. Needs a
  // real product photo; falls through to the product still if unavailable.
  // Services have nothing to hold → skip straight to the outcome scene.
  //
  // WHY THE MISS IS RECORDED. Falling back to a plain product still is the
  // right call — the merchant paid 5 tokens for an image ad and a good product
  // ad beats nothing, and deleting it to refund would leave them with neither.
  // What was wrong is that it arrived INDISTINGUISHABLE from a deliberate
  // product ad: titled "Ad image for X", no avatarId in metaJson, and the only
  // trace a console.error they never see. The merchant read "The presenter will
  // hold your product in the shot", got a poster with no presenter, and had no
  // way to tell a failure from the normal result — so they paid again for the
  // same silent outcome. Carried into the asset below instead.
  let presenterMiss: string | null = null;
  if (!serviceMode && avatarId && productImageUrl && /^https?:\/\//.test(productImageUrl)) {
    presenterMiss = "the presenter compose did not complete";
    try {
      const { falImageEnabled } = await import("./fal-image.server");
      if (falImageEnabled()) {
        // resolvePresenter, not resolvePortraitFile: the latter only looks in
        // public/avatars, so a shop's own forged presenter ("cav…") threw and
        // was swallowed by the catch below — the ad quietly shipped as a plain
        // product still with no presenter in it, at full price. Same defect as
        // the cartoon and anthem pipelines had.
        const { resolvePresenter } = await import("./custom-avatars.server");
        const presenter = await resolvePresenter(shopId, avatarId, avatarVariant || 0);
        const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
        const portraitUrl = `${base}${presenter.portraitPublicPath}`;
        const { resolveProductScale } = await import("./product-scale.server");
        // stylePrompt is the merchant’s “Describe it” direction — the same
        // string handed to the scene two lines down. Passing it as the product
        // DESCRIPTION told the scale resolver that “on a marble kitchen
        // counter” was a fact about the product, and it sizes the item from
        // that text. There is no product description on this path at all
        // (CatalogProduct has no such column), so title, photo and the
        // merchant’s own size picker are the honest inputs — exactly what the
        // cartoon and UGC pipelines pass when they have no description.
        const scaleHint = await resolveProductScale({
          productTitle,
          productImageUrl,
          productSize,
        });

        // THE SHOT LIBRARY. The presenter × product composite is the one
        // genuinely risky generative step in this pipeline, so it runs ONCE:
        // the first gate-passed frame for a pair is frozen on disk and every
        // later ad for the same pair reuses it — fresh copy overlay, zero
        // compose/QA spend, zero new chance of drift. This is how the big
        // creators' tools all work (generate once, human-gate, freeze).
        const { shotLibraryEnabled, presenterShotKey, findPresenterShot, savePresenterShot } =
          await import("./presenter-shots.server");
        const layout = presenterLayout(scaleHint?.sizeClass, wear);
        const shotKey = presenterShotKey(avatarId, avatarVariant || 0, productImageUrl, layout, scene || stylePrompt);
        const cachedShot = shotLibraryEnabled() && !freshShot ? await findPresenterShot(shopId, shotKey) : null;

        let buf: Buffer | null = null;
        let fileName = "";
        let composed: string | undefined;
        let freezeReason: string | undefined; // set only for a fresh gate-passed frame
        if (cachedShot) {
          buf = cachedShot.buf;
          // Deliberately NOT reusing cachedShot.fileName — this asset writes
          // its own copy below, so purging one ad can never blank another.
          artLog("image-ad", `presenter shot library: reusing the frozen ${layout} shot for this presenter — instant, no generation`);
        } else {
          const held = await runPresenterHold({
            // `scene` is never populated for image jobs from the web Studio, so
            // the merchant's typed "Describe it" direction (which arrives as
            // stylePrompt) was silently thrown away on this path — they paid
            // for an ad that ignored the one instruction they gave.
            portraitUrl, productImageUrl, productTitle, wear, scene: scene || stylePrompt,
            scalePhrase: scaleHint?.phrase, sizeClass: scaleHint?.sizeClass, cm: scaleHint?.cm,
            continuity: presenter.avatar.continuity,
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
                // Freeze every gate-passed frame, drawn included. The old
                // rule froze only paste-backed pixels because drawn frames
                // were a gamble that occasionally squeaked past the gate; on
                // the one-shot pipeline the drawn frame IS the product — it
                // passed a hard-fail identity gate — and refusing to freeze
                // it would bill a fresh $0.15 compose for every repeat and
                // hollow out the Shot Library economics entirely.
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
            // EVERY asset gets its OWN file, including on a Shot Library hit.
            // Reusing the cached filename made several Assets point at one file
            // on disk; storage-cleanup then purged the oldest un-kept one,
            // deleted that shared file from disk AND object storage, and
            // silently blanked every other ad still using it — including Kept,
            // paid ads. The bytes are already in memory, so a private copy is
            // just a write.
            fileName = `img-${Date.now()}-${crypto.randomBytes(9).toString("hex")}.jpg`;
            fs.writeFileSync(path.join(dir, fileName), buf);
            try { await mirrorRender(fileName, buf); } catch { /* non-fatal */ }

            // Write the frozen shot ONLY when something will record it.
            //
            // The file write and the mirror used to sit outside the !freshShot
            // guard, so a burst wrote one shot-*.jpg per item and recorded none
            // of them. Nothing references those files — deliberately, see the
            // note below — and the purge only deletes filenames it finds in an
            // asset's bodyJson, so nothing could ever remove them. A ten-item
            // presenter burst leaked ten full-size stills to the renders disk,
            // and to object storage, every time.
            //
            // shotLibraryEnabled() joins the condition for the same reason: the
            // READ is gated on it but the write was not, so with the library
            // switched off it still wrote files and rows that nothing would ever
            // consult.
            if (freezeReason !== undefined && !cachedShot && !freshShot && shotLibraryEnabled()) {
              // The library's copy must NOT be an asset file, for the same
              // reason: an asset file can be purged, and that would leave the
              // library pointing at nothing. Give the frozen shot its own
              // `shot-` name that no asset ever references, so the purge
              // (which only deletes filenames found in an asset's bodyJson)
              // can never reach it.
              const shotFile = `shot-${Date.now()}-${crypto.randomBytes(9).toString("hex")}.jpg`;
              fs.writeFileSync(path.join(dir, shotFile), buf);
              try { await mirrorRender(shotFile, buf); } catch { /* non-fatal */ }
              // Freeze the CLEAN composite — presenter stills ship untyped
              // now, and a frozen shot must stay reusable if that changes.
              // Order matters: bytes, then mirror, then the row. findPresenterShot
              // deletes any row whose file is missing, so a row written first would
              // destroy itself and burn a re-compose.
              await savePresenterShot({ shopId, cacheKey: shotKey, avatarId, layout, fileName: shotFile, gateReason: freezeReason });
              artLog("image-ad", "presenter shot library: froze this gate-passed shot — future ads for this pair are instant");
            }
            localUrl = `/renders/${fileName}`;
            // NO POSTER TEXT ON A PRESENTER SHOT. The overlay uses a poster
            // layout that sets the headline across the TOP of the canvas —
            // which on a product-only still is empty sky, and on a presenter
            // still is their FACE. Every "with presenter" ad shipped with a
            // headline stamped over the presenter's forehead.
            //
            // Moving the type lower doesn't save it either: the middle is the
            // product and the bottom is their hands. A presenter holding the
            // product IS the ad — that's the whole premise of the format — so
            // it ships clean and the merchant writes their own caption.
            // Product-only stills (below) keep the poster treatment.
            //
            // PRESENTER_AD_TEXT=1 puts the overlay back.
            if (process.env.PRESENTER_AD_TEXT === "1") {
              try {
                const voiceTone = (() => { try { return JSON.parse(brandProfile.voiceJson || "{}").tone as string | undefined; } catch { return undefined; } })();
                const copy = await adCopy(productTitle, voiceTone, stylePrompt, false, contentLang);
                if (copy) {
                  const adName = await overlayAdText(dir, fileName, copy.headline, copy.cta, copy.sub);
                  if (adName) { localUrl = `/renders/${adName}`; try { await mirrorRender(adName, fs.readFileSync(path.join(dir, adName))); } catch { /* non-fatal */ } }
                }
              } catch (e) { console.error("[image-ad] presenter overlay skipped:", e instanceof Error ? e.message : e); }
            }
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
      } else {
        presenterMiss = "image compose is not configured on this deployment";
      }
    } catch (e) {
      presenterMiss = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
      console.error("[image-ad] presenter compose failed, falling back to product still:", presenterMiss);
    }
    // fall through to a normal product still if compose is unavailable/failed
  }

  const visual = JSON.parse(brandProfile.visualJson);

  // THE MERCHANT'S BRIEF, BOUNDED.
  //
  // stylePrompt is free text and reaches this function from four callers, not
  // all of which cap it. It is interpolated at the FRONT of the prompt, ahead
  // of the clauses that keep the product looking like the product — so a
  // pasted brief pushes "keep every printed code character for character" into
  // the tail, where a diffusion model weights it least. Bounded at the front
  // gate instead. trimToWord because a model reads this: a brief ending
  // mid-word is a brief that reads as damaged.
  const styleBrief = trimToWord(stylePrompt, 500) || undefined;

  const direction =
    PLAN_VISUAL_DIRECTION[plan.campaignGoal] || PLAN_VISUAL_DIRECTION.GROW_SALES;
  // For prompts whose subject is NOT a product — see PLAN_MOOD_DIRECTION.
  const moodDirection =
    PLAN_MOOD_DIRECTION[plan.campaignGoal] || PLAN_MOOD_DIRECTION.GROW_SALES;

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
    // moodDirection, not direction: this ad has no product to photograph and
    // ends with "Absolutely NO text", so "clean product on white" and "sale
    // badge aesthetic" would both be instructions to do the opposite of what
    // the rest of the sentence asks for.
    usedPrompt = `${styleBrief ? `${styleBrief}. ` : ""}Premium lifestyle advertising photograph that sells the OUTCOME of "${productTitle}". ${styleBrief ? "" : `${moodDirection}. `}Show a happy, successful person clearly enjoying the benefit or result — aspirational, authentic, relatable, bright warm natural lighting (never dark or moody unless the style asks for it). ${visual.imageStyle || "clean modern commercial photography"}. Poster-ready composition: subject in the lower two-thirds with clean uncluttered space across the top of the frame for a headline. Photorealistic, sharp focus, natural realistic human anatomy and faces, flawless proportions, magazine-quality. Absolutely NO text, letters, words, watermarks, logos, charts, graphs or app screenshots.`;
    // Only rung on this path — an unretried blip here terminal-failed a paid ad.
    imageUrl = await fluxDevStill(usedPrompt, "service-outcome");
    genMeta.method = "lifestyle";
  } else if (hasProductImg) {
    // ONE LIGHTING BRIEF, NOT TWO.
    //
    // styleDesc fell back to BRIGHT_DEFAULT ("NOT dark, NOT moody, NOT a black
    // background") whenever the merchant gave no direction, and the prompts
    // below SEPARATELY append the brand profile's own imageStyle — which for a
    // brand whose look is dark reads "dark moody". Both sentences went to the
    // model in one prompt and it split the difference into murky grey.
    //
    // wantBright then made it worse: derived from stylePrompt alone, it was true
    // whenever the merchant typed nothing, so qaFidelity FAILED the frame for
    // being dark — punishing the model for obeying the brand profile we handed
    // it in the same breath.
    const brandStyle = typeof visual.imageStyle === "string" ? visual.imageStyle.trim() : "";
    const brandWantsDark = /(dark|moody|noir|low.?key|black background)/i.test(brandStyle);
    // The same vocabulary the brand test above uses. This branch only
    // recognised three exact phrases, so a merchant typing “moody” or “black
    // background” in Describe it got their own request marked as a defect by
    // the gate and the render thrown away.
    const DARK_INTENT = /(dark|moody|noir|low.?key|black background|night|shadow)/i;
    const wantBright = stylePrompt ? !DARK_INTENT.test(stylePrompt) : !brandWantsDark;
    // When the brand's own look becomes the lighting brief, do not also append
    // it as a style note — saying it twice is how the contradiction started.
    const styleTail = (!stylePrompt && brandWantsDark) || !brandStyle
      ? "clean professional product photography"
      : brandStyle;
    const mode: "backdrop" | "scene" = styleMode === "scene" || styleMode === "backdrop" ? styleMode : inferStyleMode(stylePrompt);
    // Rotate the backdrop when the merchant gave no brief and the brand is not a
    // dark-look brand — otherwise every default/fallback scene ad for a product
    // reused the one BRIGHT_DEFAULT wash. Still bright and clean, just not the
    // same bright and clean every time.
    const styleDesc = styleBrief || (brandWantsDark ? brandStyle : pickBackdrop());

    // RUNG -1 — AD FORMAT: a genuinely different creative COMPOSITION
    // (callouts / review card / text convo / versus / before-after / offer /
    // feed-native). Claude writes exact copy, nano-banana builds the layout
    // around the real product photo, vision QA rejects gibberish or a warped
    // product with one retry. Any failure falls through the normal ladder.
    if (formatKey && formatKey !== "poster") {
      try {
        const { AD_FORMAT_BY_KEY } = await import("./ad-formats");
        const f = AD_FORMAT_BY_KEY[formatKey];
        // A RETIRED format (the fabricated-testimonial formats pulled for FTC
        // compliance) must never render, even when its key is re-reached via a
        // remix of an older asset or a stale queued job — fall through to the
        // normal scene ladder and ship a real product ad instead.
        if (f && !f.retired) {
          const voiceTone = (() => { try { return JSON.parse(brandProfile.voiceJson || "{}").tone as string | undefined; } catch { return undefined; } })();
          // THE REAL PRICE, RESOLVED ONCE.
          //
          // Two formats print money — receipt puts it on the receipt line,
          // pricemath renders it HUGE in the middle of the frame — and the
          // copywriter was told to make one up. It is looked up here rather
          // than threaded through every payload because the payload route
          // would have to be patched in six places (studio, the FORMAT
          // ROTATION questline drops, onboarding, the archive remix and the
          // webhooks), and the auto-posting path is precisely the one that
          // would have been missed.
          // The real price AND the real description, resolved together from the
          // catalogue by title — the same single-lookup pattern the price note
          // above describes, so grounding reaches every entry point (studio,
          // questline drops, onboarding, remix, webhooks) without threading a
          // new field through each payload.
          const row = await (async () => {
            try {
              return await db.catalogProduct.findFirst({
                where: { shopId, title: productTitle },
                select: { priceText: true, description: true },
              });
            } catch { return null; }
          })();
          const productPrice = (() => {
            const p = (row?.priceText || "").trim();
            // A price has to look like one. A blank, a “Sold out” or a
            // scrape artefact must read as “we do not know”, not as money.
            return /[0-9]/.test(p) && p.length <= 24 ? p : null;
          })();
          // The merchant's own listing copy — the ONLY source of truth for
          // specs. Null when the catalogue has none (not imported since the
          // field shipped, or a single-URL product); the copywriter then falls
          // back to benefit language instead of inventing specifics.
          const productDetails = (row?.description || "").trim() || null;
          const r = await runFormatRung({
            formatKey: f.key, fields: f.fields, productTitle, productImageUrl: productImageUrl!,
            tone: voiceTone, direction: stylePrompt, contentLang, merchantOffer, productPrice, productDetails,
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
          // THE PROMPT MUST DESCRIBE THE IMAGES IT IS ACTUALLY GIVEN.
          //
          // The two-image wording — "the FIRST image's scene ... the SECOND
          // image's product" — was sent unchanged when only ONE image went with
          // it. That happens on the kontext fallback every single time (it takes
          // one input_image), and on the nano-banana call itself whenever
          // SHOPIFY_APP_URL is unset, because then no plate URL can be built. A
          // model told to recreate a first image it was never handed has to invent
          // what that scene was, and the fallback then stacked the plate
          // description in front of a sentence still referring to it as an image.
          const placement = t.placement || "placed naturally as the hero";
          const truth = `${stylePrompt ? ` Apply this one change the merchant asked for: ${trimToWord(stylePrompt, 200)}.` : ""} The product stays identical to its photo: same shape, colors, logos and details, and every code, serial and number printed on it copied character for character, at its TRUE real-world scale. Any hands shown are anatomically correct with five fingers. Photorealistic, magazine-quality, no added text or watermark.`;
          const twoImagePrompt = `Recreate the FIRST image's scene exactly — same composition, lighting, colors and style — with the SECOND image's product ${placement}.${truth}`;
          // `plate` is documented as the EMPTY stage and says so in its own text
          // ("completely empty scene ... no objects"). The two-image path renders
          // that plate and composites onto it, which is correct. This one-image
          // fallback pasted the same string in front of "Place the product ... into
          // that scene", telling the model the scene contains no objects and to put
          // an object in it — on the already-degraded path.
          const oneImagePrompt = `${occupiedPlate(t.plate)}. Place the product from the provided image into that scene, ${placement}.${truth}`;
          usedPrompt = plateUrl ? twoImagePrompt : oneImagePrompt;
          const stagedOnce = async (): Promise<string> => {
            const inputs = plateUrl ? [plateUrl, productImageUrl] : [productImageUrl];
            try { return await repRun("google/nano-banana", { prompt: usedPrompt, image_input: inputs, aspect_ratio: "1:1", output_format: "jpg" }); }
            catch {
              // kontext takes a single image, so it always gets the one-image
              // wording — and usedPrompt follows, so the asset records what ran.
              usedPrompt = oneImagePrompt;
              return await repRun("black-forest-labs/flux-kontext-pro", { prompt: oneImagePrompt, input_image: productImageUrl, aspect_ratio: "1:1", output_format: "jpg" });
            }
          };
          imageUrl = await stagedOnce();
          // JUDGE THE BRIEF THIS RUNG ACTUALLY SENT.
          //
          // This asserted wantBright: true for every template, and qaFidelity
          // is told to FAIL an image that is “dark/moody or on a black
          // background” when that flag is set. Several plates are dark BY
          // DEFINITION, so the model did exactly as asked and the gate
          // rejected it — twice — before dropping to the composite. The
          // merchant picked a dark template and could never receive one.
          const plateWantsBright = !DARK_INTENT.test(t.plate || "");
          let qa = await qaFidelity(productImageUrl!, imageUrl, plateWantsBright && wantBright);
          // A gate that could not judge has told us nothing about this take,
          // so a second paid render against it is money for no information.
          if (!qa.pass && !qa.degraded) {
            console.log(`[image-ad] template QA rejected (${qa.reason}) — retrying`);
            imageUrl = await stagedOnce();
            qa = await qaFidelity(productImageUrl!, imageUrl, plateWantsBright && wantBright);
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
          const bgPrompt = `Empty advertising backdrop photograph — ${styleDesc}. ${moodDirection}. Completely empty scene: NO products, NO objects, NO people — just a beautiful empty display area (clean surface, tabletop or seamless floor) across the lower third where a product will be placed, and clean uncluttered space across the top for a headline. ${styleTail}. Photorealistic, magazine-quality, soft believable ground shadow area, no text, no watermark.`;
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
      usedPrompt = `Place this exact product, unchanged, as the hero of a premium advertising poster photograph. ${styleDesc}. ${direction}. ${styleTail}. Print-ad composition: the product commanding the lower two-thirds of the frame, clean uncluttered space across the top for a headline. Keep the product identical in shape, color, materials, logos and every detail — including every printed code, serial and number, copied character for character — at its TRUE real-world scale, never shrunk, never turned into a different object. Any hands shown are anatomically correct with five fingers. Photorealistic, magazine-quality commercial photography, sharp focus, no added text or watermark.`;
      const genOnce = async (): Promise<string> => {
        try {
          return await repRun("google/nano-banana", { prompt: usedPrompt, image_input: [productImageUrl], aspect_ratio: "1:1", output_format: "jpg" });
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
        const bgPrompt = `Empty advertising backdrop photograph — ${styleDesc}. ${moodDirection}. Completely empty scene: NO products, NO objects, NO people — just a beautiful empty display area across the lower third, clean space at the top for a headline. Photorealistic, magazine-quality, no text, no watermark.`;
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
        // Same here: retry a REJECTION, never an outage.
        if (!qa.pass && !qa.degraded) {
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
          usedPrompt = `${styleBrief ? `${styleBrief}. ` : `${pickBackdrop()}. `}Premium advertising poster photograph of ${productTitle}. ${direction}. ${visual.imageStyle || "clean professional product photography"}. Print-ad composition: the product commanding the lower two-thirds of the frame, clean uncluttered space across the top for a headline. Photorealistic, sharp focus, magazine-quality commercial photography, no text, no watermark, no logo, no distortion.`;
          imageUrl = await fluxDevStill(usedPrompt, "scene-degrade-poster");
          genMeta.method = "text2img-degraded";
        }
      }
    }
  } else {
    usedPrompt = `${styleBrief ? `${styleBrief}. ` : `${BRIGHT_DEFAULT}. `}Premium advertising poster photograph of ${productTitle}. ${direction}. ${visual.imageStyle || "clean professional product photography"}. Print-ad composition: the product commanding the lower two-thirds of the frame, clean uncluttered space across the top for a headline. Photorealistic, ultra high resolution, sharp focus, natural realistic human anatomy and faces, flawless proportions, magazine-quality commercial photography, no text, no watermark, no logo, no distortion.`;
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
          fileName = `img-${Date.now()}-${crypto.randomBytes(9).toString("hex")}.jpg`;
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
      // Say so when a presenter was asked for and could not be delivered. The
      // image is still a good product ad, but it must not masquerade as the one
      // that was ordered — otherwise the merchant pays again for the same
      // result, having no way to tell this apart from a deliberate product ad.
      title: presenterMiss ? `${productTitle} — product only (presenter unavailable)` : `Ad image for ${productTitle}`,
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
        // A remix of this ad should ask for the presenter again rather than
        // inheriting the degraded result, and support needs to be able to tell
        // why one is missing without reading a container log.
        ...(presenterMiss
          ? { presenterRequested: avatarId || null, presenterVariant: avatarVariant ?? 0, presenterMissed: presenterMiss }
          : {}),
      }),
    },
  });

  return asset.id;
}
