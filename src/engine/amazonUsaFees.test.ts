import { describe, expect, it } from 'vitest'
import { amazonUsaFeeSeries, buildSeries } from './amazonUsaFees'
import { AMAZON_USA_FEE_COLUMNS } from '@/data/amazonUsa/feeColumns'
import type { AmazonUsaPnlFacts } from '@/data/models'

const column = (id: string) => AMAZON_USA_FEE_COLUMNS.find((c) => c.id === id)!

function month(m: string, totals: Record<string, number>, bySku?: Record<string, Record<string, number>>): AmazonUsaPnlFacts {
  return {
    month: m, schemaVersion: 2, grossSalesUsd: 0, netSalesUsd: 0,
    feeTotalsUsd: totals, unmappedFeeTotalsUsd: {}, nestedFeeIds: [], feeBySkuUsd: bySku,
    sheetCogsUsd: 0, sheetMiscCostUsd: 0, sheetNetProceedsUsd: 0,
    referralFeeUsd: 0, fbaFulfilmentFeeUsd: 0, storageAgedDisposalUsd: 0, couponDealFeesUsd: 0,
    refundAdminFeeUsd: 0, fbaReimbursementsUsd: 0, otherAmazonFeesUsd: 0, sponsoredProductsUsd: 0,
    cogsUsd: 0, freightUsd: 0, sponsoredBrandsUsd: 0, sponsoredDisplayDspUsd: 0, offAmazonAdsUsd: 0,
    exportDocsUsd: 0, usImportDutyUsd: 0, amazonSellingPlanUsd: 0, productLiabilityInsuranceUsd: 0,
    fdaLegalUsd: 0, agencySoftwareUsd: 0, otherOverheadUsd: 0, fxConversionCostPct: 0,
  }
}

const months = ['2026-05', '2026-06', '2026-07']
const facts = [
  month('2026-05', { lowInventoryLevelFee: 708.66 }, { A: { lowInventoryLevelFee: 700 }, B: { lowInventoryLevelFee: 8.66 } }),
  month('2026-06', { lowInventoryLevelFee: 767.3 }, { A: { lowInventoryLevelFee: 760 }, B: { lowInventoryLevelFee: 7.3 } }),
  month('2026-07', { lowInventoryLevelFee: 701.52 }, { A: { lowInventoryLevelFee: 650 }, C: { lowInventoryLevelFee: 51.52 } }),
]

describe('one fee, read across months', () => {
  const s = buildSeries(column('lowInventoryLevelFee'), months, facts)

  it('gives a point per month, in the order asked for', () => {
    expect(s.points.map((p) => p.month)).toEqual(months)
    expect(s.points.map((p) => p.amount)).toEqual([708.66, 767.3, 701.52])
  })

  it('totals the period and says how many months were charged', () => {
    expect(s.total).toBeCloseTo(2177.48, 2)
    expect(s.monthsCharged).toBe(3)
  })

  it('reports the last month’s move, so a fee that is growing is visible', () => {
    expect(s.changeLastMonth).toBeCloseTo(701.52 - 767.3, 4)
  })

  it('names the SKUs carrying it, worst first', () => {
    expect(s.skus.map((r) => r.sku)).toEqual(['A', 'C', 'B'])
    expect(s.skus[0].total).toBeCloseTo(2110, 2)
    expect(s.skus[0].byMonth).toEqual([700, 760, 650])
  })

  it('says what share each SKU is, because a shortlist is actionable and a spread is not', () => {
    expect(s.skus[0].sharePct).toBeCloseTo((2110 / 2177.48) * 100, 4)
    expect(s.topThreeSharePct).toBeCloseTo(100, 4)
  })

  it('leaves a month with no per-SKU detail out of the SKU table rather than guessing it', () => {
    const partial = [facts[0], month('2026-06', { lowInventoryLevelFee: 500 }), facts[2]]
    const p = buildSeries(column('lowInventoryLevelFee'), months, partial)
    // The monthly line still shows all three months...
    expect(p.points.map((x) => x.amount)).toEqual([708.66, 500, 701.52])
    // ...but June contributes nothing to any SKU row.
    expect(p.skus.find((r) => r.sku === 'A')?.byMonth).toEqual([700, 0, 650])
  })

  it('carries the lever, which is the reason the page exists', () => {
    expect(s.column.lever).toContain('Sending more inventory')
  })
})

describe('the fee list is ordered to be worked through', () => {
  const mixed = [
    month('2026-07', { referralFee: 4235.5, lowInventoryLevelFee: 701.52, storageUtilizationSurcharge: 0 }),
  ]
  const list = amazonUsaFeeSeries(['2026-07'], mixed)

  it('drops fees that were never charged', () => {
    expect(list.map((s) => s.column.id)).not.toContain('storageUtilizationSurcharge')
  })

  it('puts a fee you can act on above a bigger one you cannot', () => {
    // The referral fee is six times larger and is a percentage of the sale
    // price — there is nothing to do about it. An unactionable line at the top
    // of a list meant to be worked through is just a bigger number.
    expect(list[0].column.id).toBe('lowInventoryLevelFee')
    expect(list[1].column.id).toBe('referralFee')
  })
})
