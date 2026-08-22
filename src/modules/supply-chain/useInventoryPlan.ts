import { useMemo } from 'react'
import { useDataStore } from '@/store/dataStore'
import { computeInventoryRecommendation, forecastDemand, type RiskStatus } from '@/engine/forecast'

export interface InventoryPlanRow {
  sku: string
  productName: string
  currentStock: number
  avgMonthlySales: number
  forecastM1: number
  forecastM2: number
  forecastM3: number
  leadTimeDays: number
  safetyStock: number
  stockCoverageDays: number
  recommendedPurchaseQty: number
  recommendedPurchaseDate: string | null
  riskStatus: RiskStatus
  methodology: string
  cogs: number
}

export function useInventoryPlan(): InventoryPlanRow[] {
  const { skuMaster, salesRecords, inventorySnapshots } = useDataStore()

  return useMemo(() => {
    return skuMaster.map((sku) => {
      const snapshot = inventorySnapshots.find((i) => i.sku === sku.sku)
      const asOfDate = snapshot?.asOfDate ?? new Date().toISOString().slice(0, 10)

      const byDay = new Map<string, number>()
      for (const r of salesRecords) {
        if (r.sku !== sku.sku || r.orderDate > asOfDate) continue
        byDay.set(r.orderDate, (byDay.get(r.orderDate) ?? 0) + r.quantity)
      }
      const series = Array.from(byDay.entries())
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, units]) => ({ date, units }))

      const forecast = forecastDemand(series)
      const recommendation = computeInventoryRecommendation(
        {
          currentStock: snapshot?.currentStock ?? 0,
          avgDailyUnits: forecast.avgDailyUnits,
          forecastM1: forecast.forecastM1,
          leadTimeDays: sku.leadTimeDays,
          safetyStock: sku.safetyStock,
        },
        asOfDate,
      )

      return {
        sku: sku.sku,
        productName: sku.productName,
        currentStock: snapshot?.currentStock ?? 0,
        avgMonthlySales: forecast.avgDailyUnits * 30,
        forecastM1: forecast.forecastM1,
        forecastM2: forecast.forecastM2,
        forecastM3: forecast.forecastM3,
        leadTimeDays: sku.leadTimeDays,
        safetyStock: sku.safetyStock,
        stockCoverageDays: recommendation.stockCoverageDays,
        recommendedPurchaseQty: recommendation.recommendedPurchaseQty,
        recommendedPurchaseDate: recommendation.reorderDate,
        riskStatus: recommendation.riskStatus,
        methodology: forecast.methodology,
        cogs: sku.cogs,
      }
    })
  }, [skuMaster, salesRecords, inventorySnapshots])
}
