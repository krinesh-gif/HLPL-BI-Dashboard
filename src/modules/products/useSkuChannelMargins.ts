import { useMemo } from 'react'
import { statementMonths, useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { BUSINESS_CHANNEL_IDS, type BusinessChannelId } from '@/config/channels'
import { buildAllChannelPnlViews } from '@/engine/channelPnlRouter'
import { usePnlInputs } from '@/engine/usePnlInputs'
import { fxRatesForMonth } from '@/data/fxRates'
import { buildSkuChannelMargins, type SkuChannelMarginResult } from '@/engine/skuChannelMargin'

/**
 * The month's products, down the margin ladder, per channel.
 *
 * The fee and ad totals come out of the very same channel views the Channel
 * P&L screen is built from, rather than being summed again here. Two reports
 * that add up the same statement in two places is how one meeting ends up
 * with two numbers for one month, and this screen exists to be argued with —
 * so it has to tie to the statement exactly.
 */
export function useSkuChannelMargins(): SkuChannelMarginResult & { month: string; monthsWithData: string[] } {
  const store = useDataStore()
  const { month } = useFilterStore()
  const { forMonth } = usePnlInputs()
  const monthsWithData = useMemo(() => statementMonths(store), [store])

  return useMemo(() => {
    const views = buildAllChannelPnlViews(BUSINESS_CHANNEL_IDS, month, {
      ...forMonth(month),
      // Rupees. Products from four channels are ranked against each other in
      // one list, so a dollar row in it would sort above everything.
      currencyView: 'INR' as const,
      amazonInHalf: 'both' as const,
    })

    const channelFees: Partial<Record<BusinessChannelId, number>> = {}
    const channelAds: Partial<Record<BusinessChannelId, number>> = {}
    // The revenue each channel's own statement claims. On a wholesale channel
    // — Nykaa, Amazon Vendor — this is the figure that matters: the order
    // rows there are written at MRP and are not revenue at all.
    const channelNetSales: Partial<Record<BusinessChannelId, number>> = {}
    for (const v of views) {
      const l = v.canonical.lines
      if (l.netSales !== undefined) channelNetSales[v.channel] = l.netSales
      channelFees[v.channel] =
        (l.marketplaceCommission ?? 0) + (l.fulfilment ?? 0) + (l.shipping ?? 0) +
        (l.collectionFees ?? 0) + (l.rtoCharges ?? 0) + (l.returnCharges ?? 0) +
        (l.otherMarketplaceCharges ?? 0)
      channelAds[v.channel] = (l.ads ?? 0) + (l.performanceMarketing ?? 0) + (l.otherMarketing ?? 0)
    }

    return {
      ...buildSkuChannelMargins(month, {
        salesRecords: store.salesRecords,
        skuMaster: store.skuMaster,
        adsRecords: store.adsRecords,
        cogs: {
          costIndex: forMonth(month).cogs?.costIndex,
          mappings: store.mappings,
          comboComponents: store.comboComponents,
        },
        fx: fxRatesForMonth(month, store.fxRates),
        channelFees,
        channelAds,
        channelNetSales,
      }),
      month,
      monthsWithData,
    }
  }, [store, month, forMonth, monthsWithData])
}
