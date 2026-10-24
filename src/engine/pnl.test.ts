import { describe, expect, it } from 'vitest'
import { buildChannelPnl, buildMasterPnl, computeSubtotals } from './pnl'
import type { CanonicalSalesRecord, FixedExpenseEntry, SkuMaster } from '@/data/models'

const skuMaster: SkuMaster[] = [
  {
    sku: 'SKU-1', productName: 'Test Product', category: 'Test', brand: 'HLPL',
    cogs: 100, mrp: 500, launchDate: '2025-01-01',
    status: 'active', leadTimeDays: 20, safetyStock: 50,
  },
]

function record(overrides: Partial<CanonicalSalesRecord>): CanonicalSalesRecord {
  return {
    orderId: 'o1', orderDate: '2026-06-15', channel: 'amazon_in_seller', marketplace: 'amazon_in_seller',
    sellerType: 'seller_central', sku: 'SKU-1', productName: 'Test Product', category: 'Test',
    quantity: 10, grossSales: 4000, discount: 200, netSales: 3600, returnUnits: 0, rtoUnits: 0,
    shippingCost: 100, marketplaceFee: 600, tax: 40, status: 'completed', currency: 'INR',
    importId: 'test', ...overrides,
  }
}

describe('computeSubtotals', () => {
  it('computes net sales, gross profit, contribution, and EBITDA correctly', () => {
    const lines = computeSubtotals({
      grossSales: 1000, discounts: 50, returns: 50,
      cogs: 300,
      marketplaceCommission: 100, shipping: 50,
      ads: 80,
      salaries: 100, rent: 50,
    })
    expect(lines.netSales).toBe(900)
    expect(lines.grossProfit).toBe(600)
    expect(lines.grossMarginPct).toBeCloseTo((600 / 900) * 100)
    expect(lines.contributionProfit).toBe(600 - 150 - 80)
    expect(lines.ebitda).toBe(370 - 150)
  })

  it('does not divide by zero when net sales is zero', () => {
    const lines = computeSubtotals({})
    expect(lines.grossMarginPct).toBe(0)
    expect(lines.contributionMarginPct).toBe(0)
    expect(lines.ebitdaMarginPct).toBe(0)
  })
})

describe('buildChannelPnl', () => {
  it('pulls COGS from the SKU master, not from order data', () => {
    const records = [record({}), record({ orderId: 'o2', quantity: 5, grossSales: 2000, netSales: 1800 })]
    const pnl = buildChannelPnl(records, skuMaster, [], 'amazon_in', '2026-06', {})
    // 15 total units * 100 COGS
    expect(pnl.lines.cogs).toBe(1500)
  })

  it('is unaffected by re-importing the same order data twice for COGS/marketing lines', () => {
    const records = [record({})]
    const marketing = { amazon_in: { ads: 500 } }
    const pnl1 = buildChannelPnl(records, skuMaster, [], 'amazon_in', '2026-06', marketing)
    const pnl2 = buildChannelPnl([...records, ...records], skuMaster, [], 'amazon_in', '2026-06', marketing)
    // Marketing is sourced independently of order volume.
    expect(pnl1.lines.ads).toBe(500)
    expect(pnl2.lines.ads).toBe(500)
  })

  it('excludes records outside the requested channel/month', () => {
    const records = [
      record({}),
      record({ orderId: 'o2', channel: 'flipkart' }),
      record({ orderId: 'o3', orderDate: '2026-05-01' }),
    ]
    const pnl = buildChannelPnl(records, skuMaster, [], 'amazon_in', '2026-06', {})
    expect(pnl.lines.grossSales).toBe(4000)
  })
})

