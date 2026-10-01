import { describe, expect, it } from 'vitest'
import { buildFlipkartFeeSeries, flipkartFeeSeries, FLIPKART_FEE_LINES } from './flipkartFees'
import type { FlipkartPnlFacts } from '@/data/models'

/** A month carrying only the fees a test is about; everything else is nil. */
function month(over: Partial<FlipkartPnlFacts> & { month: string }): FlipkartPnlFacts {
  return {
    grossSales: 0, estimatedNetSales: 0, cogsPriced: 0, cogsUnpriced: 0,
    commissionFee: 0, collectionFee: 0, fixedFee: 0, pickPackFee: 0,
    forwardShippingFee: 0, reverseShippingFee: 0, storageFee: 0, recallFee: 0,
    otherMarketplaceFees: 0, rewardsSpf: 0, flipkartAds: 0,
    sellerFundedDiscount: 0, customerAddOns: 0, outputGst: 0, googleAds: 0,
    ...over,
  }
}

/** The owner's own Flipkart months, April to August 2026. */
const REAL_STORAGE = [11684.48, 9932.08, 21242.16, 46945.4, 69228.4]
const MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08']
const REAL_FACTS = MONTHS.map((m, i) => month({ month: m, storageFee: REAL_STORAGE[i], recallFee: [105, 80, 685, 1030, 15685][i] }))

const storage = FLIPKART_FEE_LINES.find((d) => d.id === 'storageFee')!
const commission = FLIPKART_FEE_LINES.find((d) => d.id === 'commissionFee')!

describe('a fee read month by month', () => {
  it('follows the real storage fee across the owner’s own months', () => {
    const s = buildFlipkartFeeSeries(storage, MONTHS, REAL_FACTS)
    expect(s.points.map((p) => p.amount)).toEqual(REAL_STORAGE)
    expect(s.total).toBeCloseTo(159032.52, 2)
    expect(s.monthsCharged).toBe(5)
    // August against July: the figure the screen reports as "higher".
    expect(s.changeLastMonth).toBeCloseTo(22283, 2)
    // August against the mean of April–July (₹22,451.03).
    expect(s.vsAveragePct).toBeCloseTo(208.4, 1)
  })

  it('reports no baseline rather than no change for a single month', () => {
    // One month has nothing to compare against. Printing 0% would read as
    // "flat", which is a different and much more reassuring claim.
    const s = buildFlipkartFeeSeries(storage, ['2026-04'], [REAL_FACTS[0]])
    expect(s.changeLastMonth).toBeNull()
    expect(s.vsAveragePct).toBeNull()
  })

  it('counts a month the fee was not charged, without inventing one', () => {
    const facts = [month({ month: '2026-04', storageFee: 500 }), month({ month: '2026-05' })]
    const s = buildFlipkartFeeSeries(storage, ['2026-04', '2026-05'], facts)
    expect(s.monthsCharged).toBe(1)
    expect(s.points[1].amount).toBe(0)
    expect(s.changeLastMonth).toBe(-500)
  })

  it('reads a month that was never uploaded as nil, not as a gap', () => {
    const s = buildFlipkartFeeSeries(storage, ['2026-04', '2026-09'], [REAL_FACTS[0]])
    expect(s.points[1].amount).toBe(0)
  })
})

describe('the list of fees', () => {
  it('puts a fee with a lever above a larger one without', () => {
    // Commission is the bigger number and nothing can be done about it; the
    // list exists to be worked through, so the actionable line leads.
    const facts = [month({ month: '2026-04', storageFee: 1000, commissionFee: 90000 })]
    const list = flipkartFeeSeries(['2026-04'], facts)
    expect(list[0].def.id).toBe('storageFee')
    expect(list[1].def.id).toBe('commissionFee')
    expect(storage.lever).toBeTruthy()
    expect(commission.lever).toBeUndefined()
  })

  it('leaves out a fee that was never charged', () => {
    const facts = [month({ month: '2026-04', storageFee: 1000 })]
    expect(flipkartFeeSeries(['2026-04'], facts).map((s) => s.def.id)).toEqual(['storageFee'])
  })

  it('every listed fee names a real field on the facts', () => {
    // The id doubles as the statement's line key and the facts field, so a
    // typo here would silently read zero for ever rather than fail.
    const sample = month({ month: '2026-04' })
    for (const def of FLIPKART_FEE_LINES) {
      expect(sample, `${String(def.id)} is not a field on FlipkartPnlFacts`).toHaveProperty(String(def.id))
    }
  })
})

describe('the products carrying a fee', () => {
  it('splits the fee by SKU, biggest first', () => {
    const facts = [
      month({
        month: '2026-08', storageFee: 1000,
        feeBySku: { 'AO/A': { storageFee: 700 }, 'AO/B': { storageFee: 300 } },
      }),
    ]
    const s = buildFlipkartFeeSeries(storage, ['2026-08'], facts)
    expect(s.skus.map((r) => r.sku)).toEqual(['AO/A', 'AO/B'])
    expect(s.skus[0].total).toBe(700)
    expect(s.skus[0].sharePct).toBeCloseTo(70)
    expect(s.skuCoveragePct).toBeCloseTo(100)
    expect(s.topThreeSharePct).toBeCloseTo(100)
  })

  it('adds a SKU up across months, keeping each month in its own column', () => {
    const facts = [
      month({ month: '2026-07', storageFee: 400, feeBySku: { 'AO/A': { storageFee: 400 } } }),
      month({ month: '2026-08', storageFee: 600, feeBySku: { 'AO/A': { storageFee: 600 } } }),
    ]
    const s = buildFlipkartFeeSeries(storage, ['2026-07', '2026-08'], facts)
    expect(s.skus[0].byMonth).toEqual([400, 600])
    expect(s.skus[0].total).toBe(1000)
  })

  it('leaves a month with no split out rather than spreading its total', () => {
    // July predates the per-SKU capture. Its ₹900 is real and stays in the
    // fee's total; what it must not do is get apportioned across August's
    // products, which would invent a figure per product.
    const facts = [
      month({ month: '2026-07', storageFee: 900 }),
      month({ month: '2026-08', storageFee: 100, feeBySku: { 'AO/A': { storageFee: 100 } } }),
    ]
    const s = buildFlipkartFeeSeries(storage, ['2026-07', '2026-08'], facts)
    expect(s.total).toBe(1000)
    expect(s.skus).toHaveLength(1)
    expect(s.skus[0].byMonth).toEqual([0, 100])
    // The table accounts for a tenth of the fee, and the screen says so.
    expect(s.skuCoveragePct).toBeCloseTo(10)
  })

  it('reads each fee out of the split independently', () => {
    const facts = [
      month({
        month: '2026-08', storageFee: 500, recallFee: 200,
        feeBySku: { 'AO/A': { storageFee: 500, recallFee: 200 } },
      }),
    ]
    const recall = FLIPKART_FEE_LINES.find((d) => d.id === 'recallFee')!
    expect(buildFlipkartFeeSeries(storage, ['2026-08'], facts).skus[0].total).toBe(500)
    expect(buildFlipkartFeeSeries(recall, ['2026-08'], facts).skus[0].total).toBe(200)
  })

  it('has no products when nothing was uploaded with a split', () => {
    const s = buildFlipkartFeeSeries(storage, MONTHS, REAL_FACTS)
    expect(s.skus).toEqual([])
    expect(s.skuCoveragePct).toBe(0)
  })
})
