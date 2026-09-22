import { describe, expect, it } from 'vitest'
import { buildChannelPnlView } from './channelPnlRouter'
import type {
  AmazonUsaPnlFacts, CanonicalSalesRecord, FixedExpenseEntry, FlipkartPnlFacts, NykaaPnlFacts, SkuMaster,
} from '@/data/models'

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

/**
 * The company's own fixed costs — salaries, rent, software — are entered once
 * and split across channels by their share of the month's sales. Every channel
 * with its own statement deducted that share except Amazon USA, and no channel
 * with its own statement carried it into the multi-month P&L at all.
 */
describe('a channel share of the company fixed expenses', () => {
  const inr = (channel: string, net: number): CanonicalSalesRecord => ({
    orderId: `${channel}-1`, orderDate: '2026-08-01', channel: channel as never, marketplace: channel,
    sellerType: 'marketplace', sku: 'S1', productName: 'T', category: 'Test', quantity: 1,
    grossSales: net, discount: 0, netSales: net, returnUnits: 0, rtoUnits: 0, shippingCost: 0,
    marketplaceFee: 0, tax: 0, status: 'completed', currency: 'INR', importId: 'x',
  })
  // Amazon USA and Flipkart each take half the month's net sales, so each
  // carries half of the 1,00,000 of fixed cost.
  const salesRecords = [inr('amazon_us', 100000), inr('flipkart', 100000)]
  const fixedExpenses: FixedExpenseEntry[] = [
    { month: '2026-08', category: 'salaries', amount: 60000 },
    { month: '2026-08', category: 'rent', amount: 40000 },
  ]
  const fxRate = 88
  const amazonUsa: AmazonUsaPnlFacts = {
    month: '2026-08', schemaVersion: 2, grossSalesUsd: 10000, netSalesUsd: 9000,
    unitsSoldQty: 100, unitsReturnedQty: 0, netUnitsSoldQty: 100,
    feeTotalsUsd: { referralFee: 1000 },
    // The pre-v2 fields are still on the type and still read by the
    // arithmetic, so a fixture that leaves them out produces NaN rather than a
    // failing number, and every assertion below it passes vacuously.
    referralFeeUsd: 0, fbaFulfilmentFeeUsd: 0, storageAgedDisposalUsd: 0, couponDealFeesUsd: 0,
    refundAdminFeeUsd: 0, fbaReimbursementsUsd: 0, otherAmazonFeesUsd: 0, sponsoredProductsUsd: 0,
    cogsUsd: 2000, freightUsd: 300, sponsoredBrandsUsd: 0, sponsoredDisplayDspUsd: 0,
    offAmazonAdsUsd: 0, exportDocsUsd: 0, usImportDutyUsd: 0, amazonSellingPlanUsd: 40,
    productLiabilityInsuranceUsd: 0, fdaLegalUsd: 0, agencySoftwareUsd: 0, otherOverheadUsd: 0,
  }

  const build = (channel: 'amazon_us' | 'flipkart', expenses = fixedExpenses) =>
    buildChannelPnlView(channel, '2026-08', {
      salesRecords, skuMaster, fixedExpenses: expenses, marketing: {}, fxRate,
      facts: { flipkartFacts: [flipkartAugust], amazonUsaFacts: [amazonUsa], meeshoFacts: [] },
    })

  const flipkartAugust: FlipkartPnlFacts = { ...flipkartFacts, month: '2026-08' }

  it('reaches the Amazon USA statement, in the currency that statement is kept in', () => {
    const v = build('amazon_us')
    // 50,000 of a 1,00,000 month, converted at the month's rate — not left in
    // rupees, which the render to INR would then multiply by the rate again.
    expect(v.native?.values.allocatedOverheadsUsd).toBeCloseTo(-50000 / fxRate, 6)
    expect(v.native?.values.cm4).toBeCloseTo(v.native!.values.cm3 - 50000 / fxRate, 6)
    expect(v.native?.values.cm4).toBeLessThan(v.native!.values.cm3)
  })

  it('leaves Net Profit at CM3 for a month with no fixed expenses entered', () => {
    const v = build('amazon_us', [])
    expect(v.native?.values.allocatedOverheadsUsd).toBe(-0)
    expect(v.native?.values.cm4).toBeCloseTo(v.native!.values.cm3, 6)
  })

  it('reaches the multi-month P&L for every channel with its own statement', () => {
    for (const channel of ['amazon_us', 'flipkart'] as const) {
      const lines = build(channel).canonical.lines
      expect(lines.salaries, `${channel} salaries`).toBeCloseTo(30000, 6)
      expect(lines.rent, `${channel} rent`).toBeCloseTo(20000, 6)
      // EBITDA used to equal contribution on every one of these channels,
      // which is what made a month of overheads invisible on the report the
      // company is actually run from.
      expect(lines.ebitda, `${channel} ebitda`).toBeCloseTo((lines.contributionProfit ?? 0) - 50000, 6)
      expect(lines.ebitda).toBeLessThan(lines.contributionProfit ?? 0)
    }
  })

  it('splits by each channel share of sales, not evenly', () => {
    const lopsided = [inr('amazon_us', 150000), inr('flipkart', 50000)]
    const v = buildChannelPnlView('amazon_us', '2026-08', {
      salesRecords: lopsided, skuMaster, fixedExpenses, marketing: {}, fxRate,
      facts: { flipkartFacts: [flipkartAugust], amazonUsaFacts: [amazonUsa], meeshoFacts: [] },
    })
    expect(v.canonical.lines.salaries).toBeCloseTo(60000 * 0.75, 6)
    expect(v.native?.values.allocatedOverheadsUsd).toBeCloseTo(-75000 / fxRate, 6)
  })
})

