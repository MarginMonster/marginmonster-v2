/* Commercial (Cinematic) — built on OUR stack, no third-party ad product.
 *
 * The format: a multi-scene filmic story ad — 5 short cinematic beats with
 * the merchant's product living inside the scenes, a letterboxed grade, a
 * commercial voice-over, and a packshot finale cut from the merchant's REAL
 * photo (Ken Burns), so the closing frame can never lie about the product.
 * Service mode (nothing physical to photograph) tells the same-protagonist
 * TRANSFORMATION story — before, discovery, after — and closes on a branded
 * end-card in the packshot slot instead of a product photo.
 *
 * Every stage is a piece we already run in production:
 *   shot list  — sonnet (the shot-planner thinking, extended to scenes)
 *   keyframes  — the compose engine with the real product as reference,
 *                one per beat, product-faithful by construction
 *   motion     — kling image-to-video (animateCreate/repPoll, cartoon's path)
 *   voice      — minimax TTS (cartoon's path, commercial-cast voice)
 *   assembly   — ffmpeg: normalize, concat, letterbox, grade, VO, packshot
 *
 * COGS ≈ 3 keyframes + 3 clips + TTS ≈ $1.50–2.50 per 15s spot — comparable
 * to renting a third-party generator, on keys we already hold, with our
 * fidelity thinking in the loop instead of theirs.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { db } from "../db.server";
import { anthropicText } from "./anthropic.server";
import { mirrorRender } from "./object-storage.server";
import {
  checkpointJob,
  download,
  downloadBuffer,
  repCreate,
  repPoll,
  animateCreate,
} from "./ugc-ad-pipeline.server";
import type { BrandProfile } from "@prisma/client";

function ffmpegBin(): string | null {
  for (const p of ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"]) if (fs.existsSync(p)) return p;
  try { const m = require("ffmpeg-static") as string | { default?: string }; const b = typeof m === "string" ? m : m?.default; if (b && fs.existsSync(b)) return b; } catch { /* fall through */ }
  return null;
}

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += String(d); if (err.length > 8000) err = err.slice(-8000); });
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-400)}`))));
    p.on("error", reject);
  });
}

export interface CommercialBeat {
  /** Cinematic scene description — the compose prompt for this beat. */
  scene: string;
  /** Motion direction for the animator. */
  motion: string;
  /** The narration line spoken over this beat. */
  narration: string;
}

export interface CommercialPlan {
  beats: CommercialBeat[];
  tagline: string;
}

/** Five beats + tagline. Exported for the QA harness. Service mode swaps the
 *  product-in-every-scene brief for a transformation story — the offer has
 *  nothing to photograph, so the beats sell the OUTCOME instead. */
export async function planCommercial(
  productTitle: string,
  productDescription?: string,
  direction?: string,
  serviceMode?: boolean
): Promise<CommercialPlan> {
  const raw = await anthropicText(
    [
      serviceMode
        ? `You are directing a 15-second cinematic TV-style commercial for a service / offer: "${productTitle}". There is nothing physical to photograph — the ad sells the OUTCOME of the offer.`
        : `You are directing a 15-second cinematic TV-style commercial for: "${productTitle}".`,
      productDescription ? `${serviceMode ? "Offer" : "Product"}: ${productDescription.slice(0, 400)}` : "",
      direction ? `The merchant's creative direction (FOLLOW IT): ${direction.slice(0, 600)}` : "",
      ``,
      serviceMode
        ? `Write exactly 5 beats that tell ONE continuous transformation story with rising energy — the before (life with the problem), the discovery, the first win, the after (life visibly changed), the celebration. ONE protagonist carries through EVERY beat (same person, same wardrobe), the world around them transforms scene to scene, and every scene SHOWS the offer's result in the protagonist's life — NEVER invent a physical product, box, bottle, package or logo. Photorealistic live-action only — no cartoons, no text overlays in-scene.`
        : `Write exactly 5 beats that tell ONE continuous story with rising energy — setup, want, turn, payoff, celebration — the way big-budget spots do. ONE protagonist carries through EVERY beat (same person, same wardrobe), the world evolves scene to scene, and the PRODUCT appears naturally in each. Photorealistic live-action only — no cartoons, no text overlays in-scene.`,
      `REALISM RULE: the product is used EXACTLY the way a real customer uses it — a drink gets drunk, a tool gets used, a garment gets worn. NOTHING theatrical: no spraying or pouring it on anyone, no throwing it, no holding it up to the light, no gazing at it in wonder. If the moment would look ridiculous in real life, do not write it.`,
      `For each beat give:`,
      serviceMode
        ? `scene: one sentence, concrete and filmable — who/where/light/mood, and how the offer's result shows on screen.`
        : `scene: one sentence, concrete and filmable — who/where/light/mood, and where the product sits in frame.`,
      `CRITICAL: every scene sentence MUST restate the protagonist's appearance (gender, age, hair, wardrobe) in full — each scene is rendered by an image model that sees ONLY that sentence, and any detail you drop gets re-invented differently, breaking the character between shots.`,
      `motion: one short camera/subject motion phrase (e.g. "slow push-in as she turns toward the window").`,
      `narration: the voice-over line for this beat, 8-12 words, spoken ad copy — no scene description, no style words.`,
      serviceMode ? `Then tagline: 3-6 punchy words for the closing brand card.` : `Then tagline: 3-6 punchy words for the closing product shot.`,
      ``,
      `Reply ONLY JSON: {"beats":[{"scene":"...","motion":"...","narration":"..."},...5 total],"tagline":"..."}`,
    ].filter(Boolean).join("\n"),
    { maxTokens: 700, model: "claude-sonnet-5" }
  );
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("commercial plan: no JSON");
  const j = JSON.parse(m[0]) as CommercialPlan;
  if (!Array.isArray(j.beats) || j.beats.length < 3) throw new Error("commercial plan: fewer than 3 beats");
  j.beats = j.beats.slice(0, 5).map((b) => ({
    scene: String(b.scene || "").slice(0, 300),
    motion: String(b.motion || "slow cinematic push-in").slice(0, 120),
    narration: String(b.narration || "").slice(0, 140),
  }));
  j.tagline = String(j.tagline || productTitle).slice(0, 60);
  // A tagline pinned in the direction is a hard override, not a suggestion —
  // the writer kept "improving" pinned lines into its own copy.
  const pin = direction?.match(/tagline must be exactly:\s*(.+?)\s*$/i);
  if (pin) j.tagline = pin[1].slice(0, 60);
  return j;
}

