import { describe, expect, it } from 'vitest'
import type { CanonicalSalesRecord } from '@/data/models'
import type { ChannelFacts } from './netSales'
import { categoryMomRows, channelMomRows, masterMomRow, metricTrend, skuMomRows, type MomInputs } from './momMetrics'

const facts: ChannelFacts = { flipkartFacts: [], amazonUsaFacts: [], meeshoFacts: [] }

function record(over: Partial<CanonicalSalesRecord> = {}): CanonicalSalesRecord {
  return {
    orderId: 'o', orderDate: '2026-08-10', channel: 'meesho', marketplace: 'Meesho',
    sellerType: 'marketplace', sku: 'A', productName: 'Product A', category: 'Hair',
    quantity: 1, grossSales: 300, discount: 0, netSales: 300,
    returnUnits: 0, rtoUnits: 0, shippingCost: 0, marketplaceFee: 0, tax: 0,
    status: 'completed', currency: 'INR', importId: 'i', ...over,
  }
}

function inputs(records: CanonicalSalesRecord[], channels: MomInputs['channels'] = ['meesho']): MomInputs {
  return { records, month: '2026-08', previousMonth: '2026-07', facts, channels }
}

describe('MoM ASP', () => {
  it('computes the owner\'s worked example', () => {
    // July ASP ₹280, August ASP ₹300 => +7.14%
    const row = masterMomRow(
      inputs([
        record({ orderDate: '2026-07-10', netSales: 2800, quantity: 10 }),
        record({ orderDate: '2026-08-10', netSales: 3000, quantity: 10 }),
      ]),
    )
    expect(row.previousAsp).toBe(280)
    expect(row.currentAsp).toBe(300)
    expect(row.aspChange).toBe(20)
    expect(row.aspGrowthPct).toBeCloseTo(7.14, 2)
  })

  it('uses Net Sales, not gross', () => {
    const row = masterMomRow(
      inputs([record({ orderDate: '2026-08-10', grossSales: 1000, discount: 100, netSales: 800, quantity: 2 })]),
    )
    // 800/2, not 1000/2 — the discount and the returned value both belong in ASP.
    expect(row.currentAsp).toBe(400)
  })

  it('reports null rather than a growth figure when the prior month had no units', () => {
    const row = masterMomRow(inputs([record({ orderDate: '2026-08-10', netSales: 300, quantity: 1 })]))
    expect(row.previousAsp).toBeNull()
    expect(row.aspGrowthPct).toBeNull()
    expect(row.aspChange).toBeNull()
  })
})

describe('MoM RTO', () => {
  it('computes the owner\'s worked example in percentage points', () => {
    // July 8.2%, August 6.7% => an improvement of 1.5 percentage points.
    const row = masterMomRow(
      inputs([
        record({ orderDate: '2026-07-10', quantity: 1000, rtoUnits: 82 }),
        record({ orderDate: '2026-08-10', quantity: 1000, rtoUnits: 67 }),
      ]),
    )
    expect(row.previousRtoPct).toBeCloseTo(8.2, 5)
    expect(row.currentRtoPct).toBeCloseTo(6.7, 5)
    expect(row.rtoPointChange).toBeCloseTo(-1.5, 5)
    expect(row.rtoDeteriorated).toBe(false)
  })

  it('keeps the rate change and the unit growth as separate numbers', () => {
    // Volume doubles while the rate improves: fewer per hundred, but more
    // parcels coming back. Conflating these would report the opposite.
    const row = masterMomRow(
      inputs([
        record({ orderDate: '2026-07-10', quantity: 1000, rtoUnits: 100 }), // 10%
        record({ orderDate: '2026-08-10', quantity: 2000, rtoUnits: 150 }), // 7.5%
      ]),
    )
    expect(row.rtoPointChange).toBeCloseTo(-2.5, 5)
    expect(row.rtoUnitGrowthPct).toBeCloseTo(50, 5)
  })

  it('flags a month where RTO got worse', () => {
    const row = masterMomRow(
      inputs([
        record({ orderDate: '2026-07-10', quantity: 100, rtoUnits: 5 }),
        record({ orderDate: '2026-08-10', quantity: 100, rtoUnits: 9 }),
      ]),
    )
    expect(row.rtoPointChange).toBeCloseTo(4, 5)
    expect(row.rtoDeteriorated).toBe(true)
  })

  it('measures against shipped units, so cancellations do not flatter the rate', () => {
    const row = masterMomRow(
      inputs([
        record({ orderDate: '2026-08-10', quantity: 100, rtoUnits: 10 }),
        record({ orderDate: '2026-08-11', quantity: 900, status: 'cancelled' }),
      ]),
    )
    // 10 of 100 shipped. Counting the cancelled 900 would report 1%.
    expect(row.currentRtoPct).toBeCloseTo(10, 5)
  })
})

