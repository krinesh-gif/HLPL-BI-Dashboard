import { useMemo } from 'react'
import { useDataStore } from '@/store/dataStore'
import { buildCostIndex } from '@/data/costVersions'
import { marketingFromAds } from '@/engine/marketing'
import type { ChannelPnlViewInputs } from '@/engine/channelPnlRouter'

/**
 * Assembles everything a P&L needs, in one place.
 *
 * Five screens build a P&L — Overview, the channel dashboards, Master P&L,
 * Channel P&L and the Investor MIS — and each used to assemble its own inputs
 * by hand. That is how the app ended up costing some screens differently from
 * others: adding effective-dated costs or combo recipes to four call sites and
 * missing the fifth leaves one screen quietly reporting a different margin.
 *
 * Marketing is per-month, so it is returned as a function of the month rather
 * than baked in — the MIS builds twelve months at once.
 */
export function usePnlInputs(): {
  inputs: Omit<ChannelPnlViewInputs, 'marketing'>
  forMonth: (month: string) => ChannelPnlViewInputs
} {
  const {
    salesRecords, adsRecords, skuMaster, fixedExpenses,
    flipkartFacts, amazonUsaFacts, meeshoFacts,
    costVersions, mappings, comboComponents, manualAdSpend,
  } = useDataStore()

  return useMemo(() => {
    const inputs: Omit<ChannelPnlViewInputs, 'marketing'> = {
      salesRecords,
      skuMaster,
      fixedExpenses,
      facts: { flipkartFacts, amazonUsaFacts, meeshoFacts },
      cogs: {
        // Costs resolve per month, so a closed month keeps the cost it was
        // closed at however many times the cost has changed since.
        costIndex: buildCostIndex(costVersions, skuMaster),
        mappings,
        comboComponents,
      },
    }

    return {
      inputs,
      forMonth: (month: string) => ({ ...inputs, marketing: marketingFromAds(adsRecords, month, manualAdSpend) }),
    }
  }, [
    salesRecords, adsRecords, skuMaster, fixedExpenses,
    flipkartFacts, amazonUsaFacts, meeshoFacts,
    costVersions, mappings, comboComponents, manualAdSpend,
  ])
}
