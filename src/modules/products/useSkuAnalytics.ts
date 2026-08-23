import { useMemo } from 'react'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { addMonths } from '@/lib/format'
import { filterByMonth, groupBySku, growthPct } from '@/engine/sales'
import { orderBasisNetSales } from '@/engine/netSales'

export type SkuGrowthBucket = 'fast-growing' | 'stable' | 'declining' | 'high-volume-declining' | 'low-volume-high-growth' | 'zero-sales'

export interface SkuAnalyticsRow {
  sku: string
  productName: string
  category: string
  currentUnits: number
  previousUnits: number
  currentNetSales: number
  unitGrowthPct: number | null
  revenueGrowthPct: number | null
  bucket: SkuGrowthBucket
}

function classify(currentUnits: number, growth: number | null): SkuGrowthBucket {
  if (currentUnits === 0) return 'zero-sales'
  if (growth === null) return 'stable'
  if (growth >= 20) return currentUnits >= 100 ? 'fast-growing' : 'low-volume-high-growth'
  if (growth <= -20) return currentUnits >= 100 ? 'high-volume-declining' : 'declining'
  return 'stable'
}

export function useSkuAnalytics(): SkuAnalyticsRow[] {
  const { salesRecords, skuMaster } = useDataStore()
  const { month, category } = useFilterStore()

  return useMemo(() => {
    const previousMonth = addMonths(month, -1)
    const currentBySku = groupBySku(filterByMonth(salesRecords, month))
    const previousBySku = groupBySku(filterByMonth(salesRecords, previousMonth))

    return skuMaster
      .filter((s) => category === 'all' || s.category === category)
      .map((s) => {
        const currentFacts = orderBasisNetSales(currentBySku.get(s.sku) ?? [])
        const previousFacts = orderBasisNetSales(previousBySku.get(s.sku) ?? [])
        const unitGrowthPct = growthPct(currentFacts.units, previousFacts.units)
        const revenueGrowthPct = growthPct(currentFacts.netSales, previousFacts.netSales)

        return {
          sku: s.sku,
          productName: s.productName,
          category: s.category,
          currentUnits: currentFacts.units,
          previousUnits: previousFacts.units,
          currentNetSales: currentFacts.netSales,
          unitGrowthPct,
          revenueGrowthPct,
          bucket: classify(currentFacts.units, unitGrowthPct),
        }
      })
  }, [salesRecords, skuMaster, month, category])
}
