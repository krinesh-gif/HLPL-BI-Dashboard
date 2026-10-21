import { describe, expect, it } from 'vitest'
import { buildMonthlyClose, type MonthlyCloseInput } from './monthlyClose'
import type { ChannelPnlView } from './channelPnlRouter'
import type { BusinessChannelId } from '@/config/channels'
import type { CanonicalSalesRecord, NykaaPnlFacts } from '@/data/models'
import { computeSubtotals } from './pnl'

const EMPTY_BUCKETS = {
  grossSales: 0, discounts: 0, returns: 0, otherRevenueAdj: 0, cogs: 0,
  marketplaceCommission: 0, fulfilment: 0, shipping: 0, collectionFees: 0,
  rtoCharges: 0, returnCharges: 0, otherMarketplaceCharges: 0,
  ads: 0, performanceMarketing: 0, otherMarketing: 0,
}

/** A channel's month, at the level the close check reads it. */
function view(
  channel: BusinessChannelId,
  month: string,
  over: Partial<typeof EMPTY_BUCKETS> = {},
  notes: string[] = [],
): ChannelPnlView {
  return {
    channel, month, notes,
    canonical: { channel, month, lines: computeSubtotals({ ...EMPTY_BUCKETS, ...over }) },
  }
}

const HAS_EVERYTHING = {
  fxUsd: true, fxAed: true, freightIndiaUsa: true, freightIndiaUae: true,
  nykaaInboundFreight: true, packaging: true, nykaaConfirmedDiscount: true,
}

function input(over: Partial<MonthlyCloseInput> = {}): MonthlyCloseInput {
  return {
    month: '2026-09',
    views: [view('flipkart', '2026-09', { grossSales: 100000 })],
    previousViews: [view('flipkart', '2026-08', { grossSales: 90000 })],
    salesRecords: [],
    fixedExpenses: [{ month: '2026-09', category: 'fixedExpensesTotal', amount: 500000 }],
    nykaaFacts: [],
    has: { ...HAS_EVERYTHING },
    catalogue: { unpricedSkus: 0, unpricedNetSales: 0, totalNetSales: 100000, missingGstSkus: 0 },
    productName: (sku, fallback) => fallback ?? sku,
    ...over,
  }
}

describe('whether a month can be reported', () => {
  it('is ready when every channel that was trading has filed', () => {
    const close = buildMonthlyClose(input())
    expect(close.blockers).toEqual([])
    expect(close.ready).toBe(true)
  })

  it('blocks a month where a trading channel has filed nothing', () => {
    // The failure this exists to prevent: an unfiled month reads as a month
    // with no sales, and the report says the channel earned nothing.
    const close = buildMonthlyClose(input({
      views: [view('flipkart', '2026-09')],
      previousViews: [view('flipkart', '2026-08', { grossSales: 90000 })],
    }))
    expect(close.ready).toBe(false)
    expect(close.blockers.map((b) => b.id)).toContain('missing-flipkart')
    expect(close.blockers[0].detail).toContain('₹90,000.00')
  })

  it('says nothing about a channel that has never traded', () => {
    const close = buildMonthlyClose(input({ views: [], previousViews: [] }))
    expect(close.blockers.filter((b) => b.id.startsWith('missing-'))).toEqual([])
  })

  it('blocks a month with no fixed expenses, because every EBITDA is wrong without them', () => {
    const close = buildMonthlyClose(input({ fixedExpenses: [] }))
    expect(close.blockers.map((b) => b.id)).toContain('fixed-expenses')
  })

  it('blocks a foreign channel with no rate for the month, and only then', () => {
    const trading = [view('amazon_us', '2026-09', { grossSales: 5000 })]
    expect(buildMonthlyClose(input({ views: trading, has: { ...HAS_EVERYTHING, fxUsd: false } }))
      .blockers.map((b) => b.id)).toContain('fx-usd')
    // No dollars this month, so no dollar rate is needed.
    expect(buildMonthlyClose(input({ has: { ...HAS_EVERYTHING, fxUsd: false } }))
      .blockers.map((b) => b.id)).not.toContain('fx-usd')
  })

  it('blocks a Nykaa month with no customer discount at all', () => {
    const nykaa: NykaaPnlFacts[] = [{
      month: '2026-09', grossSalesMrp: 100000, returnsMrp: 0, netSalesMrp: 100000,
      unitsShipped: 100, unitsReturned: 0, netUnits: 100, orders: 100,
      customerPaidValue: 0, cogsPriced: 0, cogsUnpriced: 0, nykaaAds: 0,
    } as NykaaPnlFacts]
    const close = buildMonthlyClose(input({
      views: [view('nykaa', '2026-09', { grossSales: 100000 })],
      previousViews: [view('nykaa', '2026-08', { grossSales: 100000 })],
      nykaaFacts: nykaa,
    }))
    expect(close.blockers.map((b) => b.id)).toContain('nykaa-discount-missing')
  })

  it('warns, without blocking, when Nykaa’s discount is the file’s figure rather than a confirmed one', () => {
    const nykaa: NykaaPnlFacts[] = [{
      month: '2026-09', grossSalesMrp: 100000, returnsMrp: 0, netSalesMrp: 100000,
      unitsShipped: 100, unitsReturned: 0, netUnits: 100, orders: 100,
      customerPaidValue: 70000, customerDiscount: 30000, cogsPriced: 0, cogsUnpriced: 0, nykaaAds: 0,
    } as NykaaPnlFacts]
    const close = buildMonthlyClose(input({
      views: [view('nykaa', '2026-09', { grossSales: 100000 })],
      previousViews: [view('nykaa', '2026-08', { grossSales: 100000 })],
      nykaaFacts: nykaa,
      has: { ...HAS_EVERYTHING, nykaaConfirmedDiscount: false },
    }))
    expect(close.ready).toBe(true)
    expect(close.warnings.map((w) => w.id)).toContain('nykaa-discount-unconfirmed')
  })

  it('carries each channel’s own explanation of its gaps rather than rewording them', () => {
    const close = buildMonthlyClose(input({
      views: [view('meesho', '2026-09', { grossSales: 1000 }, ['No packaging rate is on file for 2026-09. It is left at zero.'])],
      previousViews: [view('meesho', '2026-08', { grossSales: 1000 })],
    }))
    const note = close.warnings.find((w) => w.id === 'note-meesho-0')
    expect(note?.detail).toBe('No packaging rate is on file for 2026-09. It is left at zero.')
    expect(note?.title).toContain('Meesho')
  })
})

