import { describe, expect, it } from 'vitest'
import {
  AMAZON_IN_SELLER_EXPORT_LINE_DEFS,
  amazonInSellerExportLineDefs,
  amazonInSellerExportToCanonicalBuckets,
  applyAmazonInSellerExportOtherCosts,
  computeAmazonInSellerExportPnl,
  type SellerExportCogs,
} from './amazonInSellerExport'
import { computeSubtotals } from '../pnl'
import type { AmazonInSkuFeeFacts } from '@/data/models'

/**
 * September 2026 exactly as the stored export reads, fee column by fee column.
 * The figures are the owner's own: ₹2,34,275.02 sold, ₹2,23,113.63 net of
 * returns, and ₹64,498.25 of Amazon charges against Amazon's own Net proceeds
 * of ₹1,57,562.82 — which do not quite meet, and the statement says so.
 */
const SEPTEMBER: AmazonInSkuFeeFacts = {
  month: '2026-09', schemaVersion: 1,
  grossSalesInr: 234275.02, netSalesInr: 223113.63,
  unitsSoldQty: 461, unitsReturnedQty: 23, netUnitsSoldQty: 438,
  sheetNetProceedsInr: 157562.82, sheetCogsInr: 0, sheetMiscCostInr: 0,
  nonSellingChargedRows: 1,
  // 'baseFulfillmentFee' repeats what 'fbaFulfillmentFees' already charges —
  // the file proved it row by row, which is what nestedFeeIds records.
  nestedFeeIds: ['baseFulfillmentFee', 'fuelLogisticsSurcharge', 'lowInventoryLevelFee'],
  feeTotalsInr: {
    referralFee: 19028.21,
    referralFeeRefunds: -921.66,
    fbaFulfillmentFees: 2607.8,
    baseFulfillmentFee: 2607.8,
    fbaWeightHandlingFee: 6110.04,
    manufacturerFulfilledPostageFee: 23589.38,
    sponsoredProductsCharge: 0,
  },
  unmappedFeeTotalsInr: { ' total': 14084.48 },
  feeBySkuInr: { 'AO-SKU-1': { referralFee: 19028.21 }, 'AO-SKU-2': { fbaWeightHandlingFee: 6110.04 } },
  unitsBySku: { 'AO-SKU-1': 400, 'AO-SKU-2': 38 },
  netSalesBySku: { 'AO-SKU-1': 200000, 'AO-SKU-2': 23113.63 },
}

/** What the fees come to with the contained column left to its parent. */
const FEES = 19028.21 - 921.66 + 2607.8 + 6110.04 + 23589.38 + 14084.48

const COGS: SellerExportCogs = {
  priced: 50000, unpriced: 5000, uncostedSkus: 1, uncostedUnits: 38, estimatedWholeMonth: false,
}

