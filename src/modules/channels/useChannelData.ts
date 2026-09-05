import { useMemo } from 'react'
import { useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import type { BusinessChannelId, SalesSourceId } from '@/config/channels'
import { channelOfSource, hasMultipleSources } from '@/config/channels'
import { addMonths, monthLabel } from '@/lib/format'
import { groupBySku, growthPct } from '@/engine/sales'
import {
  asp,
  aov,
  orderCount,
  netSalesBySource,
  netSalesForChannelMonth,
  orderBasisNetSales,
  returnPct,
  rtoPct,
} from '@/engine/netSales'
import { reconcileChannelMonth } from '@/engine/reconciliation'

const TREND_MONTHS = 6

/**
 * Operating analytics for one business channel.
 *
 * `source` narrows to a single uploaded report inside the channel — Seller
 * Central alone, for instance. Leaving it unset gives the consolidated channel,
 * which is what management sees by default.
 *
 * No P&L is built here. The channel section carries business analytics only;
 * the P&L lives in one place so a channel's numbers cannot be defined twice.
 */
export function useChannelData(channel: BusinessChannelId, source?: SalesSourceId) {
  const { salesRecords, skuMaster, flipkartFacts, amazonUsaFacts, meeshoFacts } = useDataStore()
  const { month } = useFilterStore()

  return useMemo(() => {
    const previousMonth = addMonths(month, -1)
    const channelFacts = { flipkartFacts, amazonUsaFacts, meeshoFacts }

    const inScope = (r: { channel: SalesSourceId }) =>
      source ? r.channel === source : channelOfSource(r.channel) === channel
    const channelRecordsAllTime = salesRecords.filter(inScope)
    const currentRecords = channelRecordsAllTime.filter((r) => r.orderDate.slice(0, 7) === month)

    const figureFor = (m: string) =>
      netSalesForChannelMonth({ records: salesRecords, channel, month: m, facts: channelFacts, source })

    const currentFacts = figureFor(month)
    const previousFacts = figureFor(previousMonth)

    const trend = Array.from({ length: TREND_MONTHS }).map((_, i) => {
      const m = addMonths(month, i - (TREND_MONTHS - 1))
      const facts = figureFor(m)
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

    // The breakdown that lets ₹1 Cr of Amazon India be read as ₹80 L Seller
    // Central plus ₹20 L Vendor Central. Only offered where a channel actually
    // has more than one report behind it.
    const sourceBreakdown = hasMultipleSources(channel)
      ? netSalesBySource(salesRecords, channel, month)
      : []

    return {
      month,
      channel,
      source,
      currentFacts,
      previousFacts,
      growth: growthPct(currentFacts.netSales, previousFacts.netSales),
      aov: aov(currentFacts),
      orders: orderCount(currentFacts),
      asp: asp(currentFacts) ?? 0,
      previousAsp: asp(previousFacts),
      rtoRate: rtoPct(currentFacts) ?? 0,
      returnRate: returnPct(currentFacts) ?? 0,
      basis: currentFacts.basis,
      sourceLabel: currentFacts.sourceLabel,
      // Surfaced on the channel page rather than only on the reconciliation
      // screen: a figure that is understating needs to say so where it is read.
      partialSettlementWarning: source
        ? null
        : reconcileChannelMonth(salesRecords, channel, month, channelFacts).partialSettlementWarning,
      sourceBreakdown,
      trend,
      categorySales,
      topSkus: [...skuRows].sort((a, b) => b.netSales - a.netSales).slice(0, 5),
      bottomSkus: [...skuRows].sort((a, b) => a.netSales - b.netSales).slice(0, 5),
    }
  }, [salesRecords, skuMaster, flipkartFacts, amazonUsaFacts, meeshoFacts, channel, source, month])
}