/** Submit an image job to the fal queue and poll it to a URL. Shared by the
 *  scene keyframes and the service end-card — one queue discipline, one
 *  timeout, everywhere. */
async function falQueueImage(model: string, body: Record<string, unknown>, tag: string): Promise<string> {
  const submit = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!submit.ok) throw new Error(`${tag} submit ${submit.status}: ${(await submit.text()).slice(0, 160)}`);
  const q = (await submit.json()) as { status_url?: string; response_url?: string };
  if (!q.status_url || !q.response_url) throw new Error(`${tag}: no queue urls`);
  // 5 minutes: the fal queue under load has sat past the old 3-minute cap
  // and killed an otherwise-healthy render mid-sequence.
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = await fetch(q.status_url, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
    const sj = (await s.json()) as { status?: string };
    if (sj.status === "COMPLETED") {
      const r = await fetch(q.response_url, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
      const rj = (await r.json()) as { images?: { url?: string }[] };
      const url = rj.images?.[0]?.url;
      if (!url) throw new Error(`${tag}: completed without an image`);
      return url;
    }
    if (sj.status === "FAILED") throw new Error(`${tag}: FAILED`);
  }
  throw new Error(`${tag}: timed out after 5 minutes`);
}

const editModel = () => process.env.COMPOSE_MODEL?.trim() || "fal-ai/nano-banana-pro/edit";
/** The same engine minus its /edit suffix — the text-to-image sibling, for
 *  frames that have no reference at all (a service ad's opening beat). */
const t2iModel = () => editModel().replace(/\/edit$/, "");

const CINE_STYLE =
  "Cinematic film still: anamorphic feel, shallow depth of field, motivated practical light, rich filmic colour grade. Photorealistic, no text overlays, no watermarks.";

/** One scene keyframe. Product mode: the real product photo is the first
 *  reference and the beat's scene is built around it, product-faithful by
 *  construction. Service mode (no product URL): there is nothing physical to
 *  reference — the opening beat is text-to-image on the same engine, and
 *  later beats carry the protagonist via the previous frame alone. */
