/* WHICH ENGINE ANIMATES A STILL, ON WHICH HOST, IN WHAT ORDER — AND WHAT REPLICATE IS ASKED.
 *
 * The pure half of animateCreate (ugc-ad-pipeline.server.ts). It lived inside that file, which talks to the
 * database, so no test could load it — and that is how a Seedance 2.5 pick that rendered on Seedance 2.5 got
 * its +75 refunded (engine-delivery.ts did not know the model's name). tests/animate-engines.test.ts walks
 * every engine key through these tables now.
 *
 * A ROUTE is the rungs animateCreate tries, in order, until one ACCEPTS the job:
 *   1. the engine's own model, on each host it lives on;
 *   2. DEFAULT_ANIMATE_MODEL on Replicate — the last resort every route ends on.
 * Any rung before the last IS the engine the member picked (engine-delivery.ts maps it back to that key, so
 * nothing is refunded). The last rung, for a premium pick, is the documented downgrade, and is refunded.
 *
 * The routes (fal rungs only when FAL_KEY is set):
 *   Auto / kling / kling3   fal Kling 3 Pro                       → Replicate default
 *   kling3s (sound)         fal Kling O3 standard → fal Kling 3 Pro → Replicate default
 *   kling26                 fal Kling 2.6 Pro → Replicate kwaivgi/kling-v2.6 → Replicate default
 *   kling25fal              fal Kling 2.5 Turbo Pro               → Replicate default (the same model)
 *   veo31                   fal Veo 3.1 Fast                      → Replicate default (a downgrade, refunded)
 *   veo                     Replicate google/veo-3.1-fast         → Replicate default
 *   seedance                Replicate bytedance/seedance-2.5 → fal Seedance 2.5 → Replicate seedance-1-pro
 *                                                                 → Replicate default
 *   hailuo                  Replicate minimax/hailuo-02           → Replicate default
 *   kling25                 Replicate default (video-generation's "retry somewhere else")
 *
 * SEEDANCE 2.5 GOES TO REPLICATE FIRST (2026-11-24): the same model costs about half there — Replicate,
 * replicate.com/bytedance/seedance-2.5: $0.2312 a second of 720p output with no video input; fal,
 * fal.ai/models/bytedance/seedance-2.5/image-to-video: about $0.473 a second at 720p. Both pages read
 * 2026-11-24. fal stays the second rung, so a Replicate refusal still renders Seedance 2.5.
 *
 * DEAD REPLICATE SLUGS REPLACED (each model's page AND its llms.txt answered 404 on 2026-11-24):
 *   kwaivgi/kling-v2.6-pro → kwaivgi/kling-v2.6 ("Kling 2.6 Pro" on its page);
 *   google/veo-3-fast      → google/veo-3.1-fast;
 *   kwaivgi/kling-v2.1-master and kwaivgi/kling-v1.6-standard — their keys ("kling21", "kling16") were in
 *   no menu (video-engines.ts), passed by no caller, and refused by normalizeEngineKey, so nothing could
 *   reach them: deleted. The talking ad's last-resort motion used kling-v1.6-standard by name — see
 *   VOICEOVER_MOTION_MODEL.
 *
 * Explicit .ts import: the test runner strips types itself and does not resolve extensionless specifiers. */

import { klingTwoSeconds, seedanceSeconds } from "./fal-video-body.ts";

/* RUN THE NEWEST (2026-10-12): the default is Kling 3 Pro on fal, with the best Replicate engine as the
 * fallback, so no key, no fal or a fal refusal still renders (and the engine surcharge reconciles). Kling 3's
 * request is NOT Kling 2.x's: its seed is `start_image_url`, it takes any whole second from 3 to 15 and it
 * makes sound unless told not to — fal-video-body.ts builds it. fal's price page (read 2026-11-24): $0.112 a
 * second silent, $0.168 with sound. Validate quality/COGS with a live test gen; revert the default to v2.6 if
 * v3's cost breaks the margin floor. */
export const DEFAULT_FAL_ANIMATE_MODEL = "fal-ai/kling-video/v3/pro/image-to-video";
/** The last resort of every route: Kling 2.5 Turbo Pro on Replicate, $0.07 a second, silent (its page, read
 *  2026-11-24; `generate_audio` is "kept for backwards compatibility … not used"). */
