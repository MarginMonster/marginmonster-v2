// Orchestrates launching a single APPROVED asset as a real campaign.
// Always creates campaigns PAUSED on both platforms — nothing spends until
// the merchant (or decisioning engine) explicitly activates.

import { db } from "../db.server";
import { getPlatformConfig } from "./platform-mapping.server";
import * as meta from "./meta-ads.server";
import * as tiktok from "./tiktok-ads.server";

interface LaunchParams {
  assetId: string;
  shopId: string;
  platform: "META" | "TIKTOK";
  weeklyBudgetCents: number;
}

export async function launchCampaign(params: LaunchParams): Promise<string> {
  const { assetId, shopId, platform, weeklyBudgetCents } = params;

  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error(`Asset ${assetId} not found`);
  if (asset.status !== "APPROVED") throw new Error("Asset must be APPROVED before launching");

  const shop = await db.shop.findUnique({
    where: { id: shopId },
    include: { activePlan: true, adAccounts: true },
  });
  if (!shop?.activePlan) throw new Error("No active plan for shop");

  const adAccount = shop.adAccounts.find((a) => a.platform === platform);
  if (!adAccount) throw new Error(`No ${platform} ad account connected`);

  const config = getPlatformConfig(shop.activePlan.type);
  const body = JSON.parse(asset.bodyJson);
  const meta_ = JSON.parse(asset.metaJson);
  const campaignName = `MM-${shop.activePlan.type}-${asset.id.slice(-6)}-${Date.now()}`;

  let externalCampaignId: string;

  if (platform === "META") {
    const cfg = config.meta;
    externalCampaignId = await meta.createCampaign({
      adAccountId: adAccount.externalId,
      name: campaignName,
      objective: cfg.objective,
      budgetCents: weeklyBudgetCents,
      token: adAccount.accessToken,
    });

    // Ad set with 1/7 of weekly budget as daily
    await meta.createAdSet({
      adAccountId: adAccount.externalId,
      campaignId: externalCampaignId,
      name: `${campaignName}-adset`,
      optimizationGoal: cfg.optimizationGoal,
      billingEvent: cfg.billingEvent,
      audienceStrategy: cfg.audienceStrategy,
      token: adAccount.accessToken,
      dailyBudgetCents: Math.floor(weeklyBudgetCents / 7),
    });
  } else {
    const cfg = config.tiktok;
    externalCampaignId = await tiktok.createCampaign(
      adAccount.externalId,
      campaignName,
      cfg.objective,
      weeklyBudgetCents,
      adAccount.accessToken
    );

    await tiktok.createAdGroup(
      adAccount.externalId,
      externalCampaignId,
      `${campaignName}-adgroup`,
      cfg.optimizationEvent,
      cfg.audienceType,
      Math.floor(weeklyBudgetCents / 7),
      adAccount.accessToken
    );
  }

  const campaign = await db.campaign.create({
    data: {
      shopId,
      adAccountId: adAccount.id,
      assetId,
      platform,
      externalId: externalCampaignId,
      status: "PAUSED",
      budgetCents: weeklyBudgetCents,
    },
  });

  await db.asset.update({ where: { id: assetId }, data: { status: "PUBLISHED" } });

  return campaign.id;
}