describe('buildMasterPnl', () => {
  it('sums input lines across all channel P&Ls and recomputes subtotals', () => {
    const fixedExpenses: FixedExpenseEntry[] = []
    const records = [record({}), record({ orderId: 'o2', channel: 'flipkart' })]
    const channelPnls = ['amazon_in', 'flipkart'].map((ch) =>
      buildChannelPnl(records, skuMaster, fixedExpenses, ch as 'amazon_in' | 'flipkart', '2026-06', {}),
    )
    const master = buildMasterPnl(channelPnls, '2026-06')
    expect(master.lines.grossSales).toBe(8000)
    expect(master.lines.cogs).toBe(2000)
    expect(master.lines.netSales).toBe(master.lines.grossSales! - master.lines.discounts! - master.lines.returns!)
  })

  /**
   * What the Channel EBITDA chart claims under it: that its bars add to the
   * company's EBITDA. They do because every subtotal between a channel's
   * input lines and its EBITDA is a sum or a difference, so summing the
   * channels and then subtotalling is the same arithmetic as subtotalling
   * each channel and then summing. Worth a test rather than an argument: a
   * subtotal that ever stops being linear — a floor at zero, a cap, a rate
   * applied to a total — would break the claim silently.
   */
  it('adds each channel’s EBITDA to the company’s, fixed expenses and losses included', () => {
    const fixedExpenses: FixedExpenseEntry[] = [
      { month: '2026-06', category: 'fixedExpensesTotal', amount: 552739 },
    ]
    const records = [record({}), record({ orderId: 'o2', channel: 'flipkart' })]
    // Enough advertising on one channel to put it under, which is the case
    // the chart's negative bars exist for.
    const marketing = { flipkart: { ads: 9000 } }
    const channelPnls = (['amazon_in', 'flipkart'] as const).map((ch) =>
      buildChannelPnl(records, skuMaster, fixedExpenses, ch, '2026-06', marketing),
    )
    const master = buildMasterPnl(channelPnls, '2026-06')

    expect(channelPnls.reduce((sum, p) => sum + (p.lines.ebitda ?? 0), 0)).toBeCloseTo(master.lines.ebitda ?? 0, 6)
    expect(channelPnls.find((p) => p.channel === 'flipkart')?.lines.ebitda ?? 0).toBeLessThan(0)
    // And the month's overhead is shared out once, not charged twice.
    expect(channelPnls.reduce((sum, p) => sum + (p.lines.fixedExpensesTotal ?? 0), 0)).toBeCloseTo(552739, 6)
  })
})

describe('output GST inside the price', () => {
  // A channel whose gross is an MRP: ₹399 including 18% GST, no discount.
  // Net sales is ₹338.14, and the ₹60.86 of GST is already out of it.
  const mrpRow = record({
    channel: 'snapdeal', marketplace: 'snapdeal', sellerType: 'marketplace', quantity: 1,
    grossSales: 399, discount: 0, netSales: 338.14, tax: 60.86, taxInGross: true,
    marketplaceFee: 0, shippingCost: 0,
  })

  it('is shown as a revenue adjustment, not as a return', () => {
    const pnl = buildChannelPnl([mrpRow], skuMaster, [], 'snapdeal', '2026-06', {})
    expect(pnl.lines.otherRevenueAdj).toBeCloseTo(60.86, 2)
    expect(pnl.lines.returns ?? 0).toBeCloseTo(0, 2)
    expect(pnl.lines.netSales).toBeCloseTo(338.14, 2)
  })

  it('is not charged a second time below the line', () => {
    // Taking it out twice is how a channel's EBITDA comes out short by
    // exactly its own GST.
    const pnl = buildChannelPnl([mrpRow], skuMaster, [], 'snapdeal', '2026-06', {})
    expect(pnl.lines.otherMarketplaceCharges ?? 0).toBe(0)
    expect(pnl.lines.grossProfit).toBeCloseTo(338.14 - 100, 2)
  })

  it('leaves a tax charged on top of the price where it was', () => {
    // Amazon's order report states the item tax beside a price that excludes
    // it, and that one is a charge.
    const pnl = buildChannelPnl([record({})], skuMaster, [], 'amazon_in', '2026-06', {})
    expect(pnl.lines.otherMarketplaceCharges).toBe(40)
    expect(pnl.lines.otherRevenueAdj).toBe(0)
  })

  it('keeps real returns separate from the GST', () => {
    // A row that came back: gross billed, nothing earned.
    const returned = record({
      channel: 'snapdeal', marketplace: 'snapdeal', sellerType: 'marketplace', orderId: 'o2',
      quantity: 0, grossSales: 399, discount: 0, netSales: 0, tax: 0, taxInGross: true,
      returnUnits: 1, status: 'returned', marketplaceFee: 0, shippingCost: 0,
    })
    const pnl = buildChannelPnl([mrpRow, returned], skuMaster, [], 'snapdeal', '2026-06', {})
    expect(pnl.lines.returns).toBeCloseTo(399, 2)
    expect(pnl.lines.otherRevenueAdj).toBeCloseTo(60.86, 2)
    expect(pnl.lines.netSales).toBeCloseTo(338.14, 2)
  })
})
