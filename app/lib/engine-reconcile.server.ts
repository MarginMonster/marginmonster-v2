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
  /** Persists a payload patch. Called TWICE: first `{ ckEngineRefunded: true }`
   *  before the credit (the resume guard), then `{ ckEngineRefundedAmount: N }`
   *  only after the credit lands. The amount is load-bearing: the terminal-
   *  failure refund (refundPrepaidOnce) pays back chargedTokens, and if the
   *  engine surcharge were already refunded here without being recorded, a job
   *  that reconciled and then failed would refund that surcharge TWICE. The
   *  amount is written AFTER the credit, never in the claim, so a credit that
   *  throws leaves it unset and refundPrepaidOnce correctly pays the whole
   *  charge (the surcharge never actually left). */
  checkpoint: (patch: Record<string, unknown>) => Promise<void> | void;
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

  await opts.checkpoint({ ckEngineRefunded: true }); // claim BEFORE crediting
  try {
    await refundTokens(opts.shopId, owed, opts.chargedFromExtra);
    // Record what actually landed, so a later terminal-failure refund subtracts
    // exactly this and the surcharge is not paid a second time.
    await opts.checkpoint({ ckEngineRefundedAmount: owed });
    const worst = opts.deliveredModels.find((m) => m) || "";
    console.warn(`[${opts.tag}] ${downgradeNote(opts.requestedKey, worst)}`);
  } catch (e) {
    console.error(
      `[${opts.tag}] ENGINE REFUND FAILED after being claimed — shop ${opts.shopId} is owed ${owed} tokens: `,
      e instanceof Error ? e.message.slice(0, 200) : e,
    );
  }
}
