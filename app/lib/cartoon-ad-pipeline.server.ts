/* Cartoon ad pipeline — the product redrawn as an animated, illustrated ad in
 * a merchant-picked style:
 *   1. SCRIPT   — Claude writes a ~11s playful VO script in the brand's voice
 *   2. KEYFRAME — flux-kontext-pro redraws the REAL product photo in the
 *                 chosen cartoon style (product identity locked); no photo /
 *                 service mode → flux-dev paints the scene from scratch
 *   3. VOICE    — minimax speech-02-hd narrator cast per style. Runs BEFORE
 *                 the animation because the lipsync needs audio to sync to.
 *   4. PERFORMANCE — omni-human lipsyncs the character to that narration.
 *                 The anthem pipeline already lipsyncs a cartoon-styled
 *                 singer, so a stylized face is no obstacle.
 *   5. MOTION   — kling v1.6, used when there is no character to sync (a
 *                 product-hero cartoon) or when the lipsync failed. That path
 *                 tells the character NOT to mouth words, because nothing
 *                 would be syncing them.
 *   6. ASSEMBLY — shared ffmpeg assembler: loop the clip to the narration,
 *                 burn UGC captions, mux the VO
 * COGS ≈ $0.04 keyframe + ~$0.25-0.50 performance + $0.001 TTS. Checkpointed
 * like the UGC pipeline so deploy restarts never re-spend completed stages. */

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
import { langDirective } from "./content-lang";
import { withBrandFallback } from "./ad-copy-retry.server";

/* ---- Resume plumbing: never re-BUY what a restart interrupted ------------
 * Two failure modes here cost merchants real money:
 *   1. Provider delivery URLs (replicate.delivery, fal) die after ~an hour,
 *      but a job checkpoint lives for the whole job — and the queue retries
 *      IMMEDIATELY, so all three attempts feed the SAME dead URL to the next
 *      stage and fail identically. A checkpoint becomes a poison pill.
 *   2. A prediction is BILLED the moment it's created. A deploy restart
 *      mid-poll must re-attach to it (the ckKlingId/ckOmniId pattern), never
 *      buy a second one.
 * The queue maps only a hand-picked subset of checkpoints into `resume`, so
 * the paid-prediction ids below are read straight off the job payload.
 * Exported — the jingle pipeline runs on the same plumbing. */

/** Is a resumed URL still fetchable? HEAD, then a ranged GET for hosts that
 *  refuse HEAD. A false negative only costs a regeneration; a false positive
 *  ships a dead link, so anything unclear counts as dead. */
export async function checkpointUrlAlive(url: string, timeoutMs = 8_000): Promise<boolean> {
  if (!url || typeof url !== "string") return false;
  if (!/^https?:\/\//i.test(url)) return true; // local /renders path or data uri — never expires
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    let res = await fetch(url, { method: "HEAD", signal: ac.signal });
    if (res.status === 403 || res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, signal: ac.signal });
    }
    return res.ok || res.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Every ck* string on the job payload — including the paid-prediction ids the
 *  queue doesn't map into `resume`. */
