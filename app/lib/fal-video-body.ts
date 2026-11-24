/* WHAT WE ASK A fal IMAGE-TO-VIDEO ENGINE FOR — one pure function, so it can be read and tested.
 *
 * It used to be built inline in falVideoSubmit, where nothing checked it, and it cost real money:
 *
 *   The Kling 3 branch was written on 2026-11-06 for the film engine's DIALOGUE shots — sound on, ten
 *   seconds unless told otherwise. But Kling 3 Pro had been the DEFAULT motion engine since 10-13, and
 *   the callers that take the default pass no word about sound and, some of them, no length. So from
 *   that day every DEFAULT-engine clip was rendered WITH generated sound, and at ten seconds where no
 *   length was given: a cartoon ad's motion and an anthem's (ten seconds, sound), every scene of a kids'
 *   or sung film (five seconds, sound). Those pipelines lay their own voice and music over the picture
 *   — the clip's sound was thrown away. fal's own price page (read 2026-11-23): Kling 3 Pro is $0.112 a
 *   second silent and $0.168 with sound. A cartoon or anthem clip meant to cost 5 × $0.112 = $0.56 cost
 *   10 × $0.168 = $1.68; a film scene $0.84 instead of $0.56.
 *   (The Commercial was not on that branch: it is pinned to Kling 2.6 Pro — commercial-ad-pipeline.server.ts,
 *   motionEngine. But Kling 2.6 Pro DOES make sound, and makes it unless told not to: fal's schema for
 *   fal-ai/kling-video/v2.6/pro/image-to-video, read 2026-11-24, has `generate_audio` defaulting to TRUE,
 *   and fal's price page the same day says $0.07 a second silent, $0.14 with sound. Until 2026-11-24 this
 *   file sent it the Kling 2.5 body — `image_url` where its schema REQUIRES `start_image_url`, and no
 *   `generate_audio` — so every Commercial beat was either refused by fal and rendered on another host, or
 *   accepted and billed sound the Commercial lays its own voice and music over. Which of the two it was
 *   cannot be told without a paid call; the body below is what its schema asks for either way.)
 *
 *   The Kling 3 branch also left out `negative_prompt`, which Kling 3 takes: "no talking mouth" for a narrated
 *   cartoon, "nobody vanishes" for a kids' scene, "the product does not morph" never reached the model.
 *
 * The rules now, the same for every engine:
 *   - LENGTH is what the caller asked for, else the engine's own five seconds — never a silent ten. An
 *     engine that makes only some lengths gets the nearest one it makes (klingTwoSeconds, seedanceSeconds).
 *   - SOUND is asked for, never assumed: `generateAudio: true` and nothing else turns it on. A pipeline
 *     asks exactly when it ships the clip's own sound (a Creator video, a product video, a film's
 *     dialogue shot). One that lays its own track over the clip does not pay for sound it will discard.
 *     Every engine that CAN make sound (Kling 2.6, Kling 3, the O3 models, Veo, Seedance 2.5) is sent the
 *     flag every time: in fal's schemas (read 2026-11-24) all but the O3 models make sound when it is left out.
 *   - A NEGATIVE prompt goes to the Kling 2.x and Kling 3 engines (not the Omni "O3" models and not
 *     Seedance, whose schemas have no such field). Veo's schema DOES have one (fal, read 2026-11-24) and
 *     it has never been sent one — sending it would change what a premium engine draws, so that waits for
 *     a render somebody has looked at.
 */

export type FalVideoOpts = {
  startImage: string; prompt: string; negativePrompt?: string; durationSec?: number; generateAudio?: boolean;
  /** The frame the caller wants — "16:9" for a wide clip, anything else is vertical. Veo reads it, and so
   *  does the Omni reference endpoint; the other Kling and Seedance engines take no shape of their own and
   *  follow the seed image. */
  aspect?: string;
  /** Pictures the clip must ARRIVE at or keep to, named in the prompt as @Image1, @Image2… — read only by
   *  the Omni "reference-to-video" endpoint (a found-footage take starts off its subject and is told to
   *  find the scene "exactly as in @Image1": take.server.ts). */
  referenceImages?: string[];
};

/** What every motion clip is told NOT to do when its caller names nothing more specific. */
export const DEFAULT_NEGATIVE_PROMPT =
  "object disappearing, product vanishing, flickering, morphing, distortion, extra fingers, deformed hands, text, watermark";

/** Kling 3 / O3 take any whole second from 3 to 15, as a string. */
export function klingThreeSeconds(sec: number | undefined): number {
  const n = Math.round(Number(sec));
  return Number.isFinite(n) && n > 0 ? Math.max(3, Math.min(15, n)) : 5;
}

/** Kling 2.x (2.5 Turbo, 2.6) makes five seconds or ten and nothing else — `duration` "5" | "10" in fal's
 *  schemas and 5 | 10 in Replicate's (both read 2026-11-24). A caller asking for any other length gets the
 *  nearer of the two: up to seven seconds is five, anything longer is ten — so a fifteen-second Creator
 *  video picked on Kling 2.6 comes back ten seconds long, and a three-second ask comes back five. (It used
 *  to be sent as asked, which fal refuses for anything but 5 and 10.) Replicate's copies of these engines
 *  have always rounded this way (animate-engines.ts). */
