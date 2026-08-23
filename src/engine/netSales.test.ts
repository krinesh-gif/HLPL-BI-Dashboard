import { describe, expect, it } from 'vitest'
import type { CanonicalSalesRecord, MeeshoPnlFacts } from '@/data/models'
import {
  addFigures,
  asp,
  netSalesForChannelMonth,
  netSalesForMonth,
  orderBasisNetSales,
  rtoPct,
  settlementBasisNetSales,
  type ChannelFacts,
} from './netSales'
import { reconcileChannelMonth } from './reconciliation'

const FX = 100 // a round rate keeps the USD assertions readable

function record(over: Partial<CanonicalSalesRecord> = {}): CanonicalSalesRecord {
  return {
    orderId: 'o1',
    orderDate: '2026-08-10',
    channel: 'meesho',
    marketplace: 'Meesho',
    sellerType: 'marketplace',
    sku: 'AO/Shmp/200',
    productName: 'Shampoo',
    category: 'Hair',
    quantity: 1,
    grossSales: 300,
    discount: 0,
    netSales: 300,
    returnUnits: 0,
    rtoUnits: 0,
    shippingCost: 0,
    marketplaceFee: 0,
    tax: 0,
    status: 'completed',
    currency: 'INR',
    importId: 'i1',
    ...over,
  }
}

const noFacts: ChannelFacts = { flipkartFacts: [], amazonUsaFacts: [], meeshoFacts: [] }

describe('the Net Sales definition', () => {
  it('keeps the identity net = gross - discounts - returns', () => {
    const f = orderBasisNetSales([
      record({ grossSales: 500, discount: 50, netSales: 400 }),
      record({ grossSales: 300, discount: 0, netSales: 300 }),
    ])
    expect(f.grossSales).toBe(800)
    expect(f.discounts).toBe(50)
    expect(f.returnsValue).toBe(50)
    expect(f.netSales).toBe(700)
    expect(f.grossSales - f.discounts - f.returnsValue).toBeCloseTo(f.netSales, 6)
  })

  it('excludes cancelled orders, which never ship and never settle', () => {
    const f = orderBasisNetSales([
      record({ netSales: 300, grossSales: 300 }),
      record({ netSales: 900, grossSales: 900, status: 'cancelled' }),
    ])
    expect(f.netSales).toBe(300)
    expect(f.orders).toBe(1)
    expect(f.units).toBe(1)
  })

  it('counts a returned order as revenue less its return, not as nothing', () => {
    // The row already carries netSales net of the return; excluding the whole
    // row would delete the sale as well as the return.
    const f = orderBasisNetSales([record({ status: 'returned', grossSales: 300, netSales: 0, returnUnits: 1 })])
    expect(f.grossSales).toBe(300)
    expect(f.returnsValue).toBe(300)
    expect(f.netSales).toBe(0)
    expect(f.returnUnits).toBe(1)
  })

  it('converts Amazon USA rows from USD before adding them to a rupee total', () => {
    const f = orderBasisNetSales(
      [
        record({ channel: 'meesho', currency: 'INR', grossSales: 300, netSales: 300 }),
        record({ channel: 'amazon_us', currency: 'USD', grossSales: 10, netSales: 10 }),
      ],
      FX,
    )
    // Without conversion this would read 310 — ten dollars counted as ten rupees.
    expect(f.netSales).toBe(300 + 10 * FX)
  })
})

describe('which basis wins', () => {
  const meeshoFacts: MeeshoPnlFacts[] = [
    { month: '2026-08', grossSale: 500000, returns: 100000, forwardShipping: 0, reverseShipping: 0,
      returnPremium: 0, returnPremiumRecovered: 0, commission: 0, fixedFee: 0, warehousing: 0,
      goldFee: 0, mallFee: 0, otherSettlementCharge: 0, ads: 0, gst: 0, tcs: 0, tds: 0,
      compensation: 0, claims: 0, recovery: 0, settlementAmount: 0, cogs: 0 },
  ]
  const facts: ChannelFacts = { ...noFacts, meeshoFacts }

  it('reads Meesho Net Sales from the settlement report when one exists', () => {
    const s = settlementBasisNetSales('meesho', '2026-08', facts)
    expect(s?.netSales).toBe(400000)
    expect(s?.basis).toBe('settlement')
  })

  it('gives the P&L and the dashboard the same number for a settled month', () => {
    // This is the bug the owner reported: the dashboard summed order rows while
    // the P&L read the settlement file, so the two screens disagreed.
    const records = [record({ netSales: 380000, grossSales: 380000 })]
    const figure = netSalesForChannelMonth({ records, channel: 'meesho', month: '2026-08', facts })

    expect(figure.netSales).toBe(400000) // settlement, not the 380000 from orders
    expect(figure.basis).toBe('settlement')
    expect(figure.sourceLabel).toBe('Meesho settlement report')
  })

  it('still takes unit counts from order rows, since settlement reports carry none', () => {
    const records = [record({ quantity: 7, rtoUnits: 2 })]
    const figure = netSalesForChannelMonth({ records, channel: 'meesho', month: '2026-08', facts })
    expect(figure.units).toBe(7)
    expect(figure.rtoUnits).toBe(2)
  })

  it('falls back to order rows for a month with no settlement report', () => {
    const records = [record({ orderDate: '2026-07-10', netSales: 250 })]
    const figure = netSalesForChannelMonth({ records, channel: 'meesho', month: '2026-07', facts })
    expect(figure.netSales).toBe(250)
    expect(figure.basis).toBe('order')
  })

  it('never claims a mixed total is fully settled', () => {
    const settled = netSalesForChannelMonth({ records: [], channel: 'meesho', month: '2026-08', facts })
    const unsettled = netSalesForChannelMonth({
      records: [record({ channel: 'flipkart', netSales: 100 })],
      channel: 'flipkart', month: '2026-08', facts,
    })
    expect(addFigures(settled, unsettled).basis).toBe('order')
  })

  it('adds every channel into one company figure', () => {
    const records = [
      record({ channel: 'flipkart', netSales: 1000, grossSales: 1000 }),
      record({ channel: 'myntra', netSales: 500, grossSales: 500 }),
    ]
    const total = netSalesForMonth(records, '2026-08', facts, ['meesho', 'flipkart', 'myntra'])
    expect(total.netSales).toBe(400000 + 1000 + 500)
  })
})

