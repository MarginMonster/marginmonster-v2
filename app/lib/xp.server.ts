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
    const shop = await db.shop.findUnique({
      where: { id: shopId },
      include: { activePlan: true },
    });
    if (!shop) return null;

    const xp = shop.xp + gained;
    const level = levelForXp(xp);
    const leveledUp = level > shop.level;

    let giftedTokens = 0;
    if (leveledUp) {
      for (let l = shop.level + 1; l <= level; l++) giftedTokens += giftForLevel(l);
    }

    await db.shop.update({
      where: { id: shopId },
      data: {
        xp,
        level,
        // flash for the global level-up popup (read + cleared by the app shell)
        ...(leveledUp ? { pendingLevelUp: JSON.stringify({ level, gift: giftedTokens }) } : {}),
      },
    });
    if (giftedTokens > 0 && shop.activePlan) {
      await db.plan.update({
        where: { id: shop.activePlan.id },
        data: { tokensExtra: { increment: giftedTokens } },
      });
    }
    return { gained, xp, level, leveledUp, giftedTokens };
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
  return out;
}

/** Called from chargeTokens — 1 XP per token spent + lifetime-spend tracking. */
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
