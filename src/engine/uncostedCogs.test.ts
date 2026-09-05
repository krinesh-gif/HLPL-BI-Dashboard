import { describe, expect, it } from 'vitest'
import { cogsForRecords, estimateUncostedCogs } from './pnl'
import { buildChannelPnlView, type ChannelPnlViewInputs } from './channelPnlRouter'
import { buildCostIndex } from '@/data/costVersions'
import type { AmazonUsaPnlFacts, CanonicalSalesRecord, SkuMaster } from '@/data/models'

/**
 * What a SKU with no cost on file is charged.
 *
 * Amazon USA's COGS moved between ₹43 and ₹63 a unit across four months whose
 * goods had not changed. Two things were doing it, and both are covered here.
 */
const skuMaster: SkuMaster[] = [
  { sku: 'COSTED', productName: 'Costed', category: 'Hair Care', brand: 'AO', cogs: 60, mrp: 999,
    launchDate: '2025-01-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
]

function record(sku: string, qty: number, netSales: number, currency: 'INR' | 'USD'): CanonicalSalesRecord {
  return {
    orderId: `${sku}-${qty}-${netSales}`, orderDate: '2026-07-05',
    channel: currency === 'USD' ? 'amazon_us' : 'meesho',
    marketplace: currency === 'USD' ? 'amazon_us' : 'meesho',
    sellerType: 'marketplace', sku, productName: sku, category: 'Hair Care',
    quantity: qty, grossSales: netSales, discount: 0, netSales,
    returnUnits: 0, rtoUnits: 0, shippingCost: 0, marketplaceFee: 0, tax: 0,
    status: 'completed', currency, importId: 'test',
  }
}

describe('estimating the cost of a SKU that has none', () => {
  const records = [record('COSTED', 100, 1000, 'INR'), record('NO_COST', 20, 400, 'INR')]
  const result = cogsForRecords(records, skuMaster, '2026-07', { costIndex: buildCostIndex([], skuMaster) })

  it('prices the costed units properly and counts them', () => {
    expect(result.cogs).toBe(6000)
    expect(result.costedUnits).toBe(100)
    expect(result.uncostedUnits).toBe(20)
  })

  it('charges the rest at what a costed unit averaged, not at a share of its price', () => {
    // ₹60 a unit × 20 units. The old rule charged 25% of their ₹400 of sales —
    // ₹100 — which is a guess drawn from the price tag rather than the goods.
    expect(estimateUncostedCogs(result, 400)).toEqual({ amount: 1200, method: 'average-unit-cost' })
  })

  it('falls back to a share of sales only when nothing at all is costed', () => {
    const nothingCosted = cogsForRecords([record('NO_COST', 20, 400, 'INR')], skuMaster, '2026-07', {})
    expect(estimateUncostedCogs(nothingCosted, 400)).toEqual({ amount: 100, method: 'share-of-sales' })
  })

  it('charges nothing when every unit has a real cost', () => {
    const allCosted = cogsForRecords([record('COSTED', 100, 1000, 'INR')], skuMaster, '2026-07', { costIndex: buildCostIndex([], skuMaster) })
    expect(estimateUncostedCogs(allCosted, 0)).toEqual({ amount: 0, method: 'none' })
  })
})

function amazonInputs(records: CanonicalSalesRecord[], fxRate: number): ChannelPnlViewInputs {
  const facts: AmazonUsaPnlFacts = {
    month: '2026-07', schemaVersion: 2, grossSalesUsd: 5000, netSalesUsd: 5000,
    feeTotalsUsd: {}, unmappedFeeTotalsUsd: {}, nestedFeeIds: [],
    sheetCogsUsd: 0, sheetMiscCostUsd: 0, sheetNetProceedsUsd: 5000,
    referralFeeUsd: 0, fbaFulfilmentFeeUsd: 0, storageAgedDisposalUsd: 0, couponDealFeesUsd: 0,
    refundAdminFeeUsd: 0, fbaReimbursementsUsd: 0, otherAmazonFeesUsd: 0, sponsoredProductsUsd: 0,
    cogsUsd: 0, freightUsd: 0, sponsoredBrandsUsd: 0, sponsoredDisplayDspUsd: 0, offAmazonAdsUsd: 0,
    exportDocsUsd: 0, usImportDutyUsd: 0, amazonSellingPlanUsd: 0, productLiabilityInsuranceUsd: 0,
    fdaLegalUsd: 0, agencySoftwareUsd: 0, otherOverheadUsd: 0,
  }
  return {
    salesRecords: records, skuMaster, fixedExpenses: [], marketing: {},
    facts: { flipkartFacts: [], amazonUsaFacts: [facts], meeshoFacts: [] },
    cogs: { costIndex: buildCostIndex([], skuMaster), mappings: [], comboComponents: [] },
    fxRate, amazonUsaCurrency: 'USD',
  }
}

describe('Amazon USA sells in dollars and buys in rupees', () => {
  const fxRate = 95.43
  // Nothing costed, so the estimate has to fall back to a share of sales —
  // which is where the currency mismatch used to hide.
  const records = [record('NO_COST', 20, 400, 'USD')]
  const view = buildChannelPnlView('amazon_us', '2026-07', amazonInputs(records, fxRate))

  it('converts dollar sales to rupees before estimating a rupee cost', () => {
    // $400 × 95.43 × 25% = ₹9,543. The old code added $400 × 25% = 100 straight
    // onto a rupee total, so the estimate arrived 95 times too small and April's
    // ₹94,805 of estimated cost showed up as ₹993.
    expect(view.canonical.lines.cogs).toBeCloseTo(400 * fxRate * 0.25, 2)
  })

  it('names the SKUs with no cost rather than absorbing them into one figure', () => {
    expect(view.notes.some((n) => n.includes('NO_COST') && n.includes('no cost on file'))).toBe(true)
  })

  it('splits the statement into what is priced and what is estimated', () => {
    expect(view.native?.values.cogsPricedUsd).toBeCloseTo(0, 6)
    expect(view.native?.values.cogsEstimatedUsd).toBeCloseTo(-400 * 0.25, 4)
  })

  it('says so when the month has no order rows to price from', () => {
    // The statement then shows the COGS frozen at import. Saying nothing is how
    // an order-date bug that filed every month under the previous one stayed
    // invisible: the figure looked plausible and never moved.
    const none = buildChannelPnlView('amazon_us', '2026-07', amazonInputs([], fxRate))
    expect(none.notes.some((n) => n.includes('No Amazon USA order rows are on file'))).toBe(true)
  })

  it('says nothing about missing rows when they are there', () => {
    expect(view.notes.some((n) => n.includes('No Amazon USA order rows'))).toBe(false)
  })

  it('says nothing when every SKU has a cost', () => {
    const allCosted = buildChannelPnlView('amazon_us', '2026-07', amazonInputs([record('COSTED', 20, 400, 'USD')], fxRate))
    expect(allCosted.notes.some((n) => n.includes('no cost on file'))).toBe(false)
    expect(allCosted.canonical.lines.cogs).toBeCloseTo(60 * 20, 2)
  })
})
