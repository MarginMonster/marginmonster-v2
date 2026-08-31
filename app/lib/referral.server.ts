import { db } from "../db.server";

/* Referral loop — both stores get tokens when a referred store converts to a
 * paid plan (reward on real value, not just an install, so it can't be farmed).
 * Codes are short, unambiguous, and unique per shop. */

export const REFERRAL_REWARD_TOKENS = 150;

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
function genCode(): string {
  let s = "";
  for (let i = 0; i < 7; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

/** The shop's own code, minted on first request. */
export async function ensureReferralCode(shopId: string): Promise<string> {
  const shop = await db.shop.findUnique({ where: { id: shopId }, select: { referralCode: true } });
  if (shop?.referralCode) return shop.referralCode;
  for (let i = 0; i < 6; i++) {
    const code = genCode();
    try {
      await db.shop.update({ where: { id: shopId }, data: { referralCode: code } });
      return code;
    } catch { /* unique collision, retry */ }
  }
  const code = genCode() + String(Math.floor(Math.random() * 90 + 10));
  await db.shop.update({ where: { id: shopId }, data: { referralCode: code } });
  return code;
}

/** A new store enters someone's code. Bound once, self-referral blocked. */
export async function applyReferralCode(shopId: string, rawCode: string): Promise<{ ok: boolean; error?: string }> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, error: "Enter a code first." };
  const me = await db.shop.findUnique({
    where: { id: shopId },
    select: { referredBy: true, referralCode: true, activePlan: { select: { active: true } } },
  });
  if (!me) return { ok: false, error: "Shop not found." };
  if (me.referredBy) return { ok: false, error: "You've already used a referral code." };
  // A REFERRAL IS FOR BRINGING IN A NEW STORE.
  //
  // There was no check for this anywhere, so an established paying merchant
  // could type a friend's code and both wallets took 150 tokens for a
  // subscription that already existed and was never at risk. Two merchants who
  // already pay can trade codes and mint 300 tokens between them for nothing.
  // The reward exists to buy a conversion; there is none to buy here.
  if (me.activePlan?.active) {
    return { ok: false, error: "Referral codes are for new stores — yours is already on a plan." };
  }
  if (me.referralCode === code) return { ok: false, error: "That's your own code." };
  const referrer = await db.shop.findFirst({ where: { referralCode: code }, select: { id: true } });
  if (!referrer || referrer.id === shopId) return { ok: false, error: "That code isn't valid." };
  await db.shop.update({ where: { id: shopId }, data: { referredBy: code } });
  return { ok: true };
}

/** Grant both sides of a referral, ONCE, and only once real money has moved.
 *
 *  Its callers fire on plan ACTIVATION, and on Shopify an activation is the
 *  start of a 7-day free trial — so this used to mint 150 tokens for the
 *  referrer and 150 for the new shop before anyone had paid anything. Cancel
 *  on day six and we had bought 300 tokens of real render capacity for free.
 *  Worse, it is per-referred-shop, so one person could farm it: every trial
 *  signup using the same code paid the referrer again.
 *
 *  A shop still inside its trial is now left PENDING — referredBy stays set
 *  and referralCreditAt stays null — and settlePendingReferrals() pays it once
 *  the trial has actually elapsed on a still-active plan. */
