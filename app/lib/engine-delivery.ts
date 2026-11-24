/* Which engine actually rendered, and what the merchant is owed if it wasn't
 * the one they paid for.
 *
 * The engine picker charges a surcharge up front: Veo 3.1 and Veo 3 are +75
 * tokens, Hailuo and Seedance +25. Three separate paths can then quietly
 * deliver a different engine:
 *
 *   1. veo31 and kling25fal are fal-only. With no FAL_KEY, or on a fal
 *      reject, animateCreate falls through to the Replicate default (its
 *      route, animate-engines.ts, has no Replicate copy of Veo 3.1 for veo31).
 *      A merchant paid 75 tokens for Veo 3.1 and got Kling 2.5, which carries
 *      no surcharge.
 *   2. A premium engine that rejects at CREATE time falls back to the default.
 *   3. A premium engine that accepts and then fails at INFERENCE is retried on
 *      the default.
 *
 * animateCreate already returns the model that actually ran "for honest asset
 * metadata" — the metadata was honest and the wallet was not. This maps that
 * model back to its engine so the difference can be returned.
 */

import { engineSurcharge } from "./video-engines.ts";

/** Every model string either provider can return, mapped to its picker key.
 *
 *  EVERY model on an engine's route (animate-engines.ts) must be here, mapped back to that engine —
 *  tests/animate-engines.test.ts walks every key and fails on one that is not. Seedance 2.5 on fal was
 *  missing until 2026-11-24, so a member who picked Seedance (+75) and GOT Seedance 2.5 was refunded the
 *  75 as if it had been the free default. */
const MODEL_TO_ENGINE: Record<string, string> = {
  // fal
  "fal-ai/kling-video/v3/pro/image-to-video": "kling", // Kling 3 Pro — "Auto" and "Kling 3 Pro" are this one engine
  "fal-ai/kling-video/o3/standard/image-to-video": "kling3s", // the server's sound engine (no surcharge)
  "fal-ai/kling-video/v2.6/pro/image-to-video": "kling26",
  "fal-ai/kling-video/v2.5-turbo/pro/image-to-video": "kling25fal",
  "fal-ai/veo3.1/fast/image-to-video": "veo31",
  // replicate
  "kwaivgi/kling-v2.5-turbo-pro": "kling", // DEFAULT_ANIMATE_MODEL
  "kwaivgi/kling-v2.6": "kling26",
  "google/veo-3.1-fast": "veo",
  // these carry a surcharge of their own — mapping them to a free engine would
  // refund a merchant who actually got what they paid for
  "bytedance/seedance-2.5": "seedance",
  "bytedance/seedance-2.5/image-to-video": "seedance", // the same model on fal
  "bytedance/seedance-1-pro": "seedance",
  "minimax/hailuo-02": "hailuo",
  // RETIRED from Replicate (their pages answered 404 on 2026-11-24) and called by nothing now. Kept so a
  // record written while they still ran reads the way it did then.
  "google/veo-3-fast": "veo",
  "kwaivgi/kling-v2.6-pro": "kling26",
  "kwaivgi/kling-v2.1-master": "kling",
  "kwaivgi/kling-v1.6-standard": "kling",
};

/**
 * The picker key for a model string. Unknown models resolve to "auto", whose
 * surcharge is 0 — deliberately conservative: an unrecognised model is treated
 * as NOT having delivered a premium engine, so the merchant is refunded rather
 * than charged for something we cannot identify.
 */
export function engineKeyForModel(model: string | null | undefined): string {
  if (!model) return "auto";
  return MODEL_TO_ENGINE[model] || "auto";
}

/**
 * Tokens owed back when the delivered engine is cheaper than the one paid for.
 * Never negative — delivering something *better* than was paid for is a gift,
 * not an invoice.
 */
export function surchargeShortfall(requestedKey: string | null | undefined, deliveredModel: string | null | undefined): number {
  const paid = engineSurcharge(requestedKey);
  const got = engineSurcharge(engineKeyForModel(deliveredModel));
  return Math.max(0, paid - got);
}

/** A line for the asset/job log, so a downgrade is visible and not just felt. */
export function downgradeNote(requestedKey: string | null | undefined, deliveredModel: string | null | undefined): string {
  const owed = surchargeShortfall(requestedKey, deliveredModel);
  if (!owed) return "";
  return `engine downgrade: paid for "${requestedKey}", rendered on "${deliveredModel}" — ${owed} tokens returned`;
}
