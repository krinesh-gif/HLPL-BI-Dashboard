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
})
