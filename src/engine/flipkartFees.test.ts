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
