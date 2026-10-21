import { useMemo } from 'react'
import { BUSINESS_CHANNEL_IDS } from '@/config/channels'
import { buildAllChannelPnlViews } from '@/engine/channelPnlRouter'
import { buildMonthlyClose, type MonthlyClose } from '@/engine/monthlyClose'
import { usePnlInputs } from '@/engine/usePnlInputs'
import { fxRateForMonth } from '@/data/fxRates'
import { freightRateForMonth } from '@/data/freightRates'
import { packagingRateForMonth } from '@/data/packagingRates'
import { nykaaDiscountForMonth } from '@/data/nykaaDiscounts'
import { productLabelResolver } from '@/data/productLabel'
import { addMonths } from '@/lib/format'
import { statementMonths, useDataStore } from '@/store/dataStore'
import { useFilterStore } from '@/store/filterStore'
import { useSkuCostValidation } from '@/modules/products/useSkuCostValidation'

/**
 * The close check for the month on screen.
 *
 * Built from the same P&L views the statements are built from, so what the
 * check says about a month and what the month shows can never drift apart.
 */
export function useMonthlyClose(month?: string): MonthlyClose & { monthOptions: string[] } {
  const store = useDataStore()
  const { month: filterMonth } = useFilterStore()
  const { forMonth } = usePnlInputs()
  const catalogue = useSkuCostValidation()

  const active = month ?? filterMonth
  const monthOptions = useMemo(() => statementMonths(store), [store])

  return useMemo(() => {
    const viewsFor = (m: string) =>
      buildAllChannelPnlViews(BUSINESS_CHANNEL_IDS, m, { ...forMonth(m), currencyView: 'INR' })
    const label = productLabelResolver({
      skuMaster: store.skuMaster, mappings: store.mappings, comboComponents: store.comboComponents,
    })

    const close = buildMonthlyClose({
      month: active,
      views: viewsFor(active),
      previousViews: viewsFor(addMonths(active, -1)),
      salesRecords: store.salesRecords,
      fixedExpenses: store.fixedExpenses,
      nykaaFacts: store.nykaaFacts ?? [],
      has: {
        fxUsd: fxRateForMonth(active, store.fxRates).entered,
        fxAed: fxRateForMonth(active, store.fxRates, 'AEDINR').entered,
        freightIndiaUsa: freightRateForMonth(active, store.freightRates, 'india_usa').entered,
        freightIndiaUae: freightRateForMonth(active, store.freightRates, 'india_uae').entered,
        nykaaInboundFreight: freightRateForMonth(active, store.freightRates, 'nykaa_inbound').entered,
        packaging: packagingRateForMonth(active, store.packagingRates).entered,
        nykaaConfirmedDiscount: nykaaDiscountForMonth(active, store.nykaaDiscounts) !== undefined,
      },
      catalogue: {
        unpricedSkus: catalogue.unmappedSkus.length,
        unpricedNetSales: catalogue.unmappedNetSales,
        totalNetSales: catalogue.totalNetSales,
        missingGstSkus: catalogue.missingGstSkus.length,
      },
      productName: (sku, fallback) => label(sku, fallback).title,
    })

    return { ...close, monthOptions: monthOptions.length > 0 ? monthOptions : [active] }
  }, [store, forMonth, catalogue, active, monthOptions])
}