export async function sceneKeyframe(productImageUrl: string | undefined, scene: string, prevFrameUrl?: string): Promise<string> {
  const refs = [productImageUrl, prevFrameUrl].filter((u): u is string => !!u);
  const res = process.env.COMPOSE_RESOLUTION?.trim();
  if (refs.length === 0) {
    return falQueueImage(t2iModel(), {
      prompt: `${scene} ${CINE_STYLE}`,
      // 9:16 native — the clip, the assembler and the feed are all 9:16;
      // any other shape here gets cover-cropped and loses the composition.
      aspect_ratio: "9:16",
      ...(res ? { resolution: res } : {}),
      num_images: 1,
    }, "scene t2i");
  }
  const continuity = prevFrameUrl
    ? productImageUrl
      ? " SAME protagonist as the previous frame (the last reference image) — same face, hair and wardrobe, the same story continuing."
      : " SAME protagonist as the reference image — same face, hair and wardrobe, the same story continuing."
    : "";
  const fidelity = productImageUrl
    ? " The product from the first reference image appears in the scene EXACTLY as it really is — same shape, colours, printed artwork and lettering, at its true real-world size."
    : "";
  return falQueueImage(editModel(), {
    prompt: `${scene}${continuity}${fidelity} ${CINE_STYLE}`,
    image_urls: refs,
    image_size: "portrait_16_9",
    ...(res ? { resolution: res } : {}),
    num_images: 1,
  }, "scene compose");
}

/** A single branded product image on the text-to-image sibling of the
 *  compose engine — pack shots, brand stills. Exported for the QA harness'
 *  Brand Lab (forging EasyMode hero products before a commercial spends). */
export async function brandImage(prompt: string): Promise<string> {
  const res = process.env.COMPOSE_RESOLUTION?.trim();
  return falQueueImage(t2iModel(), {
    prompt,
    aspect_ratio: "3:4",
    ...(res ? { resolution: res } : {}),
    num_images: 1,
  }, "brand image");
}

/** Service-mode finale. A service ad has no truthful product photo to close
 *  on, so the packshot's job — end on something REAL — falls to a branded
 *  end-card: the tagline large, the offer name beneath, brand colours when
 *  the profile knows them. Exported for the QA harness. */
export async function commercialEndCard(offerTitle: string, tagline: string, visualJson?: string | null): Promise<string> {
  let palette = "a deep charcoal background with warm golden accents";
  try {
    const v = JSON.parse(visualJson || "{}") as { primaryColor?: string; accentColor?: string };
    if (v.primaryColor) palette = `a ${v.primaryColor} background with ${v.accentColor ? `${v.accentColor} accents` : "elegant contrasting accents"}`;
  } catch { /* keep the generic palette */ }
  const res = process.env.COMPOSE_RESOLUTION?.trim();
  // 9:16 native — the packshot slot cover-crops to 9:16, and a 3:4 card
  // loses the edges of its own tagline to that crop.
  return falQueueImage(t2iModel(), {
    prompt:
      `Minimal premium brand end-card for a TV commercial, tall vertical 9:16 format: the tagline "${tagline}" in large elegant cinematic typography, centred with wide safe margins, with "${offerTitle}" in smaller refined type beneath it, on ${palette}. Subtle vignette, faint filmic grain, generous empty space. ` +
      `The ONLY text in the image is exactly "${tagline}" and "${offerTitle}", spelled letter-for-letter — no other words, no logos, no watermarks, no people, no objects.`,
    aspect_ratio: "9:16",
    ...(res ? { resolution: res } : {}),
    num_images: 1,
  }, "end-card");
}

/** Deterministic assembly. Exported for the QA harness (no DB, pure files).
 *  clips are normalized to 720x1280 cover, concatenated, letterboxed and
 *  graded; the packshot is a Ken Burns push-in on the REAL product photo —
 *  or, for a service ad, on the branded end-card (same slot, same move). */