describe('derived metrics', () => {
  it('computes ASP as Net Sales over units', () => {
    const f = orderBasisNetSales([record({ netSales: 600, quantity: 2 })])
    expect(asp(f)).toBe(300)
  })

  it('returns null rather than zero when there are no units to divide by', () => {
    expect(asp(orderBasisNetSales([]))).toBeNull()
    expect(rtoPct(orderBasisNetSales([]))).toBeNull()
  })

  it('computes RTO % against shipped units, excluding cancellations', () => {
    const f = orderBasisNetSales([
      record({ quantity: 90, rtoUnits: 10 }),
      record({ quantity: 10, status: 'cancelled' }),
    ])
    // 10 of 90 shipped, not 10 of 100 — cancelled units never shipped.
    expect(rtoPct(f)).toBeCloseTo(11.11, 2)
  })
})

describe('reconciling the two bases', () => {
  const meeshoFacts: MeeshoPnlFacts[] = [
    { month: '2026-08', grossSale: 500000, returns: 100000, forwardShipping: 0, reverseShipping: 0,
      returnPremium: 0, returnPremiumRecovered: 0, commission: 0, fixedFee: 0, warehousing: 0,
      goldFee: 0, mallFee: 0, otherSettlementCharge: 0, ads: 0, gst: 0, tcs: 0, tds: 0,
      compensation: 0, claims: 0, recovery: 0, settlementAmount: 0, cogs: 0 },
  ]
  const facts: ChannelFacts = { ...noFacts, meeshoFacts }

  it('reports no gap when there is no settlement report to compare against', () => {
    const r = reconcileChannelMonth([record()], 'myntra', '2026-08', facts)
    expect(r.status).toBe('no-settlement-report')
    expect(r.settlementBasis).toBeNull()
  })

  it('names late-month orders as a cause and sizes them', () => {
    const r = reconcileChannelMonth(
      [
        record({ orderDate: '2026-08-02', netSales: 300000, grossSales: 300000 }),
        record({ orderDate: '2026-08-29', netSales: 80000, grossSales: 80000 }),
      ],
      'meesho', '2026-08', facts,
    )
    const lag = r.causes.find((c) => c.key === 'settlement-lag')
    // Signed as a contribution to (settlement - order): these rupees are on the
    // order side now and will be on the settlement side next month.
    expect(lag?.amount).toBe(-80000)
    expect(lag?.measurable).toBe(true)
    // Overlapping candidates must not be treated as accounting for the gap.
    expect(lag?.definitive).toBe(false)
  })

  it('flags a month whose order report was never uploaded, and explains it fully', () => {
    const r = reconcileChannelMonth([], 'meesho', '2026-08', facts)
    expect(r.status).toBe('no-order-report')
    const cause = r.causes.find((c) => c.key === 'no-order-report')
    expect(cause?.definitive).toBe(true)
    expect(cause?.amount).toBe(400000)
    // A definitive cause leaves nothing to chase.
    expect(r.residual).toBe(0)
  })

  it('calls a difference within tolerance reconciled', () => {
    const r = reconcileChannelMonth(
      [record({ orderDate: '2026-08-02', netSales: 399000, grossSales: 399000 })],
      'meesho', '2026-08', facts,
    )
    expect(r.status).toBe('reconciled')
  })

  it('leaves the whole gap to chase when only overlapping candidates apply', () => {
    const r = reconcileChannelMonth(
      [record({ orderDate: '2026-08-02', netSales: 300000, grossSales: 300000 })],
      'meesho', '2026-08', facts,
    )
    expect(r.difference).toBe(100000)
    // Candidate causes are sized but must not shrink the residual, or the
    // screen would claim the gap was understood when it is not.
    expect(r.residual).toBe(100000)
    expect(r.causes.every((c) => !c.definitive)).toBe(true)
    expect(r.status).toBe('gap')
  })

  it('sizes the returns-timing and gross-side candidates separately', () => {
    const r = reconcileChannelMonth(
      [record({ orderDate: '2026-08-02', netSales: 300000, grossSales: 300000 })],
      'meesho', '2026-08', facts,
    )
    // Settlement deducts 100000 of returns; the order rows deduct none.
    expect(r.causes.find((c) => c.key === 'returns-timing')?.amount).toBe(-100000)
    // Settlement gross is 500000 against 300000 of orders.
    expect(r.causes.find((c) => c.key === 'gross-gap')?.amount).toBe(200000)
  })
})
