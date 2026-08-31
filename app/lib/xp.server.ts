import { db } from "../db.server";
import {
  ACHIEVEMENT_BY_KEY,
  giftForLevel,
  levelForXp,
  type AchievementDef,
} from "./achievements";

/* The arcade progression engine. Every award path is wrapped so gamification
 * can NEVER break a core action — worst case the merchant just doesn't get
 * XP for one event. */

export type XpResult = {
  gained: number;
  xp: number;
  level: number;
  leveledUp: boolean;
  giftedTokens: number; // level-up gifts credited to the wallet this award
};

export type UnlockResult = AchievementDef & { unlockedAt: string };

/** Award XP, recompute level, credit level-up gifts to the token wallet. */
export async function awardXp(shopId: string, gained: number): Promise<XpResult | null> {
  try {
    if (gained <= 0) return null;

    // A LEVEL IS CROSSED ONCE, AND ITS GIFT IS PAID ONCE.
    //
    // This read the shop, computed shop.xp + gained, and wrote both xp and
    // level back. Two awards landing together — a job finishing while the
    // merchant clicks, an achievement unlock that itself awards XP — both read
    // the same level, both saw a level-up, and both paid the gift into
    // tokensExtra. That bucket is PURCHASED tokens: it never expires and it
    // buys real renders, so the duplicate is permanent spendable money. The
    // stale read also silently dropped one award's XP entirely.
    //
    // The XP itself is an atomic increment, so nothing is lost. The level-up
    // is then claimed with a compare-and-swap on the level column: whoever
    // moves it from N to M owns the whole span N+1..M and pays exactly that,
    // and everyone else finds the level already moved and pays nothing.
    const bumped = await db.shop.update({
      where: { id: shopId },
      data: { xp: { increment: gained } },
      select: { xp: true, level: true },
    });

    let level = bumped.level;
    let giftedTokens = 0;
    let leveledUp = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = await db.shop.findUnique({ where: { id: shopId }, select: { xp: true, level: true } });
      if (!cur) break;
      const reached = levelForXp(cur.xp);
      level = Math.max(cur.level, reached);
      if (reached <= cur.level) break; // nothing new to claim
      let gift = 0;
      for (let l = cur.level + 1; l <= reached; l++) gift += giftForLevel(l);
      const claimed = await db.shop.updateMany({
        where: { id: shopId, level: cur.level },
        data: {
          level: reached,
          // flash for the global level-up popup (read + cleared by the app shell)
          pendingLevelUp: JSON.stringify({ level: reached, gift }),
        },
      });
      if (claimed.count === 1) {
        giftedTokens = gift;
        leveledUp = true;
        break;
      }
      // Someone else moved the level — read it again and see what is left.
    }

    if (giftedTokens > 0) {
      const plan = await db.plan.findUnique({ where: { shopId }, select: { id: true } });
      if (plan) {
        await db.plan.update({
          where: { id: plan.id },
          data: { tokensExtra: { increment: giftedTokens } },
        });
      }
    }
    return { gained, xp: bumped.xp + 0, level, leveledUp, giftedTokens };
  } catch (e) {
    console.error("[xp] awardXp failed (non-fatal):", e);
    return null;
  }
}

/** Unlock an achievement once; pays its XP + token bonuses. Returns the def if
 *  newly unlocked, null if already owned (or on any error). */
export async function unlockAchievement(shopId: string, key: string): Promise<UnlockResult | null> {
  try {
    const def = ACHIEVEMENT_BY_KEY[key];
    if (!def) return null;
    const row = await db.shopAchievement.create({ data: { shopId, key } });
    if (def.tokens > 0) {
      const shop = await db.shop.findUnique({ where: { id: shopId }, include: { activePlan: true } });
      if (shop?.activePlan) {
        await db.plan.update({
          where: { id: shop.activePlan.id },
          data: { tokensExtra: { increment: def.tokens } },
        });
      }
    }
    if (def.xp > 0) await awardXp(shopId, def.xp);
    return { ...def, unlockedAt: row.unlockedAt.toISOString() };
  } catch {
    // unique violation = already unlocked — the normal path, stay quiet
    return null;
  }
}

/** Level-milestone achievements (token-only bonuses — no XP, no cascades). */
export async function checkLevelAchievements(shopId: string, level: number): Promise<UnlockResult[]> {
  const out: UnlockResult[] = [];
  if (level >= 5) { const a = await unlockAchievement(shopId, "PLAYER_ONE"); if (a) out.push(a); }
  if (level >= 10) { const a = await unlockAchievement(shopId, "ARCADE_REGULAR"); if (a) out.push(a); }
  if (level >= 25) { const a = await unlockAchievement(shopId, "HIGH_SCORE"); if (a) out.push(a); }
  if (level >= 40) { const a = await unlockAchievement(shopId, "ISLAND_LEGEND"); if (a) out.push(a); }
  if (level >= 50) { const a = await unlockAchievement(shopId, "CROWNED"); if (a) out.push(a); }
  return out;
}

/** Called from chargeTokens — 1 XP per token spent + lifetime-spend tracking. */
/** Undo the progression a spend earned, when that spend is given back.
 *
 * onTokensSpent is documented as "farm-proof — they paid", and a refund makes
 * that false: a job that fails terminally returns the tokens but the XP and the
 * lifetime tokensSpent it minted stayed, so failure was a slow, free way up the
 * level ladder — and every level pays tokensExtra, which buys real renders.
 *
 * XP and the lifetime counter are wound back, clamped at zero. The LEVEL and
 * any gift already paid are deliberately left alone: clawing back tokens a
 * merchant has seen land is a worse experience than the leak, and awardXp only
 * grants when levelForXp(xp) passes the CURRENT level, so re-earning the same
 * XP cannot pay a second time. */
export async function onTokensRefunded(shopId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  try {
    const shop = await db.shop.findUnique({ where: { id: shopId }, select: { xp: true, tokensSpent: true } });
    if (!shop) return;
    await db.shop.update({
      where: { id: shopId },
      data: {
        xp: { decrement: Math.min(amount, Math.max(0, shop.xp)) },
        tokensSpent: { decrement: Math.min(amount, Math.max(0, shop.tokensSpent)) },
      },
    });
  } catch (e) {
    console.error("[xp] onTokensRefunded failed (non-fatal):", e);
  }
}

export async function onTokensSpent(shopId: string, amount: number): Promise<void> {
  try {
    const shop = await db.shop.update({
      where: { id: shopId },
      data: { tokensSpent: { increment: amount } },
    });
    if (shop.tokensSpent >= 100) await unlockAchievement(shopId, "BIG_SPENDER");
    const res = await awardXp(shopId, amount);
    if (res?.leveledUp) await checkLevelAchievements(shopId, res.level);
  } catch (e) {
    console.error("[xp] onTokensSpent failed (non-fatal):", e);
  }
}
