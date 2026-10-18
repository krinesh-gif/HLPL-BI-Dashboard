import { describe, expect, it } from 'vitest'
import { allocateFixedExpensesForMonth, computeSalesContributionWeights } from './allocation'
import { STATEMENT_CHANNELS } from './channelNetSales'
import { BUSINESS_CHANNEL_IDS } from '@/config/channels'
import type {
  AmazonInVendorFacts, CanonicalSalesRecord, FixedExpenseEntry, FlipkartPnlFacts,
} from '@/data/models'

function record(
  channel: CanonicalSalesRecord['channel'],
  netSales: number,
  orderDate = '2026-06-10',
): CanonicalSalesRecord {
  return {
    orderId: `${channel}-1`, orderDate, channel, marketplace: channel, sellerType: 'marketplace',
    sku: 'SKU-1', productName: 'Test', category: 'Test', quantity: 1, grossSales: netSales, discount: 0,
    netSales, returnUnits: 0, rtoUnits: 0, shippingCost: 0, marketplaceFee: 0, tax: 0,
    status: 'completed', currency: 'INR', importId: 'test',
  }
}

describe('computeSalesContributionWeights', () => {
  it('weights channels by their share of net sales for the month', () => {
    // Rows are keyed by the report they came from; weights are per business
    // channel, so both Amazon India reports land on one weight.
    const records = [record('amazon_in_seller', 600), record('amazon_in_vendor', 200), record('flipkart', 200)]
    const weights = computeSalesContributionWeights(records, '2026-06')
    expect(weights.amazon_in).toBeCloseTo(0.8)
    expect(weights.flipkart).toBeCloseTo(0.2)
    expect(weights.meesho).toBe(0)
  })

  it('falls back to default weights when there is no sales data for the month', () => {
    const weights = computeSalesContributionWeights([], '2026-06')
    expect(weights.amazon_in).toBeGreaterThan(0)
    const total = Object.values(weights).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1)
  })
})

describe('allocateFixedExpensesForMonth', () => {
  it('splits each expense category proportionally to sales share', () => {
    const records = [record('amazon_in_seller', 400), record('amazon_in_vendor', 200), record('flipkart', 400)]
    const fixedExpenses: FixedExpenseEntry[] = [
      { month: '2026-06', category: 'rent', amount: 100000 },
      { month: '2026-05', category: 'rent', amount: 999999 }, // different month, must be ignored
    ]
    const allocation = allocateFixedExpensesForMonth(records, fixedExpenses, '2026-06')
    expect(allocation.amazon_in?.rent).toBeCloseTo(60000)
    expect(allocation.flipkart?.rent).toBeCloseTo(40000)
  })
})

describe('fixed expenses entered as a single figure', () => {
  /**
   * The split is worked out in a spreadsheet, so the dashboard takes one total
   * a month. It has to allocate and roll up exactly as the nine named
   * categories did, or moving to it would quietly change every channel's net
   * profit.
   */
  const records = [
    { orderId: '1', orderDate: '2026-08-01', channel: 'flipkart' as const, marketplace: 'flipkart', sellerType: 'marketplace' as const, sku: 'S1', productName: 'T', category: 'T', quantity: 1, grossSales: 75000, discount: 0, netSales: 75000, returnUnits: 0, rtoUnits: 0, shippingCost: 0, marketplaceFee: 0, tax: 0, status: 'completed' as const, currency: 'INR' as const, importId: 'x' },
    { orderId: '2', orderDate: '2026-08-01', channel: 'nykaa' as const, marketplace: 'nykaa', sellerType: 'marketplace' as const, sku: 'S1', productName: 'T', category: 'T', quantity: 1, grossSales: 25000, discount: 0, netSales: 25000, returnUnits: 0, rtoUnits: 0, shippingCost: 0, marketplaceFee: 0, tax: 0, status: 'completed' as const, currency: 'INR' as const, importId: 'x' },
  ]

  it('splits the one figure by each channel share of sales', () => {
    const a = allocateFixedExpensesForMonth(records, [
      { month: '2026-08', category: 'fixedExpensesTotal', amount: 100000 },
    ], '2026-08')
    expect(a.flipkart?.fixedExpensesTotal).toBeCloseTo(75000, 6)
    expect(a.nykaa?.fixedExpensesTotal).toBeCloseTo(25000, 6)
  })

  it('allocates the same total however it was entered', () => {
    const asOne = allocateFixedExpensesForMonth(records, [
      { month: '2026-08', category: 'fixedExpensesTotal', amount: 100000 },
    ], '2026-08')
    const byCategory = allocateFixedExpensesForMonth(records, [
      { month: '2026-08', category: 'salaries', amount: 60000 },
      { month: '2026-08', category: 'rent', amount: 40000 },
    ], '2026-08')
    const sum = (v: Record<string, number | undefined>): number =>
      Object.values(v).reduce<number>((acc, x) => acc + (x ?? 0), 0)
    expect(sum(asOne.flipkart ?? {})).toBeCloseTo(sum(byCategory.flipkart ?? {}), 6)
    expect(sum(asOne.nykaa ?? {})).toBeCloseTo(sum(byCategory.nykaa ?? {}), 6)
  })
})

