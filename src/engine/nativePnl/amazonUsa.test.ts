import { describe, expect, it } from 'vitest'
import { AMAZON_USA_FEE_COLUMNS } from '@/data/amazonUsa/feeColumns'
import {
  AMAZON_USA_LINE_DEFS,
  amazonUsaLineDefs,
  amazonUsaToCanonicalBuckets,
  computeAmazonUsaPnl,
  isLegacyAmazonUsaFacts,
} from './amazonUsa'
import type { AmazonUsaPnlFacts } from '@/data/models'

/**
 * July 2026, read straight out of the owner's own workbook
 * (Aravi_Amazon_USA_PnL_FY2627_v7.xlsx, "PASTE HERE", the Jul-26 band at
 * A435: 95 SKU rows). Every figure below is that band's column summed, so a
 * failure here means the statement has stopped agreeing with the sheet.
 */
const JULY_FEES: Record<string, number> = {
  agedInventorySurcharge: 4.63,
  baseFulfillmentFee: 9073.28,
  baseMonthlyStorageFee: 29.5011,
  couponParticipationFee: 10.0004,
  couponPerformanceFee: 196.6618,
  dealDailyFee: 199.9815,
  dealPerformanceFee: 131.7388,
  fbaInventoryReimbursement: 47.25,
  fbaDisposalOrderFee: 63.24,
  fbaFulfillmentFees: 10099.8,
  fbaInboundPlacementFee: 1090.56,
  fuelLogisticsSurcharge: 325.0,
  lowInventoryLevelFee: 701.52,
  monthlyInventoryStorageFee: 29.5011,
  referralFeeRefunds: -181.96,
  referralFee: 4235.5,
  refundAdministrationFee: 37.73,
  returnsProcessingFee: 2.36,
  storageUtilizationSurcharge: 0,
  sponsoredProductsCharge: 3466.76,
}

/** The four columns the July file proved to be contained in another one. */
const JULY_NESTED = [
  'baseFulfillmentFee', 'fuelLogisticsSurcharge', 'lowInventoryLevelFee', 'monthlyInventoryStorageFee',
]

function july(over: Partial<AmazonUsaPnlFacts> = {}): AmazonUsaPnlFacts {
  return {
    month: '2026-07', schemaVersion: 2,
    grossSalesUsd: 32099.005, netSalesUsd: 30738.235,
    unitsSoldQty: 2416, unitsReturnedQty: 105, netUnitsSoldQty: 2311,
    feeTotalsUsd: { ...JULY_FEES }, unmappedFeeTotalsUsd: {},
    // What the importer proved from the July band, row by row.
    nestedFeeIds: JULY_NESTED,
    sheetCogsUsd: 3.6, sheetMiscCostUsd: 0, sheetNetProceedsUsd: 11300.8814,
    referralFeeUsd: 0, fbaFulfilmentFeeUsd: 0, storageAgedDisposalUsd: 0, couponDealFeesUsd: 0,
    refundAdminFeeUsd: 0, fbaReimbursementsUsd: 0, otherAmazonFeesUsd: 0, sponsoredProductsUsd: 0,
    cogsUsd: 0, freightUsd: 0,
    sponsoredBrandsUsd: 0, sponsoredDisplayDspUsd: 0, offAmazonAdsUsd: 0,
    exportDocsUsd: 0, usImportDutyUsd: 0,
    amazonSellingPlanUsd: 0, productLiabilityInsuranceUsd: 0, fdaLegalUsd: 0,
    agencySoftwareUsd: 0, otherOverheadUsd: 0, fxConversionCostPct: 0,
    ...over,
  }
}

describe('the statement ties to Amazon’s own Net proceeds', () => {
  const v = computeAmazonUsaPnl(july())

  it('reproduces July to the cent', () => {
    expect(v.netProceedsUsd).toBeCloseTo(11300.8814, 4)
    expect(v.netProceedsDiffUsd).toBeCloseTo(0, 6)
  })

  it('reports revenue exactly as the export does', () => {
    expect(v.grossSalesUsd).toBeCloseTo(32099.005, 4)
    expect(v.netSalesUsd).toBeCloseTo(30738.235, 4)
    expect(v.refundsReturnsUsd).toBeCloseTo(-1360.77, 2)
  })

  it('splits the charges into the two heads the report is read by', () => {
    expect(v.totalMarketplaceChargesUsd).toBeCloseTo(-15966.9936, 4)
    expect(v.totalAdvertisingUsd).toBeCloseTo(-3466.76, 4)
  })

  it('subtracts the seller-entered per-unit cost Amazon nets off', () => {
    // $3.60 in July. Leaving it out is the difference between tying and
    // nearly tying — the statement was out by exactly this before.
    expect(v.sheetSellerCostUsd).toBeCloseTo(-3.6, 4)
    expect(computeAmazonUsaPnl(july({ sheetCogsUsd: 0 })).netProceedsUsd).toBeCloseTo(11304.4814, 4)
  })
})

