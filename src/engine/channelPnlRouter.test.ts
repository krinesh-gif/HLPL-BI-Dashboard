import { describe, expect, it } from 'vitest'
import { buildChannelPnlView } from './channelPnlRouter'
import type { FlipkartPnlFacts, NykaaPnlFacts, SkuMaster } from '@/data/models'

const skuMaster: SkuMaster[] = [
  { sku: 'S1', productName: 'Test', category: 'Test', brand: 'HLPL', cogs: 50, mrp: 200, launchDate: '2025-01-01', status: 'active', leadTimeDays: 20, safetyStock: 50 },
]

const flipkartFacts: FlipkartPnlFacts = {
  month: '2026-06', grossSales: 100000, estimatedNetSales: 80000, cogsPriced: 20000, cogsUnpriced: 0,
  commissionFee: 8000, collectionFee: 0, fixedFee: 5000, pickPackFee: 3000, forwardShippingFee: 0,
  reverseShippingFee: 1000, storageFee: 500, recallFee: 0, otherMarketplaceFees: 0, rewardsSpf: 0,
  flipkartAds: 4000, sellerFundedDiscount: 0, customerAddOns: 0, outputGst: 0, googleAds: 0,
}

describe('buildChannelPnlView', () => {
  it('uses the native Flipkart template when facts exist for the month', () => {
    const view = buildChannelPnlView('flipkart', '2026-06', {
      salesRecords: [], skuMaster, fixedExpenses: [], marketing: {},
      facts: { flipkartFacts: [flipkartFacts], amazonUsaFacts: [], meeshoFacts: [] },
    })
    expect(view.native).toBeDefined()
    expect(view.native?.values.cm1).toBeCloseTo(80000 - 20000)
    expect(view.canonical.lines.grossSales).toBe(100000)
  })

  it('falls back to the generic template when a native channel has no facts for the month', () => {
    const view = buildChannelPnlView('flipkart', '2026-07', {
      salesRecords: [], skuMaster, fixedExpenses: [], marketing: {},
      facts: { flipkartFacts: [flipkartFacts], amazonUsaFacts: [], meeshoFacts: [] },
    })
    expect(view.native).toBeUndefined()
    expect(view.canonical.lines.grossSales).toBe(0)
  })

  it('always falls back to the generic template for channels with no native model', () => {
    const view = buildChannelPnlView('nykaa', '2026-06', {
      salesRecords: [], skuMaster, fixedExpenses: [], marketing: {},
      facts: { flipkartFacts: [], amazonUsaFacts: [], meeshoFacts: [] },
    })
    expect(view.native).toBeUndefined()
  })

  it('allocates this channel share of fixed expenses into the Flipkart CM4 line', () => {
    const salesRecords = [
      { orderId: '1', orderDate: '2026-06-01', channel: 'flipkart' as const, marketplace: 'flipkart', sellerType: 'marketplace' as const, sku: 'S1', productName: 'Test', category: 'Test', quantity: 1, grossSales: 1000, discount: 0, netSales: 1000, returnUnits: 0, rtoUnits: 0, shippingCost: 0, marketplaceFee: 0, tax: 0, status: 'completed' as const, currency: 'INR' as const, importId: 'x' },
    ]
    const view = buildChannelPnlView('flipkart', '2026-06', {
      salesRecords, skuMaster, fixedExpenses: [{ month: '2026-06', category: 'rent', amount: 10000 }], marketing: {},
      facts: { flipkartFacts: [flipkartFacts], amazonUsaFacts: [], meeshoFacts: [] },
    })
    // With only Flipkart having sales this month, it gets 100% of the allocation.
    expect(view.native?.values.otherCosts).toBeCloseTo(-10000)
  })
})

/**
 * Nykaa's August as it sits in the database today: imported before the
 * customer discount was modelled, so the stored facts carry no figure for it.
 *
 * Reading that as "no discount" is what made the fix look like it had not
 * shipped — the statement went on reporting the 14.13 lakh Nykaa invoiced
 * rather than the 6.30 lakh we kept, with nothing on screen to explain it.
 */
const legacyNykaaAugust: NykaaPnlFacts = {
  month: '2026-08',
  grossSalesMrp: 2816263, returnsMrp: 126725, netSalesMrp: 2689538,
  unitsShipped: 6870, unitsReturned: 303, netUnits: 6567, orders: 5911,
  customerPaidValue: 1900158.84,
  nykaaFundedCoupon: 6165.03,
  cogsPriced: 0, cogsUnpriced: 0, nykaaAds: 0,
} as NykaaPnlFacts

describe('Nykaa months imported before the customer discount was modelled', () => {
  const view = buildChannelPnlView('nykaa', '2026-08', {
    salesRecords: [], skuMaster, fixedExpenses: [], marketing: {},
    facts: { flipkartFacts: [], amazonUsaFacts: [], meeshoFacts: [], nykaaFacts: [legacyNykaaAugust] },
  })

  it('derives the discount from the totals the old importer did store', () => {
    // 26,89,538 of net MRP against 19,00,158.84 paid, less the 6,165.03 Nykaa
    // funded: the same 7,83,214.13 a fresh import computes. No order rows are
    // passed at all, because the sale price never reaches the database at row
    // level — the client strips each row's raw copy before upload, which is
    // what made an earlier attempt to rebuild it from rows a silent no-op.
    expect(view.native?.values.customerDiscount).toBeCloseTo(-783214.13, 2)
    expect(view.native?.values.netRevenueExGst).toBeCloseTo(629932.95, 2)
  })

  it('keeps the Master P&L on the same figure as the statement', () => {
    expect(view.canonical.lines.netSales).toBeCloseTo(view.native!.values.netRevenueExGst, 6)
  })

  it('marks the line itself as derived, where a reader is already looking', () => {
    const line = view.native?.lineDefs.find((d) => d.key === 'customerDiscount')
    expect(line?.note).toContain('Derived from this month')
    expect(view.notes.some((n) => n.includes('was derived from'))).toBe(true)
  })

  it('never treats a missing sale total as a sale at zero', () => {
    // Without this guard the whole of MRP becomes discount and the month
    // reports no revenue at all — a louder wrong answer than the one it fixes.
    const noSaleTotal = { ...legacyNykaaAugust, customerPaidValue: 0 }
    const blind = buildChannelPnlView('nykaa', '2026-08', {
      salesRecords: [], skuMaster, fixedExpenses: [], marketing: {},
      facts: { flipkartFacts: [], amazonUsaFacts: [], meeshoFacts: [], nykaaFacts: [noSaleTotal] },
    })
    expect(blind.native?.values.customerDiscount).toBe(-0)
    expect(blind.native?.lineDefs.find((d) => d.key === 'customerDiscount')?.note).toContain('Not established')
    expect(blind.notes.some((n) => n.includes('every margin below it is overstated'))).toBe(true)
  })

  it('leaves a freshly imported month alone', () => {
    const fresh = buildChannelPnlView('nykaa', '2026-08', {
      salesRecords: [], skuMaster, fixedExpenses: [], marketing: {},
      facts: {
        flipkartFacts: [], amazonUsaFacts: [], meeshoFacts: [],
        nykaaFacts: [{ ...legacyNykaaAugust, listDiscount: 690129.23, promoDiscount: 99249.93, customerDiscount: 783214.13 }],
      },
    })
    expect(fresh.native?.values.listDiscount).toBeCloseTo(-690129.23, 2)
    expect(fresh.notes.some((n) => n.includes('was derived from'))).toBe(false)
    expect(fresh.native?.lineDefs.find((d) => d.key === 'customerDiscount')?.note).not.toContain('Derived')
  })
})
