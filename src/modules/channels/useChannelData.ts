import { useMemo } from 'react'
import { useDataStore } from '@/store/dataStore'
import { usePnlInputs } from '@/engine/usePnlInputs'
import { useFilterStore } from '@/store/filterStore'
import type { ChannelId } from '@/config/channels'
import { addMonths, monthLabel } from '@/lib/format'
import { buildChannelPnlView } from '@/engine/channelPnlRouter'
import { filterByChannel, filterByMonth, groupBySku, growthPct } from '@/engine/sales'
import { asp, aov, netSalesForChannelMonth, orderBasisNetSales, returnPct, rtoPct } from '@/engine/netSales'
import { reconcileChannelMonth } from '@/engine/reconciliation'

const TREND_MONTHS = 6

export function useChannelData(channel: ChannelId) {
  const { salesRecords, skuMaster, flipkartFacts, amazonUsaFacts, meeshoFacts } = useDataStore()
  const { forMonth } = usePnlInputs()
  const { month } = useFilterStore()

  return useMemo(() => {
    const previousMonth = addMonths(month, -1)
    const channelRecordsAllTime = filterByChannel(salesRecords, channel)

    const currentRecords = filterByMonth(channelRecordsAllTime, month)

    // Both figures come from the one central engine, so this page and the
    // channel's P&L can no longer report different Net Sales for the same month.
    const channelFacts = { flipkartFacts, amazonUsaFacts, meeshoFacts }
    const currentFacts = netSalesForChannelMonth({ records: salesRecords, channel, month, facts: channelFacts })
    const previousFacts = netSalesForChannelMonth({ records: salesRecords, channel, month: previousMonth, facts: channelFacts })

    const pnlView = buildChannelPnlView(channel, month, forMonth(month))

    const trend = Array.from({ length: TREND_MONTHS }).map((_, i) => {
      const m = addMonths(month, i - (TREND_MONTHS - 1))
      const facts = netSalesForChannelMonth({ records: salesRecords, channel, month: m, facts: channelFacts })
      return { month: monthLabel(m), netSales: facts.netSales, units: facts.units }
    })

    const categoryTotals = new Map<string, number>()
    for (const r of currentRecords) categoryTotals.set(r.category, (categoryTotals.get(r.category) ?? 0) + r.netSales)
    const categorySales = Array.from(categoryTotals.entries()).map(([name, value]) => ({ name, value }))

    const bySku = groupBySku(currentRecords)
    const skuRows = Array.from(bySku.entries()).map(([sku, records]) => {
      const facts = orderBasisNetSales(records)
      const master = skuMaster.find((s) => s.sku === sku)
      return { sku, productName: master?.productName ?? sku, netSales: facts.netSales, units: facts.units }
    })
    const topSkus = [...skuRows].sort((a, b) => b.netSales - a.netSales).slice(0, 5)
    const bottomSkus = [...skuRows].sort((a, b) => a.netSales - b.netSales).slice(0, 5)

    return {
      month,
      currentFacts,
      previousFacts,
      growth: growthPct(currentFacts.netSales, previousFacts.netSales),
      aov: aov(currentFacts) ?? 0,
      // ASP is Net Sales per unit. It read gross per unit before, which quietly
      // overstated it by the whole discount and return load.
      asp: asp(currentFacts) ?? 0,
      previousAsp: asp(previousFacts),
      rtoRate: rtoPct(currentFacts) ?? 0,
      returnRate: returnPct(currentFacts) ?? 0,
      basis: currentFacts.basis,
      sourceLabel: currentFacts.sourceLabel,
      // Surfaced on the channel page rather than only on the reconciliation
      // screen: a figure that is understating needs to say so where it is read.
      partialSettlementWarning: reconcileChannelMonth(salesRecords, channel, month, channelFacts)
        .partialSettlementWarning,
      pnl: pnlView.canonical,
      native: pnlView.native,
      trend,
      categorySales,
      topSkus,
      bottomSkus,
    }
  }, [salesRecords, skuMaster, flipkartFacts, amazonUsaFacts, meeshoFacts, forMonth, channel, month])
}