export const DEFAULT_ANIMATE_MODEL = "kwaivgi/kling-v2.5-turbo-pro";
/** See falAnimateModelFor. */
export const SOUND_ENGINE_KEY = "kling3s";
export const SOUND_FAL_ANIMATE_MODEL = "fal-ai/kling-video/o3/standard/image-to-video";

/** The talking ad's LAST RESORT (ugc-ad-pipeline.server.ts, acquireTalking): when HeyGen and omni-human both
 *  fail, the presenter is animated talking to camera with no lip-sync and the voice is laid over it. That
 *  rung asked for kwaivgi/kling-v1.6-standard, which is gone from Replicate (404, 2026-11-24; it had already
 *  answered this account 422 "not permitted" on 2026-10-27) — so the last resort itself failed and the job
 *  was refunded. Kling 1.6 standard was $0.05 a second (its page as archived 2026-07-15). No Kling on
 *  Replicate is that cheap today (2.5 Turbo Pro and 2.6 are $0.07), so this is Seedance 1 Lite: $0.036 a
 *  second at 720p (replicate.com/bytedance/seedance-1-lite, read 2026-11-24) — ten seconds $0.36 where Kling
 *  1.6 was $0.50 — and the one Replicate image-to-video model this account proved stable on 2026-10-27.
 *  Its schema is the nearest a cheaper model has: `image`, `prompt`, an integer `duration` (10 is in range),
 *  `resolution`. It has NO negative_prompt; the motion prompt already says the product stays still. */
export const VOICEOVER_MOTION_MODEL = "bytedance/seedance-1-lite";
export function voiceoverMotionInput(image: string, prompt: string): Record<string, unknown> {
  return { image, prompt, duration: 10, resolution: "720p" };
}

/** fal-hosted engines, keyed the same way as the Replicate ones. */
export function falAnimateModelFor(engineKey: string | undefined): string | null {
  switch (engineKey) {
    case undefined: case "": case "kling": case "kling3": return DEFAULT_FAL_ANIMATE_MODEL; // Kling 3 Pro (newest)
    case "kling26": return "fal-ai/kling-video/v2.6/pro/image-to-video"; // previous gen
    case "kling25fal": return "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";
    // Kling 3 Omni, standard: the engine of a video that KEEPS ITS OWN SOUND (a Creator video). It is
    // the cheapest Kling that makes sound ($0.112 a second with it — fal's page, 2026-11-23), it renders
    // at the 720p we ship, and it is the model the owner picked by ear for films. Not on the engine
    // menu (video-engines.ts): the server chooses it, a member never has to.
    case SOUND_ENGINE_KEY: return SOUND_FAL_ANIMATE_MODEL;
    case "veo31": return "fal-ai/veo3.1/fast/image-to-video";
    // Seedance 2.5 on fal is this engine's SECOND host — Replicate's copy is tried first
    // (replicateFirstModelFor) because it costs half as much.
    case "seedance": return "bytedance/seedance-2.5/image-to-video";
    default: return null; // an explicitly-named Replicate engine
  }
}

/** An engine whose Replicate copy is tried BEFORE its fal copy (cheaper there, the same model). */
export function replicateFirstModelFor(engineKey: string | undefined): string | null {
  return engineKey === "seedance" ? "bytedance/seedance-2.5" : null;
}

/** The engine's model on Replicate — after its fal copy when it has one. DEFAULT_ANIMATE_MODEL means the
 *  engine has no Replicate copy of its own. */
export function animateModelFor(engineKey: string | undefined): string {
  switch (engineKey) {
    case "veo": return "google/veo-3.1-fast";
    case "kling26": return "kwaivgi/kling-v2.6";
    // after Seedance 2.5 on both hosts: the older Seedance, still the engine the member picked
    // (engine-delivery.ts keeps its surcharge)
    case "seedance": return "bytedance/seedance-1-pro";
    case "hailuo": return "minimax/hailuo-02";
    case "kling":
    default: return DEFAULT_ANIMATE_MODEL;
  }
}

export type AnimateRung = { host: "fal" | "replicate"; model: string };

