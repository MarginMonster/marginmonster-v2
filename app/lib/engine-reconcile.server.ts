/* One implementation of "refund the engine surcharge", for the three video
 * pipelines that never had one.
 *
 * video-generation.server.ts has done this correctly for a while, and its shape
 * is the one worth copying rather than paraphrasing three more times: CLAIM the
 * refund before crediting it, because crediting first and crashing before the
 * claim pays it again on every resume — and losing one refund is recoverable
 * and loud, while paying one twice is money out the door on every retry.
 *
 * Kept in a .server module of its own so commercial / jingle / cartoon share
 * the behaviour instead of growing three copies that drift apart. The arithmetic
 * lives in engine-ledger.ts, which is pure and tested. */

import { downgradeNote } from "./engine-delivery.ts";
import { surchargeOwed } from "./engine-ledger.ts";
import { refundTokens } from "./tokens.server";

export async function reconcileEngineSurcharge(opts: {
  shopId: string;
  /** The engine-picker key the merchant was charged for. */
  requestedKey: string | null | undefined;
  /** Every model that actually rendered a frame of this piece. */
  deliveredModels: readonly (string | null | undefined)[];
  /** The resume flag — set once a previous attempt already claimed the refund. */
  alreadyRefunded?: boolean;
  /** Persists the claim. Pass the pipeline's own ckpt: () => ckpt({ ckEngineRefunded: true }). */
  claim: () => Promise<void> | void;
  /** How much of this piece's charge came from the purchased bucket, so the
   *  refund unwinds in the opposite order to the spend. Without it, tokens the
   *  merchant paid cash for come back as allowance tokens that expire. */
  chargedFromExtra?: number;
  /** Log prefix, e.g. "commercial". */
  tag: string;
}): Promise<void> {
  const owed = surchargeOwed(opts.requestedKey, opts.deliveredModels);

  if (!opts.deliveredModels.some((m) => m)) {
    // Nothing recorded: a resumed prediction that never went through the
    // adapter. Say so rather than reading "" as a total downgrade.
    console.warn(`[${opts.tag}] engine for "${opts.requestedKey}" not reconciled — no delivered model was recorded`);
    return;
  }
  if (owed <= 0 || opts.alreadyRefunded) return;

  await opts.claim();
  try {
    await refundTokens(opts.shopId, owed, opts.chargedFromExtra);
    const worst = opts.deliveredModels.find((m) => m) || "";
    console.warn(`[${opts.tag}] ${downgradeNote(opts.requestedKey, worst)}`);
  } catch (e) {
    console.error(
      `[${opts.tag}] ENGINE REFUND FAILED after being claimed — shop ${opts.shopId} is owed ${owed} tokens: `,
      e instanceof Error ? e.message.slice(0, 200) : e,
    );
  }
}
