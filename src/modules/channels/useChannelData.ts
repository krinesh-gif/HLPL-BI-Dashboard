import { useMemo } from 'react'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import type { ChannelId } from '@/config/channels'
import { addMonths, monthLabel } from '@/lib/format'
import { buildChannelPnl } from '@/engine/pnl'
import { marketingFromAds } from '@/engine/marketing'
import { filterByChannel, filterByMonth, groupBySku, growthPct, sumFacts } from '@/engine/sales'

const TREND_MONTHS = 6

export function useChannelData(channel: ChannelId) {
  const { salesRecords, adsRecords, skuMaster, fixedExpenses } = useDataStore()
  const { month } = useFilterStore()

  return useMemo(() => {
    const previousMonth = addMonths(month, -1)
    const channelRecordsAllTime = filterByChannel(salesRecords, channel)

    const currentRecords = filterByMonth(channelRecordsAllTime, month)
    const previousRecords = filterByMonth(channelRecordsAllTime, previousMonth)
    const currentFacts = sumFacts(currentRecords)
    const previousFacts = sumFacts(previousRecords)

    const marketing = marketingFromAds(adsRecords, month)
    const pnl = buildChannelPnl(salesRecords, skuMaster, fixedExpenses, channel, month, marketing)

    const trend = Array.from({ length: TREND_MONTHS }).map((_, i) => {
      const m = addMonths(month, i - (TREND_MONTHS - 1))
      const facts = sumFacts(filterByMonth(channelRecordsAllTime, m))
      return { month: monthLabel(m), netSales: facts.netSales, units: facts.quantity }
    })

    const categoryTotals = new Map<string, number>()
    for (const r of currentRecords) categoryTotals.set(r.category, (categoryTotals.get(r.category) ?? 0) + r.netSales)
    const categorySales = Array.from(categoryTotals.entries()).map(([name, value]) => ({ name, value }))

    const bySku = groupBySku(currentRecords)
    const skuRows = Array.from(bySku.entries()).map(([sku, records]) => {
      const facts = sumFacts(records)
      const master = skuMaster.find((s) => s.sku === sku)
      return { sku, productName: master?.productName ?? sku, netSales: facts.netSales, units: facts.quantity }
    })
    const topSkus = [...skuRows].sort((a, b) => b.netSales - a.netSales).slice(0, 5)
    const bottomSkus = [...skuRows].sort((a, b) => a.netSales - b.netSales).slice(0, 5)

    return {
      month,
      currentFacts,
      previousFacts,
      growth: growthPct(currentFacts.netSales, previousFacts.netSales),
      aov: currentFacts.orders > 0 ? currentFacts.netSales / currentFacts.orders : 0,
      asp: currentFacts.quantity > 0 ? currentFacts.grossSales / currentFacts.quantity : 0,
      rtoRate: currentFacts.quantity > 0 ? (currentFacts.rtoUnits / currentFacts.quantity) * 100 : 0,
      returnRate: currentFacts.quantity > 0 ? (currentFacts.returnUnits / currentFacts.quantity) * 100 : 0,
      pnl,
      trend,
      categorySales,
      topSkus,
      bottomSkus,
    }
  }, [salesRecords, adsRecords, skuMaster, fixedExpenses, channel, month])
}