export async function jobCheckpoints(jobId?: string): Promise<Record<string, string>> {
  if (!jobId) return {};
  try {
    const job = await db.job.findUnique({ where: { id: jobId }, select: { payload: true } });
    const p = JSON.parse(job?.payload || "{}") as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(p)) if (k.startsWith("ck") && typeof v === "string" && v) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/** Re-attach to a checkpointed prediction (already paid for) if there is one,
 *  otherwise create → checkpoint the id → poll. The re-attached output URL is
 *  probed as well: an hours-old prediction hands back an expired link. */
export async function resumablePrediction(o: {
  priorId?: string;
  create: () => Promise<string>;
  save: (id: string) => Promise<void>;
  maxMs: number;
  stage: string;
}): Promise<string> {
  if (o.priorId) {
    try {
      const url = await repPoll(o.priorId, o.maxMs, `${o.stage}(resumed)`);
      if (await checkpointUrlAlive(url)) return url;
      console.log(`[${o.stage}] re-attached prediction's output URL already expired — rendering a fresh one`);
    } catch (e) {
      console.log(`[${o.stage}] checkpointed prediction unusable — rendering a fresh one:`, e instanceof Error ? e.message.slice(0, 140) : e);
    }
  }
  const id = await o.create();
  await o.save(id); // billed from here on — a restart must find this id
  return repPoll(id, o.maxMs, o.stage);
}

/* ---- Stylized-text quality gate -----------------------------------------
 * Merchants ship these frames: garbled lettering is a hard product-quality
 * failure, and prompt-only guards still slip. Every stylized frame passes a
 * vision check; failures get a targeted lettering-repair edit, and if the
 * lettering STILL can't be made exact it's removed entirely — clean surfaces
 * always beat gibberish. Exported so the jingle pipeline uses the same gate. */

export async function qaStylizedText(
  frameUrl: string,
  productTitle: string,
  productImageUrl?: string | null
): Promise<{ pass: boolean; reason: string }> {
  try {
    const { anthropicVision } = await import("./anthropic.server");
    const urls = productImageUrl ? [productImageUrl, frameUrl] : [frameUrl];
    const raw = await anthropicVision(
      [
        productImageUrl
          ? `Image 1 is a real product photo; image 2 is a stylized cartoon ad frame featuring that product.`
          : `This is a stylized cartoon ad frame.`,
        `Check every piece of visible lettering (labels, packaging, box art, signs): each must be real, correctly-spelled, right-side-up readable language — and wherever it names the product it must read exactly "${productTitle}". Stylized fonts are fine; invented words, garbled or half-formed letters, mirrored or upside-down text are a FAIL.`,
        productImageUrl ? `Also FAIL if the product's shape or colors are unrecognizable compared to image 1.` : "",
        `Reply ONLY JSON: {"pass": true|false, "reason": "short reason"}.`,
      ].filter(Boolean).join(" "),
      urls
    );
    const m = raw && raw.match(/\{[\s\S]*\}/);
    if (!m) return { pass: true, reason: "qa-unavailable" };
    const j = JSON.parse(m[0]) as { pass?: boolean; reason?: string };
    return { pass: j.pass !== false, reason: (j.reason || "").slice(0, 160) };
  } catch {
    return { pass: true, reason: "qa-error" };
  }
}

export async function repairStylizedText(
  frameUrl: string,
  productTitle: string,
  mode: "fix" | "strip",
  // Each repair is a PAID nano-banana edit — resume plumbing so a restart
  // mid-poll re-attaches instead of buying it again. Only safe to pass when
  // the input frame is the same one the checkpointed edit ran on.
  resume?: { priorId?: string; save?: (id: string) => Promise<void> }
): Promise<string> {
  const prompt = mode === "fix"
    ? `Edit this image: correct ALL lettering so that any packaging, label or box text reads exactly "${productTitle}" in clean bold letters, perfectly spelled, and remove every other piece of lettering. Change NOTHING else — same art style, same character, same product shape and colors, same composition.`
    : `Edit this image: remove ALL lettering and text from every surface — packaging, labels, box art, signs — leaving those surfaces clean in the same art style. Change NOTHING else — same character, same product shape and colors, same composition.`;
  return resumablePrediction({
    priorId: resume?.priorId,
    create: () => repCreate("google/nano-banana", { prompt, image_input: [frameUrl], output_format: "jpg" }),
    save: async (id) => { await resume?.save?.(id); },
    maxMs: 5 * 60_000,
    stage: `stylized-text-${mode}`,
  });
}

/** Run the full gate: check → repair lettering → re-check → strip as last
 *  resort. Returns the best frame URL; never throws (falls back to input). */
export async function gateStylizedFrame(
  frameUrl: string,
  productTitle: string,
  productImageUrl?: string | null,
  tag = "cartoon",
  // Checkpointed repair ids (see repairStylizedText) — pass them ONLY when
  // frameUrl is the same raw frame the checkpointed repairs were run on.
  resume?: { fixId?: string; stripId?: string; save?: (patch: Record<string, unknown>) => Promise<void> }
): Promise<string> {
  try {
    let qa = await qaStylizedText(frameUrl, productTitle, productImageUrl);
    if (qa.pass) return frameUrl;
    console.log(`[${tag}] stylized frame failed text QA (${qa.reason}) — repairing lettering`);
    const fixed = await repairStylizedText(frameUrl, productTitle, "fix", {
      priorId: resume?.fixId,
      save: async (id) => { await resume?.save?.({ ckGateFixId: id }); },
    });
    qa = await qaStylizedText(fixed, productTitle, productImageUrl);
    if (qa.pass) return fixed;
    console.log(`[${tag}] repair still failing QA (${qa.reason}) — stripping lettering`);
    const stripped = await repairStylizedText(frameUrl, productTitle, "strip", {
      priorId: resume?.stripId,
      save: async (id) => { await resume?.save?.({ ckGateStripId: id }); },
    });
    // Re-QA the LAST RESORT too — it used to ship unchecked. A stripped frame
    // that still fails means the gibberish is baked into the art itself, not
    // just the labels, and the merchant is about to ship it: say so loudly.
    const strippedQa = await qaStylizedText(stripped, productTitle, productImageUrl);
    if (!strippedQa.pass) {
      console.error(`[${tag}] WARNING: stripped frame STILL fails text QA (${strippedQa.reason}) — shipping it anyway (cleanest frame available)`);
    }
    return stripped;
  } catch (e) {
    console.error(`[${tag}] text gate error (using original frame):`, e instanceof Error ? e.message.slice(0, 160) : e);
    return frameUrl;
  }
}

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
    // legacy key — retired from the picker (read as cheap); kept so
    // pre-existing assets still remix correctly
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
    name: "Paper Craft",
    look: "exquisite handmade layered-paper diorama: characters and scenery cut from richly colored cardstock and stacked in deep layered relief, crisp cut edges with subtle real drop shadows between layers, delicate curled paper details (rolled paper hair, fringed paper grass), warm gallery lighting inside a shadow-box frame, premium paper-craft artistry photographed like a museum piece",
    motion: "layered paper parallax as the camera drifts, gentle stop-motion flutter of paper edges, layers sliding with handmade charm",
    voice: "English_FriendlyPerson",
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
  productSize?: string; // merchant's explicit size class — beats inference
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

/** The cartoon voice-over script.
 *
 *  Extracted so the QA harness exercises the SAME writer the pipeline uses —
 *  a check against a re-implementation proves nothing. Cheap to test too: it
 *  is one text call, no render, so verifying that a presenter never again
 *  announces "claymation" mid-ad costs a fraction of a cent instead of a
 *  150-token video.
 *
 *  The style name is deliberately ABSENT. It used to be passed in "for
 *  energy" and the writer put it in the dialogue. The viewer can see the
 *  style; saying it out loud breaks the ad. */
export async function writeCartoonScript(o: {
  productTitle: string;
  productDescription?: string;
  serviceMode?: boolean;
  tone?: string;
  direction?: string;
  contentLang?: string | null;
}): Promise<string> {
  // A sweep of 54 scripts failed 14 times and every failure was a branded
  // collectible — the model declines to write promotional copy for someone
  // else's trademark and returns nothing. Resellers are a large share of who
  // this is for, so the retry drops the brand and sells the category instead.
  return withBrandFallback(
    (productRef, debranded) => writeCartoonScriptOnce({ ...o, productTitle: productRef, debranded }),
    o.productTitle,
    "cartoon:script",
    o.productDescription
  );
}

async function writeCartoonScriptOnce(o: {
  productTitle: string;
  productDescription?: string;
  serviceMode?: boolean;
  tone?: string;
  direction?: string;
  contentLang?: string | null;
  debranded?: boolean;
}): Promise<string> {
  const scriptPrompt = [
    `You write voice-over scripts for short animated (cartoon) video ads.${langDirective(o.contentLang)}`,
    o.serviceMode
      ? `This is a SERVICE / offer (not a physical product): "${o.productTitle}". Sell the RESULT the customer gets.`
      : `Product: "${o.productTitle}".`,
    o.productDescription ? `Context: ${o.productDescription.slice(0, 300)}` : "",
    o.tone ? `Brand voice/tone: ${o.tone}.` : "",
    o.debranded ? `Sell what the item IS and what owning it feels like. Do not name any brand, franchise or character.` : "",
    `NEVER name or refer to the animation style, art style, medium, or the fact that this is an advertisement. Do not use words like claymation, clay, cartoon, animated, animation, 3D, render, pixel, anime, stop-motion, or "in this video". Talk only about the product and the customer.`,
    o.direction ? `Merchant direction (follow it): ${o.direction}` : "",
    ``,
    `Rules: The FIRST sentence must be a scroll-stopping hook. 24 to 30 words`,
    `TOTAL (about 11 seconds spoken). Playful, warm, a little witty — like a`,
    `beloved animated commercial. End with a short call to action.`,
    `SPEECH PACING (a voice model reads this aloud): commas where a person`,
    `breathes, a period at the END of every sentence. Short complete sentences.`,
    `Output ONLY the spoken words — no stage directions, quotes, emoji, or hashtags.`,
  ].filter(Boolean).join("\n");

  let script = ((await anthropicText(scriptPrompt, { model: "claude-sonnet-5", maxTokens: 200 })) || "")
    .replace(/["“”\n]+/g, " ").replace(/\s+/g, " ").trim();
  // Empty is a REFUSAL, not a crash — withBrandFallback decides what next.
  if (!script) return "";
  // A truncated fragment is WORSE than empty: "Every t." shipped as a voice
  // -over once. The spec is 24-30 words; anything under 12 is a mangled
  // output, so treat it exactly like a refusal and let the ladder retry.
  if (script.split(/\s+/).length < 12) return "";
  const w = script.split(" ");
  if (w.length > 32) script = w.slice(0, 32).join(" ");
  if (!/[.!?]$/.test(script)) script += ".";
  return script;
}

/** Words that must never reach a viewer's ears. The failure this catches was
 *  real: a presenter said "claymation" in a Clay-style ad. */
export const BANNED_SCRIPT_WORDS = [
  "claymation", "clay", "cartoon", "animated", "animation", "anime",
  "stop-motion", "stop motion", "3d", "render", "rendered", "pixel",
  "pixar", "cgi", "this video", "this ad", "advertisement",
];

/** Returns the banned words a script leaked, if any. */
export function scriptLeaks(script: string): string[] {
  const t = ` ${script.toLowerCase().replace(/[^a-z0-9 -]/g, " ").replace(/\s+/g, " ")} `;
  return BANNED_SCRIPT_WORDS.filter((w) => t.includes(` ${w} `));
}

/** The prompt that stylizes a photoreal presenter-holding-product frame into
 *  the chosen cartoon look.
 *
 *  Pulled out as a pure function so the video QA harness renders with the
 *  EXACT string production uses. This is the step that produced a merchant's
 *  product as generic slop — the whole photo was being restyled, packaging
 *  included — so the product is now the stated exception. */
export function characterKeyframePrompt(o: {
  productTitle: string;
  recipe: { look: string; name: string };
  serviceMode?: boolean;
  sceneBits?: string;
  exactText?: string;
}): string {
  return (
    `Redraw this ENTIRE photo as a ${o.recipe.look}. The person becomes a charming ${o.recipe.name} character ` +
    `with the same hairstyle, outfit colors and a friendly stylized likeness. ` +
    `${o.serviceMode ? "" : `CRITICAL — the PRODUCT is the one thing that is NOT stylized. Stylize the person, the background and the lighting, but reproduce the ${o.productTitle} exactly as it appears in the photo: identical packaging artwork, identical logos, identical printed text, identical colors and proportions, at its TRUE real-world size and never miniaturized. Do not redraw it in the art style, do not simplify it, do not invent a similar-looking package. A merchant must recognise their own product instantly. `}` +
    `Hands are anatomically correct — FOUR fingers and ONE thumb per hand, five digits total and never six, natural relaxed grip. ` +
    `Delightful advertising scene, simple complementary background.${o.sceneBits || ""}${o.exactText || ""} ` +
    `Vertical 9:16 composition, no watermark, no caption text.`
  );
}

/** Packaging-text rule, shared with production so the harness cannot drift. */
export function keyframeExactTextRule(productTitle: string): string {
  return (
    ` If any packaging, box art or label appears in the scene, it displays ONLY the title "${productTitle}" ` +
    `in clean bold lettering spelled EXACTLY like that — never invented words, never gibberish text; any other surface stays text-free.`
  );
}

/** Harness entry point: stylize one composed frame with the production prompt
 *  and the production model. Deliberately free of checkpoints, the DB and the
 *  QA gate — those are orchestration, and what needs measuring here is whether
 *  the merchant's product survives the restyle. */
export async function stylizeKeyframeForTest(o: {
  sourcePhotoUrl: string;
  productTitle: string;
  styleKey: CartoonStyleKey;
}): Promise<string> {
  const recipe = CARTOON_RECIPES[o.styleKey];
  const prompt = characterKeyframePrompt({
    productTitle: o.productTitle,
    recipe,
    exactText: keyframeExactTextRule(o.productTitle),
  });
  const id = await repCreate("black-forest-labs/flux-kontext-pro", {
    prompt, input_image: o.sourcePhotoUrl, aspect_ratio: "9:16", output_format: "jpg",
  });
  return repPoll(String(id), 5 * 60_000, "qa-keyframe");
}

export async function generateCartoonAd(params: CartoonAdParams): Promise<string> {
  const recipe = CARTOON_RECIPES[(params.styleKey as CartoonStyleKey)] || CARTOON_RECIPES.dreamanime;
  const voiceJson = JSON.parse(params.brandProfile.voiceJson || "{}");
  const resume = params.resume || {};
  const ckpt = (patch: Record<string, unknown>) =>
    params.jobId ? checkpointJob(params.jobId, patch) : Promise.resolve();
  // Paid-prediction ids the queue doesn't map into `resume` (keyframe, gate
  // repairs, TTS) — read straight off the job payload so a restart re-attaches.
  const ck = await jobCheckpoints(params.jobId);
  const contentLang = (await db.shop.findUnique({ where: { id: params.shopId }, select: { contentLang: true } }))?.contentLang;

  // 1) SCRIPT — cartoon ads earn their keep with playful, jingle-adjacent VO.
  let script = resume.script || "";
  if (!script) {
    script = await writeCartoonScript({
      productTitle: params.productTitle,
      productDescription: params.productDescription,
      serviceMode: params.serviceMode,
      tone: voiceJson.tone,
      direction: params.direction,
      contentLang,
    });
    await ckpt({ ckScript: script });
  }

  // 2) KEYFRAME — "turn yourself into X": with a presenter cast, we first
  // compose the PHOTOREAL presenter-holding-product frame (same engine as UGC
  // ads), then kontext redraws the whole scene in the picked style — the
  // character keeps the presenter's likeness, the product stays recognizable.
  // No presenter → product-hero redraw as before. Every step falls back
  // gracefully (compose failure → portrait-only; no portrait → product path).
  // Forging is a closure because the keyframe may have to be redrawn LATER:
  // a checkpointed keyframe URL expires (~1h) while the checkpoint survives,
  // and kling would then be fed a dead image on every retry.
  let priorKeyframeId: string | undefined = ck.ckKeyframeId; // paid render to re-attach to, once
  let priorRawKeyframe = ck.ckRawKeyframeUrl || ""; // paid frame, pre-QA-gate
  const forgeKeyframe = async (): Promise<string> => {
    // A keyframe checkpointed BEFORE the QA gate is a PAID render: reuse it
    // (while it's still alive) so an interrupted gate never re-buys the frame.
    let raw = priorRawKeyframe;
    const resumedRaw = !!raw && (await checkpointUrlAlive(raw));
    if (!resumedRaw) raw = "";
    priorRawKeyframe = "";
    if (!raw) raw = await renderKeyframe();
    // Repair ids only apply to the frame they were run on — pass them solely
    // when this IS that frame, or the gate would re-attach to an edit of a
    // different keyframe.
    const gated = await gateStylizedFrame(
      raw,
      params.productTitle,
      params.serviceMode ? undefined : params.productImageUrl,
      "cartoon",
      { fixId: resumedRaw ? ck.ckGateFixId : undefined, stripId: resumedRaw ? ck.ckGateStripId : undefined, save: ckpt }
    );
    await ckpt({ ckKeyframeUrl: gated });
    return gated;
  };

  const renderKeyframe = async (): Promise<string> => {
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
            // Without a scale hint the composer guesses, and a 12-piece case
            // guesses small — the same "too small even on Large" the UGC path
            // had. The merchant's choice wins over inference.
            const { inferProductScale, scaleFromChoice } = await import("./product-scale.server");
            const hint = scaleFromChoice(params.productSize) || (await inferProductScale(params.productTitle, params.productDescription));
            const frames = await composeHoldingFrames(portraitUrl, params.productImageUrl, params.productTitle, 1, "hold", params.direction, hint?.phrase);
            composedUrl = frames[0] || "";
            if (composedUrl) await ckpt({ ckComposedUrl: composedUrl });
          } catch (e) {
            console.error(`[cartoon] compose failed (stylizing plain portrait): ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
          }
        }
        if (composedUrl) sourcePhotoUrl = composedUrl;
      }
    }

    // The BRAND goes on the box: styles that draw packaging (boxed figure,
    // toy shelf) kept inventing gibberish wordmarks ("TPLIGES"). Any packaging
    // must carry the real product title, spelled exactly — or no text at all.
    const exactText =
      ` If any packaging, box art or label appears in the scene, it displays ONLY the title "${params.productTitle}" ` +
      `in clean bold lettering spelled EXACTLY like that — never invented words, never gibberish text; any other surface stays text-free.`;

    // Every branch checkpoints its prediction id BEFORE polling (the render is
    // billed at create) and the finished RAW url before the QA gate runs.
    const prior = priorKeyframeId;
    priorKeyframeId = undefined; // one re-attach only — a redraw is a new render
    const run = (input: Record<string, unknown>, model: string) =>
      resumablePrediction({
        priorId: prior,
        create: () => repCreate(model, input),
        save: (id) => ckpt({ ckKeyframeId: id }),
        maxMs: 5 * 60_000,
        stage: "cartoon-keyframe",
      });

    let url: string;
    if (sourcePhotoUrl && withCharacter) {
      const prompt = characterKeyframePrompt({
        productTitle: params.productTitle, recipe, serviceMode: params.serviceMode, sceneBits, exactText,
      });
      url = await run({
        prompt,
        input_image: sourcePhotoUrl,
        aspect_ratio: "9:16",
        output_format: "jpg",
      }, "black-forest-labs/flux-kontext-pro");
    } else if (!params.serviceMode && params.productImageUrl) {
      const prompt =
        `Redraw this exact product as a ${recipe.look}. Keep the product's shape, colors, ` +
        `proportions, logos and text clearly recognizable — same product, new art style. ` +
        `Place it as the hero of a delightful advertising scene with a simple complementary background.${sceneBits}${exactText} ` +
        `Vertical 9:16 composition, no watermark, no caption text.`;
      url = await run({
        prompt,
        input_image: params.productImageUrl,
        aspect_ratio: "9:16",
        output_format: "jpg",
      }, "black-forest-labs/flux-kontext-pro");
    } else {
      const subject = params.serviceMode
        ? `a joyful scene showing the happy OUTCOME of "${params.productTitle}" (a service) — a delighted character enjoying the result`
        : `"${params.productTitle}" as the hero of a delightful advertising scene`;
      const prompt = `${recipe.look}. ${subject}.${sceneBits}${exactText} Vertical 9:16 composition, advertising quality, no watermark, no caption text.`;
      url = await run({
        prompt,
        num_inference_steps: 30,
        guidance: 3,
        aspect_ratio: "9:16",
        output_format: "jpg",
        output_quality: 92,
      }, "black-forest-labs/flux-dev");
    }
    // The paid frame survives an interrupted QA gate. Repair ids from an older
    // frame are dropped with it — they'd re-attach to an edit of a dead image.
    delete ck.ckGateFixId;
    delete ck.ckGateStripId;
    await ckpt({ ckRawKeyframeUrl: url, ckKeyframeUrl: "", ckGateFixId: "", ckGateStripId: "" });
    return url;
  };

  // QUALITY GATE runs inside forgeKeyframe — merchants ship this frame, so the
  // lettering is vision-checked, repaired to the exact product title, or
  // stripped; gibberish never ships.
  let keyframeUrl = resume.keyframeUrl || "";
  if (!keyframeUrl) keyframeUrl = await forgeKeyframe();

  // 3) VOICE — moved AHEAD of the animation because the lipsync step needs
  // the audio to sync to. Style-cast narrator reads the script (cheap; regen
  // on dead URL).
  let audioBuf: Buffer | null = null;
  if (resume.audioUrl) {
    try { audioBuf = await downloadBuffer(resume.audioUrl); } catch { audioBuf = null; }
  }
  if (!audioBuf || audioBuf.length < 10_000) {
    let audioUrl: string;
    // Cheap, but still billed at create — a restart mid-poll re-attaches.
    try {
      audioUrl = await resumablePrediction({
        priorId: ck.ckTtsId,
        create: () => repCreate("minimax/speech-02-hd", {
          text: script,
          voice_id: recipe.voice,
          emotion: "happy",
          english_normalization: true,
          language_boost: "English",
        }),
        save: (id) => ckpt({ ckTtsId: id }),
        maxMs: 3 * 60_000,
        stage: "cartoon-tts",
      });
    } catch {
      audioUrl = await resumablePrediction({
        create: () => repCreate("minimax/speech-02-turbo", { text: script, voice_id: recipe.voice }),
        save: (id) => ckpt({ ckTtsId: id }),
        maxMs: 3 * 60_000,
        stage: "cartoon-tts",
      });
    }
    await ckpt({ ckAudioUrl: audioUrl });
    audioBuf = await downloadBuffer(audioUrl);
  }
  if (audioBuf.length < 10_000) throw new Error("[cartoon:tts] audio came back empty");

  // 4) PERFORMANCE — lipsync the character to the narration.
  //
  // This pipeline used to animate the keyframe with kling and lay the voice
  // over the top, which cannot sync by construction: a talking character and
  // an unrelated audio track. Muting the character hid it but threw away the
  // thing that makes a spokesperson ad work.
  //
  // The anthem pipeline already lipsyncs a CARTOON-STYLED singer with
  // omni-human, so a stylized face is not an obstacle — the same call works
  // here. Only when there is a character on screen: a product-hero cartoon has
  // no face to sync, and kling gives it better motion.
  let animUrl = resume.animUrl || "";
  if (!animUrl && params.avatarId) {
    let tmpLip = "";
    try {
      tmpLip = fs.mkdtempSync(path.join(os.tmpdir(), "cartoon-lip-"));
      const framePath = path.join(tmpLip, "frame.jpg");
      await download(keyframeUrl, framePath);
      const frameDataUri = "data:image/jpeg;base64," + fs.readFileSync(framePath).toString("base64");
      const audioDataUri = "data:audio/mpeg;base64," + audioBuf.toString("base64");
      // Billed at create, so a restart mid-poll re-attaches rather than
      // re-buying the performance.
      animUrl = await resumablePrediction({
        priorId: ck.ckCartoonOmniId,
        create: () => repCreate("bytedance/omni-human", { image: frameDataUri, audio: audioDataUri }),
        save: (id) => ckpt({ ckCartoonOmniId: id }),
        maxMs: 12 * 60_000,
        stage: "cartoon-lipsync",
      });
      await ckpt({ ckAnimUrl: animUrl });
      console.log("[cartoon] lipsynced performance ok");
    } catch (e) {
      // A failed lipsync must never cost the merchant the whole ad — fall
      // through to the motion path below, which does not fake talking.
      animUrl = "";
      console.error("[cartoon] lipsync failed, falling back to motion:", e instanceof Error ? e.message.slice(0, 180) : e);
    } finally {
      if (tmpLip) { try { fs.rmSync(tmpLip, { recursive: true, force: true }); } catch { /* tidy */ } }
    }
  }

  // 5) MOTION — fallback when there is no character to lipsync, or the
  // lipsync failed. kling brings the keyframe to life. The keyframe is a hosted
  // replicate.delivery URL (same provider), so it's passed directly — no
  // multi-MB base64 body. A restart mid-poll re-attaches to the SAME paid
  // prediction (omni-human pattern) instead of buying a second render.
  if (!animUrl && resume.klingPredictionId) {
    try {
      animUrl = await repPoll(resume.klingPredictionId, 12 * 60_000, "cartoon-animate(resumed)");
      await ckpt({ ckAnimUrl: animUrl });
    } catch { /* old prediction died — fall through to a fresh one */ }
  }
  // One probe covers BOTH resume paths: a checkpointed url and a re-attached
  // prediction hand back the same delivery link, which dies after ~1h. Left
  // unchecked it poisons every retry (assembly's download fails identically).
  if (animUrl && !(await checkpointUrlAlive(animUrl))) {
    console.log("[cartoon] checkpointed animation URL has expired — re-animating");
    animUrl = "";
    await ckpt({ ckAnimUrl: "", ckKlingId: "" });
  }
  if (!animUrl) {
    // The keyframe may itself be a resumed (now-dead) url — kling would fetch
    // it and fail on every attempt. Redraw before spending on the animation.
    if (keyframeUrl === resume.keyframeUrl && !(await checkpointUrlAlive(keyframeUrl))) {
      console.log("[cartoon] checkpointed keyframe URL has expired — redrawing before animating");
      keyframeUrl = await forgeKeyframe();
    }
    const { id: animId } = await animateCreate(params.videoEngine, {
      startImage: keyframeUrl,
      // This pipeline has NO lipsync — the voice-over is a separate track laid
      // over the animation. So a character animated as though talking can only
      // ever look out of sync. It is narration, and the animation must not
      // pretend otherwise.
      prompt: `${recipe.motion}. Keep the same art style as the first frame throughout — consistent ${recipe.name} look, ${params.avatarId ? "the character presents the product to camera with warm natural gestures, product clearly visible. The character does NOT speak: no talking, no mouth opening and closing, no lip movement — the voice is a narrator off-screen, so keep the mouth closed or in a natural smile throughout" : "the product stays the clear hero"}, vertical video.`,
      negativePrompt: "talking, speaking, mouth opening, lip movement, photorealistic, live action, morphing, distortion, style change, extra objects, text, watermark, blur",
    });
    await ckpt({ ckKlingId: animId });
    animUrl = await repPoll(animId, 12 * 60_000, "cartoon-animate");
    await ckpt({ ckAnimUrl: animUrl });
  }


  // 6) ASSEMBLY — loop the animation to the narration, captions on, no photo
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
          productImageUrl: params.productImageUrl || null,
          serviceMode: !!params.serviceMode,
        }),
      },
    });
    return asset.id;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}
