import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { db } from "../db.server";
import type { BrandProfile, Plan } from "@prisma/client";
import { mirrorRender } from "./object-storage.server";
import { anthropicText, anthropicVision } from "./anthropic.server";

/* ── On-image ad copy ──────────────────────────────────────────────────────
 * A high-quality still isn't a finished ad — real creatives carry a headline
 * and a call to action. Diffusion models garble text, so we generate the words
 * with Claude and composite them onto the image with ffmpeg (same font/engine
 * the video captions use). Everything here is best-effort: any failure falls
 * back to the clean image, never blocking generation. */

/** Poster-grade ad copy: a STATEMENT headline (the kind award ads open with),
 *  an optional small support line, and a short CTA. */
async function adCopy(productTitle: string, tone: string | undefined, direction: string | undefined, serviceMode: boolean): Promise<{ headline: string; sub: string; cta: string } | null> {
  try {
    const prompt = [
      `Write poster-style ad copy to overlay on a ${serviceMode ? "service/offer" : "product"} image ad — think award-winning print ads: a bold STATEMENT headline that stops the scroll, not a generic tagline.`,
      `${serviceMode ? "Offer" : "Product"}: "${productTitle}".`,
      tone ? `Brand tone: ${tone}.` : "",
      direction ? `Angle: ${direction.slice(0, 160)}.` : "",
      `Return ONLY JSON: {"headline":"...","sub":"...","cta":"..."}.`,
      `headline: 3 to 7 words, a confident, witty or provocative STATEMENT (a period at the end is allowed and often stronger).`,
      `sub: MAX 8 words, one small supporting line that lands the benefit — or "" if the headline says it all.`,
      `cta: MAX 3 words (e.g. "Shop now", "Get yours", "Start free").`,
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
const dt = (s: string) => s.replace(/\\/g, "").replace(/[':%]/g, "").replace(/[^\w \-!?.&]/g, "").trim();

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

/** Average luma (0-255) of a horizontal band of the image, so text color can
 *  adapt to what it sits on. band: fraction offsets of height (0=top). */
async function bandLuma(bin: string, src: string, yFrac: number, hFrac: number): Promise<number | null> {
  return await new Promise((resolve) => {
    try {
      const vf = `crop=iw:ih*${hFrac}:0:ih*${yFrac},scale=64:64,signalstats,metadata=print:file=-`;
      const p = spawn(bin, ["-i", src, "-vf", vf, "-frames:v", "1", "-f", "null", "-"], { stdio: ["ignore", "pipe", "ignore"] });
      let outBuf = "";
      p.stdout.on("data", (c: Buffer) => { outBuf += c.toString(); });
      p.on("error", () => resolve(null));
      p.on("close", () => {
        const m = outBuf.match(/signalstats\.YAVG=([\d.]+)/);
        resolve(m ? parseFloat(m[1]) : null);
      });
    } catch { resolve(null); }
  });
}

async function overlayAdText(dir: string, srcName: string, headline: string, cta: string, sub = ""): Promise<string | null> {
  const bin = ffmpegBin();
  if (!bin) return null;
  const src = path.join(dir, srcName);
  if (!fs.existsSync(src)) return null;
  const outName = srcName.replace(/\.jpg$/, "") + "-ad.jpg";
  const out = path.join(dir, outName);
  const fontFile = path.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");
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
  const longest = Math.max(line1.length, line2.length);
  const hlSize = longest > 18 ? 58 : longest > 12 ? 72 : 84;
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
  const ok = await new Promise<boolean>((resolve) => {
    try {
      const p = spawn(bin, args, { stdio: ["ignore", "ignore", "ignore"] });
      p.on("error", () => resolve(false));
      p.on("close", (code) => resolve(code === 0));
    } catch { resolve(false); }
  });
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
  const create = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST", headers: repHeaders(), body: JSON.stringify({ input }),
  });
  if (!create.ok) throw new Error(`${model} create ${create.status}: ${(await create.text()).slice(0, 160)}`);
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
  const tmpBg = path.join(dir, `.bg-${Date.now()}.jpg`);
  const tmpCut = path.join(dir, `.cut-${Date.now()}.png`);
  const fileName = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
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
    const ok = await new Promise<boolean>((resolve) => {
      try {
        const p = spawn(bin, args, { stdio: ["ignore", "ignore", "ignore"] });
        p.on("error", () => resolve(false));
        p.on("close", (code) => resolve(code === 0));
      } catch { resolve(false); }
    });
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

const AD_TEMPLATE_DIR = path.join(process.cwd(), "data", "ad-templates");
// v7: statue re-forged with nano-banana + a vision spelling check — flux-dev
// kept garbling the "EASYMODE" label into alphabet soup.
const AD_TEMPLATE_VERSION = 7;
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
  // The stand-in product: a sleek EASYMODE-branded drink bottle in brand
  // colors — a metaphorical product that marks exactly where the merchant's
  // real product will go. nano-banana first: it renders label text faithfully,
  // where flux-dev garbled "EASYMODE" into alphabet soup.
  const prompt = 'Professional product photograph of a sleek modern beverage bottle for a brand called "EASYMODE": glossy clean WHITE bottle with a bright kelly-GREEN cap, a crisp white label with the word "EASYMODE" printed in bold black uppercase letters, minimal premium design, only white green and black in the design, bottle standing upright, centered on a pure white seamless studio background, bright soft even studio lighting, crisp sharp focus, commercial beverage photography. The label text must be spelled exactly "EASYMODE" — E-A-S-Y-M-O-D-E, one word. No other objects, no hands, no characters.';
  let raw: string;
  try {
    raw = await repRun("google/nano-banana", { prompt, output_format: "jpg" });
  } catch {
    raw = await repRun("black-forest-labs/flux-dev", {
      prompt, num_inference_steps: 30, guidance: 3.5, aspect_ratio: "1:1", output_format: "jpg", output_quality: 92,
    });
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
  console.log("[ad-templates] statue forged (v" + AD_TEMPLATE_VERSION + ")");
  return out;
}

export function ensureAdTemplate(key: string): void {
  if (fs.existsSync(currentTemplateFile("preview", key)) || templateInFlight.has(key)) return;
  if (!process.env.REPLICATE_API_TOKEN) return;
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
      console.log(`[ad-templates] built ${key}`);
    } catch (e) {
      console.error(`[ad-templates] ${key} build failed:`, e instanceof Error ? e.message.slice(0, 160) : e);
    } finally {
      templateInFlight.delete(key);
    }
  })();
}

export async function ensureAllAdTemplates(): Promise<void> {
  const { AD_TEMPLATES } = await import("./ad-templates");
  for (const t of AD_TEMPLATES) ensureAdTemplate(t.key);
}

const BRIGHT_DEFAULT = "Bright, light-filled scene: a fresh clean backdrop in a soft light color that complements the product, generous even daylight-quality lighting, airy and inviting — NOT dark, NOT moody, NOT a black background";

/** SELF-HEALING BACKFILL — image ads forged before durable storage carry
 *  replicate.delivery URLs that expired (~1h), leaving blank cards. Re-forge
 *  a few per worker tick from their stored prompts (~$0.003 each) and point
 *  them at the durable disk. Runs until no dead images remain. */
let lastBackfillScan = 0;
const BACKFILL_EVERY_MS = 10 * 60 * 1000; // worker ticks every ~8s — heal gently

export async function backfillDeadImages(): Promise<void> {
  if (Date.now() - lastBackfillScan < BACKFILL_EVERY_MS) return;
  lastBackfillScan = Date.now();
  const candidates = await db.asset.findMany({
    where: { type: "IMAGE_AD", bodyJson: { contains: "replicate.delivery" } },
    orderBy: { createdAt: "desc" },
    take: 3, // gentle per tick — burst-limits stay happy
  });
  for (const a of candidates) {
    try {
      const body = JSON.parse(a.bodyJson) as { imageUrl?: string; prompt?: string; sourceUrl?: string };
      if (!body.imageUrl?.includes("replicate.delivery")) {
        // contains() matched sourceUrl only — already healed; strip the marker
        await db.asset.update({ where: { id: a.id }, data: { bodyJson: JSON.stringify({ ...body, sourceUrl: undefined }) } });
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
  templateKey?: string
): Promise<string> {
  // PRESENTER STILL — an avatar holding the product (Content Studio presenter
  // path). Uses the same two-image compose engine as UGC video frames. Needs a
  // real product photo; falls through to the product still if unavailable.
  // Services have nothing to hold → skip straight to the outcome scene.
  if (!serviceMode && avatarId && productImageUrl && /^https?:\/\//.test(productImageUrl)) {
    try {
      const { submitCompose, pollCompose, falImageEnabled } = await import("./fal-image.server");
      if (falImageEnabled()) {
        const { resolvePortraitFile } = await import("./ugc-ad-pipeline.server");
        const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
        const portraitUrl = `${base}/avatars/${path.basename(resolvePortraitFile(avatarId, avatarVariant || 0))}`;
        const q = await submitCompose(portraitUrl, productImageUrl, productTitle, 1, wear ? "wear" : "hold", scene);
        let composed: string | undefined;
        for (let i = 0; i < 45; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const p = await pollCompose(q.statusUrl, q.responseUrl);
          if (p.done) { composed = p.urls?.[0]; break; }
        }
        if (composed) {
          let localUrl = composed;
          try {
            const res = await fetch(composed);
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer());
              if (buf.length > 5_000) {
                const dir = path.join(process.cwd(), "data", "renders");
                fs.mkdirSync(dir, { recursive: true });
                const fileName = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
                fs.writeFileSync(path.join(dir, fileName), buf);
                try { await mirrorRender(fileName, buf); } catch { /* non-fatal */ }
                localUrl = `/renders/${fileName}`;
                // Overlay headline + CTA (best-effort) so the presenter still is a real ad.
                try {
                  const voiceTone = (() => { try { return JSON.parse(brandProfile.voiceJson || "{}").tone as string | undefined; } catch { return undefined; } })();
                  const copy = await adCopy(productTitle, voiceTone, stylePrompt, false);
                  if (copy) {
                    const adName = await overlayAdText(dir, fileName, copy.headline, copy.cta, copy.sub);
                    if (adName) { localUrl = `/renders/${adName}`; try { await mirrorRender(adName, fs.readFileSync(path.join(dir, adName))); } catch { /* non-fatal */ } }
                  }
                } catch (e) { console.error("[image-ad] presenter overlay skipped:", e instanceof Error ? e.message : e); }
              }
            }
          } catch (e) { console.error("[image-ad] presenter still persist failed:", e); }
          const asset = await db.asset.create({
            data: {
              shopId, type: "IMAGE_AD", status: "PENDING",
              title: `${productTitle} — held by presenter`,
              bodyJson: JSON.stringify({ imageUrl: localUrl, sourceUrl: composed, prompt: `presenter holding ${productTitle}`, avatarId }),
              metaJson: JSON.stringify({ campaignGoal: plan.campaignGoal, productTitle, avatarId }),
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
    imageUrl = await repRun("black-forest-labs/flux-dev", { prompt: usedPrompt, num_inference_steps: 30, guidance: 3, aspect_ratio: "1:1", output_format: "jpg", output_quality: 92 });
    genMeta.method = "lifestyle";
  } else if (hasProductImg) {
    const wantBright = !stylePrompt || !/deliberately dark|noir|dark charcoal/i.test(stylePrompt);
    const mode: "backdrop" | "scene" = styleMode === "scene" || styleMode === "backdrop" ? styleMode : inferStyleMode(stylePrompt);
    const styleDesc = stylePrompt || BRIGHT_DEFAULT;

    // RUNG 0 — AD TEMPLATE: the merchant picked a statue-preview template, so
    // deliver EXACTLY what the preview showed. Exact templates composite the
    // real product cutout onto the same plate the preview used; staged
    // templates re-stage the scene with the identity model + QA.
    if (templateKey) {
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
            if (fn) { usedPrompt = t.plate; localFileName = fn; imageUrl = null; genMeta.method = `template-fallback:${t.key}`; }
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
          const bgUrl = await repRun("black-forest-labs/flux-dev", { prompt: bgPrompt, num_inference_steps: 30, guidance: 3, aspect_ratio: "1:1", output_format: "jpg", output_quality: 92 });
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
          const cutout = await removeBackground(productImageUrl!);
          if (cutout) {
            const bgPrompt = `Empty advertising backdrop photograph — ${styleDesc}. ${direction}. Completely empty scene: NO products, NO objects, NO people — just a beautiful empty display area across the lower third, clean space at the top for a headline. Photorealistic, magazine-quality, no text, no watermark.`;
            const bgUrl = await repRun("black-forest-labs/flux-dev", { prompt: bgPrompt, num_inference_steps: 30, guidance: 3, aspect_ratio: "1:1", output_format: "jpg", output_quality: 92 });
            const fn = await compositeProductStill(bgUrl, cutout);
            if (fn) { usedPrompt = bgPrompt; localFileName = fn; imageUrl = bgUrl; genMeta.method = "photo-true-fallback"; }
          }
        } catch { /* ship the best scene take — merchant reviews before posting */ }
      }
    }
  } else {
    usedPrompt = `${stylePrompt ? `${stylePrompt}. ` : `${BRIGHT_DEFAULT}. `}Premium advertising poster photograph of ${productTitle}. ${direction}. ${visual.imageStyle || "clean professional product photography"}. Print-ad composition: the product commanding the lower two-thirds of the frame, clean uncluttered space across the top for a headline. Photorealistic, ultra high resolution, sharp focus, natural realistic human anatomy and faces, flawless proportions, magazine-quality commercial photography, no text, no watermark, no logo, no distortion.`;
    imageUrl = await repRun("black-forest-labs/flux-dev", { prompt: usedPrompt, num_inference_steps: 30, guidance: 3, aspect_ratio: "1:1", output_format: "jpg", output_quality: 92 });
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
    try {
      const voiceTone = (() => { try { return JSON.parse(brandProfile.voiceJson || "{}").tone as string | undefined; } catch { return undefined; } })();
      const copy = await adCopy(productTitle, voiceTone, stylePrompt, !!serviceMode);
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
      metaJson: JSON.stringify({ campaignGoal: plan.campaignGoal, productTitle }),
    },
  });

  return asset.id;
}
