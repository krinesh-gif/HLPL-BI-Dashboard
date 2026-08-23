import { describe, expect, it } from 'vitest'
import { buildChannelPnlView } from './channelPnlRouter'
import type { FlipkartPnlFacts, SkuMaster } from '@/data/models'

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
