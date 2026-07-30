import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { db } from "../db.server";
import type { BrandProfile, Plan } from "@prisma/client";
import { mirrorRender } from "./object-storage.server";
import { anthropicText, anthropicVision } from "./anthropic.server";
import { artLog } from "./art-log.server";
import { langDirective } from "./content-lang";

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

// Under data/renders: the only persistent-disk path on Render (render.yaml
// mountPath) — plates/previews/statue must survive deploys or the picker
// flaps back to fallbacks after every push.
const AD_TEMPLATE_DIR = path.join(process.cwd(), "data", "renders", "ad-templates");
// v9: the APPROVED stand-in — the emerald drink (clear bottle, emerald
// liquid, gold vertical EASYMODE wordmark, black sport cap), the same look
// as the beloved cinematic Product Highlight cover.
const AD_TEMPLATE_VERSION = 9;
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
  // The stand-in product: the APPROVED emerald EASYMODE drink — same prompt
  // family as the bottle candidates, emerald variant (the one that became
  // the cinematic Product Highlight cover). nano-banana keeps the label true.
  const prompt = `${BOTTLE_BASE} ${BOTTLE_VARIANTS.emerald}`;
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
  const base = `Modern high-converting DTC e-commerce static ad, crisp clean design, square 1:1, professional advertising typography. Every text string below must appear EXACTLY as written, perfectly spelled, with NO other words, gibberish or invented text anywhere. ${productClause}`;
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
  contentLang?: string | null
): Promise<Record<string, string> | null> {
  try {
    const prompt = [
      `You write short, punchy copy for a "${formatKey}" style e-commerce static ad.${langDirective(contentLang)}`,
      `Product: "${productTitle}".`,
      tone ? `Brand tone: ${tone}.` : "",
      direction ? `Angle: ${direction.slice(0, 160)}.` : "",
      `Return ONLY JSON with exactly these string fields: ${fields.map((f) => `"${f}"`).join(", ")}.`,
      `Field guide: headline ≤ 6 words (a confident statement); c1-c4 are benefit labels of 2-3 words each; cta ≤ 3 words; quote is a believable customer review of 10-18 words (first person, specific, no hype-words like "amazing"); name is a first name + last initial; m1-m4 are casual lowercase text messages of 4-12 words that read like real friends (m2 and m4 are from the person who owns the product); r1-r3 are 2-4 word advantages, t1-t3 the competitor's matching 2-4 word weaknesses; before/after are 3-6 word captions; offer is a short offer like "20% OFF first order"; caption is a lowercase social caption of 8-16 words; sub ≤ 8 words; stat is a REAL product fact as a short number ("300mg", "12", "10 sec") with statlabel 2-4 words — NEVER an invented customer statistic, survey result or percentage of buyers; masthead is the brand or product name, one or two words; cover1/cover2 are witty magazine cover lines ≤ 7 words; d1-d3 are 2-3 word sensory detail labels; i1-i3 are 2-4 word included-item or benefit labels; note is a sincere 2-sentence founder note ≤ 30 words with zero hype; founder is "FirstName, founder"; question ≤ 6 words and playful; left is the boring generic alternative in 2-3 words; right is the product's short name; tweet is a casual lowercase first-person post of 12-24 words, specific and funny, no hashtags; handle is @ plus a short lowercase invented username (never a real person); query is a "best <category> for <need>" search of 3-6 words; s1-s3 are autocomplete suggestions that extend the query, 4-8 words; title is a lowercase notes-list title ≤ 6 words; n1-n4 are lowercase checklist items of 3-6 words; alerttitle is the brand or product name; alertbody is a friendly ≤ 10 word nudge; w1-w3 are full reasons of 4-8 words; math is a simple real cost-per-use line like "$0.40 per serving" derived from plausible pricing; punchline ≤ 7 words; answer is a confident specific 8-16 word answer; praise is an editorial one-liner ≤ 12 words in third person; outlet is an INVENTED tasteful publication name of 2-3 words — NEVER a real magazine, newspaper or website; step1-3 are 2-5 word action steps in order; badge is 2-3 words like "Editor's Pick"; urgency is a truthful availability line like "Limited run" or "Restocked today" — NEVER an invented sales number or count; g1-g3 are real ingredient or component names of 1-3 words.`,
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
    return out;
  } catch { return null; }
}

/** Vision QA for format ads: exact-ish text + unwarped product. */
async function qaFormat(imageUrl: string, productImageUrl: string | null, expected: string[]): Promise<{ pass: boolean; reason: string }> {
  try {
    const urls = productImageUrl ? [productImageUrl, imageUrl] : [imageUrl];
    const raw = await anthropicVision(
      [
        productImageUrl
          ? `Image 1 is the real product photo; image 2 is a generated ad. Check BOTH: (a) the product in the ad matches image 1 (same shape, colors, label — not warped or reinvented), and`
          : `Check the generated ad:`,
        `(b) every visible text string is correctly spelled real language with NO gibberish or invented words. The ad should contain roughly these strings: ${expected.slice(0, 6).map((s) => `"${s.slice(0, 40)}"`).join(", ")}.`,
        `Reply ONLY JSON: {"pass": true|false, "reason": "short reason"}.`,
      ].join(" "),
      urls
    );
    const m = raw && raw.match(/\{[\s\S]*\}/);
    if (!m) return { pass: true, reason: "qa-unavailable" };
    const j = JSON.parse(m[0]) as { pass?: boolean; reason?: string };
    return { pass: j.pass !== false, reason: (j.reason || "").slice(0, 160) };
  } catch { return { pass: true, reason: "qa-error" }; }
}

/* Self-forged format previews — each tile stars a DIFFERENT EasyMode-branded
 * hero product (skincare, sneakers, coffee, headphones…) from the category
 * that most uses that format, so the picker reads "every product type", not
 * "we make drink ads". v2 = per-format hero products (v1 was all-bottle). */
const FORMAT_PREVIEW_VERSION = 2;
const formatPreviewInFlight = new Set<string>();

export function formatPreviewFile(key: string): string | null {
  // Serve with version fallback: an old preview stands in while the current
  // version forges. ensureFormatPreview checks the exact current version.
  for (let v = FORMAT_PREVIEW_VERSION; v >= 1; v--) {
    const p = path.join(AD_TEMPLATE_DIR, `format-${key}-v${v}.jpg`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function ensureFormatPreview(key: string): void {
  const current = path.join(AD_TEMPLATE_DIR, `format-${key}-v${FORMAT_PREVIEW_VERSION}.jpg`);
  if (fs.existsSync(current) || formatPreviewInFlight.has(key) || !process.env.REPLICATE_API_TOKEN) return;
  formatPreviewInFlight.add(key);
  (async () => {
    try {
      const { AD_FORMAT_BY_KEY } = await import("./ad-formats");
      const f = AD_FORMAT_BY_KEY[key];
      if (!f) return;
      const prompt = formatLayoutPrompt(key, f.preview, f.hero);
      const expected = Object.values(f.preview);
      let buf: Buffer | null = null;
      for (let attempt = 0; attempt < 2 && !buf; attempt++) {
        const url = await repRun("google/nano-banana", { prompt, output_format: "jpg" });
        const qa = await qaFormat(url, null, expected);
        if (!qa.pass && attempt === 0) { artLog("ad-formats", `${key}: preview QA retry — ${qa.reason}`); continue; }
        const res = await fetch(url);
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        buf = Buffer.from(await res.arrayBuffer());
      }
      if (!buf) throw new Error("no render");
      fs.mkdirSync(AD_TEMPLATE_DIR, { recursive: true });
      fs.writeFileSync(current, buf);
      artLog("ad-formats", `${key}: preview v${FORMAT_PREVIEW_VERSION} forged OK`);
    } catch (e) {
      artLog("ad-formats", `${key}: preview FAILED — ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    } finally {
      formatPreviewInFlight.delete(key);
    }
  })();
}

export async function ensureAllFormatPreviews(): Promise<void> {
  const { AD_FORMATS } = await import("./ad-formats");
  for (const f of AD_FORMATS) ensureFormatPreview(f.key);
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
  ensurePhCover();
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
  templateKey?: string,
  formatKey?: string
): Promise<string> {
  // Generate copy in the shop's content language (web toggle / store locale).
  const contentLang = (await db.shop.findUnique({ where: { id: shopId }, select: { contentLang: true } }))?.contentLang;
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
                  const copy = await adCopy(productTitle, voiceTone, stylePrompt, false, contentLang);
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
          const copy = await formatCopy(f.key, f.fields, productTitle, voiceTone, stylePrompt, contentLang);
          if (copy) {
            usedPrompt = formatLayoutPrompt(f.key, copy);
            const renderOnce = () => repRun("google/nano-banana", { prompt: usedPrompt, image_input: [productImageUrl!], output_format: "jpg" });
            imageUrl = await renderOnce();
            let qa = await qaFormat(imageUrl, productImageUrl!, Object.values(copy));
            if (!qa.pass) {
              console.log(`[image-ad] format QA rejected (${qa.reason}) — retrying`);
              imageUrl = await renderOnce();
              qa = await qaFormat(imageUrl, productImageUrl!, Object.values(copy));
            }
            if (qa.pass) {
              genMeta.method = `format:${f.key}`;
              genMeta.formatCopy = copy;
            } else {
              imageUrl = null; // fall through to the ladder — never ship garbled text
              console.log(`[image-ad] format ${f.key} failed QA twice — falling to ladder`);
            }
          }
        }
      } catch (e) {
        imageUrl = null;
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
      metaJson: JSON.stringify({ campaignGoal: plan.campaignGoal, productTitle }),
    },
  });

  return asset.id;
}