/**
 * Getting the goods to Nykaa's warehouse is a rate-card cost of a rupee or two
 * a unit. Small per unit; on a month of 6,567 units it is real money, and it
 * belongs inside COGS because it is what having the goods to sell costs.
 */
describe('freight from our warehouse to Nykaa\'s', () => {
  const august: NykaaPnlFacts = { ...legacyNykaaAugust, customerDiscount: 783214.13, cogsPriced: 371293 }
  const build = (perUnit?: number) =>
    buildChannelPnlView('nykaa', '2026-08', {
      salesRecords: [], skuMaster, fixedExpenses: [], marketing: {},
      nykaaFreightPerUnitInr: perUnit,
      facts: { flipkartFacts: [], amazonUsaFacts: [], meeshoFacts: [], nykaaFacts: [august] },
    })

  it('charges the month\'s net units at the rate entered for the month', () => {
    const v = build(1.5)
    expect(v.native?.values.inboundFreight).toBeCloseTo(-6567 * 1.5, 6)
  })

  it('takes it inside COGS, so it lands above CM1 and not below it', () => {
    const withFreight = build(2)
    const without = build(0)
    expect(withFreight.native?.values.totalCogs).toBeCloseTo(without.native!.values.totalCogs - 6567 * 2, 6)
    expect(withFreight.native?.values.cm1).toBeCloseTo(without.native!.values.cm1 - 6567 * 2, 6)
    // Revenue is untouched: this is a cost of the goods, not a deduction from
    // what Nykaa pays us.
    expect(withFreight.native?.values.netRevenueExGst).toBeCloseTo(without.native!.values.netRevenueExGst, 6)
  })

  it('keeps the Master P&L on the same margin as the statement, line for line', () => {
    const v = build(1.5)
    // In the goods, not in a shipping bucket: the statement counts it inside
    // COGS, so anywhere else leaves the two views disagreeing on gross margin.
    expect(v.canonical.lines.cogs).toBeCloseTo(371293 + 6567 * 1.5, 6)
    expect(v.canonical.lines.shipping).toBe(0)
    expect(v.canonical.lines.grossProfit).toBeCloseTo(v.native!.values.cm1, 6)
    expect(v.canonical.lines.grossMarginPct).toBeCloseTo(v.native!.values.cm1Pct, 6)
    expect(v.canonical.lines.contributionProfit).toBeCloseTo(v.native!.values.cm2, 6)
  })

  it('charges nothing and says so when no rate card is on file', () => {
    const v = build()
    expect(v.native?.values.inboundFreight).toBe(-0)
    expect(v.notes.some((n) => n.includes('No warehouse-to-Nykaa freight rate'))).toBe(true)
  })

  it('restates a closed month when the rate is corrected, rather than freezing it', () => {
    // The rate is applied when the statement is read, so the same stored month
    // reprices. A figure multiplied in at import could not do this.
    expect(build(1).native?.values.inboundFreight).toBeCloseTo(-6567, 6)
    expect(build(2).native?.values.inboundFreight).toBeCloseTo(-13134, 6)
  })
})

