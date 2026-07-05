// TikTok for Business Marketing API client (v1.3)
// All campaigns created PAUSED — nothing spends until explicitly activated.

const BASE = "https://business-api.tiktok.com/open_api/v1.3";

async function tiktokPost<T>(
  path: string,
  token: string,
  body: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Access-Token": token,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json() as { code: number; message: string; data: T };
  if (json.code !== 0) throw new Error(`TikTok API: ${json.message}`);
  return json.data;
}

async function tiktokGet<T>(
  path: string,
  token: string,
  params: Record<string, string> = {}
): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { "Access-Token": token },
  });
  const json = await res.json() as { code: number; message: string; data: T };
  if (json.code !== 0) throw new Error(`TikTok API: ${json.message}`);
  return json.data;
}

export interface TikTokAdAccount {
  advertiser_id: string;
  advertiser_name: string;
  currency: string;
  status: string;
}

export async function listAdAccounts(token: string): Promise<TikTokAdAccount[]> {
  const data = await tiktokGet<{ list: TikTokAdAccount[] }>(
    "/oauth2/advertiser/get/",
    token,
    { fields: '["advertiser_id","advertiser_name","currency","status"]' }
  );
  return data.list;
}

export async function createCampaign(
  advertiserId: string,
  name: string,
  objective: string,
  budgetCents: number,
  token: string
): Promise<string> {
  const data = await tiktokPost<{ campaign_id: string }>(
    "/campaign/create/",
    token,
    {
      advertiser_id: advertiserId,
      campaign_name: name,
      objective_type: objective,
      operation_status: "DISABLE",
      budget_mode: "BUDGET_MODE_TOTAL",
      budget: budgetCents / 100,
    }
  );
  return data.campaign_id;
}

export async function createAdGroup(
  advertiserId: string,
  campaignId: string,
  name: string,
  optimizationEvent: string,
  audienceType: string,
  dailyBudgetCents: number,
  token: string
): Promise<string> {
  const targeting: Record<string, unknown> = {
    location_ids: ["6252001"], // US
    age_groups: ["AGE_18_24", "AGE_25_34", "AGE_35_44", "AGE_45_54"],
    languages: ["en"],
  };

  const data = await tiktokPost<{ adgroup_id: string }>(
    "/adgroup/create/",
    token,
    {
      advertiser_id: advertiserId,
      campaign_id: campaignId,
      adgroup_name: name,
      operation_status: "DISABLE",
      placement_type: "PLACEMENT_TYPE_AUTOMATIC",
      budget_mode: "BUDGET_MODE_DAY",
      budget: dailyBudgetCents / 100,
      schedule_type: "SCHEDULE_START_END",
      schedule_start_time: new Date().toISOString().replace("T", " ").slice(0, 19),
      optimize_goal: optimizationEvent,
      billing_event: "OCPM",
      targeting,
    }
  );
  return data.adgroup_id;
}

export async function createAd(
  advertiserId: string,
  adGroupId: string,
  name: string,
  imageUrl: string,
  headline: string,
  callToAction: string,
  landingUrl: string,
  token: string
): Promise<string> {
  const data = await tiktokPost<{ ad_ids: string[] }>(
    "/ad/create/",
    token,
    {
      advertiser_id: advertiserId,
      adgroup_id: adGroupId,
      creatives: [
        {
          ad_name: name,
          ad_format: "SINGLE_IMAGE",
          image_ids: [], // uploaded separately via /file/image/ad/upload/
          ad_text: headline,
          call_to_action: callToAction,
          landing_page_url: landingUrl,
          image_url: imageUrl,
          operation_status: "DISABLE",
        },
      ],
    }
  );
  return data.ad_ids[0];
}

export interface TikTokPerformance {
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue: number;
  roas: number;
}

export async function getCampaignInsights(
  advertiserId: string,
  campaignId: string,
  token: string
): Promise<TikTokPerformance> {
  const data = await tiktokGet<{
    list: Array<{
      metrics: {
        impressions: string;
        clicks: string;
        spend: string;
        complete_payment_roas: string;
        complete_payment: string;
        total_complete_payment_rate: string;
      };
    }>;
  }>("/report/integrated/get/", token, {
    advertiser_id: advertiserId,
    report_type: "BASIC",
    dimensions: '["campaign_id"]',
    metrics: '["impressions","clicks","spend","complete_payment_roas","complete_payment"]',
    filters: JSON.stringify([{ field_name: "campaign_ids", filter_type: "IN", filter_value: JSON.stringify([campaignId]) }]),
    start_date: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
    end_date: new Date().toISOString().slice(0, 10),
  });

  const row = data.list?.[0]?.metrics;
  if (!row) return { impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0, roas: 0 };

  const spend = parseFloat(row.spend || "0");
  const roas = parseFloat(row.complete_payment_roas || "0");

  return {
    impressions: parseInt(row.impressions || "0"),
    clicks: parseInt(row.clicks || "0"),
    spend,
    conversions: parseInt(row.complete_payment || "0"),
    revenue: spend * roas,
    roas,
  };
}

export async function pauseCampaign(
  advertiserId: string,
  campaignId: string,
  token: string
): Promise<void> {
  await tiktokPost("/campaign/status/update/", token, {
    advertiser_id: advertiserId,
    campaign_ids: [campaignId],
    operation_status: "DISABLE",
  });
}

export async function activateCampaign(
  advertiserId: string,
  campaignId: string,
  token: string
): Promise<void> {
  await tiktokPost("/campaign/status/update/", token, {
    advertiser_id: advertiserId,
    campaign_ids: [campaignId],
    operation_status: "ENABLE",
  });
}
