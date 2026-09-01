/* Which engine actually rendered, and what the merchant is owed if it wasn't
 * the one they paid for.
 *
 * The engine picker charges a surcharge up front: Veo 3.1 and Veo 3 are +75
 * tokens, Hailuo and Seedance +25. Three separate paths can then quietly
 * deliver a different engine:
 *
 *   1. veo31 and kling25fal are fal-only. With no FAL_KEY, or on a fal
 *      reject, animateCreate falls through to animateModelFor — which has no
 *      veo31 case at all, so it returns the DEFAULT engine. A merchant paid
 *      75 tokens for Veo 3.1 and got Kling 2.5, which carries no surcharge.
 *   2. A premium engine that rejects at CREATE time falls back to the default.
 *   3. A premium engine that accepts and then fails at INFERENCE is retried on
 *      the default.
 *
 * animateCreate already returns the model that actually ran "for honest asset
 * metadata" — the metadata was honest and the wallet was not. This maps that
 * model back to its engine so the difference can be returned.
 */

import { engineSurcharge } from "./video-engines.ts";

/** Every model string either provider can return, mapped to its picker key. */
const MODEL_TO_ENGINE: Record<string, string> = {
  // fal
  "fal-ai/kling-video/v2.6/pro/image-to-video": "kling",
  "fal-ai/kling-video/v2.5-turbo/pro/image-to-video": "kling25fal",
  "fal-ai/veo3.1/fast/image-to-video": "veo31",
  // replicate
  "google/veo-3-fast": "veo",
  "kwaivgi/kling-v2.6-pro": "kling",
  "kwaivgi/kling-v2.5-turbo-pro": "kling",
  "kwaivgi/kling-v2.1-master": "kling",
  "kwaivgi/kling-v1.6-standard": "kling",
  // both of these carry a surcharge of their own — mapping them to a free
  // engine would refund a merchant who actually got what they paid for
  "bytedance/seedance-1-pro": "seedance",
  "minimax/hailuo-02": "hailuo",
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
