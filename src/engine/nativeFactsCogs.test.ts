import { describe, expect, it } from 'vitest'
import type { CanonicalSalesRecord, MeeshoPnlFacts, SkuMaster } from '@/data/models'
import { buildCostIndex, type CostVersion } from '@/data/costVersions'
import { buildChannelPnlView, type ChannelPnlViewInputs } from './channelPnlRouter'

/**
 * A channel with a settlement report must still honour effective-dated costs.
 *
 * The facts blob carries a `cogs` figure, but a marketplace does not know what
 * a product costs us — that number was computed by the importer from whatever
 * was in the Product Master on upload day and then frozen. Before this was
 * fixed, uploading a cost sheet changed nothing on Flipkart or Meesho, which is
 * to say on the two channels the owner most needed it for. Unit tests missed it
 * because they exercised the generic P&L path; only driving the real screen
 * showed it.
 */

const skuMaster: SkuMaster[] = [
  { sku: 'SKU001', productName: 'Rosemary 15 ml', category: 'Hair', brand: 'AO', cogs: 50, mrp: 299,
    launchDate: '2025-04-01', status: 'active', leadTimeDays: 21, safetyStock: 0 },
]

function record(month: string, quantity: number): CanonicalSalesRecord {
  return {
    orderId: `o-${month}-${quantity}`, orderDate: `${month}-10`, channel: 'meesho', marketplace: 'Meesho',
    sellerType: 'marketplace', sku: 'SKU001', productName: 'Rosemary 15 ml', category: 'Hair',
    quantity, grossSales: 300 * quantity, discount: 0, netSales: 300 * quantity,
    returnUnits: 0, rtoUnits: 0, shippingCost: 0, marketplaceFee: 0, tax: 0,
    status: 'completed', currency: 'INR', importId: 'i',
  }
}

function meeshoFacts(month: string): MeeshoPnlFacts {
  return {
    month, grossSale: 30000, returns: 0, forwardShipping: 0, reverseShipping: 0,
    returnPremium: 0, returnPremiumRecovered: 0, commission: 0, fixedFee: 0, warehousing: 0,
    goldFee: 0, mallFee: 0, otherSettlementCharge: 0, ads: 0, gst: 0, tcs: 0, tds: 0,
    compensation: 0, claims: 0, recovery: 0, settlementAmount: 0,
    // Frozen at import time from the Product Master's then-current ₹50.
    cogs: 5000,
  }
}

function inputs(versions: CostVersion[], records: CanonicalSalesRecord[]): ChannelPnlViewInputs {
  return {
    salesRecords: records,
    skuMaster,
    fixedExpenses: [],
    marketing: {},
    facts: { flipkartFacts: [], amazonUsaFacts: [], meeshoFacts: [meeshoFacts('2026-07'), meeshoFacts('2026-08')] },
    cogs: { costIndex: buildCostIndex(versions, skuMaster), mappings: [], comboComponents: [] },
  }
}

const records = [record('2026-07', 100), record('2026-08', 100)]

function cogsOf(month: string, versions: CostVersion[]): number {
  return buildChannelPnlView('meesho', month, inputs(versions, records)).canonical.lines.cogs ?? 0
}

describe('effective-dated costs on a channel with a settlement report', () => {
  it('prices a settled month from the cost sheet, not from the frozen facts figure', () => {
    const cogs = cogsOf('2026-08', [
      { sku: 'SKU001', effectiveFrom: '2026-08', cogs: 99, source: 'cost-sheet' },
    ])
    // 100 units at ₹99. The facts blob says 5000; honouring it would make the
    // cost sheet a no-op on this channel.
    expect(cogs).toBe(9900)
  })

  it('leaves an earlier month at the cost that applied to it', () => {
    const versions: CostVersion[] = [
      { sku: 'SKU001', effectiveFrom: '2026-08', cogs: 99, source: 'cost-sheet' },
    ]
    expect(cogsOf('2026-07', versions)).toBe(5000) // 100 units at the ₹50 baseline
    expect(cogsOf('2026-08', versions)).toBe(9900)
  })

  it('does not move any month when the new cost starts later than both', () => {
    const before = { july: cogsOf('2026-07', []), august: cogsOf('2026-08', []) }
    const versions: CostVersion[] = [
      { sku: 'SKU001', effectiveFrom: '2026-09', cogs: 99, source: 'cost-sheet' },
    ]
    expect(cogsOf('2026-07', versions)).toBe(before.july)
    expect(cogsOf('2026-08', versions)).toBe(before.august)
  })

  it('keeps the imported figure when there are no order rows to recompute from', () => {
    // Nothing better is available, and inventing a zero would show 100% margin.
    const view = buildChannelPnlView('meesho', '2026-08', inputs([], []))
    expect(view.canonical.lines.cogs).toBe(5000)
  })

  it('still renders the native waterfall from the recomputed cost', () => {
    const view = buildChannelPnlView(
      'meesho', '2026-08',
      inputs([{ sku: 'SKU001', effectiveFrom: '2026-08', cogs: 99, source: 'cost-sheet' }], records),
    )
    // The native table and the canonical buckets must not disagree about COGS.
    expect(view.native?.values.cogs).toBe(-9900)
    expect(view.canonical.lines.cogs).toBe(9900)
  })
})
