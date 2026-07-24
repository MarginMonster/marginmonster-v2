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
  const me = await db.shop.findUnique({ where: { id: shopId }, select: { referredBy: true, referralCode: true } });
  if (!me) return { ok: false, error: "Shop not found." };
  if (me.referredBy) return { ok: false, error: "You've already used a referral code." };
  if (me.referralCode === code) return { ok: false, error: "That's your own code." };
  const referrer = await db.shop.findFirst({ where: { referralCode: code }, select: { id: true } });
  if (!referrer || referrer.id === shopId) return { ok: false, error: "That code isn't valid." };
  await db.shop.update({ where: { id: shopId }, data: { referredBy: code } });
  return { ok: true };
}

/** Called on a store's first paid conversion — grants both sides once. */
export async function creditReferralOnConversion(shopId: string): Promise<void> {
  try {
    const me = await db.shop.findUnique({ where: { id: shopId }, select: { referredBy: true, referralCreditAt: true } });
    if (!me?.referredBy || me.referralCreditAt) return;
    const referrer = await db.shop.findFirst({ where: { referralCode: me.referredBy }, include: { activePlan: true } });
    if (!referrer) return;
    // Claim the one-shot before granting so a double-fire can't double-pay.
    await db.shop.update({ where: { id: shopId }, data: { referralCreditAt: new Date() } });
    const mine = await db.shop.findUnique({ where: { id: shopId }, include: { activePlan: true } });
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