/**
 * The share is measured on each channel's own P&L, which is the only basis
 * that includes a channel reporting by statement.
 *
 * Amazon India is the case: its months come from the NPPM file and the
 * Product Profitability export, neither of which produces an order row, so on
 * the order-row basis it had sold nothing and carried none of the company's
 * rent — ₹0 of September's ₹5,52,739, with Flipkart, Myntra and Meesho
 * carrying its share between them.
 */
describe('a channel that reports by statement rather than by order row', () => {
  const vendor: AmazonInVendorFacts = {
    month: '2026-09', schemaVersion: 1, periodStart: '2026-09-01', periodEnd: '2026-09-30',
    netShippedGms: 1682714.56, netPpm: 483422.75, invoiceValue: 1199291.81,
    unitsShipped: 7486, marginClosedPct: 0.32, marginAchievedPct: 0.2873,
    ccogsClaimed: 55045.91, asins: [], rows: 5178,
  }
  const flipkart: FlipkartPnlFacts = {
    month: '2026-09', grossSales: 1500000, estimatedNetSales: 1199291.81, cogsPriced: 0, cogsUnpriced: 0,
    commissionFee: 0, collectionFee: 0, fixedFee: 0, pickPackFee: 0, forwardShippingFee: 0,
    reverseShippingFee: 0, storageFee: 0, recallFee: 0, otherMarketplaceFees: 0, rewardsSpf: 0,
    flipkartAds: 0, sellerFundedDiscount: 0, customerAddOns: 0, outputGst: 0, googleAds: 0,
  }
  const facts = {
    flipkartFacts: [flipkart], amazonUsaFacts: [], meeshoFacts: [], amazonInVendorFacts: [vendor],
  }

  it('counts its statement, not the order rows it does not file', () => {
    const weights = computeSalesContributionWeights([], '2026-09', facts)
    // Both channels invoiced the same, so they split the month in half.
    expect(weights.amazon_in).toBeCloseTo(0.5, 6)
    expect(weights.flipkart).toBeCloseTo(0.5, 6)
  })

  it('carried nothing at all before, which is what the change is for', () => {
    const weights = computeSalesContributionWeights([record('flipkart', 1199291.81, '2026-09-10')], '2026-09')
    expect(weights.amazon_in).toBe(0)
    expect(weights.flipkart).toBeCloseTo(1, 6)
  })

  it('splits the month’s expenses on that basis', () => {
    const expenses: FixedExpenseEntry[] = [{ month: '2026-09', category: 'rent', amount: 552739 }]
    const allocation = allocateFixedExpensesForMonth([], expenses, '2026-09', facts)
    expect(allocation.amazon_in?.rent).toBeCloseTo(552739 / 2, 4)
    expect(allocation.flipkart?.rent).toBeCloseTo(552739 / 2, 4)
    // Every rupee allocated, once.
    const total = Object.values(allocation).reduce((sum, lines) => sum + (lines.rent ?? 0), 0)
    expect(total).toBeCloseTo(552739, 4)
  })

  it('prefers the statement over order rows for the same channel', () => {
    // Flipkart files both. The statement is what its P&L reports, so it is
    // what the share is measured on — the rows are not a second opinion.
    const withRows = computeSalesContributionWeights([record('flipkart', 50, '2026-09-10')], '2026-09', facts)
    expect(withRows.flipkart).toBeCloseTo(0.5, 6)
  })

  // The guarantee the owner asked for, which the type system enforces: a
  // channel added to the registry cannot compile until this file says how its
  // statement is read. This is the runtime echo of that, so the promise is
  // visible in the test output too.
  it('reads a statement for every channel the company has', () => {
    expect([...STATEMENT_CHANNELS].sort()).toEqual([...BUSINESS_CHANNEL_IDS].sort())
  })
})
