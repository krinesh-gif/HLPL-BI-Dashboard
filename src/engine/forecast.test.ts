import { describe, expect, it } from 'vitest'
import { computeInventoryRecommendation, forecastDemand } from './forecast'

function flatSeries(days: number, unitsPerDay: number, startDate = '2026-01-01') {
  const series = []
  const d = new Date(startDate)
  for (let i = 0; i < days; i++) {
    series.push({ date: d.toISOString().slice(0, 10), units: unitsPerDay })
    d.setDate(d.getDate() + 1)
  }
  return series
}

describe('forecastDemand', () => {
  it('projects roughly 30x the daily average for flat, no-growth demand', () => {
    const series = flatSeries(90, 10)
    const result = forecastDemand(series, 0)
    expect(result.avgDailyUnits).toBeCloseTo(10)
    expect(result.forecastM1).toBeCloseTo(300)
    expect(result.forecastM2).toBeCloseTo(300)
  })

  it('compounds growth month over month', () => {
    const series = flatSeries(90, 10)
    const result = forecastDemand(series, 10)
    expect(result.forecastM2).toBeCloseTo(result.forecastM1 * 1.1)
    expect(result.forecastM3).toBeCloseTo(result.forecastM2 * 1.1)
  })

  it('weights recent data more heavily than the long-run average', () => {
    // First 60 days at 5 units/day, most recent 28 days ramped up to 20/day.
    const series = [...flatSeries(62, 5), ...flatSeries(28, 20, '2026-03-04')]
    const result = forecastDemand(series, 0)
    expect(result.avgDailyUnits).toBeGreaterThan(10) // pulled up by recent window
    expect(result.avgDailyUnits).toBeLessThan(20) // but not fully to the recent rate
  })

  it('documents insufficient history when under the seasonality threshold', () => {
    const result = forecastDemand(flatSeries(90, 10))
    expect(result.methodology).toContain('Insufficient history')
  })
})

describe('computeInventoryRecommendation', () => {
  it('flags STOCK_OUT_RISK / BUY_NOW when coverage is below the reorder point', () => {
    const rec = computeInventoryRecommendation(
      { currentStock: 30, avgDailyUnits: 10, forecastM1: 300, leadTimeDays: 20, safetyStock: 50 },
      '2026-06-01',
    )
    expect(rec.stockCoverageDays).toBeCloseTo(3)
    expect(rec.riskStatus).toBe('BUY_NOW')
    expect(rec.recommendedPurchaseQty).toBe(320) // 300 + 50 - 30
  })

  it('flags EXCESS_INVENTORY for very high coverage', () => {
    const rec = computeInventoryRecommendation(
      { currentStock: 1500, avgDailyUnits: 10, forecastM1: 300, leadTimeDays: 20, safetyStock: 50 },
      '2026-06-01',
    )
    expect(rec.riskStatus).toBe('EXCESS_INVENTORY')
    expect(rec.recommendedPurchaseQty).toBe(0)
  })

  it('flags HEALTHY for moderate coverage and computes a future reorder date', () => {
    const rec = computeInventoryRecommendation(
      { currentStock: 500, avgDailyUnits: 10, forecastM1: 300, leadTimeDays: 20, safetyStock: 50 },
      '2026-06-01',
    )
    expect(rec.riskStatus).toBe('HEALTHY')
    expect(rec.reorderDate).not.toBeNull()
    expect(rec.reorderDate! > '2026-06-01').toBe(true)
  })
})