describe('a column that is already inside another one is shown, never added', () => {
  const v = computeAmazonUsaPnl(july())

  it('shows the fulfilment components at their real values', () => {
    // Base fulfilment + fuel surcharge + low-inventory fee = FBA fulfilment
    // fees, on all 380 rows of the four months in the workbook.
    expect(v['fee.baseFulfillmentFee']).toBeCloseTo(-9073.28, 4)
    expect(v['fee.fuelLogisticsSurcharge']).toBeCloseTo(-325, 4)
    expect(v['fee.lowInventoryLevelFee']).toBeCloseTo(-701.52, 4)
    expect(9073.28 + 325 + 701.52).toBeCloseTo(10099.8, 4)
  })

  it('leaves them out of the total, or the month is charged twice', () => {
    const doubled = 15966.9936 + 9073.28 + 325 + 701.52 + 29.5011
    expect(Math.abs(v.totalMarketplaceChargesUsd)).toBeLessThan(doubled)
    expect(Math.abs(v.totalMarketplaceChargesUsd)).toBeCloseTo(15966.9936, 4)
  })

  it('marks every such line on the statement rather than leaving it to be spotted', () => {
    const memoLines = amazonUsaLineDefs(july()).filter((d) => d.memoOf)
    expect(memoLines.map((d) => d.label).sort()).toEqual([
      'Base fulfillment fee total',
      'Fuel and Logistics-related surcharge total',
      'Low-inventory-level fee total',
      'Monthly inventory storage fee total',
    ])
  })
})

describe('credits keep their sign', () => {
  it('reads a reimbursement or a referral refund as money coming back', () => {
    // Referral Fee Refunds is −181.96 in the export, i.e. a credit. Taking the
    // magnitude, as the old importer did, charged the month for its own refund.
    const v = computeAmazonUsaPnl(july())
    expect(v['fee.referralFeeRefunds']).toBeCloseTo(181.96, 4)
    expect(v['fee.referralFee']).toBeCloseTo(-4235.5, 4)
  })
})

describe('a fee column Amazon has just invented', () => {
  const v = computeAmazonUsaPnl(july({ unmappedFeeTotalsUsd: { 'Some New Fee total': 40 } }))

  it('is counted, so the month still ties', () => {
    expect(v.netProceedsUsd).toBeCloseTo(11300.8814 - 40, 4)
  })

  it('is shown on its own line rather than folded into a fee that was understood', () => {
    expect(v.unmappedFeesUsd).toBeCloseTo(-40, 4)
  })
})

describe('every line on the statement is a real column', () => {
  it('names each fee exactly as Amazon exports it', () => {
    const feeLabels = AMAZON_USA_LINE_DEFS.filter((d) => d.key.startsWith('fee.')).map((d) => d.label)
    expect(feeLabels).toEqual(AMAZON_USA_FEE_COLUMNS.map((c) => c.header))
  })

  it('groups the charges under the two collapsible heads', () => {
    const heads = AMAZON_USA_LINE_DEFS.filter((d) => d.isGroupHead)
    expect(heads.map((d) => d.label)).toEqual(['Marketplace Charges', 'Advertising Fees'])
    for (const h of heads) expect(h.group).toBe(h.section)
  })
})

describe('the CM ladder continues below the tie-point', () => {
  it('takes landed cost off Net proceeds, not off Net Sales', () => {
    const v = computeAmazonUsaPnl(july({ cogsUsd: 3000, freightUsd: 250 }))
    expect(v.cm2).toBeCloseTo(v.netProceedsUsd - 3250, 4)
  })

  it('applies the FX conversion cost as a percentage of net sales at CM3', () => {
    const v = computeAmazonUsaPnl(july({ fxConversionCostPct: 0.5 }))
    expect(v.cm3).toBeCloseTo(v.cm2 - 30738.235 * 0.005, 4)
  })
})