/**
 * Nykaa's sales file gives a discount figure on time but not a final one; what
 * is actually billed is settled by email a month or two later. A month cannot
 * wait for that, so it opens on the file's figure and a confirmed one replaces
 * it — with both kept on the statement, because the gap between them is the
 * thing worth taking up with Nykaa.
 */
describe('a confirmed Nykaa discount, entered by hand', () => {
  const august: NykaaPnlFacts = { ...legacyNykaaAugust, customerDiscount: 783214.13, cogsPriced: 371293 }
  const build = (confirmed?: number) =>
    buildChannelPnlView('nykaa', '2026-08', {
      salesRecords: [], skuMaster, fixedExpenses: [], marketing: {},
      confirmedNykaaDiscount: confirmed,
      facts: { flipkartFacts: [], amazonUsaFacts: [], meeshoFacts: [], nykaaFacts: [august] },
    })

  it('replaces what the sales file implied', () => {
    const v = build(820000)
    expect(v.native?.values.customerDiscount).toBeCloseTo(-820000, 6)
    expect(v.native?.values.netRevenueExGst).toBeCloseTo(1413147.08 - 820000, 2)
  })

  it('keeps the file figure and the gap on the statement, not just the answer', () => {
    const v = build(820000)
    expect(v.native?.values.discountPerSalesFile).toBeCloseTo(-783214.13, 2)
    expect(v.native?.values.discountConfirmationVariance).toBeCloseTo(820000 - 783214.13, 2)
    expect(v.notes.some((n) => n.includes('confirmed for 2026-08'))).toBe(true)
  })

  it('shows no memo clutter when nothing has been confirmed', () => {
    const v = build()
    expect(v.native?.values.discountPerSalesFile).toBe(0)
    expect(v.native?.values.discountConfirmationVariance).toBe(0)
    expect(v.native?.values.customerDiscount).toBeCloseTo(-783214.13, 2)
  })

  it('is honoured even when it is lower than the file, or zero', () => {
    // A confirmation of zero is a real answer — Nykaa saying it is charging
    // nothing back — and must not be read as "nothing was entered".
    expect(build(0).native?.values.customerDiscount).toBe(-0)
    expect(build(0).native?.values.netRevenueExGst).toBeCloseTo(1413147.08, 2)
    expect(build(500000).native?.values.customerDiscount).toBeCloseTo(-500000, 6)
  })

  it('does not warn about a missing discount on a month confirmed at zero', () => {
    expect(build(0).notes.some((n) => n.includes('every margin below it is overstated'))).toBe(false)
  })

  it('survives a month whose sales file was never re-imported', () => {
    // The confirmed figure is stored apart from the imported month precisely
    // so a re-upload cannot wipe it. Here the month carries no discount of its
    // own at all and the confirmation still stands.
    const legacy = { ...legacyNykaaAugust, customerPaidValue: 0 } as NykaaPnlFacts
    const v = buildChannelPnlView('nykaa', '2026-08', {
      salesRecords: [], skuMaster, fixedExpenses: [], marketing: {},
      confirmedNykaaDiscount: 820000,
      facts: { flipkartFacts: [], amazonUsaFacts: [], meeshoFacts: [], nykaaFacts: [legacy] },
    })
    expect(v.native?.values.customerDiscount).toBeCloseTo(-820000, 6)
  })

  it('keeps the Master P&L on the confirmed figure too', () => {
    const v = build(820000)
    expect(v.canonical.lines.netSales).toBeCloseTo(v.native!.values.netRevenueExGst, 6)
    expect(v.canonical.lines.discounts).toBeCloseTo(2689538 * 0.38 + 820000, 2)
  })

  it('marks the line as confirmed rather than derived', () => {
    const line = build(820000).native?.lineDefs.find((d) => d.key === 'customerDiscount')
    expect(line?.note).toContain('Confirmed with Nykaa')
  })
})
