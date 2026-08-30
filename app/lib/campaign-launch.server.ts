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
  /** The queue job driving this launch. Supplying it makes the launch
   *  idempotent across that job's retries — see below. */
  jobId?: string;
}

export async function launchCampaign(params: LaunchParams): Promise<string> {
  const { assetId, shopId, platform, weeklyBudgetCents, jobId } = params;

  // IDEMPOTENCY, because the thing on the other side of this function is real
  // money on someone's ad account.
  //
  // The old flow created the campaign at the platform, THEN the ad set, THEN
  // the local row, THEN flipped the asset to PUBLISHED. Anything that threw
  // after the first of those — a rejected budget, an audience error, a 429 —
  // left a real campaign live at Meta or TikTok with no record of it here, and
  // the queue retried the whole function. Three attempts, three campaigns.
  //
  // Keyed on the JOB, not on (shop, asset, platform): boosting is a repeatable
  // purchase — app.archive.tsx charges BOOST_FEE and resets the asset to
  // APPROVED each time — so a second paid boost of the same asset SHOULD create
  // a second campaign. Only a retry of the same job must not.
  const prior = jobId ? await db.campaign.findUnique({ where: { launchJobId: jobId } }) : null;
  if (prior?.externalId && prior.status !== "DRAFT") return prior.id; // already finished

  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error(`Asset ${assetId} not found`);
  // A resumed attempt owns `prior`, so the asset may legitimately have moved on
  // already; only a fresh launch has to see APPROVED.
  if (!prior && asset.status !== "APPROVED") throw new Error("Asset must be APPROVED before launching");

  const shop = await db.shop.findUnique({
    where: { id: shopId },
    include: { activePlan: true, adAccounts: true },
  });
  if (!shop?.activePlan) throw new Error("No active plan for shop");

  const adAccount = shop.adAccounts.find((a) => a.platform === platform);
  if (!adAccount) throw new Error(`No ${platform} ad account connected`);

  const config = getPlatformConfig(shop.activePlan.campaignGoal);
  const body = JSON.parse(asset.bodyJson);
  const meta_ = JSON.parse(asset.metaJson);
  const campaignName = `MM-${shop.activePlan.campaignGoal}-${asset.id.slice(-6)}-${Date.now()}`;

  // Resume a half-finished launch rather than starting a second one.
  let externalCampaignId: string = prior?.externalId || "";
  let campaignId: string | undefined = prior?.id;

  if (!externalCampaignId) {
    externalCampaignId =
      platform === "META"
        ? await meta.createCampaign({
            adAccountId: adAccount.externalId,
            name: campaignName,
            objective: config.meta.objective,
            budgetCents: weeklyBudgetCents,
            token: adAccount.accessToken,
          })
        : await tiktok.createCampaign(
            adAccount.externalId,
            campaignName,
            config.tiktok.objective,
            weeklyBudgetCents,
            adAccount.accessToken
          );

    // WRITE IT DOWN IMMEDIATELY. This is the line the old code was missing: the
    // campaign now exists on someone's ad account, and if the process dies
    // before we record it, nothing on our side knows it is there. Persist
    // before the ad set — that call is the one that historically threw.
    const row = campaignId
      ? await db.campaign.update({ where: { id: campaignId }, data: { externalId: externalCampaignId } })
      : await db.campaign.create({
          data: {
            shopId,
            adAccountId: adAccount.id,
            assetId,
            platform,
            externalId: externalCampaignId,
            status: "DRAFT", // becomes PAUSED once its ad set/group exists
            budgetCents: weeklyBudgetCents,
            launchJobId: jobId ?? null,
          },
        });
    campaignId = row.id;
  }

  if (platform === "META") {
    const cfg = config.meta;
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
    // The campaign itself is created and recorded above, for both platforms.
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

  // The row already exists (it was written the moment the platform campaign
  // did); this only promotes it now that its ad set/group is in place.
  await db.campaign.update({ where: { id: campaignId! }, data: { status: "PAUSED" } });
  await db.asset.update({ where: { id: assetId }, data: { status: "PUBLISHED" } });

  return campaignId!;
}