/** The rungs animateCreate tries, in order. Always ends on DEFAULT_ANIMATE_MODEL on Replicate. */
export function animateRoute(engineKey: string | undefined, falOn: boolean): AnimateRung[] {
  const rungs: AnimateRung[] = [];
  const add = (host: AnimateRung["host"], model: string | null) => {
    if (model && !rungs.some((r) => r.host === host && r.model === model)) rungs.push({ host, model });
  };
  add("replicate", replicateFirstModelFor(engineKey));
  const fal = falAnimateModelFor(engineKey);
  if (fal && falOn) {
    add("fal", fal);
    // A video sold with sound gets a second engine that makes sound before it is handed to the silent
    // Replicate default: Kling 3 Pro, the same family.
    if (engineKey === SOUND_ENGINE_KEY) add("fal", DEFAULT_FAL_ANIMATE_MODEL);
  }
  add("replicate", animateModelFor(engineKey));
  add("replicate", DEFAULT_ANIMATE_MODEL);
  return rungs;
}

export type AnimateOpts = { startImage: string; prompt: string; negativePrompt?: string; durationSec?: number; generateAudio?: boolean; aspect?: string };

/** What a Replicate engine is asked. Each body is that model's input schema as Replicate published it
 *  (the model page's schema and its llms.txt, read 2026-11-24). Sound follows the rule of fal-video-body.ts:
 *  sent to every engine that makes it, true only when the caller ships the clip's own sound. */
export function animateInputFor(model: string, opts: AnimateOpts): Record<string, unknown> {
  const neg = opts.negativePrompt || "object disappearing, product vanishing, flickering, fading in and out, morphing, distortion, extra objects, text, watermark, blur";
  // VEO 3.1 FAST: image, aspect_ratio "16:9" | "9:16" (its default is 16:9 — a landscape clip cover-cropped
  // into our vertical frame loses two thirds of it), duration 4 | 6 | 8 (left to its 8), negative_prompt,
  // generate_audio — DEFAULT TRUE, $0.15 a second with sound against $0.10 silent.
  if (model === "google/veo-3.1-fast") return { prompt: opts.prompt, image: opts.startImage, aspect_ratio: opts.aspect === "16:9" ? "16:9" : "9:16", generate_audio: opts.generateAudio === true, negative_prompt: neg };
  // SEEDANCE 2.5: image, an integer duration (4–30), resolution "480p" | "720p", generate_audio (DEFAULT TRUE;
  // the price is the same either way), and aspect_ratio — whose default is 16:9. fal's copy is "always auto
  // for image-to-video": the clip takes the seed's shape. "adaptive" is Replicate's word for the same ("the
  // model picks the ratio that fits your inputs"), so a clip is the shape it is on fal. No negative_prompt.
  if (model === "bytedance/seedance-2.5") return { prompt: opts.prompt, image: opts.startImage, duration: seedanceSeconds(opts.durationSec), resolution: "720p", aspect_ratio: "adaptive", generate_audio: opts.generateAudio === true };
  // SEEDANCE 1 PRO and HAILUO 2 take neither a negative_prompt nor an audio flag — do not add them.
  if (model === "bytedance/seedance-1-pro") return { prompt: opts.prompt, image: opts.startImage, duration: 10, resolution: "720p" };
  // HAILUO 2: "10 seconds is only available for 768p resolution" (its llms.txt, read 2026-11-24), and its default
  // resolution is 1080p — so ten seconds with no resolution named was a request it cannot make: refused, the
  // Replicate default rendered instead and the +25 refunded, every time. The owner's choice (2026-11-24):
  // "768p" — the full ten seconds, at 768p.
  if (model === "minimax/hailuo-02") return { prompt: opts.prompt, first_frame_image: opts.startImage, duration: 10, resolution: "768p" };
  // KLING 2.6 (its page calls it "Kling 2.6 Pro"): start_image, negative_prompt, duration 5 | 10, and
  // generate_audio — DEFAULT TRUE, $0.14 a second with sound against $0.07 silent.
  if (model === "kwaivgi/kling-v2.6") return { start_image: opts.startImage, prompt: opts.prompt, negative_prompt: neg, duration: klingTwoSeconds(opts.durationSec), generate_audio: opts.generateAudio === true };
  // KLING 2.5 TURBO PRO (the default): start_image, negative_prompt, duration 5 | 10. A length only Kling 3
  // makes (15 s, or anything between) lands on the nearer of the two rather than being refused.
  return { start_image: opts.startImage, prompt: opts.prompt, negative_prompt: neg, duration: klingTwoSeconds(opts.durationSec) };
}