describe('amazonUsaToCanonicalBuckets', () => {
  const b = amazonUsaToCanonicalBuckets(july({ cogsUsd: 3000 }), 90)

  it('converts to rupees at the rate given', () => {
    expect(b.grossSales).toBeCloseTo(32099.005 * 90, 2)
    expect(b.returns).toBeCloseTo(1360.77 * 90, 0)
  })

  it('routes each named fee to the bucket its config assigns', () => {
    expect(b.marketplaceCommission).toBeCloseTo((4235.5 - 181.96) * 90, 2)
    expect(b.fulfilment).toBeCloseTo((10099.8 + 1090.56) * 90, 2)
    expect(b.returnCharges).toBeCloseTo((37.73 + 2.36) * 90, 2)
    expect(b.ads).toBeCloseTo(3466.76 * 90, 2)
  })

  it('never counts a component column, so the roll-up matches the statement', () => {
    const everyBucket = (b.marketplaceCommission ?? 0) + (b.fulfilment ?? 0) + (b.returnCharges ?? 0)
      + (b.otherMarketplaceCharges ?? 0) + (b.ads ?? 0)
    const countedTotal = AMAZON_USA_FEE_COLUMNS
      .filter((c) => !JULY_NESTED.includes(c.id))
      .reduce((s, c) => s + JULY_FEES[c.id], 0)
    // Misc cost rides in otherMarketplaceCharges; it is zero in July.
    expect(everyBucket).toBeCloseTo(countedTotal * 90, 2)
  })
})

describe('a month imported before the columns were read individually', () => {
  const legacy: AmazonUsaPnlFacts = { ...july(), feeTotalsUsd: undefined, nestedFeeIds: undefined }

  it('is recognised rather than rendered as if it were complete', () => {
    expect(isLegacyAmazonUsaFacts(legacy)).toBe(true)
    expect(isLegacyAmazonUsaFacts(july())).toBe(false)
  })

  it('reports every charge as unknown rather than as the old buckets under Amazon’s column names', () => {
    // Spreading the eight old buckets across the real column titles put the
    // old catch-all on "Storage utilization surcharge" and showed $14,061.75
    // against a sheet that said zero. A zero would be almost as bad: it reads
    // as "Amazon charged nothing". These render as "—".
    const v = computeAmazonUsaPnl(legacy)
    expect(v['fee.storageUtilizationSurcharge']).toBeNaN()
    expect(v['fee.referralFee']).toBeNaN()
    expect(v.totalMarketplaceChargesUsd).toBeNaN()
    expect(v.netProceedsUsd).toBeNaN()
    expect(v.cm3).toBeNaN()
  })

  it('still gives the Master P&L this channel’s cost, rather than reading the month as free', () => {
    // The old split between buckets was wrong; the aggregate was about right.
    const b = amazonUsaToCanonicalBuckets({ ...legacy, referralFeeUsd: 4417.46, fbaFulfilmentFeeUsd: 19165.36 }, 90)
    expect(b.marketplaceCommission).toBeCloseTo(4417.46 * 90, 2)
    expect(b.fulfilment).toBeCloseTo(19165.36 * 90, 2)
  })

  it('still reports the revenue it does have', () => {
    expect(computeAmazonUsaPnl(legacy).netSalesUsd).toBeCloseTo(30738.235, 4)
  })
})

describe('when the file does not show a column nested inside another', () => {
  it('counts every column on its own, as the sheet’s own total does', () => {
    const flat = computeAmazonUsaPnl(july({ nestedFeeIds: [] }))
    const everyColumn = Object.values(JULY_FEES).reduce((a, b) => a + b, 0)
    expect(Math.abs(flat.totalMarketplaceChargesUsd) + Math.abs(flat.totalAdvertisingUsd))
      .toBeCloseTo(everyColumn, 4)
  })

  it('leaves nothing marked "included above"', () => {
    expect(amazonUsaLineDefs(july({ nestedFeeIds: [] })).filter((d) => d.memoOf)).toHaveLength(0)
  })
})

describe('Advertising Fees is the export’s own column and nothing else', () => {
  it('excludes the placements Amazon does not report', () => {
    const v = computeAmazonUsaPnl(july({ sponsoredBrandsUsd: 500, offAmazonAdsUsd: 250 }))
    expect(v.totalAdvertisingUsd).toBeCloseTo(-3466.76, 4)
    expect(v.totalOtherMarketingUsd).toBeCloseTo(-750, 4)
  })

  it('keeps Net proceeds tied to the sheet whatever is typed into them', () => {
    const v = computeAmazonUsaPnl(july({ sponsoredBrandsUsd: 500, offAmazonAdsUsd: 250 }))
    expect(v.netProceedsUsd).toBeCloseTo(11300.8814, 4)
    expect(v.netProceedsDiffUsd).toBeCloseTo(0, 6)
    // They are real spend, so they come off below the tie-point.
    expect(v.cm2).toBeCloseTo(11300.8814 - 750, 4)
  })
})
