// Seeds realistic-looking demo data so the Performance and Campaigns screens
// look populated for App Store screenshots. Idempotent-ish: clears prior demo
// rows (marked with externalId prefix "demo_") before re-seeding.

import { db } from "../db.server";

const DEMO_PREFIX = "demo_";

export async function seedDemoData(shopId: string): Promise<void> {
  // Clean previous demo rows for this shop.
  const prior = await db.campaign.findMany({
    where: { shopId, externalId: { startsWith: DEMO_PREFIX } },
    select: { id: true, assetId: true },
  });
  const priorIds = prior.map((c) => c.id);
  if (priorIds.length) {
    await db.performanceMetric.deleteMany({ where: { campaignId: { in: priorIds } } });
    await db.campaign.deleteMany({ where: { id: { in: priorIds } } });
    await db.asset.deleteMany({ where: { id: { in: prior.map((c) => c.assetId) } } });
  }

  // Demo ad account (Meta).
  const adAccount = await db.adAccount.upsert({
    where: { shopId_platform: { shopId, platform: "META" } },
    create: {
      shopId,
      platform: "META",
      externalId: `${DEMO_PREFIX}act_1029384756`,
      name: "Demo Meta Ad Account",
      accessToken: "demo",
    },
    update: {},
  });

  const campaigns = [
    { title: "Blue Razz Gummy Worms — Highlight", platform: "META" as const, spend: 24500, revenue: 78200, conv: 41, clicks: 1820, imp: 61000, status: "ACTIVE" as const },
    { title: "Sour Neon Bites — UGC Video", platform: "TIKTOK" as const, spend: 18900, revenue: 51300, conv: 27, clicks: 2140, imp: 88000, status: "ACTIVE" as const },
    { title: "Mystery Snack Box — Retargeting", platform: "META" as const, spend: 12100, revenue: 46700, conv: 33, clicks: 980, imp: 32000, status: "ACTIVE" as const },
    { title: "Exotic Chips Bundle — Launch", platform: "TIKTOK" as const, spend: 9800, revenue: 14200, conv: 8, clicks: 1360, imp: 54000, status: "PAUSED" as const },
  ];

  for (const c of campaigns) {
    const acct =
      c.platform === "META"
        ? adAccount
        : await db.adAccount.upsert({
            where: { shopId_platform: { shopId, platform: "TIKTOK" } },
            create: { shopId, platform: "TIKTOK", externalId: `${DEMO_PREFIX}adv_5566778899`, name: "Demo TikTok Ad Account", accessToken: "demo" },
            update: {},
          });

    const asset = await db.asset.create({
      data: {
        shopId,
        type: c.platform === "TIKTOK" ? "VIDEO_AD" : "IMAGE_AD",
        status: "PUBLISHED",
        title: c.title,
        bodyJson: JSON.stringify({ demo: true }),
        metaJson: JSON.stringify({ demo: true }),
      },
    });

    const campaign = await db.campaign.create({
      data: {
        shopId,
        adAccountId: acct.id,
        assetId: asset.id,
        platform: c.platform,
        externalId: `${DEMO_PREFIX}${Math.random().toString(36).slice(2, 10)}`,
        status: c.status,
        budgetCents: 30000,
        spentCents: c.spend,
      },
    });

    await db.performanceMetric.create({
      data: {
        campaignId: campaign.id,
        impressions: c.imp,
        clicks: c.clicks,
        conversions: c.conv,
        spendCents: c.spend,
        revenueCents: c.revenue,
        roas: c.revenue / c.spend,
      },
    });
  }
}

export async function clearDemoData(shopId: string): Promise<void> {
  const prior = await db.campaign.findMany({
    where: { shopId, externalId: { startsWith: DEMO_PREFIX } },
    select: { id: true, assetId: true },
  });
  const ids = prior.map((c) => c.id);
  if (ids.length) {
    await db.performanceMetric.deleteMany({ where: { campaignId: { in: ids } } });
    await db.campaign.deleteMany({ where: { id: { in: ids } } });
    await db.asset.deleteMany({ where: { id: { in: prior.map((c) => c.assetId) } } });
  }
  await db.adAccount.deleteMany({ where: { shopId, externalId: { startsWith: DEMO_PREFIX } } });
}
