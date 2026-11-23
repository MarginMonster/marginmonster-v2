/* WHAT WE ASK A fal IMAGE-TO-VIDEO ENGINE FOR — one pure function, so it can be read and tested.
 *
 * It used to be built inline in falVideoSubmit, where nothing checked it, and it cost real money:
 *
 *   The Kling 3 branch was written on 2026-11-06 for the film engine's DIALOGUE shots — sound on, ten
 *   seconds unless told otherwise. But Kling 3 Pro had been the DEFAULT motion engine of every ad
 *   pipeline since 10-13, and those callers pass neither a length nor a word about sound. So from that
 *   day every default-engine clip was rendered at ten seconds WITH generated sound: a cartoon ad's
 *   motion, an anthem's, each of a commercial's five beats, every scene of a kids' film. Those pipelines
 *   use five seconds and lay their own voice and music over the top — the clip's sound was thrown away.
 *   fal's own price page (read 2026-11-23): Kling 3 Pro is $0.112 a second silent and $0.168 with sound.
 *   A clip meant to cost 5 × $0.112 = $0.56 cost 10 × $0.168 = $1.68; a five-beat commercial $8.40
 *   instead of $2.80 — more than its 150 tokens bring in.
 *
 *   The same branch left out `negative_prompt`, which Kling 3 takes: "no talking mouth" for a narrated
 *   cartoon, "nobody vanishes" for a kids' scene, "the product does not morph" never reached the model.
 *
 * The rules now, the same for every engine:
 *   - LENGTH is what the caller asked for, else the engine's own five seconds — never a silent ten.
 *   - SOUND is asked for, never assumed: `generateAudio: true` and nothing else turns it on. A pipeline
 *     asks exactly when it ships the clip's own sound (a Creator video, a product video, a film's
 *     dialogue shot). One that lays its own track over the clip does not pay for sound it will discard.
 *   - A NEGATIVE prompt goes to every engine whose schema has the field (Kling 2.x and Kling 3; not the
 *     Omni "O3" models, not Seedance, not Veo).
 */

export type FalVideoOpts = {
  startImage: string; prompt: string; negativePrompt?: string; durationSec?: number; generateAudio?: boolean;
  /** The frame the caller wants — "16:9" for a wide clip, anything else is vertical. Only Veo reads it:
   *  the Kling and Seedance engines take no shape of their own and follow the seed image. */
  aspect?: string;
};

/** What every motion clip is told NOT to do when its caller names nothing more specific. */
export const DEFAULT_NEGATIVE_PROMPT =
  "object disappearing, product vanishing, flickering, morphing, distortion, extra fingers, deformed hands, text, watermark";

/** Kling 3 / O3 take any whole second from 3 to 15, as a string. */
export function klingThreeSeconds(sec: number | undefined): number {
  const n = Math.round(Number(sec));
  return Number.isFinite(n) && n > 0 ? Math.max(3, Math.min(15, n)) : 5;
}

/** Does this model make its own sound when asked? (Kling 3, Kling O3, Veo.) */
export function modelMakesSound(model: string): boolean {
  return /kling-video\/(?:v3|o3)\//.test(model) || /veo/.test(model);
}

export function falVideoBody(model: string, opts: FalVideoOpts): Record<string, unknown> {
  if (/veo/.test(model)) {
    // Veo makes sound UNLESS TOLD NOT TO (fal's page, 2026-11-23: generate_audio defaults to true, $0.15 a
    // second against $0.10 silent). The flag used to be left out for callers that did not ask — which is
    // asking for sound and paying for it. It is always sent now, true only when asked.
    // The frame: Veo takes "16:9" or "9:16" (and crops any other seed to fit). It was always told 9:16, so a
    // WIDE Creator video picked on Ultra came back vertical, failed the shape check and was refunded in full.
    return { prompt: opts.prompt, image_url: opts.startImage, aspect_ratio: opts.aspect === "16:9" ? "16:9" : "9:16", generate_audio: opts.generateAudio === true };
  }
  if (/kling-video\/(?:v3|o3)/.test(model)) {
    // Kling 3.0 / O3. V3's seed frame is `start_image_url`; O3 uses `image_url`. Both take a string
    // `duration` (3–15) and `generate_audio`. No aspect flag — the output follows the seed image's shape.
    const omni = /\/o3\//.test(model);
    return {
      prompt: opts.prompt,
      ...(omni ? { image_url: opts.startImage } : { start_image_url: opts.startImage }),
      duration: String(klingThreeSeconds(opts.durationSec)),
      generate_audio: opts.generateAudio === true,
      ...(omni ? {} : { negative_prompt: opts.negativePrompt || DEFAULT_NEGATIVE_PROMPT }),
    };
  }
  if (/seedance/.test(model)) {
    // Seedance 2.5's schema is prompt + image_url + resolution + duration — it takes NEITHER a
    // negative_prompt NOR an aspect flag (sending them 422s). 720p keeps COGS sane.
    return { prompt: opts.prompt, image_url: opts.startImage, resolution: "720p", duration: String(opts.durationSec ?? 5) };
  }
  return {
    prompt: opts.prompt,
    image_url: opts.startImage,
    duration: String(opts.durationSec ?? 5),
    negative_prompt: opts.negativePrompt || DEFAULT_NEGATIVE_PROMPT,
  };
}
