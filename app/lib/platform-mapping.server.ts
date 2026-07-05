// Maps each goal-based plan to platform-specific campaign dials.
// This is the decisioning layer config — same engine, different parameters.

export interface PlatformConfig {
  meta: MetaCampaignConfig;
  tiktok: TikTokCampaignConfig;
}

export interface MetaCampaignConfig {
  objective: string;
  optimizationGoal: string;
  billingEvent: string;
  audienceStrategy: "warm_retargeting" | "cold_interest" | "broad";
  // Kill after spending this fraction of weekly budget with ROAS below minRoas
  killAfterSpendFraction: number;
  minRoasToSurvive: number;
  // Scale winning ads by this multiplier when ROAS exceeds minRoas
  scaleIncrementPct: number;
  budgetPacing: "conservative" | "front_loaded" | "aggressive" | "even";
}

export interface TikTokCampaignConfig {
  objective: string;
  optimizationEvent: string;
  audienceType: "retargeting" | "interest" | "broad";
  killAfterSpendFraction: number;
  minRoasToSurvive: number;
  scaleIncrementPct: number;
  budgetPacing: "conservative" | "front_loaded" | "aggressive" | "even";
}

const PLAN_CONFIGS: Record<string, PlatformConfig> = {
  GROW_SALES: {
    meta: {
      objective: "OUTCOME_SALES",
      optimizationGoal: "OFFSITE_CONVERSIONS",
      billingEvent: "IMPRESSIONS",
      audienceStrategy: "warm_retargeting",
      killAfterSpendFraction: 0.3,
      minRoasToSurvive: 2.0,
      scaleIncrementPct: 0.2,
      budgetPacing: "conservative",
    },
    tiktok: {
      objective: "CONVERSIONS",
      optimizationEvent: "PURCHASE",
      audienceType: "retargeting",
      killAfterSpendFraction: 0.3,
      minRoasToSurvive: 2.0,
      scaleIncrementPct: 0.2,
      budgetPacing: "conservative",
    },
  },

  LAUNCH_PRODUCT: {
    meta: {
      objective: "OUTCOME_SALES",
      optimizationGoal: "ADD_TO_CART",
      billingEvent: "IMPRESSIONS",
      audienceStrategy: "cold_interest",
      killAfterSpendFraction: 0.5,
      minRoasToSurvive: 1.5,
      scaleIncrementPct: 0.3,
      budgetPacing: "front_loaded",
    },
    tiktok: {
      objective: "CONVERSIONS",
      optimizationEvent: "ADD_TO_CART",
      audienceType: "interest",
      killAfterSpendFraction: 0.5,
      minRoasToSurvive: 1.5,
      scaleIncrementPct: 0.3,
      budgetPacing: "front_loaded",
    },
  },

  CLEAR_INVENTORY: {
    meta: {
      objective: "OUTCOME_SALES",
      optimizationGoal: "OFFSITE_CONVERSIONS",
      billingEvent: "IMPRESSIONS",
      audienceStrategy: "warm_retargeting",
      killAfterSpendFraction: 0.4,
      minRoasToSurvive: 1.5,
      scaleIncrementPct: 0.15,
      budgetPacing: "aggressive",
    },
    tiktok: {
      objective: "CONVERSIONS",
      optimizationEvent: "PURCHASE",
      audienceType: "retargeting",
      killAfterSpendFraction: 0.4,
      minRoasToSurvive: 1.5,
      scaleIncrementPct: 0.15,
      budgetPacing: "aggressive",
    },
  },

  BUILD_AWARENESS: {
    meta: {
      objective: "OUTCOME_AWARENESS",
      optimizationGoal: "REACH",
      billingEvent: "IMPRESSIONS",
      audienceStrategy: "broad",
      // Awareness campaigns aren't ROAS-gated — kill only on CPM threshold
      killAfterSpendFraction: 1.0,
      minRoasToSurvive: 0,
      scaleIncrementPct: 0.1,
      budgetPacing: "even",
    },
    tiktok: {
      objective: "REACH",
      optimizationEvent: "REACH",
      audienceType: "broad",
      killAfterSpendFraction: 1.0,
      minRoasToSurvive: 0,
      scaleIncrementPct: 0.1,
      budgetPacing: "even",
    },
  },
};

export function getPlatformConfig(planType: string): PlatformConfig {
  return PLAN_CONFIGS[planType] || PLAN_CONFIGS.GROW_SALES;
}