describe('the month’s red flags', () => {
  it('flags a channel trading at a loss before overheads', () => {
    const close = buildMonthlyClose(input({
      views: [view('blinkit', '2026-09', { grossSales: 100000, cogs: 80000, marketplaceCommission: 40000 })],
      previousViews: [view('blinkit', '2026-08', { grossSales: 100000 })],
    }))
    const flag = close.redFlags.find((f) => f.id === 'negative-contribution-blinkit')
    expect(flag).toBeDefined()
    expect(flag?.amountInr).toBeLessThan(0)
  })

  it('never lets a red flag block the report — it is the reason to send it', () => {
    const close = buildMonthlyClose(input({
      views: [view('blinkit', '2026-09', { grossSales: 100000, cogs: 80000, marketplaceCommission: 40000 })],
      previousViews: [view('blinkit', '2026-08', { grossSales: 100000 })],
    }))
    expect(close.redFlags.length).toBeGreaterThan(0)
    expect(close.ready).toBe(true)
  })
})

describe('the month’s best sellers', () => {
  const sale = (sku: string, netSales: number, quantity: number, month = '2026-09'): CanonicalSalesRecord => ({
    orderDate: `${month}-15`, channel: 'flipkart', marketplace: 'flipkart', sellerType: 'marketplace',
    sku, productName: sku, category: 'Skincare', quantity,
    grossSales: netSales, discount: 0, netSales, returnUnits: 0, rtoUnits: 0,
    shippingCost: 0, marketplaceFee: 0, tax: 0, status: 'completed', currency: 'INR',
  } as CanonicalSalesRecord)

  it('ranks by what each product earned, and only in this month', () => {
    const close = buildMonthlyClose(input({
      salesRecords: [
        sale('A', 1000, 2), sale('B', 3000, 1), sale('A', 500, 1),
        sale('C', 9000, 9, '2026-08'),
      ],
    }))
    expect(close.topProducts.map((p) => p.productName)).toEqual(['B', 'A'])
    expect(close.topProducts[1].netSales).toBe(1500)
    expect(close.topProducts[1].units).toBe(3)
    expect(close.topProducts[0].pctOfNetSales).toBeCloseTo((3000 / 4500) * 100, 6)
  })

  it('groups a product under one name however the channels code it', () => {
    // Two marketplace codes for one product is the normal case, and five
    // rows of the same shampoo is not a top five.
    const close = buildMonthlyClose(input({
      salesRecords: [sale('FK-SHMP', 1000, 1), sale('MY-SHMP', 1000, 1)],
      productName: () => 'Rosemary Shampoo 200ml',
    }))
    expect(close.topProducts).toHaveLength(1)
    expect(close.topProducts[0].netSales).toBe(2000)
  })
})
