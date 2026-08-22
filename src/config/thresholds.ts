// Configurable business-rule thresholds. Change assumptions here, not in engine code.

export const INSIGHT_THRESHOLDS = {
  revenueGrowthHighPct: 20,
  revenueDeclineHighPct: -10,
  marginDeclinePct: 2, // percentage points
  skuGrowthHighPct: 20,
  skuDeclinePct: -20,
  rtoRateHighPct: 5,
  acosHighPct: 30,
  stockCoverageLowDays: 15,
  excessStockDays: 90,
}

export const ADS_ACTION_THRESHOLDS = {
  scaleMinRoas: 4,
  scaleMinConversions: 10,
  reduceBidMaxRoas: 1.5,
  reduceBidMinSpend: 2000, // INR
  negativeKeywordMinSpend: 1000, // INR with zero orders
  pauseMinDaysPoorPerformance: 14,
  investigateDropPct: -30, // sudden ROAS deterioration vs trailing average
  protectMinRoas: 6,
  protectMinSalesShare: 0.1, // 10% of total ad-attributed sales
}

export const FORECAST_ASSUMPTIONS = {
  trailingWindowDays: 90,
  recentWeightDays: 28,
  recentWeight: 0.6, // weight given to recent trend vs long-run average
  defaultExpectedGrowthPct: 0, // used only if user hasn't set a channel/SKU growth assumption
  minHistoryDaysForSeasonality: 365,
}

export const INVENTORY_THRESHOLDS = {
  buyNowCoverageDays: 15,
  planPurchaseCoverageDays: 30,
  excessInventoryCoverageDays: 90,
}

export const FISCAL_YEAR = {
  // India FY: 1 April -> 31 March. startMonth is 0-indexed (3 = April).
  startMonth: 3,
}

export const CURRENCY = {
  primary: 'INR' as const,
  supported: ['INR', 'USD'] as const,
}