export function klingTwoSeconds(sec: number | undefined): 5 | 10 {
  const n = Number(sec);
  return Number.isFinite(n) && n > 7 ? 10 : 5;
}

/** Seedance 2.5 makes any whole second from 4 to 30 (fal: "4"…"30"; Replicate: an integer, "from 4 to 30
 *  seconds" in its readme — both read 2026-11-24); nothing said is its five. */
export function seedanceSeconds(sec: number | undefined): number {
  const n = Math.round(Number(sec));
  return Number.isFinite(n) && n > 0 ? Math.max(4, Math.min(30, n)) : 5;
}

/** Does this model make its own sound when asked? (Kling 2.6, Kling 3, Kling O3, Veo, Seedance 2.5.) */
export function modelMakesSound(model: string): boolean {
  return /kling-video\/(?:v3|o3|v2\.6)\//.test(model) || /veo/.test(model) || /seedance-2\.5/.test(model);
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
    if (omni && /\/reference-to-video$/.test(model)) {
      // THE OMNI REFERENCE ENDPOINT (fal's schema, read 2026-11-24): the first frame is `start_image_url`
      // (not `image_url`), the reference pictures are `image_urls` (at most four), and — having no single
      // seed to take its shape from — it is told the frame.
      const refs = (opts.referenceImages || []).filter(Boolean).slice(0, 4);
      return {
        prompt: opts.prompt,
        start_image_url: opts.startImage,
        ...(refs.length ? { image_urls: refs } : {}),
        duration: String(klingThreeSeconds(opts.durationSec)),
        generate_audio: opts.generateAudio === true,
        aspect_ratio: opts.aspect === "16:9" ? "16:9" : "9:16",
      };
    }
    return {
      prompt: opts.prompt,
      ...(omni ? { image_url: opts.startImage } : { start_image_url: opts.startImage }),
      duration: String(klingThreeSeconds(opts.durationSec)),
      generate_audio: opts.generateAudio === true,
      ...(omni ? {} : { negative_prompt: opts.negativePrompt || DEFAULT_NEGATIVE_PROMPT }),
    };
  }
  if (/seedance-2\.5/.test(model)) {
    // SEEDANCE 2.5 (bytedance/seedance-2.5/image-to-video; fal's schema, read 2026-11-24): image_url,
    // duration "4"…"30", resolution (720p keeps COGS sane), and generate_audio — which DEFAULTS TO TRUE, so
    // leaving it out (as this did) asked for sound on every clip. fal bills the same with or without it, so
    // that cost nothing; it is sent now so a clip has sound only when its pipeline ships the sound, as on
    // every other engine. No negative_prompt in its schema, and its aspect_ratio is always "auto" for
    // image-to-video (the clip takes the seed's shape), so neither is sent.
    return { prompt: opts.prompt, image_url: opts.startImage, resolution: "720p", duration: String(seedanceSeconds(opts.durationSec)), generate_audio: opts.generateAudio === true };
  }
  if (/seedance/.test(model)) {
    // SEEDANCE 1 PRO FAST (story-motion.ts; fal's schema, read 2026-11-24): image_url, duration "2"…"12",
    // resolution (its default is 1080p — 720p is asked for by name), no sound, no negative_prompt, and an
    // "auto" aspect that follows the seed. Its one caller asks a whole second from 2 to 12 (motionSeconds).
    return { prompt: opts.prompt, image_url: opts.startImage, resolution: "720p", duration: String(opts.durationSec ?? 5) };
  }
  if (/kling-video\/v2\.6\//.test(model)) {
    // KLING 2.6 PRO (fal's schema, read 2026-11-24): required ["prompt", "start_image_url"] — its seed is
    // `start_image_url`, not the `image_url` of Kling 2.5 below — duration "5" | "10", negative_prompt, and
    // generate_audio, which DEFAULTS TO TRUE: $0.14 a second with sound against $0.07 silent (fal's price
    // page, the same day). So the flag is always sent, true only when asked.
    return {
      prompt: opts.prompt,
      start_image_url: opts.startImage,
      duration: String(klingTwoSeconds(opts.durationSec)),
      generate_audio: opts.generateAudio === true,
      negative_prompt: opts.negativePrompt || DEFAULT_NEGATIVE_PROMPT,
    };
  }
  // KLING 2.5 TURBO PRO (fal's schema, read 2026-11-24): required ["prompt", "image_url"], duration "5" | "10",
  // negative_prompt; it makes no sound and has no flag for it.
  return {
    prompt: opts.prompt,
    image_url: opts.startImage,
    duration: String(klingTwoSeconds(opts.durationSec)),
    negative_prompt: opts.negativePrompt || DEFAULT_NEGATIVE_PROMPT,
  };
}