describe('the same metrics at every level', () => {
  const records = [
    record({ orderDate: '2026-07-10', channel: 'meesho', sku: 'A', category: 'Hair', netSales: 2800, quantity: 10 }),
    record({ orderDate: '2026-08-10', channel: 'meesho', sku: 'A', category: 'Hair', netSales: 3000, quantity: 10 }),
    record({ orderDate: '2026-08-10', channel: 'flipkart', sku: 'B', category: 'Skin', netSales: 1000, quantity: 5 }),
  ]

  it('gives one row per channel', () => {
    const rows = channelMomRows(inputs(records, ['meesho', 'flipkart', 'myntra']))
    expect(rows.map((r) => r.key).sort()).toEqual(['flipkart', 'meesho'])
    expect(rows.find((r) => r.key === 'meesho')?.currentAsp).toBe(300)
  })

  it('gives one row per category', () => {
    const rows = categoryMomRows(inputs(records))
    expect(rows.map((r) => r.key).sort()).toEqual(['Hair', 'Skin'])
    expect(rows.find((r) => r.key === 'Hair')?.aspGrowthPct).toBeCloseTo(7.14, 2)
  })

  it('gives one row per SKU, labelled from the Product Master', () => {
    const rows = skuMomRows(inputs(records), (sku) => (sku === 'A' ? 'Rosemary 15 ml' : sku))
    expect(rows.find((r) => r.key === 'A')?.label).toBe('Rosemary 15 ml')
    expect(rows.find((r) => r.key === 'A')?.currentAsp).toBe(300)
  })

  it('agrees between the master row and the sum of its channels', () => {
    const master = masterMomRow(inputs(records, ['meesho', 'flipkart']))
    const channels = channelMomRows(inputs(records, ['meesho', 'flipkart']))
    expect(master.current.netSales).toBe(channels.reduce((s, r) => s + r.current.netSales, 0))
    expect(master.current.units).toBe(channels.reduce((s, r) => s + r.current.units, 0))
  })

  it('folds every spelling of a missing category into one row', () => {
    const rows = categoryMomRows(
      inputs([
        record({ orderDate: '2026-08-10', category: '' }),
        record({ orderDate: '2026-08-11', category: 'N/A' }),
        record({ orderDate: '2026-08-12', category: 'unknown' }),
      ]),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('Uncategorized')
    expect(rows[0].current.orders).toBe(3)
  })
})

describe('the trend series', () => {
  it('reports ASP and RTO per month, with null where a month has no units', () => {
    const trend = metricTrend(
      [record({ orderDate: '2026-08-10', netSales: 3000, quantity: 10, rtoUnits: 1 })],
      ['2026-07', '2026-08'],
      facts,
      ['meesho'],
    )
    expect(trend[0].asp).toBeNull()
    expect(trend[0].rtoPct).toBeNull()
    expect(trend[1].asp).toBe(300)
    expect(trend[1].rtoPct).toBeCloseTo(10, 5)
  })
})
