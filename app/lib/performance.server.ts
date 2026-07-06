// Aggregates campaign performance into the numbers merchants care about:
// ad spend, revenue, ROI, ROAS, conversions, and traffic by source.
// Data comes from the PerformanceMetric snapshots the decisioning engine
// pulls from Meta/TikTok — no protected Shopify customer data required.

import { db } from "../db.server";

export interface PlatformBreakdown {
  platform: "META" | "TIKTOK";
  spendCents: number;
  revenueCents: number;
  conversions: number;
  clicks: number;
  impressions: number;
  roas: number;
}

export interface CampaignRow {
  id: string;
  name: string;
  platform: "META" | "TIKTOK";
  status: string;
  spendCents: number;
  revenueCents: number;
  conversions: number;
  clicks: number;
  roas: number;
  roi: number;
}

export interface PerformanceSummary {
  totals: {
    spendCents: number;
    revenueCents: number;
    conversions: number;
    clicks: number;
    impressions: number;
  };
  roi: number; // percent
  roas: number;
  byPlatform: PlatformBreakdown[];
  campaigns: CampaignRow[];
  hasData: boolean;
}

function roiPct(revenueCents: number, spendCents: number): number {
  if (spendCents <= 0) return 0;
  return ((revenueCents - spendCents) / spendCents) * 100;
}

function roasOf(revenueCents: number, spendCents: number): number {
  if (spendCents <= 0) return 0;
  return revenueCents / spendCents;
}

export async function getPerformanceSummary(
  shopId: string
): Promise<PerformanceSummary> {
  const campaigns = await db.campaign.findMany({
    where: { shopId },
    include: {
      metrics: { orderBy: { recordedAt: "desc" }, take: 1 },
      asset: { select: { title: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const totals = { spendCents: 0, revenueCents: 0, conversions: 0, clicks: 0, impressions: 0 };
  const platformMap = new Map<"META" | "TIKTOK", PlatformBreakdown>();
  const rows: CampaignRow[] = [];

  for (const c of campaigns) {
    const m = c.metrics[0];
    const spendCents = m?.spendCents ?? c.spentCents ?? 0;
    const revenueCents = m?.revenueCents ?? 0;
    const conversions = m?.conversions ?? 0;
    const clicks = m?.clicks ?? 0;
    const impressions = m?.impressions ?? 0;

    totals.spendCents += spendCents;
    totals.revenueCents += revenueCents;
    totals.conversions += conversions;
    totals.clicks += clicks;
    totals.impressions += impressions;

    const pb =
      platformMap.get(c.platform) ??
      { platform: c.platform, spendCents: 0, revenueCents: 0, conversions: 0, clicks: 0, impressions: 0, roas: 0 };
    pb.spendCents += spendCents;
    pb.revenueCents += revenueCents;
    pb.conversions += conversions;
    pb.clicks += clicks;
    pb.impressions += impressions;
    platformMap.set(c.platform, pb);

    rows.push({
      id: c.id,
      name: c.asset?.title || `${c.platform} campaign`,
      platform: c.platform,
      status: c.status,
      spendCents,
      revenueCents,
      conversions,
      clicks,
      roas: roasOf(revenueCents, spendCents),
      roi: roiPct(revenueCents, spendCents),
    });
  }

  const byPlatform = Array.from(platformMap.values()).map((pb) => ({
    ...pb,
    roas: roasOf(pb.revenueCents, pb.spendCents),
  }));

  return {
    totals,
    roi: roiPct(totals.revenueCents, totals.spendCents),
    roas: roasOf(totals.revenueCents, totals.spendCents),
    byPlatform,
    campaigns: rows,
    hasData: campaigns.length > 0,
  };
}