export async function creditReferralOnConversion(shopId: string): Promise<void> {
  try {
    const me = await db.shop.findUnique({ where: { id: shopId }, select: { referredBy: true, referralCreditAt: true } });
    if (!me?.referredBy || me.referralCreditAt) return;
    const referrer = await db.shop.findFirst({ where: { referralCode: me.referredBy }, include: { activePlan: true } });
    if (!referrer) return;
    const mine = await db.shop.findUnique({ where: { id: shopId }, include: { activePlan: true } });
    if (!mine?.activePlan?.active) return;
    const { planTrialing } = await import("./tokens.server");
    if (planTrialing(mine.activePlan)) return; // pay when it converts, not when it starts

    // BOTH WALLETS OR NEITHER.
    //
    // The claim below is permanent: it stamps referralCreditAt and nothing ever
    // clears it. The grant underneath was a no-op when a plan id was missing,
    // so a referrer who shared their code BEFORE picking a plan — which the
    // Plans page invites them to do, at the exact moment it hands them the code
    // — brought in a paying store, and their 150 tokens went nowhere, silently
    // and forever. Leaving it unclaimed instead means the sweep pays them the
    // moment they subscribe.
    if (!referrer.activePlan?.id) {
      console.warn(
        `[referral] ${referrer.id} has no plan to credit yet — leaving ${shopId} pending until they subscribe`
      );
      return;
    }

    // CLAIM ATOMICALLY. The old code read referralCreditAt, then wrote it with
    // a plain update — two concurrent calls both passed the read and both
    // granted. updateMany with the null guard means exactly one wins.
    const claimed = await db.shop.updateMany({
      where: { id: shopId, referralCreditAt: null },
      data: { referralCreditAt: new Date() },
    });
    if (claimed.count !== 1) return; // someone else already paid this one
    const grant = async (planId?: string) => {
      if (planId) await db.plan.update({ where: { id: planId }, data: { tokensExtra: { increment: REFERRAL_REWARD_TOKENS } } });
    };
    await grant(mine?.activePlan?.id);
    await grant(referrer.activePlan?.id);
    console.log(`[referral] +${REFERRAL_REWARD_TOKENS} tokens each: ${shopId} referred by ${referrer.id}`);
  } catch (e) {
    console.error("[referral] credit failed (non-fatal):", e);
  }
}

/** Pay referrals whose trial has now elapsed.
 *
 *  creditReferralOnConversion only fires at activation, which on Shopify is
 *  the START of a free trial — so without this, deferring the payout past the
 *  trial would simply mean it never happened. Runs from the worker tick,
 *  self-throttled, and is a no-op for everyone already settled.
 */
let lastReferralSweep = 0;
const REFERRAL_SWEEP_EVERY_MS = 6 * 60 * 60_000;

export async function settlePendingReferrals(): Promise<void> {
  const now = Date.now();
  if (now - lastReferralSweep < REFERRAL_SWEEP_EVERY_MS) return;
  lastReferralSweep = now;
  try {
    // A WINDOW THAT ADVANCES.
    //
    // Every merchant who typed a code and then never subscribed stays in this
    // set forever — referredBy set, referralCreditAt null, nothing anywhere
    // clears either. With an unordered take of 200 and no filter, Postgres
    // handed back the same first 200 rows every sweep, so once that many
    // non-subscribers accumulated, no genuine convert was ever scanned again.
    //
    // Filtering on an existing plan is exact rather than approximate: the guard
    // inside creditReferralOnConversion already refuses a shop without an
    // active plan, so a shop that has none can never be paid and has no
    // business occupying a slot. A shop mid-trial legitimately keeps its place
    // — it is pending, not dead. Oldest first, so the queue is fair rather than
    // whatever order the heap returns.
    const TAKE = 500;
    const pending = await db.shop.findMany({
      where: {
        referredBy: { not: null },
        referralCreditAt: null,
        activePlan: { is: { active: true } },
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: TAKE,
    });
    if (pending.length === TAKE) {
      // Loud on purpose: a full page means somebody at the back is waiting.
      console.warn(`[referral] sweep filled its ${TAKE}-row page — some conversions are waiting for the next pass`);
    }
    for (const s of pending) {
      // Re-runs the same guards, so a shop that cancelled inside its trial is
      // simply never paid.
      await creditReferralOnConversion(s.id).catch(() => { /* per-shop, non-fatal */ });
    }
  } catch (e) {
    console.error("[referral] settle sweep failed (non-fatal):", e);
  }
}
