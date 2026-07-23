import { db } from "../db.server";
import type { PlatformStats } from "./social-provider.server";

/* Organic social insights — the "social media management" layer.
 *
 * The provider's analytics API returns PROFILE-level numbers per platform
 * (followers, reach, views, likes, comments, shares, saves). We cache them on
 * the shop (socialStatsJson) and refresh hourly from the worker. The Results
 * screen reads the cache — no live call on the request path.
 *
 * HONESTY RULE: numbers only ever come from a real provider response. When
 * nothing is linked, the key is absent, or the call fails, the cache is left
 * as-is and the UI shows an honest "connect / warming up" state — never a
 * fabricated figure. */

export type SocialStats = {
  fetchedAt: string | null;
  platforms: Record<string, PlatformStats>;
};

export const SOCIAL_PLATFORMS = ["tiktok", "instagram", "facebook"] as const;

const EMPTY: SocialStats = { fetchedAt: null, platforms: {} };

export function parseSocialStats(json: string | null | undefined): SocialStats {
  if (!json) return EMPTY;
  try {
    const v = JSON.parse(json);
    if (v && typeof v === "object" && v.platforms && typeof v.platforms === "object") {
      return { fetchedAt: typeof v.fetchedAt === "string" ? v.fetchedAt : null, platforms: v.platforms };
    }
  } catch { /* fall through */ }
  return EMPTY;
}

/** Totals across every linked platform — the headline numbers. */
export function sumStats(stats: SocialStats): PlatformStats & { platformCount: number } {
  const acc = { followers: 0, reach: 0, views: 0, impressions: 0, likes: 0, comments: 0, shares: 0, saves: 0, platformCount: 0 };
  for (const p of Object.values(stats.platforms)) {
    acc.followers += p.followers; acc.reach += p.reach; acc.views += p.views;
    acc.impressions += p.impressions; acc.likes += p.likes; acc.comments += p.comments;
    acc.shares += p.shares; acc.saves += p.saves; acc.platformCount++;
  }
  return acc;
}

let lastScan = 0;
const SCAN_EVERY_MS = 60 * 60_000; // hourly — profile analytics don't move fast

/** Worker tick entry point: refresh cached analytics for every shop that has a
 *  provider profile and at least one linked platform. Cheap, throttled, honest. */
export async function refreshSocialStats(): Promise<void> {
  const now = Date.now();
  if (now - lastScan < SCAN_EVERY_MS) return;
  lastScan = now;

  try {
    const { socialProviderEnabled, fetchAnalytics, linkedFromCache } = await import("./social-provider.server");
    if (!socialProviderEnabled()) return;

    const shops = await db.shop.findMany({
      where: { socialProfileKey: { not: null } },
      select: { id: true, socialProfileKey: true, socialsJson: true },
    });

    for (const s of shops) {
      const linked = linkedFromCache(s.socialsJson).filter((p) => (SOCIAL_PLATFORMS as readonly string[]).includes(p));
      if (!s.socialProfileKey || linked.length === 0) continue;
      const platforms = await fetchAnalytics(s.socialProfileKey, linked);
      if (!platforms) continue; // failure / nothing usable → keep prior cache
      const payload: SocialStats = { fetchedAt: new Date(now).toISOString(), platforms };
      await db.shop.update({ where: { id: s.id }, data: { socialStatsJson: JSON.stringify(payload) } });
    }
  } catch (e) {
    console.error("[social-insights] refresh failed (non-fatal):", e);
  }
}

/** On-demand refresh for a single shop (used when the merchant opens Results and
 *  the cache is empty/stale) — bypasses the global throttle for that one shop. */
export async function refreshShopStats(shopId: string): Promise<SocialStats | null> {
  try {
    const { socialProviderEnabled, fetchAnalytics, linkedFromCache } = await import("./social-provider.server");
    if (!socialProviderEnabled()) return null;
    const shop = await db.shop.findUnique({
      where: { id: shopId },
      select: { socialProfileKey: true, socialsJson: true },
    });
    if (!shop?.socialProfileKey) return null;
    const linked = linkedFromCache(shop.socialsJson).filter((p) => (SOCIAL_PLATFORMS as readonly string[]).includes(p));
    if (linked.length === 0) return null;
    const platforms = await fetchAnalytics(shop.socialProfileKey, linked);
    if (!platforms) return null;
    const payload: SocialStats = { fetchedAt: new Date().toISOString(), platforms };
    await db.shop.update({ where: { id: shopId }, data: { socialStatsJson: JSON.stringify(payload) } });
    return payload;
  } catch (e) {
    console.error("[social-insights] shop refresh failed (non-fatal):", e);
    return null;
  }
}
