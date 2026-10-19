import { useMemo } from 'react'
import { useDataStore } from '@/store/dataStore'
import { buildCostIndex } from '@/data/costVersions'
import { fxRatesForMonth } from '@/data/fxRates'
import { freightRateValue } from '@/data/freightRates'
import { packagingRateValue } from '@/data/packagingRates'
import { nykaaDiscountForMonth } from '@/data/nykaaDiscounts'
import { marketingFromAds } from '@/engine/marketing'
import type { ChannelFactsStore, ChannelPnlViewInputs } from '@/engine/channelPnlRouter'

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
    salesRecords, adsRecords, skuMaster, fixedExpenses, channelCharges,
    flipkartFacts, amazonUsaFacts, meeshoFacts, myntraFacts, nykaaFacts, amazonInSellerFacts, blinkitFacts,
    amazonAeFacts, purplleFacts, swiggyInstamartFacts, amazonInVendorFacts, amazonInSkuFeeFacts,
    costVersions, mappings, comboComponents, manualAdSpend, fxRates, freightRates, packagingRates, nykaaDiscounts,
  } = useDataStore()

  return useMemo(() => {
    const inputs: Omit<ChannelPnlViewInputs, 'marketing'> = {
      salesRecords,
      skuMaster,
      fixedExpenses,
      // Charged whole to their own channel rather than shared out, which is
      // the one thing that makes them different from the line above.
      channelCharges,
      // Every channel that has a statement of its own, and the type says so:
      // `Required` makes a channel added to the store and forgotten here a
      // compile error. Left optional it is silent — the router falls back to
      // the generic order-row template and the statement simply never
      // appears, which happened to Amazon UAE once and to Vendor Central
      // again.
      facts: {
        flipkartFacts,
        amazonUsaFacts,
        meeshoFacts,
        myntraFacts: myntraFacts ?? [],
        nykaaFacts: nykaaFacts ?? [],
        amazonInSellerFacts: amazonInSellerFacts ?? [],
        amazonInVendorFacts: amazonInVendorFacts ?? [],
        amazonInSkuFeeFacts: amazonInSkuFeeFacts ?? [],
        blinkitFacts: blinkitFacts ?? [],
        amazonAeFacts: amazonAeFacts ?? [],
        purplleFacts: purplleFacts ?? [],
        swiggyInstamartFacts: swiggyInstamartFacts ?? [],
      } satisfies Required<ChannelFactsStore>,
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
      // The FX rate is per month for the same reason costs are: Amazon USA is
      // priced in dollars, so a closed month must keep the rate it was closed
      // on rather than being restated whenever this month's rate is entered.
      forMonth: (month: string) => ({
        ...inputs,
        // The month's rates reach the marketing roll-up too: an advertising
        // account billed in dirhams or dollars is converted on the way in.
        marketing: marketingFromAds(adsRecords, month, manualAdSpend, fxRatesForMonth(month, fxRates)),
        fxRate: fxRatesForMonth(month, fxRates),
        freightPerUnitInr: freightRateValue(month, freightRates, 'india_usa'),
        nykaaFreightPerUnitInr: freightRateValue(month, freightRates, 'nykaa_inbound'),
        packagingPerShipmentInr: packagingRateValue(month, packagingRates),
        confirmedNykaaDiscount: nykaaDiscountForMonth(month, nykaaDiscounts)?.amountInr,
      }),
    }
  }, [
    salesRecords, adsRecords, skuMaster, fixedExpenses, channelCharges,
    flipkartFacts, amazonUsaFacts, meeshoFacts, myntraFacts, nykaaFacts, amazonInSellerFacts, blinkitFacts,
    amazonAeFacts, purplleFacts, swiggyInstamartFacts, amazonInVendorFacts, amazonInSkuFeeFacts,
    costVersions, mappings, comboComponents, manualAdSpend, fxRates, freightRates, packagingRates, nykaaDiscounts,
  ])
}
