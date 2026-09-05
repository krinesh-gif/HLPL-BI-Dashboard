import { FORECAST_ASSUMPTIONS, INVENTORY_THRESHOLDS } from '@/config/thresholds'
import { toIsoDate } from '@/lib/format'

export type RiskStatus = 'BUY_NOW' | 'PLAN_PURCHASE' | 'HEALTHY' | 'EXCESS_INVENTORY' | 'STOCK_OUT_RISK'

export interface DailyUnitsSeries {
  date: string
  units: number
}

export interface ForecastResult {
  forecastM1: number
  forecastM2: number
  forecastM3: number
  avgDailyUnits: number
  methodology: string
}

/**
 * Demand forecast per the documented methodology:
 *  - long-run average daily units over the trailing window
 *  - recent-weighted average over a shorter recent window
 *  - blended base rate = recentWeight * recent + (1-recentWeight) * long-run
 *  - applied expected growth rate compounds forward month over month
 * Seasonality is only applied when enough history exists (>= minHistoryDaysForSeasonality);
 * otherwise the blended trend average is used, which is documented in `methodology`.
 */
export function forecastDemand(series: DailyUnitsSeries[], expectedGrowthPctPerMonth = FORECAST_ASSUMPTIONS.defaultExpectedGrowthPct): ForecastResult {
  const sorted = [...series].sort((a, b) => (a.date < b.date ? -1 : 1))
  const window = sorted.slice(-FORECAST_ASSUMPTIONS.trailingWindowDays)
  const recentWindow = sorted.slice(-FORECAST_ASSUMPTIONS.recentWeightDays)

  const longRunAvg = average(window.map((d) => d.units))
  const recentAvg = average(recentWindow.map((d) => d.units))
  const hasSeasonalHistory = sorted.length >= FORECAST_ASSUMPTIONS.minHistoryDaysForSeasonality

  const blendedDaily =
    FORECAST_ASSUMPTIONS.recentWeight * recentAvg + (1 - FORECAST_ASSUMPTIONS.recentWeight) * longRunAvg

  const growthFactor = 1 + expectedGrowthPctPerMonth / 100
  const m1 = blendedDaily * 30 * growthFactor
  const m2 = m1 * growthFactor
  const m3 = m2 * growthFactor

  const methodology = hasSeasonalHistory
    ? `Blended ${FORECAST_ASSUMPTIONS.recentWeight * 100}% recent (${FORECAST_ASSUMPTIONS.recentWeightDays}-day) / ${
        (1 - FORECAST_ASSUMPTIONS.recentWeight) * 100
      }% trailing (${FORECAST_ASSUMPTIONS.trailingWindowDays}-day) average, with ${expectedGrowthPctPerMonth}% monthly growth applied. Sufficient history exists for seasonal adjustment, but no seasonal index is configured yet.`
    : `Blended ${FORECAST_ASSUMPTIONS.recentWeight * 100}% recent (${FORECAST_ASSUMPTIONS.recentWeightDays}-day) / ${
        (1 - FORECAST_ASSUMPTIONS.recentWeight) * 100
      }% trailing (${FORECAST_ASSUMPTIONS.trailingWindowDays}-day) average, with ${expectedGrowthPctPerMonth}% monthly growth applied. Insufficient history (<${FORECAST_ASSUMPTIONS.minHistoryDaysForSeasonality} days) for seasonal adjustment.`

  return { forecastM1: m1, forecastM2: m2, forecastM3: m3, avgDailyUnits: blendedDaily, methodology }
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

export interface InventoryRecommendationInput {
  currentStock: number
  avgDailyUnits: number
  forecastM1: number
  leadTimeDays: number
  safetyStock: number
}

export interface InventoryRecommendation {
  stockCoverageDays: number
  reorderDate: string | null
  recommendedPurchaseQty: number
  riskStatus: RiskStatus
}

/**
 * Reorder point = (avg daily demand * lead time) + safety stock.
 * Purchase quantity covers the next month's forecast demand plus safety
 * stock, netted against current stock — never negative.
 */
export function computeInventoryRecommendation(input: InventoryRecommendationInput, asOfDate: string): InventoryRecommendation {
  const { currentStock, avgDailyUnits, forecastM1, leadTimeDays, safetyStock } = input
  const stockCoverageDays = avgDailyUnits > 0 ? currentStock / avgDailyUnits : Number.POSITIVE_INFINITY

  const reorderPoint = avgDailyUnits * leadTimeDays + safetyStock
  const daysUntilReorderPoint = avgDailyUnits > 0 ? (currentStock - reorderPoint) / avgDailyUnits : Number.POSITIVE_INFINITY
  const reorderDate =
    Number.isFinite(daysUntilReorderPoint) && daysUntilReorderPoint > 0
      ? addDays(asOfDate, Math.round(daysUntilReorderPoint))
      : Number.isFinite(daysUntilReorderPoint)
        ? asOfDate // already at/below reorder point
        : null

  const requiredStock = forecastM1 + safetyStock
  const recommendedPurchaseQty = Math.max(0, Math.round(requiredStock - currentStock))

  let riskStatus: RiskStatus
  if (stockCoverageDays <= INVENTORY_THRESHOLDS.buyNowCoverageDays) riskStatus = 'STOCK_OUT_RISK'
  else if (stockCoverageDays <= INVENTORY_THRESHOLDS.planPurchaseCoverageDays) riskStatus = 'PLAN_PURCHASE'
  else if (stockCoverageDays >= INVENTORY_THRESHOLDS.excessInventoryCoverageDays) riskStatus = 'EXCESS_INVENTORY'
  else riskStatus = 'HEALTHY'

  // BUY_NOW overrides STOCK_OUT_RISK naming when already past the reorder point today.
  if (riskStatus === 'STOCK_OUT_RISK' && currentStock <= reorderPoint) riskStatus = 'BUY_NOW'

  return { stockCoverageDays, reorderDate, recommendedPurchaseQty, riskStatus }
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return toIsoDate(d)
}