describe('computeAmazonInSellerExportPnl', () => {
  it('reads the month the export states', () => {
    const v = computeAmazonInSellerExportPnl(SEPTEMBER)
    expect(v.grossSales).toBeCloseTo(234275.02, 2)
    expect(v.returns).toBeCloseTo(-(234275.02 - 223113.63), 2)
    expect(v.netSales).toBeCloseTo(223113.63, 2)
    expect(v.unitsSold).toBe(461)
    expect(v.netUnitsSold).toBe(438)
  })

  // The month is a ₹2.23 lakh one. Read from the two settlement periods that
  // had been uploaded it was ₹8,343 on 15 units.
  it('charges every fee column the export carries, once', () => {
    const v = computeAmazonInSellerExportPnl(SEPTEMBER)
    expect(v.totalMarketplaceCharges).toBeCloseTo(-FEES, 2)
    expect(v['fee.referralFee']).toBeCloseTo(-19028.21, 2)
    // A refund is money coming back, so it reads as a credit rather than
    // being added to what Amazon took.
    expect(v['fee.referralFeeRefunds']).toBeCloseTo(921.66, 2)
    expect(v.cm1).toBeCloseTo(223113.63 - FEES, 2)
  })

  it('leaves a contained column to its parent instead of charging it twice', () => {
    const v = computeAmazonInSellerExportPnl(SEPTEMBER)
    // Shown in full on its own line...
    expect(v['fee.baseFulfillmentFee']).toBeCloseTo(-2607.8, 2)
    // ...and under the column that already includes it, so it is never summed.
    const def = amazonInSellerExportLineDefs(SEPTEMBER).find((d) => d.key === 'fee.baseFulfillmentFee')
    expect(def?.memoOf).toBe('fee.fbaFulfillmentFees')
    // The total counts the parent once, not both.
    expect(v.totalMarketplaceCharges).toBeCloseTo(-FEES, 2)
  })

  it('counts a fee block Amazon left unnamed rather than dropping it', () => {
    const v = computeAmazonInSellerExportPnl(SEPTEMBER)
    expect(v.unmappedFees).toBeCloseTo(-14084.48, 2)
  })

  // The one line that says whether the fees above are the whole of what was
  // charged. ₹1,052.56 of September's charges are still unread.
  it('checks itself against Amazon’s own net proceeds column', () => {
    const v = computeAmazonInSellerExportPnl(SEPTEMBER)
    expect(v.netProceeds).toBeCloseTo(223113.63 - FEES, 2)
    expect(v.sheetNetProceeds).toBeCloseTo(157562.82, 2)
    expect(v.netProceedsDiff).toBeCloseTo(1052.56, 2)
  })

  it('costs the goods from the cost sheet and runs down to contribution', () => {
    const v = computeAmazonInSellerExportPnl(SEPTEMBER, COGS)
    expect(v.cogsPriced).toBe(-50000)
    expect(v.cogsUnpriced).toBe(-5000)
    expect(v.totalCogs).toBe(-55000)
    expect(v.cm2).toBeCloseTo(223113.63 - FEES - 55000, 2)
  })

  it('takes every percentage on net sales', () => {
    const v = computeAmazonInSellerExportPnl(SEPTEMBER, COGS)
    expect(v.cm1Pct).toBeCloseTo((v.cm1 / 223113.63) * 100, 6)
    expect(v.cm2Pct).toBeCloseTo((v.cm2 / 223113.63) * 100, 6)
  })

  it('applies the allocated fixed expenses', () => {
    const v = applyAmazonInSellerExportOtherCosts(computeAmazonInSellerExportPnl(SEPTEMBER, COGS), 25000)
    expect(v.otherCosts).toBe(-25000)
    expect(v.cm3).toBeCloseTo(v.cm2 - 25000, 2)
  })

  // A charge that is genuinely absent should read as nothing, not as minus
  // nothing — a statement that stores -0 has a line saying "less zero".
  it('never writes a negative zero', () => {
    const v = applyAmazonInSellerExportOtherCosts(computeAmazonInSellerExportPnl(SEPTEMBER), 0)
    for (const [key, value] of Object.entries(v)) {
      expect(Object.is(value, -0), `${key} is -0`).toBe(false)
    }
  })

  it('has a value for every line it defines', () => {
    const v = applyAmazonInSellerExportOtherCosts(computeAmazonInSellerExportPnl(SEPTEMBER, COGS), 1)
    for (const def of AMAZON_IN_SELLER_EXPORT_LINE_DEFS) {
      expect(v[def.key], `${def.key} has no value`).toBeTypeOf('number')
    }
  })
})

describe('amazonInSellerExportToCanonicalBuckets', () => {
  it('puts each fee in the bucket its own column config assigns it', () => {
    const b = amazonInSellerExportToCanonicalBuckets(SEPTEMBER, COGS)
    // Referral less its refunds — the commission Amazon actually kept.
    expect(b.marketplaceCommission).toBeCloseTo(19028.21 - 921.66, 2)
    // FBA fulfilment and weight handling, with the contained column left out.
    expect(b.fulfilment).toBeCloseTo(2607.8 + 6110.04, 2)
    expect(b.shipping).toBeCloseTo(23589.38, 2)
    // The unnamed block, which has no bucket of its own to go to.
    expect(b.otherMarketplaceCharges).toBeCloseTo(14084.48, 2)
  })

  it('makes net sales what the month sold after returns', () => {
    const lines = computeSubtotals(amazonInSellerExportToCanonicalBuckets(SEPTEMBER, COGS))
    expect(lines.netSales).toBeCloseTo(223113.63, 2)
    expect(lines.grossProfit).toBeCloseTo(223113.63 - 55000, 2)
  })

  // The two readings of the month have to agree, or the statement and the
  // Master P&L drift apart on the same channel.
  it('agrees with the statement at net sales and at contribution', () => {
    const native = computeAmazonInSellerExportPnl(SEPTEMBER, COGS)
    const lines = computeSubtotals(amazonInSellerExportToCanonicalBuckets(SEPTEMBER, COGS))
    expect(lines.netSales).toBeCloseTo(native.netSales, 2)
    expect(lines.contributionProfit).toBeCloseTo(native.cm2, 2)
  })

  it('takes nothing off for GST, because the export is already ex-GST', () => {
    expect(amazonInSellerExportToCanonicalBuckets(SEPTEMBER, COGS).otherRevenueAdj).toBe(0)
  })
})