export async function assembleCommercial(opts: {
  clipPaths: string[];
  /** Legacy: one premixed VO file laid over the whole cut. */
  voPath?: string;
  /** One narration file per clip — each is placed AT its beat (adelay mix),
   *  so the line about a scene plays over that scene, not wherever a single
   *  fast read happens to land. Preferred over voPath. */
  narrationPaths?: string[];
  /** Spoken tagline, placed over the packshot. */
  taglinePath?: string;
  productJpegPath?: string;
  /** Deterministic brand close-out: a designed base card plus a transparent
   *  rosette PNG spun live by ffmpeg — no AI-generated finale at all. When
   *  present this replaces the Ken Burns packshot. */
  endCard?: { basePath: string; rosettePath?: string };
  outPath: string;
  packshotSec?: number;
  /** Seconds kept from each clip. The animator returns 10s takes; the fades
   *  are cut for 5 — anything longer used to play out as black. */
  clipSec?: number;
  /** Per-beat lengths (overrides clipSec) — chaos cuts fast, payoffs hold. */
  clipSecs?: number[];
  /** Flex montage: hard 0.5s cuts of REAL renders spliced in after a beat —
   *  the "everything you just saw was made here" proof segment. */
  montage?: { imagePaths: string[]; afterClip: number; secEach?: number };
  /** Sound-off layer: one transparent caption PNG per beat, slid + faded in
   *  over its own beat window (our ffmpeg has no drawtext — text ships as
   *  graphics, which also means brand type instead of subtitle type). */
  captionPaths?: (string | undefined)[];
  /** Caption shown across the montage window. */
  montageCaptionPath?: string;
  /** Small brand mark pinned top-right from watermarkFrom (default: after
   *  the first beat) to the end of the live footage. */
  watermarkPath?: string;
  watermarkFrom?: number;
}): Promise<void> {
  const bin = ffmpegBin();
  if (!bin) throw new Error("no ffmpeg binary");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "comm-"));
  try {
    // 1) Normalize every clip: trim to its beat length (the animator returns
    // longer takes and the fade-out marks the cut), cover-crop, 30fps.
    const clipSecs = opts.clipPaths.map((_, i) => opts.clipSecs?.[i] ?? opts.clipSec ?? 5);
    const norm: string[] = [];
    for (let i = 0; i < opts.clipPaths.length; i++) {
      const sec = clipSecs[i];
      const n = path.join(tmp, `n${i}.mp4`);
      await runFfmpeg(bin, ["-y", "-t", String(sec), "-i", opts.clipPaths[i],
        "-vf", `scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=30,fade=t=in:st=0:d=0.25,fade=t=out:st=${(sec - 0.4).toFixed(2)}:d=0.35,format=yuv420p`,
        "-t", String(sec),
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", n]);
      norm.push(n);
    }
    // 1b) Flex montage: each real-render still becomes a hard-cut segment
    // (no fades — the speed IS the flex), spliced in after its beat.
    const mSecEach = opts.montage?.secEach ?? 0.5;
    const afterClip = opts.montage?.imagePaths.length
      ? Math.min(Math.max(opts.montage.afterClip, 0), opts.clipPaths.length - 1)
      : -1;
    const mLen = (opts.montage?.imagePaths.length || 0) * mSecEach;
    if (opts.montage && afterClip >= 0) {
      const segs: string[] = [];
      for (let k = 0; k < opts.montage.imagePaths.length; k++) {
        const m = path.join(tmp, `m${k}.mp4`);
        await runFfmpeg(bin, ["-y", "-loop", "1", "-framerate", "30", "-t", String(mSecEach), "-i", opts.montage.imagePaths[k],
          "-vf", "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=30,format=yuv420p",
          "-t", String(mSecEach), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", m]);
        segs.push(m);
      }
      norm.splice(afterClip + 1, 0, ...segs);
    }
    // Absolute timeline: where each beat starts once the montage is spliced.
    const clipStart: number[] = [];
    {
      let acc = 0;
      for (let i = 0; i < opts.clipPaths.length; i++) {
        if (afterClip >= 0 && i === afterClip + 1) acc += mLen;
        clipStart.push(acc);
        acc += clipSecs[i];
      }
    }
    const montageStart = afterClip >= 0 ? clipStart[afterClip] + clipSecs[afterClip] : 0;
    const visualLen = clipSecs.reduce((a, b) => a + b, 0) + mLen;
    // 2) Finale segment. Brand end-card mode: the designed card with live
    // spinning guilloché rosettes (one clockwise top-right, one counter
    // bottom-left; the baked centre rosette stays still behind the text).
    // Product mode: Ken Burns push-in on the real product photo — the one
    // frame of the ad that is guaranteed truthful, same trick as cutaway.
    const packSec = opts.packshotSec ?? 4;
    const pack = path.join(tmp, "pack.mp4");
    const frames = Math.round(packSec * 30);
    if (opts.endCard) {
      const args = ["-y",
        "-loop", "1", "-framerate", "30", "-t", String(packSec + 0.2), "-i", opts.endCard.basePath];
      if (opts.endCard.rosettePath) {
        args.push("-loop", "1", "-framerate", "30", "-t", String(packSec + 0.2), "-i", opts.endCard.rosettePath,
          "-filter_complex",
          "[0:v]scale=720:1280[bg];" +
          "[1:v]format=rgba,scale=460:460,split[ra][rb];" +
          "[ra]rotate=t*0.35:c=none:ow=hypot(iw\\,ih):oh=ow[r1];" +
          "[rb]rotate=-t*0.28:c=none:ow=hypot(iw\\,ih):oh=ow[r2];" +
          "[bg][r1]overlay=x=W-w*0.72:y=-h*0.28[b1];" +
          "[b1][r2]overlay=x=-w*0.28:y=H-h*0.72[b2];" +
          `[b2]fade=t=in:st=0:d=0.4,fade=t=out:st=${(packSec - 0.5).toFixed(2)}:d=0.5,format=yuv420p[v]`,
          "-map", "[v]");
      } else {
        args.push("-vf", `scale=720:1280,fade=t=in:st=0:d=0.4,fade=t=out:st=${(packSec - 0.5).toFixed(2)}:d=0.5,format=yuv420p`);
      }
      args.push("-t", String(packSec), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", pack);
      await runFfmpeg(bin, args);
      norm.push(pack);
    } else {
      if (!opts.productJpegPath) throw new Error("assembleCommercial: need productJpegPath or endCard");
      // fade must come AFTER zoompan: zoompan expands input frame 0 across the
      // whole packshot, and a pre-zoom fade-in makes frame 0 pure black — which
      // is 4 seconds of zoomed black, the bug that ate every packshot so far.
      await runFfmpeg(bin, ["-y", "-loop", "1", "-framerate", "30", "-t", String(packSec + 0.2), "-i", opts.productJpegPath,
        "-vf",
        `scale=1440:2560:force_original_aspect_ratio=increase,crop=1440:2560,` +
        `zoompan=z='min(zoom+0.0018,1.13)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=720x1280:fps=30,` +
        `fade=t=in:st=0:d=0.4,fade=t=out:st=${(packSec - 0.5).toFixed(2)}:d=0.5,format=yuv420p`,
        "-t", String(packSec), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", pack]);
      norm.push(pack);
    }
    // 3) The voice track. Per-beat narrations are each delayed to their own
    // scene's ABSOLUTE start (montage shift included) and mixed. A single
    // premixed voPath (legacy) is laid from the start as before.
    const totalSec = visualLen + packSec;
    let voPath = opts.voPath;
    if (opts.narrationPaths?.length) {
      const pieces = [...opts.narrationPaths];
      if (opts.taglinePath) pieces.push(opts.taglinePath);
      const mixed = path.join(tmp, "vo-mix.wav");
      const inputs = pieces.flatMap((p) => ["-i", p]);
      const delays = pieces.map((_, i) => {
        const ms = i < opts.narrationPaths!.length
          ? Math.round((clipStart[i] + 0.4) * 1000)   // line i over beat i
          : Math.round((visualLen + 0.5) * 1000);     // tagline over the finale
        return `[${i}:a]adelay=${ms}:all=1[a${i}]`;
      });
      const graph = `${delays.join(";")};${pieces.map((_, i) => `[a${i}]`).join("")}amix=inputs=${pieces.length}:normalize=0,apad=whole_dur=${totalSec}[aout]`;
      await runFfmpeg(bin, ["-y", ...inputs, "-filter_complex", graph, "-map", "[aout]", "-t", String(totalSec), mixed]);
      voPath = mixed;
    }
    // 4) Concat + letterbox + grade + the sound-off layer (captions and the
    // watermark composited as timed overlays — each caption slides up 44px
    // and alpha-fades over its own beat window) + VO. The output runs the
    // FULL visual length — a short voice read must never amputate the cut.
    const list = path.join(tmp, "list.txt");
    fs.writeFileSync(list, norm.map((n) => `file '${n}'`).join("\n"));
    // Bars slimmed to 6.5%: with 9:16-native sources every pixel is real
    // composition now — the old 10.5% bars ate a fifth of the context.
    const graded =
      "drawbox=x=0:y=0:w=iw:h=ih*0.065:color=black:t=fill," +
      "drawbox=x=0:y=ih*0.935:w=iw:h=ih*0.065:color=black:t=fill," +
      "eq=contrast=1.06:saturation=1.12:brightness=-0.012";
    const overlays: { path: string; start: number; end: number; slide: boolean }[] = [];
    (opts.captionPaths || []).forEach((p, i) => {
      if (p && i < opts.clipPaths.length) overlays.push({ path: p, start: clipStart[i] + 0.35, end: clipStart[i] + clipSecs[i] - 0.2, slide: true });
    });
    if (opts.montageCaptionPath && afterClip >= 0) overlays.push({ path: opts.montageCaptionPath, start: montageStart + 0.1, end: montageStart + mLen - 0.1, slide: true });
    if (opts.watermarkPath) overlays.push({ path: opts.watermarkPath, start: opts.watermarkFrom ?? clipSecs[0], end: visualLen, slide: false });
    const args = ["-y", "-f", "concat", "-safe", "0", "-i", list];
    if (voPath) args.push("-i", voPath);
    if (overlays.length) {
      overlays.forEach((o) => args.push("-loop", "1", "-framerate", "30", "-t", String(totalSec), "-i", o.path));
      const voOff = voPath ? 1 : 0;
      const parts: string[] = [`[0:v]${graded}[v0]`];
      let cur = "v0";
      overlays.forEach((o, k) => {
        const idx = 1 + voOff + k;
        const st = o.start.toFixed(2);
        const en = o.end.toFixed(2);
        parts.push(`[${idx}:v]format=rgba,fade=t=in:st=${st}:d=0.25:alpha=1,fade=t=out:st=${(o.end - 0.25).toFixed(2)}:d=0.25:alpha=1[o${k}]`);
        const x = o.slide ? "(W-w)/2" : "W-w-24";
        const y = o.slide ? `H-h-118-min((t-${st})*260\\,44)` : "104";
        parts.push(`[${cur}][o${k}]overlay=x=${x}:y=${y}:enable='between(t,${st},${en})'[v${k + 1}]`);
        cur = `v${k + 1}`;
      });
      parts.push(`[${cur}]format=yuv420p[vout]`);
      args.push("-filter_complex", parts.join(";"), "-map", "[vout]");
      if (voPath) args.push("-map", "1:a", "-c:a", "aac");
    } else {
      args.push("-vf", `${graded},format=yuv420p`);
      if (voPath) args.push("-map", "0:v", "-map", "1:a", "-c:a", "aac");
    }
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-t", String(totalSec), opts.outPath);
    await runFfmpeg(bin, args);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

/** One motion clip on the chosen engine, with a safety-filter fallback: a
 *  premium engine (Veo) can flag a perfectly ordinary beat as "sensitive"
 *  (E005) — a sweaty athlete is enough. One beat on the default engine
 *  beats a dead render. Exported for the QA harness. */
export async function renderMotionClip(
  engineKey: string | undefined,
  opts: { startImage: string; prompt: string; negativePrompt?: string },
  tag: string
): Promise<string> {
  try {
    const { id } = await animateCreate(engineKey, opts);
    return await repPoll(id, 8 * 60_000, tag);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!engineKey || engineKey === "kling" || !/sensitive|E005/i.test(msg)) throw e;
    console.log(`[commercial] ${tag} flagged by ${engineKey}'s safety filter — retrying on the default engine`);
    const fb = await animateCreate(undefined, opts);
    return await repPoll(fb.id, 8 * 60_000, `${tag}-fallback`);
  }
}

/** Motion gate: sample three frames from a rendered clip and ask a vision
 *  judge for the artifacts stills can never show — rubbery anatomy, props
 *  floating unsupported, a label melted mid-motion. The keyframe gate
 *  passes beautiful frames; this is what catches the slop BETWEEN them.
 *  Fail-open on judge/tooling outage: a paid clip must not die because
 *  the judge did. Exported for the QA harness. */
export async function motionGate(clipUrl: string, serviceMode: boolean): Promise<{ ok: boolean; why: string }> {
  const bin = ffmpegBin();
  if (!bin) return { ok: true, why: "no ffmpeg" };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mgate-"));
  try {
    const clip = path.join(tmp, "c.mp4");
    await download(clipUrl, clip);
    const frames: string[] = [];
    for (const t of ["1", "2.5", "4"]) {
      const f = path.join(tmp, `f${t.replace(".", "_")}.jpg`);
      try {
        await runFfmpeg(bin, ["-y", "-ss", t, "-i", clip, "-frames:v", "1", "-vf", "scale=720:-2", "-q:v", "5", f]);
        frames.push(`data:image/jpeg;base64,${fs.readFileSync(f).toString("base64")}`);
      } catch { /* clip shorter than the sample point — judge what exists */ }
    }
    if (!frames.length) return { ok: true, why: "no frames extracted" };
    const { anthropicVision } = await import("./anthropic.server");
    const raw = await anthropicVision(
      [
        "These are frames sampled from ONE AI-generated video clip for a commercial.",
        "Fail it ONLY for glaring motion artifacts a viewer would laugh at:",
        "- warped or rubbery anatomy: extra/missing limbs, joints bent wrong, a melted face",
        "- an object floating unsupported in mid-air, or passing through something solid",
        serviceMode ? "" : "- the hero product's shape or label melted into an unreadable smear",
        "Cinematic motion blur, soft focus and stylization are all FINE — judge physics, not polish.",
        'Reply ONLY JSON: {"ok":true|false,"why":"<8 words>"}',
      ].filter(Boolean).join("\n"),
      frames
    );
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { ok: true, why: "judge reply unreadable" };
    const j = JSON.parse(m[0]) as { ok?: boolean; why?: string };
    return { ok: j.ok !== false, why: String(j.why || "").slice(0, 120) };
  } catch (e) {
    return { ok: true, why: `gate error: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}` };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

export interface CommercialAdParams {
  shopId: string;
  brandProfile: BrandProfile;
  productTitle: string;
  productDescription?: string;
  productImageUrl?: string;
  /** Intangible offer — no product photo exists; sell the outcome and close
   *  on a branded end-card instead of the real-photo packshot. */
  serviceMode?: boolean;
  /** Engine key for the motion stage ("kling"|"seedance"|"hailuo"|"veo") —
   *  the studio's picker choice. Undefined = the default animator. */
  videoEngine?: string;
  direction?: string;
  origin?: string;
  jobId?: string;
  resume?: {
    plan?: string;
    keyframeUrls?: string;
    clipUrls?: string;
    audioUrl?: string;
    endcardUrl?: string;
  };
}

/** Full commercial. Checkpoints every paid artifact (plan is cheap but the
 *  keyframes, clips and TTS are money) so a queue restart re-attaches. */
export async function generateCommercialAd(params: CommercialAdParams): Promise<string> {
  const serviceMode = params.serviceMode === true;
  if (!params.productImageUrl && !serviceMode) throw new Error("Commercial needs a product image");
  const ckpt = (patch: Record<string, unknown>) =>
    params.jobId ? checkpointJob(params.jobId, patch) : Promise.resolve();

  // 1) SHOT LIST
  let plan: CommercialPlan;
  if (params.resume?.plan) {
    plan = JSON.parse(params.resume.plan) as CommercialPlan;
  } else {
    plan = await planCommercial(params.productTitle, params.productDescription, params.direction, serviceMode);
    await ckpt({ ckCommercialPlan: JSON.stringify(plan) });
  }

  // 2) KEYFRAMES — product-faithful scene stills, one per beat.
  let keyframeUrls: string[] = params.resume?.keyframeUrls ? JSON.parse(params.resume.keyframeUrls) : [];
  if (keyframeUrls.length < plan.beats.length) {
    for (let i = keyframeUrls.length; i < plan.beats.length; i++) {
      keyframeUrls.push(await sceneKeyframe(params.productImageUrl, plan.beats[i].scene, keyframeUrls[i - 1]));
      await ckpt({ ckCommercialKeyframes: JSON.stringify(keyframeUrls) });
    }
  }

  // 3) MOTION — one clip per beat on the chosen engine, each clip judged by
  // the motion gate; a clip that fails physics gets ONE re-roll (the second
  // take ships either way — unbounded re-rolls would be an open wallet).
  const animOpts = (i: number) => ({
    startImage: keyframeUrls[i],
    prompt: `${plan.beats[i].motion}. Cinematic live-action, natural physics${serviceMode ? "" : ", the product keeps its exact printed artwork and lettering"}. No morphing, no text.`,
    negativePrompt: "warping, morphing text, extra limbs, cartoon, distortion",
  });
  // Beats are independent — render them ALL at once. Sequential clips made
  // a five-beat spot take 5× the slowest clip; parallel makes it take 1×.
  let clipUrls: string[] = params.resume?.clipUrls ? JSON.parse(params.resume.clipUrls) : [];
  if (clipUrls.length < plan.beats.length) {
    const fresh = await Promise.all(
      plan.beats.slice(clipUrls.length).map((_, k) => (async () => {
        const i = clipUrls.length + k;
        let clip = await renderMotionClip(params.videoEngine, animOpts(i), `commercial-beat-${i + 1}`);
        const gate = await motionGate(clip, serviceMode);
        if (!gate.ok) {
          console.log(`[commercial] beat ${i + 1} failed motion gate (${gate.why}) — re-rolling once`);
          clip = await renderMotionClip(params.videoEngine, animOpts(i), `commercial-beat-${i + 1}-reroll`);
        }
        return clip;
      })())
    );
    clipUrls = [...clipUrls, ...fresh];
    await ckpt({ ckCommercialClips: JSON.stringify(clipUrls) });
  }

  // 4) VOICE — one TTS read PER LINE (plus the tagline), so assembly can
  // place each line over its own beat. A single fast read used to finish at
  // ~16s and, with -shortest, take the back half of the ad down with it.
  const voLines = [...plan.beats.map((b) => b.narration || plan.tagline), `${plan.tagline}.`];
  let audioUrls: string[] = [];
  if (params.resume?.audioUrl?.trim().startsWith("[")) {
    audioUrls = JSON.parse(params.resume.audioUrl) as string[];
  } // a legacy single-URL checkpoint is a differently-paced read — re-synthesize
  if (audioUrls.length < voLines.length) {
    const freshVo = await Promise.all(
      voLines.slice(audioUrls.length).map((text, k) => (async () => {
        const id = await repCreate("minimax/speech-02-hd", {
          text,
          voice_id: "English_Trustworth_Man",
          emotion: "neutral",
          english_normalization: true,
          language_boost: "English",
        });
        return repPoll(id, 3 * 60_000, `commercial-vo-${audioUrls.length + k + 1}`);
      })())
    );
    audioUrls = [...audioUrls, ...freshVo];
    await ckpt({ ckCommercialAudio: JSON.stringify(audioUrls) });
  }

  // 5) FINALE FRAME — product mode closes on the REAL photo; service mode
  // has no truthful photo, so it closes on a generated branded end-card
  // (checkpointed: it's a paid render like the keyframes).
  let packshotUrl = params.productImageUrl || "";
  if (serviceMode && !params.productImageUrl) {
    packshotUrl = params.resume?.endcardUrl || "";
    if (!packshotUrl) {
      packshotUrl = await commercialEndCard(params.productTitle, plan.tagline, params.brandProfile?.visualJson);
      await ckpt({ ckCommercialEndcard: packshotUrl });
    }
  }

  // 6) ASSEMBLY
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "commx-"));
  try {
    const clipPaths: string[] = [];
    for (let i = 0; i < clipUrls.length; i++) {
      const p = path.join(tmp, `clip${i}.mp4`);
      await download(clipUrls[i], p);
      clipPaths.push(p);
    }
    const voPaths: string[] = [];
    for (let i = 0; i < audioUrls.length; i++) {
      const p = path.join(tmp, `vo${i}.mp3`);
      fs.writeFileSync(p, await downloadBuffer(audioUrls[i]));
      voPaths.push(p);
    }
    // Re-encode the finale image to a plain JPEG so AVIF/WebP originals
    // can't break the image2 loop (the b-roll lesson).
    const rawImg = path.join(tmp, "product.raw");
    const jpg = path.join(tmp, "product.jpg");
    await download(packshotUrl, rawImg);
    const bin = ffmpegBin();
    if (!bin) throw new Error("no ffmpeg binary");
    await runFfmpeg(bin, ["-y", "-i", rawImg, "-vf", "scale='min(2000,iw)':-2", "-q:v", "3", jpg]);

    const rendersDir = path.join(process.cwd(), "data", "renders");
    fs.mkdirSync(rendersDir, { recursive: true });
    const fileName = `commercial-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
    const outPath = path.join(rendersDir, fileName);
    await assembleCommercial({
      clipPaths,
      narrationPaths: voPaths.slice(0, clipPaths.length),
      taglinePath: voPaths[clipPaths.length],
      productJpegPath: jpg,
      outPath,
    });
    try { await mirrorRender(fileName, fs.readFileSync(outPath)); } catch { /* non-fatal */ }

    const asset = await db.asset.create({
      data: {
        shopId: params.shopId,
        type: "VIDEO_AD",
        status: "PENDING",
        title: `Commercial — ${params.productTitle}`,
        bodyJson: JSON.stringify({
          style: "COMMERCIAL",
          engine: "easymode-cinematic",
          videoUrl: `/renders/${fileName}`,
          script: plan.beats.map((b) => b.narration).join(" "),
          tagline: plan.tagline,
          keyframeUrls,
        }),
        metaJson: JSON.stringify({
          style: "COMMERCIAL",
          productTitle: params.productTitle,
          direction: params.direction || null,
          origin: params.origin || null,
          productImageUrl: params.productImageUrl || null,
          serviceMode,
          endcardUrl: serviceMode ? packshotUrl : null,
          beats: plan.beats,
        }),
      },
    });
    return asset.id;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}
