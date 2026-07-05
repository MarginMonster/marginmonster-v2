// Meta Marketing API client (Graph API v20.0)
// All campaign creates are PAUSED — nothing spends until explicitly activated.

const META_API_VERSION = "v20.0";
const BASE = `https://graph.facebook.com/${META_API_VERSION}`;

async function metaGet<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  const json = await res.json() as { error?: { message: string } } & T;
  if (json.error) throw new Error(`Meta API: ${json.error.message}`);
  return json;
}

async function metaPost<T>(path: string, token: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}${path}?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json() as { error?: { message: string } } & T;
  if (json.error) throw new Error(`Meta API: ${(json.error as { message: string }).message}`);
  return json;
}

export interface MetaAdAccount {
  id: string;
  name: string;
  currency: string;
  account_status: number;
}

export async function listAdAccounts(userToken: string): Promise<MetaAdAccount[]> {
  const data = await metaGet<{ data: MetaAdAccount[] }>(
    "/me/adaccounts",
    userToken,
    { fields: "id,name,currency,account_status" }
  );
  return data.data;
}

export interface CreateCampaignParams {
  adAccountId: string;
  name: string;
  objective: string;
  budgetCents: number; // lifetime budget in cents
  token: string;
}

export async function createCampaign(params: CreateCampaignParams): Promise<string> {
  const { adAccountId, name, objective, budgetCents, token } = params;
  const data = await metaPost<{ id: string }>(
    `/act_${adAccountId.replace("act_", "")}/campaigns`,
    token,
    {
      name,
      objective,
      status: "PAUSED",
      special_ad_categories: [],
      lifetime_budget: budgetCents,
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    }
  );
  return data.id;
}

export interface CreateAdSetParams {
  adAccountId: string;
  campaignId: string;
  name: string;
  optimizationGoal: string;
  billingEvent: string;
  audienceStrategy: string;
  token: string;
  dailyBudgetCents: number;
}

export async function createAdSet(params: CreateAdSetParams): Promise<string> {
  const { adAccountId, campaignId, name, optimizationGoal, billingEvent, token, dailyBudgetCents } = params;

  // Audience targeting — simplified defaults; real implementation would
  // use Custom Audiences for warm retargeting or interest stacks for cold
  const targeting: Record<string, unknown> = {
    geo_locations: { countries: ["US"] },
    age_min: 18,
    age_max: 65,
  };

  const data = await metaPost<{ id: string }>(
    `/act_${adAccountId.replace("act_", "")}/adsets`,
    token,
    {
      name,
      campaign_id: campaignId,
      optimization_goal: optimizationGoal,
      billing_event: billingEvent,
      bid_amount: null,
      daily_budget: dailyBudgetCents,
      targeting,
      status: "PAUSED",
      start_time: Math.floor(Date.now() / 1000),
    }
  );
  return data.id;
}

export interface CreateAdParams {
  adAccountId: string;
  adSetId: string;
  name: string;
  pageId: string;
  imageUrl: string;
  headline: string;
  primaryText: string;
  cta: string;
  linkUrl: string;
  token: string;
}

export async function createAd(params: CreateAdParams): Promise<string> {
  const { adAccountId, adSetId, name, pageId, imageUrl, headline, primaryText, cta, linkUrl, token } = params;

  const adCreative = await metaPost<{ id: string }>(
    `/act_${adAccountId.replace("act_", "")}/adcreatives`,
    token,
    {
      name: `${name} creative`,
      object_story_spec: {
        page_id: pageId,
        link_data: {
          image_url: imageUrl,
          link: linkUrl,
          message: primaryText,
          name: headline,
          call_to_action: { type: cta.toUpperCase().replace(/ /g, "_") },
        },
      },
    }
  );

  const ad = await metaPost<{ id: string }>(
    `/act_${adAccountId.replace("act_", "")}/ads`,
    token,
    {
      name,
      adset_id: adSetId,
      creative: { creative_id: adCreative.id },
      status: "PAUSED",
    }
  );

  return ad.id;
}

export interface CampaignPerformance {
  impressions: number;
  clicks: number;
  spend: number; // dollars
  conversions: number;
  revenue: number;
  roas: number;
}

export async function getCampaignInsights(
  campaignId: string,
  token: string
): Promise<CampaignPerformance> {
  const data = await metaGet<{
    data: Array<{
      impressions: string;
      clicks: string;
      spend: string;
      actions?: Array<{ action_type: string; value: string }>;
      action_values?: Array<{ action_type: string; value: string }>;
    }>;
  }>(
    `/${campaignId}/insights`,
    token,
    {
      fields: "impressions,clicks,spend,actions,action_values",
      date_preset: "last_7d",
    }
  );

  const row = data.data[0];
  if (!row) return { impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0, roas: 0 };

  const purchases = row.actions?.find((a) => a.action_type === "purchase");
  const revenue = row.action_values?.find((a) => a.action_type === "purchase");
  const spend = parseFloat(row.spend || "0");
  const rev = parseFloat(revenue?.value || "0");

  return {
    impressions: parseInt(row.impressions || "0"),
    clicks: parseInt(row.clicks || "0"),
    spend,
    conversions: parseInt(purchases?.value || "0"),
    revenue: rev,
    roas: spend > 0 ? rev / spend : 0,
  };
}

export async function pauseCampaign(campaignId: string, token: string): Promise<void> {
  await metaPost(`/${campaignId}`, token, { status: "PAUSED" });
}

export async function activateCampaign(campaignId: string, token: string): Promise<void> {
  await metaPost(`/${campaignId}`, token, { status: "ACTIVE" });
}

export async function updateCampaignBudget(
  campaignId: string,
  newLifetimeBudgetCents: number,
  token: string
): Promise<void> {
  await metaPost(`/${campaignId}`, token, {
    lifetime_budget: newLifetimeBudgetCents,
  });
}
