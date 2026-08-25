import { describe, expect, it } from 'vitest'
import { classifyRow, type RowFacts } from './events'

/**
 * Every case here was found in the company's real August payment file, not
 * invented. The counts in the comments are that file's.
 */
const row = (over: Partial<RowFacts> = {}): RowFacts => ({
  orderStatus: '', saleAmount: 0, returnAmount: 0, settlementAmount: 0,
  recovery: 0, compensation: 0, claims: 0,
  recoveryReason: '', compensationReason: '', claimsReason: '',
  ...over,
})

describe('a blank order status', () => {
  it('is an affiliate fee when that is the recovery reason', () => {
    // 145 rows of the real file look exactly like this. Every one of them was
    // being counted as a delivered sale.
    const c = classifyRow(row({ saleAmount: 0, settlementAmount: -28.25, recovery: -28.25, recoveryReason: 'Affiliate Fee' }))
    expect(c.eventType).toBe('affiliate_fee')
    expect(c.recognisesRevenue).toBe(false)
    expect(c.countsAsDispatch).toBe(false)
  })

  it('reads Meesho’s wordier affiliate reason too', () => {
    const c = classifyRow(row({
      recovery: -12, settlementAmount: -12,
      recoveryReason: 'Commission Fee on the NMV generated from the short videos shown on the app',
    }))
    expect(c.eventType).toBe('affiliate_fee')
  })

  it('is never revenue, even when the settlement is positive', () => {
    // The spec's case: sale 0, status blank, settlement +200.
    const c = classifyRow(row({ saleAmount: 0, settlementAmount: 200 }))
    expect(c.recognisesRevenue).toBe(false)
    expect(c.eventType).toBe('settlement_adjustment')
    expect(c.confidence).toBe('needs_review')
  })

  it('flags a recovery with no reason rather than filing it silently', () => {
    const c = classifyRow(row({ recovery: -50, settlementAmount: -50 }))
    expect(c.eventType).toBe('recovery')
    expect(c.confidence).toBe('needs_review')
  })
})

describe('order statuses the file actually carries', () => {
  it('recognises a delivered sale', () => {
    const c = classifyRow(row({ orderStatus: 'Delivered', saleAmount: 309.21, settlementAmount: 273.43 }))
    expect(c).toMatchObject({ eventType: 'sale', recognisesRevenue: true, countsAsDispatch: true })
  })

  it('counts RTO as a dispatch but not as revenue', () => {
    // The parcel moved and cost money to move; the customer never paid.
    const c = classifyRow(row({ orderStatus: 'RTO', saleAmount: 160 }))
    expect(c).toMatchObject({ eventType: 'rto', countsAsDispatch: true, recognisesRevenue: false })
  })

  it('treats a return row as a reversal, not a second shipment', () => {
    // The dispatch was already counted on the sale row for this sub-order.
    const c = classifyRow(row({ orderStatus: 'Return', returnAmount: -160, settlementAmount: -251.18 }))
    expect(c).toMatchObject({ eventType: 'return', countsAsDispatch: false, recognisesRevenue: false })
  })

  it('keeps an exchange from becoming a second sale', () => {
    const c = classifyRow(row({ orderStatus: 'Exchange', saleAmount: 249 }))
    expect(c.eventType).toBe('exchange')
    expect(c.recognisesRevenue).toBe(false)
    expect(c.countsAsDispatch).toBe(true)
  })

  it('recognises Shipped as a sale, since the file settles it as one', () => {
    const c = classifyRow(row({ orderStatus: 'Shipped', saleAmount: 160, settlementAmount: 94.18 }))
    expect(c.eventType).toBe('sale')
  })

  it('gives cancellations no revenue and no dispatch', () => {
    const c = classifyRow(row({ orderStatus: 'Cancelled', saleAmount: 199 }))
    expect(c).toMatchObject({ eventType: 'cancellation', recognisesRevenue: false, countsAsDispatch: false })
  })
})

describe('a status this app has never seen', () => {
  it('goes to review instead of becoming revenue', () => {
    // The failure mode being prevented: Meesho adds a status next quarter and
    // it quietly lands in Net Sales.
    const c = classifyRow(row({ orderStatus: 'Lost In Transit', saleAmount: 500 }))
    expect(c.eventType).toBe('unclassified')
    expect(c.confidence).toBe('needs_review')
    expect(c.recognisesRevenue).toBe(false)
    expect(c.reason).toContain('Lost In Transit')
  })
})

describe('a delivered order that also carries a recovery', () => {
  it('stays a sale — the fee is a separate event on the same row', () => {
    // 72 rows in the real file. The sale must not be netted away by the fee.
    const c = classifyRow(row({ orderStatus: 'Delivered', saleAmount: 500, recovery: -20, recoveryReason: 'Affiliate Fee' }))
    expect(c.eventType).toBe('sale')
    expect(c.recognisesRevenue).toBe(true)
  })
})
