import { describe, expect, it } from 'vitest'
import { BUSINESS_CHANNEL_IDS } from '@/config/channels'
import { amazonInHalfSplit, buildChannelPnlView, type AmazonInHalf } from './channelPnlRouter'
import type {
  AmazonInSellerPnlFacts, AmazonInSkuFeeFacts, AmazonInVendorFacts,
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

/**
 * A charge billed to one channel and settled off the platform — Flipkart's
 * NextGen programme fee, paid on a payment link — which the marketplace's own
 * export therefore cannot carry.
 */
describe('channel charges', () => {
  const base = {
    salesRecords: [] as CanonicalSalesRecord[], skuMaster, fixedExpenses: [], marketing: {},
    facts: { flipkartFacts: [flipkartFacts], amazonUsaFacts: [], meeshoFacts: [] },
    channelCharges: [{ month: '2026-06', channel: 'flipkart' as const, label: 'NextGen charges', amount: 24252 }],
  }

  it('charges the month to the channel it was billed to', () => {
    const v = buildChannelPnlView('flipkart', '2026-06', base)
    expect(v.canonical.lines.channelCharges).toBeCloseTo(24252, 6)
  })

  // Contribution is what the marketplace's own statement says it is. A charge
  // the marketplace never deducted cannot move it, or the statement and the
  // P&L would stop agreeing about the same month.
  it('comes off EBITDA and leaves contribution alone', () => {
    const without = buildChannelPnlView('flipkart', '2026-06', { ...base, channelCharges: [] }).canonical.lines
    const withIt = buildChannelPnlView('flipkart', '2026-06', base).canonical.lines
    expect(withIt.contributionProfit).toBeCloseTo(without.contributionProfit ?? 0, 6)
    expect((without.ebitda ?? 0) - (withIt.ebitda ?? 0)).toBeCloseTo(24252, 6)
  })

  // The whole point of charging it rather than allocating it: Flipkart's fee
  // is Flipkart's, and Myntra pays none of it.
  it('is carried by that channel alone', () => {
    expect(buildChannelPnlView('myntra', '2026-06', base).canonical.lines.channelCharges ?? 0).toBe(0)
    expect(buildChannelPnlView('flipkart', '2026-07', base).canonical.lines.channelCharges ?? 0).toBe(0)
  })

  // A channel with no statement of its own is the likeliest to be billed off
  // to one side, so the generic template has to carry these too.
  it('reaches a channel built from order rows', () => {
    const v = buildChannelPnlView('nykaa', '2026-06', {
      ...base,
      channelCharges: [{ month: '2026-06', channel: 'nykaa' as const, label: 'Listing fee', amount: 5000 }],
    })
    expect(v.native).toBeUndefined()
    expect(v.canonical.lines.channelCharges).toBeCloseTo(5000, 6)
    expect(v.canonical.lines.ebitda).toBeCloseTo(-5000, 6)
  })

  // One line on the P&L, several invoices behind it.
  it('adds a channel’s charges for the month into one figure', () => {
    const v = buildChannelPnlView('flipkart', '2026-06', {
      ...base,
      channelCharges: [
        { month: '2026-06', channel: 'flipkart' as const, label: 'NextGen charges', amount: 24252 },
        { month: '2026-06', channel: 'flipkart' as const, label: 'Smart Assist', amount: 7500 },
      ],
    })
    expect(v.canonical.lines.channelCharges).toBeCloseTo(31752, 6)
  })

  /**
   * The statement's line is called "(−) Allocated Fixed Expenses" on every
   * channel, a name the owner settled so two statements can be read side by
   * side. A charge folded into it silently would have September's statement
   * reporting ₹24,252 of allocated head office in a month the company
   * allocated none — the figure right and the name wrong, which is the worse
   * of the two.
   */
  it('names the charge on the statement line it lands in', () => {
    const named = buildChannelPnlView('flipkart', '2026-06', base).native?.lineDefs
      .find((d) => d.key === 'otherCosts')?.label
    expect(named).toBe('(−) Allocated Fixed Expenses & NextGen charges')
  })

  it('leaves the settled name alone in a month with no charges', () => {
    const plain = buildChannelPnlView('flipkart', '2026-06', { ...base, channelCharges: [] }).native?.lineDefs
      .find((d) => d.key === 'otherCosts')?.label
    expect(plain).toBe('(−) Allocated Fixed Expenses')
  })

  // The native statement shows one "Other Costs" line where the canonical
  // P&L shows the opex breakdown. A charge left out of it would make the
  // statement's EBITDA disagree with the canonical one by exactly the charge.
  it('is in the native statement’s other costs as well', () => {
    const without = buildChannelPnlView('flipkart', '2026-06', { ...base, channelCharges: [] })
    const withIt = buildChannelPnlView('flipkart', '2026-06', base)
    expect((without.native?.values.otherCosts ?? 0) - (withIt.native?.values.otherCosts ?? 0)).toBeCloseTo(24252, 6)
  })
})

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
 * Nykaa's output GST, blended from what the month sold.
 *
 * The range is not on one rate — hair oil and shampoo are at 5% and the rest
 * at 18% — and the statement is built from a single month-total, so the rate
 * has to come from somewhere. It comes from the order rows and the Product
 * Master, the same place the COGS is repriced from, which is why correcting a
 * rate restates the months it should instead of needing a re-upload.
 */
describe("Nykaa's output GST follows the month's own product mix", () => {
  const mixedMaster: SkuMaster[] = [
    { sku: 'AO/Shmp/Rosemary/200', productName: 'Shampoo', category: 'Hair Care', brand: 'AO', cogs: 70, mrp: 349,
      launchDate: '2025-01-01', status: 'active', leadTimeDays: 20, safetyStock: 0, gstPct: 5 },
    { sku: 'AO/SS/BodyLotion', productName: 'Sunscreen', category: 'Skin Care', brand: 'AO', cogs: 120, mrp: 549,
      launchDate: '2025-01-01', status: 'active', leadTimeDays: 20, safetyStock: 0, gstPct: 18 },
    { sku: 'AO/Unrated', productName: 'No rate yet', category: 'Skin Care', brand: 'AO', cogs: 40, mrp: 199,
      launchDate: '2025-01-01', status: 'active', leadTimeDays: 20, safetyStock: 0 },
  ]
  const row = (sku: string, net: number): CanonicalSalesRecord => ({
    orderId: `NYK-${sku}-${net}`, orderDate: '2026-08-10', channel: 'nykaa' as never, marketplace: 'nykaa',
    sellerType: 'marketplace', sku, productName: sku, category: 'Test', quantity: 1,
    grossSales: net, discount: 0, netSales: net, returnUnits: 0, rtoUnits: 0, shippingCost: 0,
    marketplaceFee: 0, tax: 0, status: 'completed', currency: 'INR', importId: 'x',
  })
  const view = (records: CanonicalSalesRecord[], master = mixedMaster) => buildChannelPnlView('nykaa', '2026-08', {
    salesRecords: records, skuMaster: master, fixedExpenses: [], marketing: {},
    facts: { flipkartFacts: [], amazonUsaFacts: [], meeshoFacts: [], nykaaFacts: [legacyNykaaAugust] },
  })

  const realisation = 2689538 * 0.62

  it('takes less tax out of a month carrying 5% lines than a flat 18% would', () => {
    const mixed = view([row('AO/Shmp/Rosemary/200', 159131), row('AO/SS/BodyLotion', 2530407)])
    const flat = -realisation * (18 / 118)
    expect(mixed.native?.values.outputGst).toBeGreaterThan(flat)
    // Less tax out is more revenue in. The flat rate was understating the
    // channel by roughly ten thousand rupees a month, not flattering it.
    expect((mixed.native?.values.outputGst ?? 0) - flat).toBeGreaterThan(5000)
    expect(mixed.canonical.lines.netSales).toBeCloseTo(mixed.native!.values.netRevenueExGst, 6)
  })

  it('leaves a month that is all 18% exactly where it was', () => {
    const v = view([row('AO/SS/BodyLotion', 2689538)])
    expect(v.native?.values.outputGst).toBeCloseTo(-realisation * (18 / 118), 2)
  })

  it('says on the line which rate took the money out', () => {
    const mixed = view([row('AO/Shmp/Rosemary/200', 159131), row('AO/SS/BodyLotion', 2530407)])
    expect(mixed.native?.lineDefs.find((d) => d.key === 'outputGst')?.note).toContain("this month's own mix")
    const flat = view([row('AO/SS/BodyLotion', 2689538)])
    expect(flat.native?.lineDefs.find((d) => d.key === 'outputGst')?.note).toContain('Taken at 18%')
  })

  it('names the products it had to assume a rate for', () => {
    const v = view([row('AO/SS/BodyLotion', 800000), row('AO/Unrated', 200000)])
    expect(v.notes.some((n) => n.includes('AO/Unrated') && n.includes('no GST rate'))).toBe(true)
  })

  it('keeps a month that states its own rate, because that is a fact about the month', () => {
    const stated = buildChannelPnlView('nykaa', '2026-08', {
      salesRecords: [row('AO/Shmp/Rosemary/200', 2689538)],
      skuMaster: mixedMaster, fixedExpenses: [], marketing: {},
      facts: {
        flipkartFacts: [], amazonUsaFacts: [], meeshoFacts: [],
        nykaaFacts: [{ ...legacyNykaaAugust, outputGstPct: 12 }],
      },
    })
    expect(stated.native?.values.outputGst).toBeCloseTo(-realisation * (12 / 112), 2)
  })

  it('falls back to the standing rate when no rows are on file to blend', () => {
    expect(view([]).native?.values.outputGst).toBeCloseTo(-realisation * (18 / 118), 2)
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
  // Order rows of the same size for both channels — and they decide nothing
  // here, because both channels have a statement for the month and a
  // statement is what the share is measured on.
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
    offAmazonAdsUsd: 0, exportDocsUsd: 0, usImportDutyUsd: 0,
  }

  const build = (channel: 'amazon_us' | 'flipkart', expenses = fixedExpenses) =>
    buildChannelPnlView(channel, '2026-08', {
      salesRecords, skuMaster, fixedExpenses: expenses, marketing: {}, fxRate: { USD: fxRate, AED: fxRate / 3.6725 },
      facts: { flipkartFacts: [flipkartAugust], amazonUsaFacts: [amazonUsa], meeshoFacts: [] },
    })

  const flipkartAugust: FlipkartPnlFacts = { ...flipkartFacts, month: '2026-08' }

  /**
   * The month's share, from the statements.
   *
   *   Amazon USA  $9,000 × 88 = ₹7,92,000  → 90.826%
   *   Flipkart                   ₹80,000   →  9.174%
   *
   * of ₹1,00,000 of fixed cost: ₹90,825.69 and ₹9,174.31.
   */
  const US_SHARE = (9000 * 88) / (9000 * 88 + 80000)

  it('reaches the Amazon USA statement, in the currency that statement is kept in', () => {
    const v = build('amazon_us')
    // Converted at the month's rate — not left in rupees, which the render to
    // INR would then multiply by the rate again.
    expect(v.native?.values.allocatedOverheadsUsd).toBeCloseTo(-(100000 * US_SHARE) / fxRate, 6)
    expect(v.native?.values.cm4).toBeCloseTo(v.native!.values.cm3 - (100000 * US_SHARE) / fxRate, 6)
    expect(v.native?.values.cm4).toBeLessThan(v.native!.values.cm3)
  })

  it('leaves Net Profit at CM3 for a month with no fixed expenses entered', () => {
    const v = build('amazon_us', [])
    expect(v.native?.values.allocatedOverheadsUsd).toBe(-0)
    expect(v.native?.values.cm4).toBeCloseTo(v.native!.values.cm3, 6)
  })

  it('reaches the multi-month P&L for every channel with its own statement', () => {
    for (const [channel, share] of [['amazon_us', US_SHARE], ['flipkart', 1 - US_SHARE]] as const) {
      const lines = build(channel).canonical.lines
      expect(lines.salaries, `${channel} salaries`).toBeCloseTo(60000 * share, 6)
      expect(lines.rent, `${channel} rent`).toBeCloseTo(40000 * share, 6)
      // EBITDA used to equal contribution on every one of these channels,
      // which is what made a month of overheads invisible on the report the
      // company is actually run from.
      expect(lines.ebitda, `${channel} ebitda`).toBeCloseTo((lines.contributionProfit ?? 0) - 100000 * share, 6)
      expect(lines.ebitda).toBeLessThan(lines.contributionProfit ?? 0)
    }
  })

  it('splits by each channel share of sales, not evenly', () => {
    expect(build('amazon_us').canonical.lines.salaries).toBeCloseTo(60000 * US_SHARE, 6)
    expect(build('flipkart').canonical.lines.salaries).toBeCloseTo(60000 * (1 - US_SHARE), 6)
    // Which is nowhere near even, on these two statements.
    expect(US_SHARE).toBeGreaterThan(0.9)
  })

  // The share is what the channel's own P&L says it sold. Order rows are the
  // fallback for a channel with no statement, not a second opinion about one
  // that has one.
  it('measures the share on the statement, not on the order rows beside it', () => {
    const lopsided = [inr('amazon_us', 150000), inr('flipkart', 50000)]
    const v = buildChannelPnlView('amazon_us', '2026-08', {
      salesRecords: lopsided, skuMaster, fixedExpenses, marketing: {}, fxRate: { USD: fxRate, AED: fxRate / 3.6725 },
      facts: { flipkartFacts: [flipkartAugust], amazonUsaFacts: [amazonUsa], meeshoFacts: [] },
    })
    expect(v.canonical.lines.salaries).toBeCloseTo(60000 * US_SHARE, 6)
  })

  /**
   * The case this was changed for.
   *
   * Amazon India's statements are the NPPM file and the Product Profitability
   * export, and neither produces a single order row. Measured on order rows it
   * sold nothing, carried nothing of the month's rent and salaries, and left
   * its share to be paid by the channels that do file order reports.
   */
  it('charges a channel that reports by statement and files no order rows', () => {
    const vendor: AmazonInVendorFacts = {
      month: '2026-08', schemaVersion: 1, periodStart: '2026-08-01', periodEnd: '2026-08-31',
      netShippedGms: 1780611.73, netPpm: 501715.79, invoiceValue: 1278895.94,
      unitsShipped: 8367, marginClosedPct: 0.32, marginAchievedPct: 0.28177,
      ccogsClaimed: 68079.97, asins: [], rows: 4000,
    }
    const inputs = {
      salesRecords, skuMaster, fixedExpenses, marketing: {},
      fxRate: { USD: fxRate, AED: fxRate / 3.6725 },
      facts: {
        flipkartFacts: [flipkartAugust], amazonUsaFacts: [amazonUsa], meeshoFacts: [],
        amazonInVendorFacts: [vendor],
      },
    }
    const amazonIn = buildChannelPnlView('amazon_in', '2026-08', inputs)
    // ₹12,78,895.94 of a ₹21,50,895.94 month is 59.46% of the fixed expenses.
    const share = 1278895.94 / (1278895.94 + 9000 * 88 + 80000)
    expect(amazonIn.canonical.lines.salaries).toBeCloseTo(60000 * share, 4)
    expect(amazonIn.native?.values.otherCosts).toBeCloseTo(-(100000 * share), 4)

    // And the channels that do file order rows stop carrying its share.
    const flipkart = buildChannelPnlView('flipkart', '2026-08', inputs)
    expect(flipkart.canonical.lines.salaries).toBeCloseTo(60000 * (80000 / (1278895.94 + 9000 * 88 + 80000)), 4)

    // Every rupee of the month is still allocated, and only once.
    const allocated = (['amazon_in', 'amazon_us', 'flipkart'] as const)
      .map((c) => buildChannelPnlView(c, '2026-08', inputs).canonical.lines)
      .reduce((sum, l) => sum + (l.salaries ?? 0) + (l.rent ?? 0), 0)
    expect(allocated).toBeCloseTo(100000, 4)
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

/**
 * A month on the order-row template says so.
 *
 * Meesho's settlement events were never stored, and because the fallback was
 * silent the generic template stood in for its statement for months while
 * reading as though it were the real one. The two are different figures on
 * different bases — the template cannot show the fees the settlement states,
 * and its Gross Sales does not tie to the file's own column.
 */
describe('a month with no settlement report', () => {
  const empty = {
    salesRecords: [], skuMaster, fixedExpenses: [], marketing: {},
    facts: { flipkartFacts: [], amazonUsaFacts: [], meeshoFacts: [] },
  }

  it('says which report is missing, for a channel that has one', () => {
    const view = buildChannelPnlView('meesho', '2026-08', empty)
    expect(view.native).toBeUndefined()
    expect(view.notes).toHaveLength(1)
    expect(view.notes[0]).toContain('Meesho')
    expect(view.notes[0]).toContain('2026-08')
    expect(view.notes[0]).toContain('aggregated payment file')
  })

  it('names each channel’s own report rather than one generic phrase', () => {
    expect(buildChannelPnlView('flipkart', '2026-08', empty).notes[0]).toContain('SKU-level P&L export')
    expect(buildChannelPnlView('nykaa', '2026-08', empty).notes[0]).toContain('monthly sales file')
    expect(buildChannelPnlView('amazon_us', '2026-08', empty).notes[0]).toContain('Product Profitability export')
  })

  it('never falls back silently: every channel names the report it is missing', () => {
    // A silent fallback is what hid Amazon UAE reading from order rows for
    // weeks — the screen showed numbers, and nothing said they were not the
    // channel's own statement. Purplle was the last channel without one.
    for (const channel of BUSINESS_CHANNEL_IDS) {
      const view = buildChannelPnlView(channel, '2026-08', empty)
      expect(view.native, channel).toBeUndefined()
      expect(view.notes, channel).toHaveLength(1)
      expect(view.notes[0], channel).toContain('2026-08')
    }
  })

  it('says which report is missing for Purplle, now that it has one', () => {
    const view = buildChannelPnlView('purplle', '2026-08', empty)
    expect(view.native).toBeUndefined()
    expect(view.notes[0]).toContain('monthly sales file')
  })

  it('says nothing once the month has its facts', () => {
    const view = buildChannelPnlView('flipkart', '2026-06', {
      ...empty,
      facts: { flipkartFacts: [flipkartFacts], amazonUsaFacts: [], meeshoFacts: [] },
    })
    expect(view.native).toBeDefined()
    expect(view.notes).toEqual([])
  })
})

/**
 * Amazon India over its two businesses.
 *
 * Figures are September 2026 as the NPPM file reads: ₹16,82,714.56 of retail
 * value at 28.729% margin, contracted at 32%, with the ₹55,045.91 shortfall
 * settled at ₹50,000.
 */
describe('buildChannelPnlView, Amazon India over Seller and Vendor Central', () => {
  const vendorFacts: AmazonInVendorFacts = {
    month: '2026-09', schemaVersion: 1, periodStart: '2026-09-01', periodEnd: '2026-09-30',
    netShippedGms: 1682714.5624999923, netPpm: 483422.7459000003,
    invoiceValue: 1682714.5624999923 - 483422.7459000003,
    unitsShipped: 7486, marginClosedPct: 0.32, marginAchievedPct: 0.2872874322676473,
    ccogsClaimed: 55045.914099997244, ccogsDeductions: 5046, ccogsFinal: 50000,
    asins: [
      { asin: 'B0CPFP8NNB', title: 'Body lotion', units: 880, gms: 220000, ppm: 49094.87, invoice: 170905.13 },
      { asin: 'B0UNKNOWN1', title: 'Unlinked', units: 100, gms: 20000, ppm: 5000, invoice: 15000 },
    ],
    rows: 5178,
    ixd: {
      unitsUnpacked: 3888, ratePerUnit: 2, charge: 7776, valueUnpacked: 702461.66,
      periodStart: '2026-09-02', periodEnd: '2026-09-21', asins: 19,
    },
  }
  const vendorSkuMaster: SkuMaster[] = [
    { sku: 'AO/SS/BodyLotion', productName: 'Body lotion', category: 'Skin Care', brand: 'Aravi Organic', cogs: 75.5, mrp: 399, launchDate: '2025-01-01', status: 'active', leadTimeDays: 21, safetyStock: 100 },
  ]
  const base = {
    salesRecords: [], skuMaster: vendorSkuMaster, fixedExpenses: [], marketing: {},
    cogs: { mappings: [{ channelSku: 'B0CPFP8NNB', internalSku: 'AO/SS/BodyLotion', kind: 'SINGLE' as const, source: 'manual' as const, verified: true }], comboComponents: [] },
    facts: { flipkartFacts: [], amazonUsaFacts: [], meeshoFacts: [], amazonInVendorFacts: [vendorFacts] },
  }

  it('shows the wholesale statement where the vendor month is on file', () => {
    const view = buildChannelPnlView('amazon_in', '2026-09', base)
    expect(view.native?.lineDefs.some((d) => d.key === 'invoiceValue')).toBe(true)
    expect(view.native?.values.invoiceValue).toBeCloseTo(1199291.82, 2)
    expect(view.native?.values.netRevenue).toBeCloseTo(1199291.82, 2)
    expect(view.native?.values.contraCogs).toBe(-50000)
  })

  it('prices COGS from the ASINs the file lists, and estimates the rest', () => {
    const view = buildChannelPnlView('amazon_in', '2026-09', base)
    expect(view.native?.values.cogsPriced).toBeCloseTo(-(880 * 75.5), 2)
    // The unlinked ASIN is costed at the average of the priced units, which
    // is the estimate every other channel in this build uses.
    expect(view.native?.values.cogsUnpriced).toBeCloseTo(-(100 * 75.5), 2)
  })

  it('charges the cross-dock on units unpacked', () => {
    const view = buildChannelPnlView('amazon_in', '2026-09', base)
    expect(view.native?.values.ixd).toBe(-7776)
    expect(view.native?.values.unitsUnpacked).toBe(3888)
  })

  it('rolls the trade margin up as a discount, so net sales is the invoice', () => {
    const view = buildChannelPnlView('amazon_in', '2026-09', base)
    expect(view.canonical.lines.grossSales).toBeCloseTo(1682714.56, 2)
    expect(view.canonical.lines.discounts).toBeCloseTo(483422.75, 2)
    expect(view.canonical.lines.marketplaceCommission).toBe(0)
    expect(view.canonical.lines.netSales).toBeCloseTo(1199291.82, 2)
  })

  it('adds the Seller Central month to the roll-up without putting it in the statement', () => {
    const seller: AmazonInSellerPnlFacts = {
      month: '2026-09', schemaVersion: 1, settlementIds: ['s1'],
      amounts: { 'order.itemprice.principal': 6000 }, settlementTotal: 6160.14, orders: 15, units: 15,
    }
    const view = buildChannelPnlView('amazon_in', '2026-09', {
      ...base,
      facts: { ...base.facts, amazonInSellerFacts: [seller] },
    })
    // The statement stays wholesale; the roll-up carries both.
    expect(view.native?.values.invoiceValue).toBeCloseTo(1199291.82, 2)
    expect(view.canonical.lines.grossSales).toBeCloseTo(1682714.56 + 6000, 2)
    expect(view.notes.some((n) => n.includes('settled on Seller Central'))).toBe(true)
  })

  // One ad account lifts both halves, so the spend is charged once.
  it('charges the channel advertising once across the two halves', () => {
    const seller: AmazonInSellerPnlFacts = {
      month: '2026-09', schemaVersion: 1, settlementIds: ['s1'],
      amounts: { 'order.itemprice.principal': 6000 }, settlementTotal: 6160.14, orders: 15, units: 15, ads: 202718.37,
    }
    const view = buildChannelPnlView('amazon_in', '2026-09', {
      ...base,
      marketing: { amazon_in: { ads: 202718.37 } },
      facts: { ...base.facts, amazonInSellerFacts: [seller] },
    })
    expect(view.native?.values.ads).toBeCloseTo(-202718.37, 2)
    expect(view.canonical.lines.ads).toBeCloseTo(202718.37, 2)
  })

  it('says what the month is missing rather than charging nothing quietly', () => {
    const noIxd = { ...vendorFacts, ixd: undefined }
    const view = buildChannelPnlView('amazon_in', '2026-09', {
      ...base, facts: { ...base.facts, amazonInVendorFacts: [noIxd] },
    })
    expect(view.native?.values.ixd).toBe(0)
    expect(view.notes.some((n) => n.includes('inward cross-dock'))).toBe(true)
    expect(view.notes.some((n) => n.includes('no cost behind them'))).toBe(true)
    expect(view.notes.some((n) => n.includes('contra-COGS'))).toBe(true)
  })

  it('leaves a month with no vendor file on the Seller Central statement', () => {
    const seller: AmazonInSellerPnlFacts = {
      month: '2026-08', schemaVersion: 1, settlementIds: ['s1'],
      amounts: { 'order.itemprice.principal': 6000 }, settlementTotal: 6640.37, orders: 16, units: 16,
    }
    const view = buildChannelPnlView('amazon_in', '2026-08', {
      ...base, facts: { ...base.facts, amazonInSellerFacts: [seller] },
    })
    expect(view.native?.lineDefs.some((d) => d.key === 'settlementTotal')).toBe(true)
    expect(view.native?.values.invoiceValue).toBeUndefined()
  })

  /**
   * Reading the two businesses one at a time.
   *
   * The property that makes this a view of the channel rather than a second
   * set of numbers: whichever way it is read, the halves add to the whole. So
   * the shared ad spend is charged on one side only, and the month's fixed
   * expenses are divided between them instead of charged twice.
   */
  describe('one business at a time', () => {
    const seller: AmazonInSellerPnlFacts = {
      month: '2026-09', schemaVersion: 1, settlementIds: ['s1'],
      amounts: {
        'order.itemprice.principal': 120000,
        'order.itemfees.commission': -18000,
        'order.itemfees.fixed-closing-fee': -2000,
      },
      settlementTotal: 100000, orders: 300, units: 300,
    }
    const inputs = {
      ...base,
      fixedExpenses: [{ month: '2026-09', category: 'rent', amount: 100000 }] as FixedExpenseEntry[],
      marketing: { amazon_in: { ads: 202718.37 } },
      facts: { ...base.facts, amazonInSellerFacts: [seller] },
    }
    const half = (amazonInHalf: AmazonInHalf) =>
      buildChannelPnlView('amazon_in', '2026-09', { ...inputs, amazonInHalf })

    it('reports the wholesale business with nothing of the marketplace in it', () => {
      const v = half('vendor')
      expect(v.native?.values.invoiceValue).toBeCloseTo(1199291.82, 2)
      expect(v.canonical.lines.grossSales).toBeCloseTo(1682714.56, 2)
      expect(v.notes.some((n) => n.includes('Vendor Central on its own'))).toBe(true)
    })

    it('reports the marketplace business on its own settlement', () => {
      const v = half('seller')
      expect(v.native?.lineDefs.some((d) => d.key === 'settlementTotal')).toBe(true)
      expect(v.native?.values.netSales).toBeCloseTo(120000, 2)
      expect(v.canonical.lines.grossSales).toBeCloseTo(120000, 2)
      expect(v.canonical.lines.marketplaceCommission).toBeCloseTo(18000, 2)
      expect(v.notes.some((n) => n.includes('Seller Central on its own'))).toBe(true)
    })

    // One AMC account lifts both halves, so the spend belongs to the side
    // that carries it. Charged on both, the channel would pay for its
    // advertising twice.
    it('charges the shared advertising to one side only', () => {
      expect(half('vendor').canonical.lines.ads).toBeCloseTo(202718.37, 2)
      expect(half('seller').canonical.lines.ads).toBe(0)
      expect(half('both').canonical.lines.ads).toBeCloseTo(202718.37, 2)
    })

    // Rent is allocated to Amazon India, not to a business inside it, so
    // reading one half shows that half's share of it.
    it('divides the month’s fixed expenses between the halves', () => {
      const v = half('vendor').native?.values.otherCosts ?? 0
      const s = half('seller').native?.values.otherCosts ?? 0
      const whole = half('both').native?.values.otherCosts ?? 0
      expect(whole).toBeLessThan(0)
      expect(v + s).toBeCloseTo(whole, 6)
      // Wholesale is ten times the marketplace this month, and carries that
      // much more of the overhead.
      expect(v).toBeLessThan(s)
    })

    // A charge is the channel's, not a business inside it, so reading one
    // half shows that half's share of it — the same rule the overhead
    // follows, and for the same reason: the halves have to add to the whole.
    it('divides a channel charge between the halves', () => {
      const withCharge = {
        ...inputs,
        channelCharges: [{ month: '2026-09', channel: 'amazon_in' as const, label: 'Vendor flex fee', amount: 50000 }],
      }
      const at = (amazonInHalf: AmazonInHalf) =>
        buildChannelPnlView('amazon_in', '2026-09', { ...withCharge, amazonInHalf }).canonical.lines.channelCharges ?? 0
      expect(at('both')).toBeCloseTo(50000, 6)
      expect(at('vendor') + at('seller')).toBeCloseTo(50000, 6)
      expect(at('seller')).toBeGreaterThan(0)
    })

    it('adds up to the channel, line by line', () => {
      const whole = half('both').canonical.lines
      const v = half('vendor').canonical.lines
      const s = half('seller').canonical.lines
      for (const key of Object.keys(whole) as (keyof typeof whole)[]) {
        // A margin percentage is a ratio, so it is the one thing two halves
        // cannot be added together on.
        if (key.endsWith('Pct')) continue
        expect((v[key] ?? 0) + (s[key] ?? 0), `${key} does not add up`).toBeCloseTo(whole[key] ?? 0, 6)
      }
    })
  })

  /**
   * The marketplace half, from the export that states the whole month.
   *
   * Its two sources are two readings of the same trading: the Product
   * Profitability export states every SKU sold, a settlement report states
   * one fortnight's cash. September's real figures — ₹2,23,113.63 of net
   * sales against the ₹6,929.64 its one uploaded settlement covers.
   */
  describe('Seller Central, from the Product Profitability export', () => {
    const exportMonth: AmazonInSkuFeeFacts = {
      month: '2026-09', schemaVersion: 1,
      grossSalesInr: 234275.02, netSalesInr: 223113.63,
      unitsSoldQty: 461, unitsReturnedQty: 23, netUnitsSoldQty: 438,
      sheetNetProceedsInr: 157562.82, sheetCogsInr: 0, sheetMiscCostInr: 0, nonSellingChargedRows: 1,
      nestedFeeIds: [],
      feeTotalsInr: { referralFee: 19028.21, fbaWeightHandlingFee: 6110.04 },
      unmappedFeeTotalsInr: {},
      feeBySkuInr: { B0CPFP8NNB: { referralFee: 19028.21 }, UNLINKED: { fbaWeightHandlingFee: 6110.04 } },
      unitsBySku: { B0CPFP8NNB: 400, UNLINKED: 38 },
      netSalesBySku: { B0CPFP8NNB: 200000, UNLINKED: 23113.63 },
    }
    const settlement: AmazonInSellerPnlFacts = {
      month: '2026-09', schemaVersion: 1, settlementIds: ['27765599792'],
      amounts: { 'order.itemprice.principal': 8241.5, 'order.itemfees.commission': -672.15 },
      settlementTotal: 6160.14, orders: 14, units: 15,
    }
    const inputs = {
      ...base,
      facts: { ...base.facts, amazonInSkuFeeFacts: [exportMonth], amazonInSellerFacts: [settlement] },
    }
    const half = (amazonInHalf: AmazonInHalf) =>
      buildChannelPnlView('amazon_in', '2026-09', { ...inputs, amazonInHalf })

    it('reads the month from the export, not from the one settlement on file', () => {
      const v = half('seller')
      expect(v.native?.values.netSales).toBeCloseTo(223113.63, 2)
      expect(v.native?.values['fee.referralFee']).toBeCloseTo(-19028.21, 2)
      // The settlement statement's own lines are nowhere on it.
      expect(v.native?.values.settlementTotal).toBeUndefined()
    })

    it('prices the goods from the MSKUs the export lists', () => {
      // 400 units of a mapped SKU at ₹75.50, and 38 of one with no cost.
      const v = half('seller')
      expect(v.native?.values.cogsPriced).toBeCloseTo(-(400 * 75.5), 2)
      expect(v.native?.values.cogsUnpriced).toBeCloseTo(-(38 * 75.5), 2)
      expect(v.notes.some((n) => n.includes('no cost behind them'))).toBe(true)
    })

    it('counts the month once, never the export plus the settlement', () => {
      const whole = half('both').canonical.lines
      // The channel is the wholesale invoice plus the export's own sales. The
      // settlement is the same trading read a second way and is not added.
      expect(whole.grossSales).toBeCloseTo(1682714.56 + 234275.02, 2)
    })

    it('says what the settlements on file do and do not cover', () => {
      expect(half('seller').notes.some((n) => n.includes('settlement period(s)'))).toBe(true)
    })

    // Amazon computes its own Net proceeds, and September's does not meet the
    // fees read here by ₹1,052.56 — a charge in the file nobody has named.
    it('reports a gap against Amazon’s own net proceeds rather than hiding it', () => {
      const v = half('seller')
      expect(v.native?.values.netProceedsDiff).toBeCloseTo(223113.63 - 19028.21 - 6110.04 - 157562.82, 2)
      expect(v.notes.some((n) => n.includes('Net proceeds'))).toBe(true)
    })

    it('still adds up to the channel, line by line', () => {
      const whole = half('both').canonical.lines
      const v = half('vendor').canonical.lines
      const s = half('seller').canonical.lines
      for (const key of Object.keys(whole) as (keyof typeof whole)[]) {
        if (key.endsWith('Pct')) continue
        expect((v[key] ?? 0) + (s[key] ?? 0), `${key} does not add up`).toBeCloseTo(whole[key] ?? 0, 6)
      }
    })

    it('falls back to the settlement in a month the export does not cover', () => {
      const august: AmazonInSellerPnlFacts = { ...settlement, month: '2026-08' }
      const v = buildChannelPnlView('amazon_in', '2026-08', {
        ...inputs,
        facts: { ...inputs.facts, amazonInVendorFacts: [], amazonInSellerFacts: [august] },
        amazonInHalf: 'seller',
      })
      expect(v.native?.lineDefs.some((d) => d.key === 'settlementTotal')).toBe(true)
    })

    // The share each half is of the channel, which is what the P&L screen
    // labels its VC and SC buttons with: picking one has to say how much of
    // Amazon India is being left out.
    it('splits the channel between the halves on net sales', () => {
      const split = amazonInHalfSplit(inputs.facts, ['2026-09'])
      expect(split.vendorNet).toBeCloseTo(1199291.82, 2)
      expect(split.sellerNet).toBeCloseTo(223113.63, 2)
      expect(split.vendorPct).toBeCloseTo((1199291.82 / (1199291.82 + 223113.63)) * 100, 4)
      expect((split.vendorPct ?? 0) + (split.sellerPct ?? 0)).toBeCloseTo(100, 6)
    })

    it('reads the marketplace share from the export, not the settlement', () => {
      // The settlement for the month covers ₹6,929.64 of the ₹2,23,113.63 the
      // export states. Taking the settlement would put SC at under 1%.
      const split = amazonInHalfSplit(inputs.facts, ['2026-09'])
      expect(split.sellerPct ?? 0).toBeGreaterThan(10)
      const settlementOnly = amazonInHalfSplit({ ...inputs.facts, amazonInSkuFeeFacts: [] }, ['2026-09'])
      expect(settlementOnly.sellerNet).toBeCloseTo(8241.5, 2)
    })

    it('sums the split over the months asked for, and shows none where nothing traded', () => {
      const split = amazonInHalfSplit(inputs.facts, ['2026-08', '2026-09'])
      expect(split.vendorNet).toBeCloseTo(1199291.82, 2)
      const empty = amazonInHalfSplit(inputs.facts, ['2026-01'])
      expect(empty.vendorPct).toBeNull()
      expect(empty.sellerPct).toBeNull()
    })

    /**
     * July 2026: an export, no NPPM file, and ₹3,53,388.82 of measured
     * Sponsored Products spend on file. Charged only on the wholesale
     * statement, that spend was charged on neither — the month read as having
     * advertised for nothing.
     */
    it('charges the month’s ad spend where there is no wholesale statement to carry it', () => {
      const july = { ...exportMonth, month: '2026-07', netSalesInr: 199532.13, grossSalesInr: 217838.24 }
      const v = buildChannelPnlView('amazon_in', '2026-07', {
        ...inputs,
        marketing: { amazon_in: { ads: 353388.82 } },
        facts: { ...inputs.facts, amazonInSkuFeeFacts: [july], amazonInSellerFacts: [], amazonInVendorFacts: [] },
      })
      expect(v.native?.values.channelAds).toBeCloseTo(-353388.82, 2)
      expect(v.native?.values.totalAdvertising).toBeCloseTo(-353388.82, 2)
      expect(v.canonical.lines.ads).toBeCloseTo(353388.82, 2)
      expect(v.notes.some((n) => n.includes('understated until that month'))).toBe(true)
    })

    // Amazon's own Net proceeds column cannot know about spend it did not
    // bill, so the reconciliation has to ignore the campaign figure.
    it('keeps the campaign spend out of Amazon’s own net-proceeds check', () => {
      const withAds = buildChannelPnlView('amazon_in', '2026-09', {
        ...inputs,
        marketing: { amazon_in: { ads: 353388.82 } },
        facts: { ...inputs.facts, amazonInVendorFacts: [] },
        amazonInHalf: 'seller',
      })
      const without = buildChannelPnlView('amazon_in', '2026-09', {
        ...inputs, facts: { ...inputs.facts, amazonInVendorFacts: [] }, amazonInHalf: 'seller',
      })
      expect(withAds.native?.values.netProceedsDiff).toBeCloseTo(without.native?.values.netProceedsDiff ?? 0, 6)
    })

    // With both halves on file the wholesale statement carries it, which is
    // what keeps the two halves adding to the channel.
    it('still charges it once when both halves are on file', () => {
      const both = { ...inputs, marketing: { amazon_in: { ads: 202718.37 } } }
      const vendor = buildChannelPnlView('amazon_in', '2026-09', { ...both, amazonInHalf: 'vendor' })
      const seller = buildChannelPnlView('amazon_in', '2026-09', { ...both, amazonInHalf: 'seller' })
      const whole = buildChannelPnlView('amazon_in', '2026-09', { ...both, amazonInHalf: 'both' })
      expect(vendor.canonical.lines.ads).toBeCloseTo(202718.37, 2)
      expect(seller.canonical.lines.ads).toBe(0)
      expect(whole.canonical.lines.ads).toBeCloseTo(202718.37, 2)
    })

    it('estimates the cost of a month imported before units per SKU were read', () => {
      const old = { ...exportMonth, unitsBySku: undefined, netSalesBySku: undefined }
      const v = buildChannelPnlView('amazon_in', '2026-09', {
        ...inputs, facts: { ...inputs.facts, amazonInSkuFeeFacts: [old] }, amazonInHalf: 'seller',
      })
      expect(v.native?.values.cogsPriced).toBe(0)
      expect(v.native?.values.cogsUnpriced).toBeLessThan(0)
      expect(v.notes.some((n) => n.includes('export for the month again'))).toBe(true)
    })
  })
})

/**
 * Amazon UAE's advertising, which has nowhere else to come from.
 *
 * The Product Profitability export Amazon sends for the UAE carries no fee
 * columns at all — no referral fee, no fulfilment, no advertising — so the
 * console's monthly cost report is the only statement of what the channel
 * spent. Until it was read, the canonical buckets held `ads: 0` and the
 * statement had no advertising line, so a month that cost AED 1,547 reported
 * none and an EBITDA that much too good.
 */
describe('Amazon UAE advertising', () => {
  const facts = {
    month: '2026-09', schemaVersion: 1 as const, grossSalesAed: 7501.29, netSalesAed: 7250.33,
    netProceedsAed: 4311.287, cogsSourceInr: 8880.25, unitsSoldQty: 241, unitsReturnedQty: 7,
    netUnitsSoldQty: 234, nonSellingRows: 3,
  }
  const inputs = {
    salesRecords: [] as CanonicalSalesRecord[], skuMaster, fixedExpenses: [],
    facts: { flipkartFacts: [], amazonUsaFacts: [], meeshoFacts: [], amazonAeFacts: [facts] },
    fxRate: { USD: 88, AED: 26 },
  }
  const view = (ads: number) =>
    buildChannelPnlView('amazon_ae', '2026-09', { ...inputs, marketing: ads === 0 ? {} : { amazon_ae: { ads } } })

  // The marketing input is rupees; the statement is dirhams. AED 272.11 at
  // the month's 26 is ₹7,074.86, and it has to read as 272.11 again on the
  // statement or the two disagree about one month.
  it('charges it in rupees on the roll-up and in dirhams on the statement', () => {
    const v = view(7074.86)
    expect(v.canonical.lines.ads).toBeCloseTo(7074.86, 2)
    expect(v.native?.values.ads).toBeCloseTo(-272.11, 2)
  })

  it('takes it off EBITDA, on both', () => {
    const before = view(0)
    const after = view(7074.86)
    expect((before.canonical.lines.ebitda ?? 0) - (after.canonical.lines.ebitda ?? 0)).toBeCloseTo(7074.86, 2)
    expect((before.native?.values.ebitda ?? 0) - (after.native?.values.ebitda ?? 0)).toBeCloseTo(272.11, 2)
  })

  // Amazon does not bill it through the settlement this statement
  // reconciles to, so it cannot move what Amazon took or what Amazon paid.
  it('leaves Amazon’s own figures where they were', () => {
    const before = view(0)
    const after = view(7074.86)
    expect(after.native?.values.netProceeds).toBeCloseTo(before.native?.values.netProceeds ?? 0, 6)
    expect(after.native?.values.amazonFees).toBeCloseTo(before.native?.values.amazonFees ?? 0, 6)
    expect(after.canonical.lines.netSales).toBeCloseTo(before.canonical.lines.netSales ?? 0, 6)
  })

  it('shows no advertising line in a month with none', () => {
    expect(view(0).native?.values.ads).toBe(-0)
  })
})
