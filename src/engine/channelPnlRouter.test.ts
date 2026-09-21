import { describe, expect, it } from 'vitest'
import { buildChannelPnlView } from './channelPnlRouter'
import type { CanonicalSalesRecord, FlipkartPnlFacts, NykaaPnlFacts, SkuMaster } from '@/data/models'

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

/** One Nykaa row as the old importer wrote it: MRP in `netSales`, the sale
 * price in `raw.final_sp`, and no `final_subtotal` to split them with. */
const legacyNykaaRow = (sku: string, mrp: number, paid: number): CanonicalSalesRecord => ({
  orderId: `nykaa-${sku}-2026-08`, orderDate: '2026-08-01', channel: 'nykaa', marketplace: 'nykaa',
  sellerType: 'marketplace', sku, productName: sku, category: 'Test', quantity: 1,
  grossSales: mrp, discount: 0, netSales: mrp, returnUnits: 0, rtoUnits: 0, shippingCost: 0,
  marketplaceFee: 0, tax: 0, status: 'completed', currency: 'INR', isAggregate: true,
  raw: { final_sp: paid }, importId: 'old',
})

describe('Nykaa months imported before the customer discount was modelled', () => {
  const rows = [legacyNykaaRow('A', 2000000, 1400000), legacyNykaaRow('B', 689538, 500158.84)]
  const view = buildChannelPnlView('nykaa', '2026-08', {
    salesRecords: rows, skuMaster, fixedExpenses: [], marketing: {},
    facts: { flipkartFacts: [], amazonUsaFacts: [], meeshoFacts: [], nykaaFacts: [legacyNykaaAugust] },
  })

  it('recovers the discount from the rows rather than reporting none', () => {
    // 26,89,538 of MRP against 19,00,158.84 paid, less the 6,165.03 Nykaa
    // funded: the same 7,83,214.13 a fresh import computes.
    expect(view.native?.values.customerDiscount).toBeCloseTo(-783214.13, 2)
    expect(view.native?.values.netRevenueExGst).toBeCloseTo(629932.95, 2)
  })

  it('keeps the Master P&L on the same figure as the statement', () => {
    expect(view.canonical.lines.netSales).toBeCloseTo(view.native!.values.netRevenueExGst, 6)
  })

  it('says the figure was recovered, and what re-uploading would add', () => {
    expect(view.notes.some((n) => n.includes('recovered from') && n.includes('Sales file uploading again'))).toBe(true)
  })

  it('says so plainly when the rows cannot supply it either', () => {
    const blind = buildChannelPnlView('nykaa', '2026-08', {
      salesRecords: [], skuMaster, fixedExpenses: [], marketing: {},
      facts: { flipkartFacts: [], amazonUsaFacts: [], meeshoFacts: [], nykaaFacts: [legacyNykaaAugust] },
    })
    expect(blind.native?.values.customerDiscount).toBe(-0)
    expect(blind.notes.some((n) => n.includes('cannot tell how far below MRP'))).toBe(true)
  })

  it('leaves a freshly imported month alone', () => {
    const fresh = buildChannelPnlView('nykaa', '2026-08', {
      salesRecords: rows, skuMaster, fixedExpenses: [], marketing: {},
      facts: {
        flipkartFacts: [], amazonUsaFacts: [], meeshoFacts: [],
        nykaaFacts: [{ ...legacyNykaaAugust, listDiscount: 690129.23, promoDiscount: 99249.93, customerDiscount: 783214.13 }],
      },
    })
    expect(fresh.native?.values.listDiscount).toBeCloseTo(-690129.23, 2)
    expect(fresh.notes.some((n) => n.includes('recovered from'))).toBe(false)
  })
})
