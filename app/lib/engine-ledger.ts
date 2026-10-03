/* What the merchant is owed back when a premium video engine did not run.
 *
 * engine-delivery.ts answers this for ONE delivered model, and
 * video-generation.server.ts has used it correctly since the surcharge
 * existed. The other three video pipelines never did: the Studio charges the
 * +25/+75 engine fee for any content type that submits no presenter — which
 * includes Commercial always, and Anthem/Cartoon whenever no presenter is
 * picked — and commercial/jingle/cartoon all threw the delivered model away.
 *
 *   commercial-ad-pipeline.server.ts:543  const { id } = await animateCreate(...)
 *   jingle-ad-pipeline.server.ts:573      const { id: animId } = await animateCreate(...)
 *   cartoon-ad-pipeline.server.ts:830     const { id: animId } = await animateCreate(...)
 *
 * animateCreate has always RETURNED { id, model }, so nothing had to be
 * plumbed through a provider — the answer was being discarded one destructure
 * short. Every one of those three has a documented path that silently renders
 * on the free default: animateCreate falls back to Replicate when fal rejects
 * and then to DEFAULT_ANIMATE_MODEL when the premium Replicate model rejects,
 * and renderMotionClip additionally re-renders a safety-filtered beat on the
 * default engine on purpose.
 *
 * MULTI-CLIP IS WHY THIS IS NOT JUST surchargeShortfall. A commercial renders
 * one clip per beat, so "which engine ran" is a set, not a value. The rule here
 * is that the merchant bought a premium engine for the piece, so if ANY clip
 * came back on something cheaper they did not get what they paid for, and the
 * whole surcharge is owed. That is deliberately the generous reading in the
 * dominant case — FAL_KEY unset or the engine unreachable puts EVERY clip on
 * the default anyway — and it errs toward the merchant in the rare mixed case,
 * which is the direction the rest of this codebase already chose ("conservative
 * in the merchant's favour", engine-delivery.ts).
 */

// Explicit .ts: the test runner strips types natively and does not resolve
// extensionless specifiers, which is why every tested module in app/lib imports
// its siblings this way (see engine-delivery.ts -> video-engines.ts).
import { surchargeShortfall } from "./engine-delivery.ts";

/** Tokens owed back for an engine that was paid for and did not run.
 *
 *  `deliveredModels` is every model that actually rendered a frame of this
 *  piece. An EMPTY list means we do not know what ran — a resumed prediction
 *  that never went through the adapter — and returns 0 rather than reading as a
 *  total downgrade and inventing a refund. video-generation.server.ts makes the
 *  same choice for the same reason, and logs that it skipped. */
export function surchargeOwed(
  requestedKey: string | null | undefined,
  deliveredModels: readonly (string | null | undefined)[],
): number {
  const ran = deliveredModels.filter((m): m is string => typeof m === "string" && m.length > 0);
  if (!ran.length) return 0;
  // The worst clip decides. With a single clip this is exactly
  // surchargeShortfall; with several, any miss owes the full surcharge.
  return ran.reduce((worst, model) => Math.max(worst, surchargeShortfall(requestedKey, model)), 0);
}

/** Collects the models a multi-clip pipeline actually rendered on.
 *
 *  Exists so a pipeline can pass `ledger.note` straight to a render helper as
 *  an optional callback, without that helper's return type changing — which
 *  matters because renderMotionClip has a dozen callers in scripts/video-qa.ts
 *  and breaking them to fix a billing bug would be the wrong trade. */
export type EngineLedger = {
  note: (model: string | null | undefined) => void;
  models: () => string[];
  owed: (requestedKey: string | null | undefined) => number;
  /** True when nothing was recorded — the caller should log a skip, not refund. */
  blind: () => boolean;
};

export function engineLedger(): EngineLedger {
  const seen: string[] = [];
  return {
    note: (model) => { if (typeof model === "string" && model) seen.push(model); },
    models: () => seen.slice(),
    owed: (requestedKey) => surchargeOwed(requestedKey, seen),
    blind: () => seen.length === 0,
  };
}
