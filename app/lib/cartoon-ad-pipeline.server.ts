/* Cartoon ad pipeline — the product redrawn as an animated, illustrated ad in
 * a merchant-picked style:
 *   1. SCRIPT   — Claude writes a ~11s playful VO script in the brand's voice
 *   2. KEYFRAME — flux-kontext-pro redraws the REAL product photo in the
 *                 chosen cartoon style (product identity locked); no photo /
 *                 service mode → flux-dev paints the scene from scratch
 *   3. ANIMATE  — kling v1.6 brings the keyframe to life with style-matched
 *                 motion (kling has been rock-solid on this account)
 *   4. VOICE    — minimax speech-02-hd narrator cast per style
 *   5. ASSEMBLY — shared ffmpeg assembler: loop the clip to the narration,
 *                 burn UGC captions, mux the VO
 * COGS ≈ $0.04 keyframe + ~$0.25-0.50 kling + $0.001 TTS. Checkpointed like
 * the UGC pipeline so deploy restarts never re-spend completed stages. */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { db } from "../db.server";
import { anthropicText } from "./anthropic.server";
import { mirrorRender } from "./object-storage.server";
import {
  assemble,
  checkpointJob,
  animateCreate,
  download,
  downloadBuffer,
  repCreate,
  repPoll,
} from "./ugc-ad-pipeline.server";
import type { BrandProfile } from "@prisma/client";

/* Per-style recipe: how the keyframe is drawn, how it moves, and who narrates.
 * These are the VIRAL formats — the looks people already share — named
 * descriptively (never by the IP that popularized them) so every ad stays
 * legally clean. Voices come from the render-tested MiniMax stock list. */
export type CartoonStyleKey =
  | "dreamanime" | "retroanime" | "pixar" | "toyfigure"
  | "brick" | "vintagetoon" | "papercut" | "puppet" | "clay";
// NOTE: cartoon-styles.json is the shareable single source of these recipes
// (scripts/generate-style-tiles.mjs reads it on GitHub Actions to render
// previews). Keep this literal and the JSON in sync when tuning styles.
export const CARTOON_RECIPES: Record<
  CartoonStyleKey,
  { name: string; look: string; motion: string; voice: string }
> = {
  dreamanime: {
    name: "Dream Anime",
    look: "hand-painted Japanese animation film still: soft watercolor-washed skies and greenery, painterly cumulus clouds, warm golden sunlight, gentle expressive characters with soft rounded features and big warm eyes, delicate clean linework, lush background detail, wholesome nostalgic wonder, cinematic film composition",
    motion: "a gentle breeze moves hair and grass, petals drift through warm light, soft parallax clouds, slow serene camera pan, quiet magical atmosphere",
    voice: "English_SereneWoman",
  },
  retroanime: {
    name: "Retro Anime",
    look: "1990s retro cel anime OVA still: crisp confident lineart, dramatic cel shading with hard-edged shadow shapes, saturated sunset palette, subtle VHS grain and soft glow, stylish confident character poses, nostalgic 90s anime production feel",
    motion: "dramatic 90s anime energy, speed lines sweeping through, flickering retro glow, confident slow zoom",
    voice: "English_ConfidentWoman",
  },
  pixar: {
    name: "3D Toon",
    look: "premium 3D animated feature-film render: appealing rounded character design with big expressive glossy eyes and soft subsurface-scattered skin, cinematic global illumination, shallow depth of field, rich material detail, big-studio animated-movie quality",
    motion: "smooth cinematic 3D camera drift, soft depth of field, gentle bouncy character-film motion, warm expressive face animation",
    voice: "English_Trustworth_Man",
  },
  toyfigure: {
    name: "Boxed Figure",
    look: "collectible action-figure presentation: rendered as a glossy molded toy inside retail blister packaging on a printed cardboard backer card, tiny themed accessories in molded compartments, price-sticker-era toy-aisle nostalgia, crisp studio toy-photography lighting",
    motion: "retro toy-commercial energy, slow hero showcase feel, studio light sweeps, sparkle glints on the packaging",
    voice: "English_magnetic_voiced_man",
  },
  brick: {
    name: "Block Build",
    look: "rebuilt as a chunky VOXEL character in a cube-world diorama, like a retro sandbox video game brought to life: head and body assembled from large square cubes with completely flat smooth matte faces, simple pixel-style painted facial features on a flat CUBE-shaped head, squared-off right-angle proportions, bright saturated colors, crisp macro photography of a handmade cube world — an original generic voxel aesthetic. Absolutely NO cylindrical studs, NO round-headed minifigures, NO interlocking-brick construction, NO toy-brand look",
    motion: "playful stop-motion voxel animation, snappy stepped movement, cubes assembling and snapping into place",
    voice: "English_PlayfulGirl",
  },
  vintagetoon: {
    name: "Vintage Toon",
    look: "playful vintage 2D animation illustration: hand-inked outlines, warm storybook color palette, subtle paper texture and print grain, exaggerated joyful poses and rosy-cheeked expressions, charming mid-century cartoon town energy, richly detailed hand-drawn scene",
    motion: "bouncy vintage cartoon motion, cheerful exaggerated gestures, gentle film-grain flicker, playful mid-century animation energy",
    voice: "English_Comedian",
  },
  papercut: {
    // legacy key — kept so pre-existing assets still remix correctly
    name: "Paper Cutout",
    look: "construction-paper cutout cartoon style, flat layered paper shapes with visible cut edges, handmade collage charm, simple bold colors",
    motion: "paper layers shifting in gentle parallax, subtle handmade stop-motion jitter, cozy charm",
    voice: "English_Comedian",
  },
  puppet: {
    name: "Felt Puppet",
    look: "handmade felt puppet style, fuzzy fabric texture with stitched seams, friendly googly eyes, cozy puppet-workshop stage set",
    motion: "puppet-show bounce, fuzzy character wobble, handheld puppet-stage feel, warm playful energy",
    voice: "English_FriendlyPerson",
  },
  clay: {
    name: "Claymation",
    look: "handcrafted claymation stop-motion still: visibly hand-molded plasticine with subtle fingerprints and tool marks, miniature practical set with tiny handmade props, warm studio key light, charming slightly imperfect handmade shapes, cozy stop-motion film quality",
    motion: "stop-motion claymation movement, subtle frame-step charm, squishy clay bounce",
    voice: "English_Kind-heartedGirl",
  },
};

