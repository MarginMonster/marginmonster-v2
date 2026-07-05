// Scheduled performance pass: pulls live metrics, applies kill/scale rules,
// and — unlike an earlier DB-only version — actually calls platform APIs to
// pause or rebudget live campaigns.

import { db } from "../db.server";
import { getPlatformConfig } from "./platform-mapping.server";
import * as meta from "./meta-ads.server";
import * as tiktok from "./tiktok-ads.server";

export async function runDecisioningPass(): Promise<void> {
  // Find all active campaigns across all shops
  const activeCampaigns = await db.campaign.findMany({
    where: { status: "ACTIVE" },
    include: {
      shop: { include: { activePlan: true } },
      adAccount: true,
    },
  });

  for (const campaign of activeCampaigns) {
    try {
      await evaluateCampaign(campaign);
    } catch (e) {
      console.error(`Decisioning error for campaign ${campaign.id}:`, e);
    }
  }
}

async function evaluateCampaign(campaign: {
  id: string;
  externalId: string | null;
  platform: "META" | "TIKTOK";
  budgetCents: number;
  spentCents: number;
  shop: { activePlan: { campaignGoal: string; weeklyBudget: number } | null };
  adAccount: { externalId: string; accessToken: string };
}): Promise<void> {
  if (!campaign.externalId || !campaign.shop.activePlan) return;

  const config = getPlatformConfig(campaign.shop.activePlan.campaignGoal);
  const weeklyBudgetCents = Math.round(campaign.shop.activePlan.weeklyBudget * 100);

  // Pull fresh performance from platform
  let perf: { impressions: number; clicks: number; spend: number; conversions: number; revenue: number; roas: number };

  if (campaign.platform === "META") {
    perf = await meta.getCampaignInsights(campaign.externalId, campaign.adAccount.accessToken);
  } else {
    perf = await tiktok.getCampaignInsights(
      campaign.adAccount.externalId,
      campaign.externalId,
      campaign.adAccount.accessToken
    );
  }

  const spentCents = Math.round(perf.spend * 100);

  // Persist metric snapshot
  await db.performanceMetric.create({
    data: {
      campaignId: campaign.id,
      impressions: perf.impressions,
      clicks: perf.clicks,
      conversions: perf.conversions,
      spendCents,
      revenueCents: Math.round(perf.revenue * 100),
      roas: perf.roas,
    },
  });

  await db.campaign.update({
    where: { id: campaign.id },
    data: { spentCents },
  });

  const cfg = campaign.platform === "META" ? config.meta : config.tiktok;

  // Kill rule: spent >= killAfterSpendFraction of weekly budget AND roas < min
  const killThresholdCents = Math.round(weeklyBudgetCents * cfg.killAfterSpendFraction);
  const shouldKill =
    cfg.minRoasToSurvive > 0 &&
    spentCents >= killThresholdCents &&
    perf.roas < cfg.minRoasToSurvive;

  if (shouldKill) {
    await pausePlatformCampaign(campaign);
    await db.campaign.update({
      where: { id: campaign.id },
      data: { status: "KILLED" },
    });
    console.log(`Killed campaign ${campaign.id} (ROAS ${perf.roas.toFixed(2)} < ${cfg.minRoasToSurvive})`);
    return;
  }

  // Scale rule: roas exceeds min by 50% — bump budget
  const scaleThreshold = cfg.minRoasToSurvive * 1.5;
  if (cfg.minRoasToSurvive > 0 && perf.roas >= scaleThreshold && cfg.scaleIncrementPct > 0) {
    const newBudgetCents = Math.round(campaign.budgetCents * (1 + cfg.scaleIncrementPct));
    await scalePlatformCampaign(campaign, newBudgetCents);
    await db.campaign.update({
      where: { id: campaign.id },
      data: { budgetCents: newBudgetCents },
    });
    console.log(`Scaled campaign ${campaign.id} budget to $${(newBudgetCents / 100).toFixed(2)}`);
  }
}

async function pausePlatformCampaign(campaign: {
  platform: "META" | "TIKTOK";
  externalId: string | null;
  adAccount: { externalId: string; accessToken: string };
}): Promise<void> {
  if (!campaign.externalId) return;
  if (campaign.platform === "META") {
    await meta.pauseCampaign(campaign.externalId, campaign.adAccount.accessToken);
  } else {
    await tiktok.pauseCampaign(
      campaign.adAccount.externalId,
      campaign.externalId,
      campaign.adAccount.accessToken
    );
  }
}

async function scalePlatformCampaign(
  campaign: {
    platform: "META" | "TIKTOK";
    externalId: string | null;
    adAccount: { externalId: string; accessToken: string };
  },
  newBudgetCents: number
): Promise<void> {
  if (!campaign.externalId) return;
  if (campaign.platform === "META") {
    await meta.updateCampaignBudget(
      campaign.externalId,
      newBudgetCents,
      campaign.adAccount.accessToken
    );
  }
  // TikTok budget updates follow similar pattern — extend as needed
}