interface CartoonAdParams {
  shopId: string;
  brandProfile: BrandProfile;
  productTitle: string;
  productDescription?: string;
  productImageUrl?: string;
  styleKey: string; // one of CARTOON_RECIPES; unknown keys fall back to dreamanime
  avatarId?: string; // presenter — the CHARACTER the style redraws ("turn yourself into X")
  avatarVariant?: number;
  direction?: string; // merchant's custom prompt
  serviceMode?: boolean; // intangible offer — draw the OUTCOME, not an object
  videoEngine?: string; // engine-picker key (video-engines.ts); undefined = default
  origin?: string; // provenance label for the finished card
  jobId?: string; // enables stage checkpointing
  resume?: {
    script?: string;
    composedUrl?: string; // photoreal presenter-holding-product frame
    keyframeUrl?: string;
    klingPredictionId?: string; // re-attach to a live animate run — never re-buy it
    animUrl?: string;
    audioUrl?: string;
  };
}

export async function generateCartoonAd(params: CartoonAdParams): Promise<string> {
  const recipe = CARTOON_RECIPES[(params.styleKey as CartoonStyleKey)] || CARTOON_RECIPES.dreamanime;
  const voiceJson = JSON.parse(params.brandProfile.voiceJson || "{}");
  const resume = params.resume || {};
  const ckpt = (patch: Record<string, unknown>) =>
    params.jobId ? checkpointJob(params.jobId, patch) : Promise.resolve();

  // 1) SCRIPT — cartoon ads earn their keep with playful, jingle-adjacent VO.
  let script = resume.script || "";
  if (!script) {
    const scriptPrompt = [
      `You write voice-over scripts for short animated (cartoon) video ads.`,
      params.serviceMode
        ? `This is a SERVICE / offer (not a physical product): "${params.productTitle}". Sell the RESULT the customer gets.`
        : `Product: "${params.productTitle}".`,
      params.productDescription ? `Context: ${params.productDescription.slice(0, 300)}` : "",
      voiceJson.tone ? `Brand voice/tone: ${voiceJson.tone}.` : "",
      `Animation style: ${recipe.name} — lean into its energy.`,
      params.direction ? `Merchant direction (follow it): ${params.direction}` : "",
      ``,
      `Rules: The FIRST sentence must be a scroll-stopping hook. 24 to 30 words`,
      `TOTAL (about 11 seconds spoken). Playful, warm, a little witty — like a`,
      `beloved animated commercial. End with a short call to action.`,
      `SPEECH PACING (a voice model reads this aloud): commas where a person`,
      `breathes, a period at the END of every sentence. Short complete sentences.`,
      `Output ONLY the spoken words — no stage directions, quotes, emoji, or hashtags.`,
    ]
      .filter(Boolean)
      .join("\n");
    script = ((await anthropicText(scriptPrompt, { model: "claude-sonnet-5", maxTokens: 200 })) || "")
      .replace(/["“”\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!script) throw new Error("[cartoon:script] empty script from model");
    const w = script.split(" ");
    if (w.length > 32) script = w.slice(0, 32).join(" ");
    if (!/[.!?]$/.test(script)) script += ".";
    await ckpt({ ckScript: script });
  }

  // 2) KEYFRAME — "turn yourself into X": with a presenter cast, we first
  // compose the PHOTOREAL presenter-holding-product frame (same engine as UGC
  // ads), then kontext redraws the whole scene in the picked style — the
  // character keeps the presenter's likeness, the product stays recognizable.
  // No presenter → product-hero redraw as before. Every step falls back
  // gracefully (compose failure → portrait-only; no portrait → product path).
  let keyframeUrl = resume.keyframeUrl || "";
  if (!keyframeUrl) {
    const sceneBits = params.direction ? ` Scene direction: ${params.direction.slice(0, 200)}.` : "";

    // 2a) source photo to stylize: composed presenter+product frame, else the
    // presenter portrait (service mode / no product photo), else no presenter.
    let sourcePhotoUrl = "";
    let withCharacter = false;
    if (params.avatarId) {
      const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
      let portraitUrl = "";
      try {
        const { resolvePortraitFile } = await import("./ugc-ad-pipeline.server");
        const path = await import("node:path");
        const file = resolvePortraitFile(params.avatarId, params.avatarVariant ?? 0);
        if (base) portraitUrl = `${base}/avatars/${path.basename(file)}`;
      } catch { /* unknown presenter on this deploy → product-hero path */ }
      if (portraitUrl) {
        sourcePhotoUrl = portraitUrl;
        withCharacter = true;
        let composedUrl = resume.composedUrl || "";
        if (!composedUrl && !params.serviceMode && params.productImageUrl) {
          try {
            const { composeHoldingFrames } = await import("./fal-image.server");
            const frames = await composeHoldingFrames(portraitUrl, params.productImageUrl, params.productTitle, 1, "hold", params.direction);
            composedUrl = frames[0] || "";
            if (composedUrl) await ckpt({ ckComposedUrl: composedUrl });
          } catch (e) {
            console.error(`[cartoon] compose failed (stylizing plain portrait): ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
          }
        }
        if (composedUrl) sourcePhotoUrl = composedUrl;
      }
    }

    if (sourcePhotoUrl && withCharacter) {
      const prompt =
        `Redraw this ENTIRE photo as a ${recipe.look}. The person becomes a charming ${recipe.name} character ` +
        `with the same hairstyle, outfit colors and a friendly stylized likeness. ` +
        `${params.serviceMode ? "" : `Keep the ${params.productTitle} they are presenting clearly recognizable — same shape, colors, logos and TRUE real-world size, never miniaturized. `}` +
        `Hands are anatomically correct — five fingers per hand, natural relaxed grip, no extra or missing fingers. ` +
        `Delightful advertising scene, simple complementary background.${sceneBits} ` +
        `Vertical 9:16 composition, no watermark, no caption text.`;
      const id = await repCreate("black-forest-labs/flux-kontext-pro", {
        prompt,
        input_image: sourcePhotoUrl,
        aspect_ratio: "9:16",
        output_format: "jpg",
      });
      keyframeUrl = await repPoll(id, 5 * 60_000, "cartoon-keyframe");
    } else if (!params.serviceMode && params.productImageUrl) {
      const prompt =
        `Redraw this exact product as a ${recipe.look}. Keep the product's shape, colors, ` +
        `proportions, logos and text clearly recognizable — same product, new art style. ` +
        `Place it as the hero of a delightful advertising scene with a simple complementary background.${sceneBits} ` +
        `Vertical 9:16 composition, no watermark, no caption text.`;
      const id = await repCreate("black-forest-labs/flux-kontext-pro", {
        prompt,
        input_image: params.productImageUrl,
        aspect_ratio: "9:16",
        output_format: "jpg",
      });
      keyframeUrl = await repPoll(id, 5 * 60_000, "cartoon-keyframe");
    } else {
      const subject = params.serviceMode
        ? `a joyful scene showing the happy OUTCOME of "${params.productTitle}" (a service) — a delighted character enjoying the result`
        : `"${params.productTitle}" as the hero of a delightful advertising scene`;
      const prompt = `${recipe.look}. ${subject}.${sceneBits} Vertical 9:16 composition, advertising quality, no watermark, no caption text.`;
      const id = await repCreate("black-forest-labs/flux-dev", {
        prompt,
        num_inference_steps: 30,
        guidance: 3,
        aspect_ratio: "9:16",
        output_format: "jpg",
        output_quality: 92,
      });
      keyframeUrl = await repPoll(id, 5 * 60_000, "cartoon-keyframe");
    }
    await ckpt({ ckKeyframeUrl: keyframeUrl });
  }

  // 3) ANIMATE — kling brings the keyframe to life. The keyframe is a hosted
  // replicate.delivery URL (same provider), so it's passed directly — no
  // multi-MB base64 body. A restart mid-poll re-attaches to the SAME paid
  // prediction (omni-human pattern) instead of buying a second render.
  let animUrl = resume.animUrl || "";
  if (!animUrl && resume.klingPredictionId) {
    try {
      animUrl = await repPoll(resume.klingPredictionId, 12 * 60_000, "cartoon-animate(resumed)");
      await ckpt({ ckAnimUrl: animUrl });
    } catch { /* old prediction died — fall through to a fresh one */ }
  }
  if (!animUrl) {
    const { id: animId } = await animateCreate(params.videoEngine, {
      startImage: keyframeUrl,
      prompt: `${recipe.motion}. Keep the same art style as the first frame throughout — consistent ${recipe.name} look, ${params.avatarId ? "the character presents the product to camera with warm natural gestures, product clearly visible" : "the product stays the clear hero"}, vertical video.`,
      negativePrompt: "photorealistic, live action, morphing, distortion, style change, extra objects, text, watermark, blur",
    });
    await ckpt({ ckKlingId: animId });
    animUrl = await repPoll(animId, 12 * 60_000, "cartoon-animate");
    await ckpt({ ckAnimUrl: animUrl });
  }

  // 4) VOICE — style-cast narrator reads the script (cheap; regen on dead URL).
  let audioBuf: Buffer | null = null;
  if (resume.audioUrl) {
    try { audioBuf = await downloadBuffer(resume.audioUrl); } catch { audioBuf = null; }
  }
  if (!audioBuf || audioBuf.length < 10_000) {
    let audioUrl: string;
    try {
      const ttsId = await repCreate("minimax/speech-02-hd", {
        text: script,
        voice_id: recipe.voice,
        emotion: "happy",
        english_normalization: true,
        language_boost: "English",
      });
      audioUrl = await repPoll(ttsId, 3 * 60_000, "cartoon-tts");
    } catch {
      const ttsId = await repCreate("minimax/speech-02-turbo", { text: script, voice_id: recipe.voice });
      audioUrl = await repPoll(ttsId, 3 * 60_000, "cartoon-tts");
    }
    await ckpt({ ckAudioUrl: audioUrl });
    audioBuf = await downloadBuffer(audioUrl);
  }
  if (audioBuf.length < 10_000) throw new Error("[cartoon:tts] audio came back empty");

  // 5) ASSEMBLY — loop the animation to the narration, captions on, no photo
  // b-roll (a real photo cutting into a cartoon reads as a glitch).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toon-"));
  try {
    const animPath = path.join(tmp, "anim.mp4");
    await download(animUrl, animPath);
    const audioPath = path.join(tmp, "voice.mp3");
    fs.writeFileSync(audioPath, audioBuf);

    const rendersDir = path.join(process.cwd(), "data", "renders");
    fs.mkdirSync(rendersDir, { recursive: true });
    const fileName = `toon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
    const outPath = path.join(rendersDir, fileName);

    await assemble({
      talkingPath: animPath,
      audioPath,
      productImagePath: null,
      script,
      outPath,
      lipSynced: false, // silent kling clip + our narration
    });

    try { await mirrorRender(fileName, fs.readFileSync(outPath)); } catch { /* non-fatal */ }

    const asset = await db.asset.create({
      data: {
        shopId: params.shopId,
        type: "VIDEO_AD",
        status: "PENDING",
        title: `${recipe.name} cartoon — ${params.productTitle}`,
        bodyJson: JSON.stringify({
          style: "CARTOON",
          cartoonStyle: recipe.name,
          engine: "flux+kling",
          voiceId: recipe.voice,
          videoUrl: `/renders/${fileName}`,
          keyframeUrl,
          prompt: script,
          script,
        }),
        metaJson: JSON.stringify({
          style: "CARTOON",
          cartoonStyle: params.styleKey,
          productTitle: params.productTitle,
          avatarId: params.avatarId || null,
          avatarVariant: params.avatarId ? (params.avatarVariant ?? 0) : null,
          direction: params.direction || null,
          origin: params.origin || null,
        }),
      },
    });
    return asset.id;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}
